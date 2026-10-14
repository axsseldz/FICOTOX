import { toast } from "sonner";
import { descargarUrl } from "@/components/features/visor/usarArchivo";
import { API_BASE_URL } from "./api";
import { explicarError } from "./mensajes";
import type { ApiRecord } from "./types";

/* Descarga el PDF de un informe (accion explicita; ver un informe se hace siempre en /informes/:id/ver). */
export async function descargarPdfInforme(item: ApiRecord, token: string): Promise<void> {
  try {
    await descargarUrl(`${API_BASE_URL}/informes/${item.id}/pdf`, token, `${String(item.folio || "informe").replace(/\s+/g, "-")}-v${Number(item.version || 1)}.pdf`);
  } catch (err) {
    const e = explicarError(err, "No se pudo descargar el PDF");
    toast.error(e.que, { description: e.hacer });
  }
}
