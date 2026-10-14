/*
 * Notificaciones (campana de la barra lateral).
 *
 * Salen de la MISMA fuente que "Para ti" del Inicio (src/lib/server/pendientes.ts):
 * un evento por pendiente con su clave estable. Lo nuevo es el estado de
 * lectura por persona (tabla notificaciones_leidas, migracion 15): al pulsar
 * una notificacion, al marcarla o con "Marcar todas como leídas" se guarda su
 * clave; las leidas no se cuentan ni se muestran (salvo en "Ver anteriores",
 * las leidas de los ultimos 7 dias). Marcar como leida NO resuelve nada: el
 * pendiente sigue en el Inicio y en su bandeja; la notificacion desaparece
 * sola cuando el pendiente se resuelve. Leer no pasa por la bitacora.
 */
import { requireUser } from "../auth";
import { type Row, type Session } from "../db";
import { HttpError, json, readJson, type RouteContext } from "../http";
import { pendientesDe, type Evento } from "../pendientes";
import { cargarAutorizacion, type Autorizacion } from "../rbac";

interface Notificacion extends Evento {
  grupo: string;
  /* Tipo y titulo completos (compatibilidad con los clientes anteriores). */
  tipo: string;
  titulo: string;
  leida_en: string | null;
}

const TIPO_GRUPO: Record<string, string> = {
  muestras_asignadas: "muestra_asignada",
  analisis_pendientes: "analisis",
  informes_revision: "informe",
  informes_entrega: "informe",
  informes_enmienda: "informe_enmienda",
  por_autorizar: "solicitud",
  por_supervisar: "supervision",
  mant_vencidos: "mantenimiento",
  mant_proximos: "mantenimiento",
  equipos_cal: "calibracion",
  reactivos_bajos: "stock_bajo",
  consumibles_bajos: "stock_bajo",
  reactivos_caducan: "caducidad",
  accesos_vencen: "acceso",
  autorizaciones_vencen: "autorizacion",
  bitacora_alterada: "bitacora_alterada",
  respaldo_viejo: "respaldo",
  prueba_vieja: "respaldo",
  documentos_sgc: "documento",
  documentos_solicitudes: "documento",
};

const DIA = 86_400_000;
const haceDias = (n: number) => new Date(Date.now() - n * DIA).toISOString();

async function notificacionesDe(s: Session, auth: Autorizacion): Promise<{ items: Notificacion[]; anteriores: Notificacion[] }> {
  const grupos = await pendientesDe(s, auth);
  const eventos = grupos.flatMap((g) => g.eventos.map((e) => ({ ...e, grupo: g.key, tipo: e.tipo || TIPO_GRUPO[g.key] || g.key, titulo: `${e.frase}: ${e.registro}` })));
  const leidas = await s.query<Row>("SELECT id, clave, leida_en FROM notificaciones_leidas WHERE usuario_id = :yo", { yo: auth.userId });
  const leidaEn = new Map(leidas.map((l) => [String(l.clave), String(l.leida_en)]));

  // Depuracion: lecturas de mas de 90 dias y claves de eventos que ya no existen (con un dia de margen).
  const vigentes = new Set(eventos.map((e) => e.clave));
  const viejas = leidas.filter((l) => String(l.leida_en) < haceDias(90) || (!vigentes.has(String(l.clave)) && String(l.leida_en) < haceDias(1))).map((l) => Number(l.id));
  if (viejas.length) {
    await s.execute(`DELETE FROM notificaciones_leidas WHERE id IN (${viejas.join(", ")})`);
    await s.commit();
  }

  const recientes = (a: Notificacion, b: Notificacion) => String(b.cuando || "").localeCompare(String(a.cuando || ""));
  const todas: Notificacion[] = eventos.map((e) => ({ ...e, leida_en: leidaEn.get(e.clave) ?? null }));
  return {
    items: todas.filter((n) => !n.leida_en).sort(recientes),
    anteriores: todas.filter((n) => n.leida_en && n.leida_en >= haceDias(7)).sort((a, b) => String(b.leida_en).localeCompare(String(a.leida_en))),
  };
}

/* GET /api/notificaciones: las no leidas (items, total = contador) y las leidas de los ultimos 7 dias (anteriores). */
export async function listarNotificaciones({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const { items, anteriores } = await notificacionesDe(s, await cargarAutorizacion(s, user));
  return json({ items, anteriores, total: items.length });
}

/* POST /api/notificaciones/leidas { claves: string[] }: marca como leidas (sin bitacora). */
export async function marcarLeidas({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const auth = await cargarAutorizacion(s, user);
  const payload = await readJson(request);
  const claves = [...new Set((Array.isArray(payload.claves) ? payload.claves : []).map((c) => String(c)).filter((c) => c && c.length <= 190))].slice(0, 500);
  if (!claves.length) throw new HttpError(400, { message: "Indica qué notificaciones marcar" });
  const ya = new Set((await s.query<Row>("SELECT clave FROM notificaciones_leidas WHERE usuario_id = :yo", { yo: auth.userId })).map((r) => String(r.clave)));
  const ahora = new Date().toISOString();
  for (const clave of claves.filter((c) => !ya.has(c))) await s.execute("INSERT INTO notificaciones_leidas (usuario_id, clave, leida_en) VALUES (:yo, :clave, :ahora)", { yo: auth.userId, clave, ahora });
  await s.commit();
  return json({ message: "Marcadas como leídas", leida_en: ahora });
}
