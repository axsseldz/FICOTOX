"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog as RadixDialog, DropdownMenu as RadixDropdown, Tooltip as RadixTooltip } from "radix-ui";
import { DotsThreeCircle, X } from "@phosphor-icons/react";
import { Button, IconButton } from "./Button";
import { cn } from "./cn";
import { Field, Textarea } from "./Field";
import { useValidacion, ValidacionAmbito } from "./Validacion";
import { msg, type Problema } from "@/lib/client/mensajes";
import { CampoIdentidad, useConfirmaConPassword } from "@/components/session/Reautenticar";
import { armarCargo, armarReauth } from "@/lib/client/api";

/*
 * Capas: Sheet (panel lateral), Dialog (centrado), ConfirmDialog (con hook
 * useConfirm), Dropdown y Tooltip. Todas con Radix para foco y accesibilidad,
 * y animaciones CSS por data-state.
 */

/* Velo: oscurece y empuja el fondo hacia atras para enfocar la tarea. */
const OVERLAY_CLASS = "fixed inset-0 z-[var(--z-ventana)] bg-deep/35 backdrop-blur-[3px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out";

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg" | "xl";
  headerExtra?: ReactNode;
}

export function Sheet({ open, onOpenChange, title, description, children, footer, size = "md", headerExtra }: SheetProps) {
  const width = { md: "sm:max-w-[520px]", lg: "sm:max-w-[720px]", xl: "sm:max-w-[960px]" }[size];
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={OVERLAY_CLASS} />
        <RadixDialog.Content
          className={cn(
            "fixed inset-y-0 right-0 z-[var(--z-ventana)] flex w-full flex-col bg-surface-elevated shadow-panel outline-none sm:inset-y-3 sm:right-3 sm:rounded-panel",
            "data-[state=open]:animate-sheet-in data-[state=closed]:animate-sheet-out",
            width,
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
            <div className="flex min-w-0 flex-col gap-0.5">
              <RadixDialog.Title className="title-2 text-ink">{title}</RadixDialog.Title>
              {description ? <RadixDialog.Description className="text-sm text-ink-3">{description}</RadixDialog.Description> : <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {headerExtra}
              <RadixDialog.Close asChild>
                <IconButton label="Cerrar">
                  <X size={16} weight="bold" />
                </IconButton>
              </RadixDialog.Close>
            </div>
          </header>
          <div className="scroll-thin flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
          {footer ? <footer className="material flex items-center justify-end gap-2 border-t border-line px-5 py-3.5 sm:px-6 sm:rounded-b-panel">{footer}</footer> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}

export function Dialog({ open, onOpenChange, title, description, children, footer, size = "md" }: DialogProps) {
  const width = { sm: "max-w-[420px]", md: "max-w-[560px]", lg: "max-w-[760px]" }[size];
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={OVERLAY_CLASS} />
        <div className="fixed inset-0 z-[var(--z-ventana)] flex items-end justify-center p-3 sm:items-center sm:p-6">
          <RadixDialog.Content
            className={cn(
              "flex max-h-full w-full flex-col overflow-hidden rounded-panel bg-surface-elevated shadow-panel outline-none",
              "data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out",
              width,
            )}
          >
            <header className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
              <div className="flex min-w-0 flex-col gap-1">
                <RadixDialog.Title className="title-2 text-ink">{title}</RadixDialog.Title>
                {description ? <RadixDialog.Description className="text-sm text-ink-2">{description}</RadixDialog.Description> : <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>}
              </div>
              <RadixDialog.Close asChild>
                <IconButton label="Cerrar">
                  <X size={16} weight="bold" />
                </IconButton>
              </RadixDialog.Close>
            </header>
            {children ? <div className="scroll-thin overflow-y-auto px-5 pb-4">{children}</div> : null}
            {footer ? <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</footer> : null}
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/* ---------- Confirmación con promesa ---------- */

interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { open: boolean }) | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setState({ ...options, open: true });
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setState((prev) => (prev ? { ...prev, open: false } : prev));
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog
        open={!!state?.open}
        onOpenChange={(open) => {
          if (!open) settle(false);
        }}
        title={state?.title || ""}
        description={state?.description}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => settle(false)}>
              {state?.cancelLabel || "Cancelar"}
            </Button>
            <Button variant={state?.tone === "danger" ? "danger" : "primary"} onClick={() => settle(true)} autoFocus>
              {state?.confirmLabel || "Confirmar"}
            </Button>
          </>
        }
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm debe usarse dentro de ConfirmProvider");
  return ctx;
}

/* ---------- Captura de motivo con promesa (anular, dar de baja, enmendar...) ---------- */

interface PromptOptions {
  title: ReactNode;
  description?: ReactNode;
  label?: ReactNode;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  /* Longitud minima del texto (los motivos de anulacion requieren al menos 5 caracteres). */
  minLength?: number;
  defaultValue?: string;
  /*
   * Accion critica (Fase 2): el mismo dialogo pide la contrasena para confirmar
   * la identidad; se usa en la reautenticacion de la peticion que sigue.
   */
  critico?: boolean;
}

type PromptFn = (options: PromptOptions) => Promise<string | null>;

const PromptContext = createContext<PromptFn | null>(null);

export function PromptProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(PromptOptions & { open: boolean; seq: number }) | null>(null);
  const resolver = useRef<((value: string | null) => void) | null>(null);
  const seq = useRef(0);

  const prompt = useCallback<PromptFn>((options) => {
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
      seq.current += 1;
      setState({ ...options, open: true, seq: seq.current });
    });
  }, []);

  const settle = useCallback((result: string | null) => {
    resolver.current?.(result);
    resolver.current = null;
    setState((prev) => (prev ? { ...prev, open: false } : prev));
  }, []);

  return (
    <PromptContext.Provider value={prompt}>
      {children}
      {/* Cada captura monta su propio formulario (sin arrastrar lo escrito ni los errores de la anterior). */}
      {state ? <PromptDialogo key={state.seq} state={state} onSettle={settle} /> : null}
    </PromptContext.Provider>
  );
}

function PromptDialogo({ state, onSettle }: { state: PromptOptions & { open: boolean }; onSettle: (result: string | null) => void }) {
  const [value, setValue] = useState(state.defaultValue || "");
  const [password, setPassword] = useState("");
  const [cargo, setCargo] = useState("");
  const conPassword = useConfirmaConPassword();
  const minLength = state.minLength ?? 5;
  const pideClave = !!state.critico && conPassword;
  const fieldId = "prompt-motivo";
  const etiqueta = typeof state.label === "string" ? state.label : "Motivo";
  const v = useValidacion({
    titulo: "Falta información para continuar",
    reglas: () => {
      const out: Problema[] = [];
      const largo = value.trim().length;
      if (minLength > 0 && largo === 0) out.push({ campo: fieldId, mensaje: `Escribe ${etiqueta.toLowerCase() === "motivo" ? "el motivo" : `«${etiqueta}»`}` });
      else if (largo < minLength) out.push({ campo: fieldId, mensaje: msg.minimo(etiqueta, minLength) });
      if (pideClave && !password) out.push({ campo: "prompt-password", mensaje: msg.password });
      return out;
    },
  });
  const confirmar = () => {
    if (!v.validar()) return;
    if (state.critico) {
      armarReauth(pideClave ? { password } : null);
      armarCargo(cargo ? Number(cargo) : null);
    }
    onSettle(value.trim());
  };

  return (
    <Dialog
      open={state.open}
      onOpenChange={(open) => {
        if (!open) onSettle(null);
      }}
      title={state.title || ""}
      description={state.description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onSettle(null)}>
            {state.cancelLabel || "Cancelar"}
          </Button>
          <Button variant={state.tone === "danger" ? "danger" : "primary"} onClick={confirmar}>
            {state.confirmLabel || "Confirmar"}
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <Field label={state.label || "Motivo"} htmlFor={fieldId} required={minLength > 0} hint="Queda registrado con tu usuario, fecha y hora.">
          <Textarea id={fieldId} rows={3} autoFocus placeholder={state.placeholder || "Describe el motivo; quedará registrado en la bitácora de auditoría"} value={value} onChange={(event) => setValue(event.target.value)} />
        </Field>
        {state.critico ? (
          <div className="mt-4">
            <CampoIdentidad value={password} onChange={setPassword} id="prompt-password" cargo={cargo} onCargo={setCargo} />
          </div>
        ) : null}
      </ValidacionAmbito>
    </Dialog>
  );
}

export function usePrompt(): PromptFn {
  const ctx = useContext(PromptContext);
  if (!ctx) throw new Error("usePrompt debe usarse dentro de PromptProvider");
  return ctx;
}

/* ---------- Dropdown ---------- */

export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  /* Linea secundaria bajo la etiqueta (que hace la accion). */
  description?: ReactNode;
  onSelect?: () => void;
  tone?: "neutral" | "brand" | "success" | "warning" | "danger";
  disabled?: boolean;
  separatorBefore?: boolean;
  /* Identificador para pruebas (data-testid del renglon). */
  testid?: string;
}

const ITEM_ICON_TONE: Record<NonNullable<MenuItem["tone"]>, string> = {
  neutral: "bg-surface-3 text-ink-2",
  brand: "bg-brand-soft text-brand",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

/*
 * Menu contextual: cada opcion lleva su icono en una cajita del color de su
 * tono (como los menus de macOS con SF Symbols) y, si hace falta, una linea
 * que explica que hace. Al resaltar, la fila entera toma el color de acento.
 */
export function Dropdown({ trigger, items, align = "end", label, header }: { trigger: ReactNode; items: MenuItem[]; align?: "start" | "end"; label?: string; header?: ReactNode }) {
  return (
    <RadixDropdown.Root>
      <RadixDropdown.Trigger asChild aria-label={label}>
        {trigger}
      </RadixDropdown.Trigger>
      <RadixDropdown.Portal>
        <RadixDropdown.Content
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className="scroll-thin max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto bg-popover border border-line z-[var(--z-popover)] min-w-[220px] origin-[var(--radix-dropdown-menu-content-transform-origin)] rounded-card p-1.5 shadow-pop data-[state=open]:animate-materialize"
        >
          {/* El encabezado (nombre del registro) pasa de linea en vez de ensanchar el menu. */}
          {header ? <div className="max-w-[320px] px-2.5 pt-1.5 pb-2 text-xs break-words text-ink-3">{header}</div> : null}
          {items.map((item, index) => {
            const tone = item.tone || "neutral";
            return (
              <div key={index}>
                {item.separatorBefore ? <RadixDropdown.Separator className="my-1.5 h-px bg-line" /> : null}
                <RadixDropdown.Item
                  disabled={item.disabled}
                  onSelect={() => item.onSelect?.()}
                  data-testid={item.testid}
                  className={cn(
                    "group flex cursor-pointer select-none items-center gap-3 rounded-field px-2 py-1.5 text-sm outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45",
                    tone === "danger" ? "text-danger data-[highlighted]:bg-danger-soft" : "text-ink data-[highlighted]:bg-surface-3",
                  )}
                >
                  {item.icon ? <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-control transition-colors", ITEM_ICON_TONE[tone])}>{item.icon}</span> : null}
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate font-medium">{item.label}</span>
                    {/* Deshabilitada: la linea secundaria es el motivo y se lee completa. */}
                    {item.description ? <span className={cn("text-2xs text-ink-3", item.disabled ? "max-w-[280px] whitespace-normal" : "truncate")}>{item.description}</span> : null}
                  </span>
                </RadixDropdown.Item>
              </div>
            );
          })}
        </RadixDropdown.Content>
      </RadixDropdown.Portal>
    </RadixDropdown.Root>
  );
}

/* ---------- Menu de acciones de una fila ---------- */

/* Un solo boton "⋯" por fila que agrupa todas las acciones (abrir, editar, avanzar de etapa, anular...). */
export function ActionMenu({ items, header, label = "Acciones" }: { items: MenuItem[]; header?: ReactNode; label?: string }) {
  // Sin acciones (p. ej. un rol de solo lectura) no se muestra un menu vacio.
  if (!items.length) return null;
  return (
    <Dropdown
      label={label}
      header={header}
      trigger={
        <IconButton label={label} className="text-ink-3 hover:bg-surface-3 hover:text-ink data-[state=open]:bg-surface-3 data-[state=open]:text-ink">
          <DotsThreeCircle size={22} weight="regular" />
        </IconButton>
      }
      items={items}
    />
  );
}

/* ---------- Tooltip ---------- */

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RadixTooltip.Provider delayDuration={300}>{children}</RadixTooltip.Provider>;
}

export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content side={side} sideOffset={6} className="bg-popover border border-line z-[var(--z-popover)] max-w-xs rounded-control px-2.5 py-1.5 text-xs text-ink shadow-pop data-[state=delayed-open]:animate-menu-in">
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

/* ---------- HoverCard ---------- */
