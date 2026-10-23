/*
 * Configuracion inicial (instalacion nueva sin cuentas), de punta a punta: cada
 * escenario levanta su propio `next dev` en el puerto de pruebas sobre una
 * instancia vacia en instance/test/instalacion/<escenario>/ (el servidor
 * principal de las pruebas debe estar detenido). Navegador con Chrome de
 * Playwright.
 *  1. Sin FICOTOX_CODIGO_INSTALACION: el acceso lleva a la configuracion, que
 *     explica como definirlo en Mac y en Windows; las rutas responden 403.
 *  2. Codigo incorrecto: intentos contados, bloqueo al quinto (429, tambien con
 *     el correcto) y cada intento en la bitacora.
 *  3. Empezar desde cero (navegador): dos cuentas con contraseña temporal que
 *     se cambia al entrar; despues la pantalla y sus rutas responden 404.
 *     Claro, oscuro y teléfono sin desbordes.
 *  4. «La computadora murió» (navegador): el archivo descargado en
 *     api-respaldos-portables.mjs se restaura en una instancia vacia en otra
 *     carpeta (contraseña incorrecta primero). Usuarios, inventario, archivos
 *     (PDF) y bitacora iguales; la llave adoptada (auditoria.key) sigue
 *     verificando la bitacora tras reiniciar el servidor.
 *  5. SECRET_KEY en el .env: se reescribe esa linea (lo demas se conserva) y,
 *     tras reiniciar con la llave nueva, la bitacora verifica.
 *  6. SECRET_KEY fijada fuera del .env (variable del sistema): no se reemplaza;
 *     no se restaura nada y se explica.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluarCadena, leerClaveSello } from "../src/lib/shared/audit-chain.mjs";
import { huellaLlave } from "../src/lib/shared/respaldo.mjs";
import { sha256, subirPorPartes } from "./lib/portables.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const Database = require(process.env.BETTER_SQLITE3 || "better-sqlite3");
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const PORT = Number(process.env.TEST_PORT || 3100);
const WEB = `http://localhost:${PORT}`;
const API = `${WEB}/api`;
const RAIZ = path.join(root, "instance", "test", "instalacion");
const MURIO = path.join(root, "instance", "test", "murio");
const CODIGO = "PRUEBA-CODIGO-2026-XYZ";
const credenciales = JSON.parse(fs.readFileSync(process.env.CREDENCIALES_ROLES || path.join(root, "instance", "test", "credenciales-roles.json"), "utf8"));
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const conNavegador = fs.existsSync(executablePath);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, ruta, body, token, headers = {}) {
  const res = await fetch(`${API}${ruta}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get("content-type") || "";
  return { status: res.status, data: type.includes("json") ? await res.json().catch(() => null) : await res.text() };
}
const login = async (email, password) => (await api("POST", "/auth/login", { email, password })).data?.token;

const puertoLibre = () =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(PORT);
  });
if (!(await puertoLibre())) {
  console.error(`instalacion.mjs: el puerto ${PORT} está ocupado (detén el servidor de pruebas antes).`);
  process.exit(1);
}

/* ---------- Servidor sobre una instancia propia ---------- */
let servidor = null;
const rutasDe = (nombre) => {
  const dir = path.join(RAIZ, nombre);
  return { dir, instancia: path.join(dir, "instance"), db: path.join(dir, "instance", `ficotox-${nombre}.sqlite3`), backups: path.join(dir, "backups") };
};
async function arrancar(nombre, entorno = {}) {
  const r = rutasDe(nombre);
  fs.mkdirSync(r.instancia, { recursive: true });
  // Variables vacias: Next no las toma del .env de la raiz (no pisa lo ya definido).
  const env = { ...process.env, PORT: String(PORT), SQLITE_PATH: r.db, FICOTOX_INSTANCE_DIR: r.instancia, FICOTOX_BACKUP_DIR: r.backups, DATABASE_URL: "", SECRET_KEY: "", FICOTOX_CODIGO_INSTALACION: "", FICOTOX_ENV_FILE: "", TRUST_PROXY: "true", ALLOWED_EMAIL_DOMAINS: "cicese.mx,ficotox.local", CORS_ORIGINS: "", SMTP_HOST: "", SMTP_PORT: "", SMTP_USER: "", SMTP_PASS: "", SMTP_FROM: "", TZ: "America/Tijuana", ...entorno };
  servidor = spawn("npx", ["next", "dev", "-p", String(PORT)], { cwd: root, stdio: ["ignore", "ignore", "inherit"], env });
  const inicio = Date.now();
  while (Date.now() - inicio < 120_000) {
    try {
      const salud = await (await fetch(`${API}/health/db`)).json();
      if (salud?.archivo) {
        if (salud.archivo !== path.basename(r.db)) throw new Error(`El servidor usa ${salud.archivo} y no ${path.basename(r.db)}`);
        return r;
      }
    } catch (error) {
      if (/El servidor usa/.test(String(error?.message))) throw error;
    }
    await espera(500);
  }
  throw new Error("El servidor de la instalación no respondió");
}
async function detener() {
  if (!servidor) return;
  const s = servidor;
  servidor = null;
  await new Promise((resolve) => {
    s.once("exit", resolve);
    s.kill("SIGTERM");
    setTimeout(resolve, 10_000);
  });
  for (let i = 0; i < 40 && !(await puertoLibre()); i += 1) await espera(250);
}
process.on("exit", () => servidor?.kill("SIGTERM"));

const leer = (db, sql, ...args) => {
  const c = new Database(db, { readonly: true, fileMustExist: true });
  try {
    return c.prepare(sql).all(...args);
  } finally {
    c.close();
  }
};
/* La bitacora de una instancia, verificada con su propia llave (SECRET_KEY o instance/auditoria.key). */
function cadena(r, secretKey = "") {
  const c = new Database(r.db, { readonly: true, fileMustExist: true });
  try {
    const llave = leerClaveSello(secretKey, r.instancia);
    const seq = c.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'auditoria'").get();
    const triggers = c.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'auditoria' AND name IN ('auditoria_sin_update', 'auditoria_sin_delete')").get().n;
    const v = evaluarCadena(c.prepare("SELECT * FROM auditoria ORDER BY id").all(), llave.clave, seq ? Number(seq.seq) : null, triggers);
    return { ok: v.ok, total: v.total, origen: llave.origen, huella: huellaLlave(llave.clave) };
  } finally {
    c.close();
  }
}
async function esperarFin(ms = 300_000) {
  const inicio = Date.now();
  let ultimo = null;
  while (Date.now() - inicio < ms) {
    const r = await api("GET", "/instalacion").catch(() => ({ status: 0 }));
    if (r.status === 404) return { terminado: true, trabajo: ultimo };
    if (r.status === 200) {
      ultimo = r.data?.trabajo;
      if (ultimo && ultimo.estado !== "en_curso") return { terminado: false, trabajo: ultimo };
    }
    await espera(500);
  }
  return { terminado: false, trabajo: ultimo };
}
async function restaurarPorApi(contrasena) {
  const datos = fs.readFileSync(path.join(MURIO, "respaldo.ficotox"));
  const s = await subirPorPartes({ base: API, inicio: "/instalacion/subidas", cuerpo: { codigo: CODIGO }, datos, headers: { "X-Codigo-Instalacion": CODIGO } });
  const r = await api("POST", "/instalacion/restaurar", { codigo: CODIGO, subida: s.id, contrasena });
  return { subida: s, r, fin: r.status === 202 ? await esperarFin() : null };
}

if (!fs.existsSync(path.join(MURIO, "esperado.json"))) {
  console.error("instalacion.mjs necesita el respaldo descargado por api-respaldos-portables.mjs (instance/test/murio).");
  process.exit(1);
}
const esperado = JSON.parse(fs.readFileSync(path.join(MURIO, "esperado.json"), "utf8"));
fs.rmSync(RAIZ, { recursive: true, force: true });
const navegador = conNavegador ? await chromium.launch({ executablePath, headless: true }) : null;
if (!navegador) console.log(`(navegador omitido: no se encontró Chrome en ${executablePath})`);
let ultimaPagina = null;
const pagina = async (opciones = {}) => {
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: "reduce", ...opciones });
  ultimaPagina = await ctx.newPage();
  return { ctx, page: ultimaPagina };
};
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

try {
  /* ---------- 1. Sin codigo de instalacion ---------- */
  {
    await arrancar("sin-codigo");
    const config = await api("GET", "/auth/config");
    const estado = await api("GET", "/instalacion");
    check("instalación vacía: el acceso sabe que falta configurar", config.data?.instalacion_pendiente === true && estado.status === 200 && estado.data?.pendiente === true, `${config.data?.instalacion_pendiente} ${estado.status}`);
    check("sin FICOTOX_CODIGO_INSTALACION la pantalla lo dice", estado.data?.codigo_configurado === false, JSON.stringify(estado.data).slice(0, 120));
    const codigo = await api("POST", "/instalacion/codigo", { codigo: "cualquier-codigo-123" });
    const cero = await api("POST", "/instalacion/cero", { codigo: "cualquier-codigo-123", administrador: { nombre: "Alguien", email: "a@cicese.mx" }, responsable: { nombre: "Otra", email: "b@cicese.mx" } });
    check("sin código definido nada avanza (403 codigo_no_configurado)", codigo.status === 403 && codigo.data?.codigo === "codigo_no_configurado" && cero.status === 403, `${codigo.status} ${cero.status}`);
    if (navegador) {
      for (const [sistema, ua] of [["mac", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36"], ["windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36"]]) {
        const { ctx, page } = await pagina({ userAgent: ua });
        await page.goto(`${WEB}/login`);
        await page.waitForURL(/configuracion-inicial/, { timeout: 60_000 });
        await page.waitForSelector('[data-instalacion="sin-codigo"]', { timeout: 60_000 });
        const pasos = await page.locator("[data-pasos-sistema]").getAttribute("data-pasos-sistema");
        const texto = await page.locator("[data-pasos-sistema]").innerText();
        check(`sin código: el acceso lleva a la configuración y muestra los pasos de ${sistema === "mac" ? "Mac" : "Windows"}`, pasos === sistema && texto.includes("FICOTOX_CODIGO_INSTALACION") && texto.includes(sistema === "mac" ? "open -e .env" : "notepad .env") && texto.includes("npm run configurar"), `${pasos}`);
        await page.click(`[data-sistema="${sistema === "mac" ? "windows" : "mac"}"]`);
        const otro = await page.locator("[data-pasos-sistema]").getAttribute("data-pasos-sistema");
        check(`se puede ver también la guía del otro sistema (${otro})`, otro !== sistema);
        await ctx.close();
      }
    }
    await detener();
  }

  /* ---------- 2. Codigo incorrecto y bloqueo ---------- */
  const desdeCero = rutasDe("desde-cero");
  {
    await arrancar("desde-cero", { FICOTOX_CODIGO_INSTALACION: CODIGO });
    const estado = await api("GET", "/instalacion");
    check("con el código definido la pantalla pide escribirlo", estado.data?.codigo_configurado === true && estado.data?.codigo_valido === true);
    const restantes = [];
    for (let i = 0; i < 4; i += 1) {
      const r = await api("POST", "/instalacion/codigo", { codigo: `${CODIGO}-mal${i}` }, null, { "X-Forwarded-For": `10.0.0.${i + 1}` });
      restantes.push(r.status === 401 ? r.data?.intentos_restantes : `status ${r.status}`);
    }
    check("código incorrecto: 401 y cuenta los intentos que quedan (aunque cambie la IP)", restantes.join(",") === "4,3,2,1", restantes.join(","));
    const quinto = await api("POST", "/instalacion/codigo", { codigo: "otro-codigo-malo" });
    const correcto = await api("POST", "/instalacion/codigo", { codigo: CODIGO });
    const subida = await api("POST", "/instalacion/subidas", { codigo: CODIGO, tamano: 100, nombre: "x.ficotox" });
    check("al quinto intento se bloquea 15 minutos, incluso con el código correcto (429)", quinto.status === 429 && correcto.status === 429 && subida.status === 429 && correcto.data?.codigo === "instalacion_bloqueada", `${quinto.status} ${correcto.status} ${subida.status}`);
    const vacio = await api("POST", "/instalacion/codigo", {});
    check("el bloqueo también lo ve la pantalla", (await api("GET", "/instalacion")).data?.bloqueada_hasta && vacio.status === 429);
    const entradas = leer(desdeCero.db, "SELECT cambios_json, datos_nuevos_json FROM auditoria WHERE accion = 'codigo_instalacion_incorrecto'");
    check("cada código incorrecto queda en la bitácora (sin el código escrito)", entradas.length === 5 && !JSON.stringify(entradas).includes("mal0"), `${entradas.length}`);
    await detener();
  }

  /* ---------- 3. Empezar desde cero (navegador) ---------- */
  {
    await arrancar("desde-cero", { FICOTOX_CODIGO_INSTALACION: CODIGO });
    const temporales = {};
    if (navegador) {
      // Oscuro y teléfono: sin desbordes en los primeros pasos.
      for (const [etq, opciones] of [["oscuro", { colorScheme: "dark" }], ["teléfono", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]]) {
        const { ctx, page } = await pagina(opciones);
        await page.goto(`${WEB}/configuracion-inicial`);
        await page.waitForSelector('[data-instalacion="codigo"]', { timeout: 60_000 });
        const ok1 = await sinDesborde(page);
        await page.fill("#instalacion-codigo", CODIGO);
        await page.click('button[type="submit"]');
        await page.waitForSelector('[data-instalacion="camino"]');
        await page.click('[data-camino="cero"]');
        await page.waitForSelector('[data-instalacion="cero"]');
        const ok2 = await sinDesborde(page);
        const fondo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        check(`configuración inicial en ${etq}: sin desbordes horizontales`, ok1 && ok2, fondo);
        await ctx.close();
      }
      const { ctx, page } = await pagina();
      await page.goto(`${WEB}/login`);
      await page.waitForURL(/configuracion-inicial/, { timeout: 60_000 });
      await page.waitForSelector('[data-instalacion="codigo"]', { timeout: 60_000 });
      await page.fill("#instalacion-codigo", "codigo-equivocado-1");
      await page.click('button[type="submit"]');
      await page.getByText(/no es correcto/).first().waitFor({ timeout: 15_000 });
      const aviso = await page.locator('[data-instalacion="codigo"]').innerText();
      check("código equivocado: lo dice y cuántos intentos quedan", /no es correcto/i.test(aviso) && /intento/.test(aviso), aviso.slice(0, 160));
      await page.fill("#instalacion-codigo", CODIGO);
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-instalacion="camino"]');
      await page.click('[data-camino="cero"]');
      await page.fill("#administrador-nombre", "Ana Administradora");
      await page.fill("#administrador-email", "ana.admin@cicese.mx");
      await page.fill("#responsable-nombre", "Rosa Responsable");
      await page.fill("#responsable-email", "rosa.responsable@cicese.mx");
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-instalacion="cuentas"]', { timeout: 30_000 });
      for (const email of ["ana.admin@cicese.mx", "rosa.responsable@cicese.mx"]) temporales[email] = (await page.locator(`[data-cuenta="${email}"] [data-contrasena-temporal]`).innerText()).trim();
      const boton = page.getByRole("button", { name: "Ir a iniciar sesión" });
      const deshabilitado = await boton.isDisabled();
      await page.check("#cuentas-guardadas");
      check("se muestran las dos contraseñas temporales y hay que confirmar que se guardaron", Object.values(temporales).every((t) => t.length >= 16) && deshabilitado && !(await boton.isDisabled()), Object.keys(temporales).join(", "));
      await boton.click();
      await page.waitForURL(/\/login/);
      await page.fill("#login-email", "ana.admin@cicese.mx");
      await page.fill("#login-password", temporales["ana.admin@cicese.mx"]);
      await page.click('button[type="submit"]');
      await page.waitForSelector("text=Cambia tu contraseña", { timeout: 30_000 });
      check("el Administrador técnico entra con la temporal y debe cambiarla", true);
      await page.goto(`${WEB}/configuracion-inicial`);
      await page.waitForURL(/\/login|\/$|inicio/, { timeout: 30_000 }).catch(() => undefined);
      check("la pantalla de configuración ya no se puede usar (lleva al acceso)", !/configuracion-inicial/.test(page.url()), page.url());
      await ctx.close();
    } else {
      const r = await api("POST", "/instalacion/cero", { codigo: CODIGO, administrador: { nombre: "Ana Administradora", email: "ana.admin@cicese.mx" }, responsable: { nombre: "Rosa Responsable", email: "rosa.responsable@cicese.mx" } });
      for (const c of r.data?.cuentas || []) temporales[c.email] = c.contrasena_temporal;
    }
    const usuarios = leer(desdeCero.db, "SELECT u.email, u.debe_cambiar_password, r.clave FROM usuarios u JOIN usuario_roles ur ON ur.usuario_id = u.id JOIN roles r ON r.id = ur.rol_id ORDER BY u.id");
    check("se crearon el Administrador técnico y la Responsable General, con cambio de contraseña obligatorio", usuarios.length === 2 && usuarios[0].clave === "admin_tecnico" && usuarios[1].clave === "responsable_general" && usuarios.every((u) => u.debe_cambiar_password === 1), JSON.stringify(usuarios));
    const despues = await Promise.all([api("GET", "/instalacion"), api("POST", "/instalacion/codigo", { codigo: CODIGO }), api("POST", "/instalacion/cero", { codigo: CODIGO, administrador: { nombre: "Intruso", email: "x@cicese.mx" }, responsable: { nombre: "Intrusa", email: "y@cicese.mx" } }), api("POST", "/instalacion/subidas", { codigo: CODIGO, tamano: 10, nombre: "x" }), api("POST", "/instalacion/restaurar", { codigo: CODIGO, subida: "0".repeat(32), contrasena: "x" })]);
    check("con cuentas, todas las rutas de la configuración responden 404 (aun con el código)", despues.every((r) => r.status === 404), despues.map((r) => r.status).join(" "));
    check("el acceso ya no lleva a la configuración", (await api("GET", "/auth/config")).data?.instalacion_pendiente === false);
    const c = cadena(desdeCero);
    const accion = leer(desdeCero.db, "SELECT accion FROM auditoria WHERE accion = 'configuracion_inicial'");
    check("todo quedó en la bitácora, íntegra", c.ok && accion.length === 1, `${c.ok} ${c.total} ${accion.length}`);
    await detener();
    // Reiniciado, sigue cerrada.
    await arrancar("desde-cero", { FICOTOX_CODIGO_INSTALACION: CODIGO });
    const cerrada = await api("GET", "/instalacion");
    check("tras reiniciar sigue cerrada (404)", cerrada.status === 404, `${cerrada.status}`);
    await detener();
  }

  /* ---------- 4. «La computadora murió» (navegador) ---------- */
  const murio = rutasDe("computadora-nueva");
  {
    await arrancar("computadora-nueva", { FICOTOX_CODIGO_INSTALACION: CODIGO });
    const llaveAntes = cadena(murio).huella;
    if (navegador) {
      const { ctx, page } = await pagina();
      await page.goto(`${WEB}/configuracion-inicial`);
      await page.waitForSelector('[data-instalacion="codigo"]', { timeout: 60_000 });
      await page.fill("#instalacion-codigo", CODIGO);
      await page.click('button[type="submit"]');
      await page.click('[data-camino="restaurar"]');
      await page.setInputFiles("#instalacion-archivo", path.join(MURIO, "respaldo.ficotox"));
      await page.fill("#instalacion-contrasena", "contraseña equivocada");
      await page.click('button[type="submit"]');
      await page.waitForSelector("text=no es la de este archivo", { timeout: 120_000 });
      check("contraseña incorrecta: lo explica sin tocar nada", (await api("GET", "/instalacion")).data?.pendiente === true);
      await page.fill("#instalacion-contrasena", esperado.contrasena);
      await page.click('button[type="submit"]');
      await page.waitForSelector("[data-restaurando]", { timeout: 30_000 });
      check("se ve el avance (descifrar, verificar, recuperar)", (await page.locator("[data-restaurando]").innerText()).includes("Verificar el respaldo"));
      await page.waitForSelector('[data-instalacion="restaurada"]', { timeout: 300_000 });
      check("la plataforma quedó restaurada", true);
      await page.getByRole("button", { name: "Ir a iniciar sesión" }).click();
      await page.waitForURL(/\/login/);
      await page.fill("#login-email", "jorge.ramirez@ficotox.local");
      await page.fill("#login-password", credenciales["jorge.ramirez@ficotox.local"]);
      await page.click('button[type="submit"]');
      await page.waitForURL((u) => !/\/login|configuracion-inicial/.test(String(u)), { timeout: 60_000 });
      check("se entra con la cuenta de siempre", !/login/.test(page.url()), page.url());
      await ctx.close();
    } else {
      const r = await restaurarPorApi(esperado.contrasena);
      check("la plataforma quedó restaurada", r.fin?.terminado === true, JSON.stringify(r.fin?.trabajo || {}).slice(0, 200));
    }
    const usuarios = leer(murio.db, "SELECT id, email, nombre, activo, password_hash FROM usuarios ORDER BY id");
    const reactivos = leer(murio.db, "SELECT id, nombre, producto, cantidad_total, restante, activo FROM reactivos ORDER BY id");
    check("usuarios iguales (incluidas sus contraseñas)", JSON.stringify(usuarios) === JSON.stringify(esperado.usuarios), `${usuarios.length}/${esperado.usuarios.length}`);
    check("inventario igual (con el reactivo registrado antes del respaldo)", JSON.stringify(reactivos) === JSON.stringify(esperado.reactivos) && reactivos.some((x) => x.producto === esperado.marca || x.nombre === esperado.marca), `${reactivos.length}/${esperado.reactivos.length}`);
    const faltan = esperado.archivos.filter((a) => {
      const local = path.join(murio.instancia, ...a.ruta.split("/").slice(1));
      return !fs.existsSync(local) || sha256(local) !== a.sha256;
    });
    const pdfs = esperado.archivos.filter((a) => a.ruta.endsWith(".pdf")).length;
    check("archivos iguales por SHA-256 (PDF de informes incluidos)", faltan.length === 0, `${esperado.archivos.length} archivos, ${pdfs} PDF; distintos: ${faltan.map((a) => a.ruta).join(", ")}`);
    const c = cadena(murio);
    const ultimas = leer(murio.db, "SELECT id, accion, hash FROM auditoria ORDER BY id");
    const delRespaldo = ultimas.find((e) => e.id === esperado.auditoria.id);
    const despues = ultimas.filter((e) => e.id > esperado.auditoria.id).map((e) => e.accion);
    check("bitácora igual hasta el respaldo y luego la restauración y la configuración, íntegra con la llave adoptada", c.ok && delRespaldo?.hash === esperado.auditoria.hash && despues.includes("restaurar_respaldo") && despues.includes("configuracion_inicial"), `${c.ok} ${despues.join(",")}`);
    const anteriores = fs.readdirSync(murio.instancia).filter((n) => n.startsWith("auditoria.key.anterior-"));
    check("la instalación adoptó la llave del respaldo (auditoria.key) y guardó la anterior", c.origen === "auditoria.key" && c.huella === esperado.huella_llave && c.huella !== llaveAntes && anteriores.length === 1 && fs.readFileSync(path.join(murio.instancia, "llave-bitacora.huella"), "utf8").trim() === esperado.huella_llave, `${c.origen} ${c.huella.slice(0, 12)} ${anteriores}`);
    const restantes = fs.existsSync(path.join(murio.backups, ".importando")) ? fs.readdirSync(path.join(murio.backups, ".importando")) : [];
    check("no quedaron temporales de la subida", restantes.length === 0, restantes.join(", "));
    await detener();
    await arrancar("computadora-nueva", { FICOTOX_CODIGO_INSTALACION: CODIGO });
    const t = await login("jorge.ramirez@ficotox.local", credenciales["jorge.ramirez@ficotox.local"]);
    const verify = await api("GET", "/audit/verify", undefined, t);
    check("tras reiniciar el servidor, la bitácora sigue íntegra con la llave adoptada", verify.status === 200 && verify.data?.ok === true, `${verify.status} ${JSON.stringify(verify.data).slice(0, 140)}`);
    check("y la configuración sigue cerrada", (await api("GET", "/instalacion")).status === 404);
    await detener();
  }

  /* ---------- 5. SECRET_KEY en el .env: se reescribe esa linea ---------- */
  {
    const r = rutasDe("con-env");
    fs.mkdirSync(r.dir, { recursive: true });
    const archivoEnv = path.join(r.dir, "ficotox.env");
    const llaveVieja = randomBytes(32).toString("hex");
    fs.writeFileSync(archivoEnv, `# configuracion de prueba\nOTRA_VARIABLE=se-conserva\nSECRET_KEY=${llaveVieja}\nFICOTOX_CODIGO_INSTALACION=${CODIGO}\n`);
    await arrancar("con-env", { FICOTOX_ENV_FILE: archivoEnv, SECRET_KEY: llaveVieja, FICOTOX_CODIGO_INSTALACION: CODIGO });
    const res = await restaurarPorApi(esperado.contrasena);
    check(".env: la restauración terminó", res.fin?.terminado === true, `${res.r?.status} ${JSON.stringify(res.fin?.trabajo || {}).slice(0, 200)}`);
    const contenido = fs.readFileSync(archivoEnv, "utf8");
    const nueva = /^SECRET_KEY=(.+)$/m.exec(contenido)?.[1]?.trim();
    check(".env: la línea SECRET_KEY ahora tiene la llave del respaldo y lo demás se conservó", !!nueva && huellaLlave(nueva) === esperado.huella_llave && contenido.includes("OTRA_VARIABLE=se-conserva") && contenido.includes(`FICOTOX_CODIGO_INSTALACION=${CODIGO}`) && !contenido.includes(llaveVieja), contenido.split("\n").filter((l) => !l.startsWith("SECRET_KEY")).join(" | "));
    const enCaliente = await api("GET", "/audit/verify", undefined, await login("jorge.ramirez@ficotox.local", credenciales["jorge.ramirez@ficotox.local"]));
    check(".env: sin reiniciar, la bitácora ya verifica con la llave adoptada", enCaliente.status === 200 && enCaliente.data?.ok === true, `${enCaliente.status} ${JSON.stringify(enCaliente.data).slice(0, 120)}`);
    await detener();
    await arrancar("con-env", { FICOTOX_ENV_FILE: archivoEnv, SECRET_KEY: nueva, FICOTOX_CODIGO_INSTALACION: CODIGO });
    const verify = await api("GET", "/audit/verify", undefined, await login("jorge.ramirez@ficotox.local", credenciales["jorge.ramirez@ficotox.local"]));
    check(".env: tras reiniciar con la llave del .env, la bitácora verifica", verify.status === 200 && verify.data?.ok === true, `${verify.status}`);
    check(".env: la cadena verifica con esa llave (lectura directa)", cadena(r, nueva).ok);
    await detener();
  }

  /* ---------- 6. SECRET_KEY fuera del .env: no se reemplaza ---------- */
  {
    const r = rutasDe("llave-del-sistema");
    fs.mkdirSync(r.dir, { recursive: true });
    const vacio = path.join(r.dir, "vacio.env");
    fs.writeFileSync(vacio, "");
    const llave = randomBytes(32).toString("hex");
    await arrancar("llave-del-sistema", { FICOTOX_ENV_FILE: vacio, SECRET_KEY: llave, FICOTOX_CODIGO_INSTALACION: CODIGO });
    const res = await restaurarPorApi(esperado.contrasena);
    const t = res.fin?.trabajo;
    check("SECRET_KEY del sistema: no se reemplaza la llave, no se restaura nada y se explica", res.fin?.terminado === false && t?.estado === "fallido" && /llave/i.test(String(t?.mensaje)), `${t?.estado} ${t?.mensaje}`);
    const cuentas = leer(r.db, "SELECT COUNT(*) AS n FROM usuarios")[0].n;
    const estado = await api("GET", "/instalacion");
    check("la instalación sigue vacía y se puede volver a intentar", cuentas === 0 && estado.status === 200 && estado.data?.pendiente === true, `${cuentas} ${estado.status}`);
    const falla = leer(r.db, "SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'configuracion_inicial_fallida'")[0].n;
    check("el intento fallido queda en la bitácora", falla === 1, `${falla}`);
    await detener();
  }
} catch (error) {
  console.error(error);
  await ultimaPagina?.screenshot({ path: path.join(here, "ui", "fail-instalacion.png"), fullPage: true }).catch(() => {});
  check("la prueba terminó sin errores", false, String(error?.message || error));
} finally {
  await detener();
  await navegador?.close();
}

fs.rmSync(RAIZ, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pruebas de la configuración inicial pasaron`);
process.exit(failed ? 1 : 0);
