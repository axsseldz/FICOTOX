"use client";

import type { ReactNode } from "react";
import { ArrowClockwise, ArrowCounterClockwise, ArrowRight, ArrowsClockwise, ArrowUUpLeft, Archive, BookOpenText, Books, CalendarBlank, Certificate, ChartLine, ChatCircleDots, CheckCircle, ClockCounterClockwise, ClockCountdown, Database, DownloadSimple, Eye, FileText, Flask, FolderOpen, Gear, HandPalm, Handshake, Hash, IdentificationBadge, Key, Lightbulb, ListChecks, LockKey, LockOpen, Megaphone, Package, Pause, PaperPlaneTilt, Paperclip, PencilLine, PencilSimple, Play, Plus, Printer, Prohibit, Scales, SealCheck, SealWarning, ShieldCheck, ShieldWarning, Signature, SignIn, SignOut, Tag, TestTube, ThumbsUp, Toolbox, Trash, UploadSimple, UserMinus, UsersThree, UserSwitch, Warning, WarningDiamond, Wrench, XCircle } from "@phosphor-icons/react";
import { cn } from "@/components/ui/cn";
import type { HumanEntry } from "@/lib/client/audit-humanize";

/*
 * Tipos de actividad de la bitacora (filtro "Tipo de actividad" y color del
 * icono de cada renglon). El filtro manda al servidor la lista de acciones
 * de cada tipo (`acciones=`). Los inicios de sesion no son un tipo: se
 * muestran con "Vista › Mostrar inicios de sesión".
 */

export type Categoria = "crear" | "cambiar" | "firmar" | "anular" | "solicitudes" | "imprimir" | "sistema";

export const CATEGORIAS: Array<{ value: Categoria; label: string; acciones: string[] }> = [
  { value: "crear", label: "Creaciones", acciones: ["crear", "importar", "proponer", "enmendar", "reponer", "adjuntar", "reportar", "comunicar", "afectar", "subir", "subir_version"] },
  { value: "cambiar", label: "Cambios", acciones: ["editar", "restaurar", "reactivar", "cambiar_folio", "reabrir", "cambiar_vigencia", "cambiar_cargo", "asignar_muestra", "revocar_asignacion", "cerrar", "evaluar", "avanzar", "iniciar_accion", "reasignar", "asignar_rol", "acotar_rol", "otorgar_autorizacion", "bloquear", "desbloquear", "cambiar_password", "restablecer_password", "categoria", "archivar"] },
  { value: "firmar", label: "Firmas y aprobaciones", acciones: ["revisar", "aprobar", "autorizar", "liberar", "visto_bueno", "aceptar", "enviar_revision", "publicar", "confirmar_firma", "confirmar_lectura", "confirmar_envio", "enviar", "entregar", "cerrar_sin_nc", "implementar", "verificar", "reanudar", "liberar_retencion"] },
  { value: "anular", label: "Anulaciones y rechazos", acciones: ["anular", "rechazar", "baja", "eliminar", "devolver", "sustituir", "regresar_supervision", "revocar_autorizacion", "revocar_rol", "anular_adjunto", "escalar", "cancelar", "suspender", "retener"] },
  { value: "solicitudes", label: "Solicitudes", acciones: ["solicitar", "aprobar_solicitud", "rechazar_solicitud", "cancelar_solicitud", "vencer_solicitud"] },
  { value: "imprimir", label: "Impresiones y descargas", acciones: ["imprimir_etiquetas", "descargar", "exportar"] },
  { value: "sistema", label: "Sistema", acciones: ["migrar", "respaldar", "respaldo_fallido", "probar_restauracion", "restaurar_respaldo", "alerta_integridad", "vencer_rol", "vencer_autorizacion", "vencer_mantenimiento", "requiere_enmienda"] },
];

const POR_ACCION = new Map<string, Categoria>(CATEGORIAS.flatMap((c) => c.acciones.map((a) => [a, c.value] as [string, Categoria])));

function categoriaDe(entry: Pick<HumanEntry, "verb" | "isSystem">): Categoria {
  if (["login", "login_fallido", "reauth_fallida", "cerrar_sesiones"].includes(entry.verb)) return "cambiar";
  const categoria = POR_ACCION.get(entry.verb) || "cambiar";
  // Lo que hace la plataforma por su cuenta (vencimientos, avisos) se pinta como sistema.
  return entry.isSystem ? "sistema" : categoria;
}

const TONO: Record<Categoria, string> = {
  crear: "bg-brand-soft text-brand-strong",
  cambiar: "bg-surface-3 text-ink-2",
  firmar: "bg-success-soft text-success-text",
  anular: "bg-danger-soft text-danger",
  solicitudes: "bg-warning-soft text-warning-text",
  imprimir: "bg-deep-2/10 text-deep-2",
  sistema: "bg-surface-3 text-ink-3",
};

const ICONO_ACCION: Record<string, ReactNode> = {
  crear: <Plus weight="bold" />,
  importar: <UploadSimple weight="bold" />,
  subir: <UploadSimple weight="bold" />,
  subir_version: <UploadSimple weight="bold" />,
  reponer: <Package weight="bold" />,
  editar: <PencilSimple weight="bold" />,
  restaurar: <ArrowCounterClockwise weight="bold" />,
  reactivar: <ArrowClockwise weight="bold" />,
  revisar: <Eye weight="bold" />,
  aprobar: <SealCheck weight="bold" />,
  autorizar: <ShieldCheck weight="bold" />,
  liberar: <ShieldCheck weight="bold" />,
  aceptar: <CheckCircle weight="bold" />,
  enviar: <PaperPlaneTilt weight="bold" />,
  enviar_revision: <PaperPlaneTilt weight="bold" />,
  anular: <Prohibit weight="bold" />,
  rechazar: <XCircle weight="bold" />,
  baja: <Archive weight="bold" />,
  archivar: <Archive weight="bold" />,
  cerrar: <LockKey weight="bold" />,
  login: <SignIn weight="bold" />,
  login_fallido: <Warning weight="bold" />,
  reauth_fallida: <Warning weight="bold" />,
  bloquear: <LockKey weight="bold" />,
  asignar_rol: <UserSwitch weight="bold" />,
  imprimir_etiquetas: <Printer weight="bold" />,
  descargar: <DownloadSimple weight="bold" />,
  exportar: <DownloadSimple weight="bold" />,
  alerta_integridad: <ShieldWarning weight="bold" />,
  adjuntar: <Paperclip weight="bold" />,
  anular_adjunto: <Paperclip weight="bold" />,
  respaldar: <Database weight="bold" />,
  respaldo_fallido: <Database weight="bold" />,
  probar_restauracion: <Database weight="bold" />,
  restaurar_respaldo: <Database weight="bold" />,
  migrar: <Gear weight="bold" />,
  solicitar: <ChatCircleDots weight="bold" />,
  aprobar_solicitud: <CheckCircle weight="bold" />,
  rechazar_solicitud: <XCircle weight="bold" />,
  cancelar_solicitud: <Prohibit weight="bold" />,
  vencer_solicitud: <ClockCountdown weight="bold" />,
  vencer_mantenimiento: <ClockCountdown weight="bold" />,
  proponer: <Lightbulb weight="bold" />,
  enmendar: <PencilLine weight="bold" />,
  requiere_enmienda: <PencilLine weight="bold" />,
  reportar: <Megaphone weight="bold" />,
  comunicar: <Megaphone weight="bold" />,
  visto_bueno: <ThumbsUp weight="bold" />,
  confirmar_firma: <Signature weight="bold" />,
  confirmar_lectura: <BookOpenText weight="bold" />,
  confirmar_envio: <PaperPlaneTilt weight="bold" />,
  publicar: <Megaphone weight="bold" />,
  entregar: <Handshake weight="bold" />,
  verificar: <ListChecks weight="bold" />,
  implementar: <ListChecks weight="bold" />,
  cerrar_sin_nc: <CheckCircle weight="bold" />,
  reanudar: <Play weight="bold" />,
  suspender: <Pause weight="bold" />,
  retener: <HandPalm weight="bold" />,
  liberar_retencion: <ShieldCheck weight="bold" />,
  eliminar: <Trash weight="bold" />,
  devolver: <ArrowUUpLeft weight="bold" />,
  regresar_supervision: <ArrowUUpLeft weight="bold" />,
  sustituir: <ArrowsClockwise weight="bold" />,
  escalar: <SealWarning weight="bold" />,
  cancelar: <Prohibit weight="bold" />,
  reabrir: <FolderOpen weight="bold" />,
  evaluar: <Scales weight="bold" />,
  avanzar: <ArrowRight weight="bold" />,
  reasignar: <UserSwitch weight="bold" />,
  acotar_rol: <UserSwitch weight="bold" />,
  revocar_rol: <UserMinus weight="bold" />,
  vencer_rol: <ClockCountdown weight="bold" />,
  otorgar_autorizacion: <Certificate weight="bold" />,
  revocar_autorizacion: <Certificate weight="bold" />,
  vencer_autorizacion: <ClockCountdown weight="bold" />,
  desbloquear: <LockOpen weight="bold" />,
  cambiar_password: <Key weight="bold" />,
  restablecer_password: <Key weight="bold" />,
  cerrar_sesiones: <SignOut weight="bold" />,
  cambiar_folio: <Hash weight="bold" />,
  cambiar_vigencia: <CalendarBlank weight="bold" />,
  cambiar_cargo: <IdentificationBadge weight="bold" />,
  asignar_muestra: <TestTube weight="bold" />,
  revocar_asignacion: <TestTube weight="bold" />,
  afectar: <Flask weight="bold" />,
  categoria: <Tag weight="bold" />,
};

const ICONO_CATEGORIA: Record<Categoria, ReactNode> = {
  crear: <Plus weight="bold" />,
  cambiar: <PencilSimple weight="bold" />,
  firmar: <SealCheck weight="bold" />,
  anular: <Prohibit weight="bold" />,
  solicitudes: <ChatCircleDots weight="bold" />,
  imprimir: <Printer weight="bold" />,
  sistema: <Gear weight="bold" />,
};

/* Icono redondo y suave de la actividad, con el color de su tipo. */
export function EntryIcon({ entry, size = "md" }: { entry: HumanEntry; size?: "sm" | "md" | "lg" }) {
  const categoria = categoriaDe(entry);
  const dim = { sm: "h-9 w-9 text-[16px]", md: "h-10 w-10 text-[17px]", lg: "h-16 w-16 text-[28px]" }[size];
  const alerta = entry.verb === "alerta_integridad" || entry.verb === "login_fallido";
  return (
    <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center rounded-full [&>svg]:h-[1em] [&>svg]:w-[1em]", dim, alerta ? "bg-danger-soft text-danger" : TONO[categoria])}>
      {ICONO_ACCION[entry.verb] || ICONO_CATEGORIA[categoria]}
    </span>
  );
}

/* Icono del area donde ocurrio la actividad (muestras, inventario, calidad, cuentas…). */
const ICONO_AREA: Record<string, ReactNode> = {
  muestras_recepcion: <TestTube weight="duotone" />,
  muestras_procesamiento: <Flask weight="duotone" />,
  muestras_extraccion: <Flask weight="duotone" />,
  muestras_analisis: <ChartLine weight="duotone" />,
  informes: <FileText weight="duotone" />,
  documentos_sgc: <Books weight="duotone" />,
  biblioteca_documentos: <Books weight="duotone" />,
  biblioteca_categorias: <Books weight="duotone" />,
  sgc_documentos: <Books weight="duotone" />,
  reactivos: <Flask weight="duotone" />,
  consumibles: <Package weight="duotone" />,
  equipos: <Toolbox weight="duotone" />,
  mantenimientos: <Wrench weight="duotone" />,
  reportes_mantenimiento: <Wrench weight="duotone" />,
  usuarios: <UsersThree weight="duotone" />,
  roles: <IdentificationBadge weight="duotone" />,
  sesion: <SignIn weight="duotone" />,
  respaldos: <Database weight="duotone" />,
  incidencias: <WarningDiamond weight="duotone" />,
  no_conformidades: <SealWarning weight="duotone" />,
  acciones_correctivas: <ListChecks weight="duotone" />,
  suspensiones: <Pause weight="duotone" />,
  esquema: <Gear weight="duotone" />,
  auditoria: <ClockCounterClockwise weight="duotone" />,
};

export function IconoArea({ entidad, className }: { entidad?: string; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-surface text-[18px] text-brand-strong shadow-card [&>svg]:h-[1em] [&>svg]:w-[1em]", className)}>
      {ICONO_AREA[String(entidad || "")] || <Gear weight="duotone" />}
    </span>
  );
}
