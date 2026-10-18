"use client";

import { useMemo } from "react";
import { useSession } from "@/components/session/SessionProvider";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { useResource } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { figurasPorDefecto, isAvatarKey, type AvatarKey } from "@/lib/shared/avatars";

/*
 * Directorio de personas (cuentas activas) para mostrar a cada quien con su
 * figura de perfil en toda la plataforma. Comparte la cache "cuentas-activas"
 * con los selectores de firmantes. Quien no eligio figura recibe una distinta
 * a las de los demas (figurasPorDefecto), la misma en Mi cuenta y en las listas.
 */
function useDirectorio(): ApiRecord[] {
  const { token } = useSession();
  const recurso = useResource<ApiRecord[]>("cuentas-activas", async () => ((await getJsonAuth(`${API_BASE_URL}/cuentas/activas`, token)).items || []) as ApiRecord[], { enabled: !!token });
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
