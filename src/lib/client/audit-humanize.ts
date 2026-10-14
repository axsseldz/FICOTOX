import { formatearFolio } from "../shared/folios";
import type { ApiRecord } from "@/lib/client/types";
import { ACCION_KEYS, isAccion, isModulo } from "@/lib/shared/permisos";
import { VERBOS_DOCUMENTALES } from "@/lib/client/permisos-legibles";
import { ACCEPTANCE_DECISIONS, ANALYSIS_METHODS, ANALYSIS_STATES, ANALYSIS_TYPES, CLIENT_CONTACT_MEDIA, DISPOSAL_TYPES, DOCUMENT_STATES, RECEPTION_ANALYSIS_TYPES, RECEPTION_DELIVERY_MEDIA, RECEPTION_METHODS, RECEPTION_SAMPLE_TYPES, REPORT_DELIVERY_MEDIA, REPORT_STATES, SAMPLE_STATES, STORAGE_PLACES } from "@/lib/shared/sgc";
import { TIPO_EVIDENCIA_ART } from "@/lib/shared/adjuntos";
import { ACTIVIDADES_AUTORIZABLES, METODOS_AUTORIZABLES } from "@/lib/shared/autorizaciones";
import { CLASIFICACION_NC_LABEL, ESTADOS_ACCION, ESTADOS_INCIDENCIA, ESTADOS_NC, IMPACTO_LABEL, MEDIO_COMUNICACION_LABEL, METODO_CAUSA_LABEL, ORIGEN_AUTOMATICO_LABEL, ORIGEN_NC_LABEL, TIPO_INCIDENCIA_LABEL } from "@/lib/shared/calidad";
import { diaSemana, diasEntre, fechaSola, formatearFecha, formatearFechaHora, formatearFechaLarga, formatearHora, hoyLocal, instanteDe } from "../shared/fechas";

/*
 * Catalogo de lenguaje simple de la bitacora (Auditoria y el historial de
 * cada registro). Para personal de laboratorio sin conocimientos tecnicos:
 * nada que parezca codigo (ids, sellos, rutas, JSON, nombres de campos).
 * Centraliza tres cosas por cada tipo de actividad y modulo:
 *   1. la frase de la lista ("Mariana imprimió la etiqueta de la recepción R 0000001");
 *   2. el parrafo "Que paso", en lenguaje cotidiano;
 *   3. la etiqueta legible y el formato de cada dato que puede cambiar (FIELD);
 *      los datos sin etiqueta conocida no se muestran.
 * Solo presentacion: la bitacora, sus sellos, permisos y alcances no cambian.
 */

export interface HumanEntry {
  id: number;
  when: Date | null;
  /* Nombre de quien actuo ("" si no se sabe; vacio tambien en lo que hizo la plataforma). */
  actor: string;
  isSystem: boolean;
  /* Cargo con el que actuo, si se guardo. */
  cargo: string | null;
  /* Frase sin quien actuo: "imprimió la etiqueta de la recepción R 0000001". */
  action: string;
  /* Frase completa para la lista y el titulo del detalle. */
  frase: string;
  /* Parrafo "Que paso". */
  quePaso: string;
  /* "Que cambio": una frase por dato. */
  cambios: string[];
  verb: string;
  entidad: string;
  entidadId: string | null;
  /* Area en palabras ("Recepción de muestras"). */
  area: string;
  reference: string | null;
  motivo: string | null;
  /* Ficha del registro (null si no tiene: sistema, sesiones). */
  href: string | null;
  /* Usuario + accion + registro: para agrupar repeticiones seguidas. */
  claveGrupo: string;
}

/* Lo que el detalle puede aportar para hablar con nombres y unidades. */
export interface ContextoActividad {
  /* id de cuenta -> nombre. */
  personas?: Map<number, string>;
  /* Datos completos de la entrada (solo si quien consulta puede verlos). */
  datos?: { antes: ApiRecord | null; nuevos: ApiRecord | null } | null;
}

type Cambios = Record<string, unknown>;

const cap = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const esVacio = (v: unknown) => v === null || v === undefined || v === "" || v === "-" || (Array.isArray(v) && v.length === 0);
const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const isPair = (value: unknown): value is { antes?: unknown; despues?: unknown } => !!value && typeof value === "object" && !Array.isArray(value) && ("antes" in (value as object) || "despues" in (value as object));
const isPlainObject = (value: unknown): value is ApiRecord => !!value && typeof value === "object" && !Array.isArray(value);
const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/* ---------------------------------------------------------------------------
 * Registros: articulo, nombre, area y ficha
 * ------------------------------------------------------------------------- */

const ENTIDAD: Record<string, { art: "el" | "la"; noun: string; plural: string; area: string }> = {
  muestras_recepcion: { art: "la", noun: "recepción", plural: "recepciones", area: "Recepción de muestras" },
  muestras_procesamiento: { art: "el", noun: "procesamiento", plural: "procesamientos", area: "Procesamiento de muestras" },
  muestras_extraccion: { art: "la", noun: "extracción", plural: "extracciones", area: "Extracción" },
  muestras_analisis: { art: "el", noun: "análisis", plural: "análisis", area: "Análisis" },
  informes: { art: "el", noun: "informe", plural: "informes", area: "Informes de resultados" },
  documentos_sgc: { art: "el", noun: "documento", plural: "documentos", area: "Documentos (sistema anterior)" },
  biblioteca_documentos: { art: "el", noun: "documento", plural: "documentos", area: "Biblioteca (retirada)" },
  biblioteca_categorias: { art: "la", noun: "categoría", plural: "categorías", area: "Biblioteca (retirada)" },
  sgc_documentos: { art: "el", noun: "documento", plural: "documentos", area: "Documentos SGC" },
  reactivos: { art: "el", noun: "reactivo", plural: "reactivos", area: "Inventario de reactivos" },
  consumibles: { art: "el", noun: "consumible", plural: "consumibles", area: "Inventario de consumibles" },
  equipos: { art: "el", noun: "equipo", plural: "equipos", area: "Equipos" },
  mantenimientos: { art: "el", noun: "mantenimiento", plural: "mantenimientos", area: "Mantenimiento de equipos" },
  reportes_mantenimiento: { art: "el", noun: "reporte de mantenimiento", plural: "reportes de mantenimiento", area: "Mantenimiento de equipos" },
  usuarios: { art: "la", noun: "cuenta", plural: "cuentas", area: "Usuarios y accesos" },
  roles: { art: "el", noun: "rol", plural: "roles", area: "Roles y permisos" },
  sesion: { art: "la", noun: "sesión", plural: "sesiones", area: "Inicio de sesión" },
  respaldos: { art: "el", noun: "respaldo", plural: "respaldos", area: "Respaldos" },
  incidencias: { art: "la", noun: "incidencia", plural: "incidencias", area: "Incidencias" },
  no_conformidades: { art: "la", noun: "no conformidad", plural: "no conformidades", area: "No conformidades" },
  acciones_correctivas: { art: "la", noun: "acción correctiva", plural: "acciones correctivas", area: "Acciones correctivas" },
  suspensiones: { art: "la", noun: "suspensión", plural: "suspensiones", area: "No conformidades" },
  esquema: { art: "la", noun: "plataforma", plural: "plataforma", area: "Plataforma" },
  auditoria: { art: "el", noun: "registro de actividad", plural: "registro de actividad", area: "Registro de actividad" },
};

const ENTITY_ROUTE: Partial<Record<string, (id: string, referencia: string) => string>> = {
  muestras_recepcion: (id) => `/muestras/recepcion/${id}`,
  muestras_procesamiento: (id) => `/muestras/procesamiento/${id}`,
  muestras_extraccion: (id) => `/muestras/extraccion/${id}`,
  muestras_analisis: (id) => `/muestras/analisis/${id}`,
  informes: (id) => `/informes/${id}`,
  // Flujo anterior y Biblioteca (retirados): sin pantalla propia; llevan a Documentos SGC.
  documentos_sgc: () => "/documentos",
  biblioteca_documentos: () => "/documentos",
  biblioteca_categorias: () => "/documentos",
  sgc_documentos: (id) => `/documentos/${id}`,
  reactivos: (_id, ref) => `/inventario/reactivos?buscar=${encodeURIComponent(ref)}`,
  consumibles: (_id, ref) => `/inventario/consumibles?buscar=${encodeURIComponent(ref)}`,
  equipos: (_id, ref) => `/inventario/equipos?buscar=${encodeURIComponent(ref)}`,
  mantenimientos: () => `/inventario/mantenimiento`,
  incidencias: (id) => `/calidad/incidencias/${id}`,
  no_conformidades: (id) => `/calidad/nc/${id}`,
  usuarios: () => `/administracion/usuarios`,
  roles: () => `/administracion/roles`,
};

/* Acciones de sesion: sin ficha ni area de registro. */
const ACCIONES_DE_SESION = new Set(["login", "login_fallido", "reauth_fallida", "cerrar_sesiones"]);

/* ---------------------------------------------------------------------------
 * Datos: etiqueta legible (con articulo) y formato
 * ------------------------------------------------------------------------- */

/*
 * Nombre de cada dato con su articulo ("la fecha de recepción"). La etiqueta
 * de las listas es el mismo texto sin articulo. Lo que no esta aqui no se
 * muestra (ids, sellos, firmas, columnas internas).
 */
const FIELD: Record<string, string> = {
  // Generales
  // Documentos SGC (ficha y revision)
  proceso: "el proceso o subproceso",
  confidencialidad: "la confidencialidad",
  palabras_clave: "las palabras clave",
  propietario_id: "el propietario",
  motivo_cambio: "el motivo del cambio",
  apartados_afectados: "los apartados afectados",
  descripcion_cambio: "la descripción del cambio",
  fecha_vigencia: "la fecha de vigencia",
  fecha_proxima_revision: "la fecha de próxima revisión",
  ubicacion_historica: "la ubicación histórica",
  regla_conservacion: "la regla de conservación",
  elaborador_id: "el elaborador",
  revisor_id: "el revisor",
  autorizador_id: "el autorizador",
  estado: "el estado",
  nombre: "el nombre",
  titulo: "el título",
  descripcion: "la descripción",
  observaciones: "las observaciones",
  observacion: "la observación",
  observaciones_generales: "las observaciones generales",
  clave: "la clave",
  categoria: "la categoría",
  tipo: "el tipo",
  fecha: "la fecha",
  hora: "la hora",
  version: "la versión",
  activo: "la condición de activo",
  responsable: "el responsable",
  ubicacion: "la ubicación",
  motivo_anulacion: "el motivo de la anulación",
  motivo_enmienda: "el motivo de la corrección",
  revision_observaciones: "las observaciones de la revisión",
  devolucion_observaciones: "las observaciones de la devolución",
  supervision_observaciones: "las observaciones de la supervisión",
  supervision_estado: "la supervisión",
  requiere_supervision: "la necesidad de visto bueno",
  supervisor_id: "el supervisor",
  // Recepción
  fecha_emision: "la fecha de emisión",
  fecha_recepcion: "la fecha de recepción",
  hora_recepcion: "la hora de recepción",
  recibido_por: "quien recibió",
  medio_recepcion: "el medio de recepción",
  solicitante: "el solicitante",
  muestra_unica: "la muestra única",
  fecha_muestra: "la fecha de la muestra",
  id_interno: "el ID interno",
  especificaciones: "las especificaciones",
  decision_aceptacion: "la decisión de aceptación",
  analisis_json: "el análisis solicitado",
  inspeccion_json: "la inspección visual",
  datos_solicitante_json: "los datos de quien entregó",
  datos_custodio_json: "los datos de custodia",
  aceptacion_json: "los datos de aceptación",
  disposicion_json: "la disposición final",
  lote_muestras_json: "las muestras del lote",
  tipos: "los tipos de análisis",
  metodos: "los métodos",
  tipos_muestra: "los tipos de muestra",
  checklist: "los requisitos",
  requisito: "el requisito",
  nombre_entrega: "quien entregó la muestra",
  conformidad: "la conformidad",
  nombre_cargo_firma: "el nombre y cargo",
  lugar_resguardo: "el lugar de resguardo",
  lugar_otro: "el detalle del lugar",
  temperatura_llegada: "la temperatura de llegada",
  comunicacion_cliente: "la comunicación con el cliente",
  requerida: "la necesidad de avisar al cliente",
  persona: "la persona contactada",
  respuesta: "la respuesta del cliente",
  medio: "el medio",
  disposicion: "la disposición",
  nombre_organismo: "el organismo",
  sitio_muestreo: "el sitio de muestreo",
  // Procesamiento y extracción
  fecha_procesamiento: "la fecha de procesamiento",
  hora_procesamiento: "la hora de procesamiento",
  muestra_tipo: "el tipo de muestra",
  tipo_organismo_json: "el tipo de organismo",
  parte_organismo_json: "la parte del organismo",
  tipo_organismo_otro: "el otro tipo de organismo",
  parte_organismo_otro: "la otra parte del organismo",
  bivalvos_steps_json: "los pasos para bivalvos",
  sardinas_steps_json: "los pasos para sardinas",
  otro_procesamiento: "el otro procesamiento",
  resguardo_json: "el resguardo",
  lote_seleccion_json: "las muestras del lote",
  nombre_quien_proceso: "quien procesó",
  nombre_quien_superviso: "quien supervisó",
  fecha_extraccion: "la fecha de extracción",
  hora_extraccion: "la hora de extracción",
  tipo_molienda: "el tipo de molienda",
  pasos_json: "los pasos del protocolo",
  registro_pesos_json: "el registro de pesos",
  equipos_json: "los equipos utilizados",
  uso_inventario_json: "los reactivos y consumibles usados",
  nombre_quien_extrajo: "quien extrajo",
  nombre_quien_limpieza: "quien hizo la limpieza",
  clave_bitacora: "la clave de bitácora",
  folio_bitacora: "el folio de bitácora",
  uso: "el uso",
  // Análisis
  tipo_analisis: "el tipo de análisis",
  metodo: "el método",
  metodo_otro: "el otro método",
  metodo_referencia: "la referencia del método",
  fecha_analisis: "la fecha del análisis",
  hora_inicio: "la hora de inicio",
  hora_fin: "la hora de término",
  equipo_nombre: "el equipo",
  condiciones_json: "las condiciones ambientales",
  resultados_json: "los resultados",
  controles_json: "los controles de calidad",
  analista_nombre: "el analista",
  revisado_nombre: "quien revisó",
  aprobado_nombre: "quien aprobó",
  id_muestra: "la muestra",
  resultado: "el resultado",
  resultado_texto: "el resultado en texto",
  unidad: "la unidad",
  incertidumbre: "la incertidumbre",
  limite_deteccion: "el límite de detección",
  limite_cuantificacion: "el límite de cuantificación",
  limite_regulatorio: "el límite aplicable",
  cumple: "la conformidad",
  // Informes
  cliente_json: "los datos del cliente",
  muestras_json: "las muestras del informe",
  analisis_ids_json: "los análisis incluidos",
  declaraciones_json: "las declaraciones",
  elaborado_nombre: "quien elaboró",
  autorizado_nombre: "quien autorizó",
  liberado_nombre: "quien liberó",
  entrega_json: "la entrega al cliente",
  a_quien: "a quién se entregó",
  requiere_enmienda: "la marca de corrección pendiente",
  requiere_enmienda_motivo: "el motivo de la corrección pendiente",
  cliente_nombre: "el cliente",
  cliente_contacto: "el contacto del cliente",
  cliente_direccion: "la dirección del cliente",
  alcance: "el alcance de los resultados",
  regla_decision: "la regla de decisión",
  desviaciones: "las desviaciones del método",
  descargo: "el descargo",
  opiniones: "las opiniones e interpretaciones",
  // Inventario
  producto: "el producto",
  marca: "la marca",
  proveedor: "el proveedor",
  numero_cas: "el número CAS",
  cas: "el número CAS",
  cantidad_actual: "la existencia",
  cantidad: "la cantidad",
  piezas: "las piezas",
  existencia: "la existencia",
  cantidad_por_pieza: "la cantidad por pieza",
  stock_minimo: "la existencia mínima",
  stock_maximo: "la existencia máxima",
  caducidad: "la caducidad",
  lote: "el lote",
  localizacion: "la localización",
  caducidad_indefinida: "si la caducidad es indefinida",
  capacidad: "la capacidad por envase",
  unidad_capacidad: "la unidad de la capacidad",
  catalogo: "el número de catálogo",
  parte: "el número de parte",
  serie: "el número de serie",
  nuevo_usado: "la condición",
  sub_localizacion: "la sublocalización",
  presentacion: "la presentación",
  contenedor: "el contenedor",
  tamano_capacidad: "el tamaño o capacidad",
  tipo_reactivo: "el tipo de reactivo",
  fecha_ingreso: "la fecha de ingreso",
  fecha_apertura: "la fecha de apertura",
  baja_motivo: "el motivo de la baja",
  // Equipos y mantenimiento
  modelo: "el modelo",
  numero_serie: "el número de serie",
  fecha_prox_calibracion: "la próxima calibración",
  id_responsable: "el responsable",
  fecha_programada: "la fecha programada",
  fecha_realizado: "la fecha en que se realizó",
  tecnico_proveedor: "el técnico o proveedor",
  // Cuentas y roles
  email: "el correo",
  departamento: "el departamento",
  tipo_cuenta: "el tipo de cuenta",
  vigente_desde: "el inicio de la vigencia",
  vigente_hasta: "el fin de la vigencia",
  motivo_ultimo_cambio: "el motivo del último cambio de vigencia",
  debe_cambiar_password: "la obligación de cambiar la contraseña",
  bloqueado_hasta: "el bloqueo",
  cargo_predeterminado: "el cargo predeterminado",
  avatar: "la figura de perfil",
  permisos: "los permisos",
  // Calidad
  fecha_hora_ocurrencia: "la fecha en que ocurrió",
  accion_inmediata: "la acción inmediata",
  impacto_resultados: "el impacto en los resultados",
  decision_evaluacion: "la decisión de la evaluación",
  justificacion: "la justificación",
  origen: "el origen",
  clasificacion: "la clasificación",
  requisito_incumplido: "el requisito incumplido",
  responsable_id: "el responsable",
  afecta_resultados_emitidos: "la afectación de resultados ya emitidos",
  trabajo_detenido: "la detención del trabajo",
  notificar_cliente: "el aviso al cliente",
  impacto_notas: "las notas del impacto",
  impacto_evaluado_por: "quien evaluó el impacto",
  impacto_evaluado_en: "la fecha de evaluación del impacto",
  metodo_causa: "el método para encontrar la causa",
  desarrollo_causa: "el análisis de la causa",
  causa_raiz: "la causa raíz",
  requiere_accion_correctiva: "la necesidad de acción correctiva",
  justificacion_sin_accion: "la justificación para no hacer acción correctiva",
  requiere_actualizar_riesgos: "la actualización de riesgos",
  nota_riesgos: "la nota de riesgos",
  requiere_cambio_documental: "la necesidad de cambio documental",
  verificacion_programada: "la verificación programada",
  conclusion: "la conclusión",
  fecha_compromiso: "la fecha compromiso",
  // Biblioteca
  etiquetas: "las etiquetas",
  fecha_documento: "la fecha del documento",
  visibilidad: "la visibilidad",
  orden: "el orden",
  activa: "la condición de activa",
};

/* Datos que son si/no. */
const BOOLEAN_FIELDS = new Set(["activo", "activa", "muestra_unica", "conformidad", "requerida", "requiere_supervision", "debe_cambiar_password", "requiere_enmienda", "requiere_accion_correctiva", "requiere_actualizar_riesgos", "requiere_cambio_documental", "trabajo_detenido", "cumple"]);
/* Datos que son una persona (id de cuenta). */
const PERSON_FIELDS = new Set(["supervisor_id", "id_responsable", "responsable_id", "impacto_evaluado_por"]);
/* Datos de texto largo: se cita el texto nuevo en vez de "de … a …". */
const LONG_FIELDS = new Set(["descripcion", "observaciones", "observaciones_generales", "observacion", "especificaciones", "revision_observaciones", "devolucion_observaciones", "supervision_observaciones", "accion_inmediata", "justificacion", "impacto_notas", "desarrollo_causa", "causa_raiz", "justificacion_sin_accion", "nota_riesgos", "conclusion", "alcance", "desviaciones", "descargo", "opiniones", "motivo_enmienda", "requiere_enmienda_motivo", "motivo_ultimo_cambio", "baja_motivo", "motivo_anulacion"]);
/* Cantidades que suben o bajan. */
const QUANTITY_FIELDS = new Set(["cantidad_actual", "existencia", "cantidad", "piezas", "stock_minimo", "stock_maximo"]);

const sinArticulo = (n: string) => n.replace(/^(el|la|los|las) /, "");
const fieldLabel = (key: string): string | null => (FIELD[key] ? cap(sinArticulo(FIELD[key])) : null);

const catalogo = (items: Array<{ value: string; label: string }>, value: unknown) => items.find((item) => item.value === String(value))?.label;

const ESTADOS_POR_ENTIDAD: Record<string, Record<string, { label: string }>> = {
  muestras_recepcion: SAMPLE_STATES,
  muestras_procesamiento: SAMPLE_STATES,
  muestras_extraccion: SAMPLE_STATES,
  muestras_analisis: ANALYSIS_STATES,
  informes: REPORT_STATES,
  documentos_sgc: DOCUMENT_STATES,
  incidencias: ESTADOS_INCIDENCIA,
  no_conformidades: ESTADOS_NC,
  acciones_correctivas: ESTADOS_ACCION,
};
const ESTADOS_GENERALES: Record<string, string> = { fuera_servicio: "Fuera de servicio", calibracion_pendiente: "Calibración pendiente", en_calibracion: "En calibración", en_reparacion: "En reparación", en_verificacion: "En verificación",  pendiente: "Pendiente", vencido: "Vencido", completado: "Completado", programado: "Programado", en_proceso: "En proceso", cancelado: "Cancelado", activo: "Activo", inactivo: "Inactivo", baja: "Dado de baja", vigente: "Vigente", obsoleto: "Obsoleto", operativo: "Operativo", fuera_de_servicio: "Fuera de servicio", en_mantenimiento: "En mantenimiento", suspendido: "Suspendido" };

/* Valor tecnico ("alcoholes_solventes") en palabras ("Alcoholes solventes"). */
const palabras = (v: string) => (/^[a-z0-9_]+$/.test(v) ? cap(v.replace(/_/g, " ")) : v);

const unidadDe = (ctx: ContextoActividad): string => texto(ctx.datos?.nuevos?.unidad || ctx.datos?.antes?.unidad);
const numero = (n: number) => n.toLocaleString("es-MX", { maximumFractionDigits: 4 });

/*
 * Valor legible de un dato, o null si no se puede decir en palabras (un id
 * que no se conoce, un objeto sin etiquetas): entonces no se muestra.
 */
function valorLegible(key: string, value: unknown, entidad: string, ctx: ContextoActividad = {}): string | null {
  if (esVacio(value)) return null;
  if (value === "[firma]") return "firma registrada";
  if (PERSON_FIELDS.has(key)) return ctx.personas?.get(Number(value)) || null;
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (BOOLEAN_FIELDS.has(key) && [0, 1, "0", "1", "sí", "si", "no"].includes(value as never)) return ["1", "sí", "si"].includes(String(value)) ? "Sí" : "No";
  if (["afecta_resultados_emitidos", "notificar_cliente"].includes(key)) return value === "si" ? "Sí" : value === "no" ? "No" : palabras(String(value));
  if (typeof value === "number") return QUANTITY_FIELDS.has(key) && unidadDe(ctx) ? `${numero(value)} ${unidadDe(ctx)}` : numero(value);
  if (typeof value === "string") {
    const v = value.trim();
    if (key === "estado") return (ESTADOS_POR_ENTIDAD[entidad] || {})[v]?.label || ESTADOS_GENERALES[v] || palabras(v);
    if (key === "decision_aceptacion" || key === "decision") return catalogo(ACCEPTANCE_DECISIONS, v) || palabras(v);
    if (key === "disposicion" || (key === "tipo" && catalogo(DISPOSAL_TYPES, v))) return catalogo(DISPOSAL_TYPES, v) || palabras(v);
    if (key === "medio") return catalogo(REPORT_DELIVERY_MEDIA, v) || catalogo(CLIENT_CONTACT_MEDIA, v) || MEDIO_COMUNICACION_LABEL[v] || palabras(v);
    if (key === "medio_recepcion") return catalogo(RECEPTION_DELIVERY_MEDIA, v) || palabras(v);
    if (key === "lugar_resguardo") return catalogo(STORAGE_PLACES, v) || palabras(v);
    if (key === "tipo_muestra" || key === "muestra_tipo") return catalogo(RECEPTION_SAMPLE_TYPES, v) || palabras(v);
    if (key === "tipo_analisis") return catalogo(ANALYSIS_TYPES, v) || catalogo(RECEPTION_ANALYSIS_TYPES, v) || palabras(v);
    if (key === "metodo") return catalogo(ANALYSIS_METHODS, v) || catalogo(RECEPTION_METHODS, v) || palabras(v);
    if (key === "decision_evaluacion") return ({ cerrar_sin_nc: "Cerrar sin abrir una no conformidad", escalar: "Convertir en no conformidad" } as Record<string, string>)[v] || palabras(v);
    if (key === "impacto_resultados") return IMPACTO_LABEL[v] || palabras(v);
    if (key === "clasificacion") return CLASIFICACION_NC_LABEL[v] || palabras(v);
    if (key === "metodo_causa") return METODO_CAUSA_LABEL[v] || palabras(v);
    if (key === "origen") return ORIGEN_NC_LABEL[v] || ORIGEN_AUTOMATICO_LABEL[v] || palabras(v);
    if (key === "tipo" && entidad === "incidencias") return TIPO_INCIDENCIA_LABEL[v] || palabras(v);
    if (key === "tipo_cuenta") return v === "temporal" ? "Temporal" : "Permanente";
    if (key === "visibilidad") return v === "roles" ? "Solo algunos roles" : "Todos";
    if (key === "bloqueado_hasta") return `hasta ${formatearFechaHora(v)}`;
    if (QUANTITY_FIELDS.has(key) && /^-?\d+(\.\d+)?$/.test(v)) return valorLegible(key, Number(v), entidad, ctx);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return formatearFechaHora(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return formatearFecha(v);
    if (key === "etiquetas" && v.startsWith("[")) {
      try {
        const lista = JSON.parse(v) as unknown[];
        return lista.length ? lista.map(String).join(", ") : null;
      } catch {
        return v;
      }
    }
    return palabras(v);
  }
  if (Array.isArray(value)) {
    const partes = value.map((item) => (isPlainObject(item) ? nombreDeElemento(item, entidad, ctx) : valorLegible(key === "tipos" || key === "metodos" || key === "tipos_muestra" ? singularDe(key) : key, item, entidad, ctx))).filter((p): p is string => !!p);
    return partes.length ? partes.join(", ") : null;
  }
  if (isPlainObject(value)) {
    const partes = Object.entries(value)
      .map(([k, v]) => {
        const etiqueta = fieldLabel(k);
        const legible = etiqueta ? valorLegible(k, v, entidad, ctx) : null;
        return etiqueta && legible ? `${etiqueta.toLowerCase()}: ${legible}` : null;
      })
      .filter(Boolean);
    return partes.length ? partes.join(" · ") : null;
  }
  return null;
}

/* Los elementos de "tipos" se leen como "tipo_analisis", etc. */
const singularDe = (key: string) => ({ tipos: "tipo_analisis", metodos: "metodo", tipos_muestra: "tipo_muestra" })[key] || key;

/* Nombre corto de un elemento de una lista (equipo, muestra, requisito…), o null si no tiene. */
function nombreDeElemento(item: ApiRecord, entidad: string, ctx: ContextoActividad): string | null {
  const nombre = item.nombre || item.producto || item.id_muestra || item.id_interno || item.requisito || item.titulo || item.nombre_organismo;
  if (nombre) return String(nombre);
  if (item.value && item.label) return String(item.label);
  void entidad;
  void ctx;
  return null;
}

/* ---------------------------------------------------------------------------
 * "Que cambio": una frase por dato
 * ------------------------------------------------------------------------- */

const MAX_LARGO = 160;
const recortar = (t: string) => (t.length > MAX_LARGO ? `${t.slice(0, MAX_LARGO - 1).trimEnd()}…` : t);

/* Frase para un dato que cambio de `antes` a `despues`. */
function fraseDeCambio(key: string, antes: unknown, despues: unknown, entidad: string, ctx: ContextoActividad, referencia: string | null, prefijo = ""): string[] {
  const nombre = FIELD[key];
  if (!nombre || igual(antes, despues)) return [];
  // Listas: agregados, quitados y modificados.
  if (Array.isArray(antes) || Array.isArray(despues)) return frasesDeLista(key, Array.isArray(antes) ? antes : [], Array.isArray(despues) ? despues : [], entidad, ctx, prefijo);
  // Objetos: cada dato interno con su propia frase, precedida del nombre del grupo.
  if (isPlainObject(antes) || isPlainObject(despues)) {
    const a = isPlainObject(antes) ? antes : {};
    const b = isPlainObject(despues) ? despues : {};
    const grupo = `${prefijo}${cap(sinArticulo(nombre))}: `;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => fraseDeCambio(k, a[k], b[k], entidad, ctx, null, grupo));
  }
  const a = valorLegible(key, antes, entidad, ctx);
  const b = valorLegible(key, despues, entidad, ctx);
  if (a === null && b === null) return [];
  const sujeto = key === "cantidad_actual" && referencia ? `${nombre} de ${referencia}` : nombre;
  const decir = (frase: string) => `${prefijo}${prefijo ? frase.charAt(0).toLowerCase() + frase.slice(1) : cap(frase)}`;
  if ((key === "activo" || key === "activa") && a !== null && b !== null) return [decir(b === "Sí" ? "se activó." : "se desactivó.")];
  const plural = /^(los|las) /.test(nombre);
  const agrego = plural ? "se agregaron" : "se agregó";
  const cambio = plural ? "cambiaron" : "cambió";
  if (a === null && nombre.startsWith("quien ")) return [decir(`se registró ${nombre.replace(/^quien/, "quién")}: ${b}.`)];
  if (a === null) return [decir(LONG_FIELDS.has(key) ? `${agrego} ${nombre}: «${recortar(b!)}».` : `${agrego} ${nombre}: ${b}.`)];
  if (b === null) return [decir(`${plural ? "se quitaron" : "se quitó"} ${nombre}.`)];
  if (LONG_FIELDS.has(key)) return [decir(`${nombre} ${cambio} a: «${recortar(b)}».`)];
  const na = Number(antes);
  const nb = Number(despues);
  if (QUANTITY_FIELDS.has(key) && Number.isFinite(na) && Number.isFinite(nb) && antes !== "" && despues !== "") return [decir(`${sujeto} ${nb > na ? "subió" : "bajó"} de ${a} a ${b}.`)];
  return [decir(`${sujeto} ${cambio} de ${a} a ${b}.`)];
}

const claveDeElemento = (item: unknown, index: number) => {
  if (isPlainObject(item)) {
    const base = item.equipo_id ?? item.id ?? item.ref ?? item.clave ?? item.nombre ?? item.id_muestra ?? item.requisito ?? item.value ?? index;
    return item.tipo && item.ref !== undefined ? `${String(item.tipo)}:${String(base)}` : String(base);
  }
  return String(item);
};

function frasesDeLista(key: string, antes: unknown[], despues: unknown[], entidad: string, ctx: ContextoActividad, prefijo: string): string[] {
  const nombre = FIELD[key];
  // Reactivos y consumibles usados: se guardan por referencia interna; se cuenta en palabras.
  if (key === "uso_inventario_json" || key === "analisis_ids_json") {
    const a = new Map(antes.map((x, i) => [claveDeElemento(x, i), x]));
    const b = new Map(despues.map((x, i) => [claveDeElemento(x, i), x]));
    const agregados = [...b.keys()].filter((k) => !a.has(k)).length;
    const quitados = [...a.keys()].filter((k) => !b.has(k)).length;
    const cambiados = [...b.keys()].filter((k) => a.has(k) && !igual(a.get(k), b.get(k))).length;
    const cosa = key === "uso_inventario_json" ? ["insumo", "insumos"] : ["análisis", "análisis"];
    const n = (x: number) => (x === 1 ? `1 ${cosa[0]}` : `${x} ${cosa[1]}`);
    const frases: string[] = [];
    if (agregados) frases.push(`Se ${agregados === 1 ? "agregó" : "agregaron"} ${n(agregados)} a ${nombre}.`);
    if (quitados) frases.push(`Se ${quitados === 1 ? "quitó" : "quitaron"} ${n(quitados)} de ${nombre}.`);
    if (cambiados) frases.push(key === "uso_inventario_json" ? `Cambió la cantidad usada de ${n(cambiados)}.` : `Cambiaron ${n(cambiados)}.`);
    return frases.map((f) => (prefijo ? `${prefijo}${f.charAt(0).toLowerCase()}${f.slice(1)}` : f));
  }
  const frases: string[] = [];
  const a = new Map(antes.map((x, i) => [claveDeElemento(x, i), x]));
  const b = new Map(despues.map((x, i) => [claveDeElemento(x, i), x]));
  const dicho = (x: unknown) => (isPlainObject(x) ? nombreDeElemento(x, entidad, ctx) : valorLegible(singularDe(key), x, entidad, ctx));
  for (const [k, item] of b) {
    if (!a.has(k)) {
      const d = dicho(item);
      frases.push(d ? `Se agregó a ${nombre}: ${d}.` : `Se agregó un elemento a ${nombre}.`);
    } else if (!igual(a.get(k), item) && isPlainObject(item) && isPlainObject(a.get(k))) {
      const d = dicho(item);
      const internas = [...new Set([...Object.keys(a.get(k) as ApiRecord), ...Object.keys(item)])].flatMap((campo) => fraseDeCambio(campo, (a.get(k) as ApiRecord)[campo], item[campo], entidad, ctx, null, d ? `${d}: ` : ""));
      frases.push(...(internas.length ? internas : [d ? `Cambió ${d} en ${nombre}.` : `Cambió un elemento de ${nombre}.`]));
    }
  }
  for (const [k, item] of a) {
    if (!b.has(k)) {
      const d = dicho(item);
      frases.push(d ? `Se quitó de ${nombre}: ${d}.` : `Se quitó un elemento de ${nombre}.`);
    }
  }
  return frases.map((f) => (prefijo ? `${prefijo}${f.charAt(0).toLowerCase()}${f.slice(1)}` : f));
}

/* Permisos en palabras para la bitacora: "en Muestras puede ver, registrar y editar". */
const VERBO_PERMISO: Record<string, string> = { V: "ver", C: "registrar", E: "editar", R: "revisar", A: "aprobar", AN: "anular", G: "administrar", ...VERBOS_DOCUMENTALES };
const NOMBRE_MODULO: Record<string, string> = { usuarios: "Usuarios y accesos", documentos: "Documentos SGC", muestras: "Muestras", ensayos: "Ensayos", informes: "Informes", equipos: "Equipos", inventario: "Inventario", calidad: "Calidad", respaldos: "Respaldos", compras: "Compras" };
const unirConY = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);
function permisosEnPalabras(filas: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const fila of Array.isArray(filas) ? filas : []) {
    if (!isPlainObject(fila) || !isModulo(fila.modulo) || !isAccion(fila.accion)) continue;
    const modulo = NOMBRE_MODULO[String(fila.modulo)];
    out.set(modulo, [out.get(modulo), String(fila.accion)].filter(Boolean).join(","));
  }
  for (const [m, acciones] of out) {
    const verbos = [...new Set(acciones.split(","))].sort((x, y) => ACCION_KEYS.indexOf(x as never) - ACCION_KEYS.indexOf(y as never)).map((a) => VERBO_PERMISO[a] || a);
    out.set(m, unirConY(verbos));
  }
  return out;
}
function frasesDePermisos(antes: unknown, despues: unknown): string[] {
  const a = permisosEnPalabras(antes);
  const b = permisosEnPalabras(despues);
  const frases: string[] = [];
  for (const modulo of Object.values(NOMBRE_MODULO)) {
    const x = a.get(modulo);
    const y = b.get(modulo);
    if (x === y) continue;
    if (!x) frases.push(`Ahora puede ${y} en ${modulo}.`);
    else if (!y) frases.push(`Ya no tiene permisos en ${modulo}.`);
    else frases.push(`En ${modulo} ahora puede ${y} (antes: ${x}).`);
  }
  return frases;
}

/* Todas las frases de "Que cambio" de una entrada. */
function frasesDeCambios(cambios: Cambios, entidad: string, ctx: ContextoActividad, referencia: string | null): string[] {
  const frases: string[] = [];
  const pares = Object.entries(cambios || {}).filter(([k]) => k !== "_detalle");
  // El estado primero.
  pares.sort(([a], [b]) => Number(b === "estado") - Number(a === "estado"));
  for (const [key, raw] of pares) {
    const par = isPair(raw) ? raw : { antes: undefined, despues: raw };
    if (key === "permisos") {
      frases.push(...frasesDePermisos(par.antes, par.despues));
      continue;
    }
    frases.push(...fraseDeCambio(key, par.antes, par.despues, entidad, ctx, referencia));
  }
  return [...new Set(frases)];
}

/* ---------------------------------------------------------------------------
 * Datos principales de un registro nuevo
 * ------------------------------------------------------------------------- */

const PRINCIPALES: Record<string, string[]> = {
  muestras_recepcion: ["solicitante", "id_interno", "fecha_recepcion", "medio_recepcion", "decision_aceptacion", "estado"],
  muestras_procesamiento: ["id_interno", "fecha_procesamiento", "muestra_tipo", "nombre_quien_proceso", "estado"],
  muestras_extraccion: ["id_interno", "fecha_extraccion", "tipo_molienda", "nombre_quien_extrajo", "estado"],
  muestras_analisis: ["tipo_analisis", "metodo", "fecha_analisis", "analista_nombre", "equipo_nombre", "estado"],
  informes: ["version", "fecha_emision", "elaborado_nombre", "estado"],
  reactivos: ["nombre", "producto", "marca", "cantidad_actual", "ubicacion", "caducidad"],
  consumibles: ["producto", "marca", "proveedor", "piezas", "contenedor"],
  equipos: ["nombre", "marca", "modelo", "numero_serie", "ubicacion", "fecha_prox_calibracion"],
  mantenimientos: ["tipo", "fecha_programada", "tecnico_proveedor", "estado"],
  usuarios: ["nombre", "email", "departamento", "tipo_cuenta", "vigente_hasta"],
  roles: ["nombre", "descripcion"],
  incidencias: ["tipo", "fecha_hora_ocurrencia", "descripcion", "impacto_resultados"],
  no_conformidades: ["clasificacion", "origen", "descripcion", "requisito_incumplido"],
  biblioteca_documentos: ["titulo", "clave", "descripcion", "fecha_documento", "visibilidad"],
  sgc_documentos: ["clave", "titulo", "area", "tipo", "confidencialidad"],
};

/* De 3 a 6 datos clave de un registro recien creado, con su etiqueta. */
export function datosPrincipales(entidad: string, datos: ApiRecord | null | undefined, ctx: ContextoActividad = {}): Array<{ etiqueta: string; valor: string }> {
  if (!datos) return [];
  const claves = PRINCIPALES[entidad] || Object.keys(datos);
  const out: Array<{ etiqueta: string; valor: string }> = [];
  for (const key of claves) {
    const etiqueta = fieldLabel(key);
    if (!etiqueta || LONG_FIELDS.has(key) && key !== "descripcion") continue;
    const valor = valorLegible(key, datos[key], entidad, { ...ctx, datos: { antes: null, nuevos: datos } });
    if (!valor) continue;
    out.push({ etiqueta, valor: key === "descripcion" ? recortar(valor) : valor });
    if (out.length >= 6) break;
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Frases y "Que paso" por tipo de actividad
 * ------------------------------------------------------------------------- */

/* Lo que se pidio en una solicitud de autorizacion, como verbo. */
const SOLICITUD_QUE: Record<string, string> = {
  anular_registro: "anular",
  restaurar_registro: "restaurar",
  anular_informe: "anular",
  anular_calidad: "anular",
  excepcion_segregacion: "firmar como excepción",
  asignar_rol: "asignar un rol a",
  reactivar_cuenta: "reactivar",
  ampliar_vigencia: "ampliar la vigencia de",
  cambiar_folio: "cambiar el folio de",
  reabrir_recepcion: "reabrir",
  obsoletar_documento: "declarar obsoleto",
};
function queSeSolicito(detalle: ApiRecord): string {
  const tipo = String(detalle.tipo || "");
  if (tipo === "decision_recepcion") return detalle.accion === "rechazada" ? "rechazar" : "aceptar con desviación";
  return SOLICITUD_QUE[tipo] || "hacer un cambio en";
}

/* Versiones de la plataforma en palabras (bitacora de migraciones). */
const ACTUALIZACIONES: Record<number, string> = {
  9: "preparar su estructura inicial",
  10: "guardar la evidencia instrumental de los análisis",
  11: "registrar incidencias, no conformidades y acciones correctivas",
  12: "mejorar el manejo interno de las firmas",
  13: "agregar la Biblioteca de documentos",
};

const DELIVERY: Record<string, string> = { correo: "por correo electrónico", impreso: "en mano (impreso)", portal: "por el portal o una carpeta compartida", otro: "por otro medio" };

interface Partes {
  /* Frase sin actor (o frase completa si es de la plataforma). */
  accion: string;
  quePaso: string;
  /* Si la frase ya es completa (la plataforma), no lleva actor delante. */
  sinActor?: boolean;
}

function redactar(record: ApiRecord, actor: string, sistema: boolean): Partes {
  const entidad = String(record.entidad || "");
  const accion = String(record.accion || "");
  const cambios = (record.cambios || {}) as Cambios;
  const d = ((cambios._detalle as ApiRecord | undefined) || {}) as ApiRecord;
  const meta = ENTIDAD[entidad] || { art: "el" as const, noun: "registro", plural: "registros", area: "" };
  const ref = referenciaLegible(record);
  const O = ref ? `${meta.art} ${meta.noun} ${ref}` : `${meta.art === "la" ? "una" : "un"} ${meta.noun}`;
  const de = (frase: string) => (frase.startsWith("el ") ? `del ${frase.slice(3)}` : `de ${frase}`);
  const a = (frase: string) => (frase.startsWith("el ") ? `al ${frase.slice(3)}` : `a ${frase}`);
  const quien = actor || "Alguien";
  const estado = isPair(cambios.estado) ? cambios.estado : null;
  const conSolicitud = d.solicitud_id !== undefined && d.solicitud_id !== null ? " Lo hizo al autorizar la solicitud de otra persona." : "";
  const excepcion = d.excepcion || d.excepcion_segregacion ? " Se permitió por una excepción autorizada, porque normalmente lo hace otra persona." : "";

  switch (accion) {
    case "crear": {
      if (d.accion_correctiva) return { accion: `agregó una acción correctiva ${a(O)}`, quePaso: `${quien} agregó una acción correctiva ${a(O)}${d.responsable ? `, a cargo de ${texto(d.responsable)}` : ""}${d.fecha_compromiso ? `, con fecha compromiso ${formatearFecha(d.fecha_compromiso)}` : ""}.` };
      if (d.enmienda_de || d.enmienda) return { accion: `emitió una versión corregida ${de(O)}`, quePaso: `${quien} emitió una versión corregida ${de(O)}. La versión anterior queda reemplazada, pero se conserva.` };
      if (entidad === "usuarios") return { accion: `dio de alta ${O}`, quePaso: `${quien} creó una cuenta nueva en la plataforma${ref ? ` para ${ref}` : ""}.` };
      if (entidad === "roles") return { accion: `creó el rol ${ref ? `«${ref}»` : "nuevo"}`, quePaso: `${quien} creó el rol ${ref ? `«${ref}»` : "nuevo"} y definió qué puede hacer quien lo tenga.` };
      if (entidad === "mantenimientos") return { accion: `programó un mantenimiento`, quePaso: `${quien} programó un mantenimiento de equipo.` };
      if (entidad === "sgc_documentos") return { accion: `creó la ficha ${de(O)}`, quePaso: `${quien} creó la ficha ${de(O)} con la clave autorizada y su revisión ${texto(d.revision)} en borrador.` };
      const usa = entidad === "muestras_extraccion" || entidad === "muestras_procesamiento" || entidad === "muestras_analisis";
      const inventario = usa && Array.isArray(d.uso_inventario) ? " y se descontaron del inventario los reactivos y consumibles usados" : "";
      return { accion: `registró ${O}`, quePaso: `${quien} registró ${O}${inventario}.` };
    }
    case "editar": {
      const claves = Object.keys(cambios).filter((k) => k !== "_detalle" && FIELD[k]);
      if (d.contrasena) return { accion: `cambió la contraseña ${de(O)}`, quePaso: `${quien} cambió la contraseña ${de(O)}.` };
      if (d.avatar) return { accion: "cambió su figura de perfil", quePaso: `${quien} cambió su figura de perfil.` };
      // Foto de perfil propia: subir, quitar la propia o que otra persona (usuarios:G) la quite, con motivo.
      if (d.foto_perfil === "cambiada") return { accion: "cambió su foto de perfil", quePaso: `${quien} cambió su foto de perfil.` };
      if (d.foto_perfil === "quitada") return { accion: "quitó su foto de perfil", quePaso: `${quien} quitó su foto de perfil.` };
      if (d.foto_perfil === "quitada_por_otro") return { accion: `quitó la foto de perfil de ${ref || "otra persona"}`, quePaso: `${quien} quitó la foto de perfil de ${ref || "otra persona"}.` };
      if (estado && claves.length === 1) {
        const nuevo = valorLegible("estado", estado.despues, entidad) || "otro estado";
        return { accion: `cambió el estado ${de(O)} a ${nuevo}`, quePaso: `${quien} cambió el estado ${de(O)} a «${nuevo}».` };
      }
      if (entidad === "no_conformidades" && d.accion_correctiva) return { accion: `modificó una acción correctiva ${de(O)}`, quePaso: `${quien} modificó los datos de una acción correctiva ${de(O)}.` };
      return { accion: `modificó ${O}`, quePaso: `${quien} modificó datos ${de(O)}.` };
    }
    case "anular": {
      const repuso = Number(d.movimientos_repuestos) ? " Los reactivos y consumibles que había usado se devolvieron al inventario." : "";
      return { accion: `anuló ${O}`, quePaso: `${quien} anuló ${O}. El registro se conserva para consulta, pero ya no cuenta para el trabajo del laboratorio.${repuso}${conSolicitud}` };
    }
    case "restaurar":
      return { accion: `restauró ${O}`, quePaso: `${quien} restauró ${O}, que estaba ${entidad === "biblioteca_documentos" ? "archivado" : meta.art === "la" ? "anulada" : "anulado"}; vuelve a estar ${meta.art === "la" ? "activa" : "activo"}.${conSolicitud}` };
    case "baja":
      return { accion: `dio de baja ${O}`, quePaso: `${quien} dio de baja ${O}. Ya no aparece como disponible, pero su información se conserva.` };
    case "reactivar":
      return { accion: `reactivó ${O}`, quePaso: `${quien} volvió a activar ${O}.${conSolicitud}` };
    case "revisar":
      return { accion: `revisó ${O}`, quePaso: `${quien} revisó ${O} y lo dejó listo para el siguiente paso.${excepcion}` };
    case "aprobar":
      return { accion: `aprobó ${O}`, quePaso: `${quien} aprobó ${O}.${excepcion}` };
    case "autorizar":
      return { accion: `autorizó ${O}`, quePaso: `${quien} autorizó ${O}${entidad === "informes" ? " y se generó su documento en PDF" : ""}.${excepcion}` };
    case "entregar": {
      const medio = d.medio ? ` ${DELIVERY[String(d.medio)] || `por ${palabras(String(d.medio)).toLowerCase()}`}` : "";
      return { accion: `registró la entrega ${de(O)}`, quePaso: `${quien} registró que ${O} se entregó${d.a_quien ? ` a ${texto(d.a_quien)}` : ""}${medio}${d.fecha ? ` el ${formatearFecha(d.fecha)}` : ""}.` };
    }
    case "rechazar":
      return { accion: `rechazó ${O}`, quePaso: entidad === "muestras_recepcion" ? `${quien} rechazó la muestra de ${O} porque no cumplió las condiciones para recibirla. Se abrió una incidencia para revisarlo.` : `${quien} rechazó ${O}.` };
    case "aceptar":
      return d.decision === "aceptada_con_desviacion"
        ? { accion: `aceptó con desviación ${O}`, quePaso: `${quien} aceptó la muestra de ${O} aunque no cumplía todas las condiciones. Se abrió una incidencia para evaluar si afecta los resultados.` }
        : { accion: `aceptó ${O}`, quePaso: `${quien} aceptó la muestra de ${O}: cumplió las condiciones para recibirla.` };
    case "cerrar":
      if (entidad === "muestras_recepcion") return { accion: `cerró ${O}`, quePaso: `${quien} cerró ${O}${d.disposicion ? ` y registró qué se hizo con la muestra: ${valorLegible("disposicion", d.disposicion, entidad) || "disposición final"}` : ""}.` };
      return { accion: `cerró ${O}`, quePaso: `${quien} cerró ${O}.` };
    case "importar": {
      const n = Number(d.insertados || 0);
      const u = Number(d.actualizados || 0);
      return { accion: `cargó ${meta.plural} desde una hoja de cálculo`, quePaso: `${quien} cargó ${meta.plural} desde una hoja de cálculo${n || u ? `: ${[n ? `${numero(n)} nuevos` : null, u ? `${numero(u)} actualizados` : null].filter(Boolean).join(" y ")}` : ""}.` };
    }
    case "eliminar":
      return { accion: `eliminó ${O}`, quePaso: `${quien} eliminó ${O}.` };
    case "reponer": {
      const mov = String(d.tipo || "entrada");
      const cuandoMov = d.fecha_movimiento ? ` (movimiento del ${formatearFecha(d.fecha_movimiento)})` : "";
      if (mov === "salida" || mov === "consumo") {
        const c = Number(d.cantidad) ? ` de ${numero(Number(d.cantidad))}` : "";
        return { accion: `registró ${mov === "consumo" ? "un consumo" : "una salida"} de ${ref || meta.noun} del inventario`, quePaso: `${quien} registró ${mov === "consumo" ? "un consumo" : "una salida"}${c} de ${ref || `un ${meta.noun}`} del inventario${cuandoMov}.` };
      }
      if (mov === "ajuste") return { accion: `ajustó la existencia de ${ref || meta.noun} por conteo físico`, quePaso: `${quien} ajustó la existencia de ${ref || `un ${meta.noun}`} por conteo físico${Number.isFinite(Number(d.existencia_nueva)) && d.existencia_nueva !== null ? ` (quedó en ${numero(Number(d.existencia_nueva))})` : ""}.` };
      const cant = Number(d.cantidad) ? ` de ${numero(Number(d.cantidad))} ${Number(d.cantidad) === 1 ? "unidad" : "unidades"}` : "";
      return { accion: `registró una entrada de ${ref || meta.noun} al inventario`, quePaso: `${quien} registró una entrada${cant} de ${ref || `un ${meta.noun}`} al inventario${cuandoMov}.` };
    }
    case "login":
      return { accion: "entró a la plataforma", quePaso: `${quien} entró a la plataforma.` };
    case "login_fallido": {
      const cuenta = ref ? ` con la cuenta ${ref}` : "";
      const razon = d.existe_usuario === false ? " Ese correo no corresponde a ninguna cuenta." : d.existe_usuario === true ? " La contraseña no fue correcta." : "";
      return { accion: `Hubo un intento fallido de entrar${cuenta}`, quePaso: `Alguien intentó entrar a la plataforma${cuenta} y no lo logró.${razon}`, sinActor: true };
    }
    case "reauth_fallida":
      if (!actor) return { accion: `Alguien no pudo confirmar su identidad${ref ? ` con la cuenta ${ref}` : ""}`, quePaso: `Se escribió mal la contraseña${ref ? ` de la cuenta ${ref}` : ""} al confirmar una acción importante, así que la acción no se hizo.`, sinActor: true };
      return { accion: "no pudo confirmar su identidad", quePaso: `${quien} escribió mal su contraseña al confirmar una acción importante, así que la acción no se hizo.` };
    case "descargar": {
      if (entidad === "sgc_documentos") return { accion: `descargó ${d.tipo === "fuente" ? "el archivo fuente" : "el PDF"} ${de(O)}`, quePaso: `${quien} descargó ${d.tipo === "fuente" ? "el archivo fuente" : "el PDF de consulta"} ${de(O)}${d.nombre ? ` («${texto(d.nombre)}»)` : ""}.` };
      if (entidad === "biblioteca_documentos") return { accion: `descargó ${O}`, quePaso: `${quien} descargó una copia ${de(O)}${d.version ? ` (versión ${texto(d.version)})` : ""}.` };
      if (d.adjunto_id) {
        const que = `${TIPO_EVIDENCIA_ART[String(d.tipo_evidencia)] || "la evidencia"}`;
        return d.vista_previa ? { accion: `abrió ${que} ${de(O)}`, quePaso: `${quien} abrió para consultar ${que} ${de(O)}.` } : { accion: `descargó ${que} ${de(O)}`, quePaso: `${quien} descargó ${que} ${de(O)}.` };
      }
      if (entidad === "informes" || entidad === "no_conformidades") return { accion: `descargó el PDF ${de(O)}`, quePaso: `${quien} descargó el documento PDF ${de(O)}.` };
      return { accion: `descargó ${O}`, quePaso: `${quien} descargó ${O}.` };
    }
    case "asignar_rol":
    case "revocar_rol":
    case "vencer_rol":
    case "acotar_rol": {
      const rol = d.rol ? `el rol «${texto(d.rol)}»` : "un rol";
      const persona = ref || "una persona";
      const vigencia = d.vigente_hasta ? ` hasta el ${formatearFecha(d.vigente_hasta)}` : "";
      if (accion === "asignar_rol") return { accion: `asignó ${rol} a ${persona}`, quePaso: `${quien} le dio a ${persona} ${rol}${vigencia}.${conSolicitud}` };
      if (accion === "revocar_rol") return { accion: `quitó ${rol} a ${persona}`, quePaso: `${quien} le quitó a ${persona} ${rol}.` };
      if (accion === "acotar_rol") return { accion: `ajustó la vigencia ${de(rol)} de ${persona}`, quePaso: `${quien} ajustó ${rol} de ${persona} para que no dure más que su cuenta${vigencia}.` };
      return { accion: `Terminó la vigencia ${de(rol)} de ${persona}`, quePaso: `${cap(rol)} de ${persona} dejó de estar vigente porque llegó su fecha de fin.`, sinActor: true };
    }
    case "bloquear":
      return { accion: `Se bloqueó la cuenta ${ref || ""}`.trim(), quePaso: `La cuenta ${ref || ""} se bloqueó por varios intentos fallidos${d.bloqueado_hasta ? `, hasta el ${formatearFechaHora(d.bloqueado_hasta)}` : ""}. Es una medida de seguridad.`.replace("  ", " "), sinActor: true };
    case "desbloquear":
      return { accion: `desbloqueó la cuenta ${ref || ""}`.trim(), quePaso: `${quien} desbloqueó la cuenta ${ref || ""}; ya puede volver a entrar.`.replace(" ;", ";") };
    case "cambiar_password":
      return { accion: "cambió su contraseña", quePaso: `${quien} cambió su contraseña. Sus otras sesiones abiertas se cerraron por seguridad.` };
    case "restablecer_password":
      return { accion: `restableció la contraseña de ${ref || "una cuenta"}`, quePaso: `${quien} le asignó a ${ref || "una cuenta"} una contraseña temporal; deberá cambiarla al entrar.` };
    case "cerrar_sesiones":
      return { accion: "cerró su sesión en todos sus dispositivos", quePaso: `${quien} cerró su sesión en todos los equipos donde la tenía abierta.` };
    case "cambiar_vigencia":
      return { accion: `cambió la vigencia de la cuenta de ${ref || "una persona"}`, quePaso: `${quien} cambió hasta cuándo puede usar la plataforma ${ref || "una persona"}${d.vigente_hasta ? ` (ahora hasta el ${formatearFecha(d.vigente_hasta)})` : d.tipo_cuenta === "permanente" ? " (ahora es permanente)" : ""}.${conSolicitud}` };
    case "visto_bueno":
      return { accion: `dio el visto bueno ${a(O)}`, quePaso: `${quien} revisó y dio su visto bueno ${a(O)}, que había capturado una persona en formación.` };
    case "regresar_supervision":
      return { accion: `regresó ${O} con observaciones`, quePaso: `${quien} regresó ${O} con observaciones, para que quien lo capturó lo corrija.` };
    case "cambiar_cargo":
      return d.despues
        ? { accion: "cambió su cargo predeterminado", quePaso: `${quien} eligió «${texto(d.despues)}» como el cargo con el que firma normalmente.` }
        : { accion: "quitó su cargo predeterminado", quePaso: `${quien} quitó su cargo predeterminado; elegirá el cargo cada vez que firme.` };
    case "solicitar": {
      const que = queSeSolicito(d);
      return { accion: `pidió permiso para ${que} ${O}`, quePaso: `${quien} pidió permiso para ${que} ${O}. La solicitud quedó esperando que otra persona autorizada la apruebe.` };
    }
    case "aprobar_solicitud": {
      const que = queSeSolicito(d);
      return { accion: `autorizó la solicitud para ${que} ${O}`, quePaso: `${quien} autorizó la solicitud de ${nombrePersona(d.solicitado_por) || "otra persona"} para ${que} ${O}, y el cambio se aplicó.` };
    }
    case "rechazar_solicitud": {
      const que = queSeSolicito(d);
      return { accion: `rechazó la solicitud para ${que} ${O}`, quePaso: `${quien} rechazó la solicitud para ${que} ${O}; no se hizo ningún cambio.` };
    }
    case "cancelar_solicitud": {
      const que = queSeSolicito(d);
      return { accion: `canceló su solicitud para ${que} ${O}`, quePaso: `${quien} retiró la solicitud que había hecho para ${que} ${O}; no se hizo ningún cambio.` };
    }
    case "vencer_solicitud": {
      const que = queSeSolicito(d);
      return { accion: `Venció la solicitud para ${que} ${O}`, quePaso: `Nadie resolvió a tiempo la solicitud para ${que} ${O}, así que se cerró sin aplicar el cambio.`, sinActor: true };
    }
    case "otorgar_autorizacion":
    case "revocar_autorizacion":
    case "vencer_autorizacion": {
      const etiquetaClave = d.clave ? catalogo(ACTIVIDADES_AUTORIZABLES, d.clave) || catalogo(METODOS_AUTORIZABLES, d.clave) || palabras(String(d.clave)) : null;
      const actividad = d.autorizacion ? `«${texto(d.autorizacion)}»` : etiquetaClave ? `«${etiquetaClave}»` : "una actividad";
      const persona = ref || "una persona";
      if (accion === "otorgar_autorizacion") return { accion: `autorizó a ${persona} para ${actividad}`, quePaso: `${quien} registró que ${persona} tiene autorización para ${actividad}${d.vigente_hasta ? ` hasta el ${formatearFecha(d.vigente_hasta)}` : ""}.` };
      if (accion === "revocar_autorizacion") return { accion: `retiró a ${persona} la autorización para ${actividad}`, quePaso: `${quien} retiró a ${persona} la autorización para ${actividad}.` };
      return { accion: `Venció la autorización de ${persona} para ${actividad}`, quePaso: `La autorización de ${persona} para ${actividad} llegó a su fecha de fin.`, sinActor: true };
    }
    case "imprimir_etiquetas": {
      const n = Number(d.etiquetas || 0);
      const muestras = Array.isArray(d.id_internos) && d.id_internos.length ? ` (${d.id_internos.map(String).join(", ")})` : "";
      const que = n > 1 ? `${n} etiquetas` : "la etiqueta";
      return { accion: `imprimió ${que} ${de(O)}`, quePaso: `${quien} imprimió ${n > 1 ? `${n} etiquetas` : "una etiqueta"} de la muestra ${de(O)}${muestras}${d.formato === "hoja" || String(d.formato || "").startsWith("hoja") ? " en hoja carta" : ""}.` };
    }
    case "asignar_muestra":
      return { accion: `asignó ${O} a ${texto(d.persona) || "una persona"}`, quePaso: `${quien} le asignó a ${texto(d.persona) || "una persona"} el trabajo de ${O}.` };
    case "revocar_asignacion":
      return { accion: `quitó a ${texto(d.persona) || "una persona"} la asignación ${de(O)}`, quePaso: `${quien} quitó a ${texto(d.persona) || "una persona"} del trabajo de ${O}.` };
    case "enviar_revision":
      if (entidad === "sgc_documentos") return { accion: `envió a revisión ${O}`, quePaso: `${quien} envió ${O} al revisor; desde ahora sus archivos ya no se pueden cambiar.` };
      return { accion: `envió a revisión ${O}`, quePaso: `${quien} terminó ${O} y lo envió para que lo revisen.` };
    case "devolver":
      return { accion: `devolvió ${O} con observaciones`, quePaso: `${quien} devolvió ${O} con observaciones, para que se corrija antes de aprobarlo.` };
    case "enmendar":
      return { accion: `abrió una corrección ${de(O)}`, quePaso: `${quien} abrió una nueva versión ${de(O)} para corregirlo. La versión anterior se conserva.` };
    case "sustituir":
      if (entidad === "sgc_documentos") return { accion: `sustituyó un archivo ${de(O)}`, quePaso: `${quien} sustituyó un archivo ${de(O)} mientras estaba en borrador. El archivo anterior se conserva.` };
      return { accion: `${cap(O)} quedó reemplazado por su versión corregida`, quePaso: `${cap(O)} quedó reemplazado por una versión corregida${actor ? ` (lo registró ${actor})` : ""}. Se conserva para consulta.`, sinActor: true };
    case "cambiar_folio":
      return { accion: `cambió el folio ${de(O)}`, quePaso: `${quien} cambió el folio ${de(O)}${d.folio_anterior ? ` (antes era ${formatearFolio("R", d.folio_anterior)})` : ""}.${conSolicitud}` };
    case "reabrir":
      if (entidad === "no_conformidades") return { accion: `reabrió ${O}`, quePaso: `${quien} reabrió ${O}: las acciones no resolvieron el problema, así que se vuelve a analizar.` };
      return { accion: `reabrió ${O}`, quePaso: `${quien} reabrió ${O}; vuelve al estado en que estaba antes de cerrarse.${conSolicitud}` };
    case "confirmar_firma":
      if (texto(d.firmante) && texto(d.firmante) !== actor) return { accion: `${texto(d.firmante)} confirmó su firma con su contraseña`, quePaso: `${texto(d.firmante)} confirmó con su contraseña que la firma es suya, en el equipo de ${quien}.`, sinActor: true };
      return { accion: "confirmó su firma con su contraseña", quePaso: `${quien} confirmó con su contraseña que la firma es suya.` };
    case "liberar":
      return { accion: `liberó ${O}`, quePaso: `${quien} liberó ${O}: quedó listo para enviarse al cliente.` };
    case "enviar":
      return { accion: `envió ${O} por correo`, quePaso: `${quien} envió ${O} al cliente${d.destinatario ? ` (${texto(d.destinatario)})` : ""}${d.medio === "smtp" ? " desde la plataforma" : ""}.` };
    case "confirmar_envio":
      return { accion: `registró que el cliente recibió ${O}`, quePaso: `${quien} registró que el cliente confirmó haber recibido ${O}.` };
    case "requiere_enmienda":
      return { accion: `${cap(O)} quedó marcado para corregirse`, quePaso: `Se marcó que ${O} necesita una versión corregida${actor ? ` (lo registró ${actor})` : ""}.`, sinActor: true };
    case "alerta_integridad":
      if (entidad === "auditoria") return { accion: "Se detectó un posible cambio no autorizado en el registro de actividad", quePaso: "La revisión automática encontró que el registro de actividad pudo haberse modificado fuera de la plataforma. Se avisó a Calidad con una incidencia automática. Avisa a la Coordinación de Mejora Continua.", sinActor: true };
      if (entidad === "respaldos") return { accion: "Se detectó un problema en un respaldo", quePaso: "La revisión de un respaldo encontró archivos que no coinciden con los originales. Se avisó a Calidad con una incidencia automática.", sinActor: true };
      return { accion: `Se detectó un posible cambio no autorizado en el archivo ${de(O)}`, quePaso: `${d.integridad === "faltante" ? `No se encontró el archivo ${de(O)}` : `El archivo ${de(O)} ya no coincide con el original`}. Se avisó a Calidad con una incidencia automática.`, sinActor: true };
    case "subir":
      if (entidad === "sgc_documentos") return { accion: `cargó un archivo ${a(O)}`, quePaso: `${quien} cargó un archivo ${a(O)} (en borrador).` };
      return { accion: `subió ${ref ? `el documento «${ref}»` : "un documento"} a la biblioteca`, quePaso: `${quien} subió ${ref ? `el documento «${ref}»` : "un documento"} a la biblioteca${d.visibilidad === "roles" ? "; solo lo ven algunos roles" : ""}.` };
    case "subir_version":
      return { accion: `subió una nueva versión ${de(O)}`, quePaso: `${quien} subió una nueva versión ${de(O)}. La versión anterior se conserva.${d.nota_version ? ` Nota: «${texto(d.nota_version)}».` : ""}` };
    case "archivar":
      return { accion: `archivó ${O}`, quePaso: `${quien} archivó ${O}: ya no aparece en la biblioteca, pero se conserva.` };
    case "categoria":
      return Object.keys(cambios).some((k) => k !== "_detalle")
        ? { accion: `modificó la categoría «${ref || ""}» de la biblioteca`, quePaso: `${quien} modificó la categoría «${ref || ""}» de la biblioteca.` }
        : { accion: `creó la categoría «${ref || ""}» en la biblioteca`, quePaso: `${quien} creó la categoría «${ref || ""}» en la biblioteca.` };
    case "publicar":
      if (entidad === "sgc_documentos" && d.carga_inicial) return { accion: `registró como vigente ${O}`, quePaso: `${quien} registró ${O} como vigente en la carga inicial: el documento ya estaba autorizado fuera de la plataforma.` };
      if (entidad === "sgc_documentos") return { accion: `publicó ${O}`, quePaso: `${quien} publicó ${O}: queda vigente.` };
      return { accion: `publicó ${O}`, quePaso: `${quien} publicó ${O} como vigente (sistema anterior de documentos).` };
    case "nueva_revision":
      return { accion: `abrió una revisión nueva ${de(O)}`, quePaso: `${quien} abrió la revisión ${texto(d.revision)} ${de(O)} en borrador. La revisión vigente sigue en uso mientras tanto.` };
    case "consultar":
      return { accion: `consultó ${O}`, quePaso: `${quien} abrió para consultar ${O} (documento ${String(d.confidencialidad) === "confidencial" ? "confidencial" : "restringido"}).` };
    case "confirmar_lectura":
      return { accion: `confirmó que leyó ${O}`, quePaso: `${quien} confirmó que leyó y comprendió ${O} (sistema anterior de documentos).` };
    case "proponer":
      return { accion: entidad === "no_conformidades" ? `propuso un cambio de documento desde ${O}` : `propuso ${O}`, quePaso: `${quien} propuso un documento nuevo o un cambio (sistema anterior de documentos).` };
    case "exportar": {
      const historial = /^Historial/.test(texto(record.referencia));
      const lista = ["incidencias", "no_conformidades", "acciones_correctivas"].includes(entidad);
      const que = lista ? `la lista de ${meta.plural}` : historial ? `el historial ${de(`${meta.art} ${meta.noun}`)}` : "el registro de actividad";
      return { accion: `descargó una copia ${de(que)}`, quePaso: `${quien} descargó una copia ${de(que)} en una hoja de cálculo.${lista ? "" : " Esta opción ya no existe en la plataforma."}` };
    }
    case "adjuntar":
    case "anular_adjunto": {
      const que = TIPO_EVIDENCIA_ART[String(d.tipo_evidencia)] || "una evidencia";
      const desc = d.descripcion ? ` «${texto(d.descripcion)}»` : "";
      return accion === "adjuntar"
        ? { accion: `adjuntó ${que}${desc} ${a(O)}`, quePaso: `${quien} adjuntó ${que}${desc} ${a(O)}.` }
        : { accion: `anuló ${que}${desc} ${de(O)}`, quePaso: `${quien} anuló ${que}${desc} ${de(O)}. El archivo se conserva para consulta.` };
    }
    case "respaldar":
      return sistema
        ? { accion: "Se creó un respaldo automático", quePaso: "La plataforma guardó automáticamente una copia de seguridad de toda su información.", sinActor: true }
        : { accion: "creó un respaldo", quePaso: `${quien} guardó una copia de seguridad de toda la información de la plataforma.` };
    case "respaldo_fallido":
      return { accion: "falló la creación de un respaldo", quePaso: `No se pudo terminar un respaldo${sistema ? "" : ` que ${quien} intentó crear`}. Revisa que haya espacio en el disco.`, sinActor: sistema };
    case "probar_restauracion": {
      const res = String(d.resultado || "");
      const frase = res === "aprobada" ? "La prueba salió bien: el respaldo se puede recuperar." : res === "fallida" ? "La prueba encontró problemas: no confíes en ese respaldo hasta revisarlo." : "La prueba no pudo terminarse.";
      return { accion: `probó la restauración de un respaldo${res === "aprobada" ? " (salió bien)" : res === "fallida" ? " (encontró problemas)" : ""}`, quePaso: `${quien} probó recuperar un respaldo en una copia aparte, sin tocar la plataforma. ${frase}` };
    }
    case "restaurar_respaldo":
      return { accion: "Se restauró un respaldo", quePaso: `La información de la plataforma se recuperó desde una copia de seguridad${d.responsable ? `; lo hizo ${texto(d.responsable)}` : ""}.`, sinActor: true };
    case "reportar":
      if (sistema || d.origen_automatico) return { accion: `Se registró automáticamente ${O}`, quePaso: `La plataforma registró ${O} por su cuenta${d.origen_automatico ? `: ${(ORIGEN_AUTOMATICO_LABEL[String(d.origen_automatico)] || palabras(String(d.origen_automatico))).toLowerCase()}` : ""}. Calidad debe evaluarla.`, sinActor: true };
      return { accion: `reportó ${O}`, quePaso: `${quien} reportó ${O}${d.tipo ? ` (${(TIPO_INCIDENCIA_LABEL[String(d.tipo)] || palabras(String(d.tipo))).toLowerCase()})` : ""}. Calidad debe evaluarla.` };
    case "evaluar":
      return { accion: `empezó a evaluar ${O}`, quePaso: `${quien} empezó a evaluar ${O} para decidir qué hacer.` };
    case "cerrar_sin_nc":
      return { accion: `cerró ${O} sin abrir una no conformidad`, quePaso: `${quien} evaluó ${O} y la cerró: no fue necesario abrir una no conformidad.` };
    case "escalar":
      return entidad === "no_conformidades"
        ? { accion: `agregó la incidencia ${texto(d.incidencia)} ${a(O)}`.replace("  ", " "), quePaso: `${quien} agregó la incidencia ${texto(d.incidencia)} ${a(O)}.`.replace("  ", " ") }
        : { accion: `convirtió ${O} en una no conformidad`, quePaso: `${quien} decidió que ${O} es una no conformidad${d.nc ? ` y abrió la ${texto(d.nc)}` : ""}.` };
    case "avanzar": {
      const etapa = ESTADOS_NC[String(d.etapa)]?.label || palabras(String(d.etapa || ""));
      return { accion: `pasó ${O} a la etapa «${etapa}»`, quePaso: `${quien} pasó ${O} a la etapa «${etapa}».` };
    }
    case "iniciar_accion":
      return { accion: `inició una acción correctiva ${de(O)}`, quePaso: `${quien} empezó a trabajar en una acción correctiva ${de(O)}.` };
    case "implementar":
      return { accion: `marcó como hecha una acción correctiva ${de(O)}`, quePaso: `${quien} registró que terminó una acción correctiva ${de(O)}${d.implementacion ? `: «${recortar(texto(d.implementacion))}»` : ""}.` };
    case "cancelar":
      return { accion: `canceló una acción correctiva ${de(O)}`, quePaso: `${quien} canceló una acción correctiva ${de(O)}.` };
    case "reasignar":
      return d.accion_correctiva
        ? { accion: `cambió el responsable de una acción correctiva ${de(O)}`, quePaso: `${quien} cambió quién se encarga de una acción correctiva ${de(O)}.` }
        : { accion: `cambió el responsable ${de(O)}`, quePaso: `${quien} cambió quién se encarga ${de(O)}.` };
    case "verificar":
      return d.resultado === "eficaz"
        ? { accion: `confirmó que las acciones ${de(O)} funcionaron`, quePaso: `${quien} verificó que las acciones ${de(O)} resolvieron el problema.` }
        : { accion: `encontró que las acciones ${de(O)} no funcionaron`, quePaso: `${quien} verificó que las acciones ${de(O)} no resolvieron el problema, así que se vuelve a analizar.` };
    case "suspender":
    case "reanudar": {
      const verbo = accion === "suspender" ? "suspendió" : "reanudó";
      const que = entidad === "no_conformidades" ? suspensionLegible(texto(d.suspension)) : O;
      const por = entidad === "no_conformidades" ? ` por ${O}` : d.nc ? ` por la ${texto(d.nc)}` : "";
      return { accion: `${verbo} ${que}${por}`, quePaso: accion === "suspender" ? `${quien} suspendió ${que}${por}: no se puede usar hasta que se reanude.` : `${quien} reanudó ${que}${por}; ya se puede usar de nuevo.${d.sigue_suspendido_por ? ` Sigue suspendido por ${texto(d.sigue_suspendido_por)}.` : ""}` };
    }
    case "retener":
    case "liberar_retencion": {
      const informe = entidad === "informes" ? O : texto(d.informe) ? `el informe ${texto(d.informe)}` : "un informe";
      const por = entidad === "informes" ? (d.nc ? ` por la ${texto(d.nc)}` : "") : ` por ${O}`;
      return accion === "retener"
        ? { accion: `retuvo ${informe}${por}`, quePaso: `${quien} detuvo ${informe}${por}: no puede enviarse al cliente mientras siga retenido.` }
        : { accion: `liberó la retención ${de(informe)}${por}`, quePaso: `${quien} quitó la retención ${de(informe)}${por}; ya puede continuar.` };
    }
    case "comunicar":
      return { accion: `registró una comunicación con el cliente sobre ${O}`, quePaso: `${quien} registró que habló con el cliente sobre ${O}${d.contacto ? ` (con ${texto(d.contacto)})` : ""}${d.fecha ? ` el ${formatearFecha(d.fecha)}` : ""}.` };
    case "afectar":
      return { accion: `marcó ${texto(d.informe) ? `el informe ${texto(d.informe)}` : "un informe"} como afectado por ${O}`, quePaso: `${quien} registró que ${texto(d.informe) ? `el informe ${texto(d.informe)}` : "un informe"} se vio afectado por ${O}.` };
    case "migrar": {
      const version = Number(d.version || record.entidad_id || 0);
      if (d.modo === "baseline") return { accion: "La plataforma reconoció la información existente", quePaso: "Al instalar la nueva forma de actualizar la plataforma, se revisó la información existente y se confirmó que estaba completa. No se cambió nada.", sinActor: true };
      const para = ACTUALIZACIONES[version];
      return { accion: "La plataforma se actualizó a una nueva versión", quePaso: `La plataforma se actualizó${para ? ` para ${para}` : ""}. Antes de actualizarse se guardó un respaldo automático.`, sinActor: true };
    }
    default:
      return { accion: `hizo un cambio en ${O}`, quePaso: `${quien} hizo un cambio en ${O}.` };
  }
}

/* "Equipo Centrifuga" -> "el equipo Centrifuga"; "Equipo #1" -> "un equipo"; "Método DSP" -> "el método DSP". */
function suspensionLegible(t: string): string {
  if (!t) return "un método o equipo";
  const m = /^(Equipo|Método)\s+(.*)$/.exec(t);
  if (!m) return t;
  const cosa = m[1].toLowerCase();
  return /#\d/.test(m[2]) || !m[2].trim() ? `un ${cosa}` : `el ${cosa} ${m[2].trim()}`;
}

/* Nombre de una persona por su id (si se conoce). */
let personasActuales: Map<number, string> | undefined;
function nombrePersona(id: unknown): string | null {
  if (id === null || id === undefined) return null;
  return personasActuales?.get(Number(id)) || null;
}

/* Referencia en palabras: folios tal cual; sin ids ni rutas internas. */
function referenciaLegible(record: ApiRecord): string | null {
  const ref = texto(record.referencia);
  if (!ref) return null;
  const entidad = String(record.entidad || "");
  if (entidad === "mantenimientos") {
    const m = /^mantenimiento\s+(\w+)/i.exec(ref);
    const tipos: Record<string, string> = { calibracion: "de calibración", verificacion: "de verificación", preventivo: "preventivo", correctivo: "correctivo" };
    return m ? tipos[m[1].toLowerCase()] || null : null;
  }
  if (/^Historial /.test(ref) || /^Migración|^Línea base/.test(ref)) return null;
  // Partes con numeros internos ("acción #2", "#14") no se muestran.
  if (/#\d/.test(ref)) return ref.split(" · ").filter((p) => !/#\d/.test(p) && !/^acción$/i.test(p.trim())).join(" · ").trim() || null;
  return ref;
}

/* ---------------------------------------------------------------------------
 * Entrada completa
 * ------------------------------------------------------------------------- */

export function humanizeAuditEntry(record: ApiRecord, ctx: ContextoActividad = {}): HumanEntry {
  personasActuales = ctx.personas;
  const entidad = String(record.entidad || "");
  const accion = String(record.accion || "");
  const cambios = (record.cambios || {}) as Cambios;
  const d = ((cambios._detalle as ApiRecord | undefined) || {}) as ApiRecord;
  // Las altas iniciales se guardaron a nombre de "sistema": tambien son de la plataforma.
  const isSystem = !record.usuario_email && (!record.usuario_nombre || /^sistema$/i.test(String(record.usuario_nombre)));
  const actor = isSystem ? "" : String(record.usuario_nombre || record.usuario_email || "");
  const partes = redactar(record, actor, isSystem);
  // Lo que hizo la plataforma (o un evento sin persona) ya es una frase completa.
  const sinActor = partes.sinActor || isSystem;
  const frase = sinActor ? cap(isSystem && !partes.sinActor ? `la plataforma ${partes.accion}` : partes.accion) : `${actor} ${partes.accion}`;
  const quePaso = isSystem && !partes.sinActor ? partes.quePaso.replace(/^Alguien /, "La plataforma ") : partes.quePaso;
  const referencia = referenciaLegible(record);
  const route = ENTITY_ROUTE[entidad];
  const entidadId = record.entidad_id !== null && record.entidad_id !== undefined && record.entidad_id !== "" ? String(record.entidad_id) : null;
  const href = ACCIONES_DE_SESION.has(accion) || !route || (!entidadId && !referencia) ? null : route(entidadId || "", texto(record.referencia));
  const actuo = d.actuo_como;
  const cargo = actuo && typeof actuo === "object" ? texto((actuo as ApiRecord).cargo) || null : typeof actuo === "string" ? actuo : null;
  // En las migraciones, el "motivo" es el nombre tecnico de la migracion: no se muestra.
  const motivo = accion === "migrar" || !texto(record.motivo) ? null : texto(record.motivo);
  const cambiosFrases = record.datos_restringidos ? [] : frasesDeCambios(cambios, entidad, ctx, referencia);
  return {
    id: Number(record.id),
    when: record.fecha_hora ? instanteDe(record.fecha_hora) : null,
    actor,
    isSystem,
    cargo,
    action: partes.accion,
    frase,
    quePaso,
    cambios: cambiosFrases,
    verb: accion,
    entidad,
    entidadId,
    area: ACCIONES_DE_SESION.has(accion) ? "Inicio de sesión" : ENTIDAD[entidad]?.area || "Plataforma",
    reference: referencia,
    motivo,
    href,
    claveGrupo: `${texto(record.usuario_email) || texto(record.usuario_nombre) || "sistema"}|${accion}|${entidad}|${entidadId || texto(record.referencia)}`,
  };
}

/* ---------------------------------------------------------------------------
 * Fechas en palabras
 * ------------------------------------------------------------------------- */

/* "Hoy", "Ayer" o "Miércoles 24 de septiembre", para agrupar por dia. */
export function dayLabel(date: Date | null): string {
  if (!date) return "Sin fecha";
  // Dia local del laboratorio, no del navegador.
  const dia = fechaSola(date);
  const hoy = hoyLocal();
  const diff = diasEntre(dia, hoy) ?? 0;
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  const largo = dia.slice(0, 4) === hoy.slice(0, 4) ? formatearFechaLarga(dia).replace(/ de \d{4}$/, "") : formatearFechaLarga(dia);
  return `${diaSemana(dia)} ${largo}`.replace(/^\w/, (c) => c.toUpperCase());
}

export function timeLabel(date: Date | null): string {
  return formatearHora(date, "—");
}

/* "hace un momento", "hace 5 minutos", "hace 2 horas", "ayer", "hace 4 días". */
export function haceCuanto(date: Date | null, ahora = new Date()): string {
  if (!date) return "";
  const seg = Math.max(0, Math.round((ahora.getTime() - date.getTime()) / 1000));
  if (seg < 60) return "hace un momento";
  const min = Math.round(seg / 60);
  if (min < 60) return min === 1 ? "hace 1 minuto" : `hace ${min} minutos`;
  const h = Math.round(min / 60);
  if (h < 24) return h === 1 ? "hace 1 hora" : `hace ${h} horas`;
  const dias = Math.round(h / 24);
  if (dias === 1) return "ayer";
  if (dias < 31) return `hace ${dias} días`;
  const meses = Math.round(dias / 30);
  if (meses < 12) return meses === 1 ? "hace 1 mes" : `hace ${meses} meses`;
  const anios = Math.round(meses / 12);
  return anios === 1 ? "hace 1 año" : `hace ${anios} años`;
}

/* "3 de octubre de 2026 a las 16:57". */
export function fechaYHora(date: Date | null): string {
  if (!date) return "Sin fecha";
  return `${formatearFechaLarga(fechaSola(date))} a las ${formatearHora(date)}`;
}
