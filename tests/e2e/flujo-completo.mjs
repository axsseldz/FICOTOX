/*
 * Recorrido de punta a punta del laboratorio (E2E), en el navegador y con los
 * usuarios de prueba, cada uno con su rol. Las acciones clave se hacen en la
 * pantalla (recepción, análisis enviar/devolver/aprobar, informe y documentos);
 * lo muy costoso de capturar a mano (procesamiento, extracción, parte de la NC)
 * va por la API, como lo haría la interfaz.
 *
 * a) Inventario: alta de reactivo y consumible (Coord. Área Técnica); entrada y
 *    consumo (Técnico Analista); ajuste por conteo con fecha anterior.
 * b) Muestras: recepción con validaciones (Técnico Auxiliar), etiqueta,
 *    asignación (Coord.), procesamiento con supervisor distinto y extracción ASP
 *    que consume inventario; análisis con evidencia → revisión → devolver →
 *    corregir → revisar → aprobar; informe borrador → revisión → autorización →
 *    liberación (PDF en el visor, sin descarga) → envío con evidencia;
 *    disposición final y muestra cerrada.
 * c) Segundo usuario: anulación aprobada por otra persona en «Por autorizar»;
 *    reactivación de una cuenta.
 * d) Calidad: incidencia → evaluación → NC → acción → verificación → cierre;
 *    retención de un informe.
 * e) Documentos SGC: solicitud → asignar → elaborar → devolver → revisar →
 *    autorizar → publicar con distribución → lectura confirmada → nueva
 *    revisión (la anterior obsoleta) → renovar → obsoletar con segundo usuario
 *    → externo → Lista Maestra en PDF.
 * f) Respaldos: crear y probar la restauración (8/8 verificaciones).
 * g) Auditoría: bitácora íntegra y con los eventos del recorrido.
 * h) Negativos: sin permiso (botón oculto/deshabilitado, 403/404 por URL),
 *    segregación (quien elabora no revisa) y contraseña obligatoria.
 * Falla si hay errores de consola o avisos de React en las pantallas recorridas.
 *
 * Corre sobre la base de prueba de tests/run.mjs, después de las demás suites:
 * no depende de folios exactos (usa sellos únicos). E2E_SECCIONES=a,b,... corre
 * solo esas secciones (para depurar). E2E_LATENCIA_MS=1500 retrasa cada GET del
 * navegador a la API (simula el servidor cargado de la corrida completa).
 */
import "../lib/reauth-auto.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const BASE = process.env.BASE || "http://localhost:3100";
process.env.BASE = `${BASE}/api`;
const { api, cadena, credenciales, crearCheck, Database, EMAIL, fila, filas, hoy, enDias, informeLiberado, sesiones } = await import("../lib/calidad.mjs");
const { pdfConTexto } = await import("../lib/archivos.mjs");
const { adjuntarEvidencia, pdfDePrueba } = await import("../lib/evidencia.mjs");
const { registrarEnvio } = await import("../lib/envio.mjs");
const { accion, contarAccion, motivo: motivoAccion, cerrarMenu, pestana } = await import("../lib/ficha.mjs");
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const { check, terminar } = crearCheck();
const stamp = Date.now().toString(36).slice(-5).toUpperCase();
const { t, id } = await sesiones();
const QA_PWD = "QaFicotox2026!";
const pwd = (quien) => (quien === "qa" ? QA_PWD : credenciales[EMAIL[quien]]);
const NOMBRE = { luis: "Luis Fernando Castro Ruiz", ricardo: "Ricardo Medina Flores", mariana: "Mariana Delgado Peña", patricia: "Patricia Luna Herrera", gabriela: "Gabriela Ortiz Campos", ana: "Ana Sofía Torres Vega" };
const SIN_REAUTH = { "X-Sin-Reauth-Auto": "1" };
const SIN_APROBAR = { "X-Sin-Aprobar-Auto": "1" };
const fechaEs = (iso) => iso.split("-").reverse().join("/");
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fechaCorta = (iso) => `${Number(iso.slice(8, 10))} ${MESES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const CAPTURAS = process.env.E2E_CAPTURAS || path.join(os.tmpdir(), "ficotox-e2e");
mkdirSync(CAPTURAS, { recursive: true });
const SECCIONES = new Set((process.env.E2E_SECCIONES || "a,b,c,d,e,f,g,h").split(",").map((s) => s.trim()));
/* Ids que se comparten entre secciones (inventario → extracción, recorrido → auditoría). */
const E = {};

/* ---------- Navegador: consola, descargas y errores del servidor ---------- */
const browser = await chromium.launch({ executablePath, headless: true });
const consola = [];
const errores500 = [];
const pantalla = (page) => {
  try {
    return new URL(page.url()).pathname;
  } catch {
    return "?";
  }
};
const AVISO_REACT = /Warning:|React|hydrat|unique "key"|act\(|Cannot update a component/i;
const LATENCIA = Number(process.env.E2E_LATENCIA_MS || 0);
/* Tiempos de cada paso y bloque, con la petición a la API más lenta (tiempos.json en la carpeta de capturas). */
const TIEMPOS = [];
const nueva = async (opciones = {}) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true, ...opciones });
  if (LATENCIA > 0) {
    await context.route("**/api/**", async (route) => {
      if (route.request().method() === "GET") await new Promise((r) => setTimeout(r, LATENCIA));
      await route.continue();
    });
  }
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  const descargas = [];
  const peticiones = [];
  page.on("requestfinished", (req) => {
    if (!req.url().includes("/api/")) return;
    const ms = Math.round(req.timing().responseEnd);
    if (ms > 0) peticiones.push({ ms, ruta: `${req.method()} ${new URL(req.url()).pathname}` });
  });
  page.on("download", (d) => descargas.push(d.suggestedFilename()));
  page.on("console", (msg) => {
    const tipo = msg.type();
    const texto = msg.text();
    // Los 4xx esperados (pruebas por URL directa, reautenticación) llegan como "Failed to load resource"; los 5xx se cuentan aparte.
    if (tipo === "error" && !/Failed to load resource/.test(texto)) consola.push(`[${pantalla(page)}] ${texto}`);
    else if (tipo === "warning" && AVISO_REACT.test(texto)) consola.push(`[${pantalla(page)}] aviso: ${texto}`);
  });
  page.on("pageerror", (err) => consola.push(`[${pantalla(page)}] pageerror: ${err.message}`));
  page.on("response", (r) => {
    if (r.status() >= 500 && r.url().includes("/api/")) errores500.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname} [${pantalla(page)}]`);
  });
  return { context, page, descargas, peticiones };
};
const entrar = async (page, quien) => {
  await page.goto(`${BASE}/login`);
  await page.fill("#login-email", quien === "qa" ? "qa@ficotox.local" : EMAIL[quien]);
  await page.fill("#login-password", pwd(quien));
  await page.click("button[type=submit]");
  // El primer acceso puede tardar mientras el servidor de desarrollo compila las páginas.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 });
};
const captura = async (page, nombre) => page.screenshot({ path: path.join(CAPTURAS, `fallo-${nombre.replace(/[^a-z0-9]/gi, "").slice(0, 40)}.png`), fullPage: true }).catch(() => {});
/* Un paso = una persona en su propia sesión del navegador; si algo truena, el paso queda FAIL con el motivo y la pantalla. */
const paso = async (quien, nombre, fn, opciones) => {
  const { context, page, descargas, peticiones } = await nueva(opciones);
  const inicio = Date.now();
  let ok = true;
  try {
    await entrar(page, quien);
    await fn(page, { context, descargas });
  } catch (err) {
    ok = false;
    await captura(page, nombre);
    const linea = err instanceof Error ? (err.stack || "").split("\n").find((l) => l.includes("flujo-completo.mjs")) || "" : "";
    check(nombre, false, `${err instanceof Error ? err.message.split("\n")[0] : String(err)} ${linea.trim()} [pantalla ${pantalla(page)}]`);
  } finally {
    const lenta = peticiones.reduce((a, b) => (b.ms > a.ms ? b : a), { ms: 0, ruta: "" });
    TIEMPOS.push({ nombre, quien, ms: Date.now() - inicio, ok, api_lenta: lenta, api_peticiones: peticiones.length });
    await context.close();
  }
};
/* Bloque sin navegador (API): si truena, queda FAIL con el motivo. */
const bloque = async (nombre, fn) => {
  const inicio = Date.now();
  let ok = true;
  try {
    await fn();
  } catch (err) {
    ok = false;
    check(nombre, false, err instanceof Error ? `${err.message} ${(err.stack || "").split("\n").find((l) => l.includes("flujo-completo.mjs"))?.trim() || ""}` : String(err));
  } finally {
    TIEMPOS.push({ nombre, quien: "api", ms: Date.now() - inicio, ok });
  }
};

/* ---------- Utilidades de pantalla ---------- */
const toast = (page, re, timeout = 30_000) => page.locator("[data-sonner-toast]").filter({ hasText: re }).last().waitFor({ timeout });
/*
 * Los formatos abren «paso a paso»; para llenar con selectores fijos se muestra completo (control «Todo»).
 * La guía de secciones siempre se dibuja; el control solo si el formato no es de solo lectura (revisor).
 */
const mostrarTodo = async (page) => {
  const todo = page.getByRole("radio", { name: "Todo" }).first();
  await page.getByRole("navigation", { name: "Secciones del formato" }).waitFor();
  if (!(await todo.count())) return;
  for (let i = 0; i < 5 && (await todo.getAttribute("aria-checked")) !== "true"; i += 1) {
    await todo.click();
    await page.waitForFunction(() => document.querySelector('[role="radio"][aria-checked="true"]')?.textContent?.includes("Todo"), null, { timeout: 3000 }).catch(() => {});
  }
};
const firmar = async (page, etiqueta) => {
  const canvas = page.locator(`canvas[aria-label="${etiqueta}"]`);
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 80, { steps: 6 });
  await page.mouse.move(box.x + 200, box.y + 40, { steps: 6 });
  await page.mouse.up();
};
/* «Confirma tu identidad»: la contraseña de quien actúa. */
const contrasena = async (page, quien, valor = pwd(quien)) => {
  await page.locator("#reauth-password").fill(valor);
  await page.getByRole("dialog", { name: "Confirma tu identidad" }).getByRole("button", { name: "Confirmar", exact: true }).click();
};
/* Diálogo de motivo (y contraseña si es crítico). */
const dialogoMotivo = async (page, motivo, confirmar, quien) => {
  await page.locator("#prompt-motivo").waitFor();
  await page.locator("#prompt-motivo").fill(motivo);
  if (quien && (await page.locator("#prompt-password").count())) await page.locator("#prompt-password").fill(pwd(quien));
  await page.getByRole("dialog").getByRole("button", { name: confirmar, exact: true }).click();
};
/* Cierra el resumen de validación («Entendido») y espera a que se vaya. */
const entendido = async (page) => {
  await page.getByRole("button", { name: "Entendido" }).last().click();
  await page.getByRole("button", { name: "Entendido" }).waitFor({ state: "detached" }).catch(() => {});
};
const filaLista = (page, texto) => page.locator("tbody tr").filter({ hasText: texto }).first();
const sinAcceso = (page) => page.getByText(/Sin acceso a esta sección|no encontrad|no está asignada|No tienes permiso/i).first().waitFor();
/* Espera (sondeando) a que se cumpla una condición del servidor; devuelve el último valor. */
const esperar = async (fn, ms = 20_000) => {
  const inicio = Date.now();
  let v = await fn();
  while (!v && Date.now() - inicio < ms) {
    await new Promise((r) => setTimeout(r, 300));
    v = await fn();
  }
  return v;
};
/* Aprueba en «Por autorizar» la solicitud pendiente que cumpla `cond` (lo hace `quien`, ya con sesión en `page`). */
const aprobarPorAutorizar = async (page, quien, cond, motivo) => {
  const lista = (await api("GET", "/solicitudes", undefined, t[quien])).data?.items || [];
  const sol = lista.find((s) => s.estado === "pendiente" && cond(s));
  if (!sol) throw new Error(`No hay una solicitud pendiente para ${quien} (${lista.length} en la lista)`);
  await page.goto(`${BASE}/solicitudes`);
  await page.getByRole("heading", { name: "Pendientes de tu autorización" }).waitFor();
  const renglon = page.locator(`[data-solicitud="${sol.id}"]`).first();
  await renglon.waitFor();
  await renglon.locator("button[aria-haspopup=dialog]").click();
  await page.locator(`[data-solicitud-ventana="${sol.id}"]`).getByRole("button", { name: "Aprobar", exact: true }).click();
  await page.locator("#ap-motivo").fill(motivo);
  await page.locator("#ap-password").fill(pwd(quien));
  await page.getByRole("dialog").getByRole("button", { name: "Aprobar y ejecutar" }).click();
  await page.getByText(/aprobada y ejecutada/i).first().waitFor();
  return sol;
};
const reactivoDe = async (rid, quien = "ricardo") => (await api("GET", `/inventory/reactivos/${rid}`, undefined, t[quien])).data?.item || null;
const existenciaReactivo = async (rid) => Number((await reactivoDe(rid))?.cantidad_actual);
const eventos = async (entidad, entidadId) => ((await api("GET", `/audit?entidad=${entidad}&entidad_id=${entidadId}&limit=500`, undefined, t.qa)).data?.items || []).map((x) => x.accion);

/* ======================================================================
 * a) Inventario
 * ==================================================================== */
async function inventario() {
  const R_NOMBRE = `Metanol E2E ${stamp}`;
  const C_NOMBRE = `Puntas E2E ${stamp}`;
  await paso("ricardo", "a) alta de reactivo y consumible", async (page) => {
    await page.goto(`${BASE}/inventario/reactivos`);
    await page.getByRole("button", { name: "Nuevo reactivo" }).first().click();
    await page.locator('button[form="reactivo-form"][type="submit"]').click();
    const pop = page.locator('[data-validacion="faltan"]');
    await pop.waitFor();
    check("a) reactivo sin categoría: no se crea y el pop-up dice qué falta", /categor/i.test(await pop.innerText()), (await pop.innerText()).replace(/\s+/g, " ").slice(0, 120));
    await entendido(page);
    await page.getByRole("radio", { name: /^Alcoholes y solventes/ }).check();
    await page.locator("#reactivo-producto").fill(R_NOMBRE);
    await page.locator("#reactivo-capacidad").fill("1");
    await page.locator("#reactivo-unidad_capacidad").selectOption("L");
    await page.locator("#reactivo-piezas").fill("2");
    await page.locator('button[form="reactivo-form"][type="submit"]').click();
    await toast(page, /Reactivo creado/);
    const r = ((await api("GET", `/inventory/reactivos?search=${encodeURIComponent(R_NOMBRE)}`, undefined, t.ricardo)).data?.items || []).find((x) => String(x.producto || x.nombre) === R_NOMBRE);
    E.reactivoId = r?.id;
    check("a) alta de reactivo en pantalla: existencia inicial = capacidad × piezas (2 L)", !!r && Number(r.cantidad_actual) === 2, `id=${r?.id} existencia=${r?.cantidad_actual}`);
    await page.locator(`[data-reactivo="${E.reactivoId}"]`).waitFor();
    check("a) el reactivo nuevo aparece en la lista", true);

    await page.goto(`${BASE}/inventario/consumibles`);
    await page.getByRole("button", { name: "Nuevo consumible" }).first().click();
    await page.locator("#c-producto").fill(C_NOMBRE);
    await page.locator("#c-piezas").fill("10");
    await page.locator('button[form="consumible-form"][type="submit"]').click();
    await toast(page, /creado|registrado/i);
    const c = ((await api("GET", `/consumables?search=${encodeURIComponent(C_NOMBRE)}`, undefined, t.ricardo)).data?.items || []).find((x) => String(x.producto) === C_NOMBRE);
    E.consumibleId = c?.id;
    check("a) alta de consumible en pantalla: existencia inicial 10 piezas", !!c && Number(c.existencia) === 10, `id=${c?.id} existencia=${c?.existencia}`);
  });
  if (!E.reactivoId || !E.consumibleId) return;

  await paso("luis", "a) entrada y consumo", async (page) => {
    await page.goto(`${BASE}/inventario/reactivos?buscar=${encodeURIComponent(R_NOMBRE)}`);
    const filaR = page.locator(`[data-reactivo="${E.reactivoId}"]`);
    await filaR.waitFor();
    await filaR.getByRole("button", { name: "Acciones" }).click();
    await page.getByRole("menuitem", { name: /Registrar movimiento/ }).click();
    await page.locator("#refill-tipo").selectOption("entrada");
    await page.locator("#refill-amount").fill("1");
    await page.locator("#refill-reason").fill("Reposición: llegó una botella del proveedor");
    await page.locator('button[form="stock-refill-form"]').click();
    await toast(page, /Movimiento registrado/);
    check("a) entrada de 1 L (Técnico Analista): existencia 2 → 3 L", (await existenciaReactivo(E.reactivoId)) === 3, String(await existenciaReactivo(E.reactivoId)));

    await page.goto(`${BASE}/inventario/consumibles?buscar=${encodeURIComponent(C_NOMBRE)}`);
    const filaC = page.locator(`[data-consumible="${E.consumibleId}"]`);
    await filaC.waitFor();
    await filaC.getByRole("button", { name: "Acciones" }).click();
    await page.getByRole("menuitem", { name: /Registrar movimiento/ }).click();
    await page.locator("#refill-tipo").selectOption("consumo");
    await page.locator("#refill-amount").fill("3");
    await page.locator("#refill-reason").fill("Puntas usadas en la extracción del día");
    await page.locator('button[form="stock-refill-form"]').click();
    await toast(page, /Movimiento registrado/);
    const c = (await api("GET", `/consumables/${E.consumibleId}`, undefined, t.ricardo)).data?.item;
    check("a) consumo de 3 piezas: existencia 10 → 7", Number(c?.existencia) === 7, String(c?.existencia));
  });

  await paso("ricardo", "a) ajuste por conteo con fecha anterior", async (page) => {
    await page.goto(`${BASE}/inventario/reactivos?buscar=${encodeURIComponent(R_NOMBRE)}`);
    const filaR = page.locator(`[data-reactivo="${E.reactivoId}"]`);
    await filaR.waitFor();
    await filaR.getByRole("button", { name: "Acciones" }).click();
    await page.getByRole("menuitem", { name: /Registrar movimiento/ }).click();
    await page.locator("#refill-tipo").selectOption("ajuste");
    await page.locator("#refill-amount").fill("2.5");
    // Sin motivo y con fecha futura: el formulario lo marca antes de enviar.
    await page.locator("#refill-fecha").fill(fechaEs(enDias(2)));
    await page.locator("#refill-fecha").blur();
    await page.locator('button[form="stock-refill-form"]').click();
    const pop = page.locator('[data-validacion="faltan"]');
    await pop.waitFor();
    const texto = await pop.innerText();
    check("a) ajuste sin motivo y con fecha futura: no se registra (pop-up con ambos)", /motivo del ajuste/i.test(texto) && /futura/i.test(texto), texto.replace(/\s+/g, " ").slice(0, 160));
    await entendido(page);
    const anterior = enDias(-5);
    // El conteo de hace 5 días necesita un alta anterior: se fecha el alta (y su existencia inicial) hace 10 días.
    const db = new Database(process.env.TEST_DB_PATH);
    db.prepare("UPDATE reactivos SET creado_en = datetime('now', '-10 days') WHERE id = ?").run(E.reactivoId);
    db.prepare("UPDATE movimientos SET fecha_movimiento = ? WHERE tabla_origen = 'reactivos' AND id_item = ? AND motivo = 'Existencia inicial'").run(enDias(-10), E.reactivoId);
    db.close();
    await page.locator("#refill-fecha").fill(fechaEs(anterior));
    await page.locator("#refill-fecha").blur();
    await page.locator("#refill-reason").fill("Conteo físico mensual: el frasco abierto tenía 2.5 L");
    await page.locator('button[form="stock-refill-form"]').click();
    await toast(page, /Existencia ajustada/);
    const mov = fila("SELECT tipo, fecha_movimiento, motivo FROM movimientos WHERE tabla_origen = 'reactivos' AND id_item = ? ORDER BY id DESC LIMIT 1", E.reactivoId);
    // Lo contado es la existencia de ese día; la entrada de 1 L de hoy se conserva: 2.5 + 1 = 3.5 L.
    check("a) ajuste por conteo con fecha anterior: existencia 2.5 L contados + 1 L que entró después = 3.5 L, movimiento con la fecha del conteo", (await existenciaReactivo(E.reactivoId)) === 3.5 && mov?.tipo === "ajuste" && mov?.fecha_movimiento === anterior, `${await existenciaReactivo(E.reactivoId)} ${JSON.stringify(mov)}`);
    await page.goto(`${BASE}/movimientos`);
    await page.getByPlaceholder("Buscar por insumo, referencia o motivo").fill(R_NOMBRE);
    const filaM = page.locator("[data-movimiento]").filter({ hasText: "Ajuste por conteo" }).first();
    await filaM.waitFor();
    const textoM = (await filaM.innerText()).replace(/\s+/g, " ");
    check("a) la lista de movimientos muestra el ajuste con la fecha del conteo y la de captura", textoM.includes(fechaCorta(anterior)) && /Capturado el/.test(textoM), textoM);
    const futura = await api("POST", `/inventory/reactivos/${E.reactivoId}/refill`, { tipo: "entrada", cantidad: 1, fecha_movimiento: enDias(3), motivo: "Fecha futura por API" }, t.ricardo);
    check("h) movimiento con fecha futura por la API → 400", futura.status === 400, `${futura.status} ${futura.data?.message}`);
  });

  await paso("hector", "h) Auditor: inventario en solo lectura", async (page) => {
    await page.goto(`${BASE}/inventario/reactivos?buscar=${encodeURIComponent(R_NOMBRE)}`);
    const filaR = page.locator(`[data-reactivo="${E.reactivoId}"]`);
    await filaR.waitFor();
    check("h) Auditor: sin «Nuevo reactivo»", (await page.getByRole("button", { name: "Nuevo reactivo" }).count()) === 0);
    const menu = filaR.getByRole("button", { name: "Acciones" });
    let enMenu = 0;
    if (await menu.count()) {
      await menu.click();
      enMenu = await page.getByRole("menuitem", { name: /Registrar movimiento|Dar de baja/ }).count();
      await page.keyboard.press("Escape");
    }
    check("h) Auditor: sin «Registrar movimiento» ni «Dar de baja» en el renglón", enMenu === 0, `${enMenu}`);
    const alta = await api("POST", "/inventory/reactivos", { tipo_reactivo: "acidos", producto: `Intento ${stamp}` }, t.hector);
    const mov = await api("POST", `/inventory/reactivos/${E.reactivoId}/refill`, { tipo: "entrada", cantidad: 1, fecha_movimiento: hoy() }, t.hector);
    check("h) Auditor por la API: alta y movimiento → 403", alta.status === 403 && mov.status === 403, `${alta.status} ${mov.status}`);
  });
}

/* ======================================================================
 * b) Muestras: recepción → … → disposición final
 * ==================================================================== */
async function muestras() {
  const ID_INT = `E2E-${stamp}`;
  // Equipo propio (operativo, calibración vigente) autorizado a Luis: el análisis no depende del de otras suites.
  const EQUIPO = `HPLC E2E ${stamp}`;
  await bloque("b) datos de apoyo: equipo y reactivo", async () => {
    const eq = await api("POST", "/inventory/equipos", { nombre: EQUIPO, estado: "operativo", fecha_prox_calibracion: enDias(200) }, t.ricardo);
    E.equipoId = eq.data?.id;
    const aut = await api("POST", `/admin/usuarios/${id.luis}/autorizaciones`, { tipo: "equipo", clave: String(E.equipoId), folio_fx_thf_ap: "FX-THF-AP-E2E", motivo: "Equipo del recorrido E2E" }, t.ricardo);
    if (!E.reactivoId) E.reactivoId = (await api("POST", "/inventory/reactivos", { tipo_reactivo: "alcoholes_solventes", producto: `Metanol E2E ${stamp}`, capacidad: 1, unidad_capacidad: "L", piezas: 2 }, t.ricardo)).data?.id;
    check("b) datos de apoyo: equipo operativo autorizado al analista", eq.status === 201 && [200, 201].includes(aut.status) && !!E.reactivoId, `${eq.status} ${aut.status} ${E.reactivoId}`);
  });

  /* ---------- Recepción (Técnico Auxiliar) ---------- */
  await paso("mariana", "b) recepción en pantalla", async (page, { context }) => {
    await page.goto(`${BASE}/muestras/recepcion/nueva`);
    await page.waitForFunction(() => (document.querySelector("#r-folio") || {}).value !== "");
    await mostrarTodo(page);
    await page.getByRole("button", { name: "Registrar recepción" }).click();
    const pop = page.locator('[data-validacion="faltan"]');
    await pop.waitFor();
    const texto = (await pop.textContent()) || "";
    check("b) recepción incompleta: no se guarda y el pop-up lista los faltantes", /No se pudo registrar la recepción — Faltan \d+ datos/.test(texto) && texto.includes("Indica el solicitante") && page.url().includes("/muestras/recepcion/nueva"), texto.slice(0, 160));
    await entendido(page);
    check("b) el campo con problema queda en rojo (aria-invalid)", (await page.locator("#r-solicitante").getAttribute("aria-invalid")) === "true");
    const ningunaAun = ((await api("GET", `/samples/reception?search=${ID_INT}`, undefined, t.qa)).data?.items || []).length;
    check("b) nada se registró antes de guardar", ningunaAun === 0, String(ningunaAun));

    await page.fill("#r-fecha", hoy());
    await page.fill("#r-id", ID_INT);
    await page.selectOption("#r-medio", { index: 1 });
    await page.fill("#r-solicitante", `Cooperativa Bahía E2E ${stamp}`);
    check("b) «Recibido por» prellenado con quien tiene la sesión", ((await page.locator("#r-recibido option:checked").textContent()) || "").includes("Mariana"));
    await page.getByLabel("Ácido domoico (ASP)").check();
    await page.getByLabel("Cromatografía de líquidos").check();
    await page.getByLabel("Organismo completo").check();
    const grupos = page.locator('#sec-inspeccion [role="radiogroup"]');
    const n = await grupos.count();
    for (let i = 0; i < n; i += 1) await grupos.nth(i).getByRole("radio", { name: "C", exact: true }).click();
    await page.getByRole("radio", { name: /^Aceptada\s+Cumple/ }).check();
    await page.fill("#r-acep-fecha", hoy());
    const opciones = await page.locator("#r-acep-resp option").allTextContents();
    const responsable = opciones.find((o) => o.includes("Mariana")) || opciones.find((o) => o.trim() && !/Selecciona|Elige/.test(o));
    if (responsable) await page.locator("#r-acep-resp").selectOption({ label: responsable });
    await page.fill("#r-acep-temp", "6 °C");
    await page.fill("#r-sol-nombre", "Juan Pérez (pescador)");
    await firmar(page, "Firma de conformidad del solicitante");
    await page.getByLabel(/He revisado la información/).check();
    await page.getByRole("radio", { name: /^Congelador/ }).check();
    await firmar(page, "Firma · Custodio");
    await page.getByRole("button", { name: "Registrar recepción" }).click();
    await page.waitForURL((url) => url.pathname === "/muestras/recepcion");
    const r = ((await api("GET", `/samples/reception?search=${ID_INT}`, undefined, t.qa)).data?.items || [])[0];
    E.recepcionId = r?.id;
    E.folioR = r ? `R ${String(r.folio_num).padStart(7, "0")}` : null;
    check("b) recepción registrada y aceptada", !!r && r.decision_aceptacion === "aceptada", `${E.folioR} ${r?.decision_aceptacion} ${r?.estado}`);

    // Etiqueta: una por muestra con folio e ID interno; «Imprimir» deja rastro en la bitácora.
    await context.addInitScript(() => {
      window.print = () => {
        window.__impreso = true;
      };
    });
    await page.goto(`${BASE}/muestras/recepcion`);
    await page.getByPlaceholder("Buscar por folio, solicitante o ID interno").fill(ID_INT);
    const renglon = filaLista(page, ID_INT);
    await renglon.waitFor();
    await renglon.getByRole("button", { name: "Acciones" }).click();
    await page.getByRole("menuitem", { name: /Imprimir etiqueta/ }).click();
    await page.waitForURL(/\/etiquetas$/);
    const etiqueta = page.locator("#etiquetas-impresion [data-etiqueta]").first();
    await etiqueta.waitFor();
    const textoEt = (await etiqueta.textContent()) || "";
    check("b) etiqueta con el folio R y el ID interno", textoEt.includes(ID_INT) && textoEt.includes(E.folioR), textoEt.slice(0, 120));
    await page.getByRole("button", { name: "Imprimir" }).click();
    await page.waitForFunction(() => window.__impreso === true);
    check("b) «Imprimir» la etiqueta queda en la bitácora", (await eventos("muestras_recepcion", E.recepcionId)).includes("imprimir_etiquetas"));
  });
  if (!E.recepcionId) return;

  /* ---------- Negativo: el analista no ve una muestra que no tiene asignada ---------- */
  await paso("luis", "h) analista sin asignación: la muestra no existe para él", async (page) => {
    const r = await api("GET", `/samples/reception/${E.recepcionId}`, undefined, t.luis);
    await page.goto(`${BASE}/muestras/recepcion/${E.recepcionId}`);
    await sinAcceso(page);
    const aviso = await page.getByText(/no está asignada|no encontrad/i).first().innerText();
    check("h) Técnico Analista sin asignación: la API la niega (403 no_asignado) y la pantalla avisa por URL directa", r.status === 403 && r.data?.codigo === "no_asignado", `${r.status} ${r.data?.codigo} «${aviso}»`);
    check("h) Técnico Analista: sin «Nueva recepción»", await (async () => {
      await page.goto(`${BASE}/muestras/recepcion`);
      await page.getByPlaceholder("Buscar por folio, solicitante o ID interno").waitFor();
      return (await page.getByRole("button", { name: "Nueva recepción" }).count()) === 0;
    })());
  });

  /* ---------- Asignación (Coord. Área Técnica) ---------- */
  await paso("ricardo", "b) asignación de la muestra", async (page) => {
    await page.goto(`${BASE}/muestras/recepcion`);
    await page.getByPlaceholder("Buscar por folio, solicitante o ID interno").fill(ID_INT);
    const renglon = filaLista(page, ID_INT);
    await renglon.waitFor();
    await renglon.getByRole("button", { name: "Acciones" }).click();
    await page.getByRole("menuitem", { name: /^Asignar/ }).click();
    await page.locator("#asignar-usuario").selectOption(String(id.luis));
    await page.getByRole("dialog").getByRole("button", { name: "Asignar", exact: true }).click();
    await toast(page, /asignad/i);
    const lista = (await api("GET", `/samples/reception/${E.recepcionId}/asignaciones`, undefined, t.ricardo)).data?.items || [];
    check("b) la muestra queda asignada al Técnico Analista", lista.some((a) => Number(a.usuario_id) === id.luis && !a.revocado_en), `${lista.length}`);
    check("b) asignada: el analista ya la ve (API 200)", (await api("GET", `/samples/reception/${E.recepcionId}`, undefined, t.luis)).status === 200);
  });

  /* ---------- Procesamiento con supervisor distinto: negativos por la API y el registro en su formato ---------- */
  await bloque("b) procesamiento (negativos)", async () => {
    const base = { recepcion_id: E.recepcionId, muestra_tipo: "unica", id_interno: ID_INT, fecha_procesamiento: hoy(), hora_procesamiento: "10:15", tipo_organismo: ["bivalvos"], parte_organismo: ["cuerpo_completo"], resguardo: { entregado_extraccion: true } };
    const mismo = await api("POST", "/samples/processing", { ...base, firmantes: { proceso: { usuario_id: id.luis }, superviso: { usuario_id: id.luis } } }, t.luis);
    check("h) segregación: quien procesó no puede firmar como supervisor (rechazado)", mismo.status >= 400 && mismo.status < 500, `${mismo.status} ${mismo.data?.message}`);
    const mala = await api("POST", "/samples/processing", { ...base, firmantes: { proceso: { usuario_id: id.luis }, superviso: { usuario_id: id.ricardo, password: "no-es-la-contrasena" } } }, t.luis);
    check("h) firma del supervisor con contraseña incorrecta → 401 y no se guarda", mala.status === 401, `${mala.status} ${mala.data?.codigo}`);
  });
  await paso("luis", "b) procesamiento en pantalla", async (page) => {
    await page.goto(`${BASE}/muestras/procesamiento/nuevo?recepcion=${E.recepcionId}`);
    await mostrarTodo(page);
    await page.locator("#p-id").waitFor();
    if (!(await page.inputValue("#p-id")).trim()) await page.fill("#p-id", ID_INT);
    await page.getByRole("radio", { name: /^Bivalvos/ }).check();
    await page.getByRole("checkbox", { name: /^Cuerpo completo/ }).check();
    await page.getByRole("checkbox", { name: /Seleccionar los organismos de mayor talla/ }).check();
    await page.getByRole("checkbox", { name: /^Entregado para extracción/ }).check();
    // Quien supervisó: otra persona, que confirma su firma con su contraseña en la misma pantalla.
    await page.locator("#persona-quien-superviso").selectOption({ label: "Ricardo Medina Flores" });
    await page.locator("#firma-password").fill(pwd("ricardo"));
    await page.getByRole("button", { name: "Confirmar firma" }).click();
    await page.locator("#firma-password").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Registrar procesamiento" }).click();
    // Si algún insumo o equipo pide confirmación, se guarda de todos modos (no es lo que se prueba aquí).
    const deTodos = page.getByRole("button", { name: "Guardar de todos modos" });
    await Promise.race([page.waitForURL((u) => u.pathname === "/muestras/procesamiento"), deTodos.waitFor().then(() => deTodos.click())]);
    await page.waitForURL((u) => u.pathname === "/muestras/procesamiento");
    const lista = (await api("GET", `/samples/processing?search=${encodeURIComponent(ID_INT)}`, undefined, t.luis)).data?.items || [];
    E.procesamientoId = lista.find((x) => Number(x.recepcion_id) === E.recepcionId)?.id;
    const item = E.procesamientoId ? (await api("GET", `/samples/processing/${E.procesamientoId}`, undefined, t.luis)).data?.item : null;
    check("b) procesamiento registrado en pantalla por el analista con supervisor distinto (firma confirmada con su contraseña)", !!item && Number(item.superviso_usuario_id) === id.ricardo && Number(item.proceso_usuario_id) === id.luis, `id=${E.procesamientoId} sup=${item?.superviso_usuario_id} proc=${item?.proceso_usuario_id}`);
  });
  if (!E.procesamientoId) return;

  /* ---------- Extracción ASP con consumo de inventario ---------- */
  await bloque("b) extracción ASP", async () => {
    const antes = await existenciaReactivo(E.reactivoId);
    const ex = await api("POST", "/samples/extraction", { tipo_registro: "E-A", procesamiento_id: E.procesamientoId, tipo_molienda: "fresca", muestra_tipo: "unica", id_interno: ID_INT, fecha_extraccion: hoy(), registro_pesos: [{ id_muestra: ID_INT, organismo: "bivalvos", peso_muestra: 10, replica: `${ID_INT}_R1`, peso_replica: 10 }], uso_inventario: [{ tipo: "reactivo", ref: String(E.reactivoId), cantidad: 0.1 }], firmantes: { extrajo: { usuario_id: id.luis }, superviso: { usuario_id: id.ricardo, password: pwd("ricardo") } } }, t.luis);
    E.extraccionId = ex.data?.id;
    const despues = await existenciaReactivo(E.reactivoId);
    check("b) extracción ASP registrada por el analista", ex.status === 201 && !!E.extraccionId, `${ex.status} ${ex.data?.message}`);
    check("b) la extracción consume inventario: la existencia del reactivo baja 0.1 L", Math.abs(antes - 0.1 - despues) < 1e-9, `${antes} → ${despues}`);
    const mov = fila("SELECT tipo, vinculo_tipo FROM movimientos WHERE tabla_origen = 'reactivos' AND id_item = ? ORDER BY id DESC LIMIT 1", E.reactivoId);
    check("b) el consumo queda como movimiento ligado a la extracción", /consumo|salida/.test(String(mov?.tipo)) && /extrac/.test(String(mov?.vinculo_tipo || "")), JSON.stringify(mov));
  });
  if (!E.extraccionId) return;

  /* ---------- Análisis: evidencia → revisión → devolver → corregir → revisar → aprobar ---------- */
  const abrirAnalisis = async (page) => {
    await page.goto(`${BASE}/muestras/analisis/${E.analisisId}`);
    await page.locator("#a-metodo").waitFor();
    await mostrarTodo(page);
  };
  const estadoA = async () => (await api("GET", `/samples/analysis/${E.analisisId}`, undefined, t.qa)).data?.item;
  await paso("luis", "b) análisis con evidencia y envío a revisión", async (page) => {
    await page.goto(`${BASE}/muestras/analisis/nuevo?extraccion=${E.extraccionId}`);
    await page.getByRole("heading", { name: /Nuevo análisis/ }).waitFor();
    await mostrarTodo(page);
    await page.waitForFunction(() => (document.querySelector("#a-folio") || {}).value !== "");
    await page.waitForFunction((v) => (document.querySelector("#a-ext") || {}).value === v, String(E.extraccionId));
    check("b) análisis: tipo ASP sugerido desde la extracción E-A", await page.getByLabel("Ácido domoico (ASP)").isChecked());
    await page.selectOption("#a-metodo", "hplc_uv_vis");
    await page.fill("#a-fecha", hoy());
    const equipo = page.getByPlaceholder(/Cromatógrafo, microscopio/);
    await equipo.click();
    await equipo.fill(`HPLC E2E ${stamp}`);
    await page.getByRole("option", { name: new RegExp(`HPLC E2E ${stamp}`) }).first().click();
    if (!(await page.locator('input[aria-label^="Resultado de "]').count())) await page.getByRole("button", { name: "Agregar muestra" }).click();
    const idMuestra = page.locator('input[aria-label^="ID de la muestra"]').first();
    if (!(await idMuestra.inputValue())) await idMuestra.fill(ID_INT);
    await page.locator('input[aria-label^="Resultado de "]').first().fill("12.5");
    await page.getByRole("button", { name: "Registrar análisis" }).click();
    await page.waitForURL((url) => url.pathname === "/muestras/analisis");
    E.analisisId = fila("SELECT id FROM muestras_analisis WHERE extraccion_id = ? ORDER BY id DESC LIMIT 1", E.extraccionId)?.id;
    check("b) análisis registrado en pantalla por el analista", !!E.analisisId && (await estadoA())?.estado === "registrado", `${E.analisisId}`);
    // La firma del analista (prellenada con la sesión) queda ligada a su cuenta.
    const firmaA = fila("SELECT analista_usuario_id FROM muestras_analisis WHERE id = ?", E.analisisId);
    check("b) la firma del analista queda ligada a su cuenta", Number(firmaA?.analista_usuario_id) === id.luis, JSON.stringify(firmaA));

    await abrirAnalisis(page);
    await page.locator("[data-evidencia]").waitFor();
    await page.getByText("Falta la evidencia instrumental").first().waitFor({ timeout: 15_000 }).catch(() => {});
    const enviar = page.getByRole("button", { name: "Enviar a revisión" }).first();
    check("h) sin evidencia: «Enviar a revisión» deshabilitado con el motivo visible", (await enviar.isDisabled()) && (await page.getByText("Falta la evidencia instrumental").count()) > 0);
    check("h) el analista (sin permiso de revisar) no ve «Marcar revisado» ni «Aprobar»", (await page.getByRole("button", { name: "Marcar revisado" }).count()) === 0 && (await page.getByRole("button", { name: "Aprobar", exact: true }).count()) === 0);
    await page.locator('input[aria-label="Archivo de evidencia"]').setInputFiles({ name: "cromatograma-e2e.pdf", mimeType: "application/pdf", buffer: pdfDePrueba(`Cromatograma E2E ${stamp} ${Date.now()}`) });
    await page.locator('textarea[id^="evidencia-desc-"]').fill("Cromatograma de la corrida E2E");
    await page.getByRole("button", { name: "Adjuntar evidencia" }).click();
    await page.locator("[data-adjunto]").filter({ hasText: "Cromatograma de la corrida E2E" }).first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Enviar a revisión" && !b.disabled));
    check("b) evidencia adjunta: «Enviar a revisión» se habilita", true);
    await page.getByRole("button", { name: "Enviar a revisión" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: /Enviar a revisión/ }).click();
    await page.waitForURL((url) => url.pathname === "/muestras/analisis");
    check("b) análisis enviado a revisión", (await estadoA())?.estado === "en_revision", (await estadoA())?.estado);
  });
  if (!E.analisisId) return;

  await paso("ricardo", "b) revisor devuelve el análisis", async (page) => {
    await abrirAnalisis(page);
    await page.getByRole("button", { name: "Devolver con observaciones" }).click();
    await dialogoMotivo(page, "Revisa el resultado: falta aplicar el factor de dilución", "Devolver");
    await page.waitForURL((url) => url.pathname === "/muestras/analisis");
    check("b) devuelto con observaciones: el análisis vuelve a registrado", (await estadoA())?.estado === "registrado", (await estadoA())?.estado);
  });

  await paso("luis", "b) analista corrige y reenvía", async (page) => {
    await abrirAnalisis(page);
    check("b) el analista ve las observaciones de la devolución", (await page.getByText(/factor de dilución/).count()) > 0);
    await page.locator('input[aria-label^="Resultado de "]').first().fill("25");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await page.waitForURL((url) => url.pathname === "/muestras/analisis");
    await abrirAnalisis(page);
    await page.getByRole("button", { name: "Enviar a revisión" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: /Enviar a revisión/ }).click();
    await page.waitForURL((url) => url.pathname === "/muestras/analisis");
    const a = await estadoA();
    check("b) corregido (resultado 25) y reenviado a revisión", a?.estado === "en_revision" && Number(a?.resultados?.[0]?.resultado) === 25, `${a?.estado} ${JSON.stringify(a?.resultados?.[0]?.resultado)}`);
  });

  await paso("ricardo", "b) revisor revisa y aprueba", async (page) => {
    await abrirAnalisis(page);
    await page.getByRole("button", { name: "Marcar revisado" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Marcar revisado", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/muestras/analisis");
    check("b) análisis revisado por otra persona", (await estadoA())?.estado === "revisado", (await estadoA())?.estado);
    await abrirAnalisis(page);
    await page.getByRole("button", { name: "Aprobar", exact: true }).click();
    await page.locator("#sign-password").fill("contrasena-incorrecta-1");
    await page.getByRole("dialog").getByRole("button", { name: "Aprobar", exact: true }).click();
    // Contraseña incorrecta: se vuelve a pedir («Confirma tu identidad») y no se aprueba.
    await page.locator("#reauth-password").waitFor();
    check("h) aprobar con contraseña incorrecta: se vuelve a pedir y no se aprueba", (await estadoA())?.estado === "revisado", (await estadoA())?.estado);
    await contrasena(page, "ricardo");
    await page.waitForURL((url) => url.pathname === "/muestras/analisis");
    check("b) análisis aprobado (con la contraseña correcta)", (await estadoA())?.estado === "aprobado", (await estadoA())?.estado);
  });

  /* ---------- Informe: borrador → revisión → autorización → liberación → envío ---------- */
  const estadoI = async () => (await api("GET", `/informes/${E.informeId}`, undefined, t.qa)).data?.item;
  await paso("luis", "b) informe en borrador", async (page) => {
    await page.goto(`${BASE}/informes/nuevo?recepcion=${E.recepcionId}`);
    await page.getByRole("heading", { name: /Nuevo informe/ }).waitFor();
    await mostrarTodo(page);
    const casillas = page.locator('#sec-analisis input[type="checkbox"]');
    await casillas.first().waitFor();
    for (let i = 0; i < (await casillas.count()); i += 1) if (!(await casillas.nth(i).isChecked())) await casillas.nth(i).check();
    if (!(await page.locator("#i-correo").inputValue())) await page.locator("#i-correo").fill("cooperativa@ejemplo.mx");
    await page.getByRole("button", { name: "Crear borrador" }).click();
    await page.waitForURL((url) => /^\/informes\/\d+$/.test(url.pathname));
    E.informeId = Number(new URL(page.url()).pathname.split("/").pop());
    check("b) informe creado en borrador por el analista", (await estadoI())?.estado === "borrador", `${E.informeId}`);
    check("h) el analista no ve «Marcar revisado» ni «Autorizar» en el informe", (await page.getByRole("button", { name: "Marcar revisado" }).count()) === 0 && (await page.getByRole("button", { name: "Autorizar", exact: true }).count()) === 0);
  });
  if (!E.informeId) return;
  await paso("ricardo", "b) informe revisado", async (page) => {
    await page.goto(`${BASE}/informes/${E.informeId}`);
    await page.getByRole("button", { name: "Marcar revisado" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Marcar revisado", exact: true }).click();
    const revisado = await esperar(async () => (await estadoI())?.estado === "en_revision");
    check("b) informe marcado como revisado (en revisión)", revisado, (await estadoI())?.estado);
  });
  await paso("patricia", "b) informe autorizado, liberado y enviado", async (page, { descargas, context }) => {
    let pestanas = 0;
    context.on("page", () => (pestanas += 1));
    await page.goto(`${BASE}/informes/${E.informeId}`);
    await page.getByRole("button", { name: "Autorizar", exact: true }).click();
    await firmar(page, "Firma: Autorizar informe");
    await page.locator("#sign-password").fill(pwd("patricia"));
    await page.getByRole("dialog").getByRole("button", { name: "Autorizar", exact: true }).click();
    await toast(page, /Informe autorizado/);
    check("b) informe autorizado (Responsable General, firma y contraseña)", (await estadoI())?.estado === "autorizado", (await estadoI())?.estado);
    await page.getByRole("button", { name: "Liberar", exact: true }).click();
    if (await page.locator("#sign-password").count()) await page.locator("#sign-password").fill(pwd("patricia"));
    await page.getByRole("dialog").getByRole("button", { name: "Liberar", exact: true }).click();
    await toast(page, /liberado/i);
    check("b) informe liberado (PDF final)", (await estadoI())?.estado === "liberado", (await estadoI())?.estado);
    await page.getByRole("button", { name: "Ver informe" }).click();
    await page.waitForURL((url) => url.pathname === `/informes/${E.informeId}/ver`);
    await page.getByTestId("visor-pdf").first().waitFor();
    await page.locator('[data-testid="visor-pdf"] canvas').first().waitFor({ timeout: 60_000 });
    await page.waitForFunction(() => /^\d+$/.test(document.querySelector("[data-testid=visor-total-paginas]")?.textContent || ""));
    check("b) el PDF del informe se ve en el visor interno, sin descarga automática ni pestaña nueva", descargas.length === 0 && pestanas === 0, `descargas=${descargas.join(",")} pestañas=${pestanas}`);
    await page.goto(`${BASE}/informes/${E.informeId}`);
    await page.locator("#envio-nombre").waitFor();
    await page.fill("#envio-nombre", "Juan Pérez");
    await page.fill("#envio-correo", "cooperativa@ejemplo.mx");
    await page.locator("#envio-evidencia").setInputFiles({ name: "evidencia-envio.pdf", mimeType: "application/pdf", buffer: pdfDePrueba(`Evidencia de envío ${stamp}`) });
    await page.getByRole("button", { name: "Registrar envío", exact: true }).click();
    await page.locator("[data-envio]").first().waitFor();
    const enviado = await esperar(async () => (await estadoI())?.estado === "enviado");
    // La lista de envíos se vuelve a leer al cambiar el estado: se espera a que se pinte de nuevo.
    await page.locator("[data-envio]").first().waitFor();
    check("b) envío registrado con evidencia: el informe queda enviado", enviado && (await page.locator("[data-envio]").count()) >= 1, (await estadoI())?.estado);
    check("b) en ningún momento se disparó una descarga", descargas.length === 0, descargas.join(","));
  });

  /* ---------- Disposición final (contraseña obligatoria) ---------- */
  await bloque("h) disposición sin contraseña por la API", async () => {
    const r = await api("POST", `/samples/reception/${E.recepcionId}/disposicion`, { tipo: "rpbi", fecha: hoy(), responsable: NOMBRE.ricardo }, t.ricardo, SIN_REAUTH);
    check("h) disposición final sin reautenticación → 401 reauth_required", r.status === 401 && r.data?.codigo === "reauth_required", `${r.status} ${r.data?.codigo}`);
  });
  await paso("ricardo", "b) disposición final y muestra cerrada", async (page) => {
    await page.goto(`${BASE}/muestras/recepcion/${E.recepcionId}`);
    await page.locator("h1").first().waitFor();
    await mostrarTodo(page);
    const opcion = page.locator('label:has(input[name="r-disp"])').first();
    await opcion.scrollIntoViewIfNeeded();
    await opcion.click();
    await page.getByRole("button", { name: "Registrar disposición y cerrar la muestra" }).click();
    const confirma = page.getByRole("dialog", { name: "Confirma tu identidad" });
    await confirma.waitFor();
    await page.fill("#reauth-password", "incorrecta-000");
    await confirma.getByRole("button", { name: "Confirmar" }).click();
    await page.getByText(/contraseña no es correcta/i).first().waitFor();
    const sigue = (await api("GET", `/samples/reception/${E.recepcionId}`, undefined, t.qa)).data?.item?.estado;
    check("h) disposición con contraseña incorrecta: se vuelve a pedir y la muestra no se cierra", sigue !== "cerrada" && (await page.locator("#reauth-password").getAttribute("aria-invalid")) === "true", sigue);
    await page.fill("#reauth-password", pwd("ricardo"));
    await confirma.getByRole("button", { name: "Confirmar" }).click();
    await page.getByText(/queda cerrada|disposici[oó]n final registrada|Disposición registrada/i).first().waitFor();
    const r = (await api("GET", `/samples/reception/${E.recepcionId}`, undefined, t.qa)).data?.item;
    check("b) disposición final registrada: la muestra queda cerrada", r?.estado === "cerrada", r?.estado);
  });
}

/* ======================================================================
 * c) Segundo usuario: anulación y reactivación de una cuenta
 * ==================================================================== */
async function segundoUsuario() {
  const ID_ANU = `E2E-ANU-${stamp}`;
  const inspeccion = { checklist: Array.from({ length: 7 }, (_, i) => ({ requisito: `Requisito ${i + 1}`, estado: i === 6 ? "NA" : "C", observacion: null })), observaciones_generales: null };
  const rAnu = await api("POST", "/samples/reception", { fecha_recepcion: hoy(), hora_recepcion: "11:00", recibido_por: NOMBRE.mariana, medio_recepcion: "directa", solicitante: `Cliente duplicado E2E ${stamp}`, muestra_unica: true, id_interno: ID_ANU, fecha_muestra: hoy(), analisis: { tipos: ["acido_domoico"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] }, inspeccion, decision_aceptacion: "aceptada", aceptacion: { fecha: hoy(), responsable: NOMBRE.mariana }, datos_solicitante: { nombre_entrega: "Cliente" }, datos_custodio: { nombre_cargo_firma: NOMBRE.mariana, lugar_resguardo: "congelador" } }, t.mariana);
  const RA = rAnu.data?.id;
  check("c) datos de apoyo: recepción aceptada (registrada por el Técnico Auxiliar)", rAnu.status === 201, `${rAnu.status} ${rAnu.data?.message}`);
  if (RA) {
    await paso("ricardo", "c) anulación solicitada", async (page) => {
      await page.goto(`${BASE}/muestras/recepcion`);
      await page.getByPlaceholder("Buscar por folio, solicitante o ID interno").fill(ID_ANU);
      const renglon = filaLista(page, ID_ANU);
      await renglon.waitFor();
      await renglon.getByRole("button", { name: "Acciones" }).click();
      await page.getByRole("menuitem", { name: /Anular recepción/ }).click();
      await dialogoMotivo(page, "Registro duplicado: la muestra ya se recibió con otro folio", "Anular", "ricardo");
      await page.locator("[data-solicitud-pendiente]").first().waitFor();
      const item = (await api("GET", `/samples/reception/${RA}`, undefined, t.qa)).data?.item;
      E.solicitudAnulacion = item?.solicitud_pendiente?.id;
      check("c) anular una recepción aceptada queda pendiente (no se ejecuta)", item?.estado === "aceptada" && !!E.solicitudAnulacion, `${item?.estado} ${E.solicitudAnulacion}`);
      const propia = await api("POST", `/solicitudes/${E.solicitudAnulacion}/aprobar`, { motivo: "Me la apruebo yo" }, t.ricardo, SIN_APROBAR);
      check("h) segregación: quien pidió la anulación no la aprueba", propia.status >= 400 && propia.status < 500, `${propia.status} ${propia.data?.message}`);
    });
    await paso("patricia", "c) anulación aprobada en «Por autorizar»", async (page) => {
      await page.goto(`${BASE}/`);
      await page.getByText("Por autorizar").first().waitFor();
      await aprobarPorAutorizar(page, "patricia", (s) => Number(s.id) === Number(E.solicitudAnulacion), "Confirmado: es un duplicado");
      const item = (await api("GET", `/samples/reception/${RA}`, undefined, t.qa)).data?.item;
      check("c) la Responsable General la aprueba en «Por autorizar»: la recepción queda anulada", item?.estado === "anulada", item?.estado);
    });
  }

  // Reactivación de una cuenta (la pide el Administrador técnico; la aprueba otra persona).
  const correo = `e2e.${stamp.toLowerCase()}@cicese.mx`;
  const roles = (await api("GET", "/admin/roles", undefined, t.jorge)).data?.items || [];
  const rolTec = roles.find((r) => r.nombre === "Técnico Auxiliar")?.id;
  const alta = await api("POST", "/admin/usuarios", { nombre: `Persona E2E ${stamp}`, email: correo, activo: true, rol_id: rolTec, password: "Cuenta-E2E-2026!", motivo: "Alta para el recorrido E2E" }, t.jorge);
  const UID = alta.data?.id ?? alta.data?.resultado?.id;
  const baja = UID ? await api("DELETE", `/admin/usuarios/${UID}`, { motivo: "Terminó su estancia" }, t.jorge) : { status: 0 };
  const sinEntrar = await api("POST", "/auth/login", { email: correo, password: "Cuenta-E2E-2026!" });
  check("c) datos de apoyo: cuenta dada de baja (no puede entrar)", !!UID && baja.status === 200 && sinEntrar.status >= 400, `${alta.status} ${UID} ${baja.status} ${sinEntrar.status}`);
  if (!UID) return;
  await paso("jorge", "c) reactivación solicitada", async (page) => {
    await page.goto(`${BASE}/administracion/usuarios`);
    await page.getByPlaceholder("Buscar por nombre o correo").fill(correo);
    const renglon = page.locator(`[data-usuario="${UID}"]`);
    await renglon.waitFor();
    await renglon.getByRole("button", { name: "Acciones" }).click();
    await page.getByRole("menuitem", { name: /Reactivar/ }).click();
    await dialogoMotivo(page, "Regresa al laboratorio para una segunda estancia", "Pedir reactivación", "jorge");
    await toast(page, /pendiente/i);
    const u = (await api("GET", `/admin/usuarios/${UID}`, undefined, t.jorge)).data?.item;
    check("c) la reactivación queda pendiente de un segundo usuario (la cuenta sigue inactiva)", !Number(u?.activo), `${u?.activo}`);
  });
  await paso("patricia", "c) reactivación aprobada", async (page) => {
    await aprobarPorAutorizar(page, "patricia", (s) => s.tipo === "reactivar_cuenta" && String(s.entidad_id) === String(UID), "Confirmado con la coordinación");
    const u = (await api("GET", `/admin/usuarios/${UID}`, undefined, t.jorge)).data?.item;
    const entra = await api("POST", "/auth/login", { email: correo, password: "Cuenta-E2E-2026!" });
    check("c) aprobada por la Responsable General: la cuenta vuelve a estar activa y puede entrar", !!Number(u?.activo) && entra.status === 200, `${u?.activo} ${entra.status}`);
  });
  E.usuarioReactivado = UID;
}

/* ======================================================================
 * d) Calidad: incidencia → NC → acción → verificación → cierre; retención
 * ==================================================================== */
async function calidad() {
  const DESC = `La balanza analítica marcó deriva durante la pesada (E2E ${stamp})`;
  await paso("luis", "d) incidencia reportada", async (page) => {
    const boton = page.locator("[data-reportar-incidencia-boton]");
    await boton.waitFor();
    await boton.click();
    const hoja = page.locator("[data-reportar-incidencia]");
    await hoja.waitFor();
    await page.locator("#inc-tipo").selectOption("falla_equipo");
    await page.locator("#inc-desc").fill(DESC);
    await page.locator("[data-enviar-incidencia]").click();
    await hoja.waitFor({ state: "detached" });
    E.incidenciaId = ((await api("GET", `/calidad/incidencias?search=${encodeURIComponent(`E2E ${stamp}`)}`, undefined, t.luis)).data?.items || [])[0]?.id;
    check("d) el analista reporta la incidencia desde la barra lateral", !!E.incidenciaId, `${E.incidenciaId}`);
    const propia = await api("POST", `/calidad/incidencias/${E.incidenciaId}/evaluacion`, {}, t.luis);
    check("h) quien reporta no evalúa su incidencia (403)", propia.status === 403, `${propia.status}`);
  });
  if (!E.incidenciaId) return;
  await paso("ricardo", "d) evaluación y escalamiento a NC", async (page) => {
    await page.goto(`${BASE}/calidad/incidencias/${E.incidenciaId}`);
    await page.locator("[data-evaluar]").click();
    await page.locator("#eval-just").fill("La deriva pudo afectar las pesadas de la extracción");
    await page.locator("#eval-clasif").selectOption("mayor");
    await page.locator("[data-guardar-evaluacion]").click();
    await page.waitForURL(/\/calidad\/nc\/\d+/);
    E.ncId = Number(new URL(page.url()).pathname.split("/").pop());
    await page.locator('[data-etapa="abierta"]').waitFor();
    check("d) evaluada y escalada: se abre la NC (etapa Abierta)", !!E.ncId, `${E.ncId}`);
  });
  if (!E.ncId) return;
  await paso("ana", "d) NC: responsable, impacto y análisis", async (page) => {
    await page.goto(`${BASE}/calidad/nc/${E.ncId}`);
    await mostrarTodo(page);
    await page.locator("#nc-responsable").selectOption(String(id.ricardo));
    await page.locator("#nc-afecta_resultados_emitidos").selectOption("si");
    await page.locator("#nc-trabajo_detenido").selectOption("no");
    await page.locator("#nc-notificar_cliente").selectOption("no");
    await page.locator("[data-guardar-nc]").first().click();
    const avanzar = page.locator("[data-avanzar-nc]").first();
    await avanzar.waitFor();
    await avanzar.click();
    await page.locator('[data-etapa="en_analisis"]').waitFor();
    const nc = (await api("GET", `/calidad/nc/${E.ncId}`, undefined, t.ana)).data?.item;
    check("d) Mejora Continua nombra responsable, evalúa el impacto y pasa a análisis", nc?.responsable_id === id.ricardo && nc?.estado === "en_analisis", `${nc?.responsable_id} ${nc?.estado}`);
  });

  // Retención de un informe liberado (afectado por la NC).
  let INF = null;
  await bloque("d) retención de informe", async () => {
    const inf = await informeLiberado(t, `E2ERET${stamp}`);
    INF = inf.informe;
    const ret = await api("POST", `/calidad/nc/${E.ncId}/retenciones`, { informe_id: INF, motivo: "Resultados en duda por la deriva de la balanza" }, t.ana);
    check("d) Mejora Continua retiene un informe liberado ligado a la NC", inf.liberado && ret.status === 201, `liberado=${inf.liberado} R=${inf.R} A=${inf.A} inf=${inf.informe} ${ret.status} ${ret.data?.message}`);
    const envio = await registrarEnvio(`${BASE}/api`, t.patricia, INF);
    check("d) un informe retenido no se envía (409 informe_retenido)", envio.status === 409 && envio.data?.codigo === "informe_retenido", `${envio.status} ${envio.data?.codigo}`);
  });
  if (INF) {
    await paso("patricia", "d) aviso de retención en el informe", async (page) => {
      await page.goto(`${BASE}/informes/${INF}`);
      await page.locator("[data-aviso-retencion]").waitFor();
      check("d) el informe retenido muestra el aviso con la NC", /Retenido por NC \d{7}/.test(await page.locator("[data-aviso-retencion]").innerText()));
    });
  }

  await bloque("d) acción, verificación y cierre", async () => {
    const causa = await api("PUT", `/calidad/nc/${E.ncId}`, { metodo_causa: "cinco_porques", desarrollo_causa: "¿Por qué hubo deriva? Corriente de aire. ¿Por qué? La puerta de la cámara se dejó abierta.", causa_raiz: "Falta de un instructivo de uso de la cámara de pesado", requiere_accion_correctiva: "si" }, t.ricardo);
    const acc = await api("POST", `/calidad/nc/${E.ncId}/acciones`, { descripcion: "Colocar aviso y capacitar en el uso de la cámara de pesado", responsable_id: id.luis, fecha_compromiso: enDias(5) }, t.ricardo);
    const enCurso = await api("POST", `/calidad/nc/${E.ncId}/avanzar`, { a: "acciones_en_curso" }, t.ricardo);
    check("d) el responsable registra la causa y una acción (a cargo del analista) y pasa a acciones en curso", causa.status === 200 && acc.status === 201 && enCurso.status === 200, `${causa.status} ${acc.status} ${enCurso.status} ${enCurso.data?.message || ""}`);
    const ini = await api("POST", `/calidad/acciones/${acc.data?.id}/iniciar`, {}, t.luis);
    const imp = await api("POST", `/calidad/acciones/${acc.data?.id}/implementar`, { descripcion_implementacion: "Se colocó el aviso y se capacitó al personal" }, t.luis);
    const aVer = await api("POST", `/calidad/nc/${E.ncId}/avanzar`, { a: "en_verificacion" }, t.ricardo);
    check("d) el analista implementa su acción y la NC pasa a verificación", ini.status === 200 && imp.status === 200 && aVer.status === 200, `${ini.status} ${imp.status} ${aVer.status} ${aVer.data?.message || ""}`);
    const ricVer = await api("POST", `/calidad/nc/${E.ncId}/verificar`, { resultado: "eficaz", comentarios: "Yo mismo lo verifico" }, t.luis);
    const ver = await api("POST", `/calidad/nc/${E.ncId}/verificar`, { resultado: "eficaz", comentarios: "Dos semanas sin deriva; registros revisados" }, t.ana);
    check("d) verificación de eficacia por Mejora Continua (el analista, sin permiso de verificar, → 403)", ricVer.status === 403 && ver.status === 200, `${ricVer.status} ${ver.status} ${ver.data?.message || ""}`);
    const rets = filas("SELECT id FROM retenciones_informe WHERE nc_id = ? AND liberada_en IS NULL", E.ncId);
    for (const r of rets) await api("POST", `/calidad/retenciones/${r.id}/liberar`, { motivo: "Resultados confirmados con una nueva pesada" }, t.patricia);
    if (INF) {
      const envio = await registrarEnvio(`${BASE}/api`, t.patricia, INF);
      check("d) liberada la retención, el informe ya se envía", envio.status === 200, `${envio.status} ${envio.data?.message}`);
    }
    const ricCierra = await api("POST", `/calidad/nc/${E.ncId}/cerrar`, { conclusion: "Acciones eficaces" }, t.ricardo);
    const sinReauth = await api("POST", `/calidad/nc/${E.ncId}/cerrar`, { conclusion: "Acciones eficaces" }, t.patricia, SIN_REAUTH);
    const cierra = await api("POST", `/calidad/nc/${E.ncId}/cerrar`, { conclusion: "La acción fue eficaz; se emitió el instructivo de la cámara de pesado" }, t.patricia);
    check("h) cerrar la NC sin permiso (Coord. Técnica) → 403 y sin contraseña → 401", ricCierra.status === 403 && sinReauth.status === 401, `${ricCierra.status} ${sinReauth.status}`);
    check("d) la Responsable General cierra la NC (con contraseña)", cierra.status === 200, `${cierra.status} ${cierra.data?.message} ${cierra.data?.codigo || ""}`);
  });
  await paso("ana", "d) NC cerrada en pantalla", async (page) => {
    await page.goto(`${BASE}/calidad/nc/${E.ncId}`);
    await page.locator('[data-etapa="cerrada"]').waitFor();
    check("d) la ficha de la NC muestra la etapa Cerrada", true);
  });
}

/* ======================================================================
 * e) Documentos SGC
 * ==================================================================== */
async function documentos() {
  const TITULO = `Procedimiento de pesado en cámara E2E ${stamp}`;
  const CLAVE = `FX-TCP-E${stamp}`;
  const docDe = async () => (await api("GET", `/sgc/documentos/${E.docId}`, undefined, t.ana)).data;
  const enCurso = async () => ((await docDe())?.revisiones || []).find((r) => !["vigente", "obsoleta", "cancelada"].includes(r.estado));

  await paso("mariana", "e) solicitud de documento nuevo", async (page) => {
    await page.goto(`${BASE}/documentos`);
    await page.getByTestId("sgc-nueva-solicitud").click();
    await page.locator("#sol-justificacion").waitFor();
    await page.locator("select#sol-area").selectOption("TC");
    await page.locator("select#sol-tipo").selectOption("P");
    await page.locator("#sol-titulo").fill(TITULO);
    await page.getByTestId("solicitud-guardar").click();
    await page.getByText(/justificación/i).first().waitFor();
    check("e) solicitud sin justificación: se marca antes de enviar", (await page.locator('[data-validacion="faltan"]').count()) > 0);
    await entendido(page);
    await page.locator("#sol-justificacion").fill("Se necesita un procedimiento para el uso de la cámara de pesado (NC de la balanza)");
    await page.getByTestId("solicitud-guardar").click();
    await toast(page, /Solicitud/i);
    const sol = ((await api("GET", "/sgc/solicitudes", undefined, t.ana)).data?.items || []).find((s) => s.titulo_propuesto === TITULO);
    E.solicitudDoc = sol?.id;
    check("e) el Técnico Auxiliar propone un documento nuevo (solicitud pendiente)", sol?.estado === "pendiente", `${sol?.id} ${sol?.estado}`);
  });
  if (!E.solicitudDoc) return;

  await bloque("h) aceptar con la misma persona como elaborador y revisor (API)", async () => {
    const r = await api("POST", `/sgc/solicitudes/${E.solicitudDoc}/aceptar`, { clave: CLAVE, titulo: TITULO, area_codigo: "TC", tipo_codigo: "P", elaborador_id: id.gabriela, revisor_id: id.gabriela, autorizador_id: id.patricia }, t.ana);
    check("h) segregación documental: quien elabora no revisa (la API lo rechaza)", r.status >= 400 && r.status < 500, `${r.status} ${r.data?.message}`);
  });
  await paso("ana", "e) Mejora Continua acepta y asigna", async (page) => {
    await page.goto(`${BASE}/documentos/solicitudes`);
    const tarjeta = page.getByTestId("sgc-solicitud").filter({ hasText: TITULO }).first();
    await tarjeta.waitFor();
    await tarjeta.getByTestId("sgc-solicitud-aceptar").click();
    await page.locator("#acep-clave").fill(CLAVE);
    // Quien puede elaborar y revisar (Coord. de Investigación) en los dos papeles: se marca antes de enviar.
    await page.locator("#acep-elaborador").selectOption(String(id.gabriela));
    await page.locator("#acep-revisor").selectOption(String(id.gabriela));
    await page.locator("#acep-autorizador").selectOption(String(id.patricia));
    await page.getByTestId("aceptar-guardar").click();
    await page.getByText("tres personas distintas").first().waitFor();
    check("h) segregación documental en pantalla: elaborador y revisor iguales se marcan antes de enviar", true);
    await entendido(page);
    await page.locator("#acep-elaborador").selectOption(String(id.luis));
    await page.getByTestId("aceptar-guardar").click();
    await page.waitForURL(/\/documentos\/\d+$/);
    E.docId = Number(new URL(page.url()).pathname.split("/").pop());
    await page.getByTestId("sgc-ficha").waitFor();
    check("e) aceptada: se crea la ficha con la clave y la revisión 1 en borrador", (await page.getByTestId("sgc-clave").innerText()).trim() === CLAVE && (await enCurso())?.estado === "borrador", `${E.docId}`);
  });
  if (!E.docId) return;

  await paso("luis", "e) el elaborador carga el archivo y envía a revisión", async (page) => {
    await page.goto(`${BASE}/documentos/${E.docId}`);
    await (await accion(page, "sgc-subir-archivo")).click();
    await page.locator('input[aria-label="Elegir archivo"]').setInputFiles({ name: "procedimiento-rev1.pdf", mimeType: "application/pdf", buffer: await pdfConTexto(2, TITULO) });
    await page.getByTestId("archivo-guardar").click();
    await toast(page, /Archivo|cargad/i);
    await (await accion(page, "sgc-editar-revision")).click();
    const motivo = page.locator("#rev-motivo");
    await motivo.waitFor();
    if ((await motivo.inputValue()).trim().length < 15) await motivo.fill("Emisión inicial del procedimiento de pesado");
    // Apartados y descripción viven en «Más opciones» (plegado).
    if (!(await page.locator("#rev-apartados").isVisible())) await page.getByRole("dialog").getByRole("button", { name: /Más opciones/ }).click();
    await page.locator("#rev-apartados").fill("Todo el documento");
    await page.locator("#rev-descripcion").fill("Emisión inicial");
    await page.getByTestId("revision-guardar").click();
    await toast(page, /guardad|Revisión/i);
    await (await accion(page, "sgc-enviar-revision")).click();
    await page.getByRole("button", { name: "Enviar a revisión", exact: true }).last().click();
    await page.locator('[data-principal="1"][data-testid="sgc-enviar-revision"]').waitFor({ state: "detached" });
    await page.getByText("Archivos bloqueados", { exact: false }).first().waitFor();
    const deshabilitada = await (await accion(page, "sgc-subir-archivo")).isDisabled();
    const porque = await motivoAccion(page, "sgc-subir-archivo");
    await cerrarMenu(page);
    check("e) elaborado y enviado a revisión: el archivo queda bloqueado (botón deshabilitado con motivo)", deshabilitada && porque.length > 0 && (await enCurso())?.estado === "en_revision", porque);
  });

  await paso("gabriela", "e) el revisor devuelve", async (page) => {
    await page.goto(`${BASE}/documentos/bandeja`);
    const tarea = page.getByTestId("bandeja-tarea").filter({ hasText: CLAVE }).first();
    await tarea.waitFor();
    await tarea.getByRole("button", { name: "Revisar" }).click();
    await page.waitForURL((url) => url.pathname === `/documentos/${E.docId}`);
    await page.getByTestId("decision-guardar").waitFor();
    await page.getByText("Devolver", { exact: true }).first().click();
    await page.getByTestId("decision-guardar").click();
    await page.getByText("Escribe el comentario").first().waitFor();
    await entendido(page);
    await page.locator("#decision-comentario").fill("Agrega la tabla de tolerancias de la balanza");
    await page.getByTestId("decision-guardar").click();
    await page.getByTestId("sgc-revisar").waitFor({ state: "detached" });
    check("e) el revisor devuelve con comentario (sin comentario se marca): vuelve a borrador", (await enCurso())?.estado === "borrador", (await enCurso())?.estado);
  });
  await bloque("e) el elaborador corrige y reenvía", async () => {
    const rev = await enCurso();
    const fd = new FormData();
    fd.append("tipo", "pdf");
    fd.append("archivo", new Blob([await pdfConTexto(3, `${TITULO} (con tabla)`)]), "procedimiento-rev1b.pdf");
    const sub = await api("POST", `/sgc/revisiones/${rev.id}/archivos`, fd, t.luis);
    const env = await api("POST", `/sgc/revisiones/${rev.id}/enviar-revision`, {}, t.luis);
    check("e) el elaborador sustituye el PDF y reenvía", [200, 201].includes(sub.status) && env.status === 200, `${sub.status} ${env.status} ${env.data?.message}`);
  });
  await paso("luis", "h) el elaborador no revisa", async (page) => {
    await page.goto(`${BASE}/documentos/${E.docId}`);
    check("h) el elaborador no tiene «Revisar» ni «Autorizar» en su documento", (await contarAccion(page, "sgc-revisar")) === 0 && (await contarAccion(page, "sgc-autorizar")) === 0);
    const rev = await enCurso();
    const r = await api("POST", `/sgc/revisiones/${rev.id}/revisar`, { decision: "aceptar", comentario: "Me reviso yo" }, t.luis);
    check("h) el elaborador por la API no puede revisar (rechazado)", r.status >= 400 && r.status < 500, `${r.status} ${r.data?.message}`);
  });
  await paso("gabriela", "e) el revisor acepta", async (page) => {
    await page.goto(`${BASE}/documentos/${E.docId}`);
    await (await accion(page, "sgc-revisar")).click();
    await page.getByTestId("decision-guardar").click();
    await page.getByTestId("sgc-revisar").waitFor({ state: "detached" });
    check("e) revisado: pasa a autorización", (await enCurso())?.estado === "en_autorizacion", (await enCurso())?.estado);
  });
  await paso("patricia", "e) el autorizador autoriza", async (page) => {
    await page.goto(`${BASE}/documentos/${E.docId}`);
    await (await accion(page, "sgc-autorizar")).click();
    await page.getByTestId("decision-guardar").click();
    await contrasena(page, "patricia", "incorrecta-000");
    await page.getByText(/contraseña no es correcta/i).first().waitFor();
    check("h) autorizar el documento con contraseña incorrecta: no se autoriza", (await enCurso())?.estado === "en_autorizacion", (await enCurso())?.estado);
    await contrasena(page, "patricia");
    await page.getByTestId("sgc-autorizar").waitFor({ state: "detached" });
    check("e) autorizado con la contraseña del autorizador", (await enCurso())?.estado === "autorizada", (await enCurso())?.estado);
  });
  await paso("ana", "e) publicar con distribución", async (page) => {
    await page.goto(`${BASE}/documentos/${E.docId}`);
    await (await accion(page, "sgc-publicar")).click();
    const dist = page.getByTestId("pub-distribucion");
    await dist.waitFor();
    await dist.getByRole("switch", { name: /Definir la distribución/ }).click();
    await page.getByRole("dialog").getByLabel(NOMBRE.luis, { exact: true }).check();
    await page.getByTestId("publicar-guardar").click();
    await contrasena(page, "ana");
    await page.getByTestId("sgc-vigente").waitFor();
    await page.getByTestId("sgc-en-curso").waitFor({ state: "detached" });
    const d = await docDe();
    const vig = (d?.revisiones || []).find((r) => r.estado === "vigente");
    E.rev1 = vig?.id;
    check("e) publicada: la revisión 1 queda vigente", d?.item?.estado === "vigente" && vig?.numero === 1, `${d?.item?.estado} ${vig?.numero}`);
    await pestana(page, "Lecturas");
    await page.getByTestId("sgc-distribucion").waitFor();
    check("e) distribución definida al publicar: el destinatario con lectura pendiente (0 %)", (await page.getByTestId("dist-persona-estado").count()) >= 1 && (await page.getByTestId("dist-avance").getAttribute("data-porcentaje")) === "0");
  });
  await paso("luis", "e) lectura confirmada", async (page) => {
    await page.goto(`${BASE}/documentos/bandeja`);
    const lectura = page.getByTestId("bandeja-lectura").filter({ hasText: CLAVE });
    await lectura.waitFor();
    await lectura.getByRole("button", { name: "Leer" }).click();
    await page.waitForURL(/leer=1/);
    await page.locator('[data-testid="sgc-visor"] canvas').first().waitFor({ timeout: 60_000 });
    await page.getByTestId("acuse-confirmar").click();
    await page.getByRole("button", { name: "Confirmo", exact: true }).click();
    await page.getByTestId("acuse-hecho").waitFor();
    const leido = fila("SELECT leido_en FROM sgc_lecturas WHERE revision_id = ? AND usuario_id = ?", E.rev1, id.luis);
    check("e) el destinatario abre el PDF y confirma «leí y comprendí»", !!leido?.leido_en, JSON.stringify(leido));
  });

  await paso("ana", "e) nueva revisión", async (page) => {
    await page.goto(`${BASE}/documentos/${E.docId}`);
    await (await accion(page, "sgc-nueva-revision")).click();
    await page.locator("#rev-motivo").fill("Actualizar las tolerancias tras la calibración anual");
    await page.locator("#rev-elaborador").selectOption(String(id.luis));
    await page.locator("#rev-revisor").selectOption(String(id.gabriela));
    await page.locator("#rev-autorizador").selectOption(String(id.patricia));
    await page.getByTestId("revision-guardar").click();
    await page.getByTestId("sgc-en-curso").waitFor();
    check("e) nueva revisión abierta: la vigente sigue disponible mientras tanto", (await page.getByTestId("sgc-visor").count()) === 1 && (await enCurso())?.numero === 2);
  });
  await bloque("e) revisión 2: elaborar, revisar y autorizar", async () => {
    const rev = await enCurso();
    const fd = new FormData();
    fd.append("tipo", "pdf");
    fd.append("archivo", new Blob([await pdfConTexto(2, `${TITULO} rev. 2`)]), "procedimiento-rev2.pdf");
    const a = await api("POST", `/sgc/revisiones/${rev.id}/archivos`, fd, t.luis);
    const b = await api("PUT", `/sgc/revisiones/${rev.id}`, { apartados_afectados: "Tabla 1", descripcion_cambio: "Tolerancias actualizadas" }, t.luis);
    const c = await api("POST", `/sgc/revisiones/${rev.id}/enviar-revision`, {}, t.luis);
    const d = await api("POST", `/sgc/revisiones/${rev.id}/revisar`, { decision: "aceptar", comentario: "Correcto" }, t.gabriela);
    const f = await api("POST", `/sgc/revisiones/${rev.id}/autorizar`, { decision: "autorizar" }, t.patricia);
    E.rev2 = rev.id;
    check("e) revisión 2 elaborada, revisada y autorizada (cada paso por su responsable)", [a, b, c, d, f].every((x) => [200, 201].includes(x.status)), [a, b, c, d, f].map((x) => x.status).join(" "));
  });
  await paso("ana", "e) publicar la revisión 2", async (page) => {
    await page.goto(`${BASE}/documentos/${E.docId}`);
    await (await accion(page, "sgc-publicar")).click();
    await page.getByRole("dialog").getByRole("button", { name: /Más opciones/ }).click();
    // Próxima revisión cercana: el documento queda «pendiente de revisión» para probar la renovación.
    await page.locator("#pub-proxima").fill(fechaEs(enDias(10)));
    await page.locator("#pub-proxima").blur();
    await page.getByTestId("publicar-guardar").click();
    await contrasena(page, "ana");
    await page.getByTestId("sgc-en-curso").waitFor({ state: "detached" });
    await pestana(page, "Revisiones");
    await page.getByTestId("sgc-historial").locator("summary").first().click();
    await page.getByTestId("sgc-historial-fila").first().waitFor();
    const estados = await page.getByTestId("sgc-historial-fila").evaluateAll((xs) => xs.map((f) => `${f.getAttribute("data-numero")}:${f.getAttribute("data-estado")}`));
    check("e) publicada la revisión 2: la nueva vigente y la anterior obsoleta", estados.includes("2:vigente") && estados.includes("1:obsoleta"), estados.join(" "));
  });
  await paso("ana", "e) renovar sin cambios", async (page) => {
    await page.goto(`${BASE}/documentos/${E.docId}`);
    await page.getByTestId("sgc-aviso-pendiente").waitFor();
    await (await accion(page, "sgc-renovar")).click();
    await page.locator("#ren-revisor").selectOption(String(id.gabriela));
    await page.locator("#ren-autorizador").selectOption(String(id.patricia));
    await page.getByTestId("renovar-guardar").click();
    await page.getByTestId("sgc-renovacion").waitFor();
    check("e) pendiente de revisión: Mejora Continua inicia la renovación", true);
  });
  await paso("gabriela", "e) el revisor confirma la vigencia", async (page) => {
    await page.goto(`${BASE}/documentos/${E.docId}`);
    await (await accion(page, "sgc-renovacion-revisar")).click();
    await page.locator("#decision-comentario").fill("Sigue vigente sin cambios");
    await page.getByTestId("decision-guardar").click();
    await page.getByTestId("sgc-renovacion-revisar").waitFor({ state: "detached" });
    check("e) renovación: el revisor confirma la vigencia", true);
  });
  await paso("patricia", "e) el autorizador autoriza la renovación", async (page) => {
    await page.goto(`${BASE}/documentos/${E.docId}`);
    await (await accion(page, "sgc-renovacion-autorizar")).click();
    await page.getByTestId("decision-guardar").click();
    // Autorizar la renovación siempre pide la contraseña (documentos:autorizar).
    await contrasena(page, "patricia");
    await page.getByTestId("sgc-renovacion-autorizar").waitFor({ state: "detached" });
    const vig = ((await docDe())?.revisiones || []).find((r) => r.estado === "vigente");
    check("e) renovación autorizada: la próxima revisión se recorre (deja de estar pendiente)", String(vig?.fecha_proxima_revision || "") > enDias(40), String(vig?.fecha_proxima_revision));
  });
  await paso("ana", "e) obsolescencia solicitada", async (page) => {
    await page.goto(`${BASE}/documentos/${E.docId}`);
    await (await accion(page, "sgc-obsoletar")).click();
    await page.locator("#obs-motivo").fill("El procedimiento se integra al manual de equipos");
    await page.getByTestId("obsoletar-guardar").click();
    await contrasena(page, "ana");
    await page.getByText("Obsolescencia solicitada").first().waitFor();
    check("e) obsolescencia solicitada con motivo y contraseña (queda pendiente)", (await docDe())?.item?.estado === "vigente");
  });
  await paso("patricia", "e) obsolescencia aprobada", async (page) => {
    await aprobarPorAutorizar(page, "patricia", (s) => s.tipo === "obsoletar_documento_sgc" && String(s.entidad_id) === String(E.docId), "Confirmado: se integra al manual");
    await page.goto(`${BASE}/documentos/${E.docId}`);
    await page.getByTestId("sgc-aviso-obsoleto").waitFor();
    check("e) aprobada por un segundo usuario: el documento queda obsoleto", (await docDe())?.item?.estado === "obsoleto", (await docDe())?.item?.estado);
  });

  const IDENT = `NOM-E2E-${stamp}`;
  await paso("ana", "e) documento externo", async (page) => {
    await page.goto(`${BASE}/documentos/externos`);
    await page.getByTestId("ext-registrar").click();
    await page.locator("#ext-id").fill(IDENT);
    await page.locator("#ext-fuente").fill("Secretaría de Salud");
    await page.locator("#ext-titulo").fill(`Norma de biotoxinas marinas E2E ${stamp}`);
    await page.locator("#ext-area").selectOption("TC");
    await page.locator("#ext-tipo").selectOption("R");
    await page.locator("#ext-version").fill("2024");
    await page.getByRole("dialog").getByRole("button", { name: "Más opciones" }).click();
    await page.locator("#ext-enlace").fill("https://www.dof.gob.mx");
    await page.locator("#ext-responsable").selectOption(String(id.ricardo));
    await page.getByTestId("ext-guardar").click();
    await contrasena(page, "ana");
    await page.waitForURL(/\/documentos\/\d+$/);
    await page.getByTestId("sgc-externo").waitFor();
    check("e) externo registrado: ficha «Externo» con su seguimiento", (await page.getByTestId("sgc-clave").innerText()).trim() === IDENT && (await page.getByTestId("etiqueta-externo").count()) > 0);
  });
  await paso("ana", "e) Lista Maestra en PDF", async (page, { descargas, context }) => {
    let pestanas = 0;
    context.on("page", () => (pestanas += 1));
    await page.goto(`${BASE}/documentos/lista-maestra`);
    await page.getByTestId("lm-tabla").waitFor();
    await page.getByTestId("lm-fila").filter({ hasText: IDENT }).first().waitFor();
    await page.getByTestId("lm-pdf").click();
    await page.locator("[data-visor-pdf-flotante] canvas").first().waitFor({ timeout: 60_000 });
    check("e) Lista Maestra en PDF en el visor interno, sin descarga ni pestaña nueva", descargas.length === 0 && pestanas === 0 && /Lista Maestra/.test((await page.locator("[data-visor-pdf-flotante]").getAttribute("aria-label")) || ""), `descargas=${descargas.length} pestañas=${pestanas}`);
    await page.keyboard.press("Escape");
  });
  await paso("carmen", "h) Lista Maestra sin permiso de exportar", async (page) => {
    await page.goto(`${BASE}/documentos/lista-maestra`);
    await page.getByTestId("lm-tabla").waitFor();
    const pdf = await api("GET", "/sgc/lista-maestra/pdf", undefined, t.carmen);
    check("h) Administradora Auxiliar: sin «Ver PDF» y la API del PDF → 403", (await page.getByTestId("lm-pdf").count()) === 0 && pdf.status === 403, `${pdf.status}`);
  });
}

/* ======================================================================
 * f) Respaldos
 * ==================================================================== */
async function respaldos() {
  const NOTA = `E2E ${stamp}`;
  await paso("jorge", "f) respaldo y prueba de restauración", async (page) => {
    await page.goto(`${BASE}/calidad/respaldos`);
    const cuantos = async () => ((await api("GET", "/respaldos", undefined, t.jorge)).data?.respaldos || []).length;
    const antes = await cuantos();
    await page.locator("[data-crear-respaldo]").click();
    await page.locator("#respaldo-etiqueta").fill(NOTA);
    await page.getByRole("dialog").getByRole("button", { name: "Crear respaldo", exact: true }).click();
    await page.locator('[data-validacion="faltan"]').waitFor();
    // Sin contraseña: la pantalla la pide, la API responde 401 y no aparece ningún respaldo nuevo.
    const sinPwd = await api("POST", "/respaldos", { etiqueta: `${NOTA} sin contraseña` }, t.jorge, { "X-Sin-Reauth-Auto": "1" });
    check("h) crear respaldo sin contraseña: la pantalla la pide, la API → 401 y no se crea", sinPwd.status === 401 && (await cuantos()) === antes, `${sinPwd.status} ${sinPwd.data?.codigo} · ${antes} → ${await cuantos()}`);
    await entendido(page);
    await page.locator("#respaldo-password").fill(pwd("jorge"));
    await page.getByRole("dialog").getByRole("button", { name: "Crear respaldo", exact: true }).click();
    const renglon = page.locator("[data-respaldo]").filter({ hasText: NOTA }).first();
    await renglon.waitFor({ timeout: 240_000 });
    const resp = ((await api("GET", "/respaldos", undefined, t.jorge)).data?.respaldos || []).find((r) => r.nota === NOTA);
    E.respaldoId = resp?.id;
    check("f) respaldo creado (Administrador técnico, con contraseña)", !!resp && resp.estado === "ok", `${resp?.id} ${resp?.estado}`);
    await renglon.getByRole("button", { name: "Acciones" }).click();
    await page.getByRole("menuitem", { name: /Probar restauración/ }).click();
    await page.locator("#respaldo-password").fill(pwd("jorge"));
    await page.getByRole("dialog").getByRole("button", { name: "Probar restauración", exact: true }).click();
    await page.getByText("La prueba salió bien").first().waitFor({ timeout: 240_000 });
    await page.getByRole("button", { name: "Ver el resultado" }).click();
    const acta = page.locator("[data-acta]");
    await acta.waitFor();
    await acta.locator("[data-verificacion]").first().waitFor();
    const okN = await acta.locator('[data-verificacion="ok"]').count();
    const malN = await acta.locator('[data-verificacion="mal"]').count();
    const ver = ((await api("GET", "/respaldos", undefined, t.jorge)).data?.respaldos || []).find((r) => r.id === E.respaldoId)?.verificacion;
    check("f) prueba de restauración: 8/8 verificaciones correctas y el respaldo queda «aprobado»", okN === 8 && malN === 0 && ver?.resultado === "aprobada", `${okN} ok, ${malN} mal, ${ver?.resultado}`);
  });
  await paso("ana", "h) Mejora Continua: respaldos solo lectura", async (page) => {
    await page.goto(`${BASE}/calidad/respaldos`);
    await page.locator("[data-estado-respaldos]").waitFor();
    const r = await api("POST", "/respaldos", { etiqueta: "Intento sin permiso" }, t.ana);
    check("h) quien solo consulta respaldos: sin «Crear respaldo ahora» y la API → 403", (await page.locator("[data-crear-respaldo]").count()) === 0 && r.status === 403, `${r.status}`);
  });
}

/* ======================================================================
 * g) Auditoría
 * ==================================================================== */
async function auditoria() {
  await bloque("g) bitácora", async () => {
    const v = await api("GET", "/audit/verify", undefined, t.hector);
    check("g) la bitácora sellada está íntegra (/api/audit/verify)", v.status === 200 && v.data?.ok === true, JSON.stringify(v.data).slice(0, 160));
    const esperado = [
      ["reactivos", E.reactivoId, ["crear", "reponer"]],
      ["muestras_recepcion", E.recepcionId, ["crear", "imprimir_etiquetas", "cerrar"]],
      ["muestras_analisis", E.analisisId, ["crear", "enviar_revision", "devolver", "editar", "revisar", "aprobar"]],
      ["informes", E.informeId, ["crear", "revisar", "autorizar", "liberar", "enviar"]],
      ["no_conformidades", E.ncId, ["avanzar", "retener", "verificar", "cerrar"]],
      // La obsolescencia aprobada queda como «anular» del documento (con detalle obsoletar) y «aprobar_solicitud».
      ["sgc_documentos", E.docId, ["solicitar", "enviar_revision", "devolver", "autorizar", "publicar", "confirmar_lectura", "nueva_revision", "aprobar_solicitud", "anular"]],
      ["usuarios", E.usuarioReactivado, ["baja", "reactivar"]],
      ["respaldos", E.respaldoId, ["respaldar", "probar_restauracion"]],
    ];
    for (const [entidad, eid, acciones] of esperado) {
      if (!eid) {
        check(`g) eventos de ${entidad} en la bitácora`, false, "el registro no se creó en el recorrido");
        continue;
      }
      const hay = await eventos(entidad, eid);
      const faltan = acciones.filter((a) => !hay.includes(a));
      check(`g) la bitácora tiene los eventos de ${entidad} #${eid} (${acciones.join(", ")})`, faltan.length === 0, faltan.length ? `faltan ${faltan.join(",")}; hay ${[...new Set(hay)].join(",")}` : "");
    }
  });
  if (E.folioR) {
    await paso("hector", "g) auditoría en pantalla", async (page) => {
      await page.goto(`${BASE}/auditoria?buscar=${encodeURIComponent(E.folioR)}&periodo=todo`);
      const act = page.locator("[data-actividad]");
      await act.first().waitFor();
      const textos = (await act.allInnerTexts()).join(" | ");
      check("g) el Auditor encuentra en Auditoría la actividad de la recepción del recorrido", (await act.count()) >= 2 && textos.includes(E.folioR), textos.slice(0, 160));
    });
  }
}

/* ======================================================================
 * h) Negativos por URL directa (pantalla y API)
 * ==================================================================== */
async function negativos() {
  await paso("mariana", "h) Técnico Auxiliar sin Informes", async (page) => {
    await page.goto(`${BASE}/informes`);
    await page.getByText("Sin acceso a esta sección").waitFor();
    const r = await api("GET", "/informes", undefined, t.mariana);
    check("h) Técnico Auxiliar: Informes por URL directa → «Sin acceso» y la API → 403", r.status === 403, `${r.status}`);
  });
  await paso("jorge", "h) Admin técnico sin Incidencias y NC", async (page) => {
    await page.goto(`${BASE}/calidad/incidencias`);
    await page.getByText("Sin acceso a esta sección").waitFor();
    const r = await api("GET", "/calidad/incidencias", undefined, t.jorge);
    check("h) Administrador técnico: Incidencias y NC → «Sin acceso» y la API → 403", r.status === 403, `${r.status}`);
  });
  await paso("diego", "h) Estudiante sin Respaldos", async (page) => {
    await page.goto(`${BASE}/calidad/respaldos`);
    await sinAcceso(page);
    const r = await api("GET", "/respaldos", undefined, t.diego);
    check("h) Estudiante: Respaldos → sin acceso y la API → 403", r.status === 403 && (await page.locator("[data-crear-respaldo]").count()) === 0, `${r.status}`);
  });
  if (E.informeId) {
    await paso("hector", "h) Auditor: informe sin acciones", async (page) => {
      await page.goto(`${BASE}/informes/${E.informeId}`);
      await page.locator("#i-cli").waitFor();
      const botones = await page.getByRole("button", { name: /^(Marcar revisado|Autorizar|Liberar|Registrar envío)$/ }).count();
      const an = await api("POST", `/informes/${E.informeId}/anular`, { motivo: "Intento del auditor" }, t.hector);
      check("h) Auditor: el informe sin botones de flujo y anular por la API → 403", botones === 0 && an.status === 403, `${botones} ${an.status}`);
    });
  }
  // Segregación en análisis: quien lo elabora (con permiso de revisar) no lo revisa.
  await bloque("h) segregación en análisis", async () => {
    const c = await cadena(t, `E2ESEG${stamp}`, { asignar: [id.ricardo] });
    const A = (await api("POST", "/samples/analysis", { tipo_analisis: "toxinas_lipofilicas", metodo: "hplc_ms_ms", extraccion_id: c.E, fecha_analisis: hoy(), analista_nombre: NOMBRE.ricardo, resultados: [{ id_muestra: c.idInt, resultado: 40, unidad: "µg/kg", limite_regulatorio: 160, cumple: "cumple" }] }, t.ricardo)).data?.id;
    await adjuntarEvidencia(`${BASE}/api`, t.ricardo, A);
    await api("POST", `/samples/analysis/${A}/enviar-revision`, {}, t.ricardo);
    const r = await api("POST", `/samples/analysis/${A}/revisar`, {}, t.ricardo);
    check("h) segregación: quien elaboró el análisis no lo revisa (409 por la API)", r.status === 409, `${r.status} ${r.data?.codigo || r.data?.message}`);
    E.analisisSeg = A;
  });
  if (E.analisisSeg) {
    await paso("ricardo", "h) segregación en pantalla", async (page) => {
      await page.goto(`${BASE}/muestras/analisis/${E.analisisSeg}`);
      await page.getByText("Separación de funciones").first().waitFor();
      check("h) quien elaboró ve «Marcar revisado» deshabilitado con la explicación", await page.getByRole("button", { name: "Marcar revisado" }).isDisabled());
    });
  }
  await bloque("h) sin sesión y reautenticación", async () => {
    const r = await fetch(`${BASE}/api/samples/reception`);
    check("h) la API sin sesión → 401", r.status === 401, `${r.status}`);
    const re = await api("POST", "/auth/reauth", { accion: "muestras:A", password: "no-es-la-contrasena" }, t.ricardo, SIN_REAUTH);
    check("h) reautenticación con contraseña incorrecta → rechazada y sin token", re.status >= 400 && !re.data?.token, `${re.status}`);
  });
}

try {
  if (SECCIONES.has("a")) await inventario();
  if (SECCIONES.has("b")) await muestras();
  if (SECCIONES.has("c")) await segundoUsuario();
  if (SECCIONES.has("d")) await calidad();
  if (SECCIONES.has("e")) await documentos();
  if (SECCIONES.has("f")) await respaldos();
  if (SECCIONES.has("h")) await negativos();
  if (SECCIONES.has("g")) await auditoria();
} finally {
  await browser.close();
  writeFileSync(path.join(CAPTURAS, "tiempos.json"), JSON.stringify(TIEMPOS, null, 2));
  const total = TIEMPOS.reduce((a, x) => a + x.ms, 0);
  console.log(`\nTiempos: ${TIEMPOS.length} pasos en ${(total / 1000).toFixed(1)} s (detalle en ${path.join(CAPTURAS, "tiempos.json")}); los más lentos:`);
  for (const x of [...TIEMPOS].sort((a, b) => b.ms - a.ms).slice(0, 5)) console.log(`  ${(x.ms / 1000).toFixed(1)} s  ${x.nombre}${x.api_lenta?.ms ? ` (API más lenta ${x.api_lenta.ms} ms ${x.api_lenta.ruta})` : ""}`);
}

check("sin errores de consola ni avisos de React en las pantallas recorridas", consola.length === 0, consola.slice(0, 5).join(" | "));
check("sin errores 5xx del servidor durante el recorrido", errores500.length === 0, errores500.slice(0, 5).join(" | "));
terminar();
