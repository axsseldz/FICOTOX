/*
 * Migracion 16: foto de perfil propia. `foto` guarda la base del archivo
 * (<usuario_id>/<uuid>; se sirven <base>-512.webp y <base>-128.webp desde
 * <instancia>/avatares) y `usa_foto` si la persona eligio mostrarla (1) o su
 * figura (0). Cambiar de una a otra no pierde la otra.
 */
import { ejecutarPasos } from "./pasos.mjs";

export const version = 16;
export const nombre = "Foto de perfil propia (opcional) por usuario";

export const pasos = [
  { tipo: "columna", tabla: "usuarios", columna: "foto", sqlite: "VARCHAR(120) DEFAULT NULL", mysql: "VARCHAR(120) DEFAULT NULL" },
  { tipo: "columna", tabla: "usuarios", columna: "usa_foto", sqlite: "INTEGER NOT NULL DEFAULT 0", mysql: "INT NOT NULL DEFAULT 0" },
];

export async function up(db, motor) {
  await ejecutarPasos(db, motor, pasos);
}
