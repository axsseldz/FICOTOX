/*
 * Documentos SGC, Fase 2 (flujo de aprobacion):
 * - solicitud (cambio y nuevo, con archivo de apoyo) -> aceptacion con 3 responsables (regla 11) o rechazo;
 * - borrador -> en revision -> devolucion -> correccion -> revision -> autorizacion (contrasena) -> publicacion
 *   (contrasena; la anterior obsoleta, una sola vigente; publicacion concurrente: una gana y otra 409);
 * - rechazos en revision y en autorizacion y devolucion en autorizacion, con la vigente intacta;
 * - archivos bloqueados fuera de borrador y desbloqueados al devolver (CA-06);
 * - nadie actua en un papel no asignado ni sin permiso (API y URL directa); el admin tecnico no actua;
 * - reasignacion con motivo y regla de 3 personas;
 * - pendiente de revision, renovacion sin cambios (misma revision, nueva fecha) y obsolescencia con segundo usuario;
 * - bandeja, avisos (campana) y linea de tiempo completa (CA-07).
 */
import "./lib/reauth-auto.mjs";
import { api, crearCheck, Database, fila, filas, sesiones } from "./lib/calidad.mjs";
import { pdfConTexto } from "./lib/archivos.mjs";

const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const s5 = Date.now().toString(36).slice(-4).toUpperCase();
const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana" }).format(new Date());
const enDias = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana" }).format(new Date(Date.now() + n * 86_400_000));
const SIN_REAUTH = { "X-Sin-Reauth-Auto": "1" };

async function ficha(token, campos) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
  fd.append("archivo_pdf", new Blob([await pdfConTexto(1, campos.titulo)]), "inicial.pdf");
  return api("POST", "/sgc/documentos", fd, token);
}
async function subirPdf(token, revId, titulo) {
  const fd = new FormData();
  fd.append("tipo", "pdf");
  fd.append("archivo", new Blob([await pdfConTexto(1, titulo)]), `${titulo}.pdf`);
  return api("POST", `/sgc/revisiones/${revId}/archivos`, fd, token);
}
const doc = (docId, token = t.ana) => api("GET", `/sgc/documentos/${docId}`, undefined, token);
const rev = (revId) => fila("SELECT * FROM sgc_revisiones WHERE id = ?", revId);
const completar = (revId, token = t.luis) => api("PUT", `/sgc/revisiones/${revId}`, { apartados_afectados: "Sección 5", descripcion_cambio: "Se actualiza el método" }, token);
const tareas = async (token) => (await api("GET", "/sgc/bandeja", undefined, token)).data?.items || [];
const avisos = async (token) => (await api("GET", "/notificaciones", undefined, token)).data?.items || [];

/* ---------- 0. Documento vigente de partida (carga inicial) ---------- */
const D = (await ficha(t.ana, { clave: `FX-TCP-F${s5}`, titulo: `Procedimiento del flujo ${s5}`, area_codigo: "TC", tipo_codigo: "P", elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.patricia })).data;
await api("POST", `/sgc/revisiones/${D.revision_id}/registrar-vigente`, { fecha_emision: "2025-01-10", fecha_proxima_revision: "2028-01-10" }, t.ana);
const r1 = D.revision_id;
const pdfR1 = fila("SELECT id, sha256 FROM sgc_archivos WHERE revision_id = ? AND tipo = 'pdf'", r1);
check("partida: documento vigente en la revisión 1", rev(r1)?.estado === "vigente");
check("la ficha creada por Mejora Continua queda registrada como solicitud aceptada", fila("SELECT estado FROM sgc_solicitudes WHERE revision_id = ?", r1)?.estado === "aceptada");

/* ---------- 1. Solicitudes ---------- */
const sinJust = await api("POST", "/sgc/solicitudes", { tipo: "cambio", documento_id: D.id, justificacion: "corta" }, t.luis);
check("solicitud sin justificación suficiente → 400", sinJust.status === 400 && sinJust.data?.campo === "justificacion", `${sinJust.status}`);
const jorgeSol = await api("POST", "/sgc/solicitudes", { tipo: "cambio", documento_id: D.id, justificacion: "Intento del administrador técnico" }, t.jorge);
check("el administrador técnico no propone (403)", jorgeSol.status === 403, `${jorgeSol.status}`);
const solLuis = await api("POST", "/sgc/solicitudes", { tipo: "cambio", documento_id: D.id, justificacion: "Actualizar el método de extracción con el nuevo equipo" }, t.luis);
check("Técnico Analista propone un cambio (201)", solLuis.status === 201, `${solLuis.status} ${solLuis.data?.message}`);
const fdNuevo = new FormData();
for (const [k, v] of Object.entries({ tipo: "nuevo", area_codigo: "GC", tipo_codigo: "F", titulo_propuesto: `Formato de control ${s5}`, justificacion: "Se necesita un formato para el control de reactivos" })) fdNuevo.append(k, v);
fdNuevo.append("archivo", new Blob([await pdfConTexto(1, "Apoyo")]), "apoyo.pdf");
const solMariana = await api("POST", "/sgc/solicitudes", fdNuevo, t.mariana);
check("Técnico Auxiliar propone un documento nuevo con archivo de apoyo (201)", solMariana.status === 201 && !!fila("SELECT apoyo_sha256 FROM sgc_solicitudes WHERE id = ?", solMariana.data?.id)?.apoyo_sha256, `${solMariana.status}`);
const solOtra = await api("POST", "/sgc/solicitudes", { tipo: "nuevo", area_codigo: "AD", tipo_codigo: "L", titulo_propuesto: `Lista que se rechazará ${s5}`, justificacion: "Lista de proveedores del laboratorio" }, t.mariana);
const listaLuis = (await api("GET", "/sgc/solicitudes", undefined, t.luis)).data?.items || [];
const listaAna = (await api("GET", "/sgc/solicitudes", undefined, t.ana)).data?.items || [];
check("cada quien ve sus solicitudes; Mejora Continua, todas", listaLuis.every((x) => x.solicitante_id === id.luis) && listaLuis.some((x) => x.id === solLuis.data?.id) && listaAna.some((x) => x.id === solMariana.data?.id));
check("Mejora Continua tiene las solicitudes en su bandeja", (await tareas(t.ana)).some((x) => x.clave === `sgc_solicitud:${solLuis.data?.id}`));
const luisAcepta = await api("POST", `/sgc/solicitudes/${solLuis.data?.id}/aceptar`, { elaborador_id: id.luis, revisor_id: id.gabriela, autorizador_id: id.patricia }, t.luis);
check("solo Mejora Continua acepta solicitudes (403)", luisAcepta.status === 403, `${luisAcepta.status}`);
const repetidos = await api("POST", `/sgc/solicitudes/${solLuis.data?.id}/aceptar`, { elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.ricardo }, t.ana);
check("aceptar con una persona en dos papeles → 400 (regla 11)", repetidos.status === 400 && repetidos.data?.regla === 11, `${repetidos.status} ${repetidos.data?.message}`);
const sinAutorizador = await api("POST", `/sgc/solicitudes/${solLuis.data?.id}/aceptar`, { elaborador_id: id.luis, revisor_id: id.gabriela }, t.ana);
check("aceptar sin los tres responsables → 400", sinAutorizador.status === 400, `${sinAutorizador.status}`);
const acepta = await api("POST", `/sgc/solicitudes/${solLuis.data?.id}/aceptar`, { elaborador_id: id.luis, revisor_id: id.gabriela, autorizador_id: id.patricia, fecha_limite: enDias(7), comentario: "Procede" }, t.ana);
const r2 = acepta.data?.revision_id;
check("Mejora Continua acepta el cambio: revisión 2 en borrador con fecha límite", acepta.status === 200 && rev(r2)?.estado === "borrador" && rev(r2)?.numero === 2 && rev(r2)?.fecha_limite === enDias(7), `${acepta.status} ${acepta.data?.message}`);
check("la vigente sigue intacta al abrir la revisión", rev(r1)?.estado === "vigente" && fila("SELECT revision_vigente_id FROM sgc_documentos WHERE id = ?", D.id)?.revision_vigente_id === r1);
check("el solicitante recibe aviso de su solicitud aceptada", (await avisos(t.luis)).some((x) => x.clave === `sgc_solicitud_resuelta:${solLuis.data?.id}:aceptada`));
check("el elaborador asignado recibe la tarea (bandeja y campana)", (await tareas(t.luis)).some((x) => x.tipo === "elaborar" && x.documento_id === D.id) && (await avisos(t.luis)).some((x) => String(x.clave).startsWith(`sgc_tarea:${r2}:borrador`)));
const rechazoSinMotivo = await api("POST", `/sgc/solicitudes/${solOtra.data?.id}/rechazar`, {}, t.ana);
const rechazo = await api("POST", `/sgc/solicitudes/${solOtra.data?.id}/rechazar`, { motivo: "Ya existe una lista equivalente" }, t.ana);
check("rechazar una solicitud exige motivo; el solicitante recibe el aviso", rechazoSinMotivo.status === 400 && rechazo.status === 200 && (await avisos(t.mariana)).some((x) => x.clave === `sgc_solicitud_resuelta:${solOtra.data?.id}:rechazada`));
const nuevo = await api("POST", `/sgc/solicitudes/${solMariana.data?.id}/aceptar`, { clave: `FX-GCF-N${s5}`, elaborador_id: id.mariana, revisor_id: id.ricardo, autorizador_id: id.patricia }, t.ana);
check("aceptar un documento nuevo crea la ficha con la clave autorizada y la revisión en borrador sin archivo", nuevo.status === 200 && fila("SELECT clave, estado FROM sgc_documentos WHERE id = ?", nuevo.data?.documento_id)?.clave === `FX-GCF-N${s5}` && rev(nuevo.data?.revision_id)?.estado === "borrador", `${nuevo.status} ${nuevo.data?.message}`);

/* ---------- 2. Borrador -> revision -> devolucion -> correccion -> autorizacion -> publicacion ---------- */
const sinPdf = await api("POST", `/sgc/revisiones/${r2}/enviar-revision`, {}, t.luis);
check("enviar sin PDF → 409", sinPdf.status === 409, `${sinPdf.status}`);
await subirPdf(t.luis, r2, `Rev2 ${s5}`);
const sinCampos = await api("POST", `/sgc/revisiones/${r2}/enviar-revision`, {}, t.luis);
check("enviar sin apartados ni descripción → 409", sinCampos.status === 409 && /apartados/.test(sinCampos.data?.message || ""), `${sinCampos.status} ${sinCampos.data?.message}`);
await completar(r2);
const envio = await api("POST", `/sgc/revisiones/${r2}/enviar-revision`, {}, t.luis);
check("el elaborador la envía a revisión", envio.status === 200 && rev(r2)?.estado === "en_revision", `${envio.status}`);
const bloqueado = await subirPdf(t.luis, r2, "Tarde");
check("en revisión el archivo está bloqueado (409)", bloqueado.status === 409, `${bloqueado.status}`);
for (const [quien, esperado] of [["ricardo", 403], ["mariana", [403, 404]], ["jorge", [403, 404]], ["patricia", 403]]) {
  const r = await api("POST", `/sgc/revisiones/${r2}/revisar`, { decision: "aceptar" }, t[quien]);
  check(`revisar sin ser el revisor asignado: ${quien} → ${esperado}`, Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado, `${r.status} ${r.data?.message}`);
}
check("el revisor asignado tiene la tarea «Revisar»", (await tareas(t.gabriela)).some((x) => x.tipo === "revisar" && x.revision === 2));
const devSin = await api("POST", `/sgc/revisiones/${r2}/revisar`, { decision: "devolver" }, t.gabriela);
check("devolver exige comentario (400)", devSin.status === 400, `${devSin.status}`);
const dev = await api("POST", `/sgc/revisiones/${r2}/revisar`, { decision: "devolver", comentario: "Falta el diagrama del proceso" }, t.gabriela);
check("el revisor devuelve con comentarios → borrador", dev.status === 200 && rev(r2)?.estado === "borrador", `${dev.status}`);
const corrige = await subirPdf(t.luis, r2, `Rev2 corregida ${s5}`);
check("devuelta: el archivo se puede volver a cambiar (CA-06) y el anterior se conserva", corrige.status === 201 && filas("SELECT id FROM sgc_archivos WHERE revision_id = ? AND tipo = 'pdf'", r2).length === 2);
check("el elaborador ve la tarea «Corregir lo devuelto»", (await tareas(t.luis)).some((x) => x.tipo === "corregir"));
await api("POST", `/sgc/revisiones/${r2}/enviar-revision`, {}, t.luis);
const acepta2 = await api("POST", `/sgc/revisiones/${r2}/revisar`, { decision: "aceptar", comentario: "Correcto" }, t.gabriela);
check("el revisor acepta → en autorización", acepta2.status === 200 && rev(r2)?.estado === "en_autorizacion", `${acepta2.status}`);
const gabAut = await api("POST", `/sgc/revisiones/${r2}/autorizar`, { decision: "autorizar" }, t.gabriela);
const ricAut = await api("POST", `/sgc/revisiones/${r2}/autorizar`, { decision: "autorizar" }, t.ricardo);
check("autorizar sin permiso o sin ser el autorizador asignado → 403", gabAut.status === 403 && ricAut.status === 403 && ricAut.data?.regla === 11, `${gabAut.status} ${ricAut.status}`);
const autSinPwd = await api("POST", `/sgc/revisiones/${r2}/autorizar`, { decision: "autorizar" }, t.patricia, SIN_REAUTH);
check("autorizar pide contraseña (401 reauth_required)", autSinPwd.status === 401 && autSinPwd.data?.codigo === "reauth_required", `${autSinPwd.status}`);
const aut = await api("POST", `/sgc/revisiones/${r2}/autorizar`, { decision: "autorizar", comentario: "Se autoriza la emisión" }, t.patricia);
check("el autorizador autoriza → autorizada; la vigente sigue intacta", aut.status === 200 && rev(r2)?.estado === "autorizada" && rev(r1)?.estado === "vigente", `${aut.status}`);
check("Mejora Continua tiene la tarea «Publicar»", (await tareas(t.ana)).some((x) => x.tipo === "publicar" && x.revision === 2));
const pubLuis = await api("POST", `/sgc/revisiones/${r2}/publicar`, {}, t.luis);
const pubJorge = await api("POST", `/sgc/revisiones/${r2}/publicar`, {}, t.jorge);
check("publicar sin documento_publicar → 403 (también el admin técnico)", pubLuis.status === 403 && [403, 404].includes(pubJorge.status), `${pubLuis.status} ${pubJorge.status}`);
const pubSinPwd = await api("POST", `/sgc/revisiones/${r2}/publicar`, {}, t.ana, SIN_REAUTH);
check("publicar pide contraseña (401)", pubSinPwd.status === 401 && pubSinPwd.data?.codigo === "reauth_required", `${pubSinPwd.status}`);
const [p1, p2] = await Promise.all([api("POST", `/sgc/revisiones/${r2}/publicar`, { fecha_emision: hoy }, t.ana), api("POST", `/sgc/revisiones/${r2}/publicar`, { fecha_emision: hoy }, t.ana)]);
const estados = [p1.status, p2.status].sort();
check("publicación concurrente: una se publica y la otra recibe 409", estados[0] === 200 && estados[1] === 409, `${p1.status} ${p2.status}`);
const vigentes = filas("SELECT id FROM sgc_revisiones WHERE documento_id = ? AND estado = 'vigente'", D.id);
check("solo una vigente: la nueva; la anterior obsoleta con fecha y «sustituida por»", vigentes.length === 1 && vigentes[0].id === r2 && rev(r1)?.estado === "obsoleta" && !!rev(r1)?.fecha_obsolescencia && rev(r1)?.sustituida_por_id === r2 && fila("SELECT revision_vigente_id FROM sgc_documentos WHERE id = ?", D.id)?.revision_vigente_id === r2);
check("próxima revisión por omisión: emisión + 3 años", rev(r2)?.fecha_proxima_revision === `${Number(hoy.slice(0, 4)) + 3}${hoy.slice(4)}` || rev(r2)?.fecha_proxima_revision?.startsWith(String(Number(hoy.slice(0, 4)) + 3)), rev(r2)?.fecha_proxima_revision);
const consulta = (await doc(D.id, t.mariana)).data?.revisiones || [];
check("quien consulta vigentes ve solo la nueva vigente", consulta.length === 1 && consulta[0].id === r2);
const pdfR1Tras = fila("SELECT sha256 FROM sgc_archivos WHERE id = ?", pdfR1.id);
check("la revisión obsoleta conserva su archivo", pdfR1Tras?.sha256 === pdfR1.sha256);

/* ---------- 3. Linea de tiempo (CA-07) ---------- */
const fichaAna = (await doc(D.id)).data;
const lt = (fichaAna?.revisiones || []).find((r) => r.id === r2)?.linea_tiempo || [];
const pasos = lt.map((x) => x.accion);
check("línea de tiempo completa con quién, papel, cargo, fecha y comentario", ["solicitar", "aceptar_solicitud", "enviar_revision", "revisar_devolver", "enviar_revision", "revisar_aceptar", "autorizar", "publicar"].every((p) => pasos.includes(p)) && lt.every((x) => x.fecha) && lt.find((x) => x.accion === "revisar_devolver")?.comentario === "Falta el diagrama del proceso" && lt.find((x) => x.accion === "autorizar")?.usuario_nombre && lt.find((x) => x.accion === "autorizar")?.papel === "autorizador" && !!lt.find((x) => x.accion === "autorizar")?.cargo, pasos.join(","));
check("la revisión anterior registra que quedó obsoleta", ((fichaAna?.revisiones || []).find((r) => r.id === r1)?.linea_tiempo || []).some((x) => x.accion === "obsoleta"));

/* ---------- 4. Rechazos y reasignacion, con la vigente intacta ---------- */
const directa = await api("POST", `/sgc/documentos/${D.id}/revisiones`, { motivo_cambio: "Ajuste menor solicitado por Mejora Continua", elaborador_id: id.luis, revisor_id: id.gabriela, autorizador_id: id.patricia }, t.ana);
const r3 = directa.data?.revision_id;
check("la nueva revisión directa de Mejora Continua queda registrada como solicitud propia aceptada", directa.status === 201 && fila("SELECT estado, solicitante_id FROM sgc_solicitudes WHERE revision_id = ?", r3)?.solicitante_id === id.ana, `${directa.status} ${directa.data?.message}`);
const reaSin = await api("POST", `/sgc/revisiones/${r3}/reasignar`, { revisor_id: id.ricardo }, t.ana);
const reaDoble = await api("POST", `/sgc/revisiones/${r3}/reasignar`, { elaborador_id: id.gabriela, motivo: "Prueba de duplicado" }, t.ana);
const reaLuis = await api("POST", `/sgc/revisiones/${r3}/reasignar`, { revisor_id: id.ricardo, motivo: "No es Mejora Continua" }, t.luis);
const rea = await api("POST", `/sgc/revisiones/${r3}/reasignar`, { revisor_id: id.ricardo, motivo: "Gabriela está de vacaciones" }, t.ana);
check("reasignar: motivo obligatorio, regla de 3 personas, solo Mejora Continua", reaSin.status === 400 && reaDoble.status === 400 && reaDoble.data?.regla === 11 && reaLuis.status === 403 && rea.status === 200 && rev(r3)?.revisor_id === id.ricardo, `${reaSin.status} ${reaDoble.status} ${reaLuis.status} ${rea.status}`);
await subirPdf(t.luis, r3, `Rev3 ${s5}`);
await completar(r3);
await api("POST", `/sgc/revisiones/${r3}/enviar-revision`, {}, t.luis);
const exRevisor = await api("POST", `/sgc/revisiones/${r3}/revisar`, { decision: "aceptar" }, t.gabriela);
check("tras reasignar, el revisor anterior ya no actúa (403)", exRevisor.status === 403, `${exRevisor.status}`);
const rech = await api("POST", `/sgc/revisiones/${r3}/revisar`, { decision: "rechazar", comentario: "El cambio no procede" }, t.ricardo);
check("rechazo en revisión: la revisión queda cancelada y la vigente intacta", rech.status === 200 && rev(r3)?.estado === "cancelada" && rev(r2)?.estado === "vigente");
const r4 = (await api("POST", `/sgc/documentos/${D.id}/revisiones`, { motivo_cambio: "Segundo intento de ajuste", elaborador_id: id.luis, revisor_id: id.gabriela, autorizador_id: id.patricia }, t.ana)).data?.revision_id;
await subirPdf(t.luis, r4, `Rev4 ${s5}`);
await completar(r4);
await api("POST", `/sgc/revisiones/${r4}/enviar-revision`, {}, t.luis);
await api("POST", `/sgc/revisiones/${r4}/revisar`, { decision: "aceptar" }, t.gabriela);
const devAut = await api("POST", `/sgc/revisiones/${r4}/autorizar`, { decision: "devolver", comentario: "Corrige la tabla 2" }, t.patricia);
check("devolución en autorización → borrador", devAut.status === 200 && rev(r4)?.estado === "borrador");
await api("POST", `/sgc/revisiones/${r4}/enviar-revision`, {}, t.luis);
await api("POST", `/sgc/revisiones/${r4}/revisar`, { decision: "aceptar" }, t.gabriela);
const rechAut = await api("POST", `/sgc/revisiones/${r4}/autorizar`, { decision: "rechazar", comentario: "No se autoriza la emisión" }, t.patricia);
check("rechazo en autorización: cancelada y la vigente intacta", rechAut.status === 200 && rev(r4)?.estado === "cancelada" && rev(r2)?.estado === "vigente" && fila("SELECT revision_vigente_id FROM sgc_documentos WHERE id = ?", D.id)?.revision_vigente_id === r2);

{
  // Reasignar no elude la segregacion: quien ya reviso esta revision no puede pasar a autorizarla.
  const r5 = (await api("POST", `/sgc/documentos/${D.id}/revisiones`, { motivo_cambio: "Tercer ajuste de prueba", elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.patricia }, t.ana)).data?.revision_id;
  await subirPdf(t.luis, r5, `Rev5 ${s5}`);
  await completar(r5);
  await api("POST", `/sgc/revisiones/${r5}/enviar-revision`, {}, t.luis);
  await api("POST", `/sgc/revisiones/${r5}/revisar`, { decision: "aceptar" }, t.ricardo);
  const cambio = await api("POST", `/sgc/revisiones/${r5}/reasignar`, { revisor_id: id.gabriela, autorizador_id: id.ricardo, motivo: "Intento de que el revisor autorice" }, t.ana);
  check("reasignar no permite que quien ya revisó pase a autorizar la misma revisión (regla 11)", cambio.status === 400 && cambio.data?.regla === 11 && rev(r5)?.autorizador_id === id.patricia, `${cambio.status} ${cambio.data?.message}`);
  await api("POST", `/sgc/revisiones/${r5}/autorizar`, { decision: "rechazar", comentario: "Cierre de la prueba de segregación" }, t.patricia);
}

/* ---------- 5. Pendiente de revision y renovacion ---------- */
const noPend = await api("POST", `/sgc/documentos/${D.id}/renovar`, { revisor_id: id.gabriela, autorizador_id: id.patricia }, t.ana);
check("no se renueva lo que no está pendiente de revisión (409)", noPend.status === 409, `${noPend.status}`);
{
  const db = new Database(process.env.TEST_DB_PATH);
  db.prepare("UPDATE sgc_revisiones SET fecha_proxima_revision = ? WHERE id = ?").run(enDias(10), r2);
  db.prepare("UPDATE sgc_documentos SET propietario_id = ? WHERE id = ?").run(id.ricardo, D.id);
  db.close();
}
const fp = (await doc(D.id)).data;
const lista = (await api("GET", "/sgc/documentos?estado=pendiente_revision", undefined, t.ana)).data?.items || [];
check("pendiente de revisión: en la ficha, el explorador y los conteos", fp?.item?.pendiente_revision === true && lista.some((x) => x.id === D.id && x.pendiente_revision) && (await api("GET", "/sgc/resumen", undefined, t.ana)).data?.totales?.proximos >= 1);
check("avisa a Mejora Continua y al propietario", (await tareas(t.ana)).some((x) => x.tipo === "pendiente_revision" && x.documento_id === D.id) && (await avisos(t.ricardo)).some((x) => String(x.clave).startsWith(`sgc_pendiente_revision:${D.id}:`)));
const renLuis = await api("POST", `/sgc/documentos/${D.id}/renovar`, { revisor_id: id.gabriela, autorizador_id: id.patricia }, t.luis);
check("solo Mejora Continua inicia la renovación (403)", renLuis.status === 403, `${renLuis.status}`);
const ren = await api("POST", `/sgc/documentos/${D.id}/renovar`, { revisor_id: id.gabriela, autorizador_id: id.patricia }, t.ana);
const nid = ren.data?.id;
check("renovar: Mejora Continua asigna revisor y autorizador", ren.status === 201, `${ren.status} ${ren.data?.message}`);
const renMal = await api("POST", `/sgc/renovaciones/${nid}/revisar`, { decision: "confirmar", comentario: "Sigue vigente" }, t.ricardo);
const renSin = await api("POST", `/sgc/renovaciones/${nid}/revisar`, { decision: "confirmar" }, t.gabriela);
const renConf = await api("POST", `/sgc/renovaciones/${nid}/revisar`, { decision: "confirmar", comentario: "El método sigue vigente sin cambios" }, t.gabriela);
check("el revisor asignado confirma la vigencia con comentario (otro → 403; sin comentario → 400)", renMal.status === 403 && renSin.status === 400 && renConf.status === 200, `${renMal.status} ${renSin.status} ${renConf.status}`);
const renPwd = await api("POST", `/sgc/renovaciones/${nid}/autorizar`, { decision: "autorizar" }, t.patricia, SIN_REAUTH);
const renAut = await api("POST", `/sgc/renovaciones/${nid}/autorizar`, { decision: "autorizar", comentario: "Se renueva" }, t.patricia);
const tras = rev(r2);
check("el autorizador renueva con contraseña: la MISMA revisión sigue vigente con nueva fecha", renPwd.status === 401 && renAut.status === 200 && tras?.estado === "vigente" && tras?.id === r2 && tras?.fecha_proxima_revision > enDias(300) && !!tras?.renovada_en, `${renPwd.status} ${renAut.status} ${tras?.fecha_proxima_revision}`);
check("la renovación queda como evidencia en la línea de tiempo", ((await doc(D.id)).data?.revisiones || []).find((r) => r.id === r2)?.linea_tiempo?.some((x) => x.accion === "renovacion_autorizar"));

/* ---------- 6. Obsolescencia con segundo usuario ---------- */
const obsLuis = await api("POST", `/sgc/documentos/${D.id}/obsoletar`, { motivo: "Ya no se usa" }, t.luis);
const obsPwd = await api("POST", `/sgc/documentos/${D.id}/obsoletar`, { motivo: "El método se retiró del laboratorio" }, t.ana, { ...SIN_REAUTH, "X-Sin-Aprobar-Auto": "1" });
const obs = await api("POST", `/sgc/documentos/${D.id}/obsoletar`, { motivo: "El método se retiró del laboratorio" }, t.ana, { "X-Sin-Aprobar-Auto": "1" });
const sid = obs.data?.solicitud?.id;
check("obsoletar: solo con documento_obsoletar, con contraseña, y crea una solicitud de segundo usuario", obsLuis.status === 403 && obsPwd.status === 401 && obs.status === 202 && !!sid && fila("SELECT estado FROM sgc_documentos WHERE id = ?", D.id)?.estado === "vigente", `${obsLuis.status} ${obsPwd.status} ${obs.status}`);
const propia = await api("POST", `/solicitudes/${sid}/aprobar`, { motivo: "Me lo apruebo" }, t.ana, { "X-Sin-Aprobar-Auto": "1" });
const sinPermiso = await api("POST", `/solicitudes/${sid}/aprobar`, { motivo: "No tengo autorizar" }, t.luis, { "X-Sin-Aprobar-Auto": "1" });
check("ni quien la pidió ni quien no tiene documento_autorizar la aprueban", propia.status === 409 && sinPermiso.status === 403, `${propia.status} ${sinPermiso.status}`);
check("el segundo usuario la tiene en su bandeja", (await tareas(t.patricia)).some((x) => x.tipo === "obsolescencia" && x.documento_id === D.id));
const aprueba = await api("POST", `/solicitudes/${sid}/aprobar`, { motivo: "Se confirma el retiro del método" }, t.patricia, { "X-Sin-Aprobar-Auto": "1" });
check("al aprobarse: documento obsoleto y la revisión vigente pasa a obsoleta", aprueba.status === 200 && fila("SELECT estado FROM sgc_documentos WHERE id = ?", D.id)?.estado === "obsoleto" && rev(r2)?.estado === "obsoleta", `${aprueba.status} ${aprueba.data?.message}`);
const listaDef = (await api("GET", "/sgc/documentos", undefined, t.ana)).data?.items || [];
const listaObs = (await api("GET", "/sgc/documentos?obsoletos=1", undefined, t.ana)).data?.items || [];
check("obsoleto: fuera de la lista por omisión; solo con «Mostrar obsoletos»", !listaDef.some((x) => x.id === D.id) && listaObs.some((x) => x.id === D.id));
check("obsoleto: quien solo consulta vigentes ya no lo ve (404); con histórico sí", (await doc(D.id, t.mariana)).status === 404 && (await doc(D.id, t.hector)).status === 200);

{
  // Una solicitud sobre un documento restringido no se muestra (ni su clave ni su motivo) a quien puede autorizar pero no ve el documento.
  const C = (await ficha(t.ana, { clave: `FX-GCL-C${s5}`, titulo: `Lista confidencial ${s5}`, area_codigo: "GC", tipo_codigo: "L", confidencialidad: "confidencial", elaborador_id: id.luis, revisor_id: id.gabriela, autorizador_id: id.patricia })).data;
  await api("POST", `/sgc/revisiones/${C.revision_id}/registrar-vigente`, { fecha_emision: "2025-05-01" }, t.ana);
  const obsC = await api("POST", `/sgc/documentos/${C.id}/obsoletar`, { motivo: "Prueba de confidencialidad en solicitudes" }, t.ana, { "X-Sin-Aprobar-Auto": "1" });
  const deRicardo = (await api("GET", "/solicitudes", undefined, t.ricardo)).data?.items || [];
  const dePatricia = (await api("GET", "/solicitudes", undefined, t.patricia)).data?.items || [];
  check("la obsolescencia de un confidencial no aparece a un autorizador que no lo ve; sí a Responsable General", obsC.status === 202 && !deRicardo.some((x) => x.entidad === "sgc_documentos" && String(x.entidad_id) === String(C.id)) && dePatricia.some((x) => x.entidad === "sgc_documentos" && String(x.entidad_id) === String(C.id)) && !(await avisos(t.ricardo)).some((x) => x.clave === `solicitud:${obsC.data?.solicitud?.id}`));
}

terminar();
