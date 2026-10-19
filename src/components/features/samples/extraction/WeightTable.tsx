"use client";

import { Plus, X } from "@phosphor-icons/react";
import { IconButton, Button } from "@/components/ui/Button";
import { controlClassSm } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/Primitives";
import { cn } from "@/components/ui/cn";
import { FormTable, formTd, formTh } from "../FormLayout";
import type { WeightColumnPair, WeightRow } from "./types";

let rowKey = 1;
export const newWeightRow = (partial: Partial<WeightRow> = {}): WeightRow => ({ key: rowKey++, id: "", organismo: "", sitio: "", esBlanco: false, replica: "", values: {}, ...partial });
export const blancoRow = (): WeightRow => newWeightRow({ id: "Blanco", esBlanco: true, replica: "BlancoR1" });

/*
 * Tabla de registro por muestra: una fila por muestra (mas el blanco), con
 * el valor de la muestra y el de su replica para cada columna. El mismo
 * componente dibuja pesos, matraces y pesos pre/post calentamiento.
 */
export function WeightTable({ rows, columns, compact = false, linked, onChange }: { rows: WeightRow[] | null; columns: WeightColumnPair[]; compact?: boolean; linked: boolean; onChange: (rows: WeightRow[]) => void }) {
  const list = rows || [];
  const update = (key: number, changes: Partial<WeightRow>) => onChange(list.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  // Al capturar el ID de una fila agregada a mano, la replica se deriva de el (salvo que ya se haya editado).
  const updateId = (row: WeightRow, id: string) => {
    const auto = !row.replica || row.replica === `${row.id}_R1` || /^Muestra \d+_R1$/.test(row.replica);
    update(row.key, { id, replica: auto ? (id.trim() ? `${id.trim()}_R1` : row.replica) : row.replica });
  };
  const setValue = (key: number, column: string, value: string) => onChange(list.map((row) => (row.key === key ? { ...row, values: { ...row.values, [column]: value } } : row)));
  const add = () => {
    const base = list.length ? list : [blancoRow()];
    const index = base.filter((row) => !row.esBlanco).length + 1;
    onChange([...base, newWeightRow({ id: "", replica: `Muestra ${index}_R1`, organismo: "", sitio: "" })]);
  };

  if (!list.length) {
    return (
      <EmptyState
        compact
        title={linked ? "Sin muestras seleccionadas" : "Vincula un procesamiento o agrega las muestras"}
        description={linked ? "El procesamiento no tiene muestras marcadas para trabajar. Puedes agregarlas a mano." : "Las muestras se cargan desde el folio de procesamiento; también puedes capturarlas directamente."}
        action={
          !compact ? (
            <Button variant="secondary" size="sm" icon={<Plus size={14} weight="bold" />} onClick={add}>
              Agregar muestra
            </Button>
          ) : undefined
        }
      />
    );
  }

  const inputClass = controlClassSm;
  return (
    <div className="flex flex-col gap-3">
      <FormTable minWidth={compact ? 480 : 640}>
          <thead>
            <tr>
              <th className={formTh}>ID muestra</th>
              {!compact ? <th className={formTh}>Organismo</th> : null}
              {!compact ? <th className={formTh}>Sitio</th> : null}
              {columns.map((column) => (
                <th key={column.muestra} className={formTh}>
                  {column.label}
                </th>
              ))}
              <th className={formTh}>Réplica</th>
              {columns.map((column) => (
                <th key={column.replica} className={formTh}>
                  {column.label} réplica
                </th>
              ))}
              {!compact ? <th className={cn(formTh, "w-10")} /> : null}
            </tr>
          </thead>
          <tbody>
            {list.map((row) => (
              <tr key={row.key} className={cn(row.esBlanco && "[&>td]:bg-surface-2/50")}>
                <td className={formTd}>
                  {row.esBlanco || compact ? (
                    <span className="code px-1 font-medium">{row.id || "-"}</span>
                  ) : (
                    <input className={cn(inputClass, "font-mono text-xs")} value={row.id} onChange={(event) => updateId(row, event.target.value)} placeholder="A25-001" aria-label="ID de la muestra" />
                  )}
                </td>
                {!compact ? (
                  <td className={formTd}>
                    {row.esBlanco ? (
                      <span className="text-ink-3">Agua desionizada</span>
                    ) : (
                      <input className={inputClass} value={row.organismo} onChange={(event) => update(row.key, { organismo: event.target.value })} aria-label={`Organismo de ${row.id || "la muestra"}`} />
                    )}
                  </td>
                ) : null}
                {!compact ? (
                  <td className={formTd}>{row.esBlanco ? <span className="text-ink-4">-</span> : <input className={inputClass} value={row.sitio} onChange={(event) => update(row.key, { sitio: event.target.value })} aria-label={`Sitio de ${row.id || "la muestra"}`} />}</td>
                ) : null}
                {columns.map((column) => (
                  <td key={column.muestra} className={formTd}>
                    <input
                      type={column.kind === "number" ? "number" : "text"}
                      min={column.kind === "number" ? "0" : undefined}
                      step={column.kind === "number" ? "0.0001" : undefined}
                      inputMode={column.kind === "number" ? "decimal" : "text"}
                      placeholder={column.placeholder}
                      className={cn(inputClass, column.kind === "number" && "tnum")}
                      value={row.values[column.muestra] ?? ""}
                      onChange={(event) => setValue(row.key, column.muestra, event.target.value)}
                      aria-label={`${column.label} de ${row.id || "la muestra"}`}
                    />
                  </td>
                ))}
                <td className={formTd}>
                  {compact ? <span className="code px-1 text-xs text-ink-2">{row.replica || "-"}</span> : <input className={cn(inputClass, "font-mono text-xs")} value={row.replica} onChange={(event) => update(row.key, { replica: event.target.value })} aria-label={`Réplica de ${row.id || "la muestra"}`} />}
                </td>
                {columns.map((column) => (
                  <td key={column.replica} className={formTd}>
                    <input
                      type={column.kind === "number" ? "number" : "text"}
                      min={column.kind === "number" ? "0" : undefined}
                      step={column.kind === "number" ? "0.0001" : undefined}
                      inputMode={column.kind === "number" ? "decimal" : "text"}
                      placeholder={column.placeholder}
                      className={cn(inputClass, column.kind === "number" && "tnum")}
                      value={row.values[column.replica] ?? ""}
                      onChange={(event) => setValue(row.key, column.replica, event.target.value)}
                      aria-label={`${column.label} de la réplica de ${row.id || "la muestra"}`}
                    />
                  </td>
                ))}
                {!compact ? (
                  <td className={cn(formTd, "text-right")}>
                    {!row.esBlanco ? (
                      <IconButton label={`Quitar ${row.id || "muestra"}`} size="sm" tone="danger" onClick={() => onChange(list.filter((entry) => entry.key !== row.key))}>
                        <X size={13} weight="bold" />
                      </IconButton>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
      </FormTable>
      {!compact ? (
        <div>
          <Button variant="ghost" size="sm" icon={<Plus size={14} weight="bold" />} onClick={add}>
            Agregar muestra
          </Button>
        </div>
      ) : null}
    </div>
  );
}
