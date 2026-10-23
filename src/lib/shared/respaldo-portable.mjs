/*
 * Respaldos portables: un respaldo (la carpeta <respaldos>/<id>/ de
 * respaldo.mjs) empacado y cifrado en un solo archivo .ficotox, para sacarlo
 * del equipo y levantarlo en otra computadora (Mac o Windows). Lo usan el
 * servidor (Calidad › Respaldos: «Descargar» e «Importar respaldo»; y la
 * Configuracion inicial) y las pruebas. JavaScript plano (.mjs) como
 * respaldo.mjs; los tipos estan en respaldo-portable.d.mts. Solo node:crypto,
 * sin dependencias nuevas, y todo en flujo (nunca el respaldo completo en memoria).
 *
 * Formato «ficotox-respaldo-portable», version 1 (enteros big-endian):
 *
 *   Encabezado (en claro; autenticado en cada trozo):
 *     0    8  "FICOTOXP" (magia)
 *     8    1  version (1)
 *     9    4  L = largo del JSON de parametros (1..4096)
 *     13   L  JSON { formato, version,
 *                    kdf: { algoritmo: "scrypt", N, r, p, sal (base64, 16 B) },
 *                    cifrado: { algoritmo: "aes-256-gcm", trozo (bytes), prefijo (base64, 7 B) },
 *                    verificador (base64, 16 B) }
 *   Cuerpo: el contenido en trozos de `trozo` bytes, cada uno cifrado con
 *   AES-256-GCM y seguido de su etiqueta de 16 B; el ultimo puede ser menor
 *   (o vacio). nonce = prefijo (7 B) || numero de trozo (uint32) || 1 si es el
 *   ultimo, 0 si no. AAD = SHA-256 del encabezado completo. Asi se detecta un
 *   trozo alterado, reordenado, quitado o un archivo truncado (falta el ultimo).
 *   clave = scrypt(contrasena en NFC, sal, 32 B, N, r, p);
 *   verificador = HMAC-SHA256(clave, "ficotox-respaldo-portable:verificador")[0..16]
 *   (distingue «contraseña incorrecta» de «archivo alterado» sin descifrar nada).
 *
 *   Contenido (lo que se cifra):
 *     "FCTXCONT" + version (1)
 *     por archivo: 0x01, uint16 largo de la ruta, ruta UTF-8 con "/", uint64 tamano, bytes
 *     fin: 0x00, uint32 numero de archivos
 *   Primero manifest.json; despues la llave (llave/llave-bitacora.txt), la base
 *   (datos/ficotox.sqlite3) y los archivos que declara el manifest. Al abrir solo
 *   se aceptan esas rutas (las de archivos/, solo si el manifest las declara),
 *   sin repetir y con nombres validos tambien en Windows.
 *
 * La contrasena nunca se guarda ni se registra: solo se deriva la clave.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ARCHIVO_LLAVE, FORMATO, RUTA_BASE, rutaArchivoValida } from "./respaldo.mjs";

export const MAGIA = Buffer.from("FICOTOXP", "ascii");
export const MAGIA_CONTENIDO = Buffer.from("FCTXCONT", "ascii");
export const VERSION_PORTABLE = 1;
export const FORMATO_PORTABLE = "ficotox-respaldo-portable";
export const EXTENSION = ".ficotox";
export const CONTRASENA_MIN = 12;
/* scrypt: N = 2^17, r = 8, p = 1 (128 MiB de memoria, ~0.3 s): caro para quien prueba contraseñas a ciegas. */
export const KDF_POR_OMISION = { N: 131072, r: 8, p: 1 };
export const TROZO = 1024 * 1024;
const TAG = 16;
const RUTA_LLAVE = ARCHIVO_LLAVE.split(path.sep).join("/");
const CONTEXTO_VERIFICADOR = "ficotox-respaldo-portable:verificador";

/* Error con codigo y mensaje para las personas (la pantalla lo muestra tal cual). */
export class ErrorPortable extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}

/* ---------- Nombres validos en Windows y en macOS ---------- */

const RESERVADOS_WINDOWS = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/* Un segmento de ruta que Windows tambien acepta: sin <>:"/\|?* ni controles, sin punto o espacio final y sin nombres reservados (CON, NUL, COM1…). */
export function nombreValidoEnWindows(segmento) {
  if (typeof segmento !== "string" || !segmento || segmento.length > 255) return false;
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(segmento)) return false;
  if (/[. ]$/.test(segmento)) return false;
  return !RESERVADOS_WINDOWS.test(segmento);
}

/* Ruta (con "/") que puede venir en un archivo portable: la ficha, la llave, la base o un archivo respaldado, con nombres validos en los dos sistemas. */
export function rutaPortableValida(ruta) {
  if (ruta === "manifest.json" || ruta === RUTA_BASE || ruta === RUTA_LLAVE) return true;
  return rutaArchivoValida(ruta) && ruta.split("/").every(nombreValidoEnWindows);
}

/* Ruta del sistema (path.join por segmento, nunca "/" fijo) de una ruta portable dentro de `raiz`; null si se saldria de ella. */
export function rutaLocal(raiz, ruta, sistema = path) {
  const absoluta = sistema.resolve(raiz, ...String(ruta).split("/"));
  const base = sistema.resolve(raiz);
  return absoluta.startsWith(base + sistema.sep) ? absoluta : null;
}

/* ---------- Clave ---------- */

const scrypt = (contrasena, sal, kdf) =>
  new Promise((resolve, reject) => {
    // maxmem: N * r * 128 bytes mas margen (el limite por omision de Node, 32 MiB, no alcanza para N = 2^17).
    scryptCb(Buffer.from(String(contrasena).normalize("NFC"), "utf8"), sal, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: kdf.N * kdf.r * 128 * 2 }, (error, clave) => (error ? reject(error) : resolve(clave)));
  });

const verificadorDe = (clave) => createHmac("sha256", clave).update(CONTEXTO_VERIFICADOR).digest().subarray(0, 16);

/* Contrasena de cifrado aceptable (el texto de error, o null). */
export function validarContrasena(contrasena) {
  const texto = String(contrasena ?? "");
  if ([...texto].length < CONTRASENA_MIN) return `La contraseña de cifrado debe tener al menos ${CONTRASENA_MIN} caracteres`;
  if (texto.length > 1024) return "La contraseña de cifrado es demasiado larga";
  return null;
}

/*
 * Deriva la clave de una contrasena nueva (sal y prefijo al azar). Devuelve lo
 * necesario para cifrar despues sin volver a tener la contrasena; el
 * encabezado se arma al cifrar (lleva el tamano exacto del contenido).
 */
export async function prepararCifrado(contrasena, kdf = KDF_POR_OMISION) {
  const error = validarContrasena(contrasena);
  if (error) throw new ErrorPortable("contrasena_debil", error);
  const sal = randomBytes(16);
  const prefijo = randomBytes(7);
  const clave = await scrypt(contrasena, sal, kdf);
  return { clave, sal, prefijo, kdf: { N: kdf.N, r: kdf.r, p: kdf.p }, trozo: TROZO };
}

/* Encabezado del archivo: magia, version y parametros (con el tamano del contenido, para reconocer un archivo truncado antes de descifrar). */
export function armarEncabezado(cifrado, contenido) {
  const parametros = {
    formato: FORMATO_PORTABLE,
    version: VERSION_PORTABLE,
    kdf: { algoritmo: "scrypt", N: cifrado.kdf.N, r: cifrado.kdf.r, p: cifrado.kdf.p, sal: cifrado.sal.toString("base64") },
    cifrado: { algoritmo: "aes-256-gcm", trozo: cifrado.trozo, prefijo: cifrado.prefijo.toString("base64") },
    contenido,
    verificador: verificadorDe(cifrado.clave).toString("base64"),
  };
  const json = Buffer.from(JSON.stringify(parametros), "utf8");
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(json.length);
  return Buffer.concat([MAGIA, Buffer.from([VERSION_PORTABLE]), largo, json]);
}

/* Tamano del archivo cifrado que corresponde a un contenido (encabezado + contenido + una etiqueta por trozo). */
export const largoCifrado = (largoEncabezado, contenido, trozo) => largoEncabezado + contenido + TAG * Math.ceil(contenido / trozo);

const nonceDe = (prefijo, n, ultimo) => {
  const nonce = Buffer.alloc(12);
  prefijo.copy(nonce, 0, 0, 7);
  nonce.writeUInt32BE(n, 7);
  nonce[11] = ultimo ? 1 : 0;
  return nonce;
};

/* ---------- Empacar y cifrar ---------- */

/*
 * Lo que va en el archivo portable de un respaldo: la ficha, la llave, la base
 * y cada archivo que declara la ficha, con su tamano. Falla si el respaldo esta
 * incompleto, si algo no es un archivo regular (un enlace simbolico, por
 * ejemplo) o si un nombre no seria valido en Windows.
 */
export function entradasDeRespaldo(carpeta) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(/*turbopackIgnore: true*/ carpeta, "manifest.json"), "utf8"));
  } catch {
    throw new ErrorPortable("respaldo_danado", "El respaldo no tiene una ficha (manifest.json) legible");
  }
  if (manifest?.formato !== FORMATO) throw new ErrorPortable("respaldo_danado", "La carpeta no es un respaldo de FICOTOX");
  const rutas = ["manifest.json", ...(manifest.llave?.incluida ? [RUTA_LLAVE] : []), RUTA_BASE, ...(Array.isArray(manifest.archivos) ? manifest.archivos.map((a) => a?.ruta) : [])];
  const vistas = new Set();
  return rutas.map((ruta) => {
    if (!rutaPortableValida(ruta)) throw new ErrorPortable("respaldo_danado", `El respaldo tiene un archivo con un nombre que no se puede llevar a otra computadora: ${JSON.stringify(ruta)}`);
    if (vistas.has(ruta)) throw new ErrorPortable("respaldo_danado", `El respaldo declara dos veces ${ruta}`);
    vistas.add(ruta);
    const absoluta = rutaLocal(carpeta, ruta);
    let info;
    try {
      info = absoluta ? fs.lstatSync(absoluta) : null;
    } catch {
      info = null;
    }
    if (!info || !info.isFile()) throw new ErrorPortable("respaldo_danado", `Al respaldo le falta ${ruta}`);
    return { ruta, absoluta, tamano: info.size };
  });
}

/* Tamano exacto del contenido (sin cifrar) y del archivo portable que resulta. */
export function tamanoPortable(entradas, cifrado) {
  const contenido = MAGIA_CONTENIDO.length + 1 + entradas.reduce((t, e) => t + 1 + 2 + Buffer.byteLength(e.ruta, "utf8") + 8 + e.tamano, 0) + 1 + 4;
  return { contenido, archivo: largoCifrado(armarEncabezado(cifrado, contenido).length, contenido, cifrado.trozo) };
}

/* El contenido sin cifrar, en pedazos (lee cada archivo en flujo y comprueba que su tamano no cambio). */
async function* contenidoDe(entradas) {
  yield Buffer.concat([MAGIA_CONTENIDO, Buffer.from([VERSION_PORTABLE])]);
  for (const e of entradas) {
    const ruta = Buffer.from(e.ruta, "utf8");
    const cabeza = Buffer.alloc(1 + 2 + ruta.length + 8);
    cabeza[0] = 1;
    cabeza.writeUInt16BE(ruta.length, 1);
    ruta.copy(cabeza, 3);
    cabeza.writeBigUInt64BE(BigInt(e.tamano), 3 + ruta.length);
    yield cabeza;
    let leidos = 0;
    for await (const pedazo of fs.createReadStream(e.absoluta, { highWaterMark: TROZO })) {
      leidos += pedazo.length;
      if (leidos > e.tamano) break;
      yield pedazo;
    }
    if (leidos !== e.tamano) throw new ErrorPortable("respaldo_danado", `${e.ruta} cambió mientras se empacaba`);
  }
  const fin = Buffer.alloc(5);
  fin.writeUInt32BE(entradas.length, 1);
  yield fin;
}

/*
 * El archivo portable completo, en pedazos: el encabezado y despues cada trozo
 * cifrado. Un trozo se cifra como «ultimo» solo al terminar el contenido.
 */
export async function* flujoPortable(entradas, cifrado) {
  const { clave, prefijo, trozo } = cifrado;
  const encabezado = armarEncabezado(cifrado, tamanoPortable(entradas, cifrado).contenido);
  const aad = createHash("sha256").update(encabezado).digest();
  let n = 0;
  const cifrar = (datos, ultimo) => {
    const cifrador = createCipheriv("aes-256-gcm", clave, nonceDe(prefijo, n, ultimo));
    cifrador.setAAD(aad);
    const salida = Buffer.concat([cifrador.update(datos), cifrador.final(), cifrador.getAuthTag()]);
    n += 1;
    return salida;
  };
  yield encabezado;
  let pendiente = [];
  let largo = 0;
  for await (const pedazo of contenidoDe(entradas)) {
    pendiente.push(pedazo);
    largo += pedazo.length;
    // Solo se cifra un trozo completo cuando ya se sabe que viene algo despues (el ultimo va marcado).
    while (largo > trozo) {
      const todo = Buffer.concat(pendiente);
      yield cifrar(todo.subarray(0, trozo), false);
      pendiente = [todo.subarray(trozo)];
      largo -= trozo;
    }
  }
  yield cifrar(Buffer.concat(pendiente), true);
}

/* Escribe el archivo portable de un respaldo en `destino` (pruebas y terminal). */
export async function escribirPortable(carpeta, contrasena, destino) {
  const entradas = entradasDeRespaldo(carpeta);
  const cifrado = await prepararCifrado(contrasena);
  const salida = fs.createWriteStream(destino, { mode: 0o600 });
  try {
    for await (const pedazo of flujoPortable(entradas, cifrado)) if (!salida.write(pedazo)) await new Promise((r) => salida.once("drain", r));
  } finally {
    await new Promise((resolve, reject) => salida.end((error) => (error ? reject(error) : resolve())));
  }
  return { tamano: fs.statSync(destino).size, entradas: entradas.length };
}

/* ---------- Descifrar y desempacar ---------- */

/* Lee y valida el encabezado de un archivo portable (sin la contrasena). */
export function leerEncabezado(archivo) {
  const fd = fs.openSync(archivo, "r");
  try {
    const inicio = Buffer.alloc(13);
    const leidos = fs.readSync(fd, inicio, 0, 13, 0);
    if (leidos < 13 || !inicio.subarray(0, 8).equals(MAGIA)) throw new ErrorPortable("no_es_respaldo", "El archivo no es un respaldo de FICOTOX (.ficotox). Elige el archivo que se descargó en Calidad › Respaldos.");
    if (inicio[8] !== VERSION_PORTABLE) throw new ErrorPortable("version_no_soportada", "El archivo es de una versión del formato que esta instalación no conoce: actualiza FICOTOX antes de importarlo.");
    const largo = inicio.readUInt32BE(9);
    if (largo < 2 || largo > 4096) throw new ErrorPortable("archivo_danado", "El encabezado del archivo está dañado.");
    const json = Buffer.alloc(largo);
    if (fs.readSync(fd, json, 0, largo, 13) !== largo) throw new ErrorPortable("archivo_truncado", "El archivo está incompleto (se cortó al copiarlo o descargarlo).");
    let p;
    try {
      p = JSON.parse(json.toString("utf8"));
    } catch {
      throw new ErrorPortable("archivo_danado", "El encabezado del archivo está dañado.");
    }
    const potencia = (n) => Number.isInteger(n) && n >= 16384 && n <= 1048576 && (n & (n - 1)) === 0;
    const sal = Buffer.from(String(p?.kdf?.sal || ""), "base64");
    const prefijo = Buffer.from(String(p?.cifrado?.prefijo || ""), "base64");
    const verificador = Buffer.from(String(p?.verificador || ""), "base64");
    const valido =
      p?.formato === FORMATO_PORTABLE &&
      p?.version === VERSION_PORTABLE &&
      p?.kdf?.algoritmo === "scrypt" &&
      potencia(p.kdf.N) &&
      Number.isInteger(p.kdf.r) && p.kdf.r >= 1 && p.kdf.r <= 16 &&
      Number.isInteger(p.kdf.p) && p.kdf.p >= 1 && p.kdf.p <= 4 &&
      p.kdf.N * p.kdf.r * 128 <= 256 * 1024 * 1024 &&
      sal.length >= 16 &&
      p?.cifrado?.algoritmo === "aes-256-gcm" &&
      Number.isInteger(p.cifrado.trozo) && p.cifrado.trozo >= 65536 && p.cifrado.trozo <= 8 * 1024 * 1024 &&
      prefijo.length === 7 &&
      verificador.length === 16 &&
      Number.isSafeInteger(p?.contenido) && p.contenido >= 14;
    if (!valido) throw new ErrorPortable("archivo_danado", "El encabezado del archivo está dañado o no es de un respaldo de FICOTOX.");
    // El encabezado dice cuanto debe medir el archivo: uno mas corto se corto al copiarlo (el encabezado va autenticado en cada trozo).
    const esperado = largoCifrado(13 + largo, p.contenido, p.cifrado.trozo);
    const real = fs.fstatSync(fd).size;
    if (real < esperado) throw new ErrorPortable("archivo_truncado", "El archivo está incompleto (se cortó al copiarlo o descargarlo).");
    if (real > esperado) throw new ErrorPortable("archivo_danado", "El archivo trae datos de más: está dañado o no es un respaldo de FICOTOX.");
    return { parametros: p, encabezado: Buffer.concat([inicio, json]), sal, prefijo, verificador, trozo: p.cifrado.trozo, contenido: p.contenido, kdf: { N: p.kdf.N, r: p.kdf.r, p: p.kdf.p } };
  } finally {
    fs.closeSync(fd);
  }
}

/* Comprueba la contrasena contra el verificador del encabezado (sin descifrar el contenido). Devuelve la clave. */
export async function claveDeArchivo(encabezado, contrasena) {
  const clave = await scrypt(String(contrasena ?? ""), encabezado.sal, encabezado.kdf);
  const esperado = verificadorDe(clave);
  if (!timingSafeEqual(esperado, encabezado.verificador)) throw new ErrorPortable("contrasena_incorrecta", "La contraseña de cifrado no es la de este archivo. Escribe la que se usó al descargarlo (distingue mayúsculas y minúsculas).");
  return clave;
}

/*
 * Descifra `archivo` con `contrasena` y desempaca el respaldo en `destino`
 * (carpeta que no debe existir). Si algo falla, borra lo que alcanzo a escribir
 * y lanza ErrorPortable con el motivo. `limiteBytes` acota lo que se escribe;
 * `alAvance(fraccion)` informa el avance. Devuelve { manifest, archivos, bytes }.
 */
export async function abrirPortable({ archivo, contrasena, destino, limiteBytes = Number.MAX_SAFE_INTEGER, alAvance = () => {} }) {
  const enc = leerEncabezado(archivo);
  const clave = await claveDeArchivo(enc, contrasena);
  if (fs.existsSync(destino)) throw new ErrorPortable("destino_ocupado", "La carpeta de destino ya existe");
  fs.mkdirSync(destino, { recursive: true, mode: 0o700 });
  const total = fs.statSync(archivo).size;
  const aad = createHash("sha256").update(enc.encabezado).digest();
  const parser = new Desempacador(destino, limiteBytes);
  try {
    let n = 0;
    let buffer = Buffer.alloc(0);
    let leidos = enc.encabezado.length;
    const descifrar = (bloque, ultimo) => {
      if (bloque.length < TAG) throw new ErrorPortable("archivo_truncado", "El archivo está incompleto (se cortó al copiarlo o descargarlo).");
      const descifrador = createDecipheriv("aes-256-gcm", clave, nonceDe(enc.prefijo, n, ultimo));
      descifrador.setAAD(aad);
      descifrador.setAuthTag(bloque.subarray(bloque.length - TAG));
      let claro;
      try {
        claro = Buffer.concat([descifrador.update(bloque.subarray(0, bloque.length - TAG)), descifrador.final()]);
      } catch {
        // El ultimo trozo no autentica como «ultimo»: o lo alteraron, o el archivo se corto justo entre dos trozos.
        throw ultimo && bloque.length === enc.trozo + TAG ? new ErrorPortable("archivo_truncado", "El archivo está incompleto (se cortó al copiarlo o descargarlo).") : new ErrorPortable("archivo_alterado", "El archivo fue alterado o está dañado: no coincide su sello de autenticidad. Descárgalo de nuevo desde el equipo de origen.");
      }
      n += 1;
      return claro;
    };
    const flujo = fs.createReadStream(archivo, { start: enc.encabezado.length, highWaterMark: enc.trozo + TAG });
    for await (const pedazo of flujo) {
      buffer = buffer.length ? Buffer.concat([buffer, pedazo]) : pedazo;
      leidos += pedazo.length;
      while (buffer.length > enc.trozo + TAG) {
        await parser.agregar(descifrar(buffer.subarray(0, enc.trozo + TAG), false));
        buffer = buffer.subarray(enc.trozo + TAG);
      }
      alAvance(Math.min(0.99, leidos / total));
    }
    if (!buffer.length) throw new ErrorPortable("archivo_truncado", "El archivo está incompleto (se cortó al copiarlo o descargarlo).");
    await parser.agregar(descifrar(buffer, true));
    await parser.terminar();
    alAvance(1);
    return { manifest: parser.manifest, archivos: parser.cuenta, bytes: parser.bytes };
  } catch (error) {
    await parser.cerrar().catch(() => {});
    fs.rmSync(destino, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    if (error instanceof ErrorPortable) throw error;
    throw new ErrorPortable("archivo_danado", `No se pudo abrir el archivo: ${error?.code === "ENOSPC" ? "no hay espacio suficiente en el disco" : "está dañado o no es un respaldo de FICOTOX"}.`);
  }
}

/* Lee el contenido descifrado (en pedazos de cualquier tamano) y escribe cada archivo en su lugar. */
class Desempacador {
  constructor(destino, limite) {
    this.destino = destino;
    this.limite = limite;
    this.buffer = Buffer.alloc(0);
    this.estado = "magia";
    this.actual = null;
    this.vistas = new Set();
    this.declaradas = null;
    this.manifest = null;
    this.cuenta = 0;
    this.bytes = 0;
    this.terminado = false;
  }

  danado(mensaje) {
    return new ErrorPortable("archivo_danado", mensaje || "El contenido del archivo no es un respaldo válido de FICOTOX.");
  }

  async agregar(datos) {
    if (this.terminado && datos.length) throw this.danado("El archivo trae datos después del final del respaldo.");
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, datos]) : datos;
    for (;;) {
      if (this.estado === "magia") {
        if (this.buffer.length < 9) return;
        if (!this.buffer.subarray(0, 8).equals(MAGIA_CONTENIDO) || this.buffer[8] !== VERSION_PORTABLE) throw this.danado();
        this.buffer = this.buffer.subarray(9);
        this.estado = "cabeza";
      } else if (this.estado === "cabeza") {
        if (this.buffer.length < 1) return;
        if (this.buffer[0] === 0) {
          if (this.buffer.length < 5) return;
          if (this.buffer.readUInt32BE(1) !== this.cuenta) throw this.danado("El archivo no trae todos los archivos del respaldo.");
          if (this.buffer.length > 5) throw this.danado("El archivo trae datos después del final del respaldo.");
          this.buffer = Buffer.alloc(0);
          this.terminado = true;
          this.estado = "fin";
          return;
        }
        if (this.buffer[0] !== 1 || this.buffer.length < 3) {
          if (this.buffer[0] !== 1) throw this.danado();
          return;
        }
        const largo = this.buffer.readUInt16BE(1);
        if (this.buffer.length < 3 + largo + 8) return;
        const ruta = this.buffer.subarray(3, 3 + largo).toString("utf8");
        const tamano = this.buffer.readBigUInt64BE(3 + largo);
        this.buffer = this.buffer.subarray(3 + largo + 8);
        await this.abrir(ruta, tamano);
      } else if (this.estado === "datos") {
        if (!this.buffer.length) return;
        const toma = Math.min(this.buffer.length, this.actual.faltan);
        const pedazo = this.buffer.subarray(0, toma);
        this.buffer = this.buffer.subarray(toma);
        await this.escribir(pedazo);
      } else {
        if (this.buffer.length) throw this.danado("El archivo trae datos después del final del respaldo.");
        return;
      }
    }
  }

  async abrir(ruta, tamano) {
    if (!rutaPortableValida(ruta)) throw this.danado(`El archivo trae una ruta no permitida (${JSON.stringify(ruta.slice(0, 120))}); no se abrió nada.`);
    if (this.vistas.has(ruta)) throw this.danado(`El archivo trae dos veces ${ruta}.`);
    if (this.cuenta === 0 && ruta !== "manifest.json") throw this.danado("El archivo no empieza con la ficha del respaldo.");
    if (ruta.startsWith("archivos/") && !this.declaradas?.has(ruta)) throw this.danado(`El archivo trae ${ruta}, que la ficha del respaldo no declara.`);
    if (tamano > BigInt(Number.MAX_SAFE_INTEGER) || this.bytes + Number(tamano) > this.limite) throw new ErrorPortable("demasiado_grande", "El respaldo es más grande que el límite permitido para importar.");
    if (ruta === "manifest.json" && tamano > 64n * 1024n * 1024n) throw this.danado("La ficha del respaldo es demasiado grande.");
    const absoluta = rutaLocal(this.destino, ruta);
    if (!absoluta) throw this.danado();
    fs.mkdirSync(path.dirname(absoluta), { recursive: true, mode: 0o700 });
    // "wx": nunca se sigue ni se pisa nada que ya exista (la carpeta es nueva).
    const archivo = await fs.promises.open(absoluta, "wx", 0o600);
    this.vistas.add(ruta);
    this.actual = { ruta, archivo, faltan: Number(tamano), partes: ruta === "manifest.json" ? [] : null };
    this.cuenta += 1;
    this.estado = "datos";
    if (this.actual.faltan === 0) await this.cerrarActual();
  }

  async escribir(pedazo) {
    await this.actual.archivo.write(pedazo);
    if (this.actual.partes) this.actual.partes.push(Buffer.from(pedazo));
    this.actual.faltan -= pedazo.length;
    this.bytes += pedazo.length;
    if (this.actual.faltan === 0) await this.cerrarActual();
  }

  async cerrarActual() {
    const { archivo, partes, ruta } = this.actual;
    await archivo.close();
    if (ruta === "manifest.json") {
      try {
        this.manifest = JSON.parse(Buffer.concat(partes).toString("utf8"));
      } catch {
        throw this.danado("La ficha del respaldo (manifest.json) está dañada.");
      }
      if (this.manifest?.formato !== FORMATO) throw this.danado("La ficha no es de un respaldo de FICOTOX.");
      this.declaradas = new Set((Array.isArray(this.manifest.archivos) ? this.manifest.archivos : []).map((a) => a?.ruta));
    }
    this.actual = null;
    this.estado = "cabeza";
  }

  async terminar() {
    if (!this.terminado || this.actual) throw new ErrorPortable("archivo_truncado", "El archivo está incompleto (se cortó al copiarlo o descargarlo).");
    if (!this.vistas.has(RUTA_BASE)) throw this.danado("El archivo no trae la base de datos del respaldo.");
  }

  async cerrar() {
    if (this.actual?.archivo) await this.actual.archivo.close();
    this.actual = null;
  }
}
