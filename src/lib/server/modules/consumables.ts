import { requireUser, userIdFromClaims } from "../auth";
import { registrarAuditoria, snapshotRow } from "../audit";

import { intParam, json, readJson, type RouteContext } from "../http";
import { darDeBaja, reactivarItem } from "../inventory-baja";

import { cargarAutorizacion, requirePermission } from "../rbac";
import { aplicarSupervision, marcaSupervision } from "../supervision";

import { hoyLocal } from "../../shared/fechas";
import { interpretarMovimiento, tipoDeMovimiento } from "../inventory-movimientos";
import { searchParam, toFloatOrNull, toStrOrNull, utcTimestampReference } from "./helpers";


interface ConsumablePayload {
  id_interno: string | null;
  producto: string;
  marca: string | null;
  proveedor: string | null;
  catalogo_parte_cas: string | null;
  lote: string | null;
  fecha_ingreso: string | null;
  tamano_capacidad: string | null;
  contenedor: string | null;
  piezas: number | null;
  cantidad_por_pieza: number | null;
  localizacion: string | null;
  stock_minimo: number | null;
  observaciones: string | null;
}

class ConsumibleInvalido extends Error {}

function numeroNoNegativo(value: unknown, etiqueta: string): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = toFloatOrNull(value);
  if (n === null || n < 0) throw new ConsumibleInvalido(`«${etiqueta}» debe ser un número mayor o igual a cero`);
  return n;
}

/* Fecha de ingreso opcional: vacío o "s/f" (sin fecha) se guarda vacío. */
function fechaOpcional(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return !text || /^s\/?f$/i.test(text) ? null : text.slice(0, 20);
}

function normalizePayload(raw: Record<string, unknown> | null | undefined): ConsumablePayload {
  const data = raw || {};
  const contenedor = toStrOrNull(data.contenedor, 120);
  return {
    id_interno: toStrOrNull(data.id_interno, 120),
    producto: String(data.producto || "").trim(),
    marca: toStrOrNull(data.marca, 120),
    proveedor: toStrOrNull(data.proveedor, 180),
    catalogo_parte_cas: toStrOrNull(data.catalogo_parte_cas, 180),
    lote: toStrOrNull(data.lote, 120),
    fecha_ingreso: fechaOpcional(data.fecha_ingreso),
    tamano_capacidad: toStrOrNull(data.tamano_capacidad, 120),
    contenedor,
    piezas: numeroNoNegativo(data.piezas, "Piezas"),
    cantidad_por_pieza: numeroNoNegativo(data.cantidad_por_pieza, "Cantidad por pieza"),
    localizacion: toStrOrNull(data.localizacion, 180),
    stock_minimo: numeroNoNegativo(data.stock_minimo, "Stock mínimo"),
    observaciones: toStrOrNull(data.observaciones, 4000),
  };
}

const SELECT_COLUMNS = `
  SELECT id, id_interno, producto, marca, proveedor, catalogo_parte_cas, lote,
         fecha_ingreso, tamano_capacidad, contenedor, piezas, existencia,
         cantidad_por_pieza, localizacion, stock_minimo, observaciones, stock_maximo, activo, baja_motivo, baja_en, creado_por, creado_en
  FROM consumibles
`;

export async function getConsumables({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await requirePermission(s, user, "inventario", "V");

  const search = new URL(request.url).searchParams.get("search") ?? "";
  const rows = await s.query(
    `${SELECT_COLUMNS}
    WHERE (:incluir_bajas = 1 OR COALESCE(activo, 1) = 1)
      AND (producto LIKE :search OR marca LIKE :search OR id_interno LIKE :search OR lote LIKE :search OR catalogo_parte_cas LIKE :search OR localizacion LIKE :search)
    ORDER BY producto ASC
    `,
    { search: `%${search}%`, incluir_bajas: searchParam(request, "bajas") === "1" ? 1 : 0 },
  );
  return json({ items: rows, total: rows.length });
}

export async function createConsumable({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const supervision = marcaSupervision(await requirePermission(s, user, "inventario", "C", { objeto: "catalogo_inventario" }));

  let data: ConsumablePayload;
  try {
    data = normalizePayload(await readJson(request));
  } catch (err) {
    if (err instanceof ConsumibleInvalido) return json({ message: err.message }, 400);
    throw err;
  }
  if (!data.producto) {
    return json({ message: "El campo 'producto' es obligatorio" }, 400);
  }

  // Existencia inicial en unidades: piezas x cantidad por pieza (sin cantidad por pieza, x 1).
  const existencia = (data.piezas || 0) * (data.cantidad_por_pieza && data.cantidad_por_pieza > 0 ? data.cantidad_por_pieza : 1);
  const result = await s.execute(
    `
    INSERT INTO consumibles (id_interno, producto, marca, proveedor, catalogo_parte_cas, lote, fecha_ingreso, tamano_capacidad, contenedor, piezas, cantidad_por_pieza, localizacion, stock_minimo, observaciones, existencia, stock_maximo, creado_por)
    VALUES (:id_interno, :producto, :marca, :proveedor, :catalogo_parte_cas, :lote, :fecha_ingreso, :tamano_capacidad, :contenedor, :piezas, :cantidad_por_pieza, :localizacion, :stock_minimo, :observaciones, :existencia, :existencia, :creado_por)
    `,
    { ...data, existencia, creado_por: userIdFromClaims(user) },
  );
  const id = result.lastrowid as number;
  if (existencia > 0) {
    await s.execute(
      `INSERT INTO movimientos (tipo, tabla_origen, id_item, cantidad, motivo, referencia, id_usuario, unidad, fecha_movimiento)
       VALUES ('entrada', 'consumibles', :id, :cantidad, 'Existencia inicial', :referencia, :id_usuario, 'unidades', :fecha_movimiento)`,
      { id, cantidad: existencia, referencia: `consumible-inicial-${id}`, id_usuario: userIdFromClaims(user), fecha_movimiento: hoyLocal() },
    );
  }
  await aplicarSupervision(s, "consumibles", id, supervision, userIdFromClaims(user));
  await registrarAuditoria(s, user, { accion: "crear", entidad: "consumibles", entidadId: id, referencia: String(data.producto), despues: await snapshotRow(s, "consumibles", id) });
  await s.commit();
  return json({ message: "Consumible creado", id }, 201);
}

export async function getConsumable({ request, s, params }: RouteContext): Promise<Response> {
  const consumableId = intParam(params.id);
  const user = await requireUser(request);
  await requirePermission(s, user, "inventario", "V");

  const row = await s.queryOne(`${SELECT_COLUMNS} WHERE id = :id LIMIT 1`, { id: consumableId });
  if (!row) {
    return json({ message: "Consumible no encontrado" }, 404);
  }
  return json({ item: row });
}

export async function updateConsumable({ request, s, params }: RouteContext): Promise<Response> {
  const consumableId = intParam(params.id);
  const user = await requireUser(request);
  const supervision = marcaSupervision(await requirePermission(s, user, "inventario", "E", { objeto: "catalogo_inventario" }));

  let data: ConsumablePayload;
  try {
    data = normalizePayload(await readJson(request));
  } catch (err) {
    if (err instanceof ConsumibleInvalido) return json({ message: err.message }, 400);
    throw err;
  }
  if (!data.producto) {
    return json({ message: "El campo 'producto' es obligatorio" }, 400);
  }

  // La existencia (en unidades) solo cambia con movimientos; piezas y cantidad por pieza son datos del empaque.
  const antes = await snapshotRow(s, "consumibles", consumableId);
  const result = await s.execute(
    `
    UPDATE consumibles
    SET id_interno = :id_interno, producto = :producto, marca = :marca, proveedor = :proveedor, catalogo_parte_cas = :catalogo_parte_cas,
        lote = :lote, fecha_ingreso = :fecha_ingreso, tamano_capacidad = :tamano_capacidad, contenedor = :contenedor,
        piezas = :piezas, cantidad_por_pieza = :cantidad_por_pieza, localizacion = :localizacion, stock_minimo = :stock_minimo, observaciones = :observaciones
    WHERE id = :id
    `,
    { id_interno: data.id_interno, producto: data.producto, marca: data.marca, proveedor: data.proveedor, catalogo_parte_cas: data.catalogo_parte_cas, lote: data.lote, fecha_ingreso: data.fecha_ingreso, tamano_capacidad: data.tamano_capacidad, contenedor: data.contenedor, piezas: data.piezas, cantidad_por_pieza: data.cantidad_por_pieza, localizacion: data.localizacion, stock_minimo: data.stock_minimo, observaciones: data.observaciones, id: consumableId },
  );
  if (result.rowcount === 0) {
    await s.rollback();
    return json({ message: "Consumible no encontrado" }, 404);
  }
  await aplicarSupervision(s, "consumibles", consumableId, supervision, userIdFromClaims(user));
  await registrarAuditoria(s, user, { accion: "editar", entidad: "consumibles", entidadId: consumableId, referencia: String(data.producto), antes, despues: await snapshotRow(s, "consumibles", consumableId) });
  await s.commit();
  return json({ message: "Consumible actualizado" });
}

export async function refillConsumable({ request, s, params }: RouteContext): Promise<Response> {
  const consumableId = intParam(params.id);
  const user = await requireUser(request);
  const supervision = marcaSupervision(await requirePermission(s, user, "inventario", "C", { objeto: "movimiento" }));

  const data = await readJson(request);
  // Corregir la existencia por conteo es una edición: pide además el permiso de editar movimientos.
  if (tipoDeMovimiento(data) === "ajuste") await requirePermission(s, user, "inventario", "E", { objeto: "movimiento" });
  const row = await s.queryOne<Record<string, unknown>>("SELECT existencia, stock_maximo FROM consumibles WHERE id = :id LIMIT 1", { id: consumableId });
  if (!row) {
    return json({ message: "Consumible no encontrado" }, 404);
  }
  const existencia = toFloatOrNull(row.existencia) || 0;
  const mov = await interpretarMovimiento(s, await cargarAutorizacion(s, user), data, existencia);
  const userId = userIdFromClaims(user);

  await s.execute(
    `
    UPDATE consumibles
    SET stock_maximo = CASE
            WHEN stock_maximo IS NULL OR stock_maximo < COALESCE(existencia, 0) + :delta
            THEN COALESCE(existencia, 0) + :delta
            ELSE stock_maximo
        END,
        existencia = COALESCE(existencia, 0) + :delta
    WHERE id = :id
    `,
    { id: consumableId, delta: mov.delta },
  );

  await s.execute(
    `
    INSERT INTO movimientos (tipo, tabla_origen, id_item, cantidad, motivo, referencia, id_usuario, unidad, vinculo_tipo, vinculo_id, fecha_movimiento)
    VALUES (:tipo, 'consumibles', :id, :cantidad, :motivo, :referencia, :id_usuario, 'unidades', :vinculo_tipo, :vinculo_id, :fecha_movimiento)
    `,
    {
      tipo: mov.tipo,
      id: consumableId,
      cantidad: mov.cantidad,
      motivo: mov.motivo,
      referencia: `consumible-${mov.tipo}-${consumableId}-${utcTimestampReference()}`,
      id_usuario: userId,
      vinculo_tipo: mov.vinculoTipo,
      vinculo_id: mov.vinculoId,
      fecha_movimiento: mov.fechaMovimiento,
    },
  );
  await aplicarSupervision(s, "consumibles", consumableId, supervision, userId);
  const despues = await snapshotRow(s, "consumibles", consumableId);
  await registrarAuditoria(s, user, { accion: "reponer", entidad: "consumibles", entidadId: consumableId, referencia: String(despues?.producto || consumableId), motivo: mov.motivo, despues, detalle: { tipo: mov.tipo, fecha_movimiento: mov.fechaMovimiento, cantidad: mov.cantidad, existencia_anterior: existencia, existencia_nueva: existencia + mov.delta } });
  await s.commit();
  return json({ message: mov.tipo === "ajuste" ? "Existencia ajustada" : "Movimiento registrado" });
}

/* Baja logica: conserva movimientos y registros que citan al consumible. */
export async function deleteConsumable({ request, s, params }: RouteContext): Promise<Response> {
  const consumableId = intParam(params.id);
  const user = await requireUser(request);
  await requirePermission(s, user, "inventario", "AN");
  return darDeBaja(s, user, "consumibles", consumableId, await readJson(request), "Consumible", request);
}

export async function reactivarConsumable({ request, s, params }: RouteContext): Promise<Response> {
  const consumableId = intParam(params.id);
  const user = await requireUser(request);
  await requirePermission(s, user, "inventario", "G");
  return reactivarItem(s, user, "consumibles", consumableId, await readJson(request), "Consumible", request);
}
