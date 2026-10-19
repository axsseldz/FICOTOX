"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowSquareOut, LinkSimple, Prohibit, Scales } from "@phosphor-icons/react";
import { RecordHistory } from "@/components/features/audit/RecordHistory";
import { Callout, ChoiceCard, ChoiceGrid, ReadValue, SignoffCard } from "@/components/features/samples/FormLayout";
import { AdjuntosPanel } from "@/components/features/samples/EvidenciaPanel";
import { FolioChip, SegregacionCallout, SolicitudCallout } from "@/components/features/samples/status";
import { PageBody } from "@/components/shell/AppShell";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { Field, FormGrid, Select, Textarea } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Overlay";
import { useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { msg, type Problema } from "@/lib/client/mensajes";
import { Card, CardHeader, DetailRow } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { fmtDateTime } from "@/lib/client/format";
import { usePersonal } from "@/lib/client/personal";
import { useResource } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { CLASIFICACIONES_NC, IMPACTO_LABEL, ORIGEN_AUTOMATICO_LABEL, TIPO_INCIDENCIA_LABEL } from "@/lib/shared/calidad";
import { EstadoIncidencia } from "./comun";
import { useAccionCalidad } from "./acciones";

/*
 * Ficha de una incidencia (Fase 11): lo reportado, los registros ligados, las
 * fotos o archivos, la evaluacion (calidad:R, nunca quien la reporto; regla 7)
 * con su decision (cerrar sin NC o escalar a una NC nueva o existente) y el
 * historial. Anular pide motivo y un segundo usuario.
 */
export function IncidenciaFicha({ item }: { item: ApiRecord }) {
  const router = useRouter();
  const { token, prompt, enviar, solicitarExcepcion } = useAccionCalidad();
  const [evaluando, setEvaluando] = useState(false);
  const puede = (item.puede || {}) as ApiRecord;
  const bloqueo = (item.segregacion as ApiRecord)?.evaluar as string | null;
  const registros = (item.registros || []) as ApiRecord[];
  const nc = item.nc as ApiRecord | null;
  const editable = ["reportada", "en_evaluacion"].includes(String(item.estado));

  const anular = async () => {
    const motivo = await prompt({ critico: true, tone: "danger", title: `Anular ${item.folio}`, description: "La incidencia deja de contar, pero se conserva. La anulación la autoriza otra persona con permiso para anular en calidad.", confirmLabel: "Solicitar anulación" });
    if (motivo) await enviar("POST", `/calidad/incidencias/${item.id}/anular`, { motivo });
  };

  return (
    <PageBody className="max-w-[1040px]">
      <div className="flex flex-col gap-3">
        <Link href="/calidad/incidencias" className="press inline-flex w-fit items-center gap-1.5 rounded-control text-sm font-medium text-ink-3 hover:text-ink">
          <ArrowLeft size={14} /> Incidencias y NC
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <FolioChip type="INC" num={item.folio_num} />
              <EstadoIncidencia estado={item.estado} />
            </div>
            <h1 className="title-1 text-ink">{TIPO_INCIDENCIA_LABEL[String(item.tipo)] || String(item.tipo)}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {puede.evaluar && !bloqueo && item.estado === "reportada" ? (
              <Button variant="secondary" onClick={() => enviar("POST", `/calidad/incidencias/${item.id}/evaluacion`, {}, "Evaluación iniciada")}>
                Iniciar evaluación
              </Button>
            ) : null}
            {puede.evaluar && !bloqueo ? (
              <Button icon={<Scales size={16} />} onClick={() => setEvaluando(true)} data-evaluar>
                Evaluar
              </Button>
            ) : null}
            {puede.anular && !item.solicitud_pendiente ? (
              <Button variant="secondary" icon={<Prohibit size={16} />} onClick={anular}>
                Anular…
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <SolicitudCallout item={item} />
      {puede.evaluar ? <SegregacionCallout bloqueo={bloqueo} accion="evaluar" onSolicitar={() => solicitarExcepcion("incidencias", item.id, "evaluar", String(bloqueo), String(item.folio))} /> : null}
      {item.estado === "anulada" ? (
        <Callout tone="danger" title="Incidencia anulada">
          {String(item.motivo_anulacion || "")}
        </Callout>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Qué pasó" description={item.origen_automatico ? `Generada por el sistema: ${ORIGEN_AUTOMATICO_LABEL[String(item.origen_automatico)] || item.origen_automatico}` : undefined} />
            <div className="flex flex-col gap-4">
              <ReadValue value={item.descripcion} />
              {item.accion_inmediata ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-sm font-medium text-ink-2">Acción inmediata</p>
                  <ReadValue value={item.accion_inmediata} />
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="Fotos y archivos" description={editable ? "Quien reportó (o quien administra calidad) puede agregar fotos mientras se evalúa." : "Solo lectura: la incidencia ya se evaluó."} />
            <AdjuntosPanel registroId={Number(item.id)} base={`/calidad/incidencias/${item.id}`} token={token} clave="calidad" tipoInicial="foto" textos={{ vacioTitulo: "Sin fotos ni archivos", vacioEditable: "Agrega una foto de lo observado o un archivo de apoyo.", vacioLectura: "Esta incidencia no tiene archivos.", boton: "Adjuntar" }} />
          </Card>

          <Card>
            <CardHeader title="Evaluación" />
            {item.evaluada_en ? (
              <div className="flex flex-col gap-3">
                <SignoffCard title={item.decision_evaluacion === "escalar" ? "Escalada a no conformidad" : "Cerrada sin NC"} name={item.evaluada_nombre} cargo={item.evaluada_rol} at={item.evaluada_en} note={item.justificacion} />
                {nc ? (
                  <Button variant="soft" icon={<ArrowSquareOut size={16} />} onClick={() => router.push(`/calidad/nc/${nc.id}`)} className="self-start">
                    Abrir {String(nc.folio)}
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-ink-3">{item.estado === "anulada" ? "No se evaluó." : "Pendiente: la evalúa quien revisa en calidad (Coordinación Técnica, Mejora Continua o Responsable General), nunca quien la reportó."}</p>
            )}
          </Card>
          <RecordHistory entidad="incidencias" entidadId={Number(item.id)} />
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <DetailRow label="Ocurrió">{fmtDateTime(item.fecha_hora_ocurrencia)}</DetailRow>
            <DetailRow label="Reportó">{String(item.reportada_nombre || "—")}</DetailRow>
            {item.reportada_rol ? <DetailRow label="Cargo">{String(item.reportada_rol)}</DetailRow> : null}
            <DetailRow label="Reportada">{fmtDateTime(item.reportada_en)}</DetailRow>
            <DetailRow label="¿Afecta resultados?">{IMPACTO_LABEL[String(item.impacto_resultados)] || "—"}</DetailRow>
          </Card>
          <Card>
            <CardHeader title="Registros relacionados" />
            {registros.length ? (
              <ul className="flex flex-col gap-1.5">
                {registros.map((r) => (
                  <li key={String(r.id)}>
                    {r.href ? (
                      <Link href={String(r.href)} className="press flex items-center gap-2 rounded-field px-2 py-1.5 text-sm text-ink hover:bg-surface-3/80">
                        <LinkSimple size={14} className="text-ink-3" />
                        <span className="text-ink-3">{String(r.etiqueta)}</span> {String(r.referencia)}
                      </Link>
                    ) : (
                      <span className="px-2 text-sm">{String(r.referencia)}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">Sin registros ligados.</p>
            )}
          </Card>
        </div>
      </div>

      {evaluando ? <EvaluarSheet item={item} onClose={() => setEvaluando(false)} /> : null}
    </PageBody>
  );
}

function EvaluarSheet({ item, onClose }: { item: ApiRecord; onClose: () => void }) {
  const { token, enviar } = useAccionCalidad();
  const { can } = useSession();
  const router = useRouter();
  const personal = usePersonal();
  const [open, setOpen] = useState(true);
  const [decision, setDecision] = useState<"cerrar_sin_nc" | "escalar">("escalar");
  const [destino, setDestino] = useState<"nueva" | "existente">("nueva");
  const [justificacion, setJustificacion] = useState("");
  const [clasificacion, setClasificacion] = useState("");
  const [requisito, setRequisito] = useState("");
  const [responsable, setResponsable] = useState("");
  const [ncId, setNcId] = useState("");
  const [enviando, setEnviando] = useState(false);
  const abiertas = useResource<ApiRecord>("calidad", () => getJsonAuth(`${API_BASE_URL}/calidad/nc?estado=abiertas`, token), { enabled: !!token && decision === "escalar" && destino === "existente", deps: [decision, destino] });
  const cerrar = () => {
    setOpen(false);
    window.setTimeout(onClose, 250);
  };
  const v = useValidacion({
    titulo: decision === "escalar" ? "No se pudo escalar la incidencia" : "No se pudo cerrar la incidencia",
    reglas: () => {
      const out: Problema[] = [];
      if (justificacion.trim().length < 10) out.push({ campo: "eval-just", mensaje: justificacion.trim() ? msg.minimo("La justificación", 10) : msg.escribe("la justificación"), grupo: "Justificación" });
      if (decision === "escalar" && destino === "existente" && !ncId) out.push({ campo: "eval-nc", mensaje: msg.elige("la no conformidad abierta"), grupo: "No conformidad" });
      return out;
    },
  });
  const guardar = async () => {
    if (!v.validar()) return;
    setEnviando(true);
    const body: ApiRecord = { decision, justificacion };
    if (decision === "escalar") {
      if (destino === "existente") body.nc_id = Number(ncId);
      else body.nc = { clasificacion: clasificacion || null, requisito_incumplido: requisito, responsable_id: responsable ? Number(responsable) : null };
    }
    const data = await enviar("POST", `/calidad/incidencias/${item.id}/evaluar`, body, undefined, (err) => v.errorServidor(err, { motivo: "eval-just" }));
    setEnviando(false);
    if (!data) return;
    cerrar();
    if (data.nc_id) router.push(`/calidad/nc/${data.nc_id}`);
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : cerrar())}
      title={`Evaluar ${item.folio}`}
      description="Decide si la incidencia se cierra aquí o si es una no conformidad (7.10: trabajo no conforme)."
      footer={
        <>
          <Button variant="secondary" onClick={cerrar}>
            Cancelar
          </Button>
          <Button onClick={guardar} loading={enviando} data-guardar-evaluacion>
            {decision === "escalar" ? "Escalar a NC" : "Cerrar sin NC"}
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
      <div className="flex flex-col gap-5">
        <ChoiceGrid cols={2}>
          <ChoiceCard type="radio" name="decision" checked={decision === "escalar"} onChange={() => setDecision("escalar")} label="Escalar a no conformidad" description="Requiere análisis de causa y, en su caso, acciones correctivas." />
          <ChoiceCard type="radio" name="decision" checked={decision === "cerrar_sin_nc"} onChange={() => setDecision("cerrar_sin_nc")} label="Cerrar sin NC" description="Evento aislado, sin incumplimiento de un requisito." />
        </ChoiceGrid>
        <Field label="Justificación" htmlFor="eval-just" required hint="Al menos 10 caracteres; queda en la ficha y en la bitácora.">
          <Textarea id="eval-just" rows={3} value={justificacion} onChange={(event) => setJustificacion(event.target.value)} />
        </Field>
        {decision === "escalar" ? (
          <>
            <ChoiceGrid cols={2}>
              <ChoiceCard type="radio" name="destino" checked={destino === "nueva"} onChange={() => setDestino("nueva")} label="NC nueva" />
              <ChoiceCard type="radio" name="destino" checked={destino === "existente"} onChange={() => setDestino("existente")} label="Agregar a una NC abierta" description="Varias incidencias del mismo problema." />
            </ChoiceGrid>
            {destino === "existente" ? (
              <Field label="No conformidad" htmlFor="eval-nc" required>
                <Select id="eval-nc" value={ncId} onChange={(event) => setNcId(event.target.value)}>
                  <option value="">Elegir…</option>
                  {((abiertas.data?.items || []) as ApiRecord[]).map((n) => (
                    <option key={n.id} value={n.id}>
                      {String(n.folio)} · {String(n.descripcion).slice(0, 70)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <FormGrid cols={1}>
                <Field label="Requisito incumplido" htmlFor="eval-req" hint="Cláusula ISO, procedimiento o formato.">
                  <Textarea id="eval-req" rows={2} value={requisito} onChange={(event) => setRequisito(event.target.value)} />
                </Field>
                <Field label="Clasificación" htmlFor="eval-clasif" hint="Por validar con Mejora Continua.">
                  <Select id="eval-clasif" value={clasificacion} onChange={(event) => setClasificacion(event.target.value)}>
                    <option value="">Sin clasificar</option>
                    {CLASIFICACIONES_NC.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label} — {c.hint}
                      </option>
                    ))}
                  </Select>
                </Field>
                {can("calidad", "G", { objeto: "nc" }) ? (
                <Field label="Responsable" htmlFor="eval-resp" hint="Opcional; cambiarlo después pide motivo.">
                  <Select id="eval-resp" value={responsable} onChange={(event) => setResponsable(event.target.value)}>
                    <option value="">Sin nombrar</option>
                    {personal.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                        {p.rol ? ` · ${p.rol}` : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
                ) : null}
              </FormGrid>
            )}
          </>
        ) : null}
      </div>
      </ValidacionAmbito>
    </Sheet>
  );
}
