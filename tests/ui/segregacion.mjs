/*
 * Segregacion y segundo usuario en el navegador (Fase 3):
 * - quien elaboro un analisis ve "Aprobar" deshabilitado con la explicacion;
 * - una anulacion de un analisis aprobado queda "solicitada · pendiente de
 *   autorizacion" (insignia en la lista) y no se ejecuta;
 * - la Responsable General la ve en "Por autorizar" (y en el Inicio) y la
 *   aprueba con motivo y contrasena en el mismo dialogo; el analisis queda anulado;
 * - la pestaña "Solicitudes" del historial del registro muestra la solicitud.
 * Los datos se preparan por la API.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { adjuntarEvidencia } from "../lib/evidencia.mjs";
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
const RICARDO = "ricardo.medina@ficotox.local";
const PATRICIA = "patricia.luna@ficotox.local";
const QA_PWD = "QaFicotox2026!";

async function api(method, ruta, body, token, headers = {}) {
  const res = await fetch(`${API}${ruta}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const tokenDe = async (email, password) => (await api("POST", "/auth/login", { email, password })).data?.token;
const reauth = async (token, accion, password) => (await api("POST", "/auth/reauth", { accion, password }, token)).data?.token;
const QA = await tokenDe("qa@ficotox.local", QA_PWD);
const TR = await tokenDe(RICARDO, credenciales[RICARDO]);

const inspeccion = { checklist: Array.from({ length: 7 }, (_, i) => ({ requisito: `Requisito ${i + 1}`, estado: i === 6 ? "NA" : "C", observacion: null })), observaciones_generales: null };
const id = `SEGUI-${stamp}`;
const R = (await api("POST", "/samples/reception", { fecha_recepcion: "2026-09-20", hora_recepcion: "09:00", recibido_por: "QA", medio_recepcion: "directa", solicitante: "Cliente UI segregacion", muestra_unica: true, id_interno: id, fecha_muestra: "2026-09-19", analisis: { tipos: ["toxinas_lipofilicas"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] }, inspeccion, decision_aceptacion: "aceptada", aceptacion: { fecha: "2026-09-20", responsable: "QA" } }, QA)).data?.id;
const P = (await api("POST", "/samples/processing", { recepcion_id: R, muestra_tipo: "unica", id_interno: id, fecha_procesamiento: "2026-09-20", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "Persona A", nombre_quien_superviso: "Persona B" }, QA)).data?.id;
const E = (await api("POST", "/samples/extraction", { tipo_registro: "E-D", procesamiento_id: P, tipo_molienda: "fresca", id_interno: id, fecha_extraccion: "2026-09-20", registro_pesos: [{ id_muestra: id, replica: `${id}_R1`, peso_muestra: 2.01 }], nombre_quien_extrajo: "Persona A", nombre_quien_superviso: "Persona B" }, QA)).data?.id;
// A1 lo elabora QA y queda revisado (para ver "Aprobar" deshabilitado); A2 queda aprobado (para pedir su anulacion).
const A1 = (await api("POST", "/samples/analysis", { tipo_analisis: "toxinas_lipofilicas", metodo: "hplc_ms_ms", extraccion_id: E, fecha_analisis: "2026-09-20", analista_nombre: "QA", resultados: [{ id_muestra: id, resultado: 50, unidad: "µg/kg", limite_regulatorio: 160, cumple: "cumple" }] }, QA)).data?.id;
// Fase 6: el analisis se revisa solo despues de enviarlo a revision.
// Fase 10: evidencia instrumental obligatoria para enviar a revision.
await adjuntarEvidencia(API, QA, A1);
await api("POST", `/samples/analysis/${A1}/enviar-revision`, {}, QA);
await api("POST", `/samples/analysis/${A1}/revisar`, {}, TR);
const A2 = (await api("POST", "/samples/analysis", { tipo_analisis: "toxinas_lipofilicas", metodo: "hplc_ms_ms", extraccion_id: E, fecha_analisis: "2026-09-20", analista_nombre: "QA", resultados: [{ id_muestra: id, resultado: 40, unidad: "µg/kg", limite_regulatorio: 160, cumple: "cumple" }] }, QA)).data?.id;
// Fase 6: el analisis se revisa solo despues de enviarlo a revision.
// Fase 10: evidencia instrumental obligatoria para enviar a revision.
await adjuntarEvidencia(API, QA, A2);
await api("POST", `/samples/analysis/${A2}/enviar-revision`, {}, QA);
await api("POST", `/samples/analysis/${A2}/revisar`, {}, TR);
const tokA = await reauth(TR, "ensayos:A", credenciales[RICARDO]);
const aprobado = await api("POST", `/samples/analysis/${A2}/aprobar`, {}, TR, { "X-Reauth": tokA });
check("datos de apoyo (A1 revisado, A2 aprobado)", !!A1 && aprobado.status === 200, `${A1} ${aprobado.status} ${aprobado.data?.message}`);

const browser = await chromium.launch({ executablePath, headless: true });
const nueva = async () => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
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

let solicitudId = null;
try {
  /* ---------- QA: no aprueba lo suyo; pide la anulacion ---------- */
  {
    const { context, page } = await nueva();
    try {
      await entrar(page, "qa@ficotox.local", QA_PWD);
      await page.goto(`${BASE}/muestras/analisis/${A1}`);
      await page.getByText("Separación de funciones").first().waitFor();
      const boton = page.getByRole("button", { name: "Aprobar", exact: true });
      check("quien elaboro el analisis ve 'Aprobar' deshabilitado", await boton.isDisabled());
      check("la explicacion dice que lo debe aprobar otra persona", (await page.getByText(/lo debe aprobar otra persona/).count()) > 0);
      check("ofrece solicitar una excepcion", (await page.getByRole("button", { name: /Solicitar excepción/ }).count()) > 0);

      await page.goto(`${BASE}/muestras/analisis`);
      await page.getByPlaceholder(/Buscar/).first().fill(id);
      const fila = page.locator("tbody tr").filter({ hasText: /Aprobado/ }).first();
      await fila.waitFor();
      await fila.getByRole("button", { name: "Acciones" }).click();
      await page.getByRole("menuitem", { name: /Anular/ }).click();
      await page.locator("#prompt-motivo").fill("Resultado capturado en la muestra equivocada");
      await page.locator("#prompt-password").fill(QA_PWD);
      await page.getByRole("dialog").getByRole("button", { name: "Anular", exact: true }).click();
      await page.locator("[data-solicitud-pendiente]").first().waitFor();
      const estado = (await api("GET", `/samples/analysis/${A2}`, undefined, QA)).data?.item;
      solicitudId = estado?.solicitud_pendiente?.id || null;
      check("la anulacion queda solicitada y NO se ejecuta", estado?.estado === "aprobado" && !!solicitudId, `${estado?.estado} ${solicitudId}`);
      check("la lista muestra el indicador compacto 'Anulación solicitada · pendiente de autorización' (tooltip, se puede pulsar)", (await page.locator('[data-solicitud-pendiente][aria-label^="Anulación solicitada · pendiente de autorización"]').count()) > 0);
    } catch (error) {
      check("recorrido QA", false, error.message);
      await captura(page);
    }
    await context.close();
  }

  /* ---------- Responsable General: aprueba en "Por autorizar" ---------- */
  {
    const { context, page } = await nueva();
    try {
      await entrar(page, PATRICIA, credenciales[PATRICIA]);
      await page.goto(`${BASE}/`);
      await page.getByText("Por autorizar").first().waitFor();
      check("el Inicio muestra el aviso 'Por autorizar'", true);
      await page.goto(`${BASE}/solicitudes`);
      await page.getByRole("heading", { name: "Pendientes de tu autorización" }).waitFor();
      // Lista -> ventana: el renglón abre la ventana de la solicitud con Aprobar / Rechazar.
      const fila = page.locator(`[data-solicitud="${solicitudId}"]`).first();
      await fila.waitFor();
      await fila.locator("button[aria-haspopup=dialog]").click();
      await page.locator(`[data-solicitud-ventana="${solicitudId}"]`).getByRole("button", { name: "Aprobar", exact: true }).click();
      await page.locator("#ap-motivo").fill("Confirmado con el analista");
      await page.locator("#ap-password").fill(credenciales[PATRICIA]);
      await page.getByRole("dialog").getByRole("button", { name: "Aprobar y ejecutar" }).click();
      await page.getByText(/aprobada y ejecutada/i).first().waitFor();
      const despues = (await api("GET", `/samples/analysis/${A2}`, undefined, QA)).data?.item;
      check("al aprobarla otra persona, el analisis queda anulado", despues?.estado === "anulado", despues?.estado);
      await page.goto(`${BASE}/muestras/analisis/${A2}`);
      await page.getByLabel("Solicitudes de autorización").getByText(/Aprobada/).first().waitFor();
      check("el historial del registro muestra la solicitud aprobada (apartado Solicitudes, arriba de la bitácora)", true);
    } catch (error) {
      check("recorrido Responsable General", false, error.message);
      await captura(page);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
