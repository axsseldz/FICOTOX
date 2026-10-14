"use client";

import { useSession } from "@/components/session/SessionProvider";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { useResource } from "@/lib/client/store";

/* Tarea de la bandeja de Documentos SGC (GET /api/sgc/bandeja). */
export interface TareaSgc {
  clave: string;
  tipo: string;
  accion: string;
  papel: string;
  documento_id: number | null;
  clave_documento: string | null;
  titulo: string;
  revision: number | null;
  fecha_limite: string | null;
  vencida: boolean;
  desde: string | null;
  href: string;
}

export function useBandejaSgc(enabled = true) {
  const { token } = useSession();
  return useResource<{ items: TareaSgc[]; total: number }>(["sgc", "sgc-bandeja"], async () => (await getJsonAuth(`${API_BASE_URL}/sgc/bandeja`, token)) as unknown as { items: TareaSgc[]; total: number }, { enabled: !!token && enabled });
}
