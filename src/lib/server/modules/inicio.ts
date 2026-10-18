import { numeroFolio } from "../../shared/folios";
import { requireUser } from "../auth";
import { pendientesDe } from "../pendientes";
import { json, type RouteContext } from "../http";
import { cargarAutorizacion, permisoDe, requirePermission, soloEstado } from "../rbac";
import type { Accion, ContextoAlcance, Modulo } from "../../shared/permisos";

import { diasDesde, formatearFecha } from "../../shared/fechas";
import { esCoordinacion, filtroAsignadas, soloAsignado } from "../asignaciones";

/*
 * Datos del Inicio.
 *
 * `inicioEnCurso`: cada recepción que todavía no termina su flujo, con la
 * etapa en la que va (recepción → procesamiento → extracción → análisis →
 * informe → cierre) y el siguiente paso concreto, con enlace, para que la
 * persona sepa qué toca hacer sin abrir cada lista.
 *
 * `inicioAvisos`: los avisos del Inicio con los primeros elementos de cada
 * uno (qué reactivos están bajos, qué equipos requieren calibración...), con
 * las mismas reglas SQL que usan las listas, para que la cuenta del aviso
 * coincida con lo que se ve al abrirlo.
 */


type StepKey = "recepcion" | "procesamiento" | "extraccion" | "analisis" | "informe";
type StepState = "done" | "current" | "pending" | "warn";

interface FlowStep {
  key: StepKey;
  label: string;
  state: StepState;
  folio: string | null;
  href: string | null;
  detail: string | null;
}

interface FlowItem {
  id: number;
  folio: string;
  cliente: string | null;
  muestras: string[];
  analisis_tipos: string[];
  fecha_recepcion: string | null;
  dias: number;
  estado: string;
  etapa: StepKey | "cierre";
  /* accion "ver": la persona no tiene el permiso de ese paso; solo se informa. */
  siguiente: { label: string; href: string; accion: "capturar" | "revisar" | "aprobar" | "cerrar" | "ver" };
  pasos: FlowStep[];
  /* Fase 6: recepcion liberada -> "Falta disposición final" (va al final de la lista). */
  nota?: string | null;
  /* Etapa del flujo del Inicio: como `etapa`, con "revision" aparte (analisis o informe esperando firma). */
  etapa_flujo: StepKey | "revision" | "cierre";
  /* Personas con la muestra asignada (vigentes). */
  asignados: Array<{ id: number; nombre: string | null; email: string | null; avatar: string | null }>;
  /* Ultimo cambio en la recepcion o en cualquiera de sus registros. */
  ultimo_movimiento: string | null;
}

const safeJson = <T,>(raw: unknown, fallback: T): T => {
  try {
    const value = JSON.parse(String(raw ?? ""));
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
};

const fmtDate = (value: unknown): string | null => (value ? formatearFecha(value) : null);

/* Dias transcurridos por dia local del laboratorio. */
const daysSince = (iso: string | null): number => diasDesde(iso);

export async function inicioEnCurso({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const permiso = await requirePermission(s, user, "muestras", "V");

  /*
   * Fase 5: cada analista (captura ensayos sin ser coordinacion) o quien tiene el
   * alcance "asignado" ve solo sus muestras: asignadas o registradas por la persona.
   */
  const soloMias = soloAsignado(permiso) || (!esCoordinacion(permiso.auth) && !!permisoDe(permiso.auth, "ensayos", "C"));
  const mias = await filtroAsignadas(s, permiso.auth.userId, "id", soloMias, "creado_por");
  const ABIERTAS = `estado NOT IN ('cerrada', 'anulada', 'rechazada') ${mias.sql}`;
  const total = Number((await s.scalar(`SELECT COUNT(*) FROM muestras_recepcion WHERE ${ABIERTAS}`, mias.params)) || 0);
  const recepciones = await s.query(
    `SELECT id, folio_num, solicitante, id_interno, muestra_unica, lote_muestras_json, analisis_json, estado, decision_aceptacion, fecha_recepcion, actualizado_en
     FROM muestras_recepcion
     WHERE ${ABIERTAS}
     ORDER BY fecha_recepcion DESC, id DESC
     LIMIT 300`,
    mias.params,
  );
  if (!recepciones.length) return json({ items: [], resumen: {}, total: 0 });

  const ids = recepciones.map((r) => Number(r.id));
  const inList = ids.join(",");
  const [procesamientos, analisis, informes, asignaciones] = await Promise.all([
    s.query(`SELECT id, folio_num, recepcion_id, estado, fecha_procesamiento, actualizado_en FROM muestras_procesamiento WHERE recepcion_id IN (${inList}) AND estado <> 'anulada' ORDER BY id DESC`),
    s.query(`SELECT id, folio_num, recepcion_id, extraccion_id, tipo_analisis, estado, actualizado_en FROM muestras_analisis WHERE recepcion_id IN (${inList}) AND estado <> 'anulado' ORDER BY id DESC`),
    s.query(`SELECT id, folio_num, version, recepcion_id, estado, actualizado_en FROM informes WHERE recepcion_id IN (${inList}) AND estado NOT IN ('anulado', 'sustituido') ORDER BY version DESC, id DESC`),
    s.query(`SELECT a.recepcion_id, u.id, u.nombre, u.email, u.avatar FROM asignaciones_muestra a INNER JOIN usuarios u ON u.id = a.usuario_id WHERE a.recepcion_id IN (${inList}) AND a.revocado_en IS NULL ORDER BY a.id ASC`),
  ]);
  const procIds = procesamientos.map((p) => Number(p.id));
  const extracciones = procIds.length
    ? await s.query(`SELECT id, folio_num, tipo_registro, procesamiento_id, estado, actualizado_en FROM muestras_extraccion WHERE procesamiento_id IN (${procIds.join(",")}) AND estado <> 'anulada' ORDER BY id DESC`)
    : [];

  const items: FlowItem[] = recepciones.map((r) => {
    const id = Number(r.id);
    const folio = `R ${numeroFolio(r.folio_num)}`;
    const lote = safeJson<Array<Record<string, unknown>>>(r.lote_muestras_json, []);
    const muestras = r.muestra_unica || !lote.length ? [String(r.id_interno || "")].filter(Boolean) : lote.filter((m) => m.trabajar !== false).map((m) => String(m.id_interno || "")).filter(Boolean);
    const tipos = safeJson<{ tipos?: string[] }>(r.analisis_json, {}).tipos || [];
    const proc = procesamientos.find((p) => Number(p.recepcion_id) === id) || null;
    /*
     * Una recepción puede pedir ASP y DSP: entonces hacen falta una extracción
     * por tipo y un análisis por extracción. Se muestra el pendiente menos
     * avanzado, para que el "siguiente paso" nunca salte una firma.
     */
    const requeridos = [tipos.includes("acido_domoico") ? "E-A" : null, tipos.includes("toxinas_lipofilicas") ? "E-D" : null].filter((t): t is string => !!t);
    const exts = proc ? extracciones.filter((e) => Number(e.procesamiento_id) === Number(proc.id)) : [];
    const faltaTipo = proc ? requeridos.find((t) => !exts.some((e) => String(e.tipo_registro || "E-A") === t)) || null : null;
    const ext = exts[0] || null;
    const ans = analisis.filter((a) => Number(a.recepcion_id) === id);
    const extSinAnalisis = exts.find((e) => !ans.some((a) => Number(a.extraccion_id) === Number(e.id))) || null;
    const RANK: Record<string, number> = { registrado: 0, en_revision: 1, revisado: 2, aprobado: 3 };
    const an = ans.length ? ans.reduce((menor, a) => ((RANK[String(a.estado)] ?? 0) < (RANK[String(menor.estado)] ?? 0) ? a : menor)) : null;
    const inf = informes.find((i) => Number(i.recepcion_id) === id) || null;
    const decision = String(r.decision_aceptacion || "");
    const aceptada = decision === "aceptada" || decision === "aceptada_con_desviacion";
    const anEstado = String(an?.estado || "");
    const infEstado = String(inf?.estado || "");
    const tipoExtraccion = faltaTipo || (requeridos.length === 1 ? requeridos[0] : null);

    /* Etapa actual y siguiente paso. */
    let etapa: FlowItem["etapa"];
    let siguiente: FlowItem["siguiente"];
    let requiere: [Modulo, Accion, ContextoAlcance?];
    if (!aceptada) {
      etapa = "recepcion";
      siguiente = { label: "Registrar decisión de aceptación", href: `/muestras/recepcion/${id}`, accion: "capturar" };
      requiere = ["muestras", "E", { objeto: "recepcion", borrador: true }];
    } else if (!proc) {
      etapa = "procesamiento";
      siguiente = { label: "Registrar procesamiento", href: `/muestras/procesamiento/nuevo?recepcion=${id}`, accion: "capturar" };
      requiere = ["ensayos", "C", { objeto: "procesamiento", borrador: true }];
    } else if (!ext || faltaTipo) {
      etapa = "extraccion";
      const label = ext && faltaTipo ? `Registrar extracción ${faltaTipo === "E-D" ? "DSP" : "ASP"}` : "Registrar extracción";
      siguiente = { label, href: `/muestras/extraccion/nueva?procesamiento=${proc.id}${tipoExtraccion ? `&tipo=${tipoExtraccion}` : ""}`, accion: "capturar" };
      requiere = ["ensayos", "C", { objeto: "extraccion", borrador: true }];
    } else if (!an || extSinAnalisis) {
      etapa = "analisis";
      const objetivo = extSinAnalisis || ext;
      const label = an && extSinAnalisis ? `Registrar análisis ${String(extSinAnalisis.tipo_registro) === "E-D" ? "DSP" : "ASP"}` : "Registrar análisis";
      siguiente = { label, href: `/muestras/analisis/nuevo?extraccion=${objetivo.id}`, accion: "capturar" };
      requiere = ["ensayos", "C", { objeto: "analisis", borrador: true }];
    } else if (anEstado === "registrado") {
      etapa = "analisis";
      siguiente = { label: "Enviar análisis a revisión", href: `/muestras/analisis/${an.id}`, accion: "capturar" };
      requiere = ["ensayos", "C", { objeto: "analisis", borrador: true }];
    } else if (anEstado === "en_revision") {
      etapa = "analisis";
      siguiente = { label: "Revisar análisis", href: `/muestras/analisis/${an.id}`, accion: "revisar" };
      requiere = ["ensayos", "R"];
    } else if (anEstado === "revisado") {
      etapa = "analisis";
      siguiente = { label: "Aprobar análisis", href: `/muestras/analisis/${an.id}`, accion: "aprobar" };
      requiere = ["ensayos", "A"];
    } else if (!inf) {
      etapa = "informe";
      siguiente = { label: "Crear informe", href: `/informes/nuevo?recepcion=${id}`, accion: "capturar" };
      requiere = ["informes", "C", { objeto: "informe", borrador: true }];
    } else if (infEstado === "borrador") {
      etapa = "informe";
      siguiente = { label: "Revisar informe", href: `/informes/${inf.id}`, accion: "revisar" };
      requiere = ["informes", "R"];
    } else if (infEstado === "en_revision") {
      etapa = "informe";
      siguiente = { label: "Autorizar informe", href: `/informes/${inf.id}`, accion: "aprobar" };
      requiere = ["informes", "A"];
    } else if (infEstado === "autorizado") {
      etapa = "informe";
      siguiente = { label: "Liberar informe", href: `/informes/${inf.id}`, accion: "aprobar" };
      requiere = ["informes", "A"];
    } else if (infEstado === "liberado") {
      etapa = "informe";
      siguiente = { label: "Enviar informe por correo", href: `/informes/${inf.id}`, accion: "cerrar" };
      requiere = ["informes", "A"];
    } else {
      etapa = "cierre";
      siguiente = { label: "Registrar disposición final", href: `/muestras/recepcion/${id}`, accion: "cerrar" };
      requiere = ["muestras", "A"];
    }
    // Si la persona no puede dar ese paso, se muestra como pendiente (sin boton de accion) y enlaza a la recepcion.
    if (!permisoDe(permiso.auth, requiere[0], requiere[1], requiere[2])) {
      siguiente = { label: `Pendiente: ${siguiente.label.charAt(0).toLowerCase()}${siguiente.label.slice(1)}`, href: `/muestras/recepcion/${id}`, accion: "ver" };
    }

    const order: StepKey[] = ["recepcion", "procesamiento", "extraccion", "analisis", "informe"];
    const currentIndex = etapa === "cierre" ? order.length : order.indexOf(etapa);
    const stateFor = (index: number): StepState => (index < currentIndex ? "done" : index === currentIndex ? "current" : "pending");
    const pasos: FlowStep[] = [
      { key: "recepcion", label: "Recepción", state: stateFor(0), folio, href: `/muestras/recepcion/${id}`, detail: aceptada ? (decision === "aceptada_con_desviacion" ? "Aceptada con desviación" : "Aceptada") : "Sin decisión de aceptación" },
      { key: "procesamiento", label: "Procesamiento", state: stateFor(1), folio: proc ? `P ${numeroFolio(proc.folio_num)}` : null, href: proc ? `/muestras/procesamiento/${proc.id}` : null, detail: proc ? fmtDate(proc.fecha_procesamiento) : null },
      { key: "extraccion", label: "Extracción", state: stateFor(2), folio: exts.length ? exts.map((e) => `${e.tipo_registro || "E-A"} ${numeroFolio(e.folio_num)}`).join(" · ") : null, href: ext ? `/muestras/extraccion/${ext.id}` : null, detail: faltaTipo ? `Falta la extracción ${faltaTipo === "E-D" ? "DSP" : "ASP"}` : exts.length ? exts.map((e) => (String(e.tipo_registro) === "E-D" ? "DSP" : "ASP")).join(" + ") : tipoExtraccion ? (tipoExtraccion === "E-D" ? "DSP" : "ASP") : null },
      { key: "analisis", label: "Análisis", state: stateFor(3), folio: ans.length ? ans.map((a) => `A ${numeroFolio(a.folio_num)}`).join(" · ") : null, href: an ? `/muestras/analisis/${an.id}` : null, detail: extSinAnalisis && an ? `Falta el análisis ${String(extSinAnalisis.tipo_registro) === "E-D" ? "DSP" : "ASP"}` : an ? (anEstado === "aprobado" ? (ans.length > 1 ? "Aprobados" : "Aprobado") : anEstado === "revisado" ? "Revisado, falta aprobar" : anEstado === "en_revision" ? "Enviado a revisión, falta revisar" : "Registrado, falta enviar a revisión") : null },
      { key: "informe", label: "Informe", state: stateFor(4), folio: inf ? `IR ${numeroFolio(inf.folio_num)}${Number(inf.version || 1) > 1 ? ` v${inf.version}` : ""}` : null, href: inf ? `/informes/${inf.id}` : null, detail: inf ? ({ borrador: "Borrador", en_revision: "En revisión", autorizado: "Autorizado, falta liberar", liberado: "Liberado, falta enviar", enviado: "Enviado" } as Record<string, string>)[infEstado] || infEstado : null },
    ];

    const revision = (etapa === "analisis" && (anEstado === "en_revision" || anEstado === "revisado")) || (etapa === "informe" && !!inf && (infEstado === "borrador" || infEstado === "en_revision"));
    const marcas = [r.actualizado_en, proc?.actualizado_en, inf?.actualizado_en, ...exts.map((e) => e.actualizado_en), ...ans.map((a) => a.actualizado_en)].map((v) => String(v || "")).filter(Boolean);

    return {
      id,
      folio,
      etapa_flujo: revision ? "revision" : etapa,
      asignados: asignaciones.filter((a) => Number(a.recepcion_id) === id).map((a) => ({ id: Number(a.id), nombre: (a.nombre as string | null) ?? null, email: (a.email as string | null) ?? null, avatar: (a.avatar as string | null) ?? null })),
      ultimo_movimiento: marcas.length ? marcas.sort().at(-1) || null : null,
      cliente: (r.solicitante as string | null) || null,
      muestras,
      analisis_tipos: tipos,
      fecha_recepcion: (r.fecha_recepcion as string | null) || null,
      dias: daysSince((r.fecha_recepcion as string | null) || null),
      estado: String(r.estado || ""),
      etapa,
      siguiente,
      pasos,
      nota: String(r.estado) === "liberada" ? "Falta disposición final" : null,
    };
  });

  /* Lo más urgente primero: quien espera una firma, luego lo más antiguo. */
  const weight: Record<FlowItem["siguiente"]["accion"], number> = { aprobar: 0, revisar: 1, capturar: 2, cerrar: 3, ver: 4 };
  // Fase 6: las recepciones liberadas (solo falta la disposicion final) van al final.
  items.sort((a, b) => Number(!!a.nota) - Number(!!b.nota) || weight[a.siguiente.accion] - weight[b.siguiente.accion] || b.dias - a.dias);

  const resumen: Record<string, number> = {};
  for (const item of items) resumen[item.etapa_flujo] = (resumen[item.etapa_flujo] || 0) + 1;
  // Alcance "estado": folio, solicitante, fechas y estado; sin muestras, analisis ni enlaces a ensayos.
  if (soloEstado(permiso)) {
    const recortados = items.map((item) => ({ ...item, muestras: [], analisis_tipos: [], pasos: item.pasos.map((paso) => ({ ...paso, href: paso.key === "recepcion" ? paso.href : null, detail: null }))}));
    return json({ items: recortados, resumen, total, solo_estado: true });
  }
  return json({ items, resumen, total });
}

/* ---------- Avisos con detalle ("Para ti") ---------- */

/*
 * Los pendientes de la persona agrupados, con su cuenta y los primeros seis
 * elementos. Salen de la misma fuente que la campana (src/lib/server/pendientes.ts),
 * asi que ningun pendiente aparece en uno y falta en el otro.
 */
export async function inicioAvisos({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const auth = await cargarAutorizacion(s, user);
  const grupos = await pendientesDe(s, auth);
  const items = grupos.map((g) => ({ key: g.key, label: g.label, tone: g.tone, count: g.count, href: g.href, items: g.eventos.slice(0, 6).map((e) => ({ label: e.registro, sub: e.detalle, href: e.href, persona_id: e.persona_id ?? null, persona: e.persona ?? null })) }));
  return json({ items, total: items.reduce((sum, a) => sum + a.count, 0) });
}
