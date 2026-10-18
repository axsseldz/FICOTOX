/* Avisos de calidad para el Inicio y la campana (Fase 11). */
import { formatearFolio } from "../../../shared/folios";
import { type Row, type Session } from "../../db";
import { permisoDe, type Autorizacion } from "../../rbac";
import { TIPO_INCIDENCIA_LABEL, accionVencida, folioIncidencia, folioNc } from "../../../shared/calidad";
import { formatearFecha, hoyLocal, sumarDias } from "../../../shared/fechas";
import { previosDe, T } from "./comun";
import { suspensionesActivas } from "./bloqueos";

export interface AvisoCalidad {
  tipo: string;
  titulo: string;
  detalle: string;
  href: string;
  tono: "danger" | "warning" | "info";
  /* Clave estable del evento (tipo + registro + situacion) para el estado de lectura de la campana. */
  clave: string;
  /* Cuando empezo la situacion (para "hace X"). */
  cuando: string | null;
  /* Nombre corto del registro (folio) y frase corta para la campana. */
  registro: string;
}

/* Avisos de calidad para el Inicio y la campana (solo lo que aplica a la persona). */
export async function avisosCalidad(s: Session, auth: Autorizacion): Promise<AvisoCalidad[]> {
  const out: AvisoCalidad[] = [];
  const yo = auth.userId;
  const puede = (accion: "R" | "A" | "G") => !!permisoDe(auth, "calidad", accion, { objeto: "nc" });
  const hoy = hoyLocal();
  const en7 = sumarDias(hoy, 7);
  // Sin calidad:V total la NC puede no ser visible: los avisos de retencion y suspension llevan al informe o al inventario.
  const total = !!permisoDe(auth, "calidad", "V", { objeto: "nc" })?.alcances.includes("total");
  // Incidencias por evaluar (calidad:R), sin las que reporto la persona (regla 7).
  if (puede("R")) {
    const filas = await s.query<Row>(`SELECT id, folio_num, tipo, reportada_en FROM ${T.incidencias} WHERE estado IN ('reportada', 'en_evaluacion') AND COALESCE(reportada_por, 0) <> :yo ORDER BY id LIMIT 15`, { yo });
    for (const f of filas) out.push({ tipo: "incidencia_por_evaluar", titulo: `Incidencia por evaluar: ${folioIncidencia(f.folio_num)}`, detalle: TIPO_INCIDENCIA_LABEL[String(f.tipo)] || String(f.tipo), href: `/calidad/incidencias/${f.id}`, tono: "warning", clave: `incidencia_evaluar:${f.id}`, cuando: (f.reportada_en as string | null) ?? null, registro: folioIncidencia(f.folio_num) });
  }
  // Mis acciones correctivas: vencidas y proximas (7 dias).
  const mias = await s.query<Row>(`SELECT a.id, a.descripcion, a.fecha_compromiso, a.estado, a.creada_en, n.id AS nc_id, n.folio_num FROM ${T.acciones} a JOIN ${T.nc} n ON n.id = a.nc_id WHERE a.responsable_id = :yo AND a.estado IN ('pendiente', 'en_proceso') AND n.estado NOT IN ('cerrada', 'anulada') ORDER BY a.fecha_compromiso`, { yo });
  for (const a of mias) {
    const vencida = accionVencida(a, hoy);
    const proxima = !vencida && !!a.fecha_compromiso && String(a.fecha_compromiso) <= en7;
    out.push({ tipo: vencida ? "accion_vencida" : "accion_mia", titulo: `${vencida ? "Acción vencida" : proxima ? "Acción próxima" : "Mi acción correctiva"}: ${folioNc(a.folio_num)}`, detalle: `${String(a.descripcion).slice(0, 70)} · compromiso ${formatearFecha(a.fecha_compromiso)}`, href: `/calidad/nc/${a.nc_id}`, tono: vencida ? "danger" : "info", clave: `accion:${a.id}:${vencida ? "vencida" : proxima ? "proxima" : "asignada"}`, cuando: vencida ? (a.fecha_compromiso as string | null) ?? null : (a.creada_en as string | null) ?? null, registro: folioNc(a.folio_num) });
  }
  // Verificaciones de eficacia pendientes (calidad:R), sin las NC donde es responsable de una accion (regla 8).
  if (puede("R")) {
    const filas = await s.query<Row>(`SELECT id, folio_num, verificacion_programada, verificacion_iniciada_en FROM ${T.nc} n WHERE estado = 'en_verificacion' AND NOT EXISTS (SELECT 1 FROM ${T.acciones} a WHERE a.nc_id = n.id AND (a.responsable_id = :yo OR a.implementada_por = :yo) AND a.estado <> 'cancelada') ORDER BY id LIMIT 30`, { yo });
    // Tampoco a quien fue responsable de una accion antes de reasignarla (regla 8).
    const previas = filas.length ? await s.query<Row>(`SELECT nc_id, responsables_previos FROM ${T.acciones} WHERE nc_id IN (${filas.map((f) => Number(f.id)).join(", ")}) AND estado <> 'cancelada'`) : [];
    const excluidas = new Set(previas.filter((a) => previosDe(a).includes(yo)).map((a) => Number(a.nc_id)));
    for (const f of filas.filter((x) => !excluidas.has(Number(x.id))).slice(0, 15)) out.push({ tipo: "verificacion_pendiente", titulo: `Verificar eficacia: ${folioNc(f.folio_num)}`, detalle: f.verificacion_programada ? `Programada ${formatearFecha(f.verificacion_programada)}` : "Acciones implementadas", href: `/calidad/nc/${f.id}`, tono: "warning", clave: `verificacion:${f.id}:${f.verificacion_iniciada_en || ""}`, cuando: (f.verificacion_iniciada_en as string | null) ?? null, registro: folioNc(f.folio_num) });
  }
  // Informes retenidos (quien libera o envia informes y calidad:A).
  if (puede("A") || permisoDe(auth, "informes", "A")) {
    const filas = await s.query<Row>(`SELECT r.id AS retencion_id, r.retenido_en, r.informe_id, i.folio_num, i.version, n.id AS nc_id, n.folio_num AS nc_folio FROM ${T.retenciones} r JOIN informes i ON i.id = r.informe_id JOIN ${T.nc} n ON n.id = r.nc_id WHERE r.liberada_en IS NULL ORDER BY r.id LIMIT 15`);
    for (const f of filas) out.push({ tipo: "informe_retenido", titulo: `Informe retenido: ${formatearFolio("IR", f.folio_num)}${Number(f.version || 1) > 1 ? ` v${f.version}` : ""}`, detalle: `Por ${folioNc(f.nc_folio)}`, href: total ? `/calidad/nc/${f.nc_id}` : `/informes/${f.informe_id}`, tono: "danger", clave: `informe_retenido:${f.retencion_id}`, cuando: (f.retenido_en as string | null) ?? null, registro: `${formatearFolio("IR", f.folio_num)}${Number(f.version || 1) > 1 ? ` v${f.version}` : ""}` });
  }
  // Metodos y equipos suspendidos (quien captura ensayos y calidad).
  if (puede("R") || puede("A") || permisoDe(auth, "ensayos", "C") || permisoDe(auth, "ensayos", "E")) {
    for (const su of (await suspensionesActivas(s)).slice(0, 15)) out.push({ tipo: "suspension", titulo: `${su.tipo === "metodo" ? `Método ${su.clave}` : `Equipo ${su.equipo_nombre || su.clave}`} suspendido`, detalle: `Por ${folioNc(su.nc_folio)}`, href: total ? `/calidad/nc/${su.nc_id}` : su.tipo === "equipo" ? "/inventario/equipos" : "/muestras/extraccion", tono: "danger", clave: `suspension:${su.id}`, cuando: (su.suspendida_en as string | null) ?? null, registro: su.tipo === "metodo" ? `Método ${su.clave}` : String(su.equipo_nombre || su.clave) });
  }
  // Acciones cuyo responsable ya no tiene cuenta vigente (se reasignan con motivo): a calidad:G y al responsable de la NC.
  const noVigentes = await s.query<Row>(
    `SELECT a.id, n.id AS nc_id, n.folio_num, u.nombre FROM ${T.acciones} a JOIN ${T.nc} n ON n.id = a.nc_id JOIN usuarios u ON u.id = a.responsable_id
     WHERE a.estado IN ('pendiente', 'en_proceso') AND n.estado NOT IN ('cerrada', 'anulada') AND (u.activo = 0 OR (u.vigente_hasta IS NOT NULL AND u.vigente_hasta < :hoy)) AND (:g = 1 OR n.responsable_id = :yo) LIMIT 15`,
    { hoy, g: puede("G") ? 1 : 0, yo },
  );
  for (const f of noVigentes) out.push({ tipo: "responsable_no_vigente", titulo: `Reasignar acción de ${folioNc(f.folio_num)}`, detalle: `${f.nombre} ya no tiene cuenta vigente`, href: `/calidad/nc/${f.nc_id}`, tono: "warning", clave: `reasignar_accion:${f.id}`, cuando: null, registro: folioNc(f.folio_num) });
  // La NC misma sin responsable vigente: la reasigna quien administra calidad (calidad:G), con motivo.
  if (puede("G")) {
    const ncs = await s.query<Row>(
      `SELECT n.id, n.folio_num, u.nombre FROM ${T.nc} n JOIN usuarios u ON u.id = n.responsable_id
       WHERE n.estado NOT IN ('cerrada', 'anulada') AND (u.activo = 0 OR (u.vigente_hasta IS NOT NULL AND u.vigente_hasta < :hoy)) LIMIT 15`,
      { hoy },
    );
    for (const f of ncs) out.push({ tipo: "responsable_no_vigente", titulo: `Nombrar otro responsable de ${folioNc(f.folio_num)}`, detalle: `${f.nombre} ya no tiene cuenta vigente`, href: `/calidad/nc/${f.id}`, tono: "warning", clave: `reasignar_nc:${f.id}`, cuando: null, registro: folioNc(f.folio_num) });
  }
  return out;
}
