"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PantallaAcceso, TarjetaAcceso } from "@/components/session/PantallaAcceso";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { API_BASE_URL, sendJsonAuth } from "@/lib/client/api";
import { msg, type Problema } from "@/lib/client/mensajes";
import { useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";

/*
 * Cambio de contrasena (Fase 2). Minimo 10 caracteres, distinta del correo y
 * del nombre y de la actual. Cambiarla cierra las demas sesiones; el servidor
 * devuelve una sesion nueva para seguir trabajando aqui.
 */
export function FormCambiarPassword({ onDone, submitLabel = "Cambiar contraseña" }: { onDone?: () => void; submitLabel?: string }) {
  const { token, acceptLogin } = useSession();
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [busy, setBusy] = useState(false);
  const v = useValidacion({
    titulo: "No se pudo cambiar la contraseña",
    reglas: () => {
      const out: Problema[] = [];
      if (!actual) out.push({ campo: "pwd-actual", mensaje: msg.escribe("tu contraseña actual") });
      if (!nueva) out.push({ campo: "pwd-nueva", mensaje: msg.escribe("la contraseña nueva") });
      else if (nueva.length < 10) out.push({ campo: "pwd-nueva", mensaje: "La contraseña nueva debe tener al menos 10 caracteres" });
      if (nueva && confirmar !== nueva) out.push({ campo: "pwd-confirmar", mensaje: confirmar ? "La confirmación no coincide con la contraseña nueva" : msg.escribe("otra vez la contraseña nueva") });
      return out;
    },
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!v.validar()) return;
    setBusy(true);
    try {
      const data = await sendJsonAuth("POST", `${API_BASE_URL}/auth/password`, token, { actual, nueva });
      acceptLogin(data);
      setActual("");
      setNueva("");
      setConfirmar("");
      toast.success("Contraseña cambiada; tus otras sesiones se cerraron");
      onDone?.();
    } catch (err) {
      // Contraseña actual incorrecta (401) o nueva no permitida (400): al campo correspondiente.
      const texto = err instanceof Error ? err.message : "";
      if (/contraseña actual/i.test(texto)) v.avisar({ que: texto, hacer: "Vuelve a escribir tu contraseña actual.", problemas: [{ campo: "pwd-actual", mensaje: texto }] });
      else v.errorServidor(err, { password: "pwd-nueva" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ValidacionAmbito v={v}>
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Field label="Contraseña actual" htmlFor="pwd-actual" required>
        <Input id="pwd-actual" type="password" autoComplete="current-password" value={actual} onChange={(event) => setActual(event.target.value)} />
      </Field>
      <Field label="Contraseña nueva" htmlFor="pwd-nueva" required hint="Al menos 10 caracteres; distinta de tu correo y de tu nombre.">
        <Input id="pwd-nueva" type="password" autoComplete="new-password" value={nueva} onChange={(event) => setNueva(event.target.value)} />
      </Field>
      <Field label="Confirma la contraseña nueva" htmlFor="pwd-confirmar" required>
        <Input id="pwd-confirmar" type="password" autoComplete="new-password" value={confirmar} onChange={(event) => setConfirmar(event.target.value)} />
      </Field>
      <Button type="submit" loading={busy}>
        {submitLabel}
      </Button>
    </form>
    </ValidacionAmbito>
  );
}

/* Pantalla obligatoria tras un restablecimiento: no se entra a nada hasta cambiarla (mismo estilo que el acceso). */
export function CambioPasswordObligatorio() {
  const { user, logout } = useSession();
  return (
    <PantallaAcceso>
      <TarjetaAcceso>
        <section aria-labelledby="cambio-titulo">
          <div className="flex flex-col gap-1">
            <h1 id="cambio-titulo" className="text-[24px] font-bold tracking-[-0.03em] text-ink">
              Cambia tu contraseña
            </h1>
            <p className="text-[14px] text-ink-2">Entraste con una contraseña temporal (asignada al crear o restablecer tu cuenta). Antes de continuar, {user?.nombre || user?.email}, elige una nueva.</p>
          </div>
          <div className="mt-6">
            <FormCambiarPassword submitLabel="Guardar y continuar" />
          </div>
          <button type="button" onClick={logout} className="mt-5 w-full text-center text-[13px] text-ink-3 hover:underline">
            Salir
          </button>
        </section>
      </TarjetaAcceso>
    </PantallaAcceso>
  );
}
