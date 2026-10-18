"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { ArrowUUpLeft, Clock, Info, LockSimple, WarningCircle } from "@phosphor-icons/react";
import { cn } from "./cn";
import { Tooltip } from "./Overlay";

/*
 * Aviso secundario compacto junto a la insignia de estado de una lista
 * (solicitud pendiente, visto bueno, requiere enmienda, retenido, vencida…).
 * En lugar de una etiqueta larga que rompe la fila, un indicador redondo de
 * 22 px con icono y color; el texto completo va en el tooltip (también al
 * enfocarlo con teclado) y en `aria-label`. La fila conserva su altura y
 * sus columnas. En la ficha del registro el aviso completo sigue como banner.
 *
 *   pendiente  reloj, ámbar   (espera a otra persona: autorización, visto bueno)
 *   aviso      alerta, ámbar  (requiere atención: enmienda, reapertura, por vencer)
 *   bloqueo    candado, rojo  (retenido, suspendido, bloqueada)
 *   error      alerta, rojo   (vencida, fuera de vigencia)
 *   regresado  flecha, rojo   (regresado con observaciones)
 *   info       i, gris        (dato informativo: automática, en curso)
 */

export type StatusFlagKind = "pendiente" | "aviso" | "bloqueo" | "error" | "regresado" | "info";

const KIND: Record<StatusFlagKind, { icon: ReactNode; className: string }> = {
  pendiente: { icon: <Clock size={13} weight="bold" />, className: "bg-warning-soft text-warning-text" },
  aviso: { icon: <WarningCircle size={14} weight="bold" />, className: "bg-warning-soft text-warning-text" },
  bloqueo: { icon: <LockSimple size={13} weight="bold" />, className: "bg-danger-soft text-danger-text" },
  error: { icon: <WarningCircle size={14} weight="bold" />, className: "bg-danger-soft text-danger-text" },
  regresado: { icon: <ArrowUUpLeft size={13} weight="bold" />, className: "bg-danger-soft text-danger-text" },
  info: { icon: <Info size={14} weight="bold" />, className: "bg-surface-3 text-ink-2" },
};

type DataAttributes = { [key: `data-${string}`]: string | number | boolean | undefined };

export function StatusFlag({ kind = "pendiente", label, detail, className, onClick, ...rest }: { kind?: StatusFlagKind; label: string; detail?: ReactNode; className?: string; /* Si se da, el indicador es un botón (p. ej. abre el panel de la solicitud). */ onClick?: () => void } & DataAttributes) {
  const meta = KIND[kind];
  if (onClick) {
    return (
      <Tooltip
        content={
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">{label}</span>
            {detail ? <span className="text-white/80">{detail}</span> : null}
            <span className="text-white/70">Clic para ver y atender</span>
          </span>
        }
      >
        <button
          type="button"
          aria-label={`${label}. Ver y atender`}
          data-status-flag={kind}
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
          className={cn("press inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full align-middle ring-1 ring-current/20 hover:ring-2", meta.className, className)}
          {...rest}
        >
          {meta.icon}
        </button>
      </Tooltip>
    );
  }
  return (
    <Tooltip
      content={
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">{label}</span>
          {detail ? <span className="text-white/80">{detail}</span> : null}
        </span>
      }
    >
      <span
        role="img"
        tabIndex={0}
        aria-label={label}
        data-status-flag={kind}
        onClick={(event) => event.stopPropagation()}
        className={cn("inline-flex h-[22px] w-[22px] shrink-0 cursor-default items-center justify-center rounded-full align-middle", meta.className, className)}
        {...rest}
      >
        {meta.icon}
      </span>
    </Tooltip>
  );
}

/* Celda de estado: insignia y avisos compactos en una sola línea, sin saltos. */
export function StatusCell({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-center gap-2 whitespace-nowrap", className)} {...rest}>
      {children}
    </div>
  );
}
