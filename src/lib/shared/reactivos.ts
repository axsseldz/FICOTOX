/* Tipos de reactivo del catálogo (cliente y servidor). Las etiquetas y campos de cada uno viven en la interfaz (lib/client/constants.ts). */
export const TIPOS_REACTIVO = ["acidos", "alcoholes_solventes", "compuestos_amonio", "compuestos_sodio", "estandares_preparados", "materiales_referencia", "miscelaneos", "columnas_cromatograficas"] as const;

export type TipoReactivo = (typeof TIPOS_REACTIVO)[number];

export const esTipoReactivo = (valor: unknown): valor is TipoReactivo => typeof valor === "string" && (TIPOS_REACTIVO as readonly string[]).includes(valor);
