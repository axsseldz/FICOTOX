/*
 * Prueba de extremo a extremo del flujo completo (recepcion -> procesamiento ->
 * extraccion -> analisis -> informe -> disposicion), anulaciones, Documentos SGC
 * (y el retiro de Documentos SGC), bajas de inventario y bitacora de auditoria. Corre contra el dev
 * server apuntando a la COPIA de prueba de la base.
 */
import "./lib/reauth-auto.mjs";
import { readFileSync } from "node:fs";
import { autorizarTodo } from "./lib/autorizar.mjs";
import { pdfConTexto } from "./lib/archivos.mjs";
import { liberar, registrarEnvio } from "./lib/envio.mjs";
const BASE = process.env.BASE || "http://localhost:3100/api";
let token = "";
let token2 = "";
let token3 = "";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ""}`);
};

async function api(method, path, body, opts = {}) {
  const headers = { ...(opts.form ? {} : { "Content-Type": "application/json" }), ...(opts.token || token ? { Authorization: `Bearer ${opts.token || token}` } : {}) };
  const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.form ? body : body ? JSON.stringify(body) : undefined });
  const type = res.headers.get("content-type") || "";
  let data = null;
  if (type.includes("application/json")) data = await res.json().catch(() => null);
  else data = await res.arrayBuffer().catch(() => null);
  return { status: res.status, data, type };
}

for (let i = 0; i < 60; i += 1) {
  try {
    const r = await fetch(`${BASE}/health`);
    if (r.ok) break;
  } catch {
    /* esperando */
  }
  await new Promise((r) => setTimeout(r, 1000));
}

// ---------- Sesiones (QA, con el rol de prueba que tiene G en todo, y una revisora con un rol de revision creado por API) ----------
{
  const bad = await api("POST", "/auth/login", { email: "qa@ficotox.local", password: "incorrecta-123" });
  check("login fallido -> 401", bad.status === 401, `status ${bad.status}`);
  const r = await api("POST", "/auth/login", { email: "qa@ficotox.local", password: "QaFicotox2026!" });
  token = r.data?.token || "";
  check("login QA", r.status === 200 && !!token && r.data?.permissions?.calidad?.V === "total" && r.data?.permissions?.ensayos?.A === "total", `perm calidad=${JSON.stringify(r.data?.permissions?.calidad)} ensayos=${JSON.stringify(r.data?.permissions?.ensayos)}`);
  // Segundo usuario (revisor independiente) con un rol que revisa y aprueba (sin usuarios:G, para no violar la regla 1).
  const rolRev = await api("POST", "/admin/roles", {
    nombre: "Revisora QA",
    descripcion: "Revisa y aprueba (pruebas)",
    motivo: "Rol de pruebas",
    permisos: [
      { modulo: "ensayos", accion: "R" }, { modulo: "ensayos", accion: "A" },
      { modulo: "informes", accion: "R" }, { modulo: "informes", accion: "A" },
      { modulo: "documentos", accion: "E" }, { modulo: "documentos", accion: "A" }, { modulo: "muestras", accion: "V" },
    ],
  });
  const u = await api("POST", "/admin/usuarios", { nombre: "Revisora QA", email: "revisora@cicese.mx", activo: true, rol_id: rolRev.data?.id, departamento: "Calidad", password: "RevisoraQA2026!" });
  await autorizarTodo(BASE, token, u.data?.id);
  check("crear usuario revisora", rolRev.status === 201 && u.status === 201, `rol ${rolRev.status} usuario ${u.status} ${JSON.stringify(u.data)}`);
  const r2 = await api("POST", "/auth/login", { email: "revisora@cicese.mx", password: "RevisoraQA2026!" });
  token2 = r2.data?.token || "";
  check("login revisora", r2.status === 200 && !!token2, `status ${r2.status}`);
  // Tercera persona (Mejora Continua).
  const cred = JSON.parse(readFileSync(process.env.CREDENCIALES_ROLES, "utf8"));
  const r3 = await api("POST", "/auth/login", { email: "ana.torres@ficotox.local", password: cred["ana.torres@ficotox.local"] });
  token3 = r3.data?.token || "";
  check("login Mejora Continua (tercera persona)", r3.status === 200 && !!token3, `status ${r3.status}`);
}

// ---------- Recepcion con aceptacion ----------
const inspeccionOk = (nc = false) => ({
  checklist: [
    "Se presentan en talla comercial.",
    "Se presentan sin alteraciones (estado de descomposición, valvas abiertas/rotas, cuerpos eviscerados).",
    "En el momento de su presentación no han transcurrido más de 24 horas después de haber sido extraídas.",
    "Se presentan en bolsa o botella de plástico transparente, sin alteraciones, como contenedor primario.",
    "El contenedor primario es transportado en una hielera con blue ice/hielo suficiente para mantener la temperatura entre 4 y 10 °C.",
    "Se presentan en cantidad o volumen suficiente para el(los) análisis solicitados.",
    "Se presenta con algún tipo de fijador (en caso positivo especificar el tipo).",
  ].map((requisito, i) => ({ requisito, estado: nc && i === 1 ? "NC" : i === 6 ? "NA" : "C", observacion: null })),
  observaciones_generales: null,
});
const recepcionBase = {
  fecha_recepcion: "2026-09-10",
  hora_recepcion: "08:30",
  recibido_por: "Ana QA",
  medio_recepcion: "directa",
  solicitante: "Productor Bahía Falsa S.A.",
  muestra_unica: true,
  id_interno: "D26-100",
  fecha_muestra: "2026-09-09",
  analisis: { tipos: ["toxinas_lipofilicas"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] },
  datos_solicitante: { nombre_entrega: "Juan Pérez", firma_conformidad: null },
  datos_custodio: { nombre_cargo_firma: "Ana QA", lugar_resguardo: "congelador" },
};
let recepcionId = null;
{
  const sinInspeccion = await api("POST", "/samples/reception", { ...recepcionBase, decision_aceptacion: "aceptada", inspeccion: { checklist: [] } });
  check("aceptar sin inspeccion completa -> 400", sinInspeccion.status === 400, `status ${sinInspeccion.status} ${sinInspeccion.data?.message}`);
  const ncAceptada = await api("POST", "/samples/reception", { ...recepcionBase, decision_aceptacion: "aceptada", inspeccion: inspeccionOk(true) });
  check("aceptar con NC sin desviacion -> 400", ncAceptada.status === 400, `status ${ncAceptada.status} ${ncAceptada.data?.message}`);
  const registrada = await api("POST", "/samples/reception", { ...recepcionBase, inspeccion: inspeccionOk() });
  recepcionId = registrada.data?.id;
  check("recepcion registrada sin decision -> estado registrada", registrada.status === 201 && registrada.data?.estado === "registrada", JSON.stringify(registrada.data));
  const proc = await api("POST", "/samples/processing", { recepcion_id: recepcionId, folio_recepcion_num: 1, muestra_tipo: "unica", id_interno: "D26-100", fecha_procesamiento: "2026-09-10", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "Ana QA" });
  check("procesar recepcion sin aceptar -> 409", proc.status === 409, `status ${proc.status} ${proc.data?.message}`);
  const folioActual = (await api("GET", `/samples/reception/${recepcionId}`)).data?.item?.folio_num;
  const aceptada = await api("PUT", `/samples/reception/${recepcionId}`, { ...recepcionBase, folio_num: folioActual, decision_aceptacion: "aceptada", inspeccion: inspeccionOk(), aceptacion: { fecha: "2026-09-10", responsable: "Ana QA", temperatura_llegada: "6 °C" } });
  check("aceptar recepcion (PUT) -> estado aceptada", aceptada.status === 200 && aceptada.data?.estado === "aceptada", `status ${aceptada.status} ${JSON.stringify(aceptada.data)}`);
}
// recuperar folio real
const recepcion = (await api("GET", `/samples/reception/${recepcionId}`)).data?.item;
const folioR = recepcion?.folio_num;

// ---------- Procesamiento y extraccion (avance de estados) ----------
let procesamientoId = null;
let extraccionId = null;
{
  const proc = await api("POST", "/samples/processing", { recepcion_id: recepcionId, folio_recepcion_num: folioR, muestra_tipo: "unica", id_interno: "D26-100", fecha_procesamiento: "2026-09-10", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "Ana QA" });
  procesamientoId = proc.data?.id;
  check("procesamiento desde recepcion aceptada -> 201", proc.status === 201, JSON.stringify(proc.data));
  const r = (await api("GET", `/samples/reception/${recepcionId}`)).data?.item;
  check("recepcion avanza a en_procesamiento", r?.estado === "en_procesamiento" && Array.isArray(r?.procesamientos) && r.procesamientos.length === 1, `estado=${r?.estado}`);
  const ext = await api("POST", "/samples/extraction", { tipo_registro: "E-D", procesamiento_id: procesamientoId, tipo_molienda: "fresca", id_interno: "D26-100", fecha_extraccion: "2026-09-10", registro_pesos: [{ id_muestra: "D26-100", replica: "D26-100_R1", peso_muestra: 2.01 }], nombre_quien_extrajo: "Ana QA" });
  extraccionId = ext.data?.id;
  check("extraccion DSP -> 201", ext.status === 201, JSON.stringify(ext.data));
  const p = (await api("GET", `/samples/processing/${procesamientoId}`)).data?.item;
  check("procesamiento avanza a en_proceso", p?.estado === "en_proceso", `estado=${p?.estado}`);
  const del = await api("DELETE", `/samples/extraction/${extraccionId}`);
  check("DELETE de registro tecnico -> 405", del.status === 405, `status ${del.status} ${del.data?.message}`);
}

// ---------- Analisis: registrar, revisar, aprobar (independencia) ----------
let analisisId = null;
{
  const bad = await api("POST", "/samples/analysis", { tipo_analisis: "toxinas_lipofilicas", metodo: "hplc_ms_ms", fecha_analisis: "2026-09-10", recepcion_id: recepcionId, analista_nombre: "Ana QA", resultados: [] });
  check("analisis DSP sin extraccion -> 400", bad.status === 400, `status ${bad.status} ${bad.data?.message}`);
  const ok = await api("POST", "/samples/analysis", {
    tipo_analisis: "toxinas_lipofilicas",
    metodo: "hplc_ms_ms",
    metodo_referencia: "FX-TCI-DSP rev. 2",
    extraccion_id: extraccionId,
    fecha_analisis: "2026-09-10",
    hora_inicio: "10:00",
    hora_fin: "12:30",
    equipo_id: 1,
    equipo_folio_bitacora: "45",
    analista_nombre: "Ana QA",
    resultados: [{ id_muestra: "D26-100", resultado: 95.4, unidad: "µg/kg", limite_regulatorio: 160, limite_deteccion: 5, incertidumbre: 8.2, cumple: "cumple" }],
    controles: { blanco: { resultado: "< LD", aceptable: "si" }, material_referencia: { nombre: "CRM-OA-c", lote: "L23", valor_esperado: "100", valor_obtenido: "98", aceptable: "si" } },
  });
  analisisId = ok.data?.id;
  check("analisis registrado -> 201 con cadena derivada", ok.status === 201, JSON.stringify(ok.data));
  const item = (await api("GET", `/samples/analysis/${analisisId}`)).data?.item;
  check("analisis deriva procesamiento y recepcion desde la extraccion", item?.procesamiento_id === procesamientoId && item?.recepcion_id === recepcionId && item?.equipo_nombre === "Centrifuga", `p=${item?.procesamiento_id} r=${item?.recepcion_id} eq=${item?.equipo_nombre}`);
  const aprobarSinRevisar = await api("POST", `/samples/analysis/${analisisId}/aprobar`, {});
  check("aprobar sin revisar -> 409", aprobarSinRevisar.status === 409, `status ${aprobarSinRevisar.status}`);
  // Fase 3: la revisa y aprueba otra persona (la revisora); revisor y aprobador pueden coincidir.
  // Fase 6: el analisis se revisa solo despues de enviarlo a revision.
  await api("POST", `/samples/analysis/${analisisId}/enviar-revision`, {});
  const rev = await api("POST", `/samples/analysis/${analisisId}/revisar`, { observaciones: "Controles dentro de criterio" }, { token: token2 });
  check("revisar analisis -> revisado", rev.status === 200 && rev.data?.item?.estado === "revisado", `status ${rev.status} ${rev.data?.message}`);
  const apr = await api("POST", `/samples/analysis/${analisisId}/aprobar`, {}, { token: token2 });
  check("aprobar por la misma persona que reviso (distinta de quien elaboro) -> aprobado", apr.status === 200 && apr.data?.item?.estado === "aprobado", `status ${apr.status} ${apr.data?.message}`);
  const e = (await api("GET", `/samples/extraction/${extraccionId}`)).data?.item;
  const p = (await api("GET", `/samples/processing/${procesamientoId}`)).data?.item;
  const rAna = (await api("GET", `/samples/reception/${recepcionId}`)).data?.item;
  check("extraccion -> analizada, procesamiento -> completada, recepcion -> validada", e?.estado === "analizada" && p?.estado === "completada" && rAna?.estado === "validada", `e=${e?.estado} p=${p?.estado} r=${rAna?.estado}`);
  const edit = await api("PUT", `/samples/analysis/${analisisId}`, { tipo_analisis: "toxinas_lipofilicas", metodo: "hplc_ms_ms", extraccion_id: extraccionId, fecha_analisis: "2026-09-10", analista_nombre: "Ana QA", resultados: [{ id_muestra: "D26-100", resultado: 90 }] });
  check("editar analisis aprobado -> 409", edit.status === 409, `status ${edit.status}`);
  const anularExt = await api("POST", `/samples/extraction/${extraccionId}/anular`, { motivo: "prueba de bloqueo" });
  check("anular extraccion con analisis vigente -> 409", anularExt.status === 409, `status ${anularExt.status} ${anularExt.data?.message}`);
}

// ---------- Informe: crear, revisar, autorizar, liberar (PDF), enviar, enmienda ----------
let informeId = null;
{
  const disponibles = await api("GET", `/informes/recepcion/${recepcionId}`);
  check("analisis reportables de la recepcion", disponibles.status === 200 && disponibles.data?.analisis?.length === 1 && disponibles.data?.cliente?.nombre === "Productor Bahía Falsa S.A.", JSON.stringify({ n: disponibles.data?.analisis?.length, cliente: disponibles.data?.cliente }));
  const cr = await api("POST", "/informes", { recepcion_id: recepcionId, analisis_ids: [analisisId], cliente: { nombre: "Productor Bahía Falsa S.A.", contacto: "Juan Pérez", direccion: "San Quintín, B.C." }, declaraciones: { desviaciones: null }, elaborado_nombre: "Ana QA", elaborado_cargo: "Analista" });
  informeId = cr.data?.id;
  check("informe borrador creado", cr.status === 201 && cr.data?.folio_num >= 1, JSON.stringify(cr.data));
  const autSinRev = await api("POST", `/informes/${informeId}/autorizar`, {});
  check("autorizar sin revisar -> 409", autSinRev.status === 409, `status ${autSinRev.status}`);
  const preview = await api("GET", `/informes/${informeId}/pdf`);
  check("vista previa PDF del borrador", preview.status === 200 && preview.type.includes("pdf") && preview.data?.byteLength > 1000, `status ${preview.status} ${preview.type} bytes=${preview.data?.byteLength}`);
  // Sin cargo en el payload: el servidor toma el rol de quien firma. Quien elaboro (QA) no revisa: 409 segregacion.
  const revPropio = await api("POST", `/informes/${informeId}/revisar`, {});
  check("revisar informe propio -> 409 segregacion", revPropio.status === 409 && revPropio.data?.codigo === "segregacion", `status ${revPropio.status} ${revPropio.data?.message}`);
  const rev = await api("POST", `/informes/${informeId}/revisar`, {}, { token: token2 });
  check("revisar informe (otra persona) con cargo = rol", rev.status === 200 && rev.data?.item?.estado === "en_revision" && !!rev.data?.item?.revisado_cargo, `status ${rev.status} cargo=${rev.data?.item?.revisado_cargo}`);
  const aut = await api("POST", `/informes/${informeId}/autorizar`, {}, { token: token2 });
  check("autorizar informe -> autorizado SIN PDF final (Fase 6)", aut.status === 200 && aut.data?.item?.estado === "autorizado" && !aut.data?.item?.archivo_pdf && !aut.data?.item?.pdf_sha256, `status ${aut.status} ${aut.data?.message} pdf=${aut.data?.item?.archivo_pdf}`);
  const rAut = (await api("GET", `/samples/reception/${recepcionId}`)).data?.item;
  check("autorizar no mueve la recepcion a liberada", rAut?.estado !== "liberada", `estado=${rAut?.estado}`);
  const envAut = await registrarEnvio(BASE, token, informeId, { nombre: "Juan Pérez", correo: "juan@ejemplo.mx" });
  check("enviar un informe autorizado (no liberado) -> 409", envAut.status === 409, `status ${envAut.status} ${envAut.data?.message}`);
  const lib = await liberar(BASE, token2, informeId);
  check("liberar -> liberado con PDF final y sha256", lib.status === 200 && lib.data?.item?.estado === "liberado" && !!lib.data?.item?.archivo_pdf && String(lib.data?.item?.pdf_sha256 || "").length === 64, `status ${lib.status} ${lib.data?.message}`);
  const r = (await api("GET", `/samples/reception/${recepcionId}`)).data?.item;
  check("liberar lleva la recepcion a liberada", r?.estado === "liberada", `estado=${r?.estado}`);
  const pdf = await api("GET", `/informes/${informeId}/pdf`);
  check("descarga PDF liberado", pdf.status === 200 && pdf.data?.byteLength > 1500, `bytes=${pdf.data?.byteLength}`);
  const editAut = await api("PUT", `/informes/${informeId}`, { recepcion_id: recepcionId, analisis_ids: [analisisId] });
  check("editar informe liberado -> 409", editAut.status === 409, `status ${editAut.status}`);
  const anularAnalisis = await api("POST", `/samples/analysis/${analisisId}/anular`, { motivo: "prueba bloqueo por informe" });
  check("anular analisis incluido en informe liberado -> 409", anularAnalisis.status === 409, `status ${anularAnalisis.status} ${anularAnalisis.data?.message}`);
  const ent = await registrarEnvio(BASE, token, informeId, { nombre: "Juan Pérez", correo: "juan@ejemplo.mx" });
  const tras = (await api("GET", `/informes/${informeId}`)).data?.item;
  check("registrar envio con evidencia -> 200 y el informe pasa a enviado", ent.status === 200 && tras?.estado === "enviado", `status ${ent.status} ${ent.data?.message} ${tras?.estado}`);
  const enm = await api("POST", `/informes/${informeId}/enmienda`, { motivo: "Error en dirección del cliente" });
  check("enmienda crea version 2 en borrador", enm.status === 201 && enm.data?.version === 2, JSON.stringify(enm.data));
  const enm2 = await api("POST", `/informes/${informeId}/enmienda`, { motivo: "segunda enmienda" });
  check("segunda enmienda mientras hay una vigente -> 409", enm2.status === 409, `status ${enm2.status}`);
  const enmBorrador = await api("POST", `/informes/${enm.data?.id}/enmienda`, { motivo: "enmienda de un borrador" });
  check("enmienda de un borrador -> 409", enmBorrador.status === 409, `status ${enmBorrador.status}`);
  const shaV1 = (await api("GET", `/informes/${informeId}`)).data?.item?.pdf_sha256;
  await api("POST", `/informes/${enm.data?.id}/revisar`, { cargo: "Coordinadora técnica" }, { token: token2 });
  const autV2 = await api("POST", `/informes/${enm.data?.id}/autorizar`, { cargo: "Directora" }, { token: token2 });
  const libV2 = await liberar(BASE, token2, enm.data?.id);
  const v1 = (await api("GET", `/informes/${informeId}`)).data?.item;
  check("liberar la enmienda deja el original 'sustituido' con PDF regenerado", autV2.status === 200 && libV2.status === 200 && v1?.estado === "sustituido" && !!v1?.pdf_sha256 && v1.pdf_sha256 !== shaV1, `status ${autV2.status} ${libV2.status} v1=${v1?.estado} sha cambio=${v1?.pdf_sha256 !== shaV1}`);
  const entV1 = await registrarEnvio(BASE, token, informeId, { nombre: "Juan Pérez", correo: "juan@ejemplo.mx" });
  check("enviar un informe sustituido -> 409", entV1.status === 409, `status ${entV1.status}`);
  const excAudit = (await api("GET", `/audit?entidad=muestras_analisis&entidad_id=${analisisId}&accion=aprobar`)).data?.items || [];
  check("bitacora del analisis registra la aprobacion sin excepcion (motivo vacio)", excAudit.length === 1 && !excAudit[0].motivo, JSON.stringify(excAudit.map((a) => a.motivo)));
  const lista = (await api("GET", "/informes")).data?.items || [];
  check("lista de informes incluye v1 sustituido y v2 liberado", lista.some((i) => i.id === informeId && i.estado === "sustituido") && lista.some((i) => i.version === 2 && i.estado === "liberado"), JSON.stringify(lista.map((i) => `${i.folio}v${i.version}:${i.estado}`)));
}

// ---------- Disposicion final -> cerrada ----------
{
  const bad = await api("POST", `/samples/reception/${recepcionId}/disposicion`, { tipo: "rpbi" });
  check("disposicion sin fecha/responsable -> 400", bad.status === 400, `status ${bad.status}`);
  const ok = await api("POST", `/samples/reception/${recepcionId}/disposicion`, { tipo: "rpbi", fecha: "2026-09-12", responsable: "Ana QA", remanentes: "120 g de molienda" });
  check("disposicion registrada -> recepcion cerrada", ok.status === 200 && ok.data?.item?.estado === "cerrada" && ok.data?.item?.disposicion?.tipo === "rpbi", `status ${ok.status} ${JSON.stringify(ok.data?.item?.disposicion)}`);
  const editCerrada = await api("PUT", `/samples/reception/${recepcionId}`, { ...recepcionBase, folio_num: folioR, solicitante: "Otro cliente" });
  check("editar recepcion cerrada -> 409", editCerrada.status === 409, `status ${editCerrada.status}`);
  const otraDisp = await api("POST", `/samples/reception/${recepcionId}/disposicion`, { tipo: "rpbi", fecha: "2026-09-12", responsable: "Ana QA" });
  check("segunda disposicion de una muestra cerrada -> 409", otraDisp.status === 409, `status ${otraDisp.status}`);
}

// ---------- Regresiones de la revision independiente ----------
{
  // Recepcion rechazada: no se edita por API para "aceptarla" despues.
  const rech = await api("POST", "/samples/reception", { ...recepcionBase, id_interno: "D26-RECH", decision_aceptacion: "rechazada", inspeccion: inspeccionOk(true), aceptacion: { fecha: "2026-09-10", responsable: "Ana QA", comunicacion_cliente: { fecha: "2026-09-10", medio: "telefono", persona: "Juan Pérez", respuesta: "Enviara otra muestra" } } });
  check("recepcion rechazada -> 201 estado rechazada", rech.status === 201 && rech.data?.estado === "rechazada", `status ${rech.status} ${JSON.stringify(rech.data)}`);
  const folioRech = (await api("GET", `/samples/reception/${rech.data?.id}`)).data?.item?.folio_num;
  const reacept = await api("PUT", `/samples/reception/${rech.data?.id}`, { ...recepcionBase, id_interno: "D26-RECH", folio_num: folioRech, decision_aceptacion: "aceptada", inspeccion: inspeccionOk(), aceptacion: { fecha: "2026-09-10", responsable: "Ana QA" } });
  check("editar recepcion rechazada -> 409", reacept.status === 409, `status ${reacept.status} ${reacept.data?.message}`);
  const dispRech = await api("POST", `/samples/reception/${rech.data?.id}/disposicion`, { tipo: "devuelto_cliente", fecha: "2026-09-11", responsable: "Ana QA" });
  check("disposicion de una muestra rechazada (devuelta) -> cerrada", dispRech.status === 200 && dispRech.data?.item?.estado === "cerrada", `status ${dispRech.status} ${dispRech.data?.message}`);

  // Analisis anulado: ni edicion ni doble anulacion; restaurar regresa al estado previo.
  const recA = await api("POST", "/samples/reception", { ...recepcionBase, id_interno: "D26-ANA", decision_aceptacion: "aceptada", inspeccion: inspeccionOk(), aceptacion: { fecha: "2026-09-10", responsable: "Ana QA" } });
  const procA = await api("POST", "/samples/processing", { recepcion_id: recA.data?.id, muestra_tipo: "unica", id_interno: "D26-ANA", fecha_procesamiento: "2026-09-10", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "Ana QA" });
  const extA = await api("POST", "/samples/extraction", { tipo_registro: "E-A", procesamiento_id: procA.data?.id, tipo_molienda: "fresca", id_interno: "D26-ANA", fecha_extraccion: "2026-09-10" });
  const anaA = await api("POST", "/samples/analysis", { tipo_analisis: "acido_domoico", metodo: "hplc_uv_vis", extraccion_id: extA.data?.id, fecha_analisis: "2026-09-10", analista_nombre: "Ana QA", resultados: [{ id_muestra: "D26-ANA", resultado: 3.1, unidad: "µg/g" }] });
  const anaId = anaA.data?.id;
  const an1 = await api("POST", `/samples/analysis/${anaId}/anular`, { motivo: "Captura duplicada del analisis" });
  check("anular analisis -> estado anulado", an1.status === 200 && an1.data?.item?.estado === "anulado", `status ${an1.status} ${an1.data?.item?.estado}`);
  const editAn = await api("PUT", `/samples/analysis/${anaId}`, { folio_num: anaA.data?.folio_num, tipo_analisis: "acido_domoico", metodo: "hplc_uv_vis", extraccion_id: extA.data?.id, fecha_analisis: "2026-09-10", analista_nombre: "Ana QA", resultados: [{ id_muestra: "D26-ANA", resultado: 9 }] });
  check("editar analisis anulado -> 409", editAn.status === 409, `status ${editAn.status} ${editAn.data?.message}`);
  const an2 = await api("POST", `/samples/analysis/${anaId}/anular`, { motivo: "Segunda anulacion" });
  check("anular dos veces -> 409", an2.status === 409, `status ${an2.status}`);
  const restA = await api("POST", `/samples/analysis/${anaId}/restaurar`, { motivo: "Se anulo por error" });
  check("restaurar analisis -> registrado", restA.status === 200 && restA.data?.item?.estado === "registrado", `status ${restA.status} ${restA.data?.item?.estado}`);
  const listaDef = (await api("GET", "/samples/analysis")).data?.items || [];
  check("analisis restaurado vuelve a la lista", listaDef.some((a) => a.id === anaId), `n=${listaDef.length}`);

  // Restaurar no deja registros colgando de un origen anulado.
  await api("POST", `/samples/analysis/${anaId}/anular`, { motivo: "Para probar el origen" });
  await api("POST", `/samples/extraction/${extA.data?.id}/anular`, { motivo: "Para probar el origen" });
  const restHuerfano = await api("POST", `/samples/analysis/${anaId}/restaurar`, { motivo: "Intento con extraccion anulada" });
  check("restaurar analisis con extraccion anulada -> 409", restHuerfano.status === 409, `status ${restHuerfano.status} ${restHuerfano.data?.message}`);

  // Insumos dados de baja no se descuentan.
  const reactivos = (await api("GET", "/inventory/reactivos?search=")).data?.items || [];
  const acido = reactivos.find((r) => /acetico|acético/i.test(String(r.producto || ""))) || reactivos[reactivos.length - 1];
  await api("DELETE", `/inventory/reactivos/${acido.id}`, { motivo: "Prueba: frasco retirado" });
  const procBaja = await api("POST", "/samples/processing", { recepcion_id: recA.data?.id, muestra_tipo: "unica", id_interno: "D26-ANA", fecha_procesamiento: "2026-09-11", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "Ana QA", uso_inventario: [{ tipo: "reactivo", ref: String(acido.id), cantidad: 0.5 }] });
  check("descontar un reactivo dado de baja -> 409", procBaja.status === 409 && /baja/.test(procBaja.data?.message || ""), `status ${procBaja.status} ${procBaja.data?.message}`);
  await api("POST", `/inventory/reactivos/${acido.id}/reactivar`, { motivo: "Prueba terminada" });

  // Historial por registro: solo quien puede leer el modulo.
  const rol = await api("POST", "/admin/roles", { nombre: "Analista QA", descripcion: "Solo muestras", motivo: "Rol de pruebas", permisos: [{ modulo: "muestras", accion: "V" }, { modulo: "muestras", accion: "C" }, { modulo: "muestras", accion: "E" }] });
  const u3 = await api("POST", "/admin/usuarios", { nombre: "Analista QA", email: "analista@cicese.mx", activo: true, rol_id: rol.data?.id, departamento: "Lab", password: "AnalistaQA2026!" });
  const t3 = (await api("POST", "/auth/login", { email: "analista@cicese.mx", password: "AnalistaQA2026!" })).data?.token || "";
  check("usuario con rol limitado creado", rol.status === 201 && u3.status === 201 && !!t3, `rol ${rol.status} user ${u3.status}`);
  const users = (await api("GET", "/admin/usuarios")).data?.items || [];
  const qa = users.find((u) => u.email === "qa@ficotox.local");
  const histUsuario = await api("GET", `/audit?entidad=usuarios&entidad_id=${qa?.id}`, undefined, { token: t3 });
  check("historial de usuarios sin permiso 'usuarios' -> 403", histUsuario.status === 403, `status ${histUsuario.status}`);
  const histMuestra = await api("GET", `/audit?entidad=muestras_recepcion&entidad_id=${recepcionId}`, undefined, { token: t3 });
  check("historial de una recepcion con permiso muestras:V -> 200", histMuestra.status === 200 && (histMuestra.data?.items || []).length > 0, `status ${histMuestra.status}`);
  const logCompleto = await api("GET", "/audit", undefined, { token: t3 });
  // Fase 6: el analisis se revisa solo despues de enviarlo a revision.
  await api("POST", `/samples/analysis/${anaId}/enviar-revision`, {});
  const aprobarSinPermiso = await api("POST", `/samples/analysis/${anaId}/revisar`, {}, { token: t3 });
  check("bitacora completa y revisar sin permiso -> 403", logCompleto.status === 403 && aprobarSinPermiso.status === 403, `log ${logCompleto.status} revisar ${aprobarSinPermiso.status}`);
  const histSinMapa = await api("GET", "/audit?entidad=sesion&entidad_id=1", undefined, { token: t3 });
  const histSinEntidad = await api("GET", "/audit?entidad=&entidad_id=1", undefined, { token: t3 });
  const entrada = await api("GET", "/audit/1", undefined, { token: t3 });
  check("entidad sin modulo, entidad vacia y /audit/<id> sin permiso -> 403", histSinMapa.status === 403 && histSinEntidad.status === 403 && entrada.status === 403, `${histSinMapa.status}/${histSinEntidad.status}/${entrada.status}`);

  // Un registro antiguo que declara un insumo dado de baja se sigue pudiendo reabrir y guardar.
  const reactivo2 = reactivos.find((r) => /metanol/i.test(String(r.producto || ""))) || reactivos[0];
  const recEdit = await api("POST", "/samples/reception", { ...recepcionBase, id_interno: "D26-EDIT", decision_aceptacion: "aceptada", inspeccion: inspeccionOk(), aceptacion: { fecha: "2026-09-10", responsable: "Ana QA" } });
  const procEdit = await api("POST", "/samples/processing", { recepcion_id: recEdit.data?.id, muestra_tipo: "unica", id_interno: "D26-EDIT", fecha_procesamiento: "2026-09-10", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "Ana QA", uso_inventario: [{ tipo: "reactivo", ref: String(reactivo2.id), cantidad: 0.25 }] });
  const stockAntes = Number(((await api("GET", "/inventory/reactivos?search=")).data?.items || []).find((r) => r.id === reactivo2.id)?.cantidad_actual);
  await api("DELETE", `/inventory/reactivos/${reactivo2.id}`, { motivo: "Prueba: retirado despues de usarse" });
  const folioProcEdit = (await api("GET", `/samples/processing/${procEdit.data?.id}`)).data?.item?.folio_num;
  const reeditar = await api("PUT", `/samples/processing/${procEdit.data?.id}`, { recepcion_id: recEdit.data?.id, folio_num: folioProcEdit, muestra_tipo: "unica", id_interno: "D26-EDIT", fecha_procesamiento: "2026-09-11", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "Ana QA", uso_inventario: [{ tipo: "reactivo", ref: String(reactivo2.id), cantidad: 0.25 }] });
  const stockDespues = Number(((await api("GET", "/inventory/reactivos?bajas=1&search=")).data?.items || []).find((r) => r.id === reactivo2.id)?.cantidad_actual);
  check("reeditar un registro con un insumo dado de baja -> 200 y stock sin cambio", reeditar.status === 200 && Math.abs(stockDespues - stockAntes) < 1e-6, `status ${reeditar.status} ${JSON.stringify(reeditar.data)} ${stockAntes} -> ${stockDespues}`);
  const subirCantidad = await api("PUT", `/samples/processing/${procEdit.data?.id}`, { recepcion_id: recEdit.data?.id, folio_num: folioProcEdit, muestra_tipo: "unica", id_interno: "D26-EDIT", fecha_procesamiento: "2026-09-11", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "Ana QA", uso_inventario: [{ tipo: "reactivo", ref: String(reactivo2.id), cantidad: 2 }] });
  check("aumentar el consumo de un insumo dado de baja -> 409", subirCantidad.status === 409, `status ${subirCantidad.status} ${subirCantidad.data?.message}`);
  const nuevoConBaja = await api("POST", "/samples/processing", { recepcion_id: recEdit.data?.id, muestra_tipo: "unica", id_interno: "D26-EDIT", fecha_procesamiento: "2026-09-12", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "Ana QA", uso_inventario: [{ tipo: "reactivo", ref: String(reactivo2.id), cantidad: 0.25 }] });
  check("declarar por primera vez un insumo dado de baja -> 409", nuevoConBaja.status === 409, `status ${nuevoConBaja.status} ${nuevoConBaja.data?.message}`);
  const movimientos = (await api("GET", "/inventory/movimientos?search=")).data?.items || [];
  check("el movimiento del insumo declarado sigue existiendo tras reeditar", movimientos.some((m) => String(m.referencia || "").startsWith(`PROC-${procEdit.data?.id}-INS-`)), `n=${movimientos.length}`);
  await api("POST", `/inventory/reactivos/${reactivo2.id}/reactivar`, { motivo: "Prueba terminada" });
}

// ---------- Anulacion / restauracion con motivo y reposicion de inventario ----------
{
  const rec2 = await api("POST", "/samples/reception", { ...recepcionBase, id_interno: "D26-101", decision_aceptacion: "aceptada", inspeccion: inspeccionOk(), aceptacion: { fecha: "2026-09-10", responsable: "Ana QA" } });
  const rec2Id = rec2.data?.id;
  const proc2 = await api("POST", "/samples/processing", { recepcion_id: rec2Id, muestra_tipo: "unica", id_interno: "D26-101", fecha_procesamiento: "2026-09-10", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "Ana QA" });
  const proc2Id = proc2.data?.id;
  const reactivos = (await api("GET", "/inventory/reactivos?search=")).data?.items || [];
  const metanol = reactivos.find((r) => /metanol/i.test(String(r.producto || "")));
  const before = Number(metanol?.cantidad_actual);
  const ext2 = await api("POST", "/samples/extraction", { tipo_registro: "E-A", procesamiento_id: proc2Id, tipo_molienda: "fresca", id_interno: "D26-101", fecha_extraccion: "2026-09-10", uso_inventario: [{ tipo: "reactivo", ref: String(metanol.id), cantidad: 0.3 }] });
  const ext2Id = ext2.data?.id;
  const sinMotivo = await api("POST", `/samples/extraction/${ext2Id}/anular`, { motivo: "x" });
  check("anular sin motivo suficiente -> 400", sinMotivo.status === 400, `status ${sinMotivo.status}`);
  const bloqueoRec = await api("POST", `/samples/reception/${rec2Id}/anular`, { motivo: "Prueba de bloqueo con procesamiento vigente" });
  check("anular recepcion con procesamiento vigente -> 409", bloqueoRec.status === 409, `status ${bloqueoRec.status}`);
  const an = await api("POST", `/samples/extraction/${ext2Id}/anular`, { motivo: "Muestra capturada por duplicado" });
  const after = ((await api("GET", "/inventory/reactivos?search=")).data?.items || []).find((r) => r.id === metanol.id);
  check("anular extraccion repone inventario", an.status === 200 && an.data?.item?.estado === "anulada" && Math.abs(Number(after?.cantidad_actual) - before) < 1e-6, `status ${an.status} ${before} -> ${after?.cantidad_actual}`);
  const listaDefault = (await api("GET", "/samples/extraction?search=")).data?.items || [];
  const listaCon = (await api("GET", "/samples/extraction?search=&anuladas=1")).data?.items || [];
  check("las anuladas no aparecen por defecto pero si con ?anuladas=1", !listaDefault.some((i) => i.id === ext2Id) && listaCon.some((i) => i.id === ext2Id && i.estado === "anulada"), `default=${listaDefault.length} con=${listaCon.length}`);
  const editAnulada = await api("PUT", `/samples/extraction/${ext2Id}`, { tipo_registro: "E-A", folio_num: ext2.data?.folio_num, procesamiento_id: proc2Id });
  check("editar registro anulado -> 409", editAnulada.status === 409, `status ${editAnulada.status}`);
  const res = await api("POST", `/samples/extraction/${ext2Id}/restaurar`, { motivo: "Anulación por error del capturista" });
  check("restaurar extraccion -> estado previo", res.status === 200 && res.data?.item?.estado === "registrada", `status ${res.status} ${res.data?.item?.estado}`);
  const anProc = await api("POST", `/samples/processing/${proc2Id}/anular`, { motivo: "prueba" + " bloqueo" });
  check("anular procesamiento con extraccion vigente -> 409", anProc.status === 409, `status ${anProc.status}`);
}

// ---------- Documentos SGC (reemplaza a la Biblioteca; el detalle esta en api-documentos.mjs) ----------
{
  const form = new FormData();
  form.set("titulo", "Procedimiento de gestión de calidad para control de documentos");
  form.set("clave", "FX-GCP-CD");
  form.set("area_codigo", "GC");
  form.set("tipo_codigo", "P");
  form.set("archivo_pdf", new File([await pdfConTexto(1, "Control de documentos")], "FX-GCP-CD.pdf", { type: "application/pdf" }));
  const cr = await api("POST", "/sgc/documentos", form, { form: true });
  const ficha = (await api("GET", `/sgc/documentos/${cr.data?.id}`)).data;
  const pdf = ficha?.revisiones?.[0]?.archivos?.find((a) => a.tipo === "pdf");
  check("documentos SGC: nueva ficha con su PDF (201), revisión en borrador y SHA-256", cr.status === 201 && ficha?.revisiones?.[0]?.estado === "borrador" && !!pdf?.sha256, `status ${cr.status} ${cr.data?.message || ""}`);
  const descarga = await api("GET", `/sgc/archivos/${pdf?.id}?modo=descargar`);
  check("documentos SGC: descargar el archivo (queda en la bitácora)", descarga.status === 200 && descarga.type.includes("pdf"), `status ${descarga.status} ${descarga.type}`);
  const viejo = await api("POST", "/documentos-sgc", { clave: "FX-GCP-QA9", titulo: "Flujo retirado" });
  check("flujo anterior de documentos retirado: crear responde 410", viejo.status === 410 && viejo.data?.codigo === "retirado", `status ${viejo.status}`);
  const biblioteca = await api("GET", "/biblioteca");
  check("la Biblioteca ya no responde (404)", biblioteca.status === 404, `status ${biblioteca.status}`);
}

// ---------- Bajas logicas de inventario y usuarios ----------
{
  const equipos = (await api("GET", "/inventory/equipos")).data?.items || [];
  const creado = await api("POST", "/inventory/equipos", { nombre: "Balanza QA", estado: "operativo", clave_bitacora: "FX-TCB-BA9-1/1" });
  const eqId = creado.data?.id;
  const sinMotivo = await api("DELETE", `/inventory/equipos/${eqId}`, {});
  check("baja de equipo sin motivo -> 400", sinMotivo.status === 400, `status ${sinMotivo.status}`);
  const baja = await api("DELETE", `/inventory/equipos/${eqId}`, { motivo: "Equipo retirado por falla" });
  const lista = (await api("GET", "/inventory/equipos")).data?.items || [];
  const listaBajas = (await api("GET", "/inventory/equipos?bajas=1")).data?.items || [];
  check("baja logica de equipo: oculto por defecto, visible con ?bajas=1", baja.status === 200 && !lista.some((e) => e.id === eqId) && listaBajas.some((e) => e.id === eqId && Number(e.activo) === 0), `status ${baja.status} equipos=${equipos.length}`);
  const re = await api("POST", `/inventory/equipos/${eqId}/reactivar`, { motivo: "Reparado y verificado" });
  check("reactivar equipo", re.status === 200, `status ${re.status}`);
  const users = (await api("GET", "/admin/usuarios")).data?.items || [];
  const revisora = users.find((u) => u.email === "revisora@cicese.mx");
  const bajaU = await api("DELETE", `/admin/usuarios/${revisora?.id}`, { motivo: "Fin de estancia" });
  const users2 = (await api("GET", "/admin/usuarios")).data?.items || [];
  check("baja de usuario deja la cuenta inactiva (no la borra)", bajaU.status === 200 && users2.some((u) => u.id === revisora?.id && Number(u.activo) === 0), `status ${bajaU.status} ${bajaU.data?.message}`);
}

// ---------- Auditoria ----------
{
  const all = (await api("GET", "/audit?limit=500")).data?.items || [];
  const acciones = new Set(all.map((a) => a.accion));
  const entidades = new Set(all.map((a) => a.entidad));
  check("bitacora registra login, login_fallido, crear, editar, aceptar, revisar, aprobar, autorizar, liberar, enviar, cerrar, anular, restaurar, baja, reactivar, descargar", ["login", "login_fallido", "crear", "editar", "aceptar", "revisar", "aprobar", "autorizar", "liberar", "enviar", "cerrar", "anular", "restaurar", "baja", "reactivar", "descargar"].every((a) => acciones.has(a)), `faltan: ${["login", "login_fallido", "crear", "editar", "aceptar", "revisar", "aprobar", "autorizar", "liberar", "enviar", "cerrar", "anular", "restaurar", "baja", "reactivar", "descargar"].filter((a) => !acciones.has(a)).join(",")}`);
  check("bitacora cubre recepcion, procesamiento, extraccion, analisis, informes, documentos, equipos, usuarios, sesion", ["muestras_recepcion", "muestras_procesamiento", "muestras_extraccion", "muestras_analisis", "informes", "sgc_documentos", "equipos", "usuarios", "sesion"].every((e) => entidades.has(e)), `faltan: ${["muestras_recepcion", "muestras_procesamiento", "muestras_extraccion", "muestras_analisis", "informes", "sgc_documentos", "equipos", "usuarios", "sesion"].filter((e) => !entidades.has(e)).join(",")}`);
  const edit = all.find((a) => a.accion === "editar" && a.entidad === "muestras_recepcion");
  check("entrada de edicion guarda antes/despues por campo", !!edit && Object.keys(edit.cambios || {}).length > 0 && "decision_aceptacion" in (edit.cambios || {}), JSON.stringify(edit?.cambios ? Object.keys(edit.cambios) : null));
  const detalle = (await api("GET", `/audit/${edit?.id}`)).data?.item;
  check("detalle de auditoria con datos anteriores y nuevos", !!detalle?.datos_anteriores && !!detalle?.datos_nuevos && !!detalle?.hash, `hash=${String(detalle?.hash || "").slice(0, 12)}`);
  const historial = (await api("GET", `/audit?entidad=muestras_recepcion&entidad_id=${recepcionId}`)).data?.items || [];
  check("historial por registro (recepcion) en orden", historial.length >= 4 && historial.every((h) => String(h.entidad_id) === String(recepcionId)), `n=${historial.length} acciones=${historial.map((h) => h.accion).join(",")}`);
  const verify = await api("GET", "/audit/verify");
  check("cadena de hashes integra", verify.status === 200 && verify.data?.ok === true && verify.data?.total > 20, JSON.stringify(verify.data));
  const summary = await api("GET", "/audit/summary");
  check("resumen de auditoria", summary.status === 200 && summary.data?.accesos_fallidos_30_dias >= 1, JSON.stringify(summary.data));
  check("verify reporta triggers presentes y sin filas faltantes", verify.data?.triggers_ok === true && verify.data?.filas_faltantes_al_final === 0, JSON.stringify(verify.data));
}

// ---------- Mantenimiento <-> estado del equipo y avisos del inicio ----------
{
  const eq = (await api("POST", "/inventory/equipos", { nombre: "Equipo prueba sync", clave_bitacora: "FX-TCB-ZZ1", estado: "operativo", fecha_prox_calibracion: "2026-01-01" })).data?.id;
  const estadoDe = async () => (await api("GET", "/inventory/equipos")).data?.items?.find((e) => e.id === eq)?.estado;
  const m = (await api("POST", "/inventory/mantenimientos", { id_equipo: eq, tipo: "calibracion", fecha_programada: "2026-09-15", estado: "programado" })).data?.id;
  check("programar calibracion pone el equipo en mantenimiento", (await estadoDe()) === "mantenimiento");
  const conPendiente = (await api("GET", "/inventory/equipos")).data?.items?.find((e) => e.id === eq);
  check("la lista de equipos expone el mantenimiento pendiente", conPendiente?.mantenimiento_tipo === "calibracion" && conPendiente?.mantenimiento_estado === "programado" && Number(conPendiente?.mantenimientos_pendientes) === 1, JSON.stringify([conPendiente?.mantenimiento_tipo, conPendiente?.mantenimiento_estado]));
  const sinFecha = await api("PUT", `/inventory/mantenimientos/${m}`, { id_equipo: eq, tipo: "calibracion", fecha_programada: "2026-09-15", estado: "completado" });
  check("completar sin fecha realizada -> 400", sinFecha.status === 400, sinFecha.data?.message);
  await api("PUT", `/inventory/mantenimientos/${m}`, { id_equipo: eq, tipo: "calibracion", fecha_programada: "2026-09-15", fecha_realizado: "2026-09-11", estado: "completado", proxima_calibracion: "2027-09-11" });
  const eqRow = (await api("GET", "/inventory/equipos")).data?.items?.find((e) => e.id === eq);
  check("completar calibracion: equipo operativo y proxima calibracion anotada", eqRow?.estado === "operativo" && String(eqRow?.fecha_prox_calibracion).slice(0, 10) === "2027-09-11", JSON.stringify([eqRow?.estado, eqRow?.fecha_prox_calibracion]));
  const m2 = (await api("POST", "/inventory/mantenimientos", { id_equipo: eq, tipo: "preventivo", fecha_programada: "2026-09-20", estado: "programado" })).data?.id;
  check("programar preventivo pone el equipo en mantenimiento", (await estadoDe()) === "mantenimiento");
  await api("DELETE", `/inventory/mantenimientos/${m2}`, { motivo: "Prueba de sincronizacion" });
  check("cancelar el pendiente regresa el equipo a operativo", (await estadoDe()) === "operativo");
  // Existencias (migraciones 19 y 20): el consumible lleva su existencia en UNIDADES (piezas x cantidad por pieza)
  // y el reactivo la inicia con capacidad x piezas; despues solo cambian con movimientos.
  const cid = (await api("POST", "/consumables", { producto: "Consumible prueba stock", piezas: 10, cantidad_por_pieza: 10 })).data?.id;
  const crow = (await api("GET", "/consumables?search=Consumible prueba stock")).data?.items?.find((c) => c.id === cid);
  check("consumible: existencia en unidades = piezas × cantidad por pieza (y es su stock de referencia)", Number(crow?.existencia) === 100 && Number(crow?.piezas) === 10 && Number(crow?.stock_maximo) === 100, JSON.stringify([crow?.existencia, crow?.piezas, crow?.stock_maximo]));
  const rid = (await api("POST", "/inventory/reactivos", { tipo_reactivo: "alcoholes_solventes", producto: "Reactivo prueba stock", capacidad: 1, unidad_capacidad: "L", piezas: 3, stock_minimo: 2, restante_190126: 7 })).data?.id;
  const rrow = (await api("GET", "/inventory/reactivos?search=Reactivo prueba stock")).data?.items?.find((r) => r.id === rid);
  check("reactivo: la existencia inicial es capacidad × piezas (las columnas heredadas no cuentan)", Number(rrow?.cantidad_actual) === 3 && Number(rrow?.stock_maximo) === 3 && Number(rrow?.stock_minimo) === 2, JSON.stringify([rrow?.cantidad_actual, rrow?.stock_maximo, rrow?.stock_minimo]));
  // Editar desde otra categoría conserva la existencia y las columnas heredadas; el relleno parte de cantidad_actual.
  await api("PUT", `/inventory/reactivos/${rid}`, { tipo_reactivo: "acidos", producto: "Reactivo prueba stock", capacidad: 1, unidad_capacidad: "L", piezas: 3, stock_minimo: 2 });
  const editado = (await api("GET", `/inventory/reactivos/${rid}`)).data?.item;
  check("editar reactivo conserva la existencia y las columnas que la hoja no manda", Number(editado?.restante_190126) === 7 && Number(editado?.cantidad_actual) === 3 && editado?.tipo_reactivo === "acidos", JSON.stringify([editado?.restante_190126, editado?.cantidad_actual, editado?.tipo_reactivo]));
  await api("POST", `/inventory/reactivos/${rid}/refill`, { cantidad: 6, motivo: "Prueba relleno" });
  const relleno = (await api("GET", `/inventory/reactivos/${rid}`)).data?.item;
  check("relleno suma a cantidad_actual y el maximo nunca queda por debajo", Number(relleno?.cantidad_actual) === 9 && Number(relleno?.stock_maximo) === 9 && Number(relleno?.restante_190126) === 7, JSON.stringify([relleno?.cantidad_actual, relleno?.stock_maximo, relleno?.restante_190126]));
  await api("POST", `/consumables/${cid}/refill`, { cantidad: 5, motivo: "Prueba relleno" });
  const crow2 = (await api("GET", "/consumables?search=Consumible prueba stock")).data?.items?.find((c) => c.id === cid);
  check("relleno de consumible suma unidades a la existencia; las piezas (empaque) no cambian", Number(crow2?.existencia) === 105 && Number(crow2?.piezas) === 10 && Number(crow2?.stock_maximo) === 105, JSON.stringify([crow2?.existencia, crow2?.piezas, crow2?.stock_maximo]));
  // El estado manual del equipo no contradice a Mantenimiento.
  const m3 = (await api("POST", "/inventory/mantenimientos", { id_equipo: eq, tipo: "correctivo", fecha_programada: "2026-09-25", estado: "programado" })).data?.id;
  await api("PUT", `/inventory/equipos/${eq}`, { nombre: "Equipo prueba sync", clave_bitacora: "FX-TCB-ZZ1", estado: "operativo" });
  check("editar el equipo como operativo con pendiente lo deja en mantenimiento", (await estadoDe()) === "mantenimiento");
  await api("DELETE", `/inventory/mantenimientos/${m3}`, { motivo: "Prueba de sincronizacion" });
  await api("PUT", `/inventory/equipos/${eq}`, { nombre: "Equipo prueba sync", clave_bitacora: "FX-TCB-ZZ1", estado: "calibracion_pendiente" });
  const m4 = (await api("POST", "/inventory/mantenimientos", { id_equipo: eq, tipo: "calibracion", fecha_programada: "2026-09-10", fecha_realizado: "2026-09-10", estado: "completado", proxima_calibracion: "2027-09-10" })).data?.id;
  check("calibracion completada levanta la calibracion pendiente manual", !!m4 && (await estadoDe()) === "operativo");
  // Los contadores del inicio usan las mismas reglas que las listas.
  const summary = (await api("GET", "/inventory/summary")).data || {};
  const reactivos = (await api("GET", "/inventory/reactivos?search=")).data?.items || [];
  const low = reactivos.filter((r) => {
    const cur = Number(r.cantidad_actual ?? NaN);
    const min = Number(r.stock_minimo || 0);
    const max = Number(r.stock_maximo || 0);
    if (Number.isNaN(cur)) return false;
    return cur <= 0 || (min > 0 && cur <= min) || (min <= 0 && max > 0 && cur / max <= 0.2);
  }).length;
  check("aviso 'reactivos con stock bajo' coincide con la lista", Number(summary.reactivos_stock_bajo) === low, `resumen=${summary.reactivos_stock_bajo} lista=${low}`);

  /* ---------- Inicio: flujo en curso y avisos con detalle ---------- */
  const enCurso = await api("GET", "/inicio/en-curso");
  const flujo = enCurso.data?.items || [];
  check("inicio/en-curso responde con recepciones en curso", enCurso.status === 200 && Array.isArray(flujo), `status ${enCurso.status} items=${flujo.length}`);
  const conPasos = flujo.every((f) => Array.isArray(f.pasos) && f.pasos.length === 5 && f.siguiente?.href && f.siguiente?.label);
  check("cada recepcion en curso trae 5 etapas y un siguiente paso con enlace", flujo.length === 0 || conPasos, JSON.stringify(flujo[0]?.siguiente));
  const cerradas = flujo.filter((f) => ["cerrada", "anulada", "rechazada"].includes(f.estado)).length;
  check("las recepciones cerradas, anuladas o rechazadas no aparecen en curso", cerradas === 0);
  const avisosRes = await api("GET", "/inicio/avisos");
  const avisos = avisosRes.data?.items || [];
  check("inicio/avisos responde", avisosRes.status === 200 && Array.isArray(avisos), `status ${avisosRes.status}`);
  const bajos = avisos.find((a) => a.key === "reactivos_bajos");
  check("aviso de reactivos bajos coincide con el resumen y trae detalle", (Number(summary.reactivos_stock_bajo) === 0 && !bajos) || (!!bajos && bajos.count === Number(summary.reactivos_stock_bajo) && bajos.items.length > 0 && !!bajos.items[0].href), `aviso=${bajos?.count} resumen=${summary.reactivos_stock_bajo}`);
  check("todos los avisos tienen cuenta > 0, enlace y elementos", avisos.every((a) => a.count > 0 && a.href && Array.isArray(a.items) && a.items.length > 0 && a.items.length <= 6));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} pruebas OK`);
process.exit(failed.length ? 1 : 0);
