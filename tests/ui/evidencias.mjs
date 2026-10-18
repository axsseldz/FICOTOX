/*
 * Fase 10 en el navegador:
 * - Evidencia instrumental en el formato de analisis (Luis): sin evidencia,
 *   "Enviar a revision" deshabilitado con aviso; adjuntar con la zona de carga;
 *   vista previa en hoja lateral; anular con motivo y contraseña; mostrar
 *   anulados; enviar a revision; despues, solo lectura (sin zona de carga ni
 *   anular, pero con descarga).
 * - Sin errores de consola.
 * Los datos se preparan por la API.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pdfDePrueba } from "../lib/evidencia.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const BASE = process.env.BASE || "http://localhost:3100";
const API = `${BASE}/api`;
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const credenciales = JSON.parse(readFileSync(process.env.CREDENCIALES_ROLES, "utf8"));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const stamp = Date.now().toString().slice(-6);
const LUIS = "luis.castro@ficotox.local";

async function api(method, ruta, body, token) {
  const res = await fetch(`${API}${ruta}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const tokenDe = async (email, password) => (await api("POST", "/auth/login", { email, password })).data?.token;
const QA = await tokenDe("qa@ficotox.local", "QaFicotox2026!");
const TR = await tokenDe("ricardo.medina@ficotox.local", credenciales["ricardo.medina@ficotox.local"]);
const TL = await tokenDe(LUIS, credenciales[LUIS]);
const usuarios = (await api("GET", "/admin/usuarios", undefined, QA)).data?.items || [];
const luisId = usuarios.find((u) => u.email === LUIS)?.id;

const inspeccion = { checklist: Array.from({ length: 7 }, (_, i) => ({ requisito: `Requisito ${i + 1}`, estado: i === 6 ? "NA" : "C", observacion: null })), observaciones_generales: null };
const id = `EVUI-${stamp}`;
const R = (await api("POST", "/samples/reception", { fecha_recepcion: "2026-09-20", hora_recepcion: "09:00", recibido_por: "QA", medio_recepcion: "directa", solicitante: "Cliente UI evidencia", muestra_unica: true, id_interno: id, fecha_muestra: "2026-09-19", analisis: { tipos: ["toxinas_lipofilicas"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] }, inspeccion, decision_aceptacion: "aceptada", aceptacion: { fecha: "2026-09-20", responsable: "QA" } }, QA)).data?.id;
await api("POST", `/samples/reception/${R}/asignaciones`, { usuario_id: luisId, motivo: "Asignación de prueba de evidencia (UI)" }, TR);
const P = (await api("POST", "/samples/processing", { recepcion_id: R, muestra_tipo: "unica", id_interno: id, fecha_procesamiento: "2026-09-20", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "Persona A", nombre_quien_superviso: "Persona B" }, QA)).data?.id;
const E = (await api("POST", "/samples/extraction", { tipo_registro: "E-D", procesamiento_id: P, tipo_molienda: "fresca", id_interno: id, fecha_extraccion: "2026-09-20", registro_pesos: [{ id_muestra: id, replica: `${id}_R1`, peso_muestra: 2.01 }], nombre_quien_extrajo: "Persona A", nombre_quien_superviso: "Persona B" }, QA)).data?.id;
const A = (await api("POST", "/samples/analysis", { tipo_analisis: "toxinas_lipofilicas", metodo: "hplc_ms_ms", extraccion_id: E, fecha_analisis: "2026-09-20", analista_nombre: "Luis", resultados: [{ id_muestra: id, resultado: 50, unidad: "µg/kg", limite_regulatorio: 160, cumple: "cumple" }] }, TL)).data?.id;
check("datos de apoyo: análisis de Luis sin evidencia", !!A, `${A}`);

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
const entrar = async (page, email, password) => {
  await page.goto(`${BASE}/login`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
};
const captura = async (page) => page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), "fail.png"), fullPage: true }).catch(() => {});
/* Los formatos abren "paso a paso"; se muestra el formato completo (control segmentado "Todo"). */
const mostrarTodo = async (page) => {
  // En solo lectura el formato ya se muestra completo (sin el control).
  await page.locator("[data-evidencia]").waitFor({ state: "attached" });
  const todo = page.getByRole("radio", { name: "Todo" });
  if (!(await todo.count())) return;
  if ((await todo.getAttribute("aria-checked")) !== "true") await todo.click();
  await page.waitForFunction(() => document.querySelector('[role="radio"][aria-checked="true"]')?.textContent?.includes("Todo"));
};
const adjuntar = async (page, nombre, mimeType, buffer, descripcion, tipo) => {
  await page.locator('input[aria-label="Archivo de evidencia"]').setInputFiles({ name: nombre, mimeType, buffer });
  if (tipo) await page.locator(`select[id^="evidencia-tipo-"]`).selectOption(tipo);
  await page.locator(`textarea[id^="evidencia-desc-"]`).fill(descripcion);
  await page.getByRole("button", { name: "Adjuntar evidencia" }).click();
  await page.locator("[data-adjunto]").filter({ hasText: descripcion }).first().waitFor();
};

try {
  /* ---------- Luis: evidencia en el formato de análisis ---------- */
  {
    const { context, page } = await nueva();
    try {
      await entrar(page, LUIS, credenciales[LUIS]);
      await page.goto(`${BASE}/muestras/analisis/${A}`);
      await mostrarTodo(page);
      await page.locator("[data-evidencia]").waitFor();
      await page.getByText("Falta la evidencia instrumental").waitFor();
      const enviar = page.getByRole("button", { name: "Enviar a revisión" }).first();
      check("sin evidencia: aviso visible y 'Enviar a revisión' deshabilitado", await enviar.isDisabled());
      const guia = await page.getByRole("navigation").filter({ hasText: "Evidencia instrumental" }).count();
      check("la guía de secciones incluye 'Evidencia instrumental'", guia > 0, `${guia}`);

      await adjuntar(page, "cromatograma-ui.pdf", "application/pdf", pdfDePrueba(`Cromatograma UI ${stamp}`), "Cromatograma corrida UI");
      const fila = page.locator("[data-adjunto]").filter({ hasText: "Cromatograma corrida UI" });
      const texto = await fila.textContent();
      check("adjuntar desde la zona de carga: la fila muestra descripción, nombre, tamaño y huella", /cromatograma-ui\.pdf/.test(texto) && /Cromatograma/.test(texto) && /[0-9a-f]{12}…/.test(texto), texto?.slice(0, 160));
      await page.waitForFunction(() => {
        const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === "Enviar a revisión");
        return b && !b.disabled;
      });
      check("con evidencia, 'Enviar a revisión' se habilita", true);

      await fila.getByRole("button", { name: "Vista previa" }).click();
      const hoja = page.getByRole("dialog");
      await hoja.locator("iframe").waitFor();
      check("vista previa del PDF en una hoja lateral", (await hoja.locator("iframe").count()) === 1);
      await page.keyboard.press("Escape");
      await hoja.waitFor({ state: "hidden" });

      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`png ui ${stamp}`)]);
      await adjuntar(page, "foto-vial.png", "image/png", png, "Foto del vial equivocada", "foto");
      const foto = page.locator("[data-adjunto]").filter({ hasText: "Foto del vial equivocada" });
      await foto.getByRole("button", { name: "Anular…" }).click();
      const dialogo = page.getByRole("dialog");
      await dialogo.locator("textarea").fill("Foto de otra muestra");
      await page.locator("#prompt-password").fill(credenciales[LUIS]);
      await dialogo.getByRole("button", { name: "Anular adjunto" }).click();
      await foto.waitFor({ state: "detached" });
      check("anular con motivo y contraseña: el adjunto deja de verse entre los vigentes", (await page.locator("[data-adjunto]").count()) === 1);
      await page.getByRole("switch", { name: /Mostrar anulados/ }).click();
      await page.locator("[data-adjunto]").filter({ hasText: "Foto del vial equivocada" }).waitFor();
      check("'Mostrar anulados' muestra el anulado con su motivo", /Foto de otra muestra/.test((await page.locator("[data-adjunto]").filter({ hasText: "Foto del vial equivocada" }).textContent()) || ""));

      await page.getByRole("button", { name: "Enviar a revisión" }).first().click();
      await page.getByRole("dialog").getByRole("button", { name: /Enviar a revisión/ }).click();
      await page.waitForURL((url) => url.pathname === "/muestras/analisis");
      await page.goto(`${BASE}/muestras/analisis/${A}`);
      await mostrarTodo(page);
      await page.locator("[data-adjunto]").first().waitFor();
      const zona = await page.locator("[data-zona-carga]").count();
      const anular = await page.getByRole("button", { name: "Anular…" }).count();
      const descargar = await page.locator("[data-adjunto]").first().getByRole("button", { name: "Descargar" }).isEnabled();
      check("enviado a revisión: solo lectura (sin zona de carga ni anular) pero con descarga", zona === 0 && anular === 0 && descargar, `zona=${zona} anular=${anular} descargar=${descargar}`);
    } catch (error) {
      await captura(page);
      throw error;
    } finally {
      await context.close();
    }
  }

} finally {
  await browser.close();
}

check("sin errores de consola", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
