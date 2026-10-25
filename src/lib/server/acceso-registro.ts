import type { CurrentUser } from "./auth";
import { ensayoVisible, estaAsignado, soloAsignado } from "./asignaciones";
import { type Row, type Session } from "./db";
import { HttpError } from "./http";
import { documentosDistribuidosA, soloAutorizados } from "./modules/documentos-flujo";
import { exigirVerRegistroCalidad } from "./modules/calidad/acceso-historial";
import { accesoSgc, documentoVisible } from "./modules/sgc/acceso";
import { permisoDe, type Autorizacion } from "./rbac";
import type { Modulo } from "../shared/permisos";

/*
 * Fase 12: el historial (bitacora de un registro, su CSV y sus solicitudes) lo
 * ve quien ve la ficha de ese registro, con los mismos alcances:
 * - V del modulo del registro (sin el, 403 como antes);
 * - el registro debe existir (404);
 * - "asignado" (muestras y ensayos): solo lo de recepciones asignadas o lo registrado por la persona;
 * - "autorizados" (documentos): solo documentos vigentes distribuidos a la persona;
 * - Documentos SGC: el historial lo ve quien ve el historial de la ficha
 *   (documento_consultar_historico, crear fichas o diagnostico tecnico), con
 *   la confidencialidad del documento;
 * - "propio" (usuarios): solo la propia cuenta, sin el catalogo de roles;
 * - "incidencias" (calidad): lo propio (exigirVerRegistroCalidad);
 * - "estado" (muestras): la ficha es de seguimiento; el historial se ve, pero sin
 *   datos (lo recorta la bitacora, igual que antes).
 * Lo que no se puede ver responde 404, igual que si no existiera.
 */
export const MODULO_DE_REGISTRO: Record<string, Modulo> = {
  muestras_recepcion: "muestras",
  muestras_procesamiento: "ensayos",
  muestras_extraccion: "ensayos",
  muestras_analisis: "ensayos",
  informes: "informes",
  documentos_sgc: "documentos",
  biblioteca_documentos: "documentos",
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

const CALIDAD = new Set(["incidencias", "no_conformidades", "acciones_correctivas", "suspensiones"]);

export async function exigirVerRegistro(s: Session, user: CurrentUser, auth: Autorizacion, entidad: string, entidadId: string | number): Promise<void> {
  const id = Number.parseInt(String(entidadId), 10);
  if (CALIDAD.has(entidad)) return exigirVerRegistroCalidad(s, user, entidad, Number.isFinite(id) ? id : 0);
  if (entidad === "sgc_documentos") {
    const { vista } = await documentoVisible(s, await accesoSgc(s, auth), Number.isFinite(id) ? id : 0);
    if (!vista.historial) throw new HttpError(404, { message: "Registro no encontrado" });
    return;
  }
  const modulo = MODULO_DE_REGISTRO[entidad];
  const noEncontrado = new HttpError(404, { message: "Registro no encontrado" });
  if (!modulo) throw new HttpError(400, { message: "Ese tipo de registro no tiene historial propio" });
  const permiso = permisoDe(auth, modulo, "V");
  if (!permiso) throw new HttpError(403, { message: `Permiso denegado para ${modulo}:V`, required: { module: modulo, action: "V" } });
  if (!Number.isFinite(id) || String(id) !== String(entidadId).trim()) throw noEncontrado;
  const fila = await s.queryOne<Row>(`SELECT * FROM ${entidad} WHERE id = :id`, { id });
  if (!fila) throw noEncontrado;
  const yo = auth.userId;
  if (entidad === "muestras_recepcion" && soloAsignado(permiso) && Number(fila.creado_por) !== yo && !(await estaAsignado(s, yo, id))) throw noEncontrado;
  if ((entidad === "muestras_procesamiento" || entidad === "muestras_extraccion" || entidad === "muestras_analisis") && !(await ensayoVisible(s, permiso, entidad, fila))) throw noEncontrado;
  // Biblioteca: con "autorizados", solo documentos para todos o para alguno de sus roles.
  if (entidad === "biblioteca_documentos" && soloAutorizados(auth) && String(fila.visibilidad) !== "todos") {
    const roles = auth.roles.map((r) => Number(r.id));
    const permitidos = (await s.query<Row>("SELECT rol_id FROM biblioteca_visibilidad_roles WHERE documento_id = :id", { id })).map((r) => Number(r.rol_id));
    if (!permitidos.some((r) => roles.includes(r))) throw noEncontrado;
  }
  if (entidad === "documentos_sgc" && soloAutorizados(auth) && (String(fila.estado) !== "vigente" || !(await documentosDistribuidosA(s, yo)).includes(id))) throw noEncontrado;
  const soloPropio = permiso.alcances.length > 0 && permiso.alcances.every((a) => a === "propio");
  if (entidad === "usuarios" && soloPropio && id !== yo) throw noEncontrado;
  if (entidad === "roles" && soloPropio) throw noEncontrado;
}
