/*
 * Datos de apoyo para las pruebas: la base de prueba parte vacia (solo roles y
 * usuarios del reinicio de la Fase 0), asi que antes de las suites se crean,
 * por la API y con el usuario QA, los datos que estas esperan encontrar:
 *
 * - Equipo "Centrifuga" operativo con la calibracion vencida (aviso en DSP).
 * - Reactivos "Metanol HPLC", "Acido acetico" y "2-Propanol", y un consumible con existencia.
 * - (La persona que supervisa en la prueba DSP es un usuario del catalogo de roles.)
 * - Una cadena R 1 (aceptada) -> P 1 -> E-A 1 con la muestra D45-2, como la
 *   extraccion ASP que ya existia antes de la serie DSP.
 *
 * Solo corre contra el servidor de pruebas. Escribe los ids creados en
 * `instance/test/datos-apoyo.json` para las pruebas de navegador.
 */
import "./lib/reauth-auto.mjs";
import { writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE || "http://localhost:3100/api";
const OUT = process.env.DATOS_APOYO_FILE;

async function api(method, ruta, body, token) {
  const res = await fetch(`${BASE}${ruta}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (res.status >= 300) throw new Error(`${method} ${ruta} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const login = await api("POST", "/auth/login", { email: "qa@ficotox.local", password: "QaFicotox2026!" });
const T = login.token;

const centrifuga = await api("POST", "/inventory/equipos", { nombre: "Centrifuga", estado: "operativo", fecha_prox_calibracion: "2026-05-22" }, T);
// Fase 4: el equipo se autoriza al darlo de alta (FX-THF-AP). Lo otorga el Coord. del Area Tecnica al usuario QA (nadie se autoriza a si mismo).
if (process.env.CREDENCIALES_ROLES) {
  const { readFileSync } = await import("node:fs");
  const credenciales = JSON.parse(readFileSync(process.env.CREDENCIALES_ROLES, "utf8"));
  const coord = await api("POST", "/auth/login", { email: "ricardo.medina@ficotox.local", password: credenciales["ricardo.medina@ficotox.local"] });
  const personas = (await api("GET", "/admin/usuarios", undefined, T)).items || [];
  for (const email of ["qa@ficotox.local", "luis.castro@ficotox.local"]) {
    const destino = personas.find((u) => u.email === email)?.id;
    if (destino) await api("POST", `/admin/usuarios/${destino}/autorizaciones`, { tipo: "equipo", clave: String(centrifuga.id), folio_fx_thf_ap: "FX-THF-AP-PRUEBAS", motivo: "Equipo dado de alta para las pruebas" }, coord.token);
  }
}
// La existencia inicial es capacidad × piezas (cantidad_actual no se captura): sin existencia no se puede consumir.
const metanol = await api("POST", "/inventory/reactivos", { tipo_reactivo: "alcoholes_solventes", nombre: "Metanol HPLC", producto: "Metanol HPLC", capacidad: 1, unidad_capacidad: "L", piezas: 8 }, T);
const acetico = await api("POST", "/inventory/reactivos", { tipo_reactivo: "acidos", nombre: "Acido acetico", producto: "Acido acetico", capacidad: 2.5, unidad_capacidad: "L", piezas: 1 }, T);
// La prueba de navegador da de baja y reactiva este reactivo.
await api("POST", "/inventory/reactivos", { tipo_reactivo: "alcoholes_solventes", nombre: "2-Propanol (Alcohol isopropilico)", producto: "2-Propanol (Alcohol isopropilico)", capacidad: 1, unidad_capacidad: "L", piezas: 4 }, T);
const bolsa = await api("POST", "/consumables", { producto: "Bolsa roja RPBI", piezas: 20, stock_maximo: 20 }, T);

const inspeccion = {
  checklist: [
    "Se presentan en talla comercial.",
    "Se presentan sin alteraciones (estado de descomposición, valvas abiertas/rotas, cuerpos eviscerados).",
    "En el momento de su presentación no han transcurrido más de 24 horas después de haber sido extraídas.",
    "Se presentan en bolsa o botella de plástico transparente, sin alteraciones, como contenedor primario.",
    "El contenedor primario es transportado en una hielera con blue ice/hielo suficiente para mantener la temperatura entre 4 y 10 °C.",
    "Se presentan en cantidad o volumen suficiente para el(los) análisis solicitados.",
    "Se presenta con algún tipo de fijador (en caso positivo especificar el tipo).",
  ].map((requisito, i) => ({ requisito, estado: i === 6 ? "NA" : "C", observacion: null })),
  observaciones_generales: null,
};
const recepcion = await api(
  "POST",
  "/samples/reception",
  {
    fecha_recepcion: "2026-05-22",
    hora_recepcion: "16:20",
    recibido_por: "QA",
    medio_recepcion: "directa",
    solicitante: "prueba",
    muestra_unica: true,
    id_interno: "D45-2",
    fecha_muestra: "2026-05-22",
    analisis: { tipos: ["acido_domoico"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] },
    inspeccion,
    decision_aceptacion: "aceptada",
    aceptacion: { fecha: "2026-05-22", responsable: "QA" },
  },
  T,
);
const procesamiento = await api(
  "POST",
  "/samples/processing",
  {
    recepcion_id: recepcion.id,
    folio_recepcion_num: recepcion.folio_num,
    fecha_procesamiento: "2026-05-22",
    hora_procesamiento: "13:34",
    muestra_tipo: "unica",
    id_interno: "D45-2",
    tipo_organismo: ["bivalvos"],
    parte_organismo: ["cuerpo_completo"],
    resguardo: { entregado_extraccion: true },
    nombre_quien_proceso: "QA",
    nombre_quien_superviso: "Supervisor QA",
    uso_inventario: [{ tipo: "consumible", ref: String(bolsa.id), cantidad: 1 }],
  },
  T,
);
const extraccionAsp = await api(
  "POST",
  "/samples/extraction",
  {
    tipo_registro: "E-A",
    fecha_extraccion: "2026-05-22",
    procesamiento_id: procesamiento.id,
    folio_procesamiento_num: procesamiento.folio_num,
    muestra_tipo: "unica",
    id_interno: "D45-2",
    tipo_molienda: "fresca",
    // Copia de los pasos del registro E-A 1 de la base anterior (formato ASP completo).
    pasos: {
      checklist: ["Submuestrear por duplicado en tubo protegido de luz", "Pesar agua desionizada para blanco", "Adicionar 16 mL de metanol agua 50 50", "Homogeneizar durante 3 minutos", "Centrifugar a 3000g o mas durante 10 minutos", "Filtrar sobrenadante a vial ambar", "Evaluar limpieza del extracto"],
      id_equipo_licuadora: null,
      id_ba1: null,
      id_probeta: "Centrifuga",
      folio_reactivo: String(metanol.id),
      id_homogeneizador: "Centrifuga",
      id_cronometro: "Centrifuga",
      limpieza: "si",
      observaciones_extraccion: null,
      limp_micropipeta_1: "Centrifuga",
      limp_reactivo_metanol: String(metanol.id),
      limp_micropipeta_2: "Centrifuga",
      limp_reactivo_acetico: String(acetico.id),
      filtrado: { volumen_filtrado: "1.5", volumen_recuperado: "1.5", filtro: "0.45 µm" },
      resguardo_extracto: { entregado_fx106: true, refrigerador_re1: false, congelador_co1: false, congelador_co2: false, congelador_co3: false },
      resguardo_molienda_restante: { no_sobro: true, refrigerador_re1: false, congelador_co1: false, congelador_co2: false, congelador_co3: false },
    },
    registro_pesos: [{ id_muestra: "D45-2", organismo: "bivalvos", peso_muestra: 10, replica: "D45-2_R1", peso_replica: 10 }],
    uso_inventario: [
      { tipo: "reactivo", ref: String(metanol.id), cantidad: 0.016 },
      { tipo: "reactivo", ref: String(metanol.id), cantidad: 0.006 },
      { tipo: "reactivo", ref: String(acetico.id), cantidad: 0.003 },
    ],
    nombre_quien_extrajo: "QA",
    nombre_quien_limpieza: "QA",
    nombre_quien_superviso: "Supervisor QA",
  },
  T,
);

const datos = {
  equipo_id: centrifuga.id,
  reactivo_metanol_id: metanol.id,
  reactivo_acetico_id: acetico.id,
  consumible_id: bolsa.id,
  recepcion_id: recepcion.id,
  procesamiento_id: procesamiento.id,
  extraccion_asp_id: extraccionAsp.id,
};
if (OUT) writeFileSync(OUT, `${JSON.stringify(datos, null, 2)}\n`);
console.log(`Datos de apoyo creados${OUT ? ` (${path.basename(OUT)})` : ""}: ${JSON.stringify(datos)}`);
