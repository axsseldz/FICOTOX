/*
 * Auditoria en lenguaje simple (navegador): lista agrupada por dia, sin
 * insignia ni exportacion; detalle en ventana centrada (frase, cuando, "Que
 * paso", sin datos tecnicos), ↑/↓ y Esc; inicios de sesion desde Filtros; el
 * mismo detalle en el Historial de un registro.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const BASE = process.env.BASE || "http://localhost:3100";
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const datos = process.env.DATOS_APOYO_FILE ? JSON.parse(readFileSync(process.env.DATOS_APOYO_FILE, "utf8")) : {};
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(45_000);
try {
  await page.goto(`${BASE}/login`);
  await page.fill("#login-email", "qa@ficotox.local");
  await page.fill("#login-password", "QaFicotox2026!");
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  await page.goto(`${BASE}/auditoria`);
  const filas = page.locator("[data-actividad]");
  await filas.first().waitFor();
  check("la lista se agrupa por día con encabezado", (await page.locator("section h2", { hasText: /^(Hoy|Ayer|\w+ \d+ de \w+)/ }).count()) > 0);
  check("los inicios de sesión están ocultos por omisión", (await filas.filter({ hasText: /entró a la plataforma/ }).count()) === 0);
  check("sin insignia de integridad ni exportación", (await page.locator("[data-integridad]").count()) === 0 && (await page.getByRole("button", { name: /Exportar/ }).count()) === 0);
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.getByRole("switch", { name: "Mostrar inicios de sesión" }).click();
  await page.keyboard.press("Escape");
  await filas.filter({ hasText: /entró a la plataforma/ }).first().waitFor();
  check("con el interruptor se muestran los inicios de sesión", true);
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.getByRole("switch", { name: "Mostrar inicios de sesión" }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // Abrir el detalle de una actividad: ventana centrada.
  await filas.first().click();
  const dialogo = page.getByRole("dialog");
  const detalle = dialogo.locator("[data-actividad-detalle]");
  await detalle.waitFor();
  const primero = await detalle.getAttribute("data-actividad-detalle");
  const encabezado = (await detalle.locator("header").textContent()) || "";
  check("el detalle muestra la frase y cuándo pasó", /de 20\d\d a las \d\d:\d\d/.test(encabezado), encabezado.slice(0, 120));
  check("el detalle explica «Qué pasó» y no muestra datos técnicos", (await detalle.getByText("Qué pasó").count()) === 1 && !/sello|hash|Datos técnicos|#\d/i.test((await detalle.textContent()) || ""));
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(300);
  const segundo = await page.locator("[data-actividad-detalle]").getAttribute("data-actividad-detalle");
  check("↓ cambia a la actividad siguiente sin cerrar", !!segundo && segundo !== primero, `${primero} → ${segundo}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("Esc cierra el detalle", (await page.locator("[data-actividad-detalle]").count()) === 0);

  // El mismo detalle en el Historial de un registro.
  if (datos.recepcion_id) {
    await page.goto(`${BASE}/muestras/recepcion/${datos.recepcion_id}`);
    await page.getByText("Historial del registro").first().waitFor();
    const todo = page.getByRole("radio", { name: "Todo", exact: true }).first();
    if (await todo.count()) await todo.click();
    // La actividad del historial aparece recogida.
    await page.getByRole("button", { name: /^Actividad · \d+ actividad/ }).click();
    const evento = page.locator('[aria-label="Actividad del registro"] [data-actividad]').first();
    await evento.scrollIntoViewIfNeeded();
    await evento.click();
    await page.getByRole("dialog").locator("[data-actividad-detalle]").waitFor();
    check("el Historial del registro abre el mismo detalle", true);
  }
} catch (error) {
  check("recorrido de auditoría", false, error.message);
  await page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), "fail.png"), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
