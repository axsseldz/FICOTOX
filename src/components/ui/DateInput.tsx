"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CalendarBlank, CaretLeft, CaretRight } from "@phosphor-icons/react";
import { Popover as RadixPopover } from "radix-ui";
import { cn } from "./cn";
import { controlBase } from "./Field";
import { esFechaSola, fechaSola, fechaValida, formatearFecha, hoyLocal, parsearFechaEscrita, sumarDias, sumarMeses } from "@/lib/shared/fechas";

/*
 * Campo de fecha propio (Fase 3). Siempre muestra y acepta dd/mm/aaaa, sin
 * importar el idioma del navegador; el valor que entrega es "AAAA-MM-DD" (o
 * "" si esta vacio), como antes con <input type="date">. Se puede escribir la
 * fecha (las barras se ponen solas) o elegirla en el calendario, navegable con
 * teclado: flechas, Inicio/Fin (semana), RePag/AvPag (mes), Enter, Escape.
 */

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["L", "M", "X", "J", "V", "S", "D"];
const DIAS_LARGOS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

export interface DateInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  invalid?: boolean;
  /* Variante compacta (32 px) para filas y tablas. */
  small?: boolean;
  /* Limites "AAAA-MM-DD" (los dias fuera quedan deshabilitados en el calendario). */
  min?: string;
  max?: string;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
  autoFocus?: boolean;
}

/* dd/mm/aaaa escrito a medias: solo digitos, con las barras en su lugar. */
function enmascarar(text: string): string {
  const digitos = text.replace(/\D/g, "").slice(0, 8);
  if (digitos.length <= 2) return digitos;
  if (digitos.length <= 4) return `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
  return `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`;
}

const partes = (fecha: string) => fecha.split("-").map(Number) as [number, number, number];
/* Lunes = 0 ... domingo = 6 del primer dia del mes. */
const primerDiaSemana = (anio: number, mes: number) => (new Date(Date.UTC(anio, mes - 1, 1)).getUTCDay() + 6) % 7;
const diasDelMes = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();
const dos = (n: number) => String(n).padStart(2, "0");

export function DateInput({ id, value, onChange, disabled, readOnly, required, invalid, small, min, max, className, placeholder = "dd/mm/aaaa", autoFocus, ...rest }: DateInputProps) {
  const autoId = useId();
  const inputId = id || autoId;
  const valor = esFechaSola(value) ? value : fechaSola(value);
  const [texto, setTexto] = useState(() => (valor ? formatearFecha(valor, "") : ""));
  const [mal, setMal] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const enfocado = useRef(false);

  // El valor externo manda mientras la persona no este escribiendo.
  useEffect(() => {
    if (enfocado.current) return;
    setTexto(valor ? formatearFecha(valor, "") : "");
    setMal(false);
  }, [valor]);

  const entregar = (iso: string) => {
    if (iso !== valor) onChange(iso);
  };

  const escribir = (raw: string) => {
    // Pegado o relleno automatico en "AAAA-MM-DD": se acepta tal cual.
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
      const iso = fechaValida(raw.trim());
      setMal(!iso);
      if (iso) {
        setTexto(formatearFecha(iso, ""));
        entregar(iso);
      } else {
        setTexto(raw.trim());
      }
      return;
    }
    const masked = enmascarar(raw);
    setTexto(masked);
    if (!masked) {
      setMal(false);
      entregar("");
      return;
    }
    if (masked.length === 10) {
      const iso = parsearFechaEscrita(masked);
      setMal(!iso);
      if (iso) entregar(iso);
    } else {
      setMal(false);
    }
  };

  const salir = () => {
    enfocado.current = false;
    if (!texto) {
      setMal(false);
      entregar("");
      return;
    }
    const iso = parsearFechaEscrita(texto);
    if (iso) {
      setMal(false);
      setTexto(formatearFecha(iso, ""));
      entregar(iso);
      return;
    }
    // Texto incompleto o imposible: se vuelve al ultimo valor valido.
    setMal(false);
    setTexto(valor ? formatearFecha(valor, "") : "");
  };

  const elegir = (iso: string) => {
    setTexto(formatearFecha(iso, ""));
    setMal(false);
    entregar(iso);
    setAbierto(false);
  };

  const bloqueado = disabled || readOnly;
  return (
    <div className={cn("relative", className)}>
      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={texto}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        autoFocus={autoFocus}
        aria-label={rest["aria-label"]}
        aria-invalid={invalid || mal || undefined}
        maxLength={10}
        onFocus={() => {
          enfocado.current = true;
        }}
        onChange={(event) => escribir(event.target.value)}
        onBlur={salir}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && event.altKey && !bloqueado) {
            event.preventDefault();
            setAbierto(true);
          }
        }}
        className={cn(controlBase, small ? "h-8 text-[13px]" : "h-10 text-[14px]", "tnum pr-9", (invalid || mal) && "border-danger focus:border-danger")}
      />
      <RadixPopover.Root open={abierto} onOpenChange={setAbierto}>
        <RadixPopover.Trigger asChild>
          <button type="button" disabled={bloqueado} aria-label="Abrir calendario" aria-haspopup="dialog" className={cn("press absolute inset-y-0 right-1.5 my-auto flex h-7 w-7 items-center justify-center rounded-[8px] text-ink-3 hover:bg-surface-3 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50", small && "h-6 w-6")}>
            <CalendarBlank size={small ? 14 : 16} />
          </button>
        </RadixPopover.Trigger>
        <RadixPopover.Portal>
          <RadixPopover.Content align="end" sideOffset={6} collisionPadding={12} onOpenAutoFocus={(event) => event.preventDefault()} className="bg-popover border border-line z-[var(--z-popover)] origin-[var(--radix-popover-content-transform-origin)] rounded-[16px] p-3 shadow-panel outline-none data-[state=open]:animate-materialize data-[state=closed]:animate-dematerialize">
            {abierto ? <Calendario valor={valor} min={min} max={max} onElegir={elegir} onCerrar={() => setAbierto(false)} /> : null}
          </RadixPopover.Content>
        </RadixPopover.Portal>
      </RadixPopover.Root>
    </div>
  );
}

/* Rejilla mensual con foco movil (un solo dia tabulable). */
function Calendario({ valor, min, max, onElegir, onCerrar }: { valor: string; min?: string; max?: string; onElegir: (iso: string) => void; onCerrar: () => void }) {
  const hoy = hoyLocal();
  const [foco, setFoco] = useState(valor || hoy);
  const [anio, mes] = partes(foco);
  const rejilla = useRef<HTMLDivElement>(null);
  const [vista, setVista] = useState<"dias" | "meses" | "anios">("dias");

  // Al abrir, el foco de teclado va al dia elegido (o a hoy).
  useEffect(() => {
    rejilla.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus();
  }, [foco, vista]);

  const fuera = (iso: string) => (!!min && iso < min) || (!!max && iso > max);
  const mover = (iso: string) => {
    if (iso) setFoco(iso);
  };
  const teclado = (event: KeyboardEvent<HTMLDivElement>) => {
    const mapa: Record<string, () => void> = {
      ArrowLeft: () => mover(sumarDias(foco, -1)),
      ArrowRight: () => mover(sumarDias(foco, 1)),
      ArrowUp: () => mover(sumarDias(foco, -7)),
      ArrowDown: () => mover(sumarDias(foco, 7)),
      Home: () => mover(sumarDias(foco, -((primerDiaSemana(anio, mes) + partes(foco)[2] - 1) % 7))),
      End: () => mover(sumarDias(foco, 6 - ((primerDiaSemana(anio, mes) + partes(foco)[2] - 1) % 7))),
      PageUp: () => mover(sumarMeses(foco, event.shiftKey ? -12 : -1)),
      PageDown: () => mover(sumarMeses(foco, event.shiftKey ? 12 : 1)),
      Enter: () => {
        if (!fuera(foco)) onElegir(foco);
      },
      " ": () => {
        if (!fuera(foco)) onElegir(foco);
      },
      Escape: onCerrar,
    };
    const accion = mapa[event.key];
    if (accion) {
      event.preventDefault();
      accion();
    }
  };

  const celdas: Array<string | null> = [];
  for (let i = 0; i < primerDiaSemana(anio, mes); i += 1) celdas.push(null);
  for (let d = 1; d <= diasDelMes(anio, mes); d += 1) celdas.push(`${anio}-${dos(mes)}-${dos(d)}`);
  while (celdas.length % 7) celdas.push(null);

  const boton = "press flex h-8 w-8 items-center justify-center rounded-[8px] text-[13px] tnum";
  return (
    <div className="flex w-[268px] flex-col gap-2" role="dialog" aria-label="Calendario">
      <div className="flex items-center justify-between gap-1">
        <button type="button" onClick={() => setFoco(sumarMeses(foco, -1))} aria-label="Mes anterior" className={cn(boton, "text-ink-3 hover:bg-surface-3 hover:text-ink")}>
          <CaretLeft size={14} weight="bold" />
        </button>
        <div className="flex items-center gap-1 text-[13.5px] font-medium text-ink">
          <button type="button" onClick={() => setVista(vista === "meses" ? "dias" : "meses")} className="press rounded-[8px] px-2 py-1 capitalize hover:bg-surface-3" aria-label="Elegir mes">
            {MESES[mes - 1]}
          </button>
          <button type="button" onClick={() => setVista(vista === "anios" ? "dias" : "anios")} className="press rounded-[8px] px-2 py-1 tnum hover:bg-surface-3" aria-label="Elegir año">
            {anio}
          </button>
        </div>
        <button type="button" onClick={() => setFoco(sumarMeses(foco, 1))} aria-label="Mes siguiente" className={cn(boton, "text-ink-3 hover:bg-surface-3 hover:text-ink")}>
          <CaretRight size={14} weight="bold" />
        </button>
      </div>
      {vista === "meses" ? (
        <div className="grid grid-cols-3 gap-1" role="listbox" aria-label="Meses">
          {MESES.map((nombre, i) => (
            <button key={nombre} type="button" role="option" aria-selected={i + 1 === mes} onClick={() => { setFoco(`${anio}-${dos(i + 1)}-${dos(Math.min(partes(foco)[2], diasDelMes(anio, i + 1)))}`); setVista("dias"); }} className={cn("press rounded-[8px] px-2 py-1.5 text-[13px] capitalize hover:bg-surface-3", i + 1 === mes && "bg-brand-faint text-brand")}>
              {nombre.slice(0, 3)}
            </button>
          ))}
        </div>
      ) : vista === "anios" ? (
        <div className="grid max-h-[212px] grid-cols-4 gap-1 overflow-y-auto" role="listbox" aria-label="Años">
          {Array.from({ length: 41 }, (_, i) => anio - 20 + i).map((a) => (
            <button key={a} type="button" role="option" aria-selected={a === anio} onClick={() => { setFoco(`${a}-${dos(mes)}-${dos(Math.min(partes(foco)[2], diasDelMes(a, mes)))}`); setVista("dias"); }} className={cn("press rounded-[8px] px-2 py-1.5 text-[13px] tnum hover:bg-surface-3", a === anio && "bg-brand-faint text-brand")}>
              {a}
            </button>
          ))}
        </div>
      ) : (
        <div ref={rejilla} role="grid" aria-label={`${MESES[mes - 1]} de ${anio}`} onKeyDown={teclado}>
          <div role="row" className="grid grid-cols-7">
            {DIAS.map((d, i) => (
              <span key={d} role="columnheader" aria-label={DIAS_LARGOS[i]} className="flex h-7 items-center justify-center text-[11.5px] font-medium uppercase text-ink-4">
                {d}
              </span>
            ))}
          </div>
          {Array.from({ length: celdas.length / 7 }, (_, fila) => (
            <div key={fila} role="row" className="grid grid-cols-7">
              {celdas.slice(fila * 7, fila * 7 + 7).map((iso, i) =>
                iso ? (
                  <button
                    key={iso}
                    type="button"
                    role="gridcell"
                    tabIndex={iso === foco ? 0 : -1}
                    aria-selected={iso === valor}
                    aria-current={iso === hoy ? "date" : undefined}
                    aria-disabled={fuera(iso) || undefined}
                    aria-label={`${Number(iso.slice(8))} de ${MESES[mes - 1]} de ${anio}`}
                    onClick={() => !fuera(iso) && onElegir(iso)}
                    onFocus={() => setFoco(iso)}
                    className={cn(boton, "mx-auto", iso === valor ? "bg-brand text-on-accent" : iso === hoy ? "font-semibold text-brand hover:bg-surface-3" : "text-ink hover:bg-surface-3", fuera(iso) && "cursor-not-allowed text-ink-4 hover:bg-transparent")}
                  >
                    {Number(iso.slice(8))}
                  </button>
                ) : (
                  <span key={`v${fila}-${i}`} role="gridcell" aria-hidden="true" className="h-8 w-8" />
                ),
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between border-t border-line pt-2 text-[12.5px]">
        <button type="button" onClick={() => !fuera(hoy) && onElegir(hoy)} className="press rounded-[8px] px-2 py-1 text-brand hover:bg-brand-faint">
          Hoy
        </button>
        <button type="button" onClick={() => onElegir("")} className="press rounded-[8px] px-2 py-1 text-ink-3 hover:bg-surface-3">
          Borrar
        </button>
      </div>
    </div>
  );
}
