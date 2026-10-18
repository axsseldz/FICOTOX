/*
 * Migracion 13: Biblioteca de documentos (decision confirmada por el
 * laboratorio: Calidad › Documentos funciona como biblioteca de consulta y
 * reemplaza el flujo de control documental de la seccion 6 de la especificacion).
 *
 * - Tablas nuevas: biblioteca_categorias (con las categorias iniciales),
 *   biblioteca_documentos, biblioteca_visibilidad_roles y biblioteca_versiones.
 * - Copia a la biblioteca los documentos del flujo anterior que tienen archivo:
 *   por clave, el elemento es la revision vigente (o la mas reciente) y las
 *   revisiones anteriores con archivo pasan como versiones anteriores. El
 *   archivo se copia a <instancia>/biblioteca/<documento_id>/<uuid>.<ext> y se
 *   conserva el SHA-256 registrado. Las tablas del flujo anterior no se tocan.
 *
 * El checksum solo cubre los pasos declarativos; la copia de datos es
 * idempotente (origen_sgc_clave / origen_sgc_id) y no cambia el esquema.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ejecutarPasos } from "./pasos.mjs";

export const version = 13;
export const nombre = "Biblioteca de documentos (reemplaza el flujo de Documentos SGC)";

export const pasos = [
  {
    tipo: "tabla",
    nombre: "biblioteca_categorias",
    sqlite: `CREATE TABLE biblioteca_categorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nombre VARCHAR(80) NOT NULL UNIQUE, orden INTEGER NOT NULL DEFAULT 0, activa INTEGER NOT NULL DEFAULT 1)`,
    mysql: `CREATE TABLE IF NOT EXISTS biblioteca_categorias (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(80) NOT NULL, orden INT NOT NULL DEFAULT 0, activa INT NOT NULL DEFAULT 1,
      UNIQUE KEY uq_biblioteca_categorias_nombre (nombre)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    tipo: "tabla",
    nombre: "biblioteca_documentos",
    sqlite: `CREATE TABLE biblioteca_documentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo VARCHAR(220) NOT NULL,
      descripcion TEXT,
      categoria_id INTEGER DEFAULT NULL,
      clave VARCHAR(60) DEFAULT NULL,
      etiquetas TEXT,
      fecha_documento DATE DEFAULT NULL,
      visibilidad VARCHAR(10) NOT NULL DEFAULT 'todos',
      version_actual_id INTEGER DEFAULT NULL,
      creado_por INTEGER DEFAULT NULL,
      creado_en VARCHAR(40) NOT NULL,
      actualizado_por INTEGER DEFAULT NULL,
      actualizado_en VARCHAR(40) DEFAULT NULL,
      archivado_en VARCHAR(40) DEFAULT NULL,
      archivado_por INTEGER DEFAULT NULL,
      motivo_archivo TEXT,
      origen_sgc_clave VARCHAR(60) DEFAULT NULL)`,
    mysql: `CREATE TABLE IF NOT EXISTS biblioteca_documentos (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      titulo VARCHAR(220) NOT NULL,
      descripcion LONGTEXT,
      categoria_id INT DEFAULT NULL,
      clave VARCHAR(60) DEFAULT NULL,
      etiquetas LONGTEXT,
      fecha_documento DATE DEFAULT NULL,
      visibilidad VARCHAR(10) NOT NULL DEFAULT 'todos',
      version_actual_id INT DEFAULT NULL,
      creado_por INT DEFAULT NULL,
      creado_en VARCHAR(40) NOT NULL,
      actualizado_por INT DEFAULT NULL,
      actualizado_en VARCHAR(40) DEFAULT NULL,
      archivado_en VARCHAR(40) DEFAULT NULL,
      archivado_por INT DEFAULT NULL,
      motivo_archivo LONGTEXT,
      origen_sgc_clave VARCHAR(60) DEFAULT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    tipo: "tabla",
    nombre: "biblioteca_visibilidad_roles",
    sqlite: `CREATE TABLE biblioteca_visibilidad_roles (id INTEGER PRIMARY KEY AUTOINCREMENT, documento_id INTEGER NOT NULL, rol_id INTEGER NOT NULL)`,
    mysql: `CREATE TABLE IF NOT EXISTS biblioteca_visibilidad_roles (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, documento_id INT NOT NULL, rol_id INT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    tipo: "tabla",
    nombre: "biblioteca_versiones",
    sqlite: `CREATE TABLE biblioteca_versiones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      documento_id INTEGER NOT NULL,
      numero INTEGER NOT NULL,
      nombre_original VARCHAR(255) NOT NULL,
      nombre_almacenado VARCHAR(255) NOT NULL,
      mime VARCHAR(120) NOT NULL,
      extension VARCHAR(10) NOT NULL,
      tamano_bytes INTEGER NOT NULL,
      sha256 VARCHAR(64) NOT NULL,
      nota_version TEXT,
      texto TEXT,
      subido_por INTEGER DEFAULT NULL,
      subido_en VARCHAR(40) NOT NULL,
      origen_sgc_id INTEGER DEFAULT NULL)`,
    mysql: `CREATE TABLE IF NOT EXISTS biblioteca_versiones (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      documento_id INT NOT NULL,
      numero INT NOT NULL,
      nombre_original VARCHAR(255) NOT NULL,
      nombre_almacenado VARCHAR(255) NOT NULL,
      mime VARCHAR(120) NOT NULL,
      extension VARCHAR(10) NOT NULL,
      tamano_bytes INT NOT NULL,
      sha256 VARCHAR(64) NOT NULL,
      nota_version LONGTEXT,
      texto LONGTEXT,
      subido_por INT DEFAULT NULL,
      subido_en VARCHAR(40) NOT NULL,
      origen_sgc_id INT DEFAULT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  { tipo: "indice", nombre: "uq_biblioteca_versiones_numero", tabla: "biblioteca_versiones", columnas: ["documento_id", "numero"], unico: true },
  { tipo: "indice", nombre: "idx_biblioteca_versiones_sha256", tabla: "biblioteca_versiones", columnas: ["sha256"], unico: false },
  { tipo: "indice", nombre: "uq_biblioteca_visibilidad", tabla: "biblioteca_visibilidad_roles", columnas: ["documento_id", "rol_id"], unico: true },
  { tipo: "indice", nombre: "idx_biblioteca_documentos_categoria", tabla: "biblioteca_documentos", columnas: ["categoria_id"], unico: false },
  {
    tipo: "catalogo",
    tabla: "biblioteca_categorias",
    clave: "nombre",
    filas: [
      { nombre: "Manual de Calidad", orden: 1, activa: 1 },
      { nombre: "Procedimientos", orden: 2, activa: 1 },
      { nombre: "Instructivos", orden: 3, activa: 1 },
      { nombre: "Formatos", orden: 4, activa: 1 },
      { nombre: "Normas y regulación", orden: 5, activa: 1 },
      { nombre: "Artículos y referencias", orden: 6, activa: 1 },
      { nombre: "Otros", orden: 7, activa: 1 },
    ],
  },
];

/* Tipo de documento del flujo anterior -> categoria de la biblioteca. */
const CATEGORIA_POR_TIPO = { M: "Manual de Calidad", P: "Procedimientos", I: "Instructivos", F: "Formatos", R: "Formatos", B: "Formatos", L: "Otros", E: "Normas y regulación" };
const MIME = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", tif: "image/tiff", tiff: "image/tiff", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", csv: "text/csv; charset=utf-8", txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8", zip: "application/zip" };
const extensionDe = (nombre) => {
  const limpio = String(nombre || "").trim();
  const punto = limpio.lastIndexOf(".");
  return punto > 0 ? limpio.slice(punto + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) : "bin";
};
const ahora = () => new Date().toISOString();

/*
 * Copia los documentos del flujo anterior. `ctx.instanceDir` es la carpeta de
 * la instancia (archivos en documentos_sgc/); en SQLite, si no se da, es la
 * carpeta de la base. Si un archivo de origen no esta, la version se registra
 * igual con su huella: al abrirla, la biblioteca avisa (alerta de integridad).
 */
export async function copiarDocumentosSgc(db, ctx = {}) {
  const instanceDir = ctx.instanceDir || process.env.FICOTOX_INSTANCE_DIR || (db.motor === "sqlite" && db.raw?.name && db.raw.name !== ":memory:" ? path.dirname(db.raw.name) : null);
  const filas = await db.all("SELECT * FROM documentos_sgc WHERE archivo_nombre IS NOT NULL AND archivo_nombre <> '' ORDER BY clave, revision, id");
  if (!filas.length) return { documentos: 0, versiones: 0 };
  const categorias = Object.fromEntries((await db.all("SELECT id, nombre FROM biblioteca_categorias")).map((c) => [c.nombre, c.id]));
  const grupos = new Map();
  for (const f of filas) {
    const clave = String(f.clave || `sin-clave-${f.id}`);
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(f);
  }
  const origenDir = instanceDir ? path.join(instanceDir, "documentos_sgc") : null;
  const destinoRaiz = instanceDir ? path.join(instanceDir, "biblioteca") : null;
  const copiados = [];
  let nDocs = 0;
  let nVers = 0;
  try {
    for (const [clave, grupo] of grupos) {
      if (await db.get("SELECT id FROM biblioteca_documentos WHERE origen_sgc_clave = ?", [clave])) continue;
      const vigentes = grupo.filter((g) => String(g.estado) === "vigente");
      const elegido = vigentes.length ? vigentes[vigentes.length - 1] : grupo[grupo.length - 1];
      const versiones = grupo.filter((g) => Number(g.revision) <= Number(elegido.revision) && Number(g.id) !== Number(elegido.id)).concat([elegido]);
      const creado = String(grupo[0].creado_en || ahora());
      const doc = await db.run(
        `INSERT INTO biblioteca_documentos (titulo, descripcion, categoria_id, clave, etiquetas, fecha_documento, visibilidad, creado_por, creado_en, actualizado_por, actualizado_en, origen_sgc_clave)
         VALUES (?, ?, ?, ?, ?, ?, 'todos', ?, ?, ?, ?, ?)`,
        [String(elegido.titulo || clave).slice(0, 220), elegido.descripcion || null, categorias[CATEGORIA_POR_TIPO[String(elegido.tipo)] || "Otros"] || null, String(elegido.clave || "").slice(0, 60) || null, "[]", elegido.fecha_vigencia || elegido.fecha_emision || null, elegido.creado_por ?? null, creado, elegido.actualizado_por ?? null, String(elegido.actualizado_en || creado), clave],
      );
      const docId = doc.id;
      let actualId = null;
      for (let i = 0; i < versiones.length; i += 1) {
        const v = versiones[i];
        const original = String(v.archivo_original || v.archivo_nombre);
        const ext = extensionDe(original) || extensionDe(v.archivo_nombre);
        const almacenado = `${docId}/${randomUUID()}.${ext}`;
        let sha = v.archivo_sha256 ? String(v.archivo_sha256) : "";
        let tamano = 0;
        if (origenDir && destinoRaiz) {
          const origen = path.resolve(origenDir, String(v.archivo_nombre));
          if (origen.startsWith(path.resolve(origenDir) + path.sep) && fs.existsSync(origen)) {
            const bytes = fs.readFileSync(origen);
            const destino = path.join(destinoRaiz, almacenado);
            fs.mkdirSync(path.dirname(destino), { recursive: true });
            fs.writeFileSync(destino, bytes, { mode: 0o640 });
            copiados.push(destino);
            tamano = bytes.length;
            // Se conserva la huella registrada; si no la habia, la del archivo copiado.
            if (!sha) sha = createHash("sha256").update(bytes).digest("hex");
          }
        }
        const r = await db.run(
          `INSERT INTO biblioteca_versiones (documento_id, numero, nombre_original, nombre_almacenado, mime, extension, tamano_bytes, sha256, nota_version, subido_por, subido_en, origen_sgc_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [docId, i + 1, original.slice(0, 255), almacenado, MIME[ext] || "application/octet-stream", ext, tamano, sha || "sin-huella", `Revisión ${v.revision} (copiada de Documentos SGC)`, v.creado_por ?? null, String(v.actualizado_en || v.creado_en || creado), v.id],
        );
        if (Number(v.id) === Number(elegido.id)) actualId = r.id;
        nVers += 1;
      }
      await db.run("UPDATE biblioteca_documentos SET version_actual_id = ? WHERE id = ?", [actualId, docId]);
      nDocs += 1;
    }
  } catch (error) {
    // Si la migracion falla, no quedan copias huerfanas.
    for (const ruta of copiados) fs.rmSync(ruta, { force: true });
    throw error;
  }
  return { documentos: nDocs, versiones: nVers };
}

export async function up(db, motor, ctx = {}) {
  await ejecutarPasos(db, motor, pasos);
  await copiarDocumentosSgc(db, ctx);
}
