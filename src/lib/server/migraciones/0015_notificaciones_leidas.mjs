/*
 * Migracion 15: estado de lectura de la campana por persona. Una fila por
 * (usuario, clave del evento) con cuando se leyo. Es solo de interfaz (no es
 * un registro regulado ni pasa por la bitacora); se depura sola (claves de
 * eventos que ya no existen y lecturas de mas de 90 dias).
 */
import { ejecutarPasos } from "./pasos.mjs";

export const version = 15;
export const nombre = "Notificaciones leidas por persona";

export const pasos = [
  {
    tipo: "tabla",
    nombre: "notificaciones_leidas",
    sqlite: `CREATE TABLE notificaciones_leidas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER NOT NULL, clave VARCHAR(190) NOT NULL, leida_en VARCHAR(40) NOT NULL)`,
    mysql: `CREATE TABLE IF NOT EXISTS notificaciones_leidas (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, usuario_id INT NOT NULL, clave VARCHAR(190) NOT NULL, leida_en VARCHAR(40) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  { tipo: "indice", nombre: "uq_notificaciones_leidas", tabla: "notificaciones_leidas", columnas: ["usuario_id", "clave"], unico: true },
];

export async function up(db, motor) {
  await ejecutarPasos(db, motor, pasos);
}
