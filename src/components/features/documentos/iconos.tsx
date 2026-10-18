"use client";

import { ArrowsClockwise, BookOpenText, Briefcase, CheckCircle, Checks, ClipboardText, Clock, ClockCounterClockwise, CloudArrowUp, DownloadSimple, File, FileArrowDown, FileDashed, Flask, Handshake, Lightbulb, ListBullets, ListChecks, ListNumbers, MinusCircle, Notebook, PaperPlaneTilt, PencilLine, PencilSimple, Plus, Prohibit, Scales, Scroll, SealCheck, ShieldCheck, Signature, UsersThree, UserSwitch, Wrench, type Icon } from "@phosphor-icons/react";
import type { IconoEstado } from "@/lib/shared/documentos";

/*
 * Iconos de Documentos SGC en un solo lugar: por area de gestion, por tipo
 * documental, por estado y por accion. Inicio, carpetas, tarjetas, ficha y
 * menus de acciones los toman de aqui para que todo el modulo hable igual.
 * El icono acompana siempre a un texto (sigla, nombre o etiqueta); nunca es
 * la unica senal.
 */

/* Area de gestion (GC, TH, AD, CO, TC, DI). */
export const ICONO_AREA: Record<string, Icon> = {
  GC: SealCheck,
  TH: UsersThree,
  AD: Briefcase,
  CO: Handshake,
  TC: Flask,
  DI: Scroll,
};

/* Tipo documental (M, P, F, L, I, B, R). */
export const ICONO_TIPO: Record<string, Icon> = {
  M: BookOpenText,
  P: ListNumbers,
  F: ClipboardText,
  L: ListBullets,
  I: Wrench,
  B: Notebook,
  R: Scales,
};

/* Estado de una revision o del documento (mas "pendiente de revision"). */
export const ICONO_ESTADO: Record<IconoEstado | "pendiente", Icon> = {
  borrador: FileDashed,
  revision: PaperPlaneTilt,
  autorizacion: Signature,
  autorizada: ShieldCheck,
  vigente: CheckCircle,
  obsoleta: Prohibit,
  cancelada: MinusCircle,
  pendiente: Clock,
};

/* Acciones de la ficha (accion principal y menu ⋯). */
export const ICONO_ACCION = {
  enviar: PaperPlaneTilt,
  revisar: ListChecks,
  autorizar: Signature,
  publicar: SealCheck,
  confirmar_lectura: Checks,
  confirmar_vigencia: ListChecks,
  autorizar_renovacion: Signature,
  verificar_externo: ShieldCheck,
  registrar_vigente: SealCheck,
  subir_archivo: CloudArrowUp,
  editar_revision: PencilLine,
  proponer: Lightbulb,
  nueva_revision: Plus,
  renovar: ArrowsClockwise,
  obsoletar: Prohibit,
  reasignar: UserSwitch,
  editar: PencilSimple,
  distribucion: UsersThree,
  descargar: DownloadSimple,
  descargar_fuente: FileArrowDown,
  auditoria: ClockCounterClockwise,
} satisfies Record<string, Icon>;

/* Respaldo para un codigo fuera del catalogo (se usa con una busqueda directa en el mapa, nunca creando el icono en el render). */
export const ICONO_AREA_RESPALDO: Icon = Scroll;
export const ICONO_TIPO_RESPALDO: Icon = File;
