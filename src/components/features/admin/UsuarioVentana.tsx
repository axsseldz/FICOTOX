"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Buildings, CalendarBlank, Certificate, ClockCounterClockwise, Eye, Hourglass, IdentificationBadge, Key, LockOpen, Plus, Prohibit, ShieldCheck, UserCircleCheck } from "@phosphor-icons/react";
import { AutorizacionesUsuario } from "@/components/features/admin/AutorizacionesPanel";
import { EtiquetaRol, IconoRol } from "@/components/features/admin/iconos";
import { Callout } from "@/components/features/samples/FormLayout";
import { SolicitudBannerDe } from "@/components/features/solicitudes/Solicitudes";
import { CampoIdentidad } from "@/components/session/Reautenticar";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { DateInput } from "@/components/ui/DateInput";
import { Field, FormGrid, Select, Textarea } from "@/components/ui/Field";
import { Dialog, usePrompt } from "@/components/ui/Overlay";
import { PestanasDeslizantes } from "@/components/ui/PestanasDeslizantes";
import { Avatar, Badge, Skeleton, type Tone, Correo } from "@/components/ui/Primitives";
import { cn } from "@/components/ui/cn";
import { VentanaCentrada, VentanaTitulo } from "@/components/ui/VentanaCentrada";
import { useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { API_BASE_URL, armarReauth, getJsonAuth, sendJsonAuth } from "@/lib/client/api";
import { msg, type Problema } from "@/lib/client/mensajes";
import { invalidate } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { diasEntre, formatearFecha, formatearFechaCorta, formatearFechaHora, formatearHora, hoyLocal } from "@/lib/shared/fechas";
import { ColumnasVentana, DatoLateral, DatosRapidos, TarjetaLateral, VentanaEncabezado } from "@/components/ui/Ventana";
import { haceCuantoCorto } from "@/lib/client/tiempo";
import { descripcionDeRol } from "@/lib/shared/roles-descripcion";

/*
 * Ventana de una persona (Administración › Usuarios), con la ventana centrada
 * compartida: figura animada, nombre, correo, estado, roles y cargo; una franja
 * de 4 datos rapidos; y tres pestañas (General, Roles, Autorizaciones) con
 * indicador deslizante. Las acciones son las de siempre (motivo,
 * reautenticacion, segundo usuario, guardas).
 */

/* Estado de la cuenta en una palabra (el mismo en la lista y en la ventana). */
export function estadoCuenta(item: ApiRecord): { label: string; tone: Tone } {
  if (!item.activo) return { label: "De baja", tone: "neutral" };
  if (item.bloqueado_hasta) return { label: "Bloqueado", tone: "danger" };
  if (item.cuenta_vigente === false) return { label: "Acceso vencido", tone: "warning" };
  if (String(item.tipo_cuenta || "permanente") === "temporal") return { label: "Temporal", tone: "brand" };
  return { label: "Activo", tone: "success" };
}

/* "quedan 89 días", "vence hoy", "venció hace 3 días". */
function quedan(hasta: unknown): string | null {
  const dias = diasEntre(hoyLocal(), hasta);
  if (dias === null) return null;
  if (dias > 1) return `quedan ${dias} días`;
  if (dias === 1) return "queda 1 día";
  if (dias === 0) return "vence hoy";
  return dias === -1 ? "venció ayer" : `venció hace ${-dias} días`;
}

/* Barra de tiempo: cuanto de la vigencia ya paso (y cuanto queda). */
function BarraVigencia({ desde, hasta, className }: { desde: unknown; hasta: unknown; className?: string }) {
  const total = diasEntre(desde, hasta);
  const pasado = diasEntre(desde, hoyLocal());
  if (total === null || pasado === null || total <= 0) return null;
  const pct = Math.min(100, Math.max(0, (pasado / total) * 100));
  const restante = diasEntre(hoyLocal(), hasta) ?? 0;
  const tono = restante < 0 ? "bg-ink-4" : restante <= 30 ? "bg-warning" : "bg-brand";
  return (
    <span className={cn("block h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)} role="img" aria-label={quedan(hasta) || undefined}>
      <span className={cn("block h-full w-full rounded-full transition-[translate] duration-700 ease-[var(--ease-spring)]", tono)} style={{ translate: `${pct - 100}% 0` }} />
    </span>
  );
}

const ESTADO_ASIGNACION: Record<string, { label: string; tone: Tone }> = {
  vigente: { label: "Vigente", tone: "success" },
  futuro: { label: "Por comenzar", tone: "brand" },
  vencido: { label: "Terminado", tone: "neutral" },
  revocado: { label: "Revocado", tone: "danger" },
};

type Pestana = "roles" | "autorizaciones";

export function UsuarioVentana({ usuarios, todos, indice, onIndice, onCerrar, onDesbloquear, onAbrirPersona }: { usuarios: ApiRecord[]; todos: ApiRecord[]; indice: number | null; onIndice: (indice: number) => void; onCerrar: () => void; onDesbloquear: (item: ApiRecord) => Promise<void>; onAbrirPersona: (id: number) => void }) {
  const item = indice !== null ? usuarios[indice] : undefined;
  const mover = (paso: number) => {
    if (indice === null) return;
    const siguiente = indice + paso;
    if (siguiente >= 0 && siguiente < usuarios.length) onIndice(siguiente);
  };
  return (
    <VentanaCentrada amplia abierta={!!item} onCerrar={onCerrar} onMover={mover} puedeAnterior={indice !== null && indice > 0} puedeSiguiente={indice !== null && indice < usuarios.length - 1} etiquetaAnterior="Persona anterior" etiquetaSiguiente="Persona siguiente">
      {item ? <FichaUsuario key={String(item.id)} base={item} todos={todos} onDesbloquear={onDesbloquear} onAbrirPersona={onAbrirPersona} /> : <VentanaTitulo className="sr-only">Usuario</VentanaTitulo>}
    </VentanaCentrada>
  );
}

function FichaUsuario({ base, todos, onDesbloquear, onAbrirPersona }: { base: ApiRecord; todos: ApiRecord[]; onDesbloquear: (item: ApiRecord) => Promise<void>; onAbrirPersona: (id: number) => void }) {
  const { token, can, user: me } = useSession();
  const prompt = usePrompt();
  const [pestana, setPestana] = useState<Pestana>("roles");
  const [detalle, setDetalle] = useState<ApiRecord | null>(null);
  const [asignar, setAsignar] = useState(false);
  const canAdmin = can("usuarios", "G");
  const esPropia = Number(me?.id) === Number(base.id);
  const item = detalle || base;
  const estado = estadoCuenta(item);
  const roles = ((item.roles || []) as ApiRecord[]).filter((r) => r.nombre);
  const supervisor = item.supervisor_id ? todos.find((u) => Number(u.id) === Number(item.supervisor_id)) : undefined;
  const temporal = String(item.tipo_cuenta || "permanente") === "temporal";

  const cargar = useCallback(async () => {
    try {
      const data = await getJsonAuth(`${API_BASE_URL}/admin/usuarios/${base.id}`, token);
      setDetalle({ ...base, ...((data.item || {}) as ApiRecord) });
    } catch {
      setDetalle(base);
    }
  }, [base, token]);
  useEffect(() => {
    void Promise.resolve().then(cargar);
  }, [cargar]);

  const asignaciones = useMemo(() => {
    const peso: Record<string, number> = { vigente: 0, futuro: 1, vencido: 2, revocado: 3 };
    return [...(((detalle?.asignaciones as ApiRecord[] | undefined) || []) as ApiRecord[])].sort((a, b) => (peso[String(a.estado)] ?? 9) - (peso[String(b.estado)] ?? 9));
  }, [detalle]);
  const actuales = asignaciones.filter((a) => a.estado === "vigente" || a.estado === "futuro");
  const anteriores = asignaciones.filter((a) => a.estado !== "vigente" && a.estado !== "futuro");
  const vRevocar = useValidacion({ titulo: "No se pudo revocar el rol", reglas: () => [] });

  const revocar = async (asignacion: ApiRecord) => {
    const motivo = await prompt({ critico: true, title: `Revocar el rol «${asignacion.rol}»`, description: "La asignación se conserva en el historial como revocada; los permisos dejan de contar de inmediato.", label: "Motivo", minLength: 5, confirmLabel: "Revocar", tone: "danger" });
    if (!motivo) return;
    try {
      await sendJsonAuth("POST", `${API_BASE_URL}/admin/usuarios/${base.id}/roles/${asignacion.id}/revocar`, token, { motivo });
      toast.success("Rol revocado");
      await cargar();
      invalidate("usuarios", "roles");
    } catch (err) {
      vRevocar.errorServidor(err);
    }
  };

  return (
    <div className="flex flex-col gap-6" data-usuario-ventana={String(base.id)}>
      <VentanaEncabezado
        figura={<Avatar name={item.nombre} email={item.email} avatar={item.avatar} size="xl" animado="siempre" className="shadow-raised" />}
        titulo={
          <>
            {String(item.nombre || item.email || "Sin nombre")}
            {esPropia ? <span className="ml-1.5 text-sm font-normal text-ink-3">(tú)</span> : null}
          </>
        }
        insignia={
          <Badge tone={estado.tone} dot>
            {estado.label}
          </Badge>
        }
        subtitulo={<Correo valor={item.email} />}
      >
        {roles.length ? (
          <div className="flex flex-wrap gap-1.5" aria-label="Roles vigentes">
            {roles.map((r) => (
              <EtiquetaRol key={String(r.id)}>{String(r.nombre)}</EtiquetaRol>
            ))}
          </div>
        ) : null}
      </VentanaEncabezado>

      <DatosRapidos
        datos={[
          { icono: <ClockCounterClockwise size={17} weight="duotone" />, etiqueta: "Último acceso", valor: item.ultimo_acceso ? haceCuantoCorto(item.ultimo_acceso) : "Nunca", titulo: item.ultimo_acceso ? formatearFechaHora(item.ultimo_acceso) : undefined },
          { icono: <CalendarBlank size={17} weight="duotone" />, etiqueta: "Cuenta desde", valor: formatearFechaCorta(item.vigente_desde || item.creado_en), titulo: formatearFecha(item.vigente_desde || item.creado_en) },
          { icono: <IdentificationBadge size={17} weight="duotone" />, etiqueta: "Roles", valor: String(roles.length) },
          { icono: <Certificate size={17} weight="duotone" />, etiqueta: "Autorizaciones", valor: String(Number(item.autorizaciones_vigentes || 0)) },
        ]}
      />

      <SolicitudBannerDe entidad="usuarios" entidadId={Number(base.id)} />
      {item.bloqueado_hasta ? (
        <Callout tone="danger" title={`Cuenta bloqueada hasta las ${formatearHora(item.bloqueado_hasta)}`}>
          <span className="block">Por varios intentos fallidos de entrar. Se desbloquea sola a esa hora.</span>
          {canAdmin ? (
            <Button size="sm" variant="secondary" className="mt-2" icon={<LockOpen size={14} />} onClick={async () => { await onDesbloquear(item); await cargar(); }}>
              Desbloquear
            </Button>
          ) : null}
        </Callout>
      ) : null}

      <ColumnasVentana
        principal={
          <>
            <PestanasDeslizantes
              label="Información de la persona"
              value={pestana}
              onChange={setPestana}
              options={[
                { value: "roles", label: "Roles" },
                { value: "autorizaciones", label: "Autorizaciones" },
              ]}
            />
            <div key={pestana} className="animate-rise-in motion-reduce:animate-none">
        {pestana === "roles" ? (
          <ValidacionAmbito v={vRevocar}>
            <div className="flex flex-col gap-3">
              {!detalle ? (
                <Skeleton className="h-24 w-full" />
              ) : actuales.length ? (
                <ul className="flex flex-col gap-2.5" aria-label="Roles vigentes">
                  {actuales.map((a, i) => (
                    <TarjetaRol key={String(a.id)} a={a} i={i} onRevocar={canAdmin && !esPropia ? () => revocar(a) : undefined} />
                  ))}
                </ul>
              ) : (
                <p className="rounded-card bg-surface-2 px-4 py-3.5 text-sm text-ink-3 ring-1 ring-line">No tiene roles vigentes: puede entrar, pero no ve nada.</p>
              )}
              {canAdmin && esPropia ? <p className="text-sm text-ink-3">Nadie puede asignarse ni quitarse roles a sí mismo: pídelo a otra persona que administre usuarios.</p> : null}
              {canAdmin && !esPropia ? (
                <div>
                  <Button size="sm" icon={<Plus size={14} weight="bold" />} onClick={() => setAsignar(true)}>
                    Asignar rol
                  </Button>
                </div>
              ) : null}
              {anteriores.length ? (
                <details className="group/hist rounded-card bg-surface-2 ring-1 ring-line">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm font-medium text-ink-2 [&::-webkit-details-marker]:hidden">
                    Historial de roles ({anteriores.length})
                    <span aria-hidden="true" className="text-ink-4 transition-transform duration-200 ease-[var(--ease-spring)] group-open/hist:rotate-180">
                      ▾
                    </span>
                  </summary>
                  <ul className="flex flex-col gap-2 px-3 pb-3">
                    {anteriores.map((a, i) => (
                      <TarjetaRol key={String(a.id)} a={a} i={i} />
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
            {asignar ? <AsignarRolDialog usuarioId={Number(base.id)} nombre={String(item.nombre || item.email || "")} onCerrar={() => setAsignar(false)} onListo={cargar} /> : null}
          </ValidacionAmbito>
        ) : null}

        {pestana === "autorizaciones" ? <AutorizacionesUsuario usuarioId={Number(base.id)} /> : null}
            </div>
          </>
        }
        lateral={
          <>
            <TarjetaLateral icono={temporal ? <Hourglass size={15} weight="duotone" /> : <UserCircleCheck size={15} weight="duotone" />} titulo="Cuenta" tono={item.cuenta_vigente === false && item.activo ? "warning" : "neutral"} i={0}>
              <p className="text-base font-medium text-ink">{temporal ? "Cuenta temporal" : "Cuenta permanente"}</p>
              <p className="text-sm text-ink-2">
                {item.vigente_hasta ? `Puede entrar ${item.vigente_desde ? `del ${formatearFecha(item.vigente_desde)} ` : ""}hasta el ${formatearFecha(item.vigente_hasta)}` : "Sin fecha de fin"}
                {item.vigente_hasta && quedan(item.vigente_hasta) ? <span className="text-ink-3"> · {quedan(item.vigente_hasta)}</span> : null}
              </p>
              {item.vigente_hasta ? <BarraVigencia desde={item.vigente_desde || item.creado_en} hasta={item.vigente_hasta} /> : null}
              {item.cuenta_vigente === false && item.activo ? <p className="text-sm text-warning-text">Está fuera de su vigencia: no puede entrar.</p> : null}
            </TarjetaLateral>
            <TarjetaLateral icono={<Key size={15} weight="duotone" />} titulo="Acceso" tono={!item.tiene_password ? "warning" : "neutral"} i={1}>
              <DatoLateral etiqueta="Último acceso">{item.ultimo_acceso ? `${formatearFechaHora(item.ultimo_acceso)}` : "Nunca ha entrado"}</DatoLateral>
              {!item.tiene_password ? <p className="text-sm text-warning-text">Todavía no tiene contraseña para entrar.</p> : Number(item.debe_cambiar_password) ? <p className="text-sm text-ink-3">Debe elegir una contraseña nueva al entrar.</p> : <p className="text-sm text-ink-3">Ya tiene contraseña.</p>}
            </TarjetaLateral>
            {temporal || item.supervisor_id ? (
              <TarjetaLateral icono={<Eye size={15} weight="duotone" />} titulo="Supervisor" i={2}>
                {item.supervisor_id ? (
                  <button
                    type="button"
                    onClick={() => onAbrirPersona(Number(item.supervisor_id))}
                    className="press group flex items-center gap-3 rounded-box bg-surface px-3 py-2.5 text-left shadow-card ring-1 ring-line transition-shadow duration-200 hover:shadow-raised"
                  >
                    <Avatar name={supervisor?.nombre || item.supervisor_nombre} email={supervisor?.email} avatar={supervisor?.avatar} size="md" animado="al-pasar" />
                    <span className="flex min-w-0 flex-col">
                      <span className="break-words text-base font-medium text-ink">{String(item.supervisor_nombre || supervisor?.nombre || "Supervisor")}</span>
                      <span className="text-xs text-ink-3">Da el visto bueno a lo que registra · ver su información</span>
                    </span>
                  </button>
                ) : (
                  <p className="text-sm text-ink-3">Sin supervisor asignado.</p>
                )}
              </TarjetaLateral>
            ) : null}
            {item.departamento || item.cargo_predeterminado ? (
              <TarjetaLateral icono={<Buildings size={15} weight="duotone" />} titulo="Departamento" i={3}>
                {item.departamento ? <DatoLateral etiqueta="Departamento">{String(item.departamento)}</DatoLateral> : null}
                {item.cargo_predeterminado ? <DatoLateral etiqueta="Firma normalmente como">{String(item.cargo_predeterminado)}</DatoLateral> : null}
              </TarjetaLateral>
            ) : null}
          </>
        }
      />
    </div>
  );
}

/* Un rol: icono, frase de que hace, vigencia con barra y quien lo asigno. */
function TarjetaRol({ a, i, onRevocar }: { a: ApiRecord; i: number; onRevocar?: () => void }) {
  const estado = ESTADO_ASIGNACION[String(a.estado)] || ESTADO_ASIGNACION.vigente;
  const desc = descripcionDeRol({ rol: a.rol, rol_clave: a.rol_clave });
  const activa = a.estado === "vigente" || a.estado === "futuro";
  return (
    <li className={cn("entrada-escalonada flex flex-col gap-2.5 rounded-card bg-surface px-4 py-3.5 ring-1 ring-line transition-shadow duration-200", activa ? "shadow-card hover:shadow-raised" : "opacity-80")} style={{ ["--i" as string]: i }} data-asignacion={String(a.id)}>
      <div className="flex items-start gap-3">
        <IconoRol icono={desc.icono} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-ink">{String(a.rol || "Rol")}</span>
            <Badge tone={estado.tone} dot>
              {estado.label}
            </Badge>
          </div>
          <p className="text-sm text-ink-2">{desc.proposito}</p>
        </div>
        {onRevocar ? (
          <Button size="sm" variant="secondary" icon={<Prohibit size={14} />} onClick={onRevocar}>
            Revocar
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5 pl-[52px]">
        <p className="text-xs text-ink-3">
          Desde el {formatearFecha(a.vigente_desde)}
          {a.vigente_hasta ? ` hasta el ${formatearFecha(a.vigente_hasta)}` : ", sin fecha de fin"}
          {activa && a.vigente_hasta && quedan(a.vigente_hasta) ? ` · ${quedan(a.vigente_hasta)}` : ""}
          {a.asignado_por_nombre ? ` · lo asignó ${String(a.asignado_por_nombre)}` : ""}
        </p>
        {activa && a.vigente_hasta ? <BarraVigencia desde={a.vigente_desde} hasta={a.vigente_hasta} /> : null}
        {a.revocado_en ? (
          <p className="text-xs text-danger">
            Revocado el {formatearFecha(a.revocado_en)}
            {a.revocado_por_nombre ? ` por ${String(a.revocado_por_nombre)}` : ""}
            {a.motivo_revocacion ? `: ${String(a.motivo_revocacion)}` : ""}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/* Asignar rol: los mismos datos de siempre (rol, vigencia, motivo y contraseña); la aprueba un segundo usuario. */
function AsignarRolDialog({ usuarioId, nombre, onCerrar, onListo }: { usuarioId: number; nombre: string; onCerrar: () => void; onListo: () => Promise<void> }) {
  const { token } = useSession();
  const [roles, setRoles] = useState<ApiRecord[]>([]);
  const [nueva, setNueva] = useState({ rol_id: "", desde: hoyLocal(), hasta: "", motivo: "" });
  const [clave, setClave] = useState("");
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    getJsonAuth(`${API_BASE_URL}/admin/roles`, token)
      .then((data) => setRoles(((data.items || []) as ApiRecord[]).filter((role) => !!role.activo)))
      .catch(() => setRoles([]));
  }, [token]);
  const v = useValidacion({
    titulo: "No se pudo asignar el rol",
    reglas: () => {
      const out: Problema[] = [];
      if (!nueva.rol_id) out.push({ campo: "u-asignar-rol", mensaje: msg.elige("el rol a asignar") });
      if (nueva.motivo.trim().length < 5) out.push({ campo: "u-asignar-motivo", mensaje: msg.minimo("El motivo de la asignación", 5) });
      return out;
    },
  });
  const elegido = roles.find((r) => String(r.id) === nueva.rol_id);
  const asignar = async () => {
    if (!v.validar()) return;
    armarReauth(clave ? { password: clave } : null);
    setGuardando(true);
    try {
      const data = await sendJsonAuth("POST", `${API_BASE_URL}/admin/usuarios/${usuarioId}/roles`, token, { rol_id: Number(nueva.rol_id), vigente_desde: nueva.desde || null, vigente_hasta: nueva.hasta || null, motivo: nueva.motivo.trim() });
      // La asignacion queda pendiente de la autorizacion de un segundo usuario.
      if (data.solicitud) toast.info("La asignación quedó pendiente de que otra persona autorizada la apruebe", { duration: 8000 });
      else toast.success("Rol asignado");
      await onListo();
      invalidate("usuarios", "roles", "solicitudes");
      onCerrar();
    } catch (err) {
      v.errorServidor(err, { motivo: "u-asignar-motivo", password: "u-clave-asignar" });
    } finally {
      setGuardando(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onCerrar()}
      title={`Asignar rol a ${nombre}`}
      description="Se revisa que no quede una combinación de roles prohibida y la aprueba otra persona autorizada. Queda en la bitácora con su motivo."
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button icon={<Plus size={14} weight="bold" />} loading={guardando} onClick={asignar}>
            Asignar rol
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <FormGrid>
          <Field label="Rol" htmlFor="u-asignar-rol" required className="sm:col-span-2">
            <Select id="u-asignar-rol" value={nueva.rol_id} onChange={(event) => setNueva((prev) => ({ ...prev, rol_id: event.target.value }))}>
              <option value="">Seleccionar rol</option>
              {roles.map((role) => (
                <option key={String(role.id)} value={String(role.id)}>
                  {String(role.nombre)}
                </option>
              ))}
            </Select>
          </Field>
          {elegido ? (
            <Callout icon={<ShieldCheck size={18} weight="duotone" />} className="sm:col-span-2">
              {descripcionDeRol(elegido).proposito}
            </Callout>
          ) : null}
          <Field label="Motivo" htmlFor="u-asignar-motivo" required className="sm:col-span-2">
            <Textarea id="u-asignar-motivo" rows={2} maxLength={300} value={nueva.motivo} onChange={(event) => setNueva((prev) => ({ ...prev, motivo: event.target.value }))} placeholder="Ej. Cambio de funciones" />
          </Field>
          <Field label="Vigente desde" htmlFor="u-asignar-desde">
            <DateInput id="u-asignar-desde" value={nueva.desde} onChange={(value) => setNueva((prev) => ({ ...prev, desde: value }))} />
          </Field>
          <Field label="Vigente hasta" htmlFor="u-asignar-hasta" hint="Opcional">
            <DateInput id="u-asignar-hasta" value={nueva.hasta} onChange={(value) => setNueva((prev) => ({ ...prev, hasta: value }))} />
          </Field>
        </FormGrid>
        <div className="mt-4">
          <CampoIdentidad value={clave} onChange={setClave} id="u-clave-asignar" />
        </div>
      </ValidacionAmbito>
    </Dialog>
  );
}

