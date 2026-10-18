import { formatearFolio } from "../shared/folios";
import type { ApiRecord } from "./types";
import { SAMPLE_STATES, SAMPLE_TERMINAL_STATES } from "../shared/sgc";

/* Helpers de muestras identicos a los de el app.js de la interfaz original. */

const folioDe = (predeterminado: string) => (item: ApiRecord): string => formatearFolio(String(item.tipo_registro || predeterminado).toUpperCase(), item.folio_num);

export const formatSampleFolio = folioDe("R");
export const formatProcessingFolio = folioDe("P");
export const formatExtractionFolio = folioDe("E-A");

export const normalizeSampleStatus = (status: unknown): string => String(status || "registrada").toLowerCase().replace(/\s+/g, "_");

export const sampleStatusLabel = (status: unknown): string => {
  const normalized = normalizeSampleStatus(status);
  return SAMPLE_STATES[normalized]?.label || String(status || "Registrada");
};

/* Un registro anulado, rechazado o cerrado ya no se edita. */
export const isSampleReadOnly = (status: unknown): boolean => SAMPLE_TERMINAL_STATES.has(normalizeSampleStatus(status));

export const getExtractionRowsFromProcessing = (processing: ApiRecord | null): ApiRecord[] => {
  if (!processing) {
    return [];
  }
  if ((processing.muestra_tipo || "") === "lote") {
    return Array.isArray(processing.lote_seleccion) ? processing.lote_seleccion : [];
  }
  return [
    {
      id_interno: processing.id_interno || null,
      nombre_organismo: (processing.tipo_organismo || []).join(", ") || null,
      sitio_muestreo: null,
    },
  ].filter((row) => row.id_interno || row.nombre_organismo);
};
