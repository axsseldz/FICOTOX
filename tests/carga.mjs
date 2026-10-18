/*
 * Fase 12 · prueba de carga (no forma parte de `npm test`):
 *
 *   npm run build && npm run prueba-carga [-- --segundos 180 --usuarios 10]
 *
 * Levanta el servidor standalone (scripts/start-ficotox.mjs) sobre una base
 * temporal (instance/test/carga/, copia de la base de prueba; nunca la real) y
 * simula N usuarios concurrentes durante unos minutos con acciones reales de la
 * API: listas, Inicio y campana; recepcion, procesamiento, extraccion (con
 * consumo de inventario), analisis con evidencia, revision, aprobacion, informe
 * (revisar, autorizar, liberar) y envio; incidencias;.
 *
 * Mide latencias (p50/p95/p99 por accion), errores (ningun 500 permitido) y
 * conflictos. Al final verifica: folios unicos y consecutivos por serie,
 * inventario coherente (existencia = inicial - consumos) y bitacora integra.
 * Deja el reporte en instance/test/carga/resultado-<fecha>.md y .json.
 * Salida 1 si hubo algun 500, folios repetidos o con huecos, inventario
 * incoherente o la cadena rota.
 */
import "./lib/reauth-auto.mjs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const Sqlite = require("better-sqlite3");
const args = process.argv.slice(2);
const opcion = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const SEGUNDOS = opcion("--segundos", Number(process.env.CARGA_SEGUNDOS || 180));
const USUARIOS = opcion("--usuarios", 10);
const DIR = path.join(root, "instance/test/carga");
const DB = path.join(DIR, "ficotox-carga.sqlite3");
if (!fs.existsSync(path.join(root, ".next/standalone/server.js"))) {
  console.error("Falta el build standalone: ejecuta `npm run build` antes de la prueba de carga.");
  process.exit(2);
}
fs.rmSync(DIR, { recursive: true, force: true });
process.env.TEST_DB = DB;
const { resetTestDb, CREDENCIALES, QA_USER } = await import("./reset-test-db.mjs");
resetTestDb();
const credenciales = JSON.parse(fs.readFileSync(CREDENCIALES, "utf8"));

const PUERTO = await new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
const BASE = `http://127.0.0.1:${PUERTO}/api`;
// La base de prueba se sella como en `npm test` (next dev lee el .env del proyecto): misma SECRET_KEY, o su auditoria.key si no hay.
const SECRET = (() => {
  try {
    const linea = fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/).find((l) => /^\s*SECRET_KEY\s*=/.test(l));
    return linea ? linea.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
})();
const servidor = spawn(process.execPath, [path.join(root, "scripts/start-ficotox.mjs")], {
  cwd: root,
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, FICOTOX_ENV_FILE: path.join(DIR, "no-existe.env"), SQLITE_PATH: DB, FICOTOX_INSTANCE_DIR: DIR, FICOTOX_BACKUP_DIR: path.join(DIR, "backups"), PORT: String(PUERTO), HOST: "127.0.0.1", JWT_SECRET: randomBytes(32).toString("hex"), SECRET_KEY: SECRET, NODE_ENV: "production", FICOTOX_OPEN_BROWSER: "false", EVIDENCIA_MAX_MB: "25", LOG_DIR: path.join(DIR, "logs") },
});
let registroServidor = "";
servidor.stdout.on("data", (d) => (registroServidor += d));
servidor.stderr.on("data", (d) => (registroServidor += d));
const detener = () => {
  try {
    process.kill(-servidor.pid, "SIGTERM");
  } catch {
    /* ya termino */
  }
};
process.on("exit", detener);
for (let i = 0; i < 240; i += 1) {
  try {
    if ((await fetch(`${BASE}/health`)).ok) break;
  } catch {
    /* arrancando */
  }
  await new Promise((r) => setTimeout(r, 500));
}

/* ---------- Medicion ---------- */
const medidas = new Map();
const errores = [];
let conflictos = 0;
async function api(etiqueta, method, ruta, body, token) {
  const esForm = body instanceof FormData;
  const t0 = performance.now();
  let status = 0;
  let data = null;
  try {
    const res = await fetch(`${BASE}${ruta}`, { method, headers: { ...(esForm ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: esForm ? body : body ? JSON.stringify(body) : undefined });
    status = res.status;
    data = (res.headers.get("content-type") || "").includes("json") ? await res.json().catch(() => null) : await res.arrayBuffer();
  } catch (error) {
    status = 599;
    data = { message: error.message };
  }
  const ms = performance.now() - t0;
  if (!medidas.has(etiqueta)) medidas.set(etiqueta, []);
  medidas.get(etiqueta).push(ms);
  if (status >= 500) errores.push({ etiqueta, ruta, status, mensaje: data?.message || "" });
  if (data?.codigo === "conflicto_concurrencia") conflictos += 1;
  return { status, data, ms };
}
const login = async (email, password) => (await api("login", "POST", "/auth/login", { email, password })).data?.token;
const T = {
  qa: await login(QA_USER.email, QA_USER.password),
  ricardo: await login("ricardo.medina@ficotox.local", credenciales["ricardo.medina@ficotox.local"]),
  patricia: await login("patricia.luna@ficotox.local", credenciales["patricia.luna@ficotox.local"]),
  jorge: await login("jorge.ramirez@ficotox.local", credenciales["jorge.ramirez@ficotox.local"]),
  luis: await login("luis.castro@ficotox.local", credenciales["luis.castro@ficotox.local"]),
  ana: await login("ana.torres@ficotox.local", credenciales["ana.torres@ficotox.local"]),
};
if (!T.qa || !T.ricardo || !T.patricia) {
  console.error("No se pudo iniciar sesión en el servidor de carga.\n", registroServidor.slice(-2000));
  process.exit(1);
}
// Responsable de las NC de la carga (Ricardo, Coord. Area Tecnica).
const ricardoId = ((await api("preparar", "GET", "/admin/usuarios", undefined, T.qa)).data?.items || []).find((u) => u.email === "ricardo.medina@ficotox.local")?.id;
const INICIAL = 100000;
const CONSUMO = 0.01;
const reactivo = (await api("preparar", "POST", "/inventory/reactivos", { tipo_reactivo: "alcoholes_solventes", nombre: "Metanol carga", producto: "Metanol carga", cantidad_actual: INICIAL, unidad: "litros" }, T.qa)).data?.id;
const inspeccion = { checklist: Array.from({ length: 7 }, (_, i) => ({ requisito: `Requisito ${i + 1}`, estado: i === 6 ? "NA" : "C", observacion: null })), observaciones_generales: null };
const pdf = (texto, kb) => Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(`% ${texto}\n`), randomBytes(kb * 1024).map((b) => 32 + (b % 90))]);
let extraccionesOk = 0;
let secuencia = 0;

async function flujoMuestra(vu) {
  secuencia += 1;
  const idInt = `CARGA-${vu}-${secuencia}-${Date.now().toString(36).slice(-4)}`;
  const R = (await api("crear recepción", "POST", "/samples/reception", { fecha_recepcion: "2026-09-20", hora_recepcion: "09:00", recibido_por: "QA", medio_recepcion: "directa", solicitante: `Cliente carga ${vu}`, muestra_unica: true, id_interno: idInt, fecha_muestra: "2026-09-19", analisis: { tipos: ["toxinas_lipofilicas"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] }, inspeccion, decision_aceptacion: "aceptada", aceptacion: { fecha: "2026-09-20", responsable: "QA" } }, T.qa)).data?.id;
  if (!R) return;
  const P = (await api("crear procesamiento", "POST", "/samples/processing", { recepcion_id: R, muestra_tipo: "unica", id_interno: idInt, fecha_procesamiento: "2026-09-20", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "Persona A", nombre_quien_superviso: "Persona B" }, T.qa)).data?.id;
  if (!P) return;
  // 1 de cada 5 muestras va por el formato ASP (serie E-A); termina en la extraccion.
  const asp = Math.random() < 0.2;
  const e = await api("crear extracción", "POST", "/samples/extraction", { tipo_registro: asp ? "E-A" : "E-D", procesamiento_id: P, tipo_molienda: "fresca", id_interno: idInt, fecha_extraccion: "2026-09-20", registro_pesos: [{ id_muestra: idInt, replica: `${idInt}_R1`, peso_muestra: 2.01 }], uso_inventario: [{ tipo: "reactivo", ref: String(reactivo), cantidad: CONSUMO }], nombre_quien_extrajo: "Persona A", nombre_quien_superviso: "Persona B" }, T.qa);
  const E = e.data?.id;
  if (!E) return;
  extraccionesOk += 1;
  if (asp) return;
  const A = (await api("crear análisis", "POST", "/samples/analysis", { tipo_analisis: "toxinas_lipofilicas", metodo: "hplc_ms_ms", extraccion_id: E, fecha_analisis: "2026-09-20", analista_nombre: "QA", resultados: [{ id_muestra: idInt, resultado: 50, unidad: "µg/kg", limite_regulatorio: 160, cumple: "cumple" }] }, T.qa)).data?.id;
  if (!A) return;
  const form = new FormData();
  form.append("archivo", new Blob([pdf(idInt, 256 + Math.floor(Math.random() * 1024))]), "cromatograma.pdf");
  form.append("tipo_evidencia", "cromatograma");
  form.append("descripcion", `Cromatograma ${idInt}`);
  await api("subir evidencia", "POST", `/samples/analysis/${A}/adjuntos`, form, T.qa);
  await api("enviar a revisión", "POST", `/samples/analysis/${A}/enviar-revision`, {}, T.qa);
  await api("revisar análisis", "POST", `/samples/analysis/${A}/revisar`, {}, T.ricardo);
  await api("aprobar análisis", "POST", `/samples/analysis/${A}/aprobar`, {}, T.ricardo);
  const inf = (await api("crear informe", "POST", "/informes", { recepcion_id: R, analisis_ids: [A], cliente: { nombre: `Cliente carga ${vu}`, correo: "cliente@ejemplo.mx" } }, T.qa)).data?.id;
  if (!inf) return;
  await api("revisar informe", "POST", `/informes/${inf}/revisar`, {}, T.ricardo);
  await api("autorizar informe", "POST", `/informes/${inf}/autorizar`, {}, T.patricia);
  await api("liberar informe (PDF)", "POST", `/informes/${inf}/liberar`, {}, T.patricia);
  const envio = new FormData();
  envio.set("destinatario_nombre", `Cliente carga ${vu}`);
  envio.set("destinatario_correo", "cliente@ejemplo.mx");
  envio.set("enviado_en", new Date().toISOString());
  envio.set("evidencia", new Blob(["%PDF-1.4\n% evidencia de envio\n"], { type: "application/pdf" }), "evidencia.pdf");
  await api("registrar envío", "POST", `/informes/${inf}/envios`, envio, T.patricia);
}

const LECTURAS = [
  ["lista de recepciones", "/samples/reception"],
  ["lista de análisis", "/samples/analysis"],
  ["lista de informes", "/informes"],
  ["Inicio", "/inicio"],
  ["campana", "/notificaciones"],
  ["bitácora (50)", "/audit?limit=50"],
  ["incidencias", "/calidad/incidencias"],
  ["reactivos", "/inventory/reactivos"],
];

const fin = Date.now() + SEGUNDOS * 1000;
async function usuario(vu) {
  while (Date.now() < fin) {
    const r = Math.random();
    if (r < 0.5) {
      const [etiqueta, ruta] = LECTURAS[Math.floor(Math.random() * LECTURAS.length)];
      await api(etiqueta, "GET", ruta, undefined, vu % 2 ? T.luis : T.qa);
    } else if (r < 0.9) {
      await flujoMuestra(vu);
    } else if (r < 0.93 && ricardoId) {
      await api("abrir no conformidad", "POST", "/calidad/nc", { origen: "otro", descripcion: `No conformidad de la prueba de carga del usuario ${vu}`, clasificacion: "menor", responsable_id: ricardoId }, T.ana);
    } else {
      await api("reportar incidencia", "POST", "/calidad/incidencias", { tipo: "otro", fecha_hora_ocurrencia: new Date().toISOString(), descripcion: `Incidencia de la prueba de carga del usuario ${vu}`, impacto_resultados: "no" }, T.luis);
    }
  }
}
const inicio = Date.now();
console.log(`Prueba de carga: ${USUARIOS} usuarios concurrentes durante ${SEGUNDOS} s contra ${BASE} (base ${path.relative(root, DB)})`);
await Promise.all(Array.from({ length: USUARIOS }, (_, i) => usuario(i)));
const duracion = (Date.now() - inicio) / 1000;
const verificacion = (await api("verificar bitácora", "GET", "/audit/verify", undefined, T.qa)).data;
detener();
await new Promise((r) => setTimeout(r, 1500));

/* ---------- Verificaciones sobre la base ---------- */
const db = new Sqlite(DB, { readonly: true });
const series = [
  ["R (recepción)", "SELECT folio_num AS f FROM muestras_recepcion"],
  ["P (procesamiento)", "SELECT folio_num AS f FROM muestras_procesamiento"],
  ["E-A (extracción ASP)", "SELECT folio_num AS f FROM muestras_extraccion WHERE tipo_registro = 'E-A'"],
  ["E-D (extracción DSP)", "SELECT folio_num AS f FROM muestras_extraccion WHERE tipo_registro = 'E-D'"],
  ["A (análisis)", "SELECT folio_num AS f FROM muestras_analisis WHERE version = 1"],
  ["IR (informe)", "SELECT folio_num AS f FROM informes WHERE version = 1"],
  ["INC (incidencia)", "SELECT folio_num AS f FROM incidencias"],
  ["NC (no conformidad)", "SELECT folio_num AS f FROM no_conformidades"],
];
const folios = series.map(([serie, sql]) => {
  const lista = db.prepare(sql).all().map((x) => Number(x.f)).sort((a, b) => a - b);
  const repetidos = lista.filter((f, i) => i && f === lista[i - 1]).length;
  const huecos = lista.length ? lista[lista.length - 1] - lista[0] + 1 - new Set(lista).size : 0;
  return { serie, total: lista.length, repetidos, huecos, desde: lista[0] ?? null, hasta: lista[lista.length - 1] ?? null };
});
const existencia = Number(db.prepare("SELECT cantidad_actual AS c FROM reactivos WHERE id = ?").get(reactivo)?.c);
const movimientos = db.prepare("SELECT tipo, COUNT(*) AS n, SUM(cantidad) AS s FROM movimientos WHERE tabla_origen = 'reactivos' AND id_item = ? GROUP BY tipo").all(reactivo);
const extraccionesConConsumo = Number(db.prepare("SELECT COUNT(*) AS n FROM muestras_extraccion WHERE uso_inventario_json LIKE ?").get(`%"ref":"${reactivo}"%`)?.n || 0);
db.close();
const esperada = Math.round((INICIAL - extraccionesConConsumo * CONSUMO) * 1000) / 1000;
// Tambien cuadra con las extracciones que la API confirmo (201) durante la carga.
const inventarioOk = Math.abs(existencia - esperada) < 1e-6 && extraccionesConConsumo === extraccionesOk;

/* ---------- Reporte ---------- */
const pct = (lista, p) => {
  const s = [...lista].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : 0;
};
const filas = [...medidas.entries()].map(([accion, l]) => ({ accion, n: l.length, p50: pct(l, 50), p95: pct(l, 95), p99: pct(l, 99), max: Math.max(...l) })).sort((a, b) => b.n - a.n);
const todas = [...medidas.values()].flat();
const foliosOk = folios.every((f) => !f.repetidos && !f.huecos);
// Todas las series deben ejercitarse (con al menos 30 s de carga): una serie vacia no prueba nada.
const seriesVacias = SEGUNDOS >= 30 ? folios.filter((f) => !f.total).map((f) => f.serie) : [];
const ok = !errores.length && foliosOk && !seriesVacias.length && inventarioOk && verificacion?.ok === true;
const resultado = {
  fecha: new Date().toISOString(),
  usuarios: USUARIOS,
  segundos: duracion,
  peticiones: todas.length,
  por_segundo: Math.round((todas.length / duracion) * 10) / 10,
  global: { p50: pct(todas, 50), p95: pct(todas, 95), p99: pct(todas, 99), max: Math.max(...todas) },
  errores_500: errores.length,
  errores: errores.slice(0, 20),
  conflictos_reintentados_409: conflictos,
  folios,
  inventario: { inicial: INICIAL, extracciones_con_consumo: extraccionesConConsumo, extracciones_confirmadas: extraccionesOk, esperada, existencia, movimientos, ok: inventarioOk },
  bitacora: verificacion,
  acciones: filas,
  ok,
};
const f = (n) => `${Math.round(n)} ms`;
const md = [
  `# Prueba de carga — FICOTOX`,
  "",
  `- Fecha: ${resultado.fecha}`,
  `- ${USUARIOS} usuarios concurrentes, ${duracion.toFixed(0)} s, ${todas.length} peticiones (${resultado.por_segundo}/s), motor SQLite (WAL)`,
  `- Latencia global: p50 ${f(resultado.global.p50)} · p95 ${f(resultado.global.p95)} · p99 ${f(resultado.global.p99)} · máx ${f(resultado.global.max)}`,
  `- Errores 500: **${errores.length}** · conflictos de concurrencia (409 tras reintentos): ${conflictos}`,
  ...(seriesVacias.length ? [`- Series sin registros (no se ejercitaron): **${seriesVacias.join(", ")}**`] : []),
  `- Bitácora: ${verificacion?.ok ? `íntegra (${verificacion.total} entradas)` : `NO íntegra ${JSON.stringify(verificacion)}`}`,
  `- Inventario: existencia ${existencia} = inicial ${INICIAL} − ${extraccionesConConsumo} × ${CONSUMO} → ${inventarioOk ? "coherente" : `INCOHERENTE (esperada ${esperada})`}`,
  "",
  "## Folios por serie",
  "",
  "| Serie | Registros | Rango | Repetidos | Huecos |",
  "| --- | --- | --- | --- | --- |",
  ...folios.map((x) => `| ${x.serie} | ${x.total} | ${x.desde ?? "—"}–${x.hasta ?? "—"} | ${x.repetidos} | ${x.huecos} |`),
  "",
  "## Latencia por acción",
  "",
  "| Acción | n | p50 | p95 | p99 | máx |",
  "| --- | --- | --- | --- | --- | --- |",
  ...filas.map((x) => `| ${x.accion} | ${x.n} | ${f(x.p50)} | ${f(x.p95)} | ${f(x.p99)} | ${f(x.max)} |`),
  "",
  `Resultado: **${ok ? "APROBADA" : "FALLIDA"}**`,
  "",
].join("\n");
fs.writeFileSync(path.join(DIR, `resultado-${resultado.fecha.slice(0, 19).replace(/[:T]/g, "-")}.json`), `${JSON.stringify(resultado, null, 2)}\n`);
fs.writeFileSync(path.join(DIR, `resultado-${resultado.fecha.slice(0, 19).replace(/[:T]/g, "-")}.md`), md);
console.log(`\n${md}`);
if (errores.length) console.log("Primeros errores:", errores.slice(0, 5));
process.exit(ok ? 0 : 1);
