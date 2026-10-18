
/* Catalogos y metadatos de la interfaz; los de recepcion salen del formato oficial (src/lib/shared/sgc.ts). */

export interface ReactivoTypeConfig {
  value: string;
  label: string;
  hint: string;
  fields: string[];
}

/* Todas las categorías de reactivos comparten el mismo conjunto de campos; las columnas cromatográficas tienen el suyo, sin cantidades. */
export const REACTIVO_CAMPOS_COMUNES = [
  "id_interno",
  "producto",
  "marca",
  "proveedor",
  "catalogo",
  "cas",
  "lote",
  "localizacion",
  "contenedor",
  "capacidad",
  "unidad_capacidad",
  "piezas",
  "fecha_ingreso",
  "fecha_apertura",
  "caducidad",
  "stock_minimo",
  "observaciones",
];
export const REACTIVO_CAMPOS_COLUMNA = ["id_interno", "producto", "marca", "proveedor", "localizacion", "lote", "parte", "serie", "descripcion", "fecha_ingreso", "fecha_apertura", "nuevo_usado", "metodo", "observaciones"];

export const CONTENEDORES_REACTIVO = ["Botella", "Botella de vidrio ámbar", "Botella de plástico", "Ampolleta", "Vial", "Bidón", "Sobre", "Otro"];
export const UNIDADES_REACTIVO = ["L", "mL", "kg", "g"];
export const CONTENEDORES_CONSUMIBLE = ["Caja", "Bolsa", "Rollo", "Bote", "Otro"];

export const REACTIVO_TYPES: ReactivoTypeConfig[] = [
  { value: "acidos", label: "Ácidos", hint: "Ácidos del laboratorio: identificación, proveedor, contenedor, capacidad y caducidad.", fields: REACTIVO_CAMPOS_COMUNES },
  { value: "alcoholes_solventes", label: "Alcoholes y solventes orgánicos", hint: "Alcoholes y solventes orgánicos, con su localización en el laboratorio.", fields: REACTIVO_CAMPOS_COMUNES },
  { value: "compuestos_amonio", label: "Compuestos de Amonio", hint: "Sales y compuestos de amonio.", fields: REACTIVO_CAMPOS_COMUNES },
  { value: "compuestos_sodio", label: "Compuestos de Sodio", hint: "Compuestos de sodio (la capacidad suele ir en kg).", fields: REACTIVO_CAMPOS_COMUNES },
  { value: "estandares_preparados", label: "Estándares preparados", hint: "Preparaciones internas.", fields: REACTIVO_CAMPOS_COMUNES },
  { value: "materiales_referencia", label: "Materiales de Referencia", hint: "Materiales de referencia certificados (CRM).", fields: REACTIVO_CAMPOS_COMUNES },
  { value: "miscelaneos", label: "Misceláneos", hint: "Sustancias y materiales que no caen en otra categoría.", fields: REACTIVO_CAMPOS_COMUNES },
  { value: "columnas_cromatograficas", label: "Columnas cromatográficas", hint: "Columnas por lote, parte, serie, condición y método. No llevan cantidad ni existencias.", fields: REACTIVO_CAMPOS_COLUMNA },
];

export interface ReactivoFieldMeta {
  label: string;
  required?: boolean;
  type?: string;
  step?: string;
  min?: string;
  textarea?: boolean;
  wide?: boolean;
  options?: string[];
  target?: string;
  hint?: string;
}

export const REACTIVO_FIELD_META: Record<string, ReactivoFieldMeta> = {
  id_interno: { label: "ID interno" },
  producto: { label: "Producto", required: true },
  marca: { label: "Marca" },
  proveedor: { label: "Proveedor", hint: "Puede ser distinto de la marca." },
  catalogo: { label: "Número de catálogo" },
  cas: { label: "CAS" },
  lote: { label: "Lote" },
  localizacion: { label: "Localización" },
  contenedor: { label: "Contenedor", options: CONTENEDORES_REACTIVO },
  capacidad: { label: "Capacidad por envase", type: "number", step: "any", min: "0" },
  unidad_capacidad: { label: "Unidad", options: UNIDADES_REACTIVO },
  piezas: { label: "Piezas", type: "number", step: "any", min: "0", hint: "Número de envases; acepta decimales." },
  fecha_ingreso: { label: "Fecha de ingreso", type: "date" },
  fecha_apertura: { label: "Fecha de apertura", type: "date" },
  caducidad: { label: "Caducidad", type: "date" },
  stock_minimo: { label: "Stock mínimo", type: "number", step: "any", min: "0", hint: "Opcional, en la misma unidad. Al llegar a esta cantidad aparece el aviso de stock bajo." },
  observaciones: { label: "Observaciones", textarea: true, wide: true },
  parte: { label: "Número de parte" },
  serie: { label: "Número de serie" },
  descripcion: { label: "Descripción", textarea: true, wide: true, hint: "Dimensiones y partícula." },
  nuevo_usado: { label: "Condición", options: ["Nueva", "Usada"] },
  metodo: { label: "Método", options: ["PSP", "DSP", "ASP", "Otro"] },
};

/* Nombres cortos para las listas (el nombre completo queda en el tooltip y en la ventana); no cambian los datos guardados. */
export const ANALYSIS_NAME_SHORT: Record<string, string> = {
  acido_domoico: "Ácido domoico (ASP)",
  toxinas_lipofilicas: "Toxinas lipofílicas (DSP)",
  toxinas_paralizantes: "Toxinas paralizantes (PSP)",
};
export const ANALYSIS_METHOD_SHORT: Record<string, string> = {
  hplc_uv_vis: "HPLC-UV",
  hplc_ms_ms: "HPLC-MS/MS",
  hplc_fld: "HPLC-FLD",
  bioensayo_raton: "Bioensayo en ratón",
};
