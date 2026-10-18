/*
 * Lista unica de incidencias y no conformidades (pantalla Calidad › Incidencias
 * y NC). Une las dos listas con los mismos alcances de siempre: con el alcance
 * "incidencias" solo salen las incidencias propias y las NC donde la persona es
 * responsable (de la NC o de alguna de sus acciones).
 *
 * Los filtros de un solo tipo (estado de la incidencia, tipo de incidencia,
 * etapa y clasificacion de la NC) se aplican a su tipo y no ocultan el otro;
 * "Mis registros" y "Situacion" eligen lo que cada tipo puede cumplir.
 */
import { requireUser } from "../../auth";
import { HttpError, json, type RouteContext } from "../../http";
import { type Row } from "../../db";
import { folioIncidencia, folioNc } from "../../../shared/calidad";
import { finDiaLocal, hoyLocal, inicioDiaLocal } from "../../../shared/fechas";
import { accesoCalidad, T, type AccesoCalidad } from "./comun";

const lista = (request: Request, nombre: string): string[] => (new URL(request.url).searchParams.get(nombre) || "").split(",").map((v) => v.trim()).filter(Boolean);
const param = (request: Request, nombre: string) => (new URL(request.url).searchParams.get(nombre) || "").trim();

/* Condicion `columna IN (...)` con parametros nombrados. */
function enLista(columna: string, valores: string[], prefijo: string, where: string[], v: Record<string, unknown>) {
  if (!valores.length) return;
  where.push(`${columna} IN (${valores.map((_, i) => `:${prefijo}${i}`).join(", ")})`);
  valores.forEach((valor, i) => (v[`${prefijo}${i}`] = valor));
}

async function accesoOpcional(s: RouteContext["s"], user: Awaited<ReturnType<typeof requireUser>>, objeto: "incidencia" | "nc"): Promise<AccesoCalidad | null> {
  try {
    return await accesoCalidad(s, user, objeto);
  } catch (err) {
    if (err instanceof HttpError && err.status === 403) return null;
    throw err;
  }
}

/*
 * GET /api/calidad/lista?tipos&estado_inc&etapa_nc&tipo_inc&clasificacion&mias&situacion&desde&hasta&anuladas=1&orden&search
 * (los filtros de varias opciones van separados por comas).
 */
export async function listarRegistrosCalidad({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const [accInc, accNc] = await Promise.all([accesoOpcional(s, user, "incidencia"), accesoOpcional(s, user, "nc")]);
  if (!accInc && !accNc) await accesoCalidad(s, user, "incidencia");
  const tipos = lista(request, "tipos");
  const mias = lista(request, "mias");
  const situacion = lista(request, "situacion");
  const desde = param(request, "desde");
  const hasta = param(request, "hasta");
  const search = param(request, "search");
  const orden = param(request, "orden");
  const anuladas = param(request, "anuladas") === "1";
  const hoy = hoyLocal();
  const yo = (accInc || accNc)!.yo;
  const incluirInc = !!accInc && (!tipos.length || tipos.includes("incidencia"));
  const incluirNc = !!accNc && (!tipos.length || tipos.includes("nc"));
  const dir = orden === "antiguos" ? "ASC" : "DESC";

  let incidencias: Row[] = [];
  // "Mis registros" y "Situacion" eligen: una incidencia solo cumple "Reportados por mí" y "Creadas automáticamente".
  if (incluirInc && (!mias.length || mias.includes("reportados")) && (!situacion.length || situacion.includes("automatica"))) {
    const where: string[] = [];
    const v: Record<string, unknown> = { yo };
    if (!anuladas) where.push("i.estado <> 'anulada'");
    enLista("i.estado", lista(request, "estado_inc"), "ei", where, v);
    enLista("i.tipo", lista(request, "tipo_inc"), "ti", where, v);
    if (desde) {
      where.push("i.fecha_hora_ocurrencia >= :desde");
      v.desde = inicioDiaLocal(desde);
    }
    if (hasta) {
      where.push("i.fecha_hora_ocurrencia <= :hasta");
      v.hasta = finDiaLocal(hasta);
    }
    if (mias.includes("reportados") || !accInc!.total) where.push("i.reportada_por = :yo");
    if (situacion.includes("automatica")) where.push("i.origen_automatico IS NOT NULL");
    if (search) {
      where.push("(i.descripcion LIKE :like OR CAST(i.folio_num AS CHAR) LIKE :like OR i.reportada_nombre LIKE :like)");
      v.like = `%${search}%`;
    }
    const orderBy = orden === "folio" ? "i.folio_num ASC" : `i.fecha_hora_ocurrencia ${dir}`;
    incidencias = await s.query<Row>(
      `SELECT i.*, n.folio_num AS nc_folio FROM ${T.incidencias} i LEFT JOIN ${T.nc} n ON n.id = i.nc_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${orderBy} LIMIT 1000`,
      v,
    );
  }

  let ncs: Row[] = [];
  const soloAutomaticas = situacion.length === 1 && situacion[0] === "automatica";
  if (incluirNc && (!mias.length || mias.includes("responsable")) && !soloAutomaticas) {
    const where: string[] = [];
    const v: Record<string, unknown> = { yo, hoy };
    if (!anuladas) where.push("n.estado <> 'anulada'");
    enLista("n.estado", lista(request, "etapa_nc"), "en", where, v);
    enLista("n.clasificacion", lista(request, "clasificacion"), "cl", where, v);
    if (desde) {
      where.push("n.creada_en >= :desde");
      v.desde = inicioDiaLocal(desde);
    }
    if (hasta) {
      where.push("n.creada_en <= :hasta");
      v.hasta = finDiaLocal(hasta);
    }
    const alcance = `(n.responsable_id = :yo OR n.id IN (SELECT nc_id FROM ${T.acciones} WHERE responsable_id = :yo))`;
    if (mias.includes("responsable") || !accNc!.total) where.push(alcance);
    const condiciones: string[] = [];
    if (situacion.includes("vencidas")) condiciones.push(`EXISTS (SELECT 1 FROM ${T.acciones} a WHERE a.nc_id = n.id AND a.estado IN ('pendiente', 'en_proceso') AND a.fecha_compromiso IS NOT NULL AND a.fecha_compromiso < :hoy)`);
    if (situacion.includes("suspension")) condiciones.push(`EXISTS (SELECT 1 FROM ${T.suspensiones} su WHERE su.nc_id = n.id AND su.reanudada_en IS NULL)`);
    if (situacion.includes("retenido")) condiciones.push(`EXISTS (SELECT 1 FROM ${T.retenciones} r WHERE r.nc_id = n.id AND r.liberada_en IS NULL)`);
    if (condiciones.length) where.push(`(${condiciones.join(" OR ")})`);
    if (search) {
      where.push("(n.descripcion LIKE :like OR n.requisito_incumplido LIKE :like OR CAST(n.folio_num AS CHAR) LIKE :like)");
      v.like = `%${search}%`;
    }
    const orderBy = orden === "folio" ? "n.folio_num ASC" : `n.creada_en ${dir}`;
    ncs = await s.query<Row>(
      `SELECT n.*, u.nombre AS responsable_nombre,
         (SELECT COUNT(*) FROM ${T.acciones} a WHERE a.nc_id = n.id AND a.estado <> 'cancelada') AS acciones,
         (SELECT COUNT(*) FROM ${T.acciones} a WHERE a.nc_id = n.id AND a.estado IN ('pendiente', 'en_proceso')) AS acciones_abiertas,
         (SELECT COUNT(*) FROM ${T.acciones} a WHERE a.nc_id = n.id AND a.estado IN ('pendiente', 'en_proceso') AND a.fecha_compromiso IS NOT NULL AND a.fecha_compromiso < :hoy) AS acciones_vencidas,
         (SELECT COUNT(*) FROM ${T.suspensiones} su WHERE su.nc_id = n.id AND su.reanudada_en IS NULL) AS suspensiones_activas,
         (SELECT COUNT(*) FROM ${T.retenciones} r WHERE r.nc_id = n.id AND r.liberada_en IS NULL) AS retenciones_activas
       FROM ${T.nc} n LEFT JOIN usuarios u ON u.id = n.responsable_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${orderBy} LIMIT 1000`,
      v,
    );
  }

  const items: Row[] = [
    ...incidencias.map((f) => ({ ...f, registro: "incidencia", folio: folioIncidencia(f.folio_num), nc_folio_label: f.nc_folio ? folioNc(f.nc_folio) : null, fecha: f.fecha_hora_ocurrencia })),
    ...ncs.map((f) => ({ ...f, registro: "nc", folio: folioNc(f.folio_num), fecha: f.creada_en })),
  ];
  items.sort((a, b) => {
    const porFolio = Number(a.folio_num) - Number(b.folio_num);
    if (orden === "folio") return porFolio || (a.registro === b.registro ? 0 : a.registro === "incidencia" ? -1 : 1);
    const porFecha = String(a.fecha || "").localeCompare(String(b.fecha || ""));
    return (dir === "ASC" ? porFecha : -porFecha) || (dir === "ASC" ? porFolio : -porFolio);
  });
  const recortados = items.slice(0, 1000);

  return json({ items: recortados, total: recortados.length, alcance: (accInc?.total || accNc?.total) ? "total" : "incidencias", tipos_visibles: [...(accInc ? ["incidencia"] : []), ...(accNc ? ["nc"] : [])] });
}
