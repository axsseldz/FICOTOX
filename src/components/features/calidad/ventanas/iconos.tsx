"use client";

import type { ReactNode } from "react";
import { ChatsCircle, ClipboardText, DesktopTower, Detective, Flask, HardHat, ListChecks, Megaphone, Package, Path, Plugs, SealWarning, TestTube, ThermometerHot, WarningDiamond } from "@phosphor-icons/react";
import { cn } from "@/components/ui/cn";

/*
 * Iconos de calidad, fieles a lo que paso: desviacion del metodo (camino
 * desviado), falla de equipo (desconectado), condicion ambiental (temperatura),
 * muestra o custodia (tubo), insumo (paquete), seguridad (casco), sistema
 * (computadora), queja del cliente (altavoz). Las NC llevan el icono de su
 * origen (incidencia, queja, auditoria interna, revision) y las acciones
 * correctivas una lista con palomitas.
 */
type Figura = { icono: (s: number) => ReactNode; tono: string };

const POR_TIPO: Record<string, Figura> = {
  desviacion_metodo: { icono: (s) => <Path size={s} weight="duotone" />, tono: "bg-warning-soft text-warning-text" },
  falla_equipo: { icono: (s) => <Plugs size={s} weight="duotone" />, tono: "bg-danger-soft text-danger" },
  condicion_ambiental: { icono: (s) => <ThermometerHot size={s} weight="duotone" />, tono: "bg-warning-soft text-warning-text" },
  muestra_custodia: { icono: (s) => <TestTube size={s} weight="duotone" />, tono: "bg-brand-soft text-brand-strong" },
  insumo: { icono: (s) => <Package size={s} weight="duotone" />, tono: "bg-brand-soft text-brand-strong" },
  seguridad: { icono: (s) => <HardHat size={s} weight="duotone" />, tono: "bg-danger-soft text-danger" },
  sistema: { icono: (s) => <DesktopTower size={s} weight="duotone" />, tono: "bg-surface-3 text-ink-2" },
  queja_cliente: { icono: (s) => <Megaphone size={s} weight="duotone" />, tono: "bg-warning-soft text-warning-text" },
  otro: { icono: (s) => <WarningDiamond size={s} weight="duotone" />, tono: "bg-surface-3 text-ink-2" },
};

const POR_ORIGEN_NC: Record<string, (s: number) => ReactNode> = {
  incidencia: (s) => <SealWarning size={s} weight="duotone" />,
  queja: (s) => <ChatsCircle size={s} weight="duotone" />,
  auditoria_interna: (s) => <Detective size={s} weight="duotone" />,
  revision: (s) => <ClipboardText size={s} weight="duotone" />,
  otro: (s) => <SealWarning size={s} weight="duotone" />,
};

/* Tono de la NC por su clasificacion (critica y mayor en rojo, menor en ambar). */
const TONO_NC: Record<string, string> = { critica: "bg-danger-soft text-danger", mayor: "bg-danger-soft text-danger", menor: "bg-warning-soft text-warning-text" };

export function IconoCalidad({ tipo, clase = "incidencia", origen, clasificacion, grande = false }: { tipo?: unknown; clase?: "incidencia" | "nc" | "accion"; origen?: unknown; clasificacion?: unknown; grande?: boolean }) {
  const s = grande ? 32 : 21;
  const def: Figura =
    clase === "nc"
      ? { icono: POR_ORIGEN_NC[String(origen || "")] || POR_ORIGEN_NC.otro, tono: TONO_NC[String(clasificacion || "")] || "bg-danger-soft text-danger" }
      : clase === "accion"
        ? { icono: (n: number) => <ListChecks size={n} weight="duotone" />, tono: "bg-success-soft text-success-text" }
        : POR_TIPO[String(tipo || "")] || POR_TIPO.otro;
  return (
    <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center", grande ? "h-16 w-16 rounded-[18px]" : "h-10 w-10 rounded-[12px]", def.tono)}>
      {def.icono(s)}
    </span>
  );
}

/* Icono pequeño de un registro relacionado segun su etiqueta (recepcion, analisis, equipo…). */
export function IconoRegistro({ etiqueta }: { etiqueta?: unknown }) {
  const t = String(etiqueta || "").toLowerCase();
  const icono = /equipo|mantenimiento/.test(t) ? <Plugs size={14} weight="duotone" /> : /reactivo|consumible|insumo/.test(t) ? <Package size={14} weight="duotone" /> : /extracc|an[aá]lisis|procesa/.test(t) ? <Flask size={14} weight="duotone" /> : /recepci|muestra/.test(t) ? <TestTube size={14} weight="duotone" /> : <ClipboardText size={14} weight="duotone" />;
  return (
    <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-faint text-brand-strong">
      {icono}
    </span>
  );
}
