/*
 * Documentos SGC, Fase 2: flujo de aprobacion.
 *
 *   GET  /api/sgc/solicitudes                         mis solicitudes (Mejora Continua: todas)
 *   POST /api/sgc/solicitudes                         nueva solicitud (documento_proponer), con archivo de apoyo opcional
 *   GET  /api/sgc/solicitudes/:sid/apoyo              archivo de apoyo (solicitante o quien crea fichas)
 *   POST /api/sgc/solicitudes/:sid/aceptar            Mejora Continua: crea la ficha (nuevo) o abre la revision (cambio) y asigna responsables
 *   POST /api/sgc/solicitudes/:sid/rechazar           Mejora Continua, con motivo
 *   POST /api/sgc/revisiones/:rid/revisar             revisor asignado: aceptar | devolver | rechazar
 *   POST /api/sgc/revisiones/:rid/autorizar           autorizador asignado: autorizar (contrasena) | devolver | rechazar
 *   POST /api/sgc/revisiones/:rid/publicar            Mejora Continua (documento_publicar, contrasena): vigente + anterior obsoleta
 *   POST /api/sgc/revisiones/:rid/reasignar           Mejora Continua, con motivo, mientras no este autorizada
 *   POST /api/sgc/documentos/:id/renovar              Mejora Continua: renovar la vigente sin cambios (revisor y autorizador)
 *   POST /api/sgc/renovaciones/:nid/revisar           revisor: confirmar | rechazar
 *   POST /api/sgc/renovaciones/:nid/autorizar         autorizador: autorizar (contrasena) | rechazar
 *   POST /api/sgc/documentos/:id/obsoletar            Mejora Continua (documento_obsoletar, contrasena): solicitud de segundo usuario
 *   GET  /api/sgc/bandeja                             tareas pendientes de la persona
 *
 * Cada decision queda en sgc_flujo_acciones (usuario, cargo, papel, fecha y
 * comentario) y en la bitacora. Regla 11 de segregacion: tres personas
 * distintas y nadie actua en un papel que no le fue asignado. El administrador
 * tecnico no tiene acciones documentales: no actua en ningun paso.
 */
import fs from "node:fs";
import path from "node:path";
import { requireUser, type CurrentUser } from "../../auth";
import { registrarAuditoria } from "../../audit";
import { contentDisposition, descartarArchivo, guardarArchivoEn, rutaEn, validarArchivoSubido, type ArchivoGuardado } from "../../adjuntos";
import { getConfig } from "../../config";
import { type Row, type Session } from "../../db";
import { HttpError, intParam, json, readJson, type RouteContext } from "../../http";
import { cargarAutorizacion, cargoActuante, hoy, permisoDe } from "../../rbac";
import { copiarDistribucion, datosDistribucion, guardarDistribucion, lecturasPendientesDe } from "./lecturas";
import { exigirReauth } from "../../seguridad";
import { crearSolicitud, exigirSinSolicitudPendiente, porAutorizarDe, respuestaSolicitud, type ContextoEjecucion } from "../../solicitudes";
import { accesoSgc, documentoVisible, tiene, type AccesoSgc } from "./acceso";
import {
  acceso,
  ahora,
  datosFicha,
  documentosVisibles,
  ENTIDAD,
  exigir,
  fechaONull,
  fichaVisible,
  idONull,
  referenciaDe,
  revisionVisible,
  sgcDir,
  textoLargo,
  texto,
  validarFicha,
  validarResponsables,
  type Responsables,
} from "./documentos";
import { ANIOS_PROXIMA_REVISION, ESTADOS_TRABAJO, MIME_SGC, MOTIVO_MIN_SGC, pendienteDeRevision, sumarAnios } from "../../../shared/documentos";
import type { AccionDocumental } from "../../../shared/permisos";
import { evaluarPapelDocumento, evaluarTresPersonas, type PapelDocumento } from "../../../shared/segregacion";

const EXT_APOYO = ["pdf", "docx", "xlsx", "xls", "pptx", "png", "jpg", "jpeg"];
const MIME_APOYO: Record<string, string> = { ...MIME_SGC, png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
const COMENTARIO_MIN = 5;

/* ---------- Auxiliares ---------- */

/* Cargo con que actua la persona para la accion documental (si tiene varios roles que la otorgan, el elegido). */
function cargoDe(request: Request, a: AccesoSgc, accion: AccionDocumental): string | null {
  const permiso = permisoDe(a.auth, "documentos", accion);
  return permiso ? cargoActuante(request, permiso).cargo : null;
}

interface AccionFlujo {
  revision_id: number;
  accion: string;
  decision?: string | null;
  comentario?: string | null;
  usuario_id: number | null;
  cargo?: string | null;
  papel?: string | null;
  renovacion_id?: number | null;
  fecha?: string;
}
export async function registrarFlujo(s: Session, x: AccionFlujo): Promise<void> {
  await s.execute(
    "INSERT INTO sgc_flujo_acciones (revision_id, accion, decision, comentario, usuario_id, cargo, papel, renovacion_id, fecha) VALUES (:rev, :accion, :decision, :comentario, :usuario, :cargo, :papel, :renov, :fecha)",
    { rev: x.revision_id, accion: x.accion, decision: x.decision ?? null, comentario: x.comentario ?? null, usuario: x.usuario_id, cargo: x.cargo ?? null, papel: x.papel ?? null, renov: x.renovacion_id ?? null, fecha: x.fecha || ahora() },
  );
}

function comentarioObligatorio(raw: Record<string, unknown>, que: string): string {
  const c = String(raw.comentario || "").trim();
  if (c.length < COMENTARIO_MIN) throw new HttpError(400, { message: `Escribe el comentario ${que} (al menos ${COMENTARIO_MIN} caracteres)`, campo: "comentario" });
  return c.slice(0, 2000);
}

/* Papeles en que cada persona ya actuo en una revision (elaborar/enviar, revisar, autorizar), segun su linea de tiempo. */
async function papelesEjercidos(s: Session, revId: number): Promise<Map<number, Set<string>>> {
  const out = new Map<number, Set<string>>();
  const filas = await s.query<Row>("SELECT usuario_id, papel FROM sgc_flujo_acciones WHERE revision_id = :id AND renovacion_id IS NULL AND papel IN ('elaborador', 'revisor', 'autorizador') AND usuario_id IS NOT NULL", { id: revId });
  for (const f of filas) out.set(Number(f.usuario_id), (out.get(Number(f.usuario_id)) || new Set()).add(String(f.papel)));
  return out;
}

/*
 * Regla 11 tambien en el tiempo: quien ya actuo en un papel de esta revision no
 * puede actuar ni ser asignado en otro (una reasignacion no la elude).
 */
export async function exigirSinOtroPapel(s: Session, revId: number, usuarioId: number, papel: PapelDocumento, status = 403): Promise<void> {
  const previos = (await papelesEjercidos(s, revId)).get(Number(usuarioId));
  const otro = previos ? [...previos].find((p) => p !== papel) : undefined;
  if (otro) throw new HttpError(status, { message: `Esa persona ya actuó como ${otro} en esta revisión; no puede actuar como ${papel} (tres personas distintas)`, codigo: "segregacion", regla: 11, clave: "documento_tres_personas", campo: papel });
}

/* Regla 11: la persona debe estar asignada en ese papel y tener la accion documental del papel. */
function exigirPapel(a: AccesoSgc, rev: Row, papel: PapelDocumento, accion: AccionDocumental): void {
  if (!tiene(a, accion)) throw new HttpError(403, { message: `No tienes permiso para actuar como ${papel} (${accion})`, codigo: "sin_permiso" });
  const v = evaluarPapelDocumento(a.yo, rev[`${papel}_id`] as number | null, papel);
  if (v) throw new HttpError(403, { message: v.mensaje, codigo: "segregacion", regla: v.regla, clave: v.clave });
  const tres = evaluarTresPersonas({ elaborador_id: rev.elaborador_id, revisor_id: rev.revisor_id, autorizador_id: rev.autorizador_id });
  if (tres) throw new HttpError(409, { message: tres.mensaje, codigo: "segregacion", regla: tres.regla, clave: tres.clave });
}

function exigirEstado(rev: Row, estados: string[], que: string): void {
  if (!estados.includes(String(rev.estado))) throw new HttpError(409, { message: `La revisión ${rev.numero} no está ${que} (está ${String(rev.estado).replace("_", " ")})`, codigo: "estado" });
}

function responsablesCompletos(raw: Record<string, unknown>): Responsables {
  const r: Responsables = { elaborador_id: idONull(raw.elaborador_id), revisor_id: idONull(raw.revisor_id), autorizador_id: idONull(raw.autorizador_id) };
  for (const [campo, papel] of [["elaborador_id", "elaborador"], ["revisor_id", "revisor"], ["autorizador_id", "autorizador"]] as const) {
    if (!r[campo]) throw new HttpError(400, { message: `Asigna al ${papel}`, campo: papel });
  }
  return r;
}

const fechaLimiteDe = (raw: Record<string, unknown>): string | null => {
  const f = fechaONull(raw.fecha_limite, "fecha_limite");
  if (f && f < hoy()) throw new HttpError(400, { message: "La fecha límite no puede ser anterior a hoy", campo: "fecha_limite" });
  return f;
};

/* ---------- Solicitudes ---------- */

const refSolicitud = (id: number) => `Solicitud SGC #${id}`;

export async function crearSolicitudSgc({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  exigir(a, "documento_proponer", "No tienes permiso para proponer documentos o cambios (documento_proponer)");
  const esForm = (request.headers.get("content-type") || "").toLowerCase().startsWith("multipart/form-data");
  let campos: Record<string, unknown> = {};
  let apoyo: { nombre_original: string; extension: string; bytes: Buffer } | null = null;
  if (esForm) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, { message: "No se pudieron leer los datos enviados" });
    }
    for (const [k, v] of form.entries()) if (typeof v === "string") campos[k] = v;
    const archivo = form.get("archivo");
    if (archivo instanceof File && archivo.name && archivo.size) {
      const cfg = getConfig();
      apoyo = await validarArchivoSubido(archivo, { limiteBytes: cfg.DOCUMENTOS_MAX_MB * 1024 * 1024, limiteMb: cfg.DOCUMENTOS_MAX_MB, extensiones: EXT_APOYO });
    }
  } else campos = await readJson(request);
  const datos = await datosSolicitud(s, a, campos);
  const r = await s.execute(
    `INSERT INTO sgc_solicitudes (tipo, documento_id, area_codigo, tipo_codigo, titulo_propuesto, necesidad, justificacion, solicitante_id, estado, creado_en)
     VALUES (:tipo, :documento_id, :area_codigo, :tipo_codigo, :titulo_propuesto, :necesidad, :justificacion, :yo, 'pendiente', :en)`,
    { ...datos, yo: a.yo, en: ahora() },
  );
  const id = Number(r.lastrowid);
  let guardado: ArchivoGuardado | null = null;
  try {
    if (apoyo) {
      guardado = await guardarArchivoEn(sgcDir(), path.join(/*turbopackIgnore: true*/ "solicitudes", String(id)), apoyo.extension, apoyo.bytes);
      const relativo = path.relative(/*turbopackIgnore: true*/ sgcDir(), guardado.ruta).split(path.sep).join("/");
      await s.execute("UPDATE sgc_solicitudes SET apoyo_nombre_original = :n, apoyo_nombre_almacenado = :a, apoyo_sha256 = :sha, apoyo_tamano_bytes = :t, apoyo_mime = :m WHERE id = :id", { n: apoyo.nombre_original, a: relativo, sha: guardado.sha256, t: guardado.tamano_bytes, m: MIME_APOYO[apoyo.extension] || "application/octet-stream", id });
    }
    await registrarAuditoria(s, user, {
      accion: "proponer",
      entidad: datos.documento_id ? ENTIDAD : "sgc_solicitudes",
      entidadId: datos.documento_id || id,
      referencia: datos.documento_id ? String(datos.referencia) : refSolicitud(id),
      motivo: datos.justificacion,
      detalle: { solicitud_id: id, tipo: datos.tipo, area: datos.area_codigo, tipo_documental: datos.tipo_codigo, titulo_propuesto: datos.titulo_propuesto, apoyo: apoyo ? { nombre: apoyo.nombre_original, sha256: guardado?.sha256 } : null },
    });
    await s.commit();
  } catch (error) {
    await s.rollback();
    await descartarArchivo(guardado);
    throw error;
  }
  return json({ message: `Solicitud #${id} registrada; Mejora Continua la atenderá`, id }, 201);
}

async function datosSolicitud(s: Session, a: AccesoSgc, raw: Record<string, unknown>) {
  const tipo = raw.tipo === "cambio" ? "cambio" : raw.tipo === "nuevo" ? "nuevo" : null;
  if (!tipo) throw new HttpError(400, { message: "Elige si es un documento nuevo o un cambio a un documento existente", campo: "tipo" });
  const justificacion = String(raw.justificacion || "").trim().slice(0, 4000);
  if (justificacion.length < 10) throw new HttpError(400, { message: "Escribe la justificación (al menos 10 caracteres)", campo: "justificacion" });
  const necesidad = textoLargo(raw.necesidad);
  if (tipo === "cambio") {
    const docId = idONull(raw.documento_id);
    if (!docId) throw new HttpError(400, { message: "Elige el documento que se cambiaría", campo: "documento" });
    const { doc } = await documentoVisible(s, a, docId).catch(() => {
      throw new HttpError(400, { message: "Elige un documento que puedas consultar", campo: "documento" });
    });
    if (doc.estado === "obsoleto") throw new HttpError(409, { message: "El documento está obsoleto: propón un documento nuevo", campo: "documento" });
    if (doc.origen === "externo") throw new HttpError(409, { message: "Los documentos externos no pasan por el flujo: se verifica su vigencia o se registra su nueva versión", campo: "documento", codigo: "externo" });
    return { tipo, documento_id: docId, area_codigo: doc.area_codigo, tipo_codigo: doc.tipo_codigo, titulo_propuesto: String(doc.titulo), necesidad, justificacion, referencia: referenciaDe(doc) };
  }
  const area = texto(raw.area_codigo ?? raw.area, 4).toUpperCase();
  const tipoDoc = texto(raw.tipo_codigo ?? raw.tipo_documental, 2).toUpperCase();
  if (!(await s.queryOne<Row>("SELECT codigo FROM sgc_areas WHERE codigo = :c AND activo = 1", { c: area }))) throw new HttpError(400, { message: "Elige el área de gestión", campo: "area" });
  if (!(await s.queryOne<Row>("SELECT codigo FROM sgc_tipos WHERE codigo = :c AND activo = 1", { c: tipoDoc }))) throw new HttpError(400, { message: "Elige el tipo documental", campo: "tipo_documental" });
  const titulo = texto(raw.titulo_propuesto ?? raw.titulo, 300);
  if (!titulo) throw new HttpError(400, { message: "Escribe el título propuesto", campo: "titulo" });
  return { tipo, documento_id: null, area_codigo: area, tipo_codigo: tipoDoc, titulo_propuesto: titulo, necesidad, justificacion, referencia: titulo };
}

export async function listarSolicitudesSgc({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const atiende = tiene(a, "documento_crear_ficha");
  const estado = new URL(request.url).searchParams.get("estado") || "";
  const filas = await s.query<Row>(
    `SELECT so.*, u.nombre AS solicitante_nombre, r.nombre AS resuelta_por_nombre, d.clave AS documento_clave, d.titulo AS documento_titulo
     FROM sgc_solicitudes so LEFT JOIN usuarios u ON u.id = so.solicitante_id LEFT JOIN usuarios r ON r.id = so.resuelta_por LEFT JOIN sgc_documentos d ON d.id = so.documento_id
     ORDER BY so.id DESC LIMIT 500`,
  );
  const visibles: Row[] = [];
  for (const f of filas) {
    if (!atiende && Number(f.solicitante_id) !== a.yo) continue;
    if (estado && f.estado !== estado) continue;
    // Una solicitud sobre un documento que la persona ya no puede ver no muestra sus datos.
    if (f.documento_id) {
      const ve = await documentoVisible(s, a, Number(f.documento_id)).then(() => true, () => false);
      if (!ve) {
        f.documento_clave = null;
        f.documento_titulo = null;
        f.titulo_propuesto = "(documento restringido)";
        f.justificacion = "(oculta: no tienes acceso al documento)";
        f.necesidad = null;
        f.apoyo_nombre_almacenado = null;
      }
    }
    const { apoyo_nombre_almacenado: _x, ...resto } = f;
    void _x;
    visibles.push({ ...resto, con_apoyo: !!f.apoyo_nombre_almacenado, puede: { atender: atiende && f.estado === "pendiente" } });
  }
  return json({ items: visibles, puede: { proponer: tiene(a, "documento_proponer"), atender: atiende } });
}

async function solicitudDe(s: Session, a: AccesoSgc, sid: number): Promise<Row> {
  const f = Number.isInteger(sid) && sid > 0 ? await s.queryOne<Row>("SELECT * FROM sgc_solicitudes WHERE id = :id", { id: sid }) : null;
  if (!f || (!tiene(a, "documento_crear_ficha") && Number(f.solicitante_id) !== a.yo)) throw new HttpError(404, { message: "Solicitud no encontrada" });
  return f;
}

export async function apoyoSolicitud({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const f = await solicitudDe(s, a, intParam(params.sid));
  if (f.documento_id && !(await documentoVisible(s, a, Number(f.documento_id)).then(() => true, () => false))) throw new HttpError(404, { message: "Solicitud no encontrada" });
  if (!f.apoyo_nombre_almacenado) throw new HttpError(404, { message: "La solicitud no tiene archivo de apoyo" });
  const ruta = rutaEn(sgcDir(), f.apoyo_nombre_almacenado);
  if (!fs.existsSync(ruta)) throw new HttpError(404, { message: "El archivo no está en el servidor" });
  const bytes = await fs.promises.readFile(ruta);
  await registrarAuditoria(s, user, { accion: "descargar", entidad: "sgc_solicitudes", entidadId: Number(f.id), referencia: refSolicitud(Number(f.id)), detalle: { nombre: f.apoyo_nombre_original } });
  await s.commit();
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "Content-Type": String(f.apoyo_mime || "application/octet-stream"), "Content-Disposition": contentDisposition("attachment", String(f.apoyo_nombre_original)), "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Length": String(bytes.length) } });
}

/*
 * Aceptar: documento nuevo -> ficha con la clave autorizada y revision en
 * borrador sin archivo (lo carga el elaborador); cambio -> revision de trabajo
 * sin tocar la vigente. En ambos casos con los tres responsables.
 */
export async function aceptarSolicitudSgc(ctx: RouteContext): Promise<Response> {
  const { request, s, params } = ctx;
  const user = await requireUser(request);
  const a = await acceso(s, user);
  exigir(a, "documento_crear_ficha", "Solo Mejora Continua atiende las solicitudes (documento_crear_ficha)");
  const f = await solicitudDe(s, a, intParam(params.sid));
  if (f.estado !== "pendiente") throw new HttpError(409, { message: `La solicitud #${f.id} ya está ${f.estado}` });
  const raw = await readJson(request);
  const resultado = await aceptarInterna(s, user, a, request, f, raw);
  await s.commit();
  return json({ message: resultado.message, documento_id: resultado.documento_id, revision_id: resultado.revision_id, numero: resultado.numero });
}

async function aceptarInterna(s: Session, user: CurrentUser, a: AccesoSgc, request: Request, f: Row, raw: Record<string, unknown>) {
  // Conflictos del documento antes que los datos: una revision o renovacion en curso responde 409.
  if (f.tipo === "cambio") {
    const { revisiones } = await documentoVisible(s, a, Number(f.documento_id));
    const enCurso = revisiones.find((r) => ESTADOS_TRABAJO.includes(r.estado));
    if (enCurso) throw new HttpError(409, { message: `Ya hay una revisión en curso (revisión ${enCurso.numero}); solo puede haber una a la vez`, codigo: "revision_en_curso" });
  }
  const resp = responsablesCompletos(raw);
  await validarResponsables(s, resp);
  const fechaLimite = fechaLimiteDe(raw);
  const cargo = cargoDe(request, a, "documento_crear_ficha");
  const en = ahora();
  let docId: number;
  let numero: number;
  let referencia: string;
  let clave: string | null = null;
  if (f.tipo === "nuevo") {
    const d = await validarFicha(s, datosFicha({ ...raw, area_codigo: raw.area_codigo ?? f.area_codigo, tipo_codigo: raw.tipo_codigo ?? f.tipo_codigo, titulo: raw.titulo ?? f.titulo_propuesto }), 0, a);
    numero = raw.numero === undefined || raw.numero === "" ? 1 : Number(raw.numero);
    if (!Number.isInteger(numero) || numero < 0 || numero > 999) throw new HttpError(400, { message: "La revisión inicial debe ser un número entero (0 a 999)", campo: "numero" });
    const r = await s.execute(
      `INSERT INTO sgc_documentos (clave, titulo, area_codigo, tipo_codigo, origen, proceso, confidencialidad, palabras_clave, propietario_id, estado, creado_por, creado_en, actualizado_por, actualizado_en)
       VALUES (:clave, :titulo, :area_codigo, :tipo_codigo, :origen, :proceso, :confidencialidad, :palabras, :propietario_id, 'en_elaboracion', :por, :en, :por, :en)`,
      { ...d, palabras: JSON.stringify(d.palabras_clave), por: a.yo, en },
    );
    docId = Number(r.lastrowid);
    referencia = d.clave;
    clave = d.clave;
    await registrarAuditoria(s, user, { accion: "crear", entidad: ENTIDAD, entidadId: docId, referencia: d.clave, despues: fichaVisible(d), detalle: { revision: numero, estado: "borrador", solicitud_id: Number(f.id), ...resp } });
  } else {
    docId = Number(f.documento_id);
    const { doc, revisiones } = await documentoVisible(s, a, docId);
    if (doc.estado === "obsoleto") throw new HttpError(409, { message: "El documento está obsoleto; no se le abren revisiones" });
    if (doc.origen === "externo") throw new HttpError(409, { message: "Los documentos externos no pasan por el flujo: se verifica su vigencia o se registra su nueva versión", codigo: "externo" });
    const enCurso = revisiones.find((r) => ESTADOS_TRABAJO.includes(r.estado));
    if (enCurso) throw new HttpError(409, { message: `Ya hay una revisión en curso (revisión ${enCurso.numero}); solo puede haber una a la vez`, codigo: "revision_en_curso" });
    if (await s.queryOne<Row>("SELECT id FROM sgc_renovaciones WHERE documento_id = :id AND estado IN ('en_revision', 'en_autorizacion')", { id: docId })) throw new HttpError(409, { message: "Hay una renovación de vigencia en curso; termínala antes de abrir una revisión", codigo: "renovacion_en_curso" });
    await exigirSinSolicitudPendiente(s, ENTIDAD, docId, referenciaDe(doc), "abrir una revisión");
    numero = Math.max(0, ...revisiones.map((r) => Number(r.numero))) + 1;
    referencia = referenciaDe(doc);
  }
  const motivo = textoLargo(raw.motivo_cambio) || (f.tipo === "nuevo" ? "Emisión inicial" : String(f.justificacion));
  const rv = await s.execute(
    `INSERT INTO sgc_revisiones (documento_id, numero, estado, motivo_cambio, apartados_afectados, descripcion_cambio, elaborador_id, revisor_id, autorizador_id, fecha_limite, solicitud_id, origen_registro, creado_por, creado_en)
     VALUES (:doc, :numero, 'borrador', :motivo, :apartados, :descripcion, :elaborador_id, :revisor_id, :autorizador_id, :limite, :sol, 'flujo', :por, :en)`,
    { doc: docId, numero, motivo, apartados: textoLargo(raw.apartados_afectados), descripcion: textoLargo(raw.descripcion_cambio), ...resp, limite: fechaLimite, sol: f.id, por: a.yo, en },
  );
  const revId = Number(rv.lastrowid);
  const r = await s.execute("UPDATE sgc_solicitudes SET estado = 'aceptada', resuelta_por = :por, resuelta_en = :en, comentario_resolucion = :c, revision_id = :rev, documento_id = :doc, clave_asignada = :clave WHERE id = :id AND estado = 'pendiente'", { por: a.yo, en, c: textoLargo(raw.comentario, 2000), rev: revId, doc: docId, clave, id: f.id });
  if (!r.rowcount) throw new HttpError(409, { message: `La solicitud #${f.id} ya fue atendida por otra persona` });
  await s.execute("UPDATE sgc_documentos SET actualizado_por = :por, actualizado_en = :en WHERE id = :id", { por: a.yo, en, id: docId });
  await registrarFlujo(s, { revision_id: revId, accion: "solicitar", comentario: String(f.justificacion), usuario_id: Number(f.solicitante_id) || null, papel: "solicitante", fecha: String(f.creado_en) });
  await registrarFlujo(s, { revision_id: revId, accion: "aceptar_solicitud", comentario: textoLargo(raw.comentario, 2000), usuario_id: a.yo, cargo, papel: "publicador", fecha: en });
  await registrarAuditoria(s, user, { accion: "nueva_revision", entidad: ENTIDAD, entidadId: docId, referencia, motivo, detalle: { solicitud_id: Number(f.id), tipo_solicitud: f.tipo, revision: numero, revision_id: revId, estado: "borrador", ...resp, fecha_limite: fechaLimite, ...(cargo ? { actuo_como: { cargo } } : {}) } });
  await registrarAuditoria(s, user, { accion: "aceptar", entidad: "sgc_solicitudes", entidadId: Number(f.id), referencia: refSolicitud(Number(f.id)), detalle: { documento_id: docId, revision_id: revId, tipo: f.tipo, clave } });
  return { message: f.tipo === "nuevo" ? `Solicitud aceptada: ficha ${clave} creada con la revisión ${numero} en borrador` : `Solicitud aceptada: revisión ${numero} abierta en borrador; la vigente sigue en uso`, documento_id: docId, revision_id: revId, numero };
}

export async function rechazarSolicitudSgc({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  exigir(a, "documento_crear_ficha", "Solo Mejora Continua atiende las solicitudes (documento_crear_ficha)");
  const f = await solicitudDe(s, a, intParam(params.sid));
  if (f.estado !== "pendiente") throw new HttpError(409, { message: `La solicitud #${f.id} ya está ${f.estado}` });
  const motivo = String((await readJson(request)).motivo || "").trim();
  if (motivo.length < MOTIVO_MIN_SGC) throw new HttpError(400, { message: `Indica el motivo del rechazo (al menos ${MOTIVO_MIN_SGC} caracteres)`, campo: "motivo" });
  const r = await s.execute("UPDATE sgc_solicitudes SET estado = 'rechazada', resuelta_por = :por, resuelta_en = :en, comentario_resolucion = :m WHERE id = :id AND estado = 'pendiente'", { por: a.yo, en: ahora(), m: motivo, id: f.id });
  if (!r.rowcount) throw new HttpError(409, { message: `La solicitud #${f.id} ya fue atendida por otra persona` });
  await registrarAuditoria(s, user, { accion: "rechazar", entidad: "sgc_solicitudes", entidadId: Number(f.id), referencia: refSolicitud(Number(f.id)), motivo, detalle: { tipo: f.tipo, documento_id: f.documento_id ?? null, solicitante_id: f.solicitante_id } });
  await s.commit();
  return json({ message: `Solicitud #${f.id} rechazada` });
}

/*
 * "Nueva revision" directa de Mejora Continua (y la ficha con archivo inicial):
 * se registra como una solicitud propia aceptada en el mismo paso.
 */
export async function solicitudPropiaAceptada(s: Session, user: CurrentUser, a: AccesoSgc, request: Request, documentoId: number, raw: Record<string, unknown>) {
  const { doc } = await documentoVisible(s, a, documentoId);
  if (doc.origen === "externo") throw new HttpError(409, { message: "Los documentos externos no pasan por el flujo: se verifica su vigencia o se registra su nueva versión", codigo: "externo" });
  const justificacion = String(raw.motivo_cambio || raw.justificacion || "").trim();
  if (justificacion.length < MOTIVO_MIN_SGC) throw new HttpError(400, { message: `Describe el motivo del cambio (al menos ${MOTIVO_MIN_SGC} caracteres)`, campo: "motivo_cambio" });
  const r = await s.execute(
    "INSERT INTO sgc_solicitudes (tipo, documento_id, area_codigo, tipo_codigo, titulo_propuesto, justificacion, solicitante_id, estado, creado_en) VALUES ('cambio', :doc, :area, :tipo, :titulo, :just, :yo, 'pendiente', :en)",
    { doc: documentoId, area: doc.area_codigo, tipo: doc.tipo_codigo, titulo: doc.titulo, just: justificacion, yo: a.yo, en: ahora() },
  );
  const f = (await s.queryOne<Row>("SELECT * FROM sgc_solicitudes WHERE id = :id", { id: Number(r.lastrowid) }))!;
  await registrarAuditoria(s, user, { accion: "proponer", entidad: ENTIDAD, entidadId: documentoId, referencia: referenciaDe(doc), motivo: justificacion, detalle: { solicitud_id: Number(f.id), tipo: "cambio", aceptada_en_el_mismo_paso: true } });
  return aceptarInterna(s, user, a, request, f, { ...raw, motivo_cambio: justificacion });
}

/* Registro de la solicitud de una ficha creada directamente con archivo inicial (Mejora Continua). */
export async function registrarSolicitudDeFicha(s: Session, a: AccesoSgc, doc: { id: number; area_codigo: string; tipo_codigo: string; titulo: string; clave: string }, revisionId: number): Promise<void> {
  const en = ahora();
  const r = await s.execute(
    `INSERT INTO sgc_solicitudes (tipo, documento_id, area_codigo, tipo_codigo, titulo_propuesto, justificacion, solicitante_id, estado, resuelta_por, resuelta_en, comentario_resolucion, revision_id, clave_asignada, creado_en)
     VALUES ('nuevo', :doc, :area, :tipo, :titulo, :just, :yo, 'aceptada', :yo, :en, :c, :rev, :clave, :en)`,
    { doc: doc.id, area: doc.area_codigo, tipo: doc.tipo_codigo, titulo: doc.titulo, just: "Alta de la ficha por Mejora Continua", yo: a.yo, en, c: "Creada y aceptada en el mismo paso", rev: revisionId, clave: doc.clave },
  );
  await s.execute("UPDATE sgc_revisiones SET solicitud_id = :sol WHERE id = :id", { sol: Number(r.lastrowid), id: revisionId });
  await registrarFlujo(s, { revision_id: revisionId, accion: "aceptar_solicitud", comentario: "Ficha creada por Mejora Continua", usuario_id: a.yo, papel: "publicador", fecha: en });
}

/* ---------- Transiciones de una revision ---------- */

async function cancelarRevision(s: Session, rev: Row, por: number): Promise<void> {
  await s.execute("UPDATE sgc_revisiones SET estado = 'cancelada', cancelada_en = :en, cancelada_por = :por, actualizado_por = :por, actualizado_en = :en WHERE id = :id", { en: ahora(), por, id: rev.id });
}

export async function revisarRevision({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const { doc, rev } = await revisionVisible(s, a, intParam(params.rid));
  exigirPapel(a, rev, "revisor", "documento_revisar");
  exigirEstado(rev, ["en_revision"], "en revisión");
  await exigirSinOtroPapel(s, Number(rev.id), a.yo, "revisor");
  const raw = await readJson(request);
  const decision = String(raw.decision || "");
  if (!["aceptar", "devolver", "rechazar"].includes(decision)) throw new HttpError(400, { message: "Elige aceptar, devolver con comentarios o rechazar", campo: "decision" });
  const comentario = decision === "aceptar" ? textoLargo(raw.comentario, 2000) : comentarioObligatorio(raw, decision === "devolver" ? "para el elaborador" : "del rechazo");
  const cargo = cargoDe(request, a, "documento_revisar");
  const en = ahora();
  const nuevo = decision === "aceptar" ? "en_autorizacion" : decision === "devolver" ? "borrador" : "cancelada";
  if (decision === "rechazar") await cancelarRevision(s, rev, a.yo);
  else {
    const r = await s.execute(`UPDATE sgc_revisiones SET estado = :nuevo, ${decision === "aceptar" ? "revisada_en = :en, revisada_por = :por," : ""} actualizado_por = :por, actualizado_en = :en WHERE id = :id AND estado = 'en_revision'`, { nuevo, en, por: a.yo, id: rev.id });
    if (!r.rowcount) throw new HttpError(409, { message: "Otra persona cambió la revisión al mismo tiempo; recarga la página" });
  }
  await registrarFlujo(s, { revision_id: Number(rev.id), accion: `revisar_${decision}`, decision, comentario, usuario_id: a.yo, cargo, papel: "revisor", fecha: en });
  await registrarAuditoria(s, user, { accion: decision === "aceptar" ? "revisar" : decision === "devolver" ? "devolver" : "rechazar", entidad: ENTIDAD, entidadId: Number(doc.id), referencia: `${referenciaDe(doc)} rev. ${rev.numero}`, motivo: comentario, antes: { estado: "en_revision" }, despues: { estado: nuevo }, detalle: { revision: Number(rev.numero), revision_id: Number(rev.id), papel: "revisor", decision, ...(cargo ? { actuo_como: { cargo } } : {}) } });
  await s.commit();
  const msg = { aceptar: "Revisión aceptada: pasa a autorización", devolver: "Devuelta al elaborador con tus comentarios", rechazar: "Revisión rechazada; la vigente sigue en uso" }[decision as "aceptar"];
  return json({ message: msg, estado: nuevo });
}

export async function autorizarRevision({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const { doc, rev } = await revisionVisible(s, a, intParam(params.rid));
  exigirPapel(a, rev, "autorizador", "documento_autorizar");
  exigirEstado(rev, ["en_autorizacion"], "en autorización");
  await exigirSinOtroPapel(s, Number(rev.id), a.yo, "autorizador");
  const raw = await readJson(request);
  const decision = String(raw.decision || "");
  if (!["autorizar", "devolver", "rechazar"].includes(decision)) throw new HttpError(400, { message: "Elige autorizar, devolver con comentarios o rechazar", campo: "decision" });
  const comentario = decision === "autorizar" ? textoLargo(raw.comentario, 2000) : comentarioObligatorio(raw, decision === "devolver" ? "para el elaborador" : "del rechazo");
  if (decision === "autorizar") await exigirReauth(s, request, user, "documentos:autorizar");
  const cargo = cargoDe(request, a, "documento_autorizar");
  const en = ahora();
  const nuevo = decision === "autorizar" ? "autorizada" : decision === "devolver" ? "borrador" : "cancelada";
  if (decision === "rechazar") await cancelarRevision(s, rev, a.yo);
  else {
    const r = await s.execute(`UPDATE sgc_revisiones SET estado = :nuevo, ${decision === "autorizar" ? "autorizada_en = :en, autorizada_por = :por," : ""} actualizado_por = :por, actualizado_en = :en WHERE id = :id AND estado = 'en_autorizacion'`, { nuevo, en, por: a.yo, id: rev.id });
    if (!r.rowcount) throw new HttpError(409, { message: "Otra persona cambió la revisión al mismo tiempo; recarga la página" });
  }
  await registrarFlujo(s, { revision_id: Number(rev.id), accion: decision === "autorizar" ? "autorizar" : `autorizar_${decision}`, decision, comentario, usuario_id: a.yo, cargo, papel: "autorizador", fecha: en });
  await registrarAuditoria(s, user, { accion: decision === "autorizar" ? "autorizar" : decision === "devolver" ? "devolver" : "rechazar", entidad: ENTIDAD, entidadId: Number(doc.id), referencia: `${referenciaDe(doc)} rev. ${rev.numero}`, motivo: comentario, antes: { estado: "en_autorizacion" }, despues: { estado: nuevo }, detalle: { revision: Number(rev.numero), revision_id: Number(rev.id), papel: "autorizador", decision, ...(cargo ? { actuo_como: { cargo } } : {}) } });
  await s.commit();
  const msg = { autorizar: "Revisión autorizada: Mejora Continua la publicará", devolver: "Devuelta al elaborador con tus comentarios", rechazar: "Revisión rechazada; la vigente sigue en uso" }[decision as "autorizar"];
  return json({ message: msg, estado: nuevo });
}

/*
 * Publicar: en UNA transaccion la autorizada queda vigente y la anterior
 * obsoleta (fecha de obsolescencia y "sustituida por"). Dos publicaciones a la
 * vez: la segunda ya no encuentra la revision "autorizada" (409) y el indice
 * unico de vigentes impide dos vigentes del mismo documento.
 */
export async function publicarRevision({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const { doc, rev, revisiones, archivos } = await revisionVisible(s, a, intParam(params.rid));
  exigir(a, "documento_publicar", "Solo Mejora Continua publica (documento_publicar)");
  exigirEstado(rev, ["autorizada"], "autorizada");
  if (!archivos.some((f) => f.tipo === "pdf" && !f.reemplazado_en)) throw new HttpError(409, { message: "La revisión no tiene PDF de consulta" });
  if (!rev.elaborador_id || !rev.revisor_id || !rev.autorizador_id || !rev.revisada_en || !rev.autorizada_en) throw new HttpError(409, { message: "No se puede publicar sin elaborador, revisión y autorización completas" });
  const raw = await readJson(request);
  const emision = fechaONull(raw.fecha_emision, "fecha_emision") || hoy();
  const vigencia = fechaONull(raw.fecha_vigencia, "fecha_vigencia") || emision;
  if (vigencia < emision) throw new HttpError(400, { message: "La vigencia no puede empezar antes de la emisión", campo: "fecha_vigencia" });
  const proxima = fechaONull(raw.fecha_proxima_revision, "fecha_proxima_revision") || sumarAnios(emision, ANIOS_PROXIMA_REVISION);
  if (proxima <= vigencia) throw new HttpError(400, { message: "La próxima revisión debe ser posterior a la fecha de vigencia", campo: "fecha_proxima_revision" });
  // Distribucion (Fase 3): la que se indique al publicar; si no se indica, se conserva la de la revision anterior.
  const distribucion = datosDistribucion(raw.distribucion);
  if (distribucion && !tiene(a, "documento_administrar_lecturas")) throw new HttpError(403, { message: "Solo quien administra lecturas define la distribución (documento_administrar_lecturas)", codigo: "sin_permiso" });
  await exigirReauth(s, request, user, "documentos:publicar");
  const cargo = cargoDe(request, a, "documento_publicar");
  const en = ahora();
  const anterior = revisiones.find((r) => r.estado === "vigente" && Number(r.id) !== Number(rev.id));
  if (anterior) {
    const o = await s.execute("UPDATE sgc_revisiones SET estado = 'obsoleta', fecha_obsolescencia = :en, sustituida_por_id = :nueva, actualizado_por = :por, actualizado_en = :en WHERE id = :id AND estado = 'vigente'", { en, nueva: rev.id, por: a.yo, id: anterior.id });
    if (!o.rowcount) throw new HttpError(409, { message: "Otra persona publicó al mismo tiempo; recarga la página", codigo: "conflicto_publicacion" });
  }
  const r = await s.execute(
    `UPDATE sgc_revisiones SET estado = 'vigente', fecha_emision = :emision, fecha_vigencia = :vigencia, fecha_proxima_revision = :proxima, publicada_en = :en, publicada_por = :por, actualizado_por = :por, actualizado_en = :en
     WHERE id = :id AND estado = 'autorizada'`,
    { emision, vigencia, proxima, en, por: a.yo, id: rev.id },
  );
  if (!r.rowcount) throw new HttpError(409, { message: "La revisión ya se publicó o cambió al mismo tiempo; recarga la página", codigo: "conflicto_publicacion" });
  await s.execute("UPDATE sgc_documentos SET estado = 'vigente', revision_vigente_id = :rev, actualizado_por = :por, actualizado_en = :en WHERE id = :id", { rev: rev.id, por: a.yo, en, id: doc.id });
  const comentario = textoLargo(raw.comentario, 2000);
  const distribuidos = distribucion ? await guardarDistribucion(s, Number(rev.id), distribucion, a.yo, "Distribución definida al publicar") : anterior ? await copiarDistribucion(s, Number(anterior.id), Number(rev.id), a.yo) : 0;
  await registrarFlujo(s, { revision_id: Number(rev.id), accion: "publicar", comentario, usuario_id: a.yo, cargo, papel: "publicador", fecha: en });
  if (anterior) await registrarFlujo(s, { revision_id: Number(anterior.id), accion: "obsoleta", comentario: `Sustituida por la revisión ${rev.numero}`, usuario_id: a.yo, cargo, papel: "publicador", fecha: en });
  await registrarAuditoria(s, user, {
    accion: "publicar",
    entidad: ENTIDAD,
    entidadId: Number(doc.id),
    referencia: `${referenciaDe(doc)} rev. ${rev.numero}`,
    motivo: comentario,
    antes: { estado: "autorizada", vigente_anterior: anterior ? Number(anterior.numero) : null },
    despues: { estado: "vigente", fecha_emision: emision, fecha_vigencia: vigencia, fecha_proxima_revision: proxima },
    detalle: { revision: Number(rev.numero), revision_id: Number(rev.id), sustituye: anterior ? { revision: Number(anterior.numero), revision_id: Number(anterior.id) } : null, distribucion: distribucion ? { ...distribucion, origen: "al_publicar" } : distribuidos ? { origen: "revision_anterior", filas: distribuidos } : null, ...(cargo ? { actuo_como: { cargo } } : {}) },
  });
  await s.commit();
  return json({ message: anterior ? `Revisión ${rev.numero} publicada; la ${anterior.numero} queda obsoleta` : `Revisión ${rev.numero} publicada`, estado: "vigente" });
}

export async function reasignarRevision({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const { doc, rev } = await revisionVisible(s, a, intParam(params.rid));
  exigir(a, "documento_crear_ficha", "Solo Mejora Continua reasigna responsables (documento_crear_ficha)");
  exigirEstado(rev, ["borrador", "en_revision", "en_autorizacion"], "en el flujo antes de autorizarse");
  const raw = await readJson(request);
  const motivo = String(raw.motivo || "").trim();
  if (motivo.length < MOTIVO_MIN_SGC) throw new HttpError(400, { message: `Indica el motivo de la reasignación (al menos ${MOTIVO_MIN_SGC} caracteres)`, campo: "motivo" });
  const nuevo: Responsables = {
    elaborador_id: raw.elaborador_id === undefined ? (rev.elaborador_id ?? null) : idONull(raw.elaborador_id),
    revisor_id: raw.revisor_id === undefined ? (rev.revisor_id ?? null) : idONull(raw.revisor_id),
    autorizador_id: raw.autorizador_id === undefined ? (rev.autorizador_id ?? null) : idONull(raw.autorizador_id),
  };
  for (const [campo, papel] of [["elaborador_id", "elaborador"], ["revisor_id", "revisor"], ["autorizador_id", "autorizador"]] as const) if (!nuevo[campo]) throw new HttpError(400, { message: `Asigna al ${papel}`, campo: papel });
  await validarResponsables(s, nuevo);
  for (const papel of ["elaborador", "revisor", "autorizador"] as const) await exigirSinOtroPapel(s, Number(rev.id), Number(nuevo[`${papel}_id`]), papel, 400);
  const limite = raw.fecha_limite === undefined ? (rev.fecha_limite ?? null) : fechaLimiteDe(raw);
  const antes = { elaborador_id: rev.elaborador_id ?? null, revisor_id: rev.revisor_id ?? null, autorizador_id: rev.autorizador_id ?? null, fecha_limite: rev.fecha_limite ?? null };
  const despues = { ...nuevo, fecha_limite: limite };
  if (JSON.stringify(antes) === JSON.stringify(despues)) throw new HttpError(400, { message: "No cambiaste a ningún responsable ni la fecha límite" });
  await s.execute("UPDATE sgc_revisiones SET elaborador_id = :elaborador_id, revisor_id = :revisor_id, autorizador_id = :autorizador_id, fecha_limite = :limite, actualizado_por = :por, actualizado_en = :en WHERE id = :id", { ...nuevo, limite, por: a.yo, en: ahora(), id: rev.id });
  const cargo = cargoDe(request, a, "documento_crear_ficha");
  await registrarFlujo(s, { revision_id: Number(rev.id), accion: "reasignar", comentario: motivo, usuario_id: a.yo, cargo, papel: "publicador" });
  await registrarAuditoria(s, user, { accion: "reasignar", entidad: ENTIDAD, entidadId: Number(doc.id), referencia: `${referenciaDe(doc)} rev. ${rev.numero}`, motivo, antes, despues, detalle: { revision: Number(rev.numero), revision_id: Number(rev.id) } });
  await s.commit();
  return json({ message: "Responsables reasignados" });
}

/* ---------- Renovacion sin cambios ---------- */

export async function iniciarRenovacion({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const { doc, revisiones } = await documentoVisible(s, a, intParam(params.id));
  exigir(a, "documento_crear_ficha", "Solo Mejora Continua inicia una renovación (documento_crear_ficha)");
  const vigente = revisiones.find((r) => r.estado === "vigente");
  if (doc.origen === "externo") throw new HttpError(409, { message: "Los documentos externos no pasan por el flujo: se verifica su vigencia o se registra su nueva versión", codigo: "externo" });
  if (!vigente || doc.estado !== "vigente") throw new HttpError(409, { message: "Solo se renueva un documento vigente" });
  if (!pendienteDeRevision(vigente.fecha_proxima_revision, hoy())) throw new HttpError(409, { message: "El documento todavía no está pendiente de revisión (faltan más de 30 días para su próxima revisión)", codigo: "no_pendiente" });
  if (revisiones.some((r) => ESTADOS_TRABAJO.includes(r.estado))) throw new HttpError(409, { message: "Hay una revisión en curso; termínala antes de renovar", codigo: "revision_en_curso" });
  if (await s.queryOne<Row>("SELECT id FROM sgc_renovaciones WHERE documento_id = :id AND estado IN ('en_revision', 'en_autorizacion')", { id: doc.id })) throw new HttpError(409, { message: "Ya hay una renovación en curso", codigo: "renovacion_en_curso" });
  await exigirSinSolicitudPendiente(s, ENTIDAD, Number(doc.id), referenciaDe(doc), "renovarlo");
  const raw = await readJson(request);
  const revisor = idONull(raw.revisor_id);
  const autorizador = idONull(raw.autorizador_id);
  if (!revisor) throw new HttpError(400, { message: "Asigna al revisor", campo: "revisor" });
  if (!autorizador) throw new HttpError(400, { message: "Asigna al autorizador", campo: "autorizador" });
  await validarResponsables(s, { elaborador_id: null, revisor_id: revisor, autorizador_id: autorizador });
  const proxima = fechaONull(raw.fecha_proxima_revision, "fecha_proxima_revision") || sumarAnios(hoy(), ANIOS_PROXIMA_REVISION);
  if (proxima <= hoy()) throw new HttpError(400, { message: "La nueva próxima revisión debe ser posterior a hoy", campo: "fecha_proxima_revision" });
  const limite = fechaLimiteDe(raw);
  const en = ahora();
  const r = await s.execute(
    `INSERT INTO sgc_renovaciones (documento_id, revision_id, estado, revisor_id, autorizador_id, fecha_proxima_anterior, fecha_proxima_nueva, fecha_limite, solicitado_por, creado_en)
     VALUES (:doc, :rev, 'en_revision', :revisor, :autorizador, :anterior, :nueva, :limite, :por, :en)`,
    { doc: doc.id, rev: vigente.id, revisor, autorizador, anterior: vigente.fecha_proxima_revision ?? null, nueva: proxima, limite, por: a.yo, en },
  );
  const nid = Number(r.lastrowid);
  const cargo = cargoDe(request, a, "documento_crear_ficha");
  await registrarFlujo(s, { revision_id: Number(vigente.id), accion: "renovacion_iniciar", comentario: textoLargo(raw.comentario, 2000), usuario_id: a.yo, cargo, papel: "publicador", renovacion_id: nid, fecha: en });
  await registrarAuditoria(s, user, { accion: "crear", entidad: ENTIDAD, entidadId: Number(doc.id), referencia: `${referenciaDe(doc)} rev. ${vigente.numero}`, motivo: textoLargo(raw.comentario, 2000), detalle: { renovacion: true, renovacion_id: nid, revision: Number(vigente.numero), revisor_id: revisor, autorizador_id: autorizador, fecha_proxima_nueva: proxima } });
  await s.commit();
  return json({ message: "Renovación iniciada: el revisor confirmará la vigencia", id: nid }, 201);
}

async function renovacionDe(s: Session, a: AccesoSgc, nid: number): Promise<{ ren: Row; doc: Row; vigente: Row }> {
  const ren = Number.isInteger(nid) && nid > 0 ? await s.queryOne<Row>("SELECT * FROM sgc_renovaciones WHERE id = :id", { id: nid }) : null;
  if (!ren) throw new HttpError(404, { message: "Renovación no encontrada" });
  const { doc, revisiones } = await documentoVisible(s, a, Number(ren.documento_id));
  const vigente = revisiones.find((r) => Number(r.id) === Number(ren.revision_id));
  if (!vigente) throw new HttpError(404, { message: "Renovación no encontrada" });
  return { ren, doc, vigente };
}

export async function revisarRenovacion({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const { ren, doc, vigente } = await renovacionDe(s, a, intParam(params.nid));
  if (!tiene(a, "documento_revisar")) throw new HttpError(403, { message: "No tienes permiso para revisar (documento_revisar)", codigo: "sin_permiso" });
  const v = evaluarPapelDocumento(a.yo, ren.revisor_id as number, "revisor");
  if (v) throw new HttpError(403, { message: v.mensaje, codigo: "segregacion", regla: v.regla, clave: v.clave });
  if (ren.estado !== "en_revision") throw new HttpError(409, { message: "La renovación no está esperando la confirmación del revisor" });
  const raw = await readJson(request);
  const decision = String(raw.decision || "");
  if (!["confirmar", "rechazar"].includes(decision)) throw new HttpError(400, { message: "Elige confirmar la vigencia o rechazar la renovación", campo: "decision" });
  const comentario = comentarioObligatorio(raw, decision === "confirmar" ? "de la confirmación de vigencia" : "del rechazo");
  const en = ahora();
  const nuevo = decision === "confirmar" ? "en_autorizacion" : "cancelada";
  const r = await s.execute(`UPDATE sgc_renovaciones SET estado = :nuevo, ${decision === "confirmar" ? "revisada_en = :en" : "cancelada_en = :en, cancelada_por = :por"} WHERE id = :id AND estado = 'en_revision'`, { nuevo, en, por: a.yo, id: ren.id });
  if (!r.rowcount) throw new HttpError(409, { message: "Otra persona cambió la renovación al mismo tiempo; recarga la página" });
  const cargo = cargoDe(request, a, "documento_revisar");
  await registrarFlujo(s, { revision_id: Number(vigente.id), accion: decision === "confirmar" ? "renovacion_confirmar" : "renovacion_rechazar", decision, comentario, usuario_id: a.yo, cargo, papel: "revisor", renovacion_id: Number(ren.id), fecha: en });
  await registrarAuditoria(s, user, { accion: decision === "confirmar" ? "revisar" : "rechazar", entidad: ENTIDAD, entidadId: Number(doc.id), referencia: `${referenciaDe(doc)} rev. ${vigente.numero}`, motivo: comentario, detalle: { renovacion: true, renovacion_id: Number(ren.id), decision, papel: "revisor" } });
  await s.commit();
  return json({ message: decision === "confirmar" ? "Vigencia confirmada: pasa a autorización" : "Renovación rechazada" });
}

export async function autorizarRenovacion({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const { ren, doc, vigente } = await renovacionDe(s, a, intParam(params.nid));
  if (!tiene(a, "documento_autorizar")) throw new HttpError(403, { message: "No tienes permiso para autorizar (documento_autorizar)", codigo: "sin_permiso" });
  const v = evaluarPapelDocumento(a.yo, ren.autorizador_id as number, "autorizador");
  if (v) throw new HttpError(403, { message: v.mensaje, codigo: "segregacion", regla: v.regla, clave: v.clave });
  if (ren.estado !== "en_autorizacion") throw new HttpError(409, { message: "La renovación no está esperando la autorización" });
  const raw = await readJson(request);
  const decision = String(raw.decision || "");
  if (!["autorizar", "rechazar"].includes(decision)) throw new HttpError(400, { message: "Elige autorizar o rechazar la renovación", campo: "decision" });
  const comentario = decision === "autorizar" ? textoLargo(raw.comentario, 2000) : comentarioObligatorio(raw, "del rechazo");
  if (decision === "autorizar") await exigirReauth(s, request, user, "documentos:autorizar");
  const en = ahora();
  const cargo = cargoDe(request, a, "documento_autorizar");
  if (decision === "autorizar") {
    const r = await s.execute("UPDATE sgc_renovaciones SET estado = 'completada', autorizada_en = :en WHERE id = :id AND estado = 'en_autorizacion'", { en, id: ren.id });
    if (!r.rowcount) throw new HttpError(409, { message: "Otra persona cambió la renovación al mismo tiempo; recarga la página" });
    // La MISMA revision sigue vigente, con nueva fecha de proxima revision.
    const u = await s.execute("UPDATE sgc_revisiones SET fecha_proxima_revision = :nueva, renovada_en = :en, actualizado_por = :por, actualizado_en = :en WHERE id = :id AND estado = 'vigente'", { nueva: ren.fecha_proxima_nueva, en, por: a.yo, id: vigente.id });
    if (!u.rowcount) throw new HttpError(409, { message: "La revisión ya no está vigente" });
  } else {
    await s.execute("UPDATE sgc_renovaciones SET estado = 'cancelada', cancelada_en = :en, cancelada_por = :por WHERE id = :id AND estado = 'en_autorizacion'", { en, por: a.yo, id: ren.id });
  }
  await registrarFlujo(s, { revision_id: Number(vigente.id), accion: decision === "autorizar" ? "renovacion_autorizar" : "renovacion_rechazar", decision, comentario, usuario_id: a.yo, cargo, papel: "autorizador", renovacion_id: Number(ren.id), fecha: en });
  await registrarAuditoria(s, user, {
    accion: decision === "autorizar" ? "autorizar" : "rechazar",
    entidad: ENTIDAD,
    entidadId: Number(doc.id),
    referencia: `${referenciaDe(doc)} rev. ${vigente.numero}`,
    motivo: comentario,
    antes: decision === "autorizar" ? { fecha_proxima_revision: ren.fecha_proxima_anterior ?? null } : null,
    despues: decision === "autorizar" ? { fecha_proxima_revision: ren.fecha_proxima_nueva } : null,
    detalle: { renovacion: true, renovacion_id: Number(ren.id), decision, papel: "autorizador", ...(cargo ? { actuo_como: { cargo } } : {}) },
  });
  await s.commit();
  return json({ message: decision === "autorizar" ? `Renovado: la revisión ${vigente.numero} sigue vigente hasta su próxima revisión (${ren.fecha_proxima_nueva})` : "Renovación rechazada" });
}

/* ---------- Obsolescencia sin reemplazo (segundo usuario) ---------- */

export async function solicitarObsolescencia({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const { doc } = await documentoVisible(s, a, intParam(params.id));
  exigir(a, "documento_obsoletar", "Solo Mejora Continua declara documentos obsoletos (documento_obsoletar)");
  if (doc.estado === "obsoleto") throw new HttpError(409, { message: "El documento ya está obsoleto" });
  const motivo = String((await readJson(request)).motivo || "").trim();
  if (motivo.length < MOTIVO_MIN_SGC) throw new HttpError(400, { message: `Indica el motivo (al menos ${MOTIVO_MIN_SGC} caracteres)`, campo: "motivo" });
  await exigirReauth(s, request, user, "documentos:obsoletar");
  const cargo = cargoDe(request, a, "documento_obsoletar");
  const solicitud = await crearSolicitud(s, user, { tipo: "obsoletar_documento_sgc", entidad: ENTIDAD, entidadId: Number(doc.id), referencia: referenciaDe(doc), accion: "obsoletar", motivo, cargo });
  await s.commit();
  return respuestaSolicitud(solicitud, `declarar obsoleto ${referenciaDe(doc)}`);
}

/* Ejecutor de la solicitud aprobada: obsoleto, fuera de los puntos de uso y conservado en el historial. */
export async function ejecutarObsolescencia(ctx: ContextoEjecucion): Promise<Record<string, unknown>> {
  const { s, user } = ctx;
  const a = await accesoSgc(s, await cargarAutorizacion(s, user));
  const { doc, revisiones } = await documentoVisible(s, a, Number(ctx.solicitud.entidad_id));
  if (doc.estado === "obsoleto") throw new HttpError(409, { message: "El documento ya está obsoleto" });
  const en = ahora();
  const yo = a.yo;
  for (const r of revisiones) {
    if (r.estado === "vigente") {
      await s.execute("UPDATE sgc_revisiones SET estado = 'obsoleta', fecha_obsolescencia = :en, actualizado_por = :por, actualizado_en = :en WHERE id = :id", { en, por: yo, id: r.id });
      await registrarFlujo(s, { revision_id: Number(r.id), accion: "obsoletar", comentario: ctx.solicitud.motivo, usuario_id: Number(ctx.solicitud.solicitado_por), cargo: ctx.solicitud.solicitado_rol, papel: "publicador", fecha: en });
    } else if (ESTADOS_TRABAJO.includes(r.estado)) await cancelarRevision(s, r, yo);
  }
  await s.execute("UPDATE sgc_renovaciones SET estado = 'cancelada', cancelada_en = :en, cancelada_por = :por WHERE documento_id = :id AND estado IN ('en_revision', 'en_autorizacion')", { en, por: yo, id: doc.id });
  await s.execute("UPDATE sgc_documentos SET estado = 'obsoleto', obsoleto_en = :en, obsoleto_por = :solicitante, motivo_obsolescencia = :motivo, actualizado_por = :por, actualizado_en = :en WHERE id = :id", { en, solicitante: ctx.solicitud.solicitado_por, motivo: ctx.solicitud.motivo, por: yo, id: doc.id });
  await registrarAuditoria(s, user, { accion: "anular", entidad: ENTIDAD, entidadId: Number(doc.id), referencia: referenciaDe(doc), motivo: ctx.solicitud.motivo, antes: { estado: doc.estado }, despues: { estado: "obsoleto" }, detalle: { obsoletar: true, solicitud_id: ctx.solicitud.id, solicitado_por: ctx.solicitud.solicitado_por, actuo_como: ctx.actuo } });
  return { documento_id: Number(doc.id), estado: "obsoleto", referencia: referenciaDe(doc) };
}

/* ---------- Bandeja de tareas ---------- */

export interface Tarea {
  clave: string;
  tipo: "solicitud" | "elaborar" | "corregir" | "revisar" | "autorizar" | "publicar" | "renovacion_revisar" | "renovacion_autorizar" | "pendiente_revision" | "obsolescencia" | "lectura";
  accion: string;
  papel: string;
  documento_id: number | null;
  clave_documento: string | null;
  titulo: string;
  revision: number | null;
  fecha_limite: string | null;
  vencida: boolean;
  desde: string | null;
  href: string;
}

export async function tareasSgc(s: Session, a: AccesoSgc): Promise<Tarea[]> {
  const hoyStr = hoy();
  const out: Tarea[] = [];
  const t = (x: Omit<Tarea, "vencida">) => out.push({ ...x, vencida: !!x.fecha_limite && x.fecha_limite < hoyStr });
  if (tiene(a, "documento_crear_ficha")) {
    for (const f of await s.query<Row>("SELECT so.*, d.clave FROM sgc_solicitudes so LEFT JOIN sgc_documentos d ON d.id = so.documento_id WHERE so.estado = 'pendiente' ORDER BY so.id")) {
      // Una solicitud sobre un documento que la persona no puede ver (confidencial) no se muestra: ni su clave ni su titulo.
      if (f.documento_id && !(await documentoVisible(s, a, Number(f.documento_id)).then(() => true, () => false))) continue;
      t({ clave: `sgc_solicitud:${f.id}`, tipo: "solicitud", accion: f.tipo === "nuevo" ? "Atender solicitud de documento nuevo" : "Atender solicitud de cambio", papel: "Mejora Continua", documento_id: f.documento_id ? Number(f.documento_id) : null, clave_documento: (f.clave as string | null) ?? null, titulo: String(f.titulo_propuesto || ""), revision: null, fecha_limite: null, desde: String(f.creado_en), href: `/documentos/solicitudes?abrir=${f.id}` });
    }
  }
  const docs = await documentosVisibles(s, a);
  const ids = docs.map((d) => Number(d.doc.id));
  if (!ids.length && !out.length) return out;
  const revs = ids.length ? await s.query<Row>(`SELECT * FROM sgc_revisiones WHERE documento_id IN (${ids.map((_, i) => `:d${i}`).join(", ")}) AND estado IN ('borrador', 'en_revision', 'en_autorizacion', 'autorizada')`, Object.fromEntries(ids.map((id, i) => [`d${i}`, id]))) : [];
  // Ultima accion de cada revision en curso (para distinguir un borrador devuelto).
  const ultima = new Map<number, string>();
  if (revs.length) for (const f of await s.query<Row>(`SELECT revision_id, accion FROM sgc_flujo_acciones WHERE revision_id IN (${revs.map((_, i) => `:r${i}`).join(", ")}) ORDER BY id`, Object.fromEntries(revs.map((r, i) => [`r${i}`, r.id])))) ultima.set(Number(f.revision_id), String(f.accion));
  const docDe = new Map(docs.map((d) => [Number(d.doc.id), d.doc]));
  for (const r of revs) {
    const doc = docDe.get(Number(r.documento_id));
    if (!doc) continue;
    const base = { documento_id: Number(doc.id), clave_documento: String(doc.clave), titulo: String(doc.titulo), revision: Number(r.numero), fecha_limite: (r.fecha_limite as string | null) ?? null, desde: (r.actualizado_en as string | null) ?? (r.creado_en as string), href: `/documentos/${doc.id}` };
    if (r.estado === "borrador" && Number(r.elaborador_id) === a.yo && tiene(a, "documento_elaborar")) {
      const devuelta = (ultima.get(Number(r.id)) || "").endsWith("_devolver");
      t({ ...base, clave: `sgc_tarea:${r.id}:borrador:${r.actualizado_en || r.creado_en}`, tipo: devuelta ? "corregir" : "elaborar", accion: devuelta ? "Corregir lo devuelto y reenviar" : "Elaborar y enviar a revisión", papel: "Elaborador" });
    }
    if (r.estado === "en_revision" && Number(r.revisor_id) === a.yo && tiene(a, "documento_revisar")) t({ ...base, clave: `sgc_tarea:${r.id}:en_revision:${r.enviada_revision_en || ""}`, tipo: "revisar", accion: "Revisar", papel: "Revisor" });
    if (r.estado === "en_autorizacion" && Number(r.autorizador_id) === a.yo && tiene(a, "documento_autorizar")) t({ ...base, clave: `sgc_tarea:${r.id}:en_autorizacion:${r.revisada_en || ""}`, tipo: "autorizar", accion: "Autorizar", papel: "Autorizador" });
    if (r.estado === "autorizada" && tiene(a, "documento_publicar")) t({ ...base, clave: `sgc_tarea:${r.id}:autorizada:${r.autorizada_en || ""}`, tipo: "publicar", accion: "Publicar", papel: "Mejora Continua" });
  }
  const renovs = ids.length ? await s.query<Row>(`SELECT * FROM sgc_renovaciones WHERE estado IN ('en_revision', 'en_autorizacion') AND documento_id IN (${ids.map((_, i) => `:d${i}`).join(", ")})`, Object.fromEntries(ids.map((id, i) => [`d${i}`, id]))) : [];
  const conRenovacion = new Set(renovs.map((r) => Number(r.documento_id)));
  for (const n of renovs) {
    const doc = docDe.get(Number(n.documento_id));
    if (!doc) continue;
    const vig = docs.find((d) => Number(d.doc.id) === Number(doc.id))?.vigente;
    const base = { documento_id: Number(doc.id), clave_documento: String(doc.clave), titulo: String(doc.titulo), revision: vig ? Number(vig.numero) : null, fecha_limite: (n.fecha_limite as string | null) ?? null, href: `/documentos/${doc.id}` };
    if (n.estado === "en_revision" && Number(n.revisor_id) === a.yo && tiene(a, "documento_revisar")) t({ ...base, clave: `sgc_renovacion:${n.id}:en_revision`, tipo: "renovacion_revisar", accion: "Confirmar la vigencia (renovación)", papel: "Revisor", desde: String(n.creado_en) });
    if (n.estado === "en_autorizacion" && Number(n.autorizador_id) === a.yo && tiene(a, "documento_autorizar")) t({ ...base, clave: `sgc_renovacion:${n.id}:en_autorizacion`, tipo: "renovacion_autorizar", accion: "Autorizar la renovación", papel: "Autorizador", desde: (n.revisada_en as string | null) ?? null });
  }
  // Pendientes de revision: a Mejora Continua y al propietario (si no hay renovacion ni revision en curso).
  for (const d of docs) {
    if (d.doc.estado !== "vigente" || !d.vigente || !pendienteDeRevision(d.vigente.fecha_proxima_revision, hoyStr)) continue;
    if (d.trabajo || conRenovacion.has(Number(d.doc.id))) continue;
    const propio = Number(d.doc.propietario_id) === a.yo;
    // Externos: el responsable de seguimiento (propietario) y quien gestiona externos verifican la vigencia.
    const externo = d.doc.origen === "externo";
    const gestiona = externo ? tiene(a, "documento_externo_gestionar") : tiene(a, "documento_crear_ficha");
    if (!gestiona && !propio) continue;
    const vencida = String(d.vigente.fecha_proxima_revision) < hoyStr;
    const accion = externo ? "Verificar la vigencia o registrar la nueva versión (externo)" : gestiona ? "Renovar o abrir una nueva revisión" : "Revisión periódica próxima (eres el propietario)";
    out.push({ clave: `sgc_pendiente_revision:${d.doc.id}:${d.vigente.id}:${d.vigente.fecha_proxima_revision}`, tipo: "pendiente_revision", accion, papel: propio ? (externo ? "Responsable de seguimiento" : "Propietario") : "Mejora Continua", documento_id: Number(d.doc.id), clave_documento: String(d.doc.clave), titulo: String(d.doc.titulo), revision: Number(d.vigente.numero), fecha_limite: String(d.vigente.fecha_proxima_revision), vencida, desde: null, href: `/documentos/${d.doc.id}` });
  }
  // Obsolescencias por aprobar (segundo usuario con documento_autorizar), solo de documentos que la persona ve.
  for (const sol of await porAutorizarDe(s, a.auth)) {
    if (sol.tipo !== "obsoletar_documento_sgc") continue;
    const doc = docDe.get(Number(sol.entidad_id));
    if (!doc) continue;
    out.push({ clave: `solicitud:${sol.id}`, tipo: "obsolescencia", accion: "Aprobar o rechazar la obsolescencia", papel: "Segundo usuario", documento_id: Number(doc.id), clave_documento: String(doc.clave), titulo: String(doc.titulo), revision: null, fecha_limite: String(sol.vence_en).slice(0, 10), vencida: false, desde: String(sol.solicitado_en), href: `/solicitudes?abrir=${sol.id}` });
  }
  // Lecturas pendientes (CA-11): revisiones vigentes visibles con lectura requerida y sin acuse de la persona.
  const vigentes = docs.filter((d) => d.doc.estado === "vigente" && d.vigente).map((d) => ({ revision_id: Number(d.vigente!.id), doc: d.doc, numero: Number(d.vigente!.numero) }));
  for (const l of await lecturasPendientesDe(s, a, vigentes)) {
    out.push({ clave: `sgc_lectura:${l.revision_id}:${l.notificado_en || "inicial"}`, tipo: "lectura", accion: l.notificado_en ? `Confirmar la lectura de la revisión ${l.numero} (recordatorio)` : `Leer y confirmar la revisión ${l.numero}`, papel: "Destinatario", documento_id: Number(l.doc.id), clave_documento: String(l.doc.clave), titulo: String(l.doc.titulo), revision: l.numero, fecha_limite: null, vencida: false, desde: l.notificado_en || l.desde, href: `/documentos/${l.doc.id}?leer=1` });
  }
  return out;
}

export async function bandejaSgc({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const todas = await tareasSgc(s, a);
  const tareas = todas.filter((t) => t.tipo !== "lectura");
  const lecturas = todas.filter((t) => t.tipo === "lectura");
  return json({ items: tareas, total: todas.length, lecturas_pendientes: lecturas });
}

/* Solicitudes propias resueltas en los ultimos 7 dias (aviso al solicitante). */
export async function solicitudesResueltasDe(s: Session, usuarioId: number): Promise<Row[]> {
  const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();
  return s.query<Row>("SELECT so.*, d.clave FROM sgc_solicitudes so LEFT JOIN sgc_documentos d ON d.id = so.documento_id WHERE so.solicitante_id = :yo AND so.estado IN ('aceptada', 'rechazada') AND so.resuelta_en >= :desde AND COALESCE(so.resuelta_por, 0) <> :yo ORDER BY so.id DESC LIMIT 50", { yo: usuarioId, desde });
}
