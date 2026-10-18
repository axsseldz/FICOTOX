"use client";

import { API_BASE_URL, getJsonAuth } from "./api";
import { getStoredToken } from "./session";
import { useResource } from "./store";

/*
 * Personal activo del laboratorio con lo que puede hacer, para los selectores
 * de "quién" en los formatos. Se carga una vez por sesión de página y se
 * invalida con la clave "personal" (altas/bajas de usuarios).
 */

/* Capacidades para los selectores de "quién" (no son modulos de permisos): revision = R/A en ensayos o informes. */
export type PersonaCapacidad = "muestras" | "revision" | "informes" | "inventario";

export interface Persona {
  id: number;
  nombre: string;
  /* Roles vigentes unidos por comas (para mostrar). */
  rol: string | null;
  roles?: string[];
  puede: Record<PersonaCapacidad, boolean>;
  /* Cargo con el que figura para cada capacidad: el rol que la otorga. */
  cargos?: Partial<Record<PersonaCapacidad, string | null>>;
}

let cache: Persona[] | null = null;
let pending: Promise<Persona[]> | null = null;

const loadPersonal = (): Promise<Persona[]> => {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  const token = getStoredToken();
  if (!token) return Promise.resolve([]);
  pending = getJsonAuth(`${API_BASE_URL}/auth/personal`, token)
    .then((data) => {
      cache = (data.items || []) as Persona[];
      return cache;
    })
    .catch(() => [] as Persona[])
    .finally(() => {
      pending = null;
    });
  return pending;
};

export function usePersonal(): Persona[] {
  const resource = useResource<Persona[]>("personal", async () => {
    cache = null;
    return loadPersonal();
  });
  return resource.data || cache || [];
}
