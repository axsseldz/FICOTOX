/*
 * Adjuntos (Fase 10): evidencia instrumental o calculos de un registro
 * (especificacion FX-MO-2-1, seccion 7, etapa "Resultados"). La tabla
 * `adjuntos` es generica (entidad + entidad_id) para reutilizarse despues en
 * incidencias y otros registros; en esta fase solo se habilita en analisis.
 *
 * Catalogo compartido entre servidor e interfaz: tipos de evidencia,
 * extensiones permitidas y firmas de bytes. La validacion definitiva la hace
 * el servidor; la interfaz la usa para avisar antes de subir.
 */

/* Fase 11: tambien incidencias (fotos, bitacoras, correos) y acciones correctivas (evidencia de implementacion). */
export const ENTIDADES_ADJUNTOS = ["analisis", "incidencia", "accion_correctiva"] as const;
export type EntidadAdjunto = (typeof ENTIDADES_ADJUNTOS)[number];

export const TIPOS_EVIDENCIA = [
  { value: "cromatograma", label: "Cromatograma" },
  { value: "reporte_equipo", label: "Reporte del equipo" },
  { value: "hoja_calculo", label: "Hoja de cálculo" },
  { value: "curva_calibracion", label: "Curva de calibración" },
  { value: "certificado_material_referencia", label: "Certificado de material de referencia" },
  { value: "foto", label: "Fotografía" },
  { value: "otro", label: "Otro" },
] as const;
export const TIPO_EVIDENCIA_LABEL: Record<string, string> = Object.fromEntries(TIPOS_EVIDENCIA.map((t) => [t.value, t.label]));

/* Articulo para las frases de la bitacora: "adjuntó el cromatograma", "adjuntó la hoja de cálculo". */
export const TIPO_EVIDENCIA_ART: Record<string, string> = {
  cromatograma: "el cromatograma",
  reporte_equipo: "el reporte del equipo",
  hoja_calculo: "la hoja de cálculo",
  curva_calibracion: "la curva de calibración",
  certificado_material_referencia: "el certificado de material de referencia",
  foto: "la fotografía",
  otro: "la evidencia",
};

export const EXTENSIONES_EVIDENCIA = ["pdf", "png", "jpg", "jpeg", "tif", "tiff", "csv", "txt", "xlsx", "xls", "zip", "cdf"] as const;

/* Tipo MIME con que se sirve cada extension (nunca el que manda el navegador). */
export const MIME_EVIDENCIA: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  tif: "image/tiff",
  tiff: "image/tiff",
  csv: "text/csv; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  zip: "application/zip",
  cdf: "application/x-netcdf",
};

/*
 * Vista previa en linea solo para PDF e imagenes que los navegadores muestran;
 * TIFF se descarga (Chrome y Firefox no lo muestran y la hoja quedaria vacia).
 */
export const VISTA_PREVIA = new Set(["pdf", "png", "jpg", "jpeg"]);
export const DESCRIPCION_MIN = 5;
export const MOTIVO_MIN = 5;

/* Extension en minusculas sin punto ("" si no tiene). */
export function extensionDe(nombre: string): string {
  const limpio = String(nombre || "").trim();
  const punto = limpio.lastIndexOf(".");
  return punto > 0 ? limpio.slice(punto + 1).toLowerCase() : "";
}

/*
 * Nombre original saneado para guardarlo como dato y ponerlo en
 * Content-Disposition: sin rutas (../, \), sin caracteres de control ni
 * comillas, con longitud acotada. Nunca se usa como ruta en disco.
 */
export function sanearNombre(nombre: string): string {
  const base = String(nombre || "").split(/[\\/]/).pop() || "";
  const limpio = base
    .normalize("NFC")
    // Controles, marcas de direccion (bidi: U+061C, U+200E/F, U+202A-202E, U+2066-2069) e invisibles (U+200B-200D, U+2060, U+FEFF) que falsean como se ve el nombre.
    .replace(/[\u0000-\u001f\u007f"<>:|?*;\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g, "")
    .replace(/^\.+/, "")
    .replace(/\s+/g, " ")
    .trim();
  const ext = extensionDe(limpio);
  const sinExt = ext ? limpio.slice(0, -(ext.length + 1)) : limpio;
  const cuerpo = sinExt.slice(0, 180) || "archivo";
  return ext ? `${cuerpo}.${ext}` : cuerpo;
}

const empiezaCon = (bytes: Uint8Array, firma: number[], desde = 0) => firma.every((b, i) => bytes[desde + i] === b);
const ascii = (bytes: Uint8Array, n: number) => Array.from(bytes.slice(0, n), (b) => String.fromCharCode(b)).join("");

/* Contenido peligroso aunque se renombre: ejecutables, scripts, HTML y SVG. */
function contenidoPeligroso(bytes: Uint8Array): string | null {
  if (empiezaCon(bytes, [0x4d, 0x5a])) return "un ejecutable de Windows";
  if (empiezaCon(bytes, [0x7f, 0x45, 0x4c, 0x46])) return "un ejecutable";
  const macho = [[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe]];
  if (macho.some((firma) => empiezaCon(bytes, firma))) return "un ejecutable";
  if (empiezaCon(bytes, [0x23, 0x21])) return "un script";
  // Primeros 1 KB como texto (sin BOM ni espacios) para detectar HTML, SVG o JavaScript.
  const cabeza = ascii(bytes, 1024).replace(/^﻿|^ï»¿/, "").trimStart().toLowerCase();
  if (/^<(!doctype\s+html|html|head|body|script|iframe|svg|object|embed|meta|link|style|img|a\s)/.test(cabeza)) return "HTML o SVG";
  if (/^<\?xml[\s\S]*<svg/.test(cabeza)) return "SVG";
  if (/<script[\s>]|<svg[\s>]|javascript:/.test(cabeza)) return "HTML o SVG";
  return null;
}

/* HTML, SVG o script en cualquier parte de un archivo de texto. */
function marcadoActivo(bytes: Uint8Array): boolean {
  let texto = "";
  for (let i = 0; i < bytes.length; i += 65536) texto += String.fromCharCode(...bytes.subarray(i, Math.min(i + 65536, bytes.length)));
  // Entidades numericas decodificadas (java&#x73;cript:) y sin espacios de relleno antes de buscar.
  const plano = texto.replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => String.fromCharCode(Number.parseInt(h, 16) || 32)).replace(/&#(\d+);?/g, (_m, d: string) => String.fromCharCode(Number(d) || 32));
  // Etiquetas activas conocidas y cualquier etiqueta con un atributo de evento (on...=, tambien tras "/").
  // No se rechaza cualquier "<letra": los resultados de laboratorio usan "<LD" o "<5".
  return /<\s*\/?\s*(script|svg|html|iframe|frame|frameset|object|embed|applet|body|img|image|link|meta|style|base|form|input|button|details|marquee|video|audio|math|a)\b|(java|vb)script\s*:|<[a-z][^>]*[\s/]on[a-z]+\s*=/i.test(plano);
}

/*
 * ¿El contenido corresponde a la extension? Firma de bytes para pdf, png,
 * jpg, tif, zip, xlsx (zip), xls (OLE) y cdf (netCDF/HDF5); csv y txt deben
 * ser texto (sin bytes nulos). Devuelve el problema o null.
 */
export function problemaDeContenido(ext: string, bytes: Uint8Array): string | null {
  if (!bytes.length) return "El archivo está vacío";
  const peligro = contenidoPeligroso(bytes);
  if (peligro) return `El contenido del archivo es ${peligro}; no se admite`;
  const zip = empiezaCon(bytes, [0x50, 0x4b, 0x03, 0x04]) || empiezaCon(bytes, [0x50, 0x4b, 0x05, 0x06]);
  const ok: Record<string, boolean> = {
    pdf: ascii(bytes, 5) === "%PDF-",
    png: empiezaCon(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    jpg: empiezaCon(bytes, [0xff, 0xd8, 0xff]),
    jpeg: empiezaCon(bytes, [0xff, 0xd8, 0xff]),
    tif: empiezaCon(bytes, [0x49, 0x49, 0x2a, 0x00]) || empiezaCon(bytes, [0x4d, 0x4d, 0x00, 0x2a]),
    tiff: empiezaCon(bytes, [0x49, 0x49, 0x2a, 0x00]) || empiezaCon(bytes, [0x4d, 0x4d, 0x00, 0x2a]),
    zip,
    xlsx: zip,
    // Biblioteca: Office abierto (zip) e imagen WebP (RIFF....WEBP).
    docx: zip,
    pptx: zip,
    webp: ascii(bytes, 4) === "RIFF" && ascii(bytes.slice(8, 12), 4) === "WEBP",
    xls: empiezaCon(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    cdf: ascii(bytes, 3) === "CDF" || empiezaCon(bytes, [0x89, 0x48, 0x44, 0x46]),
    csv: !bytes.slice(0, 8192).includes(0),
    txt: !bytes.slice(0, 8192).includes(0),
    md: !bytes.slice(0, 8192).includes(0),
  };
  if (!(ext in ok)) return "Formato no permitido";
  // Texto (csv, txt, md): se revisa TODO el contenido, no solo el inicio, por si trae HTML, SVG o script en medio.
  if ((ext === "csv" || ext === "txt" || ext === "md") && marcadoActivo(bytes)) return "El archivo de texto contiene HTML, SVG o script; no se admite";
  return ok[ext] ? null : `El contenido no corresponde a un archivo .${ext}`;
}

/* Huella abreviada para mostrar (la completa va en el tooltip). */
export const huellaCorta = (sha: unknown) => (sha ? `${String(sha).slice(0, 12)}…` : "—");

/* Tamano legible: 1.2 MB, 340 KB. */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
