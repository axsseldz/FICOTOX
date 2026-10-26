/*
 * Fase 12 · instalacion y operacion (scripts de npm; carpetas temporales en
 * instance/test/operacion/, nunca la instancia real ni el .env del repositorio):
 * - configurar: genera JWT_SECRET y SECRET_KEY en una instalacion nueva, permisos
 *   600, no imprime secretos, es idempotente, NUNCA cambia una SECRET_KEY existente
 *   y no genera llave si ya hay una base sellada sin llave;
 * - instancia-nueva: sin --confirmar no hace nada; con --confirmar mueve (no
 *   borra) la instancia y su llave, crea la base con las migraciones y las dos
 *   cuentas con contrasena temporal, sin autorizaciones de ejemplo, todo como
 *   "sistema" y con la cadena integra; se niega con el servidor encendido;
 * - servicio: definiciones para Windows/macOS/Linux; mensaje claro sin permisos;
 * - lanzador: puerto ocupado -> mensaje claro; HTTPS con TLS_CERT/TLS_KEY; registros
 *   en <instancia>/logs sin datos sensibles; rotacion y retencion;
 * - actualizar: build fallido -> build anterior devuelto y el servidor arrancado como estaba;
 * - verificar-instalacion: ✅ en una instancia nueva, ❌ con cuentas de
 *   demostracion o llave distinta de la registrada; reporte en <instancia>/verificaciones.
 * Las pruebas con servidor usan el build standalone (npm run build); sin build se omiten.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION_ACTUAL } from "../src/lib/server/migraciones/motor.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const Sqlite = require("better-sqlite3");
const { evaluarCadena } = await import("../src/lib/shared/audit-chain.mjs");
const { huellaLlave } = await import("../src/lib/shared/respaldo.mjs");
const { enmascarar, RegistroRotativo } = await import("../scripts/lib/registro.mjs");
const { esperarSalud, servidorEncendido } = await import("../scripts/lib/operacion.mjs");

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 220)}` : ""}`);
};
const DIR = path.join(root, "instance/test/operacion");
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const hayBuild = fs.existsSync(path.join(root, ".next/standalone/server.js"));

/* Entorno aislado: un .env propio (FICOTOX_ENV_FILE) y nada heredado que apunte a la instancia real. */
const LIMPIAR = ["SQLITE_PATH", "DATABASE_URL", "FICOTOX_INSTANCE_DIR", "FICOTOX_BACKUP_DIR", "SECRET_KEY", "JWT_SECRET", "PORT", "HOST", "TLS_CERT", "TLS_KEY", "LOG_DIR", "ALLOWED_EMAIL_DOMAINS", "CORS_ORIGINS"];
const entornoBase = () => {
  const env = { ...process.env, FICOTOX_OPEN_BROWSER: "false", FICOTOX_PRUEBAS: "1", FICOTOX_PRUEBA_SERVICIO: "no" };
  for (const k of LIMPIAR) delete env[k];
  return env;
};
const nodo = (script, args = [], env = {}) => {
  const r = spawnSync(process.execPath, [path.join(root, script), ...args], { cwd: root, encoding: "utf8", env: { ...entornoBase(), ...env }, timeout: 300_000 });
  return { codigo: r.status, salida: `${r.stdout || ""}${r.stderr || ""}` };
};
// Asincrono: cuando el script detiene un lanzador que es hijo de ESTA prueba, la prueba debe poder
// recoger su salida (con spawnSync el hijo muerto queda como zombi y parece vivo).
const nodoAsync = (script, args = [], env = {}) =>
  new Promise((resolve) => {
    const h = spawn(process.execPath, [path.join(root, script), ...args], { cwd: root, env: { ...entornoBase(), ...env } });
    let salida = "";
    h.stdout.on("data", (d) => (salida += d));
    h.stderr.on("data", (d) => (salida += d));
    h.on("exit", (codigo) => resolve({ codigo, salida }));
  });
const leerEnv = (archivo) => Object.fromEntries(fs.readFileSync(archivo, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const puertoLibre = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
/* Instalacion de prueba: carpeta con .env, instancia y respaldos propios. */
const instalacion = (nombre, extra = "") => {
  const dir = path.join(DIR, nombre);
  fs.mkdirSync(dir, { recursive: true });
  const env = path.join(dir, ".env");
  fs.writeFileSync(env, [`SQLITE_PATH=${dir}/instance/ficotox.sqlite3`, `FICOTOX_INSTANCE_DIR=${dir}/instance`, `FICOTOX_BACKUP_DIR=${dir}/backups`, "ALLOWED_EMAIL_DOMAINS=cicese.mx", extra].filter(Boolean).join("\n") + "\n");
  return { dir, env, instancia: path.join(dir, "instance"), base: path.join(dir, "instance/ficotox.sqlite3"), respaldos: path.join(dir, "backups") };
};
const CUENTAS = ["--no-interactivo", "--admin-nombre", "Ana Técnica", "--admin-correo", "ana@cicese.mx", "--rg-nombre", "Rosa General", "--rg-correo", "rosa@cicese.mx"];

/* ---------- configurar ---------- */
{
  const inst = instalacion("configurar");
  fs.rmSync(inst.env);
  const r = nodo("scripts/configurar-ficotox.mjs", ["--no-interactivo", "--env", inst.env, "--instancia", inst.instancia, "--puerto", "5055", "--dominios", "cicese.mx"]);
  const v = fs.existsSync(inst.env) ? leerEnv(inst.env) : {};
  const modo = fs.existsSync(inst.env) ? fs.statSync(inst.env).mode & 0o777 : null;
  check("configurar (instalación nueva): genera JWT_SECRET (64) y SECRET_KEY, fija puerto/dominios/instancia, permisos 600", r.codigo === 0 && v.JWT_SECRET?.length === 64 && v.SECRET_KEY?.length === 64 && v.PORT === "5055" && v.FICOTOX_INSTANCE_DIR === inst.instancia && (process.platform === "win32" || modo === 0o600), `exit ${r.codigo} modo ${modo?.toString(8)}`);
  check("  … no imprime los secretos completos y registra la huella (no la llave) en la instancia", !r.salida.includes(v.JWT_SECRET) && !r.salida.includes(v.SECRET_KEY) && fs.readFileSync(path.join(inst.instancia, "llave-bitacora.huella"), "utf8").trim() === huellaLlave(v.SECRET_KEY), r.salida.match(/huella [0-9a-f]+…/)?.[0]);
  const antes = fs.readFileSync(inst.env, "utf8");
  const r2 = nodo("scripts/configurar-ficotox.mjs", ["--no-interactivo", "--env", inst.env]);
  check("configurar otra vez: idempotente (sin cambios; la SECRET_KEY no cambia)", r2.codigo === 0 && fs.readFileSync(inst.env, "utf8") === antes && /Sin cambios/.test(r2.salida), r2.salida.split("\n").slice(-4).join(" "));
  // Instalacion recien configurada (la instancia solo tiene la huella): instancia-nueva no "mueve" nada ni copia la llave.
  fs.appendFileSync(inst.env, `FICOTOX_BACKUP_DIR=${inst.respaldos}\n`);
  const rn = nodo("scripts/instancia-nueva-ficotox.mjs", ["--confirmar", ...CUENTAS], { FICOTOX_ENV_FILE: inst.env });
  check("instancia-nueva en una instalación recién configurada: crea la base sin mover nada (no hay instancia anterior ni copia de la llave)", rn.codigo === 0 && !fs.existsSync(inst.respaldos) && fs.existsSync(path.join(inst.instancia, "ficotox.sqlite3")) && !/movida/.test(rn.salida), `exit ${rn.codigo} ${fs.existsSync(inst.respaldos) ? "¡se creó backups!" : ""}`);

  // SECRET_KEY existente (aunque sea corta) y JWT debil: la llave se conserva, el JWT se reemplaza.
  const otra = instalacion("configurar-existente", "SECRET_KEY=llave-que-ya-sellaba\nJWT_SECRET=corto\n# comentario que se conserva");
  const r3 = nodo("scripts/configurar-ficotox.mjs", ["--no-interactivo", "--env", otra.env]);
  const v3 = leerEnv(otra.env);
  check("configurar NUNCA cambia una SECRET_KEY existente; reemplaza un JWT_SECRET débil y conserva el resto del .env", r3.codigo === 0 && v3.SECRET_KEY === "llave-que-ya-sellaba" && v3.JWT_SECRET.length === 64 && fs.readFileSync(otra.env, "utf8").includes("# comentario que se conserva"), r3.salida.match(/SECRET_KEY:[^\n]*/)?.[0]);

  // Base existente sin llave: no se genera una (romperia la verificacion de lo sellado).
  const sinLlave = instalacion("configurar-base-sin-llave");
  fs.mkdirSync(sinLlave.instancia, { recursive: true });
  new Sqlite(sinLlave.base).close();
  const r4 = nodo("scripts/configurar-ficotox.mjs", ["--no-interactivo", "--env", sinLlave.env]);
  check("configurar con una base existente sin llave: avisa y no genera SECRET_KEY", r4.codigo === 0 && !leerEnv(sinLlave.env).SECRET_KEY && /No se genera una llave nueva/.test(r4.salida));
}

// SQLITE_PATH fuera de instance/ con su auditoria.key al lado (instalacion anterior): no se reapunta ni se genera llave.
{
  const inst = instalacion("configurar-sqlite-fuera");
  const datos = path.join(inst.dir, "datos");
  fs.mkdirSync(datos, { recursive: true });
  new Sqlite(path.join(datos, "ficotox.sqlite3")).close();
  fs.writeFileSync(path.join(datos, "auditoria.key"), `${"f".repeat(64)}\n`);
  fs.writeFileSync(inst.env, `SQLITE_PATH=${datos}/ficotox.sqlite3\n`);
  const r = nodo("scripts/configurar-ficotox.mjs", ["--no-interactivo", "--env", inst.env]);
  const v = leerEnv(inst.env);
  check("configurar con SQLITE_PATH fuera de instance/ y su auditoria.key al lado: no reapunta la base ni genera SECRET_KEY (instancia = carpeta de la base)", r.codigo === 0 && v.SQLITE_PATH === `${datos}/ficotox.sqlite3` && !v.SECRET_KEY && v.FICOTOX_INSTANCE_DIR === datos && /ya sella con/.test(r.salida), `${v.SQLITE_PATH} ${v.FICOTOX_INSTANCE_DIR} ${v.SECRET_KEY ? "SECRET_KEY nueva!" : "sin SECRET_KEY"}`);
}

/* ---------- instancia-nueva ---------- */
const nuevaInst = instalacion("instancia", `SECRET_KEY=${"b".repeat(64)}\nJWT_SECRET=${"c".repeat(20)}${"d".repeat(44)}`);
{
  fs.mkdirSync(nuevaInst.instancia, { recursive: true });
  fs.writeFileSync(path.join(nuevaInst.instancia, "dato-demo.txt"), "no se borra");
  new Sqlite(nuevaInst.base).exec("CREATE TABLE demo (x); INSERT INTO demo VALUES (1)");
  const r0 = nodo("scripts/instancia-nueva-ficotox.mjs", CUENTAS, { FICOTOX_ENV_FILE: nuevaInst.env });
  check("instancia-nueva sin --confirmar: no hace nada (exit 2) y lo dice", r0.codigo === 2 && fs.existsSync(path.join(nuevaInst.instancia, "dato-demo.txt")) && !fs.existsSync(nuevaInst.respaldos) && /No se hizo ningún cambio/.test(r0.salida), `exit ${r0.codigo}`);

  // Servidor encendido (servidor.lock con un pid vivo): se niega.
  fs.writeFileSync(path.join(nuevaInst.instancia, "servidor.lock"), JSON.stringify({ pid: process.pid }));
  const r1 = nodo("scripts/instancia-nueva-ficotox.mjs", ["--confirmar", ...CUENTAS], { FICOTOX_ENV_FILE: nuevaInst.env });
  check("instancia-nueva con el servidor encendido: se niega (exit 2) sin mover nada", r1.codigo === 2 && fs.existsSync(path.join(nuevaInst.instancia, "dato-demo.txt")) && /servidor está encendido/.test(r1.salida), `exit ${r1.codigo}`);
  fs.rmSync(path.join(nuevaInst.instancia, "servidor.lock"));

  const rDemo = nodo("scripts/instancia-nueva-ficotox.mjs", ["--confirmar", "--no-interactivo", "--admin-nombre", "X", "--admin-correo", "admin@ficotox.local", "--rg-nombre", "Y", "--rg-correo", "rosa@cicese.mx"], { FICOTOX_ENV_FILE: nuevaInst.env, ALLOWED_EMAIL_DOMAINS: "cicese.mx,ficotox.local" });
  check("instancia-nueva rechaza correos @ficotox.local (demostración) sin mover nada", rDemo.codigo === 2 && fs.existsSync(path.join(nuevaInst.instancia, "dato-demo.txt")), rDemo.salida.trim().split("\n").pop());

  const r = nodo("scripts/instancia-nueva-ficotox.mjs", ["--confirmar", ...CUENTAS], { FICOTOX_ENV_FILE: nuevaInst.env });
  const movida = fs.existsSync(nuevaInst.respaldos) ? fs.readdirSync(nuevaInst.respaldos).find((n) => n.startsWith("pre-produccion-")) : null;
  const dirMovida = movida ? path.join(nuevaInst.respaldos, movida) : "";
  check(
    "instancia-nueva --confirmar: MUEVE la instancia anterior (base y archivos intactos) y su llave a backups/pre-produccion-<fecha>/",
    r.codigo === 0 && movida && fs.readFileSync(path.join(dirMovida, "instance/dato-demo.txt"), "utf8") === "no se borra" && new Sqlite(path.join(dirMovida, "instance/ficotox.sqlite3")).prepare("SELECT x FROM demo").get()?.x === 1 && fs.readFileSync(path.join(dirMovida, "llave-bitacora.txt"), "utf8").trim() === "b".repeat(64) && fs.existsSync(path.join(dirMovida, "LEEME.txt")),
    `exit ${r.codigo} ${movida}`,
  );
  const db = new Sqlite(nuevaInst.base, { readonly: true });
  const usuarios = db.prepare("SELECT email, debe_cambiar_password AS d FROM usuarios ORDER BY id").all();
  const roles = db.prepare("SELECT u.email, r.nombre FROM usuario_roles ur JOIN usuarios u ON u.id = ur.usuario_id JOIN roles r ON r.id = ur.rol_id").all();
  const version = db.prepare("SELECT MAX(version) AS v FROM schema_migraciones").get().v;
  check("  … base nueva con las migraciones (versión actual) y el catálogo de roles; solo las dos cuentas, con cambio de contraseña obligatorio", version === VERSION_ACTUAL && db.prepare("SELECT COUNT(*) AS n FROM roles").get().n === 10 && usuarios.length === 2 && usuarios.every((u) => u.d === 1) && roles.some((x) => x.email === "ana@cicese.mx" && x.nombre === "Administrador técnico del sistema") && roles.some((x) => x.email === "rosa@cicese.mx" && x.nombre === "Responsable General"), JSON.stringify(roles));
  const vacias = ["autorizaciones_personal", "reactivos", "consumibles", "recepciones", "documentos_sgc", "biblioteca_documentos"].filter((t) => db.prepare(`SELECT name FROM sqlite_master WHERE name = ?`).get(t)).map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]);
  check("  … sin datos de demostración ni autorizaciones de ejemplo", vacias.every(([, n]) => n === 0), JSON.stringify(vacias));
  const filas = db.prepare("SELECT * FROM auditoria ORDER BY id").all();
  const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'auditoria'").get();
  const cadena = evaluarCadena(filas, "b".repeat(64), seq ? Number(seq.seq) : null, 2);
  check("  … todo en la bitácora como «sistema» (migraciones, roles, cuentas, instancia) y la cadena íntegra con la llave", cadena.ok && filas.length > 10 && filas.every((f) => f.usuario_nombre === "sistema" && f.usuario_id === null) && filas.some((f) => f.entidad === "esquema") && filas.some((f) => f.entidad === "instancia"), `${filas.length} entradas ${JSON.stringify(cadena)}`);
  db.close();
  const temporales = r.salida.match(/→\s+(\S+)/g) || [];
  check("  … contraseñas temporales mostradas una vez (distintas, fuertes) y sin quedar en disco", temporales.length === 2 && new Set(temporales).size === 2 && temporales.every((t) => t.length > 20) && !fs.readdirSync(nuevaInst.instancia).some((n) => /usuarios\.json/.test(n)));
  // Inicio de sesion con la temporal: debe cambiarla (se prueba con el servidor mas abajo).
  nuevaInst.temporalAna = temporales[0]?.replace(/→\s+/, "");
}

/* ---------- sqlite-a-mysql --simular ---------- */
{
  const r = nodo("scripts/sqlite-a-mysql.mjs", ["--simular"], { FICOTOX_ENV_FILE: nuevaInst.env });
  const sinDestino = nodo("scripts/sqlite-a-mysql.mjs", [], { FICOTOX_ENV_FILE: nuevaInst.env });
  check("sqlite-a-mysql --simular: revisa versión, conteos y bitácora sin cambiar nada; sin --destino/--confirmar no hace nada", r.codigo === 0 && /versión \d+;.*íntegra/.test(r.salida) && /No se cambió nada/.test(r.salida) && sinDestino.codigo === 2, r.salida.split("\n")[0]);
}

/* ---------- actualizar con una migracion que falla despues de otra que si se aplica ---------- */
{
  const inst = instalacion("actualizar-migracion-a-medias", `SECRET_KEY=${"m".repeat(64)}\nJWT_SECRET=${"n".repeat(64)}`);
  fs.mkdirSync(inst.instancia, { recursive: true });
  fs.copyFileSync(path.join(root, "tests/fixtures/esquema-anterior-fase10.sqlite3"), inst.base);
  const build = path.join(DIR, "build-migracion-a-medias");
  fs.mkdirSync(path.join(build, ".next/standalone"), { recursive: true });
  fs.writeFileSync(path.join(build, ".next/standalone/server.js"), "// build anterior\n");
  const r = nodo("scripts/actualizar-ficotox.mjs", [], { FICOTOX_ENV_FILE: inst.env, FICOTOX_PRUEBA_DIR_BUILD: build, FICOTOX_PRUEBA_COMANDO_INSTALAR: "true", FICOTOX_PRUEBA_COMANDO_BUILD: `mkdir -p '${build}/.next/standalone' && echo nuevo > '${build}/.next/standalone/server.js'`, FICOTOX_PRUEBA_FALLAR_MIGRACION: "12" });
  const version = new Sqlite(inst.base, { readonly: true }).prepare("SELECT MAX(version) AS v FROM schema_migraciones").get().v;
  check("actualizar con una migración que falla después de aplicar otra: dice la verdad (versión en que quedó la base y cómo restaurar) y no arranca un build que no sirve", r.codigo === 1 && version === 11 && /SÍ quedaron aplicadas/.test(r.salida) && /npm run restaurar -- --respaldo \d{8}-\d{6}/.test(r.salida) && !servidorEncendido(inst.instancia), `exit ${r.codigo} versión ${version}`);
}

/* ---------- servicio ---------- */
{
  for (const [plat, busca] of [["win32", /BootTrigger[\s\S]*RestartOnFailure[\s\S]*<Count>999/], ["darwin", /RunAtLoad[\s\S]*KeepAlive[\s\S]*Crashed/], ["linux", /Restart=on-failure[\s\S]*WantedBy=multi-user.target/]]) {
    const inst = instalacion(`servicio-${plat}`);
    const r = nodo("scripts/servicio-ficotox.mjs", ["instalar", ...(plat === "win32" ? ["--simular"] : [])], { FICOTOX_ENV_FILE: inst.env, FICOTOX_PLATAFORMA_PRUEBA: plat });
    const carpeta = path.join(inst.instancia, "servicio");
    const archivos = fs.existsSync(carpeta) ? fs.readdirSync(carpeta) : [];
    const contenido = archivos.map((a) => fs.readFileSync(path.join(carpeta, a), a.endsWith(".xml") ? "utf16le" : "utf8")).join("\n");
    const ok = plat === "win32" ? r.codigo === 0 && /schtasks \/Create \/TN FICOTOX \/XML/.test(r.salida) && /netsh advfirewall firewall add rule name=FICOTOX dir=in action=allow protocol=TCP localport=\d+ profile=private,domain/.test(r.salida) && archivos.length === 0 : r.codigo === 0 && busca.test(contenido) && contenido.includes("start-ficotox.mjs") && contenido.includes("FICOTOX_OPEN_BROWSER");
    check(`servicio (${plat}): ${plat === "win32" ? "tarea al iniciar el sistema con reintentos + regla de firewall (simulación)" : "definición con arranque automático y reinicio"}`, ok, r.salida.split("\n").filter((l) => l.startsWith("$") || /sudo/.test(l))[0]);
  }
  // Windows sin permisos de administrador: mensaje claro (schtasks falso que responde "Access is denied").
  const falsos = path.join(DIR, "bin-falsos");
  fs.mkdirSync(falsos, { recursive: true });
  fs.writeFileSync(path.join(falsos, "schtasks"), "#!/bin/sh\necho 'ERROR: Access is denied.' >&2\nexit 1\n", { mode: 0o755 });
  fs.writeFileSync(path.join(falsos, "netsh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const inst = instalacion("servicio-sin-permiso");
  const r = nodo("scripts/servicio-ficotox.mjs", ["instalar"], { FICOTOX_ENV_FILE: inst.env, FICOTOX_PLATAFORMA_PRUEBA: "win32", PATH: `${falsos}${path.delimiter}${process.env.PATH}` });
  check("servicio sin permisos de administrador: mensaje claro («Ejecutar como administrador») y exit 1", r.codigo === 1 && /Ejecutar como administrador/.test(r.salida), r.salida.trim().split("\n").pop());
}

/* ---------- registros: enmascarado, rotacion, retencion ---------- */
{
  const linea = enmascarar('POST /api/auth/login {"email":"jorge.perez@cicese.mx","password":"Secreta#123"} Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijk SECRET_KEY=abc123');
  check("registros: se enmascaran correos, contraseñas, tokens y llaves", !/jorge\.perez|Secreta#123|eyJhbGci|abc123/.test(linea) && /j\*\*\*@cicese\.mx/.test(linea), linea);
  const dir = path.join(DIR, "logs");
  fs.mkdirSync(dir, { recursive: true });
  const viejo = path.join(dir, "ficotox-2020-01-01.log");
  fs.writeFileSync(viejo, "viejo\n");
  fs.utimesSync(viejo, new Date("2020-01-02"), new Date("2020-01-02"));
  const reg = new RegistroRotativo({ dir, maxMb: 1, retencionDias: 30 });
  const grande = "x".repeat(1000);
  for (let i = 0; i < 1300; i++) reg.escribir(grande);
  const nombres = fs.readdirSync(dir);
  check("registros: rotan al pasar LOG_MAX_MB y se quitan los de más de LOG_RETENCION_DIAS", !nombres.includes("ficotox-2020-01-01.log") && nombres.some((n) => /\.log\.1$/.test(n)), nombres.join(", "));
}

/* ---------- datos de demostración: las cuentas se encuentran por una palabra del nombre ---------- */
{
  // Con el archivo de ejemplo ("Ana Sofía Torres Vega"...) el script debe resolver las cinco cuentas y solo
  // fallar despues, al conectarse (aqui a un puerto sin servidor), no con "Falta la cuenta de sofía".
  const r = nodo("scripts/sembrar-demo-documentos.mjs", ["--url", "http://127.0.0.1:9", "--usuarios", "scripts/seed-usuarios.example.json"]);
  check("demo de documentos: encuentra las cuentas por una palabra del nombre y sin acentos (archivo de ejemplo)", r.codigo !== 0 && !/Falta la cuenta/.test(r.salida), r.salida.split("\n").filter(Boolean).slice(-2).join(" | "));
}

/* ---------- con servidor (build standalone) ---------- */
const hijos = [];
const arrancar = (envArchivo, extra = {}) => {
  const hijo = spawn(process.execPath, [path.join(root, "scripts/start-ficotox.mjs")], { cwd: root, env: { ...entornoBase(), FICOTOX_ENV_FILE: envArchivo, ...extra }, stdio: ["ignore", "pipe", "pipe"] });
  let salida = "";
  hijo.stdout.on("data", (d) => (salida += d));
  hijo.stderr.on("data", (d) => (salida += d));
  hijos.push(hijo);
  return { hijo, salida: () => salida, fin: new Promise((r) => hijo.on("exit", (c, senal) => r(c ?? senal))) };
};
const detener = async (instancia) => {
  const vivo = servidorEncendido(instancia);
  if (vivo) process.kill(Number(vivo.pid), "SIGTERM");
  for (let i = 0; i < 40 && servidorEncendido(instancia); i++) await new Promise((r) => setTimeout(r, 250));
};
try {
  if (!hayBuild) console.log("(sin build standalone: pruebas con servidor omitidas; ejecuta npm run build)");
  else {
    // Puerto ocupado: mensaje claro, sin arrancar.
    {
      const ocupado = net.createServer();
      const puerto = await puertoLibre();
      await new Promise((r) => ocupado.listen(puerto, "127.0.0.1", r));
      const inst = instalacion("puerto-ocupado", `JWT_SECRET=${"e".repeat(64)}\nHOST=127.0.0.1\nPORT=${puerto}`);
      const s = arrancar(inst.env);
      const codigo = await s.fin;
      ocupado.close();
      check("lanzador con el puerto ocupado: no arranca (exit 78, sin reintentos) y explica («ya está en uso»; cambiar PORT)", codigo === 78 && /ya está en uso/.test(s.salida()) && /PORT/.test(s.salida()), s.salida().trim().split("\n").pop());
    }

    // Bloqueo huerfano de un arranque anterior del sistema cuyo pid ahora es de OTRO proceso vivo (esta prueba):
    // en Windows los pid se reutilizan; se reconoce por la hora de arranque del sistema y el servidor si arranca.
    {
      const puerto = await puertoLibre();
      const inst = instalacion("bloqueo-huerfano", `JWT_SECRET=${"h".repeat(64)}\nSECRET_KEY=${"i".repeat(64)}\nHOST=127.0.0.1\nPORT=${puerto}`);
      fs.mkdirSync(inst.instancia, { recursive: true });
      for (const f of ["servidor.lock", "lanzador.lock"]) fs.writeFileSync(path.join(inst.instancia, f), JSON.stringify({ pid: process.pid, puerto: "5000", iniciado_en: "2000-01-01T00:00:00.000Z" }));
      const s0 = arrancar(inst.env);
      const salud = await esperarSalud({ PORT: String(puerto) }, 90);
      check("bloqueo huérfano (anterior al arranque del sistema) con su pid reutilizado por otro proceso: el servidor sí arranca", salud.ok && servidorEncendido(inst.instancia)?.pid !== process.pid, salud.ok ? "arrancó" : s0.salida().trim().split("\n").pop());
      await nodoAsync("scripts/detener-ficotox.mjs", [], { FICOTOX_ENV_FILE: inst.env });
      await s0.fin;
    }

    // Instancia nueva + HTTPS + registros + cambio de contrasena obligatorio.
    const openssl = spawnSync("openssl", ["version"]).status === 0;
    const puerto = await puertoLibre();
    let tls = "";
    const cert = path.join(nuevaInst.dir, "cert.pem");
    if (openssl) {
      const key = path.join(nuevaInst.dir, "key.pem");
      spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "30", "-subj", "/CN=localhost"], { stdio: "ignore" });
      tls = `\nTLS_CERT=${cert}\nTLS_KEY=${key}`;
    }
    fs.appendFileSync(nuevaInst.env, `HOST=127.0.0.1\nPORT=${puerto}${tls}\n`);
    const envHttps = { PORT: String(puerto), TLS_CERT: openssl ? cert : "" };
    const s = arrancar(nuevaInst.env);
    const salud = await esperarSalud(envHttps, 90);
    check(`servidor sobre la instancia nueva${openssl ? " con HTTPS (TLS_CERT/TLS_KEY)" : " (HTTP; sin openssl para probar HTTPS)"} responde /api/health/db`, salud.ok && salud.url.startsWith(openssl ? "https" : "http"), `${salud.url} ${salud.ultimo || ""}`);
    if (salud.ok) {
      // Inicio de sesion con la contrasena temporal (se confia solo en el certificado de prueba, emitido para localhost).
      const https = await import("node:https");
      const http = await import("node:http");
      const pedir = (ruta, cuerpo) =>
        new Promise((resolve, reject) => {
          const req = (openssl ? https : http).request(`${salud.url.replace("/api/health/db", ruta)}`, { method: "POST", ...(openssl ? { ca: fs.readFileSync(cert), servername: "localhost" } : {}), headers: { "content-type": "application/json" } }, (res) => {
            let t = "";
            res.on("data", (d) => (t += d));
            res.on("end", () => resolve({ status: res.statusCode, cuerpo: t }));
          });
          req.on("error", reject);
          req.end(JSON.stringify(cuerpo));
        });
      const login = await pedir("/api/auth/login", { email: "ana@cicese.mx", password: nuevaInst.temporalAna });
      check("  … la cuenta nueva entra con la contraseña temporal y el servidor exige cambiarla", login.status === 200 && /debe_cambiar_password"\s*:\s*true/.test(login.cuerpo), `${login.status} ${login.cuerpo.slice(0, 120)}`);
      await pedir("/api/auth/login", { email: "ana@cicese.mx", password: "Contrasena-Incorrecta-1" });
      await new Promise((r) => setTimeout(r, 500));
      const logs = path.join(nuevaInst.instancia, "logs");
      const texto = fs.existsSync(logs) ? fs.readdirSync(logs).map((n) => fs.readFileSync(path.join(logs, n), "utf8")).join("") : "";
      check("  … registros en <instancia>/logs (arranque y esquema) sin contraseñas ni correos completos", /FICOTOX escuchando en/.test(texto) && !texto.includes(nuevaInst.temporalAna) && !texto.includes("Contrasena-Incorrecta-1") && !texto.includes("ana@cicese.mx"), `${texto.length} bytes`);

      // Caida del servidor (SIGKILL, como falta de memoria): el lanzador lo relanza solo.
      const pidCaido = servidorEncendido(nuevaInst.instancia)?.pid;
      process.kill(Number(pidCaido), "SIGKILL");
      await new Promise((r) => setTimeout(r, 1500));
      const tras = await esperarSalud(envHttps, 60);
      const pidNuevo = servidorEncendido(nuevaInst.instancia)?.pid;
      check("  … si el servidor se cae, el lanzador lo relanza (espera creciente) y vuelve a responder", tras.ok && pidNuevo && pidNuevo !== pidCaido && /se detuvo inesperadamente/.test(s.salida()), `pid ${pidCaido}→${pidNuevo}`);
      // Un segundo lanzador sobre la misma instancia no arranca (ni pisa servidor.lock).
      const segundo = arrancar(nuevaInst.env, { PORT: String(await puertoLibre()) });
      const codigoSegundo = await segundo.fin;
      check("  … un segundo servidor sobre la misma instancia no arranca (exit 78, «ya hay un servidor») y el bloqueo sigue siendo del primero", codigoSegundo === 78 && /ya hay un (servidor|lanzador)/.test(segundo.salida()) && servidorEncendido(nuevaInst.instancia)?.pid === pidNuevo, `exit ${codigoSegundo}`);
      // Llave adoptada en el .env (configuracion inicial): si el servidor se cae despues, el relanzamiento usa la SECRET_KEY
      // del archivo y no la que leyo el lanzador al arrancar. Se cambia y se devuelve (sin peticiones de por medio).
      const original = fs.readFileSync(nuevaInst.env, "utf8");
      const relanzarCon = async (llave) => {
        fs.writeFileSync(nuevaInst.env, original.replace(/^SECRET_KEY=.*$/m, `SECRET_KEY=${llave}`));
        process.kill(Number(servidorEncendido(nuevaInst.instancia)?.pid), "SIGKILL");
        await new Promise((r) => setTimeout(r, 1500));
        return (await esperarSalud(envHttps, 90)).ok;
      };
      const huella = (llave) => createHash("sha256").update(llave).digest("hex").slice(0, 12);
      const conNueva = await relanzarCon("e".repeat(64));
      const avisoNueva = s.salida().includes(`SECRET_KEY cambió en ${path.basename(nuevaInst.env)}`) && s.salida().includes(huella("e".repeat(64)));
      const conOriginal = await relanzarCon("b".repeat(64));
      fs.writeFileSync(nuevaInst.env, original);
      check("  … si SECRET_KEY cambió en el .env (llave adoptada), el servidor relanzado usa la del archivo", conNueva && avisoNueva && conOriginal && s.salida().includes(huella("b".repeat(64))), `${conNueva} ${avisoNueva} ${conOriginal}`);

      // verificar-instalacion sobre esta instancia (encendida): sin ❌.
      const v = nodo("scripts/verificar-instalacion.mjs", [], { FICOTOX_ENV_FILE: nuevaInst.env });
      const reportes = fs.existsSync(path.join(nuevaInst.instancia, "verificaciones")) ? fs.readdirSync(path.join(nuevaInst.instancia, "verificaciones")) : [];
      check("verificar-instalacion en la instancia nueva: sin ❌ (exit 0), reporte en <instancia>/verificaciones y sin secretos en pantalla", v.codigo === 0 && reportes.length === 1 && !v.salida.includes("b".repeat(64)) && /Integridad de la bitácora: \d+ entradas, cadena íntegra/.test(v.salida) && /Cuentas de administración: usuarios:G: 1 · usuarios:A: 1/.test(v.salida), v.salida.split("\n").filter((l) => l.startsWith("❌")).join(" | ") || v.salida.split("\n").slice(-3).join(" "));

      // actualizar con build fallido: se devuelve el build anterior y el servidor vuelve a arrancar.
      const build = path.join(DIR, "build-actualizar");
      fs.mkdirSync(path.join(build, ".next/standalone"), { recursive: true });
      fs.writeFileSync(path.join(build, ".next/standalone/server.js"), "// build anterior\n");
      const pidAntes = servidorEncendido(nuevaInst.instancia)?.pid;
      const a = await nodoAsync("scripts/actualizar-ficotox.mjs", [], { FICOTOX_ENV_FILE: nuevaInst.env, FICOTOX_PRUEBA_DIR_BUILD: build, FICOTOX_PRUEBA_COMANDO_INSTALAR: "true", FICOTOX_PRUEBA_COMANDO_BUILD: `mkdir -p '${build}/.next' && echo roto > '${build}/.next/parcial' && exit 3` });
      const pidDespues = servidorEncendido(nuevaInst.instancia)?.pid;
      const salud2 = await esperarSalud(envHttps, 60);
      const version = new Sqlite(nuevaInst.base, { readonly: true }).prepare("SELECT MAX(version) AS v FROM schema_migraciones").get().v;
      check(
        "actualizar con build fallido: exit 1, build anterior devuelto, base sin tocar y el servidor arrancado como estaba",
        a.codigo === 1 && fs.readFileSync(path.join(build, ".next/standalone/server.js"), "utf8") === "// build anterior\n" && !fs.existsSync(path.join(build, ".next/parcial")) && !fs.existsSync(path.join(build, ".next-anterior")) && version === VERSION_ACTUAL && salud2.ok && pidDespues && pidDespues !== pidAntes && /respaldo/i.test(a.salida),
        `exit ${a.codigo} pid ${pidAntes}→${pidDespues} salud ${salud2.ok}`,
      );

      // Detener y reiniciar (Fase 12, ronda 2): se detiene al LANZADOR, no solo al servidor.
      const lanzadorDe = () => {
        try {
          return JSON.parse(fs.readFileSync(path.join(nuevaInst.instancia, "lanzador.lock"), "utf8")).pid;
        } catch {
          return null;
        }
      };
      const vive = (pid) => {
        try {
          process.kill(Number(pid), 0);
          return true;
        } catch {
          return false;
        }
      };
      const re = nodo("scripts/detener-ficotox.mjs", ["--reiniciar"], { FICOTOX_ENV_FILE: nuevaInst.env });
      const pidRe = servidorEncendido(nuevaInst.instancia)?.pid;
      check("npm run reiniciar: detiene lanzador y servidor y vuelve a arrancar (responde /api/health/db)", re.codigo === 0 && pidRe && pidRe !== pidDespues && (await esperarSalud(envHttps, 30)).ok, `${re.codigo} ${re.salida.trim().split("\n").pop()}`);

      // Con la senal de parada presente, una salida sin SIGTERM (como TerminateProcess en Windows: codigo 1) no se relanza.
      const lanzadorAntes = lanzadorDe();
      fs.writeFileSync(path.join(nuevaInst.instancia, "detener"), "prueba\n");
      process.kill(Number(pidRe), "SIGKILL");
      await new Promise((r) => setTimeout(r, 7000));
      check("con <instancia>/detener, una salida del servidor sin SIGTERM no se relanza y el lanzador termina (y limpia la señal)", !servidorEncendido(nuevaInst.instancia) && lanzadorAntes && !vive(lanzadorAntes) && !(await esperarSalud(envHttps, 2)).ok && !fs.existsSync(path.join(nuevaInst.instancia, "detener")), `lanzador ${lanzadorAntes} vivo=${vive(lanzadorAntes)}`);

      // Windows emulado: detener usa taskkill /PID <lanzador> /T /F (aqui, un taskkill falso que mata el arbol con SIGKILL).
      const otra = arrancar(nuevaInst.env);
      await esperarSalud(envHttps, 60);
      const falsos = path.join(DIR, "bin-taskkill");
      fs.mkdirSync(falsos, { recursive: true });
      fs.writeFileSync(path.join(falsos, "taskkill"), '#!/bin/sh\n# taskkill /PID <pid> /T /F\npkill -KILL -P "$2" 2>/dev/null; kill -KILL "$2" 2>/dev/null; exit 0\n', { mode: 0o755 });
      const lanzadorWin = lanzadorDe();
      const det = await nodoAsync("scripts/detener-ficotox.mjs", [], { FICOTOX_ENV_FILE: nuevaInst.env, FICOTOX_PLATAFORMA_PRUEBA: "win32", PATH: `${falsos}${path.delimiter}${process.env.PATH}` });
      await otra.fin;
      await new Promise((r) => setTimeout(r, 6000));
      check("npm run detener en Windows (taskkill /T /F del lanzador): servidor y lanzador terminados y nada se relanza", det.codigo === 0 && !vive(lanzadorWin) && !servidorEncendido(nuevaInst.instancia) && !(await esperarSalud(envHttps, 2)).ok, `${det.codigo} ${det.salida.trim().split("\n").pop()}`);

      // Dos lanzadores sobre la misma instancia en el mismo instante: servidor.lock atomico, solo uno queda.
      const [p1, p2] = [await puertoLibre(), await puertoLibre()];
      const l1 = arrancar(nuevaInst.env, { PORT: String(p1) });
      const l2 = arrancar(nuevaInst.env, { PORT: String(p2) });
      // Se espera a que el perdedor termine (su servidor sale con 78 al no poder crear servidor.lock).
      const perdedor = await Promise.race([l1.fin.then((c) => ({ n: 1, c })), l2.fin.then((c) => ({ n: 2, c })), new Promise((r) => setTimeout(() => r(null), 60000))]);
      await new Promise((r) => setTimeout(r, 1000));
      // El ganador puede tardar en escuchar (servidor ocupado al final de la corrida completa): se le da hasta 60 s.
      const segundos = (n) => (perdedor && perdedor.n !== n ? 60 : 2);
      const vivos = [(await esperarSalud({ PORT: String(p1), TLS_CERT: envHttps.TLS_CERT }, segundos(1))).ok, (await esperarSalud({ PORT: String(p2), TLS_CERT: envHttps.TLS_CERT }, segundos(2))).ok];
      const salidas = [l1.salida(), l2.salida()].join("\n");
      check("dos servidores arrancados a la vez sobre la misma instancia: solo uno queda escuchando; el otro sale con «ya hay un servidor»", vivos.filter(Boolean).length === 1 && perdedor?.c === 78 && /ya hay un (servidor|lanzador)/.test(salidas), `escuchando: ${vivos.join(",")} perdedor ${JSON.stringify(perdedor)} ${perdedor ? [l1, l2][perdedor.n - 1].salida().trim().split("\n").slice(-3).join(" | ") : ""}`);
      await nodoAsync("scripts/detener-ficotox.mjs", [], { FICOTOX_ENV_FILE: nuevaInst.env });
    }
    await detener(nuevaInst.instancia);
    await s.fin.catch(() => {});

    // verificar-instalacion con problemas: cuenta demo activa y llave distinta de la registrada -> ❌ y exit 1.
    const db = new Sqlite(nuevaInst.base);
    db.prepare("INSERT INTO usuarios (nombre, email, activo, id_rol) VALUES ('Demo', 'demo@ficotox.local', 1, 1)").run();
    db.close();
    fs.writeFileSync(path.join(nuevaInst.instancia, "llave-bitacora.huella"), `${"0".repeat(64)}\n`);
    const v2 = nodo("scripts/verificar-instalacion.mjs", ["--sin-reporte"], { FICOTOX_ENV_FILE: nuevaInst.env });
    check("verificar-instalacion con una cuenta @ficotox.local activa (⚠️) y la llave distinta de la registrada (❌): exit 1", v2.codigo === 1 && /⚠️ Cuentas de demostración/.test(v2.salida) && /❌ Llave de la bitácora: la llave actual/.test(v2.salida), `exit ${v2.codigo}`);
  }
} finally {
  for (const h of hijos) if (h.exitCode === null) h.kill("SIGTERM");
  await detener(nuevaInst.instancia);
}

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} pasos OK`);
process.exit(ok === results.length ? 0 : 1);
