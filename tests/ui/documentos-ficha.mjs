/*
 * Documentos SGC, rediseño (Parte B), en el navegador (datos de apoyo por la API):
 * - inicio: «Nueva solicitud» (proponer) como acción principal y «Nueva ficha» secundaria (crear ficha);
 * - carpeta: tarjetas con miniatura del PDF vigente (o icono del tipo), clave, título, «Rev. N», estado,
 *   marcas «Externo» y «Confidencial», indicador de revisión en curso; filtros en un botón, orden en un
 *   menú, sin vista de tabla y estado vacío amable;
 * - la miniatura no cuenta como apertura para un destinatario ni deja «consultar» en la bitácora de un
 *   confidencial (se comprueba en la base);
 * - ficha: una acción principal según el papel (elaborador, revisor, autorizador, Mejora Continua,
 *   destinatario) o ninguna; el resto en el menú ⋯; pestañas Detalles, Revisiones y Lecturas con
 *   historial plegado y sin la sección de bitácora; «Ver en Auditoría» abre la bitácora filtrada;
 * - oscuro, tableta y reduced-motion; sin errores de consola.
 */
import "../lib/reauth-auto.mjs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const BASE = process.env.BASE || "http://localhost:3100";
process.env.BASE = `${BASE}/api`;
const { api, credenciales, crearCheck, EMAIL, fila, sesiones } = await import("../lib/calidad.mjs");
const { pdfConTexto } = await import("../lib/archivos.mjs");
const { abrirMenu, accion, cerrarMenu, contarAccion, pestana, principal } = await import("../lib/ficha.mjs");
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const { check, terminar } = crearCheck();
const stamp = Date.now().toString(36).slice(-4).toUpperCase();
const { t, id } = await sesiones();
const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana" }).format(new Date());
const enDias = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana" }).format(new Date(Date.now() + n * 86_400_000));

/* ---------- Datos de apoyo ---------- */
async function ficha(campos, paginas = 1) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
  fd.append("archivo_pdf", new Blob([await pdfConTexto(paginas, campos.titulo)]), "doc.pdf");
  return (await api("POST", "/sgc/documentos", fd, t.ana)).data;
}
const responsables = { elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.patricia };
// F: en elaboracion, con PDF y datos del cambio: recorre el flujo (elaborador → revisor → autorizador → Mejora Continua).
const F = await ficha({ clave: `FX-TCP-F${stamp}`, titulo: `Procedimiento del flujo de la ficha ${stamp}`, area_codigo: "TC", tipo_codigo: "P", ...responsables, apartados_afectados: "Todo el documento", descripcion_cambio: "Emisión inicial" });
// D: vigente de uso interno, distribuido a Luis con lectura requerida.
const D = await ficha({ clave: `FX-TCI-D${stamp}`, titulo: `Instrucción distribuida ${stamp}`, area_codigo: "TC", tipo_codigo: "I", ...responsables }, 3);
await api("POST", `/sgc/revisiones/${D.revision_id}/registrar-vigente`, { fecha_emision: "2025-02-01", fecha_proxima_revision: "2028-02-01" }, t.ana);
await api("POST", `/sgc/revisiones/${D.revision_id}/distribucion`, { usuarios: [id.luis], punto_uso: "Área de extracción", requiere_lectura: true, motivo: "Distribución de la prueba de la ficha" }, t.ana);
// C: confidencial vigente (sin miniatura: cada apertura quedaria en la bitacora).
const C = await ficha({ clave: `FX-GCL-C${stamp}`, titulo: `Lista confidencial ${stamp}`, area_codigo: "GC", tipo_codigo: "L", confidencialidad: "confidencial", ...responsables });
await api("POST", `/sgc/revisiones/${C.revision_id}/registrar-vigente`, { fecha_emision: "2025-02-01" }, t.ana);
// E: externo (marca «Externo» en la tarjeta).
{
  const fd = new FormData();
  const campos = { identificador: `NOM-${stamp}-SSA1`, titulo: `Norma externa de la prueba ${stamp}`, area_codigo: "TC", tipo_codigo: "R", fuente: "Secretaría de Salud", version_fecha: "2020", enlace: "https://www.dof.gob.mx", responsable_id: id.ricardo, ultima_verificacion: hoy, proxima_revision: enDias(365) };
  for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
  await api("POST", "/sgc/externos", fd, t.ana);
}
const permisosDe = async (quien) => (await api("GET", "/auth/me", undefined, t[quien])).data?.permissions || {};
const auditoriaVisible = (p) => !!p.calidad?.V && p.calidad.V !== "incidencias";

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
const tarjeta = (page, clave) => page.locator(`[data-testid="sgc-tarjeta"][data-clave="${clave}"]`);
const fondo = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);
/* Desplazamiento vertical aplicado (Tailwind usa la propiedad CSS `translate`; tambien se mira `transform`). */
const elevada = (loc) => loc.evaluate((el) => {
  const cs = getComputedStyle(el);
  const t = cs.translate && cs.translate !== "none" ? cs.translate.split(" ").map(parseFloat) : [0, 0];
  return Math.abs(t[1] || 0) > 0.5 || (cs.transform !== "none" && cs.transform !== "matrix(1, 0, 0, 1, 0, 0)");
});
const consultasDe = (docId) => Number(fila("SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'sgc_documentos' AND entidad_id = ? AND accion = 'consultar'", docId)?.n || 0);
const aperturaDe = (revId, usuario) => fila("SELECT abierto_en FROM sgc_lecturas WHERE revision_id = ? AND usuario_id = ?", revId, usuario)?.abierto_en ?? null;
const vigenteDe = async (docId) => ((await api("GET", `/sgc/documentos/${docId}`, undefined, t.ana)).data?.revisiones || []).find((r) => r.estado === "vigente");

try {
  /* ---------- Inicio: botones según permiso ---------- */
  await paso("ana", "inicio: Nueva solicitud y Nueva ficha", async (page) => {
    await page.goto(`${BASE}/documentos`);
    await page.getByTestId("sgc-carpetas").waitFor();
    const solicitud = page.getByTestId("sgc-nueva-solicitud");
    const nuevaFicha = page.getByTestId("sgc-nueva-ficha");
    check("inicio (Mejora Continua): «Nueva solicitud» principal y «Nueva ficha» secundaria", (await solicitud.count()) === 1 && (await nuevaFicha.count()) === 1 && (await fondo(solicitud)) !== (await fondo(nuevaFicha)), `${await fondo(solicitud)} / ${await fondo(nuevaFicha)}`);
    await solicitud.click();
    await page.locator("#sol-justificacion").waitFor();
    check("«Nueva solicitud» abre el formulario de solicitud", true);
    await page.keyboard.press("Escape");
  });
  await paso("luis", "inicio: solo Nueva solicitud", async (page) => {
    await page.goto(`${BASE}/documentos`);
    await page.getByTestId("sgc-carpetas").waitFor();
    check("inicio (quien solo propone): «Nueva solicitud» sin «Nueva ficha»", (await page.getByTestId("sgc-nueva-solicitud").count()) === 1 && (await page.getByTestId("sgc-nueva-ficha").count()) === 0);
  });

  /* ---------- Ficha: accion principal por papel (F recorre el flujo) ---------- */
  await paso("luis", "elaborador", async (page) => {
    await page.goto(`${BASE}/documentos/${F.id}`);
    check("elaborador en borrador: acción principal «Enviar a revisión»", (await principal(page)) === "sgc-enviar-revision", String(await principal(page)));
    check("elaborador: «Cargar o sustituir archivo» en el menú ⋯", (await contarAccion(page, "sgc-subir-archivo")) === 1);
  });
  await api("POST", `/sgc/revisiones/${F.revision_id}/enviar-revision`, {}, t.luis);

  /* ---------- Carpeta: tarjetas (con F en revision) ---------- */
  await paso("ana", "carpeta con tarjetas", async (page) => {
    const consultasAntes = consultasDe(C.id);
    await page.goto(`${BASE}/documentos/explorar?area=TC`);
    await page.getByTestId("sgc-tarjetas").waitFor();
    const ruta = (await page.getByTestId("ruta-documentos").innerText()).replace(/\s+/g, " ");
    check("carpeta: ruta corta «Documentos › Gestión Técnica»", /^Documentos\b/.test(ruta.trim()) && ruta.includes("Gestión Técnica"), ruta);
    const tarjetas = page.getByTestId("sgc-tarjeta");
    const conMiniatura = await tarjetas.evaluateAll((xs) => xs.every((x) => !!x.querySelector('[data-testid="sgc-miniatura"]')));
    check("carpeta: cada tarjeta con su miniatura o el icono del tipo", (await tarjetas.count()) > 0 && conMiniatura);
    const f = tarjeta(page, `FX-TCP-F${stamp}`);
    const textoF = await f.innerText();
    check("tarjeta: clave en monoespaciada, título y estado con texto", (await f.locator(".code").first().innerText()) === `FX-TCP-F${stamp}` && textoF.includes(`Procedimiento del flujo de la ficha ${stamp}`) && /En elaboración/.test(textoF), textoF.replace(/\s+/g, " "));
    check("tarjeta: indicador «Rev. 1 en revisión»", (await f.getByTestId("sgc-tarjeta-en-curso").innerText()).trim() === "Rev. 1 en revisión");
    const d = tarjeta(page, `FX-TCI-D${stamp}`);
    check("tarjeta: «Rev. 1» y «Vigente»", /Rev\. 1/.test(await d.innerText()) && /Vigente/.test(await d.innerText()));
    await d.locator('[data-testid="sgc-miniatura"][data-con-imagen="1"] img').waitFor({ timeout: 60_000 });
    check("tarjeta: miniatura de la primera página del PDF vigente (uso interno, sin ser destinataria)", true);
    check("tarjeta: marca «Externo»", (await tarjeta(page, `NOM-${stamp}-SSA1`).getByTestId("etiqueta-externo").count()) === 1);
    check("carpeta: sin vista de tabla", (await page.getByRole("button", { name: "Ver en tabla" }).count()) === 0 && (await page.getByTestId("sgc-fila").count()) === 0);
    check("carpeta: filtros en un solo botón «Filtros»", (await page.getByRole("button", { name: /^Filtros/ }).count()) === 1);
    // Especificación §5 (búsqueda y filtros): también por responsable (propietario) y por fecha de emisión.
    const nTarjetas = await page.getByTestId("sgc-tarjeta").count();
    await page.getByRole("button", { name: /^Filtros/ }).click();
    const grupoPropietario = page.locator('section[aria-label="Propietario"]');
    const grupoFecha = page.locator('section[aria-label="Fecha de emisión"]');
    await grupoFecha.waitFor();
    check("carpeta: «Filtros» incluye propietario y fecha de emisión", (await grupoPropietario.count()) === 1 && (await grupoPropietario.getByRole("switch").count()) >= 1);
    await grupoFecha.getByRole("switch", { name: "Personalizado" }).click();
    await page.locator("#sgc-desde").waitFor();
    await page.locator("#sgc-desde").pressSequentially("01012099");
    await page.locator("#sgc-desde").blur();
    await page.keyboard.press("Escape");
    await page.getByTestId("sgc-vacio").waitFor();
    check("carpeta: el filtro por fecha de emisión se aplica (desde 2099: nada coincide)", /Nada coincide/.test(await page.getByTestId("sgc-vacio").innerText()));
    await page.getByRole("button", { name: /^Filtros/ }).click();
    await grupoFecha.getByRole("switch", { name: "Personalizado" }).click();
    await page.keyboard.press("Escape");
    await page.getByTestId("sgc-tarjeta").first().waitFor();
    check("carpeta: al quitar el filtro de fecha vuelven las tarjetas", (await page.getByTestId("sgc-tarjeta").count()) === nTarjetas, `${await page.getByTestId("sgc-tarjeta").count()} vs ${nTarjetas}`);
    // Orden en un menú pequeño.
    await page.getByTestId("sgc-ordenar").click();
    await page.getByRole("menuitem", { name: "Título A–Z" }).click();
    await page.getByTestId("sgc-ordenar").getByText("Título A–Z").waitFor();
    await page.waitForTimeout(600);
    const titulos = await page.locator('[data-testid="sgc-tarjeta"] h3').allInnerTexts();
    const ordenados = [...titulos].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
    check("orden: «Título A–Z» desde el menú de orden", titulos.join("|") === ordenados.join("|"), titulos.slice(0, 4).join(" | "));
    // Elevacion al pasar el cursor.
    await d.hover();
    await page.waitForTimeout(350);
    check("tarjeta: se eleva al pasar el cursor", await elevada(d));
    // Estado vacio amable.
    await page.getByPlaceholder("Buscar por clave, título o palabras clave").fill(`sin-coincidencias-${stamp}`);
    await page.getByTestId("sgc-vacio").waitFor();
    check("carpeta: estado vacío amable", /Nada coincide/.test(await page.getByTestId("sgc-vacio").innerText()));
    // Confidencial: marca y sin miniatura; ver la carpeta no deja «consultar» en la bitácora.
    await page.goto(`${BASE}/documentos/explorar?area=GC`);
    const c = tarjeta(page, `FX-GCL-C${stamp}`);
    await c.waitFor();
    await page.waitForTimeout(2500);
    check("tarjeta: marca «Confidencial» y sin miniatura (icono del tipo)", /Confidencial/.test(await c.innerText()) && (await c.locator('[data-testid="sgc-miniatura"]').getAttribute("data-con-imagen")) === "0");
    check("ver la carpeta no registra «consultar» del confidencial en la bitácora", consultasDe(C.id) === consultasAntes, `${consultasAntes} → ${consultasDe(C.id)}`);
  });

  await paso("luis", "destinatario: sin miniatura ni apertura", async (page) => {
    const rev = await vigenteDe(D.id);
    await page.goto(`${BASE}/documentos/explorar?area=TC`);
    const d = tarjeta(page, `FX-TCI-D${stamp}`);
    await d.waitFor();
    await page.waitForTimeout(3000);
    check("destinatario: la tarjeta no genera miniatura (usa el icono del tipo)", (await d.locator('[data-testid="sgc-miniatura"]').getAttribute("data-con-imagen")) === "0");
    check("destinatario: ver la carpeta no cuenta como abrir el PDF", aperturaDe(rev.id, id.luis) === null, String(aperturaDe(rev.id, id.luis)));
    // En la ficha, la accion principal es confirmar la lectura (abrir el visor si cuenta como apertura).
    await d.click();
    await page.waitForURL((u) => u.pathname === `/documentos/${D.id}`);
    await page.locator('[data-testid="sgc-visor"] canvas').first().waitFor({ timeout: 60_000 });
    check("destinatario: acción principal «Confirmar lectura»", (await principal(page)) === "acuse-confirmar", String(await principal(page)));
    check("destinatario: el aviso bajo el visor no repite el botón", (await page.getByTestId("acuse-pendiente").getByRole("button").count()) === 0);
  });

  await paso("ricardo", "revisor", async (page) => {
    await page.goto(`${BASE}/documentos/${F.id}`);
    check("revisor: acción principal «Revisar»", (await principal(page)) === "sgc-revisar", String(await principal(page)));
  });
  await api("POST", `/sgc/revisiones/${F.revision_id}/revisar`, { decision: "aceptar", comentario: "Correcto" }, t.ricardo);
  await paso("patricia", "autorizador", async (page) => {
    await page.goto(`${BASE}/documentos/${F.id}`);
    check("autorizador: acción principal «Autorizar»", (await principal(page)) === "sgc-autorizar", String(await principal(page)));
  });
  await api("POST", `/sgc/revisiones/${F.revision_id}/autorizar`, { decision: "autorizar" }, t.patricia);
  await paso("ana", "Mejora Continua", async (page) => {
    await page.goto(`${BASE}/documentos/${F.id}`);
    check("Mejora Continua: acción principal «Publicar»", (await principal(page)) === "sgc-publicar", String(await principal(page)));
    await abrirMenu(page);
    const enMenu = await page.getByRole("menu").getByRole("menuitem").evaluateAll((xs) => xs.map((x) => x.getAttribute("data-testid")));
    check("Mejora Continua: las demás acciones en el menú ⋯ (sin repetir la principal)", !enMenu.includes("sgc-publicar") && enMenu.includes("sgc-editar") && enMenu.includes("sgc-proponer") && enMenu.includes("sgc-ver-auditoria"), enMenu.join(","));
    await cerrarMenu(page);
  });

  await paso("mariana", "sin acción", async (page) => {
    const p = await permisosDe("mariana");
    await page.goto(`${BASE}/documentos/${D.id}`);
    await page.getByTestId("sgc-ficha").waitFor();
    check("consulta: sin acción principal", (await principal(page)) === null);
    check("consulta: en ⋯ solo lo que puede (descargar) y nada del flujo", (await contarAccion(page, "sgc-descargar-pdf")) === 1 && (await contarAccion(page, "sgc-editar")) === 0 && (await contarAccion(page, "sgc-obsoletar")) === 0);
    check("«Ver en Auditoría» solo con permiso de ver la bitácora", (await contarAccion(page, "sgc-ver-auditoria")) === (auditoriaVisible(p) ? 1 : 0), JSON.stringify(p.calidad || null));
  });

  /* ---------- Ficha: pestañas, historial plegado, sin bitacora; Ver en Auditoria ---------- */
  await paso("ana", "pestañas de la ficha", async (page) => {
    await page.goto(`${BASE}/documentos/${D.id}`);
    await page.getByTestId("sgc-ficha").waitFor();
    const tabs = await page.getByRole("tab").allInnerTexts();
    check("ficha: pestañas Detalles, Revisiones y Lecturas", ["Detalles", "Revisiones", "Lecturas"].every((x) => tabs.some((y) => y.trim() === x)), tabs.join("|"));
    check("ficha: abre en Detalles (sin revisión en curso)", (await page.getByRole("tab", { name: "Detalles" }).getAttribute("aria-selected")) === "true" && (await page.getByTestId("sgc-pestana-detalles").isVisible()));
    check("Detalles: lista etiqueta/valor sin campos vacíos", !(await page.getByTestId("sgc-metadatos").innerText()).includes("—"));
    check("ficha: sin la sección «Eventos de la bitácora»", (await page.getByText("Eventos de la bitácora").count()) === 0 && (await page.getByTestId("sgc-eventos").count()) === 0);
    const indicador = page.getByRole("tablist").locator("span[aria-hidden]").first();
    const antes = await indicador.evaluate((el) => el.style.transform);
    await pestana(page, "Lecturas");
    await page.getByTestId("sgc-distribucion").waitFor();
    check("Lecturas: destinatarios y avance; Detalles oculto", (await page.getByTestId("dist-avance").count()) === 1 && !(await page.getByTestId("sgc-pestana-detalles").isVisible()));
    check("pestañas: el indicador se desliza a la pestaña elegida", (await indicador.evaluate((el) => el.style.transform)) !== antes);
    await page.getByRole("tab", { name: "Lecturas" }).press("ArrowLeft");
    check("pestañas: flechas del teclado", (await page.getByRole("tab", { name: "Revisiones" }).getAttribute("aria-selected")) === "true");
    const historial = page.getByTestId("sgc-historial");
    check("Revisiones: historial plegado por omisión", (await historial.isVisible()) && (await historial.getAttribute("open")) === null);
    await historial.locator("summary").first().click();
    await page.getByTestId("sgc-historial-fila").first().waitFor();
    check("Revisiones: al desplegar, las revisiones con su estado", (await page.getByTestId("sgc-historial-fila").count()) >= 1);
    // Ver en Auditoria (Ana ve la bitacora): abre Auditoría filtrada por el documento.
    await (await accion(page, "sgc-ver-auditoria")).click();
    await page.waitForURL((u) => u.pathname === "/auditoria" && u.searchParams.get("buscar") === `FX-TCI-D${stamp}`);
    await page.getByPlaceholder(/Buscar/).first().waitFor();
    check("«Ver en Auditoría» abre la bitácora buscando la clave del documento", (await page.getByPlaceholder(/Buscar/).first().inputValue()) === `FX-TCI-D${stamp}`);
  });

  await paso("ana", "ficha con trabajo en curso abre en Revisiones", async (page) => {
    await api("POST", `/sgc/documentos/${D.id}/revisiones`, { motivo_cambio: "Actualización en curso", ...responsables }, t.ana);
    await page.goto(`${BASE}/documentos/${D.id}`);
    await page.getByTestId("sgc-en-curso").waitFor();
    check("con revisión en curso la ficha abre en Revisiones (en curso arriba)", (await page.getByRole("tab", { name: "Revisiones" }).getAttribute("aria-selected")) === "true");
    check("aviso de revisión en curso en la franja delgada", /Revisión 2 en curso/.test(await page.getByTestId("sgc-avisos").innerText()));
  });

  /* ---------- Oscuro, tableta y movimiento reducido ---------- */
  await paso(
    "ana",
    "oscuro y tableta",
    async (page) => {
      await page.goto(`${BASE}/documentos/explorar?area=TC`);
      await page.getByTestId("sgc-tarjetas").waitFor();
      const tema = await page.evaluate(() => document.documentElement.dataset.theme || "");
      const sup = await fondo(page.getByTestId("sgc-tarjeta").first());
      const m = /rgba?\((\d+), (\d+), (\d+)/.exec(sup);
      check("oscuro: tarjetas sobre la superficie oscura", tema === "dark" && !!m && Number(m[1]) + Number(m[2]) + Number(m[3]) < 200, `${tema} ${sup}`);
      check("tableta: carpeta sin desbordes", await sinDesborde(page));
      await page.goto(`${BASE}/documentos/${D.id}`);
      await page.getByTestId("sgc-ficha").waitFor();
      check("tableta: ficha sin desbordes", await sinDesborde(page));
      check("tableta: pestañas visibles", await page.getByRole("tablist").isVisible());
      await page.goto(`${BASE}/documentos`);
      await page.getByTestId("sgc-carpetas").waitFor();
      check("tableta: inicio sin desbordes", await sinDesborde(page));
    },
    { colorScheme: "dark", viewport: { width: 820, height: 1180 }, hasTouch: true },
  );
  await paso(
    "ana",
    "movimiento reducido",
    async (page) => {
      await page.goto(`${BASE}/documentos/explorar?area=TC`);
      const d = tarjeta(page, `FX-TCI-D${stamp}`);
      await d.waitFor();
      const li = d.locator("xpath=..");
      check("reduced-motion: tarjetas sin entrada escalonada", (await li.evaluate((el) => getComputedStyle(el).animationName)) === "none");
      await d.hover();
      await page.waitForTimeout(250);
      check("reduced-motion: la tarjeta no se eleva", !(await elevada(d)));
      await page.goto(`${BASE}/documentos/${D.id}`);
      await page.getByTestId("sgc-ficha").waitFor();
      const etiqueta = page.getByTestId("sgc-ficha").locator(".transicion-estado").first();
      check("reduced-motion: la etiqueta de estado no anima", (await etiqueta.evaluate((el) => getComputedStyle(el).animationName)) === "none");
    },
    { reducedMotion: "reduce" },
  );
} finally {
  await browser.close();
}

check("sin errores de consola", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
terminar();
