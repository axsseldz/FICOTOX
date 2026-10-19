"use client";

import { useRouter } from "next/navigation";
import { Suspense, use, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ClockCounterClockwise, FilePdf, Info, ListBullets, Prohibit, UsersThree, Warning, type Icon } from "@phosphor-icons/react";
import { AcuseLectura, AgregarDialog, SeccionDistribucion, useAcusarLectura } from "@/components/features/documentos/Distribucion";
import { EditarExternoDialog, NuevaVersionExternoDialog, SeguimientoExterno, VerificarExternoDialog } from "@/components/features/documentos/Externos";
import { ConfidencialidadEtiqueta, EstadoDocumentoEtiqueta, ExternoEtiqueta, EstadoRevisionEtiqueta, IconoArea, ProximaRevisionEtiqueta, RequireDocumentos, RutaDocumentos, useCatalogos, type Archivo, type FichaDocumento, type Puede, type Revision } from "@/components/features/documentos/comun";
import { FichaSheet } from "@/components/features/documentos/FichaSheet";
import { ConfirmacionCheck } from "@/components/features/documentos/Confirmacion";
import { ICONO_ACCION, ICONO_ESTADO } from "@/components/features/documentos/iconos";
import { ArchivoDialog, RegistrarVigenteDialog, RevisionSheet } from "@/components/features/documentos/RevisionSheets";
import { DecisionDialog, ObsoletarDialog, OPCIONES_AUTORIZADOR, OPCIONES_RENOVACION_AUTORIZADOR, OPCIONES_RENOVACION_REVISOR, OPCIONES_REVISOR, PublicarDialog, ReasignarDialog, RenovarDialog } from "@/components/features/documentos/FlujoDialogs";
import { SolicitudSheet } from "@/components/features/documentos/SolicitudSheets";
import { descargarUrl, imprimirPdfUrl } from "@/components/features/visor/usarArchivo";
import { VisorPdf } from "@/components/features/visor/VisorPdf";
import { PageBody } from "@/components/shell/AppShell";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { ActionMenu, useConfirm, type MenuItem } from "@/components/ui/Overlay";
import { PestanasDeslizantes } from "@/components/ui/PestanasDeslizantes";
import { Badge, EmptyState, ErrorState, Skeleton } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth, sendJsonAuth } from "@/lib/client/api";
import { useInitialParam } from "@/lib/client/hooks";
import { explicarError } from "@/lib/client/mensajes";
import { urlArchivoSgc } from "@/lib/client/pdf";
import { invalidate, useResource } from "@/lib/client/store";
import { fmtBytes, huellaCorta } from "@/lib/shared/adjuntos";
import { ACCION_FLUJO, ESTADOS_RENOVACION, etiquetaConfidencialidad } from "@/lib/shared/documentos";
import { formatearFecha, formatearFechaHora, hoyLocal } from "@/lib/shared/fechas";

/*
 * Ficha del documento:
 * - encabezado compacto (area, clave, titulo, revision y estado) con UNA accion
 *   principal: la que le toca a la persona ahora (revisar, autorizar, publicar,
 *   confirmar vigencia, enviar a revision, confirmar lectura…); las demas van en
 *   el menu ⋯, deshabilitadas con su motivo cuando el servidor lo indica;
 * - una franja delgada de avisos (obsoleto, pendiente de revision, obsolescencia
 *   solicitada, revision en curso, diagnostico);
 * - el PDF vigente en el visor interno;
 * - pestañas: Detalles, Revisiones (en curso, renovacion e historial plegado) y
 *   Lecturas (solo si la revision vigente tiene distribucion).
 * La bitacora vive en Calidad › Auditoría ("Ver en Auditoría" en el menu ⋯).
 */
export default function FichaDocumentoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireDocumentos>
      <Suspense fallback={<Skeleton className="h-[480px] rounded-card" />}>
        <Ficha id={id} />
      </Suspense>
    </RequireDocumentos>
  );
}

const activo = (r: Revision | null | undefined, tipo: "pdf" | "fuente") => r?.archivos.find((a) => a.tipo === tipo && !a.reemplazado_en) || null;

type Pestana = "detalles" | "revisiones" | "lecturas";

/* Una accion de la ficha: con permiso (ok), deshabilitada con motivo, u oculta (sin permiso ni motivo). */
interface Accion {
  id: string;
  etiqueta: string;
  icono: Icon;
  puede: Puede;
  onSelect: () => void;
  tono?: MenuItem["tone"];
  cargando?: boolean;
}
const visible = (a: Accion) => a.puede.ok || !!a.puede.motivo;
const SI: Puede = { ok: true };

function Ficha({ id }: { id: string }) {
  const { token, permissions } = useSession();
  const router = useRouter();
  const catalogos = useCatalogos();
  const confirm = useConfirm();
  const [editar, setEditar] = useState(false);
  const [revisionSheet, setRevisionSheet] = useState<{ revision: Revision | null } | null>(null);
  const [archivoDe, setArchivoDe] = useState<Revision | null>(null);
  const [vigenteDe, setVigenteDe] = useState<Revision | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [decision, setDecision] = useState<{ tipo: "revisar" | "autorizar" | "ren_revisar" | "ren_autorizar"; id: number; numero?: number } | null>(null);
  const [publicarDe, setPublicarDe] = useState<Revision | null>(null);
  const [reasignarDe, setReasignarDe] = useState<Revision | null>(null);
  const [renovar, setRenovar] = useState(false);
  const [obsoletar, setObsoletar] = useState(false);
  const [proponer, setProponer] = useState(false);
  const [externo, setExterno] = useState<"verificar" | "version" | "editar" | null>(null);
  const [agregarLectura, setAgregarLectura] = useState(false);
  const [pestana, setPestana] = useState<Pestana | null>(null);
  // Desde la Bandeja (?accion=sgc-revisar…): abre la ventana de esa accion al cargar, si la persona puede.
  // Con la navegacion del cliente la URL se actualiza despues del primer render: se lee de los parametros de Next.
  const accionInicial = useInitialParam("accion");
  const [accionPedida, setAccionPedida] = useState<string | null>(accionInicial || null);
  const recurso = useResource<FichaDocumento>(["sgc", `sgc:${id}`], async () => (await getJsonAuth(`${API_BASE_URL}/sgc/documentos/${encodeURIComponent(id)}`, token)) as unknown as FichaDocumento, { enabled: !!token });
  const data = recurso.data;
  const { acusar, enviando: acusando } = useAcusarLectura(data?.distribucion ?? null);
  // Desde "Lecturas pendientes" (?leer=1): lleva al acuse bajo el visor.
  const leer = data?.distribucion?.mi_lectura?.requiere && !data.distribucion.mi_lectura.leido_en;
  useEffect(() => {
    if (!leer || typeof window === "undefined" || !new URLSearchParams(window.location.search).has("leer")) return;
    const t = window.setTimeout(() => document.getElementById("acuse")?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }), 300);
    return () => window.clearTimeout(t);
  }, [leer]);

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
  if (!data) {
    return (
      <PageBody>
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-[92px] rounded-card" />
        <Skeleton className="h-[480px] rounded-card" />
      </PageBody>
    );
  }
  const { item, revisiones } = data;
  const vigente = revisiones.find((r) => r.estado === "vigente") || null;
  const enCurso = revisiones.find((r) => ["borrador", "en_revision", "en_autorizacion", "autorizada"].includes(r.estado)) || null;
  const renovacion = data.renovaciones.find((n) => n.estado === "en_revision" || n.estado === "en_autorizacion") || null;
  const pdfVigente = activo(vigente, "pdf");
  const fuenteVigente = activo(vigente, "fuente");
  const dist = data.distribucion;
  const ext = data.externo;
  const conLecturas = !!dist && (dist.filas.length > 0 || dist.destinatarios.length > 0 || dist.puntos_uso.length > 0 || dist.avance.total > 0);
  const conRevisiones = !!(enCurso || renovacion || data.historial || data.revisiones_ocultas > 0);
  const alcanceBitacora = permissions.calidad?.V;
  const verAuditoria = !!alcanceBitacora && alcanceBitacora !== "incidencias";

  const imprimirVigente = async (a: Archivo) => {
    try {
      await imprimirPdfUrl(urlArchivoSgc(a.id), token);
    } catch (err) {
      const e = explicarError(err, "No se pudo preparar la impresión");
      toast.error(e.que, { description: e.hacer });
    }
  };
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

  /*
   * Acciones en orden de prioridad: la primera con permiso es la accion principal
   * (lo que le toca a la persona ahora); el resto, si se puede o hay motivo, va en ⋯.
   */
  const flujo: Accion[] = [];
  if (enCurso) {
    flujo.push(
      { id: "sgc-revisar", etiqueta: "Revisar", icono: ICONO_ACCION.revisar, puede: enCurso.puede.revisar, onSelect: () => setDecision({ tipo: "revisar", id: enCurso.id, numero: enCurso.numero }) },
      { id: "sgc-autorizar", etiqueta: "Autorizar", icono: ICONO_ACCION.autorizar, puede: enCurso.puede.autorizar, onSelect: () => setDecision({ tipo: "autorizar", id: enCurso.id, numero: enCurso.numero }) },
      { id: "sgc-publicar", etiqueta: "Publicar", icono: ICONO_ACCION.publicar, puede: enCurso.puede.publicar, onSelect: () => setPublicarDe(enCurso) },
    );
  }
  if (renovacion) {
    flujo.push(
      { id: "sgc-renovacion-revisar", etiqueta: "Confirmar vigencia", icono: ICONO_ACCION.confirmar_vigencia, puede: renovacion.puede.revisar, onSelect: () => setDecision({ tipo: "ren_revisar", id: renovacion.id }) },
      { id: "sgc-renovacion-autorizar", etiqueta: "Autorizar renovación", icono: ICONO_ACCION.autorizar_renovacion, puede: renovacion.puede.autorizar, onSelect: () => setDecision({ tipo: "ren_autorizar", id: renovacion.id }) },
    );
  }
  if (enCurso) {
    flujo.push(
      { id: "sgc-enviar-revision", etiqueta: "Enviar a revisión", icono: ICONO_ACCION.enviar, puede: enCurso.puede.enviar_revision, onSelect: () => void enviar(enCurso), cargando: enviando },
      { id: "sgc-registrar-vigente", etiqueta: "Registrar vigente (carga inicial)", icono: ICONO_ACCION.registrar_vigente, puede: enCurso.puede.registrar_vigente, onSelect: () => setVigenteDe(enCurso) },
    );
  }
  if (dist?.mi_lectura?.requiere && !dist.mi_lectura.leido_en && vigente?.abrir && pdfVigente) {
    flujo.push({ id: "acuse-confirmar", etiqueta: "Confirmar lectura", icono: ICONO_ACCION.confirmar_lectura, puede: dist.puede.acusar, onSelect: () => void acusar(), cargando: acusando });
  }
  if (ext) flujo.push({ id: "ext-verificar", etiqueta: "Verificar vigencia", icono: ICONO_ACCION.verificar_externo, puede: ext.puede.verificar.ok ? SI : { ok: false }, onSelect: () => setExterno("verificar") });
  const principal = flujo.find((a) => a.puede.ok) || null;

  // Menu ⋯: lo demas, agrupado (flujo de la revision, documento, archivos, bitacora).
  const otrasFlujo = flujo.filter((a) => a !== principal && visible(a));
  const deRevision: Accion[] = enCurso
    ? [
        { id: "sgc-editar-revision", etiqueta: "Editar datos de la revisión", icono: ICONO_ACCION.editar_revision, puede: enCurso.puede.editar.ok ? SI : { ok: false }, onSelect: () => setRevisionSheet({ revision: enCurso }) },
        { id: "sgc-subir-archivo", etiqueta: "Cargar o sustituir archivo", icono: ICONO_ACCION.subir_archivo, puede: enCurso.puede.subir_archivo, onSelect: () => setArchivoDe(enCurso) },
        { id: "sgc-reasignar", etiqueta: "Reasignar responsables", icono: ICONO_ACCION.reasignar, puede: enCurso.puede.reasignar, onSelect: () => setReasignarDe(enCurso) },
      ].filter(visible)
    : [];
  const deExterno: Accion[] = ext
    ? [
        { id: "ext-nueva-version", etiqueta: "Registrar nueva versión", icono: ICONO_ACCION.nueva_revision, puede: ext.puede.nueva_version.ok ? SI : { ok: false }, onSelect: () => setExterno("version") },
        { id: "ext-editar", etiqueta: "Editar seguimiento", icono: ICONO_ACCION.editar, puede: ext.puede.editar.ok ? SI : { ok: false }, onSelect: () => setExterno("editar") },
      ].filter(visible)
    : [];
  const deDocumento: Accion[] = ([
    { id: "sgc-proponer", etiqueta: "Proponer cambio", icono: ICONO_ACCION.proponer, puede: data.puede.proponer.ok ? SI : { ok: false }, onSelect: () => setProponer(true) },
    { id: "sgc-nueva-revision", etiqueta: "Nueva revisión", icono: ICONO_ACCION.nueva_revision, puede: data.puede.nueva_revision, onSelect: () => setRevisionSheet({ revision: null }) },
    { id: "sgc-renovar", etiqueta: "Renovar sin cambios", icono: ICONO_ACCION.renovar, puede: data.puede.renovar, onSelect: () => setRenovar(true) },
    { id: "sgc-editar", etiqueta: "Editar metadatos", icono: ICONO_ACCION.editar, puede: data.puede.editar.ok ? SI : { ok: false }, onSelect: () => setEditar(true) },
    { id: "dist-agregar", etiqueta: "Agregar destinatarios", icono: ICONO_ACCION.distribucion, puede: dist?.puede.administrar.ok ? SI : { ok: false }, onSelect: () => setAgregarLectura(true) },
    { id: "sgc-obsoletar", etiqueta: "Declarar obsoleto", icono: ICONO_ACCION.obsoletar, puede: data.puede.obsoletar, onSelect: () => setObsoletar(true), tono: "danger" },
  ] as Accion[]).filter(visible);
  const deArchivos: Accion[] = vigente?.abrir
    ? [
        ...(pdfVigente ? [{ id: "sgc-descargar-pdf", etiqueta: "Descargar PDF", icono: ICONO_ACCION.descargar, puede: SI, onSelect: () => void descargar(pdfVigente) }] : []),
        ...(fuenteVigente ? [{ id: "sgc-descargar-fuente", etiqueta: "Descargar archivo fuente", icono: ICONO_ACCION.descargar_fuente, puede: SI, onSelect: () => void descargar(fuenteVigente) }] : []),
      ]
    : [];
  const deBitacora: Accion[] = verAuditoria ? [{ id: "sgc-ver-auditoria", etiqueta: "Ver en Auditoría", icono: ICONO_ACCION.auditoria, puede: SI, onSelect: () => router.push(`/auditoria?buscar=${encodeURIComponent(item.clave)}&area=documentos&periodo=todo`) }] : [];
  // En cada grupo, primero lo que la persona puede hacer; despues lo deshabilitado (con su motivo).
  const todas = [...flujo, ...deRevision, ...deExterno, ...deDocumento];
  const grupos = [otrasFlujo, deRevision, deExterno, deDocumento, deArchivos, deBitacora].filter((g) => g.length).map((g) => [...g.filter((a) => a.puede.ok), ...g.filter((a) => !a.puede.ok)]);
  const menu: MenuItem[] = grupos.flatMap((g, gi) =>
    g.map((a, i) => ({
      label: a.etiqueta,
      icon: <a.icono size={16} weight="bold" />,
      onSelect: a.onSelect,
      disabled: !a.puede.ok,
      tone: a.tono || "neutral",
      testid: a.id,
      separatorBefore: gi > 0 && i === 0,
      description: !a.puede.ok && a.puede.motivo ? <span data-testid={`${a.id}-motivo`}>{a.puede.motivo}</span> : undefined,
    })),
  );

  // Pestañas disponibles; por omision Revisiones si hay trabajo en curso, si no Detalles.
  const pestanas: Array<{ value: Pestana; label: string; icon: ReactNode }> = [
    { value: "detalles", label: "Detalles", icon: <Info size={15} weight="bold" aria-hidden="true" /> },
    ...(conRevisiones ? [{ value: "revisiones" as const, label: "Revisiones", icon: <ClockCounterClockwise size={15} weight="bold" aria-hidden="true" /> }] : []),
    ...(conLecturas ? [{ value: "lecturas" as const, label: "Lecturas", icon: <UsersThree size={15} weight="bold" aria-hidden="true" /> }] : []),
  ];
  const porOmision: Pestana = enCurso || renovacion ? "revisiones" : "detalles";
  const actual: Pestana = pestana && pestanas.some((p) => p.value === pestana) ? pestana : porOmision;

  return (
    <PageBody>
      <RutaDocumentos area={item.area} tipo={item.tipo} documento={item.clave} />

      <header className="flex overflow-hidden rounded-card bg-surface shadow-card" data-testid="sgc-ficha" data-clave={item.clave}>
        <span className="w-1.5 shrink-0" style={{ backgroundColor: item.area.color }} aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5">
          {/* Base minima del titulo: en pantallas angostas las acciones bajan de renglon en vez de aplastarlo. */}
          <div className="flex min-w-0 flex-[1_1_14rem] items-center gap-3.5">
            <IconoArea area={item.area} />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="code text-xs font-semibold text-ink-2" data-testid="sgc-clave">
                {item.clave}
              </span>
              <h1 className="break-words text-xl font-semibold leading-snug tracking-snug text-ink">{item.titulo}</h1>
              <div className="flex flex-wrap items-center gap-1.5">
                {vigente ? <span className="tnum text-xs font-medium text-ink-2">{item.origen === "externo" && vigente.version_externa ? `Versión ${vigente.version_externa}` : `Rev. ${vigente.numero}`}</span> : null}
                <span className="transicion-estado inline-flex" key={item.estado}>
                  <EstadoDocumentoEtiqueta estado={item.estado} />
                </span>
                {item.origen === "externo" ? <ExternoEtiqueta /> : null}
                <ConfidencialidadEtiqueta valor={item.confidencialidad} />
              </div>
            </div>
          </div>
          {principal || menu.length ? (
            <div className="flex shrink-0 items-center gap-1.5" aria-label="Acciones del documento">
              {principal ? (
                <Button icon={<principal.icono size={16} weight="bold" />} onClick={principal.onSelect} loading={principal.cargando} data-testid={principal.id} data-principal="1">
                  {principal.etiqueta}
                </Button>
              ) : null}
              {menu.length ? <ActionMenu items={menu} label="Más acciones" /> : null}
            </div>
          ) : null}
        </div>
      </header>

      <Avisos item={item} vigente={vigente} enCurso={enCurso} diagnostico={data.solo_diagnostico} />
      {accionPedida ? <AbrirAccion accion={todas.find((a) => a.id === accionPedida && a.puede.ok) || null} onHecho={() => setAccionPedida(null)} /> : null}
      <ConfirmacionCheck />

      <section aria-label="Revisión vigente" data-testid="sgc-vigente" className="flex flex-col gap-3">
        {vigente ? (
          vigente.abrir && pdfVigente ? (
            <>
              <div className="h-[74vh] min-h-[420px] overflow-hidden rounded-card bg-surface shadow-card ring-1 ring-line" data-testid="sgc-visor">
                <VisorPdf key={pdfVigente.id} url={urlArchivoSgc(pdfVigente.id)} ambito="sgc" docId={item.id} acciones={{ descargar: () => void descargar(pdfVigente), imprimir: () => void imprimirVigente(pdfVigente) }} />
              </div>
              {dist ? <AcuseLectura dist={dist} sinBoton /> : null}
            </>
          ) : (
            <div className="rounded-card bg-surface shadow-card">
              <EmptyState
                compact
                icon={<FilePdf size={20} weight="duotone" />}
                title={!vigente.abrir ? "Sin vista del archivo" : "Sin PDF de consulta"}
                description={!vigente.abrir ? "El archivo no se muestra en la vista de diagnóstico." : item.origen === "externo" ? "Solo con derechos de uso; consúltalo en el enlace del emisor." : "Esta revisión no tiene PDF de consulta."}
              />
            </div>
          )
        ) : (
          <div className="rounded-card bg-surface shadow-card">
            <EmptyState compact icon={<FilePdf size={20} weight="duotone" />} title="Sin revisión vigente" description={enCurso ? "Aparecerá aquí cuando su revisión quede vigente." : "Todavía no tiene una revisión vigente visible para ti."} />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4" aria-label="Información del documento">
        {pestanas.length > 1 ? <PestanasDeslizantes<Pestana> value={actual} onChange={setPestana} options={pestanas} label="Información del documento" className="w-full max-w-[460px]" /> : null}

        <div role="tabpanel" aria-label="Detalles" hidden={actual !== "detalles"} data-testid="sgc-pestana-detalles" className="flex flex-col gap-4">
          <Detalles data={data} vigente={vigente} enCurso={enCurso} />
          {ext ? (
            <Tarjeta titulo="Seguimiento del documento externo" testid="sgc-externo">
              <SeguimientoExterno docId={item.id} clave={item.clave} ext={ext} catalogos={catalogos.data} sinAcciones />
            </Tarjeta>
          ) : null}
        </div>

        {conRevisiones ? (
          <div role="tabpanel" aria-label="Revisiones" hidden={actual !== "revisiones"} data-testid="sgc-pestana-revisiones" className="flex flex-col gap-4">
            {renovacion ? (
              <Tarjeta titulo="Renovación de vigencia" testid="sgc-renovacion" accion={<Badge tone="brand">{ESTADOS_RENOVACION[renovacion.estado]?.etiqueta}</Badge>}>
                <Lista
                  datos={[
                    ["Revisor", renovacion.revisor_nombre],
                    ["Autorizador", renovacion.autorizador_nombre],
                    ["Nueva próxima revisión", formatearFecha(renovacion.fecha_proxima_nueva)],
                    ["Fecha límite", formatearFecha(renovacion.fecha_limite)],
                  ]}
                />
              </Tarjeta>
            ) : null}
            {enCurso ? (
              <Tarjeta titulo={`Revisión ${enCurso.numero} en curso`} testid="sgc-en-curso" accion={<span className="transicion-estado inline-flex" key={enCurso.estado}><EstadoRevisionEtiqueta estado={enCurso.estado} /></span>}>
                <RevisionEnCurso revision={enCurso} onDescargar={descargar} />
              </Tarjeta>
            ) : null}
            {data.historial ? (
              <details className="group/historial rounded-card bg-surface shadow-card" data-testid="sgc-historial">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-base font-semibold text-ink [&::-webkit-details-marker]:hidden">
                  <ListBullets size={16} weight="bold" className="text-ink-3" aria-hidden="true" />
                  Historial de revisiones
                  <span className="tnum font-normal text-ink-3">({revisiones.length})</span>
                  <span className="ml-auto text-xs font-normal text-ink-3 group-open/historial:hidden">Mostrar</span>
                  <span className="ml-auto hidden text-xs font-normal text-ink-3 group-open/historial:inline">Ocultar</span>
                </summary>
                <div className="border-t border-line px-5 pt-2 pb-4">
                  <Historial revisiones={revisiones} onDescargar={descargar} />
                </div>
              </details>
            ) : data.revisiones_ocultas > 0 ? (
              <p className="text-xs text-ink-3">Hay {data.revisiones_ocultas} revisión(es) más en el historial; consultarlas requiere el permiso de consultar el histórico.</p>
            ) : null}
          </div>
        ) : null}

        {conLecturas && dist ? (
          <div role="tabpanel" aria-label="Lecturas" hidden={actual !== "lecturas"} data-testid="sgc-pestana-lecturas">
            <Tarjeta titulo="Distribución y lecturas" testid="sgc-distribucion">
              <SeccionDistribucion dist={dist} catalogos={catalogos.data} obsoleto={item.estado === "obsoleto"} sinAgregar />
            </Tarjeta>
          </div>
        ) : null}
      </section>

      {editar && catalogos.data ? <FichaSheet open onClose={() => setEditar(false)} catalogos={catalogos.data} editar={item} /> : null}
      {revisionSheet ? <RevisionSheet doc={item} revision={revisionSheet.revision} catalogos={catalogos.data} onClose={() => setRevisionSheet(null)} /> : null}
      {archivoDe ? <ArchivoDialog revision={archivoDe} maxMb={catalogos.data?.max_mb || 50} onClose={() => setArchivoDe(null)} /> : null}
      {vigenteDe ? <RegistrarVigenteDialog doc={item} revision={vigenteDe} onClose={() => setVigenteDe(null)} /> : null}
      {decision?.tipo === "revisar" ? <DecisionDialog titulo={`Revisar ${item.clave} rev. ${decision.numero}`} descripcion="Como revisor asignado: acepta, devuelve con comentarios al elaborador o rechaza." url={`${API_BASE_URL}/sgc/revisiones/${decision.id}/revisar`} opciones={OPCIONES_REVISOR} onClose={() => setDecision(null)} /> : null}
      {decision?.tipo === "autorizar" ? <DecisionDialog titulo={`Autorizar ${item.clave} rev. ${decision.numero}`} descripcion="Como autorizador asignado. Autorizar pide tu contraseña." url={`${API_BASE_URL}/sgc/revisiones/${decision.id}/autorizar`} opciones={OPCIONES_AUTORIZADOR} onClose={() => setDecision(null)} /> : null}
      {decision?.tipo === "ren_revisar" ? <DecisionDialog titulo={`Confirmar la vigencia de ${item.clave}`} descripcion="Como revisor de la renovación: confirma que el documento sigue vigente sin cambios, con tu comentario." url={`${API_BASE_URL}/sgc/renovaciones/${decision.id}/revisar`} opciones={OPCIONES_RENOVACION_REVISOR} onClose={() => setDecision(null)} /> : null}
      {decision?.tipo === "ren_autorizar" ? <DecisionDialog titulo={`Autorizar la renovación de ${item.clave}`} descripcion="La misma revisión sigue vigente con la nueva fecha de próxima revisión. Autorizar pide tu contraseña." url={`${API_BASE_URL}/sgc/renovaciones/${decision.id}/autorizar`} opciones={OPCIONES_RENOVACION_AUTORIZADOR} onClose={() => setDecision(null)} /> : null}
      {publicarDe ? <PublicarDialog doc={item} revision={publicarDe} catalogos={catalogos.data} distribucionAnterior={dist} onClose={() => setPublicarDe(null)} /> : null}
      {reasignarDe ? <ReasignarDialog revision={reasignarDe} catalogos={catalogos.data} onClose={() => setReasignarDe(null)} /> : null}
      {renovar ? <RenovarDialog doc={item} catalogos={catalogos.data} onClose={() => setRenovar(false)} /> : null}
      {obsoletar ? <ObsoletarDialog doc={item} onClose={() => setObsoletar(false)} /> : null}
      {proponer ? <SolicitudSheet catalogos={catalogos.data} documento={{ id: item.id, clave: item.clave, titulo: item.titulo }} onClose={() => setProponer(false)} /> : null}
      {externo === "verificar" ? <VerificarExternoDialog docId={item.id} clave={item.clave} onClose={() => setExterno(null)} /> : null}
      {externo === "version" && ext ? <NuevaVersionExternoDialog docId={item.id} clave={item.clave} ext={ext} onClose={() => setExterno(null)} /> : null}
      {externo === "editar" && ext ? <EditarExternoDialog docId={item.id} ext={ext} catalogos={catalogos.data} onClose={() => setExterno(null)} /> : null}
      {agregarLectura && dist ? <AgregarDialog revisionId={dist.revision_id} numero={dist.numero} catalogos={catalogos.data} onClose={() => setAgregarLectura(false)} /> : null}
    </PageBody>
  );
}

/* Abre una sola vez la accion pedida por la URL y quita el parametro (al recargar no se repite). */
function AbrirAccion({ accion, onHecho }: { accion: Accion | null; onHecho: () => void }) {
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("accion");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    accion?.onSelect();
    onHecho();
    // Solo al montar: la accion se toma con los datos ya cargados.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/* Franja de avisos: una sola, delgada, con un renglon por aviso (icono + texto; el color nunca es la unica senal). */
function Avisos({ item, vigente, enCurso, diagnostico }: { item: FichaDocumento["item"]; vigente: Revision | null; enCurso: Revision | null; diagnostico: boolean }) {
  const avisos: Array<{ clave: string; tono: "danger" | "warning" | "info"; icono: Icon; titulo: string; texto: string; testid?: string }> = [];
  if (item.estado === "obsoleto") avisos.push({ clave: "obsoleto", tono: "danger", icono: Prohibit, titulo: "Documento obsoleto", texto: `Retirado del uso${item.obsoleto_en ? ` el ${formatearFecha(item.obsoleto_en)}` : ""}${item.motivo_obsolescencia ? `. Motivo: ${item.motivo_obsolescencia}` : ""}. Se conserva en el historial.`, testid: "sgc-aviso-obsoleto" });
  if (item.pendiente_revision && item.estado === "vigente")
    avisos.push({ clave: "pendiente", tono: "warning", icono: ICONO_ESTADO.pendiente, titulo: "Pendiente de revisión", texto: `Próxima revisión: ${formatearFecha(vigente?.fecha_proxima_revision)}. ${item.origen === "externo" ? "Se verifica que siga vigente o se registra la nueva versión." : "Mejora Continua decide si se renueva sin cambios o se abre una nueva revisión."}`, testid: "sgc-aviso-pendiente" });
  if (item.obsolescencia_pendiente) avisos.push({ clave: "obsolescencia", tono: "info", icono: Warning, titulo: "Obsolescencia solicitada", texto: `Solicitud #${item.obsolescencia_pendiente}; la aprueba otra persona en «Por autorizar».` });
  if (enCurso && vigente) avisos.push({ clave: "en-curso", tono: "info", icono: ICONO_ESTADO[enCurso.estado === "borrador" ? "borrador" : enCurso.estado === "autorizada" ? "autorizada" : enCurso.estado === "en_autorizacion" ? "autorizacion" : "revision"], titulo: `Revisión ${enCurso.numero} en curso`, texto: `La revisión ${vigente.numero} sigue vigente mientras tanto.` });
  if (diagnostico) avisos.push({ clave: "diagnostico", tono: "info", icono: Info, titulo: "Solo metadatos (diagnóstico)", texto: "La administración técnica consulta la ficha para dar soporte, sin abrir sus archivos." });
  if (!avisos.length) return null;
  const color = { danger: "text-danger-text", warning: "text-warning-text", info: "text-brand-strong" };
  return (
    <div role="status" className="flex flex-col divide-y divide-line overflow-hidden rounded-box bg-surface ring-1 ring-line" data-testid="sgc-avisos">
      {avisos.map((a) => (
        <p key={a.clave} className="flex items-start gap-2 px-3.5 py-2 text-sm leading-snug text-ink-2" data-testid={a.testid}>
          <a.icono size={15} weight="bold" className={cn("mt-px shrink-0", color[a.tono])} aria-hidden="true" />
          <span>
            <b className="font-semibold text-ink">{a.titulo}.</b> {a.texto}
          </span>
        </p>
      ))}
    </div>
  );
}

function Tarjeta({ titulo, accion, testid, children }: { titulo: string; accion?: ReactNode; testid?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-card bg-surface p-5 shadow-card" data-testid={testid} aria-label={titulo}>
      <header className="flex items-center gap-2">
        <h2 className="text-base font-semibold text-ink">{titulo}</h2>
        {accion ? <span className="ml-auto">{accion}</span> : null}
      </header>
      {children}
    </section>
  );
}

/* Lista etiqueta/valor; los campos vacios no se muestran. */
function Lista({ datos, columnas = 2 }: { datos: Array<[string, ReactNode]>; columnas?: 1 | 2 | 3 }) {
  const llenos = datos.filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== "—");
  if (!llenos.length) return null;
  return (
    <dl className={cn("grid gap-x-6 gap-y-3", columnas === 3 ? "sm:grid-cols-3" : columnas === 2 ? "sm:grid-cols-2" : "")}>
      {llenos.map(([etiqueta, valor]) => (
        <div key={etiqueta} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-2xs font-medium uppercase tracking-wide text-ink-3">{etiqueta}</dt>
          <dd className="break-words text-sm text-ink">{valor}</dd>
        </div>
      ))}
    </dl>
  );
}

function Detalles({ data, vigente, enCurso }: { data: FichaDocumento; vigente: Revision | null; enCurso: Revision | null }) {
  const { item } = data;
  const responsables = enCurso || vigente;
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="sgc-metadatos">
      <Tarjeta titulo="Documento">
        <Lista
          datos={[
            ["Gestión", `${item.area.codigo} · ${item.area.nombre}`],
            ["Tipo documental", `${item.tipo.codigo} · ${item.tipo.nombre}`],
            ["Origen", item.origen === "externo" ? "Externo" : "Interno"],
            ["Proceso o subproceso", item.proceso],
            ["Confidencialidad", etiquetaConfidencialidad(item.confidencialidad)],
            ["Palabras clave", item.palabras_clave.length ? item.palabras_clave.join(", ") : null],
            ["Propietario", item.propietario_nombre],
            ["Ficha creada", `${formatearFecha(item.creado_en)}${item.creado_por_nombre ? ` · ${item.creado_por_nombre}` : ""}`],
          ]}
        />
      </Tarjeta>
      <div className="flex flex-col gap-4">
        {vigente ? (
          <Tarjeta titulo={`Revisión ${vigente.numero} vigente`}>
            <Lista
              datos={[
                ["Emisión", vigente.fecha_emision ? formatearFecha(vigente.fecha_emision) : null],
                ["Vigencia", vigente.fecha_vigencia ? formatearFecha(vigente.fecha_vigencia) : null],
                ["Próxima revisión", vigente.fecha_proxima_revision ? <span className="inline-flex flex-wrap items-center gap-1.5">{formatearFecha(vigente.fecha_proxima_revision)} <ProximaRevisionEtiqueta fecha={vigente.fecha_proxima_revision} /></span> : null],
                ["Renovado", vigente.renovada_en ? formatearFecha(vigente.renovada_en) : null],
                ["Versión del emisor", vigente.version_externa],
              ]}
            />
          </Tarjeta>
        ) : null}
        {item.origen !== "externo" && responsables ? (
          <Tarjeta titulo={enCurso && vigente ? `Responsables (revisión ${enCurso.numero} en curso)` : "Responsables"}>
            <Lista
              datos={[
                ["Elaborador", responsables.elaborador_nombre],
                ["Revisor", responsables.revisor_nombre],
                ["Autorizador", responsables.autorizador_nombre],
              ]}
              columnas={3}
            />
          </Tarjeta>
        ) : null}
      </div>
    </div>
  );
}

function ArchivoFila({ a, abrir, onDescargar }: { a: Archivo; abrir: boolean; onDescargar: (a: Archivo) => void }) {
  return (
    <li className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-field px-3 py-2 ring-1 ring-line", a.reemplazado_en ? "bg-surface-2/60 text-ink-3" : "bg-surface-2")} data-testid="sgc-archivo" data-tipo={a.tipo}>
      <span className="text-xs font-semibold text-ink-2">{a.tipo === "pdf" ? "PDF de consulta" : "Archivo fuente"}</span>
      <span className="min-w-0 flex-1 break-all text-sm text-ink">{a.nombre_original}</span>
      <span className="tnum text-xs text-ink-3" title={a.sha256}>
        {fmtBytes(a.tamano_bytes)} · SHA-256 {huellaCorta(a.sha256)}
      </span>
      {a.reemplazado_en ? <Badge tone="neutral">Sustituido {formatearFecha(a.reemplazado_en)}</Badge> : null}
      {abrir ? (
        <Button size="sm" variant="ghost" icon={<ICONO_ACCION.descargar size={14} />} onClick={() => onDescargar(a)} aria-label={`Descargar ${a.nombre_original}`}>
          Descargar
        </Button>
      ) : null}
    </li>
  );
}

function RevisionEnCurso({ revision: r, onDescargar }: { revision: Revision; onDescargar: (a: Archivo) => void }) {
  const activos = r.archivos.filter((a) => !a.reemplazado_en);
  const reemplazados = r.archivos.filter((a) => a.reemplazado_en);
  const vencida = !!r.fecha_limite && r.fecha_limite < hoyLocal();
  return (
    <div className="flex flex-col gap-4">
      {r.fecha_limite || r.estado !== "borrador" ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
          {r.fecha_limite ? (
            <span className={cn(vencida && "font-semibold text-danger-text")} data-testid="sgc-fecha-limite">
              Fecha límite: {formatearFecha(r.fecha_limite)}
              {vencida ? " · vencida" : ""}
            </span>
          ) : null}
          {r.estado !== "borrador" ? <span>Archivos bloqueados{r.enviada_revision_en ? ` desde el ${formatearFechaHora(r.enviada_revision_en)}` : ""}; para cambiarlos debe devolverse a borrador.</span> : null}
        </p>
      ) : null}
      <Lista
        datos={[
          ["Motivo del cambio", r.motivo_cambio],
          ["Apartados afectados", r.apartados_afectados],
          ["Descripción del cambio", r.descripcion_cambio],
          ["Elaborador", r.elaborador_nombre],
          ["Revisor", r.revisor_nombre],
          ["Autorizador", r.autorizador_nombre],
        ]}
      />
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-ink">Archivos</h3>
        {activos.length ? (
          <ul className="flex flex-col gap-2">
            {activos.map((a) => (
              <ArchivoFila key={a.id} a={a} abrir={r.abrir} onDescargar={onDescargar} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">Todavía no tiene archivos.</p>
        )}
        {reemplazados.length ? (
          <details className="text-sm text-ink-3">
            <summary className="cursor-pointer">Archivos sustituidos ({reemplazados.length})</summary>
            <ul className="mt-2 flex flex-col gap-2">
              {reemplazados.map((a) => (
                <ArchivoFila key={a.id} a={a} abrir={r.abrir} onDescargar={onDescargar} />
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <LineaTiempo pasos={r.linea_tiempo} />
    </div>
  );
}

const PAPEL: Record<string, string> = { elaborador: "Elaborador", revisor: "Revisor", autorizador: "Autorizador", publicador: "Mejora Continua", solicitante: "Solicitante" };

/* Linea de tiempo de una revision (CA-07): quien, en que papel y cargo, cuando, con que decision y comentario. */
function LineaTiempo({ pasos }: { pasos: Revision["linea_tiempo"] }) {
  if (!pasos?.length) return null;
  return (
    <section aria-label="Línea de tiempo" className="flex flex-col gap-2" data-testid="sgc-linea-tiempo">
      <h3 className="text-sm font-semibold text-ink">Línea de tiempo</h3>
      <ol className="relative flex flex-col gap-3 border-l border-line pl-4">
        {pasos.map((p) => (
          <li key={p.id} className="relative" data-accion={p.accion}>
            <span className={cn("absolute top-1.5 -left-[21px] h-2.5 w-2.5 rounded-full ring-2 ring-surface", /rechazar/.test(p.accion) ? "bg-danger" : /devolver/.test(p.accion) ? "bg-warning" : /publicar|autorizar$|registrar_vigente|renovacion_autorizar/.test(p.accion) ? "bg-success" : "bg-brand")} aria-hidden="true" />
            <p className="text-sm text-ink">
              <span className="font-medium">{ACCION_FLUJO[p.accion] || p.accion}</span>
              {p.usuario_nombre ? ` · ${p.usuario_nombre}` : ""}
              {p.papel ? <span className="text-ink-3"> ({PAPEL[p.papel] || p.papel}{p.cargo ? `, ${p.cargo}` : ""})</span> : null}
            </p>
            <p className="text-xs text-ink-3">{formatearFechaHora(p.fecha)}</p>
            {p.comentario ? <p className="mt-0.5 whitespace-pre-line text-sm text-ink-2">«{p.comentario}»</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Historial({ revisiones, onDescargar }: { revisiones: Revision[]; onDescargar: (a: Archivo) => void }) {
  if (!revisiones.length) return <p className="text-sm text-ink-3">Sin revisiones.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-xs text-ink-3">
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
                <td className="tnum py-2 pr-3 font-semibold text-ink">
                  {r.numero}
                  {r.version_externa ? <span className="block text-2xs font-normal text-ink-3">Versión {r.version_externa}</span> : null}
                </td>
                <td className="py-2 pr-3">
                  <EstadoRevisionEtiqueta estado={r.estado} />
                  {r.origen_registro === "carga_inicial" ? <span className="mt-1 block text-2xs text-ink-3">Carga inicial</span> : null}
                  {r.renovada_en ? <span className="mt-1 block text-2xs text-success-text">Renovado {formatearFecha(r.renovada_en)}</span> : null}
                  {r.linea_tiempo?.length ? (
                    <details className="mt-1 text-xs text-ink-3">
                      <summary className="cursor-pointer">Línea de tiempo</summary>
                      <div className="mt-2 min-w-[260px]">
                        <LineaTiempo pasos={r.linea_tiempo} />
                      </div>
                    </details>
                  ) : null}
                </td>
                <td className="py-2 pr-3 text-ink-2">{formatearFecha(r.fecha_emision)}</td>
                <td className="py-2 pr-3 text-ink-2">
                  {r.elaborador_nombre || "—"} · {r.revisor_nombre || "—"} · {r.autorizador_nombre || "—"}
                </td>
                <td className="py-2 pr-3 text-ink-2">{r.motivo_cambio || "—"}</td>
                <td className="py-2">
                  {pdf && r.abrir ? (
                    <Button size="sm" variant="ghost" icon={<ICONO_ACCION.descargar size={14} />} onClick={() => onDescargar(pdf)} aria-label={`Descargar el PDF de la revisión ${r.numero}`}>
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
