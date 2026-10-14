"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpenText, CheckCircle, Clock, Tray, WarningCircle } from "@phosphor-icons/react";
import { useBandejaSgc } from "@/components/features/documentos/bandeja";
import { RequireDocumentos, RutaDocumentos } from "@/components/features/documentos/comun";
import { PageBody } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge, EmptyState, ErrorState, Skeleton } from "@/components/ui/Primitives";
import { formatearFecha } from "@/lib/shared/fechas";

/*
 * Bandeja de tareas de Documentos SGC: lo que le toca a la persona
 * (solicitudes por atender, borradores por elaborar o corregir, revisiones,
 * autorizaciones, publicaciones, renovaciones, revisiones periodicas y
 * obsolescencias por aprobar). Las lecturas pendientes llegan en la Fase 3.
 */

const GRUPOS: Array<{ titulo: string; tipos: string[] }> = [
  { titulo: "Solicitudes por atender", tipos: ["solicitud"] },
  { titulo: "Por elaborar o corregir", tipos: ["elaborar", "corregir"] },
  { titulo: "Por revisar", tipos: ["revisar", "renovacion_revisar"] },
  { titulo: "Por autorizar", tipos: ["autorizar", "renovacion_autorizar"] },
  { titulo: "Por publicar", tipos: ["publicar"] },
  { titulo: "Revisiones periódicas", tipos: ["pendiente_revision"] },
  { titulo: "Obsolescencias por aprobar", tipos: ["obsolescencia"] },
];

export default function BandejaPage() {
  return (
    <RequireDocumentos>
      <Bandeja />
    </RequireDocumentos>
  );
}

function Bandeja() {
  const router = useRouter();
  const recurso = useBandejaSgc();
  const items = recurso.data?.items || [];
  return (
    <PageBody>
      <div className="flex flex-col gap-2">
        <RutaDocumentos documento="Bandeja de tareas" />
        <PageHeader title="Bandeja de tareas" description="Lo que te toca en Documentos SGC: según tu papel en cada revisión y lo que atiende Mejora Continua." />
      </div>
      {recurso.error ? (
        <ErrorState message={recurso.error} onRetry={recurso.reload} />
      ) : !recurso.data ? (
        <Skeleton className="h-[320px] rounded-card" />
      ) : (
        <>
          {!items.length ? (
            <div className="rounded-card bg-surface shadow-card" data-testid="bandeja-vacia">
              <EmptyState icon={<CheckCircle size={22} weight="duotone" />} title="Nada pendiente" description="Cuando te asignen una revisión o te toque decidir algo, aparecerá aquí y en la campana." />
            </div>
          ) : (
            GRUPOS.map((g) => {
              const lista = items.filter((t) => g.tipos.includes(t.tipo));
              if (!lista.length) return null;
              return (
                <section key={g.titulo} className="flex flex-col gap-2" aria-label={g.titulo}>
                  <h2 className="flex items-center gap-2 text-[14.5px] font-semibold text-ink">
                    {g.titulo} <Badge tone="neutral">{lista.length}</Badge>
                  </h2>
                  <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
                    {lista.map((t) => (
                      <li key={t.clave} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-testid="bandeja-tarea" data-tipo={t.tipo}>
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="flex flex-wrap items-center gap-2">
                            {t.clave_documento ? <span className="code text-[12.5px] font-semibold text-ink-2">{t.clave_documento}</span> : null}
                            {t.revision !== null ? <span className="text-[12.5px] text-ink-3">rev. {t.revision}</span> : null}
                            <Badge tone="brand">{t.papel}</Badge>
                          </span>
                          <span className="break-words text-[14px] font-medium text-ink">{t.titulo}</span>
                          <span className="text-[12.5px] text-ink-2">{t.accion}</span>
                        </div>
                        {t.fecha_limite ? (
                          <span className={cn("flex items-center gap-1 text-[12.5px]", t.vencida ? "font-semibold text-danger-text" : "text-ink-3")}>
                            {t.vencida ? <WarningCircle size={14} weight="bold" aria-hidden="true" /> : <Clock size={14} aria-hidden="true" />}
                            {t.vencida ? "Venció el" : "Límite"} {formatearFecha(t.fecha_limite)}
                          </span>
                        ) : null}
                        <Button size="sm" iconRight={<ArrowRight size={14} />} onClick={() => router.push(t.href)}>
                          {t.tipo === "solicitud" ? "Atender" : t.tipo === "obsolescencia" ? "Ver solicitud" : "Ir"}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}
          <section className="flex items-center gap-3 rounded-card bg-surface px-4 py-3 text-[13px] text-ink-3 shadow-card" aria-label="Lecturas pendientes">
            <BookOpenText size={18} weight="duotone" aria-hidden="true" />
            <span className="flex-1">Lecturas pendientes: se activan con la distribución de documentos.</span>
            <Tray size={16} aria-hidden="true" />
          </section>
          <p className="text-[12.5px] text-ink-3">
            También puedes ver <Link href="/documentos/solicitudes" className="text-brand-strong underline underline-offset-2">tus solicitudes</Link>.
          </p>
        </>
      )}
    </PageBody>
  );
}
