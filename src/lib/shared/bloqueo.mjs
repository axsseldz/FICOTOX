/*
 * Fase 12: bloqueos de la instancia (servidor.lock, lanzador.lock) con
 * { pid, puerto, iniciado_en }. Un bloqueo cuenta como VIVO solo si su proceso
 * existe (EPERM: existe, es de otro usuario) Y se creo despues del ultimo
 * arranque del sistema: tras un apagado, un corte de luz o `taskkill /F` el
 * archivo queda huerfano y su pid puede reutilizarlo otro proceso (frecuente en
 * Windows); con la hora de arranque del sistema ese caso se reconoce.
 * Lo usan el lanzador, el servidor (instrumentation) y los scripts de operacion.
 */
import fs from "node:fs";
import os from "node:os";

/* Hora de arranque del sistema (ms), con 2 min de margen por la precision de uptime. */
export const arranqueDelSistema = () => Date.now() - os.uptime() * 1000 - 120_000;

function leerBloqueo(archivo) {
  try {
    const datos = JSON.parse(fs.readFileSync(archivo, "utf8"));
    return datos && Number(datos.pid) ? { pid: Number(datos.pid), puerto: datos.puerto ?? null, iniciado_en: datos.iniciado_en ?? null } : null;
  } catch {
    return null;
  }
}

/* Datos del bloqueo si su proceso sigue vivo (y no es huerfano de un arranque anterior); si no, null. */
export function bloqueoVivo(archivo, { propio = null } = {}) {
  const datos = leerBloqueo(archivo);
  if (!datos || datos.pid === propio) return null;
  const creado = Date.parse(String(datos.iniciado_en || ""));
  if (Number.isFinite(creado) && creado < arranqueDelSistema()) return null;
  try {
    process.kill(datos.pid, 0);
    return datos;
  } catch (error) {
    return error?.code === "EPERM" ? datos : null;
  }
}
