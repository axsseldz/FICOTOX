/*
 * Fase 10 · evidencia instrumental de los analisis, contra el servidor de prueba
 * (EVIDENCIA_MAX_MB=25 y EVIDENCIA_OBLIGATORIA_ANALISIS=true, ver tests/run.mjs):
 * - adjuntar pdf, png y xlsx validos (SHA-256 correcto); rechazar html, svg,
 *   exe, un .pdf que es html y un archivo vacio (400); mayor al limite (413);
 *   duplicado en el mismo analisis (409) y permitido en otro;
 * - nombre con ../ y caracteres especiales: se guarda saneado y nunca es ruta;
 * - sin asignacion, sin FX-THF-AP, con alcance "estado" o con solicitud pendiente: 403/409;
 * - enviar a revision sin evidencia (409) y con evidencia (200); adjuntar y anular
 *   despues de enviar (409); tras "devolver" vuelve a permitirse;
 * - anular sin reautenticacion (401); con ella el archivo sigue en disco;
 * - enmienda: v2 hereda los adjuntos; anular uno en v2 no afecta a v1;
 * - integridad: archivo alterado -> "alterado" + alerta_integridad; borrado -> "faltante";
 * - un fallo a mitad de la transaccion no deja archivos huerfanos;
 * - cuenta supervisada: su adjunto deja el analisis pendiente de visto bueno;
 * - permisos de lectura (Mariana, Patricia, Auditor si; Jorge no) y frases de la bitacora.
 */
import "./lib/reauth-auto.mjs";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { adjuntarEvidencia, pdfDePrueba } from "./lib/evidencia.mjs";
import { autorizarTodo } from "./lib/autorizar.mjs";

const BASE = process.env.BASE || "http://localhost:3100/api";
const TEST_DB = process.env.TEST_DB_PATH;
const EVIDENCIAS = path.join(path.dirname(TEST_DB), "evidencias");
const Database = createRequire(import.meta.url)(process.env.BETTER_SQLITE3);
const credenciales = JSON.parse(fs.readFileSync(process.env.CREDENCIALES_ROLES, "utf8"));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
async function api(method, ruta, body, token, headers = {}) {
  const esForm = body instanceof FormData;
  const res = await fetch(`${BASE}${ruta}`, { method, headers: { ...(esForm ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: esForm ? body : body ? JSON.stringify(body) : undefined });
  const type = res.headers.get("content-type") || "";
  return { status: res.status, headers: res.headers, data: type.includes("json") ? await res.json().catch(() => null) : Buffer.from(await res.arrayBuffer()) };
}
const login = async (email, password = credenciales[email]) => (await api("POST", "/auth/login", { email, password })).data?.token;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const db = () => new Database(TEST_DB, { readonly: true });
const fila = (sql, ...params) => {
  const d = db();
  try {
    return d.prepare(sql).get(...params);
  } finally {
    d.close();
  }
};
const subir = (token, A, opts = {}) => adjuntarEvidencia(BASE, token, A, opts).then(async (res) => ({ status: res.status, data: await res.json().catch(() => null) }));
const archivosEn = (A) => {
  try {
    return fs.readdirSync(path.join(EVIDENCIAS, "analisis", String(A)));
  } catch {
    return [];
  }
};

const QA = await login("qa@ficotox.local", "QaFicotox2026!");
const tR = await login("ricardo.medina@ficotox.local");
const tL = await login("luis.castro@ficotox.local");
const tP = await login("patricia.luna@ficotox.local");
const tM = await login("mariana.delgado@ficotox.local");
const tJ = await login("jorge.ramirez@ficotox.local");
const tH = await login("hector.navarro@ficotox.local");
const usuarios = (await api("GET", "/admin/usuarios", undefined, QA)).data?.items || [];
const idDe = (email) => usuarios.find((u) => u.email === email)?.id;
const sufijo = Date.now().toString(36).toUpperCase().slice(-5);
const inspeccion = { checklist: Array.from({ length: 7 }, (_, i) => ({ requisito: `Requisito ${i + 1}`, estado: i === 6 ? "NA" : "C", observacion: null })), observaciones_generales: null };

/* Cadena R -> P -> E-D; asigna a `asignar` (ids) y devuelve la extraccion. */
async function cadena(etiqueta, asignar = []) {
  const id = `EV-${etiqueta}-${sufijo}`;
  const R = (await api("POST", "/samples/reception", { fecha_recepcion: "2026-09-20", hora_recepcion: "09:00", recibido_por: "QA", medio_recepcion: "directa", solicitante: `Cliente evidencia ${etiqueta}`, muestra_unica: true, id_interno: id, fecha_muestra: "2026-09-19", analisis: { tipos: ["toxinas_lipofilicas"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] }, inspeccion, decision_aceptacion: "aceptada", aceptacion: { fecha: "2026-09-20", responsable: "QA" } }, QA)).data?.id;
  for (const u of asignar) await api("POST", `/samples/reception/${R}/asignaciones`, { usuario_id: u, motivo: "Asignación de prueba de evidencia" }, tR);
  const P = (await api("POST", "/samples/processing", { recepcion_id: R, muestra_tipo: "unica", id_interno: id, fecha_procesamiento: "2026-09-20", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "Persona A", nombre_quien_superviso: "Persona B" }, QA)).data?.id;
  const E = (await api("POST", "/samples/extraction", { tipo_registro: "E-D", procesamiento_id: P, tipo_molienda: "fresca", id_interno: id, fecha_extraccion: "2026-09-20", registro_pesos: [{ id_muestra: id, replica: `${id}_R1`, peso_muestra: 2.01 }], nombre_quien_extrajo: "Persona A", nombre_quien_superviso: "Persona B" }, QA)).data?.id;
  return { R, E, id };
}
const nuevoAnalisis = async (token, c, tipo = "toxinas_lipofilicas") => (await api("POST", "/samples/analysis", { tipo_analisis: tipo, metodo: tipo === "toxinas_paralizantes" ? "hplc_fld" : "hplc_ms_ms", extraccion_id: c.E, fecha_analisis: "2026-09-20", analista_nombre: "Analista", resultados: [{ id_muestra: c.id, resultado: 50, unidad: "µg/kg", limite_regulatorio: 160, cumple: "cumple" }] }, token)).data?.id;

const LUIS = idDe("luis.castro@ficotox.local");
// Mariana (técnico auxiliar) ve los ensayos de las muestras que tiene asignadas (B-02 de la prueba integral).
const MARIANA = idDe("mariana.delgado@ficotox.local");
const c1 = await cadena("1", [LUIS, MARIANA]);
const A1 = await nuevoAnalisis(tL, c1);
check("datos: Luis (asignado) registra el analisis A1", !!A1, `${A1}`);

/* ---------- Tipos validos, SHA-256 y listado ---------- */
{
  const pdf = pdfDePrueba(`Cromatograma A1 ${sufijo}`);
  const r = await subir(tL, A1, { bytes: pdf, nombre: "cromatograma-A1.pdf", descripcion: "Cromatograma corrida 1" });
  check("adjuntar un PDF valido -> 201 con el SHA-256 correcto", r.status === 201 && r.data?.item?.sha256 === sha(pdf) && r.data?.item?.extension === "pdf", `${r.status} ${r.data?.message}`);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`png de prueba ${sufijo}`)]);
  const rp = await subir(tL, A1, { bytes: png, nombre: "foto.png", tipo: "foto", descripcion: "Foto del vial" });
  const xlsx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`xlsx de prueba ${sufijo}`)]);
  const rx = await subir(tL, A1, { bytes: xlsx, nombre: "calculos.xlsx", tipo: "hoja_calculo", descripcion: "Hoja de cálculo de concentraciones" });
  check("adjuntar PNG y XLSX validos -> 201 con su SHA-256", rp.status === 201 && rx.status === 201 && rp.data?.item?.sha256 === sha(png) && rx.data?.item?.sha256 === sha(xlsx), `${rp.status} ${rx.status}`);
  const lista = await api("GET", `/samples/analysis/${A1}/adjuntos`, undefined, tL);
  check("el listado trae los 3 adjuntos vigentes, integros y 'puede adjuntar'", lista.status === 200 && lista.data?.items?.filter((a) => a.vigente && a.integridad === "ok").length === 3 && lista.data?.edicion?.permitido === true, `${lista.status} ${lista.data?.items?.length}`);
  const ficha = await api("GET", `/samples/analysis/${A1}`, undefined, tL);
  check("la ficha del analisis incluye el resumen de adjuntos", ficha.data?.item?.adjuntos?.vigentes === 3 && ficha.data?.item?.adjuntos?.obligatoria === true, JSON.stringify(ficha.data?.item?.adjuntos));
  check("el archivo se guarda con nombre <uuid>.<ext> dentro de evidencias/analisis/<id>/", archivosEn(A1).length === 3 && archivosEn(A1).every((n) => /^[0-9a-f-]{36}\.(pdf|png|xlsx)$/.test(n)), archivosEn(A1).join(","));
}

/* ---------- Tipos no permitidos, vacio, limite y duplicado ---------- */
{
  const html = Buffer.from("<!DOCTYPE html><html><body><script>alert(1)</script></body></html>");
  const casos = [
    ["un .html", { bytes: html, nombre: "reporte.html" }],
    ["un .svg", { bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), nombre: "grafica.svg" }],
    ["un .exe", { bytes: Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64)]), nombre: "programa.exe" }],
    ["un .pdf que en realidad es HTML", { bytes: html, nombre: "falso.pdf" }],
    ["un ejecutable renombrado a .txt", { bytes: Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(32)]), nombre: "notas.txt" }],
    ["un archivo vacio", { bytes: Buffer.alloc(0), nombre: "vacio.pdf" }],
    ["un .txt con HTML a mitad del contenido", { bytes: Buffer.from(`${" ".repeat(1100)}hola\n<html><body onload=alert(1)>`), nombre: "notas.txt" }],
    ["un .csv con una etiqueta con evento", { bytes: Buffer.from("a,b\n1,<img src=x onerror=alert(1)>\n"), nombre: "datos.csv" }],
    ["un .txt con evento tras '/' (details/ontoggle)", { bytes: Buffer.from("<p>hola</p><details/open/ontoggle=alert(1)>"), nombre: "n2.txt" }],
    ["un .txt con javascript: en entidades", { bytes: Buffer.from('<!-- x --><a href="java&#x73;cript:alert(1)">x</a>'), nombre: "n3.txt" }],
  ];
  for (const [nombre, opts] of casos) {
    const r = await subir(tL, A1, { ...opts, descripcion: `Intento con ${nombre}` });
    check(`rechaza ${nombre} -> 400`, r.status === 400, `${r.status} ${r.data?.message}`);
  }
  const grande = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(25 * 1024 * 1024 + 10, 0x20)]);
  const rg = await subir(tL, A1, { bytes: grande, nombre: "enorme.pdf", descripcion: "Archivo mayor al límite" });
  check("archivo mayor al limite (EVIDENCIA_MAX_MB=25) -> 413", rg.status === 413, `${rg.status} ${rg.data?.message}`);
  // Mas de 10 MB: el proxy de Next (CORS) cortaba el cuerpo a 10 MB; con el limite configurado pasa completo.
  const doce = Buffer.concat([pdfDePrueba(`Doce MB ${sufijo}`), Buffer.alloc(12 * 1024 * 1024, 0x20)]);
  const r12 = await subir(tL, A1, { bytes: doce, nombre: "cromatograma-12mb.pdf", descripcion: "Archivo de 12 MB" });
  check("un archivo de 12 MB (bajo el limite de 25) se adjunta completo con su SHA-256", r12.status === 201 && r12.data?.item?.sha256 === sha(doce) && r12.data?.item?.tamano_bytes === doce.length, `${r12.status} ${r12.data?.message}`);
  const antes = archivosEn(A1).length;
  const pdf = pdfDePrueba(`Duplicado ${sufijo}`);
  const primero = await subir(tL, A1, { bytes: pdf, nombre: "dup.pdf", descripcion: "Primer envío del archivo" });
  const dup = await subir(tL, A1, { bytes: pdf, nombre: "dup-otra-vez.pdf", descripcion: "Mismo archivo otra vez" });
  check("el mismo archivo vigente en el mismo analisis -> 409 'Ese archivo ya está adjunto'", primero.status === 201 && dup.status === 409 && /ya está adjunto/.test(dup.data?.message || ""), `${primero.status} ${dup.status} ${dup.data?.message}`);
  check("el 409 del duplicado (transaccion fallida) no deja archivos huerfanos en disco", archivosEn(A1).length === antes + 1, `${antes} -> ${archivosEn(A1).length}`);
  const c2 = await cadena("2", [LUIS]);
  const A2 = await nuevoAnalisis(tL, c2);
  const enOtro = await subir(tL, A2, { bytes: pdf, nombre: "dup.pdf", descripcion: "Mismo archivo en otro análisis" });
  check("el mismo archivo en otro analisis si se permite (201)", enOtro.status === 201, `${enOtro.status} ${enOtro.data?.message}`);
  // Nombre con ../ y caracteres especiales.
  const raro = await subir(tL, A2, { bytes: pdfDePrueba(`Nombre raro ${sufijo}`), nombre: '../../../etc/cro"ma<to>gra:ma?*.pdf', descripcion: "Nombre con ruta y caracteres especiales" });
  const guardado = fila("SELECT nombre_original, nombre_almacenado FROM adjuntos WHERE id = ?", raro.data?.item?.id);
  const bidi = await subir(tL, A2, { bytes: pdfDePrueba(`Bidi ${sufijo}`), nombre: "rep\u200B\u061Corte\u202Efdp\uFEFF.pdf", descripcion: "Nombre con marca bidi" });
  const ld = await subir(tL, A2, { bytes: Buffer.from(`muestra,resultado\nD45-2,<LD\nD45-3,<5\n${sufijo}\n`), nombre: "resultados.csv", tipo: "hoja_calculo", descripcion: "CSV con resultados menores al LD" });
  check("un CSV con '<LD' o '<5' (datos de laboratorio) si se acepta", ld.status === 201, `${ld.status} ${ld.data?.message}`);
  check("los caracteres de control de direccion (bidi) se quitan del nombre", bidi.status === 201 && fila("SELECT nombre_original FROM adjuntos WHERE id = ?", bidi.data?.item?.id)?.nombre_original === "reportefdp.pdf", `${bidi.status} ${JSON.stringify(fila("SELECT nombre_original FROM adjuntos WHERE id = ?", bidi.data?.item?.id))}`);
  check("nombre con ../ y especiales: se guarda saneado y el archivo va a <uuid>.pdf dentro de su carpeta", raro.status === 201 && guardado?.nombre_original === "cromatograma.pdf" && new RegExp(`^analisis/${A2}/[0-9a-f-]{36}\\.pdf$`).test(guardado?.nombre_almacenado || "") && !fs.existsSync(path.join(path.dirname(TEST_DB), "..", "etc")), `${raro.status} ${JSON.stringify(guardado)}`);
  const desc = await api("GET", `/adjuntos/${raro.data?.item?.id}/archivo`, undefined, tL);
  check("la descarga usa el nombre saneado, attachment y nosniff", desc.status === 200 && /attachment; filename="cromatograma\.pdf"/.test(desc.headers.get("content-disposition") || "") && desc.headers.get("x-content-type-options") === "nosniff" && desc.headers.get("x-integridad-adjunto") === "ok", `${desc.status} ${desc.headers.get("content-disposition")}`);
  const previa = await api("GET", `/adjuntos/${raro.data?.item?.id}/archivo?inline=1`, undefined, tL);
  const xl = (await api("GET", `/samples/analysis/${A1}/adjuntos`, undefined, tL)).data?.items?.find((a) => a.extension === "xlsx");
  const previaXlsx = await api("GET", `/adjuntos/${xl?.id}/archivo?inline=1`, undefined, tL);
  check("vista previa en linea solo para PDF e imagenes (el XLSX se descarga)", /^inline/.test(previa.headers.get("content-disposition") || "") && /^attachment/.test(previaXlsx.headers.get("content-disposition") || ""), `${previa.headers.get("content-disposition")} | ${previaXlsx.headers.get("content-disposition")}`);
}

/* ---------- Asignacion, FX-THF-AP, alcance "estado" y solicitud pendiente ---------- */
{
  const sinAsignar = await cadena("3");
  const A3 = await nuevoAnalisis(QA, sinAsignar);
  const r = await subir(tL, A3, { descripcion: "Luis sin asignación" });
  check("sin asignacion a la muestra -> 403 no_asignado", r.status === 403 && r.data?.codigo === "no_asignado", `${r.status} ${r.data?.codigo}`);
  // Una analista con la actividad "analisis" pero sin el metodo DSP (FX-THF-AP).
  const rolesCat = (await api("GET", "/admin/roles", undefined, QA)).data?.items || [];
  const emailSinDsp = `sindsp.${sufijo.toLowerCase()}@cicese.mx`;
  const sinDsp = await api("POST", "/admin/usuarios", { nombre: "Analista sin DSP", email: emailSinDsp, activo: true, rol_id: rolesCat.find((r) => r.nombre === "Técnico Analista")?.id, password: "Evidencia-Prueba-2026", motivo: "Alta de prueba de evidencia" }, QA);
  await api("POST", `/admin/usuarios/${sinDsp.data?.id}/autorizaciones`, { tipo: "actividad", clave: "analisis", folio_fx_thf_ap: "FX-THF-AP-PRUEBAS", motivo: "Solo la actividad, sin método" }, QA);
  const c4 = await cadena("4", [sinDsp.data?.id]);
  const A4 = await nuevoAnalisis(QA, c4);
  const r2 = await subir(await login(emailSinDsp, "Evidencia-Prueba-2026"), A4, { descripcion: "Sin autorización del método DSP" });
  check("sin autorizacion FX-THF-AP del metodo (DSP) -> 403 no_autorizado", !!A4 && r2.status === 403 && r2.data?.codigo === "no_autorizado", `${A4} ${r2.status} ${r2.data?.message}`);
  // Alcance "estado" en ensayos: un rol de prueba que solo ve el estado.
  const rol = await api("POST", "/admin/roles", { nombre: `QA ensayos estado ${sufijo}`, descripcion: "Solo estado de ensayos (prueba)", activo: true, permisos: [{ modulo: "ensayos", accion: "V", alcance: "estado" }], motivo: "Rol de prueba de evidencia" }, QA);
  const email = `estado.${sufijo.toLowerCase()}@cicese.mx`;
  const alta = await api("POST", "/admin/usuarios", { nombre: "Solo estado prueba", email, activo: true, rol_id: rol.data?.id, password: "Evidencia-Prueba-2026", motivo: "Alta de prueba de evidencia" }, QA);
  const tE = await login(email, "Evidencia-Prueba-2026");
  const verEstado = await api("GET", `/samples/analysis/${A1}/adjuntos`, undefined, tE);
  const bajarEstado = await api("GET", `/adjuntos/${fila("SELECT id FROM adjuntos WHERE entidad_id = ? ORDER BY id LIMIT 1", A1)?.id}/archivo`, undefined, tE);
  check("con alcance 'estado' no se ven ni descargan adjuntos (403)", rol.status === 201 && !!alta.data?.id && verEstado.status === 403 && bajarEstado.status === 403, `${rol.status} ${alta.status} ${verEstado.status} ${bajarEstado.status}`);
  // Solicitud pendiente sobre el analisis (insertada directo en la base de prueba).
  const c5 = await cadena("5", [LUIS]);
  const A5 = await nuevoAnalisis(tL, c5);
  const w = new Database(TEST_DB);
  w.prepare("INSERT INTO solicitudes_autorizacion (tipo, modulo, entidad, entidad_id, referencia, accion, datos_json, motivo, solicitado_por, solicitado_en, estado, vence_en) VALUES ('anular_registro', 'ensayos', 'muestras_analisis', ?, 'prueba', 'anular', '{}', 'Solicitud de prueba', ?, ?, 'pendiente', ?)").run(String(A5), idDe("qa@ficotox.local"), new Date().toISOString(), new Date(Date.now() + 86_400_000).toISOString());
  w.close();
  const r5 = await subir(tL, A5, { descripcion: "Con solicitud pendiente" });
  check("con una solicitud pendiente sobre el analisis -> 409 solicitud_pendiente", r5.status === 409 && r5.data?.codigo === "solicitud_pendiente", `${r5.status} ${r5.data?.codigo} ${r5.data?.message}`);
}

/* ---------- Permisos de lectura ---------- */
{
  const [m, p, h, j] = await Promise.all([tM, tP, tH, tJ].map((t) => api("GET", `/samples/analysis/${A1}/adjuntos`, undefined, t)));
  check("ven la evidencia: Mariana (T. Auxiliar, muestra asignada), Patricia (Resp. General) y el Auditor; Jorge (Adm. técnico) no", m.status === 200 && p.status === 200 && h.status === 200 && j.status === 403, `${m.status} ${p.status} ${h.status} ${j.status}`);
  const A6 = await nuevoAnalisis(tL, await cadena("6", [LUIS]));
  const ajena = await api("GET", `/samples/analysis/${A6}/adjuntos`, undefined, tM);
  check("…de una muestra que no tiene asignada, Mariana no ve la evidencia (403)", ajena.status === 403, `${ajena.status} ${ajena.data?.codigo || ""}`);
  check("quien solo ve no puede adjuntar (edicion.permitido = false con el motivo)", p.data?.edicion?.permitido === false && !!p.data?.edicion?.motivo, JSON.stringify(p.data?.edicion));
  const intento = await subir(tP, A1, { descripcion: "Patricia intenta adjuntar" });
  const intentoM = await subir(tM, A1, { descripcion: "Mariana intenta adjuntar" });
  check("Patricia y Mariana no adjuntan (403)", intento.status === 403 && intentoM.status === 403, `${intento.status} ${intentoM.status}`);
}

/* ---------- Evidencia obligatoria, envio, devolucion y anulacion ---------- */
{
  const c6 = await cadena("6", [LUIS]);
  const A6 = await nuevoAnalisis(tL, c6);
  const sinEv = await api("POST", `/samples/analysis/${A6}/enviar-revision`, {}, tL, { "X-Sin-Evidencia-Auto": "1" });
  check("enviar a revision sin evidencia -> 409 con el mensaje de la especificacion", sinEv.status === 409 && sinEv.data?.message === "Adjunta al menos una evidencia instrumental antes de enviar a revisión", `${sinEv.status} ${sinEv.data?.message}`);
  const ev = await subir(tL, A6, { descripcion: "Cromatograma para enviar" });
  const conEv = await api("POST", `/samples/analysis/${A6}/enviar-revision`, {}, tL, { "X-Sin-Evidencia-Auto": "1" });
  check("con evidencia se envia a revision (200)", ev.status === 201 && conEv.status === 200, `${ev.status} ${conEv.status} ${conEv.data?.message}`);
  const tarde = await subir(tL, A6, { descripcion: "Adjunto después de enviar" });
  const anularTarde = await api("POST", `/adjuntos/${ev.data?.item?.id}/anular`, { motivo: "Motivo después de enviar" }, tL);
  check("adjuntar o anular despues de enviar a revision -> 409 'El análisis ya se envió a revisión'", tarde.status === 409 && anularTarde.status === 409 && /ya se envió a revisión/.test(tarde.data?.message || ""), `${tarde.status} ${anularTarde.status} ${tarde.data?.message}`);
  await api("POST", `/samples/analysis/${A6}/devolver`, { motivo: "Falta la curva de calibración" }, tR);
  const otra = await subir(tL, A6, { bytes: pdfDePrueba(`Curva ${sufijo}`), nombre: "curva.pdf", tipo: "curva_calibracion", descripcion: "Curva de calibración del día" });
  check("tras 'devolver con observaciones' se vuelve a adjuntar (201)", otra.status === 201, `${otra.status} ${otra.data?.message}`);
  const sinReauth = await api("POST", `/adjuntos/${ev.data?.item?.id}/anular`, { motivo: "Cromatograma equivocado" }, tL, { "X-Sin-Reauth-Auto": "1" });
  check("anular sin reautenticacion -> 401 reauth_required", sinReauth.status === 401 && sinReauth.data?.codigo === "reauth_required", `${sinReauth.status} ${sinReauth.data?.codigo}`);
  const corto = await api("POST", `/adjuntos/${ev.data?.item?.id}/anular`, { motivo: "no" }, tL);
  const anulado = await api("POST", `/adjuntos/${ev.data?.item?.id}/anular`, { motivo: "Cromatograma equivocado" }, tL);
  const almacenado = fila("SELECT nombre_almacenado, anulado_en, motivo_anulacion FROM adjuntos WHERE id = ?", ev.data?.item?.id);
  check("anular exige motivo (400) y, con reautenticacion, anula sin borrar el archivo", corto.status === 400 && anulado.status === 200 && !!almacenado?.anulado_en && fs.existsSync(path.join(EVIDENCIAS, almacenado.nombre_almacenado)), `${corto.status} ${anulado.status} ${JSON.stringify(almacenado)}`);
  const lista = (await api("GET", `/samples/analysis/${A6}/adjuntos`, undefined, tL)).data?.items || [];
  check("el anulado sigue en la lista (vigente=false, con motivo) y se puede descargar", lista.some((a) => a.id === ev.data?.item?.id && !a.vigente && a.motivo_anulacion === "Cromatograma equivocado") && (await api("GET", `/adjuntos/${ev.data?.item?.id}/archivo`, undefined, tL)).status === 200, `${lista.length}`);
  const reenvio = await api("POST", `/samples/analysis/${A6}/enviar-revision`, {}, tL, { "X-Sin-Evidencia-Auto": "1" });
  const rev = await api("POST", `/samples/analysis/${A6}/revisar`, {}, tR);
  const apr = await api("POST", `/samples/analysis/${A6}/aprobar`, {}, tR);
  check("reenvia (queda la curva vigente), Ricardo revisa y aprueba", reenvio.status === 200 && rev.status === 200 && apr.status === 200, `${reenvio.status} ${rev.status} ${apr.status}`);
  const aprobadoSube = await subir(tL, A6, { descripcion: "Adjunto a un aprobado" });
  check("un analisis aprobado tiene la evidencia en solo lectura (409) pero descargable", aprobadoSube.status === 409 && (await api("GET", `/adjuntos/${otra.data?.item?.id}/archivo`, undefined, tH)).status === 200, `${aprobadoSube.status} ${aprobadoSube.data?.message}`);

  /* Enmienda: v2 hereda los vigentes; anular en v2 no toca v1. */
  const enm = await api("POST", `/samples/analysis/${A6}/enmendar`, { motivo: "Corrección de unidades" }, tL);
  const v2 = enm.data?.id;
  const heredados = (await api("GET", `/samples/analysis/${v2}/adjuntos`, undefined, tL)).data?.items || [];
  check("la enmienda (v2) hereda los adjuntos vigentes de v1 apuntando al mismo archivo", enm.status === 201 && heredados.length === 1 && heredados[0].heredado_de === otra.data?.item?.id && heredados[0].heredado_de_version === 1 && heredados[0].sha256 === otra.data?.item?.sha256, `${enm.status} ${JSON.stringify(heredados.map((a) => [a.heredado_de, a.heredado_de_version]))}`);
  const anularV2 = await api("POST", `/adjuntos/${heredados[0]?.id}/anular`, { motivo: "Se reemplaza en la enmienda" }, tL);
  const v1 = (await api("GET", `/samples/analysis/${A6}/adjuntos`, undefined, tL)).data?.items?.find((a) => a.id === otra.data?.item?.id);
  check("anular un adjunto heredado en v2 no afecta a v1 (sigue vigente y el archivo existe)", anularV2.status === 200 && v1?.vigente === true && v1?.integridad === "ok", `${anularV2.status} ${JSON.stringify(v1 && { vigente: v1.vigente, integridad: v1.integridad })}`);
  // Anular el analisis no anula sus adjuntos.
  const c7 = await cadena("7", [LUIS]);
  const A7 = await nuevoAnalisis(tL, c7);
  const ev7 = await subir(tL, A7, { descripcion: "Evidencia de un análisis que se anula" });
  const an7 = await api("POST", `/samples/analysis/${A7}/anular`, { motivo: "Análisis capturado por error" }, tR);
  const l7 = (await api("GET", `/samples/analysis/${A7}/adjuntos`, undefined, tL)).data?.items || [];
  check("anular el analisis no anula sus adjuntos (quedan consultables en solo lectura)", an7.status === 200 && l7.length === 1 && l7[0].vigente === true && (await api("GET", `/adjuntos/${ev7.data?.item?.id}/archivo`, undefined, tL)).status === 200, `${an7.status} ${an7.data?.message} ${l7.length}`);
}

/* ---------- Integridad en disco ---------- */
{
  const c8 = await cadena("8", [LUIS]);
  const A8 = await nuevoAnalisis(tL, c8);
  const bytesA = pdfDePrueba(`Se altera ${sufijo}`);
  const bytesB = pdfDePrueba(`Se borra ${sufijo}`);
  const a = await subir(tL, A8, { bytes: bytesA, descripcion: "Cromatograma que se altera" });
  const b = await subir(tL, A8, { bytes: bytesB, descripcion: "Cromatograma que se borra" });
  const rutaA = path.join(EVIDENCIAS, fila("SELECT nombre_almacenado FROM adjuntos WHERE id = ?", a.data?.item?.id).nombre_almacenado);
  const rutaB = path.join(EVIDENCIAS, fila("SELECT nombre_almacenado FROM adjuntos WHERE id = ?", b.data?.item?.id).nombre_almacenado);
  fs.appendFileSync(rutaA, "alterado");
  fs.rmSync(rutaB);
  const da = await api("GET", `/adjuntos/${a.data?.item?.id}/archivo`, undefined, tL);
  const db_ = await api("GET", `/adjuntos/${b.data?.item?.id}/archivo`, undefined, tL);
  const alertas = (await api("GET", `/audit?entidad=muestras_analisis&entidad_id=${A8}&accion=alerta_integridad`, undefined, QA)).data?.items || [];
  check("archivo alterado en disco: la descarga marca X-Integridad-Adjunto: alterado", da.status === 200 && da.headers.get("x-integridad-adjunto") === "alterado", `${da.status} ${da.headers.get("x-integridad-adjunto")}`);
  check("archivo borrado: X-Integridad-Adjunto: faltante (404)", db_.status === 404 && db_.headers.get("x-integridad-adjunto") === "faltante", `${db_.status} ${db_.headers.get("x-integridad-adjunto")}`);
  check("ambos dejan alerta_integridad en la bitacora", alertas.length >= 2, `${alertas.length}`);
  const lista = (await api("GET", `/samples/analysis/${A8}/adjuntos`, undefined, tL)).data?.items || [];
  check("el listado muestra el estado de integridad (alterado / faltante)", lista.some((x) => x.integridad === "alterado") && lista.some((x) => x.integridad === "faltante"), JSON.stringify(lista.map((x) => x.integridad)));
  // Se dejan los archivos como estaban: las pruebas de respaldo que siguen verifican todas las huellas.
  fs.writeFileSync(rutaA, bytesA);
  fs.writeFileSync(rutaB, bytesB);
}

/* ---------- Cuenta supervisada: no elude el visto bueno ---------- */
{
  const roles = (await api("GET", "/admin/roles", undefined, QA)).data?.items || [];
  const email = `supervisada.${sufijo.toLowerCase()}@cicese.mx`;
  const alta = await api("POST", "/admin/usuarios", { nombre: "Analista supervisada", email, activo: true, rol_id: roles.find((r) => r.nombre === "Técnico Analista")?.id, password: "Evidencia-Prueba-2026", motivo: "Estancia supervisada de prueba", tipo_cuenta: "temporal", vigente_hasta: "2099-12-31", supervisor_id: idDe("ricardo.medina@ficotox.local"), motivo_cuenta: "Estancia de prueba" }, QA);
  await autorizarTodo(BASE, QA, alta.data?.id);
  const tS = await login(email, "Evidencia-Prueba-2026");
  const c9 = await cadena("9", [alta.data?.id]);
  const A9 = await nuevoAnalisis(tS, c9);
  const vb = await api("POST", `/supervision/muestras_analisis/${A9}/visto-bueno`, {}, tR);
  const antes = fila("SELECT supervision_estado FROM muestras_analisis WHERE id = ?", A9)?.supervision_estado;
  const sube = await subir(tS, A9, { descripcion: "Adjunto de la cuenta supervisada" });
  const despues = fila("SELECT supervision_estado FROM muestras_analisis WHERE id = ?", A9)?.supervision_estado;
  const envio = await api("POST", `/samples/analysis/${A9}/enviar-revision`, {}, tS, { "X-Sin-Evidencia-Auto": "1" });
  check("cuenta supervisada: tras el visto bueno, su adjunto deja el analisis pendiente y no se envia (409)", !!A9 && vb.status === 200 && antes !== "pendiente" && sube.status === 201 && despues === "pendiente" && envio.status === 409 && envio.data?.codigo === "supervision_pendiente", `${A9} ${vb.status} ${antes}->${despues} ${sube.status} ${envio.status} ${envio.data?.codigo}`);
  const vb2 = await api("POST", `/supervision/muestras_analisis/${A9}/visto-bueno`, {}, tR);
  const envio2 = await api("POST", `/samples/analysis/${A9}/enviar-revision`, {}, tS, { "X-Sin-Evidencia-Auto": "1" });
  check("con un nuevo visto bueno del supervisor ya se envia (200)", vb2.status === 200 && envio2.status === 200, `${vb2.status} ${envio2.status}`);
}

/* ---------- Bitacora ---------- */
{
  const entradas = (await api("GET", `/audit?entidad=muestras_analisis&entidad_id=${A1}`, undefined, QA)).data?.items || [];
  const acciones = new Set(entradas.map((e) => e.accion));
  check("la bitacora del analisis registra adjuntar y descargar", acciones.has("adjuntar") && acciones.has("descargar"), [...acciones].join(","));
  const adj = entradas.find((e) => e.accion === "adjuntar");
  const detalle = (adj?.cambios || {})._detalle || {};
  check("la entrada 'adjuntar' guarda tipo, descripcion, nombre y SHA-256", detalle.tipo_evidencia && detalle.descripcion && detalle.nombre && /^[0-9a-f]{64}$/.test(detalle.sha256 || ""), JSON.stringify(detalle).slice(0, 200));
  const verif = await api("GET", "/audit/verify", undefined, QA);
  check("la cadena de la bitacora sigue integra", verif.data?.ok === true, JSON.stringify(verif.data).slice(0, 160));
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
