"use client";

import { formatearFolio } from "@/lib/shared/folios";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FloppyDisk, Plus } from "@phosphor-icons/react";
import { AvisoSuspension } from "@/components/features/calidad/AvisoSuspension";
import { IncidenciasFormCard } from "@/components/features/calidad/IncidenciasDelRegistro";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/Field";
import { DateInput } from "@/components/ui/DateInput";
import { useConfirm } from "@/components/ui/Overlay";
import { cn } from "@/components/ui/cn";
import { controlClassSm } from "@/components/ui/Field";
import { API_BASE_URL, getJsonAuth, sendJsonAuth } from "@/lib/client/api";
import { isoDate, parseFloatOrNull, parseIntOrNull, todayIso } from "@/lib/client/format";
import { equipoAlert, filterManualInventario, findInsumoByAutoQuery, findInsumoOption, findReactivoByRef, findUniqueOperativeEquipo, formatInventoryAmount, loadInsumoOptions, nextBitacoraFolio, resolveFixedInventoryAmount } from "@/lib/client/insumos";
import { formatExtractionFolio, getExtractionRowsFromProcessing, isSampleReadOnly, sampleStatusLabel } from "@/lib/client/samples";
import { RecordHistory } from "@/components/features/audit/RecordHistory";
import { formatActiveUserSignature } from "@/lib/client/session";
import { invalidate } from "@/lib/client/store";
import { estaHabilitada, usePuedeCrear } from "@/lib/client/puede";
import type { ApiRecord } from "@/lib/client/types";
import { EXTRACTION_TYPES, type ExtractionType } from "@/lib/shared/extraction";
import { Callout, ChoiceCard, ChoiceGrid, FieldGroup, FormCard, FormPage, PersonCard, StepRow, personaId, type FormSectionDef } from "./FormLayout";
import { CampoValidado, useValidacion } from "@/components/ui/Validacion";
import { msg, type Problema } from "@/lib/client/mensajes";
import { InsumoSearch, InventarioRows, collectInventarioRows, newInventarioRow } from "./InsumoSearch";
import { ASP_PROTOCOL } from "./extraction/asp";
import { DSP_PROTOCOL } from "./extraction/dsp";
import { EquiposUsados, newEquipoExtra, type EquipoUsadoRow } from "./extraction/EquiposUsados";
import { WeightTable, blancoRow, newWeightRow } from "./extraction/WeightTable";
import type { ExtractionProtocol, ExtractionState, FixedField, ProtocolContext, WeightColumnPair, WeightRow } from "./extraction/types";
import { SolicitudCallout, SupervisionCallout } from "./status";
import { formatearHora } from "@/lib/shared/fechas";
import { AvisoAutorizacion, AvisoEdicionBloqueada } from "./AvisoAutorizacion";
import { metodoDeExtraccion, requisitoEquipo, requisitosExtraccion } from "@/lib/shared/autorizaciones";
import { firmanteDe, firmantesPayload, type FirmanteState } from "./FirmanteSelect";

/*
 * Formato de extraccion como pagina completa. El formulario es comun; el
 * protocolo (ASP o DSP) aporta pasos, insumos fijos, equipos y secciones.
 */

const PROTOCOLS: Record<ExtractionType, ExtractionProtocol> = { "E-A": ASP_PROTOCOL, "E-D": DSP_PROTOCOL };

const SECTIONS_BEFORE: FormSectionDef[] = [
  { id: "sec-datos", label: "Datos generales" },
  { id: "sec-muestra", label: "Muestra y molienda" },
];
const SECTIONS_AFTER: FormSectionDef[] = [
  { id: "sec-resguardo", label: "Resguardo" },
  { id: "sec-equipos", label: "Equipos utilizados", optional: true },
  { id: "sec-insumos", label: "Insumos adicionales", optional: true },
  { id: "sec-personal", label: "Personal" },
];

const RES_EXTRACTO = ["Entregado a FX-106", "Refrigerador RE1", "Congelador CO1", "Congelador CO2", "Congelador CO3"];
const RES_MOLIDA = ["No sobró", "Refrigerador RE1", "Congelador CO1", "Congelador CO2", "Congelador CO3"];

/* Claves de pasos_json que no son campos planos del protocolo. */
const RESERVED_PASOS = new Set(["checklist", "filtrado", "resguardo_extracto", "resguardo_molienda_restante"]);
const FILTRADO_KEYS = ["volumen_filtrado", "volumen_recuperado", "filtro"];
const ROW_META_KEYS = new Set(["id_muestra", "organismo", "sitio_muestreo", "es_blanco", "replica", "submuestra"]);

const str = (value: unknown): string => (value === undefined || value === null ? "" : String(value));

const defaultForm = (protocol: ExtractionProtocol): ExtractionState => ({
  claveRevision: EXTRACTION_TYPES[protocol.tipo].clave,
  fechaEmision: todayIso(),
  estado: "registrada",
  folio: "",
  fecha: todayIso(),
  hora: formatearHora(new Date()),
  processingId: "",
  muestraTipo: "unica",
  idInterno: "",
  summary: "",
  sampleRows: null,
  legacyPesos: [],
  molienda: "",
  steps: protocol.defaultSteps(false),
  fields: { ...protocol.defaultFields },
  resExtracto: [false, false, false, false, false],
  resMolida: [false, false, false, false, false],
  observaciones: "",
  bitacoras: {},
  equiposExtra: [],
  inventarioRows: [],
  quienExtrajo: formatActiveUserSignature(),
  firmaExtrajo: "",
  quienLimpieza: "",
  firmaLimpieza: "",
  quienSuperviso: "",
  firmaSuperviso: "",
});

/* pasos_json -> campos planos del formulario. */
const fieldsFromPasos = (pasos: ApiRecord, protocol: ExtractionProtocol): Record<string, string> => {
  const fields: Record<string, string> = { ...protocol.defaultFields };
  for (const [key, value] of Object.entries(pasos || {})) {
    if (RESERVED_PASOS.has(key)) continue;
    if (value === null || value === undefined || typeof value === "object") continue;
    fields[key] = String(value);
  }
  const filtrado = (pasos?.filtrado || {}) as ApiRecord;
  for (const key of FILTRADO_KEYS) {
    if (filtrado[key] !== undefined && filtrado[key] !== null) fields[key] = String(filtrado[key]);
  }
  // Registros ASP anteriores: el folio de verificacion de la balanza se guardaba como id_ba1.
  if (!fields.folio_verificacion_balanza && fields.id_ba1) fields.folio_verificacion_balanza = fields.id_ba1;
  return fields;
};

const valuesFromEntry = (entry: ApiRecord): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(entry || {})) {
    if (ROW_META_KEYS.has(key) || value === null || value === undefined) continue;
    values[key] = String(value);
  }
  return values;
};

const isBlancoEntry = (entry: ApiRecord): boolean => !!entry.es_blanco || String(entry.id_muestra || "").trim().toLowerCase() === "blanco";

const rowFromEntry = (entry: ApiRecord): WeightRow =>
  newWeightRow({
    id: str(entry.id_muestra),
    organismo: str(entry.organismo),
    sitio: str(entry.sitio_muestreo),
    esBlanco: isBlancoEntry(entry),
    replica: str(entry.replica),
    values: valuesFromEntry(entry),
  });

/* Filas guardadas sin procesamiento vinculado (captura manual). */
const rowsFromSaved = (entries: ApiRecord[]): WeightRow[] => {
  const rows = entries.filter((entry) => entry && entry.id_muestra).map(rowFromEntry);
  if (!rows.length) return [];
  if (!rows.some((row) => row.esBlanco)) rows.unshift(blancoRow());
  return rows;
};

/* Filas a partir de las muestras del procesamiento, conservando lo ya capturado. */
const rowsFromProcessing = (processingRows: ApiRecord[], existing: ApiRecord[]): WeightRow[] => {
  const byId = new Map(existing.filter((entry) => entry && entry.id_muestra).map((entry) => [String(entry.id_muestra).trim(), entry]));
  const blancoSaved = existing.find((entry) => entry && isBlancoEntry(entry));
  const blanco = blancoSaved ? { ...rowFromEntry(blancoSaved), esBlanco: true } : blancoRow();
  const seen = new Set<string>([String(blanco.id).trim()]);
  const rows = processingRows.map((row, index) => {
    const id = String(row.id_interno || `Muestra ${index + 1}`).trim();
    seen.add(id);
    const prev = byId.get(id) || {};
    return newWeightRow({ id, organismo: row.nombre_organismo || "", sitio: row.sitio_muestreo || "", esBlanco: false, replica: str(prev.replica) || `${id}_R1`, values: valuesFromEntry(prev) });
  });
  // Muestras capturadas a mano que no vienen del procesamiento.
  const extras = existing.filter((entry) => entry && entry.id_muestra && !isBlancoEntry(entry) && !seen.has(String(entry.id_muestra).trim())).map(rowFromEntry);
  return [blanco, ...rows, ...extras];
};

const formFromItem = (item: ApiRecord, protocol: ExtractionProtocol): ExtractionState => {
  const pasos = (item.pasos || {}) as ApiRecord;
  const selected: string[] = Array.isArray(pasos.checklist) ? pasos.checklist : [];
  const steps: Record<string, boolean> = {};
  protocol.steps.forEach((step) => (steps[step.key] = selected.includes(step.value)));
  const rE = (pasos.resguardo_extracto || {}) as ApiRecord;
  const rM = (pasos.resguardo_molienda_restante || {}) as ApiRecord;
  const entries: ApiRecord[] = Array.isArray(item.registro_pesos) ? item.registro_pesos : [];
  const bitacoras: ExtractionState["bitacoras"] = {};
  for (const equipo of (Array.isArray(item.equipos) ? item.equipos : []) as ApiRecord[]) {
    const ref = equipo.equipo_id ? String(equipo.equipo_id) : str(equipo.nombre);
    if (!ref) continue;
    bitacoras[ref] = { clave: str(equipo.clave_bitacora), folio: str(equipo.folio_bitacora) };
  }
  return {
    ...defaultForm(protocol),
    claveRevision: item.clave_revision || EXTRACTION_TYPES[protocol.tipo].clave,
    fechaEmision: isoDate(item.fecha_emision),
      folio: item.folio_num ? String(item.folio_num) : "",
    fecha: isoDate(item.fecha_extraccion),
    hora: item.hora_extraccion || "",
    estado: item.estado || "registrada",
    processingId: item.procesamiento_id ? String(item.procesamiento_id) : "",
    muestraTipo: item.muestra_tipo === "lote" ? "lote" : "unica",
    idInterno: item.id_interno || "",
    molienda: item.tipo_molienda || "",
    steps,
    fields: fieldsFromPasos(pasos, protocol),
    sampleRows: item.procesamiento_id ? null : rowsFromSaved(entries),
    legacyPesos: entries.filter((entry) => entry && !entry.id_muestra),
    resExtracto: [!!rE.entregado_fx106, !!rE.refrigerador_re1, !!rE.congelador_co1, !!rE.congelador_co2, !!rE.congelador_co3],
    resMolida: [!!rM.no_sobro, !!rM.refrigerador_re1, !!rM.congelador_co1, !!rM.congelador_co2, !!rM.congelador_co3],
    bitacoras,
    observaciones: item.observaciones_generales || "",
    quienExtrajo: item.nombre_quien_extrajo || "",
    quienLimpieza: item.nombre_quien_limpieza || "",
    quienSuperviso: item.nombre_quien_superviso || "",
    firmaExtrajo: item.firma_quien_extrajo || "",
    firmaLimpieza: item.firma_quien_limpieza || "",
    firmaSuperviso: item.firma_quien_superviso || "",
  };
};

/*
 * Convierte nombres de equipo viejos a id y, solo al crear (fillFixed), sugiere
 * los insumos fijos por busqueda automatica. Al editar se respeta lo que el
 * analista dejo vacio.
 */
/*
 * Prellena lo que ya se sabe: reactivos del protocolo por nombre, el equipo
 * operativo único que corresponde a cada paso, el lote del reactivo como folio
 * de preparación y el siguiente folio de bitácora de cada equipo. Solo llena
 * huecos: nunca pisa lo que la persona ya capturó.
 */
const autoResolve = (current: ExtractionState, protocol: ExtractionProtocol, fillFixed: boolean): ExtractionState => {
  const fields = { ...current.fields };
  if (fillFixed) {
    for (const field of protocol.fixedFields) {
      const value = String(fields[field.key] || "").trim();
      if (!value || !findInsumoOption(field.tipo, value)) {
        const match = findInsumoByAutoQuery(field.tipo, field.autoQuery);
        if (match) fields[field.key] = match.ref;
      }
    }
    for (const field of protocol.equipoFields) {
      if (String(fields[field.key] || "").trim()) continue;
      const match = findUniqueOperativeEquipo(field.autoQuery || field.label);
      if (match) fields[field.key] = match.ref;
    }
  }
  for (const field of protocol.fixedFields) {
    if (!field.folioField || String(fields[field.folioField] || "").trim()) continue;
    const option = findInsumoOption(field.tipo, String(fields[field.key] || ""));
    if (option?.lote) fields[field.folioField] = String(option.lote);
  }
  for (const field of protocol.equipoFields) {
    const value = String(fields[field.key] || "").trim();
    if (!value) continue;
    const option = findInsumoOption("equipo", value);
    if (option && option.ref !== value) fields[field.key] = option.ref;
  }
  const equiposExtra = current.equiposExtra.map((row) => {
    const option = findInsumoOption("equipo", row.ref);
    return option && option.ref !== row.ref ? { ...row, ref: option.ref } : row;
  });
  // Folio de bitácora sugerido (último + 1) para cada equipo que aún no lo tiene.
  const bitacoras = { ...current.bitacoras };
  const refs = [...protocol.equipoFields.map((field) => String(fields[field.key] || "").trim()), ...equiposExtra.map((row) => row.ref)].filter(Boolean);
  for (const ref of refs) {
    const option = findInsumoOption("equipo", ref);
    if (!option) continue;
    const entry = bitacoras[option.ref] || { clave: "", folio: "" };
    if (entry.folio?.trim()) continue;
    const suggested = nextBitacoraFolio(option);
    if (suggested) bitacoras[option.ref] = { clave: entry.clave || option.clave_bitacora || "", folio: suggested };
  }
  return { ...current, fields, equiposExtra, bitacoras };
};

/* Campos que se copian a otro mientras el destino siga vacio (misma verificacion de balanza para muestras y blanco). */
const MIRROR_FIELDS: Record<string, string> = { folio_verificacion_balanza: "folio_verificacion_balanza_blanco" };

/* Filas con identificador (las vacias no se guardan ni cuentan como tubo). */
const tubeCountOf = (current: ExtractionState): number => {
  const rows = (current.sampleRows || []).filter((row) => row.id.trim()).length;
  return rows ? rows * 2 : 1;
};

const fixedEnabled = (field: FixedField, current: ExtractionState): boolean =>
  (field.stepKey ? !!current.steps[field.stepKey] : true) && (field.enabledWhen ? field.enabledWhen(current.fields) : true);

/* Cantidad total del insumo fijo y nota de como se calculo. */
const fixedAmount = (field: FixedField, current: ExtractionState, tubes: number): { total: number; base: number; nota?: string } => {
  const base = field.editableAmountKey ? Number.parseFloat(current.fields[field.editableAmountKey] || "") || 0 : Number.parseFloat(field.cantidadFija) || 0;
  const factor = field.perTube ? tubes : 1;
  const total = Math.round(base * factor * 10000) / 10000;
  const nota = field.perTube && tubes > 1 ? `${formatInventoryAmount(base)} ${field.cantidadUnidad} × ${tubes} tubos` : undefined;
  return { total, base, nota };
};

/* Insumos fijos a descontar; se marcan con su origen para distinguirlos de los agregados a mano al reabrir. */
const buildProtocolInventario = (current: ExtractionState, protocol: ExtractionProtocol, tubes: number) => {
  const result: Array<{ tipo: string; ref: string; cantidad: number; origen: "protocolo"; campo: string }> = [];
  for (const field of protocol.fixedFields) {
    if (!fixedEnabled(field, current)) continue;
    const ref = String(current.fields[field.key] || "").trim();
    if (!ref) continue;
    const { total } = fixedAmount(field, current, tubes);
    if (total <= 0) continue;
    const resolved = resolveFixedInventoryAmount({ cantidadFija: total, cantidadUnidad: field.cantidadUnidad }, findInsumoOption(field.tipo, ref));
    result.push({ tipo: field.tipo, ref, cantidad: resolved?.amount || total, origen: "protocolo", campo: field.key });
  }
  return result;
};

/* Consumibles fijos cuyo stock no alcanza: se avisa (no se bloquea) porque el conteo de unidades del catalogo no siempre esta al dia. */
const lowConsumibles = (current: ExtractionState, protocol: ExtractionProtocol, tubes: number): string[] => {
  // El mismo consumible puede usarse en varios pasos (p. ej. viales): se suma lo requerido por referencia.
  const required = new Map<string, { label: string; existencia: number; total: number }>();
  for (const field of protocol.fixedFields) {
    if (field.tipo !== "consumible" || !fixedEnabled(field, current)) continue;
    const ref = String(current.fields[field.key] || "").trim();
    if (!ref) continue;
    const option = findInsumoOption("consumible", ref);
    const { total } = fixedAmount(field, current, tubes);
    if (!option || option.existencia === null || option.existencia === undefined || total <= 0) continue;
    const entry = required.get(option.ref) || { label: option.label, existencia: Number(option.existencia), total: 0 };
    entry.total += total;
    required.set(option.ref, entry);
  }
  return Array.from(required.values())
    .filter((entry) => entry.existencia < entry.total)
    .map((entry) => `${entry.label}: ${formatInventoryAmount(entry.existencia)} unidades disponibles, se descontarán ${formatInventoryAmount(entry.total)}`);
};

/* Insumos fijos activos que no se encontraron en inventario: se guardan sin descuento, previa confirmacion. */
const missingFixedInsumos = (current: ExtractionState, protocol: ExtractionProtocol, tubes: number): string[] =>
  Array.from(
    new Set(
      protocol.fixedFields
        .filter((field) => fixedEnabled(field, current) && fixedAmount(field, current, tubes).total > 0 && !String(current.fields[field.key] || "").trim())
        .map((field) => field.placeholder),
    ),
  );

const validateStock = (current: ExtractionState, protocol: ExtractionProtocol, tubes: number): { key: string; message: string }[] => {
  const errors: { key: string; message: string }[] = [];
  for (const field of protocol.fixedFields) {
    if (field.tipo !== "reactivo" || !fixedEnabled(field, current)) continue;
    const ref = String(current.fields[field.key] || "").trim();
    if (!ref) continue;
    const reactivo = findReactivoByRef(ref);
    if (!reactivo) continue;
    const { total } = fixedAmount(field, current, tubes);
    if (total <= 0) continue;
    const resolved = resolveFixedInventoryAmount({ cantidadFija: total, cantidadUnidad: field.cantidadUnidad }, reactivo);
    if (!resolved) continue;
    const stock = reactivo.cantidad_actual ?? null;
    if (stock !== null && Number(stock) < resolved.amount) {
      errors.push({ key: field.key, message: `${reactivo.label}: ${formatInventoryAmount(stock)} ${reactivo.unidad || ""} disponibles, se requieren ${formatInventoryAmount(resolved.amount)}` });
    }
  }
  return errors;
};

/* Filas de "Equipos utilizados": equipos elegidos en los pasos mas los agregados a mano. */
const equipoRows = (current: ExtractionState, protocol: ExtractionProtocol): EquipoUsadoRow[] => {
  const map = new Map<string, EquipoUsadoRow>();
  const add = (ref: string, uso: string, extra?: EquipoUsadoRow["extra"]) => {
    const option = findInsumoOption("equipo", ref);
    const key = option?.ref || ref;
    const existing = map.get(key);
    if (existing) {
      if (uso && !existing.uso.includes(uso)) existing.uso = [existing.uso, uso].filter(Boolean).join(" · ");
      return;
    }
    map.set(key, { ref: key, nombre: option?.nombre || ref, uso, claveCatalogo: option?.clave_bitacora || "", enCatalogo: !!option, alert: equipoAlert(option), extra });
  };
  for (const field of protocol.equipoFields) {
    const value = String(current.fields[field.key] || "").trim();
    if (value) add(value, field.uso);
  }
  for (const row of current.equiposExtra) {
    const value = String(row.ref || "").trim();
    if (value) add(value, row.uso.trim(), row);
  }
  return Array.from(map.values());
};

const buildPayload = (current: ExtractionState, protocol: ExtractionProtocol, processings: ApiRecord[], tubes: number) => {
  const selected = current.processingId ? processings.find((row) => String(row.id) === current.processingId) : undefined;
  const numeric = new Set(protocol.numericFields);
  const pasos: Record<string, unknown> = { checklist: protocol.steps.filter((step) => !!current.steps[step.key]).map((step) => step.value) };
  for (const [key, value] of Object.entries(current.fields)) {
    if (FILTRADO_KEYS.includes(key)) continue;
    const text = String(value ?? "").trim();
    pasos[key] = numeric.has(key) ? parseFloatOrNull(text) : text || null;
  }
  // Alias historico del formato ASP.
  if (protocol.tipo === "E-A") pasos.id_ba1 = pasos.folio_verificacion_balanza ?? null;
  pasos.filtrado = Object.fromEntries(FILTRADO_KEYS.map((key) => [key, String(current.fields[key] || "").trim() || null]));
  pasos.resguardo_extracto = { entregado_fx106: !!current.resExtracto[0], refrigerador_re1: !!current.resExtracto[1], congelador_co1: !!current.resExtracto[2], congelador_co2: !!current.resExtracto[3], congelador_co3: !!current.resExtracto[4] };
  pasos.resguardo_molienda_restante = { no_sobro: !!current.resMolida[0], refrigerador_re1: !!current.resMolida[1], congelador_co1: !!current.resMolida[2], congelador_co2: !!current.resMolida[3], congelador_co3: !!current.resMolida[4] };

  const columns: WeightColumnPair[] = [...protocol.weightColumns, ...protocol.moreWeightColumns];
  const parseValue = (key: string, value: string | undefined) => {
    const column = columns.find((entry) => entry.muestra === key || entry.replica === key);
    const text = String(value ?? "").trim();
    if (column?.kind === "number") return parseFloatOrNull(text);
    return text || null;
  };
  const weights = (current.sampleRows || [])
    .map((row) => {
      const entry: Record<string, unknown> = {
        id_muestra: row.id.trim() || null,
        organismo: row.organismo.trim() || null,
        sitio_muestreo: row.sitio.trim() || null,
        es_blanco: row.esBlanco,
        replica: row.replica.trim() || null,
      };
      for (const column of columns) {
        entry[column.muestra] = parseValue(column.muestra, row.values[column.muestra]);
        entry[column.replica] = parseValue(column.replica, row.values[column.replica]);
      }
      return entry;
    })
    .filter((entry) => entry.id_muestra);

  const equipos = equipoRows(current, protocol).map((row) => {
    const entry = current.bitacoras[row.ref];
    return {
      equipo_id: /^\d+$/.test(row.ref) ? Number(row.ref) : null,
      nombre: row.nombre,
      uso: row.uso || null,
      clave_bitacora: (entry?.clave || row.claveCatalogo || "").trim() || null,
      folio_bitacora: (entry?.folio || "").trim() || null,
    };
  });

  return {
    folio_num: parseIntOrNull(current.folio),
    tipo_registro: protocol.tipo,
    clave_revision: current.claveRevision.trim() || EXTRACTION_TYPES[protocol.tipo].clave,
    fecha_emision: current.fechaEmision || null,
    fecha_extraccion: current.fecha || null,
    hora_extraccion: current.hora || null,
    procesamiento_id: parseIntOrNull(current.processingId),
    folio_procesamiento_num: parseIntOrNull(selected?.folio_num),
    muestra_tipo: current.muestraTipo || null,
    id_interno: current.idInterno.trim() || null,
    tipo_molienda: current.molienda || null,
    pasos,
    registro_pesos: [...weights, ...current.legacyPesos],
    equipos,
    observaciones_generales: current.observaciones.trim() || null,
    nombre_quien_extrajo: current.quienExtrajo.trim() || null,
    nombre_quien_limpieza: protocol.hasLimpiezaPerson ? current.quienLimpieza.trim() || null : null,
    nombre_quien_superviso: current.quienSuperviso.trim() || null,
    firma_quien_extrajo: current.firmaExtrajo.trim() || null,
    firma_quien_limpieza: protocol.hasLimpiezaPerson ? current.firmaLimpieza.trim() || null : null,
    firma_quien_superviso: current.firmaSuperviso.trim() || null,
    estado: current.estado || "registrada",
    uso_inventario: [...buildProtocolInventario(current, protocol, tubes), ...collectInventarioRows(current.inventarioRows)],
  };
};

export function ExtractionForm({ item, tipo, prefillProcessingId }: { item: ApiRecord | null; tipo?: ExtractionType; prefillProcessingId?: number | null }) {
  const router = useRouter();
  const confirm = useConfirm();
  const { token, can } = useSession();
  const puedeCrear = usePuedeCrear();
  const protocol = PROTOCOLS[(item?.tipo_registro as ExtractionType) || tipo || "E-A"] || ASP_PROTOCOL;
  const meta = EXTRACTION_TYPES[protocol.tipo];
  const [form, setForm] = useState<ExtractionState>(() => (item ? formFromItem(item, protocol) : defaultForm(protocol)));
  // Fase 5: firmas ligadas a cuentas (extrajo, limpió, supervisó).
  const [firmantes, setFirmantes] = useState<Record<string, FirmanteState>>(() => ({ extrajo: firmanteDe(item, "extrajo"), limpio: firmanteDe(item, "limpio"), superviso: firmanteDe(item, "superviso") }));
  const firmante = (rol: string) => ({ nuevo: !item?.id, firmante: firmantes[rol], onFirmante: (v: FirmanteState) => setFirmantes((prev) => ({ ...prev, [rol]: v })) });
  const [processings, setProcessings] = useState<ApiRecord[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const detailCache = useRef(new Map<number, ApiRecord>());
  const editing = !!item?.id;
  const canEdit = editing ? estaHabilitada(item, "editar", can("ensayos", "E", { objeto: "extraccion", borrador: String(item?.estado || "registrada") === "registrada" })) : puedeCrear("extraccion", can("ensayos", "C", { objeto: "extraccion", borrador: true }));
  // Con una solicitud de autorizacion pendiente (Fase 3) el registro no se edita.
  const readOnly = editing && (isSampleReadOnly(item?.estado) || !canEdit || !!item?.solicitud_pendiente);
  const patch = (changes: Partial<ExtractionState>) => setForm((prev) => ({ ...prev, ...changes }));
  const setField = (key: string, value: string) => setForm((prev) => ({ ...prev, fields: { ...prev.fields, [key]: value } }));
  const setSteps = (changes: Record<string, boolean>) => setForm((prev) => ({ ...prev, steps: { ...prev.steps, ...changes } }));
  const tubes = tubeCountOf(form);
  const extrajoId = personaId("Quien extrajo");
  const limpioId = personaId("Quien realizó la limpieza");
  const supervisoId = personaId("Quien supervisó");
  const conLimpieza = protocol.hasLimpiezaPerson && form.fields.limpieza === "si";
  /* Reglas del formato, en orden (las del protocolo van entre "Muestra" y "Resguardo"): completitud, aviso del encabezado y pop-up. */
  const reglas = (): Problema[] => {
    const out: Problema[] = [];
    const en = (seccion: string, grupo: string) => (campo: string, mensaje: string) => out.push({ campo, mensaje, seccion, grupo });
    const datos = en("sec-datos", "Datos generales");
    if (!form.folio) datos("e-folio", msg.indica("el folio de extracción"));
    if (!form.fecha) datos("e-fecha", msg.indica("la fecha de extracción"));
    const mu = en("sec-muestra", "Muestra y molienda");
    if (!form.processingId) mu("e-proc", msg.elige("el procesamiento de origen"));
    if (!form.molienda) mu("e-molienda", msg.elige("el tipo de molienda"));
    out.push(...protocol.reglas(form));
    if (!form.resExtracto.some(Boolean)) en("sec-resguardo", "Resguardo")("e-res-extracto", msg.elige("dónde queda el extracto"));
    const per = en("sec-personal", "Personal");
    if (!form.quienExtrajo.trim()) per(extrajoId, msg.elige("a quien extrajo"));
    if (conLimpieza && !form.quienLimpieza.trim()) per(limpioId, msg.elige("a quien realizó la limpieza"));
    if (!form.quienSuperviso.trim()) per(supervisoId, msg.elige("a quien supervisó"));
    return out;
  };
  const v = useValidacion({ titulo: editing ? "No se pudo guardar la extracción" : `No se pudo registrar la extracción ${meta.short}`, reglas: readOnly ? () => [] : reglas });
  const camposServidor = { folio: "e-folio", id_interno: "e-id", "firma:extrajo": extrajoId, "firma:limpio": limpioId, "firma:superviso": supervisoId };
  const ubicacionServidor = { folio: { seccion: "sec-datos", grupo: "Datos generales" }, id_interno: { seccion: "sec-muestra", grupo: "Muestra y molienda" }, "firma:extrajo": { seccion: "sec-personal", grupo: "Personal" }, "firma:limpio": { seccion: "sec-personal", grupo: "Personal" }, "firma:superviso": { seccion: "sec-personal", grupo: "Personal" } };
  // Opcionales: verde solo si se llenaron (folios de bitácora capturados / insumos con referencia).
  const optionalDone: Record<string, boolean | undefined> = {
    "sec-equipos": Object.values(form.bitacoras).some((entry) => !!entry.folio?.trim()) || form.equiposExtra.some((row) => !!row.ref) ? true : undefined,
    "sec-insumos": form.inventarioRows.some((row) => (row.ref || row.nombre || "").trim()) ? true : undefined,
  };
  const protocolIds = new Set(protocol.sections.map((section) => section.id));
  const sections: FormSectionDef[] = [...SECTIONS_BEFORE, ...protocol.sections, ...SECTIONS_AFTER, ...(editing ? [{ id: "sec-historial", label: "Historial", optional: true }] : [])].map((section) => ({
    ...section,
    complete: readOnly ? undefined : section.optional ? (protocolIds.has(section.id) ? protocol.sectionComplete(section.id, form) : optionalDone[section.id]) : v.seccionCompleta(section.id),
  }));

  const processingDetail = async (id: number): Promise<ApiRecord | null> => {
    const cached = detailCache.current.get(id);
    if (cached) return cached;
    const data = await getJsonAuth(`${API_BASE_URL}/samples/processing/${id}`, token);
    const detail = (data.item || null) as ApiRecord | null;
    if (detail) detailCache.current.set(id, detail);
    return detail;
  };

  const applyProcessing = (processing: ApiRecord | null, existing: ApiRecord[] = []) => {
    setForm((prev) => {
      if (!processing) return { ...prev, idInterno: "", muestraTipo: "unica", summary: "", sampleRows: null, steps: { ...prev.steps, ...protocol.defaultSteps(false) } };
      const rows = getExtractionRowsFromProcessing(processing);
      const ids = rows.map((row) => row.id_interno).filter(Boolean).join(", ");
      const muestraTipo: "unica" | "lote" = processing.muestra_tipo === "lote" || (!processing.muestra_tipo && rows.length > 1) ? "lote" : "unica";
      const resguardo = processing.resguardo || {};
      const frozen = !!resguardo.congelador_co1 || !!resguardo.congelador_co2 || !!resguardo.congelador_co3;
      const folio = processing.folio_num ? formatearFolio("P", processing.folio_num) : "Procesamiento";
      return {
        ...prev,
        idInterno: ids || processing.id_interno || "",
        muestraTipo,
        molienda: frozen ? "congelada" : "fresca",
        summary: `${folio}: ${rows.length || 1} muestra(s) lista(s) para extracción.`,
        sampleRows: rowsFromProcessing(rows, existing),
        steps: { ...prev.steps, ...protocol.defaultSteps(frozen) },
      };
    });
  };

  const selectProcessing = async (value: string, existing: ApiRecord[] = []) => {
    const id = parseIntOrNull(value);
    if (!id) return setForm((prev) => ({ ...prev, idInterno: "", muestraTipo: "unica", summary: "", sampleRows: null }));
    try {
      applyProcessing(await processingDetail(id), existing);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo leer el procesamiento");
      setForm((prev) => ({ ...prev, idInterno: "", muestraTipo: "unica", summary: "", sampleRows: null }));
    }
  };

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const empty: ApiRecord = {};
      const data = await getJsonAuth(`${API_BASE_URL}/samples/processing?search=`, token).catch(() => empty);
      if (cancelled) return;
      setProcessings((data.items || []) as ApiRecord[]);
      await loadInsumoOptions();
      if (cancelled) return;
      if (item) {
        if (item.procesamiento_id) {
          await selectProcessing(String(item.procesamiento_id), item.registro_pesos || []);
          if (cancelled) return;
          const saved = formFromItem(item, protocol);
          setForm((prev) => ({ ...prev, steps: saved.steps, molienda: item.tipo_molienda || prev.molienda }));
        }
        setForm((prev) => {
          const resolved = autoResolve(prev, protocol, false);
          const protocolRows = buildProtocolInventario(resolved, protocol, tubeCountOf(resolved));
          const manual = filterManualInventario((item.uso_inventario || []) as ApiRecord[], protocolRows);
          // Equipos guardados que no corresponden a ningun paso del protocolo.
          const autoRefs = new Set(equipoRows({ ...resolved, equiposExtra: [] }, protocol).map((row) => row.ref));
          const savedEquipos = (Array.isArray(item.equipos) ? item.equipos : []) as ApiRecord[];
          const equiposExtra = savedEquipos
            .map((equipo) => ({ ref: equipo.equipo_id ? String(equipo.equipo_id) : str(equipo.nombre), uso: str(equipo.uso) }))
            .filter((row) => row.ref && !autoRefs.has(findInsumoOption("equipo", row.ref)?.ref || row.ref))
            .map((row) => newEquipoExtra(row.ref, row.uso));
          return { ...resolved, equiposExtra, inventarioRows: manual.map((row) => newInventarioRow(row.tipo || "consumible", row.ref || row.nombre || "", row.cantidad ?? 1, row.nombre)) };
        });
        return;
      }
      setForm((prev) => autoResolve(prev, protocol, true));
      if (prefillProcessingId) {
        patch({ processingId: String(prefillProcessingId) });
        await selectProcessing(String(prefillProcessingId));
        if (cancelled) return;
        setForm((prev) => autoResolve(prev, protocol, true));
      }
      try {
        const next = await getJsonAuth(`${API_BASE_URL}/samples/extraction/next-folio?tipo=${encodeURIComponent(protocol.tipo)}`, token);
        if (!cancelled) patch({ folio: next.next_folio ? String(next.next_folio) : "" });
      } catch {
        /* sin folio sugerido */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, item, prefillProcessingId]);

  const handleSave = async () => {
    if (!v.validar()) return;
    if (!canEdit) return v.avisar({ que: "No tienes permiso para guardar esta extracción.", hacer: "Pide a la administración que revise tus roles y permisos." });
    await loadInsumoOptions();
    const current = autoResolve(form, protocol, !editing);
    setForm(current);
    const currentTubes = tubeCountOf(current);
    const payload = { ...buildPayload(current, protocol, processings, currentTubes), firmantes: firmantesPayload(protocol.hasLimpiezaPerson ? firmantes : { ...firmantes, limpio: undefined }) };
    if (payload.procesamiento_id && !payload.id_interno) {
      return v.avisar({ que: "El procesamiento elegido no tiene muestras para extracción.", hacer: "Elige otro procesamiento o revisa sus muestras.", problemas: [{ campo: "e-proc", mensaje: "No tiene muestras para extracción", seccion: "sec-muestra", grupo: "Muestra y molienda" }] });
    }
    const stockErrors = validateStock(current, protocol, currentTubes);
    if (stockErrors.length) {
      // La sección donde vive el reactivo se localiza por el campo, para abrirla aunque esté plegada.
      const seccionDe = (key: string) => document.getElementById(`e-insumo-${key}`)?.closest("section")?.id || "sec-extraccion";
      return v.avisar({
        que: "No hay existencia suficiente de algunos reactivos del protocolo.",
        hacer: "Elige otro lote con existencia, repón el inventario o ajusta la cantidad.",
        problemas: stockErrors.map((e) => ({ campo: `e-insumo-${e.key}`, mensaje: e.message, seccion: seccionDe(e.key), grupo: "Stock insuficiente" })),
      });
    }

    // Equipos no aptos o insumos sin descuento: se avisa y se pide confirmacion explicita
    // (el catalogo de equipos aun no esta validado y las soluciones preparadas pueden no estar en inventario).
    const observed = equipoRows(current, protocol).filter((row) => row.alert?.requiresConfirm);
    const missing = missingFixedInsumos(current, protocol, currentTubes);
    const low = lowConsumibles(current, protocol, currentTubes);
    if (observed.length || missing.length || low.length) {
      const ok = await confirm({
        title: "Revisar antes de guardar",
        // La descripcion del dialogo se renderiza dentro de un <p>: solo elementos en linea.
        description: (
          <span className="flex flex-col gap-3">
            {observed.length ? (
              <span className="flex flex-col gap-1">
                <span>Equipos que no están en condición de uso según el catálogo. El registro quedará con esta observación.</span>
                {observed.map((row) => (
                  <span key={row.ref} className="block pl-4">
                    • <span className="font-medium text-ink">{row.nombre}</span>: {row.alert?.message}
                  </span>
                ))}
              </span>
            ) : null}
            {missing.length ? (
              <span className="flex flex-col gap-1">
                <span>Insumos del protocolo que no se encontraron en inventario; se guardarán sin descuento automático.</span>
                {missing.map((label) => (
                  <span key={label} className="block pl-4">
                    • {label}
                  </span>
                ))}
              </span>
            ) : null}
            {low.length ? (
              <span className="flex flex-col gap-1">
                <span>Consumibles cuyo stock registrado no alcanza; el inventario quedará en negativo hasta que se actualice.</span>
                {low.map((label) => (
                  <span key={label} className="block pl-4">
                    • {label}
                  </span>
                ))}
              </span>
            ) : null}
          </span>
        ),
        confirmLabel: "Guardar de todos modos",
        cancelLabel: "Revisar",
        tone: "primary",
      });
      if (!ok) return;
    }

    setSubmitting(true);
    try {
      if (editing) {
        await sendJsonAuth("PUT", `${API_BASE_URL}/samples/extraction/${item!.id}`, token, payload);
        toast.success("Extracción actualizada. Inventario descontado.");
      } else {
        await sendJsonAuth("POST", `${API_BASE_URL}/samples/extraction`, token, payload);
        toast.success(`Extracción ${meta.short} registrada. Inventario descontado.`);
      }
      invalidate("muestras", "movimientos", "reactivos", "consumibles", "dashboard");
      router.push(`/muestras/extraccion?tipo=${protocol.tipo}`);
    } catch (err) {
      v.errorServidor(err, camposServidor, ubicacionServidor);
      setSubmitting(false);
    }
  };

  const ctx: ProtocolContext = {
    form,
    patch,
    setField,
    setSteps,
    tubeCount: tubes,
    step: (key, number, label, children) => (
      <CampoValidado key={key} id={`e-paso-${key}`}>
        <StepRow number={number} label={label} checked={!!form.steps[key]} onCheckedChange={(checked) => setSteps({ [key]: checked })}>
          {children}
        </StepRow>
      </CampoValidado>
    ),
    equipo: (key, placeholder) => <InsumoSearch tipo="equipo" value={form.fields[key] || ""} onChange={(ref) => setField(key, ref)} placeholder={placeholder} size="sm" />,
    fixed: (key) => {
      const field = protocol.fixedFields.find((entry) => entry.key === key);
      if (!field) return null;
      const { total, nota } = fixedAmount(field, form, tubes);
      // Al elegir una solución preparada, su lote se sugiere como folio de preparación si el campo está vacío.
      const chooseFixed = (ref: string) =>
        setForm((prev) => {
          const next = { ...prev.fields, [field.key]: ref };
          const option = findInsumoOption(field.tipo, ref);
          if (field.folioField && !String(next[field.folioField] || "").trim() && option?.lote) next[field.folioField] = String(option.lote);
          return { ...prev, fields: next };
        });
      return (
        <CampoValidado id={`e-insumo-${field.key}`} className="min-w-0">
          <InsumoSearch tipo={field.tipo} value={form.fields[field.key] || ""} onChange={chooseFixed} placeholder={field.placeholder} cantidadFija={total || null} cantidadUnidad={field.cantidadUnidad} cantidadNota={nota} stepEnabled={fixedEnabled(field, form)} showStockBadge size="sm" />
        </CampoValidado>
      );
    },
    text: (key, placeholder, options) => (
      <input
        id={options?.id}
        className={cn(controlClassSm, options?.className)}
        placeholder={placeholder}
        maxLength={options?.maxLength}
        inputMode={options?.inputMode}
        value={form.fields[key] || ""}
        onChange={(event) => {
          const value = event.target.value;
          // La verificación de la balanza es una sola por jornada: el folio del blanco se copia si está vacío.
          const mirror = MIRROR_FIELDS[key];
          setForm((prev) => ({ ...prev, fields: { ...prev.fields, [key]: value, ...(mirror && !String(prev.fields[mirror] || "").trim() ? { [mirror]: value } : {}) } }));
        }}
        aria-label={options?.ariaLabel || placeholder}
      />
    ),
    weightTable: (columns, options) => (
      <CampoValidado id={`e-pesos-${columns[0]?.muestra || "tabla"}`}>
        <WeightTable rows={form.sampleRows} columns={columns} compact={options?.compact} linked={!!form.processingId} onChange={(rows) => patch({ sampleRows: rows })} />
      </CampoValidado>
    ),
  };

  const rows = equipoRows(form, protocol);
  const folioLabel = editing ? formatExtractionFolio(item!) : `${meta.tipo} ${form.folio ? String(form.folio).padStart(7, "0") : "—"}`;

  return (
    <FormPage
      backHref={`/muestras/extraccion?tipo=${protocol.tipo}`}
      backLabel="Extracciones"
      code={meta.clave}
      title={editing ? `Extracción ${meta.short} · ${folioLabel}` : `Nueva extracción ${meta.short}`}
      status={sampleStatusLabel(form.estado)}
      statusTone={readOnly ? "danger" : "brand"}
      sections={sections}
      validacion={v}
      readOnly={readOnly}
      after={
        editing ? (
          <>
            <IncidenciasFormCard entidad="muestras_extraccion" id={item?.id} etiqueta={folioLabel} />
            <FormCard id="sec-historial" title="Historial del registro" description="Bitácora de auditoría: quién creó, editó, anuló o restauró esta extracción y qué cambió.">
              <RecordHistory entidad="muestras_extraccion" entidadId={item?.id as number | undefined} />
            </FormCard>
          </>
        ) : null
      }
      actions={
        <>
          <Button variant="secondary" onClick={() => router.push(`/muestras/extraccion?tipo=${protocol.tipo}`)}>
            {readOnly ? "Volver" : "Cancelar"}
          </Button>
          {!readOnly ? (
            <Button onClick={handleSave} loading={submitting} icon={<FloppyDisk size={16} />}>
              {editing ? "Guardar cambios" : `Registrar extracción ${meta.short}`}
            </Button>
          ) : null}
        </>
      }
    >
      <SupervisionCallout item={item} />
      <SolicitudCallout item={item} />
      <AvisoSuspension metodo={metodoDeExtraccion(protocol.tipo)} equipoIds={rows.map((row) => (/^\d+$/.test(row.ref) ? row.ref : null))} />
      <AvisoEdicionBloqueada item={item} cerrado={!editing || isSampleReadOnly(item?.estado)} />
      {!readOnly ? <AvisoAutorizacion requisitos={[...requisitosExtraccion(protocol.tipo), ...rows.filter((row) => row.enCatalogo && /^\d+$/.test(row.ref)).map((row) => requisitoEquipo(row.ref, row.claveCatalogo || row.nombre))]} /> : null}
      {readOnly && item?.motivo_anulacion ? (
        <Callout tone="danger" title="Registro anulado">
          Motivo: {String(item.motivo_anulacion)}
          {item.anulado_cargo ? ` · Anuló como ${String(item.anulado_cargo)}` : ""}
        </Callout>
      ) : null}
      <FormCard id="sec-datos" title="Datos generales" description={`${meta.label}. ${meta.descripcion}`}>
        <FormGrid cols={4}>
          <Field label={`Folio ${meta.tipo}`} htmlFor="e-folio" required hint={`Serie propia del formato ${meta.clave}.`}>
            <Input id="e-folio" type="number" min="1" inputMode="numeric" value={form.folio} onChange={(event) => patch({ folio: event.target.value })} mono />
          </Field>
          <Field label="Fecha" htmlFor="e-fecha" required>
            <DateInput id="e-fecha" value={form.fecha} onChange={(value) => patch({ fecha: value })} />
          </Field>
          <Field label="Hora" htmlFor="e-hora" required>
            <Input id="e-hora" type="time" value={form.hora} onChange={(event) => patch({ hora: event.target.value })} />
          </Field>
          <Field label="Procesamiento (FX-TCF-GMP)" htmlFor="e-proc" hint={form.summary || "Al vincular se cargan las muestras y el tipo de molienda."}>
            <Select
              id="e-proc"
              value={form.processingId}
              onChange={(event) => {
                patch({ processingId: event.target.value });
                void selectProcessing(event.target.value);
              }}
            >
              <option value="">Sin vincular</option>
              {processings.map((option) => (
                <option key={option.id} value={option.id}>
                  {formatearFolio("P", option.folio_num)} · {option.id_interno || "Sin ID interno"}
                </option>
              ))}
            </Select>
          </Field>
        </FormGrid>
      </FormCard>

      <FormCard id="sec-muestra" title="Muestra y molienda" description="Identificación de la muestra y estado de la molienda.">
        <div className="flex flex-col gap-5">
          <FieldGroup label="Tipo de muestra">
            <ChoiceGrid cols={2}>
              <ChoiceCard type="radio" name="e-tipo" checked={form.muestraTipo === "unica"} onChange={() => patch({ muestraTipo: "unica" })} label="Muestra única" description="Un solo ID interno." />
              <ChoiceCard type="radio" name="e-tipo" checked={form.muestraTipo === "lote"} onChange={() => patch({ muestraTipo: "lote" })} label="Lote" description="Varias muestras del mismo procesamiento." />
            </ChoiceGrid>
          </FieldGroup>
          <Field label="ID interno" htmlFor="e-id" className="max-w-[420px]">
            <Input id="e-id" maxLength={200} value={form.idInterno} onChange={(event) => patch({ idInterno: event.target.value })} mono placeholder="Se completa desde el procesamiento" />
          </Field>
          <FieldGroup label="Tipo de molienda">
            <CampoValidado id="e-molienda">
              <ChoiceGrid cols={2}>
                <ChoiceCard type="radio" name="e-molienda" checked={form.molienda === "fresca"} onChange={() => patch({ molienda: "fresca" })} label="Fresca" description="Pasa directo al submuestreo." />
                <ChoiceCard type="radio" name="e-molienda" checked={form.molienda === "congelada"} onChange={() => patch({ molienda: "congelada" })} label="Congelada" description="Requiere descongelar y homogeneizar." />
              </ChoiceGrid>
            </CampoValidado>
          </FieldGroup>
        </div>
      </FormCard>

      {protocol.render(ctx)}

      <FormCard id="sec-resguardo" title="Resguardo" description="Dónde queda el extracto y la molienda restante.">
        <div className="flex flex-col gap-5">
          <FieldGroup label="Extracto">
            <CampoValidado id="e-res-extracto">
              <ChoiceGrid cols={5}>
                {RES_EXTRACTO.map((label, index) => (
                  <ChoiceCard key={label} checked={!!form.resExtracto[index]} onChange={(checked) => patch({ resExtracto: form.resExtracto.map((x, i) => (i === index ? checked : x)) })} label={label} />
                ))}
              </ChoiceGrid>
            </CampoValidado>
          </FieldGroup>
          <FieldGroup label="Molienda restante">
            <ChoiceGrid cols={5}>
              {RES_MOLIDA.map((label, index) => (
                <ChoiceCard key={label} checked={!!form.resMolida[index]} onChange={(checked) => patch({ resMolida: form.resMolida.map((x, i) => (i === index ? checked : x)) })} label={label} />
              ))}
            </ChoiceGrid>
          </FieldGroup>
        </div>
        <Field label="Observaciones generales" htmlFor="e-obs" className="mt-5">
          <Textarea id="e-obs" rows={3} value={form.observaciones} onChange={(event) => patch({ observaciones: event.target.value })} />
        </Field>
      </FormCard>

      <FormCard id="sec-equipos" title="Equipos utilizados durante la extracción" description="Clave y folio de la bitácora de cada equipo (FX-TCB-…). Los equipos elegidos en los pasos aparecen automáticamente.">
        <EquiposUsados rows={rows} bitacoras={form.bitacoras} onBitacora={(ref, entry) => patch({ bitacoras: { ...form.bitacoras, [ref]: entry } })} extras={form.equiposExtra} onExtras={(extras) => patch({ equiposExtra: extras })} />
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

      <FormCard id="sec-personal" title="Personal responsable" description={protocol.hasLimpiezaPerson && form.fields.limpieza === "si" ? "Quién extrajo, quién realizó la limpieza y quién supervisó." : "Quién extrajo y quién supervisó."}>
        <div className="flex flex-col gap-3">
          {/* El formato oficial pide nombre y firma; el cargo no se guarda en este registro. */}
          <PersonCard title="Quien extrajo" {...firmante("extrajo")} name={form.quienExtrajo} onName={(v) => patch({ quienExtrajo: v })} signature={form.firmaExtrajo} onSignature={(v) => patch({ firmaExtrajo: v })} />
          {/* Solo si el protocolo tiene limpieza y esta extracción sí la requirió. */}
          {protocol.hasLimpiezaPerson && form.fields.limpieza === "si" ? (
            <PersonCard title="Quien realizó la limpieza" {...firmante("limpio")} firmanteSesion={false} name={form.quienLimpieza} onName={(v) => patch({ quienLimpieza: v })} signature={form.firmaLimpieza} onSignature={(v) => patch({ firmaLimpieza: v })} />
          ) : null}
          <PersonCard title="Quien supervisó" requires="revision" {...firmante("superviso")} firmanteSesion={false} name={form.quienSuperviso} onName={(v) => patch({ quienSuperviso: v })} signature={form.firmaSuperviso} onSignature={(v) => patch({ firmaSuperviso: v })} />
        </div>
        <Callout tone="info" title="Bitácoras" className="mt-4">
          Registrar el uso de cada equipo en su bitácora correspondiente y anotar el folio en la sección de equipos.
        </Callout>
      </FormCard>
    </FormPage>
  );
}
