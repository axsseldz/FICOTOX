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
const { abrirMenu, accion, cerrarMenu, contarAccion, motivo, principal } = await import("../lib/ficha.mjs");

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


/* ---------- Datos de apoyo de la segunda pasada ---------- */
// Cuenta dada de baja: no se ofrece como propietario ni como responsable.
const altaBaja = await api("POST", "/admin/usuarios", { nombre: `Cuenta de baja ${s}`, email: `baja.${s.toLowerCase()}@ficotox.local`, activo: true, rol_id: rolAux, departamento: "Laboratorio", password: `Temporal-${s}-2026`, motivo: "Alta de la prueba de cobertura" }, t.jorge, SIN_APROBAR);
if (altaBaja.data?.solicitud?.id) await api("POST", `/solicitudes/${altaBaja.data.solicitud.id}/cancelar`, { motivo: "La cuenta de cobertura se da de baja" }, t.jorge);
const idBaja = Number(altaBaja.data?.id);
const bajaR = await api("DELETE", `/admin/usuarios/${idBaja}`, { motivo: "Baja de la cuenta de cobertura" }, t.jorge);
async function fichaCon(campos, archivos) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...RESP, ...campos })) fd.append(k, String(v));
  for (const [k, [bytes, nombreArch]] of Object.entries(archivos)) fd.append(k, new Blob([bytes]), nombreArch);
  const r = await api("POST", "/sgc/documentos", fd, t.ana);
  return { id: r.data?.id, revision_id: r.data?.revision_id, status: r.status, clave: campos.clave, titulo: campos.titulo };
}
const AZ2 = await ficha({ clave: `FX-GCP-P${s}`, titulo: `Procedimiento autorizado por publicar ${s}`, area_codigo: "GC", tipo_codigo: "P" });
const okAZ2 = await hasta(AZ2.revision_id, "autorizada");
const DV = await ficha({ clave: `FX-TCP-D${s}`, titulo: `Procedimiento devuelto ${s}`, area_codigo: "TC", tipo_codigo: "P" });
await hasta(DV.revision_id, "en_revision");
const devDV = await api("POST", `/sgc/revisiones/${DV.revision_id}/revisar`, { decision: "devolver", comentario: "Corregir el alcance" }, t.gabriela);
const LD = await vigente({ clave: `FX-TCI-L${s}`, titulo: `Instrucción por leer ${s}`, area_codigo: "TC", tipo_codigo: "I" });
const distLD = await api("POST", `/sgc/revisiones/${LD.revision_id}/distribucion`, { usuarios: [id.luis], punto_uso: "Mesa de lecturas", requiere_lectura: true, motivo: "Distribución de la prueba de cobertura" }, t.ana);
const FU = await fichaCon({ clave: `FX-TCP-F${s}`, titulo: `Procedimiento con archivo fuente ${s}`, area_codigo: "TC", tipo_codigo: "P" }, { archivo_pdf: [await pdfConTexto(1, `Fuente ${s}`), "consulta.pdf"], archivo_fuente: [docxSimple(`Fuente ${s}`), "fuente.docx"] });
const vigFU = await api("POST", `/sgc/revisiones/${FU.revision_id}/registrar-vigente`, { fecha_emision: "2025-01-10" }, t.ana);
const RS = await vigente({ clave: `FX-TCP-R${s}`, titulo: `Procedimiento restringido ${s}`, area_codigo: "TC", tipo_codigo: "P", confidencialidad: "restringido" });
const PO = await vigente({ clave: `FX-TCP-H${s}`, titulo: `Procedimiento de Ricardo ${s}`, area_codigo: "TC", tipo_codigo: "P", propietario_id: id.ricardo });
const NV = await vigente({ clave: `FX-TCI-M${s}`, titulo: `Instrucción para nueva revisión ${s}`, area_codigo: "TC", tipo_codigo: "I" });
// RN2: renovación ya confirmada por la revisora (en autorización).
const RN2 = await vigente({ clave: `FX-TCP-L${s}`, titulo: `Procedimiento con renovación por autorizar ${s}`, area_codigo: "TC", tipo_codigo: "P" }, { fecha_emision: "2025-01-10", fecha_proxima_revision: enDias(11) });
const renov2 = await api("POST", `/sgc/documentos/${RN2.id}/renovar`, { revisor_id: id.gabriela, autorizador_id: id.patricia }, t.ana);
const conf2 = renov2.data?.id ? await api("POST", `/sgc/renovaciones/${renov2.data.id}/revisar`, { decision: "confirmar", comentario: "Sigue vigente" }, t.gabriela) : { status: 0 };
const CI2 = await ficha({ clave: `FX-TCP-G${s}`, titulo: `Procedimiento sin flujo ${s}`, area_codigo: "TC", tipo_codigo: "P" });
const OB2 = await vigente({ clave: `FX-TCP-J${s}`, titulo: `Procedimiento por declarar obsoleto ${s}`, area_codigo: "TC", tipo_codigo: "P" });
// Externos: uno sin PDF y uno obsoleto.
const IDN0 = `NMX-SINPDF-${s}`;
const EN = (await api("POST", "/sgc/externos", { identificador: IDN0, titulo: `Guía sin PDF ${s}`, area_codigo: "GC", tipo_codigo: "R", fuente: "SSA", version_fecha: "2019", responsable_id: id.ricardo, ultima_verificacion: HOY, proxima_revision: enDias(365) }, t.ana)).data?.id;
const IDOX = `NMX-OBS-${s}`;
const EOX = (await api("POST", "/sgc/externos", { identificador: IDOX, titulo: `Norma retirada ${s}`, area_codigo: "GC", tipo_codigo: "R", fuente: "IMNC", version_fecha: "2010", responsable_id: id.ricardo, ultima_verificacion: HOY, proxima_revision: enDias(365) }, t.ana)).data?.id;
const obsEOX = await api("POST", `/sgc/documentos/${EOX}/obsoletar`, { motivo: "Norma sustituida por el emisor" }, t.ana);
check(
  "(preparación) datos de la segunda pasada",
  bajaR.status === 200 && AZ2.status === 201 && okAZ2 && devDV.status === 200 && LD.ok && distLD.status === 201 && FU.status === 201 && vigFU.status === 200 && RS.ok && PO.ok && RN2.ok && conf2.status === 200 && NV.ok && CI2.status === 201 && OB2.ok && !!EN && !!EOX && fila("SELECT estado FROM sgc_documentos WHERE id = ?", EOX)?.estado === "obsoleto",
  JSON.stringify({ baja: bajaR.status, AZ2: okAZ2, dev: devDV.status, LD: LD.ok, dist: distLD.status, FU: FU.status, vigFU: vigFU.status, EN, EOX, obs: obsEOX.status, renov2: renov2.status, conf2: conf2.status }),
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
  check("[cob:D:D-113] [cob:D:D-114] [cob:D:D-115] [cob:D:D-117] [cob:D:D-118] «Reasignar» con tres personas distintas guarda el revisor y la fecha límite", rev?.fecha_limite === enDias(25), JSON.stringify(rev));
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
  check("[cob:D:D-188] [cob:D:D-189] [cob:D:D-270] «Rechazar solicitud» con motivo válido la deja rechazada con su motivo", /Ya existe un registro equivalente/.test(sr?.comentario_resolucion || ""), JSON.stringify(sr));
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
  check("[cob:D:D-196] [cob:D:D-197] [cob:D:D-204] «Quitar» (ret-guardar) con motivo válido (y contraseña) deja al destinatario retirado", !!fuera?.retirado_en && !!fila("SELECT id FROM sgc_distribucion WHERE revision_id = ? AND usuario_id = ? AND retirado_en IS NULL", V.revision_id, id.luis));
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
  check("[cob:D:D-226] [cob:D:D-227] [cob:D:D-228] [cob:D:D-229] [cob:D:D-230] [cob:D:D-231] «Registrar nueva versión» deja vigente la 2025 con su PDF y el comentario", !!rev && !!fila("SELECT id FROM sgc_archivos WHERE revision_id = ? AND tipo = 'pdf'", rev.id) && flujo?.comentario === `Edición 2025 desde la pantalla ${s}`, JSON.stringify({ rev, flujo }));
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
  check("[cob:D:D-232] [cob:D:D-233] [cob:D:D-234] [cob:D:D-235] [cob:D:D-236] «Guardar» (ee-guardar) con datos válidos guarda fuente, responsable activo y enlace", ext?.fuente === "IMNC (Instituto Mexicano de Normalización)" && ext?.enlace === "https://www.imnc.org.mx/normas", JSON.stringify(ext));
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

/* ====================== Segunda pasada: cada renglón con su elemento y su efecto ====================== */
/* ¿La acción está disponible y habilitada (botón principal o renglón del menú ⋯ sin aria-disabled)? Deja el menú cerrado. */
async function habilitada(page, testid) {
  await listo(page);
  if (await page.locator(`[data-principal="1"][data-testid="${testid}"]`).count()) return true;
  if (!(await page.getByRole("button", { name: "Más acciones" }).count())) return false;
  await abrirMenu(page);
  const item = page.getByRole("menu").getByTestId(testid);
  const ok = (await item.count()) > 0 && (await item.getAttribute("aria-disabled")) !== "true";
  await cerrarMenu(page);
  return ok;
}
const enlacesDocs = (page) => page.locator('aside[aria-label="Navegación principal"] a[href^="/documentos"]').evaluateAll((xs) => [...new Set(xs.map((x) => x.getAttribute("href")))].sort());
/* Respuesta JSON de la API que la pantalla pidió (la que dibuja). */
const respuesta = (page, re) => page.waitForResponse((r) => re.test(new URL(r.url()).pathname + new URL(r.url()).search) && r.request().method() === "GET" && r.status() === 200, { timeout: 30_000 });
const filtro = async (page, grupo, opcion) => {
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.locator(`section[aria-label="${grupo}"]`).getByRole("switch", { name: opcion, exact: typeof opcion === "string" }).click();
  await page.keyboard.press("Escape");
};
const clavesTarjetas = (page) => page.getByTestId("sgc-tarjeta").evaluateAll((xs) => xs.map((x) => x.getAttribute("data-clave")).sort());

let nombreTC = "";
/* ---------- Menú lateral y acceso ---------- */
await paso("ana", "menú lateral de Documentos SGC", async (page) => {
  await page.goto(`${BASE_WEB}/documentos`);
  await page.getByTestId("sgc-carpetas").waitFor();
  const hrefs = await enlacesDocs(page);
  check("[cob:D:D-001] [cob:D:D-002] [cob:D:D-003] [cob:D:D-004] [cob:D:D-005] con acciones documentales: Documentos, Bandeja, Solicitudes, Externos y Lista Maestra en el menú", ["/documentos", "/documentos/bandeja", "/documentos/externos", "/documentos/lista-maestra", "/documentos/solicitudes"].every((h) => hrefs.includes(h)), hrefs.join(" "));
  const destinos = [];
  for (const [texto, ruta] of [["Bandeja", "/documentos/bandeja"], ["Solicitudes", "/documentos/solicitudes"], ["Externos", "/documentos/externos"], ["Lista Maestra", "/documentos/lista-maestra"], ["Documentos", "/documentos"]]) {
    await page.locator(`aside[aria-label="Navegación principal"] a[href="${ruta}"]`).filter({ hasText: texto }).last().click();
    await page.waitForURL((u) => u.pathname === ruta);
    destinos.push(new URL(page.url()).pathname);
  }
  check("[cob:D:D-001] [cob:D:D-002] [cob:D:D-003] [cob:D:D-004] [cob:D:D-005] cada enlace lleva a su pantalla", destinos.join() === "/documentos/bandeja,/documentos/solicitudes,/documentos/externos,/documentos/lista-maestra,/documentos", destinos.join());
});

await paso("jorge", "menú lateral de la administración técnica", async (page) => {
  await page.goto(`${BASE_WEB}/documentos`);
  await page.getByTestId("sgc-carpetas").waitFor();
  const hrefs = await enlacesDocs(page);
  check("[cob:D:D-001] [cob:D:D-002] [cob:D:D-003] [cob:D:D-004] [cob:D:D-005] solo usuarios:G (sin módulo documentos): «Documentos» sí; Bandeja, Solicitudes, Externos y Lista Maestra no", hrefs.join(" ") === "/documentos", hrefs.join(" "));
});

await paso("jorge", "sin acceso a las pantallas de trabajo de Documentos SGC", async (page) => {
  const vistas = [];
  for (const ruta of ["/documentos/bandeja", "/documentos/solicitudes", "/documentos/externos", "/documentos/lista-maestra"]) {
    await page.goto(`${BASE_WEB}${ruta}`);
    await page.getByText("Sin acceso a Documentos SGC").waitFor();
    vistas.push((await page.getByTestId("bandeja-grupo").count()) + (await page.locator("[data-solicitud]").count()) + (await page.getByTestId("ext-fila").count()) + (await page.getByTestId("lm-tabla").count()));
  }
  await page.goto(`${BASE_WEB}/documentos`);
  await page.getByTestId("sgc-carpetas").waitFor();
  check("[cob:D:D-006] solo usuarios:G (sin acciones documentales): Bandeja, Solicitudes, Externos y Lista Maestra dicen «Sin acceso a Documentos SGC» sin datos; las carpetas sí se ven (diagnóstico)", vistas.every((n) => n === 0) && (await page.getByText("Sin acceso a Documentos SGC").count()) === 0, vistas.join(","));
});

/* ---------- Inicio ---------- */
await paso("ana", "inicio: indicadores, carpetas, buscador y botones", async (page) => {
  const resumen = respuesta(page, /\/api\/sgc\/resumen$/);
  await page.goto(`${BASE_WEB}/documentos`);
  const r = await (await resumen).json();
  await page.getByTestId("sgc-carpetas").waitFor();
  const ind = Object.fromEntries(await page.getByTestId("sgc-indicadores").getByTestId("sgc-indicador").evaluateAll((xs) => xs.map((x) => [x.getAttribute("data-indicador"), Number(x.getAttribute("data-valor"))])));
  check("[cob:D:D-018] indicadores con los valores del resumen (vigentes, en curso, próximos a revisar, mis lecturas)", ind.vigentes === r.indicadores.vigentes && ind.en_curso === r.indicadores.en_curso && ind.proximos_revision === r.indicadores.proximos_revision && ind.lecturas_mias === r.indicadores.lecturas_mias, `${JSON.stringify(ind)} vs ${JSON.stringify(r.indicadores)}`);
  const areas = r.areas.map((a) => a.codigo).sort();
  const carpetas = (await page.getByTestId("sgc-carpeta").evaluateAll((xs) => xs.map((x) => x.getAttribute("data-area")))).sort();
  check("[cob:D:D-024] una carpeta por cada gestión activa del catálogo", carpetas.join() === areas.join(), `${carpetas.join()} vs ${areas.join()}`);
  const tc = page.locator('[data-testid="sgc-carpeta"][data-area="TC"]');
  const vig = Number(await tc.getByTestId("sgc-carpeta-vigentes").getAttribute("data-valor"));
  check("[cob:D:D-026] el contador de la carpeta TC es el número de vigentes de esa gestión", vig === r.areas.find((a) => a.codigo === "TC").conteos.vigentes && vig > 0, `${vig}`);
  check("[cob:D:D-025] la carpeta lleva a /documentos/explorar?area=TC", (await tc.getAttribute("href")) === "/documentos/explorar?area=TC");
  await tc.click();
  await page.waitForURL((u) => u.pathname === "/documentos/explorar" && u.searchParams.get("area") === "TC");
  await page.getByTestId("sgc-tarjetas").waitFor();
  check("[cob:D:D-025] …y abre la carpeta de esa gestión", (await page.getByTestId("sgc-carpeta-encabezado").getByRole("heading").first().innerText()).trim() === r.areas.find((a) => a.codigo === "TC").nombre);
  nombreTC = r.areas.find((a) => a.codigo === "TC").nombre;
  await page.goto(`${BASE_WEB}/documentos`);
  const vigentes = page.locator('[data-testid="sgc-indicador"][data-indicador="vigentes"]');
  await vigentes.waitFor();
  const hrefV = await vigentes.getAttribute("href");
  await vigentes.click();
  await page.waitForURL((u) => u.pathname === "/documentos/explorar" && u.searchParams.get("estado") === "vigente");
  check("[cob:D:D-019] «Vigentes» lleva a la carpeta con el filtro de vigentes aplicado", hrefV === "/documentos/explorar?estado=vigente" && (await page.getByRole("button", { name: /^Filtros/ }).getAttribute("aria-label")) === "Filtros (1 activos)", hrefV);
  // Buscador del inicio.
  await page.goto(`${BASE_WEB}/documentos`);
  const buscador = page.getByTestId("sgc-buscador");
  await buscador.waitFor();
  const antes = await page.getByTestId("sgc-resultados").count();
  await buscador.locator("input").first().fill("F");
  await page.waitForTimeout(800);
  const conUna = await page.getByTestId("sgc-resultados").count();
  await buscador.locator("input").first().fill(PO.clave);
  await page.getByTestId("sgc-resultados").getByRole("link").filter({ hasText: PO.clave }).waitFor();
  const n = await page.getByTestId("sgc-resultados").getByRole("link").count();
  check("[cob:D:D-015] [cob:D:D-016] los resultados solo aparecen con 2 caracteres o más y buscan en vivo", antes === 0 && conUna === 0 && n === 1, `${antes} ${conUna} ${n}`);
  await buscador.locator("input").first().fill("");
  await page.getByTestId("sgc-resultados").waitFor({ state: "detached" });
  check("[cob:D:D-016] al borrar la búsqueda desaparece la lista de resultados", (await page.getByTestId("sgc-resultados").count()) === 0);
  // Nueva ficha
  await page.getByTestId("sgc-nueva-ficha").click();
  await page.waitForURL((u) => u.pathname === "/documentos/explorar" && u.searchParams.get("nueva") === "1");
  await ventana(page).waitFor();
  check("[cob:D:D-012] «Nueva ficha» (Mejora Continua) lleva a /documentos/explorar?nueva=1 con la hoja abierta", /Nueva ficha/.test(await ventana(page).innerText()) && (await page.locator("#ficha-area").count()) === 1);
});

await paso("luis", "inicio y carpeta del técnico analista: proponer sí, fichas no", async (page) => {
  await page.goto(`${BASE_WEB}/documentos`);
  await page.getByTestId("sgc-carpetas").waitFor();
  check("[cob:D:D-012] sin documento_crear_ficha no hay «Nueva ficha» en el inicio", (await page.getByTestId("sgc-nueva-ficha").count()) === 0);
  await page.getByTestId("sgc-nueva-solicitud").click();
  await ventana(page).waitFor();
  check("[cob:D:D-013] «Nueva solicitud» del inicio abre la hoja de la solicitud", /Nueva solicitud/.test(await ventana(page).innerText()) && (await page.locator("#sol-justificacion").count()) === 1);
  await page.keyboard.press("Escape");
  await page.goto(`${BASE_WEB}/documentos/explorar?area=TC`);
  await page.getByTestId("sgc-tarjetas").waitFor();
  check("[cob:D:D-029] sin documento_crear_ficha no hay «Nueva ficha» en la carpeta", (await page.getByTestId("sgc-nueva-ficha").count()) === 0);
  await page.getByTestId("sgc-explorar-solicitud").click();
  await ventana(page).waitFor();
  check("[cob:D:D-030] «Nueva solicitud» de la carpeta abre la hoja de la solicitud", /Nueva solicitud/.test(await ventana(page).innerText()) && (await page.locator("#sol-justificacion").count()) === 1);
  await page.keyboard.press("Escape");
  check("[cob:D:D-043] sin consultar el histórico no hay «Mostrar obsoletos»", await (async () => { await page.getByRole("button", { name: /^Filtros/ }).click(); const n = await page.getByRole("switch", { name: "Mostrar obsoletos" }).count(); await page.keyboard.press("Escape"); return n === 0; })());
  // Miniatura: con lectura pendiente no se pide el PDF (abrirlo cuenta como apertura).
  await page.getByPlaceholder("Buscar por clave, título o palabras clave").fill(LD.clave);
  const tarjeta = page.locator(`[data-testid="sgc-tarjeta"][data-clave="${LD.clave}"]`);
  await tarjeta.waitFor();
  await page.waitForTimeout(2500);
  const abierto = fila("SELECT abierto_en FROM sgc_lecturas WHERE revision_id = ? AND usuario_id = ?", LD.revision_id, id.luis)?.abierto_en || null;
  check("[cob:D:D-049] con una lectura pendiente (mi_lectura) la tarjeta no genera miniatura ni marca la apertura del PDF", (await tarjeta.getByTestId("sgc-miniatura").getAttribute("data-con-imagen")) === "0" && !abierto, String(abierto));
});

await paso("diego", "inicio y carpeta de quien solo consulta", async (page) => {
  await page.goto(`${BASE_WEB}/documentos`);
  await page.getByTestId("sgc-carpetas").waitFor();
  check("[cob:D:D-013] sin documento_proponer no hay «Nueva solicitud» en el inicio", (await page.getByTestId("sgc-nueva-solicitud").count()) === 0 && (await page.getByTestId("sgc-nueva-ficha").count()) === 0);
  await page.goto(`${BASE_WEB}/documentos/explorar?area=TC`);
  await page.getByTestId("sgc-tarjetas").waitFor();
  check("[cob:D:D-030] sin documento_proponer no hay «Nueva solicitud» en la carpeta", (await page.getByTestId("sgc-explorar-solicitud").count()) === 0);
});

/* ---------- Carpeta: filtros, orden, tarjetas ---------- */
await paso("ana", "carpeta: migas, filtros, orden y tarjetas", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/explorar?area=TC`);
  await page.getByTestId("sgc-tarjetas").waitFor();
  const migas = page.getByTestId("ruta-documentos");
  const textoMigas = (await migas.innerText()).replace(/\s+/g, " ");
  check("[cob:D:D-027] migas «Documentos › Técnica…» con el enlace al inicio de Documentos", /^Documentos/.test(textoMigas.trim()) && (await migas.getByRole("link", { name: "Documentos" }).getAttribute("href")) === "/documentos", textoMigas);
  const titulo = (await page.getByTestId("sgc-carpeta-encabezado").getByRole("heading").first().innerText()).trim();
  await page.goto(`${BASE_WEB}/documentos/explorar`);
  await page.getByTestId("sgc-tarjetas").waitFor();
  const tituloTodos = (await page.getByTestId("sgc-carpeta-encabezado").getByRole("heading").first().innerText()).trim();
  check("[cob:D:D-028] encabezado: con ?area= el nombre de la gestión; sin área, «Todos los documentos» (se muestra siempre)", titulo === nombreTC && tituloTodos === "Todos los documentos", `${titulo} · ${tituloTodos}`);
  // Gestión: solo sin área elegida; al elegirla se va a ?area= y el grupo desaparece.
  await page.getByRole("button", { name: /^Filtros/ }).click();
  const gestion = page.locator('section[aria-label="Gestión"]');
  await gestion.waitFor();
  await gestion.getByRole("switch", { name: /^GC · / }).click();
  await page.keyboard.press("Escape");
  await page.waitForURL((u) => u.searchParams.get("area") === "GC");
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="sgc-tarjeta"]')].every((el) => /^FX-GC/.test(el.getAttribute("data-clave") || "") || /NMX/.test(el.getAttribute("data-clave") || "")), null, { timeout: 15_000 });
  await page.getByRole("button", { name: /^Filtros/ }).click();
  const sigue = await page.locator('section[aria-label="Gestión"]').count();
  await page.keyboard.press("Escape");
  check("[cob:D:D-035] filtro «Gestión» (GC): pone ?area=GC, deja esa gestión y el grupo desaparece", sigue === 0, String(sigue));
  // Búsqueda y estado (se compara con lo que respondió la API).
  await page.goto(`${BASE_WEB}/documentos/explorar?area=TC`);
  await page.getByTestId("sgc-tarjetas").waitFor();
  let resp = respuesta(page, /\/api\/sgc\/documentos\?.*search=/);
  await page.getByPlaceholder("Buscar por clave, título o palabras clave").fill(PO.clave);
  let datos = await (await resp).json();
  await page.locator(`[data-testid="sgc-tarjeta"][data-clave="${PO.clave}"]`).waitFor();
  await esperar(async () => (await clavesTarjetas(page)).length === datos.items.length, 8000);
  check("[cob:D:D-032] el buscador de la carpeta deja solo lo que coincide con la clave", (await clavesTarjetas(page)).join() === PO.clave && datos.items.length === 1, (await clavesTarjetas(page)).join());
  await page.getByPlaceholder("Buscar por clave, título o palabras clave").fill(s);
  await page.locator(`[data-testid="sgc-tarjeta"][data-clave="${RV.clave}"]`).waitFor();
  resp = respuesta(page, /\/api\/sgc\/documentos\?.*estado=en_revision/);
  await filtro(page, "Estado", "En revisión o autorización");
  datos = await (await resp).json();
  await esperar(async () => (await clavesTarjetas(page)).join() === datos.items.map((x) => x.clave).sort().join(), 10_000);
  let claves = await clavesTarjetas(page);
  check("[cob:D:D-037] filtro «Estado» (en revisión o autorización): quedan las revisiones en revisión/autorización y no las vigentes", claves.includes(RV.clave) && claves.includes(AU.clave) && !claves.includes(V.clave) && claves.join() === datos.items.map((x) => x.clave).sort().join(), claves.join());
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await page.keyboard.press("Escape");
  // Propietario
  resp = respuesta(page, new RegExp(`/api/sgc/documentos\\?.*propietario=${id.ricardo}`));
  await filtro(page, "Propietario", nombre[id.ricardo]);
  datos = await (await resp).json();
  await esperar(async () => (await clavesTarjetas(page)).join() === datos.items.map((x) => x.clave).sort().join(), 10_000);
  claves = await clavesTarjetas(page);
  check("[cob:D:D-039] filtro «Propietario» (Ricardo): solo sus documentos", claves.includes(PO.clave) && !claves.includes(V.clave) && claves.join() === datos.items.map((x) => x.clave).sort().join(), claves.join());
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await page.keyboard.press("Escape");
  // Fecha de emisión
  await page.getByRole("button", { name: /^Filtros/ }).click();
  const periodo = page.locator('section[aria-label="Fecha de emisión"]');
  const sinFechas = (await page.locator("#sgc-desde").count()) + (await page.locator("#sgc-hasta").count());
  await periodo.getByRole("switch", { name: "Personalizado", exact: true }).click();
  await page.locator("#sgc-desde").waitFor();
  await fecha(page, "sgc-desde", "2024-06-01");
  resp = respuesta(page, /\/api\/sgc\/documentos\?.*hasta=2025-06-30/);
  await fecha(page, "sgc-hasta", "2025-06-30");
  datos = await (await resp).json();
  await page.keyboard.press("Escape");
  await esperar(async () => (await clavesTarjetas(page)).join() === datos.items.map((x) => x.clave).sort().join(), 10_000);
  claves = await clavesTarjetas(page);
  check("[cob:D:D-040] [cob:D:D-041] [cob:D:D-042] «Fecha de emisión › Personalizado» muestra Desde/Hasta y filtra por la emisión (2025-01-10 sí, 2022-01-10 no)", sinFechas === 0 && claves.includes(V.clave) && !claves.includes(PV.clave) && datos.items.every((x) => !x.vigente || (x.vigente.fecha_emision >= "2024-06-01" && x.vigente.fecha_emision <= "2025-06-30")), `${sinFechas} ${claves.length}`);
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await page.keyboard.press("Escape");
  // Mostrar obsoletos
  await page.locator(`[data-testid="sgc-tarjeta"][data-clave="${V.clave}"]`).waitFor();
  const sinObs = (await clavesTarjetas(page)).includes(OBX.clave);
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.getByRole("switch", { name: "Mostrar obsoletos" }).click();
  await page.keyboard.press("Escape");
  await page.locator(`[data-testid="sgc-tarjeta"][data-clave="${OBX.clave}"]`).waitFor();
  check("[cob:D:D-043] «Mostrar obsoletos» (quien consulta el histórico) agrega los obsoletos", !sinObs);
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.getByRole("switch", { name: "Mostrar obsoletos" }).click();
  await page.keyboard.press("Escape");
  // Orden
  await page.getByTestId("sgc-ordenar").click();
  const ordenes = await page.getByRole("menuitem").evaluateAll((xs) => xs.map((x) => x.textContent?.trim()));
  resp = respuesta(page, /\/api\/sgc\/documentos\?.*orden=titulo/);
  await page.getByRole("menuitem", { name: "Título A–Z" }).click();
  datos = await (await resp).json();
  await esperar(async () => (await page.getByTestId("sgc-tarjeta").evaluateAll((xs) => xs.map((x) => x.getAttribute("data-clave")))).join() === datos.items.map((x) => x.clave).join(), 10_000);
  const orden = await page.getByTestId("sgc-tarjeta").evaluateAll((xs) => xs.map((x) => x.getAttribute("data-clave")));
  const titulos = datos.items.map((x) => x.titulo);
  check("[cob:D:D-031] «Ordenar»: Clave · Título A–Z · Más recientes · Próxima revisión; «Título A–Z» ordena las tarjetas como la API", ordenes.join("|") === "Clave|Título A–Z|Más recientes|Próxima revisión" && orden.join() === datos.items.map((x) => x.clave).join() && titulos.every((x, i) => i === 0 || titulos[i - 1].localeCompare(x, "es", { sensitivity: "base" }) <= 0) && (await page.getByTestId("sgc-ordenar").innerText()).includes("Título A–Z"), ordenes.join("|"));
  // Tarjetas
  const tV = page.locator(`[data-testid="sgc-tarjeta"][data-clave="${V.clave}"]`);
  const texto = (await tV.innerText()).replace(/\s+/g, " ");
  check("[cob:D:D-046] [cob:D:D-047] la cuadrícula tiene una tarjeta por documento y cada una muestra clave, título y estado", (await page.getByTestId("sgc-tarjetas").getByTestId("sgc-tarjeta").count()) === datos.items.length && texto.includes(V.clave) && texto.includes(V.titulo) && /Vigente/.test(texto), texto.slice(0, 160));
  const curso = (await page.locator(`[data-testid="sgc-tarjeta"][data-clave="${RA.clave}"]`).getByTestId("sgc-tarjeta-en-curso").innerText()).trim();
  check("[cob:D:D-048] «En curso»: la tarjeta con revisión de trabajo dice «Rev. 2 en elaboración»; la vigente sin trabajo no lo dice", /Rev\. 2/.test(curso) && (await tV.getByTestId("sgc-tarjeta-en-curso").count()) === 0, curso);
  const mini = async (d) => esperar(async () => (await page.locator(`[data-testid="sgc-tarjeta"][data-clave="${d.clave}"]`).getByTestId("sgc-miniatura").getAttribute("data-con-imagen")) === "1", 25_000).then(Boolean);
  await tV.scrollIntoViewIfNeeded();
  const conImagen = await mini(V);
  await page.locator(`[data-testid="sgc-tarjeta"][data-clave="${RS.clave}"]`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  const restringida = await page.locator(`[data-testid="sgc-tarjeta"][data-clave="${RS.clave}"]`).getByTestId("sgc-miniatura").getAttribute("data-con-imagen");
  check("[cob:D:D-049] miniatura: un vigente de uso interno la genera; uno restringido se queda con el ícono", conImagen && restringida === "0", `${conImagen} ${restringida}`);
  await tV.click();
  await page.waitForURL((u) => u.pathname === `/documentos/${V.id}`);
  check("[cob:D:D-047] la tarjeta abre la ficha del documento", true);
  // Vacío
  await page.goto(`${BASE_WEB}/documentos/explorar?area=TC`);
  await page.getByPlaceholder("Buscar por clave, título o palabras clave").fill(`nada-coincide-${s}`);
  await page.getByTestId("sgc-vacio").waitFor();
  check("[cob:D:D-045] búsqueda sin coincidencias: estado vacío «Nada coincide» y sin tarjetas", /Nada coincide/.test(await page.getByTestId("sgc-vacio").innerText()) && (await page.getByTestId("sgc-tarjeta").count()) === 0);
  // Origen
  await page.goto(`${BASE_WEB}/documentos/explorar?area=GC`);
  await page.getByTestId("sgc-tarjetas").waitFor();
  await page.getByPlaceholder("Buscar por clave, título o palabras clave").fill(s);
  await page.locator(`[data-testid="sgc-tarjeta"][data-clave="${IDE}"]`).waitFor();
  resp = respuesta(page, /\/api\/sgc\/documentos\?.*origen=externo/);
  await filtro(page, "Origen", "Externos");
  datos = await (await resp).json();
  await esperar(async () => (await clavesTarjetas(page)).join() === datos.items.map((x) => x.clave).sort().join(), 10_000);
  claves = await clavesTarjetas(page);
  check("[cob:D:D-038] filtro «Origen» (externos): quedan los externos y no los internos de la gestión", claves.includes(IDE) && !claves.includes(AZ2.clave) && datos.items.every((x) => x.origen === "externo"), claves.join());
  check("[cob:D:D-007] la tarjeta de un externo lleva la insignia «Externo»; la de un interno no", (await page.locator(`[data-testid="sgc-tarjeta"][data-clave="${IDE}"]`).getByTestId("etiqueta-externo").count()) === 1);
  await page.goto(`${BASE_WEB}/documentos/${V.id}`);
  await listo(page);
  const internoSin = (await page.getByTestId("sgc-ficha").getByTestId("etiqueta-externo").count()) === 0;
  await page.goto(`${BASE_WEB}/documentos/${E}`);
  await listo(page);
  check("[cob:D:D-007] en la ficha: «Externo» en el externo y no en el interno", internoSin && (await page.getByTestId("sgc-ficha").getByTestId("etiqueta-externo").count()) === 1);
});

/* ---------- Bandeja: contadores, tareas y cada acción con su destino ---------- */
/* Pulsa la acción de la tarea (grupo + texto) y devuelve la URL a la que lleva (antes de que la ficha quite ?accion=). */
async function irA(page, grupo, texto, testid = "bandeja-tarea") {
  const sel = grupo === "lecturas" ? page.getByTestId("bandeja-lecturas").getByTestId("bandeja-lectura").filter({ hasText: texto }) : tarea(page, grupo, texto);
  const etiqueta = (await sel.getByTestId("bandeja-accion").innerText()).trim();
  const tipo = await sel.getAttribute("data-tipo");
  const destinos = [];
  const oir = (f) => f === page.mainFrame() && destinos.push(f.url());
  page.on("framenavigated", oir);
  await sel.getByTestId("bandeja-accion").click();
  await page.waitForURL((u) => u.pathname !== "/documentos/bandeja");
  page.off("framenavigated", oir);
  const primera = new URL(destinos.find((u) => !/\/documentos\/bandeja/.test(u)) || page.url());
  return { etiqueta, tipo, ruta: primera.pathname + primera.search, testid };
}
async function contadores(page, datos) {
  const out = [];
  for (const g of await page.getByTestId("bandeja-grupo").all()) {
    const clave = await g.getAttribute("data-grupo");
    const valor = Number(await g.getByTestId("bandeja-contador").getAttribute("data-valor"));
    const n = await g.getByTestId("bandeja-tarea").count();
    const tipos = await g.getByTestId("bandeja-tarea").evaluateAll((xs) => xs.map((x) => x.getAttribute("data-tipo")));
    out.push({ clave, valor, n, tipos });
  }
  return { out, ok: out.every((g) => g.valor === g.n) && out.reduce((a, g) => a + g.n, 0) === datos.items.length };
}

await paso("ana", "bandeja: contadores, tipos y acciones de Mejora Continua", async (page) => {
  const resp = respuesta(page, /\/api\/sgc\/bandeja/);
  await page.goto(`${BASE_WEB}/documentos/bandeja`);
  const datos = await (await resp).json();
  await page.getByTestId("bandeja-grupo").first().waitFor();
  const c = await contadores(page, datos);
  check("[cob:D:D-247] cada grupo dice cuántas tareas tiene (data-valor = renglones) y suman lo que respondió la API", c.ok, JSON.stringify(c.out.map((g) => `${g.clave}:${g.valor}/${g.n}`)));
  const tipos = Object.fromEntries(datos.items.map((x) => [x.clave_documento + "|" + x.tipo, x.tipo]));
  const tAZ2 = tarea(page, "publicar", AZ2.clave);
  check("[cob:D:D-248] cada tarea lleva su data-tipo (publicar, solicitud, pendiente_revision) como la API", (await tAZ2.getAttribute("data-tipo")) === "publicar" && tipos[`${AZ2.clave}|publicar`] === "publicar" && (await tarea(page, "periodica", PR.clave).getAttribute("data-tipo")) === "pendiente_revision" && (await tarea(page, "solicitud", `Formato propuesto ${s}`).getAttribute("data-tipo")) === "solicitud");
  let r = await irA(page, "publicar", AZ2.clave);
  await ventana(page).waitFor();
  check("[cob:D:D-250] «Publicar» lleva a la ficha con ?accion=sgc-publicar y abre la ventana de publicar", r.etiqueta === "Publicar" && r.ruta === `/documentos/${AZ2.id}?accion=sgc-publicar` && (await ventana(page).innerText()).includes(`Publicar ${AZ2.clave} rev.`), JSON.stringify(r));
  await page.keyboard.press("Escape");
  await page.goto(`${BASE_WEB}/documentos/bandeja`);
  r = await irA(page, "solicitud", `Formato propuesto ${s}`);
  await page.getByTestId("sgc-solicitud-detalle").waitFor();
  check("[cob:D:D-257] «Atender» lleva a /documentos/solicitudes?abrir=ID y abre el detalle de la solicitud", r.etiqueta === "Atender" && r.ruta === `/documentos/solicitudes?abrir=${SN}` && (await page.getByTestId("sgc-solicitud-detalle").innerText()).includes(`Formato propuesto ${s}`), JSON.stringify(r));
  await page.goto(`${BASE_WEB}/documentos/bandeja`);
  r = await irA(page, "periodica", PR.clave);
  await listo(page);
  check("[cob:D:D-258] «Ver documento» lleva a la ficha del documento pendiente de revisión (sin abrir ventana)", r.etiqueta === "Ver documento" && r.ruta === `/documentos/${PR.id}` && (await ventana(page).count()) === 0, JSON.stringify(r));
});

await paso("patricia", "bandeja: autorizar, autorizar renovación y ver solicitud", async (page) => {
  const resp = respuesta(page, /\/api\/sgc\/bandeja/);
  await page.goto(`${BASE_WEB}/documentos/bandeja`);
  const datos = await (await resp).json();
  await page.getByTestId("bandeja-grupo").first().waitFor();
  const c = await contadores(page, datos);
  check("[cob:D:D-247] [cob:D:D-248] contadores y tipos de la autorizadora (autorizar, renovacion_autorizar, obsolescencia)", c.ok && (await tarea(page, "renovacion", RN2.clave).getAttribute("data-tipo")) === "renovacion_autorizar" && (await tarea(page, "obsolescencia", OB.clave).getAttribute("data-tipo")) === "obsolescencia", JSON.stringify(c.out.map((g) => `${g.clave}:${g.valor}/${g.n}`)));
  let r = await irA(page, "autorizar", AU.clave);
  await ventana(page).waitFor();
  check("[cob:D:D-251] «Autorizar» lleva a ?accion=sgc-autorizar y abre «Autorizar <clave> rev. N»", r.etiqueta === "Autorizar" && r.ruta === `/documentos/${AU.id}?accion=sgc-autorizar` && (await ventana(page).innerText()).includes(`Autorizar ${AU.clave} rev.`), JSON.stringify(r));
  await page.keyboard.press("Escape");
  await page.goto(`${BASE_WEB}/documentos/bandeja`);
  r = await irA(page, "renovacion", RN2.clave);
  await ventana(page).waitFor();
  check("[cob:D:D-254] «Autorizar renovación» lleva a ?accion=sgc-renovacion-autorizar y abre «Autorizar la renovación de <clave>»", r.etiqueta === "Autorizar renovación" && r.ruta === `/documentos/${RN2.id}?accion=sgc-renovacion-autorizar` && (await ventana(page).innerText()).includes(`Autorizar la renovación de ${RN2.clave}`), JSON.stringify(r));
  await page.keyboard.press("Escape");
  await page.goto(`${BASE_WEB}/documentos/bandeja`);
  r = await irA(page, "obsolescencia", OB.clave);
  check("[cob:D:D-259] «Ver solicitud» lleva a «Por autorizar» con la solicitud de obsolescencia abierta", r.etiqueta === "Ver solicitud" && r.ruta === `/solicitudes?abrir=${obsOB.data?.solicitud?.id}`, JSON.stringify(r));
});

await paso("gabriela", "bandeja: revisar y confirmar vigencia", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/bandeja`);
  await page.getByTestId("bandeja-grupo").first().waitFor();
  check("[cob:D:D-248] tarea de revisión con data-tipo=revisar y de renovación con data-tipo=renovacion_revisar", (await tarea(page, "revisar", RV.clave).getAttribute("data-tipo")) === "revisar" && (await tarea(page, "renovacion", RN.clave).getAttribute("data-tipo")) === "renovacion_revisar");
  let r = await irA(page, "revisar", RV.clave);
  await ventana(page).waitFor();
  check("[cob:D:D-252] «Revisar» lleva a ?accion=sgc-revisar y abre «Revisar <clave> rev. N»", r.etiqueta === "Revisar" && r.ruta === `/documentos/${RV.id}?accion=sgc-revisar` && (await ventana(page).innerText()).includes(`Revisar ${RV.clave} rev.`), JSON.stringify(r));
  await page.keyboard.press("Escape");
  await page.goto(`${BASE_WEB}/documentos/bandeja`);
  r = await irA(page, "renovacion", RN.clave);
  await ventana(page).waitFor();
  check("[cob:D:D-253] «Confirmar vigencia» lleva a ?accion=sgc-renovacion-revisar y abre «Confirmar la vigencia de <clave>»", r.etiqueta === "Confirmar vigencia" && r.ruta === `/documentos/${RN.id}?accion=sgc-renovacion-revisar` && (await ventana(page).innerText()).includes(`Confirmar la vigencia de ${RN.clave}`), JSON.stringify(r));
  await page.keyboard.press("Escape");
});

await paso("luis", "bandeja: abrir borrador, corregir y leer", async (page) => {
  const resp = respuesta(page, /\/api\/sgc\/bandeja/);
  await page.goto(`${BASE_WEB}/documentos/bandeja`);
  const datos = await (await resp).json();
  await page.getByTestId("bandeja-grupo").first().waitFor();
  const lecturas = page.getByTestId("bandeja-lecturas");
  check("[cob:D:D-261] «Lecturas pendientes» (#lecturas) con su contador, igual a las lecturas de la API", (await lecturas.getAttribute("id")) === "lecturas" && Number(await lecturas.getByTestId("bandeja-contador").getAttribute("data-valor")) === datos.lecturas_pendientes.length && (await lecturas.getByTestId("bandeja-lectura").count()) === datos.lecturas_pendientes.length);
  check("[cob:D:D-248] el borrador devuelto es data-tipo=corregir y el otro data-tipo=elaborar", (await tarea(page, "elaborar", DV.clave).getAttribute("data-tipo")) === "corregir" && (await tarea(page, "elaborar", B.clave).getAttribute("data-tipo")) === "elaborar");
  let r = await irA(page, "elaborar", B.clave);
  await listo(page);
  check("[cob:D:D-255] «Abrir borrador» lleva a la ficha del borrador (sin abrir ventana)", r.etiqueta === "Abrir borrador" && r.ruta === `/documentos/${B.id}` && (await ventana(page).count()) === 0, JSON.stringify(r));
  await page.goto(`${BASE_WEB}/documentos/bandeja`);
  r = await irA(page, "elaborar", DV.clave);
  await listo(page);
  check("[cob:D:D-256] «Corregir» (revisión devuelta) lleva a la ficha del borrador", r.etiqueta === "Corregir" && r.ruta === `/documentos/${DV.id}`, JSON.stringify(r));
  await page.goto(`${BASE_WEB}/documentos/bandeja#lecturas`);
  const lect = page.getByTestId("bandeja-lectura").filter({ hasText: LD.clave });
  await lect.waitFor();
  const aLaVista = await esperar(() => lecturas.evaluate((el) => el.getBoundingClientRect().top < window.innerHeight), 5000);
  check("[cob:D:D-262] la lectura pendiente es un renglón con su clave, título y «Leer»; /bandeja#lecturas baja a esa sección", (await lect.innerText()).includes(LD.titulo) && !!aLaVista);
  r = await irA(page, "lecturas", LD.clave);
  await page.locator("#acuse").waitFor();
  check("[cob:D:D-260] [cob:D:D-262] «Leer» lleva a la ficha con ?leer=1 (al acuse de la lectura)", r.etiqueta === "Leer" && r.ruta === `/documentos/${LD.id}?leer=1`, JSON.stringify(r));
});

await paso(nueva, "bandeja vacía", async (page) => {
  const resp = respuesta(page, /\/api\/sgc\/bandeja/);
  await page.goto(`${BASE_WEB}/documentos/bandeja`);
  const datos = await (await resp).json();
  const vacio = datos.items.length === 0 && datos.lecturas_pendientes.length === 0;
  if (vacio) await page.getByTestId("bandeja-vacia").waitFor();
  else await page.getByTestId(datos.items.length ? "bandeja-grupo" : "bandeja-lecturas").first().waitFor();
  check("[cob:D:D-237] sin tareas ni lecturas: «No tienes pendientes» (bandeja-vacia) y ningún grupo", vacio && (await page.getByTestId("bandeja-vacia").innerText()).includes("No tienes pendientes") && (await page.getByTestId("bandeja-grupo").count()) === 0, JSON.stringify({ items: datos.items.length, lecturas: datos.lecturas_pendientes.length }));
});

await paso("ana", "bandeja con pendientes: sin el estado vacío", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/bandeja`);
  await page.getByTestId("bandeja-grupo").first().waitFor();
  check("[cob:D:D-237] con tareas no aparece «No tienes pendientes»", (await page.getByTestId("bandeja-vacia").count()) === 0);
});

/* ---------- Ficha: encabezado, avisos, secciones y pestañas ---------- */
await paso("ana", "ficha: no encontrado, encabezado, avisos y secciones", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/999999999`);
  await page.getByTestId("sgc-no-encontrado").waitFor();
  check("[cob:D:D-050] un documento que no existe: «Documento no encontrado» (sin ficha)", (await page.getByTestId("sgc-ficha").count()) === 0 && /no encontrado/i.test(await page.getByTestId("sgc-no-encontrado").innerText()));
  await page.goto(`${BASE_WEB}/documentos/${PO.id}`);
  await listo(page);
  const encabezado = page.getByTestId("sgc-ficha");
  check("[cob:D:D-051] [cob:D:D-052] encabezado con data-clave, la clave en sgc-clave y sin aria-busy con los datos cargados", (await encabezado.getAttribute("data-clave")) === PO.clave && (await page.getByTestId("sgc-clave").innerText()).trim() === PO.clave && (await encabezado.getAttribute("aria-busy")) === null);
  check("[cob:D:D-079] sin nada que avisar no hay franja de avisos", (await page.getByTestId("sgc-avisos").count()) === 0);
  // Detalles (pestaña por omisión sin trabajo en curso) y metadatos.
  const detalles = page.getByTestId("sgc-pestana-detalles");
  const meta = (await page.getByTestId("sgc-metadatos").innerText()).replace(/\s+/g, " ");
  check("[cob:D:D-087] sin trabajo en curso la pestaña por omisión es Detalles", (await detalles.isVisible()) && (await page.getByRole("tab", { name: "Detalles" }).getAttribute("aria-selected")) === "true");
  check("[cob:D:D-090] metadatos: gestión, tipo documental y propietario del documento", meta.includes("Gestión") && meta.includes("TC ·") && meta.includes("Tipo documental") && meta.includes(`Propietario ${nombre[id.ricardo]}`), meta.slice(0, 300));
  check("[cob:D:D-091] un interno no tiene la sección de seguimiento del externo", (await page.getByTestId("sgc-externo").count()) === 0);
  // Revisión vigente con su visor.
  await page.getByTestId("sgc-visor").locator("canvas").first().waitFor({ timeout: 60_000 });
  check("[cob:D:D-085] [cob:D:D-086] la sección de la revisión vigente muestra el visor del PDF", (await page.getByTestId("sgc-vigente").getByTestId("sgc-visor").count()) === 1);
  // Avisos
  await page.goto(`${BASE_WEB}/documentos/${OBX.id}`);
  await listo(page);
  const obs = (await page.getByTestId("sgc-aviso-obsoleto").innerText()).replace(/\s+/g, " ");
  check("[cob:D:D-079] [cob:D:D-080] obsoleto: «Documento obsoleto. Retirado del uso el … Motivo: …» en la franja de avisos", (await page.getByTestId("sgc-avisos").getByTestId("sgc-aviso-obsoleto").count()) === 1 && /^Documento obsoleto\. Retirado del uso el \d\d\/\d\d\/\d{4}\. Motivo: Se retiró el procedimiento/.test(obs), obs);
  await page.goto(`${BASE_WEB}/documentos/${PV.id}`);
  await listo(page);
  const pend = (await page.getByTestId("sgc-aviso-pendiente").innerText()).replace(/\s+/g, " ");
  check("[cob:D:D-081] próxima revisión pasada: «Pendiente de revisión. Próxima revisión: 10/01/2025»", pend.startsWith("Pendiente de revisión. Próxima revisión: 10/01/2025"), pend);
  await page.goto(`${BASE_WEB}/documentos/${V.id}`);
  await listo(page);
  check("[cob:D:D-081] próxima revisión en 2028: sin el aviso", (await page.getByTestId("sgc-aviso-pendiente").count()) === 0);
  await page.goto(`${BASE_WEB}/documentos/${OB.id}`);
  await listo(page);
  const avisoOB = (await page.getByTestId("sgc-avisos").innerText()).replace(/\s+/g, " ");
  check("[cob:D:D-082] obsolescencia pendiente: «Obsolescencia solicitada. Solicitud #<id>»", avisoOB.includes(`Obsolescencia solicitada. Solicitud #${obsOB.data?.solicitud?.id}`), avisoOB);
  // Externo sin PDF y documento sin vigente.
  await page.goto(`${BASE_WEB}/documentos/${EN}`);
  await listo(page);
  const vEN = (await page.getByTestId("sgc-vigente").innerText()).replace(/\s+/g, " ");
  const ext = (await page.getByTestId("sgc-externo").innerText()).replace(/\s+/g, " ");
  check("[cob:D:D-085] [cob:D:D-086] vigente sin PDF: «Sin PDF de consulta» y sin visor", vEN.includes("Sin PDF de consulta") && (await page.getByTestId("sgc-visor").count()) === 0, vEN);
  check("[cob:D:D-091] externo: «Seguimiento del documento externo» con emisor, versión y responsable, sin botones", ext.includes("SSA") && ext.includes("2019") && ext.includes(nombre[id.ricardo]) && (await page.getByTestId("sgc-externo").getByRole("button").count()) === 0, ext.slice(0, 300));
  await page.goto(`${BASE_WEB}/documentos/${CI2.id}`);
  await listo(page);
  check("[cob:D:D-085] sin revisión vigente: «Sin revisión vigente»", (await page.getByTestId("sgc-vigente").innerText()).includes("Sin revisión vigente"));
  // Revisiones: renovación, revisión en curso, fecha límite, archivos, línea de tiempo e historial.
  await page.goto(`${BASE_WEB}/documentos/${RN.id}`);
  await listo(page);
  const ren = (await page.getByTestId("sgc-pestana-revisiones").getByTestId("sgc-renovacion").innerText()).replace(/\s+/g, " ");
  check("[cob:D:D-092] renovación abierta: revisor, autorizador y nueva próxima revisión en «Renovación de vigencia»", ren.includes(nombre[id.gabriela]) && ren.includes(nombre[id.patricia]) && ren.includes("Nueva próxima revisión"), ren);
  await page.goto(`${BASE_WEB}/documentos/${V.id}`);
  await listo(page);
  check("[cob:D:D-092] [cob:D:D-093] sin renovación ni trabajo en curso: sin esas secciones", (await page.getByTestId("sgc-renovacion").count()) === 0 && (await page.getByTestId("sgc-en-curso").count()) === 0);
  await page.goto(`${BASE_WEB}/documentos/${B.id}`);
  await listo(page);
  const curso = page.getByTestId("sgc-en-curso");
  const limite = (await curso.getByTestId("sgc-fecha-limite").innerText()).trim();
  check("[cob:D:D-093] [cob:D:D-094] revisión en curso con «Fecha límite: dd/mm/aaaa · vencida» cuando ya pasó", /^Revisión \d+ en curso/.test((await curso.innerText()).trim()) && limite === `Fecha límite: ${fmt(enDias(-3))} · vencida`, limite);
  const archivo = curso.locator('[data-testid="sgc-archivo"][data-tipo="pdf"]');
  const dl = page.waitForEvent("download");
  await archivo.getByRole("button", { name: /Descargar/ }).click();
  const descarga = await dl;
  check("[cob:D:D-098] el archivo PDF de la revisión en curso (data-tipo=pdf) se descarga", (await archivo.count()) === 1 && /\.pdf$/.test(descarga.suggestedFilename()), descarga.suggestedFilename());
  await page.goto(`${BASE_WEB}/documentos/${RV.id}`);
  await listo(page);
  const pasos = await page.getByTestId("sgc-en-curso").getByTestId("sgc-linea-tiempo").locator("li[data-accion]").evaluateAll((xs) => xs.map((x) => x.getAttribute("data-accion")));
  const enBD = filas("SELECT accion FROM sgc_flujo_acciones WHERE revision_id = ? ORDER BY id", RV.revision_id).map((x) => x.accion);
  check("[cob:D:D-095] línea de tiempo: un renglón por acción registrada de la revisión (incluye el envío a revisión)", pasos.includes("enviar_revision") && [...pasos].sort().join() === [...enBD].sort().join(), `${pasos.join(",")} vs ${enBD.join(",")}`);
  await page.goto(`${BASE_WEB}/documentos/${OBX.id}`);
  await listo(page);
  await page.getByRole("tab", { name: "Revisiones" }).click();
  const historial = page.getByTestId("sgc-historial");
  await historial.locator(":scope > summary").click();
  const filasH = await historial.locator(":scope > div").getByTestId("sgc-historial-fila").evaluateAll((xs) => xs.map((x) => `${x.getAttribute("data-numero")}:${x.getAttribute("data-estado")}`));
  const revsBD = filas("SELECT numero, estado FROM sgc_revisiones WHERE documento_id = ?", OBX.id).map((x) => `${x.numero}:${x.estado}`);
  check("[cob:D:D-096] [cob:D:D-097] historial: «Historial de revisiones (N)» con un renglón por revisión (número y estado)", /Historial de revisiones\s*\(1\)/.test(await historial.locator(":scope > summary").innerText()) && filasH.join() === revsBD.join() && filasH.join() === "1:obsoleta", `${filasH.join()} vs ${revsBD.join()}`);
  // Distribución
  await page.goto(`${BASE_WEB}/documentos/${LD.id}`);
  await listo(page);
  await page.getByRole("tab", { name: "Lecturas" }).click();
  const dist = page.getByTestId("sgc-pestana-lecturas").getByTestId("sgc-distribucion");
  const filasD = await dist.getByTestId("dist-fila").evaluateAll((xs) => xs.map((x) => x.textContent?.replace(/\s+/g, " ").trim()));
  const avance = dist.getByTestId("dist-avance");
  check("[cob:D:D-099] [cob:D:D-203] «Distribución y lecturas»: un renglón por destinatario (Luis, con «Lectura»)", filasD.length === 1 && filasD[0].includes(nombre[id.luis]) && filasD[0].includes("Lectura"), filasD.join(" / "));
  check("[cob:D:D-202] avance de lecturas: 0 de 1 leídas (0 %)", (await avance.getAttribute("data-porcentaje")) === "0" && (await avance.locator(".sr-only").innerText()).trim() === "0 de 1 leídas (0 %)", await avance.locator(".sr-only").innerText());
  // Recordatorio a las pendientes (D-207)
  const rec = dist.getByTestId("dist-recordatorio");
  check("[cob:D:D-207] «Enviar recordatorio» habilitado con una lectura pendiente", (await rec.count()) === 1 && !(await rec.isDisabled()));
  await rec.click();
  const conf = page.locator('[role="alertdialog"], [role="dialog"]').filter({ hasText: "Las personas con la lectura pendiente" });
  await conf.getByRole("button", { name: "Enviar", exact: true }).click();
  const notif = await esperar(() => fila("SELECT notificado_en FROM sgc_lecturas WHERE revision_id = ? AND usuario_id = ? AND notificado_en IS NOT NULL", LD.revision_id, id.luis));
  check("[cob:D:D-207] al confirmar se marca a Luis como recordado (notificado_en) y su renglón lo dice", !!notif?.notificado_en && (await esperar(async () => /recordado/.test(await dist.getByTestId("dist-persona-estado").first().innerText()), 10_000)), JSON.stringify(notif));
});

await paso("jorge", "ficha en vista de diagnóstico", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${V.id}`);
  await listo(page);
  const avisos = (await page.getByTestId("sgc-avisos").innerText()).replace(/\s+/g, " ");
  check("[cob:D:D-084] administración técnica: aviso «Solo metadatos (diagnóstico)» y sin visor", avisos.includes("Solo metadatos (diagnóstico)") && (await page.getByTestId("sgc-visor").count()) === 0, avisos);
  check("[cob:D:D-085] [cob:D:D-086] …la sección vigente dice «Sin vista del archivo»", (await page.getByTestId("sgc-vigente").innerText()).includes("Sin vista del archivo"));
  check("[cob:D:D-075] [cob:D:D-076] sin abrir archivos no se ofrecen las descargas", (await contarAccion(page, "sgc-descargar-pdf")) === 0 && (await contarAccion(page, "sgc-descargar-fuente")) === 0);
  await page.goto(`${BASE_WEB}/documentos/${B.id}`);
  await listo(page);
  const archivo = page.getByTestId("sgc-en-curso").locator('[data-testid="sgc-archivo"][data-tipo="pdf"]');
  await archivo.waitFor({ state: "attached" });
  check("[cob:D:D-098] en diagnóstico el archivo de la revisión en curso se lista sin el botón para descargarlo", (await archivo.count()) === 1 && (await archivo.getByRole("button", { name: /Descargar/ }).count()) === 0);
});

await paso("ana", "ficha: sin aviso de diagnóstico para Mejora Continua", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${V.id}`);
  await listo(page);
  check("[cob:D:D-084] Mejora Continua no ve «Solo metadatos»", (await page.getByText("Solo metadatos").count()) === 0);
});

/* ---------- Ficha: acciones según papel ---------- */
await paso("gabriela", "ficha: revisar (revisora asignada) y lo que no le toca", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${RV.id}`);
  check("[cob:D:D-055] revisora asignada en revisión: la acción principal es «Revisar»", (await principal(page)) === "sgc-revisar");
  await page.goto(`${BASE_WEB}/documentos/${AU.id}`);
  check("[cob:D:D-056] la revisora no tiene «Autorizar» en una revisión en autorización", (await contarAccion(page, "sgc-autorizar")) === 0 || !(await habilitada(page, "sgc-autorizar")));
  await page.goto(`${BASE_WEB}/documentos/${DV.id}`);
  const t1 = await motivo(page, "sgc-subir-archivo");
  const des = await page.getByRole("menu").getByTestId("sgc-subir-archivo").getAttribute("aria-disabled");
  await cerrarMenu(page);
  check("[cob:D:D-065] quien no es la elaboradora asignada ve «Cargar o sustituir archivo» deshabilitado con su motivo", des === "true" && /Solo el elaborador asignado/.test(t1), t1);
  check("[cob:D:D-060] tampoco «Enviar a revisión» habilitado", !(await habilitada(page, "sgc-enviar-revision")));
});

await paso("luis", "ficha: lo que no le toca al elaborador", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${RV.id}`);
  check("[cob:D:D-055] el elaborador no puede revisar", !(await habilitada(page, "sgc-revisar")));
  await page.goto(`${BASE_WEB}/documentos/${CI2.id}`);
  check("[cob:D:D-061] sin documento_publicar no hay «Registrar vigente»", (await contarAccion(page, "sgc-registrar-vigente")) === 0);
  await page.goto(`${BASE_WEB}/documentos/${V.id}`);
  check("[cob:D:D-077] con calidad:V solo de incidencias no hay «Ver en Auditoría»", (await contarAccion(page, "sgc-ver-auditoria")) === 0);
  check("[cob:D:D-066] [cob:D:D-070] [cob:D:D-071] [cob:D:D-072] [cob:D:D-073] [cob:D:D-074] sin crear_ficha, administrar lecturas ni obsoletar no se ofrecen esas acciones", (await contarAccion(page, "sgc-nueva-revision")) + (await contarAccion(page, "sgc-renovar")) + (await contarAccion(page, "sgc-editar")) + (await contarAccion(page, "dist-agregar")) + (await contarAccion(page, "sgc-obsoletar")) === 0);
  await page.goto(`${BASE_WEB}/documentos/${RA.id}`);
  check("[cob:D:D-066] sin crear_ficha no se ofrece «Reasignar responsables»", (await contarAccion(page, "sgc-reasignar")) === 0);
  await page.goto(`${BASE_WEB}/documentos/${E}`);
  check("[cob:D:D-067] [cob:D:D-068] sin externo_gestionar: ni nueva versión ni editar seguimiento", (await contarAccion(page, "ext-nueva-version")) + (await contarAccion(page, "ext-editar")) === 0);
  // Proponer cambio
  await page.goto(`${BASE_WEB}/documentos/${V.id}`);
  await (await accion(page, "sgc-proponer")).click();
  await ventana(page).waitFor();
  const textoV = (await ventana(page).innerText()).replace(/\s+/g, " ");
  check("[cob:D:D-069] «Proponer cambio» abre la solicitud de cambio de este documento (sin elegir área ni documento)", textoV.includes(V.clave) && (await page.locator("#sol-area").count()) === 0 && (await page.locator("#sol-documento").count()) === 0 && (await page.locator("#sol-justificacion").count()) === 1, textoV.slice(0, 200));
  await page.locator("#sol-justificacion").fill(`Cambio propuesto desde la ficha ${s}`);
  await page.getByTestId("solicitud-guardar").click();
  await cerrada(page);
  const sol = await esperar(() => fila("SELECT tipo, documento_id FROM sgc_solicitudes WHERE solicitante_id = ? AND justificacion = ?", id.luis, `Cambio propuesto desde la ficha ${s}`));
  check("[cob:D:D-069] …y al enviarla queda una solicitud de cambio de ese documento", sol?.tipo === "cambio" && Number(sol?.documento_id) === V.id, JSON.stringify(sol));
});

await paso("diego", "ficha: consulta y descarga", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${V.id}`);
  await listo(page);
  check("[cob:D:D-069] sin documento_proponer no hay «Proponer cambio»", (await contarAccion(page, "sgc-proponer")) === 0);
  const dl = page.waitForEvent("download");
  await (await accion(page, "sgc-descargar-pdf")).click();
  const d = await dl;
  check("[cob:D:D-075] «Descargar PDF» del vigente baja el PDF y queda en la bitácora", /\.pdf$/.test(d.suggestedFilename()) && !!(await esperar(() => fila("SELECT id FROM auditoria WHERE usuario_id = ? AND entidad = 'sgc_documentos' AND entidad_id = ? AND accion = 'descargar'", id.diego, String(V.id)), 10_000)), d.suggestedFilename());
  check("[cob:D:D-076] sin archivo fuente vigente no hay «Descargar archivo fuente»", (await contarAccion(page, "sgc-descargar-fuente")) === 0);
  await page.goto(`${BASE_WEB}/documentos/${EN}`);
  await listo(page);
  check("[cob:D:D-054] sin ninguna acción posible no aparece el menú «Más acciones»", (await page.getByRole("button", { name: "Más acciones" }).count()) === 0 && (await page.locator('[data-principal="1"]').count()) === 0);
  await page.goto(`${BASE_WEB}/documentos/${LD.id}`);
  await listo(page);
  check("[cob:D:D-062] quien no es destinatario no tiene «Confirmar lectura»", (await contarAccion(page, "acuse-confirmar")) === 0 && (await page.getByTestId("acuse-pendiente").count()) === 0);
  await page.goto(`${BASE_WEB}/documentos/${EN}`);
  check("[cob:D:D-063] [cob:D:D-283] quien no es responsable ni gestiona externos no verifica la vigencia", (await contarAccion(page, "ext-verificar")) === 0);
});

await paso("ana", "ficha: acciones de Mejora Continua", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${V.id}`);
  await listo(page);
  check("[cob:D:D-054] con acciones disponibles aparece «Más acciones»", (await page.getByRole("button", { name: "Más acciones" }).count()) === 1);
  check("[cob:D:D-070] [cob:D:D-072] [cob:D:D-073] [cob:D:D-074] Nueva revisión, Editar metadatos, Agregar destinatarios y Declarar obsoleto habilitados", (await habilitada(page, "sgc-nueva-revision")) && (await habilitada(page, "sgc-editar")) && (await habilitada(page, "dist-agregar")) && (await habilitada(page, "sgc-obsoletar")));
  check("[cob:D:D-071] con la próxima revisión en 2028 «Renovar sin cambios» no está disponible", !(await habilitada(page, "sgc-renovar")));
  await (await accion(page, "sgc-ver-auditoria")).click();
  await page.waitForURL((u) => u.pathname === "/auditoria");
  const u = new URL(page.url());
  check("[cob:D:D-077] «Ver en Auditoría» lleva a la bitácora filtrada por la clave, el área documentos y todo el periodo", u.searchParams.get("buscar") === V.clave && u.searchParams.get("area") === "documentos" && u.searchParams.get("periodo") === "todo", page.url());
  await page.goto(`${BASE_WEB}/documentos/${PRU.id}`);
  check("[cob:D:D-071] con la revisión periódica a 14 días, «Renovar sin cambios» habilitado", await habilitada(page, "sgc-renovar"));
  await page.goto(`${BASE_WEB}/documentos/${OBX.id}`);
  await listo(page);
  check("[cob:D:D-072] [cob:D:D-074] un obsoleto no se edita ni se vuelve a declarar obsoleto", !(await habilitada(page, "sgc-editar")) && !(await habilitada(page, "sgc-obsoletar")));
  await page.goto(`${BASE_WEB}/documentos/${E}`);
  check("[cob:D:D-067] [cob:D:D-068] externo vigente: nueva versión y editar seguimiento habilitados", (await habilitada(page, "ext-nueva-version")) && (await habilitada(page, "ext-editar")));
  await page.goto(`${BASE_WEB}/documentos/${EOX}`);
  check("[cob:D:D-067] [cob:D:D-068] externo obsoleto: sin nueva versión ni editar seguimiento", !(await habilitada(page, "ext-nueva-version")) && !(await habilitada(page, "ext-editar")));
  await page.goto(`${BASE_WEB}/documentos/${RA.id}`);
  check("[cob:D:D-066] Mejora Continua (crear_ficha) puede reasignar el borrador", await habilitada(page, "sgc-reasignar"));
  // Archivo fuente
  await page.goto(`${BASE_WEB}/documentos/${FU.id}`);
  await listo(page);
  const dl = page.waitForEvent("download");
  await (await accion(page, "sgc-descargar-fuente")).click();
  const d = await dl;
  check("[cob:D:D-076] «Descargar archivo fuente» baja el .docx de la revisión vigente", /\.docx$/.test(d.suggestedFilename()), d.suggestedFilename());
  // Publicar (acción principal) y Registrar vigente
  await page.goto(`${BASE_WEB}/documentos/${AZ2.id}`);
  check("[cob:D:D-057] revisión autorizada: «Publicar» es la acción principal de Mejora Continua", (await principal(page)) === "sgc-publicar");
  await page.goto(`${BASE_WEB}/documentos/${CI2.id}`);
  check("[cob:D:D-061] primera revisión sin vigente: «Registrar vigente (carga inicial)» habilitado", await habilitada(page, "sgc-registrar-vigente"));
});

await paso("ricardo", "ficha: sin publicar, crear ficha ni administrar lecturas", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${AZ2.id}`);
  check("[cob:D:D-057] sin documento_publicar no hay «Publicar»", !(await habilitada(page, "sgc-publicar")));
  await page.goto(`${BASE_WEB}/documentos/${V.id}`);
  check("[cob:D:D-070] [cob:D:D-073] [cob:D:D-074] sin crear_ficha, administrar lecturas ni obsoletar", (await contarAccion(page, "sgc-nueva-revision")) + (await contarAccion(page, "dist-agregar")) + (await contarAccion(page, "sgc-obsoletar")) === 0);
  check("[cob:D:D-077] con calidad:V total aparece «Ver en Auditoría»", (await contarAccion(page, "sgc-ver-auditoria")) === 1);
  await page.goto(`${BASE_WEB}/documentos/${E}`);
  check("[cob:D:D-067] el responsable sin externo_gestionar no registra nuevas versiones", (await contarAccion(page, "ext-nueva-version")) === 0);
  await page.goto(`${BASE_WEB}/documentos/${EN}`);
  check("[cob:D:D-063] responsable de seguimiento: «Verificar vigencia» es su acción principal", (await principal(page)) === "ext-verificar");
  await (await accion(page, "ext-verificar")).click();
  await ventana(page).waitFor();
  await page.locator("#ver-comentario").fill("abc");
  await fecha(page, "ver-proxima", enDias(200));
  const r1 = await intentar(page, "ver-guardar", ["ver-comentario"]);
  check("[cob:D:D-223] comentario de verificación de menos de 5 caracteres: se marca #ver-comentario y no se verifica", r1.todos && fila("SELECT proxima_revision FROM sgc_externos WHERE documento_id = ?", EN)?.proxima_revision === enDias(365), r1.texto);
  await page.locator("#ver-comentario").fill(`Consultado el portal de la SSA ${s}`);
  await page.getByTestId("ver-guardar").click();
  await cerrada(page);
  const ext = await esperar(() => fila("SELECT ultima_revision, proxima_revision FROM sgc_externos WHERE documento_id = ? AND proxima_revision = ?", EN, enDias(200)));
  check("[cob:D:D-063] [cob:D:D-225] «Sigue vigente» guarda la verificación de hoy y la próxima elegida", ext?.ultima_revision === HOY, JSON.stringify(ext));
});

/* ---------- Flujo en pantalla ---------- */
await paso("luis", "ficha: enviar a revisión con confirmación", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${B.id}`);
  await (await accion(page, "sgc-enviar-revision")).click();
  const conf = page.locator('[role="alertdialog"], [role="dialog"]').filter({ hasText: "Enviar a revisión la revisión" });
  await conf.waitFor();
  await conf.getByRole("button", { name: "Cancelar" }).click();
  await conf.waitFor({ state: "detached" });
  check("[cob:D:D-102] cancelar la confirmación no envía la revisión", fila("SELECT estado FROM sgc_revisiones WHERE id = ?", B.revision_id)?.estado === "borrador");
  await (await accion(page, "sgc-enviar-revision")).click();
  await conf.getByRole("button", { name: "Enviar a revisión", exact: true }).click();
  const rev = await esperar(() => fila("SELECT estado FROM sgc_revisiones WHERE id = ? AND estado = 'en_revision'", B.revision_id));
  check("[cob:D:D-060] [cob:D:D-102] «Enviar a revisión» pide confirmación y deja la revisión en revisión", !!rev);
  // La base cambia antes de que llegue la respuesta: el aviso marca que la ficha ya empezó a recargar (listo espera el fin).
  await page.locator("[data-sonner-toast]").filter({ hasText: /revisi/i }).first().waitFor();
  await listo(page);
  check("[cob:D:D-060] ya enviada, «Enviar a revisión» deja de estar disponible", !(await habilitada(page, "sgc-enviar-revision")));
});

await paso("luis", "ficha: editar el borrador devuelto, sus archivos y su envío", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${DV.id}`);
  check("[cob:D:D-064] elaborador en el borrador devuelto: «Editar datos de la revisión» habilitado", await habilitada(page, "sgc-editar-revision"));
  check("[cob:D:D-065] …y «Cargar o sustituir archivo» habilitado", await habilitada(page, "sgc-subir-archivo"));
  await (await accion(page, "sgc-subir-archivo")).click();
  await ventana(page).waitFor();
  const r1 = await intentar(page, "archivo-guardar", ["archivo-sgc"]);
  const antes = Number(fila("SELECT COUNT(*) AS n FROM sgc_archivos WHERE revision_id = ?", DV.revision_id)?.n);
  check("[cob:D:D-162] «Subir» sin archivo: «Elige el archivo» en #archivo-sgc y no se carga nada", r1.todos && /Elige el archivo/.test(r1.texto) && antes === 1, r1.texto);
  const tipoInicial = await page.locator("#archivo-tipo").inputValue();
  await page.locator("#archivo-tipo").selectOption("pdf");
  await ventana(page).getByLabel("Elegir archivo").setInputFiles(TXT);
  const r2 = await intentar(page, "archivo-guardar", ["archivo-sgc"]);
  check("[cob:D:D-161] un .txt como PDF de consulta: «Formato no permitido» en #archivo-sgc", r2.todos && /Formato no permitido/.test(r2.texto), `${tipoInicial} · ${r2.texto}`);
  await ventana(page).getByLabel("Elegir archivo").setInputFiles(await pdf("corregido.pdf", `Corregido ${s}`));
  await page.getByTestId("archivo-guardar").click();
  await cerrada(page);
  const sust = await esperar(() => fila("SELECT COUNT(*) AS n FROM sgc_archivos WHERE revision_id = ? AND tipo = 'pdf' AND reemplazado_en IS NOT NULL", DV.revision_id).n === 1);
  check("[cob:D:D-065] [cob:D:D-161] [cob:D:D-162] con un PDF se sustituye el de la revisión (el anterior queda reemplazado)", !!sust && Number(fila("SELECT COUNT(*) AS n FROM sgc_archivos WHERE revision_id = ? AND tipo = 'pdf' AND reemplazado_en IS NULL", DV.revision_id)?.n) === 1);
  await listo(page);
  await (await accion(page, "sgc-editar-revision")).click();
  await ventana(page).waitFor();
  await masOpciones(ventana(page));
  check("[cob:D:D-154] al editar la revisión se ofrece #rev-emision", await page.locator("#rev-emision").isVisible());
  await page.locator("#rev-apartados").fill(`Alcance y responsabilidades ${s}`);
  await page.locator("#rev-descripcion").fill(`Se corrige el alcance ${s}`);
  await fecha(page, "rev-emision", enDias(5));
  // La recarga de la ficha tras guardar se retrasa: mientras tanto el encabezado queda aria-busy.
  const rutaFicha = new RegExp(`/api/sgc/documentos/${DV.id}$`);
  await page.route(rutaFicha, async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await page.getByTestId("revision-guardar").click();
  await cerrada(page);
  const ocupada = await esperar(async () => (await page.getByTestId("sgc-ficha").getAttribute("aria-busy")) === "true", 2000);
  await page.unroute(rutaFicha);
  await listo(page);
  check("[cob:D:D-051] tras guardar, la ficha queda aria-busy hasta que llegan los datos nuevos y luego se quita", !!ocupada && (await page.getByTestId("sgc-ficha").getAttribute("aria-busy")) === null);
  const r = await esperar(() => fila("SELECT apartados_afectados, descripcion_cambio, fecha_emision FROM sgc_revisiones WHERE id = ? AND apartados_afectados = ?", DV.revision_id, `Alcance y responsabilidades ${s}`));
  check("[cob:D:D-064] [cob:D:D-151] [cob:D:D-152] [cob:D:D-154] guardar el borrador conserva apartados, descripción y fecha de emisión", r?.descripcion_cambio === `Se corrige el alcance ${s}` && r?.fecha_emision === enDias(5), JSON.stringify(r));
  check("[cob:D:D-060] con PDF y los datos del cambio, el elaborador tiene «Enviar a revisión» habilitado", await habilitada(page, "sgc-enviar-revision"));
});

/* ---------- Decisiones, publicar, renovar y obsoletar en pantalla ---------- */
await paso("gabriela", "renovación: confirmar la vigencia con comentario", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${RN.id}`);
  check("[cob:D:D-058] revisora de la renovación: «Confirmar vigencia» es la acción principal", (await principal(page)) === "sgc-renovacion-revisar");
  await (await accion(page, "sgc-renovacion-revisar")).click();
  await ventana(page).waitFor();
  const r1 = await intentar(page, "decision-guardar", ["decision-comentario"]);
  const nid = fila("SELECT id FROM sgc_renovaciones WHERE documento_id = ? ORDER BY id DESC", RN.id)?.id;
  check("[cob:D:D-104] «Confirmar vigencia» sin comentario: se marca #decision-comentario y la renovación sigue en revisión", r1.todos && /comentario/.test(r1.texto) && fila("SELECT estado FROM sgc_renovaciones WHERE id = ?", nid)?.estado === "en_revision", r1.texto);
  await page.locator("#decision-comentario").fill("Sigue vigente sin cambios");
  await page.getByTestId("decision-guardar").click();
  await cerrada(page);
  const ren = await esperar(() => fila("SELECT estado FROM sgc_renovaciones WHERE id = ? AND estado = 'en_autorizacion'", nid));
  const fl = fila("SELECT decision, comentario FROM sgc_flujo_acciones WHERE renovacion_id = ? ORDER BY id DESC", nid);
  check("[cob:D:D-058] [cob:D:D-104] [cob:D:D-105] con comentario la renovación pasa a autorización y el comentario queda registrado", !!ren && fl?.comentario === "Sigue vigente sin cambios", JSON.stringify(fl));
});

await paso("patricia", "renovación: autorizar con contraseña", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${RN.id}`);
  check("[cob:D:D-059] autorizadora de la renovación: «Autorizar renovación» es la acción principal", (await principal(page)) === "sgc-renovacion-autorizar");
  await (await accion(page, "sgc-renovacion-autorizar")).click();
  await ventana(page).waitFor();
  await page.getByTestId("decision-guardar").click();
  await clave(page, "patricia");
  await cerrada(page);
  const ren = await esperar(() => fila("SELECT estado, fecha_proxima_nueva FROM sgc_renovaciones WHERE documento_id = ? AND estado = 'completada'", RN.id));
  const rev = fila("SELECT fecha_proxima_revision FROM sgc_revisiones WHERE id = ?", RN.revision_id);
  check("[cob:D:D-059] [cob:D:D-105] autorizar (sin comentario obligatorio) completa la renovación y mueve la próxima revisión", !!ren && rev?.fecha_proxima_revision === ren.fecha_proxima_nueva, JSON.stringify({ ren, rev }));
  const check1 = await page.getByTestId("confirmacion-check").innerText().catch(() => "");
  check("[cob:D:D-009] al autorizar aparece la confirmación con el check «Renovación autorizada»", /Renovación autorizada/.test(check1), check1);
});

await paso("gabriela", "renovación: ya no le toca a la revisora", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${RN.id}`);
  await listo(page);
  check("[cob:D:D-058] [cob:D:D-059] completada la renovación no quedan «Confirmar vigencia» ni «Autorizar renovación»", (await contarAccion(page, "sgc-renovacion-revisar")) + (await contarAccion(page, "sgc-renovacion-autorizar")) === 0);
});

await paso("ana", "publicar AZ2: próxima revisión y distribución", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${AZ2.id}`);
  await (await accion(page, "sgc-publicar")).click();
  await ventana(page).waitFor();
  const interruptor = page.getByTestId("pub-distribucion").getByRole("switch", { name: /Definir la distribución/ });
  check("[cob:D:D-110] quien administra lecturas ve «Definir la distribución» (apagado por omisión)", (await interruptor.count()) === 1 && (await interruptor.getAttribute("aria-checked")) === "false");
  await interruptor.click();
  const r0 = await intentar(page, "publicar-guardar", ["pub-destinatarios"]);
  check("[cob:D:D-110] encendido y sin destinatarios: no se publica («Elige al menos un rol o una persona»)", r0.todos && /Elige al menos un rol o una persona/.test(r0.texto), r0.texto);
  await interruptor.click();
  await masOpciones(ventana(page), /^Más opciones \(vigencia/);
  const proxPorOmision = await page.locator("#pub-proxima").inputValue();
  await fecha(page, "pub-proxima", HOY);
  const r1 = await intentar(page, "publicar-guardar", ["pub-proxima"]);
  check("[cob:D:D-108] próxima revisión (por omisión emisión + 3 años) que no es posterior a la vigencia: se marca #pub-proxima y no se publica", proxPorOmision === fmt(`${Number(HOY.slice(0, 4)) + 3}${HOY.slice(4)}`) && r1.todos && /posterior a la vigencia/.test(r1.texto) && fila("SELECT estado FROM sgc_revisiones WHERE id = ?", AZ2.revision_id)?.estado === "autorizada", `${proxPorOmision} · ${r1.texto}`);
  await fecha(page, "pub-proxima", "2029-02-01");
  await page.getByTestId("publicar-guardar").click();
  await clave(page, "ana");
  await cerrada(page);
  const rev = await esperar(() => fila("SELECT estado, fecha_proxima_revision FROM sgc_revisiones WHERE id = ? AND estado = 'vigente'", AZ2.revision_id));
  check("[cob:D:D-057] [cob:D:D-108] [cob:D:D-112] «Publicar» deja la revisión vigente con la próxima revisión elegida", rev?.fecha_proxima_revision === "2029-02-01" && fila("SELECT estado FROM sgc_documentos WHERE id = ?", AZ2.id)?.estado === "vigente", JSON.stringify(rev));
});

await paso("ana", "renovar sin cambios: responsables e inicio", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${PRU.id}`);
  await (await accion(page, "sgc-renovar")).click();
  await ventana(page).waitFor();
  const revs = (await opciones(page, "ren-revisor")).map((o) => o.value).filter(Boolean).map(Number);
  const auts = (await opciones(page, "ren-autorizador")).map((o) => o.value).filter(Boolean).map(Number);
  check("[cob:D:D-119] [cob:D:D-120] Revisor solo con «revisar» y Autorizador solo con «autorizar»", revs.includes(id.gabriela) && !revs.includes(id.luis) && auts.includes(id.patricia) && !auts.includes(id.gabriela), `${revs.join(",")} · ${auts.join(",")}`);
  const r1 = await intentar(page, "renovar-guardar", ["ren-revisor", "ren-autorizador"]);
  check("[cob:D:D-119] [cob:D:D-120] sin revisor ni autorizador: se marcan los dos («Elige al revisor», «Elige al autorizador»)", r1.todos && /Elige al revisor/.test(r1.texto) && /Elige al autorizador/.test(r1.texto), r1.texto);
  await page.locator("#ren-revisor").selectOption(String(id.ricardo));
  await page.locator("#ren-autorizador").selectOption(String(id.ricardo));
  const r2 = await intentar(page, "renovar-guardar", ["ren-autorizador"]);
  check("[cob:D:D-120] revisor y autorizador la misma persona: «deben ser personas distintas» y no se inicia", r2.todos && /personas distintas/.test(r2.texto) && !fila("SELECT id FROM sgc_renovaciones WHERE documento_id = ?", PRU.id), r2.texto);
  await page.locator("#ren-autorizador").selectOption(String(id.patricia));
  await page.getByTestId("renovar-guardar").click();
  await cerrada(page);
  const ren = await esperar(() => fila("SELECT estado, revisor_id, autorizador_id FROM sgc_renovaciones WHERE documento_id = ?", PRU.id));
  check("[cob:D:D-071] [cob:D:D-119] [cob:D:D-120] [cob:D:D-123] «Iniciar renovación» abre la renovación en revisión con esos responsables", ren?.estado === "en_revision" && Number(ren.revisor_id) === id.ricardo && Number(ren.autorizador_id) === id.patricia, JSON.stringify(ren));
});

let solOB2 = null;
await paso("ana", "declarar obsoleto: motivo y solicitud", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${OB2.id}`);
  await (await accion(page, "sgc-obsoletar")).click();
  await ventana(page).waitFor();
  await page.locator("#obs-motivo").fill("abc");
  const r1 = await intentar(page, "obsoletar-guardar", ["obs-motivo"]);
  check("[cob:D:D-124] motivo de menos de 5 caracteres: se marca #obs-motivo y no se crea la solicitud", r1.todos && /al menos 5/.test(r1.texto) && !fila("SELECT id FROM solicitudes_autorizacion WHERE tipo = 'obsoletar_documento_sgc' AND entidad_id = ? AND estado = 'pendiente'", String(OB2.id)), r1.texto);
  await page.locator("#obs-motivo").fill("Se sustituye por otro procedimiento");
  await page.getByTestId("obsoletar-guardar").click();
  await clave(page, "ana");
  await cerrada(page);
  solOB2 = await esperar(() => fila("SELECT id, motivo FROM solicitudes_autorizacion WHERE estado = 'pendiente' AND entidad_id = ? AND motivo = ?", String(OB2.id), "Se sustituye por otro procedimiento"));
  await listo(page);
  const avisos = (await page.getByTestId("sgc-avisos").innerText()).replace(/\s+/g, " ");
  check("[cob:D:D-074] [cob:D:D-125] «Solicitar obsolescencia» crea la solicitud de segundo usuario (el documento sigue vigente)", !!solOB2 && fila("SELECT estado FROM sgc_documentos WHERE id = ?", OB2.id)?.estado === "vigente" && avisos.includes(`Obsolescencia solicitada. Solicitud #${solOB2?.id}`), JSON.stringify(solOB2));
  check("[cob:D:D-074] con la solicitud pendiente «Declarar obsoleto» queda deshabilitado", !(await habilitada(page, "sgc-obsoletar")));
});

/* ---------- Acuse de lectura ---------- */
await paso("luis", "confirmar la lectura de la instrucción", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${LD.id}`);
  await listo(page);
  const pendiente = (await page.getByTestId("acuse-pendiente").innerText()).replace(/\s+/g, " ");
  check("[cob:D:D-200] destinatario con lectura pendiente: aviso «requiere que confirmes su lectura» bajo el visor", pendiente.includes("requiere que confirmes su lectura") && pendiente.includes("Mesa de lecturas") && (await page.getByTestId("acuse-hecho").count()) === 0, pendiente);
  check("[cob:D:D-062] [cob:D:D-201] «Confirmar lectura» es la acción principal (habilitada aunque el PDF no se haya terminado de abrir: el servidor lo exige)", (await principal(page)) === "acuse-confirmar" && !(await page.locator('[data-principal="1"][data-testid="acuse-confirmar"]').isDisabled()));
  await page.getByTestId("sgc-visor").locator("canvas").first().waitFor({ timeout: 60_000 });
  const abierto = await esperar(() => fila("SELECT abierto_en FROM sgc_lecturas WHERE revision_id = ? AND usuario_id = ? AND abierto_en IS NOT NULL", LD.revision_id, id.luis));
  await (await accion(page, "acuse-confirmar")).click();
  const conf = page.locator('[role="alertdialog"], [role="dialog"]').filter({ hasText: "Queda registrado con tu usuario" });
  await conf.getByRole("button", { name: "Confirmo", exact: true }).click();
  const lectura = await esperar(() => fila("SELECT leido_en FROM sgc_lecturas WHERE revision_id = ? AND usuario_id = ? AND leido_en IS NOT NULL", LD.revision_id, id.luis));
  const marca = await page.getByTestId("confirmacion-check").innerText().catch(() => "");
  check("[cob:D:D-009] confirmar la lectura muestra el check «Lectura confirmada»", /Lectura confirmada/.test(marca), marca);
  await page.getByTestId("acuse-hecho").waitFor();
  check("[cob:D:D-062] [cob:D:D-086] [cob:D:D-201] abrir el PDF en el visor marca abierto_en y «Confirmo» registra la lectura (leido_en)", !!abierto && !!lectura);
  check("[cob:D:D-199] ya confirmada: «Confirmaste la lectura de la revisión 1 el …» y sin acción de confirmar", /Confirmaste la lectura de la revisión 1 el \d\d\/\d\d\/\d{4}/.test(await page.getByTestId("acuse-hecho").innerText()) && (await page.getByTestId("acuse-pendiente").count()) === 0 && (await contarAccion(page, "acuse-confirmar")) === 0);
});

await paso("ana", "lecturas: avance, estado por persona y recordatorio sin pendientes", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${LD.id}`);
  await listo(page);
  await page.getByRole("tab", { name: "Lecturas" }).click();
  const dist = page.getByTestId("sgc-distribucion");
  const persona = dist.getByTestId("dist-persona-estado").filter({ hasText: nombre[id.luis] });
  check("[cob:D:D-206] la persona que confirmó aparece «Leído …» (data-leido=1)", (await persona.getAttribute("data-leido")) === "1" && /Leído \d\d\/\d\d\/\d{4}/.test(await persona.innerText()));
  check("[cob:D:D-202] avance: 1 de 1 leídas (100 %)", (await dist.getByTestId("dist-avance").getAttribute("data-porcentaje")) === "100" && (await dist.getByTestId("dist-avance").locator(".sr-only").innerText()).trim() === "1 de 1 leídas (100 %)");
  const rec = dist.getByTestId("dist-recordatorio");
  const titulo = await rec.getAttribute("title").catch(() => null);
  check("[cob:D:D-207] sin lecturas pendientes «Enviar recordatorio» queda deshabilitado con su motivo (o no se ofrece)", (await rec.count()) === 0 || ((await rec.isDisabled()) && !!titulo), String(titulo));
});

/* ---------- Distribución: agregar con validaciones ---------- */
await paso("ana", "agregar destinatarios: casillas, motivo y guardar", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${PO.id}`);
  await (await accion(page, "dist-agregar")).click();
  await ventana(page).waitFor();
  const v = ventana(page);
  const hector = v.locator("label", { hasText: nombre[id.hector] }).getByTestId("dist-persona");
  const luisC = v.locator("label", { hasText: nombre[id.luis] }).getByTestId("dist-persona");
  const textoH = (await v.locator("label", { hasText: nombre[id.hector] }).innerText()).replace(/\s+/g, " ");
  check("[cob:D:D-191] con lectura requerida, quien no puede confirmar lecturas (auditor) aparece deshabilitado «No puede confirmar lecturas»; Luis no", (await hector.isDisabled()) && textoH.includes("No puede confirmar lecturas") && !(await luisC.isDisabled()), textoH);
  const r1 = await intentar(page, "dist-guardar", ["dist-destinatarios"]);
  check("[cob:D:D-195] sin destinatarios: «Elige al menos un rol o una persona» y nada se guarda", r1.todos && /Elige al menos un rol o una persona/.test(r1.texto) && !fila("SELECT id FROM sgc_distribucion WHERE revision_id = ?", PO.revision_id), r1.texto);
  await luisC.check();
  await page.locator("#dist-motivo").fill("abc");
  const r2 = await intentar(page, "dist-guardar", ["dist-motivo"]);
  check("[cob:D:D-194] motivo de menos de 5 caracteres: se marca #dist-motivo", r2.todos && /al menos 5/.test(r2.texto), r2.texto);
  await page.locator("#dist-motivo").fill("Lectura obligatoria del procedimiento");
  await page.getByTestId("dist-guardar").click();
  await clave(page, "ana");
  await cerrada(page);
  const d = await esperar(() => fila("SELECT requiere_lectura, motivo FROM sgc_distribucion WHERE revision_id = ? AND usuario_id = ? AND retirado_en IS NULL", PO.revision_id, id.luis));
  check("[cob:D:D-191] [cob:D:D-194] [cob:D:D-195] «Agregar destinatarios» guarda a Luis con lectura requerida y el motivo", Number(d?.requiere_lectura) === 1 && d?.motivo === "Lectura obligatoria del procedimiento", JSON.stringify(d));
  check("[cob:D:D-073] Agregar destinatarios (dist-agregar) abre su ventana y guarda", !!d);
});

/* Escribe en un campo y comprueba que quedó (tras cerrar un error del servidor la primera escritura puede perderse). */
/* Escribe una sola vez: tras el aviso del servidor lo escrito no se pierde (antes la limpieza del campo
   marcado, en captura, volvía a pintar el valor viejo antes del onChange: A-34 de la prueba integral). */
async function escribir(page, campo, valor) {
  await page.locator(`#${campo}`).fill(valor);
  await page.keyboard.press("Tab");
  check(`tras el aviso del servidor, lo escrito en #${campo} se conserva`, (await page.locator(`#${campo}`).inputValue()) === valor, await page.locator(`#${campo}`).inputValue());
}
/* Guarda y espera la ficha nueva; si en su lugar sale el resumen de validación, falla con su texto. */
async function guardarYAbrir(page, testid, quien = null) {
  await page.getByTestId(testid).click();
  if (quien) await clave(page, quien);
  const alerta = page.locator('[role="alertdialog"][data-validacion]');
  const r = await Promise.race([page.waitForURL((u) => /^\/documentos\/\d+$/.test(u.pathname), { timeout: 30_000 }).then(() => null), alerta.waitFor({ timeout: 30_000 }).then(() => alerta.innerText())]);
  if (r) throw new Error(`no se guardó: ${r.replace(/\s+/g, " ")}`);
}

/* ---------- Ventanas de formulario: Nueva ficha ---------- */
await paso("ana", "nueva ficha: campos obligatorios, responsables y propietario", async (page) => {
  const CLAVE = `FX-TCI-Z${s}`;
  await page.goto(`${BASE_WEB}/documentos/explorar?area=TC`);
  await page.getByTestId("sgc-tarjetas").waitFor();
  await page.getByTestId("sgc-nueva-ficha").click();
  await ventana(page).waitFor();
  check("[cob:D:D-010] [cob:D:D-029] «Nueva ficha» de la carpeta abre la ventana de formulario «Nueva ficha»", /Nueva ficha/.test(await ventana(page).innerText()) && (await page.locator("#ficha-area").inputValue()) === "TC");
  // Más opciones: plegado, «· N con datos» y se abre solo si un campo de dentro queda marcado.
  const mas = ventana(page).getByTestId("mas-opciones").first();
  const boton = mas.locator("button[aria-expanded]").first();
  const plegado = (await boton.getAttribute("aria-expanded")) === "false" && (await mas.getAttribute("data-abierta")) === "0";
  await boton.click();
  await page.locator("#ficha-proceso").fill("Proceso de prueba");
  await boton.click();
  const conDatos = (await boton.innerText()).replace(/\s+/g, " ");
  await boton.click();
  check("[cob:D:D-011] «Más opciones» empieza plegado; al plegarlo con datos dice «· 1 con datos»; aria-expanded cambia", plegado && /· 1 con datos/.test(conDatos) && (await boton.getAttribute("aria-expanded")) === "true", conDatos);
  await page.locator("#ficha-tipo").selectOption("");
  await page.locator("#ficha-clave").fill("ABC");
  await page.locator("#ficha-archivo-pdf").setInputFiles(await pdf("consulta-ficha.pdf", `Ficha ${s}`));
  const r1 = await intentar(page, "ficha-guardar", ["ficha-tipo", "ficha-clave", "ficha-titulo"]);
  check("[cob:D:D-127] sin tipo documental: se marca #ficha-tipo («Elige el tipo documental»)", r1.marcados["ficha-tipo"] && /tipo documental/.test(r1.texto), r1.texto);
  check("[cob:D:D-128] clave que no cumple el formato FX-…: se marca #ficha-clave", r1.marcados["ficha-clave"] && /no cumple el formato|clave/.test(r1.texto), r1.texto);
  check("[cob:D:D-130] sin título: se marca #ficha-titulo («Indica el título completo»)", r1.marcados["ficha-titulo"] && /título completo/.test(r1.texto), r1.texto);
  await page.locator("#ficha-tipo").selectOption("I");
  await page.locator("#ficha-clave").fill(V.clave);
  await page.locator("#ficha-titulo").fill(`Instrucción con propietario ${s}`);
  // Responsables y propietario: cada selector ofrece solo a quien tiene la acción documental.
  const ops = async (c) => (await opciones(page, c)).map((o) => Number(o.value)).filter(Boolean);
  const [elab, revi, auto, prop] = [await ops("ficha-elaborador"), await ops("ficha-revisor"), await ops("ficha-autorizador"), await ops("ficha-propietario")];
  check("[cob:D:D-141] Elaborador: personas con «elaborar» (Luis sí; el auditor no)", elab.includes(id.luis) && !elab.includes(id.hector), elab.join(","));
  check("[cob:D:D-142] Revisor: personas con «revisar» (Gabriela sí; Luis no)", revi.includes(id.gabriela) && !revi.includes(id.luis), revi.join(","));
  check("[cob:D:D-143] Autorizador: personas con «autorizar» (Patricia sí; Gabriela no)", auto.includes(id.patricia) && !auto.includes(id.gabriela), auto.join(","));
  check("[cob:D:D-136] Propietario: «Sin asignar» y las personas con cuenta activa (no la dada de baja)", (await page.locator("#ficha-propietario option").first().textContent()).trim() === "Sin asignar" && prop.includes(id.ricardo) && !prop.includes(idBaja), prop.join(","));
  await page.locator("#ficha-elaborador").selectOption(String(id.ricardo));
  await page.locator("#ficha-revisor").selectOption(String(id.ricardo));
  await page.locator("#ficha-autorizador").selectOption(String(id.patricia));
  const r2 = await intentar(page, "ficha-guardar", ["ficha-elaborador"]);
  check("[cob:D:D-141] [cob:D:D-142] [cob:D:D-143] elaborador y revisor la misma persona: «tres personas distintas» en #ficha-elaborador", r2.todos && /tres personas distintas/.test(r2.texto), r2.texto);
  await page.locator("#ficha-elaborador").selectOption(String(id.luis));
  await page.locator("#ficha-revisor").selectOption(String(id.gabriela));
  await masOpciones(ventana(page));
  await page.locator("#ficha-propietario").selectOption(String(id.ricardo));
  const r3 = await intentar(page, "ficha-guardar", ["ficha-clave"]);
  check("[cob:D:D-128] clave repetida: el servidor la rechaza en #ficha-clave y no se crea otra", r3.tipo === "servidor" && r3.todos && Number(fila("SELECT COUNT(*) AS n FROM sgc_documentos WHERE clave = ?", V.clave)?.n) === 1, r3.texto);
  await escribir(page, "ficha-clave", CLAVE);
  await guardarYAbrir(page, "ficha-guardar");
  const doc = fila("SELECT id, tipo_codigo, titulo, propietario_id FROM sgc_documentos WHERE clave = ?", CLAVE);
  const rev = doc ? fila("SELECT id, elaborador_id, revisor_id, autorizador_id, estado FROM sgc_revisiones WHERE documento_id = ?", doc.id) : null;
  const archivos = rev ? filas("SELECT tipo, extension FROM sgc_archivos WHERE revision_id = ?", rev.id) : [];
  check("[cob:D:D-145] «Crear ficha» guarda la ficha y abre su página", !!doc && new URL(page.url()).pathname === `/documentos/${doc.id}` && doc.tipo_codigo === "I" && doc.titulo === `Instrucción con propietario ${s}`, JSON.stringify(doc));
  check("[cob:D:D-136] el propietario elegido queda en la ficha", Number(doc?.propietario_id) === id.ricardo, JSON.stringify(doc));
  check("[cob:D:D-141] [cob:D:D-142] [cob:D:D-143] la revisión inicial queda en borrador con los tres responsables", rev?.estado === "borrador" && Number(rev.elaborador_id) === id.luis && Number(rev.revisor_id) === id.gabriela && Number(rev.autorizador_id) === id.patricia, JSON.stringify(rev));
  check("[cob:D:D-132] el PDF de consulta (opcional al crear) queda como archivo pdf de la revisión", archivos.length === 1 && archivos[0].tipo === "pdf" && archivos[0].extension === "pdf", JSON.stringify(archivos));
});

/* ---------- Nueva revisión: motivo y responsables ---------- */
let NV2 = null;
await paso("ana", "nueva revisión: motivo, responsables y guardar", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${NV.id}`);
  await (await accion(page, "sgc-nueva-revision")).click();
  await ventana(page).waitFor();
  check("[cob:D:D-154] al abrir una revisión nueva no se pide la fecha de emisión", (await page.locator("#rev-emision").count()) === 0);
  await page.locator("#rev-motivo").fill("abc");
  const r1 = await intentar(page, "revision-guardar", ["rev-motivo", "rev-elaborador"]);
  check("[cob:D:D-147] motivo de menos de 5 caracteres: se marca #rev-motivo", r1.marcados["rev-motivo"] && /motivo del cambio/.test(r1.texto), r1.texto);
  check("[cob:D:D-148] [cob:D:D-149] [cob:D:D-150] sin responsables: «Asigna elaborador, revisor y autorizador» en #rev-elaborador y no se abre", r1.marcados["rev-elaborador"] && /Asigna elaborador, revisor y autorizador/.test(r1.texto) && nRevisiones(NV.id) === 1, r1.texto);
  await page.locator("#rev-motivo").fill("Actualización del instructivo");
  const revi = (await opciones(page, "rev-revisor")).map((o) => Number(o.value)).filter(Boolean);
  const auto = (await opciones(page, "rev-autorizador")).map((o) => Number(o.value)).filter(Boolean);
  check("[cob:D:D-149] [cob:D:D-150] Revisor solo con «revisar» y Autorizador solo con «autorizar»", revi.includes(id.gabriela) && !revi.includes(id.luis) && auto.includes(id.patricia) && !auto.includes(id.gabriela), `${revi} · ${auto}`);
  await page.locator("#rev-elaborador").selectOption(String(id.luis));
  await page.locator("#rev-revisor").selectOption(String(id.gabriela));
  const r2 = await intentar(page, "revision-guardar", ["rev-elaborador"]);
  check("[cob:D:D-150] sin autorizador: «Asigna elaborador, revisor y autorizador»", r2.todos && /Asigna elaborador, revisor y autorizador/.test(r2.texto) && nRevisiones(NV.id) === 1, r2.texto);
  await page.locator("#rev-autorizador").selectOption(String(id.patricia));
  await page.locator("#rev-revisor").selectOption(String(id.ricardo));
  await page.locator("#rev-elaborador").selectOption(String(id.ricardo));
  const r3 = await intentar(page, "revision-guardar", ["rev-elaborador"]);
  check("[cob:D:D-148] [cob:D:D-149] elaborador y revisor la misma persona: «tres personas distintas»", r3.todos && /tres personas distintas/.test(r3.texto), r3.texto);
  await page.locator("#rev-elaborador").selectOption(String(id.luis));
  await page.locator("#rev-revisor").selectOption(String(id.gabriela));
  await page.getByTestId("revision-guardar").click();
  await cerrada(page);
  NV2 = await esperar(() => fila("SELECT id, motivo_cambio, elaborador_id, revisor_id, autorizador_id, apartados_afectados FROM sgc_revisiones WHERE documento_id = ? AND estado = 'borrador'", NV.id));
  check("[cob:D:D-147] [cob:D:D-148] [cob:D:D-149] [cob:D:D-150] [cob:D:D-159] «Abrir revisión» crea el borrador con el motivo y los tres responsables", NV2?.motivo_cambio === "Actualización del instructivo" && Number(NV2.elaborador_id) === id.luis && Number(NV2.revisor_id) === id.gabriela && Number(NV2.autorizador_id) === id.patricia, JSON.stringify(NV2));
});

await paso("luis", "nueva revisión: lo que falta para enviarla", async (page) => {
  if (!NV2) throw new Error("sin la revisión nueva de la prueba anterior");
  await page.goto(`${BASE_WEB}/documentos/${NV.id}`);
  const m1 = await motivo(page, "sgc-enviar-revision");
  await cerrarMenu(page);
  check("[cob:D:D-060] sin PDF de consulta «Enviar a revisión» queda deshabilitado: «Carga el PDF de consulta antes de enviarla»", /Carga el PDF de consulta/.test(m1), m1);
  await (await accion(page, "sgc-subir-archivo")).click();
  await ventana(page).waitFor();
  await ventana(page).getByLabel("Elegir archivo").setInputFiles(await pdf("rev2.pdf", `Revisión 2 ${s}`));
  await page.getByTestId("archivo-guardar").click();
  await cerrada(page);
  await esperar(() => fila("SELECT id FROM sgc_archivos WHERE revision_id = ? AND tipo = 'pdf'", NV2.id));
  await listo(page);
  const m2 = await motivo(page, "sgc-enviar-revision");
  await cerrarMenu(page);
  check("[cob:D:D-151] [cob:D:D-152] con PDF pero sin apartados ni descripción: «Completa el motivo del cambio, los apartados afectados y la descripción del cambio»", /los apartados afectados y la descripción del cambio/.test(m2), m2);
  await (await accion(page, "sgc-editar-revision")).click();
  await ventana(page).waitFor();
  await masOpciones(ventana(page));
  await page.locator("#rev-apartados").fill("Apartado 4");
  await page.locator("#rev-descripcion").fill("Se agrega el paso de verificación");
  await page.getByTestId("revision-guardar").click();
  await cerrada(page);
  await esperar(() => fila("SELECT id FROM sgc_revisiones WHERE id = ? AND apartados_afectados = 'Apartado 4' AND descripcion_cambio = 'Se agrega el paso de verificación'", NV2.id));
  await listo(page);
  check("[cob:D:D-151] [cob:D:D-152] [cob:D:D-159] con apartados y descripción guardados, «Enviar a revisión» es la acción principal", (await principal(page)) === "sgc-enviar-revision");
});

/* ---------- Registrar vigente: fecha de emisión obligatoria ---------- */
await paso("ana", "registrar vigente: emisión obligatoria", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/${CI2.id}`);
  await (await accion(page, "sgc-registrar-vigente")).click();
  await ventana(page).waitFor();
  await fecha(page, "rev-emision", "");
  const r1 = await intentar(page, "vigente-guardar", ["rev-emision"]);
  check("[cob:D:D-163] sin fecha de emisión: «Indica la fecha de emisión autorizada» en #rev-emision y sigue en borrador", r1.todos && /fecha de emisión autorizada/.test(r1.texto) && fila("SELECT estado FROM sgc_revisiones WHERE id = ?", CI2.revision_id)?.estado === "borrador", r1.texto);
  await fecha(page, "rev-emision", "2024-05-02");
  await page.getByTestId("vigente-guardar").click();
  await clave(page, "ana");
  await cerrada(page);
  const rev = await esperar(() => fila("SELECT fecha_emision FROM sgc_revisiones WHERE id = ? AND estado = 'vigente'", CI2.revision_id));
  check("[cob:D:D-061] [cob:D:D-163] [cob:D:D-167] «Registrar vigente» (con contraseña) deja la revisión vigente con la emisión indicada", rev?.fecha_emision === "2024-05-02" && fila("SELECT estado FROM sgc_documentos WHERE id = ?", CI2.id)?.estado === "vigente", JSON.stringify(rev));
});

/* ---------- Solicitudes: hoja, lista y aceptar ---------- */
await paso("luis", "nueva solicitud: obligatorios, apoyo y envío", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/solicitudes`);
  await page.getByTestId("sgc-nueva-solicitud").click();
  await ventana(page).waitFor();
  check("[cob:D:D-263] «Nueva solicitud» (documento_proponer) abre la hoja", /Nueva solicitud/.test(await ventana(page).innerText()));
  await page.locator("#sol-justificacion").fill("corta");
  await masOpciones(ventana(page));
  await page.locator("#sol-apoyo-input").setInputFiles({ name: "apoyo.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
  const r1 = await intentar(page, "solicitud-guardar", ["sol-area", "sol-tipo", "sol-titulo", "sol-justificacion", "sol-apoyo"]);
  check("[cob:D:D-170] sin gestión: se marca #sol-area («Elige el área de gestión»)", r1.marcados["sol-area"] && /área de gestión/.test(r1.texto), r1.texto);
  check("[cob:D:D-171] sin tipo documental: se marca #sol-tipo", r1.marcados["sol-tipo"] && /tipo documental/.test(r1.texto), r1.texto);
  check("[cob:D:D-172] sin título propuesto: se marca #sol-titulo", r1.marcados["sol-titulo"] && /título propuesto/.test(r1.texto), r1.texto);
  check("[cob:D:D-174] justificación de menos de 10 caracteres: se marca #sol-justificacion", r1.marcados["sol-justificacion"] && /al menos 10/.test(r1.texto), r1.texto);
  check("[cob:D:D-176] apoyo con extensión no permitida: «Formato no permitido» en #sol-apoyo", r1.marcados["sol-apoyo"] && /Formato no permitido/.test(r1.texto), r1.texto);
  check("[cob:D:D-171] los radios del tipo de solicitud usan name=sol-clase (no chocan con #sol-tipo)", (await page.locator('input[type="radio"][name="sol-clase"]').count()) === 2 && (await page.locator('[name="sol-tipo"]').count()) === 0);
  await page.locator("#sol-area").selectOption("GC");
  await page.locator("#sol-tipo").selectOption("F");
  await page.locator("#sol-titulo").fill(`Formato con apoyo ${s}`);
  await page.locator("#sol-justificacion").fill(`Hace falta un formato para el registro ${s}`);
  await page.locator("#sol-apoyo-input").setInputFiles(await pdf("apoyo.pdf", `Apoyo ${s}`));
  await page.getByTestId("solicitud-guardar").click();
  await cerrada(page);
  const sol = await esperar(() => fila("SELECT id, area_codigo, tipo_codigo, estado, apoyo_nombre_original, apoyo_sha256 FROM sgc_solicitudes WHERE titulo_propuesto = ?", `Formato con apoyo ${s}`));
  check("[cob:D:D-170] [cob:D:D-171] [cob:D:D-172] [cob:D:D-174] [cob:D:D-176] [cob:D:D-177] «Enviar solicitud» la registra pendiente con su archivo de apoyo", sol?.estado === "pendiente" && sol.area_codigo === "GC" && sol.tipo_codigo === "F" && sol.apoyo_nombre_original === "apoyo.pdf" && !!sol.apoyo_sha256, JSON.stringify(sol));
  await page.locator(`[data-solicitud="${sol?.id}"]`).waitFor();
  check("[cob:D:D-269] quien propone no tiene «Aceptar» en su solicitud", (await page.locator(`[data-solicitud="${sol?.id}"]`).getByTestId("sgc-solicitud-aceptar").count()) === 0);
});

await paso("diego", "solicitudes sin documento_proponer", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/solicitudes`);
  await page.getByRole("heading", { name: "Solicitudes" }).waitFor();
  await page.waitForTimeout(1000);
  check("[cob:D:D-263] sin documento_proponer no hay «Nueva solicitud»", (await page.getByTestId("sgc-nueva-solicitud").count()) === 0);
});

await paso("ana", "solicitudes: pestañas, gestión, renglón, apoyo, detalle y aceptar", async (page) => {
  const SA = fila("SELECT id FROM sgc_solicitudes WHERE titulo_propuesto = ?", `Formato con apoyo ${s}`)?.id;
  const SX = await solicitud({ tipo: "nuevo", area_codigo: "TC", tipo_codigo: "R", titulo_propuesto: `Registro técnico propuesto ${s}`, justificacion: `Registro para la gestión técnica ${s}` }, "mariana");
  const SZ = await solicitud({ tipo: "nuevo", area_codigo: "GC", tipo_codigo: "R", titulo_propuesto: `Registro ya rechazado ${s}`, justificacion: `Registro que no procede ${s}` }, "mariana");
  await api("POST", `/sgc/solicitudes/${SZ}/rechazar`, { motivo: "No procede en este momento" }, t.ana);
  await page.goto(`${BASE_WEB}/documentos/solicitudes`);
  await page.getByPlaceholder("Buscar por título, clave o solicitante").fill(s);
  await page.locator(`[data-solicitud="${SA}"]`).waitFor();
  const visibles = () => page.locator("[data-solicitud]").evaluateAll((xs) => xs.map((x) => Number(x.getAttribute("data-solicitud"))));
  const pend = await visibles();
  await page.getByRole("radio", { name: "Todas" }).click();
  await page.locator(`[data-solicitud="${SZ}"]`).waitFor();
  const todas = await visibles();
  check("[cob:D:D-264] «Pendientes» no muestra la rechazada; «Todas» sí", !pend.includes(SZ) && pend.includes(SA) && todas.includes(SZ) && todas.includes(SA), `${pend} · ${todas}`);
  const rz = page.locator(`[data-solicitud="${SZ}"]`);
  check("[cob:D:D-269] una solicitud rechazada no tiene «Aceptar» (sí la pendiente)", (await rz.getByTestId("sgc-solicitud-aceptar").count()) === 0 && (await page.locator(`[data-solicitud="${SA}"]`).getByTestId("sgc-solicitud-aceptar").count()) === 1);
  const texto = (await page.locator(`[data-solicitud="${SA}"]`).innerText()).replace(/\s+/g, " ");
  check("[cob:D:D-268] el renglón muestra folio, tipo, título, solicitante y estado", texto.includes(`#${SA}`) && texto.includes("Documento nuevo") && texto.includes(`Formato con apoyo ${s}`) && texto.includes(nombre[id.luis]) && /Pendiente/.test(texto), texto);
  await page.getByRole("radio", { name: "Pendientes" }).click();
  await rz.waitFor({ state: "detached" });
  await filtro(page, "Gestión", /^TC · /);
  await page.locator(`[data-solicitud="${SA}"]`).waitFor({ state: "detached" });
  const tc = await visibles();
  check("[cob:D:D-267] filtro «Gestión» (TC): solo las solicitudes de esa gestión", tc.includes(SX) && !tc.includes(SA), tc.join(","));
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await page.keyboard.press("Escape");
  await page.locator(`[data-solicitud="${SA}"]`).waitFor();
  // Archivo de apoyo
  await page.getByRole("button", { name: `Más acciones de la solicitud ${SA}` }).click();
  const dl = page.waitForEvent("download");
  await page.getByTestId("sgc-solicitud-apoyo").click();
  const d = await dl;
  check("[cob:D:D-271] «Ver archivo de apoyo» baja el archivo con su nombre original", d.suggestedFilename() === "apoyo.pdf", d.suggestedFilename());
  await page.getByRole("button", { name: `Más acciones de la solicitud ${SX}` }).click();
  check("[cob:D:D-271] sin archivo de apoyo no se ofrece", (await page.getByRole("menu").getByTestId("sgc-solicitud-apoyo").count()) === 0);
  await page.keyboard.press("Escape");
  // Detalle: ?abrir=ID, con Rechazar/Aceptar solo si está pendiente.
  await page.goto(`${BASE_WEB}/documentos/solicitudes?abrir=${SZ}`);
  const detZ = page.getByTestId("sgc-solicitud-detalle");
  await detZ.waitFor();
  const tz = (await detZ.innerText()).replace(/\s+/g, " ");
  check("[cob:D:D-273] ?abrir=ID abre el detalle (aunque no esté pendiente) con justificación y resolución", tz.includes(`#${SZ}`) && tz.includes(`Registro que no procede ${s}`) && tz.includes("No procede en este momento"), tz.slice(0, 300));
  check("[cob:D:D-274] [cob:D:D-275] el detalle de una solicitud resuelta no tiene Rechazar ni Aceptar", (await detZ.getByRole("button", { name: "Rechazar" }).count()) + (await detZ.getByRole("button", { name: "Aceptar" }).count()) === 0);
  await page.keyboard.press("Escape");
  await page.locator(`[data-solicitud="${SX}"]`).click();
  const detX = page.getByTestId("sgc-solicitud-detalle");
  await detX.waitFor();
  await detX.getByRole("button", { name: "Rechazar" }).click();
  await ventana(page).waitFor();
  check("[cob:D:D-274] «Rechazar» del detalle abre el rechazo de esa solicitud", (await ventana(page).innerText()).includes(`Rechazar la solicitud #${SX}`));
  await page.keyboard.press("Escape");
  await ventana(page).waitFor({ state: "detached" });
  await page.locator(`[data-solicitud="${SX}"]`).click();
  await detX.waitFor();
  await detX.getByRole("button", { name: "Aceptar" }).click();
  await ventana(page).waitFor();
  check("[cob:D:D-275] «Aceptar» del detalle abre la aceptación de esa solicitud", (await ventana(page).innerText()).includes(`Aceptar la solicitud #${SX}`));
  // Aceptar: clave, responsables, fecha límite y comentario.
  await page.locator("#acep-clave").fill("FX-GCR-MAL");
  const r1 = await intentar(page, "aceptar-guardar", ["acep-clave", "acep-elaborador"]);
  check("[cob:D:D-178] clave de otra gestión: se marca #acep-clave («La clave indica el área GC…»)", r1.marcados["acep-clave"] && /área GC/.test(r1.texto), r1.texto);
  check("[cob:D:D-180] [cob:D:D-181] [cob:D:D-182] sin responsables: «Asigna elaborador, revisor y autorizador» en #acep-elaborador", r1.marcados["acep-elaborador"] && /Asigna elaborador, revisor y autorizador/.test(r1.texto), r1.texto);
  await page.locator("#acep-clave").fill(V.clave.replace("FX-TCI-", "FX-TCR-"));
  const elab = (await opciones(page, "acep-elaborador")).map((o) => Number(o.value)).filter(Boolean);
  const revi = (await opciones(page, "acep-revisor")).map((o) => Number(o.value)).filter(Boolean);
  const auto = (await opciones(page, "acep-autorizador")).map((o) => Number(o.value)).filter(Boolean);
  check("[cob:D:D-180] [cob:D:D-181] [cob:D:D-182] cada selector ofrece solo a quien tiene esa acción (elaborar, revisar, autorizar)", elab.includes(id.luis) && !elab.includes(id.hector) && revi.includes(id.gabriela) && !revi.includes(id.luis) && auto.includes(id.patricia) && !auto.includes(id.gabriela), `${elab} · ${revi} · ${auto}`);
  await page.locator("#acep-elaborador").selectOption(String(id.ricardo));
  await page.locator("#acep-revisor").selectOption(String(id.ricardo));
  await page.locator("#acep-autorizador").selectOption(String(id.patricia));
  const r2 = await intentar(page, "aceptar-guardar", ["acep-elaborador"]);
  check("[cob:D:D-180] [cob:D:D-181] elaborador y revisor la misma persona: «tres personas distintas»", r2.todos && /tres personas distintas/.test(r2.texto), r2.texto);
  await page.locator("#acep-elaborador").selectOption(String(id.luis));
  await page.locator("#acep-revisor").selectOption(String(id.gabriela));
  await masOpciones(ventana(page));
  await fecha(page, "acep-limite", enDias(-1));
  const r3 = await intentar(page, "aceptar-guardar", ["acep-limite"]);
  check("[cob:D:D-185] fecha límite anterior a hoy: el servidor la rechaza en #acep-limite y la solicitud sigue pendiente", r3.tipo === "servidor" && r3.todos && fila("SELECT estado FROM sgc_solicitudes WHERE id = ?", SX)?.estado === "pendiente", r3.texto);
  await fecha(page, "acep-limite", enDias(30));
  await page.locator("#acep-comentario").fill(`Se acepta para la gestión técnica ${s}`);
  await guardarYAbrir(page, "aceptar-guardar");
  const sx = fila("SELECT estado, comentario_resolucion, clave_asignada, revision_id FROM sgc_solicitudes WHERE id = ?", SX);
  const rv = sx?.revision_id ? fila("SELECT fecha_limite, elaborador_id, revisor_id, autorizador_id FROM sgc_revisiones WHERE id = ?", sx.revision_id) : null;
  check("[cob:D:D-187] «Aceptar solicitud» crea la ficha con la clave asignada y abre su página", sx?.estado === "aceptada" && sx.clave_asignada === V.clave.replace("FX-TCI-", "FX-TCR-") && !!fila("SELECT id FROM sgc_documentos WHERE clave = ?", sx.clave_asignada), JSON.stringify(sx));
  check("[cob:D:D-178] [cob:D:D-180] [cob:D:D-181] [cob:D:D-182] [cob:D:D-185] la revisión inicial lleva los tres responsables y la fecha límite", rv?.fecha_limite === enDias(30) && Number(rv.elaborador_id) === id.luis && Number(rv.revisor_id) === id.gabriela && Number(rv.autorizador_id) === id.patricia, JSON.stringify(rv));
  check("[cob:D:D-186] el comentario opcional queda como resolución de la solicitud", sx?.comentario_resolucion === `Se acepta para la gestión técnica ${s}`, JSON.stringify(sx));
});

await paso("luis", "detalle de una solicitud sin poder atenderla", async (page) => {
  const SA = fila("SELECT id FROM sgc_solicitudes WHERE titulo_propuesto = ?", `Formato con apoyo ${s}`)?.id;
  await page.goto(`${BASE_WEB}/documentos/solicitudes?abrir=${SA}`);
  const det = page.getByTestId("sgc-solicitud-detalle");
  await det.waitFor();
  check("[cob:D:D-273] [cob:D:D-274] [cob:D:D-275] quien no atiende ve el detalle de su solicitud sin Rechazar ni Aceptar", (await det.innerText()).includes(`Formato con apoyo ${s}`) && (await det.getByRole("button", { name: "Rechazar" }).count()) + (await det.getByRole("button", { name: "Aceptar" }).count()) === 0);
});

/* ---------- Externos: registrar (validaciones) y página ---------- */
await paso("ana", "registrar externo: obligatorios, identificador, enlace, responsable y fechas", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/externos`);
  await page.getByTestId("ext-registrar").click();
  await ventana(page).waitFor();
  const r1 = await intentar(page, "ext-guardar", ["ext-id", "ext-fuente", "ext-titulo", "ext-area", "ext-tipo", "ext-version", "ext-responsable"]);
  check("[cob:D:D-208] sin identificador: se marca #ext-id", r1.marcados["ext-id"], r1.texto);
  check("[cob:D:D-209] sin emisor: se marca #ext-fuente («Indica el emisor o fuente»)", r1.marcados["ext-fuente"] && /emisor o fuente/.test(r1.texto), r1.texto);
  check("[cob:D:D-210] sin título: se marca #ext-titulo", r1.marcados["ext-titulo"] && /Escribe el título/.test(r1.texto), r1.texto);
  check("[cob:D:D-211] sin gestión: se marca #ext-area", r1.marcados["ext-area"] && /área de gestión/.test(r1.texto), r1.texto);
  check("[cob:D:D-212] sin tipo documental: se marca #ext-tipo", r1.marcados["ext-tipo"] && /tipo documental/.test(r1.texto), r1.texto);
  check("[cob:D:D-213] sin versión: se marca #ext-version («Indica la versión o fecha de edición»)", r1.marcados["ext-version"] && /versión o fecha de edición/.test(r1.texto), r1.texto);
  check("[cob:D:D-214] sin responsable: se marca #ext-responsable", r1.marcados["ext-responsable"] && /responsable de seguimiento/.test(r1.texto), r1.texto);
  const resp = (await opciones(page, "ext-responsable")).map((o) => Number(o.value)).filter(Boolean);
  check("[cob:D:D-214] el responsable se elige entre quienes consultan vigentes (no la administración técnica ni la cuenta dada de baja)", resp.includes(id.ricardo) && resp.includes(id.diego) && !resp.includes(id.jorge) && !resp.includes(idBaja), resp.join(","));
  const IDX = `NMX-UIX-${s}`;
  await page.locator("#ext-id").fill(IDE);
  await page.locator("#ext-fuente").fill("IMNC");
  await page.locator("#ext-titulo").fill(`Norma validada ${s}`);
  await page.locator("#ext-area").selectOption("GC");
  await page.locator("#ext-tipo").selectOption("R");
  await page.locator("#ext-version").fill("2021");
  await page.locator("#ext-responsable").selectOption(String(id.ricardo));
  await masOpciones(ventana(page));
  await page.locator("#ext-enlace").fill("ftp://imnc.org.mx");
  await fecha(page, "ext-proxima", HOY);
  const r2 = await intentar(page, "ext-guardar", ["ext-enlace", "ext-proxima"]);
  check("[cob:D:D-216] enlace que no es http(s): se marca #ext-enlace", r2.marcados["ext-enlace"] && /http\(s\)/.test(r2.texto), r2.texto);
  check("[cob:D:D-215] próxima verificación que no es posterior a la última: se marca #ext-proxima", r2.marcados["ext-proxima"] && /posterior a la última verificación/.test(r2.texto), r2.texto);
  await page.locator("#ext-enlace").fill("https://www.imnc.org.mx");
  await fecha(page, "ext-proxima", enDias(300));
  const r3 = await intentar(page, "ext-guardar", ["ext-id"]);
  check("[cob:D:D-208] identificador ya registrado: el servidor lo rechaza en #ext-id y no se duplica", r3.tipo === "servidor" && r3.todos && Number(fila("SELECT COUNT(*) AS n FROM sgc_documentos WHERE clave = ?", IDE)?.n) === 1, r3.texto);
  await escribir(page, "ext-id", IDX);
  await guardarYAbrir(page, "ext-guardar", "ana");
  const doc = fila("SELECT id, origen, propietario_id FROM sgc_documentos WHERE clave = ?", IDX);
  const ext = doc ? fila("SELECT fuente, version_fecha, enlace, responsable_id, proxima_revision FROM sgc_externos WHERE documento_id = ?", doc.id) : null;
  check("[cob:D:D-208] [cob:D:D-209] [cob:D:D-210] [cob:D:D-211] [cob:D:D-212] [cob:D:D-213] [cob:D:D-214] [cob:D:D-215] [cob:D:D-216] [cob:D:D-222] «Registrar como vigente» guarda el externo con emisor, versión, enlace, responsable y próxima verificación", doc?.origen === "externo" && ext?.fuente === "IMNC" && ext.version_fecha === "2021" && /^https:\/\/www\.imnc\.org\.mx\/?$/.test(ext.enlace) && Number(ext.responsable_id) === id.ricardo && ext.proxima_revision === enDias(300), JSON.stringify(ext));
});

await paso("ana", "externos: buscar, filtros, obsoletos y renglón", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/externos`);
  await page.getByTestId("ext-fila").first().waitFor();
  check("[cob:D:D-277] con externo_gestionar aparece «Registrar externo»", (await page.getByTestId("ext-registrar").count()) === 1);
  const claves = () => page.getByTestId("ext-fila").evaluateAll((xs) => xs.map((x) => x.getAttribute("data-clave")).sort());
  const comoApi = async (q) => ((await api("GET", `/sgc/externos?${q}`, undefined, t.ana)).data?.items || []).map((x) => x.clave).sort();
  const buscar = page.getByPlaceholder("Buscar por identificador, título o emisor");
  await buscar.fill(IDN0);
  await page.locator(`[data-testid="ext-fila"][data-clave="${IDN0}"]`).waitFor();
  await esperar(async () => (await claves()).length === 1, 8000);
  check("[cob:D:D-278] el buscador deja solo el externo con ese identificador", (await claves()).join() === IDN0, (await claves()).join());
  const texto = (await page.locator(`[data-testid="ext-fila"][data-clave="${IDN0}"]`).innerText()).replace(/\s+/g, " ");
  check("[cob:D:D-282] el renglón muestra identificador, título, emisor, versión, responsable y próxima verificación", texto.includes(IDN0) && texto.includes(`Guía sin PDF ${s}`) && texto.includes("SSA") && texto.includes("Versión 2019") && texto.includes(nombre[id.ricardo]) && texto.includes(`Verificado ${fmt(HOY)}`), texto);
  await buscar.fill(s);
  await page.locator(`[data-testid="ext-fila"][data-clave="${IDN0}"]`).waitFor();
  const sinObs = await claves();
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.getByRole("switch", { name: "Mostrar obsoletos" }).click();
  await page.keyboard.press("Escape");
  await page.locator(`[data-testid="ext-fila"][data-clave="${IDOX}"]`).waitFor();
  check("[cob:D:D-281] «Mostrar obsoletos» agrega el externo obsoleto (sin él no aparece)", !sinObs.includes(IDOX));
  const esperadas = await comoApi(`search=${s}&obsoletos=1&estado=obsoleto`);
  await filtro(page, "Estado", "Obsoletos");
  await esperar(async () => (await claves()).join() === esperadas.join(), 10_000);
  check("[cob:D:D-280] filtro «Estado › Obsoletos» deja solo los obsoletos, como la API", esperadas.includes(IDOX) && !esperadas.includes(IDN0) && (await claves()).join() === esperadas.join(), (await claves()).join());
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await page.keyboard.press("Escape");
  await buscar.fill(s);
  await page.locator(`[data-testid="ext-fila"][data-clave="${IDN0}"]`).waitFor();
  const tc = await comoApi(`search=${s}&area=TC`);
  await filtro(page, "Gestión", /^TC · /);
  await esperar(async () => (await claves()).join() === tc.join(), 10_000);
  check("[cob:D:D-279] filtro «Gestión» (TC): ninguno de los externos de GC", !(await claves()).includes(IDN0) && (await claves()).join() === tc.join(), (await claves()).join());
});

await paso("luis", "externos sin gestionar ni ver obsoletos", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/externos`);
  await page.getByPlaceholder("Buscar por identificador, título o emisor").fill(IDN0);
  await page.locator(`[data-testid="ext-fila"][data-clave="${IDN0}"]`).waitFor();
  check("[cob:D:D-277] sin externo_gestionar no hay «Registrar externo»", (await page.getByTestId("ext-registrar").count()) === 0);
  check("[cob:D:D-283] quien no es responsable ni gestiona no tiene «Verificar vigencia» en el renglón", (await page.getByTestId("ext-fila-verificar").count()) === 0);
  await page.getByRole("button", { name: /^Filtros/ }).click();
  const n = await page.getByRole("switch", { name: "Mostrar obsoletos" }).count();
  const obsoletos = await page.locator('section[aria-label="Estado"]').getByRole("switch", { name: "Obsoletos", exact: true }).count();
  await page.keyboard.press("Escape");
  check("[cob:D:D-280] [cob:D:D-281] sin consultar el histórico: ni «Mostrar obsoletos» ni la opción «Obsoletos»", n === 0 && obsoletos === 0);
});

await paso("ricardo", "externos: verificar desde el renglón (responsable)", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/externos`);
  await page.getByPlaceholder("Buscar por identificador, título o emisor").fill(IDN0);
  const f = page.locator(`[data-testid="ext-fila"][data-clave="${IDN0}"]`);
  await f.waitFor();
  await f.getByTestId("ext-fila-verificar").click();
  await ventana(page).waitFor();
  check("[cob:D:D-283] el responsable de seguimiento tiene «Verificar vigencia» en el renglón y abre su ventana", (await ventana(page).innerText()).includes(IDN0) && (await page.locator("#ver-comentario").count()) === 1);
  await page.keyboard.press("Escape");
});

/* ---------- Lista Maestra ---------- */
await paso("ana", "lista maestra: PDF, buscador, filtros, grupos, renglones y ficha", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/lista-maestra`);
  await page.getByTestId("lm-resumen").waitFor();
  const claves = () => page.getByTestId("lm-fila").evaluateAll((xs) => xs.map((x) => x.getAttribute("data-clave")).sort());
  const comoApi = async (q) => ((await api("GET", `/sgc/lista-maestra?${q}`, undefined, t.ana)).data?.items || []).map((x) => x.clave).sort();
  const igual = async (q) => { const e = await comoApi(q); await esperar(async () => (await claves()).join() === e.join(), 15_000); return { e, v: await claves() }; };
  const buscar = page.getByPlaceholder("Buscar por clave, título o propietario");
  await buscar.fill(PO.clave);
  let r = await igual(`search=${PO.clave}`);
  check("[cob:D:D-288] el buscador deja el documento con esa clave", r.v.join() === PO.clave, r.v.join());
  await buscar.fill(s);
  await page.locator(`[data-testid="lm-fila"][data-clave="${PO.clave}"]`).waitFor();
  r = await igual(`search=${s}`);
  check("[cob:D:D-296] la tabla lm-tabla muestra los mismos documentos que la API", (await page.getByTestId("lm-tabla").count()) === 1 && r.v.join() === r.e.join() && r.v.length > 5, `${r.v.length}`);
  const areas = await page.getByTestId("lm-area").evaluateAll((xs) => xs.map((x) => x.getAttribute("data-area")));
  check("[cob:D:D-297] un encabezado por gestión (TC y GC) agrupa los renglones", areas.includes("TC") && areas.includes("GC") && new Set(areas).size === areas.length, areas.join(","));
  const tPO = (await page.locator(`[data-testid="lm-fila"][data-clave="${PO.clave}"]`).innerText()).replace(/\s+/g, " ");
  check("[cob:D:D-298] el renglón muestra clave, título y revisión con sus fechas", tPO.includes(PO.clave) && tPO.includes(PO.titulo) && tPO.includes(fmt("2025-01-10")), tPO);
  const curso = (await page.locator(`[data-testid="lm-fila"][data-clave="${RA.clave}"]`).getByTestId("lm-en-curso").innerText()).trim();
  check("[cob:D:D-299] con revisión en curso el renglón dice «Rev. 2 …»; sin ella no", /2/.test(curso) && (await page.locator(`[data-testid="lm-fila"][data-clave="${PO.clave}"]`).getByTestId("lm-en-curso").count()) === 0, curso);
  // Filtros
  await filtro(page, "Estado", "Con revisión en curso");
  r = await igual(`search=${s}&estado=en_curso`);
  check("[cob:D:D-291] «Estado › Con revisión en curso» deja los que tienen trabajo abierto, como la API", r.v.includes(RA.clave) && !r.v.includes(PO.clave) && r.v.join() === r.e.join(), r.v.join());
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await page.keyboard.press("Escape");
  await filtro(page, "Gestión", /^GC · /);
  r = await igual(`search=${s}&area=GC`);
  check("[cob:D:D-289] «Gestión» (GC): solo documentos de GC", r.v.length > 0 && r.v.every((c) => /^FX-GC|^NMX/.test(c)) && !r.v.includes(PO.clave) && r.v.join() === r.e.join(), r.v.join());
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await page.keyboard.press("Escape");
  await filtro(page, "Origen", "Externos");
  r = await igual(`search=${s}&origen=externo`);
  check("[cob:D:D-292] «Origen › Externos»: solo externos", r.v.includes(IDN0) && !r.v.includes(PO.clave) && r.v.join() === r.e.join(), r.v.join());
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await page.keyboard.press("Escape");
  const sinObs = await claves();
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.getByRole("switch", { name: "Incluir obsoletos" }).click();
  await page.keyboard.press("Escape");
  await page.locator(`[data-testid="lm-fila"][data-clave="${OBX.clave}"]`).waitFor();
  check("[cob:D:D-293] «Incluir obsoletos» agrega los obsoletos", !sinObs.includes(OBX.clave));
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.getByRole("switch", { name: "Incluir obsoletos" }).click();
  await page.keyboard.press("Escape");
  // Abrir ficha (menú y clic en el renglón)
  await page.getByRole("button", { name: `Más acciones de ${PO.clave}` }).click();
  await page.getByRole("menuitem", { name: "Abrir ficha" }).click();
  await page.waitForURL((u) => u.pathname === `/documentos/${PO.id}`);
  check("[cob:D:D-300] «Abrir ficha» del renglón abre la ficha", true);
  await page.goBack();
  await page.locator(`[data-testid="lm-fila"][data-clave="${V.clave}"]`).click();
  await page.waitForURL((u) => u.pathname === `/documentos/${V.id}`);
  check("[cob:D:D-298] el clic en el renglón abre la ficha", true);
  // Ver PDF en el visor
  await page.goto(`${BASE_WEB}/documentos/lista-maestra`);
  let descargas = 0;
  page.on("download", () => descargas++);
  const resp = page.waitForResponse((x) => /\/api\/sgc\/lista-maestra\/pdf/.test(x.url()));
  await page.getByTestId("lm-pdf").click();
  const rp = await resp;
  await page.locator("[data-visor-pdf-flotante] canvas").first().waitFor({ timeout: 60_000 });
  check("[cob:D:D-287] «Ver PDF» pide el PDF de la Lista Maestra y lo abre en el visor interno (sin descarga)", rp.status() === 200 && descargas === 0, String(rp.status()));
  await page.keyboard.press("Escape");
});

await paso("luis", "lista maestra sin exportar ni histórico", async (page) => {
  await page.goto(`${BASE_WEB}/documentos/lista-maestra`);
  await page.getByTestId("lm-resumen").waitFor();
  check("[cob:D:D-287] sin lista_maestra_exportar no hay «Ver PDF»", (await page.getByTestId("lm-pdf").count()) === 0);
  await page.getByRole("button", { name: /^Filtros/ }).click();
  const n = await page.getByRole("switch", { name: "Incluir obsoletos" }).count();
  await page.keyboard.press("Escape");
  check("[cob:D:D-293] sin consultar el histórico no hay «Incluir obsoletos»", n === 0);
});

/* ---------- Limpieza: nada de esta suite queda pendiente para otras ---------- */
if (obsOB.data?.solicitud?.id) await api("POST", `/solicitudes/${obsOB.data.solicitud.id}/rechazar`, { motivo: "Fin de la prueba de cobertura" }, t.patricia);
if (solOB2?.id) await api("POST", `/solicitudes/${solOB2.id}/rechazar`, { motivo: "Fin de la prueba de cobertura" }, t.patricia);
for (const x of filas("SELECT id FROM sgc_solicitudes WHERE estado = 'pendiente' AND (titulo_propuesto LIKE ? OR justificacion LIKE ?)", `%${s}%`, `%${s}%`)) await api("POST", `/sgc/solicitudes/${x.id}/rechazar`, { motivo: "Fin de la prueba de cobertura" }, t.ana);

await nav.cerrar();
terminar();
