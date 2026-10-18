import { formatearFolio } from "../shared/folios";
import { requireUser, type CurrentUser } from "./auth";
import { registrarAuditoria, snapshotRow } from "./audit";
import type { Row, Session } from "./db";
import { HttpError, json, readJson, type RouteContext } from "./http";
import { cargarAutorizacion, permisoDe, soloSupervisado, type Permiso } from "./rbac";

import { getConfig } from "./config";
import { exigirReauth } from "./seguridad";
import type { Modulo } from "../shared/permisos";
import { evaluarVistoBueno } from "../shared/segregacion";
import { elaboradoresDe } from "./segregacion";

/*
 * Alcance "supervisado" aplicado (Fase 2; FX-MO-2-1, seccion 9).
 *
 * Lo que crea o edita una persona supervisada queda pendiente del visto bueno
 * de su supervisor (el de su cuenta). Una persona es supervisada en una
 * operacion cuando:
 *   - la operacion solo la cubre el alcance "supervisado", o
 *   - su cuenta es temporal con supervisor (personal en formacion, estancias),
 *     salvo SUPERVISAR_CUENTAS_TEMPORALES=false (decision pendiente de validar).
 * Mientras esta pendiente (o regresado con observaciones) el registro no se
 * cierra, no se completa, no se revisa ni aprueba y no sirve de origen de la
 * etapa siguiente. El supervisor da el visto bueno (con reautenticacion) o lo
 * regresa con observaciones; ambos quedan en la bitacora.
 */

export type TablaSupervisable =
  | "muestras_recepcion"
  | "muestras_procesamiento"
  | "muestras_extraccion"
  | "muestras_analisis"
  | "informes"
  | "equipos"
  | "mantenimientos"
  | "reactivos"
  | "consumibles";

interface Supervisable {
  modulo: Modulo;
  etiqueta: string;
  href: (id: number) => string;
}

const SUPERVISABLES: Record<TablaSupervisable, Supervisable> = {
  muestras_recepcion: { modulo: "muestras", etiqueta: "Recepción", href: (id) => `/muestras/recepcion/${id}` },
  muestras_procesamiento: { modulo: "ensayos", etiqueta: "Procesamiento", href: (id) => `/muestras/procesamiento/${id}` },
  muestras_extraccion: { modulo: "ensayos", etiqueta: "Extracción", href: (id) => `/muestras/extraccion/${id}` },
  muestras_analisis: { modulo: "ensayos", etiqueta: "Análisis", href: (id) => `/muestras/analisis/${id}` },
  informes: { modulo: "informes", etiqueta: "Informe", href: (id) => `/informes/${id}` },
  equipos: { modulo: "equipos", etiqueta: "Equipo", href: () => "/inventario/equipos?supervision=pendiente" },
  mantenimientos: { modulo: "equipos", etiqueta: "Mantenimiento", href: () => "/inventario/mantenimiento?supervision=pendiente" },
  reactivos: { modulo: "inventario", etiqueta: "Reactivo", href: () => "/inventario/reactivos?supervision=pendiente" },
  consumibles: { modulo: "inventario", etiqueta: "Consumible", href: () => "/inventario/consumibles?supervision=pendiente" },
};

const PREFIJO_FOLIO: Partial<Record<TablaSupervisable, string>> = {
  muestras_recepcion: "R",
  muestras_procesamiento: "P",
  muestras_extraccion: "E",
  muestras_analisis: "A",
  informes: "IR",
};

function esTablaSupervisable(tabla: string): tabla is TablaSupervisable {
  return Object.prototype.hasOwnProperty.call(SUPERVISABLES, tabla);
}

export interface MarcaSupervision {
  supervisor_id: number;
}

/*
 * ¿Lo que esta persona crea o edita con este permiso queda pendiente de
 * supervision? Devuelve el supervisor de su cuenta o null. Si la operacion
 * solo la cubre "supervisado" y la cuenta no tiene supervisor: 409.
 */
export function marcaSupervision(permiso: Permiso): MarcaSupervision | null {
  const cuenta = permiso.auth.cuenta;
  const porAlcance = soloSupervisado(permiso);
  const porCuenta = getConfig().SUPERVISAR_CUENTAS_TEMPORALES && cuenta.tipo_cuenta === "temporal" && !!cuenta.supervisor_id;
  if (!porAlcance && !porCuenta) return null;
  if (!cuenta.supervisor_id) {
    throw new HttpError(409, { message: "Tu permiso para esta operación es bajo supervisión y tu cuenta no tiene supervisor asignado; pide al administrador que lo asigne", codigo: "sin_supervisor" });
  }
  return { supervisor_id: cuenta.supervisor_id };
}

/* Tras crear o editar: deja el registro pendiente del visto bueno (si aplica). */
export async function aplicarSupervision(s: Session, tabla: TablaSupervisable, id: number, marca: MarcaSupervision | null, userId: number | null): Promise<void> {
  if (!marca) return;
  await s.execute(
    `UPDATE ${tabla} SET requiere_supervision = 1, supervision_estado = 'pendiente', supervisor_id = :sup,
       supervision_solicitada_por = :por, supervision_solicitada_en = :en, supervisado_por = NULL, supervisado_en = NULL
     WHERE id = :id`,
    { sup: marca.supervisor_id, por: userId, en: new Date().toISOString(), id },
  );
}

function supervisionPendiente(row: Row | null | undefined): boolean {
  return !!row && Number(row.requiere_supervision || 0) === 1 && ["pendiente", "regresado"].includes(String(row.supervision_estado || ""));
}

/* El registro no avanza (cerrar, completar, revisar, aprobar, ser origen) sin visto bueno. */
export function exigirSinSupervisionPendiente(row: Row | null | undefined, referencia: string, que: string): void {
  if (!supervisionPendiente(row)) return;
  const regresado = String(row?.supervision_estado) === "regresado";
  throw new HttpError(409, {
    message: `${referencia} ${regresado ? "fue regresado con observaciones por su supervisor" : "está pendiente del visto bueno de su supervisor"}; no se puede ${que}`,
    codigo: "supervision_pendiente",
  });
}

function referenciaDe(tabla: TablaSupervisable, row: Row): string {
  const prefijo = PREFIJO_FOLIO[tabla];
  if (prefijo) {
    const base = tabla === "muestras_extraccion" ? String(row.tipo_registro || "E-A") : prefijo;
    return formatearFolio(base, row.folio_num);
  }
  if (tabla === "reactivos") return String(row.producto || row.nombre || "Reactivo");
  if (tabla === "consumibles") return String(row.producto || "Consumible");
  if (tabla === "mantenimientos") return `Mantenimiento ${row.tipo || ""} #${row.id}`.trim();
  return String(row.nombre || `${SUPERVISABLES[tabla].etiqueta} #${row.id}`);
}

/* ---------- Bandeja y acciones del supervisor ---------- */

/*
 * GET /api/supervision: "Por supervisar" (registros pendientes cuyo supervisor
 * soy yo) y "Regresados" (lo mio que el supervisor regreso con observaciones).
 * Lo pendiente sigue visible al supervisor aunque la cuenta supervisada venza.
 */
export async function bandejaSupervision({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const auth = await cargarAutorizacion(s, user);
  const porSupervisar: Row[] = [];
  const regresados: Row[] = [];
  for (const tabla of Object.keys(SUPERVISABLES) as TablaSupervisable[]) {
    const def = SUPERVISABLES[tabla];
    const filas = await s.query<Row>(
      `SELECT t.*, u.nombre AS solicitante_nombre FROM ${tabla} t LEFT JOIN usuarios u ON u.id = t.supervision_solicitada_por
       WHERE t.requiere_supervision = 1 AND ((t.supervision_estado = 'pendiente' AND t.supervisor_id = :yo) OR (t.supervision_estado = 'regresado' AND t.supervision_solicitada_por = :yo))
       ORDER BY t.supervision_solicitada_en ASC LIMIT 200`,
      { yo: auth.userId },
    );
    for (const fila of filas) {
      const item = {
        tabla,
        id: Number(fila.id),
        tipo: def.etiqueta,
        referencia: referenciaDe(tabla, fila),
        estado: fila.supervision_estado,
        solicitado_por: fila.solicitante_nombre || null,
        solicitado_en: fila.supervision_solicitada_en || null,
        observaciones: fila.supervision_observaciones || null,
        href: def.href(Number(fila.id)),
      };
      if (fila.supervision_estado === "pendiente") porSupervisar.push(item);
      else regresados.push(item);
    }
  }
  return json({ por_supervisar: porSupervisar, regresados, total: porSupervisar.length });
}

/* Solo cuenta para el aviso del Inicio. */
export async function contarPorSupervisar(s: Session, userId: number): Promise<Row[]> {
  const out: Row[] = [];
  for (const tabla of Object.keys(SUPERVISABLES) as TablaSupervisable[]) {
    const filas = await s.query<Row>(`SELECT * FROM ${tabla} WHERE requiere_supervision = 1 AND supervision_estado = 'pendiente' AND supervisor_id = :yo ORDER BY supervision_solicitada_en ASC LIMIT 20`, { yo: userId });
    for (const fila of filas) out.push({ tabla, id: Number(fila.id), tipo: SUPERVISABLES[tabla].etiqueta, referencia: referenciaDe(tabla, fila), href: SUPERVISABLES[tabla].href(Number(fila.id)), solicitada_en: fila.supervision_solicitada_en ?? null, solicitada_por: fila.supervision_solicitada_por ?? null });
  }
  return out;
}

async function registroSupervisado(s: Session, user: CurrentUser, params: Record<string, string | string[]>): Promise<{ tabla: TablaSupervisable; id: number; row: Row; userId: number }> {
  const tabla = String(params.tabla || "");
  if (!esTablaSupervisable(tabla)) throw new HttpError(404, { message: "Tipo de registro no supervisable" });
  const id = Number.parseInt(String(params.id || ""), 10);
  const auth = await cargarAutorizacion(s, user);
  const row = Number.isFinite(id) ? await snapshotRow(s, tabla, id) : null;
  if (!row) throw new HttpError(404, { message: "Registro no encontrado" });
  if (String(row.supervisor_id ?? "") !== String(auth.userId)) throw new HttpError(403, { message: "Solo el supervisor asignado puede dar el visto bueno o regresar este registro" });
  if (!permisoDe(auth, SUPERVISABLES[tabla].modulo, "V")) throw new HttpError(403, { message: `Necesitas ver ${SUPERVISABLES[tabla].modulo} para supervisar este registro` });
  if (String(row.supervision_estado || "") !== "pendiente") throw new HttpError(409, { message: "El registro no está pendiente de supervisión" });
  return { tabla, id, row, userId: auth.userId };
}

export async function vistoBueno({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const { tabla, id, row, userId } = await registroSupervisado(s, user, params);
  const payload = await readJson(request);
  const observaciones = String(payload.observaciones || "").trim() || null;
  // Segregacion (regla 4): el supervisor no da visto bueno a lo que el mismo capturo o edito (segun la bitacora).
  const elaboradores = await elaboradoresDe(s, tabla, id, row.supervision_solicitada_por);
  const violacion = evaluarVistoBueno(userId, elaboradores.has(Number(userId)) ? userId : null);
  if (violacion) throw new HttpError(409, { message: violacion.mensaje, codigo: "segregacion", regla: violacion.regla, clave: violacion.clave });
  await exigirReauth(s, request, user, "supervision:visto_bueno");
  await s.execute("UPDATE " + tabla + " SET supervision_estado = 'aprobado', supervisado_por = :por, supervisado_en = :en, supervision_observaciones = :obs WHERE id = :id", {
    por: userId,
    en: new Date().toISOString(),
    obs: observaciones,
    id,
  });
  await registrarAuditoria(s, user, { accion: "visto_bueno", entidad: tabla, entidadId: id, referencia: referenciaDe(tabla, row), motivo: observaciones, detalle: { supervisado: row.supervision_solicitada_por ?? null } });
  await s.commit();
  return json({ message: "Visto bueno registrado" });
}

export async function regresarSupervision({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const { tabla, id, row } = await registroSupervisado(s, user, params);
  const payload = await readJson(request);
  const observaciones = String(payload.observaciones || payload.motivo || "").trim();
  if (observaciones.length < 5) throw new HttpError(400, { message: "Escribe las observaciones para quien capturó el registro (al menos 5 caracteres)" });
  await s.execute("UPDATE " + tabla + " SET supervision_estado = 'regresado', supervision_observaciones = :obs WHERE id = :id", { obs: observaciones, id });
  await registrarAuditoria(s, user, { accion: "regresar_supervision", entidad: tabla, entidadId: id, referencia: referenciaDe(tabla, row), motivo: observaciones, detalle: { supervisado: row.supervision_solicitada_por ?? null } });
  await s.commit();
  return json({ message: "Registro regresado con observaciones" });
}

/*
 * Filtro de listas: `supervision=pendiente` (todo lo pendiente o regresado) o
 * `supervision=mia` (lo pendiente cuyo supervisor soy yo: "Por supervisar").
 */
export function filtroSupervision(request: Request, alias: string, userId: number | null): { sql: string; params: Record<string, unknown> } {
  const valor = new URL(request.url).searchParams.get("supervision") || "";
  const filtro = ["pendiente", "mia"].includes(valor) ? valor : "";
  const a = alias ? `${alias}.` : "";
  return {
    sql: `AND (:sup_filtro = '' OR (${a}requiere_supervision = 1 AND ${a}supervision_estado IN ('pendiente', 'regresado') AND (:sup_filtro = 'pendiente' OR (${a}supervision_estado = 'pendiente' AND ${a}supervisor_id = :sup_yo))))`,
    params: { sup_filtro: filtro, sup_yo: userId ?? 0 },
  };
}
