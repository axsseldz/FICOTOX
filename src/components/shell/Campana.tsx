"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Popover as RadixPopover } from "radix-ui";
import { Bell, Check, Checks, WarningDiamond } from "@phosphor-icons/react";
import { IncidenciaVentana, NcVentana } from "@/components/features/calidad/ventanas/CalidadVentanas";
import { CORTO, TONO, ventanaDe } from "@/components/features/inicio/pendientes";
import { useSession } from "@/components/session/SessionProvider";
import { Conteo, MarcaDibujada } from "@/components/ui/Conteo";
import { cn } from "@/components/ui/cn";
import { API_BASE_URL, getJsonAuth, sendJsonAuth } from "@/lib/client/api";
import { haceCuantoCorto } from "@/lib/client/tiempo";
import { fechaSola, hoyLocal, sumarDias } from "@/lib/shared/fechas";

/*
 * Campana de notificaciones. Sale de la misma fuente que "Para ti" del
 * Inicio (GET /api/notificaciones), un aviso por evento con su clave. Las
 * leidas no se cuentan ni se muestran: al pulsar una (o "Marcar como leída",
 * o "Marcar todas como leídas") se marca en pantalla al instante y se guarda
 * en el servidor; "Ver anteriores" muestra las leidas de los ultimos 7 dias.
 * Marcar como leida no resuelve el pendiente: sigue en el Inicio y en su
 * bandeja. Se recarga cada minuto y al volver a la pestana sin reaparecer las
 * leidas ni parpadear.
 */
interface Notificacion {
  clave: string;
  grupo: string;
  frase: string;
  registro: string;
  detalle: string | null;
  href: string;
  tono: "danger" | "warning" | "info";
  cuando: string | null;
  leida_en: string | null;
}

/* Hoy, Ayer o Anteriores (dia del laboratorio). */
function diaDe(cuando: string | null): "Hoy" | "Ayer" | "Anteriores" {
  const dia = cuando ? fechaSola(cuando) : "";
  const hoy = hoyLocal();
  if (dia === hoy) return "Hoy";
  if (dia === sumarDias(hoy, -1)) return "Ayer";
  return "Anteriores";
}

export function Campana({ compacta = false }: { compacta?: boolean }) {
  const { token } = useSession();
  const router = useRouter();
  const [items, setItems] = useState<Notificacion[] | null>(null);
  const [anteriores, setAnteriores] = useState<Notificacion[]>([]);
  const [verAnteriores, setVerAnteriores] = useState(false);
  const [abierta, setAbierta] = useState(false);
  // Marcadas en esta pantalla: no reaparecen aunque una recarga llegue antes de que el servidor las guarde.
  const [leidasLocal, setLeidasLocal] = useState<Set<string>>(new Set());
  // Las que se estan desvaneciendo (animacion de salida).
  const [saliendo, setSaliendo] = useState<Set<string>>(new Set());
  const [ventana, setVentana] = useState<{ tipo: "incidencia" | "nc"; id: number } | null>(null);

  const cargar = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getJsonAuth(`${API_BASE_URL}/notificaciones`, token);
      setItems((data.items as Notificacion[]) || []);
      setAnteriores((data.anteriores as Notificacion[]) || []);
    } catch {
      /* sin conexion: se conserva la lista anterior */
    }
  }, [token]);

  useEffect(() => {
    const primera = window.setTimeout(cargar, 0);
    const intervalo = window.setInterval(cargar, 60_000);
    const alVolver = () => {
      if (document.visibilityState === "visible") cargar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      window.clearTimeout(primera);
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [cargar]);

  /* Marca como leidas: se desvanecen, la lista se reacomoda y se guarda en el servidor (sin bitacora). */
  const marcar = useCallback(
    (lista: Notificacion[]) => {
      if (!lista.length || !token) return;
      const claves = lista.map((n) => n.clave);
      setSaliendo((prev) => new Set([...prev, ...claves]));
      const reducir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.setTimeout(
        () => {
          const ahora = new Date().toISOString();
          setLeidasLocal((prev) => new Set([...prev, ...claves]));
          setAnteriores((prev) => [...lista.map((n) => ({ ...n, leida_en: ahora })), ...prev.filter((n) => !claves.includes(n.clave))]);
          setSaliendo((prev) => new Set([...prev].filter((c) => !claves.includes(c))));
        },
        reducir ? 0 : 280,
      );
      void sendJsonAuth("POST", `${API_BASE_URL}/notificaciones/leidas`, token, { claves }).catch(() => undefined);
    },
    [token],
  );

  const abrir = (n: Notificacion) => {
    if (!n.leida_en) marcar([n]);
    setAbierta(false);
    const v = ventanaDe(n.href);
    if (v) setVentana(v);
    else router.push(n.href);
  };

  const noLeidas = (items || []).filter((n) => !leidasLocal.has(n.clave));
  const total = noLeidas.length;
  const grupos = (["Hoy", "Ayer", "Anteriores"] as const).map((dia) => [dia, noLeidas.filter((n) => diaDe(n.cuando) === dia)] as const).filter(([, l]) => l.length);

  return (
    <>
      <RadixPopover.Root
        open={abierta}
        onOpenChange={(open) => {
          setAbierta(open);
          if (open) cargar();
          else setVerAnteriores(false);
        }}
      >
        <RadixPopover.Trigger asChild>
          <button type="button" aria-label={total ? `Notificaciones: ${total} sin leer` : "Notificaciones"} className={cn("press relative inline-flex items-center justify-center text-ink-3 hover:bg-surface-3 hover:text-ink", compacta ? "h-9 w-full rounded-[9px]" : "h-8 w-8 rounded-[8px]")}>
            <Bell size={compacta ? 18 : 17} />
            {total ? (
              <span data-campana-contador className="absolute -top-0.5 -right-0.5 min-w-[16px] rounded-full bg-danger px-1 text-center text-[10px] leading-[16px] font-semibold text-on-accent animate-pop-in motion-reduce:animate-none">
                {total > 99 ? "99+" : <Conteo valor={total} duracion={400} />}
              </span>
            ) : null}
          </button>
        </RadixPopover.Trigger>
        <RadixPopover.Portal>
          <RadixPopover.Content
            data-campana-panel
            align="start"
            side={compacta ? "right" : "bottom"}
            sideOffset={8}
            collisionPadding={12}
            className="bg-popover border border-line z-[var(--z-popover)] flex max-h-[min(var(--radix-popover-content-available-height),620px)] w-[370px] max-w-[calc(100vw-24px)] flex-col rounded-[16px] shadow-panel outline-none data-[state=closed]:animate-dematerialize data-[state=open]:animate-materialize"
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
              <p className="text-[14px] font-semibold text-ink">Notificaciones</p>
              {total ? (
                <button type="button" onClick={() => marcar(noLeidas)} className="press inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-brand hover:bg-brand-faint hover:text-brand-strong">
                  <Checks size={14} /> Marcar todas como leídas
                </button>
              ) : null}
            </div>

            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
              {items === null ? (
                <p className="px-4 py-6 text-center text-[13px] text-ink-3">Cargando…</p>
              ) : !total ? (
                <div className="flex flex-col items-center gap-2 px-4 py-7 text-center">
                  <MarcaDibujada className="h-12 w-12 text-success" />
                  <p className="text-[14px] font-semibold text-ink">Estás al día</p>
                </div>
              ) : (
                grupos.map(([dia, lista]) => (
                  <section key={dia} aria-label={dia}>
                    <h3 className="px-4 pt-2.5 pb-1 text-[11.5px] font-semibold text-ink-3">{dia}</h3>
                    <ul>
                      {lista.map((n) => (
                        <FilaNotificacion key={n.clave} n={n} saliendo={saliendo.has(n.clave)} onAbrir={() => abrir(n)} onMarcar={() => marcar([n])} />
                      ))}
                    </ul>
                  </section>
                ))
              )}

              {anteriores.length ? (
                <div className="border-t border-line/70 py-1">
                  <button type="button" onClick={() => setVerAnteriores((v) => !v)} aria-expanded={verAnteriores} className="w-full px-4 py-2 text-left text-[12px] font-medium text-ink-3 hover:text-ink">
                    {verAnteriores ? "Ocultar anteriores" : `Ver anteriores (${anteriores.length})`}
                  </button>
                  {verAnteriores ? (
                    <ul className="animate-rise-in motion-reduce:animate-none">
                      {anteriores.map((n) => (
                        <FilaNotificacion key={n.clave} n={n} leida onAbrir={() => abrir(n)} />
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          </RadixPopover.Content>
        </RadixPopover.Portal>
      </RadixPopover.Root>
      <IncidenciaVentana ids={ventana?.tipo === "incidencia" ? [ventana.id] : []} indice={ventana?.tipo === "incidencia" ? 0 : null} onIndice={() => undefined} onCerrar={() => setVentana(null)} />
      <NcVentana ids={ventana?.tipo === "nc" ? [ventana.id] : []} indice={ventana?.tipo === "nc" ? 0 : null} onIndice={() => undefined} onCerrar={() => setVentana(null)} />
    </>
  );
}

/* Una notificacion: icono en circulo de color, frase corta, registro, hace X y punto azul si no esta leida. */
function FilaNotificacion({ n, leida = false, saliendo = false, onAbrir, onMarcar }: { n: Notificacion; leida?: boolean; saliendo?: boolean; onAbrir: () => void; onMarcar?: () => void }) {
  const meta = CORTO[n.grupo] || { label: n.frase, icono: <WarningDiamond weight="duotone" /> };
  return (
    <li className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-[var(--ease-spring)] motion-reduce:transition-none", saliendo ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100")}>
      <div className="group relative min-h-0 overflow-hidden">
        <button type="button" onClick={onAbrir} className={cn("flex w-full items-start gap-3 px-4 py-2.5 pr-11 text-left transition-colors duration-150 hover:bg-surface-3/70 focus-visible:bg-surface-3/70 focus-visible:outline-none", leida && "opacity-60")}>
          <span aria-hidden="true" className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[16px] [&>svg]:h-[1em] [&>svg]:w-[1em]", leida ? "bg-surface-3 text-ink-3" : TONO[n.tono].circulo)}>
            {meta.icono}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[13.5px] leading-snug font-medium text-ink">{n.frase}</span>
            <span className="truncate text-[12.5px] text-ink-2">{n.registro}</span>
            <span className="truncate text-[11.5px] text-ink-3">
              {/* Una fecha sola (p. ej. un vencimiento) no da "hace X": haceCuantoCorto devuelve "—" y se omite. */}
              {[n.detalle, n.cuando ? haceCuantoCorto(n.cuando) : null].filter((parte) => parte && parte !== "—").join(" · ")}
            </span>
          </span>
          {!leida ? <span aria-label="Sin leer" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" /> : null}
        </button>
        {onMarcar && !leida ? (
          <button
            type="button"
            onClick={onMarcar}
            aria-label={`Marcar como leída: ${n.frase} ${n.registro}`}
            title="Marcar como leída"
            className="press absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-surface text-ink-3 opacity-0 shadow-card transition-opacity duration-150 group-hover:opacity-100 hover:text-brand focus-visible:opacity-100 focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none"
          >
            <Check size={14} weight="bold" />
          </button>
        ) : null}
      </div>
    </li>
  );
}
