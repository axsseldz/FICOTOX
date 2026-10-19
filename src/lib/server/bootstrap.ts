import { withSession } from "./db";
import { registrarVencimientosAutorizaciones } from "./autorizaciones";
import { registrarVencimientos } from "./rbac";
import { vencerSolicitudes } from "./solicitudes";
import { vencerMantenimientos } from "./modules/inventory";

/*
 * Fase 12: el esquema lo crean y actualizan las migraciones versionadas
 * (src/lib/server/migraciones), que corren al arrancar el servidor
 * (instrumentation-node.ts) o con `npm run migrar`; ya no hay ensure*Schema()
 * por peticion. Aqui solo queda el barrido de vencimientos.
 */

/*
 * Deja en la bitacora los roles cuya vigencia termino. Se ejecuta antes de
 * atender peticiones, como mucho una vez por minuto, en su propia transaccion.
 */
let ultimoBarrido = 0;
let barridoEnCurso: Promise<void> | null = null;

export function barrerVencimientos(): Promise<void> {
  if (barridoEnCurso) return barridoEnCurso;
  if (Date.now() - ultimoBarrido < 60_000) return Promise.resolve();
  ultimoBarrido = Date.now();
  barridoEnCurso = withSession(async (s) => {
    // Las sesiones revocadas que ya expiraron no hace falta recordarlas (su token ya no es valido).
    const purgadas = Number((await s.execute("DELETE FROM sesiones_revocadas WHERE expira_en IS NOT NULL AND expira_en < :ahora", { ahora: new Date().toISOString() })).rowcount || 0);
    const vencidos = (await registrarVencimientos(s)) + (await vencerSolicitudes(s)) + (await registrarVencimientosAutorizaciones(s)) + (await vencerMantenimientos(s)) + purgadas;
    if (vencidos) await s.commit();
  })
    .catch((error: unknown) => {
      ultimoBarrido = 0;
      console.error("[roles] No se pudieron registrar los vencimientos:", error);
    })
    .finally(() => {
      barridoEnCurso = null;
    });
  return barridoEnCurso;
}
