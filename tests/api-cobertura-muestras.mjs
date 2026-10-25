/*
 * Cobertura de la matriz · Muestras e Informes (API). Cada check lleva la etiqueta
 * [cob:M:<id>] del renglón de la matriz que prueba (validaciones, transiciones y
 * permisos por endpoint que no tenían prueba automática). Datos propios con sello
 * único; las solicitudes que quedan pendientes se cancelan al final de cada bloque.
 */
import "./lib/reauth-auto.mjs";
import { existsSync, renameSync } from "node:fs";
import path from "node:path";
import { analisisDe, api, BASE, cadena, crearCheck, Database, fila, filas, informeLiberado, sesiones } from "./lib/calidad.mjs";
import { pdfDePrueba } from "./lib/evidencia.mjs";
import { registrarEnvio } from "./lib/envio.mjs";

const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const s5 = Date.now().toString(36).slice(-5);
const SIN_APROBAR = { "X-Sin-Aprobar-Auto": "1" };
const SIN_REAUTH = { "X-Sin-Reauth-Auto": "1" };
const SIN_EVIDENCIA = { "X-Sin-Evidencia-Auto": "1" };
const ejecutar = (sql, ...p) => {
  const b = new Database(process.env.TEST_DB_PATH);
  try {
    b.prepare(sql).run(...p);
  } finally {
    b.close();
  }
};
let n = 0;
const sello = () => `COB-${s5}-${(n += 1)}`;
const insp = (estados = {}) => ({ checklist: Array.from({ length: 7 }, (_, i) => ({ requisito: `Requisito ${i + 1}`, estado: i in estados ? estados[i] : i === 6 ? "NA" : "C", observacion: null })), observaciones_generales: null });
const ACEPTACION = { fecha: "2026-09-20", responsable: "QA", comunicacion_cliente: { medio: "correo", fecha: "2026-09-20", persona: "Cliente", respuesta: "Enterado; que continúe" } };
const datosR = (idInt, extra = {}) => ({ fecha_recepcion: "2026-09-20", hora_recepcion: "09:00", recibido_por: "QA", medio_recepcion: "directa", solicitante: `Cliente cobertura ${idInt}`, muestra_unica: true, id_interno: idInt, fecha_muestra: "2026-09-19", analisis: { tipos: ["toxinas_lipofilicas"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] }, inspeccion: insp(), ...extra });
const nuevaR = async (token = t.qa, extra = {}, headers = {}) => {
  const idInt = sello();
  const r = await api("POST", "/samples/reception", datosR(idInt, extra), token, headers);
  return { ...r, R: r.data?.id, idInt };
};
const rec = (rid) => fila("SELECT * FROM muestras_recepcion WHERE id = ?", rid);
const putR = (rid, idInt, extra = {}, token = t.qa, headers = {}) => api("PUT", `/samples/reception/${rid}`, { ...datosR(idInt), folio_num: rec(rid)?.folio_num, ...extra }, token, headers);
const datosP = (R, idInt, extra = {}) => ({ recepcion_id: R, muestra_tipo: "unica", id_interno: idInt, fecha_procesamiento: "2026-09-20", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "Persona A", nombre_quien_superviso: "Persona B", ...extra });
const datosE = (P, idInt, extra = {}) => ({ tipo_registro: "E-D", procesamiento_id: P, tipo_molienda: "fresca", id_interno: idInt, fecha_extraccion: "2026-09-20", registro_pesos: [{ id_muestra: idInt, replica: `${idInt}_R1`, peso_muestra: 2.01 }], nombre_quien_extrajo: "Persona A", nombre_quien_superviso: "Persona B", ...extra });
const pendiente = (entidad, entidadId) => fila("SELECT * FROM solicitudes_autorizacion WHERE entidad = ? AND entidad_id = ? AND estado = 'pendiente' ORDER BY id DESC", entidad, String(entidadId));
const cancelar = async (entidad, entidadId) => {
  const p = pendiente(entidad, entidadId);
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
const estadoA = (A) => fila("SELECT estado FROM muestras_analisis WHERE id = ?", A)?.estado;
const sinFila = (r) => `${r.status} ${r.data?.codigo || ""} ${r.data?.message || ""}`.trim();

/* Cuentas propias de la prueba: un rol con ensayos pero sin inventario ni equipos, una temporal supervisada por Jorge y una para bloquear. */
const PASS = "Cobertura-Muestras-2026";
const roles = (await api("GET", "/admin/roles", undefined, t.qa)).data?.items || [];
const rolAuxiliar = roles.find((r) => r.nombre === "Técnico Auxiliar")?.id;
const rolEnsayos = await api("POST", "/admin/roles", { nombre: `Cobertura ensayos ${s5}`, descripcion: "Ensayos sin inventario ni equipos (prueba de cobertura)", activo: true, permisos: [{ modulo: "muestras", accion: "V", alcance: "total" }, { modulo: "ensayos", accion: "V", alcance: "total" }, { modulo: "ensayos", accion: "C", alcance: "total" }, { modulo: "ensayos", accion: "E", alcance: "total" }], motivo: "Rol de la prueba de cobertura" }, t.qa);
const alta = async (nombre, extra = {}, headers = {}) => {
  const email = `${nombre}.${s5}@ficotox.local`;
  const r = await api("POST", "/admin/usuarios", { nombre: `${nombre} ${s5}`, email, activo: true, password: PASS, departamento: "Laboratorio", motivo: "Alta de la prueba de cobertura", ...extra }, t.qa, headers);
  return { id: Number(r.data?.id) || Number(fila("SELECT id FROM usuarios WHERE email = ?", email)?.id), email, status: r.status };
};
// Supervisor válido (R en muestras) que no ve ensayos.
const rolSupervisor = await api("POST", "/admin/roles", { nombre: `Cobertura supervisa muestras ${s5}`, descripcion: "Revisa muestras, sin ensayos (prueba de cobertura)", activo: true, permisos: [{ modulo: "muestras", accion: "V", alcance: "total" }, { modulo: "muestras", accion: "R", alcance: "total" }], motivo: "Rol de la prueba de cobertura" }, t.qa);
const supervisor = await alta("cob.supervisor", { rol_id: rolSupervisor.data?.id });
const temporal = await alta("cob.temporal", { rol_id: rolEnsayos.data?.id, tipo_cuenta: "temporal", vigente_hasta: "2027-06-30", supervisor_id: supervisor.id, motivo_cuenta: "Estancia de la prueba de cobertura" });
const sinRoles = await alta("cob.sinroles", { rol_id: rolAuxiliar }, SIN_APROBAR);
const bloqueada = await alta("cob.bloqueo", { rol_id: rolAuxiliar });
const inactiva = await alta("cob.inactiva", { rol_id: rolAuxiliar });
const baja = await api("DELETE", `/admin/usuarios/${inactiva.id}`, { motivo: "Baja previa de la prueba de cobertura" }, t.jorge);
for (const [tipo, clave] of [["actividad", "procesamiento"], ["actividad", "extraccion"], ["metodo", "DSP"]]) await api("POST", `/admin/usuarios/${temporal.id}/autorizaciones`, { tipo, clave, folio_fx_thf_ap: "FX-THF-AP-COBERTURA", motivo: "Autorización de la prueba de cobertura" }, t.ricardo);
const login = async (email) => (await api("POST", "/auth/login", { email, password: PASS })).data?.token;
const tTemp = await login(temporal.email);
const tSin = await login(sinRoles.email);
const tSup = await login(supervisor.email);
check("(preparación) rol y cuentas propias", rolEnsayos.status === 201 && rolSupervisor.status === 201 && !!tSup && temporal.id > 0 && !!tTemp && !!tSin && bloqueada.id > 0 && baja.status === 200, `${rolEnsayos.status} ${rolSupervisor.status} ${supervisor.status} ${temporal.status} ${!!tTemp} ${!!tSin} ${bloqueada.status} ${baja.status} ${baja.data?.message || ""}`);

/* ================= Recepción: validaciones (V-REC) ================= */
{
  const a = await nuevaR();
  check("[cob:M:V-01] recepción sin folio en POST → folio siguiente (MAX + 1)", a.status === 201 && Number(rec(a.R)?.folio_num) > 0, sinFila(a));
  const sinFolio = await putR(a.R, a.idInt, { folio_num: null });
  check("[cob:M:V-01] editar la recepción sin folio → 400 «El folio es obligatorio»", sinFolio.status === 400 && /folio es obligatorio/i.test(sinFolio.data?.message || ""), sinFila(sinFolio));
  const dup = await api("POST", "/samples/reception", { ...datosR(sello()), folio_num: rec(a.R).folio_num }, t.qa);
  check("[cob:M:V-02] folio de recepción repetido → 409 «El folio ya existe»", dup.status === 409 && /ya existe/i.test(dup.data?.message || ""), sinFila(dup));
  const folioAntes = Number(rec(a.R).folio_num);
  const otro = await putR(a.R, a.idInt, { folio_num: folioAntes + 100000 });
  check("[cob:M:V-03] editar con otro folio → 409 folio_bloqueado (el folio no cambió)", otro.status === 409 && otro.data?.codigo === "folio_bloqueado" && Number(rec(a.R).folio_num) === folioAntes, sinFila(otro));
  // Reglas solo del formulario: el servidor no las exige (ver DUDA en el reporte).
  const futura = await nuevaR(t.qa, { fecha_muestra: "2026-09-25", fecha_recepcion: "2026-09-20" });
  check("[cob:M:V-06] fecha de muestreo posterior a la recepción: el servidor la acepta (regla solo del formulario)", futura.status === 201, sinFila(futura));
  const sinId = await api("POST", "/samples/reception", { ...datosR(""), id_interno: null, analisis: { tipos: [], metodos: [], tipos_muestra: [] } }, t.qa);
  check("[cob:M:V-07] [cob:M:V-08] sin ID interno ni tipo de análisis: el servidor lo acepta (reglas solo del formulario)", sinId.status === 201, sinFila(sinId));
  const sinDatos = await nuevaR(t.qa, { decision_aceptacion: "aceptada", aceptacion: { fecha: null, responsable: null }, datos_solicitante: {}, datos_custodio: {} });
  check("[cob:M:V-12] [cob:M:V-15] [cob:M:V-16] decisión sin fecha/responsable y sin entrega ni custodio: el servidor lo acepta (reglas solo del formulario)", sinDatos.status === 201 && rec(sinDatos.R)?.estado === "aceptada", sinFila(sinDatos));
  const incompleta = await nuevaR(t.qa, { inspeccion: insp({ 3: "" }), decision_aceptacion: "aceptada", aceptacion: ACEPTACION });
  check("[cob:M:V-09] decisión con la inspección incompleta → 400", incompleta.status === 400 && /inspeccion visual/i.test(incompleta.data?.message || ""), sinFila(incompleta));
  const conNc = await nuevaR(t.qa, { inspeccion: insp({ 0: "NC" }), decision_aceptacion: "aceptada", aceptacion: ACEPTACION });
  check("[cob:M:V-10] con un requisito NC no se acepta sin desviación → 400", conNc.status === 400 && /NC/.test(conNc.data?.message || ""), sinFila(conNc));
  const sinCom = await nuevaR(t.ricardo, { inspeccion: insp({ 0: "NC" }), decision_aceptacion: "aceptada_con_desviacion", aceptacion: { fecha: "2026-09-20", responsable: "QA" } });
  check("[cob:M:V-11] desviación sin la comunicación al cliente (fecha y medio) → 400", sinCom.status === 400 && /comunicacion al cliente/i.test(sinCom.data?.message || ""), sinFila(sinCom));
  const acep = await nuevaR(t.qa, { decision_aceptacion: "aceptada", aceptacion: ACEPTACION });
  const quitar = await putR(acep.R, acep.idInt, { decision_aceptacion: null });
  check("[cob:M:V-13] quitar una decisión ya registrada → 409 decision_registrada", quitar.status === 409 && quitar.data?.codigo === "decision_registrada" && rec(acep.R).estado === "aceptada", sinFila(quitar));
  const solicita = await nuevaR(t.mariana, { inspeccion: insp({ 0: "NC" }), decision_aceptacion: "rechazada", aceptacion: ACEPTACION }, SIN_APROBAR);
  check("[cob:M:V-14] rechazo sin muestras:A → 201 con solicitud decision_recepcion; la decisión no se guarda", solicita.status === 201 && solicita.data?.codigo === "solicitud_creada" && solicita.data?.solicitud?.tipo === "decision_recepcion" && !rec(solicita.R)?.decision_aceptacion && rec(solicita.R)?.estado === "registrada", sinFila(solicita));
  await cancelar("muestras_recepcion", solicita.R);
  const sinReauth = await nuevaR(t.ricardo, { inspeccion: insp({ 0: "NC" }), decision_aceptacion: "aceptada_con_desviacion", aceptacion: ACEPTACION }, SIN_REAUTH);
  const conA = await nuevaR(t.ricardo, { inspeccion: insp({ 0: "NC" }), decision_aceptacion: "aceptada_con_desviacion", aceptacion: ACEPTACION });
  check("[cob:M:V-14] con muestras:A la desviación pide reautenticación muestras:A y luego se aplica directo", sinReauth.status === 401 && sinReauth.data?.codigo === "reauth_required" && sinReauth.data?.accion === "muestras:A" && conA.status === 201 && rec(conA.R)?.estado === "aceptada_con_desviacion", `${sinFila(sinReauth)} ${sinReauth.data?.accion} · ${sinFila(conA)}`);

  /* V-18: edición bloqueada, sin asignación o con solicitud pendiente */
  const reg = await nuevaR();
  const rechazo = await putR(reg.R, reg.idInt, { inspeccion: insp({ 0: "NC" }), decision_aceptacion: "rechazada", aceptacion: ACEPTACION }, t.ricardo, SIN_REAUTH);
  const rechazoOk = await putR(reg.R, reg.idInt, { inspeccion: insp({ 0: "NC" }), decision_aceptacion: "rechazada", aceptacion: ACEPTACION }, t.ricardo);
  check("[cob:M:3.1-rechazo] registrada → rechazada (muestras:A): reautenticación muestras:A y estado rechazada", rechazo.status === 401 && rechazo.data?.accion === "muestras:A" && rechazoOk.status === 200 && rec(reg.R).estado === "rechazada", `${sinFila(rechazo)} · ${sinFila(rechazoOk)} ${rec(reg.R).estado}`);
  const enRechazada = await putR(reg.R, reg.idInt, { especificaciones: "Cambio sobre rechazada" });
  check("[cob:M:V-18] editar una recepción rechazada → 409", enRechazada.status === 409 && rec(reg.R).especificaciones !== "Cambio sobre rechazada", sinFila(enRechazada));
  const ajena = await nuevaR();
  const luis = await putR(ajena.R, ajena.idInt, { especificaciones: "Luis sin asignación" }, t.luis);
  check("[cob:M:V-18] el analista edita una recepción no asignada → 403 no_asignado", luis.status === 403 && luis.data?.codigo === "no_asignado", sinFila(luis));
  const folioPend = await api("POST", `/samples/reception/${ajena.R}/folio`, { folio_num: 600000 + (Date.now() % 90000), motivo: "Folio repetido en la libreta" }, t.mariana, SIN_APROBAR);
  const conPend = await putR(ajena.R, ajena.idInt, { especificaciones: "Con solicitud pendiente" });
  check("[cob:M:V-18] editar con una solicitud pendiente → 409 solicitud_pendiente", folioPend.status === 202 && conPend.status === 409 && conPend.data?.codigo === "solicitud_pendiente", `${sinFila(folioPend)} · ${sinFila(conPend)}`);
  await cancelar("muestras_recepcion", ajena.R);
  const mar = await nuevaR(t.mariana);
  const acepta = await putR(mar.R, mar.idInt, { decision_aceptacion: "aceptada", aceptacion: ACEPTACION }, t.mariana);
  check("[cob:M:3.1-aceptar] registrada → aceptada con muestras:C/E (Técnico Auxiliar), sin reautenticación", acepta.status === 200 && rec(mar.R).estado === "aceptada", `${sinFila(acepta)} ${rec(mar.R).estado}`);

  /* V-DISP: disposición final (muestra rechazada: sin informe, con motivo) */
  const disp = (body, headers) => api("POST", `/samples/reception/${reg.R}/disposicion`, body, t.ricardo, headers);
  const okDisp = { tipo: "rpbi", fecha: "2026-09-21", responsable: "Ricardo", motivo: "Rechazada: se desecha como RPBI" };
  const tipoMalo = await disp({ ...okDisp, tipo: "quemar" });
  check("[cob:M:V-19] disposición con un tipo fuera del catálogo → 400", tipoMalo.status === 400 && /tipo de disposicion/i.test(tipoMalo.data?.message || ""), sinFila(tipoMalo));
  const sinFecha = await disp({ ...okDisp, fecha: "", responsable: "" });
  check("[cob:M:V-20] disposición sin fecha ni responsable → 400", sinFecha.status === 400 && /fecha y el responsable/i.test(sinFecha.data?.message || ""), sinFila(sinFecha));
  const sinMotivo = await disp({ ...okDisp, motivo: "no" });
  check("[cob:M:V-21] muestra rechazada sin motivo (≥ 5) → 400 campo motivo", sinMotivo.status === 400 && sinMotivo.data?.campo === "motivo" && rec(reg.R).estado === "rechazada", sinFila(sinMotivo));
  const cierra = await disp(okDisp);
  const otraDisp = await disp(okDisp);
  check("[cob:M:V-22] una recepción ya cerrada no admite otra disposición → 409", cierra.status === 200 && rec(reg.R).estado === "cerrada" && otraDisp.status === 409, `${sinFila(cierra)} · ${sinFila(otraDisp)}`);
  const anulable = await nuevaR();
  await api("POST", `/samples/reception/${anulable.R}/anular`, { motivo: "Registro duplicado de cobertura" }, t.ricardo);
  const enAnulada = await api("POST", `/samples/reception/${anulable.R}/disposicion`, okDisp, t.ricardo);
  check("[cob:M:V-22] disposición de una recepción anulada → 409", rec(anulable.R).estado === "anulada" && enAnulada.status === 409, sinFila(enAnulada));

  /* V-FOLIO / V-REABRIR */
  const f = await nuevaR(t.qa, { decision_aceptacion: "aceptada", aceptacion: ACEPTACION });
  const folio = (body, token = t.ricardo) => api("POST", `/samples/reception/${f.R}/folio`, body, token);
  const cero = await folio({ folio_num: 0, motivo: "Folio en cero de prueba" });
  const letras = await folio({ folio_num: "abc", motivo: "Folio con letras de prueba" });
  check("[cob:M:V-25] folio nuevo no numérico o < 1 → 400 «Indica el folio nuevo»", cero.status === 400 && letras.status === 400 && /folio nuevo/i.test(cero.data?.message || ""), `${sinFila(cero)} · ${sinFila(letras)}`);
  const igual = await folio({ folio_num: rec(f.R).folio_num, motivo: "El mismo folio de prueba" });
  check("[cob:M:V-26] folio nuevo igual al actual → 400", igual.status === 400 && /igual al actual/i.test(igual.data?.message || ""), sinFila(igual));
  const corto = await folio({ folio_num: 650000 + (Date.now() % 90000), motivo: "no" });
  check("[cob:M:V-27] cambio de folio con motivo < 5 → 400", corto.status === 400 && /motivo/i.test(corto.data?.message || ""), sinFila(corto));
  const ocupado = await folio({ folio_num: rec(acep.R).folio_num, motivo: "Folio que ya usa otra recepción" });
  check("[cob:M:V-28] folio nuevo ya ocupado → 409 (el folio no cambia)", ocupado.status === 409 && /ya existe/i.test(ocupado.data?.message || "") && Number(rec(f.R).folio_num) !== Number(rec(acep.R).folio_num), sinFila(ocupado));
  const reabrirReg = await api("POST", `/samples/reception/${f.R}/reabrir`, { motivo: "Reabrir una aceptada de prueba" }, t.ricardo);
  check("[cob:M:V-29] reabrir una recepción que no está cerrada ni rechazada → 409", reabrirReg.status === 409, sinFila(reabrirReg));
  const rech2 = await nuevaR(t.ricardo, { inspeccion: insp({ 0: "NC" }), decision_aceptacion: "rechazada", aceptacion: ACEPTACION });
  const reabrirCorto = await api("POST", `/samples/reception/${rech2.R}/reabrir`, { motivo: "no" }, t.ricardo);
  check("[cob:M:V-30] reabrir con motivo < 5 → 400 (sigue rechazada)", reabrirCorto.status === 400 && rec(rech2.R).estado === "rechazada", sinFila(reabrirCorto));

  /* V-ASIG y revocación (3.6) */
  const asignar = (rid, body, token = t.ricardo) => api("POST", `/samples/reception/${rid}/asignaciones`, body, token);
  const sinDecision = await asignar((await nuevaR()).R, { usuario_id: id.luis });
  const enRech = await asignar(rech2.R, { usuario_id: id.luis });
  check("[cob:M:V-32] asignar una recepción sin aceptar o rechazada → 409", sinDecision.status === 409 && enRech.status === 409, `${sinFila(sinDecision)} · ${sinFila(enRech)}`);
  const nadie = await asignar(f.R, {});
  const fantasma = await asignar(f.R, { usuario_id: 99999999 });
  const deBaja = await asignar(f.R, { usuario_id: inactiva.id });
  check("[cob:M:V-31] [cob:M:V-33] asignar sin persona, a una cuenta inexistente o dada de baja → 400 «Elige una cuenta activa»", [nadie, fantasma, deBaja].every((r) => r.status === 400 && /cuenta activa/i.test(r.data?.message || "")), [nadie, fantasma, deBaja].map(sinFila).join(" · "));
  const primera = await asignar(f.R, { usuario_id: id.luis, motivo: "Asignación de cobertura" });
  const repetida = await asignar(f.R, { usuario_id: id.luis });
  check("[cob:M:V-34] asignar dos veces a la misma persona → 409", primera.status === 201 && repetida.status === 409, `${sinFila(primera)} · ${sinFila(repetida)}`);
  const asig = fila("SELECT id FROM asignaciones_muestra WHERE recepcion_id = ? AND usuario_id = ? AND revocado_en IS NULL", f.R, id.luis)?.id;
  const revocar = (aid, body, token = t.ricardo) => api("POST", `/samples/reception/${f.R}/asignaciones/${aid}/revocar`, body, token);
  const revMariana = await revocar(asig, { motivo: "Sin permiso para revocar" }, t.mariana);
  check("[cob:M:POST-revocar-asignacion] revocar sin muestras:A → 403", revMariana.status === 403, sinFila(revMariana));
  const revCorto = await revocar(asig, { motivo: "no" });
  check("[cob:M:V-35] revocar con motivo < 5 → 400 (sigue vigente)", revCorto.status === 400 && !fila("SELECT revocado_en FROM asignaciones_muestra WHERE id = ?", asig).revocado_en, sinFila(revCorto));
  const revOk = await revocar(asig, { motivo: "Cambio de turno del analista" });
  const revOtra = await revocar(asig, { motivo: "Cambio de turno del analista" });
  const revNada = await revocar(99999999, { motivo: "Asignación inexistente" });
  check("[cob:M:3.6-asignacion] [cob:M:V-35] [cob:M:POST-revocar-asignacion] revocar: vigente → revocada (con motivo); otra vez → 409; inexistente → 404", revOk.status === 200 && !!fila("SELECT revocado_en FROM asignaciones_muestra WHERE id = ?", asig).revocado_en && revOtra.status === 409 && revNada.status === 404, `${sinFila(revOk)} · ${sinFila(revOtra)} · ${sinFila(revNada)}`);

  /* V-ETI */
  const eti = await api("POST", `/samples/reception/${f.R}/etiquetas`, { formato: "gigante", inicio: -4, copias: 999 }, t.qa);
  const bit = fila("SELECT cambios_json FROM auditoria WHERE accion = 'imprimir_etiquetas' AND entidad = 'muestras_recepcion' AND entidad_id = ? ORDER BY id DESC", String(f.R));
  const det = JSON.stringify(bit ? JSON.parse(bit.cambios_json || "{}") : {});
  check("[cob:M:V-37] etiquetas con formato, inicio y copias fuera de rango → 200 y se ajustan (pequena, 1, 50)", eti.status === 200 && /"formato":"pequena"/.test(det) && /"inicio":1\b/.test(det) && /"copias":50\b/.test(det), `${sinFila(eti)} ${det.slice(0, 200)}`);
}

/* ================= Procesamiento (V-PROC, 3.2) ================= */
{
  const c = await cadena(t, `CP${s5}`);
  const c2 = await cadena(t, `CQ${s5}`);
  const folioP = (pid) => fila("SELECT folio_num FROM muestras_procesamiento WHERE id = ?", pid)?.folio_num;
  const sinFolio = await api("PUT", `/samples/processing/${c.P}`, datosP(c.R, c.idInt, { folio_num: null }), t.qa);
  check("[cob:M:V-38] editar un procesamiento sin folio → 400", sinFolio.status === 400 && /folio de procesamiento es obligatorio/i.test(sinFolio.data?.message || ""), sinFila(sinFolio));
  const dup = await api("POST", "/samples/processing", datosP(c.R, c.idInt, { folio_num: folioP(c.P) }), t.qa);
  const dupPut = await api("PUT", `/samples/processing/${c2.P}`, datosP(c2.R, c2.idInt, { folio_num: folioP(c.P) }), t.qa);
  check("[cob:M:V-39] folio de procesamiento repetido (crear y editar) → 409", dup.status === 409 && dupPut.status === 409 && /ya existe/i.test(dup.data?.message || ""), `${sinFila(dup)} · ${sinFila(dupPut)}`);
  const minimo = await api("POST", "/samples/processing", { recepcion_id: c.R, nombre_quien_proceso: "Persona A", nombre_quien_superviso: "Persona B" }, t.qa);
  check("[cob:M:V-40] [cob:M:V-42] [cob:M:V-43] [cob:M:V-44] [cob:M:V-45] sin fecha, muestra, organismo, pasos ni resguardo: el servidor lo acepta (reglas solo del formulario)", minimo.status === 201, sinFila(minimo));
  const sinOrigen = await api("POST", "/samples/processing", datosP(null, c.idInt), t.qa);
  const reg = await nuevaR();
  const noAceptada = await api("POST", "/samples/processing", datosP(reg.R, reg.idInt), t.qa);
  check("[cob:M:V-41] procesamiento sin recepción → 400 origen_requerido; de una recepción sin aceptar → 409", sinOrigen.status === 400 && sinOrigen.data?.codigo === "origen_requerido" && noAceptada.status === 409 && /decision de aceptacion/i.test(noAceptada.data?.message || ""), `${sinFila(sinOrigen)} · ${sinFila(noAceptada)}`);
  const sinConfirmar = await api("POST", "/samples/processing", datosP(c.R, c.idInt, { firmantes: { superviso: { usuario_id: id.ana } } }), t.qa);
  const malaPass = await api("POST", "/samples/processing", datosP(c.R, c.idInt, { firmantes: { superviso: { usuario_id: temporal.id, password: "No-es-la-contrasena-1" } } }), t.qa, { "X-Forwarded-For": "10.77.0.1" });
  check("[cob:M:V-46] quien supervisó sin confirmar su firma → 403 firma_sin_confirmar; con contraseña incorrecta → 401 firma_invalida", sinConfirmar.status === 403 && sinConfirmar.data?.codigo === "firma_sin_confirmar" && malaPass.status === 401 && malaPass.data?.codigo === "firma_invalida", `${sinFila(sinConfirmar)} · ${sinFila(malaPass)}`);
  // 423: la cuenta del firmante bloqueada por intentos fallidos de acceso (con una IP propia para no bloquear la del servidor de pruebas).
  for (let i = 0; i < 6; i += 1) await api("POST", "/auth/login", { email: bloqueada.email, password: `Incorrecta-${i}-xx` }, undefined, { "X-Forwarded-For": "10.77.0.2" });
  const conBloqueo = await api("POST", "/samples/processing", datosP(c.R, c.idInt, { firmantes: { superviso: { usuario_id: bloqueada.id, password: PASS } } }), t.qa, { "X-Forwarded-For": "10.77.0.3" });
  check("[cob:M:V-46] firmante con la cuenta bloqueada → 423 firma_bloqueada", conBloqueo.status === 423 && conBloqueo.data?.codigo === "firma_bloqueada", `${sinFila(conBloqueo)} (bloqueado_hasta ${fila("SELECT bloqueado_hasta FROM usuarios WHERE id = ?", bloqueada.id)?.bloqueado_hasta})`);
  const mismo = await api("POST", "/samples/processing", datosP(c.R, c.idInt, { nombre_quien_proceso: "Laura Gómez", nombre_quien_superviso: "Laura Gómez" }), t.qa);
  check("[cob:M:V-47] supervisó = procesó → 409 segregacion", mismo.status === 409 && mismo.data?.codigo === "segregacion", sinFila(mismo));
  const consumible = fila("SELECT id FROM consumibles WHERE producto = 'Bolsa roja RPBI'")?.id;
  const asig = await api("POST", `/samples/reception/${c.R}/asignaciones`, { usuario_id: temporal.id, motivo: "Asignación de cobertura" }, t.ricardo);
  const sinInv = await api("POST", "/samples/processing", datosP(c.R, c.idInt, { uso_inventario: [{ tipo: "consumible", ref: String(consumible), cantidad: 1 }] }), tTemp);
  const sinExist = await api("POST", "/samples/processing", datosP(c.R, c.idInt, { uso_inventario: [{ tipo: "consumible", ref: String(consumible), cantidad: 99999 }] }), t.qa);
  check("[cob:M:V-49] insumos sin inventario:C → 403; sin existencia suficiente → 409", asig.status === 201 && sinInv.status === 403 && sinExist.status === 409, `${sinFila(asig)} · ${sinFila(sinInv)} · ${sinFila(sinExist)}`);

  /* 3.2 anular / restaurar */
  const pLibre = (await api("POST", "/samples/processing", datosP(c2.R, c2.idInt), t.qa)).data?.id;
  const sinR = await api("POST", `/samples/processing/${pLibre}/anular`, { motivo: "Procesamiento duplicado" }, t.ricardo, SIN_REAUTH);
  const anula = await api("POST", `/samples/processing/${pLibre}/anular`, { motivo: "Procesamiento duplicado" }, t.ricardo);
  const fp = fila("SELECT estado, estado_previo FROM muestras_procesamiento WHERE id = ?", pLibre);
  const restaura = await api("POST", `/samples/processing/${pLibre}/restaurar`, { motivo: "No era duplicado" }, t.ricardo);
  check("[cob:M:3.2-anular] procesamiento registrado: reautenticación ensayos:AN, anulada con estado_previo y restaurada directo", sinR.status === 401 && sinR.data?.accion === "ensayos:AN" && anula.status === 200 && fp.estado === "anulada" && fp.estado_previo === "registrada" && restaura.status === 200 && fila("SELECT estado FROM muestras_procesamiento WHERE id = ?", pLibre).estado === "registrada", `${sinFila(sinR)} · ${sinFila(anula)} ${JSON.stringify(fp)} · ${sinFila(restaura)}`);
  const conExt = await api("POST", `/samples/processing/${c.P}/anular`, { motivo: "Tiene extracción vigente" }, t.ricardo);
  check("[cob:M:3.2-anular] procesamiento con extracciones vigentes → 409", conExt.status === 409 && /extraccion/i.test(conExt.data?.message || "") && fila("SELECT estado FROM muestras_procesamiento WHERE id = ?", c.P).estado !== "anulada", sinFila(conExt));
  await api("POST", `/samples/extraction/${c2.E}/anular`, { motivo: "Extracción repetida por error" }, t.ricardo);
  const pend = await api("POST", `/samples/processing/${c2.P}/anular`, { motivo: "Procesamiento en curso a anular" }, t.ricardo, SIN_APROBAR);
  check("[cob:M:3.2-anular] procesamiento fuera de registrada (en proceso) → solicitud anular_registro", pend.status === 202 && pend.data?.solicitud?.tipo === "anular_registro" && fila("SELECT estado FROM muestras_procesamiento WHERE id = ?", c2.P).estado !== "anulada", `${sinFila(pend)} ${fila("SELECT estado FROM muestras_procesamiento WHERE id = ?", c2.P).estado}`);
  await cancelar("muestras_procesamiento", c2.P);
  const r404 = await api("POST", "/samples/processing/99999999/restaurar", { motivo: "No existe este registro" }, t.ricardo);
  const r409 = await api("POST", `/samples/processing/${c.P}/restaurar`, { motivo: "No está anulado" }, t.ricardo);
  check("[cob:M:POST-processing-restaurar] restaurar procesamiento inexistente → 404; no anulado → 409", r404.status === 404 && r409.status === 409, `${sinFila(r404)} · ${sinFila(r409)}`);

  /* Supervisión: el supervisor asignado (R en muestras) no ve ensayos */
  const pTemp = await api("POST", "/samples/processing", datosP(c.R, c.idInt), tTemp);
  const sup = fila("SELECT supervision_estado, supervisor_id FROM muestras_procesamiento WHERE id = ?", pTemp.data?.id);
  const vb = await api("POST", `/supervision/muestras_procesamiento/${pTemp.data?.id}/visto-bueno`, { observaciones: "Revisado" }, tSup);
  check("[cob:M:V-101] supervisor asignado sin ensayos:V → 403", pTemp.status === 201 && sup?.supervision_estado === "pendiente" && Number(sup?.supervisor_id) === Number(supervisor.id) && vb.status === 403 && /ensayos/i.test(vb.data?.message || ""), `${sinFila(pTemp)} ${JSON.stringify(sup)} · ${sinFila(vb)}`);
}

/* ================= Extracción (V-EXT, 3.3) ================= */
{
  const c = await cadena(t, `CE${s5}`);
  const c2 = await cadena(t, `CF${s5}`);
  const folioE = (eid) => fila("SELECT folio_num FROM muestras_extraccion WHERE id = ?", eid)?.folio_num;
  const tipoMalo = await api("POST", "/samples/extraction", datosE(c.P, c.idInt, { tipo_registro: "E-X" }), t.qa);
  const tipoMaloPut = await api("PUT", `/samples/extraction/${c.E}`, datosE(c.P, c.idInt, { tipo_registro: "E-X", folio_num: folioE(c.E) }), t.qa);
  const listaMala = await api("GET", "/samples/extraction?tipo=E-X", undefined, t.qa);
  check("[cob:M:V-51] tipo de extracción no válido (crear, editar y lista) → 400", [tipoMalo, tipoMaloPut, listaMala].every((r) => r.status === 400 && /Tipo de extraccion no valido/i.test(r.data?.message || "")), [tipoMalo, tipoMaloPut, listaMala].map(sinFila).join(" · "));
  const sinFolio = await api("PUT", `/samples/extraction/${c.E}`, datosE(c.P, c.idInt, { folio_num: null }), t.qa);
  check("[cob:M:V-52] editar una extracción sin folio → 400", sinFolio.status === 400 && /folio de extraccion es obligatorio/i.test(sinFolio.data?.message || ""), sinFila(sinFolio));
  const dup = await api("POST", "/samples/extraction", datosE(c.P, c.idInt, { folio_num: folioE(c.E) }), t.qa);
  const dupPut = await api("PUT", `/samples/extraction/${c2.E}`, datosE(c2.P, c2.idInt, { folio_num: folioE(c.E) }), t.qa);
  check("[cob:M:V-53] folio E-D repetido (crear y editar) → 409 «El folio E-D … ya existe»", dup.status === 409 && dupPut.status === 409 && /E-D.*ya existe/.test(dup.data?.message || ""), `${sinFila(dup)} · ${sinFila(dupPut)}`);
  const sinOrigen = await api("POST", "/samples/extraction", datosE(null, c.idInt), t.qa);
  check("[cob:M:V-54] extracción sin procesamiento → 400 origen_requerido", sinOrigen.status === 400 && sinOrigen.data?.codigo === "origen_requerido", sinFila(sinOrigen));
  const minimo = await api("POST", "/samples/extraction", { tipo_registro: "E-D", procesamiento_id: c.P, nombre_quien_extrajo: "Persona A", nombre_quien_superviso: "Persona B" }, t.qa);
  check("[cob:M:V-54] [cob:M:V-55] [cob:M:V-56] sin fecha, molienda, pasos, pesos ni resguardo: el servidor lo acepta (reglas solo del formulario)", minimo.status === 201, sinFila(minimo));
  const segExtrajo = await api("POST", "/samples/extraction", datosE(c.P, c.idInt, { nombre_quien_extrajo: "Mario Ruiz", nombre_quien_superviso: "Mario Ruiz" }), t.qa);
  const segLimpio = await api("POST", "/samples/extraction", datosE(c.P, c.idInt, { nombre_quien_limpieza: "Rosa Peña", nombre_quien_superviso: "Rosa Peña" }), t.qa);
  check("[cob:M:V-57] supervisó = extrajo o = limpió → 409 segregacion", segExtrajo.status === 409 && segExtrajo.data?.codigo === "segregacion" && segLimpio.status === 409 && segLimpio.data?.codigo === "segregacion", `${sinFila(segExtrajo)} · ${sinFila(segLimpio)}`);
  // Equipo propio suspendido por una NC propia.
  const eq = await api("POST", "/inventory/equipos", { nombre: `Vórtex cobertura ${s5}`, estado: "operativo" }, t.qa);
  await api("POST", `/admin/usuarios/${id.qa}/autorizaciones`, { tipo: "equipo", clave: String(eq.data?.id), folio_fx_thf_ap: "FX-THF-AP-COBERTURA", motivo: "Equipo de la prueba de cobertura" }, t.ricardo);
  const inc = await api("POST", "/calidad/incidencias", { tipo: "falla_equipo", fecha_hora_ocurrencia: new Date().toISOString(), descripcion: `El vórtex de cobertura ${s5} vibra fuera de especificación`, impacto_resultados: "si", accion_inmediata: "Se retiró de uso", registros: [{ entidad: "muestras_extraccion", entidad_id: c.E }, { entidad: "equipos", entidad_id: eq.data?.id }] }, t.luis);
  const esc = await api("POST", `/calidad/incidencias/${inc.data?.id}/evaluar`, { decision: "escalar", justificacion: "Puede afectar resultados de la prueba", nc: { clasificacion: "menor", requisito_incumplido: "ISO/IEC 17025 6.4" } }, t.ricardo);
  globalThis.NC_COB = esc.data?.nc_id;
  const susp = await api("POST", `/calidad/nc/${esc.data?.nc_id}/suspensiones`, { tipo: "equipo", clave: String(eq.data?.id), motivo: "Vibración fuera de especificación" }, t.ricardo);
  const conSusp = await api("POST", "/samples/extraction", datosE(c.P, c.idInt, { equipos: [{ equipo_id: eq.data?.id, uso: "Vórtex" }] }), t.qa);
  check("[cob:M:V-58] extracción con un equipo suspendido por una NC → 409", eq.status === 201 && susp.status === 201 && conSusp.status === 409, `${eq.status} ${inc.status} ${esc.status} ${sinFila(susp)} · ${sinFila(conSusp)}`);
  const asig = await api("POST", `/samples/reception/${c.R}/asignaciones`, { usuario_id: temporal.id, motivo: "Asignación de cobertura" }, t.ricardo);
  const sinEquipos = await api("POST", "/samples/extraction", datosE(c.P, c.idInt, { equipos: [{ nombre: "Baño de agua sin catálogo", uso: "Baño" }] }), tTemp);
  const centrifuga = fila("SELECT id FROM equipos WHERE nombre = 'Centrifuga' ORDER BY id LIMIT 1")?.id;
  const noApto = await api("POST", "/samples/extraction", datosE(c.P, c.idInt, { equipos: [{ equipo_id: centrifuga, uso: "Centrífuga" }] }), t.qa);
  const incAuto = noApto.data?.id ? fila("SELECT id FROM incidencias WHERE clave_automatica = ?", `equipo_no_apto:muestras_extraccion:${noApto.data.id}:${centrifuga}`) : null;
  check("[cob:M:V-59] equipos sin equipos:C uso_equipo → 403; equipo con calibración vencida → 201 e incidencia automática", asig.status === 201 && sinEquipos.status === 403 && noApto.status === 201 && !!incAuto, `${sinFila(asig)} · ${sinFila(sinEquipos)} · ${sinFila(noApto)} inc=${incAuto?.id}`);

  /* 3.3 anular / restaurar (repone inventario) */
  const metanol = fila("SELECT id FROM reactivos WHERE nombre = 'Metanol HPLC' ORDER BY id LIMIT 1")?.id;
  const conInsumo = await api("POST", "/samples/extraction", datosE(c.P, c.idInt, { uso_inventario: [{ tipo: "reactivo", ref: String(metanol), cantidad: 0.001 }] }), t.qa);
  const E = conInsumo.data?.id;
  const salidas = filas("SELECT id FROM movimientos WHERE referencia LIKE ?", `EXT-${E}-INS-%`).map((m) => m.id);
  const sinR = await api("POST", `/samples/extraction/${E}/anular`, { motivo: "Extracción repetida" }, t.ricardo, SIN_REAUTH);
  const anula = await api("POST", `/samples/extraction/${E}/anular`, { motivo: "Extracción repetida" }, t.ricardo);
  const reversas = salidas.length ? filas(`SELECT id FROM movimientos WHERE revierte_id IN (${salidas.join(",")})`) : [];
  check("[cob:M:3.3-anular] extracción registrada: reautenticación ensayos:AN, anulada y el inventario repuesto (movimiento de reversión)", conInsumo.status === 201 && sinR.status === 401 && sinR.data?.accion === "ensayos:AN" && anula.status === 200 && fila("SELECT estado FROM muestras_extraccion WHERE id = ?", E).estado === "anulada" && salidas.length > 0 && reversas.length === salidas.length, `${sinFila(conInsumo)} · ${sinFila(sinR)} · ${sinFila(anula)} salidas=${salidas.length} reversas=${reversas.length}`);
  const restaura = await api("POST", `/samples/extraction/${E}/restaurar`, { motivo: "Se anuló por error" }, t.ricardo);
  check("[cob:M:3.3-restaurar] extracción restaurada al estado previo (sin volver a descontar)", restaura.status === 200 && fila("SELECT estado FROM muestras_extraccion WHERE id = ?", E).estado === "registrada" && filas("SELECT id FROM movimientos WHERE referencia LIKE ?", `EXT-${E}-INS-%`).length === salidas.length + reversas.length, `${sinFila(restaura)} ${restaura.data?.message || ""}`);
  const A = (await api("POST", "/samples/analysis", analisisDe(c2), t.qa)).data?.id;
  const conAna = await api("POST", `/samples/extraction/${c2.E}/anular`, { motivo: "Tiene análisis vigente" }, t.ricardo);
  check("[cob:M:3.3-anular] extracción con análisis vigente → 409", conAna.status === 409 && /analisis/i.test(conAna.data?.message || ""), sinFila(conAna));
  await flujoAnalisis(A);
  await api("POST", `/samples/analysis/${A}/anular`, { motivo: "Resultado inválido por contaminación" }, t.ricardo);
  const pend = await api("POST", `/samples/extraction/${c2.E}/anular`, { motivo: "Extracción ya analizada" }, t.ricardo, SIN_APROBAR);
  check("[cob:M:3.3-anular] extracción fuera de borrador (analizada) → solicitud anular_registro", estadoA(A) === "anulado" && pend.status === 202 && pend.data?.solicitud?.tipo === "anular_registro", `${estadoA(A)} ${fila("SELECT estado FROM muestras_extraccion WHERE id = ?", c2.E).estado} · ${sinFila(pend)}`);
  await cancelar("muestras_extraccion", c2.E);
}

/* ================= Análisis (V-ANA, V-ADJ, 3.4) ================= */
{
  const c = await cadena(t, `CA${s5}`);
  const base = analisisDe(c);
  const crear = (extra = {}, token = t.qa) => api("POST", "/samples/analysis", { ...base, ...extra }, token);
  const A1 = (await crear()).data?.id;
  const A2 = (await crear()).data?.id;
  const folioA = (aid) => fila("SELECT folio_num FROM muestras_analisis WHERE id = ?", aid)?.folio_num;
  const sinFolio = await api("PUT", `/samples/analysis/${A1}`, { ...base, folio_num: null }, t.qa);
  check("[cob:M:V-60] editar un análisis sin folio → 400", sinFolio.status === 400 && /folio es obligatorio/i.test(sinFolio.data?.message || ""), sinFila(sinFolio));
  const dup = await crear({ folio_num: folioA(A1) });
  const dupPut = await api("PUT", `/samples/analysis/${A2}`, { ...base, folio_num: folioA(A1) }, t.qa);
  check("[cob:M:V-61] folio de análisis repetido (crear y editar) → 409", dup.status === 409 && dupPut.status === 409 && /folio de analisis ya existe/i.test(dup.data?.message || ""), `${sinFila(dup)} · ${sinFila(dupPut)}`);
  const casos = [
    [{ tipo_analisis: "" }, /tipo de analisis/i],
    [{ metodo: "" }, /metodo de analisis/i],
    [{ metodo: "otro", metodo_otro: "" }, /Especifica el metodo/i],
    [{ fecha_analisis: "" }, /fecha del analisis/i],
  ];
  const res = [];
  for (const [extra] of casos) res.push(await crear(extra));
  check("[cob:M:V-62] sin tipo, sin método, «otro» sin texto o sin fecha → 400 con su mensaje", res.every((r, i) => r.status === 400 && casos[i][1].test(r.data?.message || "")), res.map(sinFila).join(" · "));
  const sinEquipo = await crear({ equipo_id: null, equipo_nombre: null });
  check("[cob:M:V-64] análisis sin equipo: el servidor lo acepta (regla solo del formulario)", sinEquipo.status === 201, sinFila(sinEquipo));
  const sinAnalista = await crear({ analista_nombre: "" });
  check("[cob:M:V-65] sin analista → 400 «Indica el nombre del analista»", sinAnalista.status === 400 && /nombre del analista/i.test(sinAnalista.data?.message || ""), sinFila(sinAnalista));
  const sinRes = await crear({ resultados: [] });
  const sinValor = await crear({ resultados: [{ id_muestra: c.idInt, resultado: null, resultado_texto: "" }] });
  check("[cob:M:V-66] sin resultados o una fila sin valor → 400", sinRes.status === 400 && /al menos un resultado/i.test(sinRes.data?.message || "") && sinValor.status === 400 && new RegExp(`resultado de la muestra ${c.idInt}`).test(sinValor.data?.message || ""), `${sinFila(sinRes)} · ${sinFila(sinValor)}`);
  const sinEv = await api("POST", `/samples/analysis/${A1}/enviar-revision`, {}, t.qa, SIN_EVIDENCIA);
  check("[cob:M:V-68] enviar a revisión sin evidencia → 409 evidencia_requerida (sigue registrado)", sinEv.status === 409 && sinEv.data?.codigo === "evidencia_requerida" && estadoA(A1) === "registrado", sinFila(sinEv));
  const revReg = await api("POST", `/samples/analysis/${A1}/revisar`, {}, t.ricardo);
  check("[cob:M:V-69] revisar un análisis registrado → 409 «El analista aún no lo envía a revisión»", revReg.status === 409 && revReg.data?.codigo === "no_enviado", sinFila(revReg));
  const devReg = await api("POST", `/samples/analysis/${A1}/devolver`, { motivo: "Faltan cromatogramas" }, t.ricardo);
  const enmReg = await api("POST", `/samples/analysis/${A1}/enmendar`, { motivo: "Corrección de unidad" }, t.qa);
  check("[cob:M:V-71] [cob:M:V-72] devolver o enmendar un análisis registrado → 409", devReg.status === 409 && enmReg.status === 409, `${sinFila(devReg)} · ${sinFila(enmReg)}`);
  const excAccion = await api("POST", "/solicitudes", { tipo: "excepcion_segregacion", entidad: "muestras_analisis", entidad_id: A1, accion: "autorizar", motivo: "Única persona disponible" }, t.qa);
  const excEstado = await api("POST", "/solicitudes", { tipo: "excepcion_segregacion", entidad: "muestras_analisis", entidad_id: A1, accion: "revisar", motivo: "Única persona disponible" }, t.qa);
  check("[cob:M:V-73] excepción de segregación: acción que no es revisar/aprobar → 400; revisar uno no enviado → 409", excAccion.status === 400 && excEstado.status === 409, `${sinFila(excAccion)} · ${sinFila(excEstado)}`);
  await flujoAnalisis(A1, "en_revision");
  const editEnv = await api("PUT", `/samples/analysis/${A1}`, { ...base, folio_num: folioA(A1), observaciones: "Cambio tras enviar" }, t.qa);
  check("[cob:M:V-67] editar un análisis enviado a revisión → 409 analisis_bloqueado", estadoA(A1) === "en_revision" && editEnv.status === 409 && editEnv.data?.codigo === "analisis_bloqueado", sinFila(editEnv));
  const otraVez = await api("POST", `/samples/analysis/${A1}/enviar-revision`, {}, t.qa);
  check("[cob:M:V-68] enviar a revisión uno que ya está en revisión → 409", otraVez.status === 409, sinFila(otraVez));
  const aprEnv = await api("POST", `/samples/analysis/${A1}/aprobar`, {}, t.ricardo);
  check("[cob:M:V-70] aprobar un análisis sin revisar → 409", aprEnv.status === 409 && estadoA(A1) === "en_revision", sinFila(aprEnv));
  const devCorto = await api("POST", `/samples/analysis/${A1}/devolver`, { motivo: "no" }, t.ricardo);
  check("[cob:M:V-71] devolver con observaciones < 5 → 400", devCorto.status === 400 && estadoA(A1) === "en_revision", sinFila(devCorto));
  await flujoAnalisis(A2);
  const enmCorto = await api("POST", `/samples/analysis/${A2}/enmendar`, { motivo: "no" }, t.qa);
  const enm = await api("POST", `/samples/analysis/${A2}/enmendar`, { motivo: "Se transcribió mal la unidad" }, t.qa);
  const enm2 = await api("POST", `/samples/analysis/${A2}/enmendar`, { motivo: "Otra corrección más" }, t.qa);
  check("[cob:M:V-72] enmendar: motivo < 5 → 400; con una enmienda abierta → 409 con su id", estadoA(A2) === "aprobado" && enmCorto.status === 400 && enm.status === 201 && enm2.status === 409 && Number(enm2.data?.id) === Number(enm.data?.id), `${sinFila(enmCorto)} · ${sinFila(enm)} · ${sinFila(enm2)} ${enm2.data?.id}`);

  /* V-ADJ: evidencia instrumental */
  const A3 = (await crear()).data?.id;
  const subir = (bytes, nombre, extra = {}) => {
    const form = new FormData();
    if (bytes !== null) form.append("archivo", new Blob([bytes]), nombre);
    form.append("tipo_evidencia", extra.tipo ?? "cromatograma");
    form.append("descripcion", extra.descripcion ?? "Cromatograma de cobertura");
    return api("POST", `/samples/analysis/${A3}/adjuntos`, form, t.qa);
  };
  const exe = await subir(Buffer.from("MZ ejecutable"), "programa.exe");
  const vacio = await subir(Buffer.alloc(0), "vacio.pdf");
  const falso = await subir(Buffer.from("esto no es un PDF"), "falso.pdf");
  const sinArchivo = await subir(null, "");
  const noMultipart = await api("POST", `/samples/analysis/${A3}/adjuntos`, { tipo_evidencia: "cromatograma" }, t.qa);
  check("[cob:M:V-74] evidencia: extensión no permitida, vacía, firma de bytes falsa, sin archivo o sin multipart → 400", exe.status === 400 && exe.data?.codigo === "formato_no_permitido" && vacio.status === 400 && vacio.data?.codigo === "archivo_vacio" && falso.status === 400 && falso.data?.codigo === "contenido_no_valido" && sinArchivo.status === 400 && noMultipart.status === 400, [exe, vacio, falso, sinArchivo, noMultipart].map(sinFila).join(" · "));
  let grande;
  try {
    grande = await subir(Buffer.alloc(26 * 1024 * 1024, 0x25), "enorme.pdf");
  } catch (e) {
    grande = { status: 0, data: { message: String(e.message) } };
  }
  check("[cob:M:V-74] evidencia de más de EVIDENCIA_MAX_MB (25) → 413 archivo_grande", grande.status === 413 && grande.data?.codigo === "archivo_grande", sinFila(grande));
  const pdf = pdfDePrueba(`Cobertura ${s5}`);
  const sinTipo = await subir(pdf, "c.pdf", { tipo: "foto_de_gato" });
  const descCorta = await subir(pdf, "c.pdf", { descripcion: "abc" });
  check("[cob:M:V-75] [cob:M:V-76] tipo de evidencia fuera del catálogo o descripción < 5 → 400", sinTipo.status === 400 && /tipo de evidencia/i.test(sinTipo.data?.message || "") && descCorta.status === 400 && /Describe la evidencia/i.test(descCorta.data?.message || ""), `${sinFila(sinTipo)} · ${sinFila(descCorta)}`);
  const ok = await subir(pdf, "c.pdf");
  const repetido = await subir(pdf, "otra-copia.pdf");
  check("[cob:M:V-77] el mismo archivo dos veces → 409 adjunto_duplicado", ok.status === 201 && repetido.status === 409 && repetido.data?.codigo === "adjunto_duplicado", `${sinFila(ok)} · ${sinFila(repetido)}`);
  const adj = fila("SELECT id FROM adjuntos WHERE entidad = 'analisis' AND entidad_id = ? AND anulado_en IS NULL ORDER BY id DESC", A3)?.id;
  const anCorto = await api("POST", `/adjuntos/${adj}/anular`, { motivo: "no" }, t.qa);
  const anSinR = await api("POST", `/adjuntos/${adj}/anular`, { motivo: "Archivo equivocado" }, t.qa, SIN_REAUTH);
  const anOk = await api("POST", `/adjuntos/${adj}/anular`, { motivo: "Archivo equivocado" }, t.qa);
  const anOtra = await api("POST", `/adjuntos/${adj}/anular`, { motivo: "Archivo equivocado" }, t.qa);
  check("[cob:M:V-79] anular evidencia: motivo < 5 → 400; sin reautenticación → 401 adjuntos:anular; ya anulada → 409", anCorto.status === 400 && anSinR.status === 401 && anSinR.data?.accion === "adjuntos:anular" && anOk.status === 200 && anOtra.status === 409, [anCorto, anSinR, anOk, anOtra].map(sinFila).join(" · "));

  /* 3.4 anular / restaurar análisis */
  const A4 = (await crear()).data?.id;
  const sinR = await api("POST", `/samples/analysis/${A4}/anular`, { motivo: "Captura duplicada" }, t.ricardo, SIN_REAUTH);
  const anula = await api("POST", `/samples/analysis/${A4}/anular`, { motivo: "Captura duplicada" }, t.ricardo);
  const anulado = estadoA(A4);
  const restaura = await api("POST", `/samples/analysis/${A4}/restaurar`, { motivo: "No era duplicada" }, t.ricardo);
  check("[cob:M:3.4-anular] análisis registrado: reautenticación ensayos:AN, anulado y restaurado directo", sinR.status === 401 && sinR.data?.accion === "ensayos:AN" && anula.status === 200 && anulado === "anulado" && restaura.status === 200 && estadoA(A4) === "registrado", `${sinFila(sinR)} · ${sinFila(anula)} ${anulado} · ${sinFila(restaura)}`);
  await flujoAnalisis(A4, "en_revision");
  const pend = await api("POST", `/samples/analysis/${A4}/anular`, { motivo: "Resultado dudoso" }, t.ricardo, SIN_APROBAR);
  check("[cob:M:3.4-anular] análisis fuera de registrado → solicitud anular_registro (sigue en revisión)", pend.status === 202 && pend.data?.solicitud?.tipo === "anular_registro" && estadoA(A4) === "en_revision", sinFila(pend));
  await cancelar("muestras_analisis", A4);
  const lib = await informeLiberado(t, `CI${s5}`);
  const enInforme = await api("POST", `/samples/analysis/${lib.A}/anular`, { motivo: "Está en un informe liberado" }, t.ricardo);
  check("[cob:M:3.4-anular] análisis incluido en un informe liberado → 409", lib.liberado && enInforme.status === 409 && /informe/i.test(enInforme.data?.message || "") && estadoA(lib.A) === "aprobado", sinFila(enInforme));
}

/* ================= Informes (V-INF) ================= */
{
  const c = await cadena(t, `CN${s5}`);
  const otra = await cadena(t, `CO${s5}`);
  const A = (await api("POST", "/samples/analysis", analisisDe(c), t.qa)).data?.id;
  const Aotra = (await api("POST", "/samples/analysis", analisisDe(otra), t.qa)).data?.id;
  await flujoAnalisis(A);
  const crear = (body) => api("POST", "/informes", body, t.qa);
  const sinR = await crear({ analisis_ids: [], cliente: { nombre: "X" } });
  const noExiste = await crear({ recepcion_id: 99999999, analisis_ids: [], cliente: { nombre: "X" } });
  const rech = await nuevaR(t.ricardo, { inspeccion: insp({ 0: "NC" }), decision_aceptacion: "rechazada", aceptacion: ACEPTACION });
  const anul = await nuevaR();
  await api("POST", `/samples/reception/${anul.R}/anular`, { motivo: "Duplicada de cobertura" }, t.ricardo);
  const enRech = await crear({ recepcion_id: rech.R, analisis_ids: [], cliente: { nombre: "X" } });
  const enAnul = await crear({ recepcion_id: anul.R, analisis_ids: [], cliente: { nombre: "X" } });
  check("[cob:M:V-80] informe sin recepción → 400; inexistente → 404; rechazada o anulada → 409", sinR.status === 400 && noExiste.status === 404 && enRech.status === 409 && enAnul.status === 409, [sinR, noExiste, enRech, enAnul].map(sinFila).join(" · "));
  // Una recepción heredada sin solicitante: el cliente ya no se toma de ella.
  const legado = await nuevaR(t.qa, { decision_aceptacion: "aceptada", aceptacion: ACEPTACION });
  ejecutar("UPDATE muestras_recepcion SET solicitante = NULL WHERE id = ?", legado.R);
  const sinCliente = await crear({ recepcion_id: legado.R, analisis_ids: [] });
  check("[cob:M:V-81] informe sin nombre del cliente (recepción heredada sin solicitante) → 400", sinCliente.status === 400 && /nombre del cliente/i.test(sinCliente.data?.message || ""), sinFila(sinCliente));
  const cruzado = await crear({ recepcion_id: c.R, analisis_ids: [Aotra], cliente: { nombre: "Cliente" } });
  check("[cob:M:V-84] análisis de otra recepción → 400", cruzado.status === 400 && /pertenecer a la recepcion/i.test(cruzado.data?.message || ""), sinFila(cruzado));
  const minimo = await crear({ recepcion_id: c.R, analisis_ids: [A] });
  check("[cob:M:V-82] [cob:M:V-86] [cob:M:V-87] sin alcance, regla de decisión, elaboró ni muestras: el servidor lo acepta (reglas solo del formulario)", minimo.status === 201, sinFila(minimo));
  const I = minimo.data?.id;
  const enmBorr = await api("POST", `/informes/${I}/enmienda`, { motivo: "Enmienda de un borrador" }, t.qa);
  check("[cob:M:V-91] enmendar un informe en borrador → 409", enmBorr.status === 409, sinFila(enmBorr));
  const excAccion = await api("POST", "/solicitudes", { tipo: "excepcion_segregacion", entidad: "informes", entidad_id: I, accion: "aprobar", motivo: "Única persona disponible" }, t.qa);
  await api("POST", `/informes/${I}/revisar`, {}, t.ricardo);
  const excEstado = await api("POST", "/solicitudes", { tipo: "excepcion_segregacion", entidad: "informes", entidad_id: I, accion: "revisar", motivo: "Única persona disponible" }, t.qa);
  check("[cob:M:V-92] excepción en informe: acción que no es revisar/autorizar → 400; revisar uno que ya no está en borrador → 409", excAccion.status === 400 && excEstado.status === 409, `${sinFila(excAccion)} · ${sinFila(excEstado)}`);
  const editRev = await api("PUT", `/informes/${I}`, { recepcion_id: c.R, analisis_ids: [A], cliente: { nombre: "Cambio" } }, t.qa);
  check("[cob:M:V-88] editar un informe en revisión → 409", fila("SELECT estado FROM informes WHERE id = ?", I).estado === "en_revision" && editRev.status === 409, sinFila(editRev));
  const B = (await crear({ recepcion_id: c.R, analisis_ids: [A] })).data?.id;
  const anCorto = await api("POST", `/informes/${B}/anular`, { motivo: "no" }, t.patricia);
  const anOk = await api("POST", `/informes/${B}/anular`, { motivo: "Borrador duplicado" }, t.patricia);
  const anOtra = await api("POST", `/informes/${B}/anular`, { motivo: "Borrador duplicado" }, t.patricia);
  check("[cob:M:V-90] anular informe: motivo < 5 → 400; ya anulado → 409", anCorto.status === 400 && anOk.status === 200 && anOtra.status === 409, [anCorto, anOk, anOtra].map(sinFila).join(" · "));
}

/* ================= Envíos (V-ENV) ================= */
{
  const L1 = await informeLiberado(t, `CL${s5}`);
  const inf = L1.informe;
  const envio = (campos, archivo = { bytes: "%PDF-1.4\n% evidencia\n", nombre: "evidencia.pdf" }, token = t.patricia) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(campos)) form.set(k, v);
    if (archivo) form.set("evidencia", new Blob([archivo.bytes]), archivo.nombre);
    return api("POST", `/informes/${inf}/envios`, form, token);
  };
  const ok = { destinatario_nombre: "Cliente", destinatario_correo: "cliente@ejemplo.mx", enviado_en: new Date().toISOString() };
  const json = await api("POST", `/informes/${inf}/envios`, ok, t.patricia);
  check("[cob:M:V-93] registrar un envío sin multipart → 400", json.status === 400, sinFila(json));
  const correo = await envio({ ...ok, destinatario_correo: "no-es-correo" });
  const sinNombre = await envio({ ...ok, destinatario_nombre: "" });
  check("[cob:M:V-94] destinatario sin nombre o con correo inválido → 400", correo.status === 400 && sinNombre.status === 400 && /correo válido/i.test(correo.data?.message || ""), `${sinFila(correo)} · ${sinFila(sinNombre)}`);
  const sinFecha = await envio({ ...ok, enviado_en: "" });
  const fechaMala = await envio({ ...ok, enviado_en: "ayer por la tarde" });
  check("[cob:M:V-95] envío sin fecha y hora válidas → 400", sinFecha.status === 400 && fechaMala.status === 400 && /fecha y hora/i.test(sinFecha.data?.message || ""), `${sinFila(sinFecha)} · ${sinFila(fechaMala)}`);
  const sinEv = await envio(ok, null);
  const exe = await envio(ok, { bytes: "MZ", nombre: "virus.exe" });
  const vacia = await envio(ok, { bytes: "", nombre: "vacia.pdf" });
  const enorme = await envio(ok, { bytes: Buffer.alloc(26 * 1024 * 1024, 0x20), nombre: "enorme.pdf" });
  check("[cob:M:V-96] evidencia ausente, con extensión no permitida, vacía o de más de EVIDENCIA_MAX_MB (25 MB) → 400 (sin envío)", [sinEv, exe, vacia, enorme].every((r) => r.status === 400) && !filas("SELECT id FROM envios_informe WHERE informe_id = ?", inf).length, [sinEv, exe, vacia, enorme].map(sinFila).join(" · "));
  // Con una solicitud pendiente (anulación) no se envía.
  const pidoAnular = await api("POST", `/informes/${inf}/anular`, { motivo: "Prueba: anulación pendiente" }, t.patricia, SIN_APROBAR);
  const conSol = await envio(ok);
  check("[cob:M:V-97] informe con una solicitud pendiente → 409 solicitud_pendiente", pidoAnular.status === 202 && conSol.status === 409 && conSol.data?.codigo === "solicitud_pendiente", `${sinFila(pidoAnular)} · ${sinFila(conSol)}`);
  await cancelar("informes", inf);
  // Sin el PDF final en disco (se mueve y se devuelve a su lugar).
  const pdfRuta = path.join(path.dirname(process.env.TEST_DB_PATH), "informes", String(fila("SELECT archivo_pdf FROM informes WHERE id = ?", inf).archivo_pdf));
  const aparte = `${pdfRuta}.cobertura`;
  let sinPdf = { status: 0, data: {} };
  if (existsSync(pdfRuta)) {
    renameSync(pdfRuta, aparte);
    try {
      sinPdf = await envio(ok);
    } finally {
      renameSync(aparte, pdfRuta);
    }
  }
  check("[cob:M:V-97] informe liberado sin su PDF final en el servidor → 409", sinPdf.status === 409 && /PDF final/i.test(sinPdf.data?.message || "") && existsSync(pdfRuta), sinFila(sinPdf));
  const smtp = await api("POST", `/informes/${inf}/envios/smtp`, { destinatario_nombre: "Cliente", destinatario_correo: "cliente@ejemplo.mx" }, t.patricia);
  check("[cob:M:V-98] envío desde la plataforma con SMTP configurado (transporte de prueba) → 200 con Message-ID; el informe queda enviado", smtp.status === 200 && !!smtp.data?.envio_id && fila("SELECT estado FROM informes WHERE id = ?", inf).estado === "enviado", sinFila(smtp));
  const env = smtp.data?.envio_id;
  const conf = (envioId, body, informe = inf) => api("POST", `/informes/${informe}/envios/${envioId}/confirmar`, body, t.patricia);
  const fechaConf = await conf(env, { confirmacion_en: "no-es-fecha" });
  const noEnvio = await conf(99999999, { confirmacion_en: "2026-09-22T10:00" });
  const otroInf = await conf(env, { confirmacion_en: "2026-09-22T10:00" }, L1.informe + 99999);
  const confOk = await conf(env, { confirmacion_en: "2026-09-22T10:00", confirmacion_nota: "Acusó de recibido" });
  const confOtra = await conf(env, { confirmacion_en: "2026-09-22T11:00" });
  check("[cob:M:V-99] confirmación: fecha inválida → 400; envío inexistente o de otro informe → 404; dos veces → 409", fechaConf.status === 400 && noEnvio.status === 404 && otroInf.status === 404 && confOk.status === 200 && confOtra.status === 409, [fechaConf, noEnvio, otroInf, confOk, confOtra].map(sinFila).join(" · "));
  // Enmienda: motivo y enmienda vigente.
  const enmCorta = await api("POST", `/informes/${inf}/enmienda`, { motivo: "no" }, t.qa);
  const enm = await api("POST", `/informes/${inf}/enmienda`, { motivo: "Corrección del nombre del cliente" }, t.qa);
  const enm2 = await api("POST", `/informes/${inf}/enmienda`, { motivo: "Otra enmienda más" }, t.qa);
  check("[cob:M:V-91] enmienda de informe: motivo < 5 → 400; con una enmienda vigente → 409", enmCorta.status === 400 && enm.status === 201 && enm2.status === 409, [enmCorta, enm, enm2].map(sinFila).join(" · "));
  const enBorrador = await api("POST", `/informes/${enm.data?.id}/envios/smtp`, { destinatario_nombre: "Cliente", destinatario_correo: "cliente@ejemplo.mx" }, t.patricia);
  check("[cob:M:V-97] enviar un informe que no está liberado (borrador de enmienda) → 409 no_liberado", enBorrador.status === 409 && enBorrador.data?.codigo === "no_liberado", sinFila(enBorrador));

  // Requiere enmienda: un análisis incluido se enmienda y se aprueba.
  const L2 = await informeLiberado(t, `CM${s5}`);
  const enmA = await api("POST", `/samples/analysis/${L2.A}/enmendar`, { motivo: "Se corrige la unidad del resultado" }, t.qa);
  await flujoAnalisis(enmA.data?.id);
  const reqEnm = await registrarEnvio(BASE, t.patricia, L2.informe);
  check("[cob:M:V-97] informe que requiere enmienda → 409 requiere_enmienda", Number(fila("SELECT requiere_enmienda FROM informes WHERE id = ?", L2.informe).requiere_enmienda) === 1 && reqEnm.status === 409 && reqEnm.data?.codigo === "requiere_enmienda", `${enmA.status} ${estadoA(enmA.data?.id)} · ${reqEnm.status} ${reqEnm.data?.codigo} ${reqEnm.data?.message}`);
  // Retenido por una NC.
  const L3 = await informeLiberado(t, `CR${s5}`);
  const ret = await api("POST", `/calidad/nc/${globalThis.NC_COB}/retenciones`, { informe_id: L3.informe, motivo: "Resultados en duda por el vórtex" }, t.ana);
  const retenido = await registrarEnvio(BASE, t.patricia, L3.informe);
  check("[cob:M:V-97] informe retenido por una NC → 409", ret.status === 201 && retenido.status === 409 && /retenid/i.test(retenido.data?.message || ""), `${sinFila(ret)} · ${retenido.status} ${retenido.data?.message}`);
}

/* ================= Supervisión (V-SUP) ================= */
{
  const tabla = await api("POST", "/supervision/usuarios/1/visto-bueno", {}, t.ricardo);
  const noReg = await api("POST", "/supervision/muestras_recepcion/99999999/visto-bueno", {}, t.ricardo);
  check("[cob:M:V-100] supervisión de una tabla no supervisable o de un registro inexistente → 404", tabla.status === 404 && noReg.status === 404, `${sinFila(tabla)} · ${sinFila(noReg)}`);
  const est = await nuevaR(t.diego);
  const est2 = await nuevaR(t.diego);
  const sup = fila("SELECT supervisor_id, supervision_estado FROM muestras_recepcion WHERE id = ?", est.R);
  const quien = Object.keys(id).find((k) => Number(id[k]) === Number(sup?.supervisor_id));
  const otro = ["patricia", "ana", "ricardo"].find((k) => k !== quien);
  const ajeno = await api("POST", `/supervision/muestras_recepcion/${est.R}/visto-bueno`, { observaciones: "No soy su supervisor" }, t[otro]);
  check("[cob:M:V-101] visto bueno de quien no es el supervisor asignado → 403", sup?.supervision_estado === "pendiente" && !!quien && ajeno.status === 403, `${JSON.stringify(sup)} ${quien} · ${sinFila(ajeno)}`);
  const vb = await api("POST", `/supervision/muestras_recepcion/${est.R}/visto-bueno`, { observaciones: "Revisado contra la hoja" }, t[quien]);
  const vb2 = await api("POST", `/supervision/muestras_recepcion/${est.R}/visto-bueno`, { observaciones: "Otra vez" }, t[quien]);
  check("[cob:M:V-102] visto bueno de un registro que ya no está pendiente → 409", vb.status === 200 && vb2.status === 409, `${sinFila(vb)} · ${sinFila(vb2)}`);
  const regCorto = await api("POST", `/supervision/muestras_recepcion/${est2.R}/regresar`, { observaciones: "no" }, t[quien]);
  check("[cob:M:V-104] regresar con observaciones < 5 → 400 (sigue pendiente)", regCorto.status === 400 && fila("SELECT supervision_estado FROM muestras_recepcion WHERE id = ?", est2.R).supervision_estado === "pendiente", sinFila(regCorto));
}

/* ================= Permisos por endpoint ================= */
{
  const nfR = await api("GET", "/samples/reception/next-folio", undefined, tSin);
  const nfR2 = await api("GET", "/samples/reception/next-folio", undefined, t.carmen);
  check("[cob:M:GET-reception-next-folio] siguiente folio R: sin muestras:V → 403; con V (alcance estado) → 200", nfR.status === 403 && nfR2.status === 200 && Number(nfR2.data?.next_folio) > 0, `${sinFila(nfR)} · ${sinFila(nfR2)}`);
  const nfP = await api("GET", "/samples/processing/next-folio", undefined, t.jorge);
  const nfP2 = await api("GET", "/samples/processing/next-folio", undefined, t.hector);
  check("[cob:M:GET-processing-next-folio] siguiente folio P: sin ensayos:V (Adm. técnico) → 403; auditor → 200", nfP.status === 403 && nfP2.status === 200 && Number(nfP2.data?.next_folio) > 0, `${sinFila(nfP)} · ${sinFila(nfP2)}`);
  const nfA = await api("GET", "/samples/analysis/next-folio", undefined, t.jorge);
  const nfA2 = await api("GET", "/samples/analysis/next-folio", undefined, t.hector);
  check("[cob:M:GET-analysis-next-folio] siguiente folio A: sin ensayos:V → 403; auditor → 200", nfA.status === 403 && nfA2.status === 200 && Number(nfA2.data?.next_folio) > 0, `${sinFila(nfA)} · ${sinFila(nfA2)}`);
  const sum = await api("GET", "/informes/summary", undefined, t.jorge);
  const sum2 = await api("GET", "/informes/summary", undefined, t.hector);
  check("[cob:M:GET-informes-summary] resumen de informes: sin informes:V → 403; auditor → 200 con conteos", sum.status === 403 && sum2.status === 200 && JSON.stringify(sum2.data).includes("borrador"), `${sinFila(sum)} · ${sum2.status} ${JSON.stringify(sum2.data).slice(0, 120)}`);
  const c = await cadena(t, `CD${s5}`);
  const A = (await api("POST", "/samples/analysis", analisisDe(c), t.qa)).data?.id;
  const I = (await api("POST", "/informes", { recepcion_id: c.R, analisis_ids: [], cliente: { nombre: "Cliente" } }, t.qa)).data?.id;
  const borrar = async (ruta, conAN, sinAN) => [await api("DELETE", ruta, { motivo: "Intento de borrado" }, conAN), await api("DELETE", ruta, { motivo: "Intento de borrado" }, sinAN)];
  const [dR, dR2] = await borrar(`/samples/reception/${c.R}`, t.ricardo, t.mariana);
  check("[cob:M:DELETE-reception] borrar una recepción: con muestras:AN → 405; sin AN → 403; el registro sigue", dR.status === 405 && dR2.status === 403 && !!rec(c.R), `${sinFila(dR)} · ${sinFila(dR2)}`);
  const [dP, dP2] = await borrar(`/samples/processing/${c.P}`, t.ricardo, t.luis);
  check("[cob:M:DELETE-processing] borrar un procesamiento: con ensayos:AN → 405; sin AN → 403", dP.status === 405 && dP2.status === 403 && !!fila("SELECT id FROM muestras_procesamiento WHERE id = ?", c.P), `${sinFila(dP)} · ${sinFila(dP2)}`);
  const [dA, dA2] = await borrar(`/samples/analysis/${A}`, t.patricia, t.luis);
  check("[cob:M:DELETE-analysis] borrar un análisis: con ensayos:AN → 405; sin AN → 403", dA.status === 405 && dA2.status === 403 && estadoA(A) === "registrado", `${sinFila(dA)} · ${sinFila(dA2)}`);
  const [dI, dI2] = await borrar(`/informes/${I}`, t.patricia, t.luis);
  check("[cob:M:DELETE-informes] borrar un informe: con informes:AN → 405; sin AN → 403", dI.status === 405 && dI2.status === 403 && fila("SELECT estado FROM informes WHERE id = ?", I)?.estado === "borrador", `${sinFila(dI)} · ${sinFila(dI2)}`);

  /* Restaurar recepción */
  const r404 = await api("POST", "/samples/reception/99999999/restaurar", { motivo: "No existe este registro" }, t.ricardo);
  const r409 = await api("POST", `/samples/reception/${c.R}/restaurar`, { motivo: "No está anulada" }, t.ricardo);
  const libre = await nuevaR(t.qa, { decision_aceptacion: "aceptada", aceptacion: ACEPTACION });
  const anula = await api("POST", `/samples/reception/${libre.R}/anular`, { motivo: "Recepción duplicada de cobertura" }, t.ricardo);
  const sinR = await api("POST", `/samples/reception/${libre.R}/restaurar`, { motivo: "No era duplicada" }, t.ricardo, SIN_REAUTH);
  const sol = await api("POST", `/samples/reception/${libre.R}/restaurar`, { motivo: "No era duplicada" }, t.ricardo, SIN_APROBAR);
  const sinAN = await api("POST", `/samples/reception/${libre.R}/restaurar`, { motivo: "No era duplicada" }, t.mariana);
  check("[cob:M:POST-reception-restaurar] restaurar recepción: inexistente → 404; no anulada → 409; sin muestras:AN → 403; reautenticación muestras:AN; anulada desde aceptada → solicitud restaurar_registro", r404.status === 404 && r409.status === 409 && anula.status === 200 && rec(libre.R).estado === "anulada" && sinAN.status === 403 && sinR.status === 401 && sinR.data?.accion === "muestras:AN" && sol.status === 202 && sol.data?.solicitud?.tipo === "restaurar_registro", [r404, r409, anula, sinAN, sinR, sol].map(sinFila).join(" · "));
  await cancelar("muestras_recepcion", libre.R);
}

terminar();
