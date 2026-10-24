"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useSession } from "@/components/session/SessionProvider";
import { ErrorState, Skeleton } from "@/components/ui/Primitives";
import { API_BASE_URL, ApiError, getJsonAuth, resolveApiEntity } from "@/lib/client/api";
import { useVersions } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";

/*
 * Carga un registro por id y monta el formato con el dato listo (sin parpadeos).
 * `keys` son claves de invalidacion: cuando una accion (revisar, autorizar,
 * entregar...) llama a invalidate(...) el registro se vuelve a leer en sitio.
 */
export function RecordLoader({ url, keys = [], children }: { url: string; keys?: string[]; children: (item: ApiRecord) => ReactNode }) {
  const { token } = useSession();
  const [state, setState] = useState<{ item: ApiRecord | null; error: string | null; status?: number | null }>({ item: null, error: null });
  const version = useVersions(keys);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getJsonAuth(`${API_BASE_URL}${url}`, token)
      .then((data) => !cancelled && setState({ item: resolveApiEntity(data), error: null }))
      .catch((err) => !cancelled && setState({ item: null, error: err instanceof Error ? err.message : "No se pudo cargar el registro", status: err instanceof ApiError ? err.status : null }));
    return () => {
      cancelled = true;
    };
  }, [url, token, version]);

  if (state.error) {
    return (
      <div className="mx-auto w-full max-w-[1216px]">
        <ErrorState message={state.error} status={state.status} />
      </div>
    );
  }
  if (!state.item) {
    return (
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-4" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
          <Skeleton className="hidden h-64 lg:block" />
          <div className="flex flex-col gap-4">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      </div>
    );
  }
  return <>{children(state.item)}</>;
}
