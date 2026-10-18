/*
 * Autorizaciones FX-THF-AP en el navegador (Fase 4):
 * - al abrir un formato sin la autorizacion necesaria aparece el aviso (no espera al guardar);
 *   con la autorizacion no aparece;
 * - el Coord. del Area Tecnica ve la pestaña "Autorizaciones (FX-THF-AP)" en la ficha de
 *   una persona, con las autorizaciones del seed y el boton "Agregar".
 */
import "../lib/reauth-auto.mjs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const BASE = process.env.BASE || "http://localhost:3100";
const API = `${BASE}/api`;
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const credenciales = JSON.parse(readFileSync(process.env.CREDENCIALES_ROLES, "utf8"));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const RICARDO = "ricardo.medina@ficotox.local";
const LUIS = "luis.castro@ficotox.local";
async function api(method, ruta, body, token) {
  const res = await fetch(`${API}${ruta}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const tokenDe = async (email, password) => (await api("POST", "/auth/login", { email, password })).data?.token;
const QA = await tokenDe("qa@ficotox.local", "QaFicotox2026!");
const TR = await tokenDe(RICARDO, credenciales[RICARDO]);
const luisId = ((await api("GET", "/admin/usuarios", undefined, QA)).data?.items || []).find((u) => u.email === LUIS)?.id;
const vigentes = async () => ((await api("GET", `/admin/usuarios/${luisId}/autorizaciones`, undefined, QA)).data?.items || []).filter((a) => a.tipo === "actividad" && a.clave === "procesamiento" && a.estado === "vigente");

// Luis se queda sin la actividad procesamiento mientras dura la prueba.
for (const a of await vigentes()) await api("POST", `/admin/usuarios/${luisId}/autorizaciones/${a.id}/revocar`, { motivo: "Prueba del aviso en el formato" }, TR);
check("datos: Luis sin autorizacion de procesamiento", (await vigentes()).length === 0);

const browser = await chromium.launch({ executablePath, headless: true });
const entrar = async (email, password) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  await page.goto(`${BASE}/login`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return { context, page };
};
const captura = (page) => page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), "fail.png"), fullPage: true }).catch(() => {});

try {
  {
    const { context, page } = await entrar(LUIS, credenciales[LUIS]);
    try {
      await page.goto(`${BASE}/muestras/procesamiento/nuevo`);
      const aviso = page.locator("[data-aviso-autorizacion]").first();
      await aviso.waitFor();
      check("al abrir el formato sin la autorizacion aparece el aviso", /procesamiento/i.test((await aviso.textContent()) || ""), (await aviso.textContent())?.slice(0, 160));
    } catch (error) {
      check("aviso al abrir el formato", false, error.message);
      await captura(page);
    }
    await context.close();
  }
  await api("POST", `/admin/usuarios/${luisId}/autorizaciones`, { tipo: "actividad", clave: "procesamiento", folio_fx_thf_ap: "FX-THF-AP-DEMO", motivo: "Fin de la prueba del aviso" }, TR);
  {
    const { context, page } = await entrar(LUIS, credenciales[LUIS]);
    try {
      await page.goto(`${BASE}/muestras/procesamiento/nuevo`);
      await page.getByRole("heading").first().waitFor();
      await page.waitForTimeout(1500);
      check("con la autorizacion vigente no aparece el aviso", (await page.locator("[data-aviso-autorizacion]").count()) === 0);
    } catch (error) {
      check("sin aviso con autorizacion", false, error.message);
      await captura(page);
    }
    await context.close();
  }
  {
    const { context, page } = await entrar(RICARDO, credenciales[RICARDO]);
    try {
      await page.goto(`${BASE}/administracion/usuarios`);
      // Usuarios minimalista: al pulsar a la persona se abre su ventana (General, Roles, Autorizaciones).
      const fila = page.locator("[data-usuario]").filter({ hasText: /Luis Fernando/ }).first();
      await fila.waitFor();
      await fila.locator("button[aria-haspopup=dialog]").click();
      await page.getByRole("tab", { name: "Autorizaciones" }).click();
      const panel = page.locator("#autorizaciones-usuario");
      await panel.getByText("FX-THF-AP-DEMO").first().waitFor();
      check("la ventana muestra la pestaña de autorizaciones con las del seed", true);
      check("quien administra ve el boton Agregar", (await panel.getByRole("button", { name: "Agregar" }).count()) > 0);
    } catch (error) {
      check("pestaña de autorizaciones", false, error.message);
      await captura(page);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
