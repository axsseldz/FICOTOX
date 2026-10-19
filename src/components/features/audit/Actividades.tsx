"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarBlank, ChatCenteredText, MapPin, Quotes, User } from "@phosphor-icons/react";
import { useSession } from "@/components/session/SessionProvider";
import { VentanaCentrada, VentanaTitulo } from "@/components/ui/VentanaCentrada";
import { ColumnasVentana, DatoLateral, TarjetaLateral, VentanaEncabezado, VentanaSeccion } from "@/components/ui/Ventana";
import { FiguraPersona } from "@/components/ui/FiguraPersona";
import { cn } from "@/components/ui/cn";
import { datosPrincipales, dayLabel, fechaYHora, haceCuanto, humanizeAuditEntry, timeLabel, type ContextoActividad, type HumanEntry } from "@/lib/client/audit-humanize";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import type { ApiRecord } from "@/lib/client/types";
import { EntryIcon, IconoArea } from "./categorias";
import { buttonClass } from "@/components/ui/Button";

/*
 * Lista de actividades de la bitacora y su detalle, iguales en Calidad ›
 * Auditoría y en el historial de cada registro. Lenguaje simple y nada que
 * parezca codigo. Las repeticiones seguidas (misma persona, misma accion,
 * mismo registro, en pocos minutos) se muestran como un solo renglon
 * "· 4 veces"; es solo visual: en la bitacora siguen siendo entradas
 * individuales.
 */

/* Minutos entre repeticiones para agruparlas en un renglon. */
const MINUTOS_REPETICION = 10;

export interface GrupoActividad {
  /* La mas reciente primero. */
  entradas: HumanEntry[];
  registros: ApiRecord[];
}

/* Agrupa repeticiones seguidas (la lista viene de la mas reciente a la mas antigua). */
export function agruparActividades(registros: ApiRecord[], ctx: ContextoActividad = {}): GrupoActividad[] {
  const grupos: GrupoActividad[] = [];
  for (const record of registros) {
    const entry = humanizeAuditEntry(record, ctx);
    const ultimo = grupos[grupos.length - 1];
    const previa = ultimo?.entradas[ultimo.entradas.length - 1];
    const cerca = previa?.when && entry.when ? Math.abs(previa.when.getTime() - entry.when.getTime()) <= MINUTOS_REPETICION * 60_000 : false;
    if (ultimo && previa && previa.claveGrupo === entry.claveGrupo && cerca && !entry.cambios.length && !previa.cambios.length) {
      ultimo.entradas.push(entry);
      ultimo.registros.push(record);
    } else grupos.push({ entradas: [entry], registros: [record] });
  }
  return grupos;
}

/* Grupos por dia ("Hoy", "Ayer", "Miércoles 24 de septiembre"). */
function porDia(grupos: GrupoActividad[]): Array<[string, GrupoActividad[]]> {
  const dias = new Map<string, GrupoActividad[]>();
  for (const grupo of grupos) {
    const dia = dayLabel(grupo.entradas[0].when);
    dias.set(dia, [...(dias.get(dia) || []), grupo]);
  }
  return [...dias.entries()];
}

/* Nombres de las cuentas (para decir "Mariana" y no un numero). Se piden una vez por sesion. */
let personasCache: Promise<Map<number, string>> | null = null;
export function usePersonas(): Map<number, string> | undefined {
  const { token } = useSession();
  const [personas, setPersonas] = useState<Map<number, string>>();
  useEffect(() => {
    if (!token) return;
    let cancelado = false;
    if (!personasCache) {
      personasCache = getJsonAuth(`${API_BASE_URL}/cuentas/activas`, token)
        .then((data) => new Map(((data.items || []) as ApiRecord[]).map((c) => [Number(c.id), String(c.nombre || c.email)])))
        .catch(() => {
          personasCache = null;
          return new Map<number, string>();
        });
    }
    void personasCache.then((mapa) => !cancelado && setPersonas(mapa));
    return () => {
      cancelado = true;
    };
  }, [token]);
  return personas;
}

/* Un renglon: icono, la frase en una linea y debajo la hora y el area. */
function FilaActividad({ grupo, activa, onAbrir }: { grupo: GrupoActividad; activa?: boolean; onAbrir: () => void }) {
  const entry = grupo.entradas[0];
  const veces = grupo.entradas.length;
  const conMotivo = grupo.entradas.some((e) => e.motivo);
  return (
    <li>
      <button
        type="button"
        data-actividad={entry.id}
        onClick={onAbrir}
        aria-haspopup="dialog"
        className={cn(
          "flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 outline-none sm:px-5",
          "hover:bg-surface-2 focus-visible:bg-surface-2 foco-interior",
          activa && "bg-brand-faint hover:bg-brand-faint",
        )}
      >
        <EntryIcon entry={entry} size="sm" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-base leading-snug break-words text-ink">
            {entry.frase}
            {veces > 1 ? <span className="text-ink-3"> · {veces} veces</span> : null}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-ink-3">
            <span>
              {timeLabel(entry.when)} · {entry.area}
            </span>
            {conMotivo ? <ChatCenteredText size={13} weight="fill" className="text-ink-4" aria-label="Tiene motivo" /> : null}
          </span>
        </span>
      </button>
    </li>
  );
}

/* Lista agrupada por dia. */
export function ListaActividades({ grupos, seleccion, onAbrir }: { grupos: GrupoActividad[]; seleccion?: number | null; onAbrir: (indice: number) => void }) {
  const dias = useMemo(() => porDia(grupos), [grupos]);
  const indice = useMemo(() => new Map(grupos.map((g, i) => [g, i])), [grupos]);
  return (
    <>
      {dias.map(([dia, lista]) => (
        <section key={dia} aria-label={dia}>
          <h2 className="material sticky top-0 z-[2] border-b border-line px-4 py-1.5 text-xs font-semibold text-ink-3">{dia}</h2>
          <ul className="divide-y divide-line">
            {lista.map((grupo) => (
              <FilaActividad key={grupo.entradas[0].id} grupo={grupo} activa={seleccion !== null && seleccion !== undefined && grupos[seleccion] === grupo} onAbrir={() => onAbrir(indice.get(grupo)!)} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/* Detalle en la ventana centrada compartida (VentanaCentrada). */
export function ActividadDialog({ grupos, indice, onIndice, onCerrar }: { grupos: GrupoActividad[]; indice: number | null; onIndice: (indice: number) => void; onCerrar: () => void }) {
  const grupo = indice !== null ? grupos[indice] : undefined;
  const mover = (paso: number) => {
    if (indice === null) return;
    const siguiente = indice + paso;
    if (siguiente >= 0 && siguiente < grupos.length) onIndice(siguiente);
  };
  return (
    <VentanaCentrada media abierta={!!grupo} onCerrar={onCerrar} onMover={mover} puedeAnterior={indice !== null && indice > 0} puedeSiguiente={indice !== null && indice < grupos.length - 1} etiquetaAnterior="Actividad anterior" etiquetaSiguiente="Actividad siguiente">
      {grupo ? <DetalleActividad key={grupo.entradas[0].id} grupo={grupo} onIr={onCerrar} /> : <VentanaTitulo className="sr-only">Actividad</VentanaTitulo>}
    </VentanaCentrada>
  );
}

/* Secciones del detalle: las compartidas de la ventana (titulo discreto y entrada escalonada por `i`). */
function Seccion({ titulo, i, children }: { titulo: string; i: number; children: React.ReactNode }) {
  return (
    <VentanaSeccion titulo={titulo} i={i}>
      {children}
    </VentanaSeccion>
  );
}

/* Contenido del detalle: titulo, quien y cuando, que paso, que cambio, motivo y "Ver el registro". */
function DetalleActividad({ grupo, onIr }: { grupo: GrupoActividad; onIr: () => void }) {
  const { token, can } = useSession();
  const personas = usePersonas();
  const record = grupo.registros[0];
  const base = grupo.entradas[0];
  const [datos, setDatos] = useState<ContextoActividad["datos"]>(null);
  // Los datos completos (registro nuevo, unidades) solo para quien consulta la bitacora general.
  const necesitaDatos = can("calidad", "V") && !record.datos_restringidos && ["crear", "editar", "reponer"].includes(base.verb);
  useEffect(() => {
    if (!necesitaDatos || !token) return;
    let cancelado = false;
    getJsonAuth(`${API_BASE_URL}/audit/${base.id}`, token)
      .then((data) => {
        const item = (data.item || {}) as ApiRecord;
        if (!cancelado) setDatos({ antes: (item.datos_anteriores as ApiRecord | null) || null, nuevos: (item.datos_nuevos as ApiRecord | null) || null });
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [necesitaDatos, token, base.id]);
  const entry = useMemo(() => humanizeAuditEntry(record, { personas, datos }), [record, personas, datos]);
  const principales = entry.verb === "crear" ? datosPrincipales(entry.entidad, datos?.nuevos, { personas }) : [];
  const motivos = [...new Set(grupo.entradas.map((e) => e.motivo).filter((m): m is string => !!m))];
  const veces = grupo.entradas.length;

  return (
    <article className="flex flex-col gap-6" data-actividad-detalle={entry.id}>
      <VentanaEncabezado
        figura={<EntryIcon entry={entry} size="lg" />}
        titulo={
          <>
            {entry.frase}
            {veces > 1 ? <span className="font-normal text-ink-3"> · {veces} veces</span> : null}
          </>
        }
        subtitulo={
          <span className="text-ink-2">
            {!entry.isSystem && entry.actor ? (
              <>
                <span className="font-medium text-ink">{entry.actor}</span>
                {entry.cargo ? <span> · {entry.cargo}</span> : null}
                <br />
              </>
            ) : null}
            <span>{fechaYHora(entry.when)}</span>
            <span className="text-ink-3"> · {haceCuanto(entry.when)}</span>
          </span>
        }
      />

      <ColumnasVentana
        principal={
          <>
            <Seccion titulo="Qué pasó" i={1}>
              <p className="text-base leading-normal text-ink">{entry.quePaso}</p>
              {veces > 1 ? (
                <p className="text-sm text-ink-2">
                  Lo hizo {veces} veces seguidas, a las {grupo.entradas.map((e) => timeLabel(e.when)).reverse().join(", ").replace(/, ([^,]*)$/, " y $1")}.
                </p>
              ) : null}
            </Seccion>

            {entry.cambios.length ? (
              <Seccion titulo="Qué cambió" i={2}>
                <ul className="flex flex-col gap-1.5 text-base leading-normal text-ink">
                  {entry.cambios.map((frase) => (
                    <li key={frase} className="flex gap-2">
                      <span aria-hidden="true" className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand/60" />
                      <span>{frase}</span>
                    </li>
                  ))}
                </ul>
              </Seccion>
            ) : principales.length ? (
              <Seccion titulo="Qué cambió" i={3}>
                <p className="text-base text-ink">Se registró con estos datos principales:</p>
                <dl className="grid gap-x-4 gap-y-1.5 rounded-box bg-surface-2 px-3.5 py-3 text-sm ring-1 ring-line sm:grid-cols-[max-content_minmax(0,1fr)]">
                  {principales.map((dato) => (
                    <div key={dato.etiqueta} className="contents">
                      <dt className="text-ink-3">{dato.etiqueta}</dt>
                      <dd className="text-ink">{dato.valor}</dd>
                    </div>
                  ))}
                </dl>
              </Seccion>
            ) : null}

            {motivos.length ? (
              <Seccion titulo="Motivo" i={4}>
                {motivos.map((motivo) => (
                  <blockquote key={motivo} className="flex gap-2.5 rounded-box bg-warning-soft/70 px-3.5 py-3 text-base leading-normal text-ink ring-1 ring-warning/15">
                    <Quotes size={16} weight="fill" className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                    <p className="whitespace-pre-line">{motivo}</p>
                  </blockquote>
                ))}
              </Seccion>
            ) : null}
          </>
        }
        lateral={
          <>
            <TarjetaLateral icono={<User size={15} weight="duotone" />} titulo="Quién" i={0}>
              {!entry.isSystem && entry.actor ? <FiguraPersona nombre={entry.actor} size="md" conNombre subtitulo={entry.cargo || undefined} /> : <p className="text-base text-ink">La plataforma, por su cuenta</p>}
            </TarjetaLateral>
            <TarjetaLateral icono={<CalendarBlank size={15} weight="duotone" />} titulo="Cuándo" i={1}>
              <DatoLateral etiqueta="Fecha y hora">{fechaYHora(entry.when)}</DatoLateral>
              <span className="text-xs text-ink-3">{haceCuanto(entry.when)}</span>
            </TarjetaLateral>
            <TarjetaLateral icono={<MapPin size={15} weight="duotone" />} titulo="Dónde" i={2}>
              <span className="flex items-center gap-3">
                <IconoArea entidad={entry.entidad} />
                <span className="flex min-w-0 flex-col">
                  <span className="text-base font-medium text-ink">{entry.area}</span>
                  {entry.reference ? <span className="break-words text-xs text-ink-3">{entry.reference}</span> : null}
                </span>
              </span>
              {entry.href ? (
                <Link href={entry.href} onClick={onIr} className={buttonClass({ className: "mt-1 w-fit" })}>
                  Ver el registro <ArrowRight size={14} weight="bold" />
                </Link>
              ) : null}
            </TarjetaLateral>
          </>
        }
      />
    </article>
  );
}
