"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowCounterClockwise, ArrowSquareOut, Flask, Hash, PencilSimple, Plus, Printer, Prohibit, TestTube, UserPlus } from "@phosphor-icons/react";
import { useMenuReportar } from "@/components/features/calidad/ReportarIncidencia";
import { FolioChip, SampleStatus, SolicitudBadge, SupervisionBadge } from "@/components/features/samples/status";
import { useAnulacion } from "@/components/features/samples/useAnulacion";
import { RequireModule } from "@/components/session/RequireModule";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { FilterChips, FilterMenu, type FilterGroup, type FilterToggle } from "@/components/ui/FilterMenu";
import { ActionMenu, type MenuItem } from "@/components/ui/Overlay";
import { SearchInput, Toolbar } from "@/components/ui/PageHeader";
import { Badge, EmptyState, ErrorState, TableSkeleton } from "@/components/ui/Primitives";
import { FranjaPendientes } from "@/components/features/solicitudes/Solicitudes";
import { StatusCell } from "@/components/ui/StatusFlag";
import { CellPrimary, COL_FECHA, FILA_LISTA, Table, TBody, Td, Th, THead, Tr, TableShell } from "@/components/ui/Table";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { cn } from "@/components/ui/cn";
import { contar, fmtDate } from "@/lib/client/format";
import { useDebouncedValue, useInitialParam, useParamChange } from "@/lib/client/hooks";
import { ETAPAS_FLUJO, esEtapaFlujo, type EtapaFlujo } from "@/lib/client/flujo";
import { formatSampleFolio, normalizeSampleStatus } from "@/lib/client/samples";
import { useResource } from "@/lib/client/store";
import { estaHabilitada, motivoDe, seOfrece, usePuedeCrear } from "@/lib/client/puede";
import type { ApiRecord } from "@/lib/client/types";
import { ACCEPTANCE_DECISIONS, RECEPTION_ANALYSIS_TYPES, RECEPTION_STATE_ORDER, SAMPLE_STATES } from "@/lib/shared/sgc";
import { recepcionAsignable, useAccionesRecepcion } from "@/components/features/samples/RecepcionAcciones";

export default function RecepcionListPage() {
  return (
    <RequireModule modules="muestras">
      <RecepcionList />
    </RequireModule>
  );
}

const DECISION_TONE: Record<string, "success" | "warning" | "danger"> = { aceptada: "success", aceptada_con_desviacion: "warning", rechazada: "danger" };
const DECISION_SHORT: Record<string, string> = { aceptada: "Aceptada", aceptada_con_desviacion: "Con desviación", rechazada: "Rechazada" };
const ANALYSIS_SHORT: Record<string, string> = { acido_domoico: "ASP", toxinas_lipofilicas: "DSP", toxinas_paralizantes: "PSP", pigmentos: "Pigmentos", plancton: "Plancton", otro: "Otro" };

/* Fase 5: estados de la especificacion (solo hacia adelante). */
type EtapaFilter = "" | (typeof RECEPTION_STATE_ORDER)[number];
type DecisionFilter = "" | "aceptada" | "aceptada_con_desviacion" | "rechazada" | "pendiente";

const tiposDe = (item: ApiRecord): string[] => (Array.isArray(item.analisis?.tipos) ? item.analisis.tipos : Array.isArray(item.tipos_analisis) ? item.tipos_analisis : []);

function RecepcionList() {
  const { token, can } = useSession();
  const router = useRouter();
  const [search, setSearch] = useState(useInitialParam("buscar"));
  useParamChange("buscar", setSearch);
  const [showAnuladas, setShowAnuladas] = useState(false);
  const [etapa, setEtapa] = useState<EtapaFilter>("");
  const [decision, setDecision] = useState<DecisionFilter>("");
  const [analisis, setAnalisis] = useState("");
  const [mias, setMias] = useState(useInitialParam("mias") === "1");
  // Desde el Inicio: ?flujo=<etapa> muestra solo las recepciones en esa etapa del flujo.
  const flujoInicial = useInitialParam("flujo");
  const [flujo, setFlujo] = useState<EtapaFlujo | "">(esEtapaFlujo(flujoInicial) ? flujoInicial : "");
  const debounced = useDebouncedValue(search);
  const { anular, restaurar } = useAnulacion("reception", formatSampleFolio);

  const resource = useResource<ApiRecord[]>(
    "muestras",
    async () => {
      const data = await getJsonAuth(`${API_BASE_URL}/samples/reception?search=${encodeURIComponent(debounced.trim())}${showAnuladas ? "&anuladas=1" : ""}${mias ? "&mias=1" : ""}`, token);
      return (data.items || []) as ApiRecord[];
    },
    { enabled: !!token, deps: [debounced, showAnuladas, mias] },
  );
  const items = resource.data;
  const enFlujo = useResource<Map<number, string>>(
    "muestras",
    async () => {
      const data = await getJsonAuth(`${API_BASE_URL}/inicio/en-curso`, token);
      return new Map(((data.items || []) as ApiRecord[]).map((r) => [Number(r.id), String(r.etapa_flujo || "")]));
    },
    { enabled: !!token && !!flujo, deps: [flujo] },
  );

  const puedeCrear = usePuedeCrear();
  const canCreate = puedeCrear("recepcion", can("muestras", "C", { objeto: "recepcion", borrador: true }));
  const canEdit = (item: ApiRecord) => can("muestras", "E", { objeto: "recepcion", borrador: String(item.estado || "registrada") === "registrada" });
  const canProcesar = puedeCrear("procesamiento", can("ensayos", "C", { objeto: "procesamiento", borrador: true }));
  const canDelete = can("muestras", "AN");
  const canAsignar = can("muestras", "A");
  const acciones = useAccionesRecepcion(() => resource.reload());

  const count = (predicate: (item: ApiRecord) => boolean) => (items ? items.filter(predicate).length : null);
  const visible = useMemo(() => {
    const list = items || [];
    return list.filter((item) => {
      const estado = normalizeSampleStatus(item.estado);
      if (etapa && estado !== etapa) return false;
      if (flujo && enFlujo.data && enFlujo.data.get(Number(item.id)) !== flujo) return false;
      const dec = String(item.decision_aceptacion || "");
      if (decision === "pendiente" && dec) return false;
      if (decision && decision !== "pendiente" && dec !== decision) return false;
      if (analisis && !tiposDe(item).includes(analisis)) return false;
      return true;
    });
  }, [items, etapa, decision, analisis, flujo, enFlujo.data]);

  const groups: FilterGroup[] = [
    {
      key: "etapa",
      label: "Estado",
      value: etapa,
      defaultValue: "",
      onChange: (v) => setEtapa(v as EtapaFilter),
      options: [
        { value: "", label: "Todas", count: items ? items.length : null },
        ...RECEPTION_STATE_ORDER.map((estado) => ({ value: estado, label: SAMPLE_STATES[estado]?.label || estado, count: count((i) => normalizeSampleStatus(i.estado) === estado) })),
      ],
    },
    {
      key: "flujo",
      label: "Etapa del flujo",
      value: flujo,
      defaultValue: "",
      onChange: (v) => setFlujo(esEtapaFlujo(v) ? v : ""),
      options: [{ value: "", label: "Cualquiera" }, ...ETAPAS_FLUJO.map((e) => ({ value: e.clave, label: e.label }))],
    },
    {
      key: "decision",
      label: "Aceptación",
      value: decision,
      defaultValue: "",
      onChange: (v) => setDecision(v as DecisionFilter),
      options: [
        { value: "", label: "Cualquiera" },
        { value: "pendiente", label: "Sin decisión", count: count((i) => !i.decision_aceptacion), tone: "warning" },
        ...ACCEPTANCE_DECISIONS.map((d) => ({ value: d.value, label: DECISION_SHORT[d.value] || d.label, count: count((i) => i.decision_aceptacion === d.value) })),
      ],
    },
    {
      key: "analisis",
      label: "Análisis",
      value: analisis,
      defaultValue: "",
      onChange: setAnalisis,
      options: [{ value: "", label: "Cualquiera" }, ...RECEPTION_ANALYSIS_TYPES.map((t) => ({ value: t.value, label: ANALYSIS_SHORT[t.value] || t.label, count: count((i) => tiposDe(i).includes(t.value)) }))],
    },
  ];
  const toggles: FilterToggle[] = [
    { key: "mias", label: "Mis muestras", description: "Solo las recepciones asignadas a ti o que registraste.", checked: mias, onChange: setMias },
    { key: "anuladas", label: "Mostrar anuladas", description: "Incluye las recepciones anuladas con motivo.", checked: showAnuladas, onChange: setShowAnuladas },
  ];

  const reportar = useMenuReportar();
  const menuFor = (item: ApiRecord): MenuItem[] => {
    const anulada = item.estado === "anulada";
    const estado = String(item.estado || "");
    // Fase 5: las acciones dependen del estado (liberada, cerrada y rechazada ya no se editan) y del permiso.
    const terminada = ["liberada", "cerrada", "rechazada"].includes(estado);
    const puedeProcesar = canProcesar && !anulada && ["aceptada", "aceptada_con_desviacion"].includes(String(item.decision_aceptacion || "")) && !["rechazada", "cerrada", "liberada"].includes(estado);
    const list: MenuItem[] = [{ label: "Abrir", description: "Ver el formato completo", icon: <ArrowSquareOut size={16} weight="duotone" />, tone: "brand", onSelect: () => router.push(`/muestras/recepcion/${item.id}`) }];
    if (canAsignar && recepcionAsignable(item)) list.push({ label: "Asignar…", description: "Quién trabaja esta muestra", icon: <UserPlus size={16} weight="duotone" />, onSelect: () => acciones.asignar(item) });
    if (seOfrece(item, "editar", canEdit(item)) && !anulada && !terminada) list.push({ label: "Editar", description: motivoDe(item, "editar") || "Cambiar datos o decidir la aceptación", disabled: !estaHabilitada(item, "editar", canEdit(item)), icon: <PencilSimple size={16} weight="duotone" />, onSelect: () => router.push(`/muestras/recepcion/${item.id}`) });
    if (!anulada) list.push({ label: "Imprimir etiqueta", description: "Una etiqueta por muestra del lote", icon: <Printer size={16} weight="duotone" />, onSelect: () => router.push(`/muestras/recepcion/${item.id}/etiquetas`) });
    if (!anulada && !terminada && can("muestras", "E", { objeto: "recepcion" })) list.push({ label: "Cambiar folio…", description: "Con motivo; lo autoriza la Coord. Técnica", icon: <Hash size={16} weight="duotone" />, onSelect: () => acciones.cambiarFolio(item) });
    if (["cerrada", "rechazada"].includes(estado) && can("muestras", "E", { objeto: "recepcion" })) list.push({ label: "Reabrir…", description: "Vuelve al estado previo, con motivo", icon: <ArrowCounterClockwise size={16} weight="duotone" />, tone: "warning", onSelect: () => acciones.reabrir(item) });
    if (puedeProcesar) list.push({ label: "Procesar", description: "Crear el procesamiento de esta muestra", icon: <Flask size={16} weight="duotone" />, tone: "success", onSelect: () => router.push(`/muestras/procesamiento/nuevo?recepcion=${item.id}`) });
    list.push(...reportar("muestras_recepcion", item.id, formatSampleFolio(item)));
    if (canDelete) {
      if (anulada) list.push({ label: "Restaurar recepción", description: "Vuelve a la lista con motivo", icon: <ArrowCounterClockwise size={16} weight="duotone" />, tone: "warning", separatorBefore: true, onSelect: () => restaurar(item) });
      else list.push({ label: "Anular recepción…", description: "Queda en la bitácora con motivo", icon: <Prohibit size={16} weight="duotone" />, tone: "danger", separatorBefore: true, onSelect: () => anular(item) });
    }
    return list;
  };

  return (
    <>
      <FranjaPendientes entidades={["muestras_recepcion"]} grupo="recepcion" />
      <Toolbar
        end={
          canCreate ? (
            <Link href="/muestras/recepcion/nueva" className="press inline-flex h-9 items-center gap-2 rounded-[9px] bg-brand px-3.5 text-[13.5px] font-medium text-on-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] hover:bg-brand-strong">
              <Plus size={16} weight="bold" /> Nueva recepción
            </Link>
          ) : null
        }
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por folio, solicitante o ID interno" className="w-full md:w-[340px]" />
        <FilterMenu groups={groups} toggles={toggles} />
        <FilterChips groups={groups} toggles={toggles} />
      </Toolbar>

      <TableShell footer={items ? contar(visible.length, "recepción", "recepciones") : undefined}>
        {resource.error ? (
          <ErrorState message={resource.error} onRetry={resource.reload} />
        ) : !items ? (
          <TableSkeleton cols={6} />
        ) : !visible.length ? (
          <EmptyState icon={<TestTube size={20} />} title={search || etapa || decision || analisis ? "Sin coincidencias" : "Sin recepciones"} description={search || etapa || decision || analisis ? "Prueba con otro término o cambia los filtros." : "La recepción es el primer paso del flujo de muestras."} action={canCreate && !search && !etapa && !decision ? <Button onClick={() => router.push("/muestras/recepcion/nueva")}>Nueva recepción</Button> : undefined} />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th className="w-[136px]">Folio</Th>
                <Th className="min-w-[240px]">Muestra</Th>
                <Th className={COL_FECHA}>Recibida</Th>
                <Th>Análisis</Th>
                <Th className="w-[150px]">Aceptación</Th>
                <Th>Estado</Th>
                <Th align="right" sticky />
              </tr>
            </THead>
            <TBody>
              {visible.map((item) => {
                const anulada = item.estado === "anulada";
                const tipos = tiposDe(item);
                const dec = String(item.decision_aceptacion || "");
                return (
                  <Tr key={item.id} interactive onClick={() => router.push(`/muestras/recepcion/${item.id}`)} className={cn(FILA_LISTA, anulada && "opacity-60")}>
                    <Td>
                      <FolioChip type={String(item.tipo_registro || "R")} num={item.folio_num} />
                    </Td>
                    <Td className="min-w-[240px] max-w-[380px]">
                      <CellPrimary lineas={2} title={item.id_interno || (item.muestra_unica ? "—" : "Lote")} subtitle={item.solicitante || undefined} />
                    </Td>
                    <Td muted className={COL_FECHA}>
                      {fmtDate(item.fecha_recepcion)}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {tipos.length ? (
                          tipos.map((t) => (
                            <span key={t} className="rounded-[6px] bg-surface-3 px-1.5 py-0.5 text-[11.5px] font-medium text-ink-2">
                              {ANALYSIS_SHORT[t] || RECEPTION_ANALYSIS_TYPES.find((a) => a.value === t)?.label || t}
                            </span>
                          ))
                        ) : (
                          <span className="text-ink-4">—</span>
                        )}
                      </div>
                    </Td>
                    <Td>{dec ? <Badge tone={DECISION_TONE[dec]}>{DECISION_SHORT[dec] || dec}</Badge> : <span className="text-[12.5px] text-ink-3">Sin decisión</span>}</Td>
                    <Td>
                      <StatusCell>
                        <SampleStatus status={item.estado} />
                        <SupervisionBadge estado={item.supervision_estado} />
                        <SolicitudBadge solicitud={item.solicitud_pendiente as ApiRecord | null} />
                      </StatusCell>
                    </Td>
                    <Td align="right" sticky onClick={(event) => event.stopPropagation()}>
                      <ActionMenu items={menuFor(item)} header={`${formatSampleFolio(item)} · ${item.id_interno || "lote"}`} />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </TableShell>
      {acciones.dialogo}
    </>
  );
}
