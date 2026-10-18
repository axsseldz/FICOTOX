"use client";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
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
 */

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
  return (
    <div className="overflow-hidden rounded-card bg-surface shadow-card" aria-label={etiqueta} role="region">
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
          <div className="hidden border-b border-line bg-surface-2/60 md:grid md:grid-cols-[var(--cols)]" style={estilo} aria-hidden="true">
            {columnas.map((c, i) => (
              <span key={c.clave} className={cn("py-2 text-[12px] font-medium text-ink-3", i === 0 ? "pl-5" : "pl-0")}>
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
                  className={cn("entrada-escalonada group grid grid-cols-[minmax(0,1fr)_auto] items-start transition-colors duration-200 hover:bg-surface-2/70 md:grid-cols-[var(--cols)] md:items-center", esActiva && "bg-brand-faint hover:bg-brand-faint", tenue && "[&>button]:opacity-60")}
                  style={{ ...estilo, ["--i" as string]: i } as CSSProperties}
                  {...propsFila?.(fila)}
                >
                  <button
                    type="button"
                    onClick={() => onAbrir(fila, i)}
                    aria-haspopup="dialog"
                    className="flex min-w-0 flex-col gap-2.5 py-4 pr-2 pl-4 text-left outline-none focus-visible:shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--color-brand)_45%,transparent)] sm:pl-5 md:col-[span_var(--span)_/_span_var(--span)] md:grid md:grid-cols-subgrid md:items-center md:gap-0 md:py-3.5 md:pr-0"
                    style={{ ["--span" as string]: columnas.length } as CSSProperties}
                  >
                    {valores.map((valor, k) => (
                      <div key={columnas[k]?.clave || k} className={cn("min-w-0 break-words md:pr-4", k > 0 && columnas[k]?.ocultaEnTarjeta && "hidden md:block")}>
                        {k > 0 ? <span className="mb-0.5 block text-[11px] text-ink-3 md:hidden">{columnas[k]?.titulo}</span> : null}
                        {valor}
                      </div>
                    ))}
                  </button>
                  <div className="flex items-center justify-end gap-1 py-4 pr-2 md:py-0">{extremo?.(fila)}</div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
