/*
 * Cobertura de la matriz · Muestras e Informes en pantalla (Playwright). Cada check lleva la
 * etiqueta [cob:M:<id>] del elemento de interfaz que prueba: reglas del formulario (pop-up
 * «Faltan…»), campos que se guardan, menús y opciones por estado y permiso, avisos y visor.
 * Datos propios con sello único; las solicitudes que quedan pendientes se cancelan al final.
 * Sin errores de consola ni respuestas 5xx en ninguna pantalla.
 */
import "../lib/reauth-auto.mjs";

// BASE es la web (como en las demás suites de navegador); la API de apoyo va en /api.
process.env.BASE = `${(process.env.BASE || "http://localhost:3100").replace(/\/api$/, "")}/api`;
const { abrirNavegador, BASE_WEB, contrasena, entendido, esperar, firmar, mostrarTodo, toast } = await import("../lib/navegador.mjs");
const { analisisDe, api, cadena, crearCheck, credenciales, Database, EMAIL, fila, hoy, informeLiberado, sesiones } = await import("../lib/calidad.mjs");
const { liberar } = await import("../lib/envio.mjs");

const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const pwd = (quien) => (quien === "qa" ? "QaFicotox2026!" : credenciales[EMAIL[quien]]);
const nav = await abrirNavegador({ suite: "cobertura-muestras", check, credencial: (quien) => (typeof quien === "object" ? quien : { email: quien === "qa" ? "qa@ficotox.local" : EMAIL[quien], password: pwd(quien) }) });
const { paso } = nav;
const s5 = Date.now().toString(36).slice(-5);
const SIN_APROBAR = { "X-Sin-Aprobar-Auto": "1" };
const ejecutar = (sql, ...p) => {
  const b = new Database(process.env.TEST_DB_PATH);
  try {
    b.prepare(sql).run(...p);
  } finally {
    b.close();
  }
};
const FIRMA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const insp = (nc) => ({ checklist: Array.from({ length: 7 }, (_, i) => ({ requisito: `Requisito ${i + 1}`, estado: nc && i === 0 ? "NC" : i === 6 ? "NA" : "C", observacion: null })), observaciones_generales: null });
const ACEPTACION = { fecha: hoy(), responsable: "QA Ficotox", comunicacion_cliente: { medio: "correo", fecha: hoy(), persona: "Cliente", respuesta: "Enterado" } };
const datosR = (idInt, extra = {}) => ({ fecha_recepcion: hoy(), hora_recepcion: "09:00", recibido_por: "QA Ficotox", medio_recepcion: "directa", solicitante: `Cliente cobertura UI ${idInt}`, muestra_unica: true, id_interno: idInt, fecha_muestra: hoy(), analisis: { tipos: ["toxinas_lipofilicas"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] }, inspeccion: insp(), datos_solicitante: { nombre_entrega: "Juan Pérez", firma_conformidad: FIRMA, conformidad: true }, datos_custodio: { nombre_cargo_firma: "QA Ficotox", firma_digital: FIRMA, lugar_resguardo: "congelador", lugar_otro: "CO1" }, ...extra });
const nuevaR = async (idInt, extra = {}, token = t.qa, headers = {}) => (await api("POST", "/samples/reception", datosR(idInt, extra), token, headers)).data?.id;
const recepcion = async (rid) => (await api("GET", `/samples/reception/${rid}`, undefined, t.qa)).data?.item;
const pendienteDe = (entidad, entidadId) => fila("SELECT id, tipo, solicitado_por FROM solicitudes_autorizacion WHERE entidad = ? AND entidad_id = ? AND estado = 'pendiente' ORDER BY id DESC", entidad, String(entidadId));
const cancelar = async (entidad, entidadId) => {
  const p = pendienteDe(entidad, entidadId);
  if (!p) return;
  const quien = Object.keys(id).find((k) => Number(id[k]) === Number(p.solicitado_por));
  await api("POST", `/solicitudes/${p.id}/cancelar`, { motivo: "Limpieza de la prueba de cobertura" }, t[quien] || t.qa);
};
const flujoAnalisis = async (A, hasta = "aprobado") => {
  await api("POST", `/samples/analysis/${A}/enviar-revision`, {}, t.qa);
  if (hasta === "en_revision") return;
  await api("POST", `/samples/analysis/${A}/revisar`, {}, t.ricardo);
  if (hasta === "revisado") return;
  await api("POST", `/samples/analysis/${A}/aprobar`, {}, t.ricardo);
};

/* Pop-up de validación: devuelve su texto (títulos y datos por corregir) y lo cierra con «Entendido». */
const popup = async (page) => {
  const d = page.locator("[role=alertdialog][data-validacion]").last();
  await d.waitFor();
  const texto = (await d.textContent()) || "";
  await entendido(page);
  return texto;
};
/* Advertencias previas («Revisar antes de guardar»): se continúa. */
const guardarDeTodosModos = async (page) => {
  const boton = page.getByRole("button", { name: "Guardar de todos modos" });
  if (await boton.isVisible({ timeout: 2500 }).catch(() => false)) await boton.click();
};
/* Abre el menú ⋯ de la fila que contiene `texto`. */
const menuDeFila = async (page, texto) => {
  const fila = page.getByRole("row").filter({ hasText: texto }).first();
  await fila.waitFor();
  await fila.getByRole("button", { name: /Acciones/ }).click();
  await page.getByRole("menu").waitFor();
  return fila;
};
const opcionesMenu = async (page) => (await page.getByRole("menuitem").allTextContents()).join(" | ");

/* ---------- Preparación por API ---------- */
const PASS = "Cobertura-Muestras-UI-2026";
const roles = (await api("GET", "/admin/roles", undefined, t.qa)).data?.items || [];
const rolAuxiliar = roles.find((r) => r.nombre === "Técnico Auxiliar")?.id;
const emailSinAut = `cob.ui.sinaut.${s5}@ficotox.local`;
await api("POST", "/admin/usuarios", { nombre: `Cobertura Sin Autorización ${s5}`, email: emailSinAut, activo: true, rol_id: rolAuxiliar, departamento: "Laboratorio", password: PASS, motivo: "Alta de la prueba de cobertura" }, t.qa);
ejecutar("UPDATE usuarios SET debe_cambiar_password = 0 WHERE email = ?", emailSinAut);
const sinAut = { email: emailSinAut, password: PASS, id: Number(fila("SELECT id FROM usuarios WHERE email = ?", emailSinAut)?.id), nombre: `Cobertura Sin Autorización ${s5}` };

const ID_A = `UIA-${s5}`;
const R_A = await nuevaR(ID_A, { decision_aceptacion: "aceptada", aceptacion: ACEPTACION });
const ID_PEND = `UIP-${s5}`;
const R_PEND = await nuevaR(ID_PEND);
const folioPend = await api("POST", `/samples/reception/${R_PEND}/folio`, { folio_num: 700000 + (Date.now() % 90000), motivo: "Folio repetido en la libreta" }, t.mariana, SIN_APROBAR);
const ID_RECH = `UIR-${s5}`;
const R_RECH = await nuevaR(ID_RECH, { inspeccion: insp(true), decision_aceptacion: "rechazada", aceptacion: ACEPTACION }, t.ricardo);
const R_AUT = await nuevaR(`UIW-${s5}`);
const ID_LEG = `UIL-${s5}`;
const R_LEG = await nuevaR(ID_LEG, { analisis: { tipos: ["toxinas_lipofilicas"], metodos: ["cromatografia_liquidos", "espectrofotometro"], tipos_muestra: ["organismo_completo", "fitotox"] } });
const ID_LOTE = `UIT-${s5}`;
const R_LOTE = await nuevaR(ID_LOTE, { muestra_unica: false, id_interno: null, lote_muestras: [{ trabajar: true, id_interno: `${ID_LOTE}-1` }, { trabajar: true, id_interno: `${ID_LOTE}-2` }], decision_aceptacion: "aceptada", aceptacion: ACEPTACION });
const c1 = await cadena(t, `UIC${s5}`);
const E_MIN = (await api("POST", "/samples/extraction", { tipo_registro: "E-D", procesamiento_id: c1.P, nombre_quien_extrajo: "Persona A", nombre_quien_superviso: "Persona B" }, t.qa)).data?.id;
check("(preparación) recepciones, cadena y cuenta propias", [R_A, R_PEND, R_RECH, R_LEG, R_LOTE, R_AUT, E_MIN, c1.R, c1.P, c1.E].every(Boolean) && folioPend.status === 202 && sinAut.id > 0, `${R_A} ${R_PEND} ${R_RECH} ${R_LEG} ${R_LOTE} ${JSON.stringify({ R: c1.R, P: c1.P, E: c1.E })} ${folioPend.status} ${sinAut.id}`);

/* ================= Recepción: alta completa en pantalla ================= */
const ID_NUEVA = `UIN-${s5}`;
await paso("qa", "recepción nueva: reglas del formulario, lote y campos que se guardan", async (page) => {
  await page.goto(`${BASE_WEB}/muestras/recepcion/nueva`);
  await page.locator("#r-folio").waitFor();
  await mostrarTodo(page);
  const folioSugerido = await page.locator("#r-folio").inputValue();
  await page.fill("#r-fecha", hoy());
  await page.fill("#r-hora", "");
  await page.fill("#r-fecha-muestra", "2099-01-01");
  await page.getByRole("button", { name: "Registrar recepción" }).click();
  const faltan = await popup(page);
  check("[cob:M:M-045] sin hora → «Indica la hora de recepción»", /Indica la hora de recepción/.test(faltan), faltan.slice(0, 300));
  check("[cob:M:M-050] fecha de muestreo posterior a la recepción → aviso del formulario", /La fecha de muestreo no puede ser posterior a la recepción/.test(faltan), faltan.slice(0, 300));
  check("[cob:M:M-056] sin tipo de análisis → «Marca al menos un tipo de análisis»", /Marca al menos un tipo de análisis/.test(faltan), faltan.slice(0, 300));
  check("[cob:M:M-061] los 7 requisitos de la inspección son obligatorios en el formulario", /Marca C, NC o NA en el requisito 1/.test(faltan) && /requisito 7/.test(faltan), faltan.slice(0, 400));
  check("[cob:M:M-075] sin lugar de resguardo → «Elige el lugar de resguardo»", /Elige el lugar de resguardo/.test(faltan), faltan.slice(0, 400));
  check("[cob:M:M-008] el pop-up lista los datos por corregir y se cierra con «Entendido»", (await page.locator("[role=alertdialog]").count()) === 0);

  /* Lote: filas, regla de ID y fecha, quitar fila. */
  await page.getByRole("radio", { name: /^Lote/ }).check();
  const lote = page.locator("#sec-muestra");
  await page.locator("#r-lote-id-0").waitFor();
  const trabajar = lote.getByLabel("Trabajar").first();
  await page.getByLabel("Organismo de la muestra 1").fill("Mejillón");
  await page.fill("#r-lote-fecha-0", "2099-01-01");
  await page.getByRole("button", { name: "Registrar recepción" }).click();
  const faltanLote = await popup(page);
  check("[cob:M:M-049] [cob:M:M-053] «Lote» muestra la fila (Trabajar, ID, organismo, fecha) y exige un ID y fechas ≤ recepción", (await trabajar.count()) === 1 && /ID interno de al menos una muestra del lote/.test(faltanLote) && /La fecha de muestreo de la muestra 1 no puede ser posterior/.test(faltanLote), faltanLote.slice(0, 300));
  await page.fill("#r-lote-id-0", `${ID_NUEVA}-L1`);
  await page.getByRole("button", { name: "Quitar muestra 1" }).click();
  check("[cob:M:M-054] «Quitar muestra 1» con una sola fila la deja vacía", (await page.locator("#r-lote-id-0").inputValue()) === "" && (await page.getByLabel("Organismo de la muestra 1").inputValue()) === "");
  await page.getByRole("radio", { name: /^Muestra única/ }).check();

  /* Llenado completo. */
  await page.fill("#r-hora", "10:30");
  await page.fill("#r-fecha-muestra", hoy());
  await page.fill("#r-id", ID_NUEVA);
  await page.selectOption("#r-medio", { index: 1 });
  await page.fill("#r-solicitante", `Cooperativa cobertura ${s5}`);
  await page.fill("#r-esp", "E".repeat(300));
  const analisis = page.locator("#sec-analisis");
  await analisis.getByLabel("Ácido domoico (ASP)").check();
  await analisis.getByLabel("Cromatografía de líquidos").check();
  const otros = analisis.getByRole("checkbox", { name: "Otro", exact: true });
  check("[cob:M:M-057] [cob:M:M-058] «Otro método» y «Otro tipo de muestra» aparecen solo al marcar «Otro»", (await page.getByLabel("Otro método").count()) === 0 && (await page.getByLabel("Otro tipo de muestra").count()) === 0);
  await otros.nth(1).check();
  await page.getByLabel("Otro método").fill("Inmunoensayo ELISA");
  await analisis.getByLabel("Organismo completo").check();
  await otros.nth(2).check();
  await page.getByLabel("Otro tipo de muestra").fill("Hepatopáncreas");
  await page.fill("#r-obs-analisis", "Observación del análisis de cobertura");
  const grupos = page.locator('#sec-inspeccion [role="radiogroup"]');
  for (let i = 0; i < (await grupos.count()); i += 1) await grupos.nth(i).getByRole("radio", { name: i === 6 ? "NA" : "C", exact: true }).click();
  const req1 = await grupos.nth(0).getAttribute("aria-label");
  await page.getByLabel(`Observación: ${req1}`).fill("Llegó con hielo suficiente");
  await page.locator("#r-decision").getByRole("radio", { name: /^Aceptada/ }).first().check();
  await page.fill("#r-acep-fecha", hoy());
  const opciones = await page.locator("#r-acep-resp option").allTextContents();
  await page.locator("#r-acep-resp").selectOption({ label: opciones.find((o) => o.includes("QA")) || opciones.find((o) => o.trim() && !/Selecciona|Elige|Otra/.test(o)) });
  await page.fill("#r-acep-obs", "Decisión con observación de cobertura");
  await page.fill("#r-sol-nombre", "Juan Pérez");
  await page.fill("#r-sol-correo", `cliente.${s5}@ejemplo.mx`);
  await firmar(page, "Firma de conformidad del solicitante");
  await page.getByLabel(/He revisado la información/).check();
  check("[cob:M:M-075] «Detalle del lugar de resguardo» aparece al elegir el lugar", (await page.getByLabel("Detalle del lugar de resguardo").count()) === 0);
  await page.getByRole("radio", { name: /^Congelador/ }).check();
  await page.getByLabel("Detalle del lugar de resguardo").fill("CO2");
  await firmar(page, "Firma · Custodio");

  /* Error del servidor: folio ocupado (otra recepción) → pop-up con el mensaje del servidor. */
  await page.fill("#r-folio", String((await recepcion(R_A)).folio_num));
  await page.getByRole("button", { name: "Registrar recepción" }).click();
  const servidor = page.locator('[role=alertdialog][data-validacion="servidor"]');
  await servidor.waitFor();
  const textoServidor = (await servidor.textContent()) || "";
  await entendido(page);
  check("[cob:M:M-008] error 409 del servidor (folio repetido) en el pop-up de la ficha", /El folio ya existe/.test(textoServidor), textoServidor.slice(0, 200));
  for (let intento = 0; intento < 3; intento += 1) {
    const siguiente = (await api("GET", "/samples/reception/next-folio", undefined, t.qa)).data?.next_folio || folioSugerido;
    await page.fill("#r-folio", String(siguiente));
    await page.getByRole("button", { name: "Registrar recepción" }).click();
    const salio = await Promise.race([page.waitForURL((url) => url.pathname === "/muestras/recepcion", { timeout: 20_000 }).then(() => true), servidor.waitFor({ timeout: 20_000 }).then(() => false)]).catch(() => false);
    if (salio) break;
    if (await servidor.count()) await entendido(page);
  }
  const creada = ((await api("GET", `/samples/reception?search=${ID_NUEVA}`, undefined, t.qa)).data?.items || [])[0];
  const r = creada ? await recepcion(creada.id) : null;
  check("[cob:M:M-045] la hora capturada se guarda", r?.hora_recepcion === "10:30", r?.hora_recepcion);
  check("[cob:M:M-052] «Especificaciones» se limita a 220 caracteres", String(r?.especificaciones || "").length === 220, String(r?.especificaciones || "").length);
  check("[cob:M:M-057] [cob:M:M-058] [cob:M:M-060] método y tipo de muestra «otro» con su texto y observaciones del análisis guardados", r?.analisis?.metodo_otro === "Inmunoensayo ELISA" && r?.analisis?.tipo_muestra_otro === "Hepatopáncreas" && r?.analisis?.observaciones === "Observación del análisis de cobertura", JSON.stringify(r?.analisis || {}).slice(0, 300));
  check("[cob:M:M-062] la observación del requisito 1 se guarda", r?.inspeccion?.checklist?.[0]?.observacion === "Llegó con hielo suficiente", JSON.stringify(r?.inspeccion?.checklist?.[0] || {}));
  check("[cob:M:M-068] «Observaciones de la decisión» se guarda", r?.aceptacion?.observaciones === "Decisión con observación de cobertura" && r?.decision_aceptacion === "aceptada", JSON.stringify(r?.aceptacion || {}).slice(0, 200));
  check("[cob:M:M-071] «Correo del solicitante» se guarda", r?.datos_solicitante?.correo === `cliente.${s5}@ejemplo.mx`, JSON.stringify(r?.datos_solicitante || {}).slice(0, 200));
  check("[cob:M:M-075] lugar de resguardo y su detalle se guardan", r?.datos_custodio?.lugar_resguardo === "congelador" && r?.datos_custodio?.lugar_otro === "CO2", JSON.stringify(r?.datos_custodio || {}).slice(0, 200));
});

/* Valores heredados (fuera del catálogo actual) y su chip «Quitar …». */
await paso("qa", "recepción con valores del catálogo anterior", async (page) => {
  await page.goto(`${BASE_WEB}/muestras/recepcion/${R_LEG}`);
  await mostrarTodo(page);
  const metodo = page.getByRole("button", { name: "Quitar Espectrofotómetro (catálogo anterior)" });
  const tipo = page.getByRole("button", { name: "Quitar Fitotox (catálogo anterior)" });
  await metodo.waitFor();
  check("[cob:M:M-059] los valores fuera del catálogo se muestran con «Quitar …»", (await metodo.count()) === 1 && (await tipo.count()) === 1);
  await metodo.click();
  // La inspección creada por API no usa los textos del formato: se marca en pantalla.
  const grupos = page.locator('#sec-inspeccion [role="radiogroup"]');
  for (let i = 0; i < (await grupos.count()); i += 1) await grupos.nth(i).getByRole("radio", { name: i === 6 ? "NA" : "C", exact: true }).click();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await page.waitForURL((url) => url.pathname === "/muestras/recepcion");
  const r = await recepcion(R_LEG);
  check("[cob:M:M-059] al quitarlo y guardar, el valor heredado ya no está (el otro sigue)", !r?.analisis?.metodos?.includes("espectrofotometro") && r?.analisis?.metodos?.includes("cromatografia_liquidos") && r?.analisis?.tipos_muestra?.includes("fitotox"), JSON.stringify(r?.analisis || {}));
});

/* Aviso de autorizaciones FX-THF-AP faltantes. */
await paso(sinAut, "recepción sin autorizaciones FX-THF-AP", async (page) => {
  await page.goto(`${BASE_WEB}/muestras/recepcion/nueva`);
  await page.getByText("Sin permiso para registrar").waitFor();
  check("[cob:M:M-094] sin la autorización de recepción no se ofrece el alta («Sin permiso para registrar»)", (await page.locator("#r-folio").count()) === 0);
  // Sin la autorización la ficha de una recepción registrada queda en solo lectura (editar = { ok: false } sin motivo),
  // así que el aviso de AvisoAutorizacion no llega a mostrarse en recepción (ver DUDA del reporte).
  await page.goto(`${BASE_WEB}/muestras/recepcion/${R_AUT}`);
  await page.locator("fieldset[disabled].form-readonly").first().waitFor();
  const avisoRec = page.locator("[data-aviso-autorizacion]").first();
  await avisoRec.waitFor();
  check("[cob:M:M-094] sin la autorización, la ficha de una recepción registrada se abre en solo lectura y dice cuál falta", (await page.getByRole("button", { name: "Guardar cambios" }).count()) === 0 && /recepción/i.test((await avisoRec.textContent()) || ""), (await avisoRec.textContent())?.slice(0, 160));
});

/* ================= Recepción: lista, menú, filtros y solo lectura ================= */
await paso("ricardo", "recepción: lista, filtros, menú y franja de pendientes", async (page) => {
  await page.goto(`${BASE_WEB}/muestras/recepcion`);
  const franja = page.locator("[data-franja-pendientes]").getByRole("link", { name: /esperan? tu autorización/ });
  await franja.waitFor();
  check("[cob:M:M-020] la franja de pendientes enlaza a «Por autorizar» filtrado por recepción", /\/solicitudes\?modulo=recepcion/.test((await franja.getAttribute("href")) || ""), await franja.getAttribute("href"));
  const buscar = page.getByPlaceholder("Buscar por folio, solicitante o ID interno");
  await buscar.fill(s5);
  await page.getByRole("row").filter({ hasText: ID_RECH }).waitFor();
  await page.getByRole("button", { name: /Filtros/ }).click();
  await page.getByRole("region", { name: "Estado" }).or(page.locator('section[aria-label="Estado"]')).getByRole("switch", { name: "Rechazada" }).click();
  await page.keyboard.press("Escape");
  await esperar(async () => (await page.getByRole("row").filter({ hasText: ID_A }).count()) === 0);
  const visibles = await page.getByRole("row").filter({ hasText: s5 }).allTextContents();
  check("[cob:M:M-023] filtro «Estado · Rechazada»: solo quedan las rechazadas", visibles.length >= 1 && visibles.every((v) => /Rechazada/.test(v)) && visibles.some((v) => v.includes(ID_RECH)), visibles.join(" | ").slice(0, 300));
  const chip = page.getByRole("button", { name: "Quitar filtro Rechazada" });
  check("[cob:M:M-029] el filtro activo aparece como chip con ×", (await chip.count()) === 1);
  await chip.click();
  await page.getByRole("row").filter({ hasText: ID_A }).waitFor();
  check("[cob:M:M-029] quitar el chip devuelve todas las filas", (await chip.count()) === 0);

  const filaA = page.getByRole("row").filter({ hasText: ID_A }).first();
  const textoFila = (await filaA.textContent()) || "";
  check("[cob:M:M-030] la fila muestra folio R, ID, solicitante, aceptación y estado", /R ?\d{7}/.test(textoFila) && textoFila.includes(ID_A) && textoFila.includes("Cliente cobertura UI") && /Aceptada/.test(textoFila), textoFila.slice(0, 200));
  await menuDeFila(page, ID_A);
  const menuA = await opcionesMenu(page);
  check("[cob:M:M-031] [cob:M:M-033] [cob:M:M-038] menú ⋯ de una aceptada: Abrir, Asignar…, Procesar", /Abrir/.test(menuA) && /Asignar…/.test(menuA) && /Procesar/.test(menuA), menuA.slice(0, 300));
  await page.keyboard.press("Escape");
  await menuDeFila(page, ID_PEND);
  const menuPend = await opcionesMenu(page);
  const editar = page.getByRole("menuitem", { name: /Editar/ });
  check("[cob:M:M-034] «Editar» deshabilitado con el motivo «Tiene una solicitud pendiente…»; sin Asignar ni Procesar en una registrada", (await editar.getAttribute("aria-disabled")) === "true" && /Tiene una solicitud pendiente/.test(menuPend) && !/Asignar…/.test(menuPend) && !/Procesar/.test(menuPend), menuPend.slice(0, 300));
  await page.keyboard.press("Escape");
  await menuDeFila(page, ID_RECH);
  const menuRech = await opcionesMenu(page);
  check("[cob:M:M-033] [cob:M:M-034] [cob:M:M-038] una rechazada no ofrece Asignar, Editar ni Procesar", !/Asignar…/.test(menuRech) && !/Editar/.test(menuRech) && !/Procesar/.test(menuRech), menuRech.slice(0, 300));
  await page.keyboard.press("Escape");
  await menuDeFila(page, ID_A);
  await page.getByRole("menuitem", { name: /Procesar/ }).click();
  await page.waitForURL((url) => url.pathname === "/muestras/procesamiento/nuevo");
  await page.locator("#p-recepcion").waitFor();
  await esperar(async () => (await page.locator("#p-recepcion").inputValue()) === String(R_A));
  check("[cob:M:M-038] «Procesar» abre el procesamiento nuevo con la recepción ya vinculada", new URL(page.url()).searchParams.get("recepcion") === String(R_A) && (await page.locator("#p-recepcion").inputValue()) === String(R_A), `${page.url()} ${await page.locator("#p-recepcion").inputValue()}`);
  await page.goto(`${BASE_WEB}/muestras/recepcion`);
  await page.getByPlaceholder("Buscar por folio, solicitante o ID interno").fill(ID_A);
  await page.getByRole("row").filter({ hasText: ID_A }).first().click();
  await page.waitForURL((url) => url.pathname === `/muestras/recepcion/${R_A}`);
  check("[cob:M:M-030] clic en la fila abre la ficha", true);
});

await paso("qa", "recepción: solo lectura y aviso de solicitud pendiente", async (page) => {
  await page.goto(`${BASE_WEB}/muestras/recepcion/${R_PEND}`);
  const banner = page.getByRole("region", { name: "Solicitud pendiente de autorización" });
  await banner.waitFor();
  const texto = (await banner.textContent()) || "";
  check("[cob:M:M-015] la ficha muestra la solicitud pendiente (cambio de folio)", /pendiente de autorización/.test(texto) && /folio/i.test(texto), texto.slice(0, 200));
  check("[cob:M:M-009] [cob:M:M-015] con la solicitud pendiente la ficha queda en solo lectura (fieldset desactivado)", (await page.locator("fieldset[disabled].form-readonly").count()) >= 1 && (await page.getByRole("button", { name: "Guardar cambios" }).count()) === 0);
  await page.goto(`${BASE_WEB}/muestras/recepcion/${R_RECH}`);
  await page.locator("fieldset[disabled].form-readonly").first().waitFor();
  check("[cob:M:M-009] una recepción rechazada se muestra en solo lectura", (await page.locator("#r-solicitante").isDisabled()) && (await page.getByRole("button", { name: "Guardar cambios" }).count()) === 0);
});
await cancelar("muestras_recepcion", R_PEND);

/* Seguimiento, asignación y etiquetas. */
await paso("ricardo", "recepción: seguimiento, asignar con aviso y etiquetas", async (page) => {
  await page.goto(`${BASE_WEB}/muestras/recepcion/${c1.R}`);
  await mostrarTodo(page);
  const abrirP = page.getByRole("link", { name: "Abrir procesamiento" }).first();
  await abrirP.waitFor();
  const hrefs = [await abrirP.getAttribute("href"), await page.getByRole("link", { name: "Ver análisis de esta recepción" }).getAttribute("href"), await page.getByRole("link", { name: "Ver informes" }).getAttribute("href")];
  check("[cob:M:M-083] Seguimiento: enlaces al procesamiento, a sus análisis y a sus informes", hrefs[0] === `/muestras/procesamiento/${c1.P}` && hrefs[1] === `/muestras/analisis?recepcion=${c1.R}` && hrefs[2] === `/informes?recepcion=${c1.R}`, hrefs.join(" · "));
  await abrirP.click();
  await page.waitForURL((url) => url.pathname === `/muestras/procesamiento/${c1.P}`);

  await page.goto(`${BASE_WEB}/muestras/recepcion/${R_A}`);
  await page.getByRole("button", { name: "Asignar", exact: true }).first().click();
  await page.locator("#asignar-usuario").waitFor();
  await esperar(async () => (await page.locator("#asignar-usuario option").allTextContents()).some((o) => o.includes(sinAut.nombre)));
  const opcion = (await page.locator("#asignar-usuario option").allTextContents()).find((o) => o.includes(sinAut.nombre));
  await page.locator("#asignar-usuario").selectOption({ label: opcion });
  check("[cob:M:M-102] «Motivo (opcional)» admite hasta 300 caracteres", (await page.locator("#asignar-motivo").getAttribute("maxlength")) === "300");
  await page.fill("#asignar-motivo", "Apoyo en la recepción de cobertura");
  await page.getByRole("dialog").getByRole("button", { name: "Asignar", exact: true }).click();
  const aviso = page.locator("[data-aviso-asignacion]");
  await aviso.waitFor();
  const textoAviso = (await aviso.textContent()) || "";
  const asig = fila("SELECT motivo FROM asignaciones_muestra WHERE recepcion_id = ? AND usuario_id = ? AND revocado_en IS NULL", R_A, sinAut.id);
  check("[cob:M:M-104] asignar a quien no tiene las autorizaciones muestra el aviso (role=alert)", (await aviso.getAttribute("role")) === "alert" && /autoriza|FX-THF-AP/i.test(textoAviso), textoAviso.slice(0, 200));
  check("[cob:M:M-102] el motivo de la asignación se guarda", asig?.motivo === "Apoyo en la recepción de cobertura", JSON.stringify(asig));
  // Tras asignar, el selector vuelve a vacío: no es un error (antes quedaba en rojo con «Elige a la persona…»).
  const textoDialogo = (await page.getByRole("dialog").innerText()).replace(/\s+/g, " ");
  check("tras asignar con éxito el selector vacío no queda marcado en rojo", (await page.locator("#asignar-usuario").getAttribute("aria-invalid")) !== "true" && !/Elige a la persona/i.test(textoDialogo), textoDialogo.slice(0, 200));
  await page.keyboard.press("Escape");

  await page.goto(`${BASE_WEB}/muestras/recepcion/${R_A}/etiquetas`);
  const volver = page.locator("main").getByRole("link", { name: /^Recepción R/ });
  await volver.waitFor();
  await volver.click();
  await page.waitForURL((url) => url.pathname === `/muestras/recepcion/${R_A}`);
  check("[cob:M:M-105] «← Recepción» de las etiquetas regresa a la ficha", true);
});

/* Disposición final con todos sus campos (muestra con informe liberado). */
const L1 = await informeLiberado(t, `UID${s5}`);
await paso("ricardo", "recepción: disposición final completa", async (page) => {
  await page.goto(`${BASE_WEB}/muestras/recepcion/${L1.R}`);
  await mostrarTodo(page);
  const tipos = page.locator("#r-disp-tipo").getByRole("radio");
  await tipos.first().waitFor();
  check("[cob:M:M-084] cinco tipos de disposición (RPBI, residuos comunes, conservado, devuelto, otro)", (await tipos.count()) === 5);
  check("[cob:M:M-085] «Otro tipo de disposición» solo con «Otro»", (await page.getByLabel("Otro tipo de disposición").count()) === 0);
  await page.locator("#r-disp-tipo").getByRole("radio", { name: /^Otro/ }).check();
  await page.getByLabel("Otro tipo de disposición").fill("Entregado a la colección de referencia");
  await page.fill("#r-disp-fecha", "");
  const opciones = await page.locator("#r-disp-resp option").allTextContents();
  await page.locator("#r-disp-resp").selectOption({ label: opciones.find((o) => o.includes("Ricardo")) || opciones.find((o) => o.trim() && !/Selecciona|Elige|Otra/.test(o)) });
  await page.getByRole("button", { name: "Registrar disposición y cerrar la muestra" }).click();
  const faltan = await popup(page);
  check("[cob:M:M-086] sin fecha → «Indica la fecha de la disposición»", /Indica la fecha de la disposición/.test(faltan), faltan.slice(0, 200));
  await page.fill("#r-disp-fecha", hoy());
  check("[cob:M:M-088] «Remanentes» admite hasta 240 caracteres", (await page.locator("#r-disp-rem").getAttribute("maxlength")) === "240");
  await page.fill("#r-disp-rem", "Quedan 20 g de molienda");
  await page.fill("#r-disp-obs", "Observación de la disposición de cobertura");
  await page.getByLabel("Subir imagen de Firma de la disposición").setInputFiles({ name: "firma.png", mimeType: "image/png", buffer: Buffer.from(FIRMA.split(",")[1], "base64") });
  const limpiarFirma = page.locator('div:has(> div > canvas[aria-label="Firma de la disposición"])').getByRole("button", { name: "Limpiar" });
  await esperar(() => limpiarFirma.isEnabled());
  await page.getByRole("button", { name: "Registrar disposición y cerrar la muestra" }).click();
  await contrasena(page, pwd("ricardo"));
  await page.waitForURL((url) => url.pathname === "/muestras/recepcion");
  const r = await recepcion(L1.R);
  const d = r?.disposicion || {};
  check("[cob:M:M-084] [cob:M:M-085] [cob:M:M-086] [cob:M:M-088] [cob:M:M-089] [cob:M:M-090] la disposición guarda tipo «otro» con su texto, fecha, remanentes, observaciones y firma; la muestra queda cerrada", r?.estado === "cerrada" && d.tipo === "otro" && d.tipo_otro === "Entregado a la colección de referencia" && d.fecha === hoy() && d.remanentes === "Quedan 20 g de molienda" && d.observaciones === "Observación de la disposición de cobertura" && /^data:image/.test(String(d.firma || "")), `${r?.estado} ${JSON.stringify({ ...d, firma: d.firma ? "[firma]" : null }).slice(0, 300)}`);
});

/* ================= Procesamiento ================= */
await paso("qa", "procesamiento: lista, filtro y menú", async (page) => {
  await page.goto(`${BASE_WEB}/muestras/procesamiento`);
  await page.getByPlaceholder("Buscar por folio P, folio R o ID interno").fill(c1.idInt);
  const fila = page.getByRole("row").filter({ hasText: c1.idInt }).first();
  await fila.waitFor();
  await page.getByRole("button", { name: /Filtros/ }).click();
  await page.locator('section[aria-label="Estado"]').getByRole("switch", { name: "Completados" }).click();
  await page.keyboard.press("Escape");
  const estado = fila_estado(c1.P);
  const ocultaCompletados = estado === "completada" ? true : await esperar(async () => (await page.getByRole("row").filter({ hasText: c1.idInt }).count()) === 0);
  check("[cob:M:M-113] filtro «Estado» (Registrados / En proceso / Completados) filtra la lista", ocultaCompletados, estado);
  await page.getByRole("button", { name: /^Quitar filtro/ }).click();
  await fila.waitFor();
  await menuDeFila(page, c1.idInt);
  const menu = await opcionesMenu(page);
  check("[cob:M:M-116] [cob:M:M-117] [cob:M:M-118] menú del procesamiento: Abrir, Editar y Extraer", /Abrir/.test(menu) && /Editar/.test(menu) && /Extraer/.test(menu), menu.slice(0, 300));
  await page.getByRole("menuitem", { name: /Extraer/ }).click();
  await page.waitForURL((url) => url.pathname === "/muestras/extraccion/nueva");
  check("[cob:M:M-118] «Extraer» abre la extracción nueva con el procesamiento", new URL(page.url()).searchParams.get("procesamiento") === String(c1.P), page.url());
  await page.goto(`${BASE_WEB}/muestras/procesamiento`);
  await page.getByPlaceholder("Buscar por folio P, folio R o ID interno").fill(c1.idInt);
  await menuDeFila(page, c1.idInt);
  await page.getByRole("menuitem", { name: /Abrir/ }).click();
  await page.waitForURL((url) => url.pathname === `/muestras/procesamiento/${c1.P}`);
  check("[cob:M:M-116] «Abrir» lleva a la ficha", true);
});
function fila_estado(P) {
  return fila("SELECT estado FROM muestras_procesamiento WHERE id = ?", P)?.estado;
}

await paso("qa", "procesamiento nuevo de un lote: reglas y campos que se guardan", async (page) => {
  const siguiente = (await api("GET", "/samples/processing/next-folio", undefined, t.qa)).data?.next_folio;
  await page.goto(`${BASE_WEB}/muestras/procesamiento/nuevo?recepcion=${R_LOTE}`);
  await page.locator("#p-folio").waitFor();
  await mostrarTodo(page);
  await esperar(async () => (await page.locator("#p-lote").getByRole("checkbox", { name: "Trabajar" }).count()) === 2);
  check("[cob:M:M-121] «Folio P» se propone con el siguiente folio", Number(await page.locator("#p-folio").inputValue()) >= Number(siguiente), `${await page.locator("#p-folio").inputValue()} vs ${siguiente}`);
  check("[cob:M:M-124] «Muestra única / Lote» se deshabilita cuando lo define la recepción", (await page.getByRole("radio", { name: /^Lote/ }).isDisabled()) && (await page.getByRole("radio", { name: /^Lote/ }).isChecked()));
  const trabajar = page.locator("#p-lote").getByRole("checkbox", { name: "Trabajar" });
  for (let i = 0; i < 2; i += 1) if (await trabajar.nth(i).isChecked()) await trabajar.nth(i).uncheck();
  await page.fill("#p-fecha", "");
  await page.fill("#p-hora", "");
  await page.locator("#p-organismo").getByRole("radio", { name: /^Otro/ }).check();
  await page.getByRole("button", { name: "Registrar procesamiento" }).click();
  const faltan = await popup(page);
  // La hora lleva asterisco como en la recepción: se exige (antes el formulario la marcaba obligatoria sin regla).
  check("[cob:M:M-122] sin fecha ni hora → «Indica la fecha de procesamiento» e «Indica la hora de procesamiento»", /Indica la fecha de procesamiento/.test(faltan) && /Indica la hora de procesamiento/.test(faltan), faltan.slice(0, 400));
  check("[cob:M:M-126] lote sin muestras marcadas → «Marca al menos una muestra del lote»", /Marca al menos una muestra del lote/.test(faltan), faltan.slice(0, 400));
  check("[cob:M:M-127] organismo «Otro» sin texto → «Indica el tipo de organismo»", /Indica el tipo de organismo/.test(faltan), faltan.slice(0, 400));
  check("[cob:M:M-128] sin parte del organismo → «Marca al menos una parte del organismo»", /Marca al menos una parte del organismo/.test(faltan), faltan.slice(0, 400));
  check("[cob:M:M-130] organismo «Otro» sin procedimiento → «Escribe el procedimiento aplicado»", /Escribe el procedimiento aplicado/.test(faltan), faltan.slice(0, 400));
  check("[cob:M:M-131] sin resguardo → «Elige dónde queda la molienda»", /Elige dónde queda la molienda/.test(faltan), faltan.slice(0, 400));
  const folio = Number(siguiente) + 50 + Math.floor(Math.random() * 1000);
  await page.fill("#p-folio", String(folio));
  await page.fill("#p-fecha", hoy());
  await page.fill("#p-hora", "10:30");
  await trabajar.nth(1).check();
  await page.fill("#p-organismo-otro", "Pulpo");
  await page.locator("#p-partes").getByRole("checkbox", { name: /^Otro/ }).check();
  await page.getByLabel("Otra parte").fill("Tentáculo");
  await page.fill("#p-otro", "Se lavó, se cortó en trozos y se molió en licuadora");
  await page.locator("#p-resguardo").getByRole("checkbox", { name: /Congelador CO2/ }).check();
  await page.fill("#p-obs", "Observación del procesamiento de cobertura");
  const filasInsumo = page.getByRole("button", { name: "Quitar insumo" });
  const antes = await filasInsumo.count();
  await page.getByRole("button", { name: "Agregar insumo" }).click();
  check("[cob:M:M-133] «Agregar insumo» agrega una fila (con «Quitar insumo»)", (await filasInsumo.count()) === antes + 1);
  await filasInsumo.last().click();
  check("[cob:M:M-133] «Quitar insumo» la retira", (await filasInsumo.count()) === antes);
  await page.locator("#persona-quien-superviso").selectOption("Ricardo Medina Flores");
  await page.locator("#firma-password").fill(pwd("ricardo"));
  await page.getByRole("button", { name: "Confirmar firma" }).click();
  await page.locator("#firma-password").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Registrar procesamiento" }).click();
  await guardarDeTodosModos(page);
  await page.waitForURL((url) => url.pathname === "/muestras/procesamiento");
  const p = fila("SELECT * FROM muestras_procesamiento WHERE recepcion_id = ? ORDER BY id DESC", R_LOTE);
  const lote = JSON.parse(p?.lote_seleccion_json || "[]");
  check("[cob:M:M-121] el folio P capturado se guarda", Number(p?.folio_num) === folio, `${p?.folio_num} vs ${folio}`);
  check("[cob:M:M-126] solo la muestra marcada del lote queda para trabajar", lote.filter((r) => r.trabajar ?? r.checked).length === 1 && String(p?.id_interno || "").includes(`${ID_LOTE}-2`) && !String(p?.id_interno || "").includes(`${ID_LOTE}-1,`), `${p?.id_interno} ${p?.lote_seleccion_json}`);
  check("[cob:M:M-127] [cob:M:M-128] [cob:M:M-130] organismo «otro» con su texto, parte «otro» con su texto y procedimiento guardados", p?.tipo_organismo_json === '["otro"]' && p?.tipo_organismo_otro === "Pulpo" && /"otro"/.test(p?.parte_organismo_json || "") && p?.parte_organismo_otro === "Tentáculo" && p?.otro_procesamiento === "Se lavó, se cortó en trozos y se molió en licuadora", JSON.stringify({ o: p?.tipo_organismo_json, oo: p?.tipo_organismo_otro, pa: p?.parte_organismo_json, po: p?.parte_organismo_otro, pr: p?.otro_procesamiento }));
  check("[cob:M:M-131] [cob:M:M-132] resguardo y observaciones generales guardados", JSON.parse(p?.resguardo_json || "{}").congelador_co2 === true && p?.observaciones_generales === "Observación del procesamiento de cobertura", `${p?.resguardo_json} ${p?.observaciones_generales}`);
  check("[cob:M:M-122] la hora capturada se guarda", p?.hora_procesamiento === "10:30", p?.hora_procesamiento);
});

/* ================= Extracción ================= */
await paso("qa", "extracción: lista, selector de tipo y ficha", async (page) => {
  await page.goto(`${BASE_WEB}/muestras/extraccion`);
  await page.getByPlaceholder("Buscar por folio (E-D 12), folio P o ID interno").fill(c1.idInt);
  await page.getByRole("row").filter({ hasText: c1.idInt }).first().waitFor();
  await page.getByRole("button", { name: /Filtros/ }).click();
  const grupos = await page.locator("section[aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  await page.locator('section[aria-label="Molienda"]').getByRole("switch", { name: "Congelada" }).click();
  await page.keyboard.press("Escape");
  const oculta = await esperar(async () => (await page.getByRole("row").filter({ hasText: c1.idInt }).count()) === 0);
  check("[cob:M:M-139] filtros «Formato», «Estado» y «Molienda»; «Congelada» oculta una extracción fresca", ["Formato", "Estado", "Molienda"].every((g) => grupos.includes(g)) && oculta, grupos.join(","));
  await page.getByRole("button", { name: /^Quitar filtro/ }).click();
  await menuDeFila(page, c1.idInt);
  const menu = await opcionesMenu(page);
  check("[cob:M:M-141] menú de la extracción: Abrir, Editar, Analizar y «Anular extracción…»", /Abrir/.test(menu) && /Editar/.test(menu) && /Analizar/.test(menu) && /Anular extracción…/.test(menu), menu.slice(0, 300));
  await page.getByRole("menuitem", { name: /Analizar/ }).click();
  await page.waitForURL((url) => url.pathname === "/muestras/analisis/nuevo");
  check("[cob:M:M-141] «Analizar» abre el análisis nuevo con la extracción", new URL(page.url()).searchParams.get("extraccion") === String(c1.E), page.url());

  await page.goto(`${BASE_WEB}/muestras/extraccion/nueva`);
  await page.getByText("¿Qué extracción vas a registrar?").waitFor();
  const dsp = page.getByRole("link", { name: /Registrar extracción DSP/ });
  check("[cob:M:M-142] selector: enlaces «Registrar extracción ASP/DSP» y tarjetas «Próximamente» deshabilitadas", (await dsp.getAttribute("href")) === "/muestras/extraccion/nueva?tipo=E-D" && (await page.getByRole("link", { name: /Registrar extracción ASP/ }).count()) === 1 && (await page.locator('[aria-disabled="true"]').filter({ hasText: "Próximamente" }).count()) >= 1, await dsp.getAttribute("href"));

  await page.goto(`${BASE_WEB}/muestras/extraccion/nueva?tipo=E-D`);
  await page.getByRole("heading", { name: /Nueva extracción DSP/ }).waitFor();
  await mostrarTodo(page);
  await page.fill("#e-fecha", "");
  await page.getByRole("button", { name: /Registrar extracción DSP/ }).click();
  const faltanNueva = await popup(page);
  check("[cob:M:M-144] sin fecha → «Indica la fecha de extracción»", /Indica la fecha de extracción/.test(faltanNueva), faltanNueva.slice(0, 400));
  check("[cob:M:M-147] sin procesamiento ni molienda → «Elige el tipo de molienda»", /Elige el tipo de molienda/.test(faltanNueva), faltanNueva.slice(0, 400));
  check("[cob:M:M-151] sin resguardo del extracto → «Elige dónde queda el extracto»", /Elige dónde queda el extracto/.test(faltanNueva), faltanNueva.slice(0, 500));
  const usos = page.getByLabel("Uso del equipo");
  const antes = await usos.count();
  await page.getByRole("button", { name: "Agregar equipo" }).click();
  await usos.last().fill("Baño de agua · paso 18");
  check("[cob:M:M-150] «Agregar equipo» agrega una fila de equipo con su uso", (await usos.count()) === antes + 1);
  await page.getByRole("button", { name: "Quitar equipo" }).last().click();
  check("[cob:M:M-150] «Quitar equipo» la retira", (await usos.count()) === antes);
  check("[cob:M:M-153] «Agregar insumo» está en la ficha", (await page.getByRole("button", { name: "Agregar insumo" }).count()) >= 1);

  // Extracción mínima creada por API (sin fecha, molienda ni pasos): la ficha exige lo que el servidor no.
  await page.goto(`${BASE_WEB}/muestras/extraccion/${E_MIN}`);
  await page.getByRole("heading", { name: /Extracción DSP/ }).waitFor();
  await mostrarTodo(page);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  const faltan = await popup(page);
  check("[cob:M:M-144] [cob:M:M-147] extracción sin fecha → «Indica la fecha de extracción»; la molienda se toma del procesamiento", /Indica la fecha de extracción/.test(faltan) && !/Elige el tipo de molienda/.test(faltan) && (await page.locator("#e-molienda input:checked").count()) === 1, faltan.slice(0, 400));
  check("[cob:M:M-148] DSP: exige un paso 3-8 y un paso 9-14", /al menos un paso de la extracción \(3 a 8\)/.test(faltan) && /al menos un paso del aforo y filtrado \(9 a 14\)/.test(faltan), faltan.slice(0, 500));

  await page.goto(`${BASE_WEB}/muestras/extraccion/${c1.E}`);
  await page.getByRole("heading", { name: /Extracción DSP/ }).waitFor();
  await mostrarTodo(page);
  await page.getByRole("checkbox", { name: /Agitar en vórtex/ }).check();
  await page.getByRole("checkbox", { name: /Homogeneizar por 1 min/ }).check();
  await page.locator("#e-res-extracto").getByRole("checkbox", { name: /Congelador CO2/ }).check();
  await page.fill("#e-obs", "Observación de la extracción de cobertura");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await guardarDeTodosModos(page);
  await page.waitForURL((url) => url.pathname === "/muestras/extraccion");
  const e = fila("SELECT observaciones_generales, fecha_extraccion, tipo_molienda FROM muestras_extraccion WHERE id = ?", c1.E);
  check("[cob:M:M-152] [cob:M:M-148] [cob:M:M-151] con un paso 3-8, uno 9-14 y el resguardo del extracto se guarda; «Observaciones generales» queda (fecha y molienda se conservan)", e?.observaciones_generales === "Observación de la extracción de cobertura" && !!e?.fecha_extraccion && e?.tipo_molienda === "fresca", JSON.stringify(e));
});

/* ================= Análisis ================= */
const cA = await cadena(t, `UIA${s5}`);
const centrifuga = fila("SELECT id FROM equipos WHERE nombre = 'Centrifuga' ORDER BY id LIMIT 1")?.id;
const A_REG = (await api("POST", "/samples/analysis", analisisDe(cA, { equipo_id: centrifuga }), t.qa)).data?.id;
const A_DEV = (await api("POST", "/samples/analysis", analisisDe(cA, { equipo_id: centrifuga }), t.qa)).data?.id;
await flujoAnalisis(A_DEV, "en_revision");
await api("POST", `/samples/analysis/${A_DEV}/devolver`, { motivo: "Falta el cromatograma del blanco" }, t.ricardo);
const A_ENV = (await api("POST", "/samples/analysis", analisisDe(cA, { equipo_id: centrifuga }), t.qa)).data?.id;
await flujoAnalisis(A_ENV, "en_revision");
const A_ENM = (await api("POST", "/samples/analysis", analisisDe(cA, { equipo_id: centrifuga }), t.qa)).data?.id;
await flujoAnalisis(A_ENM);
const A_ENM2 = (await api("POST", `/samples/analysis/${A_ENM}/enmendar`, { motivo: "Se corrige la unidad del resultado" }, t.qa)).data?.id;
await flujoAnalisis(A_ENM2);
check("(preparación) análisis en cada estado", [A_REG, A_DEV, A_ENV, A_ENM, A_ENM2].every(Boolean), JSON.stringify({ A_REG, A_DEV, A_ENV, A_ENM, A_ENM2 }));

await paso("qa", "análisis: campos de la ficha, resultados, controles y pasos", async (page) => {
  await page.goto(`${BASE_WEB}/muestras/analisis/${A_REG}`);
  await page.locator("#a-folio").waitFor();
  await mostrarTodo(page);
  const pasos = page.locator('ol[aria-label="Avance del registro"] li');
  const textos = await pasos.allTextContents();
  const activo = await page.locator('ol[aria-label="Avance del registro"] li span.bg-brand-soft').textContent();
  check("[cob:M:M-177] pasos Registrado → En revisión → Revisado → Aprobado, con «Registrado» activo", ["Registrado", "En revisión", "Revisado", "Aprobado"].every((p, i) => (textos[i] || "").includes(p)) && /Registrado/.test(activo || ""), `${textos.join(" > ")} [${activo}]`);
  const tipos = page.locator("#a-tipo").getByRole("radio");
  check("[cob:M:M-165] «Tipo de análisis» como tarjetas, con el tipo guardado marcado", (await tipos.count()) >= 3 && (await page.locator("#a-tipo input:checked").count()) === 1);
  await page.fill("#a-ref", "FX-TCI-DSP rev. 2");
  await page.fill("#a-bit", "B-123");
  await page.fill("#a-temp", "22 °C");
  await page.fill("#a-hum", "55 % HR");
  await page.fill("#a-cond", "Sin variaciones");
  await page.getByRole("button", { name: "Agregar muestra" }).click();
  await page.locator("#a-res-id-1").waitFor();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  const faltan = await popup(page);
  check("[cob:M:M-172] una fila de resultados sin ID ni valor → «Indica el ID de la muestra 2» y su resultado", /Indica el ID de la muestra 2/.test(faltan) && /Indica el resultado de la muestra 2/.test(faltan), faltan.slice(0, 300));
  await page.fill("#a-res-id-1", `${cA.idInt}-dup`);
  await page.fill("#a-res-val-1", "48");
  await page.fill("#a-bl-res", "< LD");
  await page.selectOption("#a-bl-ok", "si");
  await page.fill("#a-mr-lote", "CRM-77");
  await page.fill("#a-mr-cad", "2027-12-31");
  await page.fill("#a-mr-esp", "100");
  await page.fill("#a-mr-obt", "97");
  await page.selectOption("#a-mr-ok", "si");
  await page.fill("#a-dup-id", cA.idInt);
  await page.fill("#a-dup-dif", "3 %");
  await page.selectOption("#a-dup-ok", "si");
  await page.fill("#a-obs", "Observación del análisis de cobertura");
  const insumos = page.getByRole("button", { name: "Quitar insumo" });
  const antes = await insumos.count();
  await page.getByRole("button", { name: "Agregar insumo" }).click();
  check("[cob:M:M-175] «Agregar insumo» agrega una fila en un análisis editable", (await insumos.count()) === antes + 1);
  await insumos.last().click();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await guardarDeTodosModos(page);
  await page.waitForURL((url) => url.pathname === "/muestras/analisis");
  const a = (await api("GET", `/samples/analysis/${A_REG}`, undefined, t.qa)).data?.item || {};
  const ctl = a.controles || {};
  check("[cob:M:M-167] «Referencia del método» se guarda", a.metodo_referencia === "FX-TCI-DSP rev. 2", a.metodo_referencia);
  check("[cob:M:M-171] bitácora, temperatura, humedad y observaciones de condiciones se guardan", a.equipo_folio_bitacora === "B-123" && a.condiciones?.temperatura_ambiente === "22 °C" && a.condiciones?.humedad === "55 % HR" && a.condiciones?.observaciones === "Sin variaciones", JSON.stringify({ b: a.equipo_folio_bitacora, c: a.condiciones }));
  check("[cob:M:M-172] la segunda fila de resultados se guarda", (a.resultados || []).length === 2 && (a.resultados || []).some((r) => r.id_muestra === `${cA.idInt}-dup` && Number(r.resultado) === 48), JSON.stringify(a.resultados || []).slice(0, 300));
  check("[cob:M:M-173] blanco, material de referencia y duplicado se guardan", ctl.blanco?.resultado === "< LD" && ctl.blanco?.aceptable === "si" && ctl.material_referencia?.lote === "CRM-77" && ctl.material_referencia?.valor_obtenido === "97" && ctl.duplicado?.diferencia === "3 %" && ctl.duplicado?.aceptable === "si", JSON.stringify(ctl).slice(0, 400));
  check("[cob:M:M-174] «Observaciones del análisis» se guarda", a.observaciones === "Observación del análisis de cobertura", a.observaciones);
});

await paso("qa", "análisis: evidencia (descripción, carga y vista previa)", async (page) => {
  await page.goto(`${BASE_WEB}/muestras/analisis/${A_REG}`);
  await mostrarTodo(page);
  await page.locator(`#evidencia-tipo-${A_REG}`).waitFor();
  const opcionesTipo = await page.locator(`#evidencia-tipo-${A_REG} option`).count();
  await page.locator(`#evidencia-archivo-${A_REG}`).setInputFiles({ name: `cromatograma-${s5}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n% ${s5}`) });
  await page.fill(`#evidencia-desc-${A_REG}`, "abc");
  await page.getByRole("button", { name: "Adjuntar evidencia" }).click();
  const faltan = await popup(page);
  check("[cob:M:M-190] descripción < 5 caracteres → «La descripción debe tener al menos 5 caracteres»", opcionesTipo >= 2 && /La descripción debe tener al menos 5 caracteres/.test(faltan), `${opcionesTipo} ${faltan.slice(0, 200)}`);
  await page.selectOption(`#evidencia-tipo-${A_REG}`, { index: 1 });
  const tipoElegido = await page.locator(`#evidencia-tipo-${A_REG}`).inputValue();
  await page.fill(`#evidencia-desc-${A_REG}`, `Cromatograma de cobertura ${s5}`);
  await page.getByRole("button", { name: "Adjuntar evidencia" }).click();
  const adj = await esperar(() => fila("SELECT tipo_evidencia, descripcion FROM adjuntos WHERE entidad = 'analisis' AND entidad_id = ? AND anulado_en IS NULL ORDER BY id DESC", A_REG));
  check("[cob:M:M-190] tipo de evidencia y descripción se guardan", adj?.tipo_evidencia === tipoElegido && adj?.descripcion === `Cromatograma de cobertura ${s5}`, JSON.stringify(adj));
  await page.getByRole("button", { name: "Vista previa" }).first().click();
  const iframe = page.getByRole("dialog").locator("iframe");
  await iframe.waitFor();
  check("[cob:M:M-196] «Vista previa» abre la hoja con el archivo en un iframe", /^blob:|\/api\//.test((await iframe.getAttribute("src")) || ""), await iframe.getAttribute("src"));
  await page.keyboard.press("Escape");
});

await paso("qa", "análisis: avisos por estado", async (page) => {
  const aviso = async (aid, re) => {
    await page.goto(`${BASE_WEB}/muestras/analisis/${aid}`);
    await page.locator("#a-folio").waitFor();
    return page.getByText(re).first().waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);
  };
  check("[cob:M:M-188] «Devuelto con observaciones del revisor» con el motivo", (await aviso(A_DEV, "Devuelto con observaciones del revisor")) && (await page.getByText("Falta el cromatograma del blanco").count()) >= 1);
  check("[cob:M:M-188] «Enviado a revisión: ya no se edita» en revisión", await aviso(A_ENV, /Enviado a revisión: ya no se edita/));
  check("[cob:M:M-188] «Enmienda: versión 2» en la enmienda", await aviso(A_ENM2, "Enmienda: versión 2"));
  check("[cob:M:M-188] [cob:M:M-177] «Sustituido por una enmienda» en la versión anterior", await aviso(A_ENM, "Sustituido por una enmienda"));
});

/* ================= Informes ================= */
const cI = await cadena(t, `UII${s5}`);
const A_I = (await api("POST", "/samples/analysis", analisisDe(cI), t.qa)).data?.id;
await flujoAnalisis(A_I);
const I_BOR = (await api("POST", "/informes", { recepcion_id: cI.R, analisis_ids: [A_I], cliente: { nombre: `Cliente informe ${s5}` } }, t.qa)).data?.id;
const R_SIN = await nuevaR("", { muestra_unica: false, id_interno: null, lote_muestras: [{ trabajar: false, id_interno: `UIX-${s5}` }], decision_aceptacion: "aceptada", aceptacion: ACEPTACION });
const I_VACIO = (await api("POST", "/informes", { recepcion_id: R_SIN, analisis_ids: [], cliente: { nombre: `Cliente vacío ${s5}` } }, t.qa)).data?.id;
const cAut = await cadena(t, `UIU${s5}`);
const A_AUT = (await api("POST", "/samples/analysis", analisisDe(cAut), t.qa)).data?.id;
await flujoAnalisis(A_AUT);
const I_AUT = (await api("POST", "/informes", { recepcion_id: cAut.R, analisis_ids: [A_AUT], cliente: { nombre: `Cliente autorizado ${s5}` } }, t.qa)).data?.id;
await api("POST", `/informes/${I_AUT}/revisar`, {}, t.ricardo);
await api("POST", `/informes/${I_AUT}/autorizar`, {}, t.patricia);
check("(preparación) informes en borrador, sin muestras y autorizado", !!I_BOR && !!I_VACIO && fila("SELECT estado FROM informes WHERE id = ?", I_AUT)?.estado === "autorizado", `${I_BOR} ${I_VACIO} ${I_AUT}`);

await paso("qa", "informe: ficha en borrador (declaraciones, elaboró, pasos)", async (page) => {
  await page.goto(`${BASE_WEB}/informes/${I_BOR}`);
  await mostrarTodo(page);
  await page.locator("#i-alc").waitFor();
  const enlace = page.getByRole("link", { name: "abrir recepción" });
  check("[cob:M:M-206] «abrir recepción» enlaza a la recepción del informe", (await enlace.getAttribute("href")) === `/muestras/recepcion/${cI.R}`, await enlace.getAttribute("href"));
  check("[cob:M:M-208] «Ítems ensayados» lista la muestra de la recepción", ((await page.locator("#i-muestras").textContent()) || "").includes(cI.idInt));
  const pasos = await page.locator('ol[aria-label="Avance del registro"] li').allTextContents();
  check("[cob:M:M-212] pasos Borrador → En revisión → Autorizado → Liberado → Enviado", ["Borrador", "revisión", "Autorizado", "Liberado", "Enviado"].every((p, i) => (pasos[i] || "").includes(p)), pasos.join(" > "));
  check("[cob:M:M-234] en borrador: «El envío por correo se registra una vez liberado el informe.»", (await page.getByText("El envío por correo se registra una vez liberado el informe.").count()) === 1);
  await page.fill("#i-alc", "");
  await page.fill("#i-regla", "");
  await page.locator("#persona-elaboro").selectOption({ index: 0 });
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  const faltan = await popup(page);
  check("[cob:M:M-210] alcance y regla de decisión obligatorios en el formulario", /Escribe el alcance de los resultados/.test(faltan) && /Escribe la regla de decisión/.test(faltan), faltan.slice(0, 300));
  check("[cob:M:M-211] «Elaboró» obligatorio → «Elige quién elabora el informe»", /Elige quién elabora el informe/.test(faltan), faltan.slice(0, 300));
  const valores = { "#i-alc": "Los resultados se refieren solo a la muestra recibida", "#i-regla": "Aceptación simple contra el límite regulatorio", "#i-desv": "Sin desviaciones del método", "#i-desc": "Sin descargo", "#i-op": "Apta para consumo", "#i-obs": "Observación interna de cobertura" };
  for (const [sel, val] of Object.entries(valores)) await page.fill(sel, val);
  const opciones = await page.locator("#persona-elaboro option").allTextContents();
  await page.locator("#persona-elaboro").selectOption({ label: opciones.find((o) => o.includes("QA Ficotox")) || opciones.find((o) => o.trim() && !/Selecciona|Elige|Otra/.test(o)) });
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await guardarDeTodosModos(page);
  await toast(page, /actualizado|guardado/i);
  const inf = (await api("GET", `/informes/${I_BOR}`, undefined, t.qa)).data?.item || {};
  const d = inf.declaraciones || {};
  check("[cob:M:M-210] las seis declaraciones se guardan", d.alcance === valores["#i-alc"] && d.regla_decision === valores["#i-regla"] && d.desviaciones === valores["#i-desv"] && d.descargo === valores["#i-desc"] && d.opiniones === valores["#i-op"] && inf.observaciones === valores["#i-obs"], JSON.stringify({ d, o: inf.observaciones }).slice(0, 400));
  check("[cob:M:M-211] «Elaboró» se guarda", /QA/.test(String(inf.elaborado_nombre || inf.elaborado_por_nombre || JSON.stringify(inf.firmas || {}))), String(inf.elaborado_nombre || ""));
});

await paso("qa", "informe: recepción sin muestras y avisos de envío", async (page) => {
  await page.goto(`${BASE_WEB}/informes/${I_VACIO}`);
  await mostrarTodo(page);
  await page.locator("#i-alc").waitFor();
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  const faltan = await popup(page);
  check("[cob:M:M-208] recepción sin muestras → «La recepción elegida no tiene muestras para informar»", /La recepción elegida no tiene muestras para informar/.test(faltan), faltan.slice(0, 300));
  await page.goto(`${BASE_WEB}/informes/${I_AUT}`);
  await page.getByText(/Libera el informe para generar el PDF final/).waitFor();
  check("[cob:M:M-234] autorizado: «Libera el informe para generar el PDF final…»", true);
});

/* Envío manual (fecha, hora y observaciones). */
const L3 = await informeLiberado(t, `UIE${s5}`);
await paso("patricia", "envío manual: fecha, hora y observaciones", async (page) => {
  await page.goto(`${BASE_WEB}/informes/${L3.informe}`);
  await page.locator("#envio-nombre").waitFor();
  await page.fill("#envio-nombre", "Cliente cobertura");
  await page.fill("#envio-correo", "cliente@ejemplo.mx");
  await page.fill("#envio-fecha", "");
  await page.fill("#envio-hora", "");
  await page.getByRole("button", { name: "Registrar envío" }).click();
  const faltan = await popup(page);
  check("[cob:M:M-229] envío manual sin fecha ni hora → «Indica la fecha del envío» e «Indica la hora del envío»", /Indica la fecha del envío/.test(faltan) && /Indica la hora del envío/.test(faltan), faltan.slice(0, 300));
  await page.fill("#envio-fecha", hoy());
  await page.fill("#envio-hora", "11:45");
  await page.locator("#envio-evidencia").setInputFiles({ name: "correo-enviado.pdf", mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n% evidencia de envío ${s5}\n%%EOF`) });
  await page.fill("#envio-obs", "Enviado con copia a la coordinación");
  await page.getByRole("button", { name: "Registrar envío" }).click();
  await esperar(async () => !!fila("SELECT id FROM envios_informe WHERE informe_id = ?", L3.informe));
  const e = fila("SELECT * FROM envios_informe WHERE informe_id = ? ORDER BY id DESC", L3.informe);
  check("[cob:M:M-229] [cob:M:M-231] el envío guarda la fecha y hora capturadas y las observaciones", !!e && String(e.observaciones || "") === "Enviado con copia a la coordinación" && /\d{4}-\d{2}-\d{2}T\d{2}:45/.test(String(e.enviado_en || "")), JSON.stringify(e ? { enviado_en: e.enviado_en, observaciones: e.observaciones } : null));
});

/* Marcas de la lista: retenido y requiere enmienda. */
const L4 = await informeLiberado(t, `UIQ${s5}`);
const enmA = (await api("POST", `/samples/analysis/${L4.A}/enmendar`, { motivo: "Se corrige la unidad del resultado" }, t.qa)).data?.id;
await flujoAnalisis(enmA);
const L5 = await informeLiberado(t, `UIZ${s5}`);
const inc = await api("POST", "/calidad/incidencias", { tipo: "falla_equipo", fecha_hora_ocurrencia: new Date().toISOString(), descripcion: `Equipo de la prueba de cobertura UI ${s5} fuera de especificación`, impacto_resultados: "si", accion_inmediata: "Se retiró de uso", registros: [{ entidad: "informes", entidad_id: L5.informe }] }, t.luis);
const esc = await api("POST", `/calidad/incidencias/${inc.data?.id}/evaluar`, { decision: "escalar", justificacion: "Puede afectar resultados de la prueba", nc: { clasificacion: "menor", requisito_incumplido: "ISO/IEC 17025 7.8" } }, t.ricardo);
const ret = await api("POST", `/calidad/nc/${esc.data?.nc_id}/retenciones`, { informe_id: L5.informe, motivo: "Resultados en duda (prueba de cobertura)" }, t.ana);
await paso("qa", "informes: marcas de retenido y requiere enmienda en la lista", async (page) => {
  await page.goto(`${BASE_WEB}/informes`);
  const buscar = page.getByRole("searchbox").or(page.getByPlaceholder(/Buscar/)).first();
  await buscar.fill(`UIQ${s5}`);
  const filaEnm = page.getByRole("row").filter({ hasText: `UIQ${s5}` }).first();
  await filaEnm.waitFor();
  check("[cob:M:M-203] «Requiere enmienda» marcado en la fila", Number(fila("SELECT requiere_enmienda FROM informes WHERE id = ?", L4.informe)?.requiere_enmienda) === 1 && (await filaEnm.locator("[data-requiere-enmienda]").count()) === 1);
  await buscar.fill(`UIZ${s5}`);
  const filaRet = page.getByRole("row").filter({ hasText: `UIZ${s5}` }).first();
  await filaRet.waitFor();
  check("[cob:M:M-203] «Retenido por una no conformidad» marcado en la fila", ret.status === 201 && (await filaRet.locator("[data-retenido]").count()) === 1 && (await filaRet.locator("[data-requiere-enmienda]").count()) === 0, `${ret.status} ${ret.data?.message || ""}`);
});

/* ================= Visor ================= */
const L2 = await informeLiberado(t, `UIV${s5}`);
const enmI = (await api("POST", `/informes/${L2.informe}/enmienda`, { motivo: "Corrección del nombre del cliente" }, t.qa)).data?.id;
await api("POST", `/informes/${enmI}/revisar`, {}, t.ricardo);
await api("POST", `/informes/${enmI}/autorizar`, {}, t.patricia);
const libEnm = await liberar(process.env.BASE, t.patricia, enmI);
const I_ANUL = (await api("POST", "/informes", { recepcion_id: cAut.R, analisis_ids: [], cliente: { nombre: `Cliente anulado ${s5}` } }, t.qa)).data?.id;
await api("POST", `/informes/${I_ANUL}/anular`, { motivo: "Borrador duplicado de la prueba" }, t.patricia);
check("(preparación) enmienda liberada y borrador anulado", libEnm.status === 200 && fila("SELECT estado FROM informes WHERE id = ?", L2.informe)?.estado === "sustituido" && fila("SELECT estado FROM informes WHERE id = ?", I_ANUL)?.estado === "anulado", `${libEnm.status} ${fila("SELECT estado FROM informes WHERE id = ?", L2.informe)?.estado}`);

await paso("qa", "visor de informes: versiones, encabezado, descarga y avisos", async (page) => {
  await page.goto(`${BASE_WEB}/informes/${enmI}/ver`);
  const version = page.getByLabel("Versión del informe");
  await version.waitFor();
  const opciones = await version.locator("option").allTextContents();
  check("[cob:M:M-237] «Versión del informe» lista las versiones con PDF", opciones.includes("Versión 1") && opciones.includes("Versión 2"), opciones.join(","));
  await page.getByRole("button", { name: "Ocultar encabezado" }).click();
  const mostrar = page.getByRole("button", { name: "Mostrar encabezado" });
  await mostrar.waitFor();
  check("[cob:M:M-238] «Ocultar encabezado» lo oculta y deja «Mostrar encabezado»", (await version.count()) === 0);
  await mostrar.click();
  await version.waitFor();
  const [descarga] = await Promise.all([page.waitForEvent("download"), page.locator("[data-visor]").getByRole("button", { name: "Descargar", exact: true }).click()]);
  check("[cob:M:M-239] «Descargar» baja el PDF del informe", /\.pdf$/i.test(descarga.suggestedFilename()) && !/vista-previa/.test(descarga.suggestedFilename()), descarga.suggestedFilename());
  check("[cob:M:M-239] «Imprimir» está en la barra del visor", (await page.locator("[data-visor]").getByRole("button", { name: "Imprimir", exact: true }).count()) === 1);
  await version.selectOption({ label: "Versión 1" });
  await page.waitForURL((url) => url.pathname === `/informes/${L2.informe}/ver`);
  const sustituida = page.getByText("Versión sustituida");
  await sustituida.waitFor();
  const aSucesor = page.getByRole("link", { name: "v2" });
  check("[cob:M:M-237] [cob:M:M-240] cambiar de versión abre la v1 con «Versión sustituida» y enlace a la v2", (await aSucesor.getAttribute("href")) === `/informes/${enmI}/ver`, await aSucesor.getAttribute("href"));
  await page.goto(`${BASE_WEB}/informes/${I_ANUL}/ver`);
  await page.getByText("Informe anulado").waitFor();
  const ficha = page.getByRole("link", { name: "Abrir la ficha del informe" });
  check("[cob:M:M-240] anulado sin PDF final: «Vista previa sin validez» (con enlace a la ficha) e «Informe anulado»", (await page.getByText("Vista previa sin validez").count()) === 1 && (await ficha.getAttribute("href")) === `/informes/${I_ANUL}`, await ficha.getAttribute("href"));
});

await nav.cerrar();
terminar();
