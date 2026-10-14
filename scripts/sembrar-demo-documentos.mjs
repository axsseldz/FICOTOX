#!/usr/bin/env node
/*
 * Datos de demostracion del modulo Documentos SGC (Fase 4).
 *
 *   npm run demo:documentos -- [--url http://localhost:3000] [--usuarios scripts/seed-usuarios.local.json]
 *
 * Usa la API real con las cuentas de prueba (Sofia, Patricia, Ricardo, Luis y
 * Mariana), asi que cada paso pasa por el flujo y queda en la bitacora: carga
 * inicial, solicitud, aceptacion, elaboracion, revision con devolucion,
 * autorizacion y publicacion con contrasena, distribucion, externo y
 * obsolescencia con segundo usuario. Los PDF los genera el propio script: son
 * documentos de EJEMPLO con datos anonimizados (nunca documentos reales).
 *
 * Idempotente: si un documento de la demostracion ya existe (por su clave), no
 * se vuelve a crear. Necesita el servidor en marcha. NO se ejecuta solo en
 * ningun despliegue (Railway incluido): se corre a mano cuando se pide.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const PDFDocument = require("pdfkit");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const valor = (n, def) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const API = `${valor("--url", process.env.DEMO_URL || "http://localhost:3000").replace(/\/$/, "")}/api`;
const archivoUsuarios = path.resolve(root, valor("--usuarios", "scripts/seed-usuarios.local.json"));

/* ---------- Cuentas ---------- */
let lista;
try {
  const d = JSON.parse(fs.readFileSync(archivoUsuarios, "utf8"));
  lista = Array.isArray(d) ? d : d.usuarios;
} catch {
  console.error(`No se pudo leer ${archivoUsuarios}. Indica el archivo de cuentas con --usuarios.`);
  process.exit(2);
}
const cuenta = (nombre) => {
  const u = lista.find((x) => String(x.nombre).toLowerCase() === nombre);
  if (!u) {
    console.error(`Falta la cuenta de ${nombre} en ${path.basename(archivoUsuarios)}.`);
    process.exit(2);
  }
  return u;
};
const PERSONAS = { sofia: cuenta("sofía"), patricia: cuenta("patricia"), ricardo: cuenta("ricardo"), luis: cuenta("luis"), mariana: cuenta("mariana") };

/* ---------- Cliente HTTP con contrasena (reautenticacion) ---------- */
const sesiones = {};
async function llamar(quien, metodo, ruta, cuerpo) {
  const { email, password } = PERSONAS[quien];
  if (!sesiones[quien]) {
    const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.token) throw new Error(`No se pudo iniciar sesión como ${email}: ${d?.message || r.status}`);
    sesiones[quien] = d.token;
  }
  const enviar = async (extra = {}) => {
    const form = typeof cuerpo === "function" ? await cuerpo() : null;
    const r = await fetch(`${API}${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${sesiones[quien]}`, ...(form || !cuerpo ? {} : { "Content-Type": "application/json" }), ...extra },
      body: form || (cuerpo ? JSON.stringify(cuerpo) : undefined),
    });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  let res = await enviar();
  if (res.status === 401 && res.data?.codigo === "reauth_required") {
    const r = await fetch(`${API}/auth/reauth`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sesiones[quien]}` }, body: JSON.stringify({ accion: res.data.accion, password }) });
    const d = await r.json().catch(() => null);
    if (!d?.token) throw new Error(`No se pudo confirmar la contraseña de ${email}`);
    res = await enviar({ "X-Reauth": d.token });
  }
  if (res.status >= 400) throw new Error(`${metodo} ${ruta} (${quien}) → ${res.status}: ${res.data?.message || ""}`);
  return res.data;
}

/* ---------- PDF de ejemplo ---------- */
function pdfEjemplo(clave, titulo, revision) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 64, info: { Title: `${clave} ${titulo} (ejemplo)` } });
    const partes = [];
    doc.on("data", (c) => partes.push(c));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.fontSize(9).fillColor("#b4530b").text("DOCUMENTO DE EJEMPLO PARA DEMOSTRACIÓN · DATOS ANONIMIZADOS · SIN VALIDEZ", { align: "center" });
    doc.moveDown().fillColor("#10202b").fontSize(18).text(titulo);
    doc.fontSize(11).fillColor("#5b6b78").text(`${clave} · Revisión ${revision}`);
    for (const [n, s] of [["1", "Objetivo"], ["2", "Alcance"], ["3", "Responsabilidades"], ["4", "Desarrollo"], ["5", "Registros"]]) {
      doc.moveDown().fillColor("#10202b").fontSize(13).text(`${n}. ${s}`);
      doc.fontSize(10.5).fillColor("#333").text(`Texto genérico de la sección «${s}» para la revisión ${revision}. Este contenido solo sirve para mostrar el visor, el control de revisiones, la distribución y la lectura controlada del módulo Documentos SGC.`);
    }
    doc.end();
  });
}
const formData = (campos, archivo) => async () => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) if (v !== undefined && v !== null) fd.append(k, String(v));
  if (archivo) fd.append(archivo.campo, new Blob([await pdfEjemplo(archivo.clave, archivo.titulo, archivo.revision)], { type: "application/pdf" }), `${archivo.clave.replace(/[^A-Za-z0-9-]/g, "_")}-rev${archivo.revision}.pdf`);
  return fd;
};

/* ---------- Utilidades ---------- */
const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana" }).format(new Date());
const enDias = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana" }).format(new Date(Date.now() + n * 86_400_000));
const log = (msg) => console.log(`  · ${msg}`);
let ids;
async function existe(clave) {
  const d = await llamar("sofia", "GET", `/sgc/documentos?obsoletos=1&search=${encodeURIComponent(clave)}`);
  return (d?.items || []).find((x) => x.clave === clave) || null;
}

/* Ficha + carga inicial (documento que ya estaba autorizado fuera de la plataforma). */
async function cargaInicial(x) {
  const r = await llamar("sofia", "POST", "/sgc/documentos", formData({ clave: x.clave, titulo: x.titulo, area_codigo: x.area, tipo_codigo: x.tipo, confidencialidad: x.confidencialidad || "uso_interno", proceso: x.proceso, palabras_clave: x.palabras, propietario_id: ids[x.propietario || "ricardo"], elaborador_id: ids[x.elaborador || "luis"], revisor_id: ids.ricardo, autorizador_id: ids.patricia }, { campo: "archivo_pdf", clave: x.clave, titulo: x.titulo, revision: 1 }));
  await llamar("sofia", "POST", `/sgc/revisiones/${r.revision_id}/registrar-vigente`, { fecha_emision: x.emision || "2025-03-03", fecha_proxima_revision: x.proxima || "2028-03-03" });
  log(`${x.clave}: ficha y carga inicial (revisión 1 vigente)`);
  return r;
}

/* Cambio por el flujo real: solicitud de Luis, aceptacion, elaboracion y envio; opcionalmente devolucion, autorizacion y publicacion. */
async function cambio(docId, clave, titulo, { hasta = "publicada", devolver = false, distribucion = null } = {}) {
  const sol = await llamar("luis", "POST", "/sgc/solicitudes", { tipo: "cambio", documento_id: docId, necesidad: "Actualizar el documento", justificacion: "Se actualiza la descripción del proceso según la práctica vigente (ejemplo)" });
  const ac = await llamar("sofia", "POST", `/sgc/solicitudes/${sol.id}/aceptar`, { elaborador_id: ids.luis, revisor_id: ids.ricardo, autorizador_id: ids.patricia, fecha_limite: enDias(10), comentario: "Procede el cambio" });
  const rid = ac.revision_id;
  const numero = ac.numero || 2;
  await llamar("luis", "POST", `/sgc/revisiones/${rid}/archivos`, formData({ tipo: "pdf" }, { campo: "archivo", clave, titulo, revision: numero }));
  await llamar("luis", "PUT", `/sgc/revisiones/${rid}`, { apartados_afectados: "Secciones 3 y 4", descripcion_cambio: "Se actualizan las responsabilidades y el desarrollo (ejemplo)" });
  await llamar("luis", "POST", `/sgc/revisiones/${rid}/enviar-revision`, {});
  log(`${clave}: solicitud, aceptación, elaboración y envío a revisión`);
  if (hasta === "en_revision") return rid;
  if (devolver) {
    await llamar("ricardo", "POST", `/sgc/revisiones/${rid}/revisar`, { decision: "devolver", comentario: "Falta detallar los registros de la sección 5" });
    await llamar("luis", "POST", `/sgc/revisiones/${rid}/archivos`, formData({ tipo: "pdf" }, { campo: "archivo", clave, titulo, revision: numero }));
    await llamar("luis", "POST", `/sgc/revisiones/${rid}/enviar-revision`, {});
    log(`${clave}: devuelta con comentarios, corregida y reenviada`);
  }
  await llamar("ricardo", "POST", `/sgc/revisiones/${rid}/revisar`, { decision: "aceptar", comentario: "Revisado sin observaciones" });
  await llamar("patricia", "POST", `/sgc/revisiones/${rid}/autorizar`, { decision: "autorizar", comentario: "Se autoriza su emisión" });
  await llamar("sofia", "POST", `/sgc/revisiones/${rid}/publicar`, { fecha_emision: hoy(), comentario: "Publicación de la demostración", ...(distribucion ? { distribucion } : {}) });
  log(`${clave}: revisada, autorizada y publicada (la anterior queda obsoleta)`);
  return rid;
}

/* ---------- Siembra ---------- */
console.log(`Datos de demostración de Documentos SGC en ${API}`);
const cat = await llamar("sofia", "GET", "/sgc/catalogos");
ids = Object.fromEntries(Object.entries(PERSONAS).map(([k, u]) => [k, (cat.personas || []).find((p) => p.email === u.email)?.id]));
for (const [k, v] of Object.entries(ids)) if (!v) throw new Error(`La cuenta de ${k} no está activa o no tiene acciones documentales`);
const rolAux = (cat.roles || []).find((r) => /Técnico Auxiliar/.test(r.nombre))?.id;
const lectura = { usuarios: [ids.luis, ids.mariana], punto_uso: "Laboratorio (consulta en el puesto de trabajo)", requiere_lectura: true };

const DOCS = [
  { clave: "FX-MC-1/1", titulo: "Manual de Calidad (ejemplo)", area: "DI", tipo: "M", propietario: "sofia", palabras: "calidad, manual, sistema", accion: "lectura" },
  { clave: "FX-GCP-CD", titulo: "Procedimiento para el control de documentos (ejemplo)", area: "GC", tipo: "P", propietario: "sofia", palabras: "documentos, control, revisiones", accion: "ciclo" },
  { clave: "FX-GCL-MD", titulo: "Lista maestra de documentos (ejemplo)", area: "GC", tipo: "L", propietario: "sofia", palabras: "lista maestra" },
  { clave: "FX-TCF-GMR", titulo: "Formato de registro técnico (ejemplo)", area: "TC", tipo: "F", propietario: "ricardo", palabras: "registro, técnico", accion: "en_curso" },
  { clave: "FX-THF-AP", titulo: "Formato de autorización de personal (ejemplo)", area: "TH", tipo: "F", propietario: "ricardo", emision: "2023-10-20", proxima: enDias(18), palabras: "personal, autorización", accion: "pendiente" },
  { clave: "FX-ADP-CP", titulo: "Procedimiento de compras (ejemplo confidencial)", area: "AD", tipo: "P", propietario: "patricia", confidencialidad: "confidencial", palabras: "compras, proveedores" },
  { clave: "FX-COP-AC", titulo: "Procedimiento de atención a clientes (ejemplo)", area: "CO", tipo: "P", propietario: "ricardo", palabras: "clientes, servicio" },
  { clave: "FX-ADF-RQ", titulo: "Formato de requisición (ejemplo retirado)", area: "AD", tipo: "F", propietario: "patricia", emision: "2024-02-01", palabras: "requisición", accion: "obsoleto" },
];

for (const x of DOCS) {
  if (await existe(x.clave)) {
    log(`${x.clave}: ya existe, sin cambios`);
    continue;
  }
  const r = await cargaInicial(x);
  if (x.accion === "lectura") {
    await llamar("sofia", "POST", `/sgc/revisiones/${r.revision_id}/distribucion`, { ...lectura, motivo: "Distribución de la demostración: lectura obligatoria" });
    log(`${x.clave}: distribuido a Luis y Mariana con lectura requerida`);
  } else if (x.accion === "ciclo") {
    await llamar("sofia", "POST", `/sgc/revisiones/${r.revision_id}/distribucion`, { roles: rolAux ? [rolAux] : [], usuarios: [ids.luis], punto_uso: "Área de gestión de calidad", requiere_lectura: true, motivo: "Distribución inicial de la demostración" });
    await cambio(r.id, x.clave, x.titulo, { devolver: true, distribucion: lectura });
  } else if (x.accion === "en_curso") {
    await cambio(r.id, x.clave, x.titulo, { hasta: "en_revision" });
  } else if (x.accion === "obsoleto") {
    await cambio(r.id, x.clave, x.titulo);
    const s = await llamar("sofia", "POST", `/sgc/documentos/${r.id}/obsoletar`, { motivo: "Se sustituye por la requisición electrónica (ejemplo)" });
    if (s?.solicitud?.id) await llamar("patricia", "POST", `/solicitudes/${s.solicitud.id}/aprobar`, { motivo: "Se confirma el retiro del formato (ejemplo)" });
    log(`${x.clave}: obsoleto con historial (aprobado por un segundo usuario)`);
  } else if (x.accion === "pendiente") log(`${x.clave}: pendiente de revisión (próxima revisión ${x.proxima})`);
}

const NMX = "NMX-EC-17025-IMNC-2018";
if (await existe(NMX)) log(`${NMX}: ya existe, sin cambios`);
else {
  await llamar("sofia", "POST", "/sgc/externos", formData({ identificador: NMX, titulo: "Requisitos generales para la competencia de los laboratorios de ensayo y de calibración", area_codigo: "GC", tipo_codigo: "R", fuente: "IMNC", version_fecha: "2018", enlace: "https://www.imnc.org.mx", responsable_id: ids.ricardo, ultima_verificacion: "2026-01-15", proxima_revision: enDias(25), palabras_clave: "norma, 17025, competencia", comentario: "Registro de la demostración (sin PDF: sin derechos de uso)" }));
  log(`${NMX}: externo vigente con aviso de próxima revisión`);
}
console.log("Listo. Entra como Sofía a Documentos SGC para recorrer la demostración.");
