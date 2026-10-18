"use client";

import type { ReactNode } from "react";
import { Popover as RadixPopover } from "radix-ui";
import { SlidersHorizontal } from "@phosphor-icons/react";
import { cn } from "./cn";

/*
 * Menu de filtros compacto: un boton "Filtros" con el numero de filtros
 * activos y un panel con secciones tituladas en las que cada opcion es un
 * interruptor. Arriba va siempre "Vista" (Mis muestras, Mostrar anuladas…);
 * despues, un grupo por filtro de la lista (Estado, Aceptación, Análisis…).
 *
 * Los grupos siguen siendo de una sola opcion: encender un interruptor apaga
 * los demas del grupo y apagarlo vuelve al valor por omision ("Todas"), asi
 * cada lista filtra exactamente igual que antes. La opcion por omision no se
 * dibuja (todo apagado = sin filtro). Las opciones `disabled` se muestran en
 * gris con su nota ("Proximamente").
 */

interface FilterOption<T extends string = string> {
  value: T;
  label: ReactNode;
  count?: number | null;
  disabled?: boolean;
  hint?: ReactNode;
  tone?: "neutral" | "warning" | "danger";
}

export interface FilterGroup<T extends string = string> {
  key: string;
  label: string;
  value: T;
  /* Valor que cuenta como "sin filtro" (normalmente el primero). */
  defaultValue: T;
  options: FilterOption<T>[];
  onChange: (value: T) => void;
  /* Muestra tambien la opcion por omision (p. ej. "Últimos 30 días"), encendida cuando no hay otra. */
  showDefault?: boolean;
  /* Contenido debajo de las opciones (p. ej. las fechas de "Personalizado"). */
  extra?: ReactNode;
}

export interface FilterToggle {
  key: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /* Seccion donde se muestra; por omision "Vista". Si coincide con el titulo de un grupo, se agrega al final de ese grupo. */
  group?: string;
}

const VISTA = "Vista";

/* Cada opción muestra solo su nombre (sin conteo ni texto de ayuda); "Próximamente" si aún no está disponible. */
function FilterSwitchRow({ label, hint, checked, disabled, onChange }: { label: ReactNode; hint?: ReactNode; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={typeof label === "string" ? label : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("press flex min-h-9 w-full items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-left text-[13.5px]", disabled ? "cursor-not-allowed text-ink-4" : checked ? "text-ink" : "text-ink-2 hover:bg-surface-3/80 hover:text-ink")}
    >
      <span className={cn("min-w-0 flex-1 truncate", checked && "font-medium")}>{label}</span>
      {hint ? <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-ink-4">{hint}</span> : null}
      <span aria-hidden="true" className={cn("relative h-[20px] w-[34px] shrink-0 rounded-full transition-colors duration-200 ease-[var(--ease-spring)]", checked ? "bg-success" : "bg-line-strong", disabled && "opacity-50")}>
        <span className={cn("absolute top-[2px] left-[2px] h-[16px] w-[16px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform duration-200 ease-[var(--ease-spring)]", checked && "translate-x-[14px]")} />
      </span>
    </button>
  );
}

function FilterSection({ title, children, first }: { title: string; children: ReactNode; first?: boolean }) {
  return (
    <section aria-label={title} className={cn("flex flex-col", !first && "border-t border-line pt-2.5")}>
      <p className="eyebrow px-2 pb-1 text-ink-3">{title}</p>
      {children}
    </section>
  );
}

export function FilterMenu({ groups = [], toggles = [], children, className, label = "Filtros", vistaAlFinal = false, gruposFinales = [], gruposAntesDeVista = [] }: { groups?: FilterGroup[]; toggles?: FilterToggle[]; children?: ReactNode; className?: string; label?: string; vistaAlFinal?: boolean; gruposFinales?: FilterGroup[]; gruposAntesDeVista?: FilterGroup[] }) {
  // `gruposFinales` (p. ej. "Ordenar por") van despues de las demas secciones; `gruposAntesDeVista` (con `vistaAlFinal`) justo antes de "Vista".
  const todosGrupos = [...groups, ...gruposAntesDeVista, ...gruposFinales];
  const active = todosGrupos.filter((g) => g.value !== g.defaultValue).length + toggles.filter((t) => t.checked).length;
  const reset = () => {
    todosGrupos.forEach((g) => g.onChange(g.defaultValue));
    toggles.forEach((t) => t.onChange(false));
  };
  const groupLabels = new Set(todosGrupos.map((g) => g.label));
  const togglesOf = (section: string) => toggles.filter((t) => (t.group || VISTA) === section);
  /* Secciones de interruptores sueltos que no coinciden con ningun grupo ("Vista" siempre primero). */
  const sueltas = [...new Set(toggles.map((t) => t.group || VISTA))].filter((s) => !groupLabels.has(s)).sort((a, b) => (a === VISTA ? -1 : b === VISTA ? 1 : 0));
  // "Vista" va primero, salvo que la lista pida mostrarla al final (Auditoría).
  const vista = vistaAlFinal ? [] : sueltas.filter((s) => s === VISTA);
  const otras = vistaAlFinal ? [...sueltas.filter((s) => s !== VISTA), ...sueltas.filter((s) => s === VISTA)] : sueltas.filter((s) => s !== VISTA);
  const toggleRow = (toggle: FilterToggle) => <FilterSwitchRow key={toggle.key} label={toggle.label} checked={toggle.checked} onChange={toggle.onChange} />;
  let index = 0;
  const grupo = (group: FilterGroup) => (
    <FilterSection key={group.key} title={group.label} first={index++ === 0}>
      {group.options
        .filter((option) => group.showDefault || option.value !== group.defaultValue)
        .map((option) => (
          <FilterSwitchRow
            key={option.value}
            label={option.label}
            hint={option.hint}
            disabled={option.disabled}
            checked={option.value === group.value}
            onChange={(checked) => group.onChange(checked ? option.value : group.defaultValue)}
          />
        ))}
      {togglesOf(group.label).map(toggleRow)}
      {group.extra ? <div className="px-2 pt-1.5 pb-1">{group.extra}</div> : null}
    </FilterSection>
  );
  return (
    <RadixPopover.Root>
      <RadixPopover.Trigger asChild>
        <button type="button" className={cn("press inline-flex h-10 items-center gap-2 rounded-full bg-surface px-3.5 text-[13px] font-medium text-ink-2 shadow-card hover:text-ink data-[state=open]:bg-surface-3 data-[state=open]:text-ink", active > 0 && "text-ink", className)} aria-label={active ? `${label} (${active} activos)` : label}>
          <SlidersHorizontal size={16} />
          {label}
          {active > 0 ? <span className="tnum flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-on-accent">{active}</span> : null}
        </button>
      </RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content align="start" sideOffset={8} collisionPadding={12} className="bg-popover border border-line z-[var(--z-popover)] flex max-h-[min(var(--radix-popover-content-available-height),640px)] w-[min(320px,calc(100vw-24px))] origin-[var(--radix-popover-content-transform-origin)] flex-col rounded-[16px] p-2 shadow-pop outline-none data-[state=open]:animate-materialize">
          <div className="flex shrink-0 items-center justify-between gap-2 px-2 pt-0.5 pb-2">
            <p className="text-[13px] font-semibold text-ink">
              {label}
              {active > 0 ? <span className="tnum ml-1.5 font-normal text-ink-3">· {active} {active === 1 ? "activo" : "activos"}</span> : null}
            </p>
            <button type="button" onClick={reset} disabled={active === 0} className="press h-7 rounded-[8px] px-2 text-[12.5px] font-medium text-brand hover:bg-brand-faint disabled:cursor-default disabled:text-ink-4 disabled:hover:bg-transparent">
              Limpiar filtros
            </button>
          </div>
          <div className="scroll-thin flex min-h-0 flex-col gap-2.5 overflow-y-auto">
            {vista.map((section) => (
              <FilterSection key={section} title={section} first={index++ === 0}>
                {togglesOf(section).map(toggleRow)}
              </FilterSection>
            ))}
            {groups.map((group) => grupo(group))}
            {otras.filter((section) => section !== VISTA || !gruposAntesDeVista.length).map((section) => (
              <FilterSection key={section} title={section} first={index++ === 0}>
                {togglesOf(section).map(toggleRow)}
              </FilterSection>
            ))}
            {gruposAntesDeVista.map((group) => grupo(group))}
            {gruposAntesDeVista.length ? otras.filter((section) => section === VISTA).map((section) => (
              <FilterSection key={section} title={section} first={index++ === 0}>
                {togglesOf(section).map(toggleRow)}
              </FilterSection>
            )) : null}
            {gruposFinales.map((group) => grupo(group))}
            {children ? <div className={cn("flex flex-col gap-3 px-2", index > 0 && "border-t border-line pt-3")}>{children}</div> : null}
          </div>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

/* Resumen de filtros activos para mostrar junto al boton (chips). */
export function FilterChips({ groups = [], toggles = [] }: { groups?: FilterGroup[]; toggles?: FilterToggle[] }) {
  const chips: Array<{ key: string; label: ReactNode; clear: () => void }> = [];
  for (const g of groups) {
    if (g.value !== g.defaultValue) {
      const option = g.options.find((o) => o.value === g.value);
      chips.push({ key: g.key, label: option?.label || g.value, clear: () => g.onChange(g.defaultValue) });
    }
  }
  for (const t of toggles) if (t.checked) chips.push({ key: t.key, label: t.label, clear: () => t.onChange(false) });
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <button key={chip.key} type="button" onClick={chip.clear} className="press inline-flex h-7 items-center gap-1 rounded-full bg-brand-soft pr-2 pl-2.5 text-[12.5px] font-medium text-brand-strong hover:bg-brand-soft/70" aria-label={`Quitar filtro ${String(chip.label)}`}>
          {chip.label}
          <span aria-hidden="true" className="text-brand">×</span>
        </button>
      ))}
    </div>
  );
}
