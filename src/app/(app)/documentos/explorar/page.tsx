"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type KeyboardEvent } from "react";
import { CaretDown, FilePlus, Files, Plus, SortAscending } from "@phosphor-icons/react";
import { SolicitudSheet } from "@/components/features/documentos/SolicitudSheets";
import { areaDe, ConfidencialidadEtiqueta, EstadoDocumentoEtiqueta, ExternoEtiqueta, IconoArea, nombreTipo, ProximaRevisionEtiqueta, RequireDocumentos, RutaDocumentos, useCatalogos, type DocLista } from "@/components/features/documentos/comun";
import { FichaSheet } from "@/components/features/documentos/FichaSheet";
import { ICONO_ESTADO } from "@/components/features/documentos/iconos";
import { MiniaturaDocumento } from "@/components/features/documentos/Miniatura";
import { PageBody } from "@/components/shell/AppShell";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { DateInput } from "@/components/ui/DateInput";
import { FilterMenu, type FilterGroup } from "@/components/ui/FilterMenu";
import { Dropdown } from "@/components/ui/Overlay";
import { PageHeader, SearchInput, Toolbar } from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { useDebouncedValue, useInitialParam } from "@/lib/client/hooks";
import { useResource } from "@/lib/client/store";
import { ESTADO_REVISION } from "@/lib/shared/documentos";

/*
 * Carpeta de documentos: ruta corta "Documentos › Gestión › Tipo", buscador y
 * un solo boton "Filtros" (tipo, estado, origen, propietario, fecha de emision y obsoletos con permiso), el
 * orden en un menu pequeño y los documentos como tarjetas con la miniatura de
 * la primera pagina del PDF vigente. El servidor devuelve solo lo que la
 * persona puede ver.
 */

interface Respuesta {
  items: DocLista[];
  propietarios: Array<{ id: number; nombre: string }>;
  puede: { crear_ficha: boolean; proponer: boolean; ver_obsoletos: boolean };
  diagnostico: boolean;
}

const ORDENES = [
  { value: "clave", label: "Clave" },
  { value: "titulo", label: "Título A–Z" },
  { value: "recientes", label: "Más recientes" },
  { value: "proxima", label: "Próxima revisión" },
] as const;

export default function ExplorarPage() {
  return (
    <RequireDocumentos>
      <Suspense fallback={<Skeleton className="h-[480px]" />}>
        <Explorador />
      </Suspense>
    </RequireDocumentos>
  );
}

function Explorador() {
  const { token } = useSession();
  const router = useRouter();
  const catalogos = useCatalogos();
  const [search, setSearch] = useState(useInitialParam("buscar"));
  const [area, setArea] = useState(useInitialParam("area").toUpperCase());
  const [tipo, setTipo] = useState(useInitialParam("tipo").toUpperCase());
  const [estado, setEstado] = useState(useInitialParam("estado"));
  const [origen, setOrigen] = useState(useInitialParam("origen"));
  // Especificacion 5 (busqueda y filtros): tambien por responsable (propietario) y por fecha de emision.
  const [propietario, setPropietario] = useState("");
  const [periodo, setPeriodo] = useState("todo");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [orden, setOrden] = useState("clave");
  const [obsoletos, setObsoletos] = useState(false);
  const [solicitud, setSolicitud] = useState(false);
  const [nueva, setNueva] = useState(useInitialParam("nueva") === "1");
  const debounced = useDebouncedValue(search);

  // La ruta y los filtros viven en la URL (se pueden compartir y la ruta de navegacion los refleja).
  useEffect(() => {
    const q = new URLSearchParams();
    if (area) q.set("area", area);
    if (tipo) q.set("tipo", tipo);
    if (estado) q.set("estado", estado);
    if (debounced.trim()) q.set("buscar", debounced.trim());
    const destino = `/documentos/explorar${q.toString() ? `?${q}` : ""}`;
    if (`${window.location.pathname}${window.location.search}` !== destino) window.history.replaceState(null, "", destino);
  }, [area, tipo, estado, debounced]);

  const recurso = useResource<Respuesta>(
    "sgc",
    async () => {
      const q = new URLSearchParams({ search: debounced.trim(), orden });
      for (const [k, val] of Object.entries({ area, tipo, estado, origen, propietario })) if (val) q.set(k, val);
      if (obsoletos) q.set("obsoletos", "1");
      if (periodo === "rango") {
        if (desde) q.set("desde", desde);
        if (hasta) q.set("hasta", hasta);
      }
      return (await getJsonAuth(`${API_BASE_URL}/sgc/documentos?${q.toString()}`, token)) as unknown as Respuesta;
    },
    { enabled: !!token, deps: [debounced, area, tipo, estado, origen, propietario, periodo, desde, hasta, orden, obsoletos] },
  );
  const data = recurso.data;
  const items = data?.items || [];
  const cat = catalogos.data;
  const areaSel = area ? areaDe(cat?.areas, area) : null;
  const tipoSel = tipo ? { codigo: tipo, nombre: nombreTipo(cat?.tipos, tipo) } : null;

  const groups: FilterGroup[] = [
    // Dentro de una carpeta el area la fija la ruta; sin carpeta (busqueda general) se puede elegir.
    ...(area ? [] : [{ key: "area", label: "Gestión", value: area, defaultValue: "", onChange: setArea, options: [{ value: "", label: "Todas" }, ...(cat?.areas || []).map((a) => ({ value: a.codigo, label: `${a.codigo} · ${a.nombre}` }))] }]),
    { key: "tipo", label: "Tipo documental", value: tipo, defaultValue: "", onChange: setTipo, options: [{ value: "", label: "Todos" }, ...(cat?.tipos || []).map((t) => ({ value: t.codigo, label: `${t.codigo} · ${t.nombre}` }))] },
    {
      key: "estado",
      label: "Estado",
      value: estado,
      defaultValue: "",
      onChange: setEstado,
      options: [
        { value: "", label: "Todos" },
        { value: "vigente", label: "Vigentes" },
        { value: "en_curso", label: "En elaboración, revisión o autorización" },
        { value: "en_revision", label: "En revisión o autorización" },
        { value: "borrador", label: "Con borrador en curso" },
        { value: "en_elaboracion", label: "Sin revisión vigente" },
        { value: "pendiente_revision", label: "Pendientes de revisión" },
        { value: "obsoleto", label: "Obsoletos" },
      ],
    },
    { key: "origen", label: "Origen", value: origen, defaultValue: "", onChange: setOrigen, options: [{ value: "", label: "Todos" }, { value: "interno", label: "Internos" }, { value: "externo", label: "Externos" }] },
    { key: "propietario", label: "Propietario", value: propietario, defaultValue: "", onChange: setPropietario, options: [{ value: "", label: "Todos" }, ...(data?.propietarios || []).map((p) => ({ value: String(p.id), label: p.nombre }))] },
    {
      key: "periodo",
      label: "Fecha de emisión",
      value: periodo,
      defaultValue: "todo",
      onChange: setPeriodo,
      options: [
        { value: "todo", label: "Cualquiera" },
        { value: "rango", label: "Personalizado" },
      ],
      extra:
        periodo === "rango" ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-ink-3">
              Desde
              <DateInput id="sgc-desde" small value={desde} onChange={setDesde} aria-label="Desde" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-3">
              Hasta
              <DateInput id="sgc-hasta" small value={hasta} onChange={setHasta} aria-label="Hasta" />
            </label>
          </div>
        ) : undefined,
    },
  ];
  const filtrado = !!(debounced.trim() || tipo || estado || origen || propietario || periodo !== "todo" || (!areaSel && area));
  const abrir = (doc: DocLista) => router.push(`/documentos/${doc.id}`);
  const tecla = (doc: DocLista) => (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      abrir(doc);
    }
  };
  const ordenActual = ORDENES.find((o) => o.value === orden) || ORDENES[0];

  return (
    <PageBody>
      {/* Al entrar desde el inicio, la carpeta aparece suave (sin movimiento con movimiento reducido). */}
      <div className={cn("flex flex-col gap-2", areaSel && "transicion-carpeta")} data-testid="sgc-carpeta-encabezado">
        <RutaDocumentos area={areaSel} tipo={tipoSel} />
        <PageHeader
          title={areaSel ? areaSel.nombre : "Todos los documentos"}
          actions={
            <>
              {data?.puede.crear_ficha ? (
                <Button variant={data.puede.proponer ? "secondary" : "primary"} icon={<Plus size={16} weight="bold" />} onClick={() => setNueva(true)} data-testid="sgc-nueva-ficha">
                  Nueva ficha
                </Button>
              ) : null}
              {data?.puede.proponer ? (
                <Button icon={<FilePlus size={16} weight="bold" />} onClick={() => setSolicitud(true)} data-testid="sgc-explorar-solicitud">
                  Nueva solicitud
                </Button>
              ) : null}
            </>
          }
        />
      </div>

      <Toolbar
        end={
          <Dropdown
            label="Ordenar"
            align="end"
            trigger={
              <button type="button" className="press flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-ink-2 hover:bg-surface-3 hover:text-ink data-[state=open]:bg-surface-3" data-testid="sgc-ordenar">
                <SortAscending size={16} aria-hidden="true" />
                {ordenActual.label}
                <CaretDown size={12} aria-hidden="true" />
              </button>
            }
            items={ORDENES.map((o) => ({ label: o.label, onSelect: () => setOrden(o.value), tone: o.value === orden ? "brand" : "neutral" }))}
          />
        }
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por clave, título o palabras clave" className="w-full md:w-[360px]" />
        <FilterMenu groups={groups} toggles={data?.puede.ver_obsoletos ? [{ key: "obsoletos", label: "Mostrar obsoletos", description: "Fuera de los puntos de uso; solo para consulta histórica", checked: obsoletos, onChange: setObsoletos }] : []} />
      </Toolbar>

      {recurso.error ? (
        <ErrorState message={recurso.error} onRetry={recurso.reload} />
      ) : !data ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Cargando documentos">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i}>
              <Skeleton className="h-[264px] rounded-card" />
            </li>
          ))}
        </ul>
      ) : !items.length ? (
        <div className="rounded-card bg-surface shadow-card" data-testid="sgc-vacio">
          <EmptyState
            icon={<Files size={22} weight="duotone" />}
            title={filtrado ? "Nada coincide" : "Esta carpeta está vacía"}
            description={filtrado ? "Prueba con otra palabra o quita algún filtro." : data.puede.crear_ficha ? "Registra la primera ficha con «Nueva ficha»." : "Cuando se registren documentos, aparecerán aquí."}
          />
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Documentos" data-testid="sgc-tarjetas">
          {items.map((doc, i) => (
            <li key={doc.id} className="entrada-escalonada" style={{ ["--i" as string]: i }}>
              <Tarjeta doc={doc} area={areaDe(cat?.areas, doc.area_codigo)} tipo={nombreTipo(cat?.tipos, doc.tipo_codigo)} onAbrir={() => abrir(doc)} onKeyDown={tecla(doc)} />
            </li>
          ))}
        </ul>
      )}

      {solicitud ? <SolicitudSheet catalogos={cat || null} onClose={() => setSolicitud(false)} /> : null}
      {nueva && cat?.puede.crear_ficha ? <FichaSheet open onClose={() => setNueva(false)} catalogos={cat} areaInicial={area} tipoInicial={tipo} /> : null}
    </PageBody>
  );
}

/* Revision en curso, en pocas palabras y como en la Lista Maestra ("Rev. 3 en revisión"). */
const EN_CURSO: Record<string, string> = { borrador: "en elaboración", en_revision: "en revisión", en_autorizacion: "en autorización", autorizada: "por publicar" };
const enCursoTexto = (doc: DocLista) => (doc.trabajo ? `Rev. ${doc.trabajo.numero} ${EN_CURSO[doc.trabajo.estado] || "en curso"}` : "");

function Tarjeta({ doc, area, tipo, onAbrir, onKeyDown }: { doc: DocLista; area: ReturnType<typeof areaDe>; tipo: string; onAbrir: () => void; onKeyDown: (event: KeyboardEvent) => void }) {
  const IconoCurso = doc.trabajo ? ICONO_ESTADO[ESTADO_REVISION[doc.trabajo.estado]?.icono || "borrador"] : null;
  return (
    <article
      tabIndex={0}
      role="link"
      aria-label={`Abrir ${doc.clave} ${doc.titulo}`}
      onClick={onAbrir}
      onKeyDown={onKeyDown}
      data-testid="sgc-tarjeta"
      data-clave={doc.clave}
      className="group flex h-full cursor-pointer flex-col overflow-hidden rounded-card bg-surface shadow-card transition-[box-shadow,transform,translate] duration-200 ease-[var(--ease-fluid)] hover:-translate-y-0.5 hover:shadow-raised motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <div className="relative">
        <MiniaturaDocumento doc={doc} className="aspect-[4/3] w-full border-b border-line" />
        {/* Banda superior con el color del area (identifica la gestion, nunca el estado). */}
        <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: area.color }} aria-hidden="true" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3.5">
        <div className="flex items-center gap-2">
          <IconoArea area={area} size="sm" />
          <span className="flex min-w-0 flex-col">
            <span className="code truncate text-xs font-semibold text-ink-2">{doc.clave}</span>
            <span className="truncate text-2xs text-ink-3">{tipo}</span>
          </span>
        </div>
        <h3 className="line-clamp-2 break-words text-base font-semibold leading-snug text-ink" title={doc.titulo}>
          {doc.titulo}
        </h3>
        {/* Revision, estado y marcas siempre al pie de la tarjeta. */}
        <div className="mt-auto flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {doc.vigente ? <span className="tnum text-xs font-medium text-ink-2">Rev. {doc.vigente.numero}</span> : null}
            <EstadoDocumentoEtiqueta estado={doc.estado} />
            <ProximaRevisionEtiqueta fecha={doc.vigente?.fecha_proxima_revision} />
            {doc.origen === "externo" ? <ExternoEtiqueta /> : null}
            <ConfidencialidadEtiqueta valor={doc.confidencialidad} />
          </div>
          {doc.trabajo && IconoCurso ? (
            <p className="flex items-center gap-1 text-2xs text-ink-3" data-testid="sgc-tarjeta-en-curso">
              <IconoCurso size={12} weight="bold" aria-hidden="true" />
              {enCursoTexto(doc)}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
