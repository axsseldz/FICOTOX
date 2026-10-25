/*
 * Cobertura · Calidad en pantalla (Playwright): lista de incidencias y NC (filtros, orden, ventanas),
 * «Nueva NC», ficha de la incidencia (anulada, NC de origen, evaluar), «Reportar incidencia» desde un
 * registro, ficha de la NC (impacto, afectados, suspensión, comunicación, causa, acciones, verificación,
 * efectos en el SGC) y Auditoría (periodo, tipo de actividad, resumen, carga por páginas, navegación).
 * Cada check lleva [cob:C:C-xxx]. Todo con datos propios (marca COB<sello>); la suspensión de su equipo
 * propio se reanuda al terminar.
 */
import "../lib/reauth-auto.mjs";

process.env.BASE = `${(process.env.BASE || "http://localhost:3100").replace(/\/api$/, "")}/api`;
const { abrirNavegador, BASE_WEB, dialogoMotivo, entendido, esperar, mostrarTodo, sinAcceso, toast } = await import("../lib/navegador.mjs");
const { api, cadena, crearCheck, credenciales, Database, EMAIL, enDias, fila, filas, hoy, informeLiberado, sesiones } = await import("../lib/calidad.mjs");

const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const nav = await abrirNavegador({ suite: "cobertura-calidad", check, credencial: (quien) => ({ email: EMAIL[quien], password: credenciales[EMAIL[quien]] }) });
const { paso } = nav;
const s5 = Date.now().toString(36);
const MARCA = `COB${s5}`;
const ejecutar = (sql, ...p) => {
  const b = new Database(process.env.TEST_DB_PATH);
  try {
    return b.prepare(sql).run(...p);
  } finally {
    b.close();
  }
};
const det = (r) => `${r?.status} ${r?.data?.codigo || ""} ${String(r?.data?.message || "").slice(0, 90)}`;
const ncRow = (n) => fila("SELECT * FROM no_conformidades WHERE id = ?", n);
const incRow = (n) => fila("SELECT * FROM incidencias WHERE id = ?", n);

/* Filtros: el menú «Filtros» se abre, se cambia el interruptor y se cierra con Escape. */
const interruptor = async (page, nombre, on = true) => {
  await page.getByRole("button", { name: /^Filtros/ }).click();
  const sw = page.getByRole("switch", { name: nombre, exact: true });
  await sw.waitFor();
  if (((await sw.getAttribute("aria-checked")) === "true") !== on) await sw.click();
  await page.keyboard.press("Escape");
};
/* Renglones visibles de la lista (en el orden de la pantalla). */
const renglones = (page) =>
  page.evaluate(() => [...document.querySelectorAll("[data-nc],[data-incidencia]")].map((e) => (e.hasAttribute("data-nc") ? `nc-${e.getAttribute("data-nc")}` : `incidencia-${e.getAttribute("data-incidencia")}`)));
/* Espera a que los renglones cumplan `cond` (la lista se recarga tras cada filtro). */
const hasta = async (page, cond) => {
  let ultimo = [];
  const ok = await esperar(async () => {
    ultimo = await renglones(page);
    return cond(new Set(ultimo));
  });
  return { ok: !!ok, v: ultimo.join(" ") };
};
/* Cambia un filtro y espera la respuesta de la lista con ese parámetro. */
const filtrar = async (page, nombre, parametro, on = true) => {
  const respuesta = evento(page.waitForResponse((r) => r.url().includes("/api/calidad/lista") && (on ? r.url().includes(parametro) : !r.url().includes(parametro))));
  await interruptor(page, nombre, on);
  await respuesta;
};

/* ---------- Datos propios ---------- */
const EQ_NOMBRE = `Equipo pantalla ${MARCA}`;
const EQ = (await api("POST", "/inventory/equipos", { nombre: EQ_NOMBRE, estado: "operativo", autorizar_a: [id.qa] }, t.ricardo)).data?.id;
const reportar = (token, extra) => api("POST", "/calidad/incidencias", { tipo: "otro", fecha_hora_ocurrencia: new Date(Date.now() - 60_000).toISOString(), descripcion: `Incidencia ${MARCA} para la cobertura de pantalla`, impacto_resultados: "no", ...extra }, token);
const evaluar = async (inc, body) => {
  await api("POST", `/calidad/incidencias/${inc}/evaluacion`, {}, t.ricardo);
  return api("POST", `/calidad/incidencias/${inc}/evaluar`, body, t.ricardo);
};
const I_REP = (await reportar(t.ricardo, { tipo: "falla_equipo", descripcion: `Incidencia ${MARCA} de Ricardo con su equipo`, registros: [{ entidad: "equipos", entidad_id: EQ }] })).data?.id;
const I_LUIS = (await reportar(t.luis, { tipo: "insumo", descripcion: `Incidencia ${MARCA} de Luis por evaluar en pantalla` })).data?.id;
const I_CER = (await reportar(t.luis, { tipo: "seguridad", descripcion: `Incidencia ${MARCA} de Luis ya cerrada sin NC` })).data?.id;
const evCer = await evaluar(I_CER, { decision: "cerrar_sin_nc", justificacion: "Evento aislado de la prueba de pantalla" });
const I_ESC = (await reportar(t.luis, { descripcion: `Incidencia ${MARCA} de Luis escalada a NC` })).data?.id;
const evEsc = await evaluar(I_ESC, { decision: "escalar", justificacion: "Conviene analizarla como no conformidad", nc: { clasificacion: "mayor", requisito_incumplido: "ISO/IEC 17025 7.10" } });
const N_ESC = evEsc.data?.nc_id;
const I_ANU = (await reportar(t.luis, { descripcion: `Incidencia ${MARCA} de Luis que se anulará` })).data?.id;
const MOTIVO_ANU = `Duplicada en la cobertura ${MARCA}`;
const anu = await api("POST", `/calidad/incidencias/${I_ANU}/anular`, { motivo: MOTIVO_ANU }, t.patricia);

const nuevaNc = async (desc, extra = {}) => (await api("POST", "/calidad/nc", { origen: "otro", descripcion: `NC ${MARCA} ${desc}`, responsable_id: id.ricardo, ...extra }, t.ana)).data?.id;
const IMPACTO = { afecta_resultados_emitidos: "no", trabajo_detenido: "no", notificar_cliente: "no" };
const CAUSA = { metodo_causa: "otro", causa_raiz: "Causa documentada para la cobertura de pantalla", requiere_accion_correctiva: "si" };
const N_MENOR = await nuevaNc("menor sin avanzar", { clasificacion: "menor" });
const N_VENC = await nuevaNc("con una acción vencida", { clasificacion: "critica" });
await api("PUT", `/calidad/nc/${N_VENC}`, { ...IMPACTO, ...CAUSA }, t.ricardo);
await api("POST", `/calidad/nc/${N_VENC}/avanzar`, { a: "en_analisis" }, t.ricardo);
const accVenc = (await api("POST", `/calidad/nc/${N_VENC}/acciones`, { descripcion: "Acción que se dejará vencer", responsable_id: id.luis, fecha_compromiso: enDias(3) }, t.ricardo)).data?.id;
// Una acción vencida no se puede crear por la API (la fecha compromiso no puede ser pasada): se ajusta su fecha.
if (accVenc) ejecutar("UPDATE acciones_correctivas SET fecha_compromiso = '2026-01-10' WHERE id = ?", accVenc);
const N_EDIT = await nuevaNc("de pantalla con edición completa");
const N_SIN = await nuevaNc("de pantalla sin acción correctiva");
const N_VER = await nuevaNc("de pantalla por verificar");
await api("PUT", `/calidad/nc/${N_VER}`, { ...IMPACTO, ...CAUSA }, t.ricardo);
await api("POST", `/calidad/nc/${N_VER}/avanzar`, { a: "en_analisis" }, t.ricardo);
const accVer = (await api("POST", `/calidad/nc/${N_VER}/acciones`, { descripcion: "Acción de Luis para verificar", responsable_id: id.luis, fecha_compromiso: enDias(5) }, t.ricardo)).data?.id;
await api("POST", `/calidad/nc/${N_VER}/avanzar`, { a: "acciones_en_curso" }, t.ricardo);
await api("POST", `/calidad/acciones/${accVer}/implementar`, { descripcion_implementacion: "Implementada para la cobertura de pantalla" }, t.luis);
await api("POST", `/calidad/nc/${N_VER}/avanzar`, { a: "en_verificacion" }, t.ricardo);
const INF = await informeLiberado(t, `CUI${s5}`);
check(
  "(preparación) datos propios de calidad",
  !!EQ && !!I_REP && !!I_LUIS && evCer.status === 200 && !!N_ESC && anu.status === 200 && incRow(I_ANU)?.estado === "anulada" && !!N_MENOR && !!accVenc && !!N_EDIT && !!N_SIN && ncRow(N_VER)?.estado === "en_verificacion" && INF.liberado,
  `${EQ} ${I_REP} ${I_LUIS} ${det(evCer)} ${N_ESC} ${det(anu)} ${N_MENOR} ${accVenc} ${N_EDIT} ${N_SIN} ${ncRow(N_VER)?.estado} ${INF.liberado}`,
);

/* ---------- Datos propios para ventanas, fichas, solicitudes, marcas y el aviso de suspensión ---------- */
const PW = (quien) => credenciales[EMAIL[quien]];
const folio = (prefijo, n) => `${prefijo} ${String(n).padStart(7, "0")}`;
const solRow = (n) => fila("SELECT * FROM solicitudes_autorizacion WHERE id = ?", n);
const accionDe = (sol) => JSON.parse(sol?.datos_json || "{}").accion || sol?.accion;
const solPendiente = (entidad, entidadId, tipo) => fila(`SELECT id FROM solicitudes_autorizacion WHERE entidad = ? AND entidad_id = ? AND estado = 'pendiente'${tipo ? " AND tipo = ?" : ""} ORDER BY id DESC LIMIT 1`, entidad, String(entidadId), ...(tipo ? [tipo] : []))?.id;
/* Espera de un evento del navegador que no rompe la corrida si el paso falla antes de usarla. */
const evento = (promesa) => {
  promesa.catch(() => {});
  return promesa;
};
const seccion = (page, titulo) => page.locator(`section[aria-labelledby="${titulo}"]`);
/* Cuenta las peticiones de un método a una ruta de la API (para comprobar que la pantalla no envió nada). */
const contar = (page, metodo, ruta) => {
  const c = { n: 0 };
  page.on("request", (r) => r.method() === metodo && ruta.test(new URL(r.url()).pathname) && (c.n += 1));
  return c;
};
/* Motivo dentro de un diálogo con nombre (cuando la ventana de atrás tiene un botón con el mismo texto). */
const motivoEn = async (page, nombre, motivo, confirmar, password) => {
  const d = page.getByRole("dialog", { name: nombre });
  await d.locator("#prompt-motivo").fill(motivo);
  if (password && (await d.locator("#prompt-password").count())) await d.locator("#prompt-password").fill(password);
  await d.getByRole("button", { name: confirmar, exact: true }).click();
};
/* El visor interno del PDF cargó (muestra el total de páginas). */
const visor = async (page) => {
  await page.getByTestId("visor-pdf").first().waitFor();
  return page.waitForFunction(() => /^\d+$/.test(document.querySelector("[data-testid=visor-total-paginas]")?.textContent || "")).then(() => true, () => false);
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const deLuis = async (texto) => (await reportar(t.luis, { descripcion: `Incidencia ${MARCA} de Luis ${texto}` })).data?.id;
const I_EV1 = await deLuis("para iniciar la evaluación en la ventana");
const I_EV2 = await deLuis("para escalar a una NC abierta");
const I_EV3 = await deLuis("que Mejora Continua escala a una NC nueva");
const I_ADJ = await deLuis("con una foto adjunta en la ficha");
const I_AN1 = await deLuis("cuya anulación se rechaza");
const I_AN2 = await deLuis("cuya anulación se cancela");
const I_AUTO = await deLuis("marcada como automática");
// Las incidencias automáticas solo las crea el sistema (recepción con desviación, alertas): se marca una propia.
if (I_AUTO) ejecutar("UPDATE incidencias SET origen_automatico = 'desviacion_recepcion' WHERE id = ?", I_AUTO);
const I_INF = (await reportar(t.ricardo, { descripcion: `Incidencia ${MARCA} ligada al informe propio`, registros: [{ entidad: "informes", entidad_id: INF.informe }] })).data?.id;
const EXT = await cadena(t, `CUS${s5}`, { equipos: [{ equipo_id: EQ, uso: "Centrifugación", folio_bitacora: `CUS-${s5}` }] });

const N_UI = await nuevaNc("para clasificación, requisito, impacto y responsable", { clasificacion: "menor" });
const N_AN = await nuevaNc("cuya anulación se aprueba en Por autorizar");
const N_AN2 = await nuevaNc("cuya anulación se cancela desde la ventana");
const N_ACC = await nuevaNc("con acciones para iniciar, implementar, reasignar y cancelar");
await api("PUT", `/calidad/nc/${N_ACC}`, { ...IMPACTO, ...CAUSA }, t.ricardo);
await api("POST", `/calidad/nc/${N_ACC}/avanzar`, { a: "en_analisis" }, t.ricardo);
const accion = async (nc, descripcion, responsable) => (await api("POST", `/calidad/nc/${nc}/acciones`, { descripcion, responsable_id: responsable, fecha_compromiso: enDias(7) }, t.ricardo)).data?.id;
const accIni = await accion(N_ACC, `Acción ${MARCA} que Luis inicia e implementa`, id.luis);
const accRea = await accion(N_ACC, `Acción ${MARCA} que se reasigna`, id.luis);
const accCan = await accion(N_ACC, `Acción ${MARCA} que se cancela`, id.luis);
/* Lleva una NC hasta «en verificación» con una acción implementada por `implementa`. */
const hastaVerificacion = async (nc, implementa) => {
  await api("PUT", `/calidad/nc/${nc}`, { ...IMPACTO, ...CAUSA }, t.ricardo);
  await api("POST", `/calidad/nc/${nc}/avanzar`, { a: "en_analisis" }, t.ricardo);
  const a = await accion(nc, `Acción ${MARCA} para verificar`, id[implementa]);
  await api("POST", `/calidad/nc/${nc}/avanzar`, { a: "acciones_en_curso" }, t.ricardo);
  await api("POST", `/calidad/acciones/${a}/implementar`, { descripcion_implementacion: "Implementada para la cobertura de pantalla" }, t[implementa]);
  return api("POST", `/calidad/nc/${nc}/avanzar`, { a: "en_verificacion" }, t.ricardo);
};
const N_R8 = await nuevaNc("en verificación con la acción que implementó Ricardo");
await hastaVerificacion(N_R8, "ricardo");
const N_REAB = await nuevaNc("verificada como no eficaz");
await hastaVerificacion(N_REAB, "luis");
const reab = await api("POST", `/calidad/nc/${N_REAB}/verificar`, { resultado: "no_eficaz", comentarios: "La causa volvió a presentarse en la prueba" }, t.ana);
const N_R9 = await nuevaNc("de la que Mejora Continua es responsable", { responsable_id: id.ana });
const N_CIE = await nuevaNc("lista para cerrarse sin acción correctiva");
await api("PUT", `/calidad/nc/${N_CIE}`, { ...IMPACTO, requiere_accion_correctiva: "no", justificacion_sin_accion: "Error aislado en la prueba de pantalla" }, t.ricardo);
await api("POST", `/calidad/nc/${N_CIE}/avanzar`, { a: "en_analisis" }, t.ricardo);
const EQ2 = (await api("POST", "/inventory/equipos", { nombre: `Equipo excepción ${MARCA}`, estado: "operativo" }, t.ricardo)).data?.id;
const N_SUS = await nuevaNc("en la que Mejora Continua suspende un equipo propio");
const susp2 = await api("POST", `/calidad/nc/${N_SUS}/suspensiones`, { tipo: "equipo", clave: String(EQ2), motivo: `Suspensión ${MARCA} de Mejora Continua` }, t.ana);
const SU2 = fila("SELECT id FROM suspensiones WHERE nc_id = ? AND reanudada_en IS NULL", N_SUS)?.id;
const N_PROP = await nuevaNc("con una propuesta documental heredada");
// Desde la NC ya no se crean propuestas documentales (POST …/propuesta-documental → 410): se simula una del flujo retirado.
const PROP = N_PROP ? Number(ejecutar("INSERT INTO propuestas_documento (tipo, titulo, motivo, propuesto_por, propuesto_en, estado, nc_id) VALUES ('cambio', ?, 'Heredada', ?, ?, 'pendiente', ?)", `Propuesta ${MARCA} del flujo retirado`, id.ana, new Date().toISOString(), N_PROP).lastInsertRowid) : null;
if (PROP) ejecutar("UPDATE no_conformidades SET propuesta_documento_id = ? WHERE id = ?", PROP, N_PROP);
check(
  "(preparación) datos propios para ventanas, fichas, solicitudes y marcas",
  [I_EV1, I_EV2, I_EV3, I_ADJ, I_AN1, I_AN2, I_AUTO, I_INF, EXT.E, N_UI, N_AN, N_AN2, accIni, accRea, accCan, N_R9, N_CIE, EQ2, SU2, PROP].every(Boolean) && ncRow(N_R8)?.estado === "en_verificacion" && reab.status === 200 && Number(ncRow(N_REAB)?.reaperturas) === 1 && susp2.status === 201,
  `${EXT.E} ${det(EXT.extraccion)} ${ncRow(N_R8)?.estado} ${det(reab)} ${ncRow(N_REAB)?.reaperturas} ${det(susp2)} ${SU2} ${PROP}`,
);
const LISTA = `${BASE_WEB}/calidad/incidencias?buscar=${MARCA}`;
const todas = (...ids) => (v) => ids.every((x) => v.has(x));
const ninguna = (...ids) => (v) => ids.every((x) => !v.has(x));
const y = (...conds) => (v) => conds.every((c) => c(v));

/* =================== Lista: filtros (C-007…C-014) =================== */
await paso("ricardo", "lista: filtros por tipo, estado, etapa, tipo de incidencia, clasificación, mis registros y situación", async (page) => {
  await page.goto(LISTA);
  const base = await hasta(page, todas(`incidencia-${I_REP}`, `incidencia-${I_LUIS}`, `incidencia-${I_CER}`, `nc-${N_MENOR}`, `nc-${N_VENC}`, `nc-${N_ESC}`));
  check("(lista) con la búsqueda salen las incidencias y NC propias", base.ok, base.v);
  await page.getByRole("button", { name: /^Filtros/ }).click();
  const menu = page.locator("[data-radix-popper-content-wrapper]");
  await menu.getByText("Tipo de registro").waitFor();
  const secciones = [];
  for (const titulo of ["Tipo de registro", "Estado de la incidencia", "Etapa de la no conformidad", "Tipo de incidencia", "Clasificación de la NC", "Mis registros", "Situación", "Periodo", "Ordenar por"]) secciones.push((await menu.getByText(titulo, { exact: true }).count()) > 0 ? "" : titulo);
  check("[cob:C:C-007] el botón «Filtros» abre el panel con todas las secciones", secciones.join("") === "", `faltan: ${secciones.filter(Boolean).join(", ")}`);
  await page.keyboard.press("Escape");

  await filtrar(page, "No conformidades", "tipos=nc");
  const soloNc = await hasta(page, y(todas(`nc-${N_MENOR}`, `nc-${N_VENC}`), ninguna(`incidencia-${I_REP}`, `incidencia-${I_LUIS}`)));
  const contador = await page.getByRole("button", { name: /^Filtros/ }).getAttribute("aria-label");
  check("[cob:C:C-007] [cob:C:C-008] «Tipo de registro › No conformidades» deja solo NC y el botón dice «Filtros (1 activos)»", soloNc.ok && /1 activos/.test(contador || ""), `${soloNc.v} · ${contador}`);
  await filtrar(page, "No conformidades", "tipos=", false);

  await filtrar(page, "Cerrada sin NC", "estado_inc=cerrada_sin_nc");
  const est = await hasta(page, y(todas(`incidencia-${I_CER}`, `nc-${N_MENOR}`), ninguna(`incidencia-${I_REP}`, `incidencia-${I_LUIS}`)));
  check("[cob:C:C-009] «Estado de la incidencia › Cerrada sin NC» filtra las incidencias y no oculta las NC", est.ok, est.v);
  await filtrar(page, "Cerrada sin NC", "estado_inc=", false);

  await filtrar(page, "Abierta", "etapa_nc=abierta");
  const etapa = await hasta(page, y(todas(`nc-${N_MENOR}`, `nc-${N_EDIT}`, `incidencia-${I_REP}`), ninguna(`nc-${N_VENC}`, `nc-${N_VER}`)));
  check("[cob:C:C-010] «Etapa de la NC › Abierta» oculta las NC en análisis o verificación y deja las incidencias", etapa.ok, etapa.v);
  await filtrar(page, "Abierta", "etapa_nc=", false);

  await filtrar(page, "Reactivo o insumo", "tipo_inc=insumo");
  const tipo = await hasta(page, y(todas(`incidencia-${I_LUIS}`, `nc-${N_MENOR}`), ninguna(`incidencia-${I_REP}`, `incidencia-${I_CER}`)));
  check("[cob:C:C-011] «Tipo de incidencia › Reactivo o insumo» deja solo esa incidencia (las NC siguen)", tipo.ok, tipo.v);
  await filtrar(page, "Reactivo o insumo", "tipo_inc=", false);

  await filtrar(page, "Mayor", "clasificacion=mayor");
  const clas = await hasta(page, y(todas(`nc-${N_ESC}`, `incidencia-${I_REP}`), ninguna(`nc-${N_MENOR}`, `nc-${N_VENC}`)));
  check("[cob:C:C-012] «Clasificación › Mayor» deja la NC mayor y oculta la menor y la crítica", clas.ok, clas.v);
  await filtrar(page, "Mayor", "clasificacion=", false);

  await filtrar(page, "Reportados por mí", "mias=reportados");
  const mias = await hasta(page, y(todas(`incidencia-${I_REP}`), ninguna(`incidencia-${I_LUIS}`, `nc-${N_MENOR}`, `nc-${N_ESC}`)));
  check("[cob:C:C-013] «Reportados por mí» deja solo la incidencia que reportó Ricardo (sin NC)", mias.ok, mias.v);
  await filtrar(page, "Reportados por mí", "mias=", false);
  await filtrar(page, "Donde soy responsable", "mias=responsable");
  const resp = await hasta(page, y(todas(`nc-${N_MENOR}`, `nc-${N_EDIT}`), ninguna(`incidencia-${I_REP}`)));
  check("[cob:C:C-013] «Donde soy responsable» deja las NC de Ricardo y ninguna incidencia", resp.ok, resp.v);
  await filtrar(page, "Donde soy responsable", "mias=", false);

  await filtrar(page, "Con acciones vencidas", "situacion=vencidas");
  const venc = await hasta(page, y(todas(`nc-${N_VENC}`), ninguna(`nc-${N_MENOR}`, `nc-${N_VER}`, `incidencia-${I_REP}`)));
  const marca = await page.locator(`[data-nc="${N_VENC}"] [data-vencida]`).count();
  check("[cob:C:C-014] «Situación › Con acciones vencidas» deja la NC con la acción vencida (con su marca «1 acción vencida»)", venc.ok && marca === 1, `${venc.v} · marca ${marca}`);
  await filtrar(page, "Con acciones vencidas", "situacion=", false);

  // La dirección vieja ?mias=1 se convierte en la nueva.
  await page.goto(`${BASE_WEB}/calidad/incidencias?mias=1&buscar=${MARCA}`);
  await page.waitForURL(/mias=reportados/);
  const viejo = await hasta(page, y(todas(`incidencia-${I_REP}`), ninguna(`incidencia-${I_LUIS}`)));
  check("[cob:C:C-013] la dirección vieja «mias=1» se reescribe a «mias=reportados» y filtra igual", viejo.ok && /mias=reportados/.test(page.url()), `${page.url()} · ${viejo.v}`);
  await page.goto(`${BASE_WEB}/calidad/incidencias?tipos=incidencia&buscar=${MARCA}`);
  const porUrl = await hasta(page, y(todas(`incidencia-${I_REP}`), ninguna(`nc-${N_MENOR}`)));
  check("[cob:C:C-008] «tipos=incidencia» en la dirección deja solo incidencias", porUrl.ok, porUrl.v);
});

/* =================== Lista: periodo personalizado y orden (C-017…C-019) =================== */
await paso("ricardo", "lista: periodo personalizado y orden", async (page) => {
  await page.goto(LISTA);
  await hasta(page, todas(`incidencia-${I_REP}`, `nc-${N_MENOR}`));
  await page.getByRole("button", { name: /^Filtros/ }).click();
  check("[cob:C:C-017] [cob:C:C-018] «Desde» y «Hasta» solo aparecen con Periodo = Personalizado", (await page.locator("#cal-desde").count()) === 0 && (await page.locator("#cal-hasta").count()) === 0);
  await page.getByRole("switch", { name: "Personalizado", exact: true }).click();
  await page.locator("#cal-desde").waitFor();
  const futura = evento(page.waitForResponse((r) => r.url().includes("/api/calidad/lista") && r.url().includes(`desde=${enDias(2)}`)));
  await page.locator("#cal-desde").fill(enDias(2));
  await futura;
  const vacia = await hasta(page, (v) => v.size === 0);
  await page.getByText("Sin coincidencias").waitFor();
  check("[cob:C:C-017] «Desde» en el futuro: la lista queda vacía («Sin coincidencias»)", vacia.ok, vacia.v);
  const rango = evento(page.waitForResponse((r) => r.url().includes("/api/calidad/lista") && r.url().includes(`desde=${hoy()}`) && r.url().includes(`hasta=${hoy()}`)));
  await page.locator("#cal-desde").fill(hoy());
  await page.locator("#cal-hasta").fill(hoy());
  await rango;
  const deHoy = await hasta(page, todas(`incidencia-${I_REP}`, `nc-${N_MENOR}`));
  check("[cob:C:C-017] [cob:C:C-018] Desde y Hasta = hoy: vuelven los registros de hoy (la consulta lleva desde= y hasta=)", deHoy.ok, deHoy.v);
  await page.keyboard.press("Escape");

  // Orden: el de la pantalla es el mismo que entrega el servidor con orden=antiguos / orden=folio.
  for (const [nombre, orden] of [["Más antiguos", "antiguos"], ["Folio", "folio"]]) {
    const r = evento(page.waitForResponse((x) => x.url().includes("/api/calidad/lista") && x.url().includes(`orden=${orden}`)));
    await interruptor(page, nombre);
    await r;
    const esperado = ((await api("GET", `/calidad/lista?search=${MARCA}&desde=${hoy()}&hasta=${hoy()}&orden=${orden}`, undefined, t.ricardo)).data?.items || []).map((i) => `${i.registro}-${i.id}`).join(" ");
    let enPantalla = "";
    const ok = await esperar(async () => (enPantalla = (await renglones(page)).join(" ")) === esperado);
    check(`[cob:C:C-019] «Ordenar por › ${nombre}» muestra el orden del servidor (orden=${orden})`, !!ok && esperado.split(" ").length >= 6, `pantalla ${enPantalla} · servidor ${esperado}`);
  }
  const reciente = (await api("GET", `/calidad/lista?search=${MARCA}`, undefined, t.ricardo)).data?.items || [];
  const antiguo = (await api("GET", `/calidad/lista?search=${MARCA}&orden=antiguos`, undefined, t.ricardo)).data?.items || [];
  check("[cob:C:C-019] «Más antiguos» es exactamente el inverso de «Más recientes»", reciente.length > 1 && reciente.map((i) => `${i.registro}-${i.id}`).reverse().join(" ") === antiguo.map((i) => `${i.registro}-${i.id}`).join(" "));
});

/* =================== Ventanas de la lista (C-031, C-035, C-036, C-038, C-041) =================== */
await paso("ricardo", "lista: ventanas de incidencia y NC (registros ligados, anterior/siguiente, ficha completa)", async (page) => {
  await page.goto(LISTA);
  await hasta(page, todas(`incidencia-${I_REP}`, `incidencia-${I_ESC}`, `nc-${N_MENOR}`));
  await page.locator(`[data-incidencia="${I_REP}"]`).click();
  const vRep = page.locator(`[data-incidencia-ventana="${I_REP}"]`);
  await vRep.waitFor();
  await vRep.getByText("Registros relacionados").waitFor();
  const enlaces = await vRep.locator("a").evaluateAll((as) => as.map((a) => `${a.getAttribute("href")}|${a.textContent}`));
  check("[cob:C:C-036] la ventana de la incidencia enlaza el equipo ligado", enlaces.some((e) => /equipo/i.test(e.split("|")[0]) && e.includes(EQ_NOMBRE)), enlaces.join(" · "));
  const dialogo = page.getByRole("dialog");
  const siguiente = dialogo.getByRole("button", { name: "Incidencia siguiente" });
  const anterior = dialogo.getByRole("button", { name: "Incidencia anterior" });
  const habilitadas = [await siguiente.isEnabled(), await anterior.isEnabled()];
  const pulsar = (await siguiente.isEnabled()) ? siguiente : anterior;
  await pulsar.click();
  const otra = await esperar(async () => {
    const v = await page.locator("[data-incidencia-ventana]").getAttribute("data-incidencia-ventana").catch(() => null);
    return v && v !== String(I_REP) ? v : null;
  });
  check("[cob:C:C-035] «Incidencia anterior/siguiente» recorre otras incidencias de la lista (no salta a NC)", !!otra && (await renglones(page)).includes(`incidencia-${otra}`), `${habilitadas} → ${otra}`);
  await page.keyboard.press("Escape");
  await dialogo.waitFor({ state: "detached" });

  await page.locator(`[data-incidencia="${I_ESC}"]`).click();
  const vEsc = page.locator(`[data-incidencia-ventana="${I_ESC}"]`);
  await vEsc.waitFor();
  await vEsc.locator(`a[href="/calidad/nc/${N_ESC}"]`).waitFor();
  check("[cob:C:C-036] la ventana de la incidencia escalada enlaza su NC de origen", (await vEsc.locator(`a[href="/calidad/nc/${N_ESC}"]`).count()) === 1);
  await page.getByRole("dialog").getByRole("button", { name: "Abrir ficha completa" }).click();
  await page.waitForURL(new RegExp(`/calidad/incidencias/${I_ESC}$`));
  check("[cob:C:C-031] «Abrir ficha completa» lleva a la ficha de la incidencia", new URL(page.url()).pathname === `/calidad/incidencias/${I_ESC}`, page.url());

  await page.goto(LISTA);
  await hasta(page, todas(`nc-${N_MENOR}`, `nc-${N_EDIT}`));
  await page.locator(`[data-nc="${N_MENOR}"]`).click();
  await page.locator(`[data-nc-ventana="${N_MENOR}"]`).waitFor();
  const ncSig = page.getByRole("dialog").getByRole("button", { name: "NC siguiente" });
  const ncAnt = page.getByRole("dialog").getByRole("button", { name: "NC anterior" });
  await ((await ncSig.isEnabled()) ? ncSig : ncAnt).click();
  const otraNc = await esperar(async () => {
    const v = await page.locator("[data-nc-ventana]").getAttribute("data-nc-ventana").catch(() => null);
    return v && v !== String(N_MENOR) ? v : null;
  });
  check("[cob:C:C-041] «NC anterior/siguiente» recorre otras NC de la lista", !!otraNc && (await renglones(page)).includes(`nc-${otraNc}`), String(otraNc));
  await page.getByRole("dialog").getByRole("button", { name: "Abrir ficha completa" }).click();
  await page.waitForURL(new RegExp(`/calidad/nc/${otraNc}$`));
  check("[cob:C:C-038] «Abrir ficha completa» de la NC lleva a su ficha", new URL(page.url()).pathname === `/calidad/nc/${otraNc}`, page.url());
});

/* =================== Nueva NC (C-004, C-024…C-026) =================== */
await paso("luis", "lista: sin calidad:R ni G no hay «Nueva NC»", async (page) => {
  await page.goto(LISTA);
  await page.getByRole("button", { name: "Reportar incidencia" }).first().waitFor();
  check("[cob:C:C-004] el Técnico Analista ve «Reportar incidencia» pero no «Nueva NC»", (await page.getByRole("button", { name: "Nueva NC" }).count()) === 0);
});

let N_NUEVA = null;
await paso("ricardo", "lista: «Nueva NC» con descripción, requisito y clasificación", async (page) => {
  await page.goto(LISTA);
  await page.getByRole("button", { name: "Nueva NC" }).click();
  const hoja = page.getByRole("dialog", { name: "Nueva no conformidad" });
  await hoja.waitFor();
  let posts = 0;
  page.on("request", (r) => r.method() === "POST" && /\/api\/calidad\/nc$/.test(new URL(r.url()).pathname) && (posts += 1));
  await page.locator("#nc-desc").fill("Muy corta");
  await hoja.getByRole("button", { name: "Abrir NC" }).click();
  await page.getByText("La descripción debe tener al menos 20 caracteres").first().waitFor();
  check("[cob:C:C-004] [cob:C:C-024] descripción de menos de 20 caracteres: aviso en pantalla y no se envía", posts === 0);
  await entendido(page);
  const DESC = `NC ${MARCA} abierta desde la pantalla por una queja`;
  await page.locator("#nc-desc").fill(DESC);
  await page.locator("#nc-req").fill("ISO/IEC 17025 7.9 quejas");
  await page.locator("#nc-clasif").selectOption("mayor");
  await hoja.getByRole("button", { name: "Abrir NC" }).click();
  await page.waitForURL(/\/calidad\/nc\/\d+$/);
  N_NUEVA = Number(new URL(page.url()).pathname.split("/").pop());
  const n = ncRow(N_NUEVA);
  check("[cob:C:C-024] [cob:C:C-025] [cob:C:C-026] [cob:C:C-029] «Abrir NC» guarda descripción, requisito y clasificación y abre la ficha", n?.descripcion === DESC && n?.requisito_incumplido === "ISO/IEC 17025 7.9 quejas" && n?.clasificacion === "mayor" && n?.origen === "queja" && n?.estado === "abierta", JSON.stringify({ d: n?.descripcion, r: n?.requisito_incumplido, c: n?.clasificacion, o: n?.origen }));
});

/* =================== Ficha de la incidencia (C-050, C-053, C-054) =================== */
await paso("ricardo", "ficha de la incidencia: anulada, NC de origen y evaluar", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/incidencias/${I_ANU}`);
  await page.getByText("Incidencia anulada").waitFor();
  check("[cob:C:C-050] la incidencia anulada muestra «Incidencia anulada» y no ofrece evaluar", (await page.getByRole("button", { name: "Evaluar" }).count()) === 0);

  await page.goto(`${BASE_WEB}/calidad/incidencias/${I_ESC}`);
  const abrirNc = page.getByRole("button", { name: /^Abrir NC/ });
  await abrirNc.waitFor();
  await abrirNc.click();
  await page.waitForURL(new RegExp(`/calidad/nc/${N_ESC}$`));
  check("[cob:C:C-053] la incidencia escalada ofrece «Abrir NC …» y lleva a su NC", new URL(page.url()).pathname === `/calidad/nc/${N_ESC}`, page.url());

  await page.goto(`${BASE_WEB}/calidad/incidencias/${I_LUIS}`);
  await page.getByRole("button", { name: "Evaluar" }).click();
  const hoja = page.getByRole("dialog", { name: /^Evaluar/ });
  await hoja.waitFor();
  await hoja.getByRole("radio", { name: /^Escalar a no conformidad/ }).check();
  await page.locator("#eval-req").waitFor();
  const conNc = (await page.locator("#eval-clasif").count()) === 1;
  await hoja.getByRole("radio", { name: /^Cerrar sin NC/ }).check();
  await page.locator("#eval-req").waitFor({ state: "detached" });
  await page.locator("#eval-just").fill("Evento aislado revisado en pantalla");
  await hoja.getByRole("button", { name: "Cerrar sin NC", exact: true }).click();
  await toast(page, /./);
  const inc = await esperar(() => (incRow(I_LUIS)?.estado === "cerrada_sin_nc" ? incRow(I_LUIS) : null));
  check("[cob:C:C-054] «Escalar a no conformidad» pide los datos de la NC; «Cerrar sin NC» los quita y cierra la incidencia con su justificación", conNc && inc?.decision_evaluacion === "cerrar_sin_nc" && inc?.justificacion === "Evento aislado revisado en pantalla", JSON.stringify({ conNc, e: incRow(I_LUIS)?.estado }));
});

/* =================== Reportar incidencia desde un registro (C-066…C-074) =================== */
await paso("ricardo", "«Reportar incidencia» desde el equipo: chips, fecha y hora, acción inmediata, impacto y «Ver»", async (page) => {
  const abrir = async () => {
    await page.goto(`${BASE_WEB}/inventario/equipos`);
    await page.getByPlaceholder("Buscar por nombre, marca o modelo").fill(EQ_NOMBRE);
    const renglon = page.locator(`[data-equipo="${EQ}"]`).first();
    await renglon.waitFor();
    await renglon.getByRole("button", { name: "Acciones" }).click();
    const opcion = page.getByRole("menuitem", { name: /Reportar incidencia/ });
    textoMenu = (await opcion.innerText()).replace(/\s+/g, " ");
    await opcion.click();
    await page.locator("[data-reportar-incidencia]").waitFor();
  };
  let textoMenu = "";
  await abrir();
  const quitar = page.getByRole("button", { name: `Quitar ${EQ_NOMBRE}` });
  await quitar.waitFor();
  check("[cob:C:C-063] el menú «Acciones» del equipo ofrece «Reportar incidencia» («Queda ligada a este registro») y la hoja abre con el equipo ligado", /Queda ligada a este registro/.test(textoMenu) && (await quitar.count()) === 1, textoMenu);
  await quitar.click();
  await quitar.waitFor({ state: "detached" });
  check("[cob:C:C-072] el equipo llega como chip «Quitar …» y se puede quitar antes de reportar", (await page.getByRole("button", { name: /^Quitar / }).count()) === 0);
  await page.getByRole("dialog", { name: "Reportar incidencia" }).getByRole("button", { name: "Cancelar" }).click();
  await page.locator("[data-reportar-incidencia]").waitFor({ state: "detached" });

  await abrir();
  let posts = 0;
  page.on("request", (r) => r.method() === "POST" && /\/api\/calidad\/incidencias$/.test(new URL(r.url()).pathname) && (posts += 1));
  const DESC = `Incidencia ${MARCA} reportada en pantalla desde el equipo`;
  await page.locator("#inc-tipo").selectOption("falla_equipo");
  await page.locator("#inc-fecha").fill(enDias(1));
  await page.locator("#inc-hora").fill("12:00");
  await page.locator("#inc-desc").fill(DESC);
  await page.locator("#inc-accion").fill("Se apagó el equipo y se avisó a la coordinación");
  await page.getByRole("radio", { name: "No se sabe todavía" }).check();
  await page.locator("[data-enviar-incidencia]").click();
  await page.getByText("La fecha y hora de ocurrencia no pueden ser futuras").first().waitFor();
  check("[cob:C:C-066] [cob:C:C-067] fecha de mañana: «no pueden ser futuras» y no se envía", posts === 0);
  await entendido(page);
  await page.locator("#inc-fecha").fill(hoy());
  await page.locator("#inc-hora").fill("00:00");
  await page.locator("[data-enviar-incidencia]").click();
  const aviso = page.locator("[data-sonner-toast]").filter({ hasText: /reportada/ }).last();
  await aviso.waitFor();
  await aviso.getByRole("button", { name: "Ver" }).click();
  await page.waitForURL(/\/calidad\/incidencias\/\d+$/);
  const nueva = Number(new URL(page.url()).pathname.split("/").pop());
  const inc = incRow(nueva);
  const liga = fila("SELECT entidad, entidad_id FROM incidencia_registros WHERE incidencia_id = ?", nueva);
  check("[cob:C:C-074] el aviso «… reportada» tiene «Ver» y lleva a la ficha nueva", inc?.descripcion === DESC, page.url());
  check("[cob:C:C-065] [cob:C:C-066] [cob:C:C-067] [cob:C:C-069] [cob:C:C-070] [cob:C:C-072] [cob:C:C-073] «Reportar» guarda tipo, fecha y hora (hoy 00:00), acción inmediata, impacto «desconocido» y el equipo ligado", inc?.tipo === "falla_equipo" && inc?.accion_inmediata === "Se apagó el equipo y se avisó a la coordinación" && inc?.impacto_resultados === "desconocido" && !!inc?.fecha_hora_ocurrencia && Date.parse(inc.fecha_hora_ocurrencia) < Date.now() && liga?.entidad === "equipos" && Number(liga?.entidad_id) === Number(EQ), JSON.stringify({ t: inc?.tipo, a: inc?.accion_inmediata, i: inc?.impacto_resultados, f: inc?.fecha_hora_ocurrencia, liga }));
});

/* =================== Ficha de la NC: edición completa (C-088…C-133) =================== */
let SU = null;
await paso("ricardo", "ficha de la NC: descripción, impacto, causa, verificación programada y efectos en el SGC", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/nc/${N_EDIT}`);
  await mostrarTodo(page);
  const DESC = `NC ${MARCA} de pantalla editada desde la ficha`;
  await page.locator("#nc-descripcion").fill(DESC);
  await page.locator("#nc-afecta_resultados_emitidos").selectOption("no");
  await page.locator("#nc-trabajo_detenido").selectOption("no");
  await page.locator("#nc-notificar_cliente").selectOption("si");
  await page.locator("#nc-impacto-notas").fill("Impacto acotado al lote de la prueba");
  const metodos = await page.locator("#nc-metodo option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean).join(","));
  await page.locator("#nc-metodo").selectOption("cinco_porques");
  await page.locator("#nc-desarrollo").fill("1. ¿Por qué? Falta de verificación. 2. ¿Por qué? Sin lista de control.");
  await page.locator("#nc-causa").fill("Faltaba una lista de control de la verificación");
  await page.locator("#sec-causa").getByRole("radio", { name: /^Sí/ }).check();
  await page.locator("#nc-verif-prog").fill(enDias(20));
  check("[cob:C:C-132] la nota de riesgos solo aparece con el interruptor encendido", (await page.locator("#nc-nota-riesgos").count()) === 0);
  await page.getByRole("switch", { name: /Actualizar riesgos y oportunidades/ }).click();
  await page.locator("#nc-nota-riesgos").fill("Agregar el riesgo de verificación omitida");
  await page.getByRole("switch", { name: /Requiere cambio documental/ }).click();
  await page.locator("[data-guardar-nc]").first().click();
  await toast(page, /Cambios guardados/);
  const n = await esperar(() => (ncRow(N_EDIT)?.descripcion === DESC ? ncRow(N_EDIT) : null));
  check("[cob:C:C-083] [cob:C:C-088] [cob:C:C-090] [cob:C:C-091] [cob:C:C-092] [cob:C:C-093] «Guardar cambios» guarda la descripción, las tres respuestas del impacto y sus notas", n?.descripcion === DESC && n?.impacto_notas === "Impacto acotado al lote de la prueba" && n?.notificar_cliente === "si" && n?.afecta_resultados_emitidos === "no" && n?.trabajo_detenido === "no", JSON.stringify({ d: n?.descripcion, i: n?.impacto_notas, a: n?.afecta_resultados_emitidos, t: n?.trabajo_detenido, c: n?.notificar_cliente }));
  check("[cob:C:C-111] [cob:C:C-112] [cob:C:C-113] [cob:C:C-114] método (5 porqués/Ishikawa/otro), desarrollo, causa raíz y «requiere acción: Sí» se guardan", metodos === "cinco_porques,ishikawa,otro" && n?.metodo_causa === "cinco_porques" && /Falta de verificación/.test(n?.desarrollo_causa || "") && n?.causa_raiz === "Faltaba una lista de control de la verificación" && n?.requiere_accion_correctiva === "si", JSON.stringify({ metodos, m: n?.metodo_causa, r: n?.requiere_accion_correctiva }));
  check("[cob:C:C-126] [cob:C:C-131] [cob:C:C-132] [cob:C:C-133] verificación programada, riesgos (bandera y nota) y cambio documental se guardan", n?.verificacion_programada === enDias(20) && Number(n?.requiere_actualizar_riesgos) === 1 && n?.nota_riesgos === "Agregar el riesgo de verificación omitida" && Number(n?.requiere_cambio_documental) === 1, JSON.stringify({ v: n?.verificacion_programada, r: n?.requiere_actualizar_riesgos, nr: n?.nota_riesgos, c: n?.requiere_cambio_documental }));
});

await paso("ricardo", "ficha de la NC: informe afectado, suspensión del equipo, comunicación y acción correctiva", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/nc/${N_EDIT}`);
  await mostrarTodo(page);
  // Informe afectado.
  await page.getByLabel("Buscar informe afectado").fill(`CUI${s5}`);
  const opcion = page.locator("#sec-impacto li button").filter({ hasText: `CUI${s5}` }).first();
  await opcion.waitFor();
  await opcion.click();
  const afectado = page.locator(`[data-afectado="${INF.informe}"]`);
  await afectado.waitFor();
  check("[cob:C:C-094] [cob:C:C-097] el informe elegido en «Buscar informe afectado» aparece como afectado y se guarda en la NC", !!fila("SELECT id FROM nc_registros_afectados WHERE nc_id = ? AND entidad_id = ?", N_EDIT, INF.informe), (await afectado.innerText()).replace(/\s+/g, " "));

  // Suspensión del equipo propio.
  const metodos = await page.locator("#nc-susp-clave option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean).join(","));
  await page.locator("#nc-susp-tipo").selectOption("equipo");
  await page.locator(`#nc-susp-clave option[value="${EQ}"]`).waitFor({ state: "attached" });
  await page.locator("#nc-susp-clave").selectOption(String(EQ));
  await page.getByRole("button", { name: "Suspender…" }).click();
  await dialogoMotivo(page, "Equipo con resultados en duda en la prueba", "Confirmar");
  SU = await esperar(() => fila("SELECT id FROM suspensiones WHERE nc_id = ? AND reanudada_en IS NULL", N_EDIT)?.id);
  const su = page.locator(`[data-suspension="${SU}"]`);
  await su.waitFor();
  check("[cob:C:C-101] [cob:C:C-102] «Suspender»: método (ASP, DSP, PSP, pigmentos, plancton, otro) o equipo de la lista", metodos === "ASP,DSP,PSP,pigmentos,plancton,otro", metodos);
  check("[cob:C:C-098] [cob:C:C-103] «Suspender…» con motivo: la suspensión del equipo aparece en la NC («Suspendido», sin «Reanudar…» para quien no tiene calidad:A) y el equipo deja de estar operativo", /Equipo/.test(await su.innerText()) && (await su.getByRole("button", { name: /Reanudar/ }).count()) === 0 && /Suspendido/.test(await su.innerText()) && fila("SELECT estado FROM equipos WHERE id = ?", EQ)?.estado !== "operativo", (await su.innerText()).replace(/\s+/g, " "));

  // Comunicación con el cliente.
  await page.getByRole("button", { name: "Registrar comunicación" }).click();
  const hoja = page.getByRole("dialog", { name: "Comunicación con el cliente" });
  await hoja.waitFor();
  let posts = 0;
  page.on("request", (r) => r.method() === "POST" && /\/comunicaciones$/.test(new URL(r.url()).pathname) && (posts += 1));
  const fechaInicial = await page.locator("#com-fecha").inputValue();
  await page.locator("#com-contacto").fill("ab");
  await page.locator("#com-resumen").fill("corto");
  await hoja.getByRole("button", { name: "Registrar", exact: true }).click();
  await page.getByText("El resumen debe tener al menos 10 caracteres").first().waitFor();
  check("[cob:C:C-104] [cob:C:C-105] [cob:C:C-107] [cob:C:C-108] la hoja abre con la fecha de hoy; contacto < 3 y resumen < 10 se avisan y no se envía", posts === 0 && fechaInicial.length === 10, fechaInicial);
  await entendido(page);
  await page.locator("#com-medio").selectOption("telefono");
  await page.locator("#com-contacto").fill("Lic. Cliente de prueba, jefa de calidad");
  await page.locator("#com-resumen").fill("Se informó del informe afectado y aceptó esperar la revisión");
  const casilla = hoja.getByRole("checkbox", { name: /^IR/ });
  const casillas = await casilla.count();
  await casilla.first().check();
  await hoja.getByRole("button", { name: "Registrar", exact: true }).click();
  await hoja.waitFor({ state: "detached" });
  const com = await esperar(() => fila("SELECT * FROM nc_comunicaciones WHERE nc_id = ?", N_EDIT));
  check("[cob:C:C-106] [cob:C:C-108] [cob:C:C-109] [cob:C:C-110] «Registrar»: la comunicación se guarda con medio, contacto, resumen y el informe afectado marcado", casillas === 1 && com?.medio === "telefono" && com?.contacto === "Lic. Cliente de prueba, jefa de calidad" && com?.fecha === hoy() && JSON.parse(com?.informe_ids_json || "[]").map(Number).includes(Number(INF.informe)), JSON.stringify({ casillas, com }));

  // Acción correctiva (la NC pasa a análisis).
  await page.locator("[data-avanzar-nc]").first().click();
  await esperar(() => ncRow(N_EDIT)?.estado === "en_analisis");
  await page.locator("#acc-desc").waitFor();
  let postsAcc = 0;
  page.on("request", (r) => r.method() === "POST" && /\/acciones$/.test(new URL(r.url()).pathname) && (postsAcc += 1));
  await page.locator("#acc-desc").fill("Corta");
  await page.locator("[data-agregar-accion]").click();
  await page.getByText("La descripción debe tener al menos 10 caracteres").first().waitFor();
  check("[cob:C:C-122] [cob:C:C-124] acción de menos de 10 caracteres y sin fecha compromiso: aviso y no se envía", postsAcc === 0 && ncRow(N_EDIT)?.estado === "en_analisis");
  await entendido(page);
  await page.locator("#acc-desc").fill("Crear la lista de control de verificación");
  await page.locator("#acc-resp").selectOption(String(id.luis));
  await page.locator("#acc-fecha").fill(enDias(10));
  await page.locator("[data-agregar-accion]").click();
  await toast(page, /Acción agregada/);
  const acc = fila("SELECT * FROM acciones_correctivas WHERE nc_id = ? ORDER BY id DESC LIMIT 1", N_EDIT);
  check("[cob:C:C-122] [cob:C:C-123] [cob:C:C-124] [cob:C:C-125] «Agregar acción» guarda descripción, responsable y fecha compromiso", acc?.descripcion === "Crear la lista de control de verificación" && Number(acc?.responsable_id) === Number(id.luis) && acc?.fecha_compromiso === enDias(10), JSON.stringify(acc));
});

await paso("ricardo", "ficha de la NC: «No requiere acción correctiva» exige la justificación", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/nc/${N_SIN}`);
  await mostrarTodo(page);
  check("[cob:C:C-115] la justificación solo aparece al elegir «No»", (await page.locator("#nc-justificacion").count()) === 0);
  await page.locator("#sec-causa").getByRole("radio", { name: /^No\b/ }).check();
  await page.locator("#nc-justificacion").waitFor();
  let puts = 0;
  page.on("request", (r) => r.method() === "PUT" && new URL(r.url()).pathname === `/api/calidad/nc/${N_SIN}` && (puts += 1));
  await page.locator("[data-guardar-nc]").first().click();
  await page.getByText(/por qué no requiere acción correctiva/).first().waitFor();
  check("[cob:C:C-114] [cob:C:C-115] «No» sin justificación: aviso y no se guarda", puts === 0 && !ncRow(N_SIN)?.requiere_accion_correctiva);
  await entendido(page);
  await page.locator("#nc-justificacion").fill("Hecho aislado: el proveedor ya cambió el empaque");
  await page.locator("[data-guardar-nc]").first().click();
  await toast(page, /Cambios guardados/);
  const n = await esperar(() => (ncRow(N_SIN)?.requiere_accion_correctiva === "no" ? ncRow(N_SIN) : null));
  check("[cob:C:C-114] [cob:C:C-115] con la justificación se guarda «no requiere acción correctiva»", n?.justificacion_sin_accion === "Hecho aislado: el proveedor ya cambió el empaque", JSON.stringify({ r: n?.requiere_accion_correctiva, j: n?.justificacion_sin_accion }));
});

await paso("ana", "ficha de la NC: verificar la eficacia", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/nc/${N_VER}`);
  await mostrarTodo(page);
  await page.locator("#verif-com").waitFor();
  let posts = 0;
  page.on("request", (r) => r.method() === "POST" && /\/verificar$/.test(new URL(r.url()).pathname) && (posts += 1));
  await page.getByRole("radio", { name: /^Eficaz/ }).check();
  await page.locator("#verif-com").fill("Corto");
  await page.locator("[data-verificar]").click();
  await page.getByText("La descripción de cómo se verificó debe tener al menos 10 caracteres").first().waitFor();
  check("[cob:C:C-128] comentarios de menos de 10 caracteres: aviso y no se envía", posts === 0);
  await entendido(page);
  await page.locator("#verif-com").fill("Se revisaron los registros de la acción implementada");
  await page.locator("[data-verificar]").click();
  const v = await esperar(() => fila("SELECT * FROM nc_verificaciones WHERE nc_id = ? ORDER BY id DESC LIMIT 1", N_VER));
  check("[cob:C:C-127] [cob:C:C-128] [cob:C:C-129] «Registrar verificación» guarda el resultado eficaz y cómo se verificó", v?.resultado === "eficaz" && v?.comentarios === "Se revisaron los registros de la acción implementada", JSON.stringify(v));
});

/* =================== Acceso y alcance (C-001, C-020, C-043, C-077, C-139) =================== */
await paso("jorge", "acceso: sin calidad:V de incidencias no hay lista; la Auditoría sí abre", async (page) => {
  let pedidas = 0;
  page.on("request", (r) => r.url().includes("/api/calidad/lista") && (pedidas += 1));
  await page.goto(LISTA);
  await page.getByText("Sin acceso a esta sección").waitFor();
  check("[cob:C:C-001] el Administrador técnico (calidad:V solo «bitácora») ve «Sin acceso a esta sección» y no se pide la lista", pedidas === 0 && (await page.locator("[data-incidencia],[data-nc]").count()) === 0, `peticiones ${pedidas}`);
  const audit = evento(page.waitForResponse((r) => r.url().includes("/api/audit?")));
  await page.goto(`${BASE_WEB}/auditoria`);
  const r = await audit;
  await page.getByRole("heading", { name: "Auditoría" }).waitFor();
  check("[cob:C:C-139] con calidad:V «bitácora» la Auditoría abre y pide la actividad", r.status() === 200 && (await page.getByText("Sin acceso a esta sección").count()) === 0, String(r.status()));
});

await paso("luis", "alcance «incidencias»: solo lo propio en la lista; lo ajeno no abre; sin Auditoría", async (page) => {
  await page.goto(LISTA);
  const vis = await hasta(page, y(todas(`incidencia-${I_LUIS}`, `nc-${N_VER}`, `nc-${N_ACC}`), ninguna(`incidencia-${I_REP}`, `nc-${N_MENOR}`, `nc-${N_UI}`, `nc-${N_SIN}`)));
  check("[cob:C:C-020] el Técnico Analista ve sus incidencias y las NC donde es responsable de una acción; no las incidencias de otros ni las NC ajenas", vis.ok, vis.v);
  await page.goto(`${BASE_WEB}/calidad/incidencias/${I_REP}`);
  await sinAcceso(page);
  check("[cob:C:C-043] la ficha de una incidencia ajena no se abre (404) y no muestra sus datos", (await page.locator("[data-evaluar]").count()) === 0 && (await page.getByText(`Incidencia ${MARCA} de Ricardo con su equipo`).count()) === 0);
  await page.goto(`${BASE_WEB}/calidad/nc/${N_MENOR}`);
  await sinAcceso(page);
  check("[cob:C:C-077] la ficha de una NC que no le toca no se abre (404)", (await page.locator("[data-etapa]").count()) === 0);
  let audit = 0;
  page.on("request", (r) => r.url().includes("/api/audit?") && (audit += 1));
  await page.goto(`${BASE_WEB}/auditoria`);
  await page.getByText("Sin acceso a esta sección").waitFor();
  check("[cob:C:C-139] con calidad:C «incidencias» (sin V) la Auditoría muestra «Sin acceso a esta sección» y no pide la bitácora", audit === 0);
});

/* =================== Lista: búsqueda, anuladas, periodo, vacío y error, hojas (C-005…C-028) =================== */
await paso("ricardo", "lista: búsqueda, anuladas, periodo, vacío y error, renglones y hojas", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/incidencias`);
  await page.getByRole("heading", { name: "Incidencias y no conformidades" }).waitFor();
  const buscador = page.getByPlaceholder("Buscar por folio, descripción, persona o requisito");
  const conBusqueda = evento(page.waitForResponse((r) => r.url().includes("/api/calidad/lista") && r.url().includes(`search=${MARCA}`)));
  await buscador.fill(MARCA);
  await conBusqueda;
  const servidor = ((await api("GET", `/calidad/lista?search=${MARCA}`, undefined, t.ricardo)).data?.items || []).map((i) => `${i.registro}-${i.id}`);
  const busq = await hasta(page, (v) => v.size === servidor.length && servidor.every((x) => v.has(x)));
  check("[cob:C:C-001] [cob:C:C-006] con calidad:V la lista abre; lo escrito en el buscador va como search= y deja lo mismo que el servidor", busq.ok && servidor.length >= 10, `${servidor.length} · ${busq.v.split(" ").length}`);
  const porDireccion = evento(page.waitForResponse((r) => r.url().includes("/api/calidad/lista") && r.url().includes(`search=${MARCA}`)));
  await page.goto(LISTA);
  await porDireccion;
  const dir = await hasta(page, (v) => v.size === servidor.length && servidor.every((x) => v.has(x)));
  check("[cob:C:C-006] «?buscar=» de la dirección llena el buscador y filtra igual (escribir en el buscador no reescribe la dirección)", dir.ok && (await buscador.inputValue()) === MARCA, dir.v.split(" ").length);
  const renglon = (await page.locator(`[data-incidencia="${I_REP}"]`).innerText()).replace(/\s+/g, " ");
  check("[cob:C:C-020] el renglón muestra el folio, la descripción y el estado", renglon.includes(folio("INC", incRow(I_REP)?.folio_num)) && renglon.includes(`Incidencia ${MARCA} de Ricardo con su equipo`) && /Reportada/.test(renglon), renglon);

  check("(lista) sin «Mostrar anuladas» la incidencia anulada no aparece", !(await renglones(page)).includes(`incidencia-${I_ANU}`));
  await filtrar(page, "Mostrar anuladas", "anuladas=1");
  const anu = await hasta(page, todas(`incidencia-${I_ANU}`));
  const marcaAnu = await page.locator(`[data-incidencia="${I_ANU}"]`).getAttribute("data-anulada");
  const marcaViva = await page.locator(`[data-incidencia="${I_REP}"]`).getAttribute("data-anulada");
  check("[cob:C:C-015] [cob:C:C-020] «Mostrar anuladas» pide anuladas=1 y agrega la anulada con data-anulada=1 (las vigentes, 0)", anu.ok && marcaAnu === "1" && marcaViva === "0", `${anu.v} · ${marcaAnu} ${marcaViva}`);
  await filtrar(page, "Mostrar anuladas", "anuladas=1", false);

  await page.getByRole("button", { name: /^Filtros/ }).click();
  const faltan = [];
  for (const o of ["Hoy", "Últimos 7 días", "Últimos 30 días", "Todo", "Personalizado"]) if ((await page.getByRole("switch", { name: o, exact: true }).count()) !== 1) faltan.push(o);
  const deHoy = evento(page.waitForResponse((r) => r.url().includes("/api/calidad/lista") && r.url().includes(`desde=${hoy()}`) && r.url().includes(`hasta=${hoy()}`)));
  await page.getByRole("switch", { name: "Hoy", exact: true }).click();
  await deHoy;
  await page.keyboard.press("Escape");
  const hoyV = await hasta(page, todas(`incidencia-${I_REP}`, `nc-${N_MENOR}`));
  check("[cob:C:C-016] «Periodo» ofrece Hoy, 7 y 30 días, Todo y Personalizado; «Hoy» pide desde=hoy&hasta=hoy y deja lo de hoy", !faltan.length && hoyV.ok, `faltan ${faltan.join(", ")} · ${hoyV.v}`);

  await page.goto(`${BASE_WEB}/calidad/incidencias?buscar=sin-coincidencia-${MARCA}`);
  await page.getByText("Sin coincidencias").waitFor();
  check("[cob:C:C-022] una búsqueda sin resultados muestra el estado vacío «Sin coincidencias»", (await renglones(page)).length === 0);
  // Falla de red simulada (route.abort, nunca un 500): la lista muestra el error con «Reintentar».
  await page.route("**/api/calidad/lista**", (r) => r.abort());
  await page.goto(LISTA);
  const reintentar = page.getByRole("button", { name: "Reintentar" });
  await reintentar.waitFor();
  const sinFilas = (await renglones(page)).length;
  await page.unroute("**/api/calidad/lista**");
  await reintentar.click();
  const tras = await hasta(page, todas(`incidencia-${I_REP}`));
  check("[cob:C:C-022] si la lista falla aparece el error con «Reintentar» y al pulsarlo vuelve a cargar", sinFilas === 0 && tras.ok, tras.v);

  await page.getByRole("button", { name: "Reportar incidencia" }).first().click();
  const hojaR = page.locator("[data-reportar-incidencia]");
  await hojaR.waitFor();
  check("[cob:C:C-005] [cob:C:C-064] «Reportar incidencia» de la lista abre la hoja, sin registros ligados", (await page.getByRole("button", { name: /^Quitar / }).count()) === 0 && (await page.locator("#inc-tipo").count()) === 1);
  await page.getByRole("dialog", { name: "Reportar incidencia" }).getByRole("button", { name: "Cancelar" }).click();
  await hojaR.waitFor({ state: "detached" });

  await page.getByRole("button", { name: "Nueva NC" }).click();
  const hoja = page.getByRole("dialog", { name: "Nueva no conformidad" });
  await hoja.waitFor();
  const origenes = await page.locator("#nc-origen option").evaluateAll((os) => os.map((o) => o.value));
  const origen = await page.locator("#nc-origen").inputValue();
  check("[cob:C:C-023] «Origen» ofrece queja, auditoría interna, revisión y otro (sin «incidencia») y empieza en «queja»", !origenes.includes("incidencia") && ["queja", "auditoria_interna", "revision", "otro"].every((o) => origenes.includes(o)) && origen === "queja", `${origenes} · ${origen}`);
  check("[cob:C:C-027] sin calidad:G (Coordinación Técnica) la hoja no ofrece «Responsable»", (await page.locator("#nc-resp").count()) === 0);
  const posts = contar(page, "POST", /^\/api\/calidad\/nc$/);
  const DESC = `NC ${MARCA} que se descarta con Cancelar`;
  await page.locator("#nc-desc").fill(DESC);
  await hoja.getByRole("button", { name: "Cancelar" }).click();
  await hoja.waitFor({ state: "detached" });
  check("[cob:C:C-028] «Cancelar» cierra la hoja sin crear la NC", posts.n === 0 && !fila("SELECT id FROM no_conformidades WHERE descripcion = ?", DESC));
});

await paso("ana", "lista: «Nueva NC» de Mejora Continua con origen y responsable", async (page) => {
  await page.goto(LISTA);
  await page.getByRole("button", { name: "Nueva NC" }).click();
  const hoja = page.getByRole("dialog", { name: "Nueva no conformidad" });
  await hoja.waitFor();
  await page.locator(`#nc-resp option[value="${id.gabriela}"]`).waitFor({ state: "attached" });
  const DESC = `NC ${MARCA} abierta por Mejora Continua con responsable`;
  await page.locator("#nc-origen").selectOption("auditoria_interna");
  await page.locator("#nc-desc").fill(DESC);
  await page.locator("#nc-resp").selectOption(String(id.gabriela));
  await hoja.getByRole("button", { name: "Abrir NC" }).click();
  await page.waitForURL(/\/calidad\/nc\/\d+$/);
  const n = ncRow(Number(new URL(page.url()).pathname.split("/").pop()));
  check("[cob:C:C-023] [cob:C:C-027] [cob:C:C-029] con calidad:G se eligen origen y responsable; «Abrir NC» la crea y abre su ficha", n?.descripcion === DESC && Number(n?.responsable_id) === Number(id.gabriela) && n?.origen === "auditoria_interna", JSON.stringify({ r: n?.responsable_id, o: n?.origen }));
});

/* =================== Ventana y ficha de la incidencia (C-030…C-062) =================== */
await paso("ricardo", "ventana de la incidencia: folio y estado, «Iniciar evaluación» y el aviso de segregación", async (page) => {
  await page.goto(LISTA);
  await hasta(page, todas(`incidencia-${I_EV1}`, `incidencia-${I_REP}`));
  await page.locator(`[data-incidencia="${I_EV1}"]`).click();
  const v = page.locator(`[data-incidencia-ventana="${I_EV1}"]`);
  await v.waitFor();
  const texto = (await v.innerText()).replace(/\s+/g, " ");
  check("[cob:C:C-030] la ventana de la incidencia muestra su folio y el estado «Reportada»", texto.includes(folio("INC", incRow(I_EV1)?.folio_num)) && /Reportada/.test(texto), texto.slice(0, 160));
  const dialogo = page.getByRole("dialog");
  await dialogo.getByRole("button", { name: "Iniciar evaluación" }).click();
  await toast(page, /Evaluación iniciada/);
  await dialogo.getByRole("button", { name: "Iniciar evaluación" }).waitFor({ state: "detached" });
  const inc = incRow(I_EV1);
  check("[cob:C:C-032] «Iniciar evaluación» de la ventana la pasa a «En evaluación» (con quién) y el botón desaparece", inc?.estado === "en_evaluacion" && Number(inc?.en_evaluacion_por) === Number(id.ricardo), JSON.stringify({ e: inc?.estado, p: inc?.en_evaluacion_por }));
  await page.keyboard.press("Escape");
  await dialogo.waitFor({ state: "detached" });
  await page.locator(`[data-incidencia="${I_REP}"]`).click();
  await page.locator(`[data-incidencia-ventana="${I_REP}"]`).waitFor();
  await page.getByRole("dialog").getByText("Otra persona debe evaluarla").waitFor();
  check("[cob:C:C-032] en la incidencia que reportó, Ricardo ve «Otra persona debe evaluarla» y no «Iniciar evaluación»", (await page.getByRole("dialog").getByRole("button", { name: "Iniciar evaluación" }).count()) === 0);
});

await paso("ricardo", "ficha de la incidencia: encabezado, regreso, iniciar evaluación y escalar a una NC abierta", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/incidencias/${I_EV2}`);
  const atras = page.getByRole("main").getByRole("link", { name: "Incidencias y NC" }).first();
  await atras.waitFor();
  await page.locator("[data-evaluar]").waitFor();
  const cuerpo = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  const titulo = (await page.locator("h1").allInnerTexts()).join(" | ");
  check("[cob:C:C-043] la ficha muestra el folio, el tipo («Otro») y el estado «Reportada»", cuerpo.includes(folio("INC", incRow(I_EV2)?.folio_num)) && /Reportada/.test(cuerpo) && /\bOtro\b/.test(titulo), titulo);
  await atras.click();
  await page.waitForURL((u) => u.pathname === "/calidad/incidencias");
  check("[cob:C:C-044] «Incidencias y NC» regresa a la lista", new URL(page.url()).pathname === "/calidad/incidencias");
  await page.goto(`${BASE_WEB}/calidad/incidencias/${I_EV2}`);
  await page.getByRole("button", { name: "Iniciar evaluación" }).click();
  await toast(page, /Evaluación iniciada/);
  await page.getByRole("button", { name: "Iniciar evaluación" }).waitFor({ state: "detached" });
  await page.locator("[data-evaluar]").waitFor();
  check("[cob:C:C-045] [cob:C:C-046] «Iniciar evaluación» la pasa a «En evaluación» y «Evaluar» sigue disponible", incRow(I_EV2)?.estado === "en_evaluacion", incRow(I_EV2)?.estado);

  await page.locator("[data-evaluar]").click();
  const hoja = page.getByRole("dialog", { name: /^Evaluar/ });
  await hoja.waitFor();
  check("[cob:C:C-060] sin calidad:G, «NC nueva» pide requisito y clasificación pero no ofrece «Responsable»", (await page.locator("#eval-req").count()) === 1 && (await page.locator("#eval-resp").count()) === 0);
  const posts = contar(page, "POST", /\/evaluar$/);
  await page.locator("#eval-just").fill("Corta");
  await page.locator("[data-guardar-evaluacion]").click();
  await page.getByText("La justificación debe tener al menos 10 caracteres").first().waitFor();
  check("[cob:C:C-055] justificación de menos de 10 caracteres: aviso y no se envía", posts.n === 0 && incRow(I_EV2)?.estado === "en_evaluacion");
  await entendido(page);
  const abiertas = evento(page.waitForRequest((r) => r.url().includes("/api/calidad/nc?estado=abiertas")));
  await hoja.getByRole("radio", { name: /^Agregar a una NC abierta/ }).check();
  await abiertas;
  await page.locator(`#eval-nc option[value="${N_MENOR}"]`).waitFor({ state: "attached" });
  const otraAbierta = await page.locator(`#eval-nc option[value="${N_AN}"]`).count();
  check("[cob:C:C-056] [cob:C:C-057] «Agregar a una NC abierta» cambia los campos de NC nueva por la lista de NC abiertas (estado=abiertas)", (await page.locator("#eval-req").count()) === 0 && otraAbierta === 1);
  await page.locator("#eval-nc").selectOption(String(N_MENOR));
  await page.locator("#eval-just").fill("Es el mismo problema que la NC menor abierta");
  await hoja.getByRole("button", { name: "Escalar a NC" }).click();
  await page.waitForURL(new RegExp(`/calidad/nc/${N_MENOR}$`));
  const inc = incRow(I_EV2);
  check("[cob:C:C-057] [cob:C:C-061] «Escalar a NC» con una NC abierta liga la incidencia a esa NC y abre su ficha", inc?.estado === "escalada_a_nc" && Number(inc?.nc_id) === Number(N_MENOR) && inc?.decision_evaluacion === "escalar", JSON.stringify({ e: inc?.estado, nc: inc?.nc_id }));
});

await paso("ana", "ficha de la incidencia: Mejora Continua la escala a una NC nueva con requisito, clasificación y responsable", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/incidencias/${I_EV3}`);
  await page.locator("[data-evaluar]").click();
  const hoja = page.getByRole("dialog", { name: /^Evaluar/ });
  await hoja.waitFor();
  await page.locator(`#eval-resp option[value="${id.ricardo}"]`).waitFor({ state: "attached" });
  await page.locator("#eval-just").fill("Requiere análisis de causa como no conformidad");
  await page.locator("#eval-req").fill("ISO/IEC 17025 7.10.1");
  await page.locator("#eval-clasif").selectOption("critica");
  await page.locator("#eval-resp").selectOption(String(id.ricardo));
  await hoja.getByRole("button", { name: "Escalar a NC" }).click();
  await page.waitForURL(/\/calidad\/nc\/\d+$/);
  const nueva = Number(new URL(page.url()).pathname.split("/").pop());
  const n = ncRow(nueva);
  check("[cob:C:C-058] [cob:C:C-059] [cob:C:C-060] [cob:C:C-061] la NC nueva lleva el requisito, la clasificación y el responsable elegidos y nace de la incidencia", n?.requisito_incumplido === "ISO/IEC 17025 7.10.1" && n?.clasificacion === "critica" && Number(n?.responsable_id) === Number(id.ricardo) && Number(incRow(I_EV3)?.nc_id) === nueva && incRow(I_EV3)?.estado === "escalada_a_nc", JSON.stringify({ r: n?.requisito_incumplido, c: n?.clasificacion, resp: n?.responsable_id, o: n?.origen }));
});

await paso("luis", "ficha de la incidencia: adjuntar una foto y descargarla", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/incidencias/${I_ADJ}`);
  const panel = page.locator("[data-evidencia]");
  const adjuntar = panel.getByRole("button", { name: "Adjuntar", exact: true });
  await adjuntar.waitFor();
  const posts = contar(page, "POST", /\/adjuntos$/);
  await adjuntar.click();
  await page.getByText("Elige el archivo de la evidencia").first().waitFor();
  check("[cob:C:C-051] «Adjuntar» sin archivo ni descripción: aviso y no se envía", posts.n === 0);
  await entendido(page);
  await page.locator(`#evidencia-archivo-${I_ADJ}`).setInputFiles({ name: "foto-incidencia.png", mimeType: "image/png", buffer: PNG });
  await page.locator(`#evidencia-desc-${I_ADJ}`).fill("Foto del empaque dañado");
  await adjuntar.click();
  const adj = await esperar(() => fila("SELECT * FROM adjuntos WHERE entidad = 'incidencia' AND entidad_id = ? AND anulado_en IS NULL ORDER BY id DESC LIMIT 1", I_ADJ));
  const renglon = panel.locator(`[data-adjunto="${adj?.id}"]`);
  await renglon.waitFor();
  check("[cob:C:C-051] quien reportó adjunta la foto: queda con su descripción, tipo «foto» y SHA-256", adj?.descripcion === "Foto del empaque dañado" && adj?.tipo_evidencia === "foto" && /^[0-9a-f]{64}$/.test(adj?.sha256 || ""), JSON.stringify(adj));
  const descarga = evento(page.waitForEvent("download"));
  await renglon.getByRole("button", { name: "Descargar" }).click();
  const d = await descarga;
  check("[cob:C:C-052] el adjunto aparece en la lista y «Descargar» entrega el archivo con su nombre", d.suggestedFilename() === "foto-incidencia.png", d.suggestedFilename());
});

let S5 = null;
await paso("ricardo", "ficha de la incidencia propia: separación de funciones y «Solicitar excepción…»", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/incidencias/${I_REP}`);
  const boton = page.getByRole("button", { name: /^Solicitar excepción para evaluar/ });
  await boton.waitFor();
  check("[cob:C:C-049] [cob:C:C-046] en la incidencia que reportó, Ricardo ve «Separación de funciones» y no «Evaluar»", (await page.locator("[data-evaluar]").count()) === 0 && (await page.getByText("Separación de funciones").count()) > 0);
  await boton.click();
  await dialogoMotivo(page, `Excepción ${MARCA}: no hay otra persona para evaluar`, "Solicitar excepción", PW("ricardo"));
  S5 = await esperar(() => solPendiente("incidencias", I_REP, "excepcion_segregacion"));
  const s = S5 ? solRow(S5) : null;
  check("[cob:C:C-049] «Solicitar excepción…» crea la solicitud de excepción para evaluar, pendiente y con su motivo", !!s && accionDe(s) === "evaluar" && Number(s.solicitado_por) === Number(id.ricardo) && /no hay otra persona/.test(s.motivo), JSON.stringify(s));
});

let S1 = null;
let S2 = null;
await paso("patricia", "incidencias: «Anular…» en la ventana y en la ficha, aviso pendiente, cancelar desde el aviso e historial", async (page) => {
  await page.goto(LISTA);
  await hasta(page, todas(`incidencia-${I_AN1}`));
  await page.locator(`[data-incidencia="${I_AN1}"]`).click();
  await page.locator(`[data-incidencia-ventana="${I_AN1}"]`).waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Anular…" }).click();
  await dialogoMotivo(page, `Anulación ${MARCA} que se rechazará`, "Solicitar anulación", PW("patricia"));
  S1 = await esperar(() => solPendiente("incidencias", I_AN1, "anular_calidad"));
  const banner = page.getByRole("dialog").locator("[data-banner-solicitud]");
  await banner.waitFor();
  check("[cob:C:C-033] [cob:C:C-034] «Anular…» de la ventana crea la solicitud (la incidencia sigue vigente) y la ventana muestra «… · pendiente de autorización» sin «Anular…»", !!S1 && incRow(I_AN1)?.estado !== "anulada" && /pendiente de autorización/.test(await banner.innerText()) && (await page.getByRole("dialog").getByRole("button", { name: "Anular…" }).count()) === 0, String(S1));

  await page.goto(`${BASE_WEB}/calidad/incidencias/${I_AN2}`);
  await page.getByRole("button", { name: "Anular…" }).click();
  const posts = contar(page, "POST", /\/anular$/);
  await page.locator("#prompt-motivo").fill("abc");
  await page.getByRole("dialog").getByRole("button", { name: "Solicitar anulación", exact: true }).click();
  await page.getByText("Motivo debe tener al menos 5 caracteres").first().waitFor();
  check("[cob:C:C-047] motivo de menos de 5 caracteres: aviso y no se envía", posts.n === 0);
  await entendido(page);
  await page.locator("#prompt-motivo").fill(`Anulación ${MARCA} que se cancelará`);
  if (await page.locator("#prompt-password").count()) await page.locator("#prompt-password").fill(PW("patricia"));
  await page.getByRole("dialog").getByRole("button", { name: "Solicitar anulación", exact: true }).click();
  const aviso = page.locator("[data-banner-solicitud]");
  await aviso.waitFor();
  S2 = solPendiente("incidencias", I_AN2, "anular_calidad");
  const detalle = (await aviso.locator("[data-solicitud-detalle]").innerText()).replace(/\s+/g, " ");
  check("[cob:C:C-047] [cob:C:C-048] [cob:C:C-178] la ficha muestra el aviso con qué se pidió, quién y el motivo; a quien la pidió solo «Cancelar solicitud»", !!S2 && detalle.includes(`Anulación ${MARCA} que se cancelará`) && /Patricia/.test(detalle) && (await aviso.getByRole("button", { name: "Cancelar solicitud" }).count()) === 1 && (await aviso.getByRole("button", { name: "Aprobar" }).count()) === 0 && (await page.getByRole("button", { name: "Anular…" }).count()) === 0, detalle);
  await aviso.getByRole("button", { name: "Cancelar solicitud" }).click();
  const confirmar = page.getByRole("dialog", { name: "Cancelar la solicitud" });
  await confirmar.waitFor();
  await confirmar.getByRole("button", { name: "Volver" }).click();
  await confirmar.waitFor({ state: "detached" });
  check("[cob:C:C-177] «Volver» en la confirmación no cancela la solicitud", solRow(S2)?.estado === "pendiente");
  await aviso.getByRole("button", { name: "Cancelar solicitud" }).click();
  await confirmar.getByRole("button", { name: "Cancelar solicitud" }).click();
  await aviso.waitFor({ state: "detached" });
  check("[cob:C:C-177] [cob:C:C-178] «Cancelar solicitud» la cancela tras confirmar; el aviso se va y la incidencia sigue vigente", solRow(S2)?.estado === "cancelada" && incRow(I_AN2)?.estado === "reportada", `${solRow(S2)?.estado} ${incRow(I_AN2)?.estado}`);

  await page.reload();
  const historial = page.locator("[data-historial-bitacora]");
  await page.locator('[data-historial-solicitudes] [data-solicitud-estado="cancelada"]').waitFor();
  const desplegar = historial.getByRole("button", { name: /^Actividad/ });
  await desplegar.click();
  await historial.locator("[data-actividad]").first().waitFor();
  check("[cob:C:C-062] el historial lista la solicitud cancelada y «Actividad» despliega la bitácora del registro", (await desplegar.getAttribute("aria-expanded")) === "true" && (await historial.locator("[data-actividad]").count()) > 0);
});

let S3 = null;
let S4 = null;
await paso("patricia", "NC: «Más acciones» (PDF del estado actual y «Anular…»), aviso pendiente y «Anular…» en la ventana", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/nc/${N_AN}`);
  await page.getByRole("button", { name: "Más acciones" }).click();
  const pdfActual = evento(page.waitForResponse((r) => r.url().includes(`/api/calidad/nc/${N_AN}/pdf?actual=1`)));
  await page.getByRole("menuitem", { name: /^PDF del estado actual/ }).click();
  const rp = await pdfActual;
  const cargo = await visor(page);
  check("[cob:C:C-079] [cob:C:C-080] «Más acciones › PDF del estado actual» abre el visor con el PDF a pedido (?actual=1)", rp.status() === 200 && /pdf/.test(rp.headers()["content-type"] || "") && cargo, String(rp.status()));
  await page.keyboard.press("Escape");
  await page.getByTestId("visor-pdf").first().waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Más acciones" }).click();
  await page.getByRole("menuitem", { name: /^Anular…/ }).click();
  await dialogoMotivo(page, `Anulación ${MARCA} de la NC que se aprobará`, "Solicitar anulación", PW("patricia"));
  S3 = await esperar(() => solPendiente("no_conformidades", N_AN, "anular_calidad"));
  const aviso = page.locator("[data-banner-solicitud]");
  await aviso.waitFor();
  await page.getByRole("button", { name: "Más acciones" }).click();
  await page.getByRole("menuitem", { name: /^PDF del estado actual/ }).waitFor();
  const conAnular = await page.getByRole("menuitem", { name: /^Anular…/ }).count();
  await page.keyboard.press("Escape");
  check("[cob:C:C-081] [cob:C:C-137] «Anular…» del menú crea la solicitud; la ficha muestra el aviso pendiente y el menú ya no ofrece «Anular…»", !!S3 && ncRow(N_AN)?.estado === "abierta" && conAnular === 0 && /pendiente de autorización/.test(await aviso.innerText()), `${S3} ${conAnular}`);

  await page.goto(LISTA);
  await hasta(page, todas(`nc-${N_AN2}`));
  await page.locator(`[data-nc="${N_AN2}"]`).click();
  await page.locator(`[data-nc-ventana="${N_AN2}"]`).waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Anular…" }).click();
  await dialogoMotivo(page, `Anulación ${MARCA} de la NC que se cancelará`, "Solicitar anulación", PW("patricia"));
  S4 = await esperar(() => solPendiente("no_conformidades", N_AN2, "anular_calidad"));
  await page.getByRole("dialog").locator("[data-banner-solicitud]").waitFor();
  check("[cob:C:C-040] «Anular…» en la ventana de la NC crea la solicitud y la ventana muestra el aviso", !!S4 && ncRow(N_AN2)?.estado === "abierta", String(S4));
});

await paso("patricia", "Por autorizar: «Mis solicitudes», renglón, orden, historial y cancelar desde la ventana", async (page) => {
  await page.goto(`${BASE_WEB}/solicitudes`);
  const mias = seccion(page, "sol-mias");
  await mias.locator(`[data-solicitud="${S1}"]`).waitFor();
  const etiqueta = ((await api("GET", "/solicitudes", undefined, t.patricia)).data?.items || []).find((s) => Number(s.id) === Number(S1))?.etiqueta;
  const r1 = (await mias.locator(`[data-solicitud="${S1}"]`).innerText()).replace(/\s+/g, " ");
  const enMias = [S1, S3, S4].every(Boolean) && (await mias.locator(`[data-solicitud="${S3}"]`).count()) === 1 && (await mias.locator(`[data-solicitud="${S4}"]`).count()) === 1;
  check("[cob:C:C-160] [cob:C:C-162] «Mis solicitudes» lista lo pedido; el renglón trae etiqueta, registro, quién, estado y «Vence …»", enMias && !!etiqueta && r1.includes(etiqueta) && r1.includes(folio("INC", incRow(I_AN1)?.folio_num)) && /Patricia/.test(r1) && /Pendiente de autorización/.test(r1) && /Vence/.test(r1), r1);
  const orden = async () => (await mias.locator("[data-solicitud]").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-solicitud"))))).filter((n) => [S1, S3, S4].includes(n)).join(",");
  const recientes = await orden();
  await interruptor(page, "Más antiguas");
  const antiguas = await esperar(async () => {
    const o = await orden();
    return o !== recientes ? o : null;
  });
  await interruptor(page, "Vencen primero");
  const vencen = await orden();
  check("[cob:C:C-158] «Ordenar por»: Más recientes primero, «Más antiguas» al revés y «Vencen primero» como las antiguas (vencen a los 7 días)", recientes === [S4, S3, S1].join(",") && antiguas === [S1, S3, S4].join(",") && vencen === [S1, S3, S4].join(","), `${recientes} · ${antiguas} · ${vencen}`);
  const conHistorial = evento(page.waitForResponse((r) => r.url().includes("/api/solicitudes?estado=todas")));
  await interruptor(page, "Ver historial");
  await conHistorial;
  await mias.locator(`[data-solicitud="${S2}"]`).waitFor();
  const r2 = ((await mias.locator(`[data-solicitud="${S2}"]`).textContent()) || "").replace(/\s+/g, " ");
  check("[cob:C:C-157] «Ver historial» pide estado=todas y agrega lo resuelto (la solicitud cancelada)", /Cancelada/.test(r2), r2);

  await mias.locator(`[data-solicitud="${S4}"] button[aria-haspopup=dialog]`).click();
  const v4 = page.locator(`[data-solicitud-ventana="${S4}"]`);
  await v4.waitFor();
  const sinAprobar = (await v4.getByRole("button", { name: "Aprobar", exact: true }).count()) === 0 && (await v4.getByRole("button", { name: "Rechazar", exact: true }).count()) === 0;
  await v4.getByRole("button", { name: "Cancelar solicitud" }).click();
  await page.getByRole("dialog", { name: "Cancelar la solicitud" }).getByRole("button", { name: "Cancelar solicitud" }).click();
  const cancelada = await esperar(() => solRow(S4)?.estado === "cancelada");
  check("[cob:C:C-169] [cob:C:C-177] en lo propio la ventana no ofrece Aprobar ni Rechazar; «Cancelar solicitud» la cancela tras confirmar y la NC sigue abierta", sinAprobar && !!cancelada && ncRow(N_AN2)?.estado === "abierta", `${solRow(S4)?.estado}`);
});

await paso("ana", "Por autorizar: franja de la lista, módulo, ventana, rechazar y aprobar desde el menú y la ventana", async (page) => {
  await page.goto(LISTA);
  const franja = page.locator("[data-franja-pendientes]");
  await franja.waitFor();
  const esperado = ((await api("GET", "/solicitudes", undefined, t.ana)).data?.items || []).filter((s) => s.puedo_aprobar && ["incidencias", "no_conformidades"].includes(String(s.entidad))).length;
  const enlace = franja.locator('a[href="/solicitudes?modulo=calidad"]');
  const textoF = (await enlace.innerText()).replace(/\s+/g, " ").trim();
  check("[cob:C:C-002] la franja dice cuántas solicitudes de incidencias y NC esperan su autorización", esperado >= 3 && textoF.startsWith(`${esperado} solicitudes esperan tu autorización`), `${esperado} · ${textoF}`);
  check("[cob:C:C-003] la franja de calidad no ofrece «visto bueno» (calidad no tiene supervisión)", (await franja.locator('a[href="/supervision"]').count()) === 0);
  await enlace.click();
  await page.waitForURL(/\/solicitudes\?modulo=calidad/);
  const pend = seccion(page, "sol-pendientes");
  await pend.locator(`[data-solicitud="${S1}"]`).waitFor();
  const ids = await pend.locator("[data-solicitud]").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-solicitud"))));
  const fuera = ids.filter((n) => !["incidencias", "no_conformidades", "acciones_correctivas", "suspensiones"].includes(String(solRow(n)?.entidad)));
  await page.getByRole("button", { name: /^Filtros/ }).click();
  const calidad = await page.getByRole("switch", { name: "Calidad", exact: true }).getAttribute("aria-checked");
  await page.keyboard.press("Escape");
  check("[cob:C:C-156] [cob:C:C-159] con ?modulo=calidad «Módulo › Calidad» queda elegido y «Pendientes de tu autorización» solo trae solicitudes de calidad (las de la prueba incluidas)", fuera.length === 0 && calidad === "true" && [S1, S3, S5].every((n) => ids.includes(n)), `${ids} · fuera ${fuera} · ${calidad}`);

  const abrirVentana = async (n) => {
    await pend.locator(`[data-solicitud="${n}"] button[aria-haspopup=dialog]`).click();
    const v = page.locator(`[data-solicitud-ventana="${n}"]`);
    await v.waitFor();
    return v;
  };
  let v1 = await abrirVentana(S1);
  const t1 = (await v1.innerText()).replace(/\s+/g, " ");
  check("[cob:C:C-166] la ventana cuenta qué se pide, quién la pidió y el motivo, con «Aprobar» y «Rechazar»", ["Qué se pide", "Quién la pidió", "Motivo", `Anulación ${MARCA} que se rechazará`, "Patricia"].every((x) => t1.includes(x)) && (await v1.getByRole("button", { name: "Aprobar", exact: true }).count()) === 1 && (await v1.getByRole("button", { name: "Rechazar", exact: true }).count()) === 1, t1.slice(0, 200));
  const dialogo = page.getByRole("dialog");
  const sig = dialogo.getByRole("button", { name: "Solicitud siguiente" });
  await ((await sig.isEnabled()) ? sig : dialogo.getByRole("button", { name: "Solicitud anterior" })).click();
  const otra = await esperar(async () => {
    const v = await page.locator("[data-solicitud-ventana]").getAttribute("data-solicitud-ventana").catch(() => null);
    return v && v !== String(S1) ? v : null;
  });
  check("[cob:C:C-171] «Solicitud siguiente/anterior» pasa a otra solicitud de la bandeja", !!otra && ids.includes(Number(otra)), String(otra));
  await page.keyboard.press("Escape");
  await dialogo.waitFor({ state: "detached" });
  v1 = await abrirVentana(S1);
  await v1.getByRole("link", { name: /Ver el registro/ }).click();
  await page.waitForURL(new RegExp(`/calidad/incidencias/${I_AN1}$`));
  check("[cob:C:C-170] «Ver el registro» lleva a la ficha de la incidencia", new URL(page.url()).pathname === `/calidad/incidencias/${I_AN1}`);

  await page.goto(`${BASE_WEB}/solicitudes?modulo=calidad`);
  v1 = await abrirVentana(S1);
  await v1.getByRole("button", { name: "Rechazar", exact: true }).click();
  const rechazo = page.getByRole("dialog", { name: /^Rechazar la solicitud/ });
  await rechazo.waitFor();
  const postsR = contar(page, "POST", /\/solicitudes\/\d+\/rechazar$/);
  await rechazo.locator("#prompt-motivo").fill("no");
  await rechazo.getByRole("button", { name: "Rechazar", exact: true }).click();
  await page.getByText("Motivo del rechazo debe tener al menos 5 caracteres").first().waitFor();
  check("[cob:C:C-176] el rechazo pide un motivo de al menos 5 caracteres; si no, no se envía", postsR.n === 0 && solRow(S1)?.estado === "pendiente");
  await entendido(page);
  await motivoEn(page, /^Rechazar la solicitud/, `Rechazo ${MARCA}: la incidencia sí cuenta`, "Rechazar", PW("ana"));
  const rech = await esperar(() => solRow(S1)?.estado === "rechazada");
  check("[cob:C:C-168] [cob:C:C-176] «Rechazar» con motivo y contraseña rechaza la solicitud y la incidencia no se anula", !!rech && solRow(S1)?.motivo_resolucion === `Rechazo ${MARCA}: la incidencia sí cuenta` && incRow(I_AN1)?.estado !== "anulada", `${solRow(S1)?.estado} ${incRow(I_AN1)?.estado}`);

  const aprobar = page.getByRole("dialog", { name: /^Aprobar la solicitud/ });
  const postsA = contar(page, "POST", /\/solicitudes\/\d+\/aprobar$/);
  const menuAprobar = async () => {
    await pend.locator(`[data-solicitud="${S3}"]`).getByRole("button", { name: "Acciones" }).click();
    await page.getByRole("menuitem", { name: /^Aprobar…/ }).click();
    await aprobar.waitFor();
  };
  await menuAprobar();
  const textoAprobar = await aprobar.innerText();
  await aprobar.getByRole("button", { name: "Aprobar y ejecutar" }).click();
  await page.getByText("Escribe el motivo de la aprobación").first().waitFor();
  check("[cob:C:C-163] [cob:C:C-172] [cob:C:C-173] «Aprobar…» del menú abre «Aprobar la solicitud: …» con el motivo de quien la pidió; sin motivo no se envía", postsA.n === 0 && textoAprobar.includes(`Anulación ${MARCA} de la NC que se aprobará`), textoAprobar.slice(0, 160));
  await entendido(page);
  await aprobar.locator("#ap-motivo").fill("Procede: la NC está duplicada");
  await aprobar.getByRole("button", { name: "Aprobar y ejecutar" }).click();
  await page.getByText("Escribe tu contraseña para confirmar").first().waitFor();
  check("[cob:C:C-174] sin contraseña no se aprueba (se pide para confirmar la identidad)", postsA.n === 0 && solRow(S3)?.estado === "pendiente");
  await entendido(page);
  await aprobar.getByRole("button", { name: "Volver" }).click();
  await aprobar.waitFor({ state: "detached" });
  check("[cob:C:C-175] «Volver» cierra el diálogo sin aprobar", postsA.n === 0 && solRow(S3)?.estado === "pendiente");
  await menuAprobar();
  await aprobar.locator("#ap-motivo").fill("Procede: la NC está duplicada");
  await aprobar.locator("#ap-password").fill(PW("ana"));
  await aprobar.getByRole("button", { name: "Aprobar y ejecutar" }).click();
  const anulada = await esperar(() => ncRow(N_AN)?.estado === "anulada");
  check("[cob:C:C-163] [cob:C:C-173] [cob:C:C-174] [cob:C:C-175] con motivo y contraseña «Aprobar y ejecutar» aprueba la solicitud y la NC queda anulada", !!anulada && solRow(S3)?.estado === "aprobada" && Number(solRow(S3)?.resuelto_por) === Number(id.ana), `${solRow(S3)?.estado} ${ncRow(N_AN)?.estado}`);

  const v5 = await abrirVentana(S5);
  await v5.getByRole("button", { name: "Aprobar", exact: true }).click();
  await aprobar.waitFor();
  await aprobar.locator("#ap-motivo").fill("No hay otra persona disponible esta semana");
  await aprobar.locator("#ap-password").fill(PW("ana"));
  await aprobar.getByRole("button", { name: "Aprobar y ejecutar" }).click();
  const aprobada = await esperar(() => solRow(S5)?.estado === "aprobada");
  check("[cob:C:C-167] «Aprobar» de la ventana abre el mismo diálogo y aprueba la excepción (queda en la incidencia)", !!aprobada && /"accion":"evaluar"/.test(incRow(I_REP)?.excepciones_json || ""), String(incRow(I_REP)?.excepciones_json));

  await interruptor(page, "Ver historial");
  const otras = seccion(page, "sol-otras");
  await otras.locator(`[data-solicitud="${S1}"]`).waitFor();
  check("[cob:C:C-157] [cob:C:C-161] con «Ver historial» aparece «Otras solicitudes» con las que resolvió (la rechazada y las aprobadas)", (await otras.locator(`[data-solicitud="${S3}"]`).count()) === 1 && (await otras.locator(`[data-solicitud="${S5}"]`).count()) === 1 && /Rechazada/.test(await otras.locator(`[data-solicitud="${S1}"]`).innerText()));
});

await paso("ricardo", "ficha de la incidencia propia: con la excepción aprobada ya puede evaluarla", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/incidencias/${I_REP}`);
  await page.locator("[data-evaluar]").click();
  const hoja = page.getByRole("dialog", { name: /^Evaluar/ });
  await hoja.waitFor();
  await hoja.getByRole("radio", { name: /^Cerrar sin NC/ }).check();
  await page.locator("#eval-just").fill("Falla aislada del equipo, ya corregida");
  await hoja.getByRole("button", { name: "Cerrar sin NC", exact: true }).click();
  const cerrada = await esperar(() => incRow(I_REP)?.estado === "cerrada_sin_nc");
  check("[cob:C:C-049] [cob:C:C-046] con la excepción aprobada desaparece el aviso, aparece «Evaluar» y quien reportó la cierra", !!cerrada && Number(incRow(I_REP)?.evaluada_por) === Number(id.ricardo), incRow(I_REP)?.estado);
});

/* =================== Ficha de la NC: etapa, índice, campos, avance, responsable (C-077…C-092) =================== */
await paso("ricardo", "ficha de la NC: etapa, regreso, índice, clasificación, requisito, impacto y avance de etapa", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/nc/${N_UI}`);
  await page.locator('[data-etapa="abierta"]').waitFor();
  const atras = page.getByRole("main").getByRole("link", { name: "Incidencias y NC" }).first();
  check("[cob:C:C-077] la ficha muestra el folio y marca la etapa (data-etapa=abierta)", (await page.getByText(folio("NC", ncRow(N_UI)?.folio_num)).count()) > 0);
  check("[cob:C:C-078] «Incidencias y NC» regresa a la lista filtrada a NC (?tipos=nc)", (await atras.getAttribute("href")) === "/calidad/incidencias?tipos=nc", await atras.getAttribute("href"));
  const indice = await page.getByRole("navigation", { name: "Secciones del formato" }).innerText();
  const faltan = ["Origen", "Descripción y requisito", "Evaluación de impacto", "Análisis de causa", "Acciones correctivas", "Verificación de eficacia", "Efectos en el SGC", "Cierre", "Historial"].filter((x) => !indice.includes(x));
  check("[cob:C:C-085] el índice tiene las nueve secciones del formato", !faltan.length, `faltan ${faltan.join(", ")}`);
  await mostrarTodo(page);
  check("[cob:C:C-083] [cob:C:C-084] sin cambios no hay «Guardar cambios» y sí «Iniciar análisis»", (await page.locator("[data-guardar-nc]").count()) === 0 && /Iniciar análisis/.test(await page.locator("[data-avanzar-nc]").first().innerText()));
  check("[cob:C:C-087] sin calidad:G el responsable se muestra como texto, sin selector", (await page.locator("#nc-responsable").count()) === 0);
  const posts = contar(page, "POST", /\/avanzar$/);
  await page.locator("[data-avanzar-nc]").first().click();
  await page.getByText("Indica si afecta resultados emitidos").first().waitFor();
  check("[cob:C:C-084] «Iniciar análisis» sin la evaluación de impacto: aviso y no se envía", posts.n === 0 && ncRow(N_UI)?.estado === "abierta");
  await entendido(page);
  await page.locator("#nc-clasificacion").selectOption("mayor");
  await page.locator("#nc-requisito").fill("Procedimiento FX-PT-01 inciso 5");
  await page.locator("#nc-afecta_resultados_emitidos").selectOption("no");
  await page.locator("#nc-trabajo_detenido").selectOption("si");
  await page.locator("#nc-notificar_cliente").selectOption("no");
  check("[cob:C:C-083] con cambios aparece «Guardar cambios» y se oculta el avance de etapa", (await page.locator("[data-guardar-nc]").count()) > 0 && (await page.locator("[data-avanzar-nc]").count()) === 0);
  await page.locator("[data-guardar-nc]").first().click();
  await toast(page, /Cambios guardados/);
  const n = await esperar(() => (ncRow(N_UI)?.clasificacion === "mayor" ? ncRow(N_UI) : null));
  check("[cob:C:C-086] [cob:C:C-089] [cob:C:C-090] [cob:C:C-091] [cob:C:C-092] se guardan clasificación, requisito y las tres respuestas del impacto", n?.requisito_incumplido === "Procedimiento FX-PT-01 inciso 5" && n?.afecta_resultados_emitidos === "no" && n?.trabajo_detenido === "si" && n?.notificar_cliente === "no", JSON.stringify({ c: n?.clasificacion, r: n?.requisito_incumplido, a: n?.afecta_resultados_emitidos, t: n?.trabajo_detenido, nc: n?.notificar_cliente }));
  await page.locator("[data-avanzar-nc]").first().click();
  await page.locator('[data-etapa="en_analisis"]').waitFor();
  check("[cob:C:C-084] con el impacto completo «Iniciar análisis» la pasa a «En análisis»", ncRow(N_UI)?.estado === "en_analisis");
});

const MOTIVO_RESP = `Responsable ${MARCA}: cambio de área`;
await paso("ana", "ficha de la NC: cambiar al responsable pide motivo", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/nc/${N_UI}`);
  await mostrarTodo(page);
  await page.locator(`#nc-responsable option[value="${id.gabriela}"]`).waitFor({ state: "attached" });
  await page.locator("#nc-responsable").selectOption(String(id.gabriela));
  await page.locator("[data-guardar-nc]").first().click();
  await dialogoMotivo(page, MOTIVO_RESP, "Confirmar");
  const n = await esperar(() => (Number(ncRow(N_UI)?.responsable_id) === Number(id.gabriela) ? ncRow(N_UI) : null));
  const bitacora = fila("SELECT id FROM auditoria WHERE entidad = 'no_conformidades' AND entidad_id = ? AND motivo = ?", String(N_UI), MOTIVO_RESP);
  check("[cob:C:C-087] con calidad:G se cambia el responsable; el cambio pide motivo y queda en la bitácora", !!n && !!bitacora, JSON.stringify({ r: ncRow(N_UI)?.responsable_id, b: bitacora }));
});

/* =================== NC: retención, marcas, aviso de suspensión, liberar y reanudar (C-021, C-076, C-095…C-099, C-138) =================== */
await paso("ricardo", "NC: retener el informe afectado, marcas de los renglones y aviso de suspensión en la extracción", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/nc/${N_EDIT}`);
  await mostrarTodo(page);
  const afectado = page.locator(`[data-afectado="${INF.informe}"]`);
  await afectado.getByRole("button", { name: "Retener…" }).click();
  const MOTIVO = `Retención ${MARCA} mientras se revisa`;
  await dialogoMotivo(page, MOTIVO, "Confirmar");
  await afectado.getByText("Retenido").waitFor();
  const ret = fila("SELECT * FROM retenciones_informe WHERE nc_id = ? AND informe_id = ? AND liberada_en IS NULL", N_EDIT, INF.informe);
  check("[cob:C:C-095] «Retener…» pide motivo, retiene el informe y lo marca «Retenido» (sin «Liberar retención…» para quien no tiene calidad:A)", ret?.motivo === MOTIVO && (await afectado.getByRole("button", { name: "Liberar retención…" }).count()) === 0, JSON.stringify(ret));

  await page.goto(LISTA);
  await hasta(page, todas(`nc-${N_EDIT}`, `incidencia-${I_AUTO}`, `nc-${N_REAB}`, `nc-${N_VENC}`, `nc-${N_ACC}`));
  const n = (sel) => page.locator(sel).count();
  const marcas = {
    automatica: await n(`[data-incidencia="${I_AUTO}"] [data-automatica]`),
    otraAutomatica: await n(`[data-incidencia="${I_LUIS}"] [data-automatica]`),
    suspension: await n(`[data-nc="${N_EDIT}"] [data-suspension]`),
    retenido: await n(`[data-nc="${N_EDIT}"] [data-retenido]`),
    reaperturas: await page.locator(`[data-nc="${N_REAB}"] [data-reaperturas]`).getAttribute("data-reaperturas"),
    vencida: await n(`[data-nc="${N_VENC}"] [data-vencida]`),
    ninguna: await n(`[data-nc="${N_ACC}"] :is([data-suspension],[data-retenido],[data-reaperturas],[data-vencida])`),
  };
  check("[cob:C:C-021] marcas de los renglones: «Automática», «Suspensión», «Informe retenido», «1 reapertura» y «acción vencida» según los datos (ninguna en una NC sin ellas)", marcas.automatica === 1 && marcas.otraAutomatica === 0 && marcas.suspension === 1 && marcas.retenido === 1 && marcas.reaperturas === "1" && marcas.vencida === 1 && marcas.ninguna === 0, JSON.stringify(marcas));

  await page.goto(`${BASE_WEB}/muestras/extraccion/${EXT.E}`);
  const aviso = page.locator("[data-aviso-suspension]");
  await aviso.waitFor();
  const ta = (await aviso.innerText()).replace(/\s+/g, " ");
  check("[cob:C:C-076] la extracción que usa el equipo suspendido avisa «Trabajo suspendido por una no conformidad» con el equipo y la NC", /Trabajo suspendido por una no conformidad/.test(ta) && ta.includes(EQ_NOMBRE) && ta.includes(folio("NC", ncRow(N_EDIT)?.folio_num)), ta);
});

await paso("ana", "NC: liberar la retención, reanudar la suspensión que hizo otra persona e historial", async (page) => {
  const historialNc = evento(
    page.waitForResponse((r) => {
      const u = new URL(r.url());
      return u.pathname === "/api/audit" && u.searchParams.get("entidad") === "no_conformidades" && u.searchParams.get("entidad_id") === String(N_EDIT);
    }),
  );
  await page.goto(`${BASE_WEB}/calidad/nc/${N_EDIT}`);
  await mostrarTodo(page);
  const afectado = page.locator(`[data-afectado="${INF.informe}"]`);
  await afectado.getByRole("button", { name: "Liberar retención…" }).click();
  await dialogoMotivo(page, `Liberación ${MARCA}: el informe es correcto`, "Liberar retención", PW("ana"));
  await afectado.getByRole("button", { name: "Retener…" }).waitFor();
  const lib = fila("SELECT * FROM retenciones_informe WHERE nc_id = ? AND informe_id = ? ORDER BY id DESC LIMIT 1", N_EDIT, INF.informe);
  check("[cob:C:C-096] «Liberar retención…» (crítico, con contraseña) libera el informe con su motivo", !!lib?.liberada_en && lib?.motivo_liberacion === `Liberación ${MARCA}: el informe es correcto` && Number(lib?.liberada_por) === Number(id.ana), JSON.stringify(lib));
  const su = page.locator(`[data-suspension="${SU}"]`);
  await su.getByRole("button", { name: "Reanudar…" }).click();
  await dialogoMotivo(page, `Reanudación ${MARCA}: el equipo se verificó`, "Reanudar", PW("ana"));
  await su.getByText("Reanudado").first().waitFor();
  check("[cob:C:C-099] «Reanudar…» (crítico) reanuda la suspensión que hizo otra persona y el equipo vuelve a operativo", !!fila("SELECT reanudada_en FROM suspensiones WHERE id = ?", SU)?.reanudada_en && fila("SELECT estado FROM equipos WHERE id = ?", EQ)?.estado === "operativo");
  const rh = await historialNc;
  const historial = page.locator("#sec-historial [data-historial-bitacora]");
  await historial.getByRole("button", { name: /^Actividad/ }).click();
  await historial.locator("[data-actividad]").first().waitFor();
  check("[cob:C:C-138] «9. Historial» pide la bitácora de la NC y despliega su actividad", rh.status() === 200 && (await historial.locator("[data-actividad]").count()) > 0);
});

/* =================== Acciones correctivas (C-116…C-121) =================== */
await paso("luis", "acciones de la NC: iniciar, marcar implementada y adjuntar evidencia (responsable de la acción)", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/nc/${N_ACC}`);
  await mostrarTodo(page);
  const fila1 = page.locator(`[data-accion-fila="${accIni}"]`);
  await fila1.waitFor();
  const textoFila = (await fila1.innerText()).replace(/\s+/g, " ");
  check("[cob:C:C-116] las tres acciones salen como renglones con descripción, responsable y compromiso", (await page.locator("#sec-acciones [data-accion-fila]").count()) === 3 && textoFila.includes(`Acción ${MARCA} que Luis inicia e implementa`) && /Luis/.test(textoFila) && /compromiso/.test(textoFila), textoFila);
  check("[cob:C:C-120] [cob:C:C-121] quien no edita la NC no ve «Reasignar a» ni «Cancelar…»", (await page.getByLabel("Reasignar a").count()) === 0 && (await page.locator("#sec-acciones").getByRole("button", { name: "Cancelar…" }).count()) === 0);
  await fila1.getByRole("button", { name: "Iniciar", exact: true }).click();
  await toast(page, /Acción en proceso/);
  await fila1.getByRole("button", { name: "Iniciar", exact: true }).waitFor({ state: "detached" });
  check("[cob:C:C-118] «Iniciar» la pasa a «En proceso»", fila("SELECT estado FROM acciones_correctivas WHERE id = ?", accIni)?.estado === "en_proceso");
  const posts = contar(page, "POST", /\/implementar$/);
  await page.locator(`[data-implementar="${accIni}"]`).click();
  await page.locator("#prompt-motivo").fill("Hecho");
  await page.getByRole("dialog").getByRole("button", { name: "Implementada", exact: true }).click();
  await page.getByText("Cómo se implementó debe tener al menos 10 caracteres").first().waitFor();
  check("[cob:C:C-119] «Cómo se implementó» de menos de 10 caracteres: aviso y no se envía", posts.n === 0);
  await entendido(page);
  await page.locator("#prompt-motivo").fill("Se instaló la lista de control en la bitácora");
  await page.getByRole("dialog").getByRole("button", { name: "Implementada", exact: true }).click();
  const acc = await esperar(() => (fila("SELECT * FROM acciones_correctivas WHERE id = ?", accIni)?.estado === "implementada" ? fila("SELECT * FROM acciones_correctivas WHERE id = ?", accIni) : null));
  check("[cob:C:C-119] con la descripción la acción queda implementada por su responsable", acc?.descripcion_implementacion === "Se instaló la lista de control en la bitácora" && Number(acc?.implementada_por) === Number(id.luis), JSON.stringify({ e: acc?.estado }));
  await fila1.getByRole("button", { name: "Evidencia" }).click();
  const panel = fila1.locator("[data-evidencia]");
  const adjuntar = panel.getByRole("button", { name: "Adjuntar evidencia" });
  await adjuntar.waitFor();
  await page.locator(`#evidencia-archivo-${accIni}`).setInputFiles({ name: "lista-control.png", mimeType: "image/png", buffer: PNG });
  await page.locator(`#evidencia-desc-${accIni}`).fill("Foto de la lista de control instalada");
  await adjuntar.click();
  const adj = await esperar(() => fila("SELECT * FROM adjuntos WHERE entidad = 'accion_correctiva' AND entidad_id = ? AND anulado_en IS NULL", accIni));
  await panel.locator(`[data-adjunto="${adj?.id}"]`).waitFor();
  check("[cob:C:C-117] «Evidencia» abre el panel; el responsable adjunta la evidencia y aparece en la lista", adj?.descripcion === "Foto de la lista de control instalada" && adj?.nombre_original === "lista-control.png", JSON.stringify(adj));
});

await paso("ricardo", "acciones de la NC: reasignar (motivo de al menos 5) y cancelar", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/nc/${N_ACC}`);
  await mostrarTodo(page);
  const fRea = page.locator(`[data-accion-fila="${accRea}"]`);
  await fRea.getByLabel("Reasignar a").selectOption(String(id.gabriela));
  const puts = contar(page, "PUT", new RegExp(`/acciones/${accRea}$`));
  await page.locator("#prompt-motivo").fill("abc");
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar", exact: true }).click();
  await page.getByText("Motivo de la reasignación debe tener al menos 5 caracteres").first().waitFor();
  check("[cob:C:C-120] el motivo de la reasignación pide al menos 5 caracteres en la pantalla (no se envía)", puts.n === 0);
  await entendido(page);
  await page.locator("#prompt-motivo").fill(`Reasignación ${MARCA} por carga de trabajo`);
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar", exact: true }).click();
  const a = await esperar(() => {
    const r = fila("SELECT * FROM acciones_correctivas WHERE id = ?", accRea);
    return Number(r?.responsable_id) === Number(id.gabriela) ? r : null;
  });
  check("[cob:C:C-120] «Reasignar a» cambia al responsable y guarda el motivo", a?.motivo_reasignacion === `Reasignación ${MARCA} por carga de trabajo`, JSON.stringify({ r: a?.responsable_id, m: a?.motivo_reasignacion }));
  await page.locator(`[data-accion-fila="${accCan}"]`).getByRole("button", { name: "Cancelar…" }).click();
  await dialogoMotivo(page, `Cancelación ${MARCA}: ya no aplica`, "Cancelar acción");
  const c = await esperar(() => (fila("SELECT * FROM acciones_correctivas WHERE id = ?", accCan)?.estado === "cancelada" ? fila("SELECT * FROM acciones_correctivas WHERE id = ?", accCan) : null));
  check("[cob:C:C-121] «Cancelar…» pide motivo y deja la acción cancelada con su motivo", c?.motivo_cancelacion === `Cancelación ${MARCA}: ya no aplica`, JSON.stringify({ e: c?.estado }));
});

/* =================== Segregación en verificación, cierre y reanudación (C-100, C-130, C-136) y cierre (C-082, C-135) =================== */
let S6 = null;
await paso("ricardo", "verificación de eficacia: quien implementó una acción no verifica (excepción)", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/nc/${N_R8}`);
  await mostrarTodo(page);
  const boton = page.locator("#sec-verificacion").getByRole("button", { name: /^Solicitar excepción para verificar/ });
  await boton.waitFor();
  check("[cob:C:C-130] el responsable de una acción no ve «Registrar verificación» sino la separación de funciones", (await page.locator("[data-verificar]").count()) === 0);
  await boton.click();
  await dialogoMotivo(page, `Excepción ${MARCA} para verificar`, "Solicitar excepción", PW("ricardo"));
  S6 = await esperar(() => solPendiente("no_conformidades", N_R8, "excepcion_segregacion"));
  check("[cob:C:C-130] «Solicitar excepción…» crea la solicitud de excepción para verificar", !!S6 && accionDe(solRow(S6)) === "verificar", String(S6));
});

let S7 = null;
await paso("ana", "cierre: la responsable de la NC no la cierra (excepción); rechazar y cancelar desde el menú de «Por autorizar»", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/nc/${N_R9}`);
  await mostrarTodo(page);
  const boton = page.locator("#sec-cierre").getByRole("button", { name: /^Solicitar excepción para cerrar/ });
  await boton.waitFor();
  check("[cob:C:C-136] la responsable de la NC no ve «Cerrar NC…» sino la separación de funciones", (await page.locator("[data-cerrar-nc]").count()) === 0);
  await boton.click();
  await dialogoMotivo(page, `Excepción ${MARCA} para cerrar`, "Solicitar excepción", PW("ana"));
  S7 = await esperar(() => solPendiente("no_conformidades", N_R9, "excepcion_segregacion"));
  check("[cob:C:C-136] «Solicitar excepción…» crea la solicitud de excepción para cerrar", !!S7 && accionDe(solRow(S7)) === "cerrar", String(S7));

  await page.goto(`${BASE_WEB}/solicitudes`);
  const pend = seccion(page, "sol-pendientes");
  await pend.locator(`[data-solicitud="${S6}"]`).getByRole("button", { name: "Acciones" }).click();
  await page.getByRole("menuitem", { name: /^Rechazar…/ }).click();
  await page.getByRole("dialog", { name: /^Rechazar la solicitud/ }).waitFor();
  await motivoEn(page, /^Rechazar la solicitud/, `Rechazo ${MARCA}: hay quien verifique`, "Rechazar", PW("ana"));
  const rech = await esperar(() => solRow(S6)?.estado === "rechazada");
  check("[cob:C:C-164] [cob:C:C-176] «Rechazar…» del menú pide motivo y contraseña y rechaza la solicitud", !!rech && Number(solRow(S6)?.resuelto_por) === Number(id.ana), solRow(S6)?.estado);
  const mia = seccion(page, "sol-mias").locator(`[data-solicitud="${S7}"]`);
  await mia.getByRole("button", { name: "Acciones" }).click();
  await page.getByRole("menuitem", { name: /^Cancelar solicitud…/ }).waitFor();
  const opciones = await page.getByRole("menuitem").allInnerTexts();
  await page.getByRole("menuitem", { name: /^Cancelar solicitud…/ }).click();
  await page.getByRole("dialog", { name: "Cancelar la solicitud" }).getByRole("button", { name: "Cancelar solicitud" }).click();
  const cancelada = await esperar(() => solRow(S7)?.estado === "cancelada");
  check("[cob:C:C-165] [cob:C:C-177] en lo propio el menú solo ofrece «Cancelar solicitud…» (sin aprobar ni rechazar) y la cancela tras confirmar", !!cancelada && !opciones.some((x) => /Aprobar|Rechazar/.test(x)), opciones.join(" | "));
});

await paso("ana", "NC: quien suspendió pide la excepción para reanudar; cerrar la NC y su PDF final", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/nc/${N_SUS}`);
  await mostrarTodo(page);
  const su = page.locator(`[data-suspension="${SU2}"]`);
  const pedir = su.getByRole("button", { name: "Solicitar excepción…" });
  await pedir.waitFor();
  check("[cob:C:C-100] a quien suspendió se le ofrece «Solicitar excepción…» en lugar de «Reanudar…» (regla 10)", (await su.getByRole("button", { name: "Reanudar…" }).count()) === 0);
  await pedir.click();
  await dialogoMotivo(page, `Excepción ${MARCA} para reanudar`, "Solicitar excepción", PW("ana"));
  const S8 = await esperar(() => solPendiente("suspensiones", SU2, "excepcion_segregacion"));
  const apr = S8 ? await api("POST", `/solicitudes/${S8}/aprobar`, { motivo: "No hay otra persona disponible para reanudar" }, t.patricia) : null;
  await page.reload();
  await mostrarTodo(page);
  const reanudar = page.locator(`[data-suspension="${SU2}"]`).getByRole("button", { name: "Reanudar…" });
  await reanudar.waitFor();
  check("[cob:C:C-100] con la excepción aprobada ya no se ofrece «Solicitar excepción…» sino «Reanudar…»", apr?.status === 200 && (await page.locator(`[data-suspension="${SU2}"]`).getByRole("button", { name: "Solicitar excepción…" }).count()) === 0, det(apr));
  await reanudar.click();
  await dialogoMotivo(page, `Reanudación ${MARCA} con excepción`, "Reanudar", PW("ana"));
  await page.locator(`[data-suspension="${SU2}"]`).getByText("Reanudado").first().waitFor();
  check("[cob:C:C-099] [cob:C:C-100] con la excepción, quien suspendió reanuda y el equipo vuelve a operativo", !!fila("SELECT reanudada_en FROM suspensiones WHERE id = ?", SU2)?.reanudada_en && fila("SELECT estado FROM equipos WHERE id = ?", EQ2)?.estado === "operativo");

  await page.goto(`${BASE_WEB}/calidad/nc/${N_CIE}`);
  await mostrarTodo(page);
  check("[cob:C:C-082] abierta, la NC no ofrece «PDF final»", (await page.getByRole("button", { name: "PDF final" }).count()) === 0);
  const posts = contar(page, "POST", /\/cerrar$/);
  await page.locator("[data-cerrar-nc]").click();
  await page.locator("#prompt-motivo").fill("Corta");
  if (await page.locator("#prompt-password").count()) await page.locator("#prompt-password").fill(PW("ana"));
  await page.getByRole("dialog").getByRole("button", { name: "Cerrar NC", exact: true }).click();
  await page.getByText("Conclusión del cierre debe tener al menos 10 caracteres").first().waitFor();
  check("[cob:C:C-135] conclusión de menos de 10 caracteres: aviso y no se cierra", posts.n === 0 && ncRow(N_CIE)?.estado !== "cerrada");
  await entendido(page);
  const CONCLUSION = `Cierre ${MARCA}: no requiere acción correctiva`;
  await page.locator("#prompt-motivo").fill(CONCLUSION);
  if (await page.locator("#prompt-password").count()) await page.locator("#prompt-password").fill(PW("ana"));
  await page.getByRole("dialog").getByRole("button", { name: "Cerrar NC", exact: true }).click();
  const n = await esperar(() => (ncRow(N_CIE)?.estado === "cerrada" ? ncRow(N_CIE) : null));
  check("[cob:C:C-135] «Cerrar NC…» con conclusión y contraseña la cierra y genera el PDF con su SHA-256", n?.conclusion === CONCLUSION && /^[0-9a-f]{64}$/.test(n?.pdf_sha256 || "") && Number(n?.cerrada_por) === Number(id.ana), JSON.stringify({ e: n?.estado, c: n?.conclusion }));
  const pdfFinal = page.getByRole("button", { name: "PDF final" }).first();
  await pdfFinal.waitFor();
  const huella = await page.getByText(`SHA-256 ${n?.pdf_sha256}`).count();
  const resp = evento(page.waitForResponse((r) => new URL(r.url()).pathname === `/api/calidad/nc/${N_CIE}/pdf`));
  await pdfFinal.click();
  const rp = await resp;
  const cargo = await visor(page);
  check("[cob:C:C-082] cerrada, «PDF final» abre el PDF final en el visor y la ficha muestra su SHA-256", rp.status() === 200 && cargo && huella === 1, `${rp.status()} ${huella}`);
});

/* =================== Ventana de la NC y propuesta heredada (C-037, C-039, C-042, C-134) =================== */
await paso("patricia", "ventana de la NC: etapa y acciones, «No requiere acción correctiva.», PDF solo si está cerrada; propuesta heredada", async (page) => {
  await page.goto(LISTA);
  await hasta(page, todas(`nc-${N_ACC}`, `nc-${N_SIN}`, `nc-${N_MENOR}`, `nc-${N_CIE}`));
  const dialogo = page.getByRole("dialog");
  const cerrar = async () => {
    await page.keyboard.press("Escape");
    await dialogo.waitFor({ state: "detached" });
  };
  await page.locator(`[data-nc="${N_ACC}"]`).click();
  const v = page.locator(`[data-nc-ventana="${N_ACC}"]`);
  await v.getByText(`Acción ${MARCA} que Luis inicia e implementa`).waitFor();
  const tv = (await v.innerText()).replace(/\s+/g, " ");
  check("[cob:C:C-037] la ventana de la NC muestra su folio, la etapa y las acciones con su estado", tv.includes(folio("NC", ncRow(N_ACC)?.folio_num)) && /Etapa/.test(tv) && tv.includes(`Acción ${MARCA} que se reasigna`) && /Implementada/.test(tv), tv.slice(0, 600));
  await cerrar();
  await page.locator(`[data-nc="${N_SIN}"]`).click();
  const vs = page.locator(`[data-nc-ventana="${N_SIN}"]`);
  await vs.getByText("No requiere acción correctiva.").waitFor();
  check("[cob:C:C-042] la NC sin acción correctiva dice «No requiere acción correctiva.» en su ventana", (await vs.getByText("Todavía no hay acciones definidas.").count()) === 0);
  await cerrar();
  await page.locator(`[data-nc="${N_MENOR}"]`).click();
  await page.locator(`[data-nc-ventana="${N_MENOR}"]`).getByRole("button", { name: "Abrir ficha completa" }).waitFor();
  check("[cob:C:C-039] una NC abierta no ofrece «PDF» en su ventana", (await dialogo.getByRole("button", { name: "PDF", exact: true }).count()) === 0);
  await cerrar();
  await page.locator(`[data-nc="${N_CIE}"]`).click();
  await page.locator(`[data-nc-ventana="${N_CIE}"]`).waitFor();
  const resp = evento(page.waitForResponse((r) => new URL(r.url()).pathname === `/api/calidad/nc/${N_CIE}/pdf`));
  await dialogo.getByRole("button", { name: "PDF", exact: true }).click();
  const rp = await resp;
  const cargo = await visor(page);
  check("[cob:C:C-039] la NC cerrada ofrece «PDF» en su ventana y abre el PDF final en el visor", rp.status() === 200 && cargo, String(rp.status()));

  await page.goto(`${BASE_WEB}/calidad/nc/${N_PROP}`);
  await mostrarTodo(page);
  const prop = page.locator("[data-propuesta-anterior]");
  await prop.waitFor();
  const tp = (await prop.innerText()).replace(/\s+/g, " ");
  check("[cob:C:C-134] la NC con una propuesta del flujo retirado la muestra solo para consulta (título y estado, sin enlace)", tp.includes(`Propuesta ${MARCA} del flujo retirado`) && /flujo retirado; solo consulta/.test(tp) && (await prop.locator("a").count()) === 0, tp);
});

/* =================== «Reportar incidencia» por la dirección y desde el informe (C-064…C-075) =================== */
await paso("ricardo", "«Reportar incidencia»: ?reportar=1, descripción mínima, archivos y la sección del informe", async (page) => {
  await page.goto(`${BASE_WEB}/calidad/incidencias?reportar=1`);
  const hojaR = page.locator("[data-reportar-incidencia]");
  const directa = await hojaR.waitFor({ timeout: 8000 }).then(() => true, () => false);
  // Comparación: la misma dirección por navegación del cliente (con la pantalla ya montada).
  let cliente = directa;
  if (!directa) {
    await page.evaluate(() => window.next?.router?.push("/calidad/incidencias?reportar=1"));
    cliente = await hojaR.waitFor({ timeout: 8000 }).then(() => true, () => false);
  }
  check("[cob:C:C-064] «?reportar=1» abre la hoja «Reportar incidencia» al cargar la pantalla con esa dirección", directa, `carga directa ${directa} · navegación del cliente ${cliente}`);
  if (!(await hojaR.count())) await page.getByRole("button", { name: "Reportar incidencia" }).first().click();
  await hojaR.waitFor();
  const posts = contar(page, "POST", /^\/api\/calidad\/incidencias$/);
  await page.locator("#inc-desc").fill("Muy corta");
  await page.locator("[data-enviar-incidencia]").click();
  await page.getByText("Describe qué pasó (al menos 20 caracteres)").first().waitFor();
  check("[cob:C:C-068] descripción de menos de 20 caracteres: aviso y no se envía", posts.n === 0);
  await entendido(page);
  await page.locator("#inc-archivos").setInputFiles({ name: "programa.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
  await page.getByText("«programa.exe» no se puede adjuntar: su formato no está permitido.").first().waitFor();
  await entendido(page);
  await page.locator("#inc-archivos").setInputFiles([
    { name: "evidencia-a.png", mimeType: "image/png", buffer: PNG },
    { name: "evidencia-b.png", mimeType: "image/png", buffer: PNG },
  ]);
  await page.getByRole("button", { name: "Quitar evidencia-b.png" }).click();
  check("[cob:C:C-071] un formato no permitido se rechaza con aviso; los permitidos se listan y se pueden quitar", (await page.getByRole("button", { name: "Quitar programa.exe" }).count()) === 0 && (await page.getByRole("button", { name: "Quitar evidencia-a.png" }).count()) === 1 && (await page.getByRole("button", { name: "Quitar evidencia-b.png" }).count()) === 0);
  const DESC = `Incidencia ${MARCA} con una foto desde la hoja`;
  await page.locator("#inc-tipo").selectOption("otro");
  await page.locator("#inc-desc").fill(DESC);
  await page.locator("[data-enviar-incidencia]").click();
  await toast(page, /reportada/);
  const inc = await esperar(() => fila("SELECT * FROM incidencias WHERE descripcion = ?", DESC));
  const adjs = inc ? await esperar(() => (filas("SELECT * FROM adjuntos WHERE entidad = 'incidencia' AND entidad_id = ?", inc.id).length ? filas("SELECT * FROM adjuntos WHERE entidad = 'incidencia' AND entidad_id = ?", inc.id) : null)) : null;
  check("[cob:C:C-071] [cob:C:C-073] «Reportar» crea la incidencia y sube como adjunto el archivo que quedó (foto)", !!inc && adjs?.length === 1 && adjs[0].nombre_original === "evidencia-a.png" && adjs[0].tipo_evidencia === "foto", JSON.stringify(adjs?.map((a) => a.nombre_original)));

  await page.goto(`${BASE_WEB}/informes/${INF.informe}`);
  await mostrarTodo(page);
  const sec = page.locator('#sec-incidencias [data-incidencias-registro="informes"]');
  await sec.locator(`a[href="/calidad/incidencias/${I_INF}"]`).waitFor();
  await sec.getByRole("button", { name: "Reportar incidencia" }).click();
  await page.locator("[data-reportar-incidencia]").waitFor();
  const chips = await page.getByRole("button", { name: /^Quitar IR / }).count();
  check("[cob:C:C-075] la ficha del informe lista sus incidencias y «Reportar incidencia» abre la hoja con el informe ligado", chips === 1, String(chips));
});

/* =================== Auditoría: aviso, búsqueda, periodo, personas, área, accesos, detalle (C-140…C-154) =================== */
await paso("patricia", "Auditoría: aviso de integridad, búsqueda, periodo por omisión, personas, área, inicios de sesión y detalle", async (page) => {
  const verif = evento(page.waitForResponse((r) => new URL(r.url()).pathname === "/api/audit/verify"));
  const inicial = evento(page.waitForRequest((r) => new URL(r.url()).pathname === "/api/audit"));
  await page.goto(`${BASE_WEB}/auditoria`);
  const rv = await verif;
  const ri = new URL((await inicial).url()).searchParams;
  await page.getByRole("heading", { name: "Auditoría" }).waitFor();
  const AVISO = "Se detectó un posible cambio no autorizado en el registro de actividad";
  check("[cob:C:C-140] con la bitácora íntegra (verify ok) no aparece el aviso de peligro", (await rv.json().catch(() => ({}))).ok === true && (await page.getByText(AVISO).count()) === 0);
  check("[cob:C:C-142] el periodo por omisión es «Últimos 30 días» (desde = hoy − 29, hasta = hoy)", ri.get("desde") === enDias(-29) && ri.get("hasta") === hoy(), `${ri.get("desde")} ${ri.get("hasta")}`);
  check("[cob:C:C-148] por omisión los inicios de sesión no se muestran (sin_accesos=1)", ri.get("sin_accesos") === "1", ri.toString());

  const busqueda = evento(page.waitForResponse((r) => new URL(r.url()).pathname === "/api/audit" && new URL(r.url()).searchParams.get("search") === MOTIVO_RESP));
  await page.getByPlaceholder("Buscar por folio, persona o motivo").fill(MOTIVO_RESP);
  const rb = await busqueda;
  const ids = ((await rb.json().catch(() => ({}))).items || []).map((e) => String(e.id));
  const fila1 = page.locator("[data-actividad]").first();
  await fila1.waitFor();
  check("[cob:C:C-141] la búsqueda pide search=<texto> y la lista muestra lo que encontró (el cambio de responsable)", ids.length >= 1 && /responsable|reasign/i.test(await fila1.innerText()), `${ids.length} · ${(await fila1.innerText()).replace(/\s+/g, " ").slice(0, 120)}`);
  await fila1.click();
  const detalle = page.locator("[data-actividad-detalle]");
  await detalle.waitFor();
  const td = (await detalle.innerText()).replace(/\s+/g, " ");
  check("[cob:C:C-152] el detalle de la actividad dice qué pasó, qué cambió (antes y después) y el motivo", td.includes("Qué pasó") && td.includes("Qué cambió") && td.includes("Motivo") && td.includes(MOTIVO_RESP), td.slice(0, 240));
  await detalle.getByRole("link", { name: /Ver el registro/ }).click();
  await page.waitForURL(new RegExp(`/calidad/nc/${N_UI}$`));
  check("[cob:C:C-154] «Ver el registro» lleva a la ficha de la NC", new URL(page.url()).pathname === `/calidad/nc/${N_UI}`);

  await page.goto(`${BASE_WEB}/auditoria?periodo=todo&buscar=${encodeURIComponent(MARCA)}`);
  await page.locator("[data-actividad]").first().waitFor();
  const NOMBRE_ANA = fila("SELECT nombre FROM usuarios WHERE id = ?", id.ana)?.nombre;
  const conAna = evento(page.waitForResponse((r) => new URL(r.url()).pathname === "/api/audit" && new URL(r.url()).searchParams.get("usuarios") === EMAIL.ana));
  await interruptor(page, NOMBRE_ANA);
  const ra = await conAna;
  const deAna = ((await ra.json().catch(() => ({}))).items || []);
  check("[cob:C:C-145] «Personas › <nombre de Ana>» pide usuarios=<su correo> y solo trae actividad suya", deAna.length > 0 && deAna.every((e) => Number(e.usuario_id) === Number(id.ana)), `${deAna.length} · ${[...new Set(deAna.map((e) => e.usuario_id))].join(",")}`);
  await interruptor(page, NOMBRE_ANA, false);
  const conArea = evento(page.waitForResponse((r) => new URL(r.url()).pathname === "/api/audit" && !!new URL(r.url()).searchParams.get("entidades")));
  await interruptor(page, "Calidad");
  const rc = await conArea;
  const entidades = new URL(rc.url()).searchParams.get("entidades") || "";
  const deCalidad = ((await rc.json().catch(() => ({}))).items || []);
  check("[cob:C:C-147] «Área › Calidad» pide entidades=incidencias,no_conformidades,… y solo trae esas entidades", ["incidencias", "no_conformidades", "acciones_correctivas", "suspensiones"].every((e) => entidades.split(",").includes(e)) && !entidades.includes("informes") && deCalidad.length > 0 && deCalidad.every((e) => entidades.split(",").includes(String(e.entidad))), `${entidades} · ${[...new Set(deCalidad.map((e) => e.entidad))].join(",")}`);
  await interruptor(page, "Calidad", false);
  const conAccesos = evento(page.waitForRequest((r) => new URL(r.url()).pathname === "/api/audit" && !new URL(r.url()).searchParams.has("sin_accesos")));
  await interruptor(page, "Mostrar inicios de sesión");
  await conAccesos;
  check("[cob:C:C-148] «Mostrar inicios de sesión» quita sin_accesos=1 de la consulta", true);

  // Bitácora alterada simulada: /api/audit/verify responde ok=false (200, nunca un 500).
  await page.route("**/api/audit/verify", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, problemas: [{ tipo: "simulado" }] }) }));
  await page.goto(`${BASE_WEB}/auditoria`);
  await page.getByText(AVISO).waitFor();
  check("[cob:C:C-140] si la verificación de la bitácora falla aparece el aviso «Se detectó un posible cambio no autorizado…»", (await page.getByText(AVISO).count()) === 1);
  await page.unroute("**/api/audit/verify");
});

await paso("diego", "Por autorizar sin nada que aprobar", async (page) => {
  await page.goto(`${BASE_WEB}/solicitudes`);
  await page.getByRole("heading", { name: "Por autorizar" }).waitFor();
  await page.getByText("Nada pendiente de tu autorización").waitFor();
  check("[cob:C:C-155] [cob:C:C-159] el Estudiante abre «Por autorizar» y ve «Nada pendiente de tu autorización» (sin solicitudes ajenas)", (await seccion(page, "sol-pendientes").locator("[data-solicitud]").count()) === 0);
});

/* =================== Auditoría (C-143…C-153) =================== */
await paso("patricia", "Auditoría: resumen, carga por páginas y anterior/siguiente", async (page) => {
  const primera = evento(page.waitForResponse((r) => r.url().includes("/api/audit?") && !r.url().includes("antes_de=")));
  await page.goto(`${BASE_WEB}/auditoria?periodo=todo`);
  await primera;
  const resumen = page.locator("[data-audit-resumen]");
  await resumen.waitFor();
  const r1 = (await resumen.innerText()).trim();
  check("[cob:C:C-149] el resumen dice «60+ actividades» con la primera página llena", /^60\+ actividades$/.test(r1), r1);
  const segunda = evento(page.waitForRequest((r) => /\/api\/audit\?.*antes_de=\d+/.test(r.url()) && /limit=60/.test(r.url())));
  await page.locator("[data-actividad]").last().scrollIntoViewIfNeeded();
  await segunda;
  const r2 = await esperar(async () => {
    const texto = (await resumen.innerText()).trim();
    return /^1[12]\d\+? actividades$|^\d{3}\+? actividades$/.test(texto) ? texto : null;
  });
  check("[cob:C:C-151] al llegar al final se pide la página siguiente (antes_de=<id>&limit=60) y el resumen crece", !!r2, `${r1} → ${(await resumen.innerText()).trim()}`);

  await page.locator("[data-actividad]").first().click();
  const detalle = page.locator("[data-actividad-detalle]");
  await detalle.waitFor();
  const primero = await detalle.getAttribute("data-actividad-detalle");
  await page.getByRole("dialog").getByRole("button", { name: "Actividad siguiente" }).click();
  const segundo = await esperar(async () => {
    const v = await page.locator("[data-actividad-detalle]").getAttribute("data-actividad-detalle").catch(() => null);
    return v && v !== primero ? v : null;
  });
  const antEnabled = await page.getByRole("dialog").getByRole("button", { name: "Actividad anterior" }).isEnabled();
  check("[cob:C:C-153] «Actividad siguiente» pasa a otra actividad y entonces «Actividad anterior» se habilita", !!segundo && antEnabled, `${primero} → ${segundo}`);
});

await paso("patricia", "Auditoría: periodo personalizado, tipo de actividad y actividad redactada", async (page) => {
  await page.goto(`${BASE_WEB}/auditoria?periodo=todo&buscar=${encodeURIComponent(MARCA)}`);
  const filaAnu = page.locator("[data-actividad]").filter({ hasText: /anul/i }).first();
  await filaAnu.waitFor();
  const texto = (await filaAnu.innerText()).replace(/\s+/g, " ");
  check("[cob:C:C-150] la anulación propia aparece redactada en español (sin nombres de acción ni JSON)", /anul/i.test(texto) && !/\banular\b|[{}]|_/.test(texto), texto);

  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.getByText("Tipo de actividad", { exact: true }).waitFor();
  const conTipo = evento(page.waitForRequest((r) => r.url().includes("/api/audit?") && /acciones=[^&]*anular/.test(decodeURIComponent(r.url()))));
  await page.getByRole("switch", { name: "Anulaciones y rechazos", exact: true }).click();
  const req = await conTipo;
  const acciones = new URL(req.url()).searchParams.get("acciones") || "";
  await page.keyboard.press("Escape");
  const solo = await esperar(async () => {
    const filas = await page.locator("[data-actividad]").evaluateAll((els) => els.map((e) => e.textContent || ""));
    return filas.length > 0 && filas.every((f) => /anul|rechaz|cancel|baja|suspend|retuv|retir|devolv|escal|sustitu|revoc|elimin/i.test(f)) ? filas.length : null;
  });
  check("[cob:C:C-146] «Tipo de actividad › Anulaciones y rechazos» pide acciones=anular,rechazar,… y deja solo esas actividades", acciones.split(",").includes("anular") && acciones.split(",").includes("rechazar") && !acciones.split(",").includes("crear") && !!solo, `${acciones.slice(0, 80)} · ${solo}`);
  await interruptor(page, "Anulaciones y rechazos", false);

  await page.getByRole("button", { name: /^Filtros/ }).click();
  check("[cob:C:C-143] [cob:C:C-144] «Desde» y «Hasta» solo aparecen con Periodo = Personalizado", (await page.locator("#aud-desde").count()) === 0);
  await page.getByRole("switch", { name: "Personalizado", exact: true }).click();
  await page.locator("#aud-desde").waitFor();
  const futuro = evento(page.waitForRequest((r) => r.url().includes("/api/audit?") && r.url().includes(`desde=${enDias(2)}`)));
  await page.locator("#aud-desde").fill(enDias(2));
  await futuro;
  await page.getByText("No hay actividades con estos filtros.").waitFor();
  const deHoy = evento(page.waitForRequest((r) => r.url().includes("/api/audit?") && r.url().includes(`desde=${hoy()}`) && r.url().includes(`hasta=${hoy()}`)));
  await page.locator("#aud-desde").fill(hoy());
  await page.locator("#aud-hasta").fill(hoy());
  await deHoy;
  await page.keyboard.press("Escape");
  await page.locator("[data-actividad]").first().waitFor();
  check("[cob:C:C-143] [cob:C:C-144] Desde en el futuro: «No hay actividades…»; Desde y Hasta = hoy: vuelve la actividad de hoy (desde= y hasta= en la consulta)", (await page.locator("[data-actividad]").count()) > 0);
});

/* ---------- Limpieza: nada suspendido, retenido ni pendiente de lo propio ---------- */
for (const [su, equipo, quien] of [[SU, EQ, "ana"], [SU2, EQ2, "patricia"]]) {
  if (su && !fila("SELECT reanudada_en FROM suspensiones WHERE id = ?", su)?.reanudada_en) await api("POST", `/calidad/suspensiones/${su}/reanudar`, { motivo: "Fin de la prueba de cobertura de pantalla" }, t[quien]);
  if (equipo) check(`(limpieza) la suspensión del equipo propio ${equipo} queda reanudada`, !!fila("SELECT reanudada_en FROM suspensiones WHERE id = ?", su)?.reanudada_en && fila("SELECT estado FROM equipos WHERE id = ?", equipo)?.estado === "operativo");
}
for (const r of filas("SELECT id FROM retenciones_informe WHERE informe_id = ? AND liberada_en IS NULL", INF.informe)) await api("POST", `/calidad/retenciones/${r.id}/liberar`, { motivo: "Fin de la prueba de cobertura de pantalla" }, t.ana);
check("(limpieza) el informe propio no queda retenido", !fila("SELECT id FROM retenciones_informe WHERE informe_id = ? AND liberada_en IS NULL", INF.informe));
const pendientes = filas("SELECT id, solicitado_por FROM solicitudes_autorizacion WHERE estado = 'pendiente' AND motivo LIKE ?", `%${MARCA}%`);
const tokenDe = (usuarioId) => t[Object.keys(id).find((k) => Number(id[k]) === Number(usuarioId))] || t.qa;
for (const p of pendientes) await api("POST", `/solicitudes/${p.id}/cancelar`, {}, tokenDe(p.solicitado_por));
check("(limpieza) no quedan solicitudes propias pendientes", !fila("SELECT id FROM solicitudes_autorizacion WHERE estado = 'pendiente' AND motivo LIKE ?", `%${MARCA}%`), JSON.stringify(pendientes));

await nav.cerrar();
terminar();
