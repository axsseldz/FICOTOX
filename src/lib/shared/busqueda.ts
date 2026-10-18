/*
 * Búsqueda universal: tipos compartidos por el servidor (GET /api/busqueda y
 * /api/busqueda/recientes) y la interfaz (Inicio y ventana ⌘K), más las
 * utilidades de texto que ambos necesitan para normalizar y resaltar.
 */

export type TipoResultado =
  | "muestra"
  | "analisis"
  | "informe"
  | "reactivo"
  | "consumible"
  | "equipo"
  | "mantenimiento"
  | "movimiento"
  | "incidencia"
  | "nc"
  | "accion_correctiva"
  | "documento"
  | "persona"
  | "rol"
  | "solicitud"
  | "supervision"
  | "pantalla"
  | "accion"
  | "ayuda";

export type GrupoClave = "muestras" | "informes" | "inventario" | "calidad" | "documentos" | "personas" | "roles" | "solicitudes" | "pantallas" | "acciones";

/* Acciones que resuelve la propia interfaz (no son una dirección). */
export type Comando = "tema_oscuro" | "tema_claro" | "tema_auto" | "cuenta" | "cambiar_password" | "cerrar_sesion" | "reportar_incidencia";

export interface ResultadoBusqueda {
  /* Identificador estable (sirve para "recientes" y para validar que sigue existiendo). */
  clave: string;
  tipo: TipoResultado;
  titulo: string;
  sub?: string;
  /* Dirección a la que lleva; vacía si es un comando. */
  href: string;
  /* Folio o clave: se muestra en monoespaciado. */
  mono?: boolean;
  etiqueta?: string;
  comando?: Comando;
}

export interface GrupoBusqueda {
  clave: GrupoClave;
  titulo: string;
  /* Coincidencias totales del grupo (se muestran las 5 mejores). */
  total: number;
  resultados: ResultadoBusqueda[];
  /* "Ver todos en …": la lista con la búsqueda aplicada. */
  mas?: { href: string; etiqueta: string };
}

export interface RespuestaBusqueda {
  q: string;
  grupos: GrupoBusqueda[];
}

export interface Reciente {
  id: number;
  /* "consulta": lo que se buscó; "resultado": lo que se abrió desde la búsqueda. */
  tipo: "consulta" | "resultado";
  clave: string;
  titulo: string;
  sub: string | null;
  href: string;
  kind: TipoResultado | null;
  comando: Comando | null;
  mono: boolean;
}

export const RECIENTES_MAX = 8;
export const POR_GRUPO = 5;

export const GRUPO_TITULO: Record<GrupoClave, string> = {
  acciones: "Acciones",
  muestras: "Muestras",
  informes: "Informes",
  inventario: "Inventario",
  calidad: "Calidad",
  documentos: "Documentos SGC",
  personas: "Personas",
  roles: "Roles",
  solicitudes: "Solicitudes",
  pantallas: "Pantallas",
};

/* Sin mayúsculas ni acentos. */
export const norm = (value: unknown): string =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/* Temas del manual (/ayuda). Los anclas coinciden con las secciones de la página. */
export const HELP_TOPICS: Array<{ anchor: string; label: string; sub: string; kw: string }> = [
  { anchor: "empezar", label: "Cómo usar la plataforma", sub: "Guía rápida de FICOTOX", kw: "manual inicio empezar tutorial primeros pasos" },
  { anchor: "buscar", label: "Cómo buscar", sub: "Folios, reactivos, equipos y acciones desde el buscador", kw: "buscar buscador comando k atajos" },
  { anchor: "muestras", label: "Flujo de muestras", sub: "Recepción → procesamiento → extracción → análisis → informe", kw: "muestras flujo etapas recepcion procesamiento extraccion analisis" },
  { anchor: "extraccion", label: "Extracciones ASP y DSP", sub: "Folios, equipos, insumos y autollenado", kw: "extraccion asp dsp folio bitacora insumos" },
  { anchor: "analisis", label: "Análisis, revisión y aprobación", sub: "Resultados, controles de calidad y firmas", kw: "analisis revisar aprobar firma controles" },
  { anchor: "informes", label: "Informes de resultados", sub: "Crear, revisar, autorizar, liberar (PDF) y enviar", kw: "informes pdf autorizar liberar enviar envio correo entregar enmienda" },
  { anchor: "inventario", label: "Inventario y avisos", sub: "Stock, caducidad, equipos, mantenimiento y movimientos", kw: "inventario reactivos consumibles equipos mantenimiento movimientos avisos stock" },
  { anchor: "calidad", label: "Auditoría y trazabilidad", sub: "Qué se registra y cómo se consulta", kw: "auditoria bitacora historial trazabilidad calidad" },
  { anchor: "documentos", label: "Documentos SGC", sub: "Solicitudes, revisión, autorización, lecturas y Lista Maestra", kw: "documentos sgc procedimiento manual formato revision autorizar publicar lectura lista maestra externo norma clave fx" },
  { anchor: "anular", label: "Corregir un registro", sub: "Anular con motivo, restaurar, enmendar", kw: "anular restaurar corregir error borrar eliminar enmienda" },
  { anchor: "atajos", label: "Atajos de teclado", sub: "⌘K, Esc, navegación con flechas", kw: "atajos teclado comando" },
];
