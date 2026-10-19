"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import { cn } from "./cn";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./boton";

export { buttonClass };


export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  block?: boolean;
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
