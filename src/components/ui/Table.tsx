"use client";

import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "./cn";

/*
 * Tabla de datos: contenedor sin borde (sombra fina), cabecera discreta,
 * filas aireadas con hover suave, números tabulares y acciones a la derecha.
 */

export function TableShell({ children, className, footer }: { children: ReactNode; className?: string; footer?: ReactNode }) {
  return (
    <div className={cn("overflow-hidden rounded-card bg-surface shadow-card", className)}>
      <div className="scroll-thin overflow-x-auto">{children}</div>
      {footer ? <div className="border-t border-line px-4 py-2.5 text-[12.5px] text-ink-3">{footer}</div> : null}
    </div>
  );
}

export function Table({ className, children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table className={cn("w-full border-collapse text-left text-[13.5px] text-ink", className)} {...rest}>
      {children}
    </table>
  );
}

export function THead({ children, className }: { children: ReactNode; className?: string }) {
  return <thead className={cn("border-b border-line text-[12px] font-medium text-ink-3", className)}>{children}</thead>;
}

export function TBody({ children, className }: { children: ReactNode; className?: string }) {
  return <tbody className={cn("divide-y divide-line", className)}>{children}</tbody>;
}

/* Las filas interactivas se abren con clic y tambien con Enter/Espacio desde el teclado. */
export function Tr({ className, interactive, children, onClick, onKeyDown, ...rest }: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  const keyboard = interactive && onClick;
  return (
    <tr
      className={cn("group transition-colors duration-100", interactive && "cursor-pointer hover:bg-brand-faint active:bg-brand-soft/60 focus-visible:bg-brand-faint", !interactive && "hover:bg-surface-2", className)}
      tabIndex={keyboard ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (keyboard && !event.defaultPrevented && event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onClick?.(event as unknown as React.MouseEvent<HTMLTableRowElement>);
        }
      }}
      {...rest}
    >
      {children}
    </tr>
  );
}

/*
 * `sticky`: la columna se fija al borde derecho (acciones) para que siga a la
 * vista aunque la tabla tenga scroll horizontal en pantallas angostas.
 */
const STICKY_END = "sticky right-0 z-[1] bg-surface shadow-[-10px_0_12px_-12px_rgba(16,32,43,0.35)]";

export function Th({ className, children, align, sticky, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" | "center"; sticky?: boolean }) {
  return (
    <th scope="col" className={cn("h-10 whitespace-nowrap px-4 font-medium", align === "right" && "text-right", align === "center" && "text-center", sticky && STICKY_END, className)} {...rest}>
      {children}
    </th>
  );
}

export function Td({ className, children, align, muted, mono, sticky, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" | "center"; muted?: boolean; mono?: boolean; sticky?: boolean }) {
  return (
    <td className={cn("px-4 py-3 align-middle", align === "right" && "tnum text-right", align === "center" && "text-center", muted && "text-ink-3", mono && "code text-ink-2", sticky && cn(STICKY_END, "group-hover:bg-surface-2 group-[.cursor-pointer]:group-hover:bg-brand-faint"), className)} {...rest}>
      {children}
    </td>
  );
}

/*
 * Con `lineas={2}` (listas de Muestras e Informes) el texto ocupa hasta 2 líneas antes
 * de recortarse con "…", y el texto completo (o `tooltip`) sale al pasar el cursor.
 */
export function CellPrimary({ title, subtitle, mono, lineas = 1, tooltip }: { title: ReactNode; subtitle?: ReactNode; mono?: boolean; lineas?: 1 | 2; tooltip?: string }) {
  const texto = (valor: ReactNode) => (typeof valor === "string" || typeof valor === "number" ? String(valor) : "");
  const completo = tooltip ?? [texto(title), texto(subtitle)].filter(Boolean).join("\n");
  const recorte = lineas === 2 ? "line-clamp-2 break-words" : "truncate";
  return (
    <div className="flex min-w-0 flex-col" title={completo || undefined}>
      <span className={cn(recorte, "font-medium text-ink", mono && "code")}>{title}</span>
      {subtitle ? <span className={cn(recorte, "text-[12px] text-ink-3")}>{subtitle}</span> : null}
    </div>
  );
}

/* Listas de Muestras e Informes: renglones de la misma altura mínima. */
export const FILA_LISTA = "h-[64px]";
/* Columnas de menor importancia: se ocultan en laptops (< 1500 px) para no apretar las demás; su dato sigue en la ventana de detalle. */
export const SOLO_ANCHO = "hidden min-[1500px]:table-cell";
/* Fechas: ancho fijo y una sola línea. */
export const COL_FECHA = "w-[112px] whitespace-nowrap";
