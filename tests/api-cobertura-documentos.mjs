/*
 * Prueba integral · cobertura de Documentos SGC (API). Cubre los renglones de la matriz que no tenían
 * prueba automática: validaciones de cada formulario y endpoint (§2), transiciones que son efecto de
 * publicar u obsoletar (§3) y las rutas heredadas /api/documentos-sgc (§4.2). Cada check lleva su
 * etiqueta [cob:D:<id>]. Personas con su rol real: Ana (Mejora Continua), Luis (elaborador),
 * Gabriela (revisora), Patricia (autorizadora), Ricardo, Héctor, Diego, Mariana, Jorge.
 */
import "./lib/reauth-auto.mjs";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { api, crearCheck, Database, enDias, fila, hoy, sesiones } from "./lib/calidad.mjs";
import { docxSimple, pdfConTexto } from "./lib/archivos.mjs";

const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const s5 = Date.now().toString(36).slice(-5).toUpperCase();
let serie = 0;
const clave = (area, tipo) => `FX-${area}${tipo}-K${s5}${(serie++).toString(36).toUpperCase()}`;
const SIN_APROBAR = { "X-Sin-Aprobar-Auto": "1" };
const SIN_REAUTH = { "X-Sin-Reauth-Auto": "1", "X-Sin-Aprobar-Auto": "1" };
const RESP = { elaborador_id: id.luis, revisor_id: id.gabriela, autorizador_id: id.patricia };
const PDF = await pdfConTexto(1, `Cobertura ${s5}`);
const ejecutar = (sql, ...p) => {
  const b = new Database(process.env.TEST_DB_PATH);
  try {
    return b.prepare(sql).run(...p);
  } finally {
    b.close();
  }
};
const txt = (r) => `${r.status} ${r.data?.codigo ?? ""} ${r.data?.campo ?? ""} ${typeof r.data === "object" && r.data ? (r.data.message ?? "") : ""}`.trim();
/* ¿Respuesta con ese status y esos campos (campo, codigo, regla…)? */
const es = (r, status, extra = {}) => r.status === status && Object.entries(extra).every(([k, v]) => r.data?.[k] === v);
const sgcDir = path.join(path.dirname(process.env.TEST_DB_PATH), "sgc");

function form(campos, archivos = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) if (v !== undefined) fd.append(k, String(v));
  for (const [k, [bytes, nombre]] of Object.entries(archivos)) fd.append(k, new Blob([bytes]), nombre);
  return fd;
}
const fichaForm = (campos, archivos = { archivo_pdf: [PDF, "inicial.pdf"] }) => form({ ...RESP, ...campos }, archivos);
async function ficha(campos) {
  const r = await api("POST", "/sgc/documentos", fichaForm({ clave: clave(campos.area_codigo || "TC", campos.tipo_codigo || "P"), titulo: `Documento de cobertura ${s5}`, area_codigo: "TC", tipo_codigo: "P", ...campos }), t.ana);
  return { id: r.data?.id, revision_id: r.data?.revision_id, r };
}
async function vigente(campos = {}, fechas = { fecha_emision: "2025-01-10", fecha_proxima_revision: "2028-01-10" }) {
  const d = await ficha(campos);
  const v = await api("POST", `/sgc/revisiones/${d.revision_id}/registrar-vigente`, fechas, t.ana);
  return { ...d, ok: d.r.status === 201 && v.status === 200, v };
}
const claveDe = (docId) => fila("SELECT clave FROM sgc_documentos WHERE id = ?", docId)?.clave;
const estadoRev = (rid) => fila("SELECT estado FROM sgc_revisiones WHERE id = ?", rid)?.estado;
const nuevaRev = async (docId, extra = {}) => (await api("POST", `/sgc/documentos/${docId}/revisiones`, { motivo_cambio: "Actualización del método de cobertura", ...RESP, ...extra }, t.ana)).data?.revision_id;
const subirPdf = (rid, token = t.luis) => api("POST", `/sgc/revisiones/${rid}/archivos`, form({ tipo: "pdf" }, { archivo: [PDF, "consulta.pdf"] }), token);
const completar = (rid) => api("PUT", `/sgc/revisiones/${rid}`, { apartados_afectados: "Sección 5", descripcion_cambio: "Se actualiza el método" }, t.luis);
async function aEnRevision(rid, conPdf = true) {
  if (conPdf) await subirPdf(rid);
  await completar(rid);
  return api("POST", `/sgc/revisiones/${rid}/enviar-revision`, {}, t.luis);
}
async function aAutorizada(rid, conPdf = true) {
  await aEnRevision(rid, conPdf);
  await api("POST", `/sgc/revisiones/${rid}/revisar`, { decision: "aceptar" }, t.gabriela);
  return api("POST", `/sgc/revisiones/${rid}/autorizar`, { decision: "autorizar" }, t.patricia);
}
const baseExterno = () => ({ identificador: `NMX-K-${s5}-${serie++}`, titulo: `Norma de cobertura ${s5}`, area_codigo: "GC", tipo_codigo: "R", fuente: "IMNC", version_fecha: "2018", enlace: "https://www.imnc.org.mx", responsable_id: id.ricardo, ultima_verificacion: enDias(0), proxima_revision: enDias(365) });
const externo = (campos, headers = {}) => api("POST", "/sgc/externos", form(campos, { archivo_pdf: [PDF, "norma.pdf"] }), t.ana, headers);
const obsoletarDoc = (docId, headers = {}) => api("POST", `/sgc/documentos/${docId}/obsoletar`, { motivo: "Se retira el documento de cobertura" }, t.ana, headers);
const solicitudObs = (docId) => fila("SELECT id, estado FROM solicitudes_autorizacion WHERE tipo = 'obsoletar_documento_sgc' AND entidad = 'sgc_documentos' AND entidad_id = ? ORDER BY id DESC", String(docId));

/* ---------- Preparación: cuentas propias y documentos ---------- */
const roles = (await api("GET", "/admin/roles", undefined, t.qa)).data?.items || [];
const rolDe = (k, nombre) => roles.find((r) => r.clave === k || r.nombre === nombre)?.id;
const password = `Cobertura-${s5}-2026`;
async function cuenta(nombre, rolId, headers = {}) {
  const email = `cob.${nombre}.${s5.toLowerCase()}@ficotox.local`;
  const r = await api("POST", "/admin/usuarios", { nombre: `Cobertura ${nombre} ${s5}`, email, activo: true, rol_id: rolId, departamento: "Laboratorio", password, motivo: "Alta de la suite de cobertura de Documentos SGC" }, t.jorge, headers);
  ejecutar("UPDATE usuarios SET debe_cambiar_password = 0 WHERE email = ?", email);
  const token = (await api("POST", "/auth/login", { email, password })).data?.token;
  return { id: Number(r.data?.id), email, token, r };
}
// Sin roles (su rol inicial queda pendiente y se cancela): ninguna acción documental ni usuarios:G.
const sinRol = await cuenta("sinrol", rolDe("tecnico_auxiliar", "Técnico Auxiliar"), SIN_APROBAR);
if (sinRol.r.data?.solicitud?.id) await api("POST", `/solicitudes/${sinRol.r.data.solicitud.id}/cancelar`, { motivo: "La cuenta de cobertura queda sin roles" }, t.jorge);
// Revisora que luego se da de baja (cuenta inactiva para las reglas de «cuenta activa»).
const revTemp = await cuenta("revisora", rolDe("coord_investigacion", "Coordinador/a de Investigación y Desarrollo"));
// Rol que publica pero no administra lecturas (ningún rol del catálogo es así).
const rolPub = await api("POST", "/admin/roles", { nombre: `Publicadora cobertura ${s5}`, motivo: "Rol de la suite de cobertura de Documentos", permisos: ["documento_consultar_vigente", "documento_consultar_historico", "documento_publicar"].map((accion) => ({ modulo: "documentos", accion })) }, t.jorge);
const publicadora = await cuenta("publicadora", rolPub.data?.id);
const RT = await ficha({ titulo: `Revisión con revisora temporal ${s5}`, revisor_id: revTemp.id });
const baja = await api("DELETE", `/admin/usuarios/${revTemp.id}`, { motivo: "Baja de la revisora temporal de cobertura" }, t.jorge);
const inactiva = revTemp.id;
check("(preparación) cuentas propias: sin roles, revisora dada de baja, publicadora", !!sinRol.token && sinRol.r.status === 201 && RT.r.status === 201 && baja.status === 200 && fila("SELECT activo FROM usuarios WHERE id = ?", inactiva)?.activo === 0 && !!publicadora.token, `${sinRol.r.status} ${RT.r.status} ${txt(baja)} ${rolPub.status} ${publicadora.r.status}`);

const U = await vigente({ titulo: `Procedimiento vigente ${s5}` });
const distU = await api("POST", `/sgc/revisiones/${U.revision_id}/distribucion`, { usuarios: [id.luis], requiere_lectura: true, motivo: "Distribución de cobertura" }, t.ana);
const U2 = await vigente({ titulo: `Procedimiento con devolución ${s5}` });
const Ui = await vigente({ titulo: `Procedimiento de integridad ${s5}` });
const U4 = await vigente({ titulo: `Procedimiento a reasignar ${s5}` });
const C = await vigente({ titulo: `Lista confidencial ${s5}`, area_codigo: "GC", tipo_codigo: "L", confidencialidad: "confidencial" });
const O = await vigente({ titulo: `Procedimiento a retirar ${s5}` });
const solO = await api("POST", "/sgc/solicitudes", { tipo: "cambio", documento_id: O.id, justificacion: "Cambio pedido antes de retirar el documento" }, t.luis);
const obsO = await obsoletarDoc(O.id);
const N = await ficha({ titulo: `Procedimiento nuevo ${s5}` });
const extR = await externo(baseExterno());
const Ext = { id: extR.data?.id, revision_id: extR.data?.revision_id };
check("(preparación) documentos vigentes, confidencial, obsoleto, borrador y externo", [U, U2, Ui, U4, C, O].every((d) => d.ok) && distU.status === 201 && solO.status === 201 && fila("SELECT estado FROM sgc_documentos WHERE id = ?", O.id)?.estado === "obsoleto" && N.r.status === 201 && extR.status === 201, `${[U, U2, Ui, U4, C, O].map((d) => d.ok)} ${distU.status} ${solO.status} ${txt(obsO)} ${N.r.status} ${txt(extR)}`);

/* ---------- Acceso ---------- */
{
  const cat = await api("GET", "/sgc/catalogos", undefined, sinRol.token);
  const lista = await api("GET", "/sgc/documentos", undefined, sinRol.token);
  check("[cob:D:V-001] sin acción documental ni diagnóstico → 403 sin_permiso (catálogos y lista)", es(cat, 403, { codigo: "sin_permiso" }) && es(lista, 403, { codigo: "sin_permiso" }), `${txt(cat)} | ${txt(lista)}`);
  const inex = await api("GET", "/sgc/documentos/99999999", undefined, t.ana);
  const confRic = await api("GET", `/sgc/documentos/${C.id}`, undefined, t.ricardo);
  const confHec = await api("GET", `/sgc/documentos/${C.id}`, undefined, t.hector);
  const confPat = await api("GET", `/sgc/documentos/${C.id}`, undefined, t.patricia);
  const obsDiego = await api("GET", `/sgc/documentos/${O.id}`, undefined, t.diego);
  const obsMar = await api("GET", `/sgc/documentos/${O.id}`, undefined, t.mariana);
  const obsHec = await api("GET", `/sgc/documentos/${O.id}`, undefined, t.hector);
  const no = (r) => es(r, 404, { message: "Documento no encontrado" });
  check("[cob:D:V-002] documento inexistente, confidencial ajeno u obsoleto sin histórico → 404 «Documento no encontrado»", no(inex) && no(confRic) && no(confHec) && no(obsDiego) && no(obsMar), [inex, confRic, confHec, obsDiego, obsMar].map(txt).join(" | "));
  check("[cob:D:V-002] …quien sí debe verlos los ve (Responsable General el confidencial; auditor el obsoleto)", confPat.status === 200 && obsHec.status === 200, `${confPat.status} ${obsHec.status}`);
  const R2pre = await nuevaRev(U.id);
  const revConf = await api("PUT", `/sgc/revisiones/${C.revision_id}`, { descripcion_cambio: "Intento ajeno" }, t.ricardo);
  const revOculta = await api("PUT", `/sgc/revisiones/${R2pre}`, { descripcion_cambio: "Intento ajeno" }, t.diego);
  const revInex = await api("PUT", "/sgc/revisiones/99999999", { descripcion_cambio: "x" }, t.ana);
  check("[cob:D:V-003] revisión de un documento no visible, no visible para la persona o inexistente → 404", revConf.status === 404 && es(revOculta, 404, { message: "Revisión no encontrada" }) && es(revInex, 404, { message: "Revisión no encontrada" }), [revConf, revOculta, revInex].map(txt).join(" | "));
  globalThis.R2 = R2pre;
  const cAna = (await api("GET", "/sgc/catalogos", undefined, t.ana)).data;
  const cLuis = (await api("GET", "/sgc/catalogos", undefined, t.luis)).data;
  const cPat = (await api("GET", "/sgc/catalogos", undefined, t.patricia)).data;
  check("[cob:D:V-158] catálogos: personas y roles solo para quien crea fichas / gestiona externos / administra lecturas", cAna?.personas?.length > 0 && cAna?.roles?.length > 0 && Array.isArray(cLuis?.personas) && cLuis.personas.length === 0 && cLuis.roles.length === 0 && cPat?.personas?.length === 0 && cPat?.roles?.length === 0, `${cAna?.personas?.length}/${cAna?.roles?.length} ${cLuis?.personas?.length}/${cLuis?.roles?.length} ${cPat?.personas?.length}/${cPat?.roles?.length}`);
}
const R2 = globalThis.R2;

/* ---------- Ficha: validaciones al crear ---------- */
{
  const casos = [
    ["V-004", "título vacío → 400 campo titulo", { titulo: "" }, 400, { campo: "titulo" }],
    ["V-005", "área inexistente → 400 campo area", { area_codigo: "ZZ" }, 400, { campo: "area" }],
    ["V-006", "tipo documental inexistente → 400 campo tipo", { tipo_codigo: "Z" }, 400, { campo: "tipo" }],
    ["V-007", "confidencialidad fuera del catálogo → 400 campo confidencialidad", { confidencialidad: "secreto" }, 400, { campo: "confidencialidad" }],
    ["V-008", "clave sin formato FX → 400 campo clave", { clave: `PROC-${s5}` }, 400, { campo: "clave" }],
    ["V-008", "clave de otra área → 400 campo clave", { clave: `FX-GCP-Z${s5}` }, 400, { campo: "clave" }],
    ["V-008", "clave rectora FX-MC fuera de DI/M → 400 campo clave", { clave: `FX-MC-Z${s5}` }, 400, { campo: "clave" }],
    ["V-010", "propietario con la cuenta dada de baja → 400 campo propietario", { propietario_id: inactiva }, 400, { campo: "propietario" }],
    ["V-011", "elaborador con la cuenta dada de baja → 400 campo elaborador", { elaborador_id: inactiva }, 400, { campo: "elaborador" }],
    ["V-012", "elaborador sin documento_elaborar (estudiante) → 400 campo elaborador", { elaborador_id: id.diego }, 400, { campo: "elaborador" }],
    ["V-012", "revisor sin documento_revisar (técnico) → 400 campo revisor", { revisor_id: id.mariana }, 400, { campo: "revisor" }],
    ["V-012", "autorizador sin documento_autorizar → 400 campo autorizador", { autorizador_id: id.gabriela, revisor_id: id.ricardo }, 400, { campo: "autorizador" }],
    ["V-013][cob:D:V-023", "elaborador y revisor la misma persona (ambos papeles permitidos) → 400 segregación regla 11", { elaborador_id: id.gabriela }, 400, { codigo: "segregacion", regla: 11 }],
    ["V-021", "origen externo por la ficha interna → 400 campo origen", { origen: "externo" }, 400, { campo: "origen" }],
    ["V-022", "revisión inicial 1000 → 400 campo numero", { numero: "1000" }, 400, { campo: "numero" }],
    ["V-022", "revisión inicial negativa → 400 campo numero", { numero: "-1" }, 400, { campo: "numero" }],
    ["V-022", "revisión inicial no entera → 400 campo numero", { numero: "1.5" }, 400, { campo: "numero" }],
  ];
  for (const [vid, nombre, cambio, status, extra] of casos) {
    const k = cambio.clave ?? clave(cambio.area_codigo && cambio.area_codigo !== "ZZ" ? cambio.area_codigo : "TC", cambio.tipo_codigo && cambio.tipo_codigo !== "Z" ? cambio.tipo_codigo : "P");
    const r = await api("POST", "/sgc/documentos", fichaForm({ clave: k, titulo: `Ficha inválida ${s5}`, area_codigo: "TC", tipo_codigo: "P", ...cambio }), t.ana);
    check(`[cob:D:${vid}] ficha: ${nombre} (y no se crea)`, es(r, status, extra) && !fila("SELECT id FROM sgc_documentos WHERE clave = ?", String(k).toUpperCase()), txt(r));
  }
  const rector = await api("POST", "/sgc/documentos", fichaForm({ clave: `FX-MC-K${s5}`, titulo: `Manual rector ${s5}`, area_codigo: "DI", tipo_codigo: "M" }), t.ana);
  check("[cob:D:V-008] …la clave rectora FX-MC sí se acepta en DI/M", rector.status === 201, txt(rector));
  const k = () => clave("TC", "P");
  const base = (kk) => ({ ...RESP, clave: kk, titulo: `Ficha inválida ${s5}`, area_codigo: "TC", tipo_codigo: "P" });
  const k1 = k();
  const luis = await api("POST", "/sgc/documentos", fichaForm(base(k1)), t.luis);
  check("[cob:D:V-020] crear ficha sin documento_crear_ficha (técnico) → 403", es(luis, 403, { codigo: "sin_permiso" }) && !fila("SELECT id FROM sgc_documentos WHERE clave = ?", k1), txt(luis));
  const k2 = k();
  const jsonR = await api("POST", "/sgc/documentos", base(k2), t.ana);
  check("[cob:D:V-014] ficha con cuerpo JSON (no multipart) → 400", jsonR.status === 400 && /multipart/.test(jsonR.data?.message || "") && !fila("SELECT id FROM sgc_documentos WHERE clave = ?", k2), txt(jsonR));
  const k3 = k();
  const tipoMal = await api("POST", "/sgc/documentos", form({ ...base(k3), tipo: "otro" }, { archivo: [PDF, "x.pdf"] }), t.ana);
  check("[cob:D:V-015] archivo suelto con tipo distinto de pdf/fuente → 400 campo tipo", es(tipoMal, 400, { campo: "tipo" }) && !fila("SELECT id FROM sgc_documentos WHERE clave = ?", k3), txt(tipoMal));
  const k4 = k();
  const sinArch = await api("POST", "/sgc/documentos", form(base(k4)), t.ana);
  const k5 = k();
  const vacio = await api("POST", "/sgc/documentos", form(base(k5), { archivo_pdf: [Buffer.alloc(0), "vacio.pdf"] }), t.ana);
  check("[cob:D:V-016][cob:D:V-019] sin archivo o con archivo vacío → 400 campo archivo", es(sinArch, 400, { campo: "archivo" }) && es(vacio, 400, { campo: "archivo" }) && !fila("SELECT id FROM sgc_documentos WHERE clave IN (?, ?)", k4, k5), `${txt(sinArch)} | ${txt(vacio)}`);
  const k6 = k();
  const exe = await api("POST", "/sgc/documentos", form(base(k6), { archivo_pdf: [PDF, "programa.exe"] }), t.ana);
  const k7 = k();
  const txtF = await api("POST", "/sgc/documentos", form(base(k7), { archivo_pdf: [PDF, "c.pdf"], archivo_fuente: [Buffer.from("notas"), "notas.txt"] }), t.ana);
  check("[cob:D:V-018] extensión no permitida (PDF .exe, fuente .txt) → 400 formato_no_permitido", es(exe, 400, { codigo: "formato_no_permitido" }) && es(txtF, 400, { codigo: "formato_no_permitido" }) && !fila("SELECT id FROM sgc_documentos WHERE clave IN (?, ?)", k6, k7), `${txt(exe)} | ${txt(txtF)}`);
  const k8 = k();
  const falso = await api("POST", "/sgc/documentos", form(base(k8), { archivo_pdf: [Buffer.from("esto no es un PDF de verdad"), "falso.pdf"] }), t.ana);
  check("[cob:D:V-019] .pdf cuyos bytes no son PDF → 400 contenido_no_valido", es(falso, 400, { codigo: "contenido_no_valido" }) && !fila("SELECT id FROM sgc_documentos WHERE clave = ?", k8), txt(falso));
}

/* ---------- Ficha: editar ---------- */
{
  const d = (await api("GET", `/sgc/documentos/${U.id}`, undefined, t.ana)).data?.item;
  const datos = { clave: d?.clave, titulo: d?.titulo, area_codigo: "TC", tipo_codigo: "P", confidencialidad: "uso_interno" };
  const luis = await api("PUT", `/sgc/documentos/${U.id}`, { ...datos, titulo: "Título cambiado por Luis", motivo: "Corregir el título" }, t.luis);
  const sinMotivo = await api("PUT", `/sgc/documentos/${U.id}`, { ...datos, titulo: "Título sin motivo" }, t.ana);
  const sinTitulo = await api("PUT", `/sgc/documentos/${U.id}`, { ...datos, titulo: "", motivo: "Quitar el título" }, t.ana);
  const titulo = fila("SELECT titulo FROM sgc_documentos WHERE id = ?", U.id)?.titulo;
  check("[cob:D:V-024] editar la ficha sin documento_crear_ficha → 403", es(luis, 403, { codigo: "sin_permiso" }), txt(luis));
  check("[cob:D:V-026] editar la ficha sin motivo → 400 campo motivo", es(sinMotivo, 400, { campo: "motivo" }), txt(sinMotivo));
  check("[cob:D:V-004] editar la ficha con título vacío → 400 campo titulo (y el título no cambió)", es(sinTitulo, 400, { campo: "titulo" }) && titulo === d?.titulo, `${txt(sinTitulo)} ${titulo}`);
  const dO = (await api("GET", `/sgc/documentos/${O.id}`, undefined, t.ana)).data?.item;
  const obs = await api("PUT", `/sgc/documentos/${O.id}`, { clave: dO?.clave, titulo: "Otro título", area_codigo: "TC", tipo_codigo: "P", confidencialidad: "uso_interno", motivo: "Corregir el título" }, t.ana);
  check("[cob:D:V-025] editar la ficha de un documento obsoleto → 409", obs.status === 409, txt(obs));
}

/* ---------- Revisión en borrador: datos, archivos y envío ---------- */
{
  const fecha = await api("PUT", `/sgc/revisiones/${R2}`, { fecha_emision: "10/01/2025" }, t.ana);
  check("[cob:D:V-027] fecha con formato distinto de AAAA-MM-DD → 400 campo fecha_emision", es(fecha, 400, { campo: "fecha_emision" }), txt(fecha));
  const gab = await api("PUT", `/sgc/revisiones/${R2}`, { descripcion_cambio: "La revisora edita" }, t.gabriela);
  check("[cob:D:V-029] editar la revisión sin ser el elaborador asignado ni crear fichas → 403", es(gab, 403, { codigo: "sin_permiso" }) && !fila("SELECT descripcion_cambio FROM sgc_revisiones WHERE id = ?", R2)?.descripcion_cambio, txt(gab));
  const luisAsigna = await api("PUT", `/sgc/revisiones/${R2}`, { revisor_id: id.ricardo }, t.luis);
  check("[cob:D:V-030] el elaborador cambia al revisor → 403 (solo Mejora Continua asigna)", es(luisAsigna, 403, { codigo: "sin_permiso" }) && Number(fila("SELECT revisor_id FROM sgc_revisiones WHERE id = ?", R2)?.revisor_id) === id.gabriela, txt(luisAsigna));
  const mismo = await api("PUT", `/sgc/revisiones/${R2}`, { elaborador_id: id.gabriela }, t.ana);
  const sinPapel = await api("PUT", `/sgc/revisiones/${R2}`, { revisor_id: id.diego }, t.ana);
  check("[cob:D:V-031] responsables inválidos al editar (misma persona; sin permiso del papel) → 400", es(mismo, 400, { codigo: "segregacion", regla: 11 }) && es(sinPapel, 400, { campo: "revisor" }) && Number(fila("SELECT revisor_id FROM sgc_revisiones WHERE id = ?", R2)?.revisor_id) === id.gabriela && Number(fila("SELECT elaborador_id FROM sgc_revisiones WHERE id = ?", R2)?.elaborador_id) === id.luis, `${txt(mismo)} | ${txt(sinPapel)}`);
  const subeGab = await subirPdf(R2, t.gabriela);
  const subeRic = await subirPdf(R2, t.ricardo);
  check("[cob:D:V-033] cargar el archivo sin ser el elaborador asignado → 403 (y no se guarda)", es(subeGab, 403, { codigo: "sin_permiso" }) && es(subeRic, 403, { codigo: "sin_permiso" }) && !fila("SELECT id FROM sgc_archivos WHERE revision_id = ?", R2), `${txt(subeGab)} | ${txt(subeRic)}`);
  const sinPdf = await api("POST", `/sgc/revisiones/${R2}/enviar-revision`, {}, t.luis);
  await subirPdf(R2);
  const sinCampos = await api("POST", `/sgc/revisiones/${R2}/enviar-revision`, {}, t.luis);
  const hec = await api("POST", `/sgc/revisiones/${R2}/enviar-revision`, {}, t.hector);
  check("[cob:D:V-035] enviar sin PDF o con datos incompletos → 409 incompleta; sin documento_enviar_revision → 403 sin_permiso", es(sinPdf, 409, { codigo: "incompleta" }) && /PDF/.test(sinPdf.data?.message || "") && es(sinCampos, 409, { codigo: "incompleta" }) && es(hec, 403, { codigo: "sin_permiso" }) && estadoRev(R2) === "borrador", `${txt(sinPdf)} | ${txt(sinCampos)} | ${txt(hec)}`);
  await api("PUT", `/sgc/revisiones/${R2}`, { motivo_cambio: "", apartados_afectados: "Sección 5", descripcion_cambio: "Se actualiza el método" }, t.luis);
  const sinMotivo = await api("POST", `/sgc/revisiones/${R2}/enviar-revision`, {}, t.luis);
  check("[cob:D:V-036] enviar sin motivo del cambio → rechazado (409, pide el motivo) y sigue en borrador", sinMotivo.status === 409 && /motivo/i.test(sinMotivo.data?.message || "") && estadoRev(R2) === "borrador", txt(sinMotivo));
  await api("PUT", `/sgc/revisiones/${R2}`, { motivo_cambio: "Actualización del método de cobertura" }, t.luis);
  const [e1, e2] = await Promise.all([api("POST", `/sgc/revisiones/${R2}/enviar-revision`, {}, t.luis), api("POST", `/sgc/revisiones/${R2}/enviar-revision`, {}, t.luis)]);
  const envios = Number(fila("SELECT COUNT(*) AS n FROM sgc_flujo_acciones WHERE revision_id = ? AND accion = 'enviar_revision'", R2)?.n);
  check("[cob:D:V-039] dos envíos a la vez: uno pasa y el otro 409; un solo envío en la línea de tiempo", [e1.status, e2.status].sort().join() === "200,409" && envios === 1 && estadoRev(R2) === "en_revision", `${txt(e1)} | ${txt(e2)} ${envios}`);
  const otra = await api("POST", `/sgc/revisiones/${R2}/enviar-revision`, {}, t.luis);
  check("[cob:D:V-034] enviar una revisión que ya no está en borrador → 409 no_borrador", es(otra, 409, { codigo: "no_borrador" }), txt(otra));
  const edita = await api("PUT", `/sgc/revisiones/${R2}`, { descripcion_cambio: "Cambio tardío" }, t.ana);
  check("[cob:D:V-028] editar una revisión en revisión → 409 no_borrador", es(edita, 409, { codigo: "no_borrador" }), txt(edita));
  await completar(RT.revision_id);
  const rt = await api("POST", `/sgc/revisiones/${RT.revision_id}/enviar-revision`, {}, t.luis);
  check("[cob:D:V-037] enviar con el revisor dado de baja → 400 «cuenta activa» y sigue en borrador", es(rt, 400, { campo: "revisor" }) && /cuenta activa/.test(rt.data?.message || "") && estadoRev(RT.revision_id) === "borrador", txt(rt));
}

/* ---------- Regla 11 en el tiempo: quien ya revisó no elabora ---------- */
{
  const R3 = await nuevaRev(U2.id);
  const env = await aEnRevision(R3);
  const dev = await api("POST", `/sgc/revisiones/${R3}/revisar`, { decision: "devolver", comentario: "Falta la tabla de resultados" }, t.gabriela);
  const reas = await api("POST", `/sgc/revisiones/${R3}/reasignar`, { elaborador_id: id.gabriela, revisor_id: id.ricardo, motivo: "Gabriela retoma la elaboración" }, t.ana);
  check("[cob:D:V-093] reasignar como elaboradora a quien ya revisó → 400 segregación regla 11", env.status === 200 && dev.status === 200 && es(reas, 400, { codigo: "segregacion", regla: 11 }) && Number(fila("SELECT elaborador_id FROM sgc_revisiones WHERE id = ?", R3)?.elaborador_id) === id.luis, `${env.status} ${dev.status} ${txt(reas)}`);
  // Editar los datos del borrador no revisa los papeles ejercidos (ver DUDA en el reporte); el envío sí lo impide.
  const put = await api("PUT", `/sgc/revisiones/${R3}`, { elaborador_id: id.gabriela, revisor_id: id.ricardo }, t.ana);
  const envGab = await api("POST", `/sgc/revisiones/${R3}/enviar-revision`, {}, t.gabriela);
  check("[cob:D:V-038] quien ya actuó como revisora no envía como elaboradora → 403 segregación regla 11", es(envGab, 403, { codigo: "segregacion", regla: 11 }) && estadoRev(R3) === "borrador", `${txt(put)} | ${txt(envGab)}`);
  const vig = await api("POST", `/sgc/revisiones/${R3}/registrar-vigente`, { fecha_emision: "2025-02-01" }, t.ana);
  check("[cob:D:V-041] carga inicial de una revisión de un documento que ya tiene vigente → 409 no_aplica", es(vig, 409, { codigo: "no_aplica" }) && estadoRev(R3) === "borrador", txt(vig));
}

/* ---------- Carga inicial ---------- */
{
  const ric = await api("POST", `/sgc/revisiones/${N.revision_id}/registrar-vigente`, { fecha_emision: "2025-01-10" }, t.ricardo);
  check("[cob:D:V-040] carga inicial sin documento_publicar (Área Técnica) → 403", es(ric, 403, { codigo: "sin_permiso" }), txt(ric));
  const sinFecha = await api("POST", `/sgc/revisiones/${N.revision_id}/registrar-vigente`, {}, t.ana);
  check("[cob:D:V-042] carga inicial sin fecha de emisión → 400 campo fecha_emision", es(sinFecha, 400, { campo: "fecha_emision" }), txt(sinFecha));
  const formato = await api("POST", `/sgc/revisiones/${N.revision_id}/registrar-vigente`, { fecha_emision: "2025/01/10" }, t.ana);
  check("[cob:D:V-027] carga inicial con fecha 2025/01/10 → 400 campo fecha_emision", es(formato, 400, { campo: "fecha_emision" }), txt(formato));
  const prox = await api("POST", `/sgc/revisiones/${N.revision_id}/registrar-vigente`, { fecha_emision: "2025-01-10", fecha_proxima_revision: "2025-01-10" }, t.ana);
  check("[cob:D:V-043] próxima revisión igual a la vigencia → 400 campo fecha_proxima_revision (y sigue en borrador)", es(prox, 400, { campo: "fecha_proxima_revision" }) && estadoRev(N.revision_id) === "borrador", txt(prox));
}

/* ---------- Archivos: ver, rangos e integridad ---------- */
{
  const aid = (rid) => fila("SELECT id, nombre_almacenado FROM sgc_archivos WHERE revision_id = ? AND tipo = 'pdf' AND reemplazado_en IS NULL", rid);
  const inex = await api("GET", "/sgc/archivos/99999999", undefined, t.ana);
  const conf = await api("GET", `/sgc/archivos/${aid(C.revision_id)?.id}`, undefined, t.ricardo);
  const borr = await api("GET", `/sgc/archivos/${aid(R2)?.id}`, undefined, t.diego);
  check("[cob:D:V-045] archivo inexistente, de un confidencial ajeno o de una revisión que no ve → 404", inex.status === 404 && conf.status === 404 && borr.status === 404, `${txt(inex)} | ${txt(conf)} | ${txt(borr)}`);
  const a = aid(U4.revision_id);
  const parcial = await api("GET", `/sgc/archivos/${a?.id}`, undefined, t.ana, { Range: "bytes=0-9" });
  const fuera = await api("GET", `/sgc/archivos/${a?.id}`, undefined, t.ana, { Range: "bytes=99999999-" });
  check("[cob:D:V-049] rango válido → 206 con Content-Range; rango fuera del archivo → 416", parcial.status === 206 && /^bytes 0-9\/\d+$/.test(parcial.headers.get("content-range") || "") && fuera.status === 416, `${parcial.status} ${parcial.headers.get("content-range")} ${fuera.status}`);
  const f = aid(Ui.revision_id);
  const ruta = path.join(sgcDir, ...String(f?.nombre_almacenado).split("/"));
  // El original vuelve a su lugar al terminar (la prueba de restauración verifica cada archivo).
  const original = fs.readFileSync(ruta);
  fs.appendFileSync(ruta, "alterado");
  let alt;
  try {
    alt = await fetch(`${process.env.BASE || "http://localhost:3100/api"}/sgc/archivos/${f.id}`, { headers: { Authorization: `Bearer ${t.ana}` } });
  } finally {
    fs.writeFileSync(ruta, original);
  }
  const alerta = fila("SELECT id FROM auditoria WHERE accion = 'alerta_integridad' AND entidad = 'sgc_documentos' AND entidad_id = ?", String(Ui.id));
  const inc = fila("SELECT id FROM incidencias WHERE clave_automatica = ?", `alerta_integridad:sgc:${f.id}:alterado`);
  check("[cob:D:V-047] SHA-256 distinto: se marca «alterado», queda la alerta en la bitácora y la incidencia automática", alt?.headers.get("x-integridad-archivo") === "alterado" && !!alerta && !!inc, `${alt?.status} ${alt?.headers.get("x-integridad-archivo")} ${!!alerta} ${!!inc}`);
}

/* ---------- Solicitudes ---------- */
{
  const nuevo = (extra = {}) => ({ tipo: "nuevo", area_codigo: "TC", tipo_codigo: "F", titulo_propuesto: `Formato propuesto ${s5}`, justificacion: "Se necesita registrar la temperatura del refrigerador", ...extra });
  const contar = () => Number(fila("SELECT COUNT(*) AS n FROM sgc_solicitudes WHERE titulo_propuesto = ?", `Formato propuesto ${s5}`)?.n);
  const dieg = await api("POST", "/sgc/solicitudes", nuevo(), t.diego);
  const hec = await api("POST", "/sgc/solicitudes", nuevo(), t.hector);
  check("[cob:D:V-050] proponer sin documento_proponer (estudiante, auditor) → 403", es(dieg, 403, { codigo: "sin_permiso" }) && es(hec, 403, { codigo: "sin_permiso" }), `${txt(dieg)} | ${txt(hec)}`);
  const casos = [
    ["V-051", "tipo distinto de nuevo/cambio → 400 campo tipo", nuevo({ tipo: "otro" }), t.luis, 400, { campo: "tipo" }],
    ["V-052", "justificación de menos de 10 caracteres → 400 campo justificacion", nuevo({ justificacion: "corta" }), t.luis, 400, { campo: "justificacion" }],
    ["V-053", "cambio sin documento → 400 campo documento", { tipo: "cambio", justificacion: "Cambio sin decir a qué documento" }, t.luis, 400, { campo: "documento" }],
    ["V-054", "cambio a un confidencial que no ve → 400 campo documento", { tipo: "cambio", documento_id: C.id, justificacion: "Cambio a la lista confidencial" }, t.mariana, 400, { campo: "documento" }],
    ["V-055", "cambio a un documento obsoleto → 409 campo documento", { tipo: "cambio", documento_id: O.id, justificacion: "Cambio al procedimiento retirado" }, t.ricardo, 409, { campo: "documento" }],
    ["V-056][cob:D:T-039", "cambio a un documento externo → 409 externo", { tipo: "cambio", documento_id: Ext.id, justificacion: "Cambio a la norma externa" }, t.luis, 409, { codigo: "externo" }],
    ["V-057", "nuevo con área inexistente → 400 campo area", nuevo({ area_codigo: "ZZ" }), t.luis, 400, { campo: "area" }],
    ["V-058", "nuevo con tipo documental inexistente → 400 campo tipo_documental", nuevo({ tipo_codigo: "Z" }), t.luis, 400, { campo: "tipo_documental" }],
    ["V-059", "nuevo sin título → 400 campo titulo", nuevo({ titulo_propuesto: "" }), t.luis, 400, { campo: "titulo" }],
  ];
  for (const [vid, nombre, body, token, status, extra] of casos) {
    const r = await api("POST", "/sgc/solicitudes", body, token);
    check(`[cob:D:${vid}] solicitud: ${nombre}`, es(r, status, extra), txt(r));
  }
  const exe = await api("POST", "/sgc/solicitudes", form(nuevo(), { archivo: [PDF, "macro.exe"] }), t.luis);
  const txtA = await api("POST", "/sgc/solicitudes", form(nuevo(), { archivo: [Buffer.from("notas sueltas"), "notas.txt"] }), t.luis);
  check("[cob:D:V-060] apoyo con extensión fuera de pdf/docx/xlsx/xls/pptx/png/jpg → 400 formato_no_permitido", es(exe, 400, { codigo: "formato_no_permitido" }) && es(txtA, 400, { codigo: "formato_no_permitido" }) && contar() === 0, `${txt(exe)} | ${txt(txtA)} ${contar()}`);
  const conDocx = await api("POST", "/sgc/solicitudes", form(nuevo({ titulo_propuesto: `Instructivo con apoyo ${s5}` }), { archivo: [docxSimple(), "borrador.docx"] }), t.luis);
  check("[cob:D:V-060] …un apoyo .docx sí se acepta", conDocx.status === 201, txt(conDocx));
  const sinApoyo = await api("POST", "/sgc/solicitudes", nuevo({ titulo_propuesto: `Formato sin apoyo ${s5}` }), t.luis);
  const ajena = await api("GET", `/sgc/solicitudes/${conDocx.data?.id}/apoyo`, undefined, t.mariana);
  const propia = await api("GET", `/sgc/solicitudes/${conDocx.data?.id}/apoyo`, undefined, t.luis);
  const vacia = await api("GET", `/sgc/solicitudes/${sinApoyo.data?.id}/apoyo`, undefined, t.luis);
  check("[cob:D:V-061] apoyo de una solicitud ajena → 404 (la propia → 200; sin apoyo → 404)", ajena.status === 404 && propia.status === 200 && vacia.status === 404, `${ajena.status} ${propia.status} ${vacia.status}`);

  const sid = sinApoyo.data?.id;
  const pend = () => fila("SELECT estado FROM sgc_solicitudes WHERE id = ?", sid)?.estado === "pendiente";
  const luisAcepta = await api("POST", `/sgc/solicitudes/${sid}/aceptar`, { clave: clave("TC", "F"), ...RESP }, t.luis);
  check("[cob:D:V-062] aceptar sin documento_crear_ficha → 403", es(luisAcepta, 403, { codigo: "sin_permiso" }) && pend(), txt(luisAcepta));
  const sinRev = await api("POST", `/sgc/solicitudes/${sid}/aceptar`, { clave: clave("TC", "F"), elaborador_id: id.luis, autorizador_id: id.patricia }, t.ana);
  check("[cob:D:V-069] aceptar sin revisor → 400 «Asigna al revisor»", es(sinRev, 400, { campo: "revisor" }) && pend(), txt(sinRev));
  const limite = await api("POST", `/sgc/solicitudes/${sid}/aceptar`, { clave: clave("TC", "F"), ...RESP, fecha_limite: enDias(-1) }, t.ana);
  check("[cob:D:V-070] aceptar con fecha límite de ayer → 400 campo fecha_limite", es(limite, 400, { campo: "fecha_limite" }) && pend(), txt(limite));
  const malClave = await api("POST", `/sgc/solicitudes/${sid}/aceptar`, { clave: "FORMATO-1", ...RESP }, t.ana);
  const repetida = await api("POST", `/sgc/solicitudes/${sid}/aceptar`, { clave: claveDe(U.id), tipo_codigo: "P", ...RESP }, t.ana);
  const sinTitulo = await api("POST", `/sgc/solicitudes/${sid}/aceptar`, { clave: clave("TC", "F"), titulo: "", ...RESP }, t.ana);
  check("[cob:D:V-071] aceptar «nuevo» con ficha inválida: clave sin formato 400, clave repetida 409, título vacío 400", es(malClave, 400, { campo: "clave" }) && es(repetida, 409, { codigo: "clave_repetida" }) && es(sinTitulo, 400, { campo: "titulo" }) && pend(), `${txt(malClave)} | ${txt(repetida)} | ${txt(sinTitulo)}`);
  const motivoCorto = await api("POST", `/sgc/solicitudes/${sid}/rechazar`, { motivo: "no" }, t.ana);
  check("[cob:D:V-072] rechazar con motivo de menos de 5 caracteres → 400 campo motivo", es(motivoCorto, 400, { campo: "motivo" }) && pend(), txt(motivoCorto));
  const rech = await api("POST", `/sgc/solicitudes/${sid}/rechazar`, { motivo: "Ya existe un formato equivalente" }, t.ana);
  const otraVez = await api("POST", `/sgc/solicitudes/${sid}/aceptar`, { clave: clave("TC", "F"), ...RESP }, t.ana);
  const otraRech = await api("POST", `/sgc/solicitudes/${sid}/rechazar`, { motivo: "Segundo rechazo" }, t.ana);
  check("[cob:D:V-063] aceptar o rechazar una solicitud que ya no está pendiente → 409", rech.status === 200 && otraVez.status === 409 && otraRech.status === 409, `${rech.status} ${txt(otraVez)} | ${txt(otraRech)}`);

  const enCurso = await api("POST", "/sgc/solicitudes", { tipo: "cambio", documento_id: U.id, justificacion: "Cambio mientras hay otra revisión" }, t.luis);
  const ac1 = await api("POST", `/sgc/solicitudes/${enCurso.data?.id}/aceptar`, RESP, t.ana);
  check("[cob:D:V-064] aceptar un cambio con una revisión en curso → 409 revision_en_curso", enCurso.status === 201 && es(ac1, 409, { codigo: "revision_en_curso" }), `${enCurso.status} ${txt(ac1)}`);
  await api("POST", `/sgc/solicitudes/${enCurso.data?.id}/rechazar`, { motivo: "Ya hay una revisión en curso" }, t.ana);
  const ac2 = await api("POST", `/sgc/solicitudes/${solO.data?.id}/aceptar`, RESP, t.ana);
  check("[cob:D:V-065] aceptar un cambio de un documento que quedó obsoleto → 409 (sin revisión nueva)", ac2.status === 409 && Number(fila("SELECT COUNT(*) AS n FROM sgc_revisiones WHERE documento_id = ?", O.id)?.n) === 1, txt(ac2));
  await api("POST", `/sgc/solicitudes/${solO.data?.id}/rechazar`, { motivo: "El documento ya es obsoleto" }, t.ana);
  // Una solicitud de cambio a un externo ya no se puede crear por la API (V-056): se siembra como dato heredado.
  const sem = ejecutar("INSERT INTO sgc_solicitudes (tipo, documento_id, area_codigo, tipo_codigo, titulo_propuesto, justificacion, solicitante_id, estado, creado_en) VALUES ('cambio', ?, 'GC', 'R', 'Norma heredada', 'Solicitud heredada de cambio a un externo', ?, 'pendiente', ?)", Ext.id, id.luis, new Date().toISOString());
  const sidExt = Number(sem.lastInsertRowid);
  const ac3 = await api("POST", `/sgc/solicitudes/${sidExt}/aceptar`, RESP, t.ana);
  check("[cob:D:V-066][cob:D:T-039] aceptar un cambio heredado a un externo → 409 externo (sin revisión interna)", es(ac3, 409, { codigo: "externo" }) && Number(fila("SELECT COUNT(*) AS n FROM sgc_revisiones WHERE documento_id = ?", Ext.id)?.n) === 1, txt(ac3));
  await api("POST", `/sgc/solicitudes/${sidExt}/rechazar`, { motivo: "Los externos no pasan por el flujo" }, t.ana);
}

/* ---------- Nueva revisión directa ---------- */
{
  const ext = await api("POST", `/sgc/documentos/${Ext.id}/revisiones`, { motivo_cambio: "Revisión interna de una norma", ...RESP }, t.ana);
  check("[cob:D:V-073][cob:D:T-039] nueva revisión de un externo → 409 externo", es(ext, 409, { codigo: "externo" }), txt(ext));
  const corto = await api("POST", `/sgc/documentos/${U4.id}/revisiones`, { motivo_cambio: "ab", ...RESP }, t.ana);
  check("[cob:D:V-074] nueva revisión con motivo de menos de 5 caracteres → 400 campo motivo_cambio", es(corto, 400, { campo: "motivo_cambio" }) && Number(fila("SELECT COUNT(*) AS n FROM sgc_revisiones WHERE documento_id = ?", U4.id)?.n) === 1, txt(corto));
}

/* ---------- Revisar y autorizar ---------- */
{
  const ric = await api("POST", `/sgc/revisiones/${R2}/revisar`, { decision: "aceptar" }, t.ricardo);
  const hec = await api("POST", `/sgc/revisiones/${R2}/revisar`, { decision: "aceptar" }, t.hector);
  check("[cob:D:V-075] revisar sin ser el revisor asignado → 403 segregación; sin documento_revisar → 403 sin_permiso", es(ric, 403, { codigo: "segregacion", regla: 11 }) && es(hec, 403, { codigo: "sin_permiso" }) && estadoRev(R2) === "en_revision", `${txt(ric)} | ${txt(hec)}`);
  // Revisor y autorizador la misma persona no se puede asignar por la API: se siembra para probar la defensa del paso.
  const T = await ficha({ titulo: `Tres personas ${s5}` });
  await aEnRevision(T.revision_id, false);
  ejecutar("UPDATE sgc_revisiones SET autorizador_id = ? WHERE id = ?", id.gabriela, T.revision_id);
  const tres = await api("POST", `/sgc/revisiones/${T.revision_id}/revisar`, { decision: "aceptar" }, t.gabriela);
  ejecutar("UPDATE sgc_revisiones SET autorizador_id = ? WHERE id = ?", id.patricia, T.revision_id);
  check("[cob:D:V-075] revisor y autorizador la misma persona → 409 segregación regla 11", es(tres, 409, { codigo: "segregacion", regla: 11 }) && estadoRev(T.revision_id) === "en_revision", txt(tres));
  const borr = await api("POST", `/sgc/revisiones/${N.revision_id}/revisar`, { decision: "aceptar" }, t.gabriela);
  check("[cob:D:V-076] revisar una revisión en borrador → 409 estado", es(borr, 409, { codigo: "estado" }), txt(borr));
  const dec = await api("POST", `/sgc/revisiones/${R2}/revisar`, { decision: "quizas" }, t.gabriela);
  check("[cob:D:V-077] decisión del revisor fuera de aceptar/devolver/rechazar → 400 campo decision", es(dec, 400, { campo: "decision" }), txt(dec));
  const dev = await api("POST", `/sgc/revisiones/${R2}/revisar`, { decision: "devolver", comentario: "ok" }, t.gabriela);
  const rech = await api("POST", `/sgc/revisiones/${R2}/revisar`, { decision: "rechazar" }, t.gabriela);
  check("[cob:D:V-078] devolver o rechazar con comentario de menos de 5 caracteres → 400 campo comentario", es(dev, 400, { campo: "comentario" }) && es(rech, 400, { campo: "comentario" }) && estadoRev(R2) === "en_revision", `${txt(dev)} | ${txt(rech)}`);
  const acepta = await api("POST", `/sgc/revisiones/${R2}/revisar`, { decision: "aceptar" }, t.gabriela);
  const decA = await api("POST", `/sgc/revisiones/${R2}/autorizar`, { decision: "aceptar" }, t.patricia);
  const devA = await api("POST", `/sgc/revisiones/${R2}/autorizar`, { decision: "devolver", comentario: "no" }, t.patricia);
  check("[cob:D:V-079][cob:D:V-078] autorizar: decisión fuera de autorizar/devolver/rechazar → 400; devolver sin comentario → 400", acepta.status === 200 && es(decA, 400, { campo: "decision" }) && es(devA, 400, { campo: "comentario" }) && estadoRev(R2) === "en_autorizacion", `${acepta.status} ${txt(decA)} | ${txt(devA)}`);
  const aut = await api("POST", `/sgc/revisiones/${R2}/autorizar`, { decision: "autorizar" }, t.patricia);
  check("(preparación) revisión 2 autorizada", aut.status === 200 && estadoRev(R2) === "autorizada", txt(aut));
}

/* ---------- Publicar ---------- */
{
  const ric = await api("POST", `/sgc/revisiones/${R2}/publicar`, {}, t.ricardo);
  check("[cob:D:V-081] publicar sin documento_publicar → 403", es(ric, 403, { codigo: "sin_permiso" }), txt(ric));
  const borr = await api("POST", `/sgc/revisiones/${N.revision_id}/publicar`, {}, t.ana);
  check("[cob:D:V-082] publicar una revisión que no está autorizada → 409 estado", es(borr, 409, { codigo: "estado" }), txt(borr));
  const vig = await api("POST", `/sgc/revisiones/${R2}/publicar`, { fecha_emision: enDias(0), fecha_vigencia: enDias(-1) }, t.ana);
  check("[cob:D:V-085] vigencia anterior a la emisión → 400 campo fecha_vigencia", es(vig, 400, { campo: "fecha_vigencia" }), txt(vig));
  const prox = await api("POST", `/sgc/revisiones/${R2}/publicar`, { fecha_emision: hoy(), fecha_proxima_revision: hoy() }, t.ana);
  check("[cob:D:V-086] próxima revisión igual a la vigencia → 400 campo fecha_proxima_revision", es(prox, 400, { campo: "fecha_proxima_revision" }), txt(prox));
  const dist = await api("POST", `/sgc/revisiones/${R2}/publicar`, { distribucion: { usuarios: [id.mariana], requiere_lectura: true } }, publicadora.token);
  check("[cob:D:V-087] publicar con distribución sin documento_administrar_lecturas → 403", es(dist, 403, { codigo: "sin_permiso" }) && estadoRev(R2) === "autorizada", txt(dist));
  const sinReauth = await api("POST", `/sgc/revisiones/${R2}/publicar`, {}, t.ana, SIN_REAUTH);
  check("[cob:D:V-088] publicar sin contraseña → 401 reauth_required documentos:publicar (sigue autorizada)", es(sinReauth, 401, { codigo: "reauth_required", accion: "documentos:publicar" }) && estadoRev(R2) === "autorizada", txt(sinReauth));
  const pub = await api("POST", `/sgc/revisiones/${R2}/publicar`, {}, t.ana);
  const ant = fila("SELECT estado, sustituida_por_id, fecha_obsolescencia FROM sgc_revisiones WHERE id = ?", U.revision_id);
  check("[cob:D:T-017] al publicar, la vigente anterior queda obsoleta, sustituida por la nueva y con fecha de obsolescencia", pub.status === 200 && ant?.estado === "obsoleta" && Number(ant?.sustituida_por_id) === R2 && !!ant?.fecha_obsolescencia && estadoRev(R2) === "vigente", `${txt(pub)} ${JSON.stringify(ant)}`);
  const copia = fila("SELECT requiere_lectura FROM sgc_distribucion WHERE revision_id = ? AND usuario_id = ? AND retirado_en IS NULL", R2, id.luis);
  check("[cob:D:T-031] publicar sin distribución propia copia la de la revisión anterior (con lectura requerida)", Number(copia?.requiere_lectura) === 1, JSON.stringify(copia));

  // Defensas del paso que la API no deja alcanzar: autorizada sin PDF, y autorizada sin revisión registrada.
  const sinPdf = await ficha({ titulo: `Sin PDF ${s5}` });
  const pdfId = fila("SELECT id FROM sgc_archivos WHERE revision_id = ?", sinPdf.revision_id)?.id;
  ejecutar("UPDATE sgc_archivos SET reemplazado_en = ? WHERE id = ?", new Date().toISOString(), pdfId);
  ejecutar("UPDATE sgc_revisiones SET estado = 'autorizada', revisada_en = ?, autorizada_en = ? WHERE id = ?", new Date().toISOString(), new Date().toISOString(), sinPdf.revision_id);
  const p1 = await api("POST", `/sgc/revisiones/${sinPdf.revision_id}/publicar`, {}, t.ana);
  ejecutar("UPDATE sgc_revisiones SET estado = 'borrador', revisada_en = NULL, autorizada_en = NULL WHERE id = ?", sinPdf.revision_id);
  ejecutar("UPDATE sgc_archivos SET reemplazado_en = NULL WHERE id = ?", pdfId);
  check("[cob:D:V-083] publicar una autorizada sin PDF de consulta → 409", p1.status === 409 && /PDF/.test(p1.data?.message || ""), txt(p1));
  const sinRev = await ficha({ titulo: `Sin revisión registrada ${s5}` });
  ejecutar("UPDATE sgc_revisiones SET estado = 'autorizada', autorizada_en = ? WHERE id = ?", new Date().toISOString(), sinRev.revision_id);
  const p2 = await api("POST", `/sgc/revisiones/${sinRev.revision_id}/publicar`, {}, t.ana);
  ejecutar("UPDATE sgc_revisiones SET estado = 'borrador', autorizada_en = NULL WHERE id = ?", sinRev.revision_id);
  check("[cob:D:V-084] publicar sin revisión ni autorización completas → 409", p2.status === 409 && /completas/.test(p2.data?.message || ""), txt(p2));

  const P1 = await ficha({ titulo: `Primera emisión por flujo ${s5}` });
  const antes = fila("SELECT estado FROM sgc_documentos WHERE id = ?", P1.id)?.estado;
  await aAutorizada(P1.revision_id, false);
  const pubP1 = await api("POST", `/sgc/revisiones/${P1.revision_id}/publicar`, {}, t.ana);
  const doc = fila("SELECT estado, revision_vigente_id FROM sgc_documentos WHERE id = ?", P1.id);
  check("[cob:D:T-018] publicar la primera revisión pasa el documento de en_elaboracion a vigente", antes === "en_elaboracion" && pubP1.status === 200 && doc?.estado === "vigente" && Number(doc?.revision_vigente_id) === P1.revision_id, `${antes} ${txt(pubP1)} ${JSON.stringify(doc)}`);
  const docU = fila("SELECT estado, revision_vigente_id FROM sgc_documentos WHERE id = ?", U.id);
  check("[cob:D:T-018] …y en la carga inicial también (y una segunda publicación mueve la vigente)", fila("SELECT estado FROM sgc_documentos WHERE id = ?", U4.id)?.estado === "vigente" && docU?.estado === "vigente" && Number(docU?.revision_vigente_id) === R2, JSON.stringify(docU));
}

/* ---------- Reasignar ---------- */
{
  const R4 = await nuevaRev(U4.id);
  globalThis.R4 = R4;
  const ric = await api("POST", `/sgc/revisiones/${R4}/reasignar`, { revisor_id: id.ricardo, motivo: "Reasignación ajena" }, t.ricardo);
  check("[cob:D:V-089] reasignar sin documento_crear_ficha → 403", es(ric, 403, { codigo: "sin_permiso" }), txt(ric));
  const corto = await api("POST", `/sgc/revisiones/${R4}/reasignar`, { revisor_id: id.ricardo, motivo: "x" }, t.ana);
  check("[cob:D:V-091] reasignar con motivo de menos de 5 caracteres → 400 campo motivo", es(corto, 400, { campo: "motivo" }), txt(corto));
  const sinElab = await api("POST", `/sgc/revisiones/${R4}/reasignar`, { elaborador_id: "", motivo: "Quitar al elaborador" }, t.ana);
  check("[cob:D:V-092] reasignar dejando sin elaborador → 400 campo elaborador", es(sinElab, 400, { campo: "elaborador" }), txt(sinElab));
  const pasada = await api("POST", `/sgc/revisiones/${R4}/reasignar`, { revisor_id: id.ricardo, fecha_limite: enDias(-2), motivo: "Cambio de revisor con fecha pasada" }, t.ana);
  check("[cob:D:V-094] reasignar con una fecha límite nueva ya pasada → 400 campo fecha_limite", es(pasada, 400, { campo: "fecha_limite" }), txt(pasada));
  const igual = await api("POST", `/sgc/revisiones/${R4}/reasignar`, { ...RESP, motivo: "Sin ningún cambio" }, t.ana);
  check("[cob:D:V-095] reasignar sin cambiar nada → 400 «No cambiaste…»", igual.status === 400 && /No cambiaste/.test(igual.data?.message || ""), txt(igual));
  const vig = await api("POST", `/sgc/revisiones/${R2}/reasignar`, { revisor_id: id.ricardo, motivo: "Reasignar una vigente" }, t.ana);
  check("[cob:D:V-090] reasignar una revisión vigente → 409 estado", es(vig, 409, { codigo: "estado" }), txt(vig));
  const ok = await api("POST", `/sgc/revisiones/${R4}/reasignar`, { revisor_id: id.ricardo, motivo: "Gabriela está de vacaciones" }, t.ana);
  check("[cob:D:V-089] …Mejora Continua sí reasigna", ok.status === 200 && Number(fila("SELECT revisor_id FROM sgc_revisiones WHERE id = ?", R4)?.revisor_id) === id.ricardo, txt(ok));
}
const R4 = globalThis.R4;

/* ---------- Renovar sin cambios ---------- */
{
  const pendiente = { fecha_emision: "2023-06-01", fecha_proxima_revision: enDias(10) };
  const Vr = await vigente({ titulo: `Renovación ${s5}` }, pendiente);
  const Vr2 = await vigente({ titulo: `Renovación con revisión ${s5}` }, pendiente);
  await nuevaRev(Vr2.id);
  const Vr3 = await vigente({ titulo: `Renovación con obsolescencia ${s5}` }, pendiente);
  const obs3 = await obsoletarDoc(Vr3.id, SIN_APROBAR);
  check("(preparación) vigentes pendientes de revisión", Vr.ok && Vr2.ok && Vr3.ok && obs3.status === 202, `${Vr.ok} ${Vr2.ok} ${Vr3.ok} ${txt(obs3)}`);
  const ren = (docId, body, token = t.ana, headers = {}) => api("POST", `/sgc/documentos/${docId}/renovar`, body, token, headers);
  const okBody = { revisor_id: id.gabriela, autorizador_id: id.patricia };
  const ric = await ren(Vr.id, okBody, t.ricardo);
  check("[cob:D:V-096] renovar sin documento_crear_ficha → 403", es(ric, 403, { codigo: "sin_permiso" }), txt(ric));
  const ext = await ren(Ext.id, okBody);
  check("[cob:D:V-097][cob:D:T-039] renovar un externo → 409 externo", es(ext, 409, { codigo: "externo" }), txt(ext));
  const sinVig = await ren(N.id, okBody);
  check("[cob:D:V-098] renovar un documento sin revisión vigente → 409", sinVig.status === 409, txt(sinVig));
  const lejos = await ren(Ui.id, okBody);
  check("[cob:D:V-099] renovar uno que no está pendiente de revisión → 409 no_pendiente", es(lejos, 409, { codigo: "no_pendiente" }), txt(lejos));
  const enCurso = await ren(Vr2.id, okBody);
  check("[cob:D:V-100] renovar con una revisión en curso → 409 revision_en_curso", es(enCurso, 409, { codigo: "revision_en_curso" }), txt(enCurso));
  const conObs = await ren(Vr3.id, okBody);
  check("[cob:D:V-102] renovar con la obsolescencia pendiente → 409 solicitud_pendiente", es(conObs, 409, { codigo: "solicitud_pendiente" }), txt(conObs));
  const rechObs = await api("POST", `/solicitudes/${obs3.data?.solicitud?.id}/rechazar`, { motivo: "Se decide conservar el documento" }, t.patricia);
  check("[cob:D:T-028] la obsolescencia pendiente → rechazada por el segundo usuario (el documento sigue vigente)", rechObs.status === 200 && solicitudObs(Vr3.id)?.estado === "rechazada" && fila("SELECT estado FROM sgc_documentos WHERE id = ?", Vr3.id)?.estado === "vigente", txt(rechObs));
  const sinRev = await ren(Vr.id, { autorizador_id: id.patricia });
  check("[cob:D:V-103] renovar sin revisor → 400 campo revisor", es(sinRev, 400, { campo: "revisor" }), txt(sinRev));
  const sinAut = await ren(Vr.id, { revisor_id: id.gabriela });
  check("[cob:D:V-104] renovar sin autorizador → 400 campo autorizador", es(sinAut, 400, { campo: "autorizador" }), txt(sinAut));
  const misma = await ren(Vr.id, { revisor_id: id.ricardo, autorizador_id: id.ricardo });
  const sinPapel = await ren(Vr.id, { revisor_id: id.diego, autorizador_id: id.patricia });
  check("[cob:D:V-105] renovar con revisor = autorizador (400 regla 11) o revisor sin permiso (400)", es(misma, 400, { codigo: "segregacion", regla: 11 }) && es(sinPapel, 400, { campo: "revisor" }), `${txt(misma)} | ${txt(sinPapel)}`);
  const proxHoy = await ren(Vr.id, { ...okBody, fecha_proxima_revision: hoy() });
  check("[cob:D:V-106] renovar con la nueva próxima revisión hoy → 400 campo fecha_proxima_revision", es(proxHoy, 400, { campo: "fecha_proxima_revision" }), txt(proxHoy));
  const limite = await ren(Vr.id, { ...okBody, fecha_limite: enDias(-1) });
  check("[cob:D:V-107] renovar con fecha límite de ayer → 400 campo fecha_limite (y no se creó ninguna renovación)", es(limite, 400, { campo: "fecha_limite" }) && Number(fila("SELECT COUNT(*) AS n FROM sgc_renovaciones WHERE documento_id = ?", Vr.id)?.n) === 0, txt(limite));
  const inicia = await ren(Vr.id, { ...okBody, fecha_proxima_revision: enDias(1000) });
  const nid = inicia.data?.id;
  const dos = await ren(Vr.id, okBody);
  check("[cob:D:V-101] renovar con otra renovación en curso → 409 renovacion_en_curso", inicia.status === 201 && es(dos, 409, { codigo: "renovacion_en_curso" }), `${txt(inicia)} | ${txt(dos)}`);
  const sol = await api("POST", "/sgc/solicitudes", { tipo: "cambio", documento_id: Vr.id, justificacion: "Cambio durante la renovación" }, t.luis);
  const acepta = await api("POST", `/sgc/solicitudes/${sol.data?.id}/aceptar`, RESP, t.ana);
  check("[cob:D:V-067] aceptar un cambio con una renovación en curso → 409 renovacion_en_curso", sol.status === 201 && es(acepta, 409, { codigo: "renovacion_en_curso" }), `${sol.status} ${txt(acepta)}`);
  await api("POST", `/sgc/solicitudes/${sol.data?.id}/rechazar`, { motivo: "Hay una renovación en curso" }, t.ana);

  const rv = (body, token) => api("POST", `/sgc/renovaciones/${nid}/revisar`, body, token);
  const au = (body, token, headers = {}) => api("POST", `/sgc/renovaciones/${nid}/autorizar`, body, token, headers);
  const estadoRen = () => fila("SELECT estado FROM sgc_renovaciones WHERE id = ?", nid)?.estado;
  const hec = await rv({ decision: "confirmar", comentario: "Sigue vigente" }, t.hector);
  check("[cob:D:V-108] confirmar la renovación sin documento_revisar → 403 sin_permiso", es(hec, 403, { codigo: "sin_permiso" }), txt(hec));
  const ric2 = await rv({ decision: "confirmar", comentario: "Sigue vigente" }, t.ricardo);
  check("[cob:D:V-109] confirmar la renovación sin ser el revisor asignado → 403 segregación", es(ric2, 403, { codigo: "segregacion", regla: 11 }), txt(ric2));
  const dec = await rv({ decision: "aceptar", comentario: "Sigue vigente" }, t.gabriela);
  check("[cob:D:V-111] decisión del revisor de la renovación fuera de confirmar/rechazar → 400 campo decision", es(dec, 400, { campo: "decision" }), txt(dec));
  const sinCom = await rv({ decision: "confirmar" }, t.gabriela);
  check("[cob:D:V-112] confirmar la vigencia sin comentario → 400 campo comentario", es(sinCom, 400, { campo: "comentario" }) && estadoRen() === "en_revision", txt(sinCom));
  const antesDeTiempo = await au({ decision: "autorizar" }, t.patricia);
  const conf = await rv({ decision: "confirmar", comentario: "El método sigue vigente sin cambios" }, t.gabriela);
  const otraVez = await rv({ decision: "confirmar", comentario: "Otra confirmación" }, t.gabriela);
  check("[cob:D:V-110] confirmar una renovación que ya no espera al revisor → 409", conf.status === 200 && otraVez.status === 409, `${txt(conf)} | ${txt(otraVez)}`);
  const decA = await au({ decision: "x" }, t.patricia);
  const ricA = await au({ decision: "autorizar" }, t.ricardo);
  const gabA = await au({ decision: "autorizar" }, t.gabriela);
  const rechA = await au({ decision: "rechazar" }, t.patricia);
  check("[cob:D:V-113] autorizar la renovación: estado (409), decisión (400), papel (403 segregación), sin documento_autorizar (403), rechazo sin comentario (400)", antesDeTiempo.status === 409 && es(decA, 400, { campo: "decision" }) && es(ricA, 403, { codigo: "segregacion" }) && es(gabA, 403, { codigo: "sin_permiso" }) && es(rechA, 400, { campo: "comentario" }) && estadoRen() === "en_autorizacion", [antesDeTiempo, decA, ricA, gabA, rechA].map(txt).join(" | "));
  const sinReauth = await au({ decision: "autorizar" }, t.patricia, SIN_REAUTH);
  check("[cob:D:V-114] autorizar la renovación sin contraseña → 401 reauth_required documentos:autorizar", es(sinReauth, 401, { codigo: "reauth_required", accion: "documentos:autorizar" }) && estadoRen() === "en_autorizacion", txt(sinReauth));
  const fin = await au({ decision: "autorizar" }, t.patricia);
  check("[cob:D:V-114] …con contraseña se renueva y cambia la próxima revisión", fin.status === 200 && estadoRen() === "completada" && fila("SELECT fecha_proxima_revision AS f FROM sgc_revisiones WHERE id = ?", Vr.revision_id)?.f === enDias(1000), txt(fin));
}

/* ---------- Obsoletar ---------- */
{
  const ric = await api("POST", `/sgc/documentos/${U.id}/obsoletar`, { motivo: "Retiro ajeno" }, t.ricardo);
  check("[cob:D:V-115] obsoletar sin documento_obsoletar → 403", es(ric, 403, { codigo: "sin_permiso" }), txt(ric));
  const corto = await api("POST", `/sgc/documentos/${U.id}/obsoletar`, { motivo: "x" }, t.ana);
  check("[cob:D:V-117] obsoletar con motivo de menos de 5 caracteres → 400 campo motivo", es(corto, 400, { campo: "motivo" }), txt(corto));
  const sinReauth = await api("POST", `/sgc/documentos/${U.id}/obsoletar`, { motivo: "Retiro sin contraseña" }, t.ana, SIN_REAUTH);
  check("[cob:D:V-118] obsoletar sin contraseña → 401 reauth_required documentos:obsoletar (sin solicitud)", es(sinReauth, 401, { codigo: "reauth_required", accion: "documentos:obsoletar" }) && !solicitudObs(U.id), txt(sinReauth));
  const ya = await api("POST", `/sgc/documentos/${O.id}/obsoletar`, { motivo: "Retirar otra vez" }, t.ana);
  check("[cob:D:V-116] obsoletar un documento ya obsoleto → 409", ya.status === 409, txt(ya));
  const canc = await obsoletarDoc(Ui.id, SIN_APROBAR);
  const cancR = await api("POST", `/solicitudes/${canc.data?.solicitud?.id}/cancelar`, { motivo: "Me equivoqué de documento" }, t.ana);
  check("[cob:D:T-028] la obsolescencia pendiente → cancelada por quien la pidió (el documento sigue vigente)", canc.status === 202 && cancR.status === 200 && solicitudObs(Ui.id)?.estado === "cancelada" && fila("SELECT estado FROM sgc_documentos WHERE id = ?", Ui.id)?.estado === "vigente", `${txt(canc)} | ${txt(cancR)}`);
  const venc = await obsoletarDoc(U2.id, SIN_APROBAR);
  ejecutar("UPDATE solicitudes_autorizacion SET vence_en = ? WHERE id = ?", new Date(Date.now() - 60_000).toISOString(), venc.data?.solicitud?.id);
  await api("GET", "/solicitudes", undefined, t.ana);
  check("[cob:D:T-028] la obsolescencia pendiente → vencida al pasar su plazo (el documento sigue vigente)", venc.status === 202 && solicitudObs(U2.id)?.estado === "vencida" && fila("SELECT estado FROM sgc_documentos WHERE id = ?", U2.id)?.estado === "vigente", `${txt(venc)} ${solicitudObs(U2.id)?.estado}`);
}

/* ---------- Distribución y lecturas ---------- */
{
  const Dl = await vigente({ titulo: `Instructivo distribuido ${s5}`, tipo_codigo: "I" });
  const rid = Dl.revision_id;
  const dist = (body, token = t.ana, headers = {}) => api("POST", `/sgc/revisiones/${rid}/distribucion`, { motivo: "Distribución de cobertura", ...body }, token, headers);
  const filasDist = () => Number(fila("SELECT COUNT(*) AS n FROM sgc_distribucion WHERE revision_id = ?", rid)?.n);
  const ric = await dist({ usuarios: [id.luis] }, t.ricardo);
  check("[cob:D:V-120] distribuir sin documento_administrar_lecturas → 403", es(ric, 403, { codigo: "sin_permiso" }), txt(ric));
  const borr = await api("POST", `/sgc/revisiones/${R4}/distribucion`, { usuarios: [id.luis], motivo: "Distribuir un borrador" }, t.ana);
  check("[cob:D:V-121] distribuir una revisión que no es la vigente → 409", borr.status === 409, txt(borr));
  const jorge = await dist({ usuarios: [id.jorge] });
  const inex = await dist({ usuarios: [99999999] });
  const rolAdmin = await dist({ roles: [rolDe("admin_tecnico", "Administrador técnico del sistema")] });
  const hecLect = await dist({ usuarios: [id.hector], requiere_lectura: true });
  const nada = await dist({});
  check("[cob:D:V-122] destinatarios inválidos (sin consulta, inexistente, rol sin consulta, lectura sin acuse, ninguno) → 400", es(jorge, 400, { campo: "usuarios" }) && es(inex, 400, { campo: "usuarios" }) && es(rolAdmin, 400, { campo: "roles" }) && es(hecLect, 400, { campo: "usuarios" }) && es(nada, 400, { campo: "destinatarios" }) && filasDist() === 0, [jorge, inex, rolAdmin, hecLect, nada].map(txt).join(" | "));
  const corto = await dist({ usuarios: [id.luis], motivo: "x" });
  check("[cob:D:V-123] distribuir con motivo de menos de 5 caracteres → 400 campo motivo", es(corto, 400, { campo: "motivo" }), txt(corto));
  const sinReauth = await dist({ usuarios: [id.luis] }, t.ana, SIN_REAUTH);
  check("[cob:D:V-124] distribuir sin contraseña → 401 reauth_required documentos:distribucion (sin filas)", es(sinReauth, 401, { codigo: "reauth_required", accion: "documentos:distribucion" }) && filasDist() === 0, txt(sinReauth));
  const ok = await dist({ usuarios: [id.luis, id.mariana], requiere_lectura: true });
  const dMar = fila("SELECT id FROM sgc_distribucion WHERE revision_id = ? AND usuario_id = ?", rid, id.mariana)?.id;
  const retInex = await api("POST", "/sgc/distribucion/99999999/retirar", { motivo: "Retirar a nadie" }, t.ana);
  check("[cob:D:V-125] retirar un destinatario inexistente → 404", ok.status === 201 && retInex.status === 404, `${txt(ok)} | ${txt(retInex)}`);
  const retCorto = await api("POST", `/sgc/distribucion/${dMar}/retirar`, { motivo: "x" }, t.ana);
  check("[cob:D:V-126] retirar con motivo de menos de 5 caracteres → 400 campo motivo", es(retCorto, 400, { campo: "motivo" }), txt(retCorto));
  const retReauth = await api("POST", `/sgc/distribucion/${dMar}/retirar`, { motivo: "Mariana cambió de área" }, t.ana, SIN_REAUTH);
  check("[cob:D:V-127] retirar sin contraseña → 401 reauth_required (sigue en la distribución)", es(retReauth, 401, { codigo: "reauth_required" }) && !fila("SELECT retirado_en FROM sgc_distribucion WHERE id = ?", dMar)?.retirado_en, txt(retReauth));
  const ret = await api("POST", `/sgc/distribucion/${dMar}/retirar`, { motivo: "Mariana cambió de área" }, t.ana);
  const record = await api("POST", `/sgc/revisiones/${rid}/recordatorio`, {}, t.ana);
  const hec = await api("POST", `/sgc/revisiones/${rid}/acusar`, {}, t.hector);
  check("[cob:D:V-129] confirmar la lectura sin documento_acusar_lectura → 403", ret.status === 200 && record.status === 200 && es(hec, 403, { codigo: "sin_permiso" }), `${ret.status} ${record.status} ${txt(hec)}`);
  const aid = fila("SELECT id FROM sgc_archivos WHERE revision_id = ? AND tipo = 'pdf'", rid)?.id;
  const abre = await api("GET", `/sgc/archivos/${aid}`, undefined, t.luis);
  const acusa = await api("POST", `/sgc/revisiones/${rid}/acusar`, {}, t.luis);
  const otra = await api("POST", `/sgc/revisiones/${rid}/acusar`, {}, t.luis);
  check("[cob:D:V-131] confirmar dos veces la misma lectura → 409 ya_leido", abre.status === 200 && acusa.status === 200 && es(otra, 409, { codigo: "ya_leido" }), `${abre.status} ${txt(acusa)} | ${txt(otra)}`);
  const sinPend = await api("POST", `/sgc/revisiones/${rid}/recordatorio`, {}, t.ana);
  check("[cob:D:V-128] recordatorio sin lecturas pendientes → 409", sinPend.status === 409, txt(sinPend));
}

/* ---------- Documentos externos ---------- */
{
  const crea = (cambio, headers = {}) => api("POST", "/sgc/externos", { ...baseExterno(), ...cambio }, t.ana, headers);
  const luis = await api("POST", "/sgc/externos", baseExterno(), t.luis);
  check("[cob:D:V-142] registrar un externo sin documento_externo_gestionar → 403", es(luis, 403, { codigo: "sin_permiso" }), txt(luis));
  const casos = [
    ["V-143", "identificador con el prefijo FX- → 400 campo clave", { identificador: `FX-NORMA-${s5}` }, { campo: "clave" }],
    ["V-143", "identificador con caracteres no admitidos → 400 campo clave", { identificador: `NMX#${s5}` }, { campo: "clave" }],
    ["V-134", "sin fuente → 400 campo fuente", { fuente: "" }, { campo: "fuente" }],
    ["V-135", "sin versión o fecha de edición → 400 campo version_fecha", { version_fecha: "" }, { campo: "version_fecha" }],
    ["V-136", "enlace ftp:// → 400 campo enlace", { enlace: "ftp://normas.mx/nmx.pdf" }, { campo: "enlace" }],
    ["V-136", "enlace javascript: → 400 campo enlace", { enlace: "javascript:alert(1)" }, { campo: "enlace" }],
    ["V-137", "última verificación futura → 400 campo ultima_verificacion", { ultima_verificacion: enDias(1) }, { campo: "ultima_verificacion" }],
    ["V-138", "sin próxima revisión → 400 campo proxima_revision", { proxima_revision: "" }, { campo: "proxima_revision" }],
    ["V-139", "próxima revisión igual a la última verificación → 400 campo proxima_revision", { ultima_verificacion: enDias(-5), proxima_revision: enDias(-5) }, { campo: "proxima_revision" }],
    ["V-140", "sin responsable → 400 campo responsable", { responsable_id: "" }, { campo: "responsable" }],
    ["V-140", "responsable con la cuenta dada de baja → 400 campo responsable", { responsable_id: inactiva }, { campo: "responsable" }],
  ];
  for (const [vid, nombre, cambio, extra] of casos) {
    const r = await crea(cambio);
    check(`[cob:D:${vid}] externo: ${nombre}`, es(r, 400, extra), txt(r));
  }
  const docx = await api("POST", "/sgc/externos", form(baseExterno(), { archivo_pdf: [docxSimple(), "norma.docx"] }), t.ana);
  check("[cob:D:V-133] externo con archivo que no es PDF → 400 formato_no_permitido", es(docx, 400, { codigo: "formato_no_permitido" }), txt(docx));
  const identSin = `NMX-SIN-${s5}`;
  const sinReauth = await crea({ identificador: identSin }, SIN_REAUTH);
  check("[cob:D:V-144] registrar un externo sin contraseña → 401 reauth_required documentos:externo (y no se registró)", es(sinReauth, 401, { codigo: "reauth_required", accion: "documentos:externo" }) && !fila("SELECT id FROM sgc_documentos WHERE clave = ?", identSin), txt(sinReauth));
  const base = baseExterno();
  const E = await externo(base);
  const rep = await crea({ identificador: base.identificador.toLowerCase() });
  check("[cob:D:V-143] identificador repetido (sin distinguir mayúsculas) → 409 clave_repetida", E.status === 201 && es(rep, 409, { codigo: "clave_repetida" }), `${txt(E)} | ${txt(rep)}`);
  const eid = E.data?.id;
  const verInt = await api("POST", `/sgc/externos/${U.id}/verificar`, { comentario: "Sigue vigente", proxima_revision: enDias(200) }, t.ana);
  const putInt = await api("PUT", `/sgc/externos/${U.id}`, { fuente: "Otra", motivo: "Corregir la fuente" }, t.ana);
  check("[cob:D:V-145] rutas de externos sobre un documento interno → 404", es(verInt, 404, { message: "Documento externo no encontrado" }) && putInt.status === 404, `${txt(verInt)} | ${txt(putInt)}`);
  const mar = await api("POST", `/sgc/externos/${eid}/verificar`, { comentario: "Sigue vigente", proxima_revision: enDias(200) }, t.mariana);
  const ric = await api("POST", `/sgc/externos/${eid}/verificar`, { comentario: "Consulté el sitio del IMNC", proxima_revision: enDias(200) }, t.ricardo);
  check("[cob:D:V-146] verificar sin ser el responsable ni gestionar externos → 403 (el responsable sí)", es(mar, 403, { codigo: "sin_permiso" }) && ric.status === 200, `${txt(mar)} | ${txt(ric)}`);
  const corto = await api("POST", `/sgc/externos/${eid}/verificar`, { comentario: "ok", proxima_revision: enDias(200) }, t.ricardo);
  check("[cob:D:V-148] verificar con comentario de menos de 5 caracteres → 400 campo comentario", es(corto, 400, { campo: "comentario" }), txt(corto));
  const verForm = (campos) => form({ ultima_verificacion: enDias(0), proxima_revision: enDias(365), comentario: "Nueva edición", ...campos }, { archivo_pdf: [PDF, "norma-nueva.pdf"] });
  const verLuis = await api("POST", `/sgc/externos/${eid}/version`, verForm({ version_fecha: "2025" }), t.luis);
  check("[cob:D:V-149] nueva versión sin documento_externo_gestionar → 403", es(verLuis, 403, { codigo: "sin_permiso" }), txt(verLuis));
  const igual = await api("POST", `/sgc/externos/${eid}/version`, verForm({ version_fecha: "2018" }), t.ana);
  check("[cob:D:V-151] nueva versión igual a la vigente → 400 campo version_fecha", es(igual, 400, { campo: "version_fecha" }), txt(igual));
  const verReauth = await api("POST", `/sgc/externos/${eid}/version`, verForm({ version_fecha: "2025" }), t.ana, SIN_REAUTH);
  check("[cob:D:V-152] nueva versión sin contraseña → 401 reauth_required (sin revisión nueva)", es(verReauth, 401, { codigo: "reauth_required", accion: "documentos:externo" }) && Number(fila("SELECT COUNT(*) AS n FROM sgc_revisiones WHERE documento_id = ?", eid)?.n) === 1, txt(verReauth));
  const putLuis = await api("PUT", `/sgc/externos/${eid}`, { fuente: "Otra fuente", motivo: "Corregir la fuente" }, t.luis);
  check("[cob:D:V-153] editar el seguimiento sin documento_externo_gestionar → 403", es(putLuis, 403, { codigo: "sin_permiso" }), txt(putLuis));
  const putCorto = await api("PUT", `/sgc/externos/${eid}`, { fuente: "Otra fuente", motivo: "x" }, t.ana);
  check("[cob:D:V-154] editar el seguimiento con motivo de menos de 5 caracteres → 400 campo motivo (sin cambios)", es(putCorto, 400, { campo: "motivo" }) && fila("SELECT fuente FROM sgc_externos WHERE documento_id = ?", eid)?.fuente === "IMNC", txt(putCorto));
  const E2 = await externo(baseExterno());
  await obsoletarDoc(E2.data?.id);
  const verObs = await api("POST", `/sgc/externos/${E2.data?.id}/verificar`, { comentario: "Sigue vigente", proxima_revision: enDias(200) }, t.ana);
  const versObs = await api("POST", `/sgc/externos/${E2.data?.id}/version`, verForm({ version_fecha: "2025" }), t.ana);
  check("[cob:D:V-147] verificar un externo obsoleto → 409", fila("SELECT estado FROM sgc_documentos WHERE id = ?", E2.data?.id)?.estado === "obsoleto" && verObs.status === 409, txt(verObs));
  check("[cob:D:V-150] nueva versión de un externo obsoleto → 409", versObs.status === 409, txt(versObs));
}

/* ---------- Lista Maestra ---------- */
{
  const jorge = await api("GET", "/sgc/lista-maestra", undefined, t.jorge);
  check("[cob:D:V-155] Lista Maestra sin documento_consultar_vigente (administración técnica) → 403", es(jorge, 403, { codigo: "sin_permiso" }), txt(jorge));
  const luis = await api("GET", "/sgc/lista-maestra/pdf", undefined, t.luis);
  const jorgePdf = await api("GET", "/sgc/lista-maestra/pdf", undefined, t.jorge);
  const hec = await api("GET", "/sgc/lista-maestra/pdf", undefined, t.hector);
  check("[cob:D:V-156] PDF de la Lista Maestra sin lista_maestra_exportar → 403 (el auditor sí lo genera)", es(luis, 403, { codigo: "sin_permiso" }) && es(jorgePdf, 403, { codigo: "sin_permiso" }) && hec.status === 200 && /pdf/.test(hec.headers.get("content-type") || ""), `${txt(luis)} | ${txt(jorgePdf)} | ${hec.status}`);
  const claveO = claveDe(O.id);
  const tiene = (r) => (r.data?.items || []).some((x) => x.clave === claveO);
  const hecObs = await api("GET", "/sgc/lista-maestra?obsoletos=1", undefined, t.hector);
  const hecSin = await api("GET", "/sgc/lista-maestra", undefined, t.hector);
  const luisObs = await api("GET", "/sgc/lista-maestra?obsoletos=1", undefined, t.luis);
  check("[cob:D:V-157] obsoletos en la Lista Maestra solo con consultar_historico y «obsoletos=1»", tiene(hecObs) && !tiene(hecSin) && luisObs.status === 200 && !tiene(luisObs), `${tiene(hecObs)} ${tiene(hecSin)} ${luisObs.status} ${tiene(luisObs)}`);
}

/* ---------- Rutas heredadas /api/documentos-sgc ---------- */
{
  const retiradas = [
    ["E-040", "GET", "/documentos-sgc/summary"],
    ["E-042", "GET", "/documentos-sgc/por-leer"],
    ["E-044", "POST", "/documentos-sgc/propuestas"],
    ["E-045", "POST", "/documentos-sgc/propuestas/1/aceptar"],
    ["E-046", "POST", "/documentos-sgc/propuestas/1/rechazar"],
    ["E-049", "DELETE", "/documentos-sgc/1"],
    ["E-051", "POST", "/documentos-sgc/1/aprobar"],
    ["E-052", "POST", "/documentos-sgc/1/cancelar"],
    ["E-053", "POST", "/documentos-sgc/1/devolver"],
    ["E-054", "POST", "/documentos-sgc/1/enviar-revision"],
    ["E-055", "POST", "/documentos-sgc/1/leido"],
    ["E-056", "POST", "/documentos-sgc/1/nueva-revision"],
    ["E-057", "POST", "/documentos-sgc/1/obsoletar"],
    ["E-058", "POST", "/documentos-sgc/1/publicar"],
    ["E-059", "POST", "/documentos-sgc/1/revisar-calidad"],
    ["E-060", "POST", "/documentos-sgc/1/revisar-tecnica"],
  ];
  const fallan = [];
  for (const [eid, metodo, ruta] of retiradas) {
    const r = await api(metodo, ruta, metodo === "GET" || metodo === "DELETE" ? undefined : { motivo: "Intento sobre el flujo retirado" }, t.ana);
    if (r.status !== 410) fallan.push(`${eid} ${metodo} ${ruta} → ${r.status}`);
  }
  check(`${retiradas.map(([e]) => `[cob:D:${e}]`).join("")} rutas del flujo anterior retiradas → 410`, !fallan.length, fallan.join(" | "));
  // Documento del flujo anterior con su archivo (datos heredados: la API ya no los crea).
  const carpeta = path.join(path.dirname(process.env.TEST_DB_PATH), "documentos_sgc");
  fs.mkdirSync(carpeta, { recursive: true });
  const nombre = `cobertura-${s5.toLowerCase()}.pdf`;
  fs.writeFileSync(path.join(carpeta, nombre), PDF);
  const sha = createHash("sha256").update(PDF).digest("hex");
  const leg = ejecutar("INSERT INTO documentos_sgc (clave, revision, titulo, tipo, area, estado, archivo_nombre, archivo_original, archivo_sha256, creado_por) VALUES (?, 1, ?, 'P', 'TC', 'vigente', ?, 'procedimiento-anterior.pdf', ?, ?)", `FX-TCP-LEG${s5}`, `Procedimiento del flujo anterior ${s5}`, nombre, sha, id.ana);
  const lid = Number(leg.lastInsertRowid);
  const ana = await api("GET", `/documentos-sgc/${lid}/archivo`, undefined, t.ana);
  const bit = fila("SELECT id FROM auditoria WHERE accion = 'descargar' AND entidad = 'documentos_sgc' AND entidad_id = ?", String(lid));
  const jorge = await api("GET", `/documentos-sgc/${lid}/archivo`, undefined, t.jorge);
  const diego = await api("GET", `/documentos-sgc/${lid}/archivo`, undefined, t.diego);
  const inex = await api("GET", "/documentos-sgc/99999999/archivo", undefined, t.ana);
  check("[cob:D:E-050] archivo del flujo anterior: se descarga con documentos:V y queda «descargar» en la bitácora", ana.status === 200 && Buffer.isBuffer(ana.data) && ana.data.equals(PDF) && !!bit, `${ana.status} ${!!bit}`);
  check("[cob:D:E-050] …sin documentos:V → 403; no distribuido a quien solo consulta vigentes → 403; inexistente → 404", jorge.status === 403 && diego.status === 403 && inex.status === 404, `${jorge.status} ${diego.status} ${inex.status}`);
}

terminar();
