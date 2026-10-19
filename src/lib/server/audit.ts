import fs from "node:fs";
import path from "node:path";
import { construirRegistro, evaluarCadena, resolverClaveSello, sellar as sellarRegistro } from "../shared/audit-chain.mjs";
import { advertenciasLlaveBitacora, SECRET_KEY_DESARROLLO } from "../shared/secretos.mjs";
import type { CurrentUser } from "./auth";
import { getConfig } from "./config";
import { isSqlite, type Row, type Session } from "./db";

/*
 * Bitacora de auditoria (ISO/IEC 17025 7.5.2 y 7.11): cada alta, cambio,
 * anulacion, revision o aprobacion queda con usuario, fecha y hora, dato
 * anterior, dato nuevo, motivo y referencia al folio o documento.
 *
 * - Solo se inserta: triggers en la base impiden UPDATE y DELETE.
 * - Cada entrada lleva un sello HMAC-SHA256 de su contenido encadenado al sello
 *   de la entrada anterior. La llave vive fuera de la base (SECRET_KEY o, si no
 *   se configuro una, `<instance>/auditoria.key`, generada al azar la primera
 *   vez), asi que quien solo tenga el archivo de la base no puede recalcular la
 *   cadena tras alterarla. Si la llave cambia o se pierde, la verificacion de lo
 *   ya escrito falla: hay que respaldarla junto con la base.
 * - Las imagenes de firma no se copian al detalle (solo se marca que cambio).
 * - El registro sellado, el sello y la llave viven en src/lib/shared/audit-chain.mjs,
 *   que usan tanto este modulo como los scripts de terminal (una sola implementacion).
 */

export type AuditAction =
  | "crear"
  | "editar"
  | "anular"
  | "restaurar"
  | "baja"
  | "reactivar"
  | "revisar"
  | "aprobar"
  | "autorizar"
  | "entregar"
  | "rechazar"
  | "aceptar"
  | "cerrar"
  | "importar"
  | "eliminar"
  | "reponer"
  | "login"
  | "login_fallido"
  | "descargar"
  | "asignar_rol"
  | "revocar_rol"
  | "vencer_rol"
  | "acotar_rol"
  | "reauth_fallida"
  | "bloquear"
  | "desbloquear"
  | "cambiar_password"
  | "restablecer_password"
  | "cerrar_sesiones"
  | "cambiar_vigencia"
  | "visto_bueno"
  | "regresar_supervision"
  | "cambiar_cargo"
  | "solicitar"
  | "aprobar_solicitud"
  | "rechazar_solicitud"
  | "cancelar_solicitud"
  | "vencer_solicitud"
  | "vencer_mantenimiento"
  | "otorgar_autorizacion"
  | "revocar_autorizacion"
  | "vencer_autorizacion"
  | "imprimir_etiquetas"
  | "asignar_muestra"
  | "revocar_asignacion"
  | "enviar_revision"
  | "devolver"
  | "enmendar"
  | "sustituir"
  | "cambiar_folio"
  | "reabrir"
  | "confirmar_firma"
  | "liberar"
  | "enviar"
  | "confirmar_envio"
  | "requiere_enmienda"
  | "alerta_integridad"
  | "subir"
  | "subir_version"
  | "archivar"
  | "categoria"
  | "publicar"
  | "confirmar_lectura"
  | "proponer"
  | "exportar"
  | "adjuntar"
  | "anular_adjunto"
  | "respaldar"
  | "respaldo_fallido"
  | "probar_restauracion"
  | "restaurar_respaldo"
  | "restauracion_fallida"
  | "reportar"
  | "evaluar"
  | "cerrar_sin_nc"
  | "escalar"
  | "avanzar"
  | "implementar"
  | "iniciar_accion"
  | "cancelar"
  | "reasignar"
  | "verificar"
  | "suspender"
  | "reanudar"
  | "retener"
  | "liberar_retencion"
  | "comunicar"
  | "afectar"
  | "nueva_revision"
  | "consultar"
  | "distribuir"
  | "retirar_distribucion"
  | "recordar";

export interface AuditEntry {
  accion: AuditAction;
  entidad: string;
  entidadId?: number | string | null;
  referencia?: string | null;
  motivo?: string | null;
  antes?: Row | null;
  despues?: Row | null;
  detalle?: Record<string, unknown> | null;
}

/*
 * La bitacora es de solo insercion: triggers que abortan UPDATE y DELETE (los
 * crea la migracion 9). Fase 12: es lo unico que se sigue asegurando en tiempo
 * de ejecucion (defensa existente): si alguien los retiro, la siguiente
 * escritura o verificacion los repone. Primero se cuentan (lectura); solo se
 * crean si faltan.
 */
export async function asegurarTriggersBitacora(s: Session): Promise<void> {
  if ((await countAuditTriggers(s)) === 2) return;
  if (isSqlite()) {
    await s.execute(`CREATE TRIGGER IF NOT EXISTS auditoria_sin_update BEFORE UPDATE ON auditoria BEGIN SELECT RAISE(ABORT, 'La bitacora de auditoria no se modifica'); END`);
    await s.execute(`CREATE TRIGGER IF NOT EXISTS auditoria_sin_delete BEFORE DELETE ON auditoria BEGIN SELECT RAISE(ABORT, 'La bitacora de auditoria no se elimina'); END`);
  } else {
    await ensureMysqlTrigger(s, "auditoria_sin_update", "BEFORE UPDATE");
    await ensureMysqlTrigger(s, "auditoria_sin_delete", "BEFORE DELETE");
  }
}

/* Numero de triggers de proteccion presentes (2 = completo). */
async function countAuditTriggers(s: Session): Promise<number> {
  const count = isSqlite()
    ? await s.scalar("SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'auditoria' AND name IN ('auditoria_sin_update', 'auditoria_sin_delete')")
    : await s.scalar("SELECT COUNT(*) FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'auditoria' AND TRIGGER_NAME IN ('auditoria_sin_update', 'auditoria_sin_delete')");
  return Number(count || 0);
}

/*
 * Ultimo id asignado por el motor. Si es mayor que el MAX(id) presente, se
 * borraron las ultimas filas (la cadena de hashes por si sola no lo notaria).
 */
async function lastAssignedId(s: Session): Promise<number | null> {
  const value = isSqlite()
    ? await s.scalar("SELECT seq FROM sqlite_sequence WHERE name = 'auditoria'")
    : await s.scalar("SELECT AUTO_INCREMENT - 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auditoria'");
  return value === null || value === undefined ? null : Number(value);
}

async function ensureMysqlTrigger(s: Session, name: string, timing: string): Promise<void> {
  const exists = await s.scalar(
    "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = :name",
    { name },
  );
  if (Number(exists || 0) > 0) return;
  await s.execute(`CREATE TRIGGER ${name} ${timing} ON auditoria FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La bitacora de auditoria es inmutable'`);
}

export { auditDiff, auditSnapshot, stableJson } from "../shared/audit-chain.mjs";

export async function registrarAuditoria(s: Session, user: CurrentUser | null | undefined, entry: AuditEntry): Promise<void> {
  await asegurarTriggersBitacora(s);
  // En MySQL se bloquea la ultima fila para que dos escrituras concurrentes no
  // encadenen al mismo hash anterior (en SQLite la sesion ya es exclusiva).
  const previous = await s.queryOne<{ hash: string }>(`SELECT hash FROM auditoria ORDER BY id DESC LIMIT 1${isSqlite() ? "" : " FOR UPDATE"}`);
  // Guardar sin cambios no deja rastro distinto de un guardado igual: construirRegistro devuelve null.
  const record = construirRegistro(entry, user, previous?.hash || null);
  if (!record) return;
  const hash = sellarRegistro(record, claveSello());
  await s.execute(
    `
    INSERT INTO auditoria (
      fecha_hora, usuario_id, usuario_nombre, usuario_email, accion, entidad, entidad_id,
      referencia, motivo, cambios_json, datos_anteriores_json, datos_nuevos_json, hash_anterior, hash
    ) VALUES (
      :fecha_hora, :usuario_id, :usuario_nombre, :usuario_email, :accion, :entidad, :entidad_id,
      :referencia, :motivo, :cambios_json, :datos_anteriores_json, :datos_nuevos_json, :hash_anterior, :hash
    )
    `,
    { ...record, hash },
  );
}

let claveCache: string | null = null;

/*
 * Advertencias sobre la llave del sello (SECRET_KEY ausente o corta). Solo
 * avisan: la llave nunca se cambia sola, porque romperia la verificacion de lo
 * ya sellado. Se muestran en el log al arrancar y en /auditoria.
 */
export function advertenciaLlaveBitacora(): string[] {
  const archivo = path.join(/*turbopackIgnore: true*/ getConfig().INSTANCE_DIR, "auditoria.key");
  return advertenciasLlaveBitacora(process.env, fs.existsSync(archivo));
}

/* Origen de la llave con que se sella la bitacora (sin revelar la llave). */
export function origenLlaveBitacora(): "SECRET_KEY" | "auditoria.key" {
  const secret = String(process.env.SECRET_KEY || "").trim();
  return secret && secret !== SECRET_KEY_DESARROLLO ? "SECRET_KEY" : "auditoria.key";
}

/* Llave del sello (SECRET_KEY o <instance>/auditoria.key); ver audit-chain.mjs. */
export function claveSello(): string {
  if (!claveCache) claveCache = resolverClaveSello(process.env.SECRET_KEY, getConfig().INSTANCE_DIR);
  return claveCache;
}

/* Lee un registro completo para tomar la foto antes/despues de un cambio. */
export async function snapshotRow(s: Session, table: string, id: number | null | undefined): Promise<Row | null> {
  if (!id || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) return null;
  return s.queryOne(`SELECT * FROM ${table} WHERE id = :id`, { id });
}

export interface AuditVerification {
  ok: boolean;
  total: number;
  primer_error: number | null;
  /* Filas borradas al final de la bitacora (ultimo id asignado vs. presente). */
  filas_faltantes_al_final: number;
  /* Huecos de id: entradas borradas en medio de la bitacora. */
  filas_faltantes_intermedias: number;
  triggers_ok: boolean;
}

/*
 * Recalcula la cadena de sellos (primer id alterado o null) y comprueba que no
 * falten filas (ni al final ni en medio) y que los triggers sigan presentes.
 */
export async function verifyAuditChain(s: Session): Promise<AuditVerification> {
  await asegurarTriggersBitacora(s);
  const rows = await s.query<Row>("SELECT * FROM auditoria ORDER BY id ASC");
  // Una sola implementacion (audit-chain.mjs), compartida con el script de restauracion.
  return evaluarCadena(rows, claveSello(), await lastAssignedId(s), await countAuditTriggers(s));
}
