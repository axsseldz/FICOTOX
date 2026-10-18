"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useSession } from "@/components/session/SessionProvider";
import { API_BASE_URL } from "@/lib/client/api";
import { useBuscarPersona } from "./Figura";

/*
 * Foto de perfil propia. El endpoint exige sesion (Bearer), asi que la imagen
 * se pide con fetch y se muestra como blob: URL, con una cache compartida por
 * URL (la URL lleva la version, ?v=: una foto nueva es otra URL). Si falla, la
 * cache guarda null y el Avatar muestra la figura de la persona (nunca un
 * icono roto).
 */

const cache = new Map<string, string | null>();
const pendientes = new Set<string>();
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((f) => f());

function pedir(url: string, token: string) {
  if (cache.has(url) || pendientes.has(url)) return;
  pendientes.add(url);
  fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
    .then((blob) => cache.set(url, URL.createObjectURL(blob)))
    .catch(() => cache.set(url, null))
    .finally(() => {
      pendientes.delete(url);
      avisar();
    });
}

const suscribir = (f: () => void) => {
  oyentes.add(f);
  return () => oyentes.delete(f);
};

/* URL de la foto (128 px en listas, 512 en ventanas y Mi cuenta). */
export const urlFoto = (id: number, version: string, tam: 128 | 512) => `${API_BASE_URL}/cuentas/${id}/foto?tam=${tam}&v=${encodeURIComponent(version)}`;

/* blob: URL lista para <img>, o null mientras carga o si fallo. */
export function useFotoUrl(url: string | null): string | null {
  const { token } = useSession();
  useEffect(() => {
    if (url && token) pedir(url, token);
  }, [url, token]);
  return useSyncExternalStore(suscribir, () => (url ? (cache.get(url) ?? null) : null), () => null);
}

/* Foto que muestra una persona (si eligio "Foto" y tiene una), buscada en el directorio por id, correo o nombre. */
export function useFotoDe(dato: { id?: unknown; email?: unknown; nombre?: unknown }): { id: number; version: string } | null {
  const buscar = useBuscarPersona();
  const p = buscar(dato);
  return p && p.foto ? { id: Number(p.id), version: String(p.foto) } : null;
}
