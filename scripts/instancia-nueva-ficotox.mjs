#!/usr/bin/env node
/*
 * Instancia nueva de produccion (Fase 12): empezar en limpio en la computadora
 * del laboratorio (la base de demostracion no va a produccion).
 *
 *   npm run instancia-nueva -- --confirmar
 *   npm run instancia-nueva -- --confirmar --no-interactivo \
 *        --admin-nombre "..." --admin-correo a@cicese.mx --rg-nombre "..." --rg-correo b@cicese.mx
 *
 * 1. Sin --confirmar no hace nada (explica que haria y sale con codigo 2).
 * 2. Exige el servidor detenido y SQLite (en MySQL: base vacia creada por el DBA + npm run migrar).
 * 3. MUEVE (no borra) la instancia actual y su llave a backups/pre-produccion-<fecha>/:
 *    esa base solo se verifica con su llave, que queda junto a ella
 *    (auditoria.key dentro de la carpeta o, si se usaba SECRET_KEY, copiada a llave-bitacora.txt).
 * 4. Crea la base vacia con las migraciones y el catalogo de roles (roles-catalogo.json).
 * 5. Da de alta las dos cuentas minimas que exigen las guardas: un Administrador
 *    tecnico del sistema (usuarios:G) y un Responsable General (usuarios:A), con
 *    una contrasena temporal que se muestra UNA sola vez y se debe cambiar al entrar.
 * 6. No siembra datos de demostracion ni autorizaciones de ejemplo. Todo queda en
 *    la bitacora como "sistema".
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { COLUMNAS_AUDITORIA, construirRegistro, sellar } from "../src/lib/shared/audit-chain.mjs";
import { huellaLlave, versionApp } from "../src/lib/shared/respaldo.mjs";
import { adaptadorSqlite, aplicarMigraciones, VERSION_ACTUAL } from "../src/lib/server/migraciones/motor.mjs";
import { argumento, claveBitacora, entornoDe, root, servidorEncendido, Sqlite } from "./lib/operacion.mjs";
import { marcaLocal, selloLocal } from "./lib/registro.mjs";

const args = process.argv.slice(2);
const confirmar = args.includes("--confirmar");
const entorno = entornoDe();
const salir = (mensaje, codigo = 2) => {
  console.error(mensaje);
  process.exit(codigo);
};

console.log("FICOTOX · instancia nueva de producción\n");
if (!confirmar) {
  console.log(`Esto prepararía una instancia vacía en ${entorno.instanceDir}:`);
  const conDatos = fs.existsSync(entorno.sqlitePath);
  console.log(conDatos ? `  1. movería la instancia actual (base, archivos y llave) a ${path.join(entorno.respaldosDir, "pre-produccion-<fecha>")} (no se borra nada);` : "  1. (no hay una base anterior en la instancia: no se mueve nada);");
  console.log("  2. crearía la base vacía con las migraciones y el catálogo de roles;");
  console.log("  3. daría de alta un Administrador técnico y un Responsable General con contraseñas temporales.");
  console.log("\nNo se hizo ningún cambio. Para hacerlo: npm run instancia-nueva -- --confirmar");
  process.exit(2);
}
if (entorno.motor !== "sqlite") salir("Esta instalación usa MySQL/MariaDB: el administrador de la base crea una base vacía, después npm run migrar -- --respaldo-hecho y el primer administrador con el SQL de README.md, «MySQL/MariaDB».");
const vivo = servidorEncendido(entorno.instanceDir);
if (vivo) salir(`El servidor está encendido (pid ${vivo.pid}). Detén el servicio antes de crear la instancia nueva.`);

/* ---------- Cuentas ---------- */
const interactivo = !args.includes("--no-interactivo") && process.stdin.isTTY;
const rl = interactivo ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
const pedir = async (texto, opcion) => {
  const dado = argumento(args, opcion);
  if (dado || !rl) return (dado || "").trim();
  return (await rl.question(`${texto}: `)).trim();
};
const cuentas = [
  { rol: "Administrador técnico del sistema", nombre: await pedir("Nombre del Administrador técnico del sistema", "--admin-nombre"), email: (await pedir("Correo del Administrador técnico", "--admin-correo")).toLowerCase() },
  { rol: "Responsable General", nombre: await pedir("Nombre del Responsable General", "--rg-nombre"), email: (await pedir("Correo del Responsable General", "--rg-correo")).toLowerCase() },
];
rl?.close();
const dominios = String(process.env.ALLOWED_EMAIL_DOMAINS || "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
for (const c of cuentas) {
  if (!c.nombre || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) salir(`Falta el nombre o el correo es inválido para ${c.rol}.`);
  if (dominios.length && !dominios.includes(c.email.split("@")[1])) salir(`El correo ${c.email} no pertenece a los dominios permitidos (${dominios.join(", ")}).`);
  if (c.email.endsWith("@ficotox.local")) salir(`${c.email}: los correos @ficotox.local son de la demostración; usa el correo institucional.`);
}
if (cuentas[0].email === cuentas[1].email) salir("El Administrador técnico y el Responsable General deben ser personas (correos) distintas.");
const temporal = () => `Fx-${randomBytes(9).toString("base64url")}-${randomBytes(3).toString("hex")}`;
for (const c of cuentas) c.password = temporal();

/* ---------- Mover la instancia actual ---------- */
const sello = selloLocal();
const destino = path.join(entorno.respaldosDir, `pre-produccion-${sello}`);
// Solo se mueve una instancia con datos (base o archivos de registros). Una recien configurada
// (solo la huella de la llave, logs, verificaciones, definicion del servicio o TLS) se queda.
const SIN_DATOS = new Set(["llave-bitacora.huella", "logs", "verificaciones", "servicio", "tls", "auditoria.key", ".DS_Store"]);
const hayInstancia = fs.existsSync(entorno.instanceDir) && (fs.existsSync(entorno.sqlitePath) || fs.readdirSync(entorno.instanceDir).some((n) => !SIN_DATOS.has(n)));
if (hayInstancia) {
  fs.mkdirSync(destino, { recursive: true });
  const movida = path.join(destino, path.basename(entorno.instanceDir));
  try {
    fs.renameSync(entorno.instanceDir, movida);
  } catch {
    // Otro disco: copiar completo y luego retirar el original (sigue siendo un movimiento, nada se pierde).
    fs.cpSync(entorno.instanceDir, movida, { recursive: true });
    fs.rmSync(entorno.instanceDir, { recursive: true, force: true });
  }
  // La base movida solo se verifica con la llave con que se sello: si esa llave es SECRET_KEY (del .env), se copia junto a ella.
  // La configuracion de la computadora (definicion del servicio y certificado TLS) no es de la base: se queda.
  fs.mkdirSync(entorno.instanceDir, { recursive: true });
  for (const carpeta of ["servicio", "tls"]) {
    const origen = path.join(movida, carpeta);
    if (fs.existsSync(origen)) fs.renameSync(origen, path.join(entorno.instanceDir, carpeta));
  }
  const llaveEnv = String(entorno.secretKey || "").trim();
  if (llaveEnv) {
    fs.writeFileSync(path.join(destino, "llave-bitacora.txt"), `${llaveEnv}\n`, { mode: 0o600 });
    console.log("⚠️  Esa carpeta contiene una copia de la llave de la bitácora (llave-bitacora.txt): es un dato sensible. Resguárdala como el resto de los respaldos y no la compartas.");
  }
  fs.writeFileSync(
    path.join(destino, "LEEME.txt"),
    [
      `Instancia anterior de FICOTOX, movida el ${marcaLocal()} por npm run instancia-nueva.`,
      "",
      "Esta base SOLO se verifica con la llave con que se selló su bitácora:",
      llaveEnv ? "- la SECRET_KEY de entonces, copiada en llave-bitacora.txt (consérvala; no la compartas)." : `- ${path.basename(entorno.instanceDir)}/auditoria.key (dentro de esta carpeta).`,
      "Para consultarla: restaura esta carpeta en una instalación de prueba con esa llave.",
      "",
    ].join("\n"),
  );
  console.log(`📦 Instancia anterior movida a ${destino} (con su llave; ver LEEME.txt).`);
}
fs.mkdirSync(entorno.instanceDir, { recursive: true });

/* ---------- Base nueva ---------- */
const clave = claveBitacora(entorno, true);
// Huella de la llave (no la llave): la compara npm run verificar-instalacion.
fs.writeFileSync(path.join(entorno.instanceDir, "llave-bitacora.huella"), `${huellaLlave(clave)}\n`);
const conexion = new Sqlite(entorno.sqlitePath);
try {
  const r = await aplicarMigraciones(adaptadorSqlite(conexion), { Sqlite, clave, appCommit: versionApp(root).commit });
  console.log(`✅ Base nueva en ${entorno.sqlitePath} (migraciones ${r.aplicadas.map((m) => m.version).join(", ")}; versión ${VERSION_ACTUAL}).`);
  // Solo el usuario que corre FICOTOX lee la base (los -wal/-shm heredan el permiso). En Windows no aplica.
  try {
    fs.chmodSync(entorno.sqlitePath, 0o600);
  } catch {
    /* sistema sin permisos POSIX */
  }
} finally {
  conexion.close();
}

// Catalogo de roles y las dos cuentas (script de alta, sin autorizaciones de ejemplo). El archivo temporal se borra al terminar.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ficotox-alta-"));
const archivo = path.join(tmp, "usuarios.json");
fs.writeFileSync(archivo, JSON.stringify({ usuarios: cuentas.map(({ rol, nombre, email, password }) => ({ rol, nombre, email, password })) }), { mode: 0o600 });
const alta = spawnSync(process.execPath, [path.join(root, "scripts/seed-roles-usuarios.mjs"), "--db", entorno.sqlitePath, "--usuarios", archivo, "--motivo", "Instancia nueva de producción"], { cwd: root, encoding: "utf8", env: { ...process.env, FICOTOX_INSTANCE_DIR: entorno.instanceDir, SQLITE_PATH: entorno.sqlitePath } });
fs.rmSync(tmp, { recursive: true, force: true });
if (alta.status !== 0) salir(`❌ No se pudieron dar de alta los roles y las cuentas:\n${(alta.stderr || alta.stdout).split("\n").filter((l) => !/password|contrase/i.test(l)).join("\n")}`, 1);

// Contrasena temporal: se debe cambiar al entrar. Queda en la bitacora como "sistema".
const db = new Sqlite(entorno.sqlitePath);
try {
  const insertar = db.prepare(`INSERT INTO auditoria (${COLUMNAS_AUDITORIA.join(", ")}) VALUES (${COLUMNAS_AUDITORIA.map((c) => `@${c}`).join(", ")})`);
  const auditar = (entrada) => {
    const previo = db.prepare("SELECT hash FROM auditoria ORDER BY id DESC LIMIT 1").get();
    const registro = construirRegistro(entrada, { sub: null, nombre: "sistema", email: null }, previo?.hash || null);
    insertar.run({ ...registro, hash: sellar(registro, clave) });
  };
  db.transaction(() => {
    for (const c of cuentas) {
      const u = db.prepare("SELECT id FROM usuarios WHERE LOWER(email) = ?").get(c.email);
      db.prepare("UPDATE usuarios SET debe_cambiar_password = 1 WHERE id = ?").run(u.id);
      auditar({ accion: "editar", entidad: "usuarios", entidadId: u.id, referencia: c.email, motivo: "Contraseña temporal de la instancia nueva: se cambia al primer acceso", detalle: { debe_cambiar_password: true } });
    }
    auditar({ accion: "crear", entidad: "instancia", entidadId: null, referencia: "Instancia de producción", motivo: "Instancia nueva de producción (sin datos de demostración)", detalle: { instancia_anterior: hayInstancia ? destino : null, cuentas: cuentas.map((c) => c.rol) } });
  })();
} finally {
  db.close();
}

console.log("\n==================== CONTRASEÑAS TEMPORALES (se muestran UNA sola vez) ====================");
for (const c of cuentas) console.log(`  ${c.rol}: ${c.email}  →  ${c.password}`);
console.log("===========================================================================================");
console.log("Entrégalas en persona. Cada quien debe cambiarla al entrar por primera vez.");
console.log("\nSiguiente paso: npm run instalar-servicio (o npm run start:standalone) y npm run verificar-instalacion.");
