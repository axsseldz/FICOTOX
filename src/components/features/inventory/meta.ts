import type { Tone } from "@/components/ui/Primitives";

export const EQUIPO_ESTADOS: Array<{ value: string; label: string; tone: Tone }> = [
  { value: "operativo", label: "Operativo", tone: "success" },
  { value: "mantenimiento", label: "En mantenimiento", tone: "warning" },
  { value: "calibracion_pendiente", label: "Calibración pendiente", tone: "bloom" },
  { value: "fuera_servicio", label: "Fuera de servicio", tone: "danger" },
];

export const MANTENIMIENTO_ESTADOS: Array<{ value: string; label: string; tone: Tone }> = [
  { value: "programado", label: "Programado", tone: "brand" },
  { value: "en_proceso", label: "En proceso", tone: "brand" },
  { value: "completado", label: "Completado", tone: "success" },
  { value: "vencido", label: "Vencido", tone: "danger" },
  { value: "cancelado", label: "Cancelado", tone: "neutral" },
];

export const MANTENIMIENTO_TIPOS: Array<{ value: string; label: string; tone: Tone }> = [
  { value: "preventivo", label: "Preventivo", tone: "brand" },
  { value: "correctivo", label: "Correctivo", tone: "bloom" },
  { value: "calibracion", label: "Calibración", tone: "neutral" },
];

export function metaFor(list: Array<{ value: string; label: string; tone: Tone }>, value: unknown): { label: string; tone: Tone } {
  const key = String(value || "").toLowerCase();
  return list.find((item) => item.value === key) || { label: key ? key.replace(/_/g, " ") : "Sin estado", tone: "neutral" };
}
