"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/components/session/SessionProvider";
import type { GrupoBusqueda, Reciente, ResultadoBusqueda } from "@/lib/shared/busqueda";
import { API_BASE_URL, getJsonAuth, sendJsonAuth } from "./api";

/*
 * Búsqueda universal (cliente). Toda la lógica de qué se encuentra y qué
 * puede ver o hacer la persona vive en el servidor (GET /api/busqueda); aquí
 * solo se pregunta, se cancela lo viejo y se llevan los recientes (también del
 * servidor, así la siguen a cualquier computadora). La usan, idénticos, el
 * buscador del Inicio y la ventana ⌘K de la barra lateral.
 */

const PAUSA_MS = 160;
/* El indicador de carga solo aparece si la respuesta tarda: así no parpadea. */
const INDICADOR_MS = 220;

export function useBusqueda() {
  const { token } = useSession();
  const [query, setQuery] = useState("");
  const [grupos, setGrupos] = useState<GrupoBusqueda[]>([]);
  const [buscado, setBuscado] = useState("");
  const [cargando, setCargando] = useState(false);
  const [recientes, setRecientes] = useState<Reciente[]>([]);
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  useEffect(() => {
    const texto = query.trim();
    if (!token || !texto) {
      // Sin texto no hay nada que buscar: se descarta lo anterior (derivado de `query`, sin parpadeos al escribir).
      const limpiar = window.setTimeout(() => {
        setGrupos([]);
        setBuscado("");
        setCargando(false);
      }, 0);
      return () => window.clearTimeout(limpiar);
    }
    const controlador = new AbortController();
    let indicador: number | undefined;
    const pausa = window.setTimeout(() => {
      indicador = window.setTimeout(() => setCargando(true), INDICADOR_MS);
      getJsonAuth(`${API_BASE_URL}/busqueda?q=${encodeURIComponent(texto)}`, token, controlador.signal)
        .then((datos) => {
          if (controlador.signal.aborted) return;
          setGrupos(Array.isArray(datos.grupos) ? (datos.grupos as GrupoBusqueda[]) : []);
          setBuscado(texto);
        })
        .catch(() => undefined)
        .finally(() => {
          window.clearTimeout(indicador);
          if (!controlador.signal.aborted) setCargando(false);
        });
    }, PAUSA_MS);
    return () => {
      // Las búsquedas viejas se cancelan al seguir escribiendo.
      controlador.abort();
      window.clearTimeout(pausa);
      window.clearTimeout(indicador);
    };
  }, [query, token]);

  const cargarRecientes = useCallback(async () => {
    if (!token) return;
    try {
      const datos = await getJsonAuth(`${API_BASE_URL}/busqueda/recientes`, token);
      if (vivo.current) setRecientes(Array.isArray(datos.items) ? (datos.items as Reciente[]) : []);
    } catch {
      /* sin recientes */
    }
  }, [token]);

  /* Todo lo abierto o buscado se agrega a los recientes (el servidor toma el título y el enlace de su índice). */
  const registrar = useCallback(
    (resultado: ResultadoBusqueda | null, consulta: string) => {
      if (!token) return;
      const cuerpo = resultado ? { tipo: "resultado", clave: resultado.clave, consulta } : { tipo: "consulta", texto: consulta };
      void sendJsonAuth("POST", `${API_BASE_URL}/busqueda/recientes`, token, cuerpo).catch(() => undefined);
    },
    [token],
  );

  const quitar = useCallback(
    (id: number) => {
      setRecientes((lista) => lista.filter((r) => r.id !== id));
      if (token) void sendJsonAuth("DELETE", `${API_BASE_URL}/busqueda/recientes?id=${id}`, token).catch(() => undefined);
    },
    [token],
  );

  const borrarRecientes = useCallback(() => {
    setRecientes([]);
    if (token) void sendJsonAuth("DELETE", `${API_BASE_URL}/busqueda/recientes?todos=1`, token).catch(() => undefined);
  }, [token]);

  return { query, setQuery, grupos, buscado, cargando, recientes, cargarRecientes, registrar, quitar, borrarRecientes };
}
