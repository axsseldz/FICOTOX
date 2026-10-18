/* Tipos de respaldo.mjs (respaldo y restauracion, Fase 10). */
export const ESQUEMA_VERSION: number;
export const FORMATO: string;
export const VERSION_FORMATO: number;
export const TABLAS_PRINCIPALES: string[];
export const CARPETAS_ARCHIVOS: string[];
export const ARCHIVO_LLAVE: string;
export const CARPETA_ACTAS: string;

export interface Entorno {
  baseDir: string;
  motor: "sqlite" | "mysql";
  sqlitePath: string | null;
  instanceDir: string;
  respaldosDir: string;
  secretKey: string;
  retencion: number;
  puerto: number;
}

export interface Manifest {
  formato: string;
  version_formato: number;
  id: string;
  creado_en: string;
  host: string;
  app: { version: string | null; commit: string | null };
  esquema_version: number | null;
  esquema_app?: number;
  motor: string;
  etiqueta: string | null;
  base: { ruta: string; tamano: number; sha256: string; integrity_check: string };
  conteos: Record<string, number>;
  bitacora: { entradas: number; ultimo_id: number | null; ultimo_hash: string | null };
  archivos: Array<{ ruta: string; tamano: number; sha256: string }>;
  llave: { incluida: boolean; origen: string | null; huella: string | null; ruta: string | null };
  sello?: string;
}

export interface RespaldoListado {
  id: string;
  carpeta: string;
  creado_en: string;
  host: string;
  app: { version: string | null; commit: string | null };
  esquema_version: number | null;
  esquema_app?: number;
  etiqueta: string | null;
  tamano: number;
  archivos: number;
  incluye_llave: boolean;
  bitacora: Manifest["bitacora"];
  verificacion: { resultado: string; fecha: string; acta: string } | null;
}

export interface Acta {
  archivo: string;
  fecha: string;
  respaldo_id: string;
  responsable: string;
  modo: string;
  resultado: string;
  duracion_ms: number;
  [clave: string]: unknown;
}

export function resolverEntorno(baseDir: string, env?: Record<string, string | undefined>): Entorno;
export function sha256Archivo(ruta: string): Promise<string>;
export function huellaLlave(clave: string): string;
export function versionApp(baseDir: string): { version: string | null; commit: string | null };
export function inspeccionarBase(db: unknown): { conteos: Record<string, number>; bitacora: Manifest["bitacora"] };
export interface OpcionesRespaldo {
  Sqlite: unknown;
  sqlitePath: string | null;
  instanceDir: string;
  respaldosDir: string;
  secretKey?: string;
  baseDir?: string;
  incluirLlave?: boolean;
  etiqueta?: string | null;
  ahora?: Date;
}
/* Foto de la base tomada; falta copiar archivos y escribir el manifest (opaco para quien llama). */
export type RespaldoIniciado = { readonly id: string } & Record<string, unknown>;
export function crearRespaldo(opciones: OpcionesRespaldo): Promise<{ id: string; carpeta: string; manifest: Manifest }>;
export function iniciarRespaldo(opciones: OpcionesRespaldo): Promise<RespaldoIniciado>;
export function completarRespaldo(iniciado: RespaldoIniciado): Promise<{ id: string; carpeta: string; manifest: Manifest }>;
export function leerManifest(carpeta: string): Manifest;
export function hacerPrivado(ruta: string): void;
export function listarActas(respaldosDir: string): Acta[];
export function listarRespaldos(respaldosDir: string): RespaldoListado[];
export function aplicarRetencion(respaldosDir: string, retencion: number): string[];
export const RUTA_BASE: string;
export function carpetaRestauradas(instanceDir: string): string;
export function sellarManifest(manifest: Record<string, unknown>, clave: string): string;
export function huellaManifest(carpeta: string): string;
export function rutaArchivoValida(ruta: unknown): boolean;
