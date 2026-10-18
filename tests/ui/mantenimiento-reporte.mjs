/*
 * Reporte PDF de mantenimiento en el navegador (Inventario › Mantenimiento):
 * - la Administradora Auxiliar (registra y edita mantenimientos) ve el estado
 *   vacio que explica como adjuntarlo, lo adjunta con «Adjuntar reporte PDF», lo
 *   abre en el visor interno (encima de todo, sin descarga; al cerrarlo vuelve la
 *   ventana) y un archivo que no es PDF se rechaza
 *   con mensaje claro;
 * - el Auditor Interno (solo consulta) lo ve y lo abre, sin «Adjuntar», «Reemplazar» ni «Quitar»;
 * - quitarlo pide motivo y contrasena en el mismo dialogo y deja de mostrarse;
 * - a 400 px y en tema oscuro la seccion no desborda.
 * El mantenimiento se prepara por la API.
 */
import "../lib/reauth-auto.mjs";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const BASE = process.env.BASE || "http://localhost:3100";
process.env.BASE = `${BASE}/api`;
const { api, crearCheck, credenciales, Database, EMAIL, sesiones } = await import("../lib/calidad.mjs");
const { pdfConTexto } = await import("../lib/archivos.mjs");

const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const { check, terminar } = crearCheck();
const { t } = await sesiones();
// Equipo propio: programar un mantenimiento pone el equipo «En mantenimiento» (no se toca el de los datos de apoyo).
const equipoId = (await api("POST", "/inventory/equipos", { nombre: "Equipo reporte UI", clave_bitacora: `FX-TCB-RU${Date.now().toString(36).slice(-5).toUpperCase()}`, estado: "operativo" }, t.qa)).data?.id;
const M = (await api("POST", "/inventory/mantenimientos", { id_equipo: equipoId, tipo: "correctivo", fecha_programada: "2027-05-10", estado: "programado", tecnico_proveedor: "Técnico UI reporte" }, t.carmen)).data?.id;
check("datos: mantenimiento programado", !!M, String(M));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ficotox-reporte-"));
const pdf = path.join(dir, "reporte-servicio.pdf");
fs.writeFileSync(pdf, await pdfConTexto(2, "Reporte de servicio UI"));
const falso = path.join(dir, "no-es-pdf.pdf");
fs.writeFileSync(falso, "Solo texto con extensión .pdf");

const browser = await chromium.launch({ executablePath, headless: true });
const paso = async (quien, nombre, fn, opciones = {}) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, ...opciones });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  try {
    await page.goto(`${BASE}/login`);
    await page.fill("#login-email", EMAIL[quien]);
    await page.fill("#login-password", credenciales[EMAIL[quien]]);
    await page.click("button[type=submit]");
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
    await fn(page, context);
  } catch (error) {
    await page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), "fail-mantenimiento.png"), fullPage: true }).catch(() => {});
    check(`${nombre}: sin errores`, false, error.message.split("\n")[0]);
  } finally {
    await context.close();
  }
};
const abrirMantenimiento = async (page) => {
  await page.goto(`${BASE}/inventario/mantenimiento?abrir=${M}`);
  const seccion = page.locator(`[data-reporte-mantenimiento="${M}"]`);
  await seccion.waitFor();
  return seccion;
};
const visorAbierto = async (page) => {
  await page.getByTestId("visor-pdf").first().waitFor();
  await page.waitForFunction(() => /^\d+$/.test(document.querySelector("[data-testid=visor-total-paginas]")?.textContent || ""));
  return Number(await page.getByTestId("visor-total-paginas").first().innerText());
};
/* El visor se ve de verdad: lo que hay en el centro de la pantalla es el visor (no la ventana del mantenimiento). */
const visorEncima = (page) => page.evaluate(() => !!document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)?.closest("[data-visor-pdf-flotante]"));
/* Al cerrar el visor con Escape vuelve la ventana del mantenimiento. */
const vuelveLaVentana = async (page) => {
  await page.keyboard.press("Escape");
  return page.locator(`[data-reporte-mantenimiento="${M}"]`).waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
};

await paso("carmen", "adjuntar", async (page) => {
  const seccion = await abrirMantenimiento(page);
  await seccion.locator("[data-reporte-vacio]").waitFor();
  check("estado vacío: explica cómo adjuntarlo", /Usa «Adjuntar reporte PDF»/.test(await seccion.locator("[data-reporte-vacio]").innerText()));
  // Un archivo que no es PDF (aunque se llame .pdf): mensaje claro y no se agrega.
  const [elegir1] = await Promise.all([page.waitForEvent("filechooser"), seccion.getByRole("button", { name: "Adjuntar reporte PDF" }).click()]);
  await elegir1.setFiles(falso);
  await page.getByText(/no corresponde a un archivo \.pdf/).first().waitFor();
  check("un archivo que no es PDF se rechaza con mensaje claro y no se agrega", (await seccion.locator("[data-reporte-item]").count()) === 0);
  const [elegir2] = await Promise.all([page.waitForEvent("filechooser"), seccion.getByRole("button", { name: "Adjuntar reporte PDF" }).click()]);
  await elegir2.setFiles(pdf);
  await seccion.locator("[data-reporte-item]").first().waitFor();
  const texto = await seccion.locator("[data-reporte-item]").first().innerText();
  check("adjuntado: aparece con su código, nombre y huella SHA-256", /RM-\d{5}-\d{2}/.test(texto) && /reporte-servicio\.pdf/.test(texto) && /SHA-256/.test(texto), texto.replace(/\s+/g, " "));
  let descargas = 0;
  page.on("download", () => (descargas += 1));
  await seccion.getByRole("button", { name: "Abrir", exact: true }).click();
  const paginas = await visorAbierto(page);
  await page.waitForTimeout(500);
  const encima = await visorEncima(page);
  check("«Abrir» lo muestra en el visor interno (2 páginas), encima de todo y sin descargarlo", paginas === 2 && descargas === 0 && encima, `${paginas} páginas, ${descargas} descargas, encima=${encima}`);
  check("al cerrar el visor (Escape) vuelve la ventana del mantenimiento", await vuelveLaVentana(page));
  const lista = page.locator("[data-reportes-mantenimiento]");
  await page.keyboard.press("Escape");
  const listado = await lista.getByText(/RM-\d{5}-\d{2}/).first().waitFor({ state: "attached", timeout: 15_000 }).then(() => true).catch(() => false);
  check("la sección «Reportes de mantenimiento (PDF)» de la pantalla ya lo lista", listado);
  if (process.env.CAPTURAS_DIR) await page.screenshot({ path: path.join(process.env.CAPTURAS_DIR, "mant-claro.png") });
});

await paso("hector", "solo consulta", async (page) => {
  const seccion = await abrirMantenimiento(page);
  await seccion.locator("[data-reporte-item]").first().waitFor();
  check("quien solo consulta ve el reporte, sin «Adjuntar reporte PDF», «Reemplazar» ni «Quitar»", (await seccion.getByRole("button", { name: "Adjuntar reporte PDF" }).count()) === 0 && (await seccion.getByRole("button", { name: "Reemplazar" }).count()) === 0 && (await seccion.getByRole("button", { name: "Quitar" }).count()) === 0);
  const reporteId = await seccion.locator("[data-reporte-item]").first().getAttribute("data-reporte-item");
  await seccion.getByRole("button", { name: "Abrir", exact: true }).click();
  const paginas = await visorAbierto(page);
  await page.waitForTimeout(300);
  check("…y lo abre en el visor, encima de todo", paginas === 2 && (await visorEncima(page)));
  check("…y al cerrarlo vuelve a la ventana", await vuelveLaVentana(page));
  const r = await api("POST", `/documents/maintenance-report/${reporteId}/quitar`, { motivo: "Intento sin permiso" }, t.hector);
  check("…y la API le responde 403 al quitarlo", r.status === 403, `${r.status}`);
});

await paso(
  "carmen",
  "celular y oscuro",
  async (page) => {
    const seccion = await abrirMantenimiento(page);
    await seccion.locator("[data-reporte-item]").first().waitFor();
    await page.waitForTimeout(400);
    const desborde = await page.evaluate(() => {
      const ancho = document.documentElement.clientWidth;
      const fuera = [...document.querySelectorAll("[data-reporte-mantenimiento] *")].filter((el) => el.getBoundingClientRect().right > ancho + 1).length;
      return { scroll: document.documentElement.scrollWidth - ancho, fuera };
    });
    if (process.env.CAPTURAS_DIR) await page.screenshot({ path: path.join(process.env.CAPTURAS_DIR, "mant-400-oscuro.png"), fullPage: true });
    check("a 400 px y en oscuro la sección del reporte no desborda", desborde.scroll <= 0 && desborde.fuera === 0, JSON.stringify(desborde));
  },
  { viewport: { width: 400, height: 860 }, colorScheme: "dark" },
);

await paso("carmen", "quitar", async (page) => {
  const seccion = await abrirMantenimiento(page);
  await seccion.locator("[data-reporte-item]").first().waitFor();
  await seccion.getByRole("button", { name: "Quitar" }).click();
  await page.fill("#prompt-motivo", "Se adjuntó por error");
  await page.fill("#prompt-password", credenciales[EMAIL.carmen]);
  await page.getByRole("dialog").getByRole("button", { name: "Quitar reporte" }).click();
  await seccion.locator("[data-reporte-vacio]").waitFor();
  const db = new Database(process.env.TEST_DB_PATH, { readonly: true });
  const fila = db.prepare("SELECT r.motivo_anulacion, (SELECT accion FROM auditoria a WHERE a.entidad = 'reportes_mantenimiento' AND a.entidad_id = CAST(r.id AS TEXT) ORDER BY a.id DESC LIMIT 1) AS accion FROM reportes_mantenimiento r WHERE r.id_mantenimiento = ? ORDER BY r.id DESC LIMIT 1").get(M);
  db.close();
  check("quitar con motivo y contraseña en el mismo diálogo: deja de mostrarse y queda en la bitácora", fila?.motivo_anulacion === "Se adjuntó por error" && fila?.accion === "anular", JSON.stringify(fila));
});

await browser.close();
fs.rmSync(dir, { recursive: true, force: true });
terminar();
