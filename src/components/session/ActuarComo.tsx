"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { IdentificationBadge } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Overlay";
import { cn } from "@/components/ui/cn";
import { registrarSelectorDeCargo, type OpcionCargo } from "@/lib/client/api";

/*
 * "Actuar como: <rol>" (Fase 1). Cuando varios roles vigentes de la persona
 * permiten la accion que intenta (firmar, revisar, aprobar, autorizar, anular),
 * el servidor pide elegir el cargo y este dialogo lo pregunta en ese momento.
 * El cargo elegido queda guardado junto a la firma y en la bitacora.
 */
export function ActuarComoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ opciones: OpcionCargo[]; mensaje: string } | null>(null);
  const [elegido, setElegido] = useState<number | null>(null);
  const resolver = useRef<((value: number | null) => void) | null>(null);

  const pedir = useCallback((opciones: OpcionCargo[], mensaje: string) => {
    return new Promise<number | null>((resolve) => {
      resolver.current = resolve;
      setElegido(opciones[0]?.rol_id ?? null);
      setState({ opciones, mensaje });
    });
  }, []);

  useEffect(() => {
    registrarSelectorDeCargo(pedir);
    return () => registrarSelectorDeCargo(null);
  }, [pedir]);

  const cerrar = (value: number | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setState(null);
  };

  return (
    <>
      {children}
      <Dialog
        open={!!state}
        onOpenChange={(open) => {
          if (!open) cerrar(null);
        }}
        title="¿Con qué cargo actúas?"
        description={state?.mensaje || "Varios de tus roles permiten esta acción. El cargo que elijas quedará junto a tu firma y en la bitácora."}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => cerrar(null)}>
              Cancelar
            </Button>
            <Button onClick={() => cerrar(elegido)} disabled={elegido === null}>
              Actuar con este cargo
            </Button>
          </>
        }
      >
        <div role="radiogroup" aria-label="Actuar como" className="flex flex-col gap-2">
          {(state?.opciones || []).map((opcion) => {
            const activo = opcion.rol_id === elegido;
            return (
              <button
                key={opcion.rol_id}
                type="button"
                role="radio"
                aria-checked={activo}
                onClick={() => setElegido(opcion.rol_id)}
                className={cn("press flex items-center gap-3 rounded-box border px-3 py-2.5 text-left text-base", activo ? "border-brand bg-brand-faint text-ink" : "border-line bg-surface text-ink-2 hover:bg-surface-2")}
              >
                <IdentificationBadge size={18} weight="duotone" className={activo ? "text-brand" : "text-ink-3"} />
                <span>
                  Actuar como: <span className="font-medium text-ink">{opcion.nombre}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Dialog>
    </>
  );
}
