"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { toast } from "sonner";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, FormGrid, FormSection, Input, Select, Textarea } from "@/components/ui/Field";
import { DateInput } from "@/components/ui/DateInput";
import { Sheet } from "@/components/ui/Overlay";
import { API_BASE_URL, getJsonAuth, sendJsonAuth } from "@/lib/client/api";
import { isoDate } from "@/lib/client/format";
import { invalidate } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { EQUIPO_ESTADOS, MANTENIMIENTO_ESTADOS, MANTENIMIENTO_TIPOS } from "./meta";
import { useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { msg, type Problema } from "@/lib/client/mensajes";

function useActiveUsers(enabled: boolean) {
  const { token, can } = useSession();
  const [users, setUsers] = useState<ApiRecord[]>([]);
  useEffect(() => {
    if (!enabled || !token || !can("usuarios")) return;
    getJsonAuth(`${API_BASE_URL}/admin/usuarios`, token)
      .then((data) => setUsers(((data.items || []) as ApiRecord[]).filter((user) => !!user.activo)))
      .catch(() => setUsers([]));
  }, [enabled, token, can]);
  return users;
}

/* Fase 5: personas a quienes se puede otorgar la autorizacion del equipo (solo quien otorga autorizaciones). */
function usePersonasAutorizables(enabled: boolean) {
  const { token } = useSession();
  const [personas, setPersonas] = useState<ApiRecord[]>([]);
  useEffect(() => {
    if (!enabled || !token) return;
    getJsonAuth(`${API_BASE_URL}/autorizaciones/personas`, token)
      .then((data) => setPersonas((data.items || []) as ApiRecord[]))
      .catch(() => setPersonas([]));
  }, [enabled, token]);
  return personas;
}

export function EquipoSheet({ open, item, onClose }: { open: boolean; item: ApiRecord | null; onClose: () => void }) {
  const { token, can } = useSession();
  const users = useActiveUsers(open);
  const puedeAutorizar = !item?.id && (can("ensayos", "A") || can("calidad", "A"));
  const personas = usePersonasAutorizables(open && puedeAutorizar);
  const [autorizarA, setAutorizarA] = useState<number[]>([]);
  const [folioAp, setFolioAp] = useState("");
  const [form, setForm] = useState({
    nombre: String(item?.nombre || ""),
    serie: String(item?.numero_serie || ""),
    marca: String(item?.marca || ""),
    modelo: String(item?.modelo || ""),
    ubicacion: String(item?.ubicacion || ""),
    responsable: item?.id_responsable ? String(item.id_responsable) : "",
    calibracion: isoDate(item?.fecha_prox_calibracion),
    estado: String(item?.estado || "operativo"),
    claveBitacora: String(item?.clave_bitacora || ""),
  });
  const [submitting, setSubmitting] = useState(false);
  const editing = !!item?.id;
  const set = (key: keyof typeof form) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((prev) => ({ ...prev, [key]: event.target.value }));
  const v = useValidacion({
    titulo: editing ? "No se pudo guardar el equipo" : "No se pudo crear el equipo",
    reglas: () => (form.nombre.trim() ? [] : [{ campo: "e-nombre", mensaje: msg.indica("el nombre del equipo") }]),
  });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      nombre: form.nombre.trim(),
      marca: form.marca.trim() || null,
      modelo: form.modelo.trim() || null,
      numero_serie: form.serie.trim() || null,
      ubicacion: form.ubicacion.trim() || null,
      id_responsable: Number(form.responsable || 0) || null,
      fecha_prox_calibracion: form.calibracion || null,
      estado: form.estado || "operativo",
      clave_bitacora: form.claveBitacora.trim() || null,
    };
    if (!v.validar()) return;
    if (!can("equipos", editing ? "E" : "C", { objeto: "equipo" })) {
      v.avisar({ que: "No tienes permiso para guardar equipos.", hacer: "Pide a la administración que revise tus roles y permisos." });
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await sendJsonAuth("PUT", `${API_BASE_URL}/inventory/equipos/${item!.id}`, token, payload);
        toast.success("Equipo actualizado");
      } else {
        // "Autorizar a…": el servidor otorga la autorizacion FX-THF-AP del equipo en el mismo paso (pide la contraseña).
        const creado = await sendJsonAuth("POST", `${API_BASE_URL}/inventory/equipos`, token, puedeAutorizar && autorizarA.length ? { ...payload, autorizar_a: autorizarA, folio_fx_thf_ap: folioAp.trim() || null } : payload);
        const autorizados = ((creado?.autorizados || []) as unknown[]).length;
        toast.success(autorizados ? `Equipo creado y autorizado a ${autorizados} ${autorizados === 1 ? "persona" : "personas"}` : "Equipo creado");
        invalidate("autorizaciones");
      }
      invalidate("equipos", "dashboard");
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
      title={editing ? "Editar equipo" : "Nuevo equipo"}
      description="Identificación, ubicación y estado de calibración."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="equipo-form" loading={submitting}>
            {editing ? "Guardar cambios" : "Crear equipo"}
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
      <form id="equipo-form" onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <Field label="Nombre del equipo" htmlFor="e-nombre" required>
          <Input id="e-nombre" maxLength={150} value={form.nombre} onChange={set("nombre")} autoFocus={!editing} />
        </Field>
        <FormGrid>
          <Field label="Marca" htmlFor="e-marca">
            <Input id="e-marca" maxLength={100} value={form.marca} onChange={set("marca")} />
          </Field>
          <Field label="Modelo" htmlFor="e-modelo">
            <Input id="e-modelo" maxLength={100} value={form.modelo} onChange={set("modelo")} />
          </Field>
          <Field label="Número de serie" htmlFor="e-serie">
            <Input id="e-serie" maxLength={100} value={form.serie} onChange={set("serie")} mono />
          </Field>
          <Field label="Ubicación" htmlFor="e-ubicacion">
            <Input id="e-ubicacion" maxLength={150} value={form.ubicacion} onChange={set("ubicacion")} />
          </Field>
          <Field label="Responsable" htmlFor="e-responsable">
            <Select id="e-responsable" value={form.responsable} onChange={set("responsable")}>
              <option value="">Sin responsable</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.nombre}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Próxima calibración" htmlFor="e-calibracion">
            <DateInput id="e-calibracion" value={form.calibracion} onChange={(value) => setForm((prev) => ({ ...prev, calibracion: value }))} />
          </Field>
          <Field label="Estado" htmlFor="e-estado" required>
            <Select id="e-estado" value={form.estado} onChange={set("estado")}>
              {EQUIPO_ESTADOS.map((estado) => (
                // "En mantenimiento" lo pone y lo quita Mantenimiento; a mano solo los demás.
                <option key={estado.value} value={estado.value} disabled={estado.value === "mantenimiento" && form.estado !== "mantenimiento"}>
                  {estado.label}
                  {estado.value === "mantenimiento" ? " (lo define Mantenimiento)" : ""}
                </option>
              ))}
            </Select>
          </Field>
        </FormGrid>
        <Field label="Clave de bitácora" htmlFor="e-bitacora" hint="Bitácora de uso del equipo (FX-TCB-…). Se copia a los formatos de extracción para anotar el folio.">
          <Input id="e-bitacora" maxLength={60} value={form.claveBitacora} onChange={set("claveBitacora")} mono placeholder="FX-TCB-BA1-27/1" />
        </Field>
        {puedeAutorizar ? (
          <FormSection title="Autorizar a…" description="Otorga en el mismo paso la autorización FX-THF-AP de este equipo a las personas elegidas. Queda en la bitácora y se pide tu contraseña.">
            <div id="e-autorizar-a" className="flex max-h-48 flex-col gap-2 overflow-y-auto" role="group" aria-label="Autorizar a">
              {personas.length ? (
                personas.map((persona) => (
                  <Checkbox
                    key={String(persona.id)}
                    id={`e-autorizar-${persona.id}`}
                    label={String(persona.nombre)}
                    description={String(persona.email)}
                    checked={autorizarA.includes(Number(persona.id))}
                    onChange={(event) => setAutorizarA((prev) => (event.target.checked ? [...prev, Number(persona.id)] : prev.filter((id) => id !== Number(persona.id))))}
                  />
                ))
              ) : (
                <p className="text-[13px] text-ink-3">No hay otras cuentas activas.</p>
              )}
            </div>
            {autorizarA.length ? (
              <Field label="Folio FX-THF-AP" htmlFor="e-folio-ap" hint="Opcional: folio del formato en papel.">
                <Input id="e-folio-ap" maxLength={80} value={folioAp} onChange={(event) => setFolioAp(event.target.value)} mono placeholder="FX-THF-AP-…" />
              </Field>
            ) : null}
          </FormSection>
        ) : null}
      </form>
      </ValidacionAmbito>
    </Sheet>
  );
}

export function MantenimientoSheet({ open, item, onClose }: { open: boolean; item: ApiRecord | null; onClose: () => void }) {
  const { token, can } = useSession();
  const users = useActiveUsers(open);
  const [equipos, setEquipos] = useState<ApiRecord[]>([]);
  const [form, setForm] = useState({
    equipo: item?.id_equipo ? String(item.id_equipo) : "",
    tipo: String(item?.tipo || "preventivo"),
    fechaProgramada: isoDate(item?.fecha_programada),
    fechaRealizado: isoDate(item?.fecha_realizado),
    tecnico: String(item?.tecnico_proveedor || ""),
    responsable: item?.id_responsable ? String(item.id_responsable) : "",
    estado: String(item?.estado || "programado"),
    observaciones: String(item?.observaciones || ""),
    proximaCalibracion: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const editing = !!item?.id;
  const v = useValidacion({
    titulo: editing ? "No se pudo guardar el mantenimiento" : "No se pudo programar el mantenimiento",
    reglas: () => {
      const out: Problema[] = [];
      if (!Number(form.equipo || 0)) out.push({ campo: "m-equipo", mensaje: msg.elige("el equipo") });
      if (!form.fechaProgramada) out.push({ campo: "m-fecha", mensaje: msg.indica("la fecha programada") });
      if (form.estado === "completado" && !form.fechaRealizado) out.push({ campo: "m-realizado", mensaje: "Indica la fecha en que se realizó para marcarlo como completado" });
      return out;
    },
  });

  useEffect(() => {
    if (!open || !token) return;
    getJsonAuth(`${API_BASE_URL}/inventory/equipos`, token)
      .then((data) => setEquipos((data.items || []) as ApiRecord[]))
      .catch(() => setEquipos([]));
  }, [open, token]);

  const set = (key: keyof typeof form) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      id_equipo: Number(form.equipo || 0),
      tipo: form.tipo || "preventivo",
      fecha_programada: form.fechaProgramada || null,
      fecha_realizado: form.fechaRealizado || null,
      tecnico_proveedor: form.tecnico.trim() || null,
      id_responsable: Number(form.responsable || 0) || null,
      estado: form.estado || "programado",
      observaciones: form.observaciones.trim() || null,
      proxima_calibracion: form.tipo === "calibracion" && form.estado === "completado" ? form.proximaCalibracion || null : null,
    };
    if (!v.validar()) return;
    if (!can("equipos", editing ? "E" : "C", { objeto: "mantenimiento" })) {
      v.avisar({ que: "No tienes permiso para guardar mantenimientos.", hacer: "Pide a la administración que revise tus roles y permisos." });
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await sendJsonAuth("PUT", `${API_BASE_URL}/inventory/mantenimientos/${item!.id}`, token, payload);
        toast.success("Mantenimiento actualizado");
      } else {
        await sendJsonAuth("POST", `${API_BASE_URL}/inventory/mantenimientos`, token, payload);
        toast.success("Mantenimiento programado");
      }
      invalidate("mantenimientos", "documentos", "dashboard", "equipos");
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
      title={editing ? "Editar mantenimiento" : "Programar mantenimiento"}
      description="Fechas programadas de mantenimiento y calibración."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="mantenimiento-form" loading={submitting}>
            {editing ? "Guardar cambios" : "Programar"}
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
      <form id="mantenimiento-form" onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <Field label="Equipo" htmlFor="m-equipo" required>
          <Select id="m-equipo" value={form.equipo} onChange={set("equipo")} autoFocus={!editing}>
            <option value="">Seleccionar equipo</option>
            {equipos.map((equipo) => (
              <option key={equipo.id} value={equipo.id}>
                {[equipo.nombre, equipo.marca, equipo.modelo].filter(Boolean).join(" · ") || `Equipo ${equipo.id}`}
              </option>
            ))}
          </Select>
        </Field>
        <FormGrid>
          <Field label="Tipo" htmlFor="m-tipo" required>
            <Select id="m-tipo" value={form.tipo} onChange={set("tipo")}>
              {MANTENIMIENTO_TIPOS.map((tipo) => (
                <option key={tipo.value} value={tipo.value}>
                  {tipo.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Estado" htmlFor="m-estado" required>
            <Select id="m-estado" value={form.estado} onChange={set("estado")}>
              {MANTENIMIENTO_ESTADOS.map((estado) => (
                <option key={estado.value} value={estado.value}>
                  {estado.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fecha programada" htmlFor="m-fecha" required>
            <DateInput id="m-fecha" value={form.fechaProgramada} onChange={(value) => setForm((prev) => ({ ...prev, fechaProgramada: value }))} />
          </Field>
          <Field label="Fecha realizado" htmlFor="m-realizado" required={form.estado === "completado"}>
            <DateInput id="m-realizado" value={form.fechaRealizado} onChange={(value) => setForm((prev) => ({ ...prev, fechaRealizado: value }))} />
          </Field>
          {form.tipo === "calibracion" && form.estado === "completado" ? (
            <Field label="Próxima calibración" htmlFor="m-proxima" hint="Se anota en la ficha del equipo." className="sm:col-span-2">
              <DateInput id="m-proxima" value={form.proximaCalibracion} onChange={(value) => setForm((prev) => ({ ...prev, proximaCalibracion: value }))} />
            </Field>
          ) : null}
          <Field label="Técnico o proveedor" htmlFor="m-tecnico">
            <Input id="m-tecnico" maxLength={150} value={form.tecnico} onChange={set("tecnico")} />
          </Field>
          <Field label="Responsable interno" htmlFor="m-responsable">
            <Select id="m-responsable" value={form.responsable} onChange={set("responsable")}>
              <option value="">Sin responsable</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.nombre}
                </option>
              ))}
            </Select>
          </Field>
        </FormGrid>
        <Field label="Observaciones" htmlFor="m-obs">
          <Textarea id="m-obs" rows={3} value={form.observaciones} onChange={set("observaciones")} />
        </Field>
        <p className="rounded-[10px] bg-surface-2 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-2 ring-1 ring-line">
          Mientras el mantenimiento esté <span className="font-medium">programado, en proceso o vencido</span>, el equipo se muestra “En mantenimiento” en la pestaña Equipos (con el detalle del pendiente debajo). Al marcarlo <span className="font-medium">completado</span> desaparece de Mantenimiento y el equipo vuelve a “Operativo”.
        </p>
      </form>
      </ValidacionAmbito>
    </Sheet>
  );
}
