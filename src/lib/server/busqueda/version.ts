/*
 * Versión del índice de búsqueda: sube con cada escritura exitosa de la API
 * (apiRoute) y deja sin efecto los índices guardados en memoria. Módulo sin
 * dependencias para poder importarlo desde http.ts sin ciclos.
 */
const estado = globalThis as unknown as { __ficotoxBusquedaVersion?: number };

export const versionIndice = (): number => estado.__ficotoxBusquedaVersion || 0;
export const invalidarIndice = (): void => {
  estado.__ficotoxBusquedaVersion = versionIndice() + 1;
};
