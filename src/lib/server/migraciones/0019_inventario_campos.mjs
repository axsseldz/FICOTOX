/*
 * Migracion 19: campos del Inventario alineados con el Inventario General del laboratorio.
 *
 * Solo agrega columnas y mueve datos; no borra ni renombra nada. Las columnas
 * viejas ("Total en litros 2025", "Restante al 19/01/26", el campo combinado
 * catalogo/parte/CAS/lote, etc.) se conservan en la base y la interfaz ya no las
 * muestra ni las captura.
 * - reactivos: caducidad_indefinida (casilla "Indefinido").
 * - consumibles: id_interno, lote, localizacion, stock_minimo y observaciones.
 * - movimientos: unidad y vinculo opcional a una muestra o analisis.
 * Datos: el texto combinado catalogo/parte/CAS/lote pasa a Observaciones (sin
 * perderlo); la capacidad heredada en litros o kilos pasa a capacidad + unidad
 * (L o kg); una caducidad escrita como "Indefinido" pasa a la casilla.
 * Es idempotente: se puede repetir sin duplicar texto.
 */
import { ejecutarPasos } from "./pasos.mjs";

export const version = 19;
export const nombre = "Campos de Inventario (reactivos, consumibles y movimientos)";

export const pasos = [
  { tipo: "columna", tabla: "reactivos", columna: "caducidad_indefinida", sqlite: "INTEGER NOT NULL DEFAULT 0", mysql: "INT NOT NULL DEFAULT 0" },
  { tipo: "columna", tabla: "consumibles", columna: "id_interno", sqlite: "VARCHAR(120) DEFAULT NULL", mysql: "VARCHAR(120) DEFAULT NULL" },
  { tipo: "columna", tabla: "consumibles", columna: "lote", sqlite: "VARCHAR(120) DEFAULT NULL", mysql: "VARCHAR(120) DEFAULT NULL" },
  { tipo: "columna", tabla: "consumibles", columna: "localizacion", sqlite: "VARCHAR(180) DEFAULT NULL", mysql: "VARCHAR(180) DEFAULT NULL" },
  { tipo: "columna", tabla: "consumibles", columna: "stock_minimo", sqlite: "REAL DEFAULT NULL", mysql: "DOUBLE DEFAULT NULL" },
  { tipo: "columna", tabla: "consumibles", columna: "observaciones", sqlite: "TEXT", mysql: "LONGTEXT" },
  { tipo: "columna", tabla: "movimientos", columna: "unidad", sqlite: "VARCHAR(40) DEFAULT NULL", mysql: "VARCHAR(40) DEFAULT NULL" },
  { tipo: "columna", tabla: "movimientos", columna: "vinculo_tipo", sqlite: "VARCHAR(30) DEFAULT NULL", mysql: "VARCHAR(30) DEFAULT NULL" },
  { tipo: "columna", tabla: "movimientos", columna: "vinculo_id", sqlite: "INTEGER DEFAULT NULL", mysql: "INT DEFAULT NULL" },
];

const ROTULO = "Catálogo / parte / CAS / lote (captura anterior): ";

export async function up(db, motor) {
  await ejecutarPasos(db, motor, pasos);

  // El campo combinado pasa a Observaciones, sin perderlo.
  const combinados = await db.all("SELECT id, catalogo_parte_cas_lote AS texto, observaciones FROM reactivos WHERE catalogo_parte_cas_lote IS NOT NULL AND TRIM(catalogo_parte_cas_lote) <> ''");
  for (const fila of combinados) {
    const texto = String(fila.texto).trim();
    const previas = String(fila.observaciones || "").trim();
    if (previas.includes(texto)) continue;
    const nuevo = previas ? `${previas}\n${ROTULO}${texto}` : `${ROTULO}${texto}`;
    await db.run("UPDATE reactivos SET observaciones = ? WHERE id = ?", [nuevo, fila.id]);
  }

  // Capacidad heredada (litros o kilos) -> capacidad + unidad.
  await db.run("UPDATE reactivos SET capacidad = capacidad_litros, unidad_capacidad = 'L' WHERE capacidad IS NULL AND capacidad_litros IS NOT NULL");
  await db.run("UPDATE reactivos SET capacidad = capacidad_kilos, unidad_capacidad = 'kg' WHERE capacidad IS NULL AND capacidad_kilos IS NOT NULL");
  await db.run("UPDATE reactivos SET unidad_capacidad = 'L' WHERE LOWER(unidad_capacidad) IN ('litros', 'litro', 'l')");
  await db.run("UPDATE reactivos SET unidad_capacidad = 'kg' WHERE LOWER(unidad_capacidad) IN ('kilos', 'kilo', 'kilogramos')");

  // Caducidad escrita como "Indefinido" -> casilla.
  await db.run("UPDATE reactivos SET caducidad_indefinida = 1 WHERE caducidad_indefinida = 0 AND LOWER(TRIM(COALESCE(CAST(caducidad AS CHAR), ''))) IN ('indefinido', 'indefinida')");
}
