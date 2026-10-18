/*
 * Autorizaciones del personal (FX-THF-AP, Fase 4): tabla, validacion al guardar,
 * alta/revocacion y vencimientos. El catalogo y los requisitos por formato
 * estan en src/lib/shared/autorizaciones.ts.
 *
 * - Nada se borra: revocar llena las columnas de revocacion.
 * - Las otorgan y revocan quienes tienen ensayos:A o calidad:A (no el
 *   Administrador tecnico); nadie se las da ni se las quita a si mismo.
 * - AUTORIZACIONES_OBLIGATORIAS=false desactiva la validacion (carga inicial).
 */
import { requireUser, userIdFromClaims, type CurrentUser } from "./auth";
import { registrarAuditoria } from "./audit";
import { getConfig } from "./config";
import { type Row, type Session } from "./db";
import { HttpError, intParam, json, readJson, type RouteContext } from "./http";
import { cargarAutorizacion, cargoActuante, permisoDe, requirePermission, type Autorizacion, type Permiso } from "./rbac";

import { exigirReauth } from "./seguridad";
import { ACTIVIDADES_AUTORIZABLES, estadoAutorizacion, etiquetaAutorizacion, faltantes, mensajeFaltante, METODOS_AUTORIZABLES, requisitoEquipo, type AutorizacionPersonal, type Requisito, type TipoAutorizacion } from "../shared/autorizaciones";
import { esFechaSola, hoyLocal, sumarDias } from "../shared/fechas";

const TABLE = "autorizaciones_personal";

/* ---------- Lectura ---------- */

async function nombresEquipos(s: Session, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const numeros = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isFinite(id)))];
  if (!numeros.length) return out;
  const filas = await s.query<Row>(`SELECT id, nombre, clave_bitacora FROM equipos WHERE id IN (${numeros.map((_, i) => `:e${i}`).join(", ")})`, Object.fromEntries(numeros.map((id, i) => [`e${i}`, id]))).catch(() => [] as Row[]);
  for (const f of filas) out.set(String(f.id), String(f.clave_bitacora || f.nombre || `#${f.id}`));
  return out;
}

async function serializar(s: Session, filas: Row[]): Promise<AutorizacionPersonal[]> {
  const hoy = hoyLocal();
  const equipos = await nombresEquipos(s, filas.filter((f) => f.tipo === "equipo").map((f) => String(f.clave)));
  return filas.map((f) => {
    const a = f as unknown as AutorizacionPersonal;
    return { ...a, estado: estadoAutorizacion(a, hoy), etiqueta: etiquetaAutorizacion(String(f.tipo), String(f.clave), equipos.get(String(f.clave))) };
  });
}

async function autorizacionesDe(s: Session, usuarioId: number): Promise<AutorizacionPersonal[]> {
  const filas = await s.query<Row>(`SELECT * FROM ${TABLE} WHERE usuario_id = :id ORDER BY revocada_en IS NOT NULL, tipo, clave, id DESC`, { id: usuarioId });
  return serializar(s, filas);
}

export async function vigentesDe(s: Session, usuarioId: number): Promise<AutorizacionPersonal[]> {
  return (await autorizacionesDe(s, usuarioId)).filter((a) => a.estado === "vigente");
}

/* ---------- Validacion al guardar ---------- */

/* Requisitos de los equipos usados que existen en el inventario (los demas no se validan). */
export async function requisitosEquipos(s: Session, ids: unknown[]): Promise<Requisito[]> {
  const limpios = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  const nombres = await nombresEquipos(s, limpios.map(String));
  return limpios.filter((id) => nombres.has(String(id))).map((id) => requisitoEquipo(id, nombres.get(String(id))!));
}

/*
 * Exige que quien actua (usuario de la sesion) tenga autorizacion vigente para
 * cada requisito. 403 `no_autorizado` con lo que falta.
 */
export async function exigirAutorizaciones(s: Session, user: CurrentUser, requisitos: Requisito[]): Promise<void> {
  if (!getConfig().AUTORIZACIONES_OBLIGATORIAS || !requisitos.length) return;
  const vigentes = await vigentesDe(s, userIdFromClaims(user) as number);
  const faltan = faltantes(requisitos, vigentes);
  if (faltan.length) throw new HttpError(403, { message: mensajeFaltante(faltan), codigo: "no_autorizado", faltan });
}

/* ---------- Administracion ---------- */

/* Otorgan y revocan: ensayos:A o calidad:A (Coord. Area Tecnica, Mejora Continua, Responsable General). */
export function permisoAdministrar(auth: Autorizacion): Permiso | null {
  return permisoDe(auth, "ensayos", "A") || permisoDe(auth, "calidad", "A");
}

async function exigirAdministrar(s: Session, user: CurrentUser): Promise<{ auth: Autorizacion; permiso: Permiso }> {
  const auth = await cargarAutorizacion(s, user);
  const permiso = permisoAdministrar(auth);
  if (!permiso) throw new HttpError(403, { message: "Registrar o revocar autorizaciones (FX-THF-AP) requiere aprobar ensayos o calidad (Coord. Área Técnica, Mejora Continua o Responsable General)" });
  return { auth, permiso };
}

function exigirOtraPersona(yo: number, usuarioId: number, que: string): void {
  if (Number(yo) === Number(usuarioId)) throw new HttpError(409, { message: `No puedes ${que} autorizaciones a ti mismo; lo debe hacer otra persona`, codigo: "segregacion", clave: "autorizacion_propia" });
}

async function cuenta(s: Session, usuarioId: number): Promise<Row> {
  const fila = await s.queryOne<Row>("SELECT id, email, nombre, vigente_hasta FROM usuarios WHERE id = :id", { id: usuarioId });
  if (!fila) throw new HttpError(404, { message: "Usuario no encontrado" });
  return fila;
}

/* GET /api/admin/usuarios/:id/autorizaciones: la persona misma, quien ve usuarios o quien las administra. */
export async function listarAutorizacionesUsuario({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const usuarioId = intParam(params.id);
  const auth = await cargarAutorizacion(s, user);
  const puedeAdministrar = !!permisoAdministrar(auth);
  if (auth.userId !== usuarioId && !puedeAdministrar) await requirePermission(s, user, "usuarios", "V", undefined, auth);
  await cuenta(s, usuarioId);
  return json({ items: await autorizacionesDe(s, usuarioId), puede_administrar: puedeAdministrar && auth.userId !== usuarioId });
}

/* GET /api/autorizaciones/mias: las propias, para "Mi cuenta" y los avisos de los formatos. */
export async function misAutorizaciones({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  return json({ items: await autorizacionesDe(s, userIdFromClaims(user) as number), obligatorias: getConfig().AUTORIZACIONES_OBLIGATORIAS });
}

/* GET /api/autorizaciones/catalogo: actividades, metodos y equipos activos del inventario. */
export async function catalogoAutorizaciones({ request, s }: RouteContext): Promise<Response> {
  await requireUser(request);
  const equipos = await s.query<Row>("SELECT id, nombre, clave_bitacora FROM equipos WHERE COALESCE(activo, 1) = 1 ORDER BY nombre").catch(() => [] as Row[]);
  return json({
    actividades: ACTIVIDADES_AUTORIZABLES,
    metodos: METODOS_AUTORIZABLES.map(({ value, label }) => ({ value, label })),
    equipos: equipos.map((e) => ({ value: String(e.id), label: e.clave_bitacora ? `${e.clave_bitacora} · ${e.nombre}` : String(e.nombre) })),
  });
}

/* POST /api/admin/usuarios/:id/autorizaciones */
export async function otorgarAutorizacion({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const usuarioId = intParam(params.id);
  const { permiso } = await exigirAdministrar(s, user);
  const yo = userIdFromClaims(user) as number;
  exigirOtraPersona(yo, usuarioId, "otorgarte");
  const persona = await cuenta(s, usuarioId);
  const payload = await readJson(request);
  const tipo = String(payload.tipo || "") as TipoAutorizacion;
  const clave = String(payload.clave || "").trim();
  if (tipo === "actividad" && !ACTIVIDADES_AUTORIZABLES.some((a) => a.value === clave)) throw new HttpError(400, { message: "Elige una actividad del catálogo" });
  else if (tipo === "metodo" && !METODOS_AUTORIZABLES.some((m) => m.value === clave)) throw new HttpError(400, { message: "Elige un método del catálogo" });
  else if (tipo === "equipo") {
    const equipo = await s.queryOne<Row>("SELECT id FROM equipos WHERE id = :id AND COALESCE(activo, 1) = 1", { id: Number(clave) || 0 }).catch(() => null);
    if (!equipo) throw new HttpError(400, { message: "Elige un equipo activo del inventario" });
  } else if (!["actividad", "metodo", "equipo"].includes(tipo)) throw new HttpError(400, { message: "Tipo de autorización inválido (actividad, método o equipo)" });
  const hoy = hoyLocal();
  const desde = String(payload.vigente_desde || "").trim() || hoy;
  const hasta = String(payload.vigente_hasta || "").trim() || null;
  if (!esFechaSola(desde) || (hasta && !esFechaSola(hasta))) throw new HttpError(400, { message: "Las fechas de vigencia deben ser AAAA-MM-DD" });
  if (hasta && hasta < desde) throw new HttpError(400, { message: "El fin de la vigencia no puede ser anterior al inicio" });
  const motivo = String(payload.motivo || "").trim();
  if (motivo.length < 5) throw new HttpError(400, { message: "Indica el motivo (al menos 5 caracteres)" });
  const folio = String(payload.folio_fx_thf_ap || payload.folio || "").trim().slice(0, 80) || null;
  const actuales = await autorizacionesDe(s, usuarioId);
  if (actuales.some((a) => a.tipo === tipo && a.clave === clave && (a.estado === "vigente" || a.estado === "por_iniciar"))) throw new HttpError(409, { message: "La persona ya tiene esa autorización vigente o por iniciar; revócala antes de registrar otra" });
  await exigirReauth(s, request, user, "autorizaciones:otorgar");
  const actuo = cargoActuante(request, permiso);
  const item = await insertarAutorizacion(s, user, { usuarioId, email: String(persona.email), tipo, clave, desde, hasta, folio, motivo, actuo });
  await s.commit();
  return json({ message: `Autorización registrada: ${item.etiqueta}`, item }, 201);
}

/* Inserta una autorizacion ya validada y la deja en la bitacora (sin commit). */
async function insertarAutorizacion(
  s: Session,
  user: CurrentUser,
  a: { usuarioId: number; email: string; tipo: TipoAutorizacion; clave: string; desde: string; hasta: string | null; folio: string | null; motivo: string; actuo: { rol_id: number; cargo: string } },
): Promise<AutorizacionPersonal> {
  const result = await s.execute(
    `INSERT INTO ${TABLE} (usuario_id, tipo, clave, vigente_desde, vigente_hasta, folio_fx_thf_ap, otorgada_por, otorgada_rol, otorgada_en, motivo)
     VALUES (:usuario_id, :tipo, :clave, :desde, :hasta, :folio, :por, :rol, :en, :motivo)`,
    { usuario_id: a.usuarioId, tipo: a.tipo, clave: a.clave, desde: a.desde, hasta: a.hasta, folio: a.folio, por: userIdFromClaims(user), rol: a.actuo.cargo, en: new Date().toISOString(), motivo: a.motivo },
  );
  const id = result.lastrowid as number;
  const [item] = await serializar(s, [(await s.queryOne<Row>(`SELECT * FROM ${TABLE} WHERE id = :id`, { id }))!]);
  await registrarAuditoria(s, user, {
    accion: "otorgar_autorizacion",
    entidad: "usuarios",
    entidadId: a.usuarioId,
    referencia: a.email,
    motivo: a.motivo,
    detalle: { autorizacion_id: id, tipo: a.tipo, clave: a.clave, autorizacion: item.etiqueta, vigente_desde: a.desde, vigente_hasta: a.hasta, folio_fx_thf_ap: a.folio, actuo_como: a.actuo },
  });
  return item;
}

/*
 * Fase 5: al dar de alta un equipo, "Autorizar a…" otorga en el mismo paso la
 * autorizacion del equipo a las personas elegidas. Exige poder otorgar y
 * reautenticacion; la propia persona se omite (nadie se autoriza a si misma).
 * No hace commit: lo hace quien llama junto con el alta del equipo.
 */
export async function autorizarEquipoA(s: Session, request: Request, user: CurrentUser, equipoId: number, personas: unknown[], folioIn?: unknown): Promise<{ autorizados: Array<{ usuario_id: number; email: string }>; omitidos: Array<{ usuario_id: number; motivo: string }> }> {
  const ids = [...new Set(personas.map((p) => Number(p)).filter((p) => Number.isFinite(p) && p > 0))];
  const out = { autorizados: [] as Array<{ usuario_id: number; email: string }>, omitidos: [] as Array<{ usuario_id: number; motivo: string }> };
  if (!ids.length) return out;
  const { permiso } = await exigirAdministrar(s, user);
  await exigirReauth(s, request, user, "autorizaciones:otorgar");
  const actuo = cargoActuante(request, permiso);
  const yo = userIdFromClaims(user) as number;
  const folio = String(folioIn || "").trim().slice(0, 80) || null;
  for (const usuarioId of ids) {
    if (usuarioId === yo) {
      out.omitidos.push({ usuario_id: usuarioId, motivo: "No puedes autorizarte a ti mismo; lo debe hacer otra persona" });
      continue;
    }
    const persona = await s.queryOne<Row>("SELECT id, email FROM usuarios WHERE id = :id AND COALESCE(activo, 1) = 1", { id: usuarioId });
    if (!persona) {
      out.omitidos.push({ usuario_id: usuarioId, motivo: "Cuenta inexistente o inactiva" });
      continue;
    }
    await insertarAutorizacion(s, user, { usuarioId, email: String(persona.email), tipo: "equipo", clave: String(equipoId), desde: hoyLocal(), hasta: null, folio, motivo: "Alta del equipo", actuo });
    out.autorizados.push({ usuario_id: usuarioId, email: String(persona.email) });
  }
  return out;
}

/* GET /api/autorizaciones/personas: cuentas activas, para "Autorizar a…" (solo quien puede otorgar). */
export async function personasAutorizables({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const { auth } = await exigirAdministrar(s, user);
  const filas = await s.query<Row>("SELECT id, nombre, email FROM usuarios WHERE COALESCE(activo, 1) = 1 ORDER BY nombre, email");
  return json({ items: filas.filter((f) => Number(f.id) !== auth.userId).map((f) => ({ id: Number(f.id), nombre: String(f.nombre || f.email), email: String(f.email) })) });
}

/* POST /api/admin/usuarios/:id/autorizaciones/:autorizacion/revocar */
export async function revocarAutorizacion({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const usuarioId = intParam(params.id);
  const autorizacionId = intParam(params.autorizacion);
  const { permiso } = await exigirAdministrar(s, user);
  const yo = userIdFromClaims(user) as number;
  exigirOtraPersona(yo, usuarioId, "revocarte");
  const persona = await cuenta(s, usuarioId);
  const fila = await s.queryOne<Row>(`SELECT * FROM ${TABLE} WHERE id = :id AND usuario_id = :usuario`, { id: autorizacionId, usuario: usuarioId });
  if (!fila) throw new HttpError(404, { message: "Autorización no encontrada" });
  if (fila.revocada_en) throw new HttpError(409, { message: "La autorización ya estaba revocada" });
  const payload = await readJson(request);
  const motivo = String(payload.motivo || "").trim();
  if (motivo.length < 5) throw new HttpError(400, { message: "Indica el motivo de la revocación (al menos 5 caracteres)" });
  await exigirReauth(s, request, user, "autorizaciones:revocar");
  const actuo = cargoActuante(request, permiso);
  await s.execute(`UPDATE ${TABLE} SET revocada_en = :en, revocada_por = :por, motivo_revocacion = :motivo WHERE id = :id AND revocada_en IS NULL`, { en: new Date().toISOString(), por: yo, motivo, id: autorizacionId });
  const [item] = await serializar(s, [(await s.queryOne<Row>(`SELECT * FROM ${TABLE} WHERE id = :id`, { id: autorizacionId }))!]);
  await registrarAuditoria(s, user, {
    accion: "revocar_autorizacion",
    entidad: "usuarios",
    entidadId: usuarioId,
    referencia: String(persona.email),
    motivo,
    detalle: { autorizacion_id: autorizacionId, tipo: fila.tipo, clave: fila.clave, autorizacion: item.etiqueta, actuo_como: actuo },
  });
  await s.commit();
  return json({ message: `Autorización revocada: ${item.etiqueta}`, item });
}

/* ---------- Vencimientos y avisos ---------- */

/* Deja en la bitacora (una vez) las autorizaciones cuya vigencia termino. Barrido del bootstrap. */
export async function registrarVencimientosAutorizaciones(s: Session): Promise<number> {
  const filas = await s.query<Row>(
    `SELECT a.*, u.email FROM ${TABLE} a LEFT JOIN usuarios u ON u.id = a.usuario_id
     WHERE a.revocada_en IS NULL AND a.vencimiento_registrado_en IS NULL AND a.vigente_hasta IS NOT NULL AND a.vigente_hasta < :hoy`,
    { hoy: hoyLocal() },
  );
  if (!filas.length) return 0;
  const items = await serializar(s, filas);
  for (const [i, fila] of filas.entries()) {
    await s.execute(`UPDATE ${TABLE} SET vencimiento_registrado_en = :en WHERE id = :id`, { en: new Date().toISOString(), id: fila.id });
    await registrarAuditoria(s, null, {
      accion: "vencer_autorizacion",
      entidad: "usuarios",
      entidadId: Number(fila.usuario_id),
      referencia: String(fila.email || fila.usuario_id),
      motivo: `Terminó la vigencia (${fila.vigente_hasta})`,
      detalle: { autorizacion_id: fila.id, tipo: fila.tipo, clave: fila.clave, autorizacion: items[i].etiqueta, vigente_hasta: fila.vigente_hasta },
    });
  }
  return filas.length;
}

/*
 * Autorizaciones vigentes que vencen en los proximos `dias` dias: las propias y,
 * para quien las administra, las de todo el personal.
 */
export async function autorizacionesPorVencer(s: Session, auth: Autorizacion, dias = 30): Promise<Array<AutorizacionPersonal & { persona: string; propia: boolean }>> {
  const hoy = hoyLocal();
  const limite = sumarDias(hoy, dias);
  const todas = !!permisoAdministrar(auth);
  const filas = await s.query<Row>(
    `SELECT a.*, COALESCE(u.nombre, u.email) AS persona FROM ${TABLE} a LEFT JOIN usuarios u ON u.id = a.usuario_id
     WHERE a.revocada_en IS NULL AND a.vigente_hasta IS NOT NULL AND a.vigente_hasta >= :hoy AND a.vigente_hasta <= :limite
       AND COALESCE(u.activo, 1) = 1 ${todas ? "" : "AND a.usuario_id = :yo"}
     ORDER BY a.vigente_hasta, a.id`,
    { hoy, limite, yo: auth.userId },
  );
  const items = await serializar(s, filas);
  return items.map((a, i) => ({ ...a, persona: String(filas[i].persona || ""), propia: Number(a.usuario_id) === auth.userId }));
}
