/*
 * Incidencias automaticas (Fase 11, Parte C). Nacen "reportadas" dentro de la
 * transaccion del evento que las causa (si esa transaccion falla, no se crean),
 * a nombre de la persona que lo causo (o del sistema, en las alertas de
 * integridad), con `origen_automatico`. Sin duplicados: la clave del evento
 * (`clave_automatica`) identifica el registro; si ya hay una incidencia no
 * anulada con esa clave, no se crea otra.
 *
 * Eventos:
 * - recepcion aceptada con desviacion o rechazada;
 * - uso confirmado de un equipo no apto o con calibracion vencida (extraccion, analisis);
 * - alerta_integridad (PDF de informe, evidencia instrumental, respaldo).
 */
import { createHash } from "node:crypto";
import type { CurrentUser } from "../../auth";
import { registrarAuditoria } from "../../audit";
import { type Row, type Session } from "../../db";
import { ahora, siguienteFolio, T } from "./comun";
import { folioIncidencia } from "../../../shared/calidad";
import { hoyLocal } from "../../../shared/fechas";

export interface RegistroLigado {
  entidad: string;
  entidad_id: number;
  referencia: string | null;
}

interface NuevaAutomatica {
  origen: "desviacion_recepcion" | "rechazo_recepcion" | "equipo_no_apto" | "alerta_integridad";
  clave: string;
  tipo: string;
  descripcion: string;
  impacto?: "si" | "no" | "desconocido";
  /* null = sistema. */
  actor: CurrentUser | null;
  rol?: string | null;
  registros: RegistroLigado[];
}

/*
 * Crea la incidencia si no existe otra con la misma clave. Devuelve su id o null si ya existia.
 * - Recepcion y equipo no apto: solo cuentan las no anuladas (la recepcion se reabre y se vuelve a decidir: es un evento nuevo).
 * - Alerta de integridad: tambien las anuladas. La clave identifica un hecho unico e inmutable (acta, PDF o adjunto con su huella);
 *   anularla como falso positivo no debe hacerla renacer en cada consulta o descarga.
 */
/* La columna guarda 200 caracteres: una clave más larga se acorta con su huella para que la búsqueda y lo guardado coincidan. */
export const claveAutomatica = (clave: string): string => (clave.length <= 200 ? clave : `${clave.slice(0, 135)}:${createHash("sha256").update(clave).digest("hex")}`);

export async function registrarIncidenciaAutomatica(s: Session, nueva: NuevaAutomatica): Promise<number | null> {
  const incluirAnuladas = nueva.origen === "alerta_integridad";
  const clave = claveAutomatica(nueva.clave);
  const existente = await s.scalar(`SELECT id FROM ${T.incidencias} WHERE clave_automatica = :clave${incluirAnuladas ? "" : " AND estado <> 'anulada'"} LIMIT 1`, { clave });
  if (existente) return null;
  const folio = await siguienteFolio(s, T.incidencias);
  const en = ahora();
  const porId = nueva.actor ? Number(nueva.actor.sub) || null : null;
  const r = await s.execute(
    `INSERT INTO ${T.incidencias} (folio_num, tipo, fecha_hora_ocurrencia, descripcion, impacto_resultados, estado, reportada_por, reportada_nombre, reportada_rol, reportada_en, origen_automatico, clave_automatica)
     VALUES (:folio, :tipo, :ocurrencia, :descripcion, :impacto, 'reportada', :por, :nombre, :rol, :en, :origen, :clave)`,
    { folio, tipo: nueva.tipo, ocurrencia: en, descripcion: nueva.descripcion, impacto: nueva.impacto || "desconocido", por: porId, nombre: nueva.actor ? String(nueva.actor.nombre || nueva.actor.email || "") : "Sistema", rol: nueva.actor ? nueva.rol || null : "Sistema", en, origen: nueva.origen, clave },
  );
  const id = Number(r.lastrowid);
  for (const reg of nueva.registros) {
    await s.execute(`INSERT INTO ${T.registros} (incidencia_id, entidad, entidad_id, referencia) VALUES (:inc, :entidad, :eid, :ref)`, { inc: id, entidad: reg.entidad, eid: reg.entidad_id, ref: reg.referencia });
  }
  await registrarAuditoria(s, nueva.actor, {
    accion: "reportar",
    entidad: T.incidencias,
    entidadId: id,
    referencia: folioIncidencia(folio),
    detalle: { origen_automatico: nueva.origen, tipo: nueva.tipo, registros: nueva.registros.map((r2) => r2.referencia || `${r2.entidad} #${r2.entidad_id}`).join(", ") },
  });
  return id;
}

/* Recepcion aceptada con desviacion o rechazada. */
export async function incidenciaPorDecisionRecepcion(s: Session, actor: CurrentUser | null, recepcion: Row, referencia: string, decision: string, rol: string | null = null): Promise<void> {
  if (decision !== "aceptada_con_desviacion" && decision !== "rechazada") return;
  const rechazo = decision === "rechazada";
  await registrarIncidenciaAutomatica(s, {
    origen: rechazo ? "rechazo_recepcion" : "desviacion_recepcion",
    clave: `${rechazo ? "rechazo_recepcion" : "desviacion_recepcion"}:${recepcion.id}`,
    tipo: "muestra_custodia",
    descripcion: rechazo
      ? `La recepción ${referencia} se rechazó por no cumplir las condiciones de aceptación (FX-TCF-GMR). Registro automático para evaluar si hay trabajo no conforme.`
      : `La recepción ${referencia} se aceptó con desviación respecto de las condiciones de aceptación (FX-TCF-GMR). Registro automático para evaluar su impacto.`,
    impacto: rechazo ? "no" : "desconocido",
    actor,
    rol,
    registros: [{ entidad: "muestras_recepcion", entidad_id: Number(recepcion.id), referencia }],
  });
}

/*
 * Equipos no aptos usados en un formato (estado distinto de operativo o
 * calibracion vencida): una incidencia por equipo y registro. Los equipos
 * suspendidos no llegan aqui (su uso responde 409 antes).
 */
export async function incidenciasPorEquiposNoAptos(s: Session, actor: CurrentUser, entidad: string, entidadId: number, referencia: string, equipoIds: unknown[], rol: string | null = null): Promise<void> {
  const ids = [...new Set(equipoIds.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0))];
  if (!ids.length) return;
  const hoy = hoyLocal();
  const equipos = await s.query<Row>(`SELECT id, nombre, clave_bitacora, estado, fecha_prox_calibracion FROM equipos WHERE id IN (${ids.join(", ")})`);
  for (const eq of equipos) {
    const vencida = !!eq.fecha_prox_calibracion && String(eq.fecha_prox_calibracion).slice(0, 10) < hoy;
    const noOperativo = String(eq.estado || "operativo") !== "operativo";
    if (!vencida && !noOperativo) continue;
    const nombre = `${eq.nombre}${eq.clave_bitacora ? ` (${eq.clave_bitacora})` : ""}`;
    const motivo = noOperativo ? `estado "${eq.estado}"` : `calibración vencida el ${String(eq.fecha_prox_calibracion).slice(0, 10)}`;
    await registrarIncidenciaAutomatica(s, {
      origen: "equipo_no_apto",
      clave: `equipo_no_apto:${entidad}:${entidadId}:${eq.id}`,
      tipo: "falla_equipo",
      descripcion: `Se confirmó el uso del equipo ${nombre} con ${motivo} en ${referencia}. Registro automático para evaluar el impacto en los resultados.`,
      impacto: "desconocido",
      actor,
      rol,
      registros: [
        { entidad, entidad_id: entidadId, referencia },
        { entidad: "equipos", entidad_id: Number(eq.id), referencia: nombre },
      ],
    });
  }
}

/* Alerta de integridad (PDF de informe, adjunto o respaldo): la reporta el sistema. */
export async function incidenciaPorAlertaIntegridad(s: Session, datos: { clave: string; descripcion: string; registros: RegistroLigado[] }): Promise<void> {
  await registrarIncidenciaAutomatica(s, { origen: "alerta_integridad", clave: `alerta_integridad:${datos.clave}`, tipo: "sistema", descripcion: datos.descripcion, impacto: "desconocido", actor: null, registros: datos.registros });
}
