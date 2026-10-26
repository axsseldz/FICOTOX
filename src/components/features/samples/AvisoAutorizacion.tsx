"use client";

/*
 * Aviso al abrir un formato (Fase 4): si falta una autorizacion FX-THF-AP para
 * lo que el formato pide, se dice antes de capturar. El servidor lo valida al guardar.
 */
import { Callout } from "@/components/features/samples/FormLayout";
import { useAutorizaciones } from "@/lib/client/useAutorizaciones";
import type { Requisito } from "@/lib/shared/autorizaciones";
import { motivoDe } from "@/lib/client/puede";
import type { ApiRecord } from "@/lib/client/types";

export function AvisoAutorizacion({ requisitos, className, accion = "guardar este formato" }: { requisitos: Requisito[]; className?: string; accion?: string }) {
  const { falta } = useAutorizaciones();
  const mensaje = falta(requisitos);
  if (!mensaje) return null;
  return (
    <div className={className} data-aviso-autorizacion>
      <Callout tone="warning" title="Falta una autorización (FX-THF-AP)">
        {mensaje}. No podrás {accion} hasta que la coordinación la registre en tu ficha (Administración › Usuarios › Autorizaciones).
      </Callout>
    </div>
  );
}

/*
 * Ficha de un formato que la persona editaria por rol pero que se abre en solo
 * lectura porque le falta la autorizacion FX-THF-AP: el servidor manda el motivo
 * en `puede.editar`. Con solicitud pendiente o con el estado ya cerrado avisan otros.
 */
export function AvisoEdicionBloqueada({ item, cerrado }: { item: ApiRecord | null | undefined; cerrado: boolean }) {
  const motivo = motivoDe(item, "editar");
  if (!motivo || cerrado || item?.solicitud_pendiente) return null;
  return (
    <div data-aviso-autorizacion>
      <Callout tone="warning" title="Falta una autorización (FX-THF-AP)">
        {motivo}. Por eso el formato se muestra en solo lectura hasta que la coordinación la registre en tu ficha (Administración › Usuarios › Autorizaciones).
      </Callout>
    </div>
  );
}
