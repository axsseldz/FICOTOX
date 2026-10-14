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

/* Tareas del flujo y lecturas pendientes (CA-11); total suma ambas (contador del menu). */
export interface BandejaSgc {
  items: TareaSgc[];
  lecturas_pendientes: TareaSgc[];
  total: number;
}

export function useBandejaSgc(enabled = true) {
  const { token } = useSession();
  return useResource<BandejaSgc>(["sgc", "sgc-bandeja"], async () => (await getJsonAuth(`${API_BASE_URL}/sgc/bandeja`, token)) as unknown as BandejaSgc, { enabled: !!token && enabled });
}
