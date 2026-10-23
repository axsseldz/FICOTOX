"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleNotch, Eye, EyeSlash, WarningCircle } from "@phosphor-icons/react";
import { AVISO_LOGIN_KEY, useSession } from "@/components/session/SessionProvider";
import { PantallaAcceso, TarjetaAcceso } from "@/components/session/PantallaAcceso";
import { Field, Input } from "@/components/ui/Field";
import { cn } from "@/components/ui/cn";
import { firstAllowedRoute } from "@/lib/client/nav";

/*
 * Acceso con usuario y contraseña del sistema (Fase 3: sin proveedores
 * externos). Diseño en PantallaAcceso: panel océano con la identidad del
 * laboratorio y el formulario en una tarjeta. La logica no cambia: el mismo
 * inicio de sesion, el mismo mensaje generico del servidor (no revela si el
 * correo existe), bloqueo por intentos y redireccion. Solo se agrega una
 * validacion de interfaz del correo (sin "@") y, al entrar, una transicion
 * breve antes de ir a la aplicacion.
 */

const SALIDA_MS = 460;

export default function LoginPage() {
  const router = useRouter();
  const { status, permissions, loginWithEmail, authConfig } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mayusculas, setMayusculas] = useState(false);
  const [errorCorreo, setErrorCorreo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [niega, setNiega] = useState(0);
  const [saliendo, setSaliendo] = useState(false);
  // La persona acaba de entrar con el formulario (no llego ya con sesion): se anima la salida.
  const enviado = useRef(false);
  // Fase 2: por que se cerro la sesion (revocada, cuenta fuera de vigencia...).
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => {
    try {
      const mensaje = window.sessionStorage.getItem(AVISO_LOGIN_KEY);
      if (mensaje) {
        window.sessionStorage.removeItem(AVISO_LOGIN_KEY);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- lectura unica de sessionStorage al montar
        setAviso(mensaje);
      }
    } catch {
      /* sin almacenamiento */
    }
  }, []);

  // Instalacion nueva sin cuentas: en lugar del acceso, la Configuracion inicial.
  useEffect(() => {
    if (authConfig.instalacion_pendiente) router.replace("/configuracion-inicial");
  }, [authConfig.instalacion_pendiente, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const destino = firstAllowedRoute(permissions) || "/";
    if (!enviado.current) {
      router.replace(destino);
      return;
    }
    // Transicion breve (< 600 ms): la tarjeta se desvanece y el logo se expande; sin animacion con movimiento reducido.
    const reducir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void Promise.resolve().then(() => setSaliendo(true));
    const t = window.setTimeout(() => router.replace(destino), reducir ? 0 : SALIDA_MS);
    return () => window.clearTimeout(t);
  }, [status, permissions, router]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    // Validacion de interfaz: un correo sin "@" no se envia (la respuesta del servidor no cambia).
    if (!email.includes("@")) {
      setErrorCorreo("Escribe tu correo completo, por ejemplo nombre@cicese.mx");
      setNiega((n) => n + 1);
      document.getElementById("login-email")?.focus();
      return;
    }
    setErrorCorreo(null);
    setSubmitting(true);
    enviado.current = true;
    try {
      await loginWithEmail(email.trim(), password);
    } catch (err) {
      enviado.current = false;
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
      setNiega((n) => n + 1);
      setSubmitting(false);
    }
  };

  const revisarMayusculas = (event: KeyboardEvent<HTMLInputElement>) => setMayusculas(event.getModifierState?.("CapsLock") ?? false);

  const fieldClass = "h-12 rounded-box bg-surface-2/70 text-md hover:border-line-strong focus:bg-surface";

  return (
    <PantallaAcceso saliendo={saliendo}>
      <TarjetaAcceso niega={niega} saliendo={saliendo}>
        <div className="flex flex-col gap-1">
          <h1 id="login-title" className="text-3xl font-bold tracking-tight text-ink">
            Bienvenido
          </h1>
          <p className="text-base text-ink-2">Inicia sesión con tu cuenta del laboratorio</p>
        </div>

        {aviso ? (
          <p role="status" className="mt-5 rounded-box bg-warning-soft px-3.5 py-2.5 text-sm text-warning-text">
            {aviso}
          </p>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-4" noValidate aria-labelledby="login-title">
          <Field label="Correo" htmlFor="login-email" error={errorCorreo}>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="nombre@cicese.mx"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (errorCorreo && event.target.value.includes("@")) setErrorCorreo(null);
              }}
              invalid={!!errorCorreo}
              aria-describedby={errorCorreo ? "login-email-error" : undefined}
              required
              autoFocus
              className={fieldClass}
            />
          </Field>
          <Field label="Contraseña" htmlFor="login-password">
            <Input
              id="login-password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={revisarMayusculas}
              onKeyUp={revisarMayusculas}
              onBlur={() => setMayusculas(false)}
              aria-describedby={mayusculas ? "login-mayus" : undefined}
              required
              className={fieldClass}
              trailing={
                <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={showPassword} className="press rounded-full p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink">
                  <span key={showPassword ? "o" : "v"} className="acceso-ojo block">
                    {showPassword ? <EyeSlash size={17} /> : <Eye size={17} />}
                  </span>
                </button>
              }
            />
          </Field>
          {mayusculas ? (
            <p id="login-mayus" className="-mt-2 flex items-center gap-1.5 text-xs text-warning-text animate-rise-in motion-reduce:animate-none">
              <WarningCircle size={14} weight="fill" aria-hidden="true" /> Bloq Mayús está activado
            </p>
          ) : null}

          <div aria-live="assertive" aria-atomic="true">
            {error ? (
              <p role="alert" className="flex items-start gap-2 rounded-box bg-danger-soft px-3.5 py-2.5 text-sm text-danger-text animate-rise-in motion-reduce:animate-none">
                <WarningCircle size={16} weight="fill" className="mt-px shrink-0" aria-hidden="true" />
                {error}
              </p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={submitting || saliendo}
            aria-busy={submitting || undefined}
            className="press relative mt-1 flex h-12 w-full items-center justify-center overflow-hidden rounded-box bg-brand text-md font-semibold text-on-accent shadow-accent hover:bg-brand-strong disabled:cursor-default disabled:hover:bg-brand"
          >
            <span className={cn("flex items-center gap-2 transition-[opacity,translate] duration-200 ease-[var(--ease-spring)]", submitting || saliendo ? "-translate-y-2 opacity-0" : "opacity-100")}>
              Entrar <ArrowRight size={16} weight="bold" aria-hidden="true" />
            </span>
            <span aria-hidden={!(submitting || saliendo)} className={cn("absolute inset-0 flex items-center justify-center transition-[opacity,translate] duration-200 ease-[var(--ease-spring)]", submitting || saliendo ? "opacity-100" : "translate-y-2 opacity-0")}>
              <CircleNotch size={20} weight="bold" className={submitting || saliendo ? "animate-spin" : undefined} />
              <span className="sr-only">Entrando…</span>
            </span>
          </button>
        </form>
      </TarjetaAcceso>
    </PantallaAcceso>
  );
}
