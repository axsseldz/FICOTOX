/*
 * Índice de búsqueda de una persona. NO consulta las tablas por su cuenta: cada
 * fuente se obtiene llamando al mismo manejador que sirve la lista de esa
 * pantalla (con las cabeceras de la petición), así los permisos y alcances
 * (asignado, propio, autorizados, supervisado, incidencias…) son exactamente
 * los de las listas y no hay una segunda copia de las reglas. Lo que la
 * persona no puede ver responde 403/404 y esa fuente queda vacía.
 *
 * El índice se guarda en memoria por persona unos segundos y se descarta en
 * cuanto cualquier escritura de la API lo invalida (ver version.ts).
 *
 * Para agregar un nuevo tipo de resultado: una función `fuente…` abajo que
 * llame al manejador de su lista y devuelva `Hit[]`, y registrarla en
 * `construirIndice`. El `grupo` decide en qué encabezado aparece.
 */
import { formatearFolio } from "../../shared/folios";
import { ESTADOS_INCIDENCIA, ESTADOS_NC, folioNc } from "../../shared/calidad";
import { norm, type Comando, type GrupoClave, type TipoResultado } from "../../shared/busqueda";
import { fmtDate } from "../../client/format";
import { formatReactivoName, getReactivoStockInfo } from "../../client/reactivos";
import { formatExtractionFolio, formatProcessingFolio, formatSampleFolio, sampleStatusLabel } from "../../client/samples";
import type { ApiRecord } from "../../client/types";
import { cargarAutorizacion, type Autorizacion } from "../rbac";
import { requireUser } from "../auth";
import { type Row, type Session } from "../db";
import type { RouteContext } from "../http";
import { pendientesDe } from "../pendientes";
import { listarDocumentos } from "../modules/sgc/documentos";
import { ESTADO_DOCUMENTO, ESTADO_REVISION, type EstadoDocumento, type EstadoRevision } from "../../shared/documentos";
import { listarAcciones, listarNc } from "../modules/calidad/nc";
import { listarIncidencias } from "../modules/calidad/incidencias";
import { getConsumables } from "../modules/consumables";
import { listUsuarios, listRoles } from "../modules/admin";
import { listEquipos, listMantenimientos, listMovimientos, listReactivos } from "../modules/inventory";
import { listInformes } from "../modules/informes";
import { listAnalyses } from "../modules/samples/analisis";
import { listExtractionSamples } from "../modules/samples/extraccion";
import { listProcessingSamples } from "../modules/samples/procesamiento";
import { listReceptionSamples } from "../modules/samples/recepcion";
import { listarSolicitudes } from "../solicitudes";
import { bandejaSupervision } from "../supervision";
import { catalogoVisible } from "./catalogo";
import { versionIndice } from "./version";

export interface Hit {
  clave: string;
  tipo: TipoResultado;
  grupo: GrupoClave;
  titulo: string;
  sub?: string;
  href: string;
  mono?: boolean;
  etiqueta?: string;
  comando?: Comando;
  /* Texto normalizado en el que se busca. */
  kw: string;
  /* Folio (prefijo en minúsculas sin guion y número) para coincidencias exactas. */
  folio?: { p: string; n: number };
  /* Claves (ID interno, clave de bitácora, lote…) sin espacios ni guiones: coincidencia exacta. */
  exactos?: string[];
  /* Lista a la que lleva "Ver todos en …" (ruta con su query, sin la búsqueda). */
  lista?: string;
  /* Orden en que llegó de su lista (lo más reciente primero). */
  orden: number;
  /* Lo que la persona debe atender (por autorizar, por supervisar, por revisar…). */
  pendiente?: boolean;
  /* Palabras sueltas de `kw` (se calculan al buscar). */
  tokens?: string[];
}

export interface Indice {
  hits: Hit[];
  /* Direcciones de lo que la persona tiene pendiente (misma fuente que el Inicio y la campana). */
  pendientes: Set<string>;
}

const TTL_MS = 20_000;
const cache = new Map<string, { at: number; version: number; indice: Indice }>();

const join = (...partes: unknown[]) => partes.filter((p) => p !== null && p !== undefined && String(p).trim() !== "").map(String).join(" · ");
const recortar = (texto: unknown, largo = 70) => {
  const t = String(texto || "").replace(/\s+/g, " ").trim();
  return t.length > largo ? `${t.slice(0, largo - 1)}…` : t;
};

/* "ácido domoico" → ASP, "lipofílicas" → DSP, "paralizantes" → PSP (los folios y listas usan las siglas). */
function conSiglas(texto: string): string {
  let out = texto;
  if (/acido[ _]domoico/.test(texto)) out += " asp";
  if (/lipofil/.test(texto)) out += " dsp";
  if (/paraliz/.test(texto)) out += " psp";
  return out;
}

/* Sin espacios ni guiones: "FX-THF 1" y "fxthf1" son lo mismo. */
export const compacto = (texto: string): string => norm(texto).replace(/[\s_-]+/g, "");

const FOLIO_ETIQUETA = /^(INC|NC|IR|E-A|E-D|R|P|A)\s*0*(\d+)/i;
function folioDe(titulo: string): Hit["folio"] {
  const m = FOLIO_ETIQUETA.exec(titulo);
  return m ? { p: m[1].toLowerCase().replace("-", ""), n: Number(m[2]) } : undefined;
}

let secuencia = 0;
function hit(base: Omit<Hit, "kw" | "orden" | "folio" | "exactos"> & { palabras: unknown[]; claves?: unknown[]; folio?: Hit["folio"] }): Hit {
  const { palabras, claves, ...resto } = base;
  const kw = conSiglas(norm(join(...palabras)));
  const exactos = (claves || []).filter(Boolean).map((c) => compacto(String(c)));
  return { ...resto, kw, exactos: exactos.length ? exactos : undefined, folio: base.folio ?? (base.mono ? folioDe(base.titulo) : undefined), orden: secuencia++ };
}

type Manejador = (ctx: RouteContext) => Promise<Response>;

async function leer(request: Request, s: Session, manejador: Manejador, ruta: string): Promise<ApiRecord | null> {
  try {
    const peticion = new Request(new URL(ruta, request.url), { method: "GET", headers: request.headers });
    const respuesta = await manejador({ request: peticion, params: {}, s });
    return respuesta.ok ? ((await respuesta.json()) as ApiRecord) : null;
  } catch {
    return null;
  }
}

const items = (datos: ApiRecord | null, clave = "items"): ApiRecord[] => (datos && Array.isArray(datos[clave]) ? (datos[clave] as ApiRecord[]) : []);

function jsonLista(valor: unknown): ApiRecord[] {
  try {
    const dato = typeof valor === "string" ? JSON.parse(valor) : valor;
    return Array.isArray(dato) ? (dato as ApiRecord[]) : [];
  } catch {
    return [];
  }
}

/* Organismo y sitio de muestreo de cada recepción/extracción visible (no vienen en la lista). */
async function organismosDe(s: Session, tabla: "muestras_recepcion" | "muestras_extraccion", ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!ids.length) return out;
  const columna = tabla === "muestras_recepcion" ? "lote_muestras_json" : "registro_pesos_json";
  const filas = await s.query<Row>(`SELECT id, ${columna} AS datos FROM ${tabla} WHERE id IN (${ids.map((_, i) => `:i${i}`).join(", ")})`, Object.fromEntries(ids.map((id, i) => [`i${i}`, id])));
  for (const fila of filas) {
    const textos = new Set<string>();
    for (const m of jsonLista(fila.datos)) for (const campo of [m.nombre_organismo, m.organismo, m.sitio_muestreo]) if (campo) textos.add(String(campo));
    if (textos.size) out.set(Number(fila.id), [...textos].join(" "));
  }
  return out;
}

async function fuenteMuestras(request: Request, s: Session): Promise<Hit[]> {
  const out: Hit[] = [];
  const [recepciones, procesamientos, extracciones, analisis] = [
    items(await leer(request, s, listReceptionSamples, "/api/samples/reception")),
    items(await leer(request, s, listProcessingSamples, "/api/samples/processing")),
    items(await leer(request, s, listExtractionSamples, "/api/samples/extraction")),
    items(await leer(request, s, listAnalyses, "/api/samples/analysis")),
  ];
  const orgR = await organismosDe(s, "muestras_recepcion", recepciones.map((r) => Number(r.id)));
  const orgE = await organismosDe(s, "muestras_extraccion", extracciones.map((r) => Number(r.id)));
  const ANALISIS_CORTO: Record<string, string> = { acido_domoico: "ASP", toxinas_lipofilicas: "DSP", toxinas_paralizantes: "PSP" };
  for (const r of recepciones) {
    const titulo = formatSampleFolio(r);
    const estado = r.estado ? sampleStatusLabel(r.estado) : null;
    const tipos = r.analisis && typeof r.analisis === "object" ? Object.entries(r.analisis as ApiRecord).filter(([, v]) => v && v !== "false").map(([k]) => k) : [];
    out.push(hit({ clave: `r-${r.id}`, tipo: "muestra", grupo: "muestras", titulo, sub: join(r.solicitante, r.id_interno, estado), href: `/muestras/recepcion/${r.id}`, mono: true, etiqueta: "Recepción", lista: "/muestras/recepcion", claves: [r.id_interno], palabras: [titulo, titulo.replace(/\s/g, ""), r.solicitante, r.recibido_por, r.id_interno, estado, orgR.get(Number(r.id)), tipos.join(" "), r.decision_aceptacion, "recepcion muestra"] }));
  }
  for (const p of procesamientos) {
    const titulo = formatProcessingFolio(p);
    const estado = p.estado ? sampleStatusLabel(p.estado) : null;
    out.push(hit({ clave: `p-${p.id}`, tipo: "muestra", grupo: "muestras", titulo, sub: join(p.id_interno, estado), href: `/muestras/procesamiento/${p.id}`, mono: true, etiqueta: "Procesamiento", lista: "/muestras/procesamiento", claves: [p.id_interno], palabras: [titulo, titulo.replace(/\s/g, ""), p.id_interno, estado, p.muestra_tipo, "procesamiento muestra molienda"] }));
  }
  for (const e of extracciones) {
    const titulo = formatExtractionFolio(e);
    const estado = e.estado ? sampleStatusLabel(e.estado) : null;
    const dsp = String(e.tipo_registro) === "E-D";
    out.push(hit({ clave: `e-${e.id}`, tipo: "muestra", grupo: "muestras", titulo, sub: join(e.id_interno, estado), href: `/muestras/extraccion/${e.id}`, mono: true, etiqueta: dsp ? "Extracción DSP" : "Extracción ASP", lista: "/muestras/extraccion", claves: [e.id_interno], palabras: [titulo, titulo.replace(/\s/g, ""), e.id_interno, estado, orgE.get(Number(e.id)), e.muestra_tipo, "extraccion muestra", dsp ? "dsp toxinas lipofilicas" : "asp acido domoico"] }));
  }
  for (const a of analisis) {
    const titulo = formatearFolio("A", a.folio_num || 0);
    const tipo = ANALISIS_CORTO[String(a.tipo_analisis)] || a.tipo_analisis;
    const estado = a.estado ? sampleStatusLabel(a.estado) : null;
    out.push(hit({ clave: `a-${a.id}`, tipo: "analisis", grupo: "muestras", titulo, sub: join(a.solicitante, a.recepcion_id_interno, tipo, estado), href: `/muestras/analisis/${a.id}`, mono: true, etiqueta: "Análisis", lista: "/muestras/analisis", palabras: [titulo, titulo.replace(/\s/g, ""), a.solicitante, a.recepcion_id_interno, a.tipo_analisis, tipo, estado, "analisis"] }));
  }
  return out;
}

const INFORME_ESTADO: Record<string, string> = { borrador: "Borrador", en_revision: "En revisión", autorizado: "Autorizado", liberado: "Liberado", enviado: "Enviado", entregado: "Enviado", sustituido: "Sustituido", anulado: "Anulado" };

async function fuenteInformes(request: Request, s: Session): Promise<Hit[]> {
  return items(await leer(request, s, listInformes, "/api/informes")).map((i) => {
    const titulo = String(i.folio || `${formatearFolio("IR", i.folio_num || 0)}${Number(i.version || 1) > 1 ? ` v${i.version}` : ""}`);
    const cliente = (i.cliente && typeof i.cliente === "object" ? (i.cliente as ApiRecord).nombre : null) || i.solicitante;
    const estado = INFORME_ESTADO[String(i.estado)] || null;
    return hit({ clave: `i-${i.id}`, tipo: "informe", grupo: "informes", titulo, sub: join(cliente, i.recepcion_id_interno, estado), href: `/informes/${i.id}`, mono: true, etiqueta: "Informe", lista: "/informes", palabras: [titulo, titulo.replace(/\s/g, ""), cliente, i.recepcion_id_interno, i.estado, estado, "informe"] });
  });
}

const MANT_TIPO: Record<string, string> = { preventivo: "Preventivo", correctivo: "Correctivo", calibracion: "Calibración", verificacion: "Verificación" };
const MANT_ESTADO: Record<string, string> = { programado: "Programado", en_proceso: "En proceso", completado: "Completado", vencido: "Vencido", cancelado: "Cancelado" };

async function fuenteInventario(request: Request, s: Session): Promise<Hit[]> {
  const out: Hit[] = [];
  const reactivos = items(await leer(request, s, listReactivos, "/api/inventory/reactivos"));
  const consumibles = items(await leer(request, s, getConsumables, "/api/consumables"));
  const equipos = items(await leer(request, s, listEquipos, "/api/inventory/equipos"));
  const mantenimientos = items(await leer(request, s, listMantenimientos, "/api/inventory/mantenimientos"));
  const movimientos = items(await leer(request, s, listMovimientos, "/api/inventory/movimientos"));
  for (const r of reactivos) {
    const nombre = formatReactivoName(r);
    const stock = getReactivoStockInfo(r);
    const existencia = stock.current !== null ? `${stock.current} ${stock.unit}`.trim() : null;
    out.push(hit({ clave: `re-${r.id}`, tipo: "reactivo", grupo: "inventario", titulo: nombre, sub: join(existencia, r.lote ? `Lote ${r.lote}` : null, r.localizacion || r.ubicacion), href: `/inventario/reactivos?abrir=${r.id}`, etiqueta: "Reactivo", lista: "/inventario/reactivos", claves: [r.id_interno, r.codigo_interno, r.lote, r.numero_cas, r.cas_number, r.catalogo], palabras: [nombre, r.id_interno, r.codigo_interno, r.lote, r.numero_cas, r.cas_number, r.catalogo, r.marca, r.localizacion, r.ubicacion, r.sub_localizacion, "reactivo"] }));
  }
  for (const c of consumibles) {
    const nombre = String(c.producto || "");
    out.push(hit({ clave: `c-${c.id}`, tipo: "consumible", grupo: "inventario", titulo: nombre, sub: join(c.existencia !== undefined && c.existencia !== null ? `${c.existencia} unidades` : null, c.marca, c.catalogo_parte_cas), href: `/inventario/consumibles?abrir=${c.id}`, etiqueta: "Consumible", lista: "/inventario/consumibles", palabras: [nombre, c.marca, c.catalogo_parte_cas, c.ubicacion, c.localizacion, "consumible"] }));
  }
  for (const e of equipos) {
    const nombre = String(e.nombre || "");
    out.push(hit({ clave: `eq-${e.id}`, tipo: "equipo", grupo: "inventario", titulo: nombre, sub: join(e.marca, e.modelo, e.clave_bitacora, e.ubicacion), href: `/inventario/equipos?abrir=${e.id}`, etiqueta: "Equipo", lista: "/inventario/equipos", claves: [e.clave_bitacora, e.numero_serie], palabras: [nombre, e.marca, e.modelo, e.numero_serie, e.clave_bitacora, e.ubicacion, "equipo"] }));
  }
  for (const m of mantenimientos) {
    const equipo = String(m.equipo || "Equipo");
    const tipo = MANT_TIPO[String(m.tipo)] || String(m.tipo || "Mantenimiento");
    const estado = String(m.estado || "");
    out.push(hit({ clave: `m-${m.id}`, tipo: "mantenimiento", grupo: "inventario", titulo: `${tipo} · ${equipo}`, sub: join(MANT_ESTADO[estado] || estado, m.fecha_programada ? `programado ${fmtDate(m.fecha_programada)}` : null, m.tecnico_proveedor), href: `/inventario/mantenimiento?abrir=${m.id}&filtro=${estado === "completado" ? "completado" : estado === "vencido" ? "vencido" : "pendiente"}`, etiqueta: "Mantenimiento", lista: "/inventario/mantenimiento", palabras: [tipo, equipo, m.equipo_marca, m.equipo_modelo, estado, MANT_ESTADO[estado], m.tecnico_proveedor, "mantenimiento"] }));
  }
  for (const m of movimientos) {
    const producto = String(m.item_nombre || m.item_codigo || "Movimiento");
    const tipo = String(m.tipo || "");
    out.push(hit({ clave: `mov-${m.id}`, tipo: "movimiento", grupo: "inventario", titulo: `${tipo ? `${tipo.charAt(0).toUpperCase()}${tipo.slice(1)} · ` : ""}${producto}`, sub: join(m.referencia, m.cantidad !== undefined && m.cantidad !== null ? `${m.cantidad}` : null, m.fecha_hora ? fmtDate(m.fecha_hora) : null), href: `/movimientos?buscar=${encodeURIComponent(String(m.referencia || producto))}`, etiqueta: "Movimiento", lista: "/movimientos", palabras: [producto, m.item_codigo, m.referencia, tipo, m.motivo, "movimiento"] }));
  }
  return out;
}

async function fuenteCalidad(request: Request, s: Session): Promise<Hit[]> {
  const out: Hit[] = [];
  const incidencias = items(await leer(request, s, listarIncidencias, "/api/calidad/incidencias"));
  const ncs = items(await leer(request, s, listarNc, "/api/calidad/nc"));
  const acciones = items(await leer(request, s, listarAcciones, "/api/calidad/acciones"));
  for (const i of incidencias) {
    const folio = String(i.folio || "");
    const estado = ESTADOS_INCIDENCIA[String(i.estado)]?.label || String(i.estado || "");
    out.push(hit({ clave: `inc-${i.id}`, tipo: "incidencia", grupo: "calidad", titulo: folio, sub: join(estado, recortar(i.descripcion)), href: `/calidad/incidencias/${i.id}`, mono: true, etiqueta: "Incidencia", lista: "/calidad/incidencias?tipos=incidencia", palabras: [folio, folio.replace(/\s/g, ""), i.descripcion, i.tipo, i.reportada_nombre, estado, "incidencia"] }));
  }
  for (const n of ncs) {
    const folio = folioNc(n.folio_num);
    const estado = ESTADOS_NC[String(n.estado)]?.label || String(n.estado || "");
    out.push(hit({ clave: `nc-${n.id}`, tipo: "nc", grupo: "calidad", titulo: folio, sub: join(estado, recortar(n.descripcion)), href: `/calidad/nc/${n.id}`, mono: true, etiqueta: "NC", lista: "/calidad/incidencias?tipos=nc", palabras: [folio, folio.replace(/\s/g, ""), n.descripcion, n.origen, n.clasificacion, n.responsable_nombre, estado, "nc no conformidad"] }));
  }
  for (const a of acciones) {
    const nc = a.nc_folio ? folioNc(a.nc_folio) : "NC";
    out.push(hit({ clave: `ac-${a.id}`, tipo: "accion_correctiva", grupo: "calidad", titulo: recortar(a.descripcion, 60) || "Acción correctiva", sub: join(nc, a.estado, a.responsable_nombre), href: `/calidad/nc/${a.nc_id}`, etiqueta: "Acción correctiva", lista: "/calidad/incidencias?tipos=nc", palabras: [a.descripcion, nc, a.responsable_nombre, a.estado, "accion correctiva"] }));
  }
  return out;
}

/* Documentos SGC: la misma lista del explorador (los restringidos y confidenciales solo para quien los puede ver). */
export function hitDocumento(d: ApiRecord): Hit {
  const clave = String(d.clave || "");
  const palabras = Array.isArray(d.palabras_clave) ? (d.palabras_clave as unknown[]).map(String) : [];
  const vigente = d.vigente as ApiRecord | null;
  const trabajo = d.trabajo as ApiRecord | null;
  const estado = ESTADO_DOCUMENTO[String(d.estado) as EstadoDocumento]?.etiqueta || "";
  const enCurso = trabajo ? ESTADO_REVISION[String(trabajo.estado) as EstadoRevision]?.etiqueta : null;
  return hit({ clave: `doc-${d.id}`, tipo: "documento", grupo: "documentos", titulo: String(d.titulo || clave || "Documento"), sub: join(clave, vigente ? `Rev. ${String(vigente.numero)}` : null, enCurso ? `${estado} · rev. ${String(trabajo?.numero)} ${enCurso.toLowerCase()}` : estado), href: `/documentos/${d.id}`, mono: false, etiqueta: "Documento SGC", lista: "/documentos/explorar", claves: [clave], palabras: [clave, d.titulo, d.proceso, d.area_codigo, ...palabras, "documento sgc"] });
}

async function fuenteDocumentos(request: Request, s: Session): Promise<Hit[]> {
  return items(await leer(request, s, listarDocumentos, "/api/sgc/documentos")).map(hitDocumento);
}

async function fuentePersonas(request: Request, s: Session): Promise<Hit[]> {
  const out: Hit[] = [];
  for (const p of items(await leer(request, s, listUsuarios, "/api/admin/usuarios"))) {
    const nombre = String(p.nombre || p.email || "");
    const roles = Array.isArray(p.roles) ? (p.roles as ApiRecord[]).map((r) => String(r.nombre || "")).filter(Boolean) : [];
    out.push(hit({ clave: `u-${p.id}`, tipo: "persona", grupo: "personas", titulo: nombre, sub: join(p.email !== nombre ? p.email : null, roles.slice(0, 2).join(", ")), href: `/administracion/usuarios?abrir=${p.id}`, etiqueta: "Persona", lista: "/administracion/usuarios", claves: [p.email], palabras: [nombre, p.email, roles.join(" "), "persona usuario"] }));
  }
  for (const r of items(await leer(request, s, listRoles, "/api/admin/roles"))) {
    out.push(hit({ clave: `rol-${r.id}`, tipo: "rol", grupo: "roles", titulo: String(r.nombre || ""), sub: join(r.descripcion ? recortar(r.descripcion, 60) : null), href: `/administracion/roles?abrir=${r.id}`, etiqueta: "Rol", lista: "/administracion/roles", claves: [r.clave], palabras: [r.nombre, r.clave, r.descripcion, "rol permisos"] }));
  }
  return out;
}

async function fuentePendientes(request: Request, s: Session): Promise<Hit[]> {
  const out: Hit[] = [];
  for (const sol of items(await leer(request, s, listarSolicitudes, "/api/solicitudes"))) {
    const titulo = join(sol.etiqueta || sol.tipo, sol.referencia).replace(" · ", ": ");
    out.push(hit({ clave: `sol-${sol.id}`, tipo: "solicitud", grupo: "solicitudes", titulo, sub: join(sol.solicitado_nombre, recortar(sol.motivo, 50)), href: `/solicitudes?abrir=${sol.id}`, etiqueta: sol.puedo_aprobar ? "Por autorizar" : "Solicitud", lista: "/solicitudes", pendiente: !!sol.puedo_aprobar, palabras: [titulo, sol.solicitado_nombre, sol.motivo, sol.tipo, "solicitud autorizar"] }));
  }
  const bandeja = await leer(request, s, bandejaSupervision, "/api/supervision");
  for (const lista of ["por_supervisar", "regresados"]) {
    for (const x of items(bandeja, lista)) {
      const titulo = join(x.tipo, x.referencia).replace(" · ", " ");
      out.push(hit({ clave: `sup-${x.tabla}-${x.id}`, tipo: "supervision", grupo: "solicitudes", titulo, sub: join(lista === "regresados" ? "Regresado" : "Por supervisar", x.solicitado_por), href: String(x.href || "/supervision"), etiqueta: "Supervisión", lista: "/supervision", pendiente: true, palabras: [titulo, x.solicitado_por, "supervision supervisar visto bueno regresado"] }));
    }
  }
  return out;
}

function hitsDeCatalogo(auth: Autorizacion): Hit[] {
  return catalogoVisible(auth).map((e) => hit({ clave: e.clave, tipo: e.tipo, grupo: e.grupo, titulo: e.titulo, sub: e.sub, href: e.href, comando: e.comando, etiqueta: e.tipo === "accion" ? "Acción" : undefined, palabras: [e.titulo, e.sub, e.kw] }));
}

export async function construirIndice(request: Request, s: Session): Promise<Indice> {
  const user = await requireUser(request);
  const auth = await cargarAutorizacion(s, user);
  const version = versionIndice();
  const guardado = cache.get(String(auth.userId));
  if (guardado && guardado.version === version && Date.now() - guardado.at < TTL_MS) return guardado.indice;

  secuencia = 0;
  const hits: Hit[] = [];
  hits.push(...(await fuenteMuestras(request, s)));
  hits.push(...(await fuenteInformes(request, s)));
  hits.push(...(await fuenteInventario(request, s)));
  hits.push(...(await fuenteCalidad(request, s)));
  hits.push(...(await fuenteDocumentos(request, s)));
  hits.push(...(await fuentePersonas(request, s)));
  hits.push(...(await fuentePendientes(request, s)));
  hits.push(...hitsDeCatalogo(auth));

  const pendientes = new Set<string>();
  try {
    for (const grupo of await pendientesDe(s, auth)) for (const evento of grupo.eventos) pendientes.add(evento.href);
  } catch {
    /* sin pendientes: solo afecta el orden */
  }
  for (const h of hits) if (pendientes.has(h.href)) h.pendiente = true;

  const indice = { hits, pendientes };
  cache.set(String(auth.userId), { at: Date.now(), version, indice });
  // Memoria acotada: personas que ya no consultan se olvidan.
  if (cache.size > 200) for (const [k, v] of cache) if (Date.now() - v.at > TTL_MS) cache.delete(k);
  return indice;
}
export { leer, items };
