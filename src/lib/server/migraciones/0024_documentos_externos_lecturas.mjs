/*
 * Migracion 24: Documentos SGC, Fase 3 (externos, distribucion y lectura controlada).
 *
 * - sgc_revisiones.version_externa: version o fecha de edicion del emisor de un
 *   documento externo (cada version registrada es una revision; la anterior
 *   queda obsoleta en el historial).
 * - sgc_distribucion: motivo al agregar y al retirar destinatarios.
 * - sgc_lecturas.abierto_en: primera vez que la persona abrio el PDF vigente
 *   en el visor (el acuse exige haberlo abierto).
 * Las tablas sgc_externos, sgc_distribucion y sgc_lecturas ya existen (migracion 22).
 * Solo agrega; no cambia datos.
 */
import { ejecutarPasos } from "./pasos.mjs";

export const version = 24;
export const nombre = "Documentos SGC: externos, distribución y lectura controlada";

export const pasos = [
  { tipo: "columna", tabla: "sgc_revisiones", columna: "version_externa", sqlite: "VARCHAR(120) DEFAULT NULL", mysql: "VARCHAR(120) DEFAULT NULL" },
  { tipo: "columna", tabla: "sgc_distribucion", columna: "motivo", sqlite: "TEXT", mysql: "LONGTEXT" },
  { tipo: "columna", tabla: "sgc_distribucion", columna: "motivo_retiro", sqlite: "TEXT", mysql: "LONGTEXT" },
  { tipo: "columna", tabla: "sgc_lecturas", columna: "abierto_en", sqlite: "VARCHAR(40) DEFAULT NULL", mysql: "VARCHAR(40) DEFAULT NULL" },
  { tipo: "indice", nombre: "idx_sgc_lecturas_usuario", tabla: "sgc_lecturas", columnas: ["usuario_id"], unico: false },
];

export async function up(db, motor) {
  await ejecutarPasos(db, motor, pasos);
}
