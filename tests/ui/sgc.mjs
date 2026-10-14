/* Ronda SGC (navegador): recepcion con aceptacion, anular/restaurar, analisis revisar/aprobar, informe autorizar+PDF+entrega, Documentos SGC (reemplaza a la Biblioteca), auditoria, baja de inventario. */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pdfDePrueba } from "../lib/evidencia.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const BASE = process.env.BASE || "http://localhost:3100";
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const today = new Date().toLocaleDateString("en-CA");
const stamp = Date.now().toString().slice(-5);

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
/* Fase 3: segunda persona (Coord. del Area Tecnica) para revisar y aprobar lo que QA elabora. */
const credenciales = JSON.parse(readFileSync(process.env.CREDENCIALES_ROLES, "utf8"));
const RICARDO = "ricardo.medina@ficotox.local";
const page2 = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page2.setDefaultTimeout(60_000);
page.setDefaultTimeout(60_000);
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

/* Los formatos abren "paso a paso" al capturar; para llenar todo con selectores fijos se muestra el formato completo. */
const showAll = async () => {
  // En escritorio el modo se elige en el control segmentado de la guía; en móvil es un botón.
  const todo = page.getByRole("radio", { name: "Todo" });
  if (await todo.count()) {
    if ((await todo.getAttribute("aria-checked")) !== "true") await todo.click();
    await page.waitForFunction(() => document.querySelector('[role="radio"][aria-checked="true"]')?.textContent?.includes("Todo"));
    return;
  }
  const button = page.getByRole("button", { name: "Mostrar todo" });
  if (await button.count()) await button.click();
  await page.getByRole("button", { name: "Paso a paso" }).waitFor();
};

/* Dibuja un trazo en un lienzo de firma identificado por su aria-label. */
const sign = async (label) => {
  const canvas = page.getByLabel(label, { exact: true });
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 70, { steps: 6 });
  await page.mouse.up();
};

/* Fase 2: las acciones criticas piden la contrasena en el mismo dialogo. */
const QA_PASSWORD = "QaFicotox2026!";
const fillPassword = async (selector) => {
  const campo = page.locator(selector);
  if (await campo.count()) await campo.fill(QA_PASSWORD);
};
const fillPrompt = async (motivo, confirm) => {
  await page.locator("#prompt-motivo").waitFor();
  await page.fill("#prompt-motivo", motivo);
  await fillPassword("#prompt-password");
  await page.getByRole("dialog").getByRole("button", { name: confirm, exact: true }).click();
};

/* Los conmutadores viven dentro del menú "Filtros": se abre, se cambia y se cierra con Escape. */
const setFilterToggle = async (label, on) => {
  await page.getByRole("button", { name: /^Filtros/ }).click();
  const toggle = page.getByRole("switch", { name: label });
  await toggle.waitFor();
  if (((await toggle.getAttribute("aria-checked")) === "true") !== on) await toggle.click();
  await page.keyboard.press("Escape");
};
const drawSignature = async (label, p = page) => {
  const canvas = p.locator(`canvas[aria-label="${label}"]`);
  const box = await canvas.boundingBox();
  await p.mouse.move(box.x + 30, box.y + 60);
  await p.mouse.down();
  await p.mouse.move(box.x + 120, box.y + 90, { steps: 8 });
  await p.mouse.move(box.x + 220, box.y + 50, { steps: 8 });
  await p.mouse.up();
};

let token = "";
try {
  await page.goto(`${BASE}/login`);
  await page.fill("#login-email", "qa@ficotox.local");
  await page.fill("#login-password", "QaFicotox2026!");
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  check("login", true);
  token = await page.evaluate(() => localStorage.getItem("ficotox_access_token") || "");

  /* ---------- Recepcion con inspeccion + decision ---------- */
  await page.goto(`${BASE}/muestras/recepcion/nueva`);
  await page.getByRole("heading", { name: /Nueva recepción/ }).waitFor();
  await page.waitForFunction(() => (document.querySelector("#r-folio") || {}).value !== "");
  // Modo paso a paso: solo la primera sección está abierta y "Continuar" abre la siguiente.
  check("formato nuevo abre paso a paso", (await page.locator("#r-id").isVisible()) === false && (await page.locator("#r-folio").isVisible()) === true);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.locator("#r-id").waitFor({ state: "visible" });
  check("«Continuar» abre la sección de la muestra", true);
  await showAll();
  check("«Todo» despliega el formato completo", await page.locator("#r-obs-insp").isVisible());
  const folio = await page.inputValue("#r-folio");
  await page.fill("#r-fecha", today);
  await page.fill("#r-id", `UI-${stamp}`);
  await page.selectOption("#r-medio", { index: 1 });
  // "Recibido por" es un selector del personal autorizado, prellenado con la persona con sesión.
  // Fase 5: el valor es la cuenta (id); se compara la etiqueta de la opción elegida.
  const recibido = (await page.locator("#r-recibido option:checked").textContent())?.trim();
  check("«Recibido por» viene prellenado con la persona con sesión", recibido === "QA Ficotox", recibido);
  await page.locator("#r-recibido").selectOption("QA Ficotox");
  await page.fill("#r-solicitante", "Cliente UI Playwright");
  await page.getByLabel("Ácido domoico (ASP)").check();
  await page.getByLabel("Cromatografía de líquidos").check();
  await page.getByLabel("Organismo completo").check();
  // Solo los grupos C/NC/NA de la inspección (la guía también tiene un radiogroup para el modo de lectura).
  const groups = page.locator('#sec-inspeccion [role="radiogroup"]');
  const n = await groups.count();
  for (let i = 0; i < n; i += 1) await groups.nth(i).getByRole("radio", { name: "C", exact: true }).click();
  check("inspección visual con 7 requisitos", n >= 7, `radiogroups=${n}`);
  await page.getByRole("radio", { name: /^Aceptada\s+Cumple/ }).check();
  await page.fill("#r-acep-fecha", today);
  await page.locator("#r-acep-resp").selectOption("QA Ficotox");
  await page.fill("#r-acep-temp", "6 °C");
  // Sin la información mínima (solicitante y custodio) el formato no se guarda: avisa y abre la sección.
  await page.getByRole("button", { name: "Registrar recepción" }).click();
  // Validación compartida: pop-up con la lista de faltantes, campos en rojo y foco en el primero al cerrar.
  const popup = page.locator('[data-validacion="faltan"]');
  await popup.waitFor();
  check("no deja guardar sin la información mínima: pop-up con los faltantes", page.url().includes("/muestras/recepcion/nueva") && /No se pudo registrar la recepción — Faltan \d+ datos/.test(await popup.textContent()) && (await popup.textContent()).includes("Solicitante: Indica el nombre de quien entrega"));
  await popup.getByRole("button", { name: "Entendido" }).click();
  await page.waitForFunction(() => document.activeElement?.id === "r-sol-nombre");
  check("al cerrar, el foco queda en el primer campo con problema", (await page.locator("#r-sol-nombre").getAttribute("aria-invalid")) === "true");
  check("el encabezado y la guía coinciden (Falta información en: …Solicitante…)", (await page.locator("[data-aviso-faltantes]").textContent()).includes("Solicitante"));
  await page.fill("#r-sol-nombre", "Juan Pérez");
  check("el rojo desaparece al corregir, sin volver a guardar", (await page.locator("#r-sol-nombre").getAttribute("aria-invalid")) === null);
  await sign("Firma de conformidad del solicitante");
  await page.getByLabel(/He revisado la información/).check();
  await page.getByRole("radio", { name: /^Congelador/ }).check();
  await sign("Firma · Custodio");
  // La decisión de aceptación es opcional al guardar: cuentan 6 secciones obligatorias.
  await page.getByText(/6 de 6 secciones completas/).waitFor();
  check("la guía marca todas las secciones obligatorias completas", true);
  await page.getByRole("button", { name: "Registrar recepción" }).click();
  await page.waitForURL((url) => url.pathname === "/muestras/recepcion");
  await page.getByPlaceholder("Buscar por folio, solicitante o ID interno").fill(`UI-${stamp}`);
  const row = page.locator("tbody tr").filter({ hasText: `UI-${stamp}` }).first();
  await row.waitFor();
  check("recepción aparece con decisión Aceptada", (await row.textContent()).includes("Aceptada"), `folio ${folio}`);

  /* ---------- Anular y restaurar (Fase 3: una recepción aceptada requiere un segundo usuario) ---------- */
  // La aprobación de la solicitud la da la Responsable General por la API (el flujo en pantalla se prueba en ui/segregacion.mjs).
  const aprobarComoRG = async (texto) => {
    const rg = "patricia.luna@ficotox.local";
    const tk = (await (await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: rg, password: credenciales[rg] }) })).json()).token;
    const lista = await (await fetch(`${BASE}/api/solicitudes`, { headers: { Authorization: `Bearer ${tk}` } })).json();
    const sol = (lista.items || []).find((i) => i.puedo_aprobar && String(i.referencia || "").includes(texto));
    const re = await (await fetch(`${BASE}/api/auth/reauth`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` }, body: JSON.stringify({ accion: "solicitudes:aprobar", password: credenciales[rg] }) })).json();
    const r = await fetch(`${BASE}/api/solicitudes/${sol?.id}/aprobar`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}`, "X-Reauth": re.token }, body: JSON.stringify({ motivo: "Aprobada en la prueba de navegador" }) });
    return r.status;
  };
  await row.getByRole("button", { name: "Acciones" }).click();
  await page.getByRole("menuitem", { name: /Anular recepción/ }).click();
  await fillPrompt("Prueba UI: registro duplicado", "Anular");
  await page.locator("[data-solicitud-pendiente]").first().waitFor();
  check("anular una recepción aceptada queda pendiente de autorización", true);
  check("la Responsable General aprueba la anulación", (await aprobarComoRG(`R ${String(folio).padStart(7, "0")}`)) === 200);
  await page.reload();
  await setFilterToggle("Mostrar anuladas", true);
  // La lista se recarga sola tras anular: se espera a la fila ya marcada como anulada.
  const anulada = page.locator("tbody tr").filter({ hasText: `UI-${stamp}` }).filter({ hasText: "Anulada" }).first();
  await anulada.waitFor();
  check("recepción anulada visible con 'Mostrar anuladas'", true);
  await anulada.getByRole("button", { name: "Acciones" }).click();
  await page.getByRole("menuitem", { name: /Restaurar recepción/ }).click();
  await fillPrompt("Prueba UI: se anuló por error", "Restaurar");
  await page.locator("[data-solicitud-pendiente]").first().waitFor();
  check("la Responsable General aprueba la restauración", (await aprobarComoRG(`R ${String(folio).padStart(7, "0")}`)) === 200);
  await page.reload();
  await setFilterToggle("Mostrar anuladas", false);
  const restaurada = page.locator("tbody tr").filter({ hasText: `UI-${stamp}` }).filter({ hasNotText: "Anulada" }).first();
  await restaurada.waitFor();
  check("recepción restaurada vuelve a la lista", true);
  await restaurada.getByRole("button", { name: "Acciones" }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  await page.getByText("Historial del registro").waitFor();
  // La actividad del historial aparece recogida: "Actividad · N actividades" la despliega.
  const bitacora = page.getByRole("button", { name: /^Actividad · \d+ actividad/ });
  check("la bitácora del historial aparece recogida", (await bitacora.getAttribute("aria-expanded")) === "false");
  check("el historial ya no tiene 'Exportar' ni 'Actualizar'", (await page.locator("#sec-historial").getByRole("button", { name: /^(Exportar|Actualizar)$/ }).count()) === 0);
  await bitacora.click();
  await page.getByText(/restauró la recepción/).first().waitFor();
  check("historial de auditoría en el formulario de recepción (se despliega con un clic)", (await bitacora.getAttribute("aria-expanded")) === "true");
  await bitacora.click();
  check("  … y se vuelve a recoger", (await bitacora.getAttribute("aria-expanded")) === "false");

  /* ---------- Analisis: crear, revisar, aprobar ---------- */
  // Cadena propia (recepcion aceptada -> procesamiento -> extraccion E-A) para no depender de ids previos.
  const apiPost = async (path, body) => {
    const r = await fetch(`${BASE}/api${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return r.json();
  };
  const checklist = ["Se presentan en talla comercial.", "Se presentan sin alteraciones (estado de descomposición, valvas abiertas/rotas, cuerpos eviscerados).", "En el momento de su presentación no han transcurrido más de 24 horas después de haber sido extraídas.", "Se presentan en bolsa o botella de plástico transparente, sin alteraciones, como contenedor primario.", "El contenedor primario es transportado en una hielera con blue ice/hielo suficiente para mantener la temperatura entre 4 y 10 °C.", "Se presentan en cantidad o volumen suficiente para el(los) análisis solicitados.", "Se presenta con algún tipo de fijador (en caso positivo especificar el tipo)."].map((requisito, i) => ({ requisito, estado: i === 6 ? "NA" : "C", observacion: null }));
  const recUi = await apiPost("/samples/reception", { fecha_recepcion: today, hora_recepcion: "09:00", recibido_por: "QA Ficotox", medio_recepcion: "directa", solicitante: "Productor Bahía Falsa S.A.", muestra_unica: true, id_interno: `UI-A-${stamp}`, fecha_muestra: today, analisis: { tipos: ["acido_domoico"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] }, decision_aceptacion: "aceptada", inspeccion: { checklist, observaciones_generales: null }, aceptacion: { fecha: today, responsable: "QA Ficotox" }, datos_solicitante: { nombre_entrega: "Juan Pérez" }, datos_custodio: { nombre_cargo_firma: "QA Ficotox", lugar_resguardo: "congelador" } });
  const procUi = await apiPost("/samples/processing", { recepcion_id: recUi.id, muestra_tipo: "unica", id_interno: `UI-A-${stamp}`, fecha_procesamiento: today, tipo_organismo: ["bivalvos"], nombre_quien_proceso: "QA Ficotox" });
  const extUi = await apiPost("/samples/extraction", { tipo_registro: "E-A", procesamiento_id: procUi.id, tipo_molienda: "fresca", id_interno: `UI-A-${stamp}`, fecha_extraccion: today });
  check("cadena de prueba creada por API", !!recUi.id && !!procUi.id && !!extUi.id, `rec=${recUi.id} proc=${procUi.id} ext=${extUi.id}`);
  const extId = String(extUi.id);
  await page.goto(`${BASE}/muestras/analisis/nuevo?extraccion=${extId}`);
  await page.getByRole("heading", { name: /Nuevo análisis/ }).waitFor();
  await showAll();
  await page.waitForFunction(() => (document.querySelector("#a-folio") || {}).value !== "");
  const folioA = await page.inputValue("#a-folio");
  await page.waitForFunction((id) => (document.querySelector("#a-ext") || {}).value === id, extId);
  const asp = await page.getByLabel("Ácido domoico (ASP)").isChecked();
  check("tipo ASP sugerido desde la extracción E-A", asp);
  await page.selectOption("#a-metodo", "hplc_uv_vis");
  await page.fill("#a-fecha", today);
  // Equipo obligatorio para trazabilidad.
  const equipoBox = page.getByPlaceholder(/Cromatógrafo, microscopio/);
  await equipoBox.click();
  await equipoBox.fill("Centr");
  await page.getByRole("option", { name: /Centr/ }).first().click();
  await page.getByRole("button", { name: "Agregar muestra" }).click();
  await page.locator('input[aria-label^="ID de la muestra"]').first().fill("D26-101");
  const resultInputs = page.locator('input[aria-label^="Resultado de "]');
  const nres = await resultInputs.count();
  check("fila de resultado agregada a mano", nres >= 1, `filas=${nres}`);
  await resultInputs.first().fill("12.5");
  const cumple = await page.locator('select[aria-label^="Conformidad de "]').first().inputValue();
  check("conformidad sugerida contra el límite (12.5 < 20 => cumple)", cumple === "cumple", `cumple=${cumple}`);
  await page.getByRole("button", { name: "Registrar análisis" }).click();
  await page.waitForURL((url) => url.pathname === "/muestras/analisis");
  const rowA = page.locator("tbody tr").filter({ hasText: new RegExp(`A\\s*${folioA.padStart(7, "0")}`) }).first();
  await rowA.waitFor();
  check("análisis en la lista con estado Registrado", (await rowA.textContent()).includes("Registrado"), `folio A ${folioA}`);
  await rowA.click();
  // Fase 3 (segregación): quien lo elaboró ve el botón deshabilitado con la explicación.
  await page.getByText("Separación de funciones").first().waitFor();
  check("QA no puede revisar su propio análisis (botón deshabilitado con explicación)", await page.getByRole("button", { name: "Marcar revisado" }).isDisabled());
  const analisisUrl = page.url();
  // Fase 10: evidencia instrumental obligatoria; se adjunta desde la sección del formato.
  await showAll();
  await page.locator('input[aria-label="Archivo de evidencia"]').setInputFiles({ name: "cromatograma-sgc.pdf", mimeType: "application/pdf", buffer: pdfDePrueba(`Cromatograma UI SGC ${Date.now()}`) });
  await page.locator('textarea[id^="evidencia-desc-"]').fill("Cromatograma de la corrida");
  await page.getByRole("button", { name: "Adjuntar evidencia" }).click();
  await page.locator("[data-adjunto]").first().waitFor();
  check("el analista adjunta la evidencia instrumental antes de enviar", true);
  // Fase 6: el analista lo envía a revisión (desde aquí ya no se edita).
  await page.getByRole("button", { name: "Enviar a revisión" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Enviar a revisión/ }).click();
  await page.locator("[data-sonner-toast]").filter({ hasText: /revisi/i }).last().waitFor({ timeout: 20_000 });
  check("el analista envía el análisis a revisión", true);
  // La revisa y aprueba otra persona.
  await page2.goto(`${BASE}/login`);
  await page2.fill("#login-email", RICARDO);
  await page2.fill("#login-password", credenciales[RICARDO]);
  await page2.click("button[type=submit]");
  await page2.waitForURL((url) => !url.pathname.startsWith("/login"));
  await page2.goto(analisisUrl);
  await page2.getByRole("button", { name: "Marcar revisado" }).click();
  await page2.getByRole("dialog").getByRole("button", { name: "Marcar revisado", exact: true }).click();
  await page2.waitForURL((url) => url.pathname === "/muestras/analisis");
  const rowA2 = page2.locator("tbody tr").filter({ hasText: new RegExp(`A\\s*${folioA.padStart(7, "0")}`) }).first();
  await rowA2.waitFor();
  check("análisis revisado por otra persona", (await rowA2.textContent()).includes("Revisado"));
  await rowA2.click();
  await page2.getByRole("button", { name: "Aprobar", exact: true }).click();
  await page2.locator("#sign-password").fill(credenciales[RICARDO]);
  await page2.getByRole("dialog").getByRole("button", { name: "Aprobar", exact: true }).click();
  await page2.waitForURL((url) => url.pathname === "/muestras/analisis");
  const rowA3 = page2.locator("tbody tr").filter({ hasText: new RegExp(`A\\s*${folioA.padStart(7, "0")}`) }).first();
  await rowA3.waitFor();
  check("análisis aprobado por la misma persona que lo revisó (distinta de quien lo elaboró)", (await rowA3.textContent()).includes("Aprobado"));
  await page.goto(analisisUrl);
  // En solo lectura no hay botón de guardar y el formato abre completo.
  await page.getByRole("button", { name: "Volver" }).waitFor();
  await page.locator("#a-metodo").waitFor();
  const metodoDisabled = (await page.locator("#a-metodo").isDisabled()) && (await page.getByRole("button", { name: "Guardar cambios" }).count()) === 0;
  check("análisis aprobado es solo lectura (controles desactivados)", metodoDisabled);

  /* ---------- Informe: crear, revisar, autorizar, PDF, entregar ---------- */
  await page.goto(`${BASE}/informes/nuevo?recepcion=${recUi.id}`);
  await page.getByRole("heading", { name: /Nuevo informe/ }).waitFor();
  await showAll();
  const checks = page.locator('#sec-analisis input[type="checkbox"]');
  await checks.first().waitFor();
  const nchecks = await checks.count();
  for (let i = 0; i < nchecks; i += 1) if (!(await checks.nth(i).isChecked())) await checks.nth(i).check();
  check("análisis aprobados disponibles para el informe", nchecks >= 1, `n=${nchecks}`);
  await page.getByRole("button", { name: "Crear borrador" }).click();
  await page.waitForURL((url) => /^\/informes\/\d+$/.test(url.pathname));
  const informeId = page.url().split("/").pop();
  check("informe creado en borrador", true, `id=${informeId}`);
  check("QA elaboró el informe: no puede revisarlo (botón deshabilitado)", await page.getByRole("button", { name: "Marcar revisado" }).isDisabled());
  // Revisa y autoriza otra persona (no elaboró el informe ni el análisis).
  await page2.goto(`${BASE}/informes/${informeId}`);
  await page2.getByRole("button", { name: "Marcar revisado" }).click();
  check("el diálogo de firma no pide cargo (sale del rol)", (await page2.locator("#sign-cargo").count()) === 0);
  await page2.getByRole("dialog").getByRole("button", { name: "Marcar revisado", exact: true }).click();
  await page2.getByText("En revisión").first().waitFor();
  check("informe en revisión", true);
  await page2.getByRole("button", { name: "Autorizar", exact: true }).click();
  await drawSignature("Firma: Autorizar informe", page2);
  await page2.locator("#sign-password").fill(credenciales[RICARDO]);
  await page2.getByRole("dialog").getByRole("button", { name: "Autorizar", exact: true }).click();
  // El paso "Autorizado" del indicador siempre existe: se espera el aviso de exito (o el error).
  const toast = page2.locator("[data-sonner-toast]").filter({ hasText: /autoriz|No se pudo|separación|Elaboraste/i }).last();
  await toast.waitFor({ timeout: 20_000 }).catch(async () => {
    await page2.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), "fail2.png"), fullPage: true });
  });
  const avisoAut = (await toast.count()) ? await toast.textContent() : "sin aviso";
  check("la autorización se registra", /Informe autorizado/.test(String(avisoAut)), avisoAut);
  check("informe autorizado", true);
  // Fase 6: autorizar no genera el PDF final; se libera (puede hacerlo quien autorizó).
  await page2.getByRole("button", { name: "Liberar", exact: true }).click();
  if (await page2.locator("#sign-password").count()) await page2.locator("#sign-password").fill(credenciales[RICARDO]);
  await page2.getByRole("dialog").getByRole("button", { name: "Liberar", exact: true }).click();
  await page2.locator("[data-sonner-toast]").filter({ hasText: /liberado/i }).last().waitFor({ timeout: 20_000 });
  check("informe liberado (PDF final)", true);
  await page.goto(`${BASE}/informes/${informeId}`);
  await page.locator("#envio-nombre").waitFor();
  const pdf = await page.evaluate(async ([id, tk]) => {
    const r = await fetch(`/api/informes/${id}/pdf`, { headers: { Authorization: `Bearer ${tk}` } });
    return { status: r.status, type: r.headers.get("content-type"), size: (await r.arrayBuffer()).byteLength };
  }, [informeId, token]);
  check("PDF del informe descargable", pdf.status === 200 && String(pdf.type).includes("pdf") && pdf.size > 2000, JSON.stringify(pdf));
  // Un <fieldset disabled> desactiva a sus descendientes sin poner el atributo en cada uno: se consulta :disabled.
  await page.waitForFunction(() => !!document.querySelector("#i-cli")?.matches(":disabled"));
  check("informe liberado es solo lectura (cliente desactivado)", true);
  // Fase 6: envío manual con evidencia (reemplaza la entrega).
  await page.fill("#envio-nombre", "Juan Pérez");
  await page.fill("#envio-correo", "juan.perez@ejemplo.mx");
  await page.locator("#envio-evidencia").setInputFiles({ name: "evidencia.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% evidencia de envio\n") });
  await page.getByRole("button", { name: "Registrar envío", exact: true }).click();
  await page.locator("[data-envio]").first().waitFor();
  await page.getByText("Enviado").first().waitFor();
  check("envío registrado con evidencia: el informe queda enviado", (await page.locator("[data-envio]").count()) === 1);

  /* ---------- Documentos SGC (reemplaza a la Biblioteca; el detalle esta en ui/documentos.mjs) ---------- */
  await page.goto(`${BASE}/calidad/biblioteca`);
  await page.waitForURL((url) => url.pathname === "/documentos");
  await page.getByTestId("sgc-carpetas").waitFor();
  check("/calidad/biblioteca lleva a Documentos SGC (seis carpetas)", (await page.getByTestId("sgc-carpeta").count()) === 6);
  check("Documentos SGC aparece en el menú Calidad (y ya no «Biblioteca»)", (await page.locator("nav a", { hasText: /^Documentos SGC$/ }).count()) > 0 && (await page.locator("nav a", { hasText: /^Biblioteca$/ }).count()) === 0);

  /* ---------- Auditoria (lenguaje simple; la integridad se verifica sola y solo avisa si falla) ---------- */
  await page.goto(`${BASE}/auditoria`);
  await page.getByText("Quién hizo qué, cuándo y por qué").waitFor();
  const timeline = page.locator("[data-actividad]");
  await timeline.first().waitFor();
  // Cada actividad es una frase en español, sin JSON ni nombres de columna.
  const firstText = (await timeline.first().textContent()) || "";
  check("bitácora: actividades en lenguaje llano", firstText.length > 10 && !firstText.includes("_") && !firstText.includes("{") && !/#\d/.test(firstText), firstText.slice(0, 80));
  await timeline.first().click();
  await page.locator("[data-actividad-detalle]").getByText("Qué pasó").waitFor();
  check("bitácora: detalle en ventana con «Qué pasó»", true);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.getByRole("switch", { name: "Anulaciones y rechazos" }).click();
  await page.keyboard.press("Escape");
  await timeline.filter({ hasText: /anuló|rechazó|dio de baja/ }).first().waitFor();
  check("bitácora: filtro por tipo de actividad", true);

  /* ---------- Inventario: baja logica + reactivar ---------- */
  await page.goto(`${BASE}/inventario/reactivos`);
  await page.getByPlaceholder("Buscar por nombre, lote, CAS o catálogo").fill("2-Propanol");
  const rrow = page.locator("[data-reactivo]").filter({ hasText: "2-Propanol" }).first();
  await rrow.waitFor();
  const before = await page.locator("[data-reactivo]").filter({ hasText: "2-Propanol" }).count();
  await rrow.getByRole("button", { name: "Acciones" }).click();
  await page.getByRole("menuitem", { name: /Dar de baja/ }).click();
  await fillPrompt("Prueba UI: frasco roto", "Dar de baja");
  await page.getByText(/baja/i).first().waitFor();
  await page.waitForFunction((n) => [...document.querySelectorAll("[data-reactivo]")].filter((tr) => tr.textContent.includes("2-Propanol")).length === n - 1, before);
  check("reactivo dado de baja desaparece de la lista", true, `antes=${before}`);
  await setFilterToggle("Mostrar bajas", true);
  const brow = page.locator("[data-reactivo]").filter({ hasText: "2-Propanol" }).filter({ hasText: "Baja" }).first();
  await brow.waitFor();
  check("reactivo en baja se distingue con etiqueta 'Baja'", true);
  await brow.getByRole("button", { name: "Acciones" }).click();
  await page.getByRole("menuitem", { name: /^Reactivar/ }).click();
  await fillPrompt("Prueba UI: se repuso el frasco", "Reactivar");
  await setFilterToggle("Mostrar bajas", false);
  await page.waitForFunction((n) => [...document.querySelectorAll("[data-reactivo]")].filter((tr) => tr.textContent.includes("2-Propanol")).length === n, before);
  check("reactivo reactivado vuelve a la lista", true);

  /* ---------- Inicio y buscador ---------- */
  await page.goto(`${BASE}/`);
  await page.getByRole("button", { name: "Desplegar Muestras" }).click();
  await page.getByRole("link", { name: "Informes" }).first().waitFor();
  check("navegación principal: Muestras se despliega e incluye Informes", true);
  const search = page.locator('input[aria-label="Buscar en FICOTOX"]');
  await search.click();
  await search.fill("por revisar");
  // Dentro de los resultados (grupo "Pantallas"): el Inicio puede mostrar un aviso con el mismo texto.
  const vistas = page.getByRole("group", { name: "Pantallas" });
  await vistas.getByText("Informes por revisar o autorizar", { exact: true }).waitFor();
  check("buscador: vistas por estado («por revisar»)", (await vistas.getByText("Análisis por revisar o aprobar", { exact: true }).count()) === 1);
  await search.fill("ayuda");
  await page.getByText("Cómo usar la plataforma", { exact: true }).waitFor();
  check("buscador: temas de ayuda", true);
  await search.fill("nueva extracción");
  await page.getByText("Nueva extracción DSP", { exact: true }).waitFor();
  check("buscador: acciones específicas (ASP/DSP) al escribir", (await page.getByText("Nueva extracción ASP", { exact: true }).count()) === 1);
  /* Folio corto: "IR 1" debe abrir IR 0000001 como primer resultado y sin ruido de acciones ("ir" está en "abrir"). */
  await search.fill("IR 1");
  await page.locator("[cmdk-item][data-selected=true]").filter({ hasText: /IR\s*0000001/ }).waitFor();
  check("buscador: folio corto «IR 1» selecciona IR 0000001 primero", (await page.locator("[cmdk-item]").filter({ hasText: /Nueva|Abrir/ }).count()) === 0);
  await search.fill("R 1");
  await page.locator("[cmdk-item][data-selected=true]").filter({ hasText: /(^|[^A-Z])R\s*0000001/ }).waitFor();
  check("buscador: «R 1» encuentra la recepción R 0000001", true);
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => /^\/muestras\/recepcion\/\d+$/.test(url.pathname));
  check("buscador: Enter abre el registro", true);
  await page.goto(`${BASE}/`);
  await search.click();
  await page.getByText("Recientes", { exact: true }).waitFor();
  check("buscador: lo abierto aparece en Recientes", (await page.locator("[cmdk-group-heading]").filter({ hasText: "Recientes" }).count()) === 1);
  await search.fill("");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Ayuda" }).first().click();
  await page.waitForURL((url) => url.pathname === "/ayuda");
  await page.getByRole("heading", { name: "Cómo se usa FICOTOX" }).waitFor();
  check("página de ayuda accesible desde la barra lateral", true);
  await page.goto(`${BASE}/`);
  await page.getByRole("link", { name: "Muestras" }).first().waitFor();
  await page.getByRole("button", { name: "Desplegar Calidad" }).click();
  await page.getByRole("link", { name: "Auditoría" }).first().waitFor();
  check("barra lateral: Calidad se despliega e incluye Auditoría", true);
  await page.getByRole("button", { name: "Menú de usuario" }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).waitFor();
  check("menú de usuario permite cerrar sesión", true);
  await page.keyboard.press("Escape");

  const realErrors = consoleErrors.filter((e) => !/favicon|hydrat|Download the React DevTools|status of 409|status of 401/i.test(e)); // 409 ELEGIR_CARGO y 401 reauth_required son parte del protocolo
  check("sin errores de consola", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
} catch (err) {
  console.error("ERROR", err);
  await page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), "fail.png"), fullPage: true });
  results.push({ name: "excepción", ok: false });
} finally {
  await browser.close();
}
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} pruebas OK`);
process.exit(ok === results.length ? 0 : 1);
