/*
 * Migracion 17: recientes de la busqueda universal, por persona. Una fila por
 * (usuario, clave): lo que se busco y lo que se abrio desde la busqueda, con
 * cuando se uso por ultima vez. Es solo de interfaz (no es un registro
 * regulado ni pasa por la bitacora); cada persona conserva los ultimos 30.
 */
import { ejecutarPasos } from "./pasos.mjs";

export const version = 17;
export const nombre = "Recientes de la busqueda por persona";

export const pasos = [
  {
    tipo: "tabla",
    nombre: "busqueda_recientes",
    sqlite: `CREATE TABLE busqueda_recientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER NOT NULL, tipo VARCHAR(12) NOT NULL, clave VARCHAR(190) NOT NULL, titulo VARCHAR(255) NOT NULL,
      sub VARCHAR(255) DEFAULT NULL, href VARCHAR(500) NOT NULL DEFAULT '', kind VARCHAR(30) DEFAULT NULL, comando VARCHAR(30) DEFAULT NULL, mono INTEGER NOT NULL DEFAULT 0, usado_en VARCHAR(40) NOT NULL)`,
    mysql: `CREATE TABLE IF NOT EXISTS busqueda_recientes (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, usuario_id INT NOT NULL, tipo VARCHAR(12) NOT NULL, clave VARCHAR(190) NOT NULL, titulo VARCHAR(255) NOT NULL,
      sub VARCHAR(255) DEFAULT NULL, href VARCHAR(500) NOT NULL DEFAULT '', kind VARCHAR(30) DEFAULT NULL, comando VARCHAR(30) DEFAULT NULL, mono INT NOT NULL DEFAULT 0, usado_en VARCHAR(40) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  { tipo: "indice", nombre: "uq_busqueda_recientes", tabla: "busqueda_recientes", columnas: ["usuario_id", "clave"], unico: true },
];

export async function up(db, motor) {
  await ejecutarPasos(db, motor, pasos);
}
