"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, type ReactNode } from "react";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { cn } from "./cn";
import { Input } from "./Field";

export function PageHeader({ title, description, actions, eyebrow, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; className?: string }) {
  return (
    <header className={cn("flex flex-col gap-4 md:flex-row md:items-end md:justify-between", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow ? <div className="text-[13px] text-ink-3">{eyebrow}</div> : null}
        <h1 className="title-1 text-ink">{title}</h1>
        {description ? <p className="max-w-2xl text-[14px] text-ink-3">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export interface TabItem {
  href: string;
  label: string;
  count?: number | null;
  exact?: boolean;
}

/* Pestañas enlazadas a rutas (la URL es la fuente de verdad), como control segmentado. */
export function LinkTabs({ items, className }: { items: TabItem[]; className?: string }) {
  const pathname = usePathname();
  return (
    <nav className={cn("scroll-thin inline-flex max-w-full gap-0.5 self-start overflow-x-auto rounded-[11px] bg-surface-3/80 p-1", className)} aria-label="Secciones">
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "press flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-[8px] px-3.5 text-[13px] font-medium transition-colors",
              active ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink",
            )}
          >
            {item.label}
            {typeof item.count === "number" ? <span className={cn("tnum text-[12px]", active ? "text-ink-3" : "text-ink-3")}>{item.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/*
 * Control segmentado de estado local (sin ruta): un filtro con una sola opción
 * activa, expuesto como grupo de radios. Flechas izquierda/derecha cambian la
 * opción; el foco vive solo en la opción activa (roving tabindex).
 */
/* `stretch`: las opciones se reparten el ancho por igual (control de dos o tres opciones a lo ancho). */
export function SegmentedTabs<T extends string>({ value, onChange, options, className, size = "md", label, stretch = false }: { value: T; onChange: (value: T) => void; options: Array<{ value: T; label: ReactNode; count?: number | null; tone?: "neutral" | "warning" | "danger" }>; className?: string; size?: "sm" | "md"; label?: string; stretch?: boolean }) {
  const group = useRef<HTMLDivElement>(null);
  const move = (delta: number) => {
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + delta + options.length) % options.length];
    if (!next) return;
    onChange(next.value);
    // El foco sigue a la opción activa una vez que React la marcó.
    requestAnimationFrame(() => group.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
  };
  return (
    <div
      ref={group}
      className={cn("scroll-thin inline-flex max-w-full gap-0.5 overflow-x-auto rounded-[11px] bg-surface-3/80 p-1", className)}
      role="radiogroup"
      aria-label={label || "Filtro"}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          move(1);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        const countTone = option.tone === "danger" ? "text-danger" : option.tone === "warning" ? "text-warning-text" : "text-ink-3";
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "press flex items-center gap-1.5 whitespace-nowrap rounded-[8px] font-medium transition-colors",
              stretch ? "flex-1 justify-center" : "shrink-0",
              size === "sm" ? "h-7 px-2.5 text-[12.5px]" : "h-8 px-3.5 text-[13px]",
              active ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink",
            )}
          >
            {option.label}
            {typeof option.count === "number" ? <span className={cn("tnum text-[12px]", countTone)}>{option.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder, className, autoFocus }: { value: string; onChange: (value: string) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  return (
    <Input
      type="search"
      value={value}
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder || "Buscar"}
      leading={<MagnifyingGlass size={15} />}
      trailing={
        value ? (
          <button type="button" aria-label="Limpiar búsqueda" onClick={() => onChange("")} className="press flex h-6 w-6 items-center justify-center rounded-full text-ink-3 hover:bg-surface-3 hover:text-ink">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-ink-4 text-on-accent">
              <X size={10} weight="bold" />
            </span>
          </button>
        ) : null
      }
      className={cn("rounded-full [&::-webkit-search-cancel-button]:hidden", className)}
    />
  );
}

export function Toolbar({ children, className, end }: { children?: ReactNode; className?: string; end?: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-3 md:flex-row md:items-center md:justify-between", className)}>
      <div className="flex flex-1 flex-wrap items-center gap-2.5">{children}</div>
      {end ? <div className="flex flex-wrap items-center gap-2">{end}</div> : null}
    </div>
  );
}
