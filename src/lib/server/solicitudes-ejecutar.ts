import { requireUser, userIdFromClaims } from "./auth";
import { snapshotRow } from "./audit";
import { HttpError, readJson, type RouteContext } from "./http";
import { cargarAutorizacion } from "./rbac";
import { anularRegistro, folioLabel, opcionesAnulacion, restaurarRegistro, type SampleTable } from "./samples-flow";
import { excepcionesDe, registrarExcepcion, TABLAS_CON_EXCEPCION, type TablaConExcepcion } from "./segregacion";
import { excepcionPara, type Violacion } from "../shared/segregacion";
import type { CurrentUser } from "./auth";
import type { Row, Session } from "./db";
import { exigirReauth } from "./seguridad";
import { aprobarSolicitudCon, crearSolicitud, detalleSolicitud, respuestaSolicitud, type Ejecutores } from "./solicitudes";
import { ejecutarAmpliacionPermisosRol, ejecutarAmpliacionVigencia, ejecutarAsignacionRol, ejecutarReactivacion } from "./modules/admin";
import { ejecutarAnulacionInforme, informeFolio, violacionParaExcepcionInforme } from "./modules/informes";
import { violacionParaExcepcionAnalisis } from "./modules/samples/analisis";
import { ejecutarCambioFolio, ejecutarDecisionRecepcion, ejecutarReapertura } from "./modules/samples/recepcion";
import { ejecutarAnulacionCalidad, violacionParaExcepcionNc, violacionParaExcepcionSuspension } from "./modules/calidad/nc";
import { violacionParaExcepcionIncidencia } from "./modules/calidad/incidencias";
import { ejecutarObsolescencia } from "./modules/sgc/flujo";
import { ejecutarRestauracionRespaldo } from "./modules/respaldos";

/*
 * Que hace el servidor cuando un segundo usuario aprueba cada tipo de
 * solicitud (Fase 3). Se importa desde las rutas de /api/solicitudes; vive
 * aparte de solicitudes.ts para que los modulos puedan importar el nucleo sin
 * ciclos.
 */

const TABLAS_MUESTRAS = new Set<string>(["muestras_recepcion", "muestras_procesamiento", "muestras_extraccion", "muestras_analisis"]);

const referenciaDe = async (ctx: Parameters<NonNullable<Ejecutores["anular_registro"]>>[0]) => {
  const row = await snapshotRow(ctx.s, ctx.solicitud.entidad, Number(ctx.solicitud.entidad_id));
  return row;
};

const EJECUTORES: Ejecutores = {
  anular_registro: async (ctx) => {
    if (!TABLAS_MUESTRAS.has(ctx.solicitud.entidad)) throw new HttpError(409, { message: "La solicitud no corresponde a un registro del flujo de muestras" });
    const table = ctx.solicitud.entidad as SampleTable;
    const id = Number(ctx.solicitud.entidad_id);
    const row = await anularRegistro(ctx.s, ctx.user, table, id, ctx.solicitud.motivo, { ...opcionesAnulacion(ctx.s, table, id), actuo: ctx.actuo, detalle: detalleSolicitud(ctx.solicitud) });
    return { item: row, referencia: folioLabel(table, row) };
  },
  restaurar_registro: async (ctx) => {
    if (!TABLAS_MUESTRAS.has(ctx.solicitud.entidad)) throw new HttpError(409, { message: "La solicitud no corresponde a un registro del flujo de muestras" });
    const table = ctx.solicitud.entidad as SampleTable;
    const id = Number(ctx.solicitud.entidad_id);
    const row = await restaurarRegistro(ctx.s, ctx.user, table, id, ctx.solicitud.motivo, ctx.actuo, detalleSolicitud(ctx.solicitud));
    return { item: row, referencia: folioLabel(table, row) };
  },
  anular_informe: async (ctx) => {
    const row = await ejecutarAnulacionInforme(ctx.s, ctx.user, Number(ctx.solicitud.entidad_id), ctx.solicitud.motivo, ctx.actuo, detalleSolicitud(ctx.solicitud));
    return { item: row, referencia: informeFolio(row) };
  },
  excepcion_segregacion: async (ctx) => {
    const tabla = ctx.solicitud.entidad as TablaConExcepcion;
    if (!TABLAS_CON_EXCEPCION.includes(tabla)) throw new HttpError(409, { message: "La solicitud no corresponde a un registro con segregación de funciones" });
    const excepcion = { solicitud_id: ctx.solicitud.id, usuario_id: Number(ctx.solicitud.solicitado_por), accion: String(ctx.datos.accion || ctx.solicitud.accion), aprobado_por: userIdFromClaims(ctx.user), aprobado_en: new Date().toISOString() };
    await registrarExcepcion(ctx.s, tabla, Number(ctx.solicitud.entidad_id), excepcion);
    const row = await referenciaDe(ctx);
    return { excepcion, item: row };
  },
  asignar_rol: ejecutarAsignacionRol,
  reactivar_cuenta: ejecutarReactivacion,
  ampliar_vigencia: ejecutarAmpliacionVigencia,
  ampliar_permisos_rol: ejecutarAmpliacionPermisosRol,
  decision_recepcion: ejecutarDecisionRecepcion,
  cambiar_folio: ejecutarCambioFolio,
  reabrir_recepcion: ejecutarReapertura,
  // Fase 11: anular una incidencia o una NC.
  anular_calidad: (ctx) => ejecutarAnulacionCalidad({ s: ctx.s, user: ctx.user, actuo: ctx.actuo, solicitud: ctx.solicitud, motivo: ctx.motivo }),
  // Documentos SGC (Fase 2): declarar obsoleto sin reemplazo.
  obsoletar_documento_sgc: ejecutarObsolescencia,
  // Restaurar la plataforma desde un respaldo: se programa al aprobarse (corre al terminar la transaccion).
  restaurar_respaldo: ejecutarRestauracionRespaldo,
};

export const aprobarSolicitud = aprobarSolicitudCon(EJECUTORES);

// Fase 11: evaluar (incidencia, regla 7), verificar y cerrar (NC, reglas 8 y 9), reanudar (suspension, regla 10).
const ACCIONES_EXCEPCION = new Set(["revisar", "aprobar", "autorizar", "evaluar", "verificar", "cerrar", "reanudar"]);
type EvaluadorExcepcion = (s: Session, user: CurrentUser, id: number, accion: string) => Promise<{ violacion: Violacion | null; row: Row; referencia: string }>;
const EVALUADORES_CALIDAD: Record<string, EvaluadorExcepcion> = {
  incidencias: violacionParaExcepcionIncidencia,
  no_conformidades: violacionParaExcepcionNc,
  suspensiones: violacionParaExcepcionSuspension,
};

/*
 * POST /api/solicitudes: hoy solo el tipo "excepcion_segregacion" se pide de
 * forma explicita (los demas nacen de la accion que los requiere). La persona
 * que elaboro un analisis, informe o documento pide poder revisarlo, aprobarlo
 * o autorizarlo por falta de personal; la aprueba quien tiene A en calidad.
 */
export async function solicitarExcepcion({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  await cargarAutorizacion(s, user);
  const payload = await readJson(request);
  if (String(payload.tipo || "excepcion_segregacion") !== "excepcion_segregacion") throw new HttpError(400, { message: "Solo se solicita de forma explícita la excepción de segregación; las demás acciones críticas crean su solicitud al pedirse" });
  const entidad = String(payload.entidad || "");
  if (!TABLAS_CON_EXCEPCION.includes(entidad as TablaConExcepcion)) throw new HttpError(400, { message: "La excepción de segregación aplica a análisis, informes, incidencias, no conformidades y suspensiones" });
  const accion = String(payload.accion || "");
  if (!ACCIONES_EXCEPCION.has(accion)) throw new HttpError(400, { message: "Indica la acción: revisar, aprobar, autorizar, evaluar, verificar, cerrar o reanudar" });
  const id = Number.parseInt(String(payload.entidad_id || ""), 10);
  if (!Number.isFinite(id)) throw new HttpError(404, { message: "Registro no encontrado" });
  /*
   * Solo la pide quien podria hacer la accion (permiso del modulo y estado del
   * registro) y a quien la segregacion se la impide de verdad.
   */
  const calidad = EVALUADORES_CALIDAD[entidad];
  const evaluar = entidad === "muestras_analisis" ? violacionParaExcepcionAnalisis : violacionParaExcepcionInforme;
  const { violacion, row, referencia: referenciaCalidad } = calidad ? await calidad(s, user, id, accion) : { ...(await evaluar(s, user, id, accion)), referencia: null as string | null };
  if (!violacion) throw new HttpError(409, { message: `La separación de funciones no te impide ${accion} este registro; no necesitas una excepción`, codigo: "excepcion_innecesaria" });
  if (excepcionPara(excepcionesDe(row), userIdFromClaims(user) as number, accion)) throw new HttpError(409, { message: `Ya tienes una excepción aprobada para ${accion} este registro`, codigo: "excepcion_innecesaria" });
  const referencia = referenciaCalidad || (entidad === "informes" ? informeFolio(row) : folioLabel(entidad as SampleTable, row));
  await exigirReauth(s, request, user, "solicitudes:excepcion");
  const solicitud = await crearSolicitud(s, user, { tipo: "excepcion_segregacion", entidad, entidadId: id, referencia, accion: "excepcion", datos: { accion }, motivo: String(payload.motivo || "") });
  await s.commit();
  return respuestaSolicitud(solicitud, `la excepción para ${accion} ${referencia}`);
}
