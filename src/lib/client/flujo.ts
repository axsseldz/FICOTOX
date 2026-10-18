/*
 * Etapas del flujo de muestras tal como las muestra el Inicio (y el filtro
 * "Etapa del flujo" de Recepción): Recepción → Procesamiento → Extracción →
 * Análisis → Revisión → Informe → Cierre. "Revisión" reúne los análisis y
 * los informes que esperan una firma. La etapa de cada muestra la calcula
 * el servidor (`/inicio/en-curso`, campo `etapa_flujo`) con sus alcances.
 */
export const ETAPAS_FLUJO = [
  { clave: "recepcion", label: "Recepción" },
  { clave: "procesamiento", label: "Procesamiento" },
  { clave: "extraccion", label: "Extracción" },
  { clave: "analisis", label: "Análisis" },
  { clave: "revision", label: "Revisión" },
  { clave: "informe", label: "Informe" },
  { clave: "cierre", label: "Cierre" },
] as const;

export type EtapaFlujo = (typeof ETAPAS_FLUJO)[number]["clave"];

export const esEtapaFlujo = (valor: string): valor is EtapaFlujo => ETAPAS_FLUJO.some((e) => e.clave === valor);
