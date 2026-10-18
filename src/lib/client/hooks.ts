"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/* Valor con retardo: evita una peticion por cada tecla en las busquedas. */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/*
 * Bandera de la URL (?nuevo=1) que dispara una accion una sola vez y se
 * limpia de la direccion, para que la paleta de comandos pueda abrir
 * formularios desde cualquier parte.
 */
export function useUrlTrigger(name: string, onTrigger: () => void): void {
  const params = useSearchParams();
  const router = useRouter();
  const value = params.get(name);
  useEffect(() => {
    if (!value) return;
    onTrigger();
    const next = new URLSearchParams(params.toString());
    next.delete(name);
    const query = next.toString();
    router.replace(query ? `?${query}` : window.location.pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}

/* Lee un parametro de la URL una sola vez (valor inicial de una busqueda). */
export function useInitialParam(name: string): string {
  const params = useSearchParams();
  const [initial] = useState(() => params.get(name) || "");
  return initial;
}

/*
 * Avisa cuando un parametro de la URL cambia despues del primer render (por
 * ejemplo, elegir otro resultado en la busqueda estando ya en la lista). El
 * valor inicial lo toma `useInitialParam`; aqui solo se reacciona a cambios.
 */
export function useParamChange(name: string, onChange: (value: string) => void): void {
  const params = useSearchParams();
  const value = params.get(name) || "";
  const first = useRef(true);
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  });
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    handler.current(value);
  }, [value]);
}

/* Como `useParamChange`, pero para varios parametros a la vez (avisa una vez por cambio de cualquiera de ellos). */
export function useParamsChange(names: string[], onChange: () => void): void {
  const params = useSearchParams();
  const firma = names.map((name) => params.get(name) || "").join("\u0001");
  const first = useRef(true);
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  });
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    handler.current();
  }, [firma]);
}

export function useOpenState<T = null>() {
  const [state, setState] = useState<{ isOpen: boolean; key: number; payload: T | null }>({ isOpen: false, key: 0, payload: null });
  const open = useCallback((payload: T | null = null) => setState((prev) => ({ isOpen: true, key: prev.key + 1, payload })), []);
  const close = useCallback(() => setState((prev) => ({ ...prev, isOpen: false })), []);
  return { isOpen: state.isOpen, key: state.key, payload: state.payload, open, close };
}

/*
 * ?abrir=<id>: abre la ventana de detalle de ese registro en cuanto la lista
 * termina de cargar (lo usa el Inicio para que cada pendiente abra la misma
 * ventana que su lista). Luego se limpia de la direccion.
 */
export function useAbrirDesdeUrl<T extends { id?: unknown }>(filas: T[] | null | undefined, abrir: (indice: number) => void, parametro = "abrir"): void {
  const params = useSearchParams();
  const router = useRouter();
  const valor = params.get(parametro);
  const abrirRef = useRef(abrir);
  useEffect(() => {
    abrirRef.current = abrir;
  });
  useEffect(() => {
    if (!valor || !filas) return;
    const indice = filas.findIndex((fila) => String(fila.id) === valor);
    void Promise.resolve().then(() => {
      if (indice >= 0) abrirRef.current(indice);
      const next = new URLSearchParams(params.toString());
      next.delete(parametro);
      const query = next.toString();
      router.replace(query ? `?${query}` : window.location.pathname, { scroll: false });
    });
  }, [valor, filas, params, router, parametro]);
}
