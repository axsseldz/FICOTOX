/*
 * Etiquetas imprimibles de una recepcion (Fase 5): una por muestra del lote.
 *
 * - GET  /api/samples/reception/:id/etiquetas: datos de cada etiqueta.
 * - POST /api/samples/reception/:id/etiquetas: deja en la bitacora que se
 *   imprimieron ("imprimir_etiquetas"); la impresion la hace el navegador.
 *
 * De donde sale cada dato:
 * - folio: "R 000000N" (folioLabel de la recepcion).
 * - id_interno: el de la recepcion si es muestra unica; el de cada fila del lote.
 * - organismo: en el lote, nombre_organismo de la fila; la muestra unica no
 *   captura organismo, asi que se usan los tipos de muestra solicitados
 *   (analisis.tipos_muestra, p. ej. "Organismo completo"). Si la fila del lote
 *   no trae organismo, tambien se usan los tipos de muestra.
 * - fecha_muestreo: fecha_muestra de la fila del lote o, si falta, la de la recepcion.
 * - fecha_recepcion: fecha_recepcion de la recepcion.
 * - resguardo: datos_custodio.lugar_resguardo (etiqueta del catalogo) mas el
 *   detalle escrito (lugar_otro, p. ej. "CO1").
 */
import { requireUser } from "../../auth";
import { registrarAuditoria } from "../../audit";
import type { Row } from "../../db";
import { HttpError, intParam, json, readJson, type RouteContext } from "../../http";
import { requirePermission } from "../../rbac";
import { folioLabel } from "../../samples-flow";
import { LEGACY_RECEPTION_SAMPLE_TYPES, RECEPTION_SAMPLE_TYPES, STORAGE_PLACES } from "../../../shared/sgc";
import { safeJsonLoad } from "../helpers";

const TABLE = "muestras_recepcion";

interface Etiqueta {
  folio: string;
  id_interno: string;
  organismo: string;
  fecha_muestreo: string | null;
  fecha_recepcion: string | null;
  resguardo: string;
}

const tipoMuestraLabel = (value: string): string => RECEPTION_SAMPLE_TYPES.find((t) => t.value === value)?.label || LEGACY_RECEPTION_SAMPLE_TYPES[value] || value;

function etiquetasDe(row: Row): Etiqueta[] {
  const folio = folioLabel(TABLE, row);
  const analisis = safeJsonLoad<{ tipos_muestra?: string[]; tipo_muestra_otro?: string | null }>(row.analisis_json, {});
  const tipos = (analisis.tipos_muestra || []).map((t) => (t === "otro" && analisis.tipo_muestra_otro ? analisis.tipo_muestra_otro : tipoMuestraLabel(t))).join(", ");
  const custodio = safeJsonLoad<{ lugar_resguardo?: string | null; lugar_otro?: string | null }>(row.datos_custodio_json, {});
  const lugar = custodio.lugar_resguardo ? STORAGE_PLACES.find((p) => p.value === custodio.lugar_resguardo)?.label || String(custodio.lugar_resguardo) : "";
  const resguardo = [lugar, custodio.lugar_otro || ""].filter(Boolean).join(" ");
  const fechaRecepcion = row.fecha_recepcion ? String(row.fecha_recepcion).slice(0, 10) : null;
  const fechaMuestra = row.fecha_muestra ? String(row.fecha_muestra).slice(0, 10) : null;
  if (Number(row.muestra_unica)) {
    return [{ folio, id_interno: String(row.id_interno || ""), organismo: tipos, fecha_muestreo: fechaMuestra, fecha_recepcion: fechaRecepcion, resguardo }];
  }
  const lote = safeJsonLoad<Array<{ id_interno?: string | null; nombre_organismo?: string | null; fecha_muestra?: string | null }>>(row.lote_muestras_json, []);
  return lote.map((m) => ({
    folio,
    id_interno: String(m.id_interno || ""),
    organismo: String(m.nombre_organismo || tipos),
    fecha_muestreo: m.fecha_muestra ? String(m.fecha_muestra).slice(0, 10) : fechaMuestra,
    fecha_recepcion: fechaRecepcion,
    resguardo,
  }));
}

async function cargar(ctx: RouteContext): Promise<{ row: Row; user: Awaited<ReturnType<typeof requireUser>> }> {
  const user = await requireUser(ctx.request);
  await requirePermission(ctx.s, user, "muestras", "V");
  const row = await ctx.s.queryOne<Row>(`SELECT * FROM ${TABLE} WHERE id = :id`, { id: intParam(ctx.params.id) });
  if (!row) throw new HttpError(404, { message: "Registro no encontrado" });
  return { row, user };
}

export async function getEtiquetas(ctx: RouteContext): Promise<Response> {
  const { row } = await cargar(ctx);
  return json({ folio: folioLabel(TABLE, row), estado: row.estado, items: etiquetasDe(row) });
}

export async function registrarImpresionEtiquetas(ctx: RouteContext): Promise<Response> {
  const { row, user } = await cargar(ctx);
  const payload = await readJson(ctx.request);
  // Tamaño elegido (solo para la bitácora): pequena, mediana, grande, media_hoja (y los nombres anteriores).
  const formato = ["pequena", "mediana", "grande", "media_hoja", "hoja", "etiqueta"].includes(String(payload.formato)) ? String(payload.formato) : "pequena";
  const inicio = Math.max(Number.parseInt(String(payload.inicio ?? 1), 10) || 1, 1);
  const copias = Math.min(Math.max(Number.parseInt(String(payload.copias ?? 1), 10) || 1, 1), 50);
  const etiquetas = etiquetasDe(row);
  await registrarAuditoria(ctx.s, user, {
    accion: "imprimir_etiquetas",
    entidad: TABLE,
    entidadId: Number(row.id),
    referencia: folioLabel(TABLE, row),
    detalle: { formato, copias, inicio, etiquetas: etiquetas.length, id_internos: etiquetas.map((e) => e.id_interno) },
  });
  await ctx.s.commit();
  return json({ message: "Impresión registrada en la bitácora", etiquetas: etiquetas.length });
}
