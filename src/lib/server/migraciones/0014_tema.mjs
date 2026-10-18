/*
 * Migracion 14: preferencia de apariencia por persona (Claro, Oscuro o
 * Automatico). Es una preferencia visual: no cambia permisos ni flujos y su
 * cambio no se registra en la bitacora.
 */
import { ejecutarPasos } from "./pasos.mjs";

export const version = 14;
export const nombre = "Preferencia de tema (claro, oscuro o automatico) por usuario";

export const pasos = [
  { tipo: "columna", tabla: "usuarios", columna: "tema", sqlite: "VARCHAR(10) NOT NULL DEFAULT 'auto'", mysql: "VARCHAR(10) NOT NULL DEFAULT 'auto'" },
];

export async function up(db, motor) {
  await ejecutarPasos(db, motor, pasos);
}
