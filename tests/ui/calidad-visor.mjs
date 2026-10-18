/*
 * PDF de una no conformidad desde su ventana (Calidad › Incidencias y NC, y la
 * búsqueda del Inicio): el visor interno queda encima de todo (la ventana modal
 * se oculta mientras se lee) y, al cerrarlo con Escape o con la X, vuelve la
 * ventana de la misma NC. Sin descarga automática.
 * La NC se prepara y se cierra por la API (el PDF existe al cerrarla).
 */
import "../lib/reauth-auto.mjs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const BASE = process.env.BASE || "http://localhost:3100";
process.env.BASE = `${BASE}/api`;
const { api, crearCheck, credenciales, EMAIL, sesiones } = await import("../lib/calidad.mjs");
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const { check, terminar } = crearCheck();
const { t, id } = await sesiones();

/* ---------- Datos: una NC cerrada (rama «no requiere acción correctiva») ---------- */
const nc = await api("POST", "/calidad/nc", { origen: "revision", descripcion: "Registro de balanza sin firma (prueba del visor)", clasificacion: "menor", responsable_id: id.ana }, t.ana);
const N = nc.data?.id;
await api("PUT", `/calidad/nc/${N}`, { afecta_resultados_emitidos: "no", trabajo_detenido: "no", notificar_cliente: "no", requiere_accion_correctiva: "no", justificacion_sin_accion: "Error aislado; el registro se completó el mismo día" }, t.ana);
await api("POST", `/calidad/nc/${N}/avanzar`, { a: "en_analisis" }, t.ana);
const cierre = await api("POST", `/calidad/nc/${N}/cerrar`, { conclusion: "No requiere acciones correctivas; error aislado" }, t.patricia);
const folio = (await api("GET", `/calidad/nc/${N}`, undefined, t.patricia)).data?.item?.folio;
check("datos: NC cerrada con su PDF", cierre.status === 200 && !!folio, `${cierre.status} ${cierre.data?.message || ""} ${folio}`);

const browser = await chromium.launch({ executablePath, headless: true });
const paso = async (nombre, fn, opciones = {}) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opciones });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  try {
    await page.goto(`${BASE}/login`);
    await page.fill("#login-email", EMAIL.patricia);
    await page.fill("#login-password", credenciales[EMAIL.patricia]);
    await page.click("button[type=submit]");
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 });
    await fn(page);
  } catch (error) {
    await page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), "fail-calidad-visor.png"), fullPage: true }).catch(() => {});
    check(`${nombre}: sin errores`, false, error.message.split("\n")[0]);
  } finally {
    await context.close();
  }
};
const ventana = (page) => page.locator(`[data-nc-ventana="${N}"]`);
/* Abre el PDF desde la ventana y comprueba que el visor carga y queda encima (lo del centro de la pantalla es el visor). */
const abrirPdf = async (page) => {
  let descargas = 0;
  page.on("download", () => (descargas += 1));
  await ventana(page).getByRole("button", { name: "PDF", exact: true }).click();
  await page.getByTestId("visor-pdf").first().waitFor();
  await page.waitForFunction(() => /^\d+$/.test(document.querySelector("[data-testid=visor-total-paginas]")?.textContent || ""));
  // La ventana se oculta con su animación de salida: se espera a que el visor sea lo de arriba.
  const encima = await page
    .waitForFunction(() => !!document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)?.closest("[data-visor-pdf-flotante]"), null, { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  return { encima, descargas };
};
const vuelve = (page) => ventana(page).waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);

await paso("lista de incidencias y NC", async (page) => {
  await page.goto(`${BASE}/calidad/incidencias?tipos=nc`);
  await page.locator(`[data-nc="${N}"]`).click();
  await ventana(page).waitFor();
  const r = await abrirPdf(page);
  check("lista: «PDF» abre el visor encima de la ventana de la NC, sin descarga", r.encima && r.descargas === 0, JSON.stringify(r));
  await page.keyboard.press("Escape");
  check("lista: al cerrar el visor con Escape vuelve la ventana de la misma NC", await vuelve(page));
  const r2 = await abrirPdf(page);
  await page.getByRole("dialog", { name: String(folio) }).getByRole("button", { name: "Cerrar" }).click();
  check("lista: al cerrar el visor con la X también vuelve la ventana", r2.encima && (await vuelve(page)));
});

await paso("búsqueda del Inicio", async (page) => {
  // Desde la búsqueda la ventana no tiene lista detrás (onIndice no hace nada): debe volver igual.
  await page.goto(`${BASE}/`);
  const buscador = page.getByPlaceholder(/Busca un folio/);
  await buscador.fill(String(folio));
  await page.getByText(String(folio)).first().waitFor();
  await buscador.press("Enter");
  await ventana(page).waitFor();
  const r = await abrirPdf(page);
  check("búsqueda: «PDF» abre el visor encima de la ventana de la NC", r.encima && r.descargas === 0, JSON.stringify(r));
  await page.keyboard.press("Escape");
  check("búsqueda: al cerrar el visor vuelve la ventana de la misma NC", await vuelve(page));
}, { viewport: { width: 400, height: 860 }, colorScheme: "dark" });

await browser.close();
terminar();
