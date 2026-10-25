/*
 * Prueba integral · Documentos SGC (API). Cada bloque es un bug corregido en la prueba integral y falla sin su corrección:
 * - el responsable de seguimiento de un externo debe poder consultar documentos vigentes (como ofrece la pantalla);
 * - aceptar una solicitud «nuevo» no crea un externo por el flujo interno (400 campo origen);
 * - reasignar una revisión atrasada conserva su fecha límite vencida (antes 400 y había que inventar otra);
 * - con la obsolescencia pendiente no se publica una revisión (409 solicitud_pendiente);
 * - un externo obsoleto no cambia sus datos de seguimiento (409) y un externo no queda sin responsable (400);
 * - la nueva versión de un externo conserva la distribución, como una revisión interna;
 * - quien no ve un documento confidencial no resuelve su solicitud (404), ni aprobar ni rechazar;
 * - rechazar la primera revisión no deja el documento sin salida: se abre otra y el mensaje no habla de «la vigente»;
 * - las solicitudes propias se ven aunque haya más de 500 en total, y las pendientes llegan primero (pestaña «Pendientes»);
 * - la carga inicial sin próxima revisión toma emisión + 3 años (antes nunca quedaba pendiente de revisión);
 * - el archivo de apoyo de una solicitud se verifica por SHA-256 (alterado → alerta e incidencia; faltante → 404);
 * - el historial heredado (/api/documentos-sgc) solo se lee: las escrituras responden 410.
 */
import "./lib/reauth-auto.mjs";
import fs from "node:fs";
import path from "node:path";
import { api, BASE, crearCheck, Database, enDias, fila, sesiones } from "./lib/calidad.mjs";
import { pdfConTexto } from "./lib/archivos.mjs";

const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const s5 = Date.now().toString(36).slice(-4).toUpperCase();
const SIN_APROBAR = { "X-Sin-Aprobar-Auto": "1" };
const responsables = { elaborador_id: id.luis, revisor_id: id.gabriela, autorizador_id: id.patricia };

async function ficha(campos) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...responsables, ...campos })) fd.append(k, String(v));
  fd.append("archivo_pdf", new Blob([await pdfConTexto(1, campos.titulo)]), "inicial.pdf");
  return (await api("POST", "/sgc/documentos", fd, t.ana)).data;
}
async function vigente(campos) {
  const d = await ficha(campos);
  await api("POST", `/sgc/revisiones/${d.revision_id}/registrar-vigente`, { fecha_emision: "2025-01-10", fecha_proxima_revision: "2028-01-10" }, t.ana);
  return d;
}
async function subirPdf(revId, titulo) {
  const fd = new FormData();
  fd.append("tipo", "pdf");
  fd.append("archivo", new Blob([await pdfConTexto(1, titulo)]), `${titulo}.pdf`);
  return api("POST", `/sgc/revisiones/${revId}/archivos`, fd, t.luis);
}
const completar = (revId) => api("PUT", `/sgc/revisiones/${revId}`, { apartados_afectados: "Sección 5", descripcion_cambio: "Se actualiza el método" }, t.luis);
async function externo(campos, conPdf = true) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
  if (conPdf) fd.append("archivo_pdf", new Blob([await pdfConTexto(1, campos.titulo)]), "norma.pdf");
  return api("POST", "/sgc/externos", fd, t.ana);
}
const doc = async (docId, token = t.ana) => (await api("GET", `/sgc/documentos/${docId}`, undefined, token)).data;
const db = () => new Database(process.env.TEST_DB_PATH);

/* ---------- Aceptar «nuevo» como externo ---------- */
{
  const sol = await api("POST", "/sgc/solicitudes", { tipo: "nuevo", area_codigo: "GC", tipo_codigo: "R", titulo_propuesto: `Norma propuesta ${s5}`, justificacion: "Se necesita la norma de referencia del método" }, t.luis);
  const r = await api("POST", `/sgc/solicitudes/${sol.data?.id}/aceptar`, { clave: `NMX-AA-${s5}`, origen: "externo", ...responsables }, t.ana);
  check("aceptar una solicitud «nuevo» con origen externo → 400 (los externos van por «Documentos externos»)", sol.status === 201 && r.status === 400 && r.data?.campo === "origen", `${sol.status} ${sol.data?.message} ${r.status} ${r.data?.message}`);
  check("…y no se creó un documento externo sin seguimiento", !fila("SELECT id FROM sgc_documentos WHERE clave = ?", `NMX-AA-${s5}`));
}

/* ---------- Reasignar una revisión atrasada ---------- */
{
  const D = await vigente({ clave: `FX-TCP-R${s5}`, titulo: `Procedimiento atrasado ${s5}`, area_codigo: "TC", tipo_codigo: "P" });
  const nueva = await api("POST", `/sgc/documentos/${D.id}/revisiones`, { motivo_cambio: "Actualización con fecha límite", ...responsables, fecha_limite: enDias(5) }, t.ana);
  const R = nueva.data?.revision_id;
  const vencida = enDias(-3);
  { const b = db(); b.prepare("UPDATE sgc_revisiones SET fecha_limite = ? WHERE id = ?").run(vencida, R); b.close(); }
  const r = await api("POST", `/sgc/revisiones/${R}/reasignar`, { revisor_id: id.ricardo, fecha_limite: vencida, motivo: "Gabriela está de incapacidad" }, t.ana);
  check("reasignar una revisión atrasada sin tocar su fecha límite → 200", nueva.status === 201 && r.status === 200 && fila("SELECT revisor_id, fecha_limite FROM sgc_revisiones WHERE id = ?", R)?.fecha_limite === vencida, `${nueva.status} ${r.status} ${r.data?.message}`);
  const otra = await api("POST", `/sgc/revisiones/${R}/reasignar`, { revisor_id: id.gabriela, fecha_limite: enDias(-1), motivo: "Otra fecha ya pasada" }, t.ana);
  check("…una fecha límite nueva ya pasada sigue siendo 400", otra.status === 400 && otra.data?.campo === "fecha_limite", `${otra.status} ${otra.data?.message}`);
}

/* ---------- Publicar con la obsolescencia pendiente ---------- */
{
  const D = await vigente({ clave: `FX-TCP-O${s5}`, titulo: `Procedimiento por retirar ${s5}`, area_codigo: "TC", tipo_codigo: "P" });
  const R = (await api("POST", `/sgc/documentos/${D.id}/revisiones`, { motivo_cambio: "Revisión que se autoriza", ...responsables }, t.ana)).data?.revision_id;
  await subirPdf(R, `rev2-${s5}`);
  await completar(R);
  await api("POST", `/sgc/revisiones/${R}/enviar-revision`, {}, t.luis);
  await api("POST", `/sgc/revisiones/${R}/revisar`, { decision: "aceptar" }, t.gabriela);
  await api("POST", `/sgc/revisiones/${R}/autorizar`, { decision: "autorizar" }, t.patricia);
  check("(preparación) revisión 2 autorizada", fila("SELECT estado FROM sgc_revisiones WHERE id = ?", R)?.estado === "autorizada");
  const obs = await api("POST", `/sgc/documentos/${D.id}/obsoletar`, { motivo: "Se retira el procedimiento" }, t.ana, SIN_APROBAR);
  const pub = await api("POST", `/sgc/revisiones/${R}/publicar`, {}, t.ana);
  check("con la obsolescencia pendiente no se publica → 409 solicitud_pendiente", obs.status === 202 && pub.status === 409 && pub.data?.codigo === "solicitud_pendiente", `${obs.status} ${pub.status} ${pub.data?.message}`);
  const rech = await api("POST", `/solicitudes/${obs.data?.solicitud?.id}/rechazar`, { motivo: "Se decide conservarlo" }, t.patricia);
  const pub2 = await api("POST", `/sgc/revisiones/${R}/publicar`, {}, t.ana);
  check("…resuelta la solicitud, se publica", rech.status === 200 && pub2.status === 200, `${rech.status} ${rech.data?.message} ${pub2.status} ${pub2.data?.message}`);
}

/* ---------- Externos: obsoleto, responsable y distribución ---------- */
{
  const base = { identificador: `NMX-EC-${s5}-2018`, titulo: `Norma integral ${s5}`, area_codigo: "GC", tipo_codigo: "R", fuente: "IMNC", version_fecha: "2018", enlace: "https://www.imnc.org.mx", responsable_id: id.ricardo, ultima_verificacion: enDias(0), proxima_revision: enDias(365) };
  const E = await externo(base);
  const E_ID = E.data?.id;
  const rev1 = fila("SELECT id FROM sgc_revisiones WHERE documento_id = ? AND estado = 'vigente'", E_ID)?.id;
  const dist = await api("POST", `/sgc/revisiones/${rev1}/distribucion`, { usuarios: [id.luis], requiere_lectura: true, motivo: "Distribución de la norma" }, t.ana);
  const fd = new FormData();
  for (const [k, v] of Object.entries({ version_fecha: "2025", ultima_verificacion: enDias(0), proxima_revision: enDias(365), comentario: "Nueva edición" })) fd.append(k, v);
  fd.append("archivo_pdf", new Blob([await pdfConTexto(1, `Norma 2025 ${s5}`)]), "norma-2025.pdf");
  const ver = await api("POST", `/sgc/externos/${E_ID}/version`, fd, t.ana);
  const rev2 = ver.data?.revision_id;
  const copiados = Number(fila("SELECT COUNT(*) AS n FROM sgc_distribucion WHERE revision_id = ? AND usuario_id = ? AND retirado_en IS NULL", rev2, id.luis)?.n);
  check("la nueva versión de un externo conserva la distribución (y pide de nuevo el acuse)", E.status === 201 && dist.status < 300 && ver.status === 201 && copiados === 1, `${E.status} ${E.data?.message} ${dist.status} ${ver.status} ${ver.data?.message} ${copiados}`);
  const d = await doc(E_ID);
  const sinResp = await api("PUT", `/sgc/documentos/${E_ID}`, { clave: d.item?.clave ?? d.clave, titulo: base.titulo, area_codigo: "GC", tipo_codigo: "R", confidencialidad: "uso_interno", propietario_id: "", motivo: "Quitar el responsable" }, t.ana);
  check("un externo no queda sin responsable de seguimiento → 400", sinResp.status === 400 && sinResp.data?.campo === "propietario_id", `${sinResp.status} ${sinResp.data?.message}`);
  // El responsable de seguimiento verifica la vigencia: debe poder consultar documentos vigentes (Jorge solo ve metadatos).
  const conJorge = await externo({ ...base, identificador: `NMX-EJ-${s5}-2018`, titulo: `Norma sin seguimiento ${s5}`, responsable_id: id.jorge });
  const aJorge = await api("PUT", `/sgc/externos/${E_ID}`, { responsable_id: id.jorge, motivo: "Cambiar el responsable" }, t.ana);
  const igual = await api("PUT", `/sgc/externos/${E_ID}`, { responsable_id: id.ricardo, fuente: "IMNC", motivo: "Mismo responsable" }, t.ana);
  check("responsable de seguimiento sin consultar vigentes (registrar o cambiar) → 400 campo responsable; el mismo se conserva", conJorge.status === 400 && conJorge.data?.campo === "responsable" && aJorge.status === 400 && aJorge.data?.campo === "responsable" && igual.status === 200 && Number(fila("SELECT responsable_id AS r FROM sgc_externos WHERE documento_id = ?", E_ID)?.r) === id.ricardo, `${conJorge.status} ${conJorge.data?.message} ${aJorge.status} ${igual.status} ${igual.data?.message}`);
  const obs = await api("POST", `/sgc/documentos/${E_ID}/obsoletar`, { motivo: "La norma se retiró" }, t.ana);
  const edita = await api("PUT", `/sgc/externos/${E_ID}`, { fuente: "Otra fuente", motivo: "Corregir la fuente" }, t.ana);
  check("un externo obsoleto no cambia sus datos de seguimiento → 409", fila("SELECT estado FROM sgc_documentos WHERE id = ?", E_ID)?.estado === "obsoleto" && edita.status === 409, `${obs.status} ${obs.data?.message} ${edita.status} ${edita.data?.message}`);
}

/* ---------- Solicitud de un confidencial que no se ve ---------- */
{
  const C = await vigente({ clave: `FX-GCL-Q${s5}`, titulo: `Lista confidencial ${s5}`, area_codigo: "GC", tipo_codigo: "L", confidencialidad: "confidencial" });
  const obs = await api("POST", `/sgc/documentos/${C.id}/obsoletar`, { motivo: "Se retira la lista" }, t.ana, SIN_APROBAR);
  const sid = obs.data?.solicitud?.id;
  const ricardoVe = (await api("GET", `/sgc/documentos/${C.id}`, undefined, t.ricardo)).status;
  const rech = await api("POST", `/solicitudes/${sid}/rechazar`, { motivo: "Rechazo sin ver el documento" }, t.ricardo);
  const apr = await api("POST", `/solicitudes/${sid}/aprobar`, { motivo: "Aprobación sin ver el documento" }, t.ricardo);
  check("quien no ve un confidencial no rechaza ni aprueba su solicitud (404)", obs.status === 202 && ricardoVe === 404 && rech.status === 404 && apr.status === 404 && fila("SELECT estado FROM solicitudes_autorizacion WHERE id = ?", sid)?.estado === "pendiente", `${obs.status} ${ricardoVe} ${rech.status} ${apr.status}`);
  const pat = await api("POST", `/solicitudes/${sid}/rechazar`, { motivo: "Se conserva la lista" }, t.patricia);
  check("…quien sí lo ve, sí", pat.status === 200, `${pat.status} ${pat.data?.message}`);
}

/* ---------- Primera revisión rechazada ---------- */
{
  const N = await ficha({ clave: `FX-TCP-N${s5}`, titulo: `Procedimiento nuevo ${s5}`, area_codigo: "TC", tipo_codigo: "P" });
  await completar(N.revision_id);
  const env = await api("POST", `/sgc/revisiones/${N.revision_id}/enviar-revision`, {}, t.luis);
  const rech = await api("POST", `/sgc/revisiones/${N.revision_id}/revisar`, { decision: "rechazar", comentario: "No corresponde a un procedimiento" }, t.gabriela);
  check("rechazar la primera revisión no dice que «la vigente sigue en uso»", env.status === 200 && rech.status === 200 && !/la vigente sigue/.test(rech.data?.message || ""), `${env.status} ${rech.status} ${rech.data?.message}`);
  const d = await doc(N.id);
  check("…y la ficha ofrece abrir otra revisión", d?.puede?.nueva_revision?.ok === true, JSON.stringify(d?.puede?.nueva_revision));
  const otra = await api("POST", `/sgc/documentos/${N.id}/revisiones`, { motivo_cambio: "Segundo intento de la emisión inicial", ...responsables }, t.ana);
  check("…que se abre en borrador", otra.status === 201 && !/la vigente sigue/.test(otra.data?.message || ""), `${otra.status} ${otra.data?.message}`);
}

/* ---------- Solicitudes propias con más de 500 ---------- */
{
  const propia = await api("POST", "/sgc/solicitudes", { tipo: "nuevo", area_codigo: "GC", tipo_codigo: "F", titulo_propuesto: `Formato propio ${s5}`, justificacion: "Formato para registrar el control de temperatura" }, t.mariana);
  {
    const b = db();
    const ins = b.prepare("INSERT INTO sgc_solicitudes (tipo, area_codigo, tipo_codigo, titulo_propuesto, justificacion, solicitante_id, estado, creado_en) VALUES ('nuevo', 'GC', 'F', ?, 'Relleno de la prueba integral', ?, 'rechazada', ?)");
    b.transaction(() => { for (let i = 0; i < 510; i++) ins.run(`Relleno ${s5} ${i}`, id.luis, new Date().toISOString()); })();
    b.close();
  }
  const suyas = (await api("GET", "/sgc/solicitudes", undefined, t.mariana)).data?.items || [];
  check("con más de 500 solicitudes, quien solo propone sigue viendo la suya", propia.status === 201 && suyas.some((x) => Number(x.id) === Number(propia.data?.id)), `${propia.status} ${suyas.length}`);
  // La pestaña «Pendientes» filtra en la pantalla lo que manda el servidor: una pendiente vieja no debe quedar fuera de las 500.
  const todas = (await api("GET", "/sgc/solicitudes", undefined, t.ana)).data?.items || [];
  check("con más de 500 solicitudes más nuevas, quien atiende sigue recibiendo la pendiente (pendientes primero)", todas.some((x) => Number(x.id) === Number(propia.data?.id)) && todas[0]?.estado === "pendiente", `${todas.length} ${todas[0]?.estado}`);
}

/* ---------- Carga inicial sin próxima revisión ---------- */
{
  const d = await ficha({ clave: `FX-TCP-I${s5}`, titulo: `Procedimiento heredado ${s5}`, area_codigo: "TC", tipo_codigo: "P" });
  const r = await api("POST", `/sgc/revisiones/${d.revision_id}/registrar-vigente`, { fecha_emision: "2022-03-15" }, t.ana);
  check("carga inicial sin próxima revisión → emisión + 3 años", r.status === 200 && fila("SELECT fecha_proxima_revision AS f FROM sgc_revisiones WHERE id = ?", d.revision_id)?.f === "2025-03-15", `${r.status} ${r.data?.message} ${fila("SELECT fecha_proxima_revision AS f FROM sgc_revisiones WHERE id = ?", d.revision_id)?.f}`);
  const item = await doc(d.id);
  check("…y queda pendiente de revisión (ya pasó)", JSON.stringify(item).includes("pendiente"), "");
}

/* ---------- Archivo de apoyo verificado ---------- */
{
  const fd = new FormData();
  for (const [k, v] of Object.entries({ tipo: "nuevo", area_codigo: "GC", tipo_codigo: "F", titulo_propuesto: `Formato con apoyo ${s5}`, justificacion: "Se adjunta el borrador del formato" })) fd.append(k, v);
  fd.append("archivo", new Blob([await pdfConTexto(1, `Apoyo ${s5}`)]), "borrador-formato.pdf");
  const sol = await api("POST", "/sgc/solicitudes", fd, t.mariana);
  const sid = sol.data?.id;
  const ok = await fetch(`${BASE}/sgc/solicitudes/${sid}/apoyo`, { headers: { Authorization: `Bearer ${t.ana}` } });
  check("el apoyo íntegro se descarga con su nombre y la marca de integridad", ok.status === 200 && ok.headers.get("x-integridad-archivo") === "ok" && /borrador-formato\.pdf/.test(ok.headers.get("content-disposition") || ""), `${ok.status} ${ok.headers.get("x-integridad-archivo")}`);
  const almacenado = fila("SELECT apoyo_nombre_almacenado AS a FROM sgc_solicitudes WHERE id = ?", sid)?.a;
  const ruta = path.join(path.dirname(process.env.TEST_DB_PATH), "sgc", ...String(almacenado).split("/"));
  // El original vuelve a su lugar al terminar: la prueba de restauración de respaldos (más adelante) verifica cada archivo.
  const original = fs.readFileSync(ruta);
  fs.appendFileSync(ruta, "alterado");
  const alt = await fetch(`${BASE}/sgc/solicitudes/${sid}/apoyo`, { headers: { Authorization: `Bearer ${t.ana}` } });
  const inc = fila("SELECT id FROM incidencias WHERE clave_automatica = ?", `alerta_integridad:sgc_apoyo:${sid}:alterado`);
  check("alterado: se marca, queda la alerta y la incidencia automática", alt.headers.get("x-integridad-archivo") === "alterado" && !!inc && !!fila("SELECT id FROM auditoria WHERE accion = 'alerta_integridad' AND entidad = 'sgc_solicitudes' AND entidad_id = ?", String(sid)), `${alt.status} ${alt.headers.get("x-integridad-archivo")} ${!!inc}`);
  fs.rmSync(ruta);
  const falta = await api("GET", `/sgc/solicitudes/${sid}/apoyo`, undefined, t.ana);
  check("faltante → 404 archivo_faltante", falta.status === 404 && falta.data?.codigo === "archivo_faltante", `${falta.status} ${falta.data?.codigo}`);
  fs.writeFileSync(ruta, original);
}

/* ---------- Historial heredado ---------- */
{
  const escribir = await api("PUT", "/documentos-sgc/1", { titulo: "x" }, t.ana);
  const crear = await api("POST", "/documentos-sgc", { titulo: "x" }, t.ana);
  check("el flujo anterior no se escribe: 410 retirado", escribir.status === 410 && crear.status === 410, `${escribir.status} ${crear.status}`);
}

terminar();
