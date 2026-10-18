/*
 * Foto de perfil propia (opcional; la alternativa es la figura de la app).
 *
 * - El navegador recorta (circulo, zoom y encuadre) y envia la imagen ya
 *   cuadrada. El servidor valida por firma de bytes (JPG, PNG o WEBP; nunca
 *   SVG, HTML ni otra cosa), por tamaño (5 MB) y dimensiones, y la vuelve a
 *   codificar con sharp a WEBP en 512 y 128 px: los metadatos (EXIF, GPS,
 *   camara) se pierden y el archivo original nunca se guarda.
 * - Se guarda en <instancia>/avatares/<usuario_id>/<uuid>-512.webp y -128.webp.
 *   No es un registro regulado: al reemplazarla o quitarla se borran los
 *   archivos anteriores (privacidad). Va en los respaldos (carpeta opcional).
 * - Se sirve con sesion iniciada (GET /api/cuentas/:id/foto?tam=128|512&v=<version>),
 *   nosniff y cache larga por version: al cambiarla, la nueva version se ve de inmediato.
 * - Cada quien cambia o quita la suya; usuarios:G puede QUITAR la de otra
 *   persona con motivo (no subir una por ella). Subir y quitar quedan en la
 *   bitacora sin la imagen; elegir entre foto y figura no.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "sharp";
import { requireUser } from "../auth";
import { registrarAuditoria } from "../audit";
import { getConfig } from "../config";
import { type Row } from "../db";
import { HttpError, intParam, json, readJson, type RouteContext } from "../http";
import { searchParam } from "./helpers";
import { cargarAutorizacion, requirePermission } from "../rbac";
import { problemaDeContenido } from "../../shared/adjuntos";

const MAX_MB = 5;
const MAX_BYTES = MAX_MB * 1024 * 1024;
const TAMANOS = [512, 128] as const;
const FORMATO_NO_VALIDO = "Usa una foto JPG, PNG o WEBP";

const avataresDir = () => path.join(/*turbopackIgnore: true*/ getConfig().INSTANCE_DIR, "avatares");

/* Ruta de un tamaño; la base (<id>/<uuid>) nunca sale de la carpeta de avatares. */
function rutaFoto(base: string, tam: number): string {
  const raiz = path.resolve(/*turbopackIgnore: true*/ avataresDir());
  const ruta = path.resolve(/*turbopackIgnore: true*/ raiz, `${base}-${tam}.webp`);
  if (!ruta.startsWith(raiz + path.sep) || !/^\d+\/[0-9a-f-]{36}$/.test(base)) throw new HttpError(400, { message: "Ruta de foto no válida" });
  return ruta;
}

/* Version publica de la foto (el uuid de su base): cambia con cada foto nueva. */
export const versionFoto = (base: unknown): string | null => (base ? String(base).split("/")[1] || null : null);

/* Tipo real por firma de bytes (no por la extension). */
function tipoReal(bytes: Buffer): "jpg" | "png" | "webp" | null {
  for (const ext of ["jpg", "png", "webp"] as const) if (!problemaDeContenido(ext, bytes)) return ext;
  return null;
}

async function borrarFoto(base: unknown): Promise<void> {
  if (!base) return;
  for (const tam of TAMANOS) await fs.promises.rm(rutaFoto(String(base), tam), { force: true }).catch(() => undefined);
}

/* Lee, valida y recodifica la imagen; devuelve los dos WEBP sin metadatos. */
async function procesar(request: Request): Promise<Record<number, Buffer>> {
  const declarado = Number(request.headers.get("content-length") || 0);
  if (declarado && declarado > MAX_BYTES + 64 * 1024) throw new HttpError(413, { message: `La foto pesa más de ${MAX_MB} MB`, codigo: "archivo_grande" });
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("multipart/form-data")) throw new HttpError(400, { message: "Envía la foto como archivo" });
  let archivo: FormDataEntryValue | null = null;
  try {
    archivo = (await request.formData()).get("archivo");
  } catch {
    throw new HttpError(400, { message: "No se pudo leer la foto enviada" });
  }
  if (!(archivo instanceof File)) throw new HttpError(400, { message: "Elige una foto" });
  if (archivo.size > MAX_BYTES) throw new HttpError(413, { message: `La foto pesa más de ${MAX_MB} MB`, codigo: "archivo_grande" });
  const bytes = Buffer.from(await archivo.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) throw new HttpError(bytes.length ? 413 : 400, { message: bytes.length ? `La foto pesa más de ${MAX_MB} MB` : "La foto está vacía" });
  if (!tipoReal(bytes)) throw new HttpError(400, { message: FORMATO_NO_VALIDO, codigo: "formato_no_permitido" });
  // sharp solo se carga al procesar una foto.
  const { default: sharp } = await import("sharp");
  let meta: Metadata;
  try {
    meta = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
  } catch {
    throw new HttpError(400, { message: FORMATO_NO_VALIDO, codigo: "contenido_no_valido" });
  }
  if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format)) throw new HttpError(400, { message: FORMATO_NO_VALIDO, codigo: "formato_no_permitido" });
  if (!meta.width || !meta.height || meta.width < 64 || meta.height < 64 || meta.width > 6000 || meta.height > 6000) throw new HttpError(400, { message: "La foto debe medir entre 64 y 6000 píxeles por lado" });
  const out: Record<number, Buffer> = {};
  for (const tam of TAMANOS) {
    // rotate() aplica la orientacion EXIF; sharp no copia metadatos al recodificar.
    out[tam] = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize(tam, tam, { fit: "cover", position: "centre" }).webp({ quality: 86 }).toBuffer();
  }
  return out;
}

/* Escribe los dos tamaños (temporal + rename) y devuelve la base. */
async function guardar(usuarioId: number, webp: Record<number, Buffer>): Promise<string> {
  const base = `${usuarioId}/${randomUUID()}`;
  await fs.promises.mkdir(path.join(/*turbopackIgnore: true*/ avataresDir(), String(usuarioId)), { recursive: true });
  for (const tam of TAMANOS) {
    const destino = rutaFoto(base, tam);
    const temporal = `${destino}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporal, webp[tam], { mode: 0o640 });
    await fs.promises.rename(temporal, destino);
  }
  return base;
}

/* POST /api/auth/me/foto (multipart: archivo): sube o reemplaza la propia foto y pasa a mostrarla. */
export async function subirMiFoto({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const auth = await cargarAutorizacion(s, user, { permitirCambioPendiente: true });
  const webp = await procesar(request);
  const antes = await s.queryOne<Row>("SELECT foto FROM usuarios WHERE id = :id", { id: auth.userId });
  const base = await guardar(auth.userId, webp);
  try {
    await s.execute("UPDATE usuarios SET foto = :foto, usa_foto = 1 WHERE id = :id", { foto: base, id: auth.userId });
    await registrarAuditoria(s, user, { accion: "editar", entidad: "usuarios", entidadId: auth.userId, referencia: String(user.email || ""), detalle: { foto_perfil: "cambiada" } });
    await s.commit();
  } catch (error) {
    await borrarFoto(base);
    throw error;
  }
  await borrarFoto(antes?.foto);
  return json({ message: "Foto de perfil actualizada", foto: versionFoto(base), usa_foto: true });
}

/* DELETE /api/auth/me/foto: quita la propia foto (se borran los archivos) y vuelve a la figura. */
export async function quitarMiFoto({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const auth = await cargarAutorizacion(s, user, { permitirCambioPendiente: true });
  const antes = await s.queryOne<Row>("SELECT foto FROM usuarios WHERE id = :id", { id: auth.userId });
  if (!antes?.foto) return json({ message: "No tienes foto de perfil" });
  await s.execute("UPDATE usuarios SET foto = NULL, usa_foto = 0 WHERE id = :id", { id: auth.userId });
  await registrarAuditoria(s, user, { accion: "editar", entidad: "usuarios", entidadId: auth.userId, referencia: String(user.email || ""), detalle: { foto_perfil: "quitada" } });
  await s.commit();
  await borrarFoto(antes.foto);
  return json({ message: "Foto de perfil quitada", foto: null, usa_foto: false });
}

/* PUT /api/auth/me/foto { usa_foto }: mostrar la foto o la figura (sin perder la otra; sin bitacora). */
export async function usarMiFoto({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const auth = await cargarAutorizacion(s, user, { permitirCambioPendiente: true });
  const usa = !!(await readJson(request)).usa_foto;
  const fila = await s.queryOne<Row>("SELECT foto FROM usuarios WHERE id = :id", { id: auth.userId });
  if (usa && !fila?.foto) throw new HttpError(400, { message: "Primero sube una foto" });
  await s.execute("UPDATE usuarios SET usa_foto = :u WHERE id = :id", { u: usa ? 1 : 0, id: auth.userId });
  await s.commit();
  return json({ message: usa ? "Se muestra tu foto" : "Se muestra tu figura", usa_foto: usa });
}

/* DELETE /api/admin/usuarios/:id/foto { motivo }: usuarios:G quita la foto de otra persona (no sube una por ella). */
export async function quitarFotoDe({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await requirePermission(s, user, "usuarios", "G");
  const id = intParam(params.id);
  const motivo = String((await readJson(request)).motivo || "").trim();
  if (motivo.length < 5) throw new HttpError(400, { message: "Escribe el motivo (al menos 5 caracteres)", campo: "motivo" });
  const fila = await s.queryOne<Row>("SELECT id, nombre, email, foto FROM usuarios WHERE id = :id", { id });
  if (!fila) throw new HttpError(404, { message: "Usuario no encontrado" });
  if (!fila.foto) return json({ message: "La persona no tiene foto de perfil" });
  await s.execute("UPDATE usuarios SET foto = NULL, usa_foto = 0 WHERE id = :id", { id });
  await registrarAuditoria(s, user, { accion: "editar", entidad: "usuarios", entidadId: id, referencia: String(fila.nombre || fila.email || ""), motivo: motivo.slice(0, 500), detalle: { foto_perfil: "quitada_por_otro" } });
  await s.commit();
  await borrarFoto(fila.foto);
  return json({ message: "Foto de perfil quitada" });
}

/* GET /api/cuentas/:id/foto?tam=128|512&v=<version>: la foto con sesion iniciada. */
export async function servirFoto({ request, s, params }: RouteContext): Promise<Response> {
  await requireUser(request);
  const id = intParam(params.id);
  const tam = searchParam(request, "tam") === "512" ? 512 : 128;
  const fila = await s.queryOne<Row>("SELECT foto FROM usuarios WHERE id = :id", { id });
  if (!fila?.foto) throw new HttpError(404, { message: "Sin foto de perfil" });
  let bytes: Buffer;
  try {
    bytes = await fs.promises.readFile(rutaFoto(String(fila.foto), tam));
  } catch {
    throw new HttpError(404, { message: "Sin foto de perfil" });
  }
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(bytes.length),
      "X-Content-Type-Options": "nosniff",
      // La URL lleva la version (?v=): una foto nueva es otra URL y se ve de inmediato.
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Disposition": "inline",
    },
  });
}
