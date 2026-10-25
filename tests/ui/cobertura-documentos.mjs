/*
 * Cobertura · Documentos SGC en pantalla (Playwright): los elementos de interfaz de la matriz que no tenían
 * prueba automática. Cada check lleva su etiqueta [cob:D:<id>]. Los datos de apoyo se preparan por la API
 * (claves únicas) y cada persona actúa en pantalla con su rol (regla 11: elaborador, revisor y autorizador
 * son tres personas distintas). Sin errores de consola ni respuestas 5xx.
 */
import "../lib/reauth-auto.mjs";

process.env.BASE = `${(process.env.BASE || "http://localhost:3100").replace(/\/api$/, "")}/api`;
const { abrirNavegador, BASE_WEB, contrasena, entendido, esperar } = await import("../lib/navegador.mjs");
const { api, crearCheck, credenciales, Database, EMAIL, enDias, fila, filas, hoy, sesiones } = await import("../lib/calidad.mjs");
const { docxSimple, pdfConTexto } = await import("../lib/archivos.mjs");
const { accion, cerrarMenu, motivo, principal } = await import("../lib/ficha.mjs");

const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const nav = await abrirNavegador({ suite: "cobertura-documentos", check, credencial: (quien) => (typeof quien === "object" ? quien : { email: EMAIL[quien], password: credenciales[EMAIL[quien]] }) });
const { paso } = nav;
const s = Date.now().toString(36).slice(-4).toUpperCase();
const HOY = hoy();
const fmt = (iso) => String(iso).split("-").reverse().join("/");
const pw = (quien) => credenciales[EMAIL[quien]];
const SIN_APROBAR = { "X-Sin-Aprobar-Auto": "1" };
const RESP = { elaborador_id: id.luis, revisor_id: id.gabriela, autorizador_id: id.patricia };
const CAMBIO = { apartados_afectados: "Todo el documento", descripcion_cambio: "Emisión inicial" };
const ejecutar = (sql, ...p) => {
  const b = new Database(process.env.TEST_DB_PATH);
  b.prepare(sql).run(...p);
  b.close();
};
const pdf = async (nombre, titulo = nombre) => ({ name: nombre, mimeType: "application/pdf", buffer: await pdfConTexto(1, titulo) });
const TXT = { name: "notas.txt", mimeType: "text/plain", buffer: Buffer.from("No es un PDF") };
const DOCX = (nombre) => ({ name: nombre, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docxSimple(`Fuente ${s}`) });

/* ---------- Datos de apoyo (API) ---------- */
async function ficha(campos) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...RESP, ...campos })) fd.append(k, String(v));
  fd.append("archivo_pdf", new Blob([await pdfConTexto(1, campos.titulo)]), "inicial.pdf");
  const r = await api("POST", "/sgc/documentos", fd, t.ana);
  return { id: r.data?.id, revision_id: r.data?.revision_id, status: r.status, clave: campos.clave, titulo: campos.titulo };
}
async function vigente(campos, fechas = { fecha_emision: "2025-01-10", fecha_proxima_revision: "2028-01-10" }) {
  const d = await ficha(campos);
  const r = await api("POST", `/sgc/revisiones/${d.revision_id}/registrar-vigente`, fechas, t.ana);
  return { ...d, ok: d.status === 201 && r.status === 200 };
}
/* Lleva la revisión `rev` por el flujo hasta `estado` (en_revision, en_autorizacion o autorizada). */
async function hasta(rev, estado) {
  const r = [await api("PUT", `/sgc/revisiones/${rev}`, CAMBIO, t.luis), await api("POST", `/sgc/revisiones/${rev}/enviar-revision`, {}, t.luis)];
  if (estado !== "en_revision") r.push(await api("POST", `/sgc/revisiones/${rev}/revisar`, { decision: "aceptar" }, t.gabriela));
  if (estado === "autorizada") r.push(await api("POST", `/sgc/revisiones/${rev}/autorizar`, { decision: "autorizar" }, t.patricia));
  return r.every((x) => x.status === 200) && fila("SELECT estado FROM sgc_revisiones WHERE id = ?", rev)?.estado === estado;
}
const solicitud = async (campos, quien) => {
  const r = await api("POST", "/sgc/solicitudes", campos, t[quien]);
  return r.status === 201 ? Number(r.data?.id) : null;
};

const V = await vigente({ clave: `FX-TCI-V${s}`, titulo: `Instrucción distribuida ${s}`, area_codigo: "TC", tipo_codigo: "I" });
const distV = await api("POST", `/sgc/revisiones/${V.revision_id}/distribucion`, { usuarios: [id.luis, id.mariana], punto_uso: "Área de extracción", requiere_lectura: true, motivo: "Distribución de la prueba de cobertura" }, t.ana);
const PR = await vigente({ clave: `FX-TCP-Q${s}`, titulo: `Procedimiento por revisar pronto ${s}`, area_codigo: "TC", tipo_codigo: "P" }, { fecha_emision: "2025-01-10", fecha_proxima_revision: enDias(10) });
const PV = await vigente({ clave: `FX-TCP-W${s}`, titulo: `Procedimiento con revisión vencida ${s}`, area_codigo: "TC", tipo_codigo: "P" }, { fecha_emision: "2022-01-10", fecha_proxima_revision: "2025-01-10" });
const RN = await vigente({ clave: `FX-TCP-K${s}`, titulo: `Procedimiento en renovación ${s}`, area_codigo: "TC", tipo_codigo: "P" }, { fecha_emision: "2025-01-10", fecha_proxima_revision: enDias(12) });
const renov = await api("POST", `/sgc/documentos/${RN.id}/renovar`, { revisor_id: id.gabriela, autorizador_id: id.patricia }, t.ana);
const PRU = await vigente({ clave: `FX-TCP-U${s}`, titulo: `Procedimiento por renovar en pantalla ${s}`, area_codigo: "TC", tipo_codigo: "P" }, { fecha_emision: "2025-01-10", fecha_proxima_revision: enDias(14) });
// RA: vigente con la revisión 2 en borrador (fecha límite en 20 días): avisos, motivo y reasignar.
const RA = await vigente({ clave: `FX-TCP-A${s}`, titulo: `Procedimiento con revisión en curso ${s}`, area_codigo: "TC", tipo_codigo: "P" });
const RA2 = (await api("POST", `/sgc/documentos/${RA.id}/revisiones`, { motivo_cambio: "Actualización con fecha límite", ...RESP, fecha_limite: enDias(20) }, t.ana)).data?.revision_id;
const RV = await ficha({ clave: `FX-TCP-E${s}`, titulo: `Procedimiento en revisión ${s}`, area_codigo: "TC", tipo_codigo: "P" });
const okRV = await hasta(RV.revision_id, "en_revision");
const AU = await ficha({ clave: `FX-TCP-T${s}`, titulo: `Procedimiento por autorizar ${s}`, area_codigo: "TC", tipo_codigo: "P" });
const okAU = await hasta(AU.revision_id, "en_autorizacion");
const AZ = await ficha({ clave: `FX-GCP-Z${s}`, titulo: `Procedimiento por publicar ${s}`, area_codigo: "GC", tipo_codigo: "P" });
const okAZ = await hasta(AZ.revision_id, "autorizada");
// B: borrador de Luis con los datos del cambio y la fecha límite vencida (la API no acepta fechas pasadas).
const B = await ficha({ clave: `FX-TCP-B${s}`, titulo: `Borrador atrasado ${s}`, area_codigo: "TC", tipo_codigo: "P" });
await api("PUT", `/sgc/revisiones/${B.revision_id}`, CAMBIO, t.luis);
ejecutar("UPDATE sgc_revisiones SET fecha_limite = ? WHERE id = ?", enDias(-3), B.revision_id);
// OB: obsolescencia pendiente (la aprueba otra persona); OBX: ya obsoleto.
const OB = await vigente({ clave: `FX-TCP-O${s}`, titulo: `Procedimiento por retirar ${s}`, area_codigo: "TC", tipo_codigo: "P" });
const obsOB = await api("POST", `/sgc/documentos/${OB.id}/obsoletar`, { motivo: "Se retira el procedimiento" }, t.ana, SIN_APROBAR);
const OBX = await vigente({ clave: `FX-TCP-X${s}`, titulo: `Procedimiento ya retirado ${s}`, area_codigo: "TC", tipo_codigo: "P" });
await api("POST", `/sgc/documentos/${OBX.id}/obsoletar`, { motivo: "Se retiró el procedimiento" }, t.ana);
const NR = await vigente({ clave: `FX-TCI-N${s}`, titulo: `Instrucción por actualizar ${s}`, area_codigo: "TC", tipo_codigo: "I" });
const CI = await ficha({ clave: `FX-TCP-C${s}`, titulo: `Procedimiento de carga inicial ${s}`, area_codigo: "TC", tipo_codigo: "P" });
// E: externo de Ana con Ricardo como responsable de seguimiento.
const IDE = `NMX-COB-${s}`;
let E = null;
{
  const fd = new FormData();
  for (const [k, v] of Object.entries({ identificador: IDE, titulo: `Norma de cobertura ${s}`, area_codigo: "GC", tipo_codigo: "R", fuente: "IMNC", version_fecha: "2018", enlace: "https://www.imnc.org.mx", responsable_id: id.ricardo, ultima_verificacion: HOY, proxima_revision: enDias(365) })) fd.append(k, String(v));
  fd.append("archivo_pdf", new Blob([await pdfConTexto(1, `Norma ${s}`)]), "norma.pdf");
  E = (await api("POST", "/sgc/externos", fd, t.ana)).data?.id;
}
// Solicitudes: nuevo (por aceptar), nuevo (por rechazar) y cambio (con documento).
const SN = await solicitud({ tipo: "nuevo", area_codigo: "GC", tipo_codigo: "F", titulo_propuesto: `Formato propuesto ${s}`, justificacion: `Se necesita un formato de control ${s}` }, "mariana");
// Las de la pantalla de Solicitudes se crean justo antes de usarlas: la lista solo trae las 500 más recientes.
let SN2 = null, SR = null, SC = null;
// Cuenta nueva que solo propone (Técnico Auxiliar): no tiene solicitudes.
const roles = (await api("GET", "/admin/roles", undefined, t.qa)).data?.items || [];
const rolAux = roles.find((r) => r.nombre === "Técnico Auxiliar")?.id;
const nueva = { email: `sin.solicitudes.${s.toLowerCase()}@ficotox.local`, password: `Temporal-${s}-2026` };
const alta = await api("POST", "/admin/usuarios", { nombre: `Sin Solicitudes ${s}`, email: nueva.email, activo: true, rol_id: rolAux, departamento: "Laboratorio", password: nueva.password, motivo: "Alta de la prueba de cobertura" }, t.jorge);
ejecutar("UPDATE usuarios SET debe_cambiar_password = 0 WHERE email = ?", nueva.email);
const catalogos = (await api("GET", "/sgc/catalogos", undefined, t.ana)).data || {};
const nombre = Object.fromEntries((catalogos.personas || []).map((p) => [p.id, p.nombre]));
const rolAuditor = (catalogos.roles || []).find((r) => r.nombre === "Auditor Interno");

check(
  "(preparación) documentos, solicitudes, externo y cuenta de apoyo",
  [V, PR, PV, RN, PRU, RA, NR, OB, OBX].every((d) => d.ok) && [RV, AU, AZ, B, CI].every((d) => d.status === 201) && okRV && okAU && okAZ && !!RA2 && distV.status < 300 && renov.status === 201 && obsOB.status === 202 && !!E && !!SN && alta.status < 300 && !!rolAuditor,
  JSON.stringify({ dist: distV.status, renov: renov.status, obs: obsOB.status, E, SN, alta: alta.status, okRV, okAU, okAZ }),
);

/* ---------- Utilidades de pantalla ---------- */
const ventana = (page) => page.getByTestId("ventana-formulario");
const cerrada = (page) => ventana(page).waitFor({ state: "detached", timeout: 30_000 });
const listo = (page) => page.locator('[data-testid="sgc-ficha"]:not([aria-busy="true"])').waitFor();
const marcado = (page, campo, ms = 4000) => esperar(async () => (await page.locator(`#${campo}`).first().getAttribute("aria-invalid").catch(() => null)) === "true", ms).then(Boolean);
/* Pulsa «Guardar» (testid) y espera el resumen de validación; dice qué campos quedaron marcados y lo cierra. */
async function intentar(page, testid, campos = []) {
  await page.getByTestId(testid).click();
  const alerta = page.locator('[role="alertdialog"][data-validacion]');
  await alerta.waitFor();
  const tipo = await alerta.getAttribute("data-validacion");
  const texto = (await alerta.innerText()).replace(/\s+/g, " ");
  const marcados = {};
  for (const c of campos) marcados[c] = await marcado(page, c);
  await entendido(page);
  // Al cerrar, la pantalla lleva el foco al campo marcado (hasta 380 ms después y con desplazamiento suave).
  await page.waitForTimeout(700);
  return { tipo, texto, marcados, todos: campos.every((c) => marcados[c]) };
}
/* «Confirma tu identidad» con la contraseña de quien actúa. */
const clave = async (page, quien) => {
  await page.locator("#reauth-password").waitFor();
  await contrasena(page, pw(quien));
};
const masOpciones = async (alcance, nombreBoton = /^Más opciones/) => {
  const b = alcance.getByRole("button", { name: nombreBoton }).first();
  if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
};
/* Teclea una fecha como una persona (dd/mm/aaaa; "" la borra) y sale del campo con Tab; comprueba que se vea. */
const fecha = async (page, campo, iso) => {
  const el = page.locator(`#${campo}`);
  await el.click({ clickCount: 3 });
  await el.press("Backspace");
  if (iso) await el.pressSequentially(fmt(iso).replace(/\//g, ""), { delay: 15 });
  await el.press("Tab");
  const visto = await el.inputValue();
  if (visto !== (iso ? fmt(iso) : "")) throw new Error(`#${campo} muestra «${visto}» en lugar de ${iso || "vacío"}`);
};
const tarea = (page, grupo, texto) => page.locator(`[data-testid="bandeja-grupo"][data-grupo="${grupo}"] [data-testid="bandeja-tarea"]`).filter({ hasText: texto });
const etiquetasRadio = (page) => ventana(page).locator('input[type="radio"][name="decision"]').evaluateAll((xs) => xs.map((x) => x.closest("label")?.querySelector("span > span")?.textContent?.trim() || ""));
const opciones = (page, campo) => page.locator(`#${campo} option`).evaluateAll((xs) => xs.map((x) => ({ value: x.value, texto: (x.textContent || "").trim() })));
const nRevisiones = (docId) => Number(fila("SELECT COUNT(*) AS n FROM sgc_revisiones WHERE documento_id = ?", docId)?.n || 0);

/* ---------- Inicio ---------- */
await paso("ana", "inicio: carpetas, indicadores y buscador", async (page) => {
  await page.goto(`${BASE_WEB}/documentos`);
  await page.getByTestId("sgc-carpetas").waitFor();
  const titulo = (await page.locator("#carpetas-titulo").innerText()).trim();
  const carpetas = await page.locator('section[aria-labelledby="carpetas-titulo"] [data-testid="sgc-carpeta"]').count();
  check("[cob:D:D-023] inicio: «Carpetas por gestión» titula la sección con las carpetas de cada área", titulo === "Carpetas por gestión" && carpetas >= 6, `${titulo} · ${carpetas}`);
  check("[cob:D:D-014] inicio (Mejora Continua): sin el aviso «Vista de diagnóstico»", (await page.getByText("Vista de diagnóstico").count()) === 0);
  const href = (k) => page.locator(`[data-testid="sgc-indicador"][data-indicador="${k}"]`).getAttribute("href");
  const hrefs = { en_curso: await href("en_curso"), proximos: await href("proximos_revision"), lecturas: await href("lecturas_mias") };
  check("[cob:D:D-021] indicador «Próximos a revisar» lleva a la carpeta filtrada por pendientes de revisión", hrefs.proximos === "/documentos/explorar?estado=pendiente_revision", hrefs.proximos);
  check("[cob:D:D-022] indicador «Mis lecturas pendientes» lleva a la Bandeja en #lecturas", hrefs.lecturas === "/documentos/bandeja#lecturas", hrefs.lecturas);
  await page.locator('[data-testid="sgc-indicador"][data-indicador="en_curso"]').click();
  await page.waitForURL((u) => u.pathname === "/documentos/explorar" && u.searchParams.get("estado") === "en_curso");
  await page.getByRole("button", { name: /^Filtros/ }).waitFor();
  check("[cob:D:D-020] indicador «En revisión» abre la carpeta con el filtro de estado aplicado", hrefs.en_curso === "/documentos/explorar?estado=en_curso" && (await page.getByRole("button", { name: /^Filtros/ }).getAttribute("aria-label")) === "Filtros (1 activos)", `${hrefs.en_curso} · ${await page.getByRole("button", { name: /^Filtros/ }).getAttribute("aria-label")}`);
  await page.goto(`${BASE_WEB}/documentos`);
  await page.getByPlaceholder("Buscar por clave, título o palabra clave").fill(V.clave);
  const enlace = page.getByTestId("sgc-resultados").getByRole("link").filter({ hasText: V.clave });
  await enlace.waitFor();
  const resultados = await page.getByTestId("sgc-resultados").getByRole("link").count();
  await enlace.click();
  await page.waitForURL((u) => u.pathname === `/documentos/${V.id}`);
  await listo(page);
  check("[cob:D:D-017] buscador del inicio: el resultado (clave · título) abre la ficha del documento", resultados === 1 && (await page.getByTestId("sgc-clave").innerText()).trim() === V.clave, `${resultados} resultado(s)`);
});

await paso("jorge", "inicio: vista de diagnóstico", async (page) => {
  await page.goto(`${BASE_WEB}/documentos`);
  await page.getByTestId("sgc-carpetas").waitFor();
  const aviso = page.getByText("Vista de diagnóstico");
  await aviso.waitFor();
  const texto = await aviso.locator("xpath=ancestor::*[contains(., 'no abres sus archivos')][1]").innerText();
  check("[cob:D:D-014] inicio (Administrador técnico sin acciones documentales): aviso «Vista de diagnóstico» (solo metadatos)", /no abres sus archivos/.test(texto) && (await page.getByTestId("sgc-nueva-ficha").count()) === 0 && (await page.getByTestId("sgc-nueva-solicitud").count()) === 0, texto.replace(/\s+/g, " ").slice(0, 160));
});

/* ---------- Carpeta ---------- */
await paso("ana", "carpeta: buscador, filtros y próxima revisión", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/explorar?area=TC`);
  await page.getByTestId("sgc-tarjetas").waitFor();
  const buscar = page.getByPlaceholder("Buscar por clave, título o palabras clave");
  check("[cob:D:D-033] carpeta: sin texto no hay «Limpiar búsqueda»", (await page.getByRole("button", { name: "Limpiar búsqueda" }).count()) === 0);
  await buscar.fill(s);
  const tarjeta = (d) => page.locator(`[data-testid="sgc-tarjeta"][data-clave="${d.clave}"]`);
  await tarjeta(PR).waitFor();
  await page.waitForFunction((x) => [...document.querySelectorAll('[data-testid="sgc-tarjeta"]')].every((el) => (el.getAttribute("data-clave") || "").includes(x)), s, { timeout: 15_000 });
  const textoDe = async (d) => (await tarjeta(d).innerText()).replace(/\s+/g, " ");
  const [tPR, tPV, tV] = [await textoDe(PR), await textoDe(PV), await textoDe(V)];
  check("[cob:D:D-008] próxima revisión a 30 días o menos: «Pendiente de revisión» en la tarjeta", /Pendiente de revisión/.test(tPR) && !/vencida/.test(tPR), tPR);
  check("[cob:D:D-008] próxima revisión ya pasada: «Pendiente de revisión · vencida»", /Pendiente de revisión · vencida/.test(tPV), tPV);
  check("[cob:D:D-008] próxima revisión lejana (2028): sin la marca", !/Pendiente de revisión/.test(tV), tV);
  // Filtros: «Limpiar filtros» deshabilitado sin filtros; «Tipo documental» deja solo ese tipo.
  const filtros = page.getByRole("button", { name: /^Filtros/ });
  await filtros.click();
  const limpiar = page.getByRole("button", { name: "Limpiar filtros" });
  await limpiar.waitFor();
  const deshabilitadoAntes = await limpiar.isDisabled();
  const grupoTipo = page.locator('section[aria-label="Tipo documental"]');
  await grupoTipo.getByRole("switch", { name: /^I · / }).click();
  const habilitadoDespues = !(await limpiar.isDisabled());
  await page.keyboard.press("Escape");
  await page.waitForURL((u) => u.searchParams.get("tipo") === "I");
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="sgc-tarjeta"]')].every((el) => /^FX-..I-/.test(el.getAttribute("data-clave") || "")), null, { timeout: 15_000 });
  const claves = await page.getByTestId("sgc-tarjeta").evaluateAll((xs) => xs.map((x) => x.getAttribute("data-clave")));
  check("[cob:D:D-036] «Tipo documental» (I) deja solo instructivos y lo pone en la URL (?tipo=I)", claves.includes(V.clave) && claves.includes(NR.clave) && claves.every((c) => /^FX-..I-/.test(c)), claves.join(", "));
  check("[cob:D:D-034] el botón dice «Filtros (1 activos)» con un filtro", (await filtros.getAttribute("aria-label")) === "Filtros (1 activos)", await filtros.getAttribute("aria-label"));
  await filtros.click();
  await limpiar.click();
  await page.keyboard.press("Escape");
  await tarjeta(PR).waitFor();
  check("[cob:D:D-044] «Limpiar filtros»: deshabilitado sin filtros, activo con uno y al usarlo vuelven todos los tipos", deshabilitadoAntes && habilitadoDespues && (await filtros.getAttribute("aria-label")) === "Filtros" && !new URL(page.url()).searchParams.has("tipo"), `${deshabilitadoAntes} ${habilitadoDespues} ${await filtros.getAttribute("aria-label")}`);
  await page.getByRole("button", { name: "Limpiar búsqueda" }).click();
  await esperar(async () => (await buscar.inputValue()) === "" && (await page.getByRole("button", { name: "Limpiar búsqueda" }).count()) === 0);
  check("[cob:D:D-033] «Limpiar búsqueda» aparece con texto y lo borra", (await buscar.inputValue()) === "" && (await page.getByRole("button", { name: "Limpiar búsqueda" }).count()) === 0);
});

/* ---------- Ficha ---------- */
await paso("luis", "ficha: acción principal del elaborador y ?leer=1", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${B.id}`);
  const p = await principal(page);
  check("[cob:D:D-053] elaborador en borrador con datos del cambio: la acción principal es «Enviar a revisión»", p === "sgc-enviar-revision", String(p));
  await page.goto(`${BASE_WEB}/documentos/${V.id}?leer=1`);
  const acuse = page.locator("#acuse");
  await acuse.waitFor();
  const aLaVista = await esperar(() => acuse.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; }), 8000);
  check("[cob:D:D-101] [cob:D:D-198] ?leer=1 desplaza al acuse (#acuse) de la lectura pendiente", !!aLaVista && (await acuse.getAttribute("data-testid")) === "acuse-pendiente");
});

await paso("ana", "ficha: revisión en curso, motivo y pestañas", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${RA.id}`);
  await listo(page);
  const avisos = (await page.getByTestId("sgc-avisos").innerText()).replace(/\s+/g, " ");
  check("[cob:D:D-083] aviso «Revisión 2 en curso» (la 1 sigue vigente)", /Revisión 2 en curso\. La revisión 1 sigue vigente mientras tanto/.test(avisos), avisos);
  check("[cob:D:D-088] con trabajo en curso abre la pestaña Revisiones (sgc-pestana-revisiones)", (await page.getByTestId("sgc-pestana-revisiones").isVisible()) && (await page.getByRole("tab", { name: "Revisiones" }).getAttribute("aria-selected")) === "true");
  const texto = await motivo(page, "sgc-nueva-revision");
  const deshabilitada = await page.getByRole("menu").getByTestId("sgc-nueva-revision").getAttribute("aria-disabled");
  await cerrarMenu(page);
  check("[cob:D:D-078] «Nueva revisión» deshabilitada en ⋯ con su motivo visible", /Ya hay una revisión en curso \(revisión 2/.test(texto) && deshabilitada === "true", `${texto} · ${deshabilitada}`);
  await page.goto(`${BASE_WEB}/documentos/${V.id}`);
  await listo(page);
  await page.getByRole("tab", { name: "Lecturas" }).click();
  const panel = page.getByTestId("sgc-pestana-lecturas");
  await panel.waitFor();
  check("[cob:D:D-089] pestaña Lecturas (sgc-pestana-lecturas) con la distribución", (await panel.isVisible()) && !(await page.getByTestId("sgc-pestana-detalles").isVisible()));
  const personas = await page.getByTestId("dist-lecturas").getByTestId("dist-persona-estado").evaluateAll((xs) => xs.map((x) => `${x.textContent?.replace(/\s+/g, " ").trim()}|${x.getAttribute("data-leido")}`));
  check("[cob:D:D-205] lecturas por persona: Luis y Mariana pendientes", [nombre[id.luis], nombre[id.mariana]].every((n) => personas.some((p) => p.startsWith(n) && /Pendiente/.test(p) && p.endsWith("|0"))), personas.join(" / "));
});

/* ---------- Bandeja y diálogos de decisión ---------- */
await paso("gabriela", "bandeja del revisor, ?accion= y opciones de decisión", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/bandeja`);
  await page.getByTestId("bandeja-grupo").first().waitFor();
  const rv = tarea(page, "revisar", RV.clave);
  check("[cob:D:D-240] Bandeja: grupo «Por revisar» con la tarea del revisor asignado", (await rv.count()) === 1 && (await rv.getByTestId("bandeja-accion").innerText()).trim() === "Revisar");
  const rn = tarea(page, "renovacion", RN.clave);
  check("[cob:D:D-243] Bandeja: grupo «Renovaciones» con «Confirmar vigencia» para el revisor de la renovación", (await rn.count()) === 1 && (await rn.getByTestId("bandeja-accion").innerText()).trim() === "Confirmar vigencia");
  await rv.getByTestId("bandeja-accion").click();
  await ventana(page).waitFor();
  const url = new URL(page.url());
  const radios = await etiquetasRadio(page);
  check("[cob:D:D-100] ?accion=sgc-revisar abre la ventana de la decisión y el parámetro se quita de la URL", url.pathname === `/documentos/${RV.id}` && !url.searchParams.has("accion") && /Revisar/.test(await ventana(page).innerText()), page.url());
  check("[cob:D:D-103] revisor: opciones Aceptar · Devolver · Rechazar", radios.join("|") === "Aceptar|Devolver|Rechazar", radios.join("|"));
  await page.keyboard.press("Escape");
  await ventana(page).waitFor({ state: "detached" });
  await page.reload();
  await listo(page);
  await page.waitForTimeout(1500);
  check("[cob:D:D-100] al recargar no se vuelve a abrir la ventana (la acción se abre una sola vez)", (await ventana(page).count()) === 0);
  await page.goto(`${BASE_WEB}/documentos/${RN.id}`);
  await (await accion(page, "sgc-renovacion-revisar")).click();
  await ventana(page).waitFor();
  const ren = await etiquetasRadio(page);
  check("[cob:D:D-103] revisor de la renovación: opciones Confirmar vigencia · Rechazar", ren.join("|") === "Confirmar vigencia|Rechazar", ren.join("|"));
  await page.keyboard.press("Escape");
});

await paso("patricia", "bandeja de la autorizadora y opciones de autorizar", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/bandeja`);
  await page.getByTestId("bandeja-grupo").first().waitFor();
  const au = tarea(page, "autorizar", AU.clave);
  check("[cob:D:D-239] Bandeja: grupo «Por autorizar» con la tarea de la autorizadora", (await au.count()) === 1 && (await au.getByTestId("bandeja-accion").innerText()).trim() === "Autorizar");
  const ob = tarea(page, "obsolescencia", OB.clave);
  check("[cob:D:D-245] Bandeja: grupo «Obsolescencias por aprobar» con la solicitud del segundo usuario", (await ob.count()) === 1 && (await ob.getByTestId("bandeja-accion").innerText()).trim() === "Ver solicitud");
  await page.goto(`${BASE_WEB}/documentos/${AU.id}`);
  await (await accion(page, "sgc-autorizar")).click();
  await ventana(page).waitFor();
  const radios = await etiquetasRadio(page);
  check("[cob:D:D-103] autorizador: opciones Autorizar · Devolver · Rechazar", radios.join("|") === "Autorizar|Devolver|Rechazar", radios.join("|"));
  await page.keyboard.press("Escape");
});

await paso("luis", "bandeja del elaborador con fecha vencida", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/bandeja`);
  await page.getByTestId("bandeja-grupo").first().waitFor();
  const b = tarea(page, "elaborar", B.clave);
  check("[cob:D:D-241] Bandeja: grupo «Borradores por elaborar o corregir» con el borrador del elaborador", (await b.count()) === 1 && (await b.getByTestId("bandeja-accion").innerText()).trim() === "Abrir borrador");
  const vencida = b.getByTestId("bandeja-vencida");
  check("[cob:D:D-249] marca «Venció el …» cuando la fecha límite ya pasó", (await vencida.count()) === 1 && (await vencida.innerText()).includes(`Venció el ${fmt(enDias(-3))}`), (await vencida.innerText().catch(() => "")).trim());
});

await paso("ana", "bandeja de Mejora Continua (y grupo «Otras»)", async (page) => {
  // El servidor solo emite tipos conocidos: se agrega a su respuesta uno nuevo para ver el grupo de respaldo.
  await page.route(/\/api\/sgc\/bandeja(\?|$)/, async (route) => {
    const r = await route.fetch();
    const j = await r.json();
    j.items.push({ clave: `prueba:${s}`, tipo: "tarea_nueva", accion: "Tarea de un tipo nuevo", papel: "Mejora Continua", documento_id: null, clave_documento: null, titulo: `Tarea sin grupo ${s}`, revision: null, fecha_limite: null, vencida: false, desde: null, href: "/documentos" });
    j.total += 1;
    await route.fulfill({ response: r, json: j });
  });
  await page.goto(`${BASE_WEB}/documentos/bandeja`);
  await page.getByTestId("bandeja-grupo").first().waitFor();
  const az = tarea(page, "publicar", AZ.clave);
  check("[cob:D:D-238] Bandeja: grupo «Por publicar» con la revisión autorizada", (await az.count()) === 1 && (await az.getByTestId("bandeja-accion").innerText()).trim() === "Publicar");
  const sn = tarea(page, "solicitud", `Formato propuesto ${s}`);
  check("[cob:D:D-242] Bandeja: grupo «Solicitudes por atender» con la solicitud pendiente", (await sn.count()) === 1 && (await sn.getByTestId("bandeja-accion").innerText()).trim() === "Atender");
  const pr = tarea(page, "periodica", PR.clave);
  check("[cob:D:D-244] Bandeja: grupo «Revisiones periódicas» con el documento a menos de 30 días", (await pr.count()) === 1 && (await pr.getByTestId("bandeja-accion").innerText()).trim() === "Ver documento");
  const otra = tarea(page, "otras", `Tarea sin grupo ${s}`);
  check("[cob:D:D-246] Bandeja: una tarea de tipo no previsto cae en «Otras tareas»", (await otra.count()) === 1 && /Otras tareas/i.test(await page.locator('[data-testid="bandeja-grupo"][data-grupo="otras"] h2').textContent()));
});

/* ---------- Publicar ---------- */
await paso("ana", "publicar: fechas, comentario y distribución", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${AZ.id}`);
  await (await accion(page, "sgc-publicar")).click();
  await ventana(page).waitFor();
  await fecha(page, "pub-emision", "");
  const r1 = await intentar(page, "publicar-guardar", ["pub-emision"]);
  check("[cob:D:D-106] publicar sin fecha de emisión: se marca #pub-emision y no se publica", r1.todos && /fecha de emisión/.test(r1.texto) && fila("SELECT estado FROM sgc_revisiones WHERE id = ?", AZ.revision_id)?.estado === "autorizada", r1.texto);
  await fecha(page, "pub-emision", HOY);
  await masOpciones(ventana(page), /^Más opciones \(vigencia/);
  await fecha(page, "pub-vigencia", enDias(-5));
  const r2 = await intentar(page, "publicar-guardar", ["pub-vigencia"]);
  check("[cob:D:D-107] vigencia anterior a la emisión: se marca #pub-vigencia", r2.todos && /no puede empezar antes de la emisión/.test(r2.texto), r2.texto);
  await fecha(page, "pub-vigencia", HOY);
  await page.locator("#pub-comentario").fill(`Publicación de la prueba de cobertura ${s}`);
  await page.getByTestId("pub-distribucion").getByRole("switch", { name: /Definir la distribución/ }).click();
  await page.getByTestId("pub-distribucion").locator("label", { hasText: nombre[id.luis] }).getByTestId("dist-persona").check();
  await masOpciones(page.getByTestId("pub-distribucion"));
  await page.locator("#pub-punto").fill(`Mesa de pruebas ${s}`);
  await page.getByTestId("publicar-guardar").click();
  await clave(page, "ana");
  await cerrada(page);
  const rev = await esperar(() => fila("SELECT estado, fecha_vigencia FROM sgc_revisiones WHERE id = ? AND estado = 'vigente'", AZ.revision_id));
  const flujo = fila("SELECT comentario FROM sgc_flujo_acciones WHERE revision_id = ? AND accion = 'publicar' ORDER BY id DESC", AZ.revision_id);
  check("[cob:D:D-109] el comentario opcional al publicar queda en la línea de tiempo", rev?.fecha_vigencia === HOY && flujo?.comentario === `Publicación de la prueba de cobertura ${s}`, JSON.stringify({ rev, flujo }));
  const dist = fila("SELECT punto_uso, requiere_lectura FROM sgc_distribucion WHERE revision_id = ? AND usuario_id = ? AND retirado_en IS NULL", AZ.revision_id, id.luis);
  check("[cob:D:D-111] destinatarios al publicar (persona y punto de uso con prefijo pub)", dist?.punto_uso === `Mesa de pruebas ${s}` && Number(dist?.requiere_lectura) === 1, JSON.stringify(dist));
});

/* ---------- Reasignar ---------- */
await paso("ana", "reasignar responsables", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${RA.id}`);
  await (await accion(page, "sgc-reasignar")).click();
  await ventana(page).waitFor();
  await masOpciones(ventana(page));
  check("[cob:D:D-117] la fecha límite viene precargada con la de la revisión", (await page.locator("#rea-limite").inputValue()) === fmt(enDias(20)), await page.locator("#rea-limite").inputValue());
  await page.locator("#rea-motivo").fill("Cambio de responsables por carga de trabajo");
  await page.locator("#rea-elaborador").selectOption(String(id.gabriela));
  const r1 = await intentar(page, "reasignar-guardar", ["rea-elaborador"]);
  check("[cob:D:D-114] revisor igual al elaborador: «tres personas distintas»", r1.todos && /tres personas distintas/.test(r1.texto), r1.texto);
  await page.locator("#rea-elaborador").selectOption(String(id.luis));
  await page.locator("#rea-revisor").selectOption(String(id.ricardo));
  await page.locator("#rea-autorizador").selectOption("");
  const r2 = await intentar(page, "reasignar-guardar", ["rea-elaborador"]);
  check("[cob:D:D-113] [cob:D:D-115] sin autorizador: «Asigna a los tres responsables»", r2.todos && /Asigna a los tres responsables/.test(r2.texto), r2.texto);
  await page.locator("#rea-autorizador").selectOption(String(id.patricia));
  await page.locator("#rea-motivo").fill("abc");
  const r3 = await intentar(page, "reasignar-guardar", ["rea-motivo"]);
  check("[cob:D:D-116] motivo de menos de 5 caracteres: se marca #rea-motivo", r3.todos && /motivo/.test(r3.texto), r3.texto);
  await page.locator("#rea-motivo").fill("Cambio de responsables por carga de trabajo");
  await fecha(page, "rea-limite", enDias(-2));
  const r4 = await intentar(page, "reasignar-guardar", ["rea-limite"]);
  check("[cob:D:D-117] una fecha límite nueva ya pasada: el servidor la rechaza en #rea-limite y nada cambia", r4.tipo === "servidor" && r4.todos && Number(fila("SELECT revisor_id FROM sgc_revisiones WHERE id = ?", RA2)?.revisor_id) === id.gabriela, r4.texto);
  await fecha(page, "rea-limite", enDias(25));
  await page.getByTestId("reasignar-guardar").click();
  await cerrada(page);
  const rev = await esperar(() => fila("SELECT revisor_id, fecha_limite FROM sgc_revisiones WHERE id = ? AND revisor_id = ?", RA2, id.ricardo));
  check("[cob:D:D-113] [cob:D:D-114] [cob:D:D-115] [cob:D:D-117] reasignar con tres personas distintas guarda el revisor y la fecha límite", rev?.fecha_limite === enDias(25), JSON.stringify(rev));
});

/* ---------- Renovar ---------- */
await paso("ana", "renovar sin cambios: fechas", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${PRU.id}`);
  await (await accion(page, "sgc-renovar")).click();
  await ventana(page).waitFor();
  await page.locator("#ren-revisor").selectOption(String(id.gabriela));
  await page.locator("#ren-autorizador").selectOption(String(id.patricia));
  await masOpciones(ventana(page));
  await fecha(page, "ren-proxima", HOY);
  const r1 = await intentar(page, "renovar-guardar", ["ren-proxima"]);
  check("[cob:D:D-121] nueva próxima revisión que no es posterior a hoy: se marca #ren-proxima", r1.tipo === "servidor" && r1.todos && /posterior a hoy/.test(r1.texto), r1.texto);
  await fecha(page, "ren-proxima", enDias(800));
  await fecha(page, "ren-limite", enDias(-1));
  const r2 = await intentar(page, "renovar-guardar", ["ren-limite"]);
  check("[cob:D:D-122] fecha límite anterior a hoy: se marca #ren-limite", r2.tipo === "servidor" && r2.todos && /fecha límite/.test(r2.texto), r2.texto);
  check("[cob:D:D-121] [cob:D:D-122] …y no se inició ninguna renovación", !fila("SELECT id FROM sgc_renovaciones WHERE documento_id = ?", PRU.id));
  await page.keyboard.press("Escape");
});

/* ---------- Nueva ficha y editar metadatos ---------- */
await paso("ana", "nueva ficha y editar metadatos", async (page) => {
  const CLAVE = `FX-TCP-Y${s}`;
  await page.goto(`${BASE_WEB}/documentos/explorar?nueva=1`);
  await page.locator("#ficha-area").waitFor();
  await page.locator("#ficha-numero").fill("1a");
  const r1 = await intentar(page, "ficha-guardar", ["ficha-area", "ficha-archivos", "ficha-numero"]);
  check("[cob:D:D-126] sin área de gestión: se marca #ficha-area", r1.marcados["ficha-area"], r1.texto);
  check("[cob:D:D-134] sin archivo inicial: #ficha-archivos queda aria-invalid", r1.marcados["ficha-archivos"] && /archivo inicial/.test(r1.texto), r1.texto);
  check("[cob:D:D-131] número de revisión que no es entero de 0 a 999: se marca #ficha-numero", r1.marcados["ficha-numero"] && /0 a 999/.test(r1.texto), r1.texto);
  const conf = (await opciones(page, "ficha-confidencialidad")).map((o) => o.value);
  check("[cob:D:D-129] confidencialidad: uso interno, restringido y confidencial", conf.join("|") === "uso_interno|restringido|confidencial", conf.join("|"));
  await page.locator("#ficha-archivo-pdf").setInputFiles(TXT);
  const r2 = await intentar(page, "ficha-guardar", ["ficha-archivos"]);
  check("[cob:D:D-134] un .txt como PDF de consulta: #ficha-archivos marcado con «Formato no permitido»", r2.marcados["ficha-archivos"] && /Formato no permitido/.test(r2.texto), r2.texto);
  await page.locator("#ficha-archivo-pdf").setInputFiles([]);
  await masOpciones(ventana(page));
  check("[cob:D:D-138] «Origen» deshabilitado (aquí siempre interno)", (await page.locator("#ficha-origen").isDisabled()) && (await page.locator("#ficha-origen").inputValue()) === "interno");
  await page.locator("#ficha-area").selectOption("TC");
  await page.locator("#ficha-tipo").selectOption("P");
  await page.locator("#ficha-clave").fill(CLAVE);
  await page.locator("#ficha-confidencialidad").selectOption("restringido");
  await page.locator("#ficha-titulo").fill(`Procedimiento de pantalla ${s}`);
  await page.locator("#ficha-numero").fill("0");
  await page.locator("#ficha-archivo-fuente").setInputFiles(DOCX(`fuente-${s}.docx`));
  await page.locator("#ficha-proceso").fill("Extracción de toxinas");
  await page.locator("#ficha-palabras").fill(`cobertura, pantalla${s}`);
  await page.locator("#ficha-motivo-cambio").fill("Alta desde la pantalla");
  await page.locator("#ficha-descripcion").fill("Documento nuevo de la prueba de cobertura");
  await page.locator("#ficha-elaborador").selectOption(String(id.luis));
  await page.locator("#ficha-revisor").selectOption(String(id.gabriela));
  await page.locator("#ficha-autorizador").selectOption(String(id.patricia));
  await page.getByTestId("ficha-guardar").click();
  await page.waitForURL((u) => /^\/documentos\/\d+$/.test(u.pathname), { timeout: 30_000 });
  const doc = fila("SELECT id, proceso, palabras_clave, confidencialidad FROM sgc_documentos WHERE clave = ?", CLAVE);
  const rev = doc ? fila("SELECT id, numero, motivo_cambio, descripcion_cambio FROM sgc_revisiones WHERE documento_id = ?", doc.id) : null;
  const archivos = rev ? filas("SELECT tipo, extension FROM sgc_archivos WHERE revision_id = ?", rev.id) : [];
  check("[cob:D:D-133] solo con el archivo fuente (.docx) se crea la ficha", archivos.length === 1 && archivos[0].tipo === "fuente" && archivos[0].extension === "docx", JSON.stringify(archivos));
  check("[cob:D:D-129] [cob:D:D-131] la ficha queda «restringido» y con la revisión 0", doc?.confidencialidad === "restringido" && Number(rev?.numero) === 0, JSON.stringify({ doc, rev }));
  check("[cob:D:D-135] [cob:D:D-137] proceso y palabras clave guardados", doc?.proceso === "Extracción de toxinas" && JSON.parse(doc?.palabras_clave || "[]").join("|") === `cobertura|pantalla${s}`, JSON.stringify(doc));
  check("[cob:D:D-139] [cob:D:D-140] motivo y descripción del cambio de la revisión inicial", rev?.motivo_cambio === "Alta desde la pantalla" && rev?.descripcion_cambio === "Documento nuevo de la prueba de cobertura", JSON.stringify(rev));
  if (!doc) return;
  await listo(page);
  await (await accion(page, "sgc-editar")).click();
  await ventana(page).waitFor();
  await page.locator("#ficha-titulo").fill(`Procedimiento de pantalla corregido ${s}`);
  await page.locator("#ficha-motivo").fill("abc");
  const r3 = await intentar(page, "ficha-guardar", ["ficha-motivo"]);
  check("[cob:D:D-144] editar con motivo de menos de 5 caracteres: se marca #ficha-motivo (y no hay #ficha-numero)", r3.todos && (await page.locator("#ficha-numero").count()) === 0, r3.texto);
  await page.locator("#ficha-motivo").fill("Corrección del título en la pantalla");
  await page.getByTestId("ficha-guardar").click();
  await cerrada(page);
  const audit = fila("SELECT motivo FROM auditoria WHERE entidad = 'sgc_documentos' AND entidad_id = ? ORDER BY id DESC", String(doc.id));
  check("[cob:D:D-144] con motivo válido se guarda y el motivo queda en la bitácora", fila("SELECT titulo FROM sgc_documentos WHERE id = ?", doc.id)?.titulo === `Procedimiento de pantalla corregido ${s}` && audit?.motivo === "Corrección del título en la pantalla", JSON.stringify(audit));
});

/* ---------- Nueva revisión, su edición y archivo fuente ---------- */
let NR2 = null;
await paso("ana", "nueva revisión y su edición", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${NR.id}`);
  await (await accion(page, "sgc-nueva-revision")).click();
  await ventana(page).waitFor();
  const seccion = page.locator('section[aria-labelledby="rev-resp-titulo"]');
  check("[cob:D:D-146] «Responsables» (#rev-resp-titulo) titula los tres selectores", (await page.locator("#rev-resp-titulo").innerText()).trim() === "Responsables" && (await seccion.locator("#rev-elaborador, #rev-revisor, #rev-autorizador").count()) === 3);
  await page.locator("#rev-motivo").fill("Actualización por la prueba de cobertura");
  await page.locator("#rev-elaborador").selectOption(String(id.luis));
  await page.locator("#rev-revisor").selectOption(String(id.gabriela));
  await page.locator("#rev-autorizador").selectOption(String(id.patricia));
  await masOpciones(ventana(page));
  await fecha(page, "rev-limite", enDias(-3));
  const r1 = await intentar(page, "revision-guardar", ["rev-limite"]);
  check("[cob:D:D-153] fecha límite anterior a hoy al abrir la revisión: se rechaza y no se abre", r1.tipo === "servidor" && /fecha límite/.test(r1.texto) && nRevisiones(NR.id) === 1, `${r1.texto} · ${nRevisiones(NR.id)}`);
  check("[cob:D:D-153] …y el error del servidor marca el campo #rev-limite", r1.marcados["rev-limite"], r1.texto);
  await fecha(page, "rev-limite", enDias(15));
  await page.getByTestId("revision-guardar").click();
  await cerrada(page);
  NR2 = (await esperar(() => fila("SELECT id, fecha_limite FROM sgc_revisiones WHERE documento_id = ? AND estado = 'borrador'", NR.id))) || null;
  check("[cob:D:D-153] con fecha límite válida se abre la revisión en borrador con esa fecha", NR2?.fecha_limite === enDias(15), JSON.stringify(NR2));
  if (!NR2) return;
  await listo(page);
  await (await accion(page, "sgc-editar-revision")).click();
  await ventana(page).waitFor();
  await masOpciones(ventana(page));
  check("[cob:D:D-153] al editar ya no se ofrece la fecha límite", (await page.locator("#rev-limite").count()) === 0);
  await fecha(page, "rev-vigencia", enDias(30));
  await fecha(page, "rev-proxima", "2029-06-30");
  await page.locator("#rev-ubicacion").fill("Archivo de calidad, gaveta 2");
  await page.locator("#rev-conservacion").fill("5 años después de quedar obsoleta");
  await page.getByTestId("revision-guardar").click();
  await cerrada(page);
  const r = await esperar(() => fila("SELECT fecha_vigencia, fecha_proxima_revision, ubicacion_historica, regla_conservacion FROM sgc_revisiones WHERE id = ? AND ubicacion_historica IS NOT NULL", NR2.id));
  check("[cob:D:D-155] [cob:D:D-156] editar el borrador guarda el inicio de vigencia y la próxima revisión", r?.fecha_vigencia === enDias(30) && r?.fecha_proxima_revision === "2029-06-30", JSON.stringify(r));
  check("[cob:D:D-157] [cob:D:D-158] …y la ubicación histórica y el tiempo de conservación", r?.ubicacion_historica === "Archivo de calidad, gaveta 2" && r?.regla_conservacion === "5 años después de quedar obsoleta", JSON.stringify(r));
});

await paso("luis", "cargar el archivo fuente del borrador", async (page) => {
  if (!NR2) throw new Error("sin la revisión 2 de la prueba anterior");
  await page.goto(`${BASE_WEB}/documentos/${NR.id}`);
  await (await accion(page, "sgc-subir-archivo")).click();
  await ventana(page).waitFor();
  const ops = await opciones(page, "archivo-tipo");
  const inicial = await page.locator("#archivo-tipo").inputValue();
  await page.locator("#archivo-tipo").selectOption("fuente");
  await ventana(page).getByLabel("Elegir archivo").setInputFiles(DOCX(`fuente-rev2-${s}.docx`));
  await page.getByTestId("archivo-guardar").click();
  await cerrada(page);
  const archivo = await esperar(() => fila("SELECT tipo, extension FROM sgc_archivos WHERE revision_id = ? AND tipo = 'fuente'", NR2.id));
  check("[cob:D:D-160] «Tipo de archivo»: PDF de consulta o archivo fuente; con «fuente» se carga el .docx", ops.length === 2 && /^PDF de consulta/.test(ops[0].texto) && /^Archivo fuente/.test(ops[1].texto) && inicial === "pdf" && archivo?.extension === "docx", `${JSON.stringify(ops)} ${inicial} ${JSON.stringify(archivo)}`);
});

/* ---------- Registrar vigente (carga inicial) ---------- */
await paso("ana", "registrar vigente (carga inicial)", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${CI.id}`);
  await (await accion(page, "sgc-registrar-vigente")).click();
  await ventana(page).waitFor();
  await fecha(page, "rev-emision", "2025-03-01");
  await masOpciones(ventana(page));
  await fecha(page, "rev-proxima", "2025-02-01");
  const r1 = await intentar(page, "vigente-guardar", ["rev-proxima"]);
  check("[cob:D:D-165] próxima revisión que no es posterior a la vigencia: se marca #rev-proxima", r1.todos && /posterior a la fecha de vigencia/.test(r1.texto), r1.texto);
  await fecha(page, "rev-proxima", "");
  await page.locator("#rev-comentario").fill(`Autorización original en el expediente ${s}`);
  await page.getByTestId("vigente-guardar").click();
  await clave(page, "ana");
  await cerrada(page);
  const rev = await esperar(() => fila("SELECT fecha_emision, fecha_vigencia, fecha_proxima_revision FROM sgc_revisiones WHERE id = ? AND estado = 'vigente'", CI.revision_id));
  check("[cob:D:D-164] [cob:D:D-165] sin vigencia ni próxima: vigencia = emisión y próxima = emisión + 3 años", rev?.fecha_vigencia === "2025-03-01" && rev?.fecha_proxima_revision === "2028-03-01", JSON.stringify(rev));
  const flujo = fila("SELECT comentario FROM sgc_flujo_acciones WHERE revision_id = ? AND accion = 'registrar_vigente'", CI.revision_id);
  check("[cob:D:D-166] el comentario de la carga inicial queda registrado", flujo?.comentario === `Autorización original en el expediente ${s}`, JSON.stringify(flujo));
});

/* ---------- Nueva solicitud ---------- */
await paso("luis", "nueva solicitud: tipo, documento y necesidad", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/solicitudes?nueva=1`);
  await ventana(page).waitFor();
  const nuevo = page.locator('input[type="radio"][name="sol-clase"]').nth(0);
  const cambio = page.locator('input[type="radio"][name="sol-clase"]').nth(1);
  check("[cob:D:D-168] «Documento nuevo» elegido por omisión: pide área, tipo y título", (await nuevo.isChecked()) && (await page.locator("#sol-area").count()) === 1 && (await page.locator("#sol-documento").count()) === 0);
  await page.getByText("Cambio a un documento", { exact: true }).click();
  await page.locator("#sol-documento").waitFor();
  await page.waitForFunction((c) => [...document.querySelectorAll("#sol-documento option")].some((o) => (o.textContent || "").includes(c)), V.clave, { timeout: 20_000 });
  check("[cob:D:D-169] «Cambio a un documento» cambia el formulario al selector del documento", (await cambio.isChecked()) && (await page.locator("#sol-area").count()) === 0);
  const ops = (await opciones(page, "sol-documento")).map((o) => o.texto);
  check("[cob:D:D-173] el selector ofrece los documentos visibles y no los obsoletos", ops.some((x) => x.startsWith(V.clave)) && !ops.some((x) => x.startsWith(OBX.clave)), `${ops.length} opciones`);
  check("[cob:D:D-173] el selector no ofrece documentos externos (no pasan por el flujo: el servidor los rechaza con 409)", !ops.some((x) => x.startsWith(IDE)), ops.filter((x) => x.startsWith("NMX")).slice(0, 3).join(" | "));
  await page.locator("#sol-documento").selectOption(String(V.id));
  await page.locator("#sol-justificacion").fill(`Actualizar la instrucción con el nuevo equipo ${s}`);
  await masOpciones(ventana(page));
  await page.locator("#sol-necesidad").fill(`Antes de la auditoría de diciembre ${s}`);
  await page.getByTestId("solicitud-guardar").click();
  await cerrada(page);
  const sol = await esperar(() => fila("SELECT tipo, documento_id, necesidad FROM sgc_solicitudes WHERE solicitante_id = ? AND necesidad = ?", id.luis, `Antes de la auditoría de diciembre ${s}`));
  check("[cob:D:D-175] la necesidad opcional se guarda con la solicitud de cambio", sol?.tipo === "cambio" && Number(sol?.documento_id) === V.id, JSON.stringify(sol));
});

/* ---------- Solicitudes (Mejora Continua) ---------- */
await paso("ana", "solicitudes: buscar, filtrar, abrir, rechazar y aceptar", async (page) => {
  SN2 = await solicitud({ tipo: "nuevo", area_codigo: "GC", tipo_codigo: "F", titulo_propuesto: `Formato por aceptar ${s}`, justificacion: `Se necesita un formato de control ${s}` }, "mariana");
  SR = await solicitud({ tipo: "nuevo", area_codigo: "GC", tipo_codigo: "R", titulo_propuesto: `Registro por rechazar ${s}`, justificacion: `Registro que ya existe con otro nombre ${s}` }, "mariana");
  SC = await solicitud({ tipo: "cambio", documento_id: V.id, justificacion: `Actualizar la instrucción ${s} con el equipo nuevo` }, "luis");
  check("(preparación) solicitudes de la pantalla", !!SN2 && !!SR && !!SC);
  await page.goto(`${BASE_WEB}/documentos/solicitudes`);
  await page.locator(`[data-solicitud="${SN2}"]`).waitFor();
  await page.getByPlaceholder("Buscar por título, clave o solicitante").fill(s);
  const todas = (await api("GET", "/sgc/solicitudes", undefined, t.ana)).data?.items || [];
  const esperadas = todas.filter((x) => x.estado === "pendiente" && [x.titulo_propuesto, x.documento_titulo, x.documento_clave, x.justificacion, x.solicitante_nombre, `#${x.id}`].some((v) => String(v || "").toLowerCase().includes(s.toLowerCase()))).map((x) => Number(x.id)).sort((a, b) => a - b);
  const visibles = () => page.locator("[data-solicitud]").evaluateAll((xs) => xs.map((x) => Number(x.getAttribute("data-solicitud"))).sort((a, b) => a - b));
  await esperar(async () => (await visibles()).join() === esperadas.join(), 10_000);
  const ids = await visibles();
  check("[cob:D:D-265] el buscador deja las solicitudes que coinciden (título, clave, justificación…)", [SN2, SR, SC].every((x) => ids.includes(x)) && ids.length === esperadas.length, `${ids.join(",")} vs ${esperadas.join(",")}`);
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.locator('section[aria-label="Tipo de solicitud"]').getByRole("switch", { name: "Cambio a un documento" }).click();
  await page.keyboard.press("Escape");
  await page.locator(`[data-solicitud="${SN2}"]`).waitFor({ state: "detached" });
  const cambios = await page.locator("[data-solicitud]").evaluateAll((xs) => xs.map((x) => Number(x.getAttribute("data-solicitud"))));
  check("[cob:D:D-266] filtro «Tipo de solicitud»: solo los cambios", cambios.includes(SC) && !cambios.includes(SN2) && !cambios.includes(SR), cambios.join(","));
  // Cambio: aceptar no pide título ni confidencialidad.
  await page.locator(`[data-solicitud="${SC}"]`).getByTestId("sgc-solicitud-aceptar").click();
  await ventana(page).waitFor();
  await masOpciones(ventana(page));
  check("[cob:D:D-179] [cob:D:D-183] [cob:D:D-184] aceptar un cambio no pide título, confidencialidad ni propietario", (await page.locator("#acep-titulo, #acep-conf, #acep-propietario").count()) === 0);
  await page.keyboard.press("Escape");
  await ventana(page).waitFor({ state: "detached" });
  await page.getByRole("button", { name: `Más acciones de la solicitud ${SC}` }).click();
  await page.getByRole("menuitem", { name: "Abrir documento" }).click();
  await page.waitForURL((u) => u.pathname === `/documentos/${V.id}`);
  check("[cob:D:D-272] «Abrir documento» de una solicitud de cambio abre su ficha", true);
  await page.goto(`${BASE_WEB}/documentos/solicitudes`);
  await page.locator(`[data-solicitud="${SR}"]`).waitFor();
  await page.getByRole("button", { name: `Más acciones de la solicitud ${SR}` }).click();
  await page.getByTestId("sgc-solicitud-rechazar").click();
  await ventana(page).waitFor();
  check("[cob:D:D-270] «Rechazar» del menú abre la ventana de rechazo de esa solicitud", (await ventana(page).innerText()).includes(`Rechazar la solicitud #${SR}`));
  await page.locator("#rech-motivo").fill("abc");
  const r1 = await intentar(page, "rechazar-guardar", ["rech-motivo"]);
  check("[cob:D:D-188] motivo del rechazo de menos de 5 caracteres: se marca #rech-motivo y sigue pendiente", r1.todos && fila("SELECT estado FROM sgc_solicitudes WHERE id = ?", SR)?.estado === "pendiente", r1.texto);
  await page.locator("#rech-motivo").fill("Ya existe un registro equivalente");
  await page.getByTestId("rechazar-guardar").click();
  await cerrada(page);
  const sr = await esperar(() => fila("SELECT estado, comentario_resolucion FROM sgc_solicitudes WHERE id = ? AND estado = 'rechazada'", SR));
  check("[cob:D:D-188] [cob:D:D-270] con motivo válido la solicitud queda rechazada con su motivo", /Ya existe un registro equivalente/.test(sr?.comentario_resolucion || ""), JSON.stringify(sr));
  // Nuevo: título, confidencialidad y propietario.
  const CLAVE = `FX-GCF-S${s}`;
  await page.locator(`[data-solicitud="${SN2}"]`).getByTestId("sgc-solicitud-aceptar").click();
  await ventana(page).waitFor();
  const tituloInicial = await page.locator("#acep-titulo").inputValue();
  await page.locator("#acep-clave").fill(CLAVE);
  await page.locator("#acep-titulo").fill(`Formato aceptado ${s}`);
  await page.locator("#acep-elaborador").selectOption(String(id.luis));
  await page.locator("#acep-revisor").selectOption(String(id.gabriela));
  await page.locator("#acep-autorizador").selectOption(String(id.patricia));
  await masOpciones(ventana(page));
  const propietarioInicial = await page.locator("#acep-propietario").inputValue();
  await page.locator("#acep-conf").selectOption("restringido");
  await page.locator("#acep-propietario").selectOption(String(id.ricardo));
  await page.getByTestId("aceptar-guardar").click();
  await page.waitForURL((u) => /^\/documentos\/\d+$/.test(u.pathname), { timeout: 30_000 });
  const doc = fila("SELECT titulo, confidencialidad, propietario_id FROM sgc_documentos WHERE clave = ?", CLAVE);
  check("[cob:D:D-179] aceptar un nuevo: el título viene del propuesto y se guarda el corregido", tituloInicial === `Formato por aceptar ${s}` && doc?.titulo === `Formato aceptado ${s}`, `${tituloInicial} → ${doc?.titulo}`);
  check("[cob:D:D-183] la confidencialidad elegida al aceptar queda en la ficha", doc?.confidencialidad === "restringido", JSON.stringify(doc));
  check("[cob:D:D-184] el propietario se precarga con quien solicitó y se guarda el elegido", propietarioInicial === String(id.mariana) && Number(doc?.propietario_id) === id.ricardo, `${propietarioInicial} → ${doc?.propietario_id}`);
});

await paso(nueva, "solicitudes vacías de quien solo propone", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/solicitudes`);
  const vacio = page.getByText("No hay solicitudes pendientes");
  await vacio.waitFor();
  check("[cob:D:D-276] sin solicitudes: estado vacío «No hay solicitudes pendientes» con la invitación a proponer", (await page.locator("[data-solicitud]").count()) === 0 && (await page.getByText(/Propón un documento nuevo o un cambio/).count()) === 1);
});

/* ---------- Distribución: quitar y agregar ---------- */
await paso("ana", "distribución: quitar y agregar destinatarios", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${V.id}`);
  await listo(page);
  await page.getByRole("tab", { name: "Lecturas" }).click();
  const quitar = page.getByRole("button", { name: `Quitar ${nombre[id.mariana]}` });
  await quitar.waitFor();
  check("[cob:D:D-204] «Quitar» (dist-quitar) en cada destinatario para quien administra lecturas", (await quitar.getAttribute("data-testid")) === "dist-quitar");
  await quitar.click();
  await ventana(page).waitFor();
  await page.locator("#ret-motivo").fill("abc");
  const r1 = await intentar(page, "ret-guardar", ["ret-motivo"]);
  check("[cob:D:D-196] motivo de menos de 5 caracteres al quitar: se marca #ret-motivo", r1.todos, r1.texto);
  await page.locator("#ret-motivo").fill("Ya no trabaja en el área de extracción");
  await page.getByTestId("ret-guardar").click();
  await clave(page, "ana");
  await cerrada(page);
  const fuera = await esperar(() => fila("SELECT retirado_en FROM sgc_distribucion WHERE revision_id = ? AND usuario_id = ? AND retirado_en IS NOT NULL", V.revision_id, id.mariana));
  check("[cob:D:D-196] [cob:D:D-204] con motivo válido (y contraseña) el destinatario queda retirado", !!fuera?.retirado_en && !!fila("SELECT id FROM sgc_distribucion WHERE revision_id = ? AND usuario_id = ? AND retirado_en IS NULL", V.revision_id, id.luis));
  await listo(page);
  await (await accion(page, "dist-agregar")).click();
  await ventana(page).waitFor();
  const auditor = ventana(page).locator("label", { hasText: rolAuditor.nombre }).getByTestId("dist-rol");
  const deshabilitado = await auditor.isDisabled();
  await masOpciones(ventana(page));
  const interruptor = ventana(page).getByRole("switch", { name: /Requiere confirmación de lectura/ });
  const antes = await interruptor.getAttribute("aria-checked");
  await interruptor.click();
  check("[cob:D:D-193] con «Requiere confirmación de lectura» un rol que no puede confirmar está deshabilitado; al apagarlo se habilita", antes === "true" && deshabilitado && (await interruptor.getAttribute("aria-checked")) === "false" && !(await auditor.isDisabled()));
  await auditor.check();
  await page.locator("#dist-punto").fill(`Sala de consulta ${s}`);
  await page.locator("#dist-motivo").fill("Consulta para la auditoría interna");
  await page.getByTestId("dist-guardar").click();
  await clave(page, "ana");
  await cerrada(page);
  const nuevo = await esperar(() => fila("SELECT punto_uso, requiere_lectura FROM sgc_distribucion WHERE revision_id = ? AND rol_id = ? AND retirado_en IS NULL", V.revision_id, rolAuditor.id));
  check("[cob:D:D-190] [cob:D:D-192] el rol elegido (dist-rol) queda como destinatario con su punto de uso", nuevo?.punto_uso === `Sala de consulta ${s}`, JSON.stringify(nuevo));
  check("[cob:D:D-193] …solo de consulta (sin lectura requerida)", Number(nuevo?.requiere_lectura) === 0, JSON.stringify(nuevo));
});

/* ---------- Externos ---------- */
await paso("ana", "registrar externo: PDF, última verificación y opcionales", async (page) => {
  const IDN = `NMX-UI-${s}-2020`;
  await page.goto(`${BASE_WEB}/documentos/externos`);
  await page.getByTestId("ext-registrar").click();
  await ventana(page).waitFor();
  await page.locator("#ext-id").fill(IDN);
  await page.locator("#ext-fuente").fill("IMNC");
  await page.locator("#ext-titulo").fill(`Norma registrada en pantalla ${s}`);
  await page.locator("#ext-area").selectOption("GC");
  await page.locator("#ext-tipo").selectOption("R");
  await page.locator("#ext-version").fill("2020");
  await page.locator("#ext-responsable").selectOption(String(id.ricardo));
  await masOpciones(ventana(page));
  await page.locator("#ext-pdf-input").setInputFiles(TXT);
  const r1 = await intentar(page, "ext-guardar", ["ext-pdf"]);
  check("[cob:D:D-220] un .txt en «PDF»: se marca #ext-pdf (solo PDF)", r1.todos && /debe ser PDF/.test(r1.texto), r1.texto);
  await page.locator("#ext-pdf-input").setInputFiles(await pdf("norma-pantalla.pdf", `Norma ${s}`));
  await fecha(page, "ext-ultima", enDias(3));
  await fecha(page, "ext-proxima", enDias(400));
  const r2 = await intentar(page, "ext-guardar", ["ext-ultima"]);
  check("[cob:D:D-218] última verificación futura: el servidor la rechaza en #ext-ultima y no se registra", r2.tipo === "servidor" && r2.todos && /no puede ser futura/.test(r2.texto) && !fila("SELECT id FROM sgc_documentos WHERE clave = ?", IDN), r2.texto);
  await fecha(page, "ext-ultima", HOY);
  await page.locator("#ext-conf").selectOption("restringido");
  await page.locator("#ext-palabras").fill(`norma, pantalla${s}`);
  await page.locator("#ext-comentario").fill(`Registro desde la pantalla ${s}`);
  await page.getByTestId("ext-guardar").click();
  await clave(page, "ana");
  await page.waitForURL((u) => /^\/documentos\/\d+$/.test(u.pathname), { timeout: 30_000 });
  const doc = fila("SELECT id, confidencialidad, palabras_clave, origen FROM sgc_documentos WHERE clave = ?", IDN);
  const rev = doc ? fila("SELECT id FROM sgc_revisiones WHERE documento_id = ? AND estado = 'vigente'", doc.id) : null;
  const flujo = rev ? fila("SELECT comentario FROM sgc_flujo_acciones WHERE revision_id = ? AND accion = 'externo_registrar'", rev.id) : null;
  check("[cob:D:D-217] la confidencialidad elegida queda en el externo", doc?.origen === "externo" && doc?.confidencialidad === "restringido", JSON.stringify(doc));
  check("[cob:D:D-219] palabras clave del externo guardadas", String(doc?.palabras_clave || "").toLowerCase().includes(`pantalla${s.toLowerCase()}`), JSON.stringify(doc?.palabras_clave));
  check("[cob:D:D-220] [cob:D:D-221] con un PDF real se registra con su archivo y el comentario queda en la línea de tiempo", !!rev && !!fila("SELECT id FROM sgc_archivos WHERE revision_id = ? AND tipo = 'pdf'", rev.id) && flujo?.comentario === `Registro desde la pantalla ${s}`, JSON.stringify(flujo));
});

await paso("ana", "externos: verificar, abrir ficha, nueva versión y lista vacía", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/externos`);
  await page.getByPlaceholder("Buscar por identificador, título o emisor").fill(IDE);
  const filaE = page.locator(`[data-testid="ext-fila"][data-clave="${IDE}"]`);
  await filaE.waitFor();
  await filaE.getByTestId("ext-fila-verificar").click();
  await ventana(page).waitFor();
  await page.locator("#ver-comentario").fill("Consultado el catálogo del IMNC");
  await fecha(page, "ver-proxima", HOY);
  const r1 = await intentar(page, "ver-guardar", ["ver-proxima"]);
  check("[cob:D:D-224] verificar con próxima verificación que no es posterior a hoy: se marca #ver-proxima", r1.todos && /posterior a hoy/.test(r1.texto), r1.texto);
  await page.keyboard.press("Escape");
  await ventana(page).waitFor({ state: "detached" });
  await page.getByRole("button", { name: `Más acciones de ${IDE}` }).click();
  await page.getByRole("menuitem", { name: "Abrir ficha" }).click();
  await page.waitForURL((u) => u.pathname === `/documentos/${E}`);
  check("[cob:D:D-284] «Abrir ficha» del renglón abre la ficha del externo", true);
  await page.goBack();
  await filaE.waitFor();
  await page.getByRole("button", { name: `Más acciones de ${IDE}` }).click();
  await page.getByTestId("ext-fila-version").click();
  await ventana(page).waitFor();
  check("[cob:D:D-285] «Registrar nueva versión» del renglón abre su ventana", (await ventana(page).innerText()).includes(`Nueva versión de ${IDE}`));
  await page.locator("#nv-version").fill("2018");
  const r2 = await intentar(page, "nv-guardar", ["nv-version"]);
  check("[cob:D:D-226] la nueva versión igual a la vigente: se marca #nv-version", r2.todos && /distinta de la versión vigente/.test(r2.texto), r2.texto);
  await page.locator("#nv-version").fill("2025");
  await fecha(page, "nv-proxima", "");
  const r3 = await intentar(page, "nv-guardar", ["nv-proxima"]);
  check("[cob:D:D-227] sin próxima verificación: se marca #nv-proxima", r3.todos, r3.texto);
  await fecha(page, "nv-proxima", enDias(365));
  await masOpciones(ventana(page));
  await page.locator("#nv-enlace").fill("ftp://imnc.org.mx/norma");
  const r4 = await intentar(page, "nv-guardar", ["nv-enlace"]);
  check("[cob:D:D-228] enlace que no es http(s): se marca #nv-enlace", r4.todos && /http\(s\)/.test(r4.texto), r4.texto);
  await page.locator("#nv-enlace").fill("https://www.imnc.org.mx/2025");
  const antes = nRevisiones(E);
  await page.locator("#nv-pdf-input").setInputFiles(TXT);
  await page.getByTestId("nv-guardar").click();
  const alerta = page.locator('[role="alertdialog"][data-validacion]');
  await alerta.waitFor();
  const texto = (await alerta.innerText()).replace(/\s+/g, " ");
  await entendido(page);
  check("[cob:D:D-229] un .txt en «PDF» de la nueva versión no se registra (formato no permitido)", /Formato no permitido|debe ser PDF/.test(texto) && nRevisiones(E) === antes, texto);
  await page.locator("#nv-pdf-input").setInputFiles(await pdf("norma-2025.pdf", `Norma 2025 ${s}`));
  await page.locator("#nv-comentario").fill(`Edición 2025 desde la pantalla ${s}`);
  await page.getByTestId("nv-guardar").click();
  await clave(page, "ana");
  await cerrada(page);
  const rev = await esperar(() => fila("SELECT id, version_externa FROM sgc_revisiones WHERE documento_id = ? AND estado = 'vigente' AND version_externa = '2025'", E));
  const flujo = rev ? fila("SELECT comentario FROM sgc_flujo_acciones WHERE revision_id = ? AND accion = 'externo_version'", rev.id) : null;
  check("[cob:D:D-226] [cob:D:D-227] [cob:D:D-228] [cob:D:D-229] [cob:D:D-230] la versión 2025 queda vigente con su PDF y el comentario", !!rev && !!fila("SELECT id FROM sgc_archivos WHERE revision_id = ? AND tipo = 'pdf'", rev.id) && flujo?.comentario === `Edición 2025 desde la pantalla ${s}`, JSON.stringify({ rev, flujo }));
  // Lista vacía: el servidor responde sin externos.
  await page.route(/\/api\/sgc\/externos(\?|$)/, (route) => (route.request().method() === "GET" ? route.fulfill({ json: { items: [], puede: { registrar: true, ver_obsoletos: true } } }) : route.continue()));
  await page.goto(`${BASE_WEB}/documentos/externos`);
  await page.getByText("Aún no hay documentos externos").waitFor();
  check("[cob:D:D-286] sin externos: «Aún no hay documentos externos» con la invitación a registrarlos", (await page.getByText(/Registra las normas y guías/).count()) === 1 && (await page.getByTestId("ext-fila").count()) === 0);
  await page.unroute(/\/api\/sgc\/externos(\?|$)/);
});

await paso("ana", "editar el seguimiento del externo", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${E}`);
  await (await accion(page, "ext-editar")).click();
  await ventana(page).waitFor();
  await page.locator("#ee-fuente").fill("");
  await page.locator("#ee-responsable").selectOption("");
  await page.locator("#ee-motivo").fill("abc");
  await masOpciones(ventana(page));
  await page.locator("#ee-enlace").fill("no es un enlace");
  const r = await intentar(page, "ee-guardar", ["ee-fuente", "ee-responsable", "ee-motivo", "ee-enlace"]);
  check("[cob:D:D-232] sin fuente: se marca #ee-fuente", r.marcados["ee-fuente"], r.texto);
  check("[cob:D:D-233] sin responsable: se marca #ee-responsable", r.marcados["ee-responsable"], r.texto);
  check("[cob:D:D-234] motivo de menos de 5 caracteres: se marca #ee-motivo", r.marcados["ee-motivo"], r.texto);
  check("[cob:D:D-235] enlace que no es http(s): se marca #ee-enlace", r.marcados["ee-enlace"], r.texto);
  await page.locator("#ee-fuente").fill("IMNC (Instituto Mexicano de Normalización)");
  await page.locator("#ee-responsable").selectOption(String(id.gabriela));
  await page.locator("#ee-motivo").fill("Cambio del responsable de seguimiento");
  await page.locator("#ee-enlace").fill("https://www.imnc.org.mx/normas");
  await page.getByTestId("ee-guardar").click();
  await cerrada(page);
  const ext = await esperar(() => fila("SELECT fuente, responsable_id, enlace FROM sgc_externos WHERE documento_id = ? AND responsable_id = ?", E, id.gabriela));
  check("[cob:D:D-232] [cob:D:D-233] [cob:D:D-234] [cob:D:D-235] con datos válidos se guardan fuente, responsable activo y enlace", ext?.fuente === "IMNC (Instituto Mexicano de Normalización)" && ext?.enlace === "https://www.imnc.org.mx/normas", JSON.stringify(ext));
});

/* ---------- Lista Maestra ---------- */
await paso("ana", "lista maestra: resumen, tipo documental y vacío", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/lista-maestra`);
  await page.getByTestId("lm-resumen").waitFor();
  await page.getByPlaceholder("Buscar por clave, título o propietario").fill(s);
  await page.waitForFunction((x) => { const f = [...document.querySelectorAll('[data-testid="lm-fila"]')]; return f.length > 0 && f.every((el) => (el.textContent || "").includes(x)); }, s, { timeout: 15_000 });
  const n = await page.getByTestId("lm-fila").count();
  const resumen = (await page.getByTestId("lm-resumen").innerText()).trim();
  check("[cob:D:D-294] resumen «N documentos · filtros» igual a los renglones", resumen.startsWith(`${n} documento${n === 1 ? "" : "s"} ·`), `${resumen} · ${n}`);
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.locator('section[aria-label="Tipo documental"]').getByRole("switch", { name: /^I · / }).click();
  await page.keyboard.press("Escape");
  const esperadas = ((await api("GET", `/sgc/lista-maestra?search=${s}&tipo=I`, undefined, t.ana)).data?.items || []).map((x) => x.clave).sort();
  await page.waitForFunction((k) => [...document.querySelectorAll('[data-testid="lm-fila"]')].length === k, esperadas.length, { timeout: 15_000 }).catch(() => {});
  const claves = (await page.getByTestId("lm-fila").evaluateAll((xs) => xs.map((x) => x.getAttribute("data-clave")))).sort();
  check("[cob:D:D-290] «Tipo documental» (I) deja solo los instructivos, como la API", esperadas.length >= 2 && claves.join() === esperadas.join() && claves.includes(V.clave), `${claves.join(", ")} vs ${esperadas.join(", ")}`);
  await page.getByPlaceholder("Buscar por clave, título o propietario").fill(`nada-coincide-${s}`);
  await page.getByTestId("lm-vacio").waitFor();
  check("[cob:D:D-295] sin coincidencias: estado vacío (lm-vacio) y «0 documentos»", /Nada coincide/.test(await page.getByTestId("lm-vacio").innerText()) && (await page.getByTestId("lm-resumen").innerText()).startsWith("0 documentos"));
});

/* ---------- Limpieza: nada de esta suite queda pendiente para otras ---------- */
if (obsOB.data?.solicitud?.id) await api("POST", `/solicitudes/${obsOB.data.solicitud.id}/rechazar`, { motivo: "Fin de la prueba de cobertura" }, t.patricia);
for (const x of filas("SELECT id FROM sgc_solicitudes WHERE estado = 'pendiente' AND (titulo_propuesto LIKE ? OR justificacion LIKE ?)", `%${s}%`, `%${s}%`)) await api("POST", `/sgc/solicitudes/${x.id}/rechazar`, { motivo: "Fin de la prueba de cobertura" }, t.ana);

await nav.cerrar();
terminar();
