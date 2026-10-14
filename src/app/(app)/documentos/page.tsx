"use client";

import Link from "next/link";
import { CheckCircle, Clock, FileDashed, MagnifyingGlass, PaperPlaneTilt, Plus, BookOpenText } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { IconoArea, RequireDocumentos, type Area } from "@/components/features/documentos/comun";
import { Callout } from "@/components/features/samples/FormLayout";
import { PageBody } from "@/components/shell/AppShell";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, Skeleton } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { useResource } from "@/lib/client/store";

/*
 * Documentos SGC (inicio): las seis carpetas de la carpeta institucional, por
 * area de gestion, con su color (en el icono y una banda lateral; nunca como
 * fondo de texto) y los conteos por estado de lo que la persona puede ver.
 */

interface Conteos {
  total: number;
  vigentes: number;
  en_revision: number;
  borradores: number;
  proximos: number;
  obsoletos: number;
}
interface Resumen {
  areas: Array<Area & { conteos: Conteos }>;
  totales: Conteos;
  lecturas_pendientes: number;
  puede: { crear_ficha: boolean };
  diagnostico: boolean;
}

export default function DocumentosPage() {
  return (
    <RequireDocumentos>
      <Inicio />
    </RequireDocumentos>
  );
}

function Inicio() {
  const { token } = useSession();
  const router = useRouter();
  const recurso = useResource<Resumen>(["sgc", "sgc-resumen"], async () => (await getJsonAuth(`${API_BASE_URL}/sgc/resumen`, token)) as unknown as Resumen, { enabled: !!token });
  const data = recurso.data;
  return (
    <PageBody>
      <PageHeader
        eyebrow="Calidad"
        title="Documentos SGC"
        description="Documentos controlados del Sistema de Gestión de Calidad, organizados por gestión como en la carpeta institucional."
        actions={
          <>
            <Button variant="secondary" icon={<MagnifyingGlass size={16} />} onClick={() => router.push("/documentos/explorar")}>
              Explorar documentos
            </Button>
            {data?.puede.crear_ficha ? (
              <Button icon={<Plus size={16} weight="bold" />} data-testid="sgc-nueva-ficha" onClick={() => router.push("/documentos/explorar?nueva=1")}>
                Nueva ficha
              </Button>
            ) : null}
          </>
        }
      />

      {data?.diagnostico ? (
        <Callout tone="info" title="Vista de diagnóstico">
          Como administración técnica ves los metadatos de los documentos de uso interno para dar soporte, pero no abres sus archivos ni actúas en el flujo documental.
        </Callout>
      ) : null}

      {recurso.error ? (
        <ErrorState message={recurso.error} onRetry={recurso.reload} />
      ) : !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[168px] rounded-card" />
          ))}
        </div>
      ) : (
        <>
          <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Indicador icono={<CheckCircle size={18} weight="duotone" />} etiqueta="Vigentes" valor={data.totales.vigentes} href="/documentos/explorar?estado=vigente" />
            <Indicador icono={<PaperPlaneTilt size={18} weight="duotone" />} etiqueta="En revisión" valor={data.totales.en_revision} href="/documentos/explorar?estado=en_revision" />
            <Indicador icono={<Clock size={18} weight="duotone" />} etiqueta="Próximos a revisar" valor={data.totales.proximos} href="/documentos/explorar?estado=proxima_revision" />
            <Indicador icono={<BookOpenText size={18} weight="duotone" />} etiqueta="Lecturas pendientes" valor={data.lecturas_pendientes} nota="Disponible con la distribución" />
          </section>

          <section aria-labelledby="carpetas-titulo" className="flex flex-col gap-3">
            <h2 id="carpetas-titulo" className="text-[15px] font-semibold text-ink">
              Carpetas por gestión
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="sgc-carpetas">
              {data.areas.map((area, i) => (
                <li key={area.codigo} className="entrada-escalonada" style={{ ["--i" as string]: i }}>
                  <Carpeta area={area} />
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </PageBody>
  );
}

function Indicador({ icono, etiqueta, valor, href, nota }: { icono: React.ReactNode; etiqueta: string; valor: number; href?: string; nota?: string }) {
  const cuerpo = (
    <div className="flex h-full flex-col gap-1.5 rounded-card bg-surface p-4 shadow-card transition-shadow hover:shadow-raised">
      <span className="flex items-center gap-2 text-[12.5px] font-medium text-ink-3">
        <span className="text-ink-3">{icono}</span>
        {etiqueta}
      </span>
      <span className="tnum text-[24px] font-semibold tracking-[-0.02em] text-ink">{valor}</span>
      {nota ? <span className="text-[11.5px] text-ink-4">{nota}</span> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="rounded-card focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none">
      {cuerpo}
    </Link>
  ) : (
    cuerpo
  );
}

function Carpeta({ area }: { area: Area & { conteos: Conteos } }) {
  const c = area.conteos;
  const filas: Array<{ icono: React.ReactNode; etiqueta: string; valor: number }> = [
    { icono: <CheckCircle size={14} weight="bold" />, etiqueta: "Vigentes", valor: c.vigentes },
    { icono: <PaperPlaneTilt size={14} weight="bold" />, etiqueta: "En revisión", valor: c.en_revision },
    { icono: <FileDashed size={14} weight="bold" />, etiqueta: "Borradores", valor: c.borradores },
    { icono: <Clock size={14} weight="bold" />, etiqueta: "Próximos a revisar", valor: c.proximos },
  ];
  return (
    <Link
      href={`/documentos/explorar?area=${area.codigo}`}
      data-testid="sgc-carpeta"
      data-area={area.codigo}
      aria-label={`${area.codigo}, ${area.nombre}: ${c.total} documentos`}
      className="group relative flex h-full overflow-hidden rounded-card bg-surface shadow-card transition-shadow hover:shadow-raised focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none"
    >
      {/* Banda lateral con el color del area (el estado nunca se expresa con este color). */}
      <span className="w-1.5 shrink-0" style={{ backgroundColor: area.color }} aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <span className="flex items-center gap-3">
          <IconoArea area={area} />
          <span className="flex min-w-0 flex-col">
            <span className="code text-[12px] font-semibold tracking-wide text-ink-3">{area.codigo}</span>
            <span className="text-[15px] font-semibold leading-snug text-ink">{area.nombre}</span>
          </span>
          <span className="tnum ml-auto text-[13px] text-ink-3">{c.total} doc.</span>
        </span>
        <span className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {filas.map((f) => (
            <span key={f.etiqueta} className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
              <span className="text-ink-3" aria-hidden="true">
                {f.icono}
              </span>
              <span className="truncate">{f.etiqueta}</span>
              <span className="tnum ml-auto font-semibold text-ink">{f.valor}</span>
            </span>
          ))}
        </span>
      </span>
    </Link>
  );
}
