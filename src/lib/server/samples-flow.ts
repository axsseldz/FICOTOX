import { formatearFolio } from "../shared/folios";
import type { CurrentUser } from "./auth";
import { registrarAuditoria, snapshotRow } from "./audit";
import { esConflictoDeFolio, type Row, type Session } from "./db";
import { HttpError, readJson } from "./http";
import { consumeConsumible, consumeReactivo, restoreInventoryUsage } from "./inventory-usage";

import { requirePermission, type Autorizacion } from "./rbac";
import { exigirSinSupervisionPendiente } from "./supervision";
import { crearSolicitud, exigirSinSolicitudPendiente, pendientesDe, serializarSolicitud, type Solicitud } from "./solicitudes";
import { ESTADOS_BORRADOR } from "../shared/acciones-criticas";
import { RECEPTION_STATE_RANK } from "../shared/sgc";

/*
 * Reglas comunes del flujo de muestras (ISO/IEC 17025 7.4, 7.5 y la
 * induccion PVVC): los registros tecnicos no se eliminan, se anulan con
 * motivo; no se avanza de etapa desde un registro anulado o rechazado; el
 * estado de la etapa anterior avanza solo cuando existe la siguiente.
 */

export type SampleTable = "muestras_recepcion" | "muestras_procesamiento" | "muestras_extraccion" | "muestras_analisis";

const FOLIO_PREFIX: Record<SampleTable, string> = {
  muestras_recepcion: "R",
  muestras_procesamiento: "P",
  muestras_extraccion: "E",
  muestras_analisis: "A",
};

const LABEL: Record<SampleTable, string> = {
  muestras_recepcion: "recepcion",
  muestras_procesamiento: "procesamiento",
  muestras_extraccion: "extraccion",
  muestras_analisis: "analisis",
};

/* Las tablas heredadas usan el femenino ("anulada"); el analisis, el masculino. */
const ANULADO_VALUE: Record<SampleTable, string> = {
  muestras_recepcion: "anulada",
  muestras_procesamiento: "anulada",
  muestras_extraccion: "anulada",
  muestras_analisis: "anulado",
};

/* Estados desde los que ya no se edita ni se continua el flujo. */
const LOCKED_STATES: Record<SampleTable, Set<string>> = {
  // Fase 5: una recepcion liberada (informe autorizado) ya no se edita.
  muestras_recepcion: new Set(["anulada", "rechazada", "cerrada", "liberada"]),
  muestras_procesamiento: new Set(["anulada"]),
  muestras_extraccion: new Set(["anulada"]),
  muestras_analisis: new Set(["anulado", "aprobado"]),
};

/* Etapa anterior de cada tabla (para validar el origen al restaurar). */
const PARENT: Partial<Record<SampleTable, { table: SampleTable; column: string }>> = {
  muestras_procesamiento: { table: "muestras_recepcion", column: "recepcion_id" },
  muestras_extraccion: { table: "muestras_procesamiento", column: "procesamiento_id" },
  muestras_analisis: { table: "muestras_extraccion", column: "extraccion_id" },
};

/* Orden del ciclo de vida: solo se avanza hacia adelante de forma automatica. */
const STATE_RANK: Record<string, number> = {
  registrada: 0,
  aceptada: 1,
  en_proceso: 2,
  completada: 3,
  analizada: 3,
  informada: 4,
  cerrada: 5,
};

/* Rol con el que actua quien captura, firma, revisa, aprueba o anula (rbac.cargoActuante). */
export interface Actuo {
  rol_id: number;
  cargo: string;
}

/*
 * Capturar un ensayo que declara equipos usados o insumos consumidos exige
 * ademas registrar uso de equipos (equipos:C, alcance "uso" o mayor) y
 * movimientos de inventario (inventario:C, alcance "movimientos" o mayor).
 */
export async function exigirUsoDeRecursos(s: Session, user: CurrentUser, auth: Autorizacion, uso: { equipos: boolean; insumosJson?: string | null }): Promise<void> {
  if (uso.equipos) await requirePermission(s, user, "equipos", "C", { objeto: "uso_equipo" }, auth);
  let insumos: unknown = [];
  try {
    insumos = JSON.parse(String(uso.insumosJson || "[]"));
  } catch {
    insumos = [];
  }
  if (Array.isArray(insumos) && insumos.length) await requirePermission(s, user, "inventario", "C", { objeto: "movimiento" }, auth);
}

export function folioLabel(table: SampleTable, row: Row | null | undefined): string {
  if (!row) return LABEL[table];
  const prefix = table === "muestras_extraccion" ? String(row.tipo_registro || "E-A") : FOLIO_PREFIX[table];
  // Fase 5: las enmiendas de analisis conservan el folio con su version.
  const version = table === "muestras_analisis" && Number(row.version || 1) > 1 ? ` v${row.version}` : "";
  return `${formatearFolio(prefix, row.folio_num)}${version}`;
}

function isAnulado(table: SampleTable, row: Row | null | undefined): boolean {
  return !!row && String(row.estado || "") === ANULADO_VALUE[table];
}

/* Un registro anulado, rechazado, cerrado o aprobado no se edita. */
function assertEditable(row: Row | null | undefined, table: SampleTable): void {
  if (!row) throw new HttpError(404, { message: "Registro no encontrado" });
  const estado = String(row.estado || "");
  if (isAnulado(table, row)) throw new HttpError(409, { message: `El registro ${folioLabel(table, row)} esta anulado y no se puede modificar` });
  if (LOCKED_STATES[table].has(estado)) {
    throw new HttpError(409, { message: `El registro ${folioLabel(table, row)} esta en estado "${estado}" y ya no se modifica; si hay un error, anulalo con motivo` });
  }
}

/*
 * Fase 3: un registro con una solicitud de autorizacion pendiente (anulacion,
 * restauracion) no se edita, revisa, aprueba ni sirve de origen.
 */
export async function assertEditableAsync(s: Session, row: Row | null | undefined, table: SampleTable, que = "editar"): Promise<void> {
  assertEditable(row, table);
  await exigirSinSolicitudPendiente(s, table, Number(row!.id), `El registro ${folioLabel(table, row)}`, que);
}

/* Agrega a cada fila la solicitud pendiente (si la hay) para las listas y fichas. */
export async function conSolicitudes<T extends Row>(s: Session, table: SampleTable, rows: T[]): Promise<Array<T & { solicitud_pendiente: Record<string, unknown> | null }>> {
  const pendientes = await pendientesDe(s, table, rows.map((r) => Number(r.id)));
  return rows.map((r) => {
    const p = pendientes.get(String(r.id));
    return { ...r, solicitud_pendiente: p ? serializarSolicitud(p) : null };
  });
}

/*
 * Inventario a reponer y dependientes que bloquean la anulacion de cada etapa.
 * Se usa al anular directamente y al ejecutar una solicitud aprobada.
 */
export function opcionesAnulacion(s: Session, table: SampleTable, id: number): { movimientosPrefix?: string; bloqueaSi: () => Promise<string | null> } {
  switch (table) {
    case "muestras_recepcion":
      return {
        bloqueaSi: async () => {
          const activos = Number((await s.scalar("SELECT COUNT(*) FROM muestras_procesamiento WHERE recepcion_id = :id AND estado <> 'anulada'", { id })) || 0);
          return activos ? `La recepcion tiene ${activos} procesamiento(s) vigente(s); anulalos primero` : null;
        },
      };
    case "muestras_procesamiento":
      return {
        movimientosPrefix: `PROC-${id}-INS-`,
        bloqueaSi: async () => {
          const activas = Number((await s.scalar("SELECT COUNT(*) FROM muestras_extraccion WHERE procesamiento_id = :id AND estado <> 'anulada'", { id })) || 0);
          return activas ? `El procesamiento tiene ${activas} extraccion(es) vigente(s); anulalas primero` : null;
        },
      };
    case "muestras_extraccion":
      return {
        movimientosPrefix: `EXT-${id}-INS-`,
        bloqueaSi: async () => {
          const activos = Number((await s.scalar("SELECT COUNT(*) FROM muestras_analisis WHERE extraccion_id = :id AND estado <> 'anulado'", { id })) || 0);
          return activos ? `La extraccion tiene ${activos} analisis vigente(s); anulalos primero` : null;
        },
      };
    case "muestras_analisis":
      return {
        movimientosPrefix: `ANA-${id}-INS-`,
        bloqueaSi: async () => {
          const informes = await s.query<{ folio_num: number; analisis_ids_json: string }>("SELECT folio_num, analisis_ids_json FROM informes WHERE estado IN ('autorizado', 'liberado', 'enviado')").catch(() => []);
          const usado = informes.find((inf) => {
            try {
              return (JSON.parse(String(inf.analisis_ids_json || "[]")) as number[]).includes(id);
            } catch {
              return false;
            }
          });
          return usado ? `El analisis esta incluido en el informe ${formatearFolio("IR", usado.folio_num)} autorizado; anula o enmienda el informe primero` : null;
        },
      };
  }
}

/*
 * Anular con segundo usuario (Fase 3): en borrador/registrado se anula de
 * inmediato; en cualquier otro estado (aceptada, en proceso, revisado,
 * aprobado...) se crea una solicitud que ejecuta quien la apruebe.
 */
export async function anularOSolicitar(s: Session, user: CurrentUser, table: SampleTable, id: number, motivo: string, actuo: Actuo): Promise<{ row?: Row; solicitud?: Solicitud }> {
  if (motivo.length < 5) throw new HttpError(400, { message: "Indica el motivo de la anulacion (al menos 5 caracteres)" });
  const antes = await snapshotRow(s, table, id);
  if (!antes) throw new HttpError(404, { message: "Registro no encontrado" });
  if (isAnulado(table, antes)) throw new HttpError(409, { message: "El registro ya esta anulado" });
  const opciones = opcionesAnulacion(s, table, id);
  if (ESTADOS_BORRADOR.has(String(antes.estado || ""))) return { row: await anularRegistro(s, user, table, id, motivo, { ...opciones, actuo }) };
  const bloqueo = await opciones.bloqueaSi();
  if (bloqueo) throw new HttpError(409, { message: bloqueo });
  const solicitud = await crearSolicitud(s, user, { tipo: "anular_registro", entidad: table, entidadId: id, referencia: folioLabel(table, antes), accion: "anular", datos: { estado: antes.estado }, motivo, cargo: actuo.cargo });
  return { solicitud };
}

/* Restaurar con segundo usuario: inmediato si antes de anularse estaba en borrador/registrado. */
export async function restaurarOSolicitar(s: Session, user: CurrentUser, table: SampleTable, id: number, motivo: string, actuo: Actuo): Promise<{ row?: Row; solicitud?: Solicitud }> {
  if (motivo.length < 5) throw new HttpError(400, { message: "Indica el motivo de la restauracion (al menos 5 caracteres)" });
  const antes = await snapshotRow(s, table, id);
  if (!antes) throw new HttpError(404, { message: "Registro no encontrado" });
  if (!isAnulado(table, antes)) throw new HttpError(409, { message: "El registro no esta anulado" });
  const previo = String(antes.estado_previo || (table === "muestras_analisis" ? "registrado" : "registrada"));
  if (ESTADOS_BORRADOR.has(previo)) return { row: await restaurarRegistro(s, user, table, id, motivo, actuo) };
  const solicitud = await crearSolicitud(s, user, { tipo: "restaurar_registro", entidad: table, entidadId: id, referencia: folioLabel(table, antes), accion: "restaurar", datos: { estado_previo: previo }, motivo, cargo: actuo.cargo });
  return { solicitud };
}

/* Antes de crear la siguiente etapa a partir de este registro (o de restaurar una que depende de el). */
export async function assertOrigin(s: Session, table: SampleTable, id: number | null | undefined, options: { requireAccepted?: boolean; requerido?: string } = {}): Promise<Row | null> {
  // Fase 2: cada etapa exige su origen (procesamiento <- recepcion aceptada, extraccion <- procesamiento...).
  if (!id) {
    if (options.requerido) throw new HttpError(400, { message: options.requerido, codigo: "origen_requerido" });
    return null;
  }
  const row = await snapshotRow(s, table, id);
  if (!row) throw new HttpError(404, { message: `No existe la ${LABEL[table]} de origen` });
  // Lo pendiente del visto bueno de un supervisor, o de una autorizacion, no sirve de origen.
  exigirSinSupervisionPendiente(row, `La ${LABEL[table]} ${folioLabel(table, row)}`, "continuar a partir de ella");
  await exigirSinSolicitudPendiente(s, table, id, `La ${LABEL[table]} ${folioLabel(table, row)}`, "continuar a partir de ella");
  const estado = String(row.estado || "");
  if (isAnulado(table, row)) throw new HttpError(409, { message: `La ${LABEL[table]} ${folioLabel(table, row)} esta anulada; no se puede continuar a partir de ella` });
  if (estado === "rechazada") throw new HttpError(409, { message: `La ${LABEL[table]} ${folioLabel(table, row)} fue rechazada; no se puede continuar a partir de ella` });
  if (options.requireAccepted) {
    const decision = String(row.decision_aceptacion || "");
    if (!["aceptada", "aceptada_con_desviacion"].includes(decision)) {
      throw new HttpError(409, { message: `La recepcion ${folioLabel(table, row)} no tiene registrada la decision de aceptacion de la muestra` });
    }
  }
  return row;
}

/* Avanza el estado de la etapa anterior sin retroceder nunca. */
export async function advanceState(s: Session, table: SampleTable, id: number | null | undefined, estado: string): Promise<void> {
  if (!id) return;
  const row = await s.queryOne<{ estado: string }>(`SELECT estado FROM ${table} WHERE id = :id`, { id });
  if (!row) return;
  const current = String(row.estado || "");
  if (LOCKED_STATES[table].has(current)) return;
  const rank = table === "muestras_recepcion" ? RECEPTION_STATE_RANK : STATE_RANK;
  if ((rank[current] ?? 0) >= (rank[estado] ?? 0)) return;
  await s.execute(`UPDATE ${table} SET estado = :estado WHERE id = :id`, { estado, id });
}

/* Fase 5: avanza la recepcion de origen de un registro (procesamiento, extraccion o analisis). */
export async function avanzarRecepcion(s: Session, table: SampleTable, id: number | null | undefined, estado: string): Promise<void> {
  const recepcionId = await recepcionDe(s, table, id);
  if (recepcionId) await advanceState(s, "muestras_recepcion", recepcionId, estado);
}

/* Recepcion a la que pertenece un registro del flujo. */
export async function recepcionDe(s: Session, table: SampleTable, id: number | null | undefined): Promise<number | null> {
  if (!id) return null;
  if (table === "muestras_recepcion") return Number(id);
  if (table === "muestras_procesamiento" || table === "muestras_analisis") {
    const v = await s.scalar(`SELECT recepcion_id FROM ${table} WHERE id = :id`, { id });
    return v ? Number(v) : null;
  }
  const v = await s.scalar("SELECT p.recepcion_id FROM muestras_extraccion e INNER JOIN muestras_procesamiento p ON p.id = e.procesamiento_id WHERE e.id = :id", { id });
  return v ? Number(v) : null;
}

/*
 * Fase 5: la recepcion queda "validada" cuando todos sus analisis vigentes (ni
 * anulados ni sustituidos) estan aprobados.
 */
export async function validarRecepcionSiCompleta(s: Session, recepcionId: number | null | undefined): Promise<void> {
  if (!recepcionId) return;
  const pendientes = Number((await s.scalar("SELECT COUNT(*) FROM muestras_analisis WHERE recepcion_id = :id AND estado NOT IN ('aprobado', 'anulado', 'sustituido')", { id: recepcionId })) || 0);
  const aprobados = Number((await s.scalar("SELECT COUNT(*) FROM muestras_analisis WHERE recepcion_id = :id AND estado = 'aprobado'", { id: recepcionId })) || 0);
  if (!pendientes && aprobados) await advanceState(s, "muestras_recepcion", recepcionId, "validada");
}

export async function readMotivo(request: Request): Promise<string> {
  const payload = await readJson(request);
  return String(payload.motivo || "").trim();
}

/*
 * Anulacion con motivo obligatorio. Repone el inventario descontado por el
 * registro (prefijo de referencia de movimientos) y deja auditoria.
 */
export async function anularRegistro(
  s: Session,
  user: CurrentUser,
  table: SampleTable,
  id: number,
  motivo: string,
  options: { movimientosPrefix?: string; bloqueaSi?: () => Promise<string | null>; actuo?: Actuo; detalle?: Record<string, unknown> } = {},
): Promise<Row> {
  if (motivo.length < 5) throw new HttpError(400, { message: "Indica el motivo de la anulacion (al menos 5 caracteres)" });
  const antes = await snapshotRow(s, table, id);
  if (!antes) throw new HttpError(404, { message: "Registro no encontrado" });
  if (isAnulado(table, antes)) throw new HttpError(409, { message: "El registro ya esta anulado" });
  if (options.bloqueaSi) {
    const bloqueo = await options.bloqueaSi();
    if (bloqueo) throw new HttpError(409, { message: bloqueo });
  }
  const userId = Number.parseInt(String(user.sub || ""), 10) || null;
  await s.execute(
    `UPDATE ${table} SET estado_previo = :estado_previo, estado = :anulado, anulado_en = :anulado_en, anulado_por = :anulado_por, anulado_rol_id = :rol_id, anulado_cargo = :cargo, motivo_anulacion = :motivo WHERE id = :id`,
    { estado_previo: String(antes.estado || "registrada"), anulado: ANULADO_VALUE[table], anulado_en: new Date().toISOString(), anulado_por: userId, rol_id: options.actuo?.rol_id ?? null, cargo: options.actuo?.cargo ?? null, motivo, id },
  );
  let repuestos = 0;
  if (options.movimientosPrefix) {
    repuestos = await restoreInventoryUsage(s, options.movimientosPrefix);
  }
  const despues = await snapshotRow(s, table, id);
  await registrarAuditoria(s, user, {
    accion: "anular",
    entidad: table,
    entidadId: id,
    referencia: folioLabel(table, antes),
    motivo,
    antes,
    despues,
    detalle: repuestos || options.actuo || options.detalle ? { ...(repuestos ? { movimientos_repuestos: repuestos } : {}), ...(options.actuo ? { actuo_como: options.actuo } : {}), ...(options.detalle || {}) } : null,
  });
  return despues || antes;
}

/*
 * Restaurar un registro anulado (queda en auditoria con motivo). Exige que la
 * etapa de origen siga vigente. El inventario no se vuelve a descontar solo.
 */
export async function restaurarRegistro(s: Session, user: CurrentUser, table: SampleTable, id: number, motivo: string, actuo?: Actuo, detalle?: Record<string, unknown>): Promise<Row> {
  if (motivo.length < 5) throw new HttpError(400, { message: "Indica el motivo de la restauracion (al menos 5 caracteres)" });
  const antes = await snapshotRow(s, table, id);
  if (!antes) throw new HttpError(404, { message: "Registro no encontrado" });
  if (!isAnulado(table, antes)) throw new HttpError(409, { message: "El registro no esta anulado" });
  const parent = PARENT[table];
  if (parent) {
    const parentId = Number(antes[parent.column] || 0) || null;
    if (parentId) await assertOrigin(s, parent.table, parentId, { requireAccepted: parent.table === "muestras_recepcion" });
  }
  const estado = String(antes.estado_previo || (table === "muestras_analisis" ? "registrado" : "registrada"));
  await s.execute(`UPDATE ${table} SET estado = :estado, estado_previo = NULL, anulado_en = NULL, anulado_por = NULL, anulado_rol_id = NULL, anulado_cargo = NULL, motivo_anulacion = NULL WHERE id = :id`, { estado, id });
  const despues = await snapshotRow(s, table, id);
  await registrarAuditoria(s, user, { accion: "restaurar", entidad: table, entidadId: id, referencia: folioLabel(table, antes), motivo, antes, despues, detalle: actuo || detalle ? { ...(actuo ? { actuo_como: actuo } : {}), ...(detalle || {}) } : null });
  return despues || antes;
}

/* Cantidad total por insumo (`tipo:ref`) que un registro ya tenia declarada. */
export function insumosDeclarados(usoInventarioJson: unknown): Map<string, number> {
  const totales = new Map<string, number>();
  try {
    const filas = JSON.parse(String(usoInventarioJson || "[]"));
    if (!Array.isArray(filas)) return totales;
    for (const fila of filas) {
      if (!fila || typeof fila !== "object" || Array.isArray(fila)) continue;
      const item = fila as Record<string, unknown>;
      const ref = item.ref || item.nombre || "";
      if (!ref) continue;
      const clave = `${String(item.tipo || "").trim().toLowerCase()}:${String(ref)}`;
      totales.set(clave, (totales.get(clave) || 0) + (Number(item.cantidad) || 0));
    }
  } catch {
    /* JSON invalido: sin insumos previos */
  }
  return totales;
}

/* Los registros tecnicos no se eliminan (FX-MC 7.5.2). */
export function deletionNotAllowed(): never {
  throw new HttpError(405, { message: "Los registros tecnicos no se eliminan: anule el registro indicando el motivo" });
}

/* ---------- Folios ---------- */

/* Siguiente folio de una serie (opcionalmente acotada, p. ej. por tipo de extraccion). */
export async function nextFolioNum(s: Session, table: SampleTable | "informes", where = "", params: Record<string, unknown> = {}): Promise<number> {
  const max = await s.scalar(`SELECT MAX(folio_num) FROM ${table}${where ? ` WHERE ${where}` : ""}`, params);
  return (Number.parseInt(String(max ?? 0), 10) || 0) + 1;
}

/* Violacion de unicidad del folio (indice uq_*_folio_num o restriccion sobre folio_num). */
export function isFolioConflict(error: unknown): boolean {
  return esConflictoDeFolio(error);
}

/* ---------- Inventario de una etapa ---------- */

/* Etapa a la que se vincula el movimiento automatico (el acceso a ese folio ya lo valido el formato que consume). */
const VINCULO_DE_PREFIJO: Record<string, string> = { PROC: "procesamiento", EXT: "extraccion", ANA: "analisis" };

/*
 * Descuenta los insumos declarados en `uso_inventario_json` con referencias
 * `<prefijo>-<id>-INS-<n>`, para que la anulacion o la reedicion puedan
 * reponerlos por prefijo (restoreInventoryUsage).
 */
export async function applyStageInventory(
  s: Session,
  prefix: string,
  id: number,
  usoInventarioJson: string | null | undefined,
  motivo: string,
  userId: number | null,
  /* Cantidad por insumo (`tipo:ref`) que el registro ya declaraba antes de esta edicion. */
  declaradosAntes: Map<string, number> = new Map(),
): Promise<void> {
  let insumos: unknown = [];
  try {
    insumos = JSON.parse(String(usoInventarioJson || "[]"));
  } catch {
    return;
  }
  if (!Array.isArray(insumos)) return;
  // Un insumo dado de baja se puede reponer hasta la cantidad que el registro ya
  // declaraba, pero no consumir mas existencias de un articulo retirado.
  const solicitado = new Map<string, number>();
  for (const fila of insumos) {
    if (!fila || typeof fila !== "object" || Array.isArray(fila)) continue;
    const item = fila as Record<string, unknown>;
    const ref = item.ref || item.nombre || "";
    if (!ref) continue;
    const clave = `${String(item.tipo || "").trim().toLowerCase()}:${String(ref)}`;
    solicitado.set(clave, (solicitado.get(clave) || 0) + (Number(item.cantidad) || 1));
  }
  for (let idx = 0; idx < insumos.length; idx += 1) {
    const insumo = insumos[idx];
    if (!insumo || typeof insumo !== "object" || Array.isArray(insumo)) continue;
    const item = insumo as Record<string, unknown>;
    const tipo = String(item.tipo || "").trim().toLowerCase();
    const ref = item.ref || item.nombre || "";
    if (!ref) continue;
    const clave = `${tipo}:${String(ref)}`;
    const previo = declaradosAntes.get(clave);
    const options = { userId, motivo, referencia: `${prefix}-${id}-INS-${idx}`, vinculoTipo: VINCULO_DE_PREFIJO[prefix] ?? null, vinculoId: VINCULO_DE_PREFIJO[prefix] ? id : null, permitirInactivo: previo !== undefined && (solicitado.get(clave) || 0) <= previo + 1e-9 };
    if (tipo === "reactivo") await consumeReactivo(s, ref, item.cantidad || 1, options);
    else if (tipo === "consumible") await consumeConsumible(s, ref, item.cantidad || 1, options);
  }
}
