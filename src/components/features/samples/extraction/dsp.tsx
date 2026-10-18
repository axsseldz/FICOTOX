"use client";

import { Field, FormGrid, Textarea } from "@/components/ui/Field";
import { ChoiceCard, ChoiceGrid, FormCard } from "../FormLayout";
import type { ExtractionProtocol, ProtocolContext, WeightColumnPair } from "./types";
import { msg, type Problema } from "@/lib/client/mensajes";

/*
 * Formato de extraccion DSP (FX-TCF-GME-D): toxinas lipofilicas / acido
 * okadaico. Submuestra de 2 ± 0.05 g, doble extraccion con metanol 100 %,
 * aforo a 20 mL e hidrolisis alcalina con calentamiento a 76 °C.
 */

const STEPS = [
  { key: "dsp1", value: "Descongelar en oscuridad" },
  { key: "dsp2", value: "Homogeneizar en licuadora 30-45 s reincorporando el liquido de descongelacion" },
  { key: "dsp3", value: "Submuestrear por duplicado en tubo ambar para centrifuga (2 ± 0.05 g)" },
  { key: "dsp4", value: "Pesar agua desionizada para el blanco (2 ± 0.05 g)" },
  { key: "dsp6", value: "Adicionar 9 mL de metanol 100 % a muestras y blanco" },
  { key: "dsp7", value: "Agitar en vortex durante 3 min" },
  { key: "dsp8", value: "Centrifugar a 2,000 g o mas durante 10 min a 20 °C" },
  { key: "dsp9", value: "Transferir sobrenadante a matraz de aforacion de 20 mL" },
  { key: "dsp10", value: "Adicionar 9 mL de metanol 100 % al pellet" },
  { key: "dsp11", value: "Homogeneizar por 1 min" },
  { key: "dsp12", value: "Centrifugar a 2,000 g durante 10 min a 20 °C" },
  { key: "dsp13", value: "Recuperar sobrenadante, combinar y aforar a 20 mL con metanol 100 %" },
  { key: "dsp14", value: "Filtrar 1 mL con filtro de 0.45 µm y transferir a vial ambar" },
  { key: "dsp15", value: "Transferir 1 mL del extracto a vial ambar (hidrolisis)" },
  { key: "dsp16", value: "Agregar 125 µL de NaOH 2.5 M" },
  { key: "dsp17", value: "Agitar en vortex 30 s y pesar el tubo" },
  { key: "dsp18", value: "Calentar a 76 °C por 40 min" },
  { key: "dsp19", value: "Enfriar a temperatura ambiente" },
  { key: "dsp20", value: "Pesar de nuevo y completar al peso inicial con metanol 100 %" },
  { key: "dsp21", value: "Agregar 125 µL de HCl 2.5 M" },
  { key: "dsp22", value: "Agitar en vortex 30 s" },
  { key: "dsp23", value: "Filtrar 1 mL con filtro de 0.45 µm y transferir a vial ambar (hidrolizado)" },
];

const HIDROLISIS_STEPS = ["dsp15", "dsp16", "dsp17", "dsp18", "dsp19", "dsp20", "dsp21", "dsp22", "dsp23"];
const conHidrolisis = (fields: Record<string, string>) => fields.hidrolisis === "si";

const PESOS: WeightColumnPair[] = [{ muestra: "peso_muestra", replica: "peso_replica", label: "Peso (g)", kind: "number", placeholder: "2 ± 0.05" }];
const MATRACES: WeightColumnPair[] = [{ muestra: "matraz", replica: "matraz_replica", label: "Matraz", kind: "text", placeholder: "M-01" }];
const PESOS_PRE: WeightColumnPair[] = [{ muestra: "peso_pre_muestra", replica: "peso_pre_replica", label: "Peso precalentamiento (g)", kind: "number" }];
const PESOS_POST: WeightColumnPair[] = [{ muestra: "peso_post_muestra", replica: "peso_post_replica", label: "Peso post calentamiento (g)", kind: "number" }];

export const DSP_PROTOCOL: ExtractionProtocol = {
  tipo: "E-D",
  sections: [
    { id: "sec-extraccion", label: "Extracción" },
    { id: "sec-aforo", label: "Aforo y filtrado" },
    { id: "sec-hidrolisis", label: "Hidrólisis", optional: true },
  ],
  reglas: (form) => {
    const any = (keys: string[]) => keys.some((key) => !!form.steps[key]);
    const pesos = (form.sampleRows || []).some((row) => !row.esBlanco && !!row.id.trim() && !!String(row.values.peso_muestra || "").trim());
    const out: Problema[] = [];
    if (!any(["dsp3", "dsp4", "dsp6", "dsp7", "dsp8"])) out.push({ campo: "e-paso-dsp3", mensaje: msg.marca("al menos un paso de la extracción (3 a 8)"), seccion: "sec-extraccion", grupo: "Extracción" });
    if (!pesos) out.push({ campo: "e-pesos-peso_muestra", mensaje: msg.indica("el ID y el peso de al menos una submuestra"), seccion: "sec-extraccion", grupo: "Extracción" });
    if (!any(["dsp9", "dsp10", "dsp11", "dsp12", "dsp13", "dsp14"])) out.push({ campo: "e-paso-dsp9", mensaje: msg.marca("al menos un paso del aforo y filtrado (9 a 14)"), seccion: "sec-aforo", grupo: "Aforo y filtrado" });
    return out;
  },
  sectionComplete: (id, form) => {
    const any = (keys: string[]) => keys.some((key) => !!form.steps[key]);
    if (id === "sec-hidrolisis") return form.fields.hidrolisis === "no" ? true : form.fields.hidrolisis === "si" ? any(["dsp15", "dsp16", "dsp17", "dsp18", "dsp19", "dsp20", "dsp21", "dsp22", "dsp23"]) : undefined;
    return undefined;
  },
  steps: STEPS,
  fixedFields: [
    { key: "consumible_tubo_centrifuga", tipo: "consumible", cantidadFija: "1", cantidadUnidad: "pieza", stepKey: "dsp3", perTube: true, autoQuery: "tubo ambar centrifuga", placeholder: "Tubo ámbar para centrífuga (1 por tubo)" },
    { key: "reactivo_metanol_1", tipo: "reactivo", cantidadFija: "9", cantidadUnidad: "ml", stepKey: "dsp6", perTube: true, autoQuery: "metanol 100", placeholder: "Metanol 100 % (9 mL por tubo)" },
    { key: "reactivo_metanol_2", tipo: "reactivo", cantidadFija: "9", cantidadUnidad: "ml", stepKey: "dsp10", perTube: true, autoQuery: "metanol 100", placeholder: "Metanol 100 % (9 mL por tubo)" },
    { key: "reactivo_metanol_aforo", tipo: "reactivo", cantidadFija: "2", cantidadUnidad: "ml", stepKey: "dsp13", perTube: true, editableAmountKey: "cantidad_aforo_ml", autoQuery: "metanol 100", placeholder: "Metanol 100 % para aforar" },
    { key: "consumible_filtro", tipo: "consumible", cantidadFija: "1", cantidadUnidad: "pieza", stepKey: "dsp14", perTube: true, autoQuery: "filtro 0.45", placeholder: "Filtro 0.45 µm (1 por tubo)" },
    { key: "consumible_vial", tipo: "consumible", cantidadFija: "1", cantidadUnidad: "pieza", stepKey: "dsp14", perTube: true, autoQuery: "vial ambar", placeholder: "Vial ámbar para automuestreador (1 por tubo)" },
    { key: "consumible_vial_hidrolisis", tipo: "consumible", cantidadFija: "1", cantidadUnidad: "pieza", stepKey: "dsp15", perTube: true, enabledWhen: conHidrolisis, autoQuery: "vial ambar", placeholder: "Vial ámbar (1 por tubo)" },
    { key: "reactivo_naoh", tipo: "reactivo", cantidadFija: "0.125", cantidadUnidad: "ml", stepKey: "dsp16", perTube: true, enabledWhen: conHidrolisis, autoQuery: "naoh 2.5", placeholder: "NaOH 2.5 M (125 µL por tubo)" },
    { key: "reactivo_hcl", tipo: "reactivo", cantidadFija: "0.125", cantidadUnidad: "ml", stepKey: "dsp21", perTube: true, enabledWhen: conHidrolisis, autoQuery: "hcl 2.5", placeholder: "HCl 2.5 M (125 µL por tubo)" },
    { key: "consumible_filtro_hidrolisis", tipo: "consumible", cantidadFija: "1", cantidadUnidad: "pieza", stepKey: "dsp23", perTube: true, enabledWhen: conHidrolisis, autoQuery: "filtro 0.45", placeholder: "Filtro 0.45 µm (1 por tubo)" },
    { key: "consumible_vial_final", tipo: "consumible", cantidadFija: "1", cantidadUnidad: "pieza", stepKey: "dsp23", perTube: true, enabledWhen: conHidrolisis, autoQuery: "vial ambar", placeholder: "Vial ámbar (1 por tubo)" },
  ],
  equipoFields: [
    { key: "id_equipo_licuadora", label: "Licuadora", uso: "Licuadora · paso 2" },
    { key: "id_balanza", label: "Balanza", uso: "Balanza · pasos 3, 4, 17 y 20" },
    { key: "id_desionizador", label: "Desionizador", uso: "Desionizador · paso 4" },
    { key: "id_vortex", label: "Vórtex", uso: "Vórtex · pasos 7, 17 y 22" },
    { key: "id_cronometro", label: "Cronómetro", uso: "Cronómetro · pasos 7 y 18" },
    { key: "id_centrifuga", label: "Centrífuga", uso: "Centrífuga · pasos 8 y 12" },
    { key: "id_homogeneizador", label: "Homogeneizador", uso: "Homogeneizador · paso 11" },
    { key: "id_micropipeta", label: "Micropipeta", uso: "Micropipeta · pasos 16 y 21" },
    { key: "id_termoblock", label: "Termoblock / baño", uso: "Termoblock o baño · paso 18" },
    { key: "id_termometro", label: "Termómetro", uso: "Termómetro · paso 18" },
  ],
  weightColumns: PESOS,
  moreWeightColumns: [...MATRACES, ...PESOS_PRE, ...PESOS_POST],
  hasLimpiezaPerson: false,
  defaultFields: { filtro: "0.45 µm", cantidad_aforo_ml: "2", temperatura_calentamiento: "76", tiempo_calentamiento_min: "40" },
  numericFields: ["cantidad_aforo_ml", "temperatura_calentamiento", "tiempo_calentamiento_min"],
  defaultSteps: (frozen) => ({
    dsp1: frozen,
    dsp2: frozen,
    dsp3: true,
    dsp4: true,
    dsp6: true,
    dsp7: true,
    dsp8: true,
    dsp9: true,
    dsp10: true,
    dsp11: true,
    dsp12: true,
    dsp13: true,
    dsp14: true,
  }),
  render: (ctx: ProtocolContext) => <DspSections ctx={ctx} />,
};

function DspSections({ ctx }: { ctx: ProtocolContext }) {
  const { form, step, equipo, fixed, text, setField, setSteps, weightTable } = ctx;
  const hidrolisis = form.fields.hidrolisis || "";

  return (
    <>
      <FormCard id="sec-extraccion" title="Extracción" description="Pasos 1 a 8 del formato. Los reactivos de cantidad fija se descuentan al guardar, multiplicados por el número de tubos (muestras, réplicas y blanco).">
        <div className="mb-3 text-[12.5px] font-medium text-ink-3">Molienda congelada</div>
        <div className="mb-5 flex flex-col">
          {step("dsp1", 1, "Descongelar en oscuridad")}
          {step("dsp2", 2, "Homogeneizar en licuadora por 30 a 45 s reincorporando el líquido de descongelación", equipo("id_equipo_licuadora", "Licuadora"))}
        </div>
        <div className="mb-3 text-[12.5px] font-medium text-ink-3">Submuestreo y blanco</div>
        <div className="mb-5 flex flex-col">
          {step(
            "dsp3",
            3,
            "Submuestrear por duplicado en un tubo ámbar para centrífuga (2 ± 0.05 g)",
            <>
              {equipo("id_balanza", "Balanza")}
              {text("folio_verificacion_balanza", "Folio de verificación de la balanza", { maxLength: 60 })}
              {fixed("consumible_tubo_centrifuga")}
            </>,
          )}
          {step(
            "dsp4",
            4,
            "Pesar agua desionizada para el blanco (2 ± 0.05 g)",
            <>
              {text("folio_verificacion_balanza_blanco", "Folio de verificación de la balanza (blanco)", { maxLength: 60 })}
              {equipo("id_desionizador", "Desionizador")}
            </>,
          )}
        </div>
        <div className="mb-3 text-[12.5px] font-medium text-ink-3">Paso 5 · Registro de peso de las submuestras</div>
        <div className="mb-5">{weightTable(PESOS)}</div>
        <div className="mb-3 text-[12.5px] font-medium text-ink-3">Primera extracción</div>
        <div className="flex flex-col">
          {step("dsp6", 6, "Adicionar a la(s) muestra(s) y el blanco 9 mL de metanol 100 %", fixed("reactivo_metanol_1"))}
          {step(
            "dsp7",
            7,
            "Agitar en vórtex durante 3 min",
            <>
              {equipo("id_vortex", "Vórtex")}
              {equipo("id_cronometro", "Cronómetro")}
            </>,
          )}
          {step("dsp8", 8, "Centrifugar a 2,000 × g o más durante 10 minutos a 20 °C", equipo("id_centrifuga", "Centrífuga"))}
        </div>
      </FormCard>

      <FormCard id="sec-aforo" title="Aforo y filtrado" description="Pasos 9 a 14 del formato. Segunda extracción del pellet, combinación de sobrenadantes y aforo a 20 mL.">
        <div className="flex flex-col">
          {step("dsp9", 9, "Transferir el sobrenadante a un matraz de aforación de 20 mL e identificar el matraz utilizado para cada muestra")}
        </div>
        <div className="my-4">{weightTable(MATRACES, { compact: true })}</div>
        <div className="flex flex-col">
          {step("dsp10", 10, "Adicionar 9 mL de metanol 100 % al pellet restante", fixed("reactivo_metanol_2"))}
          {step("dsp11", 11, "Homogeneizar por 1 min", equipo("id_homogeneizador", "Homogeneizador"))}
          {step("dsp12", 12, "Centrifugar a 2,000 × g durante 10 minutos a 20 °C")}
          {step(
            "dsp13",
            13,
            "Recuperar el sobrenadante, combinarlo con el anterior en su matraz y aforar a 20 mL con metanol 100 %",
            <>
              {fixed("reactivo_metanol_aforo")}
              {text("cantidad_aforo_ml", "mL de metanol por tubo para aforar", { inputMode: "decimal", ariaLabel: "Mililitros de metanol por tubo para aforar" })}
            </>,
          )}
          {step(
            "dsp14",
            14,
            "Filtrar 1 mL de sobrenadante (para recuperar al menos 0.5 mL) con filtro de 0.45 µm o menor y transferir a un vial ámbar para automuestreador",
            <>
              {fixed("consumible_filtro")}
              {fixed("consumible_vial")}
            </>,
          )}
        </div>
        <FormGrid cols={3} className="mt-5">
          <Field label="Volumen filtrado (mL)" htmlFor="e-vf">
            {text("volumen_filtrado", "", { id: "e-vf", inputMode: "decimal", ariaLabel: "Volumen filtrado" })}
          </Field>
          <Field label="Volumen recuperado (mL)" htmlFor="e-vr">
            {text("volumen_recuperado", "", { id: "e-vr", inputMode: "decimal", ariaLabel: "Volumen recuperado" })}
          </Field>
          <Field label="Filtro utilizado" htmlFor="e-filtro">
            {text("filtro", "0.45 µm", { id: "e-filtro", ariaLabel: "Filtro utilizado" })}
          </Field>
        </FormGrid>
        <Field label="Observaciones sobre la extracción" htmlFor="e-obs-proc" className="mt-4">
          <Textarea id="e-obs-proc" rows={3} value={form.fields.observaciones_extraccion || ""} onChange={(event) => setField("observaciones_extraccion", event.target.value)} />
        </Field>
      </FormCard>

      <FormCard id="sec-hidrolisis" title="Hidrólisis del extracto" description="Pasos 15 a 23 del formato. Hidrólisis alcalina del extracto para liberar los ésteres del ácido okadaico, según sea el caso.">
        <ChoiceGrid cols={2} className="mb-5">
          <ChoiceCard
            type="radio"
            name="e-hidrolisis"
            checked={hidrolisis === "si"}
            onChange={() => {
              setField("hidrolisis", "si");
              setSteps(Object.fromEntries(HIDROLISIS_STEPS.map((key) => [key, true])));
            }}
            label="Sí se realizó hidrólisis"
            description="Se registran NaOH, calentamiento a 76 °C, pesos antes y después, y HCl."
          />
          <ChoiceCard
            type="radio"
            name="e-hidrolisis"
            checked={hidrolisis === "no"}
            onChange={() => {
              setField("hidrolisis", "no");
              setSteps(Object.fromEntries(HIDROLISIS_STEPS.map((key) => [key, false])));
            }}
            label="No se realizó hidrólisis"
            description="El extracto del paso 14 es el final."
          />
        </ChoiceGrid>
        {hidrolisis === "si" ? (
          <div className="flex flex-col">
            {step("dsp15", 15, "Transferir 1 mL del extracto obtenido en el paso 13 a un vial ámbar para automuestreador", fixed("consumible_vial_hidrolisis"))}
            {step(
              "dsp16",
              16,
              "Agregar 125 µL de NaOH 2.5 M",
              <>
                {equipo("id_micropipeta", "Micropipeta")}
                {fixed("reactivo_naoh")}
              </>,
            )}
            {step("dsp17", 17, "Agitar en vórtex 30 s y pesar el tubo")}
            <div className="my-3">
              <p className="mb-2 text-[12.5px] font-medium text-ink-3">Peso precalentamiento</p>
              {weightTable(PESOS_PRE, { compact: true })}
            </div>
            {step(
              "dsp18",
              18,
              "Calentar la muestra a 76 °C por 40 minutos",
              <>
                {equipo("id_termoblock", "Termoblock o baño")}
                {equipo("id_termometro", "Termómetro")}
                <div className="grid grid-cols-2 gap-2">
                  {text("temperatura_calentamiento", "°C", { inputMode: "decimal", ariaLabel: "Temperatura de calentamiento (°C)" })}
                  {text("tiempo_calentamiento_min", "min", { inputMode: "numeric", ariaLabel: "Tiempo de calentamiento (min)" })}
                </div>
              </>,
            )}
            {step("dsp19", 19, "Dejar enfriar la(s) muestra(s) a temperatura ambiente")}
            {step("dsp20", 20, "Pesar nuevamente el tubo y completar al peso inicial con metanol 100 %")}
            <div className="my-3">
              <p className="mb-2 text-[12.5px] font-medium text-ink-3">Peso post calentamiento</p>
              {weightTable(PESOS_POST, { compact: true })}
            </div>
            {step("dsp21", 21, "Agregar 125 µL de HCl 2.5 M", fixed("reactivo_hcl"))}
            {step("dsp22", 22, "Agitar en vórtex 30 s")}
            {step(
              "dsp23",
              23,
              "Filtrar 1 mL de sobrenadante (recuperar al menos 0.5 mL) con filtro de 0.45 µm o menor y transferir a un vial ámbar",
              <>
                {fixed("consumible_filtro_hidrolisis")}
                {fixed("consumible_vial_final")}
              </>,
            )}
          </div>
        ) : null}
      </FormCard>
    </>
  );
}
