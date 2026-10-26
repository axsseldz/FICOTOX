/*
 * Prueba integral · Calidad en pantalla (Playwright). Bugs corregidos en la prueba integral:
 * - tras una verificación eficaz, la NC dice «Eficacia verificada…» (antes «Pendiente: la verifica…» y,
 *   para otra persona con calidad:R, el formulario para verificar otra vez);
 * - quien suspendió y tiene aprobada la excepción de la regla 10 ve «Reanudar…» (antes solo «Solicitar excepción…»,
 *   que daba 409: no había forma de reanudar desde la pantalla);
 * - la ventana de una NC sin acción correctiva dice «No requiere acción correctiva.» (comparaba con 0);
 * - en la ventana de la NC, una incidencia ajena restringida ya no es un enlace a un 404;
 * - «Por autorizar»: la excepción para reanudar una suspensión lleva a su NC;
 * - Auditoría: las migraciones 14–26 dicen para qué fueron.
 * Sin errores de consola ni respuestas 5xx.
 */
import "../lib/reauth-auto.mjs";

process.env.BASE = `${(process.env.BASE || "http://localhost:3100").replace(/\/api$/, "")}/api`;
const { abrirNavegador, BASE_WEB } = await import("../lib/navegador.mjs");
const { api, crearCheck, credenciales, EMAIL, enDias, fila, sesiones } = await import("../lib/calidad.mjs");

const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const nav = await abrirNavegador({ suite: "integral-calidad", check, credencial: (quien) => ({ email: EMAIL[quien], password: credenciales[EMAIL[quien]] }) });
const { paso } = nav;
const SIN_APROBAR = { "X-Sin-Aprobar-Auto": "1" };
// La ficha abre «Paso a paso» con las secciones plegadas: «Todo» las muestra.
const todo = async (page) => {
  const radio = page.getByRole("radio", { name: "Todo" });
  await radio.waitFor();
  if ((await radio.getAttribute("aria-checked")) !== "true") await radio.click();
};

/* ---------- Datos ---------- */
// NC verificada como eficaz (acción de Luis, verifica Ana).
const NV = (await api("POST", "/calidad/nc", { origen: "otro", descripcion: "NC UI integral: eficacia ya verificada", responsable_id: id.ricardo }, t.ana)).data?.id;
await api("PUT", `/calidad/nc/${NV}`, { afecta_resultados_emitidos: "no", trabajo_detenido: "no", notificar_cliente: "no", metodo_causa: "otro", causa_raiz: "Causa documentada para la prueba de pantalla", requiere_accion_correctiva: "si" }, t.ricardo);
await api("POST", `/calidad/nc/${NV}/avanzar`, { a: "en_analisis" }, t.ricardo);
const acc = (await api("POST", `/calidad/nc/${NV}/acciones`, { descripcion: "Acción de la prueba de pantalla", responsable_id: id.luis, fecha_compromiso: enDias(5) }, t.ricardo)).data?.id;
await api("POST", `/calidad/nc/${NV}/avanzar`, { a: "acciones_en_curso" }, t.ricardo);
await api("POST", `/calidad/acciones/${acc}/implementar`, { descripcion_implementacion: "Implementada para la prueba de pantalla" }, t.luis);
await api("POST", `/calidad/nc/${NV}/avanzar`, { a: "en_verificacion" }, t.ricardo);
const ver = await api("POST", `/calidad/nc/${NV}/verificar`, { resultado: "eficaz", comentarios: "Registros revisados en la prueba de pantalla" }, t.ana);

// NC con una suspensión de Patricia y su excepción aprobada; otra suspensión con la excepción pendiente.
const NS = (await api("POST", "/calidad/nc", { origen: "otro", descripcion: "NC UI integral: suspensión con excepción", responsable_id: id.ricardo }, t.ana)).data?.id;
await api("POST", `/calidad/nc/${NS}/suspensiones`, { tipo: "metodo", clave: "ASP", motivo: "Prueba de pantalla: método detenido" }, t.patricia);
const SU = fila("SELECT id FROM suspensiones WHERE nc_id = ? AND reanudada_en IS NULL", NS)?.id;
const exc = await api("POST", "/solicitudes", { tipo: "excepcion_segregacion", entidad: "suspensiones", entidad_id: SU, accion: "reanudar", motivo: "Mejora Continua fuera esta semana" }, t.patricia);
const NP = (await api("POST", "/calidad/nc", { origen: "otro", descripcion: "NC UI integral: excepción pendiente", responsable_id: id.ricardo }, t.ana)).data?.id;
await api("POST", `/calidad/nc/${NP}/suspensiones`, { tipo: "equipo", clave: String(fila("SELECT id FROM equipos WHERE activo = 1 ORDER BY id DESC LIMIT 1")?.id), motivo: "Prueba de pantalla: equipo detenido" }, t.patricia);
const SP = fila("SELECT id FROM suspensiones WHERE nc_id = ? AND reanudada_en IS NULL", NP)?.id;
const pend = await api("POST", "/solicitudes", { tipo: "excepcion_segregacion", entidad: "suspensiones", entidad_id: SP, accion: "reanudar", motivo: "Mejora Continua fuera esta semana" }, t.patricia, SIN_APROBAR);
const SOL = pend.data?.id || fila("SELECT id FROM solicitudes_autorizacion WHERE entidad = 'suspensiones' AND entidad_id = ? AND estado = 'pendiente'", String(SP))?.id;

// NC sin acción correctiva.
const NN = (await api("POST", "/calidad/nc", { origen: "otro", descripcion: "NC UI integral: no requiere acción correctiva", responsable_id: id.ricardo }, t.ana)).data?.id;
await api("PUT", `/calidad/nc/${NN}`, { requiere_accion_correctiva: "no", justificacion_sin_accion: "Hecho aislado sin riesgo de repetirse" }, t.ricardo);

// Incidencia de Mariana escalada a una NC con una acción de Luis: Luis ve la NC, no la incidencia ajena.
const inc = await api("POST", "/calidad/incidencias", { tipo: "otro", fecha_hora_ocurrencia: new Date().toISOString(), descripcion: "Incidencia de Mariana para la prueba de pantalla", impacto_resultados: "no" }, t.mariana);
await api("POST", `/calidad/incidencias/${inc.data?.id}/evaluacion`, {}, t.ricardo);
const esc = await api("POST", `/calidad/incidencias/${inc.data?.id}/evaluar`, { decision: "escalar", justificacion: "Conviene analizarla como no conformidad", nc: { clasificacion: "menor", requisito_incumplido: "ISO/IEC 17025 7.10" } }, t.ricardo);
const NI = esc.data?.nc_id;
await api("PUT", `/calidad/nc/${NI}`, { responsable_id: id.ricardo }, t.ana);
await api("PUT", `/calidad/nc/${NI}`, { afecta_resultados_emitidos: "no", trabajo_detenido: "no", notificar_cliente: "no", metodo_causa: "otro", causa_raiz: "Causa documentada para la prueba de pantalla", requiere_accion_correctiva: "si" }, t.ricardo);
await api("POST", `/calidad/nc/${NI}/avanzar`, { a: "en_analisis" }, t.ricardo);
await api("POST", `/calidad/nc/${NI}/acciones`, { descripcion: "Acción de Luis en la NC escalada", responsable_id: id.luis, fecha_compromiso: enDias(6) }, t.ricardo);

check("(preparación) datos de calidad", ver.status === 200 && exc.status === 200 && !!SOL && !!NN && !!NI, `${ver.status} ${exc.status} ${SOL} ${NN} ${NI} ${pend.status} ${esc.status}`);

/* ---------- Verificación eficaz ---------- */
await paso("patricia", "NC verificada como eficaz", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/nc/${NV}`);
  await todo(page);
  const aviso = page.locator("[data-verificada]");
  await aviso.waitFor();
  check("la NC dice «Eficacia verificada» y no ofrece verificar otra vez", /Eficacia verificada/.test(await aviso.innerText()) && (await page.getByRole("button", { name: /^Registrar verificación|^Verificar/ }).count()) === 0);
});

/* ---------- Reanudar con la excepción ---------- */
await paso("patricia", "suspensión con la excepción de la regla 10", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/nc/${NS}`);
  await todo(page);
  const su = page.locator(`[data-suspension="${SU}"]`);
  await su.waitFor();
  check("con la excepción aprobada ofrece «Reanudar…» y no «Solicitar excepción…»", (await su.getByRole("button", { name: /Reanudar/ }).count()) === 1 && (await su.getByRole("button", { name: /Solicitar excepción/ }).count()) === 0, (await su.innerText()).replace(/\s+/g, " "));
  await page.goto(`${BASE_WEB}/calidad/nc/${NP}`);
  await todo(page);
  const sp = page.locator(`[data-suspension="${SP}"]`);
  await sp.waitFor();
  check("sin la excepción aprobada sigue «Solicitar excepción…»", (await sp.getByRole("button", { name: /Solicitar excepción/ }).count()) === 1);
});

/* ---------- Ventana de la NC ---------- */
await paso("ana", "ventana de una NC sin acción correctiva", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/incidencias?tipos=nc`);
  await page.locator(`[data-nc="${NN}"]`).click();
  const ventana = page.getByRole("dialog");
  await ventana.waitFor();
  await ventana.getByText(/No requiere acción correctiva\.|Todavía no hay acciones definidas\./).first().waitFor();
  check("dice «No requiere acción correctiva.»", (await ventana.getByText("No requiere acción correctiva.").count()) === 1);
});

await paso("luis", "ventana de una NC con una incidencia ajena", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/incidencias?tipos=nc`);
  await page.locator(`[data-nc="${NI}"]`).click();
  const ventana = page.getByRole("dialog");
  await ventana.waitFor();
  const restringida = ventana.locator("[data-incidencia-restringida]");
  await restringida.first().waitFor();
  check("la incidencia ajena se muestra sin enlace (antes llevaba a un 404)", (await ventana.locator(`a[href="/calidad/incidencias/${inc.data?.id}"]`).count()) === 0);
});

/* ---------- Por autorizar ---------- */
await paso("ana", "la excepción de una suspensión lleva a su NC", async (page) => {
  await page.goto(`${BASE_WEB}/solicitudes?abrir=${SOL}`);
  const ficha = page.locator(`[data-solicitud-ventana="${SOL}"]`);
  await ficha.waitFor();
  check("«Por autorizar» enlaza la NC de la suspensión", (await ficha.locator(`a[href="/calidad/nc/${NP}"]`).count()) === 1, await ficha.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")).join(" ")));
});

/* ---------- Auditoría ---------- */
await paso("patricia", "Auditoría: para qué fue cada migración", async (page) => {
  await page.goto(`${BASE_WEB}/auditoria?periodo=todo&buscar=${encodeURIComponent("Migración 26")}`);
  const filaMig = page.locator("[data-actividad]").first();
  await filaMig.waitFor();
  await filaMig.click();
  const detalle = page.locator("[data-actividad-detalle]");
  await detalle.waitFor();
  check("la migración 26 dice para qué fue", /correcciones de la primera versión/.test(await detalle.innerText()), (await detalle.innerText()).replace(/\s+/g, " ").slice(0, 200));
});

// Distribución de Documentos SGC (la deja api-documentos-fase3 en la corrida completa): antes «hizo un cambio en…».
const distribucion = fila("SELECT referencia FROM auditoria WHERE accion = 'distribuir' ORDER BY id DESC LIMIT 1");
if (distribucion) {
  await paso("patricia", "Auditoría: distribución de un documento", async (page) => {
    await page.goto(`${BASE_WEB}/auditoria?periodo=todo&buscar=${encodeURIComponent(distribucion.referencia)}`);
    const filaDist = page.locator("[data-actividad]").filter({ hasText: /distribuyó/ }).first();
    await filaDist.waitFor();
    check("la distribución se describe («distribuyó …»), no «hizo un cambio»", true);
  });
} else check("(sin distribuciones en la base: corre después de api-documentos-fase3)", true);

await nav.cerrar();

// Limpieza: el método ASP y el equipo no pueden quedar suspendidos para las suites siguientes (el E2E extrae con ASP).
// Reanuda Mejora Continua (no quien suspendió); antes se rechaza la excepción pendiente.
if (SOL) await api("POST", `/solicitudes/${SOL}/rechazar`, { motivo: "Limpieza de la prueba de pantalla" }, t.ana);
for (const su of [SU, SP]) if (su) await api("POST", `/calidad/suspensiones/${su}/reanudar`, { motivo: "Fin de la prueba de pantalla" }, t.ana);
check("(limpieza) sin suspensiones activas de esta suite", !fila("SELECT id FROM suspensiones WHERE id IN (?, ?) AND reanudada_en IS NULL", SU || 0, SP || 0));
terminar();
