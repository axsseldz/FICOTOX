"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "./cn";

/*
 * Pestañas con indicador deslizante: columnas del mismo ancho y una pastilla
 * que se desliza (resorte sin rebote) hasta la pestaña elegida. Flechas
 * izquierda/derecha, Inicio y Fin para moverse con el teclado. Sin
 * animacion con prefers-reduced-motion (globals.css).
 */
export function PestanasDeslizantes<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (value: T) => void; options: Array<{ value: T; label: string; icon?: ReactNode; badge?: ReactNode }>; label: string; className?: string }) {
  const indice = Math.max(0, options.findIndex((o) => o.value === value));
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const pasos: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
    let siguiente = indice;
    if (event.key in pasos) siguiente = (indice + pasos[event.key] + options.length) % options.length;
    else if (event.key === "Home") siguiente = 0;
    else if (event.key === "End") siguiente = options.length - 1;
    else return;
    event.preventDefault();
    onChange(options[siguiente].value);
    // La lista se toma antes del siguiente cuadro: para entonces `event.currentTarget` ya es null.
    const lista = event.currentTarget;
    requestAnimationFrame(() => (lista.querySelectorAll<HTMLButtonElement>("[role=tab]")[siguiente] as HTMLButtonElement | undefined)?.focus());
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cn("relative grid rounded-full bg-surface-3/70 p-1", className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      <span
        aria-hidden="true"
        className="absolute inset-y-1 left-1 rounded-full bg-surface shadow-card transition-transform duration-[380ms] ease-[var(--ease-spring)]"
        style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(${indice * 100}%)` }}
      />
      {options.map((option) => {
        const activa = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={activa}
            tabIndex={activa ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn("press relative z-[1] inline-flex min-h-8 py-1 items-center justify-center gap-1.5 rounded-full px-2 text-sm font-medium transition-colors duration-200", activa ? "text-ink" : "text-ink-3 hover:text-ink-2")}
          >
            {option.icon}
            <span className="text-center leading-tight">{option.label}</span>
            {option.badge}
          </button>
        );
      })}
    </div>
  );
}
