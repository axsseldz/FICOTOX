/*
 * Validacion de secretos en produccion (Fase 2). JavaScript plano para que lo
 * usen el servidor (src/instrumentation.ts) y el lanzador standalone
 * (scripts/start-ficotox.mjs) antes de atender peticiones.
 *
 * En produccion (NODE_ENV=production) el servidor NO arranca si JWT_SECRET
 * falta, es un valor por defecto o mide menos de 32 caracteres.
 *
 * SECRET_KEY firma la bitacora de auditoria: aqui solo se ADVIERTE (nunca se
 * bloquea ni se cambia), porque cambiar la llave rompe la verificacion de lo ya
 * sellado. Ver README.md, "Llave de la bitacora".
 */

export const JWT_SECRET_INSEGUROS = new Set(["ficotox-jwt-secret", "change-me-too", "change-me", "secret", "changeme"]);
export const SECRET_KEY_DESARROLLO = "ficotox-dev-secret";
export const SECRET_MIN = 32;

/* Errores que impiden arrancar en produccion ([] si todo bien). */
export function erroresSecretosProduccion(env) {
  if (String(env.NODE_ENV || "") !== "production") return [];
  const jwt = String(env.JWT_SECRET || "").trim();
  const errores = [];
  if (!jwt) errores.push("JWT_SECRET no esta definida");
  else if (JWT_SECRET_INSEGUROS.has(jwt)) errores.push("JWT_SECRET tiene un valor por defecto");
  else if (jwt.length < SECRET_MIN) errores.push(`JWT_SECRET mide ${jwt.length} caracteres (minimo ${SECRET_MIN})`);
  return errores;
}

/* Advertencias sobre la llave de la bitacora (no bloquean). */
export function advertenciasLlaveBitacora(env, existeArchivoLlave) {
  const secret = String(env.SECRET_KEY || "").trim();
  if (!secret || secret === SECRET_KEY_DESARROLLO) {
    return [
      existeArchivoLlave
        ? "La bitacora se sella con instance/auditoria.key (SECRET_KEY no esta configurada). Respalda ese archivo junto con la base: si se pierde, la verificacion de integridad falla."
        : "SECRET_KEY no esta configurada: la bitacora se sellara con instance/auditoria.key, que se crea al azar. Respaldalo junto con la base.",
    ];
  }
  if (secret.length < SECRET_MIN) {
    return [`SECRET_KEY mide ${secret.length} caracteres (se recomiendan ${SECRET_MIN} o mas). No la cambies sin migrar la llave de la bitacora (README.md).`];
  }
  return [];
}
