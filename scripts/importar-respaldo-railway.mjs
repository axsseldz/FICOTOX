#!/usr/bin/env node
/*
 * Importa un respaldo de FICOTOX en el PRIMER arranque de un hosting con volumen
 * (Railway). Lo ejecuta el lanzador (scripts/start-ficotox.mjs) ANTES de iniciar
 * el servidor; tambien se puede correr a mano:  node scripts/importar-respaldo-railway.mjs
 *
 * Reglas:
 * - Solo actua si NO existe la base (SQLITE_PATH). Si existe, ignora todo, incluida IMPORTAR_URL.
 * - Respaldo: <datos>/import/ficotox-respaldo.tar.gz o, si no esta, se descarga de IMPORTAR_URL
 *   (liga directa; acepta ligas de Google Drive, incluida la pagina de confirmacion de archivos grandes).
 * - IMPORTAR_SHA256 es obligatoria y debe coincidir con el SHA-256 del archivo; si no, aborta.
 * - Restaura con scripts/restaurar-ficotox.mjs en modo real (manifest y hashes, integrity_check, esquema,
 *   cadena de la bitacora con SECRET_KEY, conteos y archivos). La llave NO viaja en el respaldo: se usa SECRET_KEY.
 * - Si algo falla, deja la instancia sin base (para reintentar), escribe el motivo y sale con codigo 78
 *   (el lanzador NO arranca el servidor).
 * - Al terminar bien, mueve el archivo a <datos>/import/aplicado-<fecha>/.
 * - Sin base ni respaldo: migraciones + roles (sin usuarios) y aviso en el registro.
 * <datos> = FICOTOX_DATA_DIR o la carpeta que contiene a la instancia (p. ej. /data).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { evaluarCadena } from "../src/lib/shared/audit-chain.mjs";
import { CARPETAS_ARCHIVOS, resolverEntorno } from "../src/lib/shared/respaldo.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const SALIDA_FATAL = 78;
const NOMBRE_ARCHIVO = "ficotox-respaldo.tar.gz";

const log = (linea) => console.log(`[importación] ${linea}`);
class ErrorImportacion extends Error {}
const abortar = (motivo) => {
  throw new ErrorImportacion(motivo);
};

const entorno = resolverEntorno(root);
const env = process.env;
const instanceDir = entorno.instanceDir;
const dataDir = (env.FICOTOX_DATA_DIR || "").trim() ? path.resolve(root, env.FICOTOX_DATA_DIR) : path.dirname(instanceDir);
const importDir = (env.FICOTOX_IMPORT_DIR || "").trim() ? path.resolve(root, env.FICOTOX_IMPORT_DIR) : path.join(dataDir, "import");
const archivo = path.join(importDir, NOMBRE_ARCHIVO);
const secretKey = String(env.SECRET_KEY || "").trim();
const sinSecreto = !secretKey || secretKey === "ficotox-dev-secret";

const ejecutar = (script, args) => {
  const r = spawnSync(process.execPath, [path.join(root, "scripts", script), ...args], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  for (const linea of `${r.stdout || ""}${r.stderr || ""}`.split(/\r?\n/)) if (linea.trim()) log(`  ${linea}`);
  return r.status ?? 1;
};

/* ---------- SHA-256 ---------- */

const sha256 = (ruta) =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    fs.createReadStream(ruta).on("data", (d) => hash.update(d)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
  });

/* ---------- Descarga (liga directa o Google Drive) ---------- */

function idDeDrive(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)(drive|docs)\.google\.com$|(^|\.)drive\.usercontent\.google\.com$/.test(u.hostname)) return null;
  const m = /\/file\/d\/([^/]+)/.exec(u.pathname);
  return m ? m[1] : u.searchParams.get("id");
}

const entidades = (t) => t.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function descargar(url, destino) {
  const idDrive = idDeDrive(url);
  let actual = idDrive ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(idDrive)}` : url;
  log(`Descargando el respaldo${idDrive ? " (Google Drive)" : ""}…`);
  const cookies = new Map();
  const cabeceras = () => (cookies.size ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {});
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const parcial = `${destino}.parcial`;
  for (let salto = 0; salto < 6; salto += 1) {
    const res = await fetch(actual, { redirect: "follow", headers: cabeceras(), signal: AbortSignal.timeout(45 * 60_000) });
    for (const c of res.headers.getSetCookie?.() || []) {
      const [par] = c.split(";");
      const i = par.indexOf("=");
      if (i > 0) cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
    if (!res.ok) abortar(`la descarga respondió HTTP ${res.status}. Revisa que IMPORTAR_URL sea una liga pública de descarga directa.`);
    const tipo = String(res.headers.get("content-type") || "").toLowerCase();
    if (tipo.includes("text/html")) {
      // Pagina de confirmacion de Google Drive (archivos grandes o sin escaneo de virus).
      const html = await res.text();
      if (!idDrive) abortar("la liga devolvió una página web en lugar del archivo (¿no es una descarga directa?).");
      const form = /<form[^>]*action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/i.exec(html);
      if (form) {
        const accion = new URL(entidades(form[1]), actual);
        for (const m of form[2].matchAll(/<input[^>]*type="hidden"[^>]*>/gi)) {
          const nombre = /name="([^"]*)"/.exec(m[0])?.[1];
          const valor = /value="([^"]*)"/.exec(m[0])?.[1];
          if (nombre) accion.searchParams.set(entidades(nombre), entidades(valor ?? ""));
        }
        actual = accion.toString();
        continue;
      }
      const confirmar = /confirm=([0-9A-Za-z_-]+)/.exec(html)?.[1] || "t";
      const siguiente = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(idDrive)}&export=download&confirm=${confirmar}`;
      if (siguiente === actual) abortar("Google Drive no entregó el archivo: revisa que la liga sea pública («cualquier persona con el vínculo»).");
      actual = siguiente;
      continue;
    }
    const total = Number(res.headers.get("content-length")) || 0;
    let recibido = 0;
    let siguienteAviso = 25 * 1024 * 1024;
    const origen = Readable.fromWeb(res.body);
    origen.on("data", (d) => {
      recibido += d.length;
      if (recibido >= siguienteAviso) {
        log(`  …${Math.round(recibido / 1048576)} MB${total ? ` de ${Math.round(total / 1048576)} MB` : ""}`);
        siguienteAviso += 25 * 1024 * 1024;
      }
    });
    await pipeline(origen, fs.createWriteStream(parcial));
    fs.renameSync(parcial, destino);
    log(`Descarga completa (${Math.round(recibido / 1024)} KB).`);
    return;
  }
  abortar("demasiados saltos al descargar (Google Drive no entregó el archivo).");
}

const esGzip = (ruta) => {
  const fd = fs.openSync(ruta, "r");
  try {
    const b = Buffer.alloc(2);
    fs.readSync(fd, b, 0, 2, 0);
    return b[0] === 0x1f && b[1] === 0x8b;
  } finally {
    fs.closeSync(fd);
  }
};

/* ---------- Extraccion segura ---------- */

function extraer(tgz, destino) {
  const lista = spawnSync("tar", ["-tzf", tgz], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (lista.status !== 0) abortar(`no se pudo leer el .tar.gz (${String(lista.stderr || "").trim().split("\n")[0] || "tar falló"}).`);
  for (const entrada of lista.stdout.split("\n").filter(Boolean)) {
    if (path.isAbsolute(entrada) || entrada.split("/").includes("..")) abortar(`el .tar.gz trae una ruta no permitida: ${entrada}`);
  }
  fs.mkdirSync(destino, { recursive: true });
  const r = spawnSync("tar", ["-xzf", tgz, "-C", destino, "--no-same-owner"], { encoding: "utf8" });
  if (r.status !== 0) abortar(`no se pudo extraer el .tar.gz (${String(r.stderr || "").trim().split("\n")[0]}).`);
  const directo = fs.existsSync(path.join(destino, "manifest.json")) ? destino : null;
  const hijo = fs.readdirSync(destino, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(destino, e.name)).find((d) => fs.existsSync(path.join(d, "manifest.json")));
  const carpeta = directo || hijo;
  if (!carpeta) abortar("el .tar.gz no contiene un respaldo de FICOTOX (falta manifest.json).");
  return carpeta;
}

/* ---------- Sin respaldo: base vacia ---------- */

function arrancarVacio() {
  log("AVISO: no hay base ni respaldo (/data/import/ficotox-respaldo.tar.gz o IMPORTAR_URL). Se arranca con una base VACÍA: migraciones + roles, sin usuarios.");
  if (sinSecreto) log("AVISO: SECRET_KEY no está definida; la llave de la bitácora se generará en la instancia (define SECRET_KEY antes de usar la plataforma).");
  if (ejecutar("migrar-ficotox.mjs", []) !== 0) abortar("no se pudieron aplicar las migraciones a la base vacía.");
  const vacio = path.join(importDir, ".usuarios-vacio.json");
  fs.mkdirSync(importDir, { recursive: true });
  fs.writeFileSync(vacio, JSON.stringify({ usuarios: [] }));
  const codigo = ejecutar("seed-roles-usuarios.mjs", ["--usuarios", vacio, "--motivo", "Base vacía de un hosting"]);
  fs.rmSync(vacio, { force: true });
  if (codigo !== 0) abortar("no se pudieron sembrar los roles en la base vacía.");
  log("Base vacía lista (sin usuarios): restaura un respaldo o da de alta a la primera persona con npm run instancia-nueva.");
}

/* ---------- Principal ---------- */

function limpiarFallo() {
  for (const sufijo of ["", "-wal", "-shm", "-journal"]) fs.rmSync(`${entorno.sqlitePath}${sufijo}`, { force: true });
  for (const carpeta of CARPETAS_ARCHIVOS) fs.rmSync(path.join(instanceDir, carpeta), { recursive: true, force: true });
  fs.rmSync(path.join(path.dirname(instanceDir), "instance-restaurada"), { recursive: true, force: true });
}

async function principal() {
  if (entorno.motor !== "sqlite") return log("Esta instalación usa MySQL/MariaDB: la importación no aplica.");
  if (fs.existsSync(entorno.sqlitePath)) {
    if ((env.IMPORTAR_URL || "").trim() || fs.existsSync(archivo)) log("La base ya existe: se ignora IMPORTAR_URL y cualquier respaldo en el volumen. (Quita IMPORTAR_URL de las variables.)");
    return;
  }
  const url = (env.IMPORTAR_URL || "").trim();
  if (!fs.existsSync(archivo) && !url) return arrancarVacio();

  if (!fs.existsSync(archivo)) {
    try {
      await descargar(url, archivo);
    } catch (error) {
      fs.rmSync(`${archivo}.parcial`, { force: true });
      if (error instanceof ErrorImportacion) throw error;
      abortar(`no se pudo descargar el respaldo (${error.cause?.code || error.message}).`);
    }
  } else log(`Respaldo encontrado en ${archivo}.`);

  if (!esGzip(archivo)) {
    fs.rmSync(archivo, { force: true });
    abortar("lo descargado no es un archivo .tar.gz (¿la liga no es pública o es una página web?). Se borró y se reintentará en el próximo arranque.");
  }
  const esperado = (env.IMPORTAR_SHA256 || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(esperado)) abortar("define IMPORTAR_SHA256 con el SHA-256 (64 caracteres hexadecimales) que imprimió npm run preparar-importacion.");
  const real = await sha256(archivo);
  if (real !== esperado) abortar(`el SHA-256 del respaldo (${real.slice(0, 16)}…) no coincide con IMPORTAR_SHA256 (${esperado.slice(0, 16)}…). No se restaura nada.`);
  log(`SHA-256 verificado (${real.slice(0, 16)}…).`);
  if (sinSecreto) abortar("SECRET_KEY no está definida (o es la de desarrollo): hace falta la MISMA llave con que se selló la bitácora del respaldo para verificarla.");

  const sello = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const temporal = path.join(importDir, `extraido-${sello}`);
  // La llave se pasa a la restauración por un archivo temporal PRIVADO en el disco efímero del contenedor (nunca en el volumen).
  const carpetaLlave = fs.mkdtempSync(path.join(os.tmpdir(), "ficotox-llave-"));
  fs.chmodSync(carpetaLlave, 0o700);
  const llaveTemporal = path.join(carpetaLlave, "llave");
  try {
    const carpeta = extraer(archivo, temporal);
    fs.writeFileSync(llaveTemporal, `${secretKey}\n`, { mode: 0o600 });
    log("Restaurando con las mismas verificaciones de «npm run restaurar» (manifest, hashes, integrity_check, esquema, llave, cadena de la bitácora, conteos y archivos)…");
    const codigo = ejecutar("restaurar-ficotox.mjs", ["--respaldo", carpeta, "--destino", "instance", "--confirmar", "--llave", llaveTemporal, "--responsable", "importacion-railway"]);
    if (codigo !== 0) abortar(`la restauración falló (código ${codigo}); el motivo está en las líneas anteriores.`);

    // Comprobacion final con la llave de este entorno.
    const Sqlite = require("better-sqlite3");
    const db = new Sqlite(entorno.sqlitePath, { readonly: true, fileMustExist: true });
    let n;
    try {
      const cuenta = (t) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);
      const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'auditoria'").get();
      const triggers = Number(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'auditoria' AND name IN ('auditoria_sin_update', 'auditoria_sin_delete')").get().n);
      const v = evaluarCadena(db.prepare("SELECT * FROM auditoria ORDER BY id ASC").all(), secretKey, seq ? Number(seq.seq) : null, triggers);
      if (!v.ok) abortar("la cadena de la bitácora NO es íntegra con la SECRET_KEY de este entorno (¿es la misma llave del respaldo?).");
      n = { reactivos: cuenta("reactivos"), consumibles: cuenta("consumibles"), usuarios: cuenta("usuarios") };
    } finally {
      db.close();
    }
    const aplicado = path.join(importDir, `aplicado-${sello}`);
    fs.mkdirSync(aplicado, { recursive: true });
    fs.renameSync(archivo, path.join(aplicado, NOMBRE_ARCHIVO));
    fs.writeFileSync(path.join(aplicado, "sha256.txt"), `${real}  ${NOMBRE_ARCHIVO}\n`);
    log(`Restauración completada: ${n.reactivos} reactivos, ${n.consumibles} consumibles, ${n.usuarios} usuarios, bitácora íntegra.`);
    log(`El archivo quedó en ${aplicado}. Quita IMPORTAR_URL de las variables.`);
  } catch (error) {
    limpiarFallo();
    throw error;
  } finally {
    fs.rmSync(temporal, { recursive: true, force: true });
    fs.rmSync(carpetaLlave, { recursive: true, force: true });
    fs.rmSync(path.join(path.dirname(instanceDir), "instance-restaurada"), { recursive: true, force: true });
  }
}

try {
  await principal();
} catch (error) {
  log(`ERROR: ${error instanceof ErrorImportacion ? error.message : `inesperado: ${error?.stack || error}`}`);
  log("FICOTOX NO arranca: corrige el problema y reinicia. La base no se creó.");
  process.exit(SALIDA_FATAL);
}
