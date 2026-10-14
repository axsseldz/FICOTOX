/*
 * Menu y botones por rol (Fase 1): cada usuario del catalogo inicia sesion en el
 * navegador; la barra lateral muestra solo los destinos de los modulos que puede
 * ver (V) y los botones de alta aparecen segun su accion y alcance. La tabla se
 * repite aqui a proposito (independiente de scripts/roles-catalogo.json).
 * Documentos SGC: Calidad › Documentos SGC aparece para todos los roles del catalogo (la Biblioteca se retiro).
 *
 * Nota (Fase 2): los alcances diferidos se comportan como "total" salvo en
 * calidad (sin acceso: una C "incidencias" ya no abre la bitacora) y en usuarios
 * (solo la propia cuenta). Muestras incluye "Por supervisar" y Administracion
 * "Revision de accesos".
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const BASE = process.env.BASE || "http://localhost:3100";
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const credenciales = JSON.parse(readFileSync(process.env.CREDENCIALES_ROLES, "utf8"));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const TODOS = ["muestras", "ensayos", "informes", "equipos", "inventario", "calidad", "usuarios"];
/* Modulos con V (efectiva) de cada rol; "usuarios:propio" oculta Roles. */
const USUARIOS = [
  ["Administrador técnico del sistema", "jorge.ramirez@ficotox.local", ["usuarios", "muestras", "equipos", "calidad:bitacora", "respaldos"]],
  ["Responsable General", "patricia.luna@ficotox.local", [...TODOS, "respaldos"]],
  ["Coordinador/a de Mejora Continua", "ana.torres@ficotox.local", [...TODOS, "respaldos"]],
  ["Coordinador/a del Área Técnica", "ricardo.medina@ficotox.local", TODOS],
  ["Coordinador/a de Investigación y Desarrollo", "gabriela.ortiz@ficotox.local", TODOS],
  ["Técnico Analista", "luis.castro@ficotox.local", ["usuarios:propio", "muestras", "ensayos", "informes", "equipos", "inventario", "calidad:incidencias"]],
  ["Técnico Auxiliar", "mariana.delgado@ficotox.local", ["usuarios:propio", "muestras", "ensayos", "equipos", "inventario", "calidad:incidencias"]],
  ["Administrador/a Auxiliar", "carmen.aguilar@ficotox.local", ["usuarios:propio", "muestras", "equipos", "inventario", "calidad:incidencias"]],
  ["Auditor Interno", "hector.navarro@ficotox.local", [...TODOS, "respaldos"]],
  ["Estudiante / personal en formación", "diego.salinas@ficotox.local", ["usuarios:propio", "muestras", "ensayos", "equipos", "inventario", "calidad:incidencias"]],
];

/* Botones de alta esperados por rol: [ruta, texto, visible?]. */
const BOTONES = {
  "Técnico Auxiliar": [
    ["/muestras/recepcion", "Nueva recepción", true],
    ["/muestras/procesamiento", "Nuevo procesamiento", true],
    ["/muestras/extraccion", "Nueva extracción", false],
    ["/inventario/reactivos", "Nuevo reactivo", false],
  ],
  "Técnico Analista": [
    ["/muestras/recepcion", "Nueva recepción", false],
    ["/muestras/extraccion", "Nueva extracción", true],
    ["/inventario/equipos", "Nuevo equipo", false],
    ["/inventario/mantenimiento", "Programar mantenimiento", false],
  ],
  "Administrador/a Auxiliar": [
    ["/inventario/mantenimiento", "Programar mantenimiento", true],
    ["/inventario/equipos", "Nuevo equipo", false],
    ["/muestras/recepcion", "Nueva recepción", false],
  ],
  "Auditor Interno": [
    ["/muestras/recepcion", "Nueva recepción", false],
    ["/informes", "Nuevo informe", false],
    ["/inventario/reactivos", "Nuevo reactivo", false],
  ],
  "Coordinador/a del Área Técnica": [
    ["/muestras/recepcion", "Nueva recepción", true],
    ["/informes", "Nuevo informe", true],
    ["/inventario/equipos", "Nuevo equipo", true],
  ],
  "Administrador técnico del sistema": [
    ["/muestras/recepcion", "Nueva recepción", false],
    ["/inventario/equipos", "Nuevo equipo", false],
  ],
};

function enlacesEsperados(modulos) {
  const set = new Set(modulos.map((m) => m.split(":")[0]));
  const propio = modulos.includes("usuarios:propio");
  // Fase 11: alcance de calidad ("bitacora": Admin tecnico; "incidencias": roles operativos).
  const calidad = modulos.find((m) => m.startsWith("calidad"))?.split(":")[1] || "total";
  const out = new Set(["/", "/ayuda"]);
  if (set.has("muestras")) out.add("/muestras/recepcion");
  if (set.has("muestras") || set.has("ensayos")) {
    out.add("/supervision");
    // Fase 3: bandeja "Por autorizar" (solicitudes de segundo usuario).
    out.add("/solicitudes");
  }
  if (set.has("ensayos")) ["/muestras/procesamiento", "/muestras/extraccion", "/muestras/analisis"].forEach((h) => out.add(h));
  if (set.has("informes")) out.add("/informes");
  if (set.has("inventario")) ["/inventario/reactivos", "/inventario/consumibles", "/movimientos"].forEach((h) => out.add(h));
  if (set.has("equipos")) ["/inventario/equipos", "/inventario/mantenimiento"].forEach((h) => out.add(h));
  if (set.has("calidad") && calidad !== "incidencias") out.add("/auditoria");
  if (set.has("calidad") && calidad !== "bitacora") out.add("/calidad/incidencias");
  // Calidad › Documentos SGC (reemplaza a la Biblioteca) para quien tiene acciones documentales (o administra usuarios: diagnostico).
  if (set.has("documentos")) out.add("/documentos");
  // Calidad › Respaldos (respaldos:V: Admin tecnico, Responsable General, Mejora Continua y Auditor Interno).
  if (set.has("respaldos")) out.add("/calidad/respaldos");
  if (set.has("usuarios")) {
    // Revision de accesos se integro en Usuarios y la pantalla Respaldos se retiro.
    out.add("/administracion/usuarios");
    if (!propio) out.add("/administracion/roles");
  }
  return out;
}

const browser = await chromium.launch({ executablePath, headless: true });
try {
  for (const [rol, email, modulos] of USUARIOS) {
    const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    const errores = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errores.push(msg.text());
    });
    page.on("pageerror", (err) => errores.push(`pageerror: ${err.message}`));
    try {
      await page.goto(`${BASE}/login`);
      await page.fill("#login-email", email);
      await page.fill("#login-password", credenciales[email]);
      await page.click("button[type=submit]");
      await page.waitForURL((url) => !url.pathname.startsWith("/login"));
      const aside = page.locator('aside[aria-label="Navegación principal"]');
      await aside.locator("nav a").first().waitFor();
      await page.waitForLoadState("networkidle");
      const hrefs = new Set(await aside.locator("a").evaluateAll((links) => links.map((a) => new URL(a.href).pathname)));
      // Todos los roles del catalogo ven Documentos SGC (acciones documentales; el administrador tecnico, para diagnostico).
      const esperados = enlacesEsperados([...modulos, "documentos"]);
      const sobran = [...hrefs].filter((h) => !esperados.has(h));
      const faltan = [...esperados].filter((h) => !hrefs.has(h));
      check(`${rol}: menu con solo sus modulos`, !sobran.length && !faltan.length, `sobran=[${sobran.join(", ")}] faltan=[${faltan.join(", ")}]`);
      check(`${rol}: «Documentos SGC» aparece en Calidad y ya no «Biblioteca»`, [...hrefs].includes("/documentos") && (await aside.locator("nav a", { hasText: /^Documentos SGC$/ }).count()) > 0 && !hrefs.has("/calidad/biblioteca") && (await aside.locator("nav a", { hasText: /^Biblioteca$/ }).count()) === 0);

      for (const [ruta, texto, visible] of BOTONES[rol] || []) {
        await page.goto(`${BASE}${ruta}`);
        await page.waitForLoadState("networkidle");
        const main = page.locator("main");
        await main.locator("h1").first().waitFor();
        const hay = (await main.getByRole("button", { name: texto, exact: true }).count()) + (await main.getByRole("link", { name: texto, exact: true }).count());
        check(`${rol}: "${texto}" en ${ruta} ${visible ? "visible" : "oculto"}`, visible ? hay > 0 : hay === 0, `encontrados=${hay}`);
      }
      if (rol === "Administrador técnico del sistema") {
        // Alcance "estado": la ficha de la recepcion es de seguimiento, no el formato vacio.
        const apoyo = JSON.parse(readFileSync(process.env.DATOS_APOYO_FILE, "utf8"));
        await page.goto(`${BASE}/muestras/recepcion/${apoyo.recepcion_id}`);
        await page.getByText("Sin acceso a datos técnicos").waitFor();
        check(`${rol}: la recepcion con alcance "estado" se ve como ficha de seguimiento`, (await page.locator("#r-folio").count()) === 0);
      }
      const relevantes = errores.filter((text) => !/favicon|404 \(Not Found\)/.test(text));
      check(`${rol}: sin errores de consola`, relevantes.length === 0, relevantes.slice(0, 3).join(" | "));
    } catch (error) {
      check(`${rol}: recorrido`, false, error.message);
      await page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), "fail.png"), fullPage: true }).catch(() => {});
    }
    await context.close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
