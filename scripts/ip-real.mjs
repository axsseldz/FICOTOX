/*
 * IP real del cliente para el bloqueo por IP (Fase 2). Se precarga en el
 * servidor standalone (`node --import scripts/ip-real.mjs server.js`, ver
 * start-ficotox.mjs) cuando NO hay un proxy de confianza (TRUST_PROXY != true):
 * sobrescribe X-Forwarded-For con la direccion del socket y quita X-Real-IP,
 * para que un cliente no pueda elegir con que IP cuenta (ni eludir el limite
 * ni bloquear la IP de otra persona). Con TRUST_PROXY=true (o 1) no hace nada: la IP
 * la fija el proxy (p. ej. el de Railway).
 */
import http from "node:http";

// Mismo criterio que getConfig() (src/lib/server/config.ts): "true" o "1" activan el proxy de confianza.
if (!["true", "1"].includes(String(process.env.TRUST_PROXY ?? "false").trim().toLowerCase())) {
  const emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function emitConIpReal(event, req, ...rest) {
    if (event === "request" && req && req.headers) {
      const ip = req.socket && req.socket.remoteAddress;
      if (ip) req.headers["x-forwarded-for"] = ip;
      else delete req.headers["x-forwarded-for"];
      delete req.headers["x-real-ip"];
    }
    return emit.call(this, event, req, ...rest);
  };
}
