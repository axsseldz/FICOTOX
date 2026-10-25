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
const { abrirNavegador, BASE_WEB, dialogoMotivo, entendido, esperar, mostrarTodo, toast } = await import("../lib/navegador.mjs");
const { api, crearCheck, credenciales, Database, EMAIL, enDias, fila, hoy, informeLiberado, sesiones } = await import("../lib/calidad.mjs");

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
  const respuesta = page.waitForResponse((r) => r.url().includes("/api/calidad/lista") && (on ? r.url().includes(parametro) : !r.url().includes(parametro)));
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
  const futura = page.waitForResponse((r) => r.url().includes("/api/calidad/lista") && r.url().includes(`desde=${enDias(2)}`));
  await page.locator("#cal-desde").fill(enDias(2));
  await futura;
  const vacia = await hasta(page, (v) => v.size === 0);
  await page.getByText("Sin coincidencias").waitFor();
  check("[cob:C:C-017] «Desde» en el futuro: la lista queda vacía («Sin coincidencias»)", vacia.ok, vacia.v);
  const rango = page.waitForResponse((r) => r.url().includes("/api/calidad/lista") && r.url().includes(`desde=${hoy()}`) && r.url().includes(`hasta=${hoy()}`));
  await page.locator("#cal-desde").fill(hoy());
  await page.locator("#cal-hasta").fill(hoy());
  await rango;
  const deHoy = await hasta(page, todas(`incidencia-${I_REP}`, `nc-${N_MENOR}`));
  check("[cob:C:C-017] [cob:C:C-018] Desde y Hasta = hoy: vuelven los registros de hoy (la consulta lleva desde= y hasta=)", deHoy.ok, deHoy.v);
  await page.keyboard.press("Escape");

  // Orden: el de la pantalla es el mismo que entrega el servidor con orden=antiguos / orden=folio.
  for (const [nombre, orden] of [["Más antiguos", "antiguos"], ["Folio", "folio"]]) {
    const r = page.waitForResponse((x) => x.url().includes("/api/calidad/lista") && x.url().includes(`orden=${orden}`));
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
  check("[cob:C:C-024] [cob:C:C-025] [cob:C:C-026] «Abrir NC» guarda descripción, requisito y clasificación y abre la ficha", n?.descripcion === DESC && n?.requisito_incumplido === "ISO/IEC 17025 7.9 quejas" && n?.clasificacion === "mayor" && n?.origen === "queja" && n?.estado === "abierta", JSON.stringify({ d: n?.descripcion, r: n?.requisito_incumplido, c: n?.clasificacion, o: n?.origen }));
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
    await page.getByRole("menuitem", { name: /Reportar incidencia/ }).click();
    await page.locator("[data-reportar-incidencia]").waitFor();
  };
  await abrir();
  const quitar = page.getByRole("button", { name: `Quitar ${EQ_NOMBRE}` });
  await quitar.waitFor();
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
  check("[cob:C:C-066] [cob:C:C-067] [cob:C:C-069] [cob:C:C-070] [cob:C:C-072] se guardan tipo, fecha y hora (hoy 00:00), acción inmediata, impacto «desconocido» y el equipo ligado", inc?.tipo === "falla_equipo" && inc?.accion_inmediata === "Se apagó el equipo y se avisó a la coordinación" && inc?.impacto_resultados === "desconocido" && !!inc?.fecha_hora_ocurrencia && Date.parse(inc.fecha_hora_ocurrencia) < Date.now() && liga?.entidad === "equipos" && Number(liga?.entidad_id) === Number(EQ), JSON.stringify({ t: inc?.tipo, a: inc?.accion_inmediata, i: inc?.impacto_resultados, f: inc?.fecha_hora_ocurrencia, liga }));
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
  check("[cob:C:C-088] [cob:C:C-093] «Guardar cambios» guarda la descripción y las notas del impacto", n?.descripcion === DESC && n?.impacto_notas === "Impacto acotado al lote de la prueba" && n?.notificar_cliente === "si" && n?.afecta_resultados_emitidos === "no", JSON.stringify({ d: n?.descripcion, i: n?.impacto_notas }));
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
  check("[cob:C:C-094] el informe elegido aparece como afectado y se guarda en la NC", !!fila("SELECT id FROM nc_registros_afectados WHERE nc_id = ? AND entidad_id = ?", N_EDIT, INF.informe), (await afectado.innerText()).replace(/\s+/g, " "));

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
  check("[cob:C:C-098] la suspensión del equipo aparece en la NC («Suspendido», sin «Reanudar…» para quien no tiene calidad:A) y el equipo deja de estar operativo", /Equipo/.test(await su.innerText()) && (await su.getByRole("button", { name: /Reanudar/ }).count()) === 0 && /Suspendido/.test(await su.innerText()) && fila("SELECT estado FROM equipos WHERE id = ?", EQ)?.estado !== "operativo", (await su.innerText()).replace(/\s+/g, " "));

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
  check("[cob:C:C-106] [cob:C:C-108] [cob:C:C-109] la comunicación se guarda con medio, contacto, resumen y el informe afectado marcado", casillas === 1 && com?.medio === "telefono" && com?.contacto === "Lic. Cliente de prueba, jefa de calidad" && com?.fecha === hoy() && JSON.parse(com?.informe_ids_json || "[]").map(Number).includes(Number(INF.informe)), JSON.stringify({ casillas, com }));

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
  check("[cob:C:C-122] [cob:C:C-124] «Agregar acción» guarda descripción, responsable y fecha compromiso", acc?.descripcion === "Crear la lista de control de verificación" && Number(acc?.responsable_id) === Number(id.luis) && acc?.fecha_compromiso === enDias(10), JSON.stringify(acc));
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
  check("[cob:C:C-128] «Registrar verificación» guarda el resultado eficaz y cómo se verificó", v?.resultado === "eficaz" && v?.comentarios === "Se revisaron los registros de la acción implementada", JSON.stringify(v));
});

/* =================== Auditoría (C-143…C-153) =================== */
await paso("patricia", "Auditoría: resumen, carga por páginas y anterior/siguiente", async (page) => {
  const primera = page.waitForResponse((r) => r.url().includes("/api/audit?") && !r.url().includes("antes_de="));
  await page.goto(`${BASE_WEB}/auditoria?periodo=todo`);
  await primera;
  const resumen = page.locator("[data-audit-resumen]");
  await resumen.waitFor();
  const r1 = (await resumen.innerText()).trim();
  check("[cob:C:C-149] el resumen dice «60+ actividades» con la primera página llena", /^60\+ actividades$/.test(r1), r1);
  const segunda = page.waitForRequest((r) => /\/api\/audit\?.*antes_de=\d+/.test(r.url()) && /limit=60/.test(r.url()));
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
  const conTipo = page.waitForRequest((r) => r.url().includes("/api/audit?") && /acciones=[^&]*anular/.test(decodeURIComponent(r.url())));
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
  const futuro = page.waitForRequest((r) => r.url().includes("/api/audit?") && r.url().includes(`desde=${enDias(2)}`));
  await page.locator("#aud-desde").fill(enDias(2));
  await futuro;
  await page.getByText("No hay actividades con estos filtros.").waitFor();
  const deHoy = page.waitForRequest((r) => r.url().includes("/api/audit?") && r.url().includes(`desde=${hoy()}`) && r.url().includes(`hasta=${hoy()}`));
  await page.locator("#aud-desde").fill(hoy());
  await page.locator("#aud-hasta").fill(hoy());
  await deHoy;
  await page.keyboard.press("Escape");
  await page.locator("[data-actividad]").first().waitFor();
  check("[cob:C:C-143] [cob:C:C-144] Desde en el futuro: «No hay actividades…»; Desde y Hasta = hoy: vuelve la actividad de hoy (desde= y hasta= en la consulta)", (await page.locator("[data-actividad]").count()) > 0);
});

/* ---------- Limpieza: reanudar la suspensión del equipo propio ---------- */
if (SU) {
  const re = await api("POST", `/calidad/suspensiones/${SU}/reanudar`, { motivo: "Fin de la prueba de cobertura de pantalla" }, t.ana);
  check("(limpieza) la suspensión del equipo propio se reanuda", re.status === 200 && fila("SELECT estado FROM equipos WHERE id = ?", EQ)?.estado === "operativo", det(re));
}

await nav.cerrar();
terminar();
