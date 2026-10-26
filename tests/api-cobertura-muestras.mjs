/*
 * Cobertura de la matriz · Muestras e Informes (API). Cada check lleva la etiqueta
 * [cob:M:<id>] del renglón de la matriz que prueba (validaciones, transiciones y
 * permisos por endpoint que no tenían prueba automática). Datos propios con sello
 * único; las solicitudes que quedan pendientes se cancelan al final de cada bloque.
 */
import "./lib/reauth-auto.mjs";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync } from "node:fs";
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
  check("[cob:M:3.1-desviacion-rechazada] registrada → rechazada (muestras:A): reautenticación muestras:A y estado rechazada", rechazo.status === 401 && rechazo.data?.accion === "muestras:A" && rechazoOk.status === 200 && rec(reg.R).estado === "rechazada", `${sinFila(rechazo)} · ${sinFila(rechazoOk)} ${rec(reg.R).estado}`);
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
  check("[cob:M:3.1-registrada-aceptada-inspección-sin_NC] registrada → aceptada con muestras:C/E (Técnico Auxiliar), con la inspección completa sin NC y sin reautenticación (incompleta o con NC → 400: V-09/V-10)", acepta.status === 200 && rec(mar.R).estado === "aceptada", `${sinFila(acepta)} ${rec(mar.R).estado}`);

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
  check("[cob:M:3.6-asignación-revocada-motivo] [cob:M:V-35] [cob:M:POST-revocar-asignacion] revocar: vigente → revocada (con motivo); otra vez → 409; inexistente → 404", revOk.status === 200 && !!fila("SELECT revocado_en FROM asignaciones_muestra WHERE id = ?", asig).revocado_en && revOtra.status === 409 && revNada.status === 404, `${sinFila(revOk)} · ${sinFila(revOtra)} · ${sinFila(revNada)}`);

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
  const maxDe = (tabla) => Number(fila(`SELECT MAX(folio_num) AS m FROM ${tabla}`)?.m || 0);
  // Otras suites pueden registrar a la vez: el folio sugerido queda entre el MAX + 1 de antes y el de después.
  const enRango = (r, tabla, antes) => Number(r.data?.next_folio) >= antes + 1 && Number(r.data?.next_folio) <= maxDe(tabla) + 1;
  const mR = maxDe("muestras_recepcion");
  const nfR2 = await api("GET", "/samples/reception/next-folio", undefined, t.carmen);
  check("[cob:M:GET-reception-next-folio] siguiente folio R: sin muestras:V → 403; con V (alcance estado) → 200 con MAX + 1", nfR.status === 403 && nfR2.status === 200 && enRango(nfR2, "muestras_recepcion", mR), `${sinFila(nfR)} · ${sinFila(nfR2)} ${nfR2.data?.next_folio} vs ${mR}`);
  const nfP = await api("GET", "/samples/processing/next-folio", undefined, t.jorge);
  const mP = maxDe("muestras_procesamiento");
  const nfP2 = await api("GET", "/samples/processing/next-folio", undefined, t.hector);
  check("[cob:M:GET-processing-next-folio] siguiente folio P: sin ensayos:V (Adm. técnico) → 403; auditor → 200 con MAX + 1", nfP.status === 403 && nfP2.status === 200 && enRango(nfP2, "muestras_procesamiento", mP), `${sinFila(nfP)} · ${sinFila(nfP2)} ${nfP2.data?.next_folio} vs ${mP}`);
  const nfA = await api("GET", "/samples/analysis/next-folio", undefined, t.jorge);
  const mA = maxDe("muestras_analisis");
  const nfA2 = await api("GET", "/samples/analysis/next-folio", undefined, t.hector);
  check("[cob:M:GET-analysis-next-folio] siguiente folio A: sin ensayos:V → 403; auditor → 200 con MAX + 1", nfA.status === 403 && nfA2.status === 200 && enRango(nfA2, "muestras_analisis", mA), `${sinFila(nfA)} · ${sinFila(nfA2)} ${nfA2.data?.next_folio} vs ${mA}`);
  const sum = await api("GET", "/informes/summary", undefined, t.jorge);
  const sum2 = await api("GET", "/informes/summary", undefined, t.hector);
  check("[cob:M:GET-informes-summary] resumen de informes: sin informes:V → 403; auditor → 200 con conteos", sum.status === 403 && sum2.status === 200 && ["borrador", "en_revision", "autorizados", "liberados", "enviados", "analisis_aprobados"].every((k) => Number.isInteger(Number(sum2.data?.[k] ?? sum2.data?.summary?.[k])) && (sum2.data?.[k] ?? sum2.data?.summary?.[k]) !== undefined), `${sinFila(sum)} · ${sum2.status} ${JSON.stringify(sum2.data).slice(0, 120)}`);
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

/*
 * ================= Segunda pasada: cada renglón con su propio check =================
 * Validaciones (V-…), transiciones (3.x) y permisos por endpoint (4) que solo coincidían
 * por texto: cada check comprueba el status, el código o mensaje y que la BD no cambió.
 */
const sinAut = await alta("cob.sinaut", { rol_id: rolAuxiliar });
const tSinAut = await login(sinAut.email);
const auditorias = (accion, entidad, entidadId) => Number(fila("SELECT COUNT(*) AS n FROM auditoria WHERE accion = ? AND entidad = ? AND entidad_id = ?", accion, entidad, String(entidadId))?.n || 0);
const proc = (pid) => fila("SELECT * FROM muestras_procesamiento WHERE id = ?", pid);
const ext = (eid) => fila("SELECT * FROM muestras_extraccion WHERE id = ?", eid);
const inf = (iid) => fila("SELECT * FROM informes WHERE id = ?", iid);
const NO_EXISTE = 99999999;
check("(preparación) cuenta sin autorizaciones FX-THF-AP", sinAut.id > 0 && !!tSinAut, `${sinAut.status} ${!!tSinAut}`);

/* ---------- Recepción: validaciones ---------- */
{
  const a = await api("POST", "/samples/reception", { ...datosR(sello()), fecha_recepcion: null, hora_recepcion: null, medio_recepcion: null }, t.qa);
  const r = rec(a.data?.id);
  const idSin = sello();
  const sinConf = await api("POST", "/samples/reception", { ...datosR(idSin), firmantes: { recibio: { usuario_id: id.ana } } }, t.qa);
  const malaPass = await api("POST", "/samples/reception", { ...datosR(idSin), firmantes: { recibio: { usuario_id: temporal.id, password: "No-es-la-contrasena-2" } } }, t.qa, { "X-Forwarded-For": "10.77.0.4" });
  check("[cob:M:V-04] sin fecha, hora ni medio de recepción el servidor lo acepta (regla del formulario); «Recibido por» de otra cuenta sin confirmar → 403 firma_sin_confirmar, con contraseña incorrecta → 401 firma_invalida (sin registro)", a.status === 201 && !r?.fecha_recepcion && !r?.hora_recepcion && !r?.medio_recepcion && sinConf.status === 403 && sinConf.data?.codigo === "firma_sin_confirmar" && malaPass.status === 401 && malaPass.data?.codigo === "firma_invalida" && !fila("SELECT id FROM muestras_recepcion WHERE id_interno = ?", idSin), `${sinFila(a)} · ${sinFila(sinConf)} · ${sinFila(malaPass)}`);
  const idSol = sello();
  const sinSol = await api("POST", "/samples/reception", { ...datosR(idSol), solicitante: "  " }, t.qa);
  const putSol = await putR(a.data?.id, r?.id_interno, { solicitante: "" });
  check("[cob:M:V-05] sin solicitante → 400 «Indica el solicitante» al crear (no se registra) y al editar (no cambia)", sinSol.status === 400 && /Indica el solicitante/.test(sinSol.data?.message || "") && !fila("SELECT id FROM muestras_recepcion WHERE id_interno = ?", idSol) && putSol.status === 400 && /Indica el solicitante/.test(putSol.data?.message || "") && rec(a.data?.id)?.solicitante === r?.solicitante, `${sinFila(sinSol)} · ${sinFila(putSol)}`);
  const idAut = sello();
  const sinAutR = await api("POST", "/samples/reception", datosR(idAut), tSinAut);
  check("[cob:M:V-17] Técnico Auxiliar sin la autorización FX-THF-AP de recepción → 403 no_autorizado (no se registra)", sinAutR.status === 403 && sinAutR.data?.codigo === "no_autorizado" && /recepci/i.test(sinAutR.data?.message || "") && !fila("SELECT id FROM muestras_recepcion WHERE id_interno = ?", idAut), sinFila(sinAutR));

  /* V-DISP: informe sin liberar, solicitud o supervisión pendiente y reautenticación */
  const disp = { tipo: "rpbi", fecha: "2026-09-25", responsable: "Ricardo", observaciones: "Disposición de cobertura" };
  const aceptada = await nuevaR(t.qa, { decision_aceptacion: "aceptada", aceptacion: ACEPTACION });
  const sinInforme = await api("POST", `/samples/reception/${aceptada.R}/disposicion`, disp, t.ricardo);
  check("[cob:M:V-23] disposición de una recepción aceptada sin informe liberado → 409 informe_no_liberado (sigue aceptada, sin disposición)", sinInforme.status === 409 && sinInforme.data?.codigo === "informe_no_liberado" && rec(aceptada.R).estado === "aceptada" && !rec(aceptada.R).disposicion_json, sinFila(sinInforme));
  const est = await nuevaR(t.diego);
  const conSup = await api("POST", `/samples/reception/${est.R}/disposicion`, disp, t.ricardo);
  const conSol = await nuevaR(t.qa, { decision_aceptacion: "aceptada", aceptacion: ACEPTACION });
  const pideFolio = await api("POST", `/samples/reception/${conSol.R}/folio`, { folio_num: 610000 + (Date.now() % 90000), motivo: "Folio repetido en la libreta" }, t.mariana, SIN_APROBAR);
  const dispSol = await api("POST", `/samples/reception/${conSol.R}/disposicion`, disp, t.ricardo);
  await cancelar("muestras_recepcion", conSol.R);
  const L = await informeLiberado(t, `CX${s5}`);
  const sinReauth = await api("POST", `/samples/reception/${L.R}/disposicion`, disp, t.ricardo, SIN_REAUTH);
  check("[cob:M:V-24] disposición con supervisión pendiente → 409 supervision_pendiente; con solicitud pendiente → 409 solicitud_pendiente; sin reautenticación → 401 reauth_required (muestras:A); nada cambia", conSup.status === 409 && conSup.data?.codigo === "supervision_pendiente" && pideFolio.status === 202 && dispSol.status === 409 && dispSol.data?.codigo === "solicitud_pendiente" && sinReauth.status === 401 && sinReauth.data?.codigo === "reauth_required" && sinReauth.data?.accion === "muestras:A" && rec(L.R).estado === "liberada" && !rec(L.R).disposicion_json, [conSup, pideFolio, dispSol, sinReauth].map(sinFila).join(" · "));
  const okDisp = await api("POST", `/samples/reception/${L.R}/disposicion`, disp, t.ricardo);
  const d = JSON.parse(rec(L.R).disposicion_json || "{}");
  check("[cob:M:3.1-liberada-cerrada-disposición] [cob:M:3.6-disposición-cerrada] informe liberado → disposición con reautenticación muestras:A: la recepción liberada queda cerrada (estado_antes_cierre = liberada) y en la bitácora «cerrar»", okDisp.status === 200 && rec(L.R).estado === "cerrada" && rec(L.R).estado_antes_cierre === "liberada" && d.tipo === "rpbi" && Number(d.registrado_por) === Number(id.ricardo) && auditorias("cerrar", "muestras_recepcion", L.R) === 1, `${sinFila(okDisp)} ${rec(L.R).estado}`);
  const sinA = await api("POST", `/samples/reception/${aceptada.R}/disposicion`, disp, t.mariana);
  const nada = await api("POST", `/samples/reception/${NO_EXISTE}/disposicion`, disp, t.ricardo);
  check("[cob:M:4-POST-reception-disposicion] disposición: sin muestras:A (Técnico Auxiliar) → 403; recepción inexistente → 404; cerrada → 409 (V-22)", sinA.status === 403 && /muestras:A/.test(sinA.data?.message || "") && nada.status === 404 && rec(aceptada.R).estado === "aceptada", `${sinFila(sinA)} · ${sinFila(nada)}`);

  /* Reabrir (3.1 cerrada / rechazada) */
  const reSinR = await api("POST", `/samples/reception/${L.R}/reabrir`, { motivo: "Se debe repetir la disposición" }, t.ricardo, SIN_REAUTH);
  const reOk = await api("POST", `/samples/reception/${L.R}/reabrir`, { motivo: "Se debe repetir la disposición" }, t.ricardo);
  const rech = await nuevaR(t.ricardo, { inspeccion: insp({ 0: "NC" }), decision_aceptacion: "rechazada", aceptacion: ACEPTACION });
  const reMar = await api("POST", `/samples/reception/${rech.R}/reabrir`, { motivo: "El cliente aclaró la temperatura" }, t.mariana, SIN_APROBAR);
  const solRe = pendiente("muestras_recepcion", rech.R);
  const sigueRech = rec(rech.R).estado;
  await cancelar("muestras_recepcion", rech.R);
  const reRech = await api("POST", `/samples/reception/${rech.R}/reabrir`, { motivo: "El cliente aclaró la temperatura" }, t.ricardo);
  check("[cob:M:3.1-cerrada-rechazada-estado_antes_cierre] reabrir: con muestras:A pide reautenticación muestras:A y la cerrada vuelve a «liberada» (estado_antes_cierre); la rechazada vuelve a «registrada» sin decisión; sin A (Técnico Auxiliar) → solicitud reabrir_recepcion y no cambia", reSinR.status === 401 && reSinR.data?.accion === "muestras:A" && reOk.status === 200 && rec(L.R).estado === "liberada" && reMar.status === 202 && solRe?.tipo === "reabrir_recepcion" && sigueRech === "rechazada" && reRech.status === 200 && rec(rech.R).estado === "registrada" && !rec(rech.R).decision_aceptacion, [reSinR, reOk, reMar, reRech].map(sinFila).join(" · "));
  const ajena = await nuevaR(t.qa, { decision_aceptacion: "aceptada", aceptacion: ACEPTACION });
  const reLuis = await api("POST", `/samples/reception/${ajena.R}/reabrir`, { motivo: "Reabrir una ajena" }, t.luis);
  const reNada = await api("POST", `/samples/reception/${NO_EXISTE}/reabrir`, { motivo: "Reabrir una inexistente" }, t.ricardo);
  const reHector = await api("POST", `/samples/reception/${L.R}/reabrir`, { motivo: "Auditor sin permiso" }, t.hector);
  check("[cob:M:4-POST-reception-reabrir] reabrir: inexistente → 404; ajena con alcance asignado (Técnico Analista) → 403 no_asignado; sin muestras:E (auditor) → 403; no cerrada ni rechazada → 409 (V-29)", reNada.status === 404 && reLuis.status === 403 && reLuis.data?.codigo === "no_asignado" && reHector.status === 403 && rec(ajena.R).estado === "aceptada", [reNada, reLuis, reHector].map(sinFila).join(" · "));

  /* V-ETI: alcance «estado» */
  const etiAntes = auditorias("imprimir_etiquetas", "muestras_recepcion", ajena.R);
  const etiJorge = await api("GET", `/samples/reception/${ajena.R}/etiquetas`, undefined, t.jorge);
  const etiCarmen = await api("POST", `/samples/reception/${ajena.R}/etiquetas`, { formato: "pequena", copias: 1 }, t.carmen);
  check("[cob:M:V-36] con alcance «estado» (Adm. técnico y auxiliar) las etiquetas → 403 solo_estado y no se registra impresión", etiJorge.status === 403 && etiJorge.data?.codigo === "solo_estado" && etiCarmen.status === 403 && etiCarmen.data?.codigo === "solo_estado" && auditorias("imprimir_etiquetas", "muestras_recepcion", ajena.R) === etiAntes, `${sinFila(etiJorge)} · ${sinFila(etiCarmen)}`);
  const etiQa = await api("GET", `/samples/reception/${ajena.R}/etiquetas`, undefined, t.qa);
  const etiLuis = await api("GET", `/samples/reception/${ajena.R}/etiquetas`, undefined, t.luis);
  const etiNada = await api("GET", `/samples/reception/${NO_EXISTE}/etiquetas`, undefined, t.qa);
  check("[cob:M:4-GET-etiquetas-eti:74] etiquetas: 200 con la etiqueta de la muestra (ID interno); inexistente → 404; ajena con alcance asignado → 403 no_asignado", etiQa.status === 200 && (etiQa.data?.items || []).some((e) => e.id_interno === ajena.idInt) && etiNada.status === 404 && etiLuis.status === 403 && etiLuis.data?.codigo === "no_asignado", [etiQa, etiNada, etiLuis].map(sinFila).join(" · "));
  const impLuis = await api("POST", `/samples/reception/${ajena.R}/etiquetas`, { formato: "mediana", copias: 2 }, t.luis);
  const impNada = await api("POST", `/samples/reception/${NO_EXISTE}/etiquetas`, { formato: "mediana" }, t.qa);
  const imp = await api("POST", `/samples/reception/${ajena.R}/etiquetas`, { formato: "mediana", copias: 2, inicio: 3 }, t.qa);
  const bit = JSON.parse(fila("SELECT cambios_json FROM auditoria WHERE accion = 'imprimir_etiquetas' AND entidad = 'muestras_recepcion' AND entidad_id = ? ORDER BY id DESC", String(ajena.R))?.cambios_json || "{}");
  check("[cob:M:4-POST-etiquetas-imprimir_etiquetas] imprimir etiquetas registra «imprimir_etiquetas» con formato, copias e inicio; ajena → 403; inexistente → 404 (sin registro)", imp.status === 200 && auditorias("imprimir_etiquetas", "muestras_recepcion", ajena.R) === etiAntes + 1 && /"formato":"mediana"/.test(JSON.stringify(bit)) && /"copias":2\b/.test(JSON.stringify(bit)) && impLuis.status === 403 && impNada.status === 404, `${sinFila(imp)} · ${sinFila(impLuis)} · ${sinFila(impNada)} ${JSON.stringify(bit).slice(0, 150)}`);
}

/* ---------- Recepción: transiciones (3.1) y permisos ---------- */
{
  const nueva = await nuevaR();
  const r = rec(nueva.R);
  check("[cob:M:3.1-registrada-firmas-autorizaciones] — → registrada: muestras:C crea con folio siguiente, «Recibido por» = quien captura y queda «crear» en la bitácora", nueva.status === 201 && r?.estado === "registrada" && Number(r?.folio_num) > 0 && Number(r?.creado_por) === Number(id.qa) && auditorias("crear", "muestras_recepcion", nueva.R) === 1, `${sinFila(nueva)} ${r?.estado}`);
  const hector = await api("POST", "/samples/reception", datosR(sello()), t.hector);
  check("[cob:M:4-POST-reception-rec:220] crear recepción sin muestras:C (auditor) → 403; con C (QA) → 201", hector.status === 403 && /muestras:C/.test(hector.data?.message || "") && nueva.status === 201, sinFila(hector));
  const conDesv = await nuevaR(t.ricardo, { inspeccion: insp({ 0: "NC" }), decision_aceptacion: "aceptada_con_desviacion", aceptacion: { fecha: "2026-09-20", responsable: "QA", comunicacion_cliente: { medio: "telefono", fecha: "2026-09-20", persona: "Cliente", respuesta: "Que continúe" } } });
  const reg = await nuevaR();
  const rechSinR = await putR(reg.R, reg.idInt, { inspeccion: insp({ 0: "NC" }), decision_aceptacion: "rechazada", aceptacion: ACEPTACION }, t.ricardo, SIN_REAUTH);
  const rechOk = await putR(reg.R, reg.idInt, { inspeccion: insp({ 0: "NC" }), decision_aceptacion: "rechazada", aceptacion: ACEPTACION }, t.ricardo);
  check("[cob:M:3.1-aceptada_con_desviacion-comunicación] con muestras:A y la comunicación al cliente: desviación → aceptada_con_desviacion; rechazo con reautenticación muestras:A → rechazada", conDesv.status === 201 && rec(conDesv.R).estado === "aceptada_con_desviacion" && JSON.parse(rec(conDesv.R).aceptacion_json || "{}").comunicacion_cliente?.medio === "telefono" && rechSinR.status === 401 && rechSinR.data?.accion === "muestras:A" && rechOk.status === 200 && rec(reg.R).estado === "rechazada", `${sinFila(conDesv)} · ${sinFila(rechSinR)} · ${sinFila(rechOk)}`);
  const pide = await nuevaR(t.mariana, { inspeccion: insp({ 0: "NC" }), decision_aceptacion: "rechazada", aceptacion: ACEPTACION }, SIN_APROBAR);
  const sol = pide.data?.solicitud?.id;
  const porPatricia = await api("POST", `/solicitudes/${sol}/aprobar`, { motivo: "Sin muestras:A no se aprueba" }, t.patricia);
  const antesAprobar = rec(pide.R).estado;
  const porRicardo = await api("POST", `/solicitudes/${sol}/aprobar`, { motivo: "Revisé la inspección: se rechaza" }, t.ricardo);
  check("[cob:M:3.1-decision_recepcion-ejecutarDecisionRecepcion] sin muestras:A el rechazo queda como solicitud decision_recepcion: sin muestras:A (Resp. General) no se aprueba (403) y sigue registrada; la Coord. Técnica la aprueba y la recepción queda rechazada", pide.status === 201 && !!sol && porPatricia.status === 403 && antesAprobar === "registrada" && porRicardo.status === 200 && rec(pide.R).estado === "rechazada" && rec(pide.R).decision_aceptacion === "rechazada" && fila("SELECT estado FROM solicitudes_autorizacion WHERE id = ?", sol)?.estado === "aprobada", `${sinFila(pide)} · ${sinFila(porPatricia)} · ${sinFila(porRicardo)} ${rec(pide.R).estado}`);

  /* Anular / restaurar */
  const borrador = await nuevaR();
  const anSinR = await api("POST", `/samples/reception/${borrador.R}/anular`, { motivo: "Registro duplicado" }, t.ricardo, SIN_REAUTH);
  const anMar = await api("POST", `/samples/reception/${borrador.R}/anular`, { motivo: "Registro duplicado" }, t.mariana);
  const anOk = await api("POST", `/samples/reception/${borrador.R}/anular`, { motivo: "Registro duplicado" }, t.ricardo);
  const r2 = rec(borrador.R);
  const c = await cadena(t, `CY${s5}`);
  const conProc = await api("POST", `/samples/reception/${c.R}/anular`, { motivo: "Tiene procesamiento vigente" }, t.ricardo);
  const acep = await nuevaR(t.qa, { decision_aceptacion: "aceptada", aceptacion: ACEPTACION });
  const anSol = await api("POST", `/samples/reception/${acep.R}/anular`, { motivo: "Se aceptó por error" }, t.ricardo, SIN_APROBAR);
  const anNada = await api("POST", `/samples/reception/${NO_EXISTE}/anular`, { motivo: "No existe este registro" }, t.ricardo);
  check("[cob:M:3.1-cualquiera-anulada-opcionesAnulacion] [cob:M:4-POST-reception-anular-rec:387] anular recepción: sin muestras:AN → 403; reautenticación muestras:AN; registrada → anulada directo (estado_previo registrada); con procesamiento vigente → 409; aceptada → solicitud anular_registro; inexistente → 404", anMar.status === 403 && anSinR.status === 401 && anSinR.data?.accion === "muestras:AN" && anOk.status === 200 && r2.estado === "anulada" && r2.estado_previo === "registrada" && r2.motivo_anulacion === "Registro duplicado" && conProc.status === 409 && rec(c.R).estado !== "anulada" && anSol.status === 202 && anSol.data?.solicitud?.tipo === "anular_registro" && rec(acep.R).estado === "aceptada" && anNada.status === 404, [anMar, anSinR, anOk, conProc, anSol, anNada].map(sinFila).join(" · "));
  await cancelar("muestras_recepcion", acep.R);
  const resOk = await api("POST", `/samples/reception/${borrador.R}/restaurar`, { motivo: "No era duplicado" }, t.ricardo);
  check("[cob:M:3.1-anulada-estado_previo] restaurar una recepción anulada desde registrada: directo, vuelve a su estado_previo y limpia la anulación", resOk.status === 200 && rec(borrador.R).estado === "registrada" && !rec(borrador.R).anulado_en, `${sinFila(resOk)} ${rec(borrador.R).estado}`);

  /* Cambio de folio */
  const f = await nuevaR(t.qa, { decision_aceptacion: "aceptada", aceptacion: ACEPTACION });
  const nuevoFolio = 620000 + (Date.now() % 90000);
  const fSinR = await api("POST", `/samples/reception/${f.R}/folio`, { folio_num: nuevoFolio, motivo: "Folio repetido en la libreta" }, t.ricardo, SIN_REAUTH);
  const fOk = await api("POST", `/samples/reception/${f.R}/folio`, { folio_num: nuevoFolio, motivo: "Folio repetido en la libreta" }, t.ricardo);
  const folioOk = Number(rec(f.R).folio_num);
  const fMarSinR = await api("POST", `/samples/reception/${f.R}/folio`, { folio_num: nuevoFolio + 1, motivo: "Otro folio repetido" }, t.mariana, { ...SIN_REAUTH, ...SIN_APROBAR });
  const fMar = await api("POST", `/samples/reception/${f.R}/folio`, { folio_num: nuevoFolio + 1, motivo: "Otro folio repetido" }, t.mariana, SIN_APROBAR);
  check("[cob:M:3.1-folio-cambiar_folio] cambiar folio: con muestras:A pide reautenticación muestras:A y cambia directo (bitácora «cambiar_folio»); con muestras:E (Técnico Auxiliar) pide muestras:E y queda solicitud cambiar_folio sin cambiar el folio", fSinR.status === 401 && fSinR.data?.accion === "muestras:A" && fOk.status === 200 && folioOk === nuevoFolio && auditorias("cambiar_folio", "muestras_recepcion", f.R) === 1 && fMarSinR.status === 401 && fMarSinR.data?.accion === "muestras:E" && fMar.status === 202 && fMar.data?.solicitud?.tipo === "cambiar_folio" && Number(rec(f.R).folio_num) === nuevoFolio, [fSinR, fOk, fMarSinR, fMar].map(sinFila).join(" · "));
  await cancelar("muestras_recepcion", f.R);
  const fNada = await api("POST", `/samples/reception/${NO_EXISTE}/folio`, { folio_num: nuevoFolio + 2, motivo: "Recepción inexistente" }, t.ricardo);
  const fLuis = await api("POST", `/samples/reception/${f.R}/folio`, { folio_num: nuevoFolio + 2, motivo: "Recepción no asignada" }, t.luis);
  const fHector = await api("POST", `/samples/reception/${f.R}/folio`, { folio_num: nuevoFolio + 2, motivo: "Auditor sin permiso" }, t.hector);
  const fRech = await api("POST", `/samples/reception/${reg.R}/folio`, { folio_num: nuevoFolio + 2, motivo: "Rechazada no cambia" }, t.ricardo);
  check("[cob:M:4-POST-reception-folio-rec:543] cambiar folio: inexistente → 404; ajena con alcance asignado → 403 no_asignado; sin muestras:E → 403; rechazada → 409 estado_invalido (el folio no cambia)", fNada.status === 404 && fLuis.status === 403 && fLuis.data?.codigo === "no_asignado" && fHector.status === 403 && fRech.status === 409 && fRech.data?.codigo === "estado_invalido" && Number(rec(f.R).folio_num) === nuevoFolio, [fNada, fLuis, fHector, fRech].map(sinFila).join(" · "));

  /* Lecturas y edición */
  const lSin = await api("GET", "/samples/reception", undefined, tSin);
  const lLuis = (await api("GET", `/samples/reception?search=${encodeURIComponent(s5)}`, undefined, t.luis)).data?.items || [];
  const lQa = (await api("GET", `/samples/reception?search=${encodeURIComponent(s5)}`, undefined, t.qa)).data?.items || [];
  const lMias = (await api("GET", `/samples/reception?search=${encodeURIComponent(s5)}&mias=1`, undefined, t.ricardo)).data?.items || [];
  check("[cob:M:4-GET-reception-creadas] lista de recepciones: sin muestras:V → 403; alcance asignado (Técnico Analista) no ve las de otros sin asignar; «mias=1» deja solo lo registrado o asignado a quien consulta", lSin.status === 403 && lQa.some((x) => Number(x.id) === Number(nueva.R)) && !lLuis.some((x) => Number(x.id) === Number(nueva.R)) && lMias.length > 0 && lMias.every((x) => Number(fila("SELECT creado_por FROM muestras_recepcion WHERE id = ?", x.id)?.creado_por) === Number(id.ricardo) || !!fila("SELECT id FROM asignaciones_muestra WHERE recepcion_id = ? AND usuario_id = ? AND revocado_en IS NULL", x.id, id.ricardo)) && lMias.some((x) => Number(x.id) === Number(conDesv.R)) && !lMias.some((x) => Number(x.id) === Number(nueva.R)), `${sinFila(lSin)} qa=${lQa.length} luis=${lLuis.length} mias=${lMias.length}`);
  const gNada = await api("GET", `/samples/reception/${NO_EXISTE}`, undefined, t.qa);
  const gLuis = await api("GET", `/samples/reception/${nueva.R}`, undefined, t.luis);
  const gJorge = await api("GET", `/samples/reception/${nueva.R}`, undefined, t.jorge);
  const vista = gJorge.data?.item || {};
  check("[cob:M:4-GET-reception-reducida] ficha de recepción: inexistente → 404; ajena con alcance asignado → 403 no_asignado; alcance estado (Adm. técnico) → vista reducida sin inspección, análisis ni custodio", gNada.status === 404 && gLuis.status === 403 && gLuis.data?.codigo === "no_asignado" && gJorge.status === 200 && vista.solo_estado === true && vista.estado === "registrada" && !("inspeccion" in vista) && !("analisis" in vista) && !("datos_custodio" in vista), `${sinFila(gNada)} · ${sinFila(gLuis)} · ${gJorge.status} ${Object.keys(vista).join(",")}`);
  const pNada = await api("PUT", `/samples/reception/${NO_EXISTE}`, datosR(sello()), t.qa);
  const pHector = await putR(nueva.R, nueva.idInt, { especificaciones: "Auditor sin permiso" }, t.hector);
  const pAnul = await putR(borrador.R, borrador.idInt, { especificaciones: "Cambio permitido" });
  check("[cob:M:4-PUT-reception-rec:294] editar recepción: inexistente → 404; sin muestras:E (auditor) → 403 y no cambia; con E (QA) se guarda; ajena 403 y bloqueada 409 (V-18)", pNada.status === 404 && pHector.status === 403 && rec(nueva.R).especificaciones !== "Auditor sin permiso" && pAnul.status === 200 && rec(borrador.R).especificaciones === "Cambio permitido", [pNada, pHector, pAnul].map(sinFila).join(" · "));
  const puedeQa = await api("GET", "/samples/puede-crear", undefined, t.qa);
  const puedeJorge = await api("GET", "/samples/puede-crear", undefined, t.jorge);
  const puedeSinAut = await api("GET", "/samples/puede-crear", undefined, tSinAut);
  check("[cob:M:4-GET-puede-crear] banderas de alta por objeto: QA puede todo; Adm. técnico nada; sin la autorización FX-THF-AP la recepción queda bloqueada con el motivo", puedeQa.status === 200 && ["recepcion", "procesamiento", "extraccion", "analisis", "informe"].every((k) => puedeQa.data?.puede?.[k]?.ok === true) && puedeJorge.status === 200 && Object.values(puedeJorge.data?.puede || {}).every((v) => v.ok === false) && puedeSinAut.data?.puede?.recepcion?.ok === false && /recepci/i.test(puedeSinAut.data?.puede?.recepcion?.motivo || ""), `${JSON.stringify(puedeQa.data?.puede)} · ${JSON.stringify(puedeJorge.data?.puede)} · ${JSON.stringify(puedeSinAut.data?.puede?.recepcion)}`);

  /* GET /api/samples (mezcla) */
  const mSin = await api("GET", "/samples", undefined, tSin);
  const mQa = await api("GET", "/samples", undefined, t.qa);
  const propia = await nuevaR(t.diego);
  const mDiego = (await api("GET", "/samples", undefined, t.diego)).data?.items || [];
  check("[cob:M:4-GET-samples-LIMIT] GET /samples: sin muestras:V ni ensayos:V → 403; trae a lo más 200; con alcance asignado (estudiante) solo lo propio o asignado", mSin.status === 403 && mQa.status === 200 && (mQa.data?.items || []).length <= 200 && mDiego.some((x) => x.tipo === "Recepcion" && Number(x.id) === Number(propia.R)) && !mDiego.some((x) => x.tipo === "Recepcion" && Number(x.id) === Number(nueva.R)), `${sinFila(mSin)} · qa=${(mQa.data?.items || []).length} diego=${mDiego.length}`);

  /* Asignaciones */
  const asigna = await nuevaR(t.qa, { decision_aceptacion: "aceptada", aceptacion: ACEPTACION });
  const aMar = await api("POST", `/samples/reception/${asigna.R}/asignaciones`, { usuario_id: id.luis }, t.mariana);
  const aNada = await api("POST", `/samples/reception/${NO_EXISTE}/asignaciones`, { usuario_id: id.luis }, t.ricardo);
  const aOk = await api("POST", `/samples/reception/${asigna.R}/asignaciones`, { usuario_id: id.luis, motivo: "Turno de la mañana" }, t.ricardo);
  const vig = fila("SELECT * FROM asignaciones_muestra WHERE recepcion_id = ? AND usuario_id = ?", asigna.R, id.luis);
  check("[cob:M:3.6-asignación-vigente-aceptada] [cob:M:4-POST-asignaciones-asg:119] asignar: sin muestras:A → 403; inexistente → 404; recepción aceptada → asignación vigente con motivo, quién asignó y bitácora «asignar_muestra» (409 sin aceptar y 400 sin cuenta activa: V-32/V-33)", aMar.status === 403 && aNada.status === 404 && aOk.status === 201 && !!vig && !vig.revocado_en && vig.motivo === "Turno de la mañana" && Number(vig.asignado_por) === Number(id.ricardo) && auditorias("asignar_muestra", "muestras_recepcion", asigna.R) === 1, [aMar, aNada, aOk].map(sinFila).join(" · "));
  const ver = await api("GET", `/samples/reception/${asigna.R}/asignaciones`, undefined, t.luis);
  const verAjena = await api("GET", `/samples/reception/${nueva.R}/asignaciones`, undefined, t.luis);
  const verNada = await api("GET", `/samples/reception/${NO_EXISTE}/asignaciones`, undefined, t.qa);
  const verJorge = await api("GET", `/samples/reception/${asigna.R}/asignaciones`, undefined, t.jorge);
  const verRic = await api("GET", `/samples/reception/${asigna.R}/asignaciones`, undefined, t.ricardo);
  check("[cob:M:4-GET-asignaciones-asg:110] asignaciones: la persona asignada las ve (sin poder asignar); ajena con alcance asignado → 403 no_asignado; inexistente → 404; la coordinación ve puede_asignar", ver.status === 200 && (ver.data?.items || []).some((x) => Number(x.usuario_id) === Number(id.luis)) && ver.data?.puede_asignar === false && verAjena.status === 403 && verAjena.data?.codigo === "no_asignado" && verNada.status === 404 && verRic.data?.puede_asignar === true && verJorge.status === 200, [ver, verAjena, verNada, verJorge, verRic].map(sinFila).join(" · "));
}

/* ---------- Cadena completa: estados de recepción, procesamiento, extracción, análisis e informe ---------- */
{
  const R0 = await nuevaR(t.qa, { decision_aceptacion: "aceptada", aceptacion: ACEPTACION });
  const R = R0.R;
  const eR = () => rec(R).estado;
  const P = (await api("POST", "/samples/processing", datosP(R, R0.idInt), t.qa)).data?.id;
  const trasP = eR();
  check("[cob:M:3.1-aceptada*-en_procesamiento-primer] aceptada → en_procesamiento con el primer procesamiento (registrado)", R0.status === 201 && !!P && trasP === "en_procesamiento" && proc(P)?.estado === "registrada", `${trasP} ${proc(P)?.estado}`);
  check("[cob:M:3.2-registrada-existencia] — → registrada: procesamiento de una recepción aceptada (409 sin aceptar: V-41; 403 no_asignado: V-48; existencia: V-49)", proc(P)?.estado === "registrada" && Number(proc(P)?.folio_recepcion_num) === Number(rec(R).folio_num), JSON.stringify({ e: proc(P)?.estado, f: proc(P)?.folio_recepcion_num }));
  const E = (await api("POST", "/samples/extraction", datosE(P, R0.idInt), t.qa)).data?.id;
  check("[cob:M:3.1-en_extraccion-extraccion-procesamiento] [cob:M:3.2-en_proceso-advanceState] [cob:M:3.3-registrada-suspension] la primera extracción queda registrada, el procesamiento pasa a en_proceso y la recepción a en_extraccion", !!E && ext(E)?.estado === "registrada" && proc(P)?.estado === "en_proceso" && eR() === "en_extraccion", `${ext(E)?.estado} ${proc(P)?.estado} ${eR()}`);
  const A = (await api("POST", "/samples/analysis", analisisDe({ E, idInt: R0.idInt }), t.qa)).data?.id;
  const trasA = eR();
  check("[cob:M:3.4-registrado-origen] — → registrado: el análisis deriva la cadena de la extracción (procesamiento y recepción)", !!A && estadoA(A) === "registrado" && Number(fila("SELECT recepcion_id FROM muestras_analisis WHERE id = ?", A)?.recepcion_id) === Number(R) && Number(fila("SELECT procesamiento_id FROM muestras_analisis WHERE id = ?", A)?.procesamiento_id) === Number(P), `${estadoA(A)}`);
  await api("POST", `/samples/analysis/${A}/enviar-revision`, {}, t.qa);
  const enRev = estadoA(A);
  const revQa = await api("POST", `/samples/analysis/${A}/revisar`, {}, t.qa);
  const revOk = await api("POST", `/samples/analysis/${A}/revisar`, {}, t.ricardo);
  const trasRev = eR();
  check("[cob:M:3.4-en_revision-enviar] registrado → en_revision al enviar (con su evidencia)", enRev === "en_revision", enRev);
  check("[cob:M:3.4-revisado-excepcion_segregacion] [cob:M:3.1-en_analisis-en_revision_tecnica] en_revision → revisado: quien lo elaboró → 409 segregacion; otra persona con ensayos:R lo revisa; la recepción pasa de en_analisis a en_revision_tecnica", trasA === "en_analisis" && revQa.status === 409 && revQa.data?.codigo === "segregacion" && revOk.status === 200 && estadoA(A) === "revisado" && trasRev === "en_revision_tecnica", `${trasA} · ${sinFila(revQa)} · ${sinFila(revOk)} ${trasRev}`);
  const aprQa = await api("POST", `/samples/analysis/${A}/aprobar`, {}, t.qa);
  const aprSinR = await api("POST", `/samples/analysis/${A}/aprobar`, {}, t.ricardo, SIN_REAUTH);
  const aprOk = await api("POST", `/samples/analysis/${A}/aprobar`, {}, t.ricardo);
  check("[cob:M:3.4-aprobado-revisor] revisado → aprobado: el elaborador no aprueba (409 segregacion); quien revisó sí, con reautenticación ensayos:A", aprQa.status === 409 && aprQa.data?.codigo === "segregacion" && aprSinR.status === 401 && aprSinR.data?.accion === "ensayos:A" && aprOk.status === 200 && estadoA(A) === "aprobado", [aprQa, aprSinR, aprOk].map(sinFila).join(" · "));
  check("[cob:M:3.1-validada-validarRecepcionSiCompleta] [cob:M:3.2-completada] [cob:M:3.3-analizada] al aprobar el único análisis: recepción validada, procesamiento completada y extracción analizada", eR() === "validada" && proc(P)?.estado === "completada" && ext(E)?.estado === "analizada", `${eR()} ${proc(P)?.estado} ${ext(E)?.estado}`);
  const I = (await api("POST", "/informes", { recepcion_id: R, analisis_ids: [A], cliente: { nombre: `Cliente cadena ${s5}`, correo: "cliente@ejemplo.mx" } }, t.qa)).data?.id;
  check("[cob:M:3.5-borrador-cliente] [cob:M:3.1-informe_elaborado] — → borrador: informe con el cliente sobre una recepción vigente; la recepción pasa a informe_elaborado", inf(I)?.estado === "borrador" && JSON.parse(inf(I)?.cliente_json || "{}").nombre === `Cliente cadena ${s5}` && eR() === "informe_elaborado", `${inf(I)?.estado} ${eR()} ${inf(I)?.cliente_json}`);
  const irQa = await api("POST", `/informes/${I}/revisar`, {}, t.qa);
  const irOk = await api("POST", `/informes/${I}/revisar`, {}, t.ricardo);
  check("[cob:M:3.5-en_revision-elaboradores] borrador → en_revision: quien elaboró el informe → 409 segregacion; otra persona con informes:R lo revisa", irQa.status === 409 && irQa.data?.codigo === "segregacion" && irOk.status === 200 && inf(I)?.estado === "en_revision", `${sinFila(irQa)} · ${sinFila(irOk)}`);
  const iaSinR = await api("POST", `/informes/${I}/autorizar`, {}, t.ricardo, SIN_REAUTH);
  const iaQa = await api("POST", `/informes/${I}/autorizar`, {}, t.qa);
  const iaOk = await api("POST", `/informes/${I}/autorizar`, {}, t.ricardo);
  check("[cob:M:3.5-autorizado-todos] en_revision → autorizado: el elaborador no autoriza (409 segregacion); quien revisó sí, con reautenticación informes:A", iaQa.status === 409 && iaQa.data?.codigo === "segregacion" && iaSinR.status === 401 && iaSinR.data?.accion === "informes:A" && iaOk.status === 200 && inf(I)?.estado === "autorizado", [iaQa, iaSinR, iaOk].map(sinFila).join(" · "));
  const ilSinR = await api("POST", `/informes/${I}/liberar`, {}, t.ricardo, SIN_REAUTH);
  const ilOk = await api("POST", `/informes/${I}/liberar`, {}, t.ricardo);
  const fI = inf(I);
  const ruta = fI?.archivo_pdf ? path.join(path.dirname(process.env.TEST_DB_PATH), "informes", String(fI.archivo_pdf)) : "";
  const sha = ruta && existsSync(ruta) ? createHash("sha256").update(readFileSync(ruta)).digest("hex") : "";
  check("[cob:M:3.5-liberado-SHA] [cob:M:3.1-liberada-inf:547] autorizado → liberado con reautenticación informes:A: PDF final cuyo SHA-256 coincide con el guardado; la recepción queda liberada", ilSinR.status === 401 && ilSinR.data?.accion === "informes:A" && ilOk.status === 200 && fI?.estado === "liberado" && !!sha && sha === fI?.pdf_sha256 && eR() === "liberada", `${sinFila(ilSinR)} · ${sinFila(ilOk)} ${fI?.estado} ${sha.slice(0, 12)} ${String(fI?.pdf_sha256 || "").slice(0, 12)} ${eR()}`);
  const env = await registrarEnvio(BASE, t.ricardo, I, { observaciones: "Primer envío de la cadena" });
  const e = fila("SELECT * FROM envios_informe WHERE informe_id = ? ORDER BY id DESC", I);
  const evRuta = e?.evidencia_archivo ? path.join(path.dirname(process.env.TEST_DB_PATH), "informes", "envios", String(e.evidencia_archivo)) : "";
  check("[cob:M:3.5-enviado-primer] [cob:M:3.6-envío-registrado-evidencia] liberado → enviado con el primer envío manual: envío registrado con su evidencia (archivo y SHA-256)", env.status === 200 && inf(I)?.estado === "enviado" && !!e && !!e.evidencia_sha256 && !!evRuta && existsSync(evRuta) && createHash("sha256").update(readFileSync(evRuta)).digest("hex") === e.evidencia_sha256 && !e.confirmacion_en, `${env.status} ${env.data?.message} ${inf(I)?.estado} ${e?.evidencia_archivo}`);
  const confSinFecha = await api("POST", `/informes/${I}/envios/${e?.id}/confirmar`, {}, t.ricardo);
  const conf = await api("POST", `/informes/${I}/envios/${e?.id}/confirmar`, { confirmacion_en: "2026-09-26T10:00", confirmacion_nota: "El cliente acusó recibo" }, t.ricardo);
  check("[cob:M:3.6-envío-confirmado] envío registrado → confirmado: sin fecha → 400; con fecha queda la confirmación y su nota", confSinFecha.status === 400 && conf.status === 200 && !!fila("SELECT confirmacion_en FROM envios_informe WHERE id = ?", e?.id)?.confirmacion_en && fila("SELECT confirmacion_nota FROM envios_informe WHERE id = ?", e?.id)?.confirmacion_nota === "El cliente acusó recibo", `${sinFila(confSinFecha)} · ${sinFila(conf)}`);

  /* Enmienda del análisis (3.4) y del informe (3.5) */
  const enm = await api("POST", `/samples/analysis/${A}/enmendar`, { motivo: "Se corrige la unidad" }, t.qa);
  const A2 = enm.data?.id;
  const v2 = fila("SELECT estado, version, folio_num FROM muestras_analisis WHERE id = ?", A2);
  const origAntes = estadoA(A);
  await flujoAnalisis(A2);
  check("[cob:M:3.4-sustituido-enmendar] aprobado → enmienda v+1 registrada (mismo folio) y el original sigue aprobado; al aprobar la nueva el original queda sustituido y el informe enviado se marca «requiere enmienda»", enm.status === 201 && v2?.estado === "registrado" && Number(v2?.version) === 2 && Number(v2?.folio_num) === Number(fila("SELECT folio_num FROM muestras_analisis WHERE id = ?", A)?.folio_num) && origAntes === "aprobado" && estadoA(A2) === "aprobado" && estadoA(A) === "sustituido" && Number(inf(I)?.requiere_enmienda) === 1, `${sinFila(enm)} ${JSON.stringify(v2)} ${origAntes} → ${estadoA(A)} req=${inf(I)?.requiere_enmienda}`);
  const ienm = await api("POST", `/informes/${I}/enmienda`, { motivo: "Se corrige con el análisis enmendado" }, t.qa);
  const I2 = ienm.data?.id;
  const antesLib = inf(I)?.estado;
  await api("PUT", `/informes/${I2}`, { recepcion_id: R, analisis_ids: [A2], cliente: { nombre: `Cliente cadena ${s5}` } }, t.qa);
  await api("POST", `/informes/${I2}/revisar`, {}, t.ricardo);
  await api("POST", `/informes/${I2}/autorizar`, {}, t.ricardo);
  const lib2 = await api("POST", `/informes/${I2}/liberar`, {}, t.ricardo);
  check("[cob:M:3.5-nueva-versión-enmienda] enviado → enmienda: nueva versión en borrador (v2) y el original sigue enviado; al liberar la nueva el original queda sustituido", ienm.status === 201 && inf(I2)?.version === 2 && antesLib === "enviado" && lib2.status === 200 && inf(I2)?.estado === "liberado" && inf(I)?.estado === "sustituido", `${sinFila(ienm)} ${antesLib} → ${inf(I)?.estado} · ${sinFila(lib2)} ${inf(I2)?.estado}`);
  const anSol = await api("POST", `/informes/${I}/anular`, { motivo: "Versión sustituida que se retira" }, t.patricia, SIN_APROBAR);
  check("[cob:M:3.5-sustituido-anular_informe] anular un informe sustituido (o autorizado/liberado/enviado) → reautenticación y solicitud anular_informe; no se anula hasta aprobarla", anSol.status === 202 && anSol.data?.solicitud?.tipo === "anular_informe" && inf(I)?.estado === "sustituido", `${sinFila(anSol)} ${inf(I)?.estado}`);
  await cancelar("informes", I);
}

/* ---------- Informes: anular borrador, análisis, liberar bloqueado y retención ---------- */
{
  const c = await cadena(t, `CZ${s5}`);
  const A = (await api("POST", "/samples/analysis", analisisDe(c), t.qa)).data?.id;
  const sinAnalisis = await api("POST", "/informes", { recepcion_id: c.R, analisis_ids: [], cliente: { nombre: "Cliente sin análisis" } }, t.qa);
  const revVacio = await api("POST", `/informes/${sinAnalisis.data?.id}/revisar`, {}, t.ricardo);
  const conPendiente = await api("POST", "/informes", { recepcion_id: c.R, analisis_ids: [A], cliente: { nombre: "Cliente con análisis sin aprobar" } }, t.qa);
  const Ic = conPendiente.data?.id;
  const revC = await api("POST", `/informes/${Ic}/revisar`, {}, t.ricardo);
  const autC = await api("POST", `/informes/${Ic}/autorizar`, {}, t.patricia);
  check("[cob:M:V-83] crear el informe sin análisis o con uno sin aprobar se acepta; revisarlo sin análisis → 400; autorizarlo con un análisis sin aprobar → 409 «Hay analisis sin aprobar» (sigue en revisión)", sinAnalisis.status === 201 && revVacio.status === 400 && /no incluye analisis/i.test(revVacio.data?.message || "") && inf(sinAnalisis.data?.id)?.estado === "borrador" && conPendiente.status === 201 && revC.status === 200 && autC.status === 409 && /sin aprobar/i.test(autC.data?.message || "") && inf(Ic)?.estado === "en_revision", [sinAnalisis, revVacio, conPendiente, revC, autC].map(sinFila).join(" · "));
  const bor = sinAnalisis.data?.id;
  const anSinR = await api("POST", `/informes/${bor}/anular`, { motivo: "Borrador sin análisis" }, t.patricia, SIN_REAUTH);
  const anOk = await api("POST", `/informes/${bor}/anular`, { motivo: "Borrador sin análisis" }, t.patricia);
  const anRev = await api("POST", `/informes/${Ic}/anular`, { motivo: "Informe en revisión que se retira" }, t.patricia);
  check("[cob:M:3.5-borrador/en_revision-anulado] borrador y en_revision → anulado directo tras reautenticación informes:AN, con su motivo", anSinR.status === 401 && anSinR.data?.accion === "informes:AN" && anOk.status === 200 && inf(bor)?.estado === "anulado" && anRev.status === 200 && inf(Ic)?.estado === "anulado" && inf(Ic)?.motivo_anulacion === "Informe en revisión que se retira", [anSinR, anOk, anRev].map(sinFila).join(" · "));
  // V-85: análisis con una solicitud pendiente (anulación) no entra a un informe.
  await flujoAnalisis(A, "en_revision");
  const pideAnular = await api("POST", `/samples/analysis/${A}/anular`, { motivo: "Resultado dudoso" }, t.ricardo, SIN_APROBAR);
  const conSol = await api("POST", "/informes", { recepcion_id: c.R, analisis_ids: [A], cliente: { nombre: "Cliente con solicitud" } }, t.qa);
  check("[cob:M:V-85] informe con un análisis que tiene una solicitud pendiente → 409 solicitud_pendiente (no se crea)", pideAnular.status === 202 && conSol.status === 409 && conSol.data?.codigo === "solicitud_pendiente" && !fila("SELECT id FROM informes WHERE cliente_json LIKE ?", "%Cliente con solicitud%"), `${sinFila(pideAnular)} · ${sinFila(conSol)}`);
  await cancelar("muestras_analisis", A);

  // V-89: liberar con requiere enmienda o retenido por una NC.
  const c2 = await cadena(t, `CW${s5}`);
  const A2 = (await api("POST", "/samples/analysis", analisisDe(c2), t.qa)).data?.id;
  await flujoAnalisis(A2);
  const I2 = (await api("POST", "/informes", { recepcion_id: c2.R, analisis_ids: [A2], cliente: { nombre: "Cliente por liberar" } }, t.qa)).data?.id;
  await api("POST", `/informes/${I2}/revisar`, {}, t.ricardo);
  await api("POST", `/informes/${I2}/autorizar`, {}, t.patricia);
  const enmA = (await api("POST", `/samples/analysis/${A2}/enmendar`, { motivo: "Se corrige la unidad" }, t.qa)).data?.id;
  await flujoAnalisis(enmA);
  const libReq = await api("POST", `/informes/${I2}/liberar`, {}, t.patricia);
  check("[cob:M:V-89] liberar un informe autorizado que requiere enmienda → 409 requiere_enmienda (sigue autorizado, sin PDF)", Number(inf(I2)?.requiere_enmienda) === 1 && libReq.status === 409 && libReq.data?.codigo === "requiere_enmienda" && inf(I2)?.estado === "autorizado" && !inf(I2)?.archivo_pdf, `${inf(I2)?.requiere_enmienda} · ${sinFila(libReq)}`);
  const c3 = await cadena(t, `CV${s5}`);
  const A3 = (await api("POST", "/samples/analysis", analisisDe(c3), t.qa)).data?.id;
  await flujoAnalisis(A3);
  const I3 = (await api("POST", "/informes", { recepcion_id: c3.R, analisis_ids: [A3], cliente: { nombre: "Cliente retenido" } }, t.qa)).data?.id;
  await api("POST", `/informes/${I3}/revisar`, {}, t.ricardo);
  await api("POST", `/informes/${I3}/autorizar`, {}, t.patricia);
  const ret = await api("POST", `/calidad/nc/${globalThis.NC_COB}/retenciones`, { informe_id: I3, motivo: "Resultados en duda por el vórtex" }, t.ana);
  const libRet = await api("POST", `/informes/${I3}/liberar`, {}, t.patricia);
  check("[cob:M:V-89] liberar un informe retenido por una NC → 409 (sigue autorizado)", ret.status === 201 && libRet.status === 409 && /retenid/i.test(libRet.data?.message || "") && inf(I3)?.estado === "autorizado", `${sinFila(ret)} · ${sinFila(libRet)}`);
  const rid = fila("SELECT id FROM retenciones_informe WHERE informe_id = ? AND liberada_en IS NULL ORDER BY id DESC", I3)?.id;
  const libera = await api("POST", `/calidad/retenciones/${rid}/liberar`, { motivo: "La NC confirmó que el vórtex no afectó" }, t.ana);
  const libOk = await api("POST", `/informes/${I3}/liberar`, {}, t.patricia);
  check("[cob:M:3.6-retención-bloquea] retención activa → liberada: mientras está activa bloquea liberar (409); liberada la retención, el informe se libera", libRet.status === 409 && libera.status === 200 && !!fila("SELECT liberada_en FROM retenciones_informe WHERE id = ?", rid)?.liberada_en && libOk.status === 200 && inf(I3)?.estado === "liberado", `${sinFila(libera)} · ${sinFila(libOk)}`);
}

/* ---------- Procesamiento y extracción: permisos ---------- */
{
  const c = await cadena(t, `CU${s5}`);
  const pSinAut = await api("POST", "/samples/processing", datosP(c.R, c.idInt), tSinAut);
  check("[cob:M:V-50] procesamiento sin la autorización FX-THF-AP de procesamiento → 403 no_autorizado (no se registra)", pSinAut.status === 403 && pSinAut.data?.codigo === "no_autorizado" && filas("SELECT id FROM muestras_procesamiento WHERE recepcion_id = ?", c.R).length === 1, sinFila(pSinAut));
  const pTemp = await api("POST", "/samples/processing", datosP(c.R, c.idInt), tTemp);
  check("[cob:M:V-48] procesamiento de una muestra no asignada (rol sin coordinación) → 403 no_asignado; la coordinación (QA) sí registra", pTemp.status === 403 && pTemp.data?.codigo === "no_asignado" && filas("SELECT id FROM muestras_procesamiento WHERE recepcion_id = ?", c.R).length === 1, sinFila(pTemp));
  const pHector = await api("POST", "/samples/processing", datosP(c.R, c.idInt), t.hector);
  check("[cob:M:4-POST-processing-proc:177] crear procesamiento: sin ensayos:C (auditor) → 403; sin asignación → 403 no_asignado (V-48); insumos sin inventario:C → 403 (V-49)", pHector.status === 403 && /ensayos:C/.test(pHector.data?.message || "") && pTemp.data?.codigo === "no_asignado", sinFila(pHector));
  const gJorge = await api("GET", "/samples/processing", undefined, t.jorge);
  const gDiego = (await api("GET", `/samples/processing?search=${c.idInt}`, undefined, t.diego)).data?.items || [];
  const gQa = (await api("GET", `/samples/processing?search=${c.idInt}`, undefined, t.qa)).data?.items || [];
  const gMias = (await api("GET", `/samples/processing?search=${c.idInt}&mias=1`, undefined, t.ricardo)).data?.items || [];
  check("[cob:M:4-GET-processing-proc:106] lista de procesamientos: sin ensayos:V → 403; el estudiante no ve los de muestras no asignadas; «mias=1» los quita a quien no está asignado", gJorge.status === 403 && gQa.some((x) => Number(x.id) === Number(c.P)) && !gDiego.some((x) => Number(x.id) === Number(c.P)) && !gMias.some((x) => Number(x.id) === Number(c.P)), `${sinFila(gJorge)} qa=${gQa.length} diego=${gDiego.length} mias=${gMias.length}`);
  const fNada = await api("GET", `/samples/processing/${NO_EXISTE}`, undefined, t.qa);
  const fDiego = await api("GET", `/samples/processing/${c.P}`, undefined, t.diego);
  const fHector = await api("GET", `/samples/processing/${c.P}`, undefined, t.hector);
  check("[cob:M:4-GET-processing-proc:144] ficha de procesamiento: inexistente → 404; el auditor (ensayos:V total) la ve; el estudiante sin asignación → 403 no_asignado (ver RENGLÓN DESACTUALIZADO)", fNada.status === 404 && fHector.status === 200 && Number(fHector.data?.item?.id) === Number(c.P) && fDiego.status === 403 && fDiego.data?.codigo === "no_asignado", [fNada, fHector, fDiego].map(sinFila).join(" · "));
  const uNada = await api("PUT", `/samples/processing/${NO_EXISTE}`, datosP(c.R, c.idInt, { folio_num: 1 }), t.qa);
  const uHector = await api("PUT", `/samples/processing/${c.P}`, datosP(c.R, c.idInt, { folio_num: proc(c.P).folio_num, observaciones_generales: "Auditor" }), t.hector);
  const pAn = (await api("POST", "/samples/processing", datosP(c.R, c.idInt), t.qa)).data?.id;
  await api("POST", `/samples/processing/${pAn}/anular`, { motivo: "Procesamiento duplicado" }, t.ricardo);
  const uAnul = await api("PUT", `/samples/processing/${pAn}`, datosP(c.R, c.idInt, { folio_num: proc(pAn).folio_num, observaciones_generales: "Editar anulado" }), t.qa);
  check("[cob:M:4-PUT-processing-proc:259] editar procesamiento: inexistente → 404; sin ensayos:E (auditor) → 403; anulado → 409; nada cambia", uNada.status === 404 && uHector.status === 403 && uAnul.status === 409 && proc(pAn).observaciones_generales !== "Editar anulado" && proc(c.P).observaciones_generales !== "Auditor", [uNada, uHector, uAnul].map(sinFila).join(" · "));
  const aLuis = await api("POST", `/samples/processing/${c.P}/anular`, { motivo: "Sin permiso para anular" }, t.luis);
  const aNada = await api("POST", `/samples/processing/${NO_EXISTE}/anular`, { motivo: "No existe este registro" }, t.ricardo);
  check("[cob:M:4-POST-processing-anular-proc:351] anular procesamiento: sin ensayos:AN → 403; inexistente → 404; con extracciones → 409 y reautenticación ensayos:AN (3.2-anular)", aLuis.status === 403 && aNada.status === 404 && proc(c.P).estado !== "anulada", `${sinFila(aLuis)} · ${sinFila(aNada)}`);
  const rLuis = await api("POST", `/samples/processing/${pAn}/restaurar`, { motivo: "Sin permiso para restaurar" }, t.luis);
  const rSinR = await api("POST", `/samples/processing/${pAn}/restaurar`, { motivo: "No era duplicado" }, t.ricardo, SIN_REAUTH);
  const pEnProc = c.P;
  await api("POST", `/samples/extraction/${c.E}/anular`, { motivo: "Extracción repetida por error" }, t.ricardo);
  const anPend = await api("POST", `/samples/processing/${pEnProc}/anular`, { motivo: "Procesamiento en curso a anular" }, t.ricardo);
  const resSol = await api("POST", `/samples/processing/${pEnProc}/restaurar`, { motivo: "Se anuló por error" }, t.ricardo, SIN_APROBAR);
  check("[cob:M:POST-processing-restaurar] restaurar procesamiento: sin ensayos:AN → 403; reautenticación ensayos:AN; anulado desde en_proceso → solicitud restaurar_registro (sigue anulado)", rLuis.status === 403 && rSinR.status === 401 && rSinR.data?.accion === "ensayos:AN" && proc(pAn).estado === "anulada" && anPend.status === 200 && proc(pEnProc).estado === "anulada" && resSol.status === 202 && resSol.data?.solicitud?.tipo === "restaurar_registro" && proc(pEnProc).estado === "anulada", [rLuis, rSinR, anPend, resSol].map(sinFila).join(" · "));
  await cancelar("muestras_procesamiento", pEnProc);

  /* Extracción */
  const d = await cadena(t, `CT${s5}`);
  const eTemp = await api("POST", "/samples/extraction", datosE(d.P, d.idInt), tTemp);
  const eHector = await api("POST", "/samples/extraction", datosE(d.P, d.idInt), t.hector);
  check("[cob:M:4-POST-extraction-ext:270] crear extracción: sin ensayos:C → 403; sin asignación → 403 no_asignado; equipos sin equipos:C (V-59) y equipo suspendido (V-58)", eHector.status === 403 && eTemp.status === 403 && eTemp.data?.codigo === "no_asignado" && filas("SELECT id FROM muestras_extraccion WHERE procesamiento_id = ?", d.P).length === 1, `${sinFila(eHector)} · ${sinFila(eTemp)}`);
  check("[cob:M:3.3-registrada-suspension] — → registrada: la extracción exige procesamiento (V-54), sin suspensión (V-58) y asignación (no_asignado)", eTemp.data?.codigo === "no_asignado" && ext(d.E)?.estado === "registrada", `${ext(d.E)?.estado}`);
  const lJorge = await api("GET", "/samples/extraction", undefined, t.jorge);
  const lTipo = (await api("GET", `/samples/extraction?tipo=E-A&search=${d.idInt}`, undefined, t.qa)).data?.items || [];
  const lTipoD = (await api("GET", `/samples/extraction?tipo=E-D&search=${d.idInt}`, undefined, t.qa)).data?.items || [];
  const lDiego = (await api("GET", `/samples/extraction?search=${d.idInt}`, undefined, t.diego)).data?.items || [];
  check("[cob:M:4-GET-extraction-ext:185] lista de extracciones: sin ensayos:V → 403; «tipo» filtra la serie (E-D sí, E-A no); el estudiante no ve las no asignadas", lJorge.status === 403 && lTipoD.some((x) => Number(x.id) === Number(d.E)) && !lTipo.some((x) => Number(x.id) === Number(d.E)) && !lDiego.some((x) => Number(x.id) === Number(d.E)), `${sinFila(lJorge)} EA=${lTipo.length} ED=${lTipoD.length} diego=${lDiego.length}`);
  const nfMal = await api("GET", "/samples/extraction/next-folio?tipo=E-X", undefined, t.qa);
  const nfD = await api("GET", "/samples/extraction/next-folio?tipo=E-D", undefined, t.qa);
  const nfJorge = await api("GET", "/samples/extraction/next-folio?tipo=E-D", undefined, t.jorge);
  const maxD = Number(fila("SELECT MAX(folio_num) AS m FROM muestras_extraccion WHERE tipo_registro = 'E-D'")?.m || 0);
  check("[cob:M:4-GET-extraction-next-folio] siguiente folio de extracción: tipo inválido → 400; E-D → MAX + 1 de su serie; sin ensayos:V → 403", nfMal.status === 400 && nfD.status === 200 && Number(nfD.data?.next_folio) === maxD + 1 && nfJorge.status === 403, `${sinFila(nfMal)} · ${nfD.data?.next_folio} vs ${maxD} · ${sinFila(nfJorge)}`);
  const xNada = await api("GET", `/samples/extraction/${NO_EXISTE}`, undefined, t.qa);
  const xDiego = await api("GET", `/samples/extraction/${d.E}`, undefined, t.diego);
  const xHector = await api("GET", `/samples/extraction/${d.E}`, undefined, t.hector);
  check("[cob:M:4-GET-extraction-ext:239] ficha de extracción: inexistente → 404; auditor → 200; estudiante sin asignación → 403 no_asignado", xNada.status === 404 && xHector.status === 200 && xDiego.status === 403 && xDiego.data?.codigo === "no_asignado", [xNada, xHector, xDiego].map(sinFila).join(" · "));
  const folioE = ext(d.E).folio_num;
  const xuNada = await api("PUT", `/samples/extraction/${NO_EXISTE}`, datosE(d.P, d.idInt, { folio_num: 1 }), t.qa);
  const xuHector = await api("PUT", `/samples/extraction/${d.E}`, datosE(d.P, d.idInt, { folio_num: folioE, observaciones_generales: "Auditor" }), t.hector);
  const eAn = (await api("POST", "/samples/extraction", datosE(d.P, d.idInt), t.qa)).data?.id;
  await api("POST", `/samples/extraction/${eAn}/anular`, { motivo: "Extracción duplicada" }, t.ricardo);
  const xuAnul = await api("PUT", `/samples/extraction/${eAn}`, datosE(d.P, d.idInt, { folio_num: ext(eAn).folio_num, observaciones_generales: "Editar anulada" }), t.qa);
  check("[cob:M:4-PUT-extraction-ext:357] editar extracción: inexistente → 404; sin ensayos:E → 403; anulada → 409; nada cambia", xuNada.status === 404 && xuHector.status === 403 && xuAnul.status === 409 && ext(eAn).observaciones_generales !== "Editar anulada" && ext(d.E).observaciones_generales !== "Auditor", [xuNada, xuHector, xuAnul].map(sinFila).join(" · "));
  const xdAN = await api("DELETE", `/samples/extraction/${d.E}`, { motivo: "Intento de borrado" }, t.ricardo);
  const xdLuis = await api("DELETE", `/samples/extraction/${d.E}`, { motivo: "Intento de borrado" }, t.luis);
  check("[cob:M:4-DELETE-extraction] borrar una extracción: con ensayos:AN → 405; sin AN → 403; el registro sigue", xdAN.status === 405 && xdLuis.status === 403 && ext(d.E)?.estado === "registrada", `${sinFila(xdAN)} · ${sinFila(xdLuis)}`);
  const xaLuis = await api("POST", `/samples/extraction/${d.E}/anular`, { motivo: "Sin permiso para anular" }, t.luis);
  const xaNada = await api("POST", `/samples/extraction/${NO_EXISTE}/anular`, { motivo: "No existe este registro" }, t.ricardo);
  check("[cob:M:4-POST-extraction-anular-ext:454] anular extracción: sin ensayos:AN → 403; inexistente → 404; con análisis → 409 (3.3-anular)", xaLuis.status === 403 && xaNada.status === 404 && ext(d.E).estado === "registrada", `${sinFila(xaLuis)} · ${sinFila(xaNada)}`);
  const xrLuis = await api("POST", `/samples/extraction/${eAn}/restaurar`, { motivo: "Sin permiso para restaurar" }, t.luis);
  const xrNada = await api("POST", `/samples/extraction/${NO_EXISTE}/restaurar`, { motivo: "No existe este registro" }, t.ricardo);
  const xrVig = await api("POST", `/samples/extraction/${d.E}/restaurar`, { motivo: "No está anulada" }, t.ricardo);
  const xrSinR = await api("POST", `/samples/extraction/${eAn}/restaurar`, { motivo: "Se anuló por error" }, t.ricardo, SIN_REAUTH);
  check("[cob:M:4-POST-extraction-restaurar-ext:466] restaurar extracción: sin ensayos:AN → 403; inexistente → 404; no anulada → 409; reautenticación ensayos:AN", xrLuis.status === 403 && xrNada.status === 404 && xrVig.status === 409 && xrSinR.status === 401 && xrSinR.data?.accion === "ensayos:AN" && ext(eAn).estado === "anulada", [xrLuis, xrNada, xrVig, xrSinR].map(sinFila).join(" · "));
}

/* ---------- Análisis y evidencia: permisos ---------- */
{
  const c = await cadena(t, `CS${s5}`);
  const base = analisisDe(c);
  const A = (await api("POST", "/samples/analysis", base, t.qa)).data?.id;
  const sinOrigen = await api("POST", "/samples/analysis", { ...base, extraccion_id: null }, t.qa);
  const plancton = await api("POST", "/samples/analysis", { ...base, tipo_analisis: "plancton", metodo: "otro", metodo_otro: "Conteo Utermöhl", extraccion_id: null, recepcion_id: c.R }, t.qa);
  const planctonP = await api("POST", "/samples/analysis", { ...base, tipo_analisis: "plancton", metodo: "otro", metodo_otro: "Conteo Utermöhl", extraccion_id: null, procesamiento_id: c.P }, t.qa);
  const reg = await nuevaR();
  const pReg = (await api("POST", "/samples/processing", { ...datosP(reg.R, reg.idInt) }, t.qa));
  check("[cob:M:V-63] análisis DSP sin extracción → 400 origen_requerido; plancton (sin extracción) desde un procesamiento → 201; solo con la recepción → 400 origen_requerido (ver RENGLÓN DESACTUALIZADO); recepción sin aceptar → 409 (no hay procesamiento de ella)", sinOrigen.status === 400 && /requiere una extraccion/i.test(sinOrigen.data?.message || "") && planctonP.status === 201 && plancton.status === 400 && plancton.data?.codigo === "origen_requerido" && pReg.status === 409, [sinOrigen, planctonP, plancton, pReg].map(sinFila).join(" · "));
  const lJorge = await api("GET", "/samples/analysis", undefined, t.jorge);
  const lEstado = (await api("GET", `/samples/analysis?estado=registrado&recepcion_id=${c.R}`, undefined, t.qa)).data?.items || [];
  const lAprob = (await api("GET", `/samples/analysis?estado=aprobado&recepcion_id=${c.R}`, undefined, t.qa)).data?.items || [];
  const lExt = (await api("GET", `/samples/analysis?extraccion_id=${c.E}`, undefined, t.qa)).data?.items || [];
  const lDiego = (await api("GET", `/samples/analysis?recepcion_id=${c.R}`, undefined, t.diego)).data?.items || [];
  check("[cob:M:4-GET-analysis-ana:206] lista de análisis: sin ensayos:V → 403; filtros estado, recepcion_id y extraccion_id; el estudiante no ve los de muestras no asignadas", lJorge.status === 403 && lEstado.some((x) => Number(x.id) === Number(A)) && lEstado.every((x) => x.estado === "registrado") && !lAprob.some((x) => Number(x.id) === Number(A)) && lExt.some((x) => Number(x.id) === Number(A)) && lExt.every((x) => Number(x.extraccion_id) === Number(c.E)) && !lDiego.some((x) => Number(x.id) === Number(A)), `${sinFila(lJorge)} est=${lEstado.length} apr=${lAprob.length} ext=${lExt.length} diego=${lDiego.length}`);
  const cHector = await api("POST", "/samples/analysis", base, t.hector);
  const cDiego = await api("POST", "/samples/analysis", base, t.diego);
  check("[cob:M:4-POST-analysis-ana:283] crear análisis: sin ensayos:C (auditor) → 403; estudiante sin asignación → 403 no_asignado; sin autorización → 403 no_autorizado (V-50)", cHector.status === 403 && cDiego.status === 403 && cDiego.data?.codigo === "no_asignado", `${sinFila(cHector)} · ${sinFila(cDiego)}`);
  const gNada = await api("GET", `/samples/analysis/${NO_EXISTE}`, undefined, t.qa);
  const gDiego = await api("GET", `/samples/analysis/${A}`, undefined, t.diego);
  const gHector = await api("GET", `/samples/analysis/${A}`, undefined, t.hector);
  check("[cob:M:4-GET-analysis-ana:256] ficha de análisis: inexistente → 404; auditor → 200; estudiante sin asignación → 403 no_asignado", gNada.status === 404 && gHector.status === 200 && gDiego.status === 403 && gDiego.data?.codigo === "no_asignado", [gNada, gHector, gDiego].map(sinFila).join(" · "));
  const uNada = await api("PUT", `/samples/analysis/${NO_EXISTE}`, { ...base, folio_num: 1 }, t.qa);
  const uHector = await api("PUT", `/samples/analysis/${A}`, { ...base, folio_num: fila("SELECT folio_num FROM muestras_analisis WHERE id = ?", A).folio_num, observaciones: "Auditor" }, t.hector);
  check("[cob:M:4-PUT-analysis-ana:352] editar análisis: inexistente → 404; sin ensayos:E → 403 (409 analisis_bloqueado fuera de registrado: V-67)", uNada.status === 404 && uHector.status === 403 && fila("SELECT observaciones FROM muestras_analisis WHERE id = ?", A).observaciones !== "Auditor", `${sinFila(uNada)} · ${sinFila(uHector)}`);
  // Evidencia: ver (solo_estado / no_asignado) y modificar.
  const rolEstado = await api("POST", "/admin/roles", { nombre: `Cobertura ensayos estado ${s5}`, descripcion: "Solo el estado de los ensayos (prueba de cobertura)", activo: true, permisos: [{ modulo: "ensayos", accion: "V", alcance: "estado" }], motivo: "Rol de la prueba de cobertura" }, t.qa);
  const cuentaEstado = await alta("cob.estado", { rol_id: rolEstado.data?.id });
  const tEstado = await login(cuentaEstado.email);
  const adjEstado = await api("GET", `/samples/analysis/${A}/adjuntos`, undefined, tEstado);
  const adjDiego = await api("GET", `/samples/analysis/${A}/adjuntos`, undefined, t.diego);
  const adjNada = await api("GET", `/samples/analysis/${NO_EXISTE}/adjuntos`, undefined, t.qa);
  const adjJorge = await api("GET", `/samples/analysis/${A}/adjuntos`, undefined, t.jorge);
  check("[cob:M:4-GET-adjuntos-adj:59] ver evidencia: alcance estado en ensayos → 403 solo_estado; estudiante sin asignación → 403 no_asignado; inexistente → 404; sin ensayos:V → 403", adjEstado.status === 403 && adjEstado.data?.codigo === "solo_estado" && adjDiego.status === 403 && adjDiego.data?.codigo === "no_asignado" && adjNada.status === 404 && adjJorge.status === 403, [adjEstado, adjDiego, adjNada, adjJorge].map(sinFila).join(" · "));
  const subir = (aid, token, nombre = `ev-${s5}.pdf`) => {
    const form = new FormData();
    form.append("archivo", new Blob([pdfDePrueba(`${nombre} ${Date.now()}`)]), nombre);
    form.append("tipo_evidencia", "cromatograma");
    form.append("descripcion", "Cromatograma de cobertura");
    return api("POST", `/samples/analysis/${aid}/adjuntos`, form, token);
  };
  const cuenta = (aid) => Number(fila("SELECT COUNT(*) AS n FROM adjuntos WHERE entidad = 'analisis' AND entidad_id = ?", aid)?.n || 0);
  const antes = cuenta(A);
  const sDiego = await subir(A, t.diego);
  const sHector = await subir(A, t.hector);
  const sNada = await subir(NO_EXISTE, t.qa);
  // Sin la autorización de la actividad: la cuenta temporal propia (sin «análisis» en FX-THF-AP), asignada a otra cadena.
  const cL = await cadena(t, `CR2${s5}`, { asignar: [temporal.id] });
  const AL = (await api("POST", "/samples/analysis", analisisDe(cL), t.qa)).data?.id;
  const sLuis = await subir(AL, tTemp);
  check("[cob:M:V-78] adjuntar evidencia: sin asignación → 403 no_asignado; asignado sin la autorización FX-THF-AP de análisis → 403 no_autorizado; no se agrega ningún adjunto", sDiego.status === 403 && sDiego.data?.codigo === "no_asignado" && sLuis.status === 403 && sLuis.data?.codigo === "no_autorizado" && cuenta(A) === antes && cuenta(AL) === 0, `${sinFila(sDiego)} · ${sinFila(sLuis)}`);
  check("[cob:M:4-POST-adjuntos-adj:52] adjuntar evidencia: sin ensayos:E (auditor) → 403; análisis inexistente → 404; no asignado / no autorizado → 403 (V-78)", sHector.status === 403 && sNada.status === 404 && cuenta(A) === antes, `${sinFila(sHector)} · ${sinFila(sNada)}`);
  const sOk = await subir(A, t.qa);
  const adjId = fila("SELECT id FROM adjuntos WHERE entidad = 'analisis' AND entidad_id = ? AND anulado_en IS NULL ORDER BY id DESC", A)?.id;
  await flujoAnalisis(A, "en_revision");
  const sRev = await subir(A, t.qa, "despues.pdf");
  check("[cob:M:V-78] adjuntar o anular evidencia con el análisis fuera de «registrado» → 409", sOk.status === 201 && sRev.status === 409 && estadoA(A) === "en_revision", `${sinFila(sOk)} · ${sinFila(sRev)}`);
  const arch = await api("GET", `/adjuntos/${adjId}/archivo`, undefined, t.hector);
  const archDiego = await api("GET", `/adjuntos/${adjId}/archivo`, undefined, t.diego);
  const archNada = await api("GET", `/adjuntos/${NO_EXISTE}/archivo`, undefined, t.qa);
  check("[cob:M:4-GET-adjuntos-archivo] archivo de evidencia: quien ve el análisis lo descarga (PDF); estudiante sin asignación → 403 no_asignado; inexistente → 404", arch.status === 200 && Buffer.isBuffer(arch.data) && arch.data.subarray(0, 4).toString() === "%PDF" && archDiego.status === 403 && archDiego.data?.codigo === "no_asignado" && archNada.status === 404, `${arch.status} ${String(arch.headers.get("content-type"))} · ${sinFila(archDiego)} · ${sinFila(archNada)}`);
  const anHector = await api("POST", `/adjuntos/${adjId}/anular`, { motivo: "Auditor sin permiso" }, t.hector);
  const anNada = await api("POST", `/adjuntos/${NO_EXISTE}/anular`, { motivo: "No existe este adjunto" }, t.qa);
  const anRev = await api("POST", `/adjuntos/${adjId}/anular`, { motivo: "Archivo equivocado" }, t.qa);
  check("[cob:M:4-POST-adjuntos-anular-adj:149] anular evidencia: sin permiso de editar → 403; inexistente → 404; análisis en revisión → 409; sigue vigente", anHector.status === 403 && anNada.status === 404 && anRev.status === 409 && !fila("SELECT anulado_en FROM adjuntos WHERE id = ?", adjId)?.anulado_en, [anHector, anNada, anRev].map(sinFila).join(" · "));
  // Acciones del flujo.
  const B = (await api("POST", "/samples/analysis", base, t.qa)).data?.id;
  const evHector = await api("POST", `/samples/analysis/${B}/enviar-revision`, {}, t.hector);
  const evDiego = await api("POST", `/samples/analysis/${B}/enviar-revision`, {}, t.diego);
  check("[cob:M:4-POST-enviar-revision] enviar a revisión: sin ensayos:C → 403; sin asignación → 403 no_asignado; sigue registrado (409 fuera de registrado y sin evidencia: V-68)", evHector.status === 403 && evDiego.status === 403 && evDiego.data?.codigo === "no_asignado" && estadoA(B) === "registrado", `${sinFila(evHector)} · ${sinFila(evDiego)}`);
  await flujoAnalisis(B, "en_revision");
  const dvLuis = await api("POST", `/samples/analysis/${B}/devolver`, { motivo: "Sin ensayos:R" }, t.luis);
  const dvSeg = await api("POST", `/samples/analysis/${B}/devolver`, { motivo: "Lo elaboré yo" }, t.qa);
  const dvOk = await api("POST", `/samples/analysis/${B}/devolver`, { motivo: "Falta el cromatograma del blanco" }, t.ricardo);
  check("[cob:M:3.4-devolver] [cob:M:4-POST-analysis-devolver] en_revision → registrado (devolver): sin ensayos:R → 403; el elaborador → 409 segregacion; el revisor lo devuelve con observaciones", dvLuis.status === 403 && dvSeg.status === 409 && dvSeg.data?.codigo === "segregacion" && dvOk.status === 200 && estadoA(B) === "registrado" && /cromatograma del blanco/.test(JSON.stringify(fila("SELECT * FROM muestras_analisis WHERE id = ?", B))), [dvLuis, dvSeg, dvOk].map(sinFila).join(" · "));
  await flujoAnalisis(B, "en_revision");
  const rvLuis = await api("POST", `/samples/analysis/${B}/revisar`, {}, t.luis);
  const rvNada = await api("POST", `/samples/analysis/${NO_EXISTE}/revisar`, {}, t.ricardo);
  check("[cob:M:4-POST-analysis-revisar-ana:448] revisar: sin ensayos:R → 403; inexistente → 409/404; 409 no_enviado y segregacion (V-69, 3.4)", rvLuis.status === 403 && [404, 409].includes(rvNada.status) && estadoA(B) === "en_revision", `${sinFila(rvLuis)} · ${sinFila(rvNada)}`);
  await api("POST", `/samples/analysis/${B}/revisar`, {}, t.ricardo);
  const apLuis = await api("POST", `/samples/analysis/${B}/aprobar`, {}, t.luis);
  check("[cob:M:4-POST-analysis-aprobar-ana:475] aprobar: sin ensayos:A → 403 (409 sin revisar, segregacion y reautenticación: V-70 y 3.4)", apLuis.status === 403 && estadoA(B) === "revisado", sinFila(apLuis));
  await api("POST", `/samples/analysis/${B}/aprobar`, {}, t.ricardo);
  const emHector = await api("POST", `/samples/analysis/${B}/enmendar`, { motivo: "Auditor sin permiso" }, t.hector);
  const emNada = await api("POST", `/samples/analysis/${NO_EXISTE}/enmendar`, { motivo: "No existe este análisis" }, t.qa);
  check("[cob:M:4-POST-analysis-enmendar] enmendar: sin ensayos:C → 403; inexistente → 404; sin versión nueva", emHector.status === 403 && emNada.status === 404 && !fila("SELECT id FROM muestras_analisis WHERE sustituye_a = ?", B), `${sinFila(emHector)} · ${sinFila(emNada)}`);
  const anLuis = await api("POST", `/samples/analysis/${B}/anular`, { motivo: "Sin permiso para anular" }, t.luis);
  const anNadaA = await api("POST", `/samples/analysis/${NO_EXISTE}/anular`, { motivo: "No existe este análisis" }, t.ricardo);
  check("[cob:M:4-POST-analysis-anular-ana:597] anular análisis: sin ensayos:AN → 403; inexistente → 404 (reautenticación, solicitud y 409 en informe: 3.4-anular)", anLuis.status === 403 && anNadaA.status === 404 && estadoA(B) === "aprobado", `${sinFila(anLuis)} · ${sinFila(anNadaA)}`);
  const Cn = (await api("POST", "/samples/analysis", base, t.qa)).data?.id;
  await api("POST", `/samples/analysis/${Cn}/anular`, { motivo: "Captura duplicada" }, t.ricardo);
  const rsLuis = await api("POST", `/samples/analysis/${Cn}/restaurar`, { motivo: "Sin permiso para restaurar" }, t.luis);
  const rsNada = await api("POST", `/samples/analysis/${NO_EXISTE}/restaurar`, { motivo: "No existe este análisis" }, t.ricardo);
  const rsVig = await api("POST", `/samples/analysis/${B}/restaurar`, { motivo: "No está anulado" }, t.ricardo);
  const rsSinR = await api("POST", `/samples/analysis/${Cn}/restaurar`, { motivo: "Se anuló por error" }, t.ricardo, SIN_REAUTH);
  check("[cob:M:4-POST-analysis-restaurar-ana:609] restaurar análisis: sin ensayos:AN → 403; inexistente → 404; no anulado → 409; reautenticación ensayos:AN", rsLuis.status === 403 && rsNada.status === 404 && rsVig.status === 409 && rsSinR.status === 401 && rsSinR.data?.accion === "ensayos:AN" && estadoA(Cn) === "anulado", [rsLuis, rsNada, rsVig, rsSinR].map(sinFila).join(" · "));
}

/* ---------- Informes y envíos: permisos ---------- */
{
  const L = await informeLiberado(t, `CQ2${s5}`);
  const I = L.informe;
  const gJorge = await api("GET", "/informes", undefined, t.jorge);
  const gQa = (await api("GET", `/informes?search=${encodeURIComponent(`CQ2${s5}`)}`, undefined, t.qa)).data?.items || [];
  check("[cob:M:4-GET-informes-inf:202] lista de informes: sin informes:V (Adm. técnico) → 403; con V la búsqueda trae el informe", gJorge.status === 403 && gQa.some((x) => Number(x.id) === Number(I)), `${sinFila(gJorge)} · ${gQa.length}`);
  const cMar = await api("POST", "/informes", { recepcion_id: L.R, analisis_ids: [], cliente: { nombre: "X" } }, t.mariana);
  check("[cob:M:4-POST-informes-inf:301] crear informe: sin informes:C (Técnico Auxiliar) → 403; recepción inexistente → 404 (V-80)", cMar.status === 403 && /informes:C/.test(cMar.data?.message || ""), sinFila(cMar));
  const rp = await api("GET", `/informes/recepcion/${L.R}`, undefined, t.qa);
  const rpNada = await api("GET", `/informes/recepcion/${NO_EXISTE}`, undefined, t.qa);
  const rpJorge = await api("GET", `/informes/recepcion/${L.R}`, undefined, t.jorge);
  check("[cob:M:4-GET-informes-recepcion-inf:283] datos para informar una recepción: trae sus análisis aprobados; inexistente → 404; sin informes:V → 403", rp.status === 200 && JSON.stringify(rp.data).includes(String(fila("SELECT folio_num FROM muestras_analisis WHERE id = ?", L.A)?.folio_num)) && rpNada.status === 404 && rpJorge.status === 403, `${rp.status} ${JSON.stringify(rp.data).slice(0, 160)} · ${sinFila(rpNada)} · ${sinFila(rpJorge)}`);
  const iNada = await api("GET", `/informes/${NO_EXISTE}`, undefined, t.qa);
  const iJorge = await api("GET", `/informes/${I}`, undefined, t.jorge);
  const iHector = await api("GET", `/informes/${I}`, undefined, t.hector);
  check("[cob:M:4-GET-informes-inf:245] ficha de informe: inexistente → 404; sin informes:V → 403; auditor → 200", iNada.status === 404 && iJorge.status === 403 && iHector.status === 200 && Number(iHector.data?.item?.id) === Number(I), [iNada, iJorge, iHector].map(sinFila).join(" · "));
  const Ib = (await api("POST", "/informes", { recepcion_id: L.R, analisis_ids: [L.A], cliente: { nombre: "Borrador de permisos" } }, t.qa)).data?.id;
  const puNada = await api("PUT", `/informes/${NO_EXISTE}`, { recepcion_id: L.R, analisis_ids: [], cliente: { nombre: "X" } }, t.qa);
  const puMar = await api("PUT", `/informes/${Ib}`, { recepcion_id: L.R, analisis_ids: [L.A], cliente: { nombre: "Cambio sin permiso" } }, t.mariana);
  check("[cob:M:4-PUT-informes-inf:359] editar informe: inexistente → 404; sin informes:E → 403 (no borrador → 409: V-88); no cambia", puNada.status === 404 && puMar.status === 403 && !/Cambio sin permiso/.test(inf(Ib)?.cliente_json || ""), `${sinFila(puNada)} · ${sinFila(puMar)}`);
  const rvMar = await api("POST", `/informes/${Ib}/revisar`, {}, t.mariana);
  const rvNada = await api("POST", `/informes/${NO_EXISTE}/revisar`, {}, t.ricardo);
  check("[cob:M:4-POST-informes-revisar-inf:411] revisar informe: sin informes:R → 403; inexistente → 404; segregación del elaborador → 409 (3.5)", rvMar.status === 403 && rvNada.status === 404 && inf(Ib)?.estado === "borrador", `${sinFila(rvMar)} · ${sinFila(rvNada)}`);
  const auLuis = await api("POST", `/informes/${Ib}/autorizar`, {}, t.luis);
  const auNada = await api("POST", `/informes/${NO_EXISTE}/autorizar`, {}, t.patricia);
  const auBor = await api("POST", `/informes/${Ib}/autorizar`, {}, t.patricia);
  check("[cob:M:4-POST-informes-autorizar-inf:482] autorizar informe: sin informes:A → 403; inexistente → 404; en borrador → 409", auLuis.status === 403 && auNada.status === 404 && auBor.status === 409 && inf(Ib)?.estado === "borrador", [auLuis, auNada, auBor].map(sinFila).join(" · "));
  const liLuis = await api("POST", `/informes/${Ib}/liberar`, {}, t.luis);
  const liNada = await api("POST", `/informes/${NO_EXISTE}/liberar`, {}, t.patricia);
  const liBor = await api("POST", `/informes/${Ib}/liberar`, {}, t.patricia);
  check("[cob:M:4-POST-informes-liberar-inf:522] liberar informe: sin informes:A → 403; inexistente → 404; no autorizado → 409 (sin PDF)", liLuis.status === 403 && liNada.status === 404 && liBor.status === 409 && !inf(Ib)?.archivo_pdf, [liLuis, liNada, liBor].map(sinFila).join(" · "));
  const anLuis = await api("POST", `/informes/${Ib}/anular`, { motivo: "Sin permiso para anular" }, t.luis);
  const anNada = await api("POST", `/informes/${NO_EXISTE}/anular`, { motivo: "No existe este informe" }, t.patricia);
  check("[cob:M:4-POST-informes-anular-inf:588] anular informe: sin informes:AN → 403; inexistente → 404 (reautenticación y solicitud: 3.5)", anLuis.status === 403 && anNada.status === 404 && inf(Ib)?.estado === "borrador", `${sinFila(anLuis)} · ${sinFila(anNada)}`);
  const emMar = await api("POST", `/informes/${I}/enmienda`, { motivo: "Sin permiso para enmendar" }, t.mariana);
  const emNada = await api("POST", `/informes/${NO_EXISTE}/enmienda`, { motivo: "No existe este informe" }, t.qa);
  check("[cob:M:4-POST-informes-enmienda-inf:674] enmienda: sin informes:C → 403; inexistente → 404 (borrador → 409: V-91); sin versión nueva", emMar.status === 403 && emNada.status === 404 && !fila("SELECT id FROM informes WHERE sustituye_a = ?", I), `${sinFila(emMar)} · ${sinFila(emNada)}`);
  // PDF: descarga registrada, modo ver sin registro, faltante con alerta.
  const desc0 = auditorias("descargar", "informes", I);
  const pdf = await api("GET", `/informes/${I}/pdf`, undefined, t.hector);
  const desc1 = auditorias("descargar", "informes", I);
  const verPdf = await api("GET", `/informes/${I}/pdf?modo=ver`, undefined, t.hector);
  const desc2 = auditorias("descargar", "informes", I);
  const pdfJorge = await api("GET", `/informes/${I}/pdf`, undefined, t.jorge);
  const pdfNada = await api("GET", `/informes/${NO_EXISTE}/pdf`, undefined, t.qa);
  const pdfRuta = path.join(path.dirname(process.env.TEST_DB_PATH), "informes", String(inf(I).archivo_pdf));
  const aparte = `${pdfRuta}.cobertura2`;
  let falta = { status: 0, data: {} };
  const alertas0 = auditorias("alerta_integridad", "informes", I);
  renameSync(pdfRuta, aparte);
  try {
    falta = await api("GET", `/informes/${I}/pdf?modo=ver`, undefined, t.qa);
  } finally {
    renameSync(aparte, pdfRuta);
  }
  check("[cob:M:4-GET-informes-pdf] PDF del informe: la descarga queda en la bitácora y «modo=ver» no; sin informes:V → 403; inexistente → 404; sin el archivo → 404 archivo_faltante con alerta de integridad (el archivo se devuelve)", pdf.status === 200 && Buffer.isBuffer(pdf.data) && pdf.headers.get("x-integridad-pdf") === "ok" && desc1 === desc0 + 1 && verPdf.status === 200 && desc2 === desc1 && pdfJorge.status === 403 && pdfNada.status === 404 && falta.status === 404 && falta.data?.codigo === "archivo_faltante" && auditorias("alerta_integridad", "informes", I) === alertas0 + 1 && existsSync(pdfRuta), `${pdf.status} ${pdf.headers.get("x-integridad-pdf")} ${desc0}/${desc1}/${desc2} · ${sinFila(pdfJorge)} · ${sinFila(pdfNada)} · ${sinFila(falta)}`);
  // Envíos.
  const enJorge = await api("GET", `/informes/${I}/envios`, undefined, t.jorge);
  const enNada = await api("GET", `/informes/${NO_EXISTE}/envios`, undefined, t.qa);
  const enVacio = await api("GET", `/informes/${I}/envios`, undefined, t.hector);
  check("[cob:M:4-GET-envios-env:119] envíos: sin informes:V → 403; informe inexistente → 404 (ver RENGLÓN DESACTUALIZADO); liberado sin envíos → lista vacía", enJorge.status === 403 && enNada.status === 404 && enVacio.status === 200 && (enVacio.data?.items || []).length === 0, [enJorge, enNada, enVacio].map(sinFila).join(" · "));
  const envLuis = await registrarEnvio(BASE, t.luis, I);
  const envNada = await registrarEnvio(BASE, t.patricia, NO_EXISTE);
  check("[cob:M:4-POST-envios-env:126] registrar envío: sin informes:A → 403; informe inexistente → 404; nada se registra", envLuis.status === 403 && envNada.status === 404 && !fila("SELECT id FROM envios_informe WHERE informe_id = ?", I), `${envLuis.status} ${envLuis.data?.message} · ${envNada.status} ${envNada.data?.message}`);
  const smLuis = await api("POST", `/informes/${I}/envios/smtp`, { destinatario_nombre: "Cliente", destinatario_correo: "cliente@ejemplo.mx" }, t.luis);
  const smNada = await api("POST", `/informes/${NO_EXISTE}/envios/smtp`, { destinatario_nombre: "Cliente", destinatario_correo: "cliente@ejemplo.mx" }, t.patricia);
  const smCorreo = await api("POST", `/informes/${I}/envios/smtp`, { destinatario_nombre: "Cliente", destinatario_correo: "no-es-correo" }, t.patricia);
  check("[cob:M:4-POST-envios-smtp] envío desde la plataforma: sin informes:A → 403; informe inexistente → 404; correo inválido → 400; nada se registra", smLuis.status === 403 && smNada.status === 404 && smCorreo.status === 400 && !fila("SELECT id FROM envios_informe WHERE informe_id = ?", I), [smLuis, smNada, smCorreo].map(sinFila).join(" · "));
  const ok = await registrarEnvio(BASE, t.patricia, I);
  const envId = ok.data?.envio_id;
  const coLuis = await api("POST", `/informes/${I}/envios/${envId}/confirmar`, { confirmacion_en: "2026-09-26T10:00" }, t.luis);
  const evOk = await api("GET", `/informes/${I}/envios/${envId}/evidencia`, undefined, t.hector);
  const evJorge = await api("GET", `/informes/${I}/envios/${envId}/evidencia`, undefined, t.jorge);
  const evNada = await api("GET", `/informes/${I}/envios/${NO_EXISTE}/evidencia`, undefined, t.qa);
  const envFila = fila("SELECT * FROM envios_informe WHERE id = ?", envId);
  check("[cob:M:4-POST-envios-confirmar] confirmar recepción: sin informes:A → 403 (sin confirmación); 400/404/409: V-99", ok.status === 200 && coLuis.status === 403 && !envFila?.confirmacion_en, `${ok.status} · ${sinFila(coLuis)}`);
  check("[cob:M:4-GET-envios-evidencia] evidencia del envío: con informes:V se descarga con su SHA-256 (X-Evidencia-Sha256) y queda en la bitácora; sin V → 403; envío inexistente → 404", evOk.status === 200 && evOk.headers.get("x-evidencia-sha256") === envFila?.evidencia_sha256 && evOk.headers.get("x-integridad-evidencia") === "ok" && evJorge.status === 403 && evNada.status === 404 && !!fila("SELECT id FROM auditoria WHERE accion = 'descargar' AND entidad = 'informes' AND entidad_id = ? AND cambios_json LIKE '%evidencia%'", String(I)), `${evOk.status} ${evOk.headers.get("x-integridad-evidencia")} · ${sinFila(evJorge)} · ${sinFila(evNada)}`);
  const anula = await api("POST", `/informes/${I}/anular`, { motivo: "Se retira el informe enviado" }, t.patricia);
  const coAnul = await api("POST", `/informes/${I}/envios/${envId}/confirmar`, { confirmacion_en: "2026-09-26T10:00" }, t.patricia);
  check("[cob:M:4-POST-envios-confirmar] un informe anulado no registra confirmaciones de recepción → 409 anulado", inf(I)?.estado === "anulado" && coAnul.status === 409 && coAnul.data?.codigo === "anulado" && !fila("SELECT confirmacion_en FROM envios_informe WHERE id = ?", envId)?.confirmacion_en, `${sinFila(anula)} ${inf(I)?.estado} · ${sinFila(coAnul)}`);
}

/* ---------- Supervisión (3.6, V-103 y endpoints) ---------- */
{
  const a = await nuevaR(t.diego);
  const b = await nuevaR(t.diego);
  const c = await nuevaR(t.diego);
  const sup = fila("SELECT supervisor_id FROM muestras_recepcion WHERE id = ?", a.R)?.supervisor_id;
  const quien = Object.keys(id).find((k) => Number(id[k]) === Number(sup));
  const bandeja = await api("GET", "/supervision", undefined, t[quien]);
  const ajena = await api("GET", "/supervision", undefined, t.hector);
  const tiene = (r, R) => (r.data?.por_supervisar || []).some((x) => x.tabla === "muestras_recepcion" && Number(x.id) === Number(R));
  check("[cob:M:4-GET-supervision-sup:134] «Por supervisar»: el supervisor asignado ve lo pendiente de su supervisado; otra persona no", bandeja.status === 200 && tiene(bandeja, a.R) && tiene(bandeja, b.R) && ajena.status === 200 && !tiene(ajena, a.R), `${quien} ${bandeja.status} ${(bandeja.data?.por_supervisar || []).length} · ${ajena.status}`);
  const vbSinR = await api("POST", `/supervision/muestras_recepcion/${a.R}/visto-bueno`, { observaciones: "Revisado contra la hoja" }, t[quien], SIN_REAUTH);
  const vbOk = await api("POST", `/supervision/muestras_recepcion/${a.R}/visto-bueno`, { observaciones: "Revisado contra la hoja" }, t[quien]);
  const fa = fila("SELECT supervision_estado, supervisado_por, supervision_observaciones FROM muestras_recepcion WHERE id = ?", a.R);
  check("[cob:M:3.6-supervisión-visto-bueno] [cob:M:4-POST-supervision-visto-bueno] pendiente → aprobado: el visto bueno pide reautenticación supervision:visto_bueno y deja quién lo dio y sus observaciones", vbSinR.status === 401 && vbSinR.data?.accion === "supervision:visto_bueno" && vbOk.status === 200 && fa?.supervision_estado === "aprobado" && Number(fa?.supervisado_por) === Number(sup) && fa?.supervision_observaciones === "Revisado contra la hoja", `${sinFila(vbSinR)} · ${sinFila(vbOk)} ${JSON.stringify(fa)}`);
  // Regla 4: el supervisor que editó el registro no le da el visto bueno.
  let regla4 = { status: 0, data: {} };
  let editado = { status: 0 };
  if (quien === "ricardo") {
    editado = await putR(c.R, c.idInt, { especificaciones: "Corregido por el supervisor" }, t.ricardo);
    regla4 = await api("POST", `/supervision/muestras_recepcion/${c.R}/visto-bueno`, { observaciones: "Lo corregí yo" }, t.ricardo);
  }
  check("[cob:M:V-103] visto bueno: el supervisor que editó el registro → 409 segregacion (regla 4) y sigue pendiente; sin contraseña → 401 (arriba)", editado.status === 200 && regla4.status === 409 && regla4.data?.codigo === "segregacion" && fila("SELECT supervision_estado FROM muestras_recepcion WHERE id = ?", c.R)?.supervision_estado === "pendiente" && vbSinR.status === 401, `${quien} ${editado.status} · ${sinFila(regla4)}`);
  const rgOk = await api("POST", `/supervision/muestras_recepcion/${b.R}/regresar`, { observaciones: "Falta la hora de recepción" }, t[quien]);
  const regresados = (await api("GET", "/supervision", undefined, t.diego)).data?.regresados || [];
  check("[cob:M:3.6-supervisión-regresado] pendiente → regresado con observaciones (≥ 5): queda en «Regresados» de quien capturó", rgOk.status === 200 && fila("SELECT supervision_estado FROM muestras_recepcion WHERE id = ?", b.R)?.supervision_estado === "regresado" && regresados.some((x) => Number(x.id) === Number(b.R) && x.observaciones === "Falta la hora de recepción"), `${sinFila(rgOk)} ${regresados.length}`);
  const rgTabla = await api("POST", `/supervision/usuarios/1/regresar`, { observaciones: "Tabla no supervisable" }, t[quien]);
  const rgNada = await api("POST", `/supervision/muestras_recepcion/${NO_EXISTE}/regresar`, { observaciones: "Registro inexistente" }, t[quien]);
  const rgOtro = await api("POST", `/supervision/muestras_recepcion/${c.R}/regresar`, { observaciones: "No soy su supervisor" }, t.hector);
  const rgYa = await api("POST", `/supervision/muestras_recepcion/${a.R}/regresar`, { observaciones: "Ya tiene visto bueno" }, t[quien]);
  check("[cob:M:4-POST-supervision-regresar] regresar: tabla no supervisable o registro inexistente → 404; quien no es el supervisor → 403; ya no pendiente → 409", rgTabla.status === 404 && rgNada.status === 404 && rgOtro.status === 403 && rgYa.status === 409 && fila("SELECT supervision_estado FROM muestras_recepcion WHERE id = ?", a.R)?.supervision_estado === "aprobado", [rgTabla, rgNada, rgOtro, rgYa].map(sinFila).join(" · "));
}

// La alta sin aprobar de la preparación deja su solicitud asignar_rol: se cancela al final.
await cancelar("usuarios", sinRoles.id);

terminar();
