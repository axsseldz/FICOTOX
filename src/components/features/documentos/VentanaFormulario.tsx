"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Dialog as RadixDialog } from "radix-ui";
import { CaretDown, X } from "@phosphor-icons/react";
import { IconButton } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";

/*
 * Formularios de Documentos SGC en ventana centrada, como el resto de la
 * plataforma: sobre la pagina difuminada, con titulo y una linea de contexto
 * arriba, los campos obligatorios primero, lo opcional plegado en "Más
 * opciones" y las acciones abajo (la contrasena, cuando aplica, se pide al
 * confirmar, igual que siempre). En pantallas angostas ocupa toda la pantalla.
 * La animacion respeta prefers-reduced-motion (globals.css).
 */

/*
 * Salida animada aunque quien la usa la desmonte al cerrar (todas se montan
 * con una condicion y se quitan al cerrar, al cancelar o al guardar): al
 * desmontarse de verdad se deja una copia inerte del velo y de la ventana
 * (sin ids, sin roles y oculta a lectores de pantalla) que hace la misma
 * animacion de cierre de Radix (data-state="closed") y se quita al terminar.
 * Con movimiento reducido no se deja copia.
 */
function salidaAnimada(velo: HTMLElement | undefined, capa: HTMLElement | undefined) {
  if (!velo || !capa || !velo.isConnected || !capa.isConnected) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const copias = [velo, capa].map((original) => {
    const copia = original.cloneNode(true) as HTMLElement;
    // Lo escrito en los campos (la copia solo trae los atributos).
    const campos = original.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select");
    copia.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select").forEach((el, i) => {
      const fuente = campos[i];
      if (!fuente) return;
      if (el instanceof HTMLInputElement && fuente instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) el.checked = fuente.checked;
      else if (el.type !== "file") el.value = fuente.value;
    });
    for (const el of [copia, ...Array.from(copia.querySelectorAll<HTMLElement>("*"))]) {
      for (const a of ["id", "name", "role", "data-testid", "tabindex", "aria-labelledby", "aria-describedby", "aria-modal", "aria-controls"]) el.removeAttribute(a);
      if (el.getAttribute("data-state") === "open") el.setAttribute("data-state", "closed");
    }
    copia.setAttribute("aria-hidden", "true");
    copia.setAttribute("inert", "");
    copia.style.pointerEvents = "none";
    return copia;
  });
  // Solo si la ventana se quito de verdad (en desarrollo, StrictMode desmonta y vuelve a montar sin quitarla).
  queueMicrotask(() => {
    if (velo.isConnected || capa.isConnected) return;
    for (const copia of copias) document.body.appendChild(copia);
    const ventana = copias[1].querySelector<HTMLElement>("[data-state]") || copias[1];
    let quitada = false;
    const quitar = () => {
      if (quitada) return;
      quitada = true;
      copias.forEach((c) => c.remove());
    };
    ventana.addEventListener("animationend", quitar, { once: true });
    window.setTimeout(quitar, 600);
  });
}

const ANCHO = { sm: "sm:max-w-[440px]", md: "sm:max-w-[560px]", lg: "sm:max-w-[680px]", xl: "sm:max-w-[820px]" } as const;

export function VentanaFormulario({
  open = true,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open?: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof ANCHO;
}) {
  const nodos = useRef<{ velo?: HTMLElement; capa?: HTMLElement }>({});
  useLayoutEffect(() => {
    const n = nodos.current;
    return () => salidaAnimada(n.velo, n.capa);
  }, []);
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          ref={(el) => {
            if (el) nodos.current.velo = el;
          }}
          className="fixed inset-0 z-[var(--z-ventana)] bg-deep/45 backdrop-blur-md data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out"
        />
        <div
          ref={(el) => {
            if (el) nodos.current.capa = el;
          }}
          data-state={open ? "open" : "closed"}
          className="capa-ventana pointer-events-none fixed inset-0 z-[var(--z-ventana)] flex items-stretch justify-center sm:items-center sm:p-6"
        >
          <RadixDialog.Content
            data-testid="ventana-formulario"
            className={cn(
              "pointer-events-auto flex w-full flex-col overflow-hidden bg-surface-elevated shadow-panel outline-none",
              "h-full sm:h-auto sm:max-h-[min(88dvh,820px)] sm:rounded-panel",
              "data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out",
              ANCHO[size],
            )}
          >
            <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
              <div className="flex min-w-0 flex-col gap-1">
                <RadixDialog.Title className="text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink">{title}</RadixDialog.Title>
                {description ? <RadixDialog.Description className="text-[13px] leading-snug text-ink-3">{description}</RadixDialog.Description> : <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>}
              </div>
              <RadixDialog.Close asChild>
                <IconButton label="Cerrar">
                  <X size={16} weight="bold" />
                </IconButton>
              </RadixDialog.Close>
            </header>
            {children ? <div className="scroll-thin flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div> : null}
            {footer ? <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5 sm:px-6">{footer}</footer> : null}
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/*
 * Campos opcionales plegados. El contenido siempre esta montado (conserva lo
 * escrito); al plegarse solo se oculta. Si un campo de adentro queda marcado
 * por la validacion (aria-invalid), se despliega solo para que se vea y reciba
 * el foco. `llenos`: cuantos opcionales ya tienen dato (se avisa al estar plegado).
 */
export function MasOpciones({ children, llenos = 0, etiqueta = "Más opciones", abiertaInicial = false }: { children: ReactNode; llenos?: number; etiqueta?: string; abiertaInicial?: boolean }) {
  const [abierta, setAbierta] = useState(abiertaInicial);
  const contenido = useRef<HTMLDivElement | null>(null);
  const id = useId();
  useEffect(() => {
    const el = contenido.current;
    if (!el) return;
    const revisar = () => {
      if (el.querySelector('[aria-invalid="true"]')) setAbierta(true);
    };
    const mo = new MutationObserver(revisar);
    mo.observe(el, { subtree: true, attributes: true, attributeFilter: ["aria-invalid"] });
    return () => mo.disconnect();
  }, []);
  return (
    <div className="flex flex-col gap-4" data-testid="mas-opciones" data-abierta={abierta ? "1" : "0"}>
      <button
        type="button"
        aria-expanded={abierta}
        aria-controls={id}
        onClick={() => setAbierta((v) => !v)}
        className="press flex items-center gap-2 self-start rounded-[8px] px-1 py-1 text-left text-[13px] font-medium text-brand-strong hover:text-brand focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none"
      >
        <CaretDown size={13} weight="bold" className={cn("transition-transform duration-200 motion-reduce:transition-none", abierta && "rotate-180")} aria-hidden="true" />
        {etiqueta}
        {!abierta && llenos > 0 ? <span className="text-[12px] font-normal text-ink-3">· {llenos} con datos</span> : null}
      </button>
      <div id={id} ref={contenido} hidden={!abierta} className={cn("flex flex-col gap-4", abierta && "mas-opciones-entra")}>
        {children}
      </div>
    </div>
  );
}

/* Cuantos valores tienen dato (para el aviso de "Más opciones" plegado). */
export const conDato = (...valores: unknown[]) => valores.filter((v) => (typeof v === "string" ? v.trim() !== "" : v !== null && v !== undefined && v !== false)).length;
