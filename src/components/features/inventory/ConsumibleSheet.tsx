"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { toast } from "sonner";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/Field";
import { DateInput } from "@/components/ui/DateInput";
import { Sheet } from "@/components/ui/Overlay";
import { API_BASE_URL, sendJsonAuth } from "@/lib/client/api";
import { CONTENEDORES_CONSUMIBLE } from "@/lib/client/constants";
import { invalidate } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { msg } from "@/lib/client/mensajes";

export function ConsumibleSheet({ open, item, onClose }: { open: boolean; item: ApiRecord | null; onClose: () => void }) {
  const { token, can } = useSession();
  const texto = (valor: unknown) => (valor === null || valor === undefined ? "" : String(valor));
  const [form, setForm] = useState({
    idInterno: texto(item?.id_interno),
    producto: texto(item?.producto),
    marca: texto(item?.marca),
    proveedor: texto(item?.proveedor),
    catalogo: texto(item?.catalogo_parte_cas),
    lote: texto(item?.lote),
    fechaIngreso: item?.fecha_ingreso ? String(item.fecha_ingreso).slice(0, 10) : "",
    tamano: texto(item?.tamano_capacidad),
    contenedor: texto(item?.contenedor),
    piezas: texto(item?.piezas),
    cantidadPieza: texto(item?.cantidad_por_pieza),
    localizacion: texto(item?.localizacion),
    stockMinimo: texto(item?.stock_minimo),
    observaciones: texto(item?.observaciones),
  });
  const [submitting, setSubmitting] = useState(false);
  const editing = !!item?.id;
  const set = (key: keyof typeof form) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((prev) => ({ ...prev, [key]: event.target.value }));
  const piezas = Number(form.piezas);
  const porPieza = Number(form.cantidadPieza);
  const contenedores = form.contenedor && !CONTENEDORES_CONSUMIBLE.includes(form.contenedor) ? [...CONTENEDORES_CONSUMIBLE, form.contenedor] : CONTENEDORES_CONSUMIBLE;
  const v = useValidacion({
    titulo: editing ? "No se pudo guardar el consumible" : "No se pudo crear el consumible",
    reglas: () => {
      const out = [];
      if (!form.producto.trim()) out.push({ campo: "c-producto", mensaje: msg.indica("el nombre del producto") });
      for (const [campo, valor, etiqueta] of [["c-piezas", form.piezas, "Piezas"], ["c-cantidad", form.cantidadPieza, "Cantidad por pieza"], ["c-minimo", form.stockMinimo, "Stock mínimo"]] as const) {
        if (valor.trim() && (Number.isNaN(Number(valor)) || Number(valor) < 0)) out.push({ campo, mensaje: `«${etiqueta}» debe ser un número mayor o igual a cero` });
      }
      return out;
    },
  });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      id_interno: form.idInterno.trim() || null,
      producto: form.producto.trim(),
      marca: form.marca.trim() || null,
      proveedor: form.proveedor.trim() || null,
      catalogo_parte_cas: form.catalogo.trim() || null,
      lote: form.lote.trim() || null,
      fecha_ingreso: form.fechaIngreso || null,
      tamano_capacidad: form.tamano.trim() || null,
      contenedor: form.contenedor.trim() || null,
      piezas: form.piezas.trim() || null,
      cantidad_por_pieza: form.cantidadPieza.trim() || null,
      localizacion: form.localizacion.trim() || null,
      stock_minimo: form.stockMinimo.trim() || null,
      observaciones: form.observaciones.trim() || null,
    };
    if (!v.validar()) return;
    if (!can("inventario", editing ? "E" : "C", { objeto: "catalogo_inventario" })) {
      v.avisar({ que: "No tienes permiso para guardar consumibles.", hacer: "Pide a la administración que revise tus roles y permisos." });
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await sendJsonAuth("PUT", `${API_BASE_URL}/consumables/${item!.id}`, token, payload);
        toast.success("Consumible actualizado");
      } else {
        await sendJsonAuth("POST", `${API_BASE_URL}/consumables`, token, payload);
        toast.success("Consumible creado");
      }
      invalidate("consumibles", "dashboard", "movimientos");
      onClose();
    } catch (err) {
      v.errorServidor(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(value) => !value && onClose()}
      title={editing ? "Editar consumible" : "Nuevo consumible"}
      description={editing ? `Registro #${item!.id}` : "Material de uso en laboratorio."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="consumible-form" loading={submitting}>
            {editing ? "Guardar cambios" : "Crear consumible"}
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
      <form id="consumible-form" onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <Field label="Producto" htmlFor="c-producto" required>
          <Input id="c-producto" maxLength={150} value={form.producto} onChange={set("producto")} autoFocus={!editing} />
        </Field>
        <FormGrid>
          <Field label="ID interno" htmlFor="c-id-interno">
            <Input id="c-id-interno" maxLength={100} value={form.idInterno} onChange={set("idInterno")} />
          </Field>
          <Field label="Marca" htmlFor="c-marca">
            <Input id="c-marca" maxLength={100} value={form.marca} onChange={set("marca")} />
          </Field>
          <Field label="Proveedor" htmlFor="c-proveedor">
            <Input id="c-proveedor" maxLength={150} value={form.proveedor} onChange={set("proveedor")} />
          </Field>
          <Field label="Número de catálogo / parte" htmlFor="c-catalogo">
            <Input id="c-catalogo" maxLength={150} value={form.catalogo} onChange={set("catalogo")} mono />
          </Field>
          <Field label="Lote" htmlFor="c-lote">
            <Input id="c-lote" maxLength={100} value={form.lote} onChange={set("lote")} />
          </Field>
          <Field label="Fecha de ingreso" htmlFor="c-fecha" hint="Opcional; déjala vacía si no se conoce.">
            <DateInput id="c-fecha" value={form.fechaIngreso} onChange={(value) => setForm((prev) => ({ ...prev, fechaIngreso: value }))} />
          </Field>
          <Field label="Tamaño / capacidad" htmlFor="c-tamano" hint="Texto libre: «2 mL», «47mm, 0.2um», «Grande».">
            <Input id="c-tamano" maxLength={100} value={form.tamano} onChange={set("tamano")} />
          </Field>
          <Field label="Contenedor" htmlFor="c-contenedor">
            <Select id="c-contenedor" value={form.contenedor} onChange={set("contenedor")}>
              <option value="">Seleccionar</option>
              {contenedores.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Piezas" htmlFor="c-piezas" hint="Dato del empaque; acepta decimales (por ejemplo, 2.5 cajas). La existencia se maneja en unidades con movimientos.">
            <Input id="c-piezas" type="number" min="0" step="any" inputMode="decimal" value={form.piezas} onChange={set("piezas")} />
          </Field>
          <Field label="Cantidad por pieza" htmlFor="c-cantidad">
            <Input id="c-cantidad" type="number" min="0" step="any" inputMode="decimal" value={form.cantidadPieza} onChange={set("cantidadPieza")} />
          </Field>
          <Field label="Localización" htmlFor="c-localizacion">
            <Input id="c-localizacion" maxLength={150} value={form.localizacion} onChange={set("localizacion")} />
          </Field>
          <Field label="Stock mínimo" htmlFor="c-minimo" hint="Opcional. Opcional, en unidades. Al llegar a esta cantidad aparece el aviso de stock bajo (sin mínimo, con 5 unidades o menos).">
            <Input id="c-minimo" type="number" min="0" step="any" inputMode="decimal" value={form.stockMinimo} onChange={set("stockMinimo")} />
          </Field>
        </FormGrid>
        <p className="text-[13.5px] text-ink-2">
          Total: <b className="tnum text-ink">{form.piezas && Number.isFinite(piezas) ? `${(piezas * (form.cantidadPieza && Number.isFinite(porPieza) && porPieza > 0 ? porPieza : 1)).toLocaleString("es-MX")} unidades` : "—"}</b> (piezas × cantidad por pieza). {editing ? "La existencia actual cambia solo con movimientos." : "Es la existencia inicial, en unidades."}
        </p>
        <Field label="Observaciones" htmlFor="c-observaciones">
          <Textarea id="c-observaciones" rows={3} maxLength={1000} value={form.observaciones} onChange={set("observaciones")} />
        </Field>
      </form>
      </ValidacionAmbito>
    </Sheet>
  );
}
