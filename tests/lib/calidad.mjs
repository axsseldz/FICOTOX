/*
 * Fase 11: utilidades de las pruebas de incidencias y no conformidades.
 * Importar despues de "./reauth-auto.mjs" (reautenticacion y aprobacion automatica).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { liberar, registrarEnvio } from "./envio.mjs";

export const BASE = process.env.BASE || "http://localhost:3100/api";
export const credenciales = JSON.parse(readFileSync(process.env.CREDENCIALES_ROLES, "utf8"));
export const Database = process.env.BETTER_SQLITE3 ? createRequire(import.meta.url)(process.env.BETTER_SQLITE3) : null;

export function crearCheck() {
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push({ name, ok });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  };
  const terminar = () => {
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} pasos OK`);
    process.exit(failed ? 1 : 0);
  };
  return { check, terminar };
}

export async function api(method, ruta, body, token, headers = {}) {
  const esForm = body instanceof FormData;
  const res = await fetch(`${BASE}${ruta}`, { method, headers: { ...(esForm ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: esForm ? body : body ? JSON.stringify(body) : undefined });
  const type = res.headers.get("content-type") || "";
  return { status: res.status, headers: res.headers, data: type.includes("json") ? await res.json().catch(() => null) : type.includes("pdf") ? Buffer.from(await res.arrayBuffer()) : await res.text() };
}

export const login = async (email, password = credenciales[email]) => (await api("POST", "/auth/login", { email, password })).data?.token;

export const EMAIL = {
  luis: "luis.castro@ficotox.local",
  ricardo: "ricardo.medina@ficotox.local",
  patricia: "patricia.luna@ficotox.local",
  ana: "ana.torres@ficotox.local",
  mariana: "mariana.delgado@ficotox.local",
  jorge: "jorge.ramirez@ficotox.local",
  hector: "hector.navarro@ficotox.local",
  diego: "diego.salinas@ficotox.local",
  gabriela: "gabriela.ortiz@ficotox.local",
  carmen: "carmen.aguilar@ficotox.local",
};

export async function sesiones() {
  const t = { qa: await login("qa@ficotox.local", "QaFicotox2026!") };
  for (const [k, email] of Object.entries(EMAIL)) t[k] = await login(email);
  const usuarios = (await api("GET", "/admin/usuarios", undefined, t.qa)).data?.items || [];
  const id = Object.fromEntries(Object.entries(EMAIL).map(([k, email]) => [k, usuarios.find((u) => u.email === email)?.id]));
  id.qa = usuarios.find((u) => u.email === "qa@ficotox.local")?.id;
  return { t, id };
}

const inspeccion = { checklist: Array.from({ length: 7 }, (_, i) => ({ requisito: `Requisito ${i + 1}`, estado: i === 6 ? "NA" : "C", observacion: null })), observaciones_generales: null };

/* Recepcion aceptada (opcional decision), procesamiento y extraccion DSP; asigna a los ids dados (lo hace Ricardo). */
export async function cadena(t, etiqueta, { asignar = [], decision = "aceptada", tipo = "E-D", equipos = [] } = {}) {
  const idInt = `${etiqueta}-${Date.now().toString(36).slice(-5)}`;
  const R = (await api("POST", "/samples/reception", { fecha_recepcion: "2026-09-20", hora_recepcion: "09:00", recibido_por: "QA", medio_recepcion: "directa", solicitante: `Cliente ${etiqueta}`, muestra_unica: true, id_interno: idInt, fecha_muestra: "2026-09-19", analisis: { tipos: ["toxinas_lipofilicas"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] }, inspeccion, decision_aceptacion: decision, aceptacion: { fecha: "2026-09-20", responsable: "QA", comunicacion_cliente: { medio: "correo", fecha: "2026-09-20", persona: "Cliente", respuesta: "Se informó y pidió continuar" } } }, t.qa)).data?.id;
  for (const u of asignar) await api("POST", `/samples/reception/${R}/asignaciones`, { usuario_id: u, motivo: "Asignación de prueba de calidad" }, t.ricardo);
  const P = (await api("POST", "/samples/processing", { recepcion_id: R, muestra_tipo: "unica", id_interno: idInt, fecha_procesamiento: "2026-09-20", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "Persona A", nombre_quien_superviso: "Persona B" }, t.qa)).data?.id;
  const E = await api("POST", "/samples/extraction", { tipo_registro: tipo, procesamiento_id: P, tipo_molienda: "fresca", id_interno: idInt, fecha_extraccion: "2026-09-20", registro_pesos: [{ id_muestra: idInt, replica: `${idInt}_R1`, peso_muestra: 2.01 }], equipos, nombre_quien_extrajo: "Persona A", nombre_quien_superviso: "Persona B" }, t.qa);
  return { R, P, E: E.data?.id, extraccion: E, idInt };
}

export const analisisDe = (c, extra = {}) => ({ tipo_analisis: "toxinas_lipofilicas", metodo: "hplc_ms_ms", extraccion_id: c.E, fecha_analisis: "2026-09-20", analista_nombre: "QA", resultados: [{ id_muestra: c.idInt, resultado: 50, unidad: "µg/kg", limite_regulatorio: 160, cumple: "cumple" }], ...extra });

/* Informe liberado (y opcionalmente enviado) con un analisis aprobado. */
export async function informeLiberado(t, etiqueta, { enviar = false } = {}) {
  const c = await cadena(t, etiqueta);
  const A = (await api("POST", "/samples/analysis", analisisDe(c), t.qa)).data?.id;
  await api("POST", `/samples/analysis/${A}/enviar-revision`, {}, t.qa);
  await api("POST", `/samples/analysis/${A}/revisar`, {}, t.ricardo);
  await api("POST", `/samples/analysis/${A}/aprobar`, {}, t.ricardo);
  const inf = (await api("POST", "/informes", { recepcion_id: c.R, analisis_ids: [A], cliente: { nombre: `Cliente ${etiqueta}`, correo: "cliente@ejemplo.mx" } }, t.qa)).data?.id;
  await api("POST", `/informes/${inf}/revisar`, {}, t.ricardo);
  await api("POST", `/informes/${inf}/autorizar`, {}, t.patricia);
  const lib = await liberar(BASE, t.patricia, inf);
  let envio = null;
  if (enviar) envio = await registrarEnvio(BASE, t.patricia, inf);
  return { ...c, A, informe: inf, liberado: lib.status === 200, enviado: enviar ? envio?.status === 200 : false };
}

export function fila(sql, ...params) {
  const d = new Database(process.env.TEST_DB_PATH, { readonly: true });
  try {
    return d.prepare(sql).get(...params);
  } finally {
    d.close();
  }
}

export function filas(sql, ...params) {
  const d = new Database(process.env.TEST_DB_PATH, { readonly: true });
  try {
    return d.prepare(sql).all(...params);
  } finally {
    d.close();
  }
}

export const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana" }).format(new Date());
/* Hoy (en Tijuana) más n días de calendario: sumar n × 24 h fallaba el día del cambio de horario. */
export const enDias = (n) => {
  const [anio, mes, dia] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana" }).format(new Date()).split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia + n)).toISOString().slice(0, 10);
};
