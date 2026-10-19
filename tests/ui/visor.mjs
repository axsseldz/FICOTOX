/*
 * Visor de PDF, en el navegador (datos de apoyo por la API):
 * - informe liberado: barra que se oculta y reaparece (tiempo, scroll y cursor), zoom y su memoria
 *   por persona, atajos (+/−, Esc en modo Lectura), miniaturas cerradas por omisión, descarga y
 *   descarga sin pestaña nueva; reduced-motion;
 * - ficha SGC de 12 páginas: busqueda con contador y salto de pagina, indice del PDF, modo oscuro;
 * - tableta (toques): doble toque para acercar y deslizar entre paginas;
 * - visor interno flotante: error claro con reintento, Esc lo cierra y descarga solo al pedirla.
 * Descargar e imprimir sin permiso: el visor los deshabilita con su motivo, pero hoy ninguna
 * pantalla llega a ese caso (cada una solo muestra el visor a quien puede verlo), así que no se prueba.
 */
import "../lib/reauth-auto.mjs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const BASE = process.env.BASE || "http://localhost:3100";
process.env.BASE = `${BASE}/api`;
const { api, crearCheck, informeLiberado, sesiones } = await import("../lib/calidad.mjs");
const { pdfConTexto } = await import("../lib/archivos.mjs");
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const { check, terminar } = crearCheck();
const stamp = Date.now().toString(36).slice(-4).toUpperCase();
const { t, id } = await sesiones();

/* ---------- Datos de apoyo ---------- */
async function ficha(clave, paginas) {
  const fd = new FormData();
  const campos = { clave, titulo: `Visor ${clave}`, area_codigo: "TC", tipo_codigo: "P", elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.patricia };
  for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
  fd.append("archivo_pdf", new Blob([await pdfConTexto(paginas, `Visor ${clave}`)]), "visor.pdf");
  return (await api("POST", "/sgc/documentos", fd, t.ana)).data;
}
const LARGO = await ficha(`FX-TCP-L${stamp}`, 12);
await api("POST", `/sgc/revisiones/${LARGO.revision_id}/registrar-vigente`, { fecha_emision: "2025-02-01", fecha_proxima_revision: "2028-02-01" }, t.ana);
const informe = await informeLiberado(t, `VIS${stamp}`);
const INFORME_URL = `/informes/${informe.informe}/ver`;
const PDF_INFORME = `/api/informes/${informe.informe}/pdf?modo=ver`;

const executable = executablePath;
const browser = await chromium.launch({ executablePath: executable, headless: true });
const consoleErrors = [];
const nueva = async (opciones = {}) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true, ...opciones });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/Failed to load resource|status of 40[0-9]/.test(msg.text())) consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
  return { context, page };
};
const entrar = async (page, quien) => {
  const { EMAIL, credenciales } = await import("../lib/calidad.mjs");
  const email = EMAIL[quien];
  await page.goto(`${BASE}/login`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", credenciales[email]);
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 });
};
const captura = async (page, nombre = "") => page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), `fail${nombre ? `-${nombre.replace(/[^a-z]/gi, "").slice(0, 20)}` : ""}.png`), fullPage: true }).catch(() => {});
const paso = async (quien, nombre, fn, opciones) => {
  const { context, page } = await nueva(opciones);
  try {
    await entrar(page, quien);
    await fn(page, context);
  } catch (err) {
    await captura(page, nombre);
    check(nombre, false, err instanceof Error ? err.message.split("\n")[0] : String(err));
  } finally {
    await context.close();
  }
};
const barra = (page) => page.getByTestId("visor-barra");
const opacidad = (page) => barra(page).evaluate((el) => getComputedStyle(el).opacity);
const zoomTexto = (page) => page.getByTestId("visor-zoom").innerText();
const paginaActual = (page) => page.getByTestId("visor-pagina-actual").inputValue();
const esperarVisor = async (page) => {
  await page.getByTestId("visor-pdf").first().waitFor();
  await page.waitForFunction(() => /^\d+$/.test(document.querySelector("[data-testid=visor-total-paginas]")?.textContent || ""));
};
/* La barra se oculta al leer: un movimiento del cursor la vuelve a mostrar (como lo haria una persona). */
const mostrarBarra = async (page) => {
  await page.mouse.move(700, 400);
  await page.waitForTimeout(300);
};
const areaPaginas = (page) => page.locator('[aria-label="Páginas del PDF"]').first();

try {
  /* ---------- Informe liberado: barra, zoom, atajos, Lectura, miniaturas, descarga ---------- */
  await paso("patricia", "informe: barra se oculta, reaparece, zoom recordado y atajos", async (page) => {
    await page.goto(`${BASE}${INFORME_URL}`);
    await esperarVisor(page);
    await page.waitForTimeout(400);
    check("informe: barra visible al abrir", (await opacidad(page)) === "1", await opacidad(page));
    check("informe: muestra el total de páginas", /^\d+$/.test((await page.getByTestId("visor-total-paginas").innerText()).trim()));
    check("informe: miniaturas e índice cerrados por omisión", (await page.getByTestId("visor-miniaturas").count()) === 0);

    await page.waitForTimeout(3600);
    check("barra: se oculta sola tras unos segundos sin cursor", (await opacidad(page)) === "0", await opacidad(page));
    await page.mouse.move(600, 500);
    await page.waitForTimeout(350);
    check("barra: reaparece al mover el cursor", (await opacidad(page)) === "1", await opacidad(page));

    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(350);
    const bajo = await opacidad(page);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(350);
    check("barra: se oculta al desplazar hacia abajo y reaparece al subir", bajo === "0" && (await opacidad(page)) === "1", `${bajo}`);

    await page.getByRole("button", { name: "Zoom", exact: true }).click();
    await page.getByRole("menuitem", { name: "100 %" }).click();
    await page.waitForTimeout(300);
    check("zoom: menú «100 %» aplica el tamaño real", (await zoomTexto(page)).trim() === "100 %", await zoomTexto(page));
    await page.reload();
    await esperarVisor(page);
    check("zoom: se recuerda por persona al recargar", (await zoomTexto(page)).trim() === "100 %", await zoomTexto(page));

    await areaPaginas(page).click({ position: { x: 20, y: 20 } });
    await page.keyboard.press("-");
    await page.waitForTimeout(250);
    check("atajo −: alejar un paso (75 %)", (await zoomTexto(page)).trim() === "75 %", await zoomTexto(page));
    await page.keyboard.press("+");
    await page.waitForTimeout(250);
    check("atajo +: acercar un paso (100 %)", (await zoomTexto(page)).trim() === "100 %", await zoomTexto(page));

    await page.getByRole("button", { name: "Modo Lectura" }).click();
    check("modo Lectura: el visor ocupa la pantalla dentro de la plataforma", (await page.getByTestId("visor-pdf").getAttribute("data-lectura")) === "true");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    check("modo Lectura: Esc lo cierra", (await page.getByTestId("visor-pdf").getAttribute("data-lectura")) === null);

    await page.getByRole("button", { name: "Mostrar miniaturas" }).click();
    await page.getByTestId("visor-miniaturas").waitFor();
    check("miniaturas: se abren desde la barra con su página", (await page.getByRole("button", { name: "Ir a la página 1", exact: true }).count()) === 1);
  });

  await paso("patricia", "informe: descargar sin pestaña nueva y solo al pedirlo", async (page, context) => {
    await page.goto(`${BASE}${INFORME_URL}`);
    await esperarVisor(page);
    const paginasAntes = context.pages().length;
    const [descarga] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Descargar", exact: true }).click()]);
    check("descargar: el archivo se baja solo al pulsar «Descargar»", /\.pdf$/i.test(descarga.suggestedFilename()), descarga.suggestedFilename());
    check("descargar: no abre pestaña nueva", context.pages().length === paginasAntes);
    check("imprimir: el botón está habilitado con permiso", await page.getByRole("button", { name: "Imprimir", exact: true }).isEnabled());
  });

  await paso("patricia", "informe: reduced-motion quita transiciones de la barra", async (page) => {
    await page.goto(`${BASE}${INFORME_URL}`);
    await esperarVisor(page);
    const normal = await barra(page).evaluate((el) => getComputedStyle(el).transitionDuration);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await esperarVisor(page);
    const reducida = await barra(page).evaluate((el) => getComputedStyle(el).transitionDuration);
    check("reduced-motion: la barra no anima (transición 0 s)", parseFloat(reducida) < 0.001 && parseFloat(normal) > 0.1, `${normal} → ${reducida}`);
  }, { reducedMotion: "no-preference" });

  /* ---------- Ficha SGC de 12 páginas: busqueda, indice, modo oscuro ---------- */
  await paso("ana", "SGC 12 páginas: búsqueda, salto de página, miniaturas e índice", async (page) => {
    await page.goto(`${BASE}/documentos/${LARGO.id}`);
    await page.getByTestId("sgc-visor").waitFor();
    await esperarVisor(page);
    check("SGC: el PDF muestra «de 12»", (await page.getByTestId("visor-total-paginas").innerText()).trim() === "12");

    await areaPaginas(page).click({ position: { x: 20, y: 20 } });
    await page.keyboard.press("ControlOrMeta+f");
    await page.getByTestId("visor-buscar").fill("saxitoxina");
    await page.getByTestId("visor-buscar").press("Enter");
    await page.waitForFunction(() => /^1 de \d+$/.test(document.querySelector("[data-testid=visor-resultados]")?.textContent || ""), null, { timeout: 60_000 });
    const resultado = (await page.getByTestId("visor-resultados").innerText()).trim();
    check("búsqueda: contador «1 de N» con coincidencias en el documento", Number(resultado.split(" de ")[1]) >= 12, resultado);
    await page.getByRole("button", { name: "Coincidencia siguiente" }).click();
    await page.waitForTimeout(200);
    check("búsqueda: la flecha avanza a «2 de N»", (await page.getByTestId("visor-resultados").innerText()).trim().startsWith("2 de "));

    await page.getByRole("button", { name: "Cerrar búsqueda" }).click();
    await areaPaginas(page).click({ position: { x: 20, y: 20 } });
    await page.keyboard.press("Home");
    await page.waitForTimeout(500);
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(900);
    check("atajo RePág: pasa a la página siguiente", (await paginaActual(page)) === "2", await paginaActual(page));

    await mostrarBarra(page);
    await page.getByRole("button", { name: "Mostrar miniaturas" }).click();
    await page.getByTestId("visor-miniaturas").waitFor();
    const miniaturas = await page.getByRole("button", { name: /^Ir a la página \d+$/ }).count();
    check("miniaturas: una por página (12)", miniaturas === 12, `${miniaturas}`);
    await mostrarBarra(page);
    await page.getByRole("tab", { name: /Índice/ }).click();
    await page.getByRole("button", { name: "Sección 3", exact: true }).waitFor();
    await mostrarBarra(page);
    await page.getByRole("button", { name: "Sección 3", exact: true }).click();
    await page.waitForTimeout(900);
    check("índice: «Sección 3» lleva a su página", (await paginaActual(page)) === "3", await paginaActual(page));
  });

  await paso("ana", "SGC: modo oscuro cambia la superficie del visor", async (page) => {
    await page.goto(`${BASE}/documentos/${LARGO.id}`);
    await esperarVisor(page);
    const claro = await areaPaginas(page).evaluate((el) => getComputedStyle(el).backgroundColor);
    const oscuroCtx = await browser.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: "dark" });
    const p2 = await oscuroCtx.newPage();
    p2.setDefaultTimeout(45_000);
    await entrar(p2, "ana");
    await p2.goto(`${BASE}/documentos/${LARGO.id}`);
    await esperarVisor(p2);
    const oscuro = await areaPaginas(p2).evaluate((el) => getComputedStyle(el).backgroundColor);
    await oscuroCtx.close();
    check("modo oscuro: el fondo del visor es distinto al claro", claro !== oscuro, `${claro} / ${oscuro}`);
  });

  /* ---------- Tableta: doble toque y deslizar ---------- */
  await paso("ana", "tableta: doble toque para acercar y deslizar entre páginas", async (page, context) => {
    await page.goto(`${BASE}/documentos/${LARGO.id}`);
    await esperarVisor(page);
    const caja = await areaPaginas(page).boundingBox();
    const cx = caja.x + caja.width / 2;
    const cy = caja.y + caja.height / 3;
    await page.touchscreen.tap(cx, cy);
    await page.touchscreen.tap(cx, cy);
    await page.waitForTimeout(400);
    check("tableta: doble toque acerca a 200 %", (await zoomTexto(page)).trim() === "200 %", await zoomTexto(page));
    await page.touchscreen.tap(cx, cy);
    await page.touchscreen.tap(cx, cy);
    await page.waitForTimeout(400);
    check("tableta: otro doble toque vuelve a ajustar al ancho", (await zoomTexto(page)).trim() !== "200 %", await zoomTexto(page));

    const cdp = await context.newCDPSession(page);
    const tacto = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    await tacto("touchStart", cx + 200, cy);
    for (let i = 1; i <= 10; i += 1) await tacto("touchMove", cx + 200 - i * 40, cy);
    await tacto("touchEnd", cx - 200, cy);
    await page.waitForTimeout(900);
    check("tableta: deslizar a la izquierda pasa a la página 2", (await paginaActual(page)) === "2", await paginaActual(page));
  }, { hasTouch: true, viewport: { width: 820, height: 1180 } });

  /* ---------- Visor interno flotante (reportes, NC) ---------- */
  await paso("patricia", "flotante: error claro con reintento; Esc cierra; descarga solo al pedirla", async (page, context) => {
    await page.goto(`${BASE}${INFORME_URL}`);
    await esperarVisor(page);
    const abrir = (url) => page.evaluate((u) => window.dispatchEvent(new CustomEvent("ficotox:ver-pdf", { detail: { url: u, nombre: "prueba.pdf", titulo: "Prueba de visor" } })), url);
    await abrir("/api/sgc/archivos/999999?modo=ver");
    await page.getByText("No se pudo cargar el documento").waitFor({ timeout: 60_000 });
    check("error: «No se pudo cargar el documento» con Reintentar", await page.getByRole("button", { name: "Reintentar" }).isVisible());
    await page.getByRole("button", { name: "Cerrar", exact: true }).click();

    await abrir(PDF_INFORME);
    await page.getByRole("dialog", { name: "Prueba de visor" }).waitFor();
    await page.getByRole("dialog").getByTestId("visor-pdf").waitFor();
    await esperarVisor(page);
    const paginasAntes = context.pages().length;
    const [descarga] = await Promise.all([page.waitForEvent("download"), page.getByRole("dialog").getByRole("button", { name: "Descargar", exact: true }).click()]);
    check("flotante: descargar solo al pulsar y sin pestaña nueva", descarga && context.pages().length === paginasAntes);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Prueba de visor" }).waitFor({ state: "detached" }).catch(() => undefined);
    check("flotante: Esc cierra el visor", (await page.getByRole("dialog", { name: "Prueba de visor" }).count()) === 0);
  });

  check("sin errores de consola", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} catch (err) {
  check("suite visor", false, err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
}
terminar();
