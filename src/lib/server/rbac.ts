import { type Row, type Session } from "./db";
import { finDiaLocal, hoyLocal, inicioDiaLocal } from "../shared/fechas";

import { HttpError } from "./http";
import type { CurrentUser } from "./auth";
import { registrarAuditoria } from "./audit";
import { evaluarCombinacion, type RolEvaluado, type Violacion } from "../shared/combinaciones-roles";
import { accionDeModulo, esTotal, expandirPermisos, isAlcance, isModulo, MODULO_DOCUMENTAL, alcancePermite, permite, type Accion, type Alcance, type ContextoAlcance, type Modulo, type PermisoFila, type PermisosEfectivos } from "../shared/permisos";

/*
 * Control de acceso por rol (Fase 1; FX-MO-2-1).
 *
 * - Un permiso es (rol, modulo, accion, alcance) en la tabla `rol_acciones`
 *   (modelo en src/lib/shared/permisos.ts).
 * - Una persona puede tener varios roles con vigencia (`usuario_roles`); sus
 *   permisos efectivos son la union de los roles vigentes hoy (no revocados,
 *   dentro de su vigencia, rol activo) y se calculan en cada peticion desde la
 *   base: el JWT solo identifica a la persona, asi que revocar o vencer un rol
 *   tiene efecto inmediato.
 * - El arranque no crea roles ni concede permisos: un permiso ausente es "no
 *   concedido". Los roles del catalogo se dan de alta con
 *   scripts/seed-roles-usuarios.mjs (scripts/roles-catalogo.json).
 * - `usuarios.id_rol` y `rol_permisos` son del modelo anterior: se conservan
 *   (la columna id_rol guarda el rol con el que se dio de alta la cuenta) pero
 *   ya no se leen para decidir permisos.
 */

export function toBit(value: unknown): number {
  return value ? 1 : 0;
}

/* Fecha local YYYY-MM-DD: la vigencia de los roles se mide por dia. */
/*
 * Limites en UTC (como se guarda fecha_hora) de un dia local "AAAA-MM-DD": los
 * filtros por fecha de la bitacora y de la revision de accesos comparan el dia
 * local del laboratorio, no el dia UTC.
 */
export { inicioDiaLocal, finDiaLocal };

/* Hoy en la zona del laboratorio (America/Tijuana), sin importar la zona del servidor (Fase 3). */
export function hoy(): string {
  return hoyLocal();
}

/* ---------- Roles y permisos de un rol ---------- */

export interface RolVigente extends RolEvaluado {
  asignacion_id?: number;
  vigente_desde?: string;
  vigente_hasta?: string | null;
}

export async function filasDeRoles(s: Session, roleIds: number[]): Promise<Map<number, PermisoFila[]>> {
  const out = new Map<number, PermisoFila[]>();
  if (!roleIds.length) return out;
  const ids = [...new Set(roleIds)];
  const placeholders = ids.map((_, i) => `:r${i}`).join(", ");
  const rows = await s.query<{ id_rol: number; modulo: string; accion: string; alcance: string }>(
    `SELECT id_rol, modulo, accion, alcance FROM rol_acciones WHERE id_rol IN (${placeholders})`,
    Object.fromEntries(ids.map((id, i) => [`r${i}`, id])),
  );
  for (const id of ids) out.set(id, []);
  for (const row of rows) out.get(Number(row.id_rol))?.push({ modulo: String(row.modulo), accion: String(row.accion), alcance: String(row.alcance) });
  return out;
}

/* Filas validas de una matriz enviada por la pantalla de roles: [{ modulo, accion, alcance }]. */
export function normalizarFilas(value: unknown): PermisoFila[] {
  const out: PermisoFila[] = [];
  const vistas = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    if (!item || typeof item !== "object") continue;
    const { modulo, accion, alcance } = item as Record<string, unknown>;
    if (!isModulo(modulo) || !accionDeModulo(modulo, accion)) continue;
    // Las acciones documentales no tienen alcance (siempre "total").
    const fila = { modulo, accion: accion as Accion, alcance: modulo === MODULO_DOCUMENTAL ? "total" : isAlcance(alcance) ? alcance : "total" };
    const clave = `${fila.modulo}:${fila.accion}:${fila.alcance}`;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    out.push(fila);
  }
  return out;
}

export async function guardarFilasRol(s: Session, roleId: number, filas: PermisoFila[]): Promise<void> {
  await s.execute("DELETE FROM rol_acciones WHERE id_rol = :id", { id: roleId });
  for (const fila of filas) {
    await s.execute("INSERT INTO rol_acciones (id_rol, modulo, accion, alcance) VALUES (:id, :modulo, :accion, :alcance)", { id: roleId, ...fila });
  }
}

const VIGENTE_SQL = `ur.revocado_en IS NULL AND ur.vigente_desde <= :hoy AND (ur.vigente_hasta IS NULL OR ur.vigente_hasta >= :hoy) AND r.activo = 1`;

/* Roles vigentes hoy de una persona (con sus filas de permiso). */
export async function rolesVigentes(s: Session, userId: number): Promise<RolVigente[]> {
  const rows = await s.query<Row>(
    `
    SELECT ur.id AS asignacion_id, ur.vigente_desde, ur.vigente_hasta, r.id, r.nombre, r.clave
    FROM usuario_roles ur
    INNER JOIN roles r ON r.id = ur.rol_id
    WHERE ur.usuario_id = :usuario_id AND ${VIGENTE_SQL}
    ORDER BY r.nombre
    `,
    { usuario_id: userId, hoy: hoy() },
  );
  const filas = await filasDeRoles(s, rows.map((row) => Number(row.id)));
  const vistos = new Set<number>();
  const out: RolVigente[] = [];
  for (const row of rows) {
    const id = Number(row.id);
    if (vistos.has(id)) continue;
    vistos.add(id);
    out.push({ id, nombre: String(row.nombre), clave: (row.clave as string | null) || null, filas: filas.get(id) || [], asignacion_id: Number(row.asignacion_id), vigente_desde: String(row.vigente_desde), vigente_hasta: (row.vigente_hasta as string | null) || null });
  }
  return out;
}

/* ---------- Autorizacion por peticion ---------- */

export interface Autorizacion {
  userId: number;
  roles: RolVigente[];
  efectivos: PermisosEfectivos;
  cuenta: CuentaSesion;
}

/* Datos de la cuenta que importan en cada peticion (Fase 2). */
interface CuentaSesion {
  email: string;
  nombre: string;
  tipo_cuenta: string;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  supervisor_id: number | null;
  cargo_predeterminado: number | null;
  debe_cambiar_password: boolean;
}

export const MENSAJE_CUENTA_NO_VIGENTE = "Tu acceso no está vigente; contacta al administrador";

/* ¿La cuenta esta dentro de su vigencia hoy? */
export function cuentaVigente(fila: { vigente_desde?: unknown; vigente_hasta?: unknown }, fecha = hoy()): boolean {
  const desde = fila.vigente_desde ? String(fila.vigente_desde) : null;
  const hasta = fila.vigente_hasta ? String(fila.vigente_hasta) : null;
  return (!desde || desde <= fecha) && (!hasta || hasta >= fecha);
}

/* Carga la persona (debe existir y estar activa) y sus permisos efectivos desde la base. */
/*
 * Valida la sesion en cada peticion (Fase 2): la cuenta existe, esta activa y
 * dentro de su vigencia, y el token no fue revocado (token_version). Si la
 * persona debe cambiar su contrasena, solo se permiten las rutas que lo
 * resuelven (opcion permitirCambioPendiente).
 */
export async function cargarAutorizacion(s: Session, user: CurrentUser | null, opciones: { permitirCambioPendiente?: boolean } = {}): Promise<Autorizacion> {
  if (!user) throw new HttpError(401, { message: "Token requerido" });
  const userId = Number.parseInt(String(user.sub || ""), 10);
  if (!Number.isFinite(userId)) throw new HttpError(401, { message: "Token invalido" });
  const fila = await s.queryOne<Row>(
    "SELECT email, nombre, activo, tipo_cuenta, vigente_desde, vigente_hasta, supervisor_id, cargo_predeterminado, debe_cambiar_password, token_version FROM usuarios WHERE id = :id",
    { id: userId },
  );
  if (!fila) throw new HttpError(401, { message: "La cuenta ya no existe", codigo: "sesion_revocada" });
  if (fila.activo !== null && fila.activo !== undefined && !Number(fila.activo)) throw new HttpError(401, { message: "Usuario inactivo", codigo: "sesion_revocada" });
  if (Number(user.tv ?? 0) !== Number(fila.token_version ?? 0)) throw new HttpError(401, { message: "Tu sesión se cerró (cambio de contraseña, bloqueo o cierre en todos los dispositivos); vuelve a iniciar sesión", codigo: "sesion_revocada" });
  // Sesion cerrada en el servidor (salir o cierre por inactividad): el token queda revocado por su jti.
  if (user.jti && (await s.scalar("SELECT 1 FROM sesiones_revocadas WHERE jti = :jti", { jti: String(user.jti) }))) throw new HttpError(401, { message: "Tu sesión se cerró; vuelve a iniciar sesión", codigo: "sesion_revocada" });
  if (!cuentaVigente(fila)) throw new HttpError(401, { message: MENSAJE_CUENTA_NO_VIGENTE, codigo: "cuenta_no_vigente" });
  const debeCambiar = !!Number(fila.debe_cambiar_password || 0);
  if (debeCambiar && !opciones.permitirCambioPendiente) throw new HttpError(403, { message: "Debes cambiar tu contraseña antes de continuar", codigo: "cambiar_password" });
  const roles = await rolesVigentes(s, userId);
  return {
    userId,
    roles,
    efectivos: expandirPermisos(roles.flatMap((r) => r.filas)),
    cuenta: {
      email: String(fila.email || ""),
      nombre: String(fila.nombre || ""),
      tipo_cuenta: String(fila.tipo_cuenta || "permanente"),
      vigente_desde: (fila.vigente_desde as string | null) || null,
      vigente_hasta: (fila.vigente_hasta as string | null) || null,
      supervisor_id: fila.supervisor_id === null || fila.supervisor_id === undefined ? null : Number(fila.supervisor_id),
      cargo_predeterminado: fila.cargo_predeterminado === null || fila.cargo_predeterminado === undefined ? null : Number(fila.cargo_predeterminado),
      debe_cambiar_password: debeCambiar,
    },
  };
}

/*
 * Para rutas que solo necesitan una sesion valida (sin permiso de modulo): token
 * vigente, no revocado (token_version o jti) y cuenta activa y en vigencia.
 * No exige haber cambiado la contrasena temporal.
 */
export async function exigirSesionVigente(s: Session, user: CurrentUser | null): Promise<Autorizacion> {
  return cargarAutorizacion(s, user, { permitirCambioPendiente: true });
}

export interface Permiso {
  modulo: Modulo;
  accion: Accion;
  alcances: Alcance[];
  /* Equivale a "total" (total o diferido). */
  total: boolean;
  /* Roles vigentes que otorgan la accion en este contexto (para el cargo con que se actua). */
  candidatos: RolVigente[];
  auth: Autorizacion;
  /* Contexto con que se evaluo (para saber si solo lo cubre el alcance "supervisado"). */
  ctx?: ContextoAlcance;
}

export function permisoDe(auth: Autorizacion, modulo: Modulo, accion: Accion, ctx?: ContextoAlcance): Permiso | null {
  if (!permite(auth.efectivos, modulo, accion, ctx)) return null;
  const alcances = auth.efectivos[modulo]?.[accion] || [];
  const candidatos = auth.roles.filter((rol) => permite(expandirPermisos(rol.filas), modulo, accion, ctx));
  return { modulo, accion, alcances, total: esTotal(alcances), candidatos, auth, ctx };
}

/*
 * Exige (modulo, accion) y, si se da, el contexto del alcance. 403 si ningun
 * rol vigente lo otorga. Devuelve los alcances y los roles que lo otorgan.
 */
export async function requirePermission(s: Session, user: CurrentUser | null, modulo: Modulo, accion: Accion, ctx?: ContextoAlcance, auth?: Autorizacion): Promise<Permiso> {
  const autorizacion = auth || (await cargarAutorizacion(s, user));
  const permiso = permisoDe(autorizacion, modulo, accion, ctx);
  if (!permiso) {
    const conAlcance = ctx && permite(autorizacion.efectivos, modulo, accion);
    throw new HttpError(403, {
      message: conAlcance ? `Tu alcance en ${modulo}:${accion} no cubre esta operación` : `Permiso denegado para ${modulo}:${accion}`,
      required: { module: modulo, action: accion },
    });
  }
  return permiso;
}

/*
 * ¿La operacion solo esta cubierta por el alcance "supervisado"? Entonces lo
 * que se crea o edita queda pendiente del visto bueno del supervisor (Fase 2).
 */
export function soloSupervisado(permiso: Permiso): boolean {
  const cubren = permiso.alcances.filter((a) => alcancePermite(a, permiso.ctx || {}));
  return cubren.length > 0 && cubren.every((a) => a === "supervisado");
}

/* V de muestras solo con alcance "estado": la API omite datos tecnicos, resultados y firmas. */
export function soloEstado(permiso: Permiso): boolean {
  return !permiso.total && permiso.alcances.length > 0 && permiso.alcances.every((a) => a === "estado");
}

/*
 * Cargo con el que actua quien firma, revisa, aprueba, autoriza o anula: si un
 * solo rol vigente otorga el permiso se usa ese; si varios, la interfaz debe
 * mandar el elegido en el encabezado `X-Actuar-Como` (id del rol) y aqui se
 * valida que ese rol realmente lo otorgue. Si falta la eleccion: 409 con las
 * opciones (codigo ELEGIR_CARGO).
 */
export function cargoActuante(request: Request, permiso: Permiso): { rol_id: number; cargo: string } {
  const opciones = permiso.candidatos;
  const elegido = Number.parseInt(request.headers.get("x-actuar-como") || "", 10);
  if (Number.isFinite(elegido)) {
    const rol = opciones.find((r) => r.id === elegido);
    if (!rol) throw new HttpError(403, { message: "El rol elegido para actuar no otorga este permiso", codigo: "CARGO_INVALIDO" });
    return { rol_id: rol.id, cargo: rol.nombre };
  }
  if (opciones.length === 1) return { rol_id: opciones[0].id, cargo: opciones[0].nombre };
  // Fase 2: si su cargo predeterminado otorga el permiso, se usa sin preguntar.
  const predeterminado = opciones.find((r) => r.id === permiso.auth.cuenta.cargo_predeterminado);
  if (predeterminado) return { rol_id: predeterminado.id, cargo: predeterminado.nombre };
  throw new HttpError(409, {
    message: "Tienes varios roles que permiten esta acción: elige con qué cargo actúas",
    codigo: "ELEGIR_CARGO",
    opciones: opciones.map((r) => ({ rol_id: r.id, nombre: r.nombre })),
  });
}

/*
 * Recorta un resumen: los campos de modulos que la persona no puede ver quedan
 * en null (el Inicio lo ve toda persona activa; sus datos, segun permisos).
 */
export function recortarPorModulo<T extends Record<string, unknown>>(auth: Autorizacion, datos: T, campos: Record<string, Modulo>): T {
  const out: Record<string, unknown> = { ...datos };
  for (const [campo, modulo] of Object.entries(campos)) if (!permisoDe(auth, modulo, "V")) out[campo] = null;
  return out as T;
}

/* ---------- Guarda: siempre queda un administrador ---------- */

/*
 * Administradores: usuarios activos con usuarios:G (total) otorgado por un rol
 * vigente hoy. `permanentes` son los que lo tienen por una asignacion sin fecha
 * de fin (no se quedaran sin el permiso cuando venza una vigencia).
 */
export interface ConteoAdministradores {
  vigentes: number;
  permanentes: number;
  /* Fase 3: usuarios activos con usuarios:A vigente (aprueban los cambios de acceso). */
  aprobadores: number;
}

export async function countActiveAdministrators(s: Session): Promise<ConteoAdministradores> {
  const rows = await s.query<{ usuario_id: number; rol_id: number; vigente_hasta: string | null; cuenta_hasta: string | null; tipo_cuenta: string | null }>(
    `
    SELECT ur.usuario_id, ur.rol_id, ur.vigente_hasta, u.vigente_hasta AS cuenta_hasta, u.tipo_cuenta
    FROM usuario_roles ur
    INNER JOIN roles r ON r.id = ur.rol_id
    INNER JOIN usuarios u ON u.id = ur.usuario_id
    WHERE COALESCE(u.activo, 1) = 1 AND ${VIGENTE_SQL}
      AND (u.vigente_desde IS NULL OR u.vigente_desde <= :hoy)
      AND (u.vigente_hasta IS NULL OR u.vigente_hasta >= :hoy)
    `,
    { hoy: hoy() },
  );
  const filas = await filasDeRoles(s, rows.map((r) => Number(r.rol_id)));
  const vigentes = new Set<number>();
  const permanentes = new Set<number>();
  const aprobadores = new Set<number>();
  for (const row of rows) {
    const efectivos = expandirPermisos(filas.get(Number(row.rol_id)) || []);
    if (esTotal(efectivos.usuarios?.A)) aprobadores.add(Number(row.usuario_id));
    if (!esTotal(efectivos.usuarios?.G)) continue;
    vigentes.add(Number(row.usuario_id));
    // Permanente: ni el rol ni la cuenta tienen fecha de fin.
    if (!row.vigente_hasta && !row.cuenta_hasta && String(row.tipo_cuenta || "permanente") !== "temporal") permanentes.add(Number(row.usuario_id));
  }
  return { vigentes: vigentes.size, permanentes: permanentes.size, aprobadores: aprobadores.size };
}

/*
 * Se llama antes del commit de un cambio sobre usuarios, roles o asignaciones,
 * con el conteo tomado antes del cambio. Se rechaza (apiRoute hace rollback) si
 * el cambio deja el sistema sin administradores o si solo quedan administradores
 * con fecha de fin (al vencer, nadie podria administrar usuarios y roles).
 */
export async function assertAdministratorRemains(s: Session, before: ConteoAdministradores): Promise<void> {
  const after = await countActiveAdministrators(s);
  if (before.vigentes > 0 && after.vigentes === 0) {
    throw new HttpError(409, {
      message: "El cambio dejaria el sistema sin ningun usuario activo con permiso de administrar usuarios y roles (usuarios:G vigente)",
    });
  }
  if (before.permanentes > 0 && after.permanentes === 0) {
    throw new HttpError(409, {
      message: "El cambio dejaria solo administradores con fecha de fin de vigencia: al vencer, nadie podria administrar usuarios y roles. Debe quedar al menos una persona activa con usuarios:G sin fecha de fin",
    });
  }
  // Fase 3: sin nadie con usuarios:A nadie podria aprobar asignaciones de rol, reactivaciones ni ampliaciones.
  if (before.aprobadores > 0 && after.aprobadores === 0) {
    throw new HttpError(409, {
      message: "El cambio dejaria el sistema sin ningun usuario activo con permiso de aprobar cambios de acceso (usuarios:A vigente)",
    });
  }
}

/* ---------- Combinaciones prohibidas ---------- */

/* Roles no revocados ni vencidos (vigentes o por comenzar) de una persona. */
export async function rolesComprometidos(s: Session, userId: number, excluirAsignacion?: number): Promise<RolEvaluado[]> {
  const rows = await s.query<Row>(
    `
    SELECT DISTINCT r.id, r.nombre, r.clave
    FROM usuario_roles ur
    INNER JOIN roles r ON r.id = ur.rol_id
    WHERE ur.usuario_id = :usuario_id
      AND ur.revocado_en IS NULL
      AND (ur.vigente_hasta IS NULL OR ur.vigente_hasta >= :hoy)
      AND r.activo = 1
      AND ur.id <> :excluir
    `,
    { usuario_id: userId, hoy: hoy(), excluir: excluirAsignacion || 0 },
  );
  const filas = await filasDeRoles(s, rows.map((r) => Number(r.id)));
  return rows.map((row) => ({ id: Number(row.id), nombre: String(row.nombre), clave: (row.clave as string | null) || null, filas: filas.get(Number(row.id)) || [] }));
}

export function mensajeViolaciones(violaciones: Violacion[]): string {
  return violaciones.map((v) => `Regla ${v.regla} (${v.titulo}): ${v.mensaje}`).join(" ");
}

/*
 * Personas que quedarian con una combinacion prohibida si el rol `roleId`
 * tuviera `filas` (y estuviera activo o no). Para rechazar la edicion de un rol.
 */
export async function afectadosPorCambioDeRol(s: Session, roleId: number, filas: PermisoFila[], activo: boolean, clave: string | null, nombre: string): Promise<Array<{ usuario_id: number; email: string; violaciones: Violacion[] }>> {
  const usuarios = await s.query<{ usuario_id: number; email: string }>(
    `
    SELECT DISTINCT ur.usuario_id, u.email
    FROM usuario_roles ur
    INNER JOIN usuarios u ON u.id = ur.usuario_id
    WHERE ur.rol_id = :rol_id AND ur.revocado_en IS NULL AND (ur.vigente_hasta IS NULL OR ur.vigente_hasta >= :hoy)
    `,
    { rol_id: roleId, hoy: hoy() },
  );
  const out = [];
  for (const u of usuarios) {
    const otros = (await rolesComprometidos(s, Number(u.usuario_id))).filter((r) => r.id !== roleId);
    const conjunto = activo ? [...otros, { id: roleId, nombre, clave, filas }] : otros;
    const violaciones = evaluarCombinacion(conjunto);
    if (violaciones.length) out.push({ usuario_id: Number(u.usuario_id), email: String(u.email), violaciones });
  }
  return out;
}

/* ---------- Vencimientos ---------- */

/*
 * Registra en la bitacora cada asignacion cuya vigencia ya termino (una sola
 * vez por asignacion). La vigencia se aplica sola al calcular permisos; esto
 * solo deja el rastro.
 */
export async function registrarVencimientos(s: Session): Promise<number> {
  const vencidas = await s.query<Row>(
    `
    SELECT ur.id, ur.usuario_id, ur.rol_id, ur.vigente_desde, ur.vigente_hasta, r.nombre AS rol, u.email
    FROM usuario_roles ur
    LEFT JOIN roles r ON r.id = ur.rol_id
    LEFT JOIN usuarios u ON u.id = ur.usuario_id
    WHERE ur.revocado_en IS NULL AND ur.vencimiento_registrado_en IS NULL
      AND ur.vigente_hasta IS NOT NULL AND ur.vigente_hasta < :hoy
    `,
    { hoy: hoy() },
  );
  for (const fila of vencidas) {
    await s.execute("UPDATE usuario_roles SET vencimiento_registrado_en = :fecha WHERE id = :id", { fecha: new Date().toISOString(), id: fila.id });
    await registrarAuditoria(s, null, {
      accion: "vencer_rol",
      entidad: "usuarios",
      entidadId: Number(fila.usuario_id),
      referencia: String(fila.email || fila.usuario_id),
      motivo: `Terminó la vigencia (${fila.vigente_hasta})`,
      detalle: { rol: fila.rol, rol_id: fila.rol_id, asignacion_id: fila.id, vigente_desde: fila.vigente_desde, vigente_hasta: fila.vigente_hasta },
    });
  }
  return vencidas.length;
}
