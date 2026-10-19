"use client";

import Link from "next/link";
import { LockKey, Question, SignOut } from "@phosphor-icons/react";
import { BrandMark } from "@/components/shell/Brand";
import { Button, buttonClass } from "@/components/ui/Button";
import { useSession } from "./SessionProvider";

/*
 * Una persona sin roles vigentes puede iniciar sesion, pero no ve nada del
 * sistema: solo este aviso (Fase 1). Los permisos se vuelven a consultar cada
 * minuto, asi que al asignarle un rol entra sin volver a iniciar sesion.
 */
export function SinPermisos() {
  const { user, logout } = useSession();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="flex w-full max-w-[420px] flex-col items-center gap-4 rounded-card bg-surface p-8 text-center shadow-card">
        <BrandMark size={44} />
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-warning-soft text-warning">
          <LockKey size={20} weight="duotone" />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="title-2 text-ink">Sin permisos asignados</h1>
          <p className="text-sm text-ink-3">
            {user?.nombre || user?.email ? <span className="font-medium text-ink-2">{user?.nombre || user?.email}</span> : "Tu cuenta"} no tiene roles vigentes en FICOTOX. Pide a la administración del sistema que te asigne un rol.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link href="/ayuda" className={buttonClass({ variant: "ghost" })}>
            <Question size={16} /> Ayuda
          </Link>
          <Button variant="secondary" icon={<SignOut size={16} />} onClick={logout}>
            Cerrar sesión
          </Button>
        </div>
      </div>
    </main>
  );
}
