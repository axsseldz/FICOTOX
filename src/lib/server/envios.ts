/*
 * Envio del informe por correo y su evidencia (Fase 6, seccion 8 de la
 * especificacion). No hay portal de cliente: el informe liberado se envia por
 * correo y el sistema conserva la evidencia. Nada se borra.
 *
 * - Solo se envia un informe liberado o ya enviado (reenvios, varios
 *   destinatarios); otro estado -> 409. Permiso: informes:A.
 * - Envio manual (siempre): la persona lo envia desde su correo institucional y
 *   registra destinatario, correo, fecha y hora, y la evidencia (PDF, imagen o
 *   .eml), guardada con su SHA-256 en instance/informes/envios/.
 * - Envio SMTP (opcional): con SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS y
 *   SMTP_FROM se envia el PDF adjunto; la evidencia es el Message-ID y la
 *   respuesta del servidor. SMTP_HOST=prueba usa un transporte en memoria (sin red).
 * - El primer envio pasa el informe a "enviado". Cada envio admite despues una
 *   confirmacion de recepcion. El envio no modifica el informe ni sus resultados.
 * - Los correos y evidencias solo los ve quien tiene informes:V; en la bitacora
 *   el correo aparece parcialmente oculto.
 */
import { exigirSinRetencion } from "./modules/calidad/bloqueos";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { requireUser, userIdFromClaims, type CurrentUser } from "./auth";
import { registrarAuditoria, snapshotRow } from "./audit";
import { getConfig } from "./config";
import { type Row, type Session } from "./db";
import { HttpError, intParam, json, readJson, type RouteContext } from "./http";
import { cargoActuante, requirePermission } from "./rbac";

import { exigirSinSolicitudPendiente } from "./solicitudes";
import { exigirSinRequiereEnmienda, informeFolio } from "./modules/informes";

const TABLE = "envios_informe";
const EXTENSIONES = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".eml", ".msg"]);
const MAX_BYTES = 15 * 1024 * 1024;

/* ---------- Utilidades ---------- */

/* h***@cofepris.gob.mx: el correo parcialmente oculto para la bitacora. */
function correoOculto(correo: string): string {
  const [usuario, dominio] = String(correo || "").split("@");
  if (!dominio) return "***";
  return `${usuario.slice(0, 1)}***@${dominio}`;
}

const correoValido = (correo: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);

function enviosDir(): string {
  const folder = path.join(getConfig().INSTANCE_DIR, "informes", "envios");
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

function informesDir(): string {
  return path.join(getConfig().INSTANCE_DIR, "informes");
}

/* Configuracion SMTP: todas las variables o ninguna. */
function smtpConfig(): { host: string; port: number; user: string; pass: string; from: string } | null {
  const host = (process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 0);
  const user = (process.env.SMTP_USER || "").trim();
  const pass = process.env.SMTP_PASS || "";
  const from = (process.env.SMTP_FROM || "").trim();
  if (!host || !port || !user || !pass || !from) return null;
  return { host, port, user, pass, from };
}

async function transporte(cfg: NonNullable<ReturnType<typeof smtpConfig>>) {
  // nodemailer solo se carga cuando se envia un correo.
  const { default: nodemailer } = await import("nodemailer");
  // SMTP_HOST=prueba: transporte en memoria para las pruebas (no sale a la red).
  if (cfg.host === "prueba") return nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  return nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.port === 465, auth: { user: cfg.user, pass: cfg.pass } });
}

async function informeEnviable(s: Session, id: number): Promise<Row> {
  const row = await snapshotRow(s, "informes", id);
  if (!row) throw new HttpError(404, { message: "Informe no encontrado" });
  if (!["liberado", "enviado"].includes(String(row.estado))) throw new HttpError(409, { message: `Solo se envían informes liberados (el informe ${informeFolio(row)} está ${row.estado})`, codigo: "no_liberado" });
  exigirSinRequiereEnmienda(row, "enviar");
  // Fase 11: retenido por una NC -> no se envia (tampoco se reenvia uno ya enviado).
  await exigirSinRetencion(s, id, informeFolio(row), "enviar");
  await exigirSinSolicitudPendiente(s, "informes", id, `El informe ${informeFolio(row)}`, "enviar");
  if (!row.archivo_pdf || !fs.existsSync(path.join(informesDir(), String(row.archivo_pdf)))) throw new HttpError(409, { message: "El informe no tiene su PDF final" });
  return row;
}

async function listar(s: Session, informeId: number): Promise<Row[]> {
  return s.query<Row>(
    `SELECT e.*, u.nombre AS enviado_por_nombre FROM ${TABLE} e LEFT JOIN usuarios u ON u.id = e.enviado_por WHERE e.informe_id = :id ORDER BY e.id`,
    { id: informeId },
  );
}

/* Registra el envio, pasa el informe a "enviado" (primer envio) y deja la bitacora. */
async function registrar(s: Session, user: CurrentUser, cargo: string, informe: Row, datos: { nombre: string; correo: string; enviadoEn: string; medio: "manual" | "smtp"; archivo: string | null; sha: string | null; messageId: string | null; observaciones: string | null }): Promise<number> {
  const result = await s.execute(
    `INSERT INTO ${TABLE} (informe_id, version, destinatario_nombre, destinatario_correo, enviado_en, enviado_por, enviado_rol, medio, evidencia_archivo, evidencia_sha256, message_id, observaciones, registrado_en)
     VALUES (:informe, :version, :nombre, :correo, :en, :por, :rol, :medio, :archivo, :sha, :mid, :obs, :registrado)`,
    { informe: informe.id, version: Number(informe.version || 1), nombre: datos.nombre, correo: datos.correo, en: datos.enviadoEn, por: userIdFromClaims(user), rol: cargo, medio: datos.medio, archivo: datos.archivo, sha: datos.sha, mid: datos.messageId, obs: datos.observaciones, registrado: new Date().toISOString() },
  );
  const envioId = result.lastrowid as number;
  if (String(informe.estado) === "liberado") await s.execute("UPDATE informes SET estado = 'enviado' WHERE id = :id", { id: informe.id });
  await registrarAuditoria(s, user, {
    accion: "enviar",
    entidad: "informes",
    entidadId: Number(informe.id),
    referencia: `${informeFolio(informe)} v${informe.version}`,
    motivo: datos.observaciones,
    detalle: { envio_id: envioId, medio: datos.medio, destinatario: datos.nombre, correo: correoOculto(datos.correo), enviado_en: datos.enviadoEn, version: informe.version, evidencia_sha256: datos.sha, message_id: datos.messageId, actuo_como: cargo },
  });
  return envioId;
}

/* ---------- Endpoints ---------- */

/* GET /api/informes/:id/envios (informes:V) */
export async function listarEnvios({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await requirePermission(s, user, "informes", "V");
  return json({ items: await listar(s, intParam(params.id)), smtp_disponible: !!smtpConfig() });
}

/* POST /api/informes/:id/envios (multipart): envio manual con evidencia. */
export async function registrarEnvioManual({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const actuo = cargoActuante(request, await requirePermission(s, user, "informes", "A"));
  const informe = await informeEnviable(s, intParam(params.id));
  const contentType = (request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("multipart/form-data")) throw new HttpError(400, { message: "Adjunta la evidencia del correo enviado (PDF, imagen o .eml)" });
  const form = await request.formData();
  const nombre = String(form.get("destinatario_nombre") || "").trim().slice(0, 180);
  const correo = String(form.get("destinatario_correo") || "").trim().toLowerCase().slice(0, 180);
  const enviadoEn = String(form.get("enviado_en") || "").trim();
  const observaciones = String(form.get("observaciones") || "").trim() || null;
  const archivo = form.get("evidencia");
  if (!nombre || !correoValido(correo)) throw new HttpError(400, { message: "Indica el nombre y un correo válido del destinatario" });
  if (!enviadoEn || Number.isNaN(Date.parse(enviadoEn))) throw new HttpError(400, { message: "Indica la fecha y hora del envío" });
  if (!(archivo instanceof File) || !archivo.name) throw new HttpError(400, { message: "Adjunta la evidencia del correo enviado (PDF, imagen o .eml)" });
  const ext = path.extname(archivo.name).toLowerCase();
  if (!EXTENSIONES.has(ext)) throw new HttpError(400, { message: "La evidencia debe ser PDF, imagen (PNG/JPG/WebP) o correo (.eml/.msg)" });
  const bytes = Buffer.from(await archivo.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) throw new HttpError(400, { message: "La evidencia está vacía o pesa más de 15 MB" });
  const sha = createHash("sha256").update(bytes).digest("hex");
  const nombreArchivo = `${informeFolio(informe).replace(/\s+/g, "-")}-v${informe.version}-envio-${Date.now()}${ext}`;
  await fs.promises.writeFile(path.join(enviosDir(), nombreArchivo), bytes);
  const envioId = await registrar(s, user, actuo.cargo, informe, { nombre, correo, enviadoEn: new Date(enviadoEn).toISOString(), medio: "manual", archivo: nombreArchivo, sha, messageId: null, observaciones });
  await s.commit();
  return json({ message: `Envío registrado a ${nombre}`, envio_id: envioId, items: await listar(s, Number(informe.id)) });
}

/* POST /api/informes/:id/envios/smtp { destinatario_nombre, destinatario_correo, observaciones? } */
export async function enviarPorSmtp({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const actuo = cargoActuante(request, await requirePermission(s, user, "informes", "A"));
  const cfg = smtpConfig();
  if (!cfg) throw new HttpError(404, { message: "El envío desde la plataforma no está configurado (SMTP_*)", codigo: "smtp_no_configurado" });
  const informe = await informeEnviable(s, intParam(params.id));
  const payload = await readJson(request);
  const nombre = String(payload.destinatario_nombre || "").trim().slice(0, 180);
  const correo = String(payload.destinatario_correo || "").trim().toLowerCase().slice(0, 180);
  const observaciones = String(payload.observaciones || "").trim() || null;
  if (!nombre || !correoValido(correo)) throw new HttpError(400, { message: "Indica el nombre y un correo válido del destinatario" });
  const pdf = await fs.promises.readFile(path.join(informesDir(), String(informe.archivo_pdf)));
  const folio = `${informeFolio(informe)} v${informe.version}`;
  let info: { messageId?: string; response?: unknown; envelope?: unknown; message?: unknown };
  try {
    info = (await (await transporte(cfg)).sendMail({
      from: cfg.from,
      to: `"${nombre.replace(/"/g, "")}" <${correo}>`,
      subject: `Informe de resultados ${folio}`,
      text: `Estimado(a) ${nombre}:\n\nAdjuntamos el informe de resultados ${folio}.\n\nLaboratorio FICOTOX`,
      attachments: [{ filename: String(informe.archivo_pdf), content: pdf, contentType: "application/pdf" }],
    })) as typeof info;
  } catch (error) {
    throw new HttpError(502, { message: `El servidor de correo rechazó el envío: ${(error as Error).message}` });
  }
  // Evidencia: Message-ID y respuesta del servidor (con el transporte de prueba, el mensaje generado).
  const evidencia = Buffer.from(JSON.stringify({ message_id: info.messageId, response: typeof info.response === "string" ? info.response : null, envelope: info.envelope, mensaje: Buffer.isBuffer(info.message) ? String(info.message).slice(0, 2000) : null }, null, 2));
  const sha = createHash("sha256").update(evidencia).digest("hex");
  const nombreArchivo = `${informeFolio(informe).replace(/\s+/g, "-")}-v${informe.version}-smtp-${Date.now()}.json`;
  await fs.promises.writeFile(path.join(enviosDir(), nombreArchivo), evidencia);
  const envioId = await registrar(s, user, actuo.cargo, informe, { nombre, correo, enviadoEn: new Date().toISOString(), medio: "smtp", archivo: nombreArchivo, sha, messageId: info.messageId || null, observaciones });
  await s.commit();
  return json({ message: `Informe enviado a ${nombre} desde la plataforma`, envio_id: envioId, message_id: info.messageId || null, items: await listar(s, Number(informe.id)) });
}

/* POST /api/informes/:id/envios/:envio/confirmar { confirmacion_en, confirmacion_nota } */
export async function confirmarEnvio({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await requirePermission(s, user, "informes", "A");
  const informeId = intParam(params.id);
  const envio = await s.queryOne<Row>(`SELECT * FROM ${TABLE} WHERE id = :id AND informe_id = :informe`, { id: intParam(params.envio), informe: informeId });
  if (!envio) throw new HttpError(404, { message: "Envío no encontrado" });
  if (envio.confirmacion_en) throw new HttpError(409, { message: "La confirmación de recepción ya está registrada" });
  const payload = await readJson(request);
  const en = String(payload.confirmacion_en || "").trim();
  const nota = String(payload.confirmacion_nota || "").trim() || null;
  if (!en || Number.isNaN(Date.parse(en))) throw new HttpError(400, { message: "Indica la fecha de la confirmación de recepción" });
  await s.execute(`UPDATE ${TABLE} SET confirmacion_en = :en, confirmacion_nota = :nota WHERE id = :id`, { en: new Date(en).toISOString(), nota, id: envio.id });
  const informe = await snapshotRow(s, "informes", informeId);
  await registrarAuditoria(s, user, { accion: "confirmar_envio", entidad: "informes", entidadId: informeId, referencia: `${informeFolio(informe)} v${envio.version}`, motivo: nota, detalle: { envio_id: envio.id, correo: correoOculto(String(envio.destinatario_correo)), confirmacion_en: en } });
  await s.commit();
  return json({ message: "Confirmación de recepción registrada", items: await listar(s, informeId) });
}

/* GET /api/informes/:id/envios/:envio/evidencia (informes:V) */
export async function descargarEvidencia({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await requirePermission(s, user, "informes", "V");
  const envio = await s.queryOne<Row>(`SELECT * FROM ${TABLE} WHERE id = :id AND informe_id = :informe`, { id: intParam(params.envio), informe: intParam(params.id) });
  if (!envio?.evidencia_archivo) throw new HttpError(404, { message: "Evidencia no encontrada" });
  const ruta = path.join(enviosDir(), String(envio.evidencia_archivo));
  if (!fs.existsSync(ruta)) throw new HttpError(404, { message: "El archivo de evidencia no está en el servidor" });
  const bytes = await fs.promises.readFile(ruta);
  const ext = path.extname(ruta).toLowerCase();
  const tipo = ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : [".jpg", ".jpeg"].includes(ext) ? "image/jpeg" : ext === ".json" ? "application/json" : "message/rfc822";
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "Content-Type": tipo, "Content-Disposition": `attachment; filename="${envio.evidencia_archivo}"`, "X-Evidencia-Sha256": String(envio.evidencia_sha256 || "") } });
}
