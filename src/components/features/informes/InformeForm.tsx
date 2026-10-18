"use client";

import { formatearFolio } from "@/lib/shared/folios";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowsClockwise, BookOpenText, FilePdf, FloppyDisk, LockKey, PaperPlaneTilt, Prohibit, SealCheck } from "@phosphor-icons/react";
import { IncidenciasFormCard } from "@/components/features/calidad/IncidenciasDelRegistro";
import { RecordHistory } from "@/components/features/audit/RecordHistory";
import { BotonSegregado, FolioChip, SegregacionCallout, SolicitudCallout, SupervisionCallout } from "@/components/features/samples/status";
import { SignDialog } from "@/components/features/samples/SignDialog";
import { Callout, FlowSteps, FormCard, FormPage, FormTable, PersonCard, ReadValue, SignoffCard, formTd, formTh, personaId, type FormSectionDef } from "@/components/features/samples/FormLayout";
import { CampoValidado, useValidacion } from "@/components/ui/Validacion";
import { msg, type Problema } from "@/lib/client/mensajes";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/ui/Field";
import { DateInput } from "@/components/ui/DateInput";
import { ActionMenu, usePrompt, type MenuItem } from "@/components/ui/Overlay";
import { Badge, EmptyState } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth, sendJsonAuth } from "@/lib/client/api";
import { descargarPdfInforme } from "@/lib/client/informes-pdf";
import { fmtDate, isoDate, parseIntOrNull, todayIso } from "@/lib/client/format";
import { formatActiveUserSignature } from "@/lib/client/session";
import { invalidate } from "@/lib/client/store";
import { seOfrece } from "@/lib/client/puede";
import type { ApiRecord } from "@/lib/client/types";
import { folioNc } from "@/lib/shared/calidad";
import { ANALYSIS_METHODS, ANALYSIS_TYPES, REPORT_DEFAULT_STATEMENTS, REPORT_STATES } from "@/lib/shared/sgc";
import { EnviosPanel } from "@/components/features/informes/EnviosPanel";
import { AvisoAutorizacion } from "@/components/features/samples/AvisoAutorizacion";
import { requisitosInforme } from "@/lib/shared/autorizaciones";

/*
 * Informe de resultados (ISO/IEC 17025 7.8): se arma a partir de una
 * recepcion y sus analisis aprobados; pasa por revision y autorizacion con
 * firma; al liberarse (Fase 6) se congela y se genera el PDF final, y despues
 * se envia por correo con su evidencia.
 */

interface InformeState {
  recepcionId: string;
  clienteNombre: string;
  clienteContacto: string;
  clienteDireccion: string;
  clienteCorreo: string;
  analisisIds: number[];
  alcance: string;
  reglaDecision: string;
  desviaciones: string;
  descargo: string;
  opiniones: string;
  fechaEmision: string;
  elaboradoNombre: string;
  elaboradoFirma: string;
  observaciones: string;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

const defaultForm = (): InformeState => ({
  recepcionId: "",
  clienteNombre: "",
  clienteContacto: "",
  clienteDireccion: "",
  clienteCorreo: "",
  analisisIds: [],
  alcance: REPORT_DEFAULT_STATEMENTS.alcance,
  reglaDecision: REPORT_DEFAULT_STATEMENTS.regla_decision,
  desviaciones: "",
  descargo: "",
  opiniones: "",
  fechaEmision: todayIso(),
  elaboradoNombre: formatActiveUserSignature(),
  elaboradoFirma: "",
  observaciones: "",
});

const formFromItem = (item: ApiRecord): InformeState => {
  const cliente = (item.cliente || {}) as ApiRecord;
  const decl = (item.declaraciones || {}) as ApiRecord;
  return {
    recepcionId: item.recepcion_id ? String(item.recepcion_id) : "",
    clienteNombre: str(cliente.nombre),
    clienteContacto: str(cliente.contacto),
    clienteDireccion: str(cliente.direccion),
    clienteCorreo: str(cliente.correo),
    analisisIds: Array.isArray(item.analisis_ids) ? item.analisis_ids.map(Number) : [],
    alcance: str(decl.alcance) || REPORT_DEFAULT_STATEMENTS.alcance,
    reglaDecision: str(decl.regla_decision) || REPORT_DEFAULT_STATEMENTS.regla_decision,
    desviaciones: str(decl.desviaciones),
    descargo: str(decl.descargo),
    opiniones: str(decl.opiniones),
    fechaEmision: isoDate(item.fecha_emision) || todayIso(),
    elaboradoNombre: str(item.elaborado_nombre),
    elaboradoFirma: str(item.elaborado_firma),
    observaciones: str(item.observaciones),
  };
};

const FLOW_STEPS = [
  { key: "borrador", label: "Borrador" },
  { key: "en_revision", label: "En revisión" },
  { key: "autorizado", label: "Autorizado" },
  { key: "liberado", label: "Liberado" },
  { key: "enviado", label: "Enviado" },
];

function tipoLabel(value: unknown): string {
  return ANALYSIS_TYPES.find((t) => t.value === value)?.label || String(value || "");
}
function metodoLabel(value: unknown, otro?: unknown): string {
  if (value === "otro" && otro) return String(otro);
  return ANALYSIS_METHODS.find((m) => m.value === value)?.label || String(value || "");
}

export function InformeForm({ item, prefillRecepcionId }: { item: ApiRecord | null; prefillRecepcionId?: number | null }) {
  const router = useRouter();
  const prompt = usePrompt();
  const { token, can, user } = useSession();
  const [form, setForm] = useState<InformeState>(() => (item ? formFromItem(item) : defaultForm()));
  const [recepciones, setRecepciones] = useState<ApiRecord[]>([]);
  const [disponibles, setDisponibles] = useState<ApiRecord[]>(() => ((item?.disponibles || []) as ApiRecord[]));
  const [muestras, setMuestras] = useState<ApiRecord[]>(() => ((item?.muestras || []) as ApiRecord[]));
  const [recepcionInfo, setRecepcionInfo] = useState<ApiRecord | null>((item?.recepcion as ApiRecord) || null);
  const [descargoSugerido, setDescargoSugerido] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sign, setSign] = useState<"revisar" | "autorizar" | "liberar" | null>(null);
  const [signing, setSigning] = useState(false);
  const editing = !!item?.id;
  const estado = String(item?.estado || "borrador");
  // E solo en borrador (Fase 1): en revisión o después se corrige por enmienda o anulación.
  const canEdit = editing ? seOfrece(item, "editar", can("informes", "E", { objeto: "informe", borrador: true })) && estado === "borrador" : can("informes", "C", { objeto: "informe", borrador: true });
  // Con una solicitud de autorizacion pendiente (Fase 3) el informe no se edita.
  const draft = !editing || (canEdit && !item?.solicitud_pendiente);
  const patch = (changes: Partial<InformeState>) => setForm((prev) => ({ ...prev, ...changes }));

  const loadRecepcion = async (id: number, keepSelection = false) => {
    try {
      const data = await getJsonAuth(`${API_BASE_URL}/informes/recepcion/${id}`, token);
      setRecepcionInfo(data.recepcion as ApiRecord);
      setMuestras((data.muestras || []) as ApiRecord[]);
      setDisponibles((data.analisis || []) as ApiRecord[]);
      setDescargoSugerido((data.descargo_sugerido as string | null) || null);
      const cliente = (data.cliente || {}) as ApiRecord;
      setForm((prev) => ({
        ...prev,
        recepcionId: String(id),
        clienteNombre: prev.clienteNombre || str(cliente.nombre),
        clienteContacto: prev.clienteContacto || str(cliente.contacto),
        clienteCorreo: prev.clienteCorreo || str(cliente.correo),
        analisisIds: keepSelection ? prev.analisisIds : ((data.analisis || []) as ApiRecord[]).map((a) => Number(a.id)),
        descargo: prev.descargo || (data.descargo_sugerido as string) || "",
      }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo leer la recepción");
    }
  };

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const data = await getJsonAuth(`${API_BASE_URL}/samples/reception?search=`, token).catch(() => ({}) as ApiRecord);
      if (cancelled) return;
      setRecepciones(((data.items || []) as ApiRecord[]).filter((r) => !["anulada", "rechazada"].includes(String(r.estado))));
      if (!item && prefillRecepcionId) await loadRecepcion(prefillRecepcionId);
      if (item && draft && item.recepcion_id) await loadRecepcion(Number(item.recepcion_id), true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, item, prefillRecepcionId]);

  const buildPayload = () => ({
    recepcion_id: parseIntOrNull(form.recepcionId),
    analisis_ids: form.analisisIds,
    cliente: { nombre: form.clienteNombre.trim() || null, contacto: form.clienteContacto.trim() || null, direccion: form.clienteDireccion.trim() || null, correo: form.clienteCorreo.trim() || null },
    declaraciones: { alcance: form.alcance.trim(), regla_decision: form.reglaDecision.trim(), desviaciones: form.desviaciones.trim() || null, descargo: form.descargo.trim() || null, opiniones: form.opiniones.trim() || null },
    fecha_emision: form.fechaEmision || null,
    elaborado_nombre: form.elaboradoNombre.trim() || null,
    elaborado_firma: form.elaboradoFirma || null,
    observaciones: form.observaciones.trim() || null,
  });

  /*
   * Reglas del formato, en el orden en que aparecen. La misma lista da la
   * completitud de la guía, el aviso del encabezado y el pop-up al guardar.
   */
  const elaboroId = personaId("Elaboró");
  const reglas = (): Problema[] => {
    const out: Problema[] = [];
    const en = (seccion: string, grupo: string) => (campo: string, mensaje: string) => out.push({ campo, mensaje, seccion, grupo });
    const ori = en("sec-origen", "Recepción y cliente");
    if (!form.recepcionId) ori("i-rec", msg.elige("la recepción que se informa"));
    if (!form.clienteNombre.trim()) ori("i-cli", msg.indica("el nombre del cliente"));
    if (form.recepcionId && !muestras.length) en("sec-muestras", "Ítems ensayados")("i-muestras", "La recepción elegida no tiene muestras para informar");
    if (!form.analisisIds.length) en("sec-analisis", "Análisis incluidos")("i-analisis", msg.marca("al menos un análisis aprobado"));
    const dec = en("sec-declaraciones", "Declaraciones");
    if (!form.alcance.trim()) dec("i-alc", msg.escribe("el alcance de los resultados"));
    if (!form.reglaDecision.trim()) dec("i-regla", msg.escribe("la regla de decisión"));
    if (descargoSugerido && !form.descargo.trim()) dec("i-desc", msg.escribe("el descargo: la muestra se aceptó con desviación"));
    if (!form.elaboradoNombre.trim()) en("sec-firmas", "Elaboró")(elaboroId, msg.elige("quién elabora el informe"));
    return out;
  };
  const v = useValidacion({ titulo: editing ? "No se pudo guardar el informe" : "No se pudo crear el informe", reglas: draft ? reglas : () => [] });
  const camposServidor = { cliente: "i-cli" };
  const ubicacionServidor = { cliente: { seccion: "sec-origen", grupo: "Recepción y cliente" } };

  const handleSave = async () => {
    const payload = buildPayload();
    if (!v.validar()) return;
    if (!canEdit) return v.avisar({ que: "No tienes permiso para guardar este informe.", hacer: "Pide a la administración que revise tus roles y permisos." });
    setSubmitting(true);
    try {
      if (editing) {
        await sendJsonAuth("PUT", `${API_BASE_URL}/informes/${item!.id}`, token, payload);
        toast.success("Informe actualizado");
      } else {
        const created = await sendJsonAuth("POST", `${API_BASE_URL}/informes`, token, payload);
        toast.success("Informe creado en borrador");
        invalidate("informes", "muestras", "dashboard");
        router.push(`/informes/${created.id}`);
        return;
      }
      invalidate("informes", "muestras", "dashboard");
      router.push("/informes");
    } catch (err) {
      v.errorServidor(err, camposServidor, ubicacionServidor);
      setSubmitting(false);
    }
  };

  const doSign = async (data: { firma: string }) => {
    if (!sign || !item) return;
    setSigning(true);
    try {
      const body: Record<string, unknown> = { firma: data.firma || null };
      // Segregacion de funciones (Fase 3): el servidor rechaza con 409 "segregacion"; la excepcion se pide aparte.
      await sendJsonAuth("POST", `${API_BASE_URL}/informes/${item.id}/${sign}`, token, body);
      toast.success(sign === "revisar" ? "Informe revisado" : sign === "autorizar" ? "Informe autorizado; falta liberarlo" : "Informe liberado; PDF final generado");
      invalidate("informes", "muestras", "dashboard");
      setSign(null);
      router.refresh();
    } catch (err) {
      v.errorServidor(err);
    } finally {
      setSigning(false);
    }
  };

  const anular = async () => {
    if (!item) return;
    const motivo = await prompt({ critico: true, title: `Anular informe ${item.folio}`, description: "El informe queda anulado y su PDF marcado como sin validez. Para corregirlo emite una enmienda.", confirmLabel: "Anular", tone: "danger" });
    if (!motivo) return;
    try {
      const data = await sendJsonAuth("POST", `${API_BASE_URL}/informes/${item.id}/anular`, token, { motivo });
      // Autorizado, liberado o enviado: queda en solicitud de un segundo usuario (Fase 3).
      if (data.solicitud) toast.info(String(data.message || "Anulación solicitada"));
      else toast.success("Informe anulado");
      invalidate("informes", "dashboard", "solicitudes");
      router.refresh();
    } catch (err) {
      v.errorServidor(err);
    }
  };

  const enmendar = async () => {
    if (!item) return;
    const motivo = await prompt({ title: `Emitir enmienda de ${item.folio}`, description: "Se crea una nueva versión en borrador que declara sustituir a este informe (ISO/IEC 17025 7.8.8).", confirmLabel: "Crear enmienda" });
    if (!motivo) return;
    try {
      const created = await sendJsonAuth("POST", `${API_BASE_URL}/informes/${item.id}/enmienda`, token, { motivo });
      toast.success(`Enmienda creada (versión ${created.version})`);
      invalidate("informes", "dashboard");
      router.push(`/informes/${created.id}`);
    } catch (err) {
      v.errorServidor(err);
    }
  };

  const verPdf = () => {
    if (!item) return;
    router.push(`/informes/${item.id}/ver`);
  };

  const toggleAnalisis = (id: number, checked: boolean) => patch({ analisisIds: checked ? Array.from(new Set([...form.analisisIds, id])) : form.analisisIds.filter((v) => v !== id) });
  // Banderas del servidor: rol + autorización FX-THF-AP de cada actividad; la segregación se explica en el botón.
  const canReview = seOfrece(item, "revisar", can("informes", "R"));
  const canAuthorize = seOfrece(item, "autorizar", can("informes", "A"));
  const canLiberar = seOfrece(item, "liberar", can("informes", "A"));
  const canEnviar = seOfrece(item, "enviar", can("informes", "A"));
  // Segregacion (Fase 3): por que la persona actual no puede revisar o autorizar este informe (null = puede).
  const segregacion = (item?.segregacion || {}) as { revisar?: string | null; autorizar?: string | null };
  const excepciones = (item?.excepciones || []) as Array<{ solicitud_id: number; accion: string }>;
  const excepcionDe = (accion: string) => excepciones.find((e) => e.accion === accion);
  const solicitarExcepcion = async (accion: "revisar" | "autorizar") => {
    if (!item) return;
    const motivo = await prompt({
      critico: true,
      title: `Solicitar excepción para ${accion} ${folioLabel}`,
      description: `${segregacion[accion] || "La regla de dos personas te lo impide"}. Por falta de personal puedes pedir una excepción: la aprueba quien tiene A en calidad y queda declarada en el informe y en el PDF.`,
      confirmLabel: "Solicitar excepción",
    });
    if (!motivo) return;
    try {
      const data = await sendJsonAuth("POST", `${API_BASE_URL}/solicitudes`, token, { tipo: "excepcion_segregacion", entidad: "informes", entidad_id: item.id, accion, motivo });
      toast.info(String(data.message || "Excepción solicitada"));
      invalidate("solicitudes");
    } catch (err) {
      v.errorServidor(err);
    }
  };
  const resultadosCongelados = (item?.resultados || []) as ApiRecord[];
  // Fase 6: un analisis incluido se enmendo despues; no se libera ni se envia hasta la enmienda del informe.
  const requiereEnmienda = !!Number(item?.requiere_enmienda || 0);
  // Fase 11: retenido por una NC, igual que "requiere enmienda": no se libera ni se envia.
  const retenciones = (item?.retenciones || []) as ApiRecord[];
  const bloqueoEnmienda = requiereEnmienda
    ? `Requiere enmienda: ${String(item?.requiere_enmienda_motivo || "un análisis incluido se enmendó")}. No se puede liberar ni enviar hasta crear y liberar su enmienda.`
    : retenciones.length
      ? `Retenido por ${[...new Set(retenciones.map((r) => folioNc(r.nc_folio)))].join(", ")}: no se libera ni se envía hasta que Calidad libere la retención.`
      : null;
  const enviable = ["liberado", "enviado"].includes(estado);
  const folioLabel = editing ? `${item!.folio} · v${item!.version}` : "Nuevo informe";

  // Completitud con las mismas reglas que el guardado (la guía y el aviso del encabezado no se contradicen).
  const completa = (id: string) => (draft ? v.seccionCompleta(id) && (id !== "sec-muestras" || muestras.length > 0) : undefined);
  const sections: FormSectionDef[] = [
    { id: "sec-origen", label: "Recepción y cliente", complete: completa("sec-origen") },
    { id: "sec-muestras", label: "Ítems ensayados", complete: completa("sec-muestras") },
    { id: "sec-analisis", label: "Análisis incluidos", complete: completa("sec-analisis") },
    { id: "sec-declaraciones", label: "Declaraciones", complete: completa("sec-declaraciones") },
    { id: "sec-firmas", label: "Elaboró, revisó, autorizó", complete: completa("sec-firmas") },
    ...(editing ? [{ id: "sec-historial", label: "Historial", optional: true }] : []),
  ];

  // Acciones secundarias (PDF, enmienda, anulación) van en un menú para que la cabecera solo muestre el siguiente paso.
  const moreItems: MenuItem[] = [];
  if (editing) moreItems.push({ label: item?.archivo_pdf ? "Ver informe" : estado === "borrador" || estado === "en_revision" ? "Vista previa del PDF" : "Ver PDF", description: item?.archivo_pdf ? "Leer el PDF final en la plataforma" : "Vista previa (sin validez) en la plataforma", icon: <FilePdf size={16} weight="duotone" />, tone: "brand", onSelect: verPdf });
  if (editing && item?.archivo_pdf) moreItems.push({ label: "Descargar PDF", description: "Documento liberado con SHA-256", icon: <FilePdf size={16} weight="duotone" />, onSelect: () => void descargarPdfInforme(item, token) });
  if (editing && ["autorizado", "liberado", "enviado", "anulado"].includes(estado) && seOfrece(item, "enmendar", can("informes", "C"))) moreItems.push({ label: "Emitir enmienda…", description: "Nueva versión que sustituye a esta", icon: <ArrowsClockwise size={16} weight="duotone" />, onSelect: enmendar });
  if (editing && estado !== "anulado" && seOfrece(item, "anular", can("informes", "AN"))) moreItems.push({ label: "Anular informe…", description: "El PDF queda sin validez", icon: <Prohibit size={16} weight="duotone" />, tone: "danger", separatorBefore: true, onSelect: anular });

  const failedLabel = estado === "anulado" ? "Anulado" : estado === "sustituido" ? "Sustituido por enmienda" : undefined;

  return (
    <FormPage
      backHref="/informes"
      backLabel="Informes"
      code="FX-TCF-IR"
      title={editing ? `Informe ${folioLabel}` : "Nuevo informe de resultados"}
      status={REPORT_STATES[estado]?.label || estado}
      statusTone={REPORT_STATES[estado]?.tone || "neutral"}
      sections={sections}
      validacion={v}
      readOnly={!draft}
      after={
        editing ? (
          <>
            {/* Fase 6: los envíos se registran con el informe ya en solo lectura (fuera del fieldset desactivado). */}
            <FormCard id="sec-envios" title="Envíos por correo" description="A quién, cuándo y cómo se envió el informe liberado, con la evidencia de cada envío.">
              {editing && enviable && token ? (
                <EnviosPanel item={item!} token={token} puedeEnviar={canEnviar} bloqueo={bloqueoEnmienda} onCambio={() => router.refresh()} />
              ) : (
                <Callout tone="info">{estado === "autorizado" ? "Libera el informe para generar el PDF final; después se registra su envío por correo." : "El envío por correo se registra una vez liberado el informe."}</Callout>
              )}
            </FormCard>
            <IncidenciasFormCard entidad="informes" id={item?.id} etiqueta={String(item!.folio)} />
            <FormCard id="sec-historial" title="Historial del informe" description="Bitácora de auditoría: creación, revisión, autorización, liberación, envíos, enmiendas y descargas.">
              <RecordHistory entidad="informes" entidadId={item?.id as number | undefined} />
            </FormCard>
          </>
        ) : null
      }
      actions={
        <>
          <Button variant="secondary" onClick={() => router.push("/informes")}>
            {draft ? "Cancelar" : "Volver"}
          </Button>
          {editing && item?.archivo_pdf ? (
            <Button variant="secondary" icon={<BookOpenText size={16} />} onClick={() => router.push(`/informes/${item.id}/ver`)}>
              Ver informe
            </Button>
          ) : null}
          {moreItems.length ? <ActionMenu items={moreItems} label="Más acciones" header={editing ? String(item!.folio) : undefined} /> : null}
          {editing && estado === "borrador" && canReview ? (
            <BotonSegregado bloqueo={segregacion.revisar} onSolicitar={() => solicitarExcepcion("revisar")}>
              <Button variant="soft" icon={<PaperPlaneTilt size={16} />} onClick={() => setSign("revisar")} disabled={!!segregacion.revisar}>
                Marcar revisado
              </Button>
            </BotonSegregado>
          ) : null}
          {editing && estado === "en_revision" && canAuthorize ? (
            <BotonSegregado bloqueo={segregacion.autorizar} onSolicitar={() => solicitarExcepcion("autorizar")}>
              <Button variant="soft" icon={<SealCheck size={16} />} onClick={() => setSign("autorizar")} disabled={!!segregacion.autorizar}>
                Autorizar
              </Button>
            </BotonSegregado>
          ) : null}
          {editing && estado === "autorizado" && canLiberar ? (
            <Button icon={<LockKey size={16} />} onClick={() => setSign("liberar")} disabled={!!bloqueoEnmienda} title={bloqueoEnmienda || undefined}>
              Liberar
            </Button>
          ) : null}
          {draft ? (
            <Button onClick={handleSave} loading={submitting} icon={<FloppyDisk size={16} />}>
              {editing ? "Guardar borrador" : "Crear borrador"}
            </Button>
          ) : null}
        </>
      }
    >
      {editing ? (
        <div className="flex flex-col gap-3 px-1">
          <FlowSteps steps={FLOW_STEPS} current={estado} failed={failedLabel} />
        </div>
      ) : null}
      {item?.sustituye_a ? (
        <Callout tone="warning" title="Enmienda">
          Esta versión sustituye a la anterior. Motivo: {String(item.motivo_enmienda || "—")}
        </Callout>
      ) : null}
      {requiereEnmienda ? (
        <Callout tone="danger" title="Requiere enmienda">
          {bloqueoEnmienda}
        </Callout>
      ) : null}
      {item?.pdf_integridad === "alterado" || item?.pdf_integridad === "faltante" ? (
        <Callout tone="danger" title="Alerta de integridad del PDF">
          {item.pdf_integridad === "alterado" ? "El SHA-256 del PDF guardado no coincide con el registrado al liberar el informe. Avisa a la coordinación de calidad." : "El PDF final no está en el servidor. Avisa a la coordinación de calidad."}
        </Callout>
      ) : null}
      <SupervisionCallout item={item} />
      <SolicitudCallout item={item} />
      {/* Fase 11: retenido por una NC; no se libera ni se envia hasta que calidad libere la retencion. */}
      {((item?.retenciones || []) as ApiRecord[]).length ? (
        <div data-aviso-retencion>
          <Callout tone="danger" title={`Retenido por ${[...new Set(((item!.retenciones || []) as ApiRecord[]).map((r) => folioNc(r.nc_folio)))].join(", ")}`}>
            {((item!.retenciones || []) as ApiRecord[]).map((r) => r.motivo).filter(Boolean).map(String).join(" · ") || "Por una no conformidad"}. No se libera ni se envía hasta que Calidad libere la retención{estado === "enviado" ? " (ya se envió: no se reenvía)" : ""}.
          </Callout>
        </div>
      ) : null}
      {editing && estado === "borrador" && canReview ? <AvisoAutorizacion requisitos={requisitosInforme("revisar")} accion="revisar este informe" /> : null}
      {editing && estado === "en_revision" && canAuthorize ? <AvisoAutorizacion requisitos={requisitosInforme("autorizar")} accion="autorizar este informe" /> : null}
      {editing && estado === "autorizado" && canLiberar ? <AvisoAutorizacion requisitos={requisitosInforme("liberar")} accion="liberar este informe" /> : null}
      <SegregacionCallout bloqueo={editing && estado === "borrador" && canReview ? segregacion.revisar : editing && estado === "en_revision" && canAuthorize ? segregacion.autorizar : null} accion={estado === "en_revision" ? "autorizar" : "revisar"} onSolicitar={() => solicitarExcepcion(estado === "en_revision" ? "autorizar" : "revisar")} />
      {item?.motivo_anulacion ? (
        <Callout tone="danger" title="Informe anulado">
          Motivo: {String(item.motivo_anulacion)}
          {item.anulado_cargo ? ` · Anuló como ${String(item.anulado_cargo)}` : ""}
        </Callout>
      ) : null}
      {editing && estado === "en_revision" ? <Callout tone="info">Al guardar cambios el informe regresa a borrador y debe revisarse de nuevo.</Callout> : null}

      <FormCard id="sec-origen" title="Recepción y cliente" description="El informe se emite para la recepción de una muestra y su solicitante (7.8.2 e, g, h).">
        <FormGrid cols={3}>
          <Field label="Recepción" htmlFor="i-rec" required hint={recepcionInfo ? `${fmtDate(recepcionInfo.fecha_recepcion)} · ${recepcionInfo.solicitante || ""}` : undefined}>
            <Select
              id="i-rec"
              value={form.recepcionId}
              disabled={editing}
              onChange={(event) => {
                const id = parseIntOrNull(event.target.value);
                patch({ recepcionId: event.target.value, analisisIds: [] });
                if (id) void loadRecepcion(id);
              }}
            >
              <option value="">Seleccionar</option>
              {recepciones.map((r) => (
                <option key={r.id} value={r.id}>
                  {formatearFolio("R", r.folio_num)} · {r.solicitante || r.id_interno || ""} · {fmtDate(r.fecha_recepcion)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fecha de emisión" htmlFor="i-fecha" hint="Se fija al autorizar si se deja vacía.">
            <DateInput id="i-fecha" value={form.fechaEmision} onChange={(value) => patch({ fechaEmision: value })} readOnly={!draft} />
          </Field>
          {recepcionInfo ? (
            <div className="flex flex-col gap-1 self-end pb-1 text-[13px] text-ink-2">
              <span className="flex items-center gap-2">
                <FolioChip type="R" num={recepcionInfo.folio_num} /> <Link href={`/muestras/recepcion/${recepcionInfo.id}`} className="text-brand">abrir recepción</Link>
              </span>
              {recepcionInfo.decision_aceptacion === "aceptada_con_desviacion" ? <Badge tone="warning">Aceptada con desviación</Badge> : null}
            </div>
          ) : null}
        </FormGrid>
        <FormGrid cols={3} className="mt-4">
          <Field label="Cliente / solicitante" htmlFor="i-cli" required>
            <Input id="i-cli" maxLength={180} value={form.clienteNombre} onChange={(event) => patch({ clienteNombre: event.target.value })} readOnly={!draft} />
          </Field>
          <Field label="Contacto" htmlFor="i-con">
            <Input id="i-con" maxLength={180} value={form.clienteContacto} onChange={(event) => patch({ clienteContacto: event.target.value })} readOnly={!draft} />
          </Field>
          <Field label="Dirección" htmlFor="i-dir">
            <Input id="i-dir" maxLength={240} value={form.clienteDireccion} onChange={(event) => patch({ clienteDireccion: event.target.value })} readOnly={!draft} />
          </Field>
          <Field label="Correo de contacto" htmlFor="i-correo" hint="Se usa para el envío del informe liberado.">
            <Input id="i-correo" type="email" maxLength={180} value={form.clienteCorreo} onChange={(event) => patch({ clienteCorreo: event.target.value })} readOnly={!draft} />
          </Field>
        </FormGrid>
      </FormCard>

      <FormCard id="sec-muestras" title="Ítems ensayados" description="Descripción e identificación de las muestras tal como se recibieron (7.8.2 g).">
        <CampoValidado id="i-muestras">
        {!muestras.length ? (
          <EmptyState compact title="Sin muestras" description="Selecciona una recepción para cargar sus muestras." />
        ) : (
          <FormTable minWidth={640}>
            <thead>
                <tr>
                  <th className={formTh}>ID interno</th>
                  <th className={formTh}>Organismo</th>
                  <th className={formTh}>Sitio</th>
                  <th className={formTh}>Fecha de muestra</th>
                  <th className={formTh}>Cantidad</th>
                  <th className={formTh}>Condición</th>
                </tr>
              </thead>
              <tbody>
                {muestras.map((m, i) => (
                  <tr key={`${m.id_interno}-${i}`}>
                    <td className={cn(formTd, "code")}>{m.id_interno || "—"}</td>
                    <td className={formTd}>{m.organismo || "—"}</td>
                    <td className={formTd}>{m.sitio || "—"}</td>
                    <td className={formTd}>{fmtDate(m.fecha_muestra)}</td>
                    <td className={formTd}>{m.cantidad || "—"}</td>
                    <td className={formTd}>{m.condicion || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </FormTable>
        )}
        </CampoValidado>
      </FormCard>

      <FormCard id="sec-analisis" title="Análisis incluidos" description={draft ? "Solo análisis aprobados de esta recepción. Los resultados se copian al informe al liberarlo." : "Resultados congelados al liberar el informe."}>
        {draft ? (
          !disponibles.length ? (
            <CampoValidado id="i-analisis">
              <EmptyState compact title="No hay análisis aprobados" description="Aprueba los análisis de esta recepción para poder informarlos." />
            </CampoValidado>
          ) : (
            <CampoValidado id="i-analisis" className="flex flex-col gap-2">
              {disponibles.map((a) => {
                const id = Number(a.id);
                const resultados = (a.resultados || []) as ApiRecord[];
                return (
                  <div key={id} className="rounded-card border border-line p-3">
                    <Checkbox
                      checked={form.analisisIds.includes(id)}
                      onChange={(event) => toggleAnalisis(id, event.target.checked)}
                      label={
                        <span className="flex flex-wrap items-center gap-2">
                          <FolioChip type="A" num={a.folio_num} /> {tipoLabel(a.tipo_analisis)} · {metodoLabel(a.metodo, a.metodo_otro)} · {fmtDate(a.fecha_analisis)}
                        </span>
                      }
                      description={`${resultados.length} resultado(s) · aprobó ${a.aprobado_nombre || "—"}`}
                    />
                  </div>
                );
              })}
            </CampoValidado>
          )
        ) : (
          <div className="flex flex-col gap-4">
            {resultadosCongelados.map((a, i) => (
              <div key={i}>
                <p className="mb-2 text-[13.5px] font-medium text-ink">
                  {String(a.folio)} · {String(a.tipo)} · {String(a.metodo)}
                </p>
                <FormTable minWidth={640}>
                  <thead>
                      <tr>
                        <th className={formTh}>ID muestra</th>
                        <th className={formTh}>Resultado</th>
                        <th className={formTh}>Unidad</th>
                        <th className={formTh}>Límite</th>
                        <th className={formTh}>Conformidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {((a.resultados || []) as ApiRecord[]).map((r, j) => (
                        <tr key={j}>
                          <td className={cn(formTd, "code")}>{r.id_muestra}</td>
                          <td className={cn(formTd, "tnum")}>{r.resultado ?? r.resultado_texto ?? "—"}</td>
                          <td className={formTd}>{r.unidad || "—"}</td>
                          <td className={cn(formTd, "tnum")}>{r.limite_regulatorio ?? "—"}</td>
                          <td className={formTd}>{r.cumple === "cumple" ? <Badge tone="success">Cumple</Badge> : r.cumple === "no_cumple" ? <Badge tone="danger">No cumple</Badge> : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </FormTable>
              </div>
            ))}
          </div>
        )}
      </FormCard>

      <FormCard id="sec-declaraciones" title="Declaraciones" description="Alcance, regla de decisión, desviaciones del método y descargos (7.8.2 l, n; 7.8.6; 7.4.3).">
        <div className="flex flex-col gap-4">
          <Field label="Alcance de los resultados" htmlFor="i-alc">
            {draft ? <Textarea id="i-alc" rows={2} value={form.alcance} onChange={(event) => patch({ alcance: event.target.value })} /> : <ReadValue value={form.alcance} />}
          </Field>
          <Field label="Regla de decisión" htmlFor="i-regla">
            {draft ? <Textarea id="i-regla" rows={2} value={form.reglaDecision} onChange={(event) => patch({ reglaDecision: event.target.value })} /> : <ReadValue value={form.reglaDecision} />}
          </Field>
          <Field label="Adiciones, desviaciones o exclusiones del método" htmlFor="i-desv">
            {draft ? <Textarea id="i-desv" rows={2} value={form.desviaciones} onChange={(event) => patch({ desviaciones: event.target.value })} /> : <ReadValue value={form.desviaciones} />}
          </Field>
          <Field label="Descargo por muestra recibida con desviación" htmlFor="i-desc" hint={descargoSugerido && !form.descargo ? "La recepción fue aceptada con desviación: se sugiere incluir el descargo." : undefined}>
            {draft ? <Textarea id="i-desc" rows={2} value={form.descargo} onChange={(event) => patch({ descargo: event.target.value })} /> : <ReadValue value={form.descargo} />}
          </Field>
          <Field label="Opiniones e interpretaciones" htmlFor="i-op" hint="Solo personal autorizado; deben ir identificadas como tales (7.8.7).">
            {draft ? <Textarea id="i-op" rows={2} value={form.opiniones} onChange={(event) => patch({ opiniones: event.target.value })} /> : <ReadValue value={form.opiniones} />}
          </Field>
          <Field label="Observaciones internas (no salen en el PDF)" htmlFor="i-obs">
            {draft ? <Textarea id="i-obs" rows={2} value={form.observaciones} onChange={(event) => patch({ observaciones: event.target.value })} /> : <ReadValue value={form.observaciones} />}
          </Field>
        </div>
      </FormCard>

      <FormCard id="sec-firmas" title="Elaboró, revisó, autorizó y liberó" description="Quien elabora firma aquí; la revisión, la autorización y la liberación se firman con los botones de la cabecera y quedan en la bitácora.">
        <div className="flex flex-col gap-4">
          <PersonCard title="Elaboró" requires="informes" name={form.elaboradoNombre} onName={(v) => patch({ elaboradoNombre: v })} cargo={item?.elaborado_cargo ? String(item.elaborado_cargo) : undefined} signature={form.elaboradoFirma} onSignature={(v) => patch({ elaboradoFirma: v })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <SignoffCard title="Revisó" name={item?.revisado_nombre} cargo={item?.revisado_cargo} at={item?.revisado_en} note={excepcionDe("revisar") ? `Revisión autorizada por excepción, solicitud #${excepcionDe("revisar")!.solicitud_id}` : null} hint={editing ? "Se firma con “Marcar revisado”." : "Después de crear el borrador."} />
            <SignoffCard title="Autorizó" name={item?.autorizado_nombre} cargo={item?.autorizado_cargo} at={item?.autorizado_en} note={excepcionDe("autorizar") ? `Autorización autorizada por excepción, solicitud #${excepcionDe("autorizar")!.solicitud_id}` : null} hint={editing ? "Se firma con “Autorizar” tras la revisión." : "Después de la revisión."} />
            <SignoffCard title="Liberó" name={item?.liberado_nombre} cargo={item?.liberado_cargo} at={item?.liberado_en} hint={editing ? "Se firma con “Liberar”: genera el PDF final." : "Después de la autorización."}>
              {item?.pdf_sha256 ? <p className="code mt-1 text-[11px] text-ink-3">SHA-256 {String(item.pdf_sha256).slice(0, 16)}…</p> : null}
            </SignoffCard>
          </div>
        </div>
      </FormCard>


      <SignDialog
        key={sign || "sin-firma"}
        open={sign !== null}
        onOpenChange={(open) => !open && setSign(null)}
        title={sign === "revisar" ? "Marcar informe como revisado" : sign === "autorizar" ? "Autorizar informe" : "Liberar informe"}
        description={sign === "revisar" ? `Quedará registrado a nombre de ${user?.nombre || user?.email || "tu usuario"}.` : sign === "autorizar" ? "La autorización queda firmada; después se libera el informe para generar el PDF final." : "Al liberar se congelan los resultados, se genera el PDF final con su SHA-256 y la recepción pasa a liberada. Ya no se podrá editar."}
        confirmLabel={sign === "revisar" ? "Marcar revisado" : sign === "autorizar" ? "Autorizar" : "Liberar"}
        requireSignature={sign === "autorizar"}
        loading={signing}
        critico={sign === "autorizar" || sign === "liberar"}
        onConfirm={doSign}
      />

    </FormPage>
  );
}
