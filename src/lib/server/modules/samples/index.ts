import { requireUser } from "../../auth";
import { isSqlite } from "../../db";
import { json, type RouteContext } from "../../http";
import { cargarAutorizacion, permisoDe, requirePermission, soloEstado } from "../../rbac";

/* Portado de modules/samples/endpoints.py del backend Flask original. */

// Folio legible "R-0000012" / "E-D-0000003": el prefijo sale de tipo_registro
// (las extracciones tienen varios tipos). SQLite usa printf; MySQL, LPAD.
function folioExpression(fallbackPrefix: string): string {
  return isSqlite()
    ? `COALESCE(NULLIF(tipo_registro, ''), '${fallbackPrefix}') || '-' || printf('%07d', folio_num)`
    : `CONCAT(COALESCE(NULLIF(tipo_registro, ''), '${fallbackPrefix}'), '-', LPAD(folio_num, 7, '0'))`;
}

export async function listSamples(ctx: RouteContext): Promise<Response> {
  const user = await requireUser(ctx.request);
  // Mezcla recepciones (muestras) con procesamientos y extracciones (ensayos): cada fila segun su modulo.
  const auth = await cargarAutorizacion(ctx.s, user);
  const muestras = permisoDe(auth, "muestras", "V");
  const ensayos = permisoDe(auth, "ensayos", "V");
  if (!muestras && !ensayos) await requirePermission(ctx.s, user, "muestras", "V", undefined, auth);

  const rows = await ctx.s.query(
    `
    SELECT id, codigo, cliente, tipo, prioridad, estado, fecha_ingreso, analista
    FROM (
      SELECT id, ${folioExpression("R")} AS codigo, solicitante AS cliente,
             'Recepcion' AS tipo, '-' AS prioridad, estado, fecha_recepcion AS fecha_ingreso,
             NULL AS analista
      FROM muestras_recepcion
      UNION ALL
      SELECT id, ${folioExpression("P")} AS codigo, id_interno AS cliente,
             'Procesamiento' AS tipo, '-' AS prioridad, estado, fecha_procesamiento AS fecha_ingreso,
             nombre_quien_proceso AS analista
      FROM muestras_procesamiento
      UNION ALL
      SELECT id, ${folioExpression("E-A")} AS codigo, id_interno AS cliente,
             'Extraccion' AS tipo, '-' AS prioridad, estado, fecha_extraccion AS fecha_ingreso,
             nombre_quien_extrajo AS analista
      FROM muestras_extraccion
    ) m
    ORDER BY fecha_ingreso DESC, id DESC
    LIMIT 200
    `,
  );
  const items = rows
    .filter((row) => (row.tipo === "Recepcion" ? !!muestras : !!ensayos))
    .map((row) => (row.tipo === "Recepcion" && muestras && soloEstado(muestras) ? { ...row, analista: null } : row));
  return json({ items, total: items.length });
}
