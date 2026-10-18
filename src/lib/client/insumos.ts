import { API_BASE_URL, getJsonAuth } from "./api";
import { getStoredToken } from "./session";
import type { ApiRecord } from "./types";
import { diasEntre, fechaSola, formatearFecha, hoyLocal } from "../shared/fechas";

/*
 * Cache de insumos (reactivos, consumibles y equipos) para los buscadores de
 * los formularios de procesamiento y extraccion. Se carga una sola vez por
 * sesion de pagina, igual que en el app.js de la interfaz original.
 */

export interface InsumoOption {
  ref: string;
  label: string;
  cantidad_actual?: number | null;
  existencia?: number | null;
  unidad?: string;
  /* Solo reactivos: lote (se sugiere como folio de preparación de soluciones). */
  lote?: string | null;
  /* Solo equipos: nombre del catalogo, estado, calibracion y clave de bitacora. */
  nombre?: string;
  estado?: string;
  fecha_prox_calibracion?: string | null;
  clave_bitacora?: string | null;
  /* Ultimo folio anotado en la bitacora del equipo (el formato sugiere el siguiente). */
  ultimo_folio_bitacora?: string | null;
}

/* Siguiente folio de bitacora sugerido para un equipo: el ultimo + 1 cuando es numerico. */
export const nextBitacoraFolio = (option: InsumoOption | null | undefined): string => {
  const last = String(option?.ultimo_folio_bitacora || "").trim();
  return /^\d+$/.test(last) ? String(Number(last) + 1) : "";
};

export interface EquipoAlert {
  level: "info" | "warning" | "danger";
  message: string;
  /* true: el formato pide confirmacion explicita antes de guardar con este equipo. */
  requiresConfirm: boolean;
}

let reactivosCache: InsumoOption[] | null = null;
let consumiblesCache: InsumoOption[] | null = null;
let equiposCache: InsumoOption[] | null = null;
let loadingPromise: Promise<void> | null = null;

export const isInsumoCacheLoaded = (): boolean => reactivosCache !== null;

export const loadInsumoOptions = (): Promise<void> => {
  if (reactivosCache !== null) return Promise.resolve();
  if (loadingPromise) return loadingPromise;
  const token = getStoredToken();
  if (!token) return Promise.resolve();
  loadingPromise = Promise.all([
    getJsonAuth(`${API_BASE_URL}/inventory/reactivos?search=`, token).catch(() => ({}) as ApiRecord),
    getJsonAuth(`${API_BASE_URL}/consumables/?search=`, token).catch(() => ({}) as ApiRecord),
    getJsonAuth(`${API_BASE_URL}/inventory/equipos?search=`, token).catch(() => ({}) as ApiRecord),
  ])
    .then(([rData, cData, eData]) => {
      reactivosCache = ((rData.items || []) as ApiRecord[]).map((r) => ({
        ref: String(r.id),
        label: [r.producto, r.catalogo].filter(Boolean).join(" · ") || String(r.id),
        cantidad_actual: r.cantidad_actual ?? null,
        unidad: r.unidad || "",
        lote: (r.lote || r.lot_number || null) as string | null,
      }));
      consumiblesCache = ((Array.isArray(cData) ? cData : cData.items || []) as ApiRecord[]).map((c) => ({
        ref: String(c.id),
        existencia: c.existencia ?? null,
        unidad: "unidades",
        label: [c.producto, c.catalogo_parte_cas].filter(Boolean).join(" · ") || String(c.id),
      }));
      // Los equipos se referencian por id (los registros viejos guardaban el nombre; ver findInsumoOption).
      equiposCache = ((eData.items || []) as ApiRecord[]).map((e) => ({
        ref: String(e.id),
        nombre: e.nombre || String(e.id),
        label: [e.nombre, e.marca, e.modelo].filter(Boolean).join(" · ") || String(e.id),
        estado: e.estado || "",
        fecha_prox_calibracion: e.fecha_prox_calibracion || null,
        clave_bitacora: e.clave_bitacora || null,
        ultimo_folio_bitacora: (e.ultimo_folio_bitacora || null) as string | null,
      }));
      loadingPromise = null;
    })
    .catch(() => {
      loadingPromise = null;
    });
  return loadingPromise;
};

export const getInsumoOptions = (tipo: string): InsumoOption[] => {
  if (tipo === "reactivo") return reactivosCache || [];
  if (tipo === "equipo") return equiposCache || [];
  return consumiblesCache || [];
};

export const findInsumoOption = (tipo: string, ref: unknown): InsumoOption | null => {
  const value = String(ref || "").trim();
  if (!value) return null;
  const options = getInsumoOptions(tipo);
  const direct = options.find((item) => String(item.ref) === value || item.label === value);
  if (direct) return direct;
  // Compatibilidad: las extracciones anteriores guardaban el nombre del equipo, no su id.
  if (tipo === "equipo") return options.find((item) => item.nombre === value) || null;
  return null;
};

export const findReactivoByRef = (ref: string): InsumoOption | null => {
  return (reactivosCache || []).find((r) => r.ref === ref) || null;
};


/*
 * Aviso sobre un equipo al momento de usarlo en un formato: estado no
 * operativo o calibracion vencida (o por vencer en 30 dias). El formato
 * muestra el aviso y, si requiere confirmacion, la pide antes de guardar.
 */
export const equipoAlert = (option: InsumoOption | null | undefined, today: string = hoyLocal()): EquipoAlert | null => {
  if (!option) return null;
  const estado = String(option.estado || "").toLowerCase();
  if (estado === "fuera_servicio") return { level: "danger", message: "Fuera de servicio", requiresConfirm: true };
  if (estado === "mantenimiento") return { level: "warning", message: "En mantenimiento", requiresConfirm: true };
  if (estado === "calibracion_pendiente") return { level: "warning", message: "Calibración pendiente", requiresConfirm: true };
  const due = fechaSola(option.fecha_prox_calibracion);
  const days = due ? diasEntre(today, due) : null;
  if (days === null) return null;
  if (days < 0) return { level: "danger", message: `Calibración vencida desde el ${formatearFecha(due)}`, requiresConfirm: true };
  if (days <= 30) return { level: "info", message: `Calibración vence el ${formatearFecha(due)}`, requiresConfirm: false };
  return null;
};

const normalizeInsumoText = (value: unknown): string =>
  String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const findInsumoByAutoQuery = (tipo: string, query: unknown): InsumoOption | null => {
  const tokens = normalizeInsumoText(query).split(" ").filter(Boolean);
  if (!tokens.length) return null;
  const indexed = getInsumoOptions(tipo).map((item) => ({ item, text: normalizeInsumoText(item.label) }));
  const exact = indexed.filter(({ text }) => tokens.every((token) => text.includes(token)));
  if (exact.length) return exact[0].item;
  const alphaTokens = tokens.filter((token) => !/^\d+$/.test(token));
  const numericTokens = tokens.filter((token) => /^\d+$/.test(token));
  // Sin coincidencia exacta se busca solo por palabras, pero se descartan los
  // candidatos que traen otros numeros (p. ej. "metanol 100" no debe tomar "metanol agua 50 50").
  const candidates = indexed
    .filter(({ text }) => alphaTokens.every((token) => text.includes(token)))
    .filter(({ text }) => !numericTokens.length || (text.match(/\d+/g) || []).every((num) => numericTokens.includes(num)))
    .map(({ item, text }) => ({
      item,
      score: tokens.reduce((total, token) => total + (text.includes(token) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.item || null;
};

export const normalizeInventoryUnit = (unit: unknown): string => {
  const value = String(unit || "").trim().toLowerCase();
  if (!value) return "";
  if (["l", "lt", "ltr", "litro", "litros"].includes(value)) return "litros";
  if (["ml", "mililitro", "mililitros"].includes(value)) return "ml";
  return value;
};

export const formatInventoryAmount = (value: unknown): string => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return numeric.toLocaleString("es-MX", { maximumFractionDigits: 4 });
};

export interface FixedInsumoSpec {
  cantidadFija?: string | number | null;
  cantidadUnidad?: string | null;
}

export interface ResolvedFixedAmount {
  amount: number;
  protocolAmount: number;
  protocolUnit: string;
  stockUnit: string;
}

export const resolveFixedInventoryAmount = (spec: FixedInsumoSpec | null | undefined, item: InsumoOption | null = null): ResolvedFixedAmount | null => {
  const protocolAmount = Number.parseFloat(String(spec?.cantidadFija ?? ""));
  if (!protocolAmount) {
    return null;
  }
  const protocolUnit = normalizeInventoryUnit(spec?.cantidadUnidad);
  const stockUnit = normalizeInventoryUnit(item?.unidad);

  let amount = protocolAmount;
  if (protocolUnit && stockUnit && protocolUnit !== stockUnit) {
    if (protocolUnit === "ml" && stockUnit === "litros") {
      amount = protocolAmount / 1000;
    } else if (protocolUnit === "litros" && stockUnit === "ml") {
      amount = protocolAmount * 1000;
    }
  }

  return {
    amount,
    protocolAmount,
    protocolUnit,
    stockUnit: stockUnit || item?.unidad || "",
  };
};

export interface InventarioRow {
  key: number;
  tipo: string;
  ref: string;
  nombre?: string;
  cantidad: number;
}

/*
 * Separa las filas manuales de las que genera el protocolo al reabrir un
 * registro. Las filas llevan `origen` ("protocolo" se recalcula y se
 * descarta; "manual" se conserva siempre). Las filas sin origen (registros
 * anteriores a esta marca) se casan por tipo y referencia, sin depender de
 * la cantidad, porque esta se recalcula al reabrir.
 */
export const filterManualInventario = (rows: ApiRecord[], protocolRows: Array<{ tipo: string; ref: string; cantidad: number }>): ApiRecord[] => {
  const protocolCounts = new Map<string, number>();
  protocolRows.forEach((row) => {
    const key = `${row.tipo}|${row.ref}`;
    protocolCounts.set(key, (protocolCounts.get(key) || 0) + 1);
  });
  return (rows || []).filter((row) => {
    if (row.origen === "protocolo") return false;
    if (row.origen === "manual") return true;
    const key = `${row.tipo || "consumible"}|${row.ref || row.nombre || ""}`;
    const count = protocolCounts.get(key) || 0;
    if (count <= 0) return true;
    protocolCounts.set(key, count - 1);
    return false;
  });
};

/*
 * Equipo operativo unico que corresponde a una descripcion ("Balanza",
 * "Centrifuga"): si hay exactamente uno en servicio, se puede prellenar.
 */
export const findUniqueOperativeEquipo = (query: unknown): InsumoOption | null => {
  const tokens = normalizeInsumoText(query).split(" ").filter(Boolean);
  if (!tokens.length) return null;
  // Solo equipos operativos y con calibración vigente: nunca se sugiere uno que dispararía un aviso.
  const todayIso = hoyLocal();
  const matches = getInsumoOptions("equipo").filter((item) => {
    const text = normalizeInsumoText(item.label);
    const vigente = !item.fecha_prox_calibracion || String(item.fecha_prox_calibracion).slice(0, 10) >= todayIso;
    return item.estado === "operativo" && vigente && tokens.every((token) => text.includes(token));
  });
  return matches.length === 1 ? matches[0] : null;
};
