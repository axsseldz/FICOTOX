/*
 * Navegador para las suites de la prueba integral (tests/ui/integral-*.mjs):
 * cada paso es una persona en su propia sesión de Chrome, con su rol. Junta los
 * errores de consola, los avisos de React y las respuestas 5xx de la API de
 * todas las pantallas recorridas; si un paso truena, queda FAIL con el motivo,
 * la línea de la suite y una captura en $TMPDIR/ficotox-integral/<suite>/.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

export const BASE_WEB = (process.env.BASE || "http://localhost:3100").replace(/\/api$/, "");
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const AVISO_REACT = /Warning:|hydrat|unique "key"|act\(|Cannot update a component/i;

export async function abrirNavegador({ suite, check, credencial }) {
  const capturas = path.join(process.env.E2E_CAPTURAS || path.join(os.tmpdir(), "ficotox-integral"), suite);
  mkdirSync(capturas, { recursive: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  const consola = [];
  const errores500 = [];
  const pantalla = (page) => {
    try {
      return new URL(page.url()).pathname;
    } catch {
      return "?";
    }
  };
  const nueva = async (opciones = {}) => {
    const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true, ...opciones });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const descargas = [];
    page.on("download", (d) => descargas.push(d.suggestedFilename()));
    page.on("console", (msg) => {
      const texto = msg.text();
      // Los 4xx esperados (pruebas por URL directa, reautenticación) llegan como "Failed to load resource".
      if (msg.type() === "error" && !/Failed to load resource/.test(texto)) consola.push(`[${pantalla(page)}] ${texto}`);
      else if (msg.type() === "warning" && AVISO_REACT.test(texto)) consola.push(`[${pantalla(page)}] aviso: ${texto}`);
    });
    page.on("pageerror", (err) => consola.push(`[${pantalla(page)}] pageerror: ${err.message}`));
    page.on("response", (r) => {
      if (r.status() >= 500 && r.url().includes("/api/")) errores500.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname} [${pantalla(page)}]`);
    });
    return { context, page, descargas };
  };
  /* Inicia sesión como `quien` (clave de EMAIL o un objeto { email, password }). */
  const entrar = async (page, quien) => {
    const { email, password } = credencial(quien);
    await page.goto(`${BASE_WEB}/login`);
    await page.fill("#login-email", email);
    await page.fill("#login-password", password);
    await page.click("button[type=submit]");
    // El primer acceso puede tardar mientras el servidor de desarrollo compila las páginas.
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 });
  };
  const captura = (page, nombre) => page.screenshot({ path: path.join(capturas, `fallo-${nombre.replace(/[^a-z0-9]/gi, "").slice(0, 50)}.png`), fullPage: true }).catch(() => {});
  /* Un paso = una persona en su sesión; `quien` null = sin iniciar sesión. */
  const paso = async (quien, nombre, fn, opciones) => {
    const { context, page, descargas } = await nueva(opciones);
    try {
      if (quien) await entrar(page, quien);
      await fn(page, { context, descargas });
    } catch (err) {
      await captura(page, nombre);
      const linea = err instanceof Error ? (err.stack || "").split("\n").find((l) => l.includes(`${suite}.mjs`)) || "" : "";
      check(nombre, false, `${err instanceof Error ? err.message.split("\n")[0] : String(err)} ${linea.trim()} [pantalla ${pantalla(page)}]`);
    } finally {
      await context.close();
    }
  };
  const cerrar = async () => {
    await browser.close();
    check(`${suite}: sin errores de consola ni avisos de React`, consola.length === 0, consola.slice(0, 5).join(" | "));
    check(`${suite}: sin respuestas 5xx de la API`, errores500.length === 0, errores500.slice(0, 5).join(" | "));
  };
  return { browser, nueva, entrar, paso, cerrar, captura, pantalla };
}

/* ---------- Utilidades de pantalla ---------- */
export const toast = (page, re, timeout = 30_000) => page.locator("[data-sonner-toast]").filter({ hasText: re }).last().waitFor({ timeout });
export const sinAcceso = (page) => page.getByText(/Sin acceso a esta sección|no encontrad|no está asignada|No tienes permiso|No existe/i).first().waitFor();
/* «Confirma tu identidad»: la contraseña de quien actúa. */
export const contrasena = async (page, password) => {
  await page.locator("#reauth-password").fill(password);
  await page.getByRole("dialog", { name: "Confirma tu identidad" }).getByRole("button", { name: "Confirmar", exact: true }).click();
};
/* Diálogo de motivo (y contraseña si es crítico). */
export const dialogoMotivo = async (page, motivo, confirmar, password) => {
  await page.locator("#prompt-motivo").waitFor();
  await page.locator("#prompt-motivo").fill(motivo);
  if (password && (await page.locator("#prompt-password").count())) await page.locator("#prompt-password").fill(password);
  await page.getByRole("dialog").getByRole("button", { name: confirmar, exact: true }).click();
};
/* Cierra el resumen de validación («Entendido») y espera a que se vaya. */
export const entendido = async (page) => {
  await page.getByRole("button", { name: "Entendido" }).last().click();
  await page.getByRole("button", { name: "Entendido" }).waitFor({ state: "detached" });
};
