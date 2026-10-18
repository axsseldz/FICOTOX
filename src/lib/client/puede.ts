"use client";

import { useSession } from "@/components/session/SessionProvider";
import { API_BASE_URL, getJsonAuth } from "./api";
import { useResource } from "./store";
import type { ApiRecord } from "./types";

/*
 * Banderas "puede" que calcula el servidor por registro (rol + autorizacion
 * FX-THF-AP + asignacion + segregacion). Ver src/lib/server/puede-registro.ts.
 * - ok: se ofrece el boton;
 * - !ok y con motivo: boton deshabilitado con el motivo como explicacion;
 * - !ok sin motivo: no puede, el boton se oculta.
 */
export interface PuedeFlag {
  ok: boolean;
  motivo?: string;
}

export function bandera(item: ApiRecord | null | undefined, accion: string): PuedeFlag | null {
  const puede = item?.puede as Record<string, PuedeFlag> | undefined;
  return puede?.[accion] || null;
}

/* ¿Se ofrece la accion (habilitada o deshabilitada con motivo)? Sin banderas del servidor, cae al permiso por rol. */
export const seOfrece = (item: ApiRecord | null | undefined, accion: string, porRol: boolean): boolean => {
  const b = bandera(item, accion);
  return b ? b.ok || !!b.motivo : porRol;
};

/* ¿Esta habilitada? */
export const estaHabilitada = (item: ApiRecord | null | undefined, accion: string, porRol: boolean): boolean => {
  const b = bandera(item, accion);
  return b ? b.ok : porRol;
};

/* Motivo por el que una accion ofrecida esta deshabilitada. */
export const motivoDe = (item: ApiRecord | null | undefined, accion: string): string | undefined => {
  const b = bandera(item, accion);
  return b && !b.ok ? b.motivo : undefined;
};

export type TipoRegistro = "recepcion" | "procesamiento" | "extraccion" | "analisis" | "informe";

/* Si la persona puede crear cada tipo de registro (rol + autorizacion de la actividad), segun el servidor. */
export function usePuedeCrear(): (tipo: TipoRegistro, porRol: boolean) => boolean {
  const { token } = useSession();
  const recurso = useResource<Record<string, PuedeFlag>>("puede-crear", async () => ((await getJsonAuth(`${API_BASE_URL}/samples/puede-crear`, token)).puede || {}) as Record<string, PuedeFlag>, { enabled: !!token });
  return (tipo, porRol) => {
    const flag = recurso.data?.[tipo];
    return flag ? flag.ok : porRol;
  };
}
