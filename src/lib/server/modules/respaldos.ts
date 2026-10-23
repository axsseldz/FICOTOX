/*
 * Respaldos (Calidad › Respaldos). La pantalla muestra los respaldos de la
 * instancia, sus pruebas de restauracion y permite crear un respaldo y probar
 * la restauracion. Una sola implementacion del respaldo y de la restauracion:
 * src/lib/shared/respaldo.mjs y scripts/restaurar-ficotox.mjs (sin cambios).
 *
 * - Ver: respaldos:V. Crear respaldo y probar restauracion: respaldos:G con
 *   reautenticacion (respaldos:crear / respaldos:probar). Todo queda en la bitacora.
 * - Restauracion REAL: la pide quien tiene respaldos:G (solicitud de segundo
 *   usuario restaurar_respaldo, con motivo y contrasena) y la aprueba otra
 *   persona con calidad:A. Al aprobarse, el servidor deja de atender (503), cierra
 *   su conexion a la base (con el WAL volcado) y ejecuta el mismo script en modo
 *   real: verificaciones, respaldo "Previo a restauracion", reemplazo, entrada en
 *   la bitacora, migracion y cierre de todas las sesiones. Despues reabre la base.
 *   Igual con `npm run dev`, `npm start` o el lanzador: no reinicia el proceso.
 * - La prueba de restauracion corre en un proceso aparte (el script de siempre,
 *   en modo prueba) para no bloquear la plataforma, y al terminar se borra la
 *   copia restaurada (contiene todos los datos); el acta se conserva.
 * - Nada que parezca codigo sale de aqui: sin rutas, huellas ni sellos.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { registrarIncidenciaAutomatica } from "./calidad/automaticas";
import { requireUser, type CurrentUser } from "../auth";
import { registrarAuditoria } from "../audit";
import { getConfig } from "../config";
import { conBaseCerrada, withSession } from "../db";
import { migrarAlArrancar } from "../migrar-arranque";
import { invalidarIndice } from "../busqueda/version";
import { crearSolicitud, respuestaSolicitud, type Ejecutores } from "../solicitudes";
import { HttpError, json, readJson, type RouteContext } from "../http";
import { cargarAutorizacion, permisoDe, requirePermission, type Autorizacion } from "../rbac";
import { exigirReauth } from "../seguridad";
import { limiteImportarBytes } from "../subidas";
import { leerClaveSello } from "../../shared/audit-chain.mjs";
import { ARCHIVO_IMPORTADO, aplicarRetencion, carpetaRestauradas, huellaLlave, completarRespaldo, huellaManifest, iniciarRespaldo, leerManifest, listarActas, listarRespaldos, RUTA_BASE, type Acta, type Manifest, type RespaldoListado } from "../../shared/respaldo.mjs";
import { formatearFechaHora } from "../../shared/fechas";

export const ID_RE = /^\d{8}-\d{6}(-\d+)?$/;
const ACTA_RE = ID_RE;

/* ---------- Permisos ---------- */

export const puedeVerRespaldos = (auth: Autorizacion): boolean => !!permisoDe(auth, "respaldos", "V");

async function exigirVer(request: Request, s: RouteContext["s"]): Promise<Autorizacion> {
  const auth = await cargarAutorizacion(s, await requireUser(request));
  if (!puedeVerRespaldos(auth)) throw new HttpError(403, { message: "No tienes permiso para ver los respaldos", required: { module: "respaldos", action: "V" } });
  return auth;
}

/* ---------- Tipo de respaldo (por su etiqueta) ---------- */

export type TipoRespaldo = "manual" | "automatico" | "pre_actualizacion" | "pre_migracion" | "pre_restauracion" | "importado";

/*
 * El tipo sale de la etiqueta que le pone quien lo crea: los scripts usan
 * "pre-actualizacion", "pre-migracion" y "antes de restaurar <id>"; la tarea
 * programada, "automatico"; un respaldo manual no lleva etiqueta o lleva el
 * texto que escribio la persona.
 */
function tipoDe(etiqueta: string | null): { tipo: TipoRespaldo; nota: string | null } {
  const texto = String(etiqueta || "").trim();
  const bajo = texto.toLowerCase();
  if (!texto) return { tipo: "manual", nota: null };
  if (bajo === "automatico") return { tipo: "automatico", nota: null };
  if (bajo === "pre-actualizacion") return { tipo: "pre_actualizacion", nota: null };
  if (bajo === "pre-migracion") return { tipo: "pre_migracion", nota: null };
  if (bajo.startsWith("antes de restaurar")) return { tipo: "pre_restauracion", nota: null };
  return { tipo: "manual", nota: texto };
}

/* Etiqueta escrita por la persona: sin saltos de linea, corta y sin hacerse pasar por un tipo reservado. */
function etiquetaLimpia(valor: unknown): string | null {
  let texto = String(valor ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!texto) return null;
  if (["automatico", "pre-actualizacion", "pre-migracion"].includes(texto.toLowerCase()) || texto.toLowerCase().startsWith("antes de restaurar")) texto = `${texto} (manual)`;
  return texto;
}

/* ---------- Trabajo en curso (un respaldo o una prueba a la vez) ---------- */

export interface PasoPrueba {
  n: number;
  titulo: string;
  ok: boolean;
  frase: string;
}

export interface Trabajo {
  id: number;
  tipo: "respaldo" | "prueba" | "restauracion" | "importacion";
  respaldo_id: string | null;
  usuario: string;
  etiqueta: string | null;
  inicio: string;
  fin: string | null;
  estado: "en_curso" | "terminado" | "fallido";
  /* Frase corta de lo que esta haciendo ahora. */
  fase: string;
  pasos: PasoPrueba[];
  resultado: "aprobada" | "fallida" | null;
  acta: string | null;
  mensaje: string | null;
  /* Avance de 0 a 1 cuando se conoce (descifrar un archivo importado). */
  progreso?: number | null;
}

/* Un solo servidor, pero cada ruta puede cargar su propia copia del modulo: el estado va en globalThis. */
const global = globalThis as unknown as { __ficotoxRespaldos?: { trabajo: Trabajo | null; cache: { en: number; datos: Estado | null } } };
const memoria = (global.__ficotoxRespaldos ||= { trabajo: null, cache: { en: 0, datos: null } });

export const trabajoEnCurso = (): Trabajo | null => (memoria.trabajo?.estado === "en_curso" ? memoria.trabajo : null);

export function iniciarTrabajo(datos: Pick<Trabajo, "tipo" | "respaldo_id" | "usuario" | "etiqueta" | "fase">): Trabajo {
  const trabajo: Trabajo = { id: Date.now(), ...datos, inicio: new Date().toISOString(), fin: null, estado: "en_curso", pasos: [], resultado: null, acta: null, mensaje: null };
  memoria.trabajo = trabajo;
  return trabajo;
}

export function terminarTrabajo(trabajo: Trabajo, cambios: Partial<Trabajo>): void {
  Object.assign(trabajo, cambios, { fin: new Date().toISOString() });
  memoria.cache.datos = null;
}

/* La lista se vuelve a leer de disco en la siguiente consulta. */
export const olvidarListaRespaldos = (): void => {
  memoria.cache.datos = null;
};

/* ---------- Lectura de respaldos y actas ---------- */

interface RespaldoDanado {
  id: string;
  creado_en: string | null;
}

interface Estado {
  respaldos: RespaldoListado[];
  danados: RespaldoDanado[];
  actas: Acta[];
}

/* AAAAMMDD-HHMMSS (hora local del servidor, como lo escribe el respaldo) -> instante ISO. */
function instanteDeId(id: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(id);
  if (!m) return null;
  const fecha = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

/* Lo que hay en la carpeta de respaldos (con una memoria corta: el Inicio y la campana lo consultan cada minuto). */
function leerEstado(forzar = false): Estado {
  const ahora = Date.now();
  if (!forzar && memoria.cache.datos && ahora - memoria.cache.en < 20_000) return memoria.cache.datos;
  const dir = getConfig().RESPALDOS_DIR;
  const validos = listarRespaldos(dir);
  const sanos: RespaldoListado[] = [];
  const danados: RespaldoDanado[] = [];
  const conocidos = new Set<string>();
  for (const r of validos) {
    conocidos.add(r.id);
    // Con ficha pero sin la base dentro: incompleto.
    if (fs.existsSync(path.join(/*turbopackIgnore: true*/ r.carpeta, RUTA_BASE))) sanos.push(r);
    else danados.push({ id: r.id, creado_en: r.creado_en || instanteDeId(r.id) });
  }
  let nombres: string[] = [];
  try {
    nombres = fs.readdirSync(dir).filter((n) => ID_RE.test(n));
  } catch {
    nombres = [];
  }
  // Carpetas con id de respaldo pero con la ficha ilegible: no las lista listarRespaldos. Una importacion en curso (o fallida) no es un respaldo dañado.
  for (const id of nombres) if (!conocidos.has(id) && !fs.existsSync(path.join(/*turbopackIgnore: true*/ dir, id, ARCHIVO_IMPORTADO))) danados.push({ id, creado_en: instanteDeId(id) });
  const datos: Estado = { respaldos: sanos, danados, actas: listarActas(dir) };
  memoria.cache = { en: ahora, datos };
  return datos;
}

const restaurable = (r: RespaldoListado) => r.verificacion?.resultado === "aprobada";

/* Respaldo que la retencion nunca borra: el mas reciente con una restauracion aprobada. */
const protegidoDe = (respaldos: RespaldoListado[]): string | null => respaldos.find(restaurable)?.id || null;

/* Huella de la llave con que sella esta instalacion (null si todavia no tiene). */
export function huellaLlaveInstalacion(): string | null {
  const llave = leerClaveSello(process.env.SECRET_KEY || "", getConfig().INSTANCE_DIR);
  return llave ? huellaLlave(llave.clave) : null;
}

/* Resumen de un respaldo para la lista (sin rutas, huellas ni sellos). */
function resumen(r: RespaldoListado, protegido: string | null, huellaInstalacion: string | null = null) {
  const { tipo: tipoEtiqueta, nota: notaEtiqueta } = tipoDe(r.etiqueta);
  // Importado de otra computadora: se dice de cuándo es el original y de dónde viene.
  const tipo: TipoRespaldo = r.importado ? "importado" : tipoEtiqueta;
  const nota = r.importado ? `Traído de ${r.importado.host || "otra computadora"}${r.importado.en ? ` el ${formatearFechaHora(r.importado.en)}` : ""}` : notaEtiqueta;
  return {
    id: r.id,
    creado_en: r.creado_en,
    estado: "ok" as const,
    tipo,
    nota,
    tamano: r.tamano,
    archivos: r.archivos,
    incluye_llave: r.incluye_llave,
    version_app: r.app?.version || null,
    registros: null as number | null,
    bitacora_entradas: Number(r.bitacora?.entradas || 0),
    verificacion: r.verificacion ? { resultado: r.verificacion.resultado, fecha: r.verificacion.fecha } : null,
    protegido: r.id === protegido,
    // Restaurarlo exige que su llave sea la de esta instalacion (si no, la bitacora restaurada no se podria verificar).
    llave_coincide: !r.huella_llave || !huellaInstalacion ? null : r.huella_llave === huellaInstalacion,
    puede_descargar: r.incluye_llave,
  };
}

/* Copia externa: solo se sabe si la configuracion la declara. */
function copiaExterna(): "activa" | "no_configurada" {
  const env = process.env;
  const activa = !!(String(env.FICOTOX_ONEDRIVE_SYNC_DIR || "").trim() || String(env.FICOTOX_ONEDRIVE_REMOTE || "").trim() || String(env.FICOTOX_GRAPH_ENABLED || "").trim().toLowerCase() === "true");
  return activa ? "activa" : "no_configurada";
}

/* ---------- Avisos (Inicio y campana) ---------- */

export interface AvisoRespaldo {
  tipo: "respaldo_viejo" | "prueba_vieja";
  clave: string;
  frase: string;
  detalle: string;
  tono: "danger" | "warning";
  cuando: string | null;
}

/* Mas de RESPALDO_AVISO_HORAS sin respaldo y mas de PRUEBA_RESTAURACION_AVISO_DIAS sin prueba aprobada; solo con respaldos:V y SQLite. */
export function avisosDeRespaldos(auth: Autorizacion): AvisoRespaldo[] {
  if (!puedeVerRespaldos(auth)) return [];
  const cfg = getConfig();
  if (!cfg.SQLITE_PATH) return [];
  const { respaldos, actas } = leerEstado();
  const out: AvisoRespaldo[] = [];
  const ultimo = respaldos[0];
  if (!ultimo || Date.now() - Date.parse(ultimo.creado_en) > cfg.RESPALDO_AVISO_HORAS * 3_600_000) {
    out.push({ tipo: "respaldo_viejo", clave: `respaldo_viejo:${ultimo?.id || "ninguno"}`, frase: "Sin respaldo reciente", detalle: ultimo ? `El último fue el ${formatearFechaHora(ultimo.creado_en)}` : "Todavía no hay ningún respaldo", tono: ultimo ? "warning" : "danger", cuando: ultimo?.creado_en || null });
  }
  const aprobada = actas.find((a) => a.resultado === "aprobada");
  if (!aprobada || Date.now() - Date.parse(aprobada.fecha) > cfg.PRUEBA_RESTAURACION_AVISO_DIAS * 86_400_000) {
    out.push({ tipo: "prueba_vieja", clave: `prueba_vieja:${aprobada?.archivo || "ninguna"}`, frase: "Sin prueba de restauración", detalle: aprobada ? `La última aprobada fue el ${formatearFechaHora(aprobada.fecha)}` : "Todavía no se ha probado recuperar un respaldo", tono: "warning", cuando: aprobada?.fecha || null });
  }
  return out;
}

/*
 * Alerta de integridad: un acta cuya verificacion 1 (los archivos del respaldo)
 * fallo queda en la bitacora y crea una incidencia automatica (una por acta).
 * Se revisa junto con la verificacion de la bitacora (al abrir Auditoria).
 */
export async function alertasDeRespaldo(s: RouteContext["s"]): Promise<boolean> {
  let nuevas = false;
  for (const acta of listarActas(getConfig().RESPALDOS_DIR).slice(0, 50)) {
    const v1 = (acta.verificaciones as Array<{ n: number; ok: boolean; detalle?: string }> | undefined)?.find((v) => v.n === 1);
    if (!v1 || v1.ok) continue;
    const id = await registrarIncidenciaAutomatica(s, {
      origen: "alerta_integridad",
      clave: `alerta_integridad:respaldo:${acta.archivo}`,
      tipo: "sistema",
      descripcion: `La prueba de restauración del ${formatearFechaHora(acta.fecha)} detectó que el respaldo ${acta.respaldo_id} no es íntegro (verificación 1): ${String(v1.detalle || "").slice(0, 300)}`,
      impacto: "desconocido",
      actor: null,
      registros: [],
    });
    if (id) {
      await registrarAuditoria(s, null, { accion: "alerta_integridad", entidad: "respaldos", entidadId: acta.respaldo_id, referencia: acta.respaldo_id, detalle: { acta: acta.archivo, verificacion: 1, detalle: String(v1.detalle || "").slice(0, 300) } });
      nuevas = true;
    }
  }
  return nuevas;
}

/* ---------- Lista y detalle ---------- */

/* GET /api/respaldos */
export async function listarRespaldosApi({ request, s }: RouteContext): Promise<Response> {
  const auth = await exigirVer(request, s);
  const cfg = getConfig();
  const puedeGestionar = !!permisoDe(auth, "respaldos", "G");
  if (!cfg.SQLITE_PATH) return json({ motor: "mysql", respaldos: [], puede_gestionar: false, trabajo: null });
  const { respaldos, danados, actas } = leerEstado(true);
  const protegido = protegidoDe(respaldos);
  const huella = huellaLlaveInstalacion();
  const items = [
    ...respaldos.map((r) => resumen(r, protegido, huella)),
    ...danados.map((d) => ({ id: d.id, creado_en: d.creado_en, estado: "danado" as const, tipo: "manual" as TipoRespaldo, nota: null, tamano: 0, archivos: 0, incluye_llave: false, version_app: null, registros: null, bitacora_entradas: 0, verificacion: null, protegido: false, llave_coincide: null, puede_descargar: false })),
  ].sort((a, b) => String(b.id).localeCompare(String(a.id)));
  const ultimaPrueba = actas[0] || null;
  const aprobada = actas.find((a) => a.resultado === "aprobada") || null;
  return json({
    motor: "sqlite",
    respaldos: items,
    ultimo_respaldo: respaldos[0] ? { creado_en: respaldos[0].creado_en } : null,
    ultima_prueba: ultimaPrueba ? { fecha: ultimaPrueba.fecha, resultado: ultimaPrueba.resultado } : null,
    ultima_aprobada: aprobada ? { fecha: aprobada.fecha } : null,
    copia_externa: copiaExterna(),
    aviso_horas: cfg.RESPALDO_AVISO_HORAS,
    prueba_dias: cfg.PRUEBA_RESTAURACION_AVISO_DIAS,
    puede_gestionar: puedeGestionar,
    trabajo: memoria.trabajo,
    limite_importar_mb: Math.round(limiteImportarBytes() / 1048576),
  });
}

/* Frases de lo que contiene un respaldo, desde los conteos de su ficha. */
const ARCHIVOS_POR_CARPETA: Record<string, string> = {
  informes: "PDF de informes y sus envíos",
  evidencias: "evidencias de análisis e incidencias",
  biblioteca: "documentos de la biblioteca (anterior)",
  sgc: "archivos de Documentos SGC",
  calidad: "PDF de no conformidades",
  avatares: "fotos de perfil",
  maintenance_reports: "reportes de mantenimiento",
  documentos_sgc: "documentos del flujo anterior",
};

/* Titulos y frases de cada verificacion de la prueba, en palabras simples. */
const VERIFICACIONES: Record<number, { titulo: string; bien: string; mal: string }> = {
  1: { titulo: "El respaldo está completo", bien: "Todos los archivos del respaldo están y no han cambiado desde que se creó.", mal: "Falta algún archivo del respaldo o alguno cambió después de crearse." },
  2: { titulo: "La base de datos está sana", bien: "La base de datos del respaldo no tiene errores.", mal: "La base de datos del respaldo tiene errores." },
  3: { titulo: "Es compatible con esta versión", bien: "La estructura del respaldo es compatible con esta versión de la plataforma.", mal: "El respaldo es de una versión más nueva o su estructura no coincide con la de la plataforma." },
  4: { titulo: "La llave del registro de actividad coincide", bien: "La llave que protege el registro de actividad es la correcta.", mal: "No se encontró la llave del registro de actividad o no es la de este respaldo." },
  5: { titulo: "El registro de actividad está íntegro", bien: "Ninguna entrada del registro de actividad fue cambiada ni borrada.", mal: "Se detectó que el registro de actividad fue alterado o que le faltan entradas." },
  6: { titulo: "Las cantidades coinciden", bien: "La cantidad de registros de cada área coincide con la del respaldo.", mal: "La cantidad de registros de alguna área no coincide con la del respaldo." },
  7: { titulo: "Los documentos coinciden", bien: "Los PDF, evidencias y documentos coinciden con lo que dice la base de datos.", mal: "Algún documento falta o no coincide con lo que dice la base de datos." },
  8: { titulo: "Duración de la prueba", bien: "", mal: "" },
};

export function fraseDeVerificacion(v: { n: number; ok: boolean; detalle?: string }): PasoPrueba {
  const def = VERIFICACIONES[v.n] || { titulo: `Verificación ${v.n}`, bien: "Pasó la verificación.", mal: "No pasó la verificación." };
  const noEjecutada = /^No se ejecut/i.test(String(v.detalle || ""));
  if (v.n === 8) {
    const seg = /([\d.,]+)\s*s/.exec(String(v.detalle || ""));
    return { n: 8, titulo: def.titulo, ok: true, frase: seg ? `La prueba tardó ${seg[1]} segundos.` : "La prueba terminó." };
  }
  return { n: v.n, titulo: def.titulo, ok: v.ok, frase: noEjecutada ? "No se pudo comprobar porque el respaldo no es confiable." : v.ok ? def.bien : def.mal };
}

/* Datos de una prueba (acta) en palabras simples. */
export function actaLegible(acta: Acta) {
  const verificaciones = ((acta.verificaciones as Array<{ n: number; ok: boolean; detalle?: string }> | undefined) || []).map(fraseDeVerificacion);
  return {
    archivo: acta.archivo,
    fecha: acta.fecha,
    responsable: acta.responsable,
    modo: acta.modo === "real" ? "real" : "prueba",
    resultado: acta.resultado,
    duracion_ms: Number(acta.duracion_ms || 0),
    respaldo_id: acta.respaldo_id,
    verificaciones,
    conclusion: acta.resultado === "aprobada" ? "El respaldo se puede recuperar: pasó todas las verificaciones." : `El respaldo no pasó ${verificaciones.filter((v) => !v.ok).length} verificación(es): no confíes en él hasta revisarlo.`,
  };
}

/* GET /api/respaldos/:id */
export async function detalleRespaldoApi({ request, s, params }: RouteContext): Promise<Response> {
  await exigirVer(request, s);
  const id = String(params.id || "");
  if (!ID_RE.test(id)) throw new HttpError(404, { message: "Respaldo no encontrado" });
  const cfg = getConfig();
  if (!cfg.SQLITE_PATH) throw new HttpError(404, { message: "Respaldo no encontrado" });
  const carpeta = path.join(/*turbopackIgnore: true*/ cfg.RESPALDOS_DIR, id);
  if (!fs.existsSync(carpeta)) throw new HttpError(404, { message: "Respaldo no encontrado" });
  const { respaldos, actas } = leerEstado(true);
  let manifest: Manifest | null = null;
  try {
    manifest = leerManifest(carpeta);
  } catch {
    manifest = null;
  }
  const listado = respaldos.find((r) => r.id === id);
  if (!manifest || !listado) {
    // Incompleto o con la ficha ilegible: se explica en palabras simples.
    return json({ item: { id, creado_en: instanteDeId(id), estado: "danado", tipo: "manual", nota: null, tamano: 0, archivos: 0, incluye_llave: false, version_app: null, contenido: [], pruebas: [], protegido: false } });
  }
  const protegido = protegidoDe(respaldos);
  const c = manifest.conteos || {};
  const n = (tabla: string) => Number(c[tabla] || 0);
  const registros = [
    [n("muestras_recepcion"), "recepción", "recepciones"],
    [n("muestras_procesamiento"), "procesamiento", "procesamientos"],
    [n("muestras_extraccion"), "extracción", "extracciones"],
    [n("muestras_analisis"), "análisis", "análisis"],
    [n("informes"), "informe", "informes"],
    [n("reactivos"), "reactivo", "reactivos"],
    [n("consumibles"), "consumible", "consumibles"],
    [n("equipos"), "equipo", "equipos"],
    [n("incidencias"), "incidencia", "incidencias"],
    [n("no_conformidades"), "no conformidad", "no conformidades"],
    [n("sgc_documentos"), "documento SGC", "documentos SGC"],
    [n("usuarios"), "usuario", "usuarios"],
  ] as Array<[number, string, string]>;
  const porCarpeta = new Map<string, number>();
  for (const a of manifest.archivos || []) {
    const carpetaArchivo = String(a.ruta).split("/")[1] || "";
    porCarpeta.set(carpetaArchivo, (porCarpeta.get(carpetaArchivo) || 0) + 1);
  }
  const huella = (() => {
    try {
      return huellaManifest(carpeta);
    } catch {
      return null;
    }
  })();
  const pruebas = actas.filter((a) => a.respaldo_id === id && (!huella || a.manifest_sha256 === huella)).map((a) => ({ archivo: a.archivo, fecha: a.fecha, responsable: a.responsable, modo: a.modo === "real" ? "real" : "prueba", resultado: a.resultado, duracion_ms: Number(a.duracion_ms || 0) }));
  const { tipo, nota } = tipoDe(manifest.etiqueta);
  const totalArchivos = (manifest.archivos || []).length;
  const base = resumen(listado, protegido, huellaLlaveInstalacion());
  return json({
    item: {
      ...base,
      tipo: base.tipo === "importado" ? "importado" : tipo,
      nota: base.tipo === "importado" ? base.nota : nota,
      registros: registros.reduce((t, [cantidad]) => t + cantidad, 0),
      contenido: {
        registros: registros.filter(([cantidad]) => cantidad > 0).map(([cantidad, uno, varios]) => ({ cantidad, texto: cantidad === 1 ? uno : varios })),
        archivos: totalArchivos,
        archivos_detalle: [...porCarpeta.entries()].filter(([carpetaArchivo]) => ARCHIVOS_POR_CARPETA[carpetaArchivo]).map(([carpetaArchivo, cantidad]) => ({ cantidad, texto: ARCHIVOS_POR_CARPETA[carpetaArchivo] })),
        bitacora_entradas: Number(manifest.bitacora?.entradas || 0),
      },
      pruebas,
    },
  });
}

/* GET /api/respaldos/actas/:nombre: el acta de una prueba, en palabras simples. */
export async function actaApi({ request, s, params }: RouteContext): Promise<Response> {
  await exigirVer(request, s);
  const nombre = String(params.nombre || "");
  if (!ACTA_RE.test(nombre)) throw new HttpError(404, { message: "Prueba no encontrada" });
  const acta = listarActas(getConfig().RESPALDOS_DIR).find((a) => a.archivo === nombre);
  if (!acta) throw new HttpError(404, { message: "Prueba no encontrada" });
  return json({ item: actaLegible(acta) });
}

/* GET /api/respaldos/estado: avance del respaldo o de la prueba en curso. */
export async function estadoTrabajoApi({ request, s }: RouteContext): Promise<Response> {
  await exigirVer(request, s);
  return json({ trabajo: memoria.trabajo });
}

/* ---------- Crear respaldo ---------- */

export const MENSAJE_OCUPADO = "Hay un respaldo en curso: espera a que termine.";

/*
 * POST /api/respaldos { etiqueta? } (respaldos:G + reautenticacion respaldos:crear).
 * No pasa por apiRoute porque trabaja en tiempos y solo el primero retiene la sesion
 * (en SQLite, a todas las peticiones): la foto de la base. Responde 202 enseguida;
 * los archivos, el manifest, la retencion y la bitacora se terminan en segundo plano.
 */
export async function crearRespaldoPost(request: Request): Promise<Response> {
  const cfg = getConfig();
  const ruta = new URL(request.url).pathname;
  try {
    const cuerpo = await readJson(request);
    const etiqueta = etiquetaLimpia(cuerpo.etiqueta);
    const inicio = await withSession(async (s) => {
      try {
        const user = await requireUser(request);
        await requirePermission(s, user, "respaldos", "G");
        if (!cfg.SQLITE_PATH) throw new HttpError(501, { message: "Con MySQL los respaldos se hacen con la herramienta del servidor de base de datos.", codigo: "respaldo_mysql" });
        if (trabajoEnCurso()) throw new HttpError(409, { message: MENSAJE_OCUPADO, codigo: "respaldo_en_curso" });
        await exigirReauth(s, request, user, "respaldos:crear");
        // better-sqlite3 es un modulo nativo externo (serverExternalPackages); lo recibe respaldo.mjs.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Sqlite = require("better-sqlite3");
        const trabajo = iniciarTrabajo({ tipo: "respaldo", respaldo_id: null, usuario: String(user.nombre || user.email || ""), etiqueta, fase: "Tomando una copia de la base de datos" });
        try {
          const iniciado = await iniciarRespaldo({ Sqlite, sqlitePath: cfg.SQLITE_PATH, instanceDir: cfg.INSTANCE_DIR, respaldosDir: cfg.RESPALDOS_DIR, secretKey: process.env.SECRET_KEY || "", baseDir: cfg.BASE_DIR, incluirLlave: true, etiqueta });
          await s.commit();
          return { user, iniciado, trabajo };
        } catch (error) {
          terminarTrabajo(trabajo, { estado: "fallido", mensaje: "No se pudo tomar la copia de la base de datos." });
          throw error;
        }
      } catch (error) {
        await s.rollback();
        throw error;
      }
    });
    // Archivos, manifest, retencion y bitacora, sin retener a nadie.
    inicio.trabajo.fase = "Copiando los archivos";
    inicio.trabajo.respaldo_id = inicio.iniciado.id;
    void terminarRespaldo(inicio.user, inicio.iniciado, inicio.trabajo, etiqueta);
    return json({ message: "Se empezó el respaldo", trabajo: inicio.trabajo }, 202);
  } catch (error) {
    if (error instanceof HttpError) return json(error.body, error.status);
    console.error(`[api] POST ${ruta}`, error);
    return json({ message: "Error interno del servidor" }, 500);
  }
}

async function terminarRespaldo(user: CurrentUser, iniciado: Awaited<ReturnType<typeof iniciarRespaldo>>, trabajo: Trabajo, etiqueta: string | null): Promise<void> {
  const cfg = getConfig();
  try {
    const { id, manifest } = await completarRespaldo(iniciado);
    trabajo.fase = "Guardando el registro";
    const eliminados = aplicarRetencion(cfg.RESPALDOS_DIR, cfg.RESPALDO_RETENCION);
    const tamano = manifest.base.tamano + manifest.archivos.reduce((t, a) => t + a.tamano, 0);
    await withSession(async (s) => {
      await registrarAuditoria(s, user, { accion: "respaldar", entidad: "respaldos", entidadId: id, referencia: id, detalle: { respaldo_id: id, etiqueta, archivos: manifest.archivos.length, tamano, incluye_llave: manifest.llave.incluida, bitacora_entradas: manifest.bitacora.entradas, eliminados_por_retencion: eliminados.length } });
      await s.commit();
    });
    terminarTrabajo(trabajo, { estado: "terminado", respaldo_id: id, fase: "Listo" });
  } catch (error) {
    console.error("[respaldos] No se pudo crear el respaldo:", error);
    terminarTrabajo(trabajo, { estado: "fallido", fase: "No se pudo crear el respaldo", mensaje: "No se pudo terminar el respaldo. Revisa que haya espacio en el disco y vuelve a intentarlo." });
    await withSession(async (s) => {
      await registrarAuditoria(s, user, { accion: "respaldo_fallido", entidad: "respaldos", entidadId: null, referencia: "Respaldo", detalle: { etiqueta, motivo: error instanceof Error ? error.message.slice(0, 200) : "error" } });
      await s.commit();
    }).catch(() => undefined);
  }
}

/* ---------- Probar restauracion ---------- */

/* Borra la copia restaurada de una prueba (contiene todos los datos), solo si esta dentro de instance-restaurada/ (la misma carpeta que usa el script). */
export function borrarCopiaRestaurada(destino: unknown): void {
  const base = carpetaRestauradas(getConfig().INSTANCE_DIR);
  const objetivo = path.resolve(/*turbopackIgnore: true*/ String(destino || ""));
  if (!destino || !objetivo.startsWith(base + path.sep)) return;
  try {
    fs.rmSync(objetivo, { recursive: true, force: true });
  } catch {
    /* si no se pudo borrar, el acta lo dice y se borra a mano */
  }
}

/*
 * POST /api/respaldos/:id/probar (respaldos:G + reautenticacion respaldos:probar).
 * Ejecuta scripts/restaurar-ficotox.mjs en MODO PRUEBA (la instancia real no se
 * toca) en un proceso aparte; el responsable es quien lo pide.
 */
export async function probarRestauracionPost(request: Request, params: { id?: string }): Promise<Response> {
  const cfg = getConfig();
  const ruta = new URL(request.url).pathname;
  try {
    const id = String(params.id || "");
    const inicio = await withSession(async (s) => {
      try {
        const user = await requireUser(request);
        await requirePermission(s, user, "respaldos", "G");
        if (!cfg.SQLITE_PATH) throw new HttpError(501, { message: "Con MySQL los respaldos se hacen con la herramienta del servidor de base de datos.", codigo: "respaldo_mysql" });
        if (!ID_RE.test(id) || !fs.existsSync(path.join(/*turbopackIgnore: true*/ cfg.RESPALDOS_DIR, id, "manifest.json"))) throw new HttpError(404, { message: "Respaldo no encontrado o dañado: no se puede probar." });
        if (trabajoEnCurso()) throw new HttpError(409, { message: MENSAJE_OCUPADO, codigo: "respaldo_en_curso" });
        await exigirReauth(s, request, user, "respaldos:probar");
        const trabajo = iniciarTrabajo({ tipo: "prueba", respaldo_id: id, usuario: String(user.nombre || user.email || ""), etiqueta: null, fase: "Preparando la prueba" });
        await s.commit();
        return { user, trabajo };
      } catch (error) {
        await s.rollback();
        throw error;
      }
    });
    void ejecutarPrueba(inicio.user, inicio.trabajo, id);
    return json({ message: "Se empezó la prueba de restauración", trabajo: inicio.trabajo }, 202);
  } catch (error) {
    if (error instanceof HttpError) return json(error.body, error.status);
    console.error(`[api] POST ${ruta}`, error);
    return json({ message: "Error interno del servidor" }, 500);
  }
}

/*
 * Ejecuta scripts/restaurar-ficotox.mjs (modo prueba o real) en un proceso aparte:
 * cada verificacion (✅/❌) se agrega al avance del trabajo. Devuelve el acta que
 * escribio el script, o null si no termino.
 */
export async function correrScriptRestauracion(trabajo: Trabajo, argumentos: string[], entorno: Record<string, string> = {}): Promise<Acta | null> {
  const cfg = getConfig();
  const script = path.join(/*turbopackIgnore: true*/ cfg.BASE_DIR, "scripts", "restaurar-ficotox.mjs");
  let actaNombre: string | null = null;
  const alLinea = (linea: string) => {
    const paso = /^(✅|❌)\s+(\d+)\.\s+(.*?):\s*(.*)$/u.exec(linea.trim());
    if (paso) {
      const v = fraseDeVerificacion({ n: Number(paso[2]), ok: paso[1] === "✅", detalle: paso[4] });
      trabajo.pasos.push(v);
      trabajo.fase = `Verificando: ${v.titulo.toLowerCase()}`;
      return;
    }
    const acta = /^Acta:\s*(.+)$/.exec(linea.trim());
    if (acta) actaNombre = path.basename(acta[1].trim()).replace(/\.md$/, "");
  };
  const exito = await new Promise<boolean>((resolver) => {
    if (!fs.existsSync(script)) return resolver(false);
    const hijo = spawn(process.execPath, [script, ...argumentos], { cwd: cfg.BASE_DIR, env: { ...process.env, ...entorno }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let pendiente = "";
    hijo.stdout.setEncoding("utf8");
    hijo.stdout.on("data", (trozo: string) => {
      pendiente += trozo;
      const lineas = pendiente.split(/\r?\n/);
      pendiente = lineas.pop() || "";
      lineas.forEach(alLinea);
    });
    hijo.stderr.setEncoding("utf8");
    hijo.stderr.on("data", (trozo: string) => {
      if (entorno.FICOTOX_RESTAURAR_DESDE_SERVIDOR) console.error(`[respaldos] ${trozo.trim()}`);
    });
    // Tope de tiempo: una prueba no debe quedarse colgada para siempre.
    const limite = setTimeout(() => hijo.kill(), 30 * 60_000);
    hijo.on("error", () => {
      clearTimeout(limite);
      resolver(false);
    });
    hijo.on("close", () => {
      clearTimeout(limite);
      if (pendiente) alLinea(pendiente);
      resolver(true);
    });
  });
  return exito && actaNombre ? listarActas(cfg.RESPALDOS_DIR).find((a) => a.archivo === actaNombre) || null : null;
}

async function ejecutarPrueba(user: CurrentUser, trabajo: Trabajo, id: string): Promise<void> {
  const responsable = String(user.nombre || user.email || "—");
  const acta = await correrScriptRestauracion(trabajo, ["--respaldo", id], { FICOTOX_RESTAURAR_SOLICITUD: JSON.stringify({ responsable }) });
  // La copia restaurada tiene todos los datos del laboratorio: se borra siempre; el acta queda.
  if (acta) borrarCopiaRestaurada(acta.destino);
  if (!acta) {
    terminarTrabajo(trabajo, { estado: "fallido", fase: "No se pudo terminar la prueba", mensaje: "La prueba no pudo completarse. Vuelve a intentarlo; si se repite, avisa al administrador técnico." });
    await withSession(async (s) => {
      await registrarAuditoria(s, user, { accion: "probar_restauracion", entidad: "respaldos", entidadId: id, referencia: id, detalle: { resultado: "no_terminada" } });
      await s.commit();
    }).catch(() => undefined);
    return;
  }
  const legible = actaLegible(acta);
  terminarTrabajo(trabajo, { estado: "terminado", fase: acta.resultado === "aprobada" ? "La prueba salió bien" : "La prueba encontró problemas", resultado: acta.resultado === "aprobada" ? "aprobada" : "fallida", acta: acta.archivo, pasos: legible.verificaciones });
  await withSession(async (s) => {
    await registrarAuditoria(s, user, { accion: "probar_restauracion", entidad: "respaldos", entidadId: id, referencia: id, detalle: { resultado: acta.resultado, duracion_ms: acta.duracion_ms, acta: acta.archivo, verificaciones_fallidas: legible.verificaciones.filter((v) => !v.ok).map((v) => v.n) } });
    await s.commit();
  }).catch(() => undefined);
}

/* ---------- Restaurar un respaldo (solicitud de segundo usuario) ---------- */

/*
 * POST /api/respaldos/:id/restaurar { motivo } (respaldos:G + reautenticacion
 * respaldos:restaurar). No restaura: crea la solicitud restaurar_respaldo, que
 * aprueba otra persona con calidad:A (Responsable General) desde «Por autorizar».
 */
export async function solicitarRestauracion({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await requirePermission(s, user, "respaldos", "G");
  const cfg = getConfig();
  if (!cfg.SQLITE_PATH) throw new HttpError(501, { message: "Con MySQL los respaldos se restauran con la herramienta del servidor de base de datos.", codigo: "respaldo_mysql" });
  const id = String(params.id || "");
  const manifest = ID_RE.test(id) ? manifestDe(id) : null;
  if (!manifest) throw new HttpError(404, { message: "Respaldo no encontrado o dañado: no se puede restaurar." });
  const payload = await readJson(request);
  const motivo = String(payload.motivo || "").trim();
  if (motivo.length < 5) throw new HttpError(400, { message: "Indica el motivo de la restauración (al menos 5 caracteres)", campo: "motivo" });
  exigirLlaveDeLaInstalacion(manifest);
  if (trabajoEnCurso()) throw new HttpError(409, { message: MENSAJE_OCUPADO, codigo: "respaldo_en_curso" });
  await exigirReauth(s, request, user, "respaldos:restaurar");
  const creado = manifest.creado_en || instanteDeId(id);
  const solicitud = await crearSolicitud(s, user, {
    tipo: "restaurar_respaldo",
    entidad: "respaldos",
    entidadId: id,
    referencia: `Respaldo del ${creado ? formatearFechaHora(creado) : id}`,
    accion: "restaurar",
    datos: { respaldo_id: id, creado_en: creado },
    motivo,
  });
  await s.commit();
  return respuestaSolicitud(solicitud, `la restauración del respaldo del ${creado ? formatearFechaHora(creado) : id}`);
}

/*
 * Un respaldo sellado con otra llave (traido de otra instalacion) no se restaura
 * aqui: el registro de actividad restaurado no se podria verificar con la llave
 * de esta instalacion. Solo se resuelve en una instalacion nueva (Configuracion
 * inicial) o por terminal (npm run restaurar).
 */
export const MENSAJE_LLAVE_DISTINTA = "Este respaldo se selló con otra llave del registro de actividad (viene de otra instalación). Restaurarlo aquí dejaría el registro de actividad sin poder verificarse, así que no se permite. Solo se puede usar en una instalación nueva, desde la Configuración inicial, o por terminal con «npm run restaurar».";
function exigirLlaveDeLaInstalacion(manifest: Manifest): void {
  const instalacion = huellaLlaveInstalacion();
  if (manifest.llave?.huella && instalacion && manifest.llave.huella !== instalacion) throw new HttpError(409, { message: MENSAJE_LLAVE_DISTINTA, codigo: "llave_distinta" });
}

function manifestDe(id: string): Manifest | null {
  try {
    return leerManifest(path.join(/*turbopackIgnore: true*/ getConfig().RESPALDOS_DIR, id));
  } catch {
    return null;
  }
}

const nombreDe = async (s: RouteContext["s"], id: unknown): Promise<string> => String((await s.scalar("SELECT nombre FROM usuarios WHERE id = :id", { id: Number(id) })) || `#${id}`);

/*
 * Al aprobarse: solo se programa (no puede correr dentro de la transaccion de la
 * aprobacion, que tiene tomada la base). La restauracion empieza en cuanto esa
 * transaccion termina; si no llego a confirmarse, no se restaura nada.
 */
export const ejecutarRestauracionRespaldo: NonNullable<Ejecutores["restaurar_respaldo"]> = async (ctx) => {
  const cfg = getConfig();
  if (!cfg.SQLITE_PATH) throw new HttpError(501, { message: "Con MySQL los respaldos se restauran con la herramienta del servidor de base de datos.", codigo: "respaldo_mysql" });
  // Quien aprueba debe poder ver los respaldos (Responsable General los ve).
  const auth = await cargarAutorizacion(ctx.s, ctx.user);
  if (!puedeVerRespaldos(auth)) throw new HttpError(403, { message: "Para aprobar una restauración necesitas poder ver los respaldos", required: { module: "respaldos", action: "V" } });
  const id = String(ctx.datos.respaldo_id || ctx.solicitud.entidad_id);
  const manifest = ID_RE.test(id) ? manifestDe(id) : null;
  if (!manifest) throw new HttpError(409, { message: "El respaldo ya no existe o está dañado: no se puede restaurar. Rechaza la solicitud.", codigo: "respaldo_no_disponible" });
  exigirLlaveDeLaInstalacion(manifest);
  if (trabajoEnCurso()) throw new HttpError(409, { message: MENSAJE_OCUPADO, codigo: "respaldo_en_curso" });
  const solicitante = await nombreDe(ctx.s, ctx.solicitud.solicitado_por);
  const aprobador = String(ctx.user.nombre || ctx.user.email || "");
  const trabajo = iniciarTrabajo({ tipo: "restauracion", respaldo_id: id, usuario: aprobador, etiqueta: null, fase: "Preparando la restauración" });
  setTimeout(() => void restaurarAhora({ solicitudId: Number(ctx.solicitud.id), respaldoId: id, solicitante, aprobador, motivo: ctx.solicitud.motivo, trabajo }), 0);
  return { programada: true, message: "La restauración empezó: la plataforma no atenderá mientras dura y después todos vuelven a iniciar sesión." };
};

interface Restauracion {
  solicitudId: number;
  respaldoId: string;
  solicitante: string;
  aprobador: string;
  motivo: string;
  trabajo: Trabajo;
}

async function restaurarAhora(r: Restauracion): Promise<void> {
  const { trabajo } = r;
  // La aprobacion debe haberse confirmado (esta sesion espera a que termine la de la aprobacion).
  const aprobada = await withSession(async (s) => !!(await s.scalar("SELECT 1 FROM solicitudes_autorizacion WHERE id = :id AND estado = 'aprobada'", { id: r.solicitudId }))).catch(() => false);
  if (!aprobada) {
    terminarTrabajo(trabajo, { estado: "fallido", fase: "No se restauró", mensaje: "La aprobación no llegó a guardarse; no se restauró nada." });
    return;
  }
  let acta: Acta | null = null;
  try {
    acta = await conBaseCerrada(async () => {
      trabajo.fase = "Verificando el respaldo";
      const resultado = await correrScriptRestauracion(
        trabajo,
        // Solo opciones fijas en los argumentos; lo que escribieron las personas va en el entorno (no puede parecer una opcion).
        ["--respaldo", r.respaldoId, "--destino", "instance", "--confirmar"],
        { FICOTOX_RESTAURAR_DESDE_SERVIDOR: String(process.pid), FICOTOX_RESTAURAR_SOLICITUD: JSON.stringify({ responsable: r.aprobador, solicitante: r.solicitante, aprobador: r.aprobador, motivo: r.motivo, solicitud: r.solicitudId }) },
      );
      // La base queda en la version de la aplicacion aunque el script se hubiera interrumpido (sin pendientes no hace nada).
      await migrarAlArrancar().catch((error: unknown) => console.error("[respaldos] Migración tras restaurar:", error));
      return resultado;
    });
  } catch (error) {
    console.error("[respaldos] No se pudo restaurar:", error);
  }
  memoria.cache.datos = null;
  invalidarIndice();
  if (acta?.restaurado) {
    // La base ya es la del respaldo: la solicitud no existe ahi; quien pidio, quien aprobo y el motivo quedaron en la entrada de la bitacora.
    terminarTrabajo(trabajo, { estado: "terminado", fase: "Plataforma restaurada", resultado: "aprobada", acta: acta.archivo, pasos: actaLegible(acta).verificaciones });
    console.log(`[respaldos] Plataforma restaurada desde el respaldo ${r.respaldoId} (solicitud #${r.solicitudId}).`);
    return;
  }
  // No se reemplazo nada: la solicitud termina «fallida» con la razon.
  const fallidas = acta ? actaLegible(acta).verificaciones.filter((v) => !v.ok) : [];
  const razon = fallidas.length ? `el respaldo no pasó: ${fallidas.map((v) => v.titulo.toLowerCase()).join("; ")}` : "la restauración no pudo completarse";
  terminarTrabajo(trabajo, { estado: "fallido", fase: "No se restauró", resultado: acta ? "fallida" : null, acta: acta?.archivo || null, pasos: acta ? actaLegible(acta).verificaciones : trabajo.pasos, mensaje: `No se restauró nada: ${razon}. La plataforma siguió como estaba.` });
  await withSession(async (s) => {
    await s.execute("UPDATE solicitudes_autorizacion SET estado = 'fallida', motivo_resolucion = :motivo WHERE id = :id AND estado = 'aprobada'", { id: r.solicitudId, motivo: `No se restauró nada: ${razon}` });
    await registrarAuditoria(s, null, { accion: "restauracion_fallida", entidad: "respaldos", entidadId: r.respaldoId, referencia: r.respaldoId, motivo: r.motivo, detalle: { respaldo_id: r.respaldoId, solicitud_id: r.solicitudId, solicitado_por: r.solicitante, aprobado_por: r.aprobador, razon, acta: acta?.archivo || null, verificaciones_fallidas: fallidas.map((v) => v.n) } });
    await s.commit();
  }).catch((error: unknown) => console.error("[respaldos] No se pudo registrar la restauración fallida:", error));
}
