/*
 * Firmas ligadas a cuentas (Fase 5).
 *
 * - En recepcion, procesamiento, extraccion y analisis, quien firma (recibio,
 *   proceso, superviso, extrajo, limpio, analista) se elige de las cuentas
 *   activas: se guarda su usuario_id, su nombre y su cargo.
 * - Si quien firma no es la persona de la sesion, confirma con su propia
 *   contrasena. La interfaz la envia AL GUARDAR, junto con el usuario_id del
 *   firmante (`firmantes.<rol>.password`), y el servidor la verifica al inicio
 *   de esa misma peticion (verificarFirmasConPassword): antes de guardar no se
 *   escribe nada (ni token ni bitacora). Se conserva el camino anterior por
 *   API: POST /api/firmas/confirmar devuelve un token de firma de un solo uso
 *   (10 minutos) que se envia como `token_firma`.
 * - Quien firma un trabajo tecnico (proceso, extrajo, limpio, analista) debe
 *   tener la autorizacion FX-THF-AP de esa actividad y metodo.
 * - Un nombre escrito sin cuenta (clientes anteriores de la API) se conserva
 *   como texto, sin usuario_id; la interfaz siempre elige cuentas.
 */
import { versionFoto } from "./modules/fotos";
import { createHash, randomBytes } from "node:crypto";
import { requireUser, userIdFromClaims, type CurrentUser } from "./auth";
import { registrarAuditoria } from "./audit";
import { vigentesDe } from "./autorizaciones";
import { getConfig } from "./config";
import { type Row, type Session } from "./db";
import { HttpError, json, readJson, type RouteContext } from "./http";
import { verifyPassword } from "./password";
import { rolesVigentes } from "./rbac";

import { faltantes, type Requisito } from "../shared/autorizaciones";

const TOKENS = "firmas_tokens";
const VIGENCIA_MIN = 10;

const hashToken = (token: string) => createHash("sha256").update(`${token}:${getConfig().SECRET_KEY}`).digest("hex");

/* POST /api/firmas/confirmar { usuario_id, password }: el firmante confirma con su contrasena. */
export async function confirmarFirmante({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const payload = await readJson(request);
  const usuarioId = Number(payload.usuario_id) || 0;
  const fila = await s.queryOne<Row>("SELECT id, nombre, email, activo, password_hash, bloqueado_hasta FROM usuarios WHERE id = :id", { id: usuarioId });
  if (!fila || !Number(fila.activo ?? 1)) throw new HttpError(400, { message: "Elige una cuenta activa" });
  if (fila.bloqueado_hasta && String(fila.bloqueado_hasta) > new Date().toISOString()) throw new HttpError(423, { message: "La cuenta del firmante está bloqueada temporalmente" });
  if (!verifyPassword(String(payload.password || ""), (fila.password_hash as string | null) || null)) {
    await registrarAuditoria(s, user, { accion: "reauth_fallida", entidad: "usuarios", entidadId: usuarioId, referencia: String(fila.email), detalle: { motivo: "confirmar firma" } });
    await s.commit();
    throw new HttpError(401, { message: `La contraseña de ${fila.nombre || fila.email} no es correcta`, codigo: "firma_invalida" });
  }
  const token = randomBytes(24).toString("base64url");
  const ahora = new Date();
  const expira = new Date(ahora.getTime() + VIGENCIA_MIN * 60_000).toISOString();
  await s.execute(`INSERT INTO ${TOKENS} (token_hash, usuario_id, solicitado_por, creado_en, expira_en) VALUES (:h, :u, :por, :en, :exp)`, { h: hashToken(token), u: usuarioId, por: userIdFromClaims(user), en: ahora.toISOString(), exp: expira });
  await registrarAuditoria(s, user, { accion: "confirmar_firma", entidad: "usuarios", entidadId: usuarioId, referencia: String(fila.email), detalle: { firmante: fila.nombre || fila.email } });
  await s.commit();
  return json({ token_firma: token, usuario: { id: usuarioId, nombre: fila.nombre, email: fila.email }, expira_en: expira });
}

/* Consume un token de firma: debe ser de ese firmante, emitido para esta sesion, vigente y sin usar. */
async function consumirToken(s: Session, token: string, firmanteId: number, sesionId: number): Promise<boolean> {
  if (!token) return false;
  const fila = await s.queryOne<Row>(`SELECT * FROM ${TOKENS} WHERE token_hash = :h`, { h: hashToken(token) });
  if (!fila || fila.usado_en || Number(fila.usuario_id) !== firmanteId || Number(fila.solicitado_por) !== sesionId || String(fila.expira_en) < new Date().toISOString()) return false;
  const r = await s.execute(`UPDATE ${TOKENS} SET usado_en = :en WHERE id = :id AND usado_en IS NULL`, { en: new Date().toISOString(), id: fila.id });
  return r.rowcount > 0;
}

/*
 * Firmas confirmadas con la contrasena enviada al guardar. Se marcan sobre el
 * propio objeto del payload (no viaja en JSON, asi que no se puede falsificar).
 */
const verificadas = new WeakMap<object, Set<string>>();

/*
 * Verifica las contrasenas de los firmantes que vienen en el payload
 * (`firmantes.<rol>.password`). Se llama al inicio del guardado, antes de
 * cualquier otra escritura: si una no es correcta, solo se registra el intento
 * fallido en la bitacora y no se guarda nada (401 firma_invalida, con el rol).
 */
const ETIQUETA_ROL: Record<string, string> = { recibio: "Recibido por", proceso: "Procesó", superviso: "Supervisó", extrajo: "Extrajo", limpio: "Realizó la limpieza", analista: "Analista" };

export async function verificarFirmasConPassword(s: Session, user: CurrentUser, payload: Record<string, unknown>): Promise<void> {
  const elegidos = (payload.firmantes && typeof payload.firmantes === "object" ? payload.firmantes : {}) as Record<string, { usuario_id?: unknown; password?: unknown } | null>;
  const ok = new Set<string>();
  for (const [rol, elegido] of Object.entries(elegidos)) {
    const r = { rol, etiqueta: ETIQUETA_ROL[rol] || "Firma" };
    const usuarioId = Number(elegido?.usuario_id) || 0;
    const password = typeof elegido?.password === "string" ? elegido.password : "";
    if (!usuarioId || !password) continue;
    const fila = await s.queryOne<Row>("SELECT id, nombre, email, activo, password_hash, bloqueado_hasta FROM usuarios WHERE id = :id", { id: usuarioId });
    if (!fila || !Number(fila.activo ?? 1)) throw new HttpError(400, { message: `${r.etiqueta}: elige una cuenta activa`, rol: r.rol });
    if (fila.bloqueado_hasta && String(fila.bloqueado_hasta) > new Date().toISOString()) throw new HttpError(423, { message: `${r.etiqueta}: la cuenta de ${fila.nombre || fila.email} está bloqueada temporalmente`, codigo: "firma_bloqueada", rol: r.rol });
    if (!verifyPassword(password, (fila.password_hash as string | null) || null)) {
      await registrarAuditoria(s, user, { accion: "reauth_fallida", entidad: "usuarios", entidadId: usuarioId, referencia: String(fila.email), detalle: { motivo: "confirmar firma" } });
      await s.commit();
      throw new HttpError(401, { message: `${r.etiqueta}: la contraseña de ${fila.nombre || fila.email} no es correcta`, codigo: "firma_invalida", rol: r.rol });
    }
    ok.add(`${r.rol}:${usuarioId}`);
  }
  verificadas.set(payload, ok);
}

/* ---------- Firmantes de cada formato ---------- */

export interface RolFirma {
  /* Clave en payload.firmantes y prefijo de columnas (<rol>_usuario_id, <rol>_cargo). */
  rol: string;
  /* Columna con el nombre visible del firmante. */
  columnaNombre: string;
  etiqueta: string;
  /* Autorizaciones FX-THF-AP que necesita el firmante (trabajo tecnico). */
  requisitos?: Requisito[];
}

async function cargoDe(s: Session, usuarioId: number): Promise<string | null> {
  const roles = await rolesVigentes(s, usuarioId);
  return roles[0]?.nombre ? String(roles[0].nombre) : null;
}

/*
 * Resuelve los firmantes elegidos en el formato y los escribe en `data`
 * (nombre, <rol>_usuario_id, <rol>_cargo). Si el firmante no es la persona de
 * la sesion exige su token de firma; si hace trabajo tecnico, su autorizacion.
 * Sin firmante elegido en un rol, se conserva lo anterior (edicion) o el nombre escrito.
 */
export async function resolverFirmantes(s: Session, user: CurrentUser, payload: Record<string, unknown>, data: Record<string, unknown>, roles: RolFirma[], antes?: Row | null): Promise<void> {
  const sesionId = userIdFromClaims(user) as number;
  const elegidos = (payload.firmantes && typeof payload.firmantes === "object" ? payload.firmantes : {}) as Record<string, { usuario_id?: unknown; token_firma?: unknown } | null>;
  for (const r of roles) {
    const elegido = elegidos[r.rol];
    const usuarioId = Number(elegido?.usuario_id) || 0;
    if (!usuarioId) {
      // Sin cuenta elegida: se conserva la firma ligada anterior si el nombre no cambio.
      const previo = antes?.[`${r.rol}_usuario_id`];
      const mismoNombre = antes && String(antes[r.columnaNombre] || "") === String(data[r.columnaNombre] || "");
      data[`${r.rol}_usuario_id`] = previo && mismoNombre ? Number(previo) : null;
      data[`${r.rol}_cargo`] = previo && mismoNombre ? (antes?.[`${r.rol}_cargo`] as string | null) || null : null;
      continue;
    }
    const persona = await s.queryOne<Row>("SELECT id, nombre, email, activo FROM usuarios WHERE id = :id", { id: usuarioId });
    if (!persona || !Number(persona.activo ?? 1)) throw new HttpError(400, { message: `${r.etiqueta}: elige una cuenta activa` });
    const yaLigado = antes && Number(antes[`${r.rol}_usuario_id`]) === usuarioId;
    const conPassword = verificadas.get(payload)?.has(`${r.rol}:${usuarioId}`) || false;
    if (usuarioId !== sesionId && !yaLigado && !conPassword && !(await consumirToken(s, String(elegido?.token_firma || ""), usuarioId, sesionId))) {
      throw new HttpError(403, { message: `${r.etiqueta}: ${persona.nombre || persona.email} debe confirmar su firma con su contraseña`, codigo: "firma_sin_confirmar", rol: r.rol });
    }
    if (r.requisitos?.length && getConfig().AUTORIZACIONES_OBLIGATORIAS) {
      const faltan = faltantes(r.requisitos, await vigentesDe(s, usuarioId));
      if (faltan.length) throw new HttpError(403, { message: `${r.etiqueta}: ${persona.nombre || persona.email} no tiene autorización vigente para ${faltan.map((f) => f.texto).join(", ")} (FX-THF-AP)`, codigo: "no_autorizado", faltan, rol: r.rol });
    }
    data[r.columnaNombre] = String(persona.nombre || persona.email).slice(0, 180);
    data[`${r.rol}_usuario_id`] = usuarioId;
    data[`${r.rol}_cargo`] = await cargoDe(s, usuarioId);
  }
}

/* Guarda en el registro las cuentas y cargos de los firmantes resueltos. */
export async function guardarFirmantes(s: Session, tabla: string, id: number, data: Record<string, unknown>, roles: RolFirma[]): Promise<void> {
  const sets = roles.flatMap((r) => [`${r.rol}_usuario_id = :${r.rol}_usuario_id`, `${r.rol}_cargo = :${r.rol}_cargo`]);
  const params: Record<string, unknown> = { id };
  for (const r of roles) {
    params[`${r.rol}_usuario_id`] = data[`${r.rol}_usuario_id`] ?? null;
    params[`${r.rol}_cargo`] = data[`${r.rol}_cargo`] ?? null;
  }
  await s.execute(`UPDATE ${tabla} SET ${sets.join(", ")} WHERE id = :id`, params);
}

/* GET /api/cuentas/activas: cuentas activas para elegir firmantes o asignar muestras (nombre, correo y cargo). */
export async function listarCuentasActivas({ request, s }: RouteContext): Promise<Response> {
  await requireUser(request);
  const filas = await s.query<Row>("SELECT id, nombre, email, avatar, foto, usa_foto FROM usuarios WHERE COALESCE(activo, 1) = 1 ORDER BY nombre, email");
  const items = [];
  // La figura de perfil elegida (o null) y, si la persona eligio mostrarla, la version de su foto: la interfaz muestra a cada quien asi.
  for (const f of filas) items.push({ id: Number(f.id), nombre: f.nombre || f.email, email: f.email, avatar: f.avatar ?? null, foto: Number(f.usa_foto) && f.foto ? versionFoto(f.foto) : null, cargo: await cargoDe(s, Number(f.id)) });
  return json({ items });
}

/* El formato eligio una cuenta para ese rol de firma. */
export function firmanteElegido(payload: Record<string, unknown>, rol: string): boolean {
  const elegidos = (payload.firmantes && typeof payload.firmantes === "object" ? payload.firmantes : {}) as Record<string, { usuario_id?: unknown } | null>;
  return !!Number(elegidos[rol]?.usuario_id);
}
