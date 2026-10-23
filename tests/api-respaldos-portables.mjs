/*
 * Respaldos portables (Calidad › Respaldos), contra el servidor de prueba:
 * - Descargar (respaldos:G + reautenticacion): contraseña de cifrado de 12+
 *   caracteres escrita dos veces; enlace de un solo uso; el archivo .ficotox se
 *   descifra igual byte a byte; la bitacora dice quien y que, nunca la contraseña.
 * - Importar (respaldos:G + reautenticacion), por partes: contraseña
 *   incorrecta (se corrige sin volver a subir), archivo alterado, truncado, que
 *   no es un respaldo (grande: varias partes), demasiado grande, 403, sin
 *   reautenticacion. Un respaldo bueno queda en la lista como «Importado» y se
 *   restaura con el flujo de siempre (segundo usuario). Uno sellado con otra
 *   llave se importa pero no se puede restaurar (409 llave_distinta).
 * - Deja en instance/test/murio/ el archivo descargado y lo que debe quedar
 *   igual, para la prueba «la computadora murió» (instalacion.mjs).
 * Va antes de api-restaurar.mjs: restaura la plataforma (cierra las sesiones y
 * vuelve al respaldo creado al inicio de esta suite).
 */
import "./lib/reauth-auto.mjs";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { abrirPortable, escribirPortable, nombreValidoEnWindows } from "../src/lib/shared/respaldo-portable.mjs";
import { fotoDeRespaldo, respaldoAjeno, sha256, subirPorPartes } from "./lib/portables.mjs";

const BASE = process.env.BASE || "http://localhost:3100/api";
const TEST_DB = process.env.TEST_DB_PATH;
const TEST_DIR = path.dirname(TEST_DB || "");
if (!TEST_DB || !TEST_DIR.includes(`${path.sep}instance${path.sep}test`)) {
  console.error("api-respaldos-portables.mjs solo corre contra la base de prueba (instance/test)");
  process.exit(1);
}
const BACKUPS = process.env.FICOTOX_BACKUP_DIR || path.join(TEST_DIR, "backups");
const TMP = path.join(TEST_DIR, "portables-tmp");
const MURIO = path.join(TEST_DIR, "murio");
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
  return { status: res.status, data: type.includes("json") ? await res.json().catch(() => null) : await res.text() };
}
const login = async (email, password = credenciales[email]) => (await api("POST", "/auth/login", { email, password })).data?.token;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const SIN_APROBAR = { "X-Sin-Aprobar-Auto": "1" };
const SIN_REAUTH = { "X-Sin-Reauth-Auto": "1" };
const JORGE = "jorge.ramirez@ficotox.local";
const PATRICIA = "patricia.luna@ficotox.local";
const CONTRASENA = "Cifrado de prueba 2026!";
const leer = (sql, ...args) => {
  const db = new Database(TEST_DB, { readonly: true, fileMustExist: true });
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
};

async function esperarTrabajo(token, tipo) {
  for (let i = 0; i < 480; i += 1) {
    const t = (await api("GET", "/respaldos/estado", undefined, token)).data?.trabajo;
    if (t && t.tipo === tipo && t.estado !== "en_curso") return t;
    await espera(250);
  }
  return null;
}
async function crearRespaldo(token, etiqueta) {
  const r = await api("POST", "/respaldos", { etiqueta }, token);
  const t = r.status === 202 ? await esperarTrabajo(token, "respaldo") : null;
  return t?.estado === "terminado" ? t.respaldo_id : null;
}
const subir = (token, datos, nombre) => subirPorPartes({ base: BASE, inicio: "/respaldos/importar/subidas", datos, nombre, headers: { Authorization: `Bearer ${token}` } });
async function importar(token, datos, contrasena = CONTRASENA, nombre = "respaldo.ficotox") {
  const s = await subir(token, datos, nombre);
  if (s.status !== 201) return { subida: s, r: null, trabajo: null };
  const r = await api("POST", "/respaldos/importar", { subida: s.id, contrasena }, token);
  const trabajo = r.status === 202 ? await esperarTrabajo(token, "importacion") : null;
  return { subida: s, r, trabajo };
}
const importando = () => (fs.existsSync(path.join(BACKUPS, ".importando")) ? fs.readdirSync(path.join(BACKUPS, ".importando")) : []);
const carpetasRespaldo = () => fs.readdirSync(BACKUPS).filter((n) => /^\d{8}-\d{6}/.test(n)).sort();

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
let tJ = await login(JORGE);
let tP = await login(PATRICIA);
const QA = await login("qa@ficotox.local", "QaFicotox2026!");

/* ---------- Datos y respaldo de partida ---------- */
const marca = `Reactivo de la computadora que murió ${Date.now()}`;
{
  const r = await api("POST", "/inventory/reactivos", { tipo_reactivo: "alcoholes_solventes", producto: marca, capacidad: 0.5, unidad_capacidad: "L", piezas: 2 }, QA);
  check("se registra un reactivo antes del respaldo", r.status === 201 || r.status === 200, `${r.status}`);
}
const respaldo = await crearRespaldo(tJ, "Antes de llevarlo a otra computadora");
const carpeta = path.join(BACKUPS, String(respaldo));
check("se crea el respaldo que se va a descargar", !!respaldo && fs.existsSync(carpeta), String(respaldo));

/* ---------- Descargar: permisos, reautenticacion y contraseña ---------- */
const cuerpo = { contrasena: CONTRASENA, confirmacion: CONTRASENA };
{
  const rP = await api("POST", `/respaldos/${respaldo}/descargar`, cuerpo, tP);
  const rQ = await api("POST", `/respaldos/${respaldo}/descargar`, cuerpo, QA);
  check("sin respaldos:G no se puede descargar (403)", rP.status === 403 && rQ.status === 403, `${rP.status} ${rQ.status}`);
  const sin = await api("POST", `/respaldos/${respaldo}/descargar`, cuerpo, tJ, SIN_REAUTH);
  check("sin confirmar la identidad responde 401 reauth_required (respaldos:descargar)", sin.status === 401 && sin.data?.codigo === "reauth_required" && sin.data?.accion === "respaldos:descargar", `${sin.status} ${JSON.stringify(sin.data).slice(0, 120)}`);
  const corta = await api("POST", `/respaldos/${respaldo}/descargar`, { contrasena: "corta123", confirmacion: "corta123" }, tJ);
  const distinta = await api("POST", `/respaldos/${respaldo}/descargar`, { contrasena: CONTRASENA, confirmacion: `${CONTRASENA}x` }, tJ);
  check("contraseña de cifrado corta (< 12) o mal confirmada: 400 en su campo", corta.status === 400 && corta.data?.campo === "contrasena" && distinta.status === 400 && distinta.data?.campo === "confirmacion", `${corta.status} ${corta.data?.campo} ${distinta.status} ${distinta.data?.campo}`);
  const noExiste = await api("POST", "/respaldos/20000101-000000/descargar", cuerpo, tJ);
  const raro = await api("POST", "/respaldos/..%2F..%2Fetc/descargar", cuerpo, tJ);
  check("un respaldo que no existe (o una ruta rara) responde 404", noExiste.status === 404 && raro.status === 404, `${noExiste.status} ${raro.status}`);
}
const archivo = path.join(TMP, "descargado.ficotox");
let nombreDescarga = "";
{
  const r = await api("POST", `/respaldos/${respaldo}/descargar`, cuerpo, tJ);
  nombreDescarga = String(r.data?.nombre || "");
  check("con respaldos:G y su contraseña se obtiene un enlace de un solo uso", r.status === 200 && /^\/api\/respaldos\/descargas\/[A-Za-z0-9_-]{43}$/.test(String(r.data?.url)), `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  check("el nombre del archivo es válido en Windows y termina en .ficotox", nombreValidoEnWindows(nombreDescarga) && nombreDescarga.endsWith(".ficotox") && !/[:]/.test(nombreDescarga), nombreDescarga);
  const url = new URL(String(r.data?.url), BASE).toString();
  const res = await fetch(url);
  const bytes = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(archivo, bytes);
  check("la descarga sale con su tamaño exacto, sin caché y como adjunto", res.status === 200 && Number(res.headers.get("content-length")) === bytes.length && /no-store/.test(res.headers.get("cache-control") || "") && (res.headers.get("content-disposition") || "").includes(nombreDescarga), `${res.status} ${res.headers.get("content-length")} ${bytes.length}`);
  const otraVez = await fetch(url);
  const falso = await fetch(new URL(`/api/respaldos/descargas/${"A".repeat(43)}`, BASE).toString());
  check("el enlace no sirve dos veces ni uno inventado (404)", otraVez.status === 404 && falso.status === 404, `${otraVez.status} ${falso.status}`);
  const texto = bytes.toString("latin1");
  check("el archivo no lleva datos legibles (está cifrado)", !texto.includes("SQLite format 3") && !texto.includes("manifest") && !texto.includes(marca), "");
}
{
  // Ida y vuelta: lo descifrado es igual byte a byte a la carpeta del respaldo (ficha, base, llave y archivos).
  const destino = path.join(TMP, "abierto");
  const abierto = await abrirPortable({ archivo, contrasena: CONTRASENA, destino });
  const manifest = JSON.parse(fs.readFileSync(path.join(carpeta, "manifest.json"), "utf8"));
  const rutas = ["manifest.json", manifest.base?.ruta || "datos/ficotox.sqlite3", manifest.llave?.ruta, ...(manifest.archivos || []).map((a) => a.ruta)].filter(Boolean);
  const distintos = rutas.filter((r) => !fs.existsSync(path.join(destino, r)) || sha256(path.join(destino, r)) !== sha256(path.join(carpeta, r)));
  check("descifrado, el respaldo es idéntico byte a byte", abierto.archivos === rutas.length && distintos.length === 0, `${abierto.archivos}/${rutas.length} distintos: ${distintos.join(", ")}`);
  const pdfs = (manifest.archivos || []).filter((a) => /^archivos\/informes\/.+\.pdf$/.test(a.ruta)).length;
  const db = new Database(path.join(carpeta, "datos", "ficotox.sqlite3"), { readonly: true, fileMustExist: true });
  const enBase = Number(db.prepare("SELECT COUNT(DISTINCT archivo_pdf) AS n FROM informes WHERE archivo_pdf IS NOT NULL").get().n);
  db.close();
  check("incluye los PDF de los informes de la base", pdfs >= enBase, `${pdfs} PDF, ${enBase} informes con PDF`);
  fs.rmSync(destino, { recursive: true, force: true });
}
{
  const entrada = leer("SELECT * FROM auditoria WHERE accion = 'descargar_respaldo' ORDER BY id DESC LIMIT 1")[0];
  const filas = leer("SELECT cambios_json, datos_nuevos_json, datos_anteriores_json, motivo, referencia FROM auditoria WHERE id >= ?", Number(entrada?.id || 0) - 20);
  const conContrasena = filas.filter((f) => JSON.stringify(f).includes(CONTRASENA));
  check("la descarga queda en la bitácora (quién y qué respaldo)", !!entrada && entrada.entidad_id === respaldo && entrada.usuario_email?.startsWith("jor"), `${entrada?.entidad_id} ${entrada?.usuario_email}`);
  check("la contraseña de cifrado no aparece en la bitácora", conContrasena.length === 0, `${conContrasena.length}`);
}

/* «La computadora murió»: el archivo y lo que debe quedar igual, para instalacion.mjs. */
fs.rmSync(MURIO, { recursive: true, force: true });
fs.mkdirSync(MURIO, { recursive: true });
fs.copyFileSync(archivo, path.join(MURIO, "respaldo.ficotox"));
fs.writeFileSync(path.join(MURIO, "esperado.json"), JSON.stringify({ contrasena: CONTRASENA, marca, nombre: nombreDescarga, ...fotoDeRespaldo(Database, carpeta) }, null, 2));

/* ---------- Importar: rechazos ---------- */
const original = fs.readFileSync(archivo);
{
  const p = await subir(tP, original);
  const q = await subir(QA, original);
  check("sin respaldos:G no se puede subir un respaldo (403)", p.status === 403 && q.status === 403, `${p.status} ${q.status}`);
  const grande = await api("POST", "/respaldos/importar/subidas", { tamano: 10 * 1024 ** 4, nombre: "enorme.ficotox" }, tJ);
  check("un archivo más grande que el límite se rechaza antes de subirlo (413)", grande.status === 413 && grande.data?.codigo === "demasiado_grande", `${grande.status} ${grande.data?.codigo}`);
}
{
  // Contraseña incorrecta: 400 y la subida se conserva para reintentar sin subir de nuevo; sin reautenticacion: 401.
  const s = await subir(tJ, original);
  const ajeno = await fetch(`${BASE}/respaldos/importar/subidas/${s.id}?desde=0`, { method: "PUT", headers: { Authorization: `Bearer ${tP}`, "Content-Type": "application/octet-stream" }, body: Buffer.from("x") });
  check("sin respaldos:G no se puede agregar a una subida (403)", ajeno.status === 403, `${ajeno.status}`);
  const mala = await api("POST", "/respaldos/importar", { subida: s.id, contrasena: "no es la contraseña" }, tJ);
  check("contraseña de cifrado incorrecta: 400 contrasena_incorrecta en su campo", mala.status === 400 && mala.data?.codigo === "contrasena_incorrecta" && mala.data?.campo === "contrasena", `${mala.status} ${JSON.stringify(mala.data).slice(0, 140)}`);
  const sinReauth = await api("POST", "/respaldos/importar", { subida: s.id, contrasena: CONTRASENA }, tJ, SIN_REAUTH);
  check("sin confirmar la identidad responde 401 reauth_required (respaldos:importar)", sinReauth.status === 401 && sinReauth.data?.codigo === "reauth_required" && sinReauth.data?.accion === "respaldos:importar", `${sinReauth.status} ${sinReauth.data?.accion}`);
  const antes = carpetasRespaldo();
  const r = await api("POST", "/respaldos/importar", { subida: s.id, contrasena: CONTRASENA }, tJ);
  const t = r.status === 202 ? await esperarTrabajo(tJ, "importacion") : null;
  check("con la contraseña correcta la misma subida se importa (sin volver a subirla)", t?.estado === "terminado" && t?.resultado === "aprobada", `${r.status} ${JSON.stringify(t).slice(0, 200)}`);
  const nuevas = carpetasRespaldo().filter((n) => !antes.includes(n));
  const lista = (await api("GET", "/respaldos", undefined, tJ)).data?.respaldos || [];
  const imp = lista.find((x) => x.id === nuevas[0]);
  check("queda en la lista como «Importado», con otro nombre si ya existía (sin pisar el original)", nuevas.length === 1 && nuevas[0] === `${respaldo}-2` && imp?.tipo === "importado" && lista.some((x) => x.id === respaldo && x.tipo !== "importado"), `${nuevas} ${imp?.tipo}`);
  check("la llave coincide con la de esta instalación y pasó la prueba de restauración", imp?.llave_coincide === true && imp?.verificacion?.resultado === "aprobada", JSON.stringify(imp || {}).slice(0, 200));
  check("no quedan temporales de la importación", importando().length === 0, importando().join(", "));
  const entrada = leer("SELECT * FROM auditoria WHERE accion = 'importar_respaldo' ORDER BY id DESC LIMIT 1")[0];
  check("la importación queda en la bitácora", !!entrada && entrada.entidad_id === nuevas[0], `${entrada?.entidad_id}`);
}
const importado = `${respaldo}-2`;
{
  // Alterado: un byte cambiado a la mitad del archivo; truncado; algo que no es un respaldo (120 MB: varias partes).
  const antes = carpetasRespaldo();
  const alterado = Buffer.from(original);
  alterado[Math.floor(alterado.length / 2)] ^= 0x01;
  const a = await importar(tJ, alterado);
  check("archivo alterado: no se importa nada y se explica (trabajo fallido)", a.r?.status === 202 && a.trabajo?.estado === "fallido" && /alterad|dañad/i.test(String(a.trabajo?.mensaje)), `${a.r?.status} ${a.trabajo?.mensaje}`);
  const truncado = await importar(tJ, original.subarray(0, original.length - 1000));
  check("archivo truncado: 400 archivo_truncado", truncado.r?.status === 400 && truncado.r?.data?.codigo === "archivo_truncado", `${truncado.r?.status} ${truncado.r?.data?.codigo}`);
  const basura = randomBytes(120 * 1024 * 1024);
  const n = await importar(tJ, basura, CONTRASENA, "fotos.zip");
  check("un archivo grande que no es un respaldo sube por partes y se rechaza: 400 no_es_respaldo", n.subida.status === 201 && n.r?.status === 400 && n.r?.data?.codigo === "no_es_respaldo", `${n.subida.status} ${n.r?.status} ${n.r?.data?.codigo}`);
  check("tras los rechazos no quedó ningún respaldo nuevo ni temporales", carpetasRespaldo().join() === antes.join() && importando().length === 0, `${carpetasRespaldo().filter((x) => !antes.includes(x))} ${importando()}`);
  const fallidas = leer("SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'importar_respaldo_fallido'")[0].n;
  check("el intento fallido queda en la bitácora", fallidas >= 1, `${fallidas}`);
}

/* ---------- Otra llave: se importa, pero no se puede restaurar ---------- */
{
  const ajena = respaldoAjeno(path.join(TMP, "ajena"));
  const archivoAjeno = path.join(TMP, "ajeno.ficotox");
  await escribirPortable(ajena, CONTRASENA, archivoAjeno);
  const antes = carpetasRespaldo();
  const i = await importar(tJ, fs.readFileSync(archivoAjeno), CONTRASENA, "ajeno.ficotox");
  const id = carpetasRespaldo().find((n) => !antes.includes(n));
  const fila = ((await api("GET", "/respaldos", undefined, tJ)).data?.respaldos || []).find((x) => x.id === id);
  check("un respaldo de otra instalación se importa y avisa que su llave es otra", i.trabajo?.estado === "terminado" && /otra llave/i.test(String(i.trabajo?.mensaje)) && fila?.llave_coincide === false, `${i.trabajo?.estado} ${i.trabajo?.mensaje} ${fila?.llave_coincide}`);
  const r = await api("POST", `/respaldos/${id}/restaurar`, { motivo: "Intentar restaurar con otra llave" }, tJ, SIN_APROBAR);
  const pendientes = ((await api("GET", "/solicitudes?estado=pendiente", undefined, tJ)).data?.items || []).filter((s) => s.tipo === "restaurar_respaldo");
  check("restaurarlo se niega: 409 llave_distinta con la explicación, y no se crea la solicitud", r.status === 409 && r.data?.codigo === "llave_distinta" && /Configuración inicial/.test(String(r.data?.message)) && pendientes.length === 0, `${r.status} ${r.data?.codigo} ${pendientes.length}`);
}

/* ---------- El importado se restaura con el flujo de siempre (segundo usuario) ---------- */
{
  const r = await api("POST", `/respaldos/${importado}/restaurar`, { motivo: "Recuperar desde el respaldo importado" }, tJ, SIN_APROBAR);
  const solicitud = r.data?.solicitud;
  check("pedir restaurar el importado crea la solicitud pendiente", r.status === 202 && solicitud?.estado === "pendiente", `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  const propia = await api("POST", `/solicitudes/${solicitud?.id}/aprobar`, { motivo: "Me la apruebo" }, tJ);
  check("quien la pidió no la aprueba (409)", propia.status === 409, `${propia.status}`);
  const ok = await api("POST", `/solicitudes/${solicitud?.id}/aprobar`, { motivo: "Autorizo recuperar el importado" }, tP);
  check("la Responsable General la aprueba", ok.status === 200 && ok.data?.resultado?.programada === true, `${ok.status} ${JSON.stringify(ok.data).slice(0, 160)}`);
  let trabajo = null;
  for (let i = 0; i < 480 && !trabajo; i += 1) {
    await espera(250);
    if ((await api("GET", "/health")).status !== 200) continue;
    tJ = await login(JORGE);
    const t = tJ ? (await api("GET", "/respaldos/estado", undefined, tJ)).data?.trabajo : null;
    if (t?.tipo === "restauracion" && t.estado !== "en_curso") trabajo = t;
  }
  check("la plataforma se restauró desde el respaldo importado", trabajo?.estado === "terminado" && trabajo?.resultado === "aprobada" && trabajo?.respaldo_id === importado, JSON.stringify(trabajo || {}).slice(0, 200));
  tP = await login(PATRICIA);
  const verify = await api("GET", "/audit/verify", undefined, tP);
  check("la bitácora quedó íntegra", verify.status === 200 && verify.data?.ok === true, `${verify.status} ${JSON.stringify(verify.data).slice(0, 120)}`);
  const reactivo = leer("SELECT nombre, producto FROM reactivos WHERE producto = ? OR nombre = ?", marca, marca);
  check("los datos son los del respaldo (el reactivo registrado antes sigue ahí)", reactivo.length === 1, `${reactivo.length}`);
}

fs.rmSync(TMP, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pruebas de respaldos portables pasaron`);
process.exit(failed ? 1 : 0);
