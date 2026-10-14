/*
 * Separacion de funciones (Fase 3; "Roles y permisos FICOTOX", secciones 2, 6 y 7).
 * Catalogo versionado de reglas de dos personas. Se evaluan en el SERVIDOR por
 * persona (id de usuario): no importa cuantos roles tenga ni con que cargo actue.
 *
 * "Elaboro" = quien creo el registro y cualquier persona que haya editado su
 * contenido tecnico (se toma de la bitacora del registro).
 *
 * Una excepcion aprobada por un segundo usuario (solicitud "excepcion_segregacion",
 * Fase 3 seccion 3) permite a una persona concreta una accion concreta sobre
 * un registro concreto; queda registrada en el registro y en la bitacora.
 */

export const VERSION_SEGREGACION = "2026-10-14.1";

export interface Violacion {
  regla: number;
  clave: string;
  /* Frase para la persona: "Elaboraste este analisis; lo debe revisar otra persona". */
  mensaje: string;
}

const ETIQUETA_ACCION: Record<string, string> = { revisar: "revisar", aprobar: "aprobar", autorizar: "autorizar", supervisar: "dar el visto bueno a", aprobar_solicitud: "aprobar", evaluar: "evaluar", verificar: "verificar", cerrar: "cerrar", reanudar: "reanudar" };
const lo = (accion: string) => ETIQUETA_ACCION[accion] || accion;

/* ¿Tiene esta persona una excepcion aprobada para esta accion? */
export interface ExcepcionSegregacion {
  solicitud_id: number;
  usuario_id: number;
  accion: string;
  aprobado_por?: number | null;
  aprobado_en?: string | null;
}
export const excepcionPara = (excepciones: ExcepcionSegregacion[] | null | undefined, usuarioId: number, accion: string): ExcepcionSegregacion | null =>
  (excepciones || []).find((e) => Number(e.usuario_id) === Number(usuarioId) && e.accion === accion) || null;

/* Regla 1: analisis. `elaboradores` incluye a quien lo creo y a quien lo edito. */
export function evaluarAnalisis(usuarioId: number, elaboradores: Iterable<number>, accion: "revisar" | "aprobar"): Violacion | null {
  if (![...elaboradores].some((id) => Number(id) === Number(usuarioId))) return null;
  return { regla: 1, clave: "analisis", mensaje: `Elaboraste este análisis; lo debe ${lo(accion)} otra persona` };
}

/* Regla 2: informe. `elaboradoresInforme` y los elaboradores de cada analisis incluido. */
export function evaluarInforme(usuarioId: number, elaboradoresInforme: Iterable<number>, elaboradoresAnalisis: Array<{ folio: string; elaboradores: Iterable<number> }>, accion: "revisar" | "autorizar"): Violacion | null {
  const yo = Number(usuarioId);
  if ([...elaboradoresInforme].some((id) => Number(id) === yo)) return { regla: 2, clave: "informe", mensaje: `Elaboraste este informe; lo debe ${lo(accion)} otra persona` };
  const propios = elaboradoresAnalisis.filter((a) => [...a.elaboradores].some((id) => Number(id) === yo)).map((a) => a.folio);
  if (propios.length) return { regla: 2, clave: "informe", mensaje: `Elaboraste ${propios.length === 1 ? "el análisis" : "los análisis"} ${propios.join(", ")} incluido${propios.length === 1 ? "" : "s"} en este informe; el Analista no valida ni libera su propio resultado. Lo debe ${lo(accion)} otra persona` };
  return null;
}

/* Nombre normalizado para comparar personas firmadas en un formato. */
const nombreNormalizado = (value: unknown): string =>
  String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/* Regla 3: procesamiento / extraccion: quien firma "superviso" no es quien proceso, extrajo o limpio. */
/* Fase 5: compara cuentas (usuario_id) cuando ambas firmas estan ligadas; si no, los nombres escritos. */
export function evaluarSupervisionCaptura(superviso: unknown, ejecutores: Array<{ etiqueta: string; nombre: unknown; usuarioId?: unknown }>, supervisoId?: unknown): Violacion | null {
  const supId = Number(supervisoId) || 0;
  const sup = nombreNormalizado(superviso);
  if (!sup && !supId) return null;
  const coincide = ejecutores.find((e) => {
    const id = Number(e.usuarioId) || 0;
    if (supId && id) return supId === id;
    return !!sup && !!nombreNormalizado(e.nombre) && nombreNormalizado(e.nombre) === sup;
  });
  if (!coincide) return null;
  return { regla: 3, clave: "supervision_captura", mensaje: `Quien supervisó no puede ser la misma persona que ${coincide.etiqueta}; debe firmar otra persona como supervisor` };
}

/* Regla 4: visto bueno del supervisor sobre lo capturado por otra persona. */
export function evaluarVistoBueno(usuarioId: number, capturadoPor: number | null | undefined): Violacion | null {
  if (capturadoPor === null || capturadoPor === undefined || Number(capturadoPor) !== Number(usuarioId)) return null;
  return { regla: 4, clave: "visto_bueno", mensaje: "Capturaste o editaste este registro; el visto bueno lo debe dar otra persona" };
}

/* Regla 5 (documentos SGC): retirada; ver REGLAS_SEGREGACION. */

/* Regla 6: segundo usuario. */
export function evaluarSegundoUsuario(usuarioId: number, solicitadoPor: number | null | undefined): Violacion | null {
  if (solicitadoPor === null || solicitadoPor === undefined || Number(solicitadoPor) !== Number(usuarioId)) return null;
  return { regla: 6, clave: "segundo_usuario", mensaje: "Solicitaste esta acción; la debe aprobar otra persona" };
}

/* Regla 7: quien reporto la incidencia no la evalua. */
export function evaluarIncidencia(usuarioId: number, reportadaPor: number | null | undefined): Violacion | null {
  if (reportadaPor === null || reportadaPor === undefined || Number(reportadaPor) !== Number(usuarioId)) return null;
  return { regla: 7, clave: "evaluar_incidencia", mensaje: "Reportaste esta incidencia; la debe evaluar otra persona" };
}

/*
 * Regla 8: quien es o fue responsable de una accion de la NC, o la marco como
 * implementada, no verifica su eficacia (reasignar la accion no la elude).
 */
export function evaluarVerificacion(usuarioId: number, participantesAcciones: Iterable<number | null | undefined>): Violacion | null {
  if (![...participantesAcciones].some((id) => id !== null && id !== undefined && Number(id) === Number(usuarioId))) return null;
  return { regla: 8, clave: "verificar_eficacia", mensaje: "Eres o fuiste responsable de una acción de esta NC (o la implementaste); su eficacia la debe verificar otra persona" };
}

/* Regla 9: el responsable de la NC no la cierra. */
/* Tambien quien lo fue antes: reasignar la NC no elude la regla. */
export function evaluarCierreNc(usuarioId: number, responsablesNc: Iterable<number | null | undefined>): Violacion | null {
  if (![...responsablesNc].some((id) => id !== null && id !== undefined && Number(id) === Number(usuarioId))) return null;
  return { regla: 9, clave: "cerrar_nc", mensaje: "Eres o fuiste el responsable de esta NC; la debe cerrar otra persona" };
}

/* Regla 10: quien suspendio no reanuda. */
export function evaluarReanudacion(usuarioId: number, suspendidaPor: number | null | undefined): Violacion | null {
  if (suspendidaPor === null || suspendidaPor === undefined || Number(suspendidaPor) !== Number(usuarioId)) return null;
  return { regla: 10, clave: "reanudar_trabajo", mensaje: "Suspendiste este trabajo; lo debe reanudar otra persona" };
}

/*
 * Regla 11 (Documentos SGC): elaborador, revisor y autorizador de una revision
 * son tres personas distintas, y nadie actua en un papel que no le fue asignado.
 */
export type PapelDocumento = "elaborador" | "revisor" | "autorizador";
const PAPEL_ARTICULO: Record<PapelDocumento, string> = { elaborador: "el elaborador", revisor: "el revisor", autorizador: "el autorizador" };

export function evaluarTresPersonas(ids: { elaborador_id?: number | null; revisor_id?: number | null; autorizador_id?: number | null }): Violacion | null {
  const lista = [ids.elaborador_id, ids.revisor_id, ids.autorizador_id].filter((x): x is number => x !== null && x !== undefined && Number(x) > 0).map(Number);
  if (new Set(lista).size === lista.length) return null;
  return { regla: 11, clave: "documento_tres_personas", mensaje: "Elaborador, revisor y autorizador deben ser tres personas distintas: nadie revisa ni autoriza lo que elaboró, ni autoriza lo que revisó" };
}

export function evaluarPapelDocumento(usuarioId: number, asignado: number | null | undefined, papel: PapelDocumento): Violacion | null {
  if (asignado !== null && asignado !== undefined && Number(asignado) === Number(usuarioId)) return null;
  return { regla: 11, clave: "documento_papel_asignado", mensaje: `No eres ${PAPEL_ARTICULO[papel]} asignado de esta revisión; solo actúa quien fue asignado por Mejora Continua` };
}
