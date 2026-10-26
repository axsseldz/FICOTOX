/*
 * Pendientes de una persona: UNA sola fuente para "Para ti" del Inicio
 * (/api/inicio/avisos, agrupados con su cuenta) y para la campana
 * (/api/notificaciones, uno por evento con su estado de lectura).
 *
 * Cada evento lleva una CLAVE estable: tipo + registro + situacion
 * ("solicitud:123", "asignacion:R1:usuario7:4", "stock_bajo:reactivo45:bajo:9",
 * "vence_autorizacion:88:7dias"). Si la situacion cambia o vuelve a ocurrir
 * (otra solicitud, el stock se repone y vuelve a bajar, la autorizacion entra
 * a la ultima semana) la clave cambia y la campana la muestra otra vez.
 *
 * Destinatarios: solo quien puede actuar o debe saberlo (permisos y
 * alcances), nunca por su propia accion (quien pide o captura no recibe su
 * "por autorizar" o "por revisar"). Un evento desaparece solo cuando el
 * pendiente se resuelve.
 */
import { numeroFolio } from "../shared/folios";
import { ACCIONES_CRITICAS } from "../shared/acciones-criticas";
import { formatearFecha, hoyLocal, sumarDias } from "../shared/fechas";
import { autorizacionesPorVencer, permisoAdministrar } from "./autorizaciones";
import { type Row, type Session } from "./db";
import { avisosCalidad } from "./modules/calidad/tablero";
import { alertaBitacora } from "./modules/audit";
import { avisosDeRespaldos } from "./modules/respaldos";
import { vencimientosProximos } from "./modules/admin";
import { permisoDe, type Autorizacion } from "./rbac";
import { porAutorizarDe } from "./solicitudes";
import { contarPorSupervisar } from "./supervision";
import { accesoSgc } from "./modules/sgc/acceso";
import { solicitudesResueltasDe, tareasSgc, type Tarea } from "./modules/sgc/flujo";

type Tono = "danger" | "warning" | "info";

export interface Evento {
  clave: string;
  /* Frase corta ("Revisar análisis", "Stock bajo"). */
  frase: string;
  /* Folio o nombre del registro. */
  registro: string;
  detalle: string | null;
  href: string;
  tono: Tono;
  /* Cuando empezo la situacion (para "hace X"); null si no aplica. */
  cuando: string | null;
  persona_id?: number | null;
  persona?: string | null;
  /* Tipo fino (calidad: incidencia_por_evaluar, accion_vencida…). */
  tipo?: string;
}

export interface GrupoPendiente {
  key: string;
  label: string;
  tone: Tono;
  href: string;
  count: number;
  eventos: Evento[];
}

const fmt = (v: unknown): string => (v ? formatearFecha(v) : "");
/* Tope de eventos por grupo (la cuenta es la de los eventos). */
const MAX = 200;

const safeJson = <T,>(raw: unknown, fallback: T): T => {
  try {
    return (JSON.parse(String(raw ?? "")) ?? fallback) as T;
  } catch {
    return fallback;
  }
};
const folioIr = (r: Row) => `IR ${numeroFolio(r.folio_num)}${Number(r.version || 1) > 1 ? ` v${r.version}` : ""}`;
const clienteDe = (r: Row) => safeJson<{ nombre?: string }>(r.cliente_json, {}).nombre || null;

export async function pendientesDe(s: Session, auth: Autorizacion): Promise<GrupoPendiente[]> {
  const yo = auth.userId;
  const hoy = hoyLocal();
  const en30 = sumarDias(hoy, 30);
  const puede = (m: Parameters<typeof permisoDe>[1], a: Parameters<typeof permisoDe>[2], ctx?: Parameters<typeof permisoDe>[3]) => !!permisoDe(auth, m, a, ctx);
  const grupos: GrupoPendiente[] = [];
  const agregar = (key: string, label: string, tone: Tono, href: string, eventos: Evento[]) => {
    // Sin duplicados: una clave, un evento.
    const unicos = [...new Map(eventos.map((e) => [e.clave, e])).values()];
    if (unicos.length) grupos.push({ key, label, tone: unicos.some((e) => e.tono === "danger") ? "danger" : tone, href, count: unicos.length, eventos: unicos });
  };

  // Quien administra equipos o su mantenimiento, e inventario (no quien solo los consulta o los usa).
  const gestionaEquipos = puede("equipos", "G") || puede("equipos", "R") || puede("equipos", "AN") || puede("equipos", "C", { objeto: "mantenimiento" });
  const alcancesInvC = permisoDe(auth, "inventario", "C")?.alcances || [];
  const gestionaInventario = puede("inventario", "G") || puede("inventario", "R") || puede("inventario", "AN") || alcancesInvC.some((a) => a === "total" || a === "administrativo");

  // Registro de actividad: posible cambio no autorizado (a quien consulta Calidad).
  if (puede("calidad", "V")) {
    const alerta = await alertaBitacora(s);
    if (alerta) agregar("bitacora_alterada", "Posible cambio no autorizado", "danger", "/auditoria", [{ clave: `bitacora_alterada:${alerta.id}`, frase: "Posible cambio no autorizado", registro: "Registro de actividad", detalle: "Avisa a la Coordinación de Mejora Continua", href: "/auditoria", tono: "danger", cuando: (alerta.reportada_en as string | null) ?? null }]);
  }

  // Respaldos: mas de 24 h sin respaldo y mas de 90 dias sin prueba de restauracion (solo a quien tiene respaldos:V).
  for (const a of avisosDeRespaldos(auth)) agregar(a.tipo, a.frase, a.tono, "/calidad/respaldos", [{ clave: a.clave, frase: a.frase, registro: "Respaldos", detalle: a.detalle, href: "/calidad/respaldos", tono: a.tono, cuando: a.cuando }]);

  // Por supervisar: registros que esperan el visto bueno de la persona (su supervisor asignado).
  const INVENTARIO_HREF: Record<string, (id: number) => string> = { equipos: (id) => `/inventario/equipos?abrir=${id}`, mantenimientos: (id) => `/inventario/mantenimiento?abrir=${id}`, reactivos: (id) => `/inventario/reactivos?abrir=${id}`, consumibles: (id) => `/inventario/consumibles?abrir=${id}` };
  agregar(
    "por_supervisar",
    "Por supervisar",
    "warning",
    "/supervision",
    (await contarPorSupervisar(s, yo)).map((r) => ({ clave: `supervision:${r.tabla}:${r.id}:${r.solicitada_en || ""}`, frase: "Por supervisar", registro: `${r.tipo} ${r.referencia}`, detalle: "Espera tu visto bueno", href: INVENTARIO_HREF[String(r.tabla)]?.(Number(r.id)) || String(r.href), tono: "warning", cuando: (r.solicitada_en as string | null) ?? null, persona_id: Number(r.solicitada_por) || null })),
  );

  // Por autorizar: solicitudes que la persona puede aprobar (nunca las propias).
  agregar(
    "por_autorizar",
    "Por autorizar",
    "warning",
    "/solicitudes",
    (await porAutorizarDe(s, auth)).map((sol) => ({ clave: `solicitud:${sol.id}`, frase: "Por autorizar", registro: ACCIONES_CRITICAS[sol.tipo]?.etiqueta || sol.tipo, detalle: `${sol.referencia ? `${sol.referencia} · ` : ""}vence ${fmt(sol.vence_en)}`, href: `/solicitudes?abrir=${sol.id}`, tono: "warning", cuando: sol.solicitado_en ?? null, persona_id: Number(sol.solicitado_por) || null })),
  );

  // Muestras asignadas a la persona en los ultimos 7 dias (abiertas).
  if (puede("muestras", "V")) {
    const filas = await s.query<Row>(
      `SELECT a.id, a.recepcion_id, a.asignado_en, a.asignado_por, u.nombre AS asignador, r.folio_num, r.id_interno, r.solicitante FROM asignaciones_muestra a
       INNER JOIN muestras_recepcion r ON r.id = a.recepcion_id LEFT JOIN usuarios u ON u.id = a.asignado_por
       WHERE a.usuario_id = :yo AND a.revocado_en IS NULL AND a.asignado_en >= :desde AND r.estado NOT IN ('cerrada', 'anulada', 'rechazada')
       ORDER BY a.asignado_en DESC LIMIT ${MAX}`,
      { yo, desde: `${sumarDias(hoy, -7)} 00:00:00` },
    );
    agregar("muestras_asignadas", "Muestras asignadas", "info", "/muestras/recepcion?mias=1", filas.map((r) => ({ clave: `asignacion:R${r.recepcion_id}:usuario${yo}:${r.id}`, frase: "Muestra asignada", registro: `R ${numeroFolio(r.folio_num)}`, detalle: [r.id_interno || r.solicitante, r.asignador ? `te la asignó ${String(r.asignador).split(" ")[0]}` : null].filter(Boolean).join(" · ") || null, href: `/muestras/recepcion/${r.recepcion_id}`, tono: "info", cuando: (r.asignado_en as string | null) ?? null, persona_id: Number(r.asignado_por) || null, persona: (r.asignador as string | null) ?? null })));
  }

  // Analisis por revisar (ensayos:R) o aprobar (ensayos:A), sin los que elaboro la persona.
  const estadosAn = [puede("ensayos", "R") ? "en_revision" : null, puede("ensayos", "A") ? "revisado" : null].filter((e): e is string => !!e);
  if (estadosAn.length) {
    const filas = await s.query<Row>(
      `SELECT a.id, a.folio_num, a.version, a.estado, a.creado_por, a.enviado_revision_por, a.enviado_revision_en, a.revisado_en, r.solicitante FROM muestras_analisis a LEFT JOIN muestras_recepcion r ON r.id = a.recepcion_id
       WHERE a.estado IN (${estadosAn.map((e) => `'${e}'`).join(", ")}) AND COALESCE(a.creado_por, 0) <> :yo AND COALESCE(a.analista_usuario_id, 0) <> :yo AND COALESCE(a.enviado_revision_por, 0) <> :yo ORDER BY a.id LIMIT ${MAX}`,
      { yo },
    );
    agregar("analisis_pendientes", "Análisis esperando revisión o aprobación", "info", "/muestras/analisis?filtro=pendiente", filas.map((a) => {
      const aprobar = String(a.estado) === "revisado";
      return { clave: `analisis:${a.id}:${a.estado}:${aprobar ? a.revisado_en || "" : a.enviado_revision_en || ""}`, frase: aprobar ? "Aprobar análisis" : "Revisar análisis", registro: `A ${numeroFolio(a.folio_num)}${Number(a.version || 1) > 1 ? ` v${a.version}` : ""}`, detalle: (a.solicitante as string | null) || null, href: `/muestras/analisis/${a.id}`, tono: "info" as Tono, cuando: ((aprobar ? a.revisado_en : a.enviado_revision_en) as string | null) ?? null, persona_id: Number(a.enviado_revision_por || a.creado_por) || null };
    }));
  }

  // Informes por revisar (informes:R) o autorizar (informes:A), sin los propios ni los que requieren enmienda.
  const estadosIr = [puede("informes", "R") ? "borrador" : null, puede("informes", "A") ? "en_revision" : null].filter((e): e is string => !!e);
  if (estadosIr.length) {
    const filas = await s.query<Row>(`SELECT id, folio_num, version, estado, cliente_json, creado_por, actualizado_en, revisado_en FROM informes WHERE estado IN (${estadosIr.map((e) => `'${e}'`).join(", ")}) AND COALESCE(creado_por, 0) <> :yo AND COALESCE(requiere_enmienda, 0) = 0 ORDER BY id LIMIT ${MAX}`, { yo });
    agregar("informes_revision", "Informes por revisar o autorizar", "info", "/informes?filtro=pendiente", filas.map((i) => {
      const autorizar = String(i.estado) === "en_revision";
      return { clave: `informe:${i.id}:${i.estado}:v${i.version || 1}`, frase: autorizar ? "Autorizar informe" : "Revisar informe", registro: folioIr(i), detalle: clienteDe(i), href: `/informes/${i.id}`, tono: "info" as Tono, cuando: ((autorizar ? i.revisado_en : i.actualizado_en) as string | null) ?? null, persona_id: Number(i.creado_por) || null };
    }));
  }

  // Informes por liberar (informes:A, no los propios) o enviar (informes:A).
  if (puede("informes", "A")) {
    const filas = await s.query<Row>(`SELECT id, folio_num, version, estado, cliente_json, creado_por, autorizado_en, liberado_en FROM informes WHERE (estado = 'liberado' OR (estado = 'autorizado' AND COALESCE(creado_por, 0) <> :yo)) AND COALESCE(requiere_enmienda, 0) = 0 ORDER BY id LIMIT ${MAX}`, { yo });
    agregar("informes_entrega", "Informes por liberar o enviar", "info", "/informes?filtro=autorizado", filas.map((i) => {
      const enviar = String(i.estado) === "liberado";
      return { clave: `informe:${i.id}:${i.estado}:v${i.version || 1}`, frase: enviar ? "Enviar informe" : "Liberar informe", registro: folioIr(i), detalle: clienteDe(i), href: `/informes/${i.id}`, tono: "info" as Tono, cuando: ((enviar ? i.liberado_en : i.autorizado_en) as string | null) ?? null };
    }));
  }

  // Informes que requieren enmienda (a quien elabora o autoriza informes).
  if (puede("informes", "C") || puede("informes", "A")) {
    const filas = await s.query<Row>(`SELECT id, folio_num, version, estado, requiere_enmienda_motivo, actualizado_en FROM informes WHERE COALESCE(requiere_enmienda, 0) = 1 AND estado IN ('autorizado', 'liberado', 'enviado') ORDER BY id LIMIT ${MAX}`);
    agregar("informes_enmienda", "Informes que requieren enmienda", "danger", "/informes?filtro=requiere_enmienda", filas.map((i) => ({ clave: `enmienda:${i.id}:v${i.version || 1}`, frase: "Requiere enmienda", registro: folioIr(i), detalle: String(i.requiere_enmienda_motivo || "Un análisis incluido se enmendó"), href: `/informes/${i.id}`, tono: "danger", cuando: (i.actualizado_en as string | null) ?? null })));
  }

  // Equipos: mantenimientos vencidos o en 30 dias y alertas de calibracion (a quien los administra).
  if (gestionaEquipos) {
    const TIPO_MANT: Record<string, string> = { preventivo: "Preventivo", correctivo: "Correctivo", calibracion: "Calibración", verificacion: "Verificación" };
    const mant = await s.query<Row>(
      `SELECT mt.id, mt.tipo, mt.estado, mt.fecha_programada, e.nombre AS equipo FROM mantenimientos mt LEFT JOIN equipos e ON e.id = mt.id_equipo
       WHERE (mt.estado = 'vencido' OR (mt.estado IN ('programado', 'en_proceso') AND mt.fecha_programada <= :en30))
         AND COALESCE(e.activo, 1) = 1 ORDER BY mt.fecha_programada LIMIT ${MAX}`,
      { en30 },
    );
    const vencido = (m: Row) => String(m.estado) === "vencido" || String(m.fecha_programada || "") < hoy;
    const evMant = (m: Row): Evento => ({ clave: `mantenimiento:${m.id}:${vencido(m) ? "vencido" : "proximo"}`, frase: vencido(m) ? "Mantenimiento vencido" : "Mantenimiento próximo", registro: String(m.equipo || "Equipo"), detalle: `${TIPO_MANT[String(m.tipo)] || "Mantenimiento"} · ${fmt(m.fecha_programada)}`, href: `/inventario/mantenimiento?filtro=${vencido(m) ? "vencido" : "proximo"}&abrir=${m.id}`, tono: vencido(m) ? "danger" : "info", cuando: vencido(m) ? ((m.fecha_programada as string | null) ?? null) : null });
    agregar("mant_vencidos", "Mantenimientos vencidos", "danger", "/inventario/mantenimiento?filtro=vencido", mant.filter(vencido).map(evMant));
    const cal = await s.query<Row>(`SELECT id, nombre, estado, fecha_prox_calibracion FROM equipos WHERE COALESCE(activo, 1) = 1 AND (estado IN ('calibracion_pendiente', 'fuera_servicio') OR (fecha_prox_calibracion IS NOT NULL AND fecha_prox_calibracion < :hoy)) ORDER BY fecha_prox_calibracion LIMIT ${MAX}`, { hoy });
    agregar("equipos_cal", "Equipos con alerta de calibración", "warning", "/inventario/equipos?filtro=calibracion", cal.map((e) => {
      const fuera = String(e.estado) === "fuera_servicio";
      return { clave: `calibracion:equipo${e.id}:${e.estado}:${e.fecha_prox_calibracion || ""}`, frase: fuera ? "Fuera de servicio" : e.fecha_prox_calibracion ? "Calibración vencida" : "Calibración pendiente", registro: String(e.nombre || "Equipo"), detalle: e.fecha_prox_calibracion ? `Vencía el ${fmt(e.fecha_prox_calibracion)}` : null, href: `/inventario/equipos?abrir=${e.id}`, tono: "warning" as Tono, cuando: (e.fecha_prox_calibracion as string | null) ?? null };
    }));
    agregar("mant_proximos", "Mantenimientos en los próximos 30 días", "info", "/inventario/mantenimiento?filtro=proximo", mant.filter((m) => !vencido(m)).map(evMant));
  }

  // Inventario: stock bajo y caducidades (a quien lo administra). La clave incluye la ultima reposicion:
  // si se repone y vuelve a bajar, es un aviso nuevo.
  if (gestionaInventario) {
    const nombre = "COALESCE(NULLIF(producto, ''), NULLIF(nombre, ''), NULLIF(item_name, ''), 'Reactivo')";
    const reponer = (tabla: string) => `(SELECT MAX(m.id) FROM movimientos m WHERE m.tabla_origen = '${tabla}' AND m.id_item = t.id AND m.tipo = 'entrada')`;
    const bajos = await s.query<Row>(
      `SELECT t.id, ${nombre} AS nombre, t.cantidad_actual, t.unidad, t.actualizado_en, ${reponer("reactivos")} AS repuesto FROM reactivos t
       WHERE COALESCE(t.activo, 1) = 1 AND t.cantidad_actual IS NOT NULL AND (t.cantidad_actual <= 0 OR (COALESCE(t.stock_minimo, 0) > 0 AND t.cantidad_actual <= t.stock_minimo) OR (COALESCE(t.stock_minimo, 0) <= 0 AND COALESCE(t.stock_maximo, 0) > 0 AND t.cantidad_actual <= t.stock_maximo * 0.2))
       ORDER BY t.cantidad_actual ASC LIMIT ${MAX}`,
    );
    agregar("reactivos_bajos", "Reactivos con stock bajo", "warning", "/inventario/reactivos?filtro=bajo", bajos.map((r) => {
      const agotado = Number(r.cantidad_actual) <= 0;
      return { clave: `stock_bajo:reactivo${r.id}:${agotado ? "agotado" : "bajo"}:${r.repuesto || 0}`, frase: agotado ? "Reactivo agotado" : "Stock bajo", registro: String(r.nombre), detalle: agotado ? "Agotado" : `Quedan ${Number(r.cantidad_actual)} ${r.unidad || ""}`.trim(), href: `/inventario/reactivos?abrir=${r.id}`, tono: "warning" as Tono, cuando: (r.actualizado_en as string | null) ?? null };
    }));
    const caducan = await s.query<Row>(`SELECT id, ${nombre} AS nombre, caducidad FROM reactivos WHERE COALESCE(activo, 1) = 1 AND caducidad LIKE '____-__-__%' AND SUBSTR(caducidad, 1, 10) <= :en30 ORDER BY caducidad LIMIT ${MAX}`, { en30 });
    agregar("reactivos_caducan", "Reactivos por caducar", "warning", "/inventario/reactivos?filtro=vencer", caducan.map((r) => {
      const vencido = String(r.caducidad).slice(0, 10) < hoy;
      return { clave: `caducidad:reactivo${r.id}:${String(r.caducidad).slice(0, 10)}:${vencido ? "vencido" : "pronto"}`, frase: vencido ? "Reactivo caducado" : "Caduca pronto", registro: String(r.nombre), detalle: `${vencido ? "Caducó" : "Caduca"} el ${fmt(r.caducidad)}`, href: `/inventario/reactivos?abrir=${r.id}`, tono: (vencido ? "danger" : "warning") as Tono, cuando: vencido ? String(r.caducidad).slice(0, 10) : null };
    }));
    const cons = await s.query<Row>(`SELECT t.id, t.producto, t.existencia, ${reponer("consumibles")} AS repuesto FROM consumibles t WHERE COALESCE(t.activo, 1) = 1 AND COALESCE(t.existencia, 0) <= CASE WHEN COALESCE(t.stock_minimo, 0) > 0 THEN t.stock_minimo ELSE 5 END ORDER BY t.existencia ASC LIMIT ${MAX}`);
    agregar("consumibles_bajos", "Consumibles con poca existencia", "warning", "/inventario/consumibles?filtro=bajo", cons.map((c) => {
      const agotado = Number(c.existencia || 0) <= 0;
      return { clave: `stock_bajo:consumible${c.id}:${agotado ? "agotado" : "bajo"}:${c.repuesto || 0}`, frase: agotado ? "Consumible agotado" : "Pocas unidades", registro: String(c.producto || "Consumible"), detalle: agotado ? "Agotado" : `${Number(c.existencia)} unidad${Number(c.existencia) === 1 ? "" : "es"}`, href: `/inventario/consumibles?abrir=${c.id}`, tono: "warning" as Tono, cuando: null };
    }));
  }

  // Accesos (cuentas y roles) que vencen en 7 dias: todos para quien administra usuarios; si no, los propios y los de sus supervisados.
  const administra = puede("usuarios", "G");
  const vencen = administra ? await vencimientosProximos(s, 7) : [...(await vencimientosProximos(s, 7)).filter((v) => Number(v.id) === yo), ...(await vencimientosProximos(s, 7, yo))];
  // Sin administrar usuarios: si solo vence lo propio, el grupo lleva a «Mis autorizaciones» del Inicio, no a Por supervisar.
  const soloPropios = vencen.every((v) => Number(v.id) === yo);
  agregar("accesos_vencen", "Accesos que vencen en 7 días", "warning", administra ? "/administracion/usuarios?vigencia=vence7" : soloPropios ? "/#mis-autorizaciones" : "/supervision", vencen.map((v) => ({ clave: `vence_acceso:${v.id}:${v.rol || "cuenta"}:${v.vigente_hasta}`, frase: v.rol ? "Rol por vencer" : "Cuenta por vencer", registro: Number(v.id) === yo ? (v.rol ? `Tu rol ${v.rol}` : "Tu cuenta") : `${v.nombre || v.email}${v.rol ? ` · ${v.rol}` : ""}`, detalle: `Vence el ${fmt(v.vigente_hasta)}`, href: administra ? `/administracion/usuarios?vigencia=vence7&abrir=${v.id}` : Number(v.id) === yo ? "/#mis-autorizaciones" : "/supervision", tono: "warning", cuando: null, persona_id: Number(v.id) || null, persona: String(v.nombre || v.email || "") })));

  // Autorizaciones FX-THF-AP por vencer (30 dias; la ultima semana es un aviso nuevo).
  const administraAut = !!permisoAdministrar(auth);
  agregar("autorizaciones_vencen", "Autorizaciones por vencer (30 días)", "warning", administraAut ? "/administracion/usuarios" : "/#mis-autorizaciones", (await autorizacionesPorVencer(s, auth, 30)).map((a) => {
    const semana = String(a.vigente_hasta || "") <= sumarDias(hoy, 7);
    return { clave: `vence_autorizacion:${a.id}:${semana ? "7dias" : "30dias"}`, frase: "Autorización por vencer", registro: a.propia ? `Tu autorización: ${a.etiqueta}` : `${a.persona} · ${a.etiqueta}`, detalle: `Vence el ${fmt(a.vigente_hasta)}`, href: a.propia ? "/#mis-autorizaciones" : administraAut ? `/administracion/usuarios?abrir=${a.usuario_id}` : "/administracion/usuarios", tono: "warning" as Tono, cuando: null, persona_id: Number(a.usuario_id) || null, persona: a.persona };
  }));

  // Documentos SGC: tareas de la bandeja (lo asignado y lo que toca a la persona) y solicitudes propias resueltas.
  if (puede("documentos", "V")) {
    let tareas: Tarea[] = [];
    try {
      tareas = await tareasSgc(s, await accesoSgc(s, auth));
    } catch {
      tareas = [];
    }
    // Las obsolescencias por aprobar ya salen en "Por autorizar".
    agregar("documentos_lecturas", "Lecturas pendientes", "info", "/documentos/bandeja#lecturas", tareas.filter((t) => t.tipo === "lectura").map((t) => ({ tipo: t.tipo, clave: t.clave, frase: t.accion, registro: `${t.clave_documento} rev. ${t.revision}`, detalle: t.titulo, href: t.href, tono: "info" as Tono, cuando: t.desde })));
    agregar("documentos_sgc", "Documentos SGC por atender", "info", "/documentos/bandeja", tareas.filter((t) => t.tipo !== "obsolescencia" && t.tipo !== "lectura").map((t) => ({ tipo: t.tipo, clave: t.clave, frase: t.accion, registro: t.clave_documento ? `${t.clave_documento}${t.revision !== null ? ` rev. ${t.revision}` : ""}` : t.titulo, detalle: [t.titulo, t.fecha_limite ? `${t.vencida ? "venció" : "límite"} ${fmt(t.fecha_limite)}` : null].filter(Boolean).join(" · ") || null, href: t.href, tono: (t.vencida ? "danger" : "info") as Tono, cuando: t.desde })));
    agregar("documentos_solicitudes", "Tus solicitudes de documentos", "info", "/documentos/solicitudes", (await solicitudesResueltasDe(s, yo)).map((f) => ({ clave: `sgc_solicitud_resuelta:${f.id}:${f.estado}`, frase: f.estado === "aceptada" ? "Solicitud aceptada" : "Solicitud rechazada", registro: f.clave ? String(f.clave) : String(f.titulo_propuesto || `Solicitud #${f.id}`), detalle: f.estado === "rechazada" ? String(f.comentario_resolucion || "") : f.revision_id ? "Se abrió la revisión de trabajo" : null, href: f.estado === "aceptada" && f.documento_id ? `/documentos/${f.documento_id}` : `/documentos/solicitudes?abrir=${f.id}`, tono: (f.estado === "rechazada" ? "warning" : "info") as Tono, cuando: (f.resuelta_en as string | null) ?? null })));
  }

  // Calidad: incidencias por evaluar, mis acciones, verificaciones, informes retenidos, suspensiones y reasignaciones.
  const calidad = await avisosCalidad(s, auth);
  const GRUPOS_CALIDAD: Array<[string, string, Tono, string, string[]]> = [
    ["calidad_incidencias", "Incidencias por evaluar", "warning", "/calidad/incidencias?estado_inc=reportada,en_evaluacion", ["incidencia_por_evaluar"]],
    ["calidad_acciones", "Mis acciones correctivas", "info", "/calidad/incidencias?mias=responsable", ["accion_mia", "accion_vencida"]],
    ["calidad_verificaciones", "Verificaciones de eficacia pendientes", "warning", "/calidad/incidencias?etapa_nc=en_verificacion", ["verificacion_pendiente"]],
    ["calidad_retenidos", "Informes retenidos por NC", "danger", "/calidad/incidencias?situacion=retenido", ["informe_retenido"]],
    ["calidad_suspensiones", "Métodos y equipos suspendidos", "danger", "/calidad/incidencias?situacion=suspension", ["suspension"]],
    ["calidad_reasignar", "Acciones por reasignar", "warning", "/calidad/incidencias?tipos=nc", ["responsable_no_vigente"]],
  ];
  for (const [key, label, tone, href, tipos] of GRUPOS_CALIDAD) {
    agregar(key, label, tone, href, calidad.filter((a) => tipos.includes(a.tipo)).map((a) => ({ tipo: a.tipo, clave: a.clave, frase: a.titulo.split(":")[0], registro: a.registro, detalle: a.detalle || null, href: a.href, tono: a.tono, cuando: a.cuando })));
  }

  return grupos;
}
