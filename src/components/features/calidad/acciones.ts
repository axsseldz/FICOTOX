"use client";

import { toast } from "sonner";
import { useSession } from "@/components/session/SessionProvider";
import { usePrompt } from "@/components/ui/Overlay";
import { API_BASE_URL, sendJsonAuth } from "@/lib/client/api";
import { invalidate } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { esCancelacion, explicarError } from "@/lib/client/mensajes";

/*
 * Acciones comunes de las pantallas de calidad (Fase 11): enviar una peticion
 * y avisar, y pedir una excepcion de segregacion (reglas 7 a 10) con motivo.
 */
export function useAccionCalidad() {
  const { token } = useSession();
  const prompt = usePrompt();

  /* `alFallar`: el formulario muestra el error con su validacion (al campo o en el pop-up); si no, aviso con que paso y que hacer. */
  const enviar = async (metodo: string, ruta: string, body: unknown = {}, exito?: string, alFallar?: (err: unknown) => void): Promise<ApiRecord | null> => {
    try {
      const data = await sendJsonAuth(metodo, `${API_BASE_URL}${ruta}`, token, body);
      if (data.solicitud) toast.info(String(data.message || "Solicitud creada; falta la autorización de un segundo usuario"));
      else toast.success(exito || String(data.message || "Listo"));
      invalidate("calidad", "solicitudes");
      return data;
    } catch (err) {
      if (esCancelacion(err)) return null;
      if (alFallar) alFallar(err);
      else {
        const e = explicarError(err);
        toast.error(e.que, { description: e.hacer });
      }
      return null;
    }
  };

  const solicitarExcepcion = async (entidad: string, id: unknown, accion: string, bloqueo: string, referencia: string) => {
    const motivo = await prompt({
      critico: true,
      title: `Solicitar excepción para ${accion} ${referencia}`,
      description: `${bloqueo}. Por falta de personal puedes pedir una excepción: la aprueba otra persona y queda registrada en el registro y en la bitácora.`,
      confirmLabel: "Solicitar excepción",
    });
    if (!motivo) return;
    await enviar("POST", "/solicitudes", { tipo: "excepcion_segregacion", entidad, entidad_id: id, accion, motivo });
  };

  return { token, prompt, enviar, solicitarExcepcion };
}
