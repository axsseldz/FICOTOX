/*
 * Fase 11 · no conformidades, acciones correctivas, suspensiones y retenciones
 * (contra el servidor de prueba, base de instance/test):
 * - flujo completo 1-10 (Luis reporta -> Ricardo escala -> Ana abre y retiene ->
 *   Ricardo suspende, analiza y crea acciones -> Luis implementa con evidencia ->
 *   Ana verifica no eficaz y luego eficaz -> Patricia reanuda y libera -> Ana
 *   comunica al cliente -> Patricia cierra -> PDF);
 * - una prueba positiva y una negativa por renglon de la tabla de permisos y por
 *   regla de segregacion 8, 9 y 10 (con la excepcion de segregacion);
 * - casos limite: doble cierre, cierre con pendientes, NC sin accion correctiva,
 *   reapertura, suspension por dos NC, informe ya enviado, bloqueos por metodo y
 *   equipo suspendidos, anular con bloqueos, editar cerrada, acciones vencidas.
 */
import "./lib/reauth-auto.mjs";
import fs from "node:fs";
import path from "node:path";
import { registrarEnvio } from "./lib/envio.mjs";
import { analisisDe, api, BASE, cadena, crearCheck, enDias, fila, filas, informeLiberado, sesiones } from "./lib/calidad.mjs";

const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const apoyo = JSON.parse(fs.readFileSync(process.env.DATOS_APOYO_FILE, "utf8"));
const SIN_REAUTH = { "X-Sin-Reauth-Auto": "1" };
const SIN_APROBAR = { "X-Sin-Aprobar-Auto": "1" };
const ncDe = async (nc, token = t.ana) => (await api("GET", `/calidad/nc/${nc}`, undefined, token)).data?.item;
const archivo = (nombre, texto) => {
  const form = new FormData();
  form.append("archivo", new Blob([Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(`${texto} ${Date.now()}`)])]), nombre);
  form.append("tipo_evidencia", "otro");
  form.append("descripcion", texto);
  return form;
};
const informeInicial = await informeLiberado(t, "NCINF");
const informeEnviado = await informeLiberado(t, "NCENV", { enviar: true });
check("preparación: un informe liberado y otro enviado", informeInicial.liberado && informeEnviado.enviado, `${informeInicial.liberado} ${informeEnviado.enviado}`);

/* ================= Flujo completo ================= */
// 1. Luis reporta con foto.
const cad = await cadena(t, "NCFLUJO", { asignar: [id.luis] });
const inc = await api("POST", "/calidad/incidencias", { tipo: "falla_equipo", fecha_hora_ocurrencia: new Date().toISOString(), descripcion: "La centrífuga se detuvo a mitad del ciclo de extracción DSP", impacto_resultados: "si", accion_inmediata: "Se detuvo la corrida", registros: [{ entidad: "muestras_extraccion", entidad_id: cad.E }, { entidad: "equipos", entidad_id: apoyo.equipo_id }] }, t.luis);
const foto = new FormData();
foto.append("archivo", new Blob([Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`foto ${Date.now()}`)])]), "centrifuga.jpg");
foto.append("tipo_evidencia", "foto");
foto.append("descripcion", "Panel con el error E-04");
const fotoR = await api("POST", `/calidad/incidencias/${inc.data?.id}/adjuntos`, foto, t.luis);
check("1. Luis reporta la incidencia con foto", inc.status === 201 && fotoR.status === 201, `${inc.status} ${fotoR.status} ${fotoR.data?.message}`);

// 2. Ricardo evalua y escala.
await api("POST", `/calidad/incidencias/${inc.data?.id}/evaluacion`, {}, t.ricardo);
const esc = await api("POST", `/calidad/incidencias/${inc.data?.id}/evaluar`, { decision: "escalar", justificacion: "Puede haber afectado resultados de la semana", nc: { clasificacion: "mayor", requisito_incumplido: "ISO/IEC 17025 6.4.13 y FX-MC-6.4" } }, t.ricardo);
const NC = esc.data?.nc_id;
check("2. Ricardo evalúa y escala: NC con folio 'NC 000000N' y origen incidencia", esc.status === 200 && /^NC \d{7}$/.test((await ncDe(NC))?.folio || "") && (await ncDe(NC))?.origen === "incidencia", `${esc.status} ${esc.data?.message}`);

// 3. Ana nombra responsable a Ricardo, marca resultados afectados y retiene un informe.
{
  const ricardoNombra = await api("PUT", `/calidad/nc/${NC}`, { responsable_id: id.ricardo }, t.ricardo);
  check("solo calidad:G nombra al responsable (Ricardo -> 403)", ricardoNombra.status === 403, `${ricardoNombra.status}`);
  const nombra = await api("PUT", `/calidad/nc/${NC}`, { responsable_id: id.ricardo, afecta_resultados_emitidos: "si", trabajo_detenido: "si", notificar_cliente: "si", impacto_notas: "Un informe emitido usó extracciones de la corrida" }, t.ana);
  const afect = await api("POST", `/calidad/nc/${NC}/afectados`, { informe_id: informeInicial.informe }, t.ana);
  const gabRet = await api("POST", `/calidad/nc/${NC}/retenciones`, { informe_id: informeInicial.informe, motivo: "Resultados en duda" }, t.gabriela);
  const ret = await api("POST", `/calidad/nc/${NC}/retenciones`, { informe_id: informeInicial.informe, motivo: "Resultados en duda por la falla" }, t.ana);
  const otraVez = await api("POST", `/calidad/nc/${NC}/retenciones`, { informe_id: informeInicial.informe, motivo: "Otra vez" }, t.ana);
  check("3. Ana nombra a Ricardo, evalúa el impacto, marca el informe afectado y lo retiene (sin calidad:R -> 403; dos veces -> 409)", nombra.status === 200 && afect.status === 200 && ret.status === 201 && gabRet.status === 403 && otraVez.status === 409, `${nombra.status} ${afect.status} ${ret.status} ${gabRet.status} ${otraVez.status}`);
  const envio = await registrarEnvio(BASE, t.patricia, informeInicial.informe);
  check("un informe retenido no se envía (409 informe_retenido)", envio.status === 409 && envio.data?.codigo === "informe_retenido", `${envio.status} ${envio.data?.codigo}`);
  const infItem = (await api("GET", `/informes/${informeInicial.informe}`, undefined, t.patricia)).data?.item;
  check("la ficha del informe muestra la retención activa", infItem?.retenciones?.some((r) => !r.liberada_en), JSON.stringify(infItem?.retenciones || null).slice(0, 80));
  const retEnv = await api("POST", `/calidad/nc/${NC}/retenciones`, { informe_id: informeEnviado.informe, motivo: "También salió con esa corrida" }, t.ana);
  const reenvio = await registrarEnvio(BASE, t.patricia, informeEnviado.informe);
  check("retener un informe ya enviado: queda marcado y no se reenvía", retEnv.status === 201 && /ya enviado/.test(retEnv.data?.message || "") && reenvio.status === 409, `${retEnv.status} ${reenvio.status}`);
}

// 4. Ricardo suspende el equipo, registra la causa y crea 2 acciones (Luis y Ricardo).
let accLuis, accRicardo, suspEquipo;
{
  const gabSusp = await api("POST", `/calidad/nc/${NC}/suspensiones`, { tipo: "equipo", clave: String(apoyo.equipo_id), motivo: "Falla del rotor" }, t.gabriela);
  const susp = await api("POST", `/calidad/nc/${NC}/suspensiones`, { tipo: "equipo", clave: String(apoyo.equipo_id), motivo: "Falla del rotor en plena corrida" }, t.ricardo);
  const dos = await api("POST", `/calidad/nc/${NC}/suspensiones`, { tipo: "equipo", clave: String(apoyo.equipo_id), motivo: "Otra vez" }, t.ricardo);
  suspEquipo = fila("SELECT id FROM suspensiones WHERE nc_id = ? AND reanudada_en IS NULL", NC)?.id;
  check("4. Ricardo suspende el equipo (Gabriela sin calidad:R -> 403; la misma NC otra vez -> 409); el equipo queda fuera de servicio", susp.status === 201 && gabSusp.status === 403 && dos.status === 409 && fila("SELECT estado FROM equipos WHERE id = ?", apoyo.equipo_id)?.estado === "fuera_servicio", `${susp.status} ${gabSusp.status} ${dos.status}`);
  const eq = await api("POST", "/samples/extraction", { ...(await (async () => ({}))()), tipo_registro: "E-D", procesamiento_id: cad.P, tipo_molienda: "fresca", id_interno: cad.idInt, fecha_extraccion: "2026-09-21", registro_pesos: [{ id_muestra: cad.idInt, replica: `${cad.idInt}_R2`, peso_muestra: 2 }], equipos: [{ equipo_id: apoyo.equipo_id, uso: "Centrifugación", folio_bitacora: `S-${Date.now()}` }], nombre_quien_extrajo: "Persona A", nombre_quien_superviso: "Persona B" }, t.qa);
  check("con el equipo suspendido no se registra una extracción que lo use (409 con la NC en el mensaje)", eq.status === 409 && /NC \d{7}/.test(eq.data?.message || ""), `${eq.status} ${eq.data?.message}`);
  const reactivar = await api("PUT", `/inventory/equipos/${apoyo.equipo_id}`, { ...(await api("GET", `/inventory/equipos/${apoyo.equipo_id}`, undefined, t.qa)).data?.item, estado: "operativo" }, t.qa);
  check("un equipo suspendido no se pone operativo desde el inventario (409)", reactivar.status === 409, `${reactivar.status} ${reactivar.data?.message}`);
  const avanzarSinCausa = await api("POST", `/calidad/nc/${NC}/avanzar`, { a: "en_analisis" }, t.ricardo);
  const causa = await api("PUT", `/calidad/nc/${NC}`, { metodo_causa: "cinco_porques", desarrollo_causa: "¿Por qué se detuvo? Sobrecalentamiento. ¿Por qué? Filtro obstruido.", causa_raiz: "Falta de mantenimiento preventivo del filtro de aire", requiere_accion_correctiva: "si", requiere_actualizar_riesgos: true, nota_riesgos: "Agregar el riesgo de paro de equipo" }, t.ricardo);
  const luisEdita = await api("PUT", `/calidad/nc/${NC}`, { impacto_notas: "Luis intenta editar" }, t.luis);
  const hectorEdita = await api("PUT", `/calidad/nc/${NC}`, { impacto_notas: "Auditor intenta editar" }, t.hector);
  check("el responsable (Ricardo, calidad:C) edita la causa; el Auditor (V) no (403); Luis, sin nada en la NC, ni la ve (404)", avanzarSinCausa.status === 200 && causa.status === 200 && luisEdita.status === 404 && hectorEdita.status === 403, `${avanzarSinCausa.status} ${causa.status} ${luisEdita.status} ${hectorEdita.status}`);
  const aL = await api("POST", `/calidad/nc/${NC}/acciones`, { descripcion: "Cambiar el filtro de aire de la centrífuga", responsable_id: id.luis, fecha_compromiso: enDias(5) }, t.ricardo);
  const aR = await api("POST", `/calidad/nc/${NC}/acciones`, { descripcion: "Incluir el filtro en el programa de mantenimiento", responsable_id: id.ricardo, fecha_compromiso: enDias(10) }, t.ricardo);
  const sinResp = await api("POST", `/calidad/nc/${NC}/acciones`, { descripcion: "Acción sin responsable válido", responsable_id: 999999, fecha_compromiso: enDias(3) }, t.ricardo);
  accLuis = aL.data?.id;
  accRicardo = aR.data?.id;
  const avanza = await api("POST", `/calidad/nc/${NC}/avanzar`, { a: "acciones_en_curso" }, t.ricardo);
  const atras = await api("POST", `/calidad/nc/${NC}/avanzar`, { a: "en_analisis" }, t.ricardo);
  check("Ricardo crea 2 acciones (Luis y Ricardo) y pasa a acciones en curso; un responsable inexistente -> 400; retroceder -> 409", aL.status === 201 && aR.status === 201 && sinResp.status === 400 && avanza.status === 200 && atras.status === 409, `${aL.status} ${aR.status} ${sinResp.status} ${avanza.status} ${atras.status}`);
  const verPronto = await api("POST", `/calidad/nc/${NC}/avanzar`, { a: "en_verificacion" }, t.ricardo);
  check("no se pasa a verificación con acciones pendientes (409)", verPronto.status === 409, `${verPronto.status}`);
  const cierrePendientes = await api("POST", `/calidad/nc/${NC}/cerrar`, { conclusion: "Cierre con acciones pendientes" }, t.patricia);
  check("cerrar con acciones pendientes -> 409 acciones_pendientes", cierrePendientes.status === 409 && cierrePendientes.data?.codigo === "acciones_pendientes", `${cierrePendientes.status} ${cierrePendientes.data?.codigo}`);
}

// Alcance de Luis: ve la NC donde tiene una accion; Mariana no ve ninguna.
{
  const lista = (await api("GET", "/calidad/nc", undefined, t.luis)).data;
  check("Luis (alcance incidencias) ve la NC porque es responsable de una acción", lista?.alcance === "incidencias" && lista.items.some((n) => n.id === NC), `${lista?.items?.length}`);
  const luisEdita = await api("PUT", `/calidad/nc/${NC}`, { impacto_notas: "Luis intenta editar" }, t.luis);
  check("Luis ve la NC pero no la edita: no es su responsable (403)", luisEdita.status === 403, `${luisEdita.status}`);
  const mariana = await api("GET", `/calidad/nc/${NC}`, undefined, t.mariana);
  const marianaLista = (await api("GET", "/calidad/nc", undefined, t.mariana)).data?.items || [];
  check("Mariana no ve la NC (404) ni la tiene en su lista", mariana.status === 404 && !marianaLista.some((n) => n.id === NC), `${mariana.status}`);
  const avisos = (await api("GET", "/notificaciones", undefined, t.luis)).data?.items || [];
  check("la campana de Luis avisa de su acción correctiva", avisos.some((a) => a.href === `/calidad/nc/${NC}`), JSON.stringify(avisos.map((a) => a.tipo || a.titulo)).slice(0, 160));
}

// 5. Luis implementa con evidencia; no marca la de Ricardo.
{
  const ajena = await api("POST", `/calidad/acciones/${accRicardo}/implementar`, { descripcion_implementacion: "Luis intenta marcar la de Ricardo" }, t.luis);
  check("implementar una acción ajena -> 403", ajena.status === 403, `${ajena.status}`);
  const ev = await api("POST", `/calidad/acciones/${accLuis}/adjuntos`, archivo("filtro.pdf", "Factura y foto del filtro nuevo"), t.luis);
  const evAjena = await api("POST", `/calidad/acciones/${accRicardo}/adjuntos`, archivo("x.pdf", "Evidencia en acción ajena"), t.luis);
  const ini = await api("POST", `/calidad/acciones/${accLuis}/iniciar`, {}, t.luis);
  const imp = await api("POST", `/calidad/acciones/${accLuis}/implementar`, { descripcion_implementacion: "Se cambió el filtro y se probó 3 ciclos" }, t.luis);
  const impR = await api("POST", `/calidad/acciones/${accRicardo}/implementar`, { descripcion_implementacion: "Se agregó al programa FX-MC-6.4.13" }, t.ricardo);
  const dosVeces = await api("POST", `/calidad/acciones/${accLuis}/implementar`, { descripcion_implementacion: "Otra vez" }, t.luis);
  check("5. Luis sube evidencia (ajena -> 403), inicia e implementa su acción; Ricardo la suya; implementar dos veces -> 409", ev.status === 201 && evAjena.status === 403 && ini.status === 200 && imp.status === 200 && impR.status === 200 && dosVeces.status === 409, `${ev.status} ${evAjena.status} ${ini.status} ${imp.status} ${impR.status} ${dosVeces.status}`);
  const aVer = await api("POST", `/calidad/nc/${NC}/avanzar`, { a: "en_verificacion" }, t.ricardo);
  check("con todo implementado pasa a verificación", aVer.status === 200, `${aVer.status} ${aVer.data?.message}`);
  const vaciar = await api("PUT", `/calidad/nc/${NC}`, { causa_raiz: "" }, t.ricardo);
  check("en verificación no se vacía la causa raíz que permitió avanzar (409)", vaciar.status === 409 && vaciar.data?.codigo === "dato_de_etapa", `${vaciar.status} ${vaciar.data?.codigo}`);
  const sinVerif = await api("POST", `/calidad/nc/${NC}/cerrar`, { conclusion: "Cierre sin verificar la eficacia" }, t.patricia);
  check("cerrar sin verificación de eficacia -> 409 sin_verificacion", sinVerif.status === 409 && sinVerif.data?.codigo === "sin_verificacion", `${sinVerif.status} ${sinVerif.data?.codigo}`);
}

// 6. Verificacion: regla 8; Ana no eficaz -> reapertura; luego eficaz.
{
  const luisVer = await api("POST", `/calidad/nc/${NC}/verificar`, { resultado: "eficaz", comentarios: "Luis no verifica eficacia" }, t.luis);
  const ricVer = await api("POST", `/calidad/nc/${NC}/verificar`, { resultado: "eficaz", comentarios: "Ricardo verifica sus propias acciones" }, t.ricardo);
  check("verificar requiere calidad:R (Luis -> 403) y regla 8: el responsable de una acción no verifica (409)", luisVer.status === 403 && ricVer.status === 409 && ricVer.data?.regla === 8, `${luisVer.status} ${ricVer.status} ${ricVer.data?.regla}`);
  const noEf = await api("POST", `/calidad/nc/${NC}/verificar`, { resultado: "no_eficaz", comentarios: "La centrífuga volvió a detenerse a los 3 días" }, t.ana);
  const tras = fila("SELECT estado, reaperturas FROM no_conformidades WHERE id = ?", NC);
  check("6a. Ana verifica 'no eficaz': la NC regresa a análisis y cuenta una reapertura", noEf.status === 200 && tras.estado === "en_analisis" && Number(tras.reaperturas) === 1, `${noEf.status} ${tras.estado} ${tras.reaperturas}`);
  const cerrarReabierta = await api("POST", `/calidad/nc/${NC}/cerrar`, { conclusion: "Cierre sin verificar de nuevo" }, t.patricia);
  check("tras 'no eficaz' no se cierra (409)", cerrarReabierta.status === 409, `${cerrarReabierta.status}`);
  const sinNueva = await api("POST", `/calidad/nc/${NC}/avanzar`, { a: "acciones_en_curso" }, t.ricardo);
  check("tras la reapertura no se vuelve a acciones sin una acción nueva (409)", sinNueva.status === 409 && sinNueva.data?.codigo === "reapertura_sin_accion", `${sinNueva.status} ${sinNueva.data?.codigo}`);
  const nueva = await api("POST", `/calidad/nc/${NC}/acciones`, { descripcion: "Revisar el balanceo del rotor con el proveedor", responsable_id: id.luis, fecha_compromiso: enDias(7) }, t.ricardo);
  await api("POST", `/calidad/nc/${NC}/avanzar`, { a: "acciones_en_curso" }, t.ricardo);
  const impN = await api("POST", `/calidad/acciones/${nueva.data?.id}/implementar`, { descripcion_implementacion: "El proveedor balanceó el rotor" }, t.luis);
  await api("POST", `/calidad/nc/${NC}/avanzar`, { a: "en_verificacion" }, t.ricardo);
  const ef = await api("POST", `/calidad/nc/${NC}/verificar`, { resultado: "eficaz", comentarios: "Dos semanas sin paros; bitácora revisada" }, t.ana);
  check("6b. nueva acción, implementada, y Ana verifica 'eficaz'", nueva.status === 201 && impN.status === 200 && ef.status === 200, `${nueva.status} ${impN.status} ${ef.status}`);
}

// 7-9. Cierre con bloqueos -> reanudar y liberar -> comunicar -> cerrar.
{
  const conBloqueos = await api("POST", `/calidad/nc/${NC}/cerrar`, { conclusion: "Acciones eficaces" }, t.patricia);
  check("cerrar con suspensiones activas -> 409 suspensiones_activas", conBloqueos.status === 409 && conBloqueos.data?.codigo === "suspensiones_activas", `${conBloqueos.status} ${conBloqueos.data?.codigo}`);
  const ricReanuda = await api("POST", `/calidad/suspensiones/${suspEquipo}/reanudar`, { motivo: "Equipo reparado" }, t.ricardo);
  const sinReauth = await api("POST", `/calidad/suspensiones/${suspEquipo}/reanudar`, { motivo: "Equipo reparado" }, t.patricia, SIN_REAUTH);
  const reanuda = await api("POST", `/calidad/suspensiones/${suspEquipo}/reanudar`, { motivo: "Equipo reparado y probado" }, t.patricia);
  check("7a. reanudar requiere calidad:A (Ricardo -> 403) y reautenticación (401); Patricia reanuda y el equipo vuelve a su estado previo", ricReanuda.status === 403 && sinReauth.status === 401 && reanuda.status === 200 && fila("SELECT estado FROM equipos WHERE id = ?", apoyo.equipo_id)?.estado === "operativo", `${ricReanuda.status} ${sinReauth.status} ${reanuda.status}`);
  const rets = filas("SELECT id FROM retenciones_informe WHERE nc_id = ? AND liberada_en IS NULL", NC);
  const ricLibera = await api("POST", `/calidad/retenciones/${rets[0]?.id}/liberar`, { motivo: "Resultados confirmados" }, t.ricardo);
  const libSinReauth = await api("POST", `/calidad/retenciones/${rets[0]?.id}/liberar`, { motivo: "Resultados confirmados" }, t.patricia, SIN_REAUTH);
  const libs = [];
  for (const r of rets) libs.push((await api("POST", `/calidad/retenciones/${r.id}/liberar`, { motivo: "Resultados confirmados con la reextracción" }, t.patricia)).status);
  check("7b. liberar la retención requiere calidad:A (403) y reautenticación (401); Patricia libera", rets.length === 2 && ricLibera.status === 403 && libSinReauth.status === 401 && libs.every((x) => x === 200), `${rets.length} ${ricLibera.status} ${libSinReauth.status} ${libs}`);
  const envio = await registrarEnvio(BASE, t.patricia, informeInicial.informe);
  check("liberada la retención, el informe se envía", envio.status === 200, `${envio.status} ${envio.data?.message}`);
  const sinCom = await api("POST", `/calidad/nc/${NC}/cerrar`, { conclusion: "Acciones eficaces" }, t.patricia);
  check("se decidió notificar al cliente: sin comunicación registrada no se cierra (409)", sinCom.status === 409 && sinCom.data?.codigo === "falta_comunicacion", `${sinCom.status} ${sinCom.data?.codigo}`);
  const com = await api("POST", `/calidad/nc/${NC}/comunicaciones`, { fecha: enDias(0), medio: "correo", contacto: "Cliente NCINF", resumen: "Se informó la falla y que los resultados se confirmaron", informe_ids: [informeInicial.informe] }, t.ana);
  check("8. Ana registra la comunicación con el cliente", com.status === 201, `${com.status} ${com.data?.message}`);
  const ricCierra = await api("POST", `/calidad/nc/${NC}/cerrar`, { conclusion: "Acciones eficaces" }, t.ricardo);
  const cierraSinReauth = await api("POST", `/calidad/nc/${NC}/cerrar`, { conclusion: "Acciones eficaces" }, t.patricia, SIN_REAUTH);
  const cierra = await api("POST", `/calidad/nc/${NC}/cerrar`, { conclusion: "Las acciones fueron eficaces; se actualizó el programa de mantenimiento" }, t.patricia);
  const otra = await api("POST", `/calidad/nc/${NC}/cerrar`, { conclusion: "Segundo cierre de la NC" }, t.patricia);
  check("9. cerrar requiere calidad:A (Ricardo -> 403) y reautenticación (401); Patricia cierra; un segundo cierre -> 409", ricCierra.status === 403 && cierraSinReauth.status === 401 && cierra.status === 200 && otra.status === 409, `${ricCierra.status} ${cierraSinReauth.status} ${cierra.status} ${cierra.data?.message} ${otra.status}`);
  const editarCerrada = await api("PUT", `/calidad/nc/${NC}`, { impacto_notas: "Cambio posterior al cierre" }, t.ana);
  const accionCerrada = await api("POST", `/calidad/nc/${NC}/acciones`, { descripcion: "Acción tras el cierre", responsable_id: id.luis, fecha_compromiso: enDias(3) }, t.ana);
  check("una NC cerrada ya no se edita ni recibe acciones (409)", editarCerrada.status === 409 && accionCerrada.status === 409, `${editarCerrada.status} ${accionCerrada.status}`);
}

// 10. PDF final con huella.
{
  const pdf = await api("GET", `/calidad/nc/${NC}/pdf`, undefined, t.hector);
  const nc = fila("SELECT archivo_pdf, pdf_sha256 FROM no_conformidades WHERE id = ?", NC);
  const texto = Buffer.isBuffer(pdf.data) ? pdf.data.toString("latin1") : "";
  check("10. PDF 'Registro de no conformidad': final, íntegro y con su huella", pdf.status === 200 && texto.startsWith("%PDF") && pdf.headers.get("x-integridad-pdf") === "ok" && pdf.headers.get("x-pdf-sha256") === nc.pdf_sha256, `${pdf.status} ${pdf.headers.get("x-integridad-pdf")}`);
  const ruta = path.join(path.dirname(process.env.TEST_DB_PATH), "calidad", "nc", nc.archivo_pdf);
  const original = fs.readFileSync(ruta);
  fs.appendFileSync(ruta, "x");
  const alterado = await api("GET", `/calidad/nc/${NC}/pdf`, undefined, t.ana);
  fs.writeFileSync(ruta, original);
  const alerta = fila("SELECT id FROM auditoria WHERE entidad = 'no_conformidades' AND entidad_id = ? AND accion = 'alerta_integridad'", String(NC));
  const incAlerta = fila("SELECT id, reportada_nombre FROM incidencias WHERE clave_automatica = ?", `alerta_integridad:nc:${NC}:${nc.pdf_sha256}`);
  check("si el PDF final se altera, la descarga lo marca como alterado, con alerta en la bitácora e incidencia del sistema", alterado.headers.get("x-integridad-pdf") === "alterado" && !!alerta && incAlerta?.reportada_nombre === "Sistema", `${alterado.headers.get("x-integridad-pdf")} ${!!alerta} ${incAlerta?.reportada_nombre}`);
  const pdfLuis = await api("GET", `/calidad/nc/${NC}/pdf`, undefined, t.luis);
  check("sin calidad:V total (Luis, responsable de una acción) se entrega el PDF a pedido con su vista, no el archivo final", pdfLuis.status === 200 && pdfLuis.headers.get("x-integridad-pdf") === "a_pedido", `${pdfLuis.status} ${pdfLuis.headers.get("x-integridad-pdf")}`);
  const pdfMariana = await api("GET", `/calidad/nc/${NC}/pdf`, undefined, t.mariana);
  check("quien no ve la NC no descarga su PDF (404)", pdfMariana.status === 404, `${pdfMariana.status}`);
  const hist = (await api("GET", `/audit?entidad=no_conformidades&entidad_id=${NC}`, undefined, t.ana)).data?.items || [];
  const acciones = new Set(hist.map((e) => e.accion));
  check("la bitácora de la NC registra cada paso", ["crear", "editar", "retener", "suspender", "avanzar", "implementar", "verificar", "reabrir", "reanudar", "liberar_retencion", "comunicar", "cerrar", "descargar"].every((a) => acciones.has(a)), [...acciones].join(","));
}

/* ================= Permisos: crear NC, anular ================= */
{
  const luis = await api("POST", "/calidad/nc", { origen: "auditoria_interna", descripcion: "Hallazgo de auditoría interna sobre registros" }, t.luis);
  const gab = await api("POST", "/calidad/nc", { origen: "auditoria_interna", descripcion: "Hallazgo de auditoría interna sobre registros" }, t.gabriela);
  const ric = await api("POST", "/calidad/nc", { origen: "queja", descripcion: "Queja del cliente por el tiempo de entrega del informe", clasificacion: "menor" }, t.ricardo);
  const inc = await api("POST", "/calidad/nc", { origen: "incidencia", descripcion: "NC de incidencia creada directamente" }, t.ana);
  const ricResp = await api("POST", "/calidad/nc", { origen: "queja", descripcion: "Queja del cliente con responsable propuesto por R", responsable_id: id.luis }, t.ricardo);
  check("al crear, solo calidad:G nombra al responsable (Ricardo con responsable -> 403)", ricResp.status === 403, `${ricResp.status}`);
  check("crear NC: calidad:R (Ricardo 201); sin R ni G (Luis, Gabriela) -> 403; origen incidencia solo al escalar (400)", ric.status === 201 && luis.status === 403 && gab.status === 403 && inc.status === 400, `${ric.status} ${luis.status} ${gab.status} ${inc.status}`);
  const ricAnula = await api("POST", `/calidad/nc/${ric.data?.id}/anular`, { motivo: "Duplicada" }, t.ricardo);
  const pide = await api("POST", `/calidad/nc/${ric.data?.id}/anular`, { motivo: "Duplicada con otra queja" }, t.ana, SIN_APROBAR);
  const pendienteEdita = await api("PUT", `/calidad/nc/${ric.data?.id}`, { impacto_notas: "Cambio con anulación pendiente" }, t.ana);
  const aprueba = await api("POST", `/solicitudes/${pide.data?.solicitud?.id}/aprobar`, { motivo: "Procede" }, t.patricia);
  check("anular NC: sin calidad:AN -> 403; Ana pide (202), con la solicitud pendiente no se edita (409), Patricia aprueba", ricAnula.status === 403 && pide.status === 202 && pendienteEdita.status === 409 && aprueba.status === 200 && fila("SELECT estado FROM no_conformidades WHERE id = ?", ric.data?.id)?.estado === "anulada", `${ricAnula.status} ${pide.status} ${pendienteEdita.status} ${aprueba.status}`);
  const csv = await api("GET", "/calidad/nc?formato=csv", undefined, t.hector);
  check("exportar la lista de NC en CSV", csv.status === 200 && String(csv.data).includes("Folio"), `${csv.status}`);
  const jorge = await api("GET", "/calidad/nc", undefined, t.jorge);
  check("el Admin técnico no ve NC (403)", jorge.status === 403, `${jorge.status}`);
}

/* ================= NC sin accion correctiva, regla 9 ================= */
{
  const nc = await api("POST", "/calidad/nc", { origen: "revision", descripcion: "Registro de temperatura de un día sin firma del analista", clasificacion: "menor", responsable_id: id.ana }, t.ana);
  await api("PUT", `/calidad/nc/${nc.data?.id}`, { afecta_resultados_emitidos: "no", trabajo_detenido: "no", notificar_cliente: "no", requiere_accion_correctiva: "no" }, t.ana);
  const sinJust = await api("POST", `/calidad/nc/${nc.data?.id}/cerrar`, { conclusion: "No requiere acciones correctivas" }, t.patricia);
  await api("PUT", `/calidad/nc/${nc.data?.id}`, { justificacion_sin_accion: "Error aislado de firma; el registro se completó y no puede repetirse" }, t.ana);
  const avanzar = await api("POST", `/calidad/nc/${nc.data?.id}/avanzar`, { a: "en_analisis" }, t.ana);
  const acciones = await api("POST", `/calidad/nc/${nc.data?.id}/avanzar`, { a: "acciones_en_curso" }, t.ana);
  check("NC sin acción correctiva: exige justificación para cerrar (409) y no pasa a acciones (409)", sinJust.status === 409 && avanzar.status === 200 && acciones.status === 409, `${sinJust.status} ${avanzar.status} ${acciones.status}`);
  const anaCierra = await api("POST", `/calidad/nc/${nc.data?.id}/cerrar`, { conclusion: "No requiere acciones correctivas" }, t.ana);
  check("regla 9: quien es responsable de la NC no la cierra (409)", anaCierra.status === 409 && anaCierra.data?.regla === 9, `${anaCierra.status} ${anaCierra.data?.regla}`);
  const reasigna = await api("PUT", `/calidad/nc/${nc.data?.id}`, { responsable_id: id.ricardo, motivo: "Ricardo la conduce desde ahora" }, t.ana);
  const trasReasignar = await api("POST", `/calidad/nc/${nc.data?.id}/cerrar`, { conclusion: "No requiere acciones correctivas" }, t.ana);
  check("regla 9 no se elude reasignando: quien fue responsable tampoco la cierra (409)", reasigna.status === 200 && trasReasignar.status === 409 && trasReasignar.data?.regla === 9, `${reasigna.status} ${trasReasignar.status} ${trasReasignar.data?.regla}`);
  const [c1, c2] = await Promise.all([1, 2].map(() => api("POST", `/calidad/nc/${nc.data?.id}/cerrar`, { conclusion: "No requiere acciones correctivas; error aislado" }, t.patricia)));
  check("otra persona con calidad:A la cierra tras la evaluación de impacto; dos cierres simultáneos: uno 200 y otro 409", [c1.status, c2.status].sort().join() === "200,409" && fila("SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'no_conformidades' AND entidad_id = ? AND accion = 'cerrar'", String(nc.data?.id))?.n === 1, `${c1.status} ${c2.status}`);
}

/* ================= Suspension de metodo: bloqueos, regla 10 y excepcion ================= */
{
  const nc = await api("POST", "/calidad/nc", { origen: "otro", descripcion: "Material de referencia DSP fuera de especificación", clasificacion: "critica", responsable_id: id.ricardo }, t.ana);
  const susp = await api("POST", `/calidad/nc/${nc.data?.id}/suspensiones`, { tipo: "metodo", clave: "DSP", motivo: "Material de referencia fuera de especificación" }, t.ana);
  const su = fila("SELECT id FROM suspensiones WHERE nc_id = ? AND tipo = 'metodo'", nc.data?.id)?.id;
  const c = await cadena(t, "SUSPDSP");
  const ext = c.extraccion;
  check("con el método DSP suspendido no se registra una extracción E-D (409 'Método DSP suspendido por NC ...')", susp.status === 201 && ext.status === 409 && /Método DSP suspendido por NC \d{7}/.test(ext.data?.message || ""), `${susp.status} ${ext.status} ${ext.data?.message}`);
  const cA = await cadena(t, "SUSPASP", { tipo: "E-A" });
  check("un método no suspendido (ASP) sigue disponible", cA.extraccion.status === 201, `${cA.extraccion.status} ${cA.extraccion.data?.message}`);
  const prev = await cadena(t, "PREVDSP").catch(() => null);
  const analisisDSP = await api("POST", "/samples/analysis", analisisDe({ E: fila("SELECT id FROM muestras_extraccion WHERE tipo_registro = 'E-D' AND estado <> 'anulada' ORDER BY id DESC LIMIT 1").id, idInt: "X" }), t.qa);
  check("tampoco se registra un análisis de toxinas lipofílicas (DSP)", analisisDSP.status === 409 && analisisDSP.data?.codigo === "suspendido", `${analisisDSP.status} ${analisisDSP.data?.codigo} ${prev?.extraccion?.status}`);
  const activas = (await api("GET", "/calidad/suspensiones/activas", undefined, t.luis)).data?.items || [];
  check("las suspensiones activas las consulta quien captura ensayos o usa equipos (avisos de los formatos)", activas.some((a) => a.tipo === "metodo" && a.clave === "DSP"), `${activas.length}`);
  const anular = await api("POST", `/calidad/nc/${nc.data?.id}/anular`, { motivo: "Se registró en otra NC" }, t.ana, SIN_APROBAR);
  check("anular una NC con suspensiones activas -> 409", anular.status === 409 && anular.data?.codigo === "bloqueos_activos", `${anular.status} ${anular.data?.codigo}`);
  const propia = await api("POST", `/calidad/suspensiones/${su}/reanudar`, { motivo: "Material nuevo recibido" }, t.ana);
  check("regla 10: quien suspendió no reanuda (409)", propia.status === 409 && propia.data?.regla === 10, `${propia.status} ${propia.data?.regla}`);
  const exc = await api("POST", "/solicitudes", { tipo: "excepcion_segregacion", entidad: "suspensiones", entidad_id: su, accion: "reanudar", motivo: "Patricia está de vacaciones esta semana" }, t.ana);
  const conExc = await api("POST", `/calidad/suspensiones/${su}/reanudar`, { motivo: "Material de referencia nuevo verificado" }, t.ana);
  const bit = fila("SELECT cambios_json FROM auditoria WHERE entidad = 'no_conformidades' AND entidad_id = ? AND accion = 'reanudar' ORDER BY id DESC LIMIT 1", String(nc.data?.id));
  check("con la excepción de segregación aprobada (otra persona) sí reanuda y queda en la bitácora", exc.status === 200 && conExc.status === 200 && !!JSON.parse(bit?.cambios_json || "{}")?._detalle?.excepcion_segregacion, `${exc.status} ${exc.data?.message} ${conExc.status} ${conExc.data?.message}`);
  const c2 = await cadena(t, "REANDSP");
  check("reanudado el método, la extracción DSP vuelve a registrarse", c2.extraccion.status === 201, `${c2.extraccion.status}`);
}

/* ================= Dos NC suspenden el mismo equipo ================= */
{
  const n1 = await api("POST", "/calidad/nc", { origen: "otro", descripcion: "Vibración anormal de la centrífuga (NC uno)", responsable_id: id.ricardo }, t.ana);
  const n2 = await api("POST", "/calidad/nc", { origen: "otro", descripcion: "Temperatura inestable de la centrífuga (NC dos)", responsable_id: id.ricardo }, t.ana);
  await api("POST", `/calidad/nc/${n1.data?.id}/suspensiones`, { tipo: "equipo", clave: String(apoyo.equipo_id), motivo: "Vibración" }, t.ricardo);
  await api("POST", `/calidad/nc/${n2.data?.id}/suspensiones`, { tipo: "equipo", clave: String(apoyo.equipo_id), motivo: "Temperatura" }, t.ricardo);
  const s1 = fila("SELECT id FROM suspensiones WHERE nc_id = ?", n1.data?.id).id;
  const cTexto = await cadena(t, "EQTXT");
  const porNombre = await api("POST", "/samples/analysis", analisisDe(cTexto, { equipo_nombre: fila("SELECT nombre FROM equipos WHERE id = ?", apoyo.equipo_id).nombre }), t.qa);
  check("un equipo suspendido declarado solo por nombre (sin id) también se bloquea (409)", porNombre.status === 409 && porNombre.data?.codigo === "suspendido", `${porNombre.status} ${porNombre.data?.codigo}`);
  const extNombre = await api("POST", "/samples/extraction", { tipo_registro: "E-D", procesamiento_id: cTexto.P, tipo_molienda: "fresca", id_interno: cTexto.idInt, fecha_extraccion: "2026-09-21", registro_pesos: [{ id_muestra: cTexto.idInt, replica: `${cTexto.idInt}_R2`, peso_muestra: 2 }], equipos: [{ nombre: fila("SELECT nombre FROM equipos WHERE id = ?", apoyo.equipo_id).nombre, uso: "Centrifugación" }], nombre_quien_extrajo: "Persona A", nombre_quien_superviso: "Persona B" }, t.qa);
  check("en la extracción, el equipo suspendido declarado solo por nombre también se bloquea (409)", extNombre.status === 409 && extNombre.data?.codigo === "suspendido", `${extNombre.status} ${extNombre.data?.codigo} ${extNombre.data?.message}`);
  const s2 = fila("SELECT id FROM suspensiones WHERE nc_id = ?", n2.data?.id).id;
  const r1 = await api("POST", `/calidad/suspensiones/${s1}/reanudar`, { motivo: "Vibración corregida" }, t.patricia);
  const sigue = fila("SELECT estado FROM equipos WHERE id = ?", apoyo.equipo_id).estado;
  const r2 = await api("POST", `/calidad/suspensiones/${s2}/reanudar`, { motivo: "Temperatura corregida" }, t.patricia);
  check("dos NC suspenden el mismo equipo: al reanudar una sigue suspendido; al reanudar la otra vuelve a operativo", r1.status === 200 && /sigue suspendido/.test(r1.data?.message || "") && sigue === "fuera_servicio" && r2.status === 200 && fila("SELECT estado FROM equipos WHERE id = ?", apoyo.equipo_id).estado === "operativo", `${r1.status} ${sigue} ${r2.status}`);
  const otraVez = await api("POST", `/calidad/suspensiones/${s2}/reanudar`, { motivo: "Otra vez" }, t.patricia);
  check("reanudar dos veces -> 409", otraVez.status === 409, `${otraVez.status}`);
}

/* ================= Acciones: vencidas, reasignacion, cancelacion; cambio documental (bandera) ================= */
{
  const nc = await api("POST", "/calidad/nc", { origen: "auditoria_interna", descripcion: "El procedimiento de limpieza no indica la frecuencia", responsable_id: id.ricardo }, t.ana);
  const N = nc.data?.id;
  await api("PUT", `/calidad/nc/${N}`, { afecta_resultados_emitidos: "no", trabajo_detenido: "no", notificar_cliente: "no" }, t.ricardo);
  await api("POST", `/calidad/nc/${N}/avanzar`, { a: "en_analisis" }, t.ricardo);
  const vencida = await api("POST", `/calidad/nc/${N}/acciones`, { descripcion: "Actualizar el procedimiento de limpieza", responsable_id: id.gabriela, fecha_compromiso: enDias(-2) }, t.ricardo);
  const lista = (await api("GET", "/calidad/acciones?vencidas=1", undefined, t.ana)).data?.items || [];
  const avisos = (await api("GET", "/notificaciones", undefined, t.gabriela)).data?.items || [];
  check("una acción con compromiso vencido aparece como vencida en la lista y en la campana del responsable", lista.some((a) => a.id === vencida.data?.id && a.vencida) && avisos.some((a) => a.href === `/calidad/nc/${N}`), `${lista.length} ${avisos.length}`);
  const sinMotivo = await api("PUT", `/calidad/acciones/${vencida.data?.id}`, { responsable_id: id.luis }, t.ricardo);
  const reasigna = await api("PUT", `/calidad/acciones/${vencida.data?.id}`, { responsable_id: id.luis, motivo: "Gabriela cambió de área" }, t.ricardo);
  check("reasignar una acción exige motivo (400) y queda con su motivo", sinMotivo.status === 400 && reasigna.status === 200 && fila("SELECT motivo_reasignacion, responsable_id FROM acciones_correctivas WHERE id = ?", vencida.data?.id)?.responsable_id === id.luis, `${sinMotivo.status} ${reasigna.status}`);
  const luisCancela = await api("POST", `/calidad/acciones/${vencida.data?.id}/cancelar`, { motivo: "No aplica" }, t.luis);
  const cancela = await api("POST", `/calidad/acciones/${vencida.data?.id}/cancelar`, { motivo: "Se sustituye por el cambio documental" }, t.ricardo);
  check("cancelar una acción: el responsable de la acción sin editar la NC no (403); el responsable de la NC sí", luisCancela.status === 403 && cancela.status === 200, `${luisCancela.status} ${cancela.status}`);
  // Biblioteca: ya no hay propuestas documentales (410); "requiere cambio documental" queda como bandera de la NC.
  const prop = await api("POST", `/calidad/nc/${N}/propuesta-documental`, { tipo: "nuevo", titulo: "Instructivo de limpieza del área de extracción", motivo: "Definir la frecuencia de limpieza" }, t.ricardo);
  const bandera = await api("PUT", `/calidad/nc/${N}`, { requiere_cambio_documental: true }, t.ricardo);
  const item = await ncDe(N);
  check("propuesta documental desde la NC retirada (410) y la bandera «requiere cambio documental» se guarda", prop.status === 410 && prop.data?.codigo === "retirado" && bandera.status === 200 && item?.requiere_cambio_documental === 1 && !item?.propuesta, `${prop.status} ${bandera.status} ${item?.requiere_cambio_documental}`);
  const pdfPedido = await api("GET", `/calidad/nc/${N}/pdf`, undefined, t.ricardo);
  check("el PDF a pedido de una NC abierta se genera sin guardarse", pdfPedido.status === 200 && pdfPedido.headers.get("x-integridad-pdf") === "a_pedido", `${pdfPedido.status}`);
}

/* ================= Rama "no requiere accion" con acciones (8.7.1) ================= */
{
  const nc = await api("POST", "/calidad/nc", { origen: "revision", descripcion: "Bitácora de temperatura del refrigerador incompleta en agosto", responsable_id: id.ricardo }, t.ana);
  const N = nc.data?.id;
  await api("PUT", `/calidad/nc/${N}`, { afecta_resultados_emitidos: "no", trabajo_detenido: "no", notificar_cliente: "no", requiere_accion_correctiva: "no", justificacion_sin_accion: "Registro aislado; el sensor guarda los datos" }, t.ricardo);
  await api("POST", `/calidad/nc/${N}/avanzar`, { a: "en_analisis" }, t.ricardo);
  const acc = await api("POST", `/calidad/nc/${N}/acciones`, { descripcion: "Revisar la bitácora cada semana", responsable_id: id.luis, fecha_compromiso: enDias(3) }, t.ricardo);
  const cierra = await api("POST", `/calidad/nc/${N}/cerrar`, { conclusion: "No requiere acciones correctivas" }, t.patricia);
  check("con una acción pendiente, la rama «no requiere acción» no cierra (409)", acc.status === 201 && cierra.status === 409, `${acc.status} ${cierra.status} ${cierra.data?.message}`);
  await api("PUT", `/calidad/nc/${N}`, { requiere_accion_correctiva: "si" }, t.ricardo);
  const volver = await api("PUT", `/calidad/nc/${N}`, { requiere_accion_correctiva: "no" }, t.ricardo);
  check("con acciones definidas no se regresa la decisión a «no requiere acción» (409)", volver.status === 409 && volver.data?.codigo === "decision_con_acciones", `${volver.status} ${volver.data?.codigo}`);
  // Con todas las acciones canceladas y ya en acciones: tampoco (la rama "sin accion" es de abierta o en analisis).
  await api("PUT", `/calidad/nc/${N}`, { metodo_causa: "cinco_porques", causa_raiz: "No hay revisión semanal de la bitácora" }, t.ricardo);
  const enCurso = await api("POST", `/calidad/nc/${N}/avanzar`, { a: "acciones_en_curso" }, t.ricardo);
  await api("POST", `/calidad/acciones/${acc.data?.id}/cancelar`, { motivo: "Se sustituye por otra medida" }, t.ricardo);
  const enAcciones = await api("PUT", `/calidad/nc/${N}`, { requiere_accion_correctiva: "no" }, t.ricardo);
  check("en acciones en curso ya no se cambia a «no requiere acción» aunque se cancelen todas (409)", enCurso.status === 200 && enAcciones.status === 409, `${enCurso.status} ${enCurso.data?.message} ${enAcciones.status}`);
  // El responsable con calidad:R/A (sin C) tambien edita su NC.
  const deP = await api("POST", "/calidad/nc", { origen: "otro", descripcion: "NC conducida por la Responsable General como responsable", responsable_id: id.patricia }, t.ana);
  const edP = await api("PUT", `/calidad/nc/${deP.data?.id}`, { impacto_notas: "La Responsable General evalúa el impacto" }, t.patricia);
  check("la Responsable General (V R A AN) edita la NC de la que es responsable", edP.status === 200, `${edP.status} ${edP.data?.message}`);
}

/* ================= Responsable sin cuenta vigente ================= */
{
  const email = `temporal.nc.${Date.now()}@cicese.mx`;
  const alta = await api("POST", "/admin/usuarios", { nombre: "Persona temporal NC", email, activo: true, rol_id: ((await api("GET", "/admin/roles", undefined, t.qa)).data?.items || []).find((r) => r.nombre === "Técnico Auxiliar")?.id, password: "PruebaNc2026!x", motivo: "Alta de prueba de calidad" }, t.qa);
  const uid = alta.data?.id;
  const nc = await api("POST", "/calidad/nc", { origen: "otro", descripcion: "Etiquetas de reactivos sin fecha de apertura en la campana", responsable_id: id.ricardo }, t.ana);
  const N = nc.data?.id;
  await api("PUT", `/calidad/nc/${N}`, { afecta_resultados_emitidos: "no", trabajo_detenido: "no", notificar_cliente: "no" }, t.ricardo);
  await api("POST", `/calidad/nc/${N}/avanzar`, { a: "en_analisis" }, t.ricardo);
  const acc = await api("POST", `/calidad/nc/${N}/acciones`, { descripcion: "Etiquetar todos los frascos abiertos", responsable_id: uid, fecha_compromiso: enDias(5) }, t.ricardo);
  const baja = await api("DELETE", `/admin/usuarios/${uid}`, { motivo: "Terminó su estancia" }, t.qa);
  const detalle = (await api("GET", `/calidad/nc/${N}`, undefined, t.ana)).data?.item;
  const avisos = (await api("GET", "/notificaciones", undefined, t.ana)).data?.items || [];
  const nueva = await api("POST", `/calidad/nc/${N}/acciones`, { descripcion: "Otra acción para la persona dada de baja", responsable_id: uid, fecha_compromiso: enDias(5) }, t.ricardo);
  check("responsable dado de baja: la acción lo marca, se avisa para reasignar y no se le asignan nuevas (400)", !!uid && acc.status === 201 && baja.status === 200 && detalle?.acciones?.some((a) => a.id === acc.data?.id && a.responsable_vigente === false) && avisos.some((a) => a.tipo === "responsable_no_vigente" && a.href === `/calidad/nc/${N}`) && nueva.status === 400, `${alta.status} ${alta.data?.message} ${acc.status} ${baja.status} ${nueva.status}`);
  const reasigna = await api("PUT", `/calidad/acciones/${acc.data?.id}`, { responsable_id: id.luis, motivo: "La persona responsable ya no está en el laboratorio" }, t.ricardo);
  check("se reasigna con motivo a una persona vigente", reasigna.status === 200, `${reasigna.status}`);
}

/* ================= Regla 8 tambien para quien implemento ================= */
{
  const nc = await api("POST", "/calidad/nc", { origen: "otro", descripcion: "Pipeta automática fuera de tolerancia en la verificación semanal", responsable_id: id.ricardo }, t.ana);
  const N = nc.data?.id;
  await api("PUT", `/calidad/nc/${N}`, { afecta_resultados_emitidos: "no", trabajo_detenido: "no", notificar_cliente: "no", metodo_causa: "otro", causa_raiz: "Falta de calibración programada de pipetas", requiere_accion_correctiva: "si" }, t.ricardo);
  await api("POST", `/calidad/nc/${N}/avanzar`, { a: "en_analisis" }, t.ricardo);
  const a = await api("POST", `/calidad/nc/${N}/acciones`, { descripcion: "Enviar la pipeta a calibrar", responsable_id: id.luis, fecha_compromiso: enDias(4) }, t.ricardo);
  await api("POST", `/calidad/nc/${N}/avanzar`, { a: "acciones_en_curso" }, t.ricardo);
  const impl = await api("POST", `/calidad/acciones/${a.data?.id}/implementar`, { descripcion_implementacion: "Calibrada por el proveedor acreditado" }, t.ana);
  await api("POST", `/calidad/nc/${N}/avanzar`, { a: "en_verificacion" }, t.ricardo);
  const anaVerifica = await api("POST", `/calidad/nc/${N}/verificar`, { resultado: "eficaz", comentarios: "Certificado de calibración revisado" }, t.ana);
  const patVerifica = await api("POST", `/calidad/nc/${N}/verificar`, { resultado: "eficaz", comentarios: "Certificado de calibración revisado" }, t.patricia);
  check("regla 8: quien marcó implementada una acción (calidad:G) no verifica su eficacia (409); otra persona sí", impl.status === 200 && anaVerifica.status === 409 && anaVerifica.data?.regla === 8 && patVerifica.status === 200, `${impl.status} ${anaVerifica.status} ${patVerifica.status}`);
}

/* ================= Solicitudes de registros de calidad ================= */
{
  const nc = await api("POST", "/calidad/nc", { origen: "otro", descripcion: "NC para probar el historial de solicitudes por registro", responsable_id: id.ricardo }, t.ana);
  await api("POST", `/calidad/nc/${nc.data?.id}/anular`, { motivo: "Prueba de solicitudes de calidad" }, t.ana, SIN_APROBAR);
  const jorge = await api("GET", `/solicitudes?entidad=no_conformidades&entidad_id=${nc.data?.id}`, undefined, t.jorge);
  const jorgeSusp = await api("GET", `/solicitudes?entidad=suspensiones&entidad_id=1`, undefined, t.jorge);
  const ana = await api("GET", `/solicitudes?entidad=no_conformidades&entidad_id=${nc.data?.id}`, undefined, t.ana);
  check("las solicitudes de una NC no las ve el Admin técnico (403) y sí quien ve la NC", [403, 404].includes(jorge.status) && [403, 404].includes(jorgeSusp.status) && ana.status === 200 && ana.data?.items?.length === 1, `${jorge.status} ${jorgeSusp.status} ${ana.status}`);
  const pend = ana.data?.items?.[0];
  await api("POST", `/solicitudes/${pend?.id}/rechazar`, { motivo: "Solo era una prueba" }, t.patricia);
}

/* ================= Responsables con acceso y afectados visibles ================= */
{
  const nc = await api("POST", "/calidad/nc", { origen: "otro", descripcion: "NC para validar a quién se nombra responsable", responsable_id: id.mariana }, t.ana);
  const N = nc.data?.id;
  const jorgeResp = await api("PUT", `/calidad/nc/${N}`, { responsable_id: id.jorge, motivo: "Prueba de responsable sin acceso" }, t.ana);
  check("no se nombra responsable a quien no tiene acceso a calidad (Admin técnico -> 400)", nc.status === 201 && jorgeResp.status === 400, `${nc.status} ${jorgeResp.status} ${jorgeResp.data?.message}`);
  const hectorResp = await api("PUT", `/calidad/nc/${N}`, { responsable_id: id.hector, motivo: "Prueba de responsable que solo consulta" }, t.ana);
  check("tampoco a quien solo consulta calidad (Auditor, V) -> 400", hectorResp.status === 400, `${hectorResp.status} ${hectorResp.data?.message}`);
  const afectadoMariana = await api("POST", `/calidad/nc/${N}/afectados`, { informe_id: informeInicial.informe }, t.mariana);
  check("quien no ve informes no marca un informe como afectado (404, sin revelar el folio)", afectadoMariana.status === 404 && !JSON.stringify(afectadoMariana.data || {}).includes("IR "), `${afectadoMariana.status}`);
}

/* ================= Informe retenido no se libera ================= */
{
  const c = await cadena(t, "RETLIB");
  const A = (await api("POST", "/samples/analysis", analisisDe(c), t.qa)).data?.id;
  await api("POST", `/samples/analysis/${A}/enviar-revision`, {}, t.qa);
  await api("POST", `/samples/analysis/${A}/revisar`, {}, t.ricardo);
  await api("POST", `/samples/analysis/${A}/aprobar`, {}, t.ricardo);
  const inf = (await api("POST", "/informes", { recepcion_id: c.R, analisis_ids: [A], cliente: { nombre: "Cliente RETLIB", correo: "cliente@ejemplo.mx" } }, t.qa)).data?.id;
  await api("POST", `/informes/${inf}/revisar`, {}, t.ricardo);
  await api("POST", `/informes/${inf}/autorizar`, {}, t.patricia);
  const nc = await api("POST", "/calidad/nc", { origen: "otro", descripcion: "Duda sobre la curva de calibración del lote", responsable_id: id.ricardo }, t.ana);
  await api("POST", `/calidad/nc/${nc.data?.id}/retenciones`, { informe_id: inf, motivo: "Revisar la curva" }, t.ana);
  const lib = await api("POST", `/informes/${inf}/liberar`, {}, t.patricia);
  check("un informe retenido no se libera (409 informe_retenido)", lib.status === 409 && lib.data?.codigo === "informe_retenido", `${lib.status} ${lib.data?.codigo}`);
  const cierra = await api("POST", `/calidad/nc/${nc.data?.id}/cerrar`, { conclusion: "Curva correcta" }, t.patricia);
  check("cerrar sin la evaluación ni la decisión, o con retenciones, -> 409", cierra.status === 409, `${cierra.status}`);
}

const verif = await api("GET", "/audit/verify", undefined, t.qa);
check("la cadena de la bitácora sigue íntegra", verif.data?.ok === true, JSON.stringify(verif.data).slice(0, 120));

terminar();
