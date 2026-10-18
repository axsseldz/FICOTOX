"use client";

import type { ReactNode } from "react";
import { ArrowRight, ArrowsLeftRight, ClockCounterClockwise, Cube, Eye, FileText, Flask, IdentificationBadge, ListChecks, Package, Plus, Question, Stamp, TestTube, User, Warning, WarningDiamond, Wrench, X } from "@phosphor-icons/react";
import { cn } from "@/components/ui/cn";
import { norm, type TipoResultado } from "@/lib/shared/busqueda";

/* Fila de resultado de la búsqueda universal: la misma en el Inicio y en la ventana ⌘K. */

const ICONO: Record<TipoResultado, ReactNode> = {
  muestra: <TestTube size={17} />,
  analisis: <TestTube size={17} weight="fill" />,
  informe: <FileText size={17} weight="fill" />,
  reactivo: <Flask size={17} />,
  consumible: <Package size={17} />,
  equipo: <Cube size={17} />,
  mantenimiento: <Wrench size={17} />,
  movimiento: <ArrowsLeftRight size={17} />,
  incidencia: <Warning size={17} />,
  nc: <WarningDiamond size={17} />,
  accion_correctiva: <ListChecks size={17} />,
  documento: <FileText size={17} />,
  persona: <User size={17} />,
  rol: <IdentificationBadge size={17} />,
  solicitud: <Stamp size={17} />,
  supervision: <Eye size={17} />,
  pantalla: <ArrowRight size={17} />,
  accion: <Plus size={17} weight="bold" />,
  ayuda: <Question size={17} />,
};

const iconoDeConsulta = <ClockCounterClockwise size={17} />;
const iconoDeTipo = (tipo: TipoResultado | null | undefined): ReactNode => (tipo ? ICONO[tipo] : iconoDeConsulta);

const TONO: Partial<Record<TipoResultado, string>> = {
  accion: "bg-brand-soft text-brand-strong",
  ayuda: "bg-bloom-soft text-bloom",
};

/* Resalta en `texto` las palabras de `consulta` (sin importar mayúsculas ni acentos). */
function Resaltado({ texto, consulta }: { texto: string; consulta?: string }) {
  // Con menos de 2 caracteres no se resalta, y tampoco palabras sueltas de una letra.
  const terminos = norm(consulta || "").trim().length >= 2 ? norm(consulta || "").split(/[\s,;]+/).filter((t) => t.length >= 2) : [];
  if (!terminos.length) return <>{texto}</>;
  // Texto normalizado carácter a carácter, para que los índices coincidan con el original.
  const letras = Array.from(texto);
  let plano = "";
  const origen: number[] = [];
  letras.forEach((letra, i) => {
    const n = norm(letra);
    for (let k = 0; k < n.length; k++) origen.push(i);
    plano += n;
  });
  const marcada = new Array<boolean>(letras.length).fill(false);
  for (const termino of terminos) {
    let en = plano.indexOf(termino);
    while (en !== -1) {
      for (let k = en; k < en + termino.length; k++) marcada[origen[k]] = true;
      en = plano.indexOf(termino, en + termino.length);
    }
  }
  if (!marcada.some(Boolean)) return <>{texto}</>;
  const partes: ReactNode[] = [];
  let i = 0;
  while (i < letras.length) {
    let j = i;
    while (j < letras.length && marcada[j] === marcada[i]) j++;
    const trozo = letras.slice(i, j).join("");
    partes.push(
      marcada[i] ? (
        <mark key={i} className="bg-transparent font-semibold text-inherit underline decoration-brand/60 decoration-[1.5px] underline-offset-[3px]">
          {trozo}
        </mark>
      ) : (
        trozo
      ),
    );
    i = j;
  }
  return <>{partes}</>;
}

export interface FilaBusqueda {
  tipo: TipoResultado | null;
  titulo: string;
  sub?: string | null;
  mono?: boolean;
  etiqueta?: string;
}

export function BusquedaFila({ fila, consulta, onQuitar, className }: { fila: FilaBusqueda; consulta?: string; onQuitar?: () => void; className?: string }) {
  return (
    <div className={cn("flex cursor-pointer items-center gap-3 px-2.5 py-2 text-[14px]", className)}>
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-surface-3 text-ink-2 transition-colors group-data-[selected=true]:bg-brand-soft group-data-[selected=true]:text-brand-strong", fila.tipo ? TONO[fila.tipo] : undefined)}>{iconoDeTipo(fila.tipo)}</span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className={cn("truncate font-medium", fila.mono && "code")}>
          <Resaltado texto={fila.titulo} consulta={consulta} />
        </span>
        {fila.sub ? (
          <span className="truncate text-[12.5px] text-ink-3">
            <Resaltado texto={fila.sub} consulta={consulta} />
          </span>
        ) : null}
      </span>
      {fila.etiqueta ? <span className="hidden shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-ink-3 sm:inline">{fila.etiqueta}</span> : null}
      {onQuitar ? (
        <button
          type="button"
          aria-label="Quitar de recientes"
          title="Quitar de recientes"
          tabIndex={-1}
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            onQuitar();
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-4 opacity-60 transition-[opacity,background-color] hover:bg-surface-3 hover:text-ink"
        >
          <X size={12} weight="bold" />
        </button>
      ) : null}
    </div>
  );
}
