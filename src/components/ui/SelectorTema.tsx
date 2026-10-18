"use client";

import { Check, Moon, Sun } from "@phosphor-icons/react";
import { useSession } from "@/components/session/SessionProvider";
import { elegirTema, temaOpuesto, useTema, type Tema } from "@/lib/client/tema";
import { cn } from "./cn";

/*
 * Apariencia (Mi cuenta): tres tarjetas con una mini vista previa de cada
 * tema. Las vistas previas usan los colores fijos de cada tema (son una
 * muestra de como se ve, no dependen del tema actual).
 */

const MUESTRA = {
  claro: { lienzo: "#f2f4f7", barra: "#f7f8fa", tarjeta: "#ffffff", linea: "#e3e8ed", texto: "#10202b", tenue: "#cdd5dd", acento: "#0f7a95" },
  oscuro: { lienzo: "#0c1319", barra: "#0f171e", tarjeta: "#141d25", linea: "#243039", texto: "#e4ebf0", tenue: "#33424d", acento: "#42abc6" },
} as const;

function MiniVista({ tema }: { tema: "claro" | "oscuro" }) {
  const c = MUESTRA[tema];
  return (
    <span aria-hidden="true" className="flex h-full w-full overflow-hidden" style={{ background: c.lienzo }}>
      <span className="flex w-[26%] flex-col gap-1 p-1.5" style={{ background: c.barra, borderRight: `1px solid ${c.linea}` }}>
        <span className="h-1.5 w-3/4 rounded-full" style={{ background: c.acento }} />
        <span className="h-1 w-full rounded-full" style={{ background: c.tenue }} />
        <span className="h-1 w-2/3 rounded-full" style={{ background: c.tenue }} />
      </span>
      <span className="flex flex-1 flex-col gap-1.5 p-2">
        <span className="h-1.5 w-1/2 rounded-full" style={{ background: c.texto }} />
        <span className="flex flex-1 flex-col gap-1 rounded-[5px] p-1.5" style={{ background: c.tarjeta, boxShadow: `0 0 0 1px ${c.linea}` }}>
          <span className="h-1 w-full rounded-full" style={{ background: c.tenue }} />
          <span className="h-1 w-4/5 rounded-full" style={{ background: c.tenue }} />
          <span className="mt-auto h-2 w-8 rounded-full" style={{ background: c.acento }} />
        </span>
      </span>
    </span>
  );
}

const OPCIONES: Array<{ valor: Tema; label: string }> = [
  { valor: "claro", label: "Claro" },
  { valor: "oscuro", label: "Oscuro" },
  { valor: "auto", label: "Automático" },
];

export function SelectorTema() {
  const { token } = useSession();
  const { tema } = useTema();
  return (
    <div role="radiogroup" aria-label="Apariencia" className="grid grid-cols-3 gap-2.5">
      {OPCIONES.map((o) => {
        const activa = tema === o.valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={activa}
            onClick={() => elegirTema(o.valor, token)}
            className={cn("press group flex flex-col gap-2 rounded-card p-1.5 text-left ring-1 transition-shadow duration-200 hover:shadow-raised focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none", activa ? "ring-2 ring-brand" : "ring-line")}
          >
            <span className="relative block aspect-[4/3] w-full overflow-hidden rounded-[10px]">
              {o.valor === "auto" ? (
                <span className="absolute inset-0 flex">
                  <span className="w-1/2 overflow-hidden">
                    <span className="block h-full w-[200%]">
                      <MiniVista tema="claro" />
                    </span>
                  </span>
                  <span className="relative w-1/2 overflow-hidden">
                    <span className="absolute inset-y-0 right-0 block h-full w-[200%]">
                      <MiniVista tema="oscuro" />
                    </span>
                  </span>
                </span>
              ) : (
                <MiniVista tema={o.valor} />
              )}
              {activa ? (
                <span className="absolute right-1 bottom-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-on-accent shadow-card animate-pop-in motion-reduce:animate-none">
                  <Check size={12} weight="bold" />
                </span>
              ) : null}
            </span>
            <span className={cn("px-1 pb-0.5 text-[13px] font-medium", activa ? "text-brand-strong" : "text-ink-2")}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* Acceso rapido del menu de la cuenta: alterna entre Claro y Oscuro. */
export function useAlternarTema() {
  const { token } = useSession();
  const { resuelto } = useTema();
  return {
    oscuro: resuelto === "dark",
    alternar: () => elegirTema(temaOpuesto(), token),
    icono: resuelto === "dark" ? <Sun size={16} /> : <Moon size={16} />,
    etiqueta: resuelto === "dark" ? "Tema claro" : "Tema oscuro",
  };
}
