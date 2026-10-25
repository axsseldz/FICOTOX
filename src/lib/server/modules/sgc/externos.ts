/*
 * Documentos SGC, Fase 3: documentos externos (normas, guias, documentos
 * regulatorios; CA-10). No pasan por elaboracion, revision ni autorizacion:
 *
 *   GET  /api/sgc/externos                    lista con filtros (solo lo visible)
 *   POST /api/sgc/externos                    registrar vigente (documento_externo_gestionar, contrasena)
 *   PUT  /api/sgc/externos/:id                datos de seguimiento (fuente, enlace, responsable), con motivo
 *   POST /api/sgc/externos/:id/verificar      confirmar que sigue vigente (responsable o quien gestiona externos)
 *   POST /api/sgc/externos/:id/version        nueva version (contrasena): la nueva vigente, la anterior obsoleta
 *
 * Cada version es una revision (con la version o fecha de edicion del emisor);
 * la proxima revision de vigencia se guarda en sgc_externos y en la revision
 * vigente (asi el aviso de 30 dias es el mismo de los internos).
 */
import path from "node:path";
import { requireUser } from "../../auth";
import { registrarAuditoria } from "../../audit";
import { descartarArchivo, guardarArchivoEn, validarArchivoSubido, type ArchivoGuardado } from "../../adjuntos";
import { getConfig } from "../../config";
import { type Row, type Session } from "../../db";
import { HttpError, intParam, json, readJson, type RouteContext } from "../../http";
import { hoy } from "../../rbac";
import { exigirReauth } from "../../seguridad";
import { documentoVisible, tiene, type AccesoSgc } from "./acceso";
import { acceso, ahora, datosFicha, documentosVisibles, ENTIDAD, exigir, fechaONull, fichaVisible, idONull, palabrasDe, personas, referenciaDe, sgcDir, texto, textoLargo, validarFicha } from "./documentos";
import { registrarFlujo } from "./flujo";
import { copiarDistribucion } from "./lecturas";
import { enlaceValido, MIME_SGC, MOTIVO_MIN_SGC, pendienteDeRevision } from "../../../shared/documentos";

interface Pdf {
  nombre_original: string;
  extension: string;
  bytes: Buffer;
}

async function leerFormulario(request: Request): Promise<{ campos: Record<string, unknown>; pdf: Pdf | null }> {
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("multipart/form-data")) return { campos: await readJson(request), pdf: null };
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, { message: "No se pudieron leer los datos enviados" });
  }
  const campos: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") campos[k] = v;
  const archivo = form.get("archivo_pdf");
  let pdf: Pdf | null = null;
  if (archivo instanceof File && archivo.name && archivo.size) {
    const cfg = getConfig();
    pdf = await validarArchivoSubido(archivo, { limiteBytes: cfg.DOCUMENTOS_MAX_MB * 1024 * 1024, limiteMb: cfg.DOCUMENTOS_MAX_MB, extensiones: ["pdf"] });
  }
  return { campos, pdf };
}

function datosSeguimiento(raw: Record<string, unknown>, parcial = false) {
  const fuente = texto(raw.fuente, 200);
  const version = texto(raw.version_fecha, 80);
  if (!parcial && !fuente) throw new HttpError(400, { message: "Indica el emisor o fuente", campo: "fuente" });
  if (!parcial && !version) throw new HttpError(400, { message: "Indica la versión o fecha de edición", campo: "version_fecha" });
  const enlaceTexto = String(raw.enlace ?? "").trim();
  const enlace = enlaceValido(enlaceTexto);
  if (enlaceTexto && !enlace) throw new HttpError(400, { message: "El enlace debe ser una dirección http(s) válida", campo: "enlace" });
  return { fuente, version, enlace };
}

function fechasVigencia(raw: Record<string, unknown>) {
  const ultima = fechaONull(raw.ultima_verificacion, "ultima_verificacion") || hoy();
  if (ultima > hoy()) throw new HttpError(400, { message: "La última verificación no puede ser futura", campo: "ultima_verificacion" });
  const proxima = fechaONull(raw.proxima_revision, "proxima_revision");
  if (!proxima) throw new HttpError(400, { message: "Indica la próxima revisión de vigencia", campo: "proxima_revision" });
  if (proxima <= ultima) throw new HttpError(400, { message: "La próxima revisión debe ser posterior a la última verificación", campo: "proxima_revision" });
  return { ultima, proxima };
}

/* El responsable da seguimiento (verifica la vigencia): cuenta vigente que pueda consultar documentos vigentes, como ofrece la pantalla. Si no cambia, se conserva. */
async function validarResponsable(s: Session, id: number | null, actual?: number | null): Promise<number> {
  if (!id) throw new HttpError(400, { message: "Elige al responsable de seguimiento", campo: "responsable" });
  if (actual && id === actual) return id;
  const p = (await personas(s)).find((x) => x.id === id);
  if (!p) throw new HttpError(400, { message: "El responsable debe ser una cuenta activa", campo: "responsable" });
  if (!p.acciones.includes("documento_consultar_vigente")) throw new HttpError(400, { message: `${p.nombre} no puede consultar documentos vigentes; elige a otra persona para el seguimiento`, campo: "responsable" });
  return id;
}

/* Inserta una version (revision vigente) con su PDF opcional. El archivo se guarda en borrador y despues pasa a vigente. */
async function insertarVersion(s: Session, docId: number, numero: number, x: { version: string; ultima: string; proxima: string; comentario: string | null; por: number; pdf: Pdf | null }, guardados: ArchivoGuardado[]): Promise<number> {
  const en = ahora();
  const r = await s.execute(
    `INSERT INTO sgc_revisiones (documento_id, numero, estado, motivo_cambio, descripcion_cambio, version_externa, origen_registro, creado_por, creado_en)
     VALUES (:doc, :n, 'borrador', :motivo, :desc, :version, 'externo', :por, :en)`,
    { doc: docId, n: numero, motivo: numero === 1 ? "Registro del documento externo" : "Nueva versión del emisor", desc: x.comentario, version: x.version, por: x.por, en },
  );
  const revId = Number(r.lastrowid);
  if (x.pdf) {
    const g = await guardarArchivoEn(sgcDir(), path.join(/*turbopackIgnore: true*/ String(docId), String(revId)), "pdf", x.pdf.bytes);
    guardados.push(g);
    const relativo = path.relative(/*turbopackIgnore: true*/ sgcDir(), g.ruta).split(path.sep).join("/");
    await s.execute("INSERT INTO sgc_archivos (revision_id, tipo, nombre_original, nombre_almacenado, extension, mime, tamano_bytes, sha256, subido_por, subido_en) VALUES (:rev, 'pdf', :orig, :alm, 'pdf', :mime, :tam, :sha, :por, :en)", { rev: revId, orig: x.pdf.nombre_original, alm: relativo, mime: MIME_SGC.pdf, tam: g.tamano_bytes, sha: g.sha256, por: x.por, en });
  }
  await s.execute("UPDATE sgc_revisiones SET estado = 'vigente', fecha_emision = :h, fecha_vigencia = :h, fecha_proxima_revision = :prox, publicada_en = :en, publicada_por = :por WHERE id = :id", { h: hoy(), prox: x.proxima, en, por: x.por, id: revId });
  return revId;
}

export async function registrarExterno({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  exigir(a, "documento_externo_gestionar", "No tienes permiso para gestionar documentos externos (documento_externo_gestionar)");
  const { campos, pdf } = await leerFormulario(request);
  const d = await validarFicha(s, { ...datosFicha({ ...campos, clave: campos.identificador ?? campos.clave }), origen: "externo" }, 0, a);
  const seg = datosSeguimiento(campos);
  const { ultima, proxima } = fechasVigencia(campos);
  const responsable = await validarResponsable(s, idONull(campos.responsable_id));
  await exigirReauth(s, request, user, "documentos:externo");
  const guardados: ArchivoGuardado[] = [];
  try {
    const en = ahora();
    const r = await s.execute(
      `INSERT INTO sgc_documentos (clave, titulo, area_codigo, tipo_codigo, origen, proceso, confidencialidad, palabras_clave, propietario_id, estado, creado_por, creado_en, actualizado_por, actualizado_en)
       VALUES (:clave, :titulo, :area_codigo, :tipo_codigo, 'externo', :proceso, :confidencialidad, :palabras, :resp, 'vigente', :por, :en, :por, :en)`,
      { ...d, palabras: JSON.stringify(d.palabras_clave), resp: responsable, por: a.yo, en },
    );
    const docId = Number(r.lastrowid);
    const revId = await insertarVersion(s, docId, 1, { version: seg.version, ultima, proxima, comentario: textoLargo(campos.comentario, 2000), por: a.yo, pdf }, guardados);
    await s.execute("UPDATE sgc_documentos SET revision_vigente_id = :rev WHERE id = :id", { rev: revId, id: docId });
    await s.execute("INSERT INTO sgc_externos (documento_id, fuente, version_fecha, enlace, responsable_id, proxima_revision, ultima_revision, creado_en, actualizado_en) VALUES (:doc, :fuente, :version, :enlace, :resp, :prox, :ult, :en, :en)", { doc: docId, fuente: seg.fuente, version: seg.version, enlace: seg.enlace, resp: responsable, prox: proxima, ult: ultima, en });
    await registrarFlujo(s, { revision_id: revId, accion: "externo_registrar", comentario: textoLargo(campos.comentario, 2000), usuario_id: a.yo, papel: "publicador" });
    await registrarAuditoria(s, user, { accion: "crear", entidad: ENTIDAD, entidadId: docId, referencia: d.clave, despues: { ...fichaVisible(d), fuente: seg.fuente, version: seg.version, enlace: seg.enlace, responsable_id: responsable, ultima_verificacion: ultima, proxima_revision: proxima }, detalle: { externo: true, revision_id: revId, pdf: guardados[0] ? { sha256: guardados[0].sha256 } : null } });
    await s.commit();
    return json({ message: `Documento externo ${d.clave} registrado como vigente`, id: docId, revision_id: revId }, 201);
  } catch (error) {
    await s.rollback();
    for (const g of guardados) await descartarArchivo(g);
    throw error;
  }
}

async function externoDe(s: Session, a: AccesoSgc, id: number) {
  const { doc, revisiones } = await documentoVisible(s, a, id);
  if (doc.origen !== "externo") throw new HttpError(404, { message: "Documento externo no encontrado" });
  const ext = await s.queryOne<Row>("SELECT * FROM sgc_externos WHERE documento_id = :id", { id: doc.id });
  if (!ext) throw new HttpError(404, { message: "Documento externo no encontrado" });
  return { doc, revisiones, ext, vigente: revisiones.find((r) => r.estado === "vigente") || null };
}

/* Quien verifica la vigencia: el responsable de seguimiento (que pueda consultar vigentes) o quien gestiona externos. */
export const puedeVerificar = (a: AccesoSgc, ext: Row) => tiene(a, "documento_externo_gestionar") || (Number(ext.responsable_id) === a.yo && tiene(a, "documento_consultar_vigente"));

export async function verificarExterno({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const { doc, ext, vigente } = await externoDe(s, a, intParam(params.id));
  if (!puedeVerificar(a, ext)) throw new HttpError(403, { message: "Solo el responsable de seguimiento o quien gestiona externos verifica la vigencia", codigo: "sin_permiso" });
  if (doc.estado !== "vigente" || !vigente) throw new HttpError(409, { message: "Solo se verifica un documento externo vigente" });
  const raw = await readJson(request);
  const comentario = String(raw.comentario || "").trim();
  if (comentario.length < MOTIVO_MIN_SGC) throw new HttpError(400, { message: `Escribe el comentario de la verificación (al menos ${MOTIVO_MIN_SGC} caracteres)`, campo: "comentario" });
  const { ultima, proxima } = fechasVigencia({ ...raw, ultima_verificacion: hoy() });
  const en = ahora();
  await s.execute("UPDATE sgc_externos SET ultima_revision = :ult, proxima_revision = :prox, actualizado_en = :en WHERE id = :id", { ult: ultima, prox: proxima, en, id: ext.id });
  await s.execute("UPDATE sgc_revisiones SET fecha_proxima_revision = :prox, renovada_en = :en, actualizado_por = :por, actualizado_en = :en WHERE id = :id", { prox: proxima, en, por: a.yo, id: vigente.id });
  await registrarFlujo(s, { revision_id: Number(vigente.id), accion: "externo_verificar", decision: "vigente", comentario, usuario_id: a.yo, papel: Number(ext.responsable_id) === a.yo ? "responsable" : "publicador" });
  await registrarAuditoria(s, user, { accion: "verificar", entidad: ENTIDAD, entidadId: Number(doc.id), referencia: referenciaDe(doc), motivo: comentario, antes: { ultima_verificacion: ext.ultima_revision ?? null, proxima_revision: ext.proxima_revision ?? null }, despues: { ultima_verificacion: ultima, proxima_revision: proxima }, detalle: { externo: true } });
  await s.commit();
  return json({ message: `Vigencia confirmada; próxima revisión el ${proxima}` });
}

export async function nuevaVersionExterno({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  exigir(a, "documento_externo_gestionar", "Solo quien gestiona externos registra una nueva versión (documento_externo_gestionar)");
  const { doc, revisiones, ext, vigente } = await externoDe(s, a, intParam(params.id));
  if (doc.estado === "obsoleto") throw new HttpError(409, { message: "El documento externo está obsoleto" });
  const { campos, pdf } = await leerFormulario(request);
  const seg = datosSeguimiento({ fuente: ext.fuente, ...campos });
  if (seg.version === String(ext.version_fecha || "")) throw new HttpError(400, { message: "La nueva versión debe ser distinta de la vigente", campo: "version_fecha" });
  const { ultima, proxima } = fechasVigencia(campos);
  await exigirReauth(s, request, user, "documentos:externo");
  const guardados: ArchivoGuardado[] = [];
  try {
    const en = ahora();
    if (vigente) {
      const o = await s.execute("UPDATE sgc_revisiones SET estado = 'obsoleta', fecha_obsolescencia = :en, actualizado_por = :por, actualizado_en = :en WHERE id = :id AND estado = 'vigente'", { en, por: a.yo, id: vigente.id });
      if (!o.rowcount) throw new HttpError(409, { message: "Otra persona cambió el documento al mismo tiempo; recarga la página" });
    }
    const numero = Math.max(0, ...revisiones.map((r) => Number(r.numero))) + 1;
    const revId = await insertarVersion(s, Number(doc.id), numero, { version: seg.version, ultima, proxima, comentario: textoLargo(campos.comentario, 2000), por: a.yo, pdf }, guardados);
    // Como al publicar una revisión interna: la nueva versión conserva los destinatarios (y pide de nuevo el acuse).
    const distribuidos = vigente ? await copiarDistribucion(s, Number(vigente.id), revId, a.yo) : 0;
    if (vigente) {
      await s.execute("UPDATE sgc_revisiones SET sustituida_por_id = :nueva WHERE id = :id", { nueva: revId, id: vigente.id });
      await registrarFlujo(s, { revision_id: Number(vigente.id), accion: "obsoleta", comentario: `Sustituida por la versión ${seg.version}`, usuario_id: a.yo, papel: "publicador" });
    }
    await s.execute("UPDATE sgc_documentos SET estado = 'vigente', revision_vigente_id = :rev, actualizado_por = :por, actualizado_en = :en WHERE id = :id", { rev: revId, por: a.yo, en, id: doc.id });
    await s.execute("UPDATE sgc_externos SET version_fecha = :v, fuente = :f, enlace = :e, ultima_revision = :ult, proxima_revision = :prox, actualizado_en = :en WHERE id = :id", { v: seg.version, f: seg.fuente || ext.fuente, e: seg.enlace ?? ext.enlace ?? null, ult: ultima, prox: proxima, en, id: ext.id });
    await registrarFlujo(s, { revision_id: revId, accion: "externo_version", comentario: textoLargo(campos.comentario, 2000), usuario_id: a.yo, papel: "publicador" });
    await registrarAuditoria(s, user, { accion: "publicar", entidad: ENTIDAD, entidadId: Number(doc.id), referencia: `${referenciaDe(doc)} rev. ${numero}`, antes: { version: ext.version_fecha ?? null }, despues: { version: seg.version, proxima_revision: proxima }, detalle: { externo: true, revision: numero, revision_id: revId, sustituye: vigente ? { revision: Number(vigente.numero), revision_id: Number(vigente.id) } : null, ...(distribuidos ? { distribucion: { origen: "revision_anterior", filas: distribuidos } } : {}) } });
    await s.commit();
    return json({ message: `Versión ${seg.version} registrada como vigente; la anterior queda obsoleta`, revision_id: revId }, 201);
  } catch (error) {
    await s.rollback();
    for (const g of guardados) await descartarArchivo(g);
    throw error;
  }
}

export async function editarExterno({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  exigir(a, "documento_externo_gestionar", "Solo quien gestiona externos edita sus datos de seguimiento (documento_externo_gestionar)");
  const { doc, ext } = await externoDe(s, a, intParam(params.id));
  if (doc.estado === "obsoleto") throw new HttpError(409, { message: "El documento externo está obsoleto: sus datos de seguimiento ya no se modifican" });
  const raw = await readJson(request);
  const motivo = String(raw.motivo || "").trim();
  if (motivo.length < MOTIVO_MIN_SGC) throw new HttpError(400, { message: `Indica el motivo (al menos ${MOTIVO_MIN_SGC} caracteres)`, campo: "motivo" });
  const seg = datosSeguimiento({ fuente: raw.fuente ?? ext.fuente, version_fecha: ext.version_fecha, enlace: raw.enlace === undefined ? ext.enlace : raw.enlace });
  const responsable = raw.responsable_id === undefined ? Number(ext.responsable_id) : await validarResponsable(s, idONull(raw.responsable_id), Number(ext.responsable_id) || null);
  const antes = { fuente: ext.fuente ?? null, enlace: ext.enlace ?? null, responsable_id: ext.responsable_id ?? null };
  const despues = { fuente: seg.fuente, enlace: seg.enlace, responsable_id: responsable };
  await s.execute("UPDATE sgc_externos SET fuente = :f, enlace = :e, responsable_id = :r, actualizado_en = :en WHERE id = :id", { f: seg.fuente, e: seg.enlace, r: responsable, en: ahora(), id: ext.id });
  await s.execute("UPDATE sgc_documentos SET propietario_id = :r, actualizado_por = :por, actualizado_en = :en WHERE id = :id", { r: responsable, por: a.yo, en: ahora(), id: doc.id });
  await registrarAuditoria(s, user, { accion: "editar", entidad: ENTIDAD, entidadId: Number(doc.id), referencia: referenciaDe(doc), motivo, antes, despues, detalle: { externo: true } });
  await s.commit();
  return json({ message: "Datos de seguimiento actualizados" });
}

export async function listarExternos({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const url = new URL(request.url);
  const p = (k: string) => (url.searchParams.get(k) || "").trim();
  const historico = tiene(a, "documento_consultar_historico") || tiene(a, "documento_crear_ficha") || tiene(a, "documento_externo_gestionar");
  const verObsoletos = (p("obsoletos") === "1" || p("estado") === "obsoleto") && historico;
  let lista = (await documentosVisibles(s, a)).filter((x) => x.doc.origen === "externo");
  if (!verObsoletos) lista = lista.filter((x) => x.doc.estado !== "obsoleto");
  const ids = lista.map((x) => Number(x.doc.id));
  const exts = ids.length ? await s.query<Row>(`SELECT e.*, u.nombre AS responsable_nombre FROM sgc_externos e LEFT JOIN usuarios u ON u.id = e.responsable_id WHERE e.documento_id IN (${ids.map((_, i) => `:d${i}`).join(", ")})`, Object.fromEntries(ids.map((id, i) => [`d${i}`, id]))) : [];
  const hoyStr = hoy();
  let items = lista.map((x) => {
    const e = exts.find((y) => Number(y.documento_id) === Number(x.doc.id)) || {};
    const pendiente = x.doc.estado === "vigente" && pendienteDeRevision(e.proxima_revision, hoyStr);
    return {
      id: Number(x.doc.id),
      clave: x.doc.clave,
      titulo: x.doc.titulo,
      area_codigo: x.doc.area_codigo,
      tipo_codigo: x.doc.tipo_codigo,
      confidencialidad: x.doc.confidencialidad,
      palabras_clave: palabrasDe(x.doc),
      estado: x.doc.estado,
      fuente: e.fuente ?? null,
      version_fecha: e.version_fecha ?? null,
      enlace: e.enlace ?? null,
      responsable_id: e.responsable_id ?? null,
      responsable_nombre: e.responsable_nombre ?? null,
      ultima_verificacion: e.ultima_revision ?? null,
      proxima_revision: e.proxima_revision ?? null,
      pendiente_revision: pendiente,
      vencida: pendiente && String(e.proxima_revision) < hoyStr,
      puede: { verificar: x.doc.estado === "vigente" && puedeVerificar(a, e as Row), nueva_version: x.doc.estado === "vigente" && tiene(a, "documento_externo_gestionar") },
    };
  });
  const area = p("area").toUpperCase();
  const estado = p("estado");
  const responsable = Number(p("responsable")) || 0;
  const q = p("search").toLowerCase();
  if (area) items = items.filter((x) => x.area_codigo === area);
  if (estado === "pendiente_revision") items = items.filter((x) => x.pendiente_revision);
  else if (estado) items = items.filter((x) => x.estado === estado);
  if (responsable) items = items.filter((x) => Number(x.responsable_id) === responsable);
  if (q) items = items.filter((x) => [x.clave, x.titulo, x.fuente, ...x.palabras_clave].some((v) => String(v || "").toLowerCase().includes(q)));
  items.sort((x, y) => String(x.proxima_revision || "9999").localeCompare(String(y.proxima_revision || "9999")));
  return json({ items, puede: { registrar: tiene(a, "documento_externo_gestionar"), ver_obsoletos: historico } });
}
