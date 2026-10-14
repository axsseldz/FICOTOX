"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle, DownloadSimple, FilePlus, XCircle } from "@phosphor-icons/react";
import { RequireDocumentos, RutaDocumentos, useCatalogos } from "@/components/features/documentos/comun";
import { AceptarSolicitudSheet, RechazarSolicitudDialog, SolicitudSheet, type SolicitudSgc } from "@/components/features/documentos/SolicitudSheets";
import { descargarUrl } from "@/components/features/visor/usarArchivo";
import { PageBody } from "@/components/shell/AppShell";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { PageHeader, SegmentedTabs } from "@/components/ui/PageHeader";
import { Badge, EmptyState, ErrorState, Skeleton } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { useInitialParam } from "@/lib/client/hooks";
import { explicarError } from "@/lib/client/mensajes";
import { useResource } from "@/lib/client/store";
import { ESTADOS_SOLICITUD_SGC } from "@/lib/shared/documentos";
import { formatearFecha, formatearFechaHora } from "@/lib/shared/fechas";

/*
 * Solicitudes de Documentos SGC: quien propone ve el estado de las suyas;
 * Mejora Continua ve todas y las acepta (crea la ficha o abre la revision, con
 * responsables) o las rechaza con motivo.
 */

type Filtro = "pendiente" | "todas";

export default function SolicitudesPage() {
  return (
    <RequireDocumentos>
      <Suspense fallback={<Skeleton className="h-[320px]" />}>
        <Solicitudes />
      </Suspense>
    </RequireDocumentos>
  );
}

function Solicitudes() {
  const { token } = useSession();
  const catalogos = useCatalogos();
  const [filtro, setFiltro] = useState<Filtro>("pendiente");
  const [nueva, setNueva] = useState(useInitialParam("nueva") === "1");
  const [aceptar, setAceptar] = useState<SolicitudSgc | null>(null);
  const [rechazar, setRechazar] = useState<SolicitudSgc | null>(null);
  const abrir = Number(useInitialParam("abrir")) || 0;
  const recurso = useResource<{ items: SolicitudSgc[]; puede: { proponer: boolean; atender: boolean } }>(["sgc", "sgc-solicitudes"], async () => (await getJsonAuth(`${API_BASE_URL}/sgc/solicitudes`, token)) as unknown as { items: SolicitudSgc[]; puede: { proponer: boolean; atender: boolean } }, { enabled: !!token });
  const data = recurso.data;
  const items = (data?.items || []).filter((x) => filtro === "todas" || x.estado === "pendiente");

  useEffect(() => {
    if (!abrir || !data) return;
    const el = document.querySelector(`[data-solicitud="${abrir}"]`);
    if (el) el.scrollIntoView({ block: "center" });
  }, [abrir, data]);

  const apoyo = async (x: SolicitudSgc) => {
    try {
      await descargarUrl(`${API_BASE_URL}/sgc/solicitudes/${x.id}/apoyo`, token, `apoyo-solicitud-${x.id}`);
    } catch (err) {
      toast.error(explicarError(err, "No se pudo descargar").que);
    }
  };

  return (
    <PageBody>
      <div className="flex flex-col gap-2">
        <RutaDocumentos documento="Solicitudes" />
        <PageHeader
          title="Solicitudes de documentos"
          description={data?.puede.atender ? "Propuestas de documentos nuevos y de cambios. Al aceptarlas creas la ficha o abres la revisión y asignas responsables." : "Tus propuestas de documentos nuevos o de cambios y lo que resolvió Mejora Continua."}
          actions={
            data?.puede.proponer ? (
              <Button icon={<FilePlus size={16} />} onClick={() => setNueva(true)} data-testid="sgc-nueva-solicitud">
                Nueva solicitud
              </Button>
            ) : null
          }
        />
      </div>
      <SegmentedTabs<Filtro> value={filtro} onChange={setFiltro} options={[{ value: "pendiente", label: "Pendientes" }, { value: "todas", label: "Todas" }]} label="Filtro" />
      {recurso.error ? (
        <ErrorState message={recurso.error} onRetry={recurso.reload} />
      ) : !data ? (
        <Skeleton className="h-[240px] rounded-card" />
      ) : !items.length ? (
        <div className="rounded-card bg-surface shadow-card">
          <EmptyState icon={<FilePlus size={22} weight="duotone" />} title={filtro === "pendiente" ? "Sin solicitudes pendientes" : "Sin solicitudes"} description="Propón un documento nuevo o un cambio con «Nueva solicitud»." />
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((x) => {
            const est = ESTADOS_SOLICITUD_SGC[x.estado];
            return (
              <li key={x.id} data-solicitud={x.id} data-testid="sgc-solicitud" className={cn("flex flex-col gap-2 rounded-card bg-surface p-4 shadow-card", abrir === x.id && "ring-2 ring-brand/40")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-ink-3">#{x.id}</span>
                  <Badge tone={est?.tono || "neutral"}>{est?.etiqueta || x.estado}</Badge>
                  <Badge tone="neutral">{x.tipo === "nuevo" ? "Documento nuevo" : "Cambio"}</Badge>
                  {x.documento_clave ? (
                    <Link href={`/documentos/${x.documento_id}`} className="code text-[12.5px] font-semibold text-brand-strong hover:underline">
                      {x.documento_clave}
                    </Link>
                  ) : x.area_codigo ? (
                    <span className="text-[12.5px] text-ink-3">
                      {x.area_codigo} · {x.tipo_codigo}
                    </span>
                  ) : null}
                  <span className="ml-auto text-[12px] text-ink-3">
                    {x.solicitante_nombre || "—"} · {formatearFechaHora(x.creado_en)}
                  </span>
                </div>
                <p className="text-[14.5px] font-medium text-ink">{x.titulo_propuesto || x.documento_titulo}</p>
                <p className="whitespace-pre-line text-[13.5px] text-ink-2">{x.justificacion}</p>
                {x.estado !== "pendiente" ? (
                  <p className="text-[12.5px] text-ink-3">
                    {x.estado === "aceptada" ? "Aceptada" : "Rechazada"} por {x.resuelta_por_nombre || "—"} el {formatearFecha(x.resuelta_en)}
                    {x.comentario_resolucion ? ` · ${x.comentario_resolucion}` : ""}
                    {x.clave_asignada ? ` · clave ${x.clave_asignada}` : ""}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {x.con_apoyo ? (
                    <Button size="sm" variant="ghost" icon={<DownloadSimple size={14} />} onClick={() => void apoyo(x)}>
                      Archivo de apoyo
                    </Button>
                  ) : null}
                  {x.puede.atender ? (
                    <>
                      <Button size="sm" icon={<CheckCircle size={15} />} onClick={() => setAceptar(x)} data-testid="sgc-solicitud-aceptar">
                        Aceptar
                      </Button>
                      <Button size="sm" variant="secondary" icon={<XCircle size={15} />} onClick={() => setRechazar(x)} data-testid="sgc-solicitud-rechazar">
                        Rechazar
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {nueva && data?.puede.proponer ? <SolicitudSheet catalogos={catalogos.data} onClose={() => setNueva(false)} /> : null}
      {aceptar ? <AceptarSolicitudSheet solicitud={aceptar} catalogos={catalogos.data} onClose={() => setAceptar(null)} /> : null}
      {rechazar ? <RechazarSolicitudDialog solicitud={rechazar} onClose={() => setRechazar(null)} /> : null}
    </PageBody>
  );
}
