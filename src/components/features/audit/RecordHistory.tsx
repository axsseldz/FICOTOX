"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { CaretRight } from "@phosphor-icons/react";
import { useSession } from "@/components/session/SessionProvider";
import { EmptyState, Skeleton } from "@/components/ui/Primitives";
import { cn } from "@/components/ui/cn";
import { Badge, type Tone } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import type { ApiRecord } from "@/lib/client/types";
import { ETIQUETA_ESTADO_SOLICITUD, type EstadoSolicitud } from "@/lib/shared/acciones-criticas";
import { formatearFechaHora } from "@/lib/shared/fechas";
import { ActividadDialog, agruparActividades, ListaActividades, usePersonas } from "./Actividades";

/*
 * Historial de un registro: arriba, sus solicitudes de autorizacion de un
 * segundo usuario (Fase 3), con las pendientes destacadas; abajo, la parte de
 * la bitacora que le corresponde, contada en frases (quien hizo que, cuando y
 * por que), recogida por omision, con la misma lista y el mismo detalle que
 * Calidad › Auditoría. La bitacora no se exporta (decision del laboratorio).
 */

const TONO_SOLICITUD: Record<string, Tone> = { pendiente: "warning", aprobada: "success", rechazada: "danger", cancelada: "neutral", vencida: "neutral" };

export function RecordHistory({ entidad, entidadId, compact = false }: { entidad: string; entidadId: number | string | null | undefined; compact?: boolean }) {
  const { token } = useSession();
  const [items, setItems] = useState<ApiRecord[] | null>(null);
  const [solicitudes, setSolicitudes] = useState<ApiRecord[] | null>(null);
  // La bitacora aparece recogida; las solicitudes van aparte, arriba.
  const [abierta, setAbierta] = useState(false);
  const idBase = useId();
  const [error, setError] = useState<string | null>(null);
  const [actividadAbierta, setActividadAbierta] = useState<number | null>(null);
  const personas = usePersonas();
  const grupos = useMemo(() => agruparActividades(items || [], { personas }), [items, personas]);

  const load = useCallback(async () => {
    if (!token || !entidadId) return;
    try {
      const data = await getJsonAuth(`${API_BASE_URL}/audit?entidad=${encodeURIComponent(entidad)}&entidad_id=${encodeURIComponent(String(entidadId))}&limit=100`, token);
      setItems((data.items || []) as ApiRecord[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el historial");
    }
    // Las solicitudes solo existen para los registros con acciones criticas; si la consulta falla no se rompe la bitacora.
    try {
      const data = await getJsonAuth(`${API_BASE_URL}/solicitudes?entidad=${encodeURIComponent(entidad)}&entidad_id=${encodeURIComponent(String(entidadId))}`, token);
      setSolicitudes((data.items || []) as ApiRecord[]);
    } catch {
      setSolicitudes([]);
    }
  }, [token, entidad, entidadId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (!entidadId) return <p className="text-[13px] text-ink-3">El historial aparece una vez guardado el registro.</p>;
  if (error) return <p className="text-[13px] text-danger">{error}</p>;
  if (!items) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    );
  }
  const lista = solicitudes || [];
  const pendientes = lista.filter((sol) => sol.estado === "pendiente");
  const resueltas = lista.filter((sol) => sol.estado !== "pendiente");
  const texto = compact ? "text-[13px]" : "text-[13.5px]";

  return (
    <div className="flex flex-col gap-4">
      {lista.length ? (
        <section aria-labelledby={`${idBase}-sol`} className="flex flex-col gap-2" data-historial-solicitudes>
          <h4 id={`${idBase}-sol`} className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            Solicitudes de autorización
            <span className="tnum font-normal text-ink-3">· {lista.length}</span>
            {pendientes.length ? <Badge tone="warning">{pendientes.length === 1 ? "1 pendiente" : `${pendientes.length} pendientes`}</Badge> : null}
          </h4>
          <ul className={cn("flex flex-col gap-2", texto)} aria-label="Solicitudes de autorización">
            {pendientes.map((sol) => (
              <li key={String(sol.id)} className="rounded-[12px] bg-warning-soft/60 px-3.5 py-3 ring-1 ring-warning/25" data-solicitud-estado="pendiente">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-ink">{String(sol.etiqueta)}</p>
                  <Badge tone="warning" dot>
                    {ETIQUETA_ESTADO_SOLICITUD.pendiente}
                  </Badge>
                </div>
                <dl className="mt-2 grid gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-[max-content_minmax(0,1fr)]">
                  <dt className="text-ink-3">Pidió</dt>
                  <dd className="text-ink">
                    {String(sol.solicitado_nombre || "Otra persona")}
                    {sol.solicitado_rol ? <span className="text-ink-3"> · {String(sol.solicitado_rol)}</span> : null}
                  </dd>
                  <dt className="text-ink-3">Motivo</dt>
                  <dd className="whitespace-pre-line text-ink">{String(sol.motivo || "—")}</dd>
                  <dt className="text-ink-3">Cuándo</dt>
                  <dd className="tnum text-ink">
                    {formatearFechaHora(sol.solicitado_en)}
                    {sol.vence_en ? <span className="text-ink-3"> · vence {formatearFechaHora(sol.vence_en)}</span> : null}
                  </dd>
                </dl>
                <p className="mt-2 text-[12px] text-ink-3">La aprueba o rechaza otra persona autorizada, desde «Por autorizar».</p>
              </li>
            ))}
            {resueltas.map((sol) => (
              <li key={String(sol.id)} className="rounded-[12px] bg-surface-2 px-3 py-2.5 ring-1 ring-line" data-solicitud-estado={String(sol.estado)}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-ink">{String(sol.etiqueta)}</p>
                  <Badge tone={TONO_SOLICITUD[String(sol.estado)] || "neutral"}>{ETIQUETA_ESTADO_SOLICITUD[String(sol.estado) as EstadoSolicitud] || String(sol.estado)}</Badge>
                </div>
                <p className="mt-0.5 whitespace-pre-line text-ink-2">Motivo: {String(sol.motivo || "—")}</p>
                <p className="tnum mt-0.5 text-[12px] text-ink-3">
                  Pidió {String(sol.solicitado_nombre || "otra persona")}
                  {sol.solicitado_rol ? ` (${String(sol.solicitado_rol)})` : ""} · {formatearFechaHora(sol.solicitado_en)}
                </p>
                <p className="tnum mt-0.5 whitespace-pre-line text-[12px] text-ink-3">
                  {sol.resuelto_nombre ? `${String(sol.resuelto_nombre)}${sol.resuelto_rol ? ` (${String(sol.resuelto_rol)})` : ""} · ` : ""}
                  {formatearFechaHora(sol.resuelto_en)}
                  {sol.motivo_resolucion ? ` · ${String(sol.motivo_resolucion)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col" data-historial-bitacora>
        <button
          type="button"
          aria-expanded={abierta}
          aria-controls={`${idBase}-bit`}
          onClick={() => setAbierta((v) => !v)}
          className="press -mx-2 flex items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[13px] font-semibold text-ink hover:bg-surface-2"
        >
          <CaretRight size={13} weight="bold" className={cn("text-ink-3 transition-transform duration-200 ease-[var(--ease-spring)] motion-reduce:transition-none", abierta && "rotate-90")} />
          Actividad
          <span className="tnum font-normal text-ink-3">· {items.length === 1 ? "1 actividad" : `${items.length} actividades`}</span>
        </button>
        <div id={`${idBase}-bit`} className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-[var(--ease-spring)] motion-reduce:transition-none", abierta ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")} inert={!abierta} aria-hidden={!abierta}>
          <div className="min-h-0 overflow-hidden">
            <div className="pt-2">
              {items.length ? (
                <div className="overflow-hidden rounded-[14px] bg-surface ring-1 ring-line" aria-label="Actividad del registro">
                  <ListaActividades grupos={grupos} seleccion={actividadAbierta} onAbrir={setActividadAbierta} />
                </div>
              ) : (
                <EmptyState compact title="Sin actividad" description="Este registro todavía no tiene actividad." />
              )}
            </div>
          </div>
        </div>
      </section>
      <ActividadDialog grupos={grupos} indice={actividadAbierta} onIndice={setActividadAbierta} onCerrar={() => setActividadAbierta(null)} />
    </div>
  );
}
