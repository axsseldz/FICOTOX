"use client";

import type { ReactNode } from "react";
import { LockKey } from "@phosphor-icons/react";
import { EmptyState, Skeleton } from "@/components/ui/Primitives";
import { usePuedeCrearRecurso, type TipoRegistro } from "@/lib/client/puede";

/*
 * Pantallas de alta (nueva recepcion, procesamiento, extraccion, analisis,
 * informe): el formulario solo se muestra si el servidor dice que la persona
 * puede crear ese tipo de registro (rol con C y, en las actividades tecnicas, su
 * autorizacion FX-THF-AP), igual que el boton «Nuevo» de la lista. Por URL
 * directa, quien solo consulta ve el motivo en lugar de un formulario que el
 * servidor rechazaria al guardar.
 */
export function RequiereCrear({ tipo, children }: { tipo: TipoRegistro; children: ReactNode }) {
  const recurso = usePuedeCrearRecurso();
  if (!recurso.data && !recurso.error) return <Skeleton className="h-64 w-full" />;
  const flag = recurso.data?.[tipo];
  if (!flag?.ok) {
    return (
      <EmptyState
        icon={<LockKey size={20} />}
        title="Sin permiso para registrar"
        description={flag?.motivo || "Tus roles pueden consultar esta sección, pero no registrar formatos nuevos (o te falta la autorización FX-THF-AP de la actividad). Pide a la administración que lo revise."}
      />
    );
  }
  return <>{children}</>;
}
