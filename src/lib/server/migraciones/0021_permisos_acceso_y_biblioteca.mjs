/*
 * Migracion 21: ajustes de permisos de roles (sin cambios de esquema).
 *
 * 1. Aprobacion de cambios de acceso sin punto unico (especificacion, seccion 9):
 *    ademas de Responsable General, los roles Coordinador/a de Mejora Continua y
 *    Coordinador/a del Area Tecnica reciben usuarios:A (aprobar altas de rol,
 *    reactivaciones y ampliaciones de vigencia). No es usuarios:G, asi que no
 *    choca con las combinaciones de roles prohibidas. No se cambia ningun otro
 *    permiso de esos roles.
 * 2. Publicar en la Biblioteca: no hay flujo de revision, asi que subir es
 *    publicar para todos. Se quita documentos:C (alcance "borrador") al Tecnico
 *    Analista y documentos:C (alcance "administrativo") a Administrador/a
 *    Auxiliar; conservan documentos:V. Quedan con permiso de subir Mejora
 *    Continua (G), Coordinacion del Area Tecnica (C/E tecnico) y Coordinacion de
 *    Investigacion y Desarrollo (C/E investigacion). Los documentos ya subidos no
 *    se tocan.
 * Es idempotente: no repite lo que ya esta hecho. Las instalaciones nuevas lo
 * reciben del catalogo (scripts/roles-catalogo.json).
 */
import { ejecutarPasos } from "./pasos.mjs";

export const version = 21;
export const nombre = "Permisos: usuarios:A en coordinaciones y publicacion en la Biblioteca";

export const pasos = [];

const AGREGAR = [
  { clave: "mejora_continua", nombre: "Coordinador/a de Mejora Continua", modulo: "usuarios", accion: "A", alcance: "total" },
  { clave: "coord_area_tecnica", nombre: "Coordinador/a del Área Técnica", modulo: "usuarios", accion: "A", alcance: "total" },
];
const QUITAR = [
  { clave: "tecnico_analista", nombre: "Técnico Analista", modulo: "documentos", accion: "C", alcance: "borrador" },
  { clave: "admin_auxiliar", nombre: "Administrador/a Auxiliar", modulo: "documentos", accion: "C", alcance: "administrativo" },
];

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
  for (const p of QUITAR) {
    const id = await idDeRol(db, p);
    if (!id) continue;
    await db.run("DELETE FROM rol_acciones WHERE id_rol = ? AND modulo = ? AND accion = ? AND alcance = ?", [id, p.modulo, p.accion, p.alcance]);
  }
}
