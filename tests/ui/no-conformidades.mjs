/*
 * Fase 11 en el navegador:
 * - Luis reporta una incidencia desde la barra lateral (hoja rapida con foto)
 *   y desde el menu de acciones de su extraccion (queda ligada); en Calidad ›
 *   Incidencias y NC solo ve las suyas, sin Indicadores ni Auditoria.
 * - Ricardo la evalua en la ficha y la escala: se abre la NC.
 * - Ana, en el formato de la NC, nombra responsable a Ricardo, evalua el
 *   impacto, guarda y avanza a analisis (indicador de etapa).
 * - Avisos en los formatos: metodo DSP suspendido (extraccion) e informe retenido.
 * - Inicio de Ricardo con "Incidencias por evaluar"; el Auditor ve Indicadores;
 *   el Admin tecnico no ve la seccion.
 * - Sin errores de consola.
 * Los datos de apoyo se preparan por la API (con reautenticacion automatica).
 */
import "../lib/reauth-auto.mjs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const BASE = process.env.BASE || "http://localhost:3100";
process.env.BASE = `${BASE}/api`;
const { api, cadena, credenciales, crearCheck, EMAIL, informeLiberado, sesiones } = await import("../lib/calidad.mjs");
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const { check, terminar } = crearCheck();
const stamp = Date.now().toString(36).slice(-5);

const { t, id } = await sesiones();
const c = await cadena(t, "NCUI", { asignar: [id.luis] });
check("datos de apoyo: extracción DSP asignada a Luis", !!c.E, `${c.extraccion.status}`);

const browser = await chromium.launch({ executablePath, headless: true });
const consoleErrors = [];
const nueva = async () => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/Failed to load resource/.test(msg.text())) consoleErrors.push(msg.text());
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
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
};
const captura = async (page) => page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), "fail.png"), fullPage: true }).catch(() => {});
const mostrarTodo = async (page) => {
  const todo = page.getByRole("radio", { name: "Todo" });
  await todo.waitFor();
  if ((await todo.getAttribute("aria-checked")) !== "true") await todo.click();
};
const foto = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`foto ui ${stamp}`)]);
const descripcionLuis = `La centrífuga se detuvo a mitad del ciclo (UI ${stamp})`;
let incidenciaId = null;
let ncId = null;

try {
  /* ---------- Luis reporta ---------- */
  {
    const { context, page } = await nueva();
    try {
      await entrar(page, "luis");
      const boton = page.locator("[data-reportar-incidencia-boton]");
      await boton.waitFor();
      await boton.click();
      const hoja = page.locator("[data-reportar-incidencia]");
      await hoja.waitFor();
      await page.locator("#inc-tipo").selectOption("falla_equipo");
      await page.locator("#inc-desc").fill(descripcionLuis);
      await page.locator("#inc-archivos").setInputFiles({ name: "centrifuga.png", mimeType: "image/png", buffer: foto });
      await page.locator("[data-enviar-incidencia]").click();
      await hoja.waitFor({ state: "detached" });
      const lista = (await api("GET", `/calidad/incidencias?search=${encodeURIComponent(`UI ${stamp}`)}`, undefined, t.luis)).data?.items || [];
      incidenciaId = lista[0]?.id;
      const adjuntos = incidenciaId ? (await api("GET", `/calidad/incidencias/${incidenciaId}/adjuntos`, undefined, t.luis)).data?.items || [] : [];
      check("Luis reporta desde la barra lateral con una foto (hoja rápida)", !!incidenciaId && adjuntos.length === 1 && adjuntos[0].tipo_evidencia === "foto", `${lista.length} ${adjuntos.length}`);

      await page.goto(`${BASE}/muestras/extraccion`);
      const fila = page.locator("tr").filter({ hasText: c.idInt }).first();
      await fila.waitFor();
      await fila.getByRole("button", { name: /acciones/i }).click();
      await page.getByRole("menuitem", { name: /Reportar incidencia/ }).click();
      await page.locator("[data-reportar-incidencia]").waitFor();
      const chip = await page.locator("[data-reportar-incidencia]").getByText(/E-D|Extracci/).count();
      check("desde el menú de acciones de la extracción la hoja llega con el registro ligado", chip > 0);
      await page.getByRole("button", { name: "Cancelar" }).click();

      await page.goto(`${BASE}/calidad/incidencias`);
      await page.locator(`[data-incidencia="${incidenciaId}"]`).waitFor();
      const filas = await page.locator("[data-incidencia]").count();
      const propias = ((await api("GET", "/calidad/incidencias", undefined, t.luis)).data?.items || []).length;
      const aside = page.locator('aside[aria-label="Navegación principal"]');
      const hrefs = await aside.locator("a").evaluateAll((links) => links.map((a) => new URL(a.href).pathname));
      check("Luis ve solo sus incidencias; el menú tiene Incidencias y NC pero no Auditoría", filas === propias && hrefs.includes("/calidad/incidencias") && !hrefs.includes("/auditoria"), `${filas}/${propias}`);
    } catch (err) {
      await captura(page);
      check("flujo de Luis sin errores", false, err instanceof Error ? err.message : String(err));
    } finally {
      await context.close();
    }
  }

  /* ---------- Ricardo evalua y escala ---------- */
  {
    const { context, page } = await nueva();
    try {
      await entrar(page, "ricardo");
      // El aviso del Inicio ("Por evaluar") lleva a la lista unificada con el filtro de incidencias por evaluar; el Inicio solo muestra las 4 mas urgentes, asi que se prueba el destino.
      await page.goto(`${BASE}/calidad/incidencias?estado_inc=reportada,en_evaluacion`);
      await page.locator(`[data-incidencia="${incidenciaId}"]`).waitFor();
      check("Ricardo: la lista «por evaluar» (destino del aviso del Inicio) trae la incidencia", true);
      await page.goto(`${BASE}/calidad/incidencias/${incidenciaId}`);
      await page.locator("[data-evaluar]").click();
      await page.locator("#eval-just").fill("La falla pudo afectar la extracción del lote");
      await page.locator("#eval-clasif").selectOption("mayor");
      await page.locator("[data-guardar-evaluacion]").click();
      await page.waitForURL(/\/calidad\/nc\/\d+/);
      ncId = Number(new URL(page.url()).pathname.split("/").pop());
      await page.locator('[data-etapa="abierta"]').waitFor();
      check("Ricardo escala desde la ficha y llega a la NC (etapa Abierta)", !!ncId);
    } catch (err) {
      await captura(page);
      check("flujo de Ricardo sin errores", false, err instanceof Error ? err.message : String(err));
    } finally {
      await context.close();
    }
  }

  /* ---------- Ana: responsable, impacto y avance ---------- */
  {
    const { context, page } = await nueva();
    try {
      await entrar(page, "ana");
      await page.goto(`${BASE}/calidad/nc/${ncId}`);
      await mostrarTodo(page);
      await page.locator("#nc-responsable").selectOption(String(id.ricardo));
      await page.locator("#nc-afecta_resultados_emitidos").selectOption("si");
      await page.locator("#nc-trabajo_detenido").selectOption("si");
      await page.locator("#nc-notificar_cliente").selectOption("no");
      await page.locator("[data-guardar-nc]").first().click();
      const avanzar = page.locator("[data-avanzar-nc]").first();
      await avanzar.waitFor();
      await avanzar.click();
      await page.locator('[data-etapa="en_analisis"]').waitFor();
      const nc = (await api("GET", `/calidad/nc/${ncId}`, undefined, t.ana)).data?.item;
      check("Ana nombra a Ricardo, evalúa el impacto, guarda y avanza a análisis", nc?.responsable_id === id.ricardo && nc?.estado === "en_analisis", `${nc?.responsable_id} ${nc?.estado}`);
    } catch (err) {
      await captura(page);
      check("flujo de Ana sin errores", false, err instanceof Error ? err.message : String(err));
    } finally {
      await context.close();
    }
  }

  /* ---------- Avisos en los formatos: metodo suspendido e informe retenido ---------- */
  {
    const inf = await informeLiberado(t, "NCUIINF");
    const otra = await api("POST", "/calidad/nc", { origen: "otro", descripcion: `Material de referencia DSP en duda (UI ${stamp})`, responsable_id: id.ricardo }, t.ana);
    await api("POST", `/calidad/nc/${otra.data?.id}/suspensiones`, { tipo: "metodo", clave: "DSP", motivo: "Material de referencia en duda" }, t.ricardo);
    await api("POST", `/calidad/nc/${otra.data?.id}/retenciones`, { informe_id: inf.informe, motivo: "Resultados en duda" }, t.ricardo);
    const { context, page } = await nueva();
    try {
      await entrar(page, "luis");
      await page.goto(`${BASE}/muestras/extraccion/${c.E}`);
      await page.locator("[data-aviso-suspension]").waitFor();
      const texto = await page.locator("[data-aviso-suspension]").innerText();
      check("la extracción DSP muestra el aviso de método suspendido con la NC", /Método DSP suspendido por NC \d{7}/.test(texto), texto.slice(0, 120));
      await page.goto(`${BASE}/informes/${inf.informe}`);
      await page.locator("[data-aviso-retencion]").waitFor();
      check("el informe retenido muestra el aviso con la NC", /Retenido por NC \d{7}/.test(await page.locator("[data-aviso-retencion]").innerText()));
    } catch (err) {
      await captura(page);
      check("avisos en los formatos sin errores", false, err instanceof Error ? err.message : String(err));
    } finally {
      await context.close();
      const nc = (await api("GET", `/calidad/nc/${otra.data?.id}`, undefined, t.ana)).data?.item;
      for (const su of nc?.suspensiones || []) await api("POST", `/calidad/suspensiones/${su.id}/reanudar`, { motivo: "Fin de la prueba de interfaz" }, t.patricia);
      for (const r of nc?.retenciones || []) await api("POST", `/calidad/retenciones/${r.id}/liberar`, { motivo: "Fin de la prueba de interfaz" }, t.patricia);
    }
  }

  /* ---------- Auditor (lista unificada) y Admin tecnico (sin acceso) ---------- */
  {
    const { context, page } = await nueva();
    try {
      await entrar(page, "hector");
      await page.goto(`${BASE}/calidad/incidencias`);
      await page.locator("[data-incidencia], [data-nc]").first().waitFor();
      check("el Auditor (calidad:V total) ve la lista unificada", true);
    } catch (err) {
      await captura(page);
      check("lista unificada del Auditor", false, err instanceof Error ? err.message : String(err));
    } finally {
      await context.close();
    }
  }
  {
    const { context, page } = await nueva();
    try {
      await entrar(page, "jorge");
      await page.goto(`${BASE}/calidad/incidencias`);
      await page.getByText("Sin acceso a esta sección").waitFor();
      const aside = page.locator('aside[aria-label="Navegación principal"]');
      const hrefs = await aside.locator("a").evaluateAll((links) => links.map((a) => new URL(a.href).pathname));
      const boton = await page.locator("[data-reportar-incidencia-boton]").count();
      check("el Admin técnico no ve Incidencias y NC (sin acceso, sin enlace ni botón de reportar)", !hrefs.includes("/calidad/incidencias") && boton === 0, hrefs.join(","));
    } catch (err) {
      await captura(page);
      check("Admin técnico sin acceso", false, err instanceof Error ? err.message : String(err));
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

check("sin errores de consola", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
terminar();
