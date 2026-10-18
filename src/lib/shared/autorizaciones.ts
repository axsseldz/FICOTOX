/*
 * Autorizaciones del personal (FX-THF-AP, Fase 4). Ademas del rol, cada persona
 * solo opera los metodos, equipos y actividades para los que esta autorizada,
 * con vigencia. Catalogo compartido por el servidor (validacion al guardar) y la
 * interfaz (avisos al abrir un formato).
 */
import { esFechaSola } from "./fechas";

export type TipoAutorizacion = "metodo" | "equipo" | "actividad";

export const TIPOS_AUTORIZACION: Array<{ value: TipoAutorizacion; label: string }> = [
  { value: "actividad", label: "Actividad" },
  { value: "metodo", label: "Método" },
  { value: "equipo", label: "Equipo" },
];

/* Metodos: los mismos tipos de analisis que ya existen (src/lib/shared/sgc.ts). */
export const METODOS_AUTORIZABLES: Array<{ value: string; label: string; tipo_analisis: string }> = [
  { value: "ASP", label: "ASP (ácido domoico)", tipo_analisis: "acido_domoico" },
  { value: "DSP", label: "DSP (toxinas lipofílicas)", tipo_analisis: "toxinas_lipofilicas" },
  { value: "PSP", label: "PSP (toxinas paralizantes)", tipo_analisis: "toxinas_paralizantes" },
  { value: "pigmentos", label: "Pigmentos", tipo_analisis: "pigmentos" },
  { value: "plancton", label: "Plancton", tipo_analisis: "plancton" },
  { value: "otro", label: "Otro", tipo_analisis: "otro" },
];

export const ACTIVIDADES_AUTORIZABLES: Array<{ value: string; label: string }> = [
  { value: "recepcion", label: "Recepción de muestras" },
  { value: "procesamiento", label: "Procesamiento" },
  { value: "extraccion", label: "Extracción" },
  { value: "analisis", label: "Análisis (capturar resultados)" },
  { value: "revision_resultados", label: "Revisión de resultados" },
  { value: "aprobacion_resultados", label: "Aprobación de resultados" },
  { value: "revision_informe", label: "Revisión de informes" },
  { value: "autorizacion_informe", label: "Autorización de informes" },
  // Fase 6: liberar el informe (PDF final) es una actividad aparte de autorizarlo.
  { value: "liberacion_informe", label: "Liberación de informes" },
];

/* Texto para el mensaje "No tienes autorización vigente para ..." */
const FRASE_ACTIVIDAD: Record<string, string> = {
  recepcion: "recepción de muestras",
  procesamiento: "procesamiento",
  extraccion: "extracción",
  analisis: "análisis",
  revision_resultados: "revisar resultados",
  aprobacion_resultados: "aprobar resultados",
  revision_informe: "revisar informes",
  autorizacion_informe: "autorizar informes",
  liberacion_informe: "liberar informes",
};

export interface Requisito {
  tipo: TipoAutorizacion;
  clave: string;
  /* Texto de lo que falta, p. ej. "extracción DSP" o "el equipo CE1". */
  texto: string;
}

export interface AutorizacionPersonal {
  id: number;
  usuario_id: number;
  tipo: TipoAutorizacion;
  clave: string;
  vigente_desde: string;
  vigente_hasta: string | null;
  folio_fx_thf_ap: string | null;
  otorgada_por: number | null;
  otorgada_rol: string | null;
  otorgada_en: string | null;
  motivo: string | null;
  revocada_en: string | null;
  revocada_por: number | null;
  motivo_revocacion: string | null;
  /* Calculados al serializar. */
  estado?: EstadoAutorizacion;
  etiqueta?: string;
}

export type EstadoAutorizacion = "vigente" | "por_iniciar" | "vencida" | "revocada";

export const ETIQUETA_ESTADO_AUTORIZACION: Record<EstadoAutorizacion, string> = {
  vigente: "Vigente",
  por_iniciar: "Por iniciar",
  vencida: "Vencida",
  revocada: "Revocada",
};

export const metodoDeTipoAnalisis = (tipoAnalisis: unknown): string | null => METODOS_AUTORIZABLES.find((m) => m.tipo_analisis === String(tipoAnalisis || ""))?.value || null;

/* Tipo de extraccion -> metodo: E-A es ASP y E-D es DSP. */
export const metodoDeExtraccion = (tipoRegistro: unknown): string | null => {
  const tipo = String(tipoRegistro || "").toUpperCase();
  return tipo === "E-A" ? "ASP" : tipo === "E-D" ? "DSP" : null;
};

const etiquetaMetodo = (clave: string): string => METODOS_AUTORIZABLES.find((m) => m.value === clave)?.label || clave;
const etiquetaActividad = (clave: string): string => ACTIVIDADES_AUTORIZABLES.find((a) => a.value === clave)?.label || clave;

export function etiquetaAutorizacion(tipo: string, clave: string, equipo?: string | null): string {
  if (tipo === "actividad") return etiquetaActividad(clave);
  if (tipo === "metodo") return `Método ${etiquetaMetodo(clave)}`;
  return `Equipo ${equipo || `#${clave}`}`;
}

/* Estado de una autorizacion en el dia `hoy` (AAAA-MM-DD, dia local del laboratorio). */
export function estadoAutorizacion(a: Pick<AutorizacionPersonal, "revocada_en" | "vigente_desde" | "vigente_hasta">, hoy: string): EstadoAutorizacion {
  if (a.revocada_en) return "revocada";
  const desde = String(a.vigente_desde || "").slice(0, 10);
  const hasta = a.vigente_hasta ? String(a.vigente_hasta).slice(0, 10) : null;
  if (esFechaSola(desde) && desde > hoy) return "por_iniciar";
  if (hasta && esFechaSola(hasta) && hasta < hoy) return "vencida";
  return "vigente";
}

/* ---------- Requisitos por formato ---------- */

const actividad = (clave: string, complemento = ""): Requisito => ({ tipo: "actividad", clave, texto: `${FRASE_ACTIVIDAD[clave] || clave}${complemento ? ` ${complemento}` : ""}` });
const metodo = (clave: string | null, frase: string): Requisito[] => (clave ? [{ tipo: "metodo", clave, texto: `${frase} ${clave}` }] : []);
export const requisitoEquipo = (id: number | string, nombre: string): Requisito => ({ tipo: "equipo", clave: String(id), texto: `el equipo ${nombre}` });

export function requisitosRecepcion(): Requisito[] {
  return [actividad("recepcion")];
}

export function requisitosProcesamiento(): Requisito[] {
  return [actividad("procesamiento")];
}

/* Extraccion: actividad + metodo del tipo (E-A ASP, E-D DSP). Los equipos se agregan aparte. */
export function requisitosExtraccion(tipoRegistro: unknown): Requisito[] {
  const m = metodoDeExtraccion(tipoRegistro);
  return [actividad("extraccion"), ...metodo(m, "extracción")];
}

/* Analisis: actividad + metodo del tipo de analisis. El equipo se agrega aparte. */
export function requisitosAnalisis(tipoAnalisis: unknown): Requisito[] {
  const m = metodoDeTipoAnalisis(tipoAnalisis);
  return [actividad("analisis"), ...metodo(m, "análisis")];
}

export function requisitosRevisionResultados(tipoAnalisis: unknown, accion: "revisar" | "aprobar"): Requisito[] {
  const m = metodoDeTipoAnalisis(tipoAnalisis);
  return [actividad(accion === "revisar" ? "revision_resultados" : "aprobacion_resultados"), ...metodo(m, accion === "revisar" ? "revisar resultados" : "aprobar resultados")];
}

export function requisitosInforme(accion: "revisar" | "autorizar" | "liberar"): Requisito[] {
  return [actividad(accion === "revisar" ? "revision_informe" : accion === "autorizar" ? "autorizacion_informe" : "liberacion_informe")];
}

/* Requisitos que no cubre ninguna autorizacion vigente. */
export function faltantes(requisitos: Requisito[], vigentes: Array<Pick<AutorizacionPersonal, "tipo" | "clave">>): Requisito[] {
  const tiene = new Set(vigentes.map((a) => `${a.tipo}:${a.clave}`));
  return requisitos.filter((r) => !tiene.has(`${r.tipo}:${r.clave}`));
}

export const mensajeFaltante = (requisitos: Requisito[]): string =>
  requisitos.length ? `No tienes autorización vigente para ${requisitos.map((r) => r.texto).join(", ")} (FX-THF-AP)` : "";
