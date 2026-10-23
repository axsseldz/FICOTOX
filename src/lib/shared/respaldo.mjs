/*
 * Respaldo de FICOTOX (Fase 10). Unica implementacion, compartida por el
 * servidor (Administracion > Respaldos, "Crear respaldo ahora"), el script de
 * terminal (scripts/respaldar-ficotox.mjs, que invoca tambien
 * scripts/backup_ficotox.py) y el script de restauracion
 * (scripts/restaurar-ficotox.mjs). Es JavaScript plano (.mjs), como
 * audit-chain.mjs, para que Node lo importe sin compilar; los tipos estan en
 * respaldo.d.mts. Solo para servidor y scripts (usa node:fs y better-sqlite3).
 *
 * Cada respaldo es una carpeta <respaldos>/<AAAAMMDD-HHMMSS>/ con:
 *   datos/ficotox.sqlite3   snapshot consistente con la API de respaldo en linea
 *                           de SQLite (funciona con el servidor encendido y con WAL)
 *   archivos/<carpeta>/...  informes (PDF y evidencias de envio), evidencias,
 *                           documentos_sgc (flujo anterior, solo lectura),
 *                           biblioteca, maintenance_reports y calidad
 *   manifest.json           fecha, host, version (commit), motor, conteos por
 *                           tabla, bitacora (entradas, ultimo id y sello),
 *                           archivos con tamano y SHA-256, huella de la llave
 *   llave/llave-bitacora.txt  (separada; solo en el respaldo local) la llave del
 *                           sello de la bitacora. Nunca JWT_SECRET, SMTP ni otros secretos.
 * MySQL/MariaDB: se respalda con mysqldump (scripts/backup_ficotox.py y
 * CLAUDE.md); esta implementacion es solo para SQLite.
 */
import { VERSION_ACTUAL } from "../server/migraciones/motor.mjs";
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { leerClaveSello, stableJson } from "./audit-chain.mjs";

/*
 * Fase 12: version del esquema = la de la ultima migracion (src/lib/server/migraciones).
 * Las versiones de las migraciones empiezan en 9 para coincidir con los respaldos
 * anteriores (ESQUEMA_VERSION 10 = Fase 10, 11 = Fase 11), que se siguen restaurando.
 */
export const ESQUEMA_VERSION = VERSION_ACTUAL;
export const FORMATO = "ficotox-respaldo";
export const VERSION_FORMATO = 1;

/* Tablas cuyo numero de filas se registra (y se compara al restaurar). */
export const TABLAS_PRINCIPALES = [
  "usuarios",
  "roles",
  "rol_acciones",
  "usuario_roles",
  "autorizaciones_personal",
  "asignaciones_muestra",
  "solicitudes_autorizacion",
  "muestras_recepcion",
  "muestras_procesamiento",
  "muestras_extraccion",
  "muestras_analisis",
  "adjuntos",
  "incidencias",
  "no_conformidades",
  "acciones_correctivas",
  "suspensiones",
  "retenciones_informe",
  "informes",
  "envios_informe",
  "documentos_sgc",
  "biblioteca_documentos",
  "biblioteca_versiones",
  "sgc_documentos",
  "sgc_revisiones",
  "sgc_archivos",
  // Documentos SGC (fases 2 y 3): flujo, solicitudes, renovaciones, externos, distribucion y lecturas.
  "sgc_areas",
  "sgc_tipos",
  "sgc_flujo_acciones",
  "sgc_solicitudes",
  "sgc_renovaciones",
  "sgc_externos",
  "sgc_distribucion",
  "sgc_lecturas",
  "reactivos",
  "consumibles",
  "equipos",
  "mantenimientos",
  "movimientos",
  "auditoria",
];

/* Carpetas de la instancia con archivos que se respaldan. */
// Fase 11: "calidad" (PDF "Registro de no conformidad"). Biblioteca: "biblioteca" (versiones de los documentos).
// Fotos de perfil: "avatares" (opcional; si no hay fotos, la carpeta no existe y no pasa nada).
// Documentos SGC (migracion 22): "sgc" (archivos fuente y PDF de consulta de cada revision).
export const CARPETAS_ARCHIVOS = ["informes", "evidencias", "documentos_sgc", "biblioteca", "sgc", "maintenance_reports", "calidad", "avatares"];

export const ARCHIVO_LLAVE = path.join(/*turbopackIgnore: true*/ "llave", "llave-bitacora.txt");
export const CARPETA_ACTAS = "pruebas-restauracion";
/*
 * Respaldos portables: un respaldo traido de otra computadora (archivo .ficotox)
 * lleva junto a su manifest un importado.json (fuera del manifest y de su sello)
 * con quien lo importo y cuando. Mientras se verifica dice estado "verificando" y
 * no aparece en la lista; la retencion nunca borra uno importado.
 */
export const ARCHIVO_IMPORTADO = "importado.json";
const ID_RE = /^\d{8}-\d{6}(-\d+)?$/;

/* ---------- Entorno (misma resolucion que src/lib/server/config.ts) ---------- */

function cargarArchivoEnv(archivo, env) {
  let contenido;
  try {
    contenido = fs.readFileSync(archivo, "utf8");
  } catch {
    return;
  }
  for (const linea of contenido.split(/\r?\n/)) {
    const l = linea.trim();
    if (!l || l.startsWith("#") || !l.includes("=")) continue;
    const [clave, ...resto] = l.split("=");
    const nombre = clave.trim().replace(/^export\s+/, "");
    const valor = resto.join("=").trim().replace(/^(["'])(.*)\1$/, "$2");
    if (nombre && !(nombre in env)) env[nombre] = valor;
  }
}

/* Archivo .env que leen el servidor y los scripts: FICOTOX_ENV_FILE o <raiz>/.env. */
export function archivoEnv(baseDir, env = process.env) {
  const configurado = String(env.FICOTOX_ENV_FILE || "").trim();
  return configurado ? path.resolve(/*turbopackIgnore: true*/ baseDir, configurado) : path.join(/*turbopackIgnore: true*/ baseDir, ".env");
}

/*
 * Rutas y variables como las ve el servidor: .env (o FICOTOX_ENV_FILE) sin
 * pisar lo ya definido, SQLITE_PATH, FICOTOX_INSTANCE_DIR y FICOTOX_BACKUP_DIR.
 */
export function resolverEntorno(baseDir, env = process.env) {
  cargarArchivoEnv(archivoEnv(baseDir, env), env);
  const databaseUrl = String(env.DATABASE_URL || "").trim();
  const motor = databaseUrl && !databaseUrl.startsWith("sqlite:") ? "mysql" : "sqlite";
  let sqlitePath = null;
  if (motor === "sqlite") {
    if (databaseUrl.startsWith("sqlite:")) {
      const raw = databaseUrl.replace(/^sqlite:\/*/, "");
      sqlitePath = path.isAbsolute(raw) ? raw : path.resolve(/*turbopackIgnore: true*/ baseDir, raw);
    } else {
      const datos = String(env.FICOTOX_DATA_DIR || "").trim();
      sqlitePath = String(env.SQLITE_PATH || "").trim() ? path.resolve(/*turbopackIgnore: true*/ baseDir, String(env.SQLITE_PATH).trim()) : path.join(/*turbopackIgnore: true*/ datos ? path.resolve(baseDir, datos) : baseDir, "instance", "ficotox.sqlite3");
    }
  }
  const instanceDir = env.FICOTOX_INSTANCE_DIR ? path.resolve(/*turbopackIgnore: true*/ baseDir, env.FICOTOX_INSTANCE_DIR) : sqlitePath ? path.dirname(sqlitePath) : path.join(/*turbopackIgnore: true*/ baseDir, "instance");
  const entero = (nombre, porOmision) => {
    const n = Number.parseInt(String(env[nombre] || ""), 10);
    return Number.isFinite(n) && n > 0 ? n : porOmision;
  };
  return {
    baseDir,
    motor,
    sqlitePath,
    instanceDir,
    respaldosDir: env.FICOTOX_BACKUP_DIR ? path.resolve(/*turbopackIgnore: true*/ baseDir, env.FICOTOX_BACKUP_DIR) : path.join(/*turbopackIgnore: true*/ String(env.FICOTOX_DATA_DIR || "").trim() ? path.resolve(baseDir, String(env.FICOTOX_DATA_DIR).trim()) : baseDir, "backups"),
    secretKey: env.SECRET_KEY || "",
    retencion: entero("RESPALDO_RETENCION", 30),
    puerto: entero("PORT", entero("FLASK_PORT", 5000)),
  };
}

/* ---------- Utilidades ---------- */

export async function sha256Archivo(ruta) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    fs.createReadStream(ruta).on("data", (trozo) => hash.update(trozo)).on("end", resolve).on("error", reject);
  });
  return hash.digest("hex");
}

export const huellaLlave = (clave) => createHash("sha256").update(String(clave)).digest("hex");

/*
 * Sello del manifest: HMAC-SHA256 con la llave de la bitacora sobre el
 * manifest sin su campo `sello`. Quien altere la base o los archivos de un
 * respaldo y recalcule las huellas no puede recalcular el sello sin la llave.
 */
export const sellarManifest = (manifest, clave) => {
  const { sello: _sello, ...resto } = manifest;
  void _sello;
  return createHmac("sha256", String(clave)).update(stableJson(resto)).digest("hex");
};

/* Huella del manifest.json tal como esta en disco (para ligar un acta a ese respaldo exacto). */
export const huellaManifest = (carpeta) => createHash("sha256").update(fs.readFileSync(path.join(/*turbopackIgnore: true*/ carpeta, "manifest.json"))).digest("hex");

/* Rutas que un manifest puede declarar: la base y archivos dentro de las carpetas respaldadas, sin "..", "." ni segmentos vacios. */
export const RUTA_BASE = "datos/ficotox.sqlite3";
/* Carpeta de las copias de "Probar restauracion": junto a la carpeta de la instancia (en una instalacion normal, en la raiz del proyecto). La usan el script y el servidor. */
export const carpetaRestauradas = (instanceDir) => path.join(/*turbopackIgnore: true*/ path.dirname(path.resolve(/*turbopackIgnore: true*/ instanceDir)), "instance-restaurada");
export function rutaArchivoValida(ruta) {
  if (typeof ruta !== "string" || !ruta || ruta.includes("\\") || ruta.includes("\0") || path.isAbsolute(ruta)) return false;
  const partes = ruta.split("/");
  if (partes.some((p) => !p || p === "." || p === "..")) return false;
  return partes.length >= 3 && partes[0] === "archivos" && CARPETAS_ARCHIVOS.includes(partes[1]);
}

/* Archivos de una carpeta (rutas relativas con "/"), sin temporales de escritura (.*.tmp). */
function listarArchivos(raiz) {
  const out = [];
  const recorrer = (dir) => {
    let entradas = [];
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      const ruta = path.join(/*turbopackIgnore: true*/ dir, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (e.isFile() && !(e.name.startsWith(".") && e.name.endsWith(".tmp"))) out.push(path.relative(raiz, ruta).split(path.sep).join("/"));
    }
  };
  recorrer(raiz);
  return out.sort();
}

/* Version de la app: package.json y commit (leido de .git sin ejecutar git). */
export function versionApp(baseDir) {
  let version = null;
  let commit = null;
  try {
    version = JSON.parse(fs.readFileSync(path.join(/*turbopackIgnore: true*/ baseDir, "package.json"), "utf8")).version || null;
  } catch {
    version = null;
  }
  try {
    const head = fs.readFileSync(path.join(/*turbopackIgnore: true*/ baseDir, ".git", "HEAD"), "utf8").trim();
    if (/^[0-9a-f]{40}$/.test(head)) commit = head;
    else if (head.startsWith("ref: ")) {
      const ref = head.slice(5);
      try {
        commit = fs.readFileSync(path.join(/*turbopackIgnore: true*/ baseDir, ".git", ref), "utf8").trim();
      } catch {
        const packed = fs.readFileSync(path.join(/*turbopackIgnore: true*/ baseDir, ".git", "packed-refs"), "utf8");
        commit = packed.split("\n").find((l) => l.endsWith(` ${ref}`))?.split(" ")[0] || null;
      }
    }
  } catch {
    commit = null;
  }
  return { version, commit: commit || process.env.FICOTOX_COMMIT || null };
}

/* Conteos por tabla y resumen de la bitacora de una base SQLite. */
export function inspeccionarBase(db) {
  const existentes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
  const conteos = {};
  for (const tabla of TABLAS_PRINCIPALES) if (existentes.has(tabla)) conteos[tabla] = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get().n);
  let bitacora = { entradas: 0, ultimo_id: null, ultimo_hash: null };
  if (existentes.has("auditoria")) {
    const ultima = db.prepare("SELECT id, hash FROM auditoria ORDER BY id DESC LIMIT 1").get();
    bitacora = { entradas: conteos.auditoria ?? 0, ultimo_id: ultima ? Number(ultima.id) : null, ultimo_hash: ultima ? String(ultima.hash) : null };
  }
  return { conteos, bitacora };
}

/*
 * Reserva el id del respaldo de forma atomica (Fase 12): crea la carpeta temporal
 * `.<id>.tmp` SIN `recursive` (falla con EEXIST si otro proceso la creo en el mismo
 * segundo) y comprueba despues que no exista ya el respaldo final; si choca, prueba
 * `<id>-2`, `<id>-3`... Asi dos respaldos simultaneos (el diario, "Crear respaldo
 * ahora" o dos arranques que migran) nunca comparten carpeta.
 */
function reservarId(respaldosDir, ahora) {
  const p = (n) => String(n).padStart(2, "0");
  const base = `${ahora.getFullYear()}${p(ahora.getMonth() + 1)}${p(ahora.getDate())}-${p(ahora.getHours())}${p(ahora.getMinutes())}${p(ahora.getSeconds())}`;
  for (let n = 1; n < 1000; n += 1) {
    const id = n === 1 ? base : `${base}-${n}`;
    const tmp = path.join(/*turbopackIgnore: true*/ respaldosDir, `.${id}.tmp`);
    const final = path.join(/*turbopackIgnore: true*/ respaldosDir, id);
    if (fs.existsSync(final)) continue;
    try {
      fs.mkdirSync(tmp);
    } catch (error) {
      if (error.code === "EEXIST") continue;
      throw error;
    }
    // Otro proceso pudo terminar ese mismo id entre la comprobacion y la reserva.
    if (fs.existsSync(final)) {
      fs.rmdirSync(tmp);
      continue;
    }
    return { id, tmp, final };
  }
  throw new Error(`No se pudo reservar un id de respaldo en ${respaldosDir}`);
}

/*
 * Fase 12: un respaldo o una copia restaurada contiene todos los datos del laboratorio: solo los
 * lee el usuario de FICOTOX (archivos 600, carpetas 700). En Windows los permisos POSIX no aplican.
 */
export function hacerPrivado(ruta) {
  if (process.platform === "win32" || !fs.existsSync(ruta)) return;
  const st = fs.statSync(ruta);
  if (st.isDirectory()) {
    fs.chmodSync(ruta, 0o700);
    for (const n of fs.readdirSync(ruta)) hacerPrivado(path.join(/*turbopackIgnore: true*/ ruta, n));
  } else fs.chmodSync(ruta, 0o600);
}

/* ---------- Crear ---------- */

/*
 * Crea un respaldo de una instancia SQLite. `incluirLlave` (por omision true)
 * guarda la llave de la bitacora en llave/ (solo respaldo local; las copias
 * externas la excluyen). Se escribe en una carpeta temporal y se renombra al
 * final: un respaldo a medias nunca aparece en la lista. `Sqlite` es el
 * constructor de better-sqlite3 (lo pasa quien llama: el servidor o el script).
 *
 * Fase 12: en dos pasos. `iniciarRespaldo` toma solo la foto de la base (el
 * servidor lo hace con su sesion tomada, para que la copia en linea no se
 * reinicie con sus propias escrituras) y `completarRespaldo` copia y huellea los
 * archivos, escribe la llave y el manifest (el servidor lo hace ya sin la sesion:
 * los archivos de la instancia son de solo insercion). `crearRespaldo` hace los dos.
 */
export async function crearRespaldo(opciones) {
  return completarRespaldo(await iniciarRespaldo(opciones));
}

export async function iniciarRespaldo({ Sqlite, sqlitePath, instanceDir, respaldosDir, secretKey, baseDir, incluirLlave = true, etiqueta = null, ahora = new Date() }) {
  if (!sqlitePath) throw new Error("Esta instalación usa MySQL/MariaDB: respalda la base con mysqldump (ver CLAUDE.md)");
  if (!fs.existsSync(sqlitePath)) throw new Error(`No existe la base SQLite: ${sqlitePath}`);
  fs.mkdirSync(respaldosDir, { recursive: true });
  const { id, tmp, final } = reservarId(respaldosDir, ahora);
  fs.mkdirSync(path.join(/*turbopackIgnore: true*/ tmp, "datos"));
  try {
    // 1. Base: API de respaldo en linea (lee paginas de forma consistente aunque haya escrituras).
    const destinoBase = path.join(/*turbopackIgnore: true*/ tmp, "datos", "ficotox.sqlite3");
    const origen = new Sqlite(sqlitePath, { readonly: true, fileMustExist: true });
    try {
      origen.pragma("busy_timeout = 10000");
      await origen.backup(destinoBase);
    } finally {
      origen.close();
    }
    const snapshot = new Sqlite(destinoBase, { readonly: true });
    let integridad;
    let inspeccion;
    let versionBase = null;
    try {
      integridad = String(snapshot.pragma("integrity_check", { simple: true }));
      inspeccion = inspeccionarBase(snapshot);
      // Version real de la base respaldada (un respaldo previo a una migracion guarda la anterior).
      if (snapshot.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'schema_migraciones'").get()) versionBase = Number(snapshot.prepare("SELECT MAX(version) AS v FROM schema_migraciones").get().v) || null;
    } finally {
      snapshot.close();
    }
    if (integridad !== "ok") throw new Error(`El snapshot de la base no pasó integrity_check: ${integridad}`);
    return { id, tmp, final, destinoBase, integridad, inspeccion, versionBase, instanceDir, secretKey, baseDir, incluirLlave, etiqueta, ahora };
  } catch (error) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
}

export async function completarRespaldo({ id, tmp, final, destinoBase, integridad, inspeccion, versionBase, instanceDir, secretKey, baseDir, incluirLlave, etiqueta, ahora }) {
  try {
    // 2. Archivos de la instancia.
    const archivos = [];
    for (const carpeta of CARPETAS_ARCHIVOS) {
      const raiz = path.join(/*turbopackIgnore: true*/ instanceDir, carpeta);
      for (const relativo of listarArchivos(raiz)) {
        const destino = path.join(/*turbopackIgnore: true*/ tmp, "archivos", carpeta, ...relativo.split("/"));
        fs.mkdirSync(path.dirname(destino), { recursive: true });
        await fs.promises.copyFile(path.join(/*turbopackIgnore: true*/ raiz, ...relativo.split("/")), destino);
        archivos.push({ ruta: `archivos/${carpeta}/${relativo}`, tamano: fs.statSync(destino).size, sha256: await sha256Archivo(destino) });
      }
    }

    // 3. Llave de la bitacora (separada): nunca otros secretos del .env.
    const llave = leerClaveSello(secretKey, instanceDir);
    const guardarLlave = incluirLlave && !!llave;
    if (guardarLlave) {
      fs.mkdirSync(path.join(/*turbopackIgnore: true*/ tmp, "llave"), { recursive: true });
      fs.writeFileSync(path.join(/*turbopackIgnore: true*/ tmp, ARCHIVO_LLAVE), `${llave.clave}\n`, { mode: 0o600 });
    }

    // 4. Manifest.
    const manifest = {
      formato: FORMATO,
      version_formato: VERSION_FORMATO,
      id,
      creado_en: ahora.toISOString(),
      host: os.hostname(),
      app: versionApp(baseDir || process.cwd()),
      // null: base anterior a las migraciones (sin schema_migraciones); se reconoce al restaurar.
      esquema_version: versionBase,
      esquema_app: ESQUEMA_VERSION,
      motor: "sqlite",
      etiqueta: etiqueta || null,
      base: { ruta: "datos/ficotox.sqlite3", tamano: fs.statSync(destinoBase).size, sha256: await sha256Archivo(destinoBase), integrity_check: integridad },
      conteos: inspeccion.conteos,
      bitacora: inspeccion.bitacora,
      archivos,
      llave: { incluida: guardarLlave, origen: llave ? llave.origen : null, huella: llave ? huellaLlave(llave.clave) : null, ruta: guardarLlave ? ARCHIVO_LLAVE.split(path.sep).join("/") : null },
    };
    // Sellado con la llave de la bitacora (aunque la llave no se incluya en el respaldo).
    if (llave) manifest.sello = sellarManifest(manifest, llave.clave);
    fs.writeFileSync(path.join(/*turbopackIgnore: true*/ tmp, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    hacerPrivado(tmp);
    fs.renameSync(tmp, final);
    return { id, carpeta: final, manifest };
  } catch (error) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
}

/* ---------- Listar, actas y retencion ---------- */

export function leerManifest(carpeta) {
  const datos = JSON.parse(fs.readFileSync(path.join(/*turbopackIgnore: true*/ carpeta, "manifest.json"), "utf8"));
  if (datos?.formato !== FORMATO) throw new Error("manifest.json no es de un respaldo de FICOTOX");
  return datos;
}

/* Actas de prueba de restauracion (JSON), la mas reciente primero. */
export function listarActas(respaldosDir) {
  const dir = path.join(/*turbopackIgnore: true*/ respaldosDir, CARPETA_ACTAS);
  let nombres = [];
  try {
    nombres = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const actas = [];
  for (const nombre of nombres) {
    try {
      const acta = JSON.parse(fs.readFileSync(path.join(/*turbopackIgnore: true*/ dir, nombre), "utf8"));
      actas.push({ ...acta, archivo: nombre.replace(/\.json$/, "") });
    } catch {
      /* acta ilegible: se omite */
    }
  }
  return actas.sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
}

/* Datos de importacion de un respaldo traido en un archivo portable (null si se creo aqui o si no se pueden leer). */
export function leerImportado(carpeta) {
  try {
    const datos = JSON.parse(fs.readFileSync(path.join(/*turbopackIgnore: true*/ carpeta, ARCHIVO_IMPORTADO), "utf8"));
    return datos && typeof datos === "object" ? datos : null;
  } catch {
    return null;
  }
}

/* Respaldos locales (carpetas con manifest), el mas reciente primero, con su estado de verificacion segun las actas. */
export function listarRespaldos(respaldosDir) {
  let nombres = [];
  try {
    nombres = fs.readdirSync(respaldosDir).filter((n) => ID_RE.test(n));
  } catch {
    return [];
  }
  const actas = listarActas(respaldosDir);
  const out = [];
  for (const id of nombres) {
    const carpeta = path.join(/*turbopackIgnore: true*/ respaldosDir, id);
    try {
      const m = leerManifest(carpeta);
      // Uno importado se lista solo cuando su verificacion termino bien (con la marca ilegible, tampoco).
      const conMarca = fs.existsSync(path.join(/*turbopackIgnore: true*/ carpeta, ARCHIVO_IMPORTADO));
      const importado = conMarca ? leerImportado(carpeta) : null;
      if (conMarca && importado?.estado !== "listo") continue;
      const tamano = (m.base?.tamano || 0) + (m.archivos || []).reduce((t, a) => t + (a.tamano || 0), 0);
      // Una prueba cuenta para este respaldo solo si se hizo sobre esta carpeta y este manifest exacto (no sobre una copia).
      let huella = null;
      try {
        huella = huellaManifest(carpeta);
      } catch {
        huella = null;
      }
      // El acta nombra el respaldo por el id de su manifest (uno importado puede vivir en una carpeta con otro nombre si ese id ya existia aqui).
      const pruebas = actas.filter((a) => (a.respaldo_id === id || a.respaldo_id === m.id) && a.manifest_sha256 === huella && path.resolve(/*turbopackIgnore: true*/ String(a.respaldo_ruta || "")) === path.resolve(/*turbopackIgnore: true*/ carpeta));
      out.push({
        id,
        carpeta,
        creado_en: m.creado_en,
        host: m.host,
        app: m.app,
        esquema_version: m.esquema_version,
        etiqueta: m.etiqueta || null,
        tamano,
        archivos: (m.archivos || []).length,
        incluye_llave: !!m.llave?.incluida && fs.existsSync(path.join(/*turbopackIgnore: true*/ carpeta, ARCHIVO_LLAVE)),
        bitacora: m.bitacora,
        huella_llave: m.llave?.huella || null,
        importado: importado ? { en: importado.importado_en || null, por: importado.importado_por || null, origen_id: m.id || null, host: m.host || null } : null,
        verificacion: pruebas.length ? { resultado: pruebas[0].resultado, fecha: pruebas[0].fecha, acta: pruebas[0].archivo } : null,
      });
    } catch {
      /* carpeta sin manifest valido: no es un respaldo de esta implementacion */
    }
  }
  return out.sort((a, b) => b.id.localeCompare(a.id));
}

/*
 * Conserva los `retencion` respaldos mas recientes y borra los demas, salvo el
 * ultimo respaldo verificado (con una prueba de restauracion aprobada), que
 * nunca se elimina. Los importados de otra computadora no cuentan ni se borran
 * (alguien los trajo a proposito). Devuelve los ids eliminados.
 */
export function aplicarRetencion(respaldosDir, retencion) {
  const lista = listarRespaldos(respaldosDir).filter((r) => !r.importado);
  const verificado = lista.find((r) => r.verificacion?.resultado === "aprobada")?.id || null;
  const eliminados = [];
  lista.forEach((r, i) => {
    if (i < retencion || r.id === verificado) return;
    fs.rmSync(r.carpeta, { recursive: true, force: true });
    eliminados.push(r.id);
  });
  return eliminados;
}
