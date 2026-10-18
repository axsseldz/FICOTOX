import { requireUser, userIdFromClaims, type CurrentUser } from "./auth";
import { exigirVerRegistro, MODULO_DE_REGISTRO } from "./acceso-registro";
import { registrarAuditoria } from "./audit";
import { getConfig } from "./config";
import { type Row, type Session } from "./db";
import { HttpError, json, readJson, type RouteContext } from "./http";
import { cargarAutorizacion, cargoActuante, permisoDe, requirePermission, type Autorizacion } from "./rbac";

import { exigirReauth } from "./seguridad";
import { ACCIONES_CRITICAS, esTipoActivo, etiquetasDeSolicitud, permisoParaAprobar, TIPOS_SOLICITUD, type EstadoSolicitud, type TipoSolicitud } from "../shared/acciones-criticas";
import { evaluarSegundoUsuario } from "../shared/segregacion";
import { documentosOcultos } from "./modules/sgc/acceso";

/* Documentos SGC confidenciales que la persona no ve: sus solicitudes no se le muestran (ni clave ni motivo). */
async function sinDocumentosOcultos(s: Session, auth: Autorizacion, filas: Solicitud[]): Promise<Solicitud[]> {
  if (!filas.some((f) => f.entidad === "sgc_documentos")) return filas;
  const ocultos = new Set(await documentosOcultos(s, auth));
  return filas.filter((f) => f.entidad !== "sgc_documentos" || !ocultos.has(String(f.entidad_id)));
}

/*
 * Solicitudes de autorizacion de un segundo usuario (Fase 3; seccion 10 de
 * "Roles y permisos FICOTOX"). Nada se borra: una solicitud pasa por
 * pendiente -> aprobada | rechazada | cancelada | vencida.
 *
 * - Al pedir una accion critica el servidor NO la ejecuta: crea la solicitud
 *   (con reautenticacion del solicitante) y el registro queda "solicitada ·
 *   pendiente de autorizacion"; mientras tanto no se edita ni sirve de origen.
 * - Un segundo usuario, distinto del solicitante (regla 6 de segregacion) y con
 *   el permiso que exige la accion (acciones-criticas.ts), la aprueba o rechaza
 *   con motivo y reautenticacion. Al aprobar, el ejecutor del tipo corre en la
 *   misma transaccion; si falla, la solicitud sigue pendiente.
 * - El solicitante puede cancelarla. Vencen a los SOLICITUD_VENCE_DIAS dias.
 */

const ahoraIso = () => new Date().toISOString();

export interface Solicitud extends Row {
  id: number;
  tipo: TipoSolicitud;
  modulo: string;
  entidad: string;
  entidad_id: string;
  referencia: string | null;
  accion: string;
  datos_json: string | null;
  motivo: string;
  solicitado_por: number;
  solicitado_rol: string | null;
  solicitado_en: string;
  estado: EstadoSolicitud;
  resuelto_por: number | null;
  resuelto_rol: string | null;
  resuelto_en: string | null;
  motivo_resolucion: string | null;
  vence_en: string;
}

export const datosDe = (solicitud: Solicitud): Record<string, unknown> => {
  try {
    const value = JSON.parse(String(solicitud.datos_json || "{}"));
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export interface NuevaSolicitud {
  tipo: TipoSolicitud;
  entidad: string;
  entidadId: number | string;
  referencia: string;
  /* Accion concreta (anular, restaurar, revisar, asignar_rol...). */
  accion: string;
  datos?: Record<string, unknown>;
  motivo: string;
  /* Cargo con el que actua el solicitante (si aplica). */
  cargo?: string | null;
}

/*
 * Crea la solicitud (una sola pendiente por registro y tipo) y la deja en la
 * bitacora del registro. Devuelve la fila y la respuesta 202 lista para enviar.
 */
export async function crearSolicitud(s: Session, user: CurrentUser, nueva: NuevaSolicitud): Promise<Solicitud> {
  const motivo = String(nueva.motivo || "").trim();
  if (motivo.length < 5) throw new HttpError(400, { message: "Indica el motivo de la solicitud (al menos 5 caracteres)" });
  /*
   * Una sola solicitud pendiente por registro. En cuentas de usuario, una por
   * tipo (y en asignar_rol, una por rol): una cuenta puede tener pendientes a la
   * vez su rol inicial, otro rol y una ampliacion de vigencia.
   */
  const existente = nueva.entidad === "usuarios" ? await pendienteDeCuenta(s, nueva) : nueva.tipo === "excepcion_segregacion" ? await excepcionPendiente(s, nueva, userIdFromClaims(user) as number) : await solicitudPendiente(s, nueva.entidad, nueva.entidadId);
  if (existente) throw new HttpError(409, { message: `${nueva.referencia} ya tiene una solicitud pendiente de autorización (${etiquetasDeSolicitud(existente.tipo).etiqueta} #${existente.id})`, codigo: "solicitud_pendiente", solicitud: existente });
  const permiso = permisoParaAprobar(nueva.tipo, nueva.entidad);
  const vence = new Date(Date.now() + getConfig().SOLICITUD_VENCE_DIAS * 86_400_000).toISOString();
  const result = await s.execute(
    `INSERT INTO solicitudes_autorizacion (tipo, modulo, entidad, entidad_id, referencia, accion, datos_json, motivo, solicitado_por, solicitado_rol, solicitado_en, estado, vence_en)
     VALUES (:tipo, :modulo, :entidad, :entidad_id, :referencia, :accion, :datos, :motivo, :por, :rol, :en, 'pendiente', :vence)`,
    {
      tipo: nueva.tipo,
      modulo: permiso.modulo,
      entidad: nueva.entidad,
      entidad_id: String(nueva.entidadId),
      referencia: nueva.referencia.slice(0, 160),
      accion: nueva.accion.slice(0, 40),
      datos: JSON.stringify(nueva.datos || {}),
      motivo,
      por: userIdFromClaims(user),
      rol: nueva.cargo ? String(nueva.cargo).slice(0, 120) : null,
      en: ahoraIso(),
      vence,
    },
  );
  const id = result.lastrowid as number;
  await registrarAuditoria(s, user, {
    accion: "solicitar",
    entidad: nueva.entidad,
    entidadId: nueva.entidadId,
    referencia: nueva.referencia,
    motivo,
    detalle: { solicitud_id: id, tipo: nueva.tipo, accion: nueva.accion, aprueba: `${permiso.modulo}:${permiso.accion}`, vence_en: vence, ...(nueva.datos ? { datos: nueva.datos } : {}), ...(nueva.cargo ? { actuo_como: { cargo: nueva.cargo } } : {}) },
  });
  return (await s.queryOne<Solicitud>("SELECT * FROM solicitudes_autorizacion WHERE id = :id", { id }))!;
}

/* Respuesta comun cuando la accion quedo en solicitud (202). */
export function respuestaSolicitud(solicitud: Solicitud, que: string): Response {
  const def = ACCIONES_CRITICAS[solicitud.tipo];
  return json({ message: `${def.pendiente}: ${que} queda pendiente de la autorización de un segundo usuario (solicitud #${solicitud.id})`, solicitud: serializarSolicitud(solicitud), codigo: "solicitud_creada" }, 202);
}

export function serializarSolicitud(solicitud: Solicitud): Record<string, unknown> {
  // Una solicitud de una accion retirada (p. ej. obsoletar_documento) se muestra como "Acción retirada", sin aprobar.
  const etiquetas = etiquetasDeSolicitud(solicitud.tipo);
  return { ...solicitud, datos: datosDe(solicitud), etiqueta: etiquetas.etiqueta, pendiente_etiqueta: etiquetas.pendiente, retirada: !esTipoActivo(solicitud.tipo) };
}

async function pendienteDeCuenta(s: Session, nueva: NuevaSolicitud): Promise<Solicitud | null> {
  const filas = await s.query<Solicitud>("SELECT * FROM solicitudes_autorizacion WHERE entidad = 'usuarios' AND entidad_id = :id AND tipo = :tipo AND estado = 'pendiente'", { id: String(nueva.entidadId), tipo: nueva.tipo });
  const ahora = ahoraIso();
  return filas.find((f) => f.vence_en > ahora && (nueva.tipo !== "asignar_rol" || String(datosDe(f).rol_id) === String(nueva.datos?.rol_id))) || null;
}

/* La excepcion de segregacion no bloquea el registro: solo una pendiente por persona y accion. */
async function excepcionPendiente(s: Session, nueva: NuevaSolicitud, solicitante: number): Promise<Solicitud | null> {
  const filas = await s.query<Solicitud>("SELECT * FROM solicitudes_autorizacion WHERE entidad = :entidad AND entidad_id = :id AND tipo = 'excepcion_segregacion' AND estado = 'pendiente' AND solicitado_por = :por", { entidad: nueva.entidad, id: String(nueva.entidadId), por: solicitante });
  const ahora = ahoraIso();
  return filas.find((f) => f.vence_en > ahora && String(datosDe(f).accion) === String(nueva.datos?.accion)) || null;
}

/*
 * Solicitud pendiente (vigente) que bloquea un registro, o null. La excepcion de
 * segregacion no bloquea (la pide una persona para si misma). Una vencida se
 * ignora aqui; la marca el barrido (vencerSolicitudes) o cargarPendiente, fuera
 * de la transaccion de la accion.
 */
async function solicitudPendiente(s: Session, entidad: string, entidadId: number | string): Promise<Solicitud | null> {
  const fila = await s.queryOne<Solicitud>("SELECT * FROM solicitudes_autorizacion WHERE entidad = :entidad AND entidad_id = :id AND estado = 'pendiente' AND tipo <> 'excepcion_segregacion' AND vence_en > :ahora ORDER BY id DESC LIMIT 1", { entidad, id: String(entidadId), ahora: ahoraIso() });
  return fila || null;
}

/* Solicitudes pendientes de varios registros de una entidad (para las listas). */
export async function pendientesDe(s: Session, entidad: string, ids: Array<number | string>): Promise<Map<string, Solicitud>> {
  const out = new Map<string, Solicitud>();
  if (!ids.length) return out;
  const placeholders = ids.map((_, i) => `:i${i}`).join(", ");
  const filas = await s.query<Solicitud>(`SELECT * FROM solicitudes_autorizacion WHERE entidad = :entidad AND estado = 'pendiente' AND tipo <> 'excepcion_segregacion' AND entidad_id IN (${placeholders}) ORDER BY id ASC`, { entidad, ...Object.fromEntries(ids.map((id, i) => [`i${i}`, String(id)])) });
  const ahora = ahoraIso();
  for (const f of filas) if (f.vence_en > ahora) out.set(String(f.entidad_id), f);
  return out;
}

/* Mientras hay una solicitud pendiente el registro no se edita ni sirve de origen. */
export async function exigirSinSolicitudPendiente(s: Session, entidad: string, entidadId: number | string, referencia: string, que: string): Promise<void> {
  const pendiente = await solicitudPendiente(s, entidad, entidadId);
  if (!pendiente) return;
  const def = etiquetasDeSolicitud(pendiente.tipo);
  throw new HttpError(409, { message: `${referencia} tiene una ${def.pendiente.toLowerCase()} pendiente de autorización (solicitud #${pendiente.id}); no se puede ${que} hasta que se resuelva`, codigo: "solicitud_pendiente", solicitud: serializarSolicitud(pendiente) });
}

async function vencer(s: Session, fila: Solicitud): Promise<void> {
  await s.execute("UPDATE solicitudes_autorizacion SET estado = 'vencida', resuelto_en = :en, motivo_resolucion = 'Venció el plazo sin resolverse' WHERE id = :id AND estado = 'pendiente'", { en: ahoraIso(), id: fila.id });
  await registrarAuditoria(s, null, { accion: "vencer_solicitud", entidad: fila.entidad, entidadId: fila.entidad_id, referencia: fila.referencia, motivo: `Venció el plazo (${getConfig().SOLICITUD_VENCE_DIAS} días) sin resolverse`, detalle: { solicitud_id: fila.id, tipo: fila.tipo, accion: fila.accion, solicitado_por: fila.solicitado_por } });
}

/* Barrido: marca vencidas las pendientes que pasaron su plazo (bootstrap, una vez por minuto). */
export async function vencerSolicitudes(s: Session): Promise<number> {
  const filas = await s.query<Solicitud>("SELECT * FROM solicitudes_autorizacion WHERE estado = 'pendiente' AND vence_en <= :ahora", { ahora: ahoraIso() });
  for (const fila of filas) await vencer(s, fila);
  return filas.length;
}

/* ---------- Ejecutores ---------- */

export interface ContextoEjecucion {
  s: Session;
  /* Quien aprueba (ejecuta la accion en su nombre, con constancia del solicitante). */
  user: CurrentUser;
  actuo: { rol_id: number; cargo: string };
  solicitud: Solicitud;
  datos: Record<string, unknown>;
  motivo: string;
}
type Ejecutor = (ctx: ContextoEjecucion) => Promise<Record<string, unknown>>;
export type Ejecutores = Partial<Record<TipoSolicitud, Ejecutor>>;

/* ---------- Bandeja ---------- */

function puedeAprobar(auth: Autorizacion, solicitud: Solicitud): boolean {
  if (!esTipoActivo(solicitud.tipo)) return false;
  const permiso = permisoParaAprobar(solicitud.tipo, solicitud.entidad);
  // Regla 6: ni quien pidio la accion ni la persona afectada (cambios de acceso sobre su propia cuenta) la aprueban.
  const sobreMiCuenta = solicitud.entidad === "usuarios" && String(solicitud.entidad_id) === String(auth.userId);
  return !!permisoDe(auth, permiso.modulo, permiso.accion) && Number(solicitud.solicitado_por) !== auth.userId && !sobreMiCuenta;
}

/*
 * GET /api/solicitudes: por omision las pendientes que la persona puede aprobar
 * y las suyas. Con entidad y entidad_id, todas las de ese registro (pestana
 * "Solicitudes" del historial; requiere ver su modulo). estado=todas para el
 * historial general.
 */
export async function listarSolicitudes({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const auth = await cargarAutorizacion(s, user);
  // Las vencidas se marcan y se confirman antes de listar.
  if (await vencerSolicitudes(s)) await s.commit();
  const url = new URL(request.url);
  const entidad = (url.searchParams.get("entidad") || "").trim();
  const entidadId = (url.searchParams.get("entidad_id") || "").trim();
  const estado = (url.searchParams.get("estado") || "pendiente").trim();
  const nombres = new Map<number, string>();
  const personas = await s.query<{ id: number; nombre: string }>("SELECT id, nombre FROM usuarios");
  for (const p of personas) nombres.set(Number(p.id), String(p.nombre));
  const decorar = (f: Solicitud) => ({
    ...serializarSolicitud(f),
    solicitado_nombre: nombres.get(Number(f.solicitado_por)) || null,
    resuelto_nombre: f.resuelto_por ? nombres.get(Number(f.resuelto_por)) || null : null,
    puedo_aprobar: f.estado === "pendiente" && puedeAprobar(auth, f),
    puedo_cancelar: f.estado === "pendiente" && Number(f.solicitado_por) === auth.userId,
  });
  if (entidad && entidadId) {
    const modulo = permisoParaAprobar("anular_registro", entidad).modulo;
    // Fase 11/12: se ve como la ficha del registro (alcances asignado, autorizados, propio e incidencias; lo no visible es 404).
    if (MODULO_DE_REGISTRO[entidad]) await exigirVerRegistro(s, user, auth, entidad, entidadId);
    else if (!permisoDe(auth, modulo, "V")) throw new HttpError(403, { message: `Permiso denegado para ${modulo}:V` });
    const filas = await s.query<Solicitud>("SELECT * FROM solicitudes_autorizacion WHERE entidad = :entidad AND entidad_id = :id ORDER BY id DESC LIMIT 200", { entidad, id: entidadId });
    return json({ items: filas.map(decorar), total: filas.length });
  }
  const filas = await s.query<Solicitud>(estado === "todas" ? "SELECT * FROM solicitudes_autorizacion ORDER BY id DESC LIMIT 500" : "SELECT * FROM solicitudes_autorizacion WHERE estado = :estado ORDER BY id DESC LIMIT 500", { estado });
  const visibles = await sinDocumentosOcultos(s, auth, filas.filter((f) => Number(f.solicitado_por) === auth.userId || puedeAprobar(auth, { ...f, estado: "pendiente" }) || (f.resuelto_por !== null && Number(f.resuelto_por) === auth.userId)));
  const items = visibles.map(decorar);
  return json({ items, total: items.length, por_autorizar: items.filter((i) => i.puedo_aprobar).length });
}

/* Cuantas solicitudes pendientes puede aprobar la persona (aviso del Inicio). */
export async function porAutorizarDe(s: Session, auth: Autorizacion): Promise<Solicitud[]> {
  const filas = await s.query<Solicitud>("SELECT * FROM solicitudes_autorizacion WHERE estado = 'pendiente' AND vence_en > :ahora ORDER BY id ASC LIMIT 100", { ahora: ahoraIso() });
  return sinDocumentosOcultos(s, auth, filas.filter((f) => puedeAprobar(auth, f)));
}

/* ---------- Resolver ---------- */

async function cargarPendiente(s: Session, params: Record<string, string | string[]>, { permitirRetirada = false } = {}): Promise<Solicitud> {
  const id = Number.parseInt(String(params.id || ""), 10);
  const fila = Number.isFinite(id) ? await s.queryOne<Solicitud>("SELECT * FROM solicitudes_autorizacion WHERE id = :id", { id }) : null;
  if (!fila) throw new HttpError(404, { message: "Solicitud no encontrada" });
  if (fila.estado === "pendiente" && fila.vence_en <= ahoraIso()) {
    // Se confirma el vencimiento antes de responder (el 409 haria rollback).
    await vencer(s, fila);
    await s.commit();
    throw new HttpError(409, { message: `La solicitud #${fila.id} venció sin resolverse`, codigo: "solicitud_vencida" });
  }
  if (fila.estado !== "pendiente") throw new HttpError(409, { message: `La solicitud #${fila.id} ya está ${fila.estado}` });
  // Accion retirada del catalogo: no se aprueba ni se rechaza (quien la pidio aun puede cancelarla).
  if (!permitirRetirada && !TIPOS_SOLICITUD.includes(fila.tipo)) throw new HttpError(410, { message: "Esa acción se retiró del catálogo; la solicitud ya no se puede resolver y vencerá sola", codigo: "retirado" });
  return fila;
}

/* Aprobar: segundo usuario con el permiso de la accion; ejecuta en la misma transaccion. */
export function aprobarSolicitudCon(ejecutores: Ejecutores) {
  return async ({ request, s, params }: RouteContext): Promise<Response> => {
    const user = await requireUser(request);
    const solicitud = await cargarPendiente(s, params);
    const yo = userIdFromClaims(user) as number;
    const violacion = evaluarSegundoUsuario(yo, solicitud.solicitado_por);
    if (violacion) throw new HttpError(409, { message: violacion.mensaje, codigo: "segregacion", regla: violacion.regla, clave: violacion.clave });
    // Regla 6 tambien para la persona afectada: nadie aprueba un cambio de acceso sobre su propia cuenta.
    if (solicitud.entidad === "usuarios" && String(solicitud.entidad_id) === String(yo)) throw new HttpError(409, { message: "La solicitud es sobre tu propia cuenta; la debe aprobar otra persona", codigo: "segregacion", regla: 6, clave: "segundo_usuario" });
    const permiso = permisoParaAprobar(solicitud.tipo, solicitud.entidad);
    const actuo = cargoActuante(request, await requirePermission(s, user, permiso.modulo, permiso.accion));
    const payload = await readJson(request);
    const motivo = String(payload.motivo || "").trim();
    if (motivo.length < 5) throw new HttpError(400, { message: "Indica el motivo de la aprobación (al menos 5 caracteres)" });
    await exigirReauth(s, request, user, "solicitudes:aprobar");
    const ejecutor = ejecutores[solicitud.tipo];
    if (!ejecutor) throw new HttpError(500, { message: `No hay ejecutor para el tipo ${solicitud.tipo}` });
    const en = ahoraIso();
    const resuelta = await s.execute("UPDATE solicitudes_autorizacion SET estado = 'aprobada', resuelto_por = :por, resuelto_rol = :rol, resuelto_en = :en, motivo_resolucion = :motivo WHERE id = :id AND estado = 'pendiente'", { por: yo, rol: actuo.cargo, en, motivo, id: solicitud.id });
    // Otra persona la resolvio al mismo tiempo: no se ejecuta dos veces.
    if (!resuelta.rowcount) throw new HttpError(409, { message: `La solicitud #${solicitud.id} ya fue resuelta por otra persona` });
    await registrarAuditoria(s, user, {
      accion: "aprobar_solicitud",
      entidad: solicitud.entidad,
      entidadId: solicitud.entidad_id,
      referencia: solicitud.referencia,
      motivo,
      detalle: { solicitud_id: solicitud.id, tipo: solicitud.tipo, accion: solicitud.accion, solicitado_por: solicitud.solicitado_por, actuo_como: actuo },
    });
    const resultado = await ejecutor({ s, user, actuo, solicitud: { ...solicitud, estado: "aprobada", resuelto_por: yo, resuelto_rol: actuo.cargo, resuelto_en: en, motivo_resolucion: motivo }, datos: datosDe(solicitud), motivo });
    await s.commit();
    const actual = (await s.queryOne<Solicitud>("SELECT * FROM solicitudes_autorizacion WHERE id = :id", { id: solicitud.id }))!;
    return json({ message: `Solicitud #${solicitud.id} aprobada y ejecutada`, solicitud: serializarSolicitud(actual), resultado });
  };
}

export async function rechazarSolicitud({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const solicitud = await cargarPendiente(s, params);
  const yo = userIdFromClaims(user) as number;
  const violacion = evaluarSegundoUsuario(yo, solicitud.solicitado_por);
  if (violacion) throw new HttpError(409, { message: "Solicitaste esta acción; para desistir cancélala", codigo: "segregacion", regla: violacion.regla, clave: violacion.clave });
  const permiso = permisoParaAprobar(solicitud.tipo, solicitud.entidad);
  const actuo = cargoActuante(request, await requirePermission(s, user, permiso.modulo, permiso.accion));
  const payload = await readJson(request);
  const motivo = String(payload.motivo || "").trim();
  if (motivo.length < 5) throw new HttpError(400, { message: "Indica el motivo del rechazo (al menos 5 caracteres)" });
  await exigirReauth(s, request, user, "solicitudes:rechazar");
  const resuelta = await s.execute("UPDATE solicitudes_autorizacion SET estado = 'rechazada', resuelto_por = :por, resuelto_rol = :rol, resuelto_en = :en, motivo_resolucion = :motivo WHERE id = :id AND estado = 'pendiente'", { por: yo, rol: actuo.cargo, en: ahoraIso(), motivo, id: solicitud.id });
  // Otra persona la resolvio al mismo tiempo: no se ejecuta dos veces.
  if (!resuelta.rowcount) throw new HttpError(409, { message: `La solicitud #${solicitud.id} ya fue resuelta por otra persona` });
  await registrarAuditoria(s, user, { accion: "rechazar_solicitud", entidad: solicitud.entidad, entidadId: solicitud.entidad_id, referencia: solicitud.referencia, motivo, detalle: { solicitud_id: solicitud.id, tipo: solicitud.tipo, accion: solicitud.accion, solicitado_por: solicitud.solicitado_por, actuo_como: actuo } });
  await s.commit();
  const actual = (await s.queryOne<Solicitud>("SELECT * FROM solicitudes_autorizacion WHERE id = :id", { id: solicitud.id }))!;
  return json({ message: `Solicitud #${solicitud.id} rechazada`, solicitud: serializarSolicitud(actual) });
}

/* El solicitante desiste de su solicitud pendiente. */
export async function cancelarSolicitud({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await cargarAutorizacion(s, user);
  const solicitud = await cargarPendiente(s, params, { permitirRetirada: true });
  const yo = userIdFromClaims(user) as number;
  if (Number(solicitud.solicitado_por) !== yo) throw new HttpError(403, { message: "Solo quien hizo la solicitud puede cancelarla" });
  const payload = await readJson(request);
  const motivo = String(payload.motivo || "").trim() || "Cancelada por quien la solicitó";
  const resuelta = await s.execute("UPDATE solicitudes_autorizacion SET estado = 'cancelada', resuelto_por = :por, resuelto_en = :en, motivo_resolucion = :motivo WHERE id = :id AND estado = 'pendiente'", { por: yo, en: ahoraIso(), motivo, id: solicitud.id });
  // Otra persona la resolvio al mismo tiempo: no se ejecuta dos veces.
  if (!resuelta.rowcount) throw new HttpError(409, { message: `La solicitud #${solicitud.id} ya fue resuelta por otra persona` });
  await registrarAuditoria(s, user, { accion: "cancelar_solicitud", entidad: solicitud.entidad, entidadId: solicitud.entidad_id, referencia: solicitud.referencia, motivo, detalle: { solicitud_id: solicitud.id, tipo: solicitud.tipo, accion: solicitud.accion } });
  await s.commit();
  const actual = (await s.queryOne<Solicitud>("SELECT * FROM solicitudes_autorizacion WHERE id = :id", { id: solicitud.id }))!;
  return json({ message: `Solicitud #${solicitud.id} cancelada`, solicitud: serializarSolicitud(actual) });
}

/* Detalle comun para la bitacora de la accion ejecutada por una solicitud. */
export const detalleSolicitud = (solicitud: Solicitud): Record<string, unknown> => ({ solicitud_id: solicitud.id, solicitado_por: solicitud.solicitado_por, solicitado_rol: solicitud.solicitado_rol });
