/* Utilidades de formato identicas a las de el app.js de la interfaz original. */
import { fechaSola, formatearFecha, formatearFechaHora, hoyLocal, tonoVencimiento } from "../shared/fechas";

/* "1 recepción" / "2 recepciones". */
export const contar = (n: number, uno: string, varios: string): string => `${fmt(n)} ${n === 1 ? uno : varios}`;

export const fmt = (value: unknown): string => {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric.toLocaleString("es-MX") : "0";
};

/*
 * Fechas (Fase 3): todo delega en src/lib/shared/fechas.ts. Una fecha sola
 * ("AAAA-MM-DD") nunca pasa por `new Date`; un instante se muestra en la zona
 * del laboratorio. fmtDate -> dd/mm/aaaa ("-" si no hay).
 */
export const fmtDate = (value: unknown): string => formatearFecha(value, "-");

/* dd/mm/aaaa HH:mm en la zona del laboratorio (bitacora, creado_en, bloqueos). */
export const fmtDateTime = (value: unknown): string => formatearFechaHora(value, "-");

export const parseNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const parseIntOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const num = Number.parseInt(String(value), 10);
  return Number.isFinite(num) ? num : null;
};

export const parseFloatOrNull = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

/* "AAAA-MM-DD" de cualquier valor (fecha sola tal cual; instante -> dia local del laboratorio). */
export const isoDate = (value: unknown): string => fechaSola(value);

export const normalizeText = (value: unknown): string => String(value || "").toLowerCase();

/* Hoy (AAAA-MM-DD) en la zona del laboratorio. */
export const todayIso = (): string => hoyLocal();

/*
 * Tono de una fecha limite (caducidad, calibracion): "danger" si ya paso,
 * "warning" si vence en los proximos `days` dias. Por dia local del laboratorio.
 */
export const deadlineTone = (value: unknown, days = 30): "danger" | "warning" | null => tonoVencimiento(value, days);
