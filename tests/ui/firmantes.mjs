/*
 * Firma ligada a la cuenta en procesamiento (en el navegador):
 * - formato nuevo: el nombre prellenado con el de la sesion queda ligado a su cuenta;
 * - edicion de un registro antiguo que solo guardo el nombre: no se liga a ninguna
 *   cuenta, aunque quien edita se llame igual (ni en pantalla ni al guardar);
 * - edicion de un registro que ya tiene cuenta: no cambia;
 * - extraccion y analisis antiguos con solo el nombre tampoco se ligan.
 * Los registros se preparan por la API.
 */
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const BASE = process.env.BASE || "http://localhost:3100";
const API = `${BASE}/api`;
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const stamp = Date.now().toString().slice(-6);
const QA_EMAIL = "qa@ficotox.local";
const QA_PWD = "QaFicotox2026!";

async function api(method, ruta, body, token) {
  const res = await fetch(`${API}${ruta}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const QA = (await api("POST", "/auth/login", { email: QA_EMAIL, password: QA_PWD })).data?.token;
const yo = (await api("GET", "/auth/me", undefined, QA)).data;
const qaId = Number(yo?.user?.id ?? yo?.id);
const qaNombre = String(yo?.user?.nombre ?? yo?.nombre ?? "");

const inspeccion = { checklist: Array.from({ length: 7 }, (_, i) => ({ requisito: `Requisito ${i + 1}`, estado: i === 6 ? "NA" : "C", observacion: null })), observaciones_generales: null };
const idInt = `FIRMA-${stamp}`;
const R = (await api("POST", "/samples/reception", { fecha_recepcion: "2026-09-20", hora_recepcion: "09:00", recibido_por: "QA", medio_recepcion: "directa", solicitante: "Cliente UI firmantes", muestra_unica: true, id_interno: idInt, fecha_muestra: "2026-09-19", analisis: { tipos: ["toxinas_lipofilicas"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] }, inspeccion, decision_aceptacion: "aceptada", aceptacion: { fecha: "2026-09-20", responsable: "QA" } }, QA)).data?.id;
const base = { recepcion_id: R, muestra_tipo: "unica", id_interno: idInt, fecha_procesamiento: "2026-09-20", hora_procesamiento: "10:15", tipo_organismo: ["bivalvos"], parte_organismo: ["cuerpo_completo"], resguardo: { entregado_extraccion: true }, bivalvos_steps: [{ step: "Seleccionar organismos de mayor talla (~30)" }], nombre_quien_superviso: "Persona B" };
// Registro antiguo: solo el nombre (igual al de quien va a editar), sin cuenta.
const soloNombre = (await api("POST", "/samples/processing", { ...base, nombre_quien_proceso: qaNombre }, QA)).data?.id;
// Registro que ya tiene la cuenta de quien proceso.
const conCuenta = (await api("POST", "/samples/processing", { ...base, firmantes: { proceso: { usuario_id: qaId } } }, QA)).data?.id;
// Extraccion y analisis antiguos con solo el nombre (igual al de quien edita), sin cuenta.
const extOld = (await api("POST", "/samples/extraction", { tipo_registro: "E-D", procesamiento_id: soloNombre, tipo_molienda: "fresca", id_interno: idInt, fecha_extraccion: "2026-09-20", registro_pesos: [{ id_muestra: idInt, replica: `${idInt}_R1`, peso_muestra: 2.01 }], nombre_quien_extrajo: qaNombre, nombre_quien_superviso: "Persona B" }, QA)).data?.id;
const anaOld = (await api("POST", "/samples/analysis", { tipo_analisis: "toxinas_lipofilicas", metodo: "hplc_ms_ms", extraccion_id: extOld, fecha_analisis: "2026-09-20", analista_nombre: qaNombre, resultados: [{ id_muestra: idInt, resultado: 50, unidad: "µg/kg", limite_regulatorio: 160, cumple: "cumple" }] }, QA)).data?.id;
const leer = async (pid) => (await api("GET", `/samples/processing/${pid}`, undefined, QA)).data?.item;
const antiguo = soloNombre ? await leer(soloNombre) : null;
check("datos de apoyo (registro con solo el nombre y registro con cuenta)", !!qaId && !!qaNombre && !!antiguo && !antiguo.proceso_usuario_id && antiguo.nombre_quien_proceso === qaNombre && Number((await leer(conCuenta))?.proceso_usuario_id) === qaId, `qa=${qaId} «${qaNombre}» antiguo=${soloNombre}/${antiguo?.proceso_usuario_id} con=${conCuenta}`);

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(45_000);
const captura = async () => page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), "fail-firmantes.png"), fullPage: true }).catch(() => {});
const SELECTOR = "#persona-quien-proceso";
/* Valor del selector de "Quien procesó" una vez cargadas las cuentas (y con tiempo para el ligado por omision). */
const firmanteEnPantalla = async (selector = SELECTOR) => {
  await page.locator(selector).waitFor({ state: "attached" });
  await page.waitForFunction((sel) => (document.querySelector(sel)?.options.length || 0) > 1, selector);
  await page.waitForTimeout(800);
  return page.locator(selector).inputValue();
};

try {
  await page.goto(`${BASE}/login`);
  await page.fill("#login-email", QA_EMAIL);
  await page.fill("#login-password", QA_PWD);
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  // Formato nuevo: firma la persona de la sesion, ligada a su cuenta.
  await page.goto(`${BASE}/muestras/procesamiento/nuevo?recepcion=${R}`);
  const nuevo = await firmanteEnPantalla();
  check("formato nuevo: «Quien procesó» queda ligado a la cuenta de la sesión", nuevo === String(qaId), `valor=${nuevo}`);

  // Registro antiguo con solo el nombre: no se liga, aunque quien edita se llame igual.
  await page.goto(`${BASE}/muestras/procesamiento/${soloNombre}`);
  const viejo = await firmanteEnPantalla();
  const opcion = (await page.locator(`${SELECTOR} option[value=""]`).innerText()).trim();
  check("edición de un registro antiguo con solo el nombre: no se liga a ninguna cuenta", viejo === "" && (await page.locator(`[data-firmante="${qaId}"]`).count()) === 0, `valor=«${viejo}»`);
  check("…y conserva el nombre guardado como «sin cuenta ligada»", opcion === `${qaNombre} (sin cuenta ligada)`, opcion);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  const deTodos = page.getByRole("button", { name: "Guardar de todos modos" });
  await Promise.race([page.waitForURL((u) => u.pathname === "/muestras/procesamiento"), deTodos.waitFor().then(() => deTodos.click())]);
  await page.waitForURL((u) => u.pathname === "/muestras/procesamiento");
  const guardado = await leer(soloNombre);
  check("…y al guardar sigue sin cuenta (solo el nombre)", !guardado?.proceso_usuario_id && guardado?.nombre_quien_proceso === qaNombre, `usuario=${guardado?.proceso_usuario_id} nombre=${guardado?.nombre_quien_proceso}`);

  // Registro que ya tiene cuenta: no cambia.
  await page.goto(`${BASE}/muestras/procesamiento/${conCuenta}`);
  const ligado = await firmanteEnPantalla();
  check("edición de un registro que ya tiene cuenta: la firma no cambia", ligado === String(qaId), `valor=${ligado}`);

  // Extracción y análisis: la misma regla (la bandera «nuevo» llega desde ExtractionForm y AnalysisForm).
  await page.goto(`${BASE}/muestras/extraccion/${extOld}`);
  const ext = await firmanteEnPantalla("#persona-quien-extrajo");
  check("extracción antigua con solo el nombre: «Quien extrajo» no se liga a ninguna cuenta", !!extOld && ext === "", `id=${extOld} valor=«${ext}»`);
  await page.goto(`${BASE}/muestras/analisis/${anaOld}`);
  const ana = await firmanteEnPantalla("#persona-analista");
  check("análisis antiguo con solo el nombre: «Analista» no se liga a ninguna cuenta", !!anaOld && ana === "", `id=${anaOld} valor=«${ana}»`);
} catch (error) {
  await captura();
  check("recorrido sin errores", false, error.message);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
