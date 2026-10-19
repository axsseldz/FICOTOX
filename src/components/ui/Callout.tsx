"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { CheckCircle, Info, Warning, WarningCircle } from "@phosphor-icons/react";
import { cn } from "./cn";

/*
 * Aviso (versión oficial): un solo estilo para información, advertencia,
 * error o confirmación, dentro de formatos, ventanas y páginas. Fondo tenue
 * del tono, icono lleno del mismo tono, texto en tinta; con título opcional.
 */
const ESTILOS = {
  info: { wrap: "bg-brand-faint text-ink", icon: "text-brand", Icon: Info },
  warning: { wrap: "bg-warning-soft text-ink", icon: "text-warning", Icon: Warning },
  danger: { wrap: "bg-danger-soft text-ink", icon: "text-danger", Icon: WarningCircle },
  success: { wrap: "bg-success-soft text-ink", icon: "text-success", Icon: CheckCircle },
};

export function Callout({ tone = "info", title, icon, children, className, ...rest }: { tone?: keyof typeof ESTILOS; title?: ReactNode; /* Icono propio en lugar del del tono. */ icon?: ReactNode; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  const estilo = ESTILOS[tone];
  const Icono = estilo.Icon;
  return (
    <div className={cn("flex gap-3 rounded-box px-4 py-3 text-sm leading-relaxed", estilo.wrap, className)} role={tone === "danger" ? "alert" : "status"} {...rest}>
      <span className={cn("mt-0.5 flex shrink-0", estilo.icon)} aria-hidden="true">
        {icon ?? <Icono size={18} weight="fill" />}
      </span>
      <div className="min-w-0">
        {title ? <p className="font-medium">{title}</p> : null}
        <div className={cn(title && "mt-0.5 text-ink-2")}>{children}</div>
      </div>
    </div>
  );
}
