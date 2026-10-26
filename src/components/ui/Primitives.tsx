"use client";

import { useEffect, useState, type HTMLAttributes, type ReactNode } from "react";
import { useFiguraDe } from "./Figura";
import { urlFoto, useFotoDe, useFotoUrl } from "./FotoPerfil";
import { AvatarArt } from "./AvatarArt";
import { cn } from "./cn";
import { teclasAtajo, useEsMac } from "@/lib/client/atajos";

/* Piezas pequeñas compartidas: Badge, Card, Skeleton, EmptyState, Kbd, Avatar, Stat, StockMeter. */

export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "bloom" | "ink";

/*
 * Paleta tonal de insignias: fondo tenue del tono, texto del
 * mismo tono y un borde sutil. brand = información / en curso; neutral = cerrado,
 * borrador, archivado; "ink" es un alias del gris tonal (nunca un fondo claro u
 * oscuro sólido, que en oscuro brillaba más que el resto).
 */
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-3 text-ink-2 ring-1 ring-inset ring-line-strong/50",
  brand: "bg-brand-soft text-brand-strong ring-1 ring-inset ring-brand-strong/15",
  success: "bg-success-soft text-success-text ring-1 ring-inset ring-success-text/15",
  warning: "bg-warning-soft text-warning-text ring-1 ring-inset ring-warning-text/15",
  danger: "bg-danger-soft text-danger-text ring-1 ring-inset ring-danger-text/15",
  bloom: "bg-bloom-soft text-bloom-text ring-1 ring-inset ring-bloom-text/15",
  ink: "bg-surface-3 text-ink-2 ring-1 ring-inset ring-line-strong/50",
};

/*
 * Etiqueta (versión oficial de chips y estados): md 24 px y texto xs para
 * estados y datos; sm 20 px y texto 2xs para marcas secundarias («Opcional»,
 * «Pronto», tipo de resultado). `wrap`: el texto largo pasa de línea (nombres
 * de rol) en lugar de recortarse.
 */
export function Badge({ tone = "neutral", dot, size = "md", wrap, className, children }: { tone?: Tone; dot?: boolean; size?: "sm" | "md"; wrap?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full font-medium", size === "sm" ? "gap-1 px-2 text-2xs" : "gap-1.5 px-2.5 text-xs", wrap ? cn("py-0.5 leading-snug", size === "sm" ? "min-h-5" : "min-h-6") : cn("whitespace-nowrap", size === "sm" ? "h-5" : "h-6"), TONES[tone], className)}>
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function Card({ className, children, padded = true, ...rest }: HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return (
    <div className={cn("rounded-card bg-surface shadow-card", padded && "p-5", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-4", className)}>
      <div className="flex flex-col gap-0.5">
        <h2 className="title-3 text-ink">{title}</h2>
        {description ? <p className="text-sm text-ink-3">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-sm bg-surface-3", className)} aria-hidden="true" />;
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="flex flex-col divide-y divide-line" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid items-center gap-4 px-4 py-3.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className={cn("h-3.5", c === 0 ? "w-3/4" : c === cols - 1 ? "w-1/3" : "w-1/2")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, description, action, compact, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; compact?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14", className)}>
      {icon ? <div className="flex h-12 w-12 items-center justify-center rounded-card bg-surface-3 text-ink-3">{icon}</div> : null}
      <div className="flex flex-col gap-1">
        <p className="text-md font-semibold text-ink">{title}</p>
        {description ? <p className="max-w-md text-sm text-ink-3">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/* `status` 403: la persona no tiene acceso (no se ofrece «Reintentar», que no lo cambiaria). */
export function ErrorState({ message, onRetry, status }: { message: string; onRetry?: () => void; status?: number | null }) {
  const sinAcceso = status === 403;
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center" data-error-estado={status ?? undefined}>
      <p className="text-md font-semibold text-ink">{sinAcceso ? "Sin acceso" : "No se pudo cargar"}</p>
      <p className="max-w-md text-sm text-ink-3">{message}</p>
      {onRetry && !sinAcceso ? (
        <button type="button" onClick={onRetry} className="press h-8 rounded-control bg-surface px-3 text-sm font-medium text-ink shadow-card hover:bg-surface-2">
          Reintentar
        </button>
      ) : null}
    </div>
  );
}

/* Un atajo («Mod+K», «Esc», «Mod+F») con las teclas del sistema de la persona: ⌘ K en Mac, Ctrl K en Windows/Linux. */
export function Atajo({ atajo, className }: { atajo: string; className?: string }) {
  const mac = useEsMac();
  return (
    <span className={cn("inline-flex items-center gap-1", className)} data-atajo={atajo}>
      {teclasAtajo(atajo, mac).map((tecla, i) => (
        <Kbd key={i}>{tecla}</Kbd>
      ))}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-xs bg-surface-3 px-1.5 font-sans text-2xs font-medium text-ink-3">{children}</kbd>;
}

/*
 * Avatar de una persona: su foto propia si eligio "Foto" y tiene una (128 px
 * en listas, 512 en tamaños grandes; circular, con el mismo borde que las
 * figuras y una aparicion suave); si no, o si la foto falla, su figura del
 * catalogo (`AvatarArt`): la elegida o, si no eligio, la que le toca siempre.
 */
export function Avatar({ id, name, email, avatar, size = "md", className, animado }: { id?: unknown; name?: unknown; email?: unknown; avatar?: unknown; size?: "xs" | "sm" | "md" | "lg" | "xl"; className?: string; animado?: "siempre" | "al-pasar" | false }) {
  const px = { xs: 24, sm: 28, md: 36, lg: 48, xl: 72 }[size];
  const seed = String(email || name || "?").trim().toLowerCase();
  // La misma figura que en Mi cuenta: la elegida o, si no eligio, una distinta a la de los demas (directorio), siempre la misma.
  const figura = useFiguraDe(avatar, seed);
  const foto = useFotoDe({ id, email, nombre: name });
  const url = useFotoUrl(foto ? urlFoto(foto.id, foto.version, size === "xl" ? 512 : 128) : null);
  const [fallida, setFallida] = useState<string | null>(null);
  if (url && fallida !== url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- blob: de la foto pedida con sesion
      <img src={url} alt={String(name || email || "Foto de perfil")} width={px} height={px} onError={() => setFallida(url)} className={cn("foto-perfil shrink-0 rounded-full bg-surface-3 object-cover shadow-card", className)} style={{ width: px, height: px }} />
    );
  }
  return <AvatarArt avatar={figura} seed={seed} size={px} animado={animado} className={cn("rounded-full shadow-card", className)} />;
}

/*
 * Medidor de existencia. Recibe la cantidad real, el máximo (capacidad o stock
 * de referencia) y el mínimo, y muestra: barra animada con color según el estado
 * (vacío = rojo, bajo = ámbar, normal = verde), una marca en el mínimo y la
 * lectura "6 de 8 L · 75 %". `low` lo decide quien llama con la misma regla
 * que usan los filtros y los avisos del Inicio, para que todo coincida.
 */
export function StockMeter({ current, max, min, unit, low, size = "sm", label, className }: { current: number | null; max?: number | null; min?: number | null; unit?: string; low?: boolean; size?: "sm" | "lg"; label?: ReactNode; className?: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const known = current !== null && current !== undefined;
  const value = known ? Math.max(0, current) : 0;
  const cap = max && max > 0 ? max : value > 0 ? value : 0;
  const percent = cap > 0 ? Math.min(100, (value / cap) * 100) : 0;
  const empty = known && value <= 0;
  const state: "empty" | "low" | "ok" | "unknown" = !known ? "unknown" : empty ? "empty" : low ? "low" : "ok";
  const bar = { empty: "bg-danger", low: "bg-warning", ok: "bg-success", unknown: "bg-line-strong" }[state];
  const text = { empty: "text-danger", low: "text-warning-text", ok: "text-ink-3", unknown: "text-ink-4" }[state];
  const status = { empty: "Vacío", low: "Bajo", ok: `${Math.round(percent)} %`, unknown: "Sin registro" }[state];
  const minPercent = min && min > 0 && cap > 0 ? Math.min(100, (min / cap) * 100) : null;
  const u = unit ? ` ${unit}` : "";
  const reading = !known ? "Sin registro" : max && max > 0 ? `${fmtNumber(value)} de ${fmtNumber(max)}${u}` : `${fmtNumber(value)}${u}`;
  return (
    <div className={cn("flex min-w-[140px] flex-col", size === "lg" ? "gap-2" : "gap-1", className)}>
      <div className={cn("relative w-full overflow-hidden rounded-full bg-surface-3", size === "lg" ? "h-2.5" : "h-1.5")} role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} aria-label={typeof label === "string" ? label : reading}>
        {/* La barra ocupa todo el riel y se recorre con transform (sin animar el ancho): el riel redondeado la recorta igual. */}
        <div className={cn("h-full w-full rounded-full transition-[translate,background-color] duration-700 ease-[var(--ease-spring)]", bar, state === "empty" && "animate-pulse")} style={{ translate: `${ready ? percent - 100 : -100}% 0` }} />
        {minPercent !== null ? <span className="absolute top-0 h-full w-0.5 bg-ink/35" style={{ left: `calc(${minPercent}% - 1px)` }} title={`Mínimo: ${fmtNumber(min as number)}${u}`} aria-hidden="true" /> : null}
      </div>
      <div className={cn("tnum flex items-center justify-between gap-2", size === "lg" ? "text-sm" : "text-xs")}>
        <span className="text-ink-3">{label ?? reading}</span>
        <span className={cn("shrink-0 font-medium", text)}>{status}</span>
      </div>
    </div>
  );
}

const fmtNumber = (value: number) => value.toLocaleString("es-MX", { maximumFractionDigits: 3 });

/* Correo que, si no cabe, parte la línea antes de la @ o de un punto (nunca a media palabra). */
export function Correo({ valor, className }: { valor: unknown; className?: string }) {
  const partes = String(valor || "").split(/(?=[@.])/);
  return (
    <span className={cn("break-words", className)}>
      {partes.map((parte, i) => (
        <span key={i}>
          {i > 0 ? <wbr /> : null}
          {parte}
        </span>
      ))}
    </span>
  );
}

/* Fila "etiqueta · valor" para fichas de detalle (estilo lista de ajustes). */
export function DetailRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 py-2.5 text-sm", className)}>
      <span className="shrink-0 text-ink-3">{label}</span>
      <span className="min-w-0 text-right text-ink">{children}</span>
    </div>
  );
}
