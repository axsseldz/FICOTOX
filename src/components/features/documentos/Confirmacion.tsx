"use client";

import { useEffect, useState } from "react";
import { MarcaDibujada } from "@/components/ui/Conteo";

/*
 * Confirmacion breve con check animado al publicar, autorizar o confirmar la
 * lectura, ademas del aviso de siempre (toast). Aparece al centro, sin bloquear
 * la pagina, y se va sola. Con prefers-reduced-motion no anima: se muestra fija
 * el mismo tiempo y desaparece.
 */
const EVENTO = "ficotox:sgc-confirmacion";

export function confirmarConCheck(texto: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENTO, { detail: texto }));
}

export function ConfirmacionCheck() {
  const [aviso, setAviso] = useState<{ texto: string; n: number } | null>(null);
  useEffect(() => {
    let t = 0;
    const mostrar = (e: Event) => {
      window.clearTimeout(t);
      setAviso((prev) => ({ texto: String((e as CustomEvent<string>).detail), n: (prev?.n || 0) + 1 }));
      t = window.setTimeout(() => setAviso(null), 1400);
    };
    window.addEventListener(EVENTO, mostrar);
    return () => {
      window.removeEventListener(EVENTO, mostrar);
      window.clearTimeout(t);
    };
  }, []);
  if (!aviso) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[var(--z-toast,70)] flex items-center justify-center" aria-hidden="true">
      <div key={aviso.n} className="confirmacion-check flex flex-col items-center gap-2 rounded-panel bg-surface-elevated/95 px-7 py-5 text-success shadow-panel backdrop-blur-md" data-testid="confirmacion-check">
        <MarcaDibujada />
        <span className="text-base font-semibold text-ink">{aviso.texto}</span>
      </div>
    </div>
  );
}
