import { SignJWT, jwtVerify, errors as joseErrors, type JWTPayload } from "jose";
import { getConfig } from "./config";
import { HttpError } from "./http";

/* Portado de utils/auth.py del backend Flask original (JWT HS256 con PyJWT). */

/* El token solo identifica a la persona; roles y permisos se leen de la base en cada peticion. */
export interface CurrentUser extends JWTPayload {
  sub: string;
  email?: string;
  nombre?: string;
  /* token_version de la cuenta al emitir el token (Fase 2: revocacion del lado del servidor). */
  tv?: number;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getConfig().JWT_SECRET);
}

export async function createAccessToken(payload: Record<string, unknown>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + getConfig().JWT_EXPIRES_HOURS * 3600;
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(secretKey());
}

async function decodeAccessToken(token: string): Promise<CurrentUser> {
  const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
  return payload as CurrentUser;
}

/*
 * Equivalente del decorador token_required.
 * 1. Leer header Authorization.
 * 2. Validar formato Bearer.
 * 3. Decodificar JWT y manejar expiracion/token invalido.
 * 4. Regresar el usuario actual para RBAC y auditoria.
 */
export async function requireUser(request: Request): Promise<CurrentUser> {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new HttpError(401, { message: "Token requerido" });
  }
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) {
    throw new HttpError(401, { message: "Token requerido" });
  }
  try {
    return await decodeAccessToken(token);
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) {
      throw new HttpError(401, { message: "Token expirado" });
    }
    throw new HttpError(401, { message: "Token invalido" });
  }
}

export function userIdFromClaims(user: CurrentUser | null | undefined): number | null {
  const raw = user?.sub;
  if (raw === undefined || raw === null || raw === "") return null;
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isFinite(parsed) ? parsed : null;
}
