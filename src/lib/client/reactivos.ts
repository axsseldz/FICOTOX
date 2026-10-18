import { REACTIVO_TYPES, type ReactivoTypeConfig } from "./constants";
import { parseNumberOrNull } from "./format";
import type { ApiRecord } from "./types";

/* Helpers de reactivos identicos a los de el app.js de la interfaz original. */

export const getReactivoTypeConfig = (type: unknown): ReactivoTypeConfig | null => REACTIVO_TYPES.find((item) => item.value === type) || null;

export const getReactivoTypeLabel = (type: unknown): string => getReactivoTypeConfig(type)?.label || (type as string) || "Sin tipo";

export const formatReactivoName = (item: ApiRecord): string => item.producto || item.item_name || item.nombre_crm || item.nombre || "-";

export const getReactivoExpiry = (item: ApiRecord): unknown => item.caducidad || item.expiration_date || item.fecha_vencimiento || null;

export const getReactivoLocation = (item: ApiRecord): string => [item.localizacion || item.ubicacion, item.sub_localizacion].filter(Boolean).join(" / ") || "-";

/*
 * Stock bajo, con la misma regla que el contador del servidor (`inventorySummary`):
 * vacío; por debajo del mínimo si hay mínimo; o ≤ 20 % del máximo si no lo hay.
 */
export const isReactivoLow = (item: ApiRecord): boolean => {
  const { current, max } = getReactivoStockInfo(item);
  const min = parseNumberOrNull(item.stock_minimo);
  if (current === null) return false;
  if (current <= 0) return true;
  if (min !== null && min > 0) return current <= min;
  return !!max && current / max <= 0.2;
};

export const getReactivoStockInfo = (item: ApiRecord): { current: number | null; max: number | null; unit: string } => {
  // `cantidad_actual` es la columna canónica (la que descuentan los formatos y edita la hoja);
  // el resto son columnas heredadas de las hojas de Excel.
  const fields: Array<[string, string]> = [
    ["cantidad_actual", item.unidad || ""],
    ["restante_190126", "L"],
    ["amount_in_stock", item.unidad || ""],
    ["total_litros_2025", "L"],
    ["capacidad_litros", "L"],
    ["capacidad_kilos", "kg"],
    ["volumen", "volumen"],
    ["piezas", "piezas"],
  ];
  const source = fields.find(([key]) => parseNumberOrNull(item[key]) !== null);
  const current = source ? parseNumberOrNull(item[source[0]]) : null;
  const unit = source ? source[1] : "";
  const max =
    parseNumberOrNull(item.stock_maximo) ??
    parseNumberOrNull(item.capacidad_litros) ??
    parseNumberOrNull(item.capacidad_kilos) ??
    parseNumberOrNull(item.cantidad_total) ??
    parseNumberOrNull(item.total_litros_2025) ??
    parseNumberOrNull(item.amount_in_stock) ??
    current;
  return { current, max, unit };
};

/* Todo lo que necesita el medidor de un reactivo, con la regla de "bajo" compartida. */
export const getReactivoStockState = (item: ApiRecord) => {
  const { current, max, unit } = getReactivoStockInfo(item);
  const min = parseNumberOrNull(item.stock_minimo);
  return { current, max, min: min && min > 0 ? min : null, unit, low: isReactivoLow(item), empty: current !== null && current <= 0 };
};
