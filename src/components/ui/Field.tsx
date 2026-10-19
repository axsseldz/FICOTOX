"use client";

import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { cn } from "./cn";
import { useErrorDeCampo } from "./Validacion";

/*
 * Controles de formulario. Etiqueta arriba, ayuda opcional, error abajo.
 * Superficie ligeramente rellena (como los campos de iOS/macOS), 40 px de
 * alto. Al enfocar solo cambia el color del borde (sin anillo ni sombra).
 */

/* Sin alto ni tamaño de letra: los fija la variante (clsx no fusiona clases de Tailwind, así que no se pueden sobrescribir después). */
export const controlBase =
  "w-full rounded-field border border-line bg-surface-2/80 px-3 text-ink placeholder:text-ink-4 transition-[border-color,background-color] duration-150 ease-[var(--ease-spring)] hover:border-line-strong focus:border-focus focus:outline-none aria-[invalid=true]:border-danger aria-[invalid=true]:focus:border-danger disabled:cursor-not-allowed disabled:bg-surface-3/60 disabled:text-ink-3 read-only:bg-surface-3/50";
export const controlClass = `${controlBase} text-base`;
/* Control compacto para tablas y tarjetas por fila. */
export const controlClassSm = `${controlBase} h-8 text-sm`;

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
  inline?: ReactNode;
}

export function Field({ label, hint, error: errorProp, required, htmlFor, className, children, inline }: FieldProps) {
  // Error del formulario (useValidacion) para este campo: mensaje debajo y aria en el control.
  const errorValidacion = useErrorDeCampo(htmlFor);
  const error = errorProp || errorValidacion;
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  useEffect(() => {
    if (!htmlFor) return;
    const el = document.getElementById(htmlFor);
    if (!el) return;
    if (errorValidacion) {
      el.setAttribute("aria-invalid", "true");
      el.setAttribute("aria-describedby", `${htmlFor}-error`);
      el.dataset.validacion = "1";
    } else if (el.dataset.validacion) {
      el.removeAttribute("aria-invalid");
      el.removeAttribute("aria-describedby");
      delete el.dataset.validacion;
    }
  }, [htmlFor, errorValidacion]);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={htmlFor} className="text-sm font-medium text-ink-2">
            {label}
            {required ? <span className="ml-0.5 text-brand" aria-hidden="true">*</span> : null}
          </label>
          {inline}
        </div>
      ) : null}
      {children}
      {error ? (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  mono?: boolean;
  /* Variante compacta (32 px) para filas y tablas. */
  small?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, invalid, leading, trailing, mono, small, ...rest }, ref) {
  const input = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(controlBase, small ? "h-8 text-sm" : "h-10", !small && (mono ? "text-sm" : "text-base"), leading && "pl-9", trailing && "pr-9", mono && "font-mono", invalid && "border-danger focus:border-danger", className)}
      {...rest}
    />
  );
  if (!leading && !trailing) return input;
  return (
    <div className="relative">
      {leading ? <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-3">{leading}</span> : null}
      {input}
      {trailing ? <span className="absolute inset-y-0 right-2 flex items-center text-ink-3">{trailing}</span> : null}
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  /* Variante compacta para filas y tarjetas por elemento (13 px, menos relleno). */
  small?: boolean;
}

/*
 * Area de texto que crece con el contenido: `rows` es el minimo visible y el
 * alto se ajusta al escribir, al cargar un registro y en solo lectura, asi el
 * texto largo nunca queda oculto. Respeta los saltos de linea.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, invalid, small, rows = 3, onInput, ...rest }, ref) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const setRefs = useCallback(
    (node: HTMLTextAreaElement | null) => {
      inner.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  const ajustar = useCallback(() => {
    const node = inner.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight + (node.offsetHeight - node.clientHeight)}px`;
  }, []);
  useLayoutEffect(ajustar, [ajustar, rest.value, rest.defaultValue, rest.disabled]);
  useEffect(() => {
    const node = inner.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    // El ancho cambia (hoja lateral que se abre, ventana angosta): recalcula el alto.
    let ancho = node.clientWidth;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth !== ancho) {
        ancho = node.clientWidth;
        ajustar();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ajustar]);
  return (
    <textarea
      ref={setRefs}
      rows={rows}
      aria-invalid={invalid || undefined}
      onInput={(event) => {
        ajustar();
        onInput?.(event);
      }}
      className={cn(controlBase, small ? "min-h-8 py-1.5 text-sm leading-snug" : "min-h-10 py-2.5 text-base leading-relaxed", "resize-none overflow-hidden whitespace-pre-wrap break-words", invalid && "border-danger focus:border-danger", className)}
      {...rest}
    />
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, invalid, children, ...rest }, ref) {
  return (
    <div className="relative">
      <select ref={ref} aria-invalid={invalid || undefined} className={cn(controlClass, "h-10 appearance-none pr-9", invalid && "border-danger", className)} {...rest}>
        {children}
      </select>
      <CaretDown size={14} weight="bold" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3" />
    </div>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: ReactNode;
  description?: ReactNode;
}

export const checkboxClass =
  "checkbox-mark h-[18px] w-[18px] shrink-0 cursor-pointer appearance-none rounded-xs border border-line-strong bg-surface transition-[background-color,border-color,scale] duration-150 ease-[var(--ease-spring)] checked:border-brand checked:bg-brand hover:border-ink-4 active:scale-95 disabled:cursor-not-allowed";

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, description, className, id, ...rest }, ref) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <label htmlFor={inputId} className={cn("flex cursor-pointer items-start gap-2.5 text-base text-ink", rest.disabled && "cursor-not-allowed opacity-60", className)}>
      <input ref={ref} id={inputId} type="checkbox" className={cn(checkboxClass, "mt-0.5")} {...rest} />
      {label || description ? (
        <span className="flex flex-col gap-0.5 leading-snug">
          {label ? <span>{label}</span> : null}
          {description ? <span className="text-xs text-ink-3">{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
});

export const radioClass =
  "h-[18px] w-[18px] shrink-0 cursor-pointer appearance-none rounded-full border border-line-strong bg-surface transition-[border-color,scale] duration-150 ease-[var(--ease-spring)] checked:border-[6px] checked:border-brand hover:border-ink-4 active:scale-95";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
}

export function Switch({ checked, onCheckedChange, label, description, disabled, id }: SwitchProps) {
  const autoId = useId();
  const switchId = id || autoId;
  return (
    <label htmlFor={switchId} className={cn("flex cursor-pointer items-center justify-between gap-4 text-base", disabled && "cursor-not-allowed opacity-60")}>
      {label || description ? (
        <span className="flex flex-col gap-0.5">
          {label ? <span className="font-medium text-ink">{label}</span> : null}
          {description ? <span className="text-xs text-ink-3">{description}</span> : null}
        </span>
      ) : null}
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn("relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200 ease-[var(--ease-spring)]", checked ? "bg-success" : "bg-line-strong")}
      >
        <span className={cn("absolute top-[2px] left-[2px] h-[22px] w-[22px] rounded-full bg-knob shadow-knob transition-transform duration-250 ease-[var(--ease-spring)]", checked && "translate-x-[18px]")} />
      </button>
    </label>
  );
}

export function FormGrid({ children, className, cols = 2 }: { children: ReactNode; className?: string; cols?: 1 | 2 | 3 | 4 }) {
  const colClass = { 1: "grid-cols-1", 2: "grid-cols-1 sm:grid-cols-2", 3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3", 4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" }[cols];
  return <div className={cn("grid gap-x-4 gap-y-5", colClass, className)}>{children}</div>;
}

export function FormSection({ title, description, children, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col gap-0.5">
        <h3 className="title-3 text-ink">{title}</h3>
        {description ? <p className="text-sm text-ink-3">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
