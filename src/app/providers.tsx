"use client";

import type { ReactNode } from "react";
import { ActuarComoProvider } from "@/components/session/ActuarComo";
import { ReautenticarProvider } from "@/components/session/Reautenticar";
import { SessionProvider } from "@/components/session/SessionProvider";
import { ConfirmProvider, PromptProvider, TooltipProvider } from "@/components/ui/Overlay";
import { useTema } from "@/lib/client/tema";

/* En Automatico, sigue los cambios del sistema mientras la pagina esta abierta (tambien en el acceso). */
function SincronizarTema() {
  useTema();
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <SincronizarTema />
      <TooltipProvider>
        <ConfirmProvider>
          <PromptProvider>
            <ActuarComoProvider>
              <ReautenticarProvider>{children}</ReautenticarProvider>
            </ActuarComoProvider>
          </PromptProvider>
        </ConfirmProvider>
      </TooltipProvider>
    </SessionProvider>
  );
}
