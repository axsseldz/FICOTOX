/*
 * Migracion 20: existencia de consumibles en UNIDADES y fecha del movimiento.
 *
 * Hasta ahora la existencia de un consumible eran sus "piezas" (cajas, bolsas).
 * El laboratorio descuenta unidades sueltas (cartuchos, tapones, guantes), asi que
 * la existencia pasa a una columna propia, `consumibles.existencia`, en unidades.
 * `piezas` y `cantidad_por_pieza` quedan como datos descriptivos del empaque.
 *
 * Datos (una sola vez, al crearse la columna):
 * - existencia = piezas x cantidad_por_pieza (si la cantidad por pieza es nula o 0, x 1);
 * - el stock de referencia (stock_maximo) se multiplica por el mismo factor;
 * - los movimientos de consumibles ya registrados (que estaban en piezas) se
 *   convierten con el mismo factor y quedan con unidad "unidades", para que
 *   revertir un descuento viejo devuelva la cantidad correcta.
 *
 * Tambien agrega `movimientos.fecha_movimiento` (la fecha en que ocurrio el
 * movimiento, que puede ser anterior a la captura). `creado_en` sigue siendo la
 * fecha de captura. Los movimientos anteriores se quedan sin fecha propia: se
 * entiende que ocurrieron al capturarse.
 * No se borra ninguna columna ni dato.
 */
import { ejecutarPasos } from "./pasos.mjs";

export const version = 20;
export const nombre = "Existencia de consumibles en unidades y fecha del movimiento";

export const pasos = [
  { tipo: "columna", tabla: "consumibles", columna: "existencia", sqlite: "REAL DEFAULT 0", mysql: "DOUBLE DEFAULT 0" },
  { tipo: "columna", tabla: "movimientos", columna: "fecha_movimiento", sqlite: "DATE DEFAULT NULL", mysql: "DATE DEFAULT NULL" },
];

async function tieneExistencia(db, motor) {
  if (motor === "sqlite") return (await db.all('PRAGMA table_info("consumibles")')).some((c) => c.name === "existencia");
  return !!(await db.get("SELECT 1 AS x FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'consumibles' AND COLUMN_NAME = 'existencia'"));
}

export async function up(db, motor) {
  const yaConvertida = await tieneExistencia(db, motor);
  await ejecutarPasos(db, motor, pasos);
  if (yaConvertida) return;

  const consumibles = await db.all("SELECT id, piezas, cantidad_por_pieza, stock_maximo FROM consumibles");
  for (const c of consumibles) {
    const porPieza = Number(c.cantidad_por_pieza);
    const factor = Number.isFinite(porPieza) && porPieza > 0 ? porPieza : 1;
    const existencia = (Number(c.piezas) || 0) * factor;
    const maximo = c.stock_maximo === null || c.stock_maximo === undefined ? null : Number(c.stock_maximo) * factor;
    await db.run("UPDATE consumibles SET existencia = ?, stock_maximo = ? WHERE id = ?", [existencia, maximo, c.id]);
  }
  const movimientos = await db.all("SELECT m.id, m.cantidad, c.cantidad_por_pieza FROM movimientos m JOIN consumibles c ON c.id = m.id_item WHERE m.tabla_origen = 'consumibles' AND (m.unidad IS NULL OR m.unidad = 'piezas')");
  for (const m of movimientos) {
    const porPieza = Number(m.cantidad_por_pieza);
    const factor = Number.isFinite(porPieza) && porPieza > 0 ? porPieza : 1;
    await db.run("UPDATE movimientos SET cantidad = ?, unidad = 'unidades' WHERE id = ?", [(Number(m.cantidad) || 0) * factor, m.id]);
  }
}
