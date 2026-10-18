/*
 * Migracion 25: reporte PDF de mantenimiento adjuntado desde la ventana del mantenimiento.
 *
 * - reportes_mantenimiento: archivo guardado en <instancia>/maintenance_reports/<mantenimiento>/<uuid>.pdf
 *   (nombre_almacenado, relativo a esa carpeta), nombre original, tamano, huella SHA-256
 *   y quien lo subio.
 * - Quitar o reemplazar un reporte adjuntado por error no lo borra: queda anulado con
 *   motivo, quien y cuando (y, si se reemplazo, el id del reporte que lo sustituye).
 * Los reportes anteriores (sin huella) se conservan como estan. Solo agrega; no cambia datos.
 */
import { ejecutarPasos } from "./pasos.mjs";

export const version = 25;
export const nombre = "Reporte PDF de mantenimiento: huella, anulación y reemplazo";

export const pasos = [
  { tipo: "columna", tabla: "reportes_mantenimiento", columna: "nombre_almacenado", sqlite: "VARCHAR(255) DEFAULT NULL", mysql: "VARCHAR(255) DEFAULT NULL" },
  { tipo: "columna", tabla: "reportes_mantenimiento", columna: "nombre_original", sqlite: "VARCHAR(255) DEFAULT NULL", mysql: "VARCHAR(255) DEFAULT NULL" },
  { tipo: "columna", tabla: "reportes_mantenimiento", columna: "tamano_bytes", sqlite: "INTEGER DEFAULT NULL", mysql: "BIGINT DEFAULT NULL" },
  { tipo: "columna", tabla: "reportes_mantenimiento", columna: "sha256", sqlite: "VARCHAR(64) DEFAULT NULL", mysql: "VARCHAR(64) DEFAULT NULL" },
  { tipo: "columna", tabla: "reportes_mantenimiento", columna: "subido_por", sqlite: "INTEGER DEFAULT NULL", mysql: "INT DEFAULT NULL" },
  { tipo: "columna", tabla: "reportes_mantenimiento", columna: "anulado_en", sqlite: "VARCHAR(40) DEFAULT NULL", mysql: "VARCHAR(40) DEFAULT NULL" },
  { tipo: "columna", tabla: "reportes_mantenimiento", columna: "anulado_por", sqlite: "INTEGER DEFAULT NULL", mysql: "INT DEFAULT NULL" },
  { tipo: "columna", tabla: "reportes_mantenimiento", columna: "motivo_anulacion", sqlite: "TEXT", mysql: "LONGTEXT" },
  { tipo: "columna", tabla: "reportes_mantenimiento", columna: "reemplazado_por", sqlite: "INTEGER DEFAULT NULL", mysql: "INT DEFAULT NULL" },
  { tipo: "indice", nombre: "idx_reportes_mantenimiento_mant", tabla: "reportes_mantenimiento", columnas: ["id_mantenimiento"], unico: false },
];

export async function up(db, motor) {
  await ejecutarPasos(db, motor, pasos);
}
