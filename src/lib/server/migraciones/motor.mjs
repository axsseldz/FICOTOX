/*
 * Fase 12: migraciones versionadas de FICOTOX (JavaScript plano; lo usan el
 * servidor al arrancar, `npm run migrar`, la restauracion de respaldos y las
 * pruebas).
 *
 * - Tabla `schema_migraciones` (version, nombre, checksum, aplicada_en,
 *   duracion_ms, app_commit, modo): una fila por migracion aplicada o
 *   registrada como linea base. Solo hacia adelante: no hay "down"; volver
 *   atras es restaurar un respaldo.
 * - Base sin `schema_migraciones` (creada por el sistema anterior): se compara
 *   su esquema normalizado con el que producen las migraciones hasta la 9, 10
 *   u 11 (en una SQLite en memoria). Si coincide con una, esas quedan como
 *   "linea base" sin ejecutarse y se aplican las siguientes; si no coincide con
 *   ninguna, se aborta con el reporte de diferencias sin tocar la base.
 * - Checksum distinto en una migracion ya aplicada, o una version mayor que la
 *   ultima conocida: error (el servidor no arranca).
 * - Bloqueo: una fila en `schema_migraciones_bloqueo` (se toma con un UPDATE
 *   atomico; nada se borra). Un segundo proceso espera y luego ve que ya no hay
 *   pendientes.
 * - SQLite: cada migracion en su transaccion (el DDL es transaccional). MySQL:
 *   el DDL confirma implicitamente; cada paso comprueba si ya se hizo, asi que
 *   una migracion interrumpida se reanuda al volver a correr.
 * - Cada migracion (y la linea base) deja una entrada sellada en la bitacora
 *   (actor: Sistema), encadenada con audit-chain.mjs.
 */
import { createHash } from "node:crypto";
import os from "node:os";
import { COLUMNAS_AUDITORIA, construirRegistro, sellar, stableJson } from "../../shared/audit-chain.mjs";
import { arranqueDelSistema } from "../../shared/bloqueo.mjs";
import * as m0009 from "./0009_base_fase9.mjs";
import * as m0010 from "./0010_adjuntos.mjs";
import * as m0011 from "./0011_calidad.mjs";
import * as m0012 from "./0012_firmas_tokens.mjs";
import * as m0013 from "./0013_biblioteca.mjs";
import * as m0014 from "./0014_tema.mjs";
import * as m0015 from "./0015_notificaciones_leidas.mjs";
import * as m0016 from "./0016_foto_perfil.mjs";
import * as m0017 from "./0017_busqueda_recientes.mjs";
import * as m0018 from "./0018_respaldos_permisos.mjs";
import * as m0019 from "./0019_inventario_campos.mjs";
import * as m0020 from "./0020_consumibles_unidades.mjs";
import * as m0021 from "./0021_permisos_acceso_y_biblioteca.mjs";
import * as m0022 from "./0022_documentos_sgc.mjs";
import * as m0023 from "./0023_documentos_flujo.mjs";
import * as m0024 from "./0024_documentos_externos_lecturas.mjs";

export const MIGRACIONES = [m0009, m0010, m0011, m0012, m0013, m0014, m0015, m0016, m0017, m0018, m0019, m0020, m0021, m0022, m0023, m0024].sort((a, b) => a.version - b.version);
export const VERSION_ACTUAL = MIGRACIONES[MIGRACIONES.length - 1].version;
/* Versiones que pueden quedar como linea base de una base anterior (las del sistema sin migraciones). */
export const VERSIONES_BASELINE = [11, 10, 9];
/* Tablas que el sistema anterior creaba al primer uso: en la linea base pueden estar o no (si estan, con esta definicion). */
const OPCIONALES_ANTES_DE = { firmas_tokens: 12 };
const TABLAS_CONTROL = new Set(["schema_migraciones", "schema_migraciones_bloqueo"]);
const ESPERA_BLOQUEO_MS = 120_000;
const BLOQUEO_VENCIDO_MS = 30 * 60_000;

export const checksumDe = (m) => createHash("sha256").update(stableJson({ version: m.version, nombre: m.nombre, pasos: m.pasos })).digest("hex");

/* ---------- Adaptadores (parametros posicionales "?") ---------- */

/* better-sqlite3. */
export function adaptadorSqlite(db) {
  const params = (p) => (p || []).map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v === undefined ? null : v));
  return {
    motor: "sqlite",
    raw: db,
    all: async (sql, p) => db.prepare(sql).all(...params(p)),
    get: async (sql, p) => db.prepare(sql).get(...params(p)) ?? null,
    run: async (sql, p) => {
      const r = db.prepare(sql).run(...params(p));
      return { cambios: r.changes, id: Number(r.lastInsertRowid) || null };
    },
    exec: async (sql) => void db.exec(sql),
    begin: async () => void db.exec("BEGIN IMMEDIATE"),
    commit: async () => void db.exec("COMMIT"),
    rollback: async () => {
      if (db.inTransaction) db.exec("ROLLBACK");
    },
  };
}

/* mysql2/promise (conexion unica, no pool). */
export function adaptadorMysql(conn) {
  return {
    motor: "mysql",
    raw: conn,
    all: async (sql, p) => (await conn.query(sql, p || []))[0],
    get: async (sql, p) => (await conn.query(sql, p || []))[0][0] ?? null,
    run: async (sql, p) => {
      const [r] = await conn.query(sql, p || []);
      return { cambios: r.affectedRows ?? 0, id: r.insertId || null };
    },
    exec: async (sql) => void (await conn.query(sql)),
    begin: async () => conn.beginTransaction(),
    commit: async () => conn.commit(),
    rollback: async () => conn.rollback(),
  };
}

/* ---------- Esquema normalizado ---------- */

/*
 * SQLite: tablas con sus columnas (tipo declarado, NOT NULL, default y PK, sin
 * importar el orden: las bases que crecieron con ALTER TABLE tienen otro
 * orden), indices (nombre, tabla, columnas y unicidad; los automaticos por
 * tabla y columnas) y triggers (con su SQL normalizado). MySQL: nombres de
 * tablas, columnas y triggers (tipos e indices se escriben distinto en cada motor).
 */
export async function esquemaDe(db) {
  const out = { tablas: {}, indices: {}, triggers: {} };
  if (db.motor === "sqlite") {
    for (const t of await db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")) {
      if (TABLAS_CONTROL.has(t.name)) continue;
      const columnas = {};
      for (const c of await db.all(`PRAGMA table_xinfo("${t.name}")`)) columnas[c.name] = `${String(c.type).toUpperCase()}|nn=${c.notnull}|def=${c.dflt_value}|pk=${c.pk}`;
      out.tablas[t.name] = columnas;
      for (const i of await db.all(`PRAGMA index_list("${t.name}")`)) {
        const cols = (await db.all(`PRAGMA index_info("${i.name}")`)).map((c) => c.name).join(",");
        const clave = i.origin === "c" ? i.name : `${t.name}:${i.origin}:${cols}`;
        out.indices[clave] = `${t.name}(${cols})${i.unique ? " unico" : ""}`;
      }
    }
    for (const g of await db.all("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger'")) out.triggers[g.name] = `${g.tbl_name}: ${String(g.sql).replace(/\s+/g, " ").trim()}`;
    return out;
  }
  for (const c of await db.all("SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()")) {
    if (TABLAS_CONTROL.has(c.t)) continue;
    (out.tablas[c.t] ||= {})[c.c] = "columna";
  }
  for (const g of await db.all("SELECT TRIGGER_NAME AS n, EVENT_OBJECT_TABLE AS t FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()")) out.triggers[g.n] = g.t;
  return out;
}

/* Diferencias legibles de `actual` respecto de `esperado`. */
export function diferencias(esperado, actual) {
  const dif = [];
  for (const t of Object.keys(esperado.tablas)) if (!(t in actual.tablas)) dif.push(`falta la tabla ${t}`);
  for (const t of Object.keys(actual.tablas)) if (!(t in esperado.tablas)) dif.push(`tabla de mas: ${t}`);
  for (const t of Object.keys(esperado.tablas)) {
    if (!(t in actual.tablas)) continue;
    const e = esperado.tablas[t];
    const a = actual.tablas[t];
    for (const c of Object.keys(e)) if (!(c in a)) dif.push(`falta la columna ${t}.${c}`);
    for (const c of Object.keys(a)) if (!(c in e)) dif.push(`columna de mas: ${t}.${c} (${a[c]})`);
    for (const c of Object.keys(e)) if (c in a && a[c] !== e[c]) dif.push(`columna distinta ${t}.${c}: se esperaba ${e[c]}, hay ${a[c]}`);
  }
  for (const k of ["indices", "triggers"]) {
    const etiqueta = k === "indices" ? "indice" : "trigger";
    for (const n of Object.keys(esperado[k])) if (!(n in actual[k])) dif.push(`falta el ${etiqueta} ${n}`);
    for (const n of Object.keys(actual[k])) if (!(n in esperado[k])) dif.push(`${etiqueta} de mas: ${n}`);
    for (const n of Object.keys(esperado[k])) if (n in actual[k] && actual[k][n] !== esperado[k][n]) dif.push(`${etiqueta} distinto ${n}: se esperaba ${esperado[k][n]}, hay ${actual[k][n]}`);
  }
  return dif;
}

function sinTablas(esquema, tablas) {
  const out = { tablas: { ...esquema.tablas }, indices: {}, triggers: { ...esquema.triggers } };
  for (const t of tablas) delete out.tablas[t];
  for (const [k, v] of Object.entries(esquema.indices)) if (!tablas.some((t) => v.startsWith(`${t}(`) || v === t || k.startsWith(`${t}:`))) out.indices[k] = v;
  return out;
}

const memoEsperado = new Map();
/* Esquema que dejan las migraciones hasta `version`, aplicadas a una SQLite en memoria (en MySQL solo se comparan nombres). */
export async function esquemaEsperado(Sqlite, version, motor = "sqlite") {
  const clave = `${motor}:${version}`;
  if (memoEsperado.has(clave)) return memoEsperado.get(clave);
  const memoria = new Sqlite(":memory:");
  try {
    const db = adaptadorSqlite(memoria);
    for (const m of MIGRACIONES.filter((x) => x.version <= version)) await m.up(db, "sqlite");
    let esquema = await esquemaDe(db);
    if (motor === "mysql") {
      esquema = {
        tablas: Object.fromEntries(Object.entries(esquema.tablas).map(([t, cols]) => [t, Object.fromEntries(Object.keys(cols).map((c) => [c, "columna"]))])),
        // En MySQL los indices (y los UNIQUE en linea) se nombran distinto: se comparan tablas, columnas y triggers.
        indices: {},
        triggers: Object.fromEntries(Object.entries(esquema.triggers).map(([k, v]) => [k, v.slice(0, v.indexOf(":"))])),
      };
    }
    memoEsperado.set(clave, esquema);
    return esquema;
  } finally {
    memoria.close();
  }
}

/* ---------- Estado ---------- */

async function existeTabla(db, tabla) {
  if (db.motor === "sqlite") return !!(await db.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", [tabla]));
  return !!(await db.get("SELECT 1 AS x FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [tabla]));
}

async function tablasDeUsuario(db) {
  const filas = db.motor === "sqlite" ? await db.all("SELECT name AS t FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'") : await db.all("SELECT TABLE_NAME AS t FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()");
  return filas.map((f) => f.t).filter((t) => !TABLAS_CONTROL.has(t));
}

export class ErrorMigracion extends Error {
  constructor(mensaje, datos = {}) {
    super(mensaje);
    this.name = "ErrorMigracion";
    Object.assign(this, datos);
  }
}

/*
 * Estado de la base frente a las migraciones conocidas:
 *   { tipo: "vacia" | "versionada" | "sin_versionar", aplicadas, pendientes, lineaBase, version }
 * Lanza ErrorMigracion (codigo) si la base no se puede migrar: deriva de
 * esquema, checksum alterado o version mayor que la aplicacion.
 */
export async function estadoMigraciones(db, { Sqlite }) {
  const conocidas = new Map(MIGRACIONES.map((m) => [m.version, m]));
  if (await existeTabla(db, "schema_migraciones")) {
    const aplicadas = await db.all("SELECT version, nombre, checksum, aplicada_en, duracion_ms, app_commit, modo FROM schema_migraciones ORDER BY version");
    if (aplicadas.length) {
      for (const a of aplicadas) {
        const m = conocidas.get(Number(a.version));
        if (!m) {
          if (Number(a.version) > VERSION_ACTUAL) throw new ErrorMigracion(`La base está en la versión ${a.version} y esta aplicación solo conoce hasta la ${VERSION_ACTUAL}: actualiza la aplicación (no se toca la base).`, { codigo: "version_mayor", version: Number(a.version) });
          throw new ErrorMigracion(`La base registra la migración ${a.version} (${a.nombre}), que esta aplicación no conoce.`, { codigo: "migracion_desconocida", version: Number(a.version) });
        }
        if (a.checksum !== checksumDe(m)) throw new ErrorMigracion(`La migración ${m.version} (${m.nombre}) cambió después de aplicarse (checksum distinto): no se arranca. Restaura el archivo de la migración o consulta al responsable técnico.`, { codigo: "checksum", version: m.version });
      }
      const hechas = new Set(aplicadas.map((a) => Number(a.version)));
      return { tipo: "versionada", aplicadas, pendientes: MIGRACIONES.filter((m) => !hechas.has(m.version)), lineaBase: null, version: Math.max(...hechas) };
    }
  }
  const tablas = await tablasDeUsuario(db);
  if (!tablas.length) return { tipo: "vacia", aplicadas: [], pendientes: [...MIGRACIONES], lineaBase: null, version: null };
  const actual = await esquemaDe(db);
  let mejor = null;
  for (const v of VERSIONES_BASELINE) {
    const esperado = await esquemaEsperado(Sqlite, v, db.motor);
    // Tablas que antes se creaban al primer uso: si estan, deben tener la definicion de su migracion.
    const opcionales = Object.entries(OPCIONALES_ANTES_DE).filter(([, hasta]) => v < hasta).map(([t]) => t);
    const problemas = [];
    for (const t of opcionales) {
      if (!(t in actual.tablas)) continue;
      const def = sinTablas(await esquemaEsperado(Sqlite, VERSION_ACTUAL, db.motor), []);
      const solo = { tablas: { [t]: def.tablas[t] }, indices: Object.fromEntries(Object.entries(def.indices).filter(([k, x]) => x.startsWith(`${t}(`) || x === t || k.startsWith(`${t}:`))), triggers: {} };
      const suyo = { tablas: { [t]: actual.tablas[t] }, indices: Object.fromEntries(Object.entries(actual.indices).filter(([k, x]) => x.startsWith(`${t}(`) || x === t || k.startsWith(`${t}:`))), triggers: {} };
      problemas.push(...diferencias(solo, suyo));
    }
    const dif = [...problemas, ...diferencias(sinTablas(esperado, opcionales), sinTablas(actual, opcionales))];
    if (!dif.length) return { tipo: "sin_versionar", aplicadas: [], pendientes: MIGRACIONES.filter((m) => m.version > v), lineaBase: v, version: null };
    if (!mejor || dif.length < mejor.dif.length) mejor = { version: v, dif };
  }
  // Creacion inicial interrumpida (MySQL: el DDL de la 0009 se confirma paso a paso y la version se registra al
  // final): hay tabla de control SIN filas y las tablas presentes son un subconjunto de las de la 0009, cada una
  // con su definicion exacta. Es reanudable: los pasos son idempotentes y los hechos se saltan.
  if (await existeTabla(db, "schema_migraciones")) {
    const base = await esquemaEsperado(Sqlite, MIGRACIONES[0].version, db.motor);
    const parcial = Object.keys(actual.tablas).every((t) => t in base.tablas && JSON.stringify(Object.entries(base.tablas[t]).sort()) === JSON.stringify(Object.entries(actual.tablas[t]).sort()));
    if (parcial) return { tipo: "vacia", aplicadas: [], pendientes: [...MIGRACIONES], lineaBase: null, version: null, reanudada: true };
  }
  throw new ErrorMigracion(
    `La base no tiene migraciones registradas y su esquema no coincide con ninguna versión conocida (${VERSIONES_BASELINE.join(", ")}). No se modificó nada. La más parecida es la ${mejor.version}; diferencias:\n  - ${mejor.dif.join("\n  - ")}\nRevisa si la base viene de otra instalación o fue modificada a mano; restaura un respaldo conocido o consulta al responsable técnico.`,
    { codigo: "deriva", version: mejor.version, diferencias: mejor.dif },
  );
}

/* ---------- Control y bloqueo ---------- */

export async function crearControl(db) {
  if (db.motor === "sqlite") {
    await db.exec("CREATE TABLE IF NOT EXISTS schema_migraciones (version INTEGER PRIMARY KEY, nombre VARCHAR(200) NOT NULL, checksum VARCHAR(64) NOT NULL, aplicada_en VARCHAR(40) NOT NULL, duracion_ms INTEGER NOT NULL DEFAULT 0, app_commit VARCHAR(80) DEFAULT NULL, modo VARCHAR(20) NOT NULL DEFAULT 'aplicada')");
    await db.exec("CREATE TABLE IF NOT EXISTS schema_migraciones_bloqueo (id INTEGER PRIMARY KEY, pid INTEGER DEFAULT NULL, host VARCHAR(200) DEFAULT NULL, desde VARCHAR(40) DEFAULT NULL)");
    await db.run("INSERT OR IGNORE INTO schema_migraciones_bloqueo (id) VALUES (1)");
  } else {
    await db.exec("CREATE TABLE IF NOT EXISTS schema_migraciones (version INT NOT NULL PRIMARY KEY, nombre VARCHAR(200) NOT NULL, checksum VARCHAR(64) NOT NULL, aplicada_en VARCHAR(40) NOT NULL, duracion_ms INT NOT NULL DEFAULT 0, app_commit VARCHAR(80) DEFAULT NULL, modo VARCHAR(20) NOT NULL DEFAULT 'aplicada') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    await db.exec("CREATE TABLE IF NOT EXISTS schema_migraciones_bloqueo (id INT NOT NULL PRIMARY KEY, pid INT DEFAULT NULL, host VARCHAR(200) DEFAULT NULL, desde VARCHAR(40) DEFAULT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    await db.run("INSERT IGNORE INTO schema_migraciones_bloqueo (id) VALUES (1)");
  }
}

const vivo = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

async function tomarBloqueo(db, { esperaMs = ESPERA_BLOQUEO_MS, avisar = () => {} } = {}) {
  const inicio = Date.now();
  let avisado = false;
  for (;;) {
    const ahora = new Date();
    const r = await db.run("UPDATE schema_migraciones_bloqueo SET pid = ?, host = ?, desde = ? WHERE id = 1 AND pid IS NULL", [process.pid, os.hostname(), ahora.toISOString()]);
    if (r.cambios === 1) return;
    const quien = await db.get("SELECT pid, host, desde FROM schema_migraciones_bloqueo WHERE id = 1");
    // Bloqueo huerfano: el proceso ya no existe (mismo equipo), se tomo antes del ultimo arranque de este equipo
    // (corte de luz a mitad; su pid puede ser hoy de otro proceso) o lleva demasiado tiempo.
    const mismoEquipo = quien?.host === os.hostname();
    const huerfano = quien && ((mismoEquipo && (!vivo(Number(quien.pid)) || Date.parse(quien.desde || 0) < arranqueDelSistema())) || Date.now() - Date.parse(quien.desde || 0) > BLOQUEO_VENCIDO_MS);
    if (huerfano) {
      await db.run("UPDATE schema_migraciones_bloqueo SET pid = NULL, host = NULL, desde = NULL WHERE id = 1 AND pid = ? AND desde = ?", [quien.pid, quien.desde]);
      continue;
    }
    if (Date.now() - inicio > esperaMs) throw new ErrorMigracion(`Otro proceso está migrando la base (pid ${quien?.pid} en ${quien?.host}, desde ${quien?.desde}); intenta de nuevo cuando termine. Si no hay ningún otro proceso migrando, el bloqueo se libera solo 30 minutos después de tomado (o al reiniciar la computadora).`, { codigo: "bloqueo" });
    if (!avisado) {
      avisar(`Otro proceso (pid ${quien?.pid}) está migrando la base; esperando…`);
      avisado = true;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function soltarBloqueo(db) {
  await db.run("UPDATE schema_migraciones_bloqueo SET pid = NULL, host = NULL, desde = NULL WHERE id = 1 AND pid = ?", [process.pid]);
}

/* ---------- Bitacora ---------- */

async function registrarEnBitacora(db, clave, entrada) {
  if (!clave || !(await existeTabla(db, "auditoria"))) return;
  const previo = await db.get("SELECT hash FROM auditoria ORDER BY id DESC LIMIT 1");
  const registro = construirRegistro(entrada, { sub: null, nombre: "sistema", email: null }, previo?.hash || null);
  const hash = sellar(registro, clave);
  await db.run(`INSERT INTO auditoria (${COLUMNAS_AUDITORIA.join(", ")}) VALUES (${COLUMNAS_AUDITORIA.map(() => "?").join(", ")})`, COLUMNAS_AUDITORIA.map((c) => (c === "hash" ? hash : registro[c])));
}

/* ---------- Aplicar ---------- */

/*
 * Aplica lo pendiente. Opciones:
 *   Sqlite       constructor de better-sqlite3 (para el esquema esperado)
 *   clave        llave de la bitacora (para sellar las entradas)
 *   appCommit    commit de la aplicacion (se guarda en schema_migraciones)
 *   respaldo     async () => ruta: respaldo previo; se llama solo si hay algo que hacer y la base no esta vacia
 *   simular      true: solo devuelve el plan, sin cambiar nada
 *   avisar       funcion para mensajes de progreso
 * Devuelve { plan, aplicadas, lineaBase, respaldo }.
 */
export async function aplicarMigraciones(db, opciones) {
  const { Sqlite, clave = null, appCommit = null, respaldo = null, simular = false, avisar = () => {}, esperaMs } = opciones;
  let estado = await estadoMigraciones(db, { Sqlite });
  const plan = { tipo: estado.tipo, lineaBase: estado.lineaBase, pendientes: estado.pendientes.map((m) => ({ version: m.version, nombre: m.nombre })) };
  if (simular || (!estado.pendientes.length && estado.lineaBase === null)) return { plan, aplicadas: [], lineaBase: null, respaldo: null };

  // El respaldo previo se toma ANTES de crear las tablas de control y de tomar el bloqueo: asi el
  // respaldo nunca lleva un bloqueo "tomado" (restaurarlo en otro equipo lo haria esperar).
  let rutaRespaldo = null;
  if (estado.tipo !== "vacia" && respaldo) {
    rutaRespaldo = await respaldo();
    avisar(`Respaldo previo a la migración: ${rutaRespaldo}`);
  }
  await crearControl(db);
  await tomarBloqueo(db, { esperaMs, avisar });
  const hechas = [];
  let lineaBase = null;
  try {
    // Otro proceso pudo migrar mientras se esperaba el bloqueo.
    estado = await estadoMigraciones(db, { Sqlite });
    if (!estado.pendientes.length && estado.lineaBase === null) return { plan, aplicadas: [], lineaBase: null, respaldo: rutaRespaldo };
    const ahora = () => new Date().toISOString();
    if (estado.lineaBase !== null) {
      lineaBase = estado.lineaBase;
      await db.begin();
      try {
        for (const m of MIGRACIONES.filter((x) => x.version <= lineaBase)) await db.run("INSERT INTO schema_migraciones (version, nombre, checksum, aplicada_en, duracion_ms, app_commit, modo) VALUES (?, ?, ?, ?, 0, ?, 'baseline')", [m.version, m.nombre, checksumDe(m), ahora(), appCommit]);
        await registrarEnBitacora(db, clave, { accion: "migrar", entidad: "esquema", entidadId: lineaBase, referencia: `Línea base ${lineaBase}`, motivo: `Base existente reconocida como versión ${lineaBase} (sin ejecutar migraciones)`, detalle: { modo: "baseline", version: lineaBase, respaldo_previo: rutaRespaldo, app_commit: appCommit } });
        await db.commit();
      } catch (error) {
        await db.rollback();
        throw error;
      }
      avisar(`Línea base: la base se reconoció como versión ${lineaBase}.`);
    }
    for (const m of estado.pendientes) {
      const t0 = Date.now();
      avisar(`Aplicando la migración ${m.version} (${m.nombre})…`);
      if (db.motor === "sqlite") await db.begin();
      try {
        // Migracion 13: la copia de documentos necesita la carpeta de la instancia (archivos).
        await m.up(db, db.motor, { instanceDir: opciones.instanceDir || null });
        // Prueba de fallo a la mitad (solo con FICOTOX_PRUEBAS=1): el DDL ya se ejecuto dentro de la transaccion.
        if (process.env.FICOTOX_PRUEBAS === "1" && Number(process.env.FICOTOX_PRUEBA_FALLAR_MIGRACION) === m.version) throw new Error(`Fallo simulado en la migración ${m.version}`);
        if (db.motor === "mysql") await db.begin();
        const duracion = Date.now() - t0;
        await db.run("INSERT INTO schema_migraciones (version, nombre, checksum, aplicada_en, duracion_ms, app_commit, modo) VALUES (?, ?, ?, ?, ?, ?, 'aplicada')", [m.version, m.nombre, checksumDe(m), ahora(), duracion, appCommit]);
        await registrarEnBitacora(db, clave, { accion: "migrar", entidad: "esquema", entidadId: m.version, referencia: `Migración ${m.version}`, motivo: m.nombre, detalle: { modo: "aplicada", version: m.version, nombre: m.nombre, checksum: checksumDe(m), duracion_ms: duracion, respaldo_previo: rutaRespaldo, app_commit: appCommit } });
        await db.commit();
        hechas.push({ version: m.version, nombre: m.nombre, duracion_ms: duracion });
      } catch (error) {
        await db.rollback().catch(() => {});
        throw new ErrorMigracion(`Falló la migración ${m.version} (${m.nombre}): ${error.message}.${db.motor === "sqlite" ? " Se deshizo (la base quedó como antes de esa migración)." : " En MySQL el DDL ya confirmado se reanuda al volver a correr."}${rutaRespaldo ? ` Respaldo previo: ${rutaRespaldo}` : ""}`, { codigo: "fallo", version: m.version, respaldo: rutaRespaldo, causa: error });
      }
    }
  } finally {
    await soltarBloqueo(db).catch(() => {});
  }
  return { plan, aplicadas: hechas, lineaBase, respaldo: rutaRespaldo };
}

/* Version registrada de una base (null si no tiene schema_migraciones). */
export async function versionDe(db) {
  if (!(await existeTabla(db, "schema_migraciones"))) return null;
  const r = await db.get("SELECT MAX(version) AS v FROM schema_migraciones");
  return r && r.v !== null && r.v !== undefined ? Number(r.v) : null;
}
