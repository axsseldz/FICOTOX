import { formatearFolio } from "../../../shared/folios";
import { conSolicitudesYPuede } from "../../puede-registro";
import { requireUser, userIdFromClaims, type CurrentUser } from "../../auth";
import { registrarAuditoria, snapshotRow } from "../../audit";

import { type Row, type Session } from "../../db";
import { HttpError, intParam, json, readJson, type RouteContext } from "../../http";
import { cargoActuante, requirePermission } from "../../rbac";
import { exigirReauth } from "../../seguridad";
import { evaluarSupervisionCaptura } from "../../../shared/segregacion";
import { respuestaSolicitud } from "../../solicitudes";
import { aplicarSupervision, filtroSupervision, marcaSupervision } from "../../supervision";
import { recordBitacoraFolios } from "../inventory";

import { advanceState, anularOSolicitar, applyStageInventory, recepcionDe, assertEditableAsync, assertOrigin, avanzarRecepcion, deletionNotAllowed, exigirUsoDeRecursos, folioLabel, insumosDeclarados, isFolioConflict, nextFolioNum, readMotivo, replaceStageInventory, restaurarOSolicitar } from "../../samples-flow";
import { EXTRACTION_TYPES, claveForType, normalizeExtractionType, parseExtractionFolioSearch, type ExtractionType } from "../../../shared/extraction";
import { jsonText, safeJsonLoad, searchParam, strippedOrNull, toIntOrNull } from "../helpers";

import { exigirAutorizaciones, requisitosEquipos } from "../../autorizaciones";
import { metodoDeExtraccion, requisitosExtraccion } from "../../../shared/autorizaciones";
import { exigirSinSuspension, idsDeEquipos } from "../calidad/bloqueos";
import { incidenciasPorEquiposNoAptos } from "../calidad/automaticas";
import { exigirAsignacion, exigirEnsayoVisible, filtroAsignadas, soloAsignado } from "../../asignaciones";
import { guardarFirmantes, resolverFirmantes, verificarFirmasConPassword, type RolFirma } from "../../firmas";

/* Fase 11: equipos de la extraccion para suspensiones e incidencias (con id, o solo por nombre si no se eligio del catalogo). */
function usoDeEquipos(equiposJson: unknown): { equipoIds: unknown[]; equipoNombres: string[] } {
  const filas = safeJsonLoad(equiposJson, []) as Array<{ equipo_id?: unknown; nombre?: unknown }>;
  return { equipoIds: filas.map((e) => e.equipo_id), equipoNombres: filas.filter((e) => !e.equipo_id).map((e) => String(e.nombre || "")) };
}
/*
 * Portado de modules/samples/extraccion.py del backend Flask original.
 *
 * Cambios respecto al original:
 * - Cada tipo de extraccion (E-A ASP, E-D DSP) lleva su propia serie de
 *   folios: la restriccion de unicidad es (tipo_registro, folio_num).
 *   Las bases existentes se migran en caliente la primera vez (SQLite:
 *   reconstruccion de la tabla con respaldo previo del archivo; MySQL:
 *   reemplazo del indice unico).
 * - `equipos_json`: equipos utilizados durante la extraccion con su clave
 *   y folio de bitacora (seccion "Equipos utilizados" del formato).
 */

const TABLE = "muestras_extraccion";

const ORIGEN_REQUERIDO = "La extracción debe partir de un procesamiento de muestra";

/* Regla 3 de segregacion: quien firma "superviso" no es quien extrajo ni quien hizo la limpieza. */
/* Fase 5: quien extrajo y quien limpio (trabajo tecnico: autorizacion de extraccion y metodo) y quien superviso, de las cuentas activas. */
const firmasExtraccion = (tipo: string): RolFirma[] => [
  { rol: "extrajo", columnaNombre: "nombre_quien_extrajo", etiqueta: "Extrajo", requisitos: requisitosExtraccion(tipo) },
  { rol: "limpio", columnaNombre: "nombre_quien_limpieza", etiqueta: "Realizó la limpieza", requisitos: requisitosExtraccion(tipo) },
  { rol: "superviso", columnaNombre: "nombre_quien_superviso", etiqueta: "Supervisó" },
];

/* Regla 3: compara cuentas (usuario_id); sin cuenta ligada, los nombres escritos. */
function exigirSupervisorDistinto(data: { nombre_quien_extrajo: string | null; nombre_quien_limpieza: string | null; nombre_quien_superviso: string | null } & Record<string, unknown>): void {
  const violacion = evaluarSupervisionCaptura(data.nombre_quien_superviso, [
    { etiqueta: "realizó la extracción", nombre: data.nombre_quien_extrajo, usuarioId: data.extrajo_usuario_id },
    { etiqueta: "realizó la limpieza", nombre: data.nombre_quien_limpieza, usuarioId: data.limpio_usuario_id },
  ], data.superviso_usuario_id);
  if (violacion) throw new HttpError(409, { message: violacion.mensaje, codigo: "segregacion", regla: violacion.regla, clave: violacion.clave });
}

interface EquipoUtilizado {
  equipo_id: number | null;
  nombre: string | null;
  uso: string | null;
  clave_bitacora: string | null;
  folio_bitacora: string | null;
}

function normalizeEquipos(value: unknown): EquipoUtilizado[] {
  if (!Array.isArray(value)) return [];
  const result: EquipoUtilizado[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const equipoId = toIntOrNull(item.equipo_id);
    const nombre = strippedOrNull(item.nombre, 150);
    if (!equipoId && !nombre) continue;
    result.push({
      equipo_id: equipoId,
      nombre,
      uso: strippedOrNull(item.uso, 160),
      clave_bitacora: strippedOrNull(item.clave_bitacora, 60),
      folio_bitacora: strippedOrNull(item.folio_bitacora, 60),
    });
  }
  return result;
}

/* Guarda el nombre vigente del equipo junto al id, para que el registro sea legible aunque el catalogo cambie. */
async function snapshotEquipos(s: Session, equipos: EquipoUtilizado[]): Promise<EquipoUtilizado[]> {
  if (!equipos.some((item) => item.equipo_id)) return equipos;
  const result: EquipoUtilizado[] = [];
  for (const item of equipos) {
    if (!item.equipo_id) {
      result.push(item);
      continue;
    }
    const row = await s.queryOne<{ nombre: string; clave_bitacora: string | null }>("SELECT nombre, clave_bitacora FROM equipos WHERE id = :id LIMIT 1", { id: item.equipo_id });
    result.push({
      ...item,
      nombre: row?.nombre || item.nombre,
      clave_bitacora: item.clave_bitacora || row?.clave_bitacora || null,
    });
  }
  return result;
}

type ExtractionData = ReturnType<typeof normalizePayload>;

function normalizePayload(raw: Record<string, unknown>, tipo: ExtractionType) {
  const payload = raw || {};
  return {
    folio_num: toIntOrNull(payload.folio_num),
    tipo_registro: tipo,
    // La clave debe ser la del formato del tipo (admite revisiones: FX-TCF-GME-D/2).
    clave_revision: claveForType(tipo, payload.clave_revision),
    fecha_emision: payload.fecha_emision || null,
    fecha_extraccion: payload.fecha_extraccion || null,
    hora_extraccion: strippedOrNull(payload.hora_extraccion, 20),
    procesamiento_id: toIntOrNull(payload.procesamiento_id),
    folio_procesamiento_num: toIntOrNull(payload.folio_procesamiento_num),
    muestra_tipo: strippedOrNull(payload.muestra_tipo, 20),
    id_interno: strippedOrNull(payload.id_interno, 100),
    tipo_molienda: strippedOrNull(payload.tipo_molienda, 20),
    pasos_json: jsonText(payload.pasos || {}),
    registro_pesos_json: jsonText(Array.isArray(payload.registro_pesos) ? payload.registro_pesos : []),
    equipos_json: jsonText(normalizeEquipos(payload.equipos)),
    observaciones_generales: strippedOrNull(payload.observaciones_generales),
    nombre_quien_extrajo: strippedOrNull(payload.nombre_quien_extrajo, 180),
    nombre_quien_limpieza: strippedOrNull(payload.nombre_quien_limpieza, 180),
    nombre_quien_superviso: strippedOrNull(payload.nombre_quien_superviso, 180),
    firma_quien_extrajo: strippedOrNull(payload.firma_quien_extrajo),
    firma_quien_limpieza: strippedOrNull(payload.firma_quien_limpieza),
    firma_quien_superviso: strippedOrNull(payload.firma_quien_superviso),
    estado: String(payload.estado || "registrada").trim().slice(0, 30) || "registrada",
    uso_inventario_json: jsonText(payload.uso_inventario || []),
  };
}

/*
 * El tipo viene en el cuerpo. Si falta: al crear se asume ASP (comportamiento
 * historico); al editar se conserva el tipo almacenado, para que un cliente
 * que omita el campo no convierta una DSP en ASP.
 */
async function resolveType(s: Session, payload: Record<string, unknown>, extractionId: number | null): Promise<ExtractionType | null> {
  const raw = payload?.tipo_registro;
  if (raw !== undefined && raw !== null && raw !== "") return normalizeExtractionType(raw);
  if (extractionId === null) return "E-A";
  const stored = await s.scalar<string>(`SELECT tipo_registro FROM ${TABLE} WHERE id = :id`, { id: extractionId });
  return normalizeExtractionType(stored) || "E-A";
}

async function replaceInventoryUsage(s: Session, user: CurrentUser, extractionId: number, data: ExtractionData, referencia: string, declaradosAntes: Map<string, number>): Promise<void> {
  await replaceStageInventory(s, user, "EXT", extractionId, data.uso_inventario_json, `Extraccion ${data.tipo_registro} folio ${data.folio_num}`, referencia, declaradosAntes);
}

function serializeRow(row: Row): Row {
  const item: Row = { ...row };
  item.pasos = safeJsonLoad(item.pasos_json, {});
  delete item.pasos_json;
  item.registro_pesos = safeJsonLoad(item.registro_pesos_json, []);
  delete item.registro_pesos_json;
  item.equipos = safeJsonLoad(item.equipos_json, []);
  delete item.equipos_json;
  item.uso_inventario = safeJsonLoad(item.uso_inventario_json, []);
  delete item.uso_inventario_json;
  return item;
}

export async function getNextFolio({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await requirePermission(s, user, "ensayos", "V");
  const tipoParam = searchParam(request, "tipo");
  const tipo = tipoParam ? normalizeExtractionType(tipoParam) : "E-A";
  if (!tipo) {
    return json({ message: "Tipo de extraccion no valido" }, 400);
  }
  return json({ next_folio: await nextFolioNum(s, TABLE, "tipo_registro = :tipo", { tipo }), tipo_registro: tipo, clave_revision: EXTRACTION_TYPES[tipo].clave });
}

export async function listExtractionSamples({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "ensayos", "V");
  const supFiltro = filtroSupervision(request, "e", permiso.auth.userId);
  // Fase 5: filtro "Mis muestras"; con alcance "asignado", solo lo asignado o registrado por la persona.
  const restringida = soloAsignado(permiso);
  const asignadas = await filtroAsignadas(s, permiso.auth.userId, "(SELECT p2.recepcion_id FROM muestras_procesamiento p2 WHERE p2.id = e.procesamiento_id)", restringida || searchParam(request, "mias") === "1", "e.creado_por");

  const search = searchParam(request, "search");
  const tipoParam = searchParam(request, "tipo");
  const tipo = tipoParam ? normalizeExtractionType(tipoParam) : null;
  if (tipoParam && !tipo) {
    return json({ message: "Tipo de extraccion no valido" }, 400);
  }
  // "E-D 12" busca exactamente el folio 12 entre las DSP; "12" busca por coincidencia en ambas series.
  const folioSearch = parseExtractionFolioSearch(search);
  const exactFolio = folioSearch.tipo && folioSearch.folio ? Number.parseInt(folioSearch.folio, 10) : null;
  const rows = await s.query(
    `
    SELECT e.id, e.folio_num, e.tipo_registro, e.clave_revision, e.fecha_extraccion,
           e.hora_extraccion, e.procesamiento_id, e.folio_procesamiento_num, e.id_interno,
           e.muestra_tipo, e.tipo_molienda, e.estado, e.motivo_anulacion, e.anulado_en, e.creado_en, e.supervision_estado, e.supervisor_id
    FROM ${TABLE} e
    WHERE (:tipo = '' OR e.tipo_registro = :tipo)
      ${supFiltro.sql}
      ${asignadas.sql}
      AND (:incluir_anuladas = 1 OR e.estado <> 'anulada')
      AND (
        :search = ''
        OR (:exact_tipo <> '' AND e.tipo_registro = :exact_tipo AND e.folio_num = :exact_folio)
        OR (
          :exact_tipo = ''
          AND (
            e.id_interno LIKE :search_like
            OR CAST(e.folio_num AS CHAR) LIKE :search_like
            OR CAST(COALESCE(e.folio_procesamiento_num, 0) AS CHAR) LIKE :search_like
          )
        )
      )
    ORDER BY COALESCE(e.fecha_extraccion, e.creado_en) DESC, e.id DESC
    LIMIT 400
    `,
    {
      tipo: tipo || "",
      search,
      search_like: `%${search}%`,
      exact_tipo: exactFolio !== null ? folioSearch.tipo : "",
      exact_folio: exactFolio ?? 0,
      incluir_anuladas: searchParam(request, "anuladas") === "1" ? 1 : 0,
      ...supFiltro.params, ...asignadas.params,
    },
  );
  return json({ items: await conSolicitudesYPuede(s, user, TABLE, rows), total: rows.length });
}

export async function getExtractionSample({ request, s, params }: RouteContext): Promise<Response> {
  const extractionId = intParam(params.id);
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "ensayos", "V");

  const row = await s.queryOne(
    `
    SELECT id, folio_num, tipo_registro, clave_revision, fecha_emision,
           fecha_extraccion, hora_extraccion, procesamiento_id,
           folio_procesamiento_num, muestra_tipo, id_interno,
           tipo_molienda, pasos_json, registro_pesos_json, equipos_json,
           observaciones_generales, nombre_quien_extrajo,
           nombre_quien_limpieza, nombre_quien_superviso,
           firma_quien_extrajo, firma_quien_limpieza,
           firma_quien_superviso, uso_inventario_json,
           extrajo_usuario_id, extrajo_cargo, limpio_usuario_id, limpio_cargo, superviso_usuario_id, superviso_cargo,
           estado, creado_por, creado_en, actualizado_en,
           requiere_supervision, supervision_estado, supervisor_id, supervision_observaciones
    FROM ${TABLE}
    WHERE id = :id
    `,
    { id: extractionId },
  );
  if (!row) {
    return json({ message: "Registro no encontrado" }, 404);
  }
  await exigirEnsayoVisible(s, permiso, TABLE, row);
  return json({ item: (await conSolicitudesYPuede(s, user, TABLE, [serializeRow(row)]))[0] });
}

export async function createExtractionSample({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "ensayos", "C", { objeto: "extraccion", borrador: true });
  const actuo = cargoActuante(request, permiso);

  const payload = await readJson(request);
  // Contraseñas de firmantes enviadas al guardar: se verifican antes de cualquier otra escritura.
  await verificarFirmasConPassword(s, user, payload, request);
  const tipo = await resolveType(s, payload, null);
  if (!tipo) {
    return json({ message: "Tipo de extraccion no valido" }, 400);
  }
  const data = normalizePayload(payload, tipo);
  // Fase 4: autorizacion FX-THF-AP: extraccion, metodo del tipo (E-A ASP, E-D DSP) y cada equipo del inventario usado.
  await exigirAutorizaciones(s, user, [...requisitosExtraccion(tipo), ...(await requisitosEquipos(s, (safeJsonLoad(data.equipos_json, []) as Array<{ equipo_id?: unknown }>).map((e) => e.equipo_id)))]);
  // Fase 11: metodo o equipo suspendido por una NC -> 409.
  await exigirSinSuspension(s, { metodos: [metodoDeExtraccion(tipo)], ...usoDeEquipos(data.equipos_json) });
  await exigirUsoDeRecursos(s, user, permiso.auth, { equipos: (safeJsonLoad(data.equipos_json, []) as unknown[]).length > 0, insumosJson: data.uso_inventario_json });
  if (!data.folio_num) {
    data.folio_num = await nextFolioNum(s, TABLE, "tipo_registro = :tipo", { tipo });
  }
  await resolverFirmantes(s, user, payload, data, firmasExtraccion(tipo), null);
  exigirSupervisorDistinto(data);
  // Fase 5: solo quien esta asignado a la muestra (o la coordinacion).
  await exigirAsignacion(s, user, await recepcionDe(s, "muestras_procesamiento", data.procesamiento_id), permiso.auth);
  // Solo se extrae a partir de un procesamiento vigente.
  const origen = await assertOrigin(s, "muestras_procesamiento", data.procesamiento_id, { requerido: ORIGEN_REQUERIDO });
  // El folio de la etapa anterior sale del registro vinculado, no de lo que mande el cliente.
  if (origen) data.folio_procesamiento_num = toIntOrNull(origen.folio_num);
  const supervision = marcaSupervision(permiso);
  if (data.estado === "anulada") data.estado = "registrada";
  data.equipos_json = jsonText(await snapshotEquipos(s, normalizeEquipos(payload.equipos)));
  const userId = userIdFromClaims(user);

  try {
    const result = await s.execute(
      `
      INSERT INTO ${TABLE} (
          folio_num, tipo_registro, clave_revision, fecha_emision,
          fecha_extraccion, hora_extraccion, procesamiento_id,
          folio_procesamiento_num, muestra_tipo, id_interno,
          tipo_molienda, pasos_json, registro_pesos_json, equipos_json,
          observaciones_generales, nombre_quien_extrajo,
          nombre_quien_limpieza, nombre_quien_superviso,
          firma_quien_extrajo, firma_quien_limpieza,
          firma_quien_superviso, uso_inventario_json,
          estado, creado_por, actualizado_por, creado_rol_id, creado_cargo
      ) VALUES (
          :folio_num, :tipo_registro, :clave_revision, :fecha_emision,
          :fecha_extraccion, :hora_extraccion, :procesamiento_id,
          :folio_procesamiento_num, :muestra_tipo, :id_interno,
          :tipo_molienda, :pasos_json, :registro_pesos_json, :equipos_json,
          :observaciones_generales, :nombre_quien_extrajo,
          :nombre_quien_limpieza, :nombre_quien_superviso,
          :firma_quien_extrajo, :firma_quien_limpieza,
          :firma_quien_superviso, :uso_inventario_json,
          :estado, :creado_por, :actualizado_por, :creado_rol_id, :creado_cargo
      )
      `,
      { ...data, creado_por: userId, actualizado_por: userId, creado_rol_id: actuo.rol_id, creado_cargo: actuo.cargo },
    );
    const id = result.lastrowid as number;
    await applyStageInventory(s, "EXT", id, data.uso_inventario_json, `Extraccion ${data.tipo_registro} folio ${data.folio_num}`, userId);
    await aplicarSupervision(s, TABLE, id, supervision, userId);
    await guardarFirmantes(s, TABLE, id, data, firmasExtraccion(tipo));
    await advanceState(s, "muestras_procesamiento", data.procesamiento_id, "en_proceso");
    await avanzarRecepcion(s, "muestras_procesamiento", data.procesamiento_id, "en_extraccion");
    const despues = await snapshotRow(s, TABLE, id);
    await registrarAuditoria(s, user, { accion: "crear", entidad: TABLE, entidadId: id, referencia: folioLabel(TABLE, despues), despues, detalle: { actuo_como: actuo } });
    // Fase 11: uso confirmado de un equipo no apto -> incidencia automatica (sin duplicados).
    await incidenciasPorEquiposNoAptos(s, user, TABLE, id, folioLabel(TABLE, despues), await idsDeEquipos(s, usoDeEquipos(data.equipos_json).equipoIds, usoDeEquipos(data.equipos_json).equipoNombres), actuo.cargo);
    await recordBitacoraFolios(s, (safeJsonLoad(data.equipos_json, []) as Array<{ equipo_id?: unknown; folio_bitacora?: unknown }>).map((e) => ({ equipoId: e.equipo_id, folio: e.folio_bitacora })));
    await s.commit();
    return json({ message: "Extraccion creada", id, tipo_registro: tipo, folio_num: data.folio_num }, 201);
  } catch (error) {
    await s.rollback();
    // Fase 12: si el folio lo asigno el servidor, el choque es de concurrencia: se relanza y apiRoute reintenta.
    if (isFolioConflict(error) && toIntOrNull(payload.folio_num)) {
      return json({ message: `El folio ${formatearFolio(tipo, data.folio_num)} ya existe` }, 409);
    }
    throw error;
  }
}

export async function updateExtractionSample({ request, s, params }: RouteContext): Promise<Response> {
  const extractionId = intParam(params.id);
  const user = await requireUser(request);

  const antes = await snapshotRow(s, TABLE, extractionId);
  const permiso = await requirePermission(s, user, "ensayos", "E", { objeto: "extraccion", borrador: String(antes?.estado || "registrada") === "registrada" });
  const actuo = cargoActuante(request, permiso);
  await assertEditableAsync(s, antes, TABLE);
  const payload = await readJson(request);
  // Contraseñas de firmantes enviadas al guardar: se verifican antes de cualquier otra escritura.
  await verificarFirmasConPassword(s, user, payload, request);
  const tipo = await resolveType(s, payload, extractionId);
  if (!tipo) {
    return json({ message: "Tipo de extraccion no valido" }, 400);
  }
  // El formato (E-A ASP o E-D DSP) y su serie de folios se fijan al registrar: cambiarlo dejaría el folio en la serie equivocada.
  if (antes && normalizeExtractionType(antes.tipo_registro) && tipo !== normalizeExtractionType(antes.tipo_registro)) return json({ message: `La extracción es ${normalizeExtractionType(antes.tipo_registro)}; el formato no cambia (anúlala y registra otra)`, campo: "tipo_registro" }, 400);
  const data = normalizePayload(payload, tipo);
  // Fase 4: autorizacion FX-THF-AP: extraccion, metodo del tipo (E-A ASP, E-D DSP) y cada equipo del inventario usado.
  await exigirAutorizaciones(s, user, [...requisitosExtraccion(tipo), ...(await requisitosEquipos(s, (safeJsonLoad(data.equipos_json, []) as Array<{ equipo_id?: unknown }>).map((e) => e.equipo_id)))]);
  // Fase 11: metodo o equipo suspendido por una NC -> 409.
  await exigirSinSuspension(s, { metodos: [metodoDeExtraccion(tipo)], ...usoDeEquipos(data.equipos_json) });
  if (!data.folio_num) {
    return json({ message: "El folio de extraccion es obligatorio" }, 400);
  }
  await resolverFirmantes(s, user, payload, data, firmasExtraccion(tipo), antes);
  exigirSupervisorDistinto(data);
  // Fase 5: solo quien esta asignado a la muestra (o la coordinacion).
  await exigirAsignacion(s, user, await recepcionDe(s, "muestras_procesamiento", data.procesamiento_id), permiso.auth);
  // El origen se valida tambien al editar.
  const origen = await assertOrigin(s, "muestras_procesamiento", data.procesamiento_id, { requerido: ORIGEN_REQUERIDO });
  // El folio de la etapa anterior sale del registro vinculado, no de lo que mande el cliente.
  if (origen) data.folio_procesamiento_num = toIntOrNull(origen.folio_num);
  const supervision = marcaSupervision(permiso);
  if (data.estado === "anulada" || ["completada", "analizada"].includes(String(antes?.estado || ""))) data.estado = String(antes?.estado || "registrada");
  data.equipos_json = jsonText(await snapshotEquipos(s, normalizeEquipos(payload.equipos)));
  const userId = userIdFromClaims(user);

  try {
    const result = await s.execute(
      `
      UPDATE ${TABLE}
      SET folio_num = :folio_num,
          tipo_registro = :tipo_registro,
          clave_revision = :clave_revision,
          fecha_emision = :fecha_emision,
          fecha_extraccion = :fecha_extraccion,
          hora_extraccion = :hora_extraccion,
          procesamiento_id = :procesamiento_id,
          folio_procesamiento_num = :folio_procesamiento_num,
          muestra_tipo = :muestra_tipo,
          id_interno = :id_interno,
          tipo_molienda = :tipo_molienda,
          pasos_json = :pasos_json,
          registro_pesos_json = :registro_pesos_json,
          equipos_json = :equipos_json,
          observaciones_generales = :observaciones_generales,
          nombre_quien_extrajo = :nombre_quien_extrajo,
          nombre_quien_limpieza = :nombre_quien_limpieza,
          nombre_quien_superviso = :nombre_quien_superviso,
          firma_quien_extrajo = :firma_quien_extrajo,
          firma_quien_limpieza = :firma_quien_limpieza,
          firma_quien_superviso = :firma_quien_superviso,
          uso_inventario_json = :uso_inventario_json,
          estado = :estado,
          actualizado_por = :actualizado_por
      WHERE id = :id
      `,
      { ...data, id: extractionId, actualizado_por: userId },
    );
    if (result.rowcount === 0) {
      await s.rollback();
      return json({ message: "Registro no encontrado" }, 404);
    }
    await replaceInventoryUsage(s, user, extractionId, data, folioLabel(TABLE, antes), insumosDeclarados(antes?.uso_inventario_json));
    await aplicarSupervision(s, TABLE, extractionId, supervision, userId);
    await guardarFirmantes(s, TABLE, extractionId, data, firmasExtraccion(tipo));
    await advanceState(s, "muestras_procesamiento", data.procesamiento_id, "en_proceso");
    await avanzarRecepcion(s, "muestras_procesamiento", data.procesamiento_id, "en_extraccion");
    const despues = await snapshotRow(s, TABLE, extractionId);
    await registrarAuditoria(s, user, { accion: "editar", entidad: TABLE, entidadId: extractionId, referencia: folioLabel(TABLE, despues), antes, despues, detalle: { actuo_como: actuo } });
    await incidenciasPorEquiposNoAptos(s, user, TABLE, extractionId, folioLabel(TABLE, despues), await idsDeEquipos(s, usoDeEquipos(data.equipos_json).equipoIds, usoDeEquipos(data.equipos_json).equipoNombres), actuo.cargo);
    await recordBitacoraFolios(s, (safeJsonLoad(data.equipos_json, []) as Array<{ equipo_id?: unknown; folio_bitacora?: unknown }>).map((e) => ({ equipoId: e.equipo_id, folio: e.folio_bitacora })));
    await s.commit();
    return json({ message: "Extraccion actualizada" });
  } catch (error) {
    await s.rollback();
    if (isFolioConflict(error)) {
      return json({ message: `El folio ${formatearFolio(tipo, data.folio_num)} ya existe` }, 409);
    }
    throw error;
  }
}

/* Los registros tecnicos no se eliminan; se anulan con motivo. */
export async function deleteExtractionSample({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await requirePermission(s, user, "ensayos", "AN");
  return deletionNotAllowed();
}

export async function anularExtractionSample({ request, s, params }: RouteContext): Promise<Response> {
  const extractionId = intParam(params.id);
  const user = await requireUser(request);
  const actuo = cargoActuante(request, await requirePermission(s, user, "ensayos", "AN"));
  const motivo = await readMotivo(request);
  await exigirReauth(s, request, user, "ensayos:AN");
  const { row, solicitud } = await anularOSolicitar(s, user, TABLE, extractionId, motivo, actuo);
  await s.commit();
  if (solicitud) return respuestaSolicitud(solicitud, `la anulación de la extracción ${solicitud.referencia}`);
  return json({ message: "Extraccion anulada; el inventario descontado fue repuesto", item: serializeRow(row!) });
}

export async function restaurarExtractionSample({ request, s, params }: RouteContext): Promise<Response> {
  const extractionId = intParam(params.id);
  const user = await requireUser(request);
  const actuo = cargoActuante(request, await requirePermission(s, user, "ensayos", "AN"));
  await exigirReauth(s, request, user, "ensayos:AN");
  const { row, solicitud } = await restaurarOSolicitar(s, user, TABLE, extractionId, await readMotivo(request), actuo);
  await s.commit();
  if (solicitud) return respuestaSolicitud(solicitud, `la restauración de la extracción ${solicitud.referencia}`);
  return json({ message: "Extraccion restaurada. El inventario no se vuelve a descontar: revisa los insumos y guarda de nuevo si aplica", item: serializeRow(row!) });
}
