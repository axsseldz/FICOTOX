import type { ReactNode } from "react";
import type { InventarioRow } from "@/lib/client/insumos";
import type { ApiRecord } from "@/lib/client/types";
import type { ExtractionType } from "@/lib/shared/extraction";
import type { FormSectionDef } from "../FormLayout";
import type { Problema } from "@/lib/client/mensajes";

/*
 * Un "protocolo" describe un formato de extraccion (ASP, DSP...): sus
 * pasos, los reactivos y consumibles de cantidad fija que se descuentan,
 * los equipos que se registran y como se dibujan sus secciones. El
 * formulario (`ExtractionForm`) es comun a todos los protocolos.
 */

interface StepDef {
  key: string;
  /* Texto que se guarda en pasos.checklist (los registros ASP viejos dependen de el). */
  value: string;
}

export interface FixedField {
  /* Campo de texto que recibe el lote del reactivo elegido como folio de preparacion (soluciones preparadas). */
  folioField?: string;
  /* Clave dentro de pasos_json donde se guarda la referencia del insumo. */
  key: string;
  tipo: "reactivo" | "consumible";
  cantidadFija: string;
  cantidadUnidad: string;
  /* Solo se descuenta si el paso esta marcado. */
  stepKey?: string;
  /* Se multiplica por el numero de tubos (muestras, replicas y blanco). */
  perTube?: boolean;
  /* Clave en pasos con la cantidad capturada por el analista (sustituye a cantidadFija). */
  editableAmountKey?: string;
  /* Condicion adicional (por ejemplo, solo si se hizo limpieza o hidrolisis). */
  enabledWhen?: (fields: Record<string, string>) => boolean;
  autoQuery: string;
  placeholder: string;
}

interface EquipoField {
  /* Clave dentro de pasos_json donde se guarda el id del equipo. */
  key: string;
  label: string;
  /* Texto para prellenar el equipo operativo unico que coincida (por omision, el label). */
  autoQuery?: string;
  /* Uso que aparece en la seccion "Equipos utilizados" (ej. "Licuadora · paso 2"). */
  uso: string;
}

/* Columna de una tabla de pesos; cada muestra tiene su valor y el de su replica. */
export interface WeightColumnPair {
  muestra: string;
  replica: string;
  label: string;
  kind: "number" | "text";
  placeholder?: string;
}

export interface WeightRow {
  key: number;
  id: string;
  organismo: string;
  sitio: string;
  esBlanco: boolean;
  replica: string;
  values: Record<string, string>;
}

export interface EquipoExtraRow {
  key: number;
  ref: string;
  uso: string;
}

export interface BitacoraEntry {
  clave: string;
  folio: string;
}

export interface ExtractionState {
  claveRevision: string;
  fechaEmision: string;
  estado: string;
  folio: string;
  fecha: string;
  hora: string;
  processingId: string;
  muestraTipo: "unica" | "lote";
  idInterno: string;
  summary: string;
  sampleRows: WeightRow[] | null;
  /* Entradas de registro_pesos sin id de muestra (formato viejo); se conservan al guardar. */
  legacyPesos: ApiRecord[];
  molienda: string;
  steps: Record<string, boolean>;
  /* Campos del protocolo (equipos, reactivos, folios, volumenes...), por clave de pasos_json. */
  fields: Record<string, string>;
  resExtracto: boolean[];
  resMolida: boolean[];
  observaciones: string;
  /* Clave y folio de bitacora por referencia (id) de equipo. */
  bitacoras: Record<string, BitacoraEntry>;
  equiposExtra: EquipoExtraRow[];
  inventarioRows: InventarioRow[];
  quienExtrajo: string;
  firmaExtrajo: string;
  quienLimpieza: string;
  firmaLimpieza: string;
  quienSuperviso: string;
  firmaSuperviso: string;
}

export interface ProtocolContext {
  form: ExtractionState;
  patch: (changes: Partial<ExtractionState>) => void;
  setField: (key: string, value: string) => void;
  setSteps: (changes: Record<string, boolean>) => void;
  /* Numero de tubos que reciben reactivo: muestras y blanco, cada uno con su replica. */
  tubeCount: number;
  step: (key: string, number: ReactNode, label: ReactNode, children?: ReactNode) => ReactNode;
  equipo: (key: string, placeholder: string) => ReactNode;
  fixed: (key: string) => ReactNode;
  text: (key: string, placeholder: string, options?: { id?: string; maxLength?: number; inputMode?: "text" | "decimal" | "numeric"; className?: string; ariaLabel?: string }) => ReactNode;
  weightTable: (columns: WeightColumnPair[], options?: { compact?: boolean }) => ReactNode;
}

export interface ExtractionProtocol {
  tipo: ExtractionType;
  /* Secciones propias del protocolo (entre "Muestra y molienda" y "Resguardo"). */
  sections: FormSectionDef[];
  /*
   * Reglas de las secciones obligatorias del protocolo, en orden: dan la
   * completitud de la guia y lo que falta al guardar (validacion compartida).
   * Los pasos se marcan por su id `e-paso-<clave>` y las tablas de pesos por
   * `e-pesos-<columna>`.
   */
  reglas: (form: ExtractionState) => Problema[];
  /* Completitud de las secciones opcionales (true si se llenaron, undefined si no). */
  sectionComplete: (id: string, form: ExtractionState) => boolean | undefined;
  steps: StepDef[];
  fixedFields: FixedField[];
  equipoFields: EquipoField[];
  /* Columnas de la tabla principal de pesos (paso "Registro de peso de la(s) submuestra(s)"). */
  weightColumns: WeightColumnPair[];
  /* Otras columnas por muestra (matraces, pesos pre/post calentamiento...); definen como se guardan. */
  moreWeightColumns: WeightColumnPair[];
  hasLimpiezaPerson: boolean;
  /* Valores iniciales de campos de texto (ej. temperatura del protocolo). */
  defaultFields: Record<string, string>;
  defaultSteps: (frozen: boolean) => Record<string, boolean>;
  /* Claves de pasos_json que se guardan como numero. */
  numericFields: string[];
  render: (ctx: ProtocolContext) => ReactNode;
}
