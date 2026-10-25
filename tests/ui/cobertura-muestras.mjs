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
const { abrirNavegador, BASE_WEB, contrasena, dialogoMotivo, entendido, esperar, firmar, mostrarTodo, toast } = await import("../lib/navegador.mjs");
const { analisisDe, api, cadena, crearCheck, credenciales, Database, EMAIL, fila, filas, hoy, informeLiberado, sesiones } = await import("../lib/calidad.mjs");
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


/* ================= Segunda pasada: piezas compartidas, menús, diálogos, etiquetas y supervisión ================= */
{
  const solicitudDe = (tipo, entidad, entidadId) => fila("SELECT id, datos_json FROM solicitudes_autorizacion WHERE tipo = ? AND entidad = ? AND entidad_id = ? AND estado = 'pendiente' ORDER BY id DESC", tipo, entidad, String(entidadId));
  const cancelarTodas = async (entidad, entidadId) => {
    for (let i = 0; i < 3 && pendienteDe(entidad, entidadId); i += 1) await cancelar(entidad, entidadId);
  };
  /* Si el servidor pide reautenticación («Confirma tu identidad»), se confirma con la contraseña de quien actúa. */
  const confirmarSiPide = async (page, quien, listo) => {
    const dialogo = page.getByRole("dialog", { name: "Confirma tu identidad" });
    const cual = await Promise.race([dialogo.waitFor({ timeout: 30_000 }).then(() => "reauth"), listo().then(() => "listo")]).catch(() => "nada");
    if (cual === "reauth") {
      await contrasena(page, pwd(quien));
      await listo();
    }
    return cual;
  };
  const maxFolio = (tabla) => Number(fila(`SELECT MAX(folio_num) AS m FROM ${tabla}`)?.m || 0);
  const ID_REG = `UXR-${s5}`;
  const R_REG = await nuevaR(ID_REG);
  const ID_ACE = `UXA-${s5}`;
  const R_ACE = await nuevaR(ID_ACE, { decision_aceptacion: "aceptada", aceptacion: ACEPTACION });
  const ID_RIC = `UXC-${s5}`;
  const R_RIC = await nuevaR(ID_RIC, { analisis: { tipos: ["acido_domoico"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] } }, t.ricardo);
  const ID_RE1 = `UXJ-${s5}`;
  const R_RE1 = await nuevaR(ID_RE1, { inspeccion: insp(true), decision_aceptacion: "rechazada", aceptacion: ACEPTACION }, t.ricardo);
  const ID_RE2 = `UXK-${s5}`;
  const R_RE2 = await nuevaR(ID_RE2, { inspeccion: insp(true), decision_aceptacion: "rechazada", aceptacion: ACEPTACION }, t.ricardo);
  const ID_ANU = `UXN-${s5}`;
  const R_ANU = await nuevaR(ID_ANU);
  const ID_LOT = `UXL-${s5}`;
  const R_LOT = await nuevaR(ID_LOT, { muestra_unica: false, id_interno: null, lote_muestras: [{ trabajar: true, id_interno: `${ID_LOT}-1` }, { trabajar: true, id_interno: `${ID_LOT}-2` }], decision_aceptacion: "aceptada", aceptacion: ACEPTACION });
  const ID_MAR = `UXM-${s5}`;
  const R_MAR = await nuevaR(ID_MAR, {}, t.mariana);
  /* Cuenta propia con dos roles (Técnico Auxiliar y Técnico Analista): elige con qué cargo actúa. */
  const rolAnalista = roles.find((r) => r.nombre === "Técnico Analista")?.id;
  const emailDos = `cob.ui.dosroles.${s5}@ficotox.local`;
  await api("POST", "/admin/usuarios", { nombre: `Cobertura Dos Roles ${s5}`, email: emailDos, activo: true, rol_id: rolAuxiliar, departamento: "Laboratorio", password: PASS, motivo: "Alta de la prueba de cobertura" }, t.qa);
  ejecutar("UPDATE usuarios SET debe_cambiar_password = 0 WHERE email = ?", emailDos);
  const dosRoles = { email: emailDos, password: PASS, id: Number(fila("SELECT id FROM usuarios WHERE email = ?", emailDos)?.id) };
  const segundoRol = await api("POST", `/admin/usuarios/${dosRoles.id}/roles`, { rol_id: rolAnalista, motivo: "Segundo rol de la prueba de cobertura" }, t.qa);
  const rolesDos = Number(fila("SELECT COUNT(*) AS n FROM usuario_roles WHERE usuario_id = ? AND revocado_en IS NULL", dosRoles.id)?.n || 0);
  check("(preparación 2) recepciones propias y cuenta con dos roles", [R_REG, R_ACE, R_RIC, R_RE1, R_RE2, R_ANU, R_LOT, R_MAR].every(Boolean) && rolesDos === 2, `${[R_REG, R_ACE, R_RIC, R_RE1, R_RE2, R_ANU, R_LOT, R_MAR].join(",")} roles=${rolesDos} ${segundoRol.status} ${segundoRol.data?.message || ""}`);

  /* ---------- Piezas compartidas de las fichas (FormPage) ---------- */
  await paso("qa", "fichas: volver, secciones, modo de lectura, «Continuar» y aviso de faltantes", async (page) => {
    const antes = maxFolio("muestras_recepcion");
    await page.goto(`${BASE_WEB}/muestras/recepcion/nueva`);
    const secciones = page.getByRole("navigation", { name: "Secciones del formato" });
    await secciones.waitFor();
    await esperar(async () => (await page.locator("#r-folio").inputValue()) !== "");
    const folio = Number(await page.locator("#r-folio").inputValue());
    const despues = maxFolio("muestras_recepcion");
    check("[cob:M:M-043] folio de una recepción nueva: se propone el siguiente disponible con «Se sugiere el siguiente disponible.»", folio >= antes + 1 && folio <= despues + 1 && (await page.getByText("Se sugiere el siguiente disponible.").count()) === 1 && !(await page.locator("#r-folio").getAttribute("readonly")), `${folio} entre ${antes + 1} y ${despues + 1}`);
    const volver = page.getByRole("link", { name: "Recepciones", exact: true });
    check("[cob:M:M-001] enlace ← «Recepciones» (aria-label) a la lista", (await volver.getAttribute("href")) === "/muestras/recepcion", await volver.getAttribute("href"));
    const botones = secciones.getByRole("button");
    const nombres = (await botones.allTextContents()).join(" | ");
    const activo = async () => (await secciones.locator('button[aria-current="step"]').textContent()) || "";
    check("[cob:M:M-002] la guía lista cada sección y marca la activa con aria-current=step", ["Recepción", "Muestra", "Análisis solicitado", "Inspección visual", "Decisión de aceptación", "Solicitante", "Custodio y resguardo"].every((n) => nombres.includes(n)) && /Recepción/.test(await activo()), `${nombres} [${await activo()}]`);
    const modo = page.getByRole("radiogroup", { name: "Modo de lectura" });
    const pasoAPaso = modo.getByRole("radio", { name: /Paso a paso/ });
    const todo = modo.getByRole("radio", { name: /Todo/ });
    check("[cob:M:M-003] «Modo de lectura» (radiogroup) con «Paso a paso» activo y «Todo»", (await pasoAPaso.getAttribute("aria-checked")) === "true" && (await todo.getAttribute("aria-checked")) === "false");
    check("[cob:M:M-005] en paso a paso solo la sección activa está abierta; las demás son botones plegados", (await page.locator("#sec-muestra > button[aria-expanded=false]").count()) === 1 && (await page.locator("#r-solicitante").isVisible()) && !(await page.locator("#r-id").isVisible()));
    await page.locator("#sec-recepcion").getByRole("button", { name: /Continuar/ }).click();
    await esperar(async () => /Muestra/.test(await activo()));
    check("[cob:M:M-006] «Continuar» abre la sección siguiente", /^\d*Muestra/.test((await activo()).trim()) && (await page.locator("#r-id").isVisible()), await activo());
    await page.locator("#sec-muestra").getByRole("button", { name: /Continuar/ }).click();
    await esperar(async () => /Análisis solicitado/.test(await activo()));
    const plegada = page.locator("#sec-muestra > button[aria-expanded=false]");
    check("[cob:M:M-005] la sección visitada e incompleta queda plegada con la insignia «Faltan datos»", (await plegada.count()) === 1 && /Faltan datos/.test((await plegada.textContent()) || ""), (await plegada.textContent())?.slice(0, 120));
    await secciones.getByRole("button", { name: /Solicitante/ }).click();
    await esperar(async () => /Solicitante/.test(await activo()));
    check("[cob:M:M-002] pulsar una sección de la guía la abre y la marca activa", (await page.locator("#r-sol-nombre").isVisible()), await activo());
    await todo.click();
    await esperar(async () => (await todo.getAttribute("aria-checked")) === "true");
    check("[cob:M:M-003] «Todo» despliega todas las secciones", (await page.locator("#r-id").isVisible()) && (await page.locator("#r-solicitante").isVisible()) && (await page.locator("section[id^=sec-] > button[aria-expanded=false]").count()) === 0);

    /* Reglas del alta: lo que la pantalla exige antes de llamar al servidor. */
    await page.fill("#r-fecha", "");
    await page.locator("#r-recibido").selectOption("");
    await page.locator("#persona-custodio").selectOption("");
    const peticiones = [];
    page.on("request", (r) => r.method() === "POST" && r.url().endsWith("/api/samples/reception") && peticiones.push(r.url()));
    await page.getByRole("button", { name: "Registrar recepción" }).click();
    const faltan = await popup(page);
    check("[cob:M:M-044] sin fecha → «Indica la fecha de recepción»", /Indica la fecha de recepción/.test(faltan), faltan.slice(0, 200));
    check("[cob:M:M-046] sin medio → «Elige el medio de recepción»", /Elige el medio de recepción/.test(faltan), faltan.slice(0, 300));
    check("[cob:M:M-047] sin cuenta en «Recibido por» → «Elige quién recibe la muestra»", /Elige quién recibe la muestra/.test(faltan), faltan.slice(0, 300));
    check("[cob:M:M-048] sin solicitante → «Indica el solicitante»", /Indica el solicitante/.test(faltan), faltan.slice(0, 300));
    check("[cob:M:M-051] sin ID interno → «Indica el ID interno»", /Indica el ID interno/.test(faltan), faltan.slice(0, 300));
    check("[cob:M:M-070] sin nombre de quien entrega → «Indica el nombre de quien entrega»", /Indica el nombre de quien entrega/.test(faltan), faltan.slice(0, 600));
    check("[cob:M:M-072] sin firma de conformidad → «Falta la firma de quien entrega (conformidad)»", /Falta la firma de quien entrega \(conformidad\)/.test(faltan), faltan.slice(0, 600));
    check("[cob:M:M-073] sin la casilla «He revisado la información…» → «Marca la casilla de conformidad»", /Marca la casilla de conformidad/.test(faltan), faltan.slice(0, 600));
    check("[cob:M:M-074] custodio sin nombre ni firma → «Elige al custodio» y «Falta la firma de quien registra (custodio)»", /Elige al custodio/.test(faltan) && /Falta la firma de quien registra \(custodio\)/.test(faltan), faltan.slice(0, 700));
    check("[cob:M:M-082] «Registrar recepción» con reglas incumplidas no envía nada al servidor", peticiones.length === 0, peticiones.join(","));
    const aviso = page.locator("[data-aviso-faltantes]");
    const textoAviso = (await aviso.textContent()) || "";
    check("[cob:M:M-007] aviso role=status «Falta información en:» con un botón por sección", (await aviso.getAttribute("role")) === "status" && /Falta información en:/.test(textoAviso) && (await aviso.getByRole("button", { name: "Solicitante" }).count()) === 1 && (await aviso.getByRole("button", { name: "Custodio" }).count()) === 1, textoAviso.slice(0, 200));
    await aviso.getByRole("button", { name: "Custodio" }).click();
    await esperar(async () => /Custodio/.test(await activo()));
    check("[cob:M:M-007] el botón de la sección lleva a ella (la guía la marca activa)", /Custodio/.test(await activo()), await activo());
    await page.locator("#r-recibido").selectOption(String(id.ricardo));
    await page.locator("#firma-password").waitFor();
    check("[cob:M:M-047] elegir otra cuenta en «Recibido por» pide su contraseña («Contraseña de …»)", (await page.getByText(/Contraseña de Ricardo/).count()) >= 1);
    await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
    await page.getByRole("button", { name: "Cancelar", exact: true }).first().click();
    await page.waitForURL((url) => url.pathname === "/muestras/recepcion");
    check("[cob:M:M-077] «Cancelar» en una recepción nueva vuelve a la lista sin registrar", peticiones.length === 0);
  });

  /* Móvil: pestañas de Muestras y «Mostrar todo». */
  await paso("qa", "móvil: pestañas de Muestras y «Mostrar todo» en la ficha", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/recepcion`);
    const pestanas = page.getByRole("navigation", { name: "Secciones" });
    await pestanas.waitFor();
    const enlaces = await pestanas.getByRole("link").allTextContents();
    check("[cob:M:M-019] en móvil la lista lleva pestañas Recepción · Procesamiento · Extracción · Análisis", ["Recepción", "Procesamiento", "Extracción", "Análisis"].every((n) => enlaces.some((e) => e.includes(n))) && (await pestanas.getByRole("link", { name: /Recepción/ }).getAttribute("aria-current")) === "page", enlaces.join(","));
    await pestanas.getByRole("link", { name: /Procesamiento/ }).click();
    await page.waitForURL((url) => url.pathname === "/muestras/procesamiento");
    check("[cob:M:M-019] la pestaña «Procesamiento» abre su lista", true);
    await page.goto(`${BASE_WEB}/muestras/recepcion/nueva`);
    const mostrar = page.getByRole("button", { name: "Mostrar todo" });
    await mostrar.waitFor();
    check("[cob:M:M-004] en móvil no hay «Modo de lectura»: botón «Mostrar todo» y solo la primera sección abierta", (await page.getByRole("radiogroup", { name: "Modo de lectura" }).isVisible().catch(() => false)) === false && !(await page.locator("#r-id").isVisible()));
    await mostrar.click();
    await page.getByRole("button", { name: "Paso a paso" }).waitFor();
    check("[cob:M:M-004] «Mostrar todo» despliega las secciones y cambia a «Paso a paso»", (await page.locator("#r-id").isVisible()) && (await page.locator("#r-solicitante").isVisible()));
  }, { viewport: { width: 400, height: 800 } });

  /* ---------- Recepción en edición: inspección, decisión con desviación, comunicación y «Recibido por» ---------- */
  await paso("qa", "recepción: decisión, comunicación al cliente, inspección y firmante (edición)", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/recepcion/${R_REG}`);
    await mostrarTodo(page);
    await page.locator("#r-folio").waitFor();
    check("[cob:M:M-043] en edición el folio es de solo lectura: «Ya no se edita; usa «Cambiar folio…».»", (await page.locator("#r-folio").getAttribute("readonly")) !== null && (await page.getByText("Ya no se edita; usa «Cambiar folio…».").count()) === 1);
    const grupos = page.locator('#sec-inspeccion [role="radiogroup"]');
    for (let i = 0; i < (await grupos.count()); i += 1) await grupos.nth(i).getByRole("radio", { name: i === 0 ? "NC" : i === 6 ? "NA" : "C", exact: true }).click();
    const aceptada = page.locator("#r-decision label[data-bloqueada]").first();
    check("[cob:M:M-064] con un requisito en NC «Aceptada» queda bloqueada (data-bloqueada)", (await aceptada.count()) === 1 && /Aceptada/.test((await aceptada.textContent()) || "") && !/desviación/.test((await aceptada.textContent()) || ""), (await aceptada.textContent())?.slice(0, 80));
    // La opción lleva aria-disabled: se pulsa como una persona (sin la espera de «habilitado»).
    await aceptada.click({ force: true });
    const bloqueo = await popup(page);
    check("[cob:M:M-064] pulsar «Aceptada» con NC explica «No se puede marcar «Aceptada»» (ISO/IEC 17025 7.4.3) y no la marca", /No se puede marcar «Aceptada»/.test(bloqueo) && /7\.4\.3/.test(bloqueo) && (await page.locator("#r-decision input:checked").count()) === 0, bloqueo.slice(0, 200));
    await page.locator("#r-decision").getByRole("radio", { name: /Aceptada con desviación/ }).check();
    await page.locator("#r-com-fecha").waitFor();
    await page.fill("#r-acep-fecha", "");
    await page.locator("#r-acep-resp").selectOption("");
    await page.fill("#r-com-fecha", "");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    const faltan = await popup(page);
    check("[cob:M:M-065] con decisión y sin fecha → «Indica la fecha de la decisión»", /Indica la fecha de la decisión/.test(faltan), faltan.slice(0, 300));
    check("[cob:M:M-066] con decisión y sin responsable → «Indica el responsable de la decisión»", /Indica el responsable de la decisión/.test(faltan), faltan.slice(0, 300));
    check("[cob:M:M-069] desviación sin fecha ni medio de la comunicación → «Indica la fecha de la comunicación al cliente» y «Elige el medio…»", /Indica la fecha de la comunicación al cliente/.test(faltan) && /Elige el medio de la comunicación al cliente/.test(faltan), faltan.slice(0, 400));
    await page.fill("#r-obs-insp", "Hielera con la tapa rota");
    await page.fill("#r-acep-fecha", hoy());
    const opciones = await page.locator("#r-acep-resp option").allTextContents();
    await page.locator("#r-acep-resp").selectOption({ label: opciones.find((o) => o.includes("QA")) || opciones.find((o) => o.trim() && !/Selecciona|Elige|Otra/.test(o)) });
    await page.fill("#r-acep-temp", "6 °C");
    await page.fill("#r-com-fecha", hoy());
    await page.locator("#r-com-medio").selectOption({ index: 1 });
    const medio = await page.locator("#r-com-medio").inputValue();
    await page.fill("#r-com-persona", "Lic. Ana Cliente");
    await page.fill("#r-com-resp", "Pide continuar con el análisis");
    await page.locator("#r-recibido").selectOption(String(id.ricardo));
    await page.locator("#firma-password").fill(pwd("ricardo"));
    await page.getByRole("button", { name: "Confirmar firma" }).click();
    await page.locator("#firma-password").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await guardarDeTodosModos(page);
    const reauth = await confirmarSiPide(page, "qa", () => page.waitForURL((url) => url.pathname === "/muestras/recepcion"));
    const r = await recepcion(R_REG);
    const com = r?.aceptacion?.comunicacion_cliente || {};
    check("[cob:M:M-082] «Guardar cambios» guarda la recepción (PUT) y vuelve a la lista; con muestras:A la desviación se aplica directo tras reautenticar", r?.decision_aceptacion === "aceptada_con_desviacion" && reauth === "reauth", `${r?.decision_aceptacion} ${reauth}`);
    check("[cob:M:M-063] «Observaciones generales» de la inspección se guarda", r?.inspeccion?.observaciones_generales === "Hielera con la tapa rota", JSON.stringify(r?.inspeccion || {}).slice(0, 200));
    check("[cob:M:M-065] [cob:M:M-066] [cob:M:M-067] fecha, responsable y temperatura de llegada de la decisión se guardan", r?.aceptacion?.fecha === hoy() && /QA/.test(String(r?.aceptacion?.responsable || "")) && r?.aceptacion?.temperatura_llegada === "6 °C", JSON.stringify(r?.aceptacion || {}).slice(0, 300));
    check("[cob:M:M-069] la comunicación al cliente (fecha, medio, persona, respuesta) se guarda", com.fecha === hoy() && com.medio === medio && com.persona === "Lic. Ana Cliente" && com.respuesta === "Pide continuar con el análisis", JSON.stringify(com));
    check("[cob:M:M-047] «Recibido por» otra cuenta con su contraseña: queda su nombre", /Ricardo/.test(String(r?.recibido_por || "")), r?.recibido_por);
  });

  /* Sin muestras:A la desviación o el rechazo quedan como solicitud. */
  await paso("mariana", "recepción: rechazo sin muestras:A → «La decisión quedará como solicitud»", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/recepcion/${R_MAR}`);
    await mostrarTodo(page);
    await page.locator("#r-folio").waitFor();
    const grupos = page.locator('#sec-inspeccion [role="radiogroup"]');
    for (let i = 0; i < (await grupos.count()); i += 1) await grupos.nth(i).getByRole("radio", { name: i === 0 ? "NC" : i === 6 ? "NA" : "C", exact: true }).click();
    await page.locator("#r-decision").getByRole("radio", { name: /^Rechazada/ }).check();
    await page.fill("#r-acep-fecha", hoy());
    const opciones = await page.locator("#r-acep-resp option").allTextContents();
    await page.locator("#r-acep-resp").selectOption({ label: opciones.find((o) => o.trim() && !/Selecciona|Elige|Otra/.test(o)) });
    await page.fill("#r-com-fecha", hoy());
    await page.locator("#r-com-medio").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await guardarDeTodosModos(page);
    const dialogo = page.getByRole("dialog", { name: "La decisión quedará como solicitud" });
    await dialogo.waitFor();
    await dialogo.getByRole("button", { name: "Guardar y solicitar" }).click();
    await confirmarSiPide(page, "mariana", () => page.waitForURL((url) => url.pathname === "/muestras/recepcion"));
    const sol = await esperar(() => solicitudDe("decision_recepcion", "muestras_recepcion", R_MAR));
    const r = await recepcion(R_MAR);
    check("[cob:M:M-076] «Guardar y solicitar»: la recepción se guarda sin la decisión y queda la solicitud decision_recepcion", !!sol && !r?.decision_aceptacion, `${JSON.stringify(sol)} ${r?.decision_aceptacion}`);
  });
  await cancelarTodas("muestras_recepcion", R_MAR);

  /* ---------- Recepción: lista, filtros, interruptores y menú ⋯ ---------- */
  const filtro = async (page, grupo, opcion) => {
    await page.getByRole("button", { name: /^Filtros/ }).click();
    await page.locator(`section[aria-label="${grupo}"]`).getByRole("switch", { name: opcion, exact: true }).click();
    await page.keyboard.press("Escape");
  };
  const quitarFiltro = async (page, opcion) => {
    await page.getByRole("button", { name: `Quitar filtro ${opcion}` }).click();
    await page.getByRole("button", { name: `Quitar filtro ${opcion}` }).waitFor({ state: "detached" });
  };
  const hay = async (page, texto) => (await page.getByRole("row").filter({ hasText: texto }).count()) > 0;
  const asignarAQa = (R) => api("POST", `/samples/reception/${R}/asignaciones`, { usuario_id: id.qa, motivo: "Asignación de la prueba de cobertura" }, t.ricardo);
  const enCurso = ((await api("GET", "/inicio/en-curso", undefined, t.qa)).data?.items || []).reduce((m, r) => m.set(Number(r.id), r.etapa_flujo), new Map());
  await paso("qa", "recepción: lista, filtros, interruptores y menú ⋯ por estado", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/recepcion`);
    const nueva = page.getByRole("link", { name: "Nueva recepción" });
    await nueva.waitFor();
    check("[cob:M:M-021] «Nueva recepción» enlaza al alta", (await nueva.getAttribute("href")) === "/muestras/recepcion/nueva", await nueva.getAttribute("href"));
    const buscar = page.getByPlaceholder("Buscar por folio, solicitante o ID interno");
    await buscar.fill(ID_REG);
    await page.getByRole("row").filter({ hasText: ID_REG }).first().waitFor();
    await esperar(async () => !(await hay(page, ID_ACE)));
    check("[cob:M:M-022] el buscador filtra por ID interno (solo queda esa recepción)", (await hay(page, ID_REG)) && !(await hay(page, ID_ACE)) && !(await hay(page, ID_ANU)));
    await buscar.fill(`-${s5}`);
    for (const x of [ID_ACE, ID_ANU, ID_RIC]) await page.getByRole("row").filter({ hasText: x }).first().waitFor();

    await filtro(page, "Etapa del flujo", "Procesamiento");
    await esperar(async () => !(await hay(page, ID_ANU)));
    check("[cob:M:M-024] «Etapa del flujo · Procesamiento» (de /inicio/en-curso): queda la aceptada sin procesar, no la registrada", enCurso.get(Number(R_ACE)) === "procesamiento" && enCurso.get(Number(R_ANU)) === "recepcion" && (await hay(page, ID_ACE)) && !(await hay(page, ID_ANU)), `${enCurso.get(Number(R_ACE))} ${enCurso.get(Number(R_ANU))}`);
    await quitarFiltro(page, "Procesamiento");
    await filtro(page, "Aceptación", "Sin decisión");
    await esperar(async () => !(await hay(page, ID_ACE)));
    check("[cob:M:M-025] «Aceptación · Sin decisión»: solo las que no tienen decisión", (await hay(page, ID_ANU)) && !(await hay(page, ID_ACE)) && !(await hay(page, ID_RE1)));
    await quitarFiltro(page, "Sin decisión");
    await filtro(page, "Análisis", "ASP");
    await esperar(async () => !(await hay(page, ID_ACE)));
    check("[cob:M:M-026] «Análisis · ASP»: solo las que piden ácido domoico", (await hay(page, ID_RIC)) && !(await hay(page, ID_ACE)));
    await quitarFiltro(page, "ASP");
    await filtro(page, "Vista", "Mis muestras");
    await esperar(async () => !(await hay(page, ID_RIC)));
    check("[cob:M:M-027] «Mis muestras»: oculta la que registró otra persona y no está asignada", (await hay(page, ID_ACE)) && !(await hay(page, ID_RIC)));
    await quitarFiltro(page, "Mis muestras");
    await page.getByRole("row").filter({ hasText: ID_RIC }).first().waitFor();

    await menuDeFila(page, ID_ACE);
    const menuAce = await opcionesMenu(page);
    check("[cob:M:M-032] [cob:M:M-035] [cob:M:M-036] [cob:M:M-039] una aceptada ofrece Abrir, Imprimir etiqueta, Cambiar folio… y Reportar incidencia (sin Reabrir…)", ["Abrir", "Imprimir etiqueta", "Cambiar folio…", "Reportar incidencia"].every((o) => menuAce.includes(o)) && !menuAce.includes("Reabrir…"), menuAce.slice(0, 300));
    check("[cob:M:M-037] «Reabrir…» no se ofrece en una aceptada", !menuAce.includes("Reabrir…"));
    await page.getByRole("menuitem", { name: /Reportar incidencia/ }).click();
    const hoja = page.getByRole("dialog", { name: "Reportar incidencia" });
    await hoja.waitFor();
    const ligado = (await hoja.locator("[data-reportar-incidencia]").textContent()) || "";
    const folioAce = `R ${String((await recepcion(R_ACE)).folio_num).padStart(7, "0")}`;
    check("[cob:M:M-039] «Reportar incidencia» abre la hoja con la recepción ya ligada", ligado.includes(folioAce), `${folioAce} · ${ligado.slice(0, 120)}`);
    await hoja.getByRole("button", { name: "Cancelar" }).click();
    await hoja.waitFor({ state: "detached" });
    await menuDeFila(page, ID_RE1);
    const menuRech = await opcionesMenu(page);
    check("[cob:M:M-036] [cob:M:M-037] una rechazada ofrece «Reabrir…» y no «Cambiar folio…»", menuRech.includes("Reabrir…") && !menuRech.includes("Cambiar folio…"), menuRech.slice(0, 300));
    await page.keyboard.press("Escape");

    /* Anular (diálogo crítico) y restaurar (solicitud). */
    await menuDeFila(page, ID_ANU);
    await page.getByRole("menuitem", { name: "Anular recepción…" }).click();
    const dialogo = page.getByRole("dialog", { name: /^Anular recepción R/ });
    await dialogo.waitFor();
    await dialogo.getByRole("button", { name: "Anular", exact: true }).click();
    const vacio = await popup(page);
    check("[cob:M:M-010] [cob:M:M-011] [cob:M:M-042] sin motivo ni contraseña → «Escribe el motivo» y «Escribe tu contraseña para confirmar»", /Escribe el motivo/.test(vacio) && /Escribe tu contraseña para confirmar/.test(vacio), vacio.slice(0, 200));
    await page.fill("#prompt-motivo", "abc");
    await page.fill("#prompt-password", pwd("qa"));
    await dialogo.getByRole("button", { name: "Anular", exact: true }).click();
    const corto = await popup(page);
    check("[cob:M:M-010] [cob:M:M-042] motivo de menos de 5 caracteres → «Motivo debe tener al menos 5 caracteres»; nada se anula", /Motivo debe tener al menos 5 caracteres/.test(corto) && !(await recepcion(R_ANU))?.anulado_en, corto.slice(0, 200));
    await page.fill("#prompt-motivo", "Recepción duplicada en la prueba de cobertura");
    await dialogo.getByRole("button", { name: "Anular", exact: true }).click();
    await toast(page, /anulad/i);
    const anulada = fila("SELECT estado, motivo_anulacion, anulado_por FROM muestras_recepcion WHERE id = ?", R_ANU);
    check("[cob:M:M-041] [cob:M:M-042] [cob:M:M-011] «Anular recepción…» con motivo y contraseña la anula (motivo y quién)", anulada?.estado === "anulada" && anulada?.motivo_anulacion === "Recepción duplicada en la prueba de cobertura" && Number(anulada?.anulado_por) === Number(id.qa), JSON.stringify(anulada));
    await esperar(async () => !(await hay(page, ID_ANU)));
    check("[cob:M:M-028] la anulada sale de la lista", !(await hay(page, ID_ANU)));
    await filtro(page, "Vista", "Mostrar anuladas");
    const filaAnu = page.getByRole("row").filter({ hasText: ID_ANU }).first();
    await filaAnu.waitFor();
    check("[cob:M:M-028] «Mostrar anuladas» la vuelve a mostrar marcada «Anulada»", /Anulada/.test((await filaAnu.textContent()) || ""));
    await menuDeFila(page, ID_ANU);
    const menuAnu = await opcionesMenu(page);
    check("[cob:M:M-035] [cob:M:M-036] [cob:M:M-040] una anulada ofrece «Restaurar recepción» y no «Imprimir etiqueta», «Cambiar folio…» ni «Anular recepción…»", menuAnu.includes("Restaurar recepción") && !menuAnu.includes("Imprimir etiqueta") && !menuAnu.includes("Cambiar folio…") && !menuAnu.includes("Anular recepción…"), menuAnu.slice(0, 300));
    await page.keyboard.press("Escape");

    await buscar.fill(ID_ACE);
    await menuDeFila(page, ID_ACE);
    await page.getByRole("menuitem", { name: "Imprimir etiqueta" }).click();
    await page.waitForURL((url) => url.pathname === `/muestras/recepcion/${R_ACE}/etiquetas`);
    check("[cob:M:M-035] «Imprimir etiqueta» abre la página de etiquetas", true);
    await page.goto(`${BASE_WEB}/muestras/recepcion`);
    await page.getByPlaceholder("Buscar por folio, solicitante o ID interno").fill(ID_ACE);
    await menuDeFila(page, ID_ACE);
    await page.getByRole("menuitem", { name: "Abrir" }).click();
    await page.waitForURL((url) => url.pathname === `/muestras/recepcion/${R_ACE}`);
    check("[cob:M:M-032] «Abrir» lleva a la ficha", true);
  });

  await paso("qa", "recepción anulada: aviso «Registro anulado» y «Volver»", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/recepcion/${R_ANU}`);
    const aviso = page.getByText("Registro anulado").first();
    await aviso.waitFor();
    const texto = (await page.locator("main").textContent()) || "";
    check("[cob:M:M-093] la ficha anulada muestra «Registro anulado» con «Motivo: …» y queda en solo lectura", /Motivo: Recepción duplicada en la prueba de cobertura/.test(texto) && (await page.locator("fieldset[disabled].form-readonly").count()) >= 1, texto.slice(0, 120));
    check("[cob:M:M-077] en solo lectura el botón es «Volver» (sin «Cancelar»)", (await page.getByRole("button", { name: "Volver", exact: true }).count()) >= 1 && (await page.getByRole("button", { name: "Cancelar", exact: true }).count()) === 0);
    await page.getByRole("button", { name: "Volver", exact: true }).first().click();
    await page.waitForURL((url) => url.pathname === "/muestras/recepcion");
  });
  await paso("qa", "recepción anulada: «Restaurar recepción» crítico", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/recepcion`);
    await page.getByPlaceholder("Buscar por folio, solicitante o ID interno").fill(ID_ANU);
    await filtro(page, "Vista", "Mostrar anuladas");
    await menuDeFila(page, ID_ANU);
    await page.getByRole("menuitem", { name: "Restaurar recepción" }).click();
    const dialogo = page.getByRole("dialog", { name: /^Restaurar recepción R/ });
    await dialogo.waitFor();
    check("[cob:M:M-040] [cob:M:M-042] «Restaurar recepción» abre el diálogo crítico «Restaurar recepción R …» (motivo y contraseña)", (await dialogo.locator("#prompt-password").count()) === 1);
    await dialogoMotivo(page, "Se anuló por error en la prueba de cobertura", "Restaurar", pwd("qa"));
    await toast(page, /restaurad/i);
    const r = fila("SELECT estado, anulado_en FROM muestras_recepcion WHERE id = ?", R_ANU);
    check("[cob:M:M-040] anulada desde registrada: se restaura directo a «registrada» (la bitácora guarda el motivo)", r?.estado === "registrada" && !r?.anulado_en && !!fila("SELECT id FROM auditoria WHERE accion = 'restaurar' AND entidad = 'muestras_recepcion' AND entidad_id = ? AND motivo = ?", String(R_ANU), "Se anuló por error en la prueba de cobertura") && !solicitudDe("restaurar_registro", "muestras_recepcion", R_ANU), JSON.stringify(r));
  });

  /* ---------- Cambiar folio, reabrir, disposición bloqueada, historial e incidencia en la ficha ---------- */
  const usados = new Set(filas("SELECT folio_num FROM muestras_recepcion").map((r) => Number(r.folio_num)));
  let folioLibre = 500000 + Math.floor(Math.random() * 300000);
  while (usados.has(folioLibre)) folioLibre += 1;
  await paso("qa", "recepción: «Cambiar folio…» (dos pasos), historial, incidencia y disposición bloqueada", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/recepcion/${R_ACE}`);
    await mostrarTodo(page);
    const cambiar = page.getByRole("button", { name: "Cambiar folio…" });
    await cambiar.waitFor();
    check("[cob:M:M-080] [cob:M:M-081] [cob:M:M-078] [cob:M:M-079] la ficha de una aceptada ofrece «Imprimir etiqueta», «Asignar» y «Cambiar folio…» (no «Reabrir…»)", (await page.getByRole("button", { name: "Imprimir etiqueta" }).count()) === 1 && (await page.getByRole("button", { name: "Asignar", exact: true }).count()) === 1 && (await page.getByRole("button", { name: "Reabrir…" }).count()) === 0);
    const bloqueo = page.locator("[data-testid=disposicion-bloqueo]");
    await bloqueo.waitFor();
    check("[cob:M:M-092] sin informe liberado «Registrar disposición y cerrar la muestra» está deshabilitado con el motivo", (await page.getByRole("button", { name: "Registrar disposición y cerrar la muestra" }).isDisabled()) && /la disposición final exige el informe liberado o enviado/.test((await bloqueo.textContent()) || ""), await bloqueo.textContent());
    const historial = page.locator("#sec-historial");
    const actividad = historial.getByRole("button", { name: /Actividad/ });
    await actividad.waitFor();
    const n = Number(fila("SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'muestras_recepcion' AND entidad_id = ?", String(R_ACE))?.n || 0);
    check("[cob:M:M-017] «Historial del registro» cuenta las actividades de la bitácora del registro", /Historial del registro/.test((await historial.textContent()) || "") && new RegExp(`${n} actividad`).test((await actividad.textContent()) || ""), `${n} · ${await actividad.textContent()}`);
    await actividad.click();
    check("[cob:M:M-017] al desplegarlo muestra la lista de actividad", (await actividad.getAttribute("aria-expanded")) === "true" && (await page.getByLabel("Actividad del registro").isVisible()));
    await page.locator("#sec-incidencias").getByRole("button", { name: "Reportar incidencia" }).click();
    const hoja = page.getByRole("dialog", { name: "Reportar incidencia" });
    await hoja.waitFor();
    const folioAce = `R ${String((await recepcion(R_ACE)).folio_num).padStart(7, "0")}`;
    check("[cob:M:M-018] «Reportar incidencia» de la ficha abre la hoja con el registro ligado", ((await hoja.locator("[data-reportar-incidencia]").textContent()) || "").includes(folioAce), folioAce);
    await hoja.getByRole("button", { name: "Cancelar" }).click();
    await hoja.waitFor({ state: "detached" });

    await cambiar.click();
    const paso1 = page.getByRole("dialog", { name: /^Cambiar folio de R/ });
    await paso1.waitFor();
    check("[cob:M:M-096] paso 1: «Cambiar folio de R …» con «Folio nuevo (número)»", (await paso1.getByText("Folio nuevo (número)").count()) >= 1);
    await paso1.getByRole("button", { name: "Continuar" }).click();
    const vacio = await popup(page);
    check("[cob:M:M-010] [cob:M:M-096] el folio nuevo es obligatorio (mínimo 1 carácter)", /Escribe «Folio nuevo \(número\)»/.test(vacio), vacio.slice(0, 160));
    await page.fill("#prompt-motivo", "abc");
    await paso1.getByRole("button", { name: "Continuar" }).click();
    const malo = await popup(page);
    check("[cob:M:M-096] texto no numérico → pop-up ««abc» no es un número de folio válido.»", /«abc» no es un número de folio válido\./.test(malo), malo.slice(0, 200));
    await cambiar.click();
    await page.locator("#prompt-motivo").fill(String(folioLibre));
    await page.getByRole("dialog").getByRole("button", { name: "Continuar" }).click();
    const paso2 = page.getByRole("dialog", { name: `Cambiar folio a R ${String(folioLibre).padStart(7, "0")}` });
    await paso2.waitFor();
    check("[cob:M:M-097] [cob:M:M-011] paso 2 crítico «Cambiar folio a R …» con motivo y contraseña", (await paso2.locator("#prompt-password").count()) === 1);
    await page.fill("#prompt-motivo", "Folio repetido en la libreta de campo");
    await page.fill("#prompt-password", pwd("qa"));
    await paso2.getByRole("button", { name: "Cambiar folio" }).click();
    await toast(page, /Folio cambiado/);
    check("[cob:M:M-097] con muestras:A el folio cambia directo (con su motivo en la bitácora)", Number((await recepcion(R_ACE)).folio_num) === folioLibre && !!fila("SELECT id FROM auditoria WHERE accion = 'cambiar_folio' AND entidad = 'muestras_recepcion' AND entidad_id = ? AND motivo = ?", String(R_ACE), "Folio repetido en la libreta de campo"), (await recepcion(R_ACE)).folio_num);
  });

  await paso("qa", "recepción rechazada: «Reabrir…» crítico", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/recepcion/${R_RE1}`);
    const reabrir = page.getByRole("button", { name: "Reabrir…" });
    await reabrir.waitFor();
    check("[cob:M:M-080] una rechazada no ofrece «Cambiar folio…»", (await page.getByRole("button", { name: "Cambiar folio…" }).count()) === 0);
    await reabrir.click();
    const dialogo = page.getByRole("dialog", { name: /^Reabrir R/ });
    await dialogo.waitFor();
    await page.fill("#prompt-motivo", "abc");
    await dialogo.getByRole("button", { name: "Reabrir", exact: true }).click();
    const corto = await popup(page);
    check("[cob:M:M-098] motivo < 5 y sin contraseña → no se reabre", /al menos 5 caracteres/.test(corto) && /Escribe tu contraseña/.test(corto) && fila("SELECT estado FROM muestras_recepcion WHERE id = ?", R_RE1)?.estado === "rechazada", corto.slice(0, 200));
    await page.fill("#prompt-motivo", "El cliente aclaró la temperatura de llegada");
    await page.fill("#prompt-password", pwd("qa"));
    await dialogo.getByRole("button", { name: "Reabrir", exact: true }).click();
    await toast(page, /reabierta/i);
    const r = fila("SELECT estado, decision_aceptacion FROM muestras_recepcion WHERE id = ?", R_RE1);
    check("[cob:M:M-081] [cob:M:M-098] «Reabrir…» (crítico, con muestras:A) la devuelve a registrada sin decisión", r?.estado === "registrada" && !r?.decision_aceptacion, JSON.stringify(r));
  });

  /* Sin muestras:A el cambio de folio queda como solicitud. */
  await paso("mariana", "recepción: «Cambiar folio…» sin muestras:A → solicitud", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/recepcion`);
    await page.getByPlaceholder("Buscar por folio, solicitante o ID interno").fill(ID_MAR);
    await menuDeFila(page, ID_MAR);
    await page.getByRole("menuitem", { name: "Cambiar folio…" }).click();
    await page.locator("#prompt-motivo").fill(String(folioLibre + 1));
    await page.getByRole("dialog").getByRole("button", { name: "Continuar" }).click();
    await page.getByRole("dialog", { name: /^Cambiar folio a R/ }).waitFor();
    await dialogoMotivo(page, "Folio repetido en la libreta de campo", "Cambiar folio", pwd("mariana"));
    const sol = await esperar(() => solicitudDe("cambiar_folio", "muestras_recepcion", R_MAR));
    check("[cob:M:M-097] sin muestras:A queda la solicitud cambiar_folio con el folio pedido; el folio no cambia", !!sol && JSON.parse(sol.datos_json || "{}").folio_num === folioLibre + 1 && Number((await recepcion(R_MAR)).folio_num) !== folioLibre + 1, JSON.stringify(sol));
  });
  await cancelarTodas("muestras_recepcion", R_MAR);

  /* Persona con dos roles: el diálogo crítico pregunta con qué cargo actúa. */
  await api("POST", `/samples/reception/${R_RIC}/asignaciones`, { usuario_id: dosRoles.id, motivo: "Asignación de la prueba de cobertura" }, t.ricardo);
  await paso(dosRoles, "persona con dos roles: selector «Actuar como» en el diálogo crítico", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/recepcion`);
    await page.getByPlaceholder("Buscar por folio, solicitante o ID interno").fill(ID_RIC);
    await menuDeFila(page, ID_RIC);
    await page.getByRole("menuitem", { name: "Cambiar folio…" }).click();
    await page.locator("#prompt-motivo").fill(String(folioLibre + 2));
    await page.getByRole("dialog").getByRole("button", { name: "Continuar" }).click();
    await page.getByRole("dialog", { name: /^Cambiar folio a R/ }).waitFor();
    const cargo = page.locator("#prompt-password-cargo");
    await cargo.waitFor();
    const opciones = await cargo.locator("option").allTextContents();
    check("[cob:M:M-013] con dos roles el diálogo crítico ofrece «Actuar como» con cada cargo", opciones.some((o) => o.includes("Técnico Auxiliar")) && opciones.some((o) => o.includes("Técnico Analista")), opciones.join(" | "));
    await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
    check("[cob:M:M-013] cancelar no crea solicitud", !solicitudDe("cambiar_folio", "muestras_recepcion", R_RIC));
  });

  /* ---------- Asignar ---------- */
  await paso("ricardo", "recepción: diálogo «Asignar» (lista, persona obligatoria, quitar)", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/recepcion/${R_ACE}`);
    await page.getByRole("button", { name: "Asignar", exact: true }).first().click();
    const dialogo = page.getByRole("dialog", { name: /^Asignar R/ });
    await dialogo.waitFor();
    const lista = dialogo.locator("[data-asignaciones]");
    check("[cob:M:M-079] [cob:M:M-099] «Asignar» abre «Asignar R …» con la lista «Asignada a»", /Asignada a/.test((await lista.textContent()) || ""));
    await dialogo.getByRole("button", { name: "Asignar", exact: true }).click();
    const vacio = await popup(page);
    check("[cob:M:M-101] [cob:M:M-103] «Asignar» sin persona → «Elige a la persona que trabajará la muestra»; nada se guarda", /Elige a la persona que trabajará la muestra/.test(vacio) && !fila("SELECT id FROM asignaciones_muestra WHERE recepcion_id = ? AND revocado_en IS NULL", R_ACE), vacio.slice(0, 200));
    const opciones = await page.locator("#asignar-usuario option").allTextContents();
    await page.locator("#asignar-usuario").selectOption({ label: opciones.find((o) => o.includes(sinAut.nombre)) });
    await dialogo.getByRole("button", { name: "Asignar", exact: true }).click();
    const asig = await esperar(() => fila("SELECT id FROM asignaciones_muestra WHERE recepcion_id = ? AND usuario_id = ? AND revocado_en IS NULL", R_ACE, sinAut.id));
    const renglon = dialogo.locator(`[data-asignacion="${asig?.id}"]`);
    await renglon.waitFor();
    check("[cob:M:M-099] [cob:M:M-103] tras asignar, la persona aparece en «Asignada a» (data-asignacion)", /Cobertura Sin Autorización/.test((await renglon.textContent()) || ""));
    check("[cob:M:M-101] el selector ya no ofrece a quien está asignado", !(await page.locator("#asignar-usuario option").allTextContents()).some((o) => o.includes(sinAut.nombre)));
    await renglon.getByRole("button", { name: "Quitar" }).click();
    const quitar = page.getByRole("dialog", { name: /^Quitar la asignación de/ });
    await quitar.waitFor();
    check("[cob:M:M-100] «Quitar» abre «Quitar la asignación de …» sin contraseña (no crítico)", (await quitar.locator("#prompt-password").count()) === 0);
    await page.fill("#prompt-motivo", "abc");
    await quitar.getByRole("button", { name: "Quitar asignación" }).click();
    const corto = await popup(page);
    check("[cob:M:M-100] motivo < 5 → «Motivo debe tener al menos 5 caracteres»; sigue asignada", /Motivo debe tener al menos 5 caracteres/.test(corto) && !fila("SELECT revocado_en FROM asignaciones_muestra WHERE id = ?", asig?.id)?.revocado_en, corto.slice(0, 200));
    await page.fill("#prompt-motivo", "Cambio de turno en la prueba de cobertura");
    await quitar.getByRole("button", { name: "Quitar asignación" }).click();
    await renglon.waitFor({ state: "detached" });
    const rev = fila("SELECT revocado_en, revocado_por FROM asignaciones_muestra WHERE id = ?", asig?.id);
    check("[cob:M:M-100] «Quitar asignación» revoca la asignación (queda en el historial) y la quita de la lista", !!rev?.revocado_en && Number(rev?.revocado_por) === Number(id.ricardo), JSON.stringify(rev));
    await dialogo.getByRole("button", { name: "Cerrar", exact: true }).last().click();
    await dialogo.waitFor({ state: "detached" });
    check("[cob:M:M-103] «Cerrar» cierra el diálogo", true);
  });

  /* ---------- Etiquetas ---------- */
  await paso("qa", "etiquetas: tamaño, copias, posición inicial e «Imprimir»", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/recepcion/${R_LOT}/etiquetas`);
    const resumen = page.locator("[data-resumen-etiquetas]");
    await resumen.waitFor();
    const hoja = page.locator("#etiquetas-impresion");
    check("[cob:M:M-110] resumen «2 muestras × 1 copia = 2 etiquetas» y una etiqueta por muestra del lote", /2 muestras × 1 copia = 2 etiquetas/.test((await resumen.textContent()) || "") && (await hoja.locator("[data-etiqueta]").count()) === 2 && ((await hoja.textContent()) || "").includes(`${ID_LOT}-2`), await resumen.textContent());
    const tamanos = await page.locator("#et-tamano option").evaluateAll((os) => os.map((o) => o.value));
    await page.locator("#et-tamano").selectOption("grande");
    check("[cob:M:M-106] «Tamaño»: pequeña, mediana, grande y media hoja; elegir uno cambia la hoja (data-tamano)", tamanos.join(",") === "pequena,mediana,grande,media_hoja" && (await hoja.getAttribute("data-tamano")) === "grande", tamanos.join(","));
    await page.fill("#et-copias", "3");
    await esperar(async () => (await hoja.locator("[data-etiqueta]").count()) === 6);
    check("[cob:M:M-107] «Copias por muestra» (1 a 20) multiplica las etiquetas", (await page.locator("#et-copias").getAttribute("max")) === "20" && (await hoja.locator("[data-etiqueta]").count()) === 6 && /× 3 copias = 6 etiquetas/.test((await resumen.textContent()) || ""), await resumen.textContent());
    await page.fill("#et-inicio", "3");
    await esperar(async () => (await hoja.locator(".etiqueta-vacia").count()) === 2);
    check("[cob:M:M-108] «Empezar en la posición» deja vacías las anteriores (máximo = etiquetas por hoja)", (await page.locator("#et-inicio").getAttribute("max")) === "10" && (await hoja.locator(".etiqueta-vacia").count()) === 2, await page.locator("#et-inicio").getAttribute("max"));
    await page.evaluate(() => {
      window.__impresiones = 0;
      window.print = () => {
        window.__impresiones += 1;
      };
    });
    await page.getByRole("button", { name: "Imprimir", exact: true }).click();
    await esperar(() => page.evaluate(() => window.__impresiones === 1));
    const bit = fila("SELECT cambios_json FROM auditoria WHERE accion = 'imprimir_etiquetas' AND entidad = 'muestras_recepcion' AND entidad_id = ? ORDER BY id DESC", String(R_LOT));
    check("[cob:M:M-109] «Imprimir» registra la impresión en la bitácora (tamaño, copias, inicio) y abre el diálogo de impresión", (await page.evaluate(() => window.__impresiones)) === 1 && /grande/.test(bit?.cambios_json || "") && /"copias":3/.test(bit?.cambios_json || "") && /"inicio":3/.test(bit?.cambios_json || ""), bit?.cambios_json?.slice(0, 200));
  });

  /* ---------- Disposición de una rechazada con la reautenticación global ---------- */
  await paso("ricardo", "disposición de una rechazada: motivo, responsable y «Confirma tu identidad»", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/recepcion/${R_RE2}`);
    await mostrarTodo(page);
    const motivo = page.locator("#r-disp-motivo");
    await motivo.waitFor();
    await page.locator("#r-disp-tipo").getByRole("radio").first().check();
    await page.fill("#r-disp-fecha", hoy());
    await page.locator("#r-disp-resp").selectOption("");
    await motivo.fill("abc");
    const boton = page.getByRole("button", { name: "Registrar disposición y cerrar la muestra" });
    await boton.click();
    const faltan = await popup(page);
    check("[cob:M:M-087] sin responsable → «Indica el responsable»", /Indica el responsable/.test(faltan), faltan.slice(0, 300));
    check("[cob:M:M-091] rechazada: motivo < 5 → «Indica el motivo de la disposición (al menos 5 caracteres)»", /Indica el motivo de la disposición \(al menos 5 caracteres\)/.test(faltan), faltan.slice(0, 300));
    const opciones = await page.locator("#r-disp-resp option").allTextContents();
    await page.locator("#r-disp-resp").selectOption({ label: opciones.find((o) => o.includes("Ricardo")) });
    await motivo.fill("Muestra rechazada: se desecha como RPBI");
    await boton.click();
    const reauth = page.getByRole("dialog", { name: "Confirma tu identidad" });
    await reauth.waitFor();
    await reauth.getByRole("button", { name: "Cancelar" }).click();
    await reauth.waitFor({ state: "detached" });
    check("[cob:M:M-012] «Cancelar» en «Confirma tu identidad» no registra la disposición y conserva lo capturado", fila("SELECT estado FROM muestras_recepcion WHERE id = ?", R_RE2)?.estado === "rechazada" && (await motivo.inputValue()) === "Muestra rechazada: se desecha como RPBI");
    await boton.click();
    await reauth.waitFor();
    await reauth.getByRole("button", { name: "Confirmar", exact: true }).click();
    const sinClave = await popup(page);
    check("[cob:M:M-012] «Confirmar» sin contraseña → «Escribe tu contraseña para confirmar»", /Escribe tu contraseña para confirmar/.test(sinClave), sinClave.slice(0, 160));
    await contrasena(page, pwd("ricardo"));
    await page.waitForURL((url) => url.pathname === "/muestras/recepcion");
    const r = await recepcion(R_RE2);
    check("[cob:M:M-012] [cob:M:M-087] [cob:M:M-091] con la contraseña se registra la disposición (responsable y motivo) y la muestra se cierra", r?.estado === "cerrada" && /Ricardo/.test(String(r?.disposicion?.responsable || "")) && r?.disposicion?.motivo === "Muestra rechazada: se desecha como RPBI", `${r?.estado} ${JSON.stringify({ ...(r?.disposicion || {}), firma: undefined }).slice(0, 200)}`);
  });

  /* ---------- Alcance «solo estado» ---------- */
  await paso("jorge", "recepción con alcance «estado»: vista sin datos técnicos", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/recepcion/${R_ACE}`);
    await page.getByText("Sin acceso a datos técnicos").waitFor();
    const texto = (await page.locator("main").textContent()) || "";
    check("[cob:M:M-095] alcance «estado»: «Sin acceso a datos técnicos» con estado, solicitante y fechas; sin el formato", texto.includes("Cliente cobertura UI") && /Estado/.test(texto) && (await page.locator("#r-solicitante").count()) === 0 && (await page.locator("#sec-inspeccion").count()) === 0, texto.slice(0, 200));
    await page.goto(`${BASE_WEB}/muestras/recepcion`);
    await page.getByPlaceholder("Buscar por folio, solicitante o ID interno").fill(ID_LOT);
    await menuDeFila(page, ID_LOT);
    const menu = await opcionesMenu(page);
    check("[cob:M:M-035] con alcance «estado» el menú no ofrece «Imprimir etiqueta»", menu.includes("Abrir") && !menu.includes("Imprimir etiqueta"), menu);
  });

  /* ---------- Supervisión: banner, bandeja, ventana, visto bueno y regresar ---------- */
  const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
  const nuevoP = async (R, idInt, extra = {}, token = t.qa) => (await api("POST", "/samples/processing", { recepcion_id: R, muestra_tipo: "unica", id_interno: idInt, fecha_procesamiento: hoy(), hora_procesamiento: "09:30", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "Persona A", nombre_quien_superviso: "Persona B", ...extra }, token)).data?.id;
  const SUP_A = await nuevaR(`UXSA-${s5}`, {}, t.diego);
  await pausa(1100);
  const R_SUPP = await nuevaR(`UXSP-${s5}`, { decision_aceptacion: "aceptada", aceptacion: ACEPTACION });
  await api("POST", `/samples/reception/${R_SUPP}/asignaciones`, { usuario_id: id.diego, motivo: "Asignación de la prueba de cobertura" }, t.ricardo);
  const SUP_P = await nuevoP(R_SUPP, `UXSP-${s5}`, {}, t.diego);
  await pausa(1100);
  const SUP_B = await nuevaR(`UXSB-${s5}`, {}, t.diego);
  const supId = fila("SELECT supervisor_id FROM muestras_recepcion WHERE id = ?", SUP_A)?.supervisor_id;
  const supervisor = Object.keys(id).find((k) => Number(id[k]) === Number(supId));
  const estadoSup = (tabla, rid) => fila(`SELECT supervision_estado AS e, supervision_observaciones AS o FROM ${tabla} WHERE id = ?`, rid) || {};
  check("(preparación 2) registros de la estudiante pendientes de su supervisor", !!supervisor && estadoSup("muestras_recepcion", SUP_A).e === "pendiente" && estadoSup("muestras_recepcion", SUP_B).e === "pendiente" && estadoSup("muestras_procesamiento", SUP_P).e === "pendiente", `${supervisor} ${SUP_A} ${SUP_B} ${SUP_P}`);
  await paso(supervisor || "ricardo", "supervisión: banner, bandeja, filtros, ventana, regresar y visto bueno", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/recepcion/${SUP_A}`);
    const banner = page.locator("[data-banner-supervision]");
    await banner.waitFor();
    check("[cob:M:M-016] el supervisor ve en la ficha el banner «Pendiente de tu visto bueno» con «Dar visto bueno» y «Regresar»", (await banner.getAttribute("aria-label")) === "Pendiente de tu visto bueno" && (await banner.getByRole("button", { name: "Dar visto bueno" }).count()) === 1 && (await banner.getByRole("button", { name: "Regresar" }).count()) === 1);
    await page.goto(`${BASE_WEB}/supervision`);
    const pendientes = page.locator("section[aria-labelledby=sup-pendientes]");
    const filaA = pendientes.locator(`[data-supervision="muestras_recepcion-${SUP_A}"]`);
    await filaA.waitFor();
    check("[cob:M:M-243] «Pendientes de tu visto bueno» lista lo capturado por su supervisada (recepciones y procesamiento)", (await pendientes.locator(`[data-supervision="muestras_recepcion-${SUP_B}"]`).count()) === 1 && (await pendientes.locator(`[data-supervision="muestras_procesamiento-${SUP_P}"]`).count()) === 1 && /Dar visto bueno/.test((await filaA.textContent()) || ""));
    await page.getByRole("button", { name: /^Filtros/ }).click();
    const registro = page.locator('section[aria-label="Registro"]');
    const orden = page.locator('section[aria-label="Ordenar por"]');
    check("[cob:M:M-242] filtros «Registro» (con más de un tipo) y «Ordenar por» (Más recientes / Más antiguos)", (await registro.getByRole("switch", { name: "Procesamiento" }).count()) === 1 && (await orden.getByRole("switch", { name: "Más recientes" }).count()) === 1 && (await orden.getByRole("switch", { name: "Más antiguos" }).count()) === 1);
    await registro.getByRole("switch", { name: "Procesamiento" }).click();
    await page.keyboard.press("Escape");
    await filaA.waitFor({ state: "detached" });
    check("[cob:M:M-242] «Registro · Procesamiento» deja solo los procesamientos", (await pendientes.locator(`[data-supervision="muestras_procesamiento-${SUP_P}"]`).count()) === 1 && (await pendientes.locator('[data-supervision^="muestras_recepcion-"]').count()) === 0);
    await page.getByRole("button", { name: /^Filtros/ }).click();
    await registro.getByRole("switch", { name: "Procesamiento" }).click();
    await page.keyboard.press("Escape");
    await filaA.waitFor();
    const posicion = async () => {
      const claves = await pendientes.locator("[data-supervision]").evaluateAll((els) => els.map((e) => e.getAttribute("data-supervision")));
      return claves.indexOf(`muestras_recepcion-${SUP_A}`) < claves.indexOf(`muestras_recepcion-${SUP_B}`);
    };
    const antesRecientes = await posicion();
    await page.getByRole("button", { name: /^Filtros/ }).click();
    await orden.getByRole("switch", { name: "Más antiguos" }).click();
    await page.keyboard.press("Escape");
    await esperar(posicion);
    check("[cob:M:M-242] «Más antiguos» invierte el orden (la primera capturada va antes)", !antesRecientes && (await posicion()));

    await filaA.getByRole("button", { name: /Acciones/ }).click();
    const menu = await opcionesMenu(page);
    check("[cob:M:M-245] el menú de una fila pendiente ofrece «Dar visto bueno…» y «Regresar…»", menu.includes("Dar visto bueno…") && menu.includes("Regresar…"), menu);
    await page.getByRole("menuitem", { name: "Regresar…" }).click();
    const regresar = page.getByRole("dialog", { name: /^Regresar Recepción R/ });
    await regresar.waitFor();
    await page.fill("#prompt-motivo", "abc");
    await regresar.getByRole("button", { name: "Regresar con observaciones" }).click();
    const corto = await popup(page);
    check("[cob:M:M-248] «Regresar» (no crítico) exige observaciones de al menos 5 caracteres; sigue pendiente", /Observaciones debe tener al menos 5 caracteres/.test(corto) && (await regresar.locator("#prompt-password").count()) === 0 && estadoSup("muestras_recepcion", SUP_A).e === "pendiente", corto.slice(0, 200));
    await page.fill("#prompt-motivo", "Falta la hora de recepción en la hoja");
    await regresar.getByRole("button", { name: "Regresar con observaciones" }).click();
    await toast(page, /regresado/i);
    check("[cob:M:M-248] con observaciones el registro queda «regresado» con ellas", estadoSup("muestras_recepcion", SUP_A).e === "regresado" && estadoSup("muestras_recepcion", SUP_A).o === "Falta la hora de recepción en la hoja", JSON.stringify(estadoSup("muestras_recepcion", SUP_A)));

    const filaB = pendientes.locator(`[data-supervision="muestras_recepcion-${SUP_B}"]`);
    await filaB.getByRole("button", { name: /Acciones/ }).click();
    await page.getByRole("menuitem", { name: "Dar visto bueno…" }).click();
    const vb = page.getByRole("dialog", { name: /^Visto bueno: Recepción R/ });
    await vb.waitFor();
    await page.fill("#vb-obs", "Revisado contra la hoja de campo");
    await vb.getByRole("button", { name: "Dar visto bueno" }).click();
    const sinClave = await popup(page);
    check("[cob:M:M-247] «Dar visto bueno» sin contraseña → «Escribe tu contraseña para confirmar»; sigue pendiente", /Escribe tu contraseña para confirmar/.test(sinClave) && estadoSup("muestras_recepcion", SUP_B).e === "pendiente", sinClave.slice(0, 200));
    await page.fill("#vb-password", pwd(supervisor));
    await vb.getByRole("button", { name: "Dar visto bueno" }).click();
    await vb.waitFor({ state: "detached" });
    await esperar(() => estadoSup("muestras_recepcion", SUP_B).e === "aprobado");
    check("[cob:M:M-247] con la contraseña queda «aprobado» con las observaciones", estadoSup("muestras_recepcion", SUP_B).e === "aprobado" && estadoSup("muestras_recepcion", SUP_B).o === "Revisado contra la hoja de campo", JSON.stringify(estadoSup("muestras_recepcion", SUP_B)));

    const filaP = pendientes.locator(`[data-supervision="muestras_procesamiento-${SUP_P}"]`);
    await filaP.click();
    const ventana = page.locator(`[data-supervision-ventana="muestras_procesamiento-${SUP_P}"]`);
    await ventana.waitFor();
    check("[cob:M:M-246] la ventana de un pendiente trae «Dar visto bueno», «Regresar» y «Abrir formato completo»", (await ventana.getByRole("button", { name: "Dar visto bueno" }).count()) === 1 && (await ventana.getByRole("button", { name: "Regresar" }).count()) === 1 && (await ventana.getByRole("link", { name: /Abrir formato completo/ }).getAttribute("href")) === `/muestras/procesamiento/${SUP_P}`);
    await ventana.getByRole("button", { name: "Dar visto bueno" }).click();
    await page.fill("#vb-password", pwd(supervisor));
    await page.getByRole("dialog", { name: /^Visto bueno: Procesamiento/ }).getByRole("button", { name: "Dar visto bueno" }).click();
    await esperar(() => estadoSup("muestras_procesamiento", SUP_P).e === "aprobado");
    check("[cob:M:M-246] «Dar visto bueno» desde la ventana aprueba el procesamiento", estadoSup("muestras_procesamiento", SUP_P).e === "aprobado", JSON.stringify(estadoSup("muestras_procesamiento", SUP_P)));
  });
  await paso("diego", "supervisión: «Regresados a ti», ventana con «Corregir» y aviso en la ficha", async (page) => {
    await page.goto(`${BASE_WEB}/supervision`);
    const regresados = page.locator("section[aria-labelledby=sup-regresados]");
    const filaA = regresados.locator(`[data-supervision="muestras_recepcion-${SUP_A}"]`);
    await filaA.waitFor();
    check("[cob:M:M-244] «Regresados a ti» lista lo que el supervisor regresó", /Corregir lo regresado/.test((await filaA.textContent()) || ""));
    await filaA.click();
    const ventana = page.locator(`[data-supervision-ventana="muestras_recepcion-${SUP_A}"]`);
    await ventana.waitFor();
    const corregir = ventana.getByRole("link", { name: /Corregir/ });
    check("[cob:M:M-246] la ventana de un regresado trae «Corregir» y «Abrir formato completo» (sin visto bueno)", (await corregir.getAttribute("href")) === `/muestras/recepcion/${SUP_A}` && (await ventana.getByRole("link", { name: /Abrir formato completo/ }).count()) === 1 && (await ventana.getByRole("button", { name: "Dar visto bueno" }).count()) === 0 && /Falta la hora de recepción en la hoja/.test((await ventana.textContent()) || ""));
    await corregir.click();
    await page.waitForURL((url) => url.pathname === `/muestras/recepcion/${SUP_A}`);
    const aviso = page.getByText("Regresado por el supervisor");
    await aviso.waitFor();
    check("[cob:M:M-016] quien capturó ve «Regresado por el supervisor» con las observaciones", ((await page.locator("main").textContent()) || "").includes("Observaciones: Falta la hora de recepción en la hoja"));
  });

  /* ---------- Procesamiento: lista y ficha ---------- */
  const ID_P1 = `UXP1-${s5}`;
  const P_X = await nuevoP(await nuevaR(ID_P1, { decision_aceptacion: "aceptada", aceptacion: ACEPTACION }), ID_P1);
  const ID_P2 = `UXP2-${s5}`;
  const P_SAR = await nuevoP(await nuevaR(ID_P2, { decision_aceptacion: "aceptada", aceptacion: ACEPTACION }), ID_P2, { tipo_organismo: ["sardinas"] });
  const ID_P3 = `UXP3-${s5}`;
  const P_AN = await nuevoP(await nuevaR(ID_P3, { decision_aceptacion: "aceptada", aceptacion: ACEPTACION }), ID_P3);
  await asignarAQa(fila("SELECT recepcion_id FROM muestras_procesamiento WHERE id = ?", P_SAR)?.recepcion_id);
  const ID_PR = `UXPR-${s5}`;
  const P_PR = await nuevoP(await nuevaR(ID_PR, { decision_aceptacion: "aceptada", aceptacion: ACEPTACION }, t.ricardo), ID_PR, {}, t.ricardo);
  const anP = await api("POST", `/samples/processing/${P_AN}/anular`, { motivo: "Procesamiento duplicado de la prueba" }, t.qa);
  check("(preparación 2) procesamientos propios (uno anulado)", !!P_X && !!P_SAR && !!P_PR && anP.status === 200 && fila("SELECT estado FROM muestras_procesamiento WHERE id = ?", P_AN)?.estado === "anulada", `${P_X} ${P_SAR} ${anP.status} ${anP.data?.message || ""}`);
  await paso("qa", "procesamiento: lista (buscador, organismo, interruptores, anular y restaurar)", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/procesamiento`);
    const nuevo = page.getByRole("link", { name: "Nuevo procesamiento" });
    await nuevo.waitFor();
    check("[cob:M:M-111] «Nuevo procesamiento» enlaza al alta", (await nuevo.getAttribute("href")) === "/muestras/procesamiento/nuevo");
    const buscar = page.getByPlaceholder("Buscar por folio P, folio R o ID interno");
    await buscar.fill(ID_P1);
    await page.getByRole("row").filter({ hasText: ID_P1 }).first().waitFor();
    await esperar(async () => !(await hay(page, ID_P2)));
    check("[cob:M:M-112] el buscador filtra por ID interno", !(await hay(page, ID_P2)));
    await buscar.fill(`-${s5}`);
    await page.getByRole("row").filter({ hasText: ID_P2 }).first().waitFor();
    await filtro(page, "Organismo", "Sardinas");
    await esperar(async () => !(await hay(page, ID_P1)));
    check("[cob:M:M-114] «Organismo · Sardinas» deja solo los de sardinas", (await hay(page, ID_P2)) && !(await hay(page, ID_P1)));
    await quitarFiltro(page, "Sardinas");
    check("[cob:M:M-115] el anulado no aparece por omisión", !(await hay(page, ID_P3)));
    const urls = [];
    page.on("request", (r) => r.url().includes("/api/samples/processing") && urls.push(r.url()));
    await filtro(page, "Vista", "Mis muestras");
    await esperar(() => urls.some((u) => u.includes("mias=1")));
    await esperar(async () => !(await hay(page, ID_PR)));
    check("[cob:M:M-115] «Mis muestras» pide mias=1: oculta el de otra persona sin asignar y deja el de una recepción asignada", urls.some((u) => u.includes("mias=1")) && !(await hay(page, ID_PR)) && (await hay(page, ID_P2)), urls.slice(-1).join(""));
    check("[cob:M:M-115] «Mis muestras» («asignadas a ti o que registraste») deja también el que registré", await hay(page, ID_P1), "el procesamiento que registró la cuenta no aparece con mias=1");
    await quitarFiltro(page, "Mis muestras");
    await filtro(page, "Vista", "Mostrar anulados");
    await page.getByRole("row").filter({ hasText: ID_P3 }).first().waitFor();
    check("[cob:M:M-115] «Mostrar anulados» muestra el anulado", await hay(page, ID_P3));
    await menuDeFila(page, ID_P3);
    const menuAn = await opcionesMenu(page);
    check("[cob:M:M-119] un anulado ofrece «Restaurar procesamiento» (no Editar, Extraer ni Anular)", menuAn.includes("Restaurar procesamiento") && !menuAn.includes("Editar") && !menuAn.includes("Extraer") && !menuAn.includes("Anular procesamiento…"), menuAn);
    await page.getByRole("menuitem", { name: "Restaurar procesamiento" }).click();
    await page.getByRole("dialog", { name: /^Restaurar procesamiento P/ }).waitFor();
    await dialogoMotivo(page, "Se anuló por error en la prueba de cobertura", "Restaurar", pwd("qa"));
    await toast(page, /restaurad/i);
    check("[cob:M:M-119] «Restaurar procesamiento» (crítico) lo devuelve a su estado previo", fila("SELECT estado FROM muestras_procesamiento WHERE id = ?", P_AN)?.estado === "registrada", fila("SELECT estado FROM muestras_procesamiento WHERE id = ?", P_AN)?.estado);
    await menuDeFila(page, ID_P1);
    await page.getByRole("menuitem", { name: "Anular procesamiento…" }).click();
    await page.getByRole("dialog", { name: /^Anular procesamiento P/ }).waitFor();
    await dialogoMotivo(page, "Procesamiento capturado dos veces", "Anular", pwd("qa"));
    await toast(page, /anulad/i);
    const an = fila("SELECT estado, motivo_anulacion FROM muestras_procesamiento WHERE id = ?", P_X);
    check("[cob:M:M-120] «Anular procesamiento…» (crítico) lo anula con su motivo", an?.estado === "anulada" && an?.motivo_anulacion === "Procesamiento capturado dos veces", JSON.stringify(an));
  });

  const ID_PN = `UXPN-${s5}`;
  const R_PN = await nuevaR(ID_PN, { decision_aceptacion: "aceptada", aceptacion: ACEPTACION });
  await paso("qa", "procesamiento nuevo: recepción, ID, pasos con equipo y peso, personal y botones", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/procesamiento/nuevo`);
    await page.locator("#p-folio").waitFor();
    await mostrarTodo(page);
    const opciones = await page.locator("#p-recepcion option").evaluateAll((os) => os.map((o) => o.value));
    check("[cob:M:M-123] «Recepción (FX-TCF-GMR)» solo ofrece recepciones aceptadas (no las registradas sin decisión)", opciones.includes(String(R_PN)) && !opciones.includes(String(R_MAR)) && !opciones.includes(String(R_ANU)), `${opciones.length} opciones`);
    await page.locator("#persona-quien-superviso").selectOption("");
    await page.getByRole("button", { name: "Registrar procesamiento" }).click();
    const faltan = await popup(page);
    check("[cob:M:M-123] sin recepción → «Elige la recepción de origen»", /Elige la recepción de origen/.test(faltan), faltan.slice(0, 300));
    check("[cob:M:M-125] sin ID interno → «Indica el ID interno de la muestra»", /Indica el ID interno de la muestra/.test(faltan), faltan.slice(0, 300));
    check("[cob:M:M-129] sin organismo, los pasos piden «Elige primero el tipo de organismo»", /Elige primero el tipo de organismo/.test(faltan), faltan.slice(0, 500));
    check("[cob:M:M-135] sin «Quien supervisó» → «Elige a quien supervisó»", /Elige a quien supervisó/.test(faltan), faltan.slice(0, 600));
    check("[cob:M:M-134] «Quien procesó» se llena con la sesión (no se pide)", !/Elige a quien procesó/.test(faltan) && /QA/.test(await page.locator("#persona-quien-proceso option:checked").textContent()), await page.locator("#persona-quien-proceso option:checked").textContent());
    await page.locator("#p-recepcion").selectOption(String(R_PN));
    await esperar(async () => (await page.locator("#p-id").inputValue()) === ID_PN);
    check("[cob:M:M-125] al vincular la recepción se llena el ID interno", (await page.locator("#p-id").inputValue()) === ID_PN);
    await page.locator("#p-organismo").getByRole("radio", { name: /^Bivalvos/ }).check();
    const pasos = page.locator("#p-pasos");
    await pasos.getByRole("checkbox").first().waitFor();
    check("[cob:M:M-129] Bivalvos muestra sus 9 pasos; sin marcar ninguno los campos de equipo no aparecen", (await pasos.getByRole("checkbox").count()) === 9 && (await page.getByLabel("Licuadora (LC)").count()) === 0);
    await pasos.getByRole("checkbox", { name: "Drenar 5 min" }).check();
    await pasos.getByRole("checkbox", { name: /Moler 1 a 2 min/ }).check();
    await pasos.getByRole("checkbox", { name: "Pesar la molienda obtenida" }).check();
    await pasos.getByRole("checkbox", { name: /Reservar molienda en bolsa/ }).check();
    check("[cob:M:M-129] cada paso marcado agrega su equipo (Cronómetro, Licuadora, Balanza), el peso y la bolsa", (await page.getByLabel("Cronómetro (CR)").count()) === 1 && (await page.getByLabel("Licuadora (LC)").count()) === 1 && (await page.getByLabel("Balanza (BA)").count()) === 1 && (await page.getByLabel("Peso de la molienda (g)").count()) === 1 && (await page.getByPlaceholder("Bolsa hermética (se descuenta 1 pieza)").count()) === 1);
    await page.getByLabel("Peso de la molienda (g)").fill("120.5");
    await pasos.getByRole("checkbox", { name: /Reservar molienda en bolsa/ }).uncheck();
    await page.locator("#p-partes").getByRole("checkbox", { name: /Cuerpo completo/ }).check();
    await page.locator("#p-resguardo").getByRole("checkbox").first().check();
    await page.locator("#persona-quien-superviso").selectOption({ label: (await page.locator("#persona-quien-proceso option:checked").textContent()) || "" });
    await page.getByRole("button", { name: "Registrar procesamiento" }).click();
    await guardarDeTodosModos(page);
    const servidor = page.locator('[role=alertdialog][data-validacion="servidor"]');
    await servidor.waitFor();
    const seg = (await servidor.textContent()) || "";
    await entendido(page);
    check("[cob:M:M-135] «Quien supervisó» = «Quien procesó» → el servidor lo rechaza (segregación) y no se registra", /supervis/i.test(seg) && !fila("SELECT id FROM muestras_procesamiento WHERE recepcion_id = ? AND estado <> 'anulada'", R_PN), seg.slice(0, 200));
    await page.locator("#persona-quien-superviso").selectOption("Ricardo Medina Flores");
    await page.locator("#firma-password").fill(pwd("ricardo"));
    await page.getByRole("button", { name: "Confirmar firma" }).click();
    await page.locator("#firma-password").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Registrar procesamiento" }).click();
    await guardarDeTodosModos(page);
    await page.waitForURL((url) => url.pathname === "/muestras/procesamiento");
    const p = fila("SELECT * FROM muestras_procesamiento WHERE recepcion_id = ? AND estado <> 'anulada' ORDER BY id DESC", R_PN);
    const pasosGuardados = JSON.stringify(JSON.parse(p?.bivalvos_steps_json || p?.pasos_json || "null") ?? p);
    check("[cob:M:M-136] [cob:M:M-134] «Registrar procesamiento» crea el registro con quien procesó (sesión) y quien supervisó", !!p && /QA/.test(String(p.nombre_quien_proceso || "")) && /Ricardo/.test(String(p.nombre_quien_superviso || "")), JSON.stringify(p ? { proceso: p.nombre_quien_proceso, superviso: p.nombre_quien_superviso } : null));
    check("[cob:M:M-129] los pasos marcados y el peso de la molienda se guardan", /120\.5/.test(pasosGuardados) && /Drenar/.test(pasosGuardados), pasosGuardados.slice(0, 300));
    await page.goto(`${BASE_WEB}/muestras/procesamiento/${p?.id}`);
    await page.getByRole("button", { name: "Guardar cambios" }).waitFor();
    check("[cob:M:M-136] en edición el botón es «Guardar cambios»", (await page.getByRole("button", { name: "Registrar procesamiento" }).count()) === 0);
    await page.goto(`${BASE_WEB}/muestras/procesamiento/nuevo`);
    await page.getByRole("button", { name: "Cancelar", exact: true }).first().click();
    await page.waitForURL((url) => url.pathname === "/muestras/procesamiento");
    check("[cob:M:M-136] «Cancelar» vuelve a la lista", true);
  });
  const P_ACE = fila("SELECT id FROM muestras_procesamiento WHERE recepcion_id = ? AND estado <> 'anulada' ORDER BY id DESC", R_PN)?.id;

  /* ---------- Extracción: lista y ficha ---------- */
  const cE = await cadena(t, `UXE${s5}`);
  const cEa = await cadena(t, `UXF${s5}`);
  const cEs = await cadena(t, `UXEA${s5}`);
  await asignarAQa(cEs.R);
  const ID_ER = `UXER${s5}`;
  const P_ER = await nuevoP(await nuevaR(ID_ER, { decision_aceptacion: "aceptada", aceptacion: ACEPTACION }, t.ricardo), ID_ER, {}, t.ricardo);
  const E_ER = await api("POST", "/samples/extraction", { tipo_registro: "E-D", procesamiento_id: P_ER, tipo_molienda: "fresca", id_interno: ID_ER, fecha_extraccion: hoy(), registro_pesos: [{ id_muestra: ID_ER, replica: `${ID_ER}_R1`, peso_muestra: 2.01 }], equipos: [], nombre_quien_extrajo: "Persona A", nombre_quien_superviso: "Persona B" }, t.ricardo);
  const anE = await api("POST", `/samples/extraction/${cEa.E}/anular`, { motivo: "Extracción duplicada de la prueba" }, t.qa);
  check("(preparación 2) extracciones propias (una anulada)", !!cE.E && anE.status === 200 && E_ER.status === 201, `${cE.E} ${anE.status} ${anE.data?.message || ""} ${E_ER.status} ${E_ER.data?.message || ""}`);
  await paso("qa", "extracción: lista («Nueva extracción», buscador e interruptores)", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/extraccion`);
    await page.getByRole("button", { name: "Nueva extracción" }).first().click();
    await page.getByRole("menu").waitFor();
    const items = page.getByRole("menuitem");
    const textos = await items.allTextContents();
    const deshabilitados = await page.locator('[role=menuitem][aria-disabled="true"]').allTextContents();
    check("[cob:M:M-137] «Nueva extracción» ofrece ASP y DSP; los formatos «Próximamente» están deshabilitados", textos.some((x) => /ASP/.test(x)) && textos.some((x) => /DSP/.test(x)) && deshabilitados.length >= 1 && deshabilitados.every((x) => /Próximamente/.test(x)), `${textos.join(" | ")} // ${deshabilitados.join(" | ")}`);
    await page.getByRole("menuitem", { name: /DSP/ }).click();
    await page.waitForURL((url) => url.pathname === "/muestras/extraccion/nueva" && url.searchParams.get("tipo") === "E-D");
    check("[cob:M:M-137] la opción DSP abre la extracción nueva ?tipo=E-D", true);
    await page.goto(`${BASE_WEB}/muestras/extraccion`);
    const buscar = page.getByPlaceholder("Buscar por folio (E-D 12), folio P o ID interno");
    await buscar.fill(cE.idInt);
    await page.getByRole("row").filter({ hasText: cE.idInt }).first().waitFor();
    check("[cob:M:M-138] el buscador filtra por ID interno", !(await hay(page, cEa.idInt)));
    await buscar.fill(`${s5}`);
    await page.getByRole("row").filter({ hasText: cEs.idInt }).first().waitFor();
    check("[cob:M:M-140] la anulada no aparece por omisión", !(await hay(page, cEa.idInt)));
    const urls = [];
    page.on("request", (r) => r.url().includes("/api/samples/extraction") && urls.push(r.url()));
    await filtro(page, "Vista", "Mis muestras");
    await esperar(() => urls.some((u) => u.includes("mias=1")));
    await esperar(async () => !(await hay(page, ID_ER)));
    check("[cob:M:M-140] «Mis muestras» pide mias=1: oculta la de otra persona sin asignar y deja la de una recepción asignada", urls.some((u) => u.includes("mias=1")) && !(await hay(page, ID_ER)) && (await hay(page, cEs.idInt)), urls.slice(-1).join(""));
    check("[cob:M:M-140] «Mis muestras» («asignadas a ti o que registraste») deja también la que registré", await hay(page, cE.idInt), "la extracción que registró la cuenta no aparece con mias=1");
    await quitarFiltro(page, "Mis muestras");
    await filtro(page, "Vista", "Mostrar anuladas");
    await page.getByRole("row").filter({ hasText: cEa.idInt }).first().waitFor();
    check("[cob:M:M-140] «Mostrar anuladas» incluye la anulada", /Anulada/.test((await page.getByRole("row").filter({ hasText: cEa.idInt }).first().textContent()) || ""));
  });

  await paso("qa", "extracción nueva: folio, procesamiento, muestra, tabla de pesos, personal y botones", async (page) => {
    const antes = Number(fila("SELECT MAX(folio_num) AS m FROM muestras_extraccion WHERE tipo_registro = 'E-D'")?.m || 0);
    await page.goto(`${BASE_WEB}/muestras/extraccion/nueva?tipo=E-D`);
    await page.getByRole("heading", { name: /Nueva extracción DSP/ }).waitFor();
    await mostrarTodo(page);
    await esperar(async () => (await page.locator("#e-folio").inputValue()) !== "");
    const sugerido = Number(await page.locator("#e-folio").inputValue());
    const despues = Number(fila("SELECT MAX(folio_num) AS m FROM muestras_extraccion WHERE tipo_registro = 'E-D'")?.m || 0);
    check("[cob:M:M-143] «Folio E-D» se propone con el siguiente de su serie", sugerido >= antes + 1 && sugerido <= despues + 1, `${sugerido} entre ${antes + 1} y ${despues + 1}`);
    await page.fill("#e-folio", "");
    await page.locator("#persona-quien-superviso").selectOption("");
    await page.getByRole("button", { name: "Registrar extracción DSP" }).click();
    const faltan = await popup(page);
    check("[cob:M:M-143] sin folio → «Indica el folio de extracción»", /Indica el folio de extracción/.test(faltan), faltan.slice(0, 300));
    check("[cob:M:M-145] sin procesamiento → «Elige el procesamiento de origen»", /Elige el procesamiento de origen/.test(faltan), faltan.slice(0, 300));
    check("[cob:M:M-154] sin «Quien supervisó» → «Elige a quien supervisó»; «Quien extrajo» viene de la sesión", /Elige a quien supervisó/.test(faltan) && !/Elige a quien extrajo/.test(faltan), faltan.slice(0, 600));
    check("[cob:M:M-154] DSP no lleva «Quien realizó la limpieza»", (await page.locator("#persona-quien-realizo-la-limpieza").count()) === 0);
    check("[cob:M:M-146] «Muestra única» / «Lote» (name=e-tipo) e «ID interno» vacío hasta vincular", (await page.locator("input[name=e-tipo]").count()) === 2 && (await page.locator("#e-id").inputValue()) === "");
    await page.locator("#e-proc").selectOption(String(P_ACE));
    await esperar(async () => (await page.locator("#e-id").inputValue()) === ID_PN);
    check("[cob:M:M-145] [cob:M:M-146] al vincular el procesamiento se llena el ID interno", (await page.locator("#e-id").inputValue()) === ID_PN, await page.locator("#e-id").inputValue());
    const ids = page.getByLabel("ID de la muestra");
    const antesFilas = await ids.count();
    await page.getByRole("button", { name: "Agregar muestra" }).first().click();
    await esperar(async () => (await ids.count()) === antesFilas + 1);
    await ids.last().fill(`${ID_PN}-B`);
    check("[cob:M:M-149] «Agregar muestra» agrega una fila a la tabla de pesos", (await ids.count()) === antesFilas + 1);
    await page.getByRole("button", { name: `Quitar ${ID_PN}-B` }).click();
    check("[cob:M:M-149] «Quitar {id}» la retira", (await ids.count()) === antesFilas);
    await page.getByRole("button", { name: "Cancelar", exact: true }).first().click();
    await page.waitForURL((url) => url.pathname === "/muestras/extraccion");
    check("[cob:M:M-155] «Cancelar» vuelve a la lista sin registrar", !fila("SELECT id FROM muestras_extraccion WHERE procesamiento_id = ?", P_ACE));
    await page.goto(`${BASE_WEB}/muestras/extraccion/${cE.E}`);
    await page.getByRole("button", { name: "Guardar cambios" }).waitFor();
    check("[cob:M:M-155] en edición el botón es «Guardar cambios»", (await page.getByRole("button", { name: /Registrar extracción/ }).count()) === 0);
  });

  await paso("qa", "extracción ASP: «Quien realizó la limpieza» solo con limpieza", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/extraccion/nueva?tipo=E-A`);
    await page.getByRole("heading", { name: /Nueva extracción ASP/ }).waitFor();
    await mostrarTodo(page);
    const limpio = page.locator("#persona-quien-realizo-la-limpieza");
    const antes = await limpio.count();
    await page.getByRole("radio", { name: /Sí requirió limpieza/ }).check();
    await limpio.waitFor();
    await page.locator("#persona-quien-realizo-la-limpieza").selectOption("");
    await page.getByRole("button", { name: "Registrar extracción ASP" }).click();
    const faltan = await popup(page);
    check("[cob:M:M-154] ASP con limpieza: aparece «Quien realizó la limpieza» y se exige", antes === 0 && /Elige a quien realizó la limpieza/.test(faltan), faltan.slice(0, 600));
  });

  /* ---------- Análisis: lista ---------- */
  const fs = await import("node:fs");
  const path = await import("node:path");
  const centrif = fila("SELECT id, nombre FROM equipos WHERE nombre = 'Centrifuga' ORDER BY id LIMIT 1");
  const nuevoA = async (c, extra = {}) => (await api("POST", "/samples/analysis", analisisDe(c, { equipo_id: centrif?.id, ...extra }), t.qa)).data?.id;
  const estadoA = (aid) => fila("SELECT estado FROM muestras_analisis WHERE id = ?", aid)?.estado;
  const cL1 = await cadena(t, `UXL1${s5}`);
  const cL2 = await cadena(t, `UXL2${s5}`);
  const cL3 = await cadena(t, `UXL3${s5}`);
  const cPl = await cadena(t, `UXPK${s5}`);
  const A_L1 = await nuevoA(cL1);
  const A_L2 = await nuevoA(cL2);
  await flujoAnalisis(A_L2, "en_revision");
  const A_L3 = await nuevoA(cL3);
  await asignarAQa(cL2.R);
  const cL4 = await cadena(t, `UXL4${s5}`);
  const A_L4 = await api("POST", "/samples/analysis", analisisDe(cL4), t.ricardo);
  const anA = await api("POST", `/samples/analysis/${A_L3}/anular`, { motivo: "Análisis duplicado de la prueba" }, t.qa);
  const A_PK = await nuevoA(cPl, { tipo_analisis: "plancton", metodo: "microscopia", extraccion_id: null, procesamiento_id: cPl.P, resultados: [{ id_muestra: cPl.idInt, resultado: 1200, unidad: "cél/L" }] });
  check("(preparación 2) análisis propios: registrado, en revisión, anulado y de plancton", !!A_L1 && estadoA(A_L2) === "en_revision" && anA.status === 200 && !!A_PK && A_L4.status === 201, `${A_L1} ${estadoA(A_L2)} ${anA.status} ${A_PK} ${A_L4.status} ${A_L4.data?.message || ""}`);
  await paso("qa", "análisis: lista (buscador, estado, tipo, interruptores, recepción y menú ⋯)", async (page) => {
    const urls = [];
    page.on("request", (r) => r.url().includes("/api/samples/analysis?") && urls.push(r.url()));
    await page.goto(`${BASE_WEB}/muestras/analisis`);
    const nuevo = page.getByRole("link", { name: "Nuevo análisis" });
    await nuevo.waitFor();
    check("[cob:M:M-156] «Nuevo análisis» enlaza al alta", (await nuevo.getAttribute("href")) === "/muestras/analisis/nuevo", await nuevo.getAttribute("href"));
    const buscar = page.getByPlaceholder("Buscar por folio, solicitante, ID o analista");
    await buscar.fill(cL1.idInt);
    await page.getByRole("row").filter({ hasText: cL1.idInt }).first().waitFor();
    await esperar(async () => !(await hay(page, cL2.idInt)));
    check("[cob:M:M-157] el buscador manda search= al servidor y filtra por ID interno", !(await hay(page, cL2.idInt)) && urls.some((u) => u.includes(`search=${encodeURIComponent(cL1.idInt)}`)), urls.slice(-1).join(""));
    await buscar.fill(s5);
    await page.getByRole("row").filter({ hasText: cL2.idInt }).first().waitFor();
    await filtro(page, "Estado", "Por revisar");
    await esperar(async () => !(await hay(page, cL1.idInt)));
    check("[cob:M:M-158] «Estado · Por revisar» manda estado=en_revision y deja solo lo que está en revisión", (await hay(page, cL2.idInt)) && !(await hay(page, cL1.idInt)) && urls.some((u) => u.includes("estado=en_revision")), urls.slice(-1).join(""));
    await quitarFiltro(page, "Por revisar");
    await page.getByRole("button", { name: /^Filtros/ }).click();
    const estados = await page.locator('section[aria-label="Estado"]').getByRole("switch").allTextContents();
    await page.keyboard.press("Escape");
    check("[cob:M:M-158] el grupo «Estado» ofrece las seis opciones del renglón", ["Por revisar o aprobar", "En captura", "Por revisar", "Por aprobar", "Aprobados", "Sustituidos (enmendados)"].every((o) => estados.some((e) => e.includes(o))), estados.join(" | "));
    await filtro(page, "Análisis", "PLK");
    await esperar(async () => !(await hay(page, cL1.idInt)));
    check("[cob:M:M-159] «Análisis · PLK» deja solo el de plancton", (await hay(page, cPl.idInt)) && !(await hay(page, cL1.idInt)) && !(await hay(page, cL2.idInt)));
    await quitarFiltro(page, "PLK");
    check("[cob:M:M-160] el anulado no aparece por omisión", !(await hay(page, cL3.idInt)));
    await filtro(page, "Vista", "Mis muestras");
    await esperar(() => urls.some((u) => u.includes("mias=1")));
    await esperar(async () => !(await hay(page, cL4.idInt)));
    check("[cob:M:M-160] «Mis muestras» manda mias=1: oculta el de otra persona sin asignar y deja el de una recepción asignada", urls.some((u) => u.includes("mias=1")) && !(await hay(page, cL4.idInt)) && (await hay(page, cL2.idInt)), urls.slice(-1).join(""));
    check("[cob:M:M-160] «Mis muestras» («asignadas a ti o que registraste») deja también el que registré", await hay(page, cL1.idInt), "el análisis que registró la cuenta no aparece con mias=1");
    await quitarFiltro(page, "Mis muestras");
    await filtro(page, "Vista", "Mostrar anulados");
    await page.getByRole("row").filter({ hasText: cL3.idInt }).first().waitFor();
    check("[cob:M:M-160] «Mostrar anulados» incluye el anulado", urls.some((u) => u.includes("anulados=1") || u.includes("anuladas=1")), urls.slice(-1).join(""));
    await menuDeFila(page, cL1.idInt);
    const m1 = await opcionesMenu(page);
    await page.keyboard.press("Escape");
    await menuDeFila(page, cL2.idInt);
    const m2 = await opcionesMenu(page);
    await page.keyboard.press("Escape");
    await menuDeFila(page, cL3.idInt);
    const m3 = await opcionesMenu(page);
    check("[cob:M:M-162] menú ⋯: «Editar» solo en registrado; «Anular análisis…» en vigentes; «Restaurar análisis» en el anulado", /Abrir/.test(m1) && /Editar/.test(m1) && /Anular análisis…/.test(m1) && /Abrir/.test(m2) && !/Editar/.test(m2) && /Restaurar análisis/.test(m3) && !/Anular análisis…/.test(m3) && !/Editar/.test(m3), `${m1} // ${m2} // ${m3}`);
    await page.getByRole("menuitem", { name: "Restaurar análisis" }).click();
    await page.getByRole("dialog", { name: /^Restaurar análisis A/ }).waitFor();
    await dialogoMotivo(page, "Se anuló por error en la prueba de cobertura", "Restaurar", pwd("qa"));
    await toast(page, /restaurad/i);
    check("[cob:M:M-162] «Restaurar análisis» (crítico) lo devuelve a registrado", estadoA(A_L3) === "registrado", estadoA(A_L3));
    await menuDeFila(page, cL3.idInt);
    await page.getByRole("menuitem", { name: "Anular análisis…" }).click();
    await page.getByRole("dialog", { name: /^Anular análisis A/ }).waitFor();
    await dialogoMotivo(page, "Análisis capturado dos veces", "Anular", pwd("qa"));
    await toast(page, /anulad/i);
    const an = fila("SELECT estado, motivo_anulacion FROM muestras_analisis WHERE id = ?", A_L3);
    check("[cob:M:M-162] «Anular análisis…» (crítico) lo anula con su motivo", an?.estado === "anulado" && an?.motivo_anulacion === "Análisis capturado dos veces", JSON.stringify(an));
    await page.goto(`${BASE_WEB}/muestras/analisis?recepcion=${cL1.R}`);
    const insignia = page.getByText(`Recepción #${cL1.R}`, { exact: true });
    await insignia.waitFor();
    await page.getByRole("row").filter({ hasText: cL1.idInt }).first().waitFor();
    check("[cob:M:M-161] ?recepcion= muestra la insignia «Recepción #id», manda recepcion_id= y deja solo esa recepción", urls.some((u) => u.includes(`recepcion_id=${cL1.R}`)) && !(await hay(page, cL2.idInt)) && (await insignia.evaluate((e) => e.closest("button") === null)), urls.slice(-1).join(""));
  });

  /* ---------- Análisis: alta (campos obligatorios, tipos con y sin extracción) ---------- */
  const cN = await cadena(t, `UXAN${s5}`);
  await paso("qa", "análisis nuevo: folio, fecha y horas, método, origen, equipo, analista y botones", async (page) => {
    const antes = Number(fila("SELECT MAX(folio_num) AS m FROM muestras_analisis")?.m || 0);
    await page.goto(`${BASE_WEB}/muestras/analisis/nuevo`);
    await page.getByRole("heading", { name: /Nuevo análisis/ }).waitFor();
    await mostrarTodo(page);
    await esperar(async () => (await page.locator("#a-folio").inputValue()) !== "");
    const sugerido = Number(await page.locator("#a-folio").inputValue());
    const despues = Number(fila("SELECT MAX(folio_num) AS m FROM muestras_analisis")?.m || 0);
    check("[cob:M:M-163] «Folio A» se propone con el siguiente (next-folio)", sugerido >= antes + 1 && sugerido <= despues + 1, `${sugerido} entre ${antes + 1} y ${despues + 1}`);
    check("[cob:M:M-164] «Hora de inicio» se llena con la hora actual y «Hora de término» queda vacía", /^\d{2}:\d{2}$/.test(await page.locator("#a-hi").inputValue()) && (await page.locator("#a-hf").inputValue()) === "");
    const analista = (await page.locator("#persona-analista option:checked").textContent()) || "";
    const pista = await page.getByText("Sin extracción, el análisis parte del procesamiento de la muestra.").count();
    await page.fill("#a-folio", "");
    await page.fill("#a-fecha", "");
    await page.locator("#persona-analista").selectOption("");
    await page.getByRole("button", { name: "Registrar análisis" }).click();
    const faltan = await popup(page);
    check("[cob:M:M-163] sin folio → «Indica el folio del análisis»", /Indica el folio del análisis/.test(faltan), faltan.slice(0, 300));
    check("[cob:M:M-164] sin fecha → «Indica la fecha del análisis»", /Indica la fecha del análisis/.test(faltan), faltan.slice(0, 300));
    check("[cob:M:M-166] sin método → «Elige el método»", /Elige el método/.test(faltan), faltan.slice(0, 400));
    check("[cob:M:M-170] sin equipo → «Elige el equipo empleado»", /Elige el equipo empleado/.test(faltan), faltan.slice(0, 600));
    check("[cob:M:M-176] sin analista → «Elige al analista» (viene de la sesión)", /Elige al analista/.test(faltan) && /QA/.test(analista), `${analista} · ${faltan.slice(0, 600)}`);
    await page.locator("#a-tipo").getByRole("radio", { name: /Toxinas lipofílicas/ }).check();
    await page.selectOption("#a-metodo", "otro");
    await page.locator("#a-metodo-otro").waitFor();
    await page.getByRole("button", { name: "Registrar análisis" }).click();
    const faltan2 = await popup(page);
    check("[cob:M:M-166] método «Otro» sin especificar → «Indica el método»", /Indica el método/.test(faltan2), faltan2.slice(0, 400));
    check("[cob:M:M-168] DSP sin extracción → «Elige la extracción de origen (este análisis la requiere)»; no se pide procesamiento", /Elige la extracción de origen \(este análisis la requiere\)/.test(faltan2) && (await page.locator("#a-proc").count()) === 0, faltan2.slice(0, 400));
    await page.locator("#a-tipo").getByRole("radio", { name: /^Plancton/ }).check();
    await page.locator("#a-proc").waitFor();
    const opciones = await page.locator("#a-proc option").evaluateAll((os) => os.map((o) => o.value));
    await page.getByRole("button", { name: "Registrar análisis" }).click();
    const faltan3 = await popup(page);
    // B-25: antes la pantalla ofrecía «Recepción» y el servidor exige un procesamiento (Fase 2): no se podía registrar.
    check("[cob:M:M-169] sin extracción requerida (sin tipo o plancton) aparece «Procesamiento» y sin él → «Elige el procesamiento de la muestra (o la extracción)»", /Elige el procesamiento de la muestra/.test(faltan3) && pista === 1 && opciones.includes(String(cPl.P)), `${pista} ${opciones.includes(String(cPl.P))} ${faltan3.slice(0, 300)}`);
    await page.fill("#a-folio", String(sugerido + 50));
    await page.fill("#a-fecha", hoy());
    await page.selectOption("#a-metodo", "microscopia");
    await page.locator("#a-proc").selectOption(String(cPl.P));
    const equipo = page.getByPlaceholder(/Cromatógrafo, microscopio/);
    await equipo.click();
    await equipo.fill(centrif.nombre);
    await page.getByRole("option", { name: new RegExp(centrif.nombre) }).first().click();
    if (!(await page.locator('input[aria-label^="Resultado de "]').count())) await page.getByRole("button", { name: "Agregar muestra" }).click();
    const idMuestra = page.locator('input[aria-label^="ID de la muestra"]').first();
    if (!(await idMuestra.inputValue())) await idMuestra.fill(cPl.idInt);
    await page.locator('input[aria-label^="Resultado de "]').first().fill("900");
    await page.locator("#persona-analista").selectOption({ label: analista });
    const antesPk = Number(fila("SELECT COUNT(*) AS n FROM muestras_analisis WHERE recepcion_id = ?", cPl.R)?.n || 0);
    await page.getByRole("button", { name: "Registrar análisis" }).click();
    await guardarDeTodosModos(page);
    const servidor = page.locator('[role=alertdialog][data-validacion="servidor"]');
    const resultado = await Promise.race([page.waitForURL((url) => url.pathname === "/muestras/analisis").then(() => "lista"), servidor.waitFor().then(() => "error")]);
    const textoError = resultado === "error" ? (await servidor.textContent()) || "" : "";
    if (resultado === "error") await entendido(page);
    const despuesPk = Number(fila("SELECT COUNT(*) AS n FROM muestras_analisis WHERE recepcion_id = ?", cPl.R)?.n || 0);
    check("[cob:M:M-169] un análisis de plancton con su procesamiento se registra desde la pantalla (y queda en su recepción)", resultado === "lista" && despuesPk === antesPk + 1, `${resultado} ${textoError.slice(0, 200)}`);

    await page.goto(`${BASE_WEB}/muestras/analisis/nuevo`);
    await page.getByRole("heading", { name: /Nuevo análisis/ }).waitFor();
    await mostrarTodo(page);
    await esperar(async () => (await page.locator("#a-folio").inputValue()) !== "");
    await page.locator("#a-tipo").getByRole("radio", { name: /Toxinas lipofílicas/ }).check();
    await page.locator("#a-ext").selectOption(String(cN.E));
    await page.selectOption("#a-metodo", "hplc_ms_ms");
    const equipo2 = page.getByPlaceholder(/Cromatógrafo, microscopio/);
    await equipo2.click();
    await equipo2.fill(centrif.nombre);
    await page.getByRole("option", { name: new RegExp(centrif.nombre) }).first().click();
    await page.fill("#a-hf", "13:30");
    await page.locator('input[aria-label^="Resultado de "]').first().waitFor();
    const id2 = page.locator('input[aria-label^="ID de la muestra"]').first();
    if (!(await id2.inputValue())) await id2.fill(cN.idInt);
    await page.locator('input[aria-label^="Resultado de "]').first().fill("42");
    await page.getByRole("button", { name: "Registrar análisis" }).click();
    await guardarDeTodosModos(page);
    const aviso = page.locator("[role=alertdialog][data-validacion]");
    const fin = await Promise.race([page.waitForURL((url) => url.pathname === "/muestras/analisis").then(() => "lista"), aviso.waitFor().then(() => "aviso")]);
    if (fin === "aviso") throw new Error(`no se registró: ${(await aviso.textContent()) || ""}`);
    const a = fila("SELECT id, extraccion_id, recepcion_id, metodo, hora_fin, analista_usuario_id FROM muestras_analisis WHERE extraccion_id = ? ORDER BY id DESC", cN.E);
    check("[cob:M:M-186] [cob:M:M-168] [cob:M:M-176] «Registrar análisis» crea el análisis ligado a la extracción (y su recepción) con la cuenta del analista", !!a && Number(a.recepcion_id) === Number(cN.R) && a.metodo === "hplc_ms_ms" && Number(a.analista_usuario_id) === Number(id.qa), JSON.stringify(a));
    check("[cob:M:M-164] «Hora de término» se guarda", String(a?.hora_fin || "").startsWith("13:30"), String(a?.hora_fin));
    await page.goto(`${BASE_WEB}/muestras/analisis/${a?.id}`);
    await page.getByRole("button", { name: "Guardar cambios" }).waitFor();
    check("[cob:M:M-186] en edición (registrado) el botón es «Guardar cambios»", (await page.getByRole("button", { name: "Registrar análisis" }).count()) === 0);
    await page.goto(`${BASE_WEB}/muestras/analisis/${A_L2}`);
    await page.locator("#a-folio").waitFor();
    await page.getByRole("button", { name: "Volver" }).first().waitFor();
    check("[cob:M:M-186] en revisión no hay «Guardar cambios» (solo lectura, «Volver»)", (await page.getByRole("button", { name: "Guardar cambios" }).count()) === 0);
  });

  /* ---------- Análisis: evidencia, envío a revisión, segregación, devolver, revisar, aprobar, enmendar ---------- */
  const cF1 = await cadena(t, `UXF1${s5}`);
  const cF2 = await cadena(t, `UXF2${s5}`);
  const cF3 = await cadena(t, `UXF3${s5}`);
  const A_F1 = await nuevoA(cF1);
  const A_F2 = await nuevoA(cF2);
  await flujoAnalisis(A_F2, "en_revision");
  const A_F3 = await nuevoA(cF3);
  check("(preparación 2) análisis para evidencia y flujo", !!A_F1 && estadoA(A_F2) === "en_revision" && !!A_F3, `${A_F1} ${estadoA(A_F2)} ${A_F3}`);
  const pdf = (texto) => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n% ${texto}`);
  const adjunto = (desc) => fila("SELECT id, nombre_almacenado, nombre_original, anulado_en, motivo_anulacion FROM adjuntos WHERE entidad = 'analisis' AND entidad_id = ? AND descripcion = ?", A_F1, desc);
  await paso("qa", "evidencia: zona de carga, rechazos, avance, lista, descargar, anular, integridad y envío a revisión", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/analisis/${A_F1}`);
    await mostrarTodo(page);
    const panel = page.locator("[data-evidencia]");
    await panel.waitFor();
    await page.getByText("Falta la evidencia instrumental").waitFor();
    const enviar = page.getByRole("button", { name: "Enviar a revisión" });
    check("[cob:M:M-197] sin evidencia vigente: aviso «Falta la evidencia instrumental»", (await page.getByText("Alerta de integridad").count()) === 0);
    check("[cob:M:M-179] sin evidencia «Enviar a revisión» está deshabilitado", await enviar.isDisabled());
    await enviar.locator("xpath=..").hover();
    await page.getByRole("tooltip").filter({ hasText: /Adjunta al menos una evidencia instrumental/ }).first().waitFor();
    check("[cob:M:M-179] el motivo se explica en el tooltip «Adjunta al menos una evidencia instrumental…»", true);
    const archivo = page.locator(`#evidencia-archivo-${A_F1}`);
    await archivo.setInputFiles({ name: "programa.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
    const ext = await popup(page);
    await archivo.setInputFiles({ name: "vacio.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) });
    const vacio = await popup(page);
    check("[cob:M:M-189] la zona de carga rechaza un formato no permitido y un archivo vacío sin subir nada", (await panel.locator("[data-zona-carga]").count()) === 1 && /El formato \.exe no está permitido/.test(ext) && /El archivo está vacío/.test(vacio) && !fila("SELECT id FROM adjuntos WHERE entidad = 'analisis' AND entidad_id = ?", A_F1), `${ext.slice(0, 120)} · ${vacio.slice(0, 120)}`);
    const ruta = `**/api/samples/analysis/${A_F1}/adjuntos`;
    await page.route(ruta, async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await archivo.setInputFiles({ name: `cromatograma-${s5}.pdf`, mimeType: "application/pdf", buffer: pdf(`uno ${s5}`) });
    await page.selectOption(`#evidencia-tipo-${A_F1}`, { index: 1 });
    await page.fill(`#evidencia-desc-${A_F1}`, `Cromatograma uno ${s5}`);
    await page.getByRole("button", { name: "Adjuntar evidencia" }).click();
    const barra = page.getByRole("progressbar", { name: "Avance de la carga" });
    await barra.waitFor();
    const uno = await esperar(() => adjunto(`Cromatograma uno ${s5}`));
    await panel.locator(`[data-adjunto="${uno?.id}"]`).waitFor();
    await barra.waitFor({ state: "detached" });
    await page.unroute(ruta);
    check("[cob:M:M-191] «Adjuntar evidencia» muestra «Avance de la carga» mientras sube y la quita al terminar", !!uno);
    check("[cob:M:M-192] el adjunto subido aparece en la lista [data-adjunto] con su descripción", ((await panel.locator(`[data-adjunto="${uno?.id}"]`).textContent()) || "").includes(`Cromatograma uno ${s5}`));
    await archivo.setInputFiles({ name: `reporte-${s5}.pdf`, mimeType: "application/pdf", buffer: pdf(`dos ${s5}`) });
    await page.selectOption(`#evidencia-tipo-${A_F1}`, { index: 1 });
    await page.fill(`#evidencia-desc-${A_F1}`, `Reporte dos ${s5}`);
    await page.getByRole("button", { name: "Adjuntar evidencia" }).click();
    const dos = await esperar(() => adjunto(`Reporte dos ${s5}`));
    const filaDos = panel.locator(`[data-adjunto="${dos?.id}"]`);
    await filaDos.waitFor();
    await filaDos.getByRole("button", { name: "Anular…" }).click();
    const dAnular = page.getByRole("dialog").filter({ has: page.locator("#prompt-motivo") });
    await dAnular.waitFor();
    const etiqueta = (await dAnular.getByText("Motivo de la anulación").count()) >= 1 && (await dAnular.locator("#prompt-password").count()) === 1;
    await dialogoMotivo(page, "Se adjuntó el archivo equivocado", "Anular adjunto", pwd("qa"));
    await filaDos.waitFor({ state: "detached" });
    const an = adjunto(`Reporte dos ${s5}`);
    check("[cob:M:M-195] «Anular…» (crítico, «Motivo de la anulación», «Anular adjunto») anula el adjunto con su motivo y lo quita de la lista", etiqueta && !!an?.anulado_en && an?.motivo_anulacion === "Se adjuntó el archivo equivocado", JSON.stringify(an));
    await panel.getByRole("switch", { name: "Mostrar anulados" }).click();
    await filaDos.waitFor();
    const textoDos = (await filaDos.textContent()) || "";
    check("[cob:M:M-193] «Mostrar anulados» muestra el anulado con su marca y motivo (sin «Anular…»)", /Anulado/.test(textoDos) && textoDos.includes("Se adjuntó el archivo equivocado") && (await filaDos.getByRole("button", { name: "Anular…" }).count()) === 0, textoDos.slice(0, 200));
    const filaUno = panel.locator(`[data-adjunto="${uno?.id}"]`);
    const [descarga] = await Promise.all([page.waitForEvent("download"), filaUno.getByRole("button", { name: "Descargar" }).click()]);
    check("[cob:M:M-194] «Descargar» baja el archivo con su nombre original; un PDF tiene «Vista previa»", descarga.suggestedFilename() === `cromatograma-${s5}.pdf` && (await filaUno.getByRole("button", { name: "Vista previa" }).count()) === 1, descarga.suggestedFilename());
    const enDisco = path.join(path.dirname(process.env.TEST_DB_PATH), "evidencias", uno.nombre_almacenado);
    const original = fs.readFileSync(enDisco);
    try {
      fs.writeFileSync(enDisco, Buffer.concat([original, Buffer.from("alterado")]));
      await page.reload();
      await mostrarTodo(page);
      await page.getByText("Alerta de integridad").first().waitFor();
      check("[cob:M:M-197] archivo alterado en disco → «Alerta de integridad» y la marca «Alterado» en el adjunto", (await page.locator(`[data-adjunto="${uno.id}"]`).getByText("Alterado").count()) === 1);
    } finally {
      fs.writeFileSync(enDisco, original);
    }
    await page.reload();
    await mostrarTodo(page);
    await page.locator(`[data-adjunto="${uno.id}"]`).waitFor();
    check("(limpieza) con el archivo original de vuelta ya no hay alerta", (await page.getByText("Alerta de integridad").count()) === 0);
    await esperar(async () => !(await enviar.isDisabled()));
    await enviar.click();
    const conf = page.locator("[role=dialog], [role=alertdialog]").filter({ hasText: /^Enviar A.*a revisión/ });
    await conf.waitFor();
    await conf.getByRole("button", { name: "Enviar a revisión" }).click();
    await page.waitForURL((url) => url.pathname === "/muestras/analisis");
    check("[cob:M:M-179] [cob:M:M-180] con evidencia «Enviar a revisión» se habilita; la confirmación «Enviar A … a revisión» lo manda a revisión", estadoA(A_F1) === "en_revision", estadoA(A_F1));
    await page.goto(`${BASE_WEB}/muestras/analisis/${A_F1}`);
    const marcar = page.getByRole("button", { name: "Marcar revisado" });
    await marcar.waitFor();
    const bloqueo = (await marcar.locator("xpath=..").getAttribute("aria-label")) || "";
    check("[cob:M:M-183] quien lo elaboró ve «Marcar revisado» deshabilitado por segregación", (await marcar.isDisabled()) && /elaboraste|otra persona/i.test(bloqueo), bloqueo);
    const bExc = page.getByRole("button", { name: /^Solicitar excepción para revisar/ });
    await bExc.waitFor();
    const habilitado = !(await bExc.isDisabled());
    let sol = null;
    if (habilitado) {
      await bExc.click();
      await page.getByRole("dialog", { name: /^Solicitar excepción para revisar A/ }).waitFor();
      await dialogoMotivo(page, "No hay otra persona disponible para revisar hoy", "Solicitar excepción", pwd("qa"));
      sol = await esperar(() => pendienteDe("muestras_analisis", A_F1));
    }
    check("[cob:M:M-185] en revisión, «Solicitar excepción para revisar…» se puede usar (crítico) y crea la solicitud excepcion_segregacion", habilitado && sol?.tipo === "excepcion_segregacion" && estadoA(A_F1) === "en_revision", habilitado ? JSON.stringify(sol) : "el botón está deshabilitado (dentro del fieldset de solo lectura)");
    await cancelar("muestras_analisis", A_F1);
  });
  await paso("ricardo", "análisis: devolver, marcar revisado, aprobar (firma) y enmendar", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/analisis/${A_F1}`);
    const dev = page.getByRole("button", { name: "Devolver con observaciones" });
    await dev.waitFor();
    await dev.click();
    const d = page.getByRole("dialog", { name: /^Devolver A.* con observaciones$/ });
    await d.waitFor();
    const etiqueta = (await d.getByText("Observaciones para el analista").count()) >= 1 && (await d.locator("#prompt-password").count()) === 0;
    await page.fill("#prompt-motivo", "Falta el blanco de reactivos");
    await d.getByRole("button", { name: "Devolver", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/muestras/analisis");
    const devuelto = fila("SELECT estado, devolucion_observaciones FROM muestras_analisis WHERE id = ?", A_F1);
    check("[cob:M:M-181] «Devolver con observaciones» (no crítico) lo regresa a registrado con las observaciones", etiqueta && devuelto?.estado === "registrado" && devuelto?.devolucion_observaciones === "Falta el blanco de reactivos", JSON.stringify(devuelto));

    await page.goto(`${BASE_WEB}/muestras/analisis/${A_F2}`);
    await page.getByRole("button", { name: "Marcar revisado" }).click();
    const sr = page.getByRole("dialog", { name: "Marcar análisis como revisado" });
    await sr.waitFor();
    check("[cob:M:M-014] SignDialog de revisión: «Observaciones», «Firma (opcional)», «Cancelar» y «Marcar revisado» (sin contraseña)", (await sr.locator("#sign-obs").count()) === 1 && (await sr.getByText("Firma (opcional)").count()) === 1 && (await sr.getByRole("button", { name: "Cancelar" }).count()) === 1 && (await sr.locator("#sign-password").count()) === 0);
    await page.fill("#sign-obs", "Revisado contra el cromatograma");
    await sr.getByRole("button", { name: "Marcar revisado" }).click();
    await esperar(() => estadoA(A_F2) === "revisado");
    const rev = fila("SELECT estado, revisado_por, revision_observaciones FROM muestras_analisis WHERE id = ?", A_F2);
    check("[cob:M:M-183] «Marcar revisado» (en revisión) firma la revisión con observaciones", rev?.estado === "revisado" && Number(rev?.revisado_por) === Number(id.ricardo) && rev?.revision_observaciones === "Revisado contra el cromatograma", JSON.stringify(rev));
    await page.goto(`${BASE_WEB}/muestras/analisis/${A_F2}`);
    await page.getByRole("button", { name: "Aprobar", exact: true }).click();
    const sa = page.getByRole("dialog", { name: "Aprobar análisis" });
    await sa.waitFor();
    await sa.getByRole("button", { name: "Aprobar", exact: true }).click();
    await sa.getByText("Escribe tu contraseña para confirmar").waitFor();
    check("[cob:M:M-184] [cob:M:M-014] «Aprobar» (crítico) sin contraseña → «Escribe tu contraseña para confirmar»; sigue revisado", estadoA(A_F2) === "revisado");
    await page.fill("#sign-password", pwd("ricardo"));
    await sa.getByRole("button", { name: "Aprobar", exact: true }).click();
    await esperar(() => estadoA(A_F2) === "aprobado");
    const apr = fila("SELECT estado, aprobado_por FROM muestras_analisis WHERE id = ?", A_F2);
    check("[cob:M:M-184] con la contraseña queda aprobado a su nombre (revisor y aprobador pueden ser la misma persona)", apr?.estado === "aprobado" && Number(apr?.aprobado_por) === Number(id.ricardo), JSON.stringify(apr));
    await page.goto(`${BASE_WEB}/muestras/analisis/${A_F2}`);
    await page.getByRole("button", { name: "Enmendar…" }).click();
    const de = page.getByRole("dialog", { name: /^Enmendar A/ });
    await de.waitFor();
    const etiquetaE = (await de.getByText("Motivo de la enmienda").count()) >= 1;
    await page.fill("#prompt-motivo", "Se corrige la unidad reportada");
    await de.getByRole("button", { name: "Crear enmienda" }).click();
    const nueva = await esperar(() => fila("SELECT id, version, estado, motivo_enmienda FROM muestras_analisis WHERE sustituye_a = ?", A_F2));
    await page.waitForURL((url) => url.pathname === `/muestras/analisis/${nueva?.id}`);
    check("[cob:M:M-182] «Enmendar…» («Motivo de la enmienda», «Crear enmienda») crea la versión 2 en registrado y abre su ficha", etiquetaE && Number(nueva?.version) === 2 && nueva?.estado === "registrado" && nueva?.motivo_enmienda === "Se corrige la unidad reportada", JSON.stringify(nueva));
  });
  await paso("qa", "análisis: «Más acciones» anula y restaura desde la ficha", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/analisis/${A_F3}`);
    await page.getByRole("button", { name: "Más acciones" }).click();
    await page.getByRole("menuitem", { name: "Anular análisis…" }).click();
    await page.getByRole("dialog", { name: /^Anular análisis A/ }).waitFor();
    await dialogoMotivo(page, "Registro de prueba duplicado", "Anular", pwd("qa"));
    await page.waitForURL((url) => url.pathname === "/muestras/analisis");
    check("[cob:M:M-178] «Más acciones» → «Anular análisis…» lo anula", estadoA(A_F3) === "anulado", estadoA(A_F3));
    await page.goto(`${BASE_WEB}/muestras/analisis/${A_F3}`);
    await page.getByRole("button", { name: "Más acciones" }).click();
    await page.getByRole("menu").waitFor();
    const items = await opcionesMenu(page);
    await page.getByRole("menuitem", { name: "Restaurar análisis" }).click();
    await page.getByRole("dialog", { name: /^Restaurar análisis A/ }).waitFor();
    await dialogoMotivo(page, "Se anuló por error en la prueba", "Restaurar", pwd("qa"));
    await page.waitForURL((url) => url.pathname === "/muestras/analisis");
    check("[cob:M:M-178] en el anulado «Más acciones» ofrece «Restaurar análisis» (no «Anular») y lo restaura", !/Anular análisis…/.test(items) && estadoA(A_F3) === "registrado", `${items} ${estadoA(A_F3)}`);
  });

  /* ---------- Informes: flujo en pantalla, envíos, visor e integridad del PDF ---------- */
  const aprobadoDe = async (c) => {
    const A = await nuevoA(c);
    await flujoAnalisis(A);
    return A;
  };
  const nuevoI = async (c, A, cliente) => (await api("POST", "/informes", { recepcion_id: c.R, analisis_ids: A ? [A] : [], cliente: { nombre: cliente } }, t.qa)).data?.id;
  const estadoI = (iid) => fila("SELECT estado FROM informes WHERE id = ?", iid)?.estado;
  const cI1 = await cadena(t, `UXI1${s5}`);
  const aI1 = await aprobadoDe(cI1);
  const cI2 = await cadena(t, `UXI2${s5}`);
  const I_FL = await nuevoI(cI2, await aprobadoDe(cI2), `Cliente flujo ${s5}`);
  const cI3 = await cadena(t, `UXI3${s5}`);
  const I_AU = await nuevoI(cI3, await aprobadoDe(cI3), `Cliente autorizado ${s5}`);
  await api("POST", `/informes/${I_AU}/revisar`, {}, t.ricardo);
  await api("POST", `/informes/${I_AU}/autorizar`, {}, t.patricia);
  const cI4 = await cadena(t, `UXI4${s5}`);
  const aI4 = await aprobadoDe(cI4);
  const I_RE = await nuevoI(cI4, aI4, `Cliente por enmendar ${s5}`);
  await api("POST", `/informes/${I_RE}/revisar`, {}, t.ricardo);
  await api("POST", `/informes/${I_RE}/autorizar`, {}, t.patricia);
  const enmI4 = (await api("POST", `/samples/analysis/${aI4}/enmendar`, { motivo: "Se corrige la unidad del resultado" }, t.qa)).data?.id;
  await flujoAnalisis(enmI4);
  const I_AN = await nuevoI(cI3, null, `Cliente anulado ${s5}`);
  const anI = await api("POST", `/informes/${I_AN}/anular`, { motivo: "Informe creado por error en la prueba" }, t.qa);
  const R_XAN = await nuevaR(`UXRX-${s5}`);
  await api("POST", `/samples/reception/${R_XAN}/anular`, { motivo: "Recepción duplicada de la prueba" }, t.qa);
  check("(preparación 2) informes en borrador, autorizado, por enmendar y anulado", estadoI(I_FL) === "borrador" && estadoI(I_AU) === "autorizado" && Number(fila("SELECT requiere_enmienda FROM informes WHERE id = ?", I_RE)?.requiere_enmienda) === 1 && anI.status === 200 && estadoI(I_AN) === "anulado", `${estadoI(I_FL)} ${estadoI(I_AU)} ${anI.status} ${estadoI(I_AN)}`);

  await paso("qa", "informe nuevo: recepción, fecha de emisión, cliente, análisis y «Crear borrador»", async (page) => {
    await page.goto(`${BASE_WEB}/informes/nuevo`);
    await page.locator("#i-rec").waitFor();
    await mostrarTodo(page);
    const opciones = await page.locator("#i-rec option").evaluateAll((os) => os.map((o) => o.value));
    check("[cob:M:M-204] «Recepción» no ofrece recepciones rechazadas ni anuladas", opciones.includes(String(cI1.R)) && !opciones.includes(String(R_RECH)) && !opciones.includes(String(R_XAN)), `${opciones.length} opciones`);
    check("[cob:M:M-205] «Fecha de emisión» empieza vacía, con la pista «Se fija al autorizar si se deja vacía.» (antes se proponía la fecha del borrador)", (await page.locator("#i-fecha").inputValue()) === "" && (await page.getByText("Se fija al autorizar si se deja vacía.").count()) === 1, await page.locator("#i-fecha").inputValue());
    await page.getByRole("button", { name: "Crear borrador" }).click();
    const faltan = await popup(page);
    check("[cob:M:M-204] [cob:M:M-207] [cob:M:M-209] sin recepción, cliente ni análisis → «Elige la recepción que se informa», «Indica el nombre del cliente», «Marca al menos un análisis aprobado»", /Elige la recepción que se informa/.test(faltan) && /Indica el nombre del cliente/.test(faltan) && /Marca al menos un análisis aprobado/.test(faltan), faltan.slice(0, 400));
    await page.locator("#i-rec").selectOption(String(cI1.R));
    await esperar(async () => (await page.locator("#i-cli").inputValue()) !== "");
    const casillas = page.locator("#i-analisis").getByRole("checkbox");
    await casillas.first().waitFor();
    check("[cob:M:M-204] [cob:M:M-207] al elegir la recepción se cargan el cliente y sus análisis aprobados", (await page.locator("#i-cli").inputValue()) === `Cliente UXI1${s5}` && (await casillas.count()) === 1, `${await page.locator("#i-cli").inputValue()} ${await casillas.count()}`);
    if (await casillas.first().isChecked()) await casillas.first().uncheck();
    await page.fill("#i-con", "Lic. Contacto Cobertura");
    await page.fill("#i-dir", "Av. del Puerto 100, Ensenada");
    await page.fill("#i-correo", "contacto@ejemplo.mx");
    await page.fill("#i-fecha", "");
    await page.fill("#i-alc", "Los resultados se refieren solo a la muestra recibida");
    await page.fill("#i-regla", "Aceptación simple contra el límite regulatorio");
    const elaboro = await page.locator("#persona-elaboro option").allTextContents();
    if (!(await page.locator("#persona-elaboro").inputValue())) await page.locator("#persona-elaboro").selectOption({ label: elaboro.find((o) => o.includes("QA Ficotox")) });
    await page.getByRole("button", { name: "Crear borrador" }).click();
    const faltan2 = await popup(page);
    check("[cob:M:M-209] sin marcar análisis → «Marca al menos un análisis aprobado»", /Marca al menos un análisis aprobado/.test(faltan2) && !/Indica el nombre del cliente/.test(faltan2), faltan2.slice(0, 300));
    await casillas.first().check();
    await page.getByRole("button", { name: "Crear borrador" }).click();
    await guardarDeTodosModos(page);
    await page.waitForURL((url) => /^\/informes\/\d+$/.test(url.pathname));
    const nuevoId = Number(new URL(page.url()).pathname.split("/").pop());
    const inf = fila("SELECT recepcion_id, cliente_json, analisis_ids_json, fecha_emision, estado FROM informes WHERE id = ?", nuevoId) || {};
    const cliente = JSON.parse(inf.cliente_json || "{}");
    check("[cob:M:M-222] [cob:M:M-207] [cob:M:M-209] [cob:M:M-205] «Crear borrador» guarda recepción, cliente (contacto, dirección, correo) y el análisis marcado; la fecha de emisión borrada queda vacía (se fija al autorizar)", inf.estado === "borrador" && Number(inf.recepcion_id) === Number(cI1.R) && cliente.contacto === "Lic. Contacto Cobertura" && cliente.direccion === "Av. del Puerto 100, Ensenada" && cliente.correo === "contacto@ejemplo.mx" && JSON.parse(inf.analisis_ids_json || "[]").map(Number).includes(Number(aI1)) && !inf.fecha_emision, JSON.stringify(inf).slice(0, 300));
    await page.getByRole("button", { name: "Guardar borrador" }).waitFor();
    await page.getByRole("button", { name: "Cancelar", exact: true }).first().click();
    await page.waitForURL((url) => url.pathname === "/informes");
    check("[cob:M:M-213] [cob:M:M-222] en borrador: «Guardar borrador» y «Cancelar» vuelve a la lista", true);
  });

  await paso("qa", "informe en borrador: «Marcar revisado» bloqueado por segregación, excepción y «Más acciones»", async (page) => {
    await page.goto(`${BASE_WEB}/informes/${I_FL}`);
    const marcar = page.getByRole("button", { name: "Marcar revisado" });
    await marcar.waitFor();
    check("[cob:M:M-219] quien lo elaboró ve «Marcar revisado» deshabilitado (regla 2)", await marcar.isDisabled());
    await page.getByRole("button", { name: "Más acciones" }).click();
    await page.getByRole("menu").waitFor();
    const items = await opcionesMenu(page);
    await page.keyboard.press("Escape");
    check("[cob:M:M-215] [cob:M:M-216] en borrador «Más acciones» ofrece «Vista previa del PDF» y no «Descargar PDF» ni «Emitir enmienda…»", /Vista previa del PDF/.test(items) && !/Descargar PDF/.test(items) && !/Emitir enmienda/.test(items), items);
    await page.getByRole("button", { name: /^Solicitar excepción para revisar/ }).click();
    await page.getByRole("dialog", { name: /^Solicitar excepción para revisar/ }).waitFor();
    await dialogoMotivo(page, "No hay otra persona disponible para revisar el informe", "Solicitar excepción", pwd("qa"));
    const sol = await esperar(() => pendienteDe("informes", I_FL));
    check("[cob:M:M-223] «Solicitar excepción para revisar…» (crítico) crea la solicitud excepcion_segregacion", sol?.tipo === "excepcion_segregacion" && estadoI(I_FL) === "borrador", JSON.stringify(sol));
    await cancelar("informes", I_FL);
  });
  await paso("ricardo", "informe: «Marcar revisado»", async (page) => {
    await page.goto(`${BASE_WEB}/informes/${I_FL}`);
    await page.getByRole("button", { name: "Marcar revisado" }).click();
    const d = page.getByRole("dialog", { name: "Marcar informe como revisado" });
    await d.waitFor();
    await d.getByRole("button", { name: "Marcar revisado" }).click();
    await esperar(() => estadoI(I_FL) === "en_revision");
    check("[cob:M:M-219] «Marcar revisado» (borrador, no crítico) lo pasa a en revisión a nombre de quien revisa", estadoI(I_FL) === "en_revision" && Number(fila("SELECT revisado_por FROM informes WHERE id = ?", I_FL)?.revisado_por) === Number(id.ricardo), estadoI(I_FL));
  });
  await paso("patricia", "informe: autorizar (firma y contraseña), liberar, visor, integridad, envíos, descargar y enmienda", async (page) => {
    await page.goto(`${BASE_WEB}/informes/${I_FL}`);
    await page.getByRole("button", { name: "Autorizar", exact: true }).click();
    const da = page.getByRole("dialog", { name: "Autorizar informe" });
    await da.waitFor();
    await da.getByRole("button", { name: "Autorizar", exact: true }).click();
    await da.getByText("La firma es obligatoria").waitFor();
    await firmar(page, "Firma: Autorizar informe");
    await da.getByRole("button", { name: "Autorizar", exact: true }).click();
    await da.getByText("Escribe tu contraseña para confirmar").waitFor();
    check("[cob:M:M-220] «Autorizar» exige la firma («La firma es obligatoria») y la contraseña; sigue en revisión", estadoI(I_FL) === "en_revision");
    await page.fill("#sign-password", pwd("patricia"));
    await da.getByRole("button", { name: "Autorizar", exact: true }).click();
    await esperar(() => estadoI(I_FL) === "autorizado");
    check("[cob:M:M-220] con firma y contraseña queda autorizado", estadoI(I_FL) === "autorizado" && !!fila("SELECT autorizado_firma FROM informes WHERE id = ?", I_FL)?.autorizado_firma, estadoI(I_FL));
    await page.goto(`${BASE_WEB}/informes/${I_FL}`);
    await page.getByRole("button", { name: "Liberar", exact: true }).click();
    const dl = page.getByRole("dialog", { name: "Liberar informe" });
    await dl.waitFor();
    await page.fill("#sign-password", pwd("patricia"));
    await dl.getByRole("button", { name: "Liberar", exact: true }).click();
    await esperar(() => estadoI(I_FL) === "liberado");
    const lib = fila("SELECT estado, archivo_pdf, pdf_sha256 FROM informes WHERE id = ?", I_FL);
    check("[cob:M:M-221] «Liberar» (crítico) genera el PDF con su SHA-256", lib?.estado === "liberado" && !!lib?.archivo_pdf && /^[0-9a-f]{64}$/.test(String(lib?.pdf_sha256 || "")), JSON.stringify(lib));
    await page.goto(`${BASE_WEB}/informes/${I_FL}`);
    const ver = page.getByRole("button", { name: "Ver informe" });
    await ver.waitFor();
    check("[cob:M:M-213] liberado: el botón es «Volver» (no «Cancelar»)", (await page.getByRole("button", { name: "Volver", exact: true }).count()) === 1 && (await page.getByRole("button", { name: "Cancelar", exact: true }).count()) === 0);
    await ver.click();
    await page.waitForURL((url) => url.pathname === `/informes/${I_FL}/ver`);
    const visor = page.locator("[data-visor][data-visor-informe]");
    await visor.waitFor();
    check("[cob:M:M-214] [cob:M:M-235] «Ver informe» abre el visor con su contenido y sin alerta de integridad", (await visor.locator("[data-visor-contenido]").count()) === 1 && (await page.locator("[data-testid=visor-aviso-integridad]").count()) === 0);
    await page.getByRole("button", { name: "Volver" }).click();
    await page.waitForURL((url) => url.pathname === `/informes/${I_FL}`);
    check("[cob:M:M-236] «Volver» del visor regresa a la ficha", true);
    const enDisco = path.join(path.dirname(process.env.TEST_DB_PATH), "informes", lib.archivo_pdf);
    const original = fs.readFileSync(enDisco);
    try {
      fs.writeFileSync(enDisco, Buffer.concat([original, Buffer.from("\n% alterado")]));
      await page.goto(`${BASE_WEB}/informes/${I_FL}/ver`);
      const alerta = page.locator("[data-testid=visor-aviso-integridad][role=alert]");
      await alerta.waitFor();
      check("[cob:M:M-241] PDF alterado en disco → el visor avisa «El PDF no coincide con su huella SHA-256.»", ((await alerta.textContent()) || "").includes("El PDF no coincide con su huella SHA-256."));
      await page.goto(`${BASE_WEB}/informes/${I_FL}`);
      await page.getByText("Alerta de integridad del PDF").waitFor();
      check("[cob:M:M-224] la ficha muestra «Alerta de integridad del PDF»", true);
    } finally {
      fs.writeFileSync(enDisco, original);
    }

    await page.goto(`${BASE_WEB}/informes/${I_FL}`);
    const envios = page.locator("[data-envios]");
    await envios.waitFor();
    await page.locator("#envio-nombre").waitFor();
    const evid = page.locator("#envio-evidencia");
    check("[cob:M:M-230] «Evidencia del correo enviado» acepta .pdf,.png,.jpg,.jpeg,.webp,.eml,.msg y declara 25 MB", (await evid.getAttribute("accept")) === ".pdf,.png,.jpg,.jpeg,.webp,.eml,.msg" && (await page.getByText(/máx\. 25 MB/).count()) === 1, await evid.getAttribute("accept"));
    check("[cob:M:M-232] liberado: «Abrir en mi correo» y «Registrar envío» (sin SMTP no hay «Enviar desde la plataforma»)", (await page.getByRole("button", { name: "Abrir en mi correo" }).count()) === 1 && (await page.getByRole("button", { name: "Registrar envío" }).count()) === 1 && (await page.getByRole("button", { name: "Enviar desde la plataforma" }).count()) === 0);
    await page.fill("#envio-nombre", "");
    await page.fill("#envio-correo", "");
    await page.getByRole("button", { name: "Registrar envío" }).click();
    const faltan = await popup(page);
    check("[cob:M:M-228] [cob:M:M-230] sin destinatario, correo ni evidencia → «Indica el nombre del destinatario», «Indica el correo del destinatario» y «Adjunta la evidencia del correo enviado»", /Indica el nombre del destinatario/.test(faltan) && /Indica el correo del destinatario/.test(faltan) && /Adjunta la evidencia del correo enviado/.test(faltan), faltan.slice(0, 400));
    await page.fill("#envio-nombre", "Cliente flujo");
    await page.fill("#envio-correo", "no-es-correo");
    await page.getByRole("button", { name: "Registrar envío" }).click();
    const malo = await popup(page);
    check("[cob:M:M-228] correo con formato inválido → «Escribe un correo válido»; no se registra", /Escribe un correo válido/.test(malo) && !fila("SELECT id FROM envios_informe WHERE informe_id = ?", I_FL), malo.slice(0, 200));
    await page.fill("#envio-correo", "cliente.flujo@ejemplo.mx");
    await evid.setInputFiles({ name: `correo-${s5}.pdf`, mimeType: "application/pdf", buffer: pdf(`envío ${s5}`) });
    await page.getByRole("button", { name: "Registrar envío" }).click();
    const envio = await esperar(() => fila("SELECT id, destinatario_correo, evidencia_sha256 FROM envios_informe WHERE informe_id = ?", I_FL));
    const filaEnvio = envios.locator(`[data-envio="${envio?.id}"]`);
    await filaEnvio.waitFor();
    check("[cob:M:M-225] el envío aparece en [data-envios] con destinatario y la huella SHA-256 de la evidencia", envio?.destinatario_correo === "cliente.flujo@ejemplo.mx" && ((await filaEnvio.textContent()) || "").includes(`SHA-256 ${String(envio?.evidencia_sha256 || "").slice(0, 12)}`), JSON.stringify(envio));
    const [resp] = await Promise.all([page.waitForResponse((r) => r.url().includes(`/envios/${envio?.id}/evidencia`)), filaEnvio.getByRole("button", { name: "Descargar" }).click()]);
    check("[cob:M:M-226] «Descargar» de la evidencia la pide al servidor con sesión y la entrega (200)", resp.status() === 200, String(resp.status()));
    await filaEnvio.getByRole("button", { name: "Registrar confirmación" }).click();
    const dc = page.getByRole("dialog", { name: "Registrar confirmación de recepción" });
    await dc.waitFor();
    await page.fill("#conf-fecha", "");
    await dc.getByRole("button", { name: "Registrar confirmación" }).click();
    const sinFecha = await popup(page);
    check("[cob:M:M-227] [cob:M:M-233] «Registrar confirmación» abre el diálogo; sin fecha → «Indica la fecha de la confirmación»", /Indica la fecha de la confirmación/.test(sinFecha) && !fila("SELECT confirmacion_en FROM envios_informe WHERE id = ?", envio?.id)?.confirmacion_en, sinFecha.slice(0, 200));
    await page.fill("#conf-fecha", hoy());
    await page.fill("#conf-nota", "Confirmó por teléfono");
    await dc.getByRole("button", { name: "Registrar confirmación" }).click();
    await esperar(() => fila("SELECT confirmacion_en FROM envios_informe WHERE id = ?", envio?.id)?.confirmacion_en);
    const conf = fila("SELECT confirmacion_en, confirmacion_nota FROM envios_informe WHERE id = ?", envio?.id);
    await filaEnvio.getByText(/Confirmado/).waitFor();
    check("[cob:M:M-233] con fecha y nota la confirmación se guarda y la fila muestra «Confirmado»", String(conf?.confirmacion_en || "").startsWith(hoy()) && conf?.confirmacion_nota === "Confirmó por teléfono", JSON.stringify(conf));

    await page.goto(`${BASE_WEB}/informes/${I_RE}`);
    const liberar = page.getByRole("button", { name: "Liberar", exact: true });
    await liberar.waitFor();
    await page.getByText("Requiere enmienda", { exact: true }).first().waitFor();
    check("[cob:M:M-221] [cob:M:M-224] con un análisis enmendado: aviso «Requiere enmienda» y «Liberar» deshabilitado con el motivo en su título", (await liberar.isDisabled()) && /^Requiere enmienda:/.test((await liberar.getAttribute("title")) || ""), await liberar.getAttribute("title"));
  });
  await paso("qa", "informe liberado: «Más acciones», «Descargar PDF» y «Emitir enmienda…»", async (page) => {
    await page.goto(`${BASE_WEB}/informes/${I_FL}`);
    await page.getByRole("button", { name: "Más acciones" }).click();
    await page.getByRole("menu").waitFor();
    const items = await opcionesMenu(page);
    check("[cob:M:M-215] con PDF «Más acciones» ofrece «Ver informe», «Descargar PDF» y «Emitir enmienda…»", /Ver informe/.test(items) && /Descargar PDF/.test(items) && /Emitir enmienda…/.test(items), items);
    const [descarga] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Descargar PDF" }).click()]);
    check("[cob:M:M-216] «Descargar PDF» baja el PDF del informe", /-v1\.pdf$/.test(descarga.suggestedFilename()), descarga.suggestedFilename());
    await page.getByRole("button", { name: "Más acciones" }).click();
    await page.getByRole("menuitem", { name: "Emitir enmienda…" }).click();
    const de = page.getByRole("dialog", { name: /^Emitir enmienda de / });
    await de.waitFor();
    await page.fill("#prompt-motivo", "Corrección del nombre del cliente");
    await de.getByRole("button", { name: "Crear enmienda" }).click();
    const enm = await esperar(() => fila("SELECT id, version, estado FROM informes WHERE sustituye_a = ?", I_FL));
    await page.waitForURL((url) => url.pathname === `/informes/${enm?.id}`);
    await page.getByText("Enmienda", { exact: true }).first().waitFor();
    check("[cob:M:M-217] [cob:M:M-224] «Emitir enmienda…» → «Crear enmienda» crea la versión 2 en borrador y la ficha muestra el aviso «Enmienda»", Number(enm?.version) === 2 && enm?.estado === "borrador", JSON.stringify(enm));

  });
  await paso("qa", "informe autorizado: «Anular informe…» pasa a solicitud de segundo usuario", async (page) => {
    await page.goto(`${BASE_WEB}/informes/${I_AU}`);
    await page.getByRole("button", { name: "Más acciones" }).click();
    await page.getByRole("menuitem", { name: "Anular informe…" }).click();
    await page.getByRole("dialog", { name: /^Anular informe / }).waitFor();
    await dialogoMotivo(page, "Se informó con el cliente equivocado", "Anular", pwd("qa"));
    const sol = await esperar(() => pendienteDe("informes", I_AU));
    await toast(page, /solicit/i);
    check("[cob:M:M-218] «Anular informe…» (crítico) de un autorizado crea la solicitud anular_informe y no lo anula todavía", sol?.tipo === "anular_informe" && estadoI(I_AU) === "autorizado", JSON.stringify(sol));
    await cancelar("informes", I_AU);
  });
  await paso("qa", "informes: lista (nuevo, buscador, estado, anulados y menú ⋯)", async (page) => {
    const urls = [];
    page.on("request", (r) => r.url().includes("/api/informes?") && urls.push(r.url()));
    await page.goto(`${BASE_WEB}/informes`);
    const nuevo = page.getByRole("link", { name: "Nuevo informe" });
    await nuevo.waitFor();
    check("[cob:M:M-198] «Nuevo informe» enlaza al alta", (await nuevo.getAttribute("href")) === "/informes/nuevo", await nuevo.getAttribute("href"));
    const buscar = page.getByPlaceholder("Buscar por folio, cliente o ID interno");
    await buscar.fill(`Cliente flujo ${s5}`);
    await page.getByRole("row").filter({ hasText: `Cliente flujo ${s5}` }).first().waitFor();
    await esperar(async () => !(await hay(page, `Cliente autorizado ${s5}`)));
    check("[cob:M:M-199] el buscador manda search= y filtra por cliente", !(await hay(page, `Cliente autorizado ${s5}`)) && urls.some((u) => u.includes("search=Cliente+flujo") || u.includes("search=Cliente%20flujo")), urls.slice(-1).join(""));
    await buscar.fill(s5);
    await page.getByRole("row").filter({ hasText: `Cliente autorizado ${s5}` }).first().waitFor();
    await page.getByRole("button", { name: /^Filtros/ }).click();
    const estados = await page.locator('section[aria-label="Estado"]').getByRole("switch").allTextContents();
    await page.keyboard.press("Escape");
    check("[cob:M:M-200] «Estado» ofrece las ocho opciones del renglón (con conteos del resumen)", ["Por revisar o autorizar", "Borradores", "En revisión", "Autorizados por liberar", "Liberados por enviar", "Enviados", "Requieren enmienda", "Sustituidos por enmienda"].every((o) => estados.some((e) => e.includes(o))), estados.join(" | "));
    await filtro(page, "Estado", "Autorizados por liberar");
    await esperar(async () => !(await hay(page, `Cliente flujo ${s5}`)));
    check("[cob:M:M-200] «Autorizados por liberar» manda estado=autorizado y deja solo los autorizados", urls.some((u) => u.includes("estado=autorizado")) && (await hay(page, `Cliente autorizado ${s5}`)) && !(await hay(page, `Cliente flujo ${s5}`)), urls.slice(-1).join(""));
    await quitarFiltro(page, "Autorizados por liberar");
    check("[cob:M:M-201] el anulado no aparece por omisión", !(await hay(page, `Cliente anulado ${s5}`)));
    await filtro(page, "Vista", "Mostrar anulados");
    await page.getByRole("row").filter({ hasText: `Cliente anulado ${s5}` }).first().waitFor();
    check("[cob:M:M-201] «Mostrar anulados» manda anulados=1 y lo incluye", urls.some((u) => u.includes("anulados=1")));
    const filaPdf = page.getByRole("row").filter({ hasText: `Cliente flujo ${s5}` }).filter({ hasText: /Enviado/ }).first();
    await filaPdf.getByRole("button", { name: /Acciones/ }).click();
    await page.getByRole("menu").waitFor();
    const conPdf = await opcionesMenu(page);
    await page.keyboard.press("Escape");
    await menuDeFila(page, `Cliente autorizado ${s5}`);
    const sinPdf = await opcionesMenu(page);
    await page.keyboard.press("Escape");
    check("[cob:M:M-202] menú ⋯: con PDF «Abrir», «Ver informe», «Descargar PDF», «Reportar incidencia»; sin PDF «Ver PDF» y sin «Descargar PDF»", /Abrir/.test(conPdf) && /Ver informe/.test(conPdf) && /Descargar PDF/.test(conPdf) && /Reportar incidencia/.test(conPdf) && /Ver PDF/.test(sinPdf) && !/Descargar PDF/.test(sinPdf), `${conPdf} // ${sinPdf}`);
  });

  await paso("qa", "recepción nueva en lote: «Agregar muestra»", async (page) => {
    await page.goto(`${BASE_WEB}/muestras/recepcion/nueva`);
    await page.locator("#r-folio").waitFor();
    await mostrarTodo(page);
    await page.getByRole("radio", { name: /^Lote/ }).check();
    const ids = page.locator('input[id^="r-lote-id-"]');
    await ids.first().waitFor();
    const antes = await ids.count();
    await page.getByRole("button", { name: "Agregar muestra" }).click();
    await esperar(async () => (await ids.count()) === antes + 1);
    await page.locator(`#r-lote-id-${antes}`).fill(`UXLT-${s5}-2`);
    check("[cob:M:M-055] en lote, «Agregar muestra» agrega una fila con su «ID interno de la muestra N»", (await ids.count()) === antes + 1 && (await page.getByLabel(`ID interno de la muestra ${antes + 1}`).inputValue()) === `UXLT-${s5}-2`, `${antes} → ${await ids.count()}`);
  });
}

await nav.cerrar();
terminar();
