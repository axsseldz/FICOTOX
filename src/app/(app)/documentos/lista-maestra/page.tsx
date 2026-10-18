"use client";

import { useRouter } from "next/navigation";
import { Fragment, Suspense, useState } from "react";
import { ArrowSquareOut, FilePdf, ListChecks, LockKey } from "@phosphor-icons/react";
import { EstadoDocumentoEtiqueta, ExternoEtiqueta, RequireDocumentos, RutaDocumentos, useCatalogos } from "@/components/features/documentos/comun";
import { ICONO_ESTADO } from "@/components/features/documentos/iconos";
import { ActionMenu } from "@/components/ui/Overlay";
import { PageBody } from "@/components/shell/AppShell";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { FilterMenu, type FilterGroup } from "@/components/ui/FilterMenu";
import { PageHeader, SearchInput, Toolbar } from "@/components/ui/PageHeader";
import { Badge, EmptyState, ErrorState, Skeleton } from "@/components/ui/Primitives";
import type { CSSProperties } from "react";
import { Table, TableShell, TBody, Td, Th, THead, Tr } from "@/components/ui/Table";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { verPdf } from "@/lib/client/files";
import { useDebouncedValue, useInitialParam } from "@/lib/client/hooks";
import { useResource } from "@/lib/client/store";
import { formatearFecha, hoyLocal } from "@/lib/shared/fechas";

/*
 * Lista Maestra de Documentos FX-GCL-MD (Fase 3, CA-09): todos los documentos
 * que la persona puede ver, agrupados por area con su color, con la revision
 * vigente, la revision en curso en el mismo renglon y los responsables.
 * "Ver PDF" la genera en el servidor (pdfkit) y la abre en el visor interno,
 * sin pestaña nueva ni descarga automatica.
 */

interface Renglon {
  id: number;
  area_codigo: string;
  area_nombre: string;
  area_color: string;
  clave: string;
  titulo: string;
  tipo_nombre: string;
  origen: "interno" | "externo";
  revision: string | null;
  estado: string;
  estado_etiqueta: string;
  pendiente_revision: boolean;
  en_curso: string | null;
  propietario: string | null;
  elaborador: string | null;
  revisor: string | null;
  autorizador: string | null;
  emision: string | null;
  vigencia: string | null;
  proxima_revision: string | null;
}
interface Respuesta {
  items: Renglon[];
  filtros: string;
  puede: { exportar: boolean; ver_obsoletos: boolean };
}

export default function ListaMaestraPage() {
  return (
    <RequireDocumentos>
      <Suspense fallback={<Skeleton className="h-[420px]" />}>
        <ListaMaestra />
      </Suspense>
    </RequireDocumentos>
  );
}


function ListaMaestra() {
  const { token } = useSession();
  const router = useRouter();
  const catalogos = useCatalogos();
  const [search, setSearch] = useState("");
  const [area, setArea] = useState(useInitialParam("area").toUpperCase());
  const [tipo, setTipo] = useState("");
  const [estado, setEstado] = useState("");
  const [origen, setOrigen] = useState("");
  const [obsoletos, setObsoletos] = useState(false);
  const debounced = useDebouncedValue(search);
  const consulta = () => {
    const q = new URLSearchParams();
    if (debounced.trim()) q.set("search", debounced.trim());
    for (const [k, v] of Object.entries({ area, tipo, estado, origen })) if (v) q.set(k, v);
    if (obsoletos) q.set("obsoletos", "1");
    return q.toString();
  };
  const recurso = useResource<Respuesta>("sgc", async () => (await getJsonAuth(`${API_BASE_URL}/sgc/lista-maestra?${consulta()}`, token)) as unknown as Respuesta, { enabled: !!token, deps: [debounced, area, tipo, estado, origen, obsoletos] });
  const data = recurso.data;
  const cat = catalogos.data;
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
        { value: "en_curso", label: "Con revisión en curso" },
        { value: "en_elaboracion", label: "Sin revisión vigente" },
        { value: "pendiente_revision", label: "Pendientes de revisión" },
      ],
    },
    { key: "origen", label: "Origen", value: origen, defaultValue: "", onChange: setOrigen, options: [{ value: "", label: "Todos" }, { value: "interno", label: "Internos" }, { value: "externo", label: "Externos" }] },
  ];
  const grupos = data ? [...new Set(data.items.map((x) => x.area_codigo))] : [];
  // Entrada escalonada de los renglones (en el orden en que se ven).
  let indice = 0;
  const pdf = () => verPdf(`${API_BASE_URL}/sgc/lista-maestra/pdf?${consulta()}`, `Lista-Maestra-FX-GCL-MD-${hoyLocal()}.pdf`, "Lista Maestra de Documentos FX-GCL-MD");
  return (
    <PageBody>
      <div className="flex flex-col gap-2">
        <RutaDocumentos documento="Lista Maestra" />
        <PageHeader
          title="Lista Maestra de Documentos"
          eyebrow="FX-GCL-MD"
          description="Documentos controlados por gestión, con su revisión y sus responsables."
          actions={
            data?.puede.exportar ? (
              <Button icon={<FilePdf size={16} />} onClick={pdf} data-testid="lm-pdf">
                Ver PDF
              </Button>
            ) : null
          }
        />
      </div>
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por clave, título o propietario" className="w-full md:w-[360px]" />
        <FilterMenu groups={groups} toggles={data?.puede.ver_obsoletos ? [{ key: "obsoletos", label: "Incluir obsoletos", description: "Documentos retirados del uso (consulta histórica)", checked: obsoletos, onChange: setObsoletos }] : []} />
      </Toolbar>
      {data ? (
        <p className="-mt-2 text-[12.5px] text-ink-3" data-testid="lm-resumen">
          {data.items.length} documento{data.items.length === 1 ? "" : "s"} · {data.filtros}
        </p>
      ) : null}
      {recurso.error ? (
        <ErrorState message={recurso.error} onRetry={recurso.reload} />
      ) : !data ? (
        <Skeleton className="h-[360px] rounded-card" />
      ) : !data.items.length ? (
        <div className="rounded-card bg-surface shadow-card" data-testid="lm-vacio">
          <EmptyState icon={<ListChecks size={22} weight="duotone" />} title="Nada coincide" description="Quita algún filtro o cambia la búsqueda." />
        </div>
      ) : (
        <TableShell>
          <Table className="min-w-[980px] text-[13px]" data-testid="lm-tabla">
            <THead>
              <tr>
                <Th>Documento</Th>
                <Th>Revisión</Th>
                <Th>Estado</Th>
                <Th>Responsables</Th>
                <Th>Fechas</Th>
                <Th aria-label="Acciones" />
              </tr>
            </THead>
            <TBody>
              {grupos.map((g) => {
                const filas = data.items.filter((x) => x.area_codigo === g);
                return (
                  <Fragment key={g}>
                    <tr data-testid="lm-area" data-area={g}>
                      <td colSpan={6} className="p-0">
                        <span className="flex items-center gap-2 border-l-[6px] bg-surface-2 px-4 py-2 text-[12.5px] font-semibold text-ink" style={{ borderLeftColor: filas[0].area_color }}>
                          <span className="code">{g}</span>
                          <span className="font-medium text-ink-2">{filas[0].area_nombre}</span>
                          <span className="tnum ml-auto font-normal text-ink-3">{filas.length}</span>
                        </span>
                      </td>
                    </tr>
                    {filas.map((x) => (
                      <Tr key={x.id} interactive onClick={() => router.push(`/documentos/${x.id}`)} data-testid="lm-fila" data-clave={x.clave} className="entrada-escalonada" style={{ ["--i" as string]: indice++ } as CSSProperties}>
                        <Td className="min-w-[280px] max-w-[420px]">
                          <span className="flex flex-col gap-0.5">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="code text-[12.5px] font-semibold text-ink-2">{x.clave}</span>
                              {x.origen === "externo" ? <ExternoEtiqueta /> : null}
                            </span>
                            <span className="break-words font-medium text-ink">{x.titulo}</span>
                            <span className="text-[12px] text-ink-3">{x.tipo_nombre}</span>
                          </span>
                        </Td>
                        <Td className="min-w-[130px]">
                          <span className="flex flex-col gap-0.5">
                            <span className="whitespace-nowrap">{x.revision || "—"}</span>
                            {x.en_curso ? <span className="text-[12px] text-ink-3" data-testid="lm-en-curso">{x.en_curso}</span> : null}
                          </span>
                        </Td>
                        <Td className="min-w-[150px]">
                          <span className="flex flex-col items-start gap-1">
                            <EstadoDocumentoEtiqueta estado={x.estado} />
                            {x.pendiente_revision ? (
                              <Badge tone="warning" className="gap-1">
                                <ICONO_ESTADO.pendiente size={12} weight="bold" aria-hidden="true" /> Pendiente de revisión
                              </Badge>
                            ) : null}
                          </span>
                        </Td>
                        <Td className="min-w-[200px]">
                          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[12.5px]">
                            {[
                              ["Propietario", x.propietario],
                              ["Elaboró", x.elaborador],
                              ["Revisó", x.revisor],
                              ["Autorizó", x.autorizador],
                            ]
                              .filter(([, v]) => v)
                              .map(([k, v]) => (
                                <Fragment key={k}>
                                  <dt className="text-ink-3">{k}</dt>
                                  <dd className="truncate text-ink-2" title={String(v)}>{v}</dd>
                                </Fragment>
                              ))}
                          </dl>
                        </Td>
                        <Td className="min-w-[170px]">
                          <dl className="tnum grid grid-cols-[max-content_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[12.5px]">
                            {[
                              ["Emisión", x.emision],
                              ["Vigencia", x.vigencia],
                              ["Próx. revisión", x.proxima_revision],
                            ]
                              .filter(([, v]) => v)
                              .map(([k, v]) => (
                                <Fragment key={k}>
                                  <dt className="text-ink-3">{k}</dt>
                                  <dd className="whitespace-nowrap text-ink-2">{formatearFecha(v)}</dd>
                                </Fragment>
                              ))}
                          </dl>
                        </Td>
                        <Td className="w-[52px]" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                          <ActionMenu items={[{ label: "Abrir ficha", icon: <ArrowSquareOut size={16} weight="bold" />, onSelect: () => router.push(`/documentos/${x.id}`) }]} label={`Más acciones de ${x.clave}`} />
                        </Td>
                      </Tr>
                    ))}
                  </Fragment>
                );
              })}
            </TBody>
          </Table>
        </TableShell>
      )}
      <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
        <LockKey size={13} aria-hidden="true" /> Solo se listan los documentos que puedes consultar.
      </p>
    </PageBody>
  );
}
