/*
 * Ajustes de interfaz (segunda tanda): validación compartida y solicitudes visibles.
 * - Recepción nueva sin solicitante ni inspección: al guardar no se crea nada
 *   (ni bitácora, ni solicitudes, ni incidencias), bordes rojos, pop-up con los
 *   faltantes y foco en el primer campo; al corregir, el rojo desaparece.
 *   Elegir otro firmante (con su contraseña) tampoco escribe nada antes de guardar.
 * - Con un NC en la inspección, "Aceptada" muestra el pop-up y lleva al
 *   requisito; al cambiarlo a C se habilita. Sin NC se pasa libremente entre
 *   Aceptada, Con desviación y Rechazada.
 * - Errores del servidor: de campo (solicitante) al campo; de autorización
 *   (FX-THF-AP) al pop-up con qué pasó y qué hacer. Tras guardar de verdad, sí
 *   hay bitácora.
 * - Encabezado de completitud y guía lateral coinciden.
 * - Banner de solicitud en la ficha (quien puede aprueba ahí; quien la pidió
 *   solo cancela), indicador de la lista que abre el panel rápido y franja de
 *   la lista solo para quien puede resolver.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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
const QA_EMAIL = "qa@ficotox.local";
const QA_PWD = "QaFicotox2026!";
const PATRICIA = "patricia.luna@ficotox.local";
const MARIANA = "mariana.delgado@ficotox.local";
const LUIS = "luis.castro@ficotox.local";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function api(method, ruta, body, token, headers = {}) {
  const res = await fetch(`${API}${ruta}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const tokenDe = async (email, password) => (await api("POST", "/auth/login", { email, password })).data?.token;
/* Repite con X-Reauth si la acción lo pide. */
async function critica(method, ruta, body, token, password) {
  const r = await api(method, ruta, body, token);
  if (r.status !== 401 || r.data?.codigo !== "reauth_required") return r;
  const re = (await api("POST", "/auth/reauth", { accion: r.data.accion, password }, token)).data?.token;
  return api(method, ruta, body, token, { "X-Reauth": re });
}
const QA = await tokenDe(QA_EMAIL, QA_PWD);
const inspeccion = { checklist: Array.from({ length: 7 }, (_, i) => ({ requisito: `Requisito ${i + 1}`, estado: i === 6 ? "NA" : "C", observacion: null })), observaciones_generales: null };
const recepcionCompleta = (idInt, extra = {}) => ({
  fecha_recepcion: "2026-09-20",
  hora_recepcion: "09:00",
  recibido_por: "QA",
  medio_recepcion: "directa",
  solicitante: "Cliente validación",
  muestra_unica: true,
  id_interno: idInt,
  fecha_muestra: "2026-09-19",
  analisis: { tipos: ["toxinas_lipofilicas"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] },
  inspeccion,
  datos_solicitante: { nombre_entrega: "Juan Pérez", firma_conformidad: PNG, conformidad: true },
  datos_custodio: { nombre_cargo_firma: "QA Ficotox", firma_digital: PNG, lugar_resguardo: "congelador", lugar_otro: "CO1" },
  ...extra,
});
const ultimaBitacora = async () => Number((await api("GET", "/audit?limit=1", undefined, QA)).data?.items?.[0]?.id || 0);
const pendientes = async () => ((await api("GET", "/solicitudes?estado=todas", undefined, QA)).data?.items || []).length;
const incidencias = async () => ((await api("GET", "/calidad/incidencias?anuladas=1", undefined, QA)).data?.items || []).length;

const browser = await chromium.launch({ executablePath, headless: true });
async function sesion(email, password) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  await page.goto(`${BASE}/login`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return page;
}
const verTodo = async (page) => {
  const todo = page.getByRole("radio", { name: "Todo" }).first();
  // La guía se pinta después de cargar el formato: se espera al control.
  await todo.waitFor({ timeout: 15_000 }).catch(() => {});
  if (!(await todo.count())) return;
  for (let i = 0; i < 5 && (await todo.getAttribute("aria-checked")) !== "true"; i += 1) {
    await todo.click();
    await page.waitForTimeout(300);
  }
};
const captura = async (page) => page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), "fail.png"), fullPage: true }).catch(() => {});

const pageQA = await sesion(QA_EMAIL, QA_PWD);
try {
  /* ---------- 1. Nada se registra antes de guardar; pop-up, rojo y foco ---------- */
  const antes = { bitacora: await ultimaBitacora(), solicitudes: await pendientes(), incidencias: await incidencias() };
  await pageQA.goto(`${BASE}/muestras/recepcion/nueva`);
  await pageQA.waitForFunction(() => (document.querySelector("#r-folio") || {}).value !== "");
  await verTodo(pageQA);
  await pageQA.selectOption("#r-medio", { index: 1 });
  // Cambiar opciones y elegir a otra persona como firmante (con su contraseña) no deja rastro.
  await pageQA.getByRole("radio", { name: /^Aceptada con desviación/ }).check();
  await pageQA.locator("#r-recibido").selectOption({ label: "Luis Fernando Castro Ruiz" });
  await pageQA.locator("#firma-password").fill(credenciales[LUIS]);
  await pageQA.getByRole("button", { name: "Confirmar firma" }).click();
  await pageQA.getByRole("button", { name: "Registrar recepción" }).click();
  const popup = pageQA.locator('[data-validacion="faltan"]');
  await popup.waitFor();
  const texto = (await popup.textContent()) || "";
  check("pop-up «No se pudo registrar la recepción — Faltan N datos»", /No se pudo registrar la recepción — Faltan \d+ datos/.test(texto), texto.slice(0, 120));
  check("  … lista «Recepción: Indica el solicitante» e «Inspección visual: … requisito 1»", texto.includes("Recepción: Indica el solicitante") && texto.includes("Inspección visual: Marca C, NC o NA en el requisito 1"));
  check("  … sin códigos técnicos", !/ensayos:|muestras:|\b400\b|folio_bloqueado|\{/.test(texto));
  const despues = { bitacora: await ultimaBitacora(), solicitudes: await pendientes(), incidencias: await incidencias() };
  check("antes de guardar no hay bitácora, solicitudes ni incidencias nuevas", JSON.stringify(antes) === JSON.stringify(despues), `${JSON.stringify(antes)} → ${JSON.stringify(despues)}`);
  await popup.getByRole("button", { name: "Entendido" }).click();
  await pageQA.waitForFunction(() => document.activeElement?.id === "r-solicitante");
  check("al cerrar, el foco queda en el primer campo (Solicitante)", true);
  check("campos marcados en rojo (aria-invalid) con su mensaje (aria-describedby)", (await pageQA.locator("#r-solicitante").getAttribute("aria-invalid")) === "true" && (await pageQA.locator("#r-solicitante").getAttribute("aria-describedby")) === "r-solicitante-error" && (await pageQA.locator("#r-insp-1").getAttribute("aria-invalid")) === "true");
  const aviso = (await pageQA.locator("[data-aviso-faltantes]").textContent()) || "";
  const guiaFaltan = await pageQA.locator('nav[aria-label="Secciones del formato"] .bg-warning-soft').count();
  // La sección en curso no se pinta en ámbar (es la activa); las demás con faltantes, sí.
  const enAviso = (aviso.match(/,/g) || []).length + 1;
  check("encabezado y guía coinciden (secciones con faltantes)", aviso.includes("Recepción") && aviso.includes("Inspección visual") && guiaFaltan >= enAviso - 1, `${aviso} · guía ${guiaFaltan}`);
  await pageQA.fill("#r-solicitante", "Cliente validación UI");
  check("al corregir, el rojo desaparece sin volver a guardar", (await pageQA.locator("#r-solicitante").getAttribute("aria-invalid")) === null);

  /* ---------- 2. "Aceptada" bloqueada por un NC ---------- */
  const fila1 = pageQA.locator("#r-insp-1");
  await fila1.getByRole("radio", { name: "NC", exact: true }).click();
  // La decisión elegida (con desviación) sigue siendo válida; "Aceptada" queda bloqueada con explicación.
  const aceptada = pageQA.getByRole("radio", { name: /^Aceptada\s+Cumple/ });
  check("con un NC, «Aceptada» se ve bloqueada", (await pageQA.locator('label[data-bloqueada="true"]').count()) === 1);
  await pageQA.locator('label[data-bloqueada="true"]').scrollIntoViewIfNeeded();
  await pageQA.locator('label[data-bloqueada="true"]').click({ force: true });
  const bloqueo = pageQA.locator('[data-validacion="aviso"]');
  await bloqueo.waitFor();
  check("pulsarla muestra el pop-up con el porqué (ISO 7.4.3)", ((await bloqueo.textContent()) || "").includes("No se puede marcar «Aceptada»"));
  await bloqueo.getByRole("button", { name: "Entendido" }).click();
  check("  … y lleva al requisito en NC, marcado en rojo", (await pageQA.locator("#r-insp-1").getAttribute("aria-invalid")) === "true");
  check("  … sin cambiar la decisión en silencio", await pageQA.getByRole("radio", { name: /^Aceptada con desviación/ }).isChecked());
  await fila1.getByRole("radio", { name: "C", exact: true }).click();
  check("al cambiar el requisito a C, «Aceptada» se habilita sola", (await pageQA.locator('label[data-bloqueada="true"]').count()) === 0);
  for (const nombre of [/^Aceptada\s+Cumple/, /^Aceptada con desviación/, /^Rechazada/, /^Aceptada\s+Cumple/]) await pageQA.getByRole("radio", { name: nombre }).check();
  check("sin NC se pasa libremente entre Aceptada, Con desviación, Rechazada y Aceptada", await aceptada.isChecked());

  /* ---------- 3. Errores del servidor ---------- */
  const R = (await api("POST", "/samples/reception", recepcionCompleta(`VAL-${stamp}`), QA)).data?.id;
  check("recepción completa para editar creada", !!R);
  await pageQA.goto(`${BASE}/muestras/recepcion/${R}`);
  await pageQA.locator("#r-solicitante").waitFor();
  await verTodo(pageQA);
  // Los requisitos de la API de prueba no son los del catálogo: se califican en pantalla.
  for (let i = 1; i <= 7; i += 1) await pageQA.locator(`#r-insp-${i}`).getByRole("radio", { name: "C", exact: true }).click();
  await pageQA.route("**/api/samples/reception/*", (route) => (route.request().method() === "PUT" ? route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "Indica el solicitante" }) }) : route.continue()));
  await pageQA.getByRole("button", { name: /Guardar/ }).first().click();
  const srv = pageQA.locator('[data-validacion="servidor"]');
  await srv.waitFor();
  check("error de campo del servidor (solicitante): pop-up y campo en rojo", ((await srv.textContent()) || "").includes("Indica el solicitante") && (await pageQA.locator("#r-solicitante").getAttribute("aria-invalid")) === "true");
  await srv.getByRole("button", { name: "Entendido" }).click();
  await pageQA.unroute("**/api/samples/reception/*");
  await pageQA.route("**/api/samples/reception/*", (route) => (route.request().method() === "PUT" ? route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ message: "No tienes autorización vigente para recepción (FX-THF-AP)", codigo: "no_autorizado" }) }) : route.continue()));
  await pageQA.getByRole("button", { name: /Guardar/ }).first().click();
  await srv.waitFor();
  const t403 = (await srv.textContent()) || "";
  check("error de autorización: pop-up con qué pasó y qué hacer", t403.includes("No tienes autorización vigente para recepción") && t403.includes("Qué hacer") && t403.includes("Coordinación Técnica"), t403.slice(0, 160));
  await srv.getByRole("button", { name: "Entendido" }).click();
  await pageQA.unroute("**/api/samples/reception/*");
  const antesGuardar = await ultimaBitacora();
  await pageQA.getByRole("button", { name: /Guardar/ }).first().click();
  await pageQA.waitForURL((url) => url.pathname === "/muestras/recepcion");
  check("después de guardar, sí hay entrada nueva en la bitácora", (await ultimaBitacora()) > antesGuardar);

  /* ---------- 4. Solicitudes visibles: banner, panel rápido y franja ---------- */
  const R2 = (await api("POST", "/samples/reception", recepcionCompleta(`VALB-${stamp}`, { decision_aceptacion: "aceptada", aceptacion: { fecha: "2026-09-20", responsable: "QA" } }), QA)).data?.id;
  const R3 = (await api("POST", "/samples/reception", recepcionCompleta(`VALC-${stamp}`, { decision_aceptacion: "aceptada", aceptacion: { fecha: "2026-09-20", responsable: "QA" } }), QA)).data?.id;
  const s2 = await critica("POST", `/samples/reception/${R2}/anular`, { motivo: "Duplicada en la prueba de validación" }, QA, QA_PWD);
  const s3 = await critica("POST", `/samples/reception/${R3}/anular`, { motivo: "Duplicada en la prueba de validación" }, QA, QA_PWD);
  check("dos anulaciones quedan como solicitud", s2.status === 202 && s3.status === 202, `${s2.status} ${s3.status}`);

  // Quien la pidió (QA) ve el banner con "Cancelar solicitud" y sin "Aprobar".
  await pageQA.goto(`${BASE}/muestras/recepcion/${R3}`);
  const bannerQA = pageQA.locator("[data-banner-solicitud]");
  await bannerQA.waitFor();
  check("quien la pidió: banner con «Cancelar solicitud» y sin «Aprobar»", (await bannerQA.getByRole("button", { name: "Cancelar solicitud" }).count()) === 1 && (await bannerQA.getByRole("button", { name: "Aprobar" }).count()) === 0);

  // Quien no puede resolver (Técnico Auxiliar) no ve la franja.
  const pageMariana = await sesion(MARIANA, credenciales[MARIANA]);
  await pageMariana.goto(`${BASE}/muestras/recepcion`);
  await pageMariana.locator("tbody tr").first().waitFor();
  await pageMariana.waitForTimeout(800);
  check("la franja no aparece para quien no puede resolver", (await pageMariana.locator("[data-franja-pendientes]").count()) === 0);
  await pageMariana.context().close();

  // Quien puede (Responsable General): franja, panel rápido desde la lista y aprobar desde la ficha.
  const pageRG = await sesion(PATRICIA, credenciales[PATRICIA]);
  await pageRG.goto(`${BASE}/muestras/recepcion`);
  const franja = pageRG.locator("[data-franja-pendientes]");
  await franja.waitFor();
  check("la franja «N solicitudes esperan tu autorización · Ver» aparece para quien puede resolver", /solicitud(es)? esperan? tu autorización/.test((await franja.textContent()) || ""));
  check("  … y enlaza a la bandeja filtrada por el módulo", (await franja.locator('a[href="/solicitudes?modulo=recepcion"]').count()) === 1);
  await pageRG.getByPlaceholder("Buscar por folio, solicitante o ID interno").fill(`VALC-${stamp}`);
  const filaR3 = pageRG.locator("tbody tr").filter({ hasText: `VALC-${stamp}` }).first();
  await filaR3.waitFor();
  await filaR3.locator("button[data-status-flag]").click();
  const panel = pageRG.getByRole("dialog");
  await panel.waitFor();
  check("el indicador de la lista abre el panel rápido con Aprobar y Rechazar", (await panel.getByRole("button", { name: "Aprobar" }).count()) === 1 && (await panel.getByRole("button", { name: "Rechazar" }).count()) === 1);
  await pageRG.keyboard.press("Escape");
  await pageRG.goto(`${BASE}/muestras/recepcion/${R2}`);
  const banner = pageRG.locator("[data-banner-solicitud]");
  await banner.waitFor();
  await banner.getByText("QA Ficotox").first().waitFor();
  const textoBanner = (await banner.textContent()) || "";
  check("el banner dice qué se pidió, quién, cuándo y el motivo", ["Anular registro", "QA Ficotox", "hace ", "Duplicada en la prueba de validación"].every((t) => textoBanner.includes(t)), textoBanner.slice(0, 200));
  await banner.getByRole("button", { name: "Aprobar" }).click();
  await pageRG.locator("#ap-motivo").fill("Confirmado: registro duplicado");
  await pageRG.locator("#ap-password").fill(credenciales[PATRICIA]);
  await pageRG.getByRole("dialog").getByRole("button", { name: "Aprobar y ejecutar" }).click();
  await pageRG.getByText(/aprobada y ejecutada/i).first().waitFor();
  const r2 = (await api("GET", `/samples/reception/${R2}`, undefined, QA)).data?.item;
  check("quien puede aprueba desde la ficha: la recepción queda anulada", r2?.estado === "anulada", r2?.estado);
  await pageRG.goto(`${BASE}/solicitudes?modulo=recepcion`);
  await pageRG.getByRole("heading", { name: "Pendientes de tu autorización" }).waitFor();
  const folioR3 = `R ${String((await api("GET", `/samples/reception/${R3}`, undefined, QA)).data?.item?.folio_num || 0).padStart(7, "0")}`;
  const filaBandeja = pageRG.locator("[data-solicitud]").filter({ hasText: folioR3 }).first();
  await filaBandeja.waitFor();
  const textoFila = (await filaBandeja.textContent()) || "";
  await filaBandeja.locator("button[aria-haspopup=dialog]").click();
  const ventanaSol = pageRG.locator("[data-solicitud-ventana]");
  await ventanaSol.waitFor();
  check("la bandeja muestra qué, de qué registro, quién, hace cuánto y la ventana Aprobar/Rechazar", (await filaBandeja.count()) === 1 && /hace /i.test(textoFila) && (await ventanaSol.getByRole("button", { name: "Aprobar" }).count()) === 1 && (await ventanaSol.getByRole("button", { name: "Rechazar" }).count()) === 1);
  await pageRG.keyboard.press("Escape");
  const contador = await pageRG.locator('[data-contador="/solicitudes"]').first().textContent().catch(() => "");
  check("el menú lateral muestra el contador de «Por autorizar»", Number(contador) >= 1, String(contador));
  await pageRG.context().close();
} catch (error) {
  check("recorrido de validación y solicitudes", false, error.message);
  await captura(pageQA);
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pruebas OK`);
process.exit(failed ? 1 : 0);
