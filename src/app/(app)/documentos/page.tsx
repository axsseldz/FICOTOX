"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { BookOpenText, CalendarCheck, CheckCircle, FilePlus, PencilLine, Plus } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { IconoArea, RequireDocumentos, useCatalogos, type Area, type DocLista } from "@/components/features/documentos/comun";
import { SolicitudSheet } from "@/components/features/documentos/SolicitudSheets";
import { Callout } from "@/components/features/samples/FormLayout";
import { PageBody } from "@/components/shell/AppShell";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { Conteo } from "@/components/ui/Conteo";
import { PageHeader, SearchInput } from "@/components/ui/PageHeader";
import { ErrorState, Skeleton } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { useResource } from "@/lib/client/store";

/*
 * Documentos SGC (inicio): un buscador (clave, título o palabra clave, con resultados
 * en vivo), una fila de cuatro indicadores (especificacion §5 y §8) y las seis carpetas
 * de área en cuadrícula. Cada carpeta lleva su color (banda lateral; nunca como fondo de
 * texto) y el número de vigentes. Los indicadores cuentan solo lo que la persona ve
 * (permisos y confidencialidad) y llevan a la lista o a la Bandeja ya filtrada. La
 * actividad reciente y los accesos a Bandeja, Solicitudes, Externos y Lista Maestra
 * viven en el menú lateral y en sus propias pantallas.
 */
interface Conteos {
  total: number;
  vigentes: number;
  en_revision: number;
  borradores: number;
  proximos: number;
  obsoletos: number;
}
interface Indicadores {
  vigentes: number;
  en_curso: number;
  proximos_revision: number;
  lecturas_mias: number;
}
interface Resumen {
  areas: Array<Area & { conteos: Conteos }>;
  indicadores: Indicadores;
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
  const catalogos = useCatalogos();
  const cat = catalogos.data;
  // Accion principal: "Nueva solicitud" para quien puede proponer; Mejora Continua (crear ficha) ve tambien "Nueva ficha".
  const proponer = !!cat?.yo.acciones.includes("documento_proponer");
  const crearFicha = !!(cat?.puede.crear_ficha || data?.puede.crear_ficha);
  const [solicitud, setSolicitud] = useState(false);
  const [texto, setTexto] = useState("");
  const [consulta, setConsulta] = useState("");
  // Busqueda en vivo: espera un momento tras la ultima tecla.
  useEffect(() => {
    const t = window.setTimeout(() => setConsulta(texto.trim()), 250);
    return () => window.clearTimeout(t);
  }, [texto]);
  const buscados = useResource<{ items: DocLista[] }>(
    "sgc-buscar",
    async () => (await getJsonAuth(`${API_BASE_URL}/sgc/documentos?search=${encodeURIComponent(consulta)}`, token)) as unknown as { items: DocLista[] },
    { enabled: !!token && consulta.length >= 2, deps: [consulta] },
  );

  return (
    <PageBody>
      <PageHeader
        eyebrow="Calidad"
        title="Documentos SGC"
        description="Documentos controlados del Sistema de Gestión de Calidad."
        actions={
          // Los botones aparecen cuando se conocen los permisos (sin que «Nueva ficha» cambie de principal a secundario).
          cat ? (
            <>
              {crearFicha ? (
                <Button variant={proponer ? "secondary" : "primary"} icon={<Plus size={16} weight="bold" />} data-testid="sgc-nueva-ficha" onClick={() => router.push("/documentos/explorar?nueva=1")}>
                  Nueva ficha
                </Button>
              ) : null}
              {proponer ? (
                <Button icon={<FilePlus size={16} weight="bold" />} data-testid="sgc-nueva-solicitud" onClick={() => setSolicitud(true)}>
                  Nueva solicitud
                </Button>
              ) : null}
            </>
          ) : null
        }
      />
      {data?.diagnostico ? (
        <Callout tone="info" title="Vista de diagnóstico">
          Como administración técnica ves los metadatos de los documentos de uso interno para dar soporte, pero no abres sus archivos ni actúas en el flujo documental.
        </Callout>
      ) : null}

      <div className="flex flex-col gap-3" data-testid="sgc-buscador">
        <SearchInput value={texto} onChange={setTexto} placeholder="Buscar por clave, título o palabra clave" className="w-full" autoFocus />
        {consulta.length >= 2 ? (
          <div className="flex flex-col overflow-hidden rounded-card bg-surface shadow-card" data-testid="sgc-resultados">
            {buscados.data?.items?.length ? (
              buscados.data.items.slice(0, 8).map((d) => (
                <Link key={d.id} href={`/documentos/${d.id}`} className="foco-interior flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-surface-2">
                  <span className="code text-xs font-semibold text-brand-strong">{d.clave}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{d.titulo}</span>
                </Link>
              ))
            ) : (
              <p className="px-4 py-3 text-sm text-ink-3">{buscados.data ? "Ningún documento coincide con la búsqueda." : "Buscando…"}</p>
            )}
          </div>
        ) : null}
      </div>

      {recurso.error ? (
        <ErrorState message={recurso.error} onRetry={recurso.reload} />
      ) : !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-[64px] rounded-card sm:col-span-2 xl:col-span-3" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-card" />
          ))}
        </div>
      ) : (
        <>
          <IndicadoresInicio ind={data.indicadores} />
          <section aria-labelledby="carpetas-titulo" className="flex flex-col gap-3">
            <h2 id="carpetas-titulo" className="text-md font-semibold text-ink">
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
      {solicitud ? <SolicitudSheet catalogos={cat || null} onClose={() => setSolicitud(false)} /> : null}
    </PageBody>
  );
}

type Tono = "success" | "brand" | "warning" | "violet";
const TONO: Record<Tono, string> = {
  success: "bg-success-soft text-success-text",
  brand: "bg-brand-soft text-brand-strong",
  warning: "bg-warning-soft text-warning-text",
  violet: "bg-violet-soft text-violet-text",
};

/*
 * Cuatro contadores en una fila compacta (2×2 en celular). Cada uno lleva a la lista
 * o a la Bandeja con el mismo criterio con que se cuenta. En 0 se ve en tono neutro.
 */
function IndicadoresInicio({ ind }: { ind: Indicadores }) {
  const lista: Array<{ clave: string; etiqueta: string; ayuda: string; valor: number; href: string; icono: ReactNode; tono: Tono }> = [
    { clave: "vigentes", etiqueta: "Vigentes", ayuda: "Documentos con una revisión vigente", valor: ind.vigentes, href: "/documentos/explorar?estado=vigente", icono: <CheckCircle size={18} weight="duotone" />, tono: "success" },
    { clave: "en_curso", etiqueta: "En revisión", ayuda: "En elaboración, revisión o autorización", valor: ind.en_curso, href: "/documentos/explorar?estado=en_curso", icono: <PencilLine size={18} weight="duotone" />, tono: "brand" },
    { clave: "proximos_revision", etiqueta: "Próximos a revisar", ayuda: "Su próxima revisión vence en 30 días o ya pasó", valor: ind.proximos_revision, href: "/documentos/explorar?estado=pendiente_revision", icono: <CalendarCheck size={18} weight="duotone" />, tono: "warning" },
    { clave: "lecturas_mias", etiqueta: "Mis lecturas pendientes", ayuda: "Documentos que te toca leer y confirmar", valor: ind.lecturas_mias, href: "/documentos/bandeja#lecturas", icono: <BookOpenText size={18} weight="duotone" />, tono: "violet" },
  ];
  return (
    <section aria-label="Indicadores" data-testid="sgc-indicadores">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {lista.map((x, i) => (
          <li key={x.clave} className="entrada-escalonada min-w-0" style={{ ["--i" as string]: i }}>
            <Link
              href={x.href}
              title={x.ayuda}
              data-testid="sgc-indicador"
              data-indicador={x.clave}
              data-valor={x.valor}
              className="press flex h-full min-w-0 items-center gap-3 rounded-card bg-surface px-3.5 py-3 shadow-card transition-[box-shadow,transform,translate] duration-200 hover:-translate-y-0.5 hover:shadow-raised motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <span aria-hidden="true" className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-field", x.valor ? TONO[x.tono] : "bg-surface-3 text-ink-3")}>
                {x.icono}
              </span>
              <span className="flex min-w-0 flex-col">
                <Conteo valor={x.valor} className={cn("text-3xl leading-none font-semibold tracking-snug", x.valor ? "text-ink" : "text-ink-3")} />
                <span className="mt-1 text-xs leading-tight text-ink-3">{x.etiqueta}</span>
                <span className="sr-only">
                  : {x.valor}. {x.ayuda}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Carpeta({ area }: { area: Area & { conteos: Conteos } }) {
  const c = area.conteos;
  return (
    <Link
      href={`/documentos/explorar?area=${area.codigo}`}
      data-testid="sgc-carpeta"
      data-area={area.codigo}
      aria-label={`${area.codigo}, ${area.nombre}: ${c.total} documentos`}
      className="press group relative flex h-full overflow-hidden rounded-card bg-surface shadow-card transition-[box-shadow,transform,translate] duration-200 hover:-translate-y-0.5 hover:shadow-raised motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      {/* Banda lateral con el color del area (el estado nunca se expresa con este color). */}
      <span className="w-1.5 shrink-0" style={{ backgroundColor: area.color }} aria-hidden="true" />
      <span className="flex min-w-0 flex-1 items-center gap-3 p-4">
        <IconoArea area={area} carpeta />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="code text-xs font-semibold tracking-wide text-ink-3">{area.codigo}</span>
          <span className="text-md font-semibold leading-snug text-ink">{area.nombre}</span>
        </span>
        <span className="tnum flex shrink-0 items-center gap-1 text-xs text-ink-3" title="Documentos vigentes" data-testid="sgc-carpeta-vigentes" data-valor={c.vigentes}>
          <CheckCircle size={14} weight="bold" aria-hidden="true" />
          <Conteo valor={c.vigentes} duracion={300} />
          <span className="sr-only">{c.vigentes} vigentes</span>
        </span>
      </span>
    </Link>
  );
}
