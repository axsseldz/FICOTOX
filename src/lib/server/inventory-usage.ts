import { HttpError } from "./http";
import { type Session } from "./db";
import { registrarAuditoria } from "./audit";
import { userIdFromClaims, type CurrentUser } from "./auth";
import { hoyLocal } from "../shared/fechas";

/* Portado de utils/inventory_usage.py del backend Flask original. */

const SUPPORTED_INVENTORY_TABLES = new Set(["reactivos", "consumibles"]);

function toPositiveFloat(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return amount > 0 ? amount : null;
}

export async function resolveItemId(s: Session, tableName: string, value: unknown): Promise<number | null> {
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

/*
 * Referencia libre para una salida nueva. La primera vez es la referencia base
 * (`EXT-5-INS-0`); si ya existe (una salida anterior del mismo registro que se
 * revirtio al reeditar), se numera: `EXT-5-INS-0-r2`, `-r3`... Asi el prefijo
 * del registro sigue agrupando todas sus salidas.
 */
async function referenciaLibre(s: Session, base: string): Promise<string> {
  let candidata = base;
  for (let n = 2; await s.scalar("SELECT id FROM movimientos WHERE referencia = :referencia LIMIT 1", { referencia: candidata }); n += 1) candidata = `${base}-r${n}`;
  return candidata;
}

export interface ContextoReversion {
  user: CurrentUser | null | undefined;
  /* Por que se revierte: "Anulación" o "Reedición". */
  causa: string;
  entidad: string;
  entidadId: number;
  referencia: string;
  motivo?: string | null;
}

interface SalidaVigente {
  id: number;
  tabla_origen: string;
  id_item: number;
  cantidad: number | string | null;
  motivo: string | null;
  referencia: string;
  unidad: string | null;
  vinculo_tipo: string | null;
  vinculo_id: number | null;
}

/* Salidas de un registro (por prefijo de referencia) que aun no tienen reversion. */
async function salidasVigentes(s: Session, referencePrefix: string): Promise<SalidaVigente[]> {
  return s.query<SalidaVigente>(
    `
    SELECT m.id, m.tabla_origen, m.id_item, m.cantidad, m.motivo, m.referencia, m.unidad, m.vinculo_tipo, m.vinculo_id
    FROM movimientos m
    WHERE m.tipo = 'salida'
      AND m.referencia LIKE :reference_like
      AND m.tabla_origen IN ('reactivos', 'consumibles')
      AND NOT EXISTS (SELECT 1 FROM movimientos r WHERE r.revierte_id = m.id)
    ORDER BY m.id
    `,
    { reference_like: `${referencePrefix}%` },
  );
}

/* Cantidad vigente que un registro tiene descontada, por insumo (`tabla:id`). */
export async function consumoVigente(s: Session, referencePrefix: string): Promise<Map<string, number>> {
  const totales = new Map<string, number>();
  if (!referencePrefix) return totales;
  for (const row of await salidasVigentes(s, referencePrefix)) {
    const clave = `${row.tabla_origen}:${row.id_item}`;
    totales.set(clave, (totales.get(clave) || 0) + Number(row.cantidad || 0));
  }
  return totales;
}

/*
 * Revierte las salidas de inventario registradas bajo un prefijo de referencia.
 * No borra nada: por cada salida vigente devuelve la cantidad a la existencia y
 * agrega una entrada de reversion ligada a ella (revierte_id), con motivo. Si se
 * da el contexto, deja una entrada en la bitacora con lo revertido.
 */
export async function restoreInventoryUsage(s: Session, referencePrefix: string, contexto?: ContextoReversion): Promise<number> {
  if (!referencePrefix) return 0;
  const rows = await salidasVigentes(s, referencePrefix);
  const userId = contexto ? userIdFromClaims(contexto.user) : null;
  const revertidos: Array<Record<string, unknown>> = [];

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
    const motivo = `Reversión (${contexto?.causa || "anulación o reedición"}) de: ${row.motivo || row.referencia}`;
    const result = await s.execute(
      `
      INSERT INTO movimientos (
          tipo, tabla_origen, id_item, cantidad, motivo, referencia, id_usuario, unidad, vinculo_tipo, vinculo_id, fecha_movimiento, revierte_id
      )
      VALUES (
          'entrada', :tabla_origen, :id_item, :cantidad, :motivo, :referencia, :id_usuario, :unidad, :vinculo_tipo, :vinculo_id, :fecha_movimiento, :revierte_id
      )
      `,
      {
        tabla_origen: row.tabla_origen,
        id_item: row.id_item,
        cantidad: amount,
        motivo: motivo.slice(0, 500),
        referencia: await referenciaLibre(s, `${row.referencia}-REV`),
        id_usuario: userId,
        unidad: row.unidad,
        vinculo_tipo: row.vinculo_tipo,
        vinculo_id: row.vinculo_id,
        fecha_movimiento: hoyLocal(),
        revierte_id: row.id,
      },
    );
    revertidos.push({ salida_id: row.id, reversion_id: result.lastrowid, tabla: row.tabla_origen, id_item: row.id_item, cantidad: amount, unidad: row.unidad });
  }

  if (contexto && revertidos.length) {
    await registrarAuditoria(s, contexto.user, {
      accion: "reponer",
      entidad: contexto.entidad,
      entidadId: contexto.entidadId,
      referencia: contexto.referencia,
      motivo: contexto.motivo || null,
      detalle: { tipo: "reversion", causa: contexto.causa, movimientos: revertidos },
    });
  }
  return rows.length;
}

export interface InsumoSolicitado {
  tipo: string;
  ref: unknown;
  cantidad: unknown;
}

const fmtCantidad = (n: number): string => String(Math.round(n * 1e6) / 1e6);

/*
 * Existencias suficientes para lo que se va a descontar (dentro de la misma
 * transaccion del guardado). Suma por insumo lo pedido y lo compara con la
 * existencia actual; si falta, no se guarda nada (409) y el mensaje dice el
 * insumo, lo disponible y lo requerido. Al reeditar, las salidas anteriores del
 * registro ya se revirtieron, asi que lo disponible incluye lo que el propio
 * registro habia consumido. Una existencia sin capturar cuenta como 0.
 */
export async function exigirExistencias(s: Session, insumos: InsumoSolicitado[]): Promise<void> {
  const pedidos = new Map<string, { tabla: string; id: number; cantidad: number }>();
  for (const insumo of insumos) {
    const tabla = insumo.tipo === "reactivo" ? "reactivos" : insumo.tipo === "consumible" ? "consumibles" : null;
    if (!tabla) continue;
    const id = await resolveItemId(s, tabla, insumo.ref);
    const cantidad = toPositiveFloat(insumo.cantidad);
    if (!id || !cantidad) continue;
    const clave = `${tabla}:${id}`;
    const actual = pedidos.get(clave);
    if (actual) actual.cantidad += cantidad;
    else pedidos.set(clave, { tabla, id, cantidad });
  }
  const faltantes: string[] = [];
  for (const pedido of pedidos.values()) {
    const fila =
      pedido.tabla === "reactivos"
        ? await s.queryOne<{ nombre: string | null; disponible: number | null; unidad: string | null }>("SELECT COALESCE(NULLIF(nombre, ''), NULLIF(producto, ''), item_name) AS nombre, cantidad_actual AS disponible, unidad FROM reactivos WHERE id = :id", { id: pedido.id })
        : await s.queryOne<{ nombre: string | null; disponible: number | null; unidad: string | null }>("SELECT producto AS nombre, existencia AS disponible, 'unidades' AS unidad FROM consumibles WHERE id = :id", { id: pedido.id });
    if (!fila) continue;
    const disponible = Number(fila.disponible || 0);
    if (pedido.cantidad <= disponible + 1e-9) continue;
    const unidad = fila.unidad ? ` ${fila.unidad}` : "";
    faltantes.push(`${fila.nombre || `${pedido.tabla === "reactivos" ? "Reactivo" : "Consumible"} ${pedido.id}`}: disponible ${fmtCantidad(disponible)}${unidad}, se requieren ${fmtCantidad(pedido.cantidad)}${unidad}`);
  }
  if (faltantes.length) throw new HttpError(409, { message: faltantes.length === 1 ? faltantes[0] : `No hay existencia suficiente. ${faltantes.join("; ")}`, codigo: "existencia_insuficiente", faltantes });
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
 * 2. Validar cantidad positiva (la existencia ya la valido exigirExistencias).
 * 3. Restar cantidad del inventario disponible.
 * 4. Insertar movimiento para trazabilidad.
 */
export async function consumeReactivo(s: Session, referenceValue: unknown, cantidad: unknown, options: ConsumeOptions): Promise<boolean> {
  const itemId = await resolveItemId(s, "reactivos", referenceValue);
  const amount = toPositiveFloat(cantidad);
  if (!itemId || !amount) return false;
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
  if (!itemId || !amount) return false;
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
      referencia: await referenciaLibre(s, options.referencia),
      id_usuario: options.userId,
      unidad,
      vinculo_tipo: options.vinculoTipo ?? null,
      vinculo_id: options.vinculoId ?? null,
      fecha_movimiento: hoyLocal(),
    },
  );
}
