"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import { cn } from "./cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "soft";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  block?: boolean;
}

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

/* Las mismas clases para un enlace con forma de botón (<Link className={buttonClass()}>). */
export function buttonClass({ variant = "primary", size = "md", block, className }: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; className?: string } = {}): string {
  return cn("press inline-flex items-center justify-center font-medium whitespace-nowrap select-none disabled:cursor-not-allowed", VARIANTS[variant], SIZES[size], block && "w-full", className);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, icon, iconRight, block, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, block, className })}
      {...rest}
    >
      {loading ? <CircleNotch className="animate-spin" size={16} weight="bold" /> : icon}
      {children}
      {!loading && iconRight}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  /* sm 28 px (filas compactas), md 32 px (por omisión), lg 40 px (junto a botones medianos). */
  size?: "sm" | "md" | "lg";
  tone?: "neutral" | "danger";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "md", tone = "neutral", className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "press inline-flex items-center justify-center rounded-control text-ink-2 hover:bg-surface-3/80 hover:text-ink disabled:cursor-not-allowed disabled:text-ink-4 disabled:hover:bg-transparent",
        size === "sm" ? "h-7 w-7" : size === "lg" ? "h-10 w-10 rounded-field" : "h-8 w-8",
        tone === "danger" && "hover:bg-danger-soft hover:text-danger",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
