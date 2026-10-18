/*
 * Datos del Inicio (de /inicio/avisos, de solo lectura y
 * con los permisos y alcances de cada persona).
 */

interface PendienteItem {
  label: string;
  sub: string | null;
  href: string;
  persona_id?: number | null;
  persona?: string | null;
}

export interface Pendiente {
  key: string;
  label: string;
  tone: "danger" | "warning" | "info";
  count: number;
  href: string;
  items: PendienteItem[];
}
