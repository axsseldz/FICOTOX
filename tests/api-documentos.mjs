/*
 * Documentos SGC, Fase 1 (nucleo documental):
 * - permisos por accion documental por rol (asignacion inicial de la migracion 22);
 * - clave FX: formato, coincidencia con area y tipo, excepcion FX-MC/FX-MO solo en DI/M,
 *   unica sin distinguir mayusculas ni espacios;
 * - nueva ficha solo con documento_crear_ficha; carga inicial (vigente) con contrasena;
 * - una sola revision vigente por documento (tambien en la base);
 * - la nueva revision no altera la vigente (CA-04) y quien solo consulta vigentes no ve el borrador;
 * - archivo: sustituir en borrador conserva el anterior; tras enviar a revision ya no se acepta (API y base);
 * - confidencialidad: restringido = 404 para quien no debe verlo (ficha, URL directa, archivo, lista y buscador);
 * - administrador tecnico: metadatos para diagnostico, nunca abre archivos;
 * - la Biblioteca ya no responde; bitacora de cada cambio.
 */
import "./lib/reauth-auto.mjs";
import { createHash } from "node:crypto";
import { api, BASE, crearCheck, Database, fila, filas, sesiones } from "./lib/calidad.mjs";
import { docxSimple, pdfConTexto } from "./lib/archivos.mjs";

const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const sha = (b) => createHash("sha256").update(b).digest("hex");
const s5 = Date.now().toString(36).slice(-4).toUpperCase();

function ficha(token, campos, archivos = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) if (v !== undefined && v !== null) fd.append(k, String(v));
  for (const [k, [bytes, nombre]] of Object.entries(archivos)) fd.append(k, new Blob([bytes]), nombre);
  return api("POST", "/sgc/documentos", fd, token);
}
function subir(token, revId, tipo, bytes, nombre) {
  const fd = new FormData();
  fd.append("tipo", tipo);
  fd.append("archivo", new Blob([bytes]), nombre);
  return api("POST", `/sgc/revisiones/${revId}/archivos`, fd, token);
}
async function bytes(token, archivoId, modo = "ver") {
  const r = await fetch(`${BASE}/sgc/archivos/${archivoId}?modo=${modo}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, data: Buffer.from(await r.arrayBuffer()) };
}
const doc = (docId, token) => api("GET", `/sgc/documentos/${docId}`, undefined, token);
const pdfA = await pdfConTexto(2, `Procedimiento A ${s5}`);
const pdfB = await pdfConTexto(2, `Procedimiento B ${s5}`);
const pdfC = await pdfConTexto(1, `Revision 2 ${s5}`);
const pdfD = await pdfConTexto(1, `Revision 2 corregida ${s5}`);

/* ---------- 1. Permisos por accion documental ---------- */
const me = async (token) => (await api("GET", "/auth/me", undefined, token)).data?.permissions?.documentos || {};
const acciones = (p) => Object.keys(p).filter((a) => a !== "V").sort();
const ESPERADO = {
  ana: 14,
  patricia: ["documento_acusar_lectura", "documento_autorizar", "documento_consultar_historico", "documento_consultar_vigente", "documento_proponer", "lista_maestra_exportar"],
  ricardo: ["documento_acusar_lectura", "documento_autorizar", "documento_consultar_historico", "documento_consultar_vigente", "documento_elaborar", "documento_enviar_revision", "documento_proponer", "documento_revisar"],
  gabriela: ["documento_acusar_lectura", "documento_consultar_historico", "documento_consultar_vigente", "documento_elaborar", "documento_enviar_revision", "documento_proponer", "documento_revisar"],
  luis: ["documento_acusar_lectura", "documento_consultar_vigente", "documento_elaborar", "documento_enviar_revision", "documento_proponer"],
  mariana: ["documento_acusar_lectura", "documento_consultar_vigente", "documento_elaborar", "documento_enviar_revision", "documento_proponer"],
  carmen: ["documento_acusar_lectura", "documento_consultar_vigente", "documento_elaborar", "documento_enviar_revision", "documento_proponer"],
  hector: ["documento_consultar_historico", "documento_consultar_vigente", "lista_maestra_exportar"],
  diego: ["documento_acusar_lectura", "documento_consultar_vigente"],
  jorge: [],
};
for (const [quien, esperado] of Object.entries(ESPERADO)) {
  const p = acciones(await me(t[quien]));
  const ok = typeof esperado === "number" ? p.length === esperado : JSON.stringify(p) === JSON.stringify(esperado);
  check(`permisos documentales de ${quien}`, ok, p.join(", ") || "(ninguno)");
}

/* ---------- 2. Clave FX y nueva ficha ---------- */
const claveA = `FX-TCP-A${s5}`;
const sinPermiso = await ficha(t.luis, { clave: `FX-TCP-X${s5}`, titulo: "Sin permiso", area_codigo: "TC", tipo_codigo: "P" }, { archivo_pdf: [pdfA, "a.pdf"] });
check("Técnico Analista no crea fichas (403)", sinPermiso.status === 403, `${sinPermiso.status} ${sinPermiso.data?.message}`);
const sinPermisoAdmin = await ficha(t.jorge, { clave: `FX-TCP-X${s5}`, titulo: "Sin permiso", area_codigo: "TC", tipo_codigo: "P" }, { archivo_pdf: [pdfA, "a.pdf"] });
check("Administrador técnico no crea fichas (403)", sinPermisoAdmin.status === 403, `${sinPermisoAdmin.status}`);
const A = await ficha(t.ana, { clave: claveA.toLowerCase(), titulo: `Procedimiento de prueba ${s5}`, area_codigo: "TC", tipo_codigo: "P", proceso: "Análisis", palabras_clave: "saxitoxina, prueba", numero: 3, elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.patricia }, { archivo_pdf: [pdfA, "procedimiento-a.pdf"], archivo_fuente: [docxSimple(), "procedimiento-a.docx"] });
const docA = A.data?.id;
const revA1 = A.data?.revision_id;
check("Mejora Continua crea la ficha con archivo inicial en borrador (201)", A.status === 201 && !!docA, `${A.status} ${A.data?.message}`);
check("la clave se guarda normalizada (mayúsculas)", fila("SELECT clave FROM sgc_documentos WHERE id = ?", docA)?.clave === claveA);
const r1 = fila("SELECT numero, estado FROM sgc_revisiones WHERE id = ?", revA1);
check("la revisión inicial queda en borrador con el número indicado", r1?.estado === "borrador" && r1?.numero === 3, JSON.stringify(r1));
const archA = filas("SELECT tipo, sha256 FROM sgc_archivos WHERE revision_id = ? ORDER BY tipo", revA1);
check("archivos con SHA-256 (fuente y PDF)", archA.length === 2 && archA.find((a) => a.tipo === "pdf")?.sha256 === sha(pdfA), JSON.stringify(archA.map((a) => a.tipo)));

const repetida = await ficha(t.ana, { clave: ` fx-tcp- a${s5.toLowerCase()} `, titulo: "Repetida", area_codigo: "TC", tipo_codigo: "P" }, { archivo_pdf: [pdfA, "a.pdf"] });
check("clave repetida (sin distinguir mayúsculas ni espacios) → 409 con mensaje claro", repetida.status === 409 && repetida.data?.campo === "clave" && /Ya existe un documento con la clave/.test(repetida.data?.message || ""), `${repetida.status} ${repetida.data?.message}`);
const formato = await ficha(t.ana, { clave: "TCP-123", titulo: "Mal formato", area_codigo: "TC", tipo_codigo: "P" }, { archivo_pdf: [pdfA, "a.pdf"] });
check("clave con formato inválido → 400 (campo clave)", formato.status === 400 && formato.data?.campo === "clave" && /formato/.test(formato.data?.message || ""), `${formato.status} ${formato.data?.message}`);
const area = await ficha(t.ana, { clave: `FX-GCP-Z${s5}`, titulo: "Área distinta", area_codigo: "TC", tipo_codigo: "P" }, { archivo_pdf: [pdfA, "a.pdf"] });
check("área de la clave distinta a la de la ficha → 400", area.status === 400 && /área GC/.test(area.data?.message || ""), `${area.status} ${area.data?.message}`);
const tipo = await ficha(t.ana, { clave: `FX-TCF-Z${s5}`, titulo: "Tipo distinto", area_codigo: "TC", tipo_codigo: "P" }, { archivo_pdf: [pdfA, "a.pdf"] });
check("tipo de la clave distinto al de la ficha → 400", tipo.status === 400 && /tipo F/.test(tipo.data?.message || ""), `${tipo.status} ${tipo.data?.message}`);
const rectorMal = await ficha(t.ana, { clave: "FX-MC-9/9", titulo: "Manual fuera de DI", area_codigo: "GC", tipo_codigo: "M" }, { archivo_pdf: [pdfA, "a.pdf"] });
check("FX-MC fuera del área DI → 400", rectorMal.status === 400 && /manuales rectores/.test(rectorMal.data?.message || ""), `${rectorMal.status} ${rectorMal.data?.message}`);
const yaRectores = filas("SELECT clave FROM sgc_documentos WHERE clave IN ('FX-MC-1/1', 'FX-MO-2-1')").map((r) => r.clave);
for (const clave of ["FX-MC-1/1", "FX-MO-2-1"]) {
  if (yaRectores.includes(clave)) continue;
  const r = await ficha(t.ana, { clave, titulo: `Manual rector ${clave}`, area_codigo: "DI", tipo_codigo: "M" }, { archivo_pdf: [pdfA, "manual.pdf"] });
  check(`excepción ${clave} en DI/M → 201`, r.status === 201, `${r.status} ${r.data?.message}`);
}
const sinArchivo = await ficha(t.ana, { clave: `FX-TCP-S${s5}`, titulo: "Sin archivo", area_codigo: "TC", tipo_codigo: "P" });
check("ficha sin archivo inicial → 400", sinArchivo.status === 400, `${sinArchivo.status} ${sinArchivo.data?.message}`);
const html = await ficha(t.ana, { clave: `FX-TCP-H${s5}`, titulo: "HTML", area_codigo: "TC", tipo_codigo: "P" }, { archivo_pdf: [Buffer.from("<html><script>alert(1)</script></html>"), "falso.pdf"] });
check("archivo que no es PDF (HTML renombrado) → 400", html.status === 400, `${html.status} ${html.data?.message}`);
const distintos = await ficha(t.ana, { clave: `FX-TCP-D${s5}`, titulo: "Personas repetidas", area_codigo: "TC", tipo_codigo: "P", elaborador_id: id.ricardo, revisor_id: id.ricardo }, { archivo_pdf: [pdfA, "a.pdf"] });
check("elaborador y revisor la misma persona → 400", distintos.status === 400 && /distintas/.test(distintos.data?.message || ""), `${distintos.status} ${distintos.data?.message}`);
const sinAccion = await ficha(t.ana, { clave: `FX-TCP-E${s5}`, titulo: "Revisor sin permiso", area_codigo: "TC", tipo_codigo: "P", revisor_id: id.luis }, { archivo_pdf: [pdfA, "a.pdf"] });
check("revisor sin documento_revisar → 400", sinAccion.status === 400 && /documento_revisar/.test(sinAccion.data?.message || ""), `${sinAccion.status} ${sinAccion.data?.message}`);

/* ---------- 3. Carga inicial: registrar vigente (contrasena) ---------- */
const sinMc = await api("POST", `/sgc/revisiones/${revA1}/registrar-vigente`, { fecha_emision: "2026-01-15" }, t.ricardo);
check("registrar vigente sin documento_publicar → 403", sinMc.status === 403, `${sinMc.status}`);
const sinReauth = await api("POST", `/sgc/revisiones/${revA1}/registrar-vigente`, { fecha_emision: "2026-01-15" }, t.ana, { "X-Sin-Reauth-Auto": "1" });
check("registrar vigente pide contraseña (401 reauth_required)", sinReauth.status === 401 && sinReauth.data?.codigo === "reauth_required", `${sinReauth.status} ${sinReauth.data?.codigo}`);
const vig = await api("POST", `/sgc/revisiones/${revA1}/registrar-vigente`, { fecha_emision: "2026-01-15", fecha_proxima_revision: "2027-01-15", comentario: "Autorizado en papel" }, t.ana);
check("Mejora Continua registra la revisión 3 como vigente (carga inicial)", vig.status === 200, `${vig.status} ${vig.data?.message}`);
check("el documento queda vigente y apunta a su revisión", fila("SELECT estado, revision_vigente_id FROM sgc_documentos WHERE id = ?", docA)?.revision_vigente_id === revA1);
const archivoVigente = fila("SELECT id, sha256 FROM sgc_archivos WHERE revision_id = ? AND tipo = 'pdf' AND reemplazado_en IS NULL", revA1);

/* ---------- 4. Una sola vigente por documento (base) ---------- */
{
  const db = new Database(process.env.TEST_DB_PATH);
  let error = "";
  try {
    db.prepare("INSERT INTO sgc_revisiones (documento_id, numero, estado, creado_en) VALUES (?, 99, 'vigente', ?)").run(docA, new Date().toISOString());
  } catch (e) {
    error = String(e.message);
  } finally {
    db.close();
  }
  check("la base rechaza una segunda revisión vigente del mismo documento", /UNIQUE/.test(error), error);
}

/* ---------- 5. Nueva revision sin tocar la vigente (CA-04) ---------- */
const noMc = await api("POST", `/sgc/documentos/${docA}/revisiones`, { motivo_cambio: "Cambio propuesto" }, t.luis);
check("Técnico Analista no abre revisiones (403)", noMc.status === 403, `${noMc.status}`);
const nueva = await api("POST", `/sgc/documentos/${docA}/revisiones`, { motivo_cambio: "Actualizar el método de extracción", apartados_afectados: "5.2", descripcion_cambio: "Nuevo volumen de extracción", elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.patricia }, t.ana);
const revA2 = nueva.data?.revision_id;
check("Mejora Continua abre la revisión 4 en borrador", nueva.status === 201 && nueva.data?.numero === 4, `${nueva.status} ${nueva.data?.message}`);
const otra = await api("POST", `/sgc/documentos/${docA}/revisiones`, { motivo_cambio: "Otra más a la vez" }, t.ana);
check("no se abre una segunda revisión en curso (409)", otra.status === 409, `${otra.status}`);
const vigenteTras = fila("SELECT estado, fecha_emision FROM sgc_revisiones WHERE id = ?", revA1);
check("la revisión vigente sigue intacta", vigenteTras?.estado === "vigente" && vigenteTras?.fecha_emision === "2026-01-15" && fila("SELECT revision_vigente_id FROM sgc_documentos WHERE id = ?", docA)?.revision_vigente_id === revA1);
const deMariana = await doc(docA, t.mariana);
const revsMariana = deMariana.data?.revisiones || [];
check("con solo consultar vigentes se ve únicamente la vigente (no el borrador)", deMariana.status === 200 && revsMariana.length === 1 && revsMariana[0].estado === "vigente" && !deMariana.data?.historial, JSON.stringify(revsMariana.map((r) => r.estado)));
const leidoVigente = await bytes(t.mariana, archivoVigente.id);
check("el PDF vigente se sigue abriendo igual durante la nueva revisión", leidoVigente.status === 200 && sha(leidoVigente.data) === archivoVigente.sha256);
const deLuis = await doc(docA, t.luis);
check("el elaborador asignado ve la vigente y su borrador", (deLuis.data?.revisiones || []).length === 2);

/* ---------- 6. Archivos: sustituir en borrador; inmutables al enviar a revision ---------- */
const noAsignado = await subir(t.ricardo, revA2, "pdf", pdfC, "rev4.pdf");
check("quien no es el elaborador asignado no carga archivos (403)", noAsignado.status === 403 && /elaborador asignado/.test(noAsignado.data?.message || ""), `${noAsignado.status} ${noAsignado.data?.message}`);
const noVe = await subir(t.mariana, revA2, "pdf", pdfC, "rev4.pdf");
check("quien no ve el borrador recibe 404 al cargar", noVe.status === 404, `${noVe.status}`);
const sinPdf = await api("POST", `/sgc/revisiones/${revA2}/enviar-revision`, {}, t.luis);
check("no se envía a revisión sin PDF de consulta (409)", sinPdf.status === 409 && /PDF/.test(sinPdf.data?.message || ""), `${sinPdf.status} ${sinPdf.data?.message}`);
const sub1 = await subir(t.luis, revA2, "pdf", pdfC, "rev4.pdf");
const sub2 = await subir(t.luis, revA2, "pdf", pdfD, "rev4-corregida.pdf");
const archR2 = filas("SELECT sha256, reemplazado_en FROM sgc_archivos WHERE revision_id = ? AND tipo = 'pdf' ORDER BY id", revA2);
check("el elaborador carga y sustituye el PDF en borrador; el anterior se conserva", sub1.status === 201 && sub2.status === 201 && archR2.length === 2 && !!archR2[0].reemplazado_en && !archR2[1].reemplazado_en && archR2[1].sha256 === sha(pdfD), JSON.stringify(archR2));
const ajeno = await api("POST", `/sgc/revisiones/${revA2}/enviar-revision`, {}, t.ricardo);
check("solo el elaborador asignado la envía a revisión", ajeno.status === 409 || ajeno.status === 403, `${ajeno.status} ${ajeno.data?.message}`);
const env = await api("POST", `/sgc/revisiones/${revA2}/enviar-revision`, { comentario: "Lista para revisión" }, t.luis);
check("el elaborador la envía a revisión", env.status === 200 && fila("SELECT estado FROM sgc_revisiones WHERE id = ?", revA2)?.estado === "en_revision", `${env.status} ${env.data?.message}`);
const tarde = await subir(t.luis, revA2, "pdf", pdfC, "otra.pdf");
check("tras enviar a revisión el archivo ya no se puede cambiar (409)", tarde.status === 409 && tarde.data?.codigo === "archivo_bloqueado", `${tarde.status} ${tarde.data?.message}`);
{
  const db = new Database(process.env.TEST_DB_PATH);
  const errores = [];
  try {
    db.prepare("INSERT INTO sgc_archivos (revision_id, tipo, nombre_original, nombre_almacenado, extension, mime, tamano_bytes, sha256, subido_en) VALUES (?, 'fuente', 'x.docx', ?, 'docx', 'x', 1, 'x', 'x')").run(revA2, `prueba-${s5}`);
  } catch (e) {
    errores.push(String(e.message));
  }
  try {
    db.prepare("UPDATE sgc_archivos SET sha256 = 'otro' WHERE revision_id = ?").run(revA2);
  } catch (e) {
    errores.push(String(e.message));
  }
  try {
    db.prepare("DELETE FROM sgc_archivos WHERE revision_id = ?").run(revA2);
  } catch (e) {
    errores.push(String(e.message));
  }
  db.close();
  check("la base también impide agregar, cambiar o borrar archivos de una revisión enviada", errores.length === 3 && /no estan? en borrador|no esta en borrador/.test(errores[0]) && /no se eliminan/.test(errores[2]), errores.join(" | "));
}
const deLuis2 = await doc(docA, t.luis);
const enCurso = (deLuis2.data?.revisiones || []).find((r) => r.id === revA2);
check("la ficha ofrece «cargar archivo» deshabilitado con su motivo", enCurso?.puede?.subir_archivo?.ok === false && /debe devolverse a borrador/.test(enCurso?.puede?.subir_archivo?.motivo || ""));

/* ---------- 7. Confidencialidad ---------- */
const claveB = `FX-GCL-B${s5}`;
const B = await ficha(t.ana, { clave: claveB, titulo: `Lista restringida ${s5}`, area_codigo: "GC", tipo_codigo: "L", confidencialidad: "restringido", propietario_id: id.gabriela, elaborador_id: id.carmen, revisor_id: id.ricardo, autorizador_id: id.patricia }, { archivo_pdf: [pdfB, "lista.pdf"] });
const docB = B.data?.id;
await api("POST", `/sgc/revisiones/${B.data?.revision_id}/registrar-vigente`, { fecha_emision: "2026-02-01" }, t.ana);
const archB = fila("SELECT id FROM sgc_archivos WHERE revision_id = ? AND tipo = 'pdf'", B.data?.revision_id);
for (const [quien, esperado] of [["mariana", 404], ["luis", 404], ["hector", 404], ["diego", 404], ["jorge", 404], ["patricia", 200], ["ana", 200], ["gabriela", 200], ["carmen", 200], ["ricardo", 200]]) {
  const r = await doc(docB, t[quien]);
  check(`restringido: ${quien} → ${esperado}`, r.status === esperado, `${r.status}`);
}
const directo = await bytes(t.mariana, archB.id);
check("restringido: el archivo por URL directa → 404", directo.status === 404, `${directo.status}`);
const lista = await api("GET", "/sgc/documentos", undefined, t.mariana);
check("restringido: no aparece en el explorador de quien no lo puede ver", lista.status === 200 && !(lista.data?.items || []).some((d) => d.id === docB) && (lista.data?.items || []).some((d) => d.id === docA));
const busca = async (token, q) => (await api("GET", `/busqueda?q=${encodeURIComponent(q)}`, undefined, token)).data?.grupos?.flatMap((g) => g.resultados || []) || [];
check("restringido: el buscador no lo muestra a quien no lo puede ver", !(await busca(t.mariana, claveB)).some((h) => h.href === `/documentos/${docB}`));
check("restringido: el buscador sí lo muestra a Responsable General", (await busca(t.patricia, claveB)).some((h) => h.href === `/documentos/${docB}`));
const consulta = await bytes(t.patricia, archB.id);
check("restringido: abrirlo queda en la bitácora (consultar)", consulta.status === 200 && !!fila("SELECT id FROM auditoria WHERE entidad = 'sgc_documentos' AND entidad_id = ? AND accion = 'consultar'", String(docB)));

{
  // Una lectura con Range (incluso "bytes=0-", que trae todo el archivo) tambien queda registrada.
  const r = await fetch(`${BASE}/sgc/archivos/${archB.id}?modo=ver`, { headers: { Authorization: `Bearer ${t.carmen}`, Range: "bytes=0-" } });
  await r.arrayBuffer();
  check("restringido: abrirlo con Range también queda en la bitácora", [200, 206].includes(r.status) && !!fila("SELECT id FROM auditoria WHERE entidad = 'sgc_documentos' AND entidad_id = ? AND accion = 'consultar' AND usuario_email = 'carmen.aguilar@ficotox.local'", String(docB)), `${r.status}`);
}

{
  // Bitacora global: los eventos de un restringido no aparecen a quien no lo puede ver (Auditor Interno), ni sueltos por id.
  const evB = fila("SELECT id FROM auditoria WHERE entidad = 'sgc_documentos' AND entidad_id = ? ORDER BY id LIMIT 1", String(docB));
  const deHector = (await api("GET", "/audit?limit=1000&entidades=sgc_documentos", undefined, t.hector)).data?.items || [];
  const suelto = await api("GET", `/audit/${evB.id}`, undefined, t.hector);
  const dePatricia = (await api("GET", "/audit?limit=1000&entidades=sgc_documentos", undefined, t.patricia)).data?.items || [];
  check("restringido: la bitácora global no muestra sus eventos a quien no lo puede ver (lista y entrada suelta 404)", !deHector.some((e) => String(e.entidad_id) === String(docB)) && deHector.some((e) => String(e.entidad_id) === String(docA)) && suelto.status === 404, `${suelto.status}`);
  check("restringido: Responsable General sí ve sus eventos en la bitácora global", dePatricia.some((e) => String(e.entidad_id) === String(docB)));
}

/* ---------- 8. Administrador tecnico y otros roles ---------- */
const jorgeLista = await api("GET", "/sgc/documentos", undefined, t.jorge);
check("administrador técnico ve metadatos de uso interno (diagnóstico)", jorgeLista.status === 200 && jorgeLista.data?.diagnostico === true && (jorgeLista.data?.items || []).some((d) => d.id === docA));
const jorgeDoc = await doc(docA, t.jorge);
check("administrador técnico: ficha en solo diagnóstico, sin abrir archivos", jorgeDoc.status === 200 && jorgeDoc.data?.solo_diagnostico === true && (jorgeDoc.data?.revisiones || []).every((r) => r.abrir === false));
const jorgeArchivo = await api("GET", `/sgc/archivos/${archivoVigente.id}?modo=ver`, undefined, t.jorge);
check("administrador técnico no abre archivos (403 solo_metadatos)", jorgeArchivo.status === 403 && jorgeArchivo.data?.codigo === "solo_metadatos", `${jorgeArchivo.status} ${jorgeArchivo.data?.codigo}`);
const hectorDoc = await doc(docA, t.hector);
check("Auditor Interno (histórico) ve también la revisión en curso y el historial", hectorDoc.status === 200 && (hectorDoc.data?.revisiones || []).length === 2 && hectorDoc.data?.historial === true);
const descarga = await bytes(t.diego, archivoVigente.id, "descargar");
check("Estudiante descarga la vigente y queda en la bitácora", descarga.status === 200 && !!fila("SELECT id FROM auditoria WHERE entidad = 'sgc_documentos' AND entidad_id = ? AND accion = 'descargar' AND usuario_email = 'diego.salinas@ficotox.local'", String(docA)));
const viejo = await api("GET", `/sgc/archivos/${fila("SELECT id FROM sgc_archivos WHERE revision_id = ? ORDER BY id LIMIT 1", revA2)?.id || 0}`, undefined, t.diego);
check("Estudiante no abre archivos de una revisión en curso (404)", viejo.status === 404, `${viejo.status}`);
const sinAcceso = await api("GET", "/sgc/documentos/999999", undefined, t.ana);
check("documento inexistente → 404", sinAcceso.status === 404);

/* ---------- 9. Editar metadatos ---------- */
const sinMotivo = await api("PUT", `/sgc/documentos/${docA}`, { clave: claveA, titulo: "Nuevo título", area_codigo: "TC", tipo_codigo: "P" }, t.ana);
check("editar metadatos exige motivo (400)", sinMotivo.status === 400 && sinMotivo.data?.campo === "motivo");
const edit = await api("PUT", `/sgc/documentos/${docA}`, { clave: claveA, titulo: `Procedimiento de prueba ${s5} (editado)`, area_codigo: "TC", tipo_codigo: "P", palabras_clave: "saxitoxina", confidencialidad: "uso_interno", motivo: "Corrección del título" }, t.ana);
const ev = fila("SELECT cambios_json FROM auditoria WHERE entidad = 'sgc_documentos' AND entidad_id = ? AND accion = 'editar' ORDER BY id DESC LIMIT 1", String(docA));
check("editar metadatos deja antes y después en la bitácora", edit.status === 200 && /editado/.test(ev?.cambios_json || "") && /titulo/.test(ev?.cambios_json || ""));
const editLuis = await api("PUT", `/sgc/documentos/${docA}`, { clave: claveA, titulo: "x", area_codigo: "TC", tipo_codigo: "P", motivo: "Intento sin permiso" }, t.luis);
check("Técnico Analista no edita la ficha (403)", editLuis.status === 403);

/* ---------- 10. Bitacora y Biblioteca retirada ---------- */
const acciones10 = filas("SELECT DISTINCT accion FROM auditoria WHERE entidad = 'sgc_documentos' AND entidad_id = ?", String(docA)).map((r) => r.accion);
check("bitácora del documento: crear, publicar, proponer, nueva revisión, subir/sustituir, enviar a revisión", ["crear", "publicar", "proponer", "nueva_revision", "subir", "sustituir", "enviar_revision"].every((a) => acciones10.includes(a)), acciones10.join(", "));
const eventos = (await doc(docA, t.ana)).data?.eventos || [];
check("la ficha muestra los eventos de la bitácora a quien ve el historial", eventos.length >= 5 && (deMariana.data?.eventos || []).length === 0);
const bib = await api("GET", "/biblioteca", undefined, t.qa);
check("la API de la Biblioteca ya no responde (404)", bib.status === 404, `${bib.status}`);
const pagina = await fetch(`${BASE.replace(/\/api$/, "")}/calidad/biblioteca`, { redirect: "manual" });
check("la página de la Biblioteca redirige a Documentos SGC", [307, 308].includes(pagina.status) && /\/documentos$/.test(pagina.headers.get("location") || ""), `${pagina.status} ${pagina.headers.get("location")}`);

terminar();
