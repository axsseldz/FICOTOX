/*
 * Migracion 26: correcciones de la V1.
 *
 * 1. movimientos.revierte_id: al anular o reeditar un registro que consumio
 *    inventario ya no se borran sus salidas; se agrega una entrada de reversion
 *    ligada a la salida original (revierte_id = id de la salida).
 * 2. sesiones_revocadas: cerrar sesion (o el cierre por inactividad) revoca ese
 *    token en el servidor por su identificador (jti), sin cerrar las demas
 *    sesiones de la persona.
 * 3. intentos_acceso.sesion: sesion (jti) desde la que se probo una contrasena
 *    al confirmar una firma, para limitar los intentos por sesion.
 * 4. informes:E (alcance total) para Coordinador/a del Area Tecnica: edita los
 *    borradores de informe. La segregacion no cambia.
 * Solo agrega; no modifica datos historicos. Las instalaciones nuevas reciben el
 * permiso del catalogo (scripts/roles-catalogo.json).
 */
import { ejecutarPasos } from "./pasos.mjs";

export const version = 26;
export const nombre = "Correcciones V1: reversion de movimientos, sesiones revocadas e informes:E";

export const pasos = [
  { tipo: "columna", tabla: "movimientos", columna: "revierte_id", sqlite: "INTEGER DEFAULT NULL", mysql: "INT DEFAULT NULL" },
  { tipo: "indice", nombre: "idx_movimientos_revierte", tabla: "movimientos", columnas: ["revierte_id"], unico: false },
  {
    tipo: "tabla",
    nombre: "sesiones_revocadas",
    sqlite: "CREATE TABLE sesiones_revocadas (\n        jti VARCHAR(64) PRIMARY KEY,\n        usuario_id INTEGER NOT NULL,\n        motivo VARCHAR(40) NOT NULL,\n        revocada_en VARCHAR(40) NOT NULL,\n        expira_en VARCHAR(40) DEFAULT NULL\n      )",
    mysql: "CREATE TABLE IF NOT EXISTS `sesiones_revocadas` (\n        jti VARCHAR(64) NOT NULL PRIMARY KEY,\n        usuario_id INT NOT NULL,\n        motivo VARCHAR(40) NOT NULL,\n        revocada_en VARCHAR(40) NOT NULL,\n        expira_en VARCHAR(40) DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
  },
  { tipo: "columna", tabla: "intentos_acceso", columna: "sesion", sqlite: "VARCHAR(64) DEFAULT NULL", mysql: "VARCHAR(64) DEFAULT NULL" },
  { tipo: "indice", nombre: "idx_intentos_acceso_sesion", tabla: "intentos_acceso", columnas: ["sesion", "fecha"], unico: false },
];

const AGREGAR = [{ clave: "coord_area_tecnica", nombre: "Coordinador/a del Área Técnica", modulo: "informes", accion: "E", alcance: "total" }];

async function idDeRol(db, rol) {
  const fila = (await db.get("SELECT id FROM roles WHERE clave = ?", [rol.clave])) || (await db.get("SELECT id FROM roles WHERE nombre = ?", [rol.nombre]));
  return fila ? fila.id : null;
}

export async function up(db, motor) {
  await ejecutarPasos(db, motor, pasos);
  for (const p of AGREGAR) {
    const id = await idDeRol(db, p);
    if (!id) continue;
    const existe = await db.get("SELECT 1 AS x FROM rol_acciones WHERE id_rol = ? AND modulo = ? AND accion = ? AND alcance = ?", [id, p.modulo, p.accion, p.alcance]);
    if (!existe) await db.run("INSERT INTO rol_acciones (id_rol, modulo, accion, alcance) VALUES (?, ?, ?, ?)", [id, p.modulo, p.accion, p.alcance]);
  }
}
