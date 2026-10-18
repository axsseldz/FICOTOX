import { NextResponse } from "next/server";
import { invalidarIndice } from "./busqueda/version";
import { esConflictoDeFolio, withSession, type Session } from "./db";

/*
 * Utilidades comunes de los route handlers.
 * - HttpError: respuesta JSON con status, equivalente a `return jsonify(...), code`.
 * - apiRoute: abre una sesion de base de datos por request, convierte HttpError
 *   en respuesta y hace rollback si el handler falla (semantica de Flask).
 */

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(String(body.message || `HTTP ${status}`));
  }
}

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

export function notFound(message = "Ruta no encontrada"): NextResponse {
  return json({ message }, 404);
}

/* Equivalente de request.is_json de Flask: application/json o application/*+json. */
function isJsonRequest(request: Request): boolean {
  const mimetype = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  return mimetype === "application/json" || (mimetype.startsWith("application/") && mimetype.endsWith("+json"));
}

/* Equivalente de request.get_json(silent=True) or {} */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!isJsonRequest(request)) return {};
  try {
    const data: unknown = await request.json();
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/* Equivalente del convertidor <int:id> de Flask: si no es entero, 404. */
export function intParam(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new HttpError(404, { message: "Ruta no encontrada" });
  }
  return Number.parseInt(value, 10);
}

export interface RouteContext {
  request: Request;
  params: Record<string, string | string[]>;
  s: Session;
}

type RouteHandler = (ctx: RouteContext) => Promise<Response>;

/*
 * Fase 12 (concurrencia): los folios se calculan con MAX+1 dentro de la
 * transaccion y cada serie tiene una restriccion unica (recepcion,
 * procesamiento, extraccion por tipo, analisis y informe por version, INC y
 * NC). Si dos peticiones toman el mismo folio a la vez, la segunda choca con
 * la restriccion: se deshace y se repite la peticion completa (hasta 3
 * intentos) en una transaccion nueva, que ya ve el folio confirmado. Lo mismo
 * ante un interbloqueo o una espera de bloqueo vencida de MySQL (suspensiones y
 * otras transiciones con FOR UPDATE). En SQLite las sesiones ya van en serie,
 * asi que no ocurre dentro de un proceso.
 */
const INTENTOS = 3;

function esConflictoReintentable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code || "");
  // SQLITE_BUSY*: otro proceso escribio la base (p. ej. SQLITE_BUSY_SNAPSHOT al pasar de lectura a escritura en WAL).
  if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT" || code.startsWith("SQLITE_BUSY")) return true;
  // Series con folio (y el codigo automatico de los reportes de mantenimiento); ver esConflictoDeFolio.
  return esConflictoDeFolio(error);
}

export function apiRoute(handler: RouteHandler) {
  return async (request: Request, routeCtx?: { params?: Promise<Record<string, string | string[]>> | Record<string, string | string[]> }): Promise<Response> => {
    const params = routeCtx?.params ? await routeCtx.params : {};
    try {
      /*
       * Fase 12: el cuerpo (p. ej. una evidencia de 25 MB) se recibe completo ANTES de tomar la sesion. Con
       * SQLite las sesiones van en serie: leerlo dentro retendria a todos mientras dura la transferencia por la
       * red. Cada intento arma su Request desde el mismo bufer (el handler lo lee como siempre).
       */
      const cuerpo = request.method === "GET" || request.method === "HEAD" ? null : await request.arrayBuffer();
      const peticion = () => (cuerpo === null ? request : new Request(request.url, { method: request.method, headers: request.headers, body: cuerpo }));
      // El esquema ya lo dejaron las migraciones al arrancar; antes de atender solo se barren los vencimientos.
      const { barrerVencimientos } = await import("./bootstrap");
      await barrerVencimientos();
      for (let intento = 1; ; intento += 1) {
        const actual = peticion();
        // Si el handler ya confirmo una parte (p. ej. registrar un envio y despues mandar el correo), repetirlo
        // duplicaria efectos: ese conflicto no se reintenta (409 limpio).
        let confirmoAntes = false;
        try {
          const resultado = await withSession(async (s) => {
            try {
              return await handler({ request: actual, params, s });
            } catch (error) {
              confirmoAntes = s.confirmado;
              await s.rollback();
              if (error instanceof HttpError) {
                return json(error.body, error.status);
              }
              throw error;
            }
          });
          // Una escritura exitosa deja sin efecto los índices de la búsqueda en memoria (guardar recientes no cuenta).
          if (request.method !== "GET" && request.method !== "HEAD" && resultado.ok && !new URL(request.url).pathname.startsWith("/api/busqueda")) invalidarIndice();
          return resultado;
        } catch (error) {
          if (!esConflictoReintentable(error)) throw error;
          if (intento >= INTENTOS || confirmoAntes) {
            console.warn(`[api] ${request.method} ${new URL(request.url).pathname}: conflicto de concurrencia ${confirmoAntes ? "despues de confirmar una parte (sin reintento)" : `tras ${INTENTOS} intentos`}`, (error as Error).message);
            return json({ message: "Otra persona registró al mismo tiempo; intenta de nuevo", codigo: "conflicto_concurrencia" }, 409);
          }
          console.info(`[api] reintento ${intento}/${INTENTOS - 1} por concurrencia (${String((error as { code?: unknown }).code || "")}) en ${request.method} ${new URL(request.url).pathname}`);
          await new Promise((r) => setTimeout(r, 20 * intento + Math.floor(Math.random() * 30)));
        }
      }
    } catch (error) {
      console.error(`[api] ${request.method} ${new URL(request.url).pathname}`, error);
      return json({ message: "Error interno del servidor" }, 500);
    }
  };
}
