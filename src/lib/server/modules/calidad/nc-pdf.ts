/*
 * PDF "Registro de no conformidad" (Fase 11; ISO/IEC 17025 7.10, 8.7 y 7.5):
 * las nueve secciones de la NC (origen, descripcion y requisito, evaluacion de
 * impacto, analisis de causa, acciones correctivas, verificacion de eficacia,
 * efectos en el SGC, cierre e historial: fechas de etapa y eventos de la
 * bitacora con persona, cargo y motivo), firmas con cargo y la clave del formato
 * (NC_FORMATO_CLAVE; por confirmar con Mejora Continua). Se genera al cerrar
 * (se guarda con su SHA-256) y a pedido (estado actual, sin guardar).
 */
import PDFDocument from "pdfkit";
import { type Row, type Session } from "../../db";
import { rolesVigentes } from "../../rbac";
import { humanizeAuditEntry } from "../../../client/audit-humanize";
import { safeJsonLoad } from "../helpers";
import { LAB_IDENTITY } from "../../../shared/sgc";
import { CLASIFICACION_NC_LABEL, ESTADOS_ACCION, ESTADOS_NC, MEDIO_COMUNICACION_LABEL, METODO_CAUSA_LABEL, NC_FORMATO_CLAVE_DEFAULT, ORIGEN_NC_LABEL } from "../../../shared/calidad";
import { formatearFecha, formatearFechaHora } from "../../../shared/fechas";

const INK = "#10202b";
const MUTED = "#5b6b78";
const LINE = "#d9e0e6";
const ACCENT = "#0f7a95";
const PAGE = { top: 86, bottom: 60, left: 48, right: 48 };
const siNo = (v: unknown) => (v === "si" ? "Sí" : v === "no" ? "No" : "Sin evaluar");

async function nombreDe(s: Session, id: unknown): Promise<string> {
  if (!id) return "—";
  const row = await s.queryOne<Row>("SELECT nombre, email FROM usuarios WHERE id = :id", { id });
  return String(row?.nombre || row?.email || `#${id}`);
}

/* Cargo del responsable: sus roles vigentes (la NC no guarda un cargo al nombrarlo). */
async function cargoDe(s: Session, id: unknown): Promise<string | null> {
  if (!id) return null;
  const roles = await rolesVigentes(s, Number(id));
  return roles.map((r) => r.nombre).join(", ") || null;
}

export async function renderNcPdf(s: Session, nc: Row): Promise<Buffer> {
  const clave = (process.env.NC_FORMATO_CLAVE || "").trim() || NC_FORMATO_CLAVE_DEFAULT;
  const doc = new PDFDocument({ size: "LETTER", margins: PAGE, bufferPages: true, info: { Title: `Registro de no conformidad ${nc.folio}`, Author: LAB_IDENTITY.nombre } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const width = doc.page.width - PAGE.left - PAGE.right;
  const left = PAGE.left;
  const ensure = (n: number) => {
    if (doc.y + n > doc.page.height - PAGE.bottom) doc.addPage();
  };
  const text = (v: string, opts: PDFKit.Mixins.TextOptions & { font?: string; size?: number; color?: string } = {}) => {
    const { font = "Helvetica", size = 9.5, color = INK, ...rest } = opts;
    doc.font(font).fontSize(size).fillColor(color).text(v, left, doc.y, { width, ...rest });
  };
  const section = (titulo: string) => {
    ensure(70);
    doc.y += 12;
    text(titulo.toUpperCase(), { font: "Helvetica-Bold", size: 8.5, color: ACCENT, characterSpacing: 0.8 });
    doc.y += 3;
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor(LINE).lineWidth(0.6).stroke();
    doc.y += 6;
  };
  const campo = (etiqueta: string, valor: unknown) => {
    ensure(28);
    text(etiqueta, { font: "Helvetica-Bold", size: 8, color: MUTED });
    text(String(valor ?? "").trim() || "—", { size: 9.5 });
    doc.y += 3;
  };

  // Encabezado del documento.
  text("REGISTRO DE NO CONFORMIDAD", { font: "Helvetica-Bold", size: 15 });
  text(`${nc.folio} · ${ESTADOS_NC[String(nc.estado)]?.label || nc.estado}${Number(nc.reaperturas || 0) ? ` · ${nc.reaperturas} reapertura(s)` : ""}`, { size: 10, color: MUTED });
  doc.y += 6;

  section("1. Origen");
  campo("Origen", ORIGEN_NC_LABEL[String(nc.origen)] || nc.origen);
  campo("Incidencias", (nc.incidencias as Row[]).map((i) => (i.restringida ? String(i.folio) : `${i.folio} (${String(i.descripcion || "").slice(0, 90)})`)).join("; ") || "—");
  campo("Abierta", `${formatearFechaHora(nc.creada_en)} por ${await nombreDe(s, nc.creada_por)}${nc.creada_rol ? ` (${nc.creada_rol})` : ""}`);
  campo("Clasificación", nc.clasificacion ? CLASIFICACION_NC_LABEL[String(nc.clasificacion)] : "Sin clasificar");
  campo("Responsable", nc.responsable ? String((nc.responsable as Row).nombre) : "—");

  section("2. Descripción y requisito incumplido");
  campo("Descripción", nc.descripcion);
  campo("Requisito (cláusula ISO, procedimiento o formato)", nc.requisito_incumplido);

  section("3. Evaluación de impacto (7.10.1)");
  campo("¿Afecta resultados emitidos?", siNo(nc.afecta_resultados_emitidos));
  campo("Informes afectados", (nc.afectados as Row[]).map((a) => a.referencia).join(", ") || "Ninguno");
  campo("Retenciones", (nc.retenciones as Row[]).map((r) => `${r.informe}: ${r.liberada_en ? `liberada ${formatearFechaHora(r.liberada_en)}` : "retenido"}`).join("; ") || "Ninguna");
  campo("¿Se detuvo el trabajo?", siNo(nc.trabajo_detenido));
  campo("Suspensiones", (nc.suspensiones as Row[]).map((su) => `${su.tipo === "metodo" ? `Método ${su.clave}` : `Equipo ${su.equipo_nombre || su.clave}`}: ${formatearFechaHora(su.suspendida_en)}${su.reanudada_en ? ` → reanudado ${formatearFechaHora(su.reanudada_en)} por ${su.reanudada_nombre || "—"}` : " (vigente)"}`).join("; ") || "Ninguna");
  campo("¿Se notifica al cliente?", siNo(nc.notificar_cliente));
  campo("Comunicaciones con el cliente", (nc.comunicaciones as Row[]).map((c) => `${formatearFecha(c.fecha)} · ${MEDIO_COMUNICACION_LABEL[String(c.medio)] || c.medio} · ${c.contacto}: ${c.resumen}`).join("\n") || "Ninguna");
  campo("Notas", nc.impacto_notas);
  campo("Evaluó el impacto", nc.impacto_evaluado_en ? `${nc.impacto_evaluado_nombre || (await nombreDe(s, nc.impacto_evaluado_por))} · ${formatearFechaHora(nc.impacto_evaluado_en)}` : "—");

  section("4. Análisis de causa (8.7.1 b)");
  campo("Método", nc.metodo_causa ? METODO_CAUSA_LABEL[String(nc.metodo_causa)] : "—");
  campo("Desarrollo", nc.desarrollo_causa);
  campo("Causa raíz", nc.causa_raiz);
  campo("¿Requiere acción correctiva?", siNo(nc.requiere_accion_correctiva));
  if (nc.requiere_accion_correctiva === "no") campo("Justificación (no puede repetirse)", nc.justificacion_sin_accion);

  section("5. Acciones correctivas (8.7.1 c)");
  const acciones = nc.acciones as Row[];
  if (!acciones.length) text("Sin acciones.", { color: MUTED });
  for (const a of acciones) {
    ensure(40);
    text(`#${a.id} · ${ESTADOS_ACCION[String(a.estado)]?.label || a.estado}${a.vencida ? " · VENCIDA" : ""} · responsable ${a.responsable_nombre || "—"} · compromiso ${formatearFecha(a.fecha_compromiso)}`, { font: "Helvetica-Bold", size: 8.8 });
    text(String(a.descripcion), { size: 9 });
    if (a.implementada_en) text(`Implementada ${formatearFechaHora(a.implementada_en)}: ${a.descripcion_implementacion || ""}`, { size: 8.8, color: MUTED });
    if (a.cancelada_en) text(`Cancelada: ${a.motivo_cancelacion || ""}`, { size: 8.8, color: MUTED });
    doc.y += 4;
  }

  section("6. Verificación de eficacia (8.7.1 d)");
  const verif = nc.verificaciones as Row[];
  if (!verif.length) text("Sin verificaciones.", { color: MUTED });
  for (const v of verif) campo(`${formatearFechaHora(v.verificada_en)} · ${v.verificada_nombre || "—"}${v.verificada_rol ? ` (${v.verificada_rol})` : ""}${v.fecha_programada ? ` · programada ${formatearFecha(v.fecha_programada)}` : ""}`, `${v.resultado === "eficaz" ? "EFICAZ" : "NO EFICAZ"} — ${v.comentarios || ""}`);

  section("7. Efectos en el sistema de gestión (8.7.1 e, f)");
  campo("Actualizar riesgos y oportunidades", `${nc.requiere_actualizar_riesgos ? "Sí" : "No"}${nc.nota_riesgos ? ` — ${nc.nota_riesgos}` : ""}`);
  campo("Cambio documental", nc.propuesta ? `Sí — propuesta #${(nc.propuesta as Row).id}: ${(nc.propuesta as Row).titulo} (${(nc.propuesta as Row).estado})` : nc.requiere_cambio_documental ? "Sí (sin propuesta registrada)" : "No");

  section("8. Cierre");
  campo("Conclusión", nc.conclusion);
  ensure(90);
  doc.y += 8;
  const firmas: Array<[string, string, string | null, string | null]> = [
    ["Abrió", await nombreDe(s, nc.creada_por), nc.creada_rol, nc.creada_en],
    ["Responsable", nc.responsable ? String((nc.responsable as Row).nombre) : "—", await cargoDe(s, nc.responsable_id), null],
    ["Cerró", nc.cerrada_por ? await nombreDe(s, nc.cerrada_por) : "—", nc.cerrada_rol, nc.cerrada_en],
  ];
  const col = width / 3;
  const y0 = doc.y;
  firmas.forEach(([titulo, nombre, cargo, fecha], i) => {
    const x = left + i * col;
    doc.moveTo(x + 6, y0 + 34).lineTo(x + col - 12, y0 + 34).strokeColor(LINE).lineWidth(0.8).stroke();
    doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text(titulo.toUpperCase(), x + 6, y0 + 38, { width: col - 18 });
    doc.font("Helvetica").fontSize(9).fillColor(INK).text(nombre, x + 6, y0 + 49, { width: col - 18 });
    if (cargo) doc.fontSize(8).fillColor(MUTED).text(cargo, x + 6, y0 + 61, { width: col - 18 });
    if (fecha) doc.fontSize(8).fillColor(MUTED).text(formatearFechaHora(fecha), x + 6, y0 + 72, { width: col - 18 });
  });
  doc.y = y0 + 90;
  if (nc.pdf_sha256 && nc.archivo_pdf) text(`Huella del PDF final anterior: ${nc.pdf_sha256}`, { size: 7, color: MUTED });

  section("9. Historial");
  campo("Etapas", [
    `Abierta ${formatearFechaHora(nc.creada_en)}`,
    nc.analisis_iniciado_en ? `En análisis ${formatearFechaHora(nc.analisis_iniciado_en)}` : null,
    nc.acciones_iniciadas_en ? `Acciones en curso ${formatearFechaHora(nc.acciones_iniciadas_en)}` : null,
    nc.verificacion_iniciada_en ? `En verificación ${formatearFechaHora(nc.verificacion_iniciada_en)}` : null,
    nc.cerrada_en ? `Cerrada ${formatearFechaHora(nc.cerrada_en)}` : null,
    Number(nc.reaperturas || 0) ? `${nc.reaperturas} reapertura(s)` : null,
  ].filter(Boolean).join(" · "));
  // Eventos de la bitacora de la NC (sin las descargas del propio PDF), con persona, cargo y motivo.
  const eventos = await s.query<Row>("SELECT id, fecha_hora, usuario_nombre, usuario_email, accion, entidad, entidad_id, referencia, motivo, cambios_json FROM auditoria WHERE entidad = 'no_conformidades' AND entidad_id = :id AND accion <> 'descargar' ORDER BY id", { id: String(nc.id) });
  for (const e of eventos) {
    const cambios = safeJsonLoad<Record<string, unknown>>(String(e.cambios_json || "{}"), {});
    const h = humanizeAuditEntry({ ...e, cambios });
    const cargo = ((cambios._detalle as Record<string, unknown> | undefined)?.actuo_como as { cargo?: string } | undefined)?.cargo;
    ensure(24);
    text(`${formatearFechaHora(e.fecha_hora)} · ${h.frase}${cargo ? ` (como ${cargo})` : ""}`, { size: 8.5 });
    if (e.motivo) text(`Motivo: ${String(e.motivo)}`, { size: 8, color: MUTED });
    doc.y += 2;
  }

  // Encabezado y pie en cada pagina (sin generar paginas en blanco).
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(ACCENT).text("LN-FICOTOX · CICESE", left, 30, { width: width * 0.6, lineBreak: false });
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(`${clave} · ${nc.folio}`, left + width * 0.6, 30, { width: width * 0.4, align: "right", lineBreak: false });
    doc.moveTo(left, 46).lineTo(left + width, 46).strokeColor(LINE).lineWidth(0.6).stroke();
    const pie = doc.page.height - 36;
    doc.fontSize(6.8).fillColor(MUTED).text(`Registro de no conformidad · ISO/IEC 17025 7.10 y 8.7 · generado ${formatearFechaHora(new Date().toISOString())}`, left, pie, { width: width * 0.75, lineBreak: false });
    doc.text(`Página ${i - range.start + 1} de ${range.count}`, left + width * 0.75, pie, { width: width * 0.25, align: "right", lineBreak: false });
  }
  doc.end();
  return done;
}
