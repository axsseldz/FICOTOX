"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowsLeftRight, Atom, Truck, Bag, ChartLine, CheckSquare, Cylinder, Diamond, Disc, Drop, Eyedropper, Fire, FirstAid, Flask, Funnel, Gauge, HandPalm, Jar, Lightbulb, Microscope, Monitor, Package, Ruler, Scales, Scroll, SealCheck, ShieldCheck, Snowflake, Spinner, Syringe, Tag, TestTube, Thermometer, Toolbox, Tornado, Tray, Vibrate, Waves, Wind, Wrench } from "@phosphor-icons/react";
import { useSession } from "@/components/session/SessionProvider";
import { cn } from "@/components/ui/cn";
import { Badge, Skeleton } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { deadlineTone, fmt } from "@/lib/client/format";
import { useResource } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { diasEntre, fechaSola, formatearFechaCorta, formatearFechaHora, hoyLocal } from "@/lib/shared/fechas";

/*
 * Piezas comunes de Inventario (Reactivos, Consumibles, Equipos,
 * Mantenimiento y Movimientos) para el patron lista -> ventana de detalle:
 * icono y color por categoria, caducidad en color, movimientos recientes de
 * un insumo y el origen de un movimiento en palabras (con enlace).
 */

/* Cuadro suave del icono: pequeño en listas, grande en la ventana. */
function CuadroIcono({ grande, clase, children }: { grande: boolean; clase: string; children: ReactNode }) {
  return (
    <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center", grande ? "h-16 w-16 rounded-panel" : "h-10 w-10 rounded-box", clase)}>
      {children}
    </span>
  );
}

const T_PEQ = 21;
const T_GDE = 32;

/*
 * Icono por categoria de reactivo, fiel a lo que es: acidos (gota corrosiva),
 * alcoholes y solventes (inflamables), compuestos de amonio (molecula),
 * compuestos de sodio (cristal), estandares preparados (gotero), materiales
 * de referencia (sello), columnas cromatograficas (columna) y miscelaneos (matraz).
 */
const CATEGORIA: Record<string, { icono: (s: number) => ReactNode; clase: string; nombre: string }> = {
  acidos: { icono: (s) => <Drop size={s} weight="duotone" />, clase: "bg-danger-soft text-danger", nombre: "Ácido" },
  alcoholes_solventes: { icono: (s) => <Fire size={s} weight="duotone" />, clase: "bg-warning-soft text-warning-text", nombre: "Alcohol o solvente" },
  compuestos_amonio: { icono: (s) => <Atom size={s} weight="duotone" />, clase: "bg-deep-2/10 text-deep-2", nombre: "Compuesto de amonio" },
  compuestos_sodio: { icono: (s) => <Diamond size={s} weight="duotone" />, clase: "bg-success-soft text-success-text", nombre: "Compuesto de sodio" },
  estandares_preparados: { icono: (s) => <Eyedropper size={s} weight="duotone" />, clase: "bg-brand-soft text-brand-strong", nombre: "Estándar preparado" },
  materiales_referencia: { icono: (s) => <SealCheck size={s} weight="duotone" />, clase: "bg-success-soft text-success-text", nombre: "Material de referencia" },
  columnas_cromatograficas: { icono: (s) => <Cylinder size={s} weight="duotone" />, clase: "bg-surface-3 text-ink-2", nombre: "Columna cromatográfica" },
  miscelaneos: { icono: (s) => <Flask size={s} weight="duotone" />, clase: "bg-surface-3 text-ink-2", nombre: "Misceláneo" },
};

export function IconoCategoria({ categoria, grande = false }: { categoria?: unknown; grande?: boolean }) {
  const meta = CATEGORIA[String(categoria || "")] || { icono: (s: number) => <Flask size={s} weight="duotone" />, clase: "bg-brand-faint text-brand-strong" };
  return (
    <CuadroIcono grande={grande} clase={meta.clase}>
      {meta.icono(grande ? T_GDE : T_PEQ)}
    </CuadroIcono>
  );
}

/* Busca el primer patron que coincida con el nombre (sin acentos ni mayusculas). */
function porNombre<T>(nombre: unknown, reglas: Array<[RegExp, T]>, omision: T): T {
  const texto = String(nombre || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return reglas.find(([re]) => re.test(texto))?.[1] ?? omision;
}

type Figura = { icono: (s: number) => ReactNode; clase: string };

/* Consumibles: el icono sale de lo que es el producto (guantes, tubos, puntas, filtros…). */
const CONSUMIBLES: Array<[RegExp, Figura]> = [
  [/guante/, { icono: (s) => <HandPalm size={s} weight="duotone" />, clase: "bg-brand-soft text-brand-strong" }],
  [/bolsa|rpbi|residuo/, { icono: (s) => <Bag size={s} weight="duotone" />, clase: "bg-danger-soft text-danger" }],
  [/tubo|falcon|vial|eppendorf|microtubo|criovial/, { icono: (s) => <TestTube size={s} weight="duotone" />, clase: "bg-brand-faint text-brand-strong" }],
  [/punta|pipeta|gotero/, { icono: (s) => <Eyedropper size={s} weight="duotone" />, clase: "bg-brand-faint text-brand-strong" }],
  [/filtro|membrana|acrodisco|cartucho|spe|sax/, { icono: (s) => <Funnel size={s} weight="duotone" />, clase: "bg-deep-2/10 text-deep-2" }],
  [/jeringa|aguja/, { icono: (s) => <Syringe size={s} weight="duotone" />, clase: "bg-warning-soft text-warning-text" }],
  [/papel|toalla|kimwipe|panuelo/, { icono: (s) => <Scroll size={s} weight="duotone" />, clase: "bg-surface-3 text-ink-2" }],
  [/frasco|botella|garrafa|bote/, { icono: (s) => <Jar size={s} weight="duotone" />, clase: "bg-success-soft text-success-text" }],
  [/caja|placa|charola|gradilla|petri/, { icono: (s) => <Tray size={s} weight="duotone" />, clase: "bg-surface-3 text-ink-2" }],
  [/cubrebocas|mascarilla|bata|lente|cofia|careta/, { icono: (s) => <FirstAid size={s} weight="duotone" />, clase: "bg-danger-soft text-danger" }],
  [/cinta|etiqueta|marcador/, { icono: (s) => <Tag size={s} weight="duotone" />, clase: "bg-warning-soft text-warning-text" }],
];
const CONSUMIBLE_OMISION: Figura = { icono: (s) => <Package size={s} weight="duotone" />, clase: "bg-brand-faint text-brand-strong" };

export function IconoConsumible({ producto, grande = false }: { producto?: unknown; grande?: boolean }) {
  const f = porNombre(producto, CONSUMIBLES, CONSUMIBLE_OMISION);
  return (
    <CuadroIcono grande={grande} clase={f.clase}>
      {f.icono(grande ? T_GDE : T_PEQ)}
    </CuadroIcono>
  );
}

/* Equipos: el icono sale del tipo de equipo (centrifuga, balanza, refrigerador, HPLC…). */
const EQUIPOS: Array<[RegExp, (s: number) => ReactNode]> = [
  [/centrifug/, (s) => <Disc size={s} weight="duotone" />],
  [/balanza|bascula/, (s) => <Scales size={s} weight="duotone" />],
  [/microscop|estereoscop/, (s) => <Microscope size={s} weight="duotone" />],
  [/refriger|congel|ultracongel|liofiliz|cuarto frio/, (s) => <Snowflake size={s} weight="duotone" />],
  [/horno|estufa|mufla|autoclave/, (s) => <Fire size={s} weight="duotone" />],
  [/incubad|termometro|termociclador/, (s) => <Thermometer size={s} weight="duotone" />],
  [/bano|bath/, (s) => <Waves size={s} weight="duotone" />],
  [/hplc|uplc|cromatograf|lc.?ms|masas|gases/, (s) => <ChartLine size={s} weight="duotone" />],
  [/espectro|fotometro|lector|fluorimetro|colorimetro/, (s) => <Lightbulb size={s} weight="duotone" />],
  [/\bph\b|potenciometro|conductiv|medidor/, (s) => <Gauge size={s} weight="duotone" />],
  [/vortex|agitador|shaker|mezclador/, (s) => <Tornado size={s} weight="duotone" />],
  [/campana|extractor|flujo laminar/, (s) => <Wind size={s} weight="duotone" />],
  [/pipeta|dispensador/, (s) => <Eyedropper size={s} weight="duotone" />],
  [/rotavapor|evaporador|concentrador|nitrogeno/, (s) => <Drop size={s} weight="duotone" />],
  [/sonicador|ultrason/, (s) => <Vibrate size={s} weight="duotone" />],
  [/molino|licuadora|homogeniz|triturador|procesador/, (s) => <Spinner size={s} weight="duotone" />],
  [/computadora|monitor|impresora/, (s) => <Monitor size={s} weight="duotone" />],
];

export function IconoEquipo({ nombre, grande = false, tono = "bg-brand-faint text-brand-strong" }: { nombre?: unknown; grande?: boolean; tono?: string }) {
  const icono = porNombre(nombre, EQUIPOS, (s: number) => <Toolbox size={s} weight="duotone" />);
  return (
    <CuadroIcono grande={grande} clase={tono}>
      {icono(grande ? T_GDE : T_PEQ)}
    </CuadroIcono>
  );
}

/* Mantenimiento: el icono dice que tipo es (calibracion, preventivo, correctivo, verificacion). */
const MANTENIMIENTO: Record<string, (s: number) => ReactNode> = {
  calibracion: (s) => <Ruler size={s} weight="duotone" />,
  preventivo: (s) => <ShieldCheck size={s} weight="duotone" />,
  correctivo: (s) => <Wrench size={s} weight="duotone" />,
  verificacion: (s) => <CheckSquare size={s} weight="duotone" />,
};

export function IconoMantenimiento({ tipo, vencido = false, grande = false }: { tipo?: unknown; vencido?: boolean; grande?: boolean }) {
  const icono = MANTENIMIENTO[String(tipo || "")] || ((s: number) => <Wrench size={s} weight="duotone" />);
  return (
    <CuadroIcono grande={grande} clase={vencido ? "bg-danger-soft text-danger" : "bg-brand-faint text-brand-strong"}>
      {icono(grande ? T_GDE : T_PEQ)}
    </CuadroIcono>
  );
}

/* Caducidad en palabras y color: rojo si vencio, ambar si faltan 30 dias o menos. */
export function caducidadDe(value: unknown): { texto: string; detalle: string | null; tono: "danger" | "warning" | null } | null {
  if (!value || String(value).trim() === "-") return null;
  const tono = deadlineTone(value);
  const dias = diasEntre(hoyLocal(), value);
  const detalle = dias === null ? null : dias < 0 ? (dias === -1 ? "venció ayer" : `venció hace ${-dias} días`) : dias === 0 ? "vence hoy" : dias <= 30 ? (dias === 1 ? "vence mañana" : `vence en ${dias} días`) : null;
  return { texto: formatearFechaCorta(value), detalle, tono };
}

export function Caducidad({ value }: { value: unknown }) {
  const c = caducidadDe(value);
  if (!c) return <span className="text-sm text-ink-4">—</span>;
  return (
    <span className="flex flex-col">
      <span className={cn("text-sm", c.tono === "danger" ? "font-medium text-danger" : c.tono === "warning" ? "font-medium text-warning-text" : "text-ink-2")}>{c.texto}</span>
      {c.detalle ? <span className={cn("text-xs", c.tono === "danger" ? "text-danger" : "text-warning-text")}>{c.detalle}</span> : null}
    </span>
  );
}

/* Origen de un movimiento en palabras y su registro enlazado (las salidas de los formatos llevan su folio en el motivo). */
export function origenDeMovimiento(m: ApiRecord): { texto: string; href: string | null } {
  const ref = String(m.referencia || "");
  const motivo = String(m.motivo || "");
  const ext = /^EXT-(\d+)-/.exec(ref);
  const proc = /^PROC-(\d+)-/.exec(ref);
  const ana = /^(?:ANA|AN)-(\d+)-/.exec(ref);
  if (ext) return { texto: motivo.replace(/^Extraccion/, "Extracción") || "Extracción", href: `/muestras/extraccion/${ext[1]}` };
  if (proc) return { texto: motivo.replace(/^Procesamiento/, "Procesamiento") || "Procesamiento", href: `/muestras/procesamiento/${proc[1]}` };
  if (ana) return { texto: motivo || "Análisis", href: `/muestras/analisis/${ana[1]}` };
  const vinculo = RUTA_VINCULO[String(m.vinculo_tipo || "")];
  if (vinculo && m.vinculo_id) return { texto: motivo || vinculo[0], href: `${vinculo[1]}/${m.vinculo_id}` };
  if (/^(reactivo|consumible)-/.test(ref)) return { texto: motivo || "Entrada al inventario", href: null };
  return { texto: motivo || "Movimiento de inventario", href: null };
}

/* Entra al inventario: una entrada o un ajuste que sube la existencia. */
export const esEntrada = (m: ApiRecord) => {
  const tipo = String(m.tipo || "").toLowerCase();
  return tipo === "entrada" || (tipo === "ajuste" && Number(m.cantidad) > 0);
};

/* Cantidad sin signo (el signo lo da la flecha y el color) y rotulo del tipo. */
export const cantidadMovimiento = (m: ApiRecord): number => Math.abs(Number(m.cantidad) || 0);

/* Signo de la cantidad: un ajuste sin diferencia no lleva «−0». */
export const signoMovimiento = (m: ApiRecord): string => (cantidadMovimiento(m) === 0 ? "" : esEntrada(m) ? "+" : "−");

/* Cantidad con su unidad en singular cuando es exactamente 1 ("1 unidad", "1 litro"); las abreviaturas (L, mL, g) no cambian. */
export function conUnidad(cantidad: number, unidad: string | null | undefined): string {
  const u = String(unidad || "").trim();
  if (!u) return fmt(cantidad);
  const singular = cantidad === 1 ? (/es$/.test(u) && /(d|n|l|r)es$/.test(u) ? u.slice(0, -2) : /[aeiou]s$/.test(u) ? u.slice(0, -1) : u) : u;
  return `${fmt(cantidad)} ${singular}`;
}
export const TIPO_MOVIMIENTO: Record<string, string> = { entrada: "Entrada", salida: "Salida", consumo: "Consumo", ajuste: "Ajuste por conteo" };
export const tipoMovimiento = (m: ApiRecord): string => (m.revierte_id ? "Reversión" : TIPO_MOVIMIENTO[String(m.tipo || "").toLowerCase()] || (esEntrada(m) ? "Entrada" : "Salida"));

/* Fecha principal del movimiento (la que ocurrio) y si difiere del dia de captura. */
export function fechaDelMovimiento(m: ApiRecord): { fecha: string; captura: string; distinta: boolean } {
  const captura = fechaSola(m.fecha_hora);
  const fecha = m.fecha_movimiento ? fechaSola(m.fecha_movimiento) : captura;
  return { fecha, captura, distinta: !!captura && fecha !== captura };
}

const RUTA_VINCULO: Record<string, [string, string]> = { recepcion: ["Recepción", "/muestras/recepcion"], procesamiento: ["Procesamiento", "/muestras/procesamiento"], extraccion: ["Extracción", "/muestras/extraccion"], analisis: ["Análisis", "/muestras/analisis"] };

/*
 * Icono de un movimiento: la figura del insumo (reactivo: matraz; consumible:
 * lo que es por su nombre) con una flecha en la esquina, verde hacia abajo si
 * entro al inventario y ambar hacia arriba si salio.
 */
export function IconoMovimientoInsumo({ m, grande = false }: { m: ApiRecord; grande?: boolean }) {
  const entrada = esEntrada(m);
  const consumible = m.tabla_origen === "consumibles";
  const figura = consumible ? porNombre(m.item_nombre, CONSUMIBLES, CONSUMIBLE_OMISION) : { icono: (s: number) => <Flask size={s} weight="duotone" />, clase: "bg-brand-faint text-brand-strong" };
  return (
    <span className="relative shrink-0" aria-hidden="true">
      <CuadroIcono grande={grande} clase={figura.clase}>
        {figura.icono(grande ? T_GDE : T_PEQ)}
      </CuadroIcono>
      <span className={cn("absolute -right-1 -bottom-1 flex items-center justify-center rounded-full ring-2 ring-surface", grande ? "h-7 w-7" : "h-5 w-5", entrada ? "bg-success text-on-accent" : "bg-warning text-on-accent")}>
        {entrada ? <ArrowDown size={grande ? 15 : 11} weight="bold" /> : <ArrowUp size={grande ? 15 : 11} weight="bold" />}
      </span>
    </span>
  );
}

/* Icono del origen de un movimiento (formato de captura o entrada al inventario). */
export function IconoOrigen({ m }: { m: ApiRecord }) {
  const ref = String(m.referencia || "");
  const icono = /^EXT-/.test(ref) ? <Flask size={18} weight="duotone" /> : /^PROC-/.test(ref) ? <TestTube size={18} weight="duotone" /> : /^(ANA|AN)-/.test(ref) ? <ChartLine size={18} weight="duotone" /> : esEntrada(m) ? <Truck size={18} weight="duotone" /> : <ArrowsLeftRight size={18} weight="duotone" />;
  return (
    <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-field bg-surface text-brand-strong shadow-card">
      {icono}
    </span>
  );
}

/* Los últimos movimientos de un insumo, para su ventana (filtrados en el servidor: no dependen de los recientes de toda la plataforma). */
function useMovimientos(tabla: string, id: unknown): { items: ApiRecord[] | null; error: string | null } {
  const { token } = useSession();
  const recurso = useResource<ApiRecord[]>(["movimientos", "movimientos-ventana"], async () => ((await getJsonAuth(`${API_BASE_URL}/inventory/movimientos?tabla=${tabla}&id=${Number(id)}&limite=6`, token)).items || []) as ApiRecord[], { enabled: !!token, deps: [tabla, Number(id)] });
  return { items: recurso.data || null, error: recurso.error || null };
}

export function MovimientosRecientes({ tabla, id, unidad }: { tabla: "reactivos" | "consumibles"; id: unknown; unidad?: string }) {
  const { items, error } = useMovimientos(tabla, id);
  if (error) return <p className="text-sm text-ink-3">No se pudieron cargar los movimientos.</p>;
  if (!items) return <Skeleton className="h-16 w-full" />;
  const propios = items.filter((m) => m.tabla_origen === tabla && Number(m.id_item) === Number(id)).slice(0, 6);
  if (!propios.length)
    return (
      <p className="text-sm text-ink-3">
        Sin movimientos recientes.{" "}
        <Link href="/movimientos" className="font-medium text-brand hover:underline">
          Ver todos los movimientos
        </Link>
      </p>
    );
  return (
    <ul className="flex flex-col gap-2">
      {propios.map((m, i) => {
        const origen = origenDeMovimiento(m);
        return (
          <li key={String(m.id)} className="entrada-escalonada flex items-start gap-3 rounded-box bg-surface px-3 py-2.5 ring-1 ring-line" style={{ ["--i" as string]: i }}>
            <IconoMovimientoInsumo m={m} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium text-ink">
                {tipoMovimiento(m)} de {conUnidad(cantidadMovimiento(m), String(unidad || m.unidad || ""))}
                {m.revertido_por ? <Badge size="sm" tone="neutral" className="ml-2 align-middle">Revertido</Badge> : null}
              </span>
              <span className="break-words text-xs text-ink-3">
                {origen.href ? (
                  <Link href={origen.href} className="text-brand hover:underline">
                    {origen.texto}
                  </Link>
                ) : (
                  origen.texto
                )}{" "}
                · <span title={`Capturado: ${formatearFechaHora(m.fecha_hora)}`}>{formatearFechaCorta(fechaDelMovimiento(m).fecha)}</span>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* Indice de ventana con ↑/↓ sobre la lista visible. */
export function moverEn(indice: number | null, total: number, paso: number): number | null {
  if (indice === null) return null;
  const siguiente = indice + paso;
  return siguiente >= 0 && siguiente < total ? siguiente : indice;
}
