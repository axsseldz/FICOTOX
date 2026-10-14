/*
 * Documentos SGC: quien ve que (el servidor es la autoridad; la interfaz solo
 * oculta o deshabilita).
 *
 * - El rol HABILITA (acciones documentales del modulo "documentos"); sobre una
 *   revision actua solo quien esta ASIGNADO en ella (elaborador, revisor,
 *   autorizador).
 * - Confidencialidad "restringido" y "confidencial": solo la ven Mejora
 *   Continua y Responsable General (por la clave estable de su rol), el
 *   propietario, los asignados en alguna revision y los destinatarios de la
 *   distribucion. Para los demas el documento no existe (404), tambien por URL
 *   directa y en el buscador.
 * - Con solo documento_consultar_vigente se ve unicamente la revision vigente;
 *   los borradores y las obsoletas requieren documento_consultar_historico (o
 *   crear fichas) o estar asignado en esa revision.
 * - Administracion tecnica (usuarios:G) sin acciones documentales: solo
 *   metadatos de los documentos de uso interno, para diagnostico; nunca abre
 *   archivos.
 */
import { type Row, type Session } from "../../db";
import { HttpError } from "../../http";
import { permisoDe, type Autorizacion } from "../../rbac";
import { ACCION_DOCUMENTAL_KEYS, type AccionDocumental } from "../../../shared/permisos";

/* Roles que ven todos los documentos, sin importar la confidencialidad. */
export const ROLES_CONFIDENCIALES = ["mejora_continua", "responsable_general"];

export interface AccesoSgc {
  auth: Autorizacion;
  yo: number;
  acciones: Set<AccionDocumental>;
  /* Mejora Continua o Responsable General (rol vigente). */
  privilegiado: boolean;
  /* Solo metadatos para diagnostico (usuarios:G sin acciones documentales). */
  diagnostico: boolean;
  rolIds: number[];
  /* Revisiones donde la persona es destinataria (distribucion vigente; Fase 3). */
  destinatarioDe: Set<number>;
  /* Documentos con una renovacion en curso donde la persona es revisor o autorizador (Fase 2). */
  renovacionDe: Set<number>;
}

export const tiene = (a: AccesoSgc, accion: AccionDocumental) => a.acciones.has(accion);

export async function accesoSgc(s: Session, auth: Autorizacion): Promise<AccesoSgc> {
  const acciones = new Set<AccionDocumental>(ACCION_DOCUMENTAL_KEYS.filter((accion) => !!permisoDe(auth, "documentos", accion)));
  const diagnostico = !acciones.size && !!permisoDe(auth, "usuarios", "G");
  if (!acciones.size && !diagnostico) throw new HttpError(403, { message: "No tienes permiso para Documentos SGC", codigo: "sin_permiso", required: { module: "documentos", action: "documento_consultar_vigente" } });
  const rolIds = auth.roles.map((r) => Number(r.id));
  const params: Record<string, unknown> = { yo: auth.userId };
  rolIds.forEach((id, i) => (params[`r${i}`] = id));
  const porRol = rolIds.length ? ` OR rol_id IN (${rolIds.map((_, i) => `:r${i}`).join(", ")})` : "";
  const dist = await s.query<Row>(`SELECT DISTINCT revision_id FROM sgc_distribucion WHERE retirado_en IS NULL AND (usuario_id = :yo${porRol})`, params);
  const renov = await s.query<Row>("SELECT DISTINCT documento_id FROM sgc_renovaciones WHERE estado IN ('en_revision', 'en_autorizacion') AND (revisor_id = :yo OR autorizador_id = :yo)", { yo: auth.userId });
  return {
    auth,
    yo: auth.userId,
    acciones,
    privilegiado: auth.roles.some((r) => !!r.clave && ROLES_CONFIDENCIALES.includes(r.clave)),
    diagnostico,
    rolIds,
    destinatarioDe: new Set(dist.map((d) => Number(d.revision_id))),
    renovacionDe: new Set(renov.map((d) => Number(d.documento_id))),
  };
}

/* Una asignacion cuenta mientras la revision esta en el flujo o vigente; en una cancelada u obsoleta ya no abre el documento. */
const ESTADOS_ACTIVOS = new Set(["borrador", "en_revision", "en_autorizacion", "autorizada", "vigente"]);
const asignadoEn = (a: AccesoSgc, rev: Row) => [rev.elaborador_id, rev.revisor_id, rev.autorizador_id].some((u) => u !== null && u !== undefined && Number(u) === a.yo);

/* ¿Que puede ver la persona de un documento? (con todas sus revisiones cargadas) */
export interface VistaDocumento {
  ficha: boolean;
  /* Revisiones visibles (ids). */
  revisiones: Set<number>;
  /* Revisiones cuyos archivos puede abrir (ids). */
  archivos: Set<number>;
  /* Historial completo y eventos de la bitacora. */
  historial: boolean;
  /* Ve el documento solo por diagnostico tecnico (sin abrir archivos). */
  soloDiagnostico: boolean;
}

export function vistaDocumento(a: AccesoSgc, doc: Row, revisiones: Row[]): VistaDocumento {
  const nada: VistaDocumento = { ficha: false, revisiones: new Set(), archivos: new Set(), historial: false, soloDiagnostico: false };
  const propio = doc.propietario_id !== null && doc.propietario_id !== undefined && Number(doc.propietario_id) === a.yo;
  const asignado = revisiones.some((r) => ESTADOS_ACTIVOS.has(String(r.estado)) && asignadoEn(a, r)) || a.renovacionDe.has(Number(doc.id));
  const destinatario = revisiones.some((r) => a.destinatarioDe.has(Number(r.id)));
  const confidencial = String(doc.confidencialidad || "uso_interno") !== "uso_interno";
  if (confidencial && !(a.privilegiado || propio || asignado || destinatario)) return nada;
  const historico = tiene(a, "documento_consultar_historico") || tiene(a, "documento_crear_ficha");
  // Obsoleto: fuera de los puntos de uso; solo lo consulta quien ve el historico (o el diagnostico tecnico).
  if (doc.estado === "obsoleto" && !historico && !a.diagnostico) return nada;
  const consulta = tiene(a, "documento_consultar_vigente");
  const visibles = new Set<number>();
  const archivos = new Set<number>();
  for (const rev of revisiones) {
    const id = Number(rev.id);
    const vigente = rev.estado === "vigente";
    const ve = historico || asignadoEn(a, rev) || (vigente && (consulta || propio || a.destinatarioDe.has(id)));
    if (ve) {
      visibles.add(id);
      archivos.add(id);
    } else if (a.diagnostico) visibles.add(id);
  }
  const ficha = historico || asignado || propio || destinatario || archivos.size > 0 || a.diagnostico;
  if (!ficha) return nada;
  return { ficha, revisiones: visibles, archivos, historial: historico || a.diagnostico, soloDiagnostico: a.diagnostico && archivos.size === 0 };
}

/* Documento con sus revisiones; 404 si no existe o la persona no lo puede ver (como si no existiera). */
export async function documentoVisible(s: Session, a: AccesoSgc, id: number): Promise<{ doc: Row; revisiones: Row[]; vista: VistaDocumento }> {
  const noExiste = new HttpError(404, { message: "Documento no encontrado" });
  if (!Number.isInteger(id) || id <= 0) throw noExiste;
  const doc = await s.queryOne<Row>("SELECT * FROM sgc_documentos WHERE id = :id", { id });
  if (!doc) throw noExiste;
  const revisiones = await s.query<Row>("SELECT * FROM sgc_revisiones WHERE documento_id = :id ORDER BY numero DESC", { id });
  const vista = vistaDocumento(a, doc, revisiones);
  if (!vista.ficha) throw noExiste;
  return { doc, revisiones, vista };
}

/*
 * Documentos restringidos o confidenciales que la persona NO puede ver (ids
 * como texto, como se guardan en auditoria.entidad_id): la bitacora global y
 * sus entradas sueltas los ocultan, igual que la ficha.
 */
export async function documentosOcultos(s: Session, auth: Autorizacion): Promise<string[]> {
  const docs = await s.query<Row>("SELECT * FROM sgc_documentos WHERE confidencialidad <> 'uso_interno'");
  if (!docs.length) return [];
  let a: AccesoSgc | null = null;
  try {
    a = await accesoSgc(s, auth);
  } catch {
    return docs.map((d) => String(d.id));
  }
  const revs = await s.query<Row>(`SELECT * FROM sgc_revisiones WHERE documento_id IN (${docs.map((_, i) => `:d${i}`).join(", ")})`, Object.fromEntries(docs.map((d, i) => [`d${i}`, d.id])));
  return docs.filter((d) => !vistaDocumento(a!, d, revs.filter((r) => Number(r.documento_id) === Number(d.id))).ficha).map((d) => String(d.id));
}
