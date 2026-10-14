"use client";

import { use, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ClockCounterClockwise, CloudArrowUp, DownloadSimple, FilePdf, FileText, Info, PaperPlaneTilt, PencilSimple, Plus, SealCheck, UsersThree } from "@phosphor-icons/react";
import { ConfidencialidadEtiqueta, EstadoDocumentoEtiqueta, EstadoRevisionEtiqueta, IconoArea, ProximaRevisionEtiqueta, RequireDocumentos, RutaDocumentos, useCatalogos, type Archivo, type FichaDocumento, type Puede, type Revision } from "@/components/features/documentos/comun";
import { FichaSheet } from "@/components/features/documentos/FichaSheet";
import { ArchivoDialog, RegistrarVigenteDialog, RevisionSheet } from "@/components/features/documentos/RevisionSheets";
import { Callout } from "@/components/features/samples/FormLayout";
import { useAncho } from "@/components/features/visor/comun";
import { descargarUrl } from "@/components/features/visor/usarArchivo";
import { VisorPdf } from "@/components/features/visor/VisorPdf";
import { PageBody } from "@/components/shell/AppShell";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { useConfirm } from "@/components/ui/Overlay";
import { Badge, EmptyState, ErrorState, Skeleton } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth, sendJsonAuth } from "@/lib/client/api";
import { humanizeAuditEntry } from "@/lib/client/audit-humanize";
import { explicarError } from "@/lib/client/mensajes";
import { urlArchivoSgc } from "@/lib/client/pdf";
import { invalidate, useResource } from "@/lib/client/store";
import { fmtBytes, huellaCorta } from "@/lib/shared/adjuntos";
import { etiquetaConfidencialidad } from "@/lib/shared/documentos";
import { formatearFecha, formatearFechaHora } from "@/lib/shared/fechas";

/*
 * Ficha del documento: metadatos, revision vigente en el visor PDF interno,
 * revision en curso (archivos y acciones segun el servidor: banderas "puede"
 * con motivo), historial de revisiones y eventos de la bitacora (con permiso),
 * responsables, y distribucion y lecturas (Fase 3).
 */
export default function FichaDocumentoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireDocumentos>
      <Ficha id={id} />
    </RequireDocumentos>
  );
}

const activo = (r: Revision | null | undefined, tipo: "pdf" | "fuente") => r?.archivos.find((a) => a.tipo === tipo && !a.reemplazado_en) || null;

function Ficha({ id }: { id: string }) {
  const { token } = useSession();
  const catalogos = useCatalogos();
  const confirm = useConfirm();
  const amplia = useAncho(1024);
  const [editar, setEditar] = useState(false);
  const [revisionSheet, setRevisionSheet] = useState<{ revision: Revision | null } | null>(null);
  const [archivoDe, setArchivoDe] = useState<Revision | null>(null);
  const [vigenteDe, setVigenteDe] = useState<Revision | null>(null);
  const [enviando, setEnviando] = useState(false);
  const recurso = useResource<FichaDocumento>(["sgc", `sgc:${id}`], async () => (await getJsonAuth(`${API_BASE_URL}/sgc/documentos/${encodeURIComponent(id)}`, token)) as unknown as FichaDocumento, { enabled: !!token });

  if (recurso.error) {
    const e = explicarError(new Error(recurso.error), "No se pudo abrir el documento");
    return (
      <PageBody>
        <RutaDocumentos />
        <div className="rounded-card bg-surface shadow-card" data-testid="sgc-no-encontrado">
          <ErrorState message={e.que} onRetry={recurso.reload} />
        </div>
      </PageBody>
    );
  }
  const data = recurso.data;
  if (!data) {
    return (
      <PageBody>
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-[120px] rounded-card" />
        <Skeleton className="h-[480px] rounded-card" />
      </PageBody>
    );
  }
  const { item, revisiones } = data;
  const vigente = revisiones.find((r) => r.estado === "vigente") || null;
  const enCurso = revisiones.find((r) => ["borrador", "en_revision", "en_autorizacion", "autorizada"].includes(r.estado)) || null;
  const pdfVigente = activo(vigente, "pdf");
  const fuenteVigente = activo(vigente, "fuente");

  const descargar = async (a: Archivo) => {
    try {
      await descargarUrl(urlArchivoSgc(a.id, "descargar"), token, a.nombre_original);
    } catch (err) {
      const e = explicarError(err, "No se pudo descargar el archivo");
      toast.error(e.que, { description: e.hacer });
    }
  };

  const enviar = async (r: Revision) => {
    const ok = await confirm({ title: `Enviar a revisión la revisión ${r.numero}`, description: "Se bloquea el borrador y se remite al revisor asignado. Desde ese momento sus archivos ya no se pueden cambiar.", confirmLabel: "Enviar a revisión", tone: "primary" });
    if (!ok) return;
    setEnviando(true);
    try {
      const res = await sendJsonAuth("POST", `${API_BASE_URL}/sgc/revisiones/${r.id}/enviar-revision`, token, {});
      toast.success(String(res.message || "Enviada a revisión"));
      invalidate("sgc");
    } catch (err) {
      const e = explicarError(err, "No se pudo enviar a revisión");
      toast.error(e.que, { description: e.hacer });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <PageBody>
      <RutaDocumentos area={item.area} tipo={item.tipo} documento={item.clave} />

      <header className="flex overflow-hidden rounded-card bg-surface shadow-card" data-testid="sgc-ficha" data-clave={item.clave}>
        <span className="w-1.5 shrink-0" style={{ backgroundColor: item.area.color }} aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-5 md:flex-row md:items-start">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <IconoArea area={item.area} size="lg" />
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="code text-[13px] font-semibold text-ink-2" data-testid="sgc-clave">
                {item.clave}
              </span>
              <h1 className="break-words text-[21px] font-semibold leading-tight tracking-[-0.015em] text-ink">{item.titulo}</h1>
              <div className="flex flex-wrap items-center gap-1.5">
                <EstadoDocumentoEtiqueta estado={item.estado} />
                {vigente ? <Badge tone="neutral">Rev. {vigente.numero}</Badge> : null}
                <ProximaRevisionEtiqueta fecha={vigente?.fecha_proxima_revision} />
                <ConfidencialidadEtiqueta valor={item.confidencialidad} />
                {item.origen === "externo" ? <Badge tone="neutral">Externo</Badge> : null}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            {data.puede.editar.ok ? (
              <Button size="sm" variant="secondary" icon={<PencilSimple size={15} />} onClick={() => setEditar(true)} data-testid="sgc-editar">
                Editar metadatos
              </Button>
            ) : null}
            <BotonPuede puede={data.puede.nueva_revision} icono={<Plus size={15} weight="bold" />} testid="sgc-nueva-revision" onClick={() => setRevisionSheet({ revision: null })}>
              Nueva revisión
            </BotonPuede>
          </div>
        </div>
      </header>

      {data.solo_diagnostico ? (
        <Callout tone="info" title="Solo metadatos (diagnóstico)">
          La administración técnica consulta la ficha y sus metadatos para dar soporte, pero no abre los archivos del documento.
        </Callout>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Seccion titulo="Revisión vigente" icono={<FilePdf size={17} weight="duotone" />} testid="sgc-vigente">
            {vigente ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2">
                  <span className="flex items-center gap-1.5">
                    <EstadoRevisionEtiqueta estado="vigente" /> Revisión {vigente.numero}
                  </span>
                  <span>Emisión: {formatearFecha(vigente.fecha_emision)}</span>
                  <span>Vigencia: {formatearFecha(vigente.fecha_vigencia)}</span>
                  {vigente.fecha_proxima_revision ? <span>Próxima revisión: {formatearFecha(vigente.fecha_proxima_revision)}</span> : null}
                </div>
                {vigente.abrir ? (
                  <div className="flex flex-wrap gap-2">
                    {pdfVigente ? (
                      <Button size="sm" variant="secondary" icon={<DownloadSimple size={15} />} onClick={() => void descargar(pdfVigente)} data-testid="sgc-descargar-pdf">
                        Descargar PDF
                      </Button>
                    ) : null}
                    {fuenteVigente ? (
                      <Button size="sm" variant="secondary" icon={<DownloadSimple size={15} />} onClick={() => void descargar(fuenteVigente)}>
                        Descargar archivo fuente
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {vigente.abrir && pdfVigente ? (
                  <div className="h-[72vh] min-h-[420px] overflow-hidden rounded-[12px] ring-1 ring-line" data-testid="sgc-visor">
                    <VisorPdf key={pdfVigente.id} url={urlArchivoSgc(pdfVigente.id)} ambito="sgc" docId={item.id} compacto={!amplia} />
                  </div>
                ) : !vigente.abrir ? (
                  <p className="text-[13px] text-ink-3">El archivo no se muestra en la vista de diagnóstico.</p>
                ) : (
                  <p className="text-[13px] text-ink-3">Esta revisión no tiene PDF de consulta.</p>
                )}
              </div>
            ) : (
              <EmptyState compact icon={<FilePdf size={20} weight="duotone" />} title="Sin revisión vigente" description={enCurso ? "El documento está en elaboración; aparecerá aquí cuando su revisión quede vigente." : "Este documento todavía no tiene una revisión vigente visible para ti."} />
            )}
          </Seccion>

          {enCurso ? (
            <Seccion titulo={`Revisión en curso · ${enCurso.numero}`} icono={<FileText size={17} weight="duotone" />} testid="sgc-en-curso" accion={<EstadoRevisionEtiqueta estado={enCurso.estado} />}>
              <RevisionEnCurso
                revision={enCurso}
                onEditar={() => setRevisionSheet({ revision: enCurso })}
                onArchivo={() => setArchivoDe(enCurso)}
                onEnviar={() => void enviar(enCurso)}
                onVigente={() => setVigenteDe(enCurso)}
                onDescargar={descargar}
                enviando={enviando}
              />
            </Seccion>
          ) : null}

          {data.historial ? (
            <Seccion titulo="Historial de revisiones" icono={<ClockCounterClockwise size={17} weight="duotone" />} testid="sgc-historial">
              <Historial revisiones={revisiones} onDescargar={descargar} />
            </Seccion>
          ) : data.revisiones_ocultas > 0 ? (
            <p className="text-[12.5px] text-ink-3">Hay {data.revisiones_ocultas} revisión(es) más en el historial; consultarlas requiere el permiso de consultar el histórico.</p>
          ) : null}

          {data.historial ? (
            <Seccion titulo="Eventos de la bitácora" icono={<ClockCounterClockwise size={17} weight="duotone" />} testid="sgc-eventos">
              {data.eventos.length ? (
                <ol className="flex flex-col divide-y divide-line">
                  {data.eventos.map((e) => {
                    const h = humanizeAuditEntry(e as unknown as Record<string, unknown>);
                    return (
                      <li key={e.id} className="flex flex-col gap-0.5 py-2.5">
                        <span className="text-[13.5px] text-ink">{h.frase}</span>
                        <span className="text-[12px] text-ink-3">
                          {formatearFechaHora(e.fecha_hora)}
                          {h.motivo ? ` · Motivo: ${h.motivo}` : ""}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="text-[13px] text-ink-3">Sin eventos.</p>
              )}
            </Seccion>
          ) : null}
        </div>

        <aside className="flex flex-col gap-6" aria-label="Datos del documento">
          <Seccion titulo="Metadatos" icono={<Info size={17} weight="duotone" />} testid="sgc-metadatos">
            <dl className="grid grid-cols-1 gap-3">
              <Dato etiqueta="Gestión">
                {item.area.codigo} · {item.area.nombre}
              </Dato>
              <Dato etiqueta="Tipo documental">
                {item.tipo.codigo} · {item.tipo.nombre}
              </Dato>
              <Dato etiqueta="Origen">{item.origen === "externo" ? "Externo" : "Interno"}</Dato>
              <Dato etiqueta="Proceso o subproceso">{item.proceso || "—"}</Dato>
              <Dato etiqueta="Confidencialidad">{etiquetaConfidencialidad(item.confidencialidad)}</Dato>
              <Dato etiqueta="Palabras clave">{item.palabras_clave.length ? item.palabras_clave.join(", ") : "—"}</Dato>
              <Dato etiqueta="Propietario">{item.propietario_nombre || "—"}</Dato>
              <Dato etiqueta="Ficha creada">
                {formatearFecha(item.creado_en)}
                {item.creado_por_nombre ? ` · ${item.creado_por_nombre}` : ""}
              </Dato>
            </dl>
          </Seccion>
          <Seccion titulo="Responsables" icono={<UsersThree size={17} weight="duotone" />}>
            <dl className="grid grid-cols-1 gap-3">
              {(enCurso || vigente) ? (
                <>
                  <Dato etiqueta="Elaborador">{(enCurso || vigente)!.elaborador_nombre || "Sin asignar"}</Dato>
                  <Dato etiqueta="Revisor">{(enCurso || vigente)!.revisor_nombre || "Sin asignar"}</Dato>
                  <Dato etiqueta="Autorizador">{(enCurso || vigente)!.autorizador_nombre || "Sin asignar"}</Dato>
                </>
              ) : (
                <p className="text-[13px] text-ink-3">—</p>
              )}
            </dl>
            {enCurso && vigente ? <p className="mt-2 text-[12px] text-ink-3">De la revisión en curso ({enCurso.numero}).</p> : null}
          </Seccion>
          <Seccion titulo="Distribución" testid="sgc-distribucion">
            <p className="text-[13px] text-ink-3">Sin destinatarios definidos. La distribución a roles o personas y los puntos de uso se configuran con la publicación.</p>
          </Seccion>
          <Seccion titulo="Lecturas" testid="sgc-lecturas">
            <p className="text-[13px] text-ink-3">Sin confirmaciones de lectura pendientes ni registradas.</p>
          </Seccion>
        </aside>
      </div>

      {editar && catalogos.data ? <FichaSheet open onClose={() => setEditar(false)} catalogos={catalogos.data} editar={item} /> : null}
      {revisionSheet ? <RevisionSheet doc={item} revision={revisionSheet.revision} catalogos={catalogos.data} onClose={() => setRevisionSheet(null)} /> : null}
      {archivoDe ? <ArchivoDialog revision={archivoDe} maxMb={catalogos.data?.max_mb || 50} onClose={() => setArchivoDe(null)} /> : null}
      {vigenteDe ? <RegistrarVigenteDialog doc={item} revision={vigenteDe} onClose={() => setVigenteDe(null)} /> : null}
    </PageBody>
  );
}

function Seccion({ titulo, icono, accion, testid, children }: { titulo: string; icono?: ReactNode; accion?: ReactNode; testid?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-card bg-surface p-5 shadow-card" data-testid={testid} aria-label={titulo}>
      <header className="flex items-center gap-2">
        {icono ? <span className="text-ink-3" aria-hidden="true">{icono}</span> : null}
        <h2 className="text-[15px] font-semibold text-ink">{titulo}</h2>
        {accion ? <span className="ml-auto">{accion}</span> : null}
      </header>
      {children}
    </section>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11.5px] font-medium uppercase tracking-wide text-ink-4">{etiqueta}</dt>
      <dd className="break-words text-[13.5px] text-ink">{children}</dd>
    </div>
  );
}

/* Accion segun la bandera del servidor: oculta si no puede; deshabilitada con su motivo si puede pero falta algo. */
function BotonPuede({ puede, icono, onClick, testid, variante = "secondary", cargando, children }: { puede: Puede; icono: ReactNode; onClick: () => void; testid?: string; variante?: "primary" | "secondary"; cargando?: boolean; children: ReactNode }) {
  if (!puede.ok && !puede.motivo) return null;
  return (
    <span className="flex flex-col items-start gap-1">
      <Button size="sm" variant={variante} icon={icono} onClick={onClick} disabled={!puede.ok} title={puede.motivo} data-testid={testid} loading={cargando}>
        {children}
      </Button>
      {!puede.ok && puede.motivo ? <span className="max-w-[260px] text-[11.5px] leading-snug text-ink-3" data-testid={testid ? `${testid}-motivo` : undefined}>{puede.motivo}</span> : null}
    </span>
  );
}

function ArchivoFila({ a, abrir, onDescargar }: { a: Archivo; abrir: boolean; onDescargar: (a: Archivo) => void }) {
  return (
    <li className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] px-3 py-2 ring-1 ring-line", a.reemplazado_en ? "bg-surface-2/60 text-ink-3" : "bg-surface-2")} data-testid="sgc-archivo" data-tipo={a.tipo}>
      <span className="text-[12px] font-semibold text-ink-2">{a.tipo === "pdf" ? "PDF de consulta" : "Archivo fuente"}</span>
      <span className="min-w-0 flex-1 break-all text-[13px] text-ink">{a.nombre_original}</span>
      <span className="tnum text-[12px] text-ink-3" title={a.sha256}>
        {fmtBytes(a.tamano_bytes)} · SHA-256 {huellaCorta(a.sha256)}
      </span>
      {a.reemplazado_en ? <Badge tone="neutral">Sustituido {formatearFecha(a.reemplazado_en)}</Badge> : null}
      {abrir ? (
        <Button size="sm" variant="ghost" icon={<DownloadSimple size={14} />} onClick={() => onDescargar(a)} aria-label={`Descargar ${a.nombre_original}`}>
          Descargar
        </Button>
      ) : null}
    </li>
  );
}

function RevisionEnCurso({ revision: r, onEditar, onArchivo, onEnviar, onVigente, onDescargar, enviando }: { revision: Revision; onEditar: () => void; onArchivo: () => void; onEnviar: () => void; onVigente: () => void; onDescargar: (a: Archivo) => void; enviando: boolean }) {
  const activos = r.archivos.filter((a) => !a.reemplazado_en);
  const reemplazados = r.archivos.filter((a) => a.reemplazado_en);
  return (
    <div className="flex flex-col gap-4">
      {r.estado !== "borrador" ? (
        <Callout tone="info" title="Archivos bloqueados">
          La revisión se envió a revisión{r.enviada_revision_en ? ` el ${formatearFechaHora(r.enviada_revision_en)}` : ""}: su archivo no se puede cambiar; para cambiarlo debe devolverse a borrador.
        </Callout>
      ) : null}
      <dl className="grid gap-3 sm:grid-cols-2">
        <Dato etiqueta="Motivo del cambio">{r.motivo_cambio || "—"}</Dato>
        <Dato etiqueta="Apartados afectados">{r.apartados_afectados || "—"}</Dato>
        <Dato etiqueta="Descripción del cambio">{r.descripcion_cambio || "—"}</Dato>
        <Dato etiqueta="Responsables">
          {r.elaborador_nombre || "Sin elaborador"} · {r.revisor_nombre || "sin revisor"} · {r.autorizador_nombre || "sin autorizador"}
        </Dato>
      </dl>
      <div className="flex flex-col gap-2">
        <h3 className="text-[13px] font-semibold text-ink">Archivos</h3>
        {activos.length ? (
          <ul className="flex flex-col gap-2">
            {activos.map((a) => (
              <ArchivoFila key={a.id} a={a} abrir={r.abrir} onDescargar={onDescargar} />
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-3">Todavía no tiene archivos.</p>
        )}
        {reemplazados.length ? (
          <details className="text-[13px] text-ink-3">
            <summary className="cursor-pointer">Archivos sustituidos ({reemplazados.length})</summary>
            <ul className="mt-2 flex flex-col gap-2">
              {reemplazados.map((a) => (
                <ArchivoFila key={a.id} a={a} abrir={r.abrir} onDescargar={onDescargar} />
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <div className="flex flex-wrap items-start gap-3">
        {r.puede.editar.ok ? (
          <Button size="sm" variant="secondary" icon={<PencilSimple size={15} />} onClick={onEditar} data-testid="sgc-editar-revision">
            Editar datos
          </Button>
        ) : null}
        <BotonPuede puede={r.puede.subir_archivo} icono={<CloudArrowUp size={15} />} onClick={onArchivo} testid="sgc-subir-archivo">
          Cargar o sustituir archivo
        </BotonPuede>
        <BotonPuede puede={r.puede.enviar_revision} icono={<PaperPlaneTilt size={15} />} onClick={onEnviar} testid="sgc-enviar-revision" variante="primary" cargando={enviando}>
          Enviar a revisión
        </BotonPuede>
        <BotonPuede puede={r.puede.registrar_vigente} icono={<SealCheck size={15} />} onClick={onVigente} testid="sgc-registrar-vigente">
          Registrar vigente (carga inicial)
        </BotonPuede>
      </div>
    </div>
  );
}

function Historial({ revisiones, onDescargar }: { revisiones: Revision[]; onDescargar: (a: Archivo) => void }) {
  if (!revisiones.length) return <p className="text-[13px] text-ink-3">Sin revisiones.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead className="text-left text-[12px] text-ink-3">
          <tr className="border-b border-line">
            <th className="py-2 pr-3 font-medium">Revisión</th>
            <th className="py-2 pr-3 font-medium">Estado</th>
            <th className="py-2 pr-3 font-medium">Emisión</th>
            <th className="py-2 pr-3 font-medium">Responsables</th>
            <th className="py-2 pr-3 font-medium">Motivo del cambio</th>
            <th className="py-2 font-medium">PDF</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {revisiones.map((r) => {
            const pdf = activo(r, "pdf");
            return (
              <tr key={r.id} className="align-top" data-testid="sgc-historial-fila" data-numero={r.numero} data-estado={r.estado}>
                <td className="tnum py-2 pr-3 font-semibold text-ink">{r.numero}</td>
                <td className="py-2 pr-3">
                  <EstadoRevisionEtiqueta estado={r.estado} />
                  {r.origen_registro === "carga_inicial" ? <span className="mt-1 block text-[11.5px] text-ink-3">Carga inicial</span> : null}
                </td>
                <td className="py-2 pr-3 text-ink-2">{formatearFecha(r.fecha_emision)}</td>
                <td className="py-2 pr-3 text-ink-2">
                  {r.elaborador_nombre || "—"} · {r.revisor_nombre || "—"} · {r.autorizador_nombre || "—"}
                </td>
                <td className="py-2 pr-3 text-ink-2">{r.motivo_cambio || "—"}</td>
                <td className="py-2">
                  {pdf && r.abrir ? (
                    <Button size="sm" variant="ghost" icon={<DownloadSimple size={14} />} onClick={() => onDescargar(pdf)} aria-label={`Descargar el PDF de la revisión ${r.numero}`}>
                      PDF
                    </Button>
                  ) : (
                    <span className="text-ink-4">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
