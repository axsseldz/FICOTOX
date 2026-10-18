import { HttpError } from "./http";
import { type Session } from "./db";
import { hoyLocal } from "../shared/fechas";

/* Portado de utils/inventory_usage.py del backend Flask original. */

const SUPPORTED_INVENTORY_TABLES = new Set(["reactivos", "consumibles"]);

function toPositiveFloat(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return amount > 0 ? amount : null;
}

async function resolveItemId(s: Session, tableName: string, value: unknown): Promise<number | null> {
  if (!SUPPORTED_INVENTORY_TABLES.has(tableName)) {
    throw new Error(`Tabla de inventario no soportada: ${tableName}`);
  }
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const row = await s.queryOne<{ id: number }>(`SELECT id FROM ${tableName} WHERE id = :id LIMIT 1`, { id: Number.parseInt(text, 10) });
    if (row) return Number(row.id);
  }

  const query =
    tableName === "reactivos"
      ? `
      SELECT id FROM reactivos
      WHERE id_interno = :value
         OR catalogo_parte_cas_lote = :value
         OR catalogo = :value
         OR lot_number = :value
         OR numero_cas = :value
         OR cas_number = :value
         OR producto = :value
         OR nombre = :value
      LIMIT 1
      `
      : `
      SELECT id FROM consumibles
      WHERE catalogo_parte_cas = :value
         OR producto = :value
      LIMIT 1
      `;
  const row = await s.queryOne<{ id: number }>(query, { value: text });
  return row ? Number(row.id) : null;
}

/*
 * Un insumo dado de baja no se puede elegir de nuevo, pero un registro antiguo que
 * ya lo declaraba se sigue pudiendo reabrir y guardar (si no, un reactivo retirado
 * dejaria congelados los registros historicos que lo usaron).
 */
async function assertActive(s: Session, tableName: string, itemId: number): Promise<void> {
  const row = await s.queryOne<{ activo: unknown; nombre: string | null }>(`SELECT COALESCE(activo, 1) AS activo, ${tableName === "reactivos" ? "COALESCE(nombre, producto)" : "producto"} AS nombre FROM ${tableName} WHERE id = :id`, { id: itemId });
  if (row && Number(row.activo) === 0) {
    throw new HttpError(409, { message: `${tableName === "reactivos" ? "El reactivo" : "El consumible"} "${row.nombre || itemId}" esta dado de baja; reactivalo en inventario o elige otro` });
  }
}

async function movementExists(s: Session, reference: string): Promise<boolean> {
  if (!reference) return false;
  const existing = await s.scalar("SELECT id FROM movimientos WHERE referencia = :referencia LIMIT 1", { referencia: reference });
  return !!existing;
}

/* Revierte salidas de inventario registradas bajo un prefijo de referencia. */
export async function restoreInventoryUsage(s: Session, referencePrefix: string): Promise<number> {
  if (!referencePrefix) return 0;
  const rows = await s.query<{ id: number; tabla_origen: string; id_item: number; cantidad: number | string | null }>(
    `
    SELECT id, tabla_origen, id_item, cantidad
    FROM movimientos
    WHERE tipo = 'salida'
      AND referencia LIKE :reference_like
      AND tabla_origen IN ('reactivos', 'consumibles')
    `,
    { reference_like: `${referencePrefix}%` },
  );

  for (const row of rows) {
    const amount = Number(row.cantidad || 0);
    if (row.tabla_origen === "reactivos") {
      await s.execute(
        `
        UPDATE reactivos
        SET cantidad_actual = COALESCE(cantidad_actual, 0) + :cantidad,
            amount_in_stock = CASE
                WHEN amount_in_stock IS NULL THEN amount_in_stock
                ELSE amount_in_stock + :cantidad
            END
        WHERE id = :id
        `,
        { id: row.id_item, cantidad: amount },
      );
    } else if (row.tabla_origen === "consumibles") {
      await s.execute(
        `
        UPDATE consumibles
        SET existencia = COALESCE(existencia, 0) + :cantidad
        WHERE id = :id
        `,
        { id: row.id_item, cantidad: amount },
      );
    }
  }

  await s.execute(
    `
    DELETE FROM movimientos
    WHERE tipo = 'salida'
      AND referencia LIKE :reference_like
      AND tabla_origen IN ('reactivos', 'consumibles')
    `,
    { reference_like: `${referencePrefix}%` },
  );
  return rows.length;
}

interface ConsumeOptions {
  userId: number | null;
  motivo: string;
  referencia: string;
  /* El insumo ya estaba declarado en el registro: se permite aunque este dado de baja. */
  permitirInactivo?: boolean;
  /* Etapa de muestras que origina el consumo (el formato ya valido el acceso del usuario a ese folio). */
  vinculoTipo?: string | null;
  vinculoId?: number | null;
}

/*
 * Descuenta un reactivo y registra el movimiento de salida.
 * 1. Resolver el reactivo por id, codigo, catalogo, lote, CAS o nombre.
 * 2. Validar cantidad positiva y referencia no usada.
 * 3. Restar cantidad del inventario disponible.
 * 4. Insertar movimiento para trazabilidad.
 */
export async function consumeReactivo(s: Session, referenceValue: unknown, cantidad: unknown, options: ConsumeOptions): Promise<boolean> {
  const itemId = await resolveItemId(s, "reactivos", referenceValue);
  const amount = toPositiveFloat(cantidad);
  if (!itemId || !amount || (await movementExists(s, options.referencia))) return false;
  if (!options.permitirInactivo) await assertActive(s, "reactivos", itemId);

  await s.execute(
    `
    UPDATE reactivos
    SET cantidad_actual = COALESCE(cantidad_actual, 0) - :cantidad,
        amount_in_stock = CASE
            WHEN amount_in_stock IS NULL THEN amount_in_stock
            ELSE amount_in_stock - :cantidad
        END
    WHERE id = :id
    `,
    { id: itemId, cantidad: amount },
  );
  await insertMovement(s, "reactivos", itemId, amount, options);
  return true;
}

export async function consumeConsumible(s: Session, referenceValue: unknown, cantidad: unknown, options: ConsumeOptions): Promise<boolean> {
  const itemId = await resolveItemId(s, "consumibles", referenceValue);
  const amount = toPositiveFloat(cantidad);
  if (!itemId || !amount || (await movementExists(s, options.referencia))) return false;
  if (!options.permitirInactivo) await assertActive(s, "consumibles", itemId);

  await s.execute(
    `
    UPDATE consumibles
    SET existencia = COALESCE(existencia, 0) - :cantidad
    WHERE id = :id
    `,
    { id: itemId, cantidad: amount },
  );
  await insertMovement(s, "consumibles", itemId, amount, options);
  return true;
}

async function insertMovement(s: Session, tableName: string, itemId: number, cantidad: number, options: ConsumeOptions): Promise<void> {
  const unidad = tableName === "reactivos" ? (await s.scalar("SELECT unidad FROM reactivos WHERE id = :id", { id: itemId })) || null : "unidades";
  await s.execute(
    `
    INSERT INTO movimientos (
        tipo, tabla_origen, id_item, cantidad, motivo, referencia, id_usuario, unidad, vinculo_tipo, vinculo_id, fecha_movimiento
    )
    VALUES (
        'salida', :tabla_origen, :id_item, :cantidad, :motivo, :referencia, :id_usuario, :unidad, :vinculo_tipo, :vinculo_id, :fecha_movimiento
    )
    `,
    {
      tabla_origen: tableName,
      id_item: itemId,
      cantidad,
      motivo: options.motivo,
      referencia: options.referencia,
      id_usuario: options.userId,
      unidad,
      vinculo_tipo: options.vinculoTipo ?? null,
      vinculo_id: options.vinculoId ?? null,
      fecha_movimiento: hoyLocal(),
    },
  );
}
