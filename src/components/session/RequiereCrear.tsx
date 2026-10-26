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
    // Con el rol pero sin la autorizacion FX-THF-AP, el motivo del servidor dice cual falta y donde se registra.
    return (
      <div data-sin-permiso-registrar>
        <EmptyState
          icon={<LockKey size={20} />}
          title="Sin permiso para registrar"
          description={flag?.motivo ? `${flag.motivo}. La coordinación la registra en tu ficha (Administración › Usuarios › Autorizaciones).` : "Tus roles pueden consultar esta sección, pero no registrar formatos nuevos. Pide a la administración que lo revise."}
        />
      </div>
    );
  }
  return <>{children}</>;
}
