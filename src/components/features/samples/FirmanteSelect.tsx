"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Overlay";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { useResource } from "@/lib/client/store";
import { msg } from "@/lib/client/mensajes";
import { useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";

/*
 * Firmante ligado a una cuenta (Fase 5): quien recibio, proceso, superviso,
 * extrajo, limpio o analizo se elige de las cuentas activas. Por omision es la
 * persona de la sesion; si se elige a otra, esa persona escribe su contrasena.
 * La contrasena se queda en memoria y viaja AL GUARDAR junto con su usuario_id
 * (el servidor la verifica en esa misma peticion): antes de guardar no se
 * escribe nada. El servidor pone nombre y cargo.
 */
export interface Cuenta {
  id: number;
  nombre: string;
  email: string;
  cargo: string | null;
}

export interface FirmanteState {
  usuario_id: number | null;
  token_firma?: string | null;
  /* Contrasena del firmante (otra persona): se envia solo al guardar. */
  password?: string | null;
}

export function useCuentasActivas(): Cuenta[] {
  const { token } = useSession();
  const resource = useResource<Cuenta[]>(
    "cuentas-activas",
    async () => ((await getJsonAuth(`${API_BASE_URL}/cuentas/activas`, token)).items || []) as Cuenta[],
    { enabled: !!token },
  );
  return resource.data || [];
}

/* Firmantes para el payload: { rol: { usuario_id, password? | token_firma? } } (solo los elegidos). */
export function firmantesPayload(map: Record<string, FirmanteState | undefined>): Record<string, { usuario_id: number; token_firma?: string; password?: string }> {
  const out: Record<string, { usuario_id: number; token_firma?: string; password?: string }> = {};
  for (const [rol, f] of Object.entries(map)) {
    if (!f?.usuario_id) continue;
    out[rol] = { usuario_id: f.usuario_id, ...(f.password ? { password: f.password } : f.token_firma ? { token_firma: f.token_firma } : {}) };
  }
  return out;
}

/* Estado inicial desde el registro guardado (<rol>_usuario_id). */
export const firmanteDe = (item: Record<string, unknown> | null | undefined, rol: string): FirmanteState => ({ usuario_id: Number(item?.[`${rol}_usuario_id`]) || null });

export function FirmanteSelect({
  id,
  title,
  value,
  onChange,
  nombre,
  disabled = false,
  porOmisionSesion = true,
  nuevo = false,
}: {
  id: string;
  title: string;
  value: FirmanteState;
  /* Nueva seleccion, con el nombre y cargo de la cuenta (para el campo visible). */
  onChange: (value: FirmanteState, cuenta: Cuenta | null) => void;
  /* Nombre guardado (registros anteriores sin cuenta). */
  nombre?: string;
  disabled?: boolean;
  porOmisionSesion?: boolean;
  /* Formato nuevo (aun sin guardar): su nombre prellenado con el de la sesion se liga a la cuenta. */
  nuevo?: boolean;
}) {
  const { user } = useSession();
  const cuentas = useCuentasActivas();
  const yo = Number(user?.id) || 0;
  const [pendiente, setPendiente] = useState<Cuenta | null>(null);

  // Por omision firma la persona de la sesion (solo en formatos nuevos o sin firmante). Los formatos nuevos
  // prellenan el nombre con el de la sesion: ese nombre tambien se liga a su cuenta (si no, la firma quedaba sin cuenta).
  // Un registro guardado con solo el nombre no se liga a nadie, aunque quien edita se llame igual.
  useEffect(() => {
    if (disabled || !porOmisionSesion || value.usuario_id || !yo || !cuentas.length) return;
    const propia = cuentas.find((c) => c.id === yo) || null;
    if (!propia || (nombre && nombre.trim() && (!nuevo || nombre.trim() !== propia.nombre.trim()))) return;
    onChange({ usuario_id: yo }, propia);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuentas.length, yo, disabled]);

  const actual = cuentas.find((c) => c.id === value.usuario_id) || null;
  const elegir = (idTexto: string) => {
    const cuenta = cuentas.find((c) => String(c.id) === idTexto) || null;
    if (!cuenta) {
      onChange({ usuario_id: null }, null);
      return;
    }
    if (cuenta.id === yo) {
      onChange({ usuario_id: yo }, cuenta);
      return;
    }
    // Otra persona: escribe su contrasena antes de quedar como firmante.
    setPendiente(cuenta);
  };

  const confirmada = !!value.usuario_id && (value.usuario_id === yo || !!value.token_firma || !!value.password);
  return (
    <div className="flex flex-col gap-1.5">
      <Select id={id} value={value.usuario_id ? String(value.usuario_id) : ""} disabled={disabled} onChange={(event) => elegir(event.target.value)} aria-label={`${title}: cuenta`}>
        <option value="">{nombre && !value.usuario_id ? `${nombre} (sin cuenta ligada)` : "Seleccionar cuenta"}</option>
        {cuentas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </Select>
      {actual ? (
        <p className="text-xs text-ink-3" data-firmante={value.usuario_id}>
          {actual.cargo ? `Cargo: ${actual.cargo}` : actual.email}
          {!disabled && actual.id !== yo ? (value.password ? " · su contraseña se verificará al guardar" : confirmada ? " · firma confirmada con su contraseña" : "") : ""}
        </p>
      ) : null}
      {/* Un formulario por cuenta elegida: no arrastra lo escrito ni los errores de la anterior. */}
      {pendiente ? (
        <DialogoFirma
          key={pendiente.id}
          cuenta={pendiente}
          onCancelar={() => setPendiente(null)}
          onConfirmar={(password) => {
            onChange({ usuario_id: pendiente.id, password }, pendiente);
            setPendiente(null);
          }}
        />
      ) : null}
    </div>
  );
}

/* La contrasena no se verifica aqui (eso escribiria en la bitacora antes de guardar): viaja al guardar el formato. */
function DialogoFirma({ cuenta, onCancelar, onConfirmar }: { cuenta: Cuenta; onCancelar: () => void; onConfirmar: (password: string) => void }) {
  const [password, setPassword] = useState("");
  const v = useValidacion({
    titulo: "Falta la contraseña de quien firma",
    reglas: () => (password ? [] : [{ campo: "firma-password", mensaje: msg.escribe(`la contraseña de ${cuenta.nombre}`) }]),
  });
  const confirmar = () => {
    if (!v.validar()) return;
    onConfirmar(password);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancelar();
      }}
      title={`Confirmar firma de ${cuenta.nombre}`}
      description="Quien firma debe escribir su propia contraseña. Se verifica al guardar el formato; así la firma queda ligada a su cuenta."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button onClick={confirmar}>Confirmar firma</Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <Field label={`Contraseña de ${cuenta.nombre}`} htmlFor="firma-password" required>
          <Input
            id="firma-password"
            type="password"
            autoComplete="off"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                confirmar();
              }
            }}
          />
        </Field>
      </ValidacionAmbito>
    </Dialog>
  );
}
