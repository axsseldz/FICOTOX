/*
 * Flujo de muestras de la Fase 5, contra el servidor de prueba, con los usuarios
 * de ejemplo:
 * - asignacion: el Analista sin asignacion no procesa (403 no_asignado); asignado, si;
 * - flujo completo recepcion -> informe con los estados nuevos, en orden;
 * - analisis enviado a revision no se edita; devolver lo reabre; enmienda de un
 *   aprobado crea v2 y la original queda sustituida;
 * - la Tecnico Auxiliar rechaza una recepcion -> solicitud; la Coord. Tecnica la aprueba;
 *   cambio de folio y reapertura tambien por solicitud;
 * - firma de otra persona sin su contrasena -> 403; con ella -> 201; firmante sin
 *   autorizacion FX-THF-AP -> 403; regla 3 con la misma cuenta -> 409;
 * - etiqueta: datos del lote.
 */
import "./lib/reauth-auto.mjs";
import { readFileSync } from "node:fs";
import { autorizarTodo } from "./lib/autorizar.mjs";
import { liberar, registrarEnvio } from "./lib/envio.mjs";

const BASE = process.env.BASE || "http://localhost:3100/api";
const credenciales = JSON.parse(readFileSync(process.env.CREDENCIALES_ROLES, "utf8"));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const MANUAL = { "X-Sin-Aprobar-Auto": "1" };
async function api(method, ruta, body, token, headers = {}) {
  const res = await fetch(`${BASE}${ruta}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const login = async (email, password) => (await api("POST", "/auth/login", { email, password })).data?.token;
const QA = await login("qa@ficotox.local", "QaFicotox2026!");
const RICARDO = "ricardo.medina@ficotox.local";
const PATRICIA = "patricia.luna@ficotox.local";
const LUIS = "luis.castro@ficotox.local";
const MARIANA = "mariana.delgado@ficotox.local";
const tR = await login(RICARDO, credenciales[RICARDO]);
const tP = await login(PATRICIA, credenciales[PATRICIA]);
const tL = await login(LUIS, credenciales[LUIS]);
const tM = await login(MARIANA, credenciales[MARIANA]);
const usuarios = (await api("GET", "/admin/usuarios", undefined, QA)).data?.items || [];
const idDe = (email) => usuarios.find((u) => u.email === email)?.id;
// Las suites anteriores revocan autorizaciones de Luis: se parte de las que necesita el flujo (QA las otorga; las vigentes no se duplican).
await autorizarTodo(BASE, QA, idDe(LUIS));
const estadoR = async (id) => (await api("GET", `/samples/reception/${id}`, undefined, QA)).data?.item?.estado;

const inspeccion = { checklist: Array.from({ length: 7 }, (_, i) => ({ requisito: `Requisito ${i + 1}`, estado: i === 6 ? "NA" : "C", observacion: null })), observaciones_generales: null };
let n = 0;
const nuevaId = (p) => `${p}-${Date.now()}-${(n += 1)}`;
const recepcion = (id, extra = {}) => ({ fecha_recepcion: "2026-09-20", hora_recepcion: "09:00", recibido_por: "Mariana", medio_recepcion: "directa", solicitante: "Cliente flujo F5", muestra_unica: true, id_interno: id, fecha_muestra: "2026-09-19", analisis: { tipos: ["toxinas_lipofilicas"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] }, inspeccion, decision_aceptacion: "aceptada", aceptacion: { fecha: "2026-09-20", responsable: "Mariana" }, ...extra });
const procesamiento = (R, id, extra = {}) => ({ recepcion_id: R, muestra_tipo: "unica", id_interno: id, fecha_procesamiento: "2026-09-20", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "Luis", ...extra });
const extraccion = (P, id, extra = {}) => ({ tipo_registro: "E-D", procesamiento_id: P, tipo_molienda: "fresca", id_interno: id, fecha_extraccion: "2026-09-20", registro_pesos: [{ id_muestra: id, replica: `${id}_R1`, peso_muestra: 2.01 }], nombre_quien_extrajo: "Luis", ...extra });
const analisis = (E, id, extra = {}) => ({ tipo_analisis: "toxinas_lipofilicas", metodo: "hplc_ms_ms", extraccion_id: E, fecha_analisis: "2026-09-20", analista_nombre: "Luis", resultados: [{ id_muestra: id, resultado: 50, unidad: "µg/kg", limite_regulatorio: 160, cumple: "cumple" }], ...extra });
const asignar = (R, email, token = tR) => api("POST", `/samples/reception/${R}/asignaciones`, { usuario_id: idDe(email), motivo: "Asignación de la prueba" }, token);

/* ---------- 1. Asignacion + 2. flujo completo con los estados nuevos ---------- */
let flujo = null;
{
  const id = nuevaId("F5");
  const estados = [];
  // Ajustes de interfaz: el solicitante (campo 3 del FX-TCF-GMR) es obligatorio al crear y al editar.
  const sinSolicitante = await api("POST", "/samples/reception", recepcion(`${id}-SS`, { solicitante: "  " }), tM);
  check("crear una recepción sin solicitante: 400 'Indica el solicitante'", sinSolicitante.status === 400 && sinSolicitante.data?.message === "Indica el solicitante", `${sinSolicitante.status} ${sinSolicitante.data?.message}`);
  const R = (await api("POST", "/samples/reception", recepcion(id), tM)).data?.id;
  check("con solicitante se crea (201)", !!R);
  const folioR = (await api("GET", `/samples/reception/${R}`, undefined, QA)).data?.item?.folio_num;
  const editarSin = await api("PUT", `/samples/reception/${R}`, { ...recepcion(id), folio_num: folioR, solicitante: "" }, tM);
  check("editar quitando el solicitante: 400 'Indica el solicitante'", editarSin.status === 400 && editarSin.data?.message === "Indica el solicitante", `${editarSin.status} ${editarSin.data?.message}`);
  estados.push(await estadoR(R));
  const sinAsignar = await api("POST", "/samples/processing", procesamiento(R, id), tL);
  check("el Analista sin asignacion no crea el procesamiento: 403 no_asignado", sinAsignar.status === 403 && sinAsignar.data?.codigo === "no_asignado", `${sinAsignar.status} ${sinAsignar.data?.message}`);
  const aux = await asignar(R, LUIS, tL);
  const asig = await asignar(R, LUIS);
  check("solo quien tiene muestras:A asigna (el Analista 403; la Coord. Tecnica 201)", aux.status === 403 && asig.status === 201, `${aux.status} ${asig.status} ${asig.data?.message}`);
  const P = await api("POST", "/samples/processing", procesamiento(R, id), tL);
  estados.push(await estadoR(R));
  check("asignado, el Analista crea el procesamiento (201)", P.status === 201, `${P.status} ${P.data?.message}`);
  const E = (await api("POST", "/samples/extraction", extraccion(P.data?.id, id, { folio_procesamiento_num: 99999 }), tL)).data?.id;
  estados.push(await estadoR(R));
  // El folio de la etapa anterior lo fija el servidor desde el registro vinculado (aqui no se manda, o se manda mal).
  const fR = (await api("GET", `/samples/reception/${R}`, undefined, QA)).data?.item?.folio_num;
  const fichaP = (await api("GET", `/samples/processing/${P.data?.id}`, undefined, QA)).data?.item;
  const fichaE = (await api("GET", `/samples/extraction/${E}`, undefined, QA)).data?.item;
  check("el folio vinculado sale del registro de origen (procesamiento ← recepción, extracción ← procesamiento)", fR != null && Number(fichaP?.folio_recepcion_num) === Number(fR) && Number(fichaE?.folio_procesamiento_num) === Number(fichaP?.folio_num), `P.R=${fichaP?.folio_recepcion_num} R=${fR} E.P=${fichaE?.folio_procesamiento_num} P=${fichaP?.folio_num}`);
  const A = (await api("POST", "/samples/analysis", analisis(E, id), tL)).data?.id;
  estados.push(await estadoR(R));
  const enviar = await api("POST", `/samples/analysis/${A}/enviar-revision`, {}, tL);
  estados.push(await estadoR(R));
  // Fase 6: el analisis se revisa solo despues de enviarlo a revision.
  await api("POST", `/samples/analysis/${A}/enviar-revision`, {}, QA);
  const rev = await api("POST", `/samples/analysis/${A}/revisar`, {}, tR);
  const apr = await api("POST", `/samples/analysis/${A}/aprobar`, {}, tR);
  estados.push(await estadoR(R));
  const inf = await api("POST", "/informes", { recepcion_id: R, analisis_ids: [A], cliente: { nombre: "Cliente flujo F5" } }, tL);
  estados.push(await estadoR(R));
  const revInf = await api("POST", `/informes/${inf.data?.id}/revisar`, {}, tR);
  const aut = await api("POST", `/informes/${inf.data?.id}/autorizar`, {}, tP);
  estados.push(await estadoR(R));
  // Fase 6: autorizar ya no libera; Patricia libera (PDF final) y se registra el envio.
  const lib = await liberar(BASE, tP, inf.data?.id);
  estados.push(await estadoR(R));
  const env = await registrarEnvio(BASE, tP, inf.data?.id, { nombre: "Cliente flujo F5", correo: "cliente.flujo@ejemplo.mx" });
  const infFinal = (await api("GET", `/informes/${inf.data?.id}`, undefined, QA)).data?.item;
  const esperado = ["aceptada", "en_procesamiento", "en_extraccion", "en_analisis", "en_revision_tecnica", "validada", "informe_elaborado", "informe_elaborado", "liberada"];
  check("flujo completo: la recepcion recorre los estados nuevos en orden (autorizar no libera; liberar si)", JSON.stringify(estados) === JSON.stringify(esperado) && enviar.status === 200 && rev.status === 200 && apr.status === 200 && inf.status === 201 && revInf.status === 200 && aut.status === 200 && lib.status === 200, `${estados.join(" → ")} | ${enviar.status} ${rev.status} ${apr.status} ${inf.status} ${revInf.status} ${aut.status} ${lib.status} ${lib.data?.message || ""}`);
  check("flujo completo: el informe liberado se envia con evidencia y queda enviado", env.status === 200 && infFinal?.estado === "enviado" && infFinal?.pdf_integridad === "ok", `${env.status} ${env.data?.message} ${infFinal?.estado} ${infFinal?.pdf_integridad}`);
  const mias = (await api("GET", "/samples/reception?mias=1", undefined, tL)).data?.items || [];
  check("filtro 'Mis muestras': el Analista ve la muestra asignada", mias.some((r) => r.id === R), `${mias.length}`);
  flujo = { id, R, P: P.data?.id, E };
}

/* ---------- 3. Revision y enmiendas del analisis ---------- */
{
  const { id, E } = flujo;
  const A = (await api("POST", "/samples/analysis", analisis(E, id), tL)).data?.id;
  const ficha = (await api("GET", `/samples/analysis/${A}`, undefined, QA)).data?.item;
  const folio = ficha?.folio_num;
  // La ficha trae el folio de la recepcion para la cadena (antes solo la lista lo unia).
  const folioR = (await api("GET", `/samples/reception/${flujo.R}`, undefined, QA)).data?.item?.folio_num;
  check("la ficha del analisis trae el folio de su recepcion (cadena R → P → E)", folioR != null && Number(ficha?.folio_recepcion_num) === Number(folioR), `${ficha?.folio_recepcion_num} vs ${folioR}`);
  await api("POST", `/samples/analysis/${A}/enviar-revision`, {}, tL);
  const editar = await api("PUT", `/samples/analysis/${A}`, { ...analisis(E, id), folio_num: folio, observaciones: "Cambio tras enviar" }, tL);
  check("un analisis enviado a revision no se edita (409)", editar.status === 409, `${editar.status} ${editar.data?.message}`);
  const devolver = await api("POST", `/samples/analysis/${A}/devolver`, { motivo: "Falta el duplicado" }, tR);
  const editar2 = await api("PUT", `/samples/analysis/${A}`, { ...analisis(E, id), folio_num: folio, observaciones: "Corregido" }, tL);
  check("devolver con observaciones lo reabre: vuelve a registrado y se edita (200)", devolver.status === 200 && devolver.data?.item?.estado === "registrado" && editar2.status === 200, `${devolver.status} ${devolver.data?.item?.estado} ${editar2.status}`);
  await api("POST", `/samples/analysis/${A}/enviar-revision`, {}, tL);
  await api("POST", `/samples/analysis/${A}/revisar`, {}, tR);
  await api("POST", `/samples/analysis/${A}/aprobar`, {}, tR);
  const enmienda = await api("POST", `/samples/analysis/${A}/enmendar`, { motivo: "Error de transcripción del resultado" }, tL);
  const v2 = enmienda.data?.id;
  const v2Item = (await api("GET", `/samples/analysis/${v2}`, undefined, QA)).data?.item;
  check("la enmienda de un aprobado crea v2 con el mismo folio (201)", enmienda.status === 201 && v2Item?.version === 2 && v2Item?.folio_num === folio && Number(v2Item?.sustituye_a) === A, `${enmienda.status} v=${v2Item?.version} folio=${v2Item?.folio_num}`);
  await api("POST", `/samples/analysis/${v2}/enviar-revision`, {}, tL);
  await api("POST", `/samples/analysis/${v2}/revisar`, {}, tR);
  const aprV2 = await api("POST", `/samples/analysis/${v2}/aprobar`, {}, tR);
  const original = (await api("GET", `/samples/analysis/${A}`, undefined, QA)).data?.item;
  check("al aprobarse la v2, la original queda sustituida", aprV2.status === 200 && original?.estado === "sustituido", `${aprV2.status} ${original?.estado}`);
}

/* ---------- 4. Decisiones que autoriza la Coord. Tecnica ---------- */
{
  const id = nuevaId("F5R");
  const rechazo = await api("POST", "/samples/reception", recepcion(id, { decision_aceptacion: "rechazada", aceptacion: { fecha: "2026-09-20", responsable: "Mariana", comunicacion_cliente: { fecha: "2026-09-20", medio: "correo" } } }), tM, MANUAL);
  const R = rechazo.data?.id;
  const antes = await estadoR(R);
  check("la Tecnico Auxiliar rechaza: la recepcion se crea y la decision queda en solicitud", rechazo.status === 201 && rechazo.data?.solicitud?.tipo === "decision_recepcion" && antes === "registrada", `${rechazo.status} ${rechazo.data?.solicitud?.tipo} ${antes}`);
  const propia = await api("POST", `/solicitudes/${rechazo.data?.solicitud?.id}/aprobar`, { motivo: "Me la apruebo" }, tM);
  const coord = await api("POST", `/solicitudes/${rechazo.data?.solicitud?.id}/aprobar`, { motivo: "Procede el rechazo" }, tR);
  check("la Coord. Tecnica la aprueba y la recepcion queda rechazada (la Auxiliar no puede)", [403, 409].includes(propia.status) && coord.status === 200 && (await estadoR(R)) === "rechazada", `${propia.status} ${coord.status}`);
  const reabrir = await api("POST", `/samples/reception/${R}/reabrir`, { motivo: "El cliente envió la documentación" }, tM, MANUAL);
  const okReabrir = await api("POST", `/solicitudes/${reabrir.data?.solicitud?.id}/aprobar`, { motivo: "Procede" }, tR);
  check("reabrir una rechazada: solicitud (202) y, aprobada, vuelve a registrada", reabrir.status === 202 && okReabrir.status === 200 && (await estadoR(R)) === "registrada", `${reabrir.status} ${okReabrir.status}`);
  const folioActual = (await api("GET", `/samples/reception/${R}`, undefined, QA)).data?.item?.folio_num;
  const putFolio = await api("PUT", `/samples/reception/${R}`, { ...recepcion(id), folio_num: folioActual + 500 }, tM);
  const pedirFolio = await api("POST", `/samples/reception/${R}/folio`, { folio_num: folioActual + 500, motivo: "Folio duplicado en papel" }, tM, MANUAL);
  const okFolio = await api("POST", `/solicitudes/${pedirFolio.data?.solicitud?.id}/aprobar`, { motivo: "Procede" }, tR);
  const nuevoFolio = (await api("GET", `/samples/reception/${R}`, undefined, QA)).data?.item?.folio_num;
  check("el folio no se edita (409); cambiarlo es solicitud y la Coord. Tecnica lo aprueba", putFolio.status === 409 && pedirFolio.status === 202 && okFolio.status === 200 && nuevoFolio === folioActual + 500, `${putFolio.status} ${pedirFolio.status} ${okFolio.status} ${nuevoFolio}`);
}

/* ---------- 5. Firmas ligadas a cuentas ---------- */
{
  const id = nuevaId("F5F");
  const R = (await api("POST", "/samples/reception", recepcion(id), QA)).data?.id;
  const sinToken = await api("POST", "/samples/processing", procesamiento(R, id, { firmantes: { proceso: { usuario_id: idDe(LUIS) } } }), QA);
  check("firma de otra persona sin su contrasena: 403 firma_sin_confirmar", sinToken.status === 403 && sinToken.data?.codigo === "firma_sin_confirmar", `${sinToken.status} ${sinToken.data?.message}`);
  const malo = await api("POST", "/firmas/confirmar", { usuario_id: idDe(LUIS), password: "incorrecta-123" }, QA);
  const conf = await api("POST", "/firmas/confirmar", { usuario_id: idDe(LUIS), password: credenciales[LUIS] }, QA);
  const conToken = await api("POST", "/samples/processing", procesamiento(R, id, { firmantes: { proceso: { usuario_id: idDe(LUIS), token_firma: conf.data?.token_firma } } }), QA);
  const item = (await api("GET", `/samples/processing/${conToken.data?.id}`, undefined, QA)).data?.item;
  check("con la contrasena del firmante: 201 y la firma queda ligada a su cuenta (usuario_id, nombre y cargo)", malo.status === 401 && conf.status === 200 && conToken.status === 201 && Number(item?.proceso_usuario_id) === idDe(LUIS) && /Luis/.test(item?.nombre_quien_proceso || "") && !!item?.proceso_cargo, `${malo.status} ${conf.status} ${conToken.status} ${item?.proceso_usuario_id} ${item?.proceso_cargo}`);
  const reuso = await api("POST", "/samples/processing", procesamiento(R, `${id}-b`, { firmantes: { proceso: { usuario_id: idDe(LUIS), token_firma: conf.data?.token_firma } } }), QA);
  check("el token de firma es de un solo uso (403 al reusarlo)", reuso.status === 403, `${reuso.status}`);
  // Ajustes de interfaz: la contraseña del firmante viaja al GUARDAR (sin escribir nada antes) y se verifica en esa petición.
  const totalAntes = ((await api("GET", "/samples/processing?search=", undefined, QA)).data?.items || []).length;
  const conPasswordMala = await api("POST", "/samples/processing", procesamiento(R, `${id}-pm`, { firmantes: { proceso: { usuario_id: idDe(LUIS), password: "incorrecta-123" } } }), QA);
  const totalTras = ((await api("GET", "/samples/processing?search=", undefined, QA)).data?.items || []).length;
  check("contraseña del firmante incorrecta al guardar: 401 firma_invalida con el rol y nada se crea", conPasswordMala.status === 401 && conPasswordMala.data?.codigo === "firma_invalida" && conPasswordMala.data?.rol === "proceso" && totalTras === totalAntes, `${conPasswordMala.status} ${conPasswordMala.data?.codigo} ${totalAntes}→${totalTras}`);
  const conPassword = await api("POST", "/samples/processing", procesamiento(R, `${id}-pw`, { firmantes: { proceso: { usuario_id: idDe(LUIS), password: credenciales[LUIS] } } }), QA);
  const itemPw = (await api("GET", `/samples/processing/${conPassword.data?.id}`, undefined, QA)).data?.item;
  check("contraseña del firmante correcta al guardar: 201 y la firma queda ligada a su cuenta", conPassword.status === 201 && Number(itemPw?.proceso_usuario_id) === idDe(LUIS), `${conPassword.status} ${conPassword.data?.message || ""}`);
  const sinNada = await api("POST", "/samples/processing", procesamiento(R, `${id}-sn`, { firmantes: { proceso: { usuario_id: idDe(LUIS) } } }), QA);
  check("otra persona como firmante sin contraseña ni token: 403 firma_sin_confirmar", sinNada.status === 403 && sinNada.data?.codigo === "firma_sin_confirmar", `${sinNada.status}`);
  // Firmante sin autorizacion FX-THF-AP: una cuenta nueva (sin roles ni autorizaciones).
  const email = `firmante.${Date.now()}@cicese.mx`;
  const alta = await api("POST", "/admin/usuarios", { nombre: "Firmante sin autorizacion", email, activo: true, rol_id: (await api("GET", "/admin/roles", undefined, QA)).data?.items?.find((r) => r.nombre === "Técnico Auxiliar")?.id, password: "Firmante-Prueba-2026", motivo: "Alta de prueba" }, QA, MANUAL);
  const confNuevo = await api("POST", "/firmas/confirmar", { usuario_id: alta.data?.id, password: "Firmante-Prueba-2026" }, QA);
  const sinAut = await api("POST", "/samples/processing", procesamiento(R, `${id}-c`, { firmantes: { proceso: { usuario_id: alta.data?.id, token_firma: confNuevo.data?.token_firma } } }), QA);
  check("firmante de un trabajo tecnico sin autorizacion FX-THF-AP: 403 no_autorizado", sinAut.status === 403 && sinAut.data?.codigo === "no_autorizado", `${alta.status} ${confNuevo.status} ${sinAut.status} ${sinAut.data?.message}`);
  const qaId = usuarios.find((u) => u.email === "qa@ficotox.local")?.id;
  const regla3 = await api("POST", "/samples/processing", procesamiento(R, `${id}-d`, { nombre_quien_proceso: "QA uno", nombre_quien_superviso: "QA dos", firmantes: { proceso: { usuario_id: qaId }, superviso: { usuario_id: qaId } } }), QA);
  check("regla 3 por cuenta: la misma cuenta en procesó y supervisó -> 409", regla3.status === 409 && regla3.data?.regla === 3, `${regla3.status} ${regla3.data?.message}`);
}

/* ---------- 6. Etiqueta ---------- */
{
  const id = nuevaId("F5E");
  const R = (await api("POST", "/samples/reception", recepcion(id, { muestra_unica: false, lote_muestras: [{ id_interno: `${id}-1`, nombre_organismo: "Mejillón" }, { id_interno: `${id}-2`, nombre_organismo: "Ostión" }] }), QA)).data?.id;
  const et = await api("GET", `/samples/reception/${R}/etiquetas`, undefined, QA);
  const items = et.data?.items || [];
  check("etiquetas: una por muestra del lote con folio R e ID interno", et.status === 200 && items.length === 2 && items.every((e) => /^R \d{7}$/.test(e.folio)) && items[0].id_interno === `${id}-1`, `${et.status} ${JSON.stringify(items.map((e) => [e.folio, e.id_interno, e.organismo]))}`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
