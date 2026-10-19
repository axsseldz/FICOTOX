"use client";

import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { ArrowSquareOut, CheckCircle, DownloadSimple, FilePlus, XCircle } from "@phosphor-icons/react";
import { areaDe, EstadoSolicitudEtiqueta, IconoArea, nombreTipo, RequireDocumentos, RutaDocumentos, useCatalogos } from "@/components/features/documentos/comun";
import { AceptarSolicitudSheet, RechazarSolicitudDialog, SolicitudSheet, type SolicitudSgc } from "@/components/features/documentos/SolicitudSheets";
import { descargarUrl } from "@/components/features/visor/usarArchivo";
import { PageBody } from "@/components/shell/AppShell";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { FilterMenu, type FilterGroup } from "@/components/ui/FilterMenu";
import { ListaCuadricula, type ColumnaLista } from "@/components/ui/ListaCuadricula";
import { ActionMenu, type MenuItem } from "@/components/ui/Overlay";
import { PageHeader, SearchInput, SegmentedTabs, Toolbar } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Primitives";
import { DatosLista, VentanaAcciones, VentanaCentrada, VentanaTitulo } from "@/components/ui/Ventana";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { useDebouncedValue, useInitialParam } from "@/lib/client/hooks";
import { explicarError } from "@/lib/client/mensajes";
import { useResource } from "@/lib/client/store";
import { formatearFecha, formatearFechaHora } from "@/lib/shared/fechas";

/*
 * Solicitudes de Documentos SGC: quien propone ve el estado de las suyas;
 * Mejora Continua ve todas, las acepta (accion principal del renglon: crea la
 * ficha o abre la revision con responsables) o las rechaza con motivo (menu ⋯).
 * Pestañas "Pendientes / Todas", buscador y filtros en un solo boton. Al tocar
 * un renglon se abre su detalle (justificacion, necesidad y resolucion).
 */

type Filtro = "pendiente" | "todas";

const COLUMNAS: ColumnaLista[] = [
  { clave: "solicitud", titulo: "Solicitud", ancho: "minmax(240px,2.4fr)" },
  { clave: "solicitante", titulo: "Solicitante", ancho: "minmax(140px,1fr)" },
  { clave: "estado", titulo: "Estado", ancho: "minmax(120px,0.8fr)" },
];

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
  const router = useRouter();
  const catalogos = useCatalogos();
  const [filtro, setFiltro] = useState<Filtro>("pendiente");
  const [search, setSearch] = useState("");
  const [tipo, setTipo] = useState("");
  const [area, setArea] = useState("");
  const [nueva, setNueva] = useState(useInitialParam("nueva") === "1");
  const [aceptar, setAceptar] = useState<SolicitudSgc | null>(null);
  const [rechazar, setRechazar] = useState<SolicitudSgc | null>(null);
  const [detalle, setDetalle] = useState<number | null>(Number(useInitialParam("abrir")) || null);
  const debounced = useDebouncedValue(search);
  const recurso = useResource<{ items: SolicitudSgc[]; puede: { proponer: boolean; atender: boolean } }>(["sgc", "sgc-solicitudes"], async () => (await getJsonAuth(`${API_BASE_URL}/sgc/solicitudes`, token)) as unknown as { items: SolicitudSgc[]; puede: { proponer: boolean; atender: boolean } }, { enabled: !!token });
  const data = recurso.data;
  const cat = catalogos.data;
  const q = debounced.trim().toLowerCase();
  const items = (data?.items || []).filter(
    (x) =>
      (filtro === "todas" || x.estado === "pendiente") &&
      (!tipo || x.tipo === tipo) &&
      (!area || (x.area_codigo || x.documento_clave?.slice(3, 5)) === area) &&
      (!q || [x.titulo_propuesto, x.documento_titulo, x.documento_clave, x.justificacion, x.solicitante_nombre, `#${x.id}`].some((v) => String(v || "").toLowerCase().includes(q))),
  );
  const abierta = detalle ? (data?.items || []).find((x) => x.id === detalle) || null : null;
  // Desde la Bandeja (?abrir=ID) se abre su detalle, este o no pendiente.

  const apoyo = async (x: SolicitudSgc) => {
    try {
      await descargarUrl(`${API_BASE_URL}/sgc/solicitudes/${x.id}/apoyo`, token, `apoyo-solicitud-${x.id}`);
    } catch (err) {
      toast.error(explicarError(err, "No se pudo descargar").que);
    }
  };
  const menu = (x: SolicitudSgc): MenuItem[] => [
    ...(x.puede.atender && x.estado === "pendiente" ? [{ label: "Rechazar", icon: <XCircle size={16} weight="bold" />, tone: "danger" as const, onSelect: () => setRechazar(x), testid: "sgc-solicitud-rechazar" }] : []),
    ...(x.con_apoyo ? [{ label: "Ver archivo de apoyo", icon: <DownloadSimple size={16} weight="bold" />, onSelect: () => void apoyo(x), testid: "sgc-solicitud-apoyo" }] : []),
    ...(x.documento_id ? [{ label: "Abrir documento", icon: <ArrowSquareOut size={16} weight="bold" />, onSelect: () => router.push(`/documentos/${x.documento_id}`) }] : []),
  ];
  const groups: FilterGroup[] = [
    { key: "tipo", label: "Tipo de solicitud", value: tipo, defaultValue: "", onChange: setTipo, options: [{ value: "", label: "Todas" }, { value: "nuevo", label: "Documento nuevo" }, { value: "cambio", label: "Cambio a un documento" }] },
    { key: "area", label: "Gestión", value: area, defaultValue: "", onChange: setArea, options: [{ value: "", label: "Todas" }, ...(cat?.areas || []).map((a) => ({ value: a.codigo, label: `${a.codigo} · ${a.nombre}` }))] },
  ];

  return (
    <PageBody>
      <div className="flex flex-col gap-2">
        <RutaDocumentos documento="Solicitudes" />
        <PageHeader
          title="Solicitudes"
          description={data?.puede.atender ? "Propuestas de documentos nuevos y de cambios." : "Tus propuestas y lo que resolvió Mejora Continua."}
          actions={
            data?.puede.proponer ? (
              <Button icon={<FilePlus size={16} weight="bold" />} onClick={() => setNueva(true)} data-testid="sgc-nueva-solicitud">
                Nueva solicitud
              </Button>
            ) : null
          }
        />
      </div>
      <Toolbar end={<SegmentedTabs<Filtro> value={filtro} onChange={setFiltro} options={[{ value: "pendiente", label: "Pendientes" }, { value: "todas", label: "Todas" }]} label="Solicitudes" />}>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por título, clave o solicitante" className="min-w-0 flex-1 md:w-[340px] md:flex-none" />
        <FilterMenu groups={groups} />
      </Toolbar>
      <ListaCuadricula
        etiqueta="Solicitudes"
        columnas={COLUMNAS}
        filas={data ? items : null}
        error={recurso.error}
        onReintentar={recurso.reload}
        clave={(x) => String(x.id)}
        onAbrir={(x) => setDetalle(x.id)}
        activa={(x) => x.id === detalle}
        anchoExtremo="150px"
        propsFila={(x) => ({ "data-testid": "sgc-solicitud", "data-solicitud": String(x.id) })}
        celdas={(x) => {
          const a = x.area_codigo ? areaDe(cat?.areas, x.area_codigo) : null;
          return [
            <span key="s" className="flex min-w-0 items-start gap-3">
              {a ? <IconoArea area={a} size="sm" /> : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-field bg-surface-2 text-ink-3 ring-1 ring-line" aria-hidden="true"><FilePlus size={16} weight="duotone" /></span>}
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
                  <span className="tnum font-semibold">#{x.id}</span>
                  <span>{x.tipo === "nuevo" ? "Documento nuevo" : "Cambio"}</span>
                  {x.documento_clave ? <span className="code font-semibold text-ink-2">{x.documento_clave}</span> : x.area_codigo ? <span>{x.area_codigo} · {nombreTipo(cat?.tipos, x.tipo_codigo || "")}</span> : null}
                </span>
                <span className="line-clamp-2 break-words text-base font-medium leading-snug text-ink">{x.titulo_propuesto || x.documento_titulo}</span>
              </span>
            </span>,
            <span key="p" className="flex flex-col text-sm text-ink-2">
              <span>{x.solicitante_nombre || "—"}</span>
              <span className="tnum text-xs text-ink-3">{formatearFecha(x.creado_en)}</span>
            </span>,
            <span key="e">
              <EstadoSolicitudEtiqueta estado={x.estado} />
            </span>,
          ];
        }}
        extremo={(x) => {
          const opciones = menu(x);
          return (
            <>
              {x.puede.atender && x.estado === "pendiente" ? (
                <Button size="sm" icon={<CheckCircle size={15} weight="bold" />} onClick={() => setAceptar(x)} data-testid="sgc-solicitud-aceptar">
                  Aceptar
                </Button>
              ) : null}
              {opciones.length ? <ActionMenu items={opciones} label={`Más acciones de la solicitud ${x.id}`} /> : null}
            </>
          );
        }}
        vacio={{ icono: <FilePlus size={22} weight="duotone" />, titulo: filtro === "pendiente" && !q && !tipo && !area ? "No hay solicitudes pendientes" : "Nada coincide", descripcion: data?.puede.proponer ? "Propón un documento nuevo o un cambio con «Nueva solicitud»." : undefined }}
      />

      <VentanaCentrada abierta={!!abierta} onCerrar={() => setDetalle(null)}>
        {abierta ? (
          <div className="flex flex-col gap-5" data-testid="sgc-solicitud-detalle">
            <div className="flex flex-col gap-1.5">
              <span className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                <span className="tnum font-semibold">#{abierta.id}</span>
                <span>{abierta.tipo === "nuevo" ? "Documento nuevo" : "Cambio"}</span>
                <EstadoSolicitudEtiqueta estado={abierta.estado} />
              </span>
              <VentanaTitulo>{abierta.titulo_propuesto || abierta.documento_titulo}</VentanaTitulo>
            </div>
            <DatosLista
              datos={[
                abierta.documento_clave ? { etiqueta: "Documento", valor: <span className="code">{abierta.documento_clave}</span> } : null,
                abierta.area_codigo ? { etiqueta: "Gestión y tipo", valor: `${abierta.area_codigo} · ${nombreTipo(cat?.tipos, abierta.tipo_codigo || "")}` } : null,
                { etiqueta: "Solicitante", valor: `${abierta.solicitante_nombre || "—"} · ${formatearFechaHora(abierta.creado_en)}` },
                { etiqueta: "Justificación", valor: <span className="whitespace-pre-line">{abierta.justificacion}</span> },
                abierta.necesidad ? { etiqueta: "Necesidad", valor: <span className="whitespace-pre-line">{abierta.necesidad}</span> } : null,
                abierta.estado !== "pendiente" ? { etiqueta: abierta.estado === "aceptada" ? "Aceptada" : "Rechazada", valor: `${abierta.resuelta_por_nombre || "—"} · ${formatearFecha(abierta.resuelta_en)}${abierta.comentario_resolucion ? ` · ${abierta.comentario_resolucion}` : ""}${abierta.clave_asignada ? ` · clave ${abierta.clave_asignada}` : ""}` } : null,
              ]}
            />
            {abierta.puede.atender && abierta.estado === "pendiente" ? (
              <VentanaAcciones>
                <Button variant="secondary" icon={<XCircle size={15} weight="bold" />} onClick={() => setRechazar(abierta)}>
                  Rechazar
                </Button>
                <Button icon={<CheckCircle size={15} weight="bold" />} onClick={() => setAceptar(abierta)}>
                  Aceptar
                </Button>
              </VentanaAcciones>
            ) : null}
          </div>
        ) : null}
      </VentanaCentrada>

      {nueva && data?.puede.proponer ? <SolicitudSheet catalogos={catalogos.data} onClose={() => setNueva(false)} /> : null}
      {aceptar ? (
        <AceptarSolicitudSheet
          solicitud={aceptar}
          catalogos={catalogos.data}
          onClose={() => {
            setAceptar(null);
            setDetalle(null);
          }}
        />
      ) : null}
      {rechazar ? (
        <RechazarSolicitudDialog
          solicitud={rechazar}
          onClose={() => {
            setRechazar(null);
            setDetalle(null);
          }}
        />
      ) : null}
    </PageBody>
  );
}
