import fs from "node:fs";
import path from "node:path";
import { requireUser, userIdFromClaims, type CurrentUser } from "../auth";
import { descartarArchivo, guardarArchivoEn, validarArchivoSubido, type ArchivoGuardado } from "../adjuntos";
import { registrarAuditoria } from "../audit";
import { getConfig } from "../config";
import { isSqlite, type Row, type Session } from "../db";
import { HttpError, json, readJson, type RouteContext } from "../http";
import { cargarAutorizacion, permisoDe, requirePermission } from "../rbac";
import { exigirReauth } from "../seguridad";
import { MOTIVO_MIN } from "../../shared/adjuntos";
import { hoyLocal } from "../../shared/fechas";

/*
 * Reportes PDF de mantenimiento (el reporte de servicio del proveedor o tecnico).
 * Portado de modules/documents/endpoints.py del backend Flask original.
 * - Adjuntar, reemplazar o quitar: quien puede registrar o editar mantenimientos
 *   (equipos:C o equipos:E de mantenimiento). Ver: equipos:V.
 * - Solo PDF real (firma %PDF- y sin contenido activo), con el limite de la evidencia
 *   (EVIDENCIA_MAX_MB) y huella SHA-256; el archivo va a
 *   <instancia>/maintenance_reports/<mantenimiento>/<uuid>.pdf (entra en los respaldos).
 * - Nada se borra: quitar o reemplazar anula el reporte con motivo y contrasena; el
 *   archivo se conserva y todo queda en la bitacora.
 */

function reportsUploadDir(): string {
  const folder = path.join(/*turbopackIgnore: true*/ getConfig().INSTANCE_DIR, "maintenance_reports");
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

const conBloqueo = () => (isSqlite() ? "" : " FOR UPDATE");

async function nextReportCode(s: Session, mantenimientoId: number): Promise<string> {
  const count = Number((await s.scalar("SELECT COUNT(*) FROM reportes_mantenimiento WHERE id_mantenimiento = :id", { id: mantenimientoId })) || 0);
  return `RM-${String(mantenimientoId).padStart(5, "0")}-${String(count + 1).padStart(2, "0")}`;
}

/* Registrar o editar mantenimientos (cualquiera de los dos) permite adjuntar, reemplazar y quitar el reporte. */
async function exigirGestionReportes(s: Session, user: CurrentUser): Promise<void> {
  const auth = await cargarAutorizacion(s, user);
  if (permisoDe(auth, "equipos", "C", { objeto: "mantenimiento" }) || permisoDe(auth, "equipos", "E", { objeto: "mantenimiento" })) return;
  await requirePermission(s, user, "equipos", "C", { objeto: "mantenimiento" }, auth);
}

async function puedeGestionarReportes(s: Session, user: CurrentUser): Promise<boolean> {
  const auth = await cargarAutorizacion(s, user);
  return !!(permisoDe(auth, "equipos", "C", { objeto: "mantenimiento" }) || permisoDe(auth, "equipos", "E", { objeto: "mantenimiento" }));
}

const detalleReporte = (r: Row) => ({ reporte_id: Number(r.id), codigo: String(r.codigo), id_mantenimiento: Number(r.id_mantenimiento), nombre: r.nombre_original ?? null, tamano_bytes: r.tamano_bytes === null || r.tamano_bytes === undefined ? null : Number(r.tamano_bytes), sha256: r.sha256 ?? null });

/* GET /api/documents[?mantenimiento=ID]: reportes vigentes (los quitados o reemplazados no se listan). */
export async function listDocuments({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await requirePermission(s, user, "equipos", "V");
  const raw = new URL(request.url).searchParams.get("mantenimiento") || "";
  const mantenimiento = /^\d+$/.test(raw) ? Number(raw) : 0;

  const rows = await s.query(
    `
    SELECT rm.id, rm.codigo, rm.version, rm.estado, rm.fecha_reporte, rm.id_mantenimiento,
           rm.archivo_url, rm.nombre_original, rm.tamano_bytes, rm.sha256, rm.creado_en,
           m.tipo AS tipo_mantenimiento, e.nombre AS equipo, u.nombre AS subido_por_nombre
    FROM reportes_mantenimiento rm
    LEFT JOIN mantenimientos m ON m.id = rm.id_mantenimiento
    LEFT JOIN equipos e ON e.id = m.id_equipo
    LEFT JOIN usuarios u ON u.id = rm.subido_por
    WHERE rm.anulado_en IS NULL AND (:mantenimiento = 0 OR rm.id_mantenimiento = :mantenimiento)
    ORDER BY rm.fecha_reporte DESC, rm.id DESC
    LIMIT 200
    `,
    { mantenimiento },
  );
  return json({ items: rows, total: rows.length, puede_gestionar: await puedeGestionarReportes(s, user) });
}

/*
 * POST /api/documents/maintenance-report (multipart): archivo (PDF), id_mantenimiento,
 * fecha_reporte (por omision hoy). Con reemplaza_id y motivo (reautenticacion
 * mantenimiento:reporte) sustituye un reporte vigente del mismo mantenimiento.
 */
export async function createMaintenanceReport({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await exigirGestionReportes(s, user);
  const cfg = getConfig();
  const limite = cfg.EVIDENCIA_MAX_MB * 1024 * 1024;
  const declarado = Number(request.headers.get("content-length") || 0);
  if (declarado && declarado > limite + 64 * 1024) throw new HttpError(413, { message: `El archivo pesa más de ${cfg.EVIDENCIA_MAX_MB} MB`, codigo: "archivo_grande" });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, { message: "Envía el archivo como multipart/form-data (campo archivo)" });
  }
  const file = form.get("archivo");
  if (!(file instanceof File) || !file.name) throw new HttpError(400, { message: "Adjunta el reporte en PDF" });

  const rawMantenimientoId = String(form.get("id_mantenimiento") ?? "").trim();
  const mantenimientoId = /^\d+$/.test(rawMantenimientoId) ? Number.parseInt(rawMantenimientoId, 10) : 0;
  if (!mantenimientoId) throw new HttpError(400, { message: "Falta el mantenimiento vinculado" });
  const mantenimiento = await s.queryOne<Row>("SELECT id, estado FROM mantenimientos WHERE id = :id LIMIT 1", { id: mantenimientoId });
  if (!mantenimiento) throw new HttpError(404, { message: "Mantenimiento no encontrado" });

  const fechaReporte = String(form.get("fecha_reporte") || "").trim() || hoyLocal();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaReporte)) throw new HttpError(400, { message: "La fecha del reporte no es válida" });

  // Reemplazo: el anterior debe ser un reporte vigente de este mantenimiento; pide motivo y contrasena.
  const rawReemplaza = String(form.get("reemplaza_id") ?? "").trim();
  const reemplazaId = /^\d+$/.test(rawReemplaza) ? Number(rawReemplaza) : 0;
  const motivo = String(form.get("motivo") || "").trim();
  let anterior: Row | null = null;
  if (reemplazaId) {
    anterior = await s.queryOne<Row>(`SELECT * FROM reportes_mantenimiento WHERE id = :id${conBloqueo()}`, { id: reemplazaId });
    if (!anterior || Number(anterior.id_mantenimiento) !== mantenimientoId) throw new HttpError(404, { message: "El reporte que quieres reemplazar no existe en este mantenimiento" });
    if (anterior.anulado_en) throw new HttpError(409, { message: "Ese reporte ya fue quitado o reemplazado" });
    if (motivo.length < MOTIVO_MIN) throw new HttpError(400, { message: `Indica el motivo del reemplazo (al menos ${MOTIVO_MIN} caracteres)` });
  }

  const valido = await validarArchivoSubido(file, { limiteBytes: limite, limiteMb: cfg.EVIDENCIA_MAX_MB, extensiones: ["pdf"] });
  if (reemplazaId) await exigirReauth(s, request, user, "mantenimiento:reporte");

  let guardado: ArchivoGuardado | null = null;
  try {
    guardado = await guardarArchivoEn(reportsUploadDir(), String(mantenimientoId), "pdf", valido.bytes);
    const codigo = await nextReportCode(s, mantenimientoId);
    const version = anterior ? `${(Number.parseInt(String(anterior.version || "1"), 10) || 1) + 1}.0` : "1.0";
    const archivoUrl = `/api/documents/files/${guardado.nombre_almacenado}`;
    const result = await s.execute(
      `
      INSERT INTO reportes_mantenimiento (
        codigo, id_mantenimiento, version, estado, fecha_reporte, archivo_url,
        nombre_almacenado, nombre_original, tamano_bytes, sha256, subido_por
      )
      VALUES (
        :codigo, :id_mantenimiento, :version, 'publicado', :fecha_reporte, :archivo_url,
        :nombre_almacenado, :nombre_original, :tamano_bytes, :sha256, :subido_por
      )
      `,
      { codigo, id_mantenimiento: mantenimientoId, version, fecha_reporte: fechaReporte, archivo_url: archivoUrl, nombre_almacenado: guardado.nombre_almacenado, nombre_original: valido.nombre_original, tamano_bytes: guardado.tamano_bytes, sha256: guardado.sha256, subido_por: userIdFromClaims(user) },
    );
    const nuevoId = Number(result.lastrowid);
    const nuevo = { id: nuevoId, codigo, id_mantenimiento: mantenimientoId, nombre_original: valido.nombre_original, tamano_bytes: guardado.tamano_bytes, sha256: guardado.sha256 };
    if (anterior) {
      const r = await s.execute("UPDATE reportes_mantenimiento SET anulado_en = :en, anulado_por = :por, motivo_anulacion = :motivo, reemplazado_por = :nuevo WHERE id = :id AND anulado_en IS NULL", { en: new Date().toISOString(), por: userIdFromClaims(user), motivo, nuevo: nuevoId, id: anterior.id });
      if (!r.rowcount) throw new HttpError(409, { message: "Ese reporte ya fue quitado o reemplazado" });
      await registrarAuditoria(s, user, { accion: "sustituir", entidad: "reportes_mantenimiento", entidadId: Number(anterior.id), referencia: String(anterior.codigo), motivo, detalle: { ...detalleReporte(anterior), reemplazado_por: detalleReporte(nuevo) } });
    }
    await registrarAuditoria(s, user, { accion: "crear", entidad: "reportes_mantenimiento", entidadId: nuevoId, referencia: codigo, detalle: { ...detalleReporte(nuevo), ...(anterior ? { reemplaza: Number(anterior.id) } : {}) } });
    await s.commit();
    return json({ message: anterior ? "Reporte reemplazado; el anterior se conserva en la bitácora" : "Reporte PDF adjuntado", id: nuevoId, codigo, archivo_url: archivoUrl, sha256: guardado.sha256 }, 201);
  } catch (error) {
    await descartarArchivo(guardado);
    throw error;
  }
}

/* POST /api/documents/maintenance-report/:id/quitar { motivo } (reautenticacion mantenimiento:reporte). El archivo se conserva. */
export async function quitarReporteMantenimiento({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await exigirGestionReportes(s, user);
  const id = /^\d+$/.test(String(params.id || "")) ? Number(params.id) : 0;
  const reporte = id ? await s.queryOne<Row>(`SELECT * FROM reportes_mantenimiento WHERE id = :id${conBloqueo()}`, { id }) : null;
  if (!reporte) throw new HttpError(404, { message: "Reporte no encontrado" });
  if (reporte.anulado_en) throw new HttpError(409, { message: "Ese reporte ya fue quitado o reemplazado" });
  const motivo = String((await readJson(request)).motivo || "").trim();
  if (motivo.length < MOTIVO_MIN) throw new HttpError(400, { message: `Indica el motivo (al menos ${MOTIVO_MIN} caracteres)` });
  await exigirReauth(s, request, user, "mantenimiento:reporte");
  const r = await s.execute("UPDATE reportes_mantenimiento SET anulado_en = :en, anulado_por = :por, motivo_anulacion = :motivo WHERE id = :id AND anulado_en IS NULL", { en: new Date().toISOString(), por: userIdFromClaims(user), motivo, id });
  if (!r.rowcount) throw new HttpError(409, { message: "Ese reporte ya fue quitado o reemplazado" });
  await registrarAuditoria(s, user, { accion: "anular", entidad: "reportes_mantenimiento", entidadId: id, referencia: String(reporte.codigo), motivo, detalle: detalleReporte(reporte) });
  await s.commit();
  return json({ message: "Reporte quitado; el archivo se conserva y queda en la bitácora" });
}

const MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
};

export async function getDocumentFile({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await requirePermission(s, user, "equipos", "V");

  const parts = Array.isArray(params.filename) ? params.filename : [String(params.filename || "")];
  const relative = parts.map((part) => decodeURIComponent(part)).join("/");
  const baseDir = reportsUploadDir();
  const target = path.resolve(baseDir, relative);
  if (!target.startsWith(baseDir + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return json({ message: "Ruta no encontrada" }, 404);
  }

  const contentType = MIME_TYPES[path.extname(target).toLowerCase()] || "application/octet-stream";
  const data = await fs.promises.readFile(target);
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(data.length),
      "Content-Disposition": `inline; filename="${path.basename(target)}"`,
    },
  });
}
