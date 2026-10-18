"use client";

import Link from "next/link";
import { CalendarBlank, CheckCircle, PencilSimple, Prohibit, Toolbox, User, Wrench } from "@phosphor-icons/react";
import { MANTENIMIENTO_ESTADOS, MANTENIMIENTO_TIPOS, metaFor } from "@/components/features/inventory/meta";
import { ReporteMantenimientoPdf } from "@/components/features/inventory/ReporteMantenimientoPdf";
import { Button } from "@/components/ui/Button";
import { FiguraPersona } from "@/components/ui/FiguraPersona";
import { Badge } from "@/components/ui/Primitives";
import { ColumnasVentana, DatoLateral, DatosLista, DatosRapidos, TarjetaLateral, VentanaAcciones, VentanaCentrada, VentanaEncabezado, VentanaSeccion, VentanaTarjeta, VentanaTitulo } from "@/components/ui/Ventana";
import { fmt } from "@/lib/client/format";
import { cantidadMovimiento, fechaDelMovimiento, origenDeMovimiento, esEntrada, tipoMovimiento, IconoEquipo, IconoMantenimiento, IconoMovimientoInsumo, IconoOrigen, moverEn } from "./comun";
import { cn } from "@/components/ui/cn";
import { haceCuantoCorto } from "@/lib/client/tiempo";
import type { ApiRecord } from "@/lib/client/types";
import { formatearFecha, formatearFechaCorta, formatearFechaHora, formatearHora, hoyLocal } from "@/lib/shared/fechas";

/*
 * Ventanas de Mantenimiento (detalle de un mantenimiento con sus acciones de
 * siempre: Editar y Cancelar, y su reporte de servicio en PDF) y de Movimientos (detalle de una entrada o
 * salida con el registro de origen enlazado).
 */

const mantenimientoVencido = (m: ApiRecord) => m.estado === "vencido" || (["programado", "en_proceso"].includes(String(m.estado)) && String(m.fecha_programada || "").slice(0, 10) < hoyLocal());

export function MantenimientoVentana({ items, indice, onIndice, onCerrar, puedeEditar, puedeCancelar, puedeAdjuntar, editar, cancelar }: { items: ApiRecord[]; indice: number | null; onIndice: (i: number) => void; onCerrar: () => void; puedeEditar: boolean; puedeCancelar: boolean; /* Adjuntar, reemplazar o quitar el reporte PDF (quien registra o edita mantenimientos). */ puedeAdjuntar: boolean; editar: (m: ApiRecord) => void; cancelar: (m: ApiRecord) => void }) {
  const m = indice !== null ? items[indice] : undefined;
  const mover = (paso: number) => {
    const siguiente = moverEn(indice, items.length, paso);
    if (siguiente !== null) onIndice(siguiente);
  };
  return (
    <VentanaCentrada amplia abierta={!!m} onCerrar={onCerrar} onMover={mover} puedeAnterior={indice !== null && indice > 0} puedeSiguiente={indice !== null && indice < items.length - 1} etiquetaAnterior="Anterior" etiquetaSiguiente="Siguiente">
      {m ? (
        <div key={String(m.id)} className="flex flex-col gap-6" data-mantenimiento-ventana={String(m.id)}>
          <VentanaEncabezado
            figura={<IconoMantenimiento tipo={m.tipo} vencido={mantenimientoVencido(m)} grande />}
            titulo={`${metaFor(MANTENIMIENTO_TIPOS, m.tipo).label} · ${String(m.equipo || "Equipo")}`}
            insignia={
              <>
                <Badge tone={metaFor(MANTENIMIENTO_ESTADOS, m.estado).tone} dot>
                  {metaFor(MANTENIMIENTO_ESTADOS, m.estado).label}
                </Badge>
                {mantenimientoVencido(m) && m.estado !== "vencido" ? <Badge tone="danger">Fecha pasada</Badge> : null}
              </>
            }
            subtitulo={[m.equipo_marca, m.equipo_modelo].filter(Boolean).join(" · ") || undefined}
          />
          <DatosRapidos
            datos={[
              { icono: <CalendarBlank size={17} weight="duotone" />, etiqueta: "Programado", valor: formatearFechaCorta(m.fecha_programada), tono: mantenimientoVencido(m) ? "danger" : "brand" },
              { icono: <CheckCircle size={17} weight="duotone" />, etiqueta: "Realizado", valor: m.fecha_realizado ? formatearFechaCorta(m.fecha_realizado) : "Aún no", tono: m.fecha_realizado ? "success" : "neutral" },
              { icono: <Wrench size={17} weight="duotone" />, etiqueta: "Técnico", valor: m.tecnico_proveedor ? String(m.tecnico_proveedor) : "—" },
              { icono: <User size={17} weight="duotone" />, etiqueta: "Responsable", valor: m.responsable ? String(m.responsable) : "—" },
            ]}
          />
          <ColumnasVentana
            principal={
              <>
                <VentanaSeccion titulo="Observaciones" i={1}>
                  <VentanaTarjeta>
                    <p className="whitespace-pre-line text-[14px] text-ink">{m.observaciones ? String(m.observaciones) : "Sin observaciones."}</p>
                  </VentanaTarjeta>
                </VentanaSeccion>
                <VentanaSeccion titulo="Reporte de servicio (PDF)" i={2}>
                  <ReporteMantenimientoPdf
                    mantenimientoId={Number(m.id)}
                    puedeGestionar={puedeAdjuntar}
                    // El visor va sobre la plataforma: la ventana se cierra mientras se lee y vuelve al cerrarlo.
                    alVer={onCerrar}
                    alCerrarVisor={indice !== null ? () => onIndice(indice) : undefined}
                  />
                </VentanaSeccion>
              </>
            }
            lateral={
              <>
                <TarjetaLateral icono={<Toolbox size={15} weight="duotone" />} titulo="Equipo" i={0}>
                  <span className="flex items-center gap-3">
                    <IconoEquipo nombre={m.equipo} />
                    <span className="flex min-w-0 flex-col">
                      <span className="break-words text-[14px] font-medium text-ink">{String(m.equipo || "Equipo sin nombre")}</span>
                      {m.equipo_marca || m.equipo_modelo ? <span className="text-[12.5px] text-ink-3">{[m.equipo_marca, m.equipo_modelo].filter(Boolean).join(" · ")}</span> : null}
                    </span>
                  </span>
                  <Link href={`/inventario/equipos?buscar=${encodeURIComponent(String(m.equipo || ""))}`} className="text-[13px] font-medium text-brand hover:underline">
                    Ver el equipo
                  </Link>
                </TarjetaLateral>
                <TarjetaLateral icono={<CalendarBlank size={15} weight="duotone" />} titulo="Fechas" tono={mantenimientoVencido(m) ? "danger" : "neutral"} i={1}>
                  <DatoLateral etiqueta="Programado">{formatearFecha(m.fecha_programada)}</DatoLateral>
                  <DatoLateral etiqueta="Realizado">{m.fecha_realizado ? formatearFecha(m.fecha_realizado) : "Todavía no"}</DatoLateral>
                </TarjetaLateral>
                <TarjetaLateral icono={<User size={15} weight="duotone" />} titulo="Quién lo atiende" i={2}>
                  <DatoLateral etiqueta="Técnico o proveedor">{m.tecnico_proveedor ? String(m.tecnico_proveedor) : "Sin asignar"}</DatoLateral>
                  {m.responsable || m.id_responsable ? <FiguraPersona id={m.id_responsable} nombre={m.responsable} size="md" conNombre subtitulo="Responsable" /> : null}
                </TarjetaLateral>
              </>
            }
          />
          {puedeEditar || (puedeCancelar && m.estado !== "cancelado") ? (
            <VentanaAcciones>
              {puedeEditar ? (
                <Button icon={<PencilSimple size={16} />} onClick={() => editar(m)}>
                  Editar
                </Button>
              ) : null}
              {puedeCancelar && m.estado !== "cancelado" ? (
                <Button variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" icon={<Prohibit size={16} />} onClick={() => cancelar(m)}>
                  Cancelar mantenimiento
                </Button>
              ) : null}
            </VentanaAcciones>
          ) : null}
        </div>
      ) : (
        <VentanaTitulo className="sr-only">Mantenimiento</VentanaTitulo>
      )}
    </VentanaCentrada>
  );
}

export const nombreInsumo = (m: ApiRecord) => String(m.item_nombre || m.item_codigo || "Insumo sin nombre");

export function MovimientoVentana({ items, indice, onIndice, onCerrar }: { items: ApiRecord[]; indice: number | null; onIndice: (i: number) => void; onCerrar: () => void }) {
  const m = indice !== null ? items[indice] : undefined;
  const mover = (paso: number) => {
    const siguiente = moverEn(indice, items.length, paso);
    if (siguiente !== null) onIndice(siguiente);
  };
  return (
    <VentanaCentrada abierta={!!m} onCerrar={onCerrar} onMover={mover} puedeAnterior={indice !== null && indice > 0} puedeSiguiente={indice !== null && indice < items.length - 1} etiquetaAnterior="Movimiento anterior" etiquetaSiguiente="Movimiento siguiente">
      {m ? <FichaMovimiento key={String(m.id)} m={m} /> : <VentanaTitulo className="sr-only">Movimiento</VentanaTitulo>}
    </VentanaCentrada>
  );
}

/*
 * Ficha de un movimiento, en una sola columna ordenada: el insumo con su
 * figura y la flecha de entrada o salida; la cantidad grande con signo y
 * color; los datos (insumo, codigo, motivo, cuando) y el registro de origen
 * enlazado con su icono.
 */
function FichaMovimiento({ m }: { m: ApiRecord }) {
  const entrada = esEntrada(m);
  const origen = origenDeMovimiento(m);
  const tipoInsumo = m.tabla_origen === "reactivos" ? "Reactivo" : m.tabla_origen === "consumibles" ? "Consumible" : "Insumo";
  const fichaInsumo = m.tabla_origen === "reactivos" ? `/inventario/reactivos?buscar=${encodeURIComponent(nombreInsumo(m))}` : m.tabla_origen === "consumibles" ? `/inventario/consumibles?buscar=${encodeURIComponent(nombreInsumo(m))}` : null;
  return (
    <div className="flex flex-col gap-5" data-movimiento-ventana={String(m.id)}>
      <VentanaEncabezado
        figura={<IconoMovimientoInsumo m={m} grande />}
        titulo={nombreInsumo(m)}
        insignia={
          <Badge tone={entrada ? "success" : "warning"} dot>
            {tipoMovimiento(m)}
          </Badge>
        }
        subtitulo={tipoInsumo}
      />

      <VentanaSeccion i={0}>
        <div className={cn("flex flex-wrap items-center justify-between gap-4 rounded-[16px] px-5 py-4 ring-1", entrada ? "bg-success-soft/60 ring-success/20" : "bg-warning-soft/60 ring-warning/20")}>
          <div className="flex flex-col gap-0.5">
            <span className="text-[12.5px] text-ink-3">{entrada ? "Entró al inventario" : "Salió del inventario"}</span>
            <span className={cn("tnum text-[30px] leading-none font-semibold tracking-[-0.02em]", entrada ? "text-success-text" : "text-warning-text")}>
              {entrada ? "+" : "−"}
              {fmt(cantidadMovimiento(m))}
              {m.unidad ? <span className="ml-1.5 text-[15px] font-medium">{String(m.unidad)}</span> : null}
            </span>
          </div>
          <div className="flex flex-col items-end gap-0.5 text-right">
            <span className="text-[14px] font-medium text-ink">{formatearFechaCorta(fechaDelMovimiento(m).fecha)}</span>
            <span className="text-[12.5px] text-ink-3" title={formatearFechaHora(m.fecha_hora)}>
              {fechaDelMovimiento(m).distinta ? `Capturado el ${formatearFechaCorta(fechaDelMovimiento(m).captura)}` : `${formatearHora(m.fecha_hora)} · ${haceCuantoCorto(m.fecha_hora).toLowerCase()}`}
            </span>
          </div>
        </div>
      </VentanaSeccion>

      <VentanaSeccion titulo="Detalle" i={1}>
        <VentanaTarjeta>
          <DatosLista
            datos={[
              { etiqueta: tipoInsumo, valor: fichaInsumo ? <Link href={fichaInsumo} className="font-medium text-brand hover:underline">{nombreInsumo(m)}</Link> : nombreInsumo(m) },
              m.item_codigo && m.item_codigo !== m.item_nombre ? { etiqueta: "Código", valor: String(m.item_codigo) } : null,
              { etiqueta: "Tipo", valor: tipoMovimiento(m) },
              m.usuario ? { etiqueta: "Registró", valor: String(m.usuario) } : null,
              m.motivo ? { etiqueta: "Motivo", valor: String(m.motivo) } : null,
              { etiqueta: "Fecha del movimiento", valor: formatearFechaCorta(fechaDelMovimiento(m).fecha) },
              { etiqueta: "Capturado", valor: formatearFechaHora(m.fecha_hora) },
            ]}
          />
        </VentanaTarjeta>
      </VentanaSeccion>

      <VentanaSeccion titulo="Registro de origen" i={2}>
        <div className="flex items-start gap-3 rounded-[14px] bg-surface-2 px-4 py-3.5 ring-1 ring-line transition-shadow duration-200 hover:shadow-raised">
          <IconoOrigen m={m} />
          <div className="flex min-w-0 flex-col gap-0.5">
            {origen.href ? (
              <Link href={origen.href} className="break-words text-[14px] font-medium text-brand hover:underline">
                {origen.texto}
              </Link>
            ) : (
              <p className="break-words text-[14px] font-medium text-ink">{origen.texto}</p>
            )}
            <p className="text-[12.5px] text-ink-3">{origen.href ? "Se descontó al capturar ese formato." : entrada ? "Entrada registrada en el inventario." : "Movimiento registrado en el inventario."}</p>
          </div>
        </div>
      </VentanaSeccion>
    </div>
  );
}
