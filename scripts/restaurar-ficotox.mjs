#!/usr/bin/env node
/*
 * Restauracion de FICOTOX desde un respaldo, con verificacion y acta (Fase 10).
 *
 *   npm run restaurar -- --respaldo <ruta o id> [--destino <carpeta>] [--llave <ruta>]
 *                        [--responsable "<nombre>"] [--confirmar]
 *
 * Modo prueba (por omision): restaura en una carpeta aparte
 * (instance-restaurada/<fecha>/, o --destino) sin tocar la instancia real.
 *
 * Modo real: solo con `--destino instance --confirmar`. Exige el servidor
 * detenido (puerto configurado libre y sin archivo de bloqueo vivo), crea antes
 * un respaldo automatico de la instancia actual, restaura, y agrega a la
 * bitacora de la base restaurada la entrada "restauracion desde respaldo <id>"
 * (actor: sistema) con audit-chain.mjs, para que la cadena continue integra.
 * Al final cierra todas las sesiones (token_version de cada cuenta por encima
 * del que tenia antes de restaurar) y borra la carpeta de preparacion.
 *
 * Restauracion desde la plataforma (Calidad › Respaldos, solicitud aprobada por
 * un segundo usuario): el propio servidor ejecuta este script con
 * FICOTOX_RESTAURAR_DESDE_SERVIDOR=<su pid> despues de cerrar su conexion a la
 * base y de dejar de atender (503). Solo entonces se acepta el modo real con el
 * servidor encendido: el bloqueo vivo debe ser de ese pid y ese pid debe ser el
 * proceso padre. Los datos de la solicitud (responsable, solicitante, aprobador,
 * motivo y numero) llegan en FICOTOX_RESTAURAR_SOLICITUD (JSON), nunca como
 * argumentos: un motivo escrito por una persona no puede parecer una opcion.
 * Por terminal, --solicitante, --aprobador, --motivo y --solicitud.
 *
 * Verificaciones (en ambos modos, cada una en el acta con ✅/❌):
 *   1. manifest valido y SHA-256 de cada archivo del respaldo
 *   2. PRAGMA integrity_check = ok
 *   3. esquema compatible (Fase 12: mismo mecanismo que las migraciones; mas
 *      nuevo que la app o con deriva de esquema: falla; mas viejo: se migra)
 *   4. llave: su huella coincide con la del manifest
 *   5. cadena de la bitacora integra con esa llave (alteraciones, huecos, triggers)
 *   6. conteos por tabla iguales al manifest
 *   7. archivos contra la base: PDF de informes, evidencias de envio, adjuntos,
 *      documentos SGC (flujo anterior), versiones de la biblioteca, PDF de NC
 *      y reportes PDF de mantenimiento
 *   8. tiempo total
 * Resultado: backups/pruebas-restauracion/<fecha>.md y .json. Codigo de salida
 * distinto de 0 si algo falla (1 verificacion fallida; 2 uso incorrecto o modo real rechazado).
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { COLUMNAS_AUDITORIA, construirRegistro, evaluarCadena, leerClaveSello, sellar } from "../src/lib/shared/audit-chain.mjs";
import { adaptadorSqlite, aplicarMigraciones, estadoMigraciones } from "../src/lib/server/migraciones/motor.mjs";
import { bloqueoVivo as bloqueoCompartido } from "../src/lib/shared/bloqueo.mjs";
import { ARCHIVO_LLAVE, CARPETA_ACTAS, CARPETAS_ARCHIVOS, ESQUEMA_VERSION, RUTA_BASE, carpetaRestauradas, crearRespaldo, hacerPrivado, huellaLlave, huellaManifest, inspeccionarBase, leerManifest, resolverEntorno, rutaArchivoValida, sellarManifest, sha256Archivo, versionApp } from "../src/lib/shared/respaldo.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* Fase 12: una base restaurada no tiene ningun proceso migrandola: si el respaldo trae el bloqueo de migracion tomado (de otro equipo o pid), se libera. */
function liberarBloqueoMigracion(conexion) {
  if (conexion.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migraciones_bloqueo'").get()) conexion.prepare("UPDATE schema_migraciones_bloqueo SET pid = NULL, host = NULL, desde = NULL WHERE id = 1").run();
}
const Sqlite = createRequire(import.meta.url)("better-sqlite3");
const args = process.argv.slice(2);
const valor = (nombre) => {
  const i = args.indexOf(nombre);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};
const inicio = Date.now();
const ahora = new Date();
const p2 = (n) => String(n).padStart(2, "0");
const sello = `${ahora.getFullYear()}${p2(ahora.getMonth() + 1)}${p2(ahora.getDate())}-${p2(ahora.getHours())}${p2(ahora.getMinutes())}${p2(ahora.getSeconds())}`;

const entorno = resolverEntorno(root);
const salir = (mensaje, codigo = 2) => {
  console.error(mensaje);
  process.exit(codigo);
};

const respaldoArg = valor("--respaldo");
if (!respaldoArg) salir('Uso: npm run restaurar -- --respaldo <ruta o id> [--destino <carpeta>|instance] [--llave <ruta>] [--responsable "<nombre>"] [--confirmar]');
const respaldo = fs.existsSync(path.resolve(respaldoArg)) ? path.resolve(respaldoArg) : path.join(entorno.respaldosDir, respaldoArg);
if (!fs.existsSync(respaldo)) salir(`No existe el respaldo: ${respaldoArg}`);
const destinoArg = valor("--destino");
const modoReal = destinoArg === "instance";
const solicitudServidor = (() => {
  try {
    const datos = JSON.parse(process.env.FICOTOX_RESTAURAR_SOLICITUD || "{}");
    return datos && typeof datos === "object" ? datos : {};
  } catch {
    return {};
  }
})();
const textoDe = (v) => (v === undefined || v === null || v === "" ? null : String(v));
const responsable = textoDe(solicitudServidor.responsable) || valor("--responsable") || process.env.USER || os.userInfo().username || "—";
const confirmar = args.includes("--confirmar");
const solicitante = textoDe(solicitudServidor.solicitante) || valor("--solicitante");
const aprobador = textoDe(solicitudServidor.aprobador) || valor("--aprobador");
const motivoArg = textoDe(solicitudServidor.motivo) || valor("--motivo");
const solicitudArg = textoDe(solicitudServidor.solicitud) || valor("--solicitud");

/* ---------- Guardas del modo real ---------- */

const puertoOcupado = (puerto) =>
  new Promise((resolve) => {
    const socket = net.connect({ port: puerto, host: "127.0.0.1" });
    socket.setTimeout(800);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });

/* ¿Quien escucha en el puerto? "ficotox" (GET /api/health responde service ficotox-backend), "otro" (responde HTTP, pero no es FICOTOX) o "desconocido". */
async function servicioEn(puerto) {
  try {
    const res = await fetch(`http://127.0.0.1:${puerto}/api/health`, { signal: AbortSignal.timeout(1500) });
    const data = await res.json().catch(() => null);
    return data?.service === "ficotox-backend" ? "ficotox" : "otro";
  } catch {
    return "desconocido";
  }
}

/* Archivo de bloqueo del servidor (<instancia>/servidor.lock): vivo si el pid existe y es posterior al arranque del sistema (Fase 12, src/lib/shared/bloqueo.mjs). */
const bloqueoVivo = (instanceDir) => bloqueoCompartido(path.join(instanceDir, "servidor.lock"));

if (modoReal) {
  if (!confirmar) salir("Modo real rechazado: restaurar sobre la instancia real exige --destino instance --confirmar.");
  if (entorno.motor !== "sqlite") salir("Modo real rechazado: esta instalación usa MySQL/MariaDB (restaura con mysql < respaldo.sql; ver CLAUDE.md).");
  const vivo = bloqueoVivo(entorno.instanceDir);
  // Desde la plataforma: el servidor dueño del bloqueo es quien ejecuta este script (ya cerro su conexion y no atiende).
  const desdeServidor = Number(process.env.FICOTOX_RESTAURAR_DESDE_SERVIDOR || 0);
  const pedidoPorServidor = !!vivo && desdeServidor > 0 && Number(vivo.pid) === desdeServidor && process.ppid === desdeServidor;
  if (vivo && !pedidoPorServidor) salir(`Modo real rechazado: el servidor está encendido (archivo de bloqueo ${path.join(entorno.instanceDir, "servidor.lock")}, pid ${vivo.pid}). Detenlo y vuelve a intentarlo.`);
  if (!pedidoPorServidor && (await puertoOcupado(entorno.puerto))) {
    // En macOS el 5000 lo usa AirPlay: solo se rechaza si quien responde es FICOTOX (o si no se puede saber).
    const quien = await servicioEn(entorno.puerto);
    if (quien !== "otro") salir(`Modo real rechazado: el puerto ${entorno.puerto} está en uso${quien === "ficotox" ? " por un servidor de FICOTOX" : " (¿servidor encendido?)"}. Detenlo y vuelve a intentarlo.`);
    console.log(`Aviso: el puerto ${entorno.puerto} lo usa otro programa (no responde como FICOTOX); se continúa.`);
  }
}

/* ---------- Verificaciones ---------- */

const verificaciones = [];
const observaciones = [];
const check = (n, nombre, ok, detalle) => {
  verificaciones.push({ n, nombre, ok, detalle });
  console.log(`${ok ? "✅" : "❌"} ${n}. ${nombre}: ${detalle}`);
  return ok;
};

let manifest = null;
let respaldoId = path.basename(respaldo);
try {
  manifest = leerManifest(respaldo);
  respaldoId = manifest.id || respaldoId;
} catch (error) {
  check(1, "Manifest e integridad de los archivos del respaldo", false, `manifest.json no existe o no es válido (${error.message})`);
}

// Destino (en modo real se restaura primero a una carpeta de preparacion y se verifica ahi).
// instance-restaurada/ va junto a la carpeta de la instancia (la misma regla con que el servidor la borra).
const restauradas = carpetaRestauradas(entorno.instanceDir);
const preparacion = modoReal ? path.join(restauradas, `${sello}-real`) : destinoArg ? path.resolve(destinoArg) : path.join(restauradas, sello);
let llave = null;
let restauradaDb = null;

if (manifest) {
  // 1. Manifest y SHA-256 de cada archivo del respaldo. Antes que nada, las rutas: un manifest
  // manipulado no puede leer ni escribir fuera del respaldo o de la carpeta de destino.
  const fallas = [];
  const dentro = (raiz, ruta) => path.resolve(ruta).startsWith(path.resolve(raiz) + path.sep);
  if (manifest.base?.ruta !== RUTA_BASE) fallas.push(`ruta de la base no válida en el manifest (${JSON.stringify(manifest.base?.ruta)})`);
  for (const a of Array.isArray(manifest.archivos) ? manifest.archivos : []) {
    const origen = path.join(respaldo, ...String(a?.ruta || "").split("/"));
    const destino = path.join(preparacion, ...String(a?.ruta || "").replace(/^archivos\//, "").split("/"));
    if (!rutaArchivoValida(a?.ruta) || !dentro(respaldo, origen) || !dentro(preparacion, destino)) fallas.push(`ruta no válida en el manifest: ${JSON.stringify(a?.ruta)}`);
  }
  if (!Array.isArray(manifest.archivos)) fallas.push("el manifest no trae la lista de archivos");
  const base = path.join(respaldo, RUTA_BASE);
  const rutasValidas = fallas.length === 0;
  /* Solo archivos regulares del propio respaldo: un enlace simbolico (p. ej. a /etc/hosts) o un directorio es una falla, y un error de lectura tambien. */
  const revisar = async (ruta, etiqueta, esperado) => {
    let info;
    try {
      info = fs.lstatSync(ruta);
    } catch {
      fallas.push(`falta ${etiqueta}`);
      return;
    }
    if (info.isSymbolicLink()) return fallas.push(`${etiqueta} es un enlace simbólico`);
    if (!info.isFile()) return fallas.push(`${etiqueta} no es un archivo`);
    try {
      if ((await sha256Archivo(ruta)) !== esperado) fallas.push(`${etiqueta} alterado`);
    } catch (error) {
      fallas.push(`${etiqueta} no se pudo leer (${error.code || error.message})`);
    }
  };
  // Tampoco se aceptan enlaces en las carpetas intermedias del respaldo.
  const carpetaEnlazada = (ruta) => {
    for (let dir = path.dirname(ruta); dir.length > respaldo.length && dir.startsWith(respaldo); dir = path.dirname(dir)) {
      try {
        if (fs.lstatSync(dir).isSymbolicLink()) return true;
      } catch {
        return false;
      }
    }
    return false;
  };
  await revisar(base, RUTA_BASE, manifest.base?.sha256);
  for (const a of rutasValidas ? manifest.archivos : []) {
    const ruta = path.join(respaldo, ...a.ruta.split("/"));
    if (carpetaEnlazada(ruta)) fallas.push(`${a.ruta} está en una carpeta enlazada`);
    else await revisar(ruta, a.ruta, a?.sha256);
  }
  const ok1 = check(1, "Manifest e integridad de los archivos del respaldo", fallas.length === 0, fallas.length ? `${fallas.length} problema(s): ${fallas.slice(0, 8).join("; ")}${fallas.length > 8 ? "…" : ""}` : `manifest válido; base y ${(manifest.archivos || []).length} archivo(s) con SHA-256 correcto`);

  if (ok1) {
    // Copia al destino de preparacion.
    if (fs.existsSync(preparacion) && fs.readdirSync(preparacion).length) salir(`El destino ya existe y no está vacío: ${preparacion}`);
    fs.mkdirSync(preparacion, { recursive: true });
    restauradaDb = path.join(preparacion, "ficotox.sqlite3");
    fs.copyFileSync(base, restauradaDb);
    for (const a of manifest.archivos || []) {
      const relativo = a.ruta.replace(/^archivos\//, "");
      const destino = path.join(preparacion, ...relativo.split("/"));
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.copyFileSync(path.join(respaldo, ...a.ruta.split("/")), destino);
    }
  }
}

let db = null;
let planMigracion = null;
if (restauradaDb) {
  db = new Sqlite(restauradaDb);
  // 2. integrity_check.
  const integridad = String(db.pragma("integrity_check", { simple: true }));
  check(2, "PRAGMA integrity_check", integridad === "ok", integridad);

  // 3. Esquema (Fase 12): el mismo mecanismo de las migraciones. Mas nuevo que la app o con deriva: falla.
  const version = manifest.esquema_version === null || manifest.esquema_version === undefined ? null : Number(manifest.esquema_version);
  if (version !== null && version > ESQUEMA_VERSION) check(3, "Esquema compatible", false, `el respaldo es de una versión más nueva (esquema ${version}) que esta aplicación (esquema ${ESQUEMA_VERSION}); actualiza la aplicación antes de restaurar`);
  else {
    try {
      planMigracion = await estadoMigraciones(adaptadorSqlite(db), { Sqlite });
      const lista = planMigracion.pendientes.map((m) => m.version).join(", ");
      const detalle =
        planMigracion.tipo === "versionada"
          ? planMigracion.pendientes.length ? `esquema ${planMigracion.version}; se aplicarán las migraciones ${lista} (hasta la ${ESQUEMA_VERSION})` : `esquema ${planMigracion.version} (igual al de la aplicación)`
          : planMigracion.tipo === "sin_versionar"
            ? `base anterior a las migraciones reconocida como versión ${planMigracion.lineaBase}; se registrará como línea base y se aplicarán las migraciones ${lista || "(ninguna)"}`
            : "base vacía";
      check(3, "Esquema compatible", true, detalle);
      if (planMigracion.pendientes.length || planMigracion.lineaBase !== null) observaciones.push(`La base del respaldo se migró a la versión ${ESQUEMA_VERSION} después de verificarla (${detalle}).`);
    } catch (error) {
      check(3, "Esquema compatible", false, error.message.replace(/\n\s*/g, " "));
    }
  }

  // 4. Llave (la del respaldo o --llave) y comparacion con la llave configurada en esta instalacion.
  const configurada = leerClaveSello(entorno.secretKey, entorno.instanceDir);
  const rutaLlave = valor("--llave") ? path.resolve(valor("--llave")) : path.join(respaldo, ARCHIVO_LLAVE);
  if (fs.existsSync(rutaLlave)) llave = fs.readFileSync(rutaLlave, "utf8").trim() || null;
  const huellaEsperada = manifest.llave?.huella || null;
  if (!llave) check(4, "Llave de la bitácora", false, `no se encontró la llave (${valor("--llave") ? rutaLlave : "el respaldo no la incluye"}); indica --llave <ruta> con la llave guardada aparte. Sin ella no se puede verificar la bitácora`);
  else if (huellaEsperada && huellaLlave(llave) !== huellaEsperada) check(4, "Llave de la bitácora", false, `la llave indicada NO es la del respaldo (huella ${huellaLlave(llave).slice(0, 12)}… ≠ ${String(huellaEsperada).slice(0, 12)}…). Con otra llave la bitácora no se puede verificar`);
  else if (!manifest.sello || sellarManifest(manifest, llave) !== manifest.sello) check(4, "Llave de la bitácora", false, manifest.sello ? "el sello del manifest no corresponde: el respaldo fue alterado después de crearse (base, archivos o manifest) o la llave no es la del respaldo" : "el manifest no está sellado con la llave de la bitácora; no se puede confirmar que el respaldo no se alteró");
  else check(4, "Llave de la bitácora", true, `huella ${huellaLlave(llave).slice(0, 12)}… coincide con el manifest y el sello del manifest es válido (origen: ${manifest.llave?.origen || "—"})${configurada ? (huellaLlave(configurada.clave) === huellaLlave(llave) ? "; es la misma llave configurada en esta instalación" : "; NO es la llave configurada en esta instalación (ver observaciones)") : "; esta instalación no tiene llave configurada"}`);
  // El sello protege de verdad solo si la llave no viaja con el respaldo: se compara con la llave de la instalación.
  if (llave && configurada && huellaLlave(configurada.clave) !== huellaLlave(llave)) observaciones.push(`La llave del respaldo (huella ${huellaLlave(llave).slice(0, 12)}…) no es la configurada en esta instalación (${configurada.origen}, huella ${huellaLlave(configurada.clave).slice(0, 12)}…). Si el respaldo es de este laboratorio, confirmar con la llave guardada aparte antes de confiar en él: quien pueda escribir un respaldo que incluye su llave puede resellarlo.`);

  // 5. Cadena de la bitacora.
  const cadena = () => {
    const filas = db.prepare("SELECT * FROM auditoria ORDER BY id ASC").all();
    const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'auditoria'").get();
    const triggers = Number(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'auditoria' AND name IN ('auditoria_sin_update', 'auditoria_sin_delete')").get().n);
    return evaluarCadena(filas, llave || "", seq ? Number(seq.seq) : null, triggers);
  };
  const tieneBitacora = !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auditoria'").get();
  if (!tieneBitacora) check(5, "Cadena de la bitácora", false, "la base no tiene tabla auditoria");
  else if (!llave) check(5, "Cadena de la bitácora", false, "no se puede verificar sin la llave de la bitácora (ver verificación 4)");
  else {
    const v = cadena();
    const problemas = [];
    if (v.primer_error !== null) problemas.push(`sello roto desde la entrada #${v.primer_error}${verificaciones[3]?.ok ? "" : " (la llave no es la del respaldo)"}`);
    if (v.filas_faltantes_al_final) problemas.push(`${v.filas_faltantes_al_final} entrada(s) faltante(s) al final`);
    if (v.filas_faltantes_intermedias) problemas.push(`${v.filas_faltantes_intermedias} hueco(s) de id`);
    if (!v.triggers_ok) problemas.push("faltan los triggers de protección");
    check(5, "Cadena de la bitácora", v.ok, v.ok ? `${v.total} entradas íntegras (sellos, sin huecos, triggers presentes)` : problemas.join("; "));
  }

  // 6. Conteos.
  const { conteos, bitacora } = inspeccionarBase(db);
  const diferencias = Object.entries(manifest.conteos || {}).filter(([t, n]) => conteos[t] !== n).map(([t, n]) => `${t}: ${conteos[t] ?? "sin tabla"} ≠ ${n}`);
  if (bitacora.ultimo_hash !== manifest.bitacora?.ultimo_hash) diferencias.push("el sello de la última entrada de la bitácora no coincide con el manifest");
  check(6, "Conteos por tabla", diferencias.length === 0, diferencias.length ? diferencias.join("; ") : `${Object.keys(manifest.conteos || {}).length} tablas iguales al manifest (bitácora: ${bitacora.entradas} entradas, última #${bitacora.ultimo_id ?? "—"})`);

  // 7. Archivos contra la base.
  const tabla = (nombre) => !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(nombre);
  const columnas = (nombre) => new Set(db.prepare(`PRAGMA table_info(${nombre})`).all().map((c) => c.name));
  const grupos = [
    { etiqueta: "PDF de informes", tabla: "informes", archivo: "archivo_pdf", sha: "pdf_sha256", carpeta: "informes" },
    { etiqueta: "evidencias de envío", tabla: "envios_informe", archivo: "evidencia_archivo", sha: "evidencia_sha256", carpeta: path.join("informes", "envios") },
    { etiqueta: "adjuntos (evidencia instrumental)", tabla: "adjuntos", archivo: "nombre_almacenado", sha: "sha256", carpeta: "evidencias" },
    { etiqueta: "documentos SGC del flujo anterior (heredados)", tabla: "documentos_sgc", archivo: "archivo_nombre", sha: "archivo_sha256", carpeta: "documentos_sgc" },
    // Biblioteca: nombre_almacenado es relativo a <instancia>/biblioteca ("<documento>/<uuid>.<ext>").
    { etiqueta: "versiones de la Biblioteca retirada (heredadas)", tabla: "biblioteca_versiones", archivo: "nombre_almacenado", sha: "sha256", carpeta: "biblioteca" },
    // Documentos SGC: nombre_almacenado es relativo a <instancia>/sgc ("<documento>/<revision>/<uuid>.<ext>").
    { etiqueta: "archivos de Documentos SGC", tabla: "sgc_archivos", archivo: "nombre_almacenado", sha: "sha256", carpeta: "sgc" },
    { etiqueta: "PDF de no conformidades", tabla: "no_conformidades", archivo: "archivo_pdf", sha: "pdf_sha256", carpeta: path.join("calidad", "nc") },
    // Reportes de mantenimiento: nombre_almacenado es relativo a <instancia>/maintenance_reports ("<mantenimiento>/<uuid>.pdf").
    { etiqueta: "reportes PDF de mantenimiento", tabla: "reportes_mantenimiento", archivo: "nombre_almacenado", sha: "sha256", carpeta: "maintenance_reports" },
  ];
  const resumen = [];
  const problemas7 = [];
  for (const g of grupos) {
    if (!tabla(g.tabla) || !columnas(g.tabla).has(g.archivo) || !columnas(g.tabla).has(g.sha)) continue;
    const filas = db.prepare(`SELECT id, ${g.archivo} AS archivo, ${g.sha} AS sha FROM ${g.tabla} WHERE ${g.archivo} IS NOT NULL AND ${g.sha} IS NOT NULL`).all();
    // Varias filas pueden apuntar al mismo archivo (adjuntos heredados): se verifica una vez por archivo.
    const vistos = new Map();
    let faltan = 0;
    let alterados = 0;
    for (const f of filas) {
      const ruta = path.join(preparacion, g.carpeta, ...String(f.archivo).split("/"));
      const clave = `${ruta}|${f.sha}`;
      if (vistos.has(clave)) continue;
      const estado = !fs.existsSync(ruta) ? "faltante" : (await sha256Archivo(ruta)) === String(f.sha) ? "ok" : "alterado";
      vistos.set(clave, estado);
      if (estado === "faltante") faltan += 1;
      if (estado === "alterado") alterados += 1;
      if (estado !== "ok" && problemas7.length < 10) problemas7.push(`${g.tabla} #${f.id}: ${f.archivo} ${estado}`);
    }
    resumen.push(`${g.etiqueta}: ${vistos.size} (${faltan} faltante(s), ${alterados} alterado(s))`);
  }
  check(7, "Archivos contra la base (SHA-256)", problemas7.length === 0, `${resumen.join("; ") || "sin archivos registrados"}${problemas7.length ? ` — ${problemas7.join("; ")}` : ""}`);
}

// Cada verificacion queda en el acta: las que no se pudieron ejecutar (p. ej. porque fallo la 1) se reportan como omitidas.
const NOMBRES = { 2: "PRAGMA integrity_check", 3: "Esquema compatible", 4: "Llave de la bitácora", 5: "Cadena de la bitácora", 6: "Conteos por tabla", 7: "Archivos contra la base (SHA-256)" };
for (const [n, nombre] of Object.entries(NOMBRES)) {
  if (!verificaciones.some((v) => v.n === Number(n))) check(Number(n), nombre, false, "No se ejecutó: falló la verificación 1 (el respaldo no es confiable)");
}
const fallidas = verificaciones.filter((v) => !v.ok);
let restaurado = false;
let respaldoPrevio = null;
let entradaRestauracion = null;

/* ---------- Modo real: aplicar sobre la instancia ---------- */

if (modoReal && db && !fallidas.length) {
  // Llave que usara el servidor: debe ser la del respaldo o la bitacora restaurada no verificaria.
  const configurada = String(entorno.secretKey || "").trim();
  const usaSecretKey = configurada && configurada !== "ficotox-dev-secret";
  const llaveArchivo = !usaSecretKey ? leerClaveSello("", entorno.instanceDir) : null;
  if (llaveArchivo && huellaLlave(llaveArchivo.clave) !== huellaLlave(llave) && !args.includes("--aceptar-llave-del-respaldo")) {
    fallidas.push({ n: 4, nombre: "Llave de la bitácora", ok: false, detalle: "instance/auditoria.key es distinta de la llave del respaldo; para reemplazarla indica --aceptar-llave-del-respaldo (tras confirmar el respaldo con la llave guardada aparte)" });
    verificaciones.push(fallidas[fallidas.length - 1]);
    console.log("❌ instance/auditoria.key no es la llave del respaldo; no se restaura sin --aceptar-llave-del-respaldo.");
  } else if (usaSecretKey && huellaLlave(configurada) !== manifest.llave?.huella) {
    fallidas.push({ n: 4, nombre: "Llave de la bitácora", ok: false, detalle: "SECRET_KEY del .env no es la llave del respaldo; configura la llave del respaldo antes de restaurar" });
    verificaciones.push(fallidas[fallidas.length - 1]);
    console.log("❌ La SECRET_KEY configurada no es la llave con que se selló la bitácora del respaldo; no se restaura.");
  } else {
    db.close();
    db = null;
    // Lo de antes de restaurar: al final cada cuenta queda con un token_version mayor que el que tenia aqui y
    // que el del respaldo, y ningun id ya usado se reutiliza (un token viejo no vuelve a valer, y un folio o una
    // solicitud de lo que se pierde no se confunde con uno nuevo).
    const deAntes = { versiones: new Map(), secuencias: new Map() };
    if (fs.existsSync(entorno.sqlitePath)) {
      const actual = new Sqlite(entorno.sqlitePath, { readonly: true, fileMustExist: true });
      try {
        for (const f of actual.prepare("SELECT name, seq FROM sqlite_sequence").all()) deAntes.secuencias.set(String(f.name), Number(f.seq || 0));
        for (const f of actual.prepare("SELECT id, token_version FROM usuarios").all()) deAntes.versiones.set(Number(f.id), Number(f.token_version || 0));
      } catch {
        /* base actual sin usuarios: no hay sesiones que cerrar */
      } finally {
        actual.close();
      }
    }
    // Respaldo automatico de la instancia actual antes de sobrescribirla.
    if (fs.existsSync(entorno.sqlitePath)) {
      respaldoPrevio = await crearRespaldo({ Sqlite, sqlitePath: entorno.sqlitePath, instanceDir: entorno.instanceDir, respaldosDir: entorno.respaldosDir, secretKey: entorno.secretKey, baseDir: root, etiqueta: `antes de restaurar ${respaldoId}` });
      console.log(`Respaldo previo de la instancia actual: ${respaldoPrevio.carpeta}`);
    }
    fs.mkdirSync(entorno.instanceDir, { recursive: true });
    for (const sufijo of ["-wal", "-shm", "-journal"]) fs.rmSync(`${entorno.sqlitePath}${sufijo}`, { force: true });
    fs.copyFileSync(restauradaDb, entorno.sqlitePath);
    // Carpetas de archivos: se reemplazan por las del respaldo (las actuales quedaron en el respaldo previo).
    for (const carpeta of CARPETAS_ARCHIVOS) {
      fs.rmSync(path.join(entorno.instanceDir, carpeta), { recursive: true, force: true });
      if (fs.existsSync(path.join(preparacion, carpeta))) fs.cpSync(path.join(preparacion, carpeta), path.join(entorno.instanceDir, carpeta), { recursive: true });
    }
    // Llave en archivo: se deja la del respaldo para que el servidor la use.
    if (!usaSecretKey) fs.writeFileSync(path.join(entorno.instanceDir, "auditoria.key"), `${llave}\n`, { mode: 0o600 });
    // Entrada de la restauracion en la bitacora restaurada (actor: sistema), encadenada con audit-chain.mjs.
    const real = new Sqlite(entorno.sqlitePath);
    try {
      const previo = real.prepare("SELECT hash FROM auditoria ORDER BY id DESC LIMIT 1").get();
      const registro = construirRegistro(
        {
          accion: "restaurar_respaldo",
          entidad: "respaldos",
          entidadId: respaldoId,
          referencia: respaldoId,
          motivo: motivoArg ? `Restauración desde respaldo ${respaldoId}: ${motivoArg}` : `Restauración desde respaldo ${respaldoId}`,
          detalle: {
            respaldo_id: respaldoId,
            responsable,
            respaldo_previo: respaldoPrevio?.id || null,
            creado_en: manifest.creado_en,
            app: versionApp(root),
            sesiones_cerradas: true,
            ...(solicitante ? { solicitado_por: solicitante } : {}),
            ...(aprobador ? { aprobado_por: aprobador } : {}),
            ...(solicitudArg ? { solicitud_id: Number(solicitudArg) || solicitudArg } : {}),
            ...(motivoArg ? { motivo: motivoArg } : {}),
          },
        },
        null,
        previo?.hash || null,
      );
      const hash = sellar(registro, llave);
      real.prepare(`INSERT INTO auditoria (${COLUMNAS_AUDITORIA.join(", ")}) VALUES (${COLUMNAS_AUDITORIA.map((c) => `@${c}`).join(", ")})`).run({ ...registro, hash });
      const seq = real.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'auditoria'").get();
      const triggers = Number(real.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'auditoria' AND name IN ('auditoria_sin_update', 'auditoria_sin_delete')").get().n);
      const v = evaluarCadena(real.prepare("SELECT * FROM auditoria ORDER BY id ASC").all(), llave, seq ? Number(seq.seq) : null, triggers);
      entradaRestauracion = { id: Number(real.prepare("SELECT MAX(id) AS id FROM auditoria").get().id), cadena_ok: v.ok, total: v.total };
      if (!v.ok) fallidas.push({ n: 5, nombre: "Cadena tras la restauración", ok: false, detalle: "la cadena no quedó íntegra tras agregar la entrada de restauración" });
      // Fase 12: un respaldo de una version anterior queda migrado a la actual (cada migracion, en la bitacora).
      liberarBloqueoMigracion(real);
      const migracion = await aplicarMigraciones(adaptadorSqlite(real), { Sqlite, clave: llave, appCommit: versionApp(root).commit, respaldo: async () => respaldo, avisar: (m) => console.log(`  [migraciones] ${m}`) });
      if (migracion.aplicadas.length || migracion.lineaBase !== null) observaciones.push(`Migraciones aplicadas a la instancia restaurada: ${migracion.lineaBase !== null ? `línea base ${migracion.lineaBase}; ` : ""}${migracion.aplicadas.map((m) => m.version).join(", ") || "ninguna"}.`);
      // Todas las sesiones se cierran (quien estaba dentro vuelve a iniciar sesion) y los id siguen despues de los ya usados.
      real.transaction(() => {
        const subir = real.prepare("UPDATE usuarios SET token_version = :tv WHERE id = :id");
        for (const f of real.prepare("SELECT id, token_version FROM usuarios").all()) subir.run({ id: f.id, tv: Math.max(Number(f.token_version || 0), deAntes.versiones.get(Number(f.id)) ?? 0) + 1 });
        const secuencia = real.prepare("UPDATE sqlite_sequence SET seq = :seq WHERE name = :name AND seq < :seq");
        for (const [name, seq] of deAntes.secuencias) if (name !== "auditoria") secuencia.run({ name, seq });
      })();
      observaciones.push("Se cerraron todas las sesiones: cada persona vuelve a iniciar sesión.");
    } finally {
      real.close();
    }
    restaurado = true;
    // Fase 12: la base y los archivos restaurados, solo para el usuario de FICOTOX (POSIX).
    hacerPrivado(entorno.instanceDir);
    console.log(`Instancia restaurada en ${entorno.instanceDir}; entrada de bitácora #${entradaRestauracion?.id} (cadena ${entradaRestauracion?.cadena_ok ? "íntegra" : "ROTA"}).`);
  }
}
// Modo prueba: la copia restaurada tambien se migra (queda lista para levantar un servidor sobre ella).
if (!modoReal && db && !fallidas.length && planMigracion && (planMigracion.pendientes.length || planMigracion.lineaBase !== null)) {
  try {
    liberarBloqueoMigracion(db);
    await aplicarMigraciones(adaptadorSqlite(db), { Sqlite, clave: llave, appCommit: versionApp(root).commit, respaldo: async () => respaldo, avisar: (m) => console.log(`  [migraciones] ${m}`) });
  } catch (error) {
    const f = { n: 3, nombre: "Esquema compatible", ok: false, detalle: `la migración de la copia restaurada falló: ${error.message}` };
    fallidas.push(f);
    verificaciones.push(f);
  }
}
if (db) db.close();
// Modo real: la carpeta de preparacion (con todos los datos) ya no sirve, se haya aplicado o no.
if (modoReal) fs.rmSync(preparacion, { recursive: true, force: true });

/* ---------- Acta ---------- */

const duracion = Date.now() - inicio;
const resultado = fallidas.length ? "fallida" : "aprobada";
verificaciones.push({ n: 8, nombre: "Tiempo total de restauración", ok: true, detalle: `${(duracion / 1000).toFixed(2)} s` });
console.log(`✅ 8. Tiempo total de restauración: ${(duracion / 1000).toFixed(2)} s`);
if (!modoReal) observaciones.push(`Modo prueba: la instancia real no se tocó; la copia restaurada quedó en ${preparacion}.`);
if (respaldoPrevio) observaciones.push(`Antes de restaurar se respaldó la instancia actual en ${respaldoPrevio.carpeta}.`);

const actasDir = path.join(entorno.respaldosDir, CARPETA_ACTAS);
fs.mkdirSync(actasDir, { recursive: true });
let nombreActa = sello;
for (let n = 2; fs.existsSync(path.join(actasDir, `${nombreActa}.json`)); n += 1) nombreActa = `${sello}-${n}`;
const acta = {
  fecha: ahora.toISOString(),
  respaldo_id: respaldoId,
  respaldo_ruta: respaldo,
  // Huella del manifest usado: la pantalla Respaldos solo marca como verificado ese respaldo exacto.
  manifest_sha256: manifest ? (() => { try { return huellaManifest(respaldo); } catch { return null; } })() : null,
  respaldo_creado_en: manifest?.creado_en || null,
  responsable,
  ...(solicitante || aprobador || motivoArg ? { solicitado_por: solicitante, aprobado_por: aprobador, motivo: motivoArg, solicitud_id: solicitudArg ? Number(solicitudArg) || solicitudArg : null } : {}),
  modo: modoReal ? "real" : "prueba",
  destino: modoReal ? entorno.instanceDir : preparacion,
  host: os.hostname(),
  app: versionApp(root),
  verificaciones: verificaciones.sort((a, b) => a.n - b.n),
  duracion_ms: duracion,
  resultado,
  restaurado,
  respaldo_previo: respaldoPrevio?.id || null,
  entrada_bitacora: entradaRestauracion,
  observaciones,
};
fs.writeFileSync(path.join(actasDir, `${nombreActa}.json`), `${JSON.stringify(acta, null, 2)}\n`);

const fechaLocal = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Tijuana", dateStyle: "long", timeStyle: "short" }).format(ahora);
const md = [
  "# Acta de prueba de restauración — FICOTOX",
  "",
  "| Dato | Valor |",
  "| --- | --- |",
  `| Fecha | ${fechaLocal} (America/Tijuana) |`,
  `| Respaldo usado | \`${respaldoId}\`${manifest?.creado_en ? ` (creado ${new Intl.DateTimeFormat("es-MX", { timeZone: "America/Tijuana", dateStyle: "medium", timeStyle: "short" }).format(new Date(manifest.creado_en))})` : ""} |`,
  `| Responsable | ${responsable} |`,
  `| Modo | ${modoReal ? "Real (sobre la instancia)" : "Prueba (carpeta aparte, sin tocar la instancia real)"} |`,
  `| Destino | \`${acta.destino}\` |`,
  `| Equipo | ${acta.host} |`,
  `| Versión de la app | ${acta.app.version || "—"} · commit ${acta.app.commit ? acta.app.commit.slice(0, 7) : "—"} |`,
  `| Tiempo total | ${(duracion / 1000).toFixed(2)} s |`,
  "",
  "## Verificaciones",
  "",
  "| # | Verificación | Resultado | Detalle |",
  "| --- | --- | --- | --- |",
  ...acta.verificaciones.map((v) => `| ${v.n} | ${v.nombre} | ${v.ok ? "✅" : "❌"} | ${String(v.detalle).replace(/\|/g, "\\|")} |`),
  "",
  "## Conclusión",
  "",
  resultado === "aprobada"
    ? `La restauración ${modoReal ? "se aplicó y" : ""} pasó todas las verificaciones: el respaldo \`${respaldoId}\` es íntegro y recuperable.`.replace("  ", " ")
    : `La restauración NO pasó ${fallidas.length} verificación(es); revisar los puntos marcados con ❌ antes de confiar en este respaldo.`,
  "",
  "## Observaciones",
  "",
  ...(observaciones.length ? observaciones.map((o) => `- ${o}`) : ["- Sin observaciones."]),
  "",
  "Firma del responsable: ______________________    Revisó (Mejora Continua): ______________________",
  "",
].join("\n");
fs.writeFileSync(path.join(actasDir, `${nombreActa}.md`), md);
console.log(`\nActa: ${path.join(actasDir, `${nombreActa}.md`)}`);
console.log(`Resultado: ${resultado.toUpperCase()}`);
hacerPrivado(preparacion);
// Fase 12: la prueba deja una copia completa de los datos: se dice donde y que se borre al revisarla.
if (!modoReal && fs.existsSync(preparacion)) console.log(`Copia restaurada (datos completos del laboratorio): ${preparacion}\nRevísala si hace falta y bórrala al terminar (el acta queda como evidencia).`);
process.exit(fallidas.length ? 1 : 0);
