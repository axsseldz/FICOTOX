"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ArrowSquareOut, BookOpenText, FilePdf, FileText, Plus } from "@phosphor-icons/react";
import { useMenuReportar } from "@/components/features/calidad/ReportarIncidencia";
import { FolioChip, StateBadge, SolicitudBadge, SupervisionBadge } from "@/components/features/samples/status";
import { PageBody } from "@/components/shell/AppShell";
import { RequireModule } from "@/components/session/RequireModule";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { FilterChips, FilterMenu, type FilterGroup, type FilterToggle } from "@/components/ui/FilterMenu";
import { ActionMenu, type MenuItem } from "@/components/ui/Overlay";
import { PageHeader, SearchInput, Toolbar } from "@/components/ui/PageHeader";
import { Badge, EmptyState, ErrorState, Skeleton, TableSkeleton } from "@/components/ui/Primitives";
import { FranjaPendientes } from "@/components/features/solicitudes/Solicitudes";
import { StatusCell, StatusFlag } from "@/components/ui/StatusFlag";
import { CellPrimary, COL_FECHA, FILA_LISTA, SOLO_ANCHO, Table, TBody, Td, Th, THead, Tr, TableShell } from "@/components/ui/Table";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { descargarPdfInforme } from "@/lib/client/informes-pdf";
import { cn } from "@/components/ui/cn";
import { contar, fmt, fmtDate } from "@/lib/client/format";
import { useDebouncedValue, useParamChange, useInitialParam } from "@/lib/client/hooks";
import { useResource } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";

type EstadoFilter = "" | "pendiente" | "borrador" | "en_revision" | "autorizado" | "liberado" | "enviado" | "requiere_enmienda" | "sustituido";
const ESTADOS: string[] = ["pendiente", "borrador", "en_revision", "autorizado", "liberado", "enviado", "requiere_enmienda", "sustituido"];

export default function InformesPage() {
  return (
    <PageBody>
      <PageHeader title="Informes de resultados" description="Elaboración, revisión, autorización, liberación y envío por correo de informes al cliente (ISO/IEC 17025 7.8)." />
      <RequireModule modules="informes">
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <InformesContent />
        </Suspense>
      </RequireModule>
    </PageBody>
  );
}

function InformesContent() {
  const { token, can } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const recepcionId = params.get("recepcion") || "";
  const [search, setSearch] = useState(useInitialParam("buscar"));
  useParamChange("buscar", setSearch);
  const initialFilter = params.get("filtro") || "";
  const [estado, setEstado] = useState<EstadoFilter>(ESTADOS.includes(initialFilter) ? (initialFilter as EstadoFilter) : "");
  const [showAnulados, setShowAnulados] = useState(false);
  const debounced = useDebouncedValue(search);
  useParamChange("filtro", (value) => setEstado(ESTADOS.includes(value) ? (value as EstadoFilter) : ""));

  const resource = useResource<{ items: ApiRecord[]; summary: ApiRecord }>(
    "informes",
    async () => {
      const query = new URLSearchParams({ search: debounced.trim() });
      if (estado) query.set("estado", estado);
      if (recepcionId) query.set("recepcion_id", recepcionId);
      if (showAnulados) query.set("anulados", "1");
      const [list, summary] = await Promise.all([getJsonAuth(`${API_BASE_URL}/informes?${query.toString()}`, token), getJsonAuth(`${API_BASE_URL}/informes/summary`, token).catch(() => ({}))]);
      return { items: (list.items || []) as ApiRecord[], summary: summary as ApiRecord };
    },
    { enabled: !!token, deps: [debounced, estado, showAnulados, recepcionId] },
  );
  const items = resource.data?.items;
  const summary = resource.data?.summary || {};
  const canCreate = can("informes", "C");

  const groups: FilterGroup[] = [
    {
      key: "estado",
      label: "Estado",
      value: estado,
      defaultValue: "",
      onChange: (v) => setEstado(v as EstadoFilter),
      options: [
        { value: "", label: "Todos" },
        { value: "pendiente", label: "Por revisar o autorizar", count: resource.data ? Number(summary.borrador || 0) + Number(summary.en_revision || 0) : null, tone: Number(summary.borrador || 0) + Number(summary.en_revision || 0) ? "warning" : "neutral" },
        { value: "borrador", label: "Borradores", count: resource.data ? Number(summary.borrador || 0) : null },
        { value: "en_revision", label: "En revisión", count: resource.data ? Number(summary.en_revision || 0) : null, tone: summary.en_revision ? "warning" : "neutral" },
        { value: "autorizado", label: "Autorizados por liberar", count: resource.data ? Number(summary.autorizados || 0) : null },
        { value: "liberado", label: "Liberados por enviar", count: resource.data ? Number(summary.liberados || 0) : null },
        { value: "enviado", label: "Enviados", count: resource.data ? Number(summary.enviados || 0) : null },
        { value: "requiere_enmienda", label: "Requieren enmienda", tone: "danger" },
        { value: "sustituido", label: "Sustituidos por enmienda" },
      ],
    },
  ];
  const toggles: FilterToggle[] = [{ key: "anulados", label: "Mostrar anulados", checked: showAnulados, onChange: setShowAnulados }];

  const reportar = useMenuReportar();
  const menuFor = (item: ApiRecord): MenuItem[] => [
    { label: "Abrir", description: "Ver el informe y su historial", icon: <ArrowSquareOut size={16} weight="duotone" />, tone: "brand", onSelect: () => router.push(`/informes/${item.id}`) },
    { label: item.archivo_pdf ? "Ver informe" : "Ver PDF", description: item.archivo_pdf ? "Leer el PDF final en la plataforma" : "Vista previa (sin validez) en la plataforma", icon: <BookOpenText size={16} weight="duotone" />, onSelect: () => router.push(`/informes/${item.id}/ver`) },
    ...(item.archivo_pdf ? [{ label: "Descargar PDF", description: "Documento liberado con SHA-256", icon: <FilePdf size={16} weight="duotone" />, onSelect: () => void descargarPdfInforme(item, token) } as MenuItem] : []),
    ...reportar("informes", item.id, String(item.folio || "Informe")),
  ];

  return (
    <>
      <FranjaPendientes entidades={["informes"]} grupo="informes" />
      <Toolbar
        end={
          canCreate ? (
            <Link href="/informes/nuevo" className="press inline-flex h-9 items-center gap-2 rounded-[9px] bg-brand px-3.5 text-[13.5px] font-medium text-on-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] hover:bg-brand-strong">
              <Plus size={16} weight="bold" /> Nuevo informe
            </Link>
          ) : null
        }
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por folio, cliente o ID interno" className="w-full md:w-[340px]" />
        <FilterMenu groups={groups} toggles={toggles} />
        <FilterChips groups={groups} toggles={toggles} />
        {recepcionId ? <Badge tone="brand">Recepción #{recepcionId}</Badge> : null}
      </Toolbar>

      <TableShell footer={items ? contar(items.length, "informe", "informes") : undefined}>
        {resource.error ? (
          <ErrorState message={resource.error} onRetry={resource.reload} />
        ) : !items ? (
          <TableSkeleton cols={7} />
        ) : !items.length ? (
          <EmptyState icon={<FileText size={20} />} title={search ? "Sin coincidencias" : "Sin informes"} description={search ? "Prueba con otro término." : "Crea el informe a partir de una recepción con análisis aprobados."} action={canCreate && !search ? <Button onClick={() => router.push("/informes/nuevo")}>Nuevo informe</Button> : undefined} />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th className="w-[148px]">Folio</Th>
                <Th className="min-w-[260px]">Cliente</Th>
                <Th className="w-[150px]">Recepción</Th>
                <Th align="center" className="w-[90px]">Análisis</Th>
                <Th className={COL_FECHA}>Emisión</Th>
                <Th className={cn("w-[150px]", SOLO_ANCHO)}>Autorizó</Th>
                <Th>Estado</Th>
                <Th align="right" sticky />
              </tr>
            </THead>
            <TBody>
              {items.map((item) => (
                <Tr key={item.id} interactive onClick={() => router.push(`/informes/${item.id}`)} className={cn(FILA_LISTA, ["anulado", "sustituido"].includes(String(item.estado)) && "opacity-60")}>
                  <Td>
                    <span className="flex items-center gap-2">
                      <FolioChip type="IR" num={item.folio_num} />
                      {Number(item.version) > 1 ? <Badge tone="warning">v{String(item.version)}</Badge> : null}
                    </span>
                  </Td>
                  <Td className="min-w-[260px] max-w-[400px]">
                    <CellPrimary lineas={2} title={(item.cliente as ApiRecord)?.nombre || item.solicitante || "-"} subtitle={item.recepcion_id_interno || undefined} />
                  </Td>
                  <Td>{item.folio_recepcion_num ? <FolioChip type="R" num={item.folio_recepcion_num} /> : "-"}</Td>
                  <Td align="center" className="tnum">{fmt(item.analisis)}</Td>
                  <Td muted className={COL_FECHA}>{fmtDate(item.fecha_emision)}</Td>
                  <Td muted className={cn("max-w-[160px]", SOLO_ANCHO)}>
                    <span className="line-clamp-2 break-words" title={item.autorizado_nombre || undefined}>{item.autorizado_nombre || "-"}</span>
                  </Td>
                  <Td>
                    <StatusCell>
                      <StateBadge kind="informe" status={item.estado} />
                      <SupervisionBadge estado={item.supervision_estado} />
                      <SolicitudBadge solicitud={item.solicitud_pendiente as ApiRecord | null} />
                      {Number(item.retenido || 0) ? <StatusFlag kind="bloqueo" label="Retenido por una no conformidad" detail="No se libera ni se envía hasta liberar la retención." data-retenido /> : null}
                      {Number(item.requiere_enmienda || 0) ? <StatusFlag kind="aviso" label="Requiere enmienda" detail={item.requiere_enmienda_motivo ? String(item.requiere_enmienda_motivo) : undefined} data-requiere-enmienda /> : null}
                    </StatusCell>
                    {item.liberado_en ? <p className="mt-1 text-[11.5px] leading-tight text-ink-3">Liberado {fmtDate(item.liberado_en)}</p> : null}
                  </Td>
                  <Td align="right" sticky onClick={(event) => event.stopPropagation()}>
                    <ActionMenu items={menuFor(item)} header={String(item.folio || "")} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </TableShell>
    </>
  );
}
