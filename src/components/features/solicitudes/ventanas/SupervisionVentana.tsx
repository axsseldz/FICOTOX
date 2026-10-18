"use client";

import Link from "next/link";
import { ArrowRight, ArrowUUpLeft, ClockCounterClockwise, Eye, FolderSimple, PencilSimple, Quotes, SealCheck, UserCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { FiguraPersona } from "@/components/ui/FiguraPersona";
import { Badge } from "@/components/ui/Primitives";
import { DatosRapidos, VentanaAcciones, VentanaCentrada, VentanaEncabezado, VentanaSeccion, VentanaTitulo } from "@/components/ui/Ventana";
import { haceCuantoCorto } from "@/lib/client/tiempo";
import type { ApiRecord } from "@/lib/client/types";
import { formatearFechaHora } from "@/lib/shared/fechas";

/*
 * "Por supervisar" con el patron lista -> ventana. Cada elemento es lo que una
 * persona supervisada capturo (pendiente de visto bueno) o lo que te regresaron
 * con observaciones. La ventana lo cuenta en palabras simples y ofrece Dar
 * visto bueno / Regresar (useAccionesSupervision, los dialogos de siempre) o
 * Corregir, y "Abrir formato completo".
 */

export type ElementoSupervision = ApiRecord & { clase: "pendiente" | "regresado" };

export interface AccionesSupervision {
  vistoBueno: (x: { tabla: string; id: unknown; tipo: string; referencia: string }) => void;
  regresar: (x: { tabla: string; id: unknown; tipo: string; referencia: string }) => void | Promise<void>;
}

export function SupervisionVentana({ items, indice, onIndice, onCerrar, acciones }: { items: ElementoSupervision[]; indice: number | null; onIndice: (indice: number) => void; onCerrar: () => void; acciones: AccionesSupervision }) {
  const item = indice !== null ? items[indice] : undefined;
  const mover = (paso: number) => {
    if (indice === null) return;
    const siguiente = indice + paso;
    if (siguiente >= 0 && siguiente < items.length) onIndice(siguiente);
  };
  return (
    <VentanaCentrada abierta={!!item} onCerrar={onCerrar} onMover={mover} puedeAnterior={indice !== null && indice > 0} puedeSiguiente={indice !== null && indice < items.length - 1} etiquetaAnterior="Registro anterior" etiquetaSiguiente="Registro siguiente">
      {item ? <FichaSupervision key={`${item.clase}-${String(item.tabla)}-${String(item.id)}`} item={item} acciones={acciones} onIr={onCerrar} /> : <VentanaTitulo className="sr-only">Supervisión</VentanaTitulo>}
    </VentanaCentrada>
  );
}

function FichaSupervision({ item, acciones, onIr }: { item: ElementoSupervision; acciones: AccionesSupervision; onIr: () => void }) {
  const pendiente = item.clase === "pendiente";
  const registro = `${String(item.tipo || "Registro")} ${String(item.referencia || "")}`.trim();
  const datos = { tabla: String(item.tabla), id: item.id, tipo: String(item.tipo || ""), referencia: String(item.referencia || "") };
  const href = item.href ? String(item.href) : null;
  return (
    <div className="flex flex-col gap-5" data-supervision-ventana={`${String(item.tabla)}-${String(item.id)}`}>
      <VentanaEncabezado
        figura={
          <span aria-hidden="true" className={pendiente ? "flex h-14 w-14 items-center justify-center rounded-[16px] bg-warning-soft text-warning-text" : "flex h-14 w-14 items-center justify-center rounded-[16px] bg-danger-soft text-danger"}>
            {pendiente ? <Eye size={28} weight="duotone" /> : <ArrowUUpLeft size={28} weight="duotone" />}
          </span>
        }
        titulo={registro}
        insignia={
          <Badge tone={pendiente ? "warning" : "danger"} dot>
            {pendiente ? "Pendiente de visto bueno" : "Regresado"}
          </Badge>
        }
        subtitulo={pendiente ? "Lo capturó una persona que supervisas" : "Tu supervisor lo regresó para que lo corrijas"}
      />

      <DatosRapidos
        datos={[
          { icono: <FolderSimple size={17} weight="duotone" />, etiqueta: "Registro", valor: String(item.tipo || "Registro") },
          ...(pendiente ? [{ icono: <UserCircle size={17} weight="duotone" />, etiqueta: "Capturó", valor: String(item.solicitado_por || "—") }] : []),
          { icono: <ClockCounterClockwise size={17} weight="duotone" />, etiqueta: "Desde", valor: item.solicitado_en ? haceCuantoCorto(item.solicitado_en) : "—", titulo: item.solicitado_en ? formatearFechaHora(item.solicitado_en) : undefined },
        ]}
      />

      <VentanaSeccion titulo="Qué pasa" i={0}>
        <p className="text-[14.5px] leading-[1.55] text-ink">
          {pendiente
            ? `${String(item.solicitado_por || "Una persona supervisada")} capturó ${registro}. No avanza (no se cierra, no se revisa ni aprueba y no sirve de origen) hasta que des tu visto bueno o lo regreses con observaciones.`
            : `Te regresaron ${registro} con observaciones. Corrígelo en su formato; después tu supervisor volverá a revisarlo.`}
        </p>
      </VentanaSeccion>

      {pendiente && item.solicitado_por ? (
        <VentanaSeccion titulo="Quién lo capturó" i={1}>
          <FiguraPersona nombre={item.solicitado_por} size="md" conNombre />
        </VentanaSeccion>
      ) : null}

      {!pendiente && item.observaciones ? (
        <VentanaSeccion titulo="Observaciones del supervisor" i={1}>
          <blockquote className="flex gap-2.5 rounded-[12px] bg-danger-soft/50 px-3.5 py-3 text-[14.5px] leading-[1.5] text-ink ring-1 ring-danger/15">
            <Quotes size={16} weight="fill" className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
            <p className="whitespace-pre-line">{String(item.observaciones)}</p>
          </blockquote>
        </VentanaSeccion>
      ) : null}

      <VentanaAcciones>
        {pendiente ? (
          <>
            <Button icon={<SealCheck size={15} />} onClick={() => acciones.vistoBueno(datos)}>
              Dar visto bueno
            </Button>
            <Button variant="secondary" icon={<ArrowUUpLeft size={15} />} onClick={() => acciones.regresar(datos)}>
              Regresar
            </Button>
          </>
        ) : href ? (
          <Link href={href} onClick={onIr} className="press inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-brand px-3.5 text-[13.5px] font-medium text-on-accent hover:bg-brand-strong">
            <PencilSimple size={15} /> Corregir
          </Link>
        ) : null}
        {href ? (
          <Link href={href} onClick={onIr} className="press inline-flex h-9 items-center gap-1.5 rounded-[9px] px-3 text-[13.5px] font-medium text-brand hover:bg-brand-faint">
            Abrir formato completo <ArrowRight size={14} weight="bold" />
          </Link>
        ) : null}
      </VentanaAcciones>
    </div>
  );
}
