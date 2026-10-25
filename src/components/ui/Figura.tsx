"use client";

import { useMemo } from "react";
import { useSession } from "@/components/session/SessionProvider";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { useResource, versionDe } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { figurasPorDefecto, isAvatarKey, type AvatarKey } from "@/lib/shared/avatars";

/*
 * Directorio de personas (cuentas activas) para mostrar a cada quien con su
 * figura de perfil en toda la plataforma. Se invalida con "cuentas-activas".
 * Quien no eligio figura recibe una distinta a las de los demas
 * (figurasPorDefecto), la misma en Mi cuenta y en las listas.
 *
 * Cada figura usa este hook: todas comparten una sola peticion por sesion y
 * version de "cuentas-activas" (antes, una lista de 300 cuentas lanzaba cientos
 * de peticiones y el navegador las cortaba con ERR_INSUFFICIENT_RESOURCES).
 */
let directorio: { clave: string; promesa: Promise<ApiRecord[]> } | null = null;

function cargarDirectorio(token: string): Promise<ApiRecord[]> {
  const clave = `${token}|${versionDe("cuentas-activas")}`;
  if (directorio?.clave !== clave) {
    const promesa = getJsonAuth(`${API_BASE_URL}/cuentas/activas`, token).then((r) => (r.items || []) as ApiRecord[]);
    directorio = { clave, promesa };
    // Una falla no se queda guardada: la siguiente figura vuelve a pedir.
    promesa.catch(() => {
      if (directorio?.promesa === promesa) directorio = null;
    });
  }
  return directorio.promesa;
}

function useDirectorio(): ApiRecord[] {
  const { token } = useSession();
  const recurso = useResource<ApiRecord[]>("cuentas-activas", () => cargarDirectorio(token), { enabled: !!token });
  return recurso.data || [];
}

/* Semilla (correo o nombre) -> figura por omision distinta. */
function useFigurasPorDefecto(): Map<string, AvatarKey> {
  const personas = useDirectorio();
  return useMemo(() => figurasPorDefecto(personas), [personas]);
}

/* Figura de una persona: la elegida; si no eligio, la distinta del directorio; si no esta en el directorio, la de su correo. */
export function useFiguraDe(avatar: unknown, seed: string): unknown {
  const defaults = useFigurasPorDefecto();
  return isAvatarKey(avatar) ? avatar : defaults.get(seed) || avatar;
}

/* Busca a una persona del directorio por id, correo o nombre (los registros guardan a veces solo el nombre). */
export function useBuscarPersona(): (dato: { id?: unknown; email?: unknown; nombre?: unknown }) => ApiRecord | undefined {
  const personas = useDirectorio();
  return useMemo(() => {
    const porId = new Map(personas.map((p) => [Number(p.id), p]));
    const porEmail = new Map(personas.map((p) => [String(p.email || "").toLowerCase(), p]));
    const porNombre = new Map(personas.map((p) => [String(p.nombre || "").trim().toLowerCase(), p]));
    return (dato) => (dato.id !== undefined && dato.id !== null && porId.get(Number(dato.id))) || (dato.email ? porEmail.get(String(dato.email).toLowerCase()) : undefined) || (dato.nombre ? porNombre.get(String(dato.nombre).trim().toLowerCase()) : undefined);
  }, [personas]);
}
