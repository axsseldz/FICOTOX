/*
 * «Restaurar este respaldo» en Calidad › Respaldos (navegador).
 * - El Administrador técnico (respaldos:G) ve la acción en el menú del renglón y
 *   en la ficha; la ventana muestra la fecha del respaldo, la advertencia «Se
 *   perderá todo lo registrado después del DD/MM/AAAA HH:MM», y pide motivo y
 *   contraseña. Al enviarla queda una solicitud pendiente (se cancela por la API).
 * - La Responsable General (solo respaldos:V) no ve la acción.
 * - Pantalla de espera: con la API respondiendo 503 «restaurando» se muestra
 *   «Restaurando la plataforma, vuelve en un momento»; cuando vuelve a atender y
 *   la sesión ya no vale, lleva al acceso con el aviso de la restauración.
 * La restauración real (y sus rechazos) la prueba tests/api-restaurar.mjs.
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
const { t } = await sesiones();

/* ---------- Datos: un respaldo recién creado ---------- */
let respaldo = null;
{
  const r = await api("POST", "/respaldos", { etiqueta: "Prueba de la ventana de restaurar" }, t.jorge);
  for (let i = 0; r.status === 202 && i < 240 && !respaldo; i += 1) {
    const trabajo = (await api("GET", "/respaldos/estado", undefined, t.jorge)).data?.trabajo;
    if (trabajo?.tipo === "respaldo" && trabajo.estado !== "en_curso") respaldo = trabajo.respaldo_id;
    else await new Promise((res) => setTimeout(res, 500));
  }
  check("datos: respaldo creado", !!respaldo, `${r.status} ${respaldo}`);
}

const browser = await chromium.launch({ executablePath, headless: true });
const paso = async (nombre, quien, fn) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
    await page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), "fail-respaldos-restaurar.png"), fullPage: true }).catch(() => {});
    check(`${nombre}: sin errores`, false, error.message.split("\n")[0]);
  } finally {
    await context.close();
  }
};
const renglon = (page) => page.locator(`[data-respaldo="${respaldo}"]`);

await paso("Administrador técnico", "jorge", async (page) => {
  await page.goto(`${BASE}/calidad/respaldos`);
  await renglon(page).getByRole("button", { name: "Acciones" }).click();
  const opcion = page.getByRole("menuitem", { name: /Restaurar este respaldo/ });
  check("el menú del respaldo ofrece «Restaurar este respaldo»", await opcion.isVisible());
  await opcion.click();
  const dialogo = page.getByRole("dialog", { name: "Restaurar este respaldo" });
  await dialogo.waitFor();
  const aviso = (await dialogo.locator("[data-aviso-restaurar]").textContent()) || "";
  const fecha = /Se perderá todo lo registrado después del (\d{2}\/\d{2}\/\d{4} \d{2}:\d{2})/.exec(aviso)?.[1];
  const texto = (await dialogo.textContent()) || "";
  check("la ventana muestra la fecha del respaldo y «Se perderá todo lo registrado después del DD/MM/AAAA HH:MM»", !!fecha && texto.includes(`Respaldo del ${fecha}`), aviso.slice(0, 120));
  check("la ventana avisa del respaldo «Previo a restauración» y de que todos vuelven a iniciar sesión", /Previo a restauración/.test(aviso) && /vuelven a iniciar sesión/.test(aviso));
  // Sin motivo ni contraseña no se envía.
  await dialogo.getByRole("button", { name: "Solicitar restauración" }).click();
  const faltan = await page.getByText("Indica el motivo (al menos 5 caracteres)").first().isVisible().catch(() => false);
  check("sin motivo no se envía (aviso del campo)", faltan);
  await page.getByRole("button", { name: "Entendido" }).click();
  await dialogo.locator("#respaldo-motivo").fill("Prueba de la ventana de restaurar");
  await dialogo.locator("#respaldo-password").fill(credenciales[EMAIL.jorge]);
  await dialogo.getByRole("button", { name: "Solicitar restauración" }).click();
  await page.getByText(/Solicitud enviada/).first().waitFor();
  check("al enviarla avisa que otra persona (Responsable General) debe aprobarla", true);
  const pendiente = ((await api("GET", "/solicitudes?estado=pendiente", undefined, t.jorge)).data?.items || []).find((s) => s.tipo === "restaurar_respaldo" && s.entidad_id === respaldo);
  check("queda una solicitud de restauración pendiente con el motivo", pendiente?.motivo === "Prueba de la ventana de restaurar", JSON.stringify(pendiente || {}).slice(0, 120));
  if (pendiente) await api("POST", `/solicitudes/${pendiente.id}/cancelar`, { motivo: "Fin de la prueba de la ventana" }, t.jorge);
  // También desde la ficha del respaldo.
  await renglon(page).click();
  const enFicha = await page.locator("[data-restaurar-respaldo]").waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
  check("la ficha del respaldo también tiene «Restaurar este respaldo»", enFicha);
});

await paso("Responsable General", "patricia", async (page) => {
  await page.goto(`${BASE}/calidad/respaldos`);
  await renglon(page).waitFor();
  const menu = await renglon(page).getByRole("button", { name: "Acciones" }).count();
  await renglon(page).click();
  await page.getByText("Recuperar la plataforma").first().waitFor({ timeout: 15_000 });
  const enFicha = await page.locator("[data-restaurar-respaldo]").count();
  check("sin respaldos:G no aparece «Restaurar este respaldo» (ni en el menú ni en la ficha)", menu === 0 && enFicha === 0, `${menu} ${enFicha}`);
});

await paso("Pantalla de espera", "patricia", async (page) => {
  await page.goto(`${BASE}/calidad/respaldos`);
  await renglon(page).waitFor();
  // La API responde como durante una restauración.
  const restaurando = (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Restaurando la plataforma, vuelve en un momento", codigo: "restaurando" }) });
  await page.route("**/api/**", restaurando);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const pantalla = page.locator("[data-restaurando]");
  await pantalla.waitFor({ timeout: 20_000 });
  check("con la API en restauración se ve «Restaurando la plataforma, vuelve en un momento»", /Restaurando la plataforma, vuelve en un momento/.test((await pantalla.textContent()) || ""));
  // Termina: la API vuelve a atender y la sesión ya no vale (la restauración cerró todas).
  await page.unroute("**/api/**", restaurando);
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "Tu sesión se cerró", codigo: "sesion_revocada" }) }));
  await page.waitForURL((url) => url.pathname.startsWith("/login"), { timeout: 20_000 });
  const aviso = await page.getByText("La plataforma se restauró desde un respaldo").first().isVisible().catch(() => false);
  check("al terminar lleva al acceso con el aviso de la restauración", aviso && (await pantalla.count()) === 0);
});

await browser.close();
terminar();
