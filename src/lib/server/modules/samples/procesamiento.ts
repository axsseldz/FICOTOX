import { requireUser, userIdFromClaims, type CurrentUser } from "../../auth";
import { conSolicitudesYPuede } from "../../puede-registro";
import { registrarAuditoria, snapshotRow } from "../../audit";
import { type Row, type Session } from "../../db";
import { HttpError, intParam, json, readJson, type RouteContext } from "../../http";
import { cargoActuante, requirePermission } from "../../rbac";
import { exigirReauth } from "../../seguridad";
import { evaluarSupervisionCaptura } from "../../../shared/segregacion";
import { respuestaSolicitud } from "../../solicitudes";
import { aplicarSupervision, filtroSupervision, marcaSupervision } from "../../supervision";

import { advanceState, anularOSolicitar, applyStageInventory, assertEditableAsync, assertOrigin, deletionNotAllowed, exigirUsoDeRecursos, folioLabel, insumosDeclarados, isFolioConflict, nextFolioNum, readMotivo, replaceStageInventory, restaurarOSolicitar } from "../../samples-flow";
import { jsonText, safeJsonLoad, searchParam, strippedOrNull, toIntOrNull } from "../helpers";

import { exigirAutorizaciones } from "../../autorizaciones";
import { requisitosProcesamiento } from "../../../shared/autorizaciones";
import { exigirAsignacion, exigirEnsayoVisible, filtroAsignadas, soloAsignado } from "../../asignaciones";
import { guardarFirmantes, resolverFirmantes, verificarFirmasConPassword, type RolFirma } from "../../firmas";

/*
 * Portado de modules/samples/procesamiento.py del backend Flask original.
 * Agregados: reglas de flujo (solo desde recepciones aceptadas y vigentes),
 * anulacion con motivo, auditoria y avance automatico del estado de la recepcion.
 */

const TABLE = "muestras_procesamiento";

const ORIGEN_REQUERIDO = "El procesamiento debe partir de una recepción de muestra aceptada";

type ProcessingData = ReturnType<typeof normalizePayload>;

/* Regla 3 de segregacion: quien firma "superviso" no es quien proceso. */
/* Fase 5: quien proceso (trabajo tecnico: autorizacion de procesamiento) y quien superviso, de las cuentas activas. */
const FIRMAS_PROCESAMIENTO: RolFirma[] = [
  { rol: "proceso", columnaNombre: "nombre_quien_proceso", etiqueta: "Procesó", requisitos: requisitosProcesamiento() },
  { rol: "superviso", columnaNombre: "nombre_quien_superviso", etiqueta: "Supervisó" },
];

/* Regla 3: compara cuentas (usuario_id); sin cuenta ligada, los nombres escritos. */
function exigirSupervisorDistinto(data: { nombre_quien_proceso: string | null; nombre_quien_superviso: string | null } & Record<string, unknown>): void {
  const violacion = evaluarSupervisionCaptura(data.nombre_quien_superviso, [{ etiqueta: "procesó la muestra", nombre: data.nombre_quien_proceso, usuarioId: data.proceso_usuario_id }], data.superviso_usuario_id);
  if (violacion) throw new HttpError(409, { message: violacion.mensaje, codigo: "segregacion", regla: violacion.regla, clave: violacion.clave });
}

function normalizePayload(raw: Record<string, unknown>) {
  const payload = raw || {};
  return {
    folio_num: toIntOrNull(payload.folio_num),
    tipo_registro: String(payload.tipo_registro || "P").trim().slice(0, 2),
    clave_revision: String(payload.clave_revision || "FX-TCF-GMP").trim().slice(0, 50),
    fecha_emision: payload.fecha_emision || null,
    fecha_procesamiento: payload.fecha_procesamiento || null,
    hora_procesamiento: strippedOrNull(payload.hora_procesamiento, 20),
    recepcion_id: toIntOrNull(payload.recepcion_id),
    folio_recepcion_num: toIntOrNull(payload.folio_recepcion_num),
    muestra_tipo: strippedOrNull(payload.muestra_tipo, 20),
    id_interno: strippedOrNull(payload.id_interno, 100),
    lote_seleccion_json: jsonText(payload.lote_seleccion || []),
    tipo_organismo_json: jsonText(payload.tipo_organismo || []),
    parte_organismo_json: jsonText(payload.parte_organismo || []),
    tipo_organismo_otro: strippedOrNull(payload.tipo_organismo_otro, 180),
    parte_organismo_otro: strippedOrNull(payload.parte_organismo_otro, 180),
    bivalvos_steps_json: jsonText(payload.bivalvos_steps || []),
    sardinas_steps_json: jsonText(payload.sardinas_steps || []),
    otro_procesamiento: strippedOrNull(payload.otro_procesamiento),
    resguardo_json: jsonText(payload.resguardo || {}),
    observaciones_generales: strippedOrNull(payload.observaciones_generales),
    nombre_quien_proceso: strippedOrNull(payload.nombre_quien_proceso, 180),
    nombre_quien_superviso: strippedOrNull(payload.nombre_quien_superviso, 180),
    firma_quien_proceso: strippedOrNull(payload.firma_quien_proceso),
    firma_quien_superviso: strippedOrNull(payload.firma_quien_superviso),
    estado: String(payload.estado || "registrada").trim().slice(0, 30) || "registrada",
    uso_inventario_json: jsonText(payload.uso_inventario || []),
  };
}

async function replaceInventoryUsage(s: Session, user: CurrentUser, processingId: number, data: ProcessingData, referencia: string, declaradosAntes: Map<string, number>): Promise<void> {
  await replaceStageInventory(s, user, "PROC", processingId, data.uso_inventario_json, `Procesamiento de muestra folio ${data.folio_num}`, referencia, declaradosAntes);
}

function serializeRow(row: Row): Row {
  const item: Row = { ...row };
  item.tipo_organismo = safeJsonLoad(item.tipo_organismo_json, []);
  delete item.tipo_organismo_json;
  item.parte_organismo = safeJsonLoad(item.parte_organismo_json, []);
  delete item.parte_organismo_json;
  item.lote_seleccion = safeJsonLoad(item.lote_seleccion_json, []);
  delete item.lote_seleccion_json;
  item.bivalvos_steps = safeJsonLoad(item.bivalvos_steps_json, []);
  delete item.bivalvos_steps_json;
  item.sardinas_steps = safeJsonLoad(item.sardinas_steps_json, []);
  delete item.sardinas_steps_json;
  item.resguardo = safeJsonLoad(item.resguardo_json, {});
  delete item.resguardo_json;
  item.uso_inventario = safeJsonLoad(item.uso_inventario_json, []);
  delete item.uso_inventario_json;
  return item;
}

export async function getNextFolio({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await requirePermission(s, user, "ensayos", "V");
  return json({ next_folio: await nextFolioNum(s, TABLE) });
}

export async function listProcessingSamples({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "ensayos", "V");
  const supFiltro = filtroSupervision(request, "p", permiso.auth.userId);
  // Fase 5: filtro "Mis muestras"; con alcance "asignado", solo lo asignado o registrado por la persona.
  const restringida = soloAsignado(permiso);
  const asignadas = await filtroAsignadas(s, permiso.auth.userId, "p.recepcion_id", restringida || searchParam(request, "mias") === "1", "p.creado_por");

  const search = searchParam(request, "search");
  const includeAnuladas = searchParam(request, "anuladas") === "1";
  const rows = await s.query(
    `
    SELECT p.id, p.folio_num, p.tipo_registro, p.fecha_procesamiento,
           p.hora_procesamiento, p.recepcion_id, p.folio_recepcion_num, p.id_interno,
           p.muestra_tipo, p.tipo_organismo_json, p.estado, p.motivo_anulacion, p.anulado_en,
           p.nombre_quien_proceso, p.creado_en, p.supervision_estado, p.supervisor_id
    FROM muestras_procesamiento p
    WHERE (:incluir_anuladas = 1 OR p.estado <> 'anulada')
      ${supFiltro.sql}
      ${asignadas.sql}
      AND (:search = ''
       OR p.id_interno LIKE :search_like
       OR CAST(p.folio_num AS CHAR) LIKE :search_like
       OR CAST(COALESCE(p.folio_recepcion_num, 0) AS CHAR) LIKE :search_like)
    ORDER BY p.folio_num DESC
    LIMIT 400
    `,
    { search, search_like: `%${search}%`, incluir_anuladas: includeAnuladas ? 1 : 0, ...supFiltro.params, ...asignadas.params },
  );
  return json({
    items: (await conSolicitudesYPuede(s, user, TABLE, rows)).map((row) => {
      const item: Row = { ...row, tipo_organismo: safeJsonLoad(row.tipo_organismo_json, []) };
      delete item.tipo_organismo_json;
      return item;
    }),
    total: rows.length,
  });
}

export async function getProcessingSample({ request, s, params }: RouteContext): Promise<Response> {
  const processingId = intParam(params.id);
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "ensayos", "V");

  const row = await s.queryOne(
    `
    SELECT id, folio_num, tipo_registro, clave_revision, fecha_emision,
           fecha_procesamiento, hora_procesamiento, recepcion_id,
           folio_recepcion_num, muestra_tipo, id_interno,
           lote_seleccion_json,
           tipo_organismo_json, parte_organismo_json,
           bivalvos_steps_json, sardinas_steps_json,
           otro_procesamiento, resguardo_json,
           observaciones_generales, nombre_quien_proceso,
           nombre_quien_superviso, firma_quien_proceso,
           firma_quien_superviso, uso_inventario_json,
           proceso_usuario_id, proceso_cargo, superviso_usuario_id, superviso_cargo,
           estado, creado_por, creado_en, actualizado_en,
           requiere_supervision, supervision_estado, supervisor_id, supervision_observaciones
    FROM muestras_procesamiento
    WHERE id = :id
    `,
    { id: processingId },
  );
  if (!row) {
    return json({ message: "Registro no encontrado" }, 404);
  }
  await exigirEnsayoVisible(s, permiso, TABLE, row);
  return json({ item: (await conSolicitudesYPuede(s, user, TABLE, [serializeRow(row)]))[0] });
}

export async function createProcessingSample({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "ensayos", "C", { objeto: "procesamiento", borrador: true });
  const actuo = cargoActuante(request, permiso);

  const payload = await readJson(request);
  // Contraseñas de firmantes enviadas al guardar: se verifican antes de cualquier otra escritura.
  await verificarFirmasConPassword(s, user, payload, request);
  const data = normalizePayload(payload);
  await exigirUsoDeRecursos(s, user, permiso.auth, { equipos: false, insumosJson: data.uso_inventario_json });
  // Fase 4: autorizacion FX-THF-AP de quien captura.
  await exigirAutorizaciones(s, user, requisitosProcesamiento());
  if (!data.folio_num) {
    data.folio_num = await nextFolioNum(s, TABLE);
  }
  await resolverFirmantes(s, user, payload, data, FIRMAS_PROCESAMIENTO, null);
  exigirSupervisorDistinto(data);
  // Fase 5: solo quien esta asignado a la muestra (o la coordinacion).
  await exigirAsignacion(s, user, data.recepcion_id, permiso.auth);
  // Solo se procesa una muestra recibida, aceptada y vigente.
  const origen = await assertOrigin(s, "muestras_recepcion", data.recepcion_id, { requireAccepted: true, requerido: ORIGEN_REQUERIDO });
  // El folio de la etapa anterior sale del registro vinculado, no de lo que mande el cliente.
  if (origen) data.folio_recepcion_num = toIntOrNull(origen.folio_num);
  const supervision = marcaSupervision(permiso);
  if (data.estado === "anulada") data.estado = "registrada";
  const userId = userIdFromClaims(user);

  try {
    const result = await s.execute(
      `
      INSERT INTO muestras_procesamiento (
        folio_num, tipo_registro, clave_revision, fecha_emision,
        fecha_procesamiento, hora_procesamiento, recepcion_id,
        folio_recepcion_num, muestra_tipo, id_interno,
        lote_seleccion_json,
        tipo_organismo_json, parte_organismo_json,
        tipo_organismo_otro, parte_organismo_otro,
        bivalvos_steps_json, sardinas_steps_json,
        otro_procesamiento, resguardo_json,
        observaciones_generales, nombre_quien_proceso,
        nombre_quien_superviso, firma_quien_proceso,
        firma_quien_superviso, uso_inventario_json,
        estado, creado_por, actualizado_por, creado_rol_id, creado_cargo
      ) VALUES (
        :folio_num, :tipo_registro, :clave_revision, :fecha_emision,
        :fecha_procesamiento, :hora_procesamiento, :recepcion_id,
        :folio_recepcion_num, :muestra_tipo, :id_interno,
        :lote_seleccion_json,
        :tipo_organismo_json, :parte_organismo_json,
        :tipo_organismo_otro, :parte_organismo_otro,
        :bivalvos_steps_json, :sardinas_steps_json,
        :otro_procesamiento, :resguardo_json,
        :observaciones_generales, :nombre_quien_proceso,
        :nombre_quien_superviso, :firma_quien_proceso,
        :firma_quien_superviso, :uso_inventario_json,
        :estado, :creado_por, :actualizado_por, :creado_rol_id, :creado_cargo
      )
      `,
      { ...data, creado_por: userId, actualizado_por: userId, creado_rol_id: actuo.rol_id, creado_cargo: actuo.cargo },
    );
    const id = result.lastrowid as number;
    await applyStageInventory(s, "PROC", id, data.uso_inventario_json, `Procesamiento de muestra folio ${data.folio_num}`, userId);
    await aplicarSupervision(s, TABLE, id, supervision, userId);
    await guardarFirmantes(s, TABLE, id, data, FIRMAS_PROCESAMIENTO);
    await advanceState(s, "muestras_recepcion", data.recepcion_id, "en_procesamiento");
    const despues = await snapshotRow(s, TABLE, id);
    await registrarAuditoria(s, user, { accion: "crear", entidad: TABLE, entidadId: id, referencia: folioLabel(TABLE, despues), despues, detalle: { actuo_como: actuo } });
    await s.commit();
    return json({ message: "Procesamiento creado", id }, 201);
  } catch (error) {
    await s.rollback();
    // Fase 12: si el folio lo asigno el servidor, el choque es de concurrencia: se relanza y apiRoute reintenta.
    if (isFolioConflict(error) && toIntOrNull(payload.folio_num)) {
      return json({ message: "El folio de procesamiento ya existe" }, 409);
    }
    throw error;
  }
}

export async function updateProcessingSample({ request, s, params }: RouteContext): Promise<Response> {
  const processingId = intParam(params.id);
  const user = await requireUser(request);

  const antes = await snapshotRow(s, TABLE, processingId);
  const permiso = await requirePermission(s, user, "ensayos", "E", { objeto: "procesamiento", borrador: String(antes?.estado || "registrada") === "registrada" });
  const actuo = cargoActuante(request, permiso);
  await assertEditableAsync(s, antes, TABLE);
  const payload = await readJson(request);
  // Contraseñas de firmantes enviadas al guardar: se verifican antes de cualquier otra escritura.
  await verificarFirmasConPassword(s, user, payload, request);
  const data = normalizePayload(payload);
  await exigirUsoDeRecursos(s, user, permiso.auth, { equipos: false, insumosJson: data.uso_inventario_json });
  // Fase 4: autorizacion FX-THF-AP de quien captura.
  await exigirAutorizaciones(s, user, requisitosProcesamiento());
  if (!data.folio_num) {
    return json({ message: "El folio de procesamiento es obligatorio" }, 400);
  }
  await resolverFirmantes(s, user, payload, data, FIRMAS_PROCESAMIENTO, antes);
  exigirSupervisorDistinto(data);
  // Fase 5: solo quien esta asignado a la muestra (o la coordinacion).
  await exigirAsignacion(s, user, data.recepcion_id, permiso.auth);
  // Con extracciones vigentes la recepción de origen ya no cambia: la cadena R → P → E quedaría cruzada.
  if (antes && Number(data.recepcion_id) !== Number(antes.recepcion_id) && Number((await s.scalar("SELECT COUNT(*) FROM muestras_extraccion WHERE procesamiento_id = :id AND estado <> 'anulada'", { id: processingId })) || 0)) return json({ message: "El procesamiento ya tiene extracciones; su recepción de origen no cambia", campo: "recepcion_id" }, 409);
  // El origen se valida tambien al editar (no se puede quitar ni cambiar por uno invalido).
  const origen = await assertOrigin(s, "muestras_recepcion", data.recepcion_id, { requireAccepted: true, requerido: ORIGEN_REQUERIDO });
  // El folio de la etapa anterior sale del registro vinculado, no de lo que mande el cliente.
  if (origen) data.folio_recepcion_num = toIntOrNull(origen.folio_num);
  const supervision = marcaSupervision(permiso);
  // El estado lo maneja el flujo: no se anula ni se retrocede desde el formato.
  if (data.estado === "anulada" || ["en_proceso", "completada"].includes(String(antes?.estado || ""))) data.estado = String(antes?.estado || "registrada");
  const userId = userIdFromClaims(user);

  try {
    const result = await s.execute(
      `
      UPDATE muestras_procesamiento
      SET folio_num = :folio_num,
        tipo_registro = :tipo_registro,
        clave_revision = :clave_revision,
        fecha_emision = :fecha_emision,
        fecha_procesamiento = :fecha_procesamiento,
        hora_procesamiento = :hora_procesamiento,
        recepcion_id = :recepcion_id,
        folio_recepcion_num = :folio_recepcion_num,
        muestra_tipo = :muestra_tipo,
        id_interno = :id_interno,
        lote_seleccion_json = :lote_seleccion_json,
        tipo_organismo_json = :tipo_organismo_json,
        parte_organismo_json = :parte_organismo_json,
        tipo_organismo_otro = :tipo_organismo_otro,
        parte_organismo_otro = :parte_organismo_otro,
        bivalvos_steps_json = :bivalvos_steps_json,
        sardinas_steps_json = :sardinas_steps_json,
        otro_procesamiento = :otro_procesamiento,
        resguardo_json = :resguardo_json,
        observaciones_generales = :observaciones_generales,
        nombre_quien_proceso = :nombre_quien_proceso,
        nombre_quien_superviso = :nombre_quien_superviso,
        firma_quien_proceso = :firma_quien_proceso,
        firma_quien_superviso = :firma_quien_superviso,
        uso_inventario_json = :uso_inventario_json,
        estado = :estado,
        actualizado_por = :actualizado_por
      WHERE id = :id
      `,
      { ...data, id: processingId, actualizado_por: userId },
    );
    if (result.rowcount === 0) {
      await s.rollback();
      return json({ message: "Registro no encontrado" }, 404);
    }
    await replaceInventoryUsage(s, user, processingId, data, folioLabel(TABLE, antes), insumosDeclarados(antes?.uso_inventario_json));
    await aplicarSupervision(s, TABLE, processingId, supervision, userId);
    await guardarFirmantes(s, TABLE, processingId, data, FIRMAS_PROCESAMIENTO);
    await advanceState(s, "muestras_recepcion", data.recepcion_id, "en_procesamiento");
    const despues = await snapshotRow(s, TABLE, processingId);
    await registrarAuditoria(s, user, { accion: "editar", entidad: TABLE, entidadId: processingId, referencia: folioLabel(TABLE, despues), antes, despues, detalle: { actuo_como: actuo } });
    await s.commit();
    return json({ message: "Procesamiento actualizado" });
  } catch (error) {
    await s.rollback();
    if (isFolioConflict(error)) {
      return json({ message: "El folio de procesamiento ya existe" }, 409);
    }
    throw error;
  }
}

/* Los registros tecnicos no se eliminan; se anulan con motivo. */
export async function deleteProcessingSample({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await requirePermission(s, user, "ensayos", "AN");
  return deletionNotAllowed();
}

export async function anularProcessingSample({ request, s, params }: RouteContext): Promise<Response> {
  const processingId = intParam(params.id);
  const user = await requireUser(request);
  const actuo = cargoActuante(request, await requirePermission(s, user, "ensayos", "AN"));
  const motivo = await readMotivo(request);
  await exigirReauth(s, request, user, "ensayos:AN");
  const { row, solicitud } = await anularOSolicitar(s, user, TABLE, processingId, motivo, actuo);
  await s.commit();
  if (solicitud) return respuestaSolicitud(solicitud, `la anulación del procesamiento ${solicitud.referencia}`);
  return json({ message: "Procesamiento anulado; el inventario descontado fue repuesto", item: serializeRow(row!) });
}

export async function restaurarProcessingSample({ request, s, params }: RouteContext): Promise<Response> {
  const processingId = intParam(params.id);
  const user = await requireUser(request);
  const actuo = cargoActuante(request, await requirePermission(s, user, "ensayos", "AN"));
  await exigirReauth(s, request, user, "ensayos:AN");
  const { row, solicitud } = await restaurarOSolicitar(s, user, TABLE, processingId, await readMotivo(request), actuo);
  await s.commit();
  if (solicitud) return respuestaSolicitud(solicitud, `la restauración del procesamiento ${solicitud.referencia}`);
  return json({ message: "Procesamiento restaurado. El inventario no se vuelve a descontar: revisa los insumos y guarda de nuevo si aplica", item: serializeRow(row!) });
}
