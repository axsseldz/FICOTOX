import { instanteDe } from "@/lib/shared/fechas";

/*
 * Tiempo relativo corto para listas y tarjetas de datos rapidos: "Hace un
 * momento", "Hace 45 min", "Hace 2 h", "Ayer", "Hace 4 días", "Hace 2 meses".
 * Nunca se recorta: es corto por diseño.
 */
export function haceCuantoCorto(value: unknown, ahora = new Date()): string {
  const date = value instanceof Date ? value : instanteDe(value);
  if (!date) return "—";
  const seg = Math.max(0, Math.round((ahora.getTime() - date.getTime()) / 1000));
  if (seg < 60) return "Hace un momento";
  const min = Math.round(seg / 60);
  if (min < 60) return `Hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `Hace ${h} h`;
  const dias = Math.round(h / 24);
  if (dias === 1) return "Ayer";
  if (dias < 31) return `Hace ${dias} días`;
  const meses = Math.round(dias / 30);
  if (meses < 12) return meses === 1 ? "Hace 1 mes" : `Hace ${meses} meses`;
  const anios = Math.round(meses / 12);
  return anios === 1 ? "Hace 1 año" : `Hace ${anios} años`;
}
