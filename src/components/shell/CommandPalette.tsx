"use client";

import { useState } from "react";
import { Dialog as RadixDialog } from "radix-ui";
import { IncidenciaVentana, NcVentana } from "@/components/features/calidad/ventanas/CalidadVentanas";
import { Busqueda, type VentanaCalidad } from "./Busqueda";
import { VELO_VENTANA } from "@/components/ui/Overlay";

/*
 * Búsqueda de la barra lateral (ícono de lupa y ⌘K / Ctrl K): el MISMO
 * componente que la barra del Inicio, abierto como ventana centrada con fondo
 * difuminado y el campo ya enfocado. Esc la cierra. Las ventanas de detalle
 * (incidencias y NC) viven aquí, fuera del diálogo, para que sigan abiertas
 * cuando la ventana de búsqueda se cierra.
 */

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [ventana, setVentana] = useState<VentanaCalidad | null>(null);
  return (
    <>
      <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className={VELO_VENTANA} />
          <RadixDialog.Content className="bg-popover border border-line fixed top-[12vh] left-1/2 z-[var(--z-ventana)] w-[calc(100%-24px)] max-w-[680px] -translate-x-1/2 overflow-hidden rounded-panel shadow-panel outline-none data-[state=open]:animate-materialize data-[state=closed]:animate-dematerialize">
            <RadixDialog.Title className="sr-only">Buscar</RadixDialog.Title>
            <RadixDialog.Description className="sr-only">Busca registros, ve a una pantalla o haz algo escribiendo lo que quieres</RadixDialog.Description>
            <Busqueda modo="ventana" onCerrar={() => onOpenChange(false)} alAbrirVentana={setVentana} />
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
      <IncidenciaVentana ids={ventana?.tipo === "incidencia" ? [ventana.id] : []} indice={ventana?.tipo === "incidencia" ? 0 : null} onIndice={() => undefined} onCerrar={() => setVentana(null)} />
      <NcVentana ids={ventana?.tipo === "nc" ? [ventana.id] : []} indice={ventana?.tipo === "nc" ? 0 : null} onIndice={() => undefined} onCerrar={() => setVentana(null)} />
    </>
  );
}
