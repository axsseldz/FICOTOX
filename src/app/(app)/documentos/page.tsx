"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle, FilePlus, Plus } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { IconoArea, RequireDocumentos, useCatalogos, type Area, type DocLista } from "@/components/features/documentos/comun";
import { SolicitudSheet } from "@/components/features/documentos/SolicitudSheets";
import { Callout } from "@/components/features/samples/FormLayout";
import { PageBody } from "@/components/shell/AppShell";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { Conteo } from "@/components/ui/Conteo";
import { PageHeader, SearchInput } from "@/components/ui/PageHeader";
import { ErrorState, Skeleton } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { useResource } from "@/lib/client/store";

/*
 * Documentos SGC (inicio): un buscador (clave, título o palabra clave, con resultados
 * en vivo) y las seis carpetas de área en cuadrícula. Cada carpeta lleva su color
 * (banda lateral; nunca como fondo de texto) y el número de vigentes. Los indicadores,
 * la actividad y los accesos a Bandeja, Solicitudes, Externos y Lista Maestra viven en
 * el menú lateral y en sus propias pantallas.
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
        <SearchInput value={texto} onChange={setTexto} placeholder="Buscar por clave, título o palabra clave" className="w-full text-[15px]" autoFocus />
        {consulta.length >= 2 ? (
          <div className="flex flex-col overflow-hidden rounded-card bg-surface shadow-card" data-testid="sgc-resultados">
            {buscados.data?.items?.length ? (
              buscados.data.items.slice(0, 8).map((d) => (
                <Link key={d.id} href={`/documentos/${d.id}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-surface-2 focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none">
                  <span className="code text-[12.5px] font-semibold text-brand-strong">{d.clave}</span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{d.titulo}</span>
                </Link>
              ))
            ) : (
              <p className="px-4 py-3 text-[13px] text-ink-3">{buscados.data ? "Ningún documento coincide con la búsqueda." : "Buscando…"}</p>
            )}
          </div>
        ) : null}
      </div>

      {recurso.error ? (
        <ErrorState message={recurso.error} onRetry={recurso.reload} />
      ) : !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-card" />
          ))}
        </div>
      ) : (
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
      )}
      {solicitud ? <SolicitudSheet catalogos={cat || null} onClose={() => setSolicitud(false)} /> : null}
    </PageBody>
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
      className="press group relative flex h-full overflow-hidden rounded-card bg-surface shadow-card transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-raised focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      {/* Banda lateral con el color del area (el estado nunca se expresa con este color). */}
      <span className="w-1.5 shrink-0" style={{ backgroundColor: area.color }} aria-hidden="true" />
      <span className="flex min-w-0 flex-1 items-center gap-3 p-4">
        <IconoArea area={area} carpeta />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="code text-[12px] font-semibold tracking-wide text-ink-3">{area.codigo}</span>
          <span className="text-[15px] font-semibold leading-snug text-ink">{area.nombre}</span>
        </span>
        <span className="tnum flex shrink-0 items-center gap-1 text-[12.5px] text-ink-3" title="Documentos vigentes" data-testid="sgc-carpeta-vigentes" data-valor={c.vigentes}>
          <CheckCircle size={14} weight="bold" aria-hidden="true" />
          <Conteo valor={c.vigentes} duracion={300} />
          <span className="sr-only">{c.vigentes} vigentes</span>
        </span>
      </span>
    </Link>
  );
}
