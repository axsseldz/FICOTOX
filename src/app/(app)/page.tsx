"use client";

import { useEffect } from "react";
import Link from "next/link";
import { PageBody } from "@/components/shell/AppShell";
import { Busqueda } from "@/components/shell/Busqueda";
import { CORTO, TONO, ordenarPendientes } from "@/components/features/inicio/pendientes";
import type { Pendiente } from "@/components/features/inicio/tipos";
import { useSession } from "@/components/session/SessionProvider";
import { cn } from "@/components/ui/cn";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { useResource } from "@/lib/client/store";
import { diaSemana, formatearFechaLarga, formatearHora, hoyLocal } from "@/lib/shared/fechas";

/*
 * Inicio: fecha, saludo y la búsqueda como protagonista, centrados. Debajo, solo
 * si hay pendientes, hasta 4 píldoras (las más urgentes) que llevan a su lista.
 * Todo con los permisos y alcances de cada persona; los pendientes se actualizan
 * cada minuto y al volver a la pestaña, sin parpadeos.
 */

function greeting(): string {
  const hour = Number(formatearHora(new Date()).slice(0, 2));
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

export default function InicioPage() {
  const { token, user } = useSession();

  const resource = useResource<Pendiente[]>(
    ["dashboard", "movimientos", "mantenimientos", "muestras", "reactivos", "consumibles", "equipos", "informes", "documentos", "calidad", "solicitudes", "usuarios"],
    async () => {
      const avisos = await getJsonAuth(`${API_BASE_URL}/inicio/avisos`, token).catch(() => null);
      return ((avisos?.items || []) as Pendiente[]) || [];
    },
    { enabled: !!token },
  );

  // Cada minuto y al volver a la pestaña (como la campana); los datos se reemplazan sin vaciar la pantalla.
  const recargar = resource.reload;
  useEffect(() => {
    if (!token) return;
    const refrescar = () => {
      if (document.visibilityState === "visible") void recargar();
    };
    const timer = window.setInterval(refrescar, 60_000);
    document.addEventListener("visibilitychange", refrescar);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refrescar);
    };
  }, [token, recargar]);

  // Fecha del laboratorio (America/Tijuana), no la del navegador.
  const hoy = hoyLocal();
  const rawToday = `${diaSemana(hoy)}, ${formatearFechaLarga(hoy).replace(/ de \d{4}$/, "")}`;
  const today = rawToday.charAt(0).toUpperCase() + rawToday.slice(1);
  const firstName = (user?.nombre || user?.email || "").split(/[\s@]/)[0];
  const pendientes = resource.data ? ordenarPendientes(resource.data).slice(0, 4) : [];

  return (
    <PageBody>
      {/* Un poco por encima del centro óptico: el relleno inferior es mayor que el superior. */}
      <div className="mx-auto flex min-h-[calc(100dvh-220px)] w-full max-w-[720px] flex-col items-center justify-center pb-[12vh] text-center">
        <p className="animate-fade-in text-[13px] text-ink-3">{today}</p>
        <h1 className="animate-fade-in mt-1.5 text-[24px] font-medium tracking-[-0.01em] text-ink sm:text-[28px]">
          {greeting()}
          {firstName ? `, ${firstName}` : ""}.
        </h1>
        {pendientes.length ? (
          <ul aria-label="Pendientes" className="animate-fade-in mt-4 flex flex-wrap items-center justify-center gap-2">
            {pendientes.map((p) => {
              const corto = CORTO[p.key] || { label: p.label, icono: null };
              const tono = TONO[p.tone];
              return (
                <li key={p.key}>
                  <Link href={p.href} title={p.label} className="press inline-flex h-8 items-center gap-2 rounded-full bg-surface pr-3 pl-1.5 text-[12.5px] text-ink-2 ring-1 ring-line transition-[box-shadow,color] duration-200 hover:text-ink hover:shadow-card focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none">
                    <span aria-hidden="true" className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[12px] [&>svg]:h-[1em] [&>svg]:w-[1em]", tono.circulo)}>
                      {corto.icono}
                    </span>
                    <span className="tnum font-semibold text-ink">{p.count}</span>
                    <span>{corto.label.toLowerCase()}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
        <div className={cn("entrada-escalonada w-full", pendientes.length ? "mt-4" : "mt-8")} style={{ ["--i" as string]: 1 }}>
          <Busqueda modo="pagina" />
        </div>
      </div>
    </PageBody>
  );
}
