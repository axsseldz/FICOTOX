"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle, Info, MagnifyingGlass, MinusCircle, Warning, X, XCircle } from "@phosphor-icons/react";
import { cn } from "@/components/ui/cn";
import { controlClass, controlClassSm } from "@/components/ui/Field";
import { IconButton } from "@/components/ui/Button";
import { equipoAlert, findInsumoOption, findReactivoByRef, formatInventoryAmount, getInsumoOptions, isInsumoCacheLoaded, loadInsumoOptions, normalizeInventoryUnit, resolveFixedInventoryAmount, type InventarioRow } from "@/lib/client/insumos";

export interface InsumoSearchProps {
  tipo: string;
  value: string;
  onChange: (ref: string, label: string) => void;
  placeholder?: string;
  cantidadFija?: string | number | null;
  cantidadUnidad?: string | null;
  /* Explicacion de como se calculo la cantidad (ej. "9 mL × 6 tubos"). */
  cantidadNota?: string;
  stepEnabled?: boolean;
  showStockBadge?: boolean;
  size?: "sm" | "md";
  className?: string;
}

const ALERT_TONE = {
  info: "text-ink-3",
  warning: "text-warning-text",
  danger: "text-danger font-medium",
} as const;

/*
 * Buscador de insumos (reactivos, consumibles o equipos) con lista
 * desplegable. Para reactivos de cantidad fija muestra el aviso de stock;
 * para equipos, el aviso de estado o calibracion vencida.
 */
export function InsumoSearch({ tipo, value, onChange, placeholder = "Buscar insumo", cantidadFija, cantidadUnidad, cantidadNota, stepEnabled = true, showStockBadge = false, size = "md", className }: InsumoSearchProps) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [, setTick] = useState(0);
  const [active, setActive] = useState(0);
  const lastValue = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
    if (lastValue.current === value) return;
    lastValue.current = value;
    const option = findInsumoOption(tipo, value);
    setSearch(option?.label || value || "");
  }, [value, tipo]);

  // Si el catálogo llega después de que el registro ya mostró su referencia (un id), se sustituye por el nombre.
  useEffect(() => {
    void loadInsumoOptions().then(() => {
      const option = findInsumoOption(tipo, valueRef.current);
      if (option) setSearch((current) => (current === String(valueRef.current || "") ? option.label : current));
      setTick((t) => t + 1);
    });
  }, [tipo]);

  const options = getInsumoOptions(tipo);
  const q = search.trim().toLowerCase();
  const shown = (q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options).slice(0, 60);
  const selected = findInsumoOption(tipo, value);

  const choose = (ref: string, label: string) => {
    lastValue.current = ref;
    setSearch(label);
    setOpen(false);
    onChange(ref, label);
  };

  const base = "mt-1.5 flex items-start gap-1.5 text-[12px] leading-snug";

  const equipoBadge = () => {
    if (tipo !== "equipo" || !selected) return null;
    const alert = equipoAlert(selected);
    if (!alert) return null;
    const Icon = alert.level === "info" ? Info : alert.level === "warning" ? Warning : XCircle;
    return (
      <p className={cn(base, ALERT_TONE[alert.level])} role={alert.requiresConfirm ? "alert" : undefined}>
        <Icon size={14} weight={alert.level === "danger" ? "fill" : "regular"} className="mt-0.5 shrink-0" /> {alert.message}
        {alert.requiresConfirm ? " · se pedirá confirmación al guardar" : ""}
      </p>
    );
  };

  const stockBadge = () => {
    if (!showStockBadge || tipo !== "reactivo" || !cantidadFija || !stepEnabled) return null;
    const ref = String(value || "").trim();
    if (!ref) {
      return (
        <p className={cn(base, "text-warning-text")}>
          <Warning size={14} className="mt-0.5 shrink-0" /> No se encontró en inventario para descuento automático
        </p>
      );
    }
    const item = findReactivoByRef(ref);
    if (!item) {
      return (
        <p className={cn(base, "text-warning-text")}>
          <Warning size={14} className="mt-0.5 shrink-0" /> No encontrado en inventario
        </p>
      );
    }
    const resolved = resolveFixedInventoryAmount({ cantidadFija, cantidadUnidad }, item);
    if (!resolved) return null;
    const stock = item.cantidad_actual ?? null;
    const u = item.unidad || "";
    if (stock === null) {
      return (
        <p className={cn(base, "text-ink-3")}>
          <MinusCircle size={14} className="mt-0.5 shrink-0" /> Stock no registrado
        </p>
      );
    }
    const protocol = resolved.protocolUnit && resolved.protocolUnit !== normalizeInventoryUnit(u) ? ` (${formatInventoryAmount(resolved.protocolAmount)} ${resolved.protocolUnit})` : "";
    const nota = cantidadNota ? ` · ${cantidadNota}` : "";
    if (Number(stock) >= resolved.amount) {
      return (
        <p className={cn(base, "text-success-text")}>
          <CheckCircle size={14} weight="fill" className="mt-0.5 shrink-0" /> Se descontarán {formatInventoryAmount(resolved.amount)} {u}
          {protocol}
          {nota}. Disponible: {formatInventoryAmount(stock)} {u}
        </p>
      );
    }
    return (
      <p className={cn(base, "font-medium text-danger")}>
        <XCircle size={14} weight="fill" className="mt-0.5 shrink-0" /> Stock insuficiente: {formatInventoryAmount(stock)} {u} disponibles, se requieren {formatInventoryAmount(resolved.amount)} {u}
        {protocol}
        {nota}
      </p>
    );
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((a) => Math.min(a + 1, shown.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (event.key === "Enter" && shown[active]) {
      event.preventDefault();
      choose(shown[active].ref, shown[active].label);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  const optionAside = (o: (typeof shown)[number]) => {
    if (tipo === "reactivo") return `${formatInventoryAmount(o.cantidad_actual ?? 0)} ${o.unidad || ""}`;
    if (tipo === "consumible") return `${formatInventoryAmount(o.existencia ?? 0)} unid.`;
    const alert = equipoAlert(o);
    return alert ? alert.message : "";
  };

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <MagnifyingGlass size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={placeholder}
          className={cn(size === "sm" ? controlClassSm : cn(controlClass, "h-9"), "pl-8 pr-8", selected && "border-brand/60 bg-brand-faint/40")}
          placeholder={placeholder}
          autoComplete="off"
          value={search}
          onFocus={() => {
            setOpen(true);
            setActive(0);
          }}
          onChange={(event) => {
            setSearch(event.target.value);
            setActive(0);
            if (value) {
              lastValue.current = "";
              onChange("", "");
            }
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        />
        {value ? (
          <span className="absolute top-1/2 right-1 -translate-y-1/2">
            <IconButton label="Quitar selección" size="sm" onClick={() => choose("", "")}>
              <X size={13} weight="bold" />
            </IconButton>
          </span>
        ) : null}
      </div>
      {open ? (
        <div ref={listRef} id={listId} role="listbox" className="scroll-thin absolute top-[calc(100%+4px)] left-0 z-[var(--z-popover)] max-h-[220px] w-full min-w-[260px] overflow-y-auto rounded-[8px] border border-line bg-popover p-1 shadow-pop">
          {!shown.length ? (
            <div className="px-2.5 py-2 text-[12.5px] text-ink-3">{!isInsumoCacheLoaded() ? "Cargando inventario…" : "Sin resultados"}</div>
          ) : (
            shown.map((o, index) => {
              const aside = optionAside(o);
              const alert = tipo === "equipo" ? equipoAlert(o) : null;
              return (
                <button
                  key={o.ref}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(o.ref, o.label)}
                  className={cn("flex w-full items-center justify-between gap-3 rounded-[6px] px-2.5 py-1.5 text-left text-[13px] text-ink", index === active && "bg-brand-faint")}
                >
                  <span className="truncate">{o.label}</span>
                  {aside ? <span className={cn("tnum shrink-0 text-[11.5px]", alert ? ALERT_TONE[alert.level] : "text-ink-3")}>{aside}</span> : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
      {tipo === "equipo" ? equipoBadge() : stockBadge()}
    </div>
  );
}

let nextKey = 1;
export const newInventarioRow = (tipo = "consumible", ref = "", cantidad = 1, nombre?: string): InventarioRow => ({ key: nextKey++, tipo, ref, cantidad, nombre });

/* Filas dinamicas de "insumos utilizados" con descuento de inventario. */
export function InventarioRows({ rows, onChange }: { rows: InventarioRow[]; onChange: (rows: InventarioRow[]) => void }) {
  const update = (key: number, patch: Partial<InventarioRow>) => onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  if (!rows.length) return <p className="rounded-[10px] border border-dashed border-line-strong px-4 py-4 text-center text-[13px] text-ink-3">Sin insumos adicionales. Agrega los que se usaron fuera del protocolo.</p>;
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        // En pantallas chicas el buscador ocupa toda la fila y tipo/cantidad/quitar bajan a una segunda línea.
        <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_96px_36px] items-start gap-2 sm:grid-cols-[130px_minmax(0,1fr)_110px_36px]">
          <select className={cn(controlClass, "h-9 appearance-none")} value={row.tipo} onChange={(event) => update(row.key, { tipo: event.target.value, ref: "", nombre: "" })} aria-label="Tipo de insumo">
            <option value="consumible">Consumible</option>
            <option value="reactivo">Reactivo</option>
          </select>
          <div className="col-span-3 sm:col-span-1 sm:order-none -order-1">
            <InsumoSearch key={`${row.key}-${row.tipo}`} tipo={row.tipo} value={row.ref} onChange={(ref, label) => update(row.key, { ref, nombre: label })} />
          </div>
          <input type="number" min="0.001" step="0.001" className={cn(controlClass, "h-9")} value={row.cantidad} onChange={(event) => update(row.key, { cantidad: Number.parseFloat(event.target.value) || 0 })} aria-label="Cantidad" />
          <IconButton label="Quitar insumo" tone="danger" onClick={() => onChange(rows.filter((r) => r.key !== row.key))}>
            <X size={15} weight="bold" />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

/* Filas agregadas a mano; se marcan como manuales para conservarlas al reabrir el registro. */
export const collectInventarioRows = (rows: InventarioRow[]) =>
  rows.map((row) => ({ tipo: row.tipo || "consumible", ref: (row.ref || row.nombre || "").trim(), cantidad: row.cantidad || 1, origen: "manual" as const })).filter((row) => row.ref !== "");
