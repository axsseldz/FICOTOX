"use client";

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { Panel } from "@/components/features/samples/FormLayout";
import { useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { msg, type Problema } from "@/lib/client/mensajes";
import { useSession } from "@/components/session/SessionProvider";
import { AvatarPicker } from "@/components/ui/AvatarPicker";
import { Button } from "@/components/ui/Button";
import { Field, FormGrid, Input, Select, Switch, Textarea } from "@/components/ui/Field";
import { DateInput } from "@/components/ui/DateInput";
import { Sheet } from "@/components/ui/Overlay";
import { SolicitudBannerDe } from "@/components/features/solicitudes/Solicitudes";
import { API_BASE_URL, armarReauth, getJsonAuth, sendJsonAuth } from "@/lib/client/api";
import { CampoIdentidad } from "@/components/session/Reautenticar";
import { invalidate } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";

/* ---------- Usuarios ---------- */

/*
 * Alta y edicion de los datos de una cuenta (nombre, correo, departamento,
 * avatar, contrasena, activa, vigencia y supervisor). Los roles y las
 * autorizaciones se gestionan en la ventana de la persona (UsuarioVentana).
 */
export function UserSheet({ open, item, onClose }: { open: boolean; item: ApiRecord | null; onClose: () => void }) {
  const { token, can, authConfig, user: me } = useSession();
  const [roles, setRoles] = useState<ApiRecord[]>([]);
  const [nombre, setNombre] = useState(String(item?.nombre || ""));
  const [email, setEmail] = useState(String(item?.email || ""));
  const [roleId, setRoleId] = useState("");
  const [motivoAlta, setMotivoAlta] = useState("Alta de usuario");
  const [departamento, setDepartamento] = useState(String(item?.departamento || ""));
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [activo, setActivo] = useState(item ? !!item.activo : true);
  const [avatar, setAvatar] = useState<string | null>(item?.avatar ? String(item.avatar) : null);
  // Fase 2: vigencia de la cuenta y supervisor (temporal => fin y supervisor obligatorios).
  const [tipoCuenta, setTipoCuenta] = useState<string>(String(item?.tipo_cuenta || "permanente"));
  const [cuentaDesde, setCuentaDesde] = useState(String(item?.vigente_desde || ""));
  const [cuentaHasta, setCuentaHasta] = useState(String(item?.vigente_hasta || ""));
  const [supervisorId, setSupervisorId] = useState(item?.supervisor_id ? String(item.supervisor_id) : "");
  const [motivoCuenta, setMotivoCuenta] = useState("");
  const [personas, setPersonas] = useState<ApiRecord[]>([]);
  // Contrasena de quien administra: confirma la identidad en la misma hoja (reautenticacion).
  const [clave, setClave] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const editing = !!item?.id;
  const puedeAdministrar = can("usuarios", "G");
  const esPropia = editing && Number(me?.id) === Number(item?.id);

  useEffect(() => {
    if (!open || !token || !puedeAdministrar) return;
    getJsonAuth(`${API_BASE_URL}/admin/roles`, token)
      .then((data) => setRoles(((data.items || []) as ApiRecord[]).filter((role) => !!role.activo)))
      .catch(() => setRoles([]));
    // Posibles supervisores: cuentas activas y permanentes (el servidor valida que tengan R o A en ensayos o muestras).
    getJsonAuth(`${API_BASE_URL}/admin/usuarios`, token)
      .then((data) => setPersonas(((data.items || []) as ApiRecord[]).filter((u) => !!u.activo && String(u.tipo_cuenta || "permanente") !== "temporal" && !u.vigente_hasta && Number(u.id) !== Number(item?.id))))
      .catch(() => setPersonas([]));
  }, [open, token, puedeAdministrar, item?.id]);

  const cambiaCuenta =
    editing &&
    (String(item?.tipo_cuenta || "permanente") !== tipoCuenta ||
      String(item?.vigente_desde || "") !== cuentaDesde ||
      String(item?.vigente_hasta || "") !== cuentaHasta ||
      String(item?.supervisor_id || "") !== supervisorId);
  // Pide la contrasena en la hoja cuando el guardado es critico: alta (asigna rol), cambio de vigencia o supervisor, baja o fijar la contrasena de otra persona.
  const guardadoCritico = !editing || cambiaCuenta || (editing && !!item?.activo && !activo) || (editing && !!password && !esPropia);

  const dominios = authConfig.dominios_permitidos || [];
  /* Reglas de la cuenta, en el orden de la hoja. */
  const v = useValidacion({
    titulo: editing ? "No se pudo guardar el usuario" : "No se pudo crear el usuario",
    reglas: () => {
      const out: Problema[] = [];
      const correo = email.trim();
      const emailCambio = !editing || String(item?.email || "").toLowerCase() !== correo.toLowerCase();
      if (!correo) out.push({ campo: "u-email", mensaje: msg.indica("el correo") });
      else if (emailCambio && dominios.length && !dominios.some((d) => correo.toLowerCase().endsWith(`@${d}`))) out.push({ campo: "u-email", mensaje: `Usa un correo de ${dominios.map((d) => `@${d}`).join(", ")}` });
      if (!editing) {
        if (!roleId) out.push({ campo: "u-rol", mensaje: msg.elige("el rol inicial") });
        if (motivoAlta.trim().length < 5) out.push({ campo: "u-motivo-rol", mensaje: msg.minimo("El motivo de la asignación", 5) });
        if (!password && !esPropia) out.push({ campo: "u-password", mensaje: msg.indica("una contraseña inicial") });
      }
      if (password && password.length < 10) out.push({ campo: "u-password", mensaje: "La contraseña debe tener al menos 10 caracteres" });
      if (tipoCuenta === "temporal" && !supervisorId) out.push({ campo: "u-supervisor", mensaje: "Una cuenta temporal necesita supervisor" });
      if (tipoCuenta === "temporal" && !cuentaHasta) out.push({ campo: "u-cuenta-hasta", mensaje: "Una cuenta temporal necesita fecha de fin" });
      if (cambiaCuenta && motivoCuenta.trim().length < 5) out.push({ campo: "u-motivo-cuenta", mensaje: msg.minimo("El motivo del cambio", 5) });
      return out;
    },
  });
  const camposUsuario = { correo: "u-email", motivo: editing ? "u-motivo-cuenta" : "u-motivo-rol", password: guardadoCritico ? "u-clave-admin" : "u-password" };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!puedeAdministrar) return;
    const payload: Record<string, unknown> = {
      nombre: nombre.trim(),
      email: email.trim(),
      departamento: departamento.trim() || null,
      ...(avatar ? { avatar } : {}),
      activo,
    };
    if (password) payload.password = password;
    if (!v.validar()) return;
    if (!editing) {
      payload.rol_id = Number(roleId);
      payload.motivo = motivoAlta.trim();
    }
    payload.tipo_cuenta = tipoCuenta;
    payload.vigente_desde = cuentaDesde || null;
    payload.vigente_hasta = cuentaHasta || null;
    payload.supervisor_id = supervisorId ? Number(supervisorId) : null;
    if (cambiaCuenta) payload.motivo_cuenta = motivoCuenta.trim();
    if (guardadoCritico) armarReauth(clave ? { password: clave } : null);
    setSubmitting(true);
    try {
      // Fase 3: el rol inicial, la reactivacion y la ampliacion de vigencia los aprueba un segundo usuario (respuesta con `solicitud`).
      const data = await sendJsonAuth(editing ? "PUT" : "POST", editing ? `${API_BASE_URL}/admin/usuarios/${item!.id}` : `${API_BASE_URL}/admin/usuarios`, token, payload);
      if (data.solicitud) toast.info(String(data.message || "Pendiente de autorización de un segundo usuario"), { duration: 8000 });
      else toast.success(editing ? "Usuario actualizado" : "Usuario creado");
      invalidate("usuarios", "roles", "solicitudes");
      onClose();
    } catch (err) {
      v.errorServidor(err, camposUsuario);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(value) => !value && onClose()}
      title={!puedeAdministrar ? String(item?.nombre || item?.email || "Usuario") : editing ? "Editar usuario" : "Nuevo usuario"}
      description={editing ? "Datos de acceso y vigencia de la cuenta. Los roles y las autorizaciones se gestionan en la ventana de la persona." : "Acceso con correo institucional; la cuenta nace con un rol inicial."}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {puedeAdministrar ? "Cancelar" : "Cerrar"}
          </Button>
          {puedeAdministrar ? (
            <Button type="submit" form="user-form" loading={submitting}>
              {editing ? "Guardar cambios" : "Crear usuario"}
            </Button>
          ) : null}
        </>
      }
    >
      <ValidacionAmbito v={v}>
      {editing ? <div className="mb-5"><SolicitudBannerDe entidad="usuarios" entidadId={item?.id as number} /></div> : null}
      <form id="user-form" onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <fieldset disabled={!puedeAdministrar} className="contents">
          <FormGrid>
            <Field label="Nombre" htmlFor="u-nombre">
              <Input id="u-nombre" maxLength={100} value={nombre} onChange={(event) => setNombre(event.target.value)} autoFocus={!editing} />
            </Field>
            <Field label="Correo" htmlFor="u-email" required hint={editing || !dominios.length ? undefined : `Debe ser de ${dominios.map((d) => `@${d}`).join(", ")}`}>
              <Input id="u-email" type="email" maxLength={100} value={email} onChange={(event) => setEmail(event.target.value)} />
            </Field>
            {!editing ? (
              <>
                <Field label="Rol inicial" htmlFor="u-rol" required>
                  <Select id="u-rol" value={roles.some((role) => String(role.id) === roleId) ? roleId : ""} onChange={(event) => setRoleId(event.target.value)}>
                    <option value="">Seleccionar rol</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.nombre}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Motivo de la asignación" htmlFor="u-motivo-rol" required hint="Queda en la bitácora.">
                  <Textarea id="u-motivo-rol" rows={2} maxLength={200} value={motivoAlta} onChange={(event) => setMotivoAlta(event.target.value)} />
                </Field>
              </>
            ) : null}
            <Field label="Departamento" htmlFor="u-depto">
              <Input id="u-depto" maxLength={100} value={departamento} onChange={(event) => setDepartamento(event.target.value)} />
            </Field>
            {puedeAdministrar ? (
              <>
                <Field label="Avatar" hint={editing ? "La persona también puede cambiarlo desde Mi cuenta." : "Si no eliges uno, se asigna al azar."} className="sm:col-span-2">
                  <AvatarPicker value={avatar} seed={email.trim().toLowerCase() || nombre.toLowerCase()} onChange={setAvatar} size={44} />
                </Field>
                {esPropia ? (
                  <p className="text-[12.5px] text-ink-3 sm:col-span-2">Tu propia contraseña se cambia en Mi cuenta › Cambiar contraseña.</p>
                ) : (
                  <Field label={editing ? "Nueva contraseña" : "Contraseña"} htmlFor="u-password" required={!editing} hint={editing ? "Déjala vacía para conservar la actual. Si la cambias, la persona deberá cambiarla al entrar." : "Mínimo 10 caracteres; distinta del correo y del nombre."} className="sm:col-span-2">
                    <Input
                      id="u-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      trailing={
                        <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} className="rounded-full p-1 text-ink-3 hover:bg-surface-2 hover:text-ink">
                          {showPassword ? <EyeSlash size={16} /> : <Eye size={16} />}
                        </button>
                      }
                    />
                  </Field>
                )}
              </>
            ) : null}
          </FormGrid>
          {puedeAdministrar ? <Switch checked={activo} onCheckedChange={setActivo} label="Usuario activo" description="Un usuario inactivo conserva su historial pero no puede entrar." /> : null}

          <Panel title="Vigencia de la cuenta" description="Una cuenta temporal (estudiantes, estancias) necesita fecha de fin y un supervisor; fuera de su vigencia no puede entrar y sus roles no pueden durar más que la cuenta.">
            <FormGrid>
              <Field label="Tipo de cuenta" htmlFor="u-tipo-cuenta">
                <Select id="u-tipo-cuenta" value={tipoCuenta} onChange={(event) => setTipoCuenta(event.target.value)}>
                  <option value="permanente">Permanente</option>
                  <option value="temporal">Temporal</option>
                </Select>
              </Field>
              <Field label="Supervisor" htmlFor="u-supervisor" required={tipoCuenta === "temporal"} hint="Persona con cuenta permanente que revisa y aprueba en ensayos o muestras.">
                <Select id="u-supervisor" value={supervisorId} onChange={(event) => setSupervisorId(event.target.value)}>
                  <option value="">Sin supervisor</option>
                  {personas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre || p.email}
                    </option>
                  ))}
                  {supervisorId && !personas.some((p) => String(p.id) === supervisorId) ? <option value={supervisorId}>{String(item?.supervisor_nombre || `Usuario #${supervisorId}`)}</option> : null}
                </Select>
              </Field>
              <Field label="Vigente desde" htmlFor="u-cuenta-desde" hint="Opcional">
                <DateInput id="u-cuenta-desde" value={cuentaDesde} onChange={(value) => setCuentaDesde(value)} />
              </Field>
              <Field label="Vigente hasta" htmlFor="u-cuenta-hasta" required={tipoCuenta === "temporal"} hint={tipoCuenta === "temporal" ? undefined : "Opcional"}>
                <DateInput id="u-cuenta-hasta" value={cuentaHasta} onChange={(value) => setCuentaHasta(value)} />
              </Field>
              {cambiaCuenta ? (
                <Field label="Motivo del cambio de vigencia o supervisor" htmlFor="u-motivo-cuenta" required hint="Queda en la bitácora." className="sm:col-span-2">
                  <Textarea id="u-motivo-cuenta" rows={2} maxLength={300} value={motivoCuenta} onChange={(event) => setMotivoCuenta(event.target.value)} />
                </Field>
              ) : null}
            </FormGrid>
          </Panel>
          {puedeAdministrar && guardadoCritico ? <CampoIdentidad value={clave} onChange={setClave} id="u-clave-admin" /> : null}
        </fieldset>
      </form>
      </ValidacionAmbito>

    </Sheet>
  );
}
