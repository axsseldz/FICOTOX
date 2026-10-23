/*
 * Respaldos portables en Calidad › Respaldos (navegador).
 * - «Descargar» (menú ⋯ y ficha): aviso de que sin la contraseña no se puede
 *   restaurar, contraseña de cifrado escrita dos veces (si no coinciden, no se
 *   envía), confirmación con la contraseña de la cuenta y descarga de un .ficotox
 *   que se descifra al respaldo elegido.
 * - «Importar respaldo»: archivo, contraseña del archivo y de la cuenta, avance;
 *   queda en la lista como «Importado».
 * - Un respaldo sellado con otra llave muestra «Llave distinta» y no deja
 *   restaurarlo (menú y ficha), con la explicación.
 * - La Responsable General (solo respaldos:V) no ve descargar ni importar.
 * - A 400 px la ventana de importar cabe sin desbordes.
 */
import "../lib/reauth-auto.mjs";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { abrirPortable, escribirPortable } from "../../src/lib/shared/respaldo-portable.mjs";
import { respaldoAjeno, subirPorPartes } from "../lib/portables.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const BASE = process.env.BASE || "http://localhost:3100";
process.env.BASE = `${BASE}/api`;
const { api, crearCheck, credenciales, EMAIL, sesiones } = await import("../lib/calidad.mjs");
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const { check, terminar } = crearCheck();
const { t } = await sesiones();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ficotox-ui-portables-"));
const CIFRADO = "Contraseña de la prueba UI 2026";

async function esperarTrabajo(tipo) {
  for (let i = 0; i < 480; i += 1) {
    const trabajo = (await api("GET", "/respaldos/estado", undefined, t.jorge)).data?.trabajo;
    if (trabajo?.tipo === tipo && trabajo.estado !== "en_curso") return trabajo;
    await new Promise((res) => setTimeout(res, 250));
  }
  return null;
}

/* ---------- Datos: un respaldo propio y uno de otra instalación (otra llave) ya importado ---------- */
let respaldo = null;
{
  const r = await api("POST", "/respaldos", { etiqueta: "Prueba de descargar e importar" }, t.jorge);
  respaldo = r.status === 202 ? (await esperarTrabajo("respaldo"))?.respaldo_id : null;
  check("datos: respaldo creado", !!respaldo, `${r.status} ${respaldo}`);
}
let ajeno = null;
{
  const archivo = path.join(TMP, "ajeno.ficotox");
  await escribirPortable(respaldoAjeno(path.join(TMP, "ajena")), CIFRADO, archivo);
  const s = await subirPorPartes({ base: process.env.BASE, inicio: "/respaldos/importar/subidas", datos: fs.readFileSync(archivo), headers: { Authorization: `Bearer ${t.jorge}` } });
  const r = await api("POST", "/respaldos/importar", { subida: s.id, contrasena: CIFRADO }, t.jorge);
  ajeno = r.status === 202 ? (await esperarTrabajo("importacion"))?.respaldo_id : null;
  check("datos: respaldo de otra instalación importado", !!ajeno, `${r.status} ${ajeno}`);
}

const browser = await chromium.launch({ executablePath, headless: true });
const paso = async (nombre, quien, fn, opciones = {}) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...opciones });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  try {
    await page.goto(`${BASE}/login`);
    await page.fill("#login-email", EMAIL[quien]);
    await page.fill("#login-password", credenciales[EMAIL[quien]]);
    await page.click("button[type=submit]");
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 });
    await fn(page);
  } catch (error) {
    await page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), "fail-respaldos-portables.png"), fullPage: true }).catch(() => {});
    check(`${nombre}: sin errores`, false, error.message.split("\n")[0]);
  } finally {
    await context.close();
  }
};
const renglon = (page, id) => page.locator(`[data-respaldo="${id}"]`).first();
let descargado = null;

await paso("Descargar", "jorge", async (page) => {
  await page.goto(`${BASE}/calidad/respaldos`);
  await renglon(page, respaldo).getByRole("button", { name: "Acciones" }).click();
  await page.getByRole("menuitem", { name: /Descargar/ }).click();
  const dialogo = page.getByRole("dialog", { name: "Descargar respaldo" });
  await dialogo.waitFor();
  const aviso = (await dialogo.locator("[data-aviso-descarga]").textContent()) || "";
  check("la ventana avisa que sin la contraseña el archivo no se puede restaurar", /no se puede restaurar/.test(aviso), aviso.slice(0, 100));
  await dialogo.locator("#descarga-contrasena").fill(CIFRADO);
  await dialogo.locator("#descarga-confirmacion").fill(`${CIFRADO}?`);
  await dialogo.locator("#descarga-password").fill(credenciales[EMAIL.jorge]);
  await dialogo.getByRole("button", { name: "Descargar" }).click();
  const noCoinciden = await page.getByText("Las dos contraseñas de cifrado no coinciden").first().isVisible().catch(() => false);
  check("si las dos contraseñas no coinciden no se descarga", noCoinciden);
  await page.getByRole("button", { name: "Entendido" }).click();
  await dialogo.locator("#descarga-confirmacion").fill(CIFRADO);
  const [descarga] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), dialogo.getByRole("button", { name: "Descargar" }).click()]);
  descargado = path.join(TMP, descarga.suggestedFilename());
  await descarga.saveAs(descargado);
  const abierto = await abrirPortable({ archivo: descargado, contrasena: CIFRADO, destino: path.join(TMP, "abierto") });
  check("se descarga el .ficotox del respaldo elegido y se descifra con su contraseña", descarga.suggestedFilename() === `ficotox-respaldo-${respaldo}.ficotox` && abierto.manifest?.id === respaldo, descarga.suggestedFilename());
  await dialogo.waitFor({ state: "hidden" });
  await renglon(page, respaldo).click();
  const enFicha = await page.locator("[data-descargar-respaldo]").waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
  check("la ficha del respaldo también ofrece «Descargar»", enFicha);
});

await paso("Importar", "jorge", async (page) => {
  await page.goto(`${BASE}/calidad/respaldos`);
  await page.locator("[data-importar-respaldo]").click();
  const dialogo = page.getByRole("dialog", { name: "Importar respaldo" });
  await dialogo.waitFor();
  await dialogo.locator("#importar-archivo").setInputFiles(descargado);
  await dialogo.locator("#importar-contrasena").fill(CIFRADO);
  await dialogo.locator("#importar-password").fill(credenciales[EMAIL.jorge]);
  await dialogo.getByRole("button", { name: "Importar" }).click();
  await page.getByText(/Respaldo importado/).first().waitFor({ timeout: 180_000 });
  const fila = renglon(page, `${respaldo}-2`);
  await fila.waitFor({ timeout: 30_000 });
  check("queda en la lista como «Importado»", ((await fila.textContent()) || "").includes("Importado"));
});

await paso("Otra llave", "jorge", async (page) => {
  await page.goto(`${BASE}/calidad/respaldos`);
  const fila = renglon(page, ajeno);
  await fila.waitFor();
  check("un respaldo de otra instalación muestra «Llave distinta»", ((await fila.textContent()) || "").includes("Llave distinta"));
  await fila.getByRole("button", { name: "Acciones" }).click();
  const opcion = page.getByRole("menuitem", { name: /Restaurar este respaldo/ });
  check("en el menú «Restaurar este respaldo» está deshabilitado y dice por qué", (await opcion.getAttribute("aria-disabled")) === "true" || (await opcion.getAttribute("data-disabled")) !== null, ((await opcion.textContent()) || "").slice(0, 140));
  await page.keyboard.press("Escape");
  await fila.click();
  await page.locator("[data-llave-distinta]").waitFor();
  check("la ficha explica que solo se recupera en una instalación nueva o por terminal", /Configuración inicial/.test((await page.locator("[data-llave-distinta]").textContent()) || "") && (await page.locator("[data-restaurar-respaldo]").isDisabled()));
});

await paso("Solo consulta", "patricia", async (page) => {
  await page.goto(`${BASE}/calidad/respaldos`);
  await renglon(page, respaldo).waitFor();
  check("la Responsable General no ve «Importar respaldo»", (await page.locator("[data-importar-respaldo]").count()) === 0);
  check("ni el menú con «Descargar»", (await renglon(page, respaldo).getByRole("button", { name: "Acciones" }).count()) === 0);
});

await paso("Teléfono", "jorge", async (page) => {
  await page.goto(`${BASE}/calidad/respaldos`);
  await page.locator("[data-importar-respaldo]").click();
  await page.getByRole("dialog", { name: "Importar respaldo" }).waitFor();
  check("a 400 px la ventana de importar cabe sin desbordes", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
}, { viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true });

await browser.close();
fs.rmSync(TMP, { recursive: true, force: true });
terminar();
