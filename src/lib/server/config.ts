import fs from "node:fs";
import path from "node:path";

/*
 * Configuracion de la aplicacion (variables de entorno y rutas de datos).
 * Next.js carga .env / .env.local de la raiz del proyecto. Ademas se respeta
 * FICOTOX_ENV_FILE para las variables que no esten definidas todavia; el
 * lanzador (scripts/start-ficotox.mjs) hace lo mismo para el modo standalone.
 */

export interface AppConfig {
  BASE_DIR: string;
  INSTANCE_DIR: string;
  SECRET_KEY: string;
  DATABASE_URL: string;
  SQLITE_PATH: string | null;
  JWT_SECRET: string;
  JWT_EXPIRES_HOURS: number;
  /* Dominios de correo admitidos al dar de alta cuentas (vacio = cualquiera). */
  ALLOWED_EMAIL_DOMAINS: string[];
  CORS_ORIGINS: string;
  /* Fase 2: bloqueo por intentos, sesiones y reautenticacion. */
  LOGIN_MAX_INTENTOS: number;
  LOGIN_VENTANA_MIN: number;
  LOGIN_BLOQUEO_MIN: number;
  LOGIN_IP_MAX_INTENTOS: number;
  TRUST_PROXY: boolean;
  /* Lo que captura una cuenta temporal con supervisor queda pendiente de visto bueno (Fase 2). */
  SUPERVISAR_CUENTAS_TEMPORALES: boolean;
  SESION_INACTIVIDAD_MIN: number;
  REAUTH_TTL_MIN: number;
  /* Fase 3: dias que una solicitud de autorizacion espera al segundo usuario antes de vencer. */
  SOLICITUD_VENCE_DIAS: number;
  /* Fase 4: validar autorizaciones del personal (FX-THF-AP) al guardar; false solo para cargar datos iniciales. */
  AUTORIZACIONES_OBLIGATORIAS: boolean;
  /* Fase 10: evidencia instrumental de los analisis (tamano maximo por archivo y si es obligatoria al enviar a revision). */
  EVIDENCIA_MAX_MB: number;
  /* Documentos SGC: tamano maximo por archivo (MB). DOCUMENTOS_MAX_MB (antes BIBLIOTECA_MAX_MB, que se sigue leyendo). */
  DOCUMENTOS_MAX_MB: number;
  EVIDENCIA_OBLIGATORIA_ANALISIS: boolean;
  /* Fase 10: respaldos locales (carpeta, cuantos se conservan) y avisos (horas sin respaldo, dias sin prueba de restauracion). */
  RESPALDOS_DIR: string;
  RESPALDO_RETENCION: number;
  RESPALDO_AVISO_HORAS: number;
  PRUEBA_RESTAURACION_AVISO_DIAS: number;
}

function envInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

let cached: AppConfig | null = null;

function envBool(name: string, fallback: string): boolean {
  return (process.env[name] ?? fallback).toLowerCase() === "true";
}

// Acceso indirecto para que el trazado de archivos de Turbopack no incluya
// todo el proyecto en la salida standalone (la ruta se decide en tiempo de ejecucion).
const readTextFile = (target: string): string | null => {
  try {
    return String((fs as unknown as Record<string, (p: string, enc: string) => unknown>)["readFile" + "Sync"](target, "utf8"));
  } catch {
    return null;
  }
};

/* Carga un archivo .env sin sobrescribir variables ya definidas (load_dotenv override=False). */
function loadEnvFile(target: string): void {
  const content = readTextFile(target);
  if (content === null) return;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    const name = key.trim().replace(/^export\s+/, "");
    const value = rest.join("=").trim().replace(/^(["'])(.*)\1$/, "$2");
    if (name && !(name in process.env)) process.env[name] = value;
  }
}

function loadEnvironment(baseDir: string): void {
  const configured = (process.env.FICOTOX_ENV_FILE || "").trim();
  if (configured) {
    loadEnvFile(path.resolve(/*turbopackIgnore: true*/ baseDir, configured));
    return;
  }
  loadEnvFile(path.join(/*turbopackIgnore: true*/ baseDir, ".env"));
}

function resolveSqlitePath(baseDir: string): string {
  const configured = (process.env.SQLITE_PATH || "").trim();
  if (configured) {
    return path.resolve(/*turbopackIgnore: true*/ baseDir, configured);
  }
  // FICOTOX_DATA_DIR (volumen de un hosting): <datos>/instance/ficotox.sqlite3.
  const datos = (process.env.FICOTOX_DATA_DIR || "").trim();
  if (datos) return path.join(/*turbopackIgnore: true*/ path.resolve(baseDir, datos), "instance", "ficotox.sqlite3");
  return path.join(/*turbopackIgnore: true*/ baseDir, "instance", "ficotox.sqlite3");
}

function buildDatabaseUrl(baseDir: string): { url: string; sqlitePath: string | null } {
  const explicit = (process.env.DATABASE_URL || "").trim();
  if (explicit) {
    if (explicit.startsWith("sqlite:")) {
      const raw = explicit.replace(/^sqlite:\/*/, "");
      const sqlitePath = path.isAbsolute(raw) ? raw : path.resolve(/*turbopackIgnore: true*/ baseDir, raw);
      return { url: `sqlite:///${sqlitePath}`, sqlitePath };
    }
    return { url: explicit, sqlitePath: null };
  }
  const sqlitePath = resolveSqlitePath(baseDir);
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  return { url: `sqlite:///${sqlitePath}`, sqlitePath };
}

export function getConfig(): AppConfig {
  if (cached) return cached;
  const BASE_DIR = process.env.FICOTOX_BASE_DIR ? path.resolve(/*turbopackIgnore: true*/ process.env.FICOTOX_BASE_DIR) : process.cwd();
  loadEnvironment(BASE_DIR);
  const { url, sqlitePath } = buildDatabaseUrl(BASE_DIR);
  const instanceDir = process.env.FICOTOX_INSTANCE_DIR
    ? path.resolve(/*turbopackIgnore: true*/ BASE_DIR, process.env.FICOTOX_INSTANCE_DIR)
    : sqlitePath
      ? path.dirname(sqlitePath)
      : path.join(/*turbopackIgnore: true*/ BASE_DIR, "instance");

  cached = {
    BASE_DIR,
    INSTANCE_DIR: instanceDir,
    // Se lee en cada uso: la Configuracion inicial puede adoptar la llave de un respaldo sin reiniciar (y cada ruta puede tener su copia de este modulo).
    get SECRET_KEY() {
      return process.env.SECRET_KEY || "ficotox-dev-secret";
    },
    DATABASE_URL: url,
    SQLITE_PATH: sqlitePath,
    JWT_SECRET: process.env.JWT_SECRET || "ficotox-jwt-secret",
    JWT_EXPIRES_HOURS: envInt("JWT_EXPIRES_HOURS", 8),
    ALLOWED_EMAIL_DOMAINS: (process.env.ALLOWED_EMAIL_DOMAINS || "")
      .split(",")
      .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean),
    // Por omision solo el mismo origen (sin encabezados CORS); "*" o una lista se configuran.
    CORS_ORIGINS: process.env.CORS_ORIGINS ?? "",
    LOGIN_MAX_INTENTOS: envInt("LOGIN_MAX_INTENTOS", 5),
    LOGIN_VENTANA_MIN: envInt("LOGIN_VENTANA_MIN", 15),
    LOGIN_BLOQUEO_MIN: envInt("LOGIN_BLOQUEO_MIN", 15),
    LOGIN_IP_MAX_INTENTOS: envInt("LOGIN_IP_MAX_INTENTOS", 20),
    // Detras del proxy de un hosting: TRUST_PROXY=true o 1.
    TRUST_PROXY: ["true", "1"].includes((process.env.TRUST_PROXY ?? "false").trim().toLowerCase()),
    SUPERVISAR_CUENTAS_TEMPORALES: envBool("SUPERVISAR_CUENTAS_TEMPORALES", "true"),
    SESION_INACTIVIDAD_MIN: envInt("SESION_INACTIVIDAD_MIN", 30),
    REAUTH_TTL_MIN: envInt("REAUTH_TTL_MIN", 5),
    SOLICITUD_VENCE_DIAS: envInt("SOLICITUD_VENCE_DIAS", 7),
    AUTORIZACIONES_OBLIGATORIAS: envBool("AUTORIZACIONES_OBLIGATORIAS", "true"),
    EVIDENCIA_MAX_MB: envInt("EVIDENCIA_MAX_MB", 25),
    DOCUMENTOS_MAX_MB: envInt("DOCUMENTOS_MAX_MB", envInt("BIBLIOTECA_MAX_MB", 50)),
    EVIDENCIA_OBLIGATORIA_ANALISIS: envBool("EVIDENCIA_OBLIGATORIA_ANALISIS", "true"),
    // Misma carpeta que scripts/backup_ficotox.py: FICOTOX_BACKUP_DIR o <proyecto>/backups.
    // turbopackIgnore: la carpeta se decide en tiempo de ejecucion; sin esto el build standalone copiaria backups/.
    RESPALDOS_DIR: process.env.FICOTOX_BACKUP_DIR ? path.resolve(/*turbopackIgnore: true*/ BASE_DIR, process.env.FICOTOX_BACKUP_DIR) : path.join(/*turbopackIgnore: true*/ process.env.FICOTOX_DATA_DIR ? path.resolve(BASE_DIR, process.env.FICOTOX_DATA_DIR) : BASE_DIR, "backups"),
    RESPALDO_RETENCION: envInt("RESPALDO_RETENCION", 30),
    RESPALDO_AVISO_HORAS: envInt("RESPALDO_AVISO_HORAS", 24),
    PRUEBA_RESTAURACION_AVISO_DIAS: envInt("PRUEBA_RESTAURACION_AVISO_DIAS", 90),
  };
  return cached;
}
