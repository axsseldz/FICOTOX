"use client";

import { Field, FormGrid, Textarea } from "@/components/ui/Field";
import { Callout, ChoiceCard, ChoiceGrid, FormCard } from "../FormLayout";
import type { ExtractionProtocol, ProtocolContext } from "./types";
import { msg, type Problema } from "@/lib/client/mensajes";

/*
 * Formato de extraccion ASP (FX-TCF-GME-A): acido domoico.
 * Las claves de pasos y los textos del checklist se conservan tal cual
 * para que los registros existentes sigan cargando.
 */

const STEPS = [
  { key: "extrStep1", value: "Descongelar en oscuridad" },
  { key: "extrStep2", value: "Homogeneizar 30-45s sin descartar liquido de descongelacion" },
  { key: "extrStep3", value: "Submuestrear por duplicado en tubo protegido de luz" },
  { key: "extrStep4", value: "Pesar agua desionizada para blanco" },
  { key: "extrStep5", value: "Adicionar 16 mL de metanol agua 50 50" },
  { key: "extrStep6", value: "Homogeneizar durante 3 minutos" },
  { key: "extrStep7", value: "Centrifugar a 3000g o mas durante 10 minutos" },
  { key: "extrStep10", value: "Filtrar sobrenadante a vial ambar" },
  { key: "extrStep8", value: "Evaluar limpieza del extracto" },
  { key: "extrLimpStep2", value: "Lavar cartucho con agua desionizada" },
  { key: "limp3", value: "Descartar líquido" },
  { key: "extrStep9", value: "Limpieza del extracto" },
  { key: "extrLimpStep5", value: "Lavar con agua destilada" },
  { key: "limp6", value: "Descartar líquido hasta sequedad" },
  { key: "extrLimpStep7", value: "Colocar tubos Falcon" },
  { key: "limp8", value: "Adicionar ácido acético" },
  { key: "limp9", value: "Agitar en vortex" },
  { key: "limp10", value: "Transferir alícuota a vial ámbar" },
];

const conLimpieza = (fields: Record<string, string>) => fields.limpieza === "si";

const RES_EXTRACTO_DESC = "Si no se analiza de inmediato, almacenar en oscuridad y congelación hasta por una semana.";

export const ASP_PROTOCOL: ExtractionProtocol = {
  tipo: "E-A",
  sections: [
    { id: "sec-extraccion", label: "Extracción" },
    { id: "sec-pesos", label: "Registro de pesos" },
    { id: "sec-filtrado", label: "Filtrado final" },
    { id: "sec-limpieza", label: "Limpieza del extracto", optional: true },
  ],
  reglas: (form) => {
    const any = (keys: string[]) => keys.some((key) => !!form.steps[key]);
    const pesos = (form.sampleRows || []).some((row) => !row.esBlanco && !!row.id.trim() && !!String(row.values.peso_muestra || "").trim());
    const out: Problema[] = [];
    if (!any(["extrStep3", "extrStep4", "extrStep5", "extrStep6", "extrStep7"])) out.push({ campo: "e-paso-extrStep3", mensaje: msg.marca("al menos un paso de la extracción (3 a 8)"), seccion: "sec-extraccion", grupo: "Extracción" });
    if (!pesos) out.push({ campo: "e-pesos-peso_muestra", mensaje: msg.indica("el ID y el peso de al menos una submuestra"), seccion: "sec-pesos", grupo: "Registro de pesos" });
    if (!form.steps.extrStep10) out.push({ campo: "e-paso-extrStep10", mensaje: msg.marca("el paso 10 (filtrado y transferencia al vial)"), seccion: "sec-filtrado", grupo: "Filtrado final" });
    return out;
  },
  sectionComplete: (id, form) => {
    const any = (keys: string[]) => keys.some((key) => !!form.steps[key]);
    // Limpieza (opcional): sin decidir = sin evaluar; "no requirió" completa; "sí" completa con algún paso marcado.
    if (id === "sec-limpieza") return form.fields.limpieza === "no" ? true : form.fields.limpieza === "si" ? any(["extrStep8", "extrLimpStep2", "limp3", "extrStep9", "extrLimpStep5", "limp6", "extrLimpStep7", "limp8", "limp9", "limp10"]) : undefined;
    return undefined;
  },
  steps: STEPS,
  fixedFields: [
    { key: "folio_reactivo", tipo: "reactivo", cantidadFija: "16", cantidadUnidad: "ml", stepKey: "extrStep5", perTube: true, autoQuery: "metanol agua 50 50", placeholder: "Metanol:agua 50:50 (16 mL por tubo)", folioField: "folio_preparacion_metanol_agua" },
    { key: "consumible_filtro", tipo: "consumible", cantidadFija: "1", cantidadUnidad: "pieza", stepKey: "extrStep10", perTube: true, autoQuery: "filtro 0.45", placeholder: "Filtro 0.45 µm (1 por tubo)" },
    { key: "consumible_vial", tipo: "consumible", cantidadFija: "1", cantidadUnidad: "pieza", stepKey: "extrStep10", perTube: true, autoQuery: "vial ambar", placeholder: "Vial ámbar para automuestreador (1 por tubo)" },
    { key: "limp_consumible_cartucho", tipo: "consumible", cantidadFija: "1", cantidadUnidad: "pieza", stepKey: "extrStep8", perTube: true, enabledWhen: conLimpieza, autoQuery: "bond elut sax", placeholder: "Cartucho Bond Elut SAX 500 mg (1 por tubo)" },
    { key: "limp_reactivo_metanol", tipo: "reactivo", cantidadFija: "6", cantidadUnidad: "ml", stepKey: "extrStep8", enabledWhen: conLimpieza, autoQuery: "metanol 100", placeholder: "Metanol 100 % (6 mL)" },
    { key: "limp_reactivo_desionizada", tipo: "reactivo", cantidadFija: "6", cantidadUnidad: "ml", stepKey: "extrLimpStep2", enabledWhen: conLimpieza, autoQuery: "agua desionizada", placeholder: "Agua desionizada (6 mL)" },
    { key: "limp_reactivo_destilada", tipo: "reactivo", cantidadFija: "6", cantidadUnidad: "ml", stepKey: "extrLimpStep5", enabledWhen: conLimpieza, autoQuery: "agua destilada", placeholder: "Agua destilada (6 mL)" },
    { key: "limp_consumible_falcon15", tipo: "consumible", cantidadFija: "1", cantidadUnidad: "pieza", stepKey: "extrLimpStep7", enabledWhen: conLimpieza, autoQuery: "tubo falcon 15 ml", placeholder: "Tubo Falcon 15 mL (1 pieza)" },
    { key: "limp_reactivo_acetico", tipo: "reactivo", cantidadFija: "3", cantidadUnidad: "ml", stepKey: "limp8", enabledWhen: conLimpieza, autoQuery: "acido acetico 10", placeholder: "Ácido acético 10 % (3 mL)", folioField: "folio_preparacion_acetico" },
    { key: "limp_total_puntas_ref", tipo: "consumible", cantidadFija: "0", cantidadUnidad: "pieza", editableAmountKey: "limp_total_puntas_cantidad", enabledWhen: conLimpieza, autoQuery: "punta micropipeta", placeholder: "Puntas de micropipeta" },
  ],
  equipoFields: [
    { key: "id_equipo_licuadora", label: "Licuadora", uso: "Licuadora · paso 2" },
    { key: "id_balanza", label: "Balanza", uso: "Balanza · pasos 3 y 4" },
    { key: "id_probeta", label: "Probeta", uso: "Probeta · paso 6" },
    { key: "id_homogeneizador", label: "Homogeneizador", uso: "Homogeneizador · paso 7" },
    { key: "id_cronometro", label: "Cronómetro", uso: "Cronómetro · paso 7" },
    { key: "id_centrifuga", label: "Centrífuga", uso: "Centrífuga · paso 8" },
    { key: "limp_micropipeta_1", label: "Micropipeta", uso: "Micropipeta · limpieza 1" },
    { key: "limp_micropipeta_2", label: "Micropipeta", uso: "Micropipeta · limpieza 2" },
    { key: "limp_micropipeta_4", label: "Micropipeta", uso: "Micropipeta · limpieza 4" },
    { key: "limp_micropipeta_5", label: "Micropipeta", uso: "Micropipeta · limpieza 5" },
    { key: "limp_micropipeta_8", label: "Micropipeta", uso: "Micropipeta · limpieza 8" },
    { key: "limp_vortex", label: "Vórtex", uso: "Vórtex · limpieza 9" },
    { key: "limp_micropipeta_10", label: "Micropipeta", uso: "Micropipeta · limpieza 10" },
  ],
  weightColumns: [{ muestra: "peso_muestra", replica: "peso_replica", label: "Peso (g)", kind: "number", placeholder: "4 ± 0.1" }],
  moreWeightColumns: [],
  hasLimpiezaPerson: true,
  defaultFields: { filtro: "0.45 µm" },
  numericFields: ["limp_total_puntas_cantidad"],
  defaultSteps: (frozen) => ({ extrStep1: frozen, extrStep2: frozen, extrStep3: true, extrStep4: true, extrStep5: true, extrStep6: true, extrStep7: true, extrStep8: true, extrStep10: true, extrStep9: false }),
  render: (ctx: ProtocolContext) => <AspSections ctx={ctx} />,
};

function AspSections({ ctx }: { ctx: ProtocolContext }) {
  const { form, step, equipo, fixed, text, setField, setSteps, weightTable } = ctx;
  const limpieza = form.fields.limpieza || "";

  return (
    <>
      <FormCard id="sec-extraccion" title="Extracción" description="Pasos 1 a 8 del formato. Los reactivos de cantidad fija se descuentan al guardar, multiplicados por el número de tubos (muestras, réplicas y blanco).">
        <div className="mb-3 text-[12.5px] font-medium text-ink-3">Molienda congelada</div>
        <div className="mb-5 flex flex-col">
          {step("extrStep1", 1, "Descongelar en oscuridad")}
          {step("extrStep2", 2, "Homogeneizar por 30 a 45 s sin descartar el líquido de descongelación", equipo("id_equipo_licuadora", "Licuadora"))}
        </div>
        <div className="mb-3 text-[12.5px] font-medium text-ink-3">Submuestreo y blanco</div>
        <div className="mb-5 flex flex-col">
          {step(
            "extrStep3",
            3,
            "Submuestrear por duplicado en un tubo de centrífuga protegido de la luz (4 ± 0.1 g)",
            <>
              {equipo("id_balanza", "Balanza")}
              {text("folio_verificacion_balanza", "Folio de verificación de la balanza", { maxLength: 60 })}
            </>,
          )}
          {step("extrStep4", 4, "Pesar agua desionizada para el blanco (4 ± 0.1 g)", text("folio_verificacion_balanza_blanco", "Folio de verificación de la balanza (blanco)", { maxLength: 60 }))}
        </div>
        <div className="mb-3 text-[12.5px] font-medium text-ink-3">Preparación y homogeneización</div>
        <div className="flex flex-col">
          {step(
            "extrStep5",
            6,
            "Adicionar a la(s) muestra(s) y el blanco 16 mL de metanol:agua (50:50)",
            <>
              {equipo("id_probeta", "Probeta")}
              {fixed("folio_reactivo")}
              {text("folio_preparacion_metanol_agua", "Folio de preparación del reactivo (metanol:agua)", { maxLength: 60 })}
            </>,
          )}
          {step(
            "extrStep6",
            7,
            "Homogeneizar durante 3 minutos",
            <>
              {equipo("id_homogeneizador", "Homogeneizador")}
              {equipo("id_cronometro", "Cronómetro")}
            </>,
          )}
          {step("extrStep7", 8, "Centrifugar a 3,000 g o más durante 10 minutos, de ser posible a 4 °C", equipo("id_centrifuga", "Centrífuga"))}
        </div>
      </FormCard>

      <FormCard id="sec-pesos" title="Registro de pesos" description="Paso 5 del formato. Peso de cada submuestra y de su réplica (4 ± 0.1 g). El blanco es agua desionizada.">
        {weightTable(ASP_PROTOCOL.weightColumns)}
      </FormCard>

      <FormCard id="sec-filtrado" title="Filtrado final" description="Paso 10 del formato. Filtrar 1.5 mL de sobrenadante para recuperar al menos 1 mL con filtro de 0.45 µm y transferir a vial ámbar.">
        <FormGrid cols={3}>
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
        <div className="mt-4 flex flex-col">
          {step(
            "extrStep10",
            10,
            "Filtrar con filtro de 0.45 µm y transferir a vial ámbar para automuestreador",
            <>
              {fixed("consumible_filtro")}
              {fixed("consumible_vial")}
            </>,
          )}
        </div>
        <Field label="Observaciones sobre la extracción" htmlFor="e-obs-proc" className="mt-4">
          <Textarea id="e-obs-proc" rows={3} value={form.fields.observaciones_extraccion || ""} onChange={(event) => setField("observaciones_extraccion", event.target.value)} />
        </Field>
      </FormCard>

      <FormCard id="sec-limpieza" title="Limpieza del extracto" description="Paso 9 del formato. Solo si la naturaleza de la muestra lo requiere (cartucho Bond Elut SAX, 500 mg, 3 mL).">
        <ChoiceGrid cols={2} className="mb-5">
          <ChoiceCard
            type="radio"
            name="e-limpieza"
            checked={limpieza === "si"}
            onChange={() => {
              setField("limpieza", "si");
              setSteps({ extrStep8: true, extrLimpStep2: true, limp3: true, extrStep9: true, extrLimpStep5: true, limp6: true, extrLimpStep7: true, limp8: true, limp9: true, limp10: true });
            }}
            label="Sí requirió limpieza"
            description="Se registran los pasos de acondicionamiento, carga y elución."
          />
          <ChoiceCard type="radio" name="e-limpieza" checked={limpieza === "no"} onChange={() => setField("limpieza", "no")} label="No requirió limpieza" description="Continúa con el filtrado final." />
        </ChoiceGrid>
        {limpieza === "si" ? (
          <div className="flex flex-col">
            {step(
              "extrStep8",
              1,
              "Adicionar 6 mL de metanol 100 % en 2 rondas de 3 mL (acondicionamiento del cartucho Bond Elut SAX)",
              <>
                {fixed("limp_consumible_cartucho")}
                {equipo("limp_micropipeta_1", "Micropipeta")}
                {fixed("limp_reactivo_metanol")}
              </>,
            )}
            {step(
              "extrLimpStep2",
              2,
              "Lavar con 6 mL de agua desionizada en 2 rondas de 3 mL",
              <>
                {equipo("limp_micropipeta_2", "Micropipeta")}
                {fixed("limp_reactivo_desionizada")}
              </>,
            )}
            {step("limp3", 3, "Descartar el líquido")}
            {step("extrStep9", 4, "Cargar 3 mL de la muestra de interés (filtrar antes con jeringa 0.45 µm directo al cartucho) y filtrar a flujo lento", equipo("limp_micropipeta_4", "Micropipeta"))}
            {step(
              "extrLimpStep5",
              5,
              "Lavar con 6 mL de agua destilada en dos rondas de 3 mL",
              <>
                {equipo("limp_micropipeta_5", "Micropipeta")}
                {fixed("limp_reactivo_destilada")}
              </>,
            )}
            {step("limp6", 6, "Descartar el líquido hasta sequedad")}
            {step("extrLimpStep7", 7, "Colocar tubos Falcon de 15 mL para colectar la muestra final", fixed("limp_consumible_falcon15"))}
            {step(
              "limp8",
              8,
              "Adicionar 3 mL de ácido acético al 10 % y filtrar a flujo lento",
              <>
                {equipo("limp_micropipeta_8", "Micropipeta")}
                {fixed("limp_reactivo_acetico")}
                {text("folio_preparacion_acetico", "Folio de preparación del reactivo (ácido acético 10 %)", { maxLength: 60 })}
              </>,
            )}
            {step("limp9", 9, "Agitar en vórtex", equipo("limp_vortex", "Vórtex"))}
            {step("limp10", 10, "Transferir con micropipeta una alícuota de 1 mL a un vial ámbar para automuestreador", equipo("limp_micropipeta_10", "Micropipeta"))}
            <div className="mt-4 grid gap-3 rounded-[14px] bg-surface-2 p-4 ring-1 ring-line md:grid-cols-[1fr_140px]">
              <Field label="Puntas de micropipeta utilizadas" hint="Se descuentan del inventario.">
                {fixed("limp_total_puntas_ref")}
              </Field>
              <Field label="Cantidad">{text("limp_total_puntas_cantidad", "0", { inputMode: "numeric", ariaLabel: "Cantidad de puntas" })}</Field>
            </div>
          </div>
        ) : null}
        <Callout tone="info" title="Almacenamiento temporal" className="mt-4">
          {RES_EXTRACTO_DESC}
        </Callout>
      </FormCard>
    </>
  );
}
