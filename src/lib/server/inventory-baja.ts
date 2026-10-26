import { userIdFromClaims, type CurrentUser } from "./auth";
import { registrarAuditoria, snapshotRow } from "./audit";
import { isSqlite, type Session } from "./db";
import { json } from "./http";

import { exigirReauth } from "./seguridad";

/*
 * Baja logica de los catalogos de inventario (reactivos, consumibles,
 * equipos): un articulo dado de baja deja de ofrecerse en los formatos, pero
 * sus movimientos y los registros tecnicos que lo citan siguen apuntando a
 * el. Se registra motivo, fecha y usuario, y queda en la bitacora.
 */

export type BajaTable = "reactivos" | "consumibles" | "equipos";

export function itemRef(table: BajaTable, row: Record<string, unknown> | null | undefined): string {
  if (!row) return table;
  if (table === "reactivos") return String(row.id_interno || row.nombre || row.producto || row.item_name || row.nombre_crm || row.id || "reactivo").slice(0, 160);
  return String(row.nombre || row.producto || row.id || table).slice(0, 160);
}

/* Modulo del permiso de cada tabla (para la reautenticacion). */
const MODULO_BAJA: Record<BajaTable, string> = { reactivos: "inventario", consumibles: "inventario", equipos: "equipos" };

export async function darDeBaja(s: Session, user: CurrentUser, table: BajaTable, id: number, payload: Record<string, unknown>, label: string, request: Request): Promise<Response> {
  const motivo = String(payload.motivo || "").trim();
  if (motivo.length < 5) {
    return json({ message: `Indica el motivo de la baja del ${label.toLowerCase()} (al menos 5 caracteres)` }, 400);
  }
  const antes = await snapshotRow(s, table, id);
  if (!antes) return json({ message: `${label} no encontrado` }, 404);
  if (Number(antes.activo ?? 1) === 0) return json({ message: `${label} ya está dado de baja` }, 409);
  await exigirReauth(s, request, user, `${MODULO_BAJA[table]}:AN`);
  await s.execute(`UPDATE ${table} SET activo = 0, baja_motivo = :motivo, baja_en = :fecha, baja_por = :usuario WHERE id = :id`, { motivo, fecha: new Date().toISOString(), usuario: userIdFromClaims(user), id });
  const despues = await snapshotRow(s, table, id);
  await registrarAuditoria(s, user, { accion: "baja", entidad: table, entidadId: id, referencia: itemRef(table, antes), motivo, antes, despues });
  // Un equipo retirado no conserva mantenimientos abiertos (ni sus avisos de vencido): se cancelan con el motivo de la baja.
  let cancelados = 0;
  if (table === "equipos") {
    const abiertos = await s.query<Record<string, unknown>>("SELECT id FROM mantenimientos WHERE id_equipo = :id AND estado IN ('programado', 'en_proceso', 'vencido') ORDER BY id", { id });
    const observaciones = isSqlite() ? "TRIM(COALESCE(observaciones, '') || :nota)" : "TRIM(CONCAT(COALESCE(observaciones, ''), :nota))";
    for (const m of abiertos) {
      const previo = await snapshotRow(s, "mantenimientos", Number(m.id));
      await s.execute(`UPDATE mantenimientos SET estado = 'cancelado', observaciones = ${observaciones} WHERE id = :id`, { id: m.id, nota: `\n[Cancelado por la baja del equipo: ${motivo}]` });
      await registrarAuditoria(s, user, { accion: "anular", entidad: "mantenimientos", entidadId: Number(m.id), referencia: `mantenimiento ${previo?.tipo || ""} equipo ${id}`, motivo: `Baja del equipo: ${motivo}`, antes: previo, despues: await snapshotRow(s, "mantenimientos", Number(m.id)) });
      cancelados += 1;
    }
  }
  await s.commit();
  return json({ message: cancelados ? `${label} dado de baja; se cancelaron ${cancelados} mantenimiento${cancelados === 1 ? "" : "s"} pendiente${cancelados === 1 ? "" : "s"}` : `${label} dado de baja`, mantenimientos_cancelados: cancelados });
}

export async function reactivarItem(s: Session, user: CurrentUser, table: BajaTable, id: number, payload: Record<string, unknown>, label: string, request: Request): Promise<Response> {
  const motivo = String(payload.motivo || "").trim();
  if (motivo.length < 5) return json({ message: "Indica el motivo de la reactivación (al menos 5 caracteres)" }, 400);
  const antes = await snapshotRow(s, table, id);
  if (!antes) return json({ message: `${label} no encontrado` }, 404);
  if (Number(antes.activo ?? 1) === 1) return json({ message: `${label} ya está activo` }, 409);
  await exigirReauth(s, request, user, `${MODULO_BAJA[table]}:G`);
  await s.execute(`UPDATE ${table} SET activo = 1, baja_motivo = NULL, baja_en = NULL, baja_por = NULL WHERE id = :id`, { id });
  const despues = await snapshotRow(s, table, id);
  await registrarAuditoria(s, user, { accion: "reactivar", entidad: table, entidadId: id, referencia: itemRef(table, antes), motivo, antes, despues });
  await s.commit();
  return json({ message: `${label} reactivado` });
}
