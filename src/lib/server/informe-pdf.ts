import PDFDocument from "pdfkit";
import { LAB_IDENTITY, REPORT_DEFAULT_STATEMENTS } from "../shared/sgc";
import { formatearFecha } from "../shared/fechas";

/*
 * Render del informe de resultados en PDF (ISO/IEC 17025 7.8.2 y 7.8.3):
 * titulo, laboratorio y direccion, identificacion unica en cada pagina,
 * cliente, muestras, metodos, fechas, resultados con unidades y conformidad,
 * declaraciones, desviaciones y personas que autorizan.
 */

interface InformeResultado {
  id_muestra: string;
  resultado: number | null;
  resultado_texto: string | null;
  unidad: string | null;
  limite_regulatorio: number | null;
  limite_deteccion: number | null;
  incertidumbre: number | null;
  cumple: string | null;
  observacion: string | null;
}

export interface InformeAnalisis {
  folio: string;
  tipo: string;
  metodo: string;
  metodo_referencia: string | null;
  fecha_analisis: string | null;
  equipo: string | null;
  analista: string | null;
  aprobado_por: string | null;
  resultados: InformeResultado[];
}

interface InformeFirma {
  nombre: string | null;
  cargo: string | null;
  fecha: string | null;
  firma: string | null;
}

export interface InformeRender {
  folio: string;
  version: number;
  sustituye: string | null;
  motivo_enmienda: string | null;
  fecha_emision: string;
  cliente: { nombre: string | null; contacto: string | null; direccion: string | null };
  recepcion: { folio: string; fecha_recepcion: string | null; fecha_muestra: string | null; medio: string | null };
  muestras: Array<{ id_interno: string | null; organismo: string | null; sitio: string | null; fecha_muestra: string | null; cantidad: string | null; condicion: string | null }>;
  analisis: InformeAnalisis[];
  declaraciones: { alcance: string; regla_decision: string; desviaciones: string | null; descargo: string | null; opiniones: string | null };
  firmas: { elaborado: InformeFirma; revisado: InformeFirma; autorizado: InformeFirma };
  anulado: boolean;
  /* Folio y version de la enmienda que dejo sin efecto a este informe (7.8.8). */
  sustituido_por: string | null;
  /* Fase 3: "Revisión autorizada por excepción, solicitud #N" (segregacion de funciones). */
  excepciones?: string[];
}

const INK = "#10202b";
const MUTED = "#5b6b78";
const LINE = "#d9e0e6";
const ACCENT = "#0f7a95";
const HEAD_FILL = "#eaf2f6";
const ZEBRA = "#f6f8fa";
const OK = "#1f6b45";
const BAD = "#c8433b";

const PAGE = { top: 92, bottom: 64, left: 48, right: 48 };

/* dd/mm/aaaa: una fecha sola tal cual; un instante (autorizado_en, creado_en) en la zona del laboratorio. */
function fmtDate(value: string | null | undefined): string {
  return formatearFecha(value);
}

function fmtNumber(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("es-MX", { maximumFractionDigits: 4 });
}

function conformidad(value: string | null): string {
  if (value === "cumple") return "Cumple";
  if (value === "no_cumple") return "No cumple";
  if (value === "na") return "No aplica";
  return "—";
}

const has = (value: string | null | undefined) => !!value && String(value).trim() !== "";

/*
 * Estructura del documento:
 *  - Cabecera fija en cada página: laboratorio (izq.) e identificación del
 *    informe (der.), con línea de acento. Pie con leyenda de reproducción y
 *    "Página n de m". Ambos se dibujan al final con las páginas ya contadas y
 *    sin que puedan generar páginas nuevas (se anula el margen inferior).
 *  - Cuerpo: título y resumen, bloques de datos, tablas con encabezado
 *    sombreado y zebra, declaraciones y bloque de firmas que nunca se parte.
 */
export async function renderInformePdf(data: InformeRender): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margins: PAGE, bufferPages: true, info: { Title: `Informe de resultados ${data.folio}`, Author: LAB_IDENTITY.nombre } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const width = doc.page.width - PAGE.left - PAGE.right;
  const left = PAGE.left;
  const bottomLimit = () => doc.page.height - PAGE.bottom;
  const ensure = (needed: number) => {
    if (doc.y + needed > bottomLimit()) doc.addPage();
  };
  const text = (value: string, x: number, y: number, opts: PDFKit.Mixins.TextOptions & { font?: string; size?: number; color?: string } = {}) => {
    const { font = "Helvetica", size = 9.5, color = INK, ...rest } = opts;
    doc.font(font).fontSize(size).fillColor(color).text(value, x, y, rest);
  };

  /* Título de sección con espacio garantizado para el título y al menos dos líneas de contenido. */
  const section = (title: string, minContent = 48) => {
    ensure(30 + minContent);
    doc.y += 14;
    text(title.toUpperCase(), left, doc.y, { font: "Helvetica-Bold", size: 8.5, color: ACCENT, characterSpacing: 0.8, width });
    doc.y += 4;
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor(LINE).lineWidth(0.6).stroke();
    doc.y += 8;
    doc.x = left;
  };

  /* Rejilla de pares etiqueta/valor en `cols` columnas, alineando cada fila. */
  const grid = (pairs: Array<[string, string | null | undefined]>, cols = 2) => {
    const gap = 14;
    const colWidth = (width - gap * (cols - 1)) / cols;
    for (let i = 0; i < pairs.length; i += cols) {
      const row = pairs.slice(i, i + cols);
      doc.font("Helvetica").fontSize(9.5);
      const heights = row.map(([, value]) => doc.heightOfString(has(value) ? String(value) : "—", { width: colWidth }));
      const rowHeight = 12 + Math.max(...heights) + 6;
      ensure(rowHeight);
      const y = doc.y;
      row.forEach(([label, value], j) => {
        const x = left + j * (colWidth + gap);
        text(label, x, y, { font: "Helvetica", size: 7.5, color: MUTED, width: colWidth });
        text(has(value) ? String(value) : "—", x, y + 11, { size: 9.5, width: colWidth });
      });
      doc.y = y + rowHeight;
      doc.x = left;
    }
  };

  /* Tabla con encabezado sombreado, zebra y repetición del encabezado al cambiar de página. */
  const table = (headers: string[], rows: string[][], fractions: number[], options: { align?: Array<"left" | "right" | "center">; colorCell?: (rowIndex: number, colIndex: number, value: string) => string | null } = {}) => {
    const widths = fractions.map((f) => f * width);
    const align = options.align || headers.map(() => "left" as const);
    const pad = 5;
    const measure = (cells: string[], size: number, font: string) => {
      doc.font(font).fontSize(size);
      return Math.max(...cells.map((cell, i) => doc.heightOfString(cell || "—", { width: widths[i] - pad * 2 }))) + pad * 2;
    };
    const drawHeader = () => {
      const h = measure(headers, 7.5, "Helvetica-Bold");
      const y = doc.y;
      doc.rect(left, y, width, h).fillColor(HEAD_FILL).fill();
      let x = left;
      headers.forEach((cell, i) => {
        text(cell, x + pad, y + pad, { font: "Helvetica-Bold", size: 7.5, color: MUTED, width: widths[i] - pad * 2, align: align[i] });
        x += widths[i];
      });
      doc.y = y + h;
      doc.x = left;
    };
    ensure(measure(headers, 7.5, "Helvetica-Bold") + 30);
    drawHeader();
    rows.forEach((row, r) => {
      const h = measure(row, 8.8, "Helvetica");
      if (doc.y + h > bottomLimit()) {
        doc.addPage();
        drawHeader();
      }
      const y = doc.y;
      if (r % 2 === 1) doc.rect(left, y, width, h).fillColor(ZEBRA).fill();
      let x = left;
      row.forEach((cell, i) => {
        const color = options.colorCell?.(r, i, cell) || INK;
        text(cell || "—", x + pad, y + pad, { size: 8.8, color, width: widths[i] - pad * 2, align: align[i], font: color === INK ? "Helvetica" : "Helvetica-Bold" });
        x += widths[i];
      });
      doc.moveTo(left, y + h).lineTo(left + width, y + h).strokeColor(LINE).lineWidth(0.4).stroke();
      doc.y = y + h;
      doc.x = left;
    });
    if (!rows.length) {
      const y = doc.y;
      text("Sin registros", left + pad, y + pad, { size: 8.8, color: MUTED, width: width - pad * 2 });
      doc.y = y + 22;
    }
    doc.y += 6;
  };

  const paragraph = (label: string, value: string | null | undefined) => {
    if (!has(value)) return;
    doc.font("Helvetica").fontSize(9.5);
    const h = doc.heightOfString(String(value), { width });
    ensure(12 + h + 8);
    text(label, left, doc.y, { font: "Helvetica", size: 7.5, color: MUTED, width });
    text(String(value), left, doc.y + 11, { size: 9.5, width, lineGap: 1.5 });
    doc.y += 8;
    doc.x = left;
  };

  // ---------- Título y resumen ----------
  text("Informe de resultados", left, doc.y, { font: "Helvetica-Bold", size: 20, width });
  doc.y += 2;
  text(`${data.folio} · versión ${data.version} · emitido el ${fmtDate(data.fecha_emision)}`, left, doc.y, { size: 9.5, color: MUTED, width });
  if (data.sustituye) {
    doc.y += 6;
    text(`Enmienda: este documento sustituye íntegramente al informe ${data.sustituye}.${data.motivo_enmienda ? ` Motivo: ${data.motivo_enmienda}` : ""}`, left, doc.y, { font: "Helvetica-Bold", size: 9, color: "#8a5a10", width });
  }
  if (data.sustituido_por) {
    doc.y += 6;
    text(`Informe sustituido por la enmienda ${data.sustituido_por}: sin validez.`, left, doc.y, { font: "Helvetica-Bold", size: 10, color: BAD, width });
  }
  if (data.anulado) {
    doc.y += 6;
    text("Informe anulado: sin validez.", left, doc.y, { font: "Helvetica-Bold", size: 10, color: BAD, width });
  }

  section("Cliente y muestra recibida", 40);
  grid([
    ["Cliente / solicitante", data.cliente.nombre],
    ["Contacto", data.cliente.contacto],
    ["Dirección", data.cliente.direccion],
    ["Recepción", `${data.recepcion.folio} · ${fmtDate(data.recepcion.fecha_recepcion)}${has(data.recepcion.medio) ? ` · ${data.recepcion.medio}` : ""}`],
  ]);

  section("Ítems ensayados");
  table(
    ["ID interno", "Organismo / matriz", "Sitio de muestreo", "Fecha de muestra", "Cantidad", "Condición al recibir"],
    data.muestras.map((m) => [m.id_interno || "—", m.organismo || "—", m.sitio || "—", fmtDate(m.fecha_muestra), m.cantidad || "—", m.condicion || "—"]),
    [0.15, 0.23, 0.2, 0.13, 0.12, 0.17],
  );

  section("Métodos");
  table(
    ["Análisis", "Método", "Referencia", "Fecha", "Equipo", "Analista"],
    data.analisis.map((a) => [`${a.folio}\n${a.tipo}`, a.metodo, a.metodo_referencia || "—", fmtDate(a.fecha_analisis), a.equipo || "—", a.analista || "—"]),
    [0.2, 0.24, 0.16, 0.11, 0.15, 0.14],
  );

  section("Resultados");
  for (const a of data.analisis) {
    ensure(60);
    text(`${a.tipo} · ${a.metodo} · ${a.folio}`, left, doc.y, { font: "Helvetica-Bold", size: 9.5, width });
    doc.y += 5;
    const showLd = a.resultados.some((r) => r.limite_deteccion !== null);
    const showU = a.resultados.some((r) => r.incertidumbre !== null);
    const headers = ["ID muestra", "Resultado", "Unidad", ...(showLd ? ["LD"] : []), ...(showU ? ["Incert. (±)"] : []), "Límite aplicable", "Conformidad", "Observación"];
    const base = [0.14, 0.11, 0.08, 0.15, 0.13];
    const obsWidth = 1 - base.reduce((a, b) => a + b, 0) - (showLd ? 0.08 : 0) - (showU ? 0.1 : 0);
    const fractions = [base[0], base[1], base[2], ...(showLd ? [0.08] : []), ...(showU ? [0.1] : []), base[3], base[4], obsWidth];
    const rows = a.resultados.map((r) => [
      r.id_muestra,
      r.resultado !== null ? fmtNumber(r.resultado) : r.resultado_texto || "—",
      r.unidad || "—",
      ...(showLd ? [fmtNumber(r.limite_deteccion)] : []),
      ...(showU ? [r.incertidumbre !== null ? `± ${fmtNumber(r.incertidumbre)}` : "—"] : []),
      r.limite_regulatorio !== null ? `${fmtNumber(r.limite_regulatorio)} ${r.unidad || ""}`.trim() : "—",
      conformidad(r.cumple),
      r.observacion || "—",
    ]);
    const confIndex = headers.indexOf("Conformidad");
    table(headers, rows, fractions, {
      align: headers.map((h) => (["Resultado", "LD", "Incert. (±)", "Límite aplicable"].includes(h) ? "right" : "left")),
      colorCell: (_r, c, value) => (c === confIndex ? (value === "Cumple" ? OK : value === "No cumple" ? BAD : null) : null),
    });
  }

  section("Declaraciones", 60);
  paragraph("Alcance de los resultados", data.declaraciones.alcance);
  paragraph("Regla de decisión", data.declaraciones.regla_decision);
  paragraph("Adiciones, desviaciones o exclusiones del método", data.declaraciones.desviaciones);
  paragraph("Descargo por muestra recibida con desviación", data.declaraciones.descargo);
  paragraph("Opiniones e interpretaciones", data.declaraciones.opiniones);

  // ---------- Firmas (bloque indivisible) ----------
  const blockHeight = 118;
  ensure(30 + blockHeight);
  section("Elaboró, revisó y autorizó", blockHeight);
  const colGap = 16;
  const colWidth = (width - colGap * 2) / 3;
  const top = doc.y;
  const blocks: Array<[string, InformeFirma]> = [
    ["Elaboró", data.firmas.elaborado],
    ["Revisó", data.firmas.revisado],
    ["Autorizó", data.firmas.autorizado],
  ];
  blocks.forEach(([label, firma], i) => {
    const x = left + i * (colWidth + colGap);
    text(label, x, top, { font: "Helvetica-Bold", size: 7.5, color: MUTED, width: colWidth, characterSpacing: 0.6 });
    const lineY = top + 66;
    if (firma.firma && firma.firma.startsWith("data:image")) {
      try {
        const base64 = firma.firma.split(",")[1] || "";
        doc.image(Buffer.from(base64, "base64"), x + 4, top + 14, { fit: [colWidth - 8, 48], align: "center", valign: "bottom" });
      } catch {
        /* firma ilegible: se omite la imagen */
      }
    }
    doc.moveTo(x, lineY).lineTo(x + colWidth, lineY).strokeColor(INK).lineWidth(0.6).stroke();
    text(firma.nombre || "Pendiente", x, lineY + 5, { font: "Helvetica-Bold", size: 9, color: firma.nombre ? INK : MUTED, width: colWidth });
    text([firma.cargo, firma.fecha ? fmtDate(firma.fecha) : null].filter(Boolean).join(" · ") || "—", x, doc.y, { size: 8, color: MUTED, width: colWidth });
  });
  doc.y = top + blockHeight;
  doc.x = left;
  if (data.excepciones?.length) {
    // Excepcion de segregacion aprobada por un segundo usuario: queda declarada en el informe.
    text(data.excepciones.join(" · "), left, doc.y + 4, { size: 7.5, color: MUTED, width });
  }

  // ---------- Cabecera y pie en cada página ----------
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    // Sin margen inferior mientras se dibuja el pie: así el texto nunca provoca una página nueva.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const pageNo = `Página ${i - range.start + 1} de ${range.count}`;
    text(LAB_IDENTITY.nombre, left, 30, { font: "Helvetica-Bold", size: 8, width: width * 0.68, lineGap: 0.5 });
    text(`${LAB_IDENTITY.institucion}`, left, doc.y + 1, { size: 7, color: MUTED, width: width * 0.68 });
    text(LAB_IDENTITY.direccion, left, doc.y, { size: 7, color: MUTED, width: width * 0.68 });
    text("INFORME DE RESULTADOS", left + width * 0.68, 30, { font: "Helvetica-Bold", size: 7, color: ACCENT, width: width * 0.32, align: "right", characterSpacing: 0.8 });
    text(data.folio, left + width * 0.68, doc.y + 1, { font: "Helvetica-Bold", size: 12, width: width * 0.32, align: "right" });
    text(`${LAB_IDENTITY.clave_formato} · v${data.version} · ${pageNo}`, left + width * 0.68, doc.y + 1, { size: 7, color: MUTED, width: width * 0.32, align: "right" });
    doc.moveTo(left, 80).lineTo(left + width, 80).strokeColor(ACCENT).lineWidth(1.2).stroke();
    const footerY = doc.page.height - 44;
    doc.moveTo(left, footerY - 6).lineTo(left + width, footerY - 6).strokeColor(LINE).lineWidth(0.5).stroke();
    text(REPORT_DEFAULT_STATEMENTS.reproduccion, left, footerY, { size: 6.8, color: MUTED, width: width * 0.78, lineBreak: false });
    text(`${data.folio} · ${pageNo}`, left + width * 0.78, footerY, { size: 6.8, color: MUTED, width: width * 0.22, align: "right", lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }

  doc.end();
  return done;
}
