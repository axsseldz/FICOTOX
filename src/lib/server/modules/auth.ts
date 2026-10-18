import { isAvatarKey } from "../../shared/avatars";
import { versionFoto } from "./fotos";
import { createAccessToken, requireUser, type CurrentUser } from "../auth";
import { registrarAuditoria } from "../audit";
import { getConfig } from "../config";
import { isOperationalError, type Row, type Session } from "../db";
import { json, readJson, type RouteContext } from "../http";
import { cargarAutorizacion, cuentaVigente, filasDeRoles, hoy, MENSAJE_CUENTA_NO_VIGENTE } from "../rbac";
import { emitirReauth, estadoAcceso, ipDe, MENSAJE_ACCESO_FALLIDO, registrarIntento } from "../seguridad";
import { hashPassword, validatePasswordStrength } from "../password";
import { expandirPermisos, mapaPermisos, permite } from "../../shared/permisos";

import { verifyPassword } from "../password";

/* Acceso con usuario y contrasena del sistema (Fase 3: se retiro el proveedor externo de identidad). */

const USER_QUERY = `
  SELECT u.id, u.nombre, u.email, u.activo, u.password_hash, u.avatar, u.token_version, u.vigente_desde, u.vigente_hasta,
         u.bloqueado_hasta, u.intentos_desde, u.debe_cambiar_password
  FROM usuarios u
  WHERE LOWER(u.email) = LOWER(:email)
  LIMIT 1
`;

async function getUserByEmail(s: Session, email: string): Promise<Row | null> {
  return s.queryOne(USER_QUERY, { email });
}

/*
 * Sesion: el JWT solo identifica a la persona (sub, correo, nombre). Los roles y
 * permisos se calculan en cada peticion desde la base (rbac.ts), asi que un rol
 * revocado o vencido deja de contar sin volver a iniciar sesion.
 */
async function issueSession(s: Session, row: Row): Promise<Response> {
  // Fase 2: una cuenta inactiva o fuera de vigencia no entra, y el intento queda en la bitacora
  // (se descarta lo que el login alcanzo a registrar como exitoso).
  const rechazo = !row.activo ? "inactiva" : !cuentaVigente(row) ? "cuenta_no_vigente" : null;
  if (rechazo) {
    await s.rollback();
    await registrarAuditoria(s, null, { accion: "login_fallido", entidad: "sesion", entidadId: row.id as number, referencia: String(row.email || "").slice(0, 160), detalle: { motivo: rechazo, existe_usuario: true } });
    await s.commit();
    return rechazo === "inactiva" ? json({ message: "Usuario inactivo" }, 403) : json({ message: MENSAJE_CUENTA_NO_VIGENTE, codigo: "cuenta_no_vigente" }, 403);
  }

  await s.execute("UPDATE usuarios SET ultimo_acceso = CURRENT_TIMESTAMP WHERE id = :user_id", { user_id: row.id });
  await s.commit();

  const user: CurrentUser = { sub: String(row.id), email: String(row.email || ""), nombre: String(row.nombre || ""), tv: Number(row.token_version || 0) };
  const token = await createAccessToken({ ...user });
  const perfil = await perfilSesion(s, user);
  return json({ token, ...perfil });
}

/* Usuario, roles vigentes, cuenta y permisos efectivos { modulo: { accion: alcance } }. */
async function perfilSesion(s: Session, user: CurrentUser) {
  const auth = await cargarAutorizacion(s, user, { permitirCambioPendiente: true });
  const row = await s.queryOne<{ nombre: string; email: string; avatar: string | null; tema: string | null; foto: string | null; usa_foto: number | null }>("SELECT nombre, email, avatar, tema, foto, usa_foto FROM usuarios WHERE id = :id", { id: auth.userId });
  const roles = auth.roles.map((r) => ({ id: r.id, nombre: r.nombre, clave: r.clave, vigente_desde: r.vigente_desde, vigente_hasta: r.vigente_hasta ?? null, permisos: mapaPermisos(expandirPermisos(r.filas)) }));
  return {
    user: {
      id: auth.userId,
      nombre: row?.nombre ?? user.nombre,
      email: row?.email ?? user.email,
      avatar: row?.avatar ?? null,
      tema: TEMAS.has(String(row?.tema)) ? String(row?.tema) : "auto",
      // Foto de perfil: version de la guardada (aunque se muestre la figura) y si se muestra.
      foto: versionFoto(row?.foto),
      usa_foto: !!Number(row?.usa_foto) && !!row?.foto,
      roles: roles.map((r) => r.nombre),
      tipo_cuenta: auth.cuenta.tipo_cuenta,
      vigente_hasta: auth.cuenta.vigente_hasta,
      supervisor_id: auth.cuenta.supervisor_id,
      cargo_predeterminado: auth.cuenta.cargo_predeterminado,
      debe_cambiar_password: auth.cuenta.debe_cambiar_password,
    },
    roles,
    permissions: mapaPermisos(auth.efectivos),
    sesion: { inactividad_min: getConfig().SESION_INACTIVIDAD_MIN, expira_horas: getConfig().JWT_EXPIRES_HOURS },
  };
}

/* Configuracion publica del acceso: solo usuario y contrasena del sistema (Fase 3). */
export async function authConfig(): Promise<Response> {
  const config = getConfig();
  return json({
    dominios_permitidos: config.ALLOWED_EMAIL_DOMAINS,
    sesion: { inactividad_min: config.SESION_INACTIVIDAD_MIN, expira_horas: config.JWT_EXPIRES_HOURS },
  });
}

export async function loginWithEmail({ request, s }: RouteContext): Promise<Response> {
  const payload = await readJson(request);
  const email = String(payload.email || "").trim().toLowerCase();
  const password = String(payload.password || "");

  if (!email) {
    return json({ message: "El correo es obligatorio" }, 400);
  }
  if (!password) {
    return json({ message: "La contraseña es obligatoria" }, 400);
  }

  let row: Row | null;
  try {
    row = await getUserByEmail(s, email);
  } catch (error) {
    if (isOperationalError(error)) {
      return json({ message: "No se pudo conectar a la base de datos local. Revisa DATABASE_URL o el archivo SQLite." }, 503);
    }
    throw error;
  }

  // Fase 2: bloqueo por intentos fallidos (por cuenta y por IP). Mismo mensaje exista o no la cuenta.
  const ip = ipDe(request);
  const acceso = await estadoAcceso(s, email, ip);
  // Un intento rechazado por un bloqueo vigente no cuenta como fallo (ni de la cuenta ni de la IP):
  // asi un bloqueo de IP no bloquea cuentas ajenas ni se prolonga mientras alguien siga intentando.
  if (acceso.ipBloqueada) {
    return json({ message: `Demasiados intentos fallidos desde este equipo; espera ${getConfig().LOGIN_BLOQUEO_MIN} minutos`, codigo: "ip_bloqueada" }, 429);
  }
  if (acceso.bloqueadaHasta) {
    // Cuenta bloqueada: ni siquiera se compara la contrasena; mismo mensaje que un fallo.
    return json({ message: MENSAJE_ACCESO_FALLIDO }, 401);
  }
  if (!row || !verifyPassword(password, row.password_hash as string | null)) {
    // Los intentos fallidos quedan en la bitacora (ISO/IEC 17025 7.11.1).
    await registrarIntento(s, { email, ip, tipo: "login", exito: false, usuario: row });
    await s.commit();
    return json({ message: MENSAJE_ACCESO_FALLIDO }, 401);
  }
  await registrarIntento(s, { email, ip, tipo: "login", exito: true, usuario: row });
  await registrarAuditoria(s, { sub: String(row.id), nombre: String(row.nombre || ""), email: String(row.email || "") }, { accion: "login", entidad: "sesion", entidadId: row.id as number, referencia: email.slice(0, 160) });
  return issueSession(s, row);
}

export async function me({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  // Nombre, avatar, roles y permisos se leen de la base (no del token) para reflejar cambios sin volver a entrar.
  return json(await perfilSesion(s, user));
}

/*
 * Personal activo con lo que puede hacer, para los selectores de "quién" de los
 * formatos (cualquier usuario autenticado puede verlo; no expone correos ni claves).
 */
export async function personal({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await cargarAutorizacion(s, user);
  const usuarios = (await s.query<Row>("SELECT id, nombre, vigente_desde, vigente_hasta FROM usuarios WHERE COALESCE(activo, 1) = 1 ORDER BY nombre")).filter((u) => cuentaVigente(u));
  const asignaciones = await s.query<Row>(
    `
    SELECT ur.usuario_id, r.id AS rol_id, r.nombre
    FROM usuario_roles ur INNER JOIN roles r ON r.id = ur.rol_id
    WHERE ur.revocado_en IS NULL AND ur.vigente_desde <= :hoy AND (ur.vigente_hasta IS NULL OR ur.vigente_hasta >= :hoy) AND r.activo = 1
    `,
    { hoy: hoy() },
  );
  const filasRol = await filasDeRoles(s, asignaciones.map((a) => Number(a.rol_id)));
  const items = usuarios.map((row) => {
    const propias = asignaciones.filter((a) => Number(a.usuario_id) === Number(row.id));
    const efectivos = expandirPermisos(propias.flatMap((a) => filasRol.get(Number(a.rol_id)) || []));
    type Par = [Parameters<typeof permite>[1], Parameters<typeof permite>[2]];
    const CAPACIDADES: Record<string, Par[]> = {
      muestras: [["muestras", "C"], ["muestras", "E"], ["ensayos", "C"], ["ensayos", "E"]],
      revision: [["ensayos", "R"], ["ensayos", "A"], ["informes", "R"], ["informes", "A"]],
      informes: [["informes", "C"], ["informes", "E"]],
      inventario: [["inventario", "C"], ["inventario", "E"], ["equipos", "C"], ["equipos", "E"]],
    };
    const puede: Record<string, boolean> = {};
    // Cargo con el que figura la persona para cada capacidad: el primer rol (por nombre) que la otorga.
    const cargos: Record<string, string | null> = {};
    for (const [capacidad, pares] of Object.entries(CAPACIDADES)) {
      puede[capacidad] = pares.some(([modulo, accion]) => permite(efectivos, modulo, accion));
      const rol = propias
        .map((a) => ({ nombre: String(a.nombre), filas: filasRol.get(Number(a.rol_id)) || [] }))
        .sort((x, y) => x.nombre.localeCompare(y.nombre))
        .find((r) => pares.some(([modulo, accion]) => permite(expandirPermisos(r.filas), modulo, accion)));
      cargos[capacidad] = rol?.nombre ?? null;
    }
    return {
      id: Number(row.id),
      nombre: String(row.nombre || ""),
      rol: propias.map((a) => String(a.nombre)).join(", ") || null,
      roles: propias.map((a) => String(a.nombre)),
      puede,
      cargos,
    };
  });
  return json({ items });
}

const TEMAS = new Set(["claro", "oscuro", "auto"]);

/*
 * Apariencia (Claro, Oscuro o Automatico) de la propia cuenta, para que la
 * siga en cualquier computadora. Es una preferencia visual: no se registra en
 * la bitacora.
 */
export async function updateMyTema({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await cargarAutorizacion(s, user, { permitirCambioPendiente: true });
  const payload = await readJson(request);
  const tema = String(payload.tema || "");
  if (!TEMAS.has(tema)) return json({ message: "Apariencia no reconocida" }, 400);
  await s.execute("UPDATE usuarios SET tema = :tema WHERE id = :id", { tema, id: Number(user.sub) });
  await s.commit();
  return json({ message: "Apariencia guardada", tema });
}

/* La persona elige su avatar del catalogo (o vuelve al de omision con null). Queda en la bitacora. */
export async function updateMyAvatar({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await cargarAutorizacion(s, user, { permitirCambioPendiente: true });
  const payload = await readJson(request);
  const avatar = payload.avatar === null || payload.avatar === "" ? null : payload.avatar;
  if (avatar !== null && !isAvatarKey(avatar)) return json({ message: "Avatar no reconocido" }, 400);
  const id = Number(user.sub);
  const antes = await s.queryOne<{ avatar: string | null }>("SELECT avatar FROM usuarios WHERE id = :id", { id });
  if (!antes) return json({ message: "Usuario no encontrado" }, 404);
  await s.execute("UPDATE usuarios SET avatar = :avatar WHERE id = :id", { avatar, id });
  await registrarAuditoria(s, user, { accion: "editar", entidad: "usuarios", entidadId: id, referencia: String(user.email || ""), detalle: { avatar: { antes: antes.avatar || null, despues: avatar } } });
  await s.commit();
  return json({ message: "Avatar actualizado", avatar });
}

/* ---------- Fase 2: reautenticacion, contrasena, sesiones y cargo ---------- */

/*
 * Reautenticacion para una accion critica: la contrasena del sistema. Devuelve
 * un token de un solo uso ligado a la persona y a la accion. Los fallos cuentan
 * para el bloqueo de la cuenta.
 */
export async function reautenticar({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const auth = await cargarAutorizacion(s, user);
  const payload = await readJson(request);
  const accion = String(payload.accion || "").trim().slice(0, 60);
  if (!/^[a-z_]+:[A-Za-z_]+$/.test(accion)) return json({ message: "Indica la acción que vas a confirmar" }, 400);
  const row = await s.queryOne<Row>(USER_QUERY, { email: auth.cuenta.email });
  const ip = ipDe(request);
  const valido = verifyPassword(String(payload.password || ""), (row?.password_hash as string | null) || null);
  if (!valido) {
    const bloqueo = await registrarIntento(s, { email: auth.cuenta.email, ip, tipo: "reauth", exito: false, usuario: row });
    await s.commit();
    return json({ message: bloqueo ? "Demasiados intentos fallidos: tu cuenta quedó bloqueada temporalmente" : "La contraseña no es correcta", codigo: bloqueo ? "cuenta_bloqueada" : "reauth_fallida" }, 401);
  }
  const emitido = await emitirReauth(s, auth.userId, accion);
  await s.commit();
  return json({ token: emitido.token, accion, expira_en: emitido.expira_en });
}

/* Cambio de contrasena propio (pide la actual). Cierra las demas sesiones y devuelve un token nuevo. */
export async function cambiarPassword({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const auth = await cargarAutorizacion(s, user, { permitirCambioPendiente: true });
  const payload = await readJson(request);
  const row = await s.queryOne<Row>(USER_QUERY, { email: auth.cuenta.email });
  if (!row?.password_hash) return json({ message: "Tu cuenta no tiene contraseña definida; pide a la administración que la restablezca" }, 400);
  const actual = String(payload.actual || "");
  const nueva = String(payload.nueva || "");
  if (!verifyPassword(actual, row.password_hash as string)) {
    const bloqueo = await registrarIntento(s, { email: auth.cuenta.email, ip: ipDe(request), tipo: "reauth", exito: false, usuario: row });
    await s.commit();
    return json({ message: bloqueo ? "Demasiados intentos fallidos: tu cuenta quedó bloqueada temporalmente" : "La contraseña actual no es correcta" }, 401);
  }
  const debil = validatePasswordStrength(nueva, { email: auth.cuenta.email, nombre: auth.cuenta.nombre });
  if (debil) return json({ message: debil }, 400);
  if (nueva === actual) return json({ message: "La contraseña nueva debe ser distinta de la actual" }, 400);
  await s.execute("UPDATE usuarios SET password_hash = :hash, debe_cambiar_password = 0, token_version = COALESCE(token_version, 0) + 1 WHERE id = :id", { hash: hashPassword(nueva), id: auth.userId });
  // Nunca se guardan contrasenas ni hashes en la bitacora.
  await registrarAuditoria(s, user, { accion: "cambiar_password", entidad: "usuarios", entidadId: auth.userId, referencia: auth.cuenta.email, detalle: { otras_sesiones: "cerradas" } });
  await s.commit();
  const fila = await s.queryOne<Row>(USER_QUERY, { email: auth.cuenta.email });
  return issueSession(s, fila as Row);
}

/* Cerrar sesion en todos los dispositivos: invalida todos los tokens emitidos (incluido el actual). */
export async function cerrarSesiones({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const auth = await cargarAutorizacion(s, user, { permitirCambioPendiente: true });
  await s.execute("UPDATE usuarios SET token_version = COALESCE(token_version, 0) + 1 WHERE id = :id", { id: auth.userId });
  await registrarAuditoria(s, user, { accion: "cerrar_sesiones", entidad: "usuarios", entidadId: auth.userId, referencia: auth.cuenta.email });
  await s.commit();
  return json({ message: "Se cerró tu sesión en todos los dispositivos" });
}

/* Cargo predeterminado: rol vigente con el que actua cuando varios permiten la accion (null = preguntar siempre). */
export async function fijarCargoPredeterminado({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const auth = await cargarAutorizacion(s, user);
  const payload = await readJson(request);
  const rolId = payload.rol_id === null || payload.rol_id === "" || payload.rol_id === undefined ? null : Number.parseInt(String(payload.rol_id), 10);
  if (rolId !== null && !auth.roles.some((r) => r.id === rolId)) return json({ message: "Elige uno de tus roles vigentes" }, 400);
  const antes = auth.cuenta.cargo_predeterminado;
  await s.execute("UPDATE usuarios SET cargo_predeterminado = :rol WHERE id = :id", { rol: rolId, id: auth.userId });
  await registrarAuditoria(s, user, {
    accion: "cambiar_cargo",
    entidad: "usuarios",
    entidadId: auth.userId,
    referencia: auth.cuenta.email,
    detalle: { antes: auth.roles.find((r) => r.id === antes)?.nombre ?? null, despues: auth.roles.find((r) => r.id === rolId)?.nombre ?? null },
  });
  await s.commit();
  return json({ message: "Cargo predeterminado guardado", cargo_predeterminado: rolId });
}

