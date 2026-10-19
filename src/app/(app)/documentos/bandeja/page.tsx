"use client";

import { useRouter } from "next/navigation";
import { useEffect, type CSSProperties } from "react";
import { Clock, WarningCircle, type Icon } from "@phosphor-icons/react";
import { useBandejaSgc, type TareaSgc } from "@/components/features/documentos/bandeja";
import { areaDeClave, IconoArea, RequireDocumentos, RutaDocumentos, useCatalogos, type Area } from "@/components/features/documentos/comun";
import { ICONO_TAREA } from "@/components/features/documentos/iconos";
import { PageBody } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { Conteo, MarcaDibujada } from "@/components/ui/Conteo";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge, EmptyState, ErrorState, Skeleton } from "@/components/ui/Primitives";
import { formatearFecha } from "@/lib/shared/fechas";

/*
 * Bandeja de Documentos SGC: lo que le toca a la persona, agrupado por tipo de
 * tarea (con su icono y un contador por grupo; los grupos vacios no se
 * muestran), y sus lecturas pendientes. Cada tarea es un renglon con el area,
 * la clave, el titulo, la revision, el papel, la fecha limite (vencida
 * resaltada) y su accion directa: abre la ficha y, cuando la tarea es una
 * decision (revisar, autorizar, publicar, confirmar vigencia), su ventana.
 */

interface Grupo {
  clave: string;
  titulo: string;
  icono: Icon;
  tipos: string[];
}
const GRUPOS: Grupo[] = [
  { clave: "publicar", titulo: "Por publicar", icono: ICONO_TAREA.publicar, tipos: ["publicar"] },
  { clave: "autorizar", titulo: "Por autorizar", icono: ICONO_TAREA.autorizar, tipos: ["autorizar"] },
  { clave: "revisar", titulo: "Por revisar", icono: ICONO_TAREA.revisar, tipos: ["revisar"] },
  { clave: "elaborar", titulo: "Borradores por elaborar o corregir", icono: ICONO_TAREA.elaborar, tipos: ["elaborar", "corregir"] },
  { clave: "solicitud", titulo: "Solicitudes por atender", icono: ICONO_TAREA.solicitud, tipos: ["solicitud"] },
  { clave: "renovacion", titulo: "Renovaciones", icono: ICONO_TAREA.renovacion, tipos: ["renovacion_revisar", "renovacion_autorizar"] },
  { clave: "periodica", titulo: "Revisiones periódicas", icono: ICONO_TAREA.periodica, tipos: ["pendiente_revision"] },
  { clave: "obsolescencia", titulo: "Obsolescencias por aprobar", icono: ICONO_TAREA.obsolescencia, tipos: ["obsolescencia"] },
];

/* Accion directa del renglon; `abrir` es la accion de la ficha que se abre en su ventana (?accion=). */
const ACCION: Record<string, { etiqueta: string; abrir?: string }> = {
  publicar: { etiqueta: "Publicar", abrir: "sgc-publicar" },
  autorizar: { etiqueta: "Autorizar", abrir: "sgc-autorizar" },
  revisar: { etiqueta: "Revisar", abrir: "sgc-revisar" },
  renovacion_revisar: { etiqueta: "Confirmar vigencia", abrir: "sgc-renovacion-revisar" },
  renovacion_autorizar: { etiqueta: "Autorizar renovación", abrir: "sgc-renovacion-autorizar" },
  elaborar: { etiqueta: "Abrir borrador" },
  corregir: { etiqueta: "Corregir" },
  solicitud: { etiqueta: "Atender" },
  pendiente_revision: { etiqueta: "Ver documento" },
  obsolescencia: { etiqueta: "Ver solicitud" },
  lectura: { etiqueta: "Leer" },
};

const destino = (t: TareaSgc, tipo: string) => {
  const abrir = ACCION[tipo]?.abrir;
  return abrir && /^\/documentos\/\d+$/.test(t.href) ? `${t.href}?accion=${abrir}` : t.href;
};

export default function BandejaPage() {
  return (
    <RequireDocumentos>
      <Bandeja />
    </RequireDocumentos>
  );
}

function Bandeja() {
  const recurso = useBandejaSgc();
  const catalogos = useCatalogos();
  const items = recurso.data?.items || [];
  const lecturas = recurso.data?.lecturas_pendientes || [];
  // Desde «Mis lecturas pendientes» (/documentos/bandeja#lecturas): al llegar los datos se baja a ese grupo.
  const hayLecturas = lecturas.length > 0;
  useEffect(() => {
    if (hayLecturas && window.location.hash === "#lecturas") document.getElementById("lecturas")?.scrollIntoView({ block: "start" });
  }, [hayLecturas]);
  const conocidos = new Set(GRUPOS.flatMap((g) => g.tipos));
  const otras = items.filter((t) => !conocidos.has(t.tipo));
  let i = 0;
  const siguiente = () => i++;
  return (
    <PageBody>
      <div className="flex flex-col gap-2">
        <RutaDocumentos documento="Bandeja" />
        <PageHeader title="Bandeja" description="Lo que te toca en Documentos SGC." />
      </div>
      {recurso.error ? (
        <ErrorState message={recurso.error} onRetry={recurso.reload} />
      ) : !recurso.data ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-[180px] rounded-card" />
        </div>
      ) : !items.length && !lecturas.length ? (
        <div className="rounded-card bg-surface shadow-card" data-testid="bandeja-vacia">
          <EmptyState icon={<MarcaDibujada className="h-12 w-12 text-success" />} title="No tienes pendientes" description="Cuando te toque revisar, autorizar o leer algo, aparecerá aquí y en la campana." />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {GRUPOS.map((g) => {
            const lista = items.filter((t) => g.tipos.includes(t.tipo));
            if (!lista.length) return null;
            return (
              <GrupoTareas key={g.clave} grupo={g} total={lista.length}>
                {lista.map((t) => (
                  <Renglon key={t.clave} t={t} tipo={t.tipo} area={areaDeClave(catalogos.data?.areas, t.clave_documento)} icono={g.icono} i={siguiente()} testid="bandeja-tarea" />
                ))}
              </GrupoTareas>
            );
          })}
          {otras.length ? (
            <GrupoTareas grupo={{ clave: "otras", titulo: "Otras tareas", icono: ICONO_TAREA.vacia, tipos: [] }} total={otras.length}>
              {otras.map((t) => (
                <Renglon key={t.clave} t={t} tipo={t.tipo} area={areaDeClave(catalogos.data?.areas, t.clave_documento)} icono={ICONO_TAREA.vacia} i={siguiente()} testid="bandeja-tarea" />
              ))}
            </GrupoTareas>
          ) : null}
          {lecturas.length ? (
            <GrupoTareas grupo={{ clave: "lecturas", titulo: "Lecturas pendientes", icono: ICONO_TAREA.lectura, tipos: [] }} total={lecturas.length} id="lecturas" testid="bandeja-lecturas">
              {lecturas.map((t) => (
                <Renglon key={t.clave} t={t} tipo="lectura" area={areaDeClave(catalogos.data?.areas, t.clave_documento)} icono={ICONO_TAREA.lectura} i={siguiente()} testid="bandeja-lectura" recordatorio={/recordatorio/.test(t.accion)} />
              ))}
            </GrupoTareas>
          ) : null}
        </div>
      )}
    </PageBody>
  );
}

function GrupoTareas({ grupo, total, id, testid, children }: { grupo: Grupo; total: number; id?: string; testid?: string; children: React.ReactNode }) {
  const I = grupo.icono;
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-2" aria-label={`${grupo.titulo}: ${total}`} data-testid={testid || "bandeja-grupo"} data-grupo={grupo.clave}>
      <h2 className="eyebrow flex items-center gap-2 px-1 text-ink-3">
        <I size={15} weight="bold" aria-hidden="true" />
        {grupo.titulo}
        <span className="tnum flex h-[18px] min-w-[20px] items-center justify-center rounded-full bg-surface-3 px-1.5 text-2xs text-ink-2" data-testid="bandeja-contador" data-valor={total}>
          <Conteo valor={total} duracion={300} />
        </span>
      </h2>
      <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">{children}</ul>
    </section>
  );
}

function Renglon({ t, tipo, area, icono: Icono, i, testid, recordatorio }: { t: TareaSgc; tipo: string; area: Area | null; icono: Icon; i: number; testid: string; recordatorio?: boolean }) {
  const router = useRouter();
  const accion = ACCION[tipo] || { etiqueta: "Abrir" };
  return (
    <li className="entrada-escalonada flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors duration-200 hover:bg-surface-2/70 sm:px-5" style={{ ["--i" as string]: i } as CSSProperties} data-testid={testid} data-tipo={t.tipo}>
      {area ? (
        <IconoArea area={area} size="sm" />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-field bg-surface-2 text-ink-3 ring-1 ring-line" aria-hidden="true">
          <Icono size={16} weight="duotone" />
        </span>
      )}
      <div className="flex min-w-0 flex-[1_1_12rem] flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {t.clave_documento ? <span className="code text-xs font-semibold text-ink-2">{t.clave_documento}</span> : null}
          {t.revision !== null ? <span className="tnum text-xs text-ink-3">Rev. {t.revision}</span> : null}
          {t.papel ? <Badge tone="neutral">{t.papel}</Badge> : null}
          {recordatorio ? <Badge tone="warning">Recordatorio</Badge> : null}
        </span>
        <span className="truncate text-base font-medium text-ink" title={t.titulo}>
          {t.titulo}
        </span>
      </div>
      {t.fecha_limite ? (
        <span className={cn("flex items-center gap-1 text-xs", t.vencida ? "rounded-full bg-danger-soft px-2 py-0.5 font-semibold text-danger-text" : "text-ink-3")} data-testid={t.vencida ? "bandeja-vencida" : undefined}>
          {t.vencida ? <WarningCircle size={14} weight="bold" aria-hidden="true" /> : <Clock size={14} aria-hidden="true" />}
          {t.vencida ? "Venció el" : "Límite"} {formatearFecha(t.fecha_limite)}
        </span>
      ) : null}
      <Button size="sm" variant={accion.abrir || tipo === "lectura" ? "primary" : "secondary"} onClick={() => router.push(destino(t, tipo))} title={t.accion} data-testid="bandeja-accion">
        {accion.etiqueta}
      </Button>
    </li>
  );
}
