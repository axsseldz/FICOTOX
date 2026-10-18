/*
 * Migracion 22: Documentos SGC, nucleo documental (Fase 1 del modulo; la
 * especificacion del modulo de gestion documental reemplaza a la Biblioteca).
 *
 * - Catalogos sembrados: sgc_areas (codigo, nombre, color HEX, orden, activo)
 *   y sgc_tipos (M, P, F, L, I, B, R). El color identifica el area, nunca el estado.
 * - sgc_documentos (ficha maestra, clave FX unica y normalizada),
 *   sgc_revisiones (una vigente por documento: indice unico parcial en SQLite,
 *   columna generada con indice unico en MySQL) y sgc_archivos (fuente y PDF de
 *   consulta, con SHA-256; disparadores impiden agregar o cambiar archivos de
 *   una revision que ya no esta en borrador y borrar cualquiera).
 * - Tablas vacias para las fases 2 y 3: sgc_flujo_acciones, sgc_solicitudes,
 *   sgc_externos, sgc_distribucion y sgc_lecturas.
 * - Permisos: el modulo "documentos" deja V/C/E/R/A/AN/G (Biblioteca) y pasa a
 *   acciones documentales. Se borran sus filas anteriores de rol_acciones y se
 *   asignan las nuevas a los roles del catalogo (por clave). Un rol fuera del
 *   catalogo que tenia documentos:G recibe todas; si tenia cualquier otra,
 *   documento_consultar_vigente. En MySQL rol_acciones.accion pasa a VARCHAR(40).
 * - La Biblioteca (biblioteca_*) y el flujo anterior (documentos_sgc) no se
 *   tocan: quedan sin uso, con sus archivos.
 *
 * El checksum cubre los pasos declarativos; los indices parciales o generados
 * y los permisos se hacen en up() y son idempotentes.
 */
import { ejecutarPasos } from "./pasos.mjs";

export const version = 22;
export const nombre = "Documentos SGC: nucleo documental (catalogos, fichas, revisiones, archivos y permisos por accion)";

const MSG_INMUTABLE = "La revision ya no esta en borrador: sus archivos no se pueden agregar ni cambiar";
const MSG_SIN_BORRAR = "Los archivos de los documentos no se eliminan";

export const pasos = [
  {
    tipo: "tabla",
    nombre: "sgc_areas",
    sqlite: `CREATE TABLE sgc_areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, codigo VARCHAR(4) NOT NULL UNIQUE, nombre VARCHAR(80) NOT NULL,
      color VARCHAR(7) NOT NULL, orden INTEGER NOT NULL DEFAULT 0, activo INTEGER NOT NULL DEFAULT 1)`,
    mysql: `CREATE TABLE IF NOT EXISTS sgc_areas (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(4) NOT NULL, nombre VARCHAR(80) NOT NULL,
      color VARCHAR(7) NOT NULL, orden INT NOT NULL DEFAULT 0, activo INT NOT NULL DEFAULT 1,
      UNIQUE KEY uq_sgc_areas_codigo (codigo)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    tipo: "catalogo",
    tabla: "sgc_areas",
    clave: "codigo",
    filas: [
      { codigo: "GC", nombre: "Gestión de Calidad", color: "#9852B0", orden: 1, activo: 1 },
      { codigo: "TH", nombre: "Gestión de Talento Humano", color: "#913B0B", orden: 2, activo: 1 },
      { codigo: "AD", nombre: "Gestión Administrativa", color: "#E53BB9", orden: 3, activo: 1 },
      { codigo: "CO", nombre: "Gestión Comercial", color: "#E36A10", orden: 4, activo: 1 },
      { codigo: "TC", nombre: "Gestión Técnica", color: "#429B4B", orden: 5, activo: 1 },
      { codigo: "DI", nombre: "Documentos rectores", color: "#217FCB", orden: 6, activo: 1 },
    ],
  },
  {
    tipo: "tabla",
    nombre: "sgc_tipos",
    sqlite: `CREATE TABLE sgc_tipos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, codigo VARCHAR(2) NOT NULL UNIQUE, nombre VARCHAR(60) NOT NULL,
      descripcion TEXT, flujo_predeterminado VARCHAR(40) NOT NULL DEFAULT 'estandar', orden INTEGER NOT NULL DEFAULT 0, activo INTEGER NOT NULL DEFAULT 1)`,
    mysql: `CREATE TABLE IF NOT EXISTS sgc_tipos (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(2) NOT NULL, nombre VARCHAR(60) NOT NULL,
      descripcion LONGTEXT, flujo_predeterminado VARCHAR(40) NOT NULL DEFAULT 'estandar', orden INT NOT NULL DEFAULT 0, activo INT NOT NULL DEFAULT 1,
      UNIQUE KEY uq_sgc_tipos_codigo (codigo)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    tipo: "catalogo",
    tabla: "sgc_tipos",
    clave: "codigo",
    filas: [
      { codigo: "M", nombre: "Manual", descripcion: "Documento marco que describe el sistema, organización o lineamientos generales.", orden: 1, activo: 1 },
      { codigo: "P", nombre: "Procedimiento", descripcion: "Define responsabilidades y secuencia de actividades de un proceso.", orden: 2, activo: 1 },
      { codigo: "F", nombre: "Formato/registro", descripcion: "Plantilla controlada que, una vez completada, se convierte en registro.", orden: 3, activo: 1 },
      { codigo: "L", nombre: "Lista", descripcion: "Catálogo o relación controlada, por ejemplo listas maestras.", orden: 4, activo: 1 },
      { codigo: "I", nombre: "Instrucción", descripcion: "Describe la ejecución detallada de una actividad técnica o de apoyo.", orden: 5, activo: 1 },
      { codigo: "B", nombre: "Bitácora", descripcion: "Registro cronológico de actividades, equipos o eventos.", orden: 6, activo: 1 },
      { codigo: "R", nombre: "Reglamento/política", descripcion: "Establece disposiciones, reglas o políticas institucionales.", orden: 7, activo: 1 },
    ],
  },
  {
    tipo: "tabla",
    nombre: "sgc_documentos",
    sqlite: `CREATE TABLE sgc_documentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clave VARCHAR(80) NOT NULL UNIQUE,
      titulo VARCHAR(300) NOT NULL,
      area_codigo VARCHAR(4) NOT NULL,
      tipo_codigo VARCHAR(2) NOT NULL,
      origen VARCHAR(10) NOT NULL DEFAULT 'interno' CHECK (origen IN ('interno', 'externo')),
      proceso VARCHAR(200) DEFAULT NULL,
      confidencialidad VARCHAR(20) NOT NULL DEFAULT 'uso_interno' CHECK (confidencialidad IN ('uso_interno', 'restringido', 'confidencial')),
      palabras_clave TEXT,
      propietario_id INTEGER DEFAULT NULL,
      estado VARCHAR(20) NOT NULL DEFAULT 'en_elaboracion' CHECK (estado IN ('en_elaboracion', 'vigente', 'obsoleto')),
      revision_vigente_id INTEGER DEFAULT NULL,
      creado_por INTEGER DEFAULT NULL,
      creado_en VARCHAR(40) NOT NULL,
      actualizado_por INTEGER DEFAULT NULL,
      actualizado_en VARCHAR(40) DEFAULT NULL,
      obsoleto_en VARCHAR(40) DEFAULT NULL,
      obsoleto_por INTEGER DEFAULT NULL,
      motivo_obsolescencia TEXT)`,
    mysql: `CREATE TABLE IF NOT EXISTS sgc_documentos (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      clave VARCHAR(80) NOT NULL,
      titulo VARCHAR(300) NOT NULL,
      area_codigo VARCHAR(4) NOT NULL,
      tipo_codigo VARCHAR(2) NOT NULL,
      origen VARCHAR(10) NOT NULL DEFAULT 'interno',
      proceso VARCHAR(200) DEFAULT NULL,
      confidencialidad VARCHAR(20) NOT NULL DEFAULT 'uso_interno',
      palabras_clave LONGTEXT,
      propietario_id INT DEFAULT NULL,
      estado VARCHAR(20) NOT NULL DEFAULT 'en_elaboracion',
      revision_vigente_id INT DEFAULT NULL,
      creado_por INT DEFAULT NULL,
      creado_en VARCHAR(40) NOT NULL,
      actualizado_por INT DEFAULT NULL,
      actualizado_en VARCHAR(40) DEFAULT NULL,
      obsoleto_en VARCHAR(40) DEFAULT NULL,
      obsoleto_por INT DEFAULT NULL,
      motivo_obsolescencia LONGTEXT,
      UNIQUE KEY uq_sgc_documentos_clave (clave),
      CONSTRAINT ck_sgc_documentos_origen CHECK (origen IN ('interno', 'externo')),
      CONSTRAINT ck_sgc_documentos_conf CHECK (confidencialidad IN ('uso_interno', 'restringido', 'confidencial')),
      CONSTRAINT ck_sgc_documentos_estado CHECK (estado IN ('en_elaboracion', 'vigente', 'obsoleto'))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  { tipo: "indice", nombre: "idx_sgc_documentos_area_tipo", tabla: "sgc_documentos", columnas: ["area_codigo", "tipo_codigo"], unico: false },
  {
    tipo: "tabla",
    nombre: "sgc_revisiones",
    sqlite: `CREATE TABLE sgc_revisiones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      documento_id INTEGER NOT NULL,
      numero INTEGER NOT NULL,
      estado VARCHAR(20) NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'en_revision', 'en_autorizacion', 'autorizada', 'vigente', 'obsoleta', 'cancelada')),
      fecha_emision VARCHAR(10) DEFAULT NULL,
      fecha_vigencia VARCHAR(10) DEFAULT NULL,
      fecha_proxima_revision VARCHAR(10) DEFAULT NULL,
      motivo_cambio TEXT,
      apartados_afectados TEXT,
      descripcion_cambio TEXT,
      elaborador_id INTEGER DEFAULT NULL,
      revisor_id INTEGER DEFAULT NULL,
      autorizador_id INTEGER DEFAULT NULL,
      enviada_revision_en VARCHAR(40) DEFAULT NULL,
      enviada_revision_por INTEGER DEFAULT NULL,
      publicada_en VARCHAR(40) DEFAULT NULL,
      publicada_por INTEGER DEFAULT NULL,
      fecha_obsolescencia VARCHAR(40) DEFAULT NULL,
      ubicacion_historica TEXT,
      regla_conservacion TEXT,
      origen_registro VARCHAR(20) NOT NULL DEFAULT 'flujo',
      creado_por INTEGER DEFAULT NULL,
      creado_en VARCHAR(40) NOT NULL,
      actualizado_por INTEGER DEFAULT NULL,
      actualizado_en VARCHAR(40) DEFAULT NULL,
      UNIQUE (documento_id, numero))`,
    mysql: `CREATE TABLE IF NOT EXISTS sgc_revisiones (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      documento_id INT NOT NULL,
      numero INT NOT NULL,
      estado VARCHAR(20) NOT NULL DEFAULT 'borrador',
      fecha_emision VARCHAR(10) DEFAULT NULL,
      fecha_vigencia VARCHAR(10) DEFAULT NULL,
      fecha_proxima_revision VARCHAR(10) DEFAULT NULL,
      motivo_cambio LONGTEXT,
      apartados_afectados LONGTEXT,
      descripcion_cambio LONGTEXT,
      elaborador_id INT DEFAULT NULL,
      revisor_id INT DEFAULT NULL,
      autorizador_id INT DEFAULT NULL,
      enviada_revision_en VARCHAR(40) DEFAULT NULL,
      enviada_revision_por INT DEFAULT NULL,
      publicada_en VARCHAR(40) DEFAULT NULL,
      publicada_por INT DEFAULT NULL,
      fecha_obsolescencia VARCHAR(40) DEFAULT NULL,
      ubicacion_historica LONGTEXT,
      regla_conservacion LONGTEXT,
      origen_registro VARCHAR(20) NOT NULL DEFAULT 'flujo',
      creado_por INT DEFAULT NULL,
      creado_en VARCHAR(40) NOT NULL,
      actualizado_por INT DEFAULT NULL,
      actualizado_en VARCHAR(40) DEFAULT NULL,
      UNIQUE KEY uq_sgc_revisiones_numero (documento_id, numero),
      CONSTRAINT ck_sgc_revisiones_estado CHECK (estado IN ('borrador', 'en_revision', 'en_autorizacion', 'autorizada', 'vigente', 'obsoleta', 'cancelada'))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  { tipo: "indice", nombre: "idx_sgc_revisiones_estado", tabla: "sgc_revisiones", columnas: ["estado"], unico: false },
  {
    tipo: "tabla",
    nombre: "sgc_archivos",
    sqlite: `CREATE TABLE sgc_archivos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      revision_id INTEGER NOT NULL,
      tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('fuente', 'pdf')),
      nombre_original VARCHAR(255) NOT NULL,
      nombre_almacenado VARCHAR(255) NOT NULL UNIQUE,
      extension VARCHAR(10) NOT NULL,
      mime VARCHAR(120) NOT NULL,
      tamano_bytes INTEGER NOT NULL,
      sha256 VARCHAR(64) NOT NULL,
      subido_por INTEGER DEFAULT NULL,
      subido_en VARCHAR(40) NOT NULL,
      reemplazado_en VARCHAR(40) DEFAULT NULL,
      reemplazado_por INTEGER DEFAULT NULL)`,
    mysql: `CREATE TABLE IF NOT EXISTS sgc_archivos (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      revision_id INT NOT NULL,
      tipo VARCHAR(10) NOT NULL,
      nombre_original VARCHAR(255) NOT NULL,
      nombre_almacenado VARCHAR(255) NOT NULL,
      extension VARCHAR(10) NOT NULL,
      mime VARCHAR(120) NOT NULL,
      tamano_bytes BIGINT NOT NULL,
      sha256 VARCHAR(64) NOT NULL,
      subido_por INT DEFAULT NULL,
      subido_en VARCHAR(40) NOT NULL,
      reemplazado_en VARCHAR(40) DEFAULT NULL,
      reemplazado_por INT DEFAULT NULL,
      UNIQUE KEY uq_sgc_archivos_almacenado (nombre_almacenado),
      CONSTRAINT ck_sgc_archivos_tipo CHECK (tipo IN ('fuente', 'pdf'))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  { tipo: "indice", nombre: "idx_sgc_archivos_revision", tabla: "sgc_archivos", columnas: ["revision_id"], unico: false },
  {
    tipo: "trigger",
    nombre: "sgc_archivos_solo_borrador_ins",
    tabla: "sgc_archivos",
    sqlite: `CREATE TRIGGER sgc_archivos_solo_borrador_ins BEFORE INSERT ON sgc_archivos
      WHEN COALESCE((SELECT estado FROM sgc_revisiones WHERE id = NEW.revision_id), '') <> 'borrador'
      BEGIN SELECT RAISE(ABORT, '${MSG_INMUTABLE}'); END`,
    mysql: `CREATE TRIGGER sgc_archivos_solo_borrador_ins BEFORE INSERT ON sgc_archivos FOR EACH ROW
      BEGIN IF COALESCE((SELECT estado FROM sgc_revisiones WHERE id = NEW.revision_id), '') <> 'borrador' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${MSG_INMUTABLE}'; END IF; END`,
  },
  {
    tipo: "trigger",
    nombre: "sgc_archivos_solo_borrador_upd",
    tabla: "sgc_archivos",
    sqlite: `CREATE TRIGGER sgc_archivos_solo_borrador_upd BEFORE UPDATE ON sgc_archivos
      WHEN COALESCE((SELECT estado FROM sgc_revisiones WHERE id = OLD.revision_id), '') <> 'borrador'
        OR NEW.revision_id <> OLD.revision_id OR NEW.sha256 <> OLD.sha256 OR NEW.nombre_almacenado <> OLD.nombre_almacenado
      BEGIN SELECT RAISE(ABORT, '${MSG_INMUTABLE}'); END`,
    mysql: `CREATE TRIGGER sgc_archivos_solo_borrador_upd BEFORE UPDATE ON sgc_archivos FOR EACH ROW
      BEGIN IF COALESCE((SELECT estado FROM sgc_revisiones WHERE id = OLD.revision_id), '') <> 'borrador'
        OR NEW.revision_id <> OLD.revision_id OR NEW.sha256 <> OLD.sha256 OR NEW.nombre_almacenado <> OLD.nombre_almacenado
      THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${MSG_INMUTABLE}'; END IF; END`,
  },
  {
    tipo: "trigger",
    nombre: "sgc_archivos_sin_delete",
    tabla: "sgc_archivos",
    sqlite: `CREATE TRIGGER sgc_archivos_sin_delete BEFORE DELETE ON sgc_archivos BEGIN SELECT RAISE(ABORT, '${MSG_SIN_BORRAR}'); END`,
    mysql: `CREATE TRIGGER sgc_archivos_sin_delete BEFORE DELETE ON sgc_archivos FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${MSG_SIN_BORRAR}'`,
  },
  // ---------- Fases 2 y 3 (vacias por ahora) ----------
  {
    tipo: "tabla",
    nombre: "sgc_flujo_acciones",
    sqlite: `CREATE TABLE sgc_flujo_acciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT, revision_id INTEGER NOT NULL, accion VARCHAR(40) NOT NULL, decision VARCHAR(20) DEFAULT NULL,
      comentario TEXT, usuario_id INTEGER DEFAULT NULL, cargo VARCHAR(120) DEFAULT NULL, fecha VARCHAR(40) NOT NULL)`,
    mysql: `CREATE TABLE IF NOT EXISTS sgc_flujo_acciones (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, revision_id INT NOT NULL, accion VARCHAR(40) NOT NULL, decision VARCHAR(20) DEFAULT NULL,
      comentario LONGTEXT, usuario_id INT DEFAULT NULL, cargo VARCHAR(120) DEFAULT NULL, fecha VARCHAR(40) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  { tipo: "indice", nombre: "idx_sgc_flujo_revision", tabla: "sgc_flujo_acciones", columnas: ["revision_id"], unico: false },
  {
    tipo: "tabla",
    nombre: "sgc_solicitudes",
    sqlite: `CREATE TABLE sgc_solicitudes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tipo VARCHAR(20) NOT NULL, documento_id INTEGER DEFAULT NULL, area_codigo VARCHAR(4) DEFAULT NULL,
      tipo_codigo VARCHAR(2) DEFAULT NULL, titulo_propuesto VARCHAR(300) DEFAULT NULL, necesidad TEXT, justificacion TEXT,
      solicitante_id INTEGER DEFAULT NULL, estado VARCHAR(20) NOT NULL DEFAULT 'pendiente', resuelta_por INTEGER DEFAULT NULL,
      resuelta_en VARCHAR(40) DEFAULT NULL, comentario_resolucion TEXT, revision_id INTEGER DEFAULT NULL,
      apoyo_nombre_original VARCHAR(255) DEFAULT NULL, apoyo_nombre_almacenado VARCHAR(255) DEFAULT NULL, apoyo_sha256 VARCHAR(64) DEFAULT NULL,
      apoyo_tamano_bytes INTEGER DEFAULT NULL, apoyo_mime VARCHAR(120) DEFAULT NULL, creado_en VARCHAR(40) NOT NULL)`,
    mysql: `CREATE TABLE IF NOT EXISTS sgc_solicitudes (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, tipo VARCHAR(20) NOT NULL, documento_id INT DEFAULT NULL, area_codigo VARCHAR(4) DEFAULT NULL,
      tipo_codigo VARCHAR(2) DEFAULT NULL, titulo_propuesto VARCHAR(300) DEFAULT NULL, necesidad LONGTEXT, justificacion LONGTEXT,
      solicitante_id INT DEFAULT NULL, estado VARCHAR(20) NOT NULL DEFAULT 'pendiente', resuelta_por INT DEFAULT NULL,
      resuelta_en VARCHAR(40) DEFAULT NULL, comentario_resolucion LONGTEXT, revision_id INT DEFAULT NULL,
      apoyo_nombre_original VARCHAR(255) DEFAULT NULL, apoyo_nombre_almacenado VARCHAR(255) DEFAULT NULL, apoyo_sha256 VARCHAR(64) DEFAULT NULL,
      apoyo_tamano_bytes BIGINT DEFAULT NULL, apoyo_mime VARCHAR(120) DEFAULT NULL, creado_en VARCHAR(40) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    tipo: "tabla",
    nombre: "sgc_externos",
    sqlite: `CREATE TABLE sgc_externos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, documento_id INTEGER NOT NULL UNIQUE, fuente VARCHAR(200) DEFAULT NULL, version_fecha VARCHAR(80) DEFAULT NULL,
      enlace TEXT, responsable_id INTEGER DEFAULT NULL, proxima_revision VARCHAR(10) DEFAULT NULL, ultima_revision VARCHAR(10) DEFAULT NULL,
      creado_en VARCHAR(40) NOT NULL, actualizado_en VARCHAR(40) DEFAULT NULL)`,
    mysql: `CREATE TABLE IF NOT EXISTS sgc_externos (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, documento_id INT NOT NULL, fuente VARCHAR(200) DEFAULT NULL, version_fecha VARCHAR(80) DEFAULT NULL,
      enlace LONGTEXT, responsable_id INT DEFAULT NULL, proxima_revision VARCHAR(10) DEFAULT NULL, ultima_revision VARCHAR(10) DEFAULT NULL,
      creado_en VARCHAR(40) NOT NULL, actualizado_en VARCHAR(40) DEFAULT NULL, UNIQUE KEY uq_sgc_externos_documento (documento_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    tipo: "tabla",
    nombre: "sgc_distribucion",
    sqlite: `CREATE TABLE sgc_distribucion (
      id INTEGER PRIMARY KEY AUTOINCREMENT, revision_id INTEGER NOT NULL, rol_id INTEGER DEFAULT NULL, usuario_id INTEGER DEFAULT NULL,
      punto_uso VARCHAR(200) DEFAULT NULL, requiere_lectura INTEGER NOT NULL DEFAULT 0, creado_por INTEGER DEFAULT NULL, creado_en VARCHAR(40) NOT NULL,
      retirado_en VARCHAR(40) DEFAULT NULL, retirado_por INTEGER DEFAULT NULL)`,
    mysql: `CREATE TABLE IF NOT EXISTS sgc_distribucion (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, revision_id INT NOT NULL, rol_id INT DEFAULT NULL, usuario_id INT DEFAULT NULL,
      punto_uso VARCHAR(200) DEFAULT NULL, requiere_lectura INT NOT NULL DEFAULT 0, creado_por INT DEFAULT NULL, creado_en VARCHAR(40) NOT NULL,
      retirado_en VARCHAR(40) DEFAULT NULL, retirado_por INT DEFAULT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  { tipo: "indice", nombre: "idx_sgc_distribucion_revision", tabla: "sgc_distribucion", columnas: ["revision_id"], unico: false },
  {
    tipo: "tabla",
    nombre: "sgc_lecturas",
    sqlite: `CREATE TABLE sgc_lecturas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, revision_id INTEGER NOT NULL, usuario_id INTEGER NOT NULL, notificado_en VARCHAR(40) DEFAULT NULL,
      leido_en VARCHAR(40) DEFAULT NULL, estado VARCHAR(20) NOT NULL DEFAULT 'pendiente', UNIQUE (revision_id, usuario_id))`,
    mysql: `CREATE TABLE IF NOT EXISTS sgc_lecturas (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, revision_id INT NOT NULL, usuario_id INT NOT NULL, notificado_en VARCHAR(40) DEFAULT NULL,
      leido_en VARCHAR(40) DEFAULT NULL, estado VARCHAR(20) NOT NULL DEFAULT 'pendiente', UNIQUE KEY uq_sgc_lecturas (revision_id, usuario_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
];

/* Asignacion inicial de acciones documentales por rol del catalogo (clave estable). */
const TODAS = [
  "documento_consultar_vigente", "documento_proponer", "documento_crear_ficha", "documento_elaborar", "documento_enviar_revision", "documento_revisar", "documento_autorizar",
  "documento_publicar", "documento_obsoletar", "documento_consultar_historico", "documento_acusar_lectura", "documento_administrar_lecturas", "documento_externo_gestionar", "lista_maestra_exportar",
];
const PERSONAL = ["documento_consultar_vigente", "documento_proponer", "documento_elaborar", "documento_enviar_revision", "documento_acusar_lectura"];
export const ASIGNACION_DOCUMENTAL = [
  { clave: "mejora_continua", nombre: "Coordinador/a de Mejora Continua", acciones: TODAS },
  { clave: "responsable_general", nombre: "Responsable General", acciones: ["documento_consultar_vigente", "documento_proponer", "documento_autorizar", "documento_consultar_historico", "documento_acusar_lectura", "lista_maestra_exportar"] },
  { clave: "coord_area_tecnica", nombre: "Coordinador/a del Área Técnica", acciones: ["documento_consultar_vigente", "documento_proponer", "documento_elaborar", "documento_enviar_revision", "documento_revisar", "documento_autorizar", "documento_consultar_historico", "documento_acusar_lectura"] },
  { clave: "coord_investigacion", nombre: "Coordinador/a de Investigación y Desarrollo", acciones: ["documento_consultar_vigente", "documento_proponer", "documento_elaborar", "documento_enviar_revision", "documento_revisar", "documento_consultar_historico", "documento_acusar_lectura"] },
  { clave: "tecnico_analista", nombre: "Técnico Analista", acciones: PERSONAL },
  { clave: "tecnico_auxiliar", nombre: "Técnico Auxiliar", acciones: PERSONAL },
  { clave: "admin_auxiliar", nombre: "Administrador/a Auxiliar", acciones: PERSONAL },
  { clave: "auditor_interno", nombre: "Auditor Interno", acciones: ["documento_consultar_vigente", "documento_consultar_historico", "lista_maestra_exportar"] },
  { clave: "estudiante", nombre: "Estudiante / personal en formación", acciones: ["documento_consultar_vigente", "documento_acusar_lectura"] },
  // Administrador tecnico: ninguna (ve metadatos para diagnostico por usuarios:G, sin abrir archivos).
  { clave: "admin_tecnico", nombre: "Administrador técnico del sistema", acciones: [] },
];

async function existeIndice(db, motor, tabla, nombreIndice) {
  if (motor === "sqlite") return !!(await db.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'index' AND name = ?", [nombreIndice]));
  return !!(await db.get("SELECT 1 AS x FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?", [tabla, nombreIndice]));
}

async function existeColumna(db, motor, tabla, columna) {
  if (motor === "sqlite") return (await db.all(`PRAGMA table_info(${tabla})`)).some((c) => c.name === columna);
  return !!(await db.get("SELECT 1 AS x FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?", [tabla, columna]));
}

export async function up(db, motor) {
  await ejecutarPasos(db, motor, pasos);

  // Solo una revision vigente por documento (y un archivo activo de cada tipo por revision).
  if (motor === "sqlite") {
    if (!(await existeIndice(db, motor, "sgc_revisiones", "uq_sgc_revisiones_vigente"))) await db.exec("CREATE UNIQUE INDEX uq_sgc_revisiones_vigente ON sgc_revisiones (documento_id) WHERE estado = 'vigente'");
    if (!(await existeIndice(db, motor, "sgc_archivos", "uq_sgc_archivos_activo"))) await db.exec("CREATE UNIQUE INDEX uq_sgc_archivos_activo ON sgc_archivos (revision_id, tipo) WHERE reemplazado_en IS NULL");
  } else {
    if (!(await existeColumna(db, motor, "sgc_revisiones", "vigente_de"))) await db.exec("ALTER TABLE sgc_revisiones ADD COLUMN vigente_de INT GENERATED ALWAYS AS (CASE WHEN estado = 'vigente' THEN documento_id ELSE NULL END) VIRTUAL");
    if (!(await existeIndice(db, motor, "sgc_revisiones", "uq_sgc_revisiones_vigente"))) await db.exec("CREATE UNIQUE INDEX uq_sgc_revisiones_vigente ON sgc_revisiones (vigente_de)");
    if (!(await existeColumna(db, motor, "sgc_archivos", "activo_de"))) await db.exec("ALTER TABLE sgc_archivos ADD COLUMN activo_de VARCHAR(30) GENERATED ALWAYS AS (CASE WHEN reemplazado_en IS NULL THEN CONCAT(revision_id, ':', tipo) ELSE NULL END) VIRTUAL");
    if (!(await existeIndice(db, motor, "sgc_archivos", "uq_sgc_archivos_activo"))) await db.exec("CREATE UNIQUE INDEX uq_sgc_archivos_activo ON sgc_archivos (activo_de)");
    // Las acciones documentales no caben en VARCHAR(4).
    await db.exec("ALTER TABLE rol_acciones MODIFY accion VARCHAR(40) NOT NULL");
  }

  // Permisos: las filas anteriores de "documentos" (Biblioteca) se sustituyen por acciones documentales.
  const anteriores = await db.all("SELECT id_rol, accion FROM rol_acciones WHERE modulo = 'documentos'");
  const yaMigrado = anteriores.some((f) => String(f.accion).startsWith("documento_") || f.accion === "lista_maestra_exportar");
  if (yaMigrado) return;
  const nuevas = new Map();
  const roles = await db.all("SELECT id, clave, nombre FROM roles");
  for (const rol of roles) {
    const def = ASIGNACION_DOCUMENTAL.find((a) => (rol.clave && a.clave === rol.clave) || a.nombre === rol.nombre);
    if (def) {
      nuevas.set(rol.id, def.acciones);
      continue;
    }
    const suyas = anteriores.filter((f) => Number(f.id_rol) === Number(rol.id)).map((f) => String(f.accion));
    if (suyas.includes("G")) nuevas.set(rol.id, TODAS);
    else if (suyas.length) nuevas.set(rol.id, ["documento_consultar_vigente"]);
  }
  await db.run("DELETE FROM rol_acciones WHERE modulo = 'documentos'");
  for (const [rolId, acciones] of nuevas) {
    for (const accion of acciones) await db.run("INSERT INTO rol_acciones (id_rol, modulo, accion, alcance) VALUES (?, 'documentos', ?, 'total')", [rolId, accion]);
  }
}
