/*
 * Migracion 23: Documentos SGC, flujo de aprobacion (Fase 2 del modulo).
 *
 * - sgc_revisiones: fecha limite, quien reviso/autorizo y cuando, cancelacion,
 *   revision que la sustituyo, solicitud de origen y ultima renovacion.
 * - sgc_flujo_acciones: papel con que se actuo y renovacion (si la accion es de
 *   una renovacion de vigencia).
 * - sgc_solicitudes: clave autorizada al aceptar una solicitud de documento nuevo
 *   y documento creado.
 * - sgc_renovaciones (nueva): confirmar la vigencia de la revision vigente sin
 *   cambiarla (revisor confirma, autorizador autoriza; nueva fecha de proxima revision).
 * Solo agrega; no cambia datos.
 */
import { ejecutarPasos } from "./pasos.mjs";

export const version = 23;
export const nombre = "Documentos SGC: flujo de aprobación (plazos, decisiones, sustitución y renovaciones)";

const col = (tabla, columna, sqlite, mysql = sqlite) => ({ tipo: "columna", tabla, columna, sqlite, mysql });

export const pasos = [
  col("sgc_revisiones", "fecha_limite", "VARCHAR(10) DEFAULT NULL"),
  col("sgc_revisiones", "revisada_en", "VARCHAR(40) DEFAULT NULL"),
  col("sgc_revisiones", "revisada_por", "INTEGER DEFAULT NULL", "INT DEFAULT NULL"),
  col("sgc_revisiones", "autorizada_en", "VARCHAR(40) DEFAULT NULL"),
  col("sgc_revisiones", "autorizada_por", "INTEGER DEFAULT NULL", "INT DEFAULT NULL"),
  col("sgc_revisiones", "cancelada_en", "VARCHAR(40) DEFAULT NULL"),
  col("sgc_revisiones", "cancelada_por", "INTEGER DEFAULT NULL", "INT DEFAULT NULL"),
  col("sgc_revisiones", "sustituida_por_id", "INTEGER DEFAULT NULL", "INT DEFAULT NULL"),
  col("sgc_revisiones", "solicitud_id", "INTEGER DEFAULT NULL", "INT DEFAULT NULL"),
  col("sgc_revisiones", "renovada_en", "VARCHAR(40) DEFAULT NULL"),
  col("sgc_flujo_acciones", "papel", "VARCHAR(20) DEFAULT NULL"),
  col("sgc_flujo_acciones", "renovacion_id", "INTEGER DEFAULT NULL", "INT DEFAULT NULL"),
  col("sgc_solicitudes", "clave_asignada", "VARCHAR(80) DEFAULT NULL"),
  {
    tipo: "tabla",
    nombre: "sgc_renovaciones",
    sqlite: `CREATE TABLE sgc_renovaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT, documento_id INTEGER NOT NULL, revision_id INTEGER NOT NULL,
      estado VARCHAR(20) NOT NULL DEFAULT 'en_revision' CHECK (estado IN ('en_revision', 'en_autorizacion', 'completada', 'cancelada')),
      revisor_id INTEGER NOT NULL, autorizador_id INTEGER NOT NULL, fecha_proxima_anterior VARCHAR(10) DEFAULT NULL, fecha_proxima_nueva VARCHAR(10) NOT NULL,
      fecha_limite VARCHAR(10) DEFAULT NULL, solicitado_por INTEGER DEFAULT NULL, creado_en VARCHAR(40) NOT NULL,
      revisada_en VARCHAR(40) DEFAULT NULL, autorizada_en VARCHAR(40) DEFAULT NULL, cancelada_en VARCHAR(40) DEFAULT NULL, cancelada_por INTEGER DEFAULT NULL)`,
    mysql: `CREATE TABLE IF NOT EXISTS sgc_renovaciones (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, documento_id INT NOT NULL, revision_id INT NOT NULL,
      estado VARCHAR(20) NOT NULL DEFAULT 'en_revision',
      revisor_id INT NOT NULL, autorizador_id INT NOT NULL, fecha_proxima_anterior VARCHAR(10) DEFAULT NULL, fecha_proxima_nueva VARCHAR(10) NOT NULL,
      fecha_limite VARCHAR(10) DEFAULT NULL, solicitado_por INT DEFAULT NULL, creado_en VARCHAR(40) NOT NULL,
      revisada_en VARCHAR(40) DEFAULT NULL, autorizada_en VARCHAR(40) DEFAULT NULL, cancelada_en VARCHAR(40) DEFAULT NULL, cancelada_por INT DEFAULT NULL,
      CONSTRAINT ck_sgc_renovaciones_estado CHECK (estado IN ('en_revision', 'en_autorizacion', 'completada', 'cancelada'))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  { tipo: "indice", nombre: "idx_sgc_renovaciones_documento", tabla: "sgc_renovaciones", columnas: ["documento_id"], unico: false },
  { tipo: "indice", nombre: "idx_sgc_solicitudes_estado", tabla: "sgc_solicitudes", columnas: ["estado"], unico: false },
];

export async function up(db, motor) {
  await ejecutarPasos(db, motor, pasos);
}
