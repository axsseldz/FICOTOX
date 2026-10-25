/*
 * Documentos SGC, Fase 3:
 * - externos (CA-10): registro vigente con contrasena, identificador unico sin distinguir mayusculas ni espacios,
 *   verificacion de vigencia, nueva version (la anterior obsoleta), aviso por proxima revision y permisos;
 * - distribucion y lectura controlada (CA-11): por rol y por persona al publicar, acuse ligado a usuario y revision
 *   (exige abrir el PDF; no se deshace), pendientes nuevos al publicar otra revision, quien recibe el rol despues,
 *   recordatorio, agregar/quitar con motivo y contrasena, destinatario sin consultar_vigente rechazado;
 * - Lista Maestra (CA-09): filtros, revision en curso, obsoletos solo con historico, confidencialidad y PDF
 *   (encabezado, filtros, colores de area, paginacion, horizontal) en la bitacora;
 * - indicadores de la vista general por persona; permisos negativos (API) incluido el admin tecnico.
 */
import "./lib/reauth-auto.mjs";
import { api, crearCheck, fila, filas, login, sesiones } from "./lib/calidad.mjs";
import { pdfConTexto } from "./lib/archivos.mjs";

const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const s5 = Date.now().toString(36).slice(-4).toUpperCase();
const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana" }).format(new Date());
// Hoy (en Tijuana) más n días de calendario (sumar n × 24 h fallaba el día del cambio de horario).
const enDias = (n) => {
  const [anio, mes, dia] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana" }).format(new Date()).split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia + n)).toISOString().slice(0, 10);
};
const SIN_REAUTH = { "X-Sin-Reauth-Auto": "1" };

async function ficha(token, campos) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
  fd.append("archivo_pdf", new Blob([await pdfConTexto(1, campos.titulo)]), "inicial.pdf");
  return api("POST", "/sgc/documentos", fd, token);
}
async function externo(token, campos, conPdf = false, headers = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
  if (conPdf) fd.append("archivo_pdf", new Blob([await pdfConTexto(1, campos.titulo || "Norma")]), "norma.pdf");
  return api("POST", "/sgc/externos", fd, token, headers);
}
async function version(token, docId, campos) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
  return api("POST", `/sgc/externos/${docId}/version`, fd, token);
}
const doc = (docId, token = t.ana) => api("GET", `/sgc/documentos/${docId}`, undefined, token);
const bandeja = async (token) => (await api("GET", "/sgc/bandeja", undefined, token)).data || {};
const avisos = async (token) => (await api("GET", "/notificaciones", undefined, token)).data?.items || [];
const roles = (await api("GET", "/admin/roles", undefined, t.qa)).data?.items || [];
const rolId = (nombre) => roles.find((r) => r.nombre === nombre)?.id;
const abrirPdf = async (token, revId) => {
  const a = fila("SELECT id FROM sgc_archivos WHERE revision_id = ? AND tipo = 'pdf' AND reemplazado_en IS NULL", revId);
  return api("GET", `/sgc/archivos/${a?.id}`, undefined, token);
};

/* ---------- 1. Externos (CA-10) ---------- */
const NMX = `NMX-EC-17025-IMNC-${s5}`;
const baseExt = { identificador: NMX, titulo: `Requisitos generales para la competencia de los laboratorios ${s5}`, area_codigo: "GC", tipo_codigo: "N", fuente: "IMNC", version_fecha: "2018", enlace: "https://www.imnc.org.mx", responsable_id: id.ricardo, ultima_verificacion: hoy, proxima_revision: enDias(365) };
const tipos = (await api("GET", "/sgc/catalogos", undefined, t.ana)).data?.tipos || [];
if (!tipos.some((x) => x.codigo === "N")) baseExt.tipo_codigo = tipos.find((x) => x.activo)?.codigo || "P";
const extLuis = await externo(t.luis, baseExt);
const extJorge = await externo(t.jorge, baseExt);
check("registrar externos: Analista y admin técnico → 403", extLuis.status === 403 && extJorge.status === 403, `${extLuis.status} ${extJorge.status}`);
const extSinPwd = await externo(t.ana, baseExt, false, SIN_REAUTH);
check("registrar un externo pide contraseña (401 reauth_required)", extSinPwd.status === 401 && extSinPwd.data?.codigo === "reauth_required", `${extSinPwd.status}`);
const extFx = await externo(t.ana, { ...baseExt, identificador: `FX-GCN-${s5}` });
check("un externo no usa el prefijo FX- (400)", extFx.status === 400 && extFx.data?.campo === "clave", `${extFx.status} ${extFx.data?.message}`);
const extSinFuente = await externo(t.ana, { ...baseExt, fuente: "" });
check("emisor obligatorio (400)", extSinFuente.status === 400 && extSinFuente.data?.campo === "fuente", `${extSinFuente.status}`);
const extEnlace = await externo(t.ana, { ...baseExt, enlace: "javascript:alert(1)" });
check("el enlace solo admite http(s) (400)", extEnlace.status === 400 && extEnlace.data?.campo === "enlace", `${extEnlace.status}`);
const E = await externo(t.ana, baseExt, true);
check("Mejora Continua registra el externo con contraseña como vigente (201)", E.status === 201 && fila("SELECT estado, origen FROM sgc_documentos WHERE id = ?", E.data?.id)?.estado === "vigente" && fila("SELECT origen FROM sgc_documentos WHERE id = ?", E.data?.id)?.origen === "externo", `${E.status} ${E.data?.message}`);
const E1 = E.data?.revision_id;
check("su versión queda como revisión vigente con la versión del emisor y su PDF", fila("SELECT estado, version_externa FROM sgc_revisiones WHERE id = ?", E1)?.version_externa === "2018" && fila("SELECT estado FROM sgc_revisiones WHERE id = ?", E1)?.estado === "vigente" && !!fila("SELECT sha256 FROM sgc_archivos WHERE revision_id = ?", E1)?.sha256);
const repetido = await externo(t.ana, { ...baseExt, identificador: ` ${NMX.toLowerCase()} ` });
check("identificador único sin distinguir mayúsculas ni espacios (409)", repetido.status === 409 && repetido.data?.codigo === "clave_repetida", `${repetido.status} ${repetido.data?.message}`);
check("el registro queda en la bitácora", !!fila("SELECT id FROM auditoria WHERE entidad = 'sgc_documentos' AND entidad_id = ? AND accion = 'crear'", String(E.data?.id)));
const lista = (await api("GET", "/sgc/externos", undefined, t.luis)).data?.items || [];
const enLista = lista.find((x) => x.id === E.data?.id);
check("pantalla de externos: origen, versión, responsable, próxima revisión y estado", !!enLista && enLista.version_fecha === "2018" && enLista.responsable_nombre && enLista.proxima_revision === enDias(365) && enLista.estado === "vigente" && enLista.pendiente_revision === false);
const explora = (await api("GET", "/sgc/documentos?origen=externo", undefined, t.luis)).data?.items || [];
check("el explorador lo muestra con origen «externo»", explora.some((x) => x.id === E.data?.id && x.origen === "externo"));
const verifLuis = await api("POST", `/sgc/externos/${E.data?.id}/verificar`, { comentario: "Sigue vigente según IMNC", proxima_revision: enDias(400) }, t.luis);
check("verificar la vigencia: quien no es responsable ni gestiona externos → 403", verifLuis.status === 403, `${verifLuis.status}`);
const verifCorto = await api("POST", `/sgc/externos/${E.data?.id}/verificar`, { comentario: "ok", proxima_revision: enDias(400) }, t.ricardo);
check("verificar exige comentario (400)", verifCorto.status === 400, `${verifCorto.status}`);
const verif = await api("POST", `/sgc/externos/${E.data?.id}/verificar`, { comentario: "Sigue vigente según el catálogo del IMNC", proxima_revision: enDias(400) }, t.ricardo);
check("el responsable confirma que sigue vigente con nueva próxima revisión", verif.status === 200 && fila("SELECT proxima_revision, ultima_revision FROM sgc_externos WHERE documento_id = ?", E.data?.id)?.proxima_revision === enDias(400) && fila("SELECT fecha_proxima_revision FROM sgc_revisiones WHERE id = ?", E1)?.fecha_proxima_revision === enDias(400), `${verif.status} ${verif.data?.message}`);
const verRic = await api("POST", `/sgc/externos/${E.data?.id}/version`, { version_fecha: "2025", proxima_revision: enDias(300) }, t.ricardo);
check("registrar nueva versión: solo quien gestiona externos (403)", verRic.status === 403, `${verRic.status}`);
const v2 = await version(t.ana, E.data?.id, { version_fecha: "2025", proxima_revision: enDias(20), comentario: "Nueva edición publicada" });
const E2 = v2.data?.revision_id;
check("nueva versión: queda vigente y la anterior obsoleta en el historial", v2.status === 201 && fila("SELECT estado FROM sgc_revisiones WHERE id = ?", E1)?.estado === "obsoleta" && fila("SELECT estado, version_externa FROM sgc_revisiones WHERE id = ?", E2)?.version_externa === "2025" && fila("SELECT sustituida_por_id FROM sgc_revisiones WHERE id = ?", E1)?.sustituida_por_id === E2 && filas("SELECT id FROM sgc_revisiones WHERE documento_id = ? AND estado = 'vigente'", E.data?.id).length === 1, `${v2.status} ${v2.data?.message}`);
// Aviso por fecha: proxima revision en 20 dias => pendiente de revision.
const lista2 = (await api("GET", "/sgc/externos?estado=pendiente_revision", undefined, t.ana)).data?.items || [];
check("a 30 días de la próxima revisión: «Pendiente de revisión» en la pantalla de externos", lista2.some((x) => x.id === E.data?.id && x.pendiente_revision));
const tRic = (await bandeja(t.ricardo)).items || [];
const tAna = (await bandeja(t.ana)).items || [];
check("aviso en la bandeja del responsable y de Mejora Continua", tRic.some((x) => x.tipo === "pendiente_revision" && x.documento_id === E.data?.id && /externo/.test(x.accion)) && tAna.some((x) => x.tipo === "pendiente_revision" && x.documento_id === E.data?.id));
check("aviso en la campana del responsable", (await avisos(t.ricardo)).some((x) => String(x.clave).startsWith(`sgc_pendiente_revision:${E.data?.id}:`)));
const fE = (await doc(E.data?.id, t.ana)).data;
check("ficha del externo: datos de seguimiento, sin flujo interno (nueva revisión deshabilitada)", fE?.externo?.fuente === "IMNC" && fE?.externo?.version_fecha === "2025" && fE?.puede?.nueva_revision?.ok === false && fE?.puede?.proponer?.ok === false && fE?.externo?.puede?.nueva_version?.ok === true);
const extRev = await api("POST", `/sgc/documentos/${E.data?.id}/revisiones`, { motivo_cambio: "Intento de revisión interna de un externo", elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.patricia }, t.ana);
const extSol = await api("POST", "/sgc/solicitudes", { tipo: "cambio", documento_id: E.data?.id, justificacion: "Intento de cambio interno a una norma externa" }, t.luis);
const extRen = await api("POST", `/sgc/documentos/${E.data?.id}/renovar`, { revisor_id: id.ricardo, autorizador_id: id.patricia, fecha_proxima_revision: enDias(700), comentario: "Intento de renovación" }, t.ana);
check("por API tampoco: un externo no recibe nueva revisión, solicitud de cambio ni renovación (409)", [extRev, extSol, extRen].every((x) => x.status === 409 && x.data?.codigo === "externo"), `${extRev.status} ${extSol.status} ${extRen.status}`);
const fichaInt = await ficha(t.ana, { clave: `ABC-${s5}`, titulo: "Externo por la ficha interna", area_codigo: "GC", tipo_codigo: "P", origen: "externo", elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.patricia });
check("la ficha interna no registra externos (400)", fichaInt.status === 400 && fichaInt.data?.campo === "origen", `${fichaInt.status} ${fichaInt.data?.campo} ${fichaInt.data?.message}`);
const editar = await api("PUT", `/sgc/externos/${E.data?.id}`, { enlace: "https://www.imnc.org.mx/normas", motivo: "Cambió la dirección del catálogo" }, t.ana);
check("editar datos de seguimiento con motivo, a la bitácora", editar.status === 200 && !!fila("SELECT id FROM auditoria WHERE entidad = 'sgc_documentos' AND entidad_id = ? AND accion = 'editar'", String(E.data?.id)));

/* ---------- 2. Distribucion y lectura controlada (CA-11) ---------- */
// Documento interno con revision 2 autorizada para publicar con distribucion.
const D = (await ficha(t.ana, { clave: `FX-TCP-L${s5}`, titulo: `Procedimiento con lectura ${s5}`, area_codigo: "TC", tipo_codigo: "P", elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.patricia })).data;
await api("POST", `/sgc/revisiones/${D.revision_id}/registrar-vigente`, { fecha_emision: "2025-01-10", fecha_proxima_revision: "2028-01-10" }, t.ana);
const R1 = D.revision_id;
const auxiliar = rolId("Técnico Auxiliar");
const auditor = rolId("Auditor Interno");
const sinAdm = await api("POST", `/sgc/revisiones/${R1}/distribucion`, { roles: [auxiliar], requiere_lectura: true, motivo: "Distribución inicial" }, t.luis);
const sinJorge = await api("POST", `/sgc/revisiones/${R1}/distribucion`, { roles: [auxiliar], requiere_lectura: true, motivo: "Distribución inicial" }, t.jorge);
check("administrar distribución: Analista y admin técnico → 403", sinAdm.status === 403 && [403, 404].includes(sinJorge.status), `${sinAdm.status} ${sinJorge.status}`);
const sinMotivo = await api("POST", `/sgc/revisiones/${R1}/distribucion`, { roles: [auxiliar], requiere_lectura: true }, t.ana);
check("agregar destinatarios exige motivo (400)", sinMotivo.status === 400 && sinMotivo.data?.campo === "motivo", `${sinMotivo.status}`);
const distSinPwd = await api("POST", `/sgc/revisiones/${R1}/distribucion`, { roles: [auxiliar], requiere_lectura: true, motivo: "Distribución inicial" }, t.ana, SIN_REAUTH);
check("agregar destinatarios pide contraseña (401)", distSinPwd.status === 401 && distSinPwd.data?.codigo === "reauth_required", `${distSinPwd.status}`);
const jorgeDest = await api("POST", `/sgc/revisiones/${R1}/distribucion`, { usuarios: [id.jorge], motivo: "Prueba de destinatario sin permiso" }, t.ana);
check("no se asigna como destinatario a quien no puede consultar vigentes (400)", jorgeDest.status === 400 && jorgeDest.data?.campo === "usuarios", `${jorgeDest.status} ${jorgeDest.data?.message}`);
const audLect = await api("POST", `/sgc/revisiones/${R1}/distribucion`, { roles: [auditor], requiere_lectura: true, motivo: "Prueba de rol sin acuse" }, t.ana);
check("un rol que no puede acusar lectura no recibe lectura requerida (400)", audLect.status === 400 && audLect.data?.campo === "roles", `${audLect.status}`);
const dist = await api("POST", `/sgc/revisiones/${R1}/distribucion`, { roles: [auxiliar], usuarios: [id.luis], punto_uso: "Área de extracción", requiere_lectura: true, motivo: "Distribución inicial del procedimiento" }, t.ana);
check("Mejora Continua define la distribución por rol y por persona con punto de uso", dist.status === 201 && filas("SELECT id FROM sgc_distribucion WHERE revision_id = ? AND retirado_en IS NULL", R1).length === 2, `${dist.status} ${dist.data?.message}`);
const fD = (await doc(D.id, t.ana)).data?.distribucion;
check("ficha: destinatarios efectivos (Luis y los Técnicos Auxiliares), punto de uso y avance 0 %", !!fD && fD.destinatarios.some((x) => x.usuario_id === id.luis) && fD.destinatarios.some((x) => x.usuario_id === id.mariana) && fD.puntos_uso.includes("Área de extracción") && fD.avance.porcentaje === 0, JSON.stringify(fD?.avance));
const bLuis = await bandeja(t.luis);
check("«Lecturas pendientes» en la bandeja y la campana del destinatario", (bLuis.lecturas_pendientes || []).some((x) => x.documento_id === D.id && x.revision === 1) && (await avisos(t.luis)).some((x) => String(x.clave).startsWith(`sgc_lectura:${R1}:`)));
const resLuis = (await api("GET", "/sgc/resumen", undefined, t.luis)).data;
check("vista general: lecturas pendientes propias", resLuis?.indicadores?.lecturas_mias >= 1 && resLuis?.indicadores?.lecturas_globales === null);
const sinAbrir = await api("POST", `/sgc/revisiones/${R1}/acusar`, {}, t.luis);
check("el acuse exige haber abierto el PDF vigente en el visor (409)", sinAbrir.status === 409 && sinAbrir.data?.codigo === "sin_abrir", `${sinAbrir.status} ${sinAbrir.data?.message}`);
await abrirPdf(t.luis, R1);
const acuse = await api("POST", `/sgc/revisiones/${R1}/acusar`, {}, t.luis);
const lec = fila("SELECT * FROM sgc_lecturas WHERE revision_id = ? AND usuario_id = ?", R1, id.luis);
check("acuse ligado a usuario + revisión con fecha y hora", acuse.status === 200 && !!lec?.leido_en && lec?.estado === "leido", `${acuse.status} ${acuse.data?.message}`);
const otraVez = await api("POST", `/sgc/revisiones/${R1}/acusar`, {}, t.luis);
check("el acuse no se repite ni se deshace (409)", otraVez.status === 409 && fila("SELECT leido_en FROM sgc_lecturas WHERE id = ?", lec?.id)?.leido_en === lec?.leido_en);
const noDest = await api("POST", `/sgc/revisiones/${R1}/acusar`, {}, t.gabriela);
check("quien no es destinatario no acusa (409)", noDest.status === 409 && noDest.data?.codigo === "no_destinatario", `${noDest.status}`);
check("tras el acuse desaparece de las lecturas pendientes", !((await bandeja(t.luis)).lecturas_pendientes || []).some((x) => x.documento_id === D.id));
check("el acuse queda en la bitácora", !!fila("SELECT id FROM auditoria WHERE entidad = 'sgc_documentos' AND entidad_id = ? AND accion = 'confirmar_lectura'", String(D.id)));
// Recordatorio manual.
const recLuis = await api("POST", `/sgc/revisiones/${R1}/recordatorio`, {}, t.luis);
const rec = await api("POST", `/sgc/revisiones/${R1}/recordatorio`, {}, t.ana);
const avisoMar = (await avisos(t.mariana)).find((x) => String(x.clave).startsWith(`sgc_lectura:${R1}:`));
check("recordatorio: solo Mejora Continua; llega a la campana como aviso nuevo", recLuis.status === 403 && rec.status === 200 && !!avisoMar && !String(avisoMar.clave).endsWith(":inicial"), `${recLuis.status} ${rec.status} ${avisoMar?.clave}`);
// Quien recibe el rol despues tambien recibe el pendiente.
const email = `lectora.${s5.toLowerCase()}@ficotox.local`;
const alta = await api("POST", "/admin/usuarios", { nombre: `Lectora nueva ${s5}`, email, activo: true, rol_id: auxiliar, password: "LecturaFase3-2026!", motivo: "Alta de prueba de lecturas" }, t.qa);
const tNueva = await login(email, "LecturaFase3-2026!");
check("quien recibe después el rol distribuido también tiene la lectura pendiente", alta.status === 201 && ((await bandeja(tNueva)).lecturas_pendientes || []).some((x) => x.documento_id === D.id), `${alta.status}`);
// Quitar destinatario con motivo.
const filaLuis = fila("SELECT id FROM sgc_distribucion WHERE revision_id = ? AND usuario_id = ? AND retirado_en IS NULL", R1, id.luis);
const quitarSin = await api("POST", `/sgc/distribucion/${filaLuis?.id}/retirar`, {}, t.ana);
const quitar = await api("POST", `/sgc/distribucion/${filaLuis?.id}/retirar`, { motivo: "Ya no trabaja en el área" }, t.ana);
check("quitar un destinatario exige motivo y queda retirado", quitarSin.status === 400 && quitar.status === 200 && !!fila("SELECT retirado_en FROM sgc_distribucion WHERE id = ?", filaLuis?.id)?.retirado_en);
check("su acuse ya registrado se conserva", !!fila("SELECT leido_en FROM sgc_lecturas WHERE id = ?", lec?.id)?.leido_en);
// Nueva revision publicada: las lecturas de la anterior no cuentan; pendientes nuevos.
await api("POST", `/sgc/documentos/${D.id}/revisiones`, { motivo_cambio: "Actualización del procedimiento", elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.patricia }, t.ana);
const R2 = fila("SELECT id FROM sgc_revisiones WHERE documento_id = ? AND numero = 2", D.id)?.id;
const fd2 = new FormData();
fd2.append("tipo", "pdf");
fd2.append("archivo", new Blob([await pdfConTexto(1, "Rev2")]), "rev2.pdf");
await api("POST", `/sgc/revisiones/${R2}/archivos`, fd2, t.luis);
await api("PUT", `/sgc/revisiones/${R2}`, { apartados_afectados: "Sección 3", descripcion_cambio: "Se actualiza" }, t.luis);
await api("POST", `/sgc/revisiones/${R2}/enviar-revision`, {}, t.luis);
await api("POST", `/sgc/revisiones/${R2}/revisar`, { decision: "aceptar", comentario: "Correcto" }, t.ricardo);
await api("POST", `/sgc/revisiones/${R2}/autorizar`, { decision: "autorizar" }, t.patricia);
const pub = await api("POST", `/sgc/revisiones/${R2}/publicar`, { fecha_emision: hoy, distribucion: { usuarios: [id.luis, id.diego], roles: [auxiliar], punto_uso: "Laboratorio de cromatografía", requiere_lectura: true } }, t.ana);
check("al publicar se define la distribución de la nueva revisión", pub.status === 200 && filas("SELECT id FROM sgc_distribucion WHERE revision_id = ? AND retirado_en IS NULL", R2).length === 3, `${pub.status} ${pub.data?.message}`);
const bLuis2 = await bandeja(t.luis);
check("las lecturas de la revisión anterior no cuentan: Luis tiene pendiente la revisión 2", (bLuis2.lecturas_pendientes || []).some((x) => x.documento_id === D.id && x.revision === 2));
check("el estudiante distribuido recibe la lectura", ((await bandeja(t.diego)).lecturas_pendientes || []).some((x) => x.documento_id === D.id && x.revision === 2));
const resAna = (await api("GET", "/sgc/resumen", undefined, t.ana)).data;
check("vista general de Mejora Continua: lecturas pendientes globales", (resAna?.indicadores?.lecturas_globales || 0) >= 3, JSON.stringify(resAna?.indicadores));

/* ---------- 3. Confidencialidad: destinatario ve; no destinatario no ---------- */
const C = (await ficha(t.ana, { clave: `FX-GCL-K${s5}`, titulo: `Lista confidencial con lectura ${s5}`, area_codigo: "GC", tipo_codigo: "L", confidencialidad: "confidencial", elaborador_id: id.luis, revisor_id: id.gabriela, autorizador_id: id.patricia })).data;
await api("POST", `/sgc/revisiones/${C.revision_id}/registrar-vigente`, { fecha_emision: "2025-02-01" }, t.ana);
check("antes de distribuirlo, Mariana no ve el confidencial (404)", (await doc(C.id, t.mariana)).status === 404);
await api("POST", `/sgc/revisiones/${C.revision_id}/distribucion`, { usuarios: [id.mariana], requiere_lectura: true, motivo: "Mariana usa la lista en recepción" }, t.ana);
check("destinataria: Mariana ya lo ve (Fase 1) y tiene la lectura", (await doc(C.id, t.mariana)).status === 200 && ((await bandeja(t.mariana)).lecturas_pendientes || []).some((x) => x.documento_id === C.id));
check("quien no es destinatario no lo ve en bandeja, campana ni lista", (await doc(C.id, t.diego)).status === 404 && !((await bandeja(t.diego)).lecturas_pendientes || []).some((x) => x.documento_id === C.id));

/* ---------- 4. Lista Maestra (CA-09) ---------- */
const LM = (q, token) => api("GET", `/sgc/lista-maestra${q}`, undefined, token);
const lmAna = (await LM("", t.ana)).data?.items || [];
check("Lista Maestra: incluye internos y externos con área, color, revisión vigente y responsables", lmAna.some((x) => x.id === D.id && x.revision === "Rev. 2" && x.area_color && x.elaborador && x.revisor && x.autorizador) && lmAna.some((x) => x.id === E.data?.id && x.origen === "externo" && x.revision === "2025"));
// Revision en curso indicada en el renglon.
await api("POST", `/sgc/documentos/${D.id}/revisiones`, { motivo_cambio: "Otra actualización", elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.patricia }, t.ana);
const lmCurso = (await LM("?estado=en_curso", t.luis)).data?.items || [];
check("revisión en curso indicada en el mismo renglón («Rev. 3 en elaboración»)", lmCurso.some((x) => x.id === D.id && x.en_curso === "Rev. 3 en elaboración" && x.revision === "Rev. 2"), JSON.stringify(lmCurso.find((x) => x.id === D.id)));
const porArea = (await LM("?area=GC&origen=externo", t.ana)).data?.items || [];
check("filtros por área y origen", porArea.length >= 1 && porArea.every((x) => x.area_codigo === "GC" && x.origen === "externo"));
const busq = (await LM(`?search=${encodeURIComponent(`Procedimiento con lectura ${s5}`)}`, t.ana)).data?.items || [];
check("búsqueda", busq.length === 1 && busq[0].id === D.id);
const pend = (await LM("?estado=pendiente_revision", t.ana)).data?.items || [];
check("filtro de pendientes de revisión (incluye al externo)", pend.some((x) => x.id === E.data?.id));
const lmLuis = (await LM("", t.luis)).data?.items || [];
check("respeta la confidencialidad: Luis (elaborador del confidencial) sí; Diego no", lmLuis.some((x) => x.id === C.id) && !((await LM("", t.diego)).data?.items || []).some((x) => x.id === C.id));
// Obsoleto: solo con historico.
const O = (await ficha(t.ana, { clave: `FX-ADL-O${s5}`, titulo: `Lista que se obsoleta ${s5}`, area_codigo: "AD", tipo_codigo: "L", elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.patricia })).data;
await api("POST", `/sgc/revisiones/${O.revision_id}/registrar-vigente`, { fecha_emision: "2024-01-01" }, t.ana);
const obs = await api("POST", `/sgc/documentos/${O.id}/obsoletar`, { motivo: "Se sustituye por el sistema" }, t.ana, { "X-Sin-Aprobar-Auto": "1" });
await api("POST", `/solicitudes/${obs.data?.solicitud?.id}/aprobar`, { motivo: "Se confirma el retiro de la lista" }, t.patricia, { "X-Sin-Aprobar-Auto": "1" });
const conObs = (await LM("?obsoletos=1", t.ana)).data?.items || [];
const luisObs = (await LM("?obsoletos=1", t.luis)).data?.items || [];
check("«Incluir obsoletos» solo con consultar_historico", fila("SELECT estado FROM sgc_documentos WHERE id = ?", O.id)?.estado === "obsoleto" && conObs.some((x) => x.id === O.id && x.estado === "obsoleto") && !lmAna.some((x) => x.id === O.id) && !luisObs.some((x) => x.id === O.id));
const lmJorge = await LM("", t.jorge);
check("el admin técnico no consulta la Lista Maestra (403)", lmJorge.status === 403, `${lmJorge.status}`);
// PDF.
const pdfLuis = await api("GET", "/sgc/lista-maestra/pdf", undefined, t.luis);
const pdfJorge = await api("GET", "/sgc/lista-maestra/pdf", undefined, t.jorge);
check("generar el PDF requiere lista_maestra_exportar (Analista y admin técnico → 403)", pdfLuis.status === 403 && pdfJorge.status === 403, `${pdfLuis.status} ${pdfJorge.status}`);
const auditAntes = filas("SELECT id FROM auditoria WHERE accion = 'exportar' AND referencia = 'Lista Maestra FX-GCL-MD'").length;
const pdf = await api("GET", "/sgc/lista-maestra/pdf?area=TC&obsoletos=1", undefined, t.ana);
check("PDF: inline (sin descarga automática) y tipo application/pdf", pdf.status === 200 && Buffer.isBuffer(pdf.data) && pdf.data.toString("latin1", 0, 5) === "%PDF-" && /^inline/.test(pdf.headers.get("content-disposition") || ""), `${pdf.status} ${pdf.headers.get("content-disposition")}`);
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
async function leerPdf(buf) {
  const d = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false, isEvalSupported: false, standardFontDataUrl: new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname }).promise;
  const paginas = [];
  const colores = new Set();
  let horizontal = true;
  for (let i = 1; i <= d.numPages; i += 1) {
    const p = await d.getPage(i);
    const vp = p.getViewport({ scale: 1 });
    if (vp.width <= vp.height) horizontal = false;
    paginas.push((await p.getTextContent()).items.map((x) => x.str).join(" "));
    const ops = await p.getOperatorList();
    ops.fnArray.forEach((fn, k) => {
      if (fn === pdfjs.OPS.setFillRGBColor) {
        const a = ops.argsArray[k];
        colores.add(typeof a[0] === "string" ? a[0].toLowerCase() : `#${a.slice(0, 3).map((v) => Math.round(v * (v <= 1 ? 255 : 1)).toString(16).padStart(2, "0")).join("")}`);
      }
    });
  }
  return { paginas, colores, horizontal, n: d.numPages };
}
const leido = await leerPdf(pdf.data);
const todo = leido.paginas.join("\n");
const colorTC = ((await api("GET", "/sgc/catalogos", undefined, t.ana)).data?.areas || []).find((x) => x.codigo === "TC")?.color?.toLowerCase();
check("PDF: encabezado del laboratorio y título «Lista Maestra de Documentos FX-GCL-MD»", /Laboratorio Nacional/.test(todo) && /LISTA MAESTRA DE DOCUMENTOS FX-GCL-MD/.test(todo));
check("PDF: fecha y hora de generación y quién la generó", /Generada el \d{2}\/\d{2}\/\d{4}/.test(todo) && /por Ana Sof/.test(todo), todo.slice(0, 300));
check("PDF: filtros aplicados", /Filtros: .*TC/.test(todo) && /Incluye obsoletos/.test(todo));
check("PDF: tabla agrupada por área con la sigla y la banda de su color", /TC\s+·/.test(todo) && leido.colores.has(colorTC), `${colorTC} ${[...leido.colores].join(",")}`);
check("PDF: renglones del área filtrada con su revisión en curso", todo.includes(`FX-TCP-L${s5}`) && /Rev\. 3 en elaboración/.test(todo) && !todo.includes(NMX));
check("PDF: pie «Página X de Y» en cada página y orientación horizontal", leido.horizontal && leido.paginas.every((p, i) => p.includes(`Página ${i + 1} de ${leido.n}`)));
// Suficientes renglones para varias paginas (paginacion y encabezado de area repetido).
for (let i = 0; i < 36; i += 1) await externo(t.ana, { ...baseExt, identificador: `GUIA-${s5}-${String(i).padStart(2, "0")}`, titulo: `Guía regulatoria de referencia número ${i} para la paginación de la Lista Maestra`, area_codigo: "AD" });
const pdfTodos = await leerPdf((await api("GET", "/sgc/lista-maestra/pdf", undefined, t.ana)).data);
check("PDF sin filtros: «Todos los documentos» y paginación de varias páginas", /Filtros: Todos los documentos/.test(pdfTodos.paginas[0]) && pdfTodos.n >= 2 && pdfTodos.paginas.every((p, i) => p.includes(`Página ${i + 1} de ${pdfTodos.n}`)) && pdfTodos.paginas.some((p, i) => i > 0 && /AD\s+·.*\(continúa\)/.test(p)), `${pdfTodos.n} páginas`);
const pdfHector = await leerPdf((await api("GET", "/sgc/lista-maestra/pdf", undefined, t.hector)).data);
check("PDF del auditor: respeta la confidencialidad (sin el confidencial)", !pdfHector.paginas.join(" ").includes(`FX-GCL-K${s5}`) && pdfTodos.paginas.join(" ").includes(`FX-GCL-K${s5}`));
const auditDespues = filas("SELECT cambios_json FROM auditoria WHERE accion = 'exportar' AND referencia = 'Lista Maestra FX-GCL-MD' ORDER BY id");
check("cada generación queda en la bitácora con sus filtros", auditDespues.length === auditAntes + 3 && auditDespues.some((x) => /"area":"TC"/.test(String(x.cambios_json))), `${auditAntes} → ${auditDespues.length}`);

/* ---------- 5. Indicadores por persona ---------- */
const rAna = (await api("GET", "/sgc/resumen", undefined, t.ana)).data?.indicadores;
const rDiego = (await api("GET", "/sgc/resumen", undefined, t.diego)).data?.indicadores;
check("indicadores de Mejora Continua: vigentes, en revisión, por publicar, pendientes internos y externos", rAna && rAna.vigentes > 0 && typeof rAna.en_revision === "number" && typeof rAna.por_publicar === "number" && rAna.pendientes_revision.externos >= 1, JSON.stringify(rAna));
check("indicadores del estudiante: sin documentos que no ve ni lecturas globales", rDiego && rDiego.vigentes < rAna.vigentes && rDiego.lecturas_globales === null && rDiego.lecturas_mias >= 1, JSON.stringify(rDiego));
const actDiego = (await api("GET", "/sgc/resumen", undefined, t.diego)).data?.actividad || [];
check("actividad reciente: solo de documentos visibles (el estudiante no ve el confidencial)", !actDiego.some((x) => x.documento_id === C.id) && ((await api("GET", "/sgc/resumen", undefined, t.ana)).data?.actividad || []).length > 0);
const jorgeRes = (await api("GET", "/sgc/resumen", undefined, t.jorge)).data;
check("admin técnico: sin lecturas ni exportar la Lista Maestra", jorgeRes?.puede?.exportar_maestra === false && jorgeRes?.puede?.registrar_externo === false);
const jorgeExt = await api("POST", `/sgc/externos/${E.data?.id}/verificar`, { comentario: "Intento del administrador técnico", proxima_revision: enDias(500) }, t.jorge);
const jorgeRec = await api("POST", `/sgc/revisiones/${R2}/recordatorio`, {}, t.jorge);
check("admin técnico: no verifica externos ni envía recordatorios", [403, 404].includes(jorgeExt.status) && [403, 404].includes(jorgeRec.status), `${jorgeExt.status} ${jorgeRec.status}`);

terminar();
