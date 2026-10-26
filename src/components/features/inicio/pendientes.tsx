import type { ReactNode } from "react";
import { BookOpenText, CalendarBlank, Certificate, ChartLine, ClockCounterClockwise, Database, Eye, FileText, Flask, HandPalm, HourglassLow, ListChecks, Package, Pause, PaperPlaneTilt, PencilLine, Ruler, SealCheck, ShieldWarning, Stamp, TestTube, UserMinus, UserSwitch, WarningDiamond, Wrench } from "@phosphor-icons/react";
import type { Pendiente } from "./tipos";

/* Pendientes de la persona (de /inicio/avisos): etiquetas, iconos y tonos que comparten las píldoras del Inicio y la campana. */

/* Etiqueta corta e icono de cada tipo de pendiente (Para ti y campana). */
export const CORTO: Record<string, { label: string; icono: ReactNode }> = {
  respaldo_viejo: { label: "Sin respaldo reciente", icono: <Database weight="duotone" /> },
  prueba_vieja: { label: "Sin prueba de restauración", icono: <ClockCounterClockwise weight="duotone" /> },
  bitacora_alterada: { label: "Cambio no autorizado", icono: <ShieldWarning weight="duotone" /> },
  por_supervisar: { label: "Por supervisar", icono: <Eye weight="duotone" /> },
  por_autorizar: { label: "Por autorizar", icono: <Stamp weight="duotone" /> },
  analisis_pendientes: { label: "Análisis por firmar", icono: <ChartLine weight="duotone" /> },
  informes_revision: { label: "Informes por revisar", icono: <FileText weight="duotone" /> },
  informes_entrega: { label: "Por liberar o enviar", icono: <PaperPlaneTilt weight="duotone" /> },
  informes_enmienda: { label: "Requieren enmienda", icono: <PencilLine weight="duotone" /> },
  muestras_asignadas: { label: "Asignadas a ti", icono: <TestTube weight="duotone" /> },
  calidad_incidencias: { label: "Por evaluar", icono: <WarningDiamond weight="duotone" /> },
  calidad_acciones: { label: "Tus acciones", icono: <ListChecks weight="duotone" /> },
  calidad_verificaciones: { label: "Verificar eficacia", icono: <SealCheck weight="duotone" /> },
  calidad_retenidos: { label: "Informes retenidos", icono: <HandPalm weight="duotone" /> },
  calidad_suspensiones: { label: "Suspendidos", icono: <Pause weight="duotone" /> },
  calidad_reasignar: { label: "Por reasignar", icono: <UserSwitch weight="duotone" /> },
  documentos_sgc: { label: "Documentos por atender", icono: <FileText weight="duotone" /> },
  documentos_solicitudes: { label: "Tus solicitudes", icono: <Stamp weight="duotone" /> },
  documentos_lecturas: { label: "Lecturas pendientes", icono: <BookOpenText weight="duotone" /> },
  reactivos_bajos: { label: "Stock bajo", icono: <Flask weight="duotone" /> },
  reactivos_caducan: { label: "Por caducar", icono: <HourglassLow weight="duotone" /> },
  consumibles_bajos: { label: "Consumibles bajos", icono: <Package weight="duotone" /> },
  equipos_cal: { label: "Calibración", icono: <Ruler weight="duotone" /> },
  mant_vencidos: { label: "Mantenimiento vencido", icono: <Wrench weight="duotone" /> },
  mant_proximos: { label: "Mantenimiento próximo", icono: <CalendarBlank weight="duotone" /> },
  accesos_vencen: { label: "Accesos por vencer", icono: <UserMinus weight="duotone" /> },
  autorizaciones_vencen: { label: "Autorizaciones por vencer", icono: <Certificate weight="duotone" /> },
};

export const TONO = {
  danger: { circulo: "bg-danger-soft text-danger", anillo: "ring-danger/25", numero: "text-danger" },
  warning: { circulo: "bg-warning-soft text-warning-text", anillo: "ring-warning/25", numero: "text-ink" },
  info: { circulo: "bg-brand-soft text-brand-strong", anillo: "ring-brand/20", numero: "text-ink" },
} as const;

const PESO = { danger: 0, warning: 1, info: 2 } as const;

export const ordenarPendientes = (lista: Pendiente[]) => [...lista].filter((p) => p.count > 0).sort((a, b) => PESO[a.tone] - PESO[b.tone]);

/* Ventana que abre cada elemento: incidencias y NC con la ventana de Calidad; lo demas, su lista o su ficha. */
export const ventanaDe = (href: string): { tipo: "incidencia" | "nc"; id: number } | null => {
  const inc = href.match(/^\/calidad\/incidencias\/(\d+)/);
  if (inc) return { tipo: "incidencia", id: Number(inc[1]) };
  const nc = href.match(/^\/calidad\/nc\/(\d+)/);
  return nc ? { tipo: "nc", id: Number(nc[1]) } : null;
};
