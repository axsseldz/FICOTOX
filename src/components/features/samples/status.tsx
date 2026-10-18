"use client";

import { useState, type ReactNode } from "react";
import { Badge, type Tone } from "@/components/ui/Primitives";
import { Button } from "@/components/ui/Button";
import { Dialog, Tooltip } from "@/components/ui/Overlay";
import { SolicitudBanner, SolicitudDetalle, SupervisionBanner } from "@/components/features/solicitudes/Solicitudes";
import { StatusFlag } from "@/components/ui/StatusFlag";
import type { ApiRecord } from "@/lib/client/types";
import { Callout } from "./FormLayout";
import { normalizeSampleStatus, sampleStatusLabel } from "@/lib/client/samples";
import { ANALYSIS_STATES, DOCUMENT_STATES, REPORT_STATES, SAMPLE_STATES } from "@/lib/shared/sgc";

export function SampleStatus({ status }: { status: unknown }) {
  const normalized = normalizeSampleStatus(status);
  const meta = SAMPLE_STATES[normalized];
  return (
    <Badge tone={(meta?.tone as Tone) || "neutral"} dot>
      {sampleStatusLabel(status)}
    </Badge>
  );
}

/* Badge generico para los estados de analisis, informes y documentos controlados. */
export function StateBadge({ kind, status }: { kind: "analisis" | "informe" | "documento"; status: unknown }) {
  const table = kind === "analisis" ? ANALYSIS_STATES : kind === "informe" ? REPORT_STATES : DOCUMENT_STATES;
  const key = String(status || "").toLowerCase();
  const meta = table[key];
  return (
    <Badge tone={(meta?.tone as Tone) || "neutral"} dot>
      {meta?.label || key || "—"}
    </Badge>
  );
}

const CHIP_TONES: Record<string, string> = {
  R: "bg-brand-soft text-brand-strong",
  P: "bg-warning-soft text-warning-text",
  "E-A": "bg-violet-soft text-violet-text",
  "E-D": "bg-bloom-soft text-bloom-text",
  A: "bg-success-soft text-success-text",
  IR: "bg-surface-3 text-ink-2 ring-1 ring-inset ring-line-strong/60",
};

/* Chip de folio: letra de etapa + numero con siete digitos. Cada tipo tiene su color. */
export function FolioChip({ type, num }: { type: "R" | "P" | "E-A" | "E-D" | "A" | "IR" | string; num: unknown }) {
  const n = Number(num || 0);
  const tone = CHIP_TONES[type] || CHIP_TONES["E-A"];
  return (
    <span className={`code inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 text-[12px] font-medium ${tone}`}>
      <span className="opacity-70">{type}</span>
      {n ? String(n).padStart(7, "0") : "-"}
    </span>
  );
}

/*
 * Supervision (Fase 2): lo que captura una persona supervisada queda pendiente
 * del visto bueno de su supervisor, o regresado con observaciones. Mientras
 * tanto no avanza (no se cierra, no se revisa ni aprueba, no es origen).
 */
export function SupervisionBadge({ estado }: { estado: unknown }) {
  const key = String(estado || "");
  if (key === "pendiente") return <StatusFlag kind="pendiente" label="Pendiente de visto bueno" detail="Lo capturó una persona bajo supervisión; no avanza hasta el visto bueno." data-supervision="pendiente" />;
  if (key === "regresado") return <StatusFlag kind="regresado" label="Regresado por el supervisor" detail="Corrígelo y guárdalo para volver a pedir el visto bueno." data-supervision="regresado" />;
  return null;
}

/* Tabla de supervision del registro por la ruta de la ficha (cuando el formato no la indica). */
function tablaPorRuta(): string {
  if (typeof window === "undefined") return "";
  const p = window.location.pathname;
  return p.startsWith("/muestras/recepcion/") ? "muestras_recepcion" : p.startsWith("/muestras/procesamiento/") ? "muestras_procesamiento" : p.startsWith("/muestras/extraccion/") ? "muestras_extraccion" : p.startsWith("/muestras/analisis/") ? "muestras_analisis" : p.startsWith("/informes/") ? "informes" : "";
}

export function SupervisionCallout({ item, tabla, referencia }: { item: ApiRecord | null | undefined; tabla?: string; referencia?: string }) {
  const estado = String(item?.supervision_estado || "");
  if (!item || !Number(item.requiere_supervision || 0)) return null;
  if (estado === "pendiente") {
    const t = tabla || tablaPorRuta();
    const aviso = (
      <Callout tone="warning" title="Pendiente del visto bueno del supervisor">
        Lo capturó una persona bajo supervisión. No avanza (no se cierra, no se revisa ni aprueba y no sirve de origen de la etapa siguiente) hasta que su supervisor dé el visto bueno.
      </Callout>
    );
    // El supervisor asignado ve el banner con "Dar visto bueno" y "Regresar"; los demás, el aviso.
    return t ? (
      <SupervisionBanner item={item} tabla={t} tipo="Registro" referencia={referencia || String(item.folio || item.id || "")}>
        {aviso}
      </SupervisionBanner>
    ) : (
      aviso
    );
  }
  if (estado === "regresado") {
    return (
      <Callout tone="danger" title="Regresado por el supervisor">
        {item.supervision_observaciones ? `Observaciones: ${String(item.supervision_observaciones)}. ` : ""}Corrige el registro y guárdalo: vuelve a quedar pendiente del visto bueno. Mientras tanto no avanza.
      </Callout>
    );
  }
  return null;
}

/*
 * Solicitud de autorizacion pendiente (Fase 3): una accion critica (anular,
 * restaurar) espera al segundo usuario. Mientras tanto el registro no se edita
 * ni sirve de origen.
 */
export function SolicitudBadge({ solicitud, entidad }: { solicitud: ApiRecord | null | undefined; entidad?: string }) {
  const [abierta, setAbierta] = useState(false);
  if (!solicitud || String(solicitud.estado || "pendiente") !== "pendiente") return null;
  const etiqueta = `${String(solicitud.pendiente_etiqueta || "Solicitud")} · pendiente de autorización`;
  const quien = solicitud.solicitado_nombre ? `Pidió ${String(solicitud.solicitado_nombre)}` : null;
  return (
    <>
      <StatusFlag kind="pendiente" label={etiqueta} detail={[quien, solicitud.motivo ? `Motivo: ${String(solicitud.motivo)}` : null].filter(Boolean).join(" · ") || undefined} data-solicitud-pendiente={String(solicitud.id || "")} onClick={() => setAbierta(true)} />
      {/* Panel rápido: la solicitud y sus botones, sin salir de la lista (los clics del portal no llegan a la fila). */}
      <span className="contents" onClick={(event) => event.stopPropagation()}>
        <Dialog open={abierta} onOpenChange={setAbierta} title={String(solicitud.pendiente_etiqueta || "Solicitud")} description={String(solicitud.referencia || "")} size="sm">
          <SolicitudDetalle sol={solicitud} entidad={entidad} onCambio={() => setAbierta(false)} />
        </Dialog>
      </span>
    </>
  );
}

/* Banner arriba del formato: qué se pidió, quién, cuándo y motivo, con Aprobar/Rechazar o Cancelar según quien mira. */
export function SolicitudCallout({ item, entidad }: { item: ApiRecord | null | undefined; entidad?: string }) {
  return <SolicitudBanner item={item} entidad={entidad} />;
}

/*
 * Segregacion de funciones (Fase 3): el boton de revisar/aprobar/autorizar se
 * deshabilita con la explicacion del servidor (quien elaboro no valida lo
 * suyo) en lugar de fallar al guardar; se ofrece pedir una excepcion.
 */
export function BotonSegregado({ bloqueo, children }: { bloqueo: string | null | undefined; onSolicitar?: () => void; children: ReactNode }) {
  if (!bloqueo) return <>{children}</>;
  return (
    <Tooltip content={bloqueo}>
      <span className="inline-flex" aria-label={bloqueo}>
        {children}
      </span>
    </Tooltip>
  );
}

export function SegregacionCallout({ bloqueo, accion, onSolicitar }: { bloqueo: string | null | undefined; accion: string; onSolicitar: () => void }) {
  if (!bloqueo) return null;
  return (
    <Callout tone="info" title="Separación de funciones">
      {bloqueo}. Si no hay otra persona disponible, puedes pedir una excepción a quien tiene A en calidad (Responsable General / Mejora Continua); queda registrada en el registro y en la bitácora.
      <div className="mt-2">
        <Button size="sm" variant="secondary" onClick={onSolicitar}>
          Solicitar excepción para {accion}…
        </Button>
      </div>
    </Callout>
  );
}
