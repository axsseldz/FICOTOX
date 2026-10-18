/* Folios de los registros: "<prefijo> 0000123" (siete dígitos). Única implementación para cliente y servidor. */
export const numeroFolio = (n: unknown): string => String(Number(n) || 0).padStart(7, "0");

export const formatearFolio = (prefijo: string, n: unknown): string => `${prefijo} ${numeroFolio(n)}`;
