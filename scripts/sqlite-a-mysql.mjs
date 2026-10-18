#!/usr/bin/env node
/*
 * Paso de SQLite a MySQL/MariaDB (Fase 12; ver README.md).
 *
 *   npm run sqlite-a-mysql -- --simular                       (solo revisa la base SQLite)
 *   npm run sqlite-a-mysql -- --destino mysql://usuario:clave@host:3306/ficotox --confirmar
 *
 * Requisitos: servidor detenido; la base SQLite al dia (npm run migrar) y con la
 * bitacora integra; la base MySQL de destino creada por el DBA y VACIA
 * (CREATE DATABASE ficotox CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci).
 *
 * 1. Revisa la base SQLite: version = la de la aplicacion, bitacora integra, conteos.
 * 2. Crea el esquema en MySQL con los mismos pasos de las migraciones (rama MySQL)
 *    y copia schema_migraciones tal cual (mismas versiones y checksums).
 * 3. Copia TODAS las tablas en orden de id, conservando ids; la bitacora se copia
 *    identica (mismos hashes: el sello no depende del motor).
 * 4. Verifica: conteos por tabla iguales, cadena de la bitacora integra en MySQL con
 *    la misma llave, AUTO_INCREMENT de la bitacora igual al de SQLite.
 * 5. Agrega una entrada "sistema" encadenada: base migrada de SQLite a MySQL.
 * La base SQLite no se toca (queda como respaldo). Despues: DATABASE_URL en .env.
 * No se probo contra un servidor MySQL en esta fase (no habia Docker): hazlo primero
 * en una base de prueba con una copia (npm run test:mysql y este script).
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import { COLUMNAS_AUDITORIA, construirRegistro, evaluarCadena, sellar } from "../src/lib/shared/audit-chain.mjs";
import { adaptadorMysql, adaptadorSqlite, crearControl, MIGRACIONES, versionDe, VERSION_ACTUAL } from "../src/lib/server/migraciones/motor.mjs";
import { ejecutarPasos } from "../src/lib/server/migraciones/pasos.mjs";
import { argumento, claveBitacora, entornoDe, servidorEncendido, Sqlite } from "./lib/operacion.mjs";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const simular = args.includes("--simular");
const entorno = entornoDe();
const salir = (m, c = 1) => {
  console.error(`❌ ${m}`);
  process.exit(c);
};
if (entorno.motor !== "sqlite" || !fs.existsSync(entorno.sqlitePath)) salir("Esta instalación no usa SQLite (o no existe la base).", 2);
if (servidorEncendido(entorno.instanceDir)) salir("El servidor está encendido: detenlo antes de pasar la base.", 2);
const clave = claveBitacora(entorno);
if (!clave) salir("No hay llave de la bitácora (SECRET_KEY o auditoria.key): sin ella no se puede verificar.", 2);

/* 1. Origen */
const origen = new Sqlite(entorno.sqlitePath, { readonly: true, fileMustExist: true });
const src = adaptadorSqlite(origen);
const version = await versionDe(src);
if (version !== VERSION_ACTUAL) salir(`La base SQLite está en la versión ${version ?? "sin versionar"}; la aplicación, en la ${VERSION_ACTUAL}. Corre npm run migrar primero.`, 2);
const tablas = origen.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => t.name);
const conteos = Object.fromEntries(tablas.map((t) => [t, Number(origen.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n)]));
const seqAuditoria = Number(origen.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'auditoria'").get()?.seq || 0);
const cadenaOrigen = evaluarCadena(origen.prepare("SELECT * FROM auditoria ORDER BY id").all(), clave, seqAuditoria, 2);
console.log(`Origen: ${entorno.sqlitePath} (versión ${version}; ${tablas.length} tablas; ${Object.values(conteos).reduce((a, b) => a + b, 0)} filas; bitácora ${cadenaOrigen.total} entradas, ${cadenaOrigen.ok ? "íntegra" : "NO íntegra"})`);
if (!cadenaOrigen.ok) salir("La bitácora de la base SQLite no está íntegra: no se pasa una base con la cadena rota.", 1);
if (simular) {
  for (const [t, n] of Object.entries(conteos)) console.log(`  ${t}: ${n}`);
  console.log("\nSimulación: la base SQLite está lista para pasar a MySQL. No se cambió nada.");
  process.exit(0);
}

/* 2. Destino */
const destinoUrl = argumento(args, "--destino");
if (!destinoUrl || !args.includes("--confirmar")) salir("Indica --destino mysql://usuario:clave@host:3306/base y --confirmar.", 2);
const u = new URL(destinoUrl.replace(/^mariadb:/, "mysql:"));
const mysql = require("mysql2/promise");
const conn = await mysql.createConnection({ host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.replace(/^\//, ""), charset: "utf8mb4", timezone: "Z" });
await conn.query("SET time_zone = '+00:00'");
const dst = adaptadorMysql(conn);
const [existentes] = await conn.query("SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()");
if (Number(existentes[0].n) > 0) salir("La base MySQL de destino no está vacía: créala nueva (no se mezcla con datos existentes).", 2);
try {
  for (const m of MIGRACIONES) await ejecutarPasos(dst, "mysql", m.pasos);
  // Tablas de control con la misma estructura que crea el motor de migraciones (la fila de bloqueo ya queda creada).
  await crearControl(dst);
  console.log("✅ Esquema creado en MySQL con los pasos de las migraciones");

  /* 3. Datos */
  const columnasDestino = async (t) => new Set((await dst.all("SELECT COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [t])).map((r) => r.c));
  for (const t of tablas) {
    if (t === "schema_migraciones_bloqueo") continue;
    const destinoCols = await columnasDestino(t);
    if (!destinoCols.size) salir(`La tabla ${t} no existe en MySQL (¿esquema distinto?).`);
    const cols = origen.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name).filter((c) => destinoCols.has(c));
    const lista = cols.map((c) => `\`${c}\``).join(", ");
    const marcas = cols.map(() => "?").join(", ");
    const tieneId = cols.includes("id");
    await conn.beginTransaction();
    let n = 0;
    for (const fila of origen.prepare(`SELECT * FROM "${t}"${tieneId ? " ORDER BY id" : ""}`).iterate()) {
      await conn.query(`INSERT INTO \`${t}\` (${lista}) VALUES (${marcas})`, cols.map((c) => fila[c]));
      n += 1;
    }
    await conn.commit();
    process.stdout.write(`  ${t}: ${n}\n`);
  }
  if (seqAuditoria) await conn.query(`ALTER TABLE auditoria AUTO_INCREMENT = ${seqAuditoria + 1}`);

  /* 4. Verificacion */
  const distintas = [];
  for (const t of tablas) {
    if (t === "schema_migraciones_bloqueo") continue;
    const n = Number((await dst.get(`SELECT COUNT(*) AS n FROM \`${t}\``)).n);
    if (n !== conteos[t]) distintas.push(`${t}: SQLite ${conteos[t]} / MySQL ${n}`);
  }
  const filas = await dst.all("SELECT * FROM auditoria ORDER BY id");
  const ultimo = Number((await dst.get("SELECT AUTO_INCREMENT - 1 AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auditoria'")).n);
  const triggers = Number((await dst.get("SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'auditoria'")).n);
  const cadena = evaluarCadena(filas, clave, ultimo, triggers);
  if (distintas.length || !cadena.ok) salir(`La verificación falló (la base SQLite no se tocó; descarta la base MySQL):\n- ${[...distintas, cadena.ok ? null : `bitácora: ${JSON.stringify(cadena)}`].filter(Boolean).join("\n- ")}`);

  /* 5. Constancia */
  const previo = filas.at(-1)?.hash || null;
  const registro = construirRegistro({ accion: "migrar", entidad: "esquema", entidadId: null, referencia: "SQLite → MySQL", motivo: "Base de datos pasada de SQLite a MySQL/MariaDB (npm run sqlite-a-mysql)", detalle: { origen: entorno.sqlitePath, version, filas: conteos, bitacora_entradas: filas.length } }, { sub: null, nombre: "sistema", email: null }, previo);
  await conn.query(`INSERT INTO auditoria (${COLUMNAS_AUDITORIA.join(", ")}) VALUES (${COLUMNAS_AUDITORIA.map(() => "?").join(", ")})`, COLUMNAS_AUDITORIA.map((c) => (c === "hash" ? sellar(registro, clave) : registro[c])));
  console.log(`\n✅ Base pasada a MySQL: ${Object.keys(conteos).length} tablas con los mismos conteos; bitácora íntegra (${filas.length + 1} entradas).`);
  console.log("Siguiente paso: DATABASE_URL en .env (y quitar SQLITE_PATH), arrancar y npm run verificar-instalacion. La base SQLite queda sin cambios como respaldo.");
} catch (error) {
  await conn.rollback().catch(() => {});
  salir(`${error.message}\nLa base SQLite no se tocó; descarta la base MySQL de destino y repite.`);
} finally {
  await conn.end().catch(() => {});
  origen.close();
}
