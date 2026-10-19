"use client";

import { formatearFolio } from "@/lib/shared/folios";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, CheckCircle, FilePdf, FileText, FloppyDisk, LinkSimple, Lock, Paperclip, Pause, Play, Plus, Prohibit, SealCheck, Warning } from "@phosphor-icons/react";
import { RecordHistory } from "@/components/features/audit/RecordHistory";
import { Callout, ChoiceCard, ChoiceGrid, FlowSteps, FormCard, FormPage, Panel, ReadValue, SignoffCard, type FormSectionDef } from "@/components/features/samples/FormLayout";
import { AdjuntosPanel } from "@/components/features/samples/EvidenciaPanel";
import { BotonSegregado, FolioChip, SegregacionCallout, SolicitudCallout } from "@/components/features/samples/status";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { DateInput } from "@/components/ui/DateInput";
import { cn } from "@/components/ui/cn";
import { Checkbox, controlClassSm, Field, FormGrid, Input, Select, Switch, Textarea } from "@/components/ui/Field";
import { ActionMenu, Sheet, type MenuItem } from "@/components/ui/Overlay";
import { Badge, DetailRow } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { verPdf } from "@/lib/client/files";
import { fmtDate, fmtDateTime } from "@/lib/client/format";
import { useDebouncedValue } from "@/lib/client/hooks";
import { usePersonal } from "@/lib/client/personal";
import { useResource } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { CLASIFICACIONES_NC, ESTADOS_NC, ETAPAS_NC, MEDIOS_COMUNICACION, MEDIO_COMUNICACION_LABEL, METODOS_CAUSA, METODOS_SUSPENDIBLES, ORIGEN_NC_LABEL, TIPO_INCIDENCIA_LABEL } from "@/lib/shared/calidad";
import { hoyLocal } from "@/lib/shared/fechas";
import { useAccionCalidad } from "./acciones";
import { CampoValidado, useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { msg, type Problema } from "@/lib/client/mensajes";
import { ClasificacionNc, EstadoAccion } from "./comun";

/*
 * Registro de no conformidad como formato de pagina (Fase 11; 7.10 y 8.7):
 * nueve secciones con indicador de etapa. Los campos se editan (calidad:G o el
 * responsable de la NC con calidad:C+) y se guardan con "Guardar cambios"; las
 * acciones de cada seccion (retener, suspender, verificar, cerrar...) aparecen
 * segun el permiso y el estado, o se deshabilitan con la explicacion.
 */

const CAMPOS = ["descripcion", "requisito_incumplido", "clasificacion", "responsable_id", "afecta_resultados_emitidos", "trabajo_detenido", "notificar_cliente", "impacto_notas", "metodo_causa", "desarrollo_causa", "causa_raiz", "requiere_accion_correctiva", "justificacion_sin_accion", "requiere_actualizar_riesgos", "nota_riesgos", "requiere_cambio_documental", "verificacion_programada"] as const;
type Campo = (typeof CAMPOS)[number];
type Borrador = Record<Campo, string>;

const aTexto = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "1" : "0") : String(v));
const borradorDe = (item: ApiRecord): Borrador => Object.fromEntries(CAMPOS.map((c) => [c, aTexto(item[c])])) as Borrador;
const SI_NO = [
  { value: "si", label: "Sí" },
  { value: "no", label: "No" },
];
const SIGUIENTE: Record<string, { a: string; label: string }> = {
  abierta: { a: "en_analisis", label: "Iniciar análisis" },
  en_analisis: { a: "acciones_en_curso", label: "Pasar a acciones" },
  acciones_en_curso: { a: "en_verificacion", label: "Pasar a verificación" },
};

export function NcForm({ item }: { item: ApiRecord }) {
  const { prompt, enviar, solicitarExcepcion } = useAccionCalidad();
  const personal = usePersonal();
  const puede = (item.puede || {}) as ApiRecord;
  const segregacion = (item.segregacion || {}) as Record<string, string | null>;
  const estado = String(item.estado);
  const cerrada = estado === "cerrada" || estado === "anulada";
  const editar = !!puede.editar;
  const administrar = !!puede.administrar;
  const [d, setD] = useState<Borrador>(() => borradorDe(item));
  const original = borradorDe(item);
  const cambios = CAMPOS.filter((c) => d[c] !== original[c]);
  const set = (campo: Campo) => (valor: string) => setD((prev) => ({ ...prev, [campo]: valor }));
  const [guardando, setGuardando] = useState(false);

  const acciones = (item.acciones || []) as ApiRecord[];
  const vigentes = acciones.filter((a) => a.estado !== "cancelada");
  const retenciones = (item.retenciones || []) as ApiRecord[];
  const suspensiones = (item.suspensiones || []) as ApiRecord[];
  const comunicaciones = (item.comunicaciones || []) as ApiRecord[];
  const verificaciones = (item.verificaciones || []) as ApiRecord[];
  const afectados = (item.afectados || []) as ApiRecord[];
  const incidencias = (item.incidencias || []) as ApiRecord[];

  /*
   * Reglas de la NC, en el orden del formato. `requisitosEtapa` es lo que el
   * servidor exige para pasar a la siguiente etapa; `reglasGuardar`, lo que se
   * exige para guardar cambios. La guía usa todas (nunca contradice al aviso
   * del encabezado, que muestra solo las del intento).
   */
  const G = { origen: ["sec-origen", "Origen"], desc: ["sec-descripcion", "Descripción y requisito"], impacto: ["sec-impacto", "Evaluación de impacto"], causa: ["sec-causa", "Análisis de causa"], acciones: ["sec-acciones", "Acciones correctivas"], verif: ["sec-verificacion", "Verificación de eficacia"] } as const;
  const pb = (g: readonly [string, string], campo: string, mensaje: string): Problema => ({ campo, mensaje, seccion: g[0], grupo: g[1] });
  const reglasGuardar = (): Problema[] => {
    const out: Problema[] = [];
    if (editar && d.descripcion.trim().length < 20) out.push(pb(G.desc, "nc-descripcion", d.descripcion.trim() ? msg.minimo("La descripción", 20) : msg.escribe("la descripción de la no conformidad")));
    if (editar && d.requiere_accion_correctiva === "no" && !d.justificacion_sin_accion.trim()) out.push(pb(G.causa, "nc-justificacion", msg.escribe("por qué no requiere acción correctiva (¿puede repetirse?)")));
    return out;
  };
  const impactoFaltante = (): Problema[] =>
    (
      [
        ["afecta_resultados_emitidos", "si afecta resultados emitidos"],
        ["trabajo_detenido", "si se detiene el trabajo"],
        ["notificar_cliente", "si se notifica al cliente"],
      ] as Array<[Campo, string]>
    )
      .filter(([c]) => !d[c])
      .map(([c, t]) => pb(G.impacto, `nc-${c}`, `Indica ${t}`));
  const requisitosEtapa = (): Problema[] => {
    const out: Problema[] = [];
    if (estado === "abierta") {
      if (!d.responsable_id) out.push(pb(G.origen, "nc-responsable", "Nombra al responsable de la NC"));
      out.push(...impactoFaltante());
    } else if (estado === "en_analisis") {
      if (!d.metodo_causa) out.push(pb(G.causa, "nc-metodo", msg.elige("el método de análisis de causa")));
      if (d.causa_raiz.trim().length < 10) out.push(pb(G.causa, "nc-causa", d.causa_raiz.trim() ? msg.minimo("La causa raíz", 10) : msg.escribe("la causa raíz")));
      if (!d.requiere_accion_correctiva) out.push(pb(G.causa, "nc-requiere", "Decide si requiere acción correctiva"));
      else if (d.requiere_accion_correctiva === "no") out.push(pb(G.causa, "nc-requiere", "Con «No» la NC no pasa a acciones: se cierra tras la evaluación de impacto"));
      if (!vigentes.length) out.push(pb(G.acciones, "nc-acciones-lista", "Agrega al menos una acción correctiva"));
    } else if (estado === "acciones_en_curso") {
      if (vigentes.some((a) => ["pendiente", "en_proceso"].includes(String(a.estado)))) out.push(pb(G.acciones, "nc-acciones-lista", "Hay acciones pendientes o en proceso: márcalas como implementadas o cancélalas"));
      else if (!vigentes.some((a) => a.estado === "implementada")) out.push(pb(G.acciones, "nc-acciones-lista", "No hay acciones implementadas que verificar"));
    }
    return out;
  };
  const reglasCompletas = (): Problema[] => {
    const out: Problema[] = [];
    if (!d.clasificacion) out.push(pb(G.origen, "nc-clasificacion", msg.elige("la clasificación")));
    if (!d.responsable_id) out.push(pb(G.origen, "nc-responsable", "Nombra al responsable de la NC"));
    if (d.descripcion.trim().length < 20) out.push(pb(G.desc, "nc-descripcion", msg.minimo("La descripción", 20)));
    if (!d.requisito_incumplido.trim()) out.push(pb(G.desc, "nc-requisito", msg.indica("el requisito incumplido")));
    out.push(...impactoFaltante());
    if (!d.metodo_causa) out.push(pb(G.causa, "nc-metodo", msg.elige("el método de análisis de causa")));
    if (d.causa_raiz.trim().length < 10) out.push(pb(G.causa, "nc-causa", msg.minimo("La causa raíz", 10)));
    if (!d.requiere_accion_correctiva) out.push(pb(G.causa, "nc-requiere", "Decide si requiere acción correctiva"));
    if (d.requiere_accion_correctiva === "si" && !(vigentes.length > 0 && vigentes.every((a) => a.estado === "implementada"))) out.push(pb(G.acciones, "nc-acciones-lista", "Faltan acciones implementadas"));
    if (d.requiere_accion_correctiva !== "no" && verificaciones.at(-1)?.resultado !== "eficaz") out.push(pb(G.verif, "nc-verificacion", "Falta la verificación eficaz"));
    return out;
  };
  const [objetivo, setObjetivo] = useState<"guardar" | "avanzar">("guardar");
  const vGuardar = useValidacion({ titulo: "No se pudieron guardar los cambios de la NC", reglas: reglasGuardar });
  const vAvanzar = useValidacion({ titulo: SIGUIENTE[estado] ? `No se puede «${SIGUIENTE[estado].label}»` : "No se puede avanzar", reglas: requisitosEtapa });
  const v = objetivo === "avanzar" ? vAvanzar : vGuardar;
  const completas = reglasCompletas();
  const completa = (id: string) => !completas.some((p) => p.seccion === id);

  const guardar = async () => {
    setObjetivo("guardar");
    if (!vGuardar.validar()) return;
    const payload: ApiRecord = {};
    for (const c of cambios) {
      if (c === "requiere_actualizar_riesgos" || c === "requiere_cambio_documental") payload[c] = d[c] === "1";
      else payload[c] = d[c] === "" ? null : c === "responsable_id" ? Number(d[c]) : d[c];
    }
    if (payload.responsable_id !== undefined && item.responsable_id) {
      const motivo = await prompt({ title: "Cambiar al responsable de la NC", description: "El cambio queda en la bitácora con su motivo.", label: "Motivo del cambio" });
      if (!motivo) return;
      payload.motivo = motivo;
    }
    setGuardando(true);
    await enviar("PUT", `/calidad/nc/${item.id}`, payload, "Cambios guardados", (err) => vGuardar.errorServidor(err, { motivo: "nc-descripcion" }));
    setGuardando(false);
  };

  const siguiente = SIGUIENTE[estado];
  const avanzar = () => {
    setObjetivo("avanzar");
    if (!vAvanzar.validar()) return;
    return enviar("POST", `/calidad/nc/${item.id}/avanzar`, { a: siguiente.a }, undefined, (err) => vAvanzar.errorServidor(err));
  };

  const anular = async () => {
    const motivo = await prompt({ critico: true, tone: "danger", title: `Anular ${item.folio}`, description: "La NC deja de contar, pero se conserva. La anulación la autoriza otra persona con permiso para anular en calidad.", confirmLabel: "Solicitar anulación" });
    if (motivo) await enviar("POST", `/calidad/nc/${item.id}/anular`, { motivo });
  };
  const pdf = (actual: boolean) => verPdf(`${API_BASE_URL}/calidad/nc/${item.id}/pdf${actual ? "?actual=1" : ""}`, `${String(item.folio).replace(" ", "-")}.pdf`, String(item.folio));

  // Completitud por seccion con las mismas reglas que el guardado y el avance de etapa.
  const sections: FormSectionDef[] = [
    { id: "sec-origen", label: "Origen", complete: completa("sec-origen") },
    { id: "sec-descripcion", label: "Descripción y requisito", complete: completa("sec-descripcion") },
    { id: "sec-impacto", label: "Evaluación de impacto", complete: completa("sec-impacto") },
    { id: "sec-causa", label: "Análisis de causa", complete: completa("sec-causa") },
    { id: "sec-acciones", label: "Acciones correctivas", complete: completa("sec-acciones"), optional: d.requiere_accion_correctiva === "no" },
    { id: "sec-verificacion", label: "Verificación de eficacia", complete: completa("sec-verificacion"), optional: d.requiere_accion_correctiva === "no" },
    { id: "sec-sgc", label: "Efectos en el SGC", optional: true },
    { id: "sec-cierre", label: "Cierre", complete: estado === "cerrada" },
    { id: "sec-historial", label: "Historial", optional: true },
  ];

  const mas: MenuItem[] = [
    { label: "PDF del estado actual", description: "Vista a pedido; no sustituye al PDF final", icon: <FilePdf size={16} weight="duotone" />, onSelect: () => pdf(true) },
    ...(puede.anular && !item.solicitud_pendiente ? [{ label: "Anular…", description: "Acción crítica con segundo usuario", icon: <Prohibit size={16} weight="duotone" />, tone: "danger" as const, separatorBefore: true, onSelect: anular }] : []),
  ];
  const estadoMeta = ESTADOS_NC[estado];
  const sinGuardar = cambios.length > 0;

  return (
    <FormPage
      backHref="/calidad/incidencias?tipos=nc"
      backLabel="Incidencias y NC"
      code="Registro de no conformidad"
      title={String(item.folio)}
      status={estadoMeta?.label || estado}
      statusTone={estadoMeta?.tone === "ink" ? "neutral" : estadoMeta?.tone || "neutral"}
      sections={sections}
      validacion={v}
      /* Sin fieldset desactivado: cada campo decide si se edita (descargas y evidencia siguen activas al cerrar). */
      readOnly={false}
      actions={
        <>
          <ActionMenu items={mas} label="Más acciones" size="lg" header={String(item.folio)} />
          {item.pdf_disponible ? (
            <Button variant="secondary" icon={<FilePdf size={16} />} onClick={() => pdf(false)}>
              PDF final
            </Button>
          ) : null}
          {editar && sinGuardar ? (
            <Button icon={<FloppyDisk size={16} />} onClick={guardar} loading={guardando} data-guardar-nc>
              Guardar cambios
            </Button>
          ) : null}
          {editar && siguiente && !sinGuardar ? (
            <Button variant="soft" iconRight={<ArrowRight size={16} />} onClick={avanzar} data-avanzar-nc>
              {siguiente.label}
            </Button>
          ) : null}
        </>
      }
      after={
        <FormCard id="sec-historial" title="9. Historial" description="Bitácora de auditoría de la NC: cada cambio, con quién, cuándo y por qué.">
          <RecordHistory entidad="no_conformidades" entidadId={Number(item.id)} />
        </FormCard>
      }
    >
      <div className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card" data-etapa={estado}>
        <FlowSteps steps={ETAPAS_NC.map((e) => ({ key: e, label: ESTADOS_NC[e].label }))} current={estado === "anulada" ? "" : estado} failed={estado === "anulada" ? "Anulada" : Number(item.reaperturas) ? `${item.reaperturas} reapertura${Number(item.reaperturas) > 1 ? "s" : ""}` : undefined} />
        {sinGuardar ? <p className="text-xs text-warning-text">Tienes cambios sin guardar ({cambios.length}). Guárdalos antes de avanzar de etapa.</p> : null}
        {!editar && !cerrada ? <p className="text-xs text-ink-3">Editan la NC quien administra calidad y su responsable.</p> : null}
      </div>
      <SolicitudCallout item={item} />
      {estado === "anulada" ? (
        <Callout tone="danger" title="NC anulada">
          {String(item.motivo_anulacion || "")}
        </Callout>
      ) : null}

      {/* 1. Origen */}
      <FormCard id="sec-origen" title="1. Origen" description="De dónde viene la NC, su clasificación y quién la conduce.">
        <div className="grid gap-x-6 sm:grid-cols-2">
          <div>
            <DetailRow label="Origen">{ORIGEN_NC_LABEL[String(item.origen)] || String(item.origen)}</DetailRow>
            <DetailRow label="Abierta">{`${fmtDateTime(item.creada_en)} · ${String(item.creada_nombre || "—")}`}</DetailRow>
            {item.creada_rol ? <DetailRow label="Cargo">{String(item.creada_rol)}</DetailRow> : null}
          </div>
          <div>
            {incidencias.length ? (
              <DetailRow label="Incidencias">
                <span className="flex flex-wrap justify-end gap-1.5">
                  {incidencias.map((i) =>
                    i.restringida ? (
                      <FolioChip key={String(i.id)} type="INC" num={i.folio_num} />
                    ) : (
                      <Link key={String(i.id)} href={`/calidad/incidencias/${i.id}`} className="press rounded-sm" title={String(i.descripcion)}>
                        <FolioChip type="INC" num={i.folio_num} />
                      </Link>
                    ),
                  )}
                </span>
              </DetailRow>
            ) : null}
            {incidencias[0]?.tipo ? <DetailRow label="Tipo">{TIPO_INCIDENCIA_LABEL[String(incidencias[0].tipo)] || String(incidencias[0].tipo)}</DetailRow> : null}
          </div>
        </div>
        <FormGrid className="mt-2">
          <Field label="Clasificación" htmlFor="nc-clasificacion" hint="Por validar con Mejora Continua.">
            {editar ? (
              <Select id="nc-clasificacion" value={d.clasificacion} onChange={(event) => set("clasificacion")(event.target.value)}>
                <option value="">Sin clasificar</option>
                {CLASIFICACIONES_NC.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label} — {c.hint}
                  </option>
                ))}
              </Select>
            ) : (
              <div className="flex h-10 items-center">
                <ClasificacionNc valor={item.clasificacion} />
              </div>
            )}
          </Field>
          <Field label="Responsable de la NC" htmlFor="nc-responsable" hint={administrar ? "Lo nombra o cambia quien administra calidad; el cambio pide motivo." : "Lo nombra quien administra calidad."}>
            {administrar && !cerrada ? (
              <Select id="nc-responsable" value={d.responsable_id} onChange={(event) => set("responsable_id")(event.target.value)}>
                <option value="">Sin nombrar</option>
                {personal.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                    {p.rol ? ` · ${p.rol}` : ""}
                  </option>
                ))}
              </Select>
            ) : (
              <div className="flex h-10 items-center gap-2 text-base">
                {(item.responsable as ApiRecord)?.nombre || <span className="text-ink-3">Sin nombrar</span>}
              </div>
            )}
          </Field>
        </FormGrid>
        {item.responsable && !(item.responsable as ApiRecord).vigente ? (
          <Callout tone="warning" title="El responsable ya no tiene una cuenta vigente">
            Quien administra calidad debe nombrar a otra persona (con motivo).
          </Callout>
        ) : null}
      </FormCard>

      {/* 2. Descripcion y requisito */}
      <FormCard id="sec-descripcion" title="2. Descripción y requisito incumplido">
        <Field label="Descripción" htmlFor="nc-descripcion" required hint="Al menos 20 caracteres.">
          {editar ? <Textarea id="nc-descripcion" rows={4} value={d.descripcion} onChange={(event) => set("descripcion")(event.target.value)} /> : <ReadValue value={item.descripcion} />}
        </Field>
        <Field label="Requisito incumplido" htmlFor="nc-requisito" hint="Cláusula ISO, procedimiento o formato.">
          {editar ? <Textarea id="nc-requisito" rows={2} value={d.requisito_incumplido} onChange={(event) => set("requisito_incumplido")(event.target.value)} /> : <ReadValue value={item.requisito_incumplido} />}
        </Field>
      </FormCard>

      {/* 3. Evaluacion de impacto */}
      <FormCard id="sec-impacto" title="3. Evaluación de impacto (7.10.1)" description="Resultados emitidos, retención de informes, suspensión del trabajo y comunicación con el cliente.">
        <FormGrid cols={3}>
          {(
            [
              ["afecta_resultados_emitidos", "¿Afecta resultados emitidos?"],
              ["trabajo_detenido", "¿Se detiene el trabajo?"],
              ["notificar_cliente", "¿Se notifica al cliente?"],
            ] as Array<[Campo, string]>
          ).map(([campo, label]) => (
            <Field key={campo} label={label} htmlFor={`nc-${campo}`}>
              {editar ? (
                <Select id={`nc-${campo}`} value={d[campo]} onChange={(event) => set(campo)(event.target.value)}>
                  <option value="">Sin evaluar</option>
                  {SI_NO.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <div className="flex h-10 items-center text-base">{item[campo] === "si" ? "Sí" : item[campo] === "no" ? "No" : "Sin evaluar"}</div>
              )}
            </Field>
          ))}
        </FormGrid>
        <Field label="Notas de la evaluación" htmlFor="nc-impacto-notas">
          {editar ? <Textarea id="nc-impacto-notas" rows={2} value={d.impacto_notas} onChange={(event) => set("impacto_notas")(event.target.value)} /> : <ReadValue value={item.impacto_notas} />}
        </Field>
        {item.impacto_evaluado_en ? <p className="text-xs text-ink-3">Evaluó {String(item.impacto_evaluado_nombre || "—")} · {fmtDateTime(item.impacto_evaluado_en)}</p> : null}

        <InformesAfectados item={item} afectados={afectados} retenciones={retenciones} editar={editar && !cerrada} />
        <Suspensiones item={item} suspensiones={suspensiones} />
        <Comunicaciones item={item} comunicaciones={comunicaciones} afectados={afectados} editar={editar && !cerrada} requerida={d.notificar_cliente === "si"} />
      </FormCard>

      {/* 4. Analisis de causa */}
      <FormCard id="sec-causa" title="4. Análisis de causa (8.7.1 b)" description="Por qué ocurrió y si puede repetirse.">
        <Field label="Método" htmlFor="nc-metodo">
          {editar ? (
            <Select id="nc-metodo" value={d.metodo_causa} onChange={(event) => set("metodo_causa")(event.target.value)}>
              <option value="">Elegir…</option>
              {METODOS_CAUSA.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          ) : (
            <ReadValue value={METODOS_CAUSA.find((m) => m.value === item.metodo_causa)?.label} />
          )}
        </Field>
        <Field label="Desarrollo" htmlFor="nc-desarrollo" hint="Los porqués o las ramas del diagrama.">
          {editar ? <Textarea id="nc-desarrollo" rows={4} value={d.desarrollo_causa} onChange={(event) => set("desarrollo_causa")(event.target.value)} /> : <ReadValue value={item.desarrollo_causa} />}
        </Field>
        <Field label="Causa raíz" htmlFor="nc-causa" hint="Al menos 10 caracteres.">
          {editar ? <Textarea id="nc-causa" rows={2} value={d.causa_raiz} onChange={(event) => set("causa_raiz")(event.target.value)} /> : <ReadValue value={item.causa_raiz} />}
        </Field>
        <Field label="¿Requiere acción correctiva?">
          {editar ? (
            <CampoValidado id="nc-requiere">
            <ChoiceGrid cols={2}>
              <ChoiceCard type="radio" name="nc-requiere" checked={d.requiere_accion_correctiva === "si"} onChange={() => set("requiere_accion_correctiva")("si")} label="Sí" description="Se definen acciones y se verifica su eficacia." />
              <ChoiceCard type="radio" name="nc-requiere" checked={d.requiere_accion_correctiva === "no"} onChange={() => set("requiere_accion_correctiva")("no")} label="No" description="Se cierra tras la evaluación de impacto, con justificación." />
            </ChoiceGrid>
            </CampoValidado>
          ) : (
            <ReadValue value={item.requiere_accion_correctiva === "si" ? "Sí" : item.requiere_accion_correctiva === "no" ? "No" : ""} />
          )}
        </Field>
        {d.requiere_accion_correctiva === "no" ? (
          <Field label="Justificación (8.7.1: ¿puede repetirse?)" htmlFor="nc-justificacion" required>
            {editar ? <Textarea id="nc-justificacion" rows={2} value={d.justificacion_sin_accion} onChange={(event) => set("justificacion_sin_accion")(event.target.value)} /> : <ReadValue value={item.justificacion_sin_accion} />}
          </Field>
        ) : null}
      </FormCard>

      {/* 5. Acciones correctivas */}
      <FormCard id="sec-acciones" title="5. Acciones correctivas (8.7.1 c)" description="Responsable, fecha compromiso, estado y evidencia de cada acción.">
        <CampoValidado id="nc-acciones-lista">
          <AccionesTabla item={item} acciones={acciones} editar={editar && ["en_analisis", "acciones_en_curso"].includes(estado)} editorNc={editar} />
        </CampoValidado>
      </FormCard>

      {/* 6. Verificacion */}
      <FormCard id="sec-verificacion" title="6. Verificación de eficacia (8.7.1 d)" description="Por NC: se verifica que el conjunto de acciones eliminó la causa. La verifica quien revisa en calidad, nunca el responsable de una acción.">
        <Field label="Verificación programada" htmlFor="nc-verif-prog">
          {editar ? <DateInput id="nc-verif-prog" value={d.verificacion_programada} onChange={set("verificacion_programada")} min={hoyLocal()} /> : <ReadValue value={fmtDate(item.verificacion_programada)} />}
        </Field>
        {verificaciones.length ? (
          <div className="flex flex-col gap-2">
            {verificaciones.map((v) => (
              <SignoffCard key={String(v.id)} title={v.resultado === "eficaz" ? "Eficaz" : "No eficaz (reabrió la NC)"} name={v.verificada_nombre} cargo={v.verificada_rol} at={v.verificada_en} note={v.comentarios} />
            ))}
          </div>
        ) : null}
        <CampoValidado id="nc-verificacion">
          <Verificar item={item} bloqueo={segregacion.verificar} onExcepcion={() => solicitarExcepcion("no_conformidades", item.id, "verificar", String(segregacion.verificar), String(item.folio))} />
        </CampoValidado>
      </FormCard>

      {/* 7. Efectos en el SGC */}
      <FormCard id="sec-sgc" title="7. Efectos en el sistema de gestión (8.7.1 e, f)" optional>
        <Switch checked={d.requiere_actualizar_riesgos === "1"} onCheckedChange={(v) => set("requiere_actualizar_riesgos")(v ? "1" : "0")} disabled={!editar} label="Actualizar riesgos y oportunidades" description="Se registra la bandera y la nota; el módulo de riesgos llegará después." />
        {d.requiere_actualizar_riesgos === "1" ? (
          <Field label="Nota de riesgos" htmlFor="nc-nota-riesgos">
            {editar ? <Textarea id="nc-nota-riesgos" rows={2} value={d.nota_riesgos} onChange={(event) => set("nota_riesgos")(event.target.value)} /> : <ReadValue value={item.nota_riesgos} />}
          </Field>
        ) : null}
        <Switch checked={d.requiere_cambio_documental === "1"} onCheckedChange={(v) => set("requiere_cambio_documental")(v ? "1" : "0")} disabled={!editar} label="Requiere cambio documental" description="Se registra la bandera. El cambio se propone en Calidad › Documentos SGC («Nueva solicitud») y sigue su flujo de revisión y autorización." />
        <PropuestaAnterior item={item} />
      </FormCard>

      {/* 8. Cierre */}
      <FormCard id="sec-cierre" title="8. Cierre" description="Lo cierra quien aprueba en calidad (con su contraseña), nunca el responsable de la NC.">
        <Cierre item={item} bloqueo={segregacion.cerrar} onExcepcion={() => solicitarExcepcion("no_conformidades", item.id, "cerrar", String(segregacion.cerrar), String(item.folio))} onPdf={() => pdf(false)} />
      </FormCard>
    </FormPage>
  );
}

/* ---------- 3. Informes afectados y retenciones ---------- */

function InformePicker({ onElegir, excluir }: { onElegir: (informe: ApiRecord) => void; excluir: number[] }) {
  const { token } = useSession();
  const [q, setQ] = useState("");
  const buscar = useDebouncedValue(q);
  const recurso = useResource<ApiRecord>("informes", () => getJsonAuth(`${API_BASE_URL}/informes?search=${encodeURIComponent(buscar.trim())}`, token), { enabled: !!token && buscar.trim().length >= 2, deps: [buscar] });
  const items = ((recurso.data?.items || []) as ApiRecord[]).filter((i) => !excluir.includes(Number(i.id))).slice(0, 8);
  return (
    <div className="flex flex-col gap-1.5">
      <Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Buscar informe por folio, cliente o ID interno" aria-label="Buscar informe afectado" small />
      {buscar.trim().length >= 2 && items.length ? (
        <ul className="flex flex-col gap-1 rounded-field bg-surface p-1 ring-1 ring-line">
          {items.map((i) => (
            <li key={String(i.id)}>
              <button type="button" onClick={() => (onElegir(i), setQ(""))} className="press flex w-full items-center justify-between gap-2 rounded-control px-2 py-1.5 text-left text-sm hover:bg-surface-3">
                <span className="flex items-center gap-2">
                  <FolioChip type="IR" num={i.folio_num} /> {String((i.cliente as ApiRecord)?.nombre || i.solicitante || "")}
                </span>
                <Badge>{String(i.estado)}</Badge>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function InformesAfectados({ item, afectados, retenciones, editar }: { item: ApiRecord; afectados: ApiRecord[]; retenciones: ApiRecord[]; editar: boolean }) {
  const { prompt, enviar } = useAccionCalidad();
  const puede = item.puede as ApiRecord;
  const activa = (informeId: unknown) => retenciones.find((r) => Number(r.informe_id) === Number(informeId) && !r.liberada_en);
  const retener = async (informeId: unknown, ref: string) => {
    const motivo = await prompt({ title: `Retener ${ref}`, description: "Mientras esté retenido no se libera ni se envía. Si ya se envió, queda marcado como retenido (sin reenvío).", label: "Motivo de la retención" });
    if (motivo) await enviar("POST", `/calidad/nc/${item.id}/retenciones`, { informe_id: informeId, motivo });
  };
  const liberar = async (r: ApiRecord) => {
    const motivo = await prompt({ critico: true, title: `Liberar la retención de ${r.informe}`, description: "El informe vuelve a poder liberarse y enviarse.", label: "Motivo de la liberación", confirmLabel: "Liberar retención" });
    if (motivo) await enviar("POST", `/calidad/retenciones/${r.id}/liberar`, { motivo });
  };
  return (
    <Panel title="Informes afectados y retenciones" description="Informes emitidos con resultados en duda. Si hay que corregirlos se usa la enmienda del análisis y del informe.">
      {afectados.length ? (
        <ul className="flex flex-col gap-2">
          {afectados.map((a) => {
            const ret = activa(a.entidad_id);
            return (
              <li key={String(a.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-field bg-surface px-3 py-2 ring-1 ring-line" data-afectado={String(a.entidad_id)}>
                <span className="flex flex-col">
                  <Link href={`/informes/${a.entidad_id}`} className="flex items-center gap-2 text-sm font-medium text-ink hover:underline">
                    <LinkSimple size={14} className="text-ink-3" /> {String(a.referencia)}
                  </Link>
                  {((a.enmiendas || []) as ApiRecord[]).length ? (
                    <span className="text-xs text-ink-3">
                      Enmienda:{" "}
                      {((a.enmiendas || []) as ApiRecord[]).map((e, i) => (
                        <span key={String(e.id)}>
                          {i ? ", " : ""}
                          <Link href={`/informes/${e.id}`} className="font-medium text-brand hover:underline">
                            {String(e.referencia)}
                          </Link>
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-xs text-ink-3">Si hay que corregir resultados: «Emitir enmienda» en el informe.</span>
                  )}
                </span>
                <span className="flex items-center gap-1.5">
                  {ret ? (
                    <>
                      <Badge tone="danger">
                        <Lock size={12} /> Retenido
                      </Badge>
                      {puede.reanudar ? (
                        <Button size="sm" variant="secondary" onClick={() => liberar(ret)}>
                          Liberar retención…
                        </Button>
                      ) : null}
                    </>
                  ) : puede.retener ? (
                    <Button size="sm" variant="secondary" icon={<Lock size={14} />} onClick={() => retener(a.entidad_id, String(a.referencia))}>
                      Retener…
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-ink-3">Sin informes afectados.</p>
      )}
      {retenciones.some((r) => r.liberada_en) ? (
        <p className="text-xs text-ink-3">
          Retenciones liberadas: {retenciones.filter((r) => r.liberada_en).map((r) => `${r.informe} (${fmtDateTime(r.liberada_en)}, ${r.liberada_nombre || "—"})`).join("; ")}
        </p>
      ) : null}
      {/* Quien edita la NC marca el informe como afectado; quien solo puede retener (calidad:R) lo retiene directo (retener tambien lo marca). */}
      {editar || puede.retener ? <InformePicker excluir={afectados.map((a) => Number(a.entidad_id))} onElegir={(i) => (editar ? enviar("POST", `/calidad/nc/${item.id}/afectados`, { informe_id: i.id }) : retener(i.id, String(i.folio || formatearFolio("IR", i.folio_num))))} /> : null}
    </Panel>
  );
}

/* ---------- 3. Suspensiones ---------- */

function Suspensiones({ item, suspensiones }: { item: ApiRecord; suspensiones: ApiRecord[] }) {
  const { token, prompt, enviar, solicitarExcepcion } = useAccionCalidad();
  const { user } = useSession();
  const puede = item.puede as ApiRecord;
  const [tipo, setTipo] = useState<"metodo" | "equipo">("metodo");
  const [clave, setClave] = useState("");
  const equipos = useResource<ApiRecord>("equipos", () => getJsonAuth(`${API_BASE_URL}/inventory/equipos`, token), { enabled: !!token && !!puede.suspender && tipo === "equipo", deps: [tipo] });
  const vSusp = useValidacion({ titulo: "No se pudo suspender", reglas: () => (clave ? [] : [{ campo: "nc-susp-clave", mensaje: tipo === "metodo" ? msg.elige("el método a suspender") : msg.elige("el equipo a suspender"), grupo: "Suspensión" }]) });
  const suspender = async () => {
    if (!vSusp.validar()) return;
    const etiqueta = tipo === "metodo" ? `el método ${clave}` : `el equipo ${((equipos.data?.items || []) as ApiRecord[]).find((e) => String(e.id) === clave)?.nombre || ""}`;
    const motivo = await prompt({ title: `Suspender ${etiqueta}`, description: tipo === "metodo" ? "No se podrán crear ni editar extracciones ni análisis de este método hasta reanudarlo (los aprobados no se tocan)." : "El equipo queda fuera de servicio; no se podrá usar en los formatos hasta reanudarlo.", label: "Motivo de la suspensión" });
    if (!motivo) return;
    if (await enviar("POST", `/calidad/nc/${item.id}/suspensiones`, { tipo, clave, motivo }, undefined, (err) => vSusp.errorServidor(err))) setClave("");
  };
  const reanudar = async (su: ApiRecord) => {
    const motivo = await prompt({ critico: true, title: `Reanudar ${su.tipo === "metodo" ? `el método ${su.clave}` : su.equipo_nombre || "el equipo"}`, description: "Si otra NC abierta también lo suspende, sigue suspendido hasta que se reanuden todas.", label: "Motivo de la reanudación", confirmLabel: "Reanudar" });
    if (motivo) await enviar("POST", `/calidad/suspensiones/${su.id}/reanudar`, { motivo });
  };
  return (
    <Panel title="Suspensión del trabajo (7.10.1 f)" description="Métodos o equipos detenidos por esta NC. Reanuda quien aprueba en calidad, nunca quien suspendió.">
      {suspensiones.length ? (
        <ul className="flex flex-col gap-2">
          {suspensiones.map((su) => {
            const propia = Number(su.suspendida_por) === Number(user?.id);
            return (
              <li key={String(su.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-field bg-surface px-3 py-2 ring-1 ring-line" data-suspension={String(su.id)}>
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-ink">{su.tipo === "metodo" ? `Método ${su.clave}` : `Equipo ${su.equipo_nombre || `#${su.clave}`}`}</span>
                  <span className="text-xs text-ink-3">
                    Suspendido {fmtDateTime(su.suspendida_en)} por {String(su.suspendida_nombre || "—")} · {String(su.motivo)}
                    {su.reanudada_en ? ` · reanudado ${fmtDateTime(su.reanudada_en)} por ${su.reanudada_nombre || "—"}` : ""}
                  </span>
                </span>
                {su.reanudada_en ? (
                  <Badge tone="success">Reanudado</Badge>
                ) : puede.reanudar ? (
                  propia ? (
                    <BotonSegregado bloqueo="Quien suspendió no reanuda (regla 10)">
                      <Button size="sm" variant="secondary" onClick={() => solicitarExcepcion("suspensiones", su.id, "reanudar", "Quien suspendió no reanuda (regla 10)", String(item.folio))}>
                        Solicitar excepción…
                      </Button>
                    </BotonSegregado>
                  ) : (
                    <Button size="sm" variant="secondary" icon={<Play size={14} />} onClick={() => reanudar(su)}>
                      Reanudar…
                    </Button>
                  )
                ) : (
                  <Badge tone="danger">
                    <Pause size={12} /> Suspendido
                  </Badge>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-ink-3">Sin suspensiones.</p>
      )}
      {puede.suspender ? (
        <ValidacionAmbito v={vSusp}>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Suspender" htmlFor="nc-susp-tipo" className="w-[140px]">
            <Select id="nc-susp-tipo" value={tipo} onChange={(event) => (setTipo(event.target.value as "metodo" | "equipo"), setClave(""))}>
              <option value="metodo">Método</option>
              <option value="equipo">Equipo</option>
            </Select>
          </Field>
          <Field label={tipo === "metodo" ? "Método" : "Equipo"} htmlFor="nc-susp-clave" className="min-w-[200px] flex-1">
            <Select id="nc-susp-clave" value={clave} onChange={(event) => setClave(event.target.value)}>
              <option value="">Elegir…</option>
              {tipo === "metodo"
                ? METODOS_SUSPENDIBLES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))
                : ((equipos.data?.items || []) as ApiRecord[]).map((e) => (
                    <option key={String(e.id)} value={String(e.id)}>
                      {String(e.nombre)}
                      {e.clave_bitacora ? ` (${e.clave_bitacora})` : ""}
                    </option>
                  ))}
            </Select>
          </Field>
          <Button variant="secondary" icon={<Pause size={16} />} onClick={suspender}>
            Suspender…
          </Button>
        </div>
        </ValidacionAmbito>
      ) : null}
    </Panel>
  );
}

/* ---------- 3. Comunicaciones con el cliente ---------- */

function Comunicaciones({ item, comunicaciones, afectados, editar, requerida }: { item: ApiRecord; comunicaciones: ApiRecord[]; afectados: ApiRecord[]; editar: boolean; requerida: boolean }) {
  const { enviar } = useAccionCalidad();
  const [abierto, setAbierto] = useState(false);
  const [fecha, setFecha] = useState(hoyLocal());
  const [medio, setMedio] = useState("correo");
  const [contacto, setContacto] = useState("");
  const [resumen, setResumen] = useState("");
  const [informes, setInformes] = useState<number[]>([]);
  const vCom = useValidacion({
    titulo: "No se pudo registrar la comunicación",
    reglas: () => {
      const out: Problema[] = [];
      if (!fecha) out.push({ campo: "com-fecha", mensaje: msg.indica("la fecha de la comunicación"), grupo: "Comunicación" });
      if (contacto.trim().length < 3) out.push({ campo: "com-contacto", mensaje: msg.indica("el contacto (nombre y cargo de la persona del cliente)"), grupo: "Comunicación" });
      if (resumen.trim().length < 10) out.push({ campo: "com-resumen", mensaje: resumen.trim() ? msg.minimo("El resumen", 10) : msg.escribe("qué se comunicó y qué respondió"), grupo: "Comunicación" });
      return out;
    },
  });
  const registrar = async () => {
    if (!vCom.validar()) return;
    if (await enviar("POST", `/calidad/nc/${item.id}/comunicaciones`, { fecha, medio, contacto, resumen, informe_ids: informes }, undefined, (err) => vCom.errorServidor(err))) {
      setAbierto(false);
      setContacto("");
      setResumen("");
      setInformes([]);
    }
  };
  return (
    <Panel title="Comunicación con el cliente" description={requerida ? "Se decidió notificar al cliente: registra al menos una comunicación antes de cerrar." : "Registra cada comunicación (pueden ser varias)."}>
      {comunicaciones.length ? (
        <ul className="flex flex-col gap-2">
          {comunicaciones.map((c) => (
            <li key={String(c.id)} className="rounded-field bg-surface px-3 py-2 text-sm ring-1 ring-line">
              <p className="font-medium text-ink">
                {fmtDate(c.fecha)} · {MEDIO_COMUNICACION_LABEL[String(c.medio)] || String(c.medio)} · {String(c.contacto)}
              </p>
              <p className="whitespace-pre-line text-ink-2">{String(c.resumen)}</p>
              <p className="text-xs text-ink-3">Registró {String(c.registrado_nombre || "—")}</p>
            </li>
          ))}
        </ul>
      ) : requerida ? (
        <Callout tone="warning">Falta registrar la comunicación con el cliente.</Callout>
      ) : (
        <p className="text-sm text-ink-3">Sin comunicaciones registradas.</p>
      )}
      {editar ? (
        <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setAbierto(true)} className="self-start">
          Registrar comunicación
        </Button>
      ) : null}
      <Sheet
        open={abierto}
        onOpenChange={setAbierto}
        title="Comunicación con el cliente"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button onClick={registrar}>Registrar</Button>
          </>
        }
      >
        <ValidacionAmbito v={vCom}>
        <div className="flex flex-col gap-5">
          <FormGrid>
            <Field label="Fecha" htmlFor="com-fecha" required>
              <DateInput id="com-fecha" value={fecha} onChange={setFecha} max={hoyLocal()} />
            </Field>
            <Field label="Medio" htmlFor="com-medio" required>
              <Select id="com-medio" value={medio} onChange={(event) => setMedio(event.target.value)}>
                {MEDIOS_COMUNICACION.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
          </FormGrid>
          <Field label="Contacto" htmlFor="com-contacto" required>
            <Input id="com-contacto" value={contacto} onChange={(event) => setContacto(event.target.value)} placeholder="Nombre y cargo de la persona del cliente" />
          </Field>
          <Field label="Resumen" htmlFor="com-resumen" required hint="Qué se comunicó y qué respondió (al menos 10 caracteres).">
            <Textarea id="com-resumen" rows={3} value={resumen} onChange={(event) => setResumen(event.target.value)} />
          </Field>
          {afectados.length ? (
            <Field label="Informes a los que se refiere">
              <div className="flex flex-col gap-2">
                {afectados.map((a) => (
                  <Checkbox key={String(a.id)} label={String(a.referencia)} checked={informes.includes(Number(a.entidad_id))} onChange={(event) => setInformes((prev) => (event.target.checked ? [...prev, Number(a.entidad_id)] : prev.filter((x) => x !== Number(a.entidad_id))))} />
                ))}
              </div>
            </Field>
          ) : null}
        </div>
        </ValidacionAmbito>
      </Sheet>
    </Panel>
  );
}

/* ---------- 5. Acciones correctivas ---------- */

function AccionesTabla({ item, acciones, editar, editorNc }: { item: ApiRecord; acciones: ApiRecord[]; editar: boolean; editorNc: boolean }) {
  const { token, prompt, enviar } = useAccionCalidad();
  const personal = usePersonal();
  const puede = item.puede as ApiRecord;
  const implementables = new Set(((puede.implementar || []) as unknown[]).map(Number));
  const [nueva, setNueva] = useState({ descripcion: "", responsable_id: "", fecha_compromiso: "" });
  const [evidencia, setEvidencia] = useState<number | null>(null);
  const cerradaNc = ["cerrada", "anulada"].includes(String(item.estado));
  const vAcc = useValidacion({
    titulo: "No se pudo agregar la acción",
    reglas: () => {
      const out: Problema[] = [];
      if (nueva.descripcion.trim().length < 10) out.push({ campo: "acc-desc", mensaje: nueva.descripcion.trim() ? msg.minimo("La descripción", 10) : msg.escribe("la acción correctiva"), grupo: "Acción" });
      if (!nueva.responsable_id) out.push({ campo: "acc-resp", mensaje: msg.elige("al responsable de la acción"), grupo: "Acción" });
      if (!nueva.fecha_compromiso) out.push({ campo: "acc-fecha", mensaje: msg.indica("la fecha compromiso"), grupo: "Acción" });
      return out;
    },
  });
  const agregar = async () => {
    if (!vAcc.validar()) return;
    if (await enviar("POST", `/calidad/nc/${item.id}/acciones`, { ...nueva, responsable_id: Number(nueva.responsable_id) }, "Acción agregada", (err) => vAcc.errorServidor(err))) setNueva({ descripcion: "", responsable_id: "", fecha_compromiso: "" });
  };
  const implementar = async (a: ApiRecord) => {
    const descripcion = await prompt({ title: "Marcar como implementada", description: String(a.descripcion), label: "Cómo se implementó", minLength: 10, confirmLabel: "Implementada" });
    if (descripcion) await enviar("POST", `/calidad/acciones/${a.id}/implementar`, { descripcion_implementacion: descripcion });
  };
  const reasignar = async (a: ApiRecord, responsable: string) => {
    const motivo = await prompt({ title: "Reasignar la acción", description: String(a.descripcion), label: "Motivo de la reasignación" });
    if (motivo) await enviar("PUT", `/calidad/acciones/${a.id}`, { responsable_id: Number(responsable), motivo });
  };
  const cancelar = async (a: ApiRecord) => {
    const motivo = await prompt({ tone: "danger", title: "Cancelar la acción", description: String(a.descripcion), label: "Motivo de la cancelación", confirmLabel: "Cancelar acción" });
    if (motivo) await enviar("POST", `/calidad/acciones/${a.id}/cancelar`, { motivo });
  };
  return (
    <div className="flex flex-col gap-3" id="acciones">
      {item.requiere_accion_correctiva === "no" ? <Callout tone="info">La NC no requiere acción correctiva (ver la justificación en el análisis de causa).</Callout> : null}
      {acciones.length ? (
        <ul className="flex flex-col gap-2">
          {acciones.map((a) => {
            const abierta = ["pendiente", "en_proceso"].includes(String(a.estado));
            return (
              <li key={String(a.id)} className="on-panel flex flex-col gap-2 rounded-box bg-surface-2 p-3 ring-1 ring-line" data-accion-fila={String(a.id)}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="whitespace-pre-line text-base font-medium text-ink">{String(a.descripcion)}</p>
                    <p className="text-xs text-ink-3">
                      {String(a.responsable_nombre || "—")}
                      {!a.responsable_vigente && abierta ? " (sin cuenta vigente: reasígnala)" : ""} · compromiso{" "}
                      <span className={a.vencida ? "font-medium text-danger" : undefined}>{fmtDate(a.fecha_compromiso)}</span>
                    </p>
                    {a.descripcion_implementacion ? <p className="whitespace-pre-line text-xs text-ink-2">Implementación: {String(a.descripcion_implementacion)}</p> : null}
                    {a.motivo_cancelacion ? <p className="whitespace-pre-line text-xs text-danger">Cancelada: {String(a.motivo_cancelacion)}</p> : null}
                    {a.motivo_reasignacion ? <p className="whitespace-pre-line text-xs text-ink-3">Reasignada: {String(a.motivo_reasignacion)}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <EstadoAccion estado={a.estado} />
                    {a.vencida ? <Badge tone="danger">Vencida</Badge> : null}
                    {!a.responsable_vigente && abierta ? (
                      <Badge tone="warning">
                        <Warning size={12} /> Responsable no vigente
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button size="sm" variant="ghost" icon={<Paperclip size={14} />} onClick={() => setEvidencia(evidencia === Number(a.id) ? null : Number(a.id))} aria-expanded={evidencia === Number(a.id)}>
                    Evidencia
                  </Button>
                  {implementables.has(Number(a.id)) && !cerradaNc ? (
                    <>
                      {a.estado === "pendiente" ? (
                        <Button size="sm" variant="secondary" onClick={() => enviar("POST", `/calidad/acciones/${a.id}/iniciar`, {}, "Acción en proceso")}>
                          Iniciar
                        </Button>
                      ) : null}
                      <Button size="sm" variant="soft" icon={<CheckCircle size={14} />} onClick={() => implementar(a)} data-implementar={String(a.id)}>
                        Marcar implementada…
                      </Button>
                    </>
                  ) : null}
                  {editorNc && abierta && !cerradaNc ? (
                    <>
                      <select aria-label="Reasignar a" value="" onChange={(event) => event.target.value && reasignar(a, event.target.value)} className={cn(controlClassSm, "w-[180px]")}>
                        <option value="">Reasignar a…</option>
                        {personal
                          .filter((p) => p.id !== Number(a.responsable_id))
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nombre}
                            </option>
                          ))}
                      </select>
                      <Button size="sm" variant="ghost" icon={<Prohibit size={14} />} onClick={() => cancelar(a)}>
                        Cancelar…
                      </Button>
                    </>
                  ) : null}
                </div>
                {evidencia === Number(a.id) ? <AdjuntosPanel registroId={Number(a.id)} base={`/calidad/acciones/${a.id}`} token={token} clave="calidad" tipoInicial="otro" textos={{ vacioTitulo: "Sin evidencia", vacioEditable: "Adjunta la evidencia de la implementación (foto, registro, factura, capacitación).", vacioLectura: "Esta acción no tiene evidencia adjunta.", boton: "Adjuntar evidencia" }} /> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-ink-3">Sin acciones todavía.</p>
      )}
      {editar ? (
        <ValidacionAmbito v={vAcc}>
        <Panel title="Agregar acción">
          <Field label="Descripción" htmlFor="acc-desc" required>
            <Textarea id="acc-desc" rows={2} value={nueva.descripcion} onChange={(event) => setNueva((p) => ({ ...p, descripcion: event.target.value }))} />
          </Field>
          <FormGrid>
            <Field label="Responsable" htmlFor="acc-resp" required>
              <Select id="acc-resp" value={nueva.responsable_id} onChange={(event) => setNueva((p) => ({ ...p, responsable_id: event.target.value }))}>
                <option value="">Elegir…</option>
                {personal.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                    {p.rol ? ` · ${p.rol}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Fecha compromiso" htmlFor="acc-fecha" required>
              <DateInput id="acc-fecha" value={nueva.fecha_compromiso} onChange={(v) => setNueva((p) => ({ ...p, fecha_compromiso: v }))} />
            </Field>
          </FormGrid>
          <Button icon={<Plus size={16} />} onClick={agregar} className="self-start" data-agregar-accion>
            Agregar acción
          </Button>
        </Panel>
        </ValidacionAmbito>
      ) : null}
    </div>
  );
}

/* ---------- 6. Verificar ---------- */

function Verificar({ item, bloqueo, onExcepcion }: { item: ApiRecord; bloqueo: string | null; onExcepcion: () => void }) {
  const { enviar } = useAccionCalidad();
  const puede = item.puede as ApiRecord;
  const [resultado, setResultado] = useState<"eficaz" | "no_eficaz" | "">("");
  const [comentarios, setComentarios] = useState("");
  const vVer = useValidacion({
    titulo: "No se pudo registrar la verificación",
    reglas: () => {
      const out: Problema[] = [];
      if (!resultado) out.push({ campo: "verif-resultado", mensaje: msg.elige("si fue eficaz o no eficaz"), grupo: "Verificación" });
      if (comentarios.trim().length < 10) out.push({ campo: "verif-com", mensaje: comentarios.trim() ? msg.minimo("La descripción de cómo se verificó", 10) : msg.escribe("cómo se verificó"), grupo: "Verificación" });
      return out;
    },
  });
  const verificar = () => {
    if (!vVer.validar()) return;
    void enviar("POST", `/calidad/nc/${item.id}/verificar`, { resultado, comentarios }, undefined, (err) => vVer.errorServidor(err));
  };
  if (!puede.verificar) {
    return item.estado === "en_verificacion" ? <p className="text-sm text-ink-3">Pendiente: la verifica quien revisa en calidad.</p> : null;
  }
  if (bloqueo) return <SegregacionCallout bloqueo={bloqueo} accion="verificar" onSolicitar={onExcepcion} />;
  return (
    <ValidacionAmbito v={vVer}>
    <Panel title="Verificar eficacia">
      <CampoValidado id="verif-resultado">
      <ChoiceGrid cols={2}>
        <ChoiceCard type="radio" name="verif" checked={resultado === "eficaz"} onChange={() => setResultado("eficaz")} label="Eficaz" description="La causa se eliminó; la NC puede cerrarse." />
        <ChoiceCard type="radio" name="verif" checked={resultado === "no_eficaz"} onChange={() => setResultado("no_eficaz")} label="No eficaz" description="La NC regresa a análisis (reapertura); nada se borra." />
      </ChoiceGrid>
      </CampoValidado>
      <Field label="Cómo se verificó" htmlFor="verif-com" required hint="Al menos 10 caracteres.">
        <Textarea id="verif-com" rows={2} value={comentarios} onChange={(event) => setComentarios(event.target.value)} />
      </Field>
      <Button icon={<SealCheck size={16} />} onClick={verificar} className="self-start" data-verificar>
        Registrar verificación
      </Button>
    </Panel>
    </ValidacionAmbito>
  );
}

/* ---------- 7. Propuesta documental anterior (solo lectura) ---------- */

/*
 * Desde la NC ya no se crean
 * propuestas de cambio documental: "requiere cambio documental" es solo una
 * bandera. Si la NC ya apuntaba a una propuesta del flujo anterior, se muestra
 * en solo lectura (titulo y estado), sin enlace a la pantalla retirada.
 */
function PropuestaAnterior({ item }: { item: ApiRecord }) {
  const propuesta = item.propuesta as ApiRecord | null;
  if (!propuesta) return null;
  return (
    <p className="flex items-center gap-2 rounded-field bg-surface-2 px-3 py-2 text-sm text-ink-2 ring-1 ring-line" data-propuesta-anterior>
      <FileText size={16} className="shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1">
        Propuesta documental anterior #{String(propuesta.id)}: {String(propuesta.titulo)} <span className="text-ink-3">(flujo retirado; solo consulta)</span>
      </span>
      <Badge>{String(propuesta.estado)}</Badge>
    </p>
  );
}

/* ---------- 8. Cierre ---------- */

function Cierre({ item, bloqueo, onExcepcion, onPdf }: { item: ApiRecord; bloqueo: string | null; onExcepcion: () => void; onPdf: () => void }) {
  const { prompt, enviar } = useAccionCalidad();
  const puede = item.puede as ApiRecord;
  if (item.estado === "cerrada") {
    return (
      <div className="flex flex-col gap-3">
        <SignoffCard title="Cerró" name={item.cerrada_nombre} cargo={item.cerrada_rol} at={item.cerrada_en} note={item.conclusion} />
        {item.pdf_disponible ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" icon={<FilePdf size={16} />} onClick={onPdf}>
              PDF final
            </Button>
            <span className="font-mono text-2xs break-all text-ink-3">SHA-256 {String(item.pdf_sha256)}</span>
          </div>
        ) : null}
      </div>
    );
  }
  if (item.estado === "anulada") return <p className="text-sm text-ink-3">La NC está anulada.</p>;
  if (!puede.cerrar) return <p className="text-sm text-ink-3">La cierra quien aprueba en calidad (Responsable General o Mejora Continua) cuando se cumplan las condiciones.</p>;
  if (bloqueo) return <SegregacionCallout bloqueo={bloqueo} accion="cerrar" onSolicitar={onExcepcion} />;
  const cerrar = async () => {
    const conclusion = await prompt({ critico: true, title: `Cerrar ${item.folio}`, description: "Se genera el PDF «Registro de no conformidad» con su huella SHA-256. Después ya no se edita.", label: "Conclusión del cierre", minLength: 10, confirmLabel: "Cerrar NC" });
    if (conclusion) await enviar("POST", `/calidad/nc/${item.id}/cerrar`, { conclusion });
  };
  return (
    <div className="flex flex-col gap-3">
      <Callout tone="info" title="Condiciones para cerrar">
        Evaluación de impacto completa; con acción correctiva: todas implementadas o canceladas y la última verificación «eficaz»; sin acción correctiva: justificación. Sin suspensiones ni retenciones activas, y la comunicación al cliente registrada si se decidió notificarlo. El servidor explica lo que falte.
      </Callout>
      <Button icon={<Lock size={16} />} onClick={cerrar} className="self-start" data-cerrar-nc>
        Cerrar NC…
      </Button>
    </div>
  );
}
