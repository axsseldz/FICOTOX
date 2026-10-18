import { getConfig } from "./config";
import { resolverClaveSello } from "../shared/audit-chain.mjs";
import { crearRespaldo, versionApp } from "../shared/respaldo.mjs";
import { adaptadorMysql, adaptadorSqlite, aplicarMigraciones, estadoMigraciones, ErrorMigracion, VERSION_ACTUAL, type Adaptador } from "./migraciones/motor.mjs";

/*
 * Fase 12: migraciones al arrancar el servidor (instrumentation-node.ts).
 *
 * - MIGRAR_AL_ARRANCAR=true (por omision): si hay migraciones pendientes (o una
 *   base anterior sin versionar), primero un respaldo "pre-migracion" y luego
 *   se aplican en orden; cada una queda en la bitacora como "Sistema".
 * - MIGRAR_AL_ARRANCAR=false: si hay pendientes, el servidor no arranca y pide
 *   correr `npm run migrar`.
 * - Cualquier problema (deriva de esquema, checksum alterado, base mas nueva
 *   que la aplicacion, fallo a mitad) detiene el arranque con un mensaje claro.
 * - MySQL: el respaldo previo se hace con mysqldump fuera de la aplicacion; si
 *   hay pendientes hace falta MIGRAR_MYSQL_RESPALDO_HECHO=true (ver
 *   README.md).
 */
export async function migrarAlArrancar(): Promise<void> {
  const cfg = getConfig();
  const automatico = (process.env.MIGRAR_AL_ARRANCAR ?? "true").trim().toLowerCase() !== "false";
  // better-sqlite3 es un modulo nativo externo (serverExternalPackages).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sqlite = require("better-sqlite3");
  let db: Adaptador;
  let cerrar: () => Promise<void>;
  if (cfg.SQLITE_PATH) {
    const conexion = new Sqlite(cfg.SQLITE_PATH);
    conexion.pragma("busy_timeout = 10000");
    db = adaptadorSqlite(conexion);
    cerrar = async () => conexion.close();
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mysql = require("mysql2/promise");
    const url = new URL(cfg.DATABASE_URL.replace(/^mysql\+pymysql:/, "mysql:").replace(/^mariadb:/, "mysql:"));
    const conexion = await mysql.createConnection({ host: url.hostname || "localhost", port: url.port ? Number(url.port) : 3306, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.replace(/^\//, ""), charset: "utf8mb4", timezone: "Z" });
    await conexion.query("SET time_zone = '+00:00'");
    db = adaptadorMysql(conexion);
    cerrar = async () => conexion.end();
  }
  try {
    if (!automatico) {
      const estado = await estadoMigraciones(db, { Sqlite });
      if (estado.pendientes.length || estado.lineaBase !== null) throw new ErrorMigracion(`Hay migraciones pendientes (${estado.pendientes.map((m) => m.version).join(", ") || `línea base ${estado.lineaBase}`}) y MIGRAR_AL_ARRANCAR=false: ejecuta "npm run migrar" con el servidor detenido.`, { codigo: "pendientes" });
      return;
    }
    const resultado = await aplicarMigraciones(db, {
      Sqlite,
      instanceDir: cfg.INSTANCE_DIR,
      clave: resolverClaveSello(cfg.SECRET_KEY, cfg.INSTANCE_DIR),
      appCommit: versionApp(cfg.BASE_DIR).commit,
      respaldo: async () => {
        if (!cfg.SQLITE_PATH) {
          if ((process.env.MIGRAR_MYSQL_RESPALDO_HECHO || "").toLowerCase() !== "true") throw new ErrorMigracion("Hay migraciones pendientes en MySQL/MariaDB: respalda la base con mysqldump y arranca con MIGRAR_MYSQL_RESPALDO_HECHO=true (una sola vez).", { codigo: "respaldo_mysql" });
          return "(respaldo de MySQL hecho con mysqldump por el administrador)";
        }
        const { carpeta } = await crearRespaldo({ Sqlite, sqlitePath: cfg.SQLITE_PATH, instanceDir: cfg.INSTANCE_DIR, respaldosDir: cfg.RESPALDOS_DIR, secretKey: process.env.SECRET_KEY || "", baseDir: cfg.BASE_DIR, incluirLlave: true, etiqueta: "pre-migracion" });
        return carpeta;
      },
      avisar: (mensaje) => console.log(`[migraciones] ${mensaje}`),
    });
    if (resultado.aplicadas.length || resultado.lineaBase !== null) console.log(`[migraciones] Base en la versión ${VERSION_ACTUAL}.`);
  } finally {
    await cerrar().catch(() => {});
  }
}
