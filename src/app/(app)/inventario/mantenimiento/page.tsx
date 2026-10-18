"use client";

import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import { PencilSimple, Plus, Prohibit, Wrench } from "@phosphor-icons/react";
import { MantenimientoSheet } from "@/components/features/inventory/EquipoSheets";
import { MANTENIMIENTO_ESTADOS, MANTENIMIENTO_TIPOS, metaFor } from "@/components/features/inventory/meta";
import { RequireModule } from "@/components/session/RequireModule";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { FilterMenu, type FilterGroup } from "@/components/ui/FilterMenu";
import { ListaCuadricula, type ColumnaLista } from "@/components/ui/ListaCuadricula";
import { IconoEquipo } from "@/components/features/inventory/ventanas/comun";
import { MantenimientoVentana } from "@/components/features/inventory/ventanas/MantenimientoVentana";
import { ActionMenu, usePrompt, type MenuItem } from "@/components/ui/Overlay";
import { SearchInput, Toolbar } from "@/components/ui/PageHeader";
import { Badge, TableSkeleton } from "@/components/ui/Primitives";
import { ReportesMantenimiento } from "@/components/features/inventory/ReportesMantenimiento";
import { API_BASE_URL, getJsonAuth, resolveApiEntity, sendJsonAuth } from "@/lib/client/api";
import { fmt, todayIso } from "@/lib/client/format";
import { useDebouncedValue, useInitialParam, useOpenState, useParamChange, useUrlTrigger, useAbrirDesdeUrl } from "@/lib/client/hooks";
import { invalidate, useResource } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { formatearFechaCorta, sumarDias } from "@/lib/shared/fechas";

type Orden = "fecha" | "equipo";

/* Columnas fijas: equipo, tipo, fecha programada y estado. */
const COLUMNAS: ColumnaLista[] = [
  { clave: "equipo", titulo: "Equipo", ancho: "minmax(240px,1.6fr)" },
  { clave: "tipo", titulo: "Tipo", ancho: "140px" },
  { clave: "fecha", titulo: "Fecha programada", ancho: "170px" },
  { clave: "estado", titulo: "Estado", ancho: "150px" },
];

export default function MantenimientoPage() {
  return (
    <RequireModule modules="equipos">
      <Suspense fallback={<TableSkeleton />}>
        <MantenimientoContent />
      </Suspense>
    </RequireModule>
  );
}

function MantenimientoContent() {
  const { token, can } = useSession();
  const prompt = usePrompt();
  const [search, setSearch] = useState(useInitialParam("buscar"));
  useParamChange("buscar", setSearch);
  const [tipo, setTipo] = useState("");
  type EstadoFilter = "" | "pendiente" | "proximo" | "completado" | "vencido";
  const ESTADOS: EstadoFilter[] = ["", "pendiente", "proximo", "completado", "vencido"];
  const initialFilter = useInitialParam("filtro");
  // Por omisión solo lo pendiente: lo completado es historial del equipo.
  const [estado, setEstado] = useState<EstadoFilter>(ESTADOS.includes(initialFilter as EstadoFilter) && initialFilter ? (initialFilter as EstadoFilter) : "pendiente");
  useParamChange("filtro", (value) => setEstado(ESTADOS.includes(value as EstadoFilter) && value ? (value as EstadoFilter) : "pendiente"));
  const debounced = useDebouncedValue(search);
  const modal = useOpenState<ApiRecord>();
  const [abierta, setAbierta] = useState<number | null>(null);
  const [orden, setOrden] = useState<Orden>("fecha");

  const resource = useResource<ApiRecord[]>(
    "mantenimientos",
    async () => {
      const data = await getJsonAuth(`${API_BASE_URL}/inventory/mantenimientos?search=${encodeURIComponent(debounced.trim())}&tipo=${encodeURIComponent(tipo)}`, token);
      return (data.items || []) as ApiRecord[];
    },
    { enabled: !!token, deps: [debounced, tipo] },
  );
  const items = resource.data;

  // ?nuevo=1&equipo=ID (desde la ficha o el menú de un equipo) abre el alta con el equipo ya elegido.
  const equipoPrefill = useInitialParam("equipo");
  useUrlTrigger("nuevo", () => {
    if (can("equipos", "C", { objeto: "mantenimiento" })) modal.open(equipoPrefill ? ({ id_equipo: Number(equipoPrefill) } as ApiRecord) : null);
  });

  // Mismas reglas que los contadores del Inicio: vencido = estado "vencido" o pendiente con fecha pasada;
  // próximo = pendiente con fecha en los siguientes 30 días. Las fechas se fijan al montar.
  const [dates] = useState(() => ({ today: todayIso(), in30: sumarDias(todayIso(), 30) }));
  const rules = useMemo(() => {
    const dateOf = (item: ApiRecord) => String(item.fecha_programada || "").slice(0, 10);
    const isPendiente = (item: ApiRecord) => ["programado", "en_proceso"].includes(String(item.estado));
    return {
      abierto: (item: ApiRecord) => isPendiente(item) || item.estado === "vencido",
      vencido: (item: ApiRecord) => item.estado === "vencido" || (isPendiente(item) && dateOf(item) < dates.today),
      proximo: (item: ApiRecord) => isPendiente(item) && dateOf(item) >= dates.today && dateOf(item) <= dates.in30,
      completado: (item: ApiRecord) => item.estado === "completado",
    };
  }, [dates]);

  const visible = useMemo(() => {
    let list = items || [];
    if (estado === "pendiente") list = list.filter(rules.abierto);
    if (estado === "proximo") list = list.filter(rules.proximo);
    if (estado === "completado") list = list.filter(rules.completado);
    if (estado === "vencido") list = list.filter(rules.vencido);
    if (orden === "equipo") return [...list].sort((a, b) => String(a.equipo || "").localeCompare(String(b.equipo || ""), "es"));
    return [...list].sort((a, b) => String(a.fecha_programada || "").localeCompare(String(b.fecha_programada || "")));
  }, [items, estado, rules, orden]);
  useAbrirDesdeUrl(items ? visible : null, setAbierta);

  const editItem = async (id: number) => {
    try {
      const data = await getJsonAuth(`${API_BASE_URL}/inventory/mantenimientos/${id}`, token);
      modal.open(resolveApiEntity(data));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo cargar el mantenimiento");
    }
  };

  // Los mantenimientos forman el historial del equipo: se cancelan con motivo, no se borran.
  const deleteItem = async (item: ApiRecord) => {
    const motivo = await prompt({ critico: true, title: "Cancelar mantenimiento", description: "El registro queda como cancelado con el motivo; sigue visible en el historial del equipo.", confirmLabel: "Cancelar mantenimiento", tone: "danger" });
    if (!motivo) return;
    try {
      await sendJsonAuth("DELETE", `${API_BASE_URL}/inventory/mantenimientos/${item.id}`, token, { motivo });
      toast.success("Mantenimiento cancelado");
      invalidate("mantenimientos", "documentos", "dashboard", "equipos");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo cancelar");
    }
  };

  const canCreate = can("equipos", "C", { objeto: "mantenimiento" });
  const canUpdate = can("equipos", "E", { objeto: "mantenimiento" });
  const canDelete = can("equipos", "AN");
  const filtered = !!(search || tipo || estado !== "pendiente");

  const groups: FilterGroup[] = [
    {
      key: "estado",
      label: "Estado",
      value: estado,
      defaultValue: "pendiente",
      showDefault: true,
      onChange: (v) => setEstado(v as EstadoFilter),
      options: [
        { value: "pendiente", label: "Pendientes" },
        { value: "proximo", label: "Próximos 30 días" },
        { value: "vencido", label: "Vencidos" },
        { value: "completado", label: "Completados" },
        { value: "", label: "Todos" },
      ],
    },
    {
      key: "tipo",
      label: "Tipo",
      value: tipo,
      defaultValue: "",
      onChange: setTipo,
      options: [{ value: "", label: "Cualquiera" }, ...MANTENIMIENTO_TIPOS.map((t) => ({ value: t.value, label: t.label }))],
    },
  ];
  const ordenar: FilterGroup[] = [
    {
      key: "orden",
      label: "Ordenar por",
      value: orden,
      defaultValue: "fecha",
      showDefault: true,
      onChange: (v) => setOrden(v as Orden),
      options: [
        { value: "fecha", label: "Fecha programada" },
        { value: "equipo", label: "Equipo A–Z" },
      ],
    },
  ];

  const menuFor = (item: ApiRecord): MenuItem[] => {
    const list: MenuItem[] = [];
    if (canUpdate) list.push({ label: "Editar", description: "Cambiar fecha, técnico, estado u observaciones", icon: <PencilSimple size={16} weight="duotone" />, tone: "brand", onSelect: () => editItem(Number(item.id)) });
    if (canDelete) list.push({ label: "Cancelar mantenimiento…", description: "Queda cancelado con motivo en el historial", icon: <Prohibit size={16} weight="duotone" />, tone: "danger", disabled: item.estado === "cancelado", separatorBefore: list.length > 0, onSelect: () => deleteItem(item) });
    return list;
  };

  /* Celdas: equipo, tipo, fecha programada (roja si ya paso) y estado. */
  const celdas = (item: ApiRecord) => {
    const estadoMeta = metaFor(MANTENIMIENTO_ESTADOS, item.estado);
    const tipoMeta = metaFor(MANTENIMIENTO_TIPOS, item.tipo);
    const vencido = rules.vencido(item);
    return [
      <span key="e" className="flex min-w-0 items-center gap-3">
        <IconoEquipo nombre={item.equipo} tono={vencido ? "bg-danger-soft text-danger" : "bg-brand-faint text-brand-strong"} />
        <span className="flex min-w-0 flex-col">
          <span className="text-[14.5px] leading-tight font-semibold text-ink">{String(item.equipo || "Equipo sin nombre")}</span>
          <span className="text-[12.5px] text-ink-3">{item.tecnico_proveedor ? String(item.tecnico_proveedor) : [item.equipo_marca, item.equipo_modelo].filter(Boolean).join(" · ") || "Sin técnico asignado"}</span>
        </span>
      </span>,
      <Badge key="t" tone={tipoMeta.tone}>
        {tipoMeta.label}
      </Badge>,
      <span key="f" className="flex flex-col">
        <span className={vencido ? "text-[13.5px] font-medium text-danger" : "text-[13.5px] text-ink-2"}>{formatearFechaCorta(item.fecha_programada)}</span>
        {item.fecha_realizado ? <span className="text-[12px] text-ink-3">realizado el {formatearFechaCorta(item.fecha_realizado)}</span> : vencido ? <span className="text-[12px] text-danger">ya pasó la fecha</span> : null}
      </span>,
      <Badge key="s" tone={estadoMeta.tone} dot>
        {estadoMeta.label}
      </Badge>,
    ];
  };

  return (
    <>
      <Toolbar
        end={
          canCreate ? (
            <Button icon={<Plus size={16} weight="bold" />} onClick={() => modal.open(null)}>
              Programar mantenimiento
            </Button>
          ) : null
        }
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por equipo o proveedor" className="w-full md:w-[340px]" />
        <FilterMenu groups={groups} gruposFinales={ordenar} />
      </Toolbar>

      <ListaCuadricula
        etiqueta="Mantenimientos"
        columnas={COLUMNAS}
        filas={items ? visible : null}
        error={resource.error}
        onReintentar={resource.reload}
        clave={(item) => String(item.id)}
        onAbrir={(_, i) => setAbierta(i)}
        activa={(_, i) => abierta === i}
        celdas={celdas}
        extremo={(item) => {
          const menu = menuFor(item);
          return <span className="w-9">{menu.length ? <ActionMenu items={menu} header={String(item.equipo || "Mantenimiento")} /> : null}</span>;
        }}
        anchoExtremo="52px"
        propsFila={(item) => ({ "data-mantenimiento": String(item.id) })}
        vacio={{
          icono: <Wrench size={20} />,
          titulo: filtered ? "Sin coincidencias" : "Sin mantenimientos programados",
          descripcion: filtered ? "Ajusta la búsqueda o los filtros." : "Programa el primer mantenimiento o calibración de un equipo.",
          accion: canCreate && !filtered ? <Button onClick={() => modal.open(null)}>Programar mantenimiento</Button> : undefined,
        }}
      />
      {items && visible.length ? <p className="tnum mt-2 px-1 text-[12px] text-ink-3">{visible.length === 1 ? "1 registro" : `${fmt(visible.length)} registros`}</p> : null}

      <MantenimientoVentana
        items={visible}
        indice={abierta !== null && abierta < visible.length ? abierta : null}
        onIndice={setAbierta}
        onCerrar={() => setAbierta(null)}
        puedeEditar={canUpdate}
        puedeCancelar={canDelete}
        puedeAdjuntar={canCreate || canUpdate}
        editar={(item) => {
          setAbierta(null);
          void editItem(Number(item.id));
        }}
        cancelar={deleteItem}
      />

      <ReportesMantenimiento />

      {modal.key ? <MantenimientoSheet key={`modal-${modal.key}`} open={modal.isOpen} item={modal.payload} onClose={modal.close} /> : null}
    </>
  );
}
