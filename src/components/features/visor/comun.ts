"use client";

import { useEffect, useState } from "react";

/* Pantalla amplia (panel de informacion al lado) o angosta (panel en hoja). */
export function useAncho(minimo: number): boolean {
  const [ancho, setAncho] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${minimo}px)`);
    const cambiar = () => setAncho(mq.matches);
    cambiar();
    mq.addEventListener("change", cambiar);
    return () => mq.removeEventListener("change", cambiar);
  }, [minimo]);
  return ancho;
}

/* Al imprimir desde un visor, solo su contenido. */
export const ESTILOS_IMPRESION = `
@media print {
  body * { visibility: hidden !important; }
  [data-visor-contenido], [data-visor-contenido] * { visibility: visible !important; }
  [data-visor-contenido] { position: absolute !important; inset: 0 auto auto 0 !important; width: 100% !important; height: auto !important; overflow: visible !important; }
  [data-visor-contenido] .scroll-thin { overflow: visible !important; height: auto !important; }
}
`;
