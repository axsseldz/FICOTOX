/* Conversiones equivalentes a los helpers _to_*_or_none de Python. */

export function isTruthy(value: unknown): boolean {
  // Semantica de verdad de Python: None, 0, 0.0, "", False, [] y {} son falsos.
  if (value === null || value === undefined || value === false || value === 0 || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

export function firstTruthy<T>(...values: T[]): T | null {
  for (const value of values) {
    if (isTruthy(value)) return value;
  }
  const last = values[values.length - 1];
  return last === undefined ? null : last;
}

/* float(value) o None */
export function toFloatOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/* int(value) o None */
export function toIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) return null;
    return Number.parseInt(trimmed, 10);
  }
  return null;
}

/* str(value).strip() recortado, o None */
export function toStrOrNull(value: unknown, maxLength?: number): string | null {
  if (value === null || value === undefined) return null;
  const text = pyStr(value).trim();
  if (!text) return null;
  return maxLength ? text.slice(0, maxLength) : text;
}

/* str(value) con la representacion de Python para flotantes enteros (3.0 -> "3.0"). */
function pyStr(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value);
}

/* (value or "").strip()[:n] or None */
export function strippedOrNull(value: unknown, maxLength?: number): string | null {
  const text = String(value || "").trim();
  const sliced = maxLength ? text.slice(0, maxLength) : text;
  return sliced || null;
}

/* datetime.utcnow().strftime('%Y%m%d%H%M%S%f') */
export function utcTimestampReference(): string {
  const now = new Date();
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}` +
    `${pad(now.getUTCMilliseconds() * 1000, 6)}`
  );
}

export function jsonText(value: unknown): string {
  return JSON.stringify(value === null || value === undefined ? {} : value);
}

export function safeJsonLoad<T>(value: unknown, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

export function searchParam(request: Request, name: string): string {
  return (new URL(request.url).searchParams.get(name) || "").trim();
}
