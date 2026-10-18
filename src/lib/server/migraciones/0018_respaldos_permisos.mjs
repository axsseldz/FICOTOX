/*
 * Migracion 18: modulo de permisos "respaldos" (Calidad › Respaldos).
 *
 * No cambia el esquema: asigna el modulo nuevo a los roles del catalogo.
 * - Administrador tecnico del sistema: ver y administrar (V y G).
 * - Responsable General, Coordinador/a de Mejora Continua y Auditor Interno:
 *   solo ver (V).
 * Ningun otro rol lo recibe. Es idempotente: no repite una fila que ya existe.
 * Las instalaciones nuevas lo reciben del catalogo (scripts/roles-catalogo.json).
 */
import { ejecutarPasos } from "./pasos.mjs";

export const version = 18;
export const nombre = "Permisos del modulo Respaldos (Calidad › Respaldos)";

export const pasos = [];

const ASIGNACION = [
  { clave: "admin_tecnico", nombre: "Administrador técnico del sistema", acciones: ["V", "G"] },
  { clave: "responsable_general", nombre: "Responsable General", acciones: ["V"] },
  { clave: "mejora_continua", nombre: "Coordinador/a de Mejora Continua", acciones: ["V"] },
  { clave: "auditor_interno", nombre: "Auditor Interno", acciones: ["V"] },
];

export async function up(db, motor) {
  await ejecutarPasos(db, motor, pasos);
  for (const rol of ASIGNACION) {
    const fila = (await db.get("SELECT id FROM roles WHERE clave = ?", [rol.clave])) || (await db.get("SELECT id FROM roles WHERE nombre = ?", [rol.nombre]));
    if (!fila) continue;
    for (const accion of rol.acciones) {
      const existe = await db.get("SELECT 1 AS x FROM rol_acciones WHERE id_rol = ? AND modulo = 'respaldos' AND accion = ? AND alcance = 'total'", [fila.id, accion]);
      if (!existe) await db.run("INSERT INTO rol_acciones (id_rol, modulo, accion, alcance) VALUES (?, 'respaldos', ?, 'total')", [fila.id, accion]);
    }
  }
}
