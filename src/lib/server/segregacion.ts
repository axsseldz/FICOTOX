import { type Row, type Session } from "./db";
import { HttpError } from "./http";

import { excepcionPara, type ExcepcionSegregacion, type Violacion } from "../shared/segregacion";

/*
 * Separacion de funciones en el servidor (Fase 3). Las reglas viven en
 * src/lib/shared/segregacion.ts; aqui se obtienen los datos (quien elaboro,
 * segun la bitacora) y se aplica el 409 con codigo "segregacion". Una
 * excepcion aprobada por un segundo usuario (solicitud "excepcion_segregacion")
 * queda en la columna excepciones_json del registro y permite la accion a esa
 * persona; se registra en la bitacora de la accion.
 */

// Fase 11: incidencias (evaluar), no conformidades (verificar, cerrar) y suspensiones (reanudar).
// documentos_sgc se retiro con la regla 5 (flujo anterior; Documentos SGC tiene su propia segregacion en modules/sgc/flujo.ts).
export const TABLAS_CON_EXCEPCION = ["muestras_analisis", "informes", "incidencias", "no_conformidades", "suspensiones"] as const;
export type TablaConExcepcion = (typeof TABLAS_CON_EXCEPCION)[number];

/*
 * Personas que elaboraron un registro: quien lo creo y quien edito su contenido
 * (entradas "crear" y "editar" de su bitacora; desde la Fase 10 tambien quien
 * adjunto o anulo evidencia instrumental), mas las columnas de autoria que
 * se pasen (creado_por, elaborado_por) por si la bitacora fuera anterior.
 */
export async function elaboradoresDe(s: Session, entidad: string, entidadId: number, ...autores: unknown[]): Promise<Set<number>> {
  const filas = await s.query<{ usuario_id: number | null }>(
    "SELECT DISTINCT usuario_id FROM auditoria WHERE entidad = :entidad AND entidad_id = :id AND accion IN ('crear', 'editar', 'adjuntar', 'anular_adjunto') AND usuario_id IS NOT NULL",
    { entidad, id: String(entidadId) },
  );
  const out = new Set<number>();
  for (const f of filas) if (f.usuario_id !== null && f.usuario_id !== undefined) out.add(Number(f.usuario_id));
  for (const a of autores) {
    const n = Number(a);
    if (a !== null && a !== undefined && a !== "" && Number.isFinite(n)) out.add(n);
  }
  return out;
}

export function excepcionesDe(row: Row | null | undefined): ExcepcionSegregacion[] {
  try {
    const value = JSON.parse(String(row?.excepciones_json || "[]"));
    return Array.isArray(value) ? (value as ExcepcionSegregacion[]) : [];
  } catch {
    return [];
  }
}

/*
 * Aplica una violacion: si la hay y la persona no tiene una excepcion aprobada
 * para esa accion, 409 "segregacion". Devuelve la excepcion usada (o null) para
 * dejarla en la bitacora de la accion.
 */
export function exigirSegregacion(violacion: Violacion | null, row: Row | null | undefined, usuarioId: number, accion: string): ExcepcionSegregacion | null {
  if (!violacion) return null;
  const excepcion = excepcionPara(excepcionesDe(row), usuarioId, accion);
  if (excepcion) return excepcion;
  throw new HttpError(409, { message: violacion.mensaje, codigo: "segregacion", regla: violacion.regla, clave: violacion.clave });
}

/* Deja constancia en el registro de una excepcion aprobada (la usa el ejecutor de la solicitud). */
export async function registrarExcepcion(s: Session, tabla: TablaConExcepcion, id: number, excepcion: ExcepcionSegregacion): Promise<void> {
  const row = await s.queryOne<Row>(`SELECT excepciones_json FROM ${tabla} WHERE id = :id`, { id });
  if (!row) throw new HttpError(404, { message: "El registro de la excepción ya no existe" });
  const lista = excepcionesDe(row).filter((e) => !(Number(e.usuario_id) === Number(excepcion.usuario_id) && e.accion === excepcion.accion));
  lista.push(excepcion);
  await s.execute(`UPDATE ${tabla} SET excepciones_json = :json WHERE id = :id`, { json: JSON.stringify(lista), id });
}

/* Detalle para la bitacora cuando una accion se hizo por excepcion. */
export const detalleExcepcion = (excepcion: ExcepcionSegregacion | null): Record<string, unknown> => (excepcion ? { excepcion_segregacion: { solicitud_id: excepcion.solicitud_id, aprobado_por: excepcion.aprobado_por ?? null } } : {});
