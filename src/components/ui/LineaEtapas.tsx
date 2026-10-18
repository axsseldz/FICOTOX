"use client";

import type { CSSProperties, ReactNode } from "react";
import { Check } from "@phosphor-icons/react";
import { cn } from "./cn";

/*
 * Linea de etapas de un registro, comun a todas las ventanas (NC, informe,
 * avance de una muestra): las etapas pasadas con palomita, la actual
 * resaltada y las siguientes en gris.
 * - "horizontal": compacta; en pantallas angostas pasa a vertical.
 * - "vertical": con un detalle debajo de cada etapa (p. ej. los folios enlazados).
 * Sin texto recortado.
 */
export interface EtapaLinea {
  clave: string;
  titulo: string;
  /* Debajo del titulo (solo en vertical): folios enlazados, una nota… */
  detalle?: ReactNode;
}

export function LineaEtapas({ etapas, actual, anulada = false, variante = "horizontal", etiqueta = "Etapas" }: { etapas: Array<EtapaLinea | string>; actual: number; anulada?: boolean; variante?: "horizontal" | "vertical"; etiqueta?: string }) {
  const lista: EtapaLinea[] = etapas.map((e) => (typeof e === "string" ? { clave: e, titulo: e } : e));
  if (variante === "vertical") {
    return (
      <ol className="flex flex-col" aria-label={etiqueta}>
        {lista.map((e, i) => {
          const hecha = !anulada && i < actual;
          const esActual = !anulada && i === actual;
          return (
            <li key={e.clave} className="entrada-escalonada relative flex gap-3 pb-4 last:pb-0" style={{ ["--i" as string]: i } as CSSProperties} aria-current={esActual ? "step" : undefined}>
              {i < lista.length - 1 ? <span aria-hidden="true" className={cn("absolute top-7 bottom-0 left-[13px] w-0.5", hecha ? "bg-brand/40" : "bg-line")} /> : null}
              <Marca indice={i} hecha={hecha} actual={esActual} />
              <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
                <span className={cn("text-[14px] font-semibold", hecha || esActual ? "text-ink" : "text-ink-3")}>
                  {e.titulo}
                  {esActual ? <span className="ml-2 text-[12px] font-medium text-brand-strong">Etapa actual</span> : null}
                </span>
                {e.detalle}
              </div>
            </li>
          );
        })}
      </ol>
    );
  }
  return (
    <ol className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-0" aria-label={etiqueta}>
      {lista.map((e, i) => {
        const hecha = !anulada && i < actual;
        const esActual = !anulada && i === actual;
        return (
          <li key={e.clave} className="relative flex items-center gap-2.5 sm:flex-1 sm:flex-col sm:items-center sm:gap-1.5 sm:text-center" aria-current={esActual ? "step" : undefined}>
            {i > 0 ? <span aria-hidden="true" className={cn("absolute top-3.5 right-1/2 hidden h-0.5 w-full -translate-y-1/2 sm:block", hecha || esActual ? "bg-brand/50" : "bg-line")} /> : null}
            <Marca indice={i} hecha={hecha} actual={esActual} />
            <span className={cn("text-[12.5px] leading-tight", esActual ? "font-semibold text-ink" : hecha ? "text-ink-2" : "text-ink-4")}>{e.titulo}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Marca({ indice, hecha, actual }: { indice: number; hecha: boolean; actual: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ring-4 ring-surface transition-colors duration-300",
        hecha ? "bg-brand text-on-accent" : actual ? "bg-brand-soft text-brand-strong shadow-[0_0_0_2px_var(--color-brand)]" : "bg-surface-3 text-ink-4",
      )}
    >
      {hecha ? <Check size={13} weight="bold" /> : indice + 1}
    </span>
  );
}
