/* Tipos de respaldo-portable.mjs (archivo .ficotox: respaldo empacado y cifrado). */
import type { Manifest } from "./respaldo.mjs";

export const MAGIA: Buffer;
export const MAGIA_CONTENIDO: Buffer;
export const VERSION_PORTABLE: number;
export const FORMATO_PORTABLE: string;
export const EXTENSION: string;
export const CONTRASENA_MIN: number;
export const KDF_POR_OMISION: { N: number; r: number; p: number };
export const TROZO: number;

export class ErrorPortable extends Error {
  codigo: string;
  constructor(codigo: string, mensaje: string);
}

export interface Cifrado {
  clave: Buffer;
  sal: Buffer;
  prefijo: Buffer;
  kdf: { N: number; r: number; p: number };
  trozo: number;
}

export interface EntradaPortable {
  ruta: string;
  absoluta: string;
  tamano: number;
}

export function nombreValidoEnWindows(segmento: string): boolean;
export function rutaPortableValida(ruta: string): boolean;
export function rutaLocal(raiz: string, ruta: string, sistema?: typeof import("node:path")): string | null;
export function validarContrasena(contrasena: unknown): string | null;
export function prepararCifrado(contrasena: string, kdf?: { N: number; r: number; p: number }): Promise<Cifrado>;
export function armarEncabezado(cifrado: Cifrado, contenido: number): Buffer;
export function largoCifrado(largoEncabezado: number, contenido: number, trozo: number): number;
export function entradasDeRespaldo(carpeta: string): EntradaPortable[];
export function tamanoPortable(entradas: EntradaPortable[], cifrado: Cifrado): { contenido: number; archivo: number };
export function flujoPortable(entradas: EntradaPortable[], cifrado: Cifrado): AsyncGenerator<Buffer>;
export function escribirPortable(carpeta: string, contrasena: string, destino: string): Promise<{ tamano: number; entradas: number }>;
export function leerEncabezado(archivo: string): { parametros: Record<string, unknown>; encabezado: Buffer; sal: Buffer; prefijo: Buffer; verificador: Buffer; trozo: number; contenido: number; kdf: { N: number; r: number; p: number } };
export function claveDeArchivo(encabezado: ReturnType<typeof leerEncabezado>, contrasena: string): Promise<Buffer>;
export function abrirPortable(opciones: { archivo: string; contrasena: string; destino: string; limiteBytes?: number; alAvance?: (fraccion: number) => void }): Promise<{ manifest: Manifest; archivos: number; bytes: number }>;
