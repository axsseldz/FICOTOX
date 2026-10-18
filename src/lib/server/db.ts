import { getConfig } from "./config";

/*
 * Capa de acceso a datos equivalente a Flask-SQLAlchemy con SQL crudo.
 *
 * - Misma sintaxis de parametros nombrados ":param" en SQLite y MySQL.
 * - Una "sesion" por request con commit() explicito; si el handler termina
 *   sin commit se hace rollback (igual que el cierre de sesion de SQLAlchemy).
 * - SQLite: una sola conexion better-sqlite3, sesiones serializadas con un
 *   mutex (SQLite es single-writer y la carga es de laboratorio).
 * - MySQL/MariaDB: pool mysql2 con una conexion dedicada por sesion.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
export type Params = Record<string, unknown>;
export type Dialect = "sqlite" | "mysql";

export interface ExecuteResult {
  lastrowid: number | null;
  rowcount: number;
}

export interface Session {
  readonly dialect: Dialect;
  query<T extends Row = Row>(sql: string, params?: Params): Promise<T[]>;
  queryOne<T extends Row = Row>(sql: string, params?: Params): Promise<T | null>;
  scalar<T = unknown>(sql: string, params?: Params): Promise<T | null>;
  execute(sql: string, params?: Params): Promise<ExecuteResult>;
  commit(): Promise<void>;
  /* Fase 12: true si ya se confirmo algo en esta sesion (entonces un reintento repetiria efectos). */
  readonly confirmado: boolean;
  rollback(): Promise<void>;
}

const NAMED_PARAM_RE = /(?<![:\w]):([A-Za-z_][A-Za-z0-9_]*)/g;

function normalizeValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return Number(value);
  return value;
}

/*
 * Python liga `int` como INTEGER y `float` como REAL; better-sqlite3 liga todo
 * `number` como REAL, lo que en columnas de texto guardaba "7.0" en vez de "7".
 * Los enteros se ligan como BigInt para conservar la afinidad INTEGER.
 */
function sqliteParams(sql: string, params: Params): Params {
  const used = usedParams(sql, params);
  for (const [name, value] of Object.entries(used)) {
    if (typeof value === "number" && Number.isSafeInteger(value)) used[name] = BigInt(value);
  }
  return used;
}

function usedParams(sql: string, params: Params): Params {
  const names = new Set<string>();
  for (const match of sql.matchAll(NAMED_PARAM_RE)) names.add(match[1]);
  const result: Params = {};
  for (const name of names) {
    if (!(name in params)) {
      throw new Error(`Falta el parametro SQL ":${name}"`);
    }
    result[name] = normalizeValue(params[name]);
  }
  return result;
}

let dialectCache: Dialect | null = null;

export function getDialect(): Dialect {
  if (dialectCache) return dialectCache;
  const url = getConfig().DATABASE_URL;
  dialectCache = url.startsWith("mysql") || url.startsWith("mariadb") ? "mysql" : "sqlite";
  return dialectCache;
}

export function isSqlite(): boolean {
  return getDialect() === "sqlite";
}

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------

type SqliteDatabase = import("better-sqlite3").Database;

let sqliteDb: SqliteDatabase | null = null;
let sqliteChain: Promise<void> = Promise.resolve();

function getSqliteDb(): SqliteDatabase {
  if (sqliteDb) return sqliteDb;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const config = getConfig();
  sqliteDb = new Database(config.SQLITE_PATH || ":memory:");
  aplicarPragmasSqlite(sqliteDb);
  return sqliteDb;
}

/*
 * Fase 12: configuracion de SQLite para produccion (README.md).
 * - journal_mode=WAL: los lectores no bloquean al escritor ni al reves (los
 *   scripts de respaldo, verificacion y pruebas leen mientras el servidor escribe).
 * - synchronous=NORMAL: con WAL es seguro ante caidas de la aplicacion y del
 *   sistema operativo (una caida de corriente puede perder solo la ultima
 *   transaccion confirmada, nunca corromper la base); FULL hace fsync en cada
 *   commit y no aporta integridad adicional con WAL.
 * - busy_timeout=5000: si otro proceso (un script) tiene la base, se espera
 *   hasta 5 s en lugar de fallar con SQLITE_BUSY.
 * - foreign_keys=ON: el esquema SQLite no declara llaves foraneas hoy
 *   (foreign_key_check sin violaciones en la base real); se activa para que
 *   las que se agreguen en migraciones futuras se cumplan.
 */
export const PRAGMAS_SQLITE = { journal_mode: "WAL", synchronous: "NORMAL", busy_timeout: 5000, foreign_keys: "ON" } as const;

function aplicarPragmasSqlite(db: SqliteDatabase): void {
  if ((getConfig().SQLITE_PATH || ":memory:") !== ":memory:") db.pragma(`journal_mode = ${PRAGMAS_SQLITE.journal_mode}`);
  db.pragma(`synchronous = ${PRAGMAS_SQLITE.synchronous}`);
  db.pragma(`busy_timeout = ${PRAGMAS_SQLITE.busy_timeout}`);
  db.pragma(`foreign_keys = ${PRAGMAS_SQLITE.foreign_keys}`);
}

function withSqliteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = sqliteChain.then(fn);
  sqliteChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

class SqliteSession implements Session {
  readonly dialect: Dialect = "sqlite";
  private inTransaction = false;
  confirmado = false;

  constructor(private readonly db: SqliteDatabase) {}

  private begin() {
    if (!this.inTransaction) {
      this.db.exec("BEGIN");
      this.inTransaction = true;
    }
  }

  async query<T extends Row = Row>(sql: string, params: Params = {}): Promise<T[]> {
    this.begin();
    const statement = this.db.prepare(sql);
    if (statement.reader) {
      return statement.all(sqliteParams(sql, params)) as T[];
    }
    statement.run(sqliteParams(sql, params));
    return [];
  }

  async queryOne<T extends Row = Row>(sql: string, params: Params = {}): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length ? rows[0] : null;
  }

  async scalar<T = unknown>(sql: string, params: Params = {}): Promise<T | null> {
    const row = await this.queryOne(sql, params);
    if (!row) return null;
    const first = Object.values(row)[0];
    return (first ?? null) as T | null;
  }

  async execute(sql: string, params: Params = {}): Promise<ExecuteResult> {
    this.begin();
    const statement = this.db.prepare(sql);
    if (statement.reader) {
      statement.all(sqliteParams(sql, params));
      return { lastrowid: null, rowcount: 0 };
    }
    const info = statement.run(sqliteParams(sql, params));
    return { lastrowid: Number(info.lastInsertRowid) || null, rowcount: info.changes };
  }

  async commit(): Promise<void> {
    if (this.inTransaction) {
      this.db.exec("COMMIT");
      this.inTransaction = false;
      this.confirmado = true;
    }
  }

  async rollback(): Promise<void> {
    if (this.inTransaction) {
      this.db.exec("ROLLBACK");
      this.inTransaction = false;
    }
  }

  async close(): Promise<void> {
    await this.rollback();
  }
}

// ---------------------------------------------------------------------------
// MySQL / MariaDB
// ---------------------------------------------------------------------------

type MysqlPool = import("mysql2/promise").Pool;
type MysqlConnection = import("mysql2/promise").PoolConnection;
type QueryValues = import("mysql2").QueryValues;

let mysqlPool: MysqlPool | null = null;

function getMysqlPool(): MysqlPool {
  if (mysqlPool) return mysqlPool;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mysql = require("mysql2/promise") as typeof import("mysql2/promise");
  const url = new URL(getConfig().DATABASE_URL.replace(/^mysql\+pymysql:/, "mysql:").replace(/^mariadb:/, "mysql:"));
  mysqlPool = mysql.createPool({
    host: url.hostname || "localhost",
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    namedPlaceholders: true,
    dateStrings: true,
    multipleStatements: false,
    connectionLimit: 10,
    charset: "utf8mb4",
    // Fase 3: los TIMESTAMP (CURRENT_TIMESTAMP) se guardan y leen en UTC, igual que en SQLite;
    // la interfaz los muestra en America/Tijuana (src/lib/shared/fechas.ts).
    timezone: "Z",
  });
  // Cada conexion nueva trabaja en UTC, sin importar la zona del servidor MySQL.
  (mysqlPool as unknown as { pool: { on: (evento: string, fn: (conn: { query: (sql: string) => void }) => void) => void } }).pool.on("connection", (conn) => {
    conn.query("SET time_zone = '+00:00'");
  });
  return mysqlPool;
}

class MysqlSession implements Session {
  readonly dialect: Dialect = "mysql";
  private inTransaction = false;
  confirmado = false;

  constructor(private readonly connection: MysqlConnection) {}

  private async begin() {
    if (!this.inTransaction) {
      await this.connection.beginTransaction();
      this.inTransaction = true;
    }
  }

  async query<T extends Row = Row>(sql: string, params: Params = {}): Promise<T[]> {
    await this.begin();
    const [rows] = await this.connection.query(sql, usedParams(sql, params) as QueryValues);
    return Array.isArray(rows) ? (rows as T[]) : [];
  }

  async queryOne<T extends Row = Row>(sql: string, params: Params = {}): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length ? rows[0] : null;
  }

  async scalar<T = unknown>(sql: string, params: Params = {}): Promise<T | null> {
    const row = await this.queryOne(sql, params);
    if (!row) return null;
    const first = Object.values(row)[0];
    return (first ?? null) as T | null;
  }

  async execute(sql: string, params: Params = {}): Promise<ExecuteResult> {
    await this.begin();
    const [result] = await this.connection.query(sql, usedParams(sql, params) as QueryValues);
    if (Array.isArray(result)) return { lastrowid: null, rowcount: 0 };
    const header = result as { insertId?: number; affectedRows?: number };
    return { lastrowid: header.insertId || null, rowcount: header.affectedRows ?? 0 };
  }

  async commit(): Promise<void> {
    if (this.inTransaction) {
      await this.connection.commit();
      this.inTransaction = false;
      this.confirmado = true;
    }
  }

  async rollback(): Promise<void> {
    if (this.inTransaction) {
      await this.connection.rollback();
      this.inTransaction = false;
    }
  }

  async close(): Promise<void> {
    await this.rollback();
    this.connection.release();
  }
}

// ---------------------------------------------------------------------------

export async function withSession<T>(fn: (session: Session) => Promise<T>): Promise<T> {
  if (isSqlite()) {
    return withSqliteLock(async () => {
      const session = new SqliteSession(getSqliteDb());
      try {
        return await fn(session);
      } finally {
        await session.close();
      }
    });
  }

  const connection = await getMysqlPool().getConnection();
  const session = new MysqlSession(connection);
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

// Clasificacion de errores equivalente a IntegrityError / OperationalError.
export function isIntegrityError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code || "");
  const message = String((error as { message?: unknown }).message || "");
  return (
    code.startsWith("SQLITE_CONSTRAINT") ||
    code === "ER_DUP_ENTRY" ||
    code === "ER_NO_REFERENCED_ROW_2" ||
    code === "ER_ROW_IS_REFERENCED_2" ||
    /constraint failed/i.test(message)
  );
}

/*
 * Fase 12: choque de unicidad de una serie con folio. SQLite nombra la columna
 * ("UNIQUE constraint failed: muestras_recepcion.folio_num"); MySQL/MariaDB nombra
 * el indice, y un UNIQUE sin nombre toma el de su primera columna: el de
 * extracciones es (tipo_registro, folio_num) -> "for key '...tipo_registro'".
 * Tambien el codigo automatico de los reportes de mantenimiento.
 */
const RE_CHOQUE_FOLIO = /folio|for key '(?:[\w$]+\.)?tipo_registro'|reportes_mantenimiento\.codigo|for key '(?:reportes_mantenimiento\.)?codigo'/i;
export function esConflictoDeFolio(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code || "");
  const message = String((error as { message?: unknown }).message || "");
  return (code === "ER_DUP_ENTRY" || code.startsWith("SQLITE_CONSTRAINT") || /constraint failed/i.test(message)) && RE_CHOQUE_FOLIO.test(message);
}

export function isOperationalError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code || "");
  return (
    code === "SQLITE_CANTOPEN" ||
    code === "SQLITE_READONLY" ||
    code === "SQLITE_IOERR" ||
    code === "SQLITE_BUSY" ||
    code === "SQLITE_ERROR" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ER_ACCESS_DENIED_ERROR" ||
    code === "ER_BAD_DB_ERROR" ||
    code === "PROTOCOL_CONNECTION_LOST"
  );
}
