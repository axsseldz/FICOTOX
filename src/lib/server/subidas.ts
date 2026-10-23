import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "./config";
import { HttpError } from "./http";
import { claveDeArchivo, ErrorPortable, leerEncabezado } from "../shared/respaldo-portable.mjs";

/*
 * Subida por partes de un archivo de respaldo (.ficotox) a la carpeta
 * <respaldos>/.importando/ (Calidad › Respaldos › «Importar respaldo» y la
 * Configuracion inicial). El navegador lo manda en trozos de TROZO_SUBIDA
 * bytes: el proxy de /api/* (src/proxy.ts) guarda cada cuerpo en memoria y lo
 * corta a proxyClientMaxBodySize (~52 MB), asi que un respaldo grande no
 * cabria en una sola peticion. Cada trozo se agrega al final del archivo en
 * disco (nunca todo en memoria) y debe llegar en orden.
 *
 * - Limite: RESPALDO_IMPORTAR_MAX_MB (4096 por omision) y espacio libre en el
 *   disco para el archivo y su copia descifrada (2.5 veces su tamaño).
 * - Una subida por dueño a la vez; una que lleva mas de SUBIDA_INACTIVA_MIN sin
 *   recibir nada se descarta y se borra (tambien los archivos huerfanos de un
 *   reinicio). Quien la usa la toma (`tomarSubida`) y borra el archivo al terminar.
 */

export const TROZO_SUBIDA = 8 * 1024 * 1024;
const TROZO_MAX = 16 * 1024 * 1024;
const SUBIDA_INACTIVA_MIN = 60;

export const limiteImportarBytes = (): number => {
  const mb = Number.parseInt(process.env.RESPALDO_IMPORTAR_MAX_MB || "", 10);
  return (Number.isFinite(mb) && mb > 0 ? mb : 4096) * 1024 * 1024;
};

interface Subida {
  id: string;
  dueno: string;
  ruta: string;
  nombre: string;
  tamano: number;
  recibido: number;
  actualizada: number;
}

const global = globalThis as unknown as { __ficotoxSubidas?: Map<string, Subida> };
const subidas = (global.__ficotoxSubidas ||= new Map<string, Subida>());

/* Carpeta de trabajo de las importaciones: oculta dentro de la carpeta de respaldos (mismo disco: mover es instantaneo). */
export function carpetaImportando(): string {
  const dir = path.join(/*turbopackIgnore: true*/ getConfig().RESPALDOS_DIR, ".importando");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

const borrar = (ruta: string) => {
  try {
    fs.rmSync(ruta, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* se reintenta en la siguiente limpieza */
  }
};

/* Descarta subidas inactivas y archivos o carpetas de importaciones que ya nadie usa (de un reinicio, por ejemplo). */
export function limpiarSubidas(enUso: string[] = []): void {
  const ahora = Date.now();
  for (const s of subidas.values()) {
    if (ahora - s.actualizada > SUBIDA_INACTIVA_MIN * 60_000) {
      subidas.delete(s.id);
      borrar(s.ruta);
    }
  }
  const vivas = new Set([...[...subidas.values()].map((s) => path.basename(s.ruta)), ...enUso.map((r) => path.basename(r))]);
  let nombres: string[] = [];
  const dir = carpetaImportando();
  try {
    nombres = fs.readdirSync(dir);
  } catch {
    nombres = [];
  }
  for (const n of nombres) {
    if (vivas.has(n)) continue;
    try {
      if (ahora - fs.statSync(path.join(/*turbopackIgnore: true*/ dir, n)).mtimeMs > SUBIDA_INACTIVA_MIN * 60_000) borrar(path.join(/*turbopackIgnore: true*/ dir, n));
    } catch {
      /* ya no existe */
    }
  }
}

/* Nombre del archivo original, solo para mostrarlo (sin rutas ni caracteres raros). */
const nombreLimpio = (valor: unknown): string => String(valor ?? "").split(/[\\/]/).pop()!.replace(/[^\p{L}\p{N} ._()-]/gu, "").slice(0, 120) || "respaldo.ficotox";

export function iniciarSubida(dueno: string, tamanoValor: unknown, nombreValor: unknown): { id: string; trozo: number } {
  const tamano = Number(tamanoValor);
  if (!Number.isSafeInteger(tamano) || tamano <= 0) throw new HttpError(400, { message: "Indica el tamaño del archivo", campo: "archivo" });
  const limite = limiteImportarBytes();
  if (tamano > limite) throw new HttpError(413, { message: `El archivo pesa ${(tamano / 1048576).toFixed(0)} MB y el límite para importar es de ${(limite / 1048576).toFixed(0)} MB (RESPALDO_IMPORTAR_MAX_MB).`, codigo: "demasiado_grande", campo: "archivo" });
  limpiarSubidas();
  // Una a la vez por dueño: una subida nueva reemplaza a la anterior sin terminar.
  for (const s of subidas.values()) {
    if (s.dueno === dueno) {
      subidas.delete(s.id);
      borrar(s.ruta);
    }
  }
  const dir = carpetaImportando();
  try {
    const libre = fs.statfsSync(dir);
    if (Number(libre.bavail) * Number(libre.bsize) < tamano * 2.5) throw new HttpError(507, { message: "No hay espacio suficiente en el disco del servidor para recibir y abrir este respaldo (se necesita unas 2.5 veces su tamaño).", codigo: "sin_espacio" });
  } catch (error) {
    if (error instanceof HttpError) throw error;
  }
  const id = randomBytes(16).toString("hex");
  const ruta = path.join(/*turbopackIgnore: true*/ dir, `${id}.ficotox.parte`);
  fs.writeFileSync(ruta, "", { mode: 0o600, flag: "wx" });
  subidas.set(id, { id, dueno, ruta, nombre: nombreLimpio(nombreValor), tamano, recibido: 0, actualizada: Date.now() });
  return { id, trozo: TROZO_SUBIDA };
}

const subidaDe = (id: unknown, dueno: string): Subida => {
  const s = typeof id === "string" && /^[0-9a-f]{32}$/.test(id) ? subidas.get(id) : undefined;
  if (!s || s.dueno !== dueno) throw new HttpError(404, { message: "La subida ya no existe (venció o se reemplazó). Vuelve a elegir el archivo.", codigo: "subida_no_existe" });
  return s;
};

/* Agrega un trozo; `desde` debe ser exactamente lo ya recibido (en orden, sin huecos ni repeticiones). */
export async function agregarTrozo(id: unknown, dueno: string, desdeValor: unknown, request: Request): Promise<{ recibido: number; tamano: number }> {
  const s = subidaDe(id, dueno);
  const desde = Number(desdeValor);
  if (!Number.isSafeInteger(desde) || desde !== s.recibido) throw new HttpError(409, { message: "La subida se desordenó; vuelve a intentarlo.", codigo: "subida_desordenada", recibido: s.recibido });
  const declarado = Number(request.headers.get("content-length") || NaN);
  if (Number.isFinite(declarado) && (declarado > TROZO_MAX || s.recibido + declarado > s.tamano)) throw new HttpError(413, { message: "El trozo es más grande de lo permitido.", codigo: "trozo_grande" });
  if (!request.body) throw new HttpError(400, { message: "El trozo llegó vacío." });
  // Se escribe en flujo y con tope: nunca mas de lo declarado al iniciar la subida.
  const archivo = await fs.promises.open(s.ruta, "a");
  let escritos = 0;
  try {
    const lector = request.body.getReader();
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      escritos += value.length;
      if (escritos > TROZO_MAX || s.recibido + escritos > s.tamano) {
        await lector.cancel().catch(() => undefined);
        throw new HttpError(413, { message: "El archivo es más grande de lo que se anunció.", codigo: "trozo_grande" });
      }
      await archivo.write(value);
    }
  } catch (error) {
    await archivo.close().catch(() => undefined);
    subidas.delete(s.id);
    borrar(s.ruta);
    throw error instanceof HttpError ? error : new HttpError(400, { message: "Se interrumpió la subida; vuelve a intentarlo.", codigo: "subida_interrumpida" });
  }
  await archivo.close();
  s.recibido += escritos;
  s.actualizada = Date.now();
  return { recibido: s.recibido, tamano: s.tamano };
}

/*
 * Antes de tomarla: comprueba la contraseña contra el encabezado del archivo
 * (sin descifrar nada). Si es incorrecta, la subida se conserva y se puede
 * volver a intentar sin subir el archivo otra vez.
 */
export async function comprobarContrasenaSubida(id: unknown, dueno: string, contrasena: string): Promise<void> {
  const s = subidaDe(id, dueno);
  if (s.recibido !== s.tamano) throw new HttpError(409, { message: "El archivo no terminó de subir; vuelve a intentarlo.", codigo: "subida_incompleta" });
  try {
    await claveDeArchivo(leerEncabezado(s.ruta), contrasena);
  } catch (error) {
    if (!(error instanceof ErrorPortable)) throw error;
    // La contraseña se puede corregir; un archivo que no es un respaldo, no: se descarta.
    if (error.codigo !== "contrasena_incorrecta") {
      subidas.delete(s.id);
      borrar(s.ruta);
    }
    throw new HttpError(400, { message: error.message, codigo: error.codigo, campo: error.codigo === "contrasena_incorrecta" ? "contrasena" : "archivo" });
  }
  s.actualizada = Date.now();
}

/* Toma una subida completa (deja de estar en la lista): quien la toma borra el archivo al terminar. */
export function tomarSubida(id: unknown, dueno: string): { ruta: string; nombre: string; tamano: number } {
  const s = subidaDe(id, dueno);
  if (s.recibido !== s.tamano) throw new HttpError(409, { message: "El archivo no terminó de subir; vuelve a intentarlo.", codigo: "subida_incompleta" });
  subidas.delete(s.id);
  return { ruta: s.ruta, nombre: s.nombre, tamano: s.tamano };
}

export function borrarArchivo(ruta: string | null | undefined): void {
  if (ruta) borrar(ruta);
}
