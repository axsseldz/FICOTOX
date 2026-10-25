/*
 * Prueba integral · cobertura de Calidad, Auditoría y «Por autorizar» (API).
 * Cada check lleva la etiqueta [cob:C:<id>] del renglón de la matriz que prueba:
 * validaciones de incidencias, NC, acciones, verificación, comunicaciones, retenciones,
 * suspensiones, cierre y anulación (V-01…V-56), incidencias automáticas (T-02), lo que no
 * se restaura (T-07, T-17), el efecto de una suspensión (3.5), quién aprueba cada tipo de
 * solicitud (3.8), GET /api/autorizaciones/personas (4) y los filtros de la bitácora (5.1).
 * Todo sobre datos propios (nombres con un sufijo único); lo que bloquea trabajo ajeno
 * (suspensiones, retenciones) es sobre un equipo y un informe de esta prueba y se libera al final.
 */
import "./lib/reauth-auto.mjs";
import fs from "node:fs";
import path from "node:path";
import { analisisDe, api, BASE, cadena, crearCheck, Database, enDias, fila, filas, hoy, informeLiberado, login, sesiones } from "./lib/calidad.mjs";
import { pdfConTexto } from "./lib/archivos.mjs";
import { registrarEnvio } from "./lib/envio.mjs";

const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const s5 = Date.now().toString(36).slice(-5);
const SIN_APROBAR = { "X-Sin-Aprobar-Auto": "1" };
const SIN_REAUTH = { "X-Sin-Reauth-Auto": "1" };
const NO_EXISTE = 99_999_999;
let AUT_VENCIDA = null;
const ejecutar = (sql, ...p) => {
  const b = new Database(process.env.TEST_DB_PATH);
  try {
    return b.prepare(sql).run(...p);
  } finally {
    b.close();
  }
};
const det = (r) => `${r?.status} ${r?.data?.codigo || ""} ${r?.data?.message || ""}`.trim();
const ahoraIso = () => new Date().toISOString();
const ncRow = (N) => fila("SELECT * FROM no_conformidades WHERE id = ?", N);
const incRow = (I) => fila("SELECT * FROM incidencias WHERE id = ?", I);
const solRow = (S) => fila("SELECT * FROM solicitudes_autorizacion WHERE id = ?", S);
const aprobar = (S, token, motivo = "Revisado por un segundo usuario", headers = {}) => api("POST", `/solicitudes/${S}/aprobar`, { motivo }, token, headers);
const rechazar = (S, token, motivo = "No procede en la prueba de cobertura", headers = {}) => api("POST", `/solicitudes/${S}/rechazar`, { motivo }, token, headers);
const cancelar = (S, token, body = {}, headers = {}) => api("POST", `/solicitudes/${S}/cancelar`, body, token, headers);

/* ---------- Datos base ---------- */
const reportar = (token, extra = {}) => api("POST", "/calidad/incidencias", { tipo: "otro", fecha_hora_ocurrencia: ahoraIso(), descripcion: `Incidencia de cobertura ${s5} con texto suficiente`, impacto_resultados: "no", ...extra }, token);
const IMPACTO = { afecta_resultados_emitidos: "no", trabajo_detenido: "no", notificar_cliente: "no" };
const CAUSA = { metodo_causa: "otro", causa_raiz: "Causa raíz documentada en la prueba de cobertura", requiere_accion_correctiva: "si" };
const SIN_ACCION = { ...IMPACTO, requiere_accion_correctiva: "no", justificacion_sin_accion: "Hecho aislado sin riesgo de repetirse" };
const nuevaNc = async (desc, extra = {}) => (await api("POST", "/calidad/nc", { origen: "otro", descripcion: `${desc} · cobertura ${s5}`, responsable_id: id.ricardo, ...extra }, t.ana)).data?.id;
const accion = async (N, responsable = id.luis, desc = "Acción de la prueba de cobertura") => (await api("POST", `/calidad/nc/${N}/acciones`, { descripcion: desc, responsable_id: responsable, fecha_compromiso: enDias(7) }, t.ana)).data?.id;
/* NC en análisis (impacto evaluado), responsable Ricardo. */
async function ncEnAnalisis(desc, extra = {}) {
  const N = await nuevaNc(desc, extra);
  await api("PUT", `/calidad/nc/${N}`, IMPACTO, t.ana);
  await api("POST", `/calidad/nc/${N}/avanzar`, { a: "en_analisis" }, t.ana);
  return N;
}
/* NC con acciones en curso (una acción de Luis pendiente). */
async function ncConAcciones(desc, responsableAccion = id.luis) {
  const N = await ncEnAnalisis(desc);
  await api("PUT", `/calidad/nc/${N}`, CAUSA, t.ana);
  const A = await accion(N, responsableAccion);
  await api("POST", `/calidad/nc/${N}/avanzar`, { a: "acciones_en_curso" }, t.ana);
  return { N, A };
}
const inspeccion = { checklist: Array.from({ length: 7 }, (_, i) => ({ requisito: `Requisito ${i + 1}`, estado: i === 6 ? "NA" : "C", observacion: null })), observaciones_generales: null };
const recepcion = (idInt, extra = {}) => ({ fecha_recepcion: "2026-09-20", hora_recepcion: "09:00", recibido_por: "QA", medio_recepcion: "directa", solicitante: `Cliente ${idInt}`, muestra_unica: true, id_interno: idInt, fecha_muestra: "2026-09-19", analisis: { tipos: ["toxinas_lipofilicas"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] }, inspeccion, decision_aceptacion: "aceptada", aceptacion: { fecha: "2026-09-20", responsable: "QA", comunicacion_cliente: { medio: "correo", fecha: "2026-09-20", persona: "Cliente", respuesta: "Se informó y pidió continuar" } }, ...extra });
const rolAuxiliar = ((await api("GET", "/admin/roles", undefined, t.qa)).data?.items || []).find((r) => r.nombre === "Técnico Auxiliar")?.id;
async function cuenta(nombre, extra = {}, headers = {}) {
  const email = `${nombre.toLowerCase().replace(/\s+/g, ".")}.${s5}@ficotox.local`;
  const r = await api("POST", "/admin/usuarios", { nombre: `${nombre} ${s5}`, email, activo: true, rol_id: rolAuxiliar, departamento: "Laboratorio", password: `Temporal-${s5}-2026`, motivo: "Alta de la prueba de cobertura", ...extra }, t.jorge, headers);
  return { id: Number(r.data?.id), email, nombre: `${nombre} ${s5}`, status: r.status };
}
/* Informe autorizado (sin liberar) con un análisis aprobado, como informeLiberado. */
async function informeAutorizado(etiqueta) {
  const c = await cadena(t, etiqueta);
  const A = (await api("POST", "/samples/analysis", analisisDe(c), t.qa)).data?.id;
  await api("POST", `/samples/analysis/${A}/enviar-revision`, {}, t.qa);
  await api("POST", `/samples/analysis/${A}/revisar`, {}, t.ricardo);
  await api("POST", `/samples/analysis/${A}/aprobar`, {}, t.ricardo);
  const inf = (await api("POST", "/informes", { recepcion_id: c.R, analisis_ids: [A], cliente: { nombre: `Cliente ${etiqueta}`, correo: "cliente@ejemplo.mx" } }, t.qa)).data?.id;
  await api("POST", `/informes/${inf}/revisar`, {}, t.ricardo);
  await api("POST", `/informes/${inf}/autorizar`, {}, t.patricia);
  return inf;
}
const datosCuenta = (c, extra) => ({ nombre: c.nombre, email: c.email, departamento: "Laboratorio", activo: true, tipo_cuenta: "permanente", vigente_desde: null, vigente_hasta: null, supervisor_id: null, ...extra });

// NC cerrada (sin acción correctiva): sirve de NC cerrada en varias reglas y de PDF para la alerta de integridad.
const NCERR = await nuevaNc("NC cerrada de la prueba de cobertura");
await api("PUT", `/calidad/nc/${NCERR}`, SIN_ACCION, t.ana);
const cierreBase = await api("POST", `/calidad/nc/${NCERR}/cerrar`, { conclusion: "Se cerró sin acción en la prueba de cobertura" }, t.patricia);
check("(preparación) NC cerrada sin acción correctiva", cierreBase.status === 200 && ncRow(NCERR)?.estado === "cerrada", det(cierreBase));

/* =================== Reportar incidencia (V-01…V-06) =================== */
{
  const marca = `cobV-${s5}`;
  const deMarca = () => Number(fila("SELECT COUNT(*) AS n FROM incidencias WHERE descripcion LIKE ?", `%${marca}%`)?.n);
  const base = { descripcion: `${marca}: la balanza marcó lecturas inestables` };
  const tipo = await reportar(t.luis, { ...base, tipo: "volcan" });
  check("[cob:C:V-01] tipo fuera del catálogo → 400 y no se crea", tipo.status === 400 && deMarca() === 0, det(tipo));
  const corta = await reportar(t.luis, { descripcion: `${marca} 19 letras`.slice(0, 19).padEnd(19, "x") });
  check("[cob:C:V-02] descripción de 19 caracteres → 400", corta.status === 400 && /20/.test(corta.data?.message || "") && deMarca() === 0, det(corta));
  const impacto = await reportar(t.luis, { ...base, impacto_resultados: "quizas" });
  check("[cob:C:V-03] impacto distinto de sí/no/desconocido → 400", impacto.status === 400 && deMarca() === 0, det(impacto));
  const fecha = await reportar(t.luis, { ...base, fecha_hora_ocurrencia: "ayer por la tarde" });
  const sinFecha = await reportar(t.luis, { ...base, fecha_hora_ocurrencia: "" });
  check("[cob:C:V-04] fecha y hora de ocurrencia inválidas o vacías → 400", fecha.status === 400 && sinFecha.status === 400 && deMarca() === 0, `${det(fecha)} | ${det(sinFecha)}`);
  const futura = await reportar(t.luis, { ...base, fecha_hora_ocurrencia: new Date(Date.now() + 10 * 60_000).toISOString() });
  const tolerada = await reportar(t.luis, { ...base, fecha_hora_ocurrencia: new Date(Date.now() + 2 * 60_000).toISOString() });
  check("[cob:C:V-05] ocurrencia a 10 min en el futuro → 400; a 2 min (reloj desfasado) sí se acepta", futura.status === 400 && tolerada.status === 201 && deMarca() === 1, `${det(futura)} | ${det(tolerada)}`);

  // V-06: registros ligados.
  const candidatos = [];
  for (const [entidad, tabla] of [["muestras_recepcion", "muestras_recepcion"], ["equipos", "equipos"], ["reactivos", "reactivos"], ["consumibles", "consumibles"], ["muestras_procesamiento", "muestras_procesamiento"], ["muestras_extraccion", "muestras_extraccion"], ["informes", "informes"]]) {
    for (const r of filas(`SELECT id FROM ${tabla} ORDER BY id DESC LIMIT 13`)) if (candidatos.length < 13) candidatos.push({ entidad, entidad_id: r.id });
  }
  const trece = await reportar(t.qa, { descripcion: `${marca}: incidencia con trece registros ligados`, registros: candidatos });
  const ligados = Number(fila("SELECT COUNT(*) AS n FROM incidencia_registros WHERE incidencia_id = ?", trece.data?.id)?.n);
  check("[cob:C:V-06] con 13 registros ligados se guardan solo 12", candidatos.length === 13 && trece.status === 201 && ligados === 12, `${candidatos.length} ${det(trece)} ligados=${ligados}`);
  const noRelacionable = await reportar(t.qa, { descripcion: `${marca}: ligada a una cuenta de usuario`, registros: [{ entidad: "usuarios", entidad_id: id.luis }] });
  const inexistente = await reportar(t.qa, { descripcion: `${marca}: ligada a un equipo inexistente`, registros: [{ entidad: "equipos", entidad_id: NO_EXISTE }] });
  check("[cob:C:V-06] entidad no relacionable (usuarios) → 400; registro inexistente → 404", noRelacionable.status === 400 && inexistente.status === 404, `${det(noRelacionable)} | ${det(inexistente)}`);
  const ajena = await cadena(t, "COBV6");
  const propia = await cadena(t, "COBV6L", { asignar: [id.luis] });
  const luisAjena = await reportar(t.luis, { descripcion: `${marca}: Luis liga una recepción no asignada`, registros: [{ entidad: "muestras_recepcion", entidad_id: ajena.R }] });
  const luisPropia = await reportar(t.luis, { descripcion: `${marca}: Luis liga su recepción asignada`, registros: [{ entidad: "muestras_recepcion", entidad_id: propia.R }] });
  check("[cob:C:V-06] Luis (muestras asignado) no liga una recepción que no puede ver (404, como inexistente) y sí la asignada", luisAjena.status === 404 && luisPropia.status === 201, `${det(luisAjena)} | ${det(luisPropia)}`);
}

/* =================== Evaluar incidencia (V-07…V-12) =================== */
{
  const I = (await reportar(t.luis)).data?.id;
  const inicio = await api("POST", `/calidad/incidencias/${I}/evaluacion`, {}, t.ricardo);
  const otraVez = await api("POST", `/calidad/incidencias/${I}/evaluacion`, {}, t.patricia);
  check("[cob:C:V-12] iniciar la evaluación dos veces → 409 «La evaluación ya está en curso»", inicio.status === 200 && otraVez.status === 409 && /ya está en curso/.test(otraVez.data?.message || ""), `${det(inicio)} | ${det(otraVez)}`);
  const decision = await api("POST", `/calidad/incidencias/${I}/evaluar`, { decision: "posponer", justificacion: "Se decide más adelante" }, t.ricardo);
  check("[cob:C:V-07] decisión distinta de cerrar_sin_nc/escalar → 400", decision.status === 400 && incRow(I)?.estado === "en_evaluacion", det(decision));
  const just = await api("POST", `/calidad/incidencias/${I}/evaluar`, { decision: "cerrar_sin_nc", justificacion: "corta" }, t.ricardo);
  check("[cob:C:V-08] justificación de menos de 10 caracteres → 400", just.status === 400 && incRow(I)?.estado === "en_evaluacion", det(just));
  const ncNo = await api("POST", `/calidad/incidencias/${I}/evaluar`, { decision: "escalar", justificacion: "Se agrupa con otra NC", nc_id: NO_EXISTE }, t.ricardo);
  const ncCerrada = await api("POST", `/calidad/incidencias/${I}/evaluar`, { decision: "escalar", justificacion: "Se agrupa con otra NC", nc_id: NCERR }, t.ricardo);
  check("[cob:C:V-09] escalar a una NC inexistente → 404; a una NC cerrada → 409", ncNo.status === 404 && ncCerrada.status === 409 && incRow(I)?.estado === "en_evaluacion", `${det(ncNo)} | ${det(ncCerrada)}`);
  const ncsAntes = Number(fila("SELECT COUNT(*) AS n FROM no_conformidades WHERE incidencia_id = ?", I)?.n);
  const clasif = await api("POST", `/calidad/incidencias/${I}/evaluar`, { decision: "escalar", justificacion: "Amerita una no conformidad", nc: { clasificacion: "enorme" } }, t.ricardo);
  const resp = await api("POST", `/calidad/incidencias/${I}/evaluar`, { decision: "escalar", justificacion: "Amerita una no conformidad", nc: { clasificacion: "menor", responsable_id: id.ricardo } }, t.ricardo);
  const desc = await api("POST", `/calidad/incidencias/${I}/evaluar`, { decision: "escalar", justificacion: "Amerita una no conformidad", nc: { descripcion: "corta" } }, t.ricardo);
  check("[cob:C:V-10] NC nueva al escalar: clasificación inválida → 400, nombrar responsable sin calidad:G → 403, descripción corta → 400 (sin crear NC)", clasif.status === 400 && resp.status === 403 && desc.status === 400 && Number(fila("SELECT COUNT(*) AS n FROM no_conformidades WHERE incidencia_id = ?", I)?.n) === ncsAntes && incRow(I)?.estado === "en_evaluacion", `${det(clasif)} | ${det(resp)} | ${det(desc)}`);

  // V-11: dos personas evalúan a la vez: solo una gana.
  const I2 = (await reportar(t.luis)).data?.id;
  await api("POST", `/calidad/incidencias/${I2}/evaluacion`, {}, t.ricardo);
  const [a, b] = await Promise.all([
    api("POST", `/calidad/incidencias/${I2}/evaluar`, { decision: "cerrar_sin_nc", justificacion: "Hecho aislado ya corregido" }, t.ricardo),
    api("POST", `/calidad/incidencias/${I2}/evaluar`, { decision: "cerrar_sin_nc", justificacion: "Evaluación paralela de Patricia" }, t.patricia),
  ]);
  const evaluaciones = Number(fila("SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'incidencias' AND entidad_id = ? AND accion IN ('cerrar_sin_nc', 'escalar')", String(I2))?.n);
  check("[cob:C:V-11] dos evaluaciones simultáneas: una 200 y la otra 409; queda una sola evaluación", [a.status, b.status].sort().join() === "200,409" && evaluaciones === 1 && incRow(I2)?.estado === "cerrada_sin_nc", `${det(a)} | ${det(b)} evaluaciones=${evaluaciones}`);
}

/* =================== Anular incidencia y reglas de solicitudes (V-13, V-50, V-52…V-54) =================== */
{
  const IA = (await reportar(t.luis)).data?.id;
  const corto = await api("POST", `/calidad/incidencias/${IA}/anular`, { motivo: "no" }, t.patricia);
  check("[cob:C:V-13] anular una incidencia con motivo de menos de 5 caracteres → 400", corto.status === 400 && incRow(IA)?.estado === "reportada", det(corto));
  const pide = await api("POST", `/calidad/incidencias/${IA}/anular`, { motivo: "Incidencia duplicada por error" }, t.patricia, SIN_APROBAR);
  const S1 = pide.data?.solicitud?.id;
  const otra = await api("POST", `/calidad/incidencias/${IA}/anular`, { motivo: "Otra solicitud de anulación" }, t.patricia, SIN_APROBAR);
  check("[cob:C:V-50] una sola solicitud pendiente por registro: la segunda → 409 solicitud_pendiente", pide.status === 202 && otra.status === 409 && otra.data?.codigo === "solicitud_pendiente", `${det(pide)} | ${det(otra)}`);
  check("[cob:C:3.8:anular_calidad] [cob:C:3.8-anular_calidad] anular una incidencia crea anular_calidad que aprueba calidad:AN", solRow(S1)?.tipo === "anular_calidad" && solRow(S1)?.modulo === "calidad", JSON.stringify({ tipo: solRow(S1)?.tipo, modulo: solRow(S1)?.modulo }));
  // Ricardo reportó y quiere evaluar su propia incidencia (regla 7): pide la excepción con un motivo corto.
  const ip = (await reportar(t.ricardo)).data?.id;
  const motivoExc = await api("POST", "/solicitudes", { tipo: "excepcion_segregacion", entidad: "incidencias", entidad_id: ip, accion: "evaluar", motivo: "abc" }, t.ricardo);
  check("[cob:C:V-50] solicitud con motivo de menos de 5 caracteres → 400", !!ip && motivoExc.status === 400 && !fila("SELECT id FROM solicitudes_autorizacion WHERE entidad = 'incidencias' AND entidad_id = ?", String(ip)), det(motivoExc));

  const no = await aprobar(NO_EXISTE, t.ana);
  const luis = await aprobar(S1, t.luis);
  const propia = await aprobar(S1, t.patricia);
  const motivo = await aprobar(S1, t.ana, "ok");
  const sinReauth = await aprobar(S1, t.ana, "Revisado por un segundo usuario", SIN_REAUTH);
  check("[cob:C:V-52] [cob:C:4-POST-solicitudes-id-aprobar] aprobar: inexistente 404; sin el permiso del catálogo (Luis) 403; quien la pidió 409 segregación; motivo corto 400; sin reautenticación 401 solicitudes:aprobar", no.status === 404 && luis.status === 403 && propia.status === 409 && propia.data?.codigo === "segregacion" && motivo.status === 400 && sinReauth.status === 401 && sinReauth.data?.accion === "solicitudes:aprobar" && solRow(S1)?.estado === "pendiente", [no, luis, propia, motivo, sinReauth].map(det).join(" | "));
  const [x, y] = await Promise.all([aprobar(S1, t.ana), aprobar(S1, t.qa)]);
  check("[cob:C:V-52] dos aprobaciones simultáneas: una ejecuta (200) y la otra 409; la incidencia queda anulada una vez", [x.status, y.status].sort().join() === "200,409" && incRow(IA)?.estado === "anulada" && Number(fila("SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'incidencias' AND entidad_id = ? AND accion = 'anular'", String(IA))?.n) === 1, `${det(x)} | ${det(y)}`);
  const yaResuelta = await aprobar(S1, t.ana);
  check("[cob:C:V-52] aprobar una solicitud ya aprobada → 409", yaResuelta.status === 409, det(yaResuelta));
  const yaAnulada = await api("POST", `/calidad/incidencias/${IA}/anular`, { motivo: "Otra vez la anulación" }, t.patricia, SIN_APROBAR);
  check("[cob:C:V-13] anular una incidencia ya anulada → 409", yaAnulada.status === 409, det(yaAnulada));
  const restaurarInc = await api("POST", `/calidad/incidencias/${IA}/restaurar`, { motivo: "Se quiere recuperar" }, t.patricia);
  check("[cob:C:T-07] una incidencia anulada no se restaura (no hay ruta: 404/405) y sigue anulada", [404, 405].includes(restaurarInc.status) && incRow(IA)?.estado === "anulada", `${restaurarInc.status}`);

  // Vencida.
  const IB = (await reportar(t.luis)).data?.id;
  const S2 = (await api("POST", `/calidad/incidencias/${IB}/anular`, { motivo: "Solicitud que se dejará vencer" }, t.patricia, SIN_APROBAR)).data?.solicitud?.id;
  ejecutar("UPDATE solicitudes_autorizacion SET vence_en = ? WHERE id = ?", new Date(Date.now() - 60_000).toISOString(), S2);
  const vencida = await aprobar(S2, t.ana);
  check("[cob:C:V-52] aprobar una solicitud vencida → 409 solicitud_vencida (queda vencida, la incidencia no se anula)", vencida.status === 409 && vencida.data?.codigo === "solicitud_vencida" && solRow(S2)?.estado === "vencida" && incRow(IB)?.estado === "reportada", det(vencida));

  // Tipo retirado del catálogo (solicitud heredada del flujo anterior de documentos).
  const ins = ejecutar("INSERT INTO solicitudes_autorizacion (tipo, modulo, entidad, entidad_id, referencia, accion, datos_json, motivo, solicitado_por, solicitado_rol, solicitado_en, estado, vence_en) VALUES ('obsoletar_documento', 'documentos', 'documentos_sgc', ?, ?, 'obsoletar', '{}', 'Solicitud heredada de la prueba de cobertura', ?, 'Mejora Continua', ?, 'pendiente', ?)", String(NO_EXISTE), `DOC-COB-${s5}`, id.ana, ahoraIso(), enDias(5) + "T23:00:00.000Z");
  const SR = Number(ins.lastInsertRowid);
  const apRet = await aprobar(SR, t.patricia);
  const reRet = await rechazar(SR, t.patricia);
  const caRet = await cancelar(SR, t.ana);
  check("[cob:C:V-52] [cob:C:V-53] [cob:C:3.8:obsoletar_documento] [cob:C:3.8-obsoletar_documento] una solicitud de un tipo retirado no se aprueba ni rechaza (410 retirado); quien la pidió sí la cancela", apRet.status === 410 && apRet.data?.codigo === "retirado" && reRet.status === 410 && caRet.status === 200 && solRow(SR)?.estado === "cancelada", `${det(apRet)} | ${det(reRet)} | ${det(caRet)}`);

  // Propia cuenta.
  const rolVacio = await api("POST", "/admin/roles", { nombre: `Consulta cobertura ${s5}`, descripcion: "Rol sin permisos de la prueba de cobertura", motivo: "Rol de la prueba de cobertura", permisos: [] }, t.jorge);
  const sobrePatricia = await api("POST", `/admin/usuarios/${id.patricia}/roles`, { rol_id: rolVacio.data?.id, motivo: "Rol adicional que no se aprobará" }, t.jorge, SIN_APROBAR);
  const S3 = sobrePatricia.data?.solicitud?.id;
  const suya = await aprobar(S3, t.patricia);
  await cancelar(S3, t.jorge, { motivo: "Prueba de cobertura terminada" });
  check("[cob:C:V-52] nadie aprueba una solicitud sobre su propia cuenta → 409 segregación (regla 6)", sobrePatricia.status === 202 && suya.status === 409 && suya.data?.regla === 6 && solRow(S3)?.estado === "cancelada", `${det(sobrePatricia)} | ${det(suya)}`);

  // Rechazar.
  const IC = (await reportar(t.luis)).data?.id;
  const S4 = (await api("POST", `/calidad/incidencias/${IC}/anular`, { motivo: "Se pedirá y se rechazará" }, t.patricia, SIN_APROBAR)).data?.solicitud?.id;
  const rPropia = await rechazar(S4, t.patricia);
  const rLuis = await rechazar(S4, t.luis);
  const rMotivo = await rechazar(S4, t.ana, "no");
  const rReauth = await rechazar(S4, t.ana, "No procede la anulación", SIN_REAUTH);
  const rOk = await rechazar(S4, t.ana, "No procede la anulación");
  const rOtra = await rechazar(S4, t.ana, "No procede la anulación");
  check("[cob:C:V-53] [cob:C:T-35] [cob:C:4-POST-solicitudes-id-rechazar] rechazar: quien la pidió 409 («cancélala»), sin permiso 403, motivo corto 400, sin reautenticación 401 solicitudes:rechazar; con todo 200 y la incidencia no se anula; otra vez 409", rPropia.status === 409 && /cancél/.test(rPropia.data?.message || "") && rLuis.status === 403 && rMotivo.status === 400 && rReauth.status === 401 && rReauth.data?.accion === "solicitudes:rechazar" && rOk.status === 200 && solRow(S4)?.estado === "rechazada" && incRow(IC)?.estado === "reportada" && rOtra.status === 409, [rPropia, rLuis, rMotivo, rReauth, rOk, rOtra].map(det).join(" | "));

  // Cancelar.
  const ID = (await reportar(t.luis)).data?.id;
  const S5 = (await api("POST", `/calidad/incidencias/${ID}/anular`, { motivo: "Se pedirá y se cancelará" }, t.patricia, SIN_APROBAR)).data?.solicitud?.id;
  const cAjena = await cancelar(S5, t.ana);
  const cPropia = await cancelar(S5, t.patricia, {}, SIN_REAUTH);
  const cOtra = await cancelar(S5, t.patricia);
  check("[cob:C:V-54] [cob:C:T-36] [cob:C:4-POST-solicitudes-id-cancelar] cancelar: otra persona 403; quien la pidió, sin motivo ni reautenticación, 200 con el motivo por omisión; otra vez 409", cAjena.status === 403 && cPropia.status === 200 && solRow(S5)?.motivo_resolucion === "Cancelada por quien la solicitó" && cOtra.status === 409 && incRow(ID)?.estado === "reportada", [cAjena, cPropia, cOtra].map(det).join(" | "));

  // Escalada a una NC vigente.
  const IE = (await reportar(t.luis)).data?.id;
  await api("POST", `/calidad/incidencias/${IE}/evaluacion`, {}, t.ricardo);
  await api("POST", `/calidad/incidencias/${IE}/evaluar`, { decision: "escalar", justificacion: "Amerita una no conformidad", nc: { clasificacion: "menor" } }, t.ricardo);
  const escalada = await api("POST", `/calidad/incidencias/${IE}/anular`, { motivo: "Se quiere anular la escalada" }, t.patricia, SIN_APROBAR);
  check("[cob:C:V-13] anular una incidencia escalada a una NC vigente → 409 nc_vigente", incRow(IE)?.estado === "escalada_a_nc" && escalada.status === 409 && escalada.data?.codigo === "nc_vigente", det(escalada));
}

/* =================== Crear NC (V-14, V-16…V-18) =================== */
{
  const marca = `cobNC-${s5}`;
  const deMarca = () => Number(fila("SELECT COUNT(*) AS n FROM no_conformidades WHERE descripcion LIKE ?", `%${marca}%`)?.n);
  const cuerpo = (extra = {}) => ({ origen: "otro", descripcion: `${marca}: requisito del método sin cumplir`, ...extra });
  const [g, l, h] = await Promise.all([api("POST", "/calidad/nc", cuerpo(), t.gabriela), api("POST", "/calidad/nc", cuerpo(), t.luis), api("POST", "/calidad/nc", cuerpo(), t.hector)]);
  check("[cob:C:V-14] [cob:C:4-POST-calidad-nc] crear una NC sin calidad:R ni G (Coord. Investigación, Técnico Analista, Auditor) → 403", g.status === 403 && l.status === 403 && h.status === 403 && deMarca() === 0, [g, l, h].map(det).join(" | "));
  const corta = await api("POST", "/calidad/nc", cuerpo({ descripcion: `${marca} corta` }), t.ana);
  check("[cob:C:V-16] descripción de la NC de menos de 20 caracteres → 400", corta.status === 400 && deMarca() === 0, det(corta));
  const clasif = await api("POST", "/calidad/nc", cuerpo({ clasificacion: "grave" }), t.ana);
  check("[cob:C:V-17] clasificación fuera de menor/mayor/crítica → 400", clasif.status === 400 && deMarca() === 0, det(clasif));
  const baja = await cuenta("Cobertura Baja NC");
  await api("DELETE", `/admin/usuarios/${baja.id}`, { motivo: "Baja previa a la prueba de cobertura" }, t.jorge);
  const ricardo = await api("POST", "/calidad/nc", cuerpo({ responsable_id: id.ricardo }), t.ricardo);
  const [hector, jorge, nadie, inactiva] = await Promise.all([id.hector, id.jorge, NO_EXISTE, baja.id].map((r) => api("POST", "/calidad/nc", cuerpo({ responsable_id: r }), t.ana)));
  check("[cob:C:V-18] solo calidad:G nombra responsable (Ricardo → 403); responsable que solo consulta (Auditor), sin acceso a NC (Admin técnico, V bitácora), inexistente o dado de baja → 400", ricardo.status === 403 && [hector, jorge, nadie, inactiva].every((r) => r.status === 400) && deMarca() === 0, [ricardo, hector, jorge, nadie, inactiva].map(det).join(" | "));
  const ricardoSin = await api("POST", "/calidad/nc", cuerpo(), t.ricardo);
  check("[cob:C:V-14] con calidad:R (Coord. Área Técnica) sí la crea, sin responsable", ricardoSin.status === 201 && ncRow(ricardoSin.data?.id)?.responsable_id === null, det(ricardoSin));
}

/* =================== Editar NC (V-19…V-27) =================== */
{
  const N = await nuevaNc("NC para editar");
  const gab = await api("PUT", `/calidad/nc/${N}`, { impacto_notas: "Gabriela intenta editar" }, t.gabriela);
  const cerrada = await api("PUT", `/calidad/nc/${NCERR}`, { impacto_notas: "Edición tras el cierre" }, t.ana);
  const sol = await api("POST", `/calidad/nc/${N}/anular`, { motivo: "Anulación que quedará pendiente" }, t.patricia, SIN_APROBAR);
  const pendiente = await api("PUT", `/calidad/nc/${N}`, { impacto_notas: "Edición con anulación pendiente" }, t.ana);
  await cancelar(sol.data?.solicitud?.id, t.patricia, { motivo: "Prueba de cobertura" });
  check("[cob:C:V-19] editar: ni G ni responsable → 403; NC cerrada → 409 nc_cerrada; con anulación pendiente → 409 solicitud_pendiente", gab.status === 403 && cerrada.status === 409 && cerrada.data?.codigo === "nc_cerrada" && sol.status === 202 && pendiente.status === 409 && pendiente.data?.codigo === "solicitud_pendiente" && ncRow(N)?.impacto_notas === null, [gab, cerrada, sol, pendiente].map(det).join(" | "));
  const desc = await api("PUT", `/calidad/nc/${N}`, { descripcion: "Descripción corta" }, t.ana);
  check("[cob:C:V-20] descripción de menos de 20 caracteres al editar → 400", desc.status === 400 && /cobertura/.test(ncRow(N)?.descripcion || ""), det(desc));
  const malos = { clasificacion: "grave", afecta_resultados_emitidos: "quizas", trabajo_detenido: "tal_vez", notificar_cliente: "luego", metodo_causa: "adivinar", requiere_accion_correctiva: "depende" };
  const res = {};
  for (const [campo, valor] of Object.entries(malos)) res[campo] = (await api("PUT", `/calidad/nc/${N}`, { [campo]: valor }, t.ana)).status;
  const fn = ncRow(N);
  check("[cob:C:V-21] opciones fuera de catálogo (clasificación, sí/no del impacto, método de causa, ¿requiere acción?) → 400 cada una y no se guardan", Object.values(res).every((s) => s === 400) && Object.keys(malos).every((c) => fn?.[c] === null), JSON.stringify(res));

  const { N: NE3 } = await ncConAcciones("NC con acciones en curso para editar");
  const enCurso = await api("PUT", `/calidad/nc/${NE3}`, { requiere_accion_correctiva: "no", justificacion_sin_accion: "Ya no hace falta la acción" }, t.ana);
  const NE2 = await ncEnAnalisis("NC en análisis con acción para editar");
  await api("PUT", `/calidad/nc/${NE2}`, CAUSA, t.ana);
  await accion(NE2);
  const conAccion = await api("PUT", `/calidad/nc/${NE2}`, { requiere_accion_correctiva: "no", justificacion_sin_accion: "Ya no hace falta la acción" }, t.ana);
  check("[cob:C:V-23] «no requiere acción» con acciones en curso o con acciones definidas → 409 decision_con_acciones", enCurso.status === 409 && enCurso.data?.codigo === "decision_con_acciones" && conAccion.status === 409 && conAccion.data?.codigo === "decision_con_acciones" && ncRow(NE2)?.requiere_accion_correctiva === "si", `${det(enCurso)} | ${det(conAccion)}`);
  const vaciarImpacto = await api("PUT", `/calidad/nc/${NE2}`, { afecta_resultados_emitidos: null }, t.ana);
  const vaciarCausa = await api("PUT", `/calidad/nc/${NE3}`, { causa_raiz: "" }, t.ana);
  check("[cob:C:V-27] vaciar el impacto en análisis o la causa con acciones en curso → 409 dato_de_etapa", vaciarImpacto.status === 409 && vaciarImpacto.data?.codigo === "dato_de_etapa" && vaciarCausa.status === 409 && vaciarCausa.data?.codigo === "dato_de_etapa" && ncRow(NE2)?.afecta_resultados_emitidos === "no" && !!ncRow(NE3)?.causa_raiz, `${det(vaciarImpacto)} | ${det(vaciarCausa)}`);
}

/* =================== Comunicaciones (V-41) =================== */
{
  const N = await nuevaNc("NC para comunicaciones");
  const base = { fecha: hoy(), medio: "correo", contacto: "Cliente Uno", resumen: "Se informó al cliente del hallazgo" };
  const r = {};
  for (const [k, cambio] of Object.entries({ fecha_imposible: { fecha: "2026-13-45" }, fecha_texto: { fecha: "hoy" }, medio: { medio: "paloma" }, contacto: { contacto: "ab" }, resumen: { resumen: "corto" } })) r[k] = (await api("POST", `/calidad/nc/${N}/comunicaciones`, { ...base, ...cambio }, t.ana)).status;
  check("[cob:C:V-41] comunicación: fecha no AAAA-MM-DD o imposible, medio fuera de catálogo, contacto < 3 y resumen < 10 → 400 y no se registra", Object.values(r).every((s) => s === 400) && Number(fila("SELECT COUNT(*) AS n FROM nc_comunicaciones WHERE nc_id = ?", N)?.n) === 0, JSON.stringify(r));
}

/* =================== Avanzar NC (V-28…V-31) y cierre sin verificación =================== */
{
  const N = (await api("POST", "/calidad/nc", { origen: "otro", descripcion: `NC sin responsable para avanzar · cobertura ${s5}` }, t.ana)).data?.id;
  const saltar = await api("POST", `/calidad/nc/${N}/avanzar`, { a: "en_verificacion" }, t.ana);
  const inventado = await api("POST", `/calidad/nc/${N}/avanzar`, { a: "cerrada" }, t.ana);
  check("[cob:C:V-28] avanzar a una etapa que no es la siguiente (abierta → en_verificacion o cerrada) → 409", saltar.status === 409 && inventado.status === 409 && ncRow(N)?.estado === "abierta", `${det(saltar)} | ${det(inventado)}`);
  const sinResp = await api("POST", `/calidad/nc/${N}/avanzar`, { a: "en_analisis" }, t.ana);
  await api("PUT", `/calidad/nc/${N}`, { responsable_id: id.ricardo }, t.ana);
  const sinImpacto = await api("POST", `/calidad/nc/${N}/avanzar`, { a: "en_analisis" }, t.ana);
  await api("PUT", `/calidad/nc/${N}`, IMPACTO, t.ana);
  const okAnalisis = await api("POST", `/calidad/nc/${N}/avanzar`, { a: "en_analisis" }, t.ana);
  check("[cob:C:V-29] a en_analisis: sin responsable → 409, sin evaluación de impacto → 409, con ambos 200", sinResp.status === 409 && /responsable/.test(sinResp.data?.message || "") && sinImpacto.status === 409 && /impacto/.test(sinImpacto.data?.message || "") && okAnalisis.status === 200, [sinResp, sinImpacto, okAnalisis].map(det).join(" | "));
  const sinMetodo = await api("POST", `/calidad/nc/${N}/avanzar`, { a: "acciones_en_curso" }, t.ana);
  await api("PUT", `/calidad/nc/${N}`, { metodo_causa: "cinco_porques", causa_raiz: "Falta de verificación intermedia del equipo" }, t.ana);
  const sinDecision = await api("POST", `/calidad/nc/${N}/avanzar`, { a: "acciones_en_curso" }, t.ana);
  await api("PUT", `/calidad/nc/${N}`, { requiere_accion_correctiva: "si" }, t.ana);
  const sinAcciones = await api("POST", `/calidad/nc/${N}/avanzar`, { a: "acciones_en_curso" }, t.ana);
  const A1 = await accion(N);
  const okAcciones = await api("POST", `/calidad/nc/${N}/avanzar`, { a: "acciones_en_curso" }, t.ana);
  check("[cob:C:V-30] a acciones_en_curso: sin método ni causa → 409, sin decidir si requiere acción → 409, sin acciones → 409; con todo 200", sinMetodo.status === 409 && sinDecision.status === 409 && sinAcciones.status === 409 && okAcciones.status === 200, [sinMetodo, sinDecision, sinAcciones, okAcciones].map(det).join(" | "));
  const pendientes = await api("POST", `/calidad/nc/${N}/avanzar`, { a: "en_verificacion" }, t.ana);
  await api("POST", `/calidad/acciones/${A1}/cancelar`, { motivo: "Se replantea la acción" }, t.ana);
  const soloCanceladas = await api("POST", `/calidad/nc/${N}/avanzar`, { a: "en_verificacion" }, t.ana);
  const cerrarAntes = await api("POST", `/calidad/nc/${N}/cerrar`, { conclusion: "Intento de cierre sin verificar" }, t.patricia);
  check("[cob:C:V-31] a en_verificacion: con acciones pendientes → 409; solo canceladas (ninguna implementada) → 409", pendientes.status === 409 && soloCanceladas.status === 409 && /implementadas/.test(soloCanceladas.data?.message || ""), `${det(pendientes)} | ${det(soloCanceladas)}`);
  check("[cob:C:V-46] cerrar con «sí requiere acción» sin estar en verificación → 409 sin_verificacion", cerrarAntes.status === 409 && cerrarAntes.data?.codigo === "sin_verificacion", det(cerrarAntes));
  const A2 = await accion(N, id.luis, "Segunda acción de la prueba de cobertura");
  await api("POST", `/calidad/acciones/${A2}/implementar`, { descripcion_implementacion: "Implementada en la prueba de cobertura" }, t.luis);
  const okVerif = await api("POST", `/calidad/nc/${N}/avanzar`, { a: "en_verificacion" }, t.ana);
  const noEficaz = await api("POST", `/calidad/nc/${N}/verificar`, { resultado: "no_eficaz", comentarios: "La falla volvió a presentarse en la semana" }, t.ana);
  const reabierta = ncRow(N);
  const sinNueva = await api("POST", `/calidad/nc/${N}/avanzar`, { a: "acciones_en_curso" }, t.ana);
  check("[cob:C:V-30] tras una verificación no eficaz (reapertura) no se pasa a acciones sin una acción nueva → 409 reapertura_sin_accion", okVerif.status === 200 && noEficaz.status === 200 && reabierta?.estado === "en_analisis" && Number(reabierta?.reaperturas) === 1 && sinNueva.status === 409 && sinNueva.data?.codigo === "reapertura_sin_accion", [okVerif, noEficaz, sinNueva].map(det).join(" | "));
  await accion(N, id.luis, "Acción nueva tras la reapertura");
  const conNueva = await api("POST", `/calidad/nc/${N}/avanzar`, { a: "acciones_en_curso" }, t.ana);
  check("[cob:C:V-30] …con una acción nueva sí avanza", conNueva.status === 200, det(conNueva));
}

/* =================== Acciones correctivas (V-32…V-38) =================== */
let ACC_CANCELADA = null;
let ACC_LUIS = null;
let NG = null;
{
  const abierta = await nuevaNc("NC abierta para acciones");
  const enAbierta = await api("POST", `/calidad/nc/${abierta}/acciones`, { descripcion: "Acción en una NC abierta", responsable_id: id.luis, fecha_compromiso: enDias(5) }, t.ana);
  const enCerrada = await api("POST", `/calidad/nc/${NCERR}/acciones`, { descripcion: "Acción en una NC cerrada", responsable_id: id.luis, fecha_compromiso: enDias(5) }, t.ana);
  check("[cob:C:V-32] agregar una acción en una NC abierta → 409; en una cerrada → 409 nc_cerrada", enAbierta.status === 409 && enCerrada.status === 409 && enCerrada.data?.codigo === "nc_cerrada", `${det(enAbierta)} | ${det(enCerrada)}`);

  const r = await ncConAcciones("NC para las acciones correctivas");
  NG = r.N;
  ACC_LUIS = r.A;
  const A = r.A;
  const mariana = await api("PUT", `/calidad/acciones/${A}`, { descripcion: "Mariana intenta editar la acción" }, t.mariana);
  const inexistente = await api("PUT", `/calidad/acciones/${NO_EXISTE}`, { descripcion: "Acción que no existe en la base" }, t.ana);
  check("[cob:C:V-34] editar una acción que no se ve (Mariana) o inexistente → 404", mariana.status === 404 && inexistente.status === 404, `${det(mariana)} | ${det(inexistente)}`);
  const desc = await api("PUT", `/calidad/acciones/${A}`, { descripcion: "corta" }, t.ana);
  const fecha = await api("PUT", `/calidad/acciones/${A}`, { fecha_compromiso: "31/12/2026" }, t.ana);
  const sinMotivo = await api("PUT", `/calidad/acciones/${A}`, { responsable_id: id.gabriela }, t.ana);
  const fa = fila("SELECT * FROM acciones_correctivas WHERE id = ?", A);
  check("[cob:C:V-35] editar la acción: descripción < 10 → 400, fecha no AAAA-MM-DD → 400, reasignar sin motivo → 400 (nada cambia)", desc.status === 400 && fecha.status === 400 && sinMotivo.status === 400 && Number(fa?.responsable_id) === id.luis && fa?.descripcion === "Acción de la prueba de cobertura", [desc, fecha, sinMotivo].map(det).join(" | "));
  const ajeno = await api("POST", `/calidad/acciones/${A}/iniciar`, {}, t.ricardo);
  const inicia = await api("POST", `/calidad/acciones/${A}/iniciar`, {}, t.luis);
  const otraVez = await api("POST", `/calidad/acciones/${A}/iniciar`, {}, t.luis);
  check("[cob:C:V-36] iniciar: el responsable de la NC que no lo es de la acción (sin G) → 403; su responsable 200; iniciarla otra vez → 409", ajeno.status === 403 && inicia.status === 200 && otraVez.status === 409 && fila("SELECT estado FROM acciones_correctivas WHERE id = ?", A)?.estado === "en_proceso", [ajeno, inicia, otraVez].map(det).join(" | "));

  const B = await accion(NG, id.luis, "Acción que se cancelará en la prueba");
  const motivoCorto = await api("POST", `/calidad/acciones/${B}/cancelar`, { motivo: "no" }, t.ana);
  const cancela = await api("POST", `/calidad/acciones/${B}/cancelar`, { motivo: "Se replantea con otra acción" }, t.ana);
  ACC_CANCELADA = B;
  const editarCancelada = await api("PUT", `/calidad/acciones/${B}`, { descripcion: "Editar una acción cancelada" }, t.ana);
  const C = await accion(NG, id.luis, "Acción que se implementará en la prueba");
  await api("POST", `/calidad/acciones/${C}/implementar`, { descripcion_implementacion: "Implementada en la prueba de cobertura" }, t.luis);
  const cancelarImpl = await api("POST", `/calidad/acciones/${C}/cancelar`, { motivo: "Cancelar una implementada" }, t.ana);
  const editarImpl = await api("PUT", `/calidad/acciones/${C}`, { descripcion: "Editar una acción implementada" }, t.ana);
  check("[cob:C:V-38] cancelar con motivo < 5 → 400; con motivo 200; una implementada no se cancela → 409", motivoCorto.status === 400 && cancela.status === 200 && cancelarImpl.status === 409 && fila("SELECT estado FROM acciones_correctivas WHERE id = ?", C)?.estado === "implementada", [motivoCorto, cancela, cancelarImpl].map(det).join(" | "));
  check("[cob:C:V-34] una acción implementada o cancelada ya no se edita → 409", editarImpl.status === 409 && editarCancelada.status === 409, `${det(editarImpl)} | ${det(editarCancelada)}`);
  const sol = await api("POST", `/calidad/nc/${NG}/anular`, { motivo: "Anulación que quedará pendiente" }, t.patricia, SIN_APROBAR);
  const conSolicitud = await api("PUT", `/calidad/acciones/${A}`, { descripcion: "Edición con anulación pendiente" }, t.ana);
  await cancelar(sol.data?.solicitud?.id, t.patricia, { motivo: "Prueba de cobertura" });
  check("[cob:C:V-34] con una anulación pendiente de la NC la acción no se edita → 409 solicitud_pendiente", sol.status === 202 && conSolicitud.status === 409 && conSolicitud.data?.codigo === "solicitud_pendiente", `${det(sol)} | ${det(conSolicitud)}`);
}

/* =================== Verificar y cerrar (V-39, V-46) =================== */
let NV = null;
let ACC_NV = null;
{
  // NC de Gabriela con una acción de Ricardo (calidad:R): Ricardo no la verifica (regla 8).
  NV = await nuevaNc("NC para verificar y cerrar", { responsable_id: id.gabriela });
  await api("PUT", `/calidad/nc/${NV}`, { ...IMPACTO, ...CAUSA }, t.ana);
  await api("POST", `/calidad/nc/${NV}/avanzar`, { a: "en_analisis" }, t.ana);
  ACC_NV = await accion(NV, id.ricardo, "Acción de Ricardo para la verificación");
  await api("POST", `/calidad/nc/${NV}/avanzar`, { a: "acciones_en_curso" }, t.ana);
  const sinVerif = await api("POST", `/calidad/nc/${NG}/verificar`, { resultado: "eficaz", comentarios: "Verificación antes de tiempo" }, t.ana);
  await api("POST", `/calidad/acciones/${ACC_NV}/implementar`, { descripcion_implementacion: "Ricardo implementó la acción" }, t.ricardo);
  await api("POST", `/calidad/nc/${NV}/avanzar`, { a: "en_verificacion" }, t.ana);
  const luis = await api("POST", `/calidad/nc/${NV}/verificar`, { resultado: "eficaz", comentarios: "Luis intenta verificar la eficacia" }, t.luis);
  const ricardo = await api("POST", `/calidad/nc/${NV}/verificar`, { resultado: "eficaz", comentarios: "Ricardo verifica su propia acción" }, t.ricardo);
  const resultado = await api("POST", `/calidad/nc/${NV}/verificar`, { resultado: "tal_vez", comentarios: "Resultado fuera de catálogo" }, t.ana);
  const comentarios = await api("POST", `/calidad/nc/${NV}/verificar`, { resultado: "eficaz", comentarios: "corto" }, t.ana);
  check("[cob:C:V-39] verificar: sin calidad:R → 403; NC fuera de verificación → 409; responsable de la acción → 409 segregación (regla 8); resultado inválido → 400; comentarios < 10 → 400", luis.status === 403 && sinVerif.status === 409 && ricardo.status === 409 && ricardo.data?.codigo === "segregacion" && resultado.status === 400 && comentarios.status === 400 && Number(fila("SELECT COUNT(*) AS n FROM nc_verificaciones WHERE nc_id = ?", NV)?.n) === 0, [luis, sinVerif, ricardo, resultado, comentarios].map(det).join(" | "));
  const eficaz = await api("POST", `/calidad/nc/${NV}/verificar`, { resultado: "eficaz", comentarios: "Registros revisados: la causa se eliminó" }, t.ana);
  const sinA = await api("POST", `/calidad/nc/${NV}/cerrar`, { conclusion: "Ricardo intenta cerrar la NC" }, t.ricardo);
  const conclusion = await api("POST", `/calidad/nc/${NV}/cerrar`, { conclusion: "corta" }, t.ana);
  const sinReauth = await api("POST", `/calidad/nc/${NV}/cerrar`, { conclusion: "Acciones eficaces y verificadas" }, t.ana, SIN_REAUTH);
  check("[cob:C:V-46] cerrar: sin calidad:A → 403; conclusión < 10 → 400; sin reautenticación → 401 calidad:A", eficaz.status === 200 && sinA.status === 403 && conclusion.status === 400 && sinReauth.status === 401 && sinReauth.data?.accion === "calidad:A" && ncRow(NV)?.estado === "en_verificacion", [eficaz, sinA, conclusion, sinReauth].map(det).join(" | "));
  const sol = await api("POST", `/calidad/nc/${NV}/anular`, { motivo: "Anulación que quedará pendiente" }, t.patricia, SIN_APROBAR);
  const conSolicitud = await api("POST", `/calidad/nc/${NV}/cerrar`, { conclusion: "Acciones eficaces y verificadas" }, t.ana);
  await cancelar(sol.data?.solicitud?.id, t.patricia, { motivo: "Prueba de cobertura" });
  check("[cob:C:V-46] cerrar con una anulación pendiente → 409 solicitud_pendiente", conSolicitud.status === 409 && conSolicitud.data?.codigo === "solicitud_pendiente", det(conSolicitud));
  const cierra = await api("POST", `/calidad/nc/${NV}/cerrar`, { conclusion: "Acciones eficaces y verificadas" }, t.ana);
  check("[cob:C:V-46] …sin pendientes, quien no es responsable cierra (200)", cierra.status === 200 && ncRow(NV)?.estado === "cerrada", det(cierra));
  const editarCerrada = await api("PUT", `/calidad/acciones/${ACC_NV}`, { descripcion: "Editar una acción de una NC cerrada" }, t.ana);
  check("[cob:C:V-34] la acción de una NC cerrada no se edita → 409 nc_cerrada", editarCerrada.status === 409 && editarCerrada.data?.codigo === "nc_cerrada", det(editarCerrada));

  // Condiciones de exigirCerrable, cada una con su código.
  const sinImpacto = await nuevaNc("NC sin impacto para cerrar");
  const r1 = await api("POST", `/calidad/nc/${sinImpacto}/cerrar`, { conclusion: "Cierre sin impacto evaluado" }, t.patricia);
  const sinDecidir = await nuevaNc("NC sin decisión para cerrar");
  await api("PUT", `/calidad/nc/${sinDecidir}`, IMPACTO, t.ana);
  const r2 = await api("POST", `/calidad/nc/${sinDecidir}/cerrar`, { conclusion: "Cierre sin decidir la acción" }, t.patricia);
  const sinJust = await nuevaNc("NC sin justificación para cerrar");
  await api("PUT", `/calidad/nc/${sinJust}`, { ...IMPACTO, requiere_accion_correctiva: "no" }, t.ana);
  const r3 = await api("POST", `/calidad/nc/${sinJust}/cerrar`, { conclusion: "Cierre sin justificación" }, t.patricia);
  const r4 = await api("POST", `/calidad/nc/${NG}/cerrar`, { conclusion: "Cierre con acciones abiertas" }, t.patricia);
  const notificar = await nuevaNc("NC que se notifica al cliente");
  await api("PUT", `/calidad/nc/${notificar}`, { ...SIN_ACCION, notificar_cliente: "si" }, t.ana);
  const r5 = await api("POST", `/calidad/nc/${notificar}/cerrar`, { conclusion: "Cierre sin comunicar al cliente" }, t.patricia);
  check("[cob:C:V-46] cerrar: sin impacto → 409; sin decidir la acción → 409; «no» sin justificación → 409; con acciones abiertas → 409 acciones_pendientes; notificar sin comunicación → 409 falta_comunicacion", [r1, r2, r3].every((r) => r.status === 409) && /impacto/.test(r1.data?.message || "") && /Decide/.test(r2.data?.message || "") && /Justifica/.test(r3.data?.message || "") && r4.status === 409 && r4.data?.codigo === "acciones_pendientes" && r5.status === 409 && r5.data?.codigo === "falta_comunicacion", [r1, r2, r3, r4, r5].map(det).join(" | "));
  await api("POST", `/calidad/nc/${notificar}/comunicaciones`, { fecha: hoy(), medio: "telefono", contacto: "Cliente Dos", resumen: "Se informó por teléfono del hallazgo" }, t.ana);
  const r5b = await api("POST", `/calidad/nc/${notificar}/cerrar`, { conclusion: "Cierre ya comunicado al cliente" }, t.patricia);
  check("[cob:C:V-46] …con la comunicación registrada sí cierra", r5b.status === 200, det(r5b));
  // Regla 9: Patricia es la responsable; no la cierra.
  const propia = await nuevaNc("NC de Patricia para cerrar", { responsable_id: id.patricia });
  await api("PUT", `/calidad/nc/${propia}`, SIN_ACCION, t.ana);
  const r6 = await api("POST", `/calidad/nc/${propia}/cerrar`, { conclusion: "La responsable intenta cerrar" }, t.patricia);
  check("[cob:C:V-46] la responsable de la NC no la cierra → 409 segregación (regla 9)", r6.status === 409 && r6.data?.codigo === "segregacion" && ncRow(propia)?.estado === "abierta", det(r6));
}

/* =================== Adjuntos (V-48, V-49) =================== */
{
  const png = (txt) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${txt} ${Date.now()} ${Math.random()}`)]);
  const form = (bytes, nombre = "foto.png") => {
    const f = new FormData();
    f.append("archivo", new Blob([bytes]), nombre);
    f.append("tipo_evidencia", "foto");
    f.append("descripcion", "Foto de la prueba de cobertura");
    return f;
  };
  const IX = (await reportar(t.luis)).data?.id;
  await api("POST", `/calidad/incidencias/${IX}/evaluacion`, {}, t.ricardo);
  await api("POST", `/calidad/incidencias/${IX}/evaluar`, { decision: "cerrar_sin_nc", justificacion: "Hecho aislado ya corregido" }, t.ricardo);
  const cerrada = await api("POST", `/calidad/incidencias/${IX}/adjuntos`, form(png("cerrada")), t.luis);
  const IY = (await reportar(t.luis)).data?.id;
  const hector = await api("POST", `/calidad/incidencias/${IY}/adjuntos`, form(png("hector")), t.hector);
  const grande = await api("POST", `/calidad/incidencias/${IY}/adjuntos`, form(Buffer.concat([png("grande"), Buffer.alloc((Number(process.env.EVIDENCIA_MAX_MB || 25) + 1) * 1024 * 1024)])), t.luis);
  const ok = await api("POST", `/calidad/incidencias/${IY}/adjuntos`, form(png("ok")), t.luis);
  const adj = (e, i) => Number(fila("SELECT COUNT(*) AS n FROM adjuntos WHERE entidad = ? AND entidad_id = ?", e, i)?.n);
  check("[cob:C:V-48] adjuntos de incidencia: cerrada → 409; quien no la reportó sin G (Auditor) → 403; más de EVIDENCIA_MAX_MB → 413; quien la reportó 201", cerrada.status === 409 && hector.status === 403 && grande.status === 413 && ok.status === 201 && adj("incidencia", IX) === 0 && adj("incidencia", IY) === 1, [cerrada, hector, grande, ok].map(det).join(" | "));
  const cancelada = await api("POST", `/calidad/acciones/${ACC_CANCELADA}/adjuntos`, form(png("cancelada")), t.luis);
  const deNcCerrada = await api("POST", `/calidad/acciones/${ACC_NV}/adjuntos`, form(png("nc-cerrada")), t.ricardo);
  const noResp = await api("POST", `/calidad/acciones/${ACC_LUIS}/adjuntos`, form(png("ricardo")), t.ricardo);
  const resp = await api("POST", `/calidad/acciones/${ACC_LUIS}/adjuntos`, form(png("luis")), t.luis);
  check("[cob:C:V-49] adjuntos de acción: cancelada o de NC cerrada → 409; quien no es su responsable (sin G) → 403; su responsable 201", cancelada.status === 409 && deNcCerrada.status === 409 && noResp.status === 403 && resp.status === 201, [cancelada, deNcCerrada, noResp, resp].map(det).join(" | "));
}

/* =================== Suspensiones, retenciones y anular NC (V-43…V-47, 3.5) =================== */
{
  // Lo da de alta Ricardo (equipos:G, ensayos:A) autorizando a QA a usarlo (FX-THF-AP): así el único bloqueo es la suspensión.
  const EQ = (await api("POST", "/inventory/equipos", { nombre: `Equipo de cobertura ${s5}`, estado: "operativo", autorizar_a: [id.qa] }, t.ricardo)).data?.id;
  const NS = await nuevaNc("NC con suspensión");
  await api("PUT", `/calidad/nc/${NS}`, SIN_ACCION, t.ana);
  // Extracción que ya usaba el equipo antes de suspenderlo (3.5: editarla después también se bloquea).
  const previa = await cadena(t, "COBSUSP", { equipos: [{ equipo_id: EQ, uso: "Centrifugación", folio_bitacora: `SUSP-${s5}` }] });
  const suspensionesDe = () => Number(fila("SELECT COUNT(*) AS n FROM suspensiones WHERE clave = ? AND tipo = 'equipo'", String(EQ))?.n);
  const [sGab, sHec, sNo, sCerrada] = await Promise.all([
    api("POST", `/calidad/nc/${NS}/suspensiones`, { tipo: "equipo", clave: String(EQ), motivo: "Gabriela intenta suspender" }, t.gabriela),
    api("POST", `/calidad/nc/${NS}/suspensiones`, { tipo: "equipo", clave: String(EQ), motivo: "El auditor intenta suspender" }, t.hector),
    api("POST", `/calidad/nc/${NO_EXISTE}/suspensiones`, { tipo: "equipo", clave: String(EQ), motivo: "NC que no existe" }, t.patricia),
    api("POST", `/calidad/nc/${NCERR}/suspensiones`, { tipo: "equipo", clave: String(EQ), motivo: "Suspender desde una NC cerrada" }, t.patricia),
  ]);
  check("[cob:C:4-POST-calidad-nc-id-suspensiones] [cob:C:T-25] suspender: sin calidad:R (Coord. Investigación, Auditor) → 403; NC inexistente → 404; NC cerrada → 409; nada se suspende y el equipo sigue operativo", sGab.status === 403 && sHec.status === 403 && sNo.status === 404 && sCerrada.status === 409 && suspensionesDe() === 0 && fila("SELECT estado FROM equipos WHERE id = ?", EQ)?.estado === "operativo" && previa.extraccion.status === 201, [sGab, sHec, sNo, sCerrada, previa.extraccion].map(det).join(" | "));
  const luis = await api("POST", `/calidad/nc/${NS}/suspensiones`, { tipo: "equipo", clave: String(EQ), motivo: "Luis intenta suspender" }, t.luis);
  const metodo = await api("POST", `/calidad/nc/${NS}/suspensiones`, { tipo: "metodo", clave: "XYZ", motivo: "Método fuera del catálogo" }, t.patricia);
  const tipo = await api("POST", `/calidad/nc/${NS}/suspensiones`, { tipo: "reactivo", clave: "1", motivo: "Tipo fuera del catálogo" }, t.patricia);
  const equipoNo = await api("POST", `/calidad/nc/${NS}/suspensiones`, { tipo: "equipo", clave: String(NO_EXISTE), motivo: "Equipo que no existe" }, t.patricia);
  const motivo = await api("POST", `/calidad/nc/${NS}/suspensiones`, { tipo: "equipo", clave: String(EQ), motivo: "no" }, t.patricia);
  const suspende = await api("POST", `/calidad/nc/${NS}/suspensiones`, { tipo: "equipo", clave: String(EQ), motivo: "Equipo en duda por la prueba de cobertura" }, t.patricia);
  const dos = await api("POST", `/calidad/nc/${NS}/suspensiones`, { tipo: "equipo", clave: String(EQ), motivo: "Otra vez el mismo equipo" }, t.patricia);
  const SU = fila("SELECT id FROM suspensiones WHERE nc_id = ? AND reanudada_en IS NULL", NS)?.id;
  check("[cob:C:V-44] [cob:C:T-25] [cob:C:4-POST-calidad-nc-id-suspensiones] suspender: sin calidad:R → 403; método fuera de catálogo o tipo inválido → 400; equipo inexistente → 404; motivo < 5 → 400; ya suspendido por la NC → 409 ya_suspendido", luis.status === 403 && metodo.status === 400 && tipo.status === 400 && equipoNo.status === 404 && motivo.status === 400 && suspende.status === 201 && dos.status === 409 && dos.data?.codigo === "ya_suspendido" && !!SU && fila("SELECT estado FROM equipos WHERE id = ?", EQ)?.estado === "fuera_servicio", [luis, metodo, tipo, equipoNo, motivo, suspende, dos].map(det).join(" | "));
  const efecto = await cadena(t, "COBSUS", { equipos: [{ equipo_id: EQ, uso: "Centrifugación", folio_bitacora: `SUS-${s5}` }] });
  const fichaPrevia = (await api("GET", `/samples/extraction/${previa.E}`, undefined, t.qa)).data?.item;
  const editarPrevia = await api("PUT", `/samples/extraction/${previa.E}`, { ...fichaPrevia, equipos: [{ equipo_id: EQ, uso: "Centrifugación", folio_bitacora: `SUSP-${s5}` }], observaciones_generales: "Edición con el equipo suspendido" }, t.qa);
  check("[cob:C:3.5:efecto] [cob:C:3.5-efecto] usar el equipo suspendido en una extracción nueva → 409 suspendido (no se crea); editar una extracción que ya lo usaba → 409 suspendido (no cambia)", efecto.extraccion.status === 409 && efecto.extraccion.data?.codigo === "suspendido" && !efecto.E && editarPrevia.status === 409 && editarPrevia.data?.codigo === "suspendido" && fila("SELECT observaciones_generales AS o FROM muestras_extraccion WHERE id = ?", previa.E)?.o !== "Edición con el equipo suspendido", `${det(efecto.extraccion)} | ${det(editarPrevia)}`);
  const cerrarS = await api("POST", `/calidad/nc/${NS}/cerrar`, { conclusion: "Cierre con suspensión activa" }, t.ana);
  const anularS = await api("POST", `/calidad/nc/${NS}/anular`, { motivo: "Anular con suspensión activa" }, t.ana, SIN_APROBAR);
  check("[cob:C:V-46] [cob:C:V-47] con una suspensión activa no se cierra (409 suspensiones_activas) ni se anula (409 bloqueos_activos)", cerrarS.status === 409 && cerrarS.data?.codigo === "suspensiones_activas" && anularS.status === 409 && anularS.data?.codigo === "bloqueos_activos", `${det(cerrarS)} | ${det(anularS)}`);
  const ricardo = await api("POST", `/calidad/suspensiones/${SU}/reanudar`, { motivo: "Ricardo intenta reanudar" }, t.ricardo);
  const rHector = await api("POST", `/calidad/suspensiones/${SU}/reanudar`, { motivo: "El auditor intenta reanudar" }, t.hector);
  const rNo = await api("POST", `/calidad/suspensiones/${NO_EXISTE}/reanudar`, { motivo: "Suspensión que no existe" }, t.ana);
  check("[cob:C:4-POST-calidad-suspensiones-id-reanudar] reanudar: sin calidad:A (Auditor) → 403; inexistente → 404; la suspensión sigue activa", rHector.status === 403 && rNo.status === 404 && !fila("SELECT reanudada_en FROM suspensiones WHERE id = ?", SU)?.reanudada_en, `${det(rHector)} | ${det(rNo)}`);
  const quien = await api("POST", `/calidad/suspensiones/${SU}/reanudar`, { motivo: "Patricia reanuda lo que suspendió" }, t.patricia);
  const corto = await api("POST", `/calidad/suspensiones/${SU}/reanudar`, { motivo: "no" }, t.ana);
  const sinReauth = await api("POST", `/calidad/suspensiones/${SU}/reanudar`, { motivo: "Equipo verificado de nuevo" }, t.ana, SIN_REAUTH);
  const reanuda = await api("POST", `/calidad/suspensiones/${SU}/reanudar`, { motivo: "Equipo verificado de nuevo" }, t.ana);
  const otraVez = await api("POST", `/calidad/suspensiones/${SU}/reanudar`, { motivo: "Equipo verificado de nuevo" }, t.ana);
  check("[cob:C:V-45] [cob:C:T-26] [cob:C:4-POST-calidad-suspensiones-id-reanudar] reanudar: sin calidad:A → 403; quien suspendió → 409 segregación (regla 10); motivo < 5 → 400; sin reautenticación → 401 calidad:A; con todo 200 y el equipo vuelve a operativo; otra vez → 409", ricardo.status === 403 && quien.status === 409 && quien.data?.codigo === "segregacion" && corto.status === 400 && sinReauth.status === 401 && sinReauth.data?.accion === "calidad:A" && reanuda.status === 200 && otraVez.status === 409 && fila("SELECT estado FROM equipos WHERE id = ?", EQ)?.estado === "operativo", [ricardo, quien, corto, sinReauth, reanuda, otraVez].map(det).join(" | "));
  const cerrarYa = await api("POST", `/calidad/nc/${NS}/cerrar`, { conclusion: "Equipo reanudado y verificado" }, t.ana);
  check("[cob:C:V-46] …ya reanudada, la NC se cierra", cerrarYa.status === 200, det(cerrarYa));
  // T-26: con dos NC que suspenden el mismo equipo, sigue fuera de servicio hasta reanudar la última.
  const EQ2 = (await api("POST", "/inventory/equipos", { nombre: `Equipo doble suspensión ${s5}`, estado: "operativo" }, t.ricardo)).data?.id;
  const ND1 = await nuevaNc("NC 1 de la doble suspensión");
  const ND2 = await nuevaNc("NC 2 de la doble suspensión");
  await api("POST", `/calidad/nc/${ND1}/suspensiones`, { tipo: "equipo", clave: String(EQ2), motivo: "Primera suspensión del equipo" }, t.patricia);
  await api("POST", `/calidad/nc/${ND2}/suspensiones`, { tipo: "equipo", clave: String(EQ2), motivo: "Segunda suspensión del equipo" }, t.patricia);
  const sd = (N) => fila("SELECT id FROM suspensiones WHERE nc_id = ? AND reanudada_en IS NULL", N)?.id;
  const [SD1, SD2] = [sd(ND1), sd(ND2)];
  const eqEstado = () => fila("SELECT estado FROM equipos WHERE id = ?", EQ2)?.estado;
  const r1 = await api("POST", `/calidad/suspensiones/${SD1}/reanudar`, { motivo: "Se resolvió la primera NC" }, t.ana);
  const tras1 = eqEstado();
  const r2 = await api("POST", `/calidad/suspensiones/${SD2}/reanudar`, { motivo: "Se resolvió la segunda NC" }, t.ana);
  check("[cob:C:T-26] dos NC suspenden el mismo equipo: al reanudar la primera sigue fuera de servicio («sigue suspendido por …»); al reanudar la última vuelve a operativo", !!SD1 && !!SD2 && r1.status === 200 && /sigue suspendido/.test(r1.data?.message || "") && tras1 === "fuera_servicio" && r2.status === 200 && eqEstado() === "operativo", `${det(r1)} ${tras1} | ${det(r2)} ${eqEstado()}`);

  // Retención de un informe propio.
  const inf = await informeLiberado(t, "COBRET");
  const NR = await nuevaNc("NC con retención");
  await api("PUT", `/calidad/nc/${NR}`, SIN_ACCION, t.ana);
  const retenciones = () => Number(fila("SELECT COUNT(*) AS n FROM retenciones_informe WHERE nc_id IN (?, ?)", NR, NCERR)?.n);
  const rt = (N, cuerpo, token) => api("POST", `/calidad/nc/${N}/retenciones`, cuerpo, token);
  const motivoRet = "Resultados en duda en la prueba de cobertura";
  const v42 = {
    luis: await rt(NR, { informe_id: inf.informe, motivo: motivoRet }, t.luis),
    gabriela: await rt(NR, { informe_id: inf.informe, motivo: motivoRet }, t.gabriela),
    hector: await rt(NR, { informe_id: inf.informe, motivo: motivoRet }, t.hector),
    ncNo: await rt(NO_EXISTE, { informe_id: inf.informe, motivo: motivoRet }, t.ana),
    cerrada: await rt(NCERR, { informe_id: inf.informe, motivo: motivoRet }, t.ana),
    sinInforme: await rt(NR, { motivo: motivoRet }, t.ana),
    informeNo: await rt(NR, { informe_id: NO_EXISTE, motivo: motivoRet }, t.ana),
    motivo: await rt(NR, { informe_id: inf.informe, motivo: "no" }, t.ana),
  };
  check("[cob:C:V-42] [cob:C:4-POST-calidad-nc-id-retenciones] retener: sin calidad:R (Técnico Analista, Coord. Investigación, Auditor) → 403; NC inexistente → 404; NC cerrada → 409; sin informe → 400; informe inexistente → 404; motivo < 5 → 400; nada se retiene", v42.luis.status === 403 && v42.gabriela.status === 403 && v42.hector.status === 403 && v42.ncNo.status === 404 && v42.cerrada.status === 409 && v42.sinInforme.status === 400 && v42.informeNo.status === 404 && v42.motivo.status === 400 && retenciones() === 0, Object.entries(v42).map(([k, r]) => `${k}=${r.status}`).join(" "));
  const ret = await api("POST", `/calidad/nc/${NR}/retenciones`, { informe_id: inf.informe, motivo: motivoRet }, t.ana);
  const RET = fila("SELECT id FROM retenciones_informe WHERE nc_id = ? AND liberada_en IS NULL", NR)?.id;
  check("[cob:C:T-27] [cob:C:4-POST-calidad-nc-id-retenciones] informe propio liberado y retenido por la NC (calidad:R): retención activa, informe marcado como afectado y en la bitácora del informe", inf.liberado && ret.status === 201 && !!RET && Number(fila("SELECT retenido_por FROM retenciones_informe WHERE id = ?", RET)?.retenido_por) === id.ana && !!fila("SELECT id FROM nc_registros_afectados WHERE nc_id = ? AND entidad = 'informes' AND entidad_id = ?", NR, inf.informe) && !!fila("SELECT id FROM auditoria WHERE accion = 'retener' AND entidad = 'informes' AND entidad_id = ?", String(inf.informe)), `${inf.liberado} ${det(ret)}`);
  const dupRet = await rt(NR, { informe_id: inf.informe, motivo: "Otra retención del mismo informe" }, t.ana);
  check("[cob:C:V-42] retener otra vez el mismo informe por la misma NC → 409 (una sola retención activa)", dupRet.status === 409 && retenciones() === 1, det(dupRet));
  // 3.6: un informe retenido no se libera ni se envía.
  const infA = await informeAutorizado("COBRETA");
  const retA = await rt(NR, { informe_id: infA, motivo: "Informe autorizado en duda" }, t.ana);
  const RET_A = fila("SELECT id FROM retenciones_informe WHERE nc_id = ? AND informe_id = ? AND liberada_en IS NULL", NR, infA)?.id;
  const liberarA = await api("POST", `/informes/${infA}/liberar`, {}, t.patricia);
  const enviosAntes = Number(fila("SELECT COUNT(*) AS n FROM envios_informe WHERE informe_id = ?", inf.informe)?.n);
  const envio = await registrarEnvio(BASE, t.patricia, inf.informe);
  check("[cob:C:3.6-efecto] informe retenido: liberarlo → 409 informe_retenido (sigue autorizado); registrar su envío → 409 informe_retenido (no se registra)", retA.status === 201 && liberarA.status === 409 && liberarA.data?.codigo === "informe_retenido" && fila("SELECT estado FROM informes WHERE id = ?", infA)?.estado === "autorizado" && envio.status === 409 && envio.data?.codigo === "informe_retenido" && Number(fila("SELECT COUNT(*) AS n FROM envios_informe WHERE informe_id = ?", inf.informe)?.n) === enviosAntes, `${det(retA)} | ${det(liberarA)} | ${envio.status} ${envio.data?.codigo}`);
  const cerrarR = await api("POST", `/calidad/nc/${NR}/cerrar`, { conclusion: "Cierre con retención activa" }, t.patricia);
  const anularR = await api("POST", `/calidad/nc/${NR}/anular`, { motivo: "Anular con retención activa" }, t.patricia, SIN_APROBAR);
  check("[cob:C:V-46] [cob:C:V-47] con una retención activa no se cierra (409 retenciones_activas) ni se anula (409 bloqueos_activos)", cerrarR.status === 409 && cerrarR.data?.codigo === "retenciones_activas" && anularR.status === 409 && anularR.data?.codigo === "bloqueos_activos", `${det(cerrarR)} | ${det(anularR)}`);
  const lRicardo = await api("POST", `/calidad/retenciones/${RET}/liberar`, { motivo: "Ricardo intenta liberar" }, t.ricardo);
  const lHector = await api("POST", `/calidad/retenciones/${RET}/liberar`, { motivo: "El auditor intenta liberar" }, t.hector);
  const lNo = await api("POST", `/calidad/retenciones/${NO_EXISTE}/liberar`, { motivo: "Retención que no existe" }, t.ana);
  const lCorto = await api("POST", `/calidad/retenciones/${RET}/liberar`, { motivo: "no" }, t.ana);
  const lReauth = await api("POST", `/calidad/retenciones/${RET}/liberar`, { motivo: "Resultados confirmados" }, t.ana, SIN_REAUTH);
  const libera = await api("POST", `/calidad/retenciones/${RET}/liberar`, { motivo: "Resultados confirmados" }, t.ana);
  const lOtra = await api("POST", `/calidad/retenciones/${RET}/liberar`, { motivo: "Resultados confirmados" }, t.ana);
  check("[cob:C:V-43] [cob:C:T-28] [cob:C:4-POST-calidad-retenciones-id-liberar] liberar retención: sin calidad:A (Coord. Área Técnica, Auditor) → 403; inexistente → 404; motivo < 5 → 400; sin reautenticación → 401 calidad:A; con todo 200; ya liberada → 409", lRicardo.status === 403 && lHector.status === 403 && lNo.status === 404 && lCorto.status === 400 && lReauth.status === 401 && lReauth.data?.accion === "calidad:A" && libera.status === 200 && lOtra.status === 409 && !!fila("SELECT liberada_en FROM retenciones_informe WHERE id = ?", RET)?.liberada_en, [lRicardo, lNo, lCorto, lReauth, libera, lOtra].map(det).join(" | "));
  await api("POST", `/calidad/retenciones/${RET_A}/liberar`, { motivo: "Resultados confirmados del informe autorizado" }, t.ana);
  const liberarYa = await api("POST", `/informes/${infA}/liberar`, {}, t.patricia);
  check("[cob:C:3.6-efecto] [cob:C:T-28] liberada la retención, el informe autorizado ya se libera", liberarYa.status === 200 && fila("SELECT estado FROM informes WHERE id = ?", infA)?.estado === "liberado", det(liberarYa));
  await api("POST", `/calidad/nc/${NR}/cerrar`, { conclusion: "Retención liberada y resultados confirmados" }, t.patricia);

  // Anular NC.
  const NAN = await nuevaNc("NC que se anulará");
  const aRicardo = await api("POST", `/calidad/nc/${NAN}/anular`, { motivo: "Ricardo intenta anular" }, t.ricardo);
  const aCorto = await api("POST", `/calidad/nc/${NAN}/anular`, { motivo: "no" }, t.patricia);
  const aReauth = await api("POST", `/calidad/nc/${NAN}/anular`, { motivo: "Registro duplicado" }, t.patricia, SIN_REAUTH);
  const anula = await api("POST", `/calidad/nc/${NAN}/anular`, { motivo: "Registro duplicado" }, t.patricia);
  const aOtra = await api("POST", `/calidad/nc/${NAN}/anular`, { motivo: "Registro duplicado" }, t.patricia, SIN_APROBAR);
  check("[cob:C:V-47] anular NC: sin calidad:AN → 403; motivo < 5 → 400; sin reautenticación → 401 calidad:AN; con segundo usuario queda anulada; otra vez → 409", aRicardo.status === 403 && aCorto.status === 400 && aReauth.status === 401 && aReauth.data?.accion === "calidad:AN" && anula.status === 200 && ncRow(NAN)?.estado === "anulada" && aOtra.status === 409, [aRicardo, aCorto, aReauth, anula, aOtra].map(det).join(" | "));
  const restaurarNc = await api("POST", `/calidad/nc/${NAN}/restaurar`, { motivo: "Se quiere recuperar" }, t.patricia);
  check("[cob:C:T-17] una NC anulada no se restaura (no hay ruta: 404/405) y sigue anulada", [404, 405].includes(restaurarNc.status) && ncRow(NAN)?.estado === "anulada", `${restaurarNc.status}`);

  // anular_informe (3.8) sobre el informe propio, ya sin retención.
  const pideInf = await api("POST", `/informes/${inf.informe}/anular`, { motivo: "Informe de la prueba de cobertura" }, t.ricardo, SIN_APROBAR);
  const SI = pideInf.data?.solicitud?.id;
  const gab = await aprobar(SI, t.gabriela);
  const pat = await aprobar(SI, t.patricia);
  check("[cob:C:3.8:anular_informe] [cob:C:3.8-anular_informe] anular un informe liberado: solicitud que aprueba informes:AN (sin él → 403; la Responsable General 200)", pideInf.status === 202 && solRow(SI)?.tipo === "anular_informe" && solRow(SI)?.modulo === "informes" && gab.status === 403 && pat.status === 200 && fila("SELECT estado FROM informes WHERE id = ?", inf.informe)?.estado === "anulado", [pideInf, gab, pat].map(det).join(" | "));
}

/* =================== Autorizaciones FX-THF-AP (V-55, V-56, GET /autorizaciones/personas) =================== */
{
  const CU = await cuenta("Cobertura Autorizada");
  ejecutar("UPDATE usuarios SET debe_cambiar_password = 0 WHERE id = ?", CU.id);
  const tCU = await login(CU.email, `Temporal-${s5}-2026`);
  const recepcionDeCU = (sufijo) => api("POST", "/samples/reception", recepcion(`COB-AUT-${sufijo}-${s5}`, { recibido_por: CU.nombre }), tCU);
  const recepcionesDeCU = (sufijo) => Number(fila("SELECT COUNT(*) AS n FROM muestras_recepcion WHERE id_interno = ?", `COB-AUT-${sufijo}-${s5}`)?.n);
  const sinAut = await recepcionDeCU("sin");
  const pLuis = await api("GET", "/autorizaciones/personas", undefined, t.luis);
  const pRicardo = await api("GET", "/autorizaciones/personas", undefined, t.ricardo);
  const pAna = await api("GET", "/autorizaciones/personas", undefined, t.ana);
  const items = pRicardo.data?.items || [];
  check("[cob:C:P-autorizaciones-personas] [cob:C:4-GET-autorizaciones-personas] GET /autorizaciones/personas: sin ensayos:A ni calidad:A → 403; con ensayos:A (Ricardo) o calidad:A (Ana) 200, solo cuentas activas y sin uno mismo", pLuis.status === 403 && pRicardo.status === 200 && pAna.status === 200 && items.some((p) => p.id === CU.id) && !items.some((p) => p.id === id.ricardo) && items.every((p) => Number(fila("SELECT activo FROM usuarios WHERE id = ?", p.id)?.activo) === 1), `${pLuis.status} ${pRicardo.status} ${pAna.status} ${items.length}`);
  const ruta = `/admin/usuarios/${CU.id}/autorizaciones`;
  const base = { tipo: "actividad", clave: "recepcion", vigente_desde: hoy(), motivo: "Capacitación FX-THF-AP de la prueba de cobertura" };
  const otorgadas = () => Number(fila("SELECT COUNT(*) AS n FROM autorizaciones_personal WHERE usuario_id = ?", CU.id)?.n);
  const r = {
    luis: await api("POST", ruta, base, t.luis),
    propia: await api("POST", `/admin/usuarios/${id.patricia}/autorizaciones`, base, t.patricia),
    tipo: await api("POST", ruta, { ...base, tipo: "curso" }, t.patricia),
    actividad: await api("POST", ruta, { ...base, clave: "volar" }, t.patricia),
    metodo: await api("POST", ruta, { ...base, tipo: "metodo", clave: "XYZ" }, t.patricia),
    equipo: await api("POST", ruta, { ...base, tipo: "equipo", clave: String(NO_EXISTE) }, t.patricia),
    fecha: await api("POST", ruta, { ...base, vigente_desde: "01/01/2026" }, t.patricia),
    rango: await api("POST", ruta, { ...base, vigente_hasta: enDias(-30) }, t.patricia),
    motivo: await api("POST", ruta, { ...base, motivo: "no" }, t.patricia),
    reauth: await api("POST", ruta, base, t.patricia, SIN_REAUTH),
  };
  check("[cob:C:V-55] otorgar: sin ensayos:A ni calidad:A → 403; a uno mismo → 409 autorizacion_propia; tipo, clave de actividad, método o equipo fuera de catálogo → 400; fecha no AAAA-MM-DD o fin antes del inicio → 400; motivo < 5 → 400; sin reautenticación → 401 autorizaciones:otorgar; nada se registra", r.luis.status === 403 && r.propia.status === 409 && r.propia.data?.clave === "autorizacion_propia" && ["tipo", "actividad", "metodo", "equipo", "fecha", "rango", "motivo"].every((k) => r[k].status === 400) && r.reauth.status === 401 && r.reauth.data?.accion === "autorizaciones:otorgar" && otorgadas() === 0, Object.entries(r).map(([k, v]) => `${k}=${v.status}`).join(" "));
  const ok = await api("POST", ruta, base, t.patricia);
  const dup = await api("POST", ruta, base, t.patricia);
  const futura = await api("POST", ruta, { ...base, clave: "procesamiento", vigente_desde: enDias(10) }, t.patricia);
  const dupFutura = await api("POST", ruta, { ...base, clave: "procesamiento", vigente_desde: enDias(20) }, t.patricia);
  const conAut = await recepcionDeCU("con");
  check("[cob:C:3.7-efecto] con AUTORIZACIONES_OBLIGATORIAS (activo en el servidor de prueba), sin la autorización FX-THF-AP de recepción la Técnico Auxiliar no registra la recepción (403 no_autorizado, no se crea); con ella vigente sí", !!tCU && sinAut.status === 403 && sinAut.data?.codigo === "no_autorizado" && recepcionesDeCU("sin") === 0 && [200, 201, 202].includes(conAut.status) && recepcionesDeCU("con") === 1, `${det(sinAut)} | ${det(conAut)}`);
  const ric = await api("POST", ruta, { ...base, clave: "extraccion" }, t.ricardo);
  const vencida = await api("POST", ruta, { ...base, clave: "analisis", vigente_desde: enDias(-20), vigente_hasta: enDias(-1) }, t.patricia);
  AUT_VENCIDA = vencida.data?.item?.id;
  check("[cob:C:T-29] otorgar: nace «vigente» (desde hoy) o «por iniciar» (desde una fecha futura); también la otorga quien tiene ensayos:A (Coord. Área Técnica) y queda en la bitácora con quién la otorgó", ok.data?.item?.estado === "vigente" && futura.data?.item?.estado === "por_iniciar" && ric.status === 201 && ric.data?.item?.estado === "vigente" && Number(fila("SELECT otorgada_por FROM autorizaciones_personal WHERE id = ?", ric.data?.item?.id)?.otorgada_por) === id.ricardo && !!fila("SELECT id FROM auditoria WHERE accion = 'otorgar_autorizacion' AND entidad = 'usuarios' AND entidad_id = ? AND usuario_id = ?", String(CU.id), id.ricardo), `${ok.data?.item?.estado} ${futura.data?.item?.estado} ${det(ric)}`);
  check("[cob:C:V-55] [cob:C:T-29] [cob:C:4-GET-POST-admin-usuarios-id-autorizaciones] con todo 201; la misma ya vigente o por iniciar → 409 (solo se registran las 4 válidas)", ok.status === 201 && dup.status === 409 && futura.status === 201 && dupFutura.status === 409 && vencida.status === 201 && otorgadas() === 4, [ok, dup, futura, dupFutura].map(det).join(" | "));
  const AU = ok.data?.item?.id || fila("SELECT id FROM autorizaciones_personal WHERE usuario_id = ? AND clave = 'recepcion'", CU.id)?.id;
  const rv = (aid, motivo, token = t.patricia, headers = {}) => api("POST", `/admin/usuarios/${CU.id}/autorizaciones/${aid}/revocar`, { motivo }, token, headers);
  const vNo = await rv(NO_EXISTE, "Autorización que no existe");
  const vLuis = await rv(AU, "Luis intenta revocar", t.luis);
  const vCorto = await rv(AU, "no");
  const vReauth = await rv(AU, "Ya no realiza recepciones", t.patricia, SIN_REAUTH);
  const vOk = await rv(AU, "Ya no realiza recepciones");
  const vOtra = await rv(AU, "Ya no realiza recepciones");
  const gPat = await api("GET", ruta, undefined, t.patricia);
  const gPropia = await api("GET", ruta, undefined, tCU);
  const gNo = await api("GET", `/admin/usuarios/${NO_EXISTE}/autorizaciones`, undefined, t.patricia);
  const pNo = await api("POST", `/admin/usuarios/${NO_EXISTE}/autorizaciones`, base, t.patricia);
  const gVacio = await api("GET", ruta, undefined, t.luis);
  const estados = Object.fromEntries((gPat.data?.items || []).map((a) => [a.clave, a.estado]));
  check("[cob:C:4-GET-POST-admin-usuarios-id-autorizaciones] GET: quien las administra (200, puede_administrar) ve las de la cuenta con su estado (revocada, vigente, por iniciar, vencida) y la persona las suyas; cuenta inexistente → 404 (GET y POST)", gPat.status === 200 && gPat.data?.puede_administrar === true && estados.recepcion === "revocada" && estados.extraccion === "vigente" && estados.procesamiento === "por_iniciar" && estados.analisis === "vencida" && gPropia.status === 200 && gPropia.data?.puede_administrar === false && gNo.status === 404 && pNo.status === 404, `${gPat.status} ${JSON.stringify(estados)} ${gPropia.status} ${gNo.status} ${pNo.status}`);
  check("[cob:C:4-GET-POST-admin-usuarios-id-autorizaciones] GET de otra cuenta por la Técnico Analista (usuarios:V solo «propio», sin ensayos:A ni calidad:A) → 403/404, sin ver sus autorizaciones", [403, 404].includes(gVacio.status) && !gVacio.data?.items, `${gVacio.status} ${(gVacio.data?.items || []).length} autorizaciones visibles`);
  check("[cob:C:V-56] [cob:C:T-30] [cob:C:4-POST-admin-usuarios-id-autorizaciones-autorizacion-revocar] revocar: sin ensayos:A ni calidad:A (Técnico Analista) → 403; inexistente → 404; motivo < 5 → 400; sin reautenticación → 401 autorizaciones:revocar; con todo 200; ya revocada → 409", vLuis.status === 403 && vNo.status === 404 && vCorto.status === 400 && vReauth.status === 401 && vReauth.data?.accion === "autorizaciones:revocar" && vOk.status === 200 && vOtra.status === 409 && !!fila("SELECT revocada_en FROM autorizaciones_personal WHERE id = ?", AU)?.revocada_en && vOk.data?.item?.estado === "revocada", [vLuis, vNo, vCorto, vReauth, vOk, vOtra].map(det).join(" | "));
}

/* =================== Quién aprueba cada tipo de solicitud (3.8) =================== */
{
  const catalogo = (tipo, r, modulo) => {
    const sol = solRow(r.data?.solicitud?.id);
    return { S: sol?.id, ok: sol?.tipo === tipo && sol?.modulo === modulo && sol?.estado === "pendiente", txt: `${det(r)} ${sol?.tipo}/${sol?.modulo}/${sol?.estado}` };
  };
  // anular_registro y restaurar_registro: recepción aceptada de QA (no borrador).
  const idInt = `COB-AR-${s5}`;
  const R = (await api("POST", "/samples/reception", recepcion(idInt), t.qa)).data?.id;
  const an = catalogo("anular_registro", await api("POST", `/samples/reception/${R}/anular`, { motivo: "Recepción duplicada en la prueba" }, t.qa, SIN_APROBAR), "muestras");
  const anLuis = await aprobar(an.S, t.luis);
  const anPat = await aprobar(an.S, t.patricia);
  const estadoR = () => fila("SELECT * FROM muestras_recepcion WHERE id = ?", R);
  check("[cob:C:3.8:anular_registro] [cob:C:3.8-anular_registro] anular una recepción aceptada: solicitud que aprueba muestras:AN (Luis → 403; la Responsable General 200)", an.ok && anLuis.status === 403 && anPat.status === 200 && !!estadoR()?.anulado_en, `${an.txt} | ${det(anLuis)} | ${det(anPat)}`);
  const re = catalogo("restaurar_registro", await api("POST", `/samples/reception/${R}/restaurar`, { motivo: "Se anuló por error" }, t.qa, SIN_APROBAR), "muestras");
  const reLuis = await aprobar(re.S, t.luis);
  const rePat = await aprobar(re.S, t.patricia);
  check("[cob:C:3.8:restaurar_registro] [cob:C:3.8-restaurar_registro] restaurarla: solicitud que aprueba muestras:AN (Luis → 403; la Responsable General 200)", re.ok && reLuis.status === 403 && rePat.status === 200 && !estadoR()?.anulado_en, `${re.txt} | ${det(reLuis)} | ${det(rePat)}`);

  // decision_recepcion, reabrir_recepcion y cambiar_folio: los pide la Técnico Auxiliar (sin muestras:A).
  const idM = `COB-DR-${s5}`;
  const dr = await api("POST", "/samples/reception", recepcion(idM, { recibido_por: "Mariana", decision_aceptacion: "rechazada", aceptacion: { fecha: "2026-09-20", responsable: "Mariana", comunicacion_cliente: { fecha: "2026-09-20", medio: "correo" } } }), t.mariana, SIN_APROBAR);
  const RM = dr.data?.id;
  const d = catalogo("decision_recepcion", dr, "muestras");
  const dLuis = await aprobar(d.S, t.luis);
  const dRic = await aprobar(d.S, t.ricardo);
  check("[cob:C:3.8:decision_recepcion] [cob:C:3.8-decision_recepcion] rechazo de una recepción sin muestras:A: solicitud que aprueba muestras:A (Luis → 403; la Coord. Área Técnica 200)", d.ok && dLuis.status === 403 && dRic.status === 200 && fila("SELECT estado FROM muestras_recepcion WHERE id = ?", RM)?.estado === "rechazada", `${d.txt} | ${det(dLuis)} | ${det(dRic)}`);
  const rb = catalogo("reabrir_recepcion", await api("POST", `/samples/reception/${RM}/reabrir`, { motivo: "El cliente envió la documentación" }, t.mariana, SIN_APROBAR), "muestras");
  const rbLuis = await aprobar(rb.S, t.luis);
  const rbRic = await aprobar(rb.S, t.ricardo);
  check("[cob:C:3.8:reabrir_recepcion] [cob:C:3.8-reabrir_recepcion] reabrirla: solicitud que aprueba muestras:A (Luis → 403; Ricardo 200)", rb.ok && rbLuis.status === 403 && rbRic.status === 200 && fila("SELECT estado FROM muestras_recepcion WHERE id = ?", RM)?.estado !== "rechazada", `${rb.txt} | ${det(rbLuis)} | ${det(rbRic)}`);
  const folio = Number(fila("SELECT folio_num FROM muestras_recepcion WHERE id = ?", RM)?.folio_num);
  const cf = catalogo("cambiar_folio", await api("POST", `/samples/reception/${RM}/folio`, { folio_num: folio + 700000, motivo: "Folio duplicado en papel" }, t.mariana, SIN_APROBAR), "muestras");
  const cfLuis = await aprobar(cf.S, t.luis);
  const cfRic = await rechazar(cf.S, t.ricardo, "El folio actual es correcto");
  check("[cob:C:3.8:cambiar_folio] [cob:C:3.8-cambiar_folio] cambiar el folio: solicitud que resuelve muestras:A (Luis → 403; Ricardo la rechaza y el folio no cambia)", cf.ok && cfLuis.status === 403 && cfRic.status === 200 && Number(fila("SELECT folio_num FROM muestras_recepcion WHERE id = ?", RM)?.folio_num) === folio, `${cf.txt} | ${det(cfLuis)} | ${det(cfRic)}`);

  // Administración: asignar_rol, ampliar_permisos_rol, reactivar_cuenta y ampliar_vigencia sobre cuentas y roles propios.
  const C1 = await cuenta("Cobertura Roles");
  const rolVacio = (await api("POST", "/admin/roles", { nombre: `Consulta cobertura 2 ${s5}`, motivo: "Rol de la prueba de cobertura", permisos: [] }, t.jorge)).data?.id;
  const ar = catalogo("asignar_rol", await api("POST", `/admin/usuarios/${C1.id}/roles`, { rol_id: rolVacio, motivo: "Rol adicional de la prueba" }, t.jorge, SIN_APROBAR), "usuarios");
  const arLuis = await aprobar(ar.S, t.luis);
  const arPat = await aprobar(ar.S, t.patricia);
  check("[cob:C:3.8:asignar_rol] [cob:C:3.8-asignar_rol] asignar un rol: solicitud que aprueba usuarios:A (Luis → 403; la Responsable General 200)", ar.ok && arLuis.status === 403 && arPat.status === 200 && !!fila("SELECT id FROM usuario_roles WHERE usuario_id = ? AND rol_id = ? AND revocado_en IS NULL", C1.id, rolVacio), `${ar.txt} | ${det(arLuis)} | ${det(arPat)}`);
  const rolNuevo = await api("POST", "/admin/roles", { nombre: `Rol con permiso cobertura ${s5}`, motivo: "Rol con un permiso de la prueba de cobertura", permisos: [{ modulo: "calidad", accion: "C" }] }, t.jorge, SIN_APROBAR);
  const ap = catalogo("ampliar_permisos_rol", rolNuevo, "usuarios");
  const apLuis = await aprobar(ap.S, t.luis);
  const apPat = await aprobar(ap.S, t.patricia);
  check("[cob:C:3.8:ampliar_permisos_rol] [cob:C:3.8-ampliar_permisos_rol] ampliar permisos de un rol: solicitud que aprueba usuarios:A (Luis → 403; la Responsable General 200)", ap.ok && apLuis.status === 403 && apPat.status === 200 && Number(fila("SELECT COUNT(*) AS n FROM rol_acciones WHERE id_rol = ?", rolNuevo.data?.id)?.n) >= 1, `${ap.txt} | ${det(apLuis)} | ${det(apPat)}`);
  const C2 = await cuenta("Cobertura Reactivar");
  await api("DELETE", `/admin/usuarios/${C2.id}`, { motivo: "Baja previa a la reactivación" }, t.jorge);
  const rc = catalogo("reactivar_cuenta", await api("PUT", `/admin/usuarios/${C2.id}`, datosCuenta(C2, { activo: true, motivo_estado: "Regresa al laboratorio" }), t.jorge, SIN_APROBAR), "usuarios");
  const rcLuis = await aprobar(rc.S, t.luis);
  const rcPat = await aprobar(rc.S, t.patricia);
  check("[cob:C:3.8:reactivar_cuenta] [cob:C:3.8-reactivar_cuenta] reactivar una cuenta: solicitud que aprueba usuarios:A (Luis → 403; la Responsable General 200)", rc.ok && rcLuis.status === 403 && rcPat.status === 200 && Number(fila("SELECT activo FROM usuarios WHERE id = ?", C2.id)?.activo) === 1, `${rc.txt} | ${det(rcLuis)} | ${det(rcPat)}`);
  const C3 = await cuenta("Cobertura Vigencia");
  ejecutar("UPDATE usuarios SET vigente_hasta = ? WHERE id = ?", enDias(10), C3.id);
  const av = catalogo("ampliar_vigencia", await api("PUT", `/admin/usuarios/${C3.id}`, datosCuenta(C3, { vigente_hasta: enDias(60), motivo_cuenta: "Se renueva su contrato" }), t.jorge, SIN_APROBAR), "usuarios");
  const avLuis = await aprobar(av.S, t.luis);
  const avPat = await aprobar(av.S, t.patricia);
  check("[cob:C:3.8:ampliar_vigencia] [cob:C:3.8-ampliar_vigencia] ampliar la vigencia: solicitud que aprueba usuarios:A (Luis → 403; la Responsable General 200)", av.ok && avLuis.status === 403 && avPat.status === 200 && fila("SELECT vigente_hasta AS h FROM usuarios WHERE id = ?", C3.id)?.h === enDias(60), `${av.txt} | ${det(avLuis)} | ${det(avPat)}`);
}

/* =================== Incidencias automáticas (T-02) =================== */
{
  const porClave = (clave) => filas("SELECT * FROM incidencias WHERE clave_automatica = ?", clave);
  const desv = await cadena(t, "COBDESV", { decision: "aceptada_con_desviacion" });
  const rech = (await api("POST", "/samples/reception", recepcion(`COB-RECH-${s5}`, { decision_aceptacion: "rechazada" }), t.qa)).data?.id;
  const iDesv = porClave(`desviacion_recepcion:${desv.R}`);
  const iRech = porClave(`rechazo_recepcion:${rech}`);
  check("[cob:C:T-02] recepción con desviación o rechazada → incidencia automática reportada (origen, a nombre de quien decidió, ligada a la recepción)", iDesv.length === 1 && iDesv[0].estado === "reportada" && iDesv[0].origen_automatico === "desviacion_recepcion" && Number(iDesv[0].reportada_por) === id.qa && iRech.length === 1 && iRech[0].origen_automatico === "rechazo_recepcion" && !!fila("SELECT id FROM incidencia_registros WHERE incidencia_id = ? AND entidad = 'muestras_recepcion' AND entidad_id = ?", iDesv[0]?.id, desv.R), `${iDesv.length} ${iRech.length}`);
  const EQ = (await api("POST", "/inventory/equipos", { nombre: `Equipo vencido cobertura ${s5}`, estado: "operativo", fecha_prox_calibracion: "2026-01-15", autorizar_a: [id.qa] }, t.ricardo)).data?.id;
  const eq = [{ equipo_id: EQ, uso: "Centrifugación", folio_bitacora: `VEN-${s5}` }];
  const noApto = await cadena(t, "COBEQ", { equipos: eq });
  const clave = `equipo_no_apto:muestras_extraccion:${noApto.E}:${EQ}`;
  const ficha = (await api("GET", `/samples/extraction/${noApto.E}`, undefined, t.qa)).data?.item;
  const reGuarda = await api("PUT", `/samples/extraction/${noApto.E}`, { ...ficha, equipos: eq, observaciones_generales: "Se volvió a guardar en la prueba de cobertura" }, t.qa);
  check("[cob:C:T-02] usar un equipo con calibración vencida → incidencia automática equipo_no_apto; volver a guardar no la duplica (clave)", noApto.extraccion.status === 201 && reGuarda.status === 200 && porClave(clave).length === 1 && porClave(clave)[0].origen_automatico === "equipo_no_apto", `${det(noApto.extraccion)} | ${det(reGuarda)} ${porClave(clave).length}`);
  // Alerta de integridad del PDF final de una NC (se devuelve el archivo original al terminar).
  const nc = ncRow(NCERR);
  const ruta = path.join(path.dirname(process.env.TEST_DB_PATH), "calidad", "nc", String(nc?.archivo_pdf || ""));
  const original = fs.existsSync(ruta) ? fs.readFileSync(ruta) : null;
  let alertas = [];
  let integridades = [];
  if (original) {
    try {
      fs.writeFileSync(ruta, Buffer.concat([original, Buffer.from("\n% alterado en la prueba de cobertura\n")]));
      for (let i = 0; i < 2; i += 1) integridades.push((await api("GET", `/calidad/nc/${NCERR}/pdf`, undefined, t.ana)).headers.get("x-integridad-pdf"));
    } finally {
      fs.writeFileSync(ruta, original);
    }
    alertas = porClave(`alerta_integridad:nc:${NCERR}:${nc.pdf_sha256}`);
    integridades.push((await api("GET", `/calidad/nc/${NCERR}/pdf`, undefined, t.ana)).headers.get("x-integridad-pdf"));
  }
  check("[cob:C:T-02] PDF final de NC alterado → alerta_integridad reportada por el sistema, una sola aunque se descargue dos veces (y el original vuelve a verificar)", !!original && integridades.join() === "alterado,alterado,ok" && alertas.length === 1 && alertas[0].reportada_por === null && alertas[0].reportada_nombre === "Sistema" && alertas[0].origen_automatico === "alerta_integridad", `${!!original} ${integridades.join()} ${alertas.length}`);
  // La alerta era un falso positivo provocado por la prueba: se anula (con segundo usuario) para no dejarla abierta.
  if (alertas[0]) await api("POST", `/calidad/incidencias/${alertas[0].id}/anular`, { motivo: "Falso positivo provocado por la prueba de cobertura" }, t.patricia);
}

/* =================== Validaciones de NC y acciones que faltaban (V-15…V-40) =================== */
{
  const marca = `cobV2-${s5}`;
  const deMarca = () => Number(fila("SELECT COUNT(*) AS n FROM no_conformidades WHERE descripcion LIKE ?", `%${marca}%`)?.n);
  const crear = (origen) => api("POST", "/calidad/nc", { origen, descripcion: `${marca}: NC con origen ${origen} en la prueba` }, t.ana);
  const [inventado, incidencia, vacio] = [await crear("capricho"), await crear("incidencia"), await crear("")];
  check("[cob:C:V-15] crear NC: origen fuera de catálogo → 400; origen «incidencia» (solo nace al escalar) → 400; sin origen → 400; no se crea", inventado.status === 400 && incidencia.status === 400 && vacio.status === 400 && deMarca() === 0, [inventado, incidencia, vacio].map(det).join(" | "));

  const N = await ncEnAnalisis("NC para validar la edición");
  const causa = await api("PUT", `/calidad/nc/${N}`, { causa_raiz: "corta" }, t.ana);
  check("[cob:C:V-22] causa raíz de menos de 10 caracteres → 400 y no se guarda", causa.status === 400 && ncRow(N)?.causa_raiz === null, det(causa));
  const just = await api("PUT", `/calidad/nc/${N}`, { requiere_accion_correctiva: "no", justificacion_sin_accion: "breve" }, t.ana);
  check("[cob:C:V-24] justificación sin acción de menos de 10 caracteres → 400 y no se guarda", just.status === 400 && ncRow(N)?.justificacion_sin_accion === null && ncRow(N)?.requiere_accion_correctiva === null, det(just));
  const vTexto = await api("PUT", `/calidad/nc/${N}`, { verificacion_programada: "15/11/2026" }, t.ana);
  const vImposible = await api("PUT", `/calidad/nc/${N}`, { verificacion_programada: "2026-02-30" }, t.ana);
  const vPasada = await api("PUT", `/calidad/nc/${N}`, { verificacion_programada: enDias(-1) }, t.ana);
  const vFutura = await api("PUT", `/calidad/nc/${N}`, { verificacion_programada: enDias(30) }, t.ana);
  // Renglón desactualizado: la matriz dice que no se exige fecha futura; el servidor rechaza las pasadas (nc.ts:355).
  check("[cob:C:V-25] verificación programada: no AAAA-MM-DD o imposible → 400; una fecha pasada (distinta de la guardada) → 400 campo verificacion_programada; de hoy en adelante 200", vTexto.status === 400 && vImposible.status === 400 && vPasada.status === 400 && vPasada.data?.campo === "verificacion_programada" && vFutura.status === 200 && ncRow(N)?.verificacion_programada === enDias(30), [vTexto, vImposible, vPasada, vFutura].map(det).join(" | "));
  const rRic = await api("PUT", `/calidad/nc/${N}`, { responsable_id: id.gabriela, motivo: "Ricardo intenta pasar la NC" }, t.ricardo);
  const rSinMotivo = await api("PUT", `/calidad/nc/${N}`, { responsable_id: id.gabriela }, t.ana);
  const rCorto = await api("PUT", `/calidad/nc/${N}`, { responsable_id: id.gabriela, motivo: "no" }, t.ana);
  const sigue = Number(ncRow(N)?.responsable_id) === id.ricardo;
  const rOk = await api("PUT", `/calidad/nc/${N}`, { responsable_id: id.gabriela, motivo: "Se reasigna por carga de trabajo" }, t.ana);
  check("[cob:C:V-26] cambiar el responsable: el responsable sin calidad:G → 403; con G sin motivo o motivo < 5 → 400 (no cambia); con motivo 200, conserva el anterior y deja audit «reasignar»", rRic.status === 403 && rSinMotivo.status === 400 && rCorto.status === 400 && sigue && rOk.status === 200 && Number(ncRow(N)?.responsable_id) === id.gabriela && String(ncRow(N)?.responsables_previos || "").includes(String(id.ricardo)) && !!fila("SELECT id FROM auditoria WHERE accion = 'reasignar' AND entidad = 'no_conformidades' AND entidad_id = ?", String(N)), [rRic, rSinMotivo, rCorto, rOk].map(det).join(" | "));

  const acciones = () => Number(fila("SELECT COUNT(*) AS n FROM acciones_correctivas WHERE nc_id = ?", N)?.n);
  const nueva = (cuerpo) => api("POST", `/calidad/nc/${N}/acciones`, { descripcion: "Acción válida de la prueba", responsable_id: id.luis, fecha_compromiso: enDias(7), ...cuerpo }, t.ana);
  const aDesc = await nueva({ descripcion: "corta" });
  const aResp = await nueva({ responsable_id: NO_EXISTE });
  const aSinResp = await nueva({ responsable_id: null });
  const aFecha = await nueva({ fecha_compromiso: "mañana" });
  const aImposible = await nueva({ fecha_compromiso: "2026-04-31" });
  check("[cob:C:V-33] agregar acción: descripción < 10 → 400; responsable inexistente o vacío → 400; fecha compromiso no AAAA-MM-DD o imposible → 400; ninguna se crea", [aDesc, aResp, aSinResp, aFecha, aImposible].every((r) => r.status === 400) && acciones() === 0, [aDesc, aResp, aSinResp, aFecha, aImposible].map(det).join(" | "));

  const A = await accion(N, id.luis, "Acción para validar la implementación");
  const impCorta = await api("POST", `/calidad/acciones/${A}/implementar`, { descripcion_implementacion: "lista" }, t.luis);
  const impVacia = await api("POST", `/calidad/acciones/${A}/implementar`, {}, t.luis);
  check("[cob:C:V-37] implementar con descripción de la implementación < 10 o vacía → 400 (sigue pendiente)", impCorta.status === 400 && impVacia.status === 400 && fila("SELECT estado FROM acciones_correctivas WHERE id = ?", A)?.estado === "pendiente", `${det(impCorta)} | ${det(impVacia)}`);

  // V-40: informe afectado (nc_registros_afectados).
  const inf = await informeLiberado(t, "COBAFE");
  const afectados = (nc) => Number(fila("SELECT COUNT(*) AS n FROM nc_registros_afectados WHERE nc_id = ? AND entidad = 'informes'", nc)?.n);
  const NA = await nuevaNc("NC con informe afectado");
  // Responsable sin informes:V (la Técnico Auxiliar no tiene nada en informes; C/E/R/A/AN implican V).
  const NAM = await nuevaNc("NC de Mariana con informe afectado", { responsable_id: id.mariana });
  const af = (nc, cuerpo, token) => api("POST", `/calidad/nc/${nc}/afectados`, cuerpo, token);
  const v40 = {
    texto: await af(NA, { informe_id: "IR-uno" }, t.ana),
    noExiste: await af(NA, { informe_id: NO_EXISTE }, t.ana),
    sinInformesV: await af(NAM, { informe_id: inf.informe }, t.mariana),
    gabriela: await af(NA, { informe_id: inf.informe }, t.gabriela),
    luis: await af(NA, { informe_id: inf.informe }, t.luis),
    ncNo: await af(NO_EXISTE, { informe_id: inf.informe }, t.ana),
    cerrada: await af(NCERR, { informe_id: inf.informe }, t.ana),
  };
  const ok = await af(NA, { informe_id: inf.informe }, t.ana);
  const otraVez = await af(NA, { informe_id: inf.informe }, t.ana);
  check("[cob:C:V-40] [cob:C:4-POST-calidad-nc-id-afectados] informe afectado: id no numérico → 400; inexistente → 404; el responsable sin informes:V (Técnico Auxiliar) → 404 (no enumera folios); quien no edita (Coord. Investigación) → 403; ajena (Técnico Analista) o NC inexistente → 404; NC cerrada → 409 nc_cerrada; con G e informes:V 200 una sola vez (repetirlo no duplica)", v40.texto.status === 400 && v40.noExiste.status === 404 && !!NAM && v40.sinInformesV.status === 404 && afectados(NAM) === 0 && v40.gabriela.status === 403 && v40.luis.status === 404 && v40.ncNo.status === 404 && v40.cerrada.status === 409 && v40.cerrada.data?.codigo === "nc_cerrada" && afectados(NCERR) === 0 && ok.status === 200 && otraVez.status === 200 && afectados(NA) === 1 && Number(fila("SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'afectar' AND entidad = 'no_conformidades' AND entidad_id = ?", String(NA))?.n) === 1, `${Object.entries(v40).map(([k, r]) => `${k}=${r.status}`).join(" ")} ok=${ok.status} afectados=${afectados(NA)}`);
}

/* =================== Incidencias: transiciones y permisos por endpoint (T-01…T-06, V-51, 4) =================== */
{
  const marca = `cob4-${s5}`;
  const deMarca = () => Number(fila("SELECT COUNT(*) AS n FROM incidencias WHERE descripcion LIKE ?", `%${marca}%`)?.n);
  const rep = (quien, extra = {}) => reportar(t[quien], { descripcion: `${marca}: incidencia reportada por ${quien} en la prueba`, ...extra });
  const jorge = await rep("jorge");
  const sinC = deMarca();
  const por = {};
  for (const quien of ["luis", "mariana", "carmen", "diego", "gabriela", "ricardo"]) por[quien] = await rep(quien);
  const audReportar = (I) => !!fila("SELECT id FROM auditoria WHERE accion = 'reportar' AND entidad = 'incidencias' AND entidad_id = ?", String(I));
  const okT01 = Object.entries(por).every(([quien, r]) => r.status === 201 && incRow(r.data?.id)?.estado === "reportada" && Number(incRow(r.data?.id)?.reportada_por) === id[quien] && audReportar(r.data?.id));
  check("[cob:C:T-01] [cob:C:4-POST-calidad-incidencias] reportar: con calidad:C (Técnico Analista, Técnico Auxiliar, Admin. Auxiliar, Estudiante, Coord. Investigación, Coord. Área Técnica) 201 «reportada», a su nombre y con audit «reportar»; sin calidad:C (Admin técnico) → 403 y no se crea", okT01 && jorge.status === 403 && sinC === 0 && deMarca() === 6, `${det(jorge)} ${Object.entries(por).map(([k, r]) => `${k}=${r.status}`).join(" ")}`);
  const IL = por.luis.data?.id;
  const IR = por.ricardo.data?.id;

  // Listas: lo propio con el alcance «incidencias»; todo con V total; nada sin V.
  const listaCal = (token) => api("GET", `/calidad/lista?search=${marca}`, undefined, token);
  const [lJorge, lLuis, lPat] = [await listaCal(t.jorge), await listaCal(t.luis), await listaCal(t.patricia)];
  const idsDe = (r, registro) => (r.data?.items || []).filter((i) => !registro || i.registro === registro).map((i) => Number(i.id));
  check("[cob:C:4-GET-calidad-lista] GET /calidad/lista: sin calidad:V ni C (Admin técnico, V bitácora) → 403; el Técnico Analista solo ve su incidencia; la Responsable General ve las 6", lJorge.status === 403 && lLuis.status === 200 && idsDe(lLuis, "incidencia").join() === String(IL) && lPat.status === 200 && idsDe(lPat, "incidencia").length === 6, `${lJorge.status} ${lLuis.status}:${idsDe(lLuis, "incidencia")} ${lPat.status}:${idsDe(lPat, "incidencia").length}`);
  const listaInc = (token, q = "") => api("GET", `/calidad/incidencias?search=${marca}${q}`, undefined, token);
  const [iJorge, iLuis, iPat] = [await listaInc(t.jorge), await listaInc(t.luis), await listaInc(t.patricia)];
  const exportes = () => Number(fila("SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'exportar' AND entidad = 'incidencias' AND usuario_id = ?", id.patricia)?.n);
  const antesCsv = exportes();
  const csv = await listaInc(t.patricia, "&formato=csv");
  check("[cob:C:4-GET-calidad-incidencias] GET /calidad/incidencias: sin V (Admin técnico) → 403; alcance «incidencias» → solo las que reportó (alcance «incidencias»); V total → todas («total»); formato=csv con su fila y audit «exportar»", iJorge.status === 403 && iLuis.status === 200 && idsDe(iLuis).join() === String(IL) && iLuis.data?.alcance === "incidencias" && iPat.status === 200 && idsDe(iPat).length === 6 && iPat.data?.alcance === "total" && csv.status === 200 && /text\/csv/.test(csv.headers.get("content-type") || "") && String(csv.data).includes(marca) && exportes() === antesCsv + 1, `${iJorge.status} ${iLuis.status}:${idsDe(iLuis)} ${iPat.status}:${idsDe(iPat).length} csv=${csv.status} ${csv.headers.get("content-type")}`);
  const ficha = (I, token) => api("GET", `/calidad/incidencias/${I}`, undefined, token);
  const [fJorge, fAjena, fNo, fPropia, fPat] = [await ficha(IL, t.jorge), await ficha(IR, t.luis), await ficha(NO_EXISTE, t.patricia), await ficha(IL, t.luis), await ficha(IL, t.patricia)];
  check("[cob:C:4-GET-calidad-incidencias-id] GET /calidad/incidencias/:id: sin V (Admin técnico) → 403; ajena con el alcance «incidencias» → 404; inexistente → 404; la propia 200 (sin poder evaluarla); con V total y R 200 y puede evaluar", fJorge.status === 403 && fAjena.status === 404 && fNo.status === 404 && fPropia.status === 200 && Number(fPropia.data?.item?.id) === IL && !fPropia.data?.item?.puede?.evaluar && fPat.status === 200 && !!fPat.data?.item?.puede?.evaluar, `${fJorge.status} ${fAjena.status} ${fNo.status} ${fPropia.status}/${JSON.stringify(fPropia.data?.item?.puede)} ${fPat.status}/${JSON.stringify(fPat.data?.item?.puede)}`);

  // T-03: iniciar la evaluación.
  const evalua = (I, token, headers = {}) => api("POST", `/calidad/incidencias/${I}/evaluacion`, {}, token, headers);
  const e = { luis: await evalua(IL, t.luis), hector: await evalua(IL, t.hector), ajena: await evalua(IR, t.luis), noExiste: await evalua(NO_EXISTE, t.ricardo), propia: await evalua(IR, t.ricardo) };
  const sigueReportada = incRow(IL)?.estado === "reportada" && incRow(IR)?.estado === "reportada";
  const inicia = await evalua(IL, t.ricardo);
  check("[cob:C:T-03] [cob:C:4-POST-calidad-incidencias-id-evaluacion] iniciar evaluación: sin calidad:R (Técnico Analista, Auditor) → 403; ajena sin R → 404 (o 403); inexistente → 404; quien la reportó → 409 segregación regla 7; con R y sin conflicto 200 → «en_evaluacion»", e.luis.status === 403 && e.hector.status === 403 && [403, 404].includes(e.ajena.status) && e.noExiste.status === 404 && e.propia.status === 409 && e.propia.data?.codigo === "segregacion" && Number(e.propia.data?.regla) === 7 && sigueReportada && inicia.status === 200 && incRow(IL)?.estado === "en_evaluacion", `${Object.entries(e).map(([k, r]) => `${k}=${r.status}/${r.data?.regla ?? ""}`).join(" ")} inicia=${det(inicia)}`);

  // T-04: cerrar sin NC desde «reportada» y desde «en_evaluacion».
  const evaluar = (I, cuerpo, token) => api("POST", `/calidad/incidencias/${I}/evaluar`, cuerpo, token);
  const SIN_NC = { decision: "cerrar_sin_nc", justificacion: "Hecho aislado ya corregido en el momento" };
  const IM = por.mariana.data?.id;
  const ev = { luis: await evaluar(IM, SIN_NC, t.luis), noExiste: await evaluar(NO_EXISTE, SIN_NC, t.ricardo), propia: await evaluar(IR, SIN_NC, t.ricardo) };
  const desdeReportada = await evaluar(IM, SIN_NC, t.ricardo);
  const desdeEvaluacion = await evaluar(IL, SIN_NC, t.ricardo);
  const otraVez = await evaluar(IL, SIN_NC, t.patricia);
  check("[cob:C:T-04] [cob:C:4-POST-calidad-incidencias-id-evaluar] evaluar «cerrar sin NC»: sin R → 403; inexistente → 404; quien la reportó → 409 regla 7; desde «reportada» y desde «en_evaluacion» 200 → «cerrada_sin_nc» con quien evaluó; evaluarla otra vez → 409 incidencia_resuelta", ev.luis.status === 403 && ev.noExiste.status === 404 && ev.propia.status === 409 && Number(ev.propia.data?.regla) === 7 && desdeReportada.status === 200 && incRow(IM)?.estado === "cerrada_sin_nc" && desdeEvaluacion.status === 200 && incRow(IL)?.estado === "cerrada_sin_nc" && Number(incRow(IL)?.evaluada_por) === id.ricardo && otraVez.status === 409 && otraVez.data?.codigo === "incidencia_resuelta", `${Object.entries(ev).map(([k, r]) => `${k}=${r.status}`).join(" ")} ${det(desdeReportada)} | ${det(desdeEvaluacion)} | ${det(otraVez)}`);

  // T-05: escalar a una NC nueva y a una existente no cerrada.
  const IC = por.carmen.data?.id;
  const ID = por.diego.data?.id;
  const nueva = await evaluar(IC, { decision: "escalar", justificacion: "Amerita una no conformidad nueva", nc: { clasificacion: "menor", descripcion: `${marca}: no conformidad nacida de la incidencia de Carmen` } }, t.ricardo);
  const NN = Number(nueva.data?.nc_id);
  const NX = await nuevaNc("NC existente para agrupar incidencias");
  const existente = await evaluar(ID, { decision: "escalar", justificacion: "Se agrupa con una NC abierta", nc_id: NX }, t.ricardo);
  check("[cob:C:T-05] escalar: a una NC nueva (origen «incidencia», ligada) y a una NC existente no cerrada → «escalada_a_nc» con nc_id; audit «escalar»", nueva.status === 200 && ncRow(NN)?.origen === "incidencia" && ncRow(NN)?.estado === "abierta" && Number(incRow(IC)?.nc_id) === NN && incRow(IC)?.estado === "escalada_a_nc" && existente.status === 200 && Number(incRow(ID)?.nc_id) === NX && incRow(ID)?.estado === "escalada_a_nc" && !!fila("SELECT id FROM auditoria WHERE accion = 'escalar' AND entidad = 'incidencias' AND entidad_id = ?", String(ID)), `${det(nueva)} nc=${NN}/${ncRow(NN)?.origen} | ${det(existente)}`);

  // T-06 y T-32/T-33: anular con segundo usuario; se guarda el estado previo.
  const IG = por.gabriela.data?.id;
  await evalua(IG, t.ricardo);
  const anula = (I, token, headers = {}) => api("POST", `/calidad/incidencias/${I}/anular`, { motivo: "Se registró por error en la prueba de cobertura" }, token, headers);
  const pend = () => Number(fila("SELECT COUNT(*) AS n FROM solicitudes_autorizacion WHERE entidad = 'incidencias' AND entidad_id = ?", String(IG))?.n);
  const an = { ricardo: await anula(IG, t.ricardo), luis: await anula(IL, t.luis), noExiste: await anula(NO_EXISTE, t.patricia), reauth: await anula(IG, t.patricia, { ...SIN_REAUTH, ...SIN_APROBAR }) };
  const sinSolicitud = pend() === 0;
  const pide = await anula(IG, t.patricia, SIN_APROBAR);
  const S = Number(pide.data?.solicitud?.id);
  const sol = solRow(S);
  const venceDias = (Date.parse(sol?.vence_en) - Date.parse(sol?.solicitado_en)) / 86_400_000;
  check("[cob:C:4-POST-calidad-incidencias-id-anular] anular incidencia: sin calidad:AN (Coord. Área Técnica, Técnico Analista) → 403; inexistente → 404; sin reautenticación → 401 calidad:AN; ninguna crea solicitud", an.ricardo.status === 403 && an.luis.status === 403 && an.noExiste.status === 404 && an.reauth.status === 401 && an.reauth.data?.accion === "calidad:AN" && sinSolicitud, Object.entries(an).map(([k, r]) => `${k}=${r.status}`).join(" "));
  check("[cob:C:T-32] la acción crítica crea la solicitud «pendiente» (202): tipo, motivo, quien la pidió y vence en SOLICITUD_VENCE_DIAS (7); audit «solicitar»; la incidencia sigue en evaluación", pide.status === 202 && sol?.estado === "pendiente" && sol?.tipo === "anular_calidad" && Number(sol?.solicitado_por) === id.patricia && /por error/.test(sol?.motivo || "") && Math.abs(venceDias - 7) < 0.01 && !!fila("SELECT id FROM auditoria WHERE accion = 'solicitar' AND entidad = 'incidencias' AND entidad_id = ?", String(IG)) && incRow(IG)?.estado === "en_evaluacion", `${det(pide)} ${JSON.stringify({ estado: sol?.estado, tipo: sol?.tipo, venceDias })}`);
  const aRic = await aprobar(S, t.ricardo);
  const aAna = await aprobar(S, t.ana, "Procede: se registró por error");
  const tras = incRow(IG);
  const solTras = solRow(S);
  check("[cob:C:3.8-anular_calidad] [cob:C:T-06] [cob:C:T-33] aprobar anular_calidad: sin calidad:AN (Coord. Área Técnica) → 403; otra persona con AN (Mejora Continua) 200 → solicitud «aprobada» con quien resolvió y su motivo, audit «aprobar_solicitud»; la incidencia queda «anulada» con estado_previo en_evaluacion", aRic.status === 403 && aAna.status === 200 && solTras?.estado === "aprobada" && Number(solTras?.resuelto_por) === id.ana && /por error/.test(solTras?.motivo_resolucion || "") && !!fila("SELECT id FROM auditoria WHERE accion = 'aprobar_solicitud' AND usuario_id = ? AND entidad = 'incidencias' AND entidad_id = ?", id.ana, String(IG)) && tras?.estado === "anulada" && tras?.estado_previo === "en_evaluacion" && Number(tras?.anulado_por) === id.ana, `${det(aRic)} | ${det(aAna)} | ${tras?.estado}/${tras?.estado_previo}`);

  // Adjuntos de incidencia (GET y POST).
  const png = (txt) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${txt} ${Date.now()} ${Math.random()}`)]);
  const form = (txt) => {
    const f = new FormData();
    f.append("archivo", new Blob([png(txt)]), "foto.png");
    f.append("tipo_evidencia", "foto");
    f.append("descripcion", "Foto de la prueba de cobertura");
    return f;
  };
  const IA = (await rep("luis")).data?.id;
  const adj = () => Number(fila("SELECT COUNT(*) AS n FROM adjuntos WHERE entidad = 'incidencia' AND entidad_id = ?", IA)?.n);
  const g = { jorge: await api("GET", `/calidad/incidencias/${IA}/adjuntos`, undefined, t.jorge), mariana: await api("GET", `/calidad/incidencias/${IA}/adjuntos`, undefined, t.mariana), noExiste: await api("GET", `/calidad/incidencias/${NO_EXISTE}/adjuntos`, undefined, t.patricia) };
  const p = { ricardo: await api("POST", `/calidad/incidencias/${IA}/adjuntos`, form("ricardo"), t.ricardo), mariana: await api("POST", `/calidad/incidencias/${IA}/adjuntos`, form("mariana"), t.mariana), noExiste: await api("POST", `/calidad/incidencias/${NO_EXISTE}/adjuntos`, form("no"), t.ana) };
  const sinAdjuntos = adj() === 0;
  const subeLuis = await api("POST", `/calidad/incidencias/${IA}/adjuntos`, form("luis"), t.luis);
  const subeAna = await api("POST", `/calidad/incidencias/${IA}/adjuntos`, form("ana"), t.ana);
  const verLuis = await api("GET", `/calidad/incidencias/${IA}/adjuntos`, undefined, t.luis);
  const verRic = await api("GET", `/calidad/incidencias/${IA}/adjuntos`, undefined, t.patricia);
  check("[cob:C:4-GET-POST-calidad-incidencias-id-adjuntos] adjuntos de incidencia: ver sin V (Admin técnico) → 403, ajena (Técnico Auxiliar) o inexistente → 404; subir quien no la reportó sin G (Coord. Área Técnica) → 403, ajena → 404, inexistente → 404, nada se guarda; quien la reportó y calidad:G 201; quien la reportó los ve (edición permitida) y la Responsable General también", g.jorge.status === 403 && g.mariana.status === 404 && g.noExiste.status === 404 && p.ricardo.status === 403 && p.mariana.status === 404 && p.noExiste.status === 404 && sinAdjuntos && subeLuis.status === 201 && subeAna.status === 201 && adj() === 2 && verLuis.status === 200 && (verLuis.data?.items || []).length === 2 && verLuis.data?.edicion?.permitido === true && verRic.status === 200 && (verRic.data?.items || []).length === 2, `${Object.entries(g).map(([k, r]) => `g.${k}=${r.status}`).join(" ")} ${Object.entries(p).map(([k, r]) => `p.${k}=${r.status}`).join(" ")} ${subeLuis.status} ${subeAna.status} ${verLuis.status}/${JSON.stringify(verLuis.data?.edicion)} ${verRic.status}`);

  // V-51 y 3.8: excepción de segregación (Ricardo reportó IR y pide evaluarla).
  const exc = (cuerpo, token = t.ricardo, headers = {}) => api("POST", "/solicitudes", { tipo: "excepcion_segregacion", entidad: "incidencias", entidad_id: IR, accion: "evaluar", motivo: "Falta de personal para evaluar la incidencia", ...cuerpo }, token, headers);
  const excs = () => Number(fila("SELECT COUNT(*) AS n FROM solicitudes_autorizacion WHERE tipo = 'excepcion_segregacion' AND entidad = 'incidencias' AND entidad_id = ?", String(IR))?.n);
  const x = {
    tipo: await exc({ tipo: "anular_calidad" }),
    entidad: await exc({ entidad: "usuarios" }),
    accion: await exc({ accion: "borrar" }),
    accionInc: await exc({ accion: "verificar" }),
    idTexto: await exc({ entidad_id: "abc" }),
    noExiste: await exc({ entidad_id: NO_EXISTE }),
    luis: await exc({ entidad_id: IA }, t.luis),
    innecesaria: await exc({}, t.patricia),
    motivo: await exc({ motivo: "no" }),
    reauth: await exc({}, t.ricardo, { ...SIN_REAUTH, ...SIN_APROBAR }),
  };
  check("[cob:C:V-51] [cob:C:4-POST-solicitudes] pedir excepción: otro tipo → 400; entidad sin excepción → 400; acción fuera de catálogo o que no aplica a incidencias → 400; id no numérico o inexistente → 404; sin calidad:R (Técnico Analista) → 403; sin violación real (no la reportó) → 409 excepcion_innecesaria; motivo < 5 → 400; sin reautenticación → 401 solicitudes:excepcion; no se crea ninguna", x.tipo.status === 400 && x.entidad.status === 400 && x.accion.status === 400 && x.accionInc.status === 400 && x.idTexto.status === 404 && x.noExiste.status === 404 && x.luis.status === 403 && x.innecesaria.status === 409 && x.innecesaria.data?.codigo === "excepcion_innecesaria" && x.motivo.status === 400 && x.reauth.status === 401 && x.reauth.data?.accion === "solicitudes:excepcion" && excs() === 0, Object.entries(x).map(([k, r]) => `${k}=${r.status}`).join(" "));
  const pideExc = await exc({}, t.ricardo, SIN_APROBAR);
  const SE = Number(pideExc.data?.solicitud?.id);
  const xLuis = await aprobar(SE, t.luis);
  const xRic = await aprobar(SE, t.ricardo);
  const xPat = await aprobar(SE, t.patricia, "Procede por falta de personal");
  const ya = await exc({});
  const evalRic = await evalua(IR, t.ricardo);
  check("[cob:C:3.8-excepcion_segregacion] excepción de segregación: solicitud que aprueba calidad:A (Técnico Analista → 403; quien la pidió → 409); la Responsable General 200 y queda en excepciones_json; ya aprobada → 409 excepcion_innecesaria; con ella quien reportó sí inicia la evaluación (200)", pideExc.status === 202 && solRow(SE)?.tipo === "excepcion_segregacion" && solRow(SE)?.modulo === "calidad" && xLuis.status === 403 && xRic.status === 409 && xPat.status === 200 && String(incRow(IR)?.excepciones_json || "").includes(String(id.ricardo)) && ya.status === 409 && ya.data?.codigo === "excepcion_innecesaria" && evalRic.status === 200 && incRow(IR)?.estado === "en_evaluacion", [pideExc, xLuis, xRic, xPat, ya, evalRic].map(det).join(" | "));

  // T-37: una solicitud pendiente vence con el barrido (al listar «Por autorizar»).
  const IV = (await rep("ricardo")).data?.id;
  const pv = await anula(IV, t.patricia, SIN_APROBAR);
  const SV = Number(pv.data?.solicitud?.id);
  ejecutar("UPDATE solicitudes_autorizacion SET vence_en = ? WHERE id = ?", new Date(Date.now() - 60_000).toISOString(), SV);
  const bandeja = await api("GET", "/solicitudes", undefined, t.luis);
  const sv = solRow(SV);
  const otra = await anula(IV, t.patricia, SIN_APROBAR);
  check("[cob:C:T-37] solicitud con el plazo vencido: el barrido al listar la marca «vencida» (motivo de resolución), audit «vencer_solicitud» sin usuario; la incidencia no se anula y admite una solicitud nueva", pv.status === 202 && bandeja.status === 200 && sv?.estado === "vencida" && /plazo/.test(sv?.motivo_resolucion || "") && !!fila("SELECT id FROM auditoria WHERE accion = 'vencer_solicitud' AND usuario_id IS NULL AND entidad = 'incidencias' AND entidad_id = ?", String(IV)) && incRow(IV)?.estado === "reportada" && otra.status === 202, `${det(pv)} ${sv?.estado} ${det(otra)}`);
  await cancelar(otra.data?.solicitud?.id, t.patricia, { motivo: "Prueba de cobertura terminada" });

  // GET /solicitudes: bandeja propia y de un registro.
  const bLuis = await api("GET", "/solicitudes?estado=todas", undefined, t.luis);
  const deIL = await api("GET", `/solicitudes?entidad=incidencias&entidad_id=${IR}`, undefined, t.luis);
  const deIRpat = await api("GET", `/solicitudes?entidad=incidencias&entidad_id=${IR}`, undefined, t.patricia);
  const deRolJorge = await api("GET", `/solicitudes?entidad=incidencias&entidad_id=${IR}`, undefined, t.jorge);
  const ajenas = (bLuis.data?.items || []).filter((sx) => Number(sx.solicitado_por) !== id.luis && Number(sx.resuelto_por) !== id.luis && sx.puedo_aprobar !== true);
  check("[cob:C:4-GET-solicitudes] GET /solicitudes: el Técnico Analista solo ve las suyas o las que puede resolver (nada ajeno); las de una incidencia ajena → 404 (Técnico Analista) y 403 sin calidad:V (Admin técnico… alcance bitácora: 403/404); la Responsable General ve la excepción", bLuis.status === 200 && ajenas.length === 0 && deIL.status === 404 && [403, 404].includes(deRolJorge.status) && deIRpat.status === 200 && (deIRpat.data?.items || []).some((sx) => Number(sx.id) === SE), `${bLuis.status} ajenas=${ajenas.length} ${deIL.status} ${deRolJorge.status} ${deIRpat.status}`);
}

/* =================== NC y acciones: transiciones y permisos por endpoint (T-08…T-24, 4) =================== */
{
  const marca = `cob4nc-${s5}`;
  const listaNc = (token) => api("GET", `/calidad/nc?search=${marca}`, undefined, token);
  const crea = await api("POST", "/calidad/nc", { origen: "auditoria_interna", descripcion: `${marca}: NC de las transiciones de la prueba`, responsable_id: id.ricardo, clasificacion: "mayor" }, t.ana);
  const N = Number(crea.data?.id);
  check("[cob:C:T-08] crear NC con calidad:G (Mejora Continua) 201 → «abierta», con folio, responsable y audit «crear»", crea.status === 201 && ncRow(N)?.estado === "abierta" && Number(ncRow(N)?.folio_num) > 0 && Number(ncRow(N)?.responsable_id) === id.ricardo && !!fila("SELECT id FROM auditoria WHERE accion = 'crear' AND entidad = 'no_conformidades' AND entidad_id = ?", String(N)), det(crea));
  const ajena = await nuevaNc(`${marca}: NC ajena a Ricardo`, { responsable_id: id.gabriela });

  const [nJorge, nLuis, nRic, nPat] = [await listaNc(t.jorge), await listaNc(t.luis), await listaNc(t.ricardo), await listaNc(t.patricia)];
  const ids = (r) => (r.data?.items || []).map((i) => Number(i.id)).sort((a, b) => a - b);
  check("[cob:C:4-GET-calidad-nc] GET /calidad/nc: sin V (Admin técnico) → 403; alcance «incidencias» sin nada suyo → vacío; la Coord. Área Técnica (R total implica V total) y la Responsable General las dos", nJorge.status === 403 && nLuis.status === 200 && ids(nLuis).length === 0 && nRic.status === 200 && ids(nRic).join() === [N, ajena].sort((a, b) => a - b).join() && nPat.status === 200 && ids(nPat).join() === [N, ajena].sort((a, b) => a - b).join(), `${nJorge.status} ${nLuis.status}:${ids(nLuis)} ${nRic.status}:${ids(nRic)} ${nPat.status}:${ids(nPat)}`);
  const verNc = (nc, token) => api("GET", `/calidad/nc/${nc}`, undefined, token);
  const [vJorge, vLuis, vRicAjena, vNo, vRic] = [await verNc(N, t.jorge), await verNc(N, t.luis), await verNc(ajena, t.ricardo), await verNc(NO_EXISTE, t.patricia), await verNc(N, t.ricardo)];
  check("[cob:C:4-GET-calidad-nc-id] GET /calidad/nc/:id: sin V (Admin técnico) → 403; ajena con el alcance «incidencias» (Técnico Analista) → 404; inexistente → 404; su responsable 200 (y la Coord. Área Técnica, con R total, también ve la ajena)", vJorge.status === 403 && vLuis.status === 404 && vRicAjena.status === 200 && vNo.status === 404 && vRic.status === 200 && Number(vRic.data?.item?.id) === N, [vJorge, vLuis, vRicAjena, vNo, vRic].map((r) => r.status).join(" "));
  const editar = (nc, cuerpo, token) => api("PUT", `/calidad/nc/${nc}`, cuerpo, token);
  const ed = { gabriela: await editar(N, { impacto_notas: "Gabriela intenta editar" }, t.gabriela), luis: await editar(N, { impacto_notas: "Luis intenta editar" }, t.luis), hector: await editar(N, { impacto_notas: "El auditor intenta editar" }, t.hector), noExiste: await editar(NO_EXISTE, { impacto_notas: "NC inexistente" }, t.ana), ajena: await editar(ajena, { impacto_notas: "Ricardo edita una ajena" }, t.ricardo) };
  const sinNotas = ncRow(N)?.impacto_notas === null && ncRow(ajena)?.impacto_notas === null;
  const edRic = await editar(N, { ...IMPACTO, impacto_notas: "Impacto evaluado por el responsable" }, t.ricardo);
  check("[cob:C:4-PUT-calidad-nc-id] PUT /calidad/nc/:id: sin editar (Coord. Investigación, Auditor) → 403; la Coord. Área Técnica en la de otra persona (la ve, no la edita) → 403; ajena (Técnico Analista) → 404; inexistente → 404; nada cambia; su responsable (calidad:C/R) 200", ed.gabriela.status === 403 && ed.hector.status === 403 && ed.luis.status === 404 && ed.ajena.status === 403 && ed.noExiste.status === 404 && sinNotas && edRic.status === 200 && ncRow(N)?.impacto_notas === "Impacto evaluado por el responsable", `${Object.entries(ed).map(([k, r]) => `${k}=${r.status}`).join(" ")} ric=${det(edRic)}`);

  // T-09…T-11 con el responsable (sin G).
  const avanzar = (nc, a, token) => api("POST", `/calidad/nc/${nc}/avanzar`, { a }, token);
  const av = { gabriela: await avanzar(N, "en_analisis", t.gabriela), luis: await avanzar(N, "en_analisis", t.luis), noExiste: await avanzar(NO_EXISTE, "en_analisis", t.ana), cerrada: await avanzar(NCERR, "en_analisis", t.ana) };
  const t09 = await avanzar(N, "en_analisis", t.ricardo);
  check("[cob:C:T-09] [cob:C:4-POST-calidad-nc-id-avanzar] avanzar: sin editar (Coord. Investigación) → 403; ajena → 404; inexistente → 404; cerrada → 409 nc_cerrada; abierta → en_analisis por su responsable (con impacto) 200 y audit «avanzar»", av.gabriela.status === 403 && av.luis.status === 404 && av.noExiste.status === 404 && av.cerrada.status === 409 && av.cerrada.data?.codigo === "nc_cerrada" && t09.status === 200 && ncRow(N)?.estado === "en_analisis" && !!fila("SELECT id FROM auditoria WHERE accion = 'avanzar' AND entidad = 'no_conformidades' AND entidad_id = ?", String(N)), `${Object.entries(av).map(([k, r]) => `${k}=${r.status}`).join(" ")} ${det(t09)}`);

  // T-18: acciones.
  const nuevaAcc = (nc, cuerpo, token) => api("POST", `/calidad/nc/${nc}/acciones`, { descripcion: `Acción ${marca} de la prueba`, responsable_id: id.luis, fecha_compromiso: enDias(10), ...cuerpo }, token);
  const ac = { gabriela: await nuevaAcc(N, {}, t.gabriela), luis: await nuevaAcc(N, {}, t.luis), noExiste: await nuevaAcc(NO_EXISTE, {}, t.ana), cerrada: await nuevaAcc(NCERR, {}, t.ana) };
  const cuantas = () => Number(fila("SELECT COUNT(*) AS n FROM acciones_correctivas WHERE nc_id = ?", N)?.n);
  const sinAcciones = cuantas() === 0;
  await editar(N, CAUSA, t.ricardo);
  const A1r = await nuevaAcc(N, {}, t.ricardo);
  const A1 = Number(A1r.data?.id);
  const A2 = Number((await nuevaAcc(N, { descripcion: `Acción ${marca} que se cancelará pendiente` }, t.ricardo)).data?.id);
  const A3 = Number((await nuevaAcc(N, { descripcion: `Acción ${marca} que se cancelará en proceso` }, t.ricardo)).data?.id);
  const A4 = Number((await nuevaAcc(N, { descripcion: `Acción ${marca} implementada sin iniciar`, responsable_id: id.mariana }, t.ricardo)).data?.id);
  const estadoAcc = (A) => fila("SELECT * FROM acciones_correctivas WHERE id = ?", A);
  check("[cob:C:T-18] [cob:C:4-POST-calidad-nc-id-acciones] agregar acción: sin editar (Coord. Investigación) → 403; ajena → 404; inexistente → 404; NC cerrada → 409; ninguna se crea; en análisis su responsable 201 → «pendiente»", ac.gabriela.status === 403 && ac.luis.status === 404 && ac.noExiste.status === 404 && ac.cerrada.status === 409 && sinAcciones && A1r.status === 201 && estadoAcc(A1)?.estado === "pendiente" && Number(estadoAcc(A1)?.responsable_id) === id.luis && cuantas() === 4, `${Object.entries(ac).map(([k, r]) => `${k}=${r.status}`).join(" ")} ${det(A1r)}`);
  const t10 = await avanzar(N, "acciones_en_curso", t.ricardo);
  check("[cob:C:T-10] en_analisis → acciones_en_curso por su responsable (método, causa ≥ 10, requiere = sí, con acciones) 200", t10.status === 200 && ncRow(N)?.estado === "acciones_en_curso", det(t10));

  // GET /calidad/acciones.
  const listaAcc = (token) => api("GET", `/calidad/acciones?search=${marca}`, undefined, token);
  const [aJorge, aLuis, aMariana, aPat] = [await listaAcc(t.jorge), await listaAcc(t.luis), await listaAcc(t.mariana), await listaAcc(t.patricia)];
  check("[cob:C:4-GET-calidad-acciones] GET /calidad/acciones: sin V (Admin técnico) → 403; el Técnico Analista ve solo las suyas (3); la Técnico Auxiliar solo la suya; con V total las 4", aJorge.status === 403 && aLuis.status === 200 && ids(aLuis).join() === [A1, A2, A3].join() && aMariana.status === 200 && ids(aMariana).join() === String(A4) && aPat.status === 200 && ids(aPat).length === 4, `${aJorge.status} ${aLuis.status}:${ids(aLuis)} ${aMariana.status}:${ids(aMariana)} ${aPat.status}:${ids(aPat).length}`);

  // T-22: reasignar una acción.
  const editarAcc = (A, cuerpo, token) => api("PUT", `/calidad/acciones/${A}`, cuerpo, token);
  const ea = { jorge: await editarAcc(A2, { descripcion: "El Admin técnico intenta editar" }, t.jorge), hector: await editarAcc(A2, { descripcion: "El auditor intenta editar la acción" }, t.hector), luis: await editarAcc(A2, { descripcion: "Luis edita la acción de la NC ajena" }, t.luis), mariana: await editarAcc(A2, { descripcion: "Mariana intenta editar la acción" }, t.mariana), carmen: await editarAcc(A2, { descripcion: "Carmen intenta editar la acción" }, t.carmen), noExiste: await editarAcc(NO_EXISTE, { descripcion: "Acción que no existe" }, t.ana) };
  const descIntacta = /se cancelará pendiente/.test(estadoAcc(A2)?.descripcion || "");
  const reasigna = await editarAcc(A2, { responsable_id: id.mariana, motivo: "Luis sale de vacaciones" }, t.ricardo);
  check("[cob:C:T-22] [cob:C:4-PUT-calidad-acciones-id] editar acción: sin V (Admin técnico) → 403; quien la ve pero no edita la NC (Auditor; su responsable; otra responsable de una acción de la NC) → 403; ajena (Admin. Auxiliar) o inexistente → 404; nada cambia; reasignar con motivo (responsable de la NC) 200: mismo estado, responsable nuevo, motivo guardado y audit «reasignar»", ea.jorge.status === 403 && ea.hector.status === 403 && ea.luis.status === 403 && ea.mariana.status === 403 && ea.carmen.status === 404 && ea.noExiste.status === 404 && descIntacta && reasigna.status === 200 && Number(estadoAcc(A2)?.responsable_id) === id.mariana && estadoAcc(A2)?.estado === "pendiente" && estadoAcc(A2)?.motivo_reasignacion === "Luis sale de vacaciones" && !!fila("SELECT id FROM auditoria WHERE accion = 'reasignar' AND entidad = 'no_conformidades' AND entidad_id = ? AND motivo = ?", String(N), "Luis sale de vacaciones"), `${Object.entries(ea).map(([k, r]) => `${k}=${r.status}`).join(" ")} ${det(reasigna)}`);

  // T-19…T-21: iniciar, implementar y cancelar.
  const paso = (A, que, cuerpo, token) => api("POST", `/calidad/acciones/${A}/${que}`, cuerpo, token);
  const IMPL = { descripcion_implementacion: "Se implementó la acción en la prueba de cobertura" };
  const ini = { ricardo: await paso(A1, "iniciar", {}, t.ricardo), mariana: await paso(A1, "iniciar", {}, t.mariana), carmen: await paso(A1, "iniciar", {}, t.carmen), noExiste: await paso(NO_EXISTE, "iniciar", {}, t.ana) };
  const t19 = await paso(A1, "iniciar", {}, t.luis);
  const t19g = await paso(A3, "iniciar", {}, t.ana);
  check("[cob:C:T-19] [cob:C:4-POST-calidad-acciones-id-iniciar] iniciar: el responsable de la NC o la de otra acción, que no son el de esta (sin G) → 403; ajena (Admin. Auxiliar) → 404; inexistente → 404; su responsable y calidad:G 200 → «en_proceso»", ini.ricardo.status === 403 && ini.mariana.status === 403 && ini.carmen.status === 404 && ini.noExiste.status === 404 && t19.status === 200 && estadoAcc(A1)?.estado === "en_proceso" && t19g.status === 200 && estadoAcc(A3)?.estado === "en_proceso", `${Object.entries(ini).map(([k, r]) => `${k}=${r.status}`).join(" ")} ${det(t19)} ${det(t19g)}`);
  const imp = { ricardo: await paso(A1, "implementar", IMPL, t.ricardo), luis: await paso(A4, "implementar", IMPL, t.luis), carmen: await paso(A4, "implementar", IMPL, t.carmen), noExiste: await paso(NO_EXISTE, "implementar", IMPL, t.ana) };
  const t20a = await paso(A1, "implementar", IMPL, t.luis);
  const t20b = await paso(A4, "implementar", IMPL, t.mariana);
  check("[cob:C:T-20] [cob:C:4-POST-calidad-acciones-id-implementar] implementar: quien no es su responsable (Coord. Área Técnica, Técnico Analista; sin G) → 403; ajena (Admin. Auxiliar) → 404; inexistente → 404; desde «en_proceso» y desde «pendiente» su responsable 200 → «implementada» con quien la implementó", imp.ricardo.status === 403 && imp.luis.status === 403 && imp.carmen.status === 404 && imp.noExiste.status === 404 && t20a.status === 200 && estadoAcc(A1)?.estado === "implementada" && Number(estadoAcc(A1)?.implementada_por) === id.luis && t20b.status === 200 && estadoAcc(A4)?.estado === "implementada", `${Object.entries(imp).map(([k, r]) => `${k}=${r.status}`).join(" ")} ${det(t20a)} ${det(t20b)}`);
  const MOT = { motivo: "Se replantea la acción" };
  const can = { luis: await paso(A3, "cancelar", MOT, t.luis), gabriela: await paso(A3, "cancelar", MOT, t.gabriela), noExiste: await paso(NO_EXISTE, "cancelar", MOT, t.ana) };
  const sigueEnProceso = estadoAcc(A3)?.estado === "en_proceso";
  const t21a = await paso(A2, "cancelar", MOT, t.ricardo);
  const t21b = await paso(A3, "cancelar", MOT, t.ana);
  check("[cob:C:T-21] [cob:C:4-POST-calidad-acciones-id-cancelar] cancelar: su responsable que no edita la NC (Técnico Analista) → 403; sin acceso (Coord. Investigación) → 403/404; inexistente → 404; desde «pendiente» (responsable de la NC) y desde «en_proceso» (calidad:G) 200 → «cancelada» con motivo", can.luis.status === 403 && [403, 404].includes(can.gabriela.status) && can.noExiste.status === 404 && sigueEnProceso && t21a.status === 200 && estadoAcc(A2)?.estado === "cancelada" && t21b.status === 200 && estadoAcc(A3)?.estado === "cancelada" && estadoAcc(A3)?.motivo_cancelacion === "Se replantea la acción", `${Object.entries(can).map(([k, r]) => `${k}=${r.status}`).join(" ")} ${det(t21a)} ${det(t21b)}`);

  // Adjuntos de acción (GET y POST).
  const png = (txt) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${txt} ${Date.now()} ${Math.random()}`)]);
  const form = (txt) => {
    const f = new FormData();
    f.append("archivo", new Blob([png(txt)]), "foto.png");
    f.append("tipo_evidencia", "foto");
    f.append("descripcion", "Evidencia de la acción");
    return f;
  };
  const A5 = Number((await nuevaAcc(N, { descripcion: `Acción ${marca} con evidencia` }, t.ana)).data?.id);
  const adjA = () => Number(fila("SELECT COUNT(*) AS n FROM adjuntos WHERE entidad = 'accion_correctiva' AND entidad_id = ?", A5)?.n);
  const gA = { jorge: await api("GET", `/calidad/acciones/${A5}/adjuntos`, undefined, t.jorge), carmen: await api("GET", `/calidad/acciones/${A5}/adjuntos`, undefined, t.carmen), noExiste: await api("GET", `/calidad/acciones/${NO_EXISTE}/adjuntos`, undefined, t.ana) };
  const pA = { ricardo: await api("POST", `/calidad/acciones/${A5}/adjuntos`, form("ricardo"), t.ricardo), mariana: await api("POST", `/calidad/acciones/${A5}/adjuntos`, form("mariana"), t.mariana), carmen: await api("POST", `/calidad/acciones/${A5}/adjuntos`, form("carmen"), t.carmen), noExiste: await api("POST", `/calidad/acciones/${NO_EXISTE}/adjuntos`, form("no"), t.ana) };
  const nada = adjA() === 0;
  const subeA = await api("POST", `/calidad/acciones/${A5}/adjuntos`, form("luis"), t.luis);
  const verA = await api("GET", `/calidad/acciones/${A5}/adjuntos`, undefined, t.ricardo);
  check("[cob:C:4-GET-POST-calidad-acciones-id-adjuntos] adjuntos de acción: ver sin V (Admin técnico) → 403; ajena (Admin. Auxiliar) o inexistente → 404; subir quien no es su responsable (Coord. Área Técnica, otra responsable de la NC; sin G) → 403, ajena → 404, inexistente → 404; nada se guarda; su responsable 201 y el responsable de la NC lo ve", gA.jorge.status === 403 && gA.carmen.status === 404 && gA.noExiste.status === 404 && pA.ricardo.status === 403 && pA.mariana.status === 403 && pA.carmen.status === 404 && pA.noExiste.status === 404 && nada && subeA.status === 201 && adjA() === 1 && verA.status === 200 && (verA.data?.items || []).length === 1, `${Object.entries(gA).map(([k, r]) => `g.${k}=${r.status}`).join(" ")} ${Object.entries(pA).map(([k, r]) => `p.${k}=${r.status}`).join(" ")} ${subeA.status} ${verA.status}`);
  await paso(A5, "implementar", IMPL, t.luis);

  // T-11, T-24/T-12, T-23/T-13, T-14.
  const t11 = await avanzar(N, "en_verificacion", t.ricardo);
  check("[cob:C:T-11] acciones_en_curso → en_verificacion (sin pendientes ni en proceso; con implementadas) por su responsable 200", t11.status === 200 && ncRow(N)?.estado === "en_verificacion", det(t11));
  const verificar = (nc, cuerpo, token) => api("POST", `/calidad/nc/${nc}/verificar`, cuerpo, token);
  const vr = { gabriela: await verificar(N, { resultado: "eficaz", comentarios: "Gabriela intenta verificar" }, t.gabriela), noExiste: await verificar(NO_EXISTE, { resultado: "eficaz", comentarios: "NC que no existe en la base" }, t.ana), carmen: await verificar(N, { resultado: "eficaz", comentarios: "Carmen intenta verificar la NC" }, t.carmen) };
  const verifs = () => Number(fila("SELECT COUNT(*) AS n FROM nc_verificaciones WHERE nc_id = ?", N)?.n);
  const sinVerifs = verifs() === 0;
  const noEficaz = await verificar(N, { resultado: "no_eficaz", comentarios: "La falla se repitió después de la acción" }, t.patricia);
  check("[cob:C:T-24] [cob:C:T-12] [cob:C:4-POST-calidad-nc-id-verificar] verificar: sin calidad:R (Coord. Investigación) → 403; inexistente → 404; sin R ni acceso (Admin. Auxiliar) → 403/404 (quien tiene R lo tiene total); nada se registra; «no eficaz» por quien no implementó → la NC vuelve a en_analisis, reaperturas + 1 y audit «reabrir»", vr.gabriela.status === 403 && vr.noExiste.status === 404 && [403, 404].includes(vr.carmen.status) && sinVerifs && noEficaz.status === 200 && ncRow(N)?.estado === "en_analisis" && Number(ncRow(N)?.reaperturas) === 1 && verifs() === 1 && !!fila("SELECT id FROM auditoria WHERE accion = 'reabrir' AND entidad = 'no_conformidades' AND entidad_id = ?", String(N)), `${Object.entries(vr).map(([k, r]) => `${k}=${r.status}`).join(" ")} ${det(noEficaz)} reaperturas=${ncRow(N)?.reaperturas}`);
  const A6 = Number((await nuevaAcc(N, { descripcion: `Acción ${marca} tras la reapertura`, responsable_id: id.mariana }, t.ana)).data?.id);
  await avanzar(N, "acciones_en_curso", t.ana);
  await paso(A6, "implementar", IMPL, t.mariana);
  await avanzar(N, "en_verificacion", t.ana);
  const eficaz = await verificar(N, { resultado: "eficaz", comentarios: "La causa se eliminó: sin repetición" }, t.patricia);
  check("[cob:C:T-23] [cob:C:T-13] «eficaz» por quien no es responsable ni implementador 200: la NC sigue en en_verificacion y la verificación queda registrada", eficaz.status === 200 && ncRow(N)?.estado === "en_verificacion" && verifs() === 2 && fila("SELECT resultado FROM nc_verificaciones WHERE nc_id = ? ORDER BY id DESC", N)?.resultado === "eficaz", det(eficaz));
  const cerrar = (nc, token, headers = {}) => api("POST", `/calidad/nc/${nc}/cerrar`, { conclusion: "Acciones eficaces y verificadas en la prueba" }, token, headers);
  const ce = { gabriela: await cerrar(N, t.gabriela), ricardo: await cerrar(N, t.ricardo), noExiste: await cerrar(NO_EXISTE, t.patricia), hector: await cerrar(N, t.hector) };
  const sigueAbierta = ncRow(N)?.estado === "en_verificacion";
  const t14 = await cerrar(N, t.patricia);
  const cerradaN = ncRow(N);
  const pdf = cerradaN?.archivo_pdf ? fs.readFileSync(path.join(path.dirname(process.env.TEST_DB_PATH), "calidad", "nc", String(cerradaN.archivo_pdf))) : null;
  const sha = pdf ? (await import("node:crypto")).createHash("sha256").update(pdf).digest("hex") : null;
  check("[cob:C:T-14] [cob:C:4-POST-calidad-nc-id-cerrar] cerrar con acción: sin calidad:A (Coord. Investigación, Coord. Área Técnica, Auditor) → 403; inexistente → 404; sigue en verificación; con A (Responsable General, no responsable) 200 → «cerrada» con el PDF «Registro de NC» y su SHA-256 guardado (coincide con el archivo) y audit «cerrar»", ce.gabriela.status === 403 && ce.ricardo.status === 403 && ce.hector.status === 403 && ce.noExiste.status === 404 && sigueAbierta && t14.status === 200 && cerradaN?.estado === "cerrada" && !!pdf && pdf.subarray(0, 4).toString() === "%PDF" && sha === cerradaN?.pdf_sha256 && !!fila("SELECT id FROM auditoria WHERE accion = 'cerrar' AND entidad = 'no_conformidades' AND entidad_id = ?", String(N)), `${Object.entries(ce).map(([k, r]) => `${k}=${r.status}`).join(" ")} ${det(t14)} pdf=${cerradaN?.archivo_pdf} sha=${sha === cerradaN?.pdf_sha256}`);

  // GET /calidad/nc/:id/pdf.
  const descargas = () => Number(fila("SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'descargar' AND entidad = 'no_conformidades' AND entidad_id = ?", String(N))?.n);
  const antesPdf = descargas();
  const pd = { jorge: await api("GET", `/calidad/nc/${N}/pdf`, undefined, t.jorge), carmen: await api("GET", `/calidad/nc/${N}/pdf`, undefined, t.carmen), noExiste: await api("GET", `/calidad/nc/${NO_EXISTE}/pdf`, undefined, t.patricia) };
  const pdPat = await api("GET", `/calidad/nc/${N}/pdf`, undefined, t.patricia);
  const pdLuis = await api("GET", `/calidad/nc/${N}/pdf`, undefined, t.luis);
  check("[cob:C:4-GET-calidad-nc-id-pdf] PDF de la NC: sin V (Admin técnico) → 403; ajena (Admin. Auxiliar) o inexistente → 404; con V total el PDF final (X-Integridad-Pdf ok, su SHA-256); quien la ve sin V total (Técnico Analista, responsable de una acción) uno generado al vuelo («a_pedido»); cada descarga deja audit «descargar»", pd.jorge.status === 403 && pd.carmen.status === 404 && pd.noExiste.status === 404 && pdPat.status === 200 && /pdf/.test(pdPat.headers.get("content-type") || "") && pdPat.headers.get("x-integridad-pdf") === "ok" && pdPat.headers.get("x-pdf-sha256") === cerradaN?.pdf_sha256 && pdLuis.status === 200 && pdLuis.headers.get("x-integridad-pdf") === "a_pedido" && descargas() === antesPdf + 2, `${Object.entries(pd).map(([k, r]) => `${k}=${r.status}`).join(" ")} pat=${pdPat.status}/${pdPat.headers.get("x-integridad-pdf")} luis=${pdLuis.status}/${pdLuis.headers.get("x-integridad-pdf")}`);
  const prop = await api("POST", `/calidad/nc/${N}/propuesta-documental`, {}, t.ana);
  check("[cob:C:4-POST-calidad-nc-id-propuesta-documental] propuesta documental desde una NC: funcionalidad retirada → 410", prop.status === 410, det(prop));

  // Comunicaciones.
  const NCm = await nuevaNc(`${marca}: NC para comunicaciones`);
  const COM = { fecha: hoy(), medio: "correo", contacto: "Cliente Tres", resumen: "Se informó al cliente del hallazgo" };
  const com = (nc, token) => api("POST", `/calidad/nc/${nc}/comunicaciones`, COM, token);
  const co = { gabriela: await com(NCm, t.gabriela), luis: await com(NCm, t.luis), noExiste: await com(NO_EXISTE, t.ana), cerrada: await com(NCERR, t.ana) };
  const coms = (nc) => Number(fila("SELECT COUNT(*) AS n FROM nc_comunicaciones WHERE nc_id = ?", nc)?.n);
  const sinComs = coms(NCm) === 0 && coms(NCERR) === 0;
  const coRic = await com(NCm, t.ricardo);
  check("[cob:C:4-POST-calidad-nc-id-comunicaciones] comunicación: sin editar (Coord. Investigación) → 403; ajena → 404; inexistente → 404; cerrada → 409; nada se registra; su responsable 201 y audit «comunicar»", co.gabriela.status === 403 && co.luis.status === 404 && co.noExiste.status === 404 && co.cerrada.status === 409 && sinComs && [200, 201].includes(coRic.status) && coms(NCm) === 1 && !!fila("SELECT id FROM auditoria WHERE accion = 'comunicar' AND entidad = 'no_conformidades' AND entidad_id = ?", String(NCm)), `${Object.entries(co).map(([k, r]) => `${k}=${r.status}`).join(" ")} ${det(coRic)}`);

  // T-15: cerrar sin acción desde «abierta» y desde «en_analisis».
  const NS1 = await nuevaNc(`${marca}: NC sin acción abierta`);
  await editar(NS1, SIN_ACCION, t.ana);
  const NS2 = await ncEnAnalisis(`${marca}: NC sin acción en análisis`);
  await editar(NS2, SIN_ACCION, t.ana);
  const c1 = await cerrar(NS1, t.patricia);
  const c2 = await cerrar(NS2, t.ana);
  check("[cob:C:T-15] cerrar sin acción (requiere = no, justificación ≥ 10, sin acciones): desde «abierta» y desde «en_analisis» 200 → «cerrada» con PDF", c1.status === 200 && ncRow(NS1)?.estado === "cerrada" && !!ncRow(NS1)?.pdf_sha256 && c2.status === 200 && ncRow(NS2)?.estado === "cerrada" && !!ncRow(NS2)?.pdf_sha256, `${det(c1)} | ${det(c2)}`);

  // Anular NC: permisos por endpoint.
  const NAN = await nuevaNc(`${marca}: NC que se intenta anular`);
  const anularNc = (nc, token) => api("POST", `/calidad/nc/${nc}/anular`, { motivo: "Registrada por error en la prueba" }, token, SIN_APROBAR);
  const anc = { ricardo: await anularNc(NAN, t.ricardo), hector: await anularNc(NAN, t.hector), noExiste: await anularNc(NO_EXISTE, t.patricia) };
  const sinSol = !fila("SELECT id FROM solicitudes_autorizacion WHERE entidad = 'no_conformidades' AND entidad_id = ?", String(NAN));
  const ancOk = await anularNc(NAN, t.patricia);
  const SA = Number(ancOk.data?.solicitud?.id);
  const anRic = await aprobar(SA, t.ricardo);
  const anAna = await aprobar(SA, t.ana);
  check("[cob:C:4-POST-calidad-nc-id-anular] [cob:C:T-16] anular NC: sin calidad:AN (Coord. Área Técnica, Auditor) → 403; inexistente → 404; sin solicitud; con AN 202 anular_calidad; aprobarla sin AN → 403; otra persona con AN 200 → «anulada» con estado_previo «abierta»", anc.ricardo.status === 403 && anc.hector.status === 403 && anc.noExiste.status === 404 && sinSol && ancOk.status === 202 && solRow(SA)?.tipo === "anular_calidad" && anRic.status === 403 && anAna.status === 200 && ncRow(NAN)?.estado === "anulada" && ncRow(NAN)?.estado_previo === "abierta", `${Object.entries(anc).map(([k, r]) => `${k}=${r.status}`).join(" ")} ${det(ancOk)} ${det(anRic)} ${det(anAna)}`);
}

/* =================== Suspensiones activas, bitácora y autorizaciones de sesión (4) =================== */
{
  // Todo rol del catálogo tiene equipos (C implica V): el 403 se prueba con una cuenta propia sin roles (su rol inicial se cancela).
  const C5 = await cuenta("Cobertura Sin Roles", {}, SIN_APROBAR);
  const solC5 = fila("SELECT id FROM solicitudes_autorizacion WHERE tipo = 'asignar_rol' AND entidad = 'usuarios' AND entidad_id = ? AND estado = 'pendiente'", String(C5.id));
  if (solC5) await cancelar(solC5.id, t.jorge, { motivo: "La cuenta de cobertura queda sin roles" });
  const sinRoles = !fila("SELECT id FROM usuario_roles WHERE usuario_id = ? AND revocado_en IS NULL", C5.id);
  const tC5 = await login(C5.email, `Temporal-${s5}-2026`);
  const sa = { sinRoles: await api("GET", "/calidad/suspensiones/activas", undefined, tC5), carmen: await api("GET", "/calidad/suspensiones/activas", undefined, t.carmen), hector: await api("GET", "/calidad/suspensiones/activas", undefined, t.hector), ricardo: await api("GET", "/calidad/suspensiones/activas", undefined, t.ricardo) };
  const activasBd = Number(fila("SELECT COUNT(*) AS n FROM suspensiones WHERE reanudada_en IS NULL")?.n);
  check("[cob:C:4-GET-calidad-suspensiones-activas] GET /calidad/suspensiones/activas: sin ensayos:V, equipos:V ni calidad:V (cuenta sin roles; ningún rol del catálogo carece de los tres) → 403; con equipos:C (Admin. Auxiliar), V (Auditor) o equipos:G (Coord. Área Técnica) 200 con las activas", !!tC5 && sinRoles && sa.sinRoles.status === 403 && sa.carmen.status === 200 && sa.hector.status === 200 && Array.isArray(sa.hector.data?.items) && sa.hector.data.items.length === activasBd && sa.ricardo.status === 200, `${Object.entries(sa).map(([k, r]) => `${k}=${r.status}`).join(" ")} ${sa.hector.data?.items?.length}/${activasBd}`);

  const au = { carmen: await api("GET", "/audit?limit=5", undefined, t.carmen), luis: await api("GET", "/audit?limit=5", undefined, t.luis), jorge: await api("GET", "/audit?limit=5", undefined, t.jorge), hector: await api("GET", "/audit?limit=5", undefined, t.hector) };
  check("[cob:C:4-GET-audit] GET /audit sin entidad: sin calidad:V (Admin. Auxiliar, Técnico Analista) → 403; con V «bitácora» (Admin técnico) o total (Auditor) 200", au.carmen.status === 403 && au.luis.status === 403 && au.jorge.status === 200 && (au.jorge.data?.items || []).length > 0 && au.hector.status === 200, Object.entries(au).map(([k, r]) => `${k}=${r.status}`).join(" "));
  const ultima = fila("SELECT id, accion FROM auditoria WHERE entidad = 'no_conformidades' ORDER BY id DESC LIMIT 1");
  const ae = { luis: await api("GET", `/audit/${ultima?.id}`, undefined, t.luis), noExiste: await api("GET", `/audit/${NO_EXISTE * 100}`, undefined, t.patricia) };
  const aeOk = await api("GET", `/audit/${ultima?.id}`, undefined, t.hector);
  check("[cob:C:4-GET-audit-id] GET /audit/:id: sin calidad:V (Técnico Analista) → 403; inexistente → 404; con V 200 con esa entrada", ae.luis.status === 403 && ae.noExiste.status === 404 && aeOk.status === 200 && Number(aeOk.data?.item?.id) === Number(ultima?.id) && aeOk.data?.item?.accion === ultima?.accion, `${ae.luis.status} ${ae.noExiste.status} ${det(aeOk)}`);
  const su = { luis: await api("GET", "/audit/summary", undefined, t.luis), pat: await api("GET", "/audit/summary", undefined, t.patricia) };
  check("[cob:C:4-GET-audit-summary] GET /audit/summary: sin calidad:V → 403; con V 200 con total, últimos 30 días, anulaciones y accesos fallidos", su.luis.status === 403 && su.pat.status === 200 && ["total", "ultimos_30_dias", "anulaciones", "accesos_fallidos_30_dias"].every((k) => Number.isFinite(Number(su.pat.data?.[k]))) && Number(su.pat.data?.total) > 0, `${su.luis.status} ${su.pat.status} ${JSON.stringify(su.pat.data)}`);
  const vf = { luis: await api("GET", "/audit/verify", undefined, t.luis), hector: await api("GET", "/audit/verify", undefined, t.hector) };
  check("[cob:C:4-GET-audit-verify] GET /audit/verify: sin calidad:V → 403; con V 200: cadena íntegra (ok) y el origen de la llave (sin la llave)", vf.luis.status === 403 && vf.hector.status === 200 && vf.hector.data?.ok === true && !!vf.hector.data?.llave?.origen && !JSON.stringify(vf.hector.data).includes(String(process.env.SECRET_KEY || "sin-llave-en-el-entorno")), `${vf.luis.status} ${vf.hector.status} ok=${vf.hector.data?.ok} ${vf.hector.data?.primer_error ?? ""}`);

  const cat = { sinSesion: await api("GET", "/autorizaciones/catalogo"), diego: await api("GET", "/autorizaciones/catalogo", undefined, t.diego) };
  check("[cob:C:4-GET-autorizaciones-catalogo] GET /autorizaciones/catalogo: sin sesión → 401; cualquier sesión (Estudiante) 200 con las actividades del catálogo", cat.sinSesion.status === 401 && cat.diego.status === 200 && JSON.stringify(cat.diego.data).includes("recepcion") && JSON.stringify(cat.diego.data).includes("liberacion_informe"), `${cat.sinSesion.status} ${cat.diego.status}`);
  const mias = { sinSesion: await api("GET", "/autorizaciones/mias"), carmen: await api("GET", "/autorizaciones/mias", undefined, t.carmen) };
  const deCarmen = Number(fila("SELECT COUNT(*) AS n FROM autorizaciones_personal WHERE usuario_id = ?", id.carmen)?.n);
  check("[cob:C:4-GET-autorizaciones-mias] GET /autorizaciones/mias: sin sesión → 401; con sesión 200 solo con las propias e indica si son obligatorias", mias.sinSesion.status === 401 && mias.carmen.status === 200 && (mias.carmen.data?.items || []).length === deCarmen && (mias.carmen.data?.items || []).every((a) => Number(a.usuario_id) === id.carmen) && mias.carmen.data?.obligatorias === true, `${mias.sinSesion.status} ${mias.carmen.status} ${(mias.carmen.data?.items || []).length}/${deCarmen}`);
}

/* =================== Aprobar sin tener el rol (3.8 ampliar_permisos_rol) y obsoletar un documento SGC (3.8) =================== */
{
  const rolX = await api("POST", "/admin/roles", { nombre: `Aprobador de cobertura ${s5}`, motivo: "Rol con usuarios:A para la prueba de cobertura", permisos: [{ modulo: "usuarios", accion: "A" }] }, t.jorge);
  const X = Number(rolX.data?.id);
  const C4 = await cuenta("Cobertura Aprobadora", { rol_id: X });
  const tC4 = await login(C4.email, `Temporal-${s5}-2026`);
  const amplia = await api("PUT", `/admin/roles/${X}`, { nombre: `Aprobador de cobertura ${s5}`, motivo: "Se agrega reportar incidencias", permisos: [{ modulo: "usuarios", accion: "A" }, { modulo: "calidad", accion: "C" }] }, t.jorge, SIN_APROBAR);
  const SX = Number(amplia.data?.solicitud?.id);
  const propia = await aprobar(SX, tC4);
  const sinCalidad = !fila("SELECT 1 AS x FROM rol_acciones WHERE id_rol = ? AND modulo = 'calidad'", X);
  const otra = await aprobar(SX, t.patricia);
  check("[cob:C:3.8-ampliar_permisos_rol] ampliar permisos de un rol: quien tiene usuarios:A pero también ese rol vigente → 409 rol_propio (no se amplía); otra persona con usuarios:A sin ese rol 200", !!X && !!tC4 && !!fila("SELECT 1 AS x FROM usuario_roles WHERE usuario_id = ? AND rol_id = ? AND revocado_en IS NULL", C4.id, X) && amplia.status === 202 && propia.status === 409 && propia.data?.codigo === "rol_propio" && sinCalidad && otra.status === 200 && !!fila("SELECT 1 AS x FROM rol_acciones WHERE id_rol = ? AND modulo = 'calidad' AND accion = 'C'", X), `${det(rolX)} cuenta=${C4.status} ${det(amplia)} | ${det(propia)} | ${det(otra)}`);

  // obsoletar_documento_sgc: un documento vigente propio (carga inicial).
  const PDF = await pdfConTexto(1, `Cobertura calidad ${s5}`);
  const fd = new FormData();
  const campos = { clave: `FX-TCP-C${s5.toUpperCase()}0`, titulo: `Documento de cobertura de calidad ${s5}`, area_codigo: "TC", tipo_codigo: "P", elaborador_id: id.luis, revisor_id: id.gabriela, autorizador_id: id.patricia };
  for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
  fd.append("archivo_pdf", new Blob([PDF]), "inicial.pdf");
  const doc = await api("POST", "/sgc/documentos", fd, t.ana);
  const vig = await api("POST", `/sgc/revisiones/${doc.data?.revision_id}/registrar-vigente`, { fecha_emision: "2025-01-10", fecha_proxima_revision: "2028-01-10" }, t.ana);
  const DOC = Number(doc.data?.id);
  const obs = await api("POST", `/sgc/documentos/${DOC}/obsoletar`, { motivo: "Se retira el documento de la prueba de calidad" }, t.ana, SIN_APROBAR);
  const SO = Number(obs.data?.solicitud?.id);
  const oLuis = await aprobar(SO, t.luis);
  const oAna = await aprobar(SO, t.ana);
  const sigueVigente = fila("SELECT estado FROM sgc_documentos WHERE id = ?", DOC)?.estado !== "obsoleto";
  const oPat = await aprobar(SO, t.patricia);
  check("[cob:C:3.8-obsoletar_documento_sgc] obsoletar un documento SGC: solicitud obsoletar_documento_sgc que aprueba documento_autorizar (Técnico Analista → 403; quien la pidió → 409); la Responsable General 200 y el documento queda obsoleto", doc.status === 201 && vig.status === 200 && obs.status === 202 && solRow(SO)?.tipo === "obsoletar_documento_sgc" && oLuis.status === 403 && oAna.status === 409 && sigueVigente && oPat.status === 200 && fila("SELECT estado FROM sgc_documentos WHERE id = ?", DOC)?.estado === "obsoleto", `${det(doc)} ${det(vig)} ${det(obs)} | ${det(oLuis)} | ${det(oAna)} | ${det(oPat)}`);
}

/* =================== Bitácora: filtros (5.1) =================== */
{
  const lista = async (q, token = t.patricia) => {
    const r = await api("GET", `/audit?${q}`, undefined, token);
    return { status: r.status, items: r.data?.items || [], truncado: r.data?.truncado, data: r.data };
  };
  const unaAccion = await lista("accion=reportar&limit=50");
  check("[cob:C:A-accion] [cob:C:5.1-accion] accion=reportar → solo esa acción", unaAccion.status === 200 && unaAccion.items.length > 0 && unaAccion.items.every((i) => i.accion === "reportar"), `${unaAccion.status} ${unaAccion.items.length}`);
  const varias = await lista("acciones=reportar,escalar,DROP%20TABLE&limit=100");
  check("[cob:C:A-acciones] [cob:C:5.1-acciones] [cob:C:V-57] acciones=reportar,escalar (lo que no cumple ^[a-z_]{2,40}$ se ignora) → solo esas acciones", varias.status === 200 && varias.items.length > 0 && varias.items.every((i) => ["reportar", "escalar"].includes(i.accion)), `${varias.items.length} ${[...new Set(varias.items.map((i) => i.accion))].join(",")}`);
  const falsas = (n) => Array.from({ length: n }, (_, i) => `zz_${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`);
  const tope80 = await lista(`acciones=${[...falsas(80), "reportar"].join(",")}&limit=20`);
  const tope79 = await lista(`acciones=${[...falsas(79), "reportar"].join(",")}&limit=20`);
  check("[cob:C:A-acciones] [cob:C:5.1-acciones] [cob:C:V-57] la lista se corta en 80 acciones (la 81.ª no cuenta)", tope80.status === 200 && tope80.items.length === 0 && tope79.items.length > 0, `${tope80.items.length} ${tope79.items.length}`);
  const usuario = await lista("usuario=luis.castro&limit=50");
  check("[cob:C:A-usuario] [cob:C:5.1-usuario] usuario=luis.castro (LIKE sobre nombre o correo) → solo sus entradas", usuario.items.length > 0 && usuario.items.every((i) => /luis\.castro/i.test(`${i.usuario_email} ${i.usuario_nombre}`)), `${usuario.items.length}`);
  const usuarios = await lista(`usuarios=${encodeURIComponent("luis.castro@ficotox.local,ana.torres@ficotox.local")}&limit=80`);
  const parcial = await lista("usuarios=luis.castro&limit=5");
  check("[cob:C:A-usuarios] [cob:C:5.1-usuarios] usuarios=<correos exactos> → solo esas cuentas; un correo parcial no coincide", usuarios.items.length > 0 && usuarios.items.every((i) => [id.luis, id.ana].includes(Number(i.usuario_id))) && parcial.items.length === 0, `${usuarios.items.length} ${parcial.items.length}`);
  const entidades = await lista("entidades=no_conformidades,incidencias&limit=80");
  check("[cob:C:A-entidades] [cob:C:5.1-entidades] entidades=no_conformidades,incidencias → solo esos registros", entidades.items.length > 0 && entidades.items.every((i) => ["no_conformidades", "incidencias"].includes(i.entidad)), `${entidades.items.length}`);
  const modulo = await lista("modulo=calidad&limit=80");
  check("[cob:C:A-modulo] [cob:C:5.1-modulo] modulo=calidad → solo entidades de calidad", modulo.items.length > 0 && modulo.items.every((i) => ["incidencias", "no_conformidades", "acciones_correctivas", "suspensiones"].includes(i.entidad)), `${modulo.items.length} ${[...new Set(modulo.items.map((i) => i.entidad))].join(",")}`);
  const marcaSusp = `Equipo en duda por la prueba de cobertura`;
  const rolMotivo = "Rol de la prueba de cobertura";
  const sPat = await lista(`search=${encodeURIComponent(marcaSusp)}&limit=20`);
  const sJorge = await lista(`search=${encodeURIComponent(marcaSusp)}&limit=20`, t.jorge);
  const sJorgeRol = await lista(`search=${encodeURIComponent(rolMotivo)}&limit=20`, t.jorge);
  check("[cob:C:A-search] [cob:C:5.1-search] search busca en el motivo; el motivo de una suspensión de calidad lo encuentra quien tiene calidad:V total y no el Admin técnico (V bitácora), que sí encuentra un motivo de Administración", sPat.items.some((i) => i.accion === "suspender") && sJorge.status === 200 && sJorge.items.length === 0 && sJorgeRol.items.some((i) => i.entidad === "roles"), `${sPat.items.length} ${sJorge.status}/${sJorge.items.length} ${sJorgeRol.items.length}`);
  const dia = hoy();
  const local = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana" }).format(new Date(iso));
  const deHoy = await lista(`desde=${dia}&hasta=${dia}&usuarios=${encodeURIComponent("luis.castro@ficotox.local")}&limit=50`);
  const pasado = await lista("hasta=2020-01-01&limit=5");
  const futuro = await lista("desde=2099-01-01&limit=5");
  const malDesde = await lista("desde=ayer&limit=5");
  const malHasta = await lista("hasta=2026-01-01T10:00&limit=5");
  check("[cob:C:A-desde-hasta] [cob:C:5.1-desde-hasta] desde=hasta=hoy (sin hora: el día local completo) → solo entradas de hoy, incluida la más reciente; hasta 2020 o desde 2099 → nada; fecha que no es AAAA-MM-DD → 400 con campo", deHoy.items.length > 0 && deHoy.items.every((i) => local(i.fecha_hora) === dia) && pasado.items.length === 0 && futuro.items.length === 0 && malDesde.status === 400 && malDesde.data?.campo === "desde" && malHasta.status === 400 && malHasta.data?.campo === "hasta", `${deHoy.items.length} ${pasado.items.length} ${futuro.items.length} ${malDesde.status}/${malDesde.data?.campo} ${malHasta.status}/${malHasta.data?.campo}`);
  const cero = await lista("limit=-5");
  const mucho = await lista("limit=5000");
  const omision = await lista("");
  check("[cob:C:A-limit] [cob:C:5.1-limit] [cob:C:V-57] limit se acota a 1–1000 (-5 → 1, 5000 → ≤ 1000) y por omisión es 200", cero.items.length === 1 && mucho.items.length <= 1000 && (mucho.items.length > 200 || !mucho.truncado) && (omision.items.length === 200 ? omision.truncado === true : omision.items.length < 200), `${cero.items.length} ${mucho.items.length} ${omision.items.length} ${omision.truncado}`);
  const p1 = await lista("limit=5");
  const ultimo = p1.items.at(-1)?.id;
  const p2 = await lista(`limit=5&antes_de=${ultimo}`);
  check("[cob:C:A-antes_de] [cob:C:5.1-antes_de] antes_de=<id> pagina: la página siguiente trae solo ids menores, sin repetir", p1.items.length === 5 && p2.items.length > 0 && p2.items.every((i) => Number(i.id) < Number(ultimo)) && !p2.items.some((i) => p1.items.some((j) => j.id === i.id)), `${ultimo} ${p2.items.map((i) => i.id).join(",")}`);
  const conAccesos = await lista("acciones=login,reportar&limit=100");
  const sinAccesos = await lista("acciones=login,reportar&sin_accesos=1&limit=100");
  check("[cob:C:A-sin_accesos] [cob:C:5.1-sin_accesos] sin_accesos=1 quita login (y fallidos, reauth fallida, cerrar sesiones)", conAccesos.items.some((i) => i.accion === "login") && sinAccesos.items.length > 0 && !sinAccesos.items.some((i) => ["login", "login_fallido", "reauth_fallida", "cerrar_sesiones"].includes(i.accion)), `${conAccesos.items.length} ${sinAccesos.items.length}`);
  const csv = await api("GET", "/audit?formato=csv", undefined, t.patricia);
  check("[cob:C:A-formato] [cob:C:5.1-formato] [cob:C:V-57] formato=csv (exportación retirada) → 410", csv.status === 410, `${csv.status}`);
  // entidad + entidad_id: el historial de un registro, con la visibilidad de su ficha.
  const incLuis = (await reportar(t.luis, { descripcion: `Historial de Luis ${s5} para la bitácora` })).data?.id;
  const incRic = (await reportar(t.ricardo, { descripcion: `Historial de Ricardo ${s5} para la bitácora` })).data?.id;
  const hLuis = await lista(`entidad=incidencias&entidad_id=${incLuis}`, t.luis);
  const hAjena = await lista(`entidad=incidencias&entidad_id=${incRic}`, t.luis);
  const hJorge = await lista(`entidad=incidencias&entidad_id=${incLuis}`, t.jorge);
  const hNo = await lista(`entidad=no_conformidades&entidad_id=${NO_EXISTE}`, t.patricia);
  const hPat = await lista(`entidad=incidencias&entidad_id=${incRic}`, t.patricia);
  check("[cob:C:5.1-entidad-entidad_id] [cob:C:V-57] entidad+entidad_id: solo las entradas de ese registro; Luis (alcance incidencias) ve el de la suya y no el ajeno (404); el Admin técnico (V bitácora) → 403; NC inexistente → 404", hLuis.status === 200 && hLuis.items.length > 0 && hLuis.items.every((i) => i.entidad === "incidencias" && String(i.entidad_id) === String(incLuis)) && hAjena.status === 404 && hJorge.status === 403 && hNo.status === 404 && hPat.items.some((i) => i.accion === "reportar") && hPat.items.every((i) => String(i.entidad_id) === String(incRic)), [hLuis, hAjena, hJorge, hNo, hPat].map((r) => `${r.status}/${r.items.length}`).join(" "));
}

/* =================== Autorización vencida por el barrido (T-31) =================== */
{
  // El barrido corre a lo más una vez por minuto, con cualquier petición: se espera hasta 90 s.
  const vencida = () => fila("SELECT * FROM autorizaciones_personal WHERE id = ?", AUT_VENCIDA);
  const limite = Date.now() + 90_000;
  while (AUT_VENCIDA && !vencida()?.vencimiento_registrado_en && Date.now() < limite) {
    await api("GET", "/autorizaciones/mias", undefined, t.luis);
    await new Promise((r) => setTimeout(r, 3000));
  }
  const a = vencida();
  const aud = a ? fila("SELECT * FROM auditoria WHERE accion = 'vencer_autorizacion' AND entidad = 'usuarios' AND entidad_id = ? AND usuario_id IS NULL ORDER BY id DESC", String(a.usuario_id)) : null;
  const estado = a ? ((await api("GET", `/admin/usuarios/${a.usuario_id}/autorizaciones`, undefined, t.patricia)).data?.items || []).find((x) => Number(x.id) === Number(a.id))?.estado : null;
  check("[cob:C:T-31] autorización con «hasta» anterior a hoy: el barrido la registra una vez (vencimiento_registrado_en), audit «vencer_autorizacion» del sistema con el motivo, y se lista «vencida»", !!a?.vencimiento_registrado_en && !!aud && /Terminó la vigencia/.test(aud.motivo || "") && estado === "vencida", `${a?.vencimiento_registrado_en} ${aud?.id} ${estado}`);
}

terminar();
