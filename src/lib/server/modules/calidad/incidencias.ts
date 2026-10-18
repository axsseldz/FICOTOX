/*
 * Incidencias (Fase 11; FX-MO-2-1 seccion 4 "reportar desviaciones", ISO/IEC
 * 17025 7.10). Estados: reportada -> en_evaluacion -> cerrada_sin_nc |
 * escalada_a_nc (mas anulada, por solicitud de segundo usuario).
 *
 * - Reportar: calidad:C con cualquier alcance. NO queda sujeto a visto bueno
 *   aunque la cuenta sea supervisada o temporal: reportar un problema nunca se bloquea.
 * - Ver: calidad:V total, o las propias con el alcance "incidencias".
 * - Evaluar (cerrar sin NC o escalar a una NC nueva o existente): calidad:R;
 *   regla 7: quien la reporto no la evalua (salvo excepcion aprobada).
 * - Anular: calidad:AN, con segundo usuario; una escalada solo si su NC esta anulada.
 */
import { documentosDistribuidosA, soloAutorizados } from "../documentos-flujo";
import { accesoSgc, documentoVisible } from "../sgc/acceso";
import { estaAsignado, soloAsignado } from "../../asignaciones";
import { requireUser, userIdFromClaims } from "../../auth";
import { registrarAuditoria, snapshotRow } from "../../audit";
import { type Row, type Session } from "../../db";
import { HttpError, intParam, json, readJson, type RouteContext } from "../../http";
import { cargoActuante, permisoDe, requirePermission } from "../../rbac";
import { exigirReauth } from "../../seguridad";
import { crearSolicitud, pendientesDe, respuestaSolicitud, serializarSolicitud } from "../../solicitudes";
import { detalleExcepcion, excepcionesDe, exigirSegregacion } from "../../segregacion";
import { evaluarIncidencia, excepcionPara } from "../../../shared/segregacion";
import { DESCRIPCION_INCIDENCIA_MIN, ENTIDADES_RELACIONABLES, ESTADOS_INCIDENCIA, IMPACTO_LABEL, ORIGEN_AUTOMATICO_LABEL, TIPO_INCIDENCIA_LABEL, TIPOS_INCIDENCIA, folioIncidencia, folioNc } from "../../../shared/calidad";
import { finDiaLocal, formatearFechaHora, hoyLocal, inicioDiaLocal } from "../../../shared/fechas";
import { accesoCalidad, ahora, exigirCalidad, exigirTexto, filaBloqueada, incidenciaVisible, respuestaCsv, siguienteFolio, T } from "./comun";
import { MODULO_REGISTRO, referenciaDe } from "./registros";
import { crearNcInterna } from "./nc";

const TIPOS = new Set(TIPOS_INCIDENCIA.map((t) => t.value));
const IMPACTOS = new Set(["si", "no", "desconocido"]);
const param = (request: Request, nombre: string) => (new URL(request.url).searchParams.get(nombre) || "").trim();

/* GET /api/calidad/incidencias?estado&tipo&desde&hasta&mias=1&search&entidad&entidad_id&anuladas=1&formato=csv */
export async function listarIncidencias({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const acc = await accesoCalidad(s, user, "incidencia");
  const estado = param(request, "estado");
  const tipo = param(request, "tipo");
  const desde = param(request, "desde");
  const hasta = param(request, "hasta");
  const search = param(request, "search");
  const entidad = param(request, "entidad");
  const entidadId = Number.parseInt(param(request, "entidad_id"), 10) || 0;
  const mias = param(request, "mias") === "1";
  const where: string[] = [];
  const valores: Record<string, unknown> = { yo: acc.yo };
  if (param(request, "anuladas") !== "1" && estado !== "anulada") where.push("i.estado <> 'anulada'");
  if (estado === "por_evaluar") where.push("i.estado IN ('reportada', 'en_evaluacion')");
  else if (estado) {
    where.push("i.estado = :estado");
    valores.estado = estado;
  }
  if (tipo) {
    where.push("i.tipo = :tipo");
    valores.tipo = tipo;
  }
  if (desde) {
    where.push("i.reportada_en >= :desde");
    valores.desde = inicioDiaLocal(desde);
  }
  if (hasta) {
    where.push("i.reportada_en <= :hasta");
    valores.hasta = finDiaLocal(hasta);
  }
  // Alcance "incidencias": solo las propias, por cualquier via (lista, busqueda, registro, CSV).
  if (mias || !acc.total) where.push("i.reportada_por = :yo");
  if (search) {
    where.push("(i.descripcion LIKE :like OR CAST(i.folio_num AS CHAR) LIKE :like OR i.reportada_nombre LIKE :like)");
    valores.like = `%${search}%`;
  }
  if (entidad && entidadId) {
    where.push(`i.id IN (SELECT incidencia_id FROM ${T.registros} WHERE entidad = :entidad AND entidad_id = :eid)`);
    Object.assign(valores, { entidad, eid: entidadId });
  }
  const filas = await s.query<Row>(
    `SELECT i.*, n.folio_num AS nc_folio, (SELECT COUNT(*) FROM ${T.registros} r WHERE r.incidencia_id = i.id) AS registros
     FROM ${T.incidencias} i LEFT JOIN ${T.nc} n ON n.id = i.nc_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY i.folio_num DESC LIMIT 1000`,
    valores,
  );
  if (param(request, "formato") === "csv") {
    await registrarAuditoria(s, user, { accion: "exportar", entidad: T.incidencias, referencia: "Incidencias", detalle: { formato: "csv", filas: filas.length, filtros: { estado, tipo, desde, hasta, search, mias } } });
    await s.commit();
    return respuestaCsv(`incidencias-${hoyLocal()}.csv`, ["Folio", "Tipo", "Estado", "Ocurrió", "Reportada", "Reportada por", "Impacto en resultados", "Origen", "NC", "Descripción"], filas.map((f) => [folioIncidencia(f.folio_num), TIPO_INCIDENCIA_LABEL[String(f.tipo)] || f.tipo, ESTADOS_INCIDENCIA[String(f.estado)]?.label || f.estado, formatearFechaHora(f.fecha_hora_ocurrencia), formatearFechaHora(f.reportada_en), f.reportada_nombre, IMPACTO_LABEL[String(f.impacto_resultados)] || f.impacto_resultados, f.origen_automatico ? ORIGEN_AUTOMATICO_LABEL[String(f.origen_automatico)] || f.origen_automatico : "Manual", f.nc_folio ? folioNc(f.nc_folio) : "", f.descripcion]));
  }
  return json({ items: filas.map((f) => ({ ...f, folio: folioIncidencia(f.folio_num), nc_folio_label: f.nc_folio ? folioNc(f.nc_folio) : null })), total: filas.length, alcance: acc.total ? "total" : "incidencias" });
}

/* Registros ligados de una incidencia, con su enlace. */
/* Registros de calidad que liga el sistema (alertas de adjuntos de incidencias o acciones); no se ligan a mano. */
const REGISTROS_CALIDAD: Record<string, { label: string; ruta: (id: number) => string }> = {
  incidencias: { label: "Incidencia", ruta: (id) => `/calidad/incidencias/${id}` },
  no_conformidades: { label: "No conformidad", ruta: (id) => `/calidad/nc/${id}` },
};

async function registrosDe(s: Session, incidenciaId: number): Promise<Row[]> {
  const filas = await s.query<Row>(`SELECT * FROM ${T.registros} WHERE incidencia_id = :id ORDER BY id`, { id: incidenciaId });
  return filas.map((f) => {
    const meta = ENTIDADES_RELACIONABLES[String(f.entidad)] || REGISTROS_CALIDAD[String(f.entidad)];
    return { ...f, etiqueta: meta?.label || f.entidad, href: meta?.ruta(Number(f.entidad_id)) || null };
  });
}

/* POST /api/calidad/incidencias { tipo, fecha_hora_ocurrencia, descripcion, accion_inmediata?, impacto_resultados, registros?: [{entidad, entidad_id}] } */
export async function crearIncidencia({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await exigirCalidad(s, user, "C", "incidencia");
  const actuo = cargoActuante(request, permiso);
  const payload = await readJson(request);
  const tipo = String(payload.tipo || "").trim();
  if (!TIPOS.has(tipo)) throw new HttpError(400, { message: "Elige el tipo de incidencia" });
  const descripcion = exigirTexto(payload.descripcion, DESCRIPCION_INCIDENCIA_MIN, "Describe qué pasó");
  const impacto = String(payload.impacto_resultados || "desconocido");
  if (!IMPACTOS.has(impacto)) throw new HttpError(400, { message: "Indica si afecta resultados: sí, no o no se sabe" });
  const ocurrencia = new Date(String(payload.fecha_hora_ocurrencia || ""));
  if (Number.isNaN(ocurrencia.getTime())) throw new HttpError(400, { message: "Indica cuándo ocurrió" });
  if (ocurrencia.getTime() > Date.now() + 5 * 60_000) throw new HttpError(400, { message: "La fecha de ocurrencia no puede ser futura" });
  const lista = Array.isArray(payload.registros) ? payload.registros.slice(0, 12) : [];
  const registros: Array<{ entidad: string; entidad_id: number; referencia: string }> = [];
  for (const r of lista as Array<Record<string, unknown>>) {
    const entidad = String(r?.entidad || "");
    const eid = Number.parseInt(String(r?.entidad_id || ""), 10);
    if (!entidad || !Number.isFinite(eid)) continue;
    if (registros.some((x) => x.entidad === entidad && x.entidad_id === eid)) continue;
    // Solo se liga lo que la persona puede ver (el mismo 404 que si no existiera: no sirve para enumerar).
    const noExiste = new HttpError(404, { message: `${ENTIDADES_RELACIONABLES[entidad]?.label || "Registro"} #${eid} no existe` });
    const vista = MODULO_REGISTRO[entidad] ? permisoDe(permiso.auth, MODULO_REGISTRO[entidad], "V") : null;
    if (MODULO_REGISTRO[entidad] && !vista) throw noExiste;
    // Con alcance "autorizados" (documentos), solo documentos vigentes distribuidos a la persona (Fase 7).
    if (entidad === "documentos_sgc" && soloAutorizados(permiso.auth)) {
      const doc = await s.queryOne<Row>("SELECT estado FROM documentos_sgc WHERE id = :id", { id: eid });
      if (!doc || String(doc.estado) !== "vigente" || !(await documentosDistribuidosA(s, permiso.auth.userId)).includes(eid)) throw noExiste;
    }
    // Biblioteca: con "autorizados", solo documentos para todos o para alguno de sus roles.
    if (entidad === "biblioteca_documentos" && soloAutorizados(permiso.auth)) {
      const doc = await s.queryOne<Row>("SELECT visibilidad FROM biblioteca_documentos WHERE id = :id", { id: eid });
      const roles = permiso.auth.roles.map((r) => Number(r.id));
      const permitidos = doc && String(doc.visibilidad) !== "todos" ? (await s.query<Row>("SELECT rol_id FROM biblioteca_visibilidad_roles WHERE documento_id = :id", { id: eid })).map((r) => Number(r.rol_id)) : [];
      if (!doc || (String(doc.visibilidad) !== "todos" && !permitidos.some((r) => roles.includes(r)))) throw noExiste;
    }
    // Documentos SGC: solo los que la persona puede ver (confidencialidad, revisiones visibles).
    if (entidad === "sgc_documentos") await documentoVisible(s, await accesoSgc(s, permiso.auth), eid).catch(() => {
      throw noExiste;
    });
    // Con alcance "asignado" (muestras), solo recepciones asignadas o registradas por la persona.
    if (entidad === "muestras_recepcion" && soloAsignado(vista)) {
      const recepcion = await s.queryOne<Row>("SELECT id, creado_por FROM muestras_recepcion WHERE id = :id", { id: eid });
      if (!recepcion || (Number(recepcion.creado_por) !== permiso.auth.userId && !(await estaAsignado(s, permiso.auth.userId, eid)))) throw noExiste;
    }
    registros.push({ entidad, entidad_id: eid, referencia: await referenciaDe(s, entidad, eid) });
  }
  const folio = await siguienteFolio(s, T.incidencias);
  const yo = userIdFromClaims(user);
  const r = await s.execute(
    `INSERT INTO ${T.incidencias} (folio_num, tipo, fecha_hora_ocurrencia, descripcion, accion_inmediata, impacto_resultados, estado, reportada_por, reportada_nombre, reportada_rol, reportada_en)
     VALUES (:folio, :tipo, :ocurrencia, :descripcion, :accion, :impacto, 'reportada', :por, :nombre, :rol, :en)`,
    { folio, tipo, ocurrencia: ocurrencia.toISOString(), descripcion, accion: String(payload.accion_inmediata || "").trim() || null, impacto, por: yo, nombre: String(user.nombre || user.email || ""), rol: actuo.cargo, en: ahora() },
  );
  const id = Number(r.lastrowid);
  for (const reg of registros) await s.execute(`INSERT INTO ${T.registros} (incidencia_id, entidad, entidad_id, referencia) VALUES (:inc, :e, :eid, :ref)`, { inc: id, e: reg.entidad, eid: reg.entidad_id, ref: reg.referencia });
  const despues = await snapshotRow(s, T.incidencias, id);
  await registrarAuditoria(s, user, { accion: "reportar", entidad: T.incidencias, entidadId: id, referencia: folioIncidencia(folio), despues, detalle: { tipo, impacto, registros: registros.map((x) => x.referencia).join(", ") || null, actuo_como: actuo } });
  await s.commit();
  return json({ message: `Incidencia ${folioIncidencia(folio)} reportada`, id, folio: folioIncidencia(folio) }, 201);
}

/* GET /api/calidad/incidencias/:id */
export async function getIncidencia({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const acc = await accesoCalidad(s, user, "incidencia");
  const row = await incidenciaVisible(s, acc, intParam(params.id));
  const nc = row.nc_id ? await s.queryOne<Row>(`SELECT id, folio_num, estado, responsable_id FROM ${T.nc} WHERE id = :id`, { id: row.nc_id }) : null;
  const violacion = evaluarIncidencia(acc.yo, row.reportada_por);
  const bloqueo = violacion && !excepcionPara(excepcionesDe(row), acc.yo, "evaluar") ? violacion.mensaje : null;
  const pendiente = (await pendientesDe(s, T.incidencias, [Number(row.id)])).get(String(row.id));
  const evaluable = ["reportada", "en_evaluacion"].includes(String(row.estado));
  const evaluador = row.evaluada_por ? await s.queryOne<Row>("SELECT nombre FROM usuarios WHERE id = :id", { id: row.evaluada_por }) : null;
  return json({
    item: {
      ...row,
      folio: folioIncidencia(row.folio_num),
      evaluada_nombre: evaluador?.nombre || null,
      excepciones: excepcionesDe(row),
      registros: await registrosDe(s, Number(row.id)),
      nc: nc ? { ...nc, folio: folioNc(nc.folio_num) } : null,
      solicitud_pendiente: pendiente ? serializarSolicitud(pendiente) : null,
      segregacion: { evaluar: bloqueo },
      puede: { evaluar: acc.puede("R") && evaluable, anular: acc.puede("AN") && String(row.estado) !== "anulada", crear_nc: acc.puede("R") || acc.puede("G") },
    },
  });
}

/* Carga para evaluar: calidad:R, visible, en estado evaluable y sin solicitud pendiente; regla 7. */
async function paraEvaluar(s: Session, request: Request, id: number) {
  const user = await requireUser(request);
  const permiso = await exigirCalidad(s, user, "R", "incidencia");
  const actuo = cargoActuante(request, permiso);
  const acc = await accesoCalidad(s, user, "incidencia");
  const row = await incidenciaVisible(s, acc, id, true);
  if (String(row.estado) === "escalada_a_nc" || String(row.estado) === "cerrada_sin_nc") throw new HttpError(409, { message: `La incidencia ${folioIncidencia(row.folio_num)} ya está ${ESTADOS_INCIDENCIA[String(row.estado)].label.toLowerCase()}; no se vuelve a evaluar`, codigo: "incidencia_resuelta" });
  if (String(row.estado) === "anulada") throw new HttpError(409, { message: "La incidencia está anulada" });
  if ((await pendientesDe(s, T.incidencias, [id])).get(String(id))) throw new HttpError(409, { message: "La incidencia tiene una solicitud de anulación pendiente", codigo: "solicitud_pendiente" });
  const excepcion = exigirSegregacion(evaluarIncidencia(acc.yo, row.reportada_por), row, acc.yo, "evaluar");
  return { user, actuo, acc, row, excepcion };
}

/* POST /api/calidad/incidencias/:id/evaluacion: inicia la evaluacion (reportada -> en_evaluacion). */
export async function iniciarEvaluacion({ request, s, params }: RouteContext): Promise<Response> {
  const { user, actuo, row, excepcion } = await paraEvaluar(s, request, intParam(params.id));
  if (String(row.estado) !== "reportada") throw new HttpError(409, { message: "La evaluación ya está en curso" });
  await s.execute(`UPDATE ${T.incidencias} SET estado = 'en_evaluacion', en_evaluacion_por = :por, en_evaluacion_en = :en WHERE id = :id AND estado = 'reportada'`, { por: userIdFromClaims(user), en: ahora(), id: row.id });
  await registrarAuditoria(s, user, { accion: "evaluar", entidad: T.incidencias, entidadId: Number(row.id), referencia: folioIncidencia(row.folio_num), antes: row, despues: await snapshotRow(s, T.incidencias, Number(row.id)), detalle: { etapa: "inicio", actuo_como: actuo, ...detalleExcepcion(excepcion) } });
  await s.commit();
  return json({ message: "Evaluación iniciada" });
}

/*
 * POST /api/calidad/incidencias/:id/evaluar { decision: cerrar_sin_nc | escalar, justificacion,
 *   nc_id? (NC existente), nc?: { clasificacion, requisito_incumplido, descripcion, responsable_id } }
 */
export async function evaluarIncidenciaApi({ request, s, params }: RouteContext): Promise<Response> {
  const { user, actuo, row, excepcion } = await paraEvaluar(s, request, intParam(params.id));
  const payload = await readJson(request);
  const decision = String(payload.decision || "");
  if (decision !== "cerrar_sin_nc" && decision !== "escalar") throw new HttpError(400, { message: "Elige la decisión: cerrar sin NC o escalar a no conformidad" });
  const justificacion = exigirTexto(payload.justificacion, 10, "Justifica la decisión");
  const yo = userIdFromClaims(user);
  let nc: Row | null = null;
  if (decision === "escalar") {
    const ncId = Number.parseInt(String(payload.nc_id || ""), 10);
    if (Number.isFinite(ncId) && ncId > 0) {
      // Una NC puede agrupar varias incidencias.
      nc = await filaBloqueada(s, T.nc, ncId);
      if (!nc) throw new HttpError(404, { message: "No conformidad no encontrada" });
      if (["cerrada", "anulada"].includes(String(nc.estado))) throw new HttpError(409, { message: `La ${folioNc(nc.folio_num)} está ${nc.estado}; escala a una NC abierta o crea una nueva` });
    } else {
      const datos = (payload.nc && typeof payload.nc === "object" ? payload.nc : {}) as Record<string, unknown>;
      nc = await crearNcInterna(s, user, actuo, { origen: "incidencia", incidencia_id: Number(row.id), descripcion: String(datos.descripcion || row.descripcion), clasificacion: datos.clasificacion, requisito_incumplido: datos.requisito_incumplido, responsable_id: datos.responsable_id });
    }
  }
  const estado = decision === "escalar" ? "escalada_a_nc" : "cerrada_sin_nc";
  const r = await s.execute(
    `UPDATE ${T.incidencias} SET estado = :estado, evaluada_por = :por, evaluada_rol = :rol, evaluada_en = :en, decision_evaluacion = :decision, justificacion = :just, nc_id = :nc
     WHERE id = :id AND estado IN ('reportada', 'en_evaluacion')`,
    { estado, por: yo, rol: actuo.cargo, en: ahora(), decision, just: justificacion, nc: nc ? nc.id : null, id: row.id },
  );
  if (!r.rowcount) throw new HttpError(409, { message: "La incidencia ya fue evaluada por otra persona" });
  await registrarAuditoria(s, user, {
    accion: decision === "escalar" ? "escalar" : "cerrar_sin_nc",
    entidad: T.incidencias,
    entidadId: Number(row.id),
    referencia: folioIncidencia(row.folio_num),
    motivo: justificacion,
    antes: row,
    despues: await snapshotRow(s, T.incidencias, Number(row.id)),
    detalle: { nc: nc ? folioNc(nc.folio_num) : null, actuo_como: actuo, ...detalleExcepcion(excepcion) },
  });
  // Tambien en el historial de la NC: la incidencia que se le agrego (la NC nueva ya registra su origen al crearse).
  if (nc && Number(nc.incidencia_id) !== Number(row.id)) {
    // Sin la justificacion (queda en la incidencia): el historial de la NC lo ve tambien el responsable de una accion.
    await registrarAuditoria(s, user, { accion: "escalar", entidad: T.nc, entidadId: Number(nc.id), referencia: folioNc(nc.folio_num), detalle: { incidencia: folioIncidencia(row.folio_num), agrupada: true, actuo_como: actuo } });
  }
  await s.commit();
  return json({ message: decision === "escalar" ? `Incidencia escalada a ${folioNc(nc!.folio_num)}` : "Incidencia cerrada sin NC", nc_id: nc ? nc.id : null });
}

/* POST /api/calidad/incidencias/:id/anular { motivo }: calidad:AN, segundo usuario. */
export async function anularIncidencia({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "calidad", "AN", { objeto: "incidencia" });
  const actuo = cargoActuante(request, permiso);
  const acc = await accesoCalidad(s, user, "incidencia");
  const row = await incidenciaVisible(s, acc, intParam(params.id), true);
  if (String(row.estado) === "anulada") throw new HttpError(409, { message: "La incidencia ya está anulada" });
  if (String(row.estado) === "escalada_a_nc") {
    const nc = await s.queryOne<Row>(`SELECT folio_num, estado FROM ${T.nc} WHERE id = :id`, { id: row.nc_id });
    if (nc && String(nc.estado) !== "anulada") throw new HttpError(409, { message: `La incidencia está escalada a ${folioNc(nc.folio_num)}; solo se anula si esa NC está anulada`, codigo: "nc_vigente" });
  }
  const motivo = exigirTexto((await readJson(request)).motivo, 5, "Indica el motivo de la anulación");
  await exigirReauth(s, request, user, "calidad:AN");
  const solicitud = await crearSolicitud(s, user, { tipo: "anular_calidad", entidad: T.incidencias, entidadId: Number(row.id), referencia: folioIncidencia(row.folio_num), accion: "anular", motivo, cargo: actuo.cargo });
  await s.commit();
  return respuestaSolicitud(solicitud, `la anulación de la incidencia ${folioIncidencia(row.folio_num)}`);
}

/* Excepcion de segregacion (regla 7): solo la pide quien puede evaluar y la regla se lo impide. */
export async function violacionParaExcepcionIncidencia(s: Session, user: Parameters<typeof accesoCalidad>[1], id: number, accion: string) {
  if (accion !== "evaluar") throw new HttpError(400, { message: "En una incidencia la excepción aplica a evaluar" });
  await exigirCalidad(s, user, "R", "incidencia");
  const acc = await accesoCalidad(s, user, "incidencia");
  const row = await incidenciaVisible(s, acc, id);
  if (!["reportada", "en_evaluacion"].includes(String(row.estado))) throw new HttpError(409, { message: "La incidencia ya no se evalúa" });
  return { violacion: evaluarIncidencia(acc.yo, row.reportada_por), row, referencia: folioIncidencia(row.folio_num) };
}
