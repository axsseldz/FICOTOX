/* Tipos de motor.mjs (migraciones versionadas, Fase 12). */
export interface Migracion {
  version: number;
  nombre: string;
  pasos: unknown[];
  up(db: Adaptador, motor: "sqlite" | "mysql", ctx?: { instanceDir?: string | null }): Promise<void>;
}
export interface Adaptador {
  motor: "sqlite" | "mysql";
  raw: unknown;
  all(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  get(sql: string, params?: unknown[]): Promise<Record<string, unknown> | null>;
  run(sql: string, params?: unknown[]): Promise<{ cambios: number; id: number | null }>;
  exec(sql: string): Promise<void>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
export interface Esquema {
  tablas: Record<string, Record<string, string>>;
  indices: Record<string, string>;
  triggers: Record<string, string>;
}
export interface EstadoMigraciones {
  tipo: "vacia" | "versionada" | "sin_versionar";
  aplicadas: Record<string, unknown>[];
  pendientes: Migracion[];
  lineaBase: number | null;
  version: number | null;
}
export interface ResultadoMigracion {
  plan: { tipo: string; lineaBase: number | null; pendientes: { version: number; nombre: string }[] };
  aplicadas: { version: number; nombre: string; duracion_ms: number }[];
  lineaBase: number | null;
  respaldo: string | null;
}
type SqliteCtor = new (archivo: string, opciones?: Record<string, unknown>) => unknown;
export const MIGRACIONES: Migracion[];
export const VERSION_ACTUAL: number;
export const VERSIONES_BASELINE: number[];
export function checksumDe(m: Migracion): string;
export function adaptadorSqlite(db: unknown): Adaptador;
export function adaptadorMysql(conn: unknown): Adaptador;
export function esquemaDe(db: Adaptador): Promise<Esquema>;
export function diferencias(esperado: Esquema, actual: Esquema): string[];
export function esquemaEsperado(Sqlite: SqliteCtor, version: number, motor?: "sqlite" | "mysql"): Promise<Esquema>;
export function estadoMigraciones(db: Adaptador, opciones: { Sqlite: SqliteCtor }): Promise<EstadoMigraciones>;
export function aplicarMigraciones(
  db: Adaptador,
  opciones: { Sqlite: SqliteCtor; instanceDir?: string | null; clave?: string | null; appCommit?: string | null; respaldo?: (() => Promise<string | null>) | null; simular?: boolean; avisar?: (mensaje: string) => void; esperaMs?: number },
): Promise<ResultadoMigracion>;
export function versionDe(db: Adaptador): Promise<number | null>;
export function crearControl(db: Adaptador): Promise<void>;
export class ErrorMigracion extends Error {
  constructor(mensaje: string, datos?: { codigo?: string; version?: number; respaldo?: string | null; diferencias?: string[]; causa?: unknown });
  codigo: string;
  version?: number;
  respaldo?: string | null;
  diferencias?: string[];
}
