/*
 * Fase 12: HTTPS opcional del lanzador. Se precarga en el servidor standalone
 * (`node --import scripts/https-lanzador.mjs server.js`, ver start-ficotox.mjs)
 * solo si TLS_CERT y TLS_KEY estan definidos: el servidor de Next se crea con
 * https.createServer en lugar de http.createServer, en el mismo proceso (sin
 * proxy intermedio, asi la IP del cliente sigue siendo la del socket). Aplica a
 * HTTPS el mismo criterio de IP real que scripts/ip-real.mjs.
 *
 * Por que: en HTTP, las contrasenas y los tokens de sesion viajan sin cifrar por
 * la red del laboratorio. Ver README.md (certificado para la red interna).
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";

const cert = String(process.env.TLS_CERT || "").trim();
const key = String(process.env.TLS_KEY || "").trim();
if (cert && key) {
  const opciones = { cert: fs.readFileSync(cert), key: fs.readFileSync(key) };
  if (String(process.env.TLS_CA || "").trim()) opciones.ca = fs.readFileSync(String(process.env.TLS_CA).trim());
  http.createServer = function crearServidorHttps(...argumentos) {
    const listener = argumentos.find((a) => typeof a === "function");
    const extra = argumentos.find((a) => a && typeof a === "object") || {};
    return https.createServer({ ...extra, ...opciones }, listener);
  };
  if (!["true", "1"].includes(String(process.env.TRUST_PROXY ?? "false").trim().toLowerCase())) {
    const emit = https.Server.prototype.emit;
    https.Server.prototype.emit = function emitConIpReal(event, req, ...rest) {
      if (event === "request" && req && req.headers) {
        const ip = req.socket && req.socket.remoteAddress;
        if (ip) req.headers["x-forwarded-for"] = ip;
        else delete req.headers["x-forwarded-for"];
        delete req.headers["x-real-ip"];
      }
      return emit.call(this, event, req, ...rest);
    };
  }
}
