/*
 * Fase 12 · migraciones versionadas (sin el servidor de pruebas; bases temporales
 * en instance/test/migraciones/, nunca instance/ real):
 * - equivalencia: una base nueva creada con las migraciones es identica
 *   (tablas, columnas con tipo y default, indices, triggers) a la del codigo
 *   anterior (tests/fixtures/esquema-anterior-fase11.sqlite3, congelada desde
 *   main antes de la Fase 12, mas firmas_tokens que ese codigo creaba al primer uso);
 * - linea base de bases anteriores (Fase 9 con y sin firmas_tokens, 10 y 11) y
 *   esquema final igual al de una base nueva; bitacora integra con las entradas;
 * - deriva (columna de mas o de menos): aborta con reporte y no toca la base;
 * - fallo a mitad: rollback, respaldo previo creado, la base queda como antes;
 * - checksum alterado y version mayor: error;
 * - dos procesos a la vez: solo uno migra;
 * - respaldo con ESQUEMA_VERSION 10: se restaura y migra; de una version mayor: se rechaza;
 * - el servidor no arranca con deriva de esquema (mensaje claro).
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const Sqlite = require("better-sqlite3");
const M = await import("../src/lib/server/migraciones/motor.mjs");
const { evaluarCadena } = await import("../src/lib/shared/audit-chain.mjs");
const { crearRespaldo, sellarManifest } = await import("../src/lib/shared/respaldo.mjs");
const firmas = (await import("../src/lib/server/migraciones/0012_firmas_tokens.mjs")).pasos[0].sqlite;

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const DIR = path.join(root, "instance/test/migraciones");
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const CLAVE = "clave-de-prueba-de-migraciones-0123456789abcdef";
const copia = (fixture, nombre) => {
  const destino = path.join(DIR, nombre);
  fs.copyFileSync(path.join(root, "tests/fixtures", `esquema-anterior-${fixture}.sqlite3`), destino);
  return destino;
};
const sha = (archivo) => createHash("sha256").update(fs.readFileSync(archivo)).digest("hex");
const nueva = async (hasta = Infinity) => {
  const db = M.adaptadorSqlite(new Sqlite(":memory:"));
  for (const m of M.MIGRACIONES.filter((x) => x.version <= hasta)) await m.up(db, "sqlite");
  return M.esquemaDe(db);
};
const cadena = (conexion) => {
  const seq = conexion.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'auditoria'").get();
  return evaluarCadena(conexion.prepare("SELECT * FROM auditoria ORDER BY id").all(), CLAVE, seq ? Number(seq.seq) : null, 2);
};

/* ---------- Equivalencia ---------- */
{
  const ref = new Sqlite(copia("fase11", "equivalencia.sqlite3"));
  ref.exec(firmas);
  // Hasta la migracion 12: la 13 agrega las tablas de la biblioteca (que el codigo anterior no tenia).
  const dif = M.diferencias(await M.esquemaDe(M.adaptadorSqlite(ref)), await nueva(12));
  ref.close();
  check("equivalencia: base nueva con migraciones 9–12 = base del código anterior (Fase 11 + firmas_tokens)", dif.length === 0, dif.slice(0, 3).join("; "));
}

/* ---------- Migracion 13: copia de Documentos SGC a la biblioteca ---------- */
{
  const inst = path.join(DIR, "biblioteca-inst");
  fs.mkdirSync(path.join(inst, "documentos_sgc"), { recursive: true });
  const archivo = path.join(inst, "ficotox.sqlite3");
  fs.copyFileSync(path.join(root, "tests/fixtures/esquema-anterior-fase11.sqlite3"), archivo);
  const conexion = new Sqlite(archivo);
  conexion.exec(firmas);
  const contenido = { "a1.pdf": "%PDF-1.4 revision 1\n", "a2.pdf": "%PDF-1.4 revision 2 vigente\n", "a3.pdf": "%PDF-1.4 revision 3 borrador\n", "b1.docx": "PK\u0003\u0004 docx" };
  for (const [nombre, texto] of Object.entries(contenido)) fs.writeFileSync(path.join(inst, "documentos_sgc", nombre), texto);
  const huella = (n) => createHash("sha256").update(contenido[n]).digest("hex");
  const ins = conexion.prepare("INSERT INTO documentos_sgc (clave, revision, titulo, tipo, area, estado, archivo_nombre, archivo_original, archivo_sha256, creado_en) VALUES (?, ?, ?, ?, 'GC', ?, ?, ?, ?, '2026-09-01 10:00:00')");
  ins.run("FX-GCP-CD", 1, "Control de documentos", "P", "obsoleto", "a1.pdf", "control.pdf", huella("a1.pdf"));
  ins.run("FX-GCP-CD", 2, "Control de documentos", "P", "vigente", "a2.pdf", "control-r2.pdf", huella("a2.pdf"));
  ins.run("FX-GCP-CD", 3, "Control de documentos (borrador)", "P", "borrador", "a3.pdf", "control-r3.pdf", huella("a3.pdf"));
  ins.run("FX-GCI-IT", 1, "Instructivo sin vigente", "I", "por_aprobar", "b1.docx", "instructivo.docx", null);
  ins.run("FX-GCF-SA", 1, "Formato sin archivo", "F", "vigente", null, null, null);
  const antes = JSON.stringify(conexion.prepare("SELECT * FROM documentos_sgc ORDER BY id").all());
  const r = await M.aplicarMigraciones(M.adaptadorSqlite(conexion), { Sqlite, clave: CLAVE, appCommit: "prueba", instanceDir: inst, respaldo: async () => "x" });
  const docs = conexion.prepare("SELECT d.*, c.nombre AS categoria FROM biblioteca_documentos d LEFT JOIN biblioteca_categorias c ON c.id = d.categoria_id ORDER BY d.id").all();
  const vers = conexion.prepare("SELECT * FROM biblioteca_versiones ORDER BY documento_id, numero").all();
  const despues = JSON.stringify(conexion.prepare("SELECT * FROM documentos_sgc ORDER BY id").all());
  const categorias = conexion.prepare("SELECT nombre FROM biblioteca_categorias ORDER BY orden").all().map((c) => c.nombre);
  conexion.close();
  const cd = docs.find((d) => d.clave === "FX-GCP-CD");
  const vcd = vers.filter((v) => v.documento_id === cd?.id);
  const actual = vcd.find((v) => v.id === cd?.version_actual_id);
  const copiaOk = vcd.every((v) => fs.existsSync(path.join(inst, "biblioteca", v.nombre_almacenado)) && createHash("sha256").update(fs.readFileSync(path.join(inst, "biblioteca", v.nombre_almacenado))).digest("hex") === v.sha256);
  check("migración 13: crea las categorías iniciales", categorias.join("|") === "Manual de Calidad|Procedimientos|Instructivos|Formatos|Normas y regulación|Artículos y referencias|Otros", categorias.join(","));
  check("migración 13: copia los documentos con archivo (la revisión vigente como actual y las anteriores como versiones; el borrador posterior no)", r.aplicadas.some((m) => m.version === 13) && docs.length === 2 && cd?.titulo === "Control de documentos" && cd?.categoria === "Procedimientos" && vcd.length === 2 && actual?.numero === 2 && actual?.sha256 === huella("a2.pdf"), `${docs.length} ${vcd.length} ${actual?.numero}`);
  check("  … sin vigente, la revisión más reciente; los archivos se copian a biblioteca/<id>/ con su SHA-256", docs.some((d) => d.clave === "FX-GCI-IT") && copiaOk);
  check("  … y no toca las tablas del flujo anterior", antes === despues);
}

/* ---------- Linea base ---------- */
const esquemaFinal = await nueva();
for (const [fixture, esperada, conFirmas] of [["fase9", 9, false], ["fase9", 9, true], ["fase10", 10, false], ["fase11", 11, true]]) {
  const archivo = copia(fixture, `baseline-${fixture}-${conFirmas}.sqlite3`);
  const conexion = new Sqlite(archivo);
  if (conFirmas) conexion.exec(firmas);
  const db = M.adaptadorSqlite(conexion);
  let respaldos = 0;
  const r = await M.aplicarMigraciones(db, { Sqlite, clave: CLAVE, appCommit: "prueba", respaldo: async () => (respaldos += 1, "respaldo-simulado") });
  const dif = M.diferencias(esquemaFinal, await M.esquemaDe(db));
  const filas = conexion.prepare("SELECT version, modo FROM schema_migraciones ORDER BY version").all();
  const entradas = conexion.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'migrar'").get().n;
  const v = cadena(conexion);
  conexion.close();
  const aplicadas = M.MIGRACIONES.filter((m) => m.version > esperada).length;
  check(`línea base de una base ${fixture}${conFirmas ? " con firmas_tokens" : ""}: se reconoce como ${esperada}, aplica lo que falta y queda igual a una base nueva`, r.lineaBase === esperada && r.aplicadas.length === aplicadas && dif.length === 0 && filas.filter((f) => f.modo === "baseline").length === M.MIGRACIONES.filter((m) => m.version <= esperada).length && respaldos === 1, `${r.lineaBase} ${r.aplicadas.length} ${dif.slice(0, 2).join("; ")}`);
  check(`  … con una entrada sellada por la línea base y por cada migración, y la cadena íntegra`, entradas === aplicadas + 1 && v.ok, `${entradas} ${JSON.stringify(v)}`);
}

/* ---------- Base vacia ---------- */
{
  const conexion = new Sqlite(path.join(DIR, "vacia.sqlite3"));
  const db = M.adaptadorSqlite(conexion);
  let respaldos = 0;
  const r = await M.aplicarMigraciones(db, { Sqlite, clave: CLAVE, respaldo: async () => (respaldos += 1, "x") });
  const e = await M.estadoMigraciones(db, { Sqlite });
  conexion.close();
  check("base vacía: se aplican todas las migraciones, sin respaldo previo (no hay nada que respaldar)", r.aplicadas.length === M.MIGRACIONES.length && respaldos === 0 && e.pendientes.length === 0, `${r.aplicadas.length} ${respaldos}`);
}

/* ---------- Deriva ---------- */
for (const [caso, sql] of [
  ["una columna de más", "ALTER TABLE usuarios ADD COLUMN apodo VARCHAR(40) DEFAULT NULL"],
  ["una columna de menos", "ALTER TABLE usuarios DROP COLUMN avatar"],
]) {
  const archivo = copia("fase9", `deriva-${caso.replace(/ /g, "-")}.sqlite3`);
  const c = new Sqlite(archivo);
  c.exec(sql);
  c.close();
  const antes = sha(archivo);
  const conexion = new Sqlite(archivo);
  let error = null;
  let respaldos = 0;
  try {
    await M.aplicarMigraciones(M.adaptadorSqlite(conexion), { Sqlite, clave: CLAVE, respaldo: async () => (respaldos += 1, "x") });
  } catch (e) {
    error = e;
  }
  const control = conexion.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'schema_migraciones%'").all().length;
  conexion.close();
  check(`deriva (${caso}): aborta con el reporte de diferencias y no toca la base`, error?.codigo === "deriva" && /usuarios\.(apodo|avatar)/.test(error.message) && sha(archivo) === antes && control === 0 && respaldos === 0, `${error?.codigo} ${String(error?.message).split("\n")[0].slice(0, 90)}`);
}

/* ---------- Fallo a mitad ---------- */
{
  const archivo = copia("fase9", "fallo.sqlite3");
  const conexion = new Sqlite(archivo);
  const db = M.adaptadorSqlite(conexion);
  process.env.FICOTOX_PRUEBAS = "1";
  process.env.FICOTOX_PRUEBA_FALLAR_MIGRACION = "11";
  let error = null;
  const respaldos = [];
  try {
    await M.aplicarMigraciones(db, { Sqlite, clave: CLAVE, respaldo: async () => (respaldos.push("respaldo-pre-migracion"), "respaldo-pre-migracion") });
  } catch (e) {
    error = e;
  }
  delete process.env.FICOTOX_PRUEBA_FALLAR_MIGRACION;
  const versiones = conexion.prepare("SELECT version FROM schema_migraciones ORDER BY version").all().map((f) => f.version);
  const calidad = !!conexion.prepare("SELECT 1 FROM sqlite_master WHERE name = 'no_conformidades'").get();
  const libre = conexion.prepare("SELECT pid FROM schema_migraciones_bloqueo WHERE id = 1").get().pid === null;
  check("fallo a mitad de la migración 11: rollback (sin sus tablas ni su registro), el error trae el respaldo previo y el bloqueo se libera", error?.codigo === "fallo" && error.respaldo === "respaldo-pre-migracion" && respaldos.length === 1 && versiones.join() === "9,10" && !calidad && libre, `${error?.codigo} [${versiones}] calidad=${calidad}`);
  const r = await M.aplicarMigraciones(db, { Sqlite, clave: CLAVE, respaldo: async () => "otro" });
  conexion.close();
  check("  … y al volver a correr termina lo que faltaba", r.aplicadas.map((m) => m.version).join() === M.MIGRACIONES.filter((m) => m.version >= 11).map((m) => m.version).join(), r.aplicadas.map((m) => m.version).join());
}

/* ---------- Checksum y version mayor ---------- */
{
  const archivo = path.join(DIR, "checksum.sqlite3");
  const conexion = new Sqlite(archivo);
  const db = M.adaptadorSqlite(conexion);
  await M.aplicarMigraciones(db, { Sqlite, clave: CLAVE });
  conexion.exec("UPDATE schema_migraciones SET checksum = 'alterado' WHERE version = 11");
  let error = null;
  try {
    await M.estadoMigraciones(db, { Sqlite });
  } catch (e) {
    error = e;
  }
  check("checksum distinto en una migración aplicada: error «la migración 11 cambió después de aplicarse»", error?.codigo === "checksum" && /11/.test(error.message) && /cambió después de aplicarse/.test(error.message), error?.message?.slice(0, 90));
  conexion.exec(`UPDATE schema_migraciones SET checksum = '${M.checksumDe(M.MIGRACIONES.find((m) => m.version === 11))}' WHERE version = 11`);
  conexion.exec(`INSERT INTO schema_migraciones (version, nombre, checksum, aplicada_en) VALUES (${M.VERSION_ACTUAL + 1}, 'del futuro', 'x', '2099-01-01')`);
  error = null;
  try {
    await M.estadoMigraciones(db, { Sqlite });
  } catch (e) {
    error = e;
  }
  conexion.close();
  check("base más nueva que la aplicación: error «actualiza la aplicación»", error?.codigo === "version_mayor" && /actualiza la aplicación/.test(error.message), error?.message?.slice(0, 90));
}

/* ---------- Dos procesos a la vez ---------- */
{
  const archivo = copia("fase9", "concurrente.sqlite3");
  const env = { ...process.env, SQLITE_PATH: archivo, FICOTOX_INSTANCE_DIR: DIR, FICOTOX_BACKUP_DIR: path.join(DIR, "backups-concurrente"), SECRET_KEY: CLAVE, FICOTOX_ENV_FILE: path.join(DIR, "no-existe.env") };
  const correr = () =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [path.join(root, "scripts/migrar-ficotox.mjs")], { cwd: root, env });
      let salida = "";
      p.stdout.on("data", (d) => (salida += d));
      p.stderr.on("data", (d) => (salida += d));
      p.on("exit", (code) => resolve({ code, salida }));
    });
  const [a, b] = await Promise.all([correr(), correr()]);
  const c = new Sqlite(archivo, { readonly: true });
  const entradas = c.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'migrar'").get().n;
  const filas = c.prepare("SELECT COUNT(*) AS n FROM schema_migraciones").get().n;
  c.close();
  const aplico = [a, b].filter((x) => /Base en la versión/.test(x.salida)).length;
  check("dos procesos migrando a la vez: solo uno aplica (el otro espera y encuentra la base al día)", a.code === 0 && b.code === 0 && aplico === 1 && entradas === M.MIGRACIONES.length && filas === M.MIGRACIONES.length, `${a.code}/${b.code} aplicó=${aplico} entradas=${entradas}`);
}

/* ---------- Creacion inicial interrumpida (como en MySQL, donde el DDL de la 0009 se confirma solo) ---------- */
{
  const { ejecutarPasos } = await import("../src/lib/server/migraciones/pasos.mjs");
  const conexion = new Sqlite(path.join(DIR, "interrumpida.sqlite3"));
  const db = M.adaptadorSqlite(conexion);
  await M.crearControl(db);
  await ejecutarPasos(db, "sqlite", M.MIGRACIONES[0].pasos.slice(0, 10));
  const r = await M.aplicarMigraciones(db, { Sqlite, clave: CLAVE, appCommit: "prueba" });
  const dif = M.diferencias(await nueva(), await M.esquemaDe(db));
  // Control: con una tabla ajena, la misma situacion sigue siendo deriva.
  const otra = new Sqlite(path.join(DIR, "interrumpida-ajena.sqlite3"));
  const db2 = M.adaptadorSqlite(otra);
  await M.crearControl(db2);
  await ejecutarPasos(db2, "sqlite", M.MIGRACIONES[0].pasos.slice(0, 10));
  otra.exec("CREATE TABLE ajena (x INTEGER)");
  let error = null;
  try {
    await M.aplicarMigraciones(db2, { Sqlite, clave: CLAVE, appCommit: "prueba" });
  } catch (e) {
    error = e;
  }
  check("creación inicial interrumpida (control sin filas y parte de la 0009): se reanuda y termina igual a una base nueva; con una tabla ajena sigue siendo deriva", r.aplicadas.length === M.MIGRACIONES.length && dif.length === 0 && error?.codigo === "deriva", `${r.aplicadas.map((m) => m.version).join(",")} dif ${dif.length} ${error?.codigo}`);
  conexion.close();
  otra.close();
}

/* ---------- Bloqueo de migracion huerfano de un arranque anterior (corte de luz), con su pid reutilizado ---------- */
{
  const conexion = new Sqlite(copia("fase10", "bloqueo-huerfano.sqlite3"));
  const db = M.adaptadorSqlite(conexion);
  await M.crearControl(db);
  // pid vivo (esta prueba) en este mismo equipo, pero tomado antes del ultimo arranque del sistema.
  conexion.prepare("UPDATE schema_migraciones_bloqueo SET pid = ?, host = ?, desde = ? WHERE id = 1").run(process.pid, (await import("node:os")).hostname(), "2000-01-01T00:00:00.000Z");
  const t0 = Date.now();
  let r = null;
  let error = null;
  try {
    r = await M.aplicarMigraciones(db, { Sqlite, clave: CLAVE, appCommit: "prueba", esperaMs: 5000 });
  } catch (e) {
    error = e;
  }
  const libre = conexion.prepare("SELECT pid FROM schema_migraciones_bloqueo WHERE id = 1").get().pid === null;
  check("bloqueo de migración de antes del arranque del sistema con su pid vivo (reutilizado): se reconoce huérfano y se migra sin esperar", !error && r?.aplicadas.length === M.MIGRACIONES.filter((m) => m.version > 10).length && Date.now() - t0 < 4000 && libre, error?.message || `${Date.now() - t0} ms`);
  conexion.close();
}

/* ---------- Dos respaldos en el mismo segundo (reserva atomica del id) ---------- */
{
  const origen = copia("fase11", "respaldos-simultaneos.sqlite3");
  const destino = path.join(DIR, "respaldos-simultaneos");
  const script = `
    const { crearRespaldo } = await import(${JSON.stringify(path.join(root, "src/lib/shared/respaldo.mjs"))});
    const Sqlite = (await import("better-sqlite3")).default;
    const ahora = new Date("2026-01-02T03:04:05Z");
    while (Date.now() < Number(process.argv[1])) {}
    try {
      const r = await crearRespaldo({ Sqlite, sqlitePath: ${JSON.stringify(origen)}, instanceDir: ${JSON.stringify(DIR)}, respaldosDir: ${JSON.stringify(destino)}, secretKey: ${JSON.stringify(CLAVE)}, baseDir: ${JSON.stringify(root)}, incluirLlave: false, ahora });
      console.log("ID=" + r.id);
    } catch (error) {
      console.log("ERR=" + error.message);
    }`;
  const inicio = Date.now() + 700;
  const correr = () =>
    new Promise((resolve) => {
      const h = spawn(process.execPath, ["--input-type=module", "-e", script, String(inicio)], { cwd: root });
      let out = "";
      h.stdout.on("data", (d) => (out += d));
      h.stderr.on("data", (d) => (out += d));
      h.on("exit", () => resolve(out));
    });
  const salidas = await Promise.all([correr(), correr(), correr()]);
  const ids = salidas.map((o) => (o.match(/ID=(\S+)/) || [])[1]).filter(Boolean);
  const carpetas = fs.existsSync(destino) ? fs.readdirSync(destino).filter((n) => !n.startsWith(".")) : [];
  check("tres respaldos en el mismo segundo (mismo id base): los tres terminan, con ids distintos (-2, -3) y sin carpetas temporales", ids.length === 3 && new Set(ids).size === 3 && carpetas.length === 3 && !fs.readdirSync(destino).some((n) => n.endsWith(".tmp")), `${ids.join(", ")} ${salidas.filter((o) => /ERR=/.test(o)).join(" ")}`);
}

/* ---------- Restaurar respaldos de otra version ---------- */
{
  const instancia = path.join(DIR, "instancia-f10");
  fs.mkdirSync(instancia, { recursive: true });
  const base = path.join(instancia, "ficotox.sqlite3");
  fs.copyFileSync(path.join(root, "tests/fixtures/esquema-anterior-fase10.sqlite3"), base);
  const respaldos = path.join(DIR, "respaldos");
  const resp = await crearRespaldo({ Sqlite, sqlitePath: base, instanceDir: instancia, respaldosDir: respaldos, secretKey: CLAVE, baseDir: root, incluirLlave: true });
  // Como lo guardaba la Fase 10: ESQUEMA_VERSION 10 en el manifest (resellado con la llave).
  const manifest = JSON.parse(fs.readFileSync(path.join(resp.carpeta, "manifest.json"), "utf8"));
  const conVersion = (v) => {
    const m = { ...manifest, esquema_version: v };
    delete m.sello;
    delete m.esquema_app;
    m.sello = sellarManifest(m, CLAVE);
    fs.writeFileSync(path.join(resp.carpeta, "manifest.json"), `${JSON.stringify(m, null, 2)}\n`);
  };
  const restaurar = (destino) => spawnSync(process.execPath, [path.join(root, "scripts/restaurar-ficotox.mjs"), "--respaldo", resp.carpeta, "--destino", destino, "--responsable", "Prueba de migraciones"], { cwd: root, encoding: "utf8", env: { ...process.env, FICOTOX_BACKUP_DIR: respaldos, FICOTOX_INSTANCE_DIR: instancia, SQLITE_PATH: base, SECRET_KEY: CLAVE, FICOTOX_ENV_FILE: path.join(DIR, "no-existe.env") } });
  conVersion(10);
  const destino10 = path.join(DIR, "restaurada-10");
  const r10 = restaurar(destino10);
  let version = null;
  try {
    const c = new Sqlite(path.join(destino10, "ficotox.sqlite3"), { readonly: true });
    version = c.prepare("SELECT MAX(version) AS v FROM schema_migraciones").get().v;
    c.close();
  } catch {
    version = null;
  }
  check("respaldo con ESQUEMA_VERSION 10: se restaura (verificaciones ✅) y la copia queda migrada a la versión actual", r10.status === 0 && version === M.VERSION_ACTUAL && /✅ 3\. Esquema compatible/.test(r10.stdout), `exit ${r10.status} versión ${version} ${(r10.stdout.match(/.*3\. Esquema.*/) || [""])[0].slice(0, 100)}`);
  conVersion(M.VERSION_ACTUAL + 5);
  const rMayor = restaurar(path.join(DIR, "restaurada-mayor"));
  check("respaldo de una versión mayor: se rechaza (verificación 3 ❌, sin migrar)", rMayor.status === 1 && /❌ 3\. Esquema compatible.*más nueva/.test(rMayor.stdout), `exit ${rMayor.status}`);
}

/* ---------- El servidor no arranca con deriva ---------- */
{
  const archivo = copia("fase9", "servidor-deriva.sqlite3");
  const c = new Sqlite(archivo);
  c.exec("ALTER TABLE usuarios ADD COLUMN apodo VARCHAR(40) DEFAULT NULL");
  c.close();
  const antes = sha(archivo);
  const puerto = await new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  const salida = await new Promise((resolve) => {
    // Con build se usa el servidor de produccion (scripts/start-ficotox.mjs): `next dev` no admite un segundo
    // servidor en la misma carpeta mientras corre el de `npm test`. Sin build, `next dev`.
    const conBuild = fs.existsSync(path.join(root, ".next/standalone/server.js"));
    const [cmd, args] = conBuild ? [process.execPath, [path.join(root, "scripts/start-ficotox.mjs")]] : ["npx", ["next", "dev", "-p", String(puerto)]];
    const p = spawn(cmd, args, { cwd: root, detached: true, env: { ...process.env, SQLITE_PATH: archivo, FICOTOX_INSTANCE_DIR: path.join(DIR, "instancia-deriva"), FICOTOX_ENV_FILE: path.join(DIR, "no-existe.env"), SECRET_KEY: CLAVE, JWT_SECRET: "j".repeat(40) + "k".repeat(24), PORT: String(puerto), HOST: "127.0.0.1", FICOTOX_OPEN_BROWSER: "false" } });
    let texto = "";
    const fin = () => {
      try {
        process.kill(-p.pid, "SIGTERM");
      } catch {
        /* ya salio */
      }
      resolve(texto);
    };
    p.stdout.on("data", (d) => (texto += d));
    p.stderr.on("data", (d) => (texto += d));
    p.on("exit", fin);
    // Una peticion dispara la compilacion si hiciera falta; el arranque ya debio fallar.
    setTimeout(() => fetch(`http://localhost:${puerto}/api/health`).catch(() => null), 6000);
    setTimeout(fin, 40_000);
  });
  check("el servidor no arranca con deriva de esquema: mensaje claro y la base sin tocar", /FICOTOX no arranca/.test(salida) && /usuarios\.apodo/.test(salida) && sha(archivo) === antes, salida.split("\n").find((l) => /migraciones/.test(l))?.slice(0, 120) || salida.slice(-200));
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
