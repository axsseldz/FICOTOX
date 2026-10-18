"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { LockKey } from "@phosphor-icons/react";
import { BrandMark } from "@/components/shell/Brand";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Overlay";

/*
 * Cierre de sesion por inactividad (Fase 2; FX-MO-2-1, seccion 11).
 * - Tras `inactividad_min` sin actividad (30 min por omision, SESION_INACTIVIDAD_MIN)
 *   la sesion se cierra; un minuto antes se avisa con opcion de continuar.
 * - La actividad en otra pestana tambien cuenta (se comparte en localStorage).
 * - Al cerrarse, el token se descarta pero la pagina sigue montada debajo de
 *   la pantalla de bloqueo: al volver a entrar se conserva lo capturado.
 * En desarrollo y pruebas, localStorage["ficotox.prueba.inactividad-seg"] acorta
 * el plazo (se ignora en produccion).
 */

const ACTIVIDAD_KEY = "ficotox.ultima-actividad";
const PRUEBA_KEY = "ficotox.prueba.inactividad-seg";
const AVISO_MS = 60_000;

function leerNumero(key: string): number | null {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function plazoMs(minutos: number | undefined): number {
  if (process.env.NODE_ENV !== "production") {
    const prueba = leerNumero(PRUEBA_KEY);
    if (prueba) return prueba * 1000;
  }
  return Math.max(1, minutos || 30) * 60_000;
}

export function SesionInactiva() {
  const { status, locked, lock, authConfig } = useSession();
  const [restante, setRestante] = useState<number | null>(null);
  const ultima = useRef(0);

  useEffect(() => {
    if (status !== "authenticated" || locked) return;
    const plazo = plazoMs(authConfig.sesion?.inactividad_min);
    const aviso = Math.min(AVISO_MS, Math.floor(plazo / 2));
    ultima.current = Date.now();
    let escrito = 0;
    const marcar = () => {
      const ahora = Date.now();
      ultima.current = ahora;
      // Se comparte con otras pestanas, sin escribir en cada movimiento.
      if (ahora - escrito > 5_000) {
        escrito = ahora;
        try {
          window.localStorage.setItem(ACTIVIDAD_KEY, String(ahora));
        } catch {
          /* sin almacenamiento */
        }
      }
    };
    const eventos = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove", "scroll"] as const;
    for (const evento of eventos) window.addEventListener(evento, marcar, { passive: true, capture: true });
    const timer = window.setInterval(() => {
      const otra = leerNumero(ACTIVIDAD_KEY) || 0;
      const desde = Math.max(ultima.current, otra);
      const falta = plazo - (Date.now() - desde);
      if (falta <= 0) {
        setRestante(null);
        lock();
      } else {
        setRestante(falta <= aviso ? falta : null);
      }
    }, 1000);
    return () => {
      for (const evento of eventos) window.removeEventListener(evento, marcar, { capture: true });
      window.clearInterval(timer);
    };
  }, [status, locked, lock, authConfig.sesion?.inactividad_min]);

  const seguir = () => {
    ultima.current = Date.now();
    try {
      window.localStorage.setItem(ACTIVIDAD_KEY, String(ultima.current));
    } catch {
      /* sin almacenamiento */
    }
    setRestante(null);
  };

  return (
    <>
      <Dialog
        open={restante !== null && !locked}
        onOpenChange={(open) => {
          if (!open) seguir();
        }}
        title="Tu sesión está por cerrarse"
        description={`Por inactividad, la sesión se cerrará en ${Math.ceil((restante || 0) / 1000)} segundos. Lo que estés capturando se conserva.`}
        size="sm"
        footer={<Button onClick={seguir}>Seguir trabajando</Button>}
      >
        <p className="text-[13px] text-ink-3">Si la sesión se cierra, podrás volver a entrar aquí mismo sin perder lo capturado.</p>
      </Dialog>
      {locked ? <PantallaBloqueo /> : null}
    </>
  );
}

/* Pantalla de bloqueo: cubre la aplicacion (que sigue montada) hasta volver a entrar. */
function PantallaBloqueo() {
  const { user, unlock, logout } = useSession();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const entrar = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await unlock(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo volver a entrar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="bloqueo-titulo" className="fixed inset-0 z-[var(--z-bloqueo)] flex items-center justify-center bg-[rgba(16,32,43,0.55)] px-4 backdrop-blur-md">
      <div className="w-full max-w-[380px] rounded-[18px] bg-surface p-6 shadow-panel ring-1 ring-line">
        <div className="flex flex-col items-center text-center">
          <BrandMark size={44} />
          <h2 id="bloqueo-titulo" className="mt-4 text-[18px] font-semibold text-ink">
            Sesión cerrada por inactividad
          </h2>
          <p className="mt-1.5 text-[13.5px] text-ink-2">Lo que estabas capturando sigue aquí. Vuelve a entrar como {user?.nombre || user?.email} para continuar.</p>
        </div>
        <form onSubmit={entrar} className="mt-5 flex flex-col gap-3">
            <Field label="Contraseña" htmlFor="bloqueo-password" error={error || undefined}>
              <Input id="bloqueo-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} leading={<LockKey size={16} />} />
            </Field>
            <Button type="submit" block loading={busy} disabled={!password}>
              Volver a entrar
            </Button>
          </form>
        <button type="button" onClick={logout} className="mt-4 w-full text-center text-[12.5px] text-ink-3 underline-offset-2 hover:underline">
          Salir (se descarta lo capturado)
        </button>
      </div>
    </div>
  );
}
