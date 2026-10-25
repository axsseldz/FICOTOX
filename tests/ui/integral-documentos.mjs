/*
 * Prueba integral · Documentos SGC en pantalla (Playwright). Bugs corregidos en la prueba integral:
 * - la línea de tiempo de un externo mostraba las claves crudas (externo_registrar, externo_version…);
 * - con la primera revisión rechazada, «Nueva revisión» estaba deshabilitada («completa la revisión en curso»);
 * - al editar los metadatos de un externo se ofrecía dejarlo «Sin asignar» (sin responsable de seguimiento);
 * - el archivo de apoyo de una solicitud se descargaba como «apoyo-solicitud-N», sin extensión;
 * - en «Nueva solicitud», los radios del tipo de solicitud y el selector del tipo documental compartían «sol-tipo».
 * Sin errores de consola ni respuestas 5xx.
 */
import "../lib/reauth-auto.mjs";

process.env.BASE = `${(process.env.BASE || "http://localhost:3100").replace(/\/api$/, "")}/api`;
const { abrirNavegador, BASE_WEB } = await import("../lib/navegador.mjs");
const { api, crearCheck, credenciales, EMAIL, enDias, sesiones } = await import("../lib/calidad.mjs");
const { pdfConTexto } = await import("../lib/archivos.mjs");
const { abrirMenu, cerrarMenu } = await import("../lib/ficha.mjs");

const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const nav = await abrirNavegador({ suite: "integral-documentos", check, credencial: (quien) => ({ email: EMAIL[quien], password: credenciales[EMAIL[quien]] }) });
const { paso } = nav;
const s5 = Date.now().toString(36).slice(-4).toUpperCase();
const responsables = { elaborador_id: id.luis, revisor_id: id.gabriela, autorizador_id: id.patricia };

/* ---------- Datos ---------- */
// Externo con una segunda versión (línea de tiempo con externo_registrar y externo_version).
const fdE = new FormData();
for (const [k, v] of Object.entries({ identificador: `NMX-UI-${s5}-2018`, titulo: `Norma de pantalla ${s5}`, area_codigo: "GC", tipo_codigo: "R", fuente: "IMNC", version_fecha: "2018", responsable_id: id.ricardo, ultima_verificacion: enDias(0), proxima_revision: enDias(365) })) fdE.append(k, String(v));
fdE.append("archivo_pdf", new Blob([await pdfConTexto(1, `Norma ${s5}`)]), "norma.pdf");
const E = (await api("POST", "/sgc/externos", fdE, t.ana)).data?.id;
const fdV = new FormData();
for (const [k, v] of Object.entries({ version_fecha: "2025", ultima_verificacion: enDias(0), proxima_revision: enDias(365), comentario: "Nueva edición" })) fdV.append(k, v);
fdV.append("archivo_pdf", new Blob([await pdfConTexto(1, `Norma 2025 ${s5}`)]), "norma-2025.pdf");
const ver = await api("POST", `/sgc/externos/${E}/version`, fdV, t.ana);

// Documento nuevo con su primera revisión rechazada.
const fdN = new FormData();
for (const [k, v] of Object.entries({ clave: `FX-TCP-U${s5}`, titulo: `Procedimiento rechazado ${s5}`, area_codigo: "TC", tipo_codigo: "P", ...responsables })) fdN.append(k, String(v));
fdN.append("archivo_pdf", new Blob([await pdfConTexto(1, `Rechazado ${s5}`)]), "inicial.pdf");
const N = (await api("POST", "/sgc/documentos", fdN, t.ana)).data;
await api("PUT", `/sgc/revisiones/${N?.revision_id}`, { apartados_afectados: "Todo", descripcion_cambio: "Emisión inicial" }, t.luis);
await api("POST", `/sgc/revisiones/${N?.revision_id}/enviar-revision`, {}, t.luis);
const rech = await api("POST", `/sgc/revisiones/${N?.revision_id}/revisar`, { decision: "rechazar", comentario: "No corresponde a un procedimiento" }, t.gabriela);

// Solicitud con archivo de apoyo.
const fdS = new FormData();
for (const [k, v] of Object.entries({ tipo: "nuevo", area_codigo: "GC", tipo_codigo: "F", titulo_propuesto: `Formato con apoyo ${s5}`, justificacion: "Se adjunta el borrador del formato" })) fdS.append(k, v);
fdS.append("archivo", new Blob([await pdfConTexto(1, `Apoyo ${s5}`)]), "borrador-formato.pdf");
const sol = await api("POST", "/sgc/solicitudes", fdS, t.mariana);

check("(preparación) datos de documentos", !!E && ver.status === 201 && rech.status === 200 && sol.status === 201, `${E} ${ver.status} ${rech.status} ${sol.status}`);

/* ---------- Externo: línea de tiempo y metadatos ---------- */
await paso("ana", "externo: línea de tiempo y responsable", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${E}`);
  await page.locator('[data-testid="sgc-ficha"]:not([aria-busy="true"])').waitFor();
  await page.getByRole("tab", { name: /Revisiones/ }).click();
  const lineas = page.locator('[data-testid="sgc-linea-tiempo"]');
  await lineas.first().waitFor({ state: "attached" });
  const texto = (await lineas.allTextContents()).join(" ");
  check("la línea de tiempo dice «Registró el documento externo» y «Registró una nueva versión» (sin claves crudas)", /Registró el documento externo/.test(texto) && /Registró una nueva versión/.test(texto) && !/externo_(registrar|version|verificar)/.test(texto), texto.slice(0, 200));
  await abrirMenu(page);
  await page.getByRole("menu").getByTestId("sgc-editar").click();
  const selector = page.locator("#ficha-propietario");
  await selector.waitFor({ state: "attached" });
  const opciones = (await selector.locator("option").allTextContents()).map((x) => x.trim());
  check("al editar un externo no se ofrece «Sin asignar»", opciones.length > 0 && !opciones.includes("Sin asignar"), opciones.join(", "));
});

/* ---------- Primera revisión rechazada ---------- */
await paso("ana", "documento con la primera revisión rechazada", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${N?.id}`);
  await page.locator('[data-testid="sgc-ficha"]:not([aria-busy="true"])').waitFor();
  await abrirMenu(page);
  const item = page.getByRole("menu").getByTestId("sgc-nueva-revision");
  const disponible = (await item.count()) === 1 && (await page.getByRole("menu").getByTestId("sgc-nueva-revision-motivo").count()) === 0 && (await item.getAttribute("aria-disabled")) !== "true";
  check("«Nueva revisión» está disponible para abrir otra", disponible, `${await item.count()} ${await item.getAttribute("aria-disabled")}`);
  await cerrarMenu(page);
});

/* ---------- Solicitudes ---------- */
await paso("ana", "solicitudes: archivo de apoyo y formulario", async (page, { descargas }) => {
  await page.goto(`${BASE_WEB}/documentos/solicitudes`);
  const fila = page.locator(`[data-solicitud="${sol.data?.id}"]`);
  await fila.waitFor();
  await fila.getByRole("button", { name: `Más acciones de la solicitud ${sol.data?.id}` }).click();
  const espera = page.waitForEvent("download");
  await page.getByTestId("sgc-solicitud-apoyo").click();
  await espera;
  check("el apoyo se descarga con su nombre original (con extensión)", descargas.includes("borrador-formato.pdf"), descargas.join(", "));
  await page.keyboard.press("Escape");
  await page.goto(`${BASE_WEB}/documentos/solicitudes`);
  await page.getByTestId("sgc-nueva-solicitud").click();
  await page.locator('input[type="radio"][name="sol-clase"]').first().waitFor({ state: "attached" });
  check("los radios del tipo de solicitud ya no comparten nombre con el selector #sol-tipo", (await page.locator('[name="sol-tipo"]').count()) === 0 && (await page.locator('input[type="radio"][name="sol-clase"]').count()) === 2);
});

await nav.cerrar();
terminar();
