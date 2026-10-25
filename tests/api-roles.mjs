/*
 * Permisos finos y varios roles por usuario (Fase 1; FX-MO-2-1, seccion 5).
 *
 *   node tests/api-roles.mjs                 # corrida completa
 *   node tests/api-roles.mjs --tras-reinicio # tras reiniciar el servidor: catalogo, sesiones y vencimientos
 *
 * La matriz esperada esta escrita a mano aqui (a proposito independiente de
 * scripts/roles-catalogo.json). Comprueba:
 * - la base tiene los 10 roles con exactamente esa matriz; no existe "Super Admin"
 *   ni el modulo "aprobaciones"; reiniciar no amplia permisos;
 * - cada rol: sesion con sus roles vigentes y permisos { modulo: { accion: alcance } },
 *   y por modulo casos permitidos (2xx/404 de negocio) y rechazados (403);
 * - un caso por cada alcance que se aplica ya (propio, estado, recepcion,
 *   preparacion, borrador, bitacora, uso, mantenimiento, movimientos);
 * - varios roles: union, rol vencido no cuenta, revocar surte efecto sin volver
 *   a entrar, nadie se asigna ni revoca roles a si mismo, siempre queda un
 *   administrador;
 * - las 4 reglas de combinacion prohibida al asignar y al editar un rol;
 * - cargo con el que se actua (ELEGIR_CARGO, X-Actuar-Como) en revision y
 *   autorizacion de un informe, y que el PDF lo muestra;
 * - bitacora con motivo e integridad.
 */
import "./lib/reauth-auto.mjs";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import zlib from "node:zlib";
import { asignarRecepcion, autorizarTodo } from "./lib/autorizar.mjs";

const Database = createRequire(import.meta.url)(process.env.BETTER_SQLITE3 || "better-sqlite3");
const BASE = process.env.BASE || "http://localhost:3100/api";
const TRAS_REINICIO = process.argv.includes("--tras-reinicio");
const credenciales = JSON.parse(readFileSync(process.env.CREDENCIALES_ROLES, "utf8"));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ""}`);
};

async function api(method, path, body, token, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await res.json().catch(() => null) : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data };
}

for (let i = 0; i < 60; i += 1) {
  try {
    if ((await fetch(`${BASE}/health`)).ok) break;
  } catch {
    /* esperando */
  }
  await new Promise((r) => setTimeout(r, 1000));
}

/* ---------- Matriz esperada (seccion 4 del prompt de la Fase 1) ---------- */

const MODULOS = ["usuarios", "documentos", "muestras", "ensayos", "informes", "equipos", "inventario", "calidad", "respaldos", "compras"];
const ACCIONES = ["V", "C", "E", "R", "A", "AN", "G"];
/* Fase 2: "supervisado" ya se aplica (queda pendiente del visto bueno), no es diferido. Fase 11: "incidencias" tampoco. */
const DIFERIDOS = new Set(["asignado", "proyecto", "tecnico", "investigacion", "autorizados", "administrativo", "limitado", "auditoria"]);
const f = (modulo, acciones, alcance = "total") => acciones.split(" ").map((accion) => ({ modulo, accion, alcance }));
/* Documentos SGC (migracion 22): acciones documentales, sin alcance. */
const PERSONAL_DOC = "documento_consultar_vigente documento_proponer documento_elaborar documento_enviar_revision documento_acusar_lectura";
const TODAS_DOC = "documento_consultar_vigente documento_proponer documento_crear_ficha documento_elaborar documento_enviar_revision documento_revisar documento_autorizar documento_publicar documento_obsoletar documento_consultar_historico documento_acusar_lectura documento_administrar_lecturas documento_externo_gestionar lista_maestra_exportar";

const MATRIZ = {
  "Administrador técnico del sistema": { email: "jorge.ramirez@ficotox.local", filas: [...f("usuarios", "G"), ...f("muestras", "V", "estado"), ...f("equipos", "V"), ...f("calidad", "V", "bitacora"), ...f("respaldos", "V G")] },
  "Responsable General": {
    email: "patricia.luna@ficotox.local",
    // Fase 3: el Responsable General aprueba los cambios de acceso (usuarios = V A).
    filas: [...f("usuarios", "V A"), ...f("documentos", "documento_consultar_vigente documento_proponer documento_autorizar documento_consultar_historico documento_acusar_lectura lista_maestra_exportar"), ...f("muestras", "V AN"), ...f("ensayos", "V R AN"), ...f("informes", "V R A AN"), ...f("equipos", "V AN"), ...f("inventario", "V AN"), ...f("calidad", "V R A AN"), ...f("respaldos", "V"), ...f("compras", "V A")],
  },
  "Coordinador/a de Mejora Continua": {
    email: "ana.torres@ficotox.local",
    filas: [...f("usuarios", "V A"), ...f("documentos", TODAS_DOC), ...f("muestras", "V"), ...f("ensayos", "V"), ...f("informes", "V"), ...f("equipos", "V"), ...f("inventario", "V"), ...f("calidad", "G R A AN"), ...f("respaldos", "V"), ...f("compras", "V")],
  },
  "Coordinador/a del Área Técnica": {
    email: "ricardo.medina@ficotox.local",
    // Migracion 21: tambien aprueba cambios de acceso (usuarios:A). Migracion 26: edita borradores de informe (informes:E).
    filas: [...f("usuarios", "V A"), ...f("documentos", "documento_consultar_vigente documento_proponer documento_elaborar documento_enviar_revision documento_revisar documento_autorizar documento_consultar_historico documento_acusar_lectura"), ...f("muestras", "C E R A AN"), ...f("ensayos", "C E R A AN"), ...f("informes", "C E R A AN"), ...f("equipos", "G R AN"), ...f("inventario", "G R AN"), ...f("calidad", "C R"), ...f("compras", "V")],
  },
  "Coordinador/a de Investigación y Desarrollo": {
    email: "gabriela.ortiz@ficotox.local",
    filas: [...f("usuarios", "V"), ...f("documentos", "documento_consultar_vigente documento_proponer documento_elaborar documento_enviar_revision documento_revisar documento_consultar_historico documento_acusar_lectura"), ...f("muestras", "C E", "proyecto"), ...f("ensayos", "C E R", "proyecto"), ...f("informes", "C R", "proyecto"), ...f("equipos", "C E R"), ...f("inventario", "C E"), ...f("calidad", "C E"), ...f("compras", "V")],
  },
  "Técnico Analista": {
    email: "luis.castro@ficotox.local",
    filas: [...f("usuarios", "V", "propio"), ...f("documentos", PERSONAL_DOC), ...f("muestras", "V E", "asignado"), ...f("ensayos", "C E"), ...f("informes", "C", "borrador"), ...f("equipos", "C E", "uso"), ...f("inventario", "C E", "movimientos"), ...f("calidad", "C", "incidencias")],
  },
  "Técnico Auxiliar": {
    email: "mariana.delgado@ficotox.local",
    filas: [...f("usuarios", "V", "propio"), ...f("documentos", PERSONAL_DOC), ...f("muestras", "C E", "recepcion"), ...f("ensayos", "C E", "preparacion"), ...f("equipos", "C E", "uso"), ...f("inventario", "C E", "movimientos"), ...f("calidad", "C", "incidencias")],
  },
  "Administrador/a Auxiliar": {
    email: "carmen.aguilar@ficotox.local",
    filas: [...f("usuarios", "V", "limitado"), ...f("documentos", PERSONAL_DOC), ...f("muestras", "V", "estado"), ...f("equipos", "C E", "mantenimiento"), ...f("inventario", "C E", "administrativo"), ...f("calidad", "C", "incidencias"), ...f("compras", "G")],
  },
  "Auditor Interno": {
    email: "hector.navarro@ficotox.local",
    filas: [...MODULOS.filter((m) => m !== "documentos").flatMap((m) => f(m, "V")), ...f("documentos", "documento_consultar_vigente documento_consultar_historico lista_maestra_exportar"), ...f("calidad", "C E", "auditoria")],
  },
  "Estudiante / personal en formación": {
    email: "diego.salinas@ficotox.local",
    filas: [...f("usuarios", "V", "propio"), ...f("documentos", "documento_consultar_vigente documento_acusar_lectura"), ...f("muestras", "C E", "asignado"), ...f("ensayos", "C E", "borrador"), ...f("equipos", "C E", "supervisado"), ...f("inventario", "C E", "supervisado"), ...f("calidad", "C", "incidencias")],
  },
};

const firma = (filas) => filas.map((x) => `${x.modulo}:${x.accion}:${x.alcance}`).sort().join("|");

/*
 * Reglas de la especificacion: G -> todas; C/E/R/A/AN -> V. Alcances diferidos
 * (Fase 2): en usuarios = solo V de la propia cuenta; en calidad = sin acceso.
 * Fase 11: calidad "incidencias" ya se aplica (C incidencias -> V incidencias).
 */
function expandir(filas) {
  const out = {};
  const add = (m, a, al) => ((out[m] ||= {})[a] ||= new Set()).add(al);
  for (const { modulo, accion, alcance } of filas) {
    // Documentos SGC: cada accion documental tal cual y, con cualquiera, V (acceso al modulo).
    if (modulo === "documentos") {
      add(modulo, accion, "total");
      add(modulo, "V", "total");
      continue;
    }
    if (modulo === "usuarios" && DIFERIDOS.has(alcance)) {
      add(modulo, "V", "propio");
      continue;
    }
    if (modulo === "calidad" && DIFERIDOS.has(alcance)) continue;
    // Fase 3.1: en usuarios, G no implica A.
    for (const a of accion === "G" ? ACCIONES.filter((x) => !(modulo === "usuarios" && x === "A")) : [accion]) {
      add(modulo, a, alcance);
      if (a !== "V") add(modulo, "V", ["propio", "estado", "bitacora", "incidencias"].includes(alcance) || DIFERIDOS.has(alcance) ? alcance : "total");
    }
  }
  return out;
}
const rango = (a) => (a === "total" ? 0 : DIFERIDOS.has(a) ? 1 : 2);
function mapaEsperado(filas) {
  const e = expandir(filas);
  const out = {};
  for (const [m, acciones] of Object.entries(e)) {
    out[m] = {};
    for (const [a, set] of Object.entries(acciones)) out[m][a] = [...set].sort((x, y) => rango(x) - rango(y))[0];
  }
  return out;
}
function alcancePermite(al, ctx = {}) {
  if (al === "total" || DIFERIDOS.has(al)) return true;
  return {
    propio: ctx.propio === true,
    estado: true,
    supervisado: true,
    recepcion: ctx.objeto === "recepcion",
    preparacion: ctx.objeto === "procesamiento",
    borrador: ctx.borrador === true,
    bitacora: !ctx.objeto || ctx.objeto === "bitacora",
    uso: ctx.objeto === "uso_equipo",
    mantenimiento: ctx.objeto === "mantenimiento",
    movimientos: ctx.objeto === "movimiento",
    // Fase 11: solo sobre incidencias, NC y acciones (nunca la bitacora).
    incidencias: ["incidencia", "nc", "accion_correctiva"].includes(ctx.objeto),
  }[al] === true;
}
const permitido = (filas, modulo, accion, ctx) => [...(expandir(filas)[modulo]?.[accion] || [])].some((al) => alcancePermite(al, ctx));

/* ---------- Catalogo (visto por QA) ---------- */

const qaLogin = await api("POST", "/auth/login", { email: "qa@ficotox.local", password: "QaFicotox2026!" });
let QA = qaLogin.data?.token;
check("login QA (rol de prueba con G en todos los modulos)", qaLogin.status === 200 && !!QA, `status ${qaLogin.status}`);

const catalogo = (await api("GET", "/admin/permissions", undefined, QA)).data || {};
const modulosApi = (catalogo.modulos || []).map((m) => m.clave);
check("catalogo de modulos: los 9 de la Fase 1 más respaldos (sin 'aprobaciones')", modulosApi.join(",") === MODULOS.join(",") && !modulosApi.includes("aprobaciones"), modulosApi.join(","));
check("catalogo de acciones V C E R A AN G", (catalogo.acciones || []).map((a) => a.clave).join(" ") === ACCIONES.join(" "));

const roles = (await api("GET", "/admin/roles", undefined, QA)).data?.items || [];
const rolId = (nombre) => roles.find((r) => r.nombre === nombre)?.id;
check('no existe el rol "Super Admin"', !roles.some((r) => /super\s*admin/i.test(String(r.nombre))), roles.map((r) => r.nombre).join(" | "));
const faltantes = Object.keys(MATRIZ).filter((nombre) => !rolId(nombre));
check("existen los 10 roles del catalogo", faltantes.length === 0, faltantes.join(", "));
for (const [nombre, esperado] of Object.entries(MATRIZ)) {
  const id = rolId(nombre);
  if (!id) continue;
  const detalle = (await api("GET", `/admin/roles/${id}`, undefined, QA)).data;
  const reales = (detalle?.permisos || []).map((p) => ({ modulo: p.modulo, accion: p.accion, alcance: p.alcance }));
  const sobran = reales.filter((r) => !esperado.filas.some((e) => firma([e]) === firma([r]))).map((r) => firma([r]));
  const faltan = esperado.filas.filter((e) => !reales.some((r) => firma([e]) === firma([r]))).map((e) => firma([e]));
  check(`${nombre}: matriz exacta en la base${TRAS_REINICIO ? " tras reiniciar" : ""}`, firma(reales) === firma(esperado.filas), `sobran=[${sobran.join(", ")}] faltan=[${faltan.join(", ")}]`);
  check(`${nombre}: es_sistemico = ${nombre === "Administrador técnico del sistema"}`, !!Number(detalle?.role?.es_sistemico) === (nombre === "Administrador técnico del sistema"));
}

/* ---------- Sesion de cada rol ---------- */

const tokens = {};
const usuarioIds = {};
for (const [nombre, esperado] of Object.entries(MATRIZ)) {
  const login = await api("POST", "/auth/login", { email: esperado.email, password: credenciales[esperado.email] });
  tokens[nombre] = login.data?.token;
  usuarioIds[nombre] = login.data?.user?.id;
  const me = await api("GET", "/auth/me", undefined, tokens[nombre]);
  const esperadoMapa = mapaEsperado(esperado.filas);
  const igual = (mapa) => JSON.stringify(Object.fromEntries(Object.entries(mapa || {}).filter(([, a]) => Object.keys(a).length).map(([m, a]) => [m, Object.fromEntries(Object.entries(a).sort())]).sort())) === JSON.stringify(Object.fromEntries(Object.entries(esperadoMapa).map(([m, a]) => [m, Object.fromEntries(Object.entries(a).sort())]).sort()));
  check(`${nombre}: login y /auth/me traen su rol vigente`, login.status === 200 && (login.data?.roles || []).map((r) => r.nombre).join() === nombre && (me.data?.roles || []).map((r) => r.nombre).join() === nombre, `login ${login.status} roles=${JSON.stringify((me.data?.roles || []).map((r) => r.nombre))}`);
  check(`${nombre}: permisos de la sesion { modulo: { accion: alcance } } exactos`, igual(login.data?.permissions) && igual(me.data?.permissions), JSON.stringify(me.data?.permissions));
}

if (!TRAS_REINICIO) {
  /* ---------- Datos de apoyo (QA) ---------- */
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
  const recepcionBase = (id) => ({ fecha_recepcion: "2026-09-20", hora_recepcion: "09:00", recibido_por: "QA", medio_recepcion: "directa", solicitante: "Cliente roles", muestra_unica: true, id_interno: id, fecha_muestra: "2026-09-19", analisis: { tipos: ["toxinas_lipofilicas"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] } });
  const aceptada = (id) => ({ ...recepcionBase(id), inspeccion, decision_aceptacion: "aceptada", aceptacion: { fecha: "2026-09-20", responsable: "QA" } });
  const procesamiento = (recepcion, id) => ({ recepcion_id: recepcion, muestra_tipo: "unica", id_interno: id, fecha_procesamiento: "2026-09-20", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "QA" });
  const extraccion = (proc, id, extra = {}) => ({ tipo_registro: "E-D", procesamiento_id: proc, tipo_molienda: "fresca", id_interno: id, fecha_extraccion: "2026-09-20", registro_pesos: [{ id_muestra: id, replica: `${id}_R1`, peso_muestra: 2.01 }], nombre_quien_extrajo: "QA", ...extra });
  const analisis = (ext, id) => ({ tipo_analisis: "toxinas_lipofilicas", metodo: "hplc_ms_ms", extraccion_id: ext, fecha_analisis: "2026-09-20", analista_nombre: "QA", resultados: [{ id_muestra: id, resultado: 50, unidad: "µg/kg", limite_regulatorio: 160, cumple: "cumple" }] });

  const RA = (await api("POST", "/samples/reception", aceptada("ROL-A"), QA)).data?.id;
  // Fase 5: las personas de la matriz trabajan la muestra RA asignada (la regla de asignacion se prueba en api-muestras).
  await asignarRecepcion(BASE, QA, RA, Object.values(usuarioIds));
  const PA = (await api("POST", "/samples/processing", procesamiento(RA, "ROL-A"), QA)).data?.id;
  const EA = (await api("POST", "/samples/extraction", extraccion(PA, "ROL-A"), QA)).data?.id;
  const equipos = (await api("GET", "/inventory/equipos", undefined, QA)).data?.items || [];
  const equipoId = equipos[0]?.id;
  const reactivos = (await api("GET", "/inventory/reactivos?search=", undefined, QA)).data?.items || [];
  const reactivoId = reactivos.find((r) => /metanol/i.test(String(r.producto || r.nombre)))?.id || reactivos[0]?.id;
  // Fase 4: el uso del equipo en una extraccion exige su autorizacion FX-THF-AP (la otorga QA, que tiene ensayos:A).
  const luisId = ((await api("GET", "/admin/usuarios", undefined, QA)).data?.items || []).find((u) => u.email === "luis.castro@ficotox.local")?.id;
  await api("POST", `/admin/usuarios/${luisId}/autorizaciones`, { tipo: "equipo", clave: String(equipoId), folio_fx_thf_ap: "FX-THF-AP-PRUEBAS", motivo: "Equipo usado en la prueba de alcances" }, QA);
  check("datos de apoyo del modulo de roles", !!RA && !!PA && !!EA && !!equipoId && !!reactivoId, `R=${RA} P=${PA} E=${EA} equipo=${equipoId} reactivo=${reactivoId}`);

  /* ---------- Por rol y modulo: permitido (no 403) / rechazado (403) ---------- */
  let n = 0;
  const unico = () => `${Date.now()}-${(n += 1)}`;
  const SONDAS = [
    // Con alcance "propio" la lista se permite pero solo trae la propia cuenta (se prueba aparte).
    { modulo: "usuarios", accion: "V", ctx: { propio: true }, m: "GET", p: () => "/admin/usuarios" },
    { modulo: "usuarios", accion: "G", m: "POST", p: () => "/admin/roles", b: () => ({ nombre: `Rol sonda ${unico()}`, motivo: "Prueba de permisos", permisos: [] }) },
    // Documentos SGC: crear fichas solo con documento_crear_ficha (sin archivo: 400, no 403).
    { modulo: "documentos", accion: "documento_crear_ficha", m: "POST", p: () => "/sgc/documentos", b: () => ({}) },
    { modulo: "muestras", accion: "V", m: "GET", p: () => "/samples/reception?search=" },
    { modulo: "muestras", accion: "C", ctx: { objeto: "recepcion", borrador: true }, m: "POST", p: () => "/samples/reception", b: () => recepcionBase(`SONDA-${unico()}`) },
    { modulo: "muestras", accion: "E", ctx: { objeto: "recepcion", borrador: true }, m: "PUT", p: () => "/samples/reception/999999", b: () => ({ ...recepcionBase("X"), folio_num: 999999 }) },
    { modulo: "muestras", accion: "A", m: "POST", p: () => "/samples/reception/999999/disposicion", b: () => ({ tipo: "rpbi", fecha: "2026-09-20", responsable: "QA" }) },
    { modulo: "muestras", accion: "AN", m: "POST", p: () => "/samples/reception/999999/anular", b: () => ({ motivo: "Sonda de permisos" }) },
    { modulo: "ensayos", accion: "V", m: "GET", p: () => "/samples/analysis" },
    { modulo: "ensayos", accion: "C", ctx: { objeto: "procesamiento", borrador: true }, m: "POST", p: () => "/samples/processing", b: () => procesamiento(RA, `SONDA-${unico()}`) },
    { modulo: "ensayos", accion: "C", ctx: { objeto: "extraccion", borrador: true }, m: "POST", p: () => "/samples/extraction", b: () => extraccion(PA, `SONDA-${unico()}`) },
    { modulo: "ensayos", accion: "E", ctx: { objeto: "procesamiento", borrador: true }, m: "PUT", p: () => "/samples/processing/999999", b: () => ({ ...procesamiento(RA, "X"), folio_num: 999999 }) },
    { modulo: "ensayos", accion: "R", m: "POST", p: () => "/samples/analysis/999999/revisar", b: () => ({}) },
    { modulo: "ensayos", accion: "A", m: "POST", p: () => "/samples/analysis/999999/aprobar", b: () => ({}) },
    { modulo: "ensayos", accion: "AN", m: "POST", p: () => "/samples/processing/999999/anular", b: () => ({ motivo: "Sonda de permisos" }) },
    { modulo: "informes", accion: "V", m: "GET", p: () => "/informes" },
    { modulo: "informes", accion: "C", ctx: { objeto: "informe", borrador: true }, m: "POST", p: () => "/informes", b: () => ({ recepcion_id: RA, analisis_ids: [] }) },
    { modulo: "informes", accion: "E", ctx: { objeto: "informe", borrador: true }, m: "PUT", p: () => "/informes/999999", b: () => ({ recepcion_id: RA }) },
    { modulo: "informes", accion: "R", m: "POST", p: () => "/informes/999999/revisar", b: () => ({}) },
    { modulo: "informes", accion: "A", m: "POST", p: () => "/informes/999999/autorizar", b: () => ({}) },
    { modulo: "informes", accion: "AN", m: "POST", p: () => "/informes/999999/anular", b: () => ({ motivo: "Sonda de permisos" }) },
    { modulo: "equipos", accion: "V", m: "GET", p: () => "/inventory/equipos" },
    { modulo: "equipos", accion: "C", ctx: { objeto: "equipo" }, m: "POST", p: () => "/inventory/equipos", b: () => ({ nombre: `Equipo sonda ${unico()}`, estado: "operativo" }) },
    { modulo: "equipos", accion: "C", ctx: { objeto: "mantenimiento" }, m: "POST", p: () => "/inventory/mantenimientos", b: () => ({ id_equipo: equipoId, tipo: "preventivo", fecha_programada: "2027-01-15", estado: "programado" }) },
    { modulo: "equipos", accion: "E", ctx: { objeto: "equipo" }, m: "PUT", p: () => "/inventory/equipos/999999", b: () => ({ nombre: "X" }) },
    { modulo: "equipos", accion: "AN", m: "DELETE", p: () => "/inventory/equipos/999999", b: () => ({ motivo: "Sonda de permisos" }) },
    { modulo: "equipos", accion: "G", m: "POST", p: () => "/inventory/equipos/999999/reactivar", b: () => ({ motivo: "Sonda de permisos" }) },
    { modulo: "inventario", accion: "V", m: "GET", p: () => "/inventory/reactivos?search=" },
    { modulo: "inventario", accion: "C", ctx: { objeto: "catalogo_inventario" }, m: "POST", p: () => "/inventory/reactivos", b: () => ({ producto: `Reactivo sonda ${unico()}`, cantidad_actual: 1, unidad: "L" }) },
    { modulo: "inventario", accion: "C", ctx: { objeto: "movimiento" }, m: "POST", p: () => `/inventory/reactivos/${reactivoId}/refill`, b: () => ({ cantidad: 0.01, motivo: "Sonda de permisos" }) },
    { modulo: "inventario", accion: "E", ctx: { objeto: "catalogo_inventario" }, m: "PUT", p: () => "/inventory/reactivos/999999", b: () => ({ producto: "X" }) },
    { modulo: "inventario", accion: "AN", m: "DELETE", p: () => "/inventory/reactivos/999999", b: () => ({ motivo: "Sonda de permisos" }) },
    { modulo: "inventario", accion: "G", m: "POST", p: () => "/inventory/reactivos/999999/reactivar", b: () => ({ motivo: "Sonda de permisos" }) },
    { modulo: "calidad", accion: "V", ctx: { objeto: "bitacora" }, m: "GET", p: () => "/audit?limit=1" },
  ];
  for (const [nombre, esperado] of Object.entries(MATRIZ)) {
    const token = tokens[nombre];
    for (const modulo of MODULOS) {
      const sondas = SONDAS.filter((s) => s.modulo === modulo);
      const errores = [];
      let positivos = 0;
      let negativos = 0;
      for (const sonda of sondas) {
        const debe = permitido(esperado.filas, modulo, sonda.accion, sonda.ctx);
        const r = await api(sonda.m, sonda.p(), sonda.b?.(), token);
        const ok = debe ? r.status !== 403 && r.status < 500 : r.status === 403;
        if (debe) positivos += 1;
        else negativos += 1;
        if (!ok) errores.push(`${sonda.accion} ${sonda.m} ${sonda.p()} -> ${r.status} (esperado ${debe ? "permitido" : "403"}) ${r.data?.message || ""}`);
      }
      if (modulo === "compras") {
        const permisos = (await api("GET", "/auth/me", undefined, token)).data?.permissions?.compras || {};
        const esperadoCompras = mapaEsperado(esperado.filas).compras || {};
        check(`${nombre} · compras: sin pantallas; la sesion refleja ${JSON.stringify(esperadoCompras)}`, JSON.stringify(permisos) === JSON.stringify(esperadoCompras), JSON.stringify(permisos));
        continue;
      }
      check(`${nombre} · ${modulo}: ${positivos} permitidos y ${negativos} rechazados con 403`, errores.length === 0, errores.join("; "));
    }
  }

  /* ---------- Alcances aplicados ---------- */
  const T = (nombre) => tokens[nombre];
  {
    // propio
    const lista = await api("GET", "/admin/usuarios", undefined, T("Técnico Analista"));
    const otro = await api("GET", `/admin/usuarios/${usuarioIds["Administrador técnico del sistema"]}`, undefined, T("Técnico Analista"));
    const propia = await api("GET", `/admin/usuarios/${usuarioIds["Técnico Analista"]}`, undefined, T("Técnico Analista"));
    const rolesProp = await api("GET", "/admin/roles", undefined, T("Técnico Analista"));
    check("alcance propio: el Analista solo ve su cuenta; otra cuenta y el catalogo de roles -> 403", lista.status === 200 && lista.data?.items?.length === 1 && lista.data.items[0].email === "luis.castro@ficotox.local" && otro.status === 403 && propia.status === 200 && rolesProp.status === 403, `lista=${lista.data?.items?.length} otro=${otro.status} propia=${propia.status} roles=${rolesProp.status}`);
  }
  for (const nombre of ["Administrador/a Auxiliar", "Administrador técnico del sistema"]) {
    // estado
    const lista = await api("GET", "/samples/reception?search=ROL-A", undefined, T(nombre));
    const item = (await api("GET", `/samples/reception/${RA}`, undefined, T(nombre))).data?.item || {};
    const fila = (lista.data?.items || [])[0] || {};
    const sinTecnicos = (x) => x.solo_estado === true && !("analisis" in x) && !("inspeccion" in x) && !("datos_custodio" in x) && !("lote_muestras" in x) && !("procesamientos" in x);
    check(`alcance estado (${nombre}): lista y detalle solo con folio, solicitante, fechas y estado`, sinTecnicos(fila) && sinTecnicos(item) && !!item.folio_num && !!item.estado && !!item.solicitante, `fila=${Object.keys(fila).join(",")} item=${Object.keys(item).join(",")}`);
    // La bitacora tampoco deja ver los datos tecnicos de la recepcion (ni por el historial ni por la entrada).
    const historial = (await api("GET", `/audit?entidad=muestras_recepcion&entidad_id=${RA}`, undefined, T(nombre))).data?.items || [];
    const entrada = historial[0] ? (await api("GET", `/audit/${historial[0].id}`, undefined, T(nombre))).data?.item : null;
    const completo = (await api("GET", `/audit?entidad=muestras_recepcion&entidad_id=${RA}`, undefined, QA)).data?.items || [];
    // En el Inicio, el siguiente paso de un flujo que la persona no puede dar sale como "ver" (sin boton de accion).
    const enCurso = (await api("GET", "/inicio/en-curso", undefined, T(nombre))).data?.items || [];
    check(`alcance estado (${nombre}): en el Inicio los pasos que no puede dar salen como pendientes ("ver")`, enCurso.length > 0 && enCurso.every((f) => f.siguiente?.accion === "ver" && /^\/muestras\/recepcion\//.test(String(f.siguiente?.href))), enCurso.slice(0, 3).map((f) => `${f.folio}:${f.siguiente?.accion}:${f.siguiente?.label}`).join(" | "));
    check(`alcance estado (${nombre}): la bitacora muestra quien y cuando pero no los datos de la recepcion`, historial.length > 0 && historial.every((e) => e.datos_restringidos === true && !Object.keys(e.cambios || {}).length) && (!entrada || (entrada.datos_restringidos === true && entrada.datos_nuevos === null)) && completo.some((e) => !e.datos_restringidos && Object.keys(e.cambios || {}).length), `n=${historial.length} restringidos=${historial.filter((e) => e.datos_restringidos).length} entrada=${JSON.stringify(entrada && { r: entrada.datos_restringidos, n: entrada.datos_nuevos })}`);
  }
  {
    // recepcion + preparacion (Tecnico Auxiliar)
    const aux = T("Técnico Auxiliar");
    const rec = await api("POST", "/samples/reception", aceptada("AUX-1"), aux);
    await asignarRecepcion(BASE, QA, rec.data?.id, [usuarioIds["Técnico Auxiliar"]]);
    const proc = await api("POST", "/samples/processing", procesamiento(rec.data?.id || RA, "AUX-1"), aux);
    const ext = await api("POST", "/samples/extraction", extraccion(proc.data?.id || PA, "AUX-1"), aux);
    const ana = await api("POST", "/samples/analysis", analisis(EA, "ROL-A"), aux);
    check("alcances recepcion/preparacion: el Auxiliar crea recepcion (201) y procesamiento (201); extraccion y analisis -> 403", rec.status === 201 && proc.status === 201 && ext.status === 403 && ana.status === 403, `rec ${rec.status} proc ${proc.status} ext ${ext.status} ana ${ana.status}`);
  }
  {
    // borrador (Estudiante): crea y edita mientras esta registrado; un registro que ya avanzo -> 403
    const est = T("Estudiante / personal en formación");
    const proc = await api("POST", "/samples/processing", procesamiento(RA, "EST-1"), est);
    const folio = (await api("GET", `/samples/processing/${proc.data?.id}`, undefined, QA)).data?.item?.folio_num;
    const editar = await api("PUT", `/samples/processing/${proc.data?.id}`, { ...procesamiento(RA, "EST-1"), folio_num: folio, observaciones_generales: "Editado en borrador" }, est);
    const folioPA = (await api("GET", `/samples/processing/${PA}`, undefined, QA)).data?.item;
    const avanzado = await api("PUT", `/samples/processing/${PA}`, { ...procesamiento(RA, "ROL-A"), folio_num: folioPA?.folio_num }, est);
    check(`alcance borrador: el Estudiante crea (201) y edita su procesamiento registrado (200); uno ya ${folioPA?.estado} -> 403`, proc.status === 201 && editar.status === 200 && avanzado.status === 403, `crear ${proc.status} editar ${editar.status} ${editar.data?.message || ""} avanzado ${avanzado.status}`);
    const inf = await api("POST", "/informes", { recepcion_id: RA, analisis_ids: [] }, T("Técnico Analista"));
    const infItem = (await api("GET", `/informes/${inf.data?.id}`, undefined, QA)).data?.item;
    const infEdit = await api("PUT", `/informes/${inf.data?.id}`, { recepcion_id: RA, analisis_ids: [] }, T("Técnico Analista"));
    check("alcance borrador en informes: el Analista crea un borrador (201) pero no tiene E (403)", inf.status === 201 && infItem?.estado === "borrador" && infEdit.status === 403, `crear ${inf.status} estado ${infItem?.estado} editar ${infEdit.status}`);
  }
  {
    // bitacora
    const r = await api("GET", "/audit?limit=5", undefined, T("Administrador técnico del sistema"));
    const v = await api("GET", "/audit/verify", undefined, T("Administrador técnico del sistema"));
    check("alcance bitacora: el Administrador tecnico consulta la bitacora y su integridad", r.status === 200 && v.status === 200, `audit ${r.status} verify ${v.status}`);
  }
  {
    // uso (Analista)
    const an = T("Técnico Analista");
    const catalogoEq = await api("POST", "/inventory/equipos", { nombre: "No debe crearse (uso)" }, an);
    const conUso = await api("POST", "/samples/extraction", extraccion(PA, "USO-1", { equipos: [{ equipo_id: equipoId, uso: "Centrífuga", folio_bitacora: "88" }] }), an);
    const aux = await api("POST", "/samples/extraction", extraccion(PA, "USO-2", { equipos: [{ equipo_id: equipoId, uso: "Centrífuga" }] }), T("Coordinador/a de Mejora Continua"));
    check("alcance uso: el Analista no edita el catalogo de equipos (403) pero registra su uso en una extraccion (201)", catalogoEq.status === 403 && conUso.status === 201 && aux.status === 403, `catalogo ${catalogoEq.status} extraccion ${conUso.status} ${conUso.data?.message || ""} (MC sin ensayos:C ${aux.status})`);
  }
  {
    // mantenimiento (Administrador/a Auxiliar)
    const aa = T("Administrador/a Auxiliar");
    const mant = await api("POST", "/inventory/mantenimientos", { id_equipo: equipoId, tipo: "preventivo", fecha_programada: "2027-02-01", estado: "programado" }, aa);
    const eq = await api("POST", "/inventory/equipos", { nombre: "No debe crearse (mantenimiento)" }, aa);
    check("alcance mantenimiento: la Administradora Auxiliar programa un mantenimiento (201) pero no crea equipos (403)", mant.status === 201 && eq.status === 403, `mant ${mant.status} ${mant.data?.message || ""} equipo ${eq.status}`);
  }
  {
    // movimientos (Analista)
    const an = T("Técnico Analista");
    const refill = await api("POST", `/inventory/reactivos/${reactivoId}/refill`, { cantidad: 0.5, motivo: "Reposición de prueba" }, an);
    const alta = await api("POST", "/inventory/reactivos", { producto: "No debe crearse (movimientos)" }, an);
    const conInsumo = await api("POST", "/samples/processing", { ...procesamiento(RA, "MOV-1"), uso_inventario: [{ tipo: "reactivo", ref: String(reactivoId), cantidad: 0.01 }] }, an);
    check("alcance movimientos: el Analista repone (200) y descuenta al capturar (201) pero no da de alta reactivos (403)", refill.status === 200 && conInsumo.status === 201 && alta.status === 403, `refill ${refill.status} captura ${conInsumo.status} alta ${alta.status}`);
  }

  /* ---------- Personas de prueba (creadas por QA) ---------- */
  // Fase 2: el rol de estudiante solo va en cuenta temporal con supervisor (el Coord. del Área Técnica).
  const temporalDe = (rol) => (rol.startsWith("Estudiante") ? { tipo_cuenta: "temporal", vigente_hasta: "2099-12-31", supervisor_id: usuarioIds["Coordinador/a del Área Técnica"], motivo_cuenta: "Estancia de prueba" } : {});
  const persona = async (email, rol) => {
    const r = await api("POST", "/admin/usuarios", { nombre: email.split("@")[0], email, activo: true, rol_id: rolId(rol), password: "PruebaRoles2026!", motivo: "Alta de prueba", ...temporalDe(rol) }, QA);
    await autorizarTodo(BASE, QA, r.data?.id);
    await asignarRecepcion(BASE, QA, RA, [r.data?.id]);
    const t = (await api("POST", "/auth/login", { email, password: "PruebaRoles2026!" })).data?.token;
    return { id: r.data?.id, token: t, status: r.status };
  };
  const J = T("Administrador técnico del sistema");
  const asignar = (userId, rol, extra = {}, token = J) => api("POST", `/admin/usuarios/${userId}/roles`, { rol_id: rolId(rol), motivo: "Asignación de prueba", ...extra }, token);
  const asignacionDe = async (userId, rol, token = QA) => ((await api("GET", `/admin/usuarios/${userId}`, undefined, token)).data?.item?.asignaciones || []).find((a) => a.rol === rol && !a.revocado_en);

  /* ---------- Varios roles ---------- */
  {
    const multi = await persona("multi.roles@cicese.mx", "Técnico Auxiliar");
    const antes = await api("POST", "/samples/extraction", extraccion(PA, "MULTI-1"), multi.token);
    const a1 = await asignar(multi.id, "Coordinador/a de Investigación y Desarrollo");
    const despues = await api("POST", "/samples/extraction", extraccion(PA, "MULTI-2"), multi.token);
    // La recepcion la permiten ambos roles: sin elegir cargo -> 409 ELEGIR_CARGO; eligiendo uno -> 201.
    const recepSin = await api("POST", "/samples/reception", recepcionBase("MULTI-R"), multi.token);
    const recep = await api("POST", "/samples/reception", recepcionBase("MULTI-R"), multi.token, { "X-Actuar-Como": String(rolId("Técnico Auxiliar")) });
    const me = (await api("GET", "/auth/me", undefined, multi.token)).data;
    check("varios roles: la union (Auxiliar + Coord. I+D) permite extraer, sin volver a iniciar sesion", multi.status === 201 && antes.status === 403 && a1.status === 201 && despues.status === 201 && recepSin.status === 409 && recepSin.data?.codigo === "ELEGIR_CARGO" && recep.status === 201 && (me?.roles || []).length === 2, `alta ${multi.status} antes ${antes.status} asignar ${a1.status} ${a1.data?.message || ""} despues ${despues.status} recepcion ${recep.status} ${recep.data?.message || ""} roles=${JSON.stringify((me?.roles || []).map((r) => r.nombre))}`);

    // La API no acepta una asignacion que ya nacio vencida; para simular una que vencio se asigna
    // vigente y se le mueve la vigencia al pasado directamente en la base de PRUEBA.
    const yaVencida = await asignar(multi.id, "Responsable General", { vigente_desde: "2020-01-01", vigente_hasta: "2020-12-31" });
    check("asignar con vigencia ya terminada -> 400", yaVencida.status === 400, `status ${yaVencida.status} ${yaVencida.data?.message || ""}`);
    const vencido = await asignar(multi.id, "Responsable General", { vigente_hasta: "2099-12-31" });
    {
      const db = new Database(process.env.TEST_DB_PATH);
      db.prepare("UPDATE usuario_roles SET vigente_desde = '2020-01-01', vigente_hasta = '2020-12-31' WHERE id = ?").run(vencido.data?.id);
      db.close();
    }
    // El Responsable General daria muestras:AN y Mejora Continua documento_crear_ficha; ninguno de los otros dos roles los tiene.
    const anular = await api("POST", "/samples/reception/999999/anular", { motivo: "Sonda de vigencia" }, multi.token);
    const futuro = await asignar(multi.id, "Coordinador/a de Mejora Continua", { vigente_desde: "2099-01-01" });
    const aprobarDoc = await api("POST", "/sgc/documentos", {}, multi.token);
    const me2 = (await api("GET", "/auth/me", undefined, multi.token)).data;
    check("un rol vencido o que aun no empieza no cuenta", vencido.status === 201 && futuro.status === 201 && anular.status === 403 && aprobarDoc.status === 403 && (me2?.roles || []).length === 2 && !me2?.permissions?.muestras?.AN && !me2?.permissions?.documentos?.documento_crear_ficha, `vencido ${vencido.status} futuro ${futuro.status} anular ${anular.status} aprobar ${aprobarDoc.status} roles=${(me2?.roles || []).length}`);

    const asig = await asignacionDe(multi.id, "Coordinador/a de Investigación y Desarrollo");
    const sinMotivo = await api("POST", `/admin/usuarios/${multi.id}/roles/${asig?.id}/revocar`, { motivo: "no" }, J);
    const rev = await api("POST", `/admin/usuarios/${multi.id}/roles/${asig?.id}/revocar`, { motivo: "Termina proyecto de prueba" }, J);
    const tras = await api("POST", "/samples/extraction", extraccion(PA, "MULTI-3"), multi.token);
    check("revocar un rol exige motivo y quita el permiso en la siguiente peticion con el mismo token", sinMotivo.status === 400 && rev.status === 200 && tras.status === 403, `sin motivo ${sinMotivo.status} revocar ${rev.status} extraer ${tras.status}`);
    const dup = await asignar(multi.id, "Técnico Auxiliar");
    check("asignar un rol que ya tiene vigente -> 409", dup.status === 409, `status ${dup.status}`);

    const jorgeId = usuarioIds["Administrador técnico del sistema"];
    const auto = await asignar(jorgeId, "Auditor Interno");
    const asigJorge = await asignacionDe(jorgeId, "Administrador técnico del sistema");
    const autoRev = await api("POST", `/admin/usuarios/${jorgeId}/roles/${asigJorge?.id}/revocar`, { motivo: "Intento de autorrevocación" }, J);
    check("nadie se asigna ni se revoca roles a si mismo (403)", auto.status === 403 && autoRev.status === 403, `asignarse ${auto.status} revocarse ${autoRev.status}`);
  }

  /* ---------- Guarda: siempre queda un administrador ---------- */
  {
    const jorgeId = usuarioIds["Administrador técnico del sistema"];
    const usuarios = (await api("GET", "/admin/usuarios", undefined, J)).data?.items || [];
    const qa = usuarios.find((u) => u.email === "qa@ficotox.local");
    const payload = (u, cambios) => ({ nombre: u.nombre, email: u.email, departamento: u.departamento, activo: !!Number(u.activo), ...cambios });
    const admin2 = await persona("admin2.roles@cicese.mx", "Administrador técnico del sistema");
    const qaOff = await api("PUT", `/admin/usuarios/${qa.id}`, payload(qa, { activo: false, motivo_estado: "Prueba de la guarda de administrador" }), J);
    // Con dos administradores (Jorge y admin2), revocar el de Jorge se permite y surte efecto de inmediato.
    const asigJorge = await asignacionDe(jorgeId, "Administrador técnico del sistema", admin2.token);
    const rev = await api("POST", `/admin/usuarios/${jorgeId}/roles/${asigJorge?.id}/revocar`, { motivo: "Prueba de la guarda de administrador" }, admin2.token);
    const jorgeSin = await api("GET", "/admin/roles", undefined, J);
    const jorgeMe = (await api("GET", "/auth/me", undefined, J)).data;
    check("revocar el rol de administrador a Jorge (queda admin2): 200 y Jorge pierde el acceso sin re-login", qaOff.status === 200 && admin2.status === 201 && rev.status === 200 && jorgeSin.status === 403 && (jorgeMe?.roles || []).length === 0, `qaOff ${qaOff.status} admin2 ${admin2.status} revocar ${rev.status} jorge roles ${jorgeSin.status}`);
    // admin2 es ahora el unico: no puede desactivarse ni quitarle usuarios:G a su rol.
    const yo = (await api("GET", `/admin/usuarios/${admin2.id}`, undefined, admin2.token)).data?.item;
    const selfOff = await api("PUT", `/admin/usuarios/${admin2.id}`, payload(yo, { activo: false, motivo_estado: "Intento de desactivarse" }), admin2.token);
    const adminRol = roles.find((r) => r.nombre === "Administrador técnico del sistema");
    const detalle = (await api("GET", `/admin/roles/${adminRol.id}`, undefined, admin2.token)).data;
    const recorte = await api("PUT", `/admin/roles/${adminRol.id}`, { nombre: adminRol.nombre, descripcion: adminRol.descripcion, activo: true, motivo: "Intento de dejar sin administrador", permisos: detalle.permisos.filter((p) => p.modulo !== "usuarios").concat([{ modulo: "usuarios", accion: "V", alcance: "total" }]) }, admin2.token);
    const despues = (await api("GET", `/admin/roles/${adminRol.id}`, undefined, admin2.token)).data;
    // Darse de baja a uno mismo se rechaza antes (403, prueba integral A-04); la guarda del ultimo administrador sigue en DELETE y al quitar permisos.
    check("unico administrador: desactivarse -> 403; quitar usuarios:G a su rol -> 409 (sin cambios)", selfOff.status === 403 && recorte.status === 409 && despues.permisos.some((p) => p.modulo === "usuarios" && p.accion === "G"), `desactivarse ${selfOff.status} recorte ${recorte.status}`);
    const borrarSistemico = await api("DELETE", `/admin/roles/${adminRol.id}`, undefined, admin2.token);
    check("el rol de administrador (sistemico) no se elimina", borrarSistemico.status === 403, `status ${borrarSistemico.status}`);
    // Restaurar: admin2 devuelve el rol a Jorge, Jorge reactiva a QA y da de baja a admin2.
    const devolver = await asignar(jorgeId, "Administrador técnico del sistema", { motivo: "Fin de la prueba de la guarda" }, admin2.token);
    const qaOn = await api("PUT", `/admin/usuarios/${qa.id}`, payload(qa, { activo: true }), J);
    // Fase 2: la baja cerro sus sesiones (token_version); vuelve a entrar.
    QA = (await api("POST", "/auth/login", { email: "qa@ficotox.local", password: "QaFicotox2026!" })).data?.token;
    const baja = await api("DELETE", `/admin/usuarios/${admin2.id}`, { motivo: "Fin de la prueba de la guarda" }, J);
    check("restaurar: Jorge recupera su rol, QA reactivado, admin2 de baja", devolver.status === 201 && qaOn.status === 200 && baja.status === 200, `devolver ${devolver.status} qa ${qaOn.status} baja ${baja.status}`);

    // Tambien debe quedar un administrador SIN fecha de fin: si solo quedara uno temporal, al vencer nadie administraria.
    const tempEmail = "admin.temporal@cicese.mx";
    const alta = await api("POST", "/admin/usuarios", { nombre: "admin.temporal", email: tempEmail, activo: true, rol_id: rolId("Administrador técnico del sistema"), vigente_hasta: "2099-12-31", password: "PruebaRoles2026!", motivo: "Administrador temporal de prueba" }, QA);
    const temporal = (await api("POST", "/auth/login", { email: tempEmail, password: "PruebaRoles2026!" })).data?.token;
    const qaOff2 = await api("PUT", `/admin/usuarios/${qa.id}`, payload(qa, { activo: false, motivo_estado: "Prueba de la guarda temporal" }), J);
    const asigJorge2 = await asignacionDe(jorgeId, "Administrador técnico del sistema", temporal);
    const revTemporal = await api("POST", `/admin/usuarios/${jorgeId}/roles/${asigJorge2?.id}/revocar`, { motivo: "Dejaria solo un administrador temporal" }, temporal);
    const jorgeSigue = await api("GET", "/admin/roles", undefined, J);
    check("revocar al unico administrador permanente dejando solo uno con fecha de fin -> 409 (Jorge conserva el rol)", alta.status === 201 && qaOff2.status === 200 && revTemporal.status === 409 && /fecha de fin/i.test(String(revTemporal.data?.message)) && jorgeSigue.status === 200, `alta ${alta.status} qaOff ${qaOff2.status} revocar ${revTemporal.status} ${revTemporal.data?.message || ""} jorge ${jorgeSigue.status}`);
    const qaOn2 = await api("PUT", `/admin/usuarios/${qa.id}`, payload(qa, { activo: true }), J);
    // Fase 2: la baja cerro sus sesiones (token_version); vuelve a entrar.
    QA = (await api("POST", "/auth/login", { email: "qa@ficotox.local", password: "QaFicotox2026!" })).data?.token;
    const baja2 = await api("DELETE", `/admin/usuarios/${alta.data?.id}`, { motivo: "Fin de la prueba de la guarda temporal" }, J);
    check("restaurar: QA reactivado y administrador temporal de baja", qaOn2.status === 200 && baja2.status === 200, `qa ${qaOn2.status} baja ${baja2.status}`);
  }

  /* ---------- Combinaciones prohibidas ---------- */
  {
    const casos = [
      ["combi1.roles@cicese.mx", "Administrador técnico del sistema", "Técnico Analista", 1],
      ["combi2.roles@cicese.mx", "Administrador/a Auxiliar", "Técnico Analista", 2],
      ["combi3.roles@cicese.mx", "Auditor Interno", "Técnico Auxiliar", 3],
      ["combi4.roles@cicese.mx", "Estudiante / personal en formación", "Responsable General", 4],
    ];
    const personas = {};
    for (const [email, inicial, extra, regla] of casos) {
      const p = await persona(email, inicial);
      personas[regla] = p;
      const r = await api("POST", `/admin/usuarios/${p.id}/roles`, { rol_id: rolId(extra), motivo: "Asignación prohibida de prueba" }, QA);
      check(`regla ${regla}: ${inicial} + ${extra} -> 409`, p.status === 201 && r.status === 409 && r.data?.codigo === "COMBINACION_PROHIBIDA" && String(r.data?.message).includes(`Regla ${regla}`), `alta ${p.status} asignar ${r.status} ${r.data?.message || ""}`);
    }
    // Editar un rol para que provoque una combinacion prohibida: se rechaza y dice a quien afecta.
    const custom = await api("POST", "/admin/roles", { nombre: "Rol combinable QA", motivo: "Rol de prueba", permisos: [{ modulo: "inventario", accion: "V" }] }, QA);
    const asig = await api("POST", `/admin/usuarios/${personas[1].id}/roles`, { rol_id: custom.data?.id, motivo: "Rol permitido" }, QA);
    const editar = await api("PUT", `/admin/roles/${custom.data?.id}`, { nombre: "Rol combinable QA", activo: true, motivo: "Agregar captura de ensayos", permisos: [{ modulo: "inventario", accion: "V" }, { modulo: "ensayos", accion: "C" }] }, QA);
    check("editar un rol que provocaria la regla 1 en un usuario -> 409 con los afectados", custom.status === 201 && asig.status === 201 && editar.status === 409 && editar.data?.codigo === "COMBINACION_PROHIBIDA" && (editar.data?.afectados || []).some((a) => a.email === "combi1.roles@cicese.mx"), `rol ${custom.status} asignar ${asig.status} editar ${editar.status} ${editar.data?.message || ""}`);
    const sinMotivo = await api("PUT", `/admin/roles/${custom.data?.id}`, { nombre: "Rol combinable QA", activo: true, permisos: [{ modulo: "inventario", accion: "V" }, { modulo: "equipos", accion: "V" }] }, QA);
    const conMotivo = await api("PUT", `/admin/roles/${custom.data?.id}`, { nombre: "Rol combinable QA", activo: true, motivo: "Agregar consulta de equipos", permisos: [{ modulo: "inventario", accion: "V" }, { modulo: "equipos", accion: "V" }] }, QA);
    check("cambiar permisos de un rol exige motivo (400 sin el, 200 con el)", sinMotivo.status === 400 && conMotivo.status === 200, `sin ${sinMotivo.status} con ${conMotivo.status}`);
    const combi1Me = (await api("GET", "/auth/me", undefined, personas[1].token)).data;
    check("el cambio de permisos del rol aplica al usuario sin volver a entrar", combi1Me?.permissions?.equipos?.V === "total", JSON.stringify(combi1Me?.permissions?.equipos));
  }

  /* ---------- Cargo con el que se actua ---------- */
  {
    const RB = (await api("POST", "/samples/reception", aceptada("CARGO-1"), QA)).data?.id;
    const PB = (await api("POST", "/samples/processing", procesamiento(RB, "CARGO-1"), QA)).data?.id;
    const EB = (await api("POST", "/samples/extraction", extraccion(PB, "CARGO-1"), QA)).data?.id;
    const AB = (await api("POST", "/samples/analysis", analisis(EB, "CARGO-1"), QA)).data?.id;
    // Fase 3: lo revisa y aprueba otra persona (QA lo elaboro).
    // Fase 6: el analisis se revisa solo despues de enviarlo a revision.
    await api("POST", `/samples/analysis/${AB}/enviar-revision`, {}, QA);
    await api("POST", `/samples/analysis/${AB}/revisar`, {}, T("Coordinador/a del Área Técnica"));
    await api("POST", `/samples/analysis/${AB}/aprobar`, {}, T("Coordinador/a del Área Técnica"));
    const inf = await api("POST", "/informes", { recepcion_id: RB, analisis_ids: [AB], cliente: { nombre: "Cliente cargo" } }, QA);
    const cargo = await persona("cargo.roles@cicese.mx", "Responsable General");
    const a2 = await asignar(cargo.id, "Coordinador/a del Área Técnica");
    const sinElegir = await api("POST", `/informes/${inf.data?.id}/revisar`, {}, cargo.token);
    const opciones = (sinElegir.data?.opciones || []).map((o) => o.nombre).sort();
    check("dos roles que otorgan informes:R -> 409 ELEGIR_CARGO con ambas opciones", inf.status === 201 && a2.status === 201 && sinElegir.status === 409 && sinElegir.data?.codigo === "ELEGIR_CARGO" && opciones.join("|") === ["Coordinador/a del Área Técnica", "Responsable General"].sort().join("|"), `informe ${inf.status} asignar ${a2.status} revisar ${sinElegir.status} opciones=${opciones.join(",")}`);
    const ajeno = await api("POST", `/informes/${inf.data?.id}/revisar`, {}, cargo.token, { "X-Actuar-Como": String(rolId("Técnico Analista")) });
    check("actuar como un rol que no otorga el permiso -> 403", ajeno.status === 403, `status ${ajeno.status} ${ajeno.data?.message || ""}`);
    const rev = await api("POST", `/informes/${inf.data?.id}/revisar`, {}, cargo.token, { "X-Actuar-Como": String(rolId("Coordinador/a del Área Técnica")) });
    const aut = await api("POST", `/informes/${inf.data?.id}/autorizar`, {}, cargo.token, { "X-Actuar-Como": String(rolId("Responsable General")) });
    check("revision y autorizacion guardan el cargo elegido", rev.status === 200 && rev.data?.item?.revisado_cargo === "Coordinador/a del Área Técnica" && Number(rev.data?.item?.revisado_rol_id) === rolId("Coordinador/a del Área Técnica") && aut.status === 200 && aut.data?.item?.autorizado_cargo === "Responsable General", `rev ${rev.status} ${rev.data?.item?.revisado_cargo} aut ${aut.status} ${aut.data?.item?.autorizado_cargo} ${aut.data?.message || ""}`);
    const pdf = await api("GET", `/informes/${inf.data?.id}/pdf`, undefined, QA);
    const texto = textoPdf(pdf.data);
    check("el PDF del informe muestra el cargo con el que se reviso y autorizo", pdf.status === 200 && texto.includes("Coordinador/a del") && texto.includes("Responsable General"), `bytes=${pdf.data?.length} muestra=${texto.slice(0, 120)}`);
    const bitacora = (await api("GET", `/audit?entidad=informes&entidad_id=${inf.data?.id}`, undefined, QA)).data?.items || [];
    const autorizo = bitacora.find((e) => e.accion === "autorizar");
    check("la bitacora guarda el cargo (actuo_como)", autorizo?.cambios?._detalle?.actuo_como?.cargo === "Responsable General", JSON.stringify(autorizo?.cambios?._detalle?.actuo_como));
    const anaUna = await api("POST", "/samples/analysis", analisis(EB, "CARGO-2"), T("Coordinador/a del Área Técnica"));
    const anaItem = (await api("GET", `/samples/analysis/${anaUna.data?.id}`, undefined, QA)).data?.item;
    check("con un solo rol que otorga el permiso se usa ese cargo automaticamente", anaUna.status === 201 && anaItem?.creado_cargo === "Coordinador/a del Área Técnica", `status ${anaUna.status} cargo ${anaItem?.creado_cargo}`);
  }

  /* ---------- Bitacora de asignaciones y permisos ---------- */
  {
    const items = (await api("GET", "/audit?limit=1000", undefined, QA)).data?.items || [];
    const de = (accion) => items.filter((e) => e.accion === accion);
    check("bitacora: asignaciones y revocaciones con motivo", de("asignar_rol").length >= 5 && de("revocar_rol").length >= 2 && [...de("asignar_rol"), ...de("revocar_rol")].every((e) => String(e.motivo || "").length >= 5), `asignar ${de("asignar_rol").length} revocar ${de("revocar_rol").length}`);
    const cambioRol = items.find((e) => e.accion === "editar" && e.entidad === "roles" && e.referencia === "Rol combinable QA");
    check("bitacora: cambio de permisos de un rol con motivo y antes/despues", cambioRol?.motivo === "Agregar consulta de equipos", JSON.stringify(cambioRol && { motivo: cambioRol.motivo }));
  }
} else {
  /* Tras reiniciar: el barrido de vencimientos dejo el rastro del rol vencido (asignado en la corrida anterior). */
  const items = (await api("GET", "/audit?accion=vencer_rol&limit=100", undefined, QA)).data?.items || [];
  check("tras reiniciar: el rol vencido quedo en la bitacora como 'vencer_rol' con motivo", items.some((e) => e.referencia === "multi.roles@cicese.mx" && /vigencia/i.test(String(e.motivo || ""))), items.map((e) => `${e.referencia}:${e.motivo}`).join(" | "));
}

const verificacion = await api("GET", "/audit/verify", undefined, QA);
check("Verificar integridad: cadena en verde", verificacion.status === 200 && verificacion.data?.ok === true, JSON.stringify(verificacion.data));

// Fase 3: la migracion de la Fase 1 (id_rol -> usuario_roles) no asigna al reiniciar un rol inicial rechazado.
if (TRAS_REINICIO) {
  try {
    const { alta_rechazada: uid } = JSON.parse(readFileSync(new URL("segregacion-reinicio.json", `file://${process.env.DATOS_APOYO_FILE}`), "utf8"));
    const roles = (await api("GET", `/admin/usuarios/${uid}`, undefined, QA)).data?.item?.roles;
    check("tras reiniciar, la cuenta con rol inicial rechazado sigue sin roles", Array.isArray(roles) && roles.length === 0, JSON.stringify(roles));
  } catch (error) {
    check("tras reiniciar, la cuenta con rol inicial rechazado sigue sin roles", false, error.message);
  }
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} pruebas OK`);
process.exit(failed.length ? 1 : 0);

/* Texto de un PDF de pdfkit (fuentes estandar: cadenas hex WinAnsi dentro de streams Flate). */
function textoPdf(buffer) {
  if (!Buffer.isBuffer(buffer)) return "";
  const raw = buffer.toString("latin1");
  let out = "";
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    try {
      const contenido = zlib.inflateSync(buffer.subarray(start, end)).toString("latin1");
      for (const hex of contenido.matchAll(/<([0-9a-fA-F]+)>/g)) out += Buffer.from(hex[1], "hex").toString("latin1");
      out += "\n";
    } catch {
      /* stream no comprimido o binario */
    }
  }
  return out;
}
