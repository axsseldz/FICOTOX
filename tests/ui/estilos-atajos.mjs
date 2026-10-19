/*
 * Estilo unificado y atajos por sistema (revisión UI/UX):
 * - foco: en campos de texto, buscador, área de texto y selector el borde toma el color de foco
 *   (--color-focus), sin sombra ni contorno de color; en botones, con teclado, contorno de 2 px del
 *   mismo color y sin sombra de color; igual en tema claro y oscuro;
 * - componentes alineados: buscador y botón mediano de 40 px en el encabezado de las listas; a 400 px
 *   el buscador ocupa el ancho disponible; a 820 px la lista de Usuarios pasa a tarjetas sin cortar
 *   columnas y sin desplazamiento horizontal;
 * - atajos: en Mac ⌘K abre el buscador y Ctrl+K no; en Windows Ctrl+K lo abre y ⌘ no; la Ayuda y el
 *   aviso del botón «Buscar» escriben ⌘K o Ctrl+K según el sistema; sin errores de consola.
 */
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const BASE = process.env.BASE || "http://localhost:3100";
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const UA_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const UA_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/* La apariencia guardada en la cuenta manda sobre la del navegador: se fija por la API y al final se repone. */
const sesion = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "qa@ficotox.local", password: "QaFicotox2026!" }) }).then((r) => r.json());
const conToken = { "Content-Type": "application/json", Authorization: `Bearer ${sesion.token}` };
const temaOriginal = (await fetch(`${BASE}/api/auth/me`, { headers: conToken }).then((r) => r.json())).user?.tema || "auto";
const fijarTema = (tema) => fetch(`${BASE}/api/auth/me/tema`, { method: "PUT", headers: conToken, body: JSON.stringify({ tema }) });

const browser = await chromium.launch({ executablePath, headless: true });
const errores = [];

async function abrir({ userAgent = UA_MAC, width = 1360, tema = "claro" } = {}) {
  await fijarTema(tema);
  const context = await browser.newContext({ viewport: { width, height: 900 }, userAgent });
  await context.addInitScript((t) => localStorage.setItem("ficotox-tema", t), tema);
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  page.on("pageerror", (e) => errores.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|favicon/.test(m.text()) && errores.push(`console: ${m.text().slice(0, 200)}`));
  await page.goto(`${BASE}/login`);
  await page.fill("#login-email", "qa@ficotox.local");
  await page.fill("#login-password", "QaFicotox2026!");
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return { context, page };
}

/* Color de foco del tema resuelto a rgb(), para comparar con los estilos calculados. */
const colorFoco = (page) =>
  page.evaluate(() => {
    const el = document.createElement("span");
    el.style.color = "var(--color-focus)";
    document.body.append(el);
    const c = getComputedStyle(el).color;
    el.remove();
    return c;
  });

/* Se espera a que termine la transición de color del borde antes de leer el estilo. */
const estiloFoco = async (loc) => {
  await loc.page().waitForTimeout(350);
  return loc.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { borde: cs.borderTopColor, sombra: cs.boxShadow, contorno: cs.outlineStyle, colorContorno: cs.outlineColor, anchoContorno: cs.outlineWidth };
  });
};

async function revisarCampos(page, tema) {
  await page.goto(`${BASE}/muestras/recepcion`);
  const foco = await colorFoco(page);
  const resuelto = await page.evaluate(() => document.documentElement.dataset.theme);
  check(`[${tema}] el tema se aplica (${resuelto})`, resuelto === (tema === "oscuro" ? "dark" : "light"));
  const buscador = page.locator("main input[type=search]").first();
  await buscador.click();
  let e = await estiloFoco(buscador);
  check(`[${tema}] buscador enfocado: borde del color de foco, sin sombra ni contorno`, e.borde === foco && e.sombra === "none" && e.contorno === "none", JSON.stringify(e));

  await page.goto(`${BASE}/muestras/recepcion/nueva`);
  const texto = page.locator("main input[type=text]:not([readonly]):not([disabled])").first();
  await texto.click();
  e = await estiloFoco(texto);
  check(`[${tema}] campo de texto enfocado: borde del color de foco, sin sombra ni contorno`, e.borde === foco && e.sombra === "none" && e.contorno === "none", JSON.stringify(e));
  const area = page.locator("main textarea:not([readonly]):not([disabled]):visible").first();
  if (await area.count()) {
    await area.scrollIntoViewIfNeeded();
    await area.click();
    e = await estiloFoco(area);
    check(`[${tema}] área de texto enfocada: mismo foco que los campos`, e.borde === foco && e.sombra === "none" && e.contorno === "none", JSON.stringify(e));
  }

  // Botones con teclado: contorno de 2 px del color de foco y sin sombra de color.
  await page.goto(`${BASE}/muestras/recepcion`);
  await page.locator("main input[type=search]").first().click();
  let boton = null;
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const tag = await page.evaluate(() => (document.activeElement?.closest("main") ? document.activeElement.tagName : ""));
    if (tag === "BUTTON" || tag === "A") {
      boton = page.locator(":focus");
      break;
    }
  }
  if (boton) {
    e = await estiloFoco(boton);
    check(`[${tema}] botón con teclado: contorno de 2 px del color de foco, sin brillo del color de foco`, e.contorno === "solid" && e.colorContorno === foco && e.anchoContorno === "2px" && !e.sombra.includes(foco.slice(4, -1)), JSON.stringify(e));
  } else check(`[${tema}] botón con teclado alcanzable con Tab`, false);
}

try {
  /* ---------- Foco, tema claro y oscuro ---------- */
  for (const tema of ["claro", "oscuro"]) {
    const { context, page } = await abrir({ tema });
    await revisarCampos(page, tema);
    await context.close();
  }

  /* ---------- Componentes alineados ---------- */
  {
    const { context, page } = await abrir({ width: 1440 });
    await page.goto(`${BASE}/muestras/recepcion`);
    const buscador = page.locator("main input[type=search]").first();
    await buscador.waitFor();
    const nueva = page.locator("main a, main button").filter({ hasText: "Nueva recepción" }).first();
    const alturas = [Math.round((await buscador.boundingBox()).height), Math.round((await nueva.boundingBox()).height)];
    check("buscador y botón mediano del encabezado miden 40 px", alturas.every((h) => h === 40), alturas.join("/"));
    await page.setViewportSize({ width: 400, height: 900 });
    await page.waitForTimeout(300);
    const ancho = Math.round((await buscador.boundingBox()).width);
    check("a 400 px el buscador ocupa el ancho disponible (no queda angosto)", ancho >= 220, `${ancho}px`);

    await page.setViewportSize({ width: 820, height: 900 });
    await page.goto(`${BASE}/administracion/usuarios`);
    const lista = page.locator("[data-cuadricula]").first();
    await lista.waitFor();
    await page.waitForTimeout(300);
    const modo = await lista.getAttribute("data-cuadricula");
    const desborde = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const cortes = await lista.evaluate((el) => [...el.querySelectorAll("li *")].filter((n) => n.children.length === 0 && n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflow === "hidden" && !getComputedStyle(n).textOverflow.includes("ellipsis")).length);
    check("a 820 px la lista de Usuarios no se sale ni corta columnas", desborde <= 0 && cortes === 0, `modo=${modo} desborde=${desborde} cortes=${cortes}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    check("a 1440 px la misma lista se ve en columnas", (await lista.getAttribute("data-cuadricula")) === "si");
    await context.close();
  }

  /* ---------- Atajos por sistema ---------- */
  for (const [sistema, userAgent, propio, ajeno, texto] of [
    ["Mac", UA_MAC, "Meta+k", "Control+k", "⌘K"],
    ["Windows", UA_WINDOWS, "Control+k", "Meta+k", "Ctrl+K"],
  ]) {
    const { context, page } = await abrir({ userAgent });
    await page.goto(`${BASE}/inventario/reactivos`);
    await page.locator("main").waitFor();
    const buscar = page.getByRole("dialog", { name: "Buscar" });
    await page.keyboard.press(ajeno);
    await page.waitForTimeout(400);
    check(`${sistema}: ${ajeno.replace("+k", "+K")} no abre el buscador`, !(await buscar.isVisible()));
    await page.keyboard.press(propio);
    await buscar.waitFor();
    check(`${sistema}: ${propio.replace("+k", "+K")} abre el buscador`, await buscar.isVisible());
    await page.keyboard.press("Escape");
    await buscar.waitFor({ state: "hidden" });

    await page.getByRole("button", { name: "Buscar", exact: true }).first().hover();
    const aviso = page.getByRole("tooltip").first();
    await aviso.waitFor();
    check(`${sistema}: el aviso del botón Buscar dice «${texto}»`, (await aviso.textContent()).includes(texto), await aviso.textContent());

    await page.goto(`${BASE}/ayuda`);
    const kbd = page.locator('[data-atajo="Mod+K"]').first();
    await kbd.waitFor();
    const enAyuda = (await kbd.textContent()).replace(/\s+/g, "");
    check(`${sistema}: la Ayuda muestra el atajo como ${texto}`, enAyuda === texto.replace("+", ""), enAyuda);
    const buscarDoc = (await page.locator('[data-atajo="Mod+F"]').first().textContent()).replace(/\s+/g, "");
    check(`${sistema}: el atajo de buscar en el documento se escribe ${sistema === "Mac" ? "⌘F" : "CtrlF"}`, buscarDoc === (sistema === "Mac" ? "⌘F" : "CtrlF"), buscarDoc);
    await context.close();
  }

  check("sin errores de consola ni de página", errores.length === 0, errores.slice(0, 3).join(" | "));
} catch (error) {
  check("recorrido de estilo y atajos sin excepciones", false, error.message);
} finally {
  await browser.close();
  await fijarTema(temaOriginal);
}

const fallas = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fallas}/${results.length} verificaciones de estilo y atajos`);
process.exit(fallas ? 1 : 0);
