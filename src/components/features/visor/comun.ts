"use client";

/* Al imprimir desde un visor, solo su contenido. */
export const ESTILOS_IMPRESION = `
@media print {
  body * { visibility: hidden !important; }
  [data-visor-contenido], [data-visor-contenido] * { visibility: visible !important; }
  [data-visor-contenido] { position: absolute !important; inset: 0 auto auto 0 !important; width: 100% !important; height: auto !important; overflow: visible !important; }
  [data-visor-contenido] .scroll-thin { overflow: visible !important; height: auto !important; }
}
`;
