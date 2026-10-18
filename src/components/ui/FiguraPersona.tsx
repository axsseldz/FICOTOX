"use client";

import { Avatar } from "./Primitives";
import { useBuscarPersona } from "./Figura";
import { cn } from "./cn";

/*
 * Una persona con su figura de perfil, encontrada en el directorio por id,
 * correo o nombre (si no esta, la figura que le toca por su nombre). Con
 * `conNombre` muestra el nombre al lado (pasa de linea si es largo). Para
 * listas: "quien lo hizo", asignados, supervisores, responsables.
 */
export function FiguraPersona({ id, email, nombre, size = "sm", conNombre = false, subtitulo, animado = "al-pasar", className }: { id?: unknown; email?: unknown; nombre?: unknown; size?: "xs" | "sm" | "md" | "lg" | "xl"; conNombre?: boolean; subtitulo?: string; animado?: "siempre" | "al-pasar" | false; className?: string }) {
  const buscar = useBuscarPersona();
  const p = buscar({ id, email, nombre });
  const nombreVisible = String(p?.nombre || nombre || email || "");
  const figura = <Avatar id={p?.id ?? id} name={nombreVisible} email={p?.email || email} avatar={p?.avatar} size={size} animado={animado} className={conNombre ? undefined : cn("ring-2 ring-surface", className)} />;
  if (!conNombre) return <span title={nombreVisible || undefined}>{figura}</span>;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      {figura}
      <span className="flex min-w-0 flex-col">
        <span className="break-words text-[13.5px] leading-tight text-ink">{nombreVisible || "—"}</span>
        {subtitulo ? <span className="text-[12px] text-ink-3">{subtitulo}</span> : null}
      </span>
    </span>
  );
}
