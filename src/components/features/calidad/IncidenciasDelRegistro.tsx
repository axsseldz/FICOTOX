"use client";

import Link from "next/link";
import { WarningDiamond } from "@phosphor-icons/react";
import { FormCard } from "@/components/features/samples/FormLayout";
import { FolioChip } from "@/components/features/samples/status";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { fmtDate } from "@/lib/client/format";
import { useResource } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { TIPO_INCIDENCIA_LABEL } from "@/lib/shared/calidad";
import { EstadoIncidencia } from "./comun";
import { reportarIncidencia, usePuedeReportar } from "./ReportarIncidencia";

/*
 * Incidencias que mencionan un registro (Fase 11), en su ficha. El servidor
 * aplica el alcance: con "incidencias" solo salen las que reporto la persona.
 */
export function IncidenciasDelRegistro({ entidad, id, etiqueta }: { entidad: string; id: unknown; etiqueta: string }) {
  const { token, can } = useSession();
  const puedeVer = can("calidad", "V", { objeto: "incidencia" });
  const puedeReportar = usePuedeReportar();
  const recurso = useResource<ApiRecord>("calidad", () => getJsonAuth(`${API_BASE_URL}/calidad/incidencias?entidad=${encodeURIComponent(entidad)}&entidad_id=${encodeURIComponent(String(id))}&anuladas=1`, token), { enabled: !!token && puedeVer && !!id, deps: [entidad, id] });
  if (!id || (!puedeVer && !puedeReportar)) return null;
  const items = (recurso.data?.items || []) as ApiRecord[];
  return (
    <div className="flex flex-col gap-2" data-incidencias-registro={entidad}>
      {puedeVer && items.length ? (
        <ul className="flex flex-col gap-1.5">
          {items.map((i) => (
            <li key={String(i.id)}>
              <Link href={`/calidad/incidencias/${i.id}`} className="press flex flex-wrap items-center gap-2 rounded-field bg-surface-2 px-3 py-2 text-sm ring-1 ring-line hover:bg-surface-3">
                <FolioChip type="INC" num={i.folio_num} />
                <span className="min-w-0 flex-1 truncate text-ink">{TIPO_INCIDENCIA_LABEL[String(i.tipo)] || String(i.tipo)} · {String(i.descripcion)}</span>
                <span className="text-xs text-ink-3">{fmtDate(i.reportada_en)}</span>
                <EstadoIncidencia estado={i.estado} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-3">{puedeVer ? (recurso.data ? "Ninguna incidencia menciona este registro." : "Cargando…") : "Puedes reportar una incidencia ligada a este registro."}</p>
      )}
      {puedeReportar ? (
        <Button variant="secondary" size="sm" icon={<WarningDiamond size={14} />} onClick={() => reportarIncidencia([{ entidad, entidad_id: Number(id), etiqueta }])} className="self-start">
          Reportar incidencia
        </Button>
      ) : null}
    </div>
  );
}

/* La misma lista como tarjeta de los formatos de pagina (fuera de la guia de secciones). */
export function IncidenciasFormCard(props: { entidad: string; id: unknown; etiqueta: string }) {
  const { can } = useSession();
  if (!props.id || !can("calidad", "C", { objeto: "incidencia" }) && !can("calidad", "V", { objeto: "incidencia" })) return null;
  return (
    <FormCard id="sec-incidencias" title="Incidencias" description="Incidencias que mencionan este registro (Calidad › Incidencias y NC).">
      <IncidenciasDelRegistro {...props} />
    </FormCard>
  );
}
