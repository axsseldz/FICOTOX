"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowCounterClockwise, ArrowSquareOut, Drop, PencilSimple, Plus, Prohibit } from "@phosphor-icons/react";
import { useMenuReportar } from "@/components/features/calidad/ReportarIncidencia";
import { FolioChip, SampleStatus, SolicitudBadge, SupervisionBadge } from "@/components/features/samples/status";
import { useAnulacion } from "@/components/features/samples/useAnulacion";
import { RequireModule } from "@/components/session/RequireModule";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { FilterChips, FilterMenu, type FilterGroup, type FilterToggle } from "@/components/ui/FilterMenu";
import { ActionMenu, type MenuItem } from "@/components/ui/Overlay";
import { SearchInput, Toolbar } from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/Primitives";
import { FranjaPendientes } from "@/components/features/solicitudes/Solicitudes";
import { StatusCell } from "@/components/ui/StatusFlag";
import { CellPrimary, COL_FECHA, FILA_LISTA, SOLO_ANCHO, Table, TBody, Td, Th, THead, Tr, TableShell } from "@/components/ui/Table";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { cn } from "@/components/ui/cn";
import { contar, fmtDate } from "@/lib/client/format";
import { useDebouncedValue, useInitialParam, useParamChange } from "@/lib/client/hooks";
import { formatProcessingFolio, normalizeSampleStatus } from "@/lib/client/samples";
import { useResource } from "@/lib/client/store";
import { estaHabilitada, motivoDe, seOfrece, usePuedeCrear } from "@/lib/client/puede";
import type { ApiRecord } from "@/lib/client/types";

export default function ProcesamientoListPage() {
  return (
    <RequireModule modules="ensayos">
      <ProcesamientoList />
    </RequireModule>
  );
}

const ORGANISMO: Record<string, string> = { bivalvos: "Bivalvos", sardinas: "Sardinas", otro: "Otro" };
type EtapaFilter = "" | "registrada" | "en_proceso" | "completada";
type OrganismoFilter = "" | "bivalvos" | "sardinas" | "otro";

function ProcesamientoList() {
  const { token, can } = useSession();
  const router = useRouter();
  const [search, setSearch] = useState(useInitialParam("buscar"));
  useParamChange("buscar", setSearch);
  const [showAnuladas, setShowAnuladas] = useState(false);
  const [mias, setMias] = useState(false);
  const [etapa, setEtapa] = useState<EtapaFilter>("");
  const [organismo, setOrganismo] = useState<OrganismoFilter>("");
  const debounced = useDebouncedValue(search);
  const { anular, restaurar } = useAnulacion("processing", formatProcessingFolio);

  const resource = useResource<ApiRecord[]>(
    "muestras",
    async () => {
      const data = await getJsonAuth(`${API_BASE_URL}/samples/processing?search=${encodeURIComponent(debounced.trim())}${showAnuladas ? "&anuladas=1" : ""}${mias ? "&mias=1" : ""}`, token);
      return (data.items || []) as ApiRecord[];
    },
    { enabled: !!token, deps: [debounced, showAnuladas, mias] },
  );
  const items = resource.data;

  const puedeCrear = usePuedeCrear();
  const canCreate = puedeCrear("procesamiento", can("ensayos", "C", { objeto: "procesamiento", borrador: true }));
  const canEdit = (item: ApiRecord) => can("ensayos", "E", { objeto: "procesamiento", borrador: String(item.estado || "registrada") === "registrada" });
  const canExtraer = puedeCrear("extraccion", can("ensayos", "C", { objeto: "extraccion", borrador: true }));
  const canDelete = can("ensayos", "AN");

  const organismoDe = (item: ApiRecord) => (Array.isArray(item.tipo_organismo) ? String(item.tipo_organismo[0] || "") : String(item.tipo_organismo || ""));
  const count = (predicate: (item: ApiRecord) => boolean) => (items ? items.filter(predicate).length : null);
  const visible = useMemo(() => (items || []).filter((item) => (!etapa || normalizeSampleStatus(item.estado) === etapa) && (!organismo || organismoDe(item) === organismo)), [items, etapa, organismo]);

  const groups: FilterGroup[] = [
    {
      key: "etapa",
      label: "Estado",
      value: etapa,
      defaultValue: "",
      onChange: (v) => setEtapa(v as EtapaFilter),
      options: [
        { value: "", label: "Todas", count: items ? items.length : null },
        { value: "registrada", label: "Registrados", count: count((i) => normalizeSampleStatus(i.estado) === "registrada") },
        { value: "en_proceso", label: "En proceso", count: count((i) => normalizeSampleStatus(i.estado) === "en_proceso") },
        { value: "completada", label: "Completados", count: count((i) => normalizeSampleStatus(i.estado) === "completada") },
      ],
    },
    {
      key: "organismo",
      label: "Organismo",
      value: organismo,
      defaultValue: "",
      onChange: (v) => setOrganismo(v as OrganismoFilter),
      options: [
        { value: "", label: "Cualquiera" },
        { value: "bivalvos", label: "Bivalvos", count: count((i) => organismoDe(i) === "bivalvos") },
        { value: "sardinas", label: "Sardinas", count: count((i) => organismoDe(i) === "sardinas") },
        { value: "otro", label: "Otro", count: count((i) => organismoDe(i) === "otro") },
      ],
    },
  ];
  const toggles: FilterToggle[] = [{ key: "mias", label: "Mis muestras", description: "Solo las muestras asignadas a ti o que registraste.", checked: mias, onChange: setMias }, { key: "anulados", label: "Mostrar anulados", checked: showAnuladas, onChange: setShowAnuladas }];

  const reportar = useMenuReportar();
  const menuFor = (item: ApiRecord): MenuItem[] => {
    const anulada = item.estado === "anulada";
    const list: MenuItem[] = [{ label: "Abrir", description: "Ver el formato completo", icon: <ArrowSquareOut size={16} weight="duotone" />, tone: "brand", onSelect: () => router.push(`/muestras/procesamiento/${item.id}`) }];
    if (seOfrece(item, "editar", canEdit(item)) && !anulada) list.push({ label: "Editar", description: motivoDe(item, "editar") || "Corregir pasos, pesos o resguardo", disabled: !estaHabilitada(item, "editar", canEdit(item)), icon: <PencilSimple size={16} weight="duotone" />, onSelect: () => router.push(`/muestras/procesamiento/${item.id}`) });
    if (canExtraer && !anulada) list.push({ label: "Extraer", description: "Nueva extracción ASP o DSP de esta molienda", icon: <Drop size={16} weight="duotone" />, tone: "success", onSelect: () => router.push(`/muestras/extraccion/nueva?procesamiento=${item.id}`) });
    list.push(...reportar("muestras_procesamiento", item.id, formatProcessingFolio(item)));
    if (canDelete) {
      if (anulada) list.push({ label: "Restaurar procesamiento", description: "Vuelve a la lista con motivo", icon: <ArrowCounterClockwise size={16} weight="duotone" />, tone: "warning", separatorBefore: true, onSelect: () => restaurar(item) });
      else list.push({ label: "Anular procesamiento…", description: "Queda en la bitácora con motivo", icon: <Prohibit size={16} weight="duotone" />, tone: "danger", separatorBefore: true, onSelect: () => anular(item) });
    }
    return list;
  };

  return (
    <>
      <FranjaPendientes entidades={["muestras_procesamiento"]} grupo="procesamiento" />
      <Toolbar
        end={
          canCreate ? (
            <Link href="/muestras/procesamiento/nuevo" className="press inline-flex h-9 items-center gap-2 rounded-[9px] bg-brand px-3.5 text-[13.5px] font-medium text-on-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] hover:bg-brand-strong">
              <Plus size={16} weight="bold" /> Nuevo procesamiento
            </Link>
          ) : null
        }
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por folio P, folio R o ID interno" className="w-full md:w-[340px]" />
        <FilterMenu groups={groups} toggles={toggles} />
        <FilterChips groups={groups} toggles={toggles} />
      </Toolbar>

      <TableShell footer={items ? contar(visible.length, "procesamiento", "procesamientos") : undefined}>
        {resource.error ? (
          <ErrorState message={resource.error} onRetry={resource.reload} />
        ) : !items ? (
          <TableSkeleton cols={6} />
        ) : !visible.length ? (
          <EmptyState icon={<Drop size={20} />} title={search || etapa || organismo ? "Sin coincidencias" : "Sin procesamientos"} description={search || etapa || organismo ? "Prueba con otro término o cambia los filtros." : "Procesa una recepción aceptada para continuar el flujo."} action={canCreate && !search && !etapa && !organismo ? <Button onClick={() => router.push("/muestras/procesamiento/nuevo")}>Nuevo procesamiento</Button> : undefined} />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th className="w-[136px]">Folio</Th>
                <Th className="min-w-[240px]">Muestra</Th>
                <Th className="w-[150px]">Recepción</Th>
                <Th className={COL_FECHA}>Procesada</Th>
                <Th className={SOLO_ANCHO}>Organismo</Th>
                <Th>Estado</Th>
                <Th align="right" sticky />
              </tr>
            </THead>
            <TBody>
              {visible.map((item) => {
                const anulada = item.estado === "anulada";
                return (
                  <Tr key={item.id} interactive onClick={() => router.push(`/muestras/procesamiento/${item.id}`)} className={cn(FILA_LISTA, anulada && "opacity-60")}>
                    <Td>
                      <FolioChip type="P" num={item.folio_num} />
                    </Td>
                    <Td className="min-w-[240px] max-w-[380px]">
                      <CellPrimary lineas={2} title={item.id_interno || "—"} subtitle={item.muestra_tipo === "lote" ? "Lote" : "Muestra única"} />
                    </Td>
                    <Td>{item.folio_recepcion_num ? <FolioChip type="R" num={item.folio_recepcion_num} /> : <span className="text-[12.5px] text-ink-3">Sin vincular</span>}</Td>
                    <Td muted className={COL_FECHA}>
                      {fmtDate(item.fecha_procesamiento)}
                    </Td>
                    <Td muted className={SOLO_ANCHO}>{ORGANISMO[organismoDe(item)] || organismoDe(item) || "—"}</Td>
                    <Td>
                      <StatusCell>
                        <SampleStatus status={item.estado} />
                        <SupervisionBadge estado={item.supervision_estado} />
                        <SolicitudBadge solicitud={item.solicitud_pendiente as ApiRecord | null} />
                      </StatusCell>
                    </Td>
                    <Td align="right" sticky onClick={(event) => event.stopPropagation()}>
                      <ActionMenu items={menuFor(item)} header={`${formatProcessingFolio(item)} · ${item.id_interno || "lote"}`} />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </TableShell>
    </>
  );
}
