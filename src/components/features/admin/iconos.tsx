"use client";

import type { ReactNode } from "react";
import { Books, Crown, Database, Flask, GearSix, GraduationCap, Medal, MagnifyingGlass, Package, ShieldCheck, ShoppingCart, TestTube, Users, Wrench, Archive, ClipboardText, FileText, SealCheck, Microscope } from "@phosphor-icons/react";
import { cn } from "@/components/ui/cn";
import type { IconoRol as ClaveIcono } from "@/lib/shared/roles-descripcion";

/* Iconos de los roles (roles-descripcion.ts) y de las areas de la plataforma. */
const ICONOS_ROL: Record<ClaveIcono, (size: number) => ReactNode> = {
  engrane: (s) => <GearSix size={s} weight="duotone" />,
  corona: (s) => <Crown size={s} weight="duotone" />,
  medalla: (s) => <Medal size={s} weight="duotone" />,
  matraz: (s) => <Flask size={s} weight="duotone" />,
  libro: (s) => <Books size={s} weight="duotone" />,
  tubo: (s) => <TestTube size={s} weight="duotone" />,
  caja: (s) => <Package size={s} weight="duotone" />,
  carrito: (s) => <ShoppingCart size={s} weight="duotone" />,
  lupa: (s) => <MagnifyingGlass size={s} weight="duotone" />,
  birrete: (s) => <GraduationCap size={s} weight="duotone" />,
  escudo: (s) => <ShieldCheck size={s} weight="duotone" />,
};

/* Icono del rol en un circulo suave (pequeño en listas, grande en la ventana). */
export function IconoRol({ icono, grande = false, className }: { icono: ClaveIcono; grande?: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center rounded-[12px] bg-brand-soft text-brand-strong", grande ? "h-14 w-14 rounded-[16px]" : "h-10 w-10", className)}>
      {ICONOS_ROL[icono](grande ? 28 : 20)}
    </span>
  );
}

const ICONOS_AREA: Record<string, ReactNode> = {
  muestras: <TestTube size={18} weight="duotone" />,
  ensayos: <Microscope size={18} weight="duotone" />,
  informes: <FileText size={18} weight="duotone" />,
  equipos: <Wrench size={18} weight="duotone" />,
  inventario: <Archive size={18} weight="duotone" />,
  calidad: <SealCheck size={18} weight="duotone" />,
  documentos: <Books size={18} weight="duotone" />,
  usuarios: <Users size={18} weight="duotone" />,
  respaldos: <Database size={18} weight="duotone" />,
  compras: <ShoppingCart size={18} weight="duotone" />,
};

export function IconoArea({ clave }: { clave: string }) {
  return (
    <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-surface-3 text-ink-2">
      {ICONOS_AREA[clave] || <ClipboardText size={18} weight="duotone" />}
    </span>
  );
}


/* Etiqueta de un rol con su nombre completo: nunca se recorta; si no cabe, pasa a la siguiente linea. */
export function EtiquetaRol({ children }: { children: ReactNode }) {
  return <span className="inline-flex min-h-6 items-center rounded-full bg-surface-3 px-2.5 py-0.5 text-[12px] leading-snug font-medium text-ink-2">{children}</span>;
}
