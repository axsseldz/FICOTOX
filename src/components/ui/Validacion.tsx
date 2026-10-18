"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Dialog as RadixDialog } from "radix-ui";
import { WarningCircle } from "@phosphor-icons/react";
import { Button } from "./Button";
import { cn } from "./cn";
import { esCancelacion, explicarError, type Problema } from "@/lib/client/mensajes";

/*
 * Validacion compartida de formularios y hojas de captura.
 *
 * Cada formulario declara sus reglas como una funcion pura de su estado que
 * devuelve los problemas EN EL ORDEN del formulario (`reglas(): Problema[]`).
 * El hook:
 *  - no marca nada mientras se escribe; al intentar guardar (`validar()`)
 *    marca cada campo con problema (borde rojo, mensaje debajo, aria-invalid y
 *    aria-describedby), lleva al primero (abre su seccion, desplazamiento suave
 *    salvo prefers-reduced-motion, foco) y muestra un pop-up con la lista;
 *  - despues del primer intento revalida en cada cambio: el rojo desaparece
 *    en cuanto el dato se corrige;
 *  - da la completitud de cada seccion con las MISMAS reglas (guia lateral y
 *    aviso del encabezado no se contradicen);
 *  - traduce los errores del servidor (`errorServidor`): si corresponden a un
 *    campo, lo marca y lleva a el; si no, el pop-up dice que paso y que hacer;
 *  - explica las opciones bloqueadas por reglas (`avisar`).
 */

type Errores = Record<string, string>;

interface CtxValor {
  errores: Errores;
}
const ValidacionCtx = createContext<CtxValor>({ errores: {} });

/* Error visible de un campo (por su id); lo usan Field y CampoValidado. */
export function useErrorDeCampo(id: string | undefined): string | undefined {
  const { errores } = useContext(ValidacionCtx);
  return id ? errores[id] : undefined;
}

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const FOCUSABLE = "input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex='-1'])";

/* Abre la seccion (evento de FormPage), desplaza al campo y le pone el foco. */
function irAlCampo(p: Pick<Problema, "campo" | "seccion">, opciones: { enfocar?: boolean } = {}): void {
  if (typeof window === "undefined") return;
  if (p.seccion) window.dispatchEvent(new CustomEvent("ficotox:form-open", { detail: p.seccion }));
  window.setTimeout(
    () => {
      const el = document.getElementById(p.campo);
      if (!el) return;
      el.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "center" });
      if (opciones.enfocar === false) return;
      const destino = el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE) || el;
      if (destino === el && !el.matches(FOCUSABLE) && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
      destino.focus({ preventScroll: true });
    },
    p.seccion ? 380 : 30,
  );
}

type Modo = { tipo: "faltan"; items: Problema[] } | { tipo: "servidor"; que: string; hacer?: string; items?: Problema[] } | { tipo: "aviso"; titulo?: string; que: string; hacer?: string; items: Problema[] };

export interface Validacion {
  /* Errores visibles por id de campo. */
  errores: Errores;
  intentado: boolean;
  /* Todos los problemas actuales (para la completitud). */
  problemas: Problema[];
  seccionCompleta: (seccion: string) => boolean;
  /* Secciones con faltantes (solo tras intentar guardar), en orden, con su primer campo. */
  faltantes: Array<{ seccion: string; grupo: string; primero: Problema }>;
  /* true si no hay problemas; si hay, marca, lleva al primero y muestra el pop-up. */
  validar: () => boolean;
  /* Error del servidor al guardar: al campo si se puede; si no, pop-up con que paso y que hacer. */
  errorServidor: (err: unknown, campos?: Record<string, string>, ubicacion?: Record<string, { seccion?: string; grupo?: string }>) => void;
  /* Opcion bloqueada por una regla (o accion no permitida): pop-up con la explicacion y los campos que la causan. `titulo` reemplaza al del formulario. */
  avisar: (aviso: { titulo?: string; que: string; hacer?: string; problemas?: Problema[] }) => void;
  irA: (p: Problema) => void;
  /* Para ValidacionAmbito: errores para los campos y el pop-up. */
  ctx: CtxValor;
  dialogo: ReactNode;
}

export function useValidacion({ titulo, reglas, dato = "dato" }: { titulo: string; reglas: () => Problema[]; /* "dato" (Faltan 3 datos) */ dato?: string }): Validacion {
  const [intentado, setIntentado] = useState(false);
  const [extras, setExtras] = useState<Record<string, Problema>>({});
  const [modo, setModo] = useState<Modo | null>(null);
  const [enfocarAlCerrar, setEnfocarAlCerrar] = useState<Problema | null>(null);
  const problemas = reglas();

  const visibles = intentado ? problemas : problemas.filter((p) => p.inmediato);
  const errores: Errores = {};
  for (const p of [...Object.values(extras), ...visibles]) if (!errores[p.campo]) errores[p.campo] = p.mensaje;
  const ctx: CtxValor = { errores };

  const faltantes: Validacion["faltantes"] = [];
  if (intentado) {
    for (const p of problemas) {
      if (!p.seccion || faltantes.some((f) => f.seccion === p.seccion)) continue;
      faltantes.push({ seccion: p.seccion, grupo: p.grupo || p.seccion, primero: p });
    }
  }

  // Se llaman desde el manejador de "Guardar" del mismo render: ven los problemas actuales.
  const validar = () => {
    setIntentado(true);
    if (!problemas.length) return true;
    irAlCampo(problemas[0], { enfocar: false });
    setEnfocarAlCerrar(problemas[0]);
    setModo({ tipo: "faltan", items: problemas });
    return false;
  };

  const errorServidor: Validacion["errorServidor"] = (err, campos = {}, ubicacion = {}) => {
    if (esCancelacion(err)) return;
    const e = explicarError(err);
    const id = e.clave ? campos[e.clave] : undefined;
    if (id) {
      const p: Problema = { campo: id, mensaje: e.mensajeCampo || e.que, ...(ubicacion[e.clave!] || {}) };
      setExtras((prev) => ({ ...prev, [id]: p }));
      irAlCampo(p, { enfocar: false });
      setEnfocarAlCerrar(p);
      setModo({ tipo: "servidor", que: e.que, hacer: e.hacer, items: [p] });
      return;
    }
    setEnfocarAlCerrar(null);
    setModo({ tipo: "servidor", que: e.que, hacer: e.hacer });
  };

  const avisar: Validacion["avisar"] = ({ que, hacer, problemas: causas = [], titulo: t }) => {
    if (causas.length) {
      setExtras((prev) => ({ ...prev, ...Object.fromEntries(causas.map((c) => [c.campo, c])) }));
      irAlCampo(causas[0], { enfocar: false });
    }
    setEnfocarAlCerrar(causas[0] || null);
    setModo({ tipo: "aviso", titulo: t, que, hacer, items: causas });
  };

  // Un campo marcado por el servidor o por un aviso se limpia en cuanto se edita.
  useEffect(() => {
    if (!Object.keys(extras).length) return;
    const limpiar = (event: Event) => {
      let nodo = event.target as HTMLElement | null;
      const quitar: string[] = [];
      while (nodo) {
        if (nodo.id && extras[nodo.id]) quitar.push(nodo.id);
        nodo = nodo.parentElement;
      }
      if (quitar.length) setExtras((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !quitar.includes(k))));
    };
    document.addEventListener("input", limpiar, true);
    document.addEventListener("change", limpiar, true);
    document.addEventListener("click", limpiar, true);
    return () => {
      document.removeEventListener("input", limpiar, true);
      document.removeEventListener("change", limpiar, true);
      document.removeEventListener("click", limpiar, true);
    };
  }, [extras]);

  const cerrar = (destino?: Problema | null) => {
    const ir = destino === undefined ? enfocarAlCerrar : destino;
    setModo(null);
    if (ir) window.setTimeout(() => irAlCampo(ir), 40);
  };

  return {
    errores,
    intentado,
    problemas,
    seccionCompleta: (seccion) => !problemas.some((p) => p.seccion === seccion),
    faltantes,
    validar,
    errorServidor,
    avisar,
    irA: (p) => irAlCampo(p),
    ctx,
    dialogo: <DialogoValidacion titulo={titulo} dato={dato} modo={modo} onCerrar={cerrar} />,
  };
}

/* Envuelve el formulario: da los errores a sus campos y monta el pop-up. */
export function ValidacionAmbito({ v, children }: { v: Validacion; children: ReactNode }) {
  return (
    <ValidacionCtx.Provider value={v.ctx}>
      {children}
      {v.dialogo}
    </ValidacionCtx.Provider>
  );
}

function DialogoValidacion({ titulo, dato, modo, onCerrar }: { titulo: string; dato: string; modo: Modo | null; onCerrar: (destino?: Problema | null) => void }) {
  const items = modo?.items || [];
  const n = items.length;
  const encabezado = !modo ? "" : modo.tipo === "faltan" ? `${titulo} — ${n === 1 ? `Falta 1 ${dato}` : `Faltan ${n} ${dato}s`}:` : modo.tipo === "aviso" && modo.titulo ? modo.titulo : titulo;
  return (
    <RadixDialog.Root open={!!modo} onOpenChange={(open) => !open && onCerrar()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[var(--z-ventana)] bg-deep/30 data-[state=open]:animate-fade-in motion-reduce:animate-none" />
        <div className="fixed inset-0 z-[var(--z-ventana)] flex items-end justify-center p-3 sm:items-center sm:p-6">
          <RadixDialog.Content
            role="alertdialog"
            data-validacion={modo?.tipo}
            onCloseAutoFocus={(event) => event.preventDefault()}
            className="flex max-h-full w-full max-w-[460px] flex-col overflow-hidden rounded-panel bg-surface shadow-panel outline-none data-[state=open]:animate-pop-in motion-reduce:animate-none"
          >
            <header className="flex items-start gap-3 px-5 pt-5 pb-2">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger-text" aria-hidden="true">
                <WarningCircle size={18} weight="bold" />
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <RadixDialog.Title className="text-[16px] font-semibold leading-snug text-ink">{encabezado}</RadixDialog.Title>
                <RadixDialog.Description className={cn(modo?.tipo === "faltan" ? "sr-only" : "text-[14px] leading-relaxed text-ink")}>{modo && modo.tipo !== "faltan" ? modo.que : "Corrige los datos marcados en rojo."}</RadixDialog.Description>
              </div>
            </header>
            <div className="scroll-thin flex flex-col gap-3 overflow-y-auto px-5 pb-4 sm:pl-[64px]">
              {n ? (
                <ul className="flex flex-col gap-0.5" aria-label="Datos por corregir">
                  {items.map((p, i) => (
                    <li key={`${p.campo}-${i}`}>
                      <button type="button" onClick={() => onCerrar(p)} className="press -mx-2 w-[calc(100%+16px)] rounded-[8px] px-2 py-1.5 text-left text-[13.5px] text-ink hover:bg-surface-2">
                        <span aria-hidden="true" className="mr-1.5 text-danger">·</span>
                        {p.grupo ? <span className="font-medium">{p.grupo}: </span> : null}
                        <span className="text-brand-strong underline decoration-brand/30 underline-offset-2">{p.mensaje}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {modo && modo.tipo !== "faltan" && modo.hacer ? (
                <p className="rounded-[10px] bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
                  <span className="font-medium text-ink">Qué hacer: </span>
                  {modo.hacer}
                </p>
              ) : null}
            </div>
            <footer className="flex justify-end border-t border-line px-5 py-3.5">
              <Button onClick={() => onCerrar()} autoFocus>
                Entendido
              </Button>
            </footer>
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/*
 * Contenedor validable para lo que no es un campo de texto (grupos de
 * opciones, firmas, filas de la inspeccion, tarjetas de lote): lleva el id
 * del problema, se marca en rojo y muestra el mensaje debajo.
 */
export function CampoValidado({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const error = useErrorDeCampo(id);
  return (
    <div id={id} tabIndex={-1} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} data-invalido={error ? "true" : undefined} className={cn("scroll-mt-28 rounded-[12px] outline-none transition-shadow", error && "shadow-[0_0_0_1.5px_var(--color-danger)]", className)}>
      {children}
      {error ? (
        <p id={`${id}-error`} className="px-1 pt-1.5 text-[12.5px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* Mensaje de error bajo un control que no va dentro de Field (por su id); pone aria-invalid y aria-describedby al control. */
export function MensajeCampo({ id }: { id: string }) {
  const error = useErrorDeCampo(id);
  useEffect(() => {
    const el = document.getElementById(id);
    if (!el) return;
    if (error) {
      el.setAttribute("aria-invalid", "true");
      el.setAttribute("aria-describedby", `${id}-error`);
      el.dataset.validacion = "1";
    } else if (el.dataset.validacion) {
      el.removeAttribute("aria-invalid");
      el.removeAttribute("aria-describedby");
      delete el.dataset.validacion;
    }
  }, [id, error]);
  return error ? (
    <p id={`${id}-error`} className="text-[12.5px] font-normal text-danger">
      {error}
    </p>
  ) : null;
}
