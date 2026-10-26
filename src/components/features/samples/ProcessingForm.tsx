"use client";

import { formatearFolio } from "@/lib/shared/folios";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FloppyDisk, Plus } from "@phosphor-icons/react";
import { IncidenciasFormCard } from "@/components/features/calidad/IncidenciasDelRegistro";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/ui/Field";
import { DateInput } from "@/components/ui/DateInput";
import { EmptyState } from "@/components/ui/Primitives";
import { RecordHistory } from "@/components/features/audit/RecordHistory";
import { API_BASE_URL, getJsonAuth, sendJsonAuth } from "@/lib/client/api";
import { fmtDate, isoDate, parseFloatOrNull, parseIntOrNull, todayIso } from "@/lib/client/format";
import { filterManualInventario, findInsumoByAutoQuery, findInsumoOption, findUniqueOperativeEquipo, loadInsumoOptions, resolveFixedInventoryAmount, type InventarioRow } from "@/lib/client/insumos";
import { formatProcessingFolio, isSampleReadOnly, sampleStatusLabel } from "@/lib/client/samples";
import { formatActiveUserSignature } from "@/lib/client/session";
import { invalidate } from "@/lib/client/store";
import { estaHabilitada, usePuedeCrear } from "@/lib/client/puede";
import type { ApiRecord } from "@/lib/client/types";
import { Callout, ChoiceCard, ChoiceGrid, FormCard, FormPage, FormTable, PersonCard, StepRow, formTd, formTh, personaId, type FormSectionDef } from "./FormLayout";
import { CampoValidado, MensajeCampo, useValidacion } from "@/components/ui/Validacion";
import { msg, type Problema } from "@/lib/client/mensajes";
import { InsumoSearch, InventarioRows, collectInventarioRows, newInventarioRow } from "./InsumoSearch";
import { SolicitudCallout, SupervisionCallout } from "./status";
import { formatearHora } from "@/lib/shared/fechas";
import { AvisoAutorizacion, AvisoEdicionBloqueada } from "./AvisoAutorizacion";
import { requisitosProcesamiento } from "@/lib/shared/autorizaciones";
import { firmanteDe, firmantesPayload, type FirmanteState } from "./FirmanteSelect";

/* Formato de procesamiento de muestras (FX-TCF-GMP) como pagina completa. */

/*
 * Pasos tal como los lista el formato FX-TCF-GMP. El segundo elemento es el
 * texto que se guarda (los registros existentes dependen de el); el tercero,
 * el que se muestra.
 */
const BIVALVOS_STEPS: Array<[string, string, string]> = [
  ["procBiv1", "Seleccionar organismos de mayor talla (~30)", "Seleccionar los organismos de mayor talla (~10 organismos)"],
  ["procBiv2", "Lavar exterior con agua corriente", "Lavar el exterior con agua corriente"],
  ["procBiv3", "Abrir valvas", "Abrir las valvas"],
  ["procBiv4", "Lavar interior con agua corriente", "Lavar el interior con agua corriente"],
  ["procBiv5", "Desconchar", "Desconchar"],
  ["procBiv6", "Drenar 5 min", "Drenar 5 min"],
  ["procBiv7", "Moler 1-2 min 100-150g", "Moler 1 a 2 min (100 a 150 g)"],
  ["procBiv9", "Pesar molienda obtenida", "Pesar la molienda obtenida"],
  ["procBiv8", "Reservar molienda en bolsa hermetica", "Reservar molienda en bolsa hermética con etiqueta interna y externa"],
];
const SARDINAS_STEPS: Array<[string, string, string]> = [
  ["procSar1", "Seleccionar aprox. 10 organismos", "Seleccionar aprox. 10 organismos (para obtener una molienda de hasta 150 g)"],
  ["procSar2", "Partir organismos por la mitad", "Partir o trozar los organismos por la mitad"],
  ["procSar3", "Moler 1-2 min 100-150g", "Moler 1 a 2 min (100 a 150 g)"],
  ["procSar4", "Pesar molienda obtenida", "Pesar la molienda obtenida"],
  ["procSar5", "Reservar molienda en bolsa hermetica", "Reservar molienda en bolsa hermética con etiqueta interna y externa"],
];
const PARTES: Array<[string, string]> = [
  ["cuerpo_completo", "Cuerpo completo"],
  ["viscera", "Víscera"],
  ["sifon_callo", "Sifón / callo"],
  ["otro", "Otro"],
];
const RESGUARDO: Array<[string, string]> = [
  ["entregado_extraccion", "Entregado para extracción"],
  ["refrigerador_re1", "Refrigerador RE1"],
  ["congelador_co1", "Congelador CO1"],
  ["congelador_co2", "Congelador CO2"],
  ["congelador_co3", "Congelador CO3"],
];

interface LoteSelectionRow {
  item: ApiRecord;
  checked: boolean;
}

interface ProcessingForm {
  claveRevision: string;
  fechaEmision: string;
  tipoRegistro: string;
  estado: string;
  folio: string;
  fecha: string;
  hora: string;
  receptionId: string;
  muestraTipo: "unica" | "lote";
  muestraTipoDisabled: boolean;
  idInterno: string;
  loteRows: LoteSelectionRow[] | null;
  organismo: string;
  otroOrganismoText: string;
  partes: string[];
  otroParteText: string;
  steps: Record<string, boolean>;
  biv6Equipo: string;
  biv7Equipo: string;
  biv7Peso: string;
  biv9Equipo: string;
  biv9Peso: string;
  biv8Equipo: string;
  biv8Peso: string;
  biv8BolsaRef: string;
  sar3Equipo: string;
  sar3Peso: string;
  sar4Equipo: string;
  sar4Peso: string;
  sar5BolsaRef: string;
  otroProcesamiento: string;
  resguardo: Record<string, boolean>;
  observaciones: string;
  quienProceso: string;
  firmaProceso: string;
  quienSuperviso: string;
  firmaSuperviso: string;
  inventarioRows: InventarioRow[];
}

const defaultForm = (): ProcessingForm => ({
  claveRevision: "FX-TCF-GMP",
  fechaEmision: todayIso(),
  tipoRegistro: "P",
  estado: "registrada",
  folio: "",
  fecha: todayIso(),
  hora: formatearHora(new Date()),
  receptionId: "",
  muestraTipo: "unica",
  muestraTipoDisabled: false,
  idInterno: "",
  loteRows: null,
  organismo: "",
  otroOrganismoText: "",
  partes: [],
  otroParteText: "",
  steps: {},
  biv6Equipo: "",
  biv7Equipo: "",
  biv7Peso: "",
  biv9Equipo: "",
  biv9Peso: "",
  biv8Equipo: "",
  biv8Peso: "",
  biv8BolsaRef: "",
  sar3Equipo: "",
  sar3Peso: "",
  sar4Equipo: "",
  sar4Peso: "",
  sar5BolsaRef: "",
  otroProcesamiento: "",
  resguardo: {},
  observaciones: "",
  quienProceso: formatActiveUserSignature(),
  firmaProceso: "",
  quienSuperviso: "",
  firmaSuperviso: "",
  inventarioRows: [],
});

/* Prellena la bolsa del protocolo y el equipo operativo único de cada paso (cronómetro, licuadora, balanza). Solo llena huecos. */
const autoResolve = (current: ProcessingForm): ProcessingForm => {
  const next = { ...current };
  for (const key of ["biv8BolsaRef", "sar5BolsaRef"] as const) {
    const value = String(current[key] || "").trim();
    if (!value || !findInsumoOption("consumible", value)) {
      const match = findInsumoByAutoQuery("consumible", "bolsa hermetica");
      if (match) next[key] = match.ref;
    }
  }
  const EQUIPOS: Array<[keyof ProcessingForm, string]> = [
    ["biv6Equipo", "Cronómetro"],
    ["biv7Equipo", "Licuadora"],
    ["biv9Equipo", "Balanza"],
    ["biv8Equipo", "Balanza"],
    ["sar3Equipo", "Licuadora"],
    ["sar4Equipo", "Balanza"],
  ];
  for (const [key, query] of EQUIPOS) {
    if (String(current[key] || "").trim()) continue;
    const match = findUniqueOperativeEquipo(query);
    if (match) (next as Record<string, unknown>)[key] = match.ref;
  }
  return next;
};

const buildProtocolInventario = (current: ProcessingForm) => {
  const result: Array<{ tipo: string; ref: string; cantidad: number }> = [];
  for (const [key, step] of [
    ["biv8BolsaRef", "procBiv8"],
    ["sar5BolsaRef", "procSar5"],
  ] as Array<["biv8BolsaRef" | "sar5BolsaRef", string]>) {
    if (!current.steps[step]) continue;
    const ref = String(current[key] || "").trim();
    if (!ref) continue;
    const resolved = resolveFixedInventoryAmount({ cantidadFija: 1, cantidadUnidad: "pieza" }, findInsumoOption("consumible", ref));
    result.push({ tipo: "consumible", ref, cantidad: resolved?.amount || 1 });
  }
  return result;
};

const formFromItem = (item: ApiRecord): ProcessingForm => {
  const steps: Record<string, boolean> = {};
  const names = (list: unknown) => (Array.isArray(list) ? list : []).map((step: ApiRecord | string) => (typeof step === "string" ? step : step.step));
  const bivalvos = names(item.bivalvos_steps);
  const sardinas = names(item.sardinas_steps);
  BIVALVOS_STEPS.forEach(([id, value]) => (steps[id] = bivalvos.includes(value)));
  SARDINAS_STEPS.forEach(([id, value]) => (steps[id] = sardinas.includes(value)));
  const stepObj = (arr: unknown, name: string): ApiRecord | null => ((Array.isArray(arr) ? arr : []).find((s) => typeof s === "object" && s && s.step === name) as ApiRecord) || null;
  const biv6 = stepObj(item.bivalvos_steps, "Drenar 5 min");
  const biv7 = stepObj(item.bivalvos_steps, "Moler 1-2 min 100-150g");
  const biv8 = stepObj(item.bivalvos_steps, "Reservar molienda en bolsa hermetica");
  // Registros anteriores guardaban balanza y peso en "Reservar"; ahora viven en el paso "Pesar".
  const biv9 = stepObj(item.bivalvos_steps, "Pesar molienda obtenida") || (biv8 && (biv8.peso !== null && biv8.peso !== undefined) ? biv8 : null);
  if (biv9 && !steps.procBiv9 && bivalvos.includes("Reservar molienda en bolsa hermetica")) steps.procBiv9 = true;
  const sar3 = stepObj(item.sardinas_steps, "Moler 1-2 min 100-150g");
  const sar4 = stepObj(item.sardinas_steps, "Pesar molienda obtenida");
  const res = item.resguardo || {};
  return {
    ...defaultForm(),
    claveRevision: item.clave_revision || "FX-TCF-GMP",
    fechaEmision: isoDate(item.fecha_emision),
    tipoRegistro: item.tipo_registro || "P",
    folio: item.folio_num ? String(item.folio_num) : "",
    fecha: isoDate(item.fecha_procesamiento),
    hora: item.hora_procesamiento || "",
    estado: item.estado || "registrada",
    receptionId: item.recepcion_id ? String(item.recepcion_id) : "",
    muestraTipo: item.muestra_tipo === "lote" ? "lote" : "unica",
    idInterno: item.id_interno || "",
    organismo: Array.isArray(item.tipo_organismo) ? item.tipo_organismo[0] || "" : "",
    otroOrganismoText: item.tipo_organismo_otro || "",
    partes: Array.isArray(item.parte_organismo) ? item.parte_organismo : [],
    otroParteText: item.parte_organismo_otro || "",
    steps,
    biv6Equipo: biv6?.equipo_id ? String(biv6.equipo_id) : "",
    biv9Equipo: biv9?.equipo_id ? String(biv9.equipo_id) : "",
    biv9Peso: biv9?.peso ?? "",
    biv7Equipo: biv7?.equipo_id ? String(biv7.equipo_id) : "",
    biv8Equipo: biv8?.equipo_id ? String(biv8.equipo_id) : "",
    sar3Equipo: sar3?.equipo_id ? String(sar3.equipo_id) : "",
    sar4Equipo: sar4?.equipo_id ? String(sar4.equipo_id) : "",
    biv7Peso: biv7?.peso ?? "",
    biv8Peso: biv8?.peso ?? "",
    sar3Peso: sar3?.peso ?? "",
    sar4Peso: sar4?.peso ?? "",
    otroProcesamiento: item.otro_procesamiento || "",
    resguardo: Object.fromEntries(RESGUARDO.map(([key]) => [key, !!res[key]])),
    observaciones: item.observaciones_generales || "",
    quienProceso: item.nombre_quien_proceso || "",
    quienSuperviso: item.nombre_quien_superviso || "",
    firmaProceso: item.firma_quien_proceso || "",
    firmaSuperviso: item.firma_quien_superviso || "",
  };
};

const SECTIONS: FormSectionDef[] = [
  { id: "sec-datos", label: "Datos generales" },
  { id: "sec-muestra", label: "Muestra" },
  { id: "sec-organismo", label: "Organismo" },
  { id: "sec-proceso", label: "Procesamiento" },
  { id: "sec-resguardo", label: "Resguardo" },
  { id: "sec-insumos", label: "Insumos adicionales", optional: true },
  { id: "sec-personal", label: "Personal" },
];

export function ProcessingForm({ item, prefillReceptionId }: { item: ApiRecord | null; prefillReceptionId?: number | null }) {
  const router = useRouter();
  const { token, can } = useSession();
  const puedeCrear = usePuedeCrear();
  const [form, setForm] = useState<ProcessingForm>(() => (item ? formFromItem(item) : defaultForm()));
  // Fase 5: firmas ligadas a cuentas (procesó, supervisó).
  const [firmantes, setFirmantes] = useState<Record<string, FirmanteState>>(() => ({ proceso: firmanteDe(item, "proceso"), superviso: firmanteDe(item, "superviso") }));
  const firmante = (rol: string) => ({ nuevo: !item?.id, firmante: firmantes[rol], onFirmante: (v: FirmanteState) => setFirmantes((prev) => ({ ...prev, [rol]: v })) });
  const [receptions, setReceptions] = useState<ApiRecord[]>([]);
  const [equipos, setEquipos] = useState<ApiRecord[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const detailCache = useRef(new Map<number, ApiRecord>());
  const editing = !!item?.id;
  const canEdit = editing ? estaHabilitada(item, "editar", can("ensayos", "E", { objeto: "procesamiento", borrador: String(item?.estado || "registrada") === "registrada" })) : puedeCrear("procesamiento", can("ensayos", "C", { objeto: "procesamiento", borrador: true }));
  // Con una solicitud de autorizacion pendiente (Fase 3) el registro no se edita.
  const readOnly = editing && (isSampleReadOnly(item?.estado) || !canEdit || !!item?.solicitud_pendiente);
  const patch = (changes: Partial<ProcessingForm>) => setForm((prev) => ({ ...prev, ...changes }));
  const stepKeys = form.organismo === "bivalvos" ? BIVALVOS_STEPS.map(([k]) => k) : form.organismo === "sardinas" ? SARDINAS_STEPS.map(([k]) => k) : [];
  const procesoId = personaId("Quien procesó");
  const supervisoId = personaId("Quien supervisó");
  /* Reglas del formato, en orden: dan la completitud de la guía, el aviso del encabezado y el pop-up al guardar. */
  const reglas = (): Problema[] => {
    const out: Problema[] = [];
    const en = (seccion: string, grupo: string) => (campo: string, mensaje: string) => out.push({ campo, mensaje, seccion, grupo });
    const datos = en("sec-datos", "Datos generales");
    if (!form.folio) datos("p-folio", msg.indica("el folio de procesamiento"));
    if (!form.fecha) datos("p-fecha", msg.indica("la fecha de procesamiento"));
    if (!form.hora) datos("p-hora", msg.indica("la hora de procesamiento"));
    const mu = en("sec-muestra", "Muestra");
    if (!form.receptionId) mu("p-recepcion", msg.elige("la recepción de origen"));
    if (form.muestraTipo === "lote") {
      if (!form.loteRows?.some((r) => r.checked)) mu("p-lote", msg.marca("al menos una muestra del lote"));
    } else if (!form.idInterno.trim()) mu("p-id", msg.indica("el ID interno de la muestra"));
    const org = en("sec-organismo", "Organismo");
    if (!form.organismo) org("p-organismo", msg.elige("el tipo de organismo"));
    else if (form.organismo === "otro" && !form.otroOrganismoText.trim()) org("p-organismo-otro", msg.indica("el tipo de organismo"));
    if (!form.partes.length) org("p-partes", msg.marca("al menos una parte del organismo"));
    const proc = en("sec-proceso", "Procesamiento");
    if (form.organismo === "otro") {
      if (!form.otroProcesamiento.trim()) proc("p-otro", msg.escribe("el procedimiento aplicado"));
    } else if (!stepKeys.length || !stepKeys.some((k) => form.steps[k])) proc("p-pasos", form.organismo ? msg.marca("al menos un paso realizado") : msg.elige("primero el tipo de organismo"));
    if (!Object.values(form.resguardo).some(Boolean)) en("sec-resguardo", "Resguardo")("p-resguardo", msg.elige("dónde queda la molienda"));
    const per = en("sec-personal", "Personal");
    if (!form.quienProceso.trim()) per(procesoId, msg.elige("a quien procesó"));
    if (!form.quienSuperviso.trim()) per(supervisoId, msg.elige("a quien supervisó"));
    return out;
  };
  const v = useValidacion({ titulo: editing ? "No se pudo guardar el procesamiento" : "No se pudo registrar el procesamiento", reglas: readOnly ? () => [] : reglas });
  // Opcional: verde solo cuando hay insumos con referencia; si no, queda sin evaluar.
  const optionalDone: Record<string, boolean | undefined> = { "sec-insumos": form.inventarioRows.some((row) => (row.ref || row.nombre || "").trim()) ? true : undefined };
  const sections: FormSectionDef[] = [...SECTIONS, ...(editing ? [{ id: "sec-historial", label: "Historial", optional: true }] : [])].map((section) => ({ ...section, complete: readOnly ? undefined : section.optional ? optionalDone[section.id] : v.seccionCompleta(section.id) }));
  const camposServidor = { folio: "p-folio", id_interno: "p-id", "firma:proceso": procesoId, "firma:superviso": supervisoId };
  const ubicacionServidor = { folio: { seccion: "sec-datos", grupo: "Datos generales" }, id_interno: { seccion: "sec-muestra", grupo: "Muestra" }, "firma:proceso": { seccion: "sec-personal", grupo: "Personal" }, "firma:superviso": { seccion: "sec-personal", grupo: "Personal" } };

  const receptionDetail = async (id: number): Promise<ApiRecord | null> => {
    const cached = detailCache.current.get(id);
    if (cached) return cached;
    const data = await getJsonAuth(`${API_BASE_URL}/samples/reception/${id}`, token);
    const detail = (data.item || null) as ApiRecord | null;
    if (detail) detailCache.current.set(id, detail);
    return detail;
  };

  const applyReception = (reception: ApiRecord | null, selected: ApiRecord[] = []) => {
    if (!reception) {
      patch({ muestraTipo: "unica", muestraTipoDisabled: false, idInterno: "", loteRows: null });
      return;
    }
    if (reception.muestra_unica) {
      patch({ muestraTipo: "unica", muestraTipoDisabled: true, idInterno: reception.id_interno || "", loteRows: null });
      return;
    }
    const selectedIds = new Set(selected.map((row) => String(row.id_interno || "")).filter(Boolean));
    const items: ApiRecord[] = Array.isArray(reception.lote_muestras) ? reception.lote_muestras : [];
    const loteRows = items.map((entry) => ({ item: entry, checked: selectedIds.size ? selectedIds.has(String(entry.id_interno || "").trim()) : entry.trabajar !== false }));
    patch({ muestraTipo: "lote", muestraTipoDisabled: true, loteRows, idInterno: joinIds(loteRows) });
  };

  const joinIds = (rows: LoteSelectionRow[] | null) =>
    (rows || [])
      .filter((row) => row.checked)
      .map((row) => String(row.item.id_interno || "").trim())
      .filter(Boolean)
      .join(", ");

  const selectReception = async (value: string, selected: ApiRecord[] = []) => {
    const id = parseIntOrNull(value);
    if (!id) return applyReception(null);
    try {
      applyReception(await receptionDetail(id), selected);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo leer la recepción");
      applyReception(null);
    }
  };

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const empty: ApiRecord = {};
      const [eq, rec] = await Promise.all([getJsonAuth(`${API_BASE_URL}/inventory/equipos`, token).catch(() => empty), getJsonAuth(`${API_BASE_URL}/samples/reception?search=`, token).catch(() => empty)]);
      if (cancelled) return;
      setEquipos((eq.items || []) as ApiRecord[]);
      setReceptions((rec.items || []) as ApiRecord[]);
      await loadInsumoOptions();
      if (cancelled) return;
      if (item) {
        if (item.recepcion_id) {
          await selectReception(String(item.recepcion_id), item.lote_seleccion || []);
          if (cancelled) return;
          if ((item.muestra_tipo || "") === "unica") patch({ idInterno: item.id_interno || "" });
        }
        setForm((prev) => {
          const resolved = autoResolve(prev);
          const manual = filterManualInventario((item.uso_inventario || []) as ApiRecord[], buildProtocolInventario(resolved));
          return { ...resolved, inventarioRows: manual.map((row) => newInventarioRow(row.tipo || "consumible", row.ref || row.nombre || "", row.cantidad ?? 1, row.nombre)) };
        });
        return;
      }
      setForm((prev) => autoResolve(prev));
      try {
        const data = await getJsonAuth(`${API_BASE_URL}/samples/processing/next-folio`, token);
        if (!cancelled) patch({ folio: data.next_folio ? String(data.next_folio) : "" });
      } catch {
        /* sin folio sugerido */
      }
      if (prefillReceptionId) {
        patch({ receptionId: String(prefillReceptionId) });
        await selectReception(String(prefillReceptionId));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, item, prefillReceptionId]);

  const isLote = form.muestraTipo === "lote";
  const setStep = (id: string, checked: boolean) => patch({ steps: { ...form.steps, [id]: checked } });

  const buildPayload = (current: ProcessingForm) => {
    const selected = current.receptionId ? receptions.find((row) => String(row.id) === current.receptionId) : undefined;
    const lote = current.muestraTipo === "lote"
      ? (current.loteRows || [])
          .filter((row) => row.checked)
          .map((row) => ({
            trabajar: true,
            id_interno: String(row.item.id_interno || "").trim() || null,
            nombre_organismo: String(row.item.nombre_organismo || "").trim() || null,
            cantidad_volumen: String(row.item.cantidad_volumen || "").trim() || null,
            sitio_muestreo: String(row.item.sitio_muestreo || "").trim() || null,
            fecha_muestra: row.item.fecha_muestra || null,
            informacion_adicional: String(row.item.informacion_adicional || "").trim() || null,
          }))
      : [];
    const stepObjects = (list: Array<[string, string, string]>, extras: Record<string, { equipo: string; peso: string }>) =>
      list.filter(([id]) => !!current.steps[id]).map(([id, value]) => ({ step: value, equipo_id: extras[id] ? parseIntOrNull(extras[id].equipo) : null, peso: extras[id] ? parseFloatOrNull(extras[id].peso) : null }));
    return {
      folio_num: parseIntOrNull(current.folio),
      tipo_registro: current.tipoRegistro.trim() || "P",
      clave_revision: current.claveRevision.trim() || "FX-TCF-GMP",
      fecha_emision: current.fechaEmision || null,
      fecha_procesamiento: current.fecha || null,
      hora_procesamiento: current.hora || null,
      recepcion_id: parseIntOrNull(current.receptionId),
      folio_recepcion_num: parseIntOrNull(selected?.folio_num),
      muestra_tipo: current.muestraTipo || null,
      id_interno: (current.muestraTipo === "lote" ? lote.map((r) => r.id_interno).filter(Boolean).join(", ") : current.idInterno).trim() || null,
      lote_seleccion: lote,
      tipo_organismo: current.organismo ? [current.organismo] : [],
      parte_organismo: PARTES.map(([v]) => v).filter((v) => current.partes.includes(v)),
      tipo_organismo_otro: current.organismo === "otro" ? current.otroOrganismoText.trim() || null : null,
      parte_organismo_otro: current.partes.includes("otro") ? current.otroParteText.trim() || null : null,
      bivalvos_steps: stepObjects(BIVALVOS_STEPS, { procBiv6: { equipo: current.biv6Equipo, peso: "" }, procBiv7: { equipo: current.biv7Equipo, peso: current.biv7Peso }, procBiv9: { equipo: current.biv9Equipo, peso: current.biv9Peso }, procBiv8: { equipo: current.biv8Equipo, peso: current.biv8Peso } }),
      sardinas_steps: stepObjects(SARDINAS_STEPS, { procSar3: { equipo: current.sar3Equipo, peso: current.sar3Peso }, procSar4: { equipo: current.sar4Equipo, peso: current.sar4Peso } }),
      otro_procesamiento: current.organismo === "otro" ? current.otroProcesamiento.trim() || null : null,
      resguardo: Object.fromEntries(RESGUARDO.map(([key]) => [key, !!current.resguardo[key]])),
      observaciones_generales: current.observaciones.trim() || null,
      nombre_quien_proceso: current.quienProceso.trim() || null,
      nombre_quien_superviso: current.quienSuperviso.trim() || null,
      firma_quien_proceso: current.firmaProceso.trim() || null,
      firma_quien_superviso: current.firmaSuperviso.trim() || null,
      estado: current.estado || "registrada",
      uso_inventario: [...buildProtocolInventario(current), ...collectInventarioRows(current.inventarioRows)],
    };
  };

  const handleSave = async () => {
    if (!v.validar()) return;
    if (!canEdit) return v.avisar({ que: "No tienes permiso para guardar este procesamiento.", hacer: "Pide a la administración que revise tus roles y permisos." });
    await loadInsumoOptions();
    const current = autoResolve(form);
    setForm(current);
    const payload = { ...buildPayload(current), firmantes: firmantesPayload(firmantes) };
    setSubmitting(true);
    try {
      if (editing) {
        await sendJsonAuth("PUT", `${API_BASE_URL}/samples/processing/${item!.id}`, token, payload);
        toast.success("Procesamiento actualizado");
      } else {
        await sendJsonAuth("POST", `${API_BASE_URL}/samples/processing`, token, payload);
        toast.success("Procesamiento registrado. Inventario descontado.");
      }
      invalidate("muestras", "movimientos", "consumibles", "reactivos", "dashboard");
      router.push("/muestras/procesamiento");
    } catch (err) {
      v.errorServidor(err, camposServidor, ubicacionServidor);
      setSubmitting(false);
    }
  };

  const equipoSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <Select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
      <option value="">{label}</option>
      {equipos.map((eq) => (
        <option key={eq.id} value={eq.id}>
          {[eq.nombre || "Equipo", eq.marca, eq.modelo].filter(Boolean).join(" · ")}
        </option>
      ))}
    </Select>
  );

  const pesoInput = (value: string, onChange: (v: string) => void, placeholder: string) => <Input type="number" min="0" step="0.01" inputMode="decimal" placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} aria-label={placeholder} />;

  return (
    <FormPage
      backHref="/muestras/procesamiento"
      backLabel="Procesamientos"
      code="FX-TCF-GMP"
      title={editing ? `Procesamiento ${formatProcessingFolio(item!)}` : "Nuevo procesamiento"}
      status={sampleStatusLabel(form.estado)}
      statusTone={readOnly ? "danger" : "brand"}
      sections={sections}
      validacion={v}
      readOnly={readOnly}
      after={
        editing ? (
          <>
            <IncidenciasFormCard entidad="muestras_procesamiento" id={item?.id} etiqueta={formatProcessingFolio(item!)} />
            <FormCard id="sec-historial" title="Historial del registro" description="Bitácora de auditoría: quién creó, editó, anuló o restauró este procesamiento y qué cambió.">
              <RecordHistory entidad="muestras_procesamiento" entidadId={item?.id as number | undefined} />
            </FormCard>
          </>
        ) : null
      }
      actions={
        <>
          <Button variant="secondary" onClick={() => router.push("/muestras/procesamiento")}>
            {readOnly ? "Volver" : "Cancelar"}
          </Button>
          {!readOnly ? (
            <Button onClick={handleSave} loading={submitting} icon={<FloppyDisk size={16} />}>
              {editing ? "Guardar cambios" : "Registrar procesamiento"}
            </Button>
          ) : null}
        </>
      }
    >
      <SupervisionCallout item={item} />
      <SolicitudCallout item={item} />
      <AvisoEdicionBloqueada item={item} cerrado={!editing || isSampleReadOnly(item?.estado)} />
      {!readOnly ? <AvisoAutorizacion requisitos={requisitosProcesamiento()} /> : null}
      {readOnly && item?.motivo_anulacion ? (
        <Callout tone="danger" title="Registro anulado">
          Motivo: {String(item.motivo_anulacion)}
          {item.anulado_cargo ? ` · Anuló como ${String(item.anulado_cargo)}` : ""}
        </Callout>
      ) : null}
      <FormCard id="sec-datos" title="Datos generales" description="Folio, fecha y recepción de origen.">
        <FormGrid cols={4}>
          <Field label="Folio P" htmlFor="p-folio" required>
            <Input id="p-folio" type="number" min="1" inputMode="numeric" value={form.folio} onChange={(event) => patch({ folio: event.target.value })} mono />
          </Field>
          <Field label="Fecha" htmlFor="p-fecha" required>
            <DateInput id="p-fecha" value={form.fecha} onChange={(value) => patch({ fecha: value })} />
          </Field>
          <Field label="Hora" htmlFor="p-hora" required>
            <Input id="p-hora" type="time" value={form.hora} onChange={(event) => patch({ hora: event.target.value })} />
          </Field>
          <Field label="Recepción (FX-TCF-GMR)" htmlFor="p-recepcion" hint="Al vincular se cargan las muestras.">
            <Select
              id="p-recepcion"
              value={form.receptionId}
              onChange={(event) => {
                patch({ receptionId: event.target.value });
                void selectReception(event.target.value);
              }}
            >
              <option value="">Sin vincular</option>
              {receptions.filter((option) => String(option.id) === form.receptionId || (["aceptada", "aceptada_con_desviacion"].includes(String(option.decision_aceptacion || "")) && String(option.estado) !== "anulada")).map((option) => (
                <option key={option.id} value={option.id}>
                  {formatearFolio("R", option.folio_num)} · {option.solicitante || option.id_interno || "Sin solicitante"}
                </option>
              ))}
            </Select>
          </Field>
        </FormGrid>
      </FormCard>

      <FormCard id="sec-muestra" title="Muestra" description={form.muestraTipoDisabled ? "El tipo lo define la recepción vinculada." : "Muestra única o lote."}>
        <ChoiceGrid cols={2} className="mb-5">
          <ChoiceCard type="radio" name="p-tipo" checked={!isLote} disabled={form.muestraTipoDisabled} onChange={() => patch({ muestraTipo: "unica" })} label="Muestra única" description="Un ID interno." />
          <ChoiceCard type="radio" name="p-tipo" checked={isLote} disabled={form.muestraTipoDisabled} onChange={() => patch({ muestraTipo: "lote", idInterno: joinIds(form.loteRows) })} label="Lote" description="Selecciona qué muestras se procesan." />
        </ChoiceGrid>
        {!isLote ? (
          <Field label="ID interno" htmlFor="p-id" required>
            <Input id="p-id" maxLength={100} value={form.idInterno} onChange={(event) => patch({ idInterno: event.target.value })} mono className="max-w-sm" />
          </Field>
        ) : form.loteRows === null ? (
          <EmptyState compact title="Vincula una recepción" description="Selecciona el folio de recepción para cargar las muestras del lote." />
        ) : !form.loteRows.length ? (
          <EmptyState compact title="Sin muestras de lote" description="La recepción vinculada no contiene muestras de lote." />
        ) : (
          <CampoValidado id="p-lote">
          <FormTable minWidth={640}>
            <thead>
                <tr>
                  <th className={cn(formTh, "w-16 text-center")}>Trabajar</th>
                  <th className={formTh}>ID interno</th>
                  <th className={formTh}>Organismo</th>
                  <th className={formTh}>Cantidad</th>
                  <th className={formTh}>Sitio</th>
                  <th className={formTh}>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {form.loteRows.map((row, index) => (
                  <tr key={`${row.item.id_interno}-${index}`} className={row.checked ? "" : "text-ink-3"}>
                    <td className={cn(formTd, "text-center")}>
                      <Checkbox
                        className="inline-flex"
                        aria-label="Trabajar"
                        checked={row.checked}
                        onChange={(event) => {
                          const rows = (form.loteRows || []).map((entry, i) => (i === index ? { ...entry, checked: event.target.checked } : entry));
                          patch({ loteRows: rows, idInterno: joinIds(rows) });
                        }}
                      />
                    </td>
                    <td className={cn(formTd, "code")}>{String(row.item.id_interno || "").trim() || `Muestra ${index + 1}`}</td>
                    <td className={formTd}>{row.item.nombre_organismo || "-"}</td>
                    <td className={formTd}>{row.item.cantidad_volumen || "-"}</td>
                    <td className={formTd}>{row.item.sitio_muestreo || "-"}</td>
                    <td className={formTd}>{fmtDate(row.item.fecha_muestra)}</td>
                  </tr>
                ))}
              </tbody>
            </FormTable>
          </CampoValidado>
        )}
      </FormCard>

      <FormCard id="sec-organismo" title="Organismo" description="Tipo de organismo y parte a procesar.">
        <div className="grid gap-6 lg:grid-cols-2">
          <CampoValidado id="p-organismo" className="flex flex-col gap-2">
            <p className="text-sm font-medium text-ink-2">Tipo de organismo</p>
            {(
              [
                ["bivalvos", "Bivalvos", "Moluscos: lavado, desconche, drenado y molienda."],
                ["sardinas", "Sardinas", "Peces: trozado y molienda del tejido."],
                ["otro", "Otro", "Describe el procedimiento aplicado."],
              ] as Array<[string, string, string]>
            ).map(([value, label, description]) => (
              <ChoiceCard key={value} type="radio" name="p-organismo" checked={form.organismo === value} onChange={() => patch({ organismo: value })} label={label} description={description} />
            ))}
            {form.organismo === "otro" ? (
              <>
                <Input id="p-organismo-otro" placeholder="Especificar tipo de organismo" value={form.otroOrganismoText} onChange={(event) => patch({ otroOrganismoText: event.target.value })} aria-label="Otro organismo" />
                <MensajeCampo id="p-organismo-otro" />
              </>
            ) : null}
          </CampoValidado>
          <CampoValidado id="p-partes" className="flex flex-col gap-2">
            <p className="text-sm font-medium text-ink-2">Parte del organismo</p>
            {PARTES.map(([value, label]) => (
              <ChoiceCard key={value} checked={form.partes.includes(value)} onChange={(checked) => patch({ partes: checked ? [...form.partes.filter((v) => v !== value), value] : form.partes.filter((v) => v !== value) })} label={label} />
            ))}
            {form.partes.includes("otro") ? <Input placeholder="Especificar otra parte" value={form.otroParteText} onChange={(event) => patch({ otroParteText: event.target.value })} aria-label="Otra parte" /> : null}
          </CampoValidado>
        </div>
      </FormCard>

      <FormCard id="sec-proceso" title="Procesamiento" description={form.organismo ? "Marca los pasos realizados y registra equipo y peso donde aplique." : "Selecciona el tipo de organismo para ver los pasos."}>
        {form.organismo === "bivalvos" ? (
          <CampoValidado id="p-pasos" className="flex flex-col">
            {BIVALVOS_STEPS.map(([id, , label], index) => (
              <StepRow key={id} number={index + 1} label={label} checked={!!form.steps[id]} onCheckedChange={(checked) => setStep(id, checked)}>
                {id === "procBiv6" && form.steps[id] ? equipoSelect(form.biv6Equipo, (v) => patch({ biv6Equipo: v }), "Cronómetro (CR)") : null}
                {id === "procBiv7" && form.steps[id] ? equipoSelect(form.biv7Equipo, (v) => patch({ biv7Equipo: v }), "Licuadora (LC)") : null}
                {id === "procBiv9" && form.steps[id] ? (
                  <>
                    {equipoSelect(form.biv9Equipo, (v) => patch({ biv9Equipo: v }), "Balanza (BA)")}
                    {pesoInput(form.biv9Peso, (v) => patch({ biv9Peso: v }), "Peso de la molienda (g)")}
                  </>
                ) : null}
                {id === "procBiv8" && form.steps[id] ? <InsumoSearch tipo="consumible" value={form.biv8BolsaRef} onChange={(ref) => patch({ biv8BolsaRef: ref })} placeholder="Bolsa hermética (se descuenta 1 pieza)" /> : null}
              </StepRow>
            ))}
          </CampoValidado>
        ) : form.organismo === "sardinas" ? (
          <CampoValidado id="p-pasos" className="flex flex-col">
            {SARDINAS_STEPS.map(([id, , label], index) => (
              <StepRow key={id} number={index + 1} label={label} checked={!!form.steps[id]} onCheckedChange={(checked) => setStep(id, checked)}>
                {id === "procSar3" && form.steps[id] ? equipoSelect(form.sar3Equipo, (v) => patch({ sar3Equipo: v }), "Licuadora (LC)") : null}
                {id === "procSar4" && form.steps[id] ? (
                  <>
                    {equipoSelect(form.sar4Equipo, (v) => patch({ sar4Equipo: v }), "Balanza (BA)")}
                    {pesoInput(form.sar4Peso, (v) => patch({ sar4Peso: v }), "Peso de la molienda (g)")}
                  </>
                ) : null}
                {id === "procSar5" && form.steps[id] ? <InsumoSearch tipo="consumible" value={form.sar5BolsaRef} onChange={(ref) => patch({ sar5BolsaRef: ref })} placeholder="Bolsa hermética (se descuenta 1 pieza)" /> : null}
              </StepRow>
            ))}
          </CampoValidado>
        ) : form.organismo === "otro" ? (
          <Field label="Procedimiento aplicado" htmlFor="p-otro">
            <Textarea id="p-otro" rows={4} placeholder="Describe el proceso de preparación para este organismo" value={form.otroProcesamiento} onChange={(event) => patch({ otroProcesamiento: event.target.value })} />
          </Field>
        ) : (
          <CampoValidado id="p-pasos">
            <EmptyState compact title="Sin organismo seleccionado" description="Elige bivalvos, sardinas u otro en la sección anterior." />
          </CampoValidado>
        )}
      </FormCard>

      <FormCard id="sec-resguardo" title="Resguardo de la molienda" description="Dónde queda la molienda al terminar.">
        <CampoValidado id="p-resguardo">
          <ChoiceGrid>
            {RESGUARDO.map(([key, label]) => (
              <ChoiceCard key={key} checked={!!form.resguardo[key]} onChange={(checked) => patch({ resguardo: { ...form.resguardo, [key]: checked } })} label={label} />
            ))}
          </ChoiceGrid>
        </CampoValidado>
        <Field label="Observaciones generales" htmlFor="p-obs" className="mt-5">
          <Textarea id="p-obs" rows={3} value={form.observaciones} onChange={(event) => patch({ observaciones: event.target.value })} />
        </Field>
      </FormCard>

      <FormCard
        id="sec-insumos"
        title="Insumos adicionales"
        description="Reactivos y consumibles usados fuera del protocolo. Se descuentan del inventario al guardar."
        aside={
          <Button variant="secondary" size="sm" icon={<Plus size={14} weight="bold" />} onClick={() => patch({ inventarioRows: [...form.inventarioRows, newInventarioRow()] })}>
            Agregar insumo
          </Button>
        }
      >
        <InventarioRows rows={form.inventarioRows} onChange={(rows) => patch({ inventarioRows: rows })} />
      </FormCard>

      <FormCard id="sec-personal" title="Personal responsable" description="Quién procesó y quién supervisó.">
        <div className="flex flex-col gap-3">
          {/* El formato oficial pide nombre y firma; el cargo no se guarda en este registro. */}
          <PersonCard title="Quien procesó" {...firmante("proceso")} name={form.quienProceso} onName={(v) => patch({ quienProceso: v })} signature={form.firmaProceso} onSignature={(v) => patch({ firmaProceso: v })} />
          <PersonCard title="Quien supervisó" requires="revision" {...firmante("superviso")} firmanteSesion={false} name={form.quienSuperviso} onName={(v) => patch({ quienSuperviso: v })} signature={form.firmaSuperviso} onSignature={(v) => patch({ firmaSuperviso: v })} />
        </div>
        <Callout tone="info" className="mt-4">Recuerda registrar el uso de cada equipo en su bitácora correspondiente.</Callout>
      </FormCard>
    </FormPage>
  );
}
