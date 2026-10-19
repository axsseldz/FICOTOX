"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, CaretDown, Check, CheckCircle, Clock, Info, ListNumbers, LockSimple, Rows, SealCheck, Warning, WarningCircle } from "@phosphor-icons/react";
import { cn } from "@/components/ui/cn";
import { CampoValidado, MensajeCampo, ValidacionAmbito, type Validacion } from "@/components/ui/Validacion";
import { checkboxClass, radioClass } from "@/components/ui/Field";
import { SegmentedTabs } from "@/components/ui/PageHeader";
import { Badge, type Tone } from "@/components/ui/Primitives";
import { PersonSelect } from "./PersonSelect";
import { FirmanteSelect, type FirmanteState } from "./FirmanteSelect";
import { SignaturePad } from "./SignaturePad";
import type { PersonaCapacidad } from "@/lib/client/personal";
import { formatearFechaHora } from "@/lib/shared/fechas";

/*
 * Formatos de muestra e informe como pagina.
 *
 * - Cabecera translucida fija: regreso, clave del formato, titulo, estado y
 *   acciones.
 * - Guia de secciones a la izquierda (escritorio) o arriba (movil), con el
 *   estado de cada una: completa, con faltantes o sin evaluar.
 * - Dos modos de lectura: **paso a paso** (una seccion abierta a la vez, con
 *   "Continuar" al pie de cada una; es el modo por omision al capturar) y
 *   **todo el formato** (todas abiertas; por omision al consultar un registro
 *   terminado). La eleccion se recuerda.
 * - En solo lectura el fieldset desactiva los controles y el CSS los muestra
 *   como texto (ver `.form-readonly` en globals.css).
 */

export interface FormSectionDef {
  id: string;
  label: string;
  /* true = completa, false = falta algo, undefined = sin evaluar */
  complete?: boolean;
  /* Opcional: no bloquea el guardado ni cuenta en "n de m"; se pinta verde solo si se llenó. */
  optional?: boolean;
  /* Etiqueta en lugar de "Opcional" (p. ej. "Puede decidirse después") y nota de por qué importa. */
  optionalLabel?: string;
  optionalNote?: string;
}

interface FormPageContextValue {
  sections: FormSectionDef[];
  /* Secciones que ya se abrieron: solo en ellas se señalan los faltantes. */
  visited: Set<string>;
  openId: string;
  showAll: boolean;
  readOnly: boolean;
  open: (id: string) => void;
  next: (id: string) => void;
}

const FormPageContext = createContext<FormPageContextValue | null>(null);
const SHOW_ALL_KEY = "ficotox.form.showAll";
const OPEN_EVENT = "ficotox:form-open";

/* true cuando el formato que envuelve al componente esta en solo lectura. */
export function useFormReadOnly(): boolean {
  return !!useContext(FormPageContext)?.readOnly;
}

/*
 * Vuelve editable lo que envuelve aunque el formato este en solo lectura: los
 * dialogos de firma (revisar, aprobar, autorizar) se abren sobre registros que
 * ya no se editan pero si se firman.
 */
export function EditableScope({ children }: { children: ReactNode }) {
  const ctx = useContext(FormPageContext);
  return ctx ? <FormPageContext.Provider value={{ ...ctx, readOnly: false }}>{children}</FormPageContext.Provider> : <>{children}</>;
}

function readShowAll(): boolean | null {
  try {
    const raw = window.localStorage.getItem(SHOW_ALL_KEY);
    return raw === null ? null : raw === "1";
  } catch {
    return null;
  }
}

/*
 * `interactive` (Fase 10) va entre `children` y `tail` y sigue activo aunque el
 * formato este en solo lectura (p. ej. la evidencia instrumental: se consulta y
 * descarga siempre, antes de las firmas). `tail` vuelve a quedar en solo lectura.
 */
export function FormPage({ backHref, backLabel, code, title, status, statusTone = "brand", actions, sections, children, interactive, tail, after, readOnly = false, error, validacion }: { backHref: string; backLabel: string; code: string; title: ReactNode; status?: string; statusTone?: Tone; actions: ReactNode; sections: FormSectionDef[]; interactive?: ReactNode; tail?: ReactNode; after?: ReactNode; readOnly?: boolean; children: ReactNode; error?: string | null; /* Validacion compartida: completitud, aviso del encabezado y pop-up. */ validacion?: Validacion }) {
  const [openId, setOpenId] = useState(sections[0]?.id || "");
  const [opened, setVisited] = useState<Set<string>>(() => new Set(sections[0]?.id ? [sections[0].id] : []));
  // Al guardar con errores todas las secciones cuentan como vistas: se señalan todos los faltantes.
  const visited = error || validacion?.intentado ? new Set(sections.map((section) => section.id)) : opened;
  // Al consultar un registro terminado conviene verlo completo; al capturar, paso a paso. La persona puede cambiarlo y se recuerda.
  const [showAllPref, setShowAll] = useState<boolean>(() => (typeof window === "undefined" ? false : (readShowAll() ?? false)));
  // Un registro en solo lectura siempre se muestra completo: se consulta, no se captura.
  const showAll = readOnly || showAllPref;
  const sectionIds = sections.map((section) => section.id).join("|");

  // Con todo desplegado, la guía sigue al scroll: la sección en curso es la última cuya cabecera ya pasó la línea de lectura.
  const spyLock = useRef(false);
  useEffect(() => {
    if (!showAll) return;
    const ids = sectionIds.split("|");
    let raf = 0;
    const update = () => {
      raf = 0;
      if (spyLock.current) return;
      const line = 150;
      let currentId = ids[0];
      for (const id of ids) {
        const node = document.getElementById(id);
        if (!node) continue;
        if (node.getBoundingClientRect().top <= line) currentId = id;
        else break;
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) currentId = ids[ids.length - 1];
      setOpenId((prev) => (prev === currentId ? prev : currentId));
    };
    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    raf = window.requestAnimationFrame(update);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [sectionIds, showAll]);

  const scrollTo = (id: string) => {
    // Mientras dura el desplazamiento suave, la guía no cambia de sección por el camino.
    spyLock.current = true;
    window.setTimeout(() => {
      spyLock.current = false;
    }, 800);
    window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    // Tras desplegarse, el foco pasa al primer control de la sección (teclado y lectores de pantalla).
    window.setTimeout(() => {
      const section = document.getElementById(id);
      const target = section?.querySelector<HTMLElement>("input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)");
      target?.focus({ preventScroll: true });
    }, 340);
  };
  const visit = (id: string) => setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  const open = (id: string) => {
    setOpenId(id);
    visit(id);
    scrollTo(id);
  };
  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (!sectionIds.split("|").includes(id)) return;
      setOpenId(id);
      setVisited((prev) => new Set(prev).add(id));
      // Espera a que la sección se despliegue antes de desplazarse.
      window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    };
    window.addEventListener(OPEN_EVENT, handler);
    return () => window.removeEventListener(OPEN_EVENT, handler);
  }, [sectionIds]);
  const next = (id: string) => {
    const index = sections.findIndex((section) => section.id === id);
    const target = sections[index + 1];
    if (target) open(target.id);
  };
  const toggleShowAll = () => {
    setShowAll((value) => {
      try {
        window.localStorage.setItem(SHOW_ALL_KEY, value ? "0" : "1");
      } catch {
        /* sin almacenamiento */
      }
      return !value;
    });
  };

  // Solo las secciones obligatorias cuentan para el avance; las opcionales se marcan si se llenaron.
  const required = sections.filter((s) => !s.optional && s.complete !== undefined);
  const done = required.filter((s) => s.complete).length;
  const evaluated = required.length;
  // `sections` cambia en cada render (lleva el estado de completitud), así que memorizar el contexto no ahorra nada.
  const ctx: FormPageContextValue = { sections, visited, openId, showAll, readOnly, open, next };

  const page = (
    <FormPageContext.Provider value={ctx}>
      <div className="animate-rise-in -mt-6 flex flex-col sm:-mt-8">
        {/* Cabecera: regreso · título + estado · acciones. Una sola fila en escritorio, apilada en móvil. */}
        <div className="material static z-20 -mx-4 border-b border-line/70 sm:sticky sm:top-14 sm:-mx-8 lg:top-0">
          <div className="mx-auto flex max-w-[1184px] items-center gap-3 px-4 py-2.5 sm:px-8">
            <Link href={backHref} aria-label={backLabel} title={backLabel} className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-ink-2 shadow-card hover:text-ink">
              <ArrowLeft size={16} weight="bold" />
            </Link>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-lg font-semibold tracking-snug text-ink">{title}</h1>
                {status ? (
                  <Badge tone={statusTone} dot>
                    {status}
                  </Badge>
                ) : null}
              </div>
              <p className="truncate text-xs text-ink-3">
                {backLabel} · <span className="code">{code}</span>
              </p>
            </div>
            <div className="hidden shrink-0 items-center gap-2 sm:flex">{actions}</div>
          </div>
          {validacion && validacion.faltantes.length && !readOnly ? (
            // Mismas reglas que la guía: cada sección es un enlace a su primer campo faltante.
            <p role="status" data-aviso-faltantes className="mx-auto flex max-w-[1184px] flex-wrap items-center gap-x-1.5 gap-y-1 px-4 pb-2.5 text-xs text-danger sm:px-8">
              <span>Falta información en:</span>
              {validacion.faltantes.map((f, i) => (
                <span key={f.seccion}>
                  <button type="button" onClick={() => validacion.irA(f.primero)} className="font-medium underline decoration-danger/40 underline-offset-2 hover:decoration-danger">
                    {f.grupo}
                  </button>
                  {i < validacion.faltantes.length - 1 ? "," : ""}
                </span>
              ))}
            </p>
          ) : error ? (
            <p role="alert" className="mx-auto max-w-[1184px] px-4 pb-2.5 text-xs text-danger sm:px-8">
              {error}
            </p>
          ) : null}
        </div>

        <div className="mx-auto mt-5 grid w-full max-w-[1120px] gap-5 sm:mt-6 lg:grid-cols-[224px_minmax(0,1fr)] lg:gap-7">
          {/* Guía de secciones */}
          <nav aria-label="Secciones del formato" className="min-w-0 lg:sticky lg:top-[72px] lg:self-start">
            {!readOnly ? (
              <div className="mb-3 hidden lg:block">
                <SegmentedTabs<"pasos" | "todo">
                  label="Modo de lectura"
                  className="w-full"
                  stretch
                  value={showAll ? "todo" : "pasos"}
                  onChange={(value) => (value === "todo") !== showAll && toggleShowAll()}
                  options={[
                    { value: "pasos", label: <><ListNumbers size={14} /> Paso a paso</> },
                    { value: "todo", label: <><Rows size={14} /> Todo</> },
                  ]}
                />
              </div>
            ) : null}
            <ol className="scroll-thin -mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
              {sections.map((section, index) => {
                const active = openId === section.id;
                // Opcionales incluidas: si se evaluaron (complete === false), la guía coincide con el aviso del encabezado.
                const missing = section.complete === false && visited.has(section.id) && !active;
                return (
                  <li key={section.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => open(section.id)}
                      aria-current={active ? "step" : undefined}
                      className={cn("press flex h-9 w-full items-center gap-2.5 rounded-field px-2 text-left text-sm transition-colors", active ? "bg-surface font-medium text-ink shadow-card" : "text-ink-3 hover:bg-surface-3/70 hover:text-ink")}
                    >
                      <span className={cn("tnum flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-2xs font-semibold", section.complete ? "bg-success text-on-accent" : missing ? "bg-warning-soft text-warning-text" : active ? "bg-brand-soft text-brand-strong ring-1 ring-inset ring-brand/25" : "bg-surface-3 text-ink-3")}>{section.complete ? <Check size={11} weight="bold" /> : index + 1}</span>
                      <span className="truncate">{section.label}</span>
                      {section.optional ? <span className="ml-auto shrink-0 text-2xs font-medium uppercase tracking-wide text-ink-3">{section.optionalLabel ? "después" : "opcional"}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ol>
            {evaluated > 0 ? (
              <div className="mt-3 hidden px-2 lg:block">
                <div className="h-1 w-full overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full w-full rounded-full bg-success transition-[translate] duration-500 ease-[var(--ease-spring)]" style={{ translate: `${Math.round((done / evaluated) * 100) - 100}% 0` }} />
                </div>
                <p className="tnum mt-1.5 text-xs text-ink-3">
                  {done} de {evaluated} secciones completas
                </p>
              </div>
            ) : null}
            {!readOnly ? (
              <button type="button" onClick={toggleShowAll} className="press mt-2 inline-flex h-8 items-center gap-1.5 rounded-control px-2 text-xs font-medium text-ink-3 hover:bg-surface-3 hover:text-ink lg:hidden">
                {showAll ? <ListNumbers size={14} /> : <Rows size={14} />}
                {showAll ? "Paso a paso" : "Mostrar todo"}
              </button>
            ) : null}
          </nav>

          <div className="flex min-w-0 flex-col gap-4">
            {/* Avisos con acciones (solicitud pendiente, visto bueno): fuera del fieldset, siguen activos en solo lectura. */}
            <div id="form-avisos" className="flex flex-col gap-3 empty:hidden" />
            {/* En solo lectura el fieldset desactiva todos los controles del formato; lo que va en `after` (historial) sigue activo. */}
            <fieldset disabled={readOnly} className={cn("m-0 flex min-w-0 flex-col gap-4 border-0 p-0", readOnly && "form-readonly")}>
              {children}
            </fieldset>
            {interactive ? <FormPageContext.Provider value={{ ...ctx, readOnly: false }}>{interactive}</FormPageContext.Provider> : null}
            {tail ? (
              <fieldset disabled={readOnly} className={cn("m-0 flex min-w-0 flex-col gap-4 border-0 p-0", readOnly && "form-readonly")}>
                {tail}
              </fieldset>
            ) : null}
            {/* En pantallas chicas la cabecera no lleva acciones: van al pie. */}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4 sm:hidden">{actions}</div>
            {/* Lo que va en `after` (historial, disposición final) sigue editable aunque el formato esté en solo lectura. */}
            {after ? <FormPageContext.Provider value={{ ...ctx, readOnly: false }}>{after}</FormPageContext.Provider> : null}
          </div>
        </div>
      </div>
    </FormPageContext.Provider>
  );
  return validacion ? <ValidacionAmbito v={validacion}>{page}</ValidacionAmbito> : page;
}

export function FormCard({ id, title, description, children, aside, optional }: { id: string; title: ReactNode; description?: ReactNode; children: ReactNode; aside?: ReactNode; optional?: boolean }) {
  const ctx = useContext(FormPageContext);
  const index = ctx ? ctx.sections.findIndex((section) => section.id === id) : -1;
  const meta = index >= 0 ? ctx!.sections[index] : undefined;
  // Una tarjeta fuera de la guía (p. ej. historial en `after`) siempre está abierta.
  const isOpen = !ctx || index < 0 || ctx.showAll || ctx.openId === id;
  const isLast = !!ctx && index === ctx.sections.length - 1;
  const stepMode = !!ctx && !ctx.showAll && !ctx.readOnly && index >= 0;
  const isOptional = optional || !!meta?.optional;
  const missing = !!ctx && meta?.complete === false && ctx.visited.has(id) && !isOpen;
  // Mientras se despliega hace falta recortar; ya abierta, los desplegables (buscador de insumos) deben poder salir de la tarjeta.
  const [settled, setSettled] = useState(isOpen);
  const [prevOpen, setPrevOpen] = useState(isOpen);
  if (prevOpen !== isOpen) {
    // Cambio de estado: se vuelve a recortar hasta que termine la animación.
    setPrevOpen(isOpen);
    setSettled(false);
  }
  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => setSettled(true), 320);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  // Solo la sección en curso lleva el número en tinta; con todo desplegado, las demás van en gris.
  const current = !!ctx && ctx.openId === id;
  const badge = index >= 0 ? <span className={cn("tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-2xs font-semibold", meta?.complete ? "bg-success text-on-accent" : missing ? "bg-warning-soft text-warning-text" : current ? "bg-brand-soft text-brand-strong ring-1 ring-inset ring-brand/25" : "bg-surface-3 text-ink-2")}>{meta?.complete ? <Check size={12} weight="bold" /> : index + 1}</span> : null;

  return (
    <section id={id} className={cn("scroll-mt-24 rounded-card bg-surface shadow-card transition-[box-shadow] duration-300 sm:scroll-mt-28", current && isOpen && "shadow-raised", !isOpen && "hover:shadow-raised")} data-open={isOpen}>
      {/* Abierta: cabecera como banda propia (número, título, descripción) separada del contenido. Plegada: un botón. */}
      {isOpen ? (
        <header className={cn("flex flex-wrap items-start gap-3 rounded-t-card border-b px-5 py-4 transition-colors sm:flex-nowrap sm:px-6", current ? "border-brand/20 bg-brand-faint/60" : "border-line bg-surface-2/60")}>
          {badge}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-snug text-ink">{title}</h2>
              {isOptional ? <span className="rounded-full bg-surface-3 px-2 py-0.5 text-2xs font-medium text-ink-3">{meta?.optionalLabel || "Opcional"}</span> : null}
              {meta?.optionalNote ? <span className="text-xs text-ink-3">{meta.optionalNote}</span> : null}
            </div>
            {description ? <p className="text-sm leading-snug text-ink-3">{description}</p> : null}
          </div>
          {/* En móvil la acción de la sección baja a su propia línea, alineada con el título. */}
          {aside ? <div className="shrink-0 basis-full pl-9 sm:basis-auto sm:pl-0">{aside}</div> : null}
        </header>
      ) : (
        <button type="button" onClick={() => ctx!.open(id)} aria-expanded={false} aria-controls={`${id}-contenido`} className="press flex w-full items-center gap-3 rounded-card px-5 py-4 text-left sm:px-6">
          {badge}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-md font-semibold tracking-snug text-ink">{title}</span>
              {missing ? <span className="rounded-full bg-warning-soft px-2 py-0.5 text-2xs font-medium text-warning-text">Faltan datos</span> : null}
            </span>
            {description ? <span className="truncate text-xs text-ink-3">{description}</span> : null}
          </span>
          <CaretDown size={16} className="shrink-0 text-ink-4" />
        </button>
      )}
      <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-[var(--ease-spring)]", isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
        {/* min-w-0: con overflow visible, el ítem de la rejilla no debe ensancharse por una tabla ancha (esta se desplaza dentro de su propio contenedor). */}
        <div className={cn("min-h-0 min-w-0", settled ? "overflow-visible" : "overflow-hidden")}>
          {/* Contenido plegado = `hidden`: ni enfocable ni visible (paso a paso); la animación de altura solo se ve al abrir. */}
          <div id={`${id}-contenido`} className="min-w-0 px-5 pt-5 pb-5 sm:px-6 sm:pb-6" hidden={!isOpen}>
            {children}
            {stepMode && !isLast ? (
              <div className="mt-6 flex justify-end border-t border-line pt-4">
                <button type="button" onClick={() => ctx!.next(id)} className="press inline-flex h-9 items-center gap-2 rounded-field bg-surface-3 px-3.5 text-sm font-medium text-ink ring-1 ring-inset ring-line-strong/60 hover:bg-line">
                  Continuar <ArrowRight size={14} weight="bold" />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

/* Tabla dentro de una seccion: se desplaza en horizontal dentro de la tarjeta sin romper el ancho de la pagina. */
export function FormTable({ children, minWidth = 720, className }: { children: ReactNode; minWidth?: number; className?: string }) {
  return (
    <div className={cn("scroll-thin -mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6", className)}>
      <table className="w-full border-separate border-spacing-0 text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}
export const formTh = "h-9 whitespace-nowrap border-b border-line bg-surface-2/60 px-2 text-left text-2xs font-medium text-ink-3 first:rounded-l-control first:pl-3 last:rounded-r-control last:pr-3";
export const formTd = "border-b border-line/70 px-1.5 py-1.5 align-middle first:pl-2 last:pr-2";

/* Subtitulo dentro de una seccion (p. ej. "Tipo de análisis"). */
export function FieldGroup({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex flex-col">
        <p className="text-sm font-medium text-ink-2">{label}</p>
        {hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

/* Aviso dentro de un formato: un solo estilo para informacion, advertencia, error o confirmacion. */
export function Callout({ tone = "info", title, children, className }: { tone?: "info" | "warning" | "danger" | "success"; title?: ReactNode; children: ReactNode; className?: string }) {
  const styles = {
    info: { wrap: "bg-brand-faint text-ink", icon: "text-brand", Icon: Info },
    warning: { wrap: "bg-warning-soft text-ink", icon: "text-warning", Icon: Warning },
    danger: { wrap: "bg-danger-soft text-ink", icon: "text-danger", Icon: WarningCircle },
    success: { wrap: "bg-success-soft text-ink", icon: "text-success", Icon: CheckCircle },
  }[tone];
  const Icon = styles.Icon;
  return (
    <div className={cn("flex gap-3 rounded-box px-4 py-3 text-sm leading-relaxed", styles.wrap, className)} role={tone === "danger" ? "alert" : "status"}>
      <Icon size={18} weight="fill" className={cn("mt-0.5 shrink-0", styles.icon)} />
      <div className="min-w-0">
        {title ? <p className="font-medium">{title}</p> : null}
        <div className={cn(title && "mt-0.5 text-ink-2")}>{children}</div>
      </div>
    </div>
  );
}

/* Fila de un paso con casilla, texto y campos adicionales alineados. */
export function StepRow({ number, label, checked, onCheckedChange, children, disabled }: { number?: ReactNode; label: ReactNode; checked: boolean; onCheckedChange: (checked: boolean) => void; children?: ReactNode; disabled?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-3 border-b border-line py-3.5 first:pt-0 last:border-b-0 last:pb-0 md:flex-row md:items-start", disabled && "opacity-60")}>
      <label className="flex flex-1 cursor-pointer items-start gap-3">
        <input type="checkbox" className={cn(checkboxClass, "mt-0.5")} checked={checked} disabled={disabled} onChange={(event) => onCheckedChange(event.target.checked)} />
        <span className="flex gap-2.5 text-base leading-snug text-ink">
          {number !== undefined ? <span className="tnum w-5 shrink-0 text-ink-4">{number}</span> : null}
          <span className={cn(checked && "text-ink-2")}>{label}</span>
        </span>
      </label>
      {children ? <div className="flex w-full flex-col gap-2 md:w-[360px] md:shrink-0">{children}</div> : null}
    </div>
  );
}

/* `cols` fija las columnas en pantallas grandes (por omisión 3); en móvil siempre apila. */
export function ChoiceGrid({ children, className, cols = 3 }: { children: ReactNode; className?: string; cols?: 2 | 3 | 4 | 5 }) {
  const grid = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4", 5: "sm:grid-cols-3 lg:grid-cols-5" }[cols];
  return <div className={cn("grid gap-2.5", grid, className)}>{children}</div>;
}

/* Tarjeta seleccionable (checkbox o radio) con aspecto de opcion. */
/*
 * Opcion de una sola o varias respuestas. `bloqueada` (una regla no la
 * permite ahora): se ve atenuada con candado, pero se puede pulsar y llama a
 * `bloqueada()` para explicar por que (pop-up de validacion) en vez de no hacer nada.
 */
export function ChoiceCard({ checked, onChange, label, description, type = "checkbox", name, disabled, bloqueada, invalida }: { checked: boolean; onChange: (checked: boolean) => void; label: ReactNode; description?: ReactNode; type?: "checkbox" | "radio"; name?: string; disabled?: boolean; bloqueada?: () => void; /* La opcion elegida dejo de ser valida: se marca en rojo. */ invalida?: boolean }) {
  return (
    <label
      data-bloqueada={bloqueada ? "true" : undefined}
      className={cn("press flex cursor-pointer items-start gap-3 rounded-box border px-3.5 py-3 transition-colors", invalida ? "border-danger bg-danger-soft/40 ring-1 ring-danger" : checked ? "border-brand bg-brand-faint ring-1 ring-brand" : "border-line bg-surface hover:border-line-strong", disabled && "cursor-not-allowed opacity-60", bloqueada && !checked && "border-dashed bg-surface-2/60 text-ink-3")}
    >
      <input
        type={type}
        name={name}
        disabled={disabled}
        aria-invalid={invalida || undefined}
        aria-disabled={bloqueada ? true : undefined}
        className={cn(type === "radio" ? radioClass : checkboxClass, "mt-0.5")}
        checked={checked}
        onChange={(event) => {
          if (bloqueada && event.target.checked) {
            event.preventDefault();
            bloqueada();
            return;
          }
          onChange(event.target.checked);
        }}
      />
      <span className="flex flex-col gap-0.5">
        <span className={cn("flex items-center gap-1.5 text-base font-medium", bloqueada && !checked ? "text-ink-3" : "text-ink")}>
          {label}
          {bloqueada ? <LockSimple size={13} weight="bold" className="text-ink-4" aria-label="No disponible por ahora" /> : null}
        </span>
        {description ? <span className="text-xs leading-snug text-ink-3">{description}</span> : null}
      </span>
    </label>
  );
}

const slug = (text: string) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* Persona responsable: se elige del personal autorizado (o "Otra persona…") y firma compacta. El cargo sale del rol de la persona (no se captura). Varias se apilan. */
/* id del selector de una PersonCard ("persona-<titulo>"); la firma es "<id>-firma". */
export const personaId = (title: string) => `persona-${slug(title)}`;

export function PersonCard({ title, name, onName, cargo, onCargo, signature, onSignature, disabled = false, requires = "muestras", firmante, onFirmante, firmanteSesion = true, nuevo = false }: { title: string; name: string; onName: (v: string) => void; cargo?: string; onCargo?: (v: string) => void; signature: string; onSignature: (v: string) => void; disabled?: boolean; requires?: PersonaCapacidad; /* Fase 5: firma ligada a una cuenta activa (con contrasena si no es la sesion). */ firmante?: FirmanteState; onFirmante?: (v: FirmanteState) => void; firmanteSesion?: boolean; /* Formato aun sin guardar (el nombre prellenado de la sesion se liga a su cuenta). */ nuevo?: boolean }) {
  const id = `persona-${slug(title)}`;
  return (
    <div className="on-panel grid gap-4 rounded-box bg-surface-2 p-4 ring-1 ring-line md:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <div className="grid gap-3">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-ink-2" htmlFor={id}>
            Nombre
            {firmante && onFirmante ? (
              <FirmanteSelect
                id={id}
                title={title}
                value={firmante}
                nombre={name}
                disabled={disabled}
                porOmisionSesion={firmanteSesion}
                nuevo={nuevo}
                onChange={(value, cuenta) => {
                  onFirmante(value);
                  onName(cuenta?.nombre || "");
                  onCargo?.(cuenta?.cargo || "");
                }}
              />
            ) : (
              <PersonSelect
                id={id}
                value={name}
                onChange={(value, persona) => {
                  onName(value);
                  // Un solo cargo: el rol que le da la capacidad pedida (no la lista de todos sus roles).
                  onCargo?.(persona?.cargos?.[requires] || persona?.roles?.[0] || "");
                }}
                requires={requires}
                disabled={disabled}
              />
            )}
          </label>
          <MensajeCampo id={id} />
          {cargo && !(firmante && onFirmante) ? <p className="text-xs text-ink-3">Cargo: {cargo}</p> : null}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-2">Firma</span>
        <CampoValidado id={`${id}-firma`}>
          <SignaturePad value={signature} onChange={onSignature} disabled={disabled} label={`Firma · ${title}`} compact />
        </CampoValidado>
      </div>
    </div>
  );
}

/* Grupo de campos dentro de una seccion (p. ej. "Blanco", "Material de referencia"). */
export function Panel({ title, description, children, className }: { title?: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("on-panel flex flex-col gap-3 rounded-box bg-surface-2 p-4 ring-1 ring-line", className)}>
      {title ? (
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-semibold text-ink">{title}</p>
          {description ? <p className="text-xs text-ink-3">{description}</p> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/* Constancia de revision, aprobacion o autorizacion: quien, cuando y si sigue pendiente. */
export function SignoffCard({ title, name, cargo, at, note, hint, children }: { title: string; name?: unknown; cargo?: unknown; at?: unknown; note?: unknown; hint?: ReactNode; children?: ReactNode }) {
  const done = !!at;
  // Una fecha sin hora se muestra tal cual (dd/mm/aaaa); un instante, con hora en la zona del laboratorio.
  const when = at ? formatearFechaHora(at, "") : null;
  return (
    <div className={cn("flex gap-3 rounded-card p-4 ring-1", done ? "bg-success-soft/40 ring-success/30" : "bg-surface-2 ring-line")}>
      <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", done ? "bg-success text-on-accent" : "bg-surface-3 text-ink-4")}>{done ? <SealCheck size={16} weight="fill" /> : <Clock size={16} />}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-xs font-medium text-ink-3">{title}</p>
        <p className="truncate text-base font-semibold text-ink">{name ? String(name) : done ? "—" : "Pendiente"}</p>
        <p className="tnum text-xs text-ink-3">{[cargo ? String(cargo) : null, when].filter(Boolean).join(" · ") || (done ? "" : hint || "Aún sin registrar")}</p>
        {note ? <p className="mt-1 text-sm text-ink-2">{String(note)}</p> : null}
        {children}
      </div>
    </div>
  );
}

/* Linea de avance de un registro (borrador → revision → autorizado → liberado → enviado). */
export function FlowSteps({ steps, current, failed }: { steps: { key: string; label: string }[]; current: string; failed?: string }) {
  const index = steps.findIndex((step) => step.key === current);
  return (
    <ol className="flex items-center gap-1 overflow-x-auto pb-1 text-xs" aria-label="Avance del registro">
      {steps.map((step, i) => {
        const done = index >= 0 && i < index;
        const active = i === index;
        return (
          <li key={step.key} className="flex shrink-0 items-center gap-1">
            <span className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition-colors", active ? "bg-brand-soft text-brand-strong ring-1 ring-inset ring-brand/25" : done ? "bg-success-soft text-success-text" : "bg-surface-3 text-ink-3")}>
              {done ? <Check size={11} weight="bold" /> : null}
              {step.label}
            </span>
            {i < steps.length - 1 ? <span className={cn("h-px w-4", done ? "bg-success" : "bg-line-strong")} /> : null}
          </li>
        );
      })}
      {failed ? <li className="ml-1 shrink-0 rounded-full bg-danger-soft px-2.5 py-1 font-medium text-danger">{failed}</li> : null}
    </ol>
  );
}

/* Texto largo en solo lectura: muestra el valor o un guion, sin el hueco de un textarea vacio. */
export function ReadValue({ value, className }: { value: unknown; className?: string }) {
  const text = value === null || value === undefined ? "" : String(value).trim();
  return <p className={cn("min-h-10 whitespace-pre-wrap rounded-field bg-surface-2 px-3 py-2 text-base leading-relaxed", text ? "text-ink" : "text-ink-4", className)}>{text || "—"}</p>;
}
