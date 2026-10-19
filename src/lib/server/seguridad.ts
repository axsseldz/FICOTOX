import { createHash, randomBytes } from "node:crypto";
import type { CurrentUser } from "./auth";
import { registrarAuditoria } from "./audit";
import { getConfig } from "./config";
import { type Row, type Session } from "./db";
import { HttpError } from "./http";

/*
 * Seguridad de cuentas (Fase 2; FX-MO-2-1, secciones 10 y 11):
 * - Intentos fallidos de inicio de sesion y de reautenticacion, por cuenta y
 *   por IP. N fallos en la ventana bloquean la cuenta (o la IP) un tiempo.
 *   El mensaje al usuario es el mismo exista o no la cuenta.
 * - Reautenticacion: token de un solo uso, de vida corta, ligado a la persona
 *   y a la accion critica que va a realizar.
 */

/* ---------- IP del cliente ---------- */

/*
 * IP de la peticion (bloqueo por IP).
 * - TRUST_PROXY=true (detras de un proxy propio): la primera de X-Forwarded-For
 *   o X-Real-IP, que fija el proxy.
 * - Sin proxy, con el lanzador de produccion (scripts/start-ficotox.mjs):
 *   scripts/ip-real.mjs sobrescribe X-Forwarded-For con la direccion del
 *   socket, asi que el cliente no puede elegir su IP.
 * - `next dev`/`next start` sin el lanzador: Next pone la direccion del socket
 *   solo si el cliente no manda el encabezado; un cliente que lo falsifica
 *   puede eludir el limite por IP o bloquear otra IP (el bloqueo por cuenta no
 *   cambia). En produccion usa el lanzador o un proxy con TRUST_PROXY=true.
 * Nunca se usa un valor compartido para todas las peticiones.
 */
export function ipDe(request: Request): string {
  const forwarded = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const real = (request.headers.get("x-real-ip") || "").trim();
  if (getConfig().TRUST_PROXY) return (forwarded || real || "desconocida").slice(0, 64);
  return (forwarded || "desconocida").slice(0, 64);
}

/* ---------- Intentos y bloqueo ---------- */

const minutos = (n: number) => n * 60_000;
const ahoraIso = () => new Date().toISOString();

export const MENSAJE_ACCESO_FALLIDO = "Correo o contraseña incorrectos. Después de varios intentos fallidos el acceso se bloquea temporalmente.";

export interface EstadoAcceso {
  bloqueadaHasta: string | null;
  ipBloqueada: boolean;
}

/* ¿Esta bloqueada la cuenta (por su correo) o la IP? No distingue si la cuenta existe. */
export async function estadoAcceso(s: Session, email: string, ip: string): Promise<EstadoAcceso> {
  const cfg = getConfig();
  const ahora = Date.now();
  const usuario = await s.queryOne<{ bloqueado_hasta: string | null }>("SELECT bloqueado_hasta FROM usuarios WHERE LOWER(email) = LOWER(:email)", { email });
  let bloqueadaHasta = usuario?.bloqueado_hasta && Date.parse(usuario.bloqueado_hasta) > ahora ? usuario.bloqueado_hasta : null;
  if (!usuario) {
    // Correo inexistente: se bloquea igual (por correo) para no revelar si la cuenta existe.
    const desde = new Date(ahora - minutos(cfg.LOGIN_VENTANA_MIN)).toISOString();
    const fallos = await s.query<{ fecha: string }>("SELECT fecha FROM intentos_acceso WHERE email = :email AND exito = 0 AND fecha >= :desde ORDER BY fecha DESC", { email, desde });
    if (fallos.length >= cfg.LOGIN_MAX_INTENTOS) {
      const hasta = new Date(Date.parse(fallos[cfg.LOGIN_MAX_INTENTOS - 1].fecha) + minutos(cfg.LOGIN_BLOQUEO_MIN));
      if (hasta.getTime() > ahora) bloqueadaHasta = hasta.toISOString();
    }
  }
  const desdeIp = new Date(ahora - minutos(cfg.LOGIN_VENTANA_MIN)).toISOString();
  const fallosIp = Number((await s.scalar("SELECT COUNT(*) FROM intentos_acceso WHERE ip = :ip AND exito = 0 AND fecha >= :desde", { ip, desde: desdeIp })) || 0);
  return { bloqueadaHasta, ipBloqueada: fallosIp >= cfg.LOGIN_IP_MAX_INTENTOS };
}

/*
 * Registra un intento. Si es un fallo y la cuenta suma el maximo en la
 * ventana, la bloquea (bloqueado_hasta, token_version + 1) y lo deja en la
 * bitacora. Devuelve true si este fallo provoco el bloqueo.
 */
export async function registrarIntento(s: Session, datos: { email: string; ip: string; tipo: "login" | "reauth" | "firma"; exito: boolean; usuario?: Row | null; sesion?: string | null; actor?: CurrentUser | null }): Promise<boolean> {
  const cfg = getConfig();
  const email = datos.email.trim().toLowerCase().slice(0, 150);
  const usuarioId = datos.usuario ? Number(datos.usuario.id) : null;
  await s.execute("INSERT INTO intentos_acceso (email, usuario_id, ip, tipo, exito, fecha, sesion) VALUES (:email, :usuario_id, :ip, :tipo, :exito, :fecha, :sesion)", {
    email,
    usuario_id: usuarioId,
    ip: datos.ip,
    tipo: datos.tipo,
    exito: datos.exito ? 1 : 0,
    fecha: ahoraIso(),
    sesion: datos.sesion ? datos.sesion.slice(0, 64) : null,
  });
  if (datos.exito) {
    if (usuarioId) await s.execute("UPDATE usuarios SET intentos_desde = :fecha WHERE id = :id", { fecha: ahoraIso(), id: usuarioId });
    return false;
  }
  // Confirmar la firma de otra persona: el fallo queda a nombre de quien lo intento, sobre la cuenta del firmante.
  if (datos.tipo === "firma") await registrarAuditoria(s, datos.actor, { accion: "reauth_fallida", entidad: "usuarios", entidadId: usuarioId, referencia: email, detalle: { motivo: "confirmar firma", ip: datos.ip } });
  else await registrarAuditoria(s, null, { accion: datos.tipo === "login" ? "login_fallido" : "reauth_fallida", entidad: "sesion", entidadId: usuarioId, referencia: email, detalle: { ip: datos.ip, existe_usuario: !!datos.usuario } });
  if (!datos.usuario) return false;
  const desdeVentana = new Date(Date.now() - minutos(cfg.LOGIN_VENTANA_MIN)).toISOString();
  const reinicio = String(datos.usuario.intentos_desde || "");
  const desde = reinicio && reinicio > desdeVentana ? reinicio : desdeVentana;
  const fallos = Number((await s.scalar("SELECT COUNT(*) FROM intentos_acceso WHERE usuario_id = :id AND exito = 0 AND fecha > :desde", { id: usuarioId, desde })) || 0);
  if (fallos < cfg.LOGIN_MAX_INTENTOS) return false;
  const hasta = new Date(Date.now() + minutos(cfg.LOGIN_BLOQUEO_MIN)).toISOString();
  await s.execute("UPDATE usuarios SET bloqueado_hasta = :hasta, intentos_desde = :ahora, token_version = COALESCE(token_version, 0) + 1 WHERE id = :id", { hasta, ahora: ahoraIso(), id: usuarioId });
  await registrarAuditoria(s, null, {
    accion: "bloquear",
    entidad: "usuarios",
    entidadId: usuarioId,
    referencia: email,
    motivo: `${fallos} intentos fallidos en ${cfg.LOGIN_VENTANA_MIN} minutos`,
    detalle: { bloqueado_hasta: hasta, ip: datos.ip, tipo: datos.tipo },
  });
  return true;
}

/* Identificador de la sesion (jti del token; los tokens anteriores sin jti, por persona y hora de emision). */
export function sesionDe(user: CurrentUser): string {
  return String(user.jti || `${user.sub}:${user.iat ?? ""}`).slice(0, 64);
}

/*
 * Limite de intentos fallidos de confirmar firmas desde una misma sesion
 * (LOGIN_MAX_INTENTOS en LOGIN_VENTANA_MIN). Evita que una sesion pruebe
 * contrasenas de varias cuentas sin bloquear ninguna. 429 mientras dure.
 */
export async function exigirIntentosFirma(s: Session, user: CurrentUser): Promise<void> {
  const cfg = getConfig();
  const desde = new Date(Date.now() - minutos(cfg.LOGIN_VENTANA_MIN)).toISOString();
  const fallos = await s.query<{ fecha: string }>("SELECT fecha FROM intentos_acceso WHERE sesion = :sesion AND tipo = 'firma' AND exito = 0 AND fecha >= :desde ORDER BY fecha ASC", { sesion: sesionDe(user), desde });
  if (fallos.length < cfg.LOGIN_MAX_INTENTOS) return;
  const libre = Date.parse(fallos[fallos.length - cfg.LOGIN_MAX_INTENTOS].fecha) + minutos(cfg.LOGIN_VENTANA_MIN);
  const min = Math.max(1, Math.ceil((libre - Date.now()) / 60_000));
  throw new HttpError(429, { message: `Demasiados intentos fallidos de confirmar firmas desde esta sesión; espera ${min} min antes de intentar de nuevo`, codigo: "firma_intentos" });
}

/* ---------- Reautenticacion ---------- */

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/* Emite un token de reautenticacion (se guarda solo su hash). */
export async function emitirReauth(s: Session, usuarioId: number, accion: string): Promise<{ token: string; expira_en: string }> {
  const token = randomBytes(32).toString("hex");
  const expira = new Date(Date.now() + minutos(getConfig().REAUTH_TTL_MIN)).toISOString();
  await s.execute("INSERT INTO reautenticaciones (token_hash, usuario_id, accion, creado_en, expira_en) VALUES (:hash, :usuario_id, :accion, :creado, :expira)", {
    hash: hashToken(token),
    usuario_id: usuarioId,
    accion: accion.slice(0, 60),
    creado: ahoraIso(),
    expira,
  });
  return { token, expira_en: expira };
}

/*
 * Exige el token de reautenticacion de la accion critica (encabezado
 * X-Reauth). Sin token: 401 reauth_required. Vencido, usado, de otra persona o
 * de otra accion: 401 reauth_invalido. Si es valido se marca como usado (si el
 * handler falla despues, el rollback lo deja disponible de nuevo).
 */
export async function exigirReauth(s: Session, request: Request, user: CurrentUser, accion: string): Promise<void> {
  const token = (request.headers.get("x-reauth") || "").trim();
  if (!token) {
    throw new HttpError(401, { message: "Esta acción requiere confirmar tu identidad (vuelve a escribir tu contraseña)", codigo: "reauth_required", accion });
  }
  const fila = await s.queryOne<{ id: number; usuario_id: number; accion: string; expira_en: string; usado_en: string | null }>("SELECT id, usuario_id, accion, expira_en, usado_en FROM reautenticaciones WHERE token_hash = :hash", { hash: hashToken(token) });
  const invalido = (motivo: string) => new HttpError(401, { message: `La confirmación de identidad no es válida (${motivo}); vuelve a escribir tu contraseña`, codigo: "reauth_invalido", accion });
  if (!fila) throw invalido("no existe");
  if (String(fila.usuario_id) !== String(user.sub)) throw invalido("es de otra persona");
  if (fila.accion !== accion) throw invalido("es para otra acción");
  if (fila.usado_en) throw invalido("ya se usó");
  if (Date.parse(fila.expira_en) <= Date.now()) throw invalido("venció");
  const result = await s.execute("UPDATE reautenticaciones SET usado_en = :ahora WHERE id = :id AND usado_en IS NULL", { ahora: ahoraIso(), id: fila.id });
  if (!result.rowcount) throw invalido("ya se usó");
}
