"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type KeyboardEvent } from "react";
import { Files, ListBullets, LockKey, Plus, SquaresFour } from "@phosphor-icons/react";
import { areaDe, ConfidencialidadEtiqueta, EstadoDocumentoEtiqueta, EstadoRevisionEtiqueta, IconoArea, nombreTipo, ProximaRevisionEtiqueta, RequireDocumentos, RutaDocumentos, useCatalogos, type DocLista } from "@/components/features/documentos/comun";
import { FichaSheet } from "@/components/features/documentos/FichaSheet";
import { PageBody } from "@/components/shell/AppShell";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { DateInput } from "@/components/ui/DateInput";
import { FilterMenu, type FilterGroup } from "@/components/ui/FilterMenu";
import { SinDato } from "@/components/ui/Insignias";
import { ListaCuadricula, type ColumnaLista } from "@/components/ui/ListaCuadricula";
import { PageHeader, SearchInput, Toolbar } from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { useDebouncedValue, useInitialParam } from "@/lib/client/hooks";
import { useResource } from "@/lib/client/store";
import { formatearFecha } from "@/lib/shared/fechas";

/*
 * Explorador documental: ruta "Documentos SGC › Gestión › Tipo", buscador
 * (clave, título, palabras clave), filtros (área, tipo, estado, origen,
 * propietario y fechas de emisión), orden y vista en tabla o tarjetas. El
 * servidor devuelve solo lo que la persona puede ver.
 */

type Vista = "tabla" | "tarjetas";
const CLAVE_VISTA = "ficotox.documentos.vista";

const COLUMNAS: ColumnaLista[] = [
  { clave: "documento", titulo: "Documento", ancho: "minmax(210px,2.4fr)" },
  { clave: "area", titulo: "Gestión · tipo", ancho: "minmax(128px,1fr)" },
  { clave: "revision", titulo: "Revisión vigente", ancho: "minmax(92px,0.8fr)" },
  { clave: "estado", titulo: "Estado", ancho: "minmax(136px,1.1fr)" },
  { clave: "propietario", titulo: "Propietario", ancho: "minmax(100px,0.9fr)", ocultaEnTarjeta: true },
];

interface Respuesta {
  items: DocLista[];
  propietarios: Array<{ id: number; nombre: string }>;
  puede: { crear_ficha: boolean };
  diagnostico: boolean;
}

export default function ExplorarPage() {
  return (
    <RequireDocumentos>
      <Suspense fallback={<Skeleton className="h-[480px]" />}>
        <Explorador />
      </Suspense>
    </RequireDocumentos>
  );
}

const leerVista = (): Vista => {
  try {
    return window.localStorage.getItem(CLAVE_VISTA) === "tarjetas" ? "tarjetas" : "tabla";
  } catch {
    return "tabla";
  }
};

function Explorador() {
  const { token } = useSession();
  const router = useRouter();
  const catalogos = useCatalogos();
  const [search, setSearch] = useState(useInitialParam("buscar"));
  const [area, setArea] = useState(useInitialParam("area").toUpperCase());
  const [tipo, setTipo] = useState(useInitialParam("tipo").toUpperCase());
  const [estado, setEstado] = useState(useInitialParam("estado"));
  const [origen, setOrigen] = useState("");
  const [propietario, setPropietario] = useState("");
  const [periodo, setPeriodo] = useState("todo");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [orden, setOrden] = useState("clave");
  const [vista, setVistaState] = useState<Vista>(() => (typeof window === "undefined" ? "tabla" : leerVista()));
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

  const setVista = (v: Vista) => {
    setVistaState(v);
    try {
      window.localStorage.setItem(CLAVE_VISTA, v);
    } catch {
      /* sin almacenamiento */
    }
  };

  const recurso = useResource<Respuesta>(
    "sgc",
    async () => {
      const q = new URLSearchParams({ search: debounced.trim(), orden });
      for (const [k, val] of Object.entries({ area, tipo, estado, origen, propietario })) if (val) q.set(k, val);
      if (periodo === "rango") {
        if (desde) q.set("desde", desde);
        if (hasta) q.set("hasta", hasta);
      }
      return (await getJsonAuth(`${API_BASE_URL}/sgc/documentos?${q.toString()}`, token)) as unknown as Respuesta;
    },
    { enabled: !!token, deps: [debounced, area, tipo, estado, origen, propietario, periodo, desde, hasta, orden] },
  );
  const data = recurso.data;
  const items = data?.items || [];
  const cat = catalogos.data;
  const areaSel = area ? areaDe(cat?.areas, area) : null;
  const tipoSel = tipo ? { codigo: tipo, nombre: nombreTipo(cat?.tipos, tipo) } : null;

  const groups: FilterGroup[] = [
    { key: "area", label: "Gestión", value: area, defaultValue: "", onChange: setArea, options: [{ value: "", label: "Todas" }, ...(cat?.areas || []).map((a) => ({ value: a.codigo, label: `${a.codigo} · ${a.nombre}` }))] },
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
        { value: "en_revision", label: "En revisión o autorización" },
        { value: "borrador", label: "Con borrador en curso" },
        { value: "en_elaboracion", label: "Sin revisión vigente" },
        { value: "proxima_revision", label: "Próximos a revisar" },
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
            <label className="flex flex-col gap-1 text-[12px] text-ink-3">
              Desde
              <DateInput id="sgc-desde" small value={desde} onChange={setDesde} aria-label="Desde" />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-ink-3">
              Hasta
              <DateInput id="sgc-hasta" small value={hasta} onChange={setHasta} aria-label="Hasta" />
            </label>
          </div>
        ) : undefined,
    },
  ];
  const ordenar: FilterGroup[] = [
    { key: "orden", label: "Ordenar por", value: orden, defaultValue: "clave", showDefault: true, onChange: setOrden, options: [{ value: "clave", label: "Clave" }, { value: "titulo", label: "Título A–Z" }, { value: "recientes", label: "Más recientes" }, { value: "proxima", label: "Próxima revisión" }] },
  ];
  const filtrado = !!(debounced.trim() || area || tipo || estado || origen || propietario || periodo !== "todo");
  const abrir = (doc: DocLista) => router.push(`/documentos/${doc.id}`);
  const tecla = (doc: DocLista) => (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      abrir(doc);
    }
  };

  const estadoCelda = (doc: DocLista) => (
    <span className="flex flex-wrap items-center gap-1.5">
      <EstadoDocumentoEtiqueta estado={doc.estado} />
      {doc.trabajo ? <EstadoRevisionEtiqueta estado={doc.trabajo.estado} /> : null}
      <ProximaRevisionEtiqueta fecha={doc.vigente?.fecha_proxima_revision} />
    </span>
  );

  return (
    <PageBody>
      <div className="flex flex-col gap-2">
        <RutaDocumentos area={areaSel} tipo={tipoSel} />
        <PageHeader
          title={areaSel ? areaSel.nombre : "Explorador documental"}
          description={areaSel ? `Documentos de ${areaSel.codigo}${tipoSel ? ` · ${tipoSel.nombre}` : ""}. Busca por clave, título o palabras clave.` : "Busca por clave, título o palabras clave y filtra por gestión, tipo, estado, origen, propietario o fecha."}
          actions={
            data?.puede.crear_ficha ? (
              <Button icon={<Plus size={16} weight="bold" />} onClick={() => setNueva(true)} data-testid="sgc-nueva-ficha">
                Nueva ficha
              </Button>
            ) : null
          }
        />
      </div>

      <Toolbar
        end={
          <div className="flex rounded-full bg-surface-3 p-0.5" role="group" aria-label="Vista">
            <button type="button" aria-pressed={vista === "tabla"} aria-label="Ver en tabla" onClick={() => setVista("tabla")} className={cn("press flex h-8 w-8 items-center justify-center rounded-full", vista === "tabla" ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink")}>
              <ListBullets size={16} weight="bold" />
            </button>
            <button type="button" aria-pressed={vista === "tarjetas"} aria-label="Ver en tarjetas" onClick={() => setVista("tarjetas")} className={cn("press flex h-8 w-8 items-center justify-center rounded-full", vista === "tarjetas" ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink")}>
              <SquaresFour size={16} weight={vista === "tarjetas" ? "fill" : "regular"} />
            </button>
          </div>
        }
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por clave, título o palabras clave" className="w-full md:w-[360px]" />
        <FilterMenu groups={groups} gruposFinales={ordenar} />
      </Toolbar>

      {recurso.error ? (
        <ErrorState message={recurso.error} onRetry={recurso.reload} />
      ) : !data ? (
        <ListaCuadricula etiqueta="Documentos" columnas={COLUMNAS} filas={null} clave={() => ""} celdas={() => []} onAbrir={() => undefined} vacio={{ titulo: "" }} />
      ) : !items.length ? (
        <div className="rounded-card bg-surface shadow-card" data-testid="sgc-vacio">
          <EmptyState icon={<Files size={22} weight="duotone" />} title={filtrado ? "Sin coincidencias" : "Todavía no hay documentos"} description={filtrado ? "Prueba con otra palabra o quita algún filtro." : data.puede.crear_ficha ? "Registra la primera ficha con su clave FX autorizada y su archivo." : "Cuando Mejora Continua registre documentos, aparecerán aquí."} />
        </div>
      ) : vista === "tarjetas" ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Documentos">
          {items.map((doc, i) => {
            const a = areaDe(cat?.areas, doc.area_codigo);
            return (
              <li key={doc.id} className="entrada-escalonada" style={{ ["--i" as string]: i }}>
                <article tabIndex={0} role="link" aria-label={`Abrir ${doc.clave} ${doc.titulo}`} onClick={() => abrir(doc)} onKeyDown={tecla(doc)} data-testid="sgc-tarjeta" data-clave={doc.clave} className="group flex h-full cursor-pointer overflow-hidden rounded-card bg-surface shadow-card transition-shadow hover:shadow-raised focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none">
                  <span className="w-1.5 shrink-0" style={{ backgroundColor: a.color }} aria-hidden="true" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
                    <div className="flex items-start gap-3">
                      <IconoArea area={a} size="sm" />
                      <div className="flex min-w-0 flex-col">
                        <span className="code text-[12.5px] font-semibold text-ink-2">{doc.clave}</span>
                        <h3 className="break-words text-[14px] font-semibold leading-snug text-ink">{doc.titulo}</h3>
                      </div>
                    </div>
                    <p className="text-[12.5px] text-ink-3">
                      {a.codigo} · {nombreTipo(cat?.tipos, doc.tipo_codigo)}
                      {doc.vigente ? ` · Rev. ${doc.vigente.numero}` : ""}
                    </p>
                    <div className="mt-auto flex flex-wrap items-center gap-1.5">
                      {estadoCelda(doc)}
                      <ConfidencialidadEtiqueta valor={doc.confidencialidad} />
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      ) : (
        <ListaCuadricula
          etiqueta="Documentos"
          columnas={COLUMNAS}
          filas={items}
          clave={(doc) => String(doc.id)}
          onAbrir={(doc) => abrir(doc)}
          propsFila={(doc) => ({ "data-testid": "sgc-fila", "data-clave": doc.clave })}
          celdas={(doc) => {
            const a = areaDe(cat?.areas, doc.area_codigo);
            return [
              <span key="d" className="flex min-w-0 items-start gap-3">
                <IconoArea area={a} size="sm" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="code text-[12.5px] font-semibold text-ink-2">{doc.clave}</span>
                    {doc.confidencialidad !== "uso_interno" ? <LockKey size={13} weight="bold" className="text-ink-3" aria-label="Acceso restringido" /> : null}
                  </span>
                  <span className="break-words text-[14px] leading-snug font-semibold text-ink">{doc.titulo}</span>
                  {doc.palabras_clave.length ? <span className="break-words text-[12px] text-ink-3">{doc.palabras_clave.join(", ")}</span> : null}
                </span>
              </span>,
              <span key="a" className="flex flex-col text-[13px] text-ink-2">
                <span>
                  {a.codigo} · {a.nombre}
                </span>
                <span className="text-[12px] text-ink-3">{nombreTipo(cat?.tipos, doc.tipo_codigo)}</span>
              </span>,
              doc.vigente ? (
                <span key="r" className="flex flex-col text-[13px] text-ink-2">
                  <span className="tnum">Rev. {doc.vigente.numero}</span>
                  <span className="text-[12px] text-ink-3">{formatearFecha(doc.vigente.fecha_emision)}</span>
                </span>
              ) : (
                <SinDato key="r" />
              ),
              <span key="e">{estadoCelda(doc)}</span>,
              doc.propietario_nombre ? <span key="p" className="text-[13px] text-ink-2">{doc.propietario_nombre}</span> : <SinDato key="p" />,
            ];
          }}
          vacio={{ titulo: "Sin documentos" }}
        />
      )}

      {nueva && cat?.puede.crear_ficha ? <FichaSheet open onClose={() => setNueva(false)} catalogos={cat} areaInicial={area} tipoInicial={tipo} /> : null}
    </PageBody>
  );
}
