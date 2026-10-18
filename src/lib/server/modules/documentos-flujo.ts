/*
 * Flujo anterior de control documental (Fase 7) — RETIRADO; el control
 * documental vigente es Documentos SGC (modules/sgc). Sus escrituras responden
 * 410 (ver src/lib/server/retirado.ts).
 *
 * Aqui solo queda la lectura que siguen usando el historial y las incidencias
 * de los documentos anteriores (sus tablas se conservan sin uso).
 */
import { type Row, type Session } from "../db";
import { permisoDe, type Autorizacion } from "../rbac";

const DISTRIBUCION = "distribucion_documento";

/* Distribucion de un documento anterior (quien confirmo la lectura), en solo lectura. */
export async function distribucionDe(s: Session, documentoId: number): Promise<Row[]> {
  return s.query<Row>(`SELECT x.usuario_id, u.nombre, u.email, x.distribuido_en, x.leido_en FROM ${DISTRIBUCION} x LEFT JOIN usuarios u ON u.id = x.usuario_id WHERE x.documento_id = :doc ORDER BY u.nombre`, { doc: documentoId });
}

/*
 * Alcance "autorizados" de documentos:V (Estudiante). En la Biblioteca (retirada) limitaba a
 * los documentos visibles para todos o para su rol; sobre los documentos del
 * flujo anterior (solo lectura) conserva su regla: vigentes que le fueron distribuidos.
 */
export function soloAutorizados(auth: Autorizacion): boolean {
  // Migracion 22: cualquier accion documental da documentos:V total, asi que el alcance ya no distingue.
  // Los registros heredados (flujo anterior y Biblioteca) conservan la regla restrictiva para todos,
  // salvo quien consulta el historico o crea fichas (Mejora Continua, coordinaciones, auditoria).
  if (!permisoDe(auth, "documentos", "V")) return false;
  return !permisoDe(auth, "documentos", "documento_consultar_historico") && !permisoDe(auth, "documentos", "documento_crear_ficha");
}

export async function documentosDistribuidosA(s: Session, usuarioId: number): Promise<number[]> {
  return (await s.query<{ documento_id: number }>(`SELECT DISTINCT documento_id FROM ${DISTRIBUCION} WHERE usuario_id = :u`, { u: usuarioId })).map((f) => Number(f.documento_id));
}
