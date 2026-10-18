/*
 * Documentos SGC, Fase 2, en el navegador (datos de apoyo por la API):
 * - Luis propone un cambio desde «Solicitudes»; Mejora Continua (Ana) lo acepta y asigna responsables;
 * - el revisor (Gabriela) ve la tarea en su bandeja y el contador del menú, devuelve con comentario
 *   (sin comentario se marca el campo) y luego acepta;
 * - la autorizadora (Patricia) autoriza escribiendo su contraseña; Mejora Continua publica con contraseña;
 * - la ficha muestra la línea de tiempo y la anterior obsoleta; quien no está asignado no ve botones del flujo;
 * - pendiente de revisión: aviso en la ficha y renovación iniciada desde la interfaz;
 * - obsolescencia: se solicita con motivo y contraseña;
 * - modo oscuro y tableta sin desbordes; sin errores de consola.
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
const enDias = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana" }).format(new Date(Date.now() + n * 86_400_000));

/* ---------- Datos de apoyo ---------- */
async function ficha(campos) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
  fd.append("archivo_pdf", new Blob([await pdfConTexto(1, campos.titulo)]), "inicial.pdf");
  return (await api("POST", "/sgc/documentos", fd, t.ana)).data;
}
const D = await ficha({ clave: `FX-TCI-W${stamp}`, titulo: `Instrucción del flujo UI ${stamp}`, area_codigo: "TC", tipo_codigo: "I", elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.patricia });
await api("POST", `/sgc/revisiones/${D.revision_id}/registrar-vigente`, { fecha_emision: "2025-02-01", fecha_proxima_revision: "2028-02-01" }, t.ana);
// Documento pendiente de revision (proxima revision en 10 dias) para la renovacion.
const P = await ficha({ clave: `FX-GCP-Q${stamp}`, titulo: `Procedimiento por renovar ${stamp}`, area_codigo: "GC", tipo_codigo: "P", elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.patricia });
await api("POST", `/sgc/revisiones/${P.revision_id}/registrar-vigente`, { fecha_emision: "2023-03-01", fecha_proxima_revision: enDias(10) }, t.ana);

const browser = await chromium.launch({ executablePath, headless: true });
const consoleErrors = [];
const nueva = async (opciones = {}) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, ...opciones });
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
  // El primer acceso puede tardar mientras el servidor de desarrollo compila las páginas.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 });
};
const contrasena = async (page, quien) => {
  await page.locator("#reauth-password").fill(credenciales[EMAIL[quien]]);
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
};
const captura = async (page) => page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), "fail.png"), fullPage: true }).catch(() => {});
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const paso = async (quien, nombre, fn, opciones) => {
  const { context, page } = await nueva(opciones);
  try {
    await entrar(page, quien);
    await fn(page);
  } catch (err) {
    await captura(page);
    check(nombre, false, err instanceof Error ? err.message : String(err));
  } finally {
    await context.close();
  }
};
const revisionEnCurso = async () => ((await api("GET", `/sgc/documentos/${D.id}`, undefined, t.ana)).data?.revisiones || []).find((r) => !["vigente", "obsoleta", "cancelada"].includes(r.estado));

try {
  /* ---------- Luis propone el cambio ---------- */
  await paso("luis", "Luis propone", async (page) => {
    await page.goto(`${BASE}/documentos/${D.id}`);
    await (await accion(page, "sgc-proponer")).click();
    await page.locator("#sol-justificacion").fill("Actualizar la instrucción con el nuevo procedimiento de limpieza");
    await page.getByTestId("solicitud-guardar").click();
    await page.getByText("Solicitud #").first().waitFor();
    await page.goto(`${BASE}/documentos/solicitudes`);
    await page.getByTestId("sgc-solicitud").first().waitFor();
    check("el solicitante ve su solicitud pendiente y no puede atenderla", (await page.getByTestId("sgc-solicitud").filter({ hasText: D.clave ?? `FX-TCI-W${stamp}` }).count()) >= 1 && (await page.getByTestId("sgc-solicitud-aceptar").count()) === 0);
  });

  /* ---------- Mejora Continua acepta y asigna ---------- */
  await paso("ana", "Ana acepta", async (page) => {
    await page.goto(`${BASE}/documentos/bandeja`);
    await page.getByTestId("bandeja-tarea").filter({ hasText: "Atender solicitud de cambio" }).first().waitFor();
    check("Mejora Continua ve la solicitud en su bandeja", true);
    await page.goto(`${BASE}/documentos/solicitudes`);
    const tarjeta = page.getByTestId("sgc-solicitud").filter({ hasText: `FX-TCI-W${stamp}` }).first();
    await tarjeta.getByTestId("sgc-solicitud-aceptar").click();
    await page.locator("#acep-elaborador").selectOption(String(id.ricardo));
    await page.locator("#acep-revisor").selectOption(String(id.ricardo));
    await page.locator("#acep-autorizador").selectOption(String(id.patricia));
    await page.getByTestId("aceptar-guardar").click();
    await page.getByText("Asigna elaborador, revisor y autorizador").or(page.getByText("tres personas distintas")).first().waitFor();
    check("aceptar: la misma persona en dos papeles se marca antes de enviar", true);
    await page.getByRole("button", { name: "Entendido", exact: true }).click();
    await page.locator("#acep-elaborador").selectOption(String(id.luis));
    await page.locator("#acep-revisor").selectOption(String(id.gabriela));
    await page.locator("#acep-limite").fill(new Date(Date.now() + 7 * 86_400_000).toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" }));
    await page.locator("#acep-limite").blur();
    await page.getByTestId("aceptar-guardar").click();
    await page.waitForURL((url) => url.pathname === `/documentos/${D.id}`);
    await page.getByTestId("sgc-en-curso").waitFor();
    check("aceptada: la ficha muestra la revisión en curso con fecha límite y la vigente sigue", (await page.getByTestId("sgc-fecha-limite").count()) === 1 && (await page.getByTestId("sgc-visor").count()) === 1 && (await (await accion(page, "sgc-reasignar")).isEnabled()));
    await cerrarMenu(page);
  });

  // Luis carga el PDF y los datos del cambio por la API y la envía a revision.
  const r2 = await revisionEnCurso();
  {
    const fd = new FormData();
    fd.append("tipo", "pdf");
    fd.append("archivo", new Blob([await pdfConTexto(1, "Revision 2")]), "rev2.pdf");
    await api("POST", `/sgc/revisiones/${r2.id}/archivos`, fd, t.luis);
    await api("PUT", `/sgc/revisiones/${r2.id}`, { apartados_afectados: "Paso 4", descripcion_cambio: "Nuevo procedimiento de limpieza" }, t.luis);
  }
  await paso("luis", "Luis envía a revisión", async (page) => {
    await page.goto(`${BASE}/documentos/${D.id}`);
    await (await accion(page, "sgc-enviar-revision")).click();
    await page.getByRole("button", { name: "Enviar a revisión", exact: true }).last().click();
    await page.locator('[data-principal="1"][data-testid="sgc-enviar-revision"]').waitFor({ state: "detached" });
    await page.getByText("Archivos bloqueados", { exact: false }).first().waitFor();
    check("el elaborador envía a revisión desde la ficha; el archivo queda bloqueado con su motivo", (await (await accion(page, "sgc-subir-archivo")).isDisabled()) && (await motivo(page, "sgc-subir-archivo")).length > 0);
    await cerrarMenu(page);
  });

  /* ---------- Revisor: bandeja, contador, devolver y aceptar ---------- */
  await paso("gabriela", "Gabriela revisa", async (page) => {
    await page.goto(`${BASE}/documentos/bandeja`);
    const tarea = page.getByTestId("bandeja-tarea").filter({ hasText: `FX-TCI-W${stamp}` }).first();
    await tarea.waitFor();
    check("el revisor tiene la tarea «Revisar» en su bandeja y contador en el menú", (await tarea.getAttribute("data-tipo")) === "revisar" && (await page.locator('[data-contador="/documentos"]').count()) === 1);
    await tarea.getByRole("button", { name: "Ir" }).click();
    await page.waitForURL((url) => url.pathname === `/documentos/${D.id}`);
    await (await accion(page, "sgc-revisar")).click();
    await page.getByText("Devolver", { exact: true }).first().click();
    await page.getByTestId("decision-guardar").click();
    await page.getByText("Escribe el comentario").first().waitFor();
    check("devolver sin comentario se marca antes de enviar", true);
    await page.getByRole("button", { name: "Entendido", exact: true }).click();
    await page.locator("#decision-comentario").fill("Agrega la tabla de concentraciones");
    await page.getByTestId("decision-guardar").click();
    await page.getByTestId("sgc-revisar").waitFor({ state: "detached" });
    check("devuelta: el revisor ya no tiene la acción «Revisar» (ni como principal ni en el menú ⋯)", (await contarAccion(page, "sgc-revisar")) === 0);
  });
  check("devuelta: la revisión vuelve a borrador", (await revisionEnCurso())?.estado === "borrador");
  await api("POST", `/sgc/revisiones/${r2.id}/enviar-revision`, {}, t.luis);
  await paso("gabriela", "Gabriela acepta", async (page) => {
    await page.goto(`${BASE}/documentos/${D.id}`);
    await (await accion(page, "sgc-revisar")).click();
    await page.getByTestId("decision-guardar").click();
    await page.getByTestId("sgc-revisar").waitFor({ state: "detached" });
    check("el revisor acepta: pasa a autorización", true);
  });

  /* ---------- Quien no esta asignado no ve botones del flujo ---------- */
  await paso("ricardo", "Ricardo sin asignación", async (page) => {
    await page.goto(`${BASE}/documentos/${D.id}`);
    await page.getByTestId("sgc-en-curso").waitFor();
    check("quien no está asignado (aunque tenga el permiso) no ve «Revisar» ni «Autorizar»", (await contarAccion(page, "sgc-revisar")) === 0 && (await contarAccion(page, "sgc-autorizar")) === 0 && (await contarAccion(page, "sgc-publicar")) === 0);
  });

  /* ---------- Autorizar (contrasena) y publicar (contrasena) ---------- */
  await paso("patricia", "Patricia autoriza", async (page) => {
    await page.goto(`${BASE}/documentos/${D.id}`);
    await (await accion(page, "sgc-autorizar")).click();
    await page.getByTestId("decision-guardar").click();
    await contrasena(page, "patricia");
    await page.getByTestId("sgc-autorizar").waitFor({ state: "detached" });
    check("el autorizador autoriza escribiendo su contraseña", true);
  });
  await paso("ana", "Ana publica", async (page) => {
    await page.goto(`${BASE}/documentos/${D.id}`);
    await (await accion(page, "sgc-publicar")).click();
    await page.getByTestId("publicar-guardar").click();
    await contrasena(page, "ana");
    await page.getByTestId("sgc-en-curso").waitFor({ state: "detached" });
    // Sin revision en curso la ficha abre en Detalles: el historial (plegado) vive en la pestaña Revisiones.
    await pestana(page, "Revisiones");
    await page.getByTestId("sgc-historial").locator("summary").first().click();
    await page.getByTestId("sgc-historial-fila").first().waitFor();
    const estados = await page.getByTestId("sgc-historial-fila").evaluateAll((filas) => filas.map((f) => `${f.getAttribute("data-numero")}:${f.getAttribute("data-estado")}`));
    check("publicada: la nueva vigente y la anterior obsoleta en el historial", estados.includes("2:vigente") && estados.includes("1:obsoleta"), estados.join(" "));
    const fila = page.locator('[data-testid="sgc-historial-fila"][data-numero="2"]');
    await fila.locator("summary").click();
    const pasos = await fila.locator("[data-accion]").evaluateAll((li) => li.map((x) => x.getAttribute("data-accion")));
    check("línea de tiempo completa en la ficha", ["solicitar", "aceptar_solicitud", "enviar_revision", "revisar_devolver", "revisar_aceptar", "autorizar", "publicar"].every((p) => pasos.includes(p)), pasos.join(","));
  });

  /* ---------- Pendiente de revision y renovacion; obsolescencia ---------- */
  await paso("ana", "Ana renueva y solicita obsolescencia", async (page) => {
    await page.goto(`${BASE}/documentos/${P.id}`);
    await page.getByTestId("sgc-aviso-pendiente").waitFor();
    check("pendiente de revisión: aviso en la ficha", true);
    await (await accion(page, "sgc-renovar")).click();
    await page.locator("#ren-revisor").selectOption(String(id.gabriela));
    await page.locator("#ren-autorizador").selectOption(String(id.patricia));
    await page.getByTestId("renovar-guardar").click();
    await page.getByTestId("sgc-renovacion").waitFor();
    check("renovación iniciada desde la interfaz", true);
    await page.goto(`${BASE}/documentos/${D.id}`);
    await (await accion(page, "sgc-obsoletar")).click();
    await page.locator("#obs-motivo").fill("La instrucción se integra en otro procedimiento");
    await page.getByTestId("obsoletar-guardar").click();
    await contrasena(page, "ana");
    await page.getByText("Obsolescencia solicitada").first().waitFor();
    check("obsolescencia solicitada con motivo y contraseña (queda pendiente del segundo usuario)", true);
  });
  await paso("gabriela", "Gabriela confirma la vigencia", async (page) => {
    await page.goto(`${BASE}/documentos/${P.id}`);
    await (await accion(page, "sgc-renovacion-revisar")).click();
    await page.locator("#decision-comentario").fill("El procedimiento sigue vigente sin cambios");
    await page.getByTestId("decision-guardar").click();
    await page.getByTestId("sgc-renovacion-revisar").waitFor({ state: "detached" });
    check("el revisor confirma la vigencia de la renovación", true);
  });

  /* ---------- Modo oscuro y tableta ---------- */
  await paso(
    "patricia",
    "oscuro y tableta",
    async (page) => {
      await page.goto(`${BASE}/documentos/bandeja`);
      await page.getByTestId("bandeja-tarea").first().waitFor();
      const tema = await page.evaluate(() => document.documentElement.dataset.theme || "");
      check("modo oscuro: bandeja con el tema oscuro", tema === "dark");
      check("tableta: bandeja sin desbordes", await sinDesborde(page));
      await page.goto(`${BASE}/documentos/solicitudes`);
      await page.getByRole("heading", { name: "Solicitudes de documentos" }).waitFor();
      check("tableta: solicitudes sin desbordes", await sinDesborde(page));
      await page.goto(`${BASE}/documentos/${P.id}`);
      await page.getByTestId("sgc-renovacion").waitFor();
      check("tableta: ficha con renovación sin desbordes", await sinDesborde(page));
    },
    { colorScheme: "dark", viewport: { width: 820, height: 1180 } },
  );
} finally {
  await browser.close();
}

check("sin errores de consola", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
terminar();
