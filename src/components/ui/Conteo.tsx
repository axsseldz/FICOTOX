"use client";

import { useEffect, useRef, useState } from "react";
import { fmt } from "@/lib/client/format";
import { cn } from "./cn";

/*
 * Numero con animacion de conteo: sube (o baja) desde el valor anterior al
 * nuevo con una curva suave, sin rebote. Al actualizarse los datos el numero
 * cambia sin parpadear. Con prefers-reduced-motion aparece directo. El texto
 * visible es decorativo: quien lo usa da la etiqueta para lectores de pantalla.
 */
export function Conteo({ valor, className, duracion = 700 }: { valor: number; className?: string; duracion?: number }) {
  const [mostrado, setMostrado] = useState(0);
  const actual = useRef(0);
  useEffect(() => {
    const inicio = actual.current;
    const reducir = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let id = 0;
    if (reducir || inicio === valor) {
      actual.current = valor;
      id = requestAnimationFrame(() => setMostrado(valor));
      return () => cancelAnimationFrame(id);
    }
    const t0 = performance.now();
    const paso = (t: number) => {
      const p = Math.min(1, (t - t0) / duracion);
      const suave = 1 - Math.pow(1 - p, 3);
      const v = Math.round(inicio + (valor - inicio) * suave);
      actual.current = v;
      setMostrado(v);
      if (p < 1) id = requestAnimationFrame(paso);
    };
    id = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(id);
  }, [valor, duracion]);
  return (
    <span aria-hidden="true" className={cn("tnum", className)}>
      {fmt(mostrado)}
    </span>
  );
}

/* Marca de verificacion que se dibuja sola (estado vacio "Todo al día"). */
export function MarcaDibujada({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 56 56" aria-hidden="true" className={cn("h-14 w-14", className)}>
      <circle cx="28" cy="28" r="25" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
      <circle cx="28" cy="28" r="25" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="trazo-dibujado" style={{ ["--largo" as string]: 158, transform: "rotate(-90deg)", transformOrigin: "center" }} />
      <path d="M18 29l7 7 13-15" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="trazo-dibujado" style={{ ["--largo" as string]: 34, ["--retraso" as string]: "420ms" }} />
    </svg>
  );
}
