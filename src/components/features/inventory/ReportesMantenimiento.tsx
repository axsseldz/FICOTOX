"use client";

import { FilePdf, FileText } from "@phosphor-icons/react";
import { useSession } from "@/components/session/SessionProvider";
import { ListaCuadricula, type ColumnaLista } from "@/components/ui/ListaCuadricula";
import { Badge, type Tone } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { verPdf } from "@/lib/client/files";
import { fmt } from "@/lib/client/format";
import { formatearFechaCorta } from "@/lib/shared/fechas";
import { useResource } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";

/*
 * Reportes de mantenimiento en PDF (modulo equipos). Antes vivian en una
 * pestaña del flujo anterior de documentos; desde su retiro viven
 * aqui, junto a los mantenimientos que los generan. Misma API (/api/documents).
 */
const COLUMNAS: ColumnaLista[] = [
  { clave: "codigo", titulo: "Reporte", ancho: "minmax(220px,1.4fr)" },
  { clave: "tipo", titulo: "Tipo", ancho: "140px" },
  { clave: "version", titulo: "Versión", ancho: "120px" },
  { clave: "estado", titulo: "Estado", ancho: "140px" },
  { clave: "fecha", titulo: "Fecha", ancho: "130px" },
];

const REPORTE_ESTADOS: Record<string, { label: string; tone: Tone }> = {
  borrador: { label: "Borrador", tone: "neutral" },
  en_revision: { label: "En revisión", tone: "warning" },
  aprobado: { label: "Aprobado", tone: "brand" },
  publicado: { label: "Publicado", tone: "success" },
};

export function ReportesMantenimiento() {
  const { token } = useSession();
  const recurso = useResource<ApiRecord[]>(["mantenimientos", "reportes-mantenimiento"], async () => ((await getJsonAuth(`${API_BASE_URL}/documents`, token)).items || []) as ApiRecord[], { enabled: !!token });
  const abrir = (item: ApiRecord) => {
    const raw = String(item.archivo_url || "");
    const url = raw.startsWith("/") ? raw : `${API_BASE_URL}/documents/files/${raw.split("/").pop()}`;
    verPdf(url, `${String(item.codigo || "reporte")}.pdf`, String(item.codigo || "Reporte de mantenimiento"));
  };
  const items = recurso.data || [];
  return (
    <section className="mt-8 flex flex-col gap-3" aria-labelledby="reportes-mant" data-reportes-mantenimiento>
      <h2 id="reportes-mant" className="title-3 text-ink">
        Reportes de mantenimiento (PDF)
      </h2>
      <ListaCuadricula
        etiqueta="Reportes de mantenimiento"
        columnas={COLUMNAS}
        filas={recurso.data ? items : null}
        error={recurso.error}
        onReintentar={recurso.reload}
        clave={(item) => String(item.id)}
        onAbrir={(item) => (item.archivo_url ? abrir(item) : undefined)}
        celdas={(item) => {
          const meta = REPORTE_ESTADOS[String(item.estado || "")] || { label: String(item.estado || "—"), tone: "neutral" as Tone };
          return [
            <span key="c" className="flex min-w-0 items-center gap-3">
              <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-danger-soft text-danger">
                <FilePdf size={20} weight="duotone" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[14.5px] leading-tight font-semibold text-ink">{String(item.codigo || "Reporte")}</span>
                <span className="text-[12.5px] text-ink-3">{item.archivo_url ? "Pulsa para abrir el PDF" : "Sin PDF"}</span>
              </span>
            </span>,
            <span key="t" className="text-[13.5px] capitalize text-ink-2">{String(item.tipo_mantenimiento || "—")}</span>,
            <span key="v" className="text-[13.5px] text-ink-2">{item.version ? `Versión ${String(item.version)}` : "—"}</span>,
            <Badge key="e" tone={meta.tone} dot>
              {meta.label}
            </Badge>,
            <span key="f" className="text-[13.5px] text-ink-2">{formatearFechaCorta(item.fecha_reporte)}</span>,
          ];
        }}
        anchoExtremo="12px"
        vacio={{ icono: <FileText size={20} />, titulo: "Sin reportes", descripcion: "Los reportes en PDF se generan desde el menú de cada mantenimiento." }}
      />
      {recurso.data && items.length ? <p className="tnum px-1 text-[12px] text-ink-4">{items.length === 1 ? "1 reporte" : `${fmt(items.length)} reportes`}</p> : null}
    </section>
  );
}
