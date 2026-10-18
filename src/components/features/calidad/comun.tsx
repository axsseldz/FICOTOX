"use client";

import { Badge } from "@/components/ui/Primitives";
import { CLASIFICACION_NC_LABEL, ESTADOS_ACCION, ESTADOS_INCIDENCIA, ESTADOS_NC } from "@/lib/shared/calidad";

/* Piezas de presentacion compartidas por las pantallas de calidad (Fase 11). */

type Catalogo = Record<string, { label: string; tone: "neutral" | "brand" | "warning" | "success" | "danger" | "ink" }>;

function EstadoBadge({ catalogo, estado }: { catalogo: Catalogo; estado: unknown }) {
  const meta = catalogo[String(estado || "")];
  return <Badge tone={meta?.tone || "neutral"}>{meta?.label || String(estado || "—")}</Badge>;
}

export const EstadoIncidencia = ({ estado }: { estado: unknown }) => <EstadoBadge catalogo={ESTADOS_INCIDENCIA} estado={estado} />;
export const EstadoNc = ({ estado }: { estado: unknown }) => <EstadoBadge catalogo={ESTADOS_NC} estado={estado} />;
export const EstadoAccion = ({ estado }: { estado: unknown }) => <EstadoBadge catalogo={ESTADOS_ACCION} estado={estado} />;

export function ClasificacionNc({ valor }: { valor: unknown }) {
  if (!valor) return <span className="text-ink-3">Sin clasificar</span>;
  const tone = valor === "critica" ? "danger" : valor === "mayor" ? "warning" : "neutral";
  return <Badge tone={tone}>{CLASIFICACION_NC_LABEL[String(valor)] || String(valor)}</Badge>;
}
