import { randomAvatar } from "../../shared/avatars";
import { evaluarCombinacion } from "../../shared/combinaciones-roles";
import { ACCIONES, ALCANCES, MODULOS, expandirPermisos, firmaFilas, permite } from "../../shared/permisos";
import { requireUser, userIdFromClaims, type CurrentUser } from "../auth";
import { registrarAuditoria, snapshotRow } from "../audit";
import { getConfig } from "../config";
import { isIntegrityError, type Row, type Session } from "../db";
import { HttpError, intParam, json, readJson, type RouteContext } from "../http";
import { afectadosPorCambioDeRol, assertAdministratorRemains, countActiveAdministrators, cuentaVigente, filasDeRoles, guardarFilasRol, hoy, mensajeViolaciones, normalizarFilas, requirePermission, rolesComprometidos, rolesVigentes, toBit, type Permiso } from "../rbac";
import { normalizeUserPayload } from "../users";
import { hashPassword, validatePasswordStrength } from "../password";
import { exigirReauth } from "../seguridad";
import { crearSolicitud, datosDe, detalleSolicitud, pendientesDe, respuestaSolicitud, serializarSolicitud, type ContextoEjecucion, type Solicitud } from "../solicitudes";
import { ACCIONES_CRITICAS } from "../../shared/acciones-criticas";
import { sumarDias } from "../../shared/fechas";
import { randomBytes } from "node:crypto";

/*
 * Usuarios y roles (modulo "usuarios", Fase 1):
 * - usuarios:V ve cuentas y roles (alcance "propio": solo su cuenta).
 * - usuarios:G da de alta, edita y da de baja cuentas, configura roles y asigna
 *   o revoca roles.
 * Toda asignacion, revocacion y cambio de permisos queda en la bitacora con motivo.
 */

const MOTIVO_MIN = 5;

/* Dominios de correo admitidos (ALLOWED_EMAIL_DOMAINS); lista vacia = cualquiera. */
function emailDomainAllowed(email: string): boolean {
  const dominios = getConfig().ALLOWED_EMAIL_DOMAINS;
  if (!email) return false;
  if (!dominios.length) return true;
  return dominios.some((d) => email.toLowerCase().endsWith(`@${d}`));
}

function domainErrorMessage(): string {
  return `Solo puedes dar de alta correos de ${getConfig().ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(", ")}`;
}

function motivoDe(payload: Record<string, unknown>, campo = "motivo"): string {
  return String(payload[campo] || "").trim();
}

function exigirMotivo(motivo: string, que: string): void {
  if (motivo.length < MOTIVO_MIN) throw new HttpError(400, { message: `Indica el motivo ${que} (al menos ${MOTIVO_MIN} caracteres)` });
}

/* usuarios:V con alcance "propio" solo ve su propia cuenta (ni otras cuentas ni el catalogo de roles). */
function soloPropio(permiso: Permiso): boolean {
  return !permiso.total && permiso.alcances.every((a) => a === "propio");
}

function fechaValida(value: unknown): string | null {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

/* ---------- Catalogo ---------- */

export async function listPermissions({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await requirePermission(s, user, "usuarios", "V");
  return json({ modulos: MODULOS, acciones: ACCIONES, alcances: ALCANCES, items: MODULOS.map((m) => ({ clave: m.clave, nombre: m.nombre, descripcion: m.descripcion })) });
}

/* ---------- Roles ---------- */

async function rolesConConteo(s: Session): Promise<Row[]> {
  return s.query(
    `
    SELECT r.id, r.nombre, r.descripcion, r.clave, r.es_sistemico, r.activo,
           (SELECT COUNT(DISTINCT ur.usuario_id) FROM usuario_roles ur
             WHERE ur.rol_id = r.id AND ur.revocado_en IS NULL AND ur.vigente_desde <= :hoy AND (ur.vigente_hasta IS NULL OR ur.vigente_hasta >= :hoy)) AS total_usuarios
    FROM roles r
    ORDER BY r.id ASC
    `,
    { hoy: hoy() },
  );
}

export async function listRoles({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "usuarios", "V");
  if (soloPropio(permiso)) throw new HttpError(403, { message: "Tu alcance en usuarios es solo tu propia cuenta" });
  const rows = await rolesConConteo(s);
  const filas = await filasDeRoles(s, rows.map((r) => Number(r.id)));
  // Para la lista de Roles: las personas con el rol vigente hoy (nombre y figura de perfil; solo lectura).
  const personas = await s.query<Row>(
    `SELECT DISTINCT ur.rol_id, u.id, u.nombre, u.email, u.avatar FROM usuario_roles ur INNER JOIN usuarios u ON u.id = ur.usuario_id
     WHERE ur.revocado_en IS NULL AND ur.vigente_desde <= :hoy AND (ur.vigente_hasta IS NULL OR ur.vigente_hasta >= :hoy)
     ORDER BY u.nombre`,
    { hoy: hoy() },
  );
  const items = rows.map((row) => ({ ...row, permisos: filas.get(Number(row.id)) || [], personas: personas.filter((p) => Number(p.rol_id) === Number(row.id)).map((p) => ({ id: Number(p.id), nombre: p.nombre, email: p.email, avatar: p.avatar ?? null })) }));
  return json({ items, total: items.length });
}

export async function getRoleDetail({ request, s, params }: RouteContext): Promise<Response> {
  const roleId = intParam(params.id);
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "usuarios", "V");
  if (soloPropio(permiso)) throw new HttpError(403, { message: "Tu alcance en usuarios es solo tu propia cuenta" });
  const role = await s.queryOne("SELECT id, nombre, descripcion, clave, es_sistemico, activo FROM roles WHERE id = :id", { id: roleId });
  if (!role) return json({ message: "Rol no encontrado" }, 404);
  const permisos = (await filasDeRoles(s, [roleId])).get(roleId) || [];
  const usuarios = await s.query(
    `
    SELECT u.id, u.nombre, u.email, u.avatar, ur.vigente_desde, ur.vigente_hasta
    FROM usuario_roles ur INNER JOIN usuarios u ON u.id = ur.usuario_id
    WHERE ur.rol_id = :id AND ur.revocado_en IS NULL AND (ur.vigente_hasta IS NULL OR ur.vigente_hasta >= :hoy)
    ORDER BY u.nombre
    `,
    { id: roleId, hoy: hoy() },
  );
  return json({ role, permisos, usuarios });
}

function datosRol(payload: Record<string, unknown>) {
  return {
    nombre: String(payload.nombre || "").trim().slice(0, 100),
    descripcion: String(payload.descripcion || "").trim() || null,
    activo: toBit(payload.activo === undefined ? true : payload.activo),
    permisos: normalizarFilas(payload.permisos),
  };
}

export async function createRole({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await requirePermission(s, user, "usuarios", "G");
  const payload = await readJson(request);
  const data = datosRol(payload);
  if (!data.nombre) return json({ message: "El nombre del rol es obligatorio" }, 400);
  const motivo = motivoDe(payload) || "Alta de rol";
  if (await s.scalar("SELECT id FROM roles WHERE LOWER(nombre) = LOWER(:nombre) LIMIT 1", { nombre: data.nombre })) {
    return json({ message: "Ya existe un rol con ese nombre" }, 409);
  }
  const result = await s.execute("INSERT INTO roles (nombre, descripcion, es_sistemico, activo) VALUES (:nombre, :descripcion, 0, :activo)", {
    nombre: data.nombre,
    descripcion: data.descripcion,
    activo: data.activo,
  });
  const roleId = result.lastrowid as number;
  await guardarFilasRol(s, roleId, data.permisos);
  await registrarAuditoria(s, user, { accion: "crear", entidad: "roles", entidadId: roleId, referencia: data.nombre, motivo, despues: await snapshotRow(s, "roles", roleId), detalle: { permisos: data.permisos } });
  await s.commit();
  return json({ message: "Rol creado", id: roleId }, 201);
}

export async function updateRole({ request, s, params }: RouteContext): Promise<Response> {
  const roleId = intParam(params.id);
  const user = await requireUser(request);
  await requirePermission(s, user, "usuarios", "G");
  const antes = await snapshotRow(s, "roles", roleId);
  if (!antes) return json({ message: "Rol no encontrado" }, 404);
  const payload = await readJson(request);
  const data = datosRol(payload);
  if (!data.nombre) return json({ message: "El nombre del rol es obligatorio" }, 400);
  if (await s.scalar("SELECT id FROM roles WHERE LOWER(nombre) = LOWER(:nombre) AND id <> :id LIMIT 1", { nombre: data.nombre, id: roleId })) {
    return json({ message: "Ya existe un rol con ese nombre" }, 409);
  }
  const permisosAntes = (await filasDeRoles(s, [roleId])).get(roleId) || [];
  const cambiaPermisos = firmaFilas(permisosAntes) !== firmaFilas(data.permisos) || Number(antes.activo) !== data.activo;
  const motivo = motivoDe(payload);
  if (cambiaPermisos) exigirMotivo(motivo, "del cambio de permisos");
  // Fase 3.1: nadie cambia los permisos de un rol que el mismo tiene vigente.
  if (cambiaPermisos && (await rolesVigentes(s, userIdFromClaims(user) as number)).some((r) => Number(r.id) === roleId)) {
    return json({ message: "Tienes este rol vigente: sus permisos los debe cambiar otra persona", codigo: "rol_propio" }, 409);
  }

  // Combinaciones prohibidas: una edicion de permisos que las provoque en alguien se rechaza.
  const afectados = await afectadosPorCambioDeRol(s, roleId, data.permisos, !!data.activo, (antes.clave as string | null) || null, data.nombre);
  if (afectados.length) {
    return json(
      {
        message: `El cambio provocaría combinaciones de roles prohibidas en: ${afectados.map((a) => a.email).join(", ")}. ${mensajeViolaciones(afectados[0].violaciones)}`,
        codigo: "COMBINACION_PROHIBIDA",
        afectados,
      },
      409,
    );
  }

  if (cambiaPermisos) await exigirReauth(s, request, user, "usuarios:permisos");
  const adminsAntes = await countActiveAdministrators(s);
  await s.execute("UPDATE roles SET nombre = :nombre, descripcion = :descripcion, activo = :activo WHERE id = :id", { nombre: data.nombre, descripcion: data.descripcion, activo: data.activo, id: roleId });
  await guardarFilasRol(s, roleId, data.permisos);
  await assertAdministratorRemains(s, adminsAntes);
  await registrarAuditoria(s, user, {
    accion: "editar",
    entidad: "roles",
    entidadId: roleId,
    referencia: data.nombre,
    motivo: motivo || null,
    antes: { ...antes, permisos: permisosAntes },
    despues: { ...(await snapshotRow(s, "roles", roleId)), permisos: data.permisos },
  });
  await s.commit();
  return json({ message: "Rol actualizado" });
}

export async function deleteRole({ request, s, params }: RouteContext): Promise<Response> {
  const roleId = intParam(params.id);
  const user = await requireUser(request);
  await requirePermission(s, user, "usuarios", "G");
  const role = await s.queryOne<{ id: number; es_sistemico: number }>("SELECT id, es_sistemico FROM roles WHERE id = :id", { id: roleId });
  if (!role) return json({ message: "Rol no encontrado" }, 404);
  if (role.es_sistemico) return json({ message: "No se puede eliminar un rol sistemico" }, 403);
  // Un rol que alguna vez se asigno queda por su historial; solo se elimina uno que nunca se uso.
  const usos = Number((await s.scalar("SELECT COUNT(*) FROM usuario_roles WHERE rol_id = :id", { id: roleId })) || 0) + Number((await s.scalar("SELECT COUNT(*) FROM usuarios WHERE id_rol = :id", { id: roleId })) || 0);
  if (usos > 0) return json({ message: "No se puede eliminar un rol que se ha asignado a alguien; desactívalo" }, 409);
  const antes = await snapshotRow(s, "roles", roleId);
  const permisos = (await filasDeRoles(s, [roleId])).get(roleId) || [];
  await s.execute("DELETE FROM rol_acciones WHERE id_rol = :id", { id: roleId });
  await s.execute("DELETE FROM rol_permisos WHERE id_rol = :id", { id: roleId });
  await s.execute("DELETE FROM roles WHERE id = :id", { id: roleId });
  await registrarAuditoria(s, user, { accion: "eliminar", entidad: "roles", entidadId: roleId, referencia: String(antes?.nombre || roleId), antes: { ...antes, permisos } });
  await s.commit();
  return json({ message: "Rol eliminado" });
}

/* ---------- Usuarios ---------- */

const USUARIO_SELECT = `
  SELECT u.id, u.nombre, u.email, u.activo, u.departamento, u.avatar,
         u.creado_en, u.ultimo_acceso,
         CASE WHEN u.password_hash IS NULL THEN 0 ELSE 1 END AS tiene_password,
         CASE WHEN u.foto IS NULL THEN 0 ELSE 1 END AS tiene_foto,
         u.tipo_cuenta, u.vigente_desde, u.vigente_hasta, u.supervisor_id, sup.nombre AS supervisor_nombre,
         u.motivo_ultimo_cambio, u.bloqueado_hasta, u.debe_cambiar_password, u.cargo_predeterminado
  FROM usuarios u
  LEFT JOIN usuarios sup ON sup.id = u.supervisor_id
`;

/* Asignaciones de rol de varias personas, con su estado a hoy. */
async function asignacionesDe(s: Session, userIds: number[]): Promise<Map<number, Row[]>> {
  const out = new Map<number, Row[]>();
  if (!userIds.length) return out;
  const placeholders = userIds.map((_, i) => `:u${i}`).join(", ");
  const rows = await s.query<Row>(
    `
    SELECT ur.id, ur.usuario_id, ur.rol_id, r.nombre AS rol, r.clave AS rol_clave, r.activo AS rol_activo, ur.vigente_desde, ur.vigente_hasta, ur.motivo,
           ur.asignado_por, ua.nombre AS asignado_por_nombre, ur.asignado_en, ur.revocado_en, ur.revocado_por, ur2.nombre AS revocado_por_nombre, ur.motivo_revocacion
    FROM usuario_roles ur
    LEFT JOIN roles r ON r.id = ur.rol_id
    LEFT JOIN usuarios ua ON ua.id = ur.asignado_por
    LEFT JOIN usuarios ur2 ON ur2.id = ur.revocado_por
    WHERE ur.usuario_id IN (${placeholders})
    ORDER BY ur.asignado_en DESC, ur.id DESC
    `,
    Object.fromEntries(userIds.map((id, i) => [`u${i}`, id])),
  );
  const fecha = hoy();
  for (const row of rows) {
    const estado = row.revocado_en ? "revocado" : String(row.vigente_desde) > fecha ? "futuro" : row.vigente_hasta && String(row.vigente_hasta) < fecha ? "vencido" : "vigente";
    const lista = out.get(Number(row.usuario_id)) || [];
    lista.push({ ...row, estado });
    out.set(Number(row.usuario_id), lista);
  }
  return out;
}

function conRoles(row: Row, asignaciones: Row[]): Row {
  const vigentes = asignaciones.filter((a) => a.estado === "vigente" && Number(a.rol_activo) === 1);
  // Bloqueo vigente (vencido = ya no bloqueada) y vigencia de la cuenta a hoy.
  const bloqueada = row.bloqueado_hasta && Date.parse(String(row.bloqueado_hasta)) > Date.now() ? String(row.bloqueado_hasta) : null;
  return { ...row, bloqueado_hasta: bloqueada, cuenta_vigente: cuentaVigente(row), roles: vigentes.map((a) => ({ id: Number(a.rol_id), nombre: a.rol, clave: a.rol_clave ?? null, vigente_hasta: a.vigente_hasta ?? null })), rol: vigentes.map((a) => a.rol).join(", ") || null };
}

export async function listUsuarios({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "usuarios", "V");
  const rows = soloPropio(permiso)
    ? await s.query(`${USUARIO_SELECT} WHERE u.id = :id`, { id: permiso.auth.userId })
    : await s.query(`${USUARIO_SELECT} ORDER BY u.id DESC LIMIT 200`);
  const ids = rows.map((r) => Number(r.id));
  const asignaciones = await asignacionesDe(s, ids);
  // Para la lista de Usuarios: solicitud pendiente sobre la cuenta y numero de autorizaciones FX-THF-AP vigentes (solo lectura).
  const pendientes = await pendientesDe(s, "usuarios", ids);
  const autorizaciones = await autorizacionesVigentesPorPersona(s, ids);
  const items = rows.map((row) => {
    const p = pendientes.get(String(row.id));
    return { ...conRoles(row, asignaciones.get(Number(row.id)) || []), solicitud_pendiente: p ? serializarSolicitud(p) : null, autorizaciones_vigentes: autorizaciones.get(Number(row.id)) || 0 };
  });
  return json({ items, total: items.length });
}

/* Autorizaciones FX-THF-AP vigentes hoy (no revocadas, ya iniciadas y sin vencer), por persona. */
async function autorizacionesVigentesPorPersona(s: Session, ids: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!ids.length) return out;
  const fecha = hoy();
  const filas = await s.query<Row>(
    `SELECT usuario_id, COUNT(*) AS n FROM autorizaciones_personal
     WHERE usuario_id IN (${ids.map((_, i) => `:u${i}`).join(", ")}) AND revocada_en IS NULL AND vigente_desde <= :hoy AND (vigente_hasta IS NULL OR vigente_hasta >= :hoy)
     GROUP BY usuario_id`,
    { hoy: fecha, ...Object.fromEntries(ids.map((id, i) => [`u${i}`, id])) },
  );
  for (const f of filas) out.set(Number(f.usuario_id), Number(f.n || 0));
  return out;
}

export async function getUsuario({ request, s, params }: RouteContext): Promise<Response> {
  const userId = intParam(params.id);
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "usuarios", "V");
  if (soloPropio(permiso) && userId !== permiso.auth.userId) throw new HttpError(403, { message: "Tu alcance en usuarios es solo tu propia cuenta" });
  const row = await s.queryOne(`${USUARIO_SELECT} WHERE u.id = :id LIMIT 1`, { id: userId });
  if (!row) return json({ message: "Usuario no encontrado" }, 404);
  const asignaciones = (await asignacionesDe(s, [userId])).get(userId) || [];
  return json({ item: { ...conRoles(row, asignaciones), asignaciones } });
}

function validateUsuarioPayload(payload: Record<string, unknown>, options: { passwordRequired: boolean; currentEmail?: string | null }) {
  const data = normalizeUserPayload(payload);
  const password = String(payload.password || "");
  if (!data.nombre) return { error: json({ message: "El nombre es obligatorio" }, 400) };
  if (!data.email) return { error: json({ message: "El email es obligatorio" }, 400) };
  // El dominio se exige al dar de alta o cambiar el correo; una cuenta existente que
  // conserva su correo se puede editar aunque el dominio ya no este en la lista.
  const emailSinCambio = !!options.currentEmail && String(options.currentEmail).toLowerCase() === String(data.email).toLowerCase();
  if (!emailSinCambio && !emailDomainAllowed(data.email)) return { error: json({ message: domainErrorMessage() }, 400) };
  if (options.passwordRequired && !password) return { error: json({ message: "La contraseña es obligatoria" }, 400) };
  if (password) {
    const weak = validatePasswordStrength(password, { email: data.email, nombre: data.nombre });
    if (weak) return { error: json({ message: weak }, 400) };
  }
  return { data, passwordHash: password ? hashPassword(password) : null };
}

/* ---------- Vigencia de la cuenta y supervisor (Fase 2) ---------- */

interface DatosCuenta {
  tipo_cuenta: "permanente" | "temporal";
  vigente_desde: string | null;
  vigente_hasta: string | null;
  supervisor_id: number | null;
}

function datosCuenta(payload: Record<string, unknown>, actual?: Row | null): DatosCuenta {
  const tipo = String(payload.tipo_cuenta ?? actual?.tipo_cuenta ?? "permanente") === "temporal" ? "temporal" : "permanente";
  const leer = (campo: string) => (campo in payload ? payload[campo] : actual?.[campo]);
  const desde = leer("vigente_desde");
  const hasta = leer("vigente_hasta");
  const supervisor = leer("supervisor_id");
  if (desde && !fechaValida(desde)) throw new HttpError(400, { message: "La fecha de inicio de la cuenta no es válida" });
  if (hasta && !fechaValida(hasta)) throw new HttpError(400, { message: "La fecha de fin de la cuenta no es válida" });
  const supervisorId = supervisor === null || supervisor === undefined || supervisor === "" ? null : Number.parseInt(String(supervisor), 10);
  return { tipo_cuenta: tipo, vigente_desde: fechaValida(desde), vigente_hasta: fechaValida(hasta), supervisor_id: Number.isFinite(supervisorId) ? supervisorId : null };
}

/*
 * Reglas de la cuenta: temporal => fecha de fin y supervisor obligatorios. El
 * supervisor es una persona activa, vigente, con cuenta permanente y con un rol
 * que tenga R o A en ensayos o muestras (por permisos, no por nombre); nadie se
 * supervisa a si mismo.
 */
async function validarCuenta(s: Session, cuenta: DatosCuenta, usuarioId: number | null): Promise<void> {
  if (cuenta.vigente_desde && cuenta.vigente_hasta && cuenta.vigente_hasta < cuenta.vigente_desde) throw new HttpError(400, { message: "La vigencia de la cuenta termina antes de empezar" });
  if (cuenta.tipo_cuenta === "temporal") {
    if (!cuenta.vigente_hasta) throw new HttpError(400, { message: "Una cuenta temporal necesita fecha de fin de vigencia" });
    if (!cuenta.supervisor_id) throw new HttpError(400, { message: "Una cuenta temporal necesita un supervisor" });
  }
  if (!cuenta.supervisor_id) return;
  if (usuarioId !== null && cuenta.supervisor_id === usuarioId) throw new HttpError(400, { message: "Nadie puede supervisarse a sí mismo" });
  const sup = await s.queryOne<Row>("SELECT id, email, activo, tipo_cuenta, vigente_desde, vigente_hasta FROM usuarios WHERE id = :id", { id: cuenta.supervisor_id });
  if (!sup || !Number(sup.activo ?? 1) || !cuentaVigente(sup)) throw new HttpError(400, { message: "El supervisor debe ser una persona activa y vigente" });
  if (String(sup.tipo_cuenta || "permanente") === "temporal" || sup.vigente_hasta) throw new HttpError(400, { message: "El supervisor debe tener una cuenta permanente" });
  const efectivos = expandirPermisos((await rolesVigentes(s, Number(sup.id))).flatMap((r) => r.filas));
  const puede = (["ensayos", "muestras"] as const).some((m) => permite(efectivos, m, "R") || permite(efectivos, m, "A"));
  if (!puede) throw new HttpError(400, { message: "El supervisor debe tener un rol con R o A en ensayos o muestras" });
}

/* ¿Alguno de los roles (vigentes o por comenzar) de la persona es el de Estudiante / formación? */
async function tieneRolEstudiante(s: Session, usuarioId: number): Promise<boolean> {
  return (await rolesComprometidos(s, usuarioId)).some((r) => r.clave === "estudiante");
}

function cambioDeCuenta(antes: Row, cuenta: DatosCuenta): Record<string, { antes: unknown; despues: unknown }> {
  const cambios: Record<string, { antes: unknown; despues: unknown }> = {};
  const previo: Record<string, unknown> = { tipo_cuenta: antes.tipo_cuenta || "permanente", vigente_desde: antes.vigente_desde || null, vigente_hasta: antes.vigente_hasta || null, supervisor_id: antes.supervisor_id === null || antes.supervisor_id === undefined ? null : Number(antes.supervisor_id) };
  for (const campo of Object.keys(previo)) {
    const nuevo = cuenta[campo as keyof DatosCuenta] ?? null;
    if ((previo[campo] ?? null) !== nuevo) cambios[campo] = { antes: previo[campo] ?? null, despues: nuevo };
  }
  return cambios;
}

/* Alta de una asignacion de rol (con reglas de combinacion y bitacora). */
/* Datos validados de una asignacion de rol (aun sin guardar). */
interface AsignacionPreparada {
  rol: { id: number; nombre: string; clave: string | null };
  desde: string;
  hasta: string | null;
  motivo: string;
}

/*
 * Valida una asignacion de rol (rol activo, vigencia dentro de la cuenta,
 * estudiante solo temporal, sin duplicar, combinaciones prohibidas). Se usa al
 * solicitarla y otra vez al ejecutarla, porque el estado pudo cambiar.
 */
async function prepararAsignacion(s: Session, usuario: Row, payload: Record<string, unknown>, motivoPorOmision?: string): Promise<AsignacionPreparada> {
  const rolId = Number.parseInt(String(payload.rol_id ?? payload.id_rol ?? ""), 10);
  const rol = Number.isFinite(rolId) ? await s.queryOne<{ id: number; nombre: string; clave: string | null; activo: number }>("SELECT id, nombre, clave, activo FROM roles WHERE id = :id", { id: rolId }) : null;
  if (!rol) throw new HttpError(400, { message: "Selecciona un rol que exista" });
  if (!Number(rol.activo)) throw new HttpError(409, { message: `El rol "${rol.nombre}" esta inactivo` });
  // Fase 2: la vigencia del rol cabe dentro de la de la cuenta (sin fechas: toma las de la cuenta).
  const cuentaDesde = usuario.vigente_desde ? String(usuario.vigente_desde) : null;
  const cuentaHasta = usuario.vigente_hasta ? String(usuario.vigente_hasta) : null;
  const desde = fechaValida(payload.vigente_desde) || (cuentaDesde && cuentaDesde > hoy() ? cuentaDesde : hoy());
  const hasta = payload.vigente_hasta ? fechaValida(payload.vigente_hasta) : cuentaHasta;
  if (payload.vigente_hasta && !hasta) throw new HttpError(400, { message: "La fecha de fin de vigencia no es valida" });
  if (hasta && hasta < desde) throw new HttpError(400, { message: "La vigencia termina antes de empezar" });
  if (hasta && hasta < hoy()) throw new HttpError(400, { message: "La vigencia de la asignación ya terminó; indica una fecha de fin de hoy en adelante" });
  if (cuentaHasta && hasta && hasta > cuentaHasta) throw new HttpError(400, { message: `El rol no puede quedar vigente más allá de la vigencia de la cuenta (${cuentaHasta})` });
  if (cuentaDesde && desde < cuentaDesde) throw new HttpError(400, { message: `El rol no puede empezar antes que la cuenta (${cuentaDesde})` });
  if (rol.clave === "estudiante" && String(usuario.tipo_cuenta || "permanente") !== "temporal") throw new HttpError(400, { message: "El rol de estudiante / personal en formación solo se asigna a cuentas temporales (con fecha de fin y supervisor)" });
  const motivo = motivoDe(payload) || motivoPorOmision || "";
  exigirMotivo(motivo, "de la asignación");

  const actuales = await rolesComprometidos(s, Number(usuario.id));
  if (actuales.some((r) => r.id === rol.id)) throw new HttpError(409, { message: `${usuario.email} ya tiene el rol "${rol.nombre}" (vigente o por comenzar); revócalo antes de volver a asignarlo` });
  const filas = (await filasDeRoles(s, [rol.id])).get(rol.id) || [];
  const violaciones = evaluarCombinacion([...actuales, { id: rol.id, nombre: rol.nombre, clave: rol.clave, filas }]);
  if (violaciones.length) throw new HttpError(409, { message: mensajeViolaciones(violaciones), codigo: "COMBINACION_PROHIBIDA", violaciones });
  return { rol: { id: rol.id, nombre: rol.nombre, clave: rol.clave }, desde, hasta, motivo };
}

/* Alta de la asignacion (la ejecuta quien aprueba la solicitud, con constancia del solicitante). */
async function insertarAsignacion(s: Session, actor: CurrentUser, usuario: Row, prep: AsignacionPreparada, detalle: Record<string, unknown> = {}): Promise<number> {
  const result = await s.execute(
    "INSERT INTO usuario_roles (usuario_id, rol_id, vigente_desde, vigente_hasta, motivo, asignado_por, asignado_en) VALUES (:usuario_id, :rol_id, :desde, :hasta, :motivo, :por, :en)",
    { usuario_id: usuario.id, rol_id: prep.rol.id, desde: prep.desde, hasta: prep.hasta, motivo: prep.motivo, por: userIdFromClaims(actor), en: new Date().toISOString() },
  );
  await registrarAuditoria(s, actor, {
    accion: "asignar_rol",
    entidad: "usuarios",
    entidadId: Number(usuario.id),
    referencia: String(usuario.email),
    motivo: prep.motivo,
    detalle: { rol: prep.rol.nombre, rol_id: prep.rol.id, asignacion_id: result.lastrowid, vigente_desde: prep.desde, vigente_hasta: prep.hasta, ...detalle },
  });
  return result.lastrowid as number;
}

/*
 * Fase 3: asignar un rol es una accion critica (seccion 10): se valida, se crea
 * la solicitud y la ejecuta quien tenga usuarios:A (Responsable General).
 */
async function solicitarAsignacion(s: Session, actor: CurrentUser, usuario: Row, payload: Record<string, unknown>, motivoPorOmision?: string, cargo?: string | null): Promise<Solicitud> {
  const prep = await prepararAsignacion(s, usuario, payload, motivoPorOmision);
  return crearSolicitud(s, actor, {
    tipo: "asignar_rol",
    entidad: "usuarios",
    entidadId: Number(usuario.id),
    referencia: String(usuario.email),
    accion: "asignar_rol",
    datos: { rol_id: prep.rol.id, rol: prep.rol.nombre, vigente_desde: prep.desde, vigente_hasta: prep.hasta, motivo: prep.motivo },
    motivo: prep.motivo,
    cargo,
  });
}

/* Ejecutor de la solicitud "asignar_rol" (se vuelve a validar al aprobar). */
export async function ejecutarAsignacionRol(ctx: ContextoEjecucion): Promise<Record<string, unknown>> {
  const usuario = await snapshotRow(ctx.s, "usuarios", Number(ctx.solicitud.entidad_id));
  if (!usuario) throw new HttpError(404, { message: "La cuenta de la solicitud ya no existe" });
  const prep = await prepararAsignacion(ctx.s, usuario, { rol_id: ctx.datos.rol_id, vigente_desde: ctx.datos.vigente_desde, vigente_hasta: ctx.datos.vigente_hasta, motivo: ctx.datos.motivo });
  const id = await insertarAsignacion(ctx.s, ctx.user, usuario, prep, detalleSolicitud(ctx.solicitud));
  return { asignacion_id: id, rol: prep.rol.nombre };
}

/* Ejecutor de "reactivar_cuenta". */
export async function ejecutarReactivacion(ctx: ContextoEjecucion): Promise<Record<string, unknown>> {
  const userId = Number(ctx.solicitud.entidad_id);
  const antes = await snapshotRow(ctx.s, "usuarios", userId);
  if (!antes) throw new HttpError(404, { message: "La cuenta de la solicitud ya no existe" });
  if (Number(antes.activo ?? 1) === 1) throw new HttpError(409, { message: "La cuenta ya está activa" });
  await ctx.s.execute("UPDATE usuarios SET activo = 1 WHERE id = :id", { id: userId });
  const despues = await snapshotRow(ctx.s, "usuarios", userId);
  await registrarAuditoria(ctx.s, ctx.user, { accion: "reactivar", entidad: "usuarios", entidadId: userId, referencia: String(antes.email), motivo: ctx.solicitud.motivo, antes, despues, detalle: detalleSolicitud(ctx.solicitud) });
  return { activo: true };
}

/* Ejecutor de "ampliar_vigencia" (los roles no se extienden solos; se reasignan). */
export async function ejecutarAmpliacionVigencia(ctx: ContextoEjecucion): Promise<Record<string, unknown>> {
  const userId = Number(ctx.solicitud.entidad_id);
  const antes = await snapshotRow(ctx.s, "usuarios", userId);
  if (!antes) throw new HttpError(404, { message: "La cuenta de la solicitud ya no existe" });
  const tipo = String(ctx.datos.tipo_cuenta || antes.tipo_cuenta || "permanente") === "temporal" ? "temporal" : "permanente";
  const hasta = ctx.datos.vigente_hasta ? fechaValida(ctx.datos.vigente_hasta) : null;
  await validarCuenta(ctx.s, { tipo_cuenta: tipo, vigente_desde: (antes.vigente_desde as string | null) || null, vigente_hasta: hasta, supervisor_id: antes.supervisor_id === null || antes.supervisor_id === undefined ? null : Number(antes.supervisor_id) }, userId);
  await ctx.s.execute("UPDATE usuarios SET tipo_cuenta = :tipo, vigente_hasta = :hasta, motivo_ultimo_cambio = :motivo WHERE id = :id", { tipo, hasta, motivo: ctx.solicitud.motivo, id: userId });
  const despues = await snapshotRow(ctx.s, "usuarios", userId);
  await registrarAuditoria(ctx.s, ctx.user, {
    accion: "cambiar_vigencia",
    entidad: "usuarios",
    entidadId: userId,
    referencia: String(antes.email),
    motivo: ctx.solicitud.motivo,
    antes,
    despues,
    detalle: { cambios: { vigente_hasta: { antes: antes.vigente_hasta ?? null, despues: hasta }, ...(tipo !== String(antes.tipo_cuenta || "permanente") ? { tipo_cuenta: { antes: antes.tipo_cuenta || "permanente", despues: tipo } } : {}) }, roles_acotados: 0, ...detalleSolicitud(ctx.solicitud) },
  });
  return { vigente_hasta: hasta, tipo_cuenta: tipo };
}

export async function createUsuario({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await requirePermission(s, user, "usuarios", "G");
  const payload = await readJson(request);
  const validated = validateUsuarioPayload(payload, { passwordRequired: true });
  if (validated.error) return validated.error;
  const data = validated.data;
  // Toda cuenta nace con un rol inicial (usuarios.id_rol lo conserva como dato historico).
  const rolInicial = Number.parseInt(String(payload.rol_id ?? payload.id_rol ?? ""), 10);
  if (!Number.isFinite(rolInicial) || !(await s.scalar("SELECT id FROM roles WHERE id = :id", { id: rolInicial }))) return json({ message: "Selecciona el rol inicial de la cuenta" }, 400);
  const cuenta = datosCuenta(payload);
  await validarCuenta(s, cuenta, null);
  // Dar de alta una cuenta asigna un rol: exige reautenticacion.
  await exigirReauth(s, request, user, "usuarios:roles");

  let insertedId: number;
  try {
    const result = await s.execute(
      `INSERT INTO usuarios (nombre, email, activo, id_rol, departamento, password_hash, avatar, tipo_cuenta, vigente_desde, vigente_hasta, supervisor_id, motivo_ultimo_cambio)
       VALUES (:nombre, :email, :activo, :id_rol, :departamento, :password_hash, :avatar, :tipo_cuenta, :vigente_desde, :vigente_hasta, :supervisor_id, :motivo_cuenta)`,
      // Cada cuenta nace con un avatar al azar del catalogo; la persona puede cambiarlo en "Mi cuenta".
      { ...data, ...cuenta, id_rol: rolInicial, password_hash: validated.passwordHash, avatar: data.avatar ?? randomAvatar(), motivo_cuenta: motivoDe(payload, "motivo_cuenta") || null },
    );
    insertedId = result.lastrowid as number;
  } catch (error) {
    if (isIntegrityError(error)) {
      await s.rollback();
      return json({ message: "Ya existe un usuario con ese email" }, 409);
    }
    throw error;
  }
  const nuevo = (await snapshotRow(s, "usuarios", insertedId))!;
  await registrarAuditoria(s, user, { accion: "crear", entidad: "usuarios", entidadId: insertedId, referencia: String(data.email), despues: nuevo });
  // Fase 3: el rol inicial tambien lo aprueba un segundo usuario con usuarios:A; mientras, la cuenta no tiene roles.
  const solicitud = await solicitarAsignacion(s, user, nuevo, { ...payload, rol_id: rolInicial }, "Alta de usuario");
  await s.commit();
  return json({ message: `Usuario creado; su rol inicial queda pendiente de la autorización de un segundo usuario (solicitud #${solicitud.id})`, id: insertedId, solicitud: serializarSolicitud(solicitud) }, 201);
}

export async function updateUsuario({ request, s, params }: RouteContext): Promise<Response> {
  const userId = intParam(params.id);
  const user = await requireUser(request);
  await requirePermission(s, user, "usuarios", "G");
  const antesUsuario = await snapshotRow(s, "usuarios", userId);
  if (!antesUsuario) return json({ message: "Usuario no encontrado" }, 404);
  const payload = await readJson(request);
  const validated = validateUsuarioPayload(payload, { passwordRequired: false, currentEmail: String(antesUsuario.email || "") });
  if (validated.error) return validated.error;
  const data = validated.data;
  const cuenta = datosCuenta(payload, antesUsuario);
  await validarCuenta(s, cuenta, userId);
  let cambiosCuenta = cambioDeCuenta(antesUsuario, cuenta);
  let cambiaCuenta = Object.keys(cambiosCuenta).length > 0;
  const motivoCuenta = motivoDe(payload, "motivo_cuenta") || motivoDe(payload);
  if (cambiaCuenta) {
    exigirMotivo(motivoCuenta, "del cambio de vigencia o supervisor");
    if (cuenta.tipo_cuenta !== "temporal" && (await tieneRolEstudiante(s, userId))) throw new HttpError(400, { message: "Una cuenta con el rol de estudiante / personal en formación debe ser temporal" });
  }
  const seDaDeBaja = Number(antesUsuario.activo ?? 1) === 1 && !data.activo;
  // Reactivar una cuenta dada de baja tambien es critico (le devuelve el acceso): segundo usuario (Fase 3).
  const seReactiva = Number(antesUsuario.activo ?? 1) === 0 && !!data.activo;
  /*
   * Ampliar la vigencia de una cuenta temporal (fecha de fin posterior, sin fin,
   * o pasarla a permanente) tambien requiere segundo usuario: se guarda todo lo
   * demas y la ampliacion queda en solicitud.
   */
  const hastaAntes = (antesUsuario.vigente_hasta as string | null) || null;
  const eraTemporal = String(antesUsuario.tipo_cuenta || "permanente") === "temporal";
  const amplia = eraTemporal && (cuenta.tipo_cuenta === "permanente" || (hastaAntes && (!cuenta.vigente_hasta || cuenta.vigente_hasta > hastaAntes)));
  const ampliacion = amplia ? { tipo_cuenta: cuenta.tipo_cuenta, vigente_hasta: cuenta.vigente_hasta } : null;
  if (amplia) {
    cuenta.tipo_cuenta = "temporal";
    cuenta.vigente_hasta = hastaAntes;
    // Lo que se guarda ahora es solo lo que no es ampliacion (p. ej. el supervisor).
    cambiosCuenta = cambioDeCuenta(antesUsuario, cuenta);
    cambiaCuenta = Object.keys(cambiosCuenta).length > 0;
  }
  // Fijar la contrasena de otra persona equivale a restablecerla: reautenticacion y cambio obligatorio.
  const otraPersona = String(user.sub) !== String(userId);
  // La propia contrasena solo se cambia en "Mi cuenta" (pide la actual); aqui no.
  if (validated.passwordHash && !otraPersona) throw new HttpError(400, { message: "Tu propia contraseña se cambia en Mi cuenta › Cambiar contraseña (pide la actual)" });
  /*
   * Una sola reautenticacion por guardado (el token es de un solo uso): la accion
   * es la del cambio mas critico que incluye (vigencia, baja, reactivacion o contrasena).
   */
  const accionCritica = cambiaCuenta ? "usuarios:vigencia" : seDaDeBaja ? "usuarios:baja" : seReactiva ? "usuarios:reactivar" : validated.passwordHash && otraPersona ? "usuarios:password" : null;
  // Pedir la ampliacion de vigencia tambien exige confirmar la identidad (aunque no haya otro cambio de cuenta).
  const accionFinal = accionCritica || (ampliacion ? "usuarios:vigencia" : null);
  if (accionFinal) await exigirReauth(s, request, user, accionFinal);
  const adminsAntes = await countActiveAdministrators(s);
  try {
    // Los roles no se cambian aqui: se asignan y revocan con motivo (asignarRolUsuario / revocarRolUsuario).
    await s.execute(
      `
      UPDATE usuarios
      SET nombre = :nombre, email = :email, activo = :activo, departamento = :departamento,
          password_hash = COALESCE(:password_hash, password_hash),
          avatar = CASE WHEN :avatar_set = 1 THEN :avatar ELSE avatar END,
          tipo_cuenta = :tipo_cuenta, vigente_desde = :vigente_desde, vigente_hasta = :vigente_hasta, supervisor_id = :supervisor_id,
          motivo_ultimo_cambio = CASE WHEN :cambia_cuenta = 1 THEN :motivo_cuenta ELSE motivo_ultimo_cambio END,
          debe_cambiar_password = CASE WHEN :forzar_cambio = 1 THEN 1 ELSE debe_cambiar_password END,
          token_version = COALESCE(token_version, 0) + :revocar
      WHERE id = :user_id
      `,
      {
        ...data,
        ...cuenta,
        // La reactivacion no se aplica aqui: la ejecuta quien apruebe la solicitud.
        activo: seReactiva ? 0 : data.activo,
        avatar: data.avatar ?? null,
        avatar_set: data.avatar === undefined ? 0 : 1,
        password_hash: validated.passwordHash,
        cambia_cuenta: cambiaCuenta ? 1 : 0,
        motivo_cuenta: motivoCuenta || null,
        // Dar de baja o cambiar la contrasena cierra sus sesiones abiertas.
        revocar: seDaDeBaja || validated.passwordHash ? 1 : 0,
        forzar_cambio: validated.passwordHash && otraPersona ? 1 : 0,
        user_id: userId,
      },
    );
  } catch (error) {
    if (isIntegrityError(error)) {
      await s.rollback();
      return json({ message: "Ya existe un usuario con ese email" }, 409);
    }
    throw error;
  }
  /*
   * La vigencia de sus roles no puede exceder la de la cuenta. Cada rol afectado
   * queda en la bitacora: si empezaba despues del nuevo fin se revoca (no queda
   * un rango invertido); si no, se acota a la nueva fecha. Extender despues la
   * cuenta no los devuelve: se reasignan con motivo.
   */
  const rolesAjustados: Array<{ rol: unknown; asignacion_id: number; antes: unknown; despues: string | null; revocado: boolean }> = [];
  if (cuenta.vigente_hasta) {
    const afectados = await s.query<Row>(
      `SELECT ur.id, ur.rol_id, ur.vigente_desde, ur.vigente_hasta, r.nombre AS rol FROM usuario_roles ur LEFT JOIN roles r ON r.id = ur.rol_id
       WHERE ur.usuario_id = :id AND ur.revocado_en IS NULL AND (ur.vigente_hasta IS NULL OR ur.vigente_hasta > :hasta)`,
      { id: userId, hasta: cuenta.vigente_hasta },
    );
    const ahora = new Date().toISOString();
    for (const a of afectados) {
      const revocar = String(a.vigente_desde) > cuenta.vigente_hasta;
      const motivoRol = revocar ? `La cuenta termina (${cuenta.vigente_hasta}) antes de que iniciara el rol` : `Se acota a la vigencia de la cuenta (${cuenta.vigente_hasta})`;
      if (revocar) {
        await s.execute("UPDATE usuario_roles SET revocado_en = :en, revocado_por = :por, motivo_revocacion = :motivo WHERE id = :id", { en: ahora, por: userIdFromClaims(user), motivo: motivoRol, id: a.id });
      } else {
        await s.execute("UPDATE usuario_roles SET vigente_hasta = :hasta WHERE id = :id", { hasta: cuenta.vigente_hasta, id: a.id });
      }
      await registrarAuditoria(s, user, {
        accion: revocar ? "revocar_rol" : "acotar_rol",
        entidad: "usuarios",
        entidadId: userId,
        referencia: String(data.email),
        motivo: motivoRol,
        detalle: { rol: a.rol, rol_id: a.rol_id, asignacion_id: Number(a.id), vigente_desde: a.vigente_desde, vigente_hasta_antes: a.vigente_hasta ?? null, vigente_hasta: revocar ? a.vigente_hasta ?? null : cuenta.vigente_hasta },
      });
      rolesAjustados.push({ rol: a.rol, asignacion_id: Number(a.id), antes: a.vigente_hasta ?? null, despues: revocar ? null : cuenta.vigente_hasta, revocado: revocar });
    }
  }
  await assertAdministratorRemains(s, adminsAntes);
  const despues = await snapshotRow(s, "usuarios", userId);
  await registrarAuditoria(s, user, { accion: "editar", entidad: "usuarios", entidadId: userId, referencia: String(data.email), antes: antesUsuario, despues, detalle: validated.passwordHash ? { contrasena: "cambiada" } : null });
  let solicitud: Solicitud | null = null;
  if (seReactiva) {
    solicitud = await crearSolicitud(s, user, { tipo: "reactivar_cuenta", entidad: "usuarios", entidadId: userId, referencia: String(data.email), accion: "reactivar", motivo: motivoDe(payload) || motivoCuenta || "Reactivación de la cuenta" });
  } else if (ampliacion) {
    solicitud = await crearSolicitud(s, user, { tipo: "ampliar_vigencia", entidad: "usuarios", entidadId: userId, referencia: String(data.email), accion: "ampliar_vigencia", datos: ampliacion, motivo: motivoCuenta });
  }
  if (cambiaCuenta) {
    await registrarAuditoria(s, user, { accion: "cambiar_vigencia", entidad: "usuarios", entidadId: userId, referencia: String(data.email), motivo: motivoCuenta, detalle: { cambios: cambiosCuenta, roles_acotados: rolesAjustados.length } });
  }
  await s.commit();
  if (solicitud) {
    const def = ACCIONES_CRITICAS[solicitud.tipo];
    return json({ message: `Datos guardados. ${def.pendiente}: queda pendiente de la autorización de un segundo usuario (solicitud #${solicitud.id})`, solicitud: serializarSolicitud(solicitud), codigo: "solicitud_creada", roles_acotados: rolesAjustados.length, roles_ajustados: rolesAjustados }, 202);
  }
  return json({ message: rolesAjustados.length ? `Usuario actualizado; ${rolesAjustados.length} rol(es) se ajustaron a la vigencia de la cuenta` : "Usuario actualizado", roles_acotados: rolesAjustados.length, roles_ajustados: rolesAjustados });
}

export async function deleteUsuario({ request, s, params }: RouteContext): Promise<Response> {
  const userId = intParam(params.id);
  const user = await requireUser(request);
  await requirePermission(s, user, "usuarios", "G");
  if (String(user.sub) === String(userId)) return json({ message: "No puedes dar de baja tu propio usuario activo" }, 403);
  // Las cuentas no se eliminan: la bitacora y los registros firmados siguen apuntando a ellas.
  const payload = await readJson(request);
  const motivo = motivoDe(payload);
  if (motivo.length < MOTIVO_MIN) return json({ message: "Indica el motivo de la baja del usuario (al menos 5 caracteres)" }, 400);
  const antes = await snapshotRow(s, "usuarios", userId);
  if (!antes) return json({ message: "Usuario no encontrado" }, 404);
  await exigirReauth(s, request, user, "usuarios:baja");
  const adminsAntes = await countActiveAdministrators(s);
  // La baja cierra sus sesiones abiertas (token_version).
  await s.execute("UPDATE usuarios SET activo = 0, token_version = COALESCE(token_version, 0) + 1 WHERE id = :user_id", { user_id: userId });
  await assertAdministratorRemains(s, adminsAntes);
  await registrarAuditoria(s, user, { accion: "baja", entidad: "usuarios", entidadId: userId, referencia: String(antes.email || userId), motivo, antes, despues: await snapshotRow(s, "usuarios", userId) });
  await s.commit();
  return json({ message: "Usuario dado de baja (inactivo); su historial se conserva" });
}

/* ---------- Bloqueo y contrasenas (Fase 2) ---------- */

export async function desbloquearUsuario({ request, s, params }: RouteContext): Promise<Response> {
  const userId = intParam(params.id);
  const user = await requireUser(request);
  await requirePermission(s, user, "usuarios", "G");
  const usuario = await snapshotRow(s, "usuarios", userId);
  if (!usuario) return json({ message: "Usuario no encontrado" }, 404);
  const motivo = motivoDe(await readJson(request));
  exigirMotivo(motivo, "del desbloqueo");
  await exigirReauth(s, request, user, "usuarios:desbloquear");
  // Se levanta el bloqueo y los intentos anteriores dejan de contar.
  await s.execute("UPDATE usuarios SET bloqueado_hasta = NULL, intentos_desde = :ahora WHERE id = :id", { ahora: new Date().toISOString(), id: userId });
  await registrarAuditoria(s, user, { accion: "desbloquear", entidad: "usuarios", entidadId: userId, referencia: String(usuario.email), motivo, detalle: { bloqueado_hasta: usuario.bloqueado_hasta ?? null } });
  await s.commit();
  return json({ message: "Cuenta desbloqueada" });
}

/* Genera una contrasena temporal que cumple las reglas (10+ caracteres, mezcla de tipos). */
function passwordTemporal(): string {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(14);
  let out = "";
  for (const b of bytes) out += alfabeto[b % alfabeto.length];
  return `${out.slice(0, 6)}-${out.slice(6, 12)}#${(bytes[12] % 90) + 10}`;
}

export async function restablecerPassword({ request, s, params }: RouteContext): Promise<Response> {
  const userId = intParam(params.id);
  const user = await requireUser(request);
  await requirePermission(s, user, "usuarios", "G");
  if (String(user.sub) === String(userId)) return json({ message: "Para tu propia cuenta usa Cambiar contraseña en Mi cuenta" }, 403);
  const usuario = await snapshotRow(s, "usuarios", userId);
  if (!usuario) return json({ message: "Usuario no encontrado" }, 404);
  const motivo = motivoDe(await readJson(request));
  exigirMotivo(motivo, "del restablecimiento");
  await exigirReauth(s, request, user, "usuarios:password");
  const temporal = passwordTemporal();
  // Obliga a cambiarla al entrar y cierra las sesiones abiertas.
  await s.execute("UPDATE usuarios SET password_hash = :hash, debe_cambiar_password = 1, token_version = COALESCE(token_version, 0) + 1 WHERE id = :id", { hash: hashPassword(temporal), id: userId });
  // La contrasena temporal se entrega una sola vez en la respuesta; nunca se escribe en la bitacora.
  await registrarAuditoria(s, user, { accion: "restablecer_password", entidad: "usuarios", entidadId: userId, referencia: String(usuario.email), motivo, detalle: { cambio_obligatorio: true, sesiones: "cerradas" } });
  await s.commit();
  return json({ message: "Contraseña restablecida: la persona deberá cambiarla al entrar", password_temporal: temporal });
}

/* ---------- Asignacion y revocacion de roles ---------- */

function noASiMismo(actor: CurrentUser, userId: number): void {
  if (String(actor.sub) === String(userId)) throw new HttpError(403, { message: "Nadie puede asignarse ni revocarse roles a sí mismo" });
}

export async function asignarRolUsuario({ request, s, params }: RouteContext): Promise<Response> {
  const userId = intParam(params.id);
  const user = await requireUser(request);
  await requirePermission(s, user, "usuarios", "G");
  noASiMismo(user, userId);
  const usuario = await snapshotRow(s, "usuarios", userId);
  if (!usuario) return json({ message: "Usuario no encontrado" }, 404);
  const payload = await readJson(request);
  await exigirReauth(s, request, user, "usuarios:roles");
  const solicitud = await solicitarAsignacion(s, user, usuario, payload);
  await s.commit();
  return respuestaSolicitud(solicitud, `la asignación del rol "${String(datosDe(solicitud).rol)}" a ${usuario.email}`);
}

export async function revocarRolUsuario({ request, s, params }: RouteContext): Promise<Response> {
  const userId = intParam(params.id);
  const asignacionId = intParam(params.asignacion);
  const user = await requireUser(request);
  await requirePermission(s, user, "usuarios", "G");
  noASiMismo(user, userId);
  const asignacion = await s.queryOne<Row>(
    "SELECT ur.*, r.nombre AS rol, u.email FROM usuario_roles ur LEFT JOIN roles r ON r.id = ur.rol_id LEFT JOIN usuarios u ON u.id = ur.usuario_id WHERE ur.id = :id AND ur.usuario_id = :usuario_id",
    { id: asignacionId, usuario_id: userId },
  );
  if (!asignacion) return json({ message: "Asignación no encontrada" }, 404);
  if (asignacion.revocado_en) return json({ message: "La asignación ya estaba revocada" }, 409);
  const payload = await readJson(request);
  const motivo = motivoDe(payload);
  exigirMotivo(motivo, "de la revocación");
  await exigirReauth(s, request, user, "usuarios:roles");
  const adminsAntes = await countActiveAdministrators(s);
  await s.execute("UPDATE usuario_roles SET revocado_en = :en, revocado_por = :por, motivo_revocacion = :motivo WHERE id = :id", { en: new Date().toISOString(), por: userIdFromClaims(user), motivo, id: asignacionId });
  await assertAdministratorRemains(s, adminsAntes);
  await registrarAuditoria(s, user, {
    accion: "revocar_rol",
    entidad: "usuarios",
    entidadId: userId,
    referencia: String(asignacion.email || userId),
    motivo,
    detalle: { rol: asignacion.rol, rol_id: asignacion.rol_id, asignacion_id: asignacionId, vigente_desde: asignacion.vigente_desde, vigente_hasta: asignacion.vigente_hasta ?? null },
  });
  await s.commit();
  return json({ message: "Rol revocado" });
}

/* ---------- Vencimientos proximos (avisos del Inicio y la campana; la revision de accesos esta en Usuarios) ---------- */

export async function vencimientosProximos(s: Session, dias: number, supervisorId?: number): Promise<Row[]> {
  const fecha = hoy();
  const limite = sumarDias(fecha, dias);
  const filtro = supervisorId ? "AND u.supervisor_id = :sup" : "";
  const cuentas = await s.query<Row>(
    `SELECT u.id, u.nombre, u.email, u.vigente_hasta, NULL AS rol FROM usuarios u
     WHERE COALESCE(u.activo, 1) = 1 AND u.vigente_hasta IS NOT NULL AND u.vigente_hasta >= :hoy AND u.vigente_hasta <= :limite ${filtro}`,
    { hoy: fecha, limite, sup: supervisorId ?? 0 },
  );
  const roles = await s.query<Row>(
    `SELECT u.id, u.nombre, u.email, ur.vigente_hasta, r.nombre AS rol FROM usuario_roles ur
     JOIN usuarios u ON u.id = ur.usuario_id JOIN roles r ON r.id = ur.rol_id
     WHERE COALESCE(u.activo, 1) = 1 AND ur.revocado_en IS NULL AND ur.vigente_hasta IS NOT NULL
       AND ur.vigente_hasta >= :hoy AND ur.vigente_hasta <= :limite
       AND (u.vigente_hasta IS NULL OR ur.vigente_hasta < u.vigente_hasta) ${filtro}`,
    { hoy: fecha, limite, sup: supervisorId ?? 0 },
  );
  return [...cuentas, ...roles].sort((a, b) => String(a.vigente_hasta).localeCompare(String(b.vigente_hasta)));
}
