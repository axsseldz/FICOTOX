/*
 * Fase 3: login solo local, separacion de funciones (6 reglas) y aprobacion de
 * un segundo usuario (solicitudes de autorizacion), contra el servidor de prueba.
 *
 * Las peticiones llevan `X-Sin-Aprobar-Auto: 1` para que tests/lib/reauth-auto.mjs
 * NO apruebe solo las solicitudes: aqui se prueba el flujo completo a mano.
 */
import "./lib/reauth-auto.mjs";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { autorizarTodo } from "./lib/autorizar.mjs";
import { adjuntarEvidencia } from "./lib/evidencia.mjs";
import { liberar, registrarEnvio } from "./lib/envio.mjs";

const Database = createRequire(import.meta.url)(process.env.BETTER_SQLITE3 || "better-sqlite3");
const BASE = process.env.BASE || "http://localhost:3100/api";
const credenciales = JSON.parse(readFileSync(process.env.CREDENCIALES_ROLES, "utf8"));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ""}`);
};
const fila = (query, ...args) => {
  const d = new Database(process.env.TEST_DB_PATH);
  try {
    return d.prepare(query).get(...args);
  } finally {
    d.close();
  }
};
const sql = (query, ...args) => {
  const d = new Database(process.env.TEST_DB_PATH);
  try {
    return d.prepare(query).run(...args);
  } finally {
    d.close();
  }
};
const MANUAL = { "X-Sin-Aprobar-Auto": "1" };
async function api(method, ruta, body, token, headers = {}) {
  const res = await fetch(`${BASE}${ruta}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...MANUAL, ...headers }, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await res.json().catch(() => null) : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data };
}
const login = async (email, password) => (await api("POST", "/auth/login", { email, password })).data?.token;
const auditoria = (accion, entidad, entidadId) => fila("SELECT * FROM auditoria WHERE accion = ? AND entidad = ? AND entidad_id = ? ORDER BY id DESC LIMIT 1", accion, entidad, String(entidadId));

function textoPdf(buffer) {
  if (!Buffer.isBuffer(buffer)) return "";
  const raw = buffer.toString("latin1");
  let out = "";
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    try {
      const contenido = zlib.inflateSync(buffer.subarray(start, end)).toString("latin1");
      for (const hex of contenido.matchAll(/<([0-9a-fA-F]+)>/g)) out += Buffer.from(hex[1], "hex").toString("latin1");
      for (const lit of contenido.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) out += lit[1];
    } catch {
      /* stream no comprimido */
    }
  }
  return out;
}

/* ---------- Personas ---------- */
const QA_PWD = "QaFicotox2026!";
const QA = await login("qa@ficotox.local", QA_PWD);
const RICARDO = "ricardo.medina@ficotox.local"; // Coord. Area Tecnica: ensayos/informes C E R A AN, muestras C E R A AN
const PATRICIA = "patricia.luna@ficotox.local"; // Responsable General: usuarios V A, calidad A, AN en todo
const LUIS = "luis.castro@ficotox.local"; // Tecnico Analista: ensayos C E
const tR = await login(RICARDO, credenciales[RICARDO]);
const tP = await login(PATRICIA, credenciales[PATRICIA]);
const tL = await login(LUIS, credenciales[LUIS]);
check("logins de QA, Coord. Area Tecnica, Responsable General y Tecnico Analista", !!(QA && tR && tP && tL));
const roles = (await api("GET", "/admin/roles", undefined, QA)).data?.items || [];
const rolId = (nombre) => roles.find((r) => r.nombre === nombre)?.id;
const idDe = (email) => fila("SELECT id FROM usuarios WHERE email = ?", email)?.id;

/* ---------- 1. Microsoft retirado ---------- */
{
  const ms = await api("POST", "/auth/microsoft", { id_token: "x" });
  const cfg = (await api("GET", "/auth/config")).data || {};
  const reauth = await api("POST", "/auth/reauth", { accion: "ensayos:A", password: QA_PWD }, QA);
  const idToken = await api("POST", "/auth/reauth", { accion: "ensayos:A", id_token: "eyJ.falso.token" }, QA);
  check("/api/auth/microsoft ya no existe (404)", ms.status === 404, `${ms.status}`);
  check("/api/auth/config no anuncia Microsoft ni el login local opcional", !("microsoft" in cfg) && !("manualLoginEnabled" in cfg) && Array.isArray(cfg.dominios_permitidos), JSON.stringify(cfg));
  check("la reautenticacion con contrasena sigue funcionando; un id_token ya no sirve", reauth.status === 200 && !!reauth.data?.token && idToken.status === 401, `${reauth.status} ${idToken.status}`);
  const cols = new Set((() => {
    const d = new Database(process.env.TEST_DB_PATH);
    try {
      return d.prepare("PRAGMA table_info(usuarios)").all().map((c) => c.name);
    } finally {
      d.close();
    }
  })());
  check("columnas del proveedor externo eliminadas (estaban vacias)", !["microsoft_oid", "microsoft_tid", "microsoft_preferred_username", "auth_provider"].some((c) => cols.has(c)), [...cols].filter((c) => /microsoft|auth_provider/.test(c)).join(","));
  const dominio = await api("POST", "/admin/usuarios", { nombre: "Dominio ajeno", email: `ajeno.${Date.now()}@gmail.com`, activo: true, rol_id: rolId("Técnico Auxiliar"), password: "Dominio-Ajeno-2026" }, QA);
  check("ALLOWED_EMAIL_DOMAINS: un correo de otro dominio no se da de alta (400)", dominio.status === 400 && /cicese\.mx/.test(String(dominio.data?.message)), `${dominio.status} ${dominio.data?.message}`);
}

/* ---------- Datos: una cadena de QA ---------- */
const inspeccion = { checklist: Array.from({ length: 7 }, (_, i) => ({ requisito: `Requisito ${i + 1}`, estado: i === 6 ? "NA" : "C", observacion: null })), observaciones_generales: null };
const aceptada = (id) => ({ fecha_recepcion: "2026-09-20", hora_recepcion: "09:00", recibido_por: "QA", medio_recepcion: "directa", solicitante: "Cliente segregacion", muestra_unica: true, id_interno: id, fecha_muestra: "2026-09-19", analisis: { tipos: ["toxinas_lipofilicas"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] }, inspeccion, decision_aceptacion: "aceptada", aceptacion: { fecha: "2026-09-20", responsable: "QA" } });
const procesamiento = (recepcion, id, extra = {}) => ({ recepcion_id: recepcion, muestra_tipo: "unica", id_interno: id, fecha_procesamiento: "2026-09-20", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "Persona A", nombre_quien_superviso: "Persona B", ...extra });
const extraccion = (proc, id, extra = {}) => ({ tipo_registro: "E-D", procesamiento_id: proc, tipo_molienda: "fresca", id_interno: id, fecha_extraccion: "2026-09-20", registro_pesos: [{ id_muestra: id, replica: `${id}_R1`, peso_muestra: 2.01 }], nombre_quien_extrajo: "Persona A", nombre_quien_superviso: "Persona B", ...extra });
const analisis = (ext, id) => ({ tipo_analisis: "toxinas_lipofilicas", metodo: "hplc_ms_ms", extraccion_id: ext, fecha_analisis: "2026-09-20", analista_nombre: "QA", resultados: [{ id_muestra: id, resultado: 50, unidad: "µg/kg", limite_regulatorio: 160, cumple: "cumple" }] });
let n = 0;
const cadena = async (prefijo, token = QA) => {
  const id = `${prefijo}-${Date.now()}-${(n += 1)}`;
  const R = (await api("POST", "/samples/reception", aceptada(id), token)).data?.id;
  const P = (await api("POST", "/samples/processing", procesamiento(R, id), token)).data?.id;
  const E = (await api("POST", "/samples/extraction", extraccion(P, id), token)).data?.id;
  const A = (await api("POST", "/samples/analysis", analisis(E, id), token)).data?.id;
  return { id, R, P, E, A };
};

/* ---------- 2. Separacion de funciones ---------- */
{
  // Una recepcion aceptada no vuelve a "registrada" quitando la decision (se anularia sin segundo usuario).
  const idQ = `SEGQ-${Date.now()}`;
  const RQ = (await api("POST", "/samples/reception", aceptada(idQ), tR)).data?.id;
  const folioQ = (await api("GET", `/samples/reception/${RQ}`, undefined, QA)).data?.item?.folio_num;
  const quitar = await api("PUT", `/samples/reception/${RQ}`, { ...aceptada(idQ), folio_num: folioQ, decision_aceptacion: null, aceptacion: null }, tR);
  const anularQ = await api("POST", `/samples/reception/${RQ}/anular`, { motivo: "Intento de anular sin segundo usuario" }, tR, { "X-Sin-Aprobar-Auto": "1" });
  const trasQ = (await api("GET", `/samples/reception/${RQ}`, undefined, QA)).data?.item;
  check("la decision de aceptacion no se quita editando; la anulacion de la aceptada queda en solicitud", quitar.status === 409 && anularQ.status === 202 && trasQ?.estado === "aceptada", `${quitar.status} ${quitar.data?.message} ${anularQ.status} ${trasQ?.estado}`);
  if (anularQ.data?.solicitud?.id) await api("POST", `/solicitudes/${anularQ.data.solicitud.id}/cancelar`, { motivo: "Fin de la prueba" }, tR);

  // Regla 1: analisis.
  const c = await cadena("SEG1");
  // Fase 6: el analisis se revisa solo despues de enviarlo a revision.
  await api("POST", `/samples/analysis/${c.A}/enviar-revision`, {}, QA);
  const revPropio = await api("POST", `/samples/analysis/${c.A}/revisar`, {}, QA);
  check("regla 1: quien elaboro el analisis no lo revisa (409 segregacion)", revPropio.status === 409 && revPropio.data?.codigo === "segregacion" && revPropio.data?.regla === 1 && /Elaboraste este análisis/.test(revPropio.data?.message), `${revPropio.status} ${revPropio.data?.message}`);
  const ficha = (await api("GET", `/samples/analysis/${c.A}`, undefined, QA)).data?.item;
  check("la ficha informa a la interfaz por que no puede revisar (botones deshabilitados)", /Elaboraste/.test(String(ficha?.segregacion?.revisar)) && /Elaboraste/.test(String(ficha?.segregacion?.aprobar)), JSON.stringify(ficha?.segregacion));
  // Fase 6: el analisis se revisa solo despues de enviarlo a revision.
  await api("POST", `/samples/analysis/${c.A}/enviar-revision`, {}, QA);
  const rev = await api("POST", `/samples/analysis/${c.A}/revisar`, {}, tR);
  const aprPropio = await api("POST", `/samples/analysis/${c.A}/aprobar`, {}, QA);
  const apr = await api("POST", `/samples/analysis/${c.A}/aprobar`, {}, tR);
  check("regla 1: otra persona revisa y aprueba (revisor y aprobador pueden coincidir)", rev.status === 200 && apr.status === 200 && apr.data?.item?.estado === "aprobado", `${rev.status} ${apr.status} ${apr.data?.message}`);
  check("regla 1: quien elaboro tampoco aprueba (409)", aprPropio.status === 409 && aprPropio.data?.codigo === "segregacion", `${aprPropio.status}`);

  // "Elaboro" incluye a quien edito el contenido tecnico.
  const c2 = await cadena("SEG1E");
  const folio = fila("SELECT folio_num FROM muestras_analisis WHERE id = ?", c2.A)?.folio_num;
  const editar = await api("PUT", `/samples/analysis/${c2.A}`, { ...analisis(c2.E, c2.id), folio_num: folio, observaciones: "Corrijo el resultado" }, tR);
  // Fase 6: el analisis se revisa solo despues de enviarlo a revision.
  await api("POST", `/samples/analysis/${c2.A}/enviar-revision`, {}, QA);
  const revEditor = await api("POST", `/samples/analysis/${c2.A}/revisar`, {}, tR);
  check("regla 1: quien edito el analisis tambien cuenta como elaborador (409)", editar.status === 200 && revEditor.status === 409 && revEditor.data?.codigo === "segregacion", `${editar.status} ${revEditor.status}`);

  // Persona con dos roles que otorgan revisar: la regla es por persona, no por cargo.
  const email = `dos.roles.${Date.now()}@cicese.mx`;
  const alta = await api("POST", "/admin/usuarios", { nombre: "Dos roles", email, activo: true, rol_id: rolId("Coordinador/a del Área Técnica"), password: "Dos-Roles-2026-x", motivo: "Persona con dos roles" }, QA);
  await autorizarTodo(BASE, QA, alta.data?.id);
  await api("POST", `/solicitudes/${alta.data?.solicitud?.id}/aprobar`, { motivo: "Alta de prueba de segregacion" }, tP);
  const segunda = await api("POST", `/admin/usuarios/${alta.data?.id}/roles`, { rol_id: rolId("Coordinador/a de Investigación y Desarrollo"), motivo: "Segundo rol" }, QA);
  await api("POST", `/solicitudes/${segunda.data?.solicitud?.id}/aprobar`, { motivo: "Segundo rol de prueba" }, tP);
  const tDos = await login(email, "Dos-Roles-2026-x");
  // Con cargo predeterminado captura sin elegir; al revisar prueba con cada cargo.
  await api("PUT", "/auth/me/cargo", { rol_id: rolId("Coordinador/a del Área Técnica") }, tDos);
  const c3 = await cadena("SEG1D", tDos);
  // Fase 6: el analisis se revisa solo despues de enviarlo a revision.
  await api("POST", `/samples/analysis/${c3.A}/enviar-revision`, {}, QA);
  const rev1 = await api("POST", `/samples/analysis/${c3.A}/revisar`, {}, tDos, { "X-Actuar-Como": String(rolId("Coordinador/a del Área Técnica")) });
  // Fase 6: el analisis se revisa solo despues de enviarlo a revision.
  await api("POST", `/samples/analysis/${c3.A}/enviar-revision`, {}, QA);
  const rev2 = await api("POST", `/samples/analysis/${c3.A}/revisar`, {}, tDos, { "X-Actuar-Como": String(rolId("Coordinador/a de Investigación y Desarrollo")) });
  check("una persona con dos roles no se salta la regla cambiando de cargo", !!c3.A && rev1.status === 409 && rev2.status === 409 && rev1.data?.codigo === "segregacion", `A=${c3.A} ${rev1.status} ${rev2.status}`);

  // Regla 2: informe. QA elaboro el analisis; Luis (Analista) elabora el informe.
  const inf = await api("POST", "/informes", { recepcion_id: c.R, analisis_ids: [c.A], cliente: { nombre: "Cliente regla 2" } }, tR);
  const revInfPropio = await api("POST", `/informes/${inf.data?.id}/revisar`, {}, tR);
  const revInfAnalista = await api("POST", `/informes/${inf.data?.id}/revisar`, {}, QA);
  const revInf = await api("POST", `/informes/${inf.data?.id}/revisar`, {}, tP);
  const autAnalista = await api("POST", `/informes/${inf.data?.id}/autorizar`, {}, QA);
  const autInf = await api("POST", `/informes/${inf.data?.id}/autorizar`, {}, tP);
  check("regla 2: quien elaboro el informe no lo revisa (409)", revInfPropio.status === 409 && /Elaboraste este informe/.test(revInfPropio.data?.message), `${revInfPropio.status} ${revInfPropio.data?.message}`);
  check("regla 2: quien elaboro un analisis incluido no revisa ni autoriza el informe", revInfAnalista.status === 409 && autAnalista.status === 409 && /análisis/.test(String(autAnalista.data?.message)), `${revInfAnalista.status} ${autAnalista.status} ${autAnalista.data?.message}`);
  check("regla 2: una tercera persona revisa y autoriza", revInf.status === 200 && autInf.status === 200 && autInf.data?.item?.estado === "autorizado", `${revInf.status} ${autInf.status} ${autInf.data?.message}`);

  // Regla 3: procesamiento y extraccion.
  const idP = `SEG3-${Date.now()}`;
  const R3 = (await api("POST", "/samples/reception", aceptada(idP), QA)).data?.id;
  const pMismo = await api("POST", "/samples/processing", procesamiento(R3, idP, { nombre_quien_proceso: "Ana Pérez", nombre_quien_superviso: "ana perez" }), QA);
  const pOk = await api("POST", "/samples/processing", procesamiento(R3, idP), QA);
  const eLimpieza = await api("POST", "/samples/extraction", extraccion(pOk.data?.id, idP, { nombre_quien_extrajo: "Persona A", nombre_quien_limpieza: "Persona C", nombre_quien_superviso: "Persona C" }), QA);
  const eOk = await api("POST", "/samples/extraction", extraccion(pOk.data?.id, idP), QA);
  check("regla 3: quien supervisa no es quien proceso (409, sin importar acentos ni mayusculas)", pMismo.status === 409 && pMismo.data?.regla === 3, `${pMismo.status} ${pMismo.data?.message}`);
  check("regla 3: quien supervisa no es quien hizo la limpieza (409); con personas distintas se registra", eLimpieza.status === 409 && pOk.status === 201 && eOk.status === 201, `${eLimpieza.status} ${pOk.status} ${eOk.status}`);

  // Regla 4: el supervisor que edito lo capturado por su supervisado no le da visto bueno.
  const tD = await login("diego.salinas@ficotox.local", credenciales["diego.salinas@ficotox.local"]);
  const R4 = (await api("POST", "/samples/reception", aceptada(`SEG4-${Date.now()}`), tD)).data?.id;
  const R4b = (await api("POST", "/samples/reception", aceptada(`SEG4b-${Date.now()}`), tD)).data?.id;
  const fichaR4 = (await api("GET", `/samples/reception/${R4}`, undefined, QA)).data?.item;
  const editaR4 = await api("PUT", `/samples/reception/${R4}`, { ...aceptada(fichaR4?.id_interno), folio_num: fichaR4?.folio_num, solicitante: "Cliente corregido por el supervisor" }, tR);
  if (editaR4.status !== 200) check("regla 4: el supervisor edita el registro de su supervisado", false, `${editaR4.status} ${editaR4.data?.message}`);
  const vbPropio = await api("POST", `/supervision/muestras_recepcion/${R4}/visto-bueno`, {}, tR);
  const vbOk = await api("POST", `/supervision/muestras_recepcion/${R4b}/visto-bueno`, {}, tR);
  check("regla 4: el supervisor que edito lo capturado no le da visto bueno (409)", vbPropio.status === 409 && vbPropio.data?.regla === 4, `${vbPropio.status} ${vbPropio.data?.message}`);
  check("regla 4: da visto bueno a lo capturado por su supervisado", vbOk.status === 200, `${vbOk.status} ${vbOk.data?.message}`);

  // Regla 5 (documentos): retirada con la Biblioteca (no hay revision ni aprobacion de documentos).
  // Regla 6: quien solicita no aprueba.
  const c6 = await cadena("SEG6");
  // Fase 6: el analisis se revisa solo despues de enviarlo a revision.
  await api("POST", `/samples/analysis/${c6.A}/enviar-revision`, {}, QA);
  await api("POST", `/samples/analysis/${c6.A}/revisar`, {}, tR);
  await api("POST", `/samples/analysis/${c6.A}/aprobar`, {}, tR);
  const sol = await api("POST", `/samples/analysis/${c6.A}/anular`, { motivo: "Resultado mal capturado" }, tR);
  const propia = await api("POST", `/solicitudes/${sol.data?.solicitud?.id}/aprobar`, { motivo: "Me autoaprueba" }, tR);
  check("regla 6: quien solicita no aprueba su propia solicitud (409 segregacion)", sol.status === 202 && propia.status === 409 && propia.data?.regla === 6, `${sol.status} ${propia.status} ${propia.data?.message}`);
  await api("POST", `/solicitudes/${sol.data?.solicitud?.id}/cancelar`, {}, tR);
}

/* ---------- 3. Segundo usuario ---------- */
{
  const c = await cadena("SOL");
  // Fase 6: el analisis se revisa solo despues de enviarlo a revision.
  await api("POST", `/samples/analysis/${c.A}/enviar-revision`, {}, QA);
  await api("POST", `/samples/analysis/${c.A}/revisar`, {}, tR);
  await api("POST", `/samples/analysis/${c.A}/aprobar`, {}, tR);

  // Anular un analisis aprobado: solicitud, no se ejecuta, registro bloqueado.
  const pedir = await api("POST", `/samples/analysis/${c.A}/anular`, { motivo: "Se detecto un error de calculo" }, QA);
  const solId = pedir.data?.solicitud?.id;
  const sigue = fila("SELECT estado FROM muestras_analisis WHERE id = ?", c.A)?.estado;
  check("anular un analisis aprobado crea la solicitud (202) y no se ejecuta", pedir.status === 202 && pedir.data?.solicitud?.estado === "pendiente" && sigue === "aprobado", `${pedir.status} ${sigue}`);
  const lista = (await api("GET", `/samples/analysis?search=`, undefined, QA)).data?.items || [];
  check("la lista muestra la solicitud pendiente del registro", lista.some((i) => i.id === c.A && i.solicitud_pendiente?.id === solId), "");
  const doble = await api("POST", `/samples/analysis/${c.A}/anular`, { motivo: "Otra vez" }, QA);
  check("una sola solicitud pendiente por registro (409)", doble.status === 409 && doble.data?.codigo === "solicitud_pendiente", `${doble.status}`);
  const sinPermiso = await api("POST", `/solicitudes/${solId}/aprobar`, { motivo: "No tengo AN" }, tL);
  check("aprobar requiere el permiso de la accion (AN en ensayos): 403", sinPermiso.status === 403, `${sinPermiso.status}`);
  const bandejaP = (await api("GET", "/solicitudes", undefined, tP)).data;
  check("bandeja 'Por autorizar' del segundo usuario", (bandejaP?.items || []).some((i) => i.id === solId && i.puedo_aprobar) && bandejaP?.por_autorizar >= 1, `por_autorizar=${bandejaP?.por_autorizar}`);
  const avisos = (await api("GET", "/inicio/avisos", undefined, tP)).data?.items || [];
  check("Inicio: aviso 'Por autorizar'", avisos.some((a) => a.key === "por_autorizar"), avisos.map((a) => a.key).join(","));
  const historial = (await api("GET", `/solicitudes?entidad=muestras_analisis&entidad_id=${c.A}`, undefined, QA)).data?.items || [];
  check("pestaña Solicitudes del historial del registro", historial.some((i) => i.id === solId), `${historial.length}`);
  const sinMotivo = await api("POST", `/solicitudes/${solId}/aprobar`, {}, tP);
  const aprobada = await api("POST", `/solicitudes/${solId}/aprobar`, { motivo: "Confirmado el error de calculo" }, tP);
  const despues = fila("SELECT estado FROM muestras_analisis WHERE id = ?", c.A)?.estado;
  const bitAnular = auditoria("anular", "muestras_analisis", c.A);
  check("aprobar exige motivo (400) y al aprobar se ejecuta la anulacion", sinMotivo.status === 400 && aprobada.status === 200 && despues === "anulado", `${sinMotivo.status} ${aprobada.status} ${despues}`);
  check("la bitacora enlaza la anulacion con la solicitud y quien la pidio", JSON.parse(bitAnular?.cambios_json || "{}")?._detalle?.solicitud_id === solId && !!auditoria("aprobar_solicitud", "muestras_analisis", c.A) && !!auditoria("solicitar", "muestras_analisis", c.A), bitAnular?.cambios_json?.slice(0, 200));

  // Restaurar lo que ya no estaba en borrador: tambien por solicitud.
  const rest = await api("POST", `/samples/analysis/${c.A}/restaurar`, { motivo: "Se anulo el analisis equivocado" }, QA);
  const rechazo = await api("POST", `/solicitudes/${rest.data?.solicitud?.id}/rechazar`, { motivo: "No procede" }, tP);
  const tras = fila("SELECT estado FROM muestras_analisis WHERE id = ?", c.A)?.estado;
  check("restaurar crea solicitud; rechazarla no ejecuta nada", rest.status === 202 && rechazo.status === 200 && rechazo.data?.solicitud?.estado === "rechazada" && tras === "anulado", `${rest.status} ${rechazo.status} ${tras}`);

  // Anular una recepcion con procesamientos vigentes: se rechaza antes de crear la solicitud.
  const c2 = await cadena("SOLR");
  const pedirR = await api("POST", `/samples/reception/${c2.R}/anular`, { motivo: "Duplicada" }, QA);
  check("la anulacion de una recepcion con procesamientos vigentes se rechaza antes de pedirla (409)", pedirR.status === 409, `${pedirR.status} ${pedirR.data?.message}`);
  // Recepcion aceptada sin dependientes.
  const idSola = `SOLR2-${Date.now()}`;
  const Rsola = (await api("POST", "/samples/reception", aceptada(idSola), QA)).data?.id;
  const pedirR2 = await api("POST", `/samples/reception/${Rsola}/anular`, { motivo: "Duplicada" }, QA);
  const origen2 = await api("POST", "/samples/processing", procesamiento(Rsola, idSola), QA);
  const folioR2 = fila("SELECT folio_num FROM muestras_recepcion WHERE id = ?", Rsola)?.folio_num;
  const editarR2 = await api("PUT", `/samples/reception/${Rsola}`, { ...aceptada(idSola), folio_num: folioR2 }, QA);
  const cancelaOtro2 = await api("POST", `/solicitudes/${pedirR2.data?.solicitud?.id}/cancelar`, {}, tP);
  const cancela2 = await api("POST", `/solicitudes/${pedirR2.data?.solicitud?.id}/cancelar`, { motivo: "Ya no aplica" }, QA);
  const origenDespues2 = await api("POST", "/samples/processing", procesamiento(Rsola, `${idSola}-2`), QA);
  check("anular una recepcion aceptada crea solicitud (202)", pedirR2.status === 202, `${pedirR2.status}`);
  check("pendiente: el registro no se edita ni sirve de origen (409 solicitud_pendiente)", origen2.status === 409 && editarR2.status === 409 && origen2.data?.codigo === "solicitud_pendiente", `${origen2.status} ${editarR2.status}`);
  check("solo el solicitante cancela (403 a otro); cancelada no ejecuta y libera el registro", cancelaOtro2.status === 403 && cancela2.status === 200 && fila("SELECT estado FROM muestras_recepcion WHERE id = ?", Rsola)?.estado !== "anulada" && origenDespues2.status === 201, `${cancelaOtro2.status} ${cancela2.status} ${origenDespues2.status}`);

  // Anular en borrador/registrado sigue siendo inmediato (una persona con reautenticacion).
  const c3 = await cadena("SOLB");
  const directo = await api("POST", `/samples/analysis/${c3.A}/anular`, { motivo: "Captura duplicada" }, QA);
  check("anular un analisis registrado (borrador) es inmediato (200)", directo.status === 200 && fila("SELECT estado FROM muestras_analisis WHERE id = ?", c3.A)?.estado === "anulado", `${directo.status}`);

  // Solicitud vencida.
  const c4 = await cadena("SOLV");
  // Fase 6: el analisis se revisa solo despues de enviarlo a revision.
  await api("POST", `/samples/analysis/${c4.A}/enviar-revision`, {}, QA);
  await api("POST", `/samples/analysis/${c4.A}/revisar`, {}, tR);
  const pedirV = await api("POST", `/samples/analysis/${c4.A}/anular`, { motivo: "Vencera sin respuesta" }, QA);
  sql("UPDATE solicitudes_autorizacion SET vence_en = ? WHERE id = ?", new Date(Date.now() - 1000).toISOString(), pedirV.data?.solicitud?.id);
  const aprobarV = await api("POST", `/solicitudes/${pedirV.data?.solicitud?.id}/aprobar`, { motivo: "Tarde" }, tP);
  const estadoV = fila("SELECT estado FROM solicitudes_autorizacion WHERE id = ?", pedirV.data?.solicitud?.id)?.estado;
  check("solicitud vencida: no se aprueba (409), queda 'vencida' en la bitacora y no se ejecuta", pedirV.status === 202 && aprobarV.status === 409 && estadoV === "vencida" && !!auditoria("vencer_solicitud", "muestras_analisis", c4.A) && fila("SELECT estado FROM muestras_analisis WHERE id = ?", c4.A)?.estado === "revisado", `${aprobarV.status} ${estadoV}`);

  // Anular un informe autorizado: segundo usuario con AN en informes.
  const c5 = await cadena("SOLI");
  // Fase 6: el analisis se revisa solo despues de enviarlo a revision.
  await api("POST", `/samples/analysis/${c5.A}/enviar-revision`, {}, QA);
  await api("POST", `/samples/analysis/${c5.A}/revisar`, {}, tR);
  await api("POST", `/samples/analysis/${c5.A}/aprobar`, {}, tR);
  const inf = await api("POST", "/informes", { recepcion_id: c5.R, analisis_ids: [c5.A], cliente: { nombre: "Cliente anulacion" } }, QA);
  await api("POST", `/informes/${inf.data?.id}/revisar`, {}, tR);
  await api("POST", `/informes/${inf.data?.id}/autorizar`, {}, tR);
  const pedirI = await api("POST", `/informes/${inf.data?.id}/anular`, { motivo: "Cliente equivocado" }, tR);
  const estadoI = fila("SELECT estado FROM informes WHERE id = ?", inf.data?.id)?.estado;
  const aprobarI = await api("POST", `/solicitudes/${pedirI.data?.solicitud?.id}/aprobar`, { motivo: "Procede la anulacion" }, tP);
  check("anular un informe autorizado crea solicitud y se ejecuta al aprobarla otra persona", pedirI.status === 202 && estadoI === "autorizado" && aprobarI.status === 200 && fila("SELECT estado FROM informes WHERE id = ?", inf.data?.id)?.estado === "anulado", `${pedirI.status} ${estadoI} ${aprobarI.status} ${aprobarI.data?.message}`);

  // Excepcion de segregacion: el Analista revisa su propio analisis por falta de personal.
  const c6 = await cadena("SOLE", tR);
  // Fase 10: la evidencia la adjunta quien elaboro el analisis (Ricardo); si la adjuntara QA al enviarlo, QA contaria como elaborador.
  await adjuntarEvidencia(BASE, tR, c6.A);
  // Fase 6: el analisis se revisa solo despues de enviarlo a revision.
  await api("POST", `/samples/analysis/${c6.A}/enviar-revision`, {}, QA);
  const sinExc = await api("POST", `/samples/analysis/${c6.A}/revisar`, {}, tR);
  const exc = await api("POST", "/solicitudes", { tipo: "excepcion_segregacion", entidad: "muestras_analisis", entidad_id: c6.A, accion: "revisar", motivo: "Única persona disponible esta semana" }, tR);
  const excSinA = await api("POST", `/solicitudes/${exc.data?.solicitud?.id}/aprobar`, { motivo: "Sin permiso de calidad" }, tL);
  const excOk = await api("POST", `/solicitudes/${exc.data?.solicitud?.id}/aprobar`, { motivo: "Aprobada por falta de personal" }, tP);
  // Fase 6: el analisis se revisa solo despues de enviarlo a revision.
  await api("POST", `/samples/analysis/${c6.A}/enviar-revision`, {}, QA);
  const conExc = await api("POST", `/samples/analysis/${c6.A}/revisar`, {}, tR);
  const aprSinExc = await api("POST", `/samples/analysis/${c6.A}/aprobar`, {}, tR);
  const bitRev = auditoria("revisar", "muestras_analisis", c6.A);
  check("sin excepcion el Analista no revisa lo suyo; la excepcion la aprueba quien tiene A en calidad (403 sin ella)", sinExc.status === 409 && exc.status === 202 && excSinA.status === 403 && excOk.status === 200, `${sinExc.status} ${exc.status} ${excSinA.status} ${excOk.status}`);
  check("con la excepcion aprobada revisa (solo esa accion: aprobar sigue bloqueado) y queda en la bitacora", conExc.status === 200 && aprSinExc.status === 409 && JSON.parse(bitRev?.cambios_json || "{}")?._detalle?.excepcion_segregacion?.solicitud_id === exc.data?.solicitud?.id, `${conExc.status} ${aprSinExc.status}`);
  const fichaExc = (await api("GET", `/samples/analysis/${c6.A}`, undefined, QA)).data?.item;
  check("la ficha muestra la excepcion registrada", (fichaExc?.excepciones || []).some((e) => e.accion === "revisar" && e.solicitud_id === exc.data?.solicitud?.id), JSON.stringify(fichaExc?.excepciones));

  // La excepcion solo la pide quien podria hacer la accion y a quien la segregacion se la impide; pendiente no bloquea el registro.
  const c7 = await cadena("SOLX", tR);
  // Fase 6: la excepcion para revisar aplica a lo enviado a revision.
  await api("POST", `/samples/analysis/${c7.A}/enviar-revision`, {}, tR);
  const excLuis = await api("POST", "/solicitudes", { tipo: "excepcion_segregacion", entidad: "muestras_analisis", entidad_id: c7.A, accion: "revisar", motivo: "Pido revisar sin permiso" }, tL);
  const excInnecesaria = await api("POST", "/solicitudes", { tipo: "excepcion_segregacion", entidad: "muestras_analisis", entidad_id: c7.A, accion: "revisar", motivo: "No elabore este analisis" }, QA);
  const excEstado = await api("POST", "/solicitudes", { tipo: "excepcion_segregacion", entidad: "muestras_analisis", entidad_id: c7.A, accion: "aprobar", motivo: "Aun no esta revisado" }, tR);
  check("excepcion: sin permiso de la accion 403; si la segregacion no lo impide o el estado no aplica, 409", excLuis.status === 403 && excInnecesaria.status === 409 && excInnecesaria.data?.codigo === "excepcion_innecesaria" && excEstado.status === 409, `${excLuis.status} ${excInnecesaria.status} ${excInnecesaria.data?.codigo} ${excEstado.status}`);
  const excPend = await api("POST", "/solicitudes", { tipo: "excepcion_segregacion", entidad: "muestras_analisis", entidad_id: c7.A, accion: "revisar", motivo: "Única persona disponible" }, tR);
  const excDoble = await api("POST", "/solicitudes", { tipo: "excepcion_segregacion", entidad: "muestras_analisis", entidad_id: c7.A, accion: "revisar", motivo: "Otra vez la misma" }, tR);
  // Fase 6: el analisis se revisa solo despues de enviarlo a revision.
  await api("POST", `/samples/analysis/${c7.A}/enviar-revision`, {}, QA);
  const revOtro = await api("POST", `/samples/analysis/${c7.A}/revisar`, {}, QA);
  check("una excepcion pendiente no bloquea el registro: otra persona lo revisa; no se duplica la de la misma persona y accion", excPend.status === 202 && excDoble.status === 409 && revOtro.status === 200, `${excPend.status} ${excDoble.status} ${revOtro.status} ${revOtro.data?.message}`);
  await api("POST", `/solicitudes/${excPend.data?.solicitud?.id}/cancelar`, { motivo: "Ya la reviso otra persona" }, tR);
  const reCancel = await api("POST", `/solicitudes/${excPend.data?.solicitud?.id}/cancelar`, {}, tR);
  check("una solicitud ya resuelta no se vuelve a resolver (409)", reCancel.status === 409, `${reCancel.status}`);

  // Excepcion en un informe: aparece en el PDF. Ricardo elaboro el analisis y el informe.
  await api("POST", `/samples/analysis/${c6.A}/aprobar`, {}, QA);
  const inf2 = await api("POST", "/informes", { recepcion_id: c6.R, analisis_ids: [c6.A], cliente: { nombre: "Cliente excepcion" } }, tR);
  const exc2 = await api("POST", "/solicitudes", { tipo: "excepcion_segregacion", entidad: "informes", entidad_id: inf2.data?.id, accion: "revisar", motivo: "Sin otra persona que revise" }, tR);
  await api("POST", `/solicitudes/${exc2.data?.solicitud?.id}/aprobar`, { motivo: "Aprobada por calidad" }, tP);
  const revInf = await api("POST", `/informes/${inf2.data?.id}/revisar`, {}, tR);
  const autInf = await api("POST", `/informes/${inf2.data?.id}/autorizar`, {}, QA);
  await liberar(BASE, QA, inf2.data?.id);
  const pdf = await api("GET", `/informes/${inf2.data?.id}/pdf`, undefined, QA);
  const texto = textoPdf(pdf.data);
  check("excepcion aprobada en un informe: la revision procede y el PDF la declara", revInf.status === 200 && autInf.status === 200 && texto.includes(`solicitud #${exc2.data?.solicitud?.id}`), `${revInf.status} ${autInf.status} ${autInf.data?.message} pdf=${texto.includes("excepci")}`);
}

/* ---------- 3 bis. Regresiones de la revision (ronda 1) ---------- */
{
  const hoyLab = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  // Informe autorizado sin fecha de emision: la fecha es el dia del laboratorio (no el dia UTC).
  const c = await cadena("REG1");
  // Fase 6: el analisis se revisa solo despues de enviarlo a revision.
  await api("POST", `/samples/analysis/${c.A}/enviar-revision`, {}, QA);
  await api("POST", `/samples/analysis/${c.A}/revisar`, {}, tR);
  await api("POST", `/samples/analysis/${c.A}/aprobar`, {}, tR);
  const inf = (await api("POST", "/informes", { recepcion_id: c.R, analisis_ids: [c.A], cliente: { nombre: "Cliente regresion" } }, QA)).data?.id;
  await api("POST", `/informes/${inf}/revisar`, {}, tR);
  const aut = await api("POST", `/informes/${inf}/autorizar`, {}, tR);
  check("autorizar sin fecha de emision fija el dia del laboratorio (America/Tijuana)", aut.status === 200 && aut.data?.item?.fecha_emision === hoyLab, `${aut.data?.item?.fecha_emision} vs ${hoyLab}`);
  // Con la anulacion del informe pendiente no se envia ni se enmienda.
  await liberar(BASE, tR, inf);
  const pedir = await api("POST", `/informes/${inf}/anular`, { motivo: "Cliente equivocado" }, tR);
  const entregar = await registrarEnvio(BASE, QA, inf);
  const enmendar = await api("POST", `/informes/${inf}/enmienda`, { motivo: "Corregir cliente" }, QA);
  check("informe con anulacion pendiente: no se entrega ni se enmienda (409 solicitud_pendiente)", pedir.status === 202 && entregar.status === 409 && enmendar.status === 409 && entregar.data?.codigo === "solicitud_pendiente", `${pedir.status} ${entregar.status} ${enmendar.status}`);
  await api("POST", `/solicitudes/${pedir.data?.solicitud?.id}/cancelar`, {}, tR);
  // Un analisis con anulacion pendiente no se incluye, revisa ni autoriza en un informe.
  const c2 = await cadena("REG2");
  // Fase 6: el analisis se revisa solo despues de enviarlo a revision.
  await api("POST", `/samples/analysis/${c2.A}/enviar-revision`, {}, QA);
  await api("POST", `/samples/analysis/${c2.A}/revisar`, {}, tR);
  await api("POST", `/samples/analysis/${c2.A}/aprobar`, {}, tR);
  const inf2 = (await api("POST", "/informes", { recepcion_id: c2.R, analisis_ids: [c2.A], cliente: { nombre: "Cliente regresion 2" } }, QA)).data?.id;
  const pedirA = await api("POST", `/samples/analysis/${c2.A}/anular`, { motivo: "Resultado dudoso" }, tR);
  const nuevoInf = await api("POST", "/informes", { recepcion_id: c2.R, analisis_ids: [c2.A], cliente: { nombre: "Otro" } }, QA);
  const revInf = await api("POST", `/informes/${inf2}/revisar`, {}, tP);
  check("analisis con anulacion pendiente: no se incluye ni se revisa en un informe (409)", pedirA.status === 202 && nuevoInf.status === 409 && revInf.status === 409 && nuevoInf.data?.codigo === "solicitud_pendiente", `${pedirA.status} ${nuevoInf.status} ${revInf.status}`);
  await api("POST", `/solicitudes/${pedirA.data?.solicitud?.id}/cancelar`, {}, tR);
}

/* ---------- 4. Cambios de acceso ---------- */
{
  // Fase 3.1: en usuarios G no implica A; nadie cambia los permisos de un rol que tiene vigente.
  const JORGE = "jorge.ramirez@ficotox.local";
  const tH = await login(JORGE, credenciales[JORGE]);
  const altaH = await api("POST", "/admin/usuarios", { nombre: "Aprobador prueba", email: `aprobador.${Date.now()}@cicese.mx`, activo: true, rol_id: rolId("Técnico Auxiliar"), password: "Aprobador-Prueba-2026", motivo: "Alta de prueba" }, QA);
  const apruebaAdmin = await api("POST", `/solicitudes/${altaH.data?.solicitud?.id}/aprobar`, { motivo: "Lo apruebo como administrador" }, tH);
  const apruebaRG = await api("POST", `/solicitudes/${altaH.data?.solicitud?.id}/aprobar`, { motivo: "Autorizado por la Responsable General" }, tP);
  check("usuarios:G no implica A: el Administrador tecnico no aprueba cambios de acceso (403); la Responsable General si", altaH.status === 201 && apruebaAdmin.status === 403 && apruebaRG.status === 200, `${altaH.status} ${apruebaAdmin.status} ${apruebaRG.status}`);
  const rolAdmin = roles.find((r) => r.nombre === "Administrador técnico del sistema");
  const detAdmin = (await api("GET", `/admin/roles/${rolAdmin?.id}`, undefined, tH)).data;
  const propioRol = await api("PUT", `/admin/roles/${rolAdmin?.id}`, { nombre: rolAdmin?.nombre, descripcion: rolAdmin?.descripcion, activo: true, motivo: "Me agrego permisos", permisos: [...(detAdmin?.permisos || []), { modulo: "informes", accion: "V", alcance: "total" }] }, tH);
  const rolTA = roles.find((r) => r.nombre === "Técnico Auxiliar");
  const detTA = (await api("GET", `/admin/roles/${rolTA?.id}`, undefined, tH)).data;
  const otroRol = await api("PUT", `/admin/roles/${rolTA?.id}`, { nombre: rolTA?.nombre, descripcion: rolTA?.descripcion, activo: true, motivo: "Sin cambios de permisos", permisos: detTA?.permisos || [] }, tH);
  check("nadie edita los permisos de un rol que tiene vigente (409); otro rol si se edita", propioRol.status === 409 && propioRol.data?.codigo === "rol_propio" && otroRol.status === 200, `${propioRol.status} ${propioRol.data?.message} ${otroRol.status} ${otroRol.data?.message}`);

  // Rol inicial rechazado: la cuenta sigue sin roles, tambien tras reiniciar (api-roles --tras-reinicio lo comprueba).
  const emailR = `rechazo.${Date.now()}@cicese.mx`;
  const altaR = await api("POST", "/admin/usuarios", { nombre: "Alta rechazada", email: emailR, activo: true, rol_id: rolId("Técnico Auxiliar"), password: "Alta-Rechazada-2026", motivo: "Alta de prueba" }, QA);
  const rechazoR = await api("POST", `/solicitudes/${altaR.data?.solicitud?.id}/rechazar`, { motivo: "No procede el alta" }, tP);
  const rolesR = (await api("GET", `/admin/usuarios/${altaR.data?.id}`, undefined, QA)).data?.item?.roles || [];
  check("rol inicial rechazado: la cuenta queda sin roles", altaR.status === 201 && rechazoR.status === 200 && rolesR.length === 0, `${altaR.status} ${rechazoR.status} roles=${rolesR.length}`);
  writeFileSync(path.join(path.dirname(process.env.DATOS_APOYO_FILE), "segregacion-reinicio.json"), JSON.stringify({ alta_rechazada: altaR.data?.id }));

  const email = `acceso.${Date.now()}@cicese.mx`;
  const alta = await api("POST", "/admin/usuarios", { nombre: "Acceso prueba", email, activo: true, rol_id: rolId("Técnico Auxiliar"), password: "Acceso-Prueba-2026", motivo: "Alta de prueba" }, QA);
  const uid = alta.data?.id;
  const sinRoles = (await api("GET", `/admin/usuarios/${uid}`, undefined, QA)).data?.item?.roles || [];
  check("alta de cuenta: el rol inicial queda pendiente (la cuenta nace sin roles)", alta.status === 201 && alta.data?.solicitud?.tipo === "asignar_rol" && sinRoles.length === 0, `${alta.status} roles=${sinRoles.length}`);
  const propia = await api("POST", `/solicitudes/${alta.data?.solicitud?.id}/aprobar`, { motivo: "Me autoaprueba" }, QA);
  const sinA = await api("POST", `/solicitudes/${alta.data?.solicitud?.id}/aprobar`, { motivo: "Sin usuarios:A" }, tL);
  const rg = await api("POST", `/solicitudes/${alta.data?.solicitud?.id}/aprobar`, { motivo: "Alta autorizada" }, tP);
  const conRol = (await api("GET", `/admin/usuarios/${uid}`, undefined, QA)).data?.item?.roles || [];
  check("asignar rol: ni el solicitante (409) ni quien no tiene usuarios:A (403) aprueban; el Responsable General si", propia.status === 409 && sinA.status === 403 && rg.status === 200 && conRol.some((r) => r.nombre === "Técnico Auxiliar"), `${propia.status} ${sinA.status} ${rg.status}`);
  const extra = await api("POST", `/admin/usuarios/${uid}/roles`, { rol_id: rolId("Técnico Analista"), motivo: "Segundo rol" }, QA);
  const aun = (await api("GET", `/admin/usuarios/${uid}`, undefined, QA)).data?.item?.roles || [];
  check("asignar un rol a una cuenta existente queda pendiente (202) hasta que lo aprueba el Responsable General", extra.status === 202 && !aun.some((r) => r.nombre === "Técnico Analista"), `${extra.status}`);
  await api("POST", `/solicitudes/${extra.data?.solicitud?.id}/aprobar`, { motivo: "Autorizado" }, tP);
  const asig = ((await api("GET", `/admin/usuarios/${uid}`, undefined, QA)).data?.item?.asignaciones || []).find((a) => a.rol === "Técnico Analista" && !a.revocado_en);
  const revocar = await api("POST", `/admin/usuarios/${uid}/roles/${asig?.id}/revocar`, { motivo: "Ya no aplica" }, QA);
  const trasRevocar = (await api("GET", `/admin/usuarios/${uid}`, undefined, QA)).data?.item?.roles || [];
  check("revocar un rol es inmediato (200, sin solicitud)", revocar.status === 200 && !revocar.data?.solicitud && !trasRevocar.some((r) => r.nombre === "Técnico Analista"), `${revocar.status}`);
  const baja = await api("DELETE", `/admin/usuarios/${uid}`, { motivo: "Fin de la prueba" }, QA);
  check("dar de baja es inmediato (200, sin solicitud)", baja.status === 200 && Number(fila("SELECT activo FROM usuarios WHERE id = ?", uid)?.activo) === 0, `${baja.status}`);
  const reactivar = await api("PUT", `/admin/usuarios/${uid}`, { nombre: "Acceso prueba", email, activo: true }, QA);
  const sigueInactiva = Number(fila("SELECT activo FROM usuarios WHERE id = ?", uid)?.activo);
  await api("POST", `/solicitudes/${reactivar.data?.solicitud?.id}/aprobar`, { motivo: "Regresa" }, tP);
  check("reactivar una cuenta crea solicitud y solo se reactiva al aprobarla", reactivar.status === 202 && reactivar.data?.solicitud?.tipo === "reactivar_cuenta" && sigueInactiva === 0 && Number(fila("SELECT activo FROM usuarios WHERE id = ?", uid)?.activo) === 1, `${reactivar.status} ${sigueInactiva}`);

  // Ampliar la vigencia de una cuenta temporal: solicitud; acortarla es inmediato.
  const temp = `temporal.${Date.now()}@cicese.mx`;
  const tAlta = await api("POST", "/admin/usuarios", { nombre: "Temporal prueba", email: temp, activo: true, rol_id: rolId("Técnico Auxiliar"), password: "Temporal-Prueba-2026", tipo_cuenta: "temporal", vigente_hasta: "2099-06-30", supervisor_id: idDe(RICARDO), motivo_cuenta: "Estancia", motivo: "Alta temporal" }, QA);
  await api("POST", `/solicitudes/${tAlta.data?.solicitud?.id}/aprobar`, { motivo: "Alta temporal autorizada" }, tP);
  const base = { nombre: "Temporal prueba", email: temp, activo: true, tipo_cuenta: "temporal", supervisor_id: idDe(RICARDO) };
  const acortar = await api("PUT", `/admin/usuarios/${tAlta.data?.id}`, { ...base, vigente_hasta: "2099-05-31", motivo_cuenta: "Se acorta" }, QA);
  const ampliar = await api("PUT", `/admin/usuarios/${tAlta.data?.id}`, { ...base, vigente_hasta: "2099-12-31", motivo_cuenta: "Se amplia la estancia" }, QA);
  const hastaPend = fila("SELECT vigente_hasta FROM usuarios WHERE id = ?", tAlta.data?.id)?.vigente_hasta;
  await api("POST", `/solicitudes/${ampliar.data?.solicitud?.id}/aprobar`, { motivo: "Ampliacion autorizada" }, tP);
  const hastaFin = fila("SELECT vigente_hasta FROM usuarios WHERE id = ?", tAlta.data?.id)?.vigente_hasta;
  const sinReauth = await api("PUT", `/admin/usuarios/${tAlta.data?.id}`, { ...base, vigente_hasta: "2100-06-30", motivo_cuenta: "Otra ampliacion" }, QA, { "X-Sin-Reauth-Auto": "1" });
  check("pedir una ampliacion de vigencia exige reautenticacion (401)", sinReauth.status === 401 && sinReauth.data?.codigo === "reauth_required", `${sinReauth.status}`);
    check("acortar la vigencia es inmediato; ampliarla crea solicitud y se aplica al aprobarla", acortar.status === 200 && ampliar.status === 202 && ampliar.data?.solicitud?.tipo === "ampliar_vigencia" && hastaPend === "2099-05-31" && hastaFin === "2099-12-31", `${acortar.status} ${ampliar.status} ${hastaPend} ${hastaFin}`);

  // La persona afectada no aprueba un cambio de acceso sobre su propia cuenta; una cuenta admite solicitudes de distinto tipo a la vez.
  const pidA = idDe(PATRICIA);
  const paraRG = await api("POST", `/admin/usuarios/${pidA}/roles`, { rol_id: rolId("Coordinador/a de Mejora Continua"), motivo: "Rol adicional de prueba" }, QA);
  const autoApr = await api("POST", `/solicitudes/${paraRG.data?.solicitud?.id}/aprobar`, { motivo: "Me lo apruebo" }, tP);
  check("la persona afectada no aprueba un cambio de acceso sobre su propia cuenta (409)", paraRG.status === 202 && autoApr.status === 409 && autoApr.data?.codigo === "segregacion", `${paraRG.status} ${autoApr.status}`);
  await api("POST", `/solicitudes/${paraRG.data?.solicitud?.id}/cancelar`, {}, QA);
  const temp2 = `temporal2.${Date.now()}@cicese.mx`;
  const t2 = await api("POST", "/admin/usuarios", { nombre: "Temporal dos", email: temp2, activo: true, rol_id: rolId("Técnico Auxiliar"), password: "Temporal-Dos-2026", tipo_cuenta: "temporal", vigente_hasta: "2099-06-30", supervisor_id: idDe(RICARDO), motivo_cuenta: "Estancia", motivo: "Alta temporal" }, QA);
  const amp2 = await api("PUT", `/admin/usuarios/${t2.data?.id}`, { nombre: "Temporal dos", email: temp2, activo: true, tipo_cuenta: "temporal", supervisor_id: idDe(RICARDO), vigente_hasta: "2099-12-31", motivo_cuenta: "Se amplia" }, QA);
  check("una cuenta con su rol inicial pendiente admite tambien una ampliacion de vigencia pendiente", t2.data?.solicitud?.estado === "pendiente" && amp2.status === 202, `${amp2.status} ${amp2.data?.message}`);

  // Responsable General: usuarios V A en la base.
  const rgFilas = (() => {
    const d = new Database(process.env.TEST_DB_PATH);
    try {
      return d.prepare("SELECT ra.accion FROM rol_acciones ra JOIN roles r ON r.id = ra.id_rol WHERE r.clave = 'responsable_general' AND ra.modulo = 'usuarios' ORDER BY ra.accion").all().map((f) => f.accion);
    } finally {
      d.close();
    }
  })();
  check("matriz: Responsable General tiene usuarios V A", rgFilas.join(" ") === "A V", rgFilas.join(" "));
}

/* ---------- 5. Bitacora legible e integridad ---------- */
{
  const acciones = new Set((() => {
    const d = new Database(process.env.TEST_DB_PATH);
    try {
      return d.prepare("SELECT DISTINCT accion FROM auditoria").all().map((f) => f.accion);
    } finally {
      d.close();
    }
  })());
  const faltan = ["solicitar", "aprobar_solicitud", "rechazar_solicitud", "cancelar_solicitud", "vencer_solicitud"].filter((a) => !acciones.has(a));
  check("la bitacora registra solicitar, aprobar, rechazar, cancelar y vencer solicitudes", faltan.length === 0, faltan.join(","));
  const verificar = await api("GET", "/audit/verify", undefined, QA);
  check("verificar integridad de la bitacora: en verde", verificar.data?.ok === true, JSON.stringify(verificar.data).slice(0, 200));
}

const fallidas = results.filter((r) => !r.ok);
console.log(`\n${results.length - fallidas.length}/${results.length} pruebas de segregacion y solicitudes pasaron`);
process.exit(fallidas.length ? 1 : 0);
