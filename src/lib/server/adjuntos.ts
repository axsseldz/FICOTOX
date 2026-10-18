/*
 * Adjuntos (Fase 10): almacenamiento y registro de la evidencia instrumental.
 * Tabla generica `adjuntos` (entidad + entidad_id) pensada para reutilizarse en
 * incidencias y otros registros; las reglas de quien puede adjuntar, ver o
 * anular viven en el modulo de cada entidad (analisis: modules/samples/analisis-adjuntos.ts).
 *
 * - Nada se borra: un adjunto se anula con motivo y el archivo se conserva.
 * - El archivo se guarda en <instance>/evidencias/<entidad>/<entidad_id>/<uuid>.<ext>;
 *   el nombre original solo se guarda como dato (saneado) y nunca se usa como ruta.
 * - Escritura: archivo temporal en la misma carpeta, SHA-256 calculado mientras se
 *   escribe y rename atomico; el registro se inserta en la transaccion de la
 *   peticion. Si la transaccion falla, quien llama elimina el archivo (descartarArchivo).
 * - Cada descarga recalcula el SHA-256 (integridad: ok | alterado | faltante).
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "./config";
import { isSqlite, type Row, type Session } from "./db";
import { HttpError } from "./http";

import { DESCRIPCION_MIN, EXTENSIONES_EVIDENCIA, TIPOS_EVIDENCIA, extensionDe, problemaDeContenido, sanearNombre, type EntidadAdjunto } from "../shared/adjuntos";

const TABLE = "adjuntos";
const TIPOS = new Set<string>(TIPOS_EVIDENCIA.map((t) => t.value));

/* Carpeta raiz de las evidencias (dentro de la instancia). */
function evidenciasDir(): string {
  return path.join(/*turbopackIgnore: true*/ getConfig().INSTANCE_DIR, "evidencias");
}

/* Ruta absoluta de un archivo almacenado; nunca sale de su carpeta raiz (evidencias, biblioteca). */
export function rutaEn(raizDir: string, nombreAlmacenado: unknown): string {
  const raiz = path.resolve(/*turbopackIgnore: true*/ raizDir);
  const ruta = path.resolve(/*turbopackIgnore: true*/ raiz, String(nombreAlmacenado || ""));
  if (!ruta.startsWith(raiz + path.sep)) throw new HttpError(400, { message: "Ruta de archivo no válida" });
  return ruta;
}

/* Ruta absoluta de un adjunto; el nombre almacenado nunca sale de la carpeta de evidencias. */
function rutaAdjunto(row: Row): string {
  return rutaEn(evidenciasDir(), row.nombre_almacenado);
}

const maxBytes = () => getConfig().EVIDENCIA_MAX_MB * 1024 * 1024;

export function serializarAdjunto(row: Row, extra: Record<string, unknown> = {}): Row {
  const { nombre_almacenado: _almacenado, ...resto } = row;
  void _almacenado;
  return { ...resto, vigente: !row.anulado_en, ...extra };
}

/* Integridad del archivo en disco contra el SHA-256 registrado. */
export async function integridadAdjunto(row: Row): Promise<{ estado: "ok" | "alterado" | "faltante"; sha256: string | null; bytes: Buffer | null }> {
  return integridadArchivo(rutaAdjunto(row), row.sha256);
}

/* Integridad de un archivo cualquiera (adjunto, biblioteca) contra su SHA-256: ok | alterado | faltante. */
export async function integridadArchivo(ruta: string, shaEsperado: unknown): Promise<{ estado: "ok" | "alterado" | "faltante"; sha256: string | null; bytes: Buffer | null }> {
  let bytes: Buffer;
  try {
    bytes = await fs.promises.readFile(ruta);
  } catch {
    return { estado: "faltante", sha256: null, bytes: null };
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { estado: sha256 === String(shaEsperado) ? "ok" : "alterado", sha256, bytes };
}

export async function listarAdjuntos(s: Session, entidad: EntidadAdjunto, entidadId: number): Promise<Row[]> {
  return s.query<Row>(
    `SELECT a.*, u.nombre AS subido_por_nombre, n.nombre AS anulado_por_nombre
     FROM ${TABLE} a LEFT JOIN usuarios u ON u.id = a.subido_por LEFT JOIN usuarios n ON n.id = a.anulado_por
     WHERE a.entidad = :entidad AND a.entidad_id = :id ORDER BY a.id`,
    { entidad, id: entidadId },
  );
}

export async function adjuntoPorId(s: Session, id: number, bloquear = false): Promise<Row | null> {
  return s.queryOne<Row>(`SELECT * FROM ${TABLE} WHERE id = :id${bloquear ? conBloqueo() : ""}`, { id });
}

/*
 * En MySQL (REPEATABLE READ) una lectura normal ve la instantanea del inicio de
 * la transaccion; las lecturas que deciden (contar vigentes, duplicado, anular)
 * se hacen con bloqueo para ver lo ultimo confirmado. En SQLite las sesiones ya
 * estan serializadas.
 */
const conBloqueo = () => (isSqlite() ? "" : " FOR UPDATE");

export async function contarVigentes(s: Session, entidad: EntidadAdjunto, entidadId: number): Promise<number> {
  return Number((await s.scalar(`SELECT COUNT(*) FROM ${TABLE} WHERE entidad = :entidad AND entidad_id = :id AND anulado_en IS NULL${conBloqueo()}`, { entidad, id: entidadId })) || 0);
}

/* Resumen para la ficha del registro: vigentes y anulados. */
export async function resumenAdjuntos(s: Session, entidad: EntidadAdjunto, entidadId: number): Promise<{ vigentes: number; anulados: number }> {
  const fila = await s.queryOne<{ vigentes: number; total: number }>(
    `SELECT SUM(CASE WHEN anulado_en IS NULL THEN 1 ELSE 0 END) AS vigentes, COUNT(*) AS total FROM ${TABLE} WHERE entidad = :entidad AND entidad_id = :id`,
    { entidad, id: entidadId },
  );
  const vigentes = Number(fila?.vigentes || 0);
  return { vigentes, anulados: Number(fila?.total || 0) - vigentes };
}

export interface ArchivoRecibido {
  tipo_evidencia: string;
  descripcion: string;
  nombre_original: string;
  extension: string;
  bytes: Buffer;
}

/*
 * Lee y valida el multipart (archivo, tipo_evidencia, descripcion): tamano por
 * Content-Length y por bytes reales (413), extension permitida, firma de bytes,
 * contenido peligroso y archivo vacio (400).
 */
export async function leerArchivo(request: Request): Promise<ArchivoRecibido> {
  const limite = maxBytes();
  const declarado = Number(request.headers.get("content-length") || 0);
  // El multipart agrega encabezados y campos: se deja un margen de 64 KB sobre el limite del archivo.
  if (declarado && declarado > limite + 64 * 1024) throw new HttpError(413, { message: `El archivo pesa más de ${getConfig().EVIDENCIA_MAX_MB} MB`, codigo: "archivo_grande" });
  const contentType = (request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("multipart/form-data")) throw new HttpError(400, { message: "Envía el archivo como multipart/form-data (campo archivo)" });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, { message: "No se pudo leer el archivo enviado" });
  }
  const archivo = form.get("archivo");
  const tipo = String(form.get("tipo_evidencia") || "").trim();
  const descripcion = String(form.get("descripcion") || "").trim();
  if (!(archivo instanceof File) || !archivo.name) throw new HttpError(400, { message: "Adjunta un archivo" });
  if (!TIPOS.has(tipo)) throw new HttpError(400, { message: "Elige el tipo de evidencia" });
  if (descripcion.length < DESCRIPCION_MIN) throw new HttpError(400, { message: `Describe la evidencia (al menos ${DESCRIPCION_MIN} caracteres)` });
  const valido = await validarArchivoSubido(archivo, { limiteBytes: limite, limiteMb: getConfig().EVIDENCIA_MAX_MB, extensiones: EXTENSIONES_EVIDENCIA });
  return { tipo_evidencia: tipo, descripcion: descripcion.slice(0, 2000), ...valido };
}

/*
 * Validacion comun de un archivo subido (adjuntos y biblioteca): tamano (413),
 * extension permitida, firma de bytes, contenido activo aunque venga
 * renombrado (ejecutables, scripts, HTML, SVG) y archivo vacio (400).
 */
export async function validarArchivoSubido(archivo: File, reglas: { limiteBytes: number; limiteMb: number; extensiones: readonly string[] }): Promise<{ nombre_original: string; extension: string; bytes: Buffer }> {
  if (archivo.size > reglas.limiteBytes) throw new HttpError(413, { message: `El archivo pesa más de ${reglas.limiteMb} MB`, codigo: "archivo_grande" });
  const nombre = sanearNombre(archivo.name);
  const extension = extensionDe(nombre);
  if (!reglas.extensiones.includes(extension)) throw new HttpError(400, { message: `Formato no permitido (.${extension || "sin extensión"}). Se aceptan: ${reglas.extensiones.join(", ")}`, codigo: "formato_no_permitido" });
  const bytes = Buffer.from(await archivo.arrayBuffer());
  if (bytes.length > reglas.limiteBytes) throw new HttpError(413, { message: `El archivo pesa más de ${reglas.limiteMb} MB`, codigo: "archivo_grande" });
  const problema = problemaDeContenido(extension, bytes);
  if (problema) throw new HttpError(400, { message: problema, codigo: bytes.length ? "contenido_no_valido" : "archivo_vacio" });
  return { nombre_original: nombre, extension, bytes };
}

export interface ArchivoGuardado {
  nombre_almacenado: string;
  ruta: string;
  sha256: string;
  tamano_bytes: number;
}

/*
 * Escribe el archivo: temporal en la misma carpeta, SHA-256 mientras se
 * escribe (por bloques), fsync y rename atomico. Si la escritura falla no
 * queda nada en disco y no se crea el registro.
 */
export async function guardarArchivo(entidad: EntidadAdjunto, entidadId: number, extension: string, bytes: Buffer): Promise<ArchivoGuardado> {
  return guardarArchivoEn(evidenciasDir(), path.join(/*turbopackIgnore: true*/ entidad, String(entidadId)), extension, bytes);
}

/* Igual que guardarArchivo, en cualquier carpeta raiz (biblioteca: <instancia>/biblioteca/<documento_id>/). */
export async function guardarArchivoEn(raizDir: string, relativo: string, extension: string, bytes: Buffer): Promise<ArchivoGuardado> {
  const carpeta = path.join(/*turbopackIgnore: true*/ raizDir, relativo);
  await fs.promises.mkdir(carpeta, { recursive: true });
  const nombre = `${randomUUID()}.${extension}`;
  const destino = path.join(/*turbopackIgnore: true*/ carpeta, nombre);
  const temporal = path.join(/*turbopackIgnore: true*/ carpeta, `.${nombre}.${process.pid}.tmp`);
  const hash = createHash("sha256");
  const handle = await fs.promises.open(temporal, "wx", 0o640);
  try {
    const BLOQUE = 1024 * 1024;
    for (let desde = 0; desde < bytes.length; desde += BLOQUE) {
      const trozo = bytes.subarray(desde, Math.min(desde + BLOQUE, bytes.length));
      hash.update(trozo);
      await handle.write(trozo);
    }
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.promises.rm(temporal, { force: true });
    throw error;
  }
  await handle.close();
  try {
    await fs.promises.rename(temporal, destino);
  } catch (error) {
    await fs.promises.rm(temporal, { force: true });
    throw error;
  }
  return { nombre_almacenado: path.join(/*turbopackIgnore: true*/ relativo, nombre).split(path.sep).join("/"), ruta: destino, sha256: hash.digest("hex"), tamano_bytes: bytes.length };
}

/* Quita un archivo recien escrito cuya transaccion fallo (no hay registro que lo apunte). */
export async function descartarArchivo(guardado: ArchivoGuardado | null): Promise<void> {
  if (guardado) await fs.promises.rm(guardado.ruta, { force: true }).catch(() => undefined);
}

/* ¿El mismo archivo (SHA-256) ya esta adjunto y vigente en este registro? */
export async function duplicadoVigente(s: Session, entidad: EntidadAdjunto, entidadId: number, sha256: string): Promise<Row | null> {
  return s.queryOne<Row>(`SELECT id, descripcion FROM ${TABLE} WHERE entidad = :entidad AND entidad_id = :id AND sha256 = :sha AND anulado_en IS NULL LIMIT 1${conBloqueo()}`, { entidad, id: entidadId, sha: sha256 });
}

export async function insertarAdjunto(
  s: Session,
  datos: { entidad: EntidadAdjunto; entidad_id: number; tipo_evidencia: string; descripcion: string; nombre_original: string; nombre_almacenado: string; mime: string; extension: string; tamano_bytes: number; sha256: string; subido_por: number | null; subido_rol: string | null; subido_en?: string; heredado_de?: number | null },
): Promise<number> {
  const result = await s.execute(
    `INSERT INTO ${TABLE} (entidad, entidad_id, tipo_evidencia, descripcion, nombre_original, nombre_almacenado, mime, extension, tamano_bytes, sha256, subido_por, subido_rol, subido_en, heredado_de)
     VALUES (:entidad, :entidad_id, :tipo_evidencia, :descripcion, :nombre_original, :nombre_almacenado, :mime, :extension, :tamano_bytes, :sha256, :subido_por, :subido_rol, :subido_en, :heredado_de)`,
    { ...datos, subido_en: datos.subido_en || new Date().toISOString(), heredado_de: datos.heredado_de ?? null },
  );
  return result.lastrowid as number;
}

/* Anula un adjunto (el archivo no se toca). */
/* Anula un adjunto (el archivo no se toca). Devuelve false si ya estaba anulado (otra peticion lo hizo antes). */
export async function anularAdjuntoFila(s: Session, id: number, datos: { por: number | null; rol: string | null; motivo: string }): Promise<boolean> {
  const r = await s.execute(`UPDATE ${TABLE} SET anulado_en = :en, anulado_por = :por, anulado_rol = :rol, motivo_anulacion = :motivo WHERE id = :id AND anulado_en IS NULL`, { en: new Date().toISOString(), por: datos.por, rol: datos.rol, motivo: datos.motivo, id });
  return r.rowcount > 0;
}

/*
 * Enmiendas: los adjuntos vigentes de la version anterior pasan a la nueva
 * como filas nuevas (heredado_de) que apuntan al mismo archivo, sin copiarlo.
 * Los de la version anterior quedan intactos. Devuelve cuantos se heredaron.
 */
export async function heredarAdjuntos(s: Session, entidad: EntidadAdjunto, deId: number, aId: number): Promise<number> {
  const vigentes = await s.query<Row>(`SELECT * FROM ${TABLE} WHERE entidad = :entidad AND entidad_id = :id AND anulado_en IS NULL ORDER BY id`, { entidad, id: deId });
  for (const row of vigentes) {
    await insertarAdjunto(s, {
      entidad,
      entidad_id: aId,
      tipo_evidencia: String(row.tipo_evidencia),
      descripcion: String(row.descripcion),
      nombre_original: String(row.nombre_original),
      nombre_almacenado: String(row.nombre_almacenado),
      mime: String(row.mime),
      extension: String(row.extension),
      tamano_bytes: Number(row.tamano_bytes),
      sha256: String(row.sha256),
      subido_por: row.subido_por === null ? null : Number(row.subido_por),
      subido_rol: row.subido_rol ? String(row.subido_rol) : null,
      subido_en: String(row.subido_en),
      heredado_de: Number(row.id),
    });
  }
  return vigentes.length;
}

/* Nombre para Content-Disposition: ASCII seguro + filename* en UTF-8 (RFC 6266). */
export function contentDisposition(tipo: "inline" | "attachment", nombre: string): string {
  const saneado = sanearNombre(nombre);
  const ascii = saneado.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "_");
  return `${tipo}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(saneado)}`;
}
