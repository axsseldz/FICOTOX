"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Archive, ArrowCounterClockwise, FloppyDisk, Hash, Plus, Printer, UserPlus, X } from "@phosphor-icons/react";
import { IncidenciasFormCard } from "@/components/features/calidad/IncidenciasDelRegistro";
import { RecordHistory } from "@/components/features/audit/RecordHistory";
import { useSession } from "@/components/session/SessionProvider";
import { Button, IconButton } from "@/components/ui/Button";
import { Checkbox, Field, FormGrid, Input, Select, Textarea, controlClassSm } from "@/components/ui/Field";
import { DateInput } from "@/components/ui/DateInput";
import { Badge } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth, sendJsonAuth } from "@/lib/client/api";
import { fmtDate, isoDate, parseIntOrNull, todayIso } from "@/lib/client/format";
import { formatSampleFolio, isSampleReadOnly, sampleStatusLabel } from "@/lib/client/samples";
import { formatActiveUserSignature } from "@/lib/client/session";
import { invalidate } from "@/lib/client/store";
import { seOfrece, usePuedeCrear } from "@/lib/client/puede";
import type { ApiRecord } from "@/lib/client/types";
import { ACCEPTANCE_DECISIONS, DISPOSAL_TYPES, LEGACY_INSPECTION_REQUIREMENTS, LEGACY_RECEPTION_METHODS, LEGACY_RECEPTION_SAMPLE_TYPES, RECEPTION_ANALYSIS_TYPES, RECEPTION_INSPECTION_REQUIREMENTS, RECEPTION_METHODS, RECEPTION_SAMPLE_TYPES, CLIENT_CONTACT_MEDIA, RECEPTION_DELIVERY_MEDIA, STORAGE_PLACES } from "@/lib/shared/sgc";
import { Callout, ChoiceCard, ChoiceGrid, EditableScope, FieldGroup, FormCard, FormPage, Panel, PersonCard, personaId, type FormSectionDef } from "./FormLayout";
import { CampoValidado, MensajeCampo, useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { msg, type Problema } from "@/lib/client/mensajes";
import { PersonSelect } from "./PersonSelect";
import { SignaturePad } from "./SignaturePad";
import { FolioChip, SampleStatus, SolicitudCallout, SupervisionCallout } from "./status";
import { formatearHora } from "@/lib/shared/fechas";
import { AvisoAutorizacion } from "./AvisoAutorizacion";
import { DECISIONES_CON_AUTORIZACION, recepcionAsignable, useAccionesRecepcion } from "./RecepcionAcciones";
import { useConfirm } from "@/components/ui/Overlay";
import { requisitosRecepcion } from "@/lib/shared/autorizaciones";
import { FirmanteSelect, firmanteDe, firmantesPayload, type FirmanteState } from "./FirmanteSelect";

/*
 * Formato de recepcion de muestras (FX-TCF-GMR) como pagina completa, con
 * la decision de aceptacion (FX-MC 7.4.3), la disposicion final (7.4.4) y
 * el historial de auditoria.
 */

interface LoteRow {
  key: number;
  trabajar: boolean;
  id_interno: string;
  nombre_organismo: string;
  cantidad_volumen: string;
  sitio_muestreo: string;
  fecha_muestra: string;
  informacion_adicional: string;
}

interface InspectionRow {
  requisito: string;
  estado: string;
  observacion: string;
}

let loteKey = 1;
const newLoteRow = (item: ApiRecord = {}): LoteRow => ({
  key: loteKey++,
  trabajar: item.trabajar !== false,
  id_interno: item.id_interno || "",
  nombre_organismo: item.nombre_organismo || "",
  cantidad_volumen: item.cantidad_volumen || "",
  sitio_muestreo: item.sitio_muestreo || "",
  fecha_muestra: isoDate(item.fecha_muestra),
  informacion_adicional: item.informacion_adicional || "",
});

interface Comunicacion {
  fecha: string;
  medio: string;
  persona: string;
  respuesta: string;
}

interface SampleForm {
  claveRevision: string;
  fechaEmision: string;
  tipoRegistro: string;
  estado: string;
  folio: string;
  fechaRecepcion: string;
  horaRecepcion: string;
  recibidoPor: string;
  medioRecepcion: string;
  solicitante: string;
  muestraUnica: boolean;
  fechaMuestra: string;
  idInterno: string;
  especificaciones: string;
  loteRows: LoteRow[];
  tipos: string[];
  metodos: string[];
  metodoOtro: string;
  tiposMuestra: string[];
  tipoMuestraOtro: string;
  analisisObservaciones: string;
  inspeccion: InspectionRow[];
  inspeccionGeneral: string;
  decision: string;
  aceptacionFecha: string;
  aceptacionResponsable: string;
  temperaturaLlegada: string;
  aceptacionObservaciones: string;
  comunicacion: Comunicacion;
  solicitanteNombre: string;
  solicitanteCorreo: string;
  solicitanteFirma: string;
  conformidad: boolean;
  custodioNombre: string;
  custodioCargo: string;
  custodioFirma: string;
  custodioLugar: string;
  custodioOtro: string;
}

const defaultForm = (): SampleForm => ({
  claveRevision: "FX-TCF-GMR",
  fechaEmision: todayIso(),
  tipoRegistro: "R",
  estado: "registrada",
  folio: "",
  fechaRecepcion: todayIso(),
  horaRecepcion: formatearHora(new Date()),
  recibidoPor: formatActiveUserSignature(),
  medioRecepcion: "",
  solicitante: "",
  muestraUnica: true,
  fechaMuestra: "",
  idInterno: "",
  especificaciones: "",
  loteRows: [newLoteRow()],
  tipos: [],
  metodos: [],
  metodoOtro: "",
  tiposMuestra: [],
  tipoMuestraOtro: "",
  analisisObservaciones: "",
  inspeccion: RECEPTION_INSPECTION_REQUIREMENTS.map((requisito) => ({ requisito, estado: "", observacion: "" })),
  inspeccionGeneral: "",
  decision: "",
  aceptacionFecha: todayIso(),
  aceptacionResponsable: formatActiveUserSignature(),
  temperaturaLlegada: "",
  aceptacionObservaciones: "",
  comunicacion: { fecha: "", medio: "", persona: "", respuesta: "" },
  solicitanteNombre: "",
  solicitanteCorreo: "",
  solicitanteFirma: "",
  conformidad: false,
  custodioNombre: formatActiveUserSignature(),
  custodioCargo: "",
  custodioFirma: "",
  custodioLugar: "",
  custodioOtro: "",
});

/* La inspeccion guardada con el texto de la version anterior se casa por posicion (mismos 7 requisitos). */
const inspectionFromSaved = (checklist: ApiRecord[]): InspectionRow[] => {
  const byText = new Map(checklist.map((entry) => [String(entry.requisito || ""), entry]));
  return RECEPTION_INSPECTION_REQUIREMENTS.map((requisito, index) => {
    const current = byText.get(requisito) || byText.get(LEGACY_INSPECTION_REQUIREMENTS[index]) || {};
    return { requisito, estado: current.estado || "", observacion: current.observacion || "" };
  });
};

const formFromItem = (item: ApiRecord): SampleForm => {
  const analisis = item.analisis || {};
  const inspeccion = item.inspeccion || {};
  const checklist: ApiRecord[] = Array.isArray(inspeccion.checklist) ? inspeccion.checklist : [];
  const solicitante = item.datos_solicitante || {};
  const custodio = item.datos_custodio || {};
  const aceptacion = item.aceptacion || {};
  const comunicacion = aceptacion.comunicacion_cliente || {};
  const lote: ApiRecord[] = Array.isArray(item.lote_muestras) ? item.lote_muestras : [];
  return {
    ...defaultForm(),
    claveRevision: item.clave_revision || "FX-TCF-GMR",
    fechaEmision: isoDate(item.fecha_emision),
    tipoRegistro: item.tipo_registro || "R",
    folio: item.folio_num ? String(item.folio_num) : "",
    fechaRecepcion: isoDate(item.fecha_recepcion),
    horaRecepcion: item.hora_recepcion || "",
    recibidoPor: item.recibido_por || "",
    medioRecepcion: item.medio_recepcion || "",
    solicitante: item.solicitante || "",
    muestraUnica: !!item.muestra_unica,
    fechaMuestra: isoDate(item.fecha_muestra),
    idInterno: item.id_interno || "",
    especificaciones: item.especificaciones || "",
    estado: item.estado || "registrada",
    loteRows: lote.length ? lote.map((entry) => newLoteRow(entry)) : [newLoteRow()],
    tipos: analisis.tipos || [],
    metodos: analisis.metodos || [],
    metodoOtro: analisis.metodo_otro || "",
    tiposMuestra: analisis.tipos_muestra || [],
    tipoMuestraOtro: analisis.tipo_muestra_otro || "",
    analisisObservaciones: analisis.observaciones || "",
    inspeccion: inspectionFromSaved(checklist),
    inspeccionGeneral: inspeccion.observaciones_generales || "",
    decision: item.decision_aceptacion || "",
    aceptacionFecha: isoDate(aceptacion.fecha) || todayIso(),
    aceptacionResponsable: aceptacion.responsable || formatActiveUserSignature(),
    temperaturaLlegada: aceptacion.temperatura_llegada || "",
    aceptacionObservaciones: aceptacion.observaciones || "",
    comunicacion: { fecha: isoDate(comunicacion.fecha), medio: comunicacion.medio || "", persona: comunicacion.persona || "", respuesta: comunicacion.respuesta || "" },
    solicitanteNombre: solicitante.nombre_entrega || "",
    solicitanteCorreo: solicitante.correo || "",
    solicitanteFirma: solicitante.firma_conformidad || "",
    conformidad: solicitante.conformidad === true || (solicitante.conformidad === undefined && !!solicitante.firma_conformidad),
    custodioNombre: custodio.nombre_cargo_firma || "",
    custodioCargo: custodio.cargo || "",
    custodioFirma: custodio.firma_digital || "",
    custodioLugar: custodio.lugar_resguardo || "",
    custodioOtro: custodio.lugar_otro || "",
  };
};

/* La decisión puede tomarse después de registrar (sin ella no se procesa), por eso es opcional al guardar. */
const SECTIONS_BASE: FormSectionDef[] = [
  { id: "sec-recepcion", label: "Recepción" },
  { id: "sec-muestra", label: "Muestra" },
  { id: "sec-analisis", label: "Análisis solicitado" },
  { id: "sec-inspeccion", label: "Inspección visual" },
  { id: "sec-aceptacion", label: "Decisión de aceptación", optional: true, optionalLabel: "Puede decidirse después", optionalNote: "Necesaria para iniciar el procesamiento" },
  { id: "sec-solicitante", label: "Solicitante" },
  { id: "sec-custodio", label: "Custodio y resguardo" },
];
const SECTIONS_EDIT: FormSectionDef[] = [
  { id: "sec-cadena", label: "Seguimiento", optional: true },
  { id: "sec-disposicion", label: "Disposición final", optional: true },
  { id: "sec-historial", label: "Historial", optional: true },
];

const toggle = (list: string[], value: string, checked: boolean) => (checked ? [...list.filter((v) => v !== value), value] : list.filter((v) => v !== value));

/* Valores guardados que ya no estan en el catalogo (version anterior): se muestran para poder quitarlos. */
function LegacyChips({ values, catalog, labels, onRemove }: { values: string[]; catalog: string[]; labels: Record<string, string>; onRemove: (value: string) => void }) {
  const legacy = values.filter((value) => !catalog.includes(value));
  if (!legacy.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {legacy.map((value) => (
        <span key={value} className="inline-flex items-center gap-1 rounded-[6px] bg-warning-soft px-2 py-0.5 text-[12px] text-warning-text">
          {labels[value] || value}
          <button type="button" onClick={() => onRemove(value)} aria-label={`Quitar ${labels[value] || value}`} className="opacity-70 hover:opacity-100">
            <X size={11} weight="bold" />
          </button>
        </span>
      ))}
    </div>
  );
}

export function ReceptionForm({ item }: { item: ApiRecord | null }) {
  const router = useRouter();
  const { token, can } = useSession();
  const puedeCrear = usePuedeCrear();
  const [form, setForm] = useState<SampleForm>(() => (item ? formFromItem(item) : defaultForm()));
  // Fase 5: quien recibe se liga a una cuenta (por omisión la sesión; otra persona confirma con su contraseña).
  const [recibio, setRecibio] = useState<FirmanteState>(() => firmanteDe(item, "recibio"));
  const [submitting, setSubmitting] = useState(false);
  const [disposicion, setDisposicion] = useState({ tipo: "", tipoOtro: "", fecha: todayIso(), responsable: formatActiveUserSignature(), remanentes: "", observaciones: "", firma: "" });
  const [savingDisposicion, setSavingDisposicion] = useState(false);
  const editing = !!item?.id;
  // Con las banderas del servidor (rol + autorización FX-THF-AP + asignación); sin ellas, solo el rol.
  const canEdit = editing ? seOfrece(item, "editar", can("muestras", "E", { objeto: "recepcion", borrador: String(item?.estado || "registrada") === "registrada" })) : puedeCrear("recepcion", can("muestras", "C", { objeto: "recepcion", borrador: true }));
  // Con una solicitud de autorizacion pendiente (Fase 3) el registro no se edita.
  const readOnly = editing && (isSampleReadOnly(item?.estado) || !canEdit || !!item?.solicitud_pendiente);
  // Fase 5: asignar, cambiar folio y reabrir (sin muestras:A quedan como solicitud para la Coord. Tecnica).
  const acciones = useAccionesRecepcion();
  const confirm = useConfirm();
  const estadoGuardado = String(item?.estado || "");
  const puedeAsignar = editing && can("muestras", "A") && recepcionAsignable(item);
  const puedeCambiarFolio = editing && !item?.solicitud_pendiente && !["anulada", "liberada", "cerrada", "rechazada"].includes(estadoGuardado) && can("muestras", "E", { objeto: "recepcion" });
  const puedeReabrir = editing && !item?.solicitud_pendiente && ["cerrada", "rechazada"].includes(estadoGuardado) && can("muestras", "E", { objeto: "recepcion" });
  const patch = (changes: Partial<SampleForm>) => setForm((prev) => ({ ...prev, ...changes }));

  useEffect(() => {
    if (item || !token) return;
    getJsonAuth(`${API_BASE_URL}/samples/reception/next-folio`, token)
      .then((data) => patch({ folio: data.next_folio ? String(data.next_folio) : "" }))
      .catch(() => patch({ folio: "" }));
  }, [item, token]);

  const isUnique = form.muestraUnica;
  const methodOther = form.metodos.includes("otro");
  const sampleOther = form.tiposMuestra.includes("otro");
  const hasNc = form.inspeccion.some((row) => row.estado === "NC");
  const inspectionComplete = form.inspeccion.every((row) => !!row.estado);
  const needsComunicacion = form.decision === "aceptada_con_desviacion" || form.decision === "rechazada";
  const ncRows = form.inspeccion.map((row, i) => ({ row, n: i + 1 })).filter(({ row }) => row.estado === "NC");
  const aceptadaInvalida = form.decision === "aceptada" && hasNc;
  const custodioId = personaId("Custodio");
  /*
   * Reglas del formato, en el orden en que aparecen. La misma lista da la
   * completitud de la guía, el aviso del encabezado y el pop-up al guardar.
   */
  const reglas = (): Problema[] => {
    const out: Problema[] = [];
    const en = (seccion: string, grupo: string) => (campo: string, mensaje: string, extra: Partial<Problema> = {}) => out.push({ campo, mensaje, seccion, grupo, ...extra });
    const rec = en("sec-recepcion", "Recepción");
    if (!form.folio) rec("r-folio", msg.indica("el folio"));
    if (!form.fechaRecepcion) rec("r-fecha", msg.indica("la fecha de recepción"));
    if (!form.horaRecepcion) rec("r-hora", msg.indica("la hora de recepción"));
    if (!form.medioRecepcion) rec("r-medio", msg.elige("el medio de recepción"));
    if (!form.recibidoPor.trim()) rec("r-recibido", msg.elige("quién recibe la muestra"));
    if (!form.solicitante.trim()) rec("r-solicitante", msg.indica("el solicitante"));
    const mu = en("sec-muestra", "Muestra");
    if (isUnique) {
      if (form.fechaMuestra && form.fechaRecepcion && form.fechaMuestra > form.fechaRecepcion) mu("r-fecha-muestra", msg.fechaPosterior("La fecha de muestreo", "la recepción"));
      if (!form.idInterno.trim()) mu("r-id", msg.indica("el ID interno"));
    } else {
      if (!form.loteRows.some((row) => row.id_interno.trim())) mu("r-lote-id-0", msg.indica("el ID interno de al menos una muestra del lote"));
      form.loteRows.forEach((row, i) => {
        if (row.fecha_muestra && form.fechaRecepcion && row.fecha_muestra > form.fechaRecepcion) mu(`r-lote-fecha-${i}`, msg.fechaPosterior(`La fecha de muestreo de la muestra ${i + 1}`, "la recepción"));
      });
    }
    if (!form.tipos.length) en("sec-analisis", "Análisis solicitado")("r-tipos", msg.marca("al menos un tipo de análisis"));
    const insp = en("sec-inspeccion", "Inspección visual");
    form.inspeccion.forEach((row, i) => {
      if (!row.estado) insp(`r-insp-${i + 1}`, msg.requisito(i + 1));
    });
    if (form.decision) {
      const dec = en("sec-aceptacion", "Decisión de aceptación");
      if (aceptadaInvalida) dec("r-decision", `«Aceptada» ya no es válida: el requisito ${ncRows[0].n} está en NC. Elige «Aceptada con desviación» o «Rechazada», o corrige la inspección`, { inmediato: true });
      if (!form.aceptacionFecha) dec("r-acep-fecha", msg.indica("la fecha de la decisión"));
      if (!form.aceptacionResponsable.trim()) dec("r-acep-resp", msg.indica("el responsable de la decisión"));
      if (needsComunicacion && !form.comunicacion.fecha) dec("r-com-fecha", msg.indica("la fecha de la comunicación al cliente"));
      if (needsComunicacion && !form.comunicacion.medio) dec("r-com-medio", msg.elige("el medio de la comunicación al cliente"));
    }
    const sol = en("sec-solicitante", "Solicitante");
    if (!form.solicitanteNombre.trim()) sol("r-sol-nombre", msg.indica("el nombre de quien entrega"));
    if (!form.solicitanteFirma) sol("r-sol-firma", msg.firma("quien entrega (conformidad)"));
    if (!form.conformidad) sol("r-conformidad", msg.marca("la casilla de conformidad"));
    const cus = en("sec-custodio", "Custodio");
    if (!form.custodioNombre.trim()) cus(custodioId, msg.elige("al custodio"));
    if (!form.custodioFirma) cus(`${custodioId}-firma`, msg.firma("quien registra (custodio)"));
    if (!form.custodioLugar) cus("r-resguardo", msg.elige("el lugar de resguardo"));
    return out;
  };
  const v = useValidacion({ titulo: editing ? "No se pudo guardar la recepción" : "No se pudo registrar la recepción", reglas: readOnly ? () => [] : reglas });
  // Si la opción elegida deja de ser válida (se marcó un NC con "Aceptada"), se avisa; no se cambia en silencio.
  const avisoAceptada = useRef(aceptadaInvalida);
  useEffect(() => {
    if (aceptadaInvalida && !avisoAceptada.current && !readOnly) {
      v.avisar({ titulo: "«Aceptada» ya no es válida", que: `El requisito «${ncRows[0].row.requisito}» quedó en NC: con un requisito en NC la muestra no puede quedar simplemente «Aceptada».`, hacer: "Elige «Aceptada con desviación» o «Rechazada», o corrige la inspección.", problemas: [{ campo: "r-decision", mensaje: "«Aceptada» ya no es válida con requisitos en NC", seccion: "sec-aceptacion", grupo: "Decisión de aceptación" }] });
    }
    avisoAceptada.current = aceptadaInvalida;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aceptadaInvalida]);
  const bloqueoAceptada = () =>
    v.avisar({
      titulo: "No se puede marcar «Aceptada»",
      que: `El requisito «${ncRows[0].row.requisito}» está en NC (ISO/IEC 17025 7.4.3).`,
      hacer: "Elige «Aceptada con desviación» o «Rechazada», o corrige la inspección.",
      problemas: ncRows.map(({ n }) => ({ campo: `r-insp-${n}`, mensaje: `El requisito ${n} está en NC`, seccion: "sec-inspeccion", grupo: "Inspección visual" })),
    });
  // Completitud: las secciones obligatorias usan las reglas; las opcionales, si se llenaron.
  const sections = (editing ? [...SECTIONS_BASE, ...SECTIONS_EDIT] : SECTIONS_BASE).map((section) => ({ ...section, complete: readOnly ? undefined : section.id === "sec-aceptacion" ? (form.decision ? v.seccionCompleta(section.id) : undefined) : section.optional ? undefined : v.seccionCompleta(section.id) }));
  const camposServidor = { solicitante: "r-solicitante", folio: "r-folio", id_interno: "r-id", medio_recepcion: "r-medio", "firma:recibio": "r-recibido" };
  const ubicacionServidor = { solicitante: { seccion: "sec-recepcion", grupo: "Recepción" }, folio: { seccion: "sec-recepcion", grupo: "Recepción" }, id_interno: { seccion: "sec-muestra", grupo: "Muestra" }, medio_recepcion: { seccion: "sec-recepcion", grupo: "Recepción" }, "firma:recibio": { seccion: "sec-recepcion", grupo: "Recepción" } };

  const updateLote = (key: number, changes: Partial<LoteRow>) => patch({ loteRows: form.loteRows.map((row) => (row.key === key ? { ...row, ...changes } : row)) });

  const buildPayload = () => {
    const lote = form.loteRows
      .map((row) => ({
        trabajar: !!row.trabajar,
        id_interno: row.id_interno.trim() || null,
        nombre_organismo: row.nombre_organismo.trim() || null,
        cantidad_volumen: row.cantidad_volumen.trim() || null,
        sitio_muestreo: row.sitio_muestreo.trim() || null,
        fecha_muestra: row.fecha_muestra || null,
        informacion_adicional: row.informacion_adicional.trim() || null,
      }))
      .filter((row) => [row.id_interno, row.nombre_organismo, row.cantidad_volumen, row.sitio_muestreo, row.fecha_muestra, row.informacion_adicional].some(Boolean));
    return {
      folio_num: parseIntOrNull(form.folio),
      tipo_registro: form.tipoRegistro.trim() || "R",
      clave_revision: form.claveRevision.trim() || "FX-TCF-GMR",
      fecha_emision: form.fechaEmision || null,
      fecha_recepcion: form.fechaRecepcion || null,
      hora_recepcion: form.horaRecepcion || null,
      recibido_por: form.recibidoPor.trim() || null,
      medio_recepcion: form.medioRecepcion.trim() || null,
      solicitante: form.solicitante.trim() || null,
      muestra_unica: isUnique,
      fecha_muestra: form.fechaMuestra || null,
      id_interno: isUnique ? form.idInterno.trim() || null : null,
      especificaciones: form.especificaciones.trim() || null,
      estado: form.estado || "registrada",
      lote_muestras: isUnique ? [] : lote,
      analisis: {
        tipos: form.tipos,
        metodos: form.metodos,
        metodo_otro: methodOther ? form.metodoOtro.trim() || null : null,
        tipos_muestra: form.tiposMuestra,
        tipo_muestra_otro: sampleOther ? form.tipoMuestraOtro.trim() || null : null,
        observaciones: form.analisisObservaciones.trim() || null,
      },
      inspeccion: {
        checklist: form.inspeccion.map((row) => ({ requisito: row.requisito, estado: row.estado, observacion: row.observacion.trim() || null })),
        observaciones_generales: form.inspeccionGeneral.trim() || null,
      },
      decision_aceptacion: form.decision || null,
      aceptacion: form.decision
        ? {
            fecha: form.aceptacionFecha || null,
            responsable: form.aceptacionResponsable.trim() || null,
            temperatura_llegada: form.temperaturaLlegada.trim() || null,
            observaciones: form.aceptacionObservaciones.trim() || null,
            comunicacion_cliente: needsComunicacion ? { requerida: true, fecha: form.comunicacion.fecha || null, medio: form.comunicacion.medio || null, persona: form.comunicacion.persona.trim() || null, respuesta: form.comunicacion.respuesta.trim() || null } : { requerida: false },
          }
        : {},
      datos_solicitante: { nombre_entrega: form.solicitanteNombre.trim() || null, correo: form.solicitanteCorreo.trim() || null, firma_conformidad: form.solicitanteFirma.trim() || null, conformidad: form.conformidad },
      datos_custodio: {
        nombre_cargo_firma: form.custodioNombre.trim() || null,
        cargo: form.custodioCargo.trim() || null,
        firma_digital: form.custodioFirma.trim() || null,
        lugar_resguardo: form.custodioLugar || null,
        lugar_otro: form.custodioOtro.trim() || null,
      },
    };
  };

  const vDisp = useValidacion({
    titulo: "No se pudo registrar la disposición final",
    reglas: () => {
      const out: Problema[] = [];
      if (!disposicion.tipo) out.push({ campo: "r-disp-tipo", mensaje: msg.elige("el tipo de disposición final"), grupo: "Disposición final" });
      if (!disposicion.fecha) out.push({ campo: "r-disp-fecha", mensaje: msg.indica("la fecha de la disposición"), grupo: "Disposición final" });
      if (!disposicion.responsable.trim()) out.push({ campo: "r-disp-resp", mensaje: msg.indica("el responsable"), grupo: "Disposición final" });
      return out;
    },
  });

  const handleSave = async () => {
    const payload = { ...buildPayload(), firmantes: firmantesPayload({ recibio }) };
    if (!v.validar()) return;
    if (!canEdit) return v.avisar({ que: "No tienes permiso para guardar esta recepción.", hacer: "Pide a la administración que revise tus roles y permisos." });
    // Fase 5: rechazo o aceptacion con desviacion los autoriza la Coord. Tecnica (muestras:A).
    if (DECISIONES_CON_AUTORIZACION.has(form.decision) && form.decision !== String(item?.decision_aceptacion || "") && !can("muestras", "A")) {
      const seguir = await confirm({
        title: "La decisión quedará como solicitud",
        description: `"${ACCEPTANCE_DECISIONS.find((d) => d.value === form.decision)?.label || form.decision}" la autoriza la Coord. del Área Técnica. La recepción se guarda sin esa decisión y queda bloqueada hasta que la aprueben o rechacen.`,
        confirmLabel: "Guardar y solicitar",
      });
      if (!seguir) return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        const data = await sendJsonAuth("PUT", `${API_BASE_URL}/samples/reception/${item!.id}`, token, payload);
        acciones.avisarSolicitud(data, "Recepción actualizada");
      } else {
        const data = await sendJsonAuth("POST", `${API_BASE_URL}/samples/reception`, token, payload);
        acciones.avisarSolicitud(data, "Recepción registrada");
      }
      invalidate("muestras", "dashboard");
      router.push("/muestras/recepcion");
    } catch (err) {
      v.errorServidor(err, camposServidor, ubicacionServidor);
      setSubmitting(false);
    }
  };

  const registrarDisposicion = async () => {
    if (!vDisp.validar()) return;
    setSavingDisposicion(true);
    try {
      await sendJsonAuth("POST", `${API_BASE_URL}/samples/reception/${item!.id}/disposicion`, token, {
        tipo: disposicion.tipo,
        tipo_otro: disposicion.tipoOtro.trim() || null,
        fecha: disposicion.fecha,
        responsable: disposicion.responsable.trim(),
        remanentes: disposicion.remanentes.trim() || null,
        observaciones: disposicion.observaciones.trim() || null,
        firma: disposicion.firma || null,
      });
      toast.success("Disposición registrada; la muestra queda cerrada");
      invalidate("muestras", "dashboard");
      router.push("/muestras/recepcion");
    } catch (err) {
      vDisp.errorServidor(err);
      setSavingDisposicion(false);
    }
  };

  const decisionMeta = ACCEPTANCE_DECISIONS.find((d) => d.value === form.decision);
  const savedDisposicion = item?.disposicion as ApiRecord | null | undefined;
  const procesamientos = (item?.procesamientos || []) as ApiRecord[];
  // Una muestra rechazada tambien se dispone (se devuelve o se desecha); solo las
  // cerradas y las anuladas ya no admiten disposicion.
  const puedeDisponer = editing && !["cerrada", "anulada"].includes(String(form.estado)) && can("muestras", "A") && !savedDisposicion;

  return (
    <FormPage
      backHref="/muestras/recepcion"
      backLabel="Recepciones"
      code="FX-TCF-GMR"
      title={editing ? `Recepción ${formatSampleFolio(item!)}` : "Nueva recepción"}
      status={sampleStatusLabel(form.estado)}
      statusTone={readOnly ? (form.estado === "cerrada" ? "ink" : "danger") : "brand"}
      sections={sections}
      validacion={v}
      readOnly={readOnly}
      after={
        editing ? (
          <>
          <FormCard id="sec-cadena" title="Seguimiento de la muestra" description="Etapas registradas a partir de esta recepción.">
            {procesamientos.length ? (
              <ul className="flex flex-col gap-2">
                {procesamientos.map((proc) => (
                  <li key={proc.id} className="flex items-center justify-between gap-3 rounded-card border border-line px-3 py-2">
                    <span className="flex items-center gap-2">
                      <FolioChip type="P" num={proc.folio_num} />
                      <SampleStatus status={proc.estado} />
                    </span>
                    <Link href={`/muestras/procesamiento/${proc.id}`} className="text-[13px] font-medium text-brand hover:text-brand-strong">
                      Abrir procesamiento
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-3">Aún no hay procesamientos vinculados a esta recepción.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={`/muestras/analisis?recepcion=${item!.id}`} className="text-[13px] font-medium text-brand hover:text-brand-strong">
                Ver análisis de esta recepción
              </Link>
              <span className="text-ink-4">·</span>
              <Link href={`/informes?recepcion=${item!.id}`} className="text-[13px] font-medium text-brand hover:text-brand-strong">
                Ver informes
              </Link>
            </div>
          </FormCard>

          <ValidacionAmbito v={vDisp}>
          <FormCard id="sec-disposicion" title="Disposición final de remanentes" description="Cierra la muestra: qué se hizo con lo que sobró, cuándo y quién (FX-MC 7.4.4).">
            {savedDisposicion ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <p className="text-[13.5px]">
                  <span className="text-ink-3">Disposición: </span>
                  <span className="font-medium text-ink">{DISPOSAL_TYPES.find((d) => d.value === savedDisposicion.tipo)?.label || savedDisposicion.tipo_otro || savedDisposicion.tipo}</span>
                </p>
                <p className="text-[13.5px]">
                  <span className="text-ink-3">Fecha: </span>
                  <span className="font-medium text-ink">{fmtDate(savedDisposicion.fecha)}</span>
                </p>
                <p className="text-[13.5px]">
                  <span className="text-ink-3">Responsable: </span>
                  <span className="font-medium text-ink">{savedDisposicion.responsable}</span>
                </p>
                <p className="text-[13.5px]">
                  <span className="text-ink-3">Remanentes: </span>
                  <span className="whitespace-pre-wrap text-ink">{savedDisposicion.remanentes || "—"}</span>
                </p>
                {savedDisposicion.observaciones ? <p className="whitespace-pre-wrap text-[13.5px] sm:col-span-2">{savedDisposicion.observaciones}</p> : null}
              </div>
            ) : puedeDisponer ? (
              <div className="flex flex-col gap-4">
                <CampoValidado id="r-disp-tipo">
                  <ChoiceGrid>
                    {DISPOSAL_TYPES.map((d) => (
                      <ChoiceCard key={d.value} type="radio" name="r-disp" checked={disposicion.tipo === d.value} onChange={() => setDisposicion({ ...disposicion, tipo: d.value })} label={d.label} />
                    ))}
                  </ChoiceGrid>
                </CampoValidado>
                {disposicion.tipo === "otro" ? <Input placeholder="Especificar" maxLength={120} value={disposicion.tipoOtro} onChange={(event) => setDisposicion({ ...disposicion, tipoOtro: event.target.value })} aria-label="Otro tipo de disposición" /> : null}
                <FormGrid cols={3}>
                  <Field label="Fecha" htmlFor="r-disp-fecha" required>
                    <DateInput id="r-disp-fecha" value={disposicion.fecha} onChange={(value) => setDisposicion({ ...disposicion, fecha: value })} />
                  </Field>
                  <Field label="Responsable" htmlFor="r-disp-resp" required>
                    <PersonSelect id="r-disp-resp" value={disposicion.responsable} onChange={(name) => setDisposicion({ ...disposicion, responsable: name })} requires="muestras" />
                  </Field>
                  <Field label="Remanentes" htmlFor="r-disp-rem" hint="Qué sobró y cuánto.">
                    <Textarea id="r-disp-rem" rows={1} maxLength={240} value={disposicion.remanentes} onChange={(event) => setDisposicion({ ...disposicion, remanentes: event.target.value })} />
                  </Field>
                </FormGrid>
                <FormGrid>
                  <Field label="Observaciones" htmlFor="r-disp-obs">
                    <Textarea id="r-disp-obs" rows={3} value={disposicion.observaciones} onChange={(event) => setDisposicion({ ...disposicion, observaciones: event.target.value })} />
                  </Field>
                  <Field label="Firma del responsable">
                    <EditableScope>
                      <SignaturePad value={disposicion.firma} onChange={(value) => setDisposicion({ ...disposicion, firma: value })} label="Firma de la disposición" />
                    </EditableScope>
                  </Field>
                </FormGrid>
                <div>
                  <Button variant="secondary" icon={<Archive size={16} />} loading={savingDisposicion} onClick={registrarDisposicion}>
                    Registrar disposición y cerrar la muestra
                  </Button>
                </div>
              </div>
            ) : (
              <Callout tone="info">La disposición final se registra cuando la muestra ya no requiere trabajo en el laboratorio.</Callout>
            )}
          </FormCard>
          </ValidacionAmbito>
            <IncidenciasFormCard entidad="muestras_recepcion" id={item?.id} etiqueta={formatSampleFolio(item!)} />
            <FormCard id="sec-historial" title="Historial del registro" description="Bitácora de auditoría: quién creó, editó, aceptó, anuló o cerró esta recepción y qué cambió.">
              <RecordHistory entidad="muestras_recepcion" entidadId={item?.id as number | undefined} />
            </FormCard>
          </>
        ) : null
      }
      actions={
        <>
          <Button variant="secondary" onClick={() => router.push("/muestras/recepcion")}>
            {readOnly ? "Volver" : "Cancelar"}
          </Button>
          {editing ? (
            <Button variant="secondary" icon={<Printer size={16} />} onClick={() => router.push(`/muestras/recepcion/${item!.id}/etiquetas`)}>
              Imprimir etiqueta
            </Button>
          ) : null}
          {puedeAsignar ? (
            <Button variant="secondary" icon={<UserPlus size={16} />} onClick={() => acciones.asignar(item!)}>
              Asignar
            </Button>
          ) : null}
          {puedeCambiarFolio ? (
            <Button variant="secondary" icon={<Hash size={16} />} onClick={() => acciones.cambiarFolio(item!)}>
              Cambiar folio…
            </Button>
          ) : null}
          {puedeReabrir ? (
            <Button variant="secondary" icon={<ArrowCounterClockwise size={16} />} onClick={() => acciones.reabrir(item!)}>
              Reabrir…
            </Button>
          ) : null}
          {!readOnly ? (
            <Button onClick={handleSave} loading={submitting} icon={<FloppyDisk size={16} />}>
              {editing ? "Guardar cambios" : "Registrar recepción"}
            </Button>
          ) : null}
        </>
      }
    >
      <SupervisionCallout item={item} />
      <SolicitudCallout item={item} />
      {acciones.dialogo}
      {!readOnly ? <AvisoAutorizacion requisitos={requisitosRecepcion()} /> : null}
      {readOnly && item?.motivo_anulacion ? (
        <Callout tone="danger" title="Registro anulado">
          Motivo: {String(item.motivo_anulacion)}
          {item.anulado_cargo ? ` · Anuló como ${String(item.anulado_cargo)}` : ""}
        </Callout>
      ) : null}

      <FormCard id="sec-recepcion" title="Datos de la recepción" description="Quién recibe, cuándo y por qué medio.">
        <FormGrid cols={4}>
          <Field label="Folio" htmlFor="r-folio" required hint={editing ? "Ya no se edita; usa «Cambiar folio…»." : "Se sugiere el siguiente disponible."}>
            <Input id="r-folio" type="number" min="1" inputMode="numeric" value={form.folio} readOnly={editing} onChange={(event) => patch({ folio: event.target.value })} mono />
          </Field>
          <Field label="Fecha de recepción" htmlFor="r-fecha" required>
            <DateInput id="r-fecha" value={form.fechaRecepcion} onChange={(value) => patch({ fechaRecepcion: value })} />
          </Field>
          <Field label="Hora" htmlFor="r-hora" required>
            <Input id="r-hora" type="time" value={form.horaRecepcion} onChange={(event) => patch({ horaRecepcion: event.target.value })} />
          </Field>
          <Field label="Medio de recepción" htmlFor="r-medio" required>
            <Select id="r-medio" value={form.medioRecepcion} onChange={(event) => patch({ medioRecepcion: event.target.value })}>
              <option value="">Seleccionar</option>
              {RECEPTION_DELIVERY_MEDIA.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Recibido por" htmlFor="r-recibido" required className="sm:col-span-2">
            <FirmanteSelect
              id="r-recibido"
              title="Recibido por"
              value={recibio}
              nombre={item ? form.recibidoPor : ""}
              onChange={(value, cuenta) => {
                setRecibio(value);
                patch({ recibidoPor: cuenta?.nombre || "" });
              }}
            />
          </Field>
          <Field label="Solicitante" htmlFor="r-solicitante" required className="sm:col-span-2">
            <Input id="r-solicitante" maxLength={180} placeholder="Cliente o institución que entrega" value={form.solicitante} onChange={(event) => patch({ solicitante: event.target.value })} />
          </Field>
        </FormGrid>
      </FormCard>

      <FormCard id="sec-muestra" title="Datos de la muestra" description="Muestra única o lote con varias muestras.">
        <ChoiceGrid cols={2} className="mb-5">
          <ChoiceCard type="radio" name="r-tipo" checked={isUnique} onChange={() => patch({ muestraUnica: true })} label="Muestra única" description="Un solo organismo o volumen con ID interno." />
          <ChoiceCard type="radio" name="r-tipo" checked={!isUnique} onChange={() => patch({ muestraUnica: false })} label="Lote" description="Varias muestras asociadas a la misma recepción." />
        </ChoiceGrid>
        {isUnique ? (
          <FormGrid>
            <Field label="Fecha de la muestra" htmlFor="r-fecha-muestra">
              <DateInput id="r-fecha-muestra" value={form.fechaMuestra} onChange={(value) => patch({ fechaMuestra: value })} />
            </Field>
            <Field label="ID interno" htmlFor="r-id" required>
              <Input id="r-id" maxLength={100} placeholder="Ejemplo: D26-100" value={form.idInterno} onChange={(event) => patch({ idInterno: event.target.value })} mono />
            </Field>
            <Field label="Especificaciones" htmlFor="r-esp" hint="Organismo, cantidad, condiciones de la muestra o lo que indique el solicitante." className="sm:col-span-2">
              <Textarea id="r-esp" rows={3} maxLength={220} value={form.especificaciones} onChange={(event) => patch({ especificaciones: event.target.value })} />
            </Field>
          </FormGrid>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-ink-3">{form.loteRows.length} muestra(s) en el lote. Marca “Trabajar” en las que continúan al procesamiento.</p>
            <div className="flex flex-col gap-2.5">
              {form.loteRows.map((row, index) => {
                const cell = "flex flex-col gap-1 text-[11.5px] font-medium text-ink-3";
                return (
                  <div key={row.key} className="on-panel grid gap-3 rounded-[12px] bg-surface-2 p-3.5 ring-1 ring-line md:grid-cols-[auto_minmax(0,1fr)_auto]">
                    <div className="self-start md:w-[88px] md:pt-5">
                      <Checkbox label="Trabajar" checked={row.trabajar} onChange={(event) => updateLote(row.key, { trabajar: event.target.checked })} />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <label className={cell}>
                        ID interno · muestra {index + 1}
                        <input id={`r-lote-id-${index}`} className={`${controlClassSm} font-mono`} placeholder="Ej. D26-101" value={row.id_interno} onChange={(event) => updateLote(row.key, { id_interno: event.target.value })} aria-label={`ID interno de la muestra ${index + 1}`} />
                        <MensajeCampo id={`r-lote-id-${index}`} />
                      </label>
                      <label className={cell}>
                        Organismo
                        <input className={`${controlClassSm}`} value={row.nombre_organismo} onChange={(event) => updateLote(row.key, { nombre_organismo: event.target.value })} aria-label={`Organismo de la muestra ${index + 1}`} />
                      </label>
                      <label className={cell}>
                        Cantidad / volumen
                        <input className={`${controlClassSm}`} value={row.cantidad_volumen} onChange={(event) => updateLote(row.key, { cantidad_volumen: event.target.value })} aria-label={`Cantidad o volumen de la muestra ${index + 1}`} />
                      </label>
                      <label className={cell}>
                        Sitio de muestreo
                        <input className={`${controlClassSm}`} value={row.sitio_muestreo} onChange={(event) => updateLote(row.key, { sitio_muestreo: event.target.value })} aria-label={`Sitio de muestreo de la muestra ${index + 1}`} />
                      </label>
                      <label className={cell}>
                        Fecha de la muestra
                        <DateInput id={`r-lote-fecha-${index}`} small value={row.fecha_muestra} onChange={(value) => updateLote(row.key, { fecha_muestra: value })} aria-label={`Fecha de la muestra ${index + 1}`} />
                        <MensajeCampo id={`r-lote-fecha-${index}`} />
                      </label>
                      <label className={`${cell} sm:col-span-2 lg:col-span-3`}>
                        Información adicional
                        <Textarea small rows={1} value={row.informacion_adicional} onChange={(event) => updateLote(row.key, { informacion_adicional: event.target.value })} aria-label={`Información adicional de la muestra ${index + 1}`} />
                      </label>
                    </div>
                    <div className="flex items-start justify-end md:pt-4">
                      <IconButton label={`Quitar muestra ${index + 1}`} size="sm" tone="danger" onClick={() => patch({ loteRows: form.loteRows.length > 1 ? form.loteRows.filter((r) => r.key !== row.key) : [newLoteRow()] })}>
                        <X size={14} weight="bold" />
                      </IconButton>
                    </div>
                  </div>
                );
              })}
            </div>
            <div>
              <Button variant="ghost" size="sm" icon={<Plus size={14} weight="bold" />} onClick={() => patch({ loteRows: [...form.loteRows, newLoteRow()] })}>
                Agregar muestra
              </Button>
            </div>
          </div>
        )}
      </FormCard>

      <FormCard id="sec-analisis" title="Análisis solicitado" description="Marca uno o más análisis, el método y el tipo de muestra, tal como los lista el formato.">
        <div className="grid gap-6 lg:grid-cols-3">
          <CampoValidado id="r-tipos" className="flex flex-col gap-2">
            <p className="text-[13px] font-medium text-ink-2">Tipo de análisis</p>
            {RECEPTION_ANALYSIS_TYPES.map(({ value, label }) => (
              <Checkbox key={value} label={label} checked={form.tipos.includes(value)} onChange={(event) => patch({ tipos: toggle(form.tipos, value, event.target.checked) })} />
            ))}
          </CampoValidado>
          <div className="flex flex-col gap-2">
            <p className="text-[13px] font-medium text-ink-2">Método de análisis</p>
            {RECEPTION_METHODS.map(({ value, label }) => (
              <Checkbox key={value} label={label} checked={form.metodos.includes(value)} onChange={(event) => patch({ metodos: toggle(form.metodos, value, event.target.checked), metodoOtro: value === "otro" && !event.target.checked ? "" : form.metodoOtro })} />
            ))}
            <LegacyChips values={form.metodos} catalog={RECEPTION_METHODS.map((m) => m.value)} labels={LEGACY_RECEPTION_METHODS} onRemove={(value) => patch({ metodos: form.metodos.filter((v) => v !== value) })} />
            {methodOther ? <Input placeholder="Especifica el método" maxLength={120} value={form.metodoOtro} onChange={(event) => patch({ metodoOtro: event.target.value })} aria-label="Otro método" /> : null}
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-[13px] font-medium text-ink-2">Tipo de muestra</p>
            {RECEPTION_SAMPLE_TYPES.map(({ value, label }) => (
              <Checkbox key={value} label={label} checked={form.tiposMuestra.includes(value)} onChange={(event) => patch({ tiposMuestra: toggle(form.tiposMuestra, value, event.target.checked), tipoMuestraOtro: value === "otro" && !event.target.checked ? "" : form.tipoMuestraOtro })} />
            ))}
            <LegacyChips values={form.tiposMuestra} catalog={RECEPTION_SAMPLE_TYPES.map((m) => m.value)} labels={LEGACY_RECEPTION_SAMPLE_TYPES} onRemove={(value) => patch({ tiposMuestra: form.tiposMuestra.filter((v) => v !== value) })} />
            {sampleOther ? <Input placeholder="Especifica el tipo de muestra" maxLength={120} value={form.tipoMuestraOtro} onChange={(event) => patch({ tipoMuestraOtro: event.target.value })} aria-label="Otro tipo de muestra" /> : null}
          </div>
        </div>
        <Field label="Observaciones" htmlFor="r-obs-analisis" className="mt-5">
          <Textarea id="r-obs-analisis" rows={2} value={form.analisisObservaciones} onChange={(event) => patch({ analisisObservaciones: event.target.value })} />
        </Field>
      </FormCard>

      <FormCard
        id="sec-inspeccion"
        title="Inspección visual de la muestra"
        description="Requisitos del formato: cumple (C), no cumple (NC) o no aplica (NA)."
        aside={
          <div className="flex flex-wrap gap-1.5 sm:justify-end">
            <Badge tone="success">C cumple</Badge>
            <Badge tone="danger">NC no cumple</Badge>
            <Badge tone="neutral">NA no aplica</Badge>
          </div>
        }
      >
        <div className="flex flex-col divide-y divide-line">
          {form.inspeccion.map((row, index) => (
            <CampoValidado key={row.requisito} id={`r-insp-${index + 1}`} className="grid gap-3 px-1 py-3 md:grid-cols-[1fr_auto_260px] md:items-center">
              <p className="text-[13.5px] leading-snug text-ink">
                <span className="tnum mr-1.5 text-ink-3">{index + 1}.</span>
                {row.requisito}
              </p>
              <div className="inline-flex rounded-full bg-surface-3 p-0.5" role="radiogroup" aria-label={row.requisito}>
                {(["C", "NC", "NA"] as const).map((status) => {
                  const active = row.estado === status;
                  const tone = status === "C" ? "bg-success text-on-accent" : status === "NC" ? "bg-danger text-on-accent" : "bg-surface text-ink shadow-card";
                  return (
                    <button key={status} type="button" role="radio" aria-checked={active} onClick={() => patch({ inspeccion: form.inspeccion.map((entry) => (entry.requisito === row.requisito ? { ...entry, estado: active ? "" : status } : entry)) })} className={`press h-7 min-w-11 rounded-full px-2.5 text-[12.5px] font-medium transition-colors ${active ? tone : "text-ink-3 hover:text-ink"}`}>
                      {status}
                    </button>
                  );
                })}
              </div>
              <Textarea small rows={1} placeholder="Observación" value={row.observacion} onChange={(event) => patch({ inspeccion: form.inspeccion.map((entry) => (entry.requisito === row.requisito ? { ...entry, observacion: event.target.value } : entry)) })} aria-label={`Observación: ${row.requisito}`} />
            </CampoValidado>
          ))}
        </div>
        <Field label="Observaciones generales" htmlFor="r-obs-insp" className="mt-5">
          <Textarea id="r-obs-insp" rows={2} value={form.inspeccionGeneral} onChange={(event) => patch({ inspeccionGeneral: event.target.value })} />
        </Field>
      </FormCard>

      <FormCard id="sec-aceptacion" title="Decisión de aceptación" description="Con la inspección completa se decide si la muestra entra al proceso. Sin decisión no se puede procesar.">
        <CampoValidado id="r-decision" className="mb-5">
          <ChoiceGrid cols={3}>
            {ACCEPTANCE_DECISIONS.map((decision) => (
              <ChoiceCard
                key={decision.value}
                type="radio"
                name="r-decision"
                checked={form.decision === decision.value}
                onChange={() => patch({ decision: decision.value })}
                label={decision.label}
                description={decision.hint}
                // ISO/IEC 17025 7.4.3: con un requisito en NC no se acepta sin desviación. Pulsarla explica por qué.
                bloqueada={decision.value === "aceptada" && hasNc ? bloqueoAceptada : undefined}
                invalida={decision.value === "aceptada" && aceptadaInvalida}
              />
            ))}
          </ChoiceGrid>
        </CampoValidado>
        {!inspectionComplete ? <Callout tone="warning" className="mb-4">Faltan requisitos por calificar en la inspección visual.</Callout> : null}
        {hasNc ? <Callout tone="danger" className="mb-4">Hay requisitos que no cumplen (NC): solo puede aceptarse con desviación o rechazarse.</Callout> : null}
        {form.decision ? (
          <div className="flex flex-col gap-4">
            <FormGrid cols={3}>
              <Field label="Fecha de la decisión" htmlFor="r-acep-fecha" required>
                <DateInput id="r-acep-fecha" value={form.aceptacionFecha} onChange={(value) => patch({ aceptacionFecha: value })} />
              </Field>
              <Field label="Responsable" htmlFor="r-acep-resp" required>
                <PersonSelect id="r-acep-resp" value={form.aceptacionResponsable} onChange={(name) => patch({ aceptacionResponsable: name })} requires="muestras" />
              </Field>
              <Field label="Temperatura de llegada" htmlFor="r-acep-temp" hint="Requisito: entre 4 y 10 °C.">
                <Input id="r-acep-temp" maxLength={20} placeholder="Ej. 6 °C" value={form.temperaturaLlegada} onChange={(event) => patch({ temperaturaLlegada: event.target.value })} />
              </Field>
            </FormGrid>
            <Field label="Observaciones de la decisión" htmlFor="r-acep-obs">
              <Textarea id="r-acep-obs" rows={2} value={form.aceptacionObservaciones} onChange={(event) => patch({ aceptacionObservaciones: event.target.value })} />
            </Field>
            {needsComunicacion ? (
              <Panel title="Comunicación al cliente (FX-MC 7.4.3)" description="La desviación o el rechazo se comunican al cliente antes de continuar. Si pide analizar de todos modos, el informe llevará el descargo correspondiente.">
                <FormGrid cols={4}>
                  <Field label="Fecha" htmlFor="r-com-fecha" required>
                    <DateInput id="r-com-fecha" value={form.comunicacion.fecha} onChange={(value) => patch({ comunicacion: { ...form.comunicacion, fecha: value } })} />
                  </Field>
                  <Field label="Medio" htmlFor="r-com-medio" required>
                    <Select id="r-com-medio" value={form.comunicacion.medio} onChange={(event) => patch({ comunicacion: { ...form.comunicacion, medio: event.target.value } })}>
                      <option value="">Seleccionar</option>
                      {CLIENT_CONTACT_MEDIA.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Persona contactada" htmlFor="r-com-persona">
                    <Input id="r-com-persona" maxLength={180} value={form.comunicacion.persona} onChange={(event) => patch({ comunicacion: { ...form.comunicacion, persona: event.target.value } })} />
                  </Field>
                  <Field label="Respuesta del cliente" htmlFor="r-com-resp" className="sm:col-span-2 lg:col-span-4">
                    <Textarea id="r-com-resp" rows={2} maxLength={240} placeholder="Ej. Solicita continuar con el análisis" value={form.comunicacion.respuesta} onChange={(event) => patch({ comunicacion: { ...form.comunicacion, respuesta: event.target.value } })} />
                  </Field>
                </FormGrid>
              </Panel>
            ) : null}
          </div>
        ) : null}
        {decisionMeta ? <Callout tone={decisionMeta.value === "rechazada" ? "danger" : decisionMeta.value === "aceptada_con_desviacion" ? "warning" : "success"} className="mt-4">Decisión actual: <span className="font-medium">{decisionMeta.label}</span>.</Callout> : null}
      </FormCard>

      <FormCard id="sec-solicitante" title="Datos del solicitante" description="Quien entrega la muestra firma de conformidad.">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
          <Field label="Nombre de quien entrega" htmlFor="r-sol-nombre">
            <Input id="r-sol-nombre" maxLength={150} value={form.solicitanteNombre} onChange={(event) => patch({ solicitanteNombre: event.target.value })} />
          </Field>
          {/* Fase 7: el informe lo toma como correo de contacto para su envío. */}
          <Field label="Correo del solicitante" htmlFor="r-sol-correo" hint="Se usa como correo de contacto del informe.">
            <Input id="r-sol-correo" type="email" maxLength={180} value={form.solicitanteCorreo} onChange={(event) => patch({ solicitanteCorreo: event.target.value })} />
          </Field>
          <Field label="Firma de conformidad">
            <CampoValidado id="r-sol-firma">
              <SignaturePad value={form.solicitanteFirma} onChange={(value) => patch({ solicitanteFirma: value })} label="Firma de conformidad del solicitante" compact />
            </CampoValidado>
          </Field>
        </div>
        <Panel className="mt-4">
          <CampoValidado id="r-conformidad">
          <Checkbox checked={form.conformidad} onChange={(event) => patch({ conformidad: event.target.checked })} label="He revisado la información registrada en este formato y afirmo que es correcta." description="Se han hecho de mi conocimiento las aclaraciones al final del formato y estoy de acuerdo con ellas. A partir de este momento no se realizan modificaciones a la solicitud del servicio." />
          </CampoValidado>
        </Panel>
      </FormCard>

      <FormCard id="sec-custodio" title="Custodio y resguardo" description="Personal que registra el ingreso y dónde se resguarda la muestra.">
        <div className="flex flex-col gap-5">
          <PersonCard title="Custodio" name={form.custodioNombre} onName={(v) => patch({ custodioNombre: v })} cargo={form.custodioCargo} onCargo={(v) => patch({ custodioCargo: v })} signature={form.custodioFirma} onSignature={(v) => patch({ custodioFirma: v })} />
          <FieldGroup label="Lugar de resguardo">
            <CampoValidado id="r-resguardo">
              <ChoiceGrid cols={4}>
                {STORAGE_PLACES.map(({ value, label }) => (
                  <ChoiceCard key={value} type="radio" name="r-resguardo" checked={form.custodioLugar === value} onChange={() => patch({ custodioLugar: value, custodioOtro: "" })} label={label} />
                ))}
              </ChoiceGrid>
            </CampoValidado>
            {/* El formato deja un espacio junto a cada opción: cuál congelador o refrigerador, o el detalle de "otro". */}
            {form.custodioLugar ? (
              <Input
                placeholder={form.custodioLugar === "congelador" ? "¿Cuál? CO1, CO2 o CO3" : form.custodioLugar === "refrigerador" ? "¿Cuál? RE1" : form.custodioLugar === "ingreso_analisis" ? "Analista o área que la recibe" : "Especificar"}
                maxLength={120}
                value={form.custodioOtro}
                onChange={(event) => patch({ custodioOtro: event.target.value })}
                aria-label="Detalle del lugar de resguardo"
                className="max-w-[360px]"
              />
            ) : null}
          </FieldGroup>
        </div>
      </FormCard>

    </FormPage>
  );
}
