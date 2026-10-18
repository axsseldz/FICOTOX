/*
 * Fechas (Fase 3). Unico lugar donde se formatean y calculan fechas.
 *
 * Regla: una fecha SIN hora ("AAAA-MM-DD": recepcion, emision, vigencias,
 * caducidades) es texto y se trata como texto; nunca pasa por `new Date`, que
 * la interpretaria como medianoche UTC y la mostraria un dia antes en Ensenada
 * (UTC-7/-8). Una fecha CON hora (ISO, TIMESTAMP de la base) es un instante y
 * se muestra siempre en la zona del laboratorio (America/Tijuana), sin importar
 * la zona del navegador ni la del servidor.
 */

const ZONA_LABORATORIO = "America/Tijuana";

const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const CON_FECHA = /^(\d{4})-(\d{2})-(\d{2})/;

type Partes = { anio: number; mes: number; dia: number; hora: number; minuto: number; segundo: number };

const formateadores = new Map<string, Intl.DateTimeFormat>();
function formateador(zona: string): Intl.DateTimeFormat {
  let f = formateadores.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    formateadores.set(zona, f);
  }
  return f;
}

/* Partes de un instante en la zona del laboratorio. */
function partesEnZona(instante: Date, zona = ZONA_LABORATORIO): Partes {
  const out: Record<string, number> = {};
  for (const p of formateador(zona).formatToParts(instante)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return { anio: out.year, mes: out.month, dia: out.day, hora: out.hour === 24 ? 0 : out.hour, minuto: out.minute, segundo: out.second };
}

const dos = (n: number) => String(n).padStart(2, "0");

/* ¿Es una fecha sin hora "AAAA-MM-DD"? */
export function esFechaSola(value: unknown): boolean {
  return typeof value === "string" && SOLO_FECHA.test(value.trim());
}

/*
 * Instante (Date) de un valor con hora: ISO con zona ("...Z", "+00:00") o
 * TIMESTAMP de la base sin zona ("AAAA-MM-DD HH:MM:SS"), que SQLite y MySQL
 * escriben en UTC (CURRENT_TIMESTAMP). Devuelve null si no es un instante.
 */
export function instanteDe(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") return Number.isFinite(value) ? new Date(value) : null;
  const text = String(value ?? "").trim();
  if (!text || esFechaSola(text)) return null;
  const sinZona = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text);
  const d = new Date(sinZona ? `${text.replace(" ", "T")}Z` : text);
  return Number.isNaN(d.getTime()) ? null : d;
}

/*
 * Dia local (AAAA-MM-DD, zona del laboratorio) de cualquier valor: una fecha
 * sola se devuelve tal cual; un instante se convierte a la zona. "" si no hay.
 */
export function fechaSola(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (esFechaSola(value)) return String(value).trim();
  const instante = instanteDe(value);
  if (!instante) {
    const m = CON_FECHA.exec(String(value));
    return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
  }
  const p = partesEnZona(instante);
  return `${p.anio}-${dos(p.mes)}-${dos(p.dia)}`;
}

/* Hoy en la zona del laboratorio (AAAA-MM-DD). */
export function hoyLocal(ahora: Date = new Date()): string {
  const p = partesEnZona(ahora);
  return `${p.anio}-${dos(p.mes)}-${dos(p.dia)}`;
}

/* dd/mm/aaaa. Una fecha sola se reescribe como texto; un instante, en la zona del laboratorio. */
export function formatearFecha(value: unknown, vacio = "—"): string {
  const sola = fechaSola(value);
  const m = SOLO_FECHA.exec(sola);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : vacio;
}

/* dd/mm/aaaa HH:mm en la zona del laboratorio (solo para valores con hora). */
export function formatearFechaHora(value: unknown, vacio = "—"): string {
  const instante = instanteDe(value);
  if (!instante) return formatearFecha(value, vacio);
  const p = partesEnZona(instante);
  return `${dos(p.dia)}/${dos(p.mes)}/${p.anio} ${dos(p.hora)}:${dos(p.minuto)}`;
}

/* Solo la hora HH:mm en la zona del laboratorio. */
export function formatearHora(value: unknown, vacio = "—"): string {
  const instante = instanteDe(value);
  if (!instante) return vacio;
  const p = partesEnZona(instante);
  return `${dos(p.hora)}:${dos(p.minuto)}`;
}

/* Fecha larga en espanol ("24 de septiembre de 2026") a partir de una fecha sola. */
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export function formatearFechaLarga(value: unknown, vacio = "—"): string {
  const m = SOLO_FECHA.exec(fechaSola(value));
  return m ? `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}` : vacio;
}

/* Fecha corta para tarjetas y listas ("25 sep 2026"), en la zona del laboratorio. */
export function formatearFechaCorta(value: unknown, vacio = "—"): string {
  const m = SOLO_FECHA.exec(fechaSola(value));
  return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1].slice(0, 3)} ${m[1]}` : vacio;
}

/* Nombre del dia de la semana de una fecha sola ("miércoles"); "" si no es fecha. */
const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export function diaSemana(value: unknown): string {
  const m = SOLO_FECHA.exec(fechaSola(value));
  return m ? DIAS_SEMANA[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()] : "";
}

/* Suma dias a una fecha sola (aritmetica de calendario, sin zona). */
export function sumarDias(fecha: string, dias: number): string {
  const m = SOLO_FECHA.exec(fechaSola(fecha));
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dias));
  return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`;
}

/* Suma meses o anios a una fecha sola (el dia se acota al fin de mes). */
export function sumarMeses(fecha: string, meses: number): string {
  const m = SOLO_FECHA.exec(fechaSola(fecha));
  if (!m) return "";
  const anio = Number(m[1]);
  const mes0 = Number(m[2]) - 1 + meses;
  const ultimo = new Date(Date.UTC(anio, mes0 + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(anio, mes0, Math.min(Number(m[3]), ultimo)));
  return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`;
}
/* Dias enteros de `desde` a `hasta` (fechas solas o instantes, por dia local). Positivo si hasta es despues. */
export function diasEntre(desde: unknown, hasta: unknown = hoyLocal()): number | null {
  const a = SOLO_FECHA.exec(fechaSola(desde));
  const b = SOLO_FECHA.exec(fechaSola(hasta));
  if (!a || !b) return null;
  return Math.round((Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3])) - Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]))) / 86_400_000);
}

/* Dias transcurridos desde una fecha hasta hoy (0 si es hoy o futura o invalida). */
export function diasDesde(value: unknown): number {
  const d = diasEntre(value);
  return d === null ? 0 : Math.max(0, d);
}

/*
 * Tono de una fecha limite (caducidad, calibracion, vigencia): "danger" si ya
 * paso (antes de hoy), "warning" si vence en los proximos `dias`.
 */
export function tonoVencimiento(value: unknown, dias = 30): "danger" | "warning" | null {
  const fecha = fechaSola(value);
  if (!SOLO_FECHA.test(fecha)) return null;
  const hoy = hoyLocal();
  if (fecha < hoy) return "danger";
  return fecha <= sumarDias(hoy, dias) ? "warning" : null;
}

/*
 * Limites en UTC (ISO) de un dia local de la zona del laboratorio, para
 * comparar contra columnas con hora guardadas en UTC (bitacora, solicitudes).
 */
function offsetMinutos(instante: Date, zona: string): number {
  const p = partesEnZona(instante, zona);
  const comoUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return Math.round((comoUtc - instante.getTime()) / 60_000);
}
function instanteLocal(fecha: string, hora: number, minuto: number, segundo: number, ms: number): Date {
  const m = SOLO_FECHA.exec(fecha)!;
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hora, minuto, segundo, ms);
  // Dos pasadas por si el instante cae en un cambio de horario.
  let d = new Date(base - offsetMinutos(new Date(base), ZONA_LABORATORIO) * 60_000);
  d = new Date(base - offsetMinutos(d, ZONA_LABORATORIO) * 60_000);
  return d;
}
export function inicioDiaLocal(fecha: string): string {
  const f = fechaSola(fecha);
  return SOLO_FECHA.test(f) ? instanteLocal(f, 0, 0, 0, 0).toISOString() : "";
}
export function finDiaLocal(fecha: string): string {
  const f = fechaSola(fecha);
  return SOLO_FECHA.test(f) ? instanteLocal(f, 23, 59, 59, 999).toISOString() : "";
}

/* Fase 11: fecha y hora capturadas en la zona del laboratorio ("AAAA-MM-DD", "HH:MM") -> ISO UTC ("" si no son validas). */
export function instanteDeFechaHoraLocal(fecha: string, hora: string): string {
  const f = fechaSola(fecha);
  const h = /^(\d{1,2}):(\d{2})$/.exec(String(hora || "").trim());
  if (!SOLO_FECHA.test(f) || !h || Number(h[1]) > 23 || Number(h[2]) > 59) return "";
  return instanteLocal(f, Number(h[1]), Number(h[2]), 0, 0).toISOString();
}

/* Hora local actual "HH:MM" en la zona del laboratorio. */
export function horaLocal(ahora: Date = new Date()): string {
  const p = partesEnZona(ahora);
  return `${dos(p.hora)}:${dos(p.minuto)}`;
}

/*
 * Texto dd/mm/aaaa escrito por la persona -> "AAAA-MM-DD" (o "" si no es una
 * fecha valida). Acepta separadores / - . y anio de 4 cifras.
 */
export function parsearFechaEscrita(text: string): string {
  const m = /^\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\s*$/.exec(text || "");
  if (!m) return "";
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const anio = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1) return "";
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  if (dia > ultimo) return "";
  return `${anio}-${dos(mes)}-${dos(dia)}`;
}

/* Valida "AAAA-MM-DD" como fecha real del calendario. */
export function fechaValida(value: unknown): string | null {
  const m = SOLO_FECHA.exec(String(value ?? "").trim());
  if (!m) return null;
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > new Date(Date.UTC(Number(m[1]), mes, 0)).getUTCDate()) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}
