import { requireUser, userIdFromClaims, type CurrentUser } from "../../auth";
import { banderasPuede, conSolicitudesYPuede } from "../../puede-registro";
import { registrarAuditoria, snapshotRow } from "../../audit";
import { isSqlite, type Row, type Session } from "../../db";
import { HttpError, intParam, json, readJson, type RouteContext } from "../../http";
import { cargarAutorizacion, cargoActuante, requirePermission } from "../../rbac";
import { exigirReauth } from "../../seguridad";
import { exigirSinSolicitudPendiente, pendientesDe, respuestaSolicitud, serializarSolicitud } from "../../solicitudes";
import { detalleExcepcion, elaboradoresDe, excepcionesDe, exigirSegregacion } from "../../segregacion";
import { evaluarAnalisis, excepcionPara, type Violacion } from "../../../shared/segregacion";
import { aplicarSupervision, exigirSinSupervisionPendiente, filtroSupervision, marcaSupervision } from "../../supervision";
import { recordBitacoraFolios } from "../inventory";

import { advanceState, anularOSolicitar, validarRecepcionSiCompleta, applyStageInventory, assertEditableAsync, assertOrigin, deletionNotAllowed, exigirUsoDeRecursos, folioLabel, insumosDeclarados, isFolioConflict, nextFolioNum, readMotivo, replaceStageInventory, restaurarOSolicitar } from "../../samples-flow";
import { ANALYSIS_METHODS, ANALYSIS_TYPES, CONFORMITY_OPTIONS } from "../../../shared/sgc";
import { jsonText, safeJsonLoad, searchParam, strippedOrNull, toFloatOrNull, toIntOrNull } from "../helpers";

import { exigirAutorizaciones, requisitosEquipos } from "../../autorizaciones";
import { metodoDeTipoAnalisis, requisitosAnalisis, requisitosRevisionResultados } from "../../../shared/autorizaciones";
import { exigirSinSuspension, idsDeEquipos } from "../calidad/bloqueos";
import { incidenciasPorEquiposNoAptos } from "../calidad/automaticas";
import { exigirAsignacion, exigirEnsayoVisible, filtroAsignadas, soloAsignado } from "../../asignaciones";
import { firmanteElegido, guardarFirmantes, resolverFirmantes, verificarFirmasConPassword, type RolFirma } from "../../firmas";
import { marcarRequiereEnmienda } from "../informes";
import { contarVigentes, heredarAdjuntos, resumenAdjuntos } from "../../adjuntos";
import { getConfig } from "../../config";
import type { Permiso } from "../../rbac";

/*
 * Etapa de analisis (ISO/IEC 17025 7.5, 7.7 y 7.8; diagrama de flujo del
 * laboratorio): registro del ensayo con metodo, equipo, controles de calidad
 * y resultados por muestra; revision y aprobacion con firma antes de poder
 * incluirse en un informe.
 *
 * La clave del formato oficial de registro de analisis (FX-TCI-[ID]) aun no
 * la entrega el laboratorio; el campo metodo_referencia guarda la clave y
 * revision del protocolo aplicado.
 */

const TABLE = "muestras_analisis";
const TYPES = new Set(ANALYSIS_TYPES.map((item) => item.value));
const METHODS = new Set(ANALYSIS_METHODS.map((item) => item.value));
const CONFORMITY = new Set(CONFORMITY_OPTIONS.map((item) => item.value));

/* Fase 5: el analista (trabajo tecnico: autorizacion de analisis y metodo) se elige de las cuentas activas. */
const firmasAnalisis = (tipo: unknown): RolFirma[] => [{ rol: "analista", columnaNombre: "analista_nombre", etiqueta: "Analista", requisitos: requisitosAnalisis(tipo) }];

export function serializeAnalysis(row: Row): Row {
  const item: Row = { ...row };
  item.excepciones = excepcionesDe(row);
  delete item.excepciones_json;
  for (const key of ["condiciones", "resultados", "controles", "uso_inventario"]) {
    item[key] = safeJsonLoad(item[`${key}_json`], key === "resultados" || key === "uso_inventario" ? [] : {});
    delete item[`${key}_json`];
  }
  return item;
}

interface ResultadoRow {
  id_muestra: string | null;
  resultado: number | null;
  resultado_texto: string | null;
  unidad: string | null;
  limite_deteccion: number | null;
  limite_cuantificacion: number | null;
  limite_regulatorio: number | null;
  incertidumbre: number | null;
  cumple: string | null;
  observacion: string | null;
}

function normalizeResultados(raw: unknown): ResultadoRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: ResultadoRow[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const idMuestra = strippedOrNull(item.id_muestra, 100);
    if (!idMuestra) continue;
    const cumple = String(item.cumple || "").trim();
    rows.push({
      id_muestra: idMuestra,
      resultado: toFloatOrNull(item.resultado),
      resultado_texto: strippedOrNull(item.resultado_texto, 160),
      unidad: strippedOrNull(item.unidad, 30),
      limite_deteccion: toFloatOrNull(item.limite_deteccion),
      limite_cuantificacion: toFloatOrNull(item.limite_cuantificacion),
      limite_regulatorio: toFloatOrNull(item.limite_regulatorio),
      incertidumbre: toFloatOrNull(item.incertidumbre),
      cumple: CONFORMITY.has(cumple) ? cumple : null,
      observacion: strippedOrNull(item.observacion),
    });
  }
  return rows;
}

function normalizeControles(raw: unknown): Record<string, unknown> {
  const value = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const blanco = (value.blanco && typeof value.blanco === "object" ? value.blanco : {}) as Record<string, unknown>;
  const mr = (value.material_referencia && typeof value.material_referencia === "object" ? value.material_referencia : {}) as Record<string, unknown>;
  const dup = (value.duplicado && typeof value.duplicado === "object" ? value.duplicado : {}) as Record<string, unknown>;
  return {
    blanco: { resultado: strippedOrNull(blanco.resultado, 60), aceptable: strippedOrNull(blanco.aceptable, 10) },
    material_referencia: {
      ref: strippedOrNull(mr.ref, 60),
      nombre: strippedOrNull(mr.nombre, 180),
      lote: strippedOrNull(mr.lote, 80),
      caducidad: strippedOrNull(mr.caducidad, 10),
      valor_esperado: strippedOrNull(mr.valor_esperado, 60),
      valor_obtenido: strippedOrNull(mr.valor_obtenido, 60),
      aceptable: strippedOrNull(mr.aceptable, 10),
    },
    duplicado: { id_muestra: strippedOrNull(dup.id_muestra, 100), diferencia: strippedOrNull(dup.diferencia, 60), aceptable: strippedOrNull(dup.aceptable, 10) },
  };
}

function normalizePayload(raw: Record<string, unknown>) {
  const payload = raw || {};
  const tipo = String(payload.tipo_analisis || "").trim();
  const metodo = String(payload.metodo || "").trim();
  const condiciones = (payload.condiciones && typeof payload.condiciones === "object" ? payload.condiciones : {}) as Record<string, unknown>;
  return {
    folio_num: toIntOrNull(payload.folio_num),
    tipo_analisis: TYPES.has(tipo) ? tipo : "",
    metodo: METHODS.has(metodo) ? metodo : "",
    metodo_otro: strippedOrNull(payload.metodo_otro, 160),
    metodo_referencia: strippedOrNull(payload.metodo_referencia, 160),
    metodo_documento_id: toIntOrNull(payload.metodo_documento_id),
    recepcion_id: toIntOrNull(payload.recepcion_id),
    procesamiento_id: toIntOrNull(payload.procesamiento_id),
    extraccion_id: toIntOrNull(payload.extraccion_id),
    fecha_analisis: strippedOrNull(payload.fecha_analisis, 10),
    hora_inicio: strippedOrNull(payload.hora_inicio, 20),
    hora_fin: strippedOrNull(payload.hora_fin, 20),
    equipo_id: toIntOrNull(payload.equipo_id),
    equipo_nombre: strippedOrNull(payload.equipo_nombre, 150),
    equipo_clave_bitacora: strippedOrNull(payload.equipo_clave_bitacora, 60),
    equipo_folio_bitacora: strippedOrNull(payload.equipo_folio_bitacora, 60),
    condiciones_json: jsonText({ temperatura_ambiente: strippedOrNull(condiciones.temperatura_ambiente, 20), humedad: strippedOrNull(condiciones.humedad, 20), observaciones: strippedOrNull(condiciones.observaciones) }),
    resultados_json: jsonText(normalizeResultados(payload.resultados)),
    controles_json: jsonText(normalizeControles(payload.controles)),
    uso_inventario_json: jsonText(Array.isArray(payload.uso_inventario) ? payload.uso_inventario : []),
    observaciones: strippedOrNull(payload.observaciones),
    analista_nombre: strippedOrNull(payload.analista_nombre, 180),
    analista_firma: strippedOrNull(payload.analista_firma),
  };
}

type AnalysisData = ReturnType<typeof normalizePayload>;

function validate(data: AnalysisData): string | null {
  if (!data.tipo_analisis) return "Selecciona el tipo de analisis";
  if (!data.metodo) return "Selecciona el metodo de analisis";
  if (data.metodo === "otro" && !data.metodo_otro) return "Especifica el metodo de analisis";
  if (!data.fecha_analisis) return "La fecha del analisis es obligatoria";
  const meta = ANALYSIS_TYPES.find((item) => item.value === data.tipo_analisis);
  if (meta?.requiere_extraccion && !data.extraccion_id) return `El analisis de ${meta.label} requiere una extraccion vinculada`;
  if (!data.analista_nombre) return "Indica el nombre del analista";
  const resultados = safeJsonLoad<ResultadoRow[]>(data.resultados_json, []);
  if (!resultados.length) return "Captura al menos un resultado por muestra";
  for (const row of resultados) {
    if (row.resultado === null && !row.resultado_texto) return `Captura el resultado de la muestra ${row.id_muestra}`;
  }
  return null;
}

/* Deriva y verifica la cadena recepcion -> procesamiento -> extraccion. */
async function resolveChain(s: Session, data: AnalysisData): Promise<void> {
  if (data.extraccion_id) {
    const extraccion = await assertOrigin(s, "muestras_extraccion", data.extraccion_id);
    const procesamientoId = toIntOrNull(extraccion?.procesamiento_id);
    if (procesamientoId) {
      const procesamiento = await assertOrigin(s, "muestras_procesamiento", procesamientoId);
      data.procesamiento_id = procesamientoId;
      const recepcionId = toIntOrNull(procesamiento?.recepcion_id);
      if (recepcionId) data.recepcion_id = recepcionId;
    }
  } else if (data.procesamiento_id) {
    const procesamiento = await assertOrigin(s, "muestras_procesamiento", data.procesamiento_id);
    const recepcionId = toIntOrNull(procesamiento?.recepcion_id);
    if (recepcionId) data.recepcion_id = recepcionId;
  } else {
    // Fase 2: el analisis no parte directo de la recepcion. Los tipos que requieren
    // extraccion ya la exigen en validate(); plancton y "otro" parten al menos de un procesamiento.
    throw new HttpError(400, { message: "El analisis debe partir de una extracción (o, para plancton u otro análisis sin extracción, de un procesamiento)", codigo: "origen_requerido" });
  }
  if (!data.recepcion_id) throw new HttpError(400, { message: "El analisis debe vincularse a una recepcion de muestra (a traves de la extraccion o del procesamiento)" });
  await assertOrigin(s, "muestras_recepcion", data.recepcion_id, { requireAccepted: true });
}

async function snapshotEquipo(s: Session, data: AnalysisData): Promise<void> {
  if (!data.equipo_id) return;
  const row = await s.queryOne<{ nombre: string; clave_bitacora: string | null }>("SELECT nombre, clave_bitacora FROM equipos WHERE id = :id", { id: data.equipo_id });
  if (row) {
    data.equipo_nombre = row.nombre;
    data.equipo_clave_bitacora = data.equipo_clave_bitacora || row.clave_bitacora || null;
  }
}

export async function getNextFolio({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await requirePermission(s, user, "ensayos", "V");
  return json({ next_folio: await nextFolioNum(s, TABLE) });
}

export async function listAnalyses({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "ensayos", "V");
  const supFiltro = filtroSupervision(request, "a", permiso.auth.userId);
  // Fase 5: filtro "Mis muestras"; con alcance "asignado", solo lo asignado o registrado por la persona.
  const restringida = soloAsignado(permiso);
  const asignadas = await filtroAsignadas(s, permiso.auth.userId, "a.recepcion_id", restringida || searchParam(request, "mias") === "1", restringida ? "a.creado_por" : undefined);
  const search = searchParam(request, "search");
  const estado = searchParam(request, "estado");
  const recepcionId = toIntOrNull(searchParam(request, "recepcion_id")) || 0;
  const extraccionId = toIntOrNull(searchParam(request, "extraccion_id")) || 0;
  const includeAnulados = searchParam(request, "anulados") === "1";
  const rows = await s.query(
    `
    SELECT a.id, a.folio_num, a.tipo_analisis, a.metodo, a.metodo_otro, a.metodo_referencia,
           a.recepcion_id, a.procesamiento_id, a.extraccion_id, a.fecha_analisis, a.equipo_nombre,
           a.analista_nombre, a.revisado_nombre, a.aprobado_nombre, a.estado, a.motivo_anulacion, a.version, a.sustituye_a,
           a.resultados_json, a.creado_en, a.supervision_estado, a.supervisor_id,
           r.folio_num AS folio_recepcion_num, r.solicitante, r.id_interno AS recepcion_id_interno,
           e.folio_num AS folio_extraccion_num, e.tipo_registro AS tipo_extraccion
    FROM ${TABLE} a
    LEFT JOIN muestras_recepcion r ON r.id = a.recepcion_id
    LEFT JOIN muestras_extraccion e ON e.id = a.extraccion_id
    WHERE (:incluir_anulados = 1 OR a.estado <> 'anulado')
      AND (:estado = '' OR a.estado = :estado OR (:estado = 'pendiente' AND a.estado IN ('registrado', 'en_revision', 'revisado')))
      AND (:recepcion_id = 0 OR a.recepcion_id = :recepcion_id)
      AND (:extraccion_id = 0 OR a.extraccion_id = :extraccion_id)
      ${supFiltro.sql}
      ${asignadas.sql}
      AND (:search = ''
        OR CAST(a.folio_num AS CHAR) LIKE :search_like
        OR r.solicitante LIKE :search_like
        OR r.id_interno LIKE :search_like
        OR a.analista_nombre LIKE :search_like
        OR a.resultados_json LIKE :search_like)
    ORDER BY a.folio_num DESC
    LIMIT 400
    `,
    { search, search_like: `%${search}%`, estado, recepcion_id: recepcionId, extraccion_id: extraccionId, incluir_anulados: includeAnulados ? 1 : 0, ...supFiltro.params, ...asignadas.params },
  );
  return json({
    items: (await conSolicitudesYPuede(s, user, TABLE, rows)).map((row) => {
      const resultados = safeJsonLoad<ResultadoRow[]>(row.resultados_json, []);
      const item: Row = { ...row, muestras: resultados.length, no_conformes: resultados.filter((entry) => entry.cumple === "no_cumple").length };
      delete item.resultados_json;
      return item;
    }),
    total: rows.length,
  });
}

export async function getAnalysis({ request, s, params }: RouteContext): Promise<Response> {
  const id = intParam(params.id);
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "ensayos", "V");
  const row = await s.queryOne(`SELECT * FROM ${TABLE} WHERE id = :id`, { id });
  if (!row) return json({ message: "Registro no encontrado" }, 404);
  await exigirEnsayoVisible(s, permiso, TABLE, row);
  // Folio de la recepcion para la cadena de la ficha (la lista lo trae con el mismo JOIN).
  const folioRecepcion = row.recepcion_id ? await s.scalar("SELECT folio_num FROM muestras_recepcion WHERE id = :id", { id: row.recepcion_id }) : null;
  // Informes que reportan este analisis (el LIKE acota; la lista JSON decide).
  const candidatos = await s.query<Row>("SELECT id, folio_num, version, estado, analisis_ids_json FROM informes WHERE analisis_ids_json LIKE :like", { like: `%${id}%` }).catch(() => [] as Row[]);
  const informes = candidatos
    .filter((inf) => safeJsonLoad<number[]>(String(inf.analisis_ids_json || "[]"), []).includes(id))
    .map((inf) => ({ id: inf.id, folio_num: inf.folio_num, version: inf.version, estado: inf.estado }));
  // Fase 3: solicitud pendiente y, para quien consulta, si la segregacion le impide revisar o aprobar.
  const pendiente = (await pendientesDe(s, TABLE, [id])).get(String(id));
  const yo = userIdFromClaims(user) as number;
  const elaboradores = await elaboradoresDe(s, TABLE, id, row.creado_por);
  const bloqueo = (accion: "revisar" | "aprobar") => {
    const v = evaluarAnalisis(yo, elaboradores, accion);
    return v && !excepcionPara(excepcionesDe(row), yo, accion) ? v.mensaje : null;
  };
  // Fase 10: resumen de la evidencia instrumental (la lista completa esta en /adjuntos).
  const adjuntos = { ...(await resumenAdjuntos(s, "analisis", id)), obligatoria: getConfig().EVIDENCIA_OBLIGATORIA_ANALISIS };
  const puede = (await banderasPuede(s, await cargarAutorizacion(s, user), TABLE, [id], new Set(pendiente ? [id] : []), true)).get(id) || {};
  return json({ item: { ...serializeAnalysis(row), folio_recepcion_num: folioRecepcion ?? null, informes, adjuntos, puede, solicitud_pendiente: pendiente ? serializarSolicitud(pendiente) : null, segregacion: { revisar: bloqueo("revisar"), aprobar: bloqueo("aprobar") } } });
}

export async function createAnalysis({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "ensayos", "C", { objeto: "analisis", borrador: true });
  const actuo = cargoActuante(request, permiso);
  const payload = await readJson(request);
  // Contraseñas de firmantes enviadas al guardar: se verifican antes de cualquier otra escritura.
  await verificarFirmasConPassword(s, user, payload, request);
  const data = normalizePayload(payload);
  await exigirUsoDeRecursos(s, user, permiso.auth, { equipos: !!(data.equipo_id || data.equipo_nombre), insumosJson: data.uso_inventario_json });
  // Fase 4: autorizacion FX-THF-AP: analisis, metodo del tipo de analisis y equipo usado (si esta en el inventario).
  await exigirAutorizaciones(s, user, [...requisitosAnalisis(data.tipo_analisis), ...(await requisitosEquipos(s, [data.equipo_id]))]);
  // Fase 11: metodo o equipo suspendido por una NC -> 409.
  await exigirSinSuspension(s, { metodos: [metodoDeTipoAnalisis(data.tipo_analisis)], equipoIds: [data.equipo_id], equipoNombres: data.equipo_id ? [] : [data.equipo_nombre] });
  if (!data.folio_num) data.folio_num = await nextFolioNum(s, TABLE);
  // Fase 6: con firmantes.analista basta (el nombre lo pone la cuenta al resolver la firma).
  if (!data.analista_nombre && firmanteElegido(payload, "analista")) data.analista_nombre = "(cuenta del firmante)";
  const invalid = validate(data);
  if (invalid) return json({ message: invalid }, 400);
  await resolveChain(s, data);
  // Fase 5: solo quien esta asignado a la muestra (o la coordinacion).
  await exigirAsignacion(s, user, data.recepcion_id, permiso.auth);
  await resolverFirmantes(s, user, payload, data, firmasAnalisis(data.tipo_analisis), null);
  await snapshotEquipo(s, data);
  const supervision = marcaSupervision(permiso);
  const userId = userIdFromClaims(user);
  try {
    const result = await s.execute(
      `
      INSERT INTO ${TABLE} (
        folio_num, tipo_analisis, metodo, metodo_otro, metodo_referencia, metodo_documento_id,
        recepcion_id, procesamiento_id, extraccion_id, fecha_analisis, hora_inicio, hora_fin,
        equipo_id, equipo_nombre, equipo_clave_bitacora, equipo_folio_bitacora,
        condiciones_json, resultados_json, controles_json, uso_inventario_json, observaciones,
        analista_nombre, analista_firma, estado, creado_por, actualizado_por, creado_rol_id, creado_cargo
      ) VALUES (
        :folio_num, :tipo_analisis, :metodo, :metodo_otro, :metodo_referencia, :metodo_documento_id,
        :recepcion_id, :procesamiento_id, :extraccion_id, :fecha_analisis, :hora_inicio, :hora_fin,
        :equipo_id, :equipo_nombre, :equipo_clave_bitacora, :equipo_folio_bitacora,
        :condiciones_json, :resultados_json, :controles_json, :uso_inventario_json, :observaciones,
        :analista_nombre, :analista_firma, 'registrado', :creado_por, :actualizado_por, :creado_rol_id, :creado_cargo
      )
      `,
      { ...data, creado_por: userId, actualizado_por: userId, creado_rol_id: actuo.rol_id, creado_cargo: actuo.cargo },
    );
    const id = result.lastrowid as number;
    await applyStageInventory(s, "ANA", id, data.uso_inventario_json, `Analisis folio ${data.folio_num}`, userId);
    await aplicarSupervision(s, TABLE, id, supervision, userId);
    await guardarFirmantes(s, TABLE, id, data, firmasAnalisis(data.tipo_analisis));
    await advanceState(s, "muestras_recepcion", data.recepcion_id, "en_analisis");
    const despues = await snapshotRow(s, TABLE, id);
    await registrarAuditoria(s, user, { accion: "crear", entidad: TABLE, entidadId: id, referencia: folioLabel(TABLE, despues), despues, detalle: { actuo_como: actuo } });
    await incidenciasPorEquiposNoAptos(s, user, TABLE, id, folioLabel(TABLE, despues), await idsDeEquipos(s, [data.equipo_id], data.equipo_id ? [] : [data.equipo_nombre]), actuo.cargo);
    await recordBitacoraFolios(s, [{ equipoId: data.equipo_id, folio: data.equipo_folio_bitacora }]);
    await s.commit();
    return json({ message: "Analisis registrado", id, folio_num: data.folio_num }, 201);
  } catch (error) {
    await s.rollback();
    // Fase 12: si el folio lo asigno el servidor, el choque es de concurrencia: se relanza y apiRoute reintenta.
    if (isFolioConflict(error) && toIntOrNull(payload.folio_num)) return json({ message: "El folio de analisis ya existe" }, 409);
    throw error;
  }
}

/*
 * Quien puede modificar el contenido de un analisis (editarlo o, desde la
 * Fase 10, adjuntar y anular su evidencia): ensayos:E con su alcance, solo en
 * "registrado" (enviado a revision, revisado o aprobado ya no se tocan), sin
 * anulacion ni solicitud pendiente. Lo usan updateAnalysis y los adjuntos.
 */
export async function exigirAnalisisEditable(s: Session, user: CurrentUser, antes: Row | null, bloqueado?: (estado: string) => string): Promise<Permiso> {
  if (!antes) throw new HttpError(404, { message: "Registro no encontrado" });
  const permiso = await requirePermission(s, user, "ensayos", "E", { objeto: "analisis", borrador: String(antes.estado || "registrado") === "registrado" });
  // E solo mientras el analisis no se ha enviado a revision (Fase 5); un aprobado se corrige con enmienda.
  if (["en_revision", "revisado", "aprobado", "sustituido"].includes(String(antes.estado))) {
    const como = String(antes.estado) === "aprobado" ? "Corrígelo con una enmienda (nueva versión)" : "Pide al revisor que lo devuelva con observaciones";
    const message = bloqueado ? bloqueado(String(antes.estado)) : `El analisis ya esta ${antes.estado === "en_revision" ? "enviado a revision" : antes.estado}; no se edita. ${como}`;
    throw new HttpError(409, { message, codigo: "analisis_bloqueado" });
  }
  await assertEditableAsync(s, antes, TABLE);
  return permiso;
}

export async function updateAnalysis({ request, s, params }: RouteContext): Promise<Response> {
  const id = intParam(params.id);
  const user = await requireUser(request);
  const antes = await snapshotRow(s, TABLE, id);
  const permiso = await exigirAnalisisEditable(s, user, antes);
  const actuo = cargoActuante(request, permiso);
  const payload = await readJson(request);
  // Contraseñas de firmantes enviadas al guardar: se verifican antes de cualquier otra escritura.
  await verificarFirmasConPassword(s, user, payload, request);
  const data = normalizePayload(payload);
  await exigirUsoDeRecursos(s, user, permiso.auth, { equipos: !!(data.equipo_id || data.equipo_nombre), insumosJson: data.uso_inventario_json });
  // Fase 4: autorizacion FX-THF-AP: analisis, metodo del tipo de analisis y equipo usado (si esta en el inventario).
  await exigirAutorizaciones(s, user, [...requisitosAnalisis(data.tipo_analisis), ...(await requisitosEquipos(s, [data.equipo_id]))]);
  // Fase 11: metodo o equipo suspendido por una NC -> 409.
  await exigirSinSuspension(s, { metodos: [metodoDeTipoAnalisis(data.tipo_analisis)], equipoIds: [data.equipo_id], equipoNombres: data.equipo_id ? [] : [data.equipo_nombre] });
  if (!data.folio_num) return json({ message: "El folio es obligatorio" }, 400);
  // Fase 6: con firmantes.analista basta (el nombre lo pone la cuenta al resolver la firma).
  if (!data.analista_nombre && firmanteElegido(payload, "analista")) data.analista_nombre = "(cuenta del firmante)";
  const invalid = validate(data);
  if (invalid) return json({ message: invalid }, 400);
  await resolveChain(s, data);
  // Fase 5: solo quien esta asignado a la muestra (o la coordinacion).
  await exigirAsignacion(s, user, data.recepcion_id, permiso.auth);
  await resolverFirmantes(s, user, payload, data, firmasAnalisis(data.tipo_analisis), antes);
  await snapshotEquipo(s, data);
  const supervision = marcaSupervision(permiso);
  const userId = userIdFromClaims(user);
  // Solo llega aqui un analisis "registrado" (E no aplica tras la revision).
  try {
    await s.execute(
      `
      UPDATE ${TABLE} SET
        folio_num = :folio_num, tipo_analisis = :tipo_analisis, metodo = :metodo, metodo_otro = :metodo_otro,
        metodo_referencia = :metodo_referencia, metodo_documento_id = :metodo_documento_id,
        recepcion_id = :recepcion_id, procesamiento_id = :procesamiento_id, extraccion_id = :extraccion_id,
        fecha_analisis = :fecha_analisis, hora_inicio = :hora_inicio, hora_fin = :hora_fin,
        equipo_id = :equipo_id, equipo_nombre = :equipo_nombre, equipo_clave_bitacora = :equipo_clave_bitacora,
        equipo_folio_bitacora = :equipo_folio_bitacora, condiciones_json = :condiciones_json,
        resultados_json = :resultados_json, controles_json = :controles_json, uso_inventario_json = :uso_inventario_json,
        observaciones = :observaciones, analista_nombre = :analista_nombre, analista_firma = :analista_firma,
        actualizado_por = :actualizado_por
      WHERE id = :id
      `,
      { ...data, id, actualizado_por: userId },
    );
    await replaceStageInventory(s, user, "ANA", id, data.uso_inventario_json, `Analisis folio ${data.folio_num}`, folioLabel(TABLE, antes), insumosDeclarados(antes?.uso_inventario_json));
    await aplicarSupervision(s, TABLE, id, supervision, userId);
    await guardarFirmantes(s, TABLE, id, data, firmasAnalisis(data.tipo_analisis));
    const despues = await snapshotRow(s, TABLE, id);
    await registrarAuditoria(s, user, { accion: "editar", entidad: TABLE, entidadId: id, referencia: folioLabel(TABLE, despues), antes, despues, detalle: { actuo_como: actuo } });
    await incidenciasPorEquiposNoAptos(s, user, TABLE, id, folioLabel(TABLE, despues), await idsDeEquipos(s, [data.equipo_id], data.equipo_id ? [] : [data.equipo_nombre]), actuo.cargo);
    await recordBitacoraFolios(s, [{ equipoId: data.equipo_id, folio: data.equipo_folio_bitacora }]);
    await s.commit();
    return json({ message: "Analisis actualizado" });
  } catch (error) {
    await s.rollback();
    if (isFolioConflict(error)) return json({ message: "El folio de analisis ya existe" }, 409);
    throw error;
  }
}

export async function deleteAnalysis({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await requirePermission(s, user, "ensayos", "AN");
  return deletionNotAllowed();
}

/*
 * Excepcion de segregacion (Fase 3): solo la pide quien podria revisar o aprobar
 * el analisis (permiso y estado) y la segregacion se lo impide de verdad.
 */
export async function violacionParaExcepcionAnalisis(s: Session, user: CurrentUser, id: number, accion: string): Promise<{ violacion: Violacion | null; row: Row }> {
  if (accion !== "revisar" && accion !== "aprobar") throw new HttpError(400, { message: "En un análisis la excepción aplica a revisar o aprobar" });
  await requirePermission(s, user, "ensayos", accion === "revisar" ? "R" : "A");
  const row = await snapshotRow(s, TABLE, id);
  if (!row) throw new HttpError(404, { message: "Análisis no encontrado" });
  // Fase 6: se revisa lo enviado a revision.
  const estado = accion === "revisar" ? "en_revision" : "revisado";
  if (String(row.estado) !== estado) throw new HttpError(409, { message: `El análisis ${folioLabel(TABLE, row)} no está ${estado}; no hay nada que ${accion}` });
  return { violacion: evaluarAnalisis(userIdFromClaims(user) as number, await elaboradoresDe(s, TABLE, id, row.creado_por), accion), row };
}

/* Revision tecnica (segunda persona): deja nombre, fecha y firma. */
export async function reviewAnalysis({ request, s, params }: RouteContext): Promise<Response> {
  const id = intParam(params.id);
  const user = await requireUser(request);
  const actuo = cargoActuante(request, await requirePermission(s, user, "ensayos", "R"));
  const antes = await snapshotRow(s, TABLE, id);
  await assertEditableAsync(s, antes, TABLE, "revisar");
  // Fase 6: solo se revisa lo que el analista envio a revision.
  if (String(antes?.estado) !== "en_revision") return json({ message: String(antes?.estado) === "registrado" ? "El analista aún no lo envía a revisión" : "Solo se revisan analisis enviados a revision", codigo: "no_enviado" }, 409);
  exigirSinSupervisionPendiente(antes, `El analisis ${folioLabel(TABLE, antes)}`, "revisar");
  await exigirAutorizaciones(s, user, requisitosRevisionResultados(antes?.tipo_analisis, "revisar"));
  const payload = await readJson(request);
  // Segregacion (regla 1): quien elaboro el analisis no lo revisa, salvo excepcion aprobada por un segundo usuario.
  const yo = userIdFromClaims(user) as number;
  const excepcion = exigirSegregacion(evaluarAnalisis(yo, await elaboradoresDe(s, TABLE, id, antes?.creado_por), "revisar"), antes, yo, "revisar");
  const now = new Date().toISOString();
  await s.execute(
    `UPDATE ${TABLE} SET estado = 'revisado', revisado_por = :usuario, revisado_nombre = :nombre, revisado_rol_id = :rol_id, revisado_cargo = :cargo, revisado_en = :fecha, revisado_firma = :firma, revision_observaciones = :obs WHERE id = :id`,
    { usuario: userIdFromClaims(user), nombre: String(user.nombre || user.email || "").slice(0, 180), rol_id: actuo.rol_id, cargo: actuo.cargo, fecha: now, firma: strippedOrNull(payload.firma), obs: strippedOrNull(payload.observaciones), id },
  );
  const despues = await snapshotRow(s, TABLE, id);
  await advanceState(s, "muestras_recepcion", toIntOrNull(antes?.recepcion_id), "en_revision_tecnica");
  await registrarAuditoria(s, user, { accion: "revisar", entidad: TABLE, entidadId: id, referencia: folioLabel(TABLE, despues), antes, despues, motivo: strippedOrNull(payload.observaciones), detalle: { actuo_como: actuo, ...detalleExcepcion(excepcion) } });
  await s.commit();
  return json({ message: "Analisis revisado", item: serializeAnalysis(despues!) });
}

/* Aprobacion: a partir de aqui el resultado puede reportarse. */
export async function approveAnalysis({ request, s, params }: RouteContext): Promise<Response> {
  const id = intParam(params.id);
  const user = await requireUser(request);
  const actuo = cargoActuante(request, await requirePermission(s, user, "ensayos", "A"));
  const antes = await snapshotRow(s, TABLE, id);
  await assertEditableAsync(s, antes, TABLE, "aprobar");
  if (String(antes?.estado) !== "revisado") return json({ message: "El analisis debe estar revisado antes de aprobarse" }, 409);
  exigirSinSupervisionPendiente(antes, `El analisis ${folioLabel(TABLE, antes)}`, "aprobar");
  await exigirAutorizaciones(s, user, requisitosRevisionResultados(antes?.tipo_analisis, "aprobar"));
  const payload = await readJson(request);
  // Segregacion (regla 1): quien elaboro el analisis no lo aprueba (revisor y aprobador si pueden coincidir).
  const yo = userIdFromClaims(user) as number;
  const excepcion = exigirSegregacion(evaluarAnalisis(yo, await elaboradoresDe(s, TABLE, id, antes?.creado_por), "aprobar"), antes, yo, "aprobar");
  await exigirReauth(s, request, user, "ensayos:A");
  const now = new Date().toISOString();
  await s.execute(
    `UPDATE ${TABLE} SET estado = 'aprobado', aprobado_por = :usuario, aprobado_nombre = :nombre, aprobado_rol_id = :rol_id, aprobado_cargo = :cargo, aprobado_en = :fecha, aprobado_firma = :firma WHERE id = :id`,
    { usuario: userIdFromClaims(user), nombre: String(user.nombre || user.email || "").slice(0, 180), rol_id: actuo.rol_id, cargo: actuo.cargo, fecha: now, firma: strippedOrNull(payload.firma), id },
  );
  await advanceState(s, "muestras_extraccion", toIntOrNull(antes?.extraccion_id), "analizada");
  await advanceState(s, "muestras_procesamiento", toIntOrNull(antes?.procesamiento_id), "completada");
  // Fase 5: al aprobarse una enmienda, la version original queda sustituida.
  if (antes?.sustituye_a) {
    const original = await snapshotRow(s, TABLE, Number(antes.sustituye_a));
    if (original && String(original.estado) === "aprobado") {
      await s.execute(`UPDATE ${TABLE} SET estado = 'sustituido' WHERE id = :id`, { id: original.id });
      await registrarAuditoria(s, user, { accion: "sustituir", entidad: TABLE, entidadId: Number(original.id), referencia: folioLabel(TABLE, original), antes: original, despues: await snapshotRow(s, TABLE, Number(original.id)), motivo: strippedOrNull(antes.motivo_enmienda), detalle: { sustituido_por: id, version: antes.version } });
      // Fase 6: los informes autorizados, liberados o enviados que lo incluyen quedan "requiere enmienda".
      await marcarRequiereEnmienda(s, user, Number(original.id), folioLabel(TABLE, original));
    }
  }
  await validarRecepcionSiCompleta(s, toIntOrNull(antes?.recepcion_id));
  const despues = await snapshotRow(s, TABLE, id);
  await registrarAuditoria(s, user, { accion: "aprobar", entidad: TABLE, entidadId: id, referencia: folioLabel(TABLE, despues), antes, despues, detalle: { actuo_como: actuo, ...detalleExcepcion(excepcion) } });
  await s.commit();
  return json({ message: "Analisis aprobado", item: serializeAnalysis(despues!) });
}

/* Fase 5: el analista envia a revision (registrado -> en_revision); desde ahi ya no edita. */
export async function enviarRevisionAnalysis({ request, s, params }: RouteContext): Promise<Response> {
  const id = intParam(params.id);
  const user = await requireUser(request);
  const actuo = cargoActuante(request, await requirePermission(s, user, "ensayos", "C", { objeto: "analisis", borrador: true }));
  // En MySQL se bloquea la fila: un adjunto o un anulado concurrente espera a que termine el envio.
  const antes = isSqlite() ? await snapshotRow(s, TABLE, id) : await s.queryOne<Row>(`SELECT * FROM ${TABLE} WHERE id = :id FOR UPDATE`, { id });
  await assertEditableAsync(s, antes, TABLE, "enviar a revision");
  if (String(antes?.estado) !== "registrado") return json({ message: "Solo se envian a revision analisis en estado registrado" }, 409);
  exigirSinSupervisionPendiente(antes, `El analisis ${folioLabel(TABLE, antes)}`, "enviar a revision");
  await exigirAsignacion(s, user, toIntOrNull(antes?.recepcion_id));
  // Fase 10: evidencia instrumental obligatoria (EVIDENCIA_OBLIGATORIA_ANALISIS, true por omision).
  if (getConfig().EVIDENCIA_OBLIGATORIA_ANALISIS && !(await contarVigentes(s, "analisis", id))) {
    return json({ message: "Adjunta al menos una evidencia instrumental antes de enviar a revisión", codigo: "evidencia_requerida" }, 409);
  }
  const now = new Date().toISOString();
  await s.execute(`UPDATE ${TABLE} SET estado = 'en_revision', enviado_revision_por = :usuario, enviado_revision_en = :fecha, devolucion_observaciones = NULL WHERE id = :id`, { usuario: userIdFromClaims(user), fecha: now, id });
  await advanceState(s, "muestras_recepcion", toIntOrNull(antes?.recepcion_id), "en_revision_tecnica");
  const despues = await snapshotRow(s, TABLE, id);
  await registrarAuditoria(s, user, { accion: "enviar_revision", entidad: TABLE, entidadId: id, referencia: folioLabel(TABLE, despues), antes, despues, detalle: { actuo_como: actuo } });
  await s.commit();
  return json({ message: "Analisis enviado a revision; ya no se edita", item: serializeAnalysis(despues!) });
}

/* Fase 5: el revisor devuelve con observaciones (en_revision -> registrado) para correcciones antes de aprobar. */
export async function devolverAnalysis({ request, s, params }: RouteContext): Promise<Response> {
  const id = intParam(params.id);
  const user = await requireUser(request);
  const actuo = cargoActuante(request, await requirePermission(s, user, "ensayos", "R"));
  const antes = await snapshotRow(s, TABLE, id);
  await assertEditableAsync(s, antes, TABLE, "devolver");
  if (String(antes?.estado) !== "en_revision") return json({ message: "Solo se devuelven analisis enviados a revision" }, 409);
  // Devolver es un resultado de la revisión: exige lo mismo que revisar (visto bueno del supervisor y autorización FX-THF-AP).
  exigirSinSupervisionPendiente(antes, `El analisis ${folioLabel(TABLE, antes)}`, "devolver");
  await exigirAutorizaciones(s, user, requisitosRevisionResultados(antes?.tipo_analisis, "revisar"));
  const payload = await readJson(request);
  const motivo = String(payload.motivo || payload.observaciones || "").trim();
  if (motivo.length < 5) return json({ message: "Escribe las observaciones para el analista (al menos 5 caracteres)" }, 400);
  const yo = userIdFromClaims(user) as number;
  const excepcion = exigirSegregacion(evaluarAnalisis(yo, await elaboradoresDe(s, TABLE, id, antes?.creado_por), "revisar"), antes, yo, "revisar");
  await s.execute(`UPDATE ${TABLE} SET estado = 'registrado', devolucion_observaciones = :motivo WHERE id = :id`, { motivo, id });
  const despues = await snapshotRow(s, TABLE, id);
  await registrarAuditoria(s, user, { accion: "devolver", entidad: TABLE, entidadId: id, referencia: folioLabel(TABLE, despues), antes, despues, motivo, detalle: { actuo_como: actuo, ...detalleExcepcion(excepcion) } });
  await s.commit();
  return json({ message: "Analisis devuelto con observaciones; el analista puede corregirlo", item: serializeAnalysis(despues!) });
}

/*
 * Fase 5: un analisis aprobado se corrige solo con enmienda: nueva version
 * (mismo folio, version + 1, sustituye_a, motivo obligatorio) que sigue el flujo
 * normal; al aprobarse, la original pasa a "sustituido". El inventario no se
 * vuelve a descontar (la enmienda nace sin insumos declarados).
 */
export async function enmendarAnalysis({ request, s, params }: RouteContext): Promise<Response> {
  const id = intParam(params.id);
  const user = await requireUser(request);
  const actuo = cargoActuante(request, await requirePermission(s, user, "ensayos", "C", { objeto: "analisis", borrador: true }));
  const original = await snapshotRow(s, TABLE, id);
  if (!original) return json({ message: "Registro no encontrado" }, 404);
  if (String(original.estado) !== "aprobado") return json({ message: "Solo se enmiendan analisis aprobados; los demas se corrigen antes de aprobarse" }, 409);
  await exigirSinSolicitudPendiente(s, TABLE, id, `El analisis ${folioLabel(TABLE, original)}`, "enmendar");
  const abierta = await s.queryOne<Row>(`SELECT id, version FROM ${TABLE} WHERE sustituye_a = :id AND estado NOT IN ('anulado', 'aprobado', 'sustituido') LIMIT 1`, { id });
  if (abierta) return json({ message: `Ya hay una enmienda en curso (version ${abierta.version}); termina esa primero`, id: abierta.id }, 409);
  await exigirAsignacion(s, user, toIntOrNull(original.recepcion_id));
  await exigirAutorizaciones(s, user, requisitosAnalisis(original.tipo_analisis));
  const payload = await readJson(request);
  const motivo = String(payload.motivo || "").trim();
  if (motivo.length < 5) return json({ message: "Indica el motivo de la enmienda (al menos 5 caracteres)" }, 400);
  const version = Number((await s.scalar(`SELECT MAX(version) FROM ${TABLE} WHERE folio_num = :folio`, { folio: original.folio_num })) || 1) + 1;
  const omitir = new Set(["id", "estado", "version", "sustituye_a", "motivo_enmienda", "creado_en", "actualizado_en", "uso_inventario_json", "excepciones_json", "motivo_anulacion", "anulado_en", "anulado_por", "estado_previo", "enviado_revision_por", "enviado_revision_en", "devolucion_observaciones"]);
  const limpiar = (col: string) => /^(revisado|aprobado|revision)_/.test(col) || /^supervis/.test(col);
  const userId = userIdFromClaims(user);
  const copia: Row = {};
  for (const [col, valor] of Object.entries(original)) if (!omitir.has(col) && !limpiar(col)) copia[col] = valor;
  Object.assign(copia, { estado: "registrado", version, sustituye_a: id, motivo_enmienda: motivo, uso_inventario_json: "[]", creado_por: userId, actualizado_por: userId, creado_rol_id: actuo.rol_id, creado_cargo: actuo.cargo });
  const cols = Object.keys(copia);
  const result = await s.execute(`INSERT INTO ${TABLE} (${cols.join(", ")}) VALUES (${cols.map((c) => `:${c}`).join(", ")})`, copia);
  const nuevoId = result.lastrowid as number;
  // Fase 10: la nueva version hereda la evidencia vigente (mismo archivo, filas nuevas con heredado_de).
  const heredados = await heredarAdjuntos(s, "analisis", id, nuevoId);
  const despues = await snapshotRow(s, TABLE, nuevoId);
  await registrarAuditoria(s, user, { accion: "enmendar", entidad: TABLE, entidadId: nuevoId, referencia: folioLabel(TABLE, despues), despues, motivo, detalle: { sustituye_a: id, version, actuo_como: actuo, ...(heredados ? { adjuntos_heredados: heredados } : {}) } });
  await registrarAuditoria(s, user, { accion: "enmendar", entidad: TABLE, entidadId: id, referencia: folioLabel(TABLE, original), motivo, detalle: { enmienda_id: nuevoId, version } });
  await s.commit();
  return json({ message: `Enmienda creada: version ${version} del analisis ${folioLabel(TABLE, original)}`, id: nuevoId, version }, 201);
}

export async function anularAnalysis({ request, s, params }: RouteContext): Promise<Response> {
  const id = intParam(params.id);
  const user = await requireUser(request);
  const actuo = cargoActuante(request, await requirePermission(s, user, "ensayos", "AN"));
  const motivo = await readMotivo(request);
  await exigirReauth(s, request, user, "ensayos:AN");
  const { row, solicitud } = await anularOSolicitar(s, user, TABLE, id, motivo, actuo);
  await s.commit();
  if (solicitud) return respuestaSolicitud(solicitud, `la anulación del análisis ${solicitud.referencia}`);
  return json({ message: "Analisis anulado", item: serializeAnalysis(row!) });
}

export async function restaurarAnalysis({ request, s, params }: RouteContext): Promise<Response> {
  const id = intParam(params.id);
  const user = await requireUser(request);
  const actuo = cargoActuante(request, await requirePermission(s, user, "ensayos", "AN"));
  await exigirReauth(s, request, user, "ensayos:AN");
  const { row, solicitud } = await restaurarOSolicitar(s, user, TABLE, id, await readMotivo(request), actuo);
  await s.commit();
  if (solicitud) return respuestaSolicitud(solicitud, `la restauración del análisis ${solicitud.referencia}`);
  return json({ message: "Analisis restaurado", item: serializeAnalysis(row!) });
}

/* Usado por informes: analisis aprobados de una recepcion. */
export async function approvedAnalysesForReception(s: Session, recepcionId: number): Promise<Row[]> {
  const rows = await s.query(`SELECT * FROM ${TABLE} WHERE recepcion_id = :id AND estado = 'aprobado' ORDER BY folio_num`, { id: recepcionId });
  return rows.map(serializeAnalysis);
}

