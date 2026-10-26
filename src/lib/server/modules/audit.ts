import { requireUser } from "../auth";
import { documentosOcultos } from "./sgc/acceso";
import { exigirVerRegistro } from "../acceso-registro";
import { advertenciaLlaveBitacora, origenLlaveBitacora, registrarAuditoria, verifyAuditChain, type AuditVerification } from "../audit";
import { type Row, type Session } from "../db";
import { incidenciaPorAlertaIntegridad } from "./calidad/automaticas";
import { alertasDeRespaldo } from "./respaldos";
import { exportacionBitacoraRetirada } from "../retirado";
import { json, type RouteContext } from "../http";
import { cargarAutorizacion, finDiaLocal, inicioDiaLocal, permisoDe, requirePermission, soloEstado, type Autorizacion } from "../rbac";
import type { Modulo } from "../../shared/permisos";
import { safeJsonLoad, searchParam } from "./helpers";

/*
 * Consulta de la bitacora de auditoria. Solo lectura: no existe endpoint
 * para modificar ni borrar entradas.
 */

/*
 * La bitacora muestra a quien la consulta que paso, quien y cuando; los datos
 * (antes, despues y cambios) de una entrada solo si puede ver el modulo del
 * registro y, en muestras, si su alcance no es solo "estado" (Fase 1). Asi el
 * alcance de un modulo no se elude leyendo la bitacora.
 */
/* Fase 11: incidencias, NC y acciones; sus datos solo con calidad:V total (el admin tecnico, V bitacora, no los ve). */
const ENTIDADES_CALIDAD = new Set(["incidencias", "no_conformidades", "acciones_correctivas", "suspensiones"]);
/* Acciones de calidad que se registran tambien sobre equipos e informes: su motivo es de la NC. */
const ACCIONES_CALIDAD = ["suspender", "reanudar", "retener", "liberar_retencion"];
const SQL_SENSIBLE_CALIDAD = `(entidad IN (${[...ENTIDADES_CALIDAD].map((e) => `'${e}'`).join(", ")}) OR accion IN (${ACCIONES_CALIDAD.map((a) => `'${a}'`).join(", ")}))`;

const calidadTotal = (auth: Autorizacion) => !!permisoDe(auth, "calidad", "V", { objeto: "incidencia" })?.alcances.includes("total");

/* Sin calidad:V total, el motivo de lo que viene de una NC (justificaciones, suspensiones, retenciones) no se entrega. */
function sinMotivoDeCalidad(item: Row, total: boolean): Row {
  if (total || !(ENTIDADES_CALIDAD.has(String(item.entidad || "")) || ACCIONES_CALIDAD.includes(String(item.accion || "")))) return item;
  return { ...item, motivo: null };
}

function datosVisibles(auth: Autorizacion, entidad: unknown): boolean {
  if (ENTIDADES_CALIDAD.has(String(entidad || ""))) return calidadTotal(auth);
  const modulo = ENTITY_MODULE[String(entidad || "")];
  if (!modulo) return true;
  const permiso = permisoDe(auth, modulo, "V");
  return !!permiso && !(modulo === "muestras" && soloEstado(permiso));
}

function recortar(item: Row, visible: boolean): Row {
  if (visible) return item;
  // En calidad tambien el motivo (justificaciones, descripciones de NC) queda restringido.
  return { ...item, cambios: {}, datos_anteriores: null, datos_nuevos: null, datos_restringidos: true, ...(ENTIDADES_CALIDAD.has(String(item.entidad || "")) ? { motivo: null } : {}) };
}

function serialize(row: Row): Row {
  return {
    id: row.id,
    fecha_hora: row.fecha_hora,
    usuario_id: row.usuario_id,
    usuario_nombre: row.usuario_nombre,
    usuario_email: row.usuario_email,
    accion: row.accion,
    entidad: row.entidad,
    entidad_id: row.entidad_id,
    referencia: row.referencia,
    motivo: row.motivo,
    cambios: safeJsonLoad(row.cambios_json, {}),
    hash: row.hash,
    hash_anterior: row.hash_anterior ?? null,
  };
}

/* Modulo cuyo permiso de lectura da acceso al historial de cada entidad. */
const ENTITY_MODULE: Record<string, Modulo> = {
  muestras_recepcion: "muestras",
  muestras_procesamiento: "ensayos",
  muestras_extraccion: "ensayos",
  muestras_analisis: "ensayos",
  informes: "informes",
  documentos_sgc: "documentos",
  biblioteca_documentos: "documentos",
  biblioteca_categorias: "documentos",
  sgc_documentos: "documentos",
  reportes_mantenimiento: "equipos",
  reactivos: "inventario",
  consumibles: "inventario",
  equipos: "equipos",
  mantenimientos: "equipos",
  usuarios: "usuarios",
  roles: "usuarios",
  incidencias: "calidad",
  no_conformidades: "calidad",
  acciones_correctivas: "calidad",
  suspensiones: "calidad",
};

export async function listAudit({ request, s }: RouteContext): Promise<Response> {
  // Decision confirmada por el laboratorio: la bitacora no se exporta; se consulta solo dentro de la plataforma.
  if (searchParam(request, "formato")) return exportacionBitacoraRetirada();
  const user = await requireUser(request);
  const entidad = searchParam(request, "entidad");
  const entidadId = searchParam(request, "entidad_id");
  // El historial de un registro concreto lo puede ver quien puede leer el modulo
  // al que pertenece; todo lo demas requiere el permiso de auditoria.
  const modulo = entidad && entidadId ? ENTITY_MODULE[entidad] : undefined;
  const auth = await cargarAutorizacion(s, user);
  // Fase 11: el historial de una incidencia o NC lo ve quien ve ese registro (con alcance "incidencias", solo lo propio).
  const historialCalidad = !!(entidad && entidadId && ENTIDADES_CALIDAD.has(entidad));
  // Fase 12: el historial de cualquier registro aplica los alcances de su ficha (asignado, autorizados, propio); lo no visible es 404.
  if (entidad && entidadId && modulo) await exigirVerRegistro(s, user, auth, entidad, entidadId);
  else await requirePermission(s, user, "calidad", "V", undefined, auth);
  const accion = searchParam(request, "accion");
  const usuario = searchParam(request, "usuario");
  const search = searchParam(request, "search");
  const desde = searchParam(request, "desde");
  const hasta = searchParam(request, "hasta");
  // Fechas del filtro: AAAA-MM-DD (antes cualquier texto se comparaba como fecha y devolvía resultados arbitrarios).
  for (const [campo, valor] of [["desde", desde], ["hasta", hasta]] as const) if (valor && !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return json({ message: `La fecha «${campo}» debe ser AAAA-MM-DD`, campo }, 400);
  // `%` y `_` del texto buscado son literales.
  const comoTexto = (valor: string) => `%${valor.replace(/[!%_]/g, (x) => `!${x}`)}%`;
  // Se pide una fila de mas para saber si hay mas resultados.
  const limit = Math.min(Math.max(Number.parseInt(searchParam(request, "limit") || "200", 10) || 200, 1), 1000);
  // Fase 9: filtro por modulo (las entidades cuyo historial pertenece a ese modulo).
  const moduloFiltro = searchParam(request, "modulo");
  /*
   * Filtros de solo lectura para la vista de /auditoria (no cambian la bitacora):
   * `acciones` (lista separada por comas: tipos de actividad), `usuarios` (correos
   * separados por comas), `entidades` (registros de las areas elegidas),
   * `sin_accesos=1` (oculta inicios de sesion y reautenticaciones; siguen en la
   * bitacora) y `antes_de` (id: pagina siguiente, del mas reciente al mas antiguo).
   */
  const accionesLista = searchParam(request, "acciones").split(",").map((a) => a.trim()).filter((a) => /^[a-z_]{2,40}$/.test(a)).slice(0, 80);
  const usuariosLista = searchParam(request, "usuarios").split(",").map((u) => u.trim()).filter((u) => u && u.length <= 200).slice(0, 100);
  const entidadesLista = searchParam(request, "entidades").split(",").map((e) => e.trim()).filter((e) => /^[a-z_]{2,40}$/.test(e)).slice(0, 40);
  const sinAccesos = searchParam(request, "sin_accesos") === "1";
  const antesDe = Number.parseInt(searchParam(request, "antes_de") || "0", 10) || 0;
  // Documentos SGC restringidos o confidenciales que la persona no puede ver: sus eventos no se listan.
  const ocultos = await documentosOcultos(s, auth);
  const entidadesModulo = moduloFiltro ? Object.entries(ENTITY_MODULE).filter(([, m]) => m === moduloFiltro).map(([e]) => e) : [];

  const rows = await s.query<Row>(
    `
    SELECT id, fecha_hora, usuario_id, usuario_nombre, usuario_email, accion, entidad, entidad_id,
           referencia, motivo, cambios_json, hash, hash_anterior
    FROM auditoria
    WHERE (:entidad = '' OR entidad = :entidad)
      AND (:entidad_id = '' OR entidad_id = :entidad_id)
      AND (:accion = '' OR accion = :accion)
      AND (:usuario = '' OR usuario_email LIKE :usuario_like ESCAPE '!' OR usuario_nombre LIKE :usuario_like ESCAPE '!')
      AND (:search = '' OR referencia LIKE :search_like ESCAPE '!' OR usuario_nombre LIKE :search_like ESCAPE '!' OR (motivo LIKE :search_like ESCAPE '!'${calidadTotal(auth) || historialCalidad ? "" : ` AND NOT ${SQL_SENSIBLE_CALIDAD}`}))
      AND (:desde = '' OR fecha_hora >= :desde_ini)
      AND (:hasta = '' OR fecha_hora <= :hasta_fin)
      ${moduloFiltro ? `AND entidad IN (${entidadesModulo.map((e) => `'${e}'`).join(", ") || "''"})` : ""}
      ${accionesLista.length ? `AND accion IN (${accionesLista.map((_, i) => `:acc${i}`).join(", ")})` : ""}
      ${usuariosLista.length ? `AND usuario_email IN (${usuariosLista.map((_, i) => `:usr${i}`).join(", ")})` : ""}
      ${entidadesLista.length ? `AND entidad IN (${entidadesLista.map((_, i) => `:ent${i}`).join(", ")})` : ""}
      ${sinAccesos ? "AND accion NOT IN ('login', 'login_fallido', 'reauth_fallida', 'cerrar_sesiones')" : ""}
      ${antesDe ? "AND id < :antes_de" : ""}
      ${ocultos.length ? `AND NOT (entidad = 'sgc_documentos' AND entidad_id IN (${ocultos.map((_, i) => `:oc${i}`).join(", ")}))` : ""}
    ORDER BY id DESC
    LIMIT ${limit + 1}
    `,
    {
      entidad,
      entidad_id: entidadId,
      accion,
      usuario,
      usuario_like: comoTexto(usuario),
      search,
      search_like: comoTexto(search),
      desde,
      desde_ini: desde ? inicioDiaLocal(desde) : "",
      hasta,
      hasta_fin: hasta ? finDiaLocal(hasta) : "",
      antes_de: antesDe,
      ...Object.fromEntries(accionesLista.map((a, i) => [`acc${i}`, a])),
      ...Object.fromEntries(usuariosLista.map((u, i) => [`usr${i}`, u])),
      ...Object.fromEntries(entidadesLista.map((e, i) => [`ent${i}`, e])),
      ...Object.fromEntries(ocultos.map((o, i) => [`oc${i}`, o])),
    },
  );
  const truncado = rows.length > limit;
  if (truncado) rows.length = limit;
  const total = calidadTotal(auth) || historialCalidad;
  const items = rows.map((row) => sinMotivoDeCalidad(recortar(serialize(row), historialCalidad || datosVisibles(auth, row.entidad)), total));
  return json({ items, total: rows.length, truncado });
}

export async function getAuditEntry({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const auth = await cargarAutorizacion(s, user);
  await requirePermission(s, user, "calidad", "V", undefined, auth);
  const id = Number.parseInt(String(params.id || ""), 10);
  const row = await s.queryOne<Row>("SELECT * FROM auditoria WHERE id = :id", { id });
  if (!row) return json({ message: "Registro no encontrado" }, 404);
  if (row.entidad === "sgc_documentos" && (await documentosOcultos(s, auth)).includes(String(row.entidad_id))) return json({ message: "Registro no encontrado" }, 404);
  const item = {
    ...serialize(row),
    hash_anterior: row.hash_anterior,
    datos_anteriores: safeJsonLoad(row.datos_anteriores_json, null),
    datos_nuevos: safeJsonLoad(row.datos_nuevos_json, null),
  };
  return json({ item: sinMotivoDeCalidad(recortar(item, datosVisibles(auth, row.entidad)), calidadTotal(auth)) });
}

/*
 * Clave de una alteracion de la cadena: identifica el hecho (primera entrada
 * alterada o filas faltantes), para no repetir la alerta ni la incidencia en
 * cada verificacion.
 */
const PREFIJO_ALERTA_BITACORA = "bitacora:";
function claveAlteracion(r: AuditVerification): string {
  return `${PREFIJO_ALERTA_BITACORA}${r.primer_error ?? "-"}:${r.filas_faltantes_intermedias ?? 0}:${r.filas_faltantes_al_final ?? 0}:${r.triggers_ok === false ? "sin-proteccion" : "ok"}`;
}

/* Alteracion detectada: alerta en la bitacora e incidencia automatica (una sola vez por hecho). */
async function alertarAlteracionBitacora(s: Session, r: AuditVerification): Promise<void> {
  const clave = claveAlteracion(r);
  const ya = await s.scalar("SELECT id FROM auditoria WHERE accion = 'alerta_integridad' AND entidad = 'auditoria' AND referencia = :clave LIMIT 1", { clave });
  if (!ya) await registrarAuditoria(s, null, { accion: "alerta_integridad", entidad: "auditoria", entidadId: null, referencia: clave, detalle: { primer_error: r.primer_error, filas_faltantes_intermedias: r.filas_faltantes_intermedias ?? 0, filas_faltantes_al_final: r.filas_faltantes_al_final ?? 0, triggers_ok: r.triggers_ok } });
  await incidenciaPorAlertaIntegridad(s, { clave, descripcion: "La verificación automática detectó un posible cambio no autorizado en el registro de actividad (bitácora): pudo modificarse o borrarse información fuera de la plataforma.", registros: [] });
  await s.commit();
}

/* Hay una alerta de la bitacora sin resolver (incidencia automatica abierta): para el Inicio y la campana. */
/* La incidencia automatica abierta por un posible cambio no autorizado (id y cuando se reporto), si la hay. */
export async function alertaBitacora(s: Session): Promise<Row | null> {
  return (await s.queryOne<Row>("SELECT id, reportada_en FROM incidencias WHERE clave_automatica LIKE :prefijo AND estado IN ('reportada', 'en_evaluacion') ORDER BY id LIMIT 1", { prefijo: `alerta_integridad:${PREFIJO_ALERTA_BITACORA}%` })) ?? null;
}

/*
 * Integridad de la cadena de hashes (ISO/IEC 17025 7.11.3). Corre en segundo
 * plano al abrir Auditoría; si encuentra una alteracion, la registra y crea la
 * incidencia automatica. La pantalla solo avisa cuando hay un problema.
 */
export async function verifyAudit({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await requirePermission(s, user, "calidad", "V");
  const resultado = await verifyAuditChain(s);
  if (!resultado.ok) await alertarAlteracionBitacora(s, resultado);
  // Actas de restauracion con la verificacion 1 fallida (la pantalla Respaldos se retiro): alerta e incidencia automatica.
  if (await alertasDeRespaldo(s)) await s.commit();
  // Origen de la llave (nunca la llave) y advertencias para Respaldos y la verificacion de la instalacion.
  return json({ ...resultado, llave: { origen: origenLlaveBitacora(), advertencias: advertenciaLlaveBitacora() } });
}

export async function auditSummary({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await requirePermission(s, user, "calidad", "V");
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const summary = await s.queryOne(
    `
    SELECT
      (SELECT COUNT(*) FROM auditoria) AS total,
      (SELECT COUNT(*) FROM auditoria WHERE fecha_hora >= :since) AS ultimos_30_dias,
      (SELECT COUNT(*) FROM auditoria WHERE accion = 'anular') AS anulaciones,
      (SELECT COUNT(*) FROM auditoria WHERE accion = 'login_fallido' AND fecha_hora >= :since) AS accesos_fallidos_30_dias
    `,
    { since },
  );
  return json(summary || {});
}
