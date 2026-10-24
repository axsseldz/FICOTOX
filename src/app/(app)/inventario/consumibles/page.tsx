"use client";

import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowCounterClockwise, ArrowsClockwise, Package, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { useMenuReportar } from "@/components/features/calidad/ReportarIncidencia";
import { IconoConsumible } from "@/components/features/inventory/ventanas/comun";
import { formatearFechaCorta } from "@/lib/shared/fechas";
import { InsumoVentana } from "@/components/features/inventory/ventanas/InsumoVentana";
import { ConsumibleSheet } from "@/components/features/inventory/ConsumibleSheet";
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
import { fmt, parseNumberOrNull } from "@/lib/client/format";
import { useDebouncedValue, useInitialParam, useOpenState, useParamChange, useUrlTrigger, useAbrirDesdeUrl } from "@/lib/client/hooks";
import { invalidate, useResource } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";

/* Columnas fijas: producto y marca, ubicacion, fecha de ingreso y existencia en unidades con barra (los consumibles no llevan caducidad). */
const COLUMNAS: ColumnaLista[] = [
  { clave: "producto", titulo: "Producto", ancho: "minmax(260px,1.7fr)" },
  { clave: "ubicacion", titulo: "Ubicación", ancho: "minmax(140px,0.8fr)" },
  { clave: "ingreso", titulo: "Ingreso", ancho: "150px" },
  { clave: "existencia", titulo: "Existencia", ancho: "minmax(180px,1fr)" },
];

function celdasConsumible(item: ApiRecord) {
  const pieces = parseNumberOrNull(item.existencia) ?? 0;
  const max = parseNumberOrNull(item.stock_maximo) || pieces;
  const inactive = Number(item.activo ?? 1) === 0;
  const ubicacion = item.localizacion || item.ubicacion;
  const minimo = parseNumberOrNull(item.stock_minimo) || 5;
  return [
    <span key="p" className={inactive ? "flex min-w-0 items-center gap-3 opacity-60" : "flex min-w-0 items-center gap-3"}>
      <IconoConsumible producto={item.producto} />
      <span className="flex min-w-0 flex-col">
        <span className="text-base leading-tight font-semibold text-ink">
          {String(item.producto || "—")}
          {inactive ? <Badge tone="danger" className="ml-2 align-middle">Baja</Badge> : null}
        </span>
        <span className="text-xs text-ink-3">{[item.marca, item.tamano_capacidad || item.contenedor].filter(Boolean).join(" · ") || "Sin marca"}</span>
      </span>
    </span>,
    <span key="u" className="text-sm text-ink-2">{ubicacion ? String(ubicacion) : <span className="text-ink-4">—</span>}</span>,
    <span key="c" className="text-sm text-ink-2">{item.fecha_ingreso ? formatearFechaCorta(item.fecha_ingreso) : <span className="text-ink-4">—</span>}</span>,
    <StockMeter key="e" current={pieces} max={max} min={minimo} unit="unidades" low={pieces <= minimo} />,
  ];
}

export default function ConsumiblesPage() {
  return (
    <RequireModule modules="inventario">
      <Suspense fallback={<TableSkeleton />}>
        <ConsumiblesContent />
      </Suspense>
    </RequireModule>
  );
}

type Filter = "todos" | "bajo" | "agotado";
type Orden = "nombre" | "existencia";

const piecesOf = (item: ApiRecord) => Number(item.existencia || 0);

function ConsumiblesContent() {
  const { token, can } = useSession();
  const prompt = usePrompt();
  const [search, setSearch] = useState(useInitialParam("buscar"));
  const initialFilter = useInitialParam("filtro");
  const [filter, setFilter] = useState<Filter>(initialFilter === "bajo" || initialFilter === "agotado" ? initialFilter : "todos");
  const debounced = useDebouncedValue(search);
  const [showBajas, setShowBajas] = useState(initialFilter === "bajas");
  const modal = useOpenState<ApiRecord>();
  const refill = useOpenState<StockRefillTarget>();
  const [abierta, setAbierta] = useState<number | null>(null);
  const [orden, setOrden] = useState<Orden>("nombre");

  useParamChange("buscar", (value) => setSearch(value));
  useParamChange("filtro", (value) => {
    setFilter(value === "bajo" || value === "agotado" ? value : "todos");
    setShowBajas(value === "bajas");
  });

  const resource = useResource<ApiRecord[]>(
    "consumibles",
    async () => {
      const data = await getJsonAuth(`${API_BASE_URL}/consumables?search=${encodeURIComponent(debounced.trim())}${showBajas ? "&bajas=1" : ""}`, token);
      return (Array.isArray(data) ? data : data.items || []) as ApiRecord[];
    },
    { enabled: !!token, deps: [debounced, showBajas] },
  );
  const items = resource.data;

  useUrlTrigger("nuevo", () => {
    if (can("inventario", "C", { objeto: "catalogo_inventario" })) modal.open(null);
  });

  const visible = useMemo(() => {
    let list = items || [];
    if (filter === "bajo") list = list.filter((item) => piecesOf(item) <= (parseNumberOrNull(item.stock_minimo) || 5));
    if (filter === "agotado") list = list.filter((item) => piecesOf(item) <= 0);
    if (orden === "existencia") return [...list].sort((a, b) => piecesOf(a) - piecesOf(b));
    return [...list].sort((a, b) => String(a.producto || "").localeCompare(String(b.producto || ""), "es"));
  }, [items, filter, orden]);
  useAbrirDesdeUrl(items ? visible : null, setAbierta);

  const editConsumable = async (id: number) => {
    try {
      const data = await getJsonAuth(`${API_BASE_URL}/consumables/${id}`, token);
      modal.open(resolveApiEntity(data));
    } catch {
      const fallback = (items || []).find((row) => Number(row.id) === id);
      if (fallback) modal.open(fallback);
      else toast.error("No se pudo cargar el consumible");
    }
  };

  // Baja logica con motivo: el consumible deja de ofrecerse, sus movimientos se conservan.
  const deleteConsumable = async (item: ApiRecord) => {
    const motivo = await prompt({ critico: true, title: `Dar de baja "${item.producto}"`, description: "El consumible deja de aparecer en el inventario y en los formatos; sus movimientos y registros se conservan.", confirmLabel: "Dar de baja", tone: "danger" });
    if (!motivo) return;
    try {
      await sendJsonAuth("DELETE", `${API_BASE_URL}/consumables/${item.id}`, token, { motivo });
      toast.success("Consumible dado de baja");
      invalidate("consumibles", "dashboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo dar de baja");
    }
  };

  const reactivarConsumable = async (item: ApiRecord) => {
    const motivo = await prompt({ critico: true, title: `Reactivar "${item.producto}"`, confirmLabel: "Reactivar" });
    if (!motivo) return;
    try {
      await sendJsonAuth("POST", `${API_BASE_URL}/consumables/${item.id}/reactivar`, token, { motivo });
      toast.success("Consumible reactivado");
      invalidate("consumibles", "dashboard");
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
        { value: "bajo", label: "Stock bajo" },
        { value: "agotado", label: "Agotados" },
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
        { value: "existencia", label: "Menos unidades primero" },
      ],
    },
  ];

  const reportar = useMenuReportar();
  const reponer = (item: ApiRecord) => refill.open({ type: "consumible", id: Number(item.id), name: String(item.producto || "Consumible") });
  // Desde la búsqueda ("reponer metanol"): ?reponer=<id> abre la reposición de ese registro.
  useAbrirDesdeUrl(items ? visible : null, (indice) => (canRellenar ? reponer(visible[indice]) : undefined), "reponer");
  const menuFor = (item: ApiRecord): MenuItem[] => {
    const inactive = Number(item.activo ?? 1) === 0;
    const list: MenuItem[] = [];
    if (canRellenar && !inactive) list.push({ label: "Registrar movimiento", description: "Entrada, salida, consumo o ajuste por conteo", icon: <ArrowsClockwise size={16} weight="duotone" />, tone: "success", onSelect: () => reponer(item) });
    if (canEditar) list.push({ label: "Editar", description: "Cambiar datos del consumible", icon: <PencilSimple size={16} weight="duotone" />, onSelect: () => editConsumable(Number(item.id)) });
    list.push(...reportar("consumibles", item.id, String(item.producto || "Consumible")));
    if (inactive ? canReactivar : canBaja) {
      if (inactive) list.push({ label: "Reactivar…", description: "Vuelve al inventario con motivo", icon: <ArrowCounterClockwise size={16} weight="duotone" />, tone: "warning", separatorBefore: true, onSelect: () => reactivarConsumable(item) });
      else list.push({ label: "Dar de baja…", description: "Deja de ofrecerse; conserva su historial", icon: <Trash size={16} weight="duotone" />, tone: "danger", separatorBefore: true, onSelect: () => deleteConsumable(item) });
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
                Nuevo consumible
              </Button>
            ) : null}
          </>
        }
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nombre o marca" className="min-w-0 flex-1 md:w-[340px] md:flex-none" />
        <FilterMenu groups={groups} toggles={toggles} gruposFinales={ordenar} vistaAlFinal />
      </Toolbar>

      <ListaCuadricula
        etiqueta="Consumibles"
        columnas={COLUMNAS}
        filas={items ? visible : null}
        error={resource.error}
        onReintentar={resource.reload}
        clave={(item) => String(item.id)}
        onAbrir={(_, i) => setAbierta(i)}
        activa={(_, i) => abierta === i}
        celdas={celdasConsumible}
        extremo={(item) => (
          <span className="w-9">
            <ActionMenu items={menuFor(item)} header={String(item.producto || "")} />
          </span>
        )}
        anchoExtremo="52px"
        propsFila={(item) => ({ "data-consumible": String(item.id) })}
        vacio={{
          icono: <Package size={20} />,
          titulo: search || filter !== "todos" ? "Sin coincidencias" : "Aún no hay consumibles",
          descripcion: search || filter !== "todos" ? "Prueba con otro término o cambia el filtro." : "Crea el primero con «Nuevo consumible».",
          accion: canCreate && !search && filter === "todos" ? <Button onClick={() => modal.open(null)}>Nuevo consumible</Button> : undefined,
        }}
      />
      {items && visible.length ? <p className="tnum mt-2 px-1 text-xs text-ink-3">{visible.length === 1 ? "1 consumible" : `${fmt(visible.length)} consumibles`}</p> : null}

      <InsumoVentana
        tipo="consumible"
        items={visible}
        indice={abierta !== null && abierta < visible.length ? abierta : null}
        onIndice={setAbierta}
        onCerrar={() => setAbierta(null)}
        acciones={{ puedeReponer: canRellenar, puedeEditar: canEditar, puedeBaja: canBaja, puedeReactivar: canReactivar, reponer, editar: (item) => editConsumable(Number(item.id)), darDeBaja: deleteConsumable, reactivar: reactivarConsumable }}
      />

      {modal.key ? <ConsumibleSheet key={`modal-${modal.key}`} open={modal.isOpen} item={modal.payload} onClose={modal.close} /> : null}
      {refill.key ? <StockRefillSheet key={`refill-${refill.key}`} open={refill.isOpen} target={refill.payload} onClose={refill.close} /> : null}
    </>
  );
}
