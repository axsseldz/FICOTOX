/*
 * Flujo anterior de control documental (Fase 7) — RETIRADO; el vigente es
 * Documentos SGC (modules/sgc). La migracion 13 copio a la Biblioteca (tambien
 * retirada) los documentos con archivo (con su SHA-256); las tablas documentos_sgc, distribucion_documento y
 * propuestas_documento se conservan sin uso y en solo lectura. Aqui queda solo
 * la lectura de un documento anterior y de su archivo (historial); las demas
 * rutas responden 410.
 */
import fs from "node:fs";
import path from "node:path";
import { requireUser } from "../auth";
import { registrarAuditoria, snapshotRow } from "../audit";
import { getConfig } from "../config";
import { type Row } from "../db";
import { intParam, json, type RouteContext } from "../http";
import { requirePermission } from "../rbac";
import { excepcionesDe } from "../segregacion";
import { distribucionDe, documentosDistribuidosA, soloAutorizados } from "./documentos-flujo";

const TABLE = "documentos_sgc";

const filesDir = (): string => path.join(/*turbopackIgnore: true*/ getConfig().INSTANCE_DIR, "documentos_sgc");

function safeParse(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const docRef = (row: Row | null | undefined): string => (row ? `${row.clave}-${row.revision}` : "");

function serializeDocumento(row: Row): Row {
  const item: Row = { ...row, excepciones: excepcionesDe(row), excepciones_json: undefined };
  for (const key of ["elaboro", "reviso", "aprobo", "revision_tecnica", "publico"]) {
    item[key] = safeParse(item[`${key}_json`]);
    delete item[`${key}_json`];
  }
  item.referencia = `${row.clave} rev. ${row.revision}`;
  item.archivo_url = row.archivo_nombre ? `/api/documentos-sgc/${row.id}/archivo` : null;
  item.retirado = true;
  return item;
}

/* GET /api/documentos-sgc/:id — solo lectura (historial de un documento anterior). */
export async function getDocumento({ request, s, params }: RouteContext): Promise<Response> {
  const id = intParam(params.id);
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "documentos", "V");
  const row = await snapshotRow(s, TABLE, id);
  if (!row) return json({ message: "Documento no encontrado" }, 404);
  const autorizados = soloAutorizados(permiso.auth);
  if (autorizados && (String(row.estado) !== "vigente" || !(await documentosDistribuidosA(s, permiso.auth.userId)).includes(id))) return json({ message: "Documento no encontrado" }, 404);
  const revisiones = autorizados ? [] : await s.query(`SELECT id, revision, estado, fecha_emision, fecha_vigencia, cambios FROM ${TABLE} WHERE clave = :clave ORDER BY revision DESC`, { clave: row.clave });
  const distribucion = await distribucionDe(s, id);
  return json({ item: { ...serializeDocumento(row), revisiones, distribucion_lectura: autorizados ? [] : distribucion } });
}

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain; charset=utf-8",
};

/* GET /api/documentos-sgc/:id/archivo — descarga del archivo de un documento anterior (queda en la bitacora). */
export async function getDocumentoArchivo({ request, s, params }: RouteContext): Promise<Response> {
  const id = intParam(params.id);
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "documentos", "V");
  const row = await snapshotRow(s, TABLE, id);
  if (!row || !row.archivo_nombre) return json({ message: "Archivo no encontrado" }, 404);
  if (soloAutorizados(permiso.auth) && (String(row.estado) !== "vigente" || !(await documentosDistribuidosA(s, permiso.auth.userId)).includes(id))) return json({ message: "Este documento no te fue distribuido" }, 403);
  const raiz = path.resolve(/*turbopackIgnore: true*/ filesDir());
  const target = path.resolve(/*turbopackIgnore: true*/ raiz, String(row.archivo_nombre));
  if (!target.startsWith(raiz + path.sep) || !fs.existsSync(target)) return json({ message: "Archivo no encontrado" }, 404);
  const data = await fs.promises.readFile(target);
  await registrarAuditoria(s, user, { accion: "descargar", entidad: TABLE, entidadId: id, referencia: docRef(row) });
  await s.commit();
  const ext = path.extname(target).toLowerCase();
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: { "Content-Type": MIME[ext] || "application/octet-stream", "Content-Length": String(data.length), "Content-Disposition": `attachment; filename="${row.clave}-${row.revision}${ext}"`, "X-Content-Type-Options": "nosniff" },
  });
}
