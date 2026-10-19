"use client";

import { useRouter } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowCounterClockwise, Cube, PencilSimple, Plus, Trash, Wrench } from "@phosphor-icons/react";
import { useMenuReportar } from "@/components/features/calidad/ReportarIncidencia";
import { Caducidad, IconoEquipo } from "@/components/features/inventory/ventanas/comun";
import { EquipoVentana } from "@/components/features/inventory/ventanas/EquipoVentana";
import { EquipoSheet } from "@/components/features/inventory/EquipoSheets";
import { EQUIPO_ESTADOS, MANTENIMIENTO_TIPOS, metaFor } from "@/components/features/inventory/meta";
import { RequireModule } from "@/components/session/RequireModule";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { FilterMenu, type FilterGroup, type FilterToggle } from "@/components/ui/FilterMenu";
import { FiguraPersona } from "@/components/ui/FiguraPersona";
import { ListaCuadricula, type ColumnaLista } from "@/components/ui/ListaCuadricula";
import { ActionMenu, usePrompt, type MenuItem } from "@/components/ui/Overlay";
import { SearchInput, Toolbar } from "@/components/ui/PageHeader";
import { Badge, TableSkeleton, type Tone } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth, resolveApiEntity, sendJsonAuth } from "@/lib/client/api";
import { deadlineTone, fmt, fmtDate } from "@/lib/client/format";
import { formatearFechaCorta } from "@/lib/shared/fechas";
import { useDebouncedValue, useInitialParam, useOpenState, useParamChange, useUrlTrigger, useAbrirDesdeUrl } from "@/lib/client/hooks";
import { invalidate, useResource } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";

/* Columnas fijas de la lista de equipos. */
const COLUMNAS: ColumnaLista[] = [
  { clave: "equipo", titulo: "Equipo", ancho: "minmax(240px,1.5fr)" },
  { clave: "estado", titulo: "Estado", ancho: "minmax(150px,0.9fr)" },
  { clave: "calibracion", titulo: "Próxima calibración", ancho: "160px" },
  { clave: "mantenimiento", titulo: "Próximo mantenimiento", ancho: "170px" },
  { clave: "responsable", titulo: "Responsable", ancho: "minmax(160px,1fr)" },
];

export default function EquiposPage() {
  return (
    <RequireModule modules="equipos">
      <Suspense fallback={<TableSkeleton />}>
        <EquiposContent />
      </Suspense>
    </RequireModule>
  );
}

/* Los segmentos son los estados del equipo; "calibracion" agrupa calibración pendiente y fuera de servicio. */
type Filter = "todos" | "operativo" | "mantenimiento" | "calibracion";
type Orden = "nombre" | "calibracion" | "mantenimiento";

const calibrationTone = (value: unknown) => deadlineTone(value);

function EquiposContent() {
  const { token, can } = useSession();
  const router = useRouter();
  const prompt = usePrompt();
  const [search, setSearch] = useState(useInitialParam("buscar"));
  const initialFilter = useInitialParam("filtro");
  const [filter, setFilter] = useState<Filter>(initialFilter === "operativo" || initialFilter === "mantenimiento" || initialFilter === "calibracion" ? initialFilter : "todos");
  const debounced = useDebouncedValue(search);
  const [showBajas, setShowBajas] = useState(initialFilter === "bajas");
  const modal = useOpenState<ApiRecord>();
  const [abierta, setAbierta] = useState<number | null>(null);
  const [orden, setOrden] = useState<Orden>("nombre");

  useParamChange("buscar", (value) => setSearch(value));
  useParamChange("filtro", (value) => {
    setFilter(value === "operativo" || value === "mantenimiento" || value === "calibracion" ? value : "todos");
    setShowBajas(value === "bajas");
  });

  const resource = useResource<ApiRecord[]>(
    "equipos",
    async () => {
      const data = await getJsonAuth(`${API_BASE_URL}/inventory/equipos?search=${encodeURIComponent(debounced.trim())}${showBajas ? "&bajas=1" : ""}`, token);
      return (data.items || []) as ApiRecord[];
    },
    { enabled: !!token, deps: [debounced, showBajas] },
  );
  const items = resource.data;

  useUrlTrigger("nuevo", () => {
    if (can("equipos", "C", { objeto: "equipo" })) modal.open(null);
  });

  const isAlert = (item: ApiRecord) => ["fuera_servicio", "calibracion_pendiente"].includes(String(item.estado)) || calibrationTone(item.fecha_prox_calibracion) === "danger";

  /*
   * Estado que se muestra: el guardado, salvo que un equipo operativo tenga la
   * calibración vencida por fecha (entonces se ve "Calibración vencida"). Debajo,
   * el mantenimiento pendiente que explica un "En mantenimiento".
   */
  const displayState = (item: ApiRecord): { label: string; tone: Tone; detail: string | null; detailTone: "danger" | "warning" | null } => {
    const meta = metaFor(EQUIPO_ESTADOS, item.estado);
    const fem = item.mantenimiento_tipo === "calibracion";
    const estadoTxt = item.mantenimiento_estado === "vencido" ? (fem ? "vencida" : "vencido") : item.mantenimiento_estado === "en_proceso" ? "en proceso" : fem ? "programada" : "programado";
    const pendiente = item.mantenimiento_tipo ? `${metaFor(MANTENIMIENTO_TIPOS, item.mantenimiento_tipo).label} ${estadoTxt} · ${fmtDate(item.mantenimiento_fecha)}` : null;
    if (item.estado === "operativo" && calibrationTone(item.fecha_prox_calibracion) === "danger") {
      return { label: "Calibración vencida", tone: "danger", detail: pendiente, detailTone: "danger" };
    }
    return { label: meta.label, tone: meta.tone, detail: pendiente, detailTone: item.mantenimiento_estado === "vencido" ? "danger" : pendiente ? "warning" : null };
  };

  const visible = useMemo(() => {
    let list = items || [];
    if (filter === "operativo") list = list.filter((item) => item.estado === "operativo");
    if (filter === "mantenimiento") list = list.filter((item) => item.estado === "mantenimiento");
    if (filter === "calibracion") list = list.filter(isAlert);
    if (orden === "calibracion") return [...list].sort((a, b) => String(a.fecha_prox_calibracion || "9999").localeCompare(String(b.fecha_prox_calibracion || "9999")));
    if (orden === "mantenimiento") return [...list].sort((a, b) => String(a.mantenimiento_fecha || "9999").localeCompare(String(b.mantenimiento_fecha || "9999")));
    return [...list].sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));
  }, [items, filter, orden]);
  useAbrirDesdeUrl(items ? visible : null, setAbierta);

  const editEquipo = async (id: number) => {
    try {
      const data = await getJsonAuth(`${API_BASE_URL}/inventory/equipos/${id}`, token);
      modal.open(resolveApiEntity(data));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo cargar el equipo");
    }
  };

  // Baja logica con motivo: el equipo conserva mantenimientos, bitacoras y registros que lo citan.
  const deleteEquipo = async (item: ApiRecord) => {
    const motivo = await prompt({ critico: true, title: `Dar de baja "${item.nombre}"`, description: "El equipo deja de ofrecerse en los formatos; sus mantenimientos y los registros que lo citan se conservan.", confirmLabel: "Dar de baja", tone: "danger" });
    if (!motivo) return;
    try {
      await sendJsonAuth("DELETE", `${API_BASE_URL}/inventory/equipos/${item.id}`, token, { motivo });
      toast.success("Equipo dado de baja");
      invalidate("equipos", "mantenimientos", "dashboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo dar de baja");
    }
  };

  const reactivarEquipo = async (item: ApiRecord) => {
    const motivo = await prompt({ critico: true, title: `Reactivar "${item.nombre}"`, confirmLabel: "Reactivar" });
    if (!motivo) return;
    try {
      await sendJsonAuth("POST", `${API_BASE_URL}/inventory/equipos/${item.id}/reactivar`, token, { motivo });
      toast.success("Equipo reactivado");
      invalidate("equipos", "mantenimientos", "dashboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo reactivar");
    }
  };

  const canCreate = can("equipos", "C", { objeto: "equipo" });
  const canEditar = can("equipos", "E", { objeto: "equipo" });
  const canBaja = can("equipos", "AN");
  const canReactivar = can("equipos", "G");

  const groups: FilterGroup[] = [
    {
      key: "estado",
      label: "Estado",
      value: filter,
      defaultValue: "todos",
      onChange: (v) => setFilter(v as Filter),
      options: [
        { value: "todos", label: "Todos" },
        { value: "operativo", label: "Operativos" },
        { value: "mantenimiento", label: "En mantenimiento" },
        { value: "calibracion", label: "Con alerta de calibración" },
      ],
    },
  ];
  const toggles: FilterToggle[] = [{ key: "bajas", label: "Mostrar bajas", group: "Vista", checked: showBajas, onChange: setShowBajas }];
  const ordenar: FilterGroup[] = [
    {
      key: "orden",
      label: "Ordenar por",
      value: orden,
      defaultValue: "nombre",
      showDefault: true,
      onChange: (v) => setOrden(v as Orden),
      options: [
        { value: "nombre", label: "Nombre A–Z" },
        { value: "calibracion", label: "Calibración más próxima" },
        { value: "mantenimiento", label: "Mantenimiento más próximo" },
      ],
    },
  ];

  const reportar = useMenuReportar();
  const canProgramar = can("equipos", "C", { objeto: "mantenimiento" });
  const programar = (item: ApiRecord) => router.push(`/inventario/mantenimiento?nuevo=1&equipo=${item.id}`);
  const menuFor = (item: ApiRecord): MenuItem[] => {
    const inactive = Number(item.activo ?? 1) === 0;
    const list: MenuItem[] = [];
    if (canProgramar && !inactive) list.push({ label: "Programar mantenimiento", description: "Preventivo, correctivo o calibración", icon: <Wrench size={16} weight="duotone" />, tone: "success", onSelect: () => programar(item) });
    if (canEditar) list.push({ label: "Editar", description: "Cambiar datos del equipo", icon: <PencilSimple size={16} weight="duotone" />, onSelect: () => editEquipo(Number(item.id)) });
    list.push(...reportar("equipos", item.id, String(item.nombre || "Equipo")));
    if (inactive ? canReactivar : canBaja) {
      if (inactive) list.push({ label: "Reactivar…", description: "Vuelve al inventario con motivo", icon: <ArrowCounterClockwise size={16} weight="duotone" />, tone: "warning", separatorBefore: true, onSelect: () => reactivarEquipo(item) });
      else list.push({ label: "Dar de baja…", description: "Deja de ofrecerse; conserva su historial", icon: <Trash size={16} weight="duotone" />, tone: "danger", separatorBefore: true, onSelect: () => deleteEquipo(item) });
    }
    return list;
  };

  /* Celdas: equipo y clave de bitacora; estado en color; proxima calibracion; proximo mantenimiento; responsable. */
  const celdas = (item: ApiRecord) => {
    const state = displayState(item);
    const inactive = Number(item.activo ?? 1) === 0;
    return [
      <span key="e" className={inactive ? "flex min-w-0 items-center gap-3 opacity-60" : "flex min-w-0 items-center gap-3"}>
        <IconoEquipo nombre={item.nombre} />
        <span className="flex min-w-0 flex-col">
          <span className="text-base leading-tight font-semibold text-ink">
            {String(item.nombre || "—")}
            {inactive ? <Badge tone="danger" className="ml-2 align-middle">Baja</Badge> : null}
          </span>
          <span className="text-xs text-ink-3">{item.clave_bitacora ? `Bitácora ${String(item.clave_bitacora)}` : [item.marca, item.modelo].filter(Boolean).join(" · ") || "Sin clave de bitácora"}</span>
        </span>
      </span>,
      <span key="s" className="flex flex-col items-start gap-1">
        <Badge tone={state.tone} dot>
          {state.label}
        </Badge>
      </span>,
      <Caducidad key="c" value={item.fecha_prox_calibracion} />,
      item.mantenimiento_fecha ? (
        <span key="m" className="flex flex-col">
          <span className={item.mantenimiento_estado === "vencido" ? "text-sm font-medium text-danger" : "text-sm text-ink-2"}>{formatearFechaCorta(item.mantenimiento_fecha)}</span>
          <span className="text-xs text-ink-3">
            {metaFor(MANTENIMIENTO_TIPOS, item.mantenimiento_tipo).label}
            {item.mantenimiento_estado === "vencido" ? " · vencido" : item.mantenimiento_estado === "en_proceso" ? " · en proceso" : ""}
          </span>
        </span>
      ) : (
        <span key="m" className="text-sm text-ink-4">—</span>
      ),
      item.responsable || item.id_responsable ? <FiguraPersona key="r" id={item.id_responsable} nombre={item.responsable} conNombre /> : <span key="r" className="text-sm text-ink-4">—</span>,
    ];
  };

  return (
    <>
      <Toolbar
        end={
          canCreate ? (
            <Button icon={<Plus size={16} weight="bold" />} onClick={() => modal.open(null)}>
              Nuevo equipo
            </Button>
          ) : null
        }
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nombre, marca o modelo" className="min-w-0 flex-1 md:w-[340px] md:flex-none" />
        <FilterMenu groups={groups} toggles={toggles} gruposFinales={ordenar} vistaAlFinal />
      </Toolbar>

      <ListaCuadricula
        etiqueta="Equipos"
        columnas={COLUMNAS}
        filas={items ? visible : null}
        error={resource.error}
        onReintentar={resource.reload}
        clave={(item) => String(item.id)}
        onAbrir={(_, i) => setAbierta(i)}
        activa={(_, i) => abierta === i}
        celdas={celdas}
        extremo={(item) => (
          <span className="w-9">
            <ActionMenu items={menuFor(item)} header={String(item.nombre || "")} />
          </span>
        )}
        anchoExtremo="52px"
        propsFila={(item) => ({ "data-equipo": String(item.id) })}
        vacio={{
          icono: <Cube size={20} />,
          titulo: search || filter !== "todos" ? "Sin coincidencias" : "Aún no hay equipos",
          descripcion: search || filter !== "todos" ? "Ajusta la búsqueda o el filtro." : "Registra los equipos del laboratorio para programar su mantenimiento.",
          accion: canCreate && !search && filter === "todos" ? <Button onClick={() => modal.open(null)}>Nuevo equipo</Button> : undefined,
        }}
      />
      {items && visible.length ? <p className="tnum mt-2 px-1 text-xs text-ink-3">{visible.length === 1 ? "1 equipo" : `${fmt(visible.length)} equipos`}</p> : null}

      <EquipoVentana
        items={visible}
        indice={abierta !== null && abierta < visible.length ? abierta : null}
        onIndice={setAbierta}
        onCerrar={() => setAbierta(null)}
        estadoDe={displayState}
        acciones={{ puedeProgramar: canProgramar, puedeEditar: canEditar, puedeBaja: canBaja, puedeReactivar: canReactivar, programar, editar: (item) => editEquipo(Number(item.id)), darDeBaja: deleteEquipo, reactivar: reactivarEquipo }}
      />

      {modal.key ? <EquipoSheet key={`modal-${modal.key}`} open={modal.isOpen} item={modal.payload} onClose={modal.close} /> : null}
    </>
  );
}
