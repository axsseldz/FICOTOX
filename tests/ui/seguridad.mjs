/*
 * Seguridad en el navegador (Fase 2):
 * - dialogo de confirmacion con motivo y contrasena en el mismo dialogo (anular);
 * - accion critica sin contrasena previa: el dialogo "Confirma tu identidad"
 *   aparece sin salir del formulario (disposicion final);
 * - cargo predeterminado desde "Mi cuenta": evita el dialogo "Actuar como";
 * - cierre por inactividad: aviso con "Seguir trabajando", pantalla de bloqueo y
 *   al volver a entrar se conserva lo capturado;
 * - cambio de contrasena obligatorio tras un restablecimiento;
 * - "Cerrar sesion en todos los dispositivos" y aviso de sesion revocada en el acceso.
 * Los datos se preparan por la API con el usuario QA.
 */
import "../lib/reauth-auto.mjs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { autorizarTodo } from "../lib/autorizar.mjs";
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

async function api(method, ruta, body, token) {
  const res = await fetch(`${API}${ruta}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const QA_PWD = "QaFicotox2026!";
const QA = (await api("POST", "/auth/login", { email: "qa@ficotox.local", password: QA_PWD })).data?.token;
const roles = (await api("GET", "/admin/roles", undefined, QA)).data?.items || [];
const rolId = (nombre) => roles.find((r) => r.nombre === nombre)?.id;

const inspeccion = { checklist: Array.from({ length: 7 }, (_, i) => ({ requisito: `Requisito ${i + 1}`, estado: i === 6 ? "NA" : "C", observacion: null })), observaciones_generales: null };
const aceptada = (id) => ({ fecha_recepcion: "2026-09-20", hora_recepcion: "09:00", recibido_por: "QA", medio_recepcion: "directa", solicitante: "Cliente UI seguridad", muestra_unica: true, id_interno: id, fecha_muestra: "2026-09-19", analisis: { tipos: ["toxinas_lipofilicas"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] }, inspeccion, decision_aceptacion: "aceptada", aceptacion: { fecha: "2026-09-20", responsable: "QA" } });
const R1 = (await api("POST", "/samples/reception", aceptada(`SEGUI-A-${stamp}`), QA)).data?.id;
const R2 = (await api("POST", "/samples/reception", aceptada(`SEGUI-D-${stamp}`), QA)).data?.id;
// Cadena para un informe en borrador (revision con cargo).
const R3 = (await api("POST", "/samples/reception", aceptada(`SEGUI-I-${stamp}`), QA)).data?.id;
const P3 = (await api("POST", "/samples/processing", { recepcion_id: R3, muestra_tipo: "unica", id_interno: `SEGUI-I-${stamp}`, fecha_procesamiento: "2026-09-20", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "QA" }, QA)).data?.id;
const E3 = (await api("POST", "/samples/extraction", { tipo_registro: "E-D", procesamiento_id: P3, tipo_molienda: "fresca", id_interno: `SEGUI-I-${stamp}`, fecha_extraccion: "2026-09-20", registro_pesos: [{ id_muestra: "M1", replica: "M1_R1", peso_muestra: 2.01 }], nombre_quien_extrajo: "QA" }, QA)).data?.id;
const A3 = (await api("POST", "/samples/analysis", { tipo_analisis: "toxinas_lipofilicas", metodo: "hplc_ms_ms", extraccion_id: E3, fecha_analisis: "2026-09-20", analista_nombre: "QA", resultados: [{ id_muestra: "M1", resultado: 50, unidad: "µg/kg", limite_regulatorio: 160, cumple: "cumple" }] }, QA)).data?.id;
// Fase 3: el analisis de QA lo revisa y aprueba otra persona (Coord. del Area Tecnica).
const credenciales = JSON.parse(readFileSync(process.env.CREDENCIALES_ROLES, "utf8"));
const TR = (await api("POST", "/auth/login", { email: "ricardo.medina@ficotox.local", password: credenciales["ricardo.medina@ficotox.local"] })).data?.token;
// Fase 6: el analisis se revisa solo despues de enviarlo a revision.
await api("POST", `/samples/analysis/${A3}/enviar-revision`, {}, QA);
await api("POST", `/samples/analysis/${A3}/revisar`, {}, TR);
await api("POST", `/samples/analysis/${A3}/aprobar`, {}, TR);
const INF = (await api("POST", "/informes", { recepcion_id: R3, analisis_ids: [A3], cliente: { nombre: "Cliente UI" } }, QA)).data?.id;
const PWD = "Seguridad-UI-2026";
const alta = async (prefijo, rol) => {
  const email = `${prefijo}.${stamp}@cicese.mx`;
  const r = await api("POST", "/admin/usuarios", { nombre: `${prefijo} ui`, email, activo: true, rol_id: rolId(rol), password: PWD, motivo: "Alta de prueba UI" }, QA);
  await autorizarTodo(API, QA, r.data?.id);
  return { email, id: r.data?.id };
};
const cargo = await alta("cargo", "Responsable General");
await api("POST", `/admin/usuarios/${cargo.id}/roles`, { rol_id: rolId("Coordinador/a del Área Técnica"), motivo: "Segundo rol UI" }, QA);
const reset = await alta("reset", "Técnico Auxiliar");
const temporal = (await api("POST", `/admin/usuarios/${reset.id}/password`, { motivo: "Prueba UI de restablecimiento" }, QA)).data?.password_temporal;
const revocada = await alta("revocada", "Técnico Auxiliar");
check("datos de apoyo de la prueba", !!(R1 && R2 && INF && cargo.id && temporal && revocada.id), `R1=${R1} R2=${R2} INF=${INF}`);

const browser = await chromium.launch({ executablePath, headless: true });
const nueva = async (initScript) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  if (initScript) await context.addInitScript(initScript);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
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

try {
  /* ---------- Motivo + contrasena en el mismo dialogo ---------- */
  {
    const { context, page } = await nueva();
    try {
      await entrar(page, "qa@ficotox.local", QA_PWD);
      await page.goto(`${BASE}/muestras/recepcion`);
      await page.getByPlaceholder("Buscar por folio, solicitante o ID interno").fill(`SEGUI-A-${stamp}`);
      const fila = page.locator("tbody tr").filter({ hasText: `SEGUI-A-${stamp}` }).first();
      await fila.waitFor();
      await fila.getByRole("button", { name: "Acciones" }).click();
      await page.getByRole("menuitem", { name: /Anular recepción/ }).click();
      const dialogo = page.getByRole("dialog");
      await page.locator("#prompt-motivo").fill("Prueba UI de reautenticacion");
      const campo = dialogo.getByLabel("Tu contraseña");
      check("el dialogo de anular pide motivo y contrasena juntos", (await campo.count()) === 1);
      await dialogo.getByRole("button", { name: "Anular", exact: true }).click();
      // Con el pop-up de validación encima, el diálogo de motivo sigue abierto (queda oculto a la accesibilidad mientras tanto).
      check("sin contrasena no se confirma (el dialogo sigue abierto)", await page.locator("#prompt-motivo").isVisible());
      // Pop-up de validación ("Escribe tu contraseña para confirmar"): "Entendido" deja el foco en el campo.
      await page.getByRole("alertdialog").getByText(/Escribe tu contraseña/).waitFor();
      await page.getByRole("button", { name: "Entendido" }).click();
      check("  … el campo contraseña queda marcado (aria-invalid)", (await campo.getAttribute("aria-invalid")) === "true");
      await campo.fill(QA_PWD);
      await dialogo.getByRole("button", { name: "Anular", exact: true }).click();
      // Fase 3: la recepcion esta aceptada, asi que la anulacion queda solicitada (segundo usuario).
      await page.locator("[data-solicitud-pendiente]").first().waitFor();
      const ficha = (await api("GET", `/samples/reception/${R1}`, undefined, QA)).data?.item;
      check("con la contrasena en el mismo dialogo la solicitud se crea (sin otro dialogo)", ficha?.estado === "aceptada" && !!ficha?.solicitud_pendiente && (await page.getByText("Confirma tu identidad").count()) === 0, ficha?.estado);

      /* ---------- Sin contrasena previa: "Confirma tu identidad" sin salir del formulario ---------- */
      await page.goto(`${BASE}/muestras/recepcion/${R2}`);
      // El formato abre por pasos: se muestra completo para llegar a la disposicion.
      await page.locator("h1").first().waitFor();
      const todo = page.getByRole("radio", { name: "Todo" });
      if (await todo.count()) await todo.click();
      else if (await page.getByRole("button", { name: "Mostrar todo" }).count()) await page.getByRole("button", { name: "Mostrar todo" }).click();
      const opcion = page.locator('label:has(input[name="r-disp"])').first();
      await opcion.scrollIntoViewIfNeeded();
      await opcion.click();
      await page.getByRole("button", { name: "Registrar disposición y cerrar la muestra" }).click();
      const confirma = page.getByRole("dialog", { name: "Confirma tu identidad" });
      await confirma.waitFor();
      check("accion critica sin contrasena: aparece 'Confirma tu identidad' en la misma pagina", page.url().endsWith(`/muestras/recepcion/${R2}`));
      await page.fill("#reauth-password", "incorrecta-000");
      await confirma.getByRole("button", { name: "Confirmar" }).click();
      // Contraseña incorrecta: "Confirma tu identidad" vuelve a pedirla con el campo marcado, sin perder lo capturado.
      await page.getByText(/contraseña no es correcta/i).first().waitFor();
      await confirma.waitFor();
      check("contrasena incorrecta: el dialogo la vuelve a pedir con el campo en rojo", (await page.locator("#reauth-password").getAttribute("aria-invalid")) === "true");
      const sigue = (await api("GET", `/samples/reception/${R2}`, undefined, QA)).data?.item?.estado;
      check("contrasena incorrecta: la accion no se realiza", sigue !== "cerrada", sigue);
      await page.fill("#reauth-password", QA_PWD);
      await confirma.getByRole("button", { name: "Confirmar" }).click();
      await page.getByText(/queda cerrada|disposici[oó]n final registrada/i).first().waitFor();
      const cerrada = (await api("GET", `/samples/reception/${R2}`, undefined, QA)).data?.item?.estado;
      check("con la contrasena correcta la disposicion se registra", cerrada === "cerrada", cerrada);
    } catch (error) {
      check("recorrido: confirmacion con reautenticacion", false, error.message);
      await captura(page);
    }
    await context.close();
  }

  /* ---------- Cargo predeterminado ---------- */
  {
    const { context, page } = await nueva();
    try {
      await entrar(page, cargo.email, PWD);
      await page.goto(`${BASE}/informes/${INF}`);
      await page.getByRole("button", { name: "Marcar revisado" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Marcar revisado", exact: true }).click();
      const actuar = page.getByRole("dialog", { name: "¿Con qué cargo actúas?" });
      await actuar.waitFor();
      check("sin cargo predeterminado y con dos roles que lo permiten: se pregunta el cargo", true);
      await actuar.getByRole("button", { name: "Cancelar" }).click();
      await actuar.waitFor({ state: "hidden" });
      // La accion se cancelo: se cierra tambien el dialogo de firma.
      await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Menú de usuario" }).click();
      await page.getByRole("menuitem", { name: "Mi cuenta" }).click();
      await page.locator("#cuenta-cargo").selectOption({ label: "Responsable General" });
      await page.getByText("Cargo predeterminado guardado").waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Marcar revisado" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Marcar revisado", exact: true }).click();
      await page.getByText(/listo para autorizar|revisado/i).first().waitFor();
      const item = (await api("GET", `/informes/${INF}`, undefined, QA)).data?.item;
      check("con cargo predeterminado no aparece 'Actuar como' y se guarda ese cargo", (await actuar.count()) === 0 && item?.revisado_cargo === "Responsable General", item?.revisado_cargo);
    } catch (error) {
      check("recorrido: cargo predeterminado", false, error.message);
      await captura(page);
    }
    await context.close();
  }

  /* ---------- Cierre por inactividad ---------- */
  {
    const { context, page } = await nueva(() => window.localStorage.setItem("ficotox.prueba.inactividad-seg", "12"));
    try {
      await entrar(page, "qa@ficotox.local", QA_PWD);
      await page.goto(`${BASE}/muestras/recepcion/nueva`);
      await page.locator("#r-solicitante").fill(`Dato sin guardar ${stamp}`);
      const aviso = page.getByRole("dialog", { name: "Tu sesión está por cerrarse" });
      await aviso.waitFor({ timeout: 20_000 });
      check("aviso antes del cierre por inactividad", true);
      await aviso.getByRole("button", { name: "Seguir trabajando" }).click();
      await aviso.waitFor({ state: "hidden" });
      check("'Seguir trabajando' mantiene la sesion", (await page.getByText("Sesión cerrada por inactividad").count()) === 0);
      await page.getByText("Sesión cerrada por inactividad").waitFor({ timeout: 25_000 });
      const token = await page.evaluate(() => window.localStorage.getItem("ficotox_access_token"));
      check("al cerrarse por inactividad se descarta el token", !token);
      await page.fill("#bloqueo-password", QA_PWD);
      await page.getByRole("button", { name: "Volver a entrar" }).click();
      await page.getByText("Sesión cerrada por inactividad").waitFor({ state: "hidden" });
      const valor = await page.locator("#r-solicitante").inputValue();
      check("al volver a entrar se conserva lo capturado", valor === `Dato sin guardar ${stamp}`, valor);
    } catch (error) {
      check("recorrido: inactividad", false, error.message);
      await captura(page);
    }
    await context.close();
  }

  /* ---------- Cambio obligatorio y cerrar sesion en todos los dispositivos ---------- */
  {
    const { context, page } = await nueva();
    try {
      await entrar(page, reset.email, temporal);
      await page.getByRole("heading", { name: "Cambia tu contraseña" }).waitFor();
      check("tras restablecer: pantalla de cambio obligatorio", true);
      await page.fill("#pwd-actual", temporal);
      await page.fill("#pwd-nueva", "Corta-1");
      await page.fill("#pwd-confirmar", "Corta-1");
      await page.getByRole("button", { name: "Guardar y continuar" }).click();
      await page.getByText(/al menos 10 caracteres/).first().waitFor();
      // Pop-up de validación: "Entendido" lo cierra y deja el foco en el campo marcado.
      await page.getByRole("button", { name: "Entendido" }).click();
      await page.fill("#pwd-nueva", "Nueva-Clave-UI-2026");
      await page.fill("#pwd-confirmar", "Nueva-Clave-UI-2026");
      await page.getByRole("button", { name: "Guardar y continuar" }).click();
      await page.locator('aside[aria-label="Navegación principal"]').waitFor();
      check("con la contrasena nueva entra a la aplicacion", true);
      await page.getByRole("button", { name: "Menú de usuario" }).click();
      await page.getByRole("menuitem", { name: "Mi cuenta" }).click();
      await page.getByRole("button", { name: "Cerrar sesión en todos los dispositivos" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Cerrar todas" }).click();
      await page.waitForURL((url) => url.pathname.startsWith("/login"));
      const viejo = await api("POST", "/auth/login", { email: reset.email, password: "Nueva-Clave-UI-2026" });
      check("'Cerrar sesion en todos los dispositivos' vuelve al acceso y la contrasena nueva sigue sirviendo", viejo.status === 200);
    } catch (error) {
      check("recorrido: cambio obligatorio y cierre de sesiones", false, error.message);
      await captura(page);
    }
    await context.close();
  }

  /* ---------- Sesion revocada desde otro dispositivo ---------- */
  {
    const { context, page } = await nueva();
    try {
      await entrar(page, revocada.email, PWD);
      const otro = (await api("POST", "/auth/login", { email: revocada.email, password: PWD })).data?.token;
      await api("POST", "/auth/logout-all", {}, otro);
      await page.goto(`${BASE}/muestras/recepcion`);
      await page.waitForURL((url) => url.pathname.startsWith("/login"));
      await page.getByText(/Tu sesión se cerró/).waitFor();
      check("sesion revocada: vuelve al acceso con el motivo", true);
    } catch (error) {
      check("recorrido: sesion revocada", false, error.message);
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
