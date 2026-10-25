/*
 * Documentos SGC, rediseño (Parte C), en el navegador (datos de apoyo por la API):
 * - Bandeja: grupos por tipo de tarea en orden, con contador por grupo y sin grupos vacíos; renglón con
 *   área, clave, título, «Rev. N», papel y acción directa («Revisar» abre su ventana); contador en el
 *   subitem «Bandeja» del menú igual al total de la API; estado vacío amable;
 * - Solicitudes: pestañas Pendientes/Todas, «Aceptar» como acción principal del renglón, «Rechazar» y
 *   «Ver archivo de apoyo» en el menú ⋯, detalle en ventana; quien no atiende no ve «Aceptar»;
 * - Externos: «Verificar vigencia» en el renglón solo para quien puede; «Registrar externo» arriba;
 * - Lista Maestra: «Ver PDF» arriba a la derecha (con permiso); renglones con menú ⋯;
 * - formularios en ventana centrada con «Más opciones» plegado (se despliega solo si un opcional falla);
 * - confirmación con check al confirmar la lectura; animaciones apagadas con reduced-motion;
 * - oscuro y tableta sin desbordes; sin errores de consola.
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
const { principal } = await import("../lib/ficha.mjs");
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const { check, terminar } = crearCheck();
const stamp = Date.now().toString(36).slice(-4).toUpperCase();
const { t, id } = await sesiones();
const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana" }).format(new Date());
// Hoy (en Tijuana) más n días de calendario (sumar n × 24 h fallaba el día del cambio de horario).
const enDias = (n) => {
  const [anio, mes, dia] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana" }).format(new Date()).split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia + n)).toISOString().slice(0, 10);
};

/* ---------- Datos de apoyo ---------- */
const responsables = { elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.patricia };
async function ficha(campos, paginas = 1) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
  fd.append("archivo_pdf", new Blob([await pdfConTexto(paginas, campos.titulo)]), "doc.pdf");
  return (await api("POST", "/sgc/documentos", fd, t.ana)).data;
}
const cambio = { apartados_afectados: "Todo el documento", descripcion_cambio: "Emisión inicial" };
// R: en revisión (tarea «Revisar» de Ricardo).
const R = await ficha({ clave: `FX-TCP-R${stamp}`, titulo: `Procedimiento por revisar ${stamp}`, area_codigo: "TC", tipo_codigo: "P", ...responsables, ...cambio });
await api("POST", `/sgc/revisiones/${R.revision_id}/enviar-revision`, {}, t.luis);
// P: autorizada (tarea «Publicar» de Mejora Continua).
const P = await ficha({ clave: `FX-GCP-P${stamp}`, titulo: `Procedimiento por publicar ${stamp}`, area_codigo: "GC", tipo_codigo: "P", ...responsables, ...cambio });
await api("POST", `/sgc/revisiones/${P.revision_id}/enviar-revision`, {}, t.luis);
await api("POST", `/sgc/revisiones/${P.revision_id}/revisar`, { decision: "aceptar", comentario: "Correcto" }, t.ricardo);
await api("POST", `/sgc/revisiones/${P.revision_id}/autorizar`, { decision: "autorizar" }, t.patricia);
// L1 y L2: vigentes distribuidos a Luis con lectura requerida (lecturas pendientes).
const lectura = async (letra) => {
  const d = await ficha({ clave: `FX-TCI-${letra}${stamp}`, titulo: `Instrucción por leer ${letra} ${stamp}`, area_codigo: "TC", tipo_codigo: "I", ...responsables });
  await api("POST", `/sgc/revisiones/${d.revision_id}/registrar-vigente`, { fecha_emision: "2025-02-01", fecha_proxima_revision: "2028-02-01" }, t.ana);
  await api("POST", `/sgc/revisiones/${d.revision_id}/distribucion`, { usuarios: [id.luis], punto_uso: "Laboratorio", requiere_lectura: true, motivo: "Distribución de la prueba de listas" }, t.ana);
  return d;
};
const L1 = await lectura("A");
const L2 = await lectura("B");
// Solicitud de cambio de Luis con archivo de apoyo.
{
  const fd = new FormData();
  fd.append("tipo", "cambio");
  fd.append("documento_id", String(L1.id));
  fd.append("justificacion", `Actualizar la instrucción ${stamp} con el nuevo equipo`);
  fd.append("archivo", new Blob([await pdfConTexto(1, "Apoyo")]), "apoyo.pdf");
  await api("POST", "/sgc/solicitudes", fd, t.luis);
}
// Externo con Ricardo como responsable de seguimiento.
const IDENT = `NMX-${stamp}-IMNC`;
{
  const fd = new FormData();
  const campos = { identificador: IDENT, titulo: `Norma de listas ${stamp}`, area_codigo: "GC", tipo_codigo: "R", fuente: "IMNC", version_fecha: "2018", enlace: "https://www.imnc.org.mx", responsable_id: id.ricardo, ultima_verificacion: hoy, proxima_revision: enDias(365) };
  for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
  await api("POST", "/sgc/externos", fd, t.ana);
}

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
const captura = async (page, nombre) => page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), `fail-${nombre.replace(/[^a-z]/gi, "").slice(0, 24)}.png`), fullPage: true }).catch(() => {});
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const paso = async (quien, nombre, fn, opciones) => {
  const { context, page } = await nueva(opciones);
  try {
    await entrar(page, quien);
    await fn(page, context);
  } catch (err) {
    await captura(page, nombre);
    check(nombre, false, err instanceof Error ? err.message.split("\n")[0] : String(err));
  } finally {
    await context.close();
  }
};
const ORDEN = ["publicar", "autorizar", "revisar", "elaborar", "solicitud", "renovacion", "periodica", "obsolescencia", "otras", "lecturas"];
const gruposEnPantalla = (page) => page.locator('[data-testid="bandeja-grupo"], [data-testid="bandeja-lecturas"]').evaluateAll((xs) => xs.map((x) => x.getAttribute("data-grupo")));
const enOrden = (lista) => lista.every((g, i) => i === 0 || ORDEN.indexOf(g) > ORDEN.indexOf(lista[i - 1]));
const ventanaCentrada = (page) =>
  page.getByTestId("ventana-formulario").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return Math.abs(r.left + r.width / 2 - window.innerWidth / 2) < 4 && r.width < window.innerWidth - 40;
  });

try {
  /* ---------- Bandeja ---------- */
  await paso("ana", "Bandeja de Mejora Continua", async (page) => {
    await page.goto(`${BASE}/documentos/bandeja`);
    await page.getByTestId("bandeja-grupo").first().waitFor();
    const grupos = await gruposEnPantalla(page);
    check("bandeja: grupos por tipo de tarea en el orden definido", grupos.length >= 2 && enOrden(grupos) && grupos.includes("publicar") && grupos.includes("solicitud"), grupos.join(","));
    let contadores = true;
    for (const g of await page.locator('[data-testid="bandeja-grupo"], [data-testid="bandeja-lecturas"]').all()) {
      const filas = await g.locator('[data-testid="bandeja-tarea"], [data-testid="bandeja-lectura"]').count();
      if (Number(await g.getByTestId("bandeja-contador").getAttribute("data-valor")) !== filas || filas === 0) contadores = false;
    }
    check("bandeja: cada grupo con su contador (y ninguno vacío)", contadores);
    const fila = page.locator('[data-testid="bandeja-tarea"][data-tipo="publicar"]').filter({ hasText: `FX-GCP-P${stamp}` });
    const texto = await fila.innerText();
    check("bandeja: renglón con clave, título, «Rev. N», papel y acción directa", texto.includes(`Procedimiento por publicar ${stamp}`) && /Rev\. 1/.test(texto) && (await fila.getByTestId("bandeja-accion").innerText()).trim() === "Publicar" && (await fila.locator(".icono-area").count()) === 1, texto.replace(/\s+/g, " "));
    const total = (await api("GET", "/sgc/bandeja", undefined, t.ana)).data?.total;
    const menu = page.locator('[data-contador="/documentos/bandeja"]');
    await page.waitForTimeout(500);
    check("menú: el subitem «Bandeja» muestra el total de tareas y lecturas", (await menu.count()) === 1 && Number(await menu.innerText()) === total && (await page.locator('[data-contador="/documentos"]').count()) === 0, `${await menu.innerText().catch(() => "")} / ${total}`);
  });

  await paso("ricardo", "Bandeja del revisor: acción directa", async (page) => {
    await page.goto(`${BASE}/documentos/bandeja`);
    const fila = page.locator('[data-testid="bandeja-tarea"][data-tipo="revisar"]').filter({ hasText: `FX-TCP-R${stamp}` });
    await fila.getByRole("button", { name: "Revisar" }).click();
    await page.waitForURL((u) => u.pathname === `/documentos/${R.id}`);
    await page.getByTestId("decision-guardar").waitFor();
    check("bandeja: «Revisar» abre la ficha con la ventana de revisión", (await ventanaCentrada(page)) && !new URL(page.url()).searchParams.has("accion"));
  });

  // La administración técnica solo diagnostica metadatos en carpetas y fichas: la Bandeja no es para ese papel.
  await paso("jorge", "Bandeja sin acciones documentales", async (page) => {
    await page.goto(`${BASE}/documentos/bandeja`);
    await page.getByText("Sin acceso a Documentos SGC").waitFor();
    check("bandeja: el administrador técnico ve «Sin acceso» (no tiene tareas documentales)", (await page.getByTestId("bandeja-vacia").count()) === 0);
  });

  /* ---------- Solicitudes ---------- */
  await paso("ana", "Solicitudes de Mejora Continua", async (page) => {
    await page.goto(`${BASE}/documentos/solicitudes`);
    const fila = page.getByTestId("sgc-solicitud").filter({ hasText: `FX-TCI-A${stamp}` }).first();
    await fila.waitFor();
    check("solicitudes: pestañas «Pendientes / Todas»", (await page.getByRole("radio", { name: "Pendientes" }).or(page.getByRole("tab", { name: "Pendientes" })).count()) >= 1 && (await page.getByRole("radio", { name: "Todas" }).or(page.getByRole("tab", { name: "Todas" })).count()) >= 1);
    check("solicitudes: «Aceptar» es la acción principal del renglón", await fila.getByTestId("sgc-solicitud-aceptar").isVisible());
    await fila.getByRole("button", { name: /Más acciones/ }).click();
    const menu = await page.getByRole("menu").getByRole("menuitem").allInnerTexts();
    check("solicitudes: «Rechazar» y «Ver archivo de apoyo» en el menú ⋯", menu.some((x) => x.includes("Rechazar")) && menu.some((x) => x.includes("Ver archivo de apoyo")), menu.join(" | "));
    await page.keyboard.press("Escape");
    check("solicitudes: estado como etiqueta con icono", (await fila.locator("svg").count()) > 0 && /Pendiente/.test(await fila.innerText()));
    await fila.locator("button").first().click();
    await page.getByTestId("sgc-solicitud-detalle").waitFor();
    check("solicitudes: el renglón abre su detalle con la justificación", (await page.getByTestId("sgc-solicitud-detalle").innerText()).includes(`Actualizar la instrucción ${stamp}`));
    await page.keyboard.press("Escape");
    await fila.getByTestId("sgc-solicitud-aceptar").click();
    await page.getByTestId("ventana-formulario").waitFor();
    const mas = page.getByTestId("ventana-formulario").getByTestId("mas-opciones");
    check("aceptar: ventana centrada con lo opcional plegado en «Más opciones»", (await ventanaCentrada(page)) && (await mas.getAttribute("data-abierta")) === "0" && !(await page.locator("#acep-limite").isVisible()));
    await mas.getByRole("button", { name: /Más opciones/ }).click();
    check("aceptar: «Más opciones» despliega fecha límite y comentario", (await page.locator("#acep-limite").isVisible()) && (await page.locator("#acep-comentario").isVisible()));
    await page.keyboard.press("Escape");
  });

  await paso("luis", "Solicitudes del solicitante", async (page) => {
    await page.goto(`${BASE}/documentos/solicitudes`);
    await page.getByTestId("sgc-solicitud").filter({ hasText: `FX-TCI-A${stamp}` }).first().waitFor();
    check("solicitudes: quien propone no ve «Aceptar»", (await page.getByTestId("sgc-solicitud-aceptar").count()) === 0);
    // Nueva solicitud: un opcional con error despliega «Más opciones» solo.
    await page.getByTestId("sgc-nueva-solicitud").click();
    await page.getByTestId("ventana-formulario").waitFor();
    await page.locator("#sol-area").selectOption("TC");
    await page.locator("#sol-tipo").selectOption("P");
    await page.locator("#sol-titulo").fill(`Procedimiento propuesto ${stamp}`);
    await page.locator("#sol-justificacion").fill("Justificación de la prueba del formulario");
    await page.locator("#sol-apoyo-input").setInputFiles({ name: "apoyo.exe", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
    check("nueva solicitud: «Más opciones» plegado antes de enviar", (await page.getByTestId("ventana-formulario").getByTestId("mas-opciones").getAttribute("data-abierta")) === "0");
    await page.getByTestId("solicitud-guardar").click();
    await page.getByRole("button", { name: "Entendido", exact: true }).click();
    await page.locator("#sol-apoyo").waitFor();
    check("validación: un opcional con error despliega «Más opciones» y se ve el mensaje en el campo", (await page.getByTestId("ventana-formulario").getByTestId("mas-opciones").getAttribute("data-abierta")) === "1" && (await page.getByText("Formato no permitido").first().isVisible()));
    await page.keyboard.press("Escape");
  });

  /* ---------- Externos ---------- */
  await paso("ricardo", "Externos del responsable", async (page) => {
    await page.goto(`${BASE}/documentos/externos`);
    const fila = page.getByTestId("ext-fila").filter({ hasText: IDENT });
    await fila.waitFor();
    check("externos: «Verificar vigencia» en el renglón para el responsable", await fila.getByTestId("ext-fila-verificar").isVisible());
    await fila.getByTestId("ext-fila-verificar").click();
    await page.getByTestId("ventana-formulario").waitFor();
    check("externos: «Verificar vigencia» abre su ventana centrada", (await ventanaCentrada(page)) && (await page.locator("#ver-comentario").isVisible()));
    await page.keyboard.press("Escape");
    check("externos: sin «Registrar externo» para quien no lo gestiona", (await page.getByTestId("ext-registrar").count()) === 0);
  });
  await paso("mariana", "Externos sin verificar", async (page) => {
    await page.goto(`${BASE}/documentos/externos`);
    const fila = page.getByTestId("ext-fila").filter({ hasText: IDENT });
    await fila.waitFor();
    check("externos: quien no le toca no ve «Verificar vigencia»", (await fila.getByTestId("ext-fila-verificar").count()) === 0 && (await fila.getByRole("button", { name: /Más acciones/ }).count()) === 1);
  });
  await paso("ana", "Externos: registrar", async (page) => {
    await page.goto(`${BASE}/documentos/externos`);
    await page.getByTestId("ext-registrar").click();
    await page.getByTestId("ventana-formulario").waitFor();
    check("registrar externo: ventana centrada con «Más opciones» plegado", (await ventanaCentrada(page)) && (await page.getByTestId("ventana-formulario").getByTestId("mas-opciones").getAttribute("data-abierta")) === "0" && !(await page.locator("#ext-enlace").isVisible()) && (await page.locator("#ext-proxima").isVisible()));
    await page.keyboard.press("Escape");
  });

  /* ---------- Lista Maestra ---------- */
  await paso("ana", "Lista Maestra", async (page) => {
    await page.goto(`${BASE}/documentos/lista-maestra`);
    await page.getByTestId("lm-tabla").waitFor();
    const pdf = await page.getByTestId("lm-pdf").boundingBox();
    const tabla = await page.getByTestId("lm-tabla").boundingBox();
    check("Lista Maestra: «Ver PDF» arriba a la derecha", !!pdf && !!tabla && pdf.y < tabla.y && pdf.x > 1360 / 2, JSON.stringify(pdf));
    check("Lista Maestra: agrupada por área y renglones con menú ⋯", (await page.getByTestId("lm-area").count()) >= 1 && (await page.getByTestId("lm-fila").first().getByRole("button", { name: /Más acciones/ }).count()) === 1);
  });
  await paso("luis", "Lista Maestra sin exportar", async (page) => {
    await page.goto(`${BASE}/documentos/lista-maestra`);
    await page.getByTestId("lm-tabla").waitFor();
    check("Lista Maestra: sin «Ver PDF» para quien no la exporta", (await page.getByTestId("lm-pdf").count()) === 0);
  });

  /* ---------- Confirmacion con check y animaciones ---------- */
  await paso("luis", "confirmación con check", async (page) => {
    await page.goto(`${BASE}/documentos/${L1.id}`);
    await page.locator('[data-testid="sgc-visor"] canvas').first().waitFor({ timeout: 60_000 });
    check("lectura: acción principal «Confirmar lectura»", (await principal(page)) === "acuse-confirmar");
    await page.locator('[data-principal="1"][data-testid="acuse-confirmar"]').click();
    await page.getByRole("button", { name: "Confirmo", exact: true }).click();
    const marca = page.getByTestId("confirmacion-check");
    await marca.waitFor();
    check("confirmar lectura: confirmación breve con check animado", (await marca.evaluate((el) => getComputedStyle(el).animationName)) === "confirmacion-entra" && (await marca.locator(".trazo-dibujado").count()) >= 1);
    await marca.waitFor({ state: "detached", timeout: 5000 });
    check("la confirmación se va sola", true);
    // Desde el inicio, la carpeta entra suave.
    await page.goto(`${BASE}/documentos`);
    await page.locator('[data-testid="sgc-carpeta"][data-area="TC"]').click();
    await page.getByTestId("sgc-carpeta-encabezado").waitFor();
    check("carpeta: transición suave al entrar desde el inicio", (await page.getByTestId("sgc-carpeta-encabezado").evaluate((el) => getComputedStyle(el).animationName)) === "carpeta-entra");
  });

  await paso(
    "luis",
    "movimiento reducido",
    async (page) => {
      await page.goto(`${BASE}/documentos/bandeja`);
      const fila = page.getByTestId("bandeja-lectura").first();
      await fila.waitFor();
      check("reduced-motion: renglones de la bandeja sin entrada escalonada", (await fila.evaluate((el) => getComputedStyle(el).animationName)) === "none");
      const contador = page.getByTestId("bandeja-contador").first();
      check("reduced-motion: los contadores muestran su valor sin animar", Number(await contador.innerText()) === Number(await contador.getAttribute("data-valor")));
      await page.goto(`${BASE}/documentos/${L2.id}`);
      await page.locator('[data-testid="sgc-visor"] canvas').first().waitFor({ timeout: 60_000 });
      await page.locator('[data-principal="1"][data-testid="acuse-confirmar"]').click();
      await page.getByRole("button", { name: "Confirmo", exact: true }).click();
      const marca = page.getByTestId("confirmacion-check");
      await marca.waitFor();
      check("reduced-motion: la confirmación no anima (y el check no se dibuja)", (await marca.evaluate((el) => getComputedStyle(el).animationName)) === "none" && (await marca.locator(".trazo-dibujado").first().evaluate((el) => getComputedStyle(el).animationName)) === "none");
      await page.goto(`${BASE}/documentos/explorar?area=TC`);
      await page.getByTestId("sgc-carpeta-encabezado").waitFor();
      check("reduced-motion: la carpeta entra sin transición", (await page.getByTestId("sgc-carpeta-encabezado").evaluate((el) => getComputedStyle(el).animationName)) === "none");
      await page.goto(`${BASE}/documentos/solicitudes`);
      await page.getByTestId("sgc-nueva-solicitud").click();
      const mas = page.getByTestId("ventana-formulario").getByTestId("mas-opciones");
      await mas.getByRole("button", { name: /Más opciones/ }).click();
      check("reduced-motion: «Más opciones» se despliega sin animación", (await mas.locator("[id]").last().evaluate((el) => getComputedStyle(el).animationName)) === "none");
      await page.keyboard.press("Escape");
    },
    { reducedMotion: "reduce" },
  );

  /* ---------- Oscuro y tableta ---------- */
  await paso(
    "ana",
    "oscuro y tableta",
    async (page) => {
      for (const [ruta, testid, nombre] of [
        ["/documentos/bandeja", "bandeja-grupo", "bandeja"],
        ["/documentos/solicitudes", "sgc-solicitud", "solicitudes"],
        ["/documentos/externos", "ext-fila", "externos"],
        ["/documentos/lista-maestra", "lm-tabla", "Lista Maestra"],
      ]) {
        await page.goto(`${BASE}${ruta}`);
        await page.getByTestId(testid).first().waitFor();
        check(`oscuro y tableta: ${nombre} sin desbordes`, (await page.evaluate(() => document.documentElement.dataset.theme || "")) === "dark" && (await sinDesborde(page)));
      }
      await page.goto(`${BASE}/documentos/solicitudes`);
      await page.getByTestId("sgc-nueva-solicitud").click();
      await page.getByTestId("ventana-formulario").waitFor();
      const caja = await page.getByTestId("ventana-formulario").boundingBox();
      check("tableta: la ventana del formulario cabe en la pantalla", !!caja && caja.x >= 0 && caja.x + caja.width <= 820 + 1);
      await page.keyboard.press("Escape");
    },
    { colorScheme: "dark", viewport: { width: 820, height: 1180 }, hasTouch: true },
  );
} finally {
  await browser.close();
}

check("sin errores de consola", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
terminar();
