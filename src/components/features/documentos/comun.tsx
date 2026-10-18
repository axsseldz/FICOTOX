"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CaretRight, FolderOpen, FolderSimple, Globe, LockKey } from "@phosphor-icons/react";
import { useSession } from "@/components/session/SessionProvider";
import { cn } from "@/components/ui/cn";
import { Badge, EmptyState } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { useResource } from "@/lib/client/store";
import { hoyLocal, sumarDias } from "@/lib/shared/fechas";
import { ESTADO_DOCUMENTO, ESTADO_REVISION, ESTADOS_SOLICITUD_SGC, etiquetaConfidencialidad, type EstadoDocumento, type EstadoRevision } from "@/lib/shared/documentos";
import type { AccionDocumental } from "@/lib/shared/permisos";
import { ICONO_AREA, ICONO_AREA_RESPALDO, ICONO_ESTADO, ICONO_SOLICITUD } from "./iconos";

/*
 * Documentos SGC: piezas compartidas de las pantallas (inicio por carpetas,
 * explorador y ficha). El color identifica el AREA de gestion (icono o banda
 * lateral, nunca un fondo saturado detras de texto) y nunca el estado; los
 * estados van como etiquetas con texto e icono.
 */

export interface Area {
  codigo: string;
  nombre: string;
  color: string;
  orden?: number;
  activo?: number;
}
export interface Tipo {
  codigo: string;
  nombre: string;
  descripcion?: string | null;
}
export interface Persona {
  id: number;
  nombre: string;
  email: string;
  acciones: AccionDocumental[];
}
export interface Catalogos {
  areas: Area[];
  tipos: Tipo[];
  personas: Persona[];
  roles: Array<{ id: number; nombre: string; consulta: boolean; acusa: boolean }>;
  yo: { id: number; acciones: AccionDocumental[]; diagnostico: boolean; privilegiado: boolean };
  puede: { crear_ficha: boolean };
  max_mb: number;
}
export interface ResumenRevision {
  id: number;
  numero: number;
  estado: EstadoRevision;
  fecha_emision: string | null;
  fecha_vigencia: string | null;
  fecha_proxima_revision: string | null;
}
export interface DocLista {
  id: number;
  clave: string;
  titulo: string;
  area_codigo: string;
  tipo_codigo: string;
  origen: "interno" | "externo";
  proceso: string | null;
  confidencialidad: string;
  palabras_clave: string[];
  propietario_id: number | null;
  propietario_nombre: string | null;
  estado: EstadoDocumento;
  vigente: ResumenRevision | null;
  trabajo: ResumenRevision | null;
  pendiente_revision: boolean;
  creado_en: string;
  actualizado_en: string;
}
export interface Puede {
  ok: boolean;
  motivo?: string;
}
export interface Archivo {
  id: number;
  revision_id: number;
  tipo: "pdf" | "fuente";
  nombre_original: string;
  extension: string;
  tamano_bytes: number;
  sha256: string;
  subido_en: string;
  subido_por_nombre: string | null;
  reemplazado_en: string | null;
}
export interface Revision {
  id: number;
  numero: number;
  estado: EstadoRevision;
  fecha_emision: string | null;
  fecha_vigencia: string | null;
  fecha_proxima_revision: string | null;
  motivo_cambio: string | null;
  apartados_afectados: string | null;
  descripcion_cambio: string | null;
  elaborador_id: number | null;
  revisor_id: number | null;
  autorizador_id: number | null;
  elaborador_nombre: string | null;
  revisor_nombre: string | null;
  autorizador_nombre: string | null;
  enviada_revision_en: string | null;
  publicada_en: string | null;
  publicada_por_nombre: string | null;
  fecha_obsolescencia: string | null;
  ubicacion_historica: string | null;
  regla_conservacion: string | null;
  origen_registro: string;
  creado_en: string;
  archivos: Archivo[];
  abrir: boolean;
  fecha_limite: string | null;
  revisada_en: string | null;
  autorizada_en: string | null;
  cancelada_en: string | null;
  sustituida_por_id: number | null;
  renovada_en: string | null;
  version_externa: string | null;
  linea_tiempo: PasoFlujo[];
  puede: Record<"subir_archivo" | "editar" | "asignar" | "enviar_revision" | "registrar_vigente" | "revisar" | "autorizar" | "publicar" | "reasignar", Puede>;
}
export interface PasoFlujo {
  id: number;
  accion: string;
  decision: string | null;
  comentario: string | null;
  usuario_nombre: string | null;
  cargo: string | null;
  papel: string | null;
  fecha: string;
  renovacion_id: number | null;
}
export interface Renovacion {
  id: number;
  revision_id: number;
  estado: "en_revision" | "en_autorizacion" | "completada" | "cancelada";
  revisor_nombre: string | null;
  autorizador_nombre: string | null;
  solicitado_por_nombre: string | null;
  fecha_proxima_anterior: string | null;
  fecha_proxima_nueva: string;
  fecha_limite: string | null;
  creado_en: string;
  autorizada_en: string | null;
  puede: { revisar: Puede; autorizar: Puede };
}
export interface Evento {
  id: number;
  fecha_hora: string;
  usuario_nombre: string | null;
  usuario_email: string | null;
  accion: string;
  referencia: string | null;
  motivo: string | null;
  cambios: Record<string, unknown>;
}
export interface FichaDocumento {
  item: {
    id: number;
    clave: string;
    titulo: string;
    area: Area;
    tipo: Tipo;
    origen: "interno" | "externo";
    proceso: string | null;
    confidencialidad: string;
    palabras_clave: string[];
    propietario_id: number | null;
    propietario_nombre: string | null;
    estado: EstadoDocumento;
    pendiente_revision: boolean;
    obsoleto_en: string | null;
    obsoleto_por_nombre: string | null;
    motivo_obsolescencia: string | null;
    obsolescencia_pendiente: number | null;
    revision_vigente_id: number | null;
    creado_por_nombre: string | null;
    creado_en: string;
    actualizado_en: string | null;
  };
  revisiones: Revision[];
  revisiones_ocultas: number;
  historial: boolean;
  solo_diagnostico: boolean;
  eventos: Evento[];
  externo: DatosExterno | null;
  distribucion: Distribucion | null;
  renovaciones: Renovacion[];
  puede: { editar: Puede; nueva_revision: Puede; renovar: Puede; obsoletar: Puede; proponer: Puede };
}

export interface DatosExterno {
  fuente: string | null;
  version_fecha: string | null;
  enlace: string | null;
  responsable_id: number | null;
  responsable_nombre: string | null;
  ultima_verificacion: string | null;
  proxima_revision: string | null;
  puede: { verificar: Puede; nueva_version: Puede; editar: Puede };
}
export interface Destinatario {
  usuario_id: number;
  nombre: string;
  requiere: boolean;
  puntos: string[];
  leido_en: string | null;
  abierto_en: string | null;
  notificado_en: string | null;
}
export interface FilaDistribucion {
  id: number;
  rol_id: number | null;
  rol_nombre: string | null;
  usuario_id: number | null;
  usuario_nombre: string | null;
  punto_uso: string | null;
  requiere_lectura: boolean;
  motivo: string | null;
  creado_en: string;
  creado_por_nombre: string | null;
}
/* Distribucion y lecturas de la revision vigente (CA-11). */
export interface Distribucion {
  revision_id: number;
  numero: number;
  puntos_uso: string[];
  filas: FilaDistribucion[];
  destinatarios: Destinatario[];
  avance: { leidos: number; total: number; porcentaje: number | null };
  mi_lectura: { requiere: boolean; leido_en: string | null; puntos: string[] } | null;
  completo: boolean;
  puede: { administrar: Puede; recordatorio: Puede; acusar: Puede };
}

/* Etiqueta de origen externo (normas, guias, documentos regulatorios). */
export function ExternoEtiqueta() {
  return (
    <span className="inline-flex" data-testid="etiqueta-externo">
      <Badge tone="neutral" className="gap-1">
        <Globe size={12} weight="bold" aria-hidden="true" />
        Externo
      </Badge>
    </span>
  );
}

/* Catalogos (areas, tipos, personas) y lo que puede la persona. */
export function useCatalogos() {
  const { token } = useSession();
  return useResource<Catalogos>("sgc-catalogos", async () => (await getJsonAuth(`${API_BASE_URL}/sgc/catalogos`, token)) as unknown as Catalogos, { enabled: !!token });
}

/* Acceso a las pantallas: alguna accion documental, o administracion tecnica (solo metadatos). */
export function RequireDocumentos({ children }: { children: ReactNode }) {
  const { can } = useSession();
  if (!can("documentos") && !can("usuarios", "G")) {
    return <EmptyState icon={<LockKey size={20} />} title="Sin acceso a Documentos SGC" description="Tus roles no tienen acciones documentales. Pide a la administración que revise tus roles." />;
  }
  return <>{children}</>;
}

/* Estado de una revision: etiqueta con icono y texto (el color nunca es la unica senal). */
export function EstadoRevisionEtiqueta({ estado, className }: { estado: EstadoRevision | string; className?: string }) {
  const def = ESTADO_REVISION[estado as EstadoRevision] || ESTADO_REVISION.borrador;
  const I = ICONO_ESTADO[def.icono];
  return (
    <Badge tone={def.tono} className={cn("gap-1", className)}>
      <I size={12} weight="bold" aria-hidden="true" />
      {def.etiqueta}
    </Badge>
  );
}

export function EstadoDocumentoEtiqueta({ estado }: { estado: EstadoDocumento | string }) {
  const def = ESTADO_DOCUMENTO[estado as EstadoDocumento] || ESTADO_DOCUMENTO.en_elaboracion;
  const I = ICONO_ESTADO[def.icono];
  return (
    <Badge tone={def.tono} className="gap-1">
      <I size={12} weight="bold" aria-hidden="true" />
      {def.etiqueta}
    </Badge>
  );
}

/* Pendiente de revision: faltan 30 dias o menos para la proxima revision, o ya paso. */
export function ProximaRevisionEtiqueta({ fecha }: { fecha: string | null | undefined }) {
  if (!fecha) return null;
  const hoy = hoyLocal();
  const limite = sumarDias(hoy, 30);
  if (fecha > limite) return null;
  return (
    <Badge tone="warning" className="gap-1">
      <ICONO_ESTADO.pendiente size={12} weight="bold" aria-hidden="true" />
      {fecha < hoy ? "Pendiente de revisión · vencida" : "Pendiente de revisión"}
    </Badge>
  );
}

/* Confidencialidad distinta de "uso interno": etiqueta con candado. */
export function ConfidencialidadEtiqueta({ valor }: { valor: string }) {
  if (!valor || valor === "uso_interno") return null;
  return (
    <Badge tone="neutral" className="gap-1">
      <LockKey size={12} weight="bold" aria-hidden="true" />
      {etiquetaConfidencialidad(valor)}
    </Badge>
  );
}

/*
 * Icono del area en su color (HEX exacto). `carpeta`: la carpeta del inicio, que
 * "se abre" al pasar el cursor o con el foco (solo opacidad; quieta con movimiento
 * reducido), con el icono del area en una insignia.
 */
export function IconoArea({ area, size = "md", carpeta = false }: { area: Pick<Area, "codigo" | "nombre" | "color">; size?: "sm" | "md" | "lg"; carpeta?: boolean }) {
  const caja = { sm: "h-8 w-8 rounded-[9px]", md: "h-11 w-11 rounded-[12px]", lg: "h-14 w-14 rounded-[15px]" }[size];
  const icono = { sm: 17, md: 23, lg: 30 }[size];
  const Glifo = ICONO_AREA[area.codigo] ?? ICONO_AREA_RESPALDO;
  if (!carpeta) {
    return (
      <span className={cn("icono-area relative flex shrink-0 items-center justify-center bg-surface-2 ring-1 ring-line", caja)} aria-hidden="true">
        <Glifo size={icono} weight="duotone" style={{ color: area.color }} />
      </span>
    );
  }
  const fundido = "transition-opacity duration-200 ease-[var(--ease-fluid)] motion-reduce:transition-none";
  return (
    <span className={cn("icono-area relative flex shrink-0 items-center justify-center bg-surface-2 ring-1 ring-line", caja)} aria-hidden="true">
      <FolderSimple size={icono} weight="fill" style={{ color: area.color }} className={cn(fundido, "group-hover:opacity-0 group-focus-visible:opacity-0")} />
      <FolderOpen size={icono} weight="fill" style={{ color: area.color }} className={cn(fundido, "absolute opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100")} />
      <span className="absolute -right-1.5 -bottom-1.5 flex h-[20px] w-[20px] items-center justify-center rounded-full bg-surface ring-1 ring-line">
        <Glifo size={12} weight="bold" style={{ color: area.color }} />
      </span>
    </span>
  );
}

/* Ruta corta: Documentos › Gestión › Tipo › Documento. */
export function RutaDocumentos({ area, tipo, documento }: { area?: Pick<Area, "codigo" | "nombre"> | null; tipo?: Pick<Tipo, "codigo" | "nombre"> | null; documento?: string | null }) {
  const pasos: Array<{ label: string; href?: string }> = [{ label: "Documentos", href: "/documentos" }];
  if (area) pasos.push({ label: area.nombre, href: `/documentos/explorar?area=${area.codigo}` });
  if (area && tipo) pasos.push({ label: tipo.nombre, href: `/documentos/explorar?area=${area.codigo}&tipo=${tipo.codigo}` });
  else if (tipo) pasos.push({ label: tipo.nombre, href: `/documentos/explorar?tipo=${tipo.codigo}` });
  if (documento) pasos.push({ label: documento });
  return (
    <nav aria-label="Ruta" data-testid="ruta-documentos">
      <ol className="flex flex-wrap items-center gap-1 text-[12.5px] text-ink-3">
        {pasos.map((p, i) => {
          const ultimo = i === pasos.length - 1;
          return (
            <li key={`${p.label}-${i}`} className="flex items-center gap-1">
              {p.href && !ultimo ? (
                <Link href={p.href} className="rounded-[4px] hover:text-ink hover:underline focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none">
                  {p.label}
                </Link>
              ) : (
                <span aria-current={ultimo ? "page" : undefined} className={ultimo ? "font-medium text-ink-2" : undefined}>
                  {p.label}
                </span>
              )}
              {!ultimo ? <CaretRight size={11} aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* Nombre del tipo documental por codigo (con el codigo si no esta en el catalogo). */
export const nombreTipo = (tipos: Tipo[] | undefined, codigo: string) => tipos?.find((t) => t.codigo === codigo)?.nombre || codigo;
export const areaDe = (areas: Area[] | undefined, codigo: string): Area => areas?.find((a) => a.codigo === codigo) || { codigo, nombre: codigo, color: "#7d8b96" };

/* Area de un documento a partir de su clave FX (FX-TCP-… -> TC); los rectores (FX-MC, FX-MO) son DI. Null si no es una clave FX. */
export function areaDeClave(areas: Area[] | undefined, clave: string | null | undefined): Area | null {
  const c = String(clave || "").toUpperCase();
  const m = /^FX-([A-Z]{2})[A-Z]-/.exec(c);
  const codigo = m ? m[1] : /^FX-M[CO]\b/.test(c) ? "DI" : null;
  return codigo ? areaDe(areas, codigo) : null;
}

/* Estado de una solicitud: etiqueta con icono y texto. */
export function EstadoSolicitudEtiqueta({ estado }: { estado: string }) {
  const def = ESTADOS_SOLICITUD_SGC[estado] || { etiqueta: estado, tono: "neutral" as const };
  const I = ICONO_SOLICITUD[estado] || ICONO_SOLICITUD.pendiente;
  return (
    <Badge tone={def.tono} className="gap-1">
      <I size={12} weight="bold" aria-hidden="true" />
      {def.etiqueta}
    </Badge>
  );
}
