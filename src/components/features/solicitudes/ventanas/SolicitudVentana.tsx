"use client";

import Link from "next/link";
import { ArrowRight, CalendarBlank, ClockCounterClockwise, FolderSimple, Prohibit, Quotes, SealCheck, Stamp, XCircle } from "@phosphor-icons/react";
import { describirSolicitud, hrefDeSolicitud, NOMBRE_GRUPO, GRUPO_DE_ENTIDAD } from "@/components/features/solicitudes/Solicitudes";
import { Button } from "@/components/ui/Button";
import { FiguraPersona } from "@/components/ui/FiguraPersona";
import { Badge, type Tone } from "@/components/ui/Primitives";
import { DatosRapidos, VentanaAcciones, VentanaCentrada, VentanaEncabezado, VentanaSeccion, VentanaTarjeta, VentanaTitulo } from "@/components/ui/Ventana";
import { haceCuantoCorto } from "@/lib/client/tiempo";
import type { ApiRecord } from "@/lib/client/types";
import { ETIQUETA_ESTADO_SOLICITUD, type EstadoSolicitud } from "@/lib/shared/acciones-criticas";
import { formatearFechaCorta, formatearFechaHora } from "@/lib/shared/fechas";

/*
 * "Por autorizar" con el patron lista -> ventana: la ventana cuenta la
 * solicitud en palabras simples (que se pide, sobre que registro, quien y por
 * que) y ofrece Aprobar / Rechazar a quien puede resolverla o Cancelar a quien
 * la pidio, con los dialogos de siempre (useAccionesSolicitud).
 */

const TONO_ESTADO: Record<string, Tone> = { pendiente: "warning", aprobada: "success", rechazada: "danger", cancelada: "neutral", vencida: "neutral" };

export function EstadoSolicitudBadge({ estado }: { estado: unknown }) {
  const key = String(estado || "") as EstadoSolicitud;
  return (
    <Badge tone={TONO_ESTADO[key] || "neutral"} dot>
      {ETIQUETA_ESTADO_SOLICITUD[key] || key || "—"}
    </Badge>
  );
}

export interface AccionesSolicitud {
  aprobar: (sol: ApiRecord) => void;
  rechazar: (sol: ApiRecord) => void | Promise<void>;
  cancelar: (sol: ApiRecord) => void | Promise<void>;
}

export function SolicitudVentana({ items, indice, onIndice, onCerrar, acciones }: { items: ApiRecord[]; indice: number | null; onIndice: (indice: number) => void; onCerrar: () => void; acciones: AccionesSolicitud }) {
  const sol = indice !== null ? items[indice] : undefined;
  const mover = (paso: number) => {
    if (indice === null) return;
    const siguiente = indice + paso;
    if (siguiente >= 0 && siguiente < items.length) onIndice(siguiente);
  };
  return (
    <VentanaCentrada abierta={!!sol} onCerrar={onCerrar} onMover={mover} puedeAnterior={indice !== null && indice > 0} puedeSiguiente={indice !== null && indice < items.length - 1} etiquetaAnterior="Solicitud anterior" etiquetaSiguiente="Solicitud siguiente">
      {sol ? <FichaSolicitud key={String(sol.id)} sol={sol} acciones={acciones} onIr={onCerrar} /> : <VentanaTitulo className="sr-only">Solicitud</VentanaTitulo>}
    </VentanaCentrada>
  );
}

function FichaSolicitud({ sol, acciones, onIr }: { sol: ApiRecord; acciones: AccionesSolicitud; onIr: () => void }) {
  const pendiente = String(sol.estado || "pendiente") === "pendiente";
  const href = hrefDeSolicitud(sol);
  const quien = String(sol.solicitado_nombre || "Otra persona");
  const registro = String(sol.referencia || "un registro");
  const que = describirSolicitud(sol);
  const area = NOMBRE_GRUPO[GRUPO_DE_ENTIDAD[String(sol.entidad)]] || "Plataforma";
  return (
    <div className="flex flex-col gap-5" data-solicitud-ventana={String(sol.id)}>
      <VentanaEncabezado
        figura={
          <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-warning-soft text-warning-text">
            <Stamp size={28} weight="duotone" />
          </span>
        }
        titulo={String(sol.etiqueta || "Solicitud")}
        insignia={<EstadoSolicitudBadge estado={sol.estado} />}
        subtitulo={que !== String(sol.etiqueta) ? que : `Sobre ${registro}`}
      />

      <DatosRapidos
        datos={[
          { icono: <FolderSimple size={17} weight="duotone" />, etiqueta: "Registro", valor: registro },
          { icono: <ClockCounterClockwise size={17} weight="duotone" />, etiqueta: "Pedida", valor: haceCuantoCorto(sol.solicitado_en), titulo: formatearFechaHora(sol.solicitado_en) },
          pendiente
            ? { icono: <CalendarBlank size={17} weight="duotone" />, etiqueta: "Vence", valor: formatearFechaCorta(sol.vence_en), tono: "warning" as const }
            : { icono: <SealCheck size={17} weight="duotone" />, etiqueta: "Resuelta", valor: sol.resuelto_en ? formatearFechaCorta(sol.resuelto_en) : "—" },
          { icono: <Stamp size={17} weight="duotone" />, etiqueta: "Área", valor: area },
        ]}
      />

      <VentanaSeccion titulo="Qué se pide" i={0}>
        <p className="text-[14.5px] leading-[1.55] text-ink">
          {quien} pidió <span className="font-medium">{que.charAt(0).toLowerCase() + que.slice(1)}</span> sobre {registro}.{" "}
          {pendiente ? "La acción no se hace hasta que otra persona autorizada la apruebe; quien la pidió no puede aprobarla." : null}
        </p>
      </VentanaSeccion>

      <VentanaSeccion titulo="Quién la pidió" i={1}>
        <FiguraPersona id={sol.solicitado_por} nombre={sol.solicitado_nombre} size="md" conNombre subtitulo={sol.solicitado_rol ? `Como ${String(sol.solicitado_rol)}` : undefined} />
      </VentanaSeccion>

      <VentanaSeccion titulo="Motivo" i={2}>
        <blockquote className="flex gap-2.5 rounded-[12px] bg-warning-soft/70 px-3.5 py-3 text-[14.5px] leading-[1.5] text-ink ring-1 ring-warning/15">
          <Quotes size={16} weight="fill" className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
          <p className="whitespace-pre-line">{String(sol.motivo || "Sin motivo")}</p>
        </blockquote>
      </VentanaSeccion>

      {!pendiente ? (
        <VentanaSeccion titulo="Cómo se resolvió" i={3}>
          <VentanaTarjeta>
            <p className="text-[14px] text-ink">
              {ETIQUETA_ESTADO_SOLICITUD[String(sol.estado) as EstadoSolicitud] || String(sol.estado)}
              {sol.resuelto_nombre ? ` por ${String(sol.resuelto_nombre)}` : ""}
              {sol.resuelto_en ? ` el ${formatearFechaHora(sol.resuelto_en)}` : ""}.
            </p>
            {sol.motivo_resolucion ? <p className="mt-1 whitespace-pre-line text-[13.5px] text-ink-2">{String(sol.motivo_resolucion)}</p> : null}
          </VentanaTarjeta>
        </VentanaSeccion>
      ) : null}

      <VentanaAcciones>
        {pendiente && sol.puedo_aprobar ? (
          <>
            <Button icon={<Stamp size={15} />} onClick={() => acciones.aprobar(sol)}>
              Aprobar
            </Button>
            <Button variant="secondary" icon={<XCircle size={15} />} onClick={() => acciones.rechazar(sol)}>
              Rechazar
            </Button>
          </>
        ) : null}
        {pendiente && sol.puedo_cancelar ? (
          <Button variant="secondary" icon={<Prohibit size={15} />} onClick={() => acciones.cancelar(sol)}>
            Cancelar solicitud
          </Button>
        ) : null}
        {href ? (
          <Link href={href} onClick={onIr} className="press inline-flex h-9 items-center gap-1.5 rounded-[9px] px-3 text-[13.5px] font-medium text-brand hover:bg-brand-faint">
            Ver el registro <ArrowRight size={14} weight="bold" />
          </Link>
        ) : null}
      </VentanaAcciones>
    </div>
  );
}
