/*
 * Documentos SGC, Fase 4: criterios de aceptacion que no cubria otra suite.
 * - CA-01: seis areas con sigla, nombre y HEX de la especificacion (via API).
 * - CA-09: la exportacion (PDF) conserva clave, revision, estado, responsables y fechas de cada renglon.
 * - CA-12: la bitacora es de solo lectura (sin endpoints de edicion o borrado; la base rechaza UPDATE/DELETE)
 *   y el historial de la ficha esta completo.
 * - CA-15: CLAUDE.md documenta el modulo (acciones, flujo, confidencialidad y recuperacion).
 * - CA-16: ninguna ruta de la API responde datos sin sesion (salvo inicio de sesion y salud) y no hay rutas publicas
 *   de documentos ni informes.
 */
import "./lib/reauth-auto.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api, BASE, crearCheck, Database, fila, sesiones } from "./lib/calidad.mjs";
import { pdfConTexto } from "./lib/archivos.mjs";

const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const s5 = Date.now().toString(36).slice(-4).toUpperCase();

/* ---------- CA-01 ---------- */
const ESPEC = { GC: ["Gestión de Calidad", "#9852B0"], TH: ["Gestión de Talento Humano", "#913B0B"], AD: ["Gestión Administrativa", "#E53BB9"], CO: ["Gestión Comercial", "#E36A10"], TC: ["Gestión Técnica", "#429B4B"], DI: ["Documentos rectores", "#217FCB"] };
const resumen = (await api("GET", "/sgc/resumen", undefined, t.luis)).data;
const areas = resumen?.areas || [];
check("CA-01: seis carpetas con sigla, nombre y HEX de la especificación", areas.length === 6 && Object.entries(ESPEC).every(([c, [n, hex]]) => areas.some((a) => a.codigo === c && a.nombre === n && String(a.color).toUpperCase() === hex)), areas.map((a) => `${a.codigo}:${a.color}`).join(" "));

/* ---------- CA-09: la exportacion no pierde datos ---------- */
const fd = new FormData();
for (const [k, v] of Object.entries({ clave: `FX-COP-A${s5}`, titulo: `Procedimiento de aceptación ${s5}`, area_codigo: "CO", tipo_codigo: "P", elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.patricia, propietario_id: id.gabriela, numero: 3 })) fd.append(k, String(v));
fd.append("archivo_pdf", new Blob([await pdfConTexto(1, "Aceptación")]), "a.pdf");
const D = (await api("POST", "/sgc/documentos", fd, t.ana)).data;
await api("POST", `/sgc/revisiones/${D.revision_id}/registrar-vigente`, { fecha_emision: "2025-04-07", fecha_vigencia: "2025-04-14", fecha_proxima_revision: "2028-04-07" }, t.ana);
const renglon = ((await api("GET", `/sgc/lista-maestra?search=${encodeURIComponent(`FX-COP-A${s5}`)}`, undefined, t.ana)).data?.items || [])[0];
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const pdf = await api("GET", `/sgc/lista-maestra/pdf?area=CO&search=${encodeURIComponent(`FX-COP-A${s5}`)}`, undefined, t.ana);
const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf.data), isEvalSupported: false, standardFontDataUrl: path.join(root, "node_modules/pdfjs-dist/standard_fonts/") }).promise;
let texto = "";
for (let i = 1; i <= doc.numPages; i += 1) texto += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(" ") + "\n";
const plano = texto.replace(/\s+/g, " ");
const partes = (s) => String(s).split(/\s+/).every((p) => plano.includes(p));
check("CA-09: el renglón de la lista conserva clave, revisión, estado, responsables y fechas", renglon && renglon.clave === `FX-COP-A${s5}` && renglon.revision === "Rev. 3" && renglon.estado === "vigente" && renglon.elaborador && renglon.revisor && renglon.autorizador && renglon.propietario && renglon.emision === "2025-04-07" && renglon.vigencia === "2025-04-14" && renglon.proxima_revision === "2028-04-07", JSON.stringify(renglon));
check("CA-09: el PDF exportado conserva esos mismos datos", plano.includes(`FX-COP-A${s5}`) && plano.includes("Rev. 3") && plano.includes("Vigente") && [renglon?.elaborador, renglon?.revisor, renglon?.autorizador, renglon?.propietario].every(partes) && ["07/04/2025", "14/04/2025", "07/04/2028"].every((f) => plano.includes(f)), plano.slice(0, 400));

/* ---------- CA-12: bitacora de solo lectura y completa ---------- */
const eventos = (await api("GET", `/sgc/documentos/${D.id}`, undefined, t.ana)).data?.eventos || [];
check("CA-12: la ficha muestra el historial completo (crear, carga inicial y exportación no la ensucian)", ["crear", "publicar"].every((a) => eventos.some((e) => e.accion === a)));
const audId = fila("SELECT id FROM auditoria WHERE entidad = 'sgc_documentos' AND entidad_id = ? ORDER BY id LIMIT 1", String(D.id))?.id;
const intentos = [];
for (const m of ["PUT", "PATCH", "DELETE"]) for (const ruta of [`/audit/${audId}`, `/audit`, `/auditoria/${audId}`]) intentos.push((await api(m, ruta, { motivo: "x" }, t.qa)).status);
check("CA-12: la API no ofrece editar ni borrar entradas de la bitácora (ni con permisos plenos)", intentos.every((st) => [404, 405].includes(st)), intentos.join(","));
const db = new Database(process.env.TEST_DB_PATH);
let upd = null;
let del = null;
try {
  db.prepare("UPDATE auditoria SET motivo = 'alterado' WHERE id = ?").run(audId);
} catch (e) {
  upd = String(e.message);
}
try {
  db.prepare("DELETE FROM auditoria WHERE id = ?").run(audId);
} catch (e) {
  del = String(e.message);
}
db.close();
check("CA-12: la base rechaza modificar o borrar la bitácora (disparadores)", !!upd && !!del, `${upd} | ${del}`);

/* ---------- CA-15: documentacion tecnica (CLAUDE.md) ---------- */
const claudeMd = path.join(root, "CLAUDE.md");
const guia = fs.existsSync(claudeMd) ? fs.readFileSync(claudeMd, "utf8") : "";
const seccionSgc = guia.slice(guia.indexOf("**Documentos SGC**"));
check("CA-15: CLAUDE.md documenta Documentos SGC (acciones, flujo, confidencialidad y recuperación)", guia.includes("**Documentos SGC**") && [/acciones documentales/i, /flujo/i, /confidencial/i, /recuperaci/i].every((r) => r.test(seccionSgc)));

/* ---------- CA-16: sin acceso sin sesion ni publicacion externa ---------- */
const rutas = [];
const recorrer = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(p);
    else if (e.name === "route.ts") {
      const rel = path.relative(path.join(root, "src", "app", "api"), path.dirname(p)).split(path.sep).join("/");
      const metodos = [...fs.readFileSync(p, "utf8").matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
      rutas.push({ ruta: `/${rel.replace(/\[\.\.\.[^\]]+\]/g, "x/y").replace(/\[[^\]]+\]/g, "1")}`, metodos });
    }
  }
};
recorrer(path.join(root, "src", "app", "api"));
// Unicas rutas sin sesion: iniciar sesion, la configuracion de la pantalla de inicio de sesion y las comprobaciones de salud (sin datos).
// Las de /instalacion (configuracion inicial) solo atienden con la base sin cuentas y el codigo de instalacion: aqui responden 404.
// /respaldos/descargas/<token> exige un enlace de un solo uso creado con sesion y reautenticacion: uno inventado responde 404.
const PUBLICAS = new Set(["POST /auth/login", "GET /auth/config", "GET /health", "GET /health/db"]);
const abiertas = [];
let probadas = 0;
for (const r of rutas) {
  for (const m of r.metodos) {
    const clave = `${m} ${r.ruta}`;
    if (PUBLICAS.has(clave)) continue;
    const res = await fetch(`${BASE}${r.ruta}`, { method: m, headers: { "Content-Type": "application/json" }, body: m === "GET" ? undefined : "{}" });
    probadas += 1;
    if (res.status < 400 || ![401, 403, 404, 405, 410].includes(res.status)) abiertas.push(`${clave} → ${res.status}`);
  }
}
const instalacion = rutas.filter((r) => r.ruta.startsWith("/instalacion"));
const cerradas = await Promise.all(instalacion.flatMap((r) => r.metodos.map(async (m) => (await fetch(`${BASE}${r.ruta}`, { method: m, headers: { "Content-Type": "application/json" }, body: m === "GET" ? undefined : "{}" })).status)));
check("CA-16: con cuentas, la configuración inicial no existe (404 en todas sus rutas)", cerradas.length >= 6 && cerradas.every((st) => st === 404), cerradas.join(" "));
check(`CA-16: ninguna de las ${probadas} combinaciones ruta × método de la API responde sin sesión`, probadas > 150 && abiertas.length === 0, abiertas.slice(0, 8).join(" | "));
const sinSesion = (await Promise.all(["/health", "/health/db", "/auth/config"].map(async (r) => (await fetch(`${BASE}${r}`)).text()))).join(" ");
check("CA-16: las rutas sin sesión (salud y configuración del inicio de sesión) no exponen documentos, informes ni usuarios", !/sgc|clave|informe|FX-|@ficotox|usuario|token/i.test(sinSesion), sinSesion.slice(0, 200));
check("CA-16: no hay rutas públicas, de compartir ni de clientes para documentos o informes", !rutas.some((r) => /\/(public[oa]?s?|compartir|share|clientes?|portal|enlace)(\/|$)/i.test(r.ruta)), rutas.filter((r) => /\/(public[oa]?s?|share|clientes?|portal)(\/|$)/i.test(r.ruta)).map((r) => r.ruta).join(","));
const archivoSinSesion = await fetch(`${BASE}/sgc/archivos/${fila("SELECT id FROM sgc_archivos ORDER BY id LIMIT 1")?.id}`);
const maestraSinSesion = await fetch(`${BASE}/sgc/lista-maestra/pdf`);
check("CA-16: archivos de documentos y Lista Maestra sin sesión → 401", archivoSinSesion.status === 401 && maestraSinSesion.status === 401, `${archivoSinSesion.status} ${maestraSinSesion.status}`);

terminar();
