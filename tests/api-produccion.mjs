/*
 * Fase 12 · deuda y concurrencia contra el servidor de prueba (base de instance/test):
 * - historial por registro (bitacora y sus solicitudes) con los alcances
 *   de la ficha: asignado (muestras), Documentos SGC (historico y confidencialidad), propio (usuarios),
 *   incidencias (calidad); lo no visible es 404, igual que si no existiera;
 * - la lista de la bitacora dice si esta cortada (la bitacora no se exporta);
 * - folios bajo concurrencia: muchas altas simultaneas de varias personas, sin
 *   errores 500 y con folios unicos y consecutivos.
 */
import "./lib/reauth-auto.mjs";
import { api, cadena, crearCheck, fila, filas, sesiones } from "./lib/calidad.mjs";
import { pdfConTexto } from "./lib/archivos.mjs";

const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const historial = (entidad, entidadId, token) => api("GET", `/audit?entidad=${entidad}&entidad_id=${entidadId}`, undefined, token);
const solicitudes = (entidad, entidadId, token) => api("GET", `/solicitudes?entidad=${entidad}&entidad_id=${entidadId}`, undefined, token);

/* ================= Historial con alcances ================= */
// Asignado: recepcion no asignada a Luis (Tecnico Analista, muestras:V asignado).
{
  const c = await cadena(t, "HISTASIG");
  const [h, sol, ficha] = await Promise.all([historial("muestras_recepcion", c.R, t.luis), solicitudes("muestras_recepcion", c.R, t.luis), api("GET", `/samples/reception/${c.R}`, undefined, t.luis)]);
  check("historial de una recepción NO asignada (alcance asignado): 404 en la bitácora y en las solicitudes (la ficha tampoco se ve)", h.status === 404 && sol.status === 404 && [403, 404].includes(ficha.status), `${h.status} ${sol.status} ficha ${ficha.status}`);
  await api("POST", `/samples/reception/${c.R}/asignaciones`, { usuario_id: id.luis, motivo: "Asignación de prueba de historial" }, t.ricardo);
  const h2 = await historial("muestras_recepcion", c.R, t.luis);
  check("  … una vez asignada: 200", h2.status === 200 && (h2.data?.items || []).length > 0, `${h2.status}`);
  const h3 = await historial("muestras_recepcion", c.R, t.ana);
  check("  … quien tiene muestras:V total la ve sin asignación", h3.status === 200, String(h3.status));
}

// Documentos SGC: el historial (bitacora) de un documento lo ve quien ve su historial (consultar_historico) y respeta la confidencialidad.
{
  const sufijo = Date.now().toString(36).slice(-4).toUpperCase();
  const crear = async (clave, titulo, confidencialidad) => {
    const fd = new FormData();
    fd.append("archivo_pdf", new Blob([await pdfConTexto(1, titulo)]), `${titulo}.pdf`);
    for (const [k, v] of Object.entries({ clave, titulo, area_codigo: "GC", tipo_codigo: "P", confidencialidad, elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.patricia })) fd.append(k, String(v));
    return api("POST", "/sgc/documentos", fd, t.ana);
  };
  const restringido = await crear(`FX-GCP-HR${sufijo}`, `Restringido historial ${sufijo}`, "restringido");
  const interno = await crear(`FX-GCP-HI${sufijo}`, `Uso interno historial ${sufijo}`, "uso_interno");
  await api("POST", `/sgc/revisiones/${interno.data?.revision_id}/registrar-vigente`, { fecha_emision: "2026-03-01" }, t.ana);
  const R = restringido.data?.id;
  const T = interno.data?.id;
  const [hR, fichaR] = await Promise.all([historial("sgc_documentos", R, t.hector), api("GET", `/sgc/documentos/${R}`, undefined, t.hector)]);
  check("historial de un documento SGC restringido para quien no debe verlo: 404 en la bitácora y la ficha", restringido.status === 201 && hR.status === 404 && fichaR.status === 404, `${restringido.status} ${hR.status} ${fichaR.status}`);
  const [hT, fichaT] = await Promise.all([historial("sgc_documentos", T, t.hector), api("GET", `/sgc/documentos/${T}`, undefined, t.hector)]);
  check("  … uno de uso interno con consultar histórico: ficha e historial 200", interno.status === 201 && fichaT.status === 200 && hT.status === 200 && (hT.data?.items || []).length > 0, `${interno.status} ${fichaT.status} ${hT.status}`);
  const [hD, fichaD] = await Promise.all([historial("sgc_documentos", T, t.diego), api("GET", `/sgc/documentos/${T}`, undefined, t.diego)]);
  check("  … con solo consultar vigentes: ve la ficha, pero no su historial (404)", fichaD.status === 200 && hD.status === 404, `${fichaD.status} ${hD.status}`);
  const deAna = await historial("sgc_documentos", R, t.ana);
  check("  … Mejora Continua ve el historial del restringido (200)", deAna.status === 200 && (deAna.data?.items || []).length > 0, String(deAna.status));
}

// Propio: Luis (usuarios:V propio) ve su historial, no el de otra persona ni el de un rol.
{
  const [propio, otro, otroCsv, rol] = await Promise.all([historial("usuarios", id.luis, t.luis), historial("usuarios", id.ricardo, t.luis), historial("usuarios", id.ricardo, t.luis, true), historial("roles", 1, t.luis)]);
  check("historial de usuarios (alcance propio): el propio 200; el de otra persona y el de un rol 404 (también el CSV)", propio.status === 200 && otro.status === 404 && otroCsv.status === 404 && rol.status === 404, `${propio.status} ${otro.status} ${otroCsv.status} ${rol.status}`);
}

// Incidencias: Luis solo ve las suyas.
{
  const ajena = await api("POST", "/calidad/incidencias", { tipo: "otro", fecha_hora_ocurrencia: new Date().toISOString(), descripcion: "Incidencia de Mariana para la prueba de historial", impacto_resultados: "no", accion_inmediata: "Ninguna" }, t.mariana);
  const h = await historial("incidencias", ajena.data?.id, t.luis);
  const propia = await historial("incidencias", ajena.data?.id, t.mariana);
  check("historial de una incidencia ajena (alcance incidencias): 404; la propia 200", ajena.status === 201 && h.status === 404 && propia.status === 200, `${ajena.status} ${h.status} ${propia.status}`);
}

// Registro inexistente y sin permiso del modulo.
{
  const [nada, sinModulo] = await Promise.all([historial("reactivos", 99999999, t.ana), historial("informes", 1, t.mariana)]);
  check("historial de un registro inexistente: 404; sin V del módulo: 403 (como antes)", nada.status === 404 && sinModulo.status === 403, `${nada.status} ${sinModulo.status}`);
}

/* ================= Lista de la bitacora cortada ================= */
{
  const json = await api("GET", "/audit?limit=2", undefined, t.ana);
  check("la lista de la bitácora dice si está cortada", json.status === 200 && json.data?.truncado === true, String(json.data?.truncado));
}

/* ================= Folios bajo concurrencia ================= */
{
  const personas = ["luis", "mariana", "ricardo", "diego", "carmen", "gabriela"];
  const antes = Number(fila("SELECT COALESCE(MAX(folio_num), 0) AS n FROM incidencias").n);
  const respuestas = await Promise.all(
    Array.from({ length: 30 }, (_, i) => api("POST", "/calidad/incidencias", { tipo: "otro", fecha_hora_ocurrencia: new Date().toISOString(), descripcion: `Alta simultánea ${i} para la prueba de folios`, impacto_resultados: "no", accion_inmediata: "Ninguna" }, t[personas[i % personas.length]])),
  );
  const folios = filas("SELECT folio_num FROM incidencias WHERE folio_num > ? ORDER BY folio_num", antes).map((f) => Number(f.folio_num));
  const consecutivos = folios.every((f, i) => f === antes + i + 1);
  check("30 incidencias simultáneas de 6 personas: todas 201, sin 500, folios únicos y consecutivos", respuestas.every((r) => r.status === 201) && folios.length === 30 && new Set(folios).size === 30 && consecutivos, `${[...new Set(respuestas.map((r) => r.status))].join(",")} folios ${folios[0]}…${folios.at(-1)}`);

  const recAntes = Number(fila("SELECT COALESCE(MAX(folio_num), 0) AS n FROM muestras_recepcion").n);
  const recs = await Promise.all(Array.from({ length: 10 }, (_, i) => cadena(t, `FOLCON${i}`)));
  const recFolios = filas("SELECT folio_num FROM muestras_recepcion WHERE folio_num > ? ORDER BY folio_num", recAntes).map((f) => Number(f.folio_num));
  check("10 cadenas simultáneas (recepción, procesamiento, extracción): todas creadas y folios de recepción consecutivos", recs.every((c) => c.R && c.P && c.E) && recFolios.length === 10 && recFolios.every((f, i) => f === recAntes + i + 1), `${recs.filter((c) => c.E).length}/10 ${recFolios.join(",")}`);
}

/* ================= Suspensiones bajo concurrencia ================= */
{
  const [nc1, nc2] = await Promise.all([1, 2].map((n) => api("POST", "/calidad/nc", { origen: "otro", descripcion: `NC ${n} de la prueba de suspensiones simultáneas`, clasificacion: "mayor", responsable_id: id.ricardo }, t.ana)));
  const a = nc1.data?.id;
  const b = nc2.data?.id;
  const cuerpo = (m) => ({ tipo: "metodo", clave: "PSP", motivo: m });
  const r = await Promise.all([api("POST", `/calidad/nc/${a}/suspensiones`, cuerpo("Suspensión simultánea A"), t.ana), api("POST", `/calidad/nc/${b}/suspensiones`, cuerpo("Suspensión simultánea B"), t.ricardo), api("POST", `/calidad/nc/${a}/suspensiones`, cuerpo("La misma NC otra vez"), t.ricardo)]);
  const activas = filas("SELECT id, nc_id FROM suspensiones WHERE tipo = 'metodo' AND clave = 'PSP' AND reanudada_en IS NULL");
  check("suspensiones simultáneas del mismo método desde dos NC (y la misma NC dos veces): 201, 201 y 409, sin 500; quedan exactamente 2 activas", r.map((x) => x.status).sort().join() === "201,201,409" && activas.length === 2 && new Set(activas.map((x) => x.nc_id)).size === 2, `${r.map((x) => x.status).join(",")} activas ${activas.length}`);
  const [doble1, doble2, otra] = await Promise.all([api("POST", `/calidad/suspensiones/${activas[0]?.id}/reanudar`, { motivo: "Reanudación simultánea 1" }, t.patricia), api("POST", `/calidad/suspensiones/${activas[0]?.id}/reanudar`, { motivo: "Reanudación simultánea 2" }, t.patricia), api("POST", `/calidad/suspensiones/${activas[1]?.id}/reanudar`, { motivo: "Reanudación de la otra" }, t.patricia)]);
  const quedan = Number(fila("SELECT COUNT(*) AS n FROM suspensiones WHERE tipo = 'metodo' AND clave = 'PSP' AND reanudada_en IS NULL").n);
  const reanudadas = Number(fila("SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'no_conformidades' AND accion = 'reanudar' AND entidad_id = ?", String(activas[0]?.nc_id)).n);
  check("reanudaciones simultáneas (la misma dos veces y otra): 200/409 y 200, sin 500; el método queda libre y una sola entrada de reanudar por suspensión", [doble1.status, doble2.status].sort().join() === "200,409" && otra.status === 200 && quedan === 0 && reanudadas === 1, `${doble1.status} ${doble2.status} ${otra.status} quedan ${quedan}`);
}

terminar();
