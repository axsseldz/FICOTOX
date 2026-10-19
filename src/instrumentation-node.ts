import fs from "node:fs";
import path from "node:path";
import { advertenciaLlaveBitacora } from "./lib/server/audit";
import { getConfig } from "./lib/server/config";
import { migrarAlArrancar } from "./lib/server/migrar-arranque";
import { erroresSecretosProduccion } from "./lib/shared/secretos.mjs";
import { bloqueoVivo } from "./lib/shared/bloqueo.mjs";

/*
 * Fase 12: codigo de salida de un error de arranque que no se arregla solo
 * (configuracion, migraciones, otro servidor sobre la instancia): el lanzador
 * (scripts/start-ficotox.mjs) no reintenta con este codigo; con cualquier otro, si.
 */
const SALIDA_FATAL = 78;

/*
 * Verificacion de arranque (solo runtime Node.js; ver instrumentation.ts).
 * En produccion no arranca con un JWT_SECRET inseguro; la llave de la bitacora
 * solo genera advertencias (nunca se cambia aqui).
 */
export async function verificarArranque(): Promise<void> {
  getConfig();
  const errores = erroresSecretosProduccion(process.env);
  if (errores.length) {
    console.error(`[seguridad] FICOTOX no arranca en produccion: ${errores.join("; ")}. Define un JWT_SECRET aleatorio de al menos 32 caracteres en .env.`);
    process.exit(SALIDA_FATAL);
  }
  for (const aviso of advertenciaLlaveBitacora()) console.warn(`[seguridad] ${aviso}`);
  await escribirBloqueo();
  // Fase 12: migraciones versionadas antes de atender peticiones; si fallan, el servidor no arranca.
  try {
    await migrarAlArrancar();
  } catch (error) {
    const e = error as Error & { respaldo?: string | null };
    console.error(`[migraciones] FICOTOX no arranca: ${e.message}`);
    if (e.respaldo) console.error(`[migraciones] Respaldo previo a la migración: ${e.respaldo}`);
    process.exit(SALIDA_FATAL);
  }
  // Vencimientos (roles, solicitudes, autorizaciones y mantenimientos) al arrancar; si falla, se reintenta en la primera peticion.
  try {
    const { barrerVencimientos } = await import("./lib/server/bootstrap");
    await barrerVencimientos();
  } catch (error) {
    console.error("[arranque] No se pudo hacer el barrido de vencimientos:", error);
  }
}

/*
 * Fase 10: archivo de bloqueo <instancia>/servidor.lock con el pid del
 * servidor. scripts/restaurar-ficotox.mjs se niega a restaurar sobre la
 * instancia real mientras exista un bloqueo de un proceso vivo. Se quita al salir.
 */
async function escribirBloqueo(): Promise<void> {
  const archivo = path.join(/*turbopackIgnore: true*/ getConfig().INSTANCE_DIR, "servidor.lock");
  // Fase 12: el bloqueo se crea de forma atomica ("wx"): si otro servidor vivo ya usa esta instancia
  // (aunque arranquen en el mismo instante), este no arranca ni pisa su bloqueo. Uno huerfano (pid muerto)
  // se reemplaza solo dentro de una seccion critica (<archivo>.toma, creada con mkdir, atomico) y volviendo
  // a leerlo ahi: asi dos servidores que encuentran el mismo bloqueo huerfano no quedan los dos.
  const contenido = JSON.stringify({ pid: process.pid, puerto: process.env.PORT || null, iniciado_en: new Date().toISOString() });
  const seccion = `${archivo}.toma`;
  const noArranca = (otro: { pid: number; puerto: string | null }) => {
    console.error(`[arranque] FICOTOX no arranca: ya hay un servidor sobre esta instancia (pid ${otro.pid}${otro.puerto ? `, puerto ${otro.puerto}` : ""}). Detenlo o usa otra instancia.`);
    process.exit(SALIDA_FATAL);
  };
  try {
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    for (let intento = 0; ; intento += 1) {
      if (intento > 200) throw new Error("no se pudo tomar el bloqueo de la instancia");
      try {
        fs.writeFileSync(archivo, contenido, { flag: "wx" });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const otro = servidorVivo(archivo);
      if (otro) noArranca(otro);
      try {
        fs.mkdirSync(seccion);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        // Otro proceso esta reemplazando el bloqueo; una seccion de mas de 10 s es de un proceso que murio ahi.
        try {
          if (Date.now() - fs.statSync(seccion).mtimeMs > 10_000) fs.rmSync(seccion, { recursive: true, force: true });
        } catch {
          /* ya la quitaron */
        }
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      try {
        const vivo = servidorVivo(archivo);
        if (vivo) {
          fs.rmSync(seccion, { recursive: true, force: true });
          noArranca(vivo);
        }
        fs.rmSync(archivo, { force: true });
        fs.writeFileSync(archivo, contenido, { flag: "wx" });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      } finally {
        fs.rmSync(seccion, { recursive: true, force: true });
      }
    }
  } catch (error) {
    console.warn(`[respaldos] No se pudo escribir ${archivo}: ${(error as Error).message}`);
    return;
  }
  const quitar = () => {
    try {
      if (JSON.parse(fs.readFileSync(archivo, "utf8")).pid === process.pid) fs.rmSync(archivo, { force: true });
    } catch {
      /* ya no existe */
    }
  };
  // Si el proceso termina por una senal sin pasar por "exit", el bloqueo queda huerfano: el script lo ignora porque su pid ya no existe.
  process.once("exit", quitar);
}

function servidorVivo(archivo: string): { pid: number; puerto: string | null } | null {
  return bloqueoVivo(archivo, { propio: process.pid });
}
