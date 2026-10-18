/*
 * Calidad (Fase 11): esquema y utilidades comunes de incidencias, no
 * conformidades, acciones correctivas, comunicaciones, suspensiones y
 * retenciones (ISO/IEC 17025 7.10 y 8.7).
 *
 * Acceso (FX-MO-2-1 seccion 5, columna Calidad):
 * - calidad:V "total" ve todo; con el alcance "incidencias" solo las incidencias
 *   que la persona reporto y las NC o acciones de las que es responsable (nunca
 *   la bitacora: ese alcance no cuenta sin objeto, ver permisos.ts).
 * - Admin tecnico (calidad:V "bitacora") no ve incidencias ni NC.
 * Nada se borra: anular exige motivo y un segundo usuario (solicitud).
 */
import type { CurrentUser } from "../../auth";
import { userIdFromClaims } from "../../auth";
import { isSqlite, type Row, type Session } from "../../db";
import { HttpError } from "../../http";
import { cargarAutorizacion, permisoDe, requirePermission, type Autorizacion, type Permiso } from "../../rbac";

import type { Accion } from "../../../shared/permisos";
import { hoyLocal } from "../../../shared/fechas";

export const T = {
  incidencias: "incidencias",
  registros: "incidencia_registros",
  nc: "no_conformidades",
  afectados: "nc_registros_afectados",
  verificaciones: "nc_verificaciones",
  acciones: "acciones_correctivas",
  comunicaciones: "nc_comunicaciones",
  suspensiones: "suspensiones",
  retenciones: "retenciones_informe",
} as const;

export const ahora = () => new Date().toISOString();

/* Lista JSON de ids de responsables anteriores (columna responsables_previos). */
export const previosDe = (row: Row | null | undefined): number[] => {
  try {
    const lista = JSON.parse(String(row?.responsables_previos || "[]"));
    return Array.isArray(lista) ? lista.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  } catch {
    return [];
  }
};
export const conPrevio = (row: Row, anterior: unknown): string => JSON.stringify([...new Set([...previosDe(row), ...(anterior ? [Number(anterior)] : [])])]);

/* Fila con bloqueo en MySQL (transiciones de estado); en SQLite la sesion ya es exclusiva. */
export async function filaBloqueada(s: Session, tabla: string, id: number): Promise<Row | null> {
  return s.queryOne<Row>(`SELECT * FROM ${tabla} WHERE id = :id${isSqlite() ? "" : " FOR UPDATE"}`, { id });
}

export async function siguienteFolio(s: Session, tabla: string): Promise<number> {
  return Number((await s.scalar(`SELECT MAX(folio_num) FROM ${tabla}`)) || 0) + 1;
}

export function exigirTexto(valor: unknown, min: number, que: string): string {
  const t = String(valor ?? "").trim();
  if (t.length < min) throw new HttpError(400, { message: `${que} (al menos ${min} caracteres)` });
  return t;
}

/* ---------- Acceso ---------- */

export interface AccesoCalidad {
  auth: Autorizacion;
  yo: number;
  /* calidad:V con alcance total (ve todo). */
  total: boolean;
  puede: (accion: Accion) => boolean;
}

/*
 * Exige ver calidad (incidencias/NC). Con alcance "incidencias" solo lo propio;
 * el admin tecnico (V bitacora) y quien no tiene calidad reciben 403.
 */
export async function accesoCalidad(s: Session, user: CurrentUser, objeto: "incidencia" | "nc" | "accion_correctiva" = "incidencia"): Promise<AccesoCalidad> {
  const auth = await cargarAutorizacion(s, user);
  const permiso = permisoDe(auth, "calidad", "V", { objeto });
  if (!permiso) throw new HttpError(403, { message: "Permiso denegado para ver incidencias y no conformidades (calidad:V)", required: { module: "calidad", action: "V" } });
  return {
    auth,
    yo: userIdFromClaims(user) as number,
    total: permiso.alcances.includes("total"),
    puede: (accion: Accion) => !!permisoDe(auth, "calidad", accion, { objeto }),
  };
}

export async function exigirCalidad(s: Session, user: CurrentUser, accion: Accion, objeto: "incidencia" | "nc" | "accion_correctiva" = "nc", auth?: Autorizacion): Promise<Permiso> {
  return requirePermission(s, user, "calidad", accion, { objeto }, auth);
}

/* ¿Ve esta incidencia? Total, o la reporto la persona. */
function veIncidencia(acc: AccesoCalidad, row: Row): boolean {
  return acc.total || Number(row.reportada_por) === acc.yo;
}

/* ¿Ve esta NC? Total, o es su responsable o responsable de alguna de sus acciones. */
export async function veNc(s: Session, acc: AccesoCalidad, row: Row): Promise<boolean> {
  if (acc.total || Number(row.responsable_id) === acc.yo) return true;
  return !!(await s.scalar(`SELECT id FROM ${T.acciones} WHERE nc_id = :nc AND responsable_id = :yo LIMIT 1`, { nc: row.id, yo: acc.yo }));
}

export async function incidenciaVisible(s: Session, acc: AccesoCalidad, id: number, bloquear = false): Promise<Row> {
  const row = bloquear ? await filaBloqueada(s, T.incidencias, id) : await s.queryOne<Row>(`SELECT * FROM ${T.incidencias} WHERE id = :id`, { id });
  // Lo ajeno responde igual que lo inexistente: no se revela que existe.
  if (!row || !veIncidencia(acc, row)) throw new HttpError(404, { message: "Incidencia no encontrada" });
  return row;
}

export async function ncVisible(s: Session, acc: AccesoCalidad, id: number, bloquear = false): Promise<Row> {
  const row = bloquear ? await filaBloqueada(s, T.nc, id) : await s.queryOne<Row>(`SELECT * FROM ${T.nc} WHERE id = :id`, { id });
  if (!row || !(await veNc(s, acc, row))) throw new HttpError(404, { message: "No conformidad no encontrada" });
  return row;
}

/* Persona activa y dentro de su vigencia (para responsables y verificadores). */
export async function personaVigente(s: Session, id: number | null | undefined): Promise<Row | null> {
  if (!id) return null;
  const row = await s.queryOne<Row>("SELECT id, nombre, email, activo, vigente_desde, vigente_hasta FROM usuarios WHERE id = :id", { id });
  if (!row) return null;
  const hoy = hoyLocal();
  const vigente = Number(row.activo) === 1 && (!row.vigente_desde || String(row.vigente_desde) <= hoy) && (!row.vigente_hasta || String(row.vigente_hasta) >= hoy);
  return { ...row, vigente };
}

/* Actor para la bitacora a partir de un id (incidencias automaticas reportadas por otra persona). */
export async function actorDe(s: Session, id: number | null | undefined): Promise<CurrentUser | null> {
  if (!id) return null;
  const row = await s.queryOne<Row>("SELECT id, nombre, email FROM usuarios WHERE id = :id", { id });
  return row ? ({ sub: String(row.id), nombre: String(row.nombre || ""), email: String(row.email || "") } as CurrentUser) : null;
}

/* CSV para exportar listas (celdas que empiezan con =, +, -, @ se neutralizan con '). */
export function respuestaCsv(nombre: string, encabezados: string[], filas: unknown[][]): Response {
  const celda = (v: unknown) => {
    const t = String(v ?? "");
    return `"${(/^[=+\-@\t\r]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
  };
  const lineas = [encabezados.map(celda).join(","), ...filas.map((f) => f.map(celda).join(","))];
  return new Response(`﻿${lineas.join("\r\n")}\r\n`, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nombre}"`, "X-Content-Type-Options": "nosniff" } });
}
