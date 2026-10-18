import { formatearFolio } from "../../../shared/folios";
import { conSolicitudesYPuede } from "../../puede-registro";
import { requireUser, userIdFromClaims, type CurrentUser } from "../../auth";
import { incidenciaPorDecisionRecepcion } from "../calidad/automaticas";
import { actorDe } from "../calidad/comun";
import { registrarAuditoria, snapshotRow } from "../../audit";
import { type Row, type Session } from "../../db";
import { HttpError, intParam, json, readJson, type RouteContext } from "../../http";
import { cargoActuante, permisoDe, requirePermission, soloEstado, type Permiso } from "../../rbac";
import { exigirReauth } from "../../seguridad";
import { crearSolicitud, detalleSolicitud, exigirSinSolicitudPendiente, respuestaSolicitud, serializarSolicitud, type ContextoEjecucion } from "../../solicitudes";
import { aplicarSupervision, exigirSinSupervisionPendiente, filtroSupervision, marcaSupervision } from "../../supervision";

import { anularOSolicitar, assertEditableAsync, deletionNotAllowed, folioLabel, isFolioConflict, nextFolioNum, readMotivo, restaurarOSolicitar } from "../../samples-flow";
import { ACCEPTANCE_DECISIONS, DISPOSAL_TYPES, RECEPTION_STATE_RANK } from "../../../shared/sgc";
import { jsonText, safeJsonLoad, searchParam, strippedOrNull, toIntOrNull } from "../helpers";

import { exigirAutorizaciones } from "../../autorizaciones";
import { requisitosRecepcion } from "../../../shared/autorizaciones";
import { exigirVistaAsignada, filtroAsignadas, soloAsignado } from "../../asignaciones";
import { guardarFirmantes, resolverFirmantes, verificarFirmasConPassword, type RolFirma } from "../../firmas";

/*
 * Portado de modules/samples/recepcion.py del backend Flask original.
 *
 * Agregados (FX-MC 7.4.3 y 7.4.4): decision de aceptacion de la muestra con
 * comunicacion al cliente, disposicion final de remanentes (cierra la
 * muestra), anulacion con motivo en lugar de borrado y bitacora de auditoria.
 */

const TABLE = "muestras_recepcion";

/* Fase 5: quien recibio se elige de las cuentas activas. */
const FIRMAS_RECEPCION: RolFirma[] = [{ rol: "recibio", columnaNombre: "recibido_por", etiqueta: "Recibió" }];

/*
 * Alcance "estado" (muestras:V): solo folio, solicitante, fechas y estado; sin
 * datos tecnicos, resultados ni firmas.
 */
const CAMPOS_ESTADO = ["id", "folio_num", "tipo_registro", "solicitante", "fecha_emision", "fecha_recepcion", "hora_recepcion", "fecha_muestra", "estado", "creado_en", "anulado_en"];

function vistaEstado(row: Row): Row {
  const out: Row = { solo_estado: true };
  for (const campo of CAMPOS_ESTADO) if (campo in row) out[campo] = row[campo];
  return out;
}

function serializeRow(row: Row): Row {
  const item: Row = { ...row };
  item.lote_muestras = safeJsonLoad(item.lote_muestras_json, []);
  delete item.lote_muestras_json;
  item.analisis = safeJsonLoad(item.analisis_json, {});
  delete item.analisis_json;
  item.inspeccion = safeJsonLoad(item.inspeccion_json, {});
  delete item.inspeccion_json;
  item.datos_solicitante = safeJsonLoad(item.datos_solicitante_json, {});
  delete item.datos_solicitante_json;
  item.datos_custodio = safeJsonLoad(item.datos_custodio_json, {});
  delete item.datos_custodio_json;
  item.aceptacion = safeJsonLoad(item.aceptacion_json, {});
  delete item.aceptacion_json;
  item.disposicion = safeJsonLoad(item.disposicion_json, null);
  delete item.disposicion_json;
  return item;
}

const DECISIONS = new Set(ACCEPTANCE_DECISIONS.map((item) => item.value));

function normalizeAceptacion(raw: unknown): Record<string, unknown> {
  const value = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const comunicacion = (value.comunicacion_cliente && typeof value.comunicacion_cliente === "object" ? value.comunicacion_cliente : {}) as Record<string, unknown>;
  return {
    fecha: strippedOrNull(value.fecha, 10),
    responsable: strippedOrNull(value.responsable, 180),
    temperatura_llegada: strippedOrNull(value.temperatura_llegada, 20),
    observaciones: strippedOrNull(value.observaciones),
    comunicacion_cliente: {
      requerida: !!comunicacion.requerida,
      fecha: strippedOrNull(comunicacion.fecha, 10),
      medio: strippedOrNull(comunicacion.medio, 60),
      persona: strippedOrNull(comunicacion.persona, 180),
      respuesta: strippedOrNull(comunicacion.respuesta),
    },
  };
}

function normalizePayload(raw: Record<string, unknown>) {
  const payload = raw || {};
  const decision = String(payload.decision_aceptacion || "").trim();
  return {
    folio_num: toIntOrNull(payload.folio_num),
    tipo_registro: String(payload.tipo_registro || "R").trim().slice(0, 2),
    clave_revision: String(payload.clave_revision || "FX-TCF-GMR").trim().slice(0, 50),
    fecha_emision: payload.fecha_emision || null,
    fecha_recepcion: payload.fecha_recepcion || null,
    hora_recepcion: strippedOrNull(payload.hora_recepcion, 20),
    recibido_por: strippedOrNull(payload.recibido_por, 150),
    medio_recepcion: strippedOrNull(payload.medio_recepcion, 50),
    solicitante: strippedOrNull(payload.solicitante, 180),
    muestra_unica: payload.muestra_unica ? 1 : 0,
    fecha_muestra: payload.fecha_muestra || null,
    id_interno: strippedOrNull(payload.id_interno, 100),
    especificaciones: strippedOrNull(payload.especificaciones),
    lote_muestras_json: jsonText(payload.lote_muestras || []),
    analisis_json: jsonText(payload.analisis || {}),
    inspeccion_json: jsonText(payload.inspeccion || {}),
    datos_solicitante_json: jsonText(payload.datos_solicitante || {}),
    datos_custodio_json: jsonText(payload.datos_custodio || {}),
    decision_aceptacion: DECISIONS.has(decision) ? decision : null,
    aceptacion_json: jsonText(normalizeAceptacion(payload.aceptacion)),
    estado: String(payload.estado || "registrada").trim().slice(0, 30) || "registrada",
  };
}

type ReceptionData = ReturnType<typeof normalizePayload>;

/*
 * Reglas de aceptacion (FX-MC 7.4.3): para decidir hay que haber completado
 * la inspeccion visual; con algun requisito "NC" la muestra no puede quedar
 * como aceptada sin desviacion.
 */
function validateAcceptance(data: ReceptionData): string | null {
  if (!data.decision_aceptacion) return null;
  const inspeccion = safeJsonLoad<{ checklist?: Array<{ estado?: string }> }>(data.inspeccion_json, {});
  const checklist = Array.isArray(inspeccion.checklist) ? inspeccion.checklist : [];
  if (!checklist.length || checklist.some((row) => !row || !String(row.estado || "").trim())) {
    return "Para registrar la decision de aceptacion completa toda la inspeccion visual (C, NC o NA en cada requisito)";
  }
  const hasNc = checklist.some((row) => String(row.estado || "").toUpperCase() === "NC");
  if (hasNc && data.decision_aceptacion === "aceptada") {
    return "Hay requisitos que no cumplen (NC): la muestra solo puede aceptarse con desviacion o rechazarse";
  }
  const aceptacion = safeJsonLoad<{ comunicacion_cliente?: { fecha?: string; medio?: string } }>(data.aceptacion_json, {});
  if (data.decision_aceptacion !== "aceptada") {
    const comunicacion = aceptacion.comunicacion_cliente || {};
    if (!comunicacion.fecha || !comunicacion.medio) {
      return "Registra la comunicacion al cliente (fecha y medio) de la desviacion o el rechazo";
    }
  }
  return null;
}

/* El estado lo maneja el flujo; el cliente solo puede pedir estados manuales validos. */
function resolveState(stored: Row | null, data: ReceptionData): string {
  const current = stored ? String(stored.estado || "registrada") : "registrada";
  if (current === "anulada") return current;
  // Fase 5: los estados que avanza el flujo (en_procesamiento ... cerrada) no se retroceden desde el formato.
  if ((RECEPTION_STATE_RANK[current] ?? 0) >= 2) return current;
  if (data.decision_aceptacion === "rechazada") return "rechazada";
  if (data.decision_aceptacion === "aceptada_con_desviacion") return "aceptada_con_desviacion";
  if (data.decision_aceptacion) return "aceptada";
  // Fase 3: una decision ya registrada no se quita editando (volveria a "registrada" y se anularia sin segundo usuario).
  if (current === "aceptada" || current === "aceptada_con_desviacion" || current === "rechazada") throw new HttpError(409, { message: "La decisión de aceptación ya quedó registrada; se puede cambiar, pero no quitar", codigo: "decision_registrada" });
  return "registrada";
}

export async function getNextFolio({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await requirePermission(s, user, "muestras", "V");
  return json({ next_folio: await nextFolioNum(s, TABLE) });
}

export async function listReceptionSamples({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "muestras", "V");

  const search = searchParam(request, "search");
  const includeAnuladas = searchParam(request, "anuladas") === "1";
  const supFiltro = filtroSupervision(request, "", permiso.auth.userId);
  // Fase 5: alcance "asignado" (solo lo asignado o registrado por la persona) y filtro "Mis muestras".
  const asignadas = await filtroAsignadas(s, permiso.auth.userId, "id", soloAsignado(permiso) || searchParam(request, "mias") === "1", "creado_por");
  const rows = await s.query(
    `
    SELECT id, folio_num, tipo_registro, clave_revision, fecha_emision,
           fecha_recepcion, hora_recepcion, recibido_por, medio_recepcion,
           solicitante, id_interno, muestra_unica, analisis_json, decision_aceptacion,
           estado, motivo_anulacion, anulado_en, creado_en, supervision_estado, supervisor_id
    FROM muestras_recepcion
    WHERE (:incluir_anuladas = 1 OR estado <> 'anulada')
      ${supFiltro.sql}
      ${asignadas.sql}
      AND (:search = ''
       OR solicitante LIKE :search_like
       OR recibido_por LIKE :search_like
       OR id_interno LIKE :search_like
       OR CAST(folio_num AS CHAR) LIKE :search_like)
    ORDER BY folio_num DESC
    LIMIT 400
    `,
    { search, search_like: `%${search}%`, incluir_anuladas: includeAnuladas ? 1 : 0, ...supFiltro.params, ...asignadas.params },
  );
  return json({
    items: (await conSolicitudesYPuede(s, user, TABLE, rows)).map((row) => {
      if (soloEstado(permiso)) return vistaEstado(row);
      const item: Row = { ...row, analisis: safeJsonLoad(row.analisis_json, {}) };
      delete item.analisis_json;
      return item;
    }),
    total: rows.length,
  });
}

export async function getReceptionSample({ request, s, params }: RouteContext): Promise<Response> {
  const sampleId = intParam(params.id);
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "muestras", "V");

  const row = await s.queryOne(`SELECT * FROM ${TABLE} WHERE id = :id`, { id: sampleId });
  if (!row) {
    return json({ message: "Registro no encontrado" }, 404);
  }
  await exigirVistaAsignada(s, permiso, row);
  if (soloEstado(permiso)) return json({ item: vistaEstado(row) });
  // Etapas derivadas, para mostrar la cadena completa desde la recepcion.
  const procesamientos = await s.query("SELECT id, folio_num, estado FROM muestras_procesamiento WHERE recepcion_id = :id ORDER BY folio_num", { id: sampleId });
  return json({ item: { ...(await conSolicitudesYPuede(s, user, TABLE, [serializeRow(row)]))[0], procesamientos } });
}

export async function createReceptionSample({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "muestras", "C", { objeto: "recepcion", borrador: true });
  const actuo = cargoActuante(request, permiso);
  const supervision = marcaSupervision(permiso);

  const payload = await readJson(request);
  // Contraseñas de firmantes enviadas al guardar: se verifican antes de cualquier otra escritura.
  await verificarFirmasConPassword(s, user, payload);
  const data = normalizePayload(payload);
  // Fase 4: autorizacion FX-THF-AP de quien captura.
  await exigirAutorizaciones(s, user, requisitosRecepcion());
  if (!data.solicitante) return json({ message: "Indica el solicitante" }, 400);
  if (!data.folio_num) {
    data.folio_num = await nextFolioNum(s, TABLE);
  }
  const invalid = validateAcceptance(data);
  if (invalid) return json({ message: invalid }, 400);
  // Fase 5: rechazo o aceptacion con desviacion los autoriza la Coord. Tecnica (muestras:A).
  const decision = await decisionConAutorizacion(s, request, user, permiso, data, null);
  data.estado = resolveState(null, data);
  // Fase 5: firmas ligadas a cuentas.
  await resolverFirmantes(s, user, payload, data, FIRMAS_RECEPCION, null);
  const userId = userIdFromClaims(user);

  try {
    const result = await s.execute(
      `
      INSERT INTO muestras_recepcion (
        folio_num, tipo_registro, clave_revision, fecha_emision,
          fecha_recepcion, hora_recepcion, recibido_por, medio_recepcion,
          solicitante, muestra_unica,
        fecha_muestra, id_interno, especificaciones,
        lote_muestras_json, analisis_json, inspeccion_json,
        datos_solicitante_json, datos_custodio_json,
        decision_aceptacion, aceptacion_json, estado,
        creado_por, actualizado_por, creado_rol_id, creado_cargo
      ) VALUES (
        :folio_num, :tipo_registro, :clave_revision, :fecha_emision,
          :fecha_recepcion, :hora_recepcion, :recibido_por, :medio_recepcion,
          :solicitante, :muestra_unica,
        :fecha_muestra, :id_interno, :especificaciones,
        :lote_muestras_json, :analisis_json, :inspeccion_json,
        :datos_solicitante_json, :datos_custodio_json,
        :decision_aceptacion, :aceptacion_json, :estado,
        :creado_por, :actualizado_por, :creado_rol_id, :creado_cargo
      )
      `,
      { ...data, creado_por: userId, actualizado_por: userId, creado_rol_id: actuo.rol_id, creado_cargo: actuo.cargo },
    );
    const id = result.lastrowid as number;
    await aplicarSupervision(s, TABLE, id, supervision, userId);
    await guardarFirmantes(s, TABLE, id, data, FIRMAS_RECEPCION);
    const despues = await snapshotRow(s, TABLE, id);
    await registrarAuditoria(s, user, { accion: "crear", entidad: TABLE, entidadId: id, referencia: folioLabel(TABLE, despues), despues, detalle: { actuo_como: actuo } });
    if (data.decision_aceptacion) {
      await registrarAuditoria(s, user, { accion: data.decision_aceptacion === "rechazada" ? "rechazar" : "aceptar", entidad: TABLE, entidadId: id, referencia: folioLabel(TABLE, despues), detalle: { decision: data.decision_aceptacion } });
      // Fase 11: aceptada con desviacion o rechazada -> incidencia automatica.
      await incidenciaPorDecisionRecepcion(s, user, despues!, folioLabel(TABLE, despues), String(data.decision_aceptacion), actuo.cargo);
    }
    const solicitud = decision ? await crearSolicitud(s, user, { tipo: "decision_recepcion", entidad: TABLE, entidadId: id, referencia: folioLabel(TABLE, despues), accion: decision.decision, datos: decision, motivo: decision.motivo, cargo: actuo.cargo }) : null;
    await s.commit();
    if (solicitud) return json({ message: `Recepcion de muestra creada; la decision "${etiquetaDecision(solicitud.accion)}" queda pendiente de la Coord. Tecnica (solicitud #${solicitud.id})`, id, estado: data.estado, solicitud: serializarSolicitud(solicitud), codigo: "solicitud_creada" }, 201);
    return json({ message: "Recepcion de muestra creada", id, estado: data.estado }, 201);
  } catch (error) {
    await s.rollback();
    // Fase 12: si el folio lo asigno el servidor, el choque es de concurrencia: se relanza y apiRoute reintenta.
    if (isFolioConflict(error) && toIntOrNull(payload.folio_num)) {
      return json({ message: "El folio ya existe" }, 409);
    }
    throw error;
  }
}

export async function updateReceptionSample({ request, s, params }: RouteContext): Promise<Response> {
  const sampleId = intParam(params.id);
  const user = await requireUser(request);

  const antes = await snapshotRow(s, TABLE, sampleId);
  const permiso = await requirePermission(s, user, "muestras", "E", { objeto: "recepcion", borrador: String(antes?.estado || "registrada") === "registrada" });
  const actuo = cargoActuante(request, permiso);
  const supervision = marcaSupervision(permiso);
  await assertEditableAsync(s, antes, TABLE);
  // Fase 5: con alcance "asignado" solo se edita lo asignado (o registrado por la persona).
  if (antes) await exigirVistaAsignada(s, permiso, antes);
  const payload = await readJson(request);
  // Contraseñas de firmantes enviadas al guardar: se verifican antes de cualquier otra escritura.
  await verificarFirmasConPassword(s, user, payload);
  const data = normalizePayload(payload);
  // Fase 4: autorizacion FX-THF-AP de quien captura.
  await exigirAutorizaciones(s, user, requisitosRecepcion());
  if (!data.folio_num) {
    return json({ message: "El folio es obligatorio" }, 400);
  }
  // Campo 3 del formato FX-TCF-GMR: obligatorio al guardar (las recepciones anteriores sin él se abren igual).
  if (!data.solicitante) return json({ message: "Indica el solicitante" }, 400);
  // Fase 5: el folio ya no se edita; cambiarlo requiere solicitud (POST /folio).
  if (antes && Number(data.folio_num) !== Number(antes.folio_num)) return json({ message: "El folio de la recepción ya no se edita; usa \"Cambiar folio\" (requiere motivo y autorización de la Coord. Técnica)", codigo: "folio_bloqueado" }, 409);
  const invalid = validateAcceptance(data);
  if (invalid) return json({ message: invalid }, 400);
  const decision = await decisionConAutorizacion(s, request, user, permiso, data, antes);
  data.estado = resolveState(antes, data);
  await resolverFirmantes(s, user, payload, data, FIRMAS_RECEPCION, antes);
  const userId = userIdFromClaims(user);

  try {
    const result = await s.execute(
      `
      UPDATE muestras_recepcion
      SET folio_num = :folio_num,
        tipo_registro = :tipo_registro,
        clave_revision = :clave_revision,
        fecha_emision = :fecha_emision,
        fecha_recepcion = :fecha_recepcion,
        hora_recepcion = :hora_recepcion,
        recibido_por = :recibido_por,
        medio_recepcion = :medio_recepcion,
        solicitante = :solicitante,
        muestra_unica = :muestra_unica,
        fecha_muestra = :fecha_muestra,
        id_interno = :id_interno,
        especificaciones = :especificaciones,
        lote_muestras_json = :lote_muestras_json,
        analisis_json = :analisis_json,
        inspeccion_json = :inspeccion_json,
        datos_solicitante_json = :datos_solicitante_json,
        datos_custodio_json = :datos_custodio_json,
        decision_aceptacion = :decision_aceptacion,
        aceptacion_json = :aceptacion_json,
        estado = :estado,
        actualizado_por = :actualizado_por
      WHERE id = :id
      `,
      { ...data, id: sampleId, actualizado_por: userId },
    );
    if (result.rowcount === 0) {
      await s.rollback();
      return json({ message: "Registro no encontrado" }, 404);
    }
    await aplicarSupervision(s, TABLE, sampleId, supervision, userId);
    await guardarFirmantes(s, TABLE, sampleId, data, FIRMAS_RECEPCION);
    const despues = await snapshotRow(s, TABLE, sampleId);
    await registrarAuditoria(s, user, { accion: "editar", entidad: TABLE, entidadId: sampleId, referencia: folioLabel(TABLE, despues), antes, despues, detalle: { actuo_como: actuo } });
    if (data.decision_aceptacion && data.decision_aceptacion !== String(antes?.decision_aceptacion || "")) {
      await registrarAuditoria(s, user, { accion: data.decision_aceptacion === "rechazada" ? "rechazar" : "aceptar", entidad: TABLE, entidadId: sampleId, referencia: folioLabel(TABLE, despues), detalle: { decision: data.decision_aceptacion } });
      await incidenciaPorDecisionRecepcion(s, user, despues!, folioLabel(TABLE, despues), String(data.decision_aceptacion), actuo.cargo);
    }
    const solicitud = decision ? await crearSolicitud(s, user, { tipo: "decision_recepcion", entidad: TABLE, entidadId: sampleId, referencia: folioLabel(TABLE, despues), accion: decision.decision, datos: decision, motivo: decision.motivo, cargo: actuo.cargo }) : null;
    await s.commit();
    if (solicitud) return respuestaSolicitud(solicitud, `la decisión "${etiquetaDecision(solicitud.accion)}" de ${solicitud.referencia}`);
    return json({ message: "Recepcion de muestra actualizada", estado: data.estado });
  } catch (error) {
    await s.rollback();
    if (isFolioConflict(error)) {
      return json({ message: "El folio ya existe" }, 409);
    }
    throw error;
  }
}

/* Los registros tecnicos no se eliminan; el endpoint se conserva para responder 405 con la regla. */
export async function deleteReceptionSample({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await requirePermission(s, user, "muestras", "AN");
  return deletionNotAllowed();
}

export async function anularReceptionSample({ request, s, params }: RouteContext): Promise<Response> {
  const sampleId = intParam(params.id);
  const user = await requireUser(request);
  const actuo = cargoActuante(request, await requirePermission(s, user, "muestras", "AN"));
  const motivo = await readMotivo(request);
  await exigirReauth(s, request, user, "muestras:AN");
  const { row, solicitud } = await anularOSolicitar(s, user, TABLE, sampleId, motivo, actuo);
  await s.commit();
  if (solicitud) return respuestaSolicitud(solicitud, `la anulación de la recepción ${solicitud.referencia}`);
  return json({ message: "Recepcion anulada", item: serializeRow(row!) });
}

export async function restaurarReceptionSample({ request, s, params }: RouteContext): Promise<Response> {
  const sampleId = intParam(params.id);
  const user = await requireUser(request);
  const actuo = cargoActuante(request, await requirePermission(s, user, "muestras", "AN"));
  await exigirReauth(s, request, user, "muestras:AN");
  const { row, solicitud } = await restaurarOSolicitar(s, user, TABLE, sampleId, await readMotivo(request), actuo);
  await s.commit();
  if (solicitud) return respuestaSolicitud(solicitud, `la restauración de la recepción ${solicitud.referencia}`);
  return json({ message: "Recepcion restaurada", item: serializeRow(row!) });
}

const DISPOSALS = new Set(DISPOSAL_TYPES.map((item) => item.value));

/* Disposicion final de remanentes: cierra la muestra (FX-MC 7.4.4). */
export async function registrarDisposicion({ request, s, params }: RouteContext): Promise<Response> {
  const sampleId = intParam(params.id);
  const user = await requireUser(request);
  const actuo = cargoActuante(request, await requirePermission(s, user, "muestras", "A"));

  const antes = await snapshotRow(s, TABLE, sampleId);
  if (!antes) return json({ message: "Recepcion no encontrada" }, 404);
  // Una muestra rechazada tambien se dispone (p. ej. se devuelve al cliente); una cerrada o anulada ya no.
  if (["cerrada", "anulada"].includes(String(antes.estado))) return json({ message: `La recepcion ${folioLabel(TABLE, antes)} ya esta ${antes.estado}; no admite otra disposicion` }, 409);
  exigirSinSupervisionPendiente(antes, `La recepcion ${folioLabel(TABLE, antes)}`, "cerrar");
  await exigirSinSolicitudPendiente(s, TABLE, sampleId, `La recepcion ${folioLabel(TABLE, antes)}`, "cerrar");
  const payload = await readJson(request);
  const tipo = String(payload.tipo || "").trim();
  if (!DISPOSALS.has(tipo)) return json({ message: "Selecciona el tipo de disposicion final" }, 400);
  const fecha = strippedOrNull(payload.fecha, 10);
  const responsable = strippedOrNull(payload.responsable, 180);
  if (!fecha || !responsable) return json({ message: "La fecha y el responsable de la disposicion son obligatorios" }, 400);
  await exigirReauth(s, request, user, "muestras:A");
  const disposicion = {
    tipo,
    tipo_otro: tipo === "otro" ? strippedOrNull(payload.tipo_otro, 120) : null,
    fecha,
    responsable,
    firma: strippedOrNull(payload.firma),
    remanentes: strippedOrNull(payload.remanentes),
    observaciones: strippedOrNull(payload.observaciones),
    registrado_por: userIdFromClaims(user),
    registrado_rol_id: actuo.rol_id,
    registrado_cargo: actuo.cargo,
    registrado_en: new Date().toISOString(),
  };
  await s.execute(`UPDATE ${TABLE} SET disposicion_json = :disposicion, estado_antes_cierre = :previo, estado = 'cerrada', actualizado_por = :usuario WHERE id = :id`, { disposicion: jsonText(disposicion), previo: String(antes.estado || ""), usuario: userIdFromClaims(user), id: sampleId });
  const despues = await snapshotRow(s, TABLE, sampleId);
  await registrarAuditoria(s, user, { accion: "cerrar", entidad: TABLE, entidadId: sampleId, referencia: folioLabel(TABLE, despues), antes, despues, detalle: { disposicion: tipo, actuo_como: actuo } });
  await s.commit();
  return json({ message: "Disposicion final registrada; la muestra queda cerrada", item: serializeRow(despues || antes!) });
}

/* ---------- Fase 5: decisiones que autoriza la Coord. Tecnica ---------- */

const DECISIONES_CRITICAS = new Set(["rechazada", "aceptada_con_desviacion"]);
const etiquetaDecision = (decision: string) => ACCEPTANCE_DECISIONS.find((d) => d.value === decision)?.label || decision;

/*
 * Rechazo o aceptacion con desviacion: si quien la registra tiene muestras:A se
 * aplica directo (con reautenticacion); si no, el registro se guarda sin esa
 * decision y se devuelve lo necesario para crear la solicitud.
 */
async function decisionConAutorizacion(s: Session, request: Request, user: CurrentUser, permiso: Permiso, data: ReceptionData, antes: Row | null): Promise<{ decision: string; aceptacion_json: string | null; motivo: string } | null> {
  const nueva = String(data.decision_aceptacion || "");
  if (!DECISIONES_CRITICAS.has(nueva) || nueva === String(antes?.decision_aceptacion || "")) return null;
  if (permisoDe(permiso.auth, "muestras", "A")) {
    await exigirReauth(s, request, user, "muestras:A");
    return null;
  }
  const pedida = { decision: nueva, aceptacion_json: data.aceptacion_json, motivo: `Decisión de la recepción: ${etiquetaDecision(nueva)}` };
  data.decision_aceptacion = (antes?.decision_aceptacion as string | null) || null;
  data.aceptacion_json = String(antes?.aceptacion_json || jsonText({}));
  return pedida;
}

async function recepcionOError(s: Session, id: number): Promise<Row> {
  const row = await snapshotRow(s, TABLE, id);
  if (!row) throw new HttpError(404, { message: "Recepción no encontrada" });
  return row;
}

/* Ejecutor: aplica la decision aprobada por la Coord. Tecnica. */
export async function ejecutarDecisionRecepcion(ctx: ContextoEjecucion): Promise<Record<string, unknown>> {
  const antes = await recepcionOError(ctx.s, Number(ctx.solicitud.entidad_id));
  if ((RECEPTION_STATE_RANK[String(antes.estado)] ?? 0) >= 2 || String(antes.estado) === "anulada") throw new HttpError(409, { message: `La recepción ${folioLabel(TABLE, antes)} ya avanzó; la decisión no se aplica` });
  const decision = String(ctx.datos.decision || "");
  await ctx.s.execute(`UPDATE ${TABLE} SET decision_aceptacion = :decision, aceptacion_json = COALESCE(:aceptacion, aceptacion_json), estado = :estado WHERE id = :id`, { decision, aceptacion: (ctx.datos.aceptacion_json as string | null) || null, estado: decision, id: antes.id });
  const despues = await snapshotRow(ctx.s, TABLE, Number(antes.id));
  await registrarAuditoria(ctx.s, ctx.user, { accion: decision === "rechazada" ? "rechazar" : "aceptar", entidad: TABLE, entidadId: Number(antes.id), referencia: folioLabel(TABLE, antes), antes, despues, motivo: ctx.motivo, detalle: { decision, actuo_como: ctx.actuo, ...detalleSolicitud(ctx.solicitud) } });
  // Fase 11: la incidencia automatica la reporta quien tomo la decision (el solicitante), no quien la aprobo.
  await incidenciaPorDecisionRecepcion(ctx.s, (await actorDe(ctx.s, Number(ctx.solicitud.solicitado_por))) || ctx.user, despues!, folioLabel(TABLE, antes), decision, ctx.solicitud.rol ? String(ctx.solicitud.rol) : null);
  return { item: serializeRow(despues!) };
}

async function aplicarCambioFolio(s: Session, user: CurrentUser, antes: Row, folio: number, motivo: string, detalle: Record<string, unknown>): Promise<Row> {
  if (await s.scalar(`SELECT id FROM ${TABLE} WHERE folio_num = :folio AND id <> :id`, { folio, id: antes.id })) throw new HttpError(409, { message: `El folio ${formatearFolio("R", folio)} ya existe` });
  await s.execute(`UPDATE ${TABLE} SET folio_num = :folio WHERE id = :id`, { folio, id: antes.id });
  const despues = (await snapshotRow(s, TABLE, Number(antes.id)))!;
  await registrarAuditoria(s, user, { accion: "cambiar_folio", entidad: TABLE, entidadId: Number(antes.id), referencia: folioLabel(TABLE, despues), antes, despues, motivo, detalle: { folio_anterior: antes.folio_num, folio_nuevo: folio, ...detalle } });
  return despues;
}

export async function ejecutarCambioFolio(ctx: ContextoEjecucion): Promise<Record<string, unknown>> {
  const antes = await recepcionOError(ctx.s, Number(ctx.solicitud.entidad_id));
  const despues = await aplicarCambioFolio(ctx.s, ctx.user, antes, Number(ctx.datos.folio_num), ctx.solicitud.motivo, { actuo_como: ctx.actuo, ...detalleSolicitud(ctx.solicitud) });
  return { item: serializeRow(despues) };
}

async function aplicarReapertura(s: Session, user: CurrentUser, antes: Row, motivo: string, detalle: Record<string, unknown>): Promise<Row> {
  const actual = String(antes.estado || "");
  if (!["cerrada", "rechazada"].includes(actual)) throw new HttpError(409, { message: `Solo se reabre una recepción cerrada o rechazada (está "${actual}")` });
  // Rechazada -> registrada (sin decision, para decidir de nuevo); cerrada -> el estado en que se cerro.
  const previo = actual === "rechazada" ? "registrada" : String(antes.estado_antes_cierre || "liberada");
  await s.execute(`UPDATE ${TABLE} SET estado = :previo${actual === "rechazada" ? ", decision_aceptacion = NULL" : ""} WHERE id = :id`, { previo, id: antes.id });
  const despues = (await snapshotRow(s, TABLE, Number(antes.id)))!;
  await registrarAuditoria(s, user, { accion: "reabrir", entidad: TABLE, entidadId: Number(antes.id), referencia: folioLabel(TABLE, despues), antes, despues, motivo, detalle: { de: actual, a: previo, ...detalle } });
  return despues;
}

export async function ejecutarReapertura(ctx: ContextoEjecucion): Promise<Record<string, unknown>> {
  const antes = await recepcionOError(ctx.s, Number(ctx.solicitud.entidad_id));
  const despues = await aplicarReapertura(ctx.s, ctx.user, antes, ctx.solicitud.motivo, { actuo_como: ctx.actuo, ...detalleSolicitud(ctx.solicitud) });
  return { item: serializeRow(despues) };
}

/* POST /api/samples/reception/:id/folio { folio_num, motivo }: directo con muestras:A; si no, solicitud. */
export async function cambiarFolioRecepcion({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "muestras", "E", { objeto: "recepcion" });
  const actuo = cargoActuante(request, permiso);
  const antes = await recepcionOError(s, intParam(params.id));
  await exigirVistaAsignada(s, permiso, antes);
  await exigirSinSolicitudPendiente(s, TABLE, Number(antes.id), `La recepción ${folioLabel(TABLE, antes)}`, "cambiar el folio");
  const payload = await readJson(request);
  const folio = toIntOrNull(payload.folio_num);
  const motivo = String(payload.motivo || "").trim();
  if (!folio || folio < 1) return json({ message: "Indica el folio nuevo" }, 400);
  if (folio === Number(antes.folio_num)) return json({ message: "El folio nuevo es igual al actual" }, 400);
  if (motivo.length < 5) return json({ message: "Indica el motivo del cambio de folio (al menos 5 caracteres)" }, 400);
  if (permisoDe(permiso.auth, "muestras", "A")) {
    await exigirReauth(s, request, user, "muestras:A");
    const despues = await aplicarCambioFolio(s, user, antes, folio, motivo, { actuo_como: actuo });
    await s.commit();
    return json({ message: `Folio cambiado a ${folioLabel(TABLE, despues)}`, item: serializeRow(despues) });
  }
  await exigirReauth(s, request, user, "muestras:E");
  const solicitud = await crearSolicitud(s, user, { tipo: "cambiar_folio", entidad: TABLE, entidadId: Number(antes.id), referencia: folioLabel(TABLE, antes), accion: "cambiar_folio", datos: { folio_num: folio }, motivo, cargo: actuo.cargo });
  await s.commit();
  return respuestaSolicitud(solicitud, `el cambio de folio de ${solicitud.referencia} a ${formatearFolio("R", folio)}`);
}

/* POST /api/samples/reception/:id/reabrir { motivo }: directo con muestras:A; si no, solicitud. */
export async function reabrirRecepcion({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "muestras", "E", { objeto: "recepcion" });
  const actuo = cargoActuante(request, permiso);
  const antes = await recepcionOError(s, intParam(params.id));
  await exigirVistaAsignada(s, permiso, antes);
  if (!["cerrada", "rechazada"].includes(String(antes.estado))) return json({ message: "Solo se reabre una recepción cerrada o rechazada" }, 409);
  const motivo = String((await readJson(request)).motivo || "").trim();
  if (motivo.length < 5) return json({ message: "Indica el motivo de la reapertura (al menos 5 caracteres)" }, 400);
  if (permisoDe(permiso.auth, "muestras", "A")) {
    await exigirReauth(s, request, user, "muestras:A");
    const despues = await aplicarReapertura(s, user, antes, motivo, { actuo_como: actuo });
    await s.commit();
    return json({ message: `Recepción reabierta (${despues.estado})`, item: serializeRow(despues) });
  }
  await exigirReauth(s, request, user, "muestras:E");
  const solicitud = await crearSolicitud(s, user, { tipo: "reabrir_recepcion", entidad: TABLE, entidadId: Number(antes.id), referencia: folioLabel(TABLE, antes), accion: "reabrir", motivo, cargo: actuo.cargo });
  await s.commit();
  return respuestaSolicitud(solicitud, `la reapertura de ${solicitud.referencia}`);
}
