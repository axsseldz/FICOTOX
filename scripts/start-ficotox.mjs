#!/usr/bin/env node
/*
 * Lanzador de FICOTOX (build standalone de Next.js).
 *
 * Pseudocodigo:
 * 1. Cargar variables de entorno desde FICOTOX_ENV_FILE o .env de la raiz.
 * 2. Resolver ruta de SQLite (SQLITE_PATH o instance/ficotox.sqlite3) y la
 *    carpeta de la instancia; abrir el registro (<instancia>/logs) ANTES de
 *    cualquier verificacion, para que todo error de arranque quede escrito.
 * 3. Verificar JWT_SECRET, que exista el build standalone y que no haya otro
 *    servidor vivo sobre la instancia (servidor.lock); copiar los recursos
 *    estaticos que Next.js no incluye en standalone.
 * 4. Comprobar que el puerto este libre (mensaje claro si no) y arrancar el
 *    servidor Node autocontenido en HOST:PORT; al arrancar aplica las
 *    migraciones pendientes (MIGRAR_AL_ARRANCAR).
 * 5. Fase 12: HTTPS si TLS_CERT y TLS_KEY estan definidos (scripts/https-lanzador.mjs);
 *    registros a <instancia>/logs con rotacion y sin datos sensibles (scripts/lib/registro.mjs).
 * 6. Fase 12: supervision. Si el servidor termina con error, se relanza con
 *    espera creciente (5 s, 10 s, ... hasta 60 s; se reinicia la cuenta tras 10
 *    minutos estable). No se relanza si salio con 78 (error de configuracion,
 *    migracion o instancia ocupada: repetirlo no lo arregla) ni si se detuvo con
 *    SIGTERM/SIGINT (Ctrl+C, detener el servicio); otra senal (SIGKILL por falta de
 *    memoria, SIGSEGV) cuenta como caida y se relanza.
 *    Para DETENER sin que se relance (sobre todo en Windows, donde terminar un
 *    proceso no es una senal sino una salida con codigo 1): `npm run detener`
 *    crea <instancia>/detener y termina al lanzador (pid en <instancia>/lanzador.lock)
 *    con todo su arbol; con ese archivo presente, ninguna salida se toma como caida.
 * 7. Abrir el navegador apuntando a la IP LAN si el host es 0.0.0.0
 *    (FICOTOX_OPEN_BROWSER=false como servicio).
 * Codigos de salida: 0 detenido; 1 error de arranque del lanzador; 78 fatal.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SALIDA_FATAL = 78;

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    const name = key.trim();
    const value = rest.join("=").trim().replace(/^["']|["']$/g, "");
    if (!(name in process.env)) process.env[name] = value;
  }
}

const configuredEnv = (process.env.FICOTOX_ENV_FILE || "").trim();
if (configuredEnv) {
  loadEnvFile(path.resolve(configuredEnv));
} else {
  loadEnvFile(path.join(rootDir, ".env"));
}

const truthy = (name, fallback = "false") => ["1", "true", "yes", "on"].includes(String(process.env[name] ?? fallback).trim().toLowerCase());

function resolveSqlitePath() {
  const configured = (process.env.SQLITE_PATH || "").trim();
  if (configured) return path.resolve(rootDir, configured);
  const datos = (process.env.FICOTOX_DATA_DIR || "").trim();
  return path.join(datos ? path.resolve(rootDir, datos) : rootDir, "instance", "ficotox.sqlite3");
}

if (!(process.env.DATABASE_URL || "").trim()) {
  const sqlitePath = resolveSqlitePath();
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  process.env.SQLITE_PATH = sqlitePath;
}
process.env.FICOTOX_BASE_DIR = rootDir;

// Registro del lanzador y del servidor (Fase 12), abierto antes de cualquier verificacion.
const { RegistroRotativo } = await import("./lib/registro.mjs");
const instanceDir = process.env.FICOTOX_INSTANCE_DIR ? path.resolve(rootDir, process.env.FICOTOX_INSTANCE_DIR) : process.env.SQLITE_PATH ? path.dirname(process.env.SQLITE_PATH) : path.join(rootDir, "instance");
const registro = new RegistroRotativo({ dir: process.env.LOG_DIR ? path.resolve(rootDir, process.env.LOG_DIR) : path.join(instanceDir, "logs"), maxMb: process.env.LOG_MAX_MB, retencionDias: process.env.LOG_RETENCION_DIAS });
const avisar = (linea, error = false) => {
  (error ? console.error : console.log)(linea);
  registro.escribir(linea);
};
const fallar = (mensaje, codigo = 1) => {
  avisar(mensaje, true);
  process.exit(codigo);
};

// Fase 2: en produccion no se arranca con un JWT_SECRET inseguro (el servidor tambien lo verifica).
{
  const { erroresSecretosProduccion } = await import("../src/lib/shared/secretos.mjs");
  const errores = erroresSecretosProduccion({ ...process.env, NODE_ENV: process.env.NODE_ENV || "production" });
  if (errores.length) fallar(`FICOTOX no arranca en produccion: ${errores.join("; ")}. Define un JWT_SECRET aleatorio de al menos 32 caracteres en .env (npm run configurar).`, SALIDA_FATAL);
}

// Hosting con volumen (Railway): importar un respaldo en el primer arranque, ANTES de iniciar el servidor
// (scripts/importar-respaldo-railway.mjs). Solo actua si no existe la base; si algo falla, no se arranca.
{
  const datos = (process.env.FICOTOX_DATA_DIR || "").trim() ? path.resolve(rootDir, process.env.FICOTOX_DATA_DIR) : path.dirname(instanceDir);
  const hayRespaldo = fs.existsSync(path.join((process.env.FICOTOX_IMPORT_DIR || "").trim() ? path.resolve(rootDir, process.env.FICOTOX_IMPORT_DIR) : path.join(datos, "import"), "ficotox-respaldo.tar.gz"));
  const enHosting = truthy("FICOTOX_IMPORTAR") || !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) || !!(process.env.IMPORTAR_URL || "").trim() || hayRespaldo;
  if (enHosting && !(process.env.DATABASE_URL || "").trim()) {
    const codigo = await new Promise((resolve) => {
      const proceso = spawn(process.execPath, [path.join(rootDir, "scripts", "importar-respaldo-railway.mjs")], { cwd: rootDir, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
      for (const [flujo, error] of [[proceso.stdout, false], [proceso.stderr, true]]) {
        let pendiente = "";
        flujo.on("data", (d) => {
          pendiente += d;
          const lineas = pendiente.split(/\r?\n/);
          pendiente = lineas.pop() || "";
          for (const linea of lineas) if (linea.trim()) avisar(linea, error);
        });
      }
      proceso.on("error", (e) => {
        avisar(`[importación] no se pudo ejecutar el importador (${e.message}).`, true);
        resolve(1);
      });
      proceso.on("exit", (c) => resolve(c ?? 1));
    });
    if (codigo !== 0) fallar("FICOTOX no arranca: la importación del respaldo falló (ver el motivo arriba).", SALIDA_FATAL);
  }
}

const standaloneDir = path.join(rootDir, ".next", "standalone");
const serverFile = path.join(standaloneDir, "server.js");
if (!fs.existsSync(serverFile)) fallar("FICOTOX no arranca: no existe el build de produccion. Ejecuta primero: npm run build", SALIDA_FATAL);

// Otro servidor vivo sobre la misma instancia (servidor.lock): no se arranca un segundo.
// Un bloqueo de antes del ultimo arranque del sistema es huerfano aunque su pid exista (src/lib/shared/bloqueo.mjs).
{
  const { bloqueoVivo } = await import("../src/lib/shared/bloqueo.mjs");
  const datos = bloqueoVivo(path.join(instanceDir, "servidor.lock"));
  if (datos) fallar(`FICOTOX no arranca: ya hay un servidor sobre esta instancia (pid ${datos.pid}${datos.puerto ? `, puerto ${datos.puerto}` : ""}). Si es el servicio, detenlo primero con npm run detener; si no hay ninguno, ver README.md, «Solución de problemas».`, SALIDA_FATAL);
}

// Un solo lanzador por instancia: lanzador.lock se toma de forma atomica ("wx") ANTES de tocar nada
// (copiar los estaticos, arrancar el servidor). Uno huerfano (proceso muerto o de antes del ultimo
// arranque del sistema) se reemplaza.
const archivoLanzador = path.join(instanceDir, "lanzador.lock");
{
  const { bloqueoVivo } = await import("../src/lib/shared/bloqueo.mjs");
  const contenido = JSON.stringify({ pid: process.pid, puerto: String(process.env.PORT || process.env.FLASK_PORT || "5000").trim(), iniciado_en: new Date().toISOString() });
  for (let intento = 0; ; intento += 1) {
    try {
      fs.mkdirSync(instanceDir, { recursive: true });
      fs.writeFileSync(archivoLanzador, contenido, { flag: "wx" });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") fallar(`FICOTOX no arranca: no se pudo escribir ${archivoLanzador} (${error.message}).`, SALIDA_FATAL);
      const otro = bloqueoVivo(archivoLanzador);
      if (otro || intento >= 1) fallar(`FICOTOX no arranca: ya hay un lanzador de FICOTOX sobre esta instancia (pid ${otro?.pid ?? "?"}). Si es el servicio, detenlo con npm run detener.`, SALIDA_FATAL);
      fs.rmSync(archivoLanzador, { force: true });
    }
  }
}
// Al salir (por cualquier causa, tambien un error de arranque posterior) se libera el bloqueo del lanzador.
process.once("exit", () => {
  try {
    if (JSON.parse(fs.readFileSync(archivoLanzador, "utf8")).pid === process.pid) fs.rmSync(archivoLanzador, { force: true });
  } catch {
    /* ya no existe */
  }
});

// Next.js no copia public/ ni .next/static al standalone: se sincronizan aqui.
const copyDir = (from, to) => {
  if (!fs.existsSync(from)) return;
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
};
try {
  copyDir(path.join(rootDir, "public"), path.join(standaloneDir, "public"));
  copyDir(path.join(rootDir, ".next", "static"), path.join(standaloneDir, ".next", "static"));
} catch (error) {
  fallar(`FICOTOX no arranca: no se pudieron preparar los archivos estáticos (${error.message}). Vuelve a intentar o corre npm run build.`, SALIDA_FATAL);
}

const host = (process.env.HOST || process.env.FLASK_HOST || "0.0.0.0").trim();
const port = String(process.env.PORT || process.env.FLASK_PORT || "5000").trim();

// Puerto libre (Fase 12): mensaje claro si otro programa lo usa o no hay permiso.
const puertoOcupado = () =>
  new Promise((resolve) => {
    const prueba = net.createServer();
    prueba.once("error", (error) => resolve(error));
    prueba.once("listening", () => prueba.close(() => resolve(null)));
    prueba.listen(Number(port), host);
  });
const motivoPuerto = (error) =>
  error.code === "EADDRINUSE"
    ? `el puerto ${port} ya está en uso en ${host} (¿FICOTOX ya está corriendo como servicio, u otro programa usa ese puerto?). Detén el otro proceso o cambia PORT en .env.`
    : error.code === "EACCES"
      ? `no hay permiso para usar el puerto ${port} en ${host} (los puertos menores a 1024 requieren privilegios). Usa un puerto mayor, p. ej. 5000.`
      : `no se pudo abrir ${host}:${port} (${error.code || error.message}).`;
{
  const ocupado = await puertoOcupado();
  if (ocupado) fallar(`FICOTOX no arranca: ${motivoPuerto(ocupado)}`, SALIDA_FATAL);
}

// HTTPS opcional (Fase 12).
const tlsCert = (process.env.TLS_CERT || "").trim();
const tlsKey = (process.env.TLS_KEY || "").trim();
if (Boolean(tlsCert) !== Boolean(tlsKey)) fallar("FICOTOX no arranca: para HTTPS define TLS_CERT y TLS_KEY juntos (o ninguno para HTTP).", SALIDA_FATAL);
const tlsCa = (process.env.TLS_CA || "").trim();
for (const archivo of [tlsCert, tlsKey, tlsCert ? tlsCa : ""].filter(Boolean)) {
  try {
    fs.accessSync(path.resolve(rootDir, archivo), fs.constants.R_OK);
  } catch {
    fallar(`FICOTOX no arranca: no se puede leer el archivo de TLS ${archivo}.`, SALIDA_FATAL);
  }
}
if (tlsCert) {
  process.env.TLS_CERT = path.resolve(rootDir, tlsCert);
  process.env.TLS_KEY = path.resolve(rootDir, tlsKey);
  if (tlsCa) process.env.TLS_CA = path.resolve(rootDir, tlsCa);
}
const esquema = tlsCert ? "https" : "http";

function detectLanIp() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return "127.0.0.1";
}

const browserHost = ["0.0.0.0", "::", ""].includes(host) ? detectLanIp() : host;
const url = `${esquema}://${browserHost}:${port}`;

// Sin proxy de confianza, la IP del bloqueo por IP es la del socket (scripts/ip-real.mjs).
const precargas = ["ip-real.mjs", ...(tlsCert ? ["https-lanzador.mjs"] : [])].flatMap((m) => ["--import", pathToFileURL(path.join(rootDir, "scripts", m)).href]);

/* ---------- Supervision del servidor ---------- */
// Senal de parada (la crea npm run detener) y pid del lanzador (para detenerlo a el, no solo al servidor).
const archivoDetener = path.join(instanceDir, "detener");
fs.rmSync(archivoDetener, { force: true });
process.once("exit", () => {
  if (deteniendo) fs.rmSync(archivoDetener, { force: true });
});
const pidieronDetener = () => fs.existsSync(archivoDetener);
let hijo = null;
let deteniendo = false;
let fallos = 0;
let navegadorAbierto = false;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function anunciarCuandoResponda(proceso) {
  const { esperarSalud } = await import("./lib/operacion.mjs");
  const salud = await esperarSalud({ ...process.env, PORT: port }, 600);
  if (!salud.ok || hijo !== proceso) return;
  avisar(`FICOTOX escuchando en ${esquema}://${host}:${port}${esquema === "http" ? " (HTTP sin cifrar: ver HTTPS en README.md)" : ""}`);
  if (!navegadorAbierto && truthy("FICOTOX_OPEN_BROWSER", process.env.FLASK_OPEN_BROWSER ?? "true")) {
    navegadorAbierto = true;
    const command = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
    spawn(command[0], command[1], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  }
}

function arrancarServidor() {
  const inicio = Date.now();
  const proceso = spawn(process.execPath, [...precargas, serverFile], {
    cwd: standaloneDir,
    env: { ...process.env, HOSTNAME: host, PORT: port, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  hijo = proceso;
  // Salida del servidor: a la consola y al archivo de registro (enmascarada).
  for (const [flujo, error] of [[proceso.stdout, false], [proceso.stderr, true]]) {
    let pendiente = "";
    flujo.on("data", (d) => {
      pendiente += d;
      const lineas = pendiente.split(/\r?\n/);
      pendiente = lineas.pop() || "";
      for (const original of lineas) {
        if (!original.trim()) continue;
        // Con HTTPS, las direcciones que imprime Next ("- Local: http://...") se corrigen a https para no confundir.
        const linea = esquema === "https" ? original.replace(/^(\s*- (?:Local|Network):\s*)http:\/\//, "$1https://") : original;
        avisar(linea, error);
        // "Ready" de Next llega antes de terminar la verificacion de arranque (migraciones): "escuchando" se
        // anuncia cuando /api/health/db ya responde, es decir, cuando de verdad se atienden peticiones.
        if (/\bReady\b/.test(linea)) anunciarCuandoResponda(proceso);
      }
    });
  }
  proceso.on("exit", async (code, signal) => {
    hijo = null;
    if (!deteniendo && pidieronDetener()) deteniendo = true;
    if (deteniendo) {
      avisar("FICOTOX se detuvo.");
      process.exit(0);
    }
    // Next atiende SIGTERM/SIGINT y sale con 143/130 (128 + senal).
    if (signal === "SIGTERM" || signal === "SIGINT" || code === 143 || code === 130) {
      // Le pidieron detenerse (detener el servicio, npm run actualizar, Ctrl+C): no se relanza.
      avisar(`FICOTOX se detuvo (${signal || (code === 130 ? "SIGINT" : "SIGTERM")}).`);
      process.exit(0);
    }
    if (code === 0) {
      avisar("FICOTOX se detuvo.");
      process.exit(0);
    }
    if (code === SALIDA_FATAL) {
      avisar(`FICOTOX se detuvo por un error de arranque (código ${code}); revisa el mensaje anterior. No se reintenta.`, true);
      process.exit(SALIDA_FATAL);
    }
    // Caida: relanzar con espera creciente. Si estuvo estable 10 minutos, se reinicia la cuenta.
    if (Date.now() - inicio > 10 * 60_000) fallos = 0;
    fallos += 1;
    const espera = Math.min(5_000 * 2 ** (fallos - 1), 60_000);
    avisar(`FICOTOX se detuvo inesperadamente (${signal ? `señal ${signal}` : `código ${code}`}); se reinicia en ${Math.round(espera / 1000)} s (intento ${fallos}).`, true);
    await esperar(espera);
    if (deteniendo || pidieronDetener()) {
      deteniendo = true;
      avisar("FICOTOX se detuvo (se pidió detenerlo durante la espera).");
      process.exit(0);
    }
    const ocupado = await puertoOcupado();
    if (ocupado) {
      avisar(`No se pudo reiniciar: ${motivoPuerto(ocupado)}`, true);
      process.exit(1);
    }
    arrancarServidor();
  });
}

// Detener el lanzador (Ctrl+C, detener el servicio) detiene al servidor (y libera servidor.lock).
for (const senal of ["SIGINT", "SIGTERM"]) {
  process.on(senal, () => {
    deteniendo = true;
    if (hijo) hijo.kill(senal);
    else process.exit(0);
  });
}

avisar(`FICOTOX arrancando en ${esquema}://${host}:${port} (instancia ${instanceDir})`);
arrancarServidor();
