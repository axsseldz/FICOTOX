/*
 * No conformidades, acciones correctivas, comunicaciones, retencion de
 * informes y suspensiones (Fase 11; ISO/IEC 17025 7.10 trabajo no conforme y
 * 8.7 acciones correctivas).
 *
 * Etapas: abierta -> en_analisis -> acciones_en_curso -> en_verificacion ->
 * cerrada (mas anulada). Solo hacia adelante, salvo "no eficaz", que regresa a
 * en_analisis (reapertura con motivo; se cuentan las reaperturas). Una NC que no
 * requiere accion correctiva (8.7.1: no puede repetirse) se cierra tras la
 * evaluacion de impacto, con justificacion.
 *
 * Permisos (FX-MO-2-1 seccion 5; por permiso, no por rol):
 * - crear NC directa: calidad:R o calidad:G;
 * - editar (impacto, causa, acciones, comunicaciones): calidad:G, o el
 *   responsable de la NC si tiene calidad:C o mas, mientras no este cerrada;
 * - implementar una accion: su responsable o calidad:G;
 * - verificar eficacia, suspender, retener: calidad:R;
 * - reanudar, liberar retencion, cerrar: calidad:A con reautenticacion;
 * - anular: calidad:AN con segundo usuario.
 * Segregacion (reglas 8, 9, 10): el responsable de una accion no verifica; el
 * responsable de la NC no la cierra; quien suspendio no reanuda.
 *
 * La verificacion de eficacia se hace por NC (no por accion): 8.7.1 d pide
 * revisar la eficacia de las acciones tomadas frente a la causa; una sola
 * verificacion independiente de todos los responsables evita cerrar una NC con
 * acciones "eficaces" por separado que en conjunto no eliminan la causa.
 */
import { formatearFolio } from "../../../shared/folios";
import { syncEquipoEstado } from "../inventory";
import { expandirPermisos, permite } from "../../../shared/permisos";
import { incidenciaPorAlertaIntegridad } from "./automaticas";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { requireUser, userIdFromClaims, type CurrentUser } from "../../auth";
import { registrarAuditoria, snapshotRow } from "../../audit";
import { getConfig } from "../../config";
import { type Row, type Session } from "../../db";
import { HttpError, intParam, json, readJson, type RouteContext } from "../../http";
import { cargarAutorizacion, cargoActuante, permisoDe, requirePermission, rolesVigentes, type Permiso } from "../../rbac";
import { exigirReauth } from "../../seguridad";
import { crearSolicitud, pendientesDe, respuestaSolicitud, serializarSolicitud } from "../../solicitudes";
import { detalleExcepcion, excepcionesDe, exigirSegregacion } from "../../segregacion";
import { evaluarCierreNc, evaluarReanudacion, evaluarVerificacion, excepcionPara } from "../../../shared/segregacion";
import { CLASIFICACION_NC_LABEL, ESTADOS_ACCION, ESTADOS_NC, METODOS_CAUSA, METODOS_SUSPENDIBLES, MEDIOS_COMUNICACION, ORIGEN_NC_LABEL, ORIGENES_NC, accionVencida, folioIncidencia, folioNc, RANGO_NC } from "../../../shared/calidad";
import { fechaValida, finDiaLocal, formatearFecha, formatearFechaHora, hoyLocal, inicioDiaLocal } from "../../../shared/fechas";
import { accesoCalidad, ahora, conPrevio, exigirTexto, filaBloqueada, ncVisible, personaVigente, previosDe, respuestaCsv, siguienteFolio, T, type AccesoCalidad } from "./comun";
import { accionVisible } from "./adjuntos";
import { retencionesActivas, suspensionesActivas } from "./bloqueos";
import { referenciaDe } from "./registros";
import { renderNcPdf } from "./nc-pdf";
import { funcionalidadRetirada } from "../../retirado";

const CLASIFICACIONES = new Set(["menor", "mayor", "critica"]);

/* Regla 8: responsables (actuales y anteriores) e implementadores de las acciones no canceladas. */
const participantes = (acciones: Row[]): number[] => acciones.filter((a) => a.estado !== "cancelada").flatMap((a) => [Number(a.responsable_id), Number(a.implementada_por), ...previosDe(a)]).filter((n) => n > 0);
const participantesDe = async (s: Session, ncId: unknown): Promise<number[]> => participantes(await s.query<Row>(`SELECT estado, responsable_id, implementada_por, responsables_previos FROM ${T.acciones} WHERE nc_id = :id`, { id: ncId }));
/* Regla 9: el responsable actual y los anteriores de la NC. */
const responsablesNc = (nc: Row): number[] => [Number(nc.responsable_id), ...previosDe(nc)].filter((n) => n > 0);
const ORIGENES = new Set(ORIGENES_NC.map((o) => o.value));
const METODOS = new Set(METODOS_CAUSA.map((m) => m.value));
const MEDIOS = new Set(MEDIOS_COMUNICACION.map((m) => m.value));
const SI_NO = new Set(["si", "no"]);
const param = (request: Request, nombre: string) => (new URL(request.url).searchParams.get(nombre) || "").trim();
const cerradaOAnulada = (nc: Row) => ["cerrada", "anulada"].includes(String(nc.estado));

/* ---------- Permisos de la NC ---------- */

/* calidad:G, o responsable de la NC con calidad:C o superior (C, E, R, A o AN sobre la NC). */
function puedeEditar(acc: AccesoCalidad, nc: Row): Permiso | null {
  const g = permisoDe(acc.auth, "calidad", "G", { objeto: "nc" });
  if (g) return g;
  if (Number(nc.responsable_id) !== acc.yo) return null;
  for (const accion of ["C", "E", "R", "A", "AN"] as const) {
    const permiso = permisoDe(acc.auth, "calidad", accion, { objeto: "nc" });
    if (permiso) return permiso;
  }
  return null;
}

function exigirEditable(acc: AccesoCalidad, nc: Row): Permiso {
  if (cerradaOAnulada(nc)) throw new HttpError(409, { message: `La ${folioNc(nc.folio_num)} está ${nc.estado}; ya no se edita`, codigo: "nc_cerrada" });
  const permiso = puedeEditar(acc, nc);
  if (!permiso) throw new HttpError(403, { message: "Editan la NC quien administra calidad (calidad:G) o su responsable", required: { module: "calidad", action: "G" } });
  return permiso;
}

async function sinSolicitudPendiente(s: Session, nc: Row): Promise<void> {
  if ((await pendientesDe(s, T.nc, [Number(nc.id)])).get(String(nc.id))) throw new HttpError(409, { message: `La ${folioNc(nc.folio_num)} tiene una solicitud de anulación pendiente`, codigo: "solicitud_pendiente" });
}

/* Responsable de una NC o de una accion: cuenta vigente y que pueda ver lo que se le asigna (calidad:V con ese objeto). */
async function responsableValido(s: Session, id: unknown, objeto: "nc" | "accion_correctiva" = "nc"): Promise<number | null> {
  if (id === null || id === undefined || id === "") return null;
  const n = Number.parseInt(String(id), 10);
  const persona = await personaVigente(s, n);
  if (!persona) throw new HttpError(400, { message: "El responsable no existe" });
  if (!persona.vigente) throw new HttpError(400, { message: `${persona.nombre || persona.email} no tiene una cuenta vigente; elige a otra persona` });
  const efectivos = expandirPermisos((await rolesVigentes(s, n)).flatMap((r) => r.filas));
  if (!permite(efectivos, "calidad", "V", { objeto })) throw new HttpError(400, { message: `${persona.nombre || persona.email} no tiene acceso a calidad (incidencias y NC); elige a otra persona` });
  // El responsable de la NC la conduce: necesita C o superior en calidad (solo V, como el Auditor, no podria editarla).
  if (objeto === "nc" && !(["C", "E", "R", "A", "AN"] as const).some((a) => permite(efectivos, "calidad", a, { objeto }))) throw new HttpError(400, { message: `${persona.nombre || persona.email} solo consulta calidad; no puede llevar una NC` });
  return n;
}

const auditar = (s: Session, user: CurrentUser, nc: Row, accion: Parameters<typeof registrarAuditoria>[2]["accion"], extra: { motivo?: string | null; antes?: Row | null; despues?: Row | null; detalle?: Record<string, unknown> } = {}) =>
  registrarAuditoria(s, user, { accion, entidad: T.nc, entidadId: Number(nc.id), referencia: folioNc(nc.folio_num), ...extra });

/* ---------- Crear ---------- */

export async function crearNcInterna(s: Session, user: CurrentUser, actuo: { cargo: string }, datos: { origen: string; incidencia_id?: number | null; descripcion: string; clasificacion?: unknown; requisito_incumplido?: unknown; responsable_id?: unknown }): Promise<Row> {
  if (!ORIGENES.has(datos.origen)) throw new HttpError(400, { message: "Elige el origen de la NC" });
  const descripcion = exigirTexto(datos.descripcion, 20, "Describe la no conformidad");
  const clasificacion = datos.clasificacion ? String(datos.clasificacion) : null;
  if (clasificacion && !CLASIFICACIONES.has(clasificacion)) throw new HttpError(400, { message: "Clasificación no válida (menor, mayor o crítica)" });
  // Como al cambiarlo despues: solo quien administra calidad (calidad:G) nombra al responsable.
  if (datos.responsable_id !== null && datos.responsable_id !== undefined && datos.responsable_id !== "" && !permisoDe(await cargarAutorizacion(s, user), "calidad", "G", { objeto: "nc" })) throw new HttpError(403, { message: "Solo quien administra calidad (calidad:G) nombra al responsable de la NC" });
  const responsable = await responsableValido(s, datos.responsable_id);
  const folio = await siguienteFolio(s, T.nc);
  const r = await s.execute(
    `INSERT INTO ${T.nc} (folio_num, origen, incidencia_id, clasificacion, requisito_incumplido, descripcion, responsable_id, estado, creada_por, creada_rol, creada_en)
     VALUES (:folio, :origen, :inc, :clasif, :req, :desc, :resp, 'abierta', :por, :rol, :en)`,
    { folio, origen: datos.origen, inc: datos.incidencia_id ?? null, clasif: clasificacion, req: String(datos.requisito_incumplido || "").trim() || null, desc: descripcion, resp: responsable, por: userIdFromClaims(user), rol: actuo.cargo, en: ahora() },
  );
  const nc = (await snapshotRow(s, T.nc, Number(r.lastrowid)))!;
  await auditar(s, user, nc, "crear", { despues: nc, detalle: { origen: datos.origen, incidencia: datos.incidencia_id ? `#${datos.incidencia_id}` : null, actuo_como: actuo } });
  return nc;
}

/* POST /api/calidad/nc: NC directa (calidad:R o calidad:G). */
export async function crearNc({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const acc = await accesoCalidad(s, user, "nc");
  const permiso = permisoDe(acc.auth, "calidad", "R", { objeto: "nc" }) || permisoDe(acc.auth, "calidad", "G", { objeto: "nc" });
  if (!permiso) throw new HttpError(403, { message: "Crear una NC requiere calidad:R o calidad:G", required: { module: "calidad", action: "R" } });
  const payload = await readJson(request);
  if (String(payload.origen) === "incidencia") throw new HttpError(400, { message: "Una NC de origen incidencia se crea al escalar la incidencia" });
  const nc = await crearNcInterna(s, user, cargoActuante(request, permiso), { origen: String(payload.origen || ""), descripcion: String(payload.descripcion || ""), clasificacion: payload.clasificacion, requisito_incumplido: payload.requisito_incumplido, responsable_id: payload.responsable_id });
  await s.commit();
  return json({ message: `${folioNc(nc.folio_num)} abierta`, id: nc.id, folio: folioNc(nc.folio_num) }, 201);
}

/* ---------- Leer ---------- */

/* GET /api/calidad/nc?estado&clasificacion&origen&desde&hasta&mias=1&search&anuladas=1&formato=csv */
export async function listarNc({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const acc = await accesoCalidad(s, user, "nc");
  const where: string[] = [];
  const v: Record<string, unknown> = { yo: acc.yo };
  const estado = param(request, "estado");
  if (param(request, "anuladas") !== "1" && estado !== "anulada") where.push("n.estado <> 'anulada'");
  if (estado === "abiertas") where.push("n.estado NOT IN ('cerrada', 'anulada')");
  else if (estado) {
    where.push("n.estado = :estado");
    v.estado = estado;
  }
  for (const campo of ["clasificacion", "origen"]) {
    if (!param(request, campo)) continue;
    where.push(`n.${campo} = :${campo}`);
    v[campo] = param(request, campo);
  }
  if (param(request, "tipo")) {
    where.push(`n.id IN (SELECT nc_id FROM ${T.incidencias} WHERE tipo = :tipo AND nc_id IS NOT NULL)`);
    v.tipo = param(request, "tipo");
  }
  if (param(request, "desde")) {
    where.push("n.creada_en >= :desde");
    v.desde = inicioDiaLocal(param(request, "desde"));
  }
  if (param(request, "hasta")) {
    where.push("n.creada_en <= :hasta");
    v.hasta = finDiaLocal(param(request, "hasta"));
  }
  const alcance = `(n.responsable_id = :yo OR n.id IN (SELECT nc_id FROM ${T.acciones} WHERE responsable_id = :yo))`;
  if (param(request, "mias") === "1" || !acc.total) where.push(alcance);
  if (param(request, "search")) {
    where.push("(n.descripcion LIKE :like OR n.requisito_incumplido LIKE :like OR CAST(n.folio_num AS CHAR) LIKE :like)");
    v.like = `%${param(request, "search")}%`;
  }
  const filas = await s.query<Row>(
    `SELECT n.*, u.nombre AS responsable_nombre,
       (SELECT COUNT(*) FROM ${T.acciones} a WHERE a.nc_id = n.id AND a.estado <> 'cancelada') AS acciones,
       (SELECT COUNT(*) FROM ${T.acciones} a WHERE a.nc_id = n.id AND a.estado IN ('pendiente', 'en_proceso')) AS acciones_abiertas
     FROM ${T.nc} n LEFT JOIN usuarios u ON u.id = n.responsable_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY n.folio_num DESC LIMIT 1000`,
    v,
  );
  if (param(request, "formato") === "csv") {
    await registrarAuditoria(s, user, { accion: "exportar", entidad: T.nc, referencia: "No conformidades", detalle: { formato: "csv", filas: filas.length } });
    await s.commit();
    return respuestaCsv(`no-conformidades-${hoyLocal()}.csv`, ["Folio", "Origen", "Clasificación", "Estado", "Responsable", "Abierta", "Cerrada", "Reaperturas", "Requisito", "Descripción"], filas.map((f) => [folioNc(f.folio_num), ORIGEN_NC_LABEL[String(f.origen)] || f.origen, f.clasificacion ? CLASIFICACION_NC_LABEL[String(f.clasificacion)] : "", ESTADOS_NC[String(f.estado)]?.label || f.estado, f.responsable_nombre, formatearFechaHora(f.creada_en), formatearFechaHora(f.cerrada_en), f.reaperturas, f.requisito_incumplido, f.descripcion]));
  }
  return json({ items: filas.map((f) => ({ ...f, folio: folioNc(f.folio_num) })), total: filas.length, alcance: acc.total ? "total" : "incidencias" });
}

/* GET /api/calidad/acciones?mias=1&estado&vencidas=1: acciones correctivas (pestana "Acciones"). */
export async function listarAcciones({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const acc = await accesoCalidad(s, user, "accion_correctiva");
  const where: string[] = [];
  const v: Record<string, unknown> = { yo: acc.yo };
  if (param(request, "estado")) {
    where.push("a.estado = :estado");
    v.estado = param(request, "estado");
  }
  if (param(request, "mias") === "1") where.push("a.responsable_id = :yo");
  else if (!acc.total) where.push("(a.responsable_id = :yo OR n.responsable_id = :yo)");
  where.push("n.estado <> 'anulada'");
  if (param(request, "desde")) {
    where.push("a.creada_en >= :desde");
    v.desde = inicioDiaLocal(param(request, "desde"));
  }
  if (param(request, "hasta")) {
    where.push("a.creada_en <= :hasta");
    v.hasta = finDiaLocal(param(request, "hasta"));
  }
  if (param(request, "search")) {
    where.push("(a.descripcion LIKE :like OR CAST(n.folio_num AS CHAR) LIKE :like)");
    v.like = `%${param(request, "search")}%`;
  }
  const hoy = hoyLocal();
  let filas = await s.query<Row>(
    `SELECT a.*, n.folio_num AS nc_folio, n.estado AS nc_estado, u.nombre AS responsable_nombre FROM ${T.acciones} a
     JOIN ${T.nc} n ON n.id = a.nc_id LEFT JOIN usuarios u ON u.id = a.responsable_id
     WHERE ${where.join(" AND ")} ORDER BY a.fecha_compromiso IS NULL, a.fecha_compromiso, a.id LIMIT 1000`,
    v,
  );
  filas = filas.map((f) => ({ ...f, nc: folioNc(f.nc_folio), vencida: accionVencida(f, hoy) }));
  if (param(request, "vencidas") === "1") filas = filas.filter((f) => f.vencida);
  if (param(request, "formato") === "csv") {
    await registrarAuditoria(s, user, { accion: "exportar", entidad: T.acciones, referencia: "Acciones correctivas", detalle: { formato: "csv", filas: filas.length } });
    await s.commit();
    return respuestaCsv(`acciones-correctivas-${hoy}.csv`, ["NC", "Acción", "Responsable", "Fecha compromiso", "Estado", "Vencida", "Implementada", "Implementación"], filas.map((f) => [f.nc, f.descripcion, f.responsable_nombre, formatearFecha(f.fecha_compromiso), ESTADOS_ACCION[String(f.estado)]?.label || f.estado, f.vencida ? "Sí" : "No", formatearFechaHora(f.implementada_en), f.descripcion_implementacion]));
  }
  return json({ items: filas, total: filas.length });
}

async function detalleNc(s: Session, acc: AccesoCalidad, nc: Row): Promise<Row> {
  const id = Number(nc.id);
  const hoy = hoyLocal();
  const [incidencias, afectados, acciones, verificaciones, comunicaciones, suspensiones, retenciones] = await Promise.all([
    s.query<Row>(`SELECT id, folio_num, tipo, estado, descripcion, reportada_nombre, reportada_por FROM ${T.incidencias} WHERE nc_id = :id ORDER BY id`, { id }),
    s.query<Row>(`SELECT * FROM ${T.afectados} WHERE nc_id = :id ORDER BY id`, { id }),
    s.query<Row>(`SELECT a.*, u.nombre AS responsable_nombre, u.activo AS responsable_activo, u.vigente_hasta AS responsable_vigente_hasta FROM ${T.acciones} a LEFT JOIN usuarios u ON u.id = a.responsable_id WHERE a.nc_id = :id ORDER BY a.id`, { id }),
    s.query<Row>(`SELECT v.*, u.nombre AS verificada_nombre FROM ${T.verificaciones} v LEFT JOIN usuarios u ON u.id = v.verificada_por WHERE v.nc_id = :id ORDER BY v.id`, { id }),
    s.query<Row>(`SELECT c.*, u.nombre AS registrado_nombre FROM ${T.comunicaciones} c LEFT JOIN usuarios u ON u.id = c.registrado_por WHERE c.nc_id = :id ORDER BY c.id`, { id }),
    s.query<Row>(`SELECT su.*, u.nombre AS suspendida_nombre, r.nombre AS reanudada_nombre, e.nombre AS equipo_nombre FROM ${T.suspensiones} su LEFT JOIN usuarios u ON u.id = su.suspendida_por LEFT JOIN usuarios r ON r.id = su.reanudada_por LEFT JOIN equipos e ON su.tipo = 'equipo' AND CAST(e.id AS CHAR) = su.clave WHERE su.nc_id = :id ORDER BY su.id`, { id }),
    s.query<Row>(`SELECT r.*, i.folio_num AS informe_folio, i.version AS informe_version, i.estado AS informe_estado, u.nombre AS retenido_nombre, l.nombre AS liberada_nombre FROM ${T.retenciones} r LEFT JOIN informes i ON i.id = r.informe_id LEFT JOIN usuarios u ON u.id = r.retenido_por LEFT JOIN usuarios l ON l.id = r.liberada_por WHERE r.nc_id = :id ORDER BY r.id`, { id }),
  ]);
  const responsable = await personaVigente(s, nc.responsable_id);
  const nombreDe = async (id: unknown) => (id ? String((await s.queryOne<Row>("SELECT nombre FROM usuarios WHERE id = :id", { id }))?.nombre || "") || null : null);
  const responsablesAcciones = participantes(acciones);
  const excepciones = excepcionesDe(nc);
  const bloqueo = (v: ReturnType<typeof evaluarVerificacion>, accion: string) => (v && !excepcionPara(excepciones, acc.yo, accion) ? v.mensaje : null);
  const propuesta = nc.propuesta_documento_id ? await s.queryOne<Row>("SELECT id, tipo, titulo, estado FROM propuestas_documento WHERE id = :id", { id: nc.propuesta_documento_id }).catch(() => null) : null;
  const pendiente = (await pendientesDe(s, T.nc, [id])).get(String(id));
  const editor = !cerradaOAnulada(nc) && !!puedeEditar(acc, nc);
  return {
    ...nc,
    folio: folioNc(nc.folio_num),
    creada_nombre: await nombreDe(nc.creada_por),
    cerrada_nombre: await nombreDe(nc.cerrada_por),
    impacto_evaluado_nombre: await nombreDe(nc.impacto_evaluado_por),
    excepciones,
    responsable: responsable ? { id: responsable.id, nombre: responsable.nombre, vigente: responsable.vigente } : null,
    // Con alcance "incidencias", de las incidencias ajenas agrupadas en la NC solo el folio y el estado.
    incidencias: incidencias.map((i) => (acc.total || Number(i.reportada_por) === acc.yo ? { ...i, folio: folioIncidencia(i.folio_num) } : { id: i.id, folio_num: i.folio_num, estado: i.estado, folio: folioIncidencia(i.folio_num), restringida: true })),
    // Enmiendas de cada informe afectado (7.10: la correccion se hace con el flujo de enmienda existente).
    afectados: await Promise.all(afectados.map(async (a) => (a.entidad === "informes" ? { ...a, enmiendas: (await s.query<Row>("SELECT id, folio_num, version, estado FROM informes WHERE sustituye_a = :id ORDER BY version", { id: a.entidad_id })).map((e) => ({ id: e.id, estado: e.estado, referencia: `${formatearFolio("IR", e.folio_num)} v${e.version}` })) } : a))),
    acciones: acciones.map((a) => ({ ...a, vencida: accionVencida(a, hoy), responsable_vigente: Number(a.responsable_activo) === 1 && (!a.responsable_vigente_hasta || String(a.responsable_vigente_hasta) >= hoy) })),
    verificaciones,
    comunicaciones: comunicaciones.map((c) => ({ ...c, informe_ids: JSON.parse(String(c.informe_ids_json || "[]")) })),
    // Con la excepción de la regla 10 ya aprobada, quien suspendió puede reanudar (la pantalla le ofrece «Reanudar…»).
    suspensiones: suspensiones.map((su) => ({ ...su, excepcion_reanudar: !!excepcionPara(excepcionesDe(su), acc.yo, "reanudar") })),
    retenciones: retenciones.map((r) => ({ ...r, informe: `${formatearFolio("IR", r.informe_folio)}${Number(r.informe_version || 1) > 1 ? ` v${r.informe_version}` : ""}` })),
    propuesta,
    solicitud_pendiente: pendiente ? serializarSolicitud(pendiente) : null,
    segregacion: { verificar: bloqueo(evaluarVerificacion(acc.yo, responsablesAcciones), "verificar"), cerrar: bloqueo(evaluarCierreNc(acc.yo, responsablesNc(nc)), "cerrar") },
    puede: {
      editar: editor,
      administrar: !!permisoDe(acc.auth, "calidad", "G", { objeto: "nc" }),
      verificar: acc.puede("R") && String(nc.estado) === "en_verificacion" && verificaciones.at(-1)?.resultado !== "eficaz",
      suspender: acc.puede("R") && !cerradaOAnulada(nc),
      retener: acc.puede("R") && !cerradaOAnulada(nc),
      reanudar: acc.puede("A"),
      cerrar: acc.puede("A") && !cerradaOAnulada(nc),
      anular: acc.puede("AN") && String(nc.estado) !== "anulada",
      implementar: acciones.filter((a) => (Number(a.responsable_id) === acc.yo || !!permisoDe(acc.auth, "calidad", "G", { objeto: "nc" })) && ["pendiente", "en_proceso"].includes(String(a.estado))).map((a) => a.id),
    },
    pdf_disponible: !!nc.archivo_pdf,
  };
}

/* GET /api/calidad/nc/:id */
export async function getNc({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const acc = await accesoCalidad(s, user, "nc");
  const nc = await ncVisible(s, acc, intParam(params.id));
  return json({ item: await detalleNc(s, acc, nc) });
}

/* ---------- Editar ---------- */

/* PUT /api/calidad/nc/:id: descripcion, requisito, clasificacion, impacto, causa, decision de accion, efectos en el SGC, responsable (solo calidad:G). */
export async function editarNc({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const acc = await accesoCalidad(s, user, "nc");
  const antes = await ncVisible(s, acc, intParam(params.id), true);
  const permiso = exigirEditable(acc, antes);
  await sinSolicitudPendiente(s, antes);
  const actuo = cargoActuante(request, permiso);
  const p = await readJson(request);
  const cambios: Record<string, unknown> = {};
  const texto = (campo: string, min = 0, que = "") => {
    if (!(campo in p)) return;
    const t = String(p[campo] ?? "").trim();
    if (min && t && t.length < min) throw new HttpError(400, { message: `${que} (al menos ${min} caracteres)` });
    cambios[campo] = t || null;
  };
  const opcion = (campo: string, validos: Set<string>, que: string) => {
    if (!(campo in p)) return;
    const val = p[campo] === null || p[campo] === "" ? null : String(p[campo]);
    if (val !== null && !validos.has(val)) throw new HttpError(400, { message: `${que} no válido` });
    cambios[campo] = val;
  };
  if ("descripcion" in p) cambios.descripcion = exigirTexto(p.descripcion, 20, "Describe la no conformidad");
  texto("requisito_incumplido");
  opcion("clasificacion", CLASIFICACIONES, "Clasificación");
  opcion("afecta_resultados_emitidos", SI_NO, "¿Afecta resultados emitidos?");
  opcion("trabajo_detenido", SI_NO, "¿Se detuvo el trabajo?");
  opcion("notificar_cliente", SI_NO, "¿Se notifica al cliente?");
  texto("impacto_notas");
  opcion("metodo_causa", METODOS, "Método de análisis de causa");
  texto("desarrollo_causa");
  texto("causa_raiz", 10, "Describe la causa raíz");
  opcion("requiere_accion_correctiva", SI_NO, "¿Requiere acción correctiva?");
  if (cambios.requiere_accion_correctiva === "no" && antes.requiere_accion_correctiva !== "no") {
    // La rama "sin accion" solo existe antes de pasar a acciones (despues se cierra verificando eficacia).
    if (!["abierta", "en_analisis"].includes(String(antes.estado))) throw new HttpError(409, { message: "La NC ya pasó a acciones correctivas; ya no se cambia a «no requiere acción» (agrega una acción o anula la NC)", codigo: "decision_con_acciones" });
    // 8.7.1: con acciones definidas (no canceladas) o una verificacion, la decision ya no se revierte a "no".
    const acciones = Number(await s.scalar(`SELECT COUNT(*) FROM ${T.acciones} WHERE nc_id = :id AND estado <> 'cancelada'`, { id: antes.id }));
    const verificaciones = Number(await s.scalar(`SELECT COUNT(*) FROM ${T.verificaciones} WHERE nc_id = :id`, { id: antes.id }));
    if (acciones || verificaciones) throw new HttpError(409, { message: "La NC ya tiene acciones correctivas o una verificación de eficacia; cancela las acciones pendientes o verifica su eficacia (no se cambia a «no requiere acción»)", codigo: "decision_con_acciones" });
  }
  texto("justificacion_sin_accion", 10, "Justifica por qué no requiere acción correctiva");
  if ("requiere_actualizar_riesgos" in p) cambios.requiere_actualizar_riesgos = p.requiere_actualizar_riesgos ? 1 : 0;
  texto("nota_riesgos");
  if ("requiere_cambio_documental" in p) cambios.requiere_cambio_documental = p.requiere_cambio_documental ? 1 : 0;
  if ("verificacion_programada" in p) {
    if (p.verificacion_programada && !fechaValida(p.verificacion_programada)) throw new HttpError(400, { message: "Fecha de verificación no válida" });
    // Como en el formulario: se programa de hoy en adelante (una fecha ya guardada se conserva aunque haya pasado).
    if (p.verificacion_programada && String(p.verificacion_programada) !== String(antes.verificacion_programada || "") && String(fechaValida(p.verificacion_programada)) < hoyLocal()) throw new HttpError(400, { message: "La verificación se programa de hoy en adelante", campo: "verificacion_programada" });
    cambios.verificacion_programada = p.verificacion_programada || null;
  }
  let reasignacion: { motivo: string } | null = null;
  if ("responsable_id" in p && String(p.responsable_id ?? "") !== String(antes.responsable_id ?? "")) {
    if (!permisoDe(acc.auth, "calidad", "G", { objeto: "nc" })) throw new HttpError(403, { message: "Solo quien administra calidad (calidad:G) nombra o cambia al responsable" });
    cambios.responsable_id = await responsableValido(s, p.responsable_id);
    if (antes.responsable_id) cambios.responsables_previos = conPrevio(antes, antes.responsable_id);
    if (antes.responsable_id) reasignacion = { motivo: exigirTexto(p.motivo, 5, "Indica el motivo del cambio de responsable") };
  }
  // Lo que ya permitio avanzar de etapa no se vacia: impacto desde "en analisis"; metodo, causa y decision desde "acciones en curso".
  const rango = RANGO_NC[String(antes.estado)] ?? 0;
  const vaciados = Object.entries(cambios).filter(([, v]) => v === null).map(([c]) => c);
  const fijos = [...(rango >= RANGO_NC.en_analisis ? ["afecta_resultados_emitidos", "trabajo_detenido", "notificar_cliente"] : []), ...(rango >= RANGO_NC.acciones_en_curso ? ["metodo_causa", "causa_raiz", "requiere_accion_correctiva"] : [])];
  if (vaciados.some((c) => fijos.includes(c))) throw new HttpError(409, { message: "Ese dato ya sirvió para avanzar de etapa; se puede corregir, pero no dejar vacío", codigo: "dato_de_etapa" });
  const impacto = ["afecta_resultados_emitidos", "trabajo_detenido", "notificar_cliente"].some((c) => c in cambios);
  if (impacto) Object.assign(cambios, { impacto_evaluado_por: userIdFromClaims(user), impacto_evaluado_en: ahora() });
  const campos = Object.keys(cambios);
  if (!campos.length) return json({ message: "Sin cambios" });
  await s.execute(`UPDATE ${T.nc} SET ${campos.map((c) => `${c} = :${c}`).join(", ")} WHERE id = :id`, { ...cambios, id: antes.id });
  const despues = await snapshotRow(s, T.nc, Number(antes.id));
  await auditar(s, user, antes, reasignacion ? "reasignar" : "editar", { antes, despues, motivo: reasignacion?.motivo || null, detalle: { actuo_como: actuo, ...(reasignacion ? { responsable: true } : {}) } });
  await s.commit();
  return json({ message: "No conformidad actualizada", item: await detalleNc(s, acc, despues!) });
}

/* POST /api/calidad/nc/:id/avanzar { a: en_analisis | acciones_en_curso | en_verificacion } */
export async function avanzarNc({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const acc = await accesoCalidad(s, user, "nc");
  const nc = await ncVisible(s, acc, intParam(params.id), true);
  const permiso = exigirEditable(acc, nc);
  await sinSolicitudPendiente(s, nc);
  const a = String((await readJson(request)).a || "");
  const actual = String(nc.estado);
  const acciones = await s.query<Row>(`SELECT estado FROM ${T.acciones} WHERE nc_id = :id`, { id: nc.id });
  const siguiente: Record<string, string> = { abierta: "en_analisis", en_analisis: "acciones_en_curso", acciones_en_curso: "en_verificacion" };
  if (siguiente[actual] !== a) throw new HttpError(409, { message: `La NC está ${ESTADOS_NC[actual]?.label.toLowerCase() || actual}; el siguiente paso es ${siguiente[actual] ? ESTADOS_NC[siguiente[actual]].label.toLowerCase() : "ninguno"} (solo se avanza hacia adelante)` });
  if (a === "en_analisis") {
    if (!nc.responsable_id) throw new HttpError(409, { message: "Nombra al responsable de la NC antes de iniciar el análisis" });
    if (!nc.afecta_resultados_emitidos || !nc.trabajo_detenido || !nc.notificar_cliente) throw new HttpError(409, { message: "Completa la evaluación de impacto (resultados emitidos, trabajo detenido y notificación al cliente) antes de iniciar el análisis" });
  }
  if (a === "acciones_en_curso") {
    if (!nc.metodo_causa || String(nc.causa_raiz || "").trim().length < 10) throw new HttpError(409, { message: "Registra el método y la causa raíz antes de pasar a las acciones" });
    if (nc.requiere_accion_correctiva !== "si") throw new HttpError(409, { message: nc.requiere_accion_correctiva === "no" ? "La NC no requiere acción correctiva: se cierra tras la evaluación de impacto" : "Decide si la NC requiere acción correctiva" });
    if (!acciones.some((x) => x.estado !== "cancelada")) throw new HttpError(409, { message: "Agrega al menos una acción correctiva" });
    // Tras un "no eficaz" (reapertura), 8.7.1: hace falta al menos una accion nueva; reverificar lo mismo no tiene sentido.
    if (Number(nc.reaperturas || 0) > 0) {
      const ultimaNoEficaz = await s.scalar(`SELECT MAX(verificada_en) FROM ${T.verificaciones} WHERE nc_id = :id AND resultado = 'no_eficaz'`, { id: nc.id });
      const nuevas = Number(await s.scalar(`SELECT COUNT(*) FROM ${T.acciones} WHERE nc_id = :id AND estado <> 'cancelada' AND creada_en > :desde`, { id: nc.id, desde: ultimaNoEficaz || "" }));
      if (!nuevas) throw new HttpError(409, { message: "La verificación fue no eficaz: revisa la causa y agrega al menos una acción correctiva nueva antes de continuar", codigo: "reapertura_sin_accion" });
    }
  }
  if (a === "en_verificacion") {
    if (acciones.some((x) => ["pendiente", "en_proceso"].includes(String(x.estado)))) throw new HttpError(409, { message: "Hay acciones pendientes o en proceso; se verifica cuando todas estén implementadas o canceladas" });
    if (!acciones.some((x) => x.estado === "implementada")) throw new HttpError(409, { message: "No hay acciones implementadas que verificar" });
  }
  const columna: Record<string, string> = { en_analisis: "analisis_iniciado_en", acciones_en_curso: "acciones_iniciadas_en", en_verificacion: "verificacion_iniciada_en" };
  // La fecha de cada etapa es la primera vez que se entro (tras una reapertura se conserva; las siguientes quedan en la bitacora).
  const r = await s.execute(`UPDATE ${T.nc} SET estado = :a, ${columna[a]} = COALESCE(${columna[a]}, :en) WHERE id = :id AND estado = :actual`, { a, en: ahora(), id: nc.id, actual });
  if (!r.rowcount) throw new HttpError(409, { message: "La NC cambió de etapa mientras tanto; recarga" });
  await auditar(s, user, nc, "avanzar", { antes: nc, despues: await snapshotRow(s, T.nc, Number(nc.id)), detalle: { etapa: a, actuo_como: cargoActuante(request, permiso) } });
  await s.commit();
  return json({ message: `NC en ${ESTADOS_NC[a].label.toLowerCase()}` });
}

/* ---------- Acciones correctivas ---------- */

/* POST /api/calidad/nc/:id/acciones { descripcion, responsable_id, fecha_compromiso } */
export async function crearAccion({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const acc = await accesoCalidad(s, user, "nc");
  const nc = await ncVisible(s, acc, intParam(params.id), true);
  const permiso = exigirEditable(acc, nc);
  await sinSolicitudPendiente(s, nc);
  if (!["en_analisis", "acciones_en_curso"].includes(String(nc.estado))) throw new HttpError(409, { message: "Las acciones se agregan en análisis o con acciones en curso" });
  const p = await readJson(request);
  const descripcion = exigirTexto(p.descripcion, 10, "Describe la acción");
  const responsable = await responsableValido(s, p.responsable_id, "accion_correctiva");
  if (!responsable) throw new HttpError(400, { message: "Elige al responsable de la acción" });
  if (!fechaValida(p.fecha_compromiso)) throw new HttpError(400, { message: "Indica la fecha compromiso" });
  const r = await s.execute(`INSERT INTO ${T.acciones} (nc_id, descripcion, responsable_id, fecha_compromiso, estado, creada_por, creada_en) VALUES (:nc, :d, :r, :f, 'pendiente', :por, :en)`, { nc: nc.id, d: descripcion, r: responsable, f: p.fecha_compromiso, por: userIdFromClaims(user), en: ahora() });
  const accion = await snapshotRow(s, T.acciones, Number(r.lastrowid));
  await auditar(s, user, nc, "crear", { detalle: { accion_correctiva: Number(r.lastrowid), descripcion, responsable: (await personaVigente(s, responsable))?.nombre, fecha_compromiso: p.fecha_compromiso, actuo_como: cargoActuante(request, permiso) }, despues: accion });
  await s.commit();
  return json({ message: "Acción correctiva agregada", id: r.lastrowid }, 201);
}

async function accionParaEditar(s: Session, request: Request, id: number) {
  const user = await requireUser(request);
  const acc = await accesoCalidad(s, user, "accion_correctiva");
  const { accion, nc } = await accionVisible(s, acc, id, true);
  if (cerradaOAnulada(nc)) throw new HttpError(409, { message: `La ${folioNc(nc.folio_num)} está ${nc.estado}; sus acciones ya no cambian`, codigo: "nc_cerrada" });
  await sinSolicitudPendiente(s, nc);
  return { user, acc, accion, nc };
}

/* PUT /api/calidad/acciones/:id { descripcion?, fecha_compromiso?, responsable_id?, motivo } (reasignar exige motivo) */
export async function editarAccion({ request, s, params }: RouteContext): Promise<Response> {
  const { user, acc, accion, nc } = await accionParaEditar(s, request, intParam(params.id));
  const permiso = exigirEditable(acc, nc);
  if (["implementada", "cancelada"].includes(String(accion.estado))) throw new HttpError(409, { message: `La acción está ${accion.estado}; ya no se edita` });
  const p = await readJson(request);
  const cambios: Record<string, unknown> = {};
  if ("descripcion" in p) cambios.descripcion = exigirTexto(p.descripcion, 10, "Describe la acción");
  if ("fecha_compromiso" in p) {
    if (!fechaValida(p.fecha_compromiso)) throw new HttpError(400, { message: "Fecha compromiso no válida" });
    cambios.fecha_compromiso = p.fecha_compromiso;
  }
  let reasigna = false;
  if ("responsable_id" in p && String(p.responsable_id) !== String(accion.responsable_id)) {
    // El responsable (o verificador) ya no esta vigente: se reasigna con motivo.
    cambios.responsable_id = await responsableValido(s, p.responsable_id, "accion_correctiva");
    if (!cambios.responsable_id) throw new HttpError(400, { message: "Elige al nuevo responsable" });
    cambios.motivo_reasignacion = exigirTexto(p.motivo, 5, "Indica el motivo de la reasignación");
    cambios.responsables_previos = conPrevio(accion, accion.responsable_id);
    cambios.reasignada_en = ahora();
    reasigna = true;
  }
  const campos = Object.keys(cambios);
  if (!campos.length) return json({ message: "Sin cambios" });
  await s.execute(`UPDATE ${T.acciones} SET ${campos.map((c) => `${c} = :${c}`).join(", ")} WHERE id = :id`, { ...cambios, id: accion.id });
  const despues = await snapshotRow(s, T.acciones, Number(accion.id));
  await auditar(s, user, nc, reasigna ? "reasignar" : "editar", { antes: accion, despues, motivo: reasigna ? String(cambios.motivo_reasignacion) : null, detalle: { accion_correctiva: Number(accion.id), actuo_como: cargoActuante(request, permiso) } });
  await s.commit();
  return json({ message: reasigna ? "Acción reasignada" : "Acción actualizada" });
}

/* Responsable de la accion o calidad:G. */
function exigirResponsableAccion(acc: AccesoCalidad, accion: Row): void {
  if (Number(accion.responsable_id) !== acc.yo && !permisoDe(acc.auth, "calidad", "G", { objeto: "accion_correctiva" })) throw new HttpError(403, { message: "Solo el responsable de la acción (o calidad:G) la marca" });
}

/* POST /api/calidad/acciones/:id/iniciar */
export async function iniciarAccion({ request, s, params }: RouteContext): Promise<Response> {
  const { user, acc, accion, nc } = await accionParaEditar(s, request, intParam(params.id));
  exigirResponsableAccion(acc, accion);
  if (String(accion.estado) !== "pendiente") throw new HttpError(409, { message: `La acción está ${ESTADOS_ACCION[String(accion.estado)]?.label.toLowerCase() || accion.estado}` });
  await s.execute(`UPDATE ${T.acciones} SET estado = 'en_proceso', iniciada_en = :en WHERE id = :id AND estado = 'pendiente'`, { en: ahora(), id: accion.id });
  await auditar(s, user, nc, "iniciar_accion", { detalle: { accion_correctiva: Number(accion.id), descripcion: accion.descripcion } });
  await s.commit();
  return json({ message: "Acción en proceso" });
}

/* POST /api/calidad/acciones/:id/implementar { descripcion_implementacion } */
export async function implementarAccion({ request, s, params }: RouteContext): Promise<Response> {
  const { user, acc, accion, nc } = await accionParaEditar(s, request, intParam(params.id));
  exigirResponsableAccion(acc, accion);
  if (!["pendiente", "en_proceso"].includes(String(accion.estado))) throw new HttpError(409, { message: `La acción ya está ${ESTADOS_ACCION[String(accion.estado)]?.label.toLowerCase() || accion.estado}` });
  const descripcion = exigirTexto((await readJson(request)).descripcion_implementacion, 10, "Describe cómo se implementó");
  const r = await s.execute(`UPDATE ${T.acciones} SET estado = 'implementada', implementada_por = :por, implementada_en = :en, descripcion_implementacion = :d WHERE id = :id AND estado IN ('pendiente', 'en_proceso')`, { por: acc.yo, en: ahora(), d: descripcion, id: accion.id });
  if (!r.rowcount) throw new HttpError(409, { message: "La acción ya cambió de estado" });
  await auditar(s, user, nc, "implementar", { detalle: { accion_correctiva: Number(accion.id), descripcion: accion.descripcion, implementacion: descripcion } });
  await s.commit();
  return json({ message: "Acción implementada" });
}

/* POST /api/calidad/acciones/:id/cancelar { motivo } */
export async function cancelarAccion({ request, s, params }: RouteContext): Promise<Response> {
  const { user, acc, accion, nc } = await accionParaEditar(s, request, intParam(params.id));
  exigirEditable(acc, nc);
  if (["implementada", "cancelada"].includes(String(accion.estado))) throw new HttpError(409, { message: `La acción ya está ${accion.estado}` });
  const motivo = exigirTexto((await readJson(request)).motivo, 5, "Indica el motivo de la cancelación");
  const r = await s.execute(`UPDATE ${T.acciones} SET estado = 'cancelada', cancelada_por = :por, cancelada_en = :en, motivo_cancelacion = :m WHERE id = :id AND estado = :actual`, { por: acc.yo, en: ahora(), m: motivo, id: accion.id, actual: accion.estado });
  if (!r.rowcount) throw new HttpError(409, { message: "La acción ya cambió de estado" });
  await auditar(s, user, nc, "cancelar", { motivo, detalle: { accion_correctiva: Number(accion.id), descripcion: accion.descripcion } });
  await s.commit();
  return json({ message: "Acción cancelada" });
}

/* ---------- Verificacion de eficacia (por NC) ---------- */

/* POST /api/calidad/nc/:id/verificar { resultado: eficaz | no_eficaz, comentarios } (calidad:R, regla 8) */
export async function verificarNc({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "calidad", "R", { objeto: "nc" });
  const actuo = cargoActuante(request, permiso);
  const acc = await accesoCalidad(s, user, "nc");
  const nc = await ncVisible(s, acc, intParam(params.id), true);
  await sinSolicitudPendiente(s, nc);
  if (String(nc.estado) !== "en_verificacion") throw new HttpError(409, { message: "Solo se verifica una NC en verificación (todas sus acciones implementadas)" });
  // Una verificación eficaz es definitiva: la NC queda lista para cerrarse (no se verifica dos veces ni se reabre después).
  const ultima = await s.scalar(`SELECT resultado FROM ${T.verificaciones} WHERE nc_id = :id ORDER BY id DESC LIMIT 1`, { id: nc.id });
  if (String(ultima || "") === "eficaz") throw new HttpError(409, { message: "La eficacia ya se verificó (eficaz): la NC está lista para cerrarse", codigo: "ya_verificada" });
  const excepcion = exigirSegregacion(evaluarVerificacion(acc.yo, await participantesDe(s, nc.id)), nc, acc.yo, "verificar");
  const p = await readJson(request);
  const resultado = String(p.resultado || "");
  if (resultado !== "eficaz" && resultado !== "no_eficaz") throw new HttpError(400, { message: "Indica el resultado: eficaz o no eficaz" });
  const comentarios = exigirTexto(p.comentarios, 10, "Describe cómo se verificó la eficacia");
  await s.execute(`INSERT INTO ${T.verificaciones} (nc_id, fecha_programada, verificada_por, verificada_rol, verificada_en, resultado, comentarios) VALUES (:nc, :fp, :por, :rol, :en, :res, :c)`, { nc: nc.id, fp: nc.verificacion_programada || null, por: acc.yo, rol: actuo.cargo, en: ahora(), res: resultado, c: comentarios });
  await auditar(s, user, nc, "verificar", { motivo: comentarios, detalle: { resultado, actuo_como: actuo, ...detalleExcepcion(excepcion) } });
  if (resultado === "no_eficaz") {
    // Reapertura: vuelve a analisis sin borrar lo anterior (acciones, verificacion y causa quedan en el historial).
    await s.execute(`UPDATE ${T.nc} SET estado = 'en_analisis', reaperturas = reaperturas + 1 WHERE id = :id AND estado = 'en_verificacion'`, { id: nc.id });
    await auditar(s, user, nc, "reabrir", { antes: nc, despues: await snapshotRow(s, T.nc, Number(nc.id)), motivo: comentarios, detalle: { de: "en_verificacion", a: "en_analisis", reaperturas: Number(nc.reaperturas || 0) + 1 } });
  }
  await s.commit();
  return json({ message: resultado === "eficaz" ? "Eficacia verificada: la NC puede cerrarse" : "No eficaz: la NC regresa a análisis (reapertura)" });
}

/* ---------- Informes afectados, comunicaciones y retencion ---------- */

async function agregarAfectado(s: Session, user: CurrentUser, nc: Row, informeId: number): Promise<string> {
  // Solo informes que la persona puede ver (404 como si no existiera: no sirve para enumerar folios).
  if (!permisoDe(await cargarAutorizacion(s, user), "informes", "V")) throw new HttpError(404, { message: `Informe #${informeId} no existe` });
  const referencia = await referenciaDe(s, "informes", informeId);
  const ya = await s.scalar(`SELECT id FROM ${T.afectados} WHERE nc_id = :nc AND entidad = 'informes' AND entidad_id = :id`, { nc: nc.id, id: informeId });
  if (!ya) {
    await s.execute(`INSERT INTO ${T.afectados} (nc_id, entidad, entidad_id, referencia, agregado_por, agregado_en) VALUES (:nc, 'informes', :id, :ref, :por, :en)`, { nc: nc.id, id: informeId, ref: referencia, por: userIdFromClaims(user), en: ahora() });
    await auditar(s, user, nc, "afectar", { detalle: { informe: referencia } });
  }
  return referencia;
}

/* POST /api/calidad/nc/:id/afectados { informe_id } */
export async function agregarInformeAfectado({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const acc = await accesoCalidad(s, user, "nc");
  const nc = await ncVisible(s, acc, intParam(params.id), true);
  exigirEditable(acc, nc);
  const informeId = Number.parseInt(String((await readJson(request)).informe_id || ""), 10);
  if (!Number.isFinite(informeId)) throw new HttpError(400, { message: "Elige el informe afectado" });
  const referencia = await agregarAfectado(s, user, nc, informeId);
  await s.commit();
  return json({ message: `${referencia} marcado como afectado` });
}

/* POST /api/calidad/nc/:id/comunicaciones { fecha, medio, contacto, resumen, informe_ids? } */
export async function registrarComunicacion({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const acc = await accesoCalidad(s, user, "nc");
  const nc = await ncVisible(s, acc, intParam(params.id), true);
  exigirEditable(acc, nc);
  const p = await readJson(request);
  if (!fechaValida(p.fecha)) throw new HttpError(400, { message: "Indica la fecha de la comunicación" });
  if (String(fechaValida(p.fecha)) > hoyLocal()) throw new HttpError(400, { message: "La fecha de la comunicación no puede ser futura", campo: "fecha" });
  const medio = String(p.medio || "");
  if (!MEDIOS.has(medio)) throw new HttpError(400, { message: "Elige el medio" });
  const contacto = exigirTexto(p.contacto, 3, "Indica con quién se comunicó");
  const resumen = exigirTexto(p.resumen, 10, "Resume lo comunicado");
  const informes = (Array.isArray(p.informe_ids) ? p.informe_ids : []).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0);
  for (const id of informes) await agregarAfectado(s, user, nc, id);
  await s.execute(`INSERT INTO ${T.comunicaciones} (nc_id, fecha, medio, contacto, resumen, informe_ids_json, registrado_por, registrado_en) VALUES (:nc, :f, :m, :c, :r, :i, :por, :en)`, { nc: nc.id, f: p.fecha, m: medio, c: contacto, r: resumen, i: JSON.stringify(informes), por: acc.yo, en: ahora() });
  await auditar(s, user, nc, "comunicar", { motivo: resumen, detalle: { medio, contacto, fecha: p.fecha } });
  await s.commit();
  return json({ message: "Comunicación con el cliente registrada" }, 201);
}

/* POST /api/calidad/nc/:id/retenciones { informe_id, motivo } (calidad:R) */
export async function retenerInforme({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "calidad", "R", { objeto: "nc" });
  const actuo = cargoActuante(request, permiso);
  const acc = await accesoCalidad(s, user, "nc");
  const nc = await ncVisible(s, acc, intParam(params.id), true);
  if (cerradaOAnulada(nc)) throw new HttpError(409, { message: `La ${folioNc(nc.folio_num)} está ${nc.estado}` });
  const p = await readJson(request);
  const informeId = Number.parseInt(String(p.informe_id || ""), 10);
  if (!Number.isFinite(informeId)) throw new HttpError(400, { message: "Elige el informe a retener" });
  const motivo = exigirTexto(p.motivo, 5, "Indica el motivo de la retención");
  if ((await retencionesActivas(s, informeId)).some((r) => Number(r.nc_id) === Number(nc.id))) throw new HttpError(409, { message: "Este informe ya está retenido por esta NC" });
  const referencia = await agregarAfectado(s, user, nc, informeId);
  const informe = await snapshotRow(s, "informes", informeId);
  await s.execute(`INSERT INTO ${T.retenciones} (nc_id, informe_id, motivo, retenido_por, retenido_rol, retenido_en) VALUES (:nc, :i, :m, :por, :rol, :en)`, { nc: nc.id, i: informeId, m: motivo, por: acc.yo, rol: actuo.cargo, en: ahora() });
  await auditar(s, user, nc, "retener", { motivo, detalle: { informe: referencia, informe_estado: informe?.estado, actuo_como: actuo } });
  await registrarAuditoria(s, user, { accion: "retener", entidad: "informes", entidadId: informeId, referencia, motivo, detalle: { nc: folioNc(nc.folio_num), actuo_como: actuo } });
  await s.commit();
  return json({ message: `${referencia} retenido por ${folioNc(nc.folio_num)}${String(informe?.estado) === "enviado" ? " (ya enviado: queda marcado; no se reenvía)" : ""}` }, 201);
}

/* POST /api/calidad/retenciones/:id/liberar { motivo } (calidad:A + reautenticacion) */
export async function liberarRetencion({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "calidad", "A", { objeto: "nc" });
  const actuo = cargoActuante(request, permiso);
  const ret = await filaBloqueada(s, T.retenciones, intParam(params.id));
  if (!ret) throw new HttpError(404, { message: "Retención no encontrada" });
  if (ret.liberada_en) throw new HttpError(409, { message: "La retención ya se liberó" });
  const motivo = exigirTexto((await readJson(request)).motivo, 5, "Indica el motivo de la liberación");
  await exigirReauth(s, request, user, "calidad:A");
  const r = await s.execute(`UPDATE ${T.retenciones} SET liberada_por = :por, liberada_rol = :rol, liberada_en = :en, motivo_liberacion = :m WHERE id = :id AND liberada_en IS NULL`, { por: userIdFromClaims(user), rol: actuo.cargo, en: ahora(), m: motivo, id: ret.id });
  if (!r.rowcount) throw new HttpError(409, { message: "La retención ya se liberó" });
  const nc = (await snapshotRow(s, T.nc, Number(ret.nc_id)))!;
  const referencia = await referenciaDe(s, "informes", Number(ret.informe_id));
  await auditar(s, user, nc, "liberar_retencion", { motivo, detalle: { informe: referencia, actuo_como: actuo } });
  await registrarAuditoria(s, user, { accion: "liberar_retencion", entidad: "informes", entidadId: Number(ret.informe_id), referencia, motivo, detalle: { nc: folioNc(nc.folio_num), actuo_como: actuo } });
  await s.commit();
  return json({ message: `Retención de ${referencia} liberada` });
}

/* ---------- Suspensiones (7.10.1 f) ---------- */

/* POST /api/calidad/nc/:id/suspensiones { tipo: metodo | equipo, clave, motivo } (calidad:R) */
export async function suspender({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "calidad", "R", { objeto: "nc" });
  const actuo = cargoActuante(request, permiso);
  const acc = await accesoCalidad(s, user, "nc");
  const nc = await ncVisible(s, acc, intParam(params.id), true);
  if (cerradaOAnulada(nc)) throw new HttpError(409, { message: `La ${folioNc(nc.folio_num)} está ${nc.estado}` });
  const p = await readJson(request);
  const tipo = String(p.tipo || "");
  const clave = String(p.clave ?? "").trim();
  const motivo = exigirTexto(p.motivo, 5, "Indica el motivo de la suspensión");
  let etiqueta = "";
  let equipo: Row | null = null;
  if (tipo === "metodo") {
    if (!(METODOS_SUSPENDIBLES as readonly string[]).includes(clave)) throw new HttpError(400, { message: "Elige el método a suspender" });
    etiqueta = `Método ${clave}`;
  } else if (tipo === "equipo") {
    equipo = await filaBloqueada(s, "equipos", Number.parseInt(clave, 10) || 0);
    if (!equipo) throw new HttpError(404, { message: "Equipo no encontrado" });
    etiqueta = `Equipo ${equipo.nombre}${equipo.clave_bitacora ? ` (${equipo.clave_bitacora})` : ""}`;
  } else throw new HttpError(400, { message: "Indica si se suspende un método o un equipo" });
  const activas = await suspensionesActivas(s, { tipo: tipo as "metodo" | "equipo", clave: equipo ? String(equipo.id) : clave }, true);
  if (activas.some((a) => Number(a.nc_id) === Number(nc.id))) throw new HttpError(409, { message: `${etiqueta} ya está suspendido por esta NC`, codigo: "ya_suspendido" });
  // Estado del equipo antes de la cadena de suspensiones (si ya estaba suspendido por otra NC, se hereda el de esa).
  const estadoPrevio = equipo ? (activas[0]?.estado_previo_equipo ?? String(equipo.estado || "operativo")) : null;
  await s.execute(`INSERT INTO ${T.suspensiones} (tipo, clave, nc_id, motivo, suspendida_por, suspendida_rol, suspendida_en, estado_previo_equipo) VALUES (:t, :c, :nc, :m, :por, :rol, :en, :prev)`, { t: tipo, c: equipo ? String(equipo.id) : clave, nc: nc.id, m: motivo, por: acc.yo, rol: actuo.cargo, en: ahora(), prev: estadoPrevio });
  if (equipo && String(equipo.estado) !== "fuera_servicio") {
    await s.execute("UPDATE equipos SET estado = 'fuera_servicio' WHERE id = :id", { id: equipo.id });
    await registrarAuditoria(s, user, { accion: "suspender", entidad: "equipos", entidadId: Number(equipo.id), referencia: String(equipo.nombre), motivo, antes: equipo, despues: await snapshotRow(s, "equipos", Number(equipo.id)), detalle: { nc: folioNc(nc.folio_num) } });
  }
  await auditar(s, user, nc, "suspender", { motivo, detalle: { suspension: etiqueta, actuo_como: actuo } });
  await s.commit();
  return json({ message: `${etiqueta} suspendido por ${folioNc(nc.folio_num)}` }, 201);
}

/* POST /api/calidad/suspensiones/:id/reanudar { motivo } (calidad:A + reautenticacion, regla 10) */
export async function reanudar({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "calidad", "A", { objeto: "nc" });
  const actuo = cargoActuante(request, permiso);
  // Mismo orden de bloqueo que suspender (equipo y despues suspensiones) para no cruzarse en MySQL.
  const previa = await s.queryOne<Row>(`SELECT tipo, clave FROM ${T.suspensiones} WHERE id = :id`, { id: intParam(params.id) });
  if (previa?.tipo === "equipo") await filaBloqueada(s, "equipos", Number(previa.clave));
  const su = await filaBloqueada(s, T.suspensiones, intParam(params.id));
  if (!su) throw new HttpError(404, { message: "Suspensión no encontrada" });
  if (su.reanudada_en) throw new HttpError(409, { message: "Ya se reanudó" });
  const excepcion = exigirSegregacion(evaluarReanudacion(userIdFromClaims(user) as number, su.suspendida_por), su, userIdFromClaims(user) as number, "reanudar");
  const motivo = exigirTexto((await readJson(request)).motivo, 5, "Indica el motivo de la reanudación");
  await exigirReauth(s, request, user, "calidad:A");
  const r = await s.execute(`UPDATE ${T.suspensiones} SET reanudada_por = :por, reanudada_rol = :rol, reanudada_en = :en, motivo_reanudacion = :m WHERE id = :id AND reanudada_en IS NULL`, { por: userIdFromClaims(user), rol: actuo.cargo, en: ahora(), m: motivo, id: su.id });
  if (!r.rowcount) throw new HttpError(409, { message: "Ya se reanudó" });
  const nc = (await snapshotRow(s, T.nc, Number(su.nc_id)))!;
  // Otra NC abierta puede suspender lo mismo: sigue suspendido hasta liberar todas.
  const quedan = await suspensionesActivas(s, { tipo: su.tipo, clave: String(su.clave) }, true);
  const etiqueta = su.tipo === "metodo" ? `Método ${su.clave}` : `Equipo #${su.clave}`;
  if (su.tipo === "equipo" && !quedan.length) {
    const equipo = await snapshotRow(s, "equipos", Number(su.clave));
    if (equipo && String(equipo.estado) === "fuera_servicio") {
      await s.execute("UPDATE equipos SET estado = :e WHERE id = :id", { e: su.estado_previo_equipo || "operativo", id: equipo.id });
      // El estado previo es la foto al suspender: se ajusta con la misma regla del inventario (mantenimientos pendientes o ya completados).
      await syncEquipoEstado(s, Number(equipo.id));
      await registrarAuditoria(s, user, { accion: "reanudar", entidad: "equipos", entidadId: Number(equipo.id), referencia: String(equipo.nombre), motivo, antes: equipo, despues: await snapshotRow(s, "equipos", Number(equipo.id)), detalle: { nc: folioNc(nc.folio_num) } });
    }
  }
  await auditar(s, user, nc, "reanudar", { motivo, detalle: { suspension: etiqueta, sigue_suspendido_por: quedan.length ? quedan.map((q) => folioNc(q.nc_folio)).join(", ") : null, actuo_como: actuo, ...detalleExcepcion(excepcion) } });
  await s.commit();
  return json({ message: quedan.length ? `Reanudado en esta NC; sigue suspendido por ${quedan.map((q) => folioNc(q.nc_folio)).join(", ")}` : `${etiqueta} reanudado` });
}

/* GET /api/calidad/suspensiones/activas: para los avisos de los formatos (cualquier sesion). */
export async function listarSuspensionesActivas({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  // Para los avisos de los formatos: quien captura ensayos o usa equipos, o calidad (no cualquier sesion).
  const auth = await cargarAutorizacion(s, user);
  if (!permisoDe(auth, "ensayos", "V") && !permisoDe(auth, "equipos", "V") && !permisoDe(auth, "calidad", "V", { objeto: "nc" })) throw new HttpError(403, { message: "Las suspensiones activas se consultan desde ensayos, equipos o calidad" });
  const filas = await suspensionesActivas(s);
  return json({ items: filas.map((f) => ({ id: f.id, tipo: f.tipo, clave: f.clave, nc: folioNc(f.nc_folio), equipo: f.equipo_nombre || null, desde: f.suspendida_en })) });
}

/* ---------- Cierre ---------- */

/* Condiciones para cerrar (409 con explicacion). */
async function exigirCerrable(s: Session, nc: Row): Promise<void> {
  const id = Number(nc.id);
  if (cerradaOAnulada(nc)) throw new HttpError(409, { message: `La ${folioNc(nc.folio_num)} ya está ${nc.estado}`, codigo: "nc_cerrada" });
  if (!nc.afecta_resultados_emitidos || !nc.trabajo_detenido || !nc.notificar_cliente) throw new HttpError(409, { message: "Falta la evaluación de impacto" });
  if (nc.requiere_accion_correctiva === "no") {
    if (String(nc.justificacion_sin_accion || "").trim().length < 10) throw new HttpError(409, { message: "Justifica por qué la NC no requiere acción correctiva (8.7.1: no puede repetirse)" });
    // Con acciones definidas o una verificacion registrada ya no vale la rama "sin accion": se cierra verificando su eficacia.
    const acciones = Number(await s.scalar(`SELECT COUNT(*) FROM ${T.acciones} WHERE nc_id = :id AND estado <> 'cancelada'`, { id }));
    const verificaciones = Number(await s.scalar(`SELECT COUNT(*) FROM ${T.verificaciones} WHERE nc_id = :id`, { id }));
    if (acciones || verificaciones || !["abierta", "en_analisis"].includes(String(nc.estado))) throw new HttpError(409, { message: "La NC ya tiene acciones correctivas o una verificación de eficacia: se cierra cuando la última verificación sea eficaz", codigo: "acciones_pendientes" });
  } else if (nc.requiere_accion_correctiva === "si") {
    const acciones = await s.query<Row>(`SELECT estado FROM ${T.acciones} WHERE nc_id = :id`, { id });
    if (acciones.some((a) => ["pendiente", "en_proceso"].includes(String(a.estado)))) throw new HttpError(409, { message: "Hay acciones correctivas pendientes o en proceso", codigo: "acciones_pendientes" });
    if (String(nc.estado) !== "en_verificacion") throw new HttpError(409, { message: "La NC debe estar en verificación de eficacia para cerrarse", codigo: "sin_verificacion" });
    const ultima = await s.queryOne<Row>(`SELECT resultado FROM ${T.verificaciones} WHERE nc_id = :id ORDER BY id DESC LIMIT 1`, { id });
    if (!ultima) throw new HttpError(409, { message: "Falta verificar la eficacia de las acciones", codigo: "sin_verificacion" });
    if (ultima.resultado !== "eficaz") throw new HttpError(409, { message: "La última verificación fue no eficaz", codigo: "no_eficaz" });
  } else throw new HttpError(409, { message: "Decide si la NC requiere acción correctiva" });
  if (Number(await s.scalar(`SELECT COUNT(*) FROM ${T.suspensiones} WHERE nc_id = :id AND reanudada_en IS NULL`, { id }))) throw new HttpError(409, { message: "Hay métodos o equipos suspendidos por esta NC; se reanudan antes de cerrar", codigo: "suspensiones_activas" });
  if (Number(await s.scalar(`SELECT COUNT(*) FROM ${T.retenciones} WHERE nc_id = :id AND liberada_en IS NULL`, { id }))) throw new HttpError(409, { message: "Hay informes retenidos por esta NC; se liberan antes de cerrar", codigo: "retenciones_activas" });
  if (nc.notificar_cliente === "si" && !Number(await s.scalar(`SELECT COUNT(*) FROM ${T.comunicaciones} WHERE nc_id = :id`, { id }))) throw new HttpError(409, { message: "Registra la comunicación al cliente antes de cerrar (se decidió notificarlo)", codigo: "falta_comunicacion" });
}

function carpetaPdf(): string {
  return path.join(/*turbopackIgnore: true*/ getConfig().INSTANCE_DIR, "calidad", "nc");
}

/* POST /api/calidad/nc/:id/cerrar { conclusion } (calidad:A + reautenticacion; regla 9) */
export async function cerrarNc({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "calidad", "A", { objeto: "nc" });
  const actuo = cargoActuante(request, permiso);
  const acc = await accesoCalidad(s, user, "nc");
  const nc = await ncVisible(s, acc, intParam(params.id), true);
  await sinSolicitudPendiente(s, nc);
  await exigirCerrable(s, nc);
  const excepcion = exigirSegregacion(evaluarCierreNc(acc.yo, responsablesNc(nc)), nc, acc.yo, "cerrar");
  const conclusion = exigirTexto((await readJson(request)).conclusion, 10, "Escribe la conclusión del cierre");
  await exigirReauth(s, request, user, "calidad:A");
  const r = await s.execute(`UPDATE ${T.nc} SET estado = 'cerrada', cerrada_por = :por, cerrada_rol = :rol, cerrada_en = :en, conclusion = :c WHERE id = :id AND estado NOT IN ('cerrada', 'anulada')`, { por: acc.yo, rol: actuo.cargo, en: ahora(), c: conclusion, id: nc.id });
  // Doble cierre concurrente: la segunda peticion no afecta filas.
  if (!r.rowcount) throw new HttpError(409, { message: "La NC ya se cerró", codigo: "nc_cerrada" });
  const cerrada = (await snapshotRow(s, T.nc, Number(nc.id)))!;
  // PDF "Registro de no conformidad" con su huella; se escribe tras el UPDATE y se descarta si la transaccion falla.
  const pdf = await renderNcPdf(s, await detalleNc(s, acc, cerrada));
  const sha = createHash("sha256").update(pdf).digest("hex");
  const nombre = `${folioNc(cerrada.folio_num).replace(" ", "-")}-${Date.now()}.pdf`;
  fs.mkdirSync(carpetaPdf(), { recursive: true });
  const ruta = path.join(/*turbopackIgnore: true*/ carpetaPdf(), nombre);
  // Escritura atómica (temporal + rename): nunca queda un PDF a medias con el nombre final.
  const temporal = path.join(/*turbopackIgnore: true*/ carpetaPdf(), `.${nombre}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temporal, pdf, { flag: "wx" });
    fs.renameSync(temporal, ruta);
  } catch (error) {
    fs.rmSync(temporal, { force: true });
    throw error;
  }
  try {
    await s.execute(`UPDATE ${T.nc} SET archivo_pdf = :a, pdf_sha256 = :sha WHERE id = :id`, { a: nombre, sha, id: nc.id });
    await auditar(s, user, nc, "cerrar", { antes: nc, despues: await snapshotRow(s, T.nc, Number(nc.id)), motivo: conclusion, detalle: { pdf_sha256: sha, actuo_como: actuo, ...detalleExcepcion(excepcion) } });
    await s.commit();
  } catch (error) {
    fs.rmSync(ruta, { force: true });
    throw error;
  }
  return json({ message: `${folioNc(cerrada.folio_num)} cerrada; PDF generado`, sha256: sha });
}

/* GET /api/calidad/nc/:id/pdf: el PDF final (cerrada) o una vista a pedido del estado actual. */
export async function pdfNc({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const acc = await accesoCalidad(s, user, "nc");
  const nc = await ncVisible(s, acc, intParam(params.id));
  let bytes: Buffer;
  let integridad = "a_pedido";
  // El PDF final se genero con la vista completa (quien cierra tiene V total). Sin calidad:V total se entrega la version
  // a pedido con la vista de la persona (incidencias ajenas solo por folio y estado), nunca el archivo final.
  if (nc.archivo_pdf && param(request, "actual") !== "1" && acc.total) {
    const ruta = path.join(/*turbopackIgnore: true*/ carpetaPdf(), String(nc.archivo_pdf));
    if (!fs.existsSync(ruta)) throw new HttpError(404, { message: "El PDF final no está en el servidor" });
    bytes = fs.readFileSync(ruta);
    const obtenido = createHash("sha256").update(bytes).digest("hex");
    integridad = obtenido === String(nc.pdf_sha256) ? "ok" : "alterado";
    // Como el PDF del informe: alerta en la bitacora e incidencia automatica (una por PDF alterado).
    if (integridad === "alterado") {
      await auditar(s, user, nc, "alerta_integridad", { motivo: "El SHA-256 del PDF final no coincide con el guardado al cerrar", detalle: { esperado: nc.pdf_sha256, obtenido } });
      await incidenciaPorAlertaIntegridad(s, { clave: `nc:${nc.id}:${nc.pdf_sha256}`, descripcion: `El PDF final de la ${folioNc(nc.folio_num)} no coincide con su huella SHA-256 registrada al cerrarla (alerta de integridad).`, registros: [] });
    }
  } else bytes = await renderNcPdf(s, await detalleNc(s, acc, nc));
  await auditar(s, user, nc, "descargar", { detalle: { pdf: integridad === "a_pedido" ? "a pedido" : "final" } });
  await s.commit();
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${folioNc(nc.folio_num).replace(" ", "-")}.pdf"`, "X-Content-Type-Options": "nosniff", "X-Integridad-Pdf": integridad, ...(nc.pdf_sha256 ? { "X-Pdf-Sha256": String(nc.pdf_sha256) } : {}) } });
}

/* ---------- Propuesta de cambio documental (retirada) ---------- */

/*
 * POST /api/calidad/nc/:id/propuesta-documental — retirado junto con el flujo
 * anterior de control documental: "requiere cambio documental" queda como bandera con nota
 * en la NC. Las NC que ya apuntan a una propuesta la conservan en solo lectura.
 */
export async function proponerCambioDocumental(): Promise<Response> {
  return funcionalidadRetirada();
}

/* ---------- Anular (segundo usuario) ---------- */

/* POST /api/calidad/nc/:id/anular { motivo } */
export async function anularNc({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "calidad", "AN", { objeto: "nc" });
  const actuo = cargoActuante(request, permiso);
  const acc = await accesoCalidad(s, user, "nc");
  const nc = await ncVisible(s, acc, intParam(params.id), true);
  if (String(nc.estado) === "anulada") throw new HttpError(409, { message: "La NC ya está anulada" });
  await exigirSinBloqueosActivos(s, nc);
  const motivo = exigirTexto((await readJson(request)).motivo, 5, "Indica el motivo de la anulación");
  await exigirReauth(s, request, user, "calidad:AN");
  const solicitud = await crearSolicitud(s, user, { tipo: "anular_calidad", entidad: T.nc, entidadId: Number(nc.id), referencia: folioNc(nc.folio_num), accion: "anular", motivo, cargo: actuo.cargo });
  await s.commit();
  return respuestaSolicitud(solicitud, `la anulación de ${folioNc(nc.folio_num)}`);
}

async function exigirSinBloqueosActivos(s: Session, nc: Row): Promise<void> {
  const susp = Number(await s.scalar(`SELECT COUNT(*) FROM ${T.suspensiones} WHERE nc_id = :id AND reanudada_en IS NULL`, { id: nc.id }));
  const ret = Number(await s.scalar(`SELECT COUNT(*) FROM ${T.retenciones} WHERE nc_id = :id AND liberada_en IS NULL`, { id: nc.id }));
  if (susp || ret) throw new HttpError(409, { message: "La NC tiene suspensiones o retenciones activas; se reanudan o liberan antes de anularla", codigo: "bloqueos_activos" });
}

/* Ejecutor de la solicitud anular_calidad (incidencias o NC). */
export async function ejecutarAnulacionCalidad(ctx: { s: Session; user: CurrentUser; actuo: { rol_id: number; cargo: string }; solicitud: Row; motivo: string }): Promise<Record<string, unknown>> {
  const { s, user } = ctx;
  const tabla = String(ctx.solicitud.entidad);
  if (tabla !== T.incidencias && tabla !== T.nc) throw new HttpError(409, { message: "La solicitud no corresponde a una incidencia ni a una NC" });
  const row = await filaBloqueada(s, tabla, Number(ctx.solicitud.entidad_id));
  if (!row) throw new HttpError(404, { message: "El registro ya no existe" });
  if (String(row.estado) === "anulada") throw new HttpError(409, { message: "Ya está anulado" });
  if (tabla === T.incidencias && String(row.estado) === "escalada_a_nc") {
    const nc = await s.queryOne<Row>(`SELECT folio_num, estado FROM ${T.nc} WHERE id = :id`, { id: row.nc_id });
    if (nc && String(nc.estado) !== "anulada") throw new HttpError(409, { message: `La incidencia está escalada a ${folioNc(nc.folio_num)}; solo se anula si esa NC está anulada` });
  }
  if (tabla === T.nc) await exigirSinBloqueosActivos(s, row);
  await s.execute(`UPDATE ${tabla} SET estado_previo = estado, estado = 'anulada', anulado_en = :en, anulado_por = :por, anulado_rol = :rol, motivo_anulacion = :m WHERE id = :id AND estado <> 'anulada'`, { en: ahora(), por: userIdFromClaims(user), rol: ctx.actuo.cargo, m: ctx.solicitud.motivo, id: row.id });
  const despues = await snapshotRow(s, tabla, Number(row.id));
  const referencia = tabla === T.nc ? folioNc(row.folio_num) : folioIncidencia(row.folio_num);
  await registrarAuditoria(s, user, { accion: "anular", entidad: tabla, entidadId: Number(row.id), referencia, antes: row, despues, motivo: String(ctx.solicitud.motivo), detalle: { solicitud_id: ctx.solicitud.id, solicitado_por: ctx.solicitud.solicitado_por, actuo_como: ctx.actuo } });
  return { item: despues, referencia };
}

/* ---------- Excepciones de segregacion (reglas 8, 9 y 10) ---------- */

export async function violacionParaExcepcionNc(s: Session, user: CurrentUser, id: number, accion: string) {
  if (accion !== "verificar" && accion !== "cerrar") throw new HttpError(400, { message: "En una NC la excepción aplica a verificar o cerrar" });
  await requirePermission(s, user, "calidad", accion === "verificar" ? "R" : "A", { objeto: "nc" });
  const acc = await accesoCalidad(s, user, "nc");
  const nc = await ncVisible(s, acc, id);
  if (accion === "verificar") {
    if (String(nc.estado) !== "en_verificacion") throw new HttpError(409, { message: "La NC no está en verificación" });
    return { violacion: evaluarVerificacion(acc.yo, await participantesDe(s, id)), row: nc, referencia: folioNc(nc.folio_num) };
  }
  if (cerradaOAnulada(nc)) throw new HttpError(409, { message: "La NC ya está cerrada o anulada" });
  return { violacion: evaluarCierreNc(acc.yo, responsablesNc(nc)), row: nc, referencia: folioNc(nc.folio_num) };
}

export async function violacionParaExcepcionSuspension(s: Session, user: CurrentUser, id: number, accion: string) {
  if (accion !== "reanudar") throw new HttpError(400, { message: "En una suspensión la excepción aplica a reanudar" });
  await requirePermission(s, user, "calidad", "A", { objeto: "nc" });
  const su = await s.queryOne<Row>(`SELECT su.*, n.folio_num AS nc_folio FROM ${T.suspensiones} su LEFT JOIN ${T.nc} n ON n.id = su.nc_id WHERE su.id = :id`, { id });
  if (!su) throw new HttpError(404, { message: "Suspensión no encontrada" });
  if (su.reanudada_en) throw new HttpError(409, { message: "Ya se reanudó" });
  return { violacion: evaluarReanudacion(userIdFromClaims(user) as number, su.suspendida_por), row: su, referencia: `${su.tipo === "metodo" ? `Método ${su.clave}` : `Equipo #${su.clave}`} (${folioNc(su.nc_folio)})` };
}

