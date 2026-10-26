import { estaAsignado, soloAsignado } from "./asignaciones";
import { HttpError } from "./http";
import { permisoDe, type Autorizacion } from "./rbac";
import type { Session } from "./db";
import { toFloatOrNull, toIntOrNull } from "./modules/helpers";
import { fechaSola, fechaValida, formatearFecha, hoyLocal } from "../shared/fechas";

/*
 * Movimientos manuales de inventario (reactivos y consumibles): entrada, salida,
 * consumo y ajuste por conteo físico. La existencia solo cambia por movimientos.
 * - entrada: suma `cantidad`.
 * - salida / consumo: resta `cantidad` (no puede dejar la existencia en negativo).
 * - ajuste: `cantidad` es lo contado físicamente al cierre del día del conteo; se registra la
 *   diferencia con signo. Si el conteo es de un día anterior, lo que entró o salió después se
 *   conserva (existencia de hoy = contado + movimientos con fecha posterior).
 */

export const TIPOS_MOVIMIENTO_MANUAL = ["entrada", "salida", "consumo", "ajuste"] as const;
export type TipoMovimientoManual = (typeof TIPOS_MOVIMIENTO_MANUAL)[number];

const TABLAS_VINCULO: Record<string, string> = {
  recepcion: "muestras_recepcion",
  procesamiento: "muestras_procesamiento",
  extraccion: "muestras_extraccion",
  analisis: "muestras_analisis",
};

const ETIQUETA_VINCULO: Record<string, string> = { recepcion: "Recepción", procesamiento: "Procesamiento", extraccion: "Extracción", analisis: "Análisis" };

/* Una sola normalización del tipo, para que la validación de permisos y la interpretación nunca difieran. */
export const tipoDeMovimiento = (payload: Record<string, unknown>): string => String(payload.tipo || "entrada").trim().toLowerCase();

export interface MovimientoManual {
  tipo: TipoMovimientoManual;
  /* Cambio con signo sobre la existencia. */
  delta: number;
  /* Lo que queda en el historial (positiva; con signo en los ajustes). */
  cantidad: number;
  motivo: string;
  /* Dia en que ocurrio el movimiento (AAAA-MM-DD); puede ser anterior a la captura, nunca futuro. */
  fechaMovimiento: string;
  vinculoTipo: string | null;
  vinculoId: number | null;
}

/*
 * Acceso a un folio de Muestras, con la misma regla que las pantallas de Muestras:
 * ver el modulo (muestras para recepciones; ensayos para procesamiento, extraccion
 * y analisis) y, con alcance "asignado", que la recepcion este asignada a la
 * persona o la haya registrado ella. Si no hay acceso (o el folio no existe) la
 * respuesta es la misma, para no revelar si existe.
 */
const MODULO_DEL_VINCULO: Record<string, "muestras" | "ensayos"> = { recepcion: "muestras", procesamiento: "ensayos", extraccion: "ensayos", analisis: "ensayos" };

async function recepcionDe(s: Session, tipo: string, fila: Record<string, unknown>): Promise<{ id: number | null; creadoPor: number | null }> {
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  if (tipo === "recepcion") return { id: num(fila.id), creadoPor: num(fila.creado_por) };
  let recepcionId = num(fila.recepcion_id);
  if (recepcionId === null && num(fila.procesamiento_id) !== null) {
    recepcionId = num(await s.scalar("SELECT recepcion_id FROM muestras_procesamiento WHERE id = :id", { id: num(fila.procesamiento_id) }));
  }
  if (recepcionId === null && num(fila.extraccion_id) !== null) {
    const proc = await s.scalar("SELECT procesamiento_id FROM muestras_extraccion WHERE id = :id", { id: num(fila.extraccion_id) });
    if (proc !== null && proc !== undefined) recepcionId = num(await s.scalar("SELECT recepcion_id FROM muestras_procesamiento WHERE id = :id", { id: Number(proc) }));
  }
  const creadoPor = recepcionId === null ? null : num(await s.scalar("SELECT creado_por FROM muestras_recepcion WHERE id = :id", { id: recepcionId }));
  return { id: recepcionId, creadoPor };
}

export const SIN_ACCESO_AL_FOLIO = "No tienes acceso a este folio";

async function exigirAccesoAlFolio(s: Session, auth: Autorizacion, tipo: string, fila: Record<string, unknown> | null): Promise<void> {
  const denegado = new HttpError(403, { message: SIN_ACCESO_AL_FOLIO });
  if (!fila) throw denegado;
  const permiso = permisoDe(auth, MODULO_DEL_VINCULO[tipo], "V");
  if (!permiso) throw denegado;
  if (!soloAsignado(permiso)) return;
  const origen = await recepcionDe(s, tipo, fila);
  if (origen.creadoPor === auth.userId) return;
  if (origen.id !== null && (await estaAsignado(s, auth.userId, origen.id))) return;
  throw denegado;
}

/* El insumo del movimiento: su tabla, su id y su alta (para el ajuste por conteo con fecha anterior). */
export interface InsumoMovimiento {
  tabla: "reactivos" | "consumibles";
  id: number;
  creadoEn: unknown;
}

/* Suma con signo de los movimientos del insumo con fecha posterior a `fecha` (las reversiones son entradas). */
async function movimientosPosteriores(s: Session, insumo: InsumoMovimiento, fecha: string): Promise<number> {
  const suma = await s.scalar(
    `SELECT COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN cantidad WHEN tipo IN ('salida', 'consumo') THEN -cantidad WHEN tipo = 'ajuste' THEN cantidad ELSE 0 END), 0)
     FROM movimientos WHERE tabla_origen = :tabla AND id_item = :id AND fecha_movimiento > :fecha`,
    { tabla: insumo.tabla, id: insumo.id, fecha },
  );
  return Number(suma) || 0;
}

export async function interpretarMovimiento(s: Session, auth: Autorizacion, payload: Record<string, unknown>, existencia: number, insumo: InsumoMovimiento): Promise<MovimientoManual> {
  const tipo = tipoDeMovimiento(payload) as TipoMovimientoManual;
  if (!TIPOS_MOVIMIENTO_MANUAL.includes(tipo)) throw new HttpError(400, { message: "El tipo de movimiento debe ser entrada, salida, consumo o ajuste" });
  const cantidad = toFloatOrNull(payload.cantidad);
  if (cantidad === null || Number.isNaN(cantidad)) throw new HttpError(400, { message: tipo === "ajuste" ? "Captura la cantidad contada" : "Captura una cantidad mayor a cero" });
  if (tipo === "ajuste" ? cantidad < 0 : cantidad <= 0) throw new HttpError(400, { message: tipo === "ajuste" ? "La cantidad contada no puede ser negativa" : "Captura una cantidad mayor a cero" });

  const motivoLibre = String(payload.motivo || "").trim();
  if (tipo === "ajuste" && !motivoLibre) throw new HttpError(400, { message: "Indica el motivo del ajuste (por ejemplo, «Conteo físico de enero»)" });
  const motivo = motivoLibre || (tipo === "entrada" ? "Relleno manual de stock" : tipo === "consumo" ? "Consumo registrado" : "Salida registrada");

  const fechaTexto = String(payload.fecha_movimiento ?? "").trim();
  const fechaMovimiento = fechaTexto ? fechaValida(fechaTexto) : hoyLocal();
  if (!fechaMovimiento) throw new HttpError(400, { message: "La fecha del movimiento no es válida" });
  if (fechaMovimiento > hoyLocal()) throw new HttpError(400, { message: "La fecha del movimiento no puede ser futura" });

  let delta = cantidad;
  let registrada = cantidad;
  if (tipo === "salida" || tipo === "consumo") {
    // Como en los formatos: nunca existencia negativa (409 existencia_insuficiente).
    if (cantidad > existencia + 1e-9) throw new HttpError(409, { message: `No hay existencia suficiente para esa cantidad (hay ${existencia})`, codigo: "existencia_insuficiente" });
    delta = -cantidad;
  } else if (tipo === "ajuste") {
    // Lo contado es la existencia al cierre del día del conteo: con fecha anterior se suman los movimientos
    // posteriores (no se borra lo que salió o entró después). Antes del alta del insumo no hay qué contar.
    let objetivo = cantidad;
    if (fechaMovimiento < hoyLocal()) {
      const alta = fechaSola(insumo.creadoEn);
      if (alta && fechaMovimiento < alta) throw new HttpError(400, { message: `El conteo no puede ser anterior al alta del insumo (${formatearFecha(alta)})`, campo: "fecha_movimiento" });
      objetivo = Math.round((cantidad + (await movimientosPosteriores(s, insumo, fechaMovimiento))) * 1e6) / 1e6;
      if (objetivo < 0) throw new HttpError(409, { message: `Lo contado no alcanza para lo que salió después del ${formatearFecha(fechaMovimiento)}; revisa la fecha o la cantidad del conteo`, codigo: "existencia_insuficiente" });
    }
    // Sin diferencia se guarda 0, no «−0».
    delta = Math.round((objetivo - existencia) * 1e6) / 1e6 || 0;
    registrada = delta;
  }

  const vinculoTipo = String(payload.vinculo_tipo || "").trim().toLowerCase() || null;
  const folio = toIntOrNull(payload.vinculo_folio);
  let vinculoId = toIntOrNull(payload.vinculo_id);
  let motivoFinal = motivo;
  if (vinculoTipo || folio !== null || vinculoId !== null) {
    const tabla = vinculoTipo ? TABLAS_VINCULO[vinculoTipo] : undefined;
    if (!tabla || (folio === null && vinculoId === null)) throw new HttpError(400, { message: "El vínculo debe indicar el tipo (recepción, procesamiento, extracción o análisis) y su folio" });
    const fila =
      folio !== null
        ? await s.queryOne<Record<string, unknown>>(`SELECT * FROM ${tabla} WHERE folio_num = :n ORDER BY id DESC LIMIT 1`, { n: folio })
        : await s.queryOne<Record<string, unknown>>(`SELECT * FROM ${tabla} WHERE id = :n LIMIT 1`, { n: vinculoId });
    await exigirAccesoAlFolio(s, auth, vinculoTipo as string, fila);
    if (!fila) throw new HttpError(403, { message: SIN_ACCESO_AL_FOLIO });
    vinculoId = Number(fila.id);
    motivoFinal = `${motivo} · ${ETIQUETA_VINCULO[vinculoTipo as string]} ${String(fila.folio_num)}`;
  }
  return { tipo, delta, cantidad: registrada, motivo: motivoFinal, fechaMovimiento, vinculoTipo, vinculoId };
}
