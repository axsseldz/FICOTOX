"use client";

import type { ReactNode } from "react";

/*
 * Insignias e indicadores con colores con significado, comunes a todas las
 * listas y ventanas:
 * - SinDato: "—" en gris para una columna sin valor (no se desplaza nada).
 * - Los indicadores de "solicitud pendiente", "visto bueno", "retenido",
 *   "requiere enmienda"… son StatusFlag (StatusFlag.tsx) y SolicitudBadge.
 */

export function SinDato({ texto = "—" }: { texto?: string }) {
  return <span className="text-[13px] text-ink-4">{texto}</span>;
}

/* Figuras apiladas (maximo `max` y "+N"): asignados, autorizados, personas con un rol. */
export function FigurasApiladas({ children, total, max = 4 }: { children: ReactNode[]; total: number; max?: number }) {
  const visibles = children.slice(0, max);
  return (
    <span className="flex -space-x-2">
      {visibles}
      {total > max ? <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-3 text-[11px] font-semibold text-ink-2 ring-2 ring-surface">+{total - max}</span> : null}
    </span>
  );
}
