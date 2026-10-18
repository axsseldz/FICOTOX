"use client";

import type { CSSProperties, ReactNode } from "react";
import { cn } from "./cn";
import { VentanaTitulo } from "./VentanaCentrada";

/*
 * Piezas de la ventana de detalle (patron lista -> ventana): encabezado,
 * franja de datos rapidos, secciones con entrada escalonada y zona de
 * acciones. Se usan dentro de <VentanaCentrada> (VentanaCentrada.tsx), junto
 * con <PestanasDeslizantes>. Nada se recorta: el texto largo pasa de linea.
 */

export { VentanaCentrada, VentanaTitulo } from "./VentanaCentrada";

/* Encabezado: figura o icono, titulo con su insignia, subtitulo y lo que haga falta debajo (etiquetas, cargo…). */
export function VentanaEncabezado({ figura, titulo, insignia, subtitulo, children }: { figura?: ReactNode; titulo: ReactNode; insignia?: ReactNode; subtitulo?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex items-start gap-4">
      {figura ? <div className="shrink-0">{figura}</div> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <VentanaTitulo className="break-words">{titulo}</VentanaTitulo>
          {insignia}
        </div>
        {subtitulo ? <div className="break-words text-[13.5px] leading-[1.45] text-ink-3">{subtitulo}</div> : null}
        {children}
      </div>
    </header>
  );
}

export interface DatoRapido {
  icono: ReactNode;
  /* Etiqueta corta (una linea): "Último acceso", "Cuenta desde". */
  etiqueta: string;
  /* Valor corto y completo: "Hace 45 min", "25 sep 2026", "3". */
  valor: ReactNode;
  /* Texto al pasar el cursor (p. ej. la fecha exacta). */
  titulo?: string;
  tono?: "neutral" | "brand" | "success" | "warning" | "danger";
}

const COLUMNAS: Record<number, string> = { 1: "@lg:grid-cols-1", 2: "@lg:grid-cols-2", 3: "@lg:grid-cols-3", 4: "@lg:grid-cols-4" };
const TONO_ICONO: Record<NonNullable<DatoRapido["tono"]>, string> = {
  neutral: "bg-surface text-ink-2",
  brand: "bg-surface text-brand-strong",
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  danger: "bg-danger-soft text-danger",
};

/*
 * Franja de datos rapidos: hasta 4 tarjetas en una fila si caben (ancho de la
 * ventana, no de la pantalla: container query) y 2 x 2 si no. Icono a la
 * izquierda, etiqueta corta en una linea y el valor completo debajo.
 */
export function DatosRapidos({ datos }: { datos: DatoRapido[] }) {
  return (
    <div className="@container">
      <dl className={cn("grid grid-cols-2 gap-2", COLUMNAS[Math.min(4, datos.length)] || "@lg:grid-cols-4")}>
        {datos.map((d, i) => (
          <div key={d.etiqueta} title={d.titulo} className="entrada-escalonada flex min-w-0 items-start gap-2.5 rounded-[14px] bg-surface-2 px-3 py-2.5 ring-1 ring-line" style={{ ["--i" as string]: i } as CSSProperties}>
            <span aria-hidden="true" className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] shadow-card", TONO_ICONO[d.tono || "brand"])}>
              {d.icono}
            </span>
            <div className="flex min-w-0 flex-col">
              <dt className="text-[11.5px] leading-tight break-words text-ink-3">{d.etiqueta}</dt>
              <dd className="break-words text-[14.5px] leading-snug font-semibold text-ink">{d.valor}</dd>
            </div>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* Seccion de la ventana con titulo discreto y entrada escalonada (`i` = orden). */
export function VentanaSeccion({ titulo, i = 0, children, className }: { titulo?: ReactNode; i?: number; children: ReactNode; className?: string }) {
  return (
    <section className={cn("entrada-escalonada flex flex-col gap-2.5", className)} style={{ ["--i" as string]: i } as CSSProperties}>
      {titulo ? <h3 className="text-[13px] font-semibold tracking-[-0.005em] text-ink-2">{titulo}</h3> : null}
      {children}
    </section>
  );
}

/* Zona de acciones al pie del contenido: botones que pasan de linea si no caben. */
export function VentanaAcciones({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">{children}</div>;
}

/* Tarjeta suave para agrupar datos dentro de una seccion (con elevacion al pasar el cursor si es interactiva). */
export function VentanaTarjeta({ children, className, interactiva = false }: { children: ReactNode; className?: string; interactiva?: boolean }) {
  return <div className={cn("rounded-[14px] bg-surface-2 px-4 py-3.5 ring-1 ring-line", interactiva && "transition-shadow duration-200 hover:shadow-raised", className)}>{children}</div>;
}

/* Lista de datos "etiqueta: valor" en dos columnas (una en angostas), sin recortar. */
export function DatosLista({ datos }: { datos: Array<{ etiqueta: string; valor: ReactNode } | null | false> }) {
  const visibles = datos.filter((d): d is { etiqueta: string; valor: ReactNode } => !!d);
  return (
    <dl className="grid gap-x-5 gap-y-2 text-[14px] sm:grid-cols-[max-content_minmax(0,1fr)]">
      {visibles.map((d) => (
        <div key={d.etiqueta} className="contents">
          <dt className="text-ink-3">{d.etiqueta}</dt>
          <dd className="min-w-0 break-words text-ink">{d.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

/* Dos columnas en la ventana amplia o media (principal y lateral); una sola si no cabe. */
export function ColumnasVentana({ principal, lateral }: { principal: ReactNode; lateral: ReactNode }) {
  return (
    <div className="@container">
      <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">{principal}</div>
        <div className="flex min-w-0 flex-col gap-4">{lateral}</div>
      </div>
    </div>
  );
}

/* Tarjeta de la columna lateral: icono, titulo y contenido. */
export function TarjetaLateral({ icono, titulo, children, tono = "neutral", i = 0 }: { icono: ReactNode; titulo: string; children: ReactNode; tono?: "neutral" | "warning" | "danger" | "success"; i?: number }) {
  const fondo = { neutral: "bg-surface-2 ring-line", warning: "bg-warning-soft/50 ring-warning/20", danger: "bg-danger-soft/50 ring-danger/20", success: "bg-success-soft/50 ring-success/20" }[tono];
  return (
    <section className={cn("entrada-escalonada flex flex-col gap-2.5 rounded-[16px] px-4 py-3.5 ring-1 transition-shadow duration-200 hover:shadow-raised", fondo)} style={{ ["--i" as string]: i }}>
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
        <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-surface text-brand-strong shadow-card">
          {icono}
        </span>
        {titulo}
      </h3>
      <div className="flex flex-col gap-2 text-[14px] text-ink">{children}</div>
    </section>
  );
}

/* Un dato de la columna lateral: etiqueta en gris y valor completo debajo. */
export function DatoLateral({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-[12px] text-ink-3">{etiqueta}</span>
      <span className="break-words text-[14px] text-ink">{children}</span>
    </div>
  );
}
