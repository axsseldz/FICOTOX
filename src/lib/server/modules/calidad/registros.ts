/*
 * Registros ligados a una incidencia o NC (Fase 11): referencia legible de un
 * registro de otro modulo y sus incidencias.
 */
import { numeroFolio } from "../../../shared/folios";
import { type Row, type Session } from "../../db";
import { HttpError } from "../../http";
import { folioLabel, type SampleTable } from "../../samples-flow";
import { ENTIDADES_RELACIONABLES } from "../../../shared/calidad";
import type { Modulo } from "../../../shared/permisos";

/* Modulo cuya V hace falta para ligar el registro a una incidencia (no se liga lo que no se ve). */
export const MODULO_REGISTRO: Record<string, Modulo> = {
  muestras_recepcion: "muestras",
  muestras_procesamiento: "ensayos",
  muestras_extraccion: "ensayos",
  muestras_analisis: "ensayos",
  informes: "informes",
  equipos: "equipos",
  reactivos: "inventario",
  consumibles: "inventario",
  documentos_sgc: "documentos",
  biblioteca_documentos: "documentos",
  sgc_documentos: "documentos",
};

const MUESTRAS = new Set(["muestras_recepcion", "muestras_procesamiento", "muestras_extraccion", "muestras_analisis"]);

/* Referencia legible del registro; 404 si no existe o la entidad no es relacionable. */
export async function referenciaDe(s: Session, entidad: string, id: number): Promise<string> {
  if (!ENTIDADES_RELACIONABLES[entidad]) throw new HttpError(400, { message: `No se puede ligar un registro de tipo "${entidad}"` });
  const row = await s.queryOne<Row>(`SELECT * FROM ${entidad} WHERE id = :id`, { id }).catch(() => null);
  if (!row) throw new HttpError(404, { message: `${ENTIDADES_RELACIONABLES[entidad].label} #${id} no existe` });
  return referenciaDeFila(entidad, row);
}

function referenciaDeFila(entidad: string, row: Row): string {
  if (MUESTRAS.has(entidad)) return folioLabel(entidad as SampleTable, row);
  if (entidad === "informes") return `IR ${numeroFolio(row.folio_num)}${Number(row.version || 1) > 1 ? ` v${row.version}` : ""}`;
  if (entidad === "equipos") return `${row.nombre || `Equipo #${row.id}`}${row.clave_bitacora ? ` (${row.clave_bitacora})` : ""}`;
  if (entidad === "reactivos") return String(row.producto || row.nombre || `Reactivo #${row.id}`);
  if (entidad === "consumibles") return String(row.producto || `Consumible #${row.id}`);
  if (entidad === "documentos_sgc") return `${row.clave || "Documento"} rev. ${row.revision ?? ""}`.trim();
  if (entidad === "sgc_documentos") return String(row.clave || `Documento #${row.id}`);
  if (entidad === "biblioteca_documentos") return String(row.clave || row.titulo || `Documento #${row.id}`);
  return `${entidad} #${row.id}`;
}
