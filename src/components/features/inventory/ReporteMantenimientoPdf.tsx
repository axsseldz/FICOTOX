"use client";

import { useRef } from "react";
import { toast } from "sonner";
import { ArrowsClockwise, FilePdf, Paperclip, Prohibit } from "@phosphor-icons/react";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { usePrompt } from "@/components/ui/Overlay";
import { API_BASE_URL, getJsonAuth, sendFormAuth, sendJsonAuth } from "@/lib/client/api";
import { verPdf } from "@/lib/client/files";
import { invalidate, useResource } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { fmtBytes, huellaCorta } from "@/lib/shared/adjuntos";
import { formatearFechaCorta } from "@/lib/shared/fechas";

/*
 * Reporte de servicio en PDF de un mantenimiento (el que entrega el proveedor o
 * el tecnico), dentro de su ventana. Quien puede registrar o editar
 * mantenimientos lo adjunta, lo reemplaza o lo quita (con motivo y contrasena;
 * el archivo se conserva y queda en la bitacora). Quien solo consulta lo abre en
 * el visor.
 */
/*
 * El visor flotante no puede quedar encima de una ventana modal (que retiene el foco y
 * los clics): quien lo pide cierra su ventana antes (alVer) y la vuelve a abrir al
 * cerrar el visor (alCerrarVisor).
 */
const abrir = (item: ApiRecord, alCerrarVisor?: () => void) => {
  const raw = String(item.archivo_url || "");
  const url = raw.startsWith("/") ? raw : `${API_BASE_URL}/documents/files/${raw.split("/").pop()}`;
  verPdf(url, String(item.nombre_original || `${String(item.codigo || "reporte")}.pdf`), `Reporte ${String(item.codigo || "de mantenimiento")}`, alCerrarVisor);
};

export function ReporteMantenimientoPdf({ mantenimientoId, puedeGestionar, alVer, alCerrarVisor }: { mantenimientoId: number; puedeGestionar: boolean; alVer?: () => void; alCerrarVisor?: () => void }) {
  const { token } = useSession();
  const prompt = usePrompt();
  const inputRef = useRef<HTMLInputElement>(null);
  // Reporte que se va a reemplazar con el archivo que se elija (null: adjuntar uno nuevo).
  const reemplazo = useRef<ApiRecord | null>(null);
  const recurso = useResource<ApiRecord[]>(["reportes-mantenimiento"], async () => ((await getJsonAuth(`${API_BASE_URL}/documents?mantenimiento=${mantenimientoId}`, token)).items || []) as ApiRecord[], { enabled: !!token, deps: [mantenimientoId] });
  const items = recurso.data || [];

  const elegirArchivo = (anterior: ApiRecord | null) => {
    reemplazo.current = anterior;
    if (inputRef.current) inputRef.current.value = "";
    inputRef.current?.click();
  };

  const subir = async (archivo: File | null) => {
    if (!archivo) return;
    const anterior = reemplazo.current;
    if (!/\.pdf$/i.test(archivo.name)) {
      toast.error("El reporte debe ser un archivo PDF");
      return;
    }
    let motivo: string | null = null;
    if (anterior) {
      motivo = await prompt({
        critico: true,
        title: `Reemplazar el reporte ${String(anterior.codigo)}`,
        description: `«${archivo.name}» sustituirá al reporte actual. El anterior se conserva y el cambio queda en la bitácora.`,
        label: "Motivo del reemplazo",
        minLength: 5,
        confirmLabel: "Reemplazar reporte",
      });
      if (!motivo) return;
    }
    const form = new FormData();
    form.append("archivo", archivo);
    form.append("id_mantenimiento", String(mantenimientoId));
    if (anterior && motivo) {
      form.append("reemplaza_id", String(anterior.id));
      form.append("motivo", motivo);
    }
    try {
      const data = await sendFormAuth(`${API_BASE_URL}/documents/maintenance-report`, token, form);
      toast.success(String(data.message || "Reporte PDF adjuntado"));
      invalidate("reportes-mantenimiento", "mantenimientos");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo adjuntar el reporte");
    }
  };

  const quitar = async (item: ApiRecord) => {
    const motivo = await prompt({
      critico: true,
      title: `Quitar el reporte ${String(item.codigo)}`,
      description: "Úsalo si se adjuntó por error. El PDF se conserva para consulta y la acción queda en la bitácora.",
      label: "Motivo",
      minLength: 5,
      confirmLabel: "Quitar reporte",
      tone: "danger",
    });
    if (!motivo) return;
    try {
      const data = await sendJsonAuth("POST", `${API_BASE_URL}/documents/maintenance-report/${item.id}/quitar`, token, { motivo });
      toast.success(String(data.message || "Reporte quitado"));
      invalidate("reportes-mantenimiento", "mantenimientos");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo quitar el reporte");
    }
  };

  return (
    <div className="flex flex-col gap-3" data-reporte-mantenimiento={mantenimientoId}>
      {puedeGestionar ? <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="sr-only" aria-label="Archivo PDF del reporte" data-reporte-archivo onChange={(event) => void subir(event.target.files?.[0] || null)} /> : null}
      {recurso.data && !items.length ? (
        <p className="text-sm text-ink-3" data-reporte-vacio>
          {puedeGestionar ? "Aún no hay reporte. Usa «Adjuntar reporte PDF» para subir el reporte de servicio que entregó el proveedor o el técnico." : "Aún no hay un reporte de servicio adjunto."}
        </p>
      ) : null}
      {items.map((item) => (
        <div key={String(item.id)} className="flex flex-wrap items-center gap-3 rounded-card bg-surface-2 px-4 py-3 ring-1 ring-line" data-reporte-item={String(item.id)}>
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-box bg-danger-soft text-danger">
            <FilePdf size={20} weight="duotone" />
          </span>
          <span className="flex min-w-0 flex-[1_1_12rem] flex-col">
            <span className="text-base leading-tight font-semibold text-ink">{String(item.codigo || "Reporte")}</span>
            <span className="break-words text-xs text-ink-3">
              {[item.nombre_original ? String(item.nombre_original) : null, item.tamano_bytes ? fmtBytes(Number(item.tamano_bytes)) : null, formatearFechaCorta(item.fecha_reporte), item.sha256 ? `SHA-256 ${huellaCorta(String(item.sha256))}` : null].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<FilePdf size={14} />}
              onClick={() => {
                alVer?.();
                abrir(item, alCerrarVisor);
              }}
            >
              Abrir
            </Button>
            {puedeGestionar ? (
              <>
                <Button variant="ghost" size="sm" icon={<ArrowsClockwise size={14} />} onClick={() => elegirArchivo(item)}>
                  Reemplazar
                </Button>
                <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft hover:text-danger" icon={<Prohibit size={14} />} onClick={() => void quitar(item)}>
                  Quitar
                </Button>
              </>
            ) : null}
          </span>
        </div>
      ))}
      {puedeGestionar ? (
        <div>
          <Button variant="secondary" icon={<Paperclip size={16} />} onClick={() => elegirArchivo(null)} data-adjuntar-reporte>
            Adjuntar reporte PDF
          </Button>
        </div>
      ) : null}
    </div>
  );
}
