#!/usr/bin/env node
/*
 * Configuracion inicial de FICOTOX (Fase 12): crea o actualiza .env de forma segura.
 *
 *   npm run configurar
 *   npm run configurar -- --no-interactivo [--env <archivo>] [--host 0.0.0.0] [--puerto 5000]
 *        [--dominios cicese.mx] [--instancia instance] [--smtp-host h --smtp-puerto 587
 *        --smtp-usuario u --smtp-from "Nombre <correo>"]   (la contrasena SMTP: variable FICOTOX_SMTP_PASS)
 *
 * - JWT_SECRET: si falta o es debil, genera uno aleatorio fuerte (64 hex).
 * - SECRET_KEY (llave de la bitacora): si ya existe, NUNCA se cambia ni se
 *   sobrescribe. Si no existe y la instancia ya sella con auditoria.key, se
 *   respeta ese archivo (agregar una llave nueva romperia la verificacion de lo
 *   sellado). Solo en una instalacion sin llave se genera una y se muestra su
 *   huella. La huella (no la llave) queda en <instancia>/llave-bitacora.huella.
 * - Pregunta HOST, PORT, dominios de correo, ruta de la instancia y SMTP (opcional).
 * - Conserva el resto del .env (comentarios incluidos); deja permisos 600.
 * - No imprime secretos completos. Se puede volver a correr sin romper nada.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { erroresSecretosProduccion } from "../src/lib/shared/secretos.mjs";
import { SECRET_KEY_DESARROLLO } from "../src/lib/shared/audit-chain.mjs";
import { huellaLlave } from "../src/lib/shared/respaldo.mjs";
import { argumento, root } from "./lib/operacion.mjs";

const args = process.argv.slice(2);
const interactivo = !args.includes("--no-interactivo") && process.stdin.isTTY;
// Sin terminal (p. ej. con una tuberia) no se pueden hacer preguntas: se avisa, en vez de ignorar la entrada en silencio.
if (!args.includes("--no-interactivo") && !process.stdin.isTTY) console.log("ℹ️  Sin terminal interactiva: no se hacen preguntas; se usan las opciones dadas (--host, --puerto, …), los valores actuales del .env o los propuestos. Ver README.md, paso 4.\n");
const archivoEnv = path.resolve(root, argumento(args, "--env") || process.env.FICOTOX_ENV_FILE || ".env");

/* ---------- .env: leer y escribir conservando lo demas ---------- */
const lineas = fs.existsSync(archivoEnv) ? fs.readFileSync(archivoEnv, "utf8").split(/\r?\n/) : [];
const leer = (clave) => {
  for (const l of lineas) {
    const m = l.match(new RegExp(`^\\s*${clave}\\s*=(.*)$`));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
};
const cambios = [];
const escribir = (clave, valor) => {
  const texto = /[\s#"'<>]/.test(valor) ? `"${valor.replace(/"/g, '\\"')}"` : valor;
  const i = lineas.findIndex((l) => new RegExp(`^\\s*${clave}\\s*=`).test(l));
  if (i >= 0) {
    if (leer(clave) === valor) return;
    lineas[i] = `${clave}=${texto}`;
  } else {
    if (!lineas.some((l) => l.includes("npm run configurar"))) lineas.push("", "# --- Valores fijados por npm run configurar (Fase 12) ---");
    lineas.push(`${clave}=${texto}`);
  }
  cambios.push(clave);
};
const oculto = (v) => (v ? `definido (${v.length} caracteres)` : "vacío");

/* ---------- Preguntas ---------- */
const rl = interactivo ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
async function preguntar(texto, clave, opcionArg, porOmision) {
  const actual = argumento(args, opcionArg) ?? leer(clave) ?? porOmision;
  if (!rl) return actual;
  const r = (await rl.question(`${texto} [${actual}]: `)).trim();
  return r || actual;
}

/* Pregunta sin mostrar lo que se escribe (contraseñas). */
async function preguntarOculto(texto) {
  const escribirOriginal = rl._writeToOutput;
  rl._writeToOutput = (cadena) => {
    if (cadena.startsWith(texto)) escribirOriginal.call(rl, texto);
    else if (/\r|\n/.test(cadena)) escribirOriginal.call(rl, "\n");
  };
  try {
    return await rl.question(texto);
  } finally {
    rl._writeToOutput = escribirOriginal;
  }
}

console.log(`FICOTOX · configuración (${path.relative(root, archivoEnv) || archivoEnv})${fs.existsSync(archivoEnv) ? "" : " — se creará"}\n`);

// JWT_SECRET: se genera si falta o es debil.
const jwt = leer("JWT_SECRET") || "";
if (erroresSecretosProduccion({ JWT_SECRET: jwt, NODE_ENV: "production" }).length) {
  escribir("JWT_SECRET", randomBytes(32).toString("hex"));
  console.log("✅ JWT_SECRET: se generó uno nuevo y fuerte (64 caracteres). Las sesiones abiertas tendrán que iniciar de nuevo.");
} else console.log(`✅ JWT_SECRET: ${oculto(jwt)}; se conserva.`);

const host = await preguntar("Dirección en la que escucha (0.0.0.0 = toda la red local)", "HOST", "--host", "0.0.0.0");
const puerto = await preguntar("Puerto", "PORT", "--puerto", "5000");
if (!/^\d+$/.test(String(puerto)) || Number(puerto) < 1 || Number(puerto) > 65535) {
  console.error(`❌ Puerto no válido: ${puerto}`);
  process.exit(2);
}
const dominios = await preguntar("Dominios de correo permitidos (separados por comas)", "ALLOWED_EMAIL_DOMAINS", "--dominios", "cicese.mx");
// La instancia vigente: FICOTOX_INSTANCE_DIR, o la carpeta de la SQLITE_PATH ya configurada (como la resuelve el servidor).
const sqliteActual = leer("SQLITE_PATH");
const instanciaVigente = leer("FICOTOX_INSTANCE_DIR") || (sqliteActual ? path.dirname(sqliteActual) : "instance");
const instanciaRel = await preguntar("Carpeta de la instancia (base, archivos, llave, registros)", "FICOTOX_INSTANCE_DIR", "--instancia", instanciaVigente);
escribir("HOST", host);
escribir("PORT", String(puerto));
escribir("ALLOWED_EMAIL_DOMAINS", dominios.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean).join(","));
escribir("FICOTOX_INSTANCE_DIR", instanciaRel);
// Una base ya configurada (SQLITE_PATH o DATABASE_URL) no se reapunta: cambiarla es decision del administrador, a mano.
if (!leer("DATABASE_URL") && !sqliteActual) escribir("SQLITE_PATH", path.join(instanciaRel, "ficotox.sqlite3").split(path.sep).join("/"));
const instancia = path.resolve(root, instanciaRel);
const baseSqlite = leer("DATABASE_URL") ? null : path.resolve(root, leer("SQLITE_PATH") || path.join(instanciaRel, "ficotox.sqlite3"));

// SMTP (opcional): todas o ninguna.
const smtpHost = await preguntar("Servidor SMTP para enviar informes (vacío = solo envío manual)", "SMTP_HOST", "--smtp-host", "");
if (smtpHost) {
  escribir("SMTP_HOST", smtpHost);
  escribir("SMTP_PORT", await preguntar("Puerto SMTP", "SMTP_PORT", "--smtp-puerto", "587"));
  escribir("SMTP_USER", await preguntar("Usuario SMTP", "SMTP_USER", "--smtp-usuario", ""));
  escribir("SMTP_FROM", await preguntar("Remitente (Nombre <correo>)", "SMTP_FROM", "--smtp-from", ""));
  const pass = process.env.FICOTOX_SMTP_PASS || (rl && !leer("SMTP_PASS") ? (await preguntarOculto("Contraseña SMTP (no se muestra al escribir): ")).trim() : null);
  if (pass) escribir("SMTP_PASS", pass);
  console.log(`✅ SMTP: ${smtpHost} (contraseña ${oculto(leer("SMTP_PASS") || pass || "")}).`);
}
rl?.close();

// SECRET_KEY: nunca se cambia si existe.
const llaveEnv = leer("SECRET_KEY") || "";
// La llave puede estar en la instancia o (instalaciones anteriores) junto a la base.
const archivoLlave = [path.join(instancia, "auditoria.key"), ...(baseSqlite ? [path.join(path.dirname(baseSqlite), "auditoria.key")] : [])].find((f) => fs.existsSync(f) && fs.readFileSync(f, "utf8").trim()) || path.join(instancia, "auditoria.key");
let huella = null;
if (llaveEnv && llaveEnv !== SECRET_KEY_DESARROLLO) {
  huella = huellaLlave(llaveEnv);
  console.log(`✅ SECRET_KEY: ya existe; NO se cambia (huella ${huella.slice(0, 16)}…).`);
} else if (fs.existsSync(archivoLlave) && fs.readFileSync(archivoLlave, "utf8").trim()) {
  huella = huellaLlave(fs.readFileSync(archivoLlave, "utf8").trim());
  console.log(`✅ Llave de la bitácora: la instancia ya sella con ${path.relative(root, archivoLlave)} (huella ${huella.slice(0, 16)}…); no se agrega SECRET_KEY porque cambiar la llave rompería la verificación de lo ya sellado.`);
} else if ((baseSqlite && fs.existsSync(baseSqlite)) || fs.existsSync(path.join(instancia, "ficotox.sqlite3"))) {
  console.log("⚠️  SECRET_KEY: vacía y la instancia ya tiene una base sin auditoria.key. No se genera una llave nueva (la bitácora existente dejaría de verificarse). Consulta README.md, «Llave de la bitácora».");
} else {
  const nueva = randomBytes(32).toString("hex");
  escribir("SECRET_KEY", nueva);
  huella = huellaLlave(nueva);
  console.log(`✅ SECRET_KEY: se generó la llave de la bitácora (huella ${huella.slice(0, 16)}…).`);
  console.log("   ⚠️  Guarda una copia de SECRET_KEY FUERA de esta computadora (sobre cerrado, gestor de contraseñas): sin ella no se puede verificar la bitácora de los respaldos.");
}
if (huella) {
  fs.mkdirSync(instancia, { recursive: true });
  const registro = path.join(instancia, "llave-bitacora.huella");
  const previa = fs.existsSync(registro) ? fs.readFileSync(registro, "utf8").trim() : null;
  if (previa && previa !== huella) console.log(`⚠️  La huella registrada (${previa.slice(0, 16)}…) no coincide con la llave actual: revisa que no se haya cambiado la llave.`);
  else if (!previa) fs.writeFileSync(registro, `${huella}\n`);
}

// Escribir .env con permisos restrictivos.
fs.mkdirSync(path.dirname(archivoEnv), { recursive: true });
fs.writeFileSync(archivoEnv, `${lineas.join("\n").replace(/\n+$/, "")}\n`, { mode: 0o600 });
try {
  fs.chmodSync(archivoEnv, 0o600);
} catch {
  /* sistema sin permisos POSIX */
}
// Windows: el servicio corre como SYSTEM (npm run instalar-servicio) y necesita leer .env.
if (process.platform === "win32") console.log('ℹ️  En Windows restringe .env a tu usuario y al servicio: en PowerShell, icacls .env /inheritance:r /grant:r "${env:USERNAME}:F" /grant:r "SYSTEM:R" /grant:r "Administradores:F" (en Windows en inglés: Administrators; ver README.md, paso 4).');
console.log(`\n${cambios.length ? `Se actualizaron: ${[...new Set(cambios)].join(", ")}` : "Sin cambios: la configuración ya estaba completa."}`);
console.log(`Instancia: ${instancia}`);
console.log("Siguientes pasos (README.md): guarda una copia de SECRET_KEY fuera de esta computadora (paso 5), npm run build (paso 6) y, solo en una instalación nueva, npm run instancia-nueva -- --confirmar (paso 7). En una instalación existente: npm run verificar-instalacion.");
