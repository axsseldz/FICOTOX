"use client";

import type { ReactNode } from "react";
import { Dialog as RadixDialog } from "radix-ui";
import { CaretDown, CaretUp, X } from "@phosphor-icons/react";
import { IconButton } from "./Button";
import { cn } from "./cn";

/*
 * Ventana centrada sobre la pagina difuminada y oscurecida (Auditoria,
 * Usuarios, Roles). Esc, la "×" o pulsar fuera la cierran; ↑/↓ (y los
 * botones de la barra) pasan al registro anterior o siguiente; el foco queda
 * atrapado (Radix). En pantallas angostas ocupa toda la pantalla. La
 * animacion respeta prefers-reduced-motion (globals.css).
 *
 * El contenido debe incluir un <VentanaTitulo> (titulo accesible).
 */
export function VentanaCentrada({
  abierta,
  onCerrar,
  onMover,
  puedeAnterior = false,
  puedeSiguiente = false,
  amplia = false,
  media = false,
  etiquetaAnterior = "Anterior",
  etiquetaSiguiente = "Siguiente",
  barra,
  children,
}: {
  abierta: boolean;
  onCerrar: () => void;
  /* -1 anterior, +1 siguiente; sin onMover no hay flechas. */
  onMover?: (paso: number) => void;
  puedeAnterior?: boolean;
  puedeSiguiente?: boolean;
  /* Mas ancha (p. ej. el editor de permisos). */
  amplia?: boolean;
  /* Media: entre la normal y la amplia (detalle de una actividad). */
  media?: boolean;
  etiquetaAnterior?: string;
  etiquetaSiguiente?: string;
  /* Contenido extra en la barra superior (junto a las flechas). */
  barra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <RadixDialog.Root open={abierta} onOpenChange={(open) => !open && onCerrar()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[var(--z-ventana)] bg-deep/45 backdrop-blur-md data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <div className="pointer-events-none fixed inset-0 z-[var(--z-ventana)] flex items-stretch justify-center sm:items-center sm:p-6">
          <RadixDialog.Content
            aria-describedby={undefined}
            onKeyDown={(event) => {
              if (!onMover || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
              const target = event.target as HTMLElement;
              if (target.closest("input, textarea, select, [role=tablist], [role=listbox], [role=menu]")) return;
              event.preventDefault();
              onMover(event.key === "ArrowDown" ? 1 : -1);
            }}
            className={cn(
              "pointer-events-auto flex w-full flex-col overflow-hidden bg-surface-elevated shadow-panel outline-none transition-[max-width] duration-300 ease-[var(--ease-spring)]",
              "h-full sm:h-auto sm:rounded-panel",
              // Amplia: mas ancha y mas alta (editor de permisos, fichas de inventario).
              amplia ? "sm:max-h-[min(92dvh,960px)] sm:max-w-[1080px]" : media ? "sm:max-h-[min(90dvh,900px)] sm:max-w-[880px]" : "sm:max-h-[min(88dvh,820px)] sm:max-w-[620px]",
              "data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out",
            )}
          >
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5 sm:px-5">
              <div className="flex min-w-0 items-center gap-1">
                {onMover ? (
                  <>
                    <IconButton label={etiquetaAnterior} size="sm" onClick={() => onMover(-1)} disabled={!puedeAnterior}>
                      <CaretUp size={14} weight="bold" />
                    </IconButton>
                    <IconButton label={etiquetaSiguiente} size="sm" onClick={() => onMover(1)} disabled={!puedeSiguiente}>
                      <CaretDown size={14} weight="bold" />
                    </IconButton>
                  </>
                ) : null}
                {barra}
              </div>
              <RadixDialog.Close asChild>
                <IconButton label="Cerrar">
                  <X size={16} weight="bold" />
                </IconButton>
              </RadixDialog.Close>
            </div>
            <div className="scroll-thin flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">{children}</div>
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/* Titulo accesible de la ventana. */
export function VentanaTitulo({ children, className }: { children: ReactNode; className?: string }) {
  return <RadixDialog.Title className={cn("text-[19px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink", className)}>{children}</RadixDialog.Title>;
}
