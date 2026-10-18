"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { DateInput } from "@/components/ui/DateInput";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Overlay";
import { API_BASE_URL, sendJsonAuth } from "@/lib/client/api";
import { parseNumberOrNull } from "@/lib/client/format";
import { invalidate } from "@/lib/client/store";
import { hoyLocal } from "@/lib/shared/fechas";
import { useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { msg } from "@/lib/client/mensajes";

export interface StockRefillTarget {
  type: "reactivo" | "consumible";
  id: number;
  name: string;
  unit?: string;
}

const TIPOS = [
  { value: "entrada", label: "Entrada", hint: "Suma a la existencia (compra, reposición)." },
  { value: "salida", label: "Salida", hint: "Resta de la existencia (traslado, merma)." },
  { value: "consumo", label: "Consumo", hint: "Resta lo usado en el trabajo del laboratorio." },
  { value: "ajuste", label: "Ajuste por conteo físico", hint: "Captura lo que contaste; se registra la diferencia." },
];
const VINCULOS = [
  { value: "", label: "Sin vínculo" },
  { value: "recepcion", label: "Recepción" },
  { value: "procesamiento", label: "Procesamiento" },
  { value: "extraccion", label: "Extracción" },
  { value: "analisis", label: "Análisis" },
];

/* Movimiento manual de un reactivo o consumible: entrada, salida, consumo o ajuste por conteo físico. */
export function StockRefillSheet({ open, target, onClose }: { open: boolean; target: StockRefillTarget | null; onClose: () => void }) {
  const { token } = useSession();
  const [tipo, setTipo] = useState("entrada");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [fecha, setFecha] = useState(() => hoyLocal());
  const [vinculo, setVinculo] = useState("");
  const [folio, setFolio] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isReactivo = target?.type === "reactivo";
  const ajuste = tipo === "ajuste";
  const unidad = isReactivo ? target?.unit || "" : "unidades";
  const v = useValidacion({
    titulo: "No se pudo registrar el movimiento",
    reglas: () => {
      const out = [];
      const value = parseNumberOrNull(amount);
      if (value === null || (ajuste ? value < 0 : value <= 0)) out.push({ campo: "refill-amount", mensaje: amount.trim() ? (ajuste ? "La cantidad contada no puede ser negativa" : msg.positivo("La cantidad")) : msg.indica(ajuste ? "la cantidad contada" : "la cantidad") });
      if (ajuste && !reason.trim()) out.push({ campo: "refill-reason", mensaje: msg.indica("el motivo del ajuste") });
      if (!fecha) out.push({ campo: "refill-fecha", mensaje: msg.indica("la fecha del movimiento") });
      else if (fecha > hoyLocal()) out.push({ campo: "refill-fecha", mensaje: "La fecha del movimiento no puede ser futura" });
      if (vinculo && !folio.trim()) out.push({ campo: "refill-folio", mensaje: msg.indica("el folio de la muestra o del análisis") });
      return out;
    },
  });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!target) return;
    if (!v.validar()) return;
    const value = parseNumberOrNull(amount) as number;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = { tipo, cantidad: value, motivo: reason.trim() || undefined, fecha_movimiento: fecha };
      if (vinculo) {
        payload.vinculo_tipo = vinculo;
        payload.vinculo_folio = Number(folio);
      }
      const url = isReactivo ? `${API_BASE_URL}/inventory/reactivos/${target.id}/refill` : `${API_BASE_URL}/consumables/${target.id}/refill`;
      await sendJsonAuth("POST", url, token, payload);
      toast.success(ajuste ? "Existencia ajustada" : "Movimiento registrado");
      invalidate(isReactivo ? "reactivos" : "consumibles", "movimientos", "dashboard");
      onClose();
    } catch (err) {
      v.errorServidor(err, { motivo: "refill-reason" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(value) => !value && onClose()}
      title="Registrar movimiento"
      description={target?.name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="stock-refill-form" loading={submitting}>
            Registrar movimiento
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
      <form id="stock-refill-form" onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <Field label="Tipo de movimiento" htmlFor="refill-tipo" hint={TIPOS.find((x) => x.value === tipo)?.hint}>
          <Select id="refill-tipo" value={tipo} onChange={(event) => setTipo(event.target.value)}>
            {TIPOS.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`${ajuste ? "Cantidad contada" : "Cantidad"}${unidad ? ` (${unidad})` : ""}`} htmlFor="refill-amount" required>
          <Input id="refill-amount" type="number" inputMode="decimal" min="0" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Ejemplo: 2.5" autoFocus />
        </Field>
        <Field label="Fecha del movimiento" htmlFor="refill-fecha" hint="Hoy por defecto. Cámbiala si el movimiento ocurrió antes de capturarlo; no puede ser futura.">
          <DateInput id="refill-fecha" value={fecha} onChange={setFecha} max={hoyLocal()} />
        </Field>
        <Field label={ajuste ? "Motivo" : "Motivo u observación"} htmlFor="refill-reason" required={ajuste} hint="Queda registrado en el historial de movimientos.">
          <Textarea id="refill-reason" rows={2} maxLength={180} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <Field label="Vínculo (opcional)" htmlFor="refill-vinculo" hint="Para relacionar el movimiento con una muestra o análisis.">
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <Select id="refill-vinculo" value={vinculo} onChange={(event) => setVinculo(event.target.value)}>
              {VINCULOS.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </Select>
            <Input id="refill-folio" type="number" min="1" step="1" inputMode="numeric" placeholder="Folio" disabled={!vinculo} value={folio} onChange={(event) => setFolio(event.target.value)} aria-label="Folio del registro vinculado" />
          </div>
        </Field>
      </form>
      </ValidacionAmbito>
    </Sheet>
  );
}
