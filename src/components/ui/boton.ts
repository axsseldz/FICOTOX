import { cn } from "./cn";

/*
 * Clases de los botones, sin "use client": las usan Button y también los
 * enlaces con forma de botón en componentes de servidor (<Link className={buttonClass()}>).
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "soft";
export type ButtonSize = "sm" | "md" | "lg";

/*
 * Botones: respuesta al presionar (scale) y un solo acento. El secundario es
 * una superficie blanca con sombra fina, no un borde gris.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand text-on-accent hover:bg-brand-strong shadow-accent disabled:bg-ink-4 disabled:shadow-none",
  secondary: "bg-surface text-ink shadow-card hover:bg-surface-2 disabled:text-ink-4",
  soft: "bg-brand-soft text-brand-strong hover:bg-brand-soft-hover disabled:bg-surface-2 disabled:text-ink-4",
  ghost: "bg-transparent text-ink-2 hover:bg-surface-3/70 hover:text-ink disabled:text-ink-4",
  danger: "bg-danger text-on-accent hover:bg-danger-strong disabled:bg-ink-4",
};

/* Alturas alineadas con los campos: sm 32 px (controles compactos), md 40 px (= Input, Select y SegmentedTabs), lg 44 px. */
const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm gap-1.5 rounded-control",
  md: "h-10 px-4 text-sm gap-2 rounded-field",
  lg: "h-11 px-5 text-md gap-2 rounded-field",
};

/* Las mismas clases para un enlace con forma de botón. */
export function buttonClass({ variant = "primary", size = "md", block, className }: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; className?: string } = {}): string {
  return cn("press inline-flex items-center justify-center font-medium whitespace-nowrap select-none disabled:cursor-not-allowed", VARIANTS[variant], SIZES[size], block && "w-full", className);
}

