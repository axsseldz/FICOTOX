/*
 * Prueba integral · Muestras e Informes (API). Cada bloque es un bug corregido
 * en la prueba integral (ver ~/Downloads/PRUEBA_INTEGRAL.md) y falla sin su corrección:
 * - cambiar el folio de una recepción liberada, cerrada o rechazada (409 estado_invalido);
 * - un informe con análisis que no existen (400) y cambiar la recepción de un borrador (400);
 * - editar una extracción cambiando E-D ↔ E-A (400) o la recepción de un procesamiento con extracciones (409);
 * - devolver un análisis exige la autorización FX-THF-AP de revisión, como revisar (403);
 * - la evidencia de un envío se descarga verificando su SHA-256 (bitácora «descargar»;
 *   alterada → alerta_integridad + incidencia automática) y la lista de envíos de un informe que no existe da 404.
 */
import "./lib/reauth-auto.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { analisisDe, api, cadena, crearCheck, fila, filas, informeLiberado, sesiones } from "./lib/calidad.mjs";

const { check, terminar } = crearCheck();
const { t, id } = await sesiones();

/* ---------- Cambiar folio ---------- */
{
  const lib = await informeLiberado(t, "FOL");
  const antes = fila("SELECT folio_num, estado FROM muestras_recepcion WHERE id = ?", lib.R);
  const r = await api("POST", `/samples/reception/${lib.R}/folio`, { folio_num: 900000 + (Date.now() % 90000), motivo: "Prueba: el folio ya está en el informe" }, t.ricardo);
  check("cambiar folio de una recepción liberada → 409 estado_invalido", r.status === 409 && r.data?.codigo === "estado_invalido", `${r.status} ${r.data?.message} (estado ${antes.estado})`);
  check("…y el folio no cambia", fila("SELECT folio_num FROM muestras_recepcion WHERE id = ?", lib.R).folio_num === antes.folio_num);
  const vigente = await cadena(t, "FOL2");
  const nuevo = 800000 + (Date.now() % 90000);
  const ok = await api("POST", `/samples/reception/${vigente.R}/folio`, { folio_num: nuevo, motivo: "Prueba: folio duplicado en papel" }, t.ricardo);
  check("cambiar folio de una recepción en curso sigue funcionando (Coord. Técnica, directo)", ok.status === 200 && fila("SELECT folio_num FROM muestras_recepcion WHERE id = ?", vigente.R).folio_num === nuevo, `${ok.status} ${ok.data?.message}`);
}

/* ---------- Informe: análisis inexistentes y recepción fija ---------- */
{
  const lib = await informeLiberado(t, "INX");
  const c = await cadena(t, "INX2");
  const r = await api("POST", "/informes", { recepcion_id: lib.R, analisis_ids: [lib.A, 99999999], cliente: { nombre: "Cliente INX" } }, t.qa);
  check("crear informe con un análisis que no existe → 400", r.status === 400 && r.data?.campo === "analisis_ids", `${r.status} ${r.data?.message}`);
  const borrador = await api("POST", "/informes", { recepcion_id: lib.R, analisis_ids: [lib.A], cliente: { nombre: "Cliente INX" } }, t.qa);
  check("borrador de enmienda de prueba creado", borrador.status === 201, `${borrador.status} ${borrador.data?.message}`);
  const cambio = await api("PUT", `/informes/${borrador.data?.id}`, { recepcion_id: c.R, analisis_ids: [], cliente: { nombre: "Otro cliente" } }, t.qa);
  check("cambiar la recepción de un informe en borrador → 400", cambio.status === 400 && cambio.data?.campo === "recepcion_id", `${cambio.status} ${cambio.data?.message}`);
  check("…la recepción del borrador sigue igual", Number(fila("SELECT recepcion_id FROM informes WHERE id = ?", borrador.data?.id).recepcion_id) === Number(lib.R));
  const fantasma = await api("PUT", `/informes/${borrador.data?.id}`, { recepcion_id: lib.R, analisis_ids: [lib.A, 99999998], cliente: { nombre: "Cliente INX" } }, t.qa);
  check("guardar el borrador con un análisis que no existe → 400", fantasma.status === 400 && fantasma.data?.campo === "analisis_ids", `${fantasma.status} ${fantasma.data?.message}`);
}

/* ---------- Extracción y procesamiento: formato y origen fijos ---------- */
{
  const c = await cadena(t, "EXT");
  const otra = await cadena(t, "EXT2");
  const ext = fila("SELECT folio_num FROM muestras_extraccion WHERE id = ?", c.E);
  const cuerpo = { tipo_registro: "E-A", folio_num: ext.folio_num, procesamiento_id: c.P, tipo_molienda: "fresca", id_interno: c.idInt, fecha_extraccion: "2026-09-20", registro_pesos: [{ id_muestra: c.idInt, replica: `${c.idInt}_R1`, peso_muestra: 2.01 }], nombre_quien_extrajo: "Persona A", nombre_quien_superviso: "Persona B" };
  const r = await api("PUT", `/samples/extraction/${c.E}`, cuerpo, t.qa);
  check("editar una extracción E-D como E-A → 400 (el formato no cambia)", r.status === 400 && r.data?.campo === "tipo_registro", `${r.status} ${r.data?.message}`);
  check("…sigue siendo E-D", fila("SELECT tipo_registro FROM muestras_extraccion WHERE id = ?", c.E).tipo_registro === "E-D");
  const proc = fila("SELECT folio_num FROM muestras_procesamiento WHERE id = ?", c.P);
  const p = await api("PUT", `/samples/processing/${c.P}`, { folio_num: proc.folio_num, recepcion_id: otra.R, muestra_tipo: "unica", id_interno: otra.idInt, fecha_procesamiento: "2026-09-20", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "Persona A", nombre_quien_superviso: "Persona B" }, t.qa);
  check("cambiar la recepción de un procesamiento con extracciones → 409", p.status === 409 && p.data?.campo === "recepcion_id", `${p.status} ${p.data?.message}`);
  check("…la recepción del procesamiento sigue igual", Number(fila("SELECT recepcion_id FROM muestras_procesamiento WHERE id = ?", c.P).recepcion_id) === Number(c.R));
}

/* ---------- Devolver exige la autorización de revisión ---------- */
{
  const c = await cadena(t, "DEV");
  const A = (await api("POST", "/samples/analysis", analisisDe(c), t.qa)).data?.id;
  await api("POST", `/samples/analysis/${A}/enviar-revision`, {}, t.qa);
  const vigente = () => filas("SELECT id FROM autorizaciones_personal WHERE usuario_id = ? AND tipo = 'actividad' AND clave = 'revision_resultados' AND revocada_en IS NULL", id.ricardo);
  for (const a of vigente()) await api("POST", `/admin/usuarios/${id.ricardo}/autorizaciones/${a.id}/revocar`, { motivo: "Prueba integral: sin autorización de revisión" }, t.patricia);
  check("(preparación) Ricardo sin autorización de revisión de resultados", vigente().length === 0);
  const r = await api("POST", `/samples/analysis/${A}/devolver`, { motivo: "Faltan los cromatogramas del duplicado" }, t.ricardo);
  check("devolver sin la autorización FX-THF-AP de revisión → 403", r.status === 403, `${r.status} ${r.data?.message}`);
  check("…el análisis sigue en revisión", fila("SELECT estado FROM muestras_analisis WHERE id = ?", A).estado === "en_revision");
  const otorga = await api("POST", `/admin/usuarios/${id.ricardo}/autorizaciones`, { tipo: "actividad", clave: "revision_resultados", vigente_desde: "2026-01-01", folio_fx_thf_ap: "FX-THF-AP-INTEGRAL", motivo: "Prueba integral: se restituye la autorización" }, t.patricia);
  check("(limpieza) autorización de revisión restituida", otorga.status === 201 || otorga.status === 200, `${otorga.status} ${otorga.data?.message}`);
  const ok = await api("POST", `/samples/analysis/${A}/devolver`, { motivo: "Faltan los cromatogramas del duplicado" }, t.ricardo);
  check("con la autorización, devolver funciona", ok.status === 200 && fila("SELECT estado FROM muestras_analisis WHERE id = ?", A).estado === "registrado", `${ok.status} ${ok.data?.message}`);
}

/* ---------- Evidencia del envío ---------- */
{
  const lib = await informeLiberado(t, "EVI", { enviar: true });
  const envio = fila("SELECT id, evidencia_archivo FROM envios_informe WHERE informe_id = ? ORDER BY id DESC", lib.informe);
  const url = `/informes/${lib.informe}/envios/${envio.id}/evidencia`;
  const ok = await api("GET", url, undefined, t.patricia);
  check("descargar la evidencia del envío verifica su SHA-256", ok.status === 200 && ok.headers.get("x-integridad-evidencia") === "ok", `${ok.status} ${ok.headers.get("x-integridad-evidencia")}`);
  check("…y queda «descargar» en la bitácora", !!fila("SELECT id FROM auditoria WHERE accion = 'descargar' AND entidad = 'informes' AND entidad_id = ? AND cambios_json LIKE ?", String(lib.informe), `%"envio_id":${envio.id}%`));
  const ruta = path.join(path.dirname(process.env.TEST_DB_PATH), "informes", "envios", envio.evidencia_archivo);
  writeFileSync(ruta, Buffer.concat([readFileSync(ruta), Buffer.from("alterado")]));
  const alterada = await api("GET", url, undefined, t.patricia);
  check("evidencia alterada → X-Integridad-Evidencia alterado", alterada.headers.get("x-integridad-evidencia") === "alterado", `${alterada.status} ${alterada.headers.get("x-integridad-evidencia")}`);
  check("…con alerta_integridad en la bitácora", !!fila("SELECT id FROM auditoria WHERE accion = 'alerta_integridad' AND entidad = 'informes' AND entidad_id = ? AND cambios_json LIKE ?", String(lib.informe), `%"envio_id":${envio.id}%`));
  check("…y una incidencia automática", !!fila("SELECT id FROM incidencias WHERE clave_automatica = ?", `alerta_integridad:envio:${envio.id}:alterado`));
  const nada = await api("GET", "/informes/99999999/envios", undefined, t.patricia);
  check("lista de envíos de un informe que no existe → 404", nada.status === 404, String(nada.status));
}

terminar();
