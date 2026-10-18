"use client";

import { ArrowCounterClockwise, Barcode, BookOpen, CalendarCheck, MapPin, PencilSimple, Pulse, Ruler, Trash, UserCircle, Wrench } from "@phosphor-icons/react";
import { IncidenciasDelRegistro } from "@/components/features/calidad/IncidenciasDelRegistro";
import { MANTENIMIENTO_ESTADOS, MANTENIMIENTO_TIPOS, metaFor } from "@/components/features/inventory/meta";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { FiguraPersona } from "@/components/ui/FiguraPersona";
import { Badge, Skeleton, type Tone } from "@/components/ui/Primitives";
import { ColumnasVentana, DatoLateral, DatosRapidos, TarjetaLateral, VentanaAcciones, VentanaCentrada, VentanaEncabezado, VentanaSeccion, VentanaTarjeta, VentanaTitulo } from "@/components/ui/Ventana";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { useResource } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { formatearFecha, formatearFechaCorta } from "@/lib/shared/fechas";
import { caducidadDe, IconoEquipo, IconoMantenimiento, moverEn } from "./comun";

/*
 * Ventana de un equipo: estado, proxima calibracion y mantenimiento, datos,
 * responsable, historial de mantenimientos, incidencias y acciones de
 * siempre (Programar mantenimiento, Editar, Dar de baja o Reactivar).
 */

export interface EstadoEquipo {
  label: string;
  tone: Tone;
  detail: string | null;
  detailTone: "danger" | "warning" | null;
}

export interface AccionesEquipo {
  puedeProgramar: boolean;
  puedeEditar: boolean;
  puedeBaja: boolean;
  puedeReactivar: boolean;
  programar: (item: ApiRecord) => void;
  editar: (item: ApiRecord) => void;
  darDeBaja: (item: ApiRecord) => void;
  reactivar: (item: ApiRecord) => void;
}

/* Todos los mantenimientos (para el historial de cada equipo). */
function useMantenimientos(): ApiRecord[] | null {
  const { token } = useSession();
  const recurso = useResource<ApiRecord[]>(["mantenimientos", "mantenimientos-historial"], async () => ((await getJsonAuth(`${API_BASE_URL}/inventory/mantenimientos`, token)).items || []) as ApiRecord[], { enabled: !!token });
  return recurso.data || null;
}

export function EquipoVentana({ items, indice, onIndice, onCerrar, estadoDe, acciones }: { items: ApiRecord[]; indice: number | null; onIndice: (i: number) => void; onCerrar: () => void; estadoDe: (item: ApiRecord) => EstadoEquipo; acciones: AccionesEquipo }) {
  const item = indice !== null ? items[indice] : undefined;
  const mover = (paso: number) => {
    const siguiente = moverEn(indice, items.length, paso);
    if (siguiente !== null) onIndice(siguiente);
  };
  return (
    <VentanaCentrada amplia abierta={!!item} onCerrar={onCerrar} onMover={mover} puedeAnterior={indice !== null && indice > 0} puedeSiguiente={indice !== null && indice < items.length - 1} etiquetaAnterior="Equipo anterior" etiquetaSiguiente="Equipo siguiente">
      {item ? <FichaEquipo key={String(item.id)} item={item} estado={estadoDe(item)} acciones={acciones} /> : <VentanaTitulo className="sr-only">Equipo</VentanaTitulo>}
    </VentanaCentrada>
  );
}

function FichaEquipo({ item, estado, acciones }: { item: ApiRecord; estado: EstadoEquipo; acciones: AccionesEquipo }) {
  const mantenimientos = useMantenimientos();
  const inactivo = Number(item.activo ?? 1) === 0;
  const cal = caducidadDe(item.fecha_prox_calibracion);
  const tipoProx = item.mantenimiento_tipo ? metaFor(MANTENIMIENTO_TIPOS, item.mantenimiento_tipo).label : null;
  const historial = (mantenimientos || []).filter((m) => Number(m.id_equipo) === Number(item.id)).sort((a, b) => String(b.fecha_programada || "").localeCompare(String(a.fecha_programada || ""))).slice(0, 10);
  return (
    <div className="flex flex-col gap-6" data-equipo-ventana={String(item.id)}>
      <VentanaEncabezado
        figura={<IconoEquipo nombre={item.nombre} grande />}
        titulo={String(item.nombre || "Equipo")}
        insignia={
          <>
            {inactivo ? <Badge tone="danger">Baja</Badge> : null}
            <Badge tone={estado.tone} dot>
              {estado.label}
            </Badge>
          </>
        }
        subtitulo={[item.marca, item.modelo, item.numero_serie ? `serie ${item.numero_serie}` : null].filter(Boolean).join(" · ") || undefined}
      />
      <DatosRapidos
        datos={[
          { icono: <Pulse size={17} weight="duotone" />, etiqueta: "Estado", valor: estado.label, tono: estado.tone === "danger" ? "danger" : estado.tone === "warning" ? "warning" : estado.tone === "success" ? "success" : "brand" },
          { icono: <CalendarCheck size={17} weight="duotone" />, etiqueta: "Calibración", valor: cal ? cal.texto : "Sin fecha", tono: cal?.tono || "brand", titulo: cal?.detalle || undefined },
          { icono: <Wrench size={17} weight="duotone" />, etiqueta: "Mantenimiento", valor: item.mantenimiento_fecha ? formatearFechaCorta(item.mantenimiento_fecha) : "Ninguno", titulo: tipoProx || undefined, tono: item.mantenimiento_estado === "vencido" ? "danger" : "brand" },
          { icono: <BookOpen size={17} weight="duotone" />, etiqueta: "Bitácora", valor: item.clave_bitacora ? String(item.clave_bitacora) : "—", titulo: item.ultimo_folio_bitacora ? `Último folio: ${String(item.ultimo_folio_bitacora)}` : undefined },
        ]}
      />
      {inactivo ? (
        <VentanaTarjeta className="bg-danger-soft/50 ring-danger/15">
          <p className="text-[14px] font-medium text-ink">Dado de baja{item.baja_en ? ` el ${formatearFecha(item.baja_en)}` : ""}</p>
          {item.baja_motivo ? <p className="mt-0.5 text-[13.5px] text-ink-2">Motivo: {String(item.baja_motivo)}</p> : null}
        </VentanaTarjeta>
      ) : null}
      {estado.detail ? (
        <VentanaTarjeta className={estado.detailTone === "danger" ? "bg-danger-soft/50 ring-danger/15" : "bg-warning-soft/50 ring-warning/15"}>
          <p className="text-[14px] text-ink">Pendiente: {estado.detail}</p>
        </VentanaTarjeta>
      ) : null}
      <ColumnasVentana
        principal={
          <>
            <VentanaSeccion titulo="Historial de mantenimientos" i={1}>
              {!mantenimientos ? (
                <Skeleton className="h-16 w-full" />
              ) : historial.length ? (
                <ol className="flex flex-col">
                  {historial.map((m, i) => {
                    const est = metaFor(MANTENIMIENTO_ESTADOS, m.estado);
                    const tipo = metaFor(MANTENIMIENTO_TIPOS, m.tipo);
                    return (
                      <li key={String(m.id)} className="entrada-escalonada relative flex gap-3 pb-3 last:pb-0" style={{ ["--i" as string]: i }}>
                        {i < historial.length - 1 ? <span aria-hidden="true" className="absolute top-10 bottom-0 left-5 w-0.5 bg-line" /> : null}
                        <IconoMantenimiento tipo={m.tipo} vencido={m.estado === "vencido"} />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-[12px] bg-surface px-3.5 py-2.5 ring-1 ring-line transition-shadow duration-200 hover:shadow-raised">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[14px] font-medium text-ink">{tipo.label}</span>
                            <Badge tone={est.tone} dot>
                              {est.label}
                            </Badge>
                          </div>
                          <span className="text-[13px] text-ink-3">
                            {m.fecha_realizado ? `Realizado el ${formatearFechaCorta(m.fecha_realizado)}` : `Programado para el ${formatearFechaCorta(m.fecha_programada)}`}
                            {m.tecnico_proveedor ? ` · ${String(m.tecnico_proveedor)}` : ""}
                          </span>
                          {m.observaciones ? <span className="text-[12.5px] text-ink-2">{String(m.observaciones)}</span> : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="text-[13.5px] text-ink-3">Todavía no tiene mantenimientos registrados.</p>
              )}
            </VentanaSeccion>
            <VentanaSeccion titulo="Incidencias" i={2}>
              <IncidenciasDelRegistro entidad="equipos" id={item.id} etiqueta={String(item.nombre || "Equipo")} />
            </VentanaSeccion>
          </>
        }
        lateral={
          <>
            <TarjetaLateral icono={<Barcode size={15} weight="duotone" />} titulo="Datos del equipo" i={0}>
              {item.marca ? <DatoLateral etiqueta="Marca">{String(item.marca)}</DatoLateral> : null}
              {item.modelo ? <DatoLateral etiqueta="Modelo">{String(item.modelo)}</DatoLateral> : null}
              {item.numero_serie ? <DatoLateral etiqueta="Número de serie">{String(item.numero_serie)}</DatoLateral> : null}
              {item.creado_en ? <DatoLateral etiqueta="Registrado el">{formatearFecha(item.creado_en)}</DatoLateral> : null}
              {!item.marca && !item.modelo && !item.numero_serie ? <p className="text-[13.5px] text-ink-3">Sin marca, modelo ni número de serie registrados.</p> : null}
            </TarjetaLateral>
            <TarjetaLateral icono={<Ruler size={15} weight="duotone" />} titulo="Calibración" tono={cal?.tono || "neutral"} i={1}>
              <DatoLateral etiqueta="Próxima calibración">{cal ? `${formatearFecha(item.fecha_prox_calibracion)}${cal.detalle ? ` · ${cal.detalle}` : ""}` : "Sin fecha programada"}</DatoLateral>
              {item.mantenimiento_fecha ? <DatoLateral etiqueta="Próximo mantenimiento">{`${formatearFecha(item.mantenimiento_fecha)}${tipoProx ? ` · ${tipoProx.toLowerCase()}` : ""}`}</DatoLateral> : null}
            </TarjetaLateral>
            <TarjetaLateral icono={<MapPin size={15} weight="duotone" />} titulo="Dónde está y bitácora" i={2}>
              <DatoLateral etiqueta="Ubicación">{item.ubicacion ? String(item.ubicacion) : "Sin ubicación"}</DatoLateral>
              <DatoLateral etiqueta="Clave de bitácora">{item.clave_bitacora ? `${String(item.clave_bitacora)}${item.ultimo_folio_bitacora ? ` · último folio ${String(item.ultimo_folio_bitacora)}` : ""}` : "Sin clave"}</DatoLateral>
            </TarjetaLateral>
            <TarjetaLateral icono={<UserCircle size={15} weight="duotone" />} titulo="Responsable" i={3}>
              {item.responsable || item.id_responsable ? <FiguraPersona id={item.id_responsable} nombre={item.responsable} size="md" conNombre subtitulo="Responsable del equipo" animado="siempre" /> : <p className="text-[13.5px] text-ink-3">Sin responsable asignado.</p>}
              <p className="text-[12.5px] text-ink-3">Quién puede usarlo se registra en las autorizaciones FX-THF-AP de cada persona (Administración › Usuarios).</p>
            </TarjetaLateral>
          </>
        }
      />
      <VentanaAcciones>
        {acciones.puedeProgramar && !inactivo ? (
          <Button icon={<Wrench size={16} />} onClick={() => acciones.programar(item)}>
            Programar mantenimiento
          </Button>
        ) : null}
        {acciones.puedeEditar ? (
          <Button variant="secondary" icon={<PencilSimple size={16} />} onClick={() => acciones.editar(item)}>
            Editar
          </Button>
        ) : null}
        {inactivo && acciones.puedeReactivar ? (
          <Button variant="secondary" icon={<ArrowCounterClockwise size={16} />} onClick={() => acciones.reactivar(item)}>
            Reactivar
          </Button>
        ) : null}
        {!inactivo && acciones.puedeBaja ? (
          <Button variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" icon={<Trash size={16} />} onClick={() => acciones.darDeBaja(item)}>
            Dar de baja
          </Button>
        ) : null}
      </VentanaAcciones>
    </div>
  );
}
