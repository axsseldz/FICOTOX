/*
 * Prueba integral · Muestras e Informes en pantalla (Playwright), con las cuentas de cada rol:
 * - rechazo de una recepción por el Técnico Auxiliar: «Guardar y solicitar» y la Coord. Técnica lo aprueba en «Por autorizar»;
 * - disposición de una muestra rechazada (sin informe, con motivo), reapertura y nueva disposición
 *   (antes la ficha reabierta ya no ofrecía registrarla: bug corregido);
 * - cambio de folio con segundo usuario; con la solicitud pendiente la lista ya no ofrece «Cambiar folio…» (bug corregido);
 * - el procesamiento solo ofrece recepciones aceptadas (bug corregido);
 * - «Marcar revisado» solo con el análisis enviado a revisión (bug corregido);
 * - «Por supervisar»: visto bueno y regreso de lo que captura el estudiante;
 * - enmienda de un análisis aprobado y anulación con segundo usuario.
 * Sin errores de consola ni respuestas 5xx en ninguna pantalla.
 */
import "../lib/reauth-auto.mjs";

// BASE es la web (como en las demás suites de navegador); la API de apoyo va en /api.
process.env.BASE = `${(process.env.BASE || "http://localhost:3100").replace(/\/api$/, "")}/api`;
const { aprobarEnPorAutorizar, abrirNavegador, BASE_WEB, contrasena, dialogoMotivo, esperar, firmar, mostrarTodo, toast } = await import("../lib/navegador.mjs");
const { analisisDe, api, cadena, crearCheck, credenciales, EMAIL, fila, hoy, sesiones } = await import("../lib/calidad.mjs");

const { check, terminar } = crearCheck();
const { t } = await sesiones();
const pwd = (quien) => (quien === "qa" ? "QaFicotox2026!" : credenciales[EMAIL[quien]]);
const nav = await abrirNavegador({ suite: "integral-muestras", check, credencial: (quien) => ({ email: quien === "qa" ? "qa@ficotox.local" : EMAIL[quien], password: pwd(quien) }) });
const { paso } = nav;
const sello = Date.now().toString(36).slice(-5);
const recepcion = (rid) => api("GET", `/samples/reception/${rid}`, undefined, t.qa).then((r) => r.data?.item);
const pendienteDe = (entidad, entidadId) => fila("SELECT id, tipo FROM solicitudes_autorizacion WHERE entidad = ? AND entidad_id = ? AND estado = 'pendiente' ORDER BY id DESC", entidad, String(entidadId));
const inspeccion = (nc) => ({ checklist: Array.from({ length: 7 }, (_, i) => ({ requisito: `Requisito ${i + 1}`, estado: nc && i === 0 ? "NC" : i === 6 ? "NA" : "C", observacion: nc && i === 0 ? "Temperatura fuera de rango" : null })), observaciones_generales: null });
const datosRecepcion = (idInt, extra = {}) => ({ fecha_recepcion: hoy(), hora_recepcion: "09:00", recibido_por: "QA", medio_recepcion: "directa", solicitante: `Cliente integral ${idInt}`, muestra_unica: true, id_interno: idInt, fecha_muestra: hoy(), analisis: { tipos: ["toxinas_lipofilicas"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] }, inspeccion: inspeccion(false), ...extra });

/* ---------- Rechazo en pantalla por quien no decide (segundo usuario) ---------- */
const ID_RECH = `RECH-${sello}`;
let R_RECH = null;
await paso("mariana", "rechazo de recepción: el Técnico Auxiliar guarda y solicita", async (page) => {
  await page.goto(`${BASE_WEB}/muestras/recepcion/nueva`);
  await page.locator("#r-folio").waitFor();
  await mostrarTodo(page);
  await page.fill("#r-fecha", hoy());
  await page.fill("#r-id", ID_RECH);
  await page.selectOption("#r-medio", { index: 1 });
  await page.fill("#r-solicitante", `Cooperativa rechazo ${sello}`);
  await page.getByLabel("Ácido domoico (ASP)").check();
  await page.getByLabel("Cromatografía de líquidos").check();
  await page.getByLabel("Organismo completo").check();
  const grupos = page.locator('#sec-inspeccion [role="radiogroup"]');
  const n = await grupos.count();
  for (let i = 0; i < n; i += 1) await grupos.nth(i).getByRole("radio", { name: i === 0 ? "NC" : "C", exact: true }).click();
  await page.locator("#r-decision").getByRole("radio", { name: /^Rechazada/ }).check();
  await page.fill("#r-acep-fecha", hoy());
  const opciones = await page.locator("#r-acep-resp option").allTextContents();
  const responsable = opciones.find((o) => o.includes("Mariana")) || opciones.find((o) => o.trim() && !/Selecciona|Elige/.test(o));
  if (responsable) await page.locator("#r-acep-resp").selectOption({ label: responsable });
  await page.fill("#r-com-fecha", hoy());
  await page.selectOption("#r-com-medio", { index: 1 });
  await page.fill("#r-sol-nombre", "Juan Pérez");
  await firmar(page, "Firma de conformidad del solicitante");
  await page.getByLabel(/He revisado la información/).check();
  await page.getByRole("radio", { name: /^Congelador/ }).check();
  await firmar(page, "Firma · Custodio");
  await page.getByRole("button", { name: "Registrar recepción" }).click();
  await page.getByRole("button", { name: "Guardar y solicitar" }).click();
  await page.waitForURL((url) => url.pathname === "/muestras/recepcion");
  const r = ((await api("GET", `/samples/reception?search=${ID_RECH}`, undefined, t.qa)).data?.items || [])[0];
  R_RECH = r?.id;
  const sol = R_RECH ? pendienteDe("muestras_recepcion", R_RECH) : null;
  check("rechazo del Técnico Auxiliar: se guarda sin decisión y queda la solicitud", !!r && !r.decision_aceptacion && sol?.tipo === "decision_recepcion", `${r?.decision_aceptacion} ${JSON.stringify(sol)}`);
});
await paso("ricardo", "rechazo aprobado en «Por autorizar» por la Coord. Técnica", async (page) => {
  const sol = pendienteDe("muestras_recepcion", R_RECH);
  await aprobarEnPorAutorizar(page, sol.id, "Confirmado: llegó a 15 °C", pwd("ricardo"));
  const r = await recepcion(R_RECH);
  check("la recepción queda rechazada", r?.decision_aceptacion === "rechazada" && r?.estado === "rechazada", `${r?.decision_aceptacion} ${r?.estado}`);
  check("…y la incidencia automática del rechazo existe", !!fila("SELECT id FROM incidencias WHERE origen_automatico IS NOT NULL AND clave_automatica LIKE ?", `%${R_RECH}%`));
});

/* ---------- Disposición de la rechazada, reapertura y nueva disposición ---------- */
const disponer = async (page, motivo) => {
  await page.goto(`${BASE_WEB}/muestras/recepcion/${R_RECH}`);
  await mostrarTodo(page);
  const opcion = page.locator('label:has(input[name="r-disp"])').first();
  await opcion.scrollIntoViewIfNeeded();
  await opcion.click();
  // La etiqueta apunta al área de texto (antes el id estaba repetido en un contenedor y la etiqueta no llevaba al campo).
  await page.getByLabel("Motivo de la disposición").fill(motivo);
  await page.getByRole("button", { name: "Registrar disposición y cerrar la muestra" }).click();
  await contrasena(page, pwd("ricardo"));
  await toast(page, /cerrada|disposici/i);
};
await paso("ricardo", "disposición de una muestra rechazada (sin informe, con motivo)", async (page) => {
  await disponer(page, "Muestra rechazada en la recepción: se desecha como RPBI");
  check("la muestra rechazada queda cerrada con su disposición", (await recepcion(R_RECH))?.estado === "cerrada");
  await page.goto(`${BASE_WEB}/muestras/recepcion/${R_RECH}`);
  await page.getByRole("button", { name: "Reabrir…" }).click();
  await dialogoMotivo(page, "Se dispuso con el tipo equivocado", "Reabrir", pwd("ricardo"));
  await toast(page, /reabierta/i);
  const r = await recepcion(R_RECH);
  check("reabrir: vuelve a rechazada y conserva la disposición anterior", r?.estado === "rechazada" && !!r?.disposicion, `${r?.estado} ${JSON.stringify(r?.disposicion)?.slice(0, 60)}`);
  await page.goto(`${BASE_WEB}/muestras/recepcion/${R_RECH}`);
  await mostrarTodo(page);
  await page.getByTestId("disposicion-anterior").waitFor();
  check("la ficha reabierta avisa de la disposición anterior y ofrece registrar otra", (await page.getByRole("button", { name: "Registrar disposición y cerrar la muestra" }).count()) === 1);
  await disponer(page, "Se corrige el tipo de disposición de la muestra rechazada");
  check("nueva disposición: la muestra vuelve a cerrarse", (await recepcion(R_RECH))?.estado === "cerrada");
  check("…y las dos disposiciones quedan en la bitácora", Number(fila("SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'muestras_recepcion' AND entidad_id = ? AND accion = 'cerrar'", String(R_RECH)).n) === 2);
});

/* ---------- Cambio de folio con segundo usuario ---------- */
const ID_FOL = `FOLU-${sello}`;
const R_FOL = (await api("POST", "/samples/reception", datosRecepcion(ID_FOL), t.mariana)).data?.id;
const nuevoFolio = 700000 + (Date.now() % 90000);
await paso("mariana", "cambio de folio solicitado por el Técnico Auxiliar", async (page) => {
  await page.goto(`${BASE_WEB}/muestras/recepcion`);
  await page.getByPlaceholder("Buscar por folio, solicitante o ID interno").fill(ID_FOL);
  const renglon = page.locator("tbody tr").filter({ hasText: ID_FOL }).first();
  await renglon.getByRole("button", { name: "Acciones" }).click();
  await page.getByRole("menuitem", { name: "Cambiar folio…" }).click();
  await dialogoMotivo(page, String(nuevoFolio), "Continuar");
  await dialogoMotivo(page, "El folio en papel ya se había usado", "Cambiar folio", pwd("mariana"));
  await toast(page, /solicitud|autoriz/i);
  check("el cambio de folio queda como solicitud (sin muestras:A)", pendienteDe("muestras_recepcion", R_FOL)?.tipo === "cambiar_folio");
  await page.reload();
  await page.getByPlaceholder("Buscar por folio, solicitante o ID interno").fill(ID_FOL);
  const otra = page.locator("tbody tr").filter({ hasText: ID_FOL }).first();
  await otra.getByRole("button", { name: "Acciones" }).click();
  await page.getByRole("menuitem", { name: "Abrir" }).waitFor();
  check("con la solicitud pendiente la lista ya no ofrece «Cambiar folio…»", (await page.getByRole("menuitem", { name: "Cambiar folio…" }).count()) === 0);
  await page.keyboard.press("Escape");
});
await paso("ricardo", "cambio de folio aprobado", async (page) => {
  await aprobarEnPorAutorizar(page, pendienteDe("muestras_recepcion", R_FOL).id, "Verificado contra la libreta", pwd("ricardo"));
  check("el folio cambió al aprobarse", Number((await recepcion(R_FOL))?.folio_num) === nuevoFolio, String((await recepcion(R_FOL))?.folio_num));
});

/* ---------- Procesamiento: solo recepciones aceptadas ---------- */
const aceptada = await cadena(t, `ACEP-${sello}`);
await paso("ricardo", "el procesamiento solo ofrece recepciones aceptadas", async (page) => {
  await page.goto(`${BASE_WEB}/muestras/procesamiento/nuevo`);
  const select = page.locator("#p-recepcion");
  await select.waitFor();
  await esperar(async () => (await select.locator("option").count()) > 1);
  const valores = await select.locator("option").evaluateAll((os) => os.map((o) => o.getAttribute("value")));
  check("la recepción rechazada no se ofrece", !valores.includes(String(R_RECH)), `${valores.length} opciones`);
  check("la registrada sin decisión no se ofrece", !valores.includes(String(R_FOL)));
  check("la aceptada sí", valores.includes(String(aceptada.R)));
});

/* ---------- Análisis: revisar solo lo enviado, enmienda y anulación ---------- */
const A_REG = (await api("POST", "/samples/analysis", analisisDe(aceptada), t.qa)).data?.id;
await paso("ricardo", "«Marcar revisado» solo con el análisis enviado a revisión", async (page) => {
  await page.goto(`${BASE_WEB}/muestras/analisis/${A_REG}`);
  await page.getByRole("navigation", { name: "Secciones del formato" }).waitFor();
  check("análisis registrado: el revisor no ve «Marcar revisado»", (await page.getByRole("button", { name: "Marcar revisado" }).count()) === 0);
  const env = await api("POST", `/samples/analysis/${A_REG}/enviar-revision`, {}, t.qa);
  check("(apoyo) enviado a revisión", env.status === 200, `${env.status} ${env.data?.message}`);
  await page.reload();
  await page.getByRole("button", { name: "Marcar revisado" }).waitFor();
  check("en revisión: «Marcar revisado» visible", true);
});
const otra = await cadena(t, `ENM-${sello}`);
const A_APR = (await api("POST", "/samples/analysis", analisisDe(otra), t.qa)).data?.id;
for (const paso1 of ["enviar-revision", "revisar", "aprobar"]) await api("POST", `/samples/analysis/${A_APR}/${paso1}`, {}, paso1 === "enviar-revision" ? t.qa : t.ricardo);
await paso("ricardo", "enmienda de un análisis aprobado", async (page) => {
  await page.goto(`${BASE_WEB}/muestras/analisis/${A_APR}`);
  await page.getByRole("button", { name: "Enmendar…" }).click();
  await dialogoMotivo(page, "Se transcribió mal la unidad del resultado", "Crear enmienda");
  await page.waitForURL((url) => /\/muestras\/analisis\/\d+$/.test(url.pathname) && !url.pathname.endsWith(`/${A_APR}`));
  const nuevo = Number(new URL(page.url()).pathname.split("/").pop());
  const fNuevo = fila("SELECT folio_num, version, estado FROM muestras_analisis WHERE id = ?", nuevo);
  const fViejo = fila("SELECT folio_num, version FROM muestras_analisis WHERE id = ?", A_APR);
  check("enmienda: mismo folio, versión siguiente, en captura", fNuevo?.folio_num === fViejo?.folio_num && Number(fNuevo?.version) === Number(fViejo?.version) + 1 && fNuevo?.estado === "registrado", JSON.stringify(fNuevo));
});
const tercera = await cadena(t, `ANU-${sello}`);
const A_ANU = (await api("POST", "/samples/analysis", analisisDe(tercera), t.qa)).data?.id;
for (const paso1 of ["enviar-revision", "revisar", "aprobar"]) await api("POST", `/samples/analysis/${A_ANU}/${paso1}`, {}, paso1 === "enviar-revision" ? t.qa : t.ricardo);
await paso("ricardo", "anular un análisis aprobado queda como solicitud", async (page) => {
  await page.goto(`${BASE_WEB}/muestras/analisis/${A_ANU}`);
  await page.getByRole("button", { name: "Más acciones" }).click();
  await page.getByRole("menuitem", { name: /Anular análisis/ }).click();
  await dialogoMotivo(page, "El extracto se contaminó: el resultado no es válido", "Anular", pwd("ricardo"));
  await toast(page, /solicitud|autoriz/i);
  check("anulación pendiente de un segundo usuario (el análisis sigue aprobado)", pendienteDe("muestras_analisis", A_ANU)?.tipo === "anular_registro" && fila("SELECT estado FROM muestras_analisis WHERE id = ?", A_ANU).estado === "aprobado");
});
await paso("patricia", "anulación del análisis aprobada", async (page) => {
  await aprobarEnPorAutorizar(page, pendienteDe("muestras_analisis", A_ANU).id, "Confirmado con la bitácora del equipo", pwd("patricia"));
  check("el análisis queda anulado", fila("SELECT estado FROM muestras_analisis WHERE id = ?", A_ANU).estado === "anulado");
});

/* ---------- Por supervisar: lo que captura el estudiante ---------- */
const R_EST = (await api("POST", "/samples/reception", datosRecepcion(`EST-${sello}`), t.diego)).data?.id;
const R_EST2 = (await api("POST", "/samples/reception", datosRecepcion(`EST2-${sello}`), t.diego)).data?.id;
check("(apoyo) lo que registra el estudiante queda pendiente de su supervisor", fila("SELECT supervision_estado, supervisor_id FROM muestras_recepcion WHERE id = ?", R_EST)?.supervision_estado === "pendiente");
await paso("ricardo", "«Por supervisar»: visto bueno y regreso", async (page) => {
  await page.goto(`${BASE_WEB}/supervision`);
  const fila1 = page.locator(`[data-supervision="muestras_recepcion-${R_EST}"]`).first();
  await fila1.waitFor();
  await fila1.getByRole("button", { name: /Acciones/ }).click();
  await page.getByRole("menuitem", { name: "Dar visto bueno…" }).click();
  await page.locator("#vb-obs").fill("Revisado contra la hoja de campo");
  await page.locator("#vb-password").fill(pwd("ricardo"));
  await page.getByRole("dialog").getByRole("button", { name: "Dar visto bueno" }).click();
  await toast(page, /visto bueno/i);
  check("visto bueno registrado", fila("SELECT supervision_estado FROM muestras_recepcion WHERE id = ?", R_EST)?.supervision_estado !== "pendiente", fila("SELECT supervision_estado FROM muestras_recepcion WHERE id = ?", R_EST)?.supervision_estado);
  const fila2 = page.locator(`[data-supervision="muestras_recepcion-${R_EST2}"]`).first();
  await fila2.getByRole("button", { name: /Acciones/ }).click();
  await page.getByRole("menuitem", { name: "Regresar…" }).click();
  await dialogoMotivo(page, "Falta el sitio de muestreo", "Regresar con observaciones");
  await toast(page, /regres/i);
  check("regresado al estudiante con observaciones", fila("SELECT supervision_estado FROM muestras_recepcion WHERE id = ?", R_EST2)?.supervision_estado === "regresado");
});
await paso("diego", "el estudiante ve lo regresado", async (page) => {
  await page.goto(`${BASE_WEB}/supervision`);
  await page.locator(`section[aria-labelledby=sup-regresados] [data-supervision="muestras_recepcion-${R_EST2}"]`).first().waitFor();
  check("«Regresados a ti» lista la recepción regresada", true);
});

await nav.cerrar();
terminar();
