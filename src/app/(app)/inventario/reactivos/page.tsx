"use client";

import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowCounterClockwise, ArrowsClockwise, Flask, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { useMenuReportar } from "@/components/features/calidad/ReportarIncidencia";
import { Caducidad, IconoCategoria } from "@/components/features/inventory/ventanas/comun";
import { InsumoVentana } from "@/components/features/inventory/ventanas/InsumoVentana";
import { ReactivoSheet } from "@/components/features/inventory/ReactivoSheet";
import { StockRefillSheet, type StockRefillTarget } from "@/components/features/inventory/StockRefillSheet";
import { RequireModule } from "@/components/session/RequireModule";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { FilterMenu, type FilterGroup, type FilterToggle } from "@/components/ui/FilterMenu";
import { ListaCuadricula, type ColumnaLista } from "@/components/ui/ListaCuadricula";
import { ActionMenu, usePrompt, type MenuItem } from "@/components/ui/Overlay";
import { SearchInput, Toolbar } from "@/components/ui/PageHeader";
import { Badge, StockMeter, TableSkeleton } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth, resolveApiEntity, sendJsonAuth } from "@/lib/client/api";
import { deadlineTone, fmt } from "@/lib/client/format";
import { useDebouncedValue, useInitialParam, useOpenState, useParamChange, useUrlTrigger, useAbrirDesdeUrl } from "@/lib/client/hooks";
import { formatReactivoName, getReactivoExpiry, getReactivoLocation, getReactivoStockInfo, getReactivoStockState, getReactivoTypeLabel, isReactivoLow } from "@/lib/client/reactivos";
import { invalidate, useResource } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";

/* Columnas fijas: producto (icono por categoria) y marca, ubicacion, caducidad en color y existencia con barra. */
const COLUMNAS: ColumnaLista[] = [
  { clave: "producto", titulo: "Producto", ancho: "minmax(260px,1.7fr)" },
  { clave: "ubicacion", titulo: "Ubicación", ancho: "minmax(140px,0.8fr)" },
  { clave: "caducidad", titulo: "Caducidad", ancho: "150px" },
  { clave: "existencia", titulo: "Existencia", ancho: "minmax(180px,1fr)" },
];

function celdasReactivo(item: ApiRecord) {
  const stock = getReactivoStockState(item);
  const inactive = Number(item.activo ?? 1) === 0;
  const esColumna = (item.tipo_reactivo || item.categoria) === "columnas_cromatograficas";
  return [
    <span key="p" className={inactive ? "flex min-w-0 items-center gap-3 opacity-60" : "flex min-w-0 items-center gap-3"}>
      <IconoCategoria categoria={item.tipo_reactivo || item.categoria} />
      <span className="flex min-w-0 flex-col">
        <span className="text-base leading-tight font-semibold text-ink">
          {formatReactivoName(item)}
          {inactive ? <Badge tone="danger" className="ml-2 align-middle">Baja</Badge> : null}
        </span>
        <span className="text-xs text-ink-3">{[getReactivoTypeLabel(item.tipo_reactivo || item.categoria), item.marca].filter(Boolean).join(" · ")}</span>
      </span>
    </span>,
    <span key="u" className="text-sm text-ink-2">{getReactivoLocation(item) === "-" ? <span className="text-ink-4">—</span> : getReactivoLocation(item)}</span>,
    esColumna ? <span key="c" className="text-sm text-ink-4">—</span> : Number(item.caducidad_indefinida) === 1 ? <span key="c" className="text-sm text-ink-2">Indefinida</span> : <Caducidad key="c" value={expiryOf(item)} />,
    esColumna ? (
      <span key="e" className="text-sm text-ink-3">{[item.lote ? `Lote ${item.lote}` : null, item.nuevo_usado].filter(Boolean).join(" · ") || "Sin existencias"}</span>
    ) : (
      <StockMeter key="e" current={stock.current} max={stock.max} min={stock.min} unit={stock.unit} low={stock.low} />
    ),
  ];
}

export default function ReactivosPage() {
  return (
    <RequireModule modules="inventario">
      <Suspense fallback={<TableSkeleton />}>
        <ReactivosContent />
      </Suspense>
    </RequireModule>
  );
}

type Filter = "todos" | "bajo" | "vencer";
type Orden = "nombre" | "caducidad" | "existencia";

/* Un "-" como caducidad se trata como vacío. */
const expiryOf = (item: ApiRecord): unknown => {
  const value = getReactivoExpiry(item);
  return value && String(value).trim() !== "-" ? value : null;
};

const expiryTone = (value: unknown) => deadlineTone(value);

const isLow = isReactivoLow;

function ReactivosContent() {
  const { token, can } = useSession();
  const prompt = usePrompt();
  const [search, setSearch] = useState(useInitialParam("buscar"));
  const initialFilter = useInitialParam("filtro");
  const [filter, setFilter] = useState<Filter>(initialFilter === "bajo" || initialFilter === "vencer" ? initialFilter : "todos");
  const [showBajas, setShowBajas] = useState(initialFilter === "bajas");
  const debounced = useDebouncedValue(search);
  const modal = useOpenState<ApiRecord>();
  const refill = useOpenState<StockRefillTarget>();
  const [abierta, setAbierta] = useState<number | null>(null);
  const [orden, setOrden] = useState<Orden>("nombre");

  /* Si ya estamos en la lista y la búsqueda global manda otro ?buscar= o ?filtro=, se aplica. */
  useParamChange("buscar", (value) => setSearch(value));
  useParamChange("filtro", (value) => {
    setFilter(value === "bajo" || value === "vencer" ? value : "todos");
    setShowBajas(value === "bajas");
  });

  const resource = useResource<ApiRecord[]>(
    "reactivos",
    async () => {
      const data = await getJsonAuth(`${API_BASE_URL}/inventory/reactivos?search=${encodeURIComponent(debounced.trim())}${showBajas ? "&bajas=1" : ""}`, token);
      return (data.items || []) as ApiRecord[];
    },
    { enabled: !!token, deps: [debounced, showBajas] },
  );
  const items = resource.data;

  useUrlTrigger("nuevo", () => {
    if (can("inventario", "C", { objeto: "catalogo_inventario" })) modal.open(null);
  });

  const visible = useMemo(() => {
    let list = items || [];
    if (filter === "bajo") list = list.filter(isLow);
    if (filter === "vencer") list = list.filter((item) => expiryTone(expiryOf(item)));
    const nombre = (i: ApiRecord) => formatReactivoName(i);
    if (orden === "caducidad") return [...list].sort((a, b) => String(expiryOf(a) || "9999").localeCompare(String(expiryOf(b) || "9999")));
    if (orden === "existencia") {
      const pct = (i: ApiRecord) => {
        const st = getReactivoStockState(i);
        return st.current === null ? Infinity : st.max ? st.current / st.max : st.current;
      };
      return [...list].sort((a, b) => pct(a) - pct(b));
    }
    return [...list].sort((a, b) => nombre(a).localeCompare(nombre(b), "es"));
  }, [items, filter, orden]);
  useAbrirDesdeUrl(items ? visible : null, setAbierta);

  const editReactivo = async (id: number) => {
    try {
      const data = await getJsonAuth(`${API_BASE_URL}/inventory/reactivos/${id}`, token);
      modal.open(resolveApiEntity(data));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo cargar el reactivo");
    }
  };

  // Baja logica con motivo: el reactivo deja de ofrecerse, sus movimientos se conservan.
  const deleteReactivo = async (item: ApiRecord) => {
    const motivo = await prompt({ critico: true, title: `Dar de baja "${formatReactivoName(item)}"`, description: "El reactivo deja de aparecer en el inventario y en los formatos; sus movimientos y registros se conservan.", confirmLabel: "Dar de baja", tone: "danger" });
    if (!motivo) return;
    try {
      await sendJsonAuth("DELETE", `${API_BASE_URL}/inventory/reactivos/${item.id}`, token, { motivo });
      toast.success("Reactivo dado de baja");
      invalidate("reactivos", "dashboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo dar de baja");
    }
  };

  const reactivarReactivo = async (item: ApiRecord) => {
    const motivo = await prompt({ critico: true, title: `Reactivar "${formatReactivoName(item)}"`, confirmLabel: "Reactivar" });
    if (!motivo) return;
    try {
      await sendJsonAuth("POST", `${API_BASE_URL}/inventory/reactivos/${item.id}/reactivar`, token, { motivo });
      toast.success("Reactivo reactivado");
      invalidate("reactivos", "dashboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo reactivar");
    }
  };

  const canCreate = can("inventario", "C", { objeto: "catalogo_inventario" });
  const canEditar = can("inventario", "E", { objeto: "catalogo_inventario" });
  const canRellenar = can("inventario", "C", { objeto: "movimiento" });
  const canBaja = can("inventario", "AN");
  const canReactivar = can("inventario", "G");

  const groups: FilterGroup[] = [
    {
      key: "existencia",
      label: "Existencia",
      value: filter,
      defaultValue: "todos",
      onChange: (v) => setFilter(v as Filter),
      options: [
        { value: "todos", label: "Todos" },
        { value: "bajo", label: "Existencia baja o vacía" },
        { value: "vencer", label: "Por vencer o vencidos" },
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
        { value: "caducidad", label: "Caducidad más próxima" },
        { value: "existencia", label: "Existencia más baja" },
      ],
    },
  ];

  const reportar = useMenuReportar();
  const reponer = (item: ApiRecord) => refill.open({ type: "reactivo", id: Number(item.id), name: formatReactivoName(item), unit: getReactivoStockInfo(item).unit });
  // Desde la búsqueda ("reponer metanol"): ?reponer=<id> abre la reposición de ese registro.
  useAbrirDesdeUrl(items ? visible : null, (indice) => (canRellenar ? reponer(visible[indice]) : undefined), "reponer");
  const menuFor = (item: ApiRecord): MenuItem[] => {
    const inactive = Number(item.activo ?? 1) === 0;
    const list: MenuItem[] = [];
    if (canRellenar && !inactive) list.push({ label: "Registrar movimiento", description: "Entrada, salida, consumo o ajuste por conteo", icon: <ArrowsClockwise size={16} weight="duotone" />, tone: "success", onSelect: () => reponer(item) });
    if (canEditar) list.push({ label: "Editar", description: "Cambiar datos del reactivo", icon: <PencilSimple size={16} weight="duotone" />, onSelect: () => editReactivo(Number(item.id)) });
    list.push(...reportar("reactivos", item.id, formatReactivoName(item)));
    if (inactive ? canReactivar : canBaja) {
      if (inactive) list.push({ label: "Reactivar…", description: "Vuelve al inventario con motivo", icon: <ArrowCounterClockwise size={16} weight="duotone" />, tone: "warning", separatorBefore: true, onSelect: () => reactivarReactivo(item) });
      else list.push({ label: "Dar de baja…", description: "Deja de ofrecerse; conserva su historial", icon: <Trash size={16} weight="duotone" />, tone: "danger", separatorBefore: true, onSelect: () => deleteReactivo(item) });
    }
    return list;
  };

  return (
    <>
      <Toolbar
        end={
          <>
            {canCreate ? (
              <Button icon={<Plus size={16} weight="bold" />} onClick={() => modal.open(null)}>
                Nuevo reactivo
              </Button>
            ) : null}
          </>
        }
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nombre, lote, CAS o catálogo" className="min-w-0 flex-1 md:w-[340px] md:flex-none" />
        <FilterMenu groups={groups} toggles={toggles} gruposFinales={ordenar} vistaAlFinal />
      </Toolbar>

      <ListaCuadricula
        etiqueta="Reactivos"
        columnas={COLUMNAS}
        filas={items ? visible : null}
        error={resource.error}
        onReintentar={resource.reload}
        clave={(item) => String(item.id)}
        onAbrir={(_, i) => setAbierta(i)}
        activa={(_, i) => abierta === i}
        celdas={celdasReactivo}
        extremo={(item) => (
          <span className="w-9">
            <ActionMenu items={menuFor(item)} header={formatReactivoName(item)} />
          </span>
        )}
        anchoExtremo="52px"
        propsFila={(item) => ({ "data-reactivo": String(item.id) })}
        vacio={{
          icono: <Flask size={20} />,
          titulo: search || filter !== "todos" ? "Sin coincidencias" : "Aún no hay reactivos",
          descripcion: search || filter !== "todos" ? "Prueba con otro término o cambia el filtro." : "Crea el primero con «Nuevo reactivo».",
          accion: canCreate && !search && filter === "todos" ? <Button onClick={() => modal.open(null)}>Nuevo reactivo</Button> : undefined,
        }}
      />
      {items && visible.length ? <p className="tnum mt-2 px-1 text-xs text-ink-3">{visible.length === 1 ? "1 reactivo" : `${fmt(visible.length)} reactivos`}</p> : null}

      <InsumoVentana
        tipo="reactivo"
        items={visible}
        indice={abierta !== null && abierta < visible.length ? abierta : null}
        onIndice={setAbierta}
        onCerrar={() => setAbierta(null)}
        acciones={{ puedeReponer: canRellenar, puedeEditar: canEditar, puedeBaja: canBaja, puedeReactivar: canReactivar, reponer, editar: (item) => editReactivo(Number(item.id)), darDeBaja: deleteReactivo, reactivar: reactivarReactivo }}
      />

      {modal.key ? <ReactivoSheet key={`modal-${modal.key}`} open={modal.isOpen} item={modal.payload} onClose={modal.close} /> : null}
      {refill.key ? <StockRefillSheet key={`refill-${refill.key}`} open={refill.isOpen} target={refill.payload} onClose={refill.close} /> : null}
    </>
  );
}
