"use client";

import { Plus, X } from "@phosphor-icons/react";
import { Button, IconButton } from "@/components/ui/Button";
import { controlClassSm } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Primitives";
import { cn } from "@/components/ui/cn";
import { FormTable, formTd, formTh } from "../FormLayout";
import type { EquipoAlert } from "@/lib/client/insumos";
import { InsumoSearch } from "../InsumoSearch";
import type { BitacoraEntry, EquipoExtraRow } from "./types";

export interface EquipoUsadoRow {
  ref: string;
  nombre: string;
  uso: string;
  claveCatalogo: string;
  /* false cuando el equipo no esta en el catalogo (se guarda solo por nombre). */
  enCatalogo: boolean;
  alert: EquipoAlert | null;
  /* true si el equipo se agrego a mano (no viene de un paso del protocolo). */
  extra?: EquipoExtraRow;
}

let extraKey = 1;
export const newEquipoExtra = (ref = "", uso = ""): EquipoExtraRow => ({ key: extraKey++, ref, uso });

/*
 * Seccion "Equipos utilizados durante la extraccion": una fila por equipo
 * con su clave y folio de bitacora (tabla al final del formato DSP). Las
 * filas salen de los equipos elegidos en los pasos; se pueden agregar mas.
 */
export function EquiposUsados({ rows, bitacoras, onBitacora, extras, onExtras }: { rows: EquipoUsadoRow[]; bitacoras: Record<string, BitacoraEntry>; onBitacora: (ref: string, entry: BitacoraEntry) => void; extras: EquipoExtraRow[]; onExtras: (rows: EquipoExtraRow[]) => void }) {
  const inputClass = cn(controlClassSm, "font-mono");
  const updateExtra = (key: number, changes: Partial<EquipoExtraRow>) => onExtras(extras.map((row) => (row.key === key ? { ...row, ...changes } : row)));

  return (
    <div className="flex flex-col gap-4">
      {rows.length ? (
        <FormTable minWidth={720}>
            <thead>
              <tr>
                <th className={formTh}>Equipo</th>
                <th className={formTh}>Uso en el formato</th>
                <th className={formTh}>Clave de la bitácora</th>
                <th className={formTh}>Folio de la bitácora</th>
                <th className={formTh}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const entry = bitacoras[row.ref] || { clave: row.claveCatalogo, folio: "" };
                const clave = entry.clave || row.claveCatalogo;
                return (
                  <tr key={row.ref}>
                    <td className={cn(formTd, "font-medium text-ink")}>{row.nombre}</td>
                    <td className={cn(formTd, "text-ink-2")}>{row.uso || "-"}</td>
                    <td className={formTd}>
                      <input className={inputClass} value={clave} placeholder="FX-TCB-…" maxLength={60} onChange={(event) => onBitacora(row.ref, { clave: event.target.value, folio: entry.folio })} aria-label={`Clave de bitácora de ${row.nombre}`} />
                    </td>
                    <td className={formTd}>
                      <input className={inputClass} value={entry.folio} placeholder="Folio" maxLength={60} onChange={(event) => onBitacora(row.ref, { clave, folio: event.target.value })} aria-label={`Folio de bitácora de ${row.nombre}`} />
                    </td>
                    <td className={formTd}>
                      {!row.enCatalogo ? (
                        <Badge tone="neutral" dot>
                          Sin catálogo
                        </Badge>
                      ) : row.alert ? (
                        <Badge tone={row.alert.level === "danger" ? "danger" : row.alert.level === "warning" ? "warning" : "neutral"} dot>
                          {row.alert.message}
                        </Badge>
                      ) : (
                        <Badge tone="success" dot>
                          Apto
                        </Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
        </FormTable>
      ) : (
        <p className="rounded-field border border-dashed border-line-strong px-4 py-4 text-center text-sm text-ink-3">Los equipos que elijas en los pasos aparecerán aquí para anotar el folio de su bitácora.</p>
      )}

      {extras.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-ink-3">Otros equipos utilizados</p>
          {extras.map((row) => (
            <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_36px] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_220px_36px]">
              {/* En móvil el buscador ocupa toda la fila; uso y quitar bajan a la segunda. */}
              <div className="-order-1 col-span-2 sm:order-none sm:col-span-1">
                <InsumoSearch tipo="equipo" value={row.ref} onChange={(ref) => updateExtra(row.key, { ref })} placeholder="Buscar equipo" size="sm" />
              </div>
              <input className={controlClassSm} value={row.uso} maxLength={160} onChange={(event) => updateExtra(row.key, { uso: event.target.value })} placeholder="Uso (ej. Baño de agua · paso 18)" aria-label="Uso del equipo" />
              <IconButton label="Quitar equipo" size="sm" tone="danger" onClick={() => onExtras(extras.filter((entry) => entry.key !== row.key))}>
                <X size={13} weight="bold" />
              </IconButton>
            </div>
          ))}
        </div>
      ) : null}

      <div>
        <Button variant="ghost" size="sm" icon={<Plus size={14} weight="bold" />} onClick={() => onExtras([...extras, newEquipoExtra()])}>
          Agregar equipo
        </Button>
      </div>
    </div>
  );
}
