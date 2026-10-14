/*
 * Documentos SGC, Fase 3: Lista Maestra de Documentos FX-GCL-MD (CA-09).
 *
 *   GET /api/sgc/lista-maestra        renglones con filtros (documento_consultar_vigente; solo lo visible)
 *   GET /api/sgc/lista-maestra/pdf    el mismo listado en PDF horizontal (lista_maestra_exportar), en la bitacora con sus filtros
 *
 * Respeta la confidencialidad (documentosVisibles) y los obsoletos solo se
 * incluyen con documento_consultar_historico.
 */
import PDFDocument from "pdfkit";
import { requireUser } from "../../auth";
import { registrarAuditoria } from "../../audit";
import { type Row, type Session } from "../../db";
import { HttpError, json, type RouteContext } from "../../http";
import { hoy } from "../../rbac";
import { tiene, type AccesoSgc } from "./acceso";
import { acceso, catalogos, documentosVisibles, ENTIDAD, nombres } from "./documentos";
import { ESTADOS_TRABAJO, pendienteDeRevision } from "../../../shared/documentos";
import { formatearFecha, formatearFechaHora } from "../../../shared/fechas";
import { LAB_IDENTITY } from "../../../shared/sgc";

export interface RenglonMaestra {
  id: number;
  area_codigo: string;
  area_nombre: string;
  area_color: string;
  clave: string;
  titulo: string;
  tipo_codigo: string;
  tipo_nombre: string;
  origen: "interno" | "externo";
  revision: string | null;
  estado: string;
  estado_etiqueta: string;
  pendiente_revision: boolean;
  en_curso: string | null;
  propietario: string | null;
  elaborador: string | null;
  revisor: string | null;
  autorizador: string | null;
  emision: string | null;
  vigencia: string | null;
  proxima_revision: string | null;
}

const ETAPA: Record<string, string> = { borrador: "en elaboración", en_revision: "en revisión", en_autorizacion: "en autorización", autorizada: "autorizada, por publicar" };
const ESTADO_DOC: Record<string, string> = { vigente: "Vigente", en_elaboracion: "En elaboración", obsoleto: "Obsoleto" };

export interface FiltrosMaestra {
  area: string;
  tipo: string;
  estado: string;
  origen: string;
  search: string;
  obsoletos: boolean;
}

export function filtrosDe(url: URL, a: AccesoSgc): FiltrosMaestra {
  const p = (k: string) => (url.searchParams.get(k) || "").trim();
  return { area: p("area").toUpperCase(), tipo: p("tipo").toUpperCase(), estado: p("estado"), origen: ["interno", "externo"].includes(p("origen")) ? p("origen") : "", search: p("search").slice(0, 120), obsoletos: p("obsoletos") === "1" && tiene(a, "documento_consultar_historico") };
}

export async function renglonesMaestra(s: Session, a: AccesoSgc, f: FiltrosMaestra): Promise<RenglonMaestra[]> {
  const { areas, tipos } = await catalogos(s);
  let lista = await documentosVisibles(s, a);
  if (!f.obsoletos) lista = lista.filter((x) => x.doc.estado !== "obsoleto");
  if (!lista.length) return [];
  const ids = lista.map((x) => Number(x.doc.id));
  const ph = ids.map((_, i) => `:d${i}`).join(", ");
  const params = Object.fromEntries(ids.map((id, i) => [`d${i}`, id]));
  // Revisión en curso: solo el numero y la etapa (sin contenido), tambien para quien solo consulta vigentes.
  const enCurso = await s.query<Row>(`SELECT documento_id, numero, estado FROM sgc_revisiones WHERE documento_id IN (${ph}) AND estado IN (${ESTADOS_TRABAJO.map((e) => `'${e}'`).join(", ")})`, params);
  const vigentes = await s.query<Row>(`SELECT * FROM sgc_revisiones WHERE documento_id IN (${ph}) AND estado = 'vigente'`, params);
  // Obsoletos: su ultima revision publicada (obsoleta) da los datos del renglon.
  const ultimas = f.obsoletos ? await s.query<Row>(`SELECT * FROM sgc_revisiones WHERE documento_id IN (${ph}) AND estado = 'obsoleta' ORDER BY numero DESC`, params) : [];
  const gente = await nombres(s, [...lista.map((x) => x.doc.propietario_id), ...[...vigentes, ...ultimas].flatMap((r) => [r.elaborador_id, r.revisor_id, r.autorizador_id])]);
  const nombre = (id: unknown) => (id ? gente.get(Number(id)) || null : null);
  const hoyStr = hoy();
  let filas: RenglonMaestra[] = lista.map((x) => {
    const doc = x.doc;
    const rev = vigentes.find((r) => Number(r.documento_id) === Number(doc.id)) || (doc.estado === "obsoleto" ? ultimas.find((r) => Number(r.documento_id) === Number(doc.id)) : undefined) || null;
    const curso = enCurso.find((r) => Number(r.documento_id) === Number(doc.id));
    const area = areas.find((ar) => ar.codigo === doc.area_codigo);
    const tipo = tipos.find((t) => t.codigo === doc.tipo_codigo);
    const externo = doc.origen === "externo";
    const pendiente = doc.estado === "vigente" && pendienteDeRevision(rev?.fecha_proxima_revision, hoyStr);
    return {
      id: Number(doc.id),
      area_codigo: String(doc.area_codigo),
      area_nombre: String(area?.nombre || doc.area_codigo),
      area_color: String(area?.color || "#888888"),
      clave: String(doc.clave),
      titulo: String(doc.titulo),
      tipo_codigo: String(doc.tipo_codigo),
      tipo_nombre: String(tipo?.nombre || doc.tipo_codigo),
      origen: externo ? "externo" : "interno",
      revision: rev ? (externo && rev.version_externa ? String(rev.version_externa) : `Rev. ${rev.numero}`) : null,
      estado: String(doc.estado),
      estado_etiqueta: pendiente ? "Pendiente de revisión" : ESTADO_DOC[String(doc.estado)] || String(doc.estado),
      pendiente_revision: pendiente,
      en_curso: curso ? `Rev. ${curso.numero} ${ETAPA[String(curso.estado)] || String(curso.estado)}` : null,
      propietario: nombre(doc.propietario_id),
      elaborador: externo ? null : nombre(rev?.elaborador_id),
      revisor: externo ? null : nombre(rev?.revisor_id),
      autorizador: externo ? null : nombre(rev?.autorizador_id),
      emision: (rev?.fecha_emision as string | null) ?? null,
      vigencia: (rev?.fecha_vigencia as string | null) ?? null,
      proxima_revision: (rev?.fecha_proxima_revision as string | null) ?? null,
    };
  });
  if (f.area) filas = filas.filter((x) => x.area_codigo === f.area);
  if (f.tipo) filas = filas.filter((x) => x.tipo_codigo === f.tipo);
  if (f.origen) filas = filas.filter((x) => x.origen === f.origen);
  if (f.estado === "pendiente_revision") filas = filas.filter((x) => x.pendiente_revision);
  else if (f.estado === "en_curso") filas = filas.filter((x) => !!x.en_curso);
  else if (f.estado === "obsoleto") filas = f.obsoletos ? filas.filter((x) => x.estado === "obsoleto") : [];
  else if (f.estado) filas = filas.filter((x) => x.estado === f.estado);
  if (f.search) {
    const q = f.search.toLowerCase();
    filas = filas.filter((x) => [x.clave, x.titulo, x.propietario, x.revision].some((v) => String(v || "").toLowerCase().includes(q)));
  }
  const orden = areas.map((ar) => String(ar.codigo));
  filas.sort((x, y) => orden.indexOf(x.area_codigo) - orden.indexOf(y.area_codigo) || x.clave.localeCompare(y.clave, "es"));
  return filas;
}

/* Descripcion legible de los filtros aplicados (PDF y bitacora). */
async function describirFiltros(s: Session, f: FiltrosMaestra): Promise<string> {
  const { areas, tipos } = await catalogos(s);
  const partes: string[] = [];
  if (f.area) partes.push(`Área: ${areas.find((x) => x.codigo === f.area)?.nombre || f.area} (${f.area})`);
  if (f.tipo) partes.push(`Tipo: ${tipos.find((x) => x.codigo === f.tipo)?.nombre || f.tipo}`);
  if (f.estado) partes.push(`Estado: ${{ vigente: "Vigente", en_elaboracion: "En elaboración", pendiente_revision: "Pendiente de revisión", en_curso: "Con revisión en curso", obsoleto: "Obsoleto" }[f.estado] || f.estado}`);
  if (f.origen) partes.push(`Origen: ${f.origen === "externo" ? "Externo" : "Interno"}`);
  if (f.search) partes.push(`Búsqueda: «${f.search}»`);
  if (f.obsoletos) partes.push("Incluye obsoletos");
  return partes.length ? partes.join(" · ") : "Todos los documentos";
}

export async function listaMaestra({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  if (!tiene(a, "documento_consultar_vigente")) throw new HttpError(403, { message: "La Lista Maestra requiere consultar documentos vigentes (documento_consultar_vigente)", codigo: "sin_permiso" });
  const f = filtrosDe(new URL(request.url), a);
  const items = await renglonesMaestra(s, a, f);
  return json({ items, filtros: await describirFiltros(s, f), puede: { exportar: tiene(a, "lista_maestra_exportar"), ver_obsoletos: tiene(a, "documento_consultar_historico") } });
}

export async function listaMaestraPdf({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  if (!tiene(a, "documento_consultar_vigente") || !tiene(a, "lista_maestra_exportar")) throw new HttpError(403, { message: "No tienes permiso para generar la Lista Maestra (lista_maestra_exportar)", codigo: "sin_permiso" });
  const f = filtrosDe(new URL(request.url), a);
  const items = await renglonesMaestra(s, a, f);
  const descripcion = await describirFiltros(s, f);
  const generado = new Date().toISOString();
  const pdf = await renderListaMaestraPdf(items, { filtros: descripcion, generado_en: generado, generado_por: String(user.nombre || user.email) });
  await registrarAuditoria(s, user, { accion: "exportar", entidad: ENTIDAD, entidadId: null, referencia: "Lista Maestra FX-GCL-MD", detalle: { lista_maestra: true, filtros: f, descripcion, documentos: items.length } });
  await s.commit();
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Lista-Maestra-FX-GCL-MD-${generado.slice(0, 10)}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Length": String(pdf.length) },
  });
}

/* ---------- PDF (mismo estilo que los informes de resultados) ---------- */

const INK = "#10202b";
const MUTED = "#5b6b78";
const LINE = "#d9e0e6";
const ACCENT = "#0f7a95";
const HEAD_FILL = "#eaf2f6";
const ZEBRA = "#f6f8fa";
const PAGE = { top: 96, bottom: 52, left: 36, right: 36 };

export async function renderListaMaestraPdf(items: RenglonMaestra[], meta: { filtros: string; generado_en: string; generado_por: string }): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margins: PAGE, bufferPages: true, info: { Title: "Lista Maestra de Documentos FX-GCL-MD", Author: LAB_IDENTITY.nombre } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const width = doc.page.width - PAGE.left - PAGE.right;
  const left = PAGE.left;
  const bottomLimit = () => doc.page.height - PAGE.bottom;
  const text = (value: string, x: number, y: number, opts: PDFKit.Mixins.TextOptions & { font?: string; size?: number; color?: string } = {}) => {
    const { font = "Helvetica", size = 8, color = INK, ...rest } = opts;
    doc.font(font).fontSize(size).fillColor(color).text(value, x, y, rest);
  };

  // Resumen bajo la cabecera (solo en la primera pagina).
  text("LISTA MAESTRA DE DOCUMENTOS FX-GCL-MD", left, doc.y, { font: "Helvetica-Bold", size: 13, color: INK, width });
  doc.y += 3;
  text(`Generada el ${formatearFechaHora(meta.generado_en)} por ${meta.generado_por} · ${items.length} documento${items.length === 1 ? "" : "s"}`, left, doc.y, { size: 8.5, color: MUTED, width });
  text(`Filtros: ${meta.filtros}`, left, doc.y + 2, { size: 8.5, color: MUTED, width });
  doc.y += 8;

  const headers = ["Clave", "Título", "Tipo", "Origen", "Revisión", "Estado", "Propietario", "Elaboró", "Revisó", "Autorizó", "Emisión", "Vigencia", "Próx. rev."];
  const fractions = [0.095, 0.135, 0.08, 0.05, 0.06, 0.085, 0.075, 0.07, 0.07, 0.07, 0.07, 0.07, 0.07];
  const widths = fractions.map((fr) => fr * width);
  const pad = 3.5;
  const measure = (cells: string[], size: number, font: string) => {
    doc.font(font).fontSize(size);
    return Math.max(...cells.map((cell, i) => doc.heightOfString(cell || "—", { width: widths[i] - pad * 2 }))) + pad * 2;
  };
  const drawHeader = () => {
    const h = measure(headers, 6.8, "Helvetica-Bold");
    const y = doc.y;
    doc.rect(left, y, width, h).fillColor(HEAD_FILL).fill();
    let x = left;
    headers.forEach((cell, i) => {
      text(cell, x + pad, y + pad, { font: "Helvetica-Bold", size: 6.8, color: MUTED, width: widths[i] - pad * 2 });
      x += widths[i];
    });
    doc.y = y + h;
  };
  /* Banda del area: sigla y nombre sobre su color. */
  const band = (codigo: string, nombre: string, color: string, sigue = false) => {
    const h = 17;
    const y = doc.y;
    doc.rect(left, y, width, h).fillColor(color).fill();
    text(`${codigo}  ·  ${nombre}${sigue ? " (continúa)" : ""}`, left + 7, y + 4.5, { font: "Helvetica-Bold", size: 8.5, color: "#ffffff", width: width - 14, lineBreak: false });
    doc.y = y + h;
  };

  if (!items.length) text("Sin documentos con estos filtros", left, doc.y + 6, { size: 9, color: MUTED, width });
  const grupos = [...new Set(items.map((x) => x.area_codigo))];
  for (const codigo of grupos) {
    const filas = items.filter((x) => x.area_codigo === codigo);
    const { area_nombre, area_color } = filas[0];
    if (doc.y + 17 + 20 + 24 > bottomLimit()) doc.addPage();
    doc.y += 8;
    band(codigo, area_nombre, area_color);
    drawHeader();
    filas.forEach((r, i) => {
      const estado = [r.estado_etiqueta, r.en_curso].filter(Boolean).join(" · ");
      const row = [r.clave, r.titulo, r.tipo_nombre, r.origen === "externo" ? "Externo" : "Interno", r.revision || "—", estado, r.propietario || "—", r.elaborador || "—", r.revisor || "—", r.autorizador || "—", formatearFecha(r.emision), formatearFecha(r.vigencia), formatearFecha(r.proxima_revision)];
      const h = measure(row, 7.4, "Helvetica");
      if (doc.y + h > bottomLimit()) {
        doc.addPage();
        band(codigo, area_nombre, area_color, true);
        drawHeader();
      }
      const y = doc.y;
      if (i % 2 === 1) doc.rect(left, y, width, h).fillColor(ZEBRA).fill();
      // Filete del color del area a la izquierda de cada renglon.
      doc.rect(left, y, 2.2, h).fillColor(area_color).fill();
      let x = left;
      row.forEach((cell, j) => {
        text(cell || "—", x + pad, y + pad, { font: j === 0 ? "Helvetica-Bold" : "Helvetica", size: 7.4, color: j === 5 && r.pendiente_revision ? "#b4530b" : INK, width: widths[j] - pad * 2 });
        x += widths[j];
      });
      doc.moveTo(left, y + h).lineTo(left + width, y + h).strokeColor(LINE).lineWidth(0.4).stroke();
      doc.y = y + h;
    });
  }

  // Cabecera y pie en cada pagina, con las paginas ya contadas.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const pageNo = `Página ${i - range.start + 1} de ${range.count}`;
    text(LAB_IDENTITY.nombre, left, 26, { font: "Helvetica-Bold", size: 8, width: width * 0.7, lineGap: 0.5 });
    text(LAB_IDENTITY.institucion, left, doc.y + 1, { size: 7, color: MUTED, width: width * 0.7 });
    text(LAB_IDENTITY.direccion, left, doc.y, { size: 7, color: MUTED, width: width * 0.7 });
    text("LISTA MAESTRA DE DOCUMENTOS", left + width * 0.7, 26, { font: "Helvetica-Bold", size: 7, color: ACCENT, width: width * 0.3, align: "right", characterSpacing: 0.8 });
    text("FX-GCL-MD", left + width * 0.7, doc.y + 1, { font: "Helvetica-Bold", size: 12, width: width * 0.3, align: "right" });
    text(`${formatearFechaHora(meta.generado_en)} · ${pageNo}`, left + width * 0.7, doc.y + 1, { size: 7, color: MUTED, width: width * 0.3, align: "right" });
    doc.moveTo(left, 82).lineTo(left + width, 82).strokeColor(ACCENT).lineWidth(1.2).stroke();
    const footerY = doc.page.height - 34;
    doc.moveTo(left, footerY - 6).lineTo(left + width, footerY - 6).strokeColor(LINE).lineWidth(0.5).stroke();
    text(`Documento controlado: la versión vigente es la publicada en FICOTOX. Impresa, es copia no controlada. Generada por ${meta.generado_por}.`, left, footerY, { size: 6.8, color: MUTED, width: width * 0.8, lineBreak: false });
    text(pageNo, left + width * 0.8, footerY, { size: 6.8, color: MUTED, width: width * 0.2, align: "right", lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }
  doc.end();
  return done;
}
