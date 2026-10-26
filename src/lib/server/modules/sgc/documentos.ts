/*
 * Documentos SGC (Fase 1: nucleo documental). Reemplaza a la Biblioteca.
 *
 *   GET  /api/sgc/catalogos                         areas, tipos, personas y lo que puede la persona
 *   GET  /api/sgc/resumen                           conteos por area y estado (solo lo visible)
 *   GET  /api/sgc/documentos                        explorador (busqueda, filtros y orden)
 *   POST /api/sgc/documentos                        nueva ficha + revision en borrador con su archivo (documento_crear_ficha)
 *   GET  /api/sgc/documentos/:id                    ficha: metadatos, revisiones visibles, archivos, eventos
 *   PUT  /api/sgc/documentos/:id                    editar metadatos con motivo (documento_crear_ficha)
 *   POST /api/sgc/documentos/:id/revisiones         nueva revision de trabajo sin tocar la vigente (documento_crear_ficha)
 *   PUT  /api/sgc/revisiones/:rid                   datos y responsables de una revision en borrador
 *   POST /api/sgc/revisiones/:rid/archivos          cargar o sustituir el PDF de consulta o el archivo fuente (documento_elaborar, asignado)
 *   POST /api/sgc/revisiones/:rid/enviar-revision   bloquear el borrador y remitirlo al revisor (documento_enviar_revision, elaborador asignado)
 *   POST /api/sgc/revisiones/:rid/registrar-vigente carga inicial de un documento ya autorizado fuera de la plataforma (documento_publicar, contrasena)
 *   GET  /api/sgc/archivos/:aid?modo=ver|descargar  archivo (la descarga queda en la bitacora)
 *
 * Nada se borra: un archivo sustituido en borrador se conserva marcado como
 * reemplazado; una revision enviada a revision ya no acepta archivos (tambien
 * lo impiden disparadores en la base). Todo cambio va a la bitacora con
 * antes/despues (entidad sgc_documentos).
 */
import fs from "node:fs";
import path from "node:path";
import { requireUser, type CurrentUser } from "../../auth";
import { registrarAuditoria } from "../../audit";
import { contentDisposition, descartarArchivo, guardarArchivoEn, integridadArchivo, rutaEn, validarArchivoSubido, type ArchivoGuardado } from "../../adjuntos";
import { getConfig } from "../../config";
import { type Row, type Session } from "../../db";
import { HttpError, intParam, json, readJson, type RouteContext } from "../../http";
import { cargarAutorizacion, cargoActuante, hoy, permisoDe } from "../../rbac";
import { exigirReauth } from "../../seguridad";
import { incidenciaPorAlertaIntegridad } from "../calidad/automaticas";
import { accesoSgc, documentoVisible, tiene, vistaDocumento, type AccesoSgc } from "./acceso";
import { ANIOS_PROXIMA_REVISION, pendienteDeRevision, sumarAnios } from "../../../shared/documentos";
import { validarIdentificadorExterno } from "../../../shared/documentos";
import { estadoDistribucion, lecturasPendientesDe, lecturasPendientesGlobales } from "./lecturas";
import { CONFIDENCIALIDADES, ESTADOS_TRABAJO, MIME_SGC, MOTIVO_MIN_SGC, esConfidencialidad, esTipoArchivo, etiquetaConfidencialidad, extensionesDe, normalizarPalabras, validarClave, type TipoArchivoSgc } from "../../../shared/documentos";
import { fechaValida } from "../../../shared/fechas";
import { ACCION_DOCUMENTAL_KEYS, type AccionDocumental } from "../../../shared/permisos";
import { evaluarTresPersonas } from "../../../shared/segregacion";
import { exigirSinOtroPapel, registrarSolicitudDeFicha, solicitudPropiaAceptada } from "./flujo";

export const ENTIDAD = "sgc_documentos";
export const sgcDir = () => path.join(/*turbopackIgnore: true*/ getConfig().INSTANCE_DIR, "sgc");
export const ahora = () => new Date().toISOString();
export const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export type Puede = { ok: boolean; motivo?: string };
export const si: Puede = { ok: true };
export const no = (motivo?: string): Puede => (motivo ? { ok: false, motivo } : { ok: false });

export async function acceso(s: Session, user: CurrentUser): Promise<AccesoSgc> {
  return accesoSgc(s, await cargarAutorizacion(s, user));
}

export const palabrasDe = (row: Row): string[] => {
  try {
    const v = JSON.parse(String(row.palabras_clave || "[]"));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};
export const referenciaDe = (doc: Row) => String(doc.clave || `Documento ${doc.id}`);

/* ---------- Catalogos y personas ---------- */

export async function catalogos(s: Session): Promise<{ areas: Row[]; tipos: Row[] }> {
  const areas = await s.query<Row>("SELECT codigo, nombre, color, orden, activo FROM sgc_areas ORDER BY orden, codigo");
  const tipos = await s.query<Row>("SELECT codigo, nombre, descripcion, orden, activo FROM sgc_tipos ORDER BY orden, codigo");
  return { areas, tipos };
}

/* Personas activas con sus acciones documentales vigentes (union de roles). */
export interface Persona {
  id: number;
  nombre: string;
  email: string;
  acciones: AccionDocumental[];
}
export async function personas(s: Session): Promise<Persona[]> {
  const filas = await s.query<Row>(
    `SELECT u.id, u.nombre, u.email, ra.accion
     FROM usuarios u
     LEFT JOIN usuario_roles ur ON ur.usuario_id = u.id AND ur.revocado_en IS NULL AND ur.vigente_desde <= :hoy AND (ur.vigente_hasta IS NULL OR ur.vigente_hasta >= :hoy)
     LEFT JOIN roles r ON r.id = ur.rol_id AND r.activo = 1
     LEFT JOIN rol_acciones ra ON ra.id_rol = r.id AND ra.modulo = 'documentos'
     WHERE COALESCE(u.activo, 1) = 1 AND (u.vigente_hasta IS NULL OR u.vigente_hasta >= :hoy)
     ORDER BY u.nombre`,
    { hoy: hoy() },
  );
  const mapa = new Map<number, Persona>();
  for (const f of filas) {
    const id = Number(f.id);
    const p = mapa.get(id) || { id, nombre: String(f.nombre || f.email), email: String(f.email || ""), acciones: [] };
    const accion = String(f.accion || "");
    const nuevas = accion === "G" ? ACCION_DOCUMENTAL_KEYS : (ACCION_DOCUMENTAL_KEYS as string[]).includes(accion) ? [accion as AccionDocumental] : [];
    for (const a of nuevas) if (!p.acciones.includes(a)) p.acciones.push(a);
    mapa.set(id, p);
  }
  return [...mapa.values()];
}

export const nombres = async (s: Session, ids: unknown[]): Promise<Map<number, string>> => {
  const unicos = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!unicos.length) return new Map();
  const filas = await s.query<Row>(`SELECT id, nombre, email FROM usuarios WHERE id IN (${unicos.map((_, i) => `:u${i}`).join(", ")})`, Object.fromEntries(unicos.map((id, i) => [`u${i}`, id])));
  return new Map(filas.map((f) => [Number(f.id), String(f.nombre || f.email)]));
};

export async function obtenerCatalogos({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const { areas, tipos } = await catalogos(s);
  // Las personas (para propietario y responsables) solo las necesita quien crea o edita fichas y revisiones.
  // (y quien gestiona externos o administra la distribucion: responsable de seguimiento y destinatarios).
  const gestiona = tiene(a, "documento_crear_ficha") || tiene(a, "documento_externo_gestionar") || tiene(a, "documento_administrar_lecturas");
  const lista = gestiona ? await personas(s) : [];
  // Roles para la distribucion: los que pueden consultar vigentes (y si pueden confirmar lecturas).
  const roles = tiene(a, "documento_administrar_lecturas")
    ? (await s.query<Row>("SELECT r.id, r.nombre, GROUP_CONCAT(ra.accion) AS acciones FROM roles r JOIN rol_acciones ra ON ra.id_rol = r.id AND ra.modulo = 'documentos' WHERE r.activo = 1 GROUP BY r.id, r.nombre ORDER BY r.nombre"))
        .map((r) => {
          const acc = String(r.acciones || "").split(",");
          return { id: Number(r.id), nombre: String(r.nombre), consulta: acc.includes("G") || acc.includes("documento_consultar_vigente"), acusa: acc.includes("G") || acc.includes("documento_acusar_lectura") };
        })
        .filter((r) => r.consulta)
    : [];
  return json({
    areas,
    tipos,
    confidencialidades: CONFIDENCIALIDADES,
    personas: lista,
    roles,
    yo: { id: a.yo, acciones: [...a.acciones], diagnostico: a.diagnostico, privilegiado: a.privilegiado },
    puede: { crear_ficha: tiene(a, "documento_crear_ficha") },
    max_mb: getConfig().DOCUMENTOS_MAX_MB,
  });
}

/* ---------- Lectura: lista, resumen y ficha ---------- */

export interface DocLista {
  doc: Row;
  revisiones: Row[];
  vigente: Row | null;
  trabajo: Row | null;
}

/* Todos los documentos que la persona puede ver, con la vigente y la revision de trabajo visibles. */
export async function documentosVisibles(s: Session, a: AccesoSgc): Promise<DocLista[]> {
  const docs = await s.query<Row>("SELECT d.*, u.nombre AS propietario_nombre FROM sgc_documentos d LEFT JOIN usuarios u ON u.id = d.propietario_id ORDER BY d.clave");
  const revs = await s.query<Row>("SELECT id, documento_id, numero, estado, fecha_emision, fecha_vigencia, fecha_proxima_revision, elaborador_id, revisor_id, autorizador_id FROM sgc_revisiones");
  const porDoc = new Map<number, Row[]>();
  for (const r of revs) porDoc.set(Number(r.documento_id), [...(porDoc.get(Number(r.documento_id)) || []), r]);
  const out: DocLista[] = [];
  for (const doc of docs) {
    const revisiones = porDoc.get(Number(doc.id)) || [];
    const vista = vistaDocumento(a, doc, revisiones);
    if (!vista.ficha) continue;
    const visibles = revisiones.filter((r) => vista.revisiones.has(Number(r.id)));
    out.push({ doc, revisiones: visibles, vigente: visibles.find((r) => r.estado === "vigente") || null, trabajo: visibles.find((r) => ESTADOS_TRABAJO.includes(r.estado)) || null });
  }
  return out;
}

const resumenRevision = (r: Row | null) => (r ? { id: Number(r.id), numero: Number(r.numero), estado: String(r.estado), fecha_emision: r.fecha_emision || null, fecha_vigencia: r.fecha_vigencia || null, fecha_proxima_revision: r.fecha_proxima_revision || null } : null);

function serializarLista(x: DocLista): Row {
  const { doc } = x;
  return {
    id: Number(doc.id),
    clave: doc.clave,
    titulo: doc.titulo,
    area_codigo: doc.area_codigo,
    tipo_codigo: doc.tipo_codigo,
    origen: doc.origen,
    proceso: doc.proceso || null,
    confidencialidad: doc.confidencialidad,
    palabras_clave: palabrasDe(doc),
    propietario_id: doc.propietario_id ?? null,
    propietario_nombre: doc.propietario_nombre || null,
    estado: doc.estado,
    vigente: resumenRevision(x.vigente),
    pendiente_revision: x.doc.estado === "vigente" && pendienteDeRevision(x.vigente?.fecha_proxima_revision, hoy()),
    trabajo: resumenRevision(x.trabajo),
    creado_en: doc.creado_en,
    actualizado_en: doc.actualizado_en || doc.creado_en,
  };
}

const enDias = (dias: number) => {
  const [y, m, d] = hoy().split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
};
/* Vigente con proxima revision en los siguientes 30 dias (o ya pasada). */
const proximaRevision = (x: DocLista, limite = enDias(30)) => !!x.vigente?.fecha_proxima_revision && String(x.vigente.fecha_proxima_revision) <= limite;
const enProceso = (x: DocLista) => !!x.trabajo && x.trabajo.estado !== "borrador";
/* En elaboracion, revision o autorizacion: con una revision de trabajo visible, o sin revision vigente todavia. */
const enCurso = (x: DocLista) => !!x.trabajo || x.doc.estado === "en_elaboracion";
const enBorrador = (x: DocLista) => x.trabajo?.estado === "borrador";

export async function resumenSgc({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const { areas } = await catalogos(s);
  const visibles = await documentosVisibles(s, a);
  const contar = (lista: DocLista[]) => ({
    total: lista.length,
    vigentes: lista.filter((x) => x.doc.estado === "vigente").length,
    en_revision: lista.filter(enProceso).length,
    borradores: lista.filter(enBorrador).length,
    proximos: lista.filter((x) => proximaRevision(x)).length,
    obsoletos: lista.filter((x) => x.doc.estado === "obsoleto").length,
  });
  // Indicadores de la vista general (Fase 3), todos sobre lo que la persona ve.
  const hoyStr = hoy();
  const activos = visibles.filter((x) => x.doc.estado !== "obsoleto");
  const pendientes = activos.filter((x) => x.doc.estado === "vigente" && pendienteDeRevision(x.vigente?.fecha_proxima_revision, hoyStr));
  const vigentesRev = activos.filter((x) => x.doc.estado === "vigente" && x.vigente).map((x) => ({ revision_id: Number(x.vigente!.id), doc: x.doc, numero: Number(x.vigente!.numero) }));
  const mias = await lecturasPendientesDe(s, a, vigentesRev);
  const administra = tiene(a, "documento_administrar_lecturas");
  const historico = tiene(a, "documento_consultar_historico") || tiene(a, "documento_crear_ficha");
  const idsVisibles = new Set(visibles.map((x) => String(x.doc.id)));
  // Actividad reciente: eventos de documentos visibles; quien no ve el historico, solo publicaciones y verificaciones de vigencia.
  const eventos = (await s.query<Row>("SELECT id, fecha_hora, usuario_nombre, accion, entidad_id, referencia FROM auditoria WHERE entidad = :e AND entidad_id IS NOT NULL ORDER BY id DESC LIMIT 400", { e: ENTIDAD }))
    .filter((e) => idsVisibles.has(String(e.entidad_id)) && (historico || ["publicar", "verificar"].includes(String(e.accion))))
    .slice(0, 12)
    .map((e) => ({ id: Number(e.id), fecha_hora: e.fecha_hora, usuario_nombre: e.usuario_nombre ?? null, accion: String(e.accion), documento_id: Number(e.entidad_id), referencia: e.referencia ?? null }));
  return json({
    areas: areas.filter((ar) => Number(ar.activo)).map((ar) => ({ ...ar, conteos: contar(visibles.filter((x) => x.doc.area_codigo === ar.codigo)) })),
    totales: contar(visibles),
    indicadores: {
      vigentes: activos.filter((x) => x.doc.estado === "vigente").length,
      en_revision: activos.filter((x) => x.trabajo && ["en_revision", "en_autorizacion"].includes(String(x.trabajo.estado))).length,
      por_publicar: activos.filter((x) => x.trabajo?.estado === "autorizada").length,
      pendientes_revision: { internos: pendientes.filter((x) => x.doc.origen !== "externo").length, externos: pendientes.filter((x) => x.doc.origen === "externo").length },
      lecturas_mias: mias.length,
      lecturas_globales: administra ? await lecturasPendientesGlobales(s, vigentesRev.map((v) => v.revision_id)) : null,
      externos: activos.filter((x) => x.doc.origen === "externo").length,
      // Inicio del modulo: los mismos criterios que los filtros de la lista (estado=en_curso y estado=pendiente_revision).
      en_curso: activos.filter(enCurso).length,
      proximos_revision: activos.filter((x) => proximaRevision(x)).length,
    },
    lecturas_pendientes: mias.length,
    actividad: eventos,
    puede: { crear_ficha: tiene(a, "documento_crear_ficha"), lista_maestra: tiene(a, "documento_consultar_vigente"), exportar_maestra: tiene(a, "lista_maestra_exportar"), externos: tiene(a, "documento_consultar_vigente") || tiene(a, "documento_externo_gestionar"), registrar_externo: tiene(a, "documento_externo_gestionar") },
    diagnostico: a.diagnostico,
  });
}

export async function listarDocumentos({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const url = new URL(request.url);
  const p = (k: string) => (url.searchParams.get(k) || "").trim();
  const search = p("search").toLowerCase();
  const area = p("area").toUpperCase();
  const tipo = p("tipo").toUpperCase();
  const estado = p("estado");
  const origen = p("origen");
  const propietario = Number(p("propietario")) || 0;
  const desde = FECHA.test(p("desde")) ? p("desde") : "";
  const hasta = FECHA.test(p("hasta")) ? p("hasta") : "";
  const orden = p("orden") || "clave";
  const todos = await documentosVisibles(s, a);
  let lista = todos;
  // Obsoletos: fuera de los puntos de uso; solo con "Mostrar obsoletos" (y solo los ve quien consulta el historico).
  if (p("obsoletos") !== "1" && estado !== "obsoleto") lista = lista.filter((x) => x.doc.estado !== "obsoleto");
  if (area) lista = lista.filter((x) => x.doc.area_codigo === area);
  if (tipo) lista = lista.filter((x) => x.doc.tipo_codigo === tipo);
  if (origen === "interno" || origen === "externo") lista = lista.filter((x) => x.doc.origen === origen);
  if (propietario) lista = lista.filter((x) => Number(x.doc.propietario_id) === propietario);
  if (estado === "vigente" || estado === "obsoleto" || estado === "en_elaboracion") lista = lista.filter((x) => x.doc.estado === estado);
  if (estado === "en_revision") lista = lista.filter(enProceso);
  if (estado === "en_curso") lista = lista.filter(enCurso);
  if (estado === "borrador") lista = lista.filter(enBorrador);
  if (estado === "proxima_revision" || estado === "pendiente_revision") lista = lista.filter((x) => proximaRevision(x));
  // Fechas: la de emision de la revision vigente (o la de creacion de la ficha si no tiene vigente).
  const fechaDe = (x: DocLista) => String(x.vigente?.fecha_emision || String(x.doc.creado_en || "").slice(0, 10));
  if (desde) lista = lista.filter((x) => fechaDe(x) >= desde);
  if (hasta) lista = lista.filter((x) => fechaDe(x) <= hasta);
  if (search) {
    lista = lista.filter((x) => [x.doc.clave, x.doc.titulo, x.doc.proceso, ...palabrasDe(x.doc)].some((v) => String(v || "").toLowerCase().includes(search)));
  }
  const cmp: Record<string, (x: DocLista, y: DocLista) => number> = {
    clave: (x, y) => String(x.doc.clave).localeCompare(String(y.doc.clave), "es"),
    titulo: (x, y) => String(x.doc.titulo).localeCompare(String(y.doc.titulo), "es"),
    recientes: (x, y) => String(y.doc.actualizado_en || y.doc.creado_en).localeCompare(String(x.doc.actualizado_en || x.doc.creado_en)),
    proxima: (x, y) => String(x.vigente?.fecha_proxima_revision || "9999").localeCompare(String(y.vigente?.fecha_proxima_revision || "9999")),
  };
  lista.sort(cmp[orden] || cmp.clave);
  const propietarios = [...new Map(todos.filter((x) => x.doc.propietario_id).map((x) => [Number(x.doc.propietario_id), { id: Number(x.doc.propietario_id), nombre: String(x.doc.propietario_nombre || "") }])).values()].sort((x, y) => x.nombre.localeCompare(y.nombre, "es"));
  return json({ items: lista.map(serializarLista), propietarios, puede: { crear_ficha: tiene(a, "documento_crear_ficha"), proponer: tiene(a, "documento_proponer"), ver_obsoletos: tiene(a, "documento_consultar_historico") || tiene(a, "documento_crear_ficha") }, diagnostico: a.diagnostico });
}

/* Banderas de una revision para la persona. */
function puedeRevision(a: AccesoSgc, doc: Row, rev: Row, archivos: Row[], todas: Row[]): Record<string, Puede> {
  const borrador = rev.estado === "borrador";
  const crear = tiene(a, "documento_crear_ficha");
  const elaborador = rev.elaborador_id ? Number(rev.elaborador_id) : null;
  const soyElaborador = elaborador === a.yo;
  const obsoleto = doc.estado === "obsoleto";
  const out: Record<string, Puede> = {};
  // Cargar o sustituir archivos: documento_elaborar y ser el elaborador asignado (o, sin elaborador asignado, quien crea fichas).
  if (!tiene(a, "documento_elaborar")) out.subir_archivo = no();
  else if (obsoleto) out.subir_archivo = no("El documento está obsoleto");
  else if (!borrador) out.subir_archivo = no("La revisión ya se envió a revisión: su archivo no se puede cambiar; para cambiarlo debe devolverse a borrador");
  else if (elaborador ? !soyElaborador : !crear) out.subir_archivo = no(elaborador ? "Solo el elaborador asignado carga o sustituye los archivos" : "Primero Mejora Continua debe asignar al elaborador");
  else out.subir_archivo = si;
  // Editar datos de la revision (en borrador): quien crea fichas (todo) o el elaborador asignado (descripcion del cambio).
  out.editar = borrador && !obsoleto && (crear || (soyElaborador && tiene(a, "documento_elaborar"))) ? si : no();
  out.asignar = borrador && !obsoleto && crear ? si : no();
  // Enviar a revision: el elaborador asignado con documento_enviar_revision, con PDF de consulta y revisor asignado.
  const pdf = archivos.some((f) => f.tipo === "pdf" && !f.reemplazado_en);
  if (!tiene(a, "documento_enviar_revision") || !borrador) out.enviar_revision = no();
  else if (!elaborador) out.enviar_revision = no("Falta asignar al elaborador");
  else if (!soyElaborador) out.enviar_revision = no("Solo el elaborador asignado la envía a revisión");
  else if (!pdf) out.enviar_revision = no("Carga el PDF de consulta antes de enviarla");
  else if (!rev.revisor_id || !rev.autorizador_id) out.enviar_revision = no("Faltan el revisor o el autorizador: los asigna Mejora Continua");
  else if (!String(rev.motivo_cambio || "").trim() || !String(rev.apartados_afectados || "").trim() || !String(rev.descripcion_cambio || "").trim()) out.enviar_revision = no("Completa el motivo del cambio, los apartados afectados y la descripción del cambio («Editar datos»)");
  else out.enviar_revision = si;
  // Fase 2: cada decision solo para quien esta asignado en ese papel y tiene la accion del rol.
  out.revisar = rev.estado === "en_revision" && tiene(a, "documento_revisar") && Number(rev.revisor_id) === a.yo ? si : no();
  out.autorizar = rev.estado === "en_autorizacion" && tiene(a, "documento_autorizar") && Number(rev.autorizador_id) === a.yo ? si : no();
  out.publicar = rev.estado === "autorizada" && tiene(a, "documento_publicar") && !obsoleto ? si : no();
  out.reasignar = ["borrador", "en_revision", "en_autorizacion"].includes(String(rev.estado)) && crear && !obsoleto ? si : no();
  // Carga inicial: solo la primera revision de un documento que nunca tuvo vigente (documentos ya autorizados fuera de la plataforma).
  const primera = !todas.some((r) => Number(r.id) !== Number(rev.id) && ["vigente", "obsoleta"].includes(String(r.estado)));
  if (!tiene(a, "documento_publicar") || !["borrador", "en_revision"].includes(String(rev.estado)) || !primera || obsoleto) out.registrar_vigente = no();
  else if (!pdf) out.registrar_vigente = no("Carga el PDF de consulta");
  else if (!rev.elaborador_id || !rev.revisor_id || !rev.autorizador_id) out.registrar_vigente = no("Asigna elaborador, revisor y autorizador");
  else out.registrar_vigente = si;
  return out;
}

const camposRevision = ["version_externa", "fecha_limite", "revisada_en", "autorizada_en", "cancelada_en", "sustituida_por_id", "renovada_en", "solicitud_id", "numero", "estado", "fecha_emision", "fecha_vigencia", "fecha_proxima_revision", "motivo_cambio", "apartados_afectados", "descripcion_cambio", "elaborador_id", "revisor_id", "autorizador_id", "enviada_revision_en", "publicada_en", "fecha_obsolescencia", "ubicacion_historica", "regla_conservacion", "origen_registro", "creado_en"];

export async function obtenerDocumento({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const { doc, revisiones, vista } = await documentoVisible(s, a, intParam(params.id));
  const visibles = revisiones.filter((r) => vista.revisiones.has(Number(r.id)));
  const ids = visibles.map((r) => Number(r.id));
  const archivos = ids.length ? await s.query<Row>(`SELECT id, revision_id, tipo, nombre_original, extension, mime, tamano_bytes, sha256, subido_por, subido_en, reemplazado_en, reemplazado_por FROM sgc_archivos WHERE revision_id IN (${ids.map((_, i) => `:r${i}`).join(", ")}) ORDER BY id DESC`, Object.fromEntries(ids.map((id, i) => [`r${i}`, id]))) : [];
  const flujo = ids.length ? await s.query<Row>(`SELECT * FROM sgc_flujo_acciones WHERE revision_id IN (${ids.map((_, i) => `:r${i}`).join(", ")}) ORDER BY fecha, id`, Object.fromEntries(ids.map((id, i) => [`r${i}`, id]))) : [];
  const renovaciones = await s.query<Row>("SELECT * FROM sgc_renovaciones WHERE documento_id = :id ORDER BY id DESC", { id: doc.id });
  const pendienteObs = await s.queryOne<Row>("SELECT id FROM solicitudes_autorizacion WHERE entidad = :e AND entidad_id = :id AND tipo = 'obsoletar_documento_sgc' AND estado = 'pendiente' AND vence_en > :ahora", { e: ENTIDAD, id: String(doc.id), ahora: ahora() });
  const gente = await nombres(s, [doc.propietario_id, doc.creado_por, doc.obsoleto_por, ...visibles.flatMap((r) => [r.elaborador_id, r.revisor_id, r.autorizador_id, r.publicada_por, r.enviada_revision_por]), ...archivos.map((f) => f.subido_por), ...flujo.map((f) => f.usuario_id), ...renovaciones.flatMap((n) => [n.revisor_id, n.autorizador_id, n.solicitado_por])]);
  const nombre = (id: unknown) => (id ? gente.get(Number(id)) || null : null);
  const { areas, tipos } = await catalogos(s);
  const crear = tiene(a, "documento_crear_ficha");
  const trabajo = revisiones.find((r) => ESTADOS_TRABAJO.includes(r.estado));
  const vigente = revisiones.find((r) => r.estado === "vigente");
  let nuevaRevision: Puede = no();
  if (crear) {
    if (doc.estado === "obsoleto") nuevaRevision = no("El documento está obsoleto");
    // Sin vigente: si la primera revisión se rechazó (cancelada) se abre otra; si sigue en curso, se completa esa.
    else if (!vigente && trabajo) nuevaRevision = no("El documento todavía no tiene revisión vigente: completa la revisión en curso");
    else if (trabajo) nuevaRevision = no(`Ya hay una revisión en curso (revisión ${trabajo.numero}, ${String(trabajo.estado).replace("_", " ")})`);
    else if (renovaciones.some((n) => ["en_revision", "en_autorizacion"].includes(String(n.estado)))) nuevaRevision = no("Hay una renovación de vigencia en curso");
    else if (pendienteObs) nuevaRevision = no("Hay una solicitud de obsolescencia pendiente");
    else nuevaRevision = si;
  }
  const renovacionActiva = renovaciones.find((n) => ["en_revision", "en_autorizacion"].includes(String(n.estado)));
  const pendiente = doc.estado === "vigente" && !!vigente && pendienteDeRevision(vigente.fecha_proxima_revision, hoy());
  let renovar: Puede = no();
  if (crear && doc.estado === "vigente" && vigente) {
    if (!pendiente) renovar = no();
    else if (trabajo) renovar = no("Hay una revisión en curso");
    else if (renovacionActiva) renovar = no("Ya hay una renovación en curso");
    else if (pendienteObs) renovar = no("Hay una solicitud de obsolescencia pendiente");
    else renovar = si;
  }
  // Externos (Fase 3): no pasan por elaboracion, revision ni autorizacion.
  const externo = doc.origen === "externo";
  if (externo) {
    const fuera = no("Los documentos externos no pasan por el flujo: se verifica su vigencia o se registra su nueva versión");
    if (crear) nuevaRevision = fuera;
    renovar = no();
  }
  let obsoletar: Puede = no();
  if (tiene(a, "documento_obsoletar") && doc.estado !== "obsoleto") obsoletar = pendienteObs ? no(`Ya hay una solicitud de obsolescencia pendiente (#${pendienteObs.id})`) : si;
  const eventos = vista.historial
    ? await s.query<Row>("SELECT id, fecha_hora, usuario_nombre, usuario_email, accion, entidad, entidad_id, referencia, motivo, cambios_json FROM auditoria WHERE entidad = :e AND entidad_id = :id ORDER BY id DESC LIMIT 200", { e: ENTIDAD, id: String(doc.id) })
    : [];
  return json({
    item: {
      id: Number(doc.id),
      clave: doc.clave,
      titulo: doc.titulo,
      area: areas.find((x) => x.codigo === doc.area_codigo) || { codigo: doc.area_codigo, nombre: doc.area_codigo, color: "#888888" },
      tipo: tipos.find((x) => x.codigo === doc.tipo_codigo) || { codigo: doc.tipo_codigo, nombre: doc.tipo_codigo },
      origen: doc.origen,
      proceso: doc.proceso || null,
      confidencialidad: doc.confidencialidad,
      palabras_clave: palabrasDe(doc),
      propietario_id: doc.propietario_id ?? null,
      propietario_nombre: nombre(doc.propietario_id),
      estado: doc.estado,
      pendiente_revision: pendiente,
      obsoleto_en: doc.obsoleto_en || null,
      obsoleto_por_nombre: nombre(doc.obsoleto_por),
      motivo_obsolescencia: doc.motivo_obsolescencia || null,
      obsolescencia_pendiente: pendienteObs ? Number(pendienteObs.id) : null,
      revision_vigente_id: vigente && vista.revisiones.has(Number(vigente.id)) ? Number(vigente.id) : null,
      creado_por_nombre: nombre(doc.creado_por),
      creado_en: doc.creado_en,
      actualizado_en: doc.actualizado_en || null,
    },
    revisiones: visibles.map((r) => {
      const suyos = archivos.filter((f) => Number(f.revision_id) === Number(r.id));
      return {
        id: Number(r.id),
        ...Object.fromEntries(camposRevision.map((c) => [c, r[c] ?? null])),
        elaborador_nombre: nombre(r.elaborador_id),
        revisor_nombre: nombre(r.revisor_id),
        autorizador_nombre: nombre(r.autorizador_id),
        publicada_por_nombre: nombre(r.publicada_por),
        archivos: suyos.map((f) => ({ ...f, subido_por_nombre: nombre(f.subido_por) })),
        linea_tiempo: flujo.filter((f) => Number(f.revision_id) === Number(r.id)).map((f) => ({ id: Number(f.id), accion: f.accion, decision: f.decision ?? null, comentario: f.comentario ?? null, usuario_nombre: nombre(f.usuario_id), cargo: f.cargo ?? null, papel: f.papel ?? null, fecha: f.fecha, renovacion_id: f.renovacion_id ?? null })),
        abrir: vista.archivos.has(Number(r.id)),
        puede: puedeRevision(a, doc, r, suyos, revisiones),
      };
    }),
    // Revisiones que existen pero la persona no puede ver (solo el numero de cuantas; sin datos).
    revisiones_ocultas: revisiones.length - visibles.length,
    historial: vista.historial,
    solo_diagnostico: vista.soloDiagnostico,
    eventos: eventos.map((e) => ({ ...e, cambios: (() => { try { return JSON.parse(String(e.cambios_json || "{}")); } catch { return {}; } })(), cambios_json: undefined })),
    externo: externo ? await datosExterno(s, a, doc) : null,
    distribucion: vigente && vista.revisiones.has(Number(vigente.id)) ? await datosDistribucionFicha(s, a, doc, vigente) : null,
    renovaciones: renovaciones.map((n) => ({
      id: Number(n.id),
      revision_id: Number(n.revision_id),
      estado: n.estado,
      revisor_nombre: nombre(n.revisor_id),
      autorizador_nombre: nombre(n.autorizador_id),
      solicitado_por_nombre: nombre(n.solicitado_por),
      fecha_proxima_anterior: n.fecha_proxima_anterior ?? null,
      fecha_proxima_nueva: n.fecha_proxima_nueva,
      fecha_limite: n.fecha_limite ?? null,
      creado_en: n.creado_en,
      autorizada_en: n.autorizada_en ?? null,
      puede: {
        revisar: n.estado === "en_revision" && Number(n.revisor_id) === a.yo && tiene(a, "documento_revisar") ? si : no(),
        autorizar: n.estado === "en_autorizacion" && Number(n.autorizador_id) === a.yo && tiene(a, "documento_autorizar") ? si : no(),
      },
    })),
    puede: { editar: crear && doc.estado !== "obsoleto" ? si : no(), nueva_revision: nuevaRevision, renovar, obsoletar, proponer: tiene(a, "documento_proponer") && doc.estado !== "obsoleto" && !externo ? si : no() },
  });
}

/* Datos de seguimiento de un externo para la ficha. */
async function datosExterno(s: Session, a: AccesoSgc, doc: Row) {
  const e = await s.queryOne<Row>("SELECT e.*, u.nombre AS responsable_nombre FROM sgc_externos e LEFT JOIN usuarios u ON u.id = e.responsable_id WHERE e.documento_id = :id", { id: doc.id });
  if (!e) return null;
  const vigente = doc.estado === "vigente";
  const gestiona = tiene(a, "documento_externo_gestionar");
  const verifica = gestiona || (Number(e.responsable_id) === a.yo && tiene(a, "documento_consultar_vigente"));
  return {
    fuente: e.fuente ?? null,
    version_fecha: e.version_fecha ?? null,
    enlace: e.enlace ?? null,
    responsable_id: e.responsable_id ?? null,
    responsable_nombre: e.responsable_nombre ?? null,
    ultima_verificacion: e.ultima_revision ?? null,
    proxima_revision: e.proxima_revision ?? null,
    puede: {
      verificar: !vigente ? no() : verifica ? si : no(),
      nueva_version: !vigente ? no() : gestiona ? si : no(),
      editar: doc.estado !== "obsoleto" && gestiona ? si : no(),
    },
  };
}

/*
 * Distribucion y lecturas de la revision vigente. La lista por persona la ven
 * quien administra lecturas, quien consulta el historico y el propietario; los
 * demas ven el punto de uso y su propio acuse.
 */
async function datosDistribucionFicha(s: Session, a: AccesoSgc, doc: Row, vigente: Row) {
  const { filas, destinatarios } = await estadoDistribucion(s, Number(vigente.id));
  const administra = tiene(a, "documento_administrar_lecturas");
  const completo = administra || tiene(a, "documento_consultar_historico") || Number(doc.propietario_id) === a.yo;
  const requeridos = destinatarios.filter((d) => d.requiere);
  const leidos = requeridos.filter((d) => d.leido_en).length;
  const mio = destinatarios.find((d) => d.usuario_id === a.yo) || null;
  const obsoleto = doc.estado === "obsoleto";
  let acusar: Puede = no();
  if (mio?.requiere && tiene(a, "documento_acusar_lectura")) acusar = mio.leido_en ? no("Ya confirmaste la lectura de esta revisión") : si;
  return {
    revision_id: Number(vigente.id),
    numero: Number(vigente.numero),
    puntos_uso: [...new Set(filas.map((f) => f.punto_uso).filter(Boolean).map(String))],
    filas: completo ? filas.map((f) => ({ id: Number(f.id), rol_id: f.rol_id ?? null, rol_nombre: f.rol_nombre ?? null, usuario_id: f.usuario_id ?? null, usuario_nombre: f.usuario_nombre ?? null, punto_uso: f.punto_uso ?? null, requiere_lectura: !!Number(f.requiere_lectura), motivo: f.motivo ?? null, creado_en: f.creado_en, creado_por_nombre: f.creado_por_nombre ?? null })) : [],
    destinatarios: completo ? destinatarios : [],
    avance: { leidos, total: requeridos.length, porcentaje: requeridos.length ? Math.round((leidos * 100) / requeridos.length) : null },
    mi_lectura: mio ? { requiere: mio.requiere, leido_en: mio.leido_en, puntos: mio.puntos } : null,
    completo,
    puede: {
      administrar: administra && !obsoleto ? si : no(),
      recordatorio: !administra || obsoleto || !requeridos.length ? no() : requeridos.length > leidos ? si : no("Todas las lecturas requeridas están confirmadas"),
      acusar,
    },
  };
}

/* ---------- Validacion de datos ---------- */

export interface DatosFicha {
  clave: string;
  titulo: string;
  area_codigo: string;
  tipo_codigo: string;
  origen: "interno" | "externo";
  proceso: string | null;
  confidencialidad: string;
  palabras_clave: string[];
  propietario_id: number | null;
}

export const texto = (v: unknown, max: number) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
export const textoLargo = (v: unknown, max = 4000) => String(v ?? "").trim().slice(0, max) || null;
export const idONull = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export function datosFicha(raw: Record<string, unknown>): DatosFicha {
  return {
    clave: String(raw.clave ?? ""),
    titulo: texto(raw.titulo, 300),
    area_codigo: texto(raw.area_codigo ?? raw.area, 4).toUpperCase(),
    tipo_codigo: texto(raw.tipo_codigo ?? raw.tipo, 2).toUpperCase(),
    origen: raw.origen === "externo" ? "externo" : "interno",
    proceso: texto(raw.proceso, 200) || null,
    confidencialidad: String(raw.confidencialidad || "uso_interno"),
    palabras_clave: normalizarPalabras(raw.palabras_clave),
    propietario_id: idONull(raw.propietario_id),
  };
}

export async function validarFicha(s: Session, d: DatosFicha, excluirId = 0, a?: AccesoSgc): Promise<DatosFicha> {
  if (!d.titulo) throw new HttpError(400, { message: "Indica el título completo del documento", campo: "titulo" });
  const { areas, tipos } = await catalogos(s);
  if (!areas.some((x) => x.codigo === d.area_codigo && Number(x.activo))) throw new HttpError(400, { message: "Elige el área de gestión", campo: "area" });
  if (!tipos.some((x) => x.codigo === d.tipo_codigo && Number(x.activo))) throw new HttpError(400, { message: "Elige el tipo documental", campo: "tipo" });
  if (!esConfidencialidad(d.confidencialidad)) throw new HttpError(400, { message: "Elige el nivel de confidencialidad", campo: "confidencialidad" });
  // Externos (Fase 3): identificador propio del emisor (NMX, NOM, metodo oficial), sin formato FX.
  const r = d.origen === "externo" ? validarIdentificadorExterno(d.clave) : validarClave(d.clave, d.area_codigo, d.tipo_codigo);
  if (r.problema) throw new HttpError(400, { message: r.problema, campo: "clave" });
  const repetida = await s.queryOne<Row>("SELECT id, titulo FROM sgc_documentos WHERE clave = :clave AND id <> :id", { clave: r.clave, id: excluirId });
  if (repetida) {
    // El titulo solo se dice si la persona puede ver ese documento (un confidencial no se revela).
    const visible = a ? await documentoVisible(s, a, Number(repetida.id)).then(() => true, () => false) : false;
    throw new HttpError(409, { message: `Ya existe un documento con la clave ${r.clave}${visible ? ` («${repetida.titulo}»)` : ""}: ${d.origen === "externo" ? "el identificador es único" : "la clave FX es única"}`, campo: "clave", codigo: "clave_repetida" });
  }
  if (d.propietario_id && !(await s.queryOne<Row>("SELECT id FROM usuarios WHERE id = :id AND COALESCE(activo, 1) = 1", { id: d.propietario_id }))) throw new HttpError(400, { message: "Elige un propietario válido", campo: "propietario" });
  return { ...d, clave: r.clave };
}

export interface Responsables {
  elaborador_id: number | null;
  revisor_id: number | null;
  autorizador_id: number | null;
}

/* Cada responsable debe tener la accion documental de su papel; los tres deben ser personas distintas. */
export async function validarResponsables(s: Session, r: Responsables): Promise<void> {
  const gente = await personas(s);
  const reglas: Array<[keyof Responsables, AccionDocumental, string]> = [
    ["elaborador_id", "documento_elaborar", "elaborador"],
    ["revisor_id", "documento_revisar", "revisor"],
    ["autorizador_id", "documento_autorizar", "autorizador"],
  ];
  for (const [campo, accion, papel] of reglas) {
    const id = r[campo];
    if (!id) continue;
    const p = gente.find((x) => x.id === id);
    if (!p) throw new HttpError(400, { message: `El ${papel} debe ser una persona con cuenta activa`, campo: papel });
    if (!p.acciones.includes(accion)) throw new HttpError(400, { message: `${p.nombre} no tiene permiso para actuar como ${papel} (${accion})`, campo: papel });
  }
  const violacion = evaluarTresPersonas(r);
  if (violacion) throw new HttpError(400, { message: violacion.mensaje, campo: "responsables", codigo: "segregacion", regla: violacion.regla, clave: violacion.clave });
}

/* ---------- Archivos ---------- */

interface Subida {
  campos: Record<string, unknown>;
  archivos: Array<{ tipo: TipoArchivoSgc; nombre_original: string; extension: string; bytes: Buffer }>;
}

/* Multipart con datos y archivos: "archivo_pdf" y "archivo_fuente" (o "archivo" con "tipo"). */
async function leerSubida(request: Request, requerido: boolean): Promise<Subida> {
  const cfg = getConfig();
  const limite = cfg.DOCUMENTOS_MAX_MB * 1024 * 1024;
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("multipart/form-data")) throw new HttpError(400, { message: "Envía los datos como multipart/form-data" });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, { message: "No se pudieron leer los datos enviados" });
  }
  const campos: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") campos[k] = v;
  const entradas: Array<[TipoArchivoSgc, FormDataEntryValue | null]> = [
    ["pdf", form.get("archivo_pdf")],
    ["fuente", form.get("archivo_fuente")],
  ];
  const suelto = form.get("archivo");
  if (suelto) {
    if (!esTipoArchivo(campos.tipo)) throw new HttpError(400, { message: "Indica si el archivo es el PDF de consulta o el archivo fuente", campo: "tipo" });
    entradas.push([campos.tipo, suelto]);
  }
  const archivos: Subida["archivos"] = [];
  for (const [tipo, valor] of entradas) {
    if (!(valor instanceof File) || !valor.name || !valor.size) continue;
    const ok = await validarArchivoSubido(valor, { limiteBytes: limite, limiteMb: cfg.DOCUMENTOS_MAX_MB, extensiones: extensionesDe(tipo) });
    archivos.push({ tipo, ...ok });
  }
  if (requerido && !archivos.length) throw new HttpError(400, { message: "Elige el archivo (el PDF de consulta o el archivo fuente)", campo: "archivo" });
  return { campos, archivos };
}

async function guardarArchivos(s: Session, docId: number, revId: number, archivos: Subida["archivos"], por: number, guardados: ArchivoGuardado[]): Promise<Row[]> {
  const out: Row[] = [];
  for (const f of archivos) {
    const g = await guardarArchivoEn(sgcDir(), path.join(/*turbopackIgnore: true*/ String(docId), String(revId)), f.extension, f.bytes);
    guardados.push(g);
    const relativo = path.relative(/*turbopackIgnore: true*/ sgcDir(), g.ruta).split(path.sep).join("/");
    const anterior = await s.queryOne<Row>("SELECT id, nombre_original, sha256 FROM sgc_archivos WHERE revision_id = :r AND tipo = :t AND reemplazado_en IS NULL", { r: revId, t: f.tipo });
    if (anterior) await s.execute("UPDATE sgc_archivos SET reemplazado_en = :en, reemplazado_por = :por WHERE id = :id", { en: ahora(), por, id: anterior.id });
    const r = await s.execute(
      `INSERT INTO sgc_archivos (revision_id, tipo, nombre_original, nombre_almacenado, extension, mime, tamano_bytes, sha256, subido_por, subido_en)
       VALUES (:rev, :tipo, :orig, :alm, :ext, :mime, :tam, :sha, :por, :en)`,
      { rev: revId, tipo: f.tipo, orig: f.nombre_original, alm: relativo, ext: f.extension, mime: MIME_SGC[f.extension] || "application/octet-stream", tam: g.tamano_bytes, sha: g.sha256, por, en: ahora() },
    );
    out.push({ id: Number(r.lastrowid), tipo: f.tipo, nombre: f.nombre_original, tamano_bytes: g.tamano_bytes, sha256: g.sha256, sustituye: anterior ? { id: Number(anterior.id), nombre: anterior.nombre_original, sha256: anterior.sha256 } : null });
  }
  return out;
}

/* ---------- Escritura: ficha ---------- */

export function exigir(a: AccesoSgc, accion: AccionDocumental, mensaje: string): void {
  if (!tiene(a, accion)) throw new HttpError(403, { message: mensaje, codigo: "sin_permiso", required: { module: "documentos", action: accion } });
}

export const fichaVisible = (d: DatosFicha | Row) => ({
  clave: d.clave,
  titulo: d.titulo,
  area: d.area_codigo,
  tipo: d.tipo_codigo,
  origen: d.origen,
  proceso: d.proceso || null,
  confidencialidad: etiquetaConfidencialidad(d.confidencialidad),
  palabras_clave: (Array.isArray(d.palabras_clave) ? d.palabras_clave : palabrasDe(d as Row)).join(", ") || null,
  propietario_id: d.propietario_id ?? null,
});

export async function crearDocumento({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  exigir(a, "documento_crear_ficha", "Solo Mejora Continua crea fichas de documentos (documento_crear_ficha)");
  const { campos, archivos } = await leerSubida(request, true);
  if (campos.origen === "externo") throw new HttpError(400, { message: "Los documentos externos se registran en «Documentos externos»", campo: "origen" });
  const d = await validarFicha(s, datosFicha(campos), 0, a);
  const numero = campos.numero === undefined || campos.numero === "" ? 1 : Number(campos.numero);
  if (!Number.isInteger(numero) || numero < 0 || numero > 999) throw new HttpError(400, { message: "La revisión inicial debe ser un número entero (0 a 999)", campo: "numero" });
  const resp: Responsables = { elaborador_id: idONull(campos.elaborador_id), revisor_id: idONull(campos.revisor_id), autorizador_id: idONull(campos.autorizador_id) };
  await validarResponsables(s, resp);
  const guardados: ArchivoGuardado[] = [];
  try {
    const en = ahora();
    const r = await s.execute(
      `INSERT INTO sgc_documentos (clave, titulo, area_codigo, tipo_codigo, origen, proceso, confidencialidad, palabras_clave, propietario_id, estado, creado_por, creado_en, actualizado_por, actualizado_en)
       VALUES (:clave, :titulo, :area_codigo, :tipo_codigo, :origen, :proceso, :confidencialidad, :palabras, :propietario_id, 'en_elaboracion', :por, :en, :por, :en)`,
      { ...d, palabras: JSON.stringify(d.palabras_clave), por: a.yo, en },
    );
    const docId = Number(r.lastrowid);
    const rv = await s.execute(
      `INSERT INTO sgc_revisiones (documento_id, numero, estado, motivo_cambio, apartados_afectados, descripcion_cambio, elaborador_id, revisor_id, autorizador_id, origen_registro, creado_por, creado_en)
       VALUES (:doc, :numero, 'borrador', :motivo, :apartados, :descripcion, :elaborador_id, :revisor_id, :autorizador_id, 'flujo', :por, :en)`,
      { doc: docId, numero, motivo: textoLargo(campos.motivo_cambio) || "Emisión inicial", apartados: textoLargo(campos.apartados_afectados), descripcion: textoLargo(campos.descripcion_cambio), ...resp, por: a.yo, en },
    );
    const revId = Number(rv.lastrowid);
    const subidos = await guardarArchivos(s, docId, revId, archivos, a.yo, guardados);
    await registrarSolicitudDeFicha(s, a, { id: docId, area_codigo: d.area_codigo, tipo_codigo: d.tipo_codigo, titulo: d.titulo, clave: d.clave }, revId);
    await registrarAuditoria(s, user, { accion: "crear", entidad: ENTIDAD, entidadId: docId, referencia: d.clave, despues: fichaVisible(d), detalle: { revision: numero, revision_id: revId, estado: "borrador", archivos: subidos, ...resp } });
    await s.commit();
    return json({ message: `Ficha ${d.clave} creada con la revisión ${numero} en borrador`, id: docId, revision_id: revId }, 201);
  } catch (error) {
    await s.rollback();
    for (const g of guardados) await descartarArchivo(g);
    throw error;
  }
}

export async function editarDocumento({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const { doc } = await documentoVisible(s, a, intParam(params.id));
  exigir(a, "documento_crear_ficha", "Solo Mejora Continua edita los metadatos de la ficha (documento_crear_ficha)");
  if (doc.estado === "obsoleto") throw new HttpError(409, { message: "El documento está obsoleto: su ficha ya no se modifica" });
  const raw = await readJson(request);
  const motivo = String(raw.motivo || "").trim();
  if (motivo.length < MOTIVO_MIN_SGC) throw new HttpError(400, { message: `Indica el motivo del cambio (al menos ${MOTIVO_MIN_SGC} caracteres)`, campo: "motivo" });
  // El origen no cambia al editar: un externo sigue siendo externo (y uno interno, interno).
  const d = await validarFicha(s, { ...datosFicha(raw), origen: doc.origen === "externo" ? "externo" : "interno" }, Number(doc.id), a);
  // Un externo siempre tiene responsable de seguimiento (su propietario): no se deja vacío.
  if (doc.origen === "externo" && !d.propietario_id) throw new HttpError(400, { message: "Un documento externo necesita responsable de seguimiento", campo: "propietario_id" });
  // Con revision vigente, el area y el tipo ya forman parte de la clave publicada: siguen la regla de la clave.
  const antes = fichaVisible(doc);
  await s.execute(
    `UPDATE sgc_documentos SET clave = :clave, titulo = :titulo, area_codigo = :area_codigo, tipo_codigo = :tipo_codigo, origen = :origen, proceso = :proceso,
       confidencialidad = :confidencialidad, palabras_clave = :palabras, propietario_id = :propietario_id, actualizado_por = :por, actualizado_en = :en WHERE id = :id`,
    { ...d, palabras: JSON.stringify(d.palabras_clave), por: a.yo, en: ahora(), id: doc.id },
  );
  // Externo: el propietario es su responsable de seguimiento (se mantienen iguales).
  if (doc.origen === "externo" && d.propietario_id) await s.execute("UPDATE sgc_externos SET responsable_id = :r, actualizado_en = :en WHERE documento_id = :id", { r: d.propietario_id, en: ahora(), id: doc.id });
  await registrarAuditoria(s, user, { accion: "editar", entidad: ENTIDAD, entidadId: Number(doc.id), referencia: d.clave, motivo, antes, despues: fichaVisible(d) });
  await s.commit();
  return json({ message: "Metadatos actualizados" });
}

/* ---------- Escritura: revisiones ---------- */

/*
 * Nueva revision directa de Mejora Continua: desde la Fase 2 queda registrada
 * como una solicitud propia aceptada en el mismo paso (con los tres responsables).
 */
export async function nuevaRevision({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  exigir(a, "documento_crear_ficha", "Solo Mejora Continua abre revisiones nuevas (documento_crear_ficha)");
  const raw = await readJson(request);
  const r = await solicitudPropiaAceptada(s, user, a, request, intParam(params.id), raw);
  await s.commit();
  return json({ message: r.message.replace(/^Solicitud aceptada: r/, "R"), revision_id: r.revision_id, numero: r.numero }, 201);
}

/* Revision con su documento, visible para la persona (404 si no). */
export async function revisionVisible(s: Session, a: AccesoSgc, revId: number): Promise<{ doc: Row; rev: Row; revisiones: Row[]; archivos: Row[] }> {
  const rev0 = Number.isInteger(revId) && revId > 0 ? await s.queryOne<Row>("SELECT documento_id FROM sgc_revisiones WHERE id = :id", { id: revId }) : null;
  if (!rev0) throw new HttpError(404, { message: "Revisión no encontrada" });
  const { doc, revisiones, vista } = await documentoVisible(s, a, Number(rev0.documento_id));
  const rev = revisiones.find((r) => Number(r.id) === revId);
  if (!rev || !vista.revisiones.has(revId)) throw new HttpError(404, { message: "Revisión no encontrada" });
  const archivos = await s.query<Row>("SELECT * FROM sgc_archivos WHERE revision_id = :id", { id: revId });
  return { doc, rev, revisiones, archivos };
}

export const fechaONull = (v: unknown, campo: string): string | null => {
  const t = String(v ?? "").trim();
  if (!t) return null;
  if (!FECHA.test(t)) throw new HttpError(400, { message: "Escribe la fecha como AAAA-MM-DD", campo });
  // Una fecha real (2025-02-30 no existe), como en el resto de la plataforma.
  if (!fechaValida(t)) throw new HttpError(400, { message: "La fecha no existe en el calendario", campo });
  return t;
};

const datosRevisionVisibles = (r: Row) => ({
  motivo_cambio: r.motivo_cambio || null,
  apartados_afectados: r.apartados_afectados || null,
  descripcion_cambio: r.descripcion_cambio || null,
  fecha_emision: r.fecha_emision || null,
  fecha_vigencia: r.fecha_vigencia || null,
  fecha_proxima_revision: r.fecha_proxima_revision || null,
  ubicacion_historica: r.ubicacion_historica || null,
  regla_conservacion: r.regla_conservacion || null,
  elaborador_id: r.elaborador_id ?? null,
  revisor_id: r.revisor_id ?? null,
  autorizador_id: r.autorizador_id ?? null,
});

export async function editarRevision({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const { doc, rev, revisiones, archivos } = await revisionVisible(s, a, intParam(params.rid));
  const puede = puedeRevision(a, doc, rev, archivos, revisiones);
  if (rev.estado !== "borrador") throw new HttpError(409, { message: "La revisión ya no está en borrador: sus datos no se modifican", codigo: "no_borrador" });
  if (!puede.editar.ok) throw new HttpError(403, { message: "Solo Mejora Continua o el elaborador asignado modifican esta revisión", codigo: "sin_permiso" });
  const raw = await readJson(request);
  const antes = datosRevisionVisibles(rev);
  const nuevo: Row = { ...rev };
  for (const c of ["motivo_cambio", "apartados_afectados", "descripcion_cambio", "ubicacion_historica", "regla_conservacion"]) if (raw[c] !== undefined) nuevo[c] = textoLargo(raw[c]);
  for (const c of ["fecha_emision", "fecha_vigencia", "fecha_proxima_revision"]) if (raw[c] !== undefined) nuevo[c] = fechaONull(raw[c], c);
  const asigna = ["elaborador_id", "revisor_id", "autorizador_id"].some((c) => raw[c] !== undefined && idONull(raw[c]) !== (rev[c] ? Number(rev[c]) : null));
  if (asigna) {
    if (!puede.asignar.ok) throw new HttpError(403, { message: "Solo Mejora Continua asigna elaborador, revisor y autorizador", codigo: "sin_permiso" });
    for (const c of ["elaborador_id", "revisor_id", "autorizador_id"]) if (raw[c] !== undefined) nuevo[c] = idONull(raw[c]);
    await validarResponsables(s, { elaborador_id: nuevo.elaborador_id ?? null, revisor_id: nuevo.revisor_id ?? null, autorizador_id: nuevo.autorizador_id ?? null });
  }
  const motivo = String(raw.motivo || "").trim() || null;
  await s.execute(
    `UPDATE sgc_revisiones SET motivo_cambio = :motivo_cambio, apartados_afectados = :apartados_afectados, descripcion_cambio = :descripcion_cambio, fecha_emision = :fecha_emision,
       fecha_vigencia = :fecha_vigencia, fecha_proxima_revision = :fecha_proxima_revision, ubicacion_historica = :ubicacion_historica, regla_conservacion = :regla_conservacion,
       elaborador_id = :elaborador_id, revisor_id = :revisor_id, autorizador_id = :autorizador_id, actualizado_por = :por, actualizado_en = :en WHERE id = :id AND estado = 'borrador'`,
    { ...datosRevisionVisibles(nuevo), por: a.yo, en: ahora(), id: rev.id },
  ).then((r) => {
    if (!r.rowcount) throw new HttpError(409, { message: "La revisión ya no está en borrador: sus datos no se modifican", codigo: "no_borrador" });
  });
  await registrarAuditoria(s, user, { accion: "editar", entidad: ENTIDAD, entidadId: Number(doc.id), referencia: `${referenciaDe(doc)} rev. ${rev.numero}`, motivo, antes, despues: datosRevisionVisibles(nuevo), detalle: { revision: Number(rev.numero), revision_id: Number(rev.id) } });
  await s.commit();
  return json({ message: `Revisión ${rev.numero} actualizada` });
}

export async function subirArchivo({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const { doc, rev, revisiones, archivos } = await revisionVisible(s, a, intParam(params.rid));
  const puede = puedeRevision(a, doc, rev, archivos, revisiones).subir_archivo;
  if (rev.estado !== "borrador") throw new HttpError(409, { message: "La revisión ya se envió a revisión: su archivo no se puede cambiar; para cambiarlo debe devolverse a borrador", codigo: "archivo_bloqueado" });
  if (!puede.ok) throw new HttpError(403, { message: puede.motivo || "No tienes permiso para cargar archivos de documentos (documento_elaborar)", codigo: "sin_permiso" });
  const { archivos: nuevos } = await leerSubida(request, true);
  const guardados: ArchivoGuardado[] = [];
  try {
    const subidos = await guardarArchivos(s, Number(doc.id), Number(rev.id), nuevos, a.yo, guardados);
    await s.execute("UPDATE sgc_revisiones SET actualizado_por = :por, actualizado_en = :en WHERE id = :id", { por: a.yo, en: ahora(), id: rev.id });
    await registrarAuditoria(s, user, { accion: subidos.some((x) => x.sustituye) ? "sustituir" : "subir", entidad: ENTIDAD, entidadId: Number(doc.id), referencia: `${referenciaDe(doc)} rev. ${rev.numero}`, detalle: { revision: Number(rev.numero), revision_id: Number(rev.id), archivos: subidos } });
    await s.commit();
    return json({ message: subidos.some((x) => x.sustituye) ? "Archivo sustituido; el anterior se conserva" : "Archivo cargado", archivos: subidos }, 201);
  } catch (error) {
    await s.rollback();
    for (const g of guardados) await descartarArchivo(g);
    throw error;
  }
}

export async function enviarRevision({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const { doc, rev, revisiones, archivos } = await revisionVisible(s, a, intParam(params.rid));
  const puede = puedeRevision(a, doc, rev, archivos, revisiones).enviar_revision;
  if (rev.estado !== "borrador") throw new HttpError(409, { message: "La revisión ya no está en borrador", codigo: "no_borrador" });
  if (!puede.ok) throw new HttpError(puede.motivo && tiene(a, "documento_enviar_revision") ? 409 : 403, { message: puede.motivo || "No tienes permiso para enviar documentos a revisión (documento_enviar_revision)", codigo: puede.motivo ? "incompleta" : "sin_permiso" });
  if (!String(rev.motivo_cambio || "").trim()) throw new HttpError(409, { message: "Describe el motivo del cambio antes de enviarla", campo: "motivo_cambio" });
  await validarResponsables(s, { elaborador_id: rev.elaborador_id ?? null, revisor_id: rev.revisor_id ?? null, autorizador_id: rev.autorizador_id ?? null });
  await exigirSinOtroPapel(s, Number(rev.id), a.yo, "elaborador");
  const raw = await readJson(request).catch(() => ({}) as Record<string, unknown>);
  const comentario = textoLargo((raw as Record<string, unknown>).comentario, 2000);
  const en = ahora();
  const r = await s.execute("UPDATE sgc_revisiones SET estado = 'en_revision', enviada_revision_en = :en, enviada_revision_por = :por, actualizado_por = :por, actualizado_en = :en WHERE id = :id AND estado = 'borrador'", { en, por: a.yo, id: rev.id });
  if (!r.rowcount) throw new HttpError(409, { message: "Otra persona cambió la revisión al mismo tiempo; recarga la página" });
  const permisoEnvio = permisoDe(a.auth, "documentos", "documento_enviar_revision");
  await s.execute("INSERT INTO sgc_flujo_acciones (revision_id, accion, decision, comentario, usuario_id, cargo, papel, fecha) VALUES (:rev, 'enviar_revision', NULL, :comentario, :por, :cargo, 'elaborador', :en)", { rev: rev.id, comentario, por: a.yo, cargo: permisoEnvio ? cargoActuante(request, permisoEnvio).cargo : null, en });
  const pdf = archivos.find((f) => f.tipo === "pdf" && !f.reemplazado_en);
  await registrarAuditoria(s, user, { accion: "enviar_revision", entidad: ENTIDAD, entidadId: Number(doc.id), referencia: `${referenciaDe(doc)} rev. ${rev.numero}`, motivo: comentario, antes: { estado: "borrador" }, despues: { estado: "en_revision" }, detalle: { revision: Number(rev.numero), revision_id: Number(rev.id), pdf: pdf ? { nombre: pdf.nombre_original, sha256: pdf.sha256 } : null, revisor_id: rev.revisor_id } });
  await s.commit();
  return json({ message: `Revisión ${rev.numero} enviada a revisión; sus archivos quedan bloqueados` });
}

/*
 * Carga inicial: registra como vigente la primera revision de un documento que
 * ya estaba autorizado fuera de la plataforma (Lista Maestra en papel o en la
 * carpeta institucional). Solo Mejora Continua (documento_publicar), con
 * contrasena, con PDF, fecha de emision y los tres responsables. Las
 * revisiones siguientes pasan por el flujo de aprobacion (Fase 2).
 */
export async function registrarVigente({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const { doc, rev, revisiones, archivos } = await revisionVisible(s, a, intParam(params.rid));
  exigir(a, "documento_publicar", "Solo Mejora Continua registra revisiones vigentes (documento_publicar)");
  const puede = puedeRevision(a, doc, rev, archivos, revisiones).registrar_vigente;
  if (!puede.ok) throw new HttpError(409, { message: puede.motivo || "La carga inicial solo aplica a la primera revisión de un documento que nunca tuvo vigente; las siguientes pasan por el flujo de aprobación", codigo: "no_aplica" });
  const raw = await readJson(request);
  const fechaEmision = fechaONull(raw.fecha_emision, "fecha_emision");
  if (!fechaEmision) throw new HttpError(400, { message: "Indica la fecha de emisión autorizada", campo: "fecha_emision" });
  const fechaVigencia = fechaONull(raw.fecha_vigencia, "fecha_vigencia") || fechaEmision;
  // Como al publicar: sin fecha, emisión + 3 años (sin ella el documento nunca quedaría pendiente de revisión).
  const proxima = fechaONull(raw.fecha_proxima_revision, "fecha_proxima_revision") || sumarAnios(fechaEmision, ANIOS_PROXIMA_REVISION);
  if (proxima <= fechaVigencia) throw new HttpError(400, { message: "La próxima revisión debe ser posterior a la fecha de vigencia", campo: "fecha_proxima_revision" });
  await validarResponsables(s, { elaborador_id: rev.elaborador_id ?? null, revisor_id: rev.revisor_id ?? null, autorizador_id: rev.autorizador_id ?? null });
  await exigirReauth(s, request, user, "documentos:publicar");
  const permiso = permisoDe(a.auth, "documentos", "documento_publicar");
  const cargo = permiso ? cargoActuante(request, permiso).cargo : null;
  const en = ahora();
  const r = await s.execute(
    `UPDATE sgc_revisiones SET estado = 'vigente', fecha_emision = :emision, fecha_vigencia = :vigencia, fecha_proxima_revision = :proxima, publicada_en = :en, publicada_por = :por,
       origen_registro = 'carga_inicial', actualizado_por = :por, actualizado_en = :en WHERE id = :id AND estado IN ('borrador', 'en_revision')`,
    { emision: fechaEmision, vigencia: fechaVigencia, proxima, en, por: a.yo, id: rev.id },
  );
  if (!r.rowcount) throw new HttpError(409, { message: "Otra persona cambió la revisión al mismo tiempo; recarga la página" });
  await s.execute("UPDATE sgc_documentos SET estado = 'vigente', revision_vigente_id = :rev, actualizado_por = :por, actualizado_en = :en WHERE id = :id", { rev: rev.id, por: a.yo, en, id: doc.id });
  await s.execute("INSERT INTO sgc_flujo_acciones (revision_id, accion, decision, comentario, usuario_id, cargo, fecha) VALUES (:rev, 'registrar_vigente', 'carga_inicial', :comentario, :por, :cargo, :en)", { rev: rev.id, comentario: textoLargo(raw.comentario, 2000), por: a.yo, cargo, en });
  const pdf = archivos.find((f) => f.tipo === "pdf" && !f.reemplazado_en);
  await registrarAuditoria(s, user, {
    accion: "publicar",
    entidad: ENTIDAD,
    entidadId: Number(doc.id),
    referencia: `${referenciaDe(doc)} rev. ${rev.numero}`,
    motivo: textoLargo(raw.comentario, 2000),
    antes: { estado: String(rev.estado) },
    despues: { estado: "vigente", fecha_emision: fechaEmision, fecha_vigencia: fechaVigencia, fecha_proxima_revision: proxima },
    detalle: { carga_inicial: true, revision: Number(rev.numero), revision_id: Number(rev.id), elaborador_id: rev.elaborador_id, revisor_id: rev.revisor_id, autorizador_id: rev.autorizador_id, pdf: pdf ? { nombre: pdf.nombre_original, sha256: pdf.sha256 } : null, ...(cargo ? { actuo_como: { cargo } } : {}) },
  });
  await s.commit();
  return json({ message: `Revisión ${rev.numero} registrada como vigente (carga inicial)` });
}

/* ---------- Archivos: ver y descargar ---------- */

/* Ultima consulta registrada por persona y archivo (en memoria): una apertura del visor pide varios rangos. */
const consultas = new Map<string, number>();
const VENTANA_CONSULTA_MS = 120_000;
function consultaNueva(usuario: number, archivo: number): boolean {
  const clave = `${usuario}:${archivo}`;
  const ahoraMs = Date.now();
  const previa = consultas.get(clave);
  if (previa && ahoraMs - previa < VENTANA_CONSULTA_MS) return false;
  consultas.set(clave, ahoraMs);
  if (consultas.size > 5000) for (const [k, t] of consultas) if (ahoraMs - t > VENTANA_CONSULTA_MS) consultas.delete(k);
  return true;
}

export async function archivoSgc({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  const id = intParam(params.aid);
  const f = Number.isInteger(id) && id > 0 ? await s.queryOne<Row>("SELECT * FROM sgc_archivos WHERE id = :id", { id }) : null;
  if (!f) throw new HttpError(404, { message: "Archivo no encontrado" });
  const rev0 = await s.queryOne<Row>("SELECT documento_id FROM sgc_revisiones WHERE id = :id", { id: f.revision_id });
  if (!rev0) throw new HttpError(404, { message: "Archivo no encontrado" });
  const { doc, revisiones, vista } = await documentoVisible(s, a, Number(rev0.documento_id));
  const rev = revisiones.find((r) => Number(r.id) === Number(f.revision_id))!;
  if (!vista.archivos.has(Number(rev.id))) {
    if (vista.revisiones.has(Number(rev.id)) && a.diagnostico) throw new HttpError(403, { message: "La administración técnica consulta los metadatos para diagnóstico, pero no abre los archivos de los documentos", codigo: "solo_metadatos" });
    throw new HttpError(404, { message: "Archivo no encontrado" });
  }
  const descargar = new URL(request.url).searchParams.get("modo") === "descargar";
  const ruta = rutaEn(sgcDir(), f.nombre_almacenado);
  const rango = !descargar ? /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") || "") : null;
  // Con carga progresiva el visor pide varios rangos: el SHA-256 se verifica (y la consulta se registra) solo en el primero.
  const primeraLectura = !rango || rango[1] === "0" || (!rango[1] && !rango[2]);
  const integridad = descargar || primeraLectura ? await integridadArchivo(ruta, f.sha256) : { estado: fs.existsSync(ruta) ? ("ok" as const) : ("faltante" as const), bytes: null, sha256: null };
  const referencia = `${referenciaDe(doc)} rev. ${rev.numero}`;
  const detalle = { revision: Number(rev.numero), revision_id: Number(rev.id), archivo_id: Number(f.id), tipo: String(f.tipo), nombre: String(f.nombre_original) };
  if (integridad.estado !== "ok") {
    await registrarAuditoria(s, user, { accion: "alerta_integridad", entidad: ENTIDAD, entidadId: Number(doc.id), referencia, detalle: { ...detalle, integridad: integridad.estado, esperado: f.sha256, obtenido: integridad.sha256 } });
    await incidenciaPorAlertaIntegridad(s, { clave: `sgc:${f.id}:${integridad.estado}`, descripcion: `El archivo "${String(f.nombre_original)}" de ${referencia} ${integridad.estado === "faltante" ? "no está en el servidor" : "no coincide con su huella SHA-256"} (alerta de integridad).`, registros: [{ entidad: ENTIDAD, entidad_id: Number(doc.id), referencia }] });
  }
  if (integridad.estado === "faltante") {
    await s.commit();
    return new Response(JSON.stringify({ message: "El archivo no está en el servidor; se registró una alerta de integridad", codigo: "archivo_faltante" }), { status: 404, headers: { "Content-Type": "application/json", "X-Integridad-Archivo": "faltante" } });
  }
  // La descarga siempre queda en la bitacora; abrir en el visor, solo si el documento es restringido o confidencial.
  const confidencial = String(doc.confidencialidad) !== "uso_interno";
  if (descargar) await registrarAuditoria(s, user, { accion: "descargar", entidad: ENTIDAD, entidadId: Number(doc.id), referencia, detalle });
  // Cualquier lectura (con o sin rango) de un restringido o confidencial se registra; las del visor en los 2 minutos siguientes cuentan como la misma apertura.
  else if (confidencial && consultaNueva(a.yo, Number(f.id))) await registrarAuditoria(s, user, { accion: "consultar", entidad: ENTIDAD, entidadId: Number(doc.id), referencia, detalle: { ...detalle, confidencialidad: String(doc.confidencialidad) } });
  // Lectura controlada (Fase 3): la primera apertura del PDF vigente por un destinatario queda registrada; el acuse la exige.
  if (!descargar && primeraLectura && f.tipo === "pdf" && rev.estado === "vigente" && a.destinatarioDe.has(Number(rev.id))) {
    const r = await s.execute("UPDATE sgc_lecturas SET abierto_en = :en WHERE revision_id = :rev AND usuario_id = :u AND abierto_en IS NULL", { en: ahora(), rev: rev.id, u: a.yo });
    if (!r.rowcount && !(await s.queryOne<Row>("SELECT id FROM sgc_lecturas WHERE revision_id = :rev AND usuario_id = :u", { rev: rev.id, u: a.yo }))) await s.execute("INSERT INTO sgc_lecturas (revision_id, usuario_id, abierto_en, estado) VALUES (:rev, :u, :en, 'pendiente')", { rev: rev.id, u: a.yo, en: ahora() });
  }
  await s.commit();
  const bytes = integridad.bytes || (await fs.promises.readFile(ruta));
  const encabezados: Record<string, string> = {
    "Content-Type": MIME_SGC[String(f.extension)] || "application/octet-stream",
    "Content-Disposition": contentDisposition(descargar ? "attachment" : "inline", String(f.nombre_original)),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, no-store",
    "X-Archivo-Sha256": String(f.sha256),
    "X-Integridad-Archivo": integridad.estado,
    "Accept-Ranges": "bytes",
  };
  if (rango && (rango[1] || rango[2])) {
    const total = bytes.length;
    let inicio = rango[1] ? Number(rango[1]) : Math.max(0, total - Number(rango[2]));
    const fin = Math.min(rango[1] && rango[2] ? Number(rango[2]) : total - 1, total - 1);
    if (inicio > fin || inicio >= total) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    inicio = Math.max(0, inicio);
    return new Response(new Uint8Array(bytes.subarray(inicio, fin + 1)), { status: 206, headers: { ...encabezados, "Content-Range": `bytes ${inicio}-${fin}/${total}`, "Content-Length": String(fin - inicio + 1) } });
  }
  return new Response(new Uint8Array(bytes), { status: 200, headers: { ...encabezados, "Content-Length": String(bytes.length) } });
}
