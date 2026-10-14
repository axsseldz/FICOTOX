/*
 * Fase 10 · respaldo y prueba de restauracion, contra el servidor de prueba y
 * con los scripts de terminal. Todo sobre carpetas de instance/test (el servidor
 * de prueba respalda en instance/test/backups, FICOTOX_BACKUP_DIR); nunca toca
 * instance/ real ni backups/ real.
 * - La pantalla Respaldos se retiro (410): el respaldo se crea con npm run respaldar.
 * - Respaldo con el servidor encendido: snapshot valido (integrity_check ok);
 *   manifest con conteos, archivos y huella de la llave; sin secretos.
 * - Restauracion en modo prueba: todas las verificaciones ✅ y acta.
 * - Respaldo alterado: falla la verificacion 1. Llave distinta o ausente: falla
 *   la verificacion de la bitacora con mensaje claro.
 * - Modo real sin --confirmar o con el servidor encendido: se niega. Modo real
 *   correcto: respaldo previo, restaura, entrada "restauracion" y cadena integra.
 * - Retencion: nunca borra el ultimo respaldo verificado.
 */
import "./lib/reauth-auto.mjs";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adjuntarEvidencia } from "./lib/evidencia.mjs";
import { evaluarCadena } from "../src/lib/shared/audit-chain.mjs";
import * as awaitCrypto from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const BASE = process.env.BASE || "http://localhost:3100/api";
const TEST_DB = process.env.TEST_DB_PATH;
const TEST_DIR = path.dirname(TEST_DB);
if (!TEST_DB || !TEST_DIR.includes(`${path.sep}instance${path.sep}test`)) {
  console.error("respaldos.mjs solo corre contra la base de prueba (instance/test)");
  process.exit(1);
}
const BACKUPS = path.join(TEST_DIR, "backups");
const Database = createRequire(import.meta.url)(process.env.BETTER_SQLITE3);
const credenciales = JSON.parse(fs.readFileSync(process.env.CREDENCIALES_ROLES, "utf8"));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
async function api(method, ruta, body, token, headers = {}) {
  const res = await fetch(`${BASE}${ruta}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get("content-type") || "";
  return { status: res.status, headers: res.headers, data: type.includes("json") ? await res.json().catch(() => null) : await res.text() };
}
const login = async (email, password = credenciales[email]) => (await api("POST", "/auth/login", { email, password })).data?.token;
/*
 * Corre un script de terminal con el entorno de la instancia de prueba: sin cargar el
 * .env real (FICOTOX_ENV_FILE a un archivo que no existe) y con la misma SECRET_KEY con
 * que el servidor de prueba sella la bitacora (la del .env, que Next carga).
 */
const ENV_VACIO = path.join(TEST_DIR, "sin-env-de-prueba.env");
const script = (nombre, args, extra = {}) => {
  const r = spawnSync(process.execPath, [path.join(root, "scripts", nombre), ...args], { cwd: root, encoding: "utf8", env: { ...process.env, FICOTOX_ENV_FILE: ENV_VACIO, SECRET_KEY: leerEnv().SECRET_KEY || "", DATABASE_URL: "", FICOTOX_INSTANCE_DIR: "", SQLITE_PATH: TEST_DB, FICOTOX_BACKUP_DIR: BACKUPS, PORT: process.env.TEST_PORT || "3100", ...extra } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const actaDe = (dir, salida) => {
  const m = /Acta: (.+\.md)/.exec(salida);
  if (!m) return null;
  try {
    return JSON.parse(fs.readFileSync(m[1].replace(/\.md$/, ".json"), "utf8"));
  } catch {
    return null;
  }
};
const verif = (acta, n) => acta?.verificaciones?.find((v) => v.n === n);
const puertoLibre = () =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
const leerEnv = () => {
  const out = {};
  try {
    for (const linea of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linea);
      if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch {
    /* sin .env */
  }
  return out;
};

const QA = await login("qa@ficotox.local", "QaFicotox2026!");
const tJ = await login("jorge.ramirez@ficotox.local");
const sufijo = Date.now().toString(36).toUpperCase().slice(-5);

/* Una evidencia en disco para que el respaldo incluya archivos (la suite puede correr sola). */
{
  const inspeccion = { checklist: Array.from({ length: 7 }, (_, i) => ({ requisito: `Requisito ${i + 1}`, estado: i === 6 ? "NA" : "C", observacion: null })), observaciones_generales: null };
  const id = `RESP-${sufijo}`;
  const R = (await api("POST", "/samples/reception", { fecha_recepcion: "2026-09-20", hora_recepcion: "09:00", recibido_por: "QA", medio_recepcion: "directa", solicitante: "Cliente respaldo", muestra_unica: true, id_interno: id, fecha_muestra: "2026-09-19", analisis: { tipos: ["toxinas_lipofilicas"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] }, inspeccion, decision_aceptacion: "aceptada", aceptacion: { fecha: "2026-09-20", responsable: "QA" } }, QA)).data?.id;
  const P = (await api("POST", "/samples/processing", { recepcion_id: R, muestra_tipo: "unica", id_interno: id, fecha_procesamiento: "2026-09-20", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "Persona A", nombre_quien_superviso: "Persona B" }, QA)).data?.id;
  const E = (await api("POST", "/samples/extraction", { tipo_registro: "E-D", procesamiento_id: P, tipo_molienda: "fresca", id_interno: id, fecha_extraccion: "2026-09-20", registro_pesos: [{ id_muestra: id, replica: `${id}_R1`, peso_muestra: 2.01 }], nombre_quien_extrajo: "Persona A", nombre_quien_superviso: "Persona B" }, QA)).data?.id;
  const A = (await api("POST", "/samples/analysis", { tipo_analisis: "toxinas_lipofilicas", metodo: "hplc_ms_ms", extraccion_id: E, fecha_analisis: "2026-09-20", analista_nombre: "QA", resultados: [{ id_muestra: id, resultado: 50, unidad: "µg/kg", limite_regulatorio: 160, cumple: "cumple" }] }, QA)).data?.id;
  const r = await adjuntarEvidencia(BASE, QA, A);
  check("datos: un analisis con evidencia en disco", r.status === 201, `${r.status}`);
}

/* ---------- Respaldo por linea de comandos y permisos de Calidad › Respaldos ---------- */
let respaldoId = null;
{
  const lista = await api("GET", "/respaldos", undefined, tJ);
  const sinPermiso = await api("GET", "/respaldos", undefined, QA);
  const crearSinPermiso = await api("POST", "/respaldos", {}, QA);
  check("Calidad › Respaldos: el administrador técnico (respaldos:V) ve la lista; quien no tiene el permiso recibe 403 al ver y al crear", lista.status === 200 && Array.isArray(lista.data?.respaldos) && lista.data?.puede_gestionar === true && sinPermiso.status === 403 && crearSinPermiso.status === 403, `${lista.status} ${sinPermiso.status} ${crearSinPermiso.status}`);
  // Con el servidor encendido: npm run respaldar (snapshot en linea).
  const r = script("respaldar-ficotox.mjs", ["--json"]);
  try {
    respaldoId = JSON.parse(r.out.trim().split("\n").filter((l) => l.startsWith("{")).pop() || "{}").id || null;
  } catch {
    respaldoId = null;
  }
  check("con el servidor encendido, npm run respaldar crea un respaldo", r.code === 0 && !!respaldoId, `${r.code} ${r.out.slice(0, 160)}`);
  const noti = (await api("GET", "/notificaciones", undefined, tJ)).data?.items || [];
  const notiSin = (await api("GET", "/notificaciones", undefined, QA)).data?.items || [];
  check("la campana avisa de respaldos solo a quien tiene respaldos:V (aquí: la prueba de restauración pendiente)", noti.some((n) => n.tipo === "respaldo") && !notiSin.some((n) => n.tipo === "respaldo"), `${noti.map((n) => n.tipo).join(",")} | ${notiSin.map((n) => n.tipo).join(",")}`);
}

const carpeta = path.join(BACKUPS, respaldoId || "sin-id");
const manifest = JSON.parse(fs.readFileSync(path.join(carpeta, "manifest.json"), "utf8"));

/* ---------- Contenido del respaldo ---------- */
{
  const snapshot = new Database(path.join(carpeta, "datos", "ficotox.sqlite3"), { readonly: true });
  const integridad = snapshot.pragma("integrity_check", { simple: true });
  const auditoria = snapshot.prepare("SELECT COUNT(*) AS n FROM auditoria").get().n;
  snapshot.close();
  check("snapshot en linea valido (integrity_check ok) y conteos en el manifest", integridad === "ok" && manifest.base.integrity_check === "ok" && manifest.conteos.auditoria === auditoria && manifest.conteos.adjuntos > 0, `${integridad} ${manifest.conteos.auditoria}/${auditoria} adjuntos=${manifest.conteos.adjuntos}`);
  check("manifest: fecha, host, commit, motor, bitacora (ultimo id y sello) y archivos con SHA-256", !!manifest.creado_en && !!manifest.host && manifest.motor === "sqlite" && manifest.esquema_version >= 10 && !!manifest.bitacora.ultimo_hash && manifest.archivos.length > 0 && manifest.archivos.every((a) => /^[0-9a-f]{64}$/.test(a.sha256) && a.tamano >= 0) && manifest.archivos.some((a) => a.ruta.startsWith("archivos/evidencias/")), `${manifest.archivos.length} archivos, commit ${manifest.app?.commit?.slice(0, 7)}`);
  const llave = fs.readFileSync(path.join(carpeta, "llave", "llave-bitacora.txt"), "utf8").trim();
  const huella = (await import("node:crypto")).createHash("sha256").update(llave).digest("hex");
  check("la llave va aparte (llave/) y el manifest solo guarda su huella", manifest.llave.incluida === true && manifest.llave.huella === huella && !JSON.stringify(manifest).includes(llave), `${manifest.llave.origen}`);
  const env = leerEnv();
  const secretos = [env.JWT_SECRET, process.env.JWT_SECRET, env.SMTP_PASS, env.FICOTOX_GRAPH_CLIENT_SECRET].filter((v) => v && v.length >= 8);
  const textos = [fs.readFileSync(path.join(carpeta, "manifest.json"), "utf8"), llave];
  check("ni el manifest ni la llave contienen JWT_SECRET ni la contrasena SMTP", secretos.every((sec) => textos.every((t) => !t.includes(sec))) && !fs.existsSync(path.join(carpeta, ".env")), `${secretos.length} secreto(s) revisado(s)`);
}

/* ---------- Restauracion en modo prueba ---------- */
let destinoPrueba = null;
{
  destinoPrueba = path.join(TEST_DIR, "restauradas", `prueba-${sufijo}`);
  const r = script("restaurar-ficotox.mjs", ["--respaldo", respaldoId, "--destino", destinoPrueba, "--responsable", "Administrador técnico (pruebas)"]);
  const acta = actaDe(BACKUPS, r.out);
  check("restauracion en modo prueba: exit 0, 8 verificaciones ✅ y acta .md/.json", r.code === 0 && acta?.resultado === "aprobada" && acta.verificaciones.length === 8 && acta.verificaciones.every((v) => v.ok) && acta.modo === "prueba", `${r.code} ${acta?.resultado} ${r.out.split("\n").filter((l) => l.startsWith("❌")).join(" | ")}`);
  check("el modo prueba no toca la instancia real de prueba y deja la copia en el destino", fs.existsSync(path.join(destinoPrueba, "ficotox.sqlite3")) && fs.existsSync(path.join(destinoPrueba, "evidencias")), destinoPrueba);
  // Documentos SGC: el respaldo incluye instance/sgc/ con huellas y la restauracion la copia y verifica (paso 7).
  check("Documentos SGC: el respaldo incluye sus archivos (con SHA-256) y la restauración los copia y verifica", manifest.archivos.some((a) => a.ruta.startsWith("archivos/sgc/")) && fs.existsSync(path.join(destinoPrueba, "sgc")) && verif(acta, 7)?.ok === true && /Documentos SGC/i.test(verif(acta, 7)?.detalle || ""), `${verif(acta, 7)?.detalle}`);
}

/* ---------- Respaldo alterado, llave distinta y sin llave ---------- */
{
  const alterado = path.join(TEST_DIR, "respaldos-alterados", `alt-${sufijo}`);
  fs.cpSync(carpeta, alterado, { recursive: true });
  const evidencia = manifest.archivos.find((a) => a.ruta.startsWith("archivos/evidencias/"));
  fs.appendFileSync(path.join(alterado, ...evidencia.ruta.split("/")), "x");
  const r = script("restaurar-ficotox.mjs", ["--respaldo", alterado, "--destino", path.join(TEST_DIR, "restauradas", `alt-${sufijo}`), "--responsable", "Pruebas"]);
  const acta = actaDe(BACKUPS, r.out);
  check("un archivo del respaldo alterado -> falla la verificacion 1 (exit 1)", r.code === 1 && verif(acta, 1)?.ok === false && /alterado/.test(verif(acta, 1)?.detalle || ""), `${r.code} ${verif(acta, 1)?.detalle}`);

  // Documentos SGC (CA-13): un PDF de sgc/ alterado en el respaldo tambien se detecta, y el manifest cuenta todas las tablas sgc_*.
  const sgcArchivo = manifest.archivos.find((a) => a.ruta.startsWith("archivos/sgc/"));
  if (sgcArchivo) {
    const altSgc = path.join(TEST_DIR, "respaldos-alterados", `altsgc-${sufijo}`);
    fs.cpSync(carpeta, altSgc, { recursive: true });
    fs.appendFileSync(path.join(altSgc, ...sgcArchivo.ruta.split("/")), "x");
    const rs = script("restaurar-ficotox.mjs", ["--respaldo", altSgc, "--destino", path.join(TEST_DIR, "restauradas", `altsgc-${sufijo}`), "--responsable", "Pruebas"]);
    const actaS = actaDe(BACKUPS, rs.out);
    check("un PDF de Documentos SGC alterado en el respaldo -> falla la verificacion 1 (SHA-256)", rs.code === 1 && verif(actaS, 1)?.ok === false && /alterado/.test(verif(actaS, 1)?.detalle || ""), `${rs.code} ${verif(actaS, 1)?.detalle}`);
  } else check("un PDF de Documentos SGC alterado en el respaldo -> falla la verificacion 1 (SHA-256)", false, "el respaldo no trae archivos sgc/");
  const tablasSgc = ["sgc_documentos", "sgc_revisiones", "sgc_archivos", "sgc_flujo_acciones", "sgc_solicitudes", "sgc_renovaciones", "sgc_externos", "sgc_distribucion", "sgc_lecturas"];
  check("el manifest cuenta todas las tablas del módulo Documentos SGC (y se comparan al restaurar)", tablasSgc.every((t) => typeof manifest.conteos[t] === "number"), tablasSgc.filter((t) => typeof manifest.conteos[t] !== "number").join(","));

  const llaveFalsa = path.join(TEST_DIR, `llave-falsa-${sufijo}.txt`);
  fs.writeFileSync(llaveFalsa, "otra-llave-que-no-es-la-del-respaldo-000000\n");
  const r2 = script("restaurar-ficotox.mjs", ["--respaldo", respaldoId, "--destino", path.join(TEST_DIR, "restauradas", `llave-${sufijo}`), "--llave", llaveFalsa, "--responsable", "Pruebas"]);
  const acta2 = actaDe(BACKUPS, r2.out);
  check("llave distinta -> fallan la verificacion de la llave y la de la bitacora, con mensaje claro", r2.code === 1 && verif(acta2, 4)?.ok === false && /NO es la del respaldo/.test(verif(acta2, 4)?.detalle || "") && verif(acta2, 5)?.ok === false && /llave/.test(verif(acta2, 5)?.detalle || ""), `${verif(acta2, 4)?.detalle} | ${verif(acta2, 5)?.detalle}`);

  const sinLlave = path.join(TEST_DIR, "respaldos-alterados", `sinllave-${sufijo}`);
  fs.cpSync(carpeta, sinLlave, { recursive: true });
  fs.rmSync(path.join(sinLlave, "llave"), { recursive: true });
  const r3 = script("restaurar-ficotox.mjs", ["--respaldo", sinLlave, "--destino", path.join(TEST_DIR, "restauradas", `sinllave-${sufijo}`), "--responsable", "Pruebas"]);
  const acta3 = actaDe(BACKUPS, r3.out);
  check("sin llave -> la bitacora no se verifica y el acta lo dice (indicar --llave)", r3.code === 1 && verif(acta3, 4)?.ok === false && /--llave/.test(verif(acta3, 4)?.detalle || "") && verif(acta3, 5)?.ok === false, `${verif(acta3, 4)?.detalle} | ${verif(acta3, 5)?.detalle}`);
  // Rutas con ../ en el manifest: la verificacion 1 falla y no se escribe nada fuera del destino.
  const trampa = path.join(TEST_DIR, "respaldos-alterados", `trampa-${sufijo}`);
  fs.cpSync(carpeta, trampa, { recursive: true });
  const victima = path.join(TEST_DIR, `victima-${sufijo}.txt`);
  fs.writeFileSync(victima, "original");
  const payload = Buffer.from("PWNED");
  const mt = JSON.parse(fs.readFileSync(path.join(trampa, "manifest.json"), "utf8"));
  fs.writeFileSync(path.join(trampa, "archivos", "payload"), payload);
  mt.archivos.push({ ruta: `archivos/../../../${path.basename(victima)}`, tamano: payload.length, sha256: (await import("node:crypto")).createHash("sha256").update(payload).digest("hex") });
  fs.writeFileSync(path.join(trampa, "manifest.json"), JSON.stringify(mt));
  const rt = script("restaurar-ficotox.mjs", ["--respaldo", trampa, "--destino", path.join(TEST_DIR, "restauradas", `trampa-${sufijo}`, "a", "b"), "--responsable", "Pruebas"]);
  const actaT = actaDe(BACKUPS, rt.out);
  check("manifest con ../ -> falla la verificacion 1 y no escribe fuera del destino", rt.code === 1 && verif(actaT, 1)?.ok === false && /ruta no válida/.test(verif(actaT, 1)?.detalle || "") && fs.readFileSync(victima, "utf8") === "original", `${rt.code} ${verif(actaT, 1)?.detalle}`);
  // Enlace simbolico dentro del respaldo (apunta a un archivo del equipo) y manifest malformado: ❌ en la 1, sin copiar, y el acta se genera.
  const enlace = path.join(TEST_DIR, "respaldos-alterados", `enlace-${sufijo}`);
  fs.cpSync(carpeta, enlace, { recursive: true });
  const me = JSON.parse(fs.readFileSync(path.join(enlace, "manifest.json"), "utf8"));
  const ev = me.archivos.find((a) => a.ruta.startsWith("archivos/evidencias/"));
  const secreto = path.join(TEST_DIR, `secreto-${sufijo}.txt`);
  fs.writeFileSync(secreto, "contenido del equipo");
  fs.rmSync(path.join(enlace, ...ev.ruta.split("/")));
  fs.symlinkSync(secreto, path.join(enlace, ...ev.ruta.split("/")));
  ev.sha256 = (await import("node:crypto")).createHash("sha256").update(fs.readFileSync(secreto)).digest("hex");
  fs.writeFileSync(path.join(enlace, "manifest.json"), JSON.stringify(me));
  const re = script("restaurar-ficotox.mjs", ["--respaldo", enlace, "--destino", path.join(TEST_DIR, "restauradas", `enlace-${sufijo}`), "--responsable", "Pruebas"]);
  const actaE = actaDe(BACKUPS, re.out);
  check("un enlace simbolico dentro del respaldo -> falla la 1 y no se copia nada", re.code === 1 && /enlace simbólico/.test(verif(actaE, 1)?.detalle || "") && !fs.existsSync(path.join(TEST_DIR, "restauradas", `enlace-${sufijo}`, "ficotox.sqlite3")), `${re.code} ${verif(actaE, 1)?.detalle}`);
  const malo = path.join(TEST_DIR, "respaldos-alterados", `malo-${sufijo}`);
  fs.cpSync(carpeta, malo, { recursive: true });
  const mm = JSON.parse(fs.readFileSync(path.join(malo, "manifest.json"), "utf8"));
  mm.base = null;
  fs.writeFileSync(path.join(malo, "manifest.json"), JSON.stringify(mm));
  const rm_ = script("restaurar-ficotox.mjs", ["--respaldo", malo, "--destino", path.join(TEST_DIR, "restauradas", `malo-${sufijo}`), "--responsable", "Pruebas"]);
  const actaM = actaDe(BACKUPS, rm_.out);
  check("manifest malformado (base = null): falla la 1 y el acta se genera igual", rm_.code === 1 && verif(actaM, 1)?.ok === false && actaM?.verificaciones?.length === 8, `${rm_.code} ${rm_.out.split("\n").slice(-3).join(" | ")}`);
  // Base alterada con las huellas del manifest recalculadas: el sello del manifest (HMAC con la llave) la delata.
  const rehecho = path.join(TEST_DIR, "respaldos-alterados", `rehecho-${sufijo}`);
  fs.cpSync(carpeta, rehecho, { recursive: true });
  const dbR = new Database(path.join(rehecho, "datos", "ficotox.sqlite3"));
  dbR.prepare("UPDATE muestras_analisis SET observaciones = 'alterado' WHERE id = (SELECT MIN(id) FROM muestras_analisis)").run();
  dbR.close();
  const mr = JSON.parse(fs.readFileSync(path.join(rehecho, "manifest.json"), "utf8"));
  mr.base.sha256 = (await import("node:crypto")).createHash("sha256").update(fs.readFileSync(path.join(rehecho, "datos", "ficotox.sqlite3"))).digest("hex");
  mr.base.tamano = fs.statSync(path.join(rehecho, "datos", "ficotox.sqlite3")).size;
  fs.writeFileSync(path.join(rehecho, "manifest.json"), JSON.stringify(mr));
  const rr = script("restaurar-ficotox.mjs", ["--respaldo", rehecho, "--destino", path.join(TEST_DIR, "restauradas", `rehecho-${sufijo}`), "--responsable", "Pruebas"]);
  const actaR = actaDe(BACKUPS, rr.out);
  check("base alterada con el manifest recalculado -> el sello del manifest no corresponde (verificacion 4)", rr.code === 1 && verif(actaR, 1)?.ok === true && verif(actaR, 4)?.ok === false && /sello del manifest/.test(verif(actaR, 4)?.detalle || ""), `${rr.code} ${verif(actaR, 4)?.detalle}`);
  const conLlave = script("restaurar-ficotox.mjs", ["--respaldo", sinLlave, "--destino", path.join(TEST_DIR, "restauradas", `conllave-${sufijo}`), "--llave", path.join(carpeta, "llave", "llave-bitacora.txt"), "--responsable", "Pruebas"]);
  check("el mismo respaldo sin llave se verifica si se indica la llave guardada aparte (--llave)", conLlave.code === 0, `${conLlave.code}`);
}

/* ---------- Modo real: protecciones ---------- */
{
  const sinConfirmar = script("restaurar-ficotox.mjs", ["--respaldo", respaldoId, "--destino", "instance"]);
  check("modo real sin --confirmar -> se niega (exit 2)", sinConfirmar.code === 2 && /--confirmar/.test(sinConfirmar.out), sinConfirmar.out.trim().slice(0, 120));
  const encendido = script("restaurar-ficotox.mjs", ["--respaldo", respaldoId, "--destino", "instance", "--confirmar"]);
  check("modo real con el servidor encendido -> se niega (exit 2) y no toca la base", encendido.code === 2 && /servidor está encendido|puerto .* está en uso/.test(encendido.out), encendido.out.trim().slice(0, 160));
  const lock = path.join(TEST_DIR, "servidor.lock");
  check("el servidor deja su archivo de bloqueo con su pid", fs.existsSync(lock) && Number(JSON.parse(fs.readFileSync(lock, "utf8")).pid) > 0, lock);
}

/* ---------- Modo real correcto (sobre una instancia apagada de prueba) ---------- */
{
  const inst = path.join(TEST_DIR, `instancia-real-${sufijo}`);
  const prep = script("restaurar-ficotox.mjs", ["--respaldo", respaldoId, "--destino", inst, "--responsable", "Pruebas"]);
  const backupsReal = path.join(TEST_DIR, `respaldos-real-${sufijo}`);
  const puerto = await puertoLibre();
  const antes = new Database(path.join(inst, "ficotox.sqlite3"), { readonly: true });
  const entradasAntes = antes.prepare("SELECT COUNT(*) AS n FROM auditoria").get().n;
  antes.close();
  const r = script("restaurar-ficotox.mjs", ["--respaldo", carpeta, "--destino", "instance", "--confirmar", "--responsable", "Administrador técnico (pruebas)"], { SQLITE_PATH: path.join(inst, "ficotox.sqlite3"), FICOTOX_BACKUP_DIR: backupsReal, PORT: String(puerto) });
  const acta = actaDe(backupsReal, r.out);
  const previos = fs.readdirSync(backupsReal).filter((n) => /^\d{8}-\d{6}/.test(n));
  const previo = previos.length ? JSON.parse(fs.readFileSync(path.join(backupsReal, previos[0], "manifest.json"), "utf8")) : null;
  const d = new Database(path.join(inst, "ficotox.sqlite3"), { readonly: true });
  const filas = d.prepare("SELECT * FROM auditoria ORDER BY id").all();
  const ultima = filas[filas.length - 1];
  const seq = d.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'auditoria'").get();
  const triggers = d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'auditoria'").get().n;
  d.close();
  const llave = fs.readFileSync(path.join(carpeta, "llave", "llave-bitacora.txt"), "utf8").trim();
  const cadena = evaluarCadena(filas, llave, seq ? Number(seq.seq) : null, Number(triggers));
  check("modo real: preparado en una instancia apagada", prep.code === 0, `${prep.code}`);
  check("modo real correcto: exit 0 y acta 'real' aprobada", r.code === 0 && acta?.modo === "real" && acta?.resultado === "aprobada" && acta?.restaurado === true, `${r.code} ${r.out.split("\n").filter((l) => /❌|rechazado/.test(l)).join(" | ")}`);
  check("antes de sobrescribir crea un respaldo automatico de la instancia actual", !!previo && /antes de restaurar/.test(previo.etiqueta || ""), previos.join(","));
  check("agrega la entrada 'restauración desde respaldo' como sistema y la cadena sigue integra", filas.length === entradasAntes + 1 && ultima.accion === "restaurar_respaldo" && ultima.usuario_id === null && ultima.referencia === respaldoId && cadena.ok, `${entradasAntes}->${filas.length} ${ultima?.accion} ok=${cadena.ok}`);
}

/* ---------- Retencion ---------- */
{
  const dir = path.join(TEST_DIR, `respaldos-retencion-${sufijo}`);
  const extra = { FICOTOX_BACKUP_DIR: dir };
  const ids = [];
  for (let i = 0; i < 3; i += 1) {
    const r = script("respaldar-ficotox.mjs", ["--json", "--sin-retencion"], extra);
    ids.push(JSON.parse(r.out.trim().split("\n").pop()).id);
  }
  // El mas viejo tiene una prueba de restauracion aprobada: es el ultimo respaldo verificado.
  fs.mkdirSync(path.join(dir, "pruebas-restauracion"), { recursive: true });
  const huellaDe = (id) => (awaitCrypto).createHash("sha256").update(fs.readFileSync(path.join(dir, id, "manifest.json"))).digest("hex");
  fs.writeFileSync(path.join(dir, "pruebas-restauracion", "20000101-000000.json"), JSON.stringify({ fecha: new Date().toISOString(), respaldo_id: ids[0], respaldo_ruta: path.join(dir, ids[0]), manifest_sha256: huellaDe(ids[0]), responsable: "Pruebas", modo: "prueba", resultado: "aprobada", duracion_ms: 1, verificaciones: [] }));
  // Un acta de una COPIA con el mismo id (otra carpeta) no cuenta como verificacion de este respaldo.
  fs.writeFileSync(path.join(dir, "pruebas-restauracion", "20000101-000001.json"), JSON.stringify({ fecha: new Date().toISOString(), respaldo_id: ids[1], respaldo_ruta: path.join(TEST_DIR, "otra-copia", ids[1]), manifest_sha256: huellaDe(ids[1]), responsable: "Pruebas", modo: "prueba", resultado: "aprobada", duracion_ms: 1, verificaciones: [] }));
  const r = script("respaldar-ficotox.mjs", ["--json"], { ...extra, RESPALDO_RETENCION: "1" });
  const salida = JSON.parse(r.out.trim().split("\n").pop());
  const quedan = fs.readdirSync(dir).filter((n) => /^\d{8}-\d{6}/.test(n)).sort();
  check("retencion (1): conserva el mas reciente y nunca borra el ultimo respaldo verificado (un acta de otra copia no cuenta)", quedan.length === 2 && quedan.includes(ids[0]) && quedan.includes(salida.id) && salida.eliminados.includes(ids[1]) && salida.eliminados.includes(ids[2]), `${ids.join(",")} -> ${quedan.join(",")}`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
