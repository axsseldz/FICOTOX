"use client";

import { useEffect, useState } from "react";
import { ErrorState, Skeleton } from "@/components/ui/Primitives";
import { cn } from "@/components/ui/cn";
import { explicarError } from "@/lib/client/mensajes";
import { useArchivo } from "./usarArchivo";

/*
 * xlsx, xls y csv: tabla de solo lectura con una pestaña por hoja. Usa SheetJS
 * vendorizado (public/vendor/xlsx; lo carga el
 * layout). Se muestran hasta MAX_FILAS filas por hoja.
 */
const MAX_FILAS = 2000;
type Celda = string | number | boolean | Date | null;

/* SheetJS vendorizado (public/vendor/xlsx): lo carga el layout y deja `window.XLSX`. */
declare global {
  interface Window {
    XLSX?: {
      read: (data: ArrayBuffer, options: Record<string, unknown>) => { SheetNames: string[]; Sheets: Record<string, unknown> };
      utils: {
        sheet_to_json: (sheet: unknown, options: Record<string, unknown>) => unknown[];
      };
    };
  }
}

async function esperarXlsx(): Promise<NonNullable<Window["XLSX"]>> {
  for (let i = 0; i < 100 && !window.XLSX; i += 1) await new Promise((r) => setTimeout(r, 100));
  if (!window.XLSX) throw new Error("No se pudo cargar el lector de hojas de cálculo");
  return window.XLSX;
}

const textoCelda = (v: Celda) => (v === null || v === undefined ? "" : v instanceof Date ? v.toLocaleDateString("es-MX") : String(v));

export function VisorHoja({ url }: { url: string }) {
  const { datos, error } = useArchivo(url);
  const [hojas, setHojas] = useState<{ id: string; lista: { nombre: string; filas: Celda[][]; total: number }[] } | null>(null);
  const [fallo, setFallo] = useState<unknown>(null);
  const [activa, setActiva] = useState(0);
  useEffect(() => {
    if (!datos) return;
    let vivo = true;
    (async () => {
      try {
        const XLSX = await esperarXlsx();
        const libro = XLSX.read(datos.slice(0), { type: "array", cellDates: true });
        const lista = libro.SheetNames.map((nombre) => {
          const filas = XLSX.utils.sheet_to_json(libro.Sheets[nombre], { header: 1, defval: "", raw: true, blankrows: false }) as Celda[][];
          return { nombre, filas: filas.slice(0, MAX_FILAS + 1), total: filas.length };
        });
        if (vivo) setHojas({ id: url, lista });
      } catch (err) {
        if (vivo) setFallo(err);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [datos, url]);
  if (error || fallo) return <div className="p-6"><ErrorState message={explicarError(error || fallo, "No se pudo leer la hoja de cálculo").que} /></div>;
  if (!hojas || hojas.id !== url) return <div className="p-6"><Skeleton className="h-[420px] w-full" /></div>;
  const hoja = hojas.lista[activa] || hojas.lista[0];
  const columnas = Math.max(1, ...((hoja?.filas || []).map((f) => f.length)));
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="visor-hoja">
      {hojas.lista.length > 1 ? (
        <div className="scroll-thin flex gap-1 overflow-x-auto border-b border-line bg-surface px-3 py-1.5" role="tablist" aria-label="Hojas">
          {hojas.lista.map((h, i) => (
            <button key={h.nombre} type="button" role="tab" aria-selected={i === activa} onClick={() => setActiva(i)} className={cn("press h-8 shrink-0 rounded-[8px] px-3 text-[13px]", i === activa ? "bg-brand-faint font-medium text-brand-strong" : "text-ink-2 hover:bg-surface-3")}>
              {h.nombre}
            </button>
          ))}
        </div>
      ) : null}
      <div className="scroll-thin min-h-0 flex-1 overflow-auto bg-surface" tabIndex={0} aria-label={`Hoja ${hoja?.nombre || ""}`}>
        {!hoja || !hoja.filas.length ? (
          <p className="p-6 text-[13px] text-ink-3">La hoja está vacía.</p>
        ) : (
          <table className="min-w-full border-separate border-spacing-0 text-[13px]">
            <thead className="sticky top-0 z-[1]">
              <tr>
                <th className="sticky left-0 z-[2] w-10 border-b border-r border-line bg-surface-2 px-2 py-1.5 text-[11px] font-medium text-ink-4" aria-label="Fila" />
                {Array.from({ length: columnas }, (_, c) => (
                  <th key={c} className="border-b border-r border-line bg-surface-2 px-2 py-1.5 text-left text-[11px] font-medium text-ink-3">
                    {textoCelda(hoja.filas[0][c] ?? "") || String.fromCharCode(65 + (c % 26))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hoja.filas.slice(1, MAX_FILAS + 1).map((fila, r) => (
                <tr key={r} className="hover:bg-brand-faint/50">
                  <td className="tnum sticky left-0 border-b border-r border-line bg-surface-2 px-2 py-1 text-right text-[11px] text-ink-4">{r + 2}</td>
                  {Array.from({ length: columnas }, (_, c) => (
                    <td key={c} className={cn("max-w-[320px] truncate border-b border-r border-line px-2 py-1 text-ink", typeof fila[c] === "number" && "tnum text-right")} title={textoCelda(fila[c] ?? null)}>
                      {textoCelda(fila[c] ?? null)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {hoja && hoja.total > MAX_FILAS + 1 ? <p className="p-3 text-[12.5px] text-ink-3">Se muestran las primeras {MAX_FILAS.toLocaleString("es-MX")} filas de {hoja.total.toLocaleString("es-MX")}. Descarga el archivo para verlo completo.</p> : null}
      </div>
    </div>
  );
}
