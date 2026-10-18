"use client";

import { formatearFolio } from "@/lib/shared/folios";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowCounterClockwise, ArrowUUpLeft, CheckCircle, FloppyDisk, PaperPlaneTilt, PencilLine, Plus, Prohibit, SealCheck, X } from "@phosphor-icons/react";
import { AvisoSuspension } from "@/components/features/calidad/AvisoSuspension";
import { IncidenciasFormCard } from "@/components/features/calidad/IncidenciasDelRegistro";
import { RecordHistory } from "@/components/features/audit/RecordHistory";
import { useSession } from "@/components/session/SessionProvider";
import { Button, IconButton } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { Field, FormGrid, Input, Select, Textarea, controlClassSm } from "@/components/ui/Field";
import { DateInput } from "@/components/ui/DateInput";
import { EmptyState } from "@/components/ui/Primitives";
import { ActionMenu, Tooltip, useConfirm, usePrompt, type MenuItem } from "@/components/ui/Overlay";
import { API_BASE_URL, getJsonAuth, sendJsonAuth } from "@/lib/client/api";
import { fmtDate, isoDate, parseFloatOrNull, parseIntOrNull, todayIso } from "@/lib/client/format";
import { findInsumoOption, findUniqueOperativeEquipo, loadInsumoOptions, nextBitacoraFolio } from "@/lib/client/insumos";
import { formatActiveUserSignature } from "@/lib/client/session";
import { invalidate } from "@/lib/client/store";
import { seOfrece, usePuedeCrear } from "@/lib/client/puede";
import type { ApiRecord } from "@/lib/client/types";
import { ANALYSIS_METHODS, ANALYSIS_STATES, ANALYSIS_TYPES, CONFORMITY_OPTIONS } from "@/lib/shared/sgc";
import { Callout, ChoiceCard, ChoiceGrid, FieldGroup, FlowSteps, FormCard, FormPage, Panel, PersonCard, SignoffCard, personaId, type FormSectionDef } from "./FormLayout";
import { CampoValidado, MensajeCampo, useValidacion } from "@/components/ui/Validacion";
import { msg, type Problema } from "@/lib/client/mensajes";
import { InsumoSearch, InventarioRows, collectInventarioRows, newInventarioRow } from "./InsumoSearch";
import { SignDialog } from "./SignDialog";
import { BotonSegregado, FolioChip, SegregacionCallout, SolicitudCallout, SupervisionCallout } from "./status";
import { useAnulacion } from "./useAnulacion";
import { formatearHora } from "@/lib/shared/fechas";
import { AvisoAutorizacion } from "./AvisoAutorizacion";
import { metodoDeTipoAnalisis, requisitosAnalisis, requisitosRevisionResultados } from "@/lib/shared/autorizaciones";
import { firmanteDe, firmantesPayload, type FirmanteState } from "./FirmanteSelect";
import { EvidenciaPanel } from "./EvidenciaPanel";

/*
 * Registro de analisis: metodo, equipo, condiciones, resultados por muestra
 * con conformidad frente al limite aplicable, controles de calidad y
 * personal. Revision y aprobacion con firma (ISO/IEC 17025 7.5, 7.7, 7.8).
 */

interface ResultRow {
  key: number;
  id_muestra: string;
  resultado: string;
  resultado_texto: string;
  unidad: string;
  limite_deteccion: string;
  limite_cuantificacion: string;
  limite_regulatorio: string;
  incertidumbre: string;
  cumple: string;
  observacion: string;
}

let rowKey = 1;
const newResultRow = (partial: Partial<ResultRow> = {}): ResultRow => ({ key: rowKey++, id_muestra: "", resultado: "", resultado_texto: "", unidad: "", limite_deteccion: "", limite_cuantificacion: "", limite_regulatorio: "", incertidumbre: "", cumple: "", observacion: "", ...partial });

interface AnalysisFormState {
  folio: string;
  tipo: string;
  metodo: string;
  metodoOtro: string;
  metodoReferencia: string;
  extraccionId: string;
  recepcionId: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  equipo: string;
  equipoFolioBitacora: string;
  temperatura: string;
  humedad: string;
  condicionesObs: string;
  resultados: ResultRow[];
  blancoResultado: string;
  blancoAceptable: string;
  mrRef: string;
  mrNombre: string;
  mrLote: string;
  mrCaducidad: string;
  mrEsperado: string;
  mrObtenido: string;
  mrAceptable: string;
  dupMuestra: string;
  dupDiferencia: string;
  dupAceptable: string;
  inventarioRows: ReturnType<typeof newInventarioRow>[];
  observaciones: string;
  analista: string;
  analistaFirma: string;
}

const defaultForm = (): AnalysisFormState => ({
  folio: "",
  tipo: "",
  metodo: "",
  metodoOtro: "",
  metodoReferencia: "",
  extraccionId: "",
  recepcionId: "",
  fecha: todayIso(),
  horaInicio: formatearHora(new Date()),
  horaFin: "",
  equipo: "",
  equipoFolioBitacora: "",
  temperatura: "",
  humedad: "",
  condicionesObs: "",
  resultados: [],
  blancoResultado: "",
  blancoAceptable: "",
  mrRef: "",
  mrNombre: "",
  mrLote: "",
  mrCaducidad: "",
  mrEsperado: "",
  mrObtenido: "",
  mrAceptable: "",
  dupMuestra: "",
  dupDiferencia: "",
  dupAceptable: "",
  inventarioRows: [],
  observaciones: "",
  analista: formatActiveUserSignature(),
  analistaFirma: "",
});

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

const formFromItem = (item: ApiRecord): AnalysisFormState => {
  const c = (item.controles || {}) as ApiRecord;
  const blanco = (c.blanco || {}) as ApiRecord;
  const mr = (c.material_referencia || {}) as ApiRecord;
  const dup = (c.duplicado || {}) as ApiRecord;
  const cond = (item.condiciones || {}) as ApiRecord;
  return {
    ...defaultForm(),
    folio: item.folio_num ? String(item.folio_num) : "",
    tipo: str(item.tipo_analisis),
    metodo: str(item.metodo),
    metodoOtro: str(item.metodo_otro),
    metodoReferencia: str(item.metodo_referencia),
    extraccionId: item.extraccion_id ? String(item.extraccion_id) : "",
    recepcionId: item.recepcion_id ? String(item.recepcion_id) : "",
    fecha: isoDate(item.fecha_analisis),
    horaInicio: str(item.hora_inicio),
    horaFin: str(item.hora_fin),
    equipo: item.equipo_id ? String(item.equipo_id) : "",
    equipoFolioBitacora: str(item.equipo_folio_bitacora),
    temperatura: str(cond.temperatura_ambiente),
    humedad: str(cond.humedad),
    condicionesObs: str(cond.observaciones),
    resultados: ((item.resultados || []) as ApiRecord[]).map((r) => newResultRow({ id_muestra: str(r.id_muestra), resultado: str(r.resultado), resultado_texto: str(r.resultado_texto), unidad: str(r.unidad), limite_deteccion: str(r.limite_deteccion), limite_cuantificacion: str(r.limite_cuantificacion), limite_regulatorio: str(r.limite_regulatorio), incertidumbre: str(r.incertidumbre), cumple: str(r.cumple), observacion: str(r.observacion) })),
    blancoResultado: str(blanco.resultado),
    blancoAceptable: str(blanco.aceptable),
    mrRef: str(mr.ref),
    mrNombre: str(mr.nombre),
    mrLote: str(mr.lote),
    mrCaducidad: isoDate(mr.caducidad),
    mrEsperado: str(mr.valor_esperado),
    mrObtenido: str(mr.valor_obtenido),
    mrAceptable: str(mr.aceptable),
    dupMuestra: str(dup.id_muestra),
    dupDiferencia: str(dup.diferencia),
    dupAceptable: str(dup.aceptable),
    inventarioRows: ((item.uso_inventario || []) as ApiRecord[]).map((row) => newInventarioRow(row.tipo || "consumible", row.ref || row.nombre || "", row.cantidad ?? 1, row.nombre)),
    observaciones: str(item.observaciones),
    analista: str(item.analista_nombre),
    analistaFirma: str(item.analista_firma),
  };
};

const FLOW_STEPS = [
  { key: "registrado", label: "Registrado" },
  { key: "en_revision", label: "En revisión" },
  { key: "revisado", label: "Revisado" },
  { key: "aprobado", label: "Aprobado" },
];

const ACEPTABLE = [
  ["si", "Aceptable"],
  ["no", "No aceptable"],
  ["na", "No aplica"],
];

export function AnalysisForm({ item, prefillExtraccionId }: { item: ApiRecord | null; prefillExtraccionId?: number | null }) {
  const router = useRouter();
  const prompt = usePrompt();
  const confirm = useConfirm();
  const { token, can, user } = useSession();
  const puedeCrear = usePuedeCrear();
  const [form, setForm] = useState<AnalysisFormState>(() => (item ? formFromItem(item) : defaultForm()));
  // Fase 5: el analista se liga a una cuenta (con su contraseña si no es la sesión).
  const [analistaCuenta, setAnalistaCuenta] = useState<FirmanteState>(() => firmanteDe(item, "analista"));
  const [extracciones, setExtracciones] = useState<ApiRecord[]>([]);
  const [recepciones, setRecepciones] = useState<ApiRecord[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [sign, setSign] = useState<"revisar" | "aprobar" | null>(null);
  const [signing, setSigning] = useState(false);
  const { anular, restaurar } = useAnulacion("analysis", (row) => formatearFolio("A", row.folio_num));
  const editing = !!item?.id;
  const estado = String(item?.estado || "registrado");
  // E solo mientras el análisis está registrado (Fase 1): revisado y aprobado se leen, no se editan.
  const canEdit = editing ? seOfrece(item, "editar", can("ensayos", "E", { objeto: "analisis", borrador: estado === "registrado" })) && estado === "registrado" : puedeCrear("analisis", can("ensayos", "C", { objeto: "analisis", borrador: true }));
  // Con una solicitud de autorizacion pendiente (Fase 3) el registro no se edita.
  // Fase 5: enviado a revision ya no se edita; un aprobado se corrige con enmienda.
  const readOnly = editing && (["en_revision", "aprobado", "revisado", "sustituido", "anulado", "anulada"].includes(estado) || !canEdit || !!item?.solicitud_pendiente);
  const patch = (changes: Partial<AnalysisFormState>) => setForm((prev) => ({ ...prev, ...changes }));
  const meta = ANALYSIS_TYPES.find((t) => t.value === form.tipo);
  // Fase 10: evidencia instrumental (vigentes) y si es obligatoria para enviar a revisión.
  const resumenEvidencia = (item?.adjuntos || {}) as { vigentes?: number; obligatoria?: boolean };
  const [evidencias, setEvidencias] = useState<number>(Number(resumenEvidencia.vigentes || 0));
  const evidenciaObligatoria = resumenEvidencia.obligatoria !== false;
  const faltaEvidencia = evidenciaObligatoria && evidencias === 0;
  const requiereExtraccion = !!meta?.requiere_extraccion;

  /* Al vincular una extraccion se cargan sus muestras (sin el blanco) como filas de resultado. */
  /*
   * Con el tipo de análisis se prellena lo que ya se sabe: el método habitual,
   * la referencia del procedimiento, el instrumento operativo único y su folio
   * de bitácora sugerido. Solo llena huecos.
   */
  const suggestForTipo = (prev: AnalysisFormState, tipo: string): AnalysisFormState => {
    const defaults: Record<string, { metodo: string; referencia: string; equipo: string }> = {
      acido_domoico: { metodo: "hplc_uv_vis", referencia: "FX-TCI-ASP", equipo: "HPLC" },
      toxinas_lipofilicas: { metodo: "hplc_ms_ms", referencia: "FX-TCI-DSP", equipo: "MS/MS" },
      toxinas_paralizantes: { metodo: "hplc_fld", referencia: "FX-TCI-PSP", equipo: "HPLC" },
    };
    const d = defaults[tipo];
    if (!d) return prev;
    const next = { ...prev };
    if (!next.metodo) next.metodo = d.metodo;
    if (!next.metodoReferencia.trim()) next.metodoReferencia = d.referencia;
    if (!next.equipo) {
      const match = findUniqueOperativeEquipo(d.equipo);
      if (match) {
        next.equipo = match.ref;
        if (!next.equipoFolioBitacora.trim()) next.equipoFolioBitacora = nextBitacoraFolio(match);
      }
    }
    return next;
  };

  const loadExtraccion = useCallback(async (id: number) => {
    try {
      const data = await getJsonAuth(`${API_BASE_URL}/samples/extraction/${id}`, token);
      const ext = (data.item || {}) as ApiRecord;
      const pesos = (ext.registro_pesos || []) as ApiRecord[];
      const ids = pesos.filter((p) => p.id_muestra && !p.es_blanco && String(p.id_muestra).toLowerCase() !== "blanco").map((p) => String(p.id_muestra));
      const tipoSugerido = ext.tipo_registro === "E-D" ? "toxinas_lipofilicas" : ext.tipo_registro === "E-A" ? "acido_domoico" : "";
      setForm((prev) => {
        const tipo = prev.tipo || tipoSugerido;
        const m = ANALYSIS_TYPES.find((t) => t.value === tipo);
        const existing = new Set(prev.resultados.map((r) => r.id_muestra));
        const nuevas = ids.filter((id) => !existing.has(id)).map((id) => newResultRow({ id_muestra: id, unidad: m?.unidad_default || "", limite_regulatorio: m?.limite ? String(m.limite.valor) : "" }));
        return editing ? { ...prev, tipo, resultados: [...prev.resultados, ...nuevas] } : suggestForTipo({ ...prev, tipo, resultados: [...prev.resultados, ...nuevas] }, tipo);
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo leer la extracción");
    }
  }, [token, editing]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const empty: ApiRecord = {};
      const [ext, rec] = await Promise.all([getJsonAuth(`${API_BASE_URL}/samples/extraction?search=`, token).catch(() => empty), getJsonAuth(`${API_BASE_URL}/samples/reception?search=`, token).catch(() => empty)]);
      if (cancelled) return;
      setExtracciones(((ext.items || []) as ApiRecord[]).filter((e) => e.estado !== "anulada"));
      setRecepciones(((rec.items || []) as ApiRecord[]).filter((r) => ["aceptada", "aceptada_con_desviacion"].includes(String(r.decision_aceptacion || ""))));
      await loadInsumoOptions();
      if (item) return;
      if (prefillExtraccionId) {
        patch({ extraccionId: String(prefillExtraccionId) });
        await loadExtraccion(prefillExtraccionId);
      }
      try {
        const next = await getJsonAuth(`${API_BASE_URL}/samples/analysis/next-folio`, token);
        if (!cancelled) patch({ folio: next.next_folio ? String(next.next_folio) : "" });
      } catch {
        /* sin folio sugerido */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, item, prefillExtraccionId]);

  const setTipo = (tipo: string) => {
    const m = ANALYSIS_TYPES.find((t) => t.value === tipo);
    setForm((prev) => suggestForTipo({ ...prev, tipo, resultados: prev.resultados.map((r) => ({ ...r, unidad: r.unidad || m?.unidad_default || "", limite_regulatorio: r.limite_regulatorio || (m?.limite ? String(m.limite.valor) : "") })) }, tipo));
  };

  const updateRow = (key: number, changes: Partial<ResultRow>) => {
    patch({
      resultados: form.resultados.map((row) => {
        if (row.key !== key) return row;
        const next = { ...row, ...changes };
        // Conformidad sugerida: resultado contra el limite aplicable (editable).
        const resultado = parseFloatOrNull(next.resultado);
        const limite = parseFloatOrNull(next.limite_regulatorio);
        if (("resultado" in changes || "limite_regulatorio" in changes) && resultado !== null && limite !== null) next.cumple = resultado <= limite ? "cumple" : "no_cumple";
        return next;
      }),
    });
  };

  const buildPayload = () => ({
    folio_num: parseIntOrNull(form.folio),
    tipo_analisis: form.tipo,
    metodo: form.metodo,
    metodo_otro: form.metodo === "otro" ? form.metodoOtro.trim() || null : null,
    metodo_referencia: form.metodoReferencia.trim() || null,
    extraccion_id: parseIntOrNull(form.extraccionId),
    recepcion_id: parseIntOrNull(form.recepcionId),
    fecha_analisis: form.fecha || null,
    hora_inicio: form.horaInicio || null,
    hora_fin: form.horaFin || null,
    equipo_id: parseIntOrNull(form.equipo),
    equipo_folio_bitacora: form.equipoFolioBitacora.trim() || null,
    condiciones: { temperatura_ambiente: form.temperatura.trim() || null, humedad: form.humedad.trim() || null, observaciones: form.condicionesObs.trim() || null },
    resultados: form.resultados.map((r) => ({
      id_muestra: r.id_muestra.trim(),
      resultado: parseFloatOrNull(r.resultado),
      resultado_texto: r.resultado_texto.trim() || null,
      unidad: r.unidad.trim() || null,
      limite_deteccion: parseFloatOrNull(r.limite_deteccion),
      limite_cuantificacion: parseFloatOrNull(r.limite_cuantificacion),
      limite_regulatorio: parseFloatOrNull(r.limite_regulatorio),
      incertidumbre: parseFloatOrNull(r.incertidumbre),
      cumple: r.cumple || null,
      observacion: r.observacion.trim() || null,
    })),
    controles: {
      blanco: { resultado: form.blancoResultado.trim() || null, aceptable: form.blancoAceptable || null },
      material_referencia: { ref: form.mrRef || null, nombre: form.mrNombre.trim() || null, lote: form.mrLote.trim() || null, caducidad: form.mrCaducidad || null, valor_esperado: form.mrEsperado.trim() || null, valor_obtenido: form.mrObtenido.trim() || null, aceptable: form.mrAceptable || null },
      duplicado: { id_muestra: form.dupMuestra.trim() || null, diferencia: form.dupDiferencia.trim() || null, aceptable: form.dupAceptable || null },
    },
    uso_inventario: collectInventarioRows(form.inventarioRows),
    observaciones: form.observaciones.trim() || null,
    analista_nombre: form.analista.trim() || null,
    analista_firma: form.analistaFirma || null,
  });

  const analistaId = personaId("Analista");
  /*
   * Reglas del formato, en orden: completitud de la guía, aviso del encabezado y pop-up.
   * La evidencia se exige al enviar a revisión, no al guardar (y se adjunta después de registrar).
   */
  const reglas = (): Problema[] => {
    const out: Problema[] = [];
    const en = (seccion: string, grupo: string) => (campo: string, mensaje: string) => out.push({ campo, mensaje, seccion, grupo });
    const datos = en("sec-datos", "Datos del análisis");
    if (!form.folio) datos("a-folio", msg.indica("el folio del análisis"));
    if (!form.fecha) datos("a-fecha", msg.indica("la fecha del análisis"));
    if (!form.tipo) datos("a-tipo", msg.elige("el tipo de análisis"));
    if (!form.metodo) datos("a-metodo", msg.elige("el método"));
    else if (form.metodo === "otro" && !form.metodoOtro.trim()) datos("a-metodo-otro", msg.indica("el método"));
    const origen = en("sec-origen", "Muestra y origen");
    if (requiereExtraccion && !form.extraccionId) origen("a-ext", msg.elige("la extracción de origen (este análisis la requiere)"));
    else if (!requiereExtraccion && !form.recepcionId && !form.extraccionId) origen("a-rec", msg.elige("la recepción de la muestra"));
    if (!form.equipo) en("sec-equipo", "Equipo y condiciones")("a-equipo", msg.elige("el equipo empleado"));
    const res = en("sec-resultados", "Resultados");
    if (!form.resultados.length) res("a-resultados", "Agrega al menos una muestra con su resultado");
    form.resultados.forEach((r, i) => {
      if (!r.id_muestra.trim()) res(`a-res-id-${i}`, msg.indica(`el ID de la muestra ${i + 1}`));
      if (!r.resultado.trim() && !r.resultado_texto.trim()) res(`a-res-val-${i}`, msg.indica(`el resultado de la muestra ${i + 1} (número o texto)`));
    });
    if (!form.analista.trim()) en("sec-personal", "Analista")(analistaId, msg.elige("al analista"));
    return out;
  };
  const v = useValidacion({ titulo: editing ? "No se pudo guardar el análisis" : "No se pudo registrar el análisis", reglas: readOnly ? () => [] : reglas });
  const camposServidor = { folio: "a-folio", "firma:analista": analistaId };
  const ubicacionServidor = { folio: { seccion: "sec-datos", grupo: "Datos del análisis" }, "firma:analista": { seccion: "sec-personal", grupo: "Analista" } };

  const handleSave = async () => {
    const payload = { ...buildPayload(), firmantes: firmantesPayload({ analista: analistaCuenta }) };
    if (!v.validar()) return;
    if (!canEdit) return v.avisar({ que: "No tienes permiso para guardar este análisis.", hacer: "Pide a la administración que revise tus roles y permisos." });
    let motivo: string | null = null;
    if (editing && estado === "revisado") {
      motivo = await prompt({ title: "El análisis ya fue revisado", description: "Al editarlo vuelve a estado registrado y debe revisarse de nuevo. Indica el motivo del cambio.", confirmLabel: "Guardar y reiniciar revisión" });
      if (!motivo) return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await sendJsonAuth("PUT", `${API_BASE_URL}/samples/analysis/${item!.id}`, token, { ...payload, motivo_cambio: motivo });
        toast.success("Análisis actualizado");
      } else {
        await sendJsonAuth("POST", `${API_BASE_URL}/samples/analysis`, token, payload);
        toast.success("Análisis registrado");
      }
      invalidate("muestras", "movimientos", "reactivos", "consumibles", "dashboard");
      router.push("/muestras/analisis");
    } catch (err) {
      v.errorServidor(err, camposServidor, ubicacionServidor);
      setSubmitting(false);
    }
  };

  const doSign = async (data: { firma: string; observaciones: string }) => {
    if (!sign || !item) return;
    setSigning(true);
    try {
      const body: Record<string, unknown> = { firma: data.firma || null, observaciones: data.observaciones || null };
      // Segregacion de funciones (Fase 3): el servidor rechaza con 409 "segregacion"; la excepcion se pide aparte.
      await sendJsonAuth("POST", `${API_BASE_URL}/samples/analysis/${item.id}/${sign}`, token, body);
      toast.success(sign === "revisar" ? "Análisis revisado" : "Análisis aprobado");
      invalidate("muestras", "dashboard");
      setSign(null);
      router.refresh();
      router.push(`/muestras/analisis`);
    } catch (err) {
      v.errorServidor(err);
    } finally {
      setSigning(false);
    }
  };

  const ext = extracciones.find((e) => String(e.id) === form.extraccionId);
  // Banderas del servidor: rol + autorización FX-THF-AP; la segregación se explica abajo (botón deshabilitado + excepción).
  const canReview = seOfrece(item, "revisar", can("ensayos", "R"));
  const canApprove = seOfrece(item, "aprobar", can("ensayos", "A"));
  // Segregacion (Fase 3): por que la persona actual no puede revisar o aprobar este analisis (null = puede).
  const segregacion = (item?.segregacion || {}) as { revisar?: string | null; aprobar?: string | null };
  const excepciones = (item?.excepciones || []) as Array<{ solicitud_id: number; accion: string }>;
  const excepcionDe = (accion: string) => excepciones.find((e) => e.accion === accion);
  const solicitarExcepcion = async (accion: "revisar" | "aprobar") => {
    if (!item) return;
    const motivo = await prompt({
      critico: true,
      title: `Solicitar excepción para ${accion} ${folioLabel}`,
      description: `${segregacion[accion] || "La regla de dos personas te lo impide"}. Por falta de personal puedes pedir una excepción: la aprueba quien tiene A en calidad y queda registrada en el análisis y en la bitácora.`,
      confirmLabel: "Solicitar excepción",
    });
    if (!motivo) return;
    try {
      const data = await sendJsonAuth("POST", `${API_BASE_URL}/solicitudes`, token, { tipo: "excepcion_segregacion", entidad: "muestras_analisis", entidad_id: item.id, accion, motivo });
      toast.info(String(data.message || "Excepción solicitada"));
      invalidate("solicitudes");
    } catch (err) {
      v.errorServidor(err);
    }
  };
  const version = Number(item?.version || 1);
  const folioLabel = `A ${form.folio ? String(form.folio).padStart(7, "0") : "—"}${version > 1 ? ` v${version}` : ""}`;
  /* Fase 5: enviar a revision, devolver con observaciones y enmendar un aprobado. */
  const [flujo, setFlujo] = useState(false);
  const accionFlujo = async (ruta: "enviar-revision" | "devolver" | "enmendar", body: Record<string, unknown>) => {
    if (!item) return null;
    setFlujo(true);
    try {
      const data = await sendJsonAuth("POST", `${API_BASE_URL}/samples/analysis/${item.id}/${ruta}`, token, body);
      toast.success(String(data.message || "Listo"));
      invalidate("muestras", "dashboard");
      return data;
    } catch (err) {
      v.errorServidor(err);
      return null;
    } finally {
      setFlujo(false);
    }
  };
  const enviarRevision = async () => {
    const ok = await confirm({ title: `Enviar ${folioLabel} a revisión`, description: "Desde ahí ya no podrás editarlo; si el revisor encuentra algo, te lo devolverá con observaciones.", confirmLabel: "Enviar a revisión" });
    if (ok && (await accionFlujo("enviar-revision", {}))) router.push("/muestras/analisis");
  };
  const devolver = async () => {
    const motivo = await prompt({ title: `Devolver ${folioLabel} con observaciones`, description: "El análisis vuelve a registrado para que el analista lo corrija antes de aprobarse.", label: "Observaciones para el analista", confirmLabel: "Devolver" });
    if (motivo && (await accionFlujo("devolver", { motivo }))) router.push("/muestras/analisis");
  };
  const enmendar = async () => {
    const motivo = await prompt({ title: `Enmendar ${folioLabel}`, description: "Se crea una nueva versión (mismo folio) que sigue el flujo normal; al aprobarse, esta queda sustituida.", label: "Motivo de la enmienda", confirmLabel: "Crear enmienda" });
    if (!motivo) return;
    const data = await accionFlujo("enmendar", { motivo });
    if (data?.id) router.push(`/muestras/analisis/${data.id}`);
  };

  const sections: FormSectionDef[] = [
    { id: "sec-datos", label: "Datos del análisis", complete: readOnly ? undefined : v.seccionCompleta("sec-datos") },
    { id: "sec-origen", label: "Muestra y origen", complete: readOnly ? undefined : v.seccionCompleta("sec-origen") },
    // El equipo es trazabilidad obligatoria (ISO/IEC 17025 6.4); los controles e insumos son opcionales.
    { id: "sec-equipo", label: "Equipo y condiciones", complete: readOnly ? undefined : v.seccionCompleta("sec-equipo") },
    { id: "sec-resultados", label: "Resultados", complete: readOnly ? undefined : v.seccionCompleta("sec-resultados") },
    { id: "sec-controles", label: "Controles de calidad", optional: true, complete: readOnly || !(form.blancoAceptable || form.mrAceptable || form.dupAceptable) ? undefined : true },
    { id: "sec-insumos", label: "Insumos", optional: true, complete: readOnly || !form.inventarioRows.some((row) => (row.ref || row.nombre || "").trim()) ? undefined : true },
    { id: "sec-evidencia", label: "Evidencia instrumental", optional: !evidenciaObligatoria, complete: editing && estado === "registrado" ? evidencias > 0 : editing && evidencias > 0 ? true : undefined },
    { id: "sec-personal", label: "Analista", complete: readOnly ? undefined : v.seccionCompleta("sec-personal") },
    { id: "sec-revision", label: "Revisión y aprobación", optional: true, optionalLabel: "Se completa después", optionalNote: "La firman quien revisa y quien aprueba" },
    ...(editing ? [{ id: "sec-historial", label: "Historial", optional: true }] : []),
  ];

  const anulado = ["anulado", "anulada"].includes(estado);
  const moreItems: MenuItem[] = [];
  if (editing && !anulado && seOfrece(item, "anular", can("ensayos", "AN"))) moreItems.push({ label: "Anular análisis…", description: "Queda en la bitácora con motivo", icon: <Prohibit size={16} weight="duotone" />, tone: "danger", onSelect: async () => (await anular(item!)) && router.push("/muestras/analisis") });
  if (editing && anulado && seOfrece(item, "anular", can("ensayos", "AN"))) moreItems.push({ label: "Restaurar análisis", description: "Vuelve a la lista con motivo", icon: <ArrowCounterClockwise size={16} weight="duotone" />, tone: "warning", onSelect: async () => (await restaurar(item!)) && router.push("/muestras/analisis") });

  return (
    <FormPage
      backHref="/muestras/analisis"
      backLabel="Análisis"
      code="Registro de análisis"
      title={editing ? `Análisis ${folioLabel}` : "Nuevo análisis"}
      status={ANALYSIS_STATES[estado]?.label || estado}
      statusTone={ANALYSIS_STATES[estado]?.tone || "brand"}
      sections={sections}
      validacion={v}
      readOnly={readOnly}
      interactive={
        <FormCard id="sec-evidencia" title="Evidencia instrumental" description="Cromatogramas, reportes del equipo, hojas de cálculo, curvas o certificados que respaldan los resultados. Se adjuntan antes de enviar a revisión; después quedan en solo lectura.">
          {editing && item?.id && token ? (
            <EvidenciaPanel analisisId={Number(item.id)} token={token} onResumen={(vigentes) => setEvidencias(vigentes)} />
          ) : (
            <Callout tone="info">Registra el análisis y después adjunta aquí su evidencia instrumental{evidenciaObligatoria ? " (obligatoria para enviarlo a revisión)" : ""}.</Callout>
          )}
        </FormCard>
      }
      tail={
        <>
        <FormCard id="sec-personal" title="Analista" description="Quién realizó el análisis.">
          <PersonCard title="Analista" nuevo={!editing} firmante={analistaCuenta} onFirmante={setAnalistaCuenta} name={form.analista} onName={(v) => patch({ analista: v })} signature={form.analistaFirma} onSignature={(v) => patch({ analistaFirma: v })} />
        </FormCard>

        <FormCard id="sec-revision" title="Revisión y aprobación" description="Una segunda persona revisa; otra distinta aprueba. Solo los análisis aprobados pueden reportarse.">
          <div className="grid gap-3 sm:grid-cols-2">
            <SignoffCard title="Revisó" name={item?.revisado_nombre} cargo={item?.revisado_cargo} at={item?.revisado_en} note={[item?.revision_observaciones, excepcionDe("revisar") ? `Revisión autorizada por excepción, solicitud #${excepcionDe("revisar")!.solicitud_id}` : null].filter(Boolean).join(" · ") || null} hint={editing ? "Se firma con “Marcar revisado”." : "Después de registrar el análisis."} />
            <SignoffCard title="Aprobó" name={item?.aprobado_nombre} cargo={item?.aprobado_cargo} at={item?.aprobado_en} note={excepcionDe("aprobar") ? `Aprobación autorizada por excepción, solicitud #${excepcionDe("aprobar")!.solicitud_id}` : null} hint={editing ? "Se firma con “Aprobar” tras la revisión." : "Después de la revisión."} />
          </div>
          {editing && estado === "registrado" && !canReview ? <Callout tone="info" className="mt-4">Una persona con permiso de revisar ensayos debe revisar este análisis.</Callout> : null}
        </FormCard>

        <SignDialog
          key={sign || "sin-firma"}
          open={sign !== null}
          onOpenChange={(open) => !open && setSign(null)}
          title={sign === "revisar" ? "Marcar análisis como revisado" : "Aprobar análisis"}
          description={sign === "revisar" ? `Quedará registrado a nombre de ${user?.nombre || user?.email || "tu usuario"}.` : "A partir de la aprobación el resultado puede incluirse en un informe."}
          confirmLabel={sign === "revisar" ? "Marcar revisado" : "Aprobar"}
          withObservaciones={sign === "revisar"}
          loading={signing}
          critico={sign === "aprobar"}
          onConfirm={doSign}
        />
        </>
      }
      after={
        editing ? (
          <>
            <IncidenciasFormCard entidad="muestras_analisis" id={item?.id} etiqueta={folioLabel} />
            <FormCard id="sec-historial" title="Historial del registro" description="Bitácora de auditoría de este análisis.">
              <RecordHistory entidad="muestras_analisis" entidadId={item?.id as number | undefined} />
            </FormCard>
          </>
        ) : null
      }
      actions={
        <>
          <Button variant="secondary" onClick={() => router.push("/muestras/analisis")}>
            {readOnly ? "Volver" : "Cancelar"}
          </Button>
          {moreItems.length ? <ActionMenu items={moreItems} label="Más acciones" header={folioLabel} /> : null}
          {editing && estado === "registrado" && canEdit && !item?.solicitud_pendiente ? (
            faltaEvidencia ? (
              <Tooltip content="Adjunta al menos una evidencia instrumental (sección “Evidencia instrumental”) antes de enviar a revisión.">
                <span tabIndex={0} className="inline-flex">
                  <Button variant="soft" icon={<PaperPlaneTilt size={16} />} disabled>
                    Enviar a revisión
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <Button variant="soft" icon={<PaperPlaneTilt size={16} />} onClick={enviarRevision} loading={flujo}>
                Enviar a revisión
              </Button>
            )
          ) : null}
          {editing && estado === "en_revision" && canReview ? (
            <Button variant="secondary" icon={<ArrowUUpLeft size={16} />} onClick={devolver} loading={flujo}>
              Devolver con observaciones
            </Button>
          ) : null}
          {editing && estado === "aprobado" && seOfrece(item, "enmendar", can("ensayos", "C", { objeto: "analisis", borrador: true })) ? (
            <Button variant="secondary" icon={<PencilLine size={16} />} onClick={enmendar} loading={flujo}>
              Enmendar…
            </Button>
          ) : null}
          {editing && (estado === "registrado" || estado === "en_revision") && canReview ? (
            <BotonSegregado bloqueo={segregacion.revisar} onSolicitar={() => solicitarExcepcion("revisar")}>
              <Button variant="soft" icon={<CheckCircle size={16} />} onClick={() => setSign("revisar")} disabled={!!segregacion.revisar}>
                Marcar revisado
              </Button>
            </BotonSegregado>
          ) : null}
          {editing && estado === "revisado" && canApprove ? (
            <BotonSegregado bloqueo={segregacion.aprobar} onSolicitar={() => solicitarExcepcion("aprobar")}>
              <Button variant="soft" icon={<SealCheck size={16} />} onClick={() => setSign("aprobar")} disabled={!!segregacion.aprobar}>
                Aprobar
              </Button>
            </BotonSegregado>
          ) : null}
          {!readOnly ? (
            <Button onClick={handleSave} loading={submitting} icon={<FloppyDisk size={16} />}>
              {editing ? "Guardar cambios" : "Registrar análisis"}
            </Button>
          ) : null}
        </>
      }
    >
      {editing ? (
        <div className="px-1">
          <FlowSteps steps={FLOW_STEPS} current={estado} failed={anulado ? "Anulado" : undefined} />
        </div>
      ) : null}
      <SupervisionCallout item={item} />
      <SolicitudCallout item={item} />
      <AvisoSuspension metodo={metodoDeTipoAnalisis(form.tipo)} equipoIds={[form.equipo]} />
      {item?.sustituye_a ? (
        <Callout tone="info" title={`Enmienda: versión ${version}`}>
          Sustituye a la versión {version - 1}
          {item.motivo_enmienda ? ` · ${String(item.motivo_enmienda)}` : ""}
        </Callout>
      ) : null}
      {estado === "sustituido" ? (
        <Callout tone="warning" title="Sustituido por una enmienda">
          Esta versión ya no se reporta; consulta la versión más reciente del mismo folio.
        </Callout>
      ) : null}
      {estado === "registrado" && item?.devolucion_observaciones ? (
        <Callout tone="warning" title="Devuelto con observaciones del revisor">
          {String(item.devolucion_observaciones)}
        </Callout>
      ) : null}
      {estado === "en_revision" ? <Callout tone="info">Enviado a revisión: ya no se edita. El revisor lo revisa o lo devuelve con observaciones.</Callout> : null}
      {!readOnly ? <AvisoAutorizacion requisitos={requisitosAnalisis(form.tipo)} /> : null}
      {editing && (estado === "registrado" || estado === "en_revision") && canReview ? <AvisoAutorizacion requisitos={requisitosRevisionResultados(form.tipo, "revisar")} accion="revisar este análisis" /> : null}
      {editing && estado === "revisado" && canApprove ? <AvisoAutorizacion requisitos={requisitosRevisionResultados(form.tipo, "aprobar")} accion="aprobar este análisis" /> : null}
      <SegregacionCallout bloqueo={editing && (estado === "registrado" || estado === "en_revision") && canReview ? segregacion.revisar : editing && estado === "revisado" && canApprove ? segregacion.aprobar : null} accion={estado === "revisado" ? "aprobar" : "revisar"} onSolicitar={() => solicitarExcepcion(estado === "revisado" ? "aprobar" : "revisar")} />
      {item?.motivo_anulacion ? (
        <Callout tone="danger" title="Registro anulado">
          Motivo: {String(item.motivo_anulacion)}
          {item.anulado_cargo ? ` · Anuló como ${String(item.anulado_cargo)}` : ""}
        </Callout>
      ) : null}
      {!editing ? <Callout tone="info">La clave del formato oficial de registro de análisis (FX-TCI-[ID]) la define la coordinación; mientras tanto, anota la clave y revisión del protocolo aplicado en “Referencia del método”.</Callout> : null}

      <FormCard id="sec-datos" title="Datos del análisis" description="Qué se buscó, con qué método y cuándo.">
        <FormGrid cols={4}>
          <Field label="Folio A" htmlFor="a-folio" required>
            <Input id="a-folio" type="number" min="1" inputMode="numeric" value={form.folio} onChange={(event) => patch({ folio: event.target.value })} mono />
          </Field>
          <Field label="Fecha" htmlFor="a-fecha" required>
            <DateInput id="a-fecha" value={form.fecha} onChange={(value) => patch({ fecha: value })} />
          </Field>
          <Field label="Hora de inicio" htmlFor="a-hi">
            <Input id="a-hi" type="time" value={form.horaInicio} onChange={(event) => patch({ horaInicio: event.target.value })} />
          </Field>
          <Field label="Hora de término" htmlFor="a-hf">
            <Input id="a-hf" type="time" value={form.horaFin} onChange={(event) => patch({ horaFin: event.target.value })} />
          </Field>
        </FormGrid>
        <FieldGroup label="Tipo de análisis" className="mt-5">
          <CampoValidado id="a-tipo">
            <ChoiceGrid>
              {ANALYSIS_TYPES.map((t) => (
                <ChoiceCard key={t.value} type="radio" name="a-tipo" checked={form.tipo === t.value} onChange={() => setTipo(t.value)} label={t.label} description={t.limite ? `Límite: ${t.limite.valor} ${t.limite.unidad}` : t.requiere_extraccion ? "Requiere extracción" : "Sin extracción"} />
              ))}
            </ChoiceGrid>
          </CampoValidado>
        </FieldGroup>
        <FormGrid cols={3} className="mt-5">
          <Field label="Método" htmlFor="a-metodo" required>
            <Select id="a-metodo" value={form.metodo} onChange={(event) => patch({ metodo: event.target.value })}>
              <option value="">Seleccionar</option>
              {ANALYSIS_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          {form.metodo === "otro" ? (
            <Field label="Especifica el método" htmlFor="a-metodo-otro" required>
              <Input id="a-metodo-otro" maxLength={160} value={form.metodoOtro} onChange={(event) => patch({ metodoOtro: event.target.value })} />
            </Field>
          ) : null}
          <Field label="Referencia del método" htmlFor="a-ref" hint="Clave y revisión del protocolo vigente (ej. FX-TCI-DSP rev. 2).">
            <Input id="a-ref" maxLength={160} value={form.metodoReferencia} onChange={(event) => patch({ metodoReferencia: event.target.value })} mono />
          </Field>
        </FormGrid>
      </FormCard>

      <FormCard id="sec-origen" title="Muestra y origen" description={requiereExtraccion ? "El análisis parte de un extracto; la cadena recepción → procesamiento se deriva de él." : "Si el análisis no requiere extracción (plancton), vincula directamente la recepción."}>
        <FormGrid>
          <Field label="Extracción" htmlFor="a-ext" required={requiereExtraccion} hint={ext ? [formatearFolio(ext.tipo_registro, ext.folio_num), ext.id_interno || "sin ID", ext.folio_procesamiento_num ? formatearFolio("P", ext.folio_procesamiento_num) : null].filter(Boolean).join(" · ") : "Al vincular se cargan las muestras del extracto."}>
            <Select
              id="a-ext"
              value={form.extraccionId}
              disabled={readOnly}
              onChange={(event) => {
                patch({ extraccionId: event.target.value });
                const id = parseIntOrNull(event.target.value);
                if (id) void loadExtraccion(id);
              }}
            >
              <option value="">Sin vincular</option>
              {extracciones.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.tipo_registro} {String(e.folio_num).padStart(7, "0")} · {e.id_interno || "sin ID"} · {fmtDate(e.fecha_extraccion)}
                </option>
              ))}
            </Select>
          </Field>
          {!requiereExtraccion ? (
            <Field label="Recepción" htmlFor="a-rec" hint="Solo recepciones aceptadas.">
              <Select id="a-rec" value={form.recepcionId} disabled={readOnly} onChange={(event) => patch({ recepcionId: event.target.value })}>
                <option value="">Sin vincular</option>
                {recepciones.map((r) => (
                  <option key={r.id} value={r.id}>
                    {formatearFolio("R", r.folio_num)} · {r.solicitante || r.id_interno || ""}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </FormGrid>
        {editing && item?.recepcion_id ? (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
            Cadena: {(item as ApiRecord).folio_recepcion_num ? <FolioChip type="R" num={(item as ApiRecord).folio_recepcion_num} /> : null}
            {item.procesamiento_id ? <Link href={`/muestras/procesamiento/${item.procesamiento_id}`} className="text-brand">procesamiento</Link> : null}
            {item.extraccion_id ? <Link href={`/muestras/extraccion/${item.extraccion_id}`} className="text-brand">extracción</Link> : null}
            <Link href={`/muestras/recepcion/${item.recepcion_id}`} className="text-brand">recepción</Link>
          </p>
        ) : null}
      </FormCard>

      <FormCard id="sec-equipo" title="Equipo y condiciones" description="Equipo empleado (con su bitácora) y condiciones ambientales cuando aplican.">
        <FormGrid cols={4}>
          <Field label="Equipo" className="sm:col-span-2">
            <CampoValidado id="a-equipo">
            <InsumoSearch
              tipo="equipo"
              value={form.equipo}
              onChange={(ref) =>
                setForm((prev) => {
                  // Al elegir el instrumento se sugiere el siguiente folio de su bitácora si el campo está vacío.
                  const option = findInsumoOption("equipo", ref);
                  const folio = prev.equipoFolioBitacora.trim() ? prev.equipoFolioBitacora : nextBitacoraFolio(option);
                  return { ...prev, equipo: ref, equipoFolioBitacora: folio };
                })
              }
              placeholder="Cromatógrafo, microscopio, fluorómetro…"
            />
            </CampoValidado>
          </Field>
          <Field label="Folio de bitácora del equipo" htmlFor="a-bit">
            <Input id="a-bit" maxLength={60} value={form.equipoFolioBitacora} onChange={(event) => patch({ equipoFolioBitacora: event.target.value })} mono />
          </Field>
          <Field label="Temperatura ambiente" htmlFor="a-temp">
            <Input id="a-temp" maxLength={20} placeholder="°C" value={form.temperatura} onChange={(event) => patch({ temperatura: event.target.value })} />
          </Field>
          <Field label="Humedad" htmlFor="a-hum">
            <Input id="a-hum" maxLength={20} placeholder="% HR" value={form.humedad} onChange={(event) => patch({ humedad: event.target.value })} />
          </Field>
          <Field label="Observaciones de condiciones" htmlFor="a-cond" className="sm:col-span-3">
            <Textarea id="a-cond" rows={2} maxLength={240} value={form.condicionesObs} onChange={(event) => patch({ condicionesObs: event.target.value })} />
          </Field>
        </FormGrid>
      </FormCard>

      <FormCard
        id="sec-resultados"
        title="Resultados por muestra"
        description={meta?.limite ? `Límite aplicable sugerido: ${meta.limite.nota}.` : "Resultado con unidad; la conformidad se calcula contra el límite aplicable y puede ajustarse."}
        aside={
          !readOnly ? (
            <Button variant="secondary" size="sm" icon={<Plus size={14} weight="bold" />} onClick={() => patch({ resultados: [...form.resultados, newResultRow({ unidad: meta?.unidad_default || "", limite_regulatorio: meta?.limite ? String(meta.limite.valor) : "" })] })}>
              Agregar muestra
            </Button>
          ) : undefined
        }
      >
        {!form.resultados.length ? (
          <CampoValidado id="a-resultados">
            <EmptyState compact title="Sin muestras" description="Vincula una extracción o agrega las muestras a mano." />
          </CampoValidado>
        ) : (
          <div className="flex flex-col gap-3">
            {form.resultados.map((row, index) => {
              const cell = "flex flex-col gap-1 text-[11.5px] font-medium text-ink-3";
              return (
                <div key={row.key} className="on-panel rounded-[12px] bg-surface-2 p-3.5 ring-1 ring-line">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.1fr)_auto]">
                    <label className={cell}>
                      Muestra {index + 1}
                      <input id={`a-res-id-${index}`} className={`${controlClassSm} font-mono`} placeholder="ID interno" value={row.id_muestra} onChange={(event) => updateRow(row.key, { id_muestra: event.target.value })} aria-label={`ID de la muestra ${index + 1}`} readOnly={readOnly} />
                      <MensajeCampo id={`a-res-id-${index}`} />
                    </label>
                    <label className={cell}>
                      Resultado
                      <input id={`a-res-val-${index}`} type="number" step="0.0001" className={`${controlClassSm} tnum`} value={row.resultado} onChange={(event) => updateRow(row.key, { resultado: event.target.value })} aria-label={`Resultado de ${row.id_muestra}`} readOnly={readOnly} />
                      <MensajeCampo id={`a-res-val-${index}`} />
                    </label>
                    <label className={cell}>
                      Unidad
                      <input className={`${controlClassSm}`} value={row.unidad} onChange={(event) => updateRow(row.key, { unidad: event.target.value })} aria-label={`Unidad de ${row.id_muestra}`} readOnly={readOnly} />
                    </label>
                    <label className={cell}>
                      Límite
                      <input type="number" step="0.0001" className={`${controlClassSm} tnum`} value={row.limite_regulatorio} onChange={(event) => updateRow(row.key, { limite_regulatorio: event.target.value })} aria-label={`Límite aplicable de ${row.id_muestra}`} readOnly={readOnly} />
                    </label>
                    <label className={cell}>
                      Conformidad
                      <select className={cn(controlClassSm, row.cumple === "cumple" && "text-success-text", row.cumple === "no_cumple" && "text-danger")} value={row.cumple} onChange={(event) => updateRow(row.key, { cumple: event.target.value })} aria-label={`Conformidad de ${row.id_muestra}`} disabled={readOnly}>
                        <option value="">—</option>
                        {CONFORMITY_OPTIONS.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex items-end justify-end">
                      {!readOnly ? (
                        <IconButton label={`Quitar ${row.id_muestra || `muestra ${index + 1}`}`} size="sm" tone="danger" onClick={() => patch({ resultados: form.resultados.filter((r) => r.key !== row.key) })}>
                          <X size={14} weight="bold" />
                        </IconButton>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 border-t border-line/70 pt-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,1.6fr)]">
                    <label className={cell}>
                      Texto (si no es numérico)
                      <input className={`${controlClassSm}`} placeholder="< LD, positivo…" value={row.resultado_texto} onChange={(event) => updateRow(row.key, { resultado_texto: event.target.value })} aria-label={`Resultado en texto de ${row.id_muestra}`} readOnly={readOnly} />
                    </label>
                    <label className={cell}>
                      LD
                      <input type="number" step="0.0001" className={`${controlClassSm} tnum`} value={row.limite_deteccion} onChange={(event) => updateRow(row.key, { limite_deteccion: event.target.value })} aria-label={`Límite de detección de ${row.id_muestra}`} readOnly={readOnly} />
                    </label>
                    <label className={cell}>
                      LC
                      <input type="number" step="0.0001" className={`${controlClassSm} tnum`} value={row.limite_cuantificacion} onChange={(event) => updateRow(row.key, { limite_cuantificacion: event.target.value })} aria-label={`Límite de cuantificación de ${row.id_muestra}`} readOnly={readOnly} />
                    </label>
                    <label className={cell}>
                      Incertidumbre
                      <input type="number" step="0.0001" className={`${controlClassSm} tnum`} value={row.incertidumbre} onChange={(event) => updateRow(row.key, { incertidumbre: event.target.value })} aria-label={`Incertidumbre de ${row.id_muestra}`} readOnly={readOnly} />
                    </label>
                    <label className={cell}>
                      Observación
                      <Textarea small rows={1} value={row.observacion} onChange={(event) => updateRow(row.key, { observacion: event.target.value })} aria-label={`Observación de ${row.id_muestra}`} readOnly={readOnly} />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </FormCard>

      <FormCard id="sec-controles" title="Controles de calidad" description="Blanco, material de referencia y duplicado (ISO/IEC 17025 7.7).">
        <div className="flex flex-col gap-3">
          <Panel title="Blanco" description="Sin analito; verifica contaminación.">
            <FormGrid cols={3}>
              <Field label="Resultado" htmlFor="a-bl-res"><Input id="a-bl-res" maxLength={60} value={form.blancoResultado} onChange={(event) => patch({ blancoResultado: event.target.value })} readOnly={readOnly} /></Field>
              <Field label="Criterio" htmlFor="a-bl-ok"><Select id="a-bl-ok" value={form.blancoAceptable} onChange={(event) => patch({ blancoAceptable: event.target.value })} disabled={readOnly}><option value="">—</option>{ACEPTABLE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
            </FormGrid>
          </Panel>
          <Panel title="Material de referencia" description="CRM con valor certificado.">
            <FormGrid cols={3}>
              <Field label="Del inventario" className="sm:col-span-3 lg:col-span-1"><InsumoSearch tipo="reactivo" value={form.mrRef} onChange={(ref, label) => patch({ mrRef: ref, mrNombre: label || form.mrNombre })} placeholder="Buscar CRM" size="sm" /></Field>
              <Field label="Lote" htmlFor="a-mr-lote"><Input id="a-mr-lote" maxLength={80} value={form.mrLote} onChange={(event) => patch({ mrLote: event.target.value })} readOnly={readOnly} /></Field>
              <Field label="Caducidad" htmlFor="a-mr-cad"><DateInput id="a-mr-cad" value={form.mrCaducidad} onChange={(value) => patch({ mrCaducidad: value })} readOnly={readOnly} /></Field>
              <Field label="Valor esperado" htmlFor="a-mr-esp"><Input id="a-mr-esp" maxLength={60} value={form.mrEsperado} onChange={(event) => patch({ mrEsperado: event.target.value })} readOnly={readOnly} /></Field>
              <Field label="Valor obtenido" htmlFor="a-mr-obt"><Input id="a-mr-obt" maxLength={60} value={form.mrObtenido} onChange={(event) => patch({ mrObtenido: event.target.value })} readOnly={readOnly} /></Field>
              <Field label="Criterio" htmlFor="a-mr-ok"><Select id="a-mr-ok" value={form.mrAceptable} onChange={(event) => patch({ mrAceptable: event.target.value })} disabled={readOnly}><option value="">—</option>{ACEPTABLE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
            </FormGrid>
          </Panel>
          <Panel title="Duplicado" description="Repetición de una muestra.">
            <FormGrid cols={3}>
              <Field label="ID muestra" htmlFor="a-dup-id"><Input id="a-dup-id" maxLength={100} value={form.dupMuestra} onChange={(event) => patch({ dupMuestra: event.target.value })} mono readOnly={readOnly} /></Field>
              <Field label="Diferencia" htmlFor="a-dup-dif"><Input id="a-dup-dif" maxLength={60} placeholder="% o valor" value={form.dupDiferencia} onChange={(event) => patch({ dupDiferencia: event.target.value })} readOnly={readOnly} /></Field>
              <Field label="Criterio" htmlFor="a-dup-ok"><Select id="a-dup-ok" value={form.dupAceptable} onChange={(event) => patch({ dupAceptable: event.target.value })} disabled={readOnly}><option value="">—</option>{ACEPTABLE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
            </FormGrid>
          </Panel>
        </div>
        <Field label="Observaciones del análisis" htmlFor="a-obs" className="mt-5">
          <Textarea id="a-obs" rows={3} value={form.observaciones} onChange={(event) => patch({ observaciones: event.target.value })} readOnly={readOnly} />
        </Field>
      </FormCard>

      <FormCard
        id="sec-insumos"
        title="Insumos utilizados"
        description="Reactivos (fase móvil, estándares) y consumibles del análisis; se descuentan del inventario al guardar."
        aside={!readOnly ? <Button variant="secondary" size="sm" icon={<Plus size={14} weight="bold" />} onClick={() => patch({ inventarioRows: [...form.inventarioRows, newInventarioRow()] })}>Agregar insumo</Button> : undefined}
      >
        <InventarioRows rows={form.inventarioRows} onChange={(rows) => patch({ inventarioRows: rows })} />
      </FormCard>
    </FormPage>
  );
}
