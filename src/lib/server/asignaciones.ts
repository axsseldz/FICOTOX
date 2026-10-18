/*
 * Asignacion de muestras (Fase 5, seccion 7 de la especificacion).
 *
 * - Una recepcion aceptada se asigna a una o mas personas; asigna y reasigna
 *   quien tiene muestras:A (Coord. Area Tecnica). Nada se borra: revocar llena
 *   las columnas de revocacion. Todo queda en la bitacora.
 * - Alcance "asignado": la persona ve y edita solo las recepciones asignadas a
 *   ella (y las que ella misma registro).
 * - Regla operativa: crear o editar procesamiento, extraccion o analisis exige
 *   estar asignado a la recepcion, salvo la coordinacion (muestras:A o
 *   ensayos:A). Sin asignacion: 403 "no_asignado".
 * - Al asignar se avisa (sin bloquear) si la persona no tiene las
 *   autorizaciones FX-THF-AP de los analisis solicitados.
 */
import { formatearFolio } from "../shared/folios";
import { requireUser, userIdFromClaims, type CurrentUser } from "./auth";
import { registrarAuditoria, snapshotRow } from "./audit";
import { vigentesDe } from "./autorizaciones";
import { type Row, type Session } from "./db";
import { HttpError, intParam, json, readJson, type RouteContext } from "./http";
import { cargarAutorizacion, cargoActuante, permisoDe, requirePermission, type Autorizacion, type Permiso } from "./rbac";

import { faltantes, mensajeFaltante, metodoDeTipoAnalisis, type Requisito } from "../shared/autorizaciones";

const TABLE = "asignaciones_muestra";

/* Coordinacion: muestras:A o ensayos:A no necesitan asignacion. */
export const esCoordinacion = (auth: Autorizacion): boolean => !!(permisoDe(auth, "muestras", "A") || permisoDe(auth, "ensayos", "A"));

/* Un permiso cuyo unico alcance es "asignado" (sin total ni otro que lo amplie). */
export const soloAsignado = (permiso: Permiso | null | undefined): boolean => !!permiso && permiso.alcances.length > 0 && permiso.alcances.every((a) => a === "asignado");

export async function estaAsignado(s: Session, usuarioId: number, recepcionId: number): Promise<boolean> {
  return !!(await s.scalar(`SELECT id FROM ${TABLE} WHERE recepcion_id = :r AND usuario_id = :u AND revocado_en IS NULL LIMIT 1`, { r: recepcionId, u: usuarioId }));
}

/* Recepciones asignadas (vigentes) a una persona. */
async function recepcionesAsignadas(s: Session, usuarioId: number): Promise<number[]> {
  const filas = await s.query<{ recepcion_id: number }>(`SELECT DISTINCT recepcion_id FROM ${TABLE} WHERE usuario_id = :u AND revocado_en IS NULL`, { u: usuarioId });
  return filas.map((f) => Number(f.recepcion_id));
}

/*
 * Filtro SQL para listas: con `soloMias` (filtro "Mis muestras") o con alcance
 * "asignado", solo las recepciones asignadas a la persona o registradas por ella.
 * `columna` es la columna con el id de la recepcion en la consulta.
 */
export async function filtroAsignadas(s: Session, usuarioId: number, columna: string, activo: boolean, creadoPor?: string): Promise<{ sql: string; params: Record<string, unknown> }> {
  if (!activo) return { sql: "", params: {} };
  const ids = await recepcionesAsignadas(s, usuarioId);
  const lista = ids.length ? ids.join(", ") : "0";
  return { sql: `AND (${columna} IN (${lista})${creadoPor ? ` OR ${creadoPor} = :filtro_asignado_yo` : ""})`, params: creadoPor ? { filtro_asignado_yo: usuarioId } : {} };
}

/* Alcance "asignado" en la ficha de una recepcion: asignada o registrada por la persona. */
export async function exigirVistaAsignada(s: Session, permiso: Permiso, recepcion: Row): Promise<void> {
  if (!soloAsignado(permiso)) return;
  const yo = permiso.auth.userId;
  if (Number(recepcion.creado_por) === yo || (await estaAsignado(s, yo, Number(recepcion.id)))) return;
  throw new HttpError(403, { message: "Esta muestra no está asignada a ti", codigo: "no_asignado" });
}

/* Regla operativa: crear o editar procesamiento, extraccion o analisis exige asignacion (salvo coordinacion). */
export async function exigirAsignacion(s: Session, user: CurrentUser, recepcionId: number | null | undefined, auth?: Autorizacion): Promise<void> {
  if (!recepcionId) return;
  const autorizacion = auth || (await cargarAutorizacion(s, user));
  if (esCoordinacion(autorizacion)) return;
  if (await estaAsignado(s, autorizacion.userId, recepcionId)) return;
  const folio = await s.scalar("SELECT folio_num FROM muestras_recepcion WHERE id = :id", { id: recepcionId });
  throw new HttpError(403, { message: `No estás asignado a la muestra ${formatearFolio("R", folio || recepcionId)}; pide a la coordinación técnica que te la asigne`, codigo: "no_asignado" });
}

/* ---------- Endpoints ---------- */

async function recepcionAsignable(s: Session, recepcionId: number): Promise<Row> {
  const row = await snapshotRow(s, "muestras_recepcion", recepcionId);
  if (!row) throw new HttpError(404, { message: "Recepción no encontrada" });
  return row;
}

const folioR = (row: Row) => formatearFolio("R", row.folio_num);

async function listar(s: Session, recepcionId: number): Promise<Row[]> {
  return s.query<Row>(
    `SELECT a.*, u.nombre, u.email, p.nombre AS asignado_por_nombre FROM ${TABLE} a
     LEFT JOIN usuarios u ON u.id = a.usuario_id LEFT JOIN usuarios p ON p.id = a.asignado_por
     WHERE a.recepcion_id = :r ORDER BY a.revocado_en IS NOT NULL, a.id`,
    { r: recepcionId },
  );
}

/* Autorizaciones FX-THF-AP que le faltarian a la persona para los analisis solicitados (aviso). */
async function avisoAutorizaciones(s: Session, usuarioId: number, recepcion: Row): Promise<string | null> {
  let tipos: string[] = [];
  try {
    tipos = (JSON.parse(String(recepcion.analisis_json || "{}")) as { tipos?: string[] }).tipos || [];
  } catch {
    tipos = [];
  }
  const requisitos: Requisito[] = [
    { tipo: "actividad", clave: "procesamiento", texto: "procesamiento" },
    { tipo: "actividad", clave: "analisis", texto: "análisis" },
    ...tipos.map((t) => metodoDeTipoAnalisis(t)).filter((m): m is string => !!m).map((m) => ({ tipo: "metodo" as const, clave: m, texto: `el método ${m}` })),
  ];
  const faltan = faltantes(requisitos, await vigentesDe(s, usuarioId));
  return faltan.length ? mensajeFaltante(faltan).replace("No tienes", "La persona no tiene") : null;
}

/* GET /api/samples/reception/:id/asignaciones */
export async function listarAsignaciones({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "muestras", "V");
  const recepcion = await recepcionAsignable(s, intParam(params.id));
  await exigirVistaAsignada(s, permiso, recepcion);
  return json({ items: await listar(s, Number(recepcion.id)), puede_asignar: !!permisoDe(permiso.auth, "muestras", "A") });
}

/* POST /api/samples/reception/:id/asignaciones { usuario_id, motivo? } */
export async function asignarMuestra({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const actuo = cargoActuante(request, await requirePermission(s, user, "muestras", "A"));
  const recepcion = await recepcionAsignable(s, intParam(params.id));
  if (!["aceptada", "aceptada_con_desviacion"].includes(String(recepcion.decision_aceptacion || "")) || ["anulada", "rechazada", "cerrada"].includes(String(recepcion.estado))) {
    throw new HttpError(409, { message: `La recepción ${folioR(recepcion)} no está aceptada o ya terminó; no se asigna` });
  }
  const payload = await readJson(request);
  const usuarioId = Number(payload.usuario_id) || 0;
  const persona = await s.queryOne<Row>("SELECT id, nombre, email, activo FROM usuarios WHERE id = :id", { id: usuarioId });
  if (!persona || !Number(persona.activo ?? 1)) throw new HttpError(400, { message: "Elige una cuenta activa" });
  if (await estaAsignado(s, usuarioId, Number(recepcion.id))) throw new HttpError(409, { message: `${persona.nombre || persona.email} ya está asignado a ${folioR(recepcion)}` });
  const motivo = String(payload.motivo || "").trim() || null;
  const result = await s.execute(`INSERT INTO ${TABLE} (recepcion_id, usuario_id, asignado_por, asignado_en, motivo) VALUES (:r, :u, :por, :en, :motivo)`, { r: recepcion.id, u: usuarioId, por: userIdFromClaims(user), en: new Date().toISOString(), motivo });
  const aviso = await avisoAutorizaciones(s, usuarioId, recepcion);
  await registrarAuditoria(s, user, {
    accion: "asignar_muestra",
    entidad: "muestras_recepcion",
    entidadId: Number(recepcion.id),
    referencia: folioR(recepcion),
    motivo,
    detalle: { asignacion_id: result.lastrowid, usuario_id: usuarioId, persona: persona.nombre || persona.email, aviso_autorizaciones: aviso, actuo_como: actuo },
  });
  await s.commit();
  return json({ message: `${persona.nombre || persona.email} asignado a ${folioR(recepcion)}`, aviso, items: await listar(s, Number(recepcion.id)) }, 201);
}

/* POST /api/samples/reception/:id/asignaciones/:asignacion/revocar { motivo } */
export async function revocarAsignacion({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const actuo = cargoActuante(request, await requirePermission(s, user, "muestras", "A"));
  const recepcion = await recepcionAsignable(s, intParam(params.id));
  const fila = await s.queryOne<Row>(`SELECT a.*, u.nombre, u.email FROM ${TABLE} a LEFT JOIN usuarios u ON u.id = a.usuario_id WHERE a.id = :id AND a.recepcion_id = :r`, { id: intParam(params.asignacion), r: recepcion.id });
  if (!fila) throw new HttpError(404, { message: "Asignación no encontrada" });
  if (fila.revocado_en) throw new HttpError(409, { message: "La asignación ya estaba revocada" });
  const payload = await readJson(request);
  const motivo = String(payload.motivo || "").trim();
  if (motivo.length < 5) throw new HttpError(400, { message: "Indica el motivo (al menos 5 caracteres)" });
  await s.execute(`UPDATE ${TABLE} SET revocado_en = :en, revocado_por = :por, motivo_revocacion = :motivo WHERE id = :id`, { en: new Date().toISOString(), por: userIdFromClaims(user), motivo, id: fila.id });
  await registrarAuditoria(s, user, { accion: "revocar_asignacion", entidad: "muestras_recepcion", entidadId: Number(recepcion.id), referencia: folioR(recepcion), motivo, detalle: { asignacion_id: fila.id, usuario_id: fila.usuario_id, persona: fila.nombre || fila.email, actuo_como: actuo } });
  await s.commit();
  return json({ message: `Asignación revocada: ${fila.nombre || fila.email}`, items: await listar(s, Number(recepcion.id)) });
}
