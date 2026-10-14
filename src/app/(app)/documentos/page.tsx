"use client";

import Link from "next/link";
import { CheckCircle, Clock, FileDashed, MagnifyingGlass, PaperPlaneTilt, Plus, BookOpenText, FilePlus, Tray, Globe, ListChecks, Megaphone, ClockCounterClockwise } from "@phosphor-icons/react";
import { useBandejaSgc } from "@/components/features/documentos/bandeja";
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
import { formatearFechaHora } from "@/lib/shared/fechas";

/*
 * Documentos SGC (inicio): las seis carpetas de la carpeta institucional, por
 * area de gestion, con su color (en el icono y una banda lateral; nunca como
 * fondo de texto) y los conteos por estado de lo que la persona puede ver.
 * Fase 3: indicadores de la vista general (vigentes, en revision y
 * autorizacion, por publicar, pendientes de revision internos y externos,
 * lecturas pendientes) y actividad reciente, todo sobre lo visible.
 */

const ACCION_ACTIVIDAD: Record<string, string> = {
  crear: "Registró",
  editar: "Editó",
  publicar: "Publicó",
  verificar: "Verificó la vigencia de",
  confirmar_lectura: "Confirmó la lectura de",
  distribuir: "Distribuyó",
  retirar_distribucion: "Retiró un destinatario de",
  recordar: "Envió un recordatorio de lectura de",
  descargar: "Descargó",
  consultar: "Consultó",
  anular: "Declaró obsoleto",
  asignar: "Asignó responsables en",
  enviar_revision: "Envió a revisión",
  revisar: "Revisó",
  autorizar: "Autorizó",
  devolver: "Devolvió",
  rechazar: "Rechazó",
  subir: "Cargó un archivo en",
  nueva_revision: "Abrió una nueva revisión de",
  exportar: "Exportó",
  aceptar: "Aceptó la solicitud de",
  solicitar: "Solicitó un cambio en",
  proponer: "Propuso un cambio en",
  reasignar: "Reasignó responsables en",
  cancelar: "Canceló una revisión de",
};

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
  indicadores: { vigentes: number; en_revision: number; por_publicar: number; pendientes_revision: { internos: number; externos: number }; lecturas_mias: number; lecturas_globales: number | null; externos: number };
  lecturas_pendientes: number;
  actividad: Array<{ id: number; fecha_hora: string; usuario_nombre: string | null; accion: string; documento_id: number; referencia: string | null }>;
  puede: { crear_ficha: boolean; lista_maestra: boolean; exportar_maestra: boolean; externos: boolean; registrar_externo: boolean };
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
  const bandeja = useBandejaSgc();
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
            <Button variant="secondary" icon={<Tray size={16} />} onClick={() => router.push("/documentos/bandeja")} data-testid="sgc-ir-bandeja">
              Bandeja{bandeja.data?.total ? ` · ${bandeja.data.total}` : ""}
            </Button>
            <Button variant="secondary" icon={<FilePlus size={16} />} onClick={() => router.push("/documentos/solicitudes")}>
              Solicitudes
            </Button>
            {data?.puede.externos ? (
              <Button variant="secondary" icon={<Globe size={16} />} onClick={() => router.push("/documentos/externos")} data-testid="sgc-ir-externos">
                Externos
              </Button>
            ) : null}
            {data?.puede.lista_maestra ? (
              <Button variant="secondary" icon={<ListChecks size={16} />} onClick={() => router.push("/documentos/lista-maestra")} data-testid="sgc-ir-maestra">
                Lista Maestra
              </Button>
            ) : null}
            <Button variant="secondary" icon={<MagnifyingGlass size={16} />} onClick={() => router.push("/documentos/explorar")}>
              Explorar
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
          <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="sgc-indicadores">
            <Indicador icono={<CheckCircle size={18} weight="duotone" />} etiqueta="Vigentes" valor={data.indicadores.vigentes} href="/documentos/explorar?estado=vigente" testid="ind-vigentes" />
            <Indicador icono={<PaperPlaneTilt size={18} weight="duotone" />} etiqueta="En revisión y autorización" valor={data.indicadores.en_revision} href="/documentos/explorar?estado=en_revision" testid="ind-revision" />
            <Indicador icono={<Megaphone size={18} weight="duotone" />} etiqueta="Por publicar" valor={data.indicadores.por_publicar} href={data.puede.crear_ficha ? "/documentos/bandeja" : undefined} testid="ind-publicar" />
            <Indicador
              icono={<Clock size={18} weight="duotone" />}
              etiqueta="Pendientes de revisión"
              valor={data.indicadores.pendientes_revision.internos + data.indicadores.pendientes_revision.externos}
              nota={`${data.indicadores.pendientes_revision.internos} internos · ${data.indicadores.pendientes_revision.externos} externos`}
              href="/documentos/explorar?estado=pendiente_revision"
              testid="ind-pendientes"
            />
            <Indicador
              icono={<BookOpenText size={18} weight="duotone" />}
              etiqueta="Mis lecturas pendientes"
              valor={data.indicadores.lecturas_mias}
              nota={data.indicadores.lecturas_globales !== null ? `${data.indicadores.lecturas_globales} pendientes en todo el laboratorio` : undefined}
              href="/documentos/bandeja#lecturas"
              testid="ind-lecturas"
            />
          </section>

          {data.actividad.length ? (
            <section aria-labelledby="actividad-titulo" className="flex flex-col gap-2">
              <h2 id="actividad-titulo" className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                <ClockCounterClockwise size={18} weight="duotone" className="text-ink-3" aria-hidden="true" />
                Actividad reciente
              </h2>
              <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card" data-testid="sgc-actividad">
                {data.actividad.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-[13px]">
                    <span className="min-w-0 flex-1 text-ink-2">
                      <span className="font-medium text-ink">{e.usuario_nombre || "Sistema"}</span> {(ACCION_ACTIVIDAD[e.accion] || e.accion.replace(/_/g, " ")).toLowerCase()}{" "}
                      <Link href={`/documentos/${e.documento_id}`} className="code font-semibold text-brand-strong hover:underline">
                        {e.referencia || `documento ${e.documento_id}`}
                      </Link>
                    </span>
                    <span className="tnum text-[12px] text-ink-3">{formatearFechaHora(e.fecha_hora)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

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

function Indicador({ icono, etiqueta, valor, href, nota, testid }: { icono: React.ReactNode; etiqueta: string; valor: number; href?: string; nota?: string; testid?: string }) {
  const cuerpo = (
    <div className="flex h-full flex-col gap-1.5 rounded-card bg-surface p-4 shadow-card transition-shadow hover:shadow-raised" data-testid={testid} data-valor={valor}>
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
    { icono: <Clock size={14} weight="bold" />, etiqueta: "Pend. de revisión", valor: c.proximos },
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
