import { formatearFolio } from "./folios";
/*
 * Calidad (Fase 11; FX-MO-2-1 secciones 4 y 5, ISO/IEC 17025 7.10 y 8.7):
 * incidencias, no conformidades (NC), acciones correctivas, comunicaciones con
 * el cliente, suspensiones de trabajo y retencion de informes. Catalogos
 * compartidos entre servidor e interfaz.
 */

export interface Opcion {
  value: string;
  label: string;
  hint?: string;
}

const etiquetas = (lista: readonly Opcion[]): Record<string, string> => Object.fromEntries(lista.map((o) => [o.value, o.label]));

/* ---------- Incidencias ---------- */

export const TIPOS_INCIDENCIA: Opcion[] = [
  { value: "desviacion_metodo", label: "Desviación del método" },
  { value: "falla_equipo", label: "Falla de equipo" },
  { value: "condicion_ambiental", label: "Condición ambiental" },
  { value: "muestra_custodia", label: "Muestra o cadena de custodia" },
  { value: "insumo", label: "Reactivo o insumo" },
  { value: "seguridad", label: "Seguridad" },
  { value: "sistema", label: "Sistema (plataforma, archivos)" },
  { value: "queja_cliente", label: "Queja del cliente" },
  { value: "otro", label: "Otro" },
];
export const TIPO_INCIDENCIA_LABEL = etiquetas(TIPOS_INCIDENCIA);

export const ESTADOS_INCIDENCIA: Record<string, { label: string; tone: "neutral" | "brand" | "warning" | "success" | "danger" | "ink" }> = {
  reportada: { label: "Reportada", tone: "brand" },
  en_evaluacion: { label: "En evaluación", tone: "warning" },
  cerrada_sin_nc: { label: "Cerrada sin NC", tone: "success" },
  escalada_a_nc: { label: "Escalada a NC", tone: "brand" },
  anulada: { label: "Anulada", tone: "danger" },
};

export const IMPACTOS: Opcion[] = [
  { value: "si", label: "Sí afecta resultados" },
  { value: "no", label: "No afecta resultados" },
  { value: "desconocido", label: "No se sabe todavía" },
];
export const IMPACTO_LABEL = etiquetas(IMPACTOS);

const ORIGENES_AUTOMATICOS: Opcion[] = [
  { value: "desviacion_recepcion", label: "Recepción aceptada con desviación" },
  { value: "rechazo_recepcion", label: "Recepción rechazada" },
  { value: "equipo_no_apto", label: "Uso de un equipo no apto o con calibración vencida" },
  { value: "alerta_integridad", label: "Alerta de integridad (PDF, evidencia o respaldo)" },
];
export const ORIGEN_AUTOMATICO_LABEL = etiquetas(ORIGENES_AUTOMATICOS);

export const DESCRIPCION_INCIDENCIA_MIN = 20;

/* Registros que se pueden ligar a una incidencia (tabla -> etiqueta y ruta de su ficha). */
export const ENTIDADES_RELACIONABLES: Record<string, { label: string; ruta: (id: number | string) => string }> = {
  muestras_recepcion: { label: "Recepción", ruta: (id) => `/muestras/recepcion/${id}` },
  muestras_procesamiento: { label: "Procesamiento", ruta: (id) => `/muestras/procesamiento/${id}` },
  muestras_extraccion: { label: "Extracción", ruta: (id) => `/muestras/extraccion/${id}` },
  muestras_analisis: { label: "Análisis", ruta: (id) => `/muestras/analisis/${id}` },
  informes: { label: "Informe", ruta: (id) => `/informes/${id}` },
  equipos: { label: "Equipo", ruta: () => "/inventario/equipos" },
  reactivos: { label: "Reactivo", ruta: () => "/inventario/reactivos" },
  consumibles: { label: "Consumible", ruta: () => "/inventario/consumibles" },
  // Documentos SGC (migracion 22).
  sgc_documentos: { label: "Documento SGC", ruta: (id) => `/documentos/${id}` },
  // Retirados (flujo anterior y Biblioteca): sus registros ligados se conservan; ya no tienen pantalla.
  documentos_sgc: { label: "Documento (anterior)", ruta: () => "/documentos" },
  biblioteca_documentos: { label: "Documento de la biblioteca (retirada)", ruta: () => "/documentos" },
};

/* ---------- No conformidades ---------- */

export const ORIGENES_NC: Opcion[] = [
  { value: "incidencia", label: "Incidencia" },
  { value: "queja", label: "Queja del cliente" },
  { value: "auditoria_interna", label: "Auditoría interna" },
  { value: "revision", label: "Revisión (dirección, resultados, registros)" },
  { value: "otro", label: "Otro" },
];
export const ORIGEN_NC_LABEL = etiquetas(ORIGENES_NC);

/* Clasificacion (por validar con Mejora Continua). */
export const CLASIFICACIONES_NC: Opcion[] = [
  { value: "menor", label: "Menor", hint: "No afecta la validez de los resultados" },
  { value: "mayor", label: "Mayor", hint: "Puede afectar la validez de resultados o del sistema" },
  { value: "critica", label: "Crítica", hint: "Afecta resultados emitidos o la seguridad; exige detener el trabajo" },
];
export const CLASIFICACION_NC_LABEL = etiquetas(CLASIFICACIONES_NC);

export const ESTADOS_NC: Record<string, { label: string; tone: "neutral" | "brand" | "warning" | "success" | "danger" | "ink" }> = {
  abierta: { label: "Abierta", tone: "brand" },
  en_analisis: { label: "En análisis", tone: "warning" },
  acciones_en_curso: { label: "Acciones en curso", tone: "warning" },
  en_verificacion: { label: "En verificación", tone: "warning" },
  cerrada: { label: "Cerrada", tone: "success" },
  anulada: { label: "Anulada", tone: "danger" },
};
/* Orden de las etapas (solo hacia adelante, salvo la reapertura por "no eficaz"). */
export const ETAPAS_NC = ["abierta", "en_analisis", "acciones_en_curso", "en_verificacion", "cerrada"] as const;
export const RANGO_NC: Record<string, number> = Object.fromEntries(ETAPAS_NC.map((e, i) => [e, i]));

export const METODOS_CAUSA: Opcion[] = [
  { value: "cinco_porques", label: "5 porqués" },
  { value: "ishikawa", label: "Diagrama de Ishikawa" },
  { value: "otro", label: "Otro" },
];
export const METODO_CAUSA_LABEL = etiquetas(METODOS_CAUSA);

export const ESTADOS_ACCION: Record<string, { label: string; tone: "neutral" | "brand" | "warning" | "success" | "danger" | "ink" }> = {
  pendiente: { label: "Pendiente", tone: "neutral" },
  en_proceso: { label: "En proceso", tone: "brand" },
  implementada: { label: "Implementada", tone: "success" },
  cancelada: { label: "Cancelada", tone: "danger" },
};

export const MEDIOS_COMUNICACION: Opcion[] = [
  { value: "correo", label: "Correo electrónico" },
  { value: "telefono", label: "Teléfono" },
  { value: "presencial", label: "Presencial" },
  { value: "oficio", label: "Oficio" },
  { value: "otro", label: "Otro" },
];
export const MEDIO_COMUNICACION_LABEL = etiquetas(MEDIOS_COMUNICACION);

/* ---------- Suspensiones ---------- */
/* Metodos que se pueden suspender (los del catalogo FX-THF-AP). */
export const METODOS_SUSPENDIBLES = ["ASP", "DSP", "PSP", "pigmentos", "plancton", "otro"] as const;

/* Folios: "INC 0000001", "NC 0000001". */
export const folioIncidencia = (n: unknown) => formatearFolio("INC", n);
export const folioNc = (n: unknown) => formatearFolio("NC", n);

/* Clave del formato "Registro de no conformidad" (por confirmar con Mejora Continua; configurable con NC_FORMATO_CLAVE). */
export const NC_FORMATO_CLAVE_DEFAULT = "FX-MC-NC (por confirmar)";

/* Una accion vence si su fecha compromiso ya paso y no esta implementada ni cancelada (no bloquea). */
export const accionVencida = (accion: { estado?: unknown; fecha_compromiso?: unknown }, hoy: string): boolean =>
  !["implementada", "cancelada"].includes(String(accion.estado || "")) && !!accion.fecha_compromiso && String(accion.fecha_compromiso).slice(0, 10) < hoy;
