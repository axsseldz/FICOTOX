"use client";

import { useMemo, useState } from "react";
import { ArrowsLeftRight } from "@phosphor-icons/react";
import { cantidadMovimiento, esEntrada, fechaDelMovimiento, IconoMovimientoInsumo, origenDeMovimiento, tipoMovimiento } from "@/components/features/inventory/ventanas/comun";
import { MovimientoVentana, nombreInsumo } from "@/components/features/inventory/ventanas/MantenimientoVentana";
import { PageBody } from "@/components/shell/AppShell";
import { RequireModule } from "@/components/session/RequireModule";
import { useSession } from "@/components/session/SessionProvider";
import { FilterMenu, type FilterGroup } from "@/components/ui/FilterMenu";
import { ListaCuadricula, type ColumnaLista } from "@/components/ui/ListaCuadricula";
import { PageHeader, SearchInput, Toolbar } from "@/components/ui/PageHeader";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { fmt, normalizeText } from "@/lib/client/format";
import { useResource } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { formatearFechaCorta, formatearFechaHora } from "@/lib/shared/fechas";
import { useInitialParam, useParamChange } from "@/lib/client/hooks";

/*
 * Movimientos: entradas y salidas de reactivos y consumibles. Lista en
 * cuadricula (icono de entrada o salida en color, insumo, cantidad, motivo,
 * origen y cuando) y, al pulsar un movimiento, su ventana con el registro de
 * origen enlazado. Todos los filtros y el orden dentro de "Filtros".
 */

type Origin = "todos" | "reactivos" | "consumibles";
type Tipo = "" | "entrada" | "salida" | "consumo" | "ajuste";
type Orden = "reciente" | "antiguo" | "cantidad";

const COLUMNAS: ColumnaLista[] = [
  { clave: "insumo", titulo: "Insumo", ancho: "minmax(240px,1.6fr)" },
  { clave: "cantidad", titulo: "Cantidad", ancho: "120px" },
  { clave: "motivo", titulo: "Motivo y origen", ancho: "minmax(200px,1.4fr)" },
  { clave: "cuando", titulo: "Fecha", ancho: "150px" },
];

export default function MovimientosPage() {
  return (
    <RequireModule modules="inventario">
      <MovimientosContent />
    </RequireModule>
  );
}

function MovimientosContent() {
  const { token } = useSession();
  const [origin, setOrigin] = useState<Origin>("todos");
  const [tipo, setTipo] = useState<Tipo>("");
  const [orden, setOrden] = useState<Orden>("reciente");
  const [search, setSearch] = useState(useInitialParam("buscar"));
  useParamChange("buscar", setSearch);
  const [abierta, setAbierta] = useState<number | null>(null);

  const resource = useResource<{ items: ApiRecord[]; summary: ApiRecord }>(
    "movimientos",
    async () => {
      const data = await getJsonAuth(`${API_BASE_URL}/inventory/movimientos`, token);
      return { items: (data.items || []) as ApiRecord[], summary: (data.summary || {}) as ApiRecord };
    },
    { enabled: !!token },
  );

  const rows = useMemo(() => {
    const list = resource.data?.items || [];
    const term = normalizeText(search);
    const filtrados = list.filter((item) => {
      if (origin !== "todos" && item.tabla_origen !== origin) return false;
      if (tipo && String(item.tipo || "").toLowerCase() !== tipo) return false;
      if (!term) return true;
      return normalizeText(`${nombreInsumo(item)} ${item.item_codigo || ""} ${item.referencia || ""} ${item.motivo || ""}`).includes(term);
    });
    if (orden === "antiguo") return [...filtrados].reverse();
    if (orden === "cantidad") return [...filtrados].sort((a, b) => cantidadMovimiento(b) - cantidadMovimiento(a));
    return filtrados;
  }, [resource.data, origin, tipo, orden, search]);

  const summary = resource.data?.summary || {};
  const groups: FilterGroup[] = [
    {
      key: "origen",
      label: "Insumo",
      value: origin,
      defaultValue: "todos",
      onChange: (v) => setOrigin(v as Origin),
      options: [
        { value: "todos", label: "Todos" },
        { value: "reactivos", label: "Reactivos" },
        { value: "consumibles", label: "Consumibles" },
      ],
    },
    {
      key: "tipo",
      label: "Tipo",
      value: tipo,
      defaultValue: "",
      onChange: (v) => setTipo(v as Tipo),
      options: [
        { value: "", label: "Todos" },
        { value: "entrada", label: "Entradas" },
        { value: "salida", label: "Salidas" },
        { value: "consumo", label: "Consumos" },
        { value: "ajuste", label: "Ajustes por conteo" },
      ],
    },
  ];
  const ordenar: FilterGroup[] = [
    {
      key: "orden",
      label: "Ordenar por",
      value: orden,
      defaultValue: "reciente",
      showDefault: true,
      onChange: (v) => setOrden(v as Orden),
      options: [
        { value: "reciente", label: "Más recientes" },
        { value: "antiguo", label: "Más antiguos" },
        { value: "cantidad", label: "Mayor cantidad" },
      ],
    },
  ];
  const filtrando = !!search || origin !== "todos" || !!tipo;

  const celdas = (item: ApiRecord) => {
    const origen = origenDeMovimiento(item);
    const entrada = esEntrada(item);
    return [
      <span key="i" className="flex min-w-0 items-center gap-3">
        <IconoMovimientoInsumo m={item} />
        <span className="flex min-w-0 flex-col">
          <span className="text-[14.5px] leading-tight font-semibold text-ink">{nombreInsumo(item)}</span>
          <span className="text-[12.5px] text-ink-3">
            {tipoMovimiento(item)} · {item.tabla_origen === "reactivos" ? "Reactivo" : item.tabla_origen === "consumibles" ? "Consumible" : "Insumo"}
          </span>
        </span>
      </span>,
      <span key="c" className={entrada ? "text-[14px] font-semibold text-success-text" : "text-[14px] font-semibold text-warning-text"}>
        {entrada ? "+" : "−"}
        {fmt(cantidadMovimiento(item))}
        {item.unidad ? <span className="ml-1 text-[12px] font-normal">{String(item.unidad)}</span> : null}
      </span>,
      <span key="m" className="text-[13.5px] text-ink-2">{origen.texto}</span>,
      <span key="w" className="flex flex-col text-[13px] text-ink-2" title={`Capturado: ${formatearFechaHora(item.fecha_hora)}`}>
        {formatearFechaCorta(fechaDelMovimiento(item).fecha)}
        {fechaDelMovimiento(item).distinta ? <span className="text-[11.5px] text-ink-3">Capturado el {formatearFechaCorta(fechaDelMovimiento(item).captura)}</span> : null}
      </span>,
    ];
  };

  return (
    <PageBody>
      <PageHeader title="Movimientos" description="Entradas, salidas, consumos y ajustes por conteo de reactivos y consumibles, incluidos los generados al procesar muestras." />

      <Toolbar
        end={
          resource.data ? (
            <p className="tnum text-[12.5px] text-ink-3">
              Hoy <span className="font-medium text-ink">{fmt(summary.hoy || 0)}</span> · Esta semana <span className="font-medium text-ink">{fmt(summary.semana || 0)}</span> · Este mes <span className="font-medium text-ink">{fmt(summary.mes || 0)}</span>
            </p>
          ) : null
        }
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por insumo, referencia o motivo" className="w-full md:w-[340px]" />
        <FilterMenu groups={groups} gruposFinales={ordenar} />
      </Toolbar>

      <ListaCuadricula
        etiqueta="Movimientos"
        columnas={COLUMNAS}
        filas={resource.data ? rows : null}
        error={resource.error}
        onReintentar={resource.reload}
        clave={(item) => String(item.id)}
        onAbrir={(_, i) => setAbierta(i)}
        activa={(_, i) => abierta === i}
        celdas={celdas}
        anchoExtremo="12px"
        propsFila={(item) => ({ "data-movimiento": String(item.id) })}
        vacio={{ icono: <ArrowsLeftRight size={20} />, titulo: "Sin movimientos", descripcion: filtrando ? "No hay movimientos con ese filtro." : "Aquí aparecerán las entradas, salidas, consumos y ajustes de inventario." }}
      />
      {resource.data && rows.length ? <p className="tnum mt-2 px-1 text-[12px] text-ink-3">{rows.length === 1 ? "1 movimiento" : `${fmt(rows.length)} movimientos`}</p> : null}

      <MovimientoVentana items={rows} indice={abierta !== null && abierta < rows.length ? abierta : null} onIndice={setAbierta} onCerrar={() => setAbierta(null)} />
    </PageBody>
  );
}
