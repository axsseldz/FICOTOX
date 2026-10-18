/*
 * Operaciones comunes sobre adjuntos (Fase 10, generalizadas en la Fase 11):
 * subir, descargar con verificacion de integridad y anular. Las reglas de quien
 * puede hacerlo viven en el modulo de cada entidad (analisis, incidencia,
 * accion correctiva); aqui solo lo comun, para no duplicar logica.
 */
import type { CurrentUser } from "./auth";
import { userIdFromClaims } from "./auth";
import { registrarAuditoria } from "./audit";
import { type Row, type Session } from "./db";
import { HttpError, json } from "./http";
import { adjuntoPorId, anularAdjuntoFila, contentDisposition, descartarArchivo, duplicadoVigente, guardarArchivo, insertarAdjunto, integridadAdjunto, leerArchivo, serializarAdjunto, type ArchivoGuardado } from "./adjuntos";
import { incidenciaPorAlertaIntegridad } from "./modules/calidad/automaticas";
import { MIME_EVIDENCIA, MOTIVO_MIN, TIPO_EVIDENCIA_LABEL, VISTA_PREVIA, type EntidadAdjunto } from "../shared/adjuntos";

/* Donde queda cada evento en la bitacora (el registro "duenio" del adjunto). */
export interface ContextoAdjunto {
  auditEntidad: string;
  auditId: number;
  referencia: string;
  /* Frase corta del registro para la alerta de integridad ("el análisis A 0000001"). */
  que: string;
}

const detalleAdjunto = (a: Row) => ({ adjunto_id: Number(a.id), tipo_evidencia: String(a.tipo_evidencia), descripcion: String(a.descripcion), nombre: String(a.nombre_original), tamano_bytes: Number(a.tamano_bytes), sha256: String(a.sha256) });

/*
 * Sube un archivo (multipart: archivo, tipo_evidencia, descripcion). `antesDeInsertar`
 * corre despues de escribir el archivo y dentro de la transaccion (p. ej. supervision).
 * Si algo falla, rollback y el archivo se borra (sin huerfanos).
 */
export async function subirAdjunto(
  s: Session,
  user: CurrentUser,
  request: Request,
  entidad: EntidadAdjunto,
  entidadId: number,
  ctx: ContextoAdjunto & { cargo: string | null; detalleExtra?: Record<string, unknown>; despues?: () => Promise<void> },
): Promise<Response> {
  const archivo = await leerArchivo(request);
  let guardado: ArchivoGuardado | null = null;
  try {
    guardado = await guardarArchivo(entidad, entidadId, archivo.extension, archivo.bytes);
    const duplicado = await duplicadoVigente(s, entidad, entidadId, guardado.sha256);
    if (duplicado) throw new HttpError(409, { message: `Ese archivo ya está adjunto (${String(duplicado.descripcion)})`, codigo: "adjunto_duplicado" });
    const adjuntoId = await insertarAdjunto(s, {
      entidad,
      entidad_id: entidadId,
      tipo_evidencia: archivo.tipo_evidencia,
      descripcion: archivo.descripcion,
      nombre_original: archivo.nombre_original,
      nombre_almacenado: guardado.nombre_almacenado,
      mime: MIME_EVIDENCIA[archivo.extension] || "application/octet-stream",
      extension: archivo.extension,
      tamano_bytes: guardado.tamano_bytes,
      sha256: guardado.sha256,
      subido_por: userIdFromClaims(user),
      subido_rol: ctx.cargo,
    });
    if (ctx.despues) await ctx.despues();
    const adjunto = (await adjuntoPorId(s, adjuntoId))!;
    await registrarAuditoria(s, user, { accion: "adjuntar", entidad: ctx.auditEntidad, entidadId: ctx.auditId, referencia: ctx.referencia, detalle: { ...detalleAdjunto(adjunto), ...(ctx.detalleExtra || {}) } });
    await s.commit();
    return json({ message: `${TIPO_EVIDENCIA_LABEL[archivo.tipo_evidencia] || "Evidencia"} adjuntada`, item: serializarAdjunto(adjunto, { integridad: "ok" }) }, 201);
  } catch (error) {
    await s.rollback();
    await descartarArchivo(guardado);
    throw error;
  }
}

/* Descarga (o vista previa) verificando el SHA-256; alerta de integridad e incidencia automatica si no coincide o falta. */
export async function servirAdjunto(s: Session, user: CurrentUser, request: Request, adjunto: Row, ctx: ContextoAdjunto): Promise<Response> {
  const integridad = await integridadAdjunto(adjunto);
  if (integridad.estado !== "ok") {
    await registrarAuditoria(s, user, { accion: "alerta_integridad", entidad: ctx.auditEntidad, entidadId: ctx.auditId, referencia: ctx.referencia, detalle: { ...detalleAdjunto(adjunto), integridad: integridad.estado, esperado: adjunto.sha256, obtenido: integridad.sha256 } });
    await incidenciaPorAlertaIntegridad(s, {
      clave: `adjunto:${adjunto.id}:${integridad.estado}`,
      descripcion: `El adjunto "${String(adjunto.descripcion)}" (${String(adjunto.nombre_original)}) de ${ctx.que} ${integridad.estado === "faltante" ? "no está en el servidor" : "no coincide con su huella SHA-256"} (alerta de integridad).`,
      registros: [{ entidad: ctx.auditEntidad, entidad_id: ctx.auditId, referencia: ctx.referencia }],
    });
  }
  if (integridad.estado === "faltante" || !integridad.bytes) {
    await s.commit();
    return new Response(JSON.stringify({ message: "El archivo no está en el servidor; se registró una alerta de integridad", codigo: "archivo_faltante" }), { status: 404, headers: { "Content-Type": "application/json", "X-Integridad-Adjunto": "faltante" } });
  }
  const ext = String(adjunto.extension);
  const inline = new URL(request.url).searchParams.get("inline") === "1" && VISTA_PREVIA.has(ext);
  await registrarAuditoria(s, user, { accion: "descargar", entidad: ctx.auditEntidad, entidadId: ctx.auditId, referencia: ctx.referencia, detalle: { adjunto_id: Number(adjunto.id), tipo_evidencia: String(adjunto.tipo_evidencia), nombre: String(adjunto.nombre_original), ...(inline ? { vista_previa: true } : {}) } });
  await s.commit();
  return new Response(new Uint8Array(integridad.bytes), {
    status: 200,
    headers: {
      "Content-Type": MIME_EVIDENCIA[ext] || "application/octet-stream",
      "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", String(adjunto.nombre_original)),
      "Content-Length": String(integridad.bytes.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "X-Adjunto-Sha256": String(adjunto.sha256),
      "X-Integridad-Adjunto": integridad.estado,
    },
  });
}

/* Anula (motivo ya validado y reautenticacion ya exigida por quien llama). El archivo se conserva. */
export async function anularAdjuntoComun(s: Session, user: CurrentUser, adjunto: Row, motivo: string, ctx: ContextoAdjunto & { cargo: string | null; detalleExtra?: Record<string, unknown> }): Promise<void> {
  if (motivo.length < MOTIVO_MIN) throw new HttpError(400, { message: `Indica el motivo de la anulación (al menos ${MOTIVO_MIN} caracteres)` });
  const vigente = await adjuntoPorId(s, Number(adjunto.id), true);
  if (!vigente || vigente.anulado_en || !(await anularAdjuntoFila(s, Number(adjunto.id), { por: userIdFromClaims(user), rol: ctx.cargo, motivo }))) throw new HttpError(409, { message: "El adjunto ya está anulado" });
  await registrarAuditoria(s, user, { accion: "anular_adjunto", entidad: ctx.auditEntidad, entidadId: ctx.auditId, referencia: ctx.referencia, motivo, detalle: { ...detalleAdjunto(adjunto), ...(ctx.detalleExtra || {}) } });
}
