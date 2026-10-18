/*
 * Documentos SGC, Fase 3, en el navegador (datos de apoyo por la API):
 * - vista general con indicadores y accesos a Externos y Lista Maestra;
 * - Mejora Continua registra un externo (validaciones y contrasena) y verifica su vigencia;
 * - Mejora Continua agrega destinatarios con motivo y contrasena; avance de lecturas en la ficha;
 * - el destinatario ve la lectura pendiente en su bandeja, abre el PDF y confirma "Confirmo que lei y comprendi";
 * - Lista Maestra con revision en curso; "Ver PDF" se abre en el visor interno sin pestana nueva ni descarga;
 * - negativos por URL directa (sin botones para quien no puede; el admin tecnico no consulta la Lista Maestra);
 * - modo claro y oscuro, tableta sin desbordes; sin errores de consola.
 */
import "../lib/reauth-auto.mjs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const BASE = process.env.BASE || "http://localhost:3100";
process.env.BASE = `${BASE}/api`;
const { api, credenciales, crearCheck, EMAIL, sesiones } = await import("../lib/calidad.mjs");
const { pdfConTexto } = await import("../lib/archivos.mjs");
const { accion, contarAccion, motivo, cerrarMenu, pestana } = await import("../lib/ficha.mjs");
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const { check, terminar } = crearCheck();
const stamp = Date.now().toString(36).slice(-4).toUpperCase();
const { t, id } = await sesiones();

/* ---------- Datos de apoyo ---------- */
async function ficha(campos) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
  fd.append("archivo_pdf", new Blob([await pdfConTexto(2, campos.titulo)]), "inicial.pdf");
  return (await api("POST", "/sgc/documentos", fd, t.ana)).data;
}
const D = await ficha({ clave: `FX-TCP-V${stamp}`, titulo: `Procedimiento distribuido UI ${stamp}`, area_codigo: "TC", tipo_codigo: "P", elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.patricia });
await api("POST", `/sgc/revisiones/${D.revision_id}/registrar-vigente`, { fecha_emision: "2025-02-01", fecha_proxima_revision: "2028-02-01" }, t.ana);
await api("POST", `/sgc/revisiones/${D.revision_id}/distribucion`, { usuarios: [id.luis], punto_uso: "Área de extracción", requiere_lectura: true, motivo: "Distribución de apoyo para la prueba" }, t.ana);
// Revision en curso (para la Lista Maestra).
await api("POST", `/sgc/documentos/${D.id}/revisiones`, { motivo_cambio: "Actualización en curso", elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.patricia }, t.ana);
const roles = (await api("GET", "/admin/roles", undefined, t.qa)).data?.items || [];
const IDENT = `NOM-242-SSA1-${stamp}`;

const browser = await chromium.launch({ executablePath, headless: true });
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
  const email = EMAIL[quien];
  await page.goto(`${BASE}/login`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", credenciales[email]);
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 });
};
/* Cierra el resumen de validacion y espera a que el foco regrese al formulario (como haria una persona). */
const entendido = async (page) => {
  await page.getByRole("button", { name: "Entendido" }).click();
  await page.getByRole("button", { name: "Entendido" }).waitFor({ state: "detached" });
  await page.waitForTimeout(400);
};
const contrasena = async (page, quien) => {
  await page.locator("#reauth-password").fill(credenciales[EMAIL[quien]]);
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
};
const captura = async (page, nombre = "") => page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), `fail${nombre ? `-${nombre.replace(/[^a-z]/gi, "").slice(0, 20)}` : ""}.png`), fullPage: true }).catch(() => {});
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const paso = async (quien, nombre, fn, opciones) => {
  const { context, page } = await nueva(opciones);
  try {
    await entrar(page, quien);
    await fn(page, context);
  } catch (err) {
    await captura(page, nombre);
    const linea = err instanceof Error ? (err.stack || "").split("\n").find((l) => l.includes("documentos-fase3.mjs")) || "" : "";
    check(nombre, false, `${err instanceof Error ? err.message.split("\n")[0] : String(err)} ${linea.trim()}`);
  } finally {
    await context.close();
  }
};

try {
  /* ---------- Mejora Continua: vista general y externo ---------- */
  await paso("ana", "Ana: vista general y externo", async (page) => {
    await page.goto(`${BASE}/documentos`);
    await page.getByTestId("sgc-carpetas").waitFor();
    // Los cuatro indicadores volvieron al inicio (especificación §5 y §8; ver ui/documentos-inicio.mjs); la actividad y los accesos siguen en el menú.
    check("inicio: los cuatro indicadores, sin actividad ni accesos duplicados (viven en el menú)", (await page.getByTestId("sgc-indicador").count()) === 4 && (await page.getByTestId("sgc-actividad").count()) === 0 && (await page.getByTestId("sgc-ir-externos").count()) === 0);
    check("inicio: buscador de documentos", (await page.getByTestId("sgc-buscador").count()) === 1);
    check("modo claro por omisión", (await page.evaluate(() => document.documentElement.dataset.theme || "light")) !== "dark");
    await page.locator('aside[aria-label="Navegación principal"] a[href="/documentos/externos"]').first().click();
    await page.getByRole("heading", { name: "Documentos externos" }).waitFor();
    await page.getByTestId("ext-registrar").click();
    await page.locator("#ext-id").fill(`FX-ABC-${stamp}`);
    await page.getByTestId("ext-guardar").click();
    await page.getByText("El prefijo FX- es de los documentos internos").first().waitFor();
    check("registrar externo: el prefijo FX- y los obligatorios se marcan antes de enviar", (await page.getByText("Indica el emisor o fuente").count()) > 0);
    await entendido(page);
    await page.locator("#ext-id").fill(IDENT);
    await page.locator("#ext-fuente").fill("Secretaría de Salud");
    await page.locator("#ext-titulo").fill(`Productos de la pesca frescos y congelados ${stamp}`);
    await page.locator("#ext-area").selectOption("TC");
    await page.locator("#ext-tipo").selectOption("R");
    await page.locator("#ext-version").fill("2009");
    await page.getByRole("dialog").getByRole("button", { name: "Más opciones" }).click();
    await page.locator("#ext-enlace").fill("https://www.dof.gob.mx");
    await page.locator("#ext-responsable").selectOption(String(id.ricardo));
    await page.getByTestId("ext-guardar").click();
    await contrasena(page, "ana");
    await page.waitForURL(/\/documentos\/\d+$/);
    await page.getByTestId("sgc-externo").waitFor();
    await page.getByTestId("ext-verificar").waitFor();
    const seguimiento = (await page.getByTestId("sgc-externo").textContent()) || "";
    const claveFicha = await page.getByTestId("sgc-clave").innerText();
    check("el externo queda vigente y la ficha muestra «Externo» y su seguimiento", (await page.getByTestId("etiqueta-externo").count()) > 0 && seguimiento.includes("Secretaría de Salud") && claveFicha.trim() === IDENT, `${claveFicha} | ${seguimiento.slice(0, 120)}`);
    check("externo: sin «Nueva revisión» del flujo interno (deshabilitada con su motivo en el menú ⋯)", (await (await accion(page, "sgc-nueva-revision")).isDisabled()) && (await motivo(page, "sgc-nueva-revision")).includes("externos no pasan por el flujo"));
    await cerrarMenu(page);
    check("externo: «Verificar vigencia» es la acción principal", (await page.locator('[data-principal="1"][data-testid="ext-verificar"]').count()) === 1);
    await (await accion(page, "ext-verificar")).click();
    await page.getByTestId("ver-guardar").click();
    await page.getByText("Escribe cómo verificaste la vigencia").first().waitFor();
    await entendido(page);
    await page.locator("#ver-comentario").fill("Consultado el DOF: sin nueva edición");
    await page.getByTestId("ver-guardar").click();
    await page.getByText(/Vigencia confirmada/).first().waitFor();
    check("verificar la vigencia desde la ficha (comentario obligatorio)", true);
  });

  /* ---------- Mejora Continua: distribucion ---------- */
  await paso("ana", "Ana: distribución", async (page) => {
    await page.goto(`${BASE}/documentos/${D.id}`);
    await page.getByTestId("sgc-ficha").waitFor();
    await pestana(page, "Lecturas");
    await page.getByTestId("sgc-distribucion").waitFor();
    const antes = await page.getByTestId("dist-fila").count();
    check("ficha: distribución con punto de uso y avance 0 %", antes === 1 && (await page.getByTestId("sgc-distribucion").innerText()).includes("Área de extracción") && (await page.getByTestId("dist-avance").getAttribute("data-porcentaje")) === "0");
    await (await accion(page, "dist-agregar")).click();
    await page.getByTestId("dist-guardar").click();
    await page.getByText("Elige al menos un rol o una persona").first().waitFor();
    await entendido(page);
    const rol = roles.find((r) => r.nombre === "Técnico Auxiliar")?.nombre;
    await page.getByRole("dialog").getByLabel(rol, { exact: true }).check();
    const auditor = page.getByRole("dialog").getByLabel("Auditor Interno", { exact: true });
    check("con lectura requerida, el rol que no puede confirmar lecturas está deshabilitado", (await auditor.count()) === 0 || (await auditor.isDisabled()));
    await page.locator("#dist-motivo").fill("El auxiliar usa el procedimiento en extracción");
    await page.getByTestId("dist-guardar").click();
    await contrasena(page, "ana");
    await page.getByText(/Distribución actualizada/).first().waitFor();
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="dist-fila"]').length > n, antes);
    check("agregar destinatarios por rol con motivo y contraseña", (await page.getByTestId("dist-fila").count()) === antes + 1 && (await page.getByTestId("dist-persona-estado").count()) >= 2);
  });

  /* ---------- Destinatario: lectura y acuse ---------- */
  await paso("luis", "Luis: acuse", async (page) => {
    await page.goto(`${BASE}/documentos/bandeja`);
    const lectura = page.getByTestId("bandeja-lectura").filter({ hasText: `FX-TCP-V${stamp}` });
    await lectura.waitFor();
    check("«Lecturas pendientes» en la bandeja del destinatario", (await lectura.count()) === 1);
    await lectura.getByRole("button", { name: "Leer" }).click();
    await page.waitForURL(/leer=1/);
    await page.locator('[data-testid="sgc-visor"] canvas').first().waitFor();
    await page.getByTestId("acuse-pendiente").waitFor();
    await page.getByTestId("acuse-confirmar").click();
    await page.getByRole("button", { name: "Confirmo", exact: true }).click();
    await page.getByTestId("acuse-hecho").waitFor();
    check("acuse «Confirmo que leí y comprendí la revisión 1» registrado con fecha y hora", (await page.getByTestId("acuse-hecho").innerText()).includes("revisión 1"));
    check("el destinatario sin permiso no ve «Agregar destinatarios»", (await contarAccion(page, "dist-agregar")) === 0);
    await page.goto(`${BASE}/documentos/lista-maestra`);
    await page.getByTestId("lm-tabla").waitFor();
    check("Lista Maestra sin «Ver PDF» para quien no la exporta", (await page.getByTestId("lm-pdf").count()) === 0);
    await page.goto(`${BASE}/documentos/externos`);
    await page.getByTestId("ext-fila").filter({ hasText: IDENT }).waitFor();
    check("externos: sin «Registrar externo» para el Analista (URL directa)", (await page.getByTestId("ext-registrar").count()) === 0 && (await page.getByTestId("ext-fila").filter({ hasText: IDENT }).count()) === 1);
  });

  /* ---------- Lista Maestra y PDF en el visor ---------- */
  await paso("ana", "Ana: Lista Maestra", async (page, context) => {
    let descargas = 0;
    let pestanas = 0;
    page.on("download", () => (descargas += 1));
    context.on("page", () => (pestanas += 1));
    await page.goto(`${BASE}/documentos/lista-maestra`);
    const fila = page.getByTestId("lm-fila").filter({ hasText: `FX-TCP-V${stamp}` });
    await fila.waitFor();
    check("Lista Maestra: renglón con revisión vigente y «Rev. 2 en elaboración»", (await fila.innerText()).includes("Rev. 1") && (await fila.getByTestId("lm-en-curso").innerText()) === "Rev. 2 en elaboración");
    const banda = await page.getByTestId("lm-area").filter({ hasText: "TC" }).locator("span").first().evaluate((el) => getComputedStyle(el).borderLeftColor);
    check("Lista Maestra: agrupada por área con la banda de su color", (await page.getByTestId("lm-area").count()) >= 1 && /^rgb/.test(banda) && banda !== "rgba(0, 0, 0, 0)", banda);
    await page.getByTestId("lm-pdf").click();
    await page.locator("[data-visor-pdf-flotante] canvas").first().waitFor({ timeout: 60_000 });
    check("«Ver PDF» abre el visor interno sin pestaña nueva ni descarga automática", descargas === 0 && pestanas === 0 && (await page.locator("[data-visor-pdf-flotante]").getAttribute("aria-label")).includes("Lista Maestra"));
    await page.keyboard.press("Escape");
  });

  await paso("jorge", "Jorge: sin Lista Maestra", async (page) => {
    await page.goto(`${BASE}/documentos/lista-maestra`);
    await page.getByText(/Lista Maestra requiere|No tienes permiso/).first().waitFor();
    check("admin técnico por URL directa: la Lista Maestra se niega", (await page.getByTestId("lm-tabla").count()) === 0);
  });

  /* ---------- Modo oscuro y tableta ---------- */
  await paso(
    "ana",
    "oscuro y tableta",
    async (page) => {
      await page.goto(`${BASE}/documentos`);
      await page.getByTestId("sgc-carpetas").waitFor();
      check("modo oscuro: vista general con el tema oscuro", (await page.evaluate(() => document.documentElement.dataset.theme || "")) === "dark");
      check("tableta: vista general sin desbordes", await sinDesborde(page));
      await page.goto(`${BASE}/documentos/externos`);
      await page.getByTestId("ext-fila").first().waitFor();
      check("tableta: externos sin desbordes", await sinDesborde(page));
      await page.goto(`${BASE}/documentos/lista-maestra`);
      await page.getByTestId("lm-tabla").waitFor();
      check("tableta: Lista Maestra sin desborde de página (la tabla se desplaza en su contenedor)", await sinDesborde(page));
      await page.goto(`${BASE}/documentos/${D.id}`);
      await page.getByTestId("sgc-ficha").waitFor();
      await pestana(page, "Lecturas");
      await page.getByTestId("sgc-distribucion").waitFor();
      check("tableta: ficha con distribución sin desbordes", await sinDesborde(page));
      await page.goto(`${BASE}/documentos/bandeja`);
      // Los grupos vacíos no se muestran: basta con que la bandeja termine de cargar.
      await page.locator('[data-testid="bandeja-grupo"], [data-testid="bandeja-lecturas"], [data-testid="bandeja-vacia"]').first().waitFor();
      check("tableta: bandeja sin desbordes", await sinDesborde(page));
    },
    { colorScheme: "dark", viewport: { width: 820, height: 1180 } },
  );
} finally {
  await browser.close();
}

check("sin errores de consola", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
terminar();
