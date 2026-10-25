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
import { api, cadena, crearCheck, Database, enDias, fila, filas, hoy, informeLiberado, sesiones } from "./lib/calidad.mjs";

const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const s5 = Date.now().toString(36).slice(-5);
const SIN_APROBAR = { "X-Sin-Aprobar-Auto": "1" };
const SIN_REAUTH = { "X-Sin-Reauth-Auto": "1" };
const NO_EXISTE = 99_999_999;
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
async function cuenta(nombre, extra = {}) {
  const email = `${nombre.toLowerCase().replace(/\s+/g, ".")}.${s5}@ficotox.local`;
  const r = await api("POST", "/admin/usuarios", { nombre: `${nombre} ${s5}`, email, activo: true, rol_id: rolAuxiliar, departamento: "Laboratorio", password: `Temporal-${s5}-2026`, motivo: "Alta de la prueba de cobertura", ...extra }, t.jorge);
  return { id: Number(r.data?.id), email, nombre: `${nombre} ${s5}`, status: r.status };
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
  check("[cob:C:3.8:anular_calidad] anular una incidencia crea anular_calidad que aprueba calidad:AN", solRow(S1)?.tipo === "anular_calidad" && solRow(S1)?.modulo === "calidad", JSON.stringify({ tipo: solRow(S1)?.tipo, modulo: solRow(S1)?.modulo }));
  // Ricardo reportó y quiere evaluar su propia incidencia (regla 7): pide la excepción con un motivo corto.
  const ip = (await reportar(t.ricardo)).data?.id;
  const motivoExc = await api("POST", "/solicitudes", { tipo: "excepcion_segregacion", entidad: "incidencias", entidad_id: ip, accion: "evaluar", motivo: "abc" }, t.ricardo);
  check("[cob:C:V-50] solicitud con motivo de menos de 5 caracteres → 400", !!ip && motivoExc.status === 400 && !fila("SELECT id FROM solicitudes_autorizacion WHERE entidad = 'incidencias' AND entidad_id = ?", String(ip)), det(motivoExc));

  const no = await aprobar(NO_EXISTE, t.ana);
  const luis = await aprobar(S1, t.luis);
  const propia = await aprobar(S1, t.patricia);
  const motivo = await aprobar(S1, t.ana, "ok");
  const sinReauth = await aprobar(S1, t.ana, "Revisado por un segundo usuario", SIN_REAUTH);
  check("[cob:C:V-52] aprobar: inexistente 404; sin el permiso del catálogo (Luis) 403; quien la pidió 409 segregación; motivo corto 400; sin reautenticación 401 solicitudes:aprobar", no.status === 404 && luis.status === 403 && propia.status === 409 && propia.data?.codigo === "segregacion" && motivo.status === 400 && sinReauth.status === 401 && sinReauth.data?.accion === "solicitudes:aprobar" && solRow(S1)?.estado === "pendiente", [no, luis, propia, motivo, sinReauth].map(det).join(" | "));
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
  check("[cob:C:V-52] [cob:C:V-53] [cob:C:3.8:obsoletar_documento] una solicitud de un tipo retirado no se aprueba ni rechaza (410 retirado); quien la pidió sí la cancela", apRet.status === 410 && apRet.data?.codigo === "retirado" && reRet.status === 410 && caRet.status === 200 && solRow(SR)?.estado === "cancelada", `${det(apRet)} | ${det(reRet)} | ${det(caRet)}`);

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
  check("[cob:C:V-53] rechazar: quien la pidió 409 («cancélala»), sin permiso 403, motivo corto 400, sin reautenticación 401 solicitudes:rechazar; con todo 200 y la incidencia no se anula; otra vez 409", rPropia.status === 409 && /cancél/.test(rPropia.data?.message || "") && rLuis.status === 403 && rMotivo.status === 400 && rReauth.status === 401 && rReauth.data?.accion === "solicitudes:rechazar" && rOk.status === 200 && solRow(S4)?.estado === "rechazada" && incRow(IC)?.estado === "reportada" && rOtra.status === 409, [rPropia, rLuis, rMotivo, rReauth, rOk, rOtra].map(det).join(" | "));

  // Cancelar.
  const ID = (await reportar(t.luis)).data?.id;
  const S5 = (await api("POST", `/calidad/incidencias/${ID}/anular`, { motivo: "Se pedirá y se cancelará" }, t.patricia, SIN_APROBAR)).data?.solicitud?.id;
  const cAjena = await cancelar(S5, t.ana);
  const cPropia = await cancelar(S5, t.patricia, {}, SIN_REAUTH);
  const cOtra = await cancelar(S5, t.patricia);
  check("[cob:C:V-54] cancelar: otra persona 403; quien la pidió, sin motivo ni reautenticación, 200 con el motivo por omisión; otra vez 409", cAjena.status === 403 && cPropia.status === 200 && solRow(S5)?.motivo_resolucion === "Cancelada por quien la solicitó" && cOtra.status === 409 && incRow(ID)?.estado === "reportada", [cAjena, cPropia, cOtra].map(det).join(" | "));

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
  check("[cob:C:V-14] crear una NC sin calidad:R ni G (Coord. Investigación, Técnico Analista, Auditor) → 403", g.status === 403 && l.status === 403 && h.status === 403 && deMarca() === 0, [g, l, h].map(det).join(" | "));
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
  const luis = await api("POST", `/calidad/nc/${NS}/suspensiones`, { tipo: "equipo", clave: String(EQ), motivo: "Luis intenta suspender" }, t.luis);
  const metodo = await api("POST", `/calidad/nc/${NS}/suspensiones`, { tipo: "metodo", clave: "XYZ", motivo: "Método fuera del catálogo" }, t.patricia);
  const tipo = await api("POST", `/calidad/nc/${NS}/suspensiones`, { tipo: "reactivo", clave: "1", motivo: "Tipo fuera del catálogo" }, t.patricia);
  const equipoNo = await api("POST", `/calidad/nc/${NS}/suspensiones`, { tipo: "equipo", clave: String(NO_EXISTE), motivo: "Equipo que no existe" }, t.patricia);
  const motivo = await api("POST", `/calidad/nc/${NS}/suspensiones`, { tipo: "equipo", clave: String(EQ), motivo: "no" }, t.patricia);
  const suspende = await api("POST", `/calidad/nc/${NS}/suspensiones`, { tipo: "equipo", clave: String(EQ), motivo: "Equipo en duda por la prueba de cobertura" }, t.patricia);
  const dos = await api("POST", `/calidad/nc/${NS}/suspensiones`, { tipo: "equipo", clave: String(EQ), motivo: "Otra vez el mismo equipo" }, t.patricia);
  const SU = fila("SELECT id FROM suspensiones WHERE nc_id = ? AND reanudada_en IS NULL", NS)?.id;
  check("[cob:C:V-44] suspender: sin calidad:R → 403; método fuera de catálogo o tipo inválido → 400; equipo inexistente → 404; motivo < 5 → 400; ya suspendido por la NC → 409 ya_suspendido", luis.status === 403 && metodo.status === 400 && tipo.status === 400 && equipoNo.status === 404 && motivo.status === 400 && suspende.status === 201 && dos.status === 409 && dos.data?.codigo === "ya_suspendido" && !!SU && fila("SELECT estado FROM equipos WHERE id = ?", EQ)?.estado === "fuera_servicio", [luis, metodo, tipo, equipoNo, motivo, suspende, dos].map(det).join(" | "));
  const efecto = await cadena(t, "COBSUS", { equipos: [{ equipo_id: EQ, uso: "Centrifugación", folio_bitacora: `SUS-${s5}` }] });
  check("[cob:C:3.5:efecto] usar el equipo suspendido en una extracción → 409 suspendido (no se crea)", efecto.extraccion.status === 409 && efecto.extraccion.data?.codigo === "suspendido" && !efecto.E, det(efecto.extraccion));
  const cerrarS = await api("POST", `/calidad/nc/${NS}/cerrar`, { conclusion: "Cierre con suspensión activa" }, t.ana);
  const anularS = await api("POST", `/calidad/nc/${NS}/anular`, { motivo: "Anular con suspensión activa" }, t.ana, SIN_APROBAR);
  check("[cob:C:V-46] [cob:C:V-47] con una suspensión activa no se cierra (409 suspensiones_activas) ni se anula (409 bloqueos_activos)", cerrarS.status === 409 && cerrarS.data?.codigo === "suspensiones_activas" && anularS.status === 409 && anularS.data?.codigo === "bloqueos_activos", `${det(cerrarS)} | ${det(anularS)}`);
  const ricardo = await api("POST", `/calidad/suspensiones/${SU}/reanudar`, { motivo: "Ricardo intenta reanudar" }, t.ricardo);
  const quien = await api("POST", `/calidad/suspensiones/${SU}/reanudar`, { motivo: "Patricia reanuda lo que suspendió" }, t.patricia);
  const corto = await api("POST", `/calidad/suspensiones/${SU}/reanudar`, { motivo: "no" }, t.ana);
  const sinReauth = await api("POST", `/calidad/suspensiones/${SU}/reanudar`, { motivo: "Equipo verificado de nuevo" }, t.ana, SIN_REAUTH);
  const reanuda = await api("POST", `/calidad/suspensiones/${SU}/reanudar`, { motivo: "Equipo verificado de nuevo" }, t.ana);
  const otraVez = await api("POST", `/calidad/suspensiones/${SU}/reanudar`, { motivo: "Equipo verificado de nuevo" }, t.ana);
  check("[cob:C:V-45] reanudar: sin calidad:A → 403; quien suspendió → 409 segregación (regla 10); motivo < 5 → 400; sin reautenticación → 401 calidad:A; con todo 200 y el equipo vuelve a operativo; otra vez → 409", ricardo.status === 403 && quien.status === 409 && quien.data?.codigo === "segregacion" && corto.status === 400 && sinReauth.status === 401 && sinReauth.data?.accion === "calidad:A" && reanuda.status === 200 && otraVez.status === 409 && fila("SELECT estado FROM equipos WHERE id = ?", EQ)?.estado === "operativo", [ricardo, quien, corto, sinReauth, reanuda, otraVez].map(det).join(" | "));
  const cerrarYa = await api("POST", `/calidad/nc/${NS}/cerrar`, { conclusion: "Equipo reanudado y verificado" }, t.ana);
  check("[cob:C:V-46] …ya reanudada, la NC se cierra", cerrarYa.status === 200, det(cerrarYa));

  // Retención de un informe propio.
  const inf = await informeLiberado(t, "COBRET");
  const NR = await nuevaNc("NC con retención");
  await api("PUT", `/calidad/nc/${NR}`, SIN_ACCION, t.ana);
  const ret = await api("POST", `/calidad/nc/${NR}/retenciones`, { informe_id: inf.informe, motivo: "Resultados en duda en la prueba de cobertura" }, t.ana);
  const RET = fila("SELECT id FROM retenciones_informe WHERE nc_id = ? AND liberada_en IS NULL", NR)?.id;
  check("(preparación) informe propio liberado y retenido por la NC", inf.liberado && ret.status === 201 && !!RET, `${inf.liberado} ${det(ret)}`);
  const cerrarR = await api("POST", `/calidad/nc/${NR}/cerrar`, { conclusion: "Cierre con retención activa" }, t.patricia);
  const anularR = await api("POST", `/calidad/nc/${NR}/anular`, { motivo: "Anular con retención activa" }, t.patricia, SIN_APROBAR);
  check("[cob:C:V-46] [cob:C:V-47] con una retención activa no se cierra (409 retenciones_activas) ni se anula (409 bloqueos_activos)", cerrarR.status === 409 && cerrarR.data?.codigo === "retenciones_activas" && anularR.status === 409 && anularR.data?.codigo === "bloqueos_activos", `${det(cerrarR)} | ${det(anularR)}`);
  const lRicardo = await api("POST", `/calidad/retenciones/${RET}/liberar`, { motivo: "Ricardo intenta liberar" }, t.ricardo);
  const lNo = await api("POST", `/calidad/retenciones/${NO_EXISTE}/liberar`, { motivo: "Retención que no existe" }, t.ana);
  const lCorto = await api("POST", `/calidad/retenciones/${RET}/liberar`, { motivo: "no" }, t.ana);
  const lReauth = await api("POST", `/calidad/retenciones/${RET}/liberar`, { motivo: "Resultados confirmados" }, t.ana, SIN_REAUTH);
  const libera = await api("POST", `/calidad/retenciones/${RET}/liberar`, { motivo: "Resultados confirmados" }, t.ana);
  const lOtra = await api("POST", `/calidad/retenciones/${RET}/liberar`, { motivo: "Resultados confirmados" }, t.ana);
  check("[cob:C:V-43] liberar retención: sin calidad:A → 403; inexistente → 404; motivo < 5 → 400; sin reautenticación → 401 calidad:A; con todo 200; ya liberada → 409", lRicardo.status === 403 && lNo.status === 404 && lCorto.status === 400 && lReauth.status === 401 && lReauth.data?.accion === "calidad:A" && libera.status === 200 && lOtra.status === 409 && !!fila("SELECT liberada_en FROM retenciones_informe WHERE id = ?", RET)?.liberada_en, [lRicardo, lNo, lCorto, lReauth, libera, lOtra].map(det).join(" | "));
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
  check("[cob:C:3.8:anular_informe] anular un informe liberado: solicitud que aprueba informes:AN (sin él → 403; la Responsable General 200)", pideInf.status === 202 && solRow(SI)?.tipo === "anular_informe" && solRow(SI)?.modulo === "informes" && gab.status === 403 && pat.status === 200 && fila("SELECT estado FROM informes WHERE id = ?", inf.informe)?.estado === "anulado", [pideInf, gab, pat].map(det).join(" | "));
}

/* =================== Autorizaciones FX-THF-AP (V-55, V-56, GET /autorizaciones/personas) =================== */
{
  const CU = await cuenta("Cobertura Autorizada");
  const pLuis = await api("GET", "/autorizaciones/personas", undefined, t.luis);
  const pRicardo = await api("GET", "/autorizaciones/personas", undefined, t.ricardo);
  const pAna = await api("GET", "/autorizaciones/personas", undefined, t.ana);
  const items = pRicardo.data?.items || [];
  check("[cob:C:P-autorizaciones-personas] GET /autorizaciones/personas: sin ensayos:A ni calidad:A → 403; con ensayos:A (Ricardo) o calidad:A (Ana) 200, solo cuentas activas y sin uno mismo", pLuis.status === 403 && pRicardo.status === 200 && pAna.status === 200 && items.some((p) => p.id === CU.id) && !items.some((p) => p.id === id.ricardo) && items.every((p) => Number(fila("SELECT activo FROM usuarios WHERE id = ?", p.id)?.activo) === 1), `${pLuis.status} ${pRicardo.status} ${pAna.status} ${items.length}`);
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
  check("[cob:C:V-55] con todo 201; la misma ya vigente o por iniciar → 409", ok.status === 201 && dup.status === 409 && futura.status === 201 && dupFutura.status === 409 && otorgadas() === 2, [ok, dup, futura, dupFutura].map(det).join(" | "));
  const AU = ok.data?.item?.id || fila("SELECT id FROM autorizaciones_personal WHERE usuario_id = ? AND clave = 'recepcion'", CU.id)?.id;
  const rv = (aid, motivo, token = t.patricia, headers = {}) => api("POST", `/admin/usuarios/${CU.id}/autorizaciones/${aid}/revocar`, { motivo }, token, headers);
  const vNo = await rv(NO_EXISTE, "Autorización que no existe");
  const vCorto = await rv(AU, "no");
  const vReauth = await rv(AU, "Ya no realiza recepciones", t.patricia, SIN_REAUTH);
  const vOk = await rv(AU, "Ya no realiza recepciones");
  const vOtra = await rv(AU, "Ya no realiza recepciones");
  check("[cob:C:V-56] revocar: inexistente → 404; motivo < 5 → 400; sin reautenticación → 401 autorizaciones:revocar; con todo 200; ya revocada → 409", vNo.status === 404 && vCorto.status === 400 && vReauth.status === 401 && vReauth.data?.accion === "autorizaciones:revocar" && vOk.status === 200 && vOtra.status === 409 && !!fila("SELECT revocada_en FROM autorizaciones_personal WHERE id = ?", AU)?.revocada_en, [vNo, vCorto, vReauth, vOk, vOtra].map(det).join(" | "));
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
  check("[cob:C:3.8:anular_registro] anular una recepción aceptada: solicitud que aprueba muestras:AN (Luis → 403; la Responsable General 200)", an.ok && anLuis.status === 403 && anPat.status === 200 && !!estadoR()?.anulado_en, `${an.txt} | ${det(anLuis)} | ${det(anPat)}`);
  const re = catalogo("restaurar_registro", await api("POST", `/samples/reception/${R}/restaurar`, { motivo: "Se anuló por error" }, t.qa, SIN_APROBAR), "muestras");
  const reLuis = await aprobar(re.S, t.luis);
  const rePat = await aprobar(re.S, t.patricia);
  check("[cob:C:3.8:restaurar_registro] restaurarla: solicitud que aprueba muestras:AN (Luis → 403; la Responsable General 200)", re.ok && reLuis.status === 403 && rePat.status === 200 && !estadoR()?.anulado_en, `${re.txt} | ${det(reLuis)} | ${det(rePat)}`);

  // decision_recepcion, reabrir_recepcion y cambiar_folio: los pide la Técnico Auxiliar (sin muestras:A).
  const idM = `COB-DR-${s5}`;
  const dr = await api("POST", "/samples/reception", recepcion(idM, { recibido_por: "Mariana", decision_aceptacion: "rechazada", aceptacion: { fecha: "2026-09-20", responsable: "Mariana", comunicacion_cliente: { fecha: "2026-09-20", medio: "correo" } } }), t.mariana, SIN_APROBAR);
  const RM = dr.data?.id;
  const d = catalogo("decision_recepcion", dr, "muestras");
  const dLuis = await aprobar(d.S, t.luis);
  const dRic = await aprobar(d.S, t.ricardo);
  check("[cob:C:3.8:decision_recepcion] rechazo de una recepción sin muestras:A: solicitud que aprueba muestras:A (Luis → 403; la Coord. Área Técnica 200)", d.ok && dLuis.status === 403 && dRic.status === 200 && fila("SELECT estado FROM muestras_recepcion WHERE id = ?", RM)?.estado === "rechazada", `${d.txt} | ${det(dLuis)} | ${det(dRic)}`);
  const rb = catalogo("reabrir_recepcion", await api("POST", `/samples/reception/${RM}/reabrir`, { motivo: "El cliente envió la documentación" }, t.mariana, SIN_APROBAR), "muestras");
  const rbLuis = await aprobar(rb.S, t.luis);
  const rbRic = await aprobar(rb.S, t.ricardo);
  check("[cob:C:3.8:reabrir_recepcion] reabrirla: solicitud que aprueba muestras:A (Luis → 403; Ricardo 200)", rb.ok && rbLuis.status === 403 && rbRic.status === 200 && fila("SELECT estado FROM muestras_recepcion WHERE id = ?", RM)?.estado !== "rechazada", `${rb.txt} | ${det(rbLuis)} | ${det(rbRic)}`);
  const folio = Number(fila("SELECT folio_num FROM muestras_recepcion WHERE id = ?", RM)?.folio_num);
  const cf = catalogo("cambiar_folio", await api("POST", `/samples/reception/${RM}/folio`, { folio_num: folio + 700000, motivo: "Folio duplicado en papel" }, t.mariana, SIN_APROBAR), "muestras");
  const cfLuis = await aprobar(cf.S, t.luis);
  const cfRic = await rechazar(cf.S, t.ricardo, "El folio actual es correcto");
  check("[cob:C:3.8:cambiar_folio] cambiar el folio: solicitud que resuelve muestras:A (Luis → 403; Ricardo la rechaza y el folio no cambia)", cf.ok && cfLuis.status === 403 && cfRic.status === 200 && Number(fila("SELECT folio_num FROM muestras_recepcion WHERE id = ?", RM)?.folio_num) === folio, `${cf.txt} | ${det(cfLuis)} | ${det(cfRic)}`);

  // Administración: asignar_rol, ampliar_permisos_rol, reactivar_cuenta y ampliar_vigencia sobre cuentas y roles propios.
  const C1 = await cuenta("Cobertura Roles");
  const rolVacio = (await api("POST", "/admin/roles", { nombre: `Consulta cobertura 2 ${s5}`, motivo: "Rol de la prueba de cobertura", permisos: [] }, t.jorge)).data?.id;
  const ar = catalogo("asignar_rol", await api("POST", `/admin/usuarios/${C1.id}/roles`, { rol_id: rolVacio, motivo: "Rol adicional de la prueba" }, t.jorge, SIN_APROBAR), "usuarios");
  const arLuis = await aprobar(ar.S, t.luis);
  const arPat = await aprobar(ar.S, t.patricia);
  check("[cob:C:3.8:asignar_rol] asignar un rol: solicitud que aprueba usuarios:A (Luis → 403; la Responsable General 200)", ar.ok && arLuis.status === 403 && arPat.status === 200 && !!fila("SELECT id FROM usuario_roles WHERE usuario_id = ? AND rol_id = ? AND revocado_en IS NULL", C1.id, rolVacio), `${ar.txt} | ${det(arLuis)} | ${det(arPat)}`);
  const rolNuevo = await api("POST", "/admin/roles", { nombre: `Rol con permiso cobertura ${s5}`, motivo: "Rol con un permiso de la prueba de cobertura", permisos: [{ modulo: "calidad", accion: "C" }] }, t.jorge, SIN_APROBAR);
  const ap = catalogo("ampliar_permisos_rol", rolNuevo, "usuarios");
  const apLuis = await aprobar(ap.S, t.luis);
  const apPat = await aprobar(ap.S, t.patricia);
  check("[cob:C:3.8:ampliar_permisos_rol] ampliar permisos de un rol: solicitud que aprueba usuarios:A (Luis → 403; la Responsable General 200)", ap.ok && apLuis.status === 403 && apPat.status === 200 && Number(fila("SELECT COUNT(*) AS n FROM rol_acciones WHERE id_rol = ?", rolNuevo.data?.id)?.n) >= 1, `${ap.txt} | ${det(apLuis)} | ${det(apPat)}`);
  const C2 = await cuenta("Cobertura Reactivar");
  await api("DELETE", `/admin/usuarios/${C2.id}`, { motivo: "Baja previa a la reactivación" }, t.jorge);
  const rc = catalogo("reactivar_cuenta", await api("PUT", `/admin/usuarios/${C2.id}`, datosCuenta(C2, { activo: true, motivo_estado: "Regresa al laboratorio" }), t.jorge, SIN_APROBAR), "usuarios");
  const rcLuis = await aprobar(rc.S, t.luis);
  const rcPat = await aprobar(rc.S, t.patricia);
  check("[cob:C:3.8:reactivar_cuenta] reactivar una cuenta: solicitud que aprueba usuarios:A (Luis → 403; la Responsable General 200)", rc.ok && rcLuis.status === 403 && rcPat.status === 200 && Number(fila("SELECT activo FROM usuarios WHERE id = ?", C2.id)?.activo) === 1, `${rc.txt} | ${det(rcLuis)} | ${det(rcPat)}`);
  const C3 = await cuenta("Cobertura Vigencia");
  ejecutar("UPDATE usuarios SET vigente_hasta = ? WHERE id = ?", enDias(10), C3.id);
  const av = catalogo("ampliar_vigencia", await api("PUT", `/admin/usuarios/${C3.id}`, datosCuenta(C3, { vigente_hasta: enDias(60), motivo_cuenta: "Se renueva su contrato" }), t.jorge, SIN_APROBAR), "usuarios");
  const avLuis = await aprobar(av.S, t.luis);
  const avPat = await aprobar(av.S, t.patricia);
  check("[cob:C:3.8:ampliar_vigencia] ampliar la vigencia: solicitud que aprueba usuarios:A (Luis → 403; la Responsable General 200)", av.ok && avLuis.status === 403 && avPat.status === 200 && fila("SELECT vigente_hasta AS h FROM usuarios WHERE id = ?", C3.id)?.h === enDias(60), `${av.txt} | ${det(avLuis)} | ${det(avPat)}`);
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

/* =================== Bitácora: filtros (5.1) =================== */
{
  const lista = async (q, token = t.patricia) => {
    const r = await api("GET", `/audit?${q}`, undefined, token);
    return { status: r.status, items: r.data?.items || [], truncado: r.data?.truncado, data: r.data };
  };
  const unaAccion = await lista("accion=reportar&limit=50");
  check("[cob:C:A-accion] accion=reportar → solo esa acción", unaAccion.status === 200 && unaAccion.items.length > 0 && unaAccion.items.every((i) => i.accion === "reportar"), `${unaAccion.status} ${unaAccion.items.length}`);
  const varias = await lista("acciones=reportar,escalar,DROP%20TABLE&limit=100");
  check("[cob:C:A-acciones] acciones=reportar,escalar (lo que no cumple ^[a-z_]{2,40}$ se ignora) → solo esas acciones", varias.status === 200 && varias.items.length > 0 && varias.items.every((i) => ["reportar", "escalar"].includes(i.accion)), `${varias.items.length} ${[...new Set(varias.items.map((i) => i.accion))].join(",")}`);
  const falsas = (n) => Array.from({ length: n }, (_, i) => `zz_${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`);
  const tope80 = await lista(`acciones=${[...falsas(80), "reportar"].join(",")}&limit=20`);
  const tope79 = await lista(`acciones=${[...falsas(79), "reportar"].join(",")}&limit=20`);
  check("[cob:C:A-acciones] la lista se corta en 80 acciones (la 81.ª no cuenta)", tope80.status === 200 && tope80.items.length === 0 && tope79.items.length > 0, `${tope80.items.length} ${tope79.items.length}`);
  const usuario = await lista("usuario=luis.castro&limit=50");
  check("[cob:C:A-usuario] usuario=luis.castro (LIKE sobre nombre o correo) → solo sus entradas", usuario.items.length > 0 && usuario.items.every((i) => /luis\.castro/i.test(`${i.usuario_email} ${i.usuario_nombre}`)), `${usuario.items.length}`);
  const usuarios = await lista(`usuarios=${encodeURIComponent("luis.castro@ficotox.local,ana.torres@ficotox.local")}&limit=80`);
  const parcial = await lista("usuarios=luis.castro&limit=5");
  check("[cob:C:A-usuarios] usuarios=<correos exactos> → solo esas cuentas; un correo parcial no coincide", usuarios.items.length > 0 && usuarios.items.every((i) => [id.luis, id.ana].includes(Number(i.usuario_id))) && parcial.items.length === 0, `${usuarios.items.length} ${parcial.items.length}`);
  const entidades = await lista("entidades=no_conformidades,incidencias&limit=80");
  check("[cob:C:A-entidades] entidades=no_conformidades,incidencias → solo esos registros", entidades.items.length > 0 && entidades.items.every((i) => ["no_conformidades", "incidencias"].includes(i.entidad)), `${entidades.items.length}`);
  const modulo = await lista("modulo=calidad&limit=80");
  check("[cob:C:A-modulo] modulo=calidad → solo entidades de calidad", modulo.items.length > 0 && modulo.items.every((i) => ["incidencias", "no_conformidades", "acciones_correctivas", "suspensiones"].includes(i.entidad)), `${modulo.items.length} ${[...new Set(modulo.items.map((i) => i.entidad))].join(",")}`);
  const marcaSusp = `Equipo en duda por la prueba de cobertura`;
  const rolMotivo = "Rol de la prueba de cobertura";
  const sPat = await lista(`search=${encodeURIComponent(marcaSusp)}&limit=20`);
  const sJorge = await lista(`search=${encodeURIComponent(marcaSusp)}&limit=20`, t.jorge);
  const sJorgeRol = await lista(`search=${encodeURIComponent(rolMotivo)}&limit=20`, t.jorge);
  check("[cob:C:A-search] search busca en el motivo; el motivo de una suspensión de calidad lo encuentra quien tiene calidad:V total y no el Admin técnico (V bitácora), que sí encuentra un motivo de Administración", sPat.items.some((i) => i.accion === "suspender") && sJorge.status === 200 && sJorge.items.length === 0 && sJorgeRol.items.some((i) => i.entidad === "roles"), `${sPat.items.length} ${sJorge.status}/${sJorge.items.length} ${sJorgeRol.items.length}`);
  const dia = hoy();
  const local = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana" }).format(new Date(iso));
  const deHoy = await lista(`desde=${dia}&hasta=${dia}&usuarios=${encodeURIComponent("luis.castro@ficotox.local")}&limit=50`);
  const pasado = await lista("hasta=2020-01-01&limit=5");
  const futuro = await lista("desde=2099-01-01&limit=5");
  check("[cob:C:A-desde-hasta] desde=hasta=hoy (sin hora: el día local completo) → solo entradas de hoy, incluida la más reciente; hasta 2020 o desde 2099 → nada", deHoy.items.length > 0 && deHoy.items.every((i) => local(i.fecha_hora) === dia) && pasado.items.length === 0 && futuro.items.length === 0, `${deHoy.items.length} ${pasado.items.length} ${futuro.items.length}`);
  const cero = await lista("limit=-5");
  const mucho = await lista("limit=5000");
  const omision = await lista("");
  check("[cob:C:A-limit] limit se acota a 1–1000 (-5 → 1, 5000 → ≤ 1000) y por omisión es 200", cero.items.length === 1 && mucho.items.length <= 1000 && (mucho.items.length > 200 || !mucho.truncado) && (omision.items.length === 200 ? omision.truncado === true : omision.items.length < 200), `${cero.items.length} ${mucho.items.length} ${omision.items.length} ${omision.truncado}`);
  const p1 = await lista("limit=5");
  const ultimo = p1.items.at(-1)?.id;
  const p2 = await lista(`limit=5&antes_de=${ultimo}`);
  check("[cob:C:A-antes_de] antes_de=<id> pagina: la página siguiente trae solo ids menores, sin repetir", p1.items.length === 5 && p2.items.length > 0 && p2.items.every((i) => Number(i.id) < Number(ultimo)) && !p2.items.some((i) => p1.items.some((j) => j.id === i.id)), `${ultimo} ${p2.items.map((i) => i.id).join(",")}`);
  const conAccesos = await lista("acciones=login,reportar&limit=100");
  const sinAccesos = await lista("acciones=login,reportar&sin_accesos=1&limit=100");
  check("[cob:C:A-sin_accesos] sin_accesos=1 quita login (y fallidos, reauth fallida, cerrar sesiones)", conAccesos.items.some((i) => i.accion === "login") && sinAccesos.items.length > 0 && !sinAccesos.items.some((i) => ["login", "login_fallido", "reauth_fallida", "cerrar_sesiones"].includes(i.accion)), `${conAccesos.items.length} ${sinAccesos.items.length}`);
  const csv = await api("GET", "/audit?formato=csv", undefined, t.patricia);
  check("[cob:C:A-formato] formato=csv (exportación retirada) → 410", csv.status === 410, `${csv.status}`);
}

terminar();
