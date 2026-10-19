"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";
import { EmptyState, ErrorState, Skeleton } from "./Primitives";

/*
 * Lista en cuadricula (patron lista -> ventana de detalle): columnas fijas y
 * alineadas en todos los renglones, con encabezados discretos en gris. Cada
 * renglon es un boton que abre la ventana de detalle; a la derecha, fuera del
 * boton, los indicadores interactivos y el menu ⋯. Resalte al pasar el cursor,
 * entrada escalonada, esqueleto al cargar y estado vacio amable. En pantallas
 * angostas cada renglon pasa a tarjeta con la misma jerarquia (la primera
 * columna arriba y las demas debajo, con su etiqueta). Nada se recorta: el
 * texto largo pasa de linea dentro de su columna.
 *
 * Cuadricula o tarjeta se decide por el ANCHO DISPONIBLE de la lista (no por
 * el de la ventana): si la suma de los minimos de las columnas no cabe (tableta,
 * laptop con la barra lateral abierta), se muestran tarjetas; asi ninguna
 * columna queda cortada fuera de la vista.
 */

/* Minimo en px de una pista ("minmax(220px,1.3fr)" -> 220, "140px" -> 140, "1fr" o var(...) -> 120). */
const minimoPista = (pista: string): number => Number(/(\d+(?:\.\d+)?)px/.exec(pista)?.[1] ?? 120);

export interface ColumnaLista {
  clave: string;
  /* Encabezado discreto ("Persona", "Estado"…). */
  titulo: string;
  /* Pista de la cuadricula: "minmax(220px,1.3fr)", "140px"… */
  ancho: string;
  /* En tarjeta (angostas): se oculta si no aporta. */
  ocultaEnTarjeta?: boolean;
}

export function ListaCuadricula<T>({
  etiqueta,
  columnas,
  filas,
  clave,
  celdas,
  onAbrir,
  activa,
  extremo,
  anchoExtremo = "72px",
  cargando = false,
  error,
  onReintentar,
  vacio,
  propsFila,
  atenuada,
}: {
  etiqueta: string;
  columnas: ColumnaLista[];
  filas: T[] | null | undefined;
  clave: (fila: T) => string;
  /* Una celda por columna, en el mismo orden. */
  celdas: (fila: T, indice: number) => ReactNode[];
  onAbrir: (fila: T, indice: number) => void;
  activa?: (fila: T, indice: number) => boolean;
  /* Indicadores interactivos y menu ⋯ (fuera del boton del renglon). */
  extremo?: (fila: T) => ReactNode;
  anchoExtremo?: string;
  cargando?: boolean;
  error?: string | null;
  onReintentar?: () => void;
  vacio: { icono?: ReactNode; titulo: string; descripcion?: string; accion?: ReactNode };
  propsFila?: (fila: T) => HTMLAttributes<HTMLLIElement> & Record<`data-${string}`, string>;
  /* Renglon atenuado (anulado, archivado, de baja): se ve mas tenue pero se lee completo. */
  atenuada?: (fila: T) => boolean;
}) {
  const pistas = `${columnas.map((c) => c.ancho).join(" ")} ${anchoExtremo}`;
  const estilo = { ["--cols" as string]: pistas } as CSSProperties;
  // Suma de minimos + sangria de la primera columna y separacion entre columnas.
  const minimo = columnas.reduce((total, c) => total + minimoPista(c.ancho) + 16, 20) + minimoPista(anchoExtremo);
  const caja = useRef<HTMLDivElement>(null);
  const [cuadricula, setCuadricula] = useState(false);
  useLayoutEffect(() => {
    const el = caja.current;
    if (!el) return;
    const medir = () => setCuadricula(el.clientWidth >= minimo);
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(medir);
    observer.observe(el);
    return () => observer.disconnect();
  }, [minimo]);
  return (
    <div ref={caja} className="overflow-hidden rounded-card bg-surface shadow-card" aria-label={etiqueta} role="region" data-cuadricula={cuadricula ? "si" : "no"}>
      {error ? (
        <ErrorState message={error} onRetry={onReintentar} />
      ) : cargando || !filas ? (
        <div className="flex flex-col divide-y divide-line" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className={cn("h-3.5", i % 2 ? "w-1/3" : "w-1/4")} />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="hidden h-5 w-28 rounded-full md:block" />
              <Skeleton className="hidden h-5 w-20 rounded-full md:block" />
            </div>
          ))}
        </div>
      ) : !filas.length ? (
        <EmptyState icon={vacio.icono} title={vacio.titulo} description={vacio.descripcion} action={vacio.accion} />
      ) : (
        <>
          <div className={cn("border-b border-line bg-surface-2/60", cuadricula ? "grid grid-cols-[var(--cols)]" : "hidden")} style={estilo} aria-hidden="true">
            {columnas.map((c, i) => (
              <span key={c.clave} className={cn("py-2 text-xs font-medium text-ink-3", i === 0 ? "pl-5" : "pl-0")}>
                {c.titulo}
              </span>
            ))}
            <span />
          </div>
          <ul className="divide-y divide-line">
            {filas.map((fila, i) => {
              const valores = celdas(fila, i);
              const esActiva = activa?.(fila, i) ?? false;
              const tenue = atenuada?.(fila) ?? false;
              return (
                <li
                  key={clave(fila)}
                  className={cn("entrada-escalonada group grid transition-colors duration-200 hover:bg-surface-2/70", cuadricula ? "grid-cols-[var(--cols)] items-center" : "grid-cols-[minmax(0,1fr)_auto] items-start", esActiva && "bg-brand-faint hover:bg-brand-faint", tenue && "[&>button]:opacity-60")}
                  style={{ ...estilo, ["--i" as string]: i } as CSSProperties}
                  {...propsFila?.(fila)}
                >
                  <button
                    type="button"
                    onClick={() => onAbrir(fila, i)}
                    aria-haspopup="dialog"
                    className={cn("min-w-0 text-left foco-interior", cuadricula ? "col-[span_var(--span)_/_span_var(--span)] grid grid-cols-subgrid items-center py-3.5 pl-5" : "flex flex-col gap-2.5 py-4 pr-2 pl-4 sm:pl-5")}
                    style={{ ["--span" as string]: columnas.length } as CSSProperties}
                  >
                    {valores.map((valor, k) => (
                      <div key={columnas[k]?.clave || k} className={cn("min-w-0 break-words", cuadricula && "pr-4", !cuadricula && k > 0 && columnas[k]?.ocultaEnTarjeta && "hidden")}>
                        {k > 0 && !cuadricula ? <span className="mb-0.5 block text-2xs text-ink-3">{columnas[k]?.titulo}</span> : null}
                        {valor}
                      </div>
                    ))}
                  </button>
                  <div className={cn("flex items-center justify-end gap-1 pr-2", !cuadricula && "py-4")}>{extremo?.(fila)}</div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
