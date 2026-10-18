#!/usr/bin/env node
/*
 * Prepara el respaldo que se importa en el primer arranque de un hosting (Railway):
 *
 *   npm run preparar-importacion [-- --salida ~/Downloads/ficotox-respaldo.tar.gz]
 *
 * Hace un respaldo con la logica oficial (src/lib/shared/respaldo.mjs) SIN la llave de la
 * bitacora (la llave se configura aparte como SECRET_KEY), lo comprime en un .tar.gz e
 * imprime su SHA-256 (IMPORTAR_SHA256). No borra respaldos anteriores.
 * El .tar.gz contiene toda la base: no lo publiques ni lo subas al repositorio.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { crearRespaldo, resolverEntorno } from "../src/lib/shared/respaldo.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const i = args.indexOf("--salida");
const salida = path.resolve((i >= 0 && args[i + 1] ? args[i + 1] : path.join(os.homedir(), "Downloads", "ficotox-respaldo.tar.gz")).replace(/^~(?=$|\/)/, os.homedir()));

const entorno = resolverEntorno(root);
if (entorno.motor !== "sqlite") {
  console.error("Esta instalación usa MySQL/MariaDB: no aplica.");
  process.exit(2);
}
const Sqlite = createRequire(import.meta.url)("better-sqlite3");
try {
  const { id, carpeta, manifest } = await crearRespaldo({ Sqlite, sqlitePath: entorno.sqlitePath, instanceDir: entorno.instanceDir, respaldosDir: entorno.respaldosDir, secretKey: entorno.secretKey, baseDir: root, incluirLlave: false, etiqueta: "para importar en Railway" });
  const tar = spawnSync("tar", ["-czf", salida, "-C", path.dirname(carpeta), id], { encoding: "utf8" });
  if (tar.status !== 0) throw new Error(`tar falló: ${String(tar.stderr || "").trim()}`);
  fs.chmodSync(salida, 0o600);
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => fs.createReadStream(salida).on("data", (d) => hash.update(d)).on("end", resolve).on("error", reject));
  console.log(`Respaldo ${id}: base ${manifest.base.tamano} bytes (integrity_check ${manifest.base.integrity_check}), ${manifest.archivos.length} archivos, bitácora de ${manifest.bitacora.entradas} entradas.`);
  console.log("La llave de la bitácora NO va en el archivo: en Railway, SECRET_KEY debe ser la misma de tu .env local.");
  console.log(`\nArchivo:  ${salida}  (${Math.round(fs.statSync(salida).size / 1024)} KB)`);
  console.log(`SHA-256:  ${hash.digest("hex")}`);
  console.log("\nSúbelo a un lugar privado con liga de descarga (p. ej. Google Drive) y pon esa liga en IMPORTAR_URL y el SHA-256 en IMPORTAR_SHA256 (ver DEPLOY_RAILWAY.md).");
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
