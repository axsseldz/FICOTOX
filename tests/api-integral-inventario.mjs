/*
 * Prueba integral · Inventario y Equipos (API). Cada bloque es un bug corregido
 * en la prueba integral (ver ~/Downloads/PRUEBA_INTEGRAL.md) y falla sin su corrección:
 * - por el formulario de mantenimiento ya no se cancela ni se marca «vencido» (400), lo cancelado
 *   no se edita y lo completado no se reabre ni se cancela (409);
 * - mantenimientos de equipos inexistentes (404) o dados de baja (409); tipo, estado y fechas validados (400);
 * - equipos: estado de catálogo y fecha de calibración AAAA-MM-DD (400); la baja cancela sus mantenimientos
 *   pendientes (con bitácora) y sus avisos desaparecen;
 * - movimientos sobre insumos dados de baja (409 dado_de_baja); salida sin existencia = 409 existencia_insuficiente;
 *   un ajuste igual a la existencia guarda 0;
 * - el reporte PDF de mantenimiento se verifica al abrirlo (SHA-256, bitácora «descargar»; alterado →
 *   alerta_integridad + incidencia automática) y no se adjunta a un mantenimiento cancelado;
 * - la lista de movimientos filtra en el servidor (insumo, tipo, búsqueda) y marca las reversiones;
 * - reactivos y consumibles: tipo del catálogo y fechas AAAA-MM-DD (400); un valor heredado que no cambia se conserva.
 */
import "./lib/reauth-auto.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { api, crearCheck, Database, enDias, fila, filas, sesiones } from "./lib/calidad.mjs";
import { pdfConTexto } from "./lib/archivos.mjs";

const { check, terminar } = crearCheck();
const { t } = await sesiones();
const unico = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const nuevoEquipo = async (extra = {}) => (await api("POST", "/inventory/equipos", { nombre: `Equipo integral ${unico()}`, estado: "operativo", ...extra }, t.qa)).data?.id;
const mant = (equipo, extra = {}) => ({ id_equipo: equipo, tipo: "preventivo", fecha_programada: "2027-05-01", estado: "programado", ...extra });
const estadoMant = (id) => fila("SELECT estado FROM mantenimientos WHERE id = ?", id)?.estado;

/* ---------- Mantenimiento: estados por el formulario ---------- */
{
  const E = await nuevoEquipo();
  const M = (await api("POST", "/inventory/mantenimientos", mant(E), t.carmen)).data?.id;
  check("(preparación) mantenimiento programado por la Administradora Auxiliar", !!M);
  const cancelaPut = await api("PUT", `/inventory/mantenimientos/${M}`, mant(E, { estado: "cancelado" }), t.carmen);
  check("cancelar por el formulario (sin motivo ni contraseña) → 400 campo estado", cancelaPut.status === 400 && cancelaPut.data?.campo === "estado", `${cancelaPut.status} ${cancelaPut.data?.message}`);
  check("…sigue programado", estadoMant(M) === "programado", estadoMant(M));
  const vencePut = await api("PUT", `/inventory/mantenimientos/${M}`, mant(E, { estado: "vencido" }), t.carmen);
  check("marcar «vencido» a mano → 400 (lo marca el sistema)", vencePut.status === 400 && vencePut.data?.campo === "estado", `${vencePut.status} ${vencePut.data?.message}`);
  const raro = await api("PUT", `/inventory/mantenimientos/${M}`, mant(E, { tipo: "verificacion" }), t.carmen);
  check("tipo fuera del catálogo («verificacion») → 400 campo tipo", raro.status === 400 && raro.data?.campo === "tipo", `${raro.status} ${raro.data?.message}`);
  const fechaMala = await api("PUT", `/inventory/mantenimientos/${M}`, mant(E, { fecha_programada: "01/05/2027" }), t.carmen);
  check("fecha programada que no es AAAA-MM-DD → 400", fechaMala.status === 400 && fechaMala.data?.campo === "fecha_programada", `${fechaMala.status} ${fechaMala.data?.message}`);
  const futura = await api("PUT", `/inventory/mantenimientos/${M}`, mant(E, { estado: "completado", fecha_realizado: enDias(5) }), t.carmen);
  check("completado con fecha de realización futura → 400", futura.status === 400 && futura.data?.campo === "fecha_realizado", `${futura.status} ${futura.data?.message}`);
  const completa = await api("PUT", `/inventory/mantenimientos/${M}`, mant(E, { estado: "completado", fecha_realizado: enDias(0) }), t.carmen);
  check("completar con fecha de hoy funciona", completa.status === 200 && estadoMant(M) === "completado", `${completa.status} ${completa.data?.message}`);
  const reabre = await api("PUT", `/inventory/mantenimientos/${M}`, mant(E, { estado: "programado" }), t.carmen);
  check("reabrir un completado → 409", reabre.status === 409 && reabre.data?.codigo === "completado", `${reabre.status} ${reabre.data?.message}`);
  const cancelaCompletado = await api("DELETE", `/inventory/mantenimientos/${M}`, { motivo: "Prueba: reescribir el historial" }, t.qa);
  check("cancelar un completado → 409 (es historia del equipo)", cancelaCompletado.status === 409 && estadoMant(M) === "completado", `${cancelaCompletado.status} ${cancelaCompletado.data?.message}`);

  const M2 = (await api("POST", "/inventory/mantenimientos", mant(E, { fecha_programada: "2027-07-01" }), t.carmen)).data?.id;
  const cancela = await api("DELETE", `/inventory/mantenimientos/${M2}`, { motivo: "Prueba: el proveedor canceló la visita" }, t.qa);
  check("cancelar con motivo y contraseña sigue funcionando", cancela.status === 200 && estadoMant(M2) === "cancelado", `${cancela.status} ${cancela.data?.message}`);
  const editaCancelado = await api("PUT", `/inventory/mantenimientos/${M2}`, mant(E, { fecha_programada: "2027-07-01" }), t.carmen);
  check("editar (o reabrir) un cancelado → 409", editaCancelado.status === 409 && editaCancelado.data?.codigo === "cancelado" && estadoMant(M2) === "cancelado", `${editaCancelado.status} ${editaCancelado.data?.message}`);
  const fd = new FormData();
  fd.append("archivo", new Blob([await pdfConTexto(1, "Reporte de un cancelado")]), "cancelado.pdf");
  fd.append("id_mantenimiento", String(M2));
  const adjunto = await api("POST", "/documents/maintenance-report", fd, t.carmen);
  check("adjuntar un reporte a un mantenimiento cancelado → 409", adjunto.status === 409, `${adjunto.status} ${adjunto.data?.message}`);
}

/* ---------- Mantenimiento: equipo existente y activo ---------- */
{
  const inexistente = await api("POST", "/inventory/mantenimientos", mant(99999999), t.carmen);
  check("programar en un equipo que no existe → 404", inexistente.status === 404 && inexistente.data?.campo === "id_equipo", `${inexistente.status} ${inexistente.data?.message}`);
  const E = await nuevoEquipo();
  const abiertos = [];
  for (const fecha of ["2026-01-10", "2027-08-01"]) abiertos.push((await api("POST", "/inventory/mantenimientos", mant(E, { fecha_programada: fecha }), t.carmen)).data?.id);
  await api("GET", "/inventory/mantenimientos", undefined, t.carmen); // barrido: el de enero queda vencido
  const avisoAntes = ((await api("GET", "/notificaciones", undefined, t.qa)).data?.items || []).some((n) => String(n.href || "").includes(`abrir=${abiertos[0]}`));
  check("(preparación) el vencido avisa en la campana", avisoAntes && estadoMant(abiertos[0]) === "vencido", `${avisoAntes} ${estadoMant(abiertos[0])}`);
  const baja = await api("DELETE", `/inventory/equipos/${E}`, { motivo: "Prueba integral: equipo retirado" }, t.qa);
  check("baja del equipo: cancela sus 2 mantenimientos pendientes", baja.status === 200 && baja.data?.mantenimientos_cancelados === 2 && abiertos.every((m) => estadoMant(m) === "cancelado"), `${baja.status} ${baja.data?.message} ${abiertos.map(estadoMant)}`);
  check("…cada cancelación queda en la bitácora con el motivo de la baja", abiertos.every((m) => !!fila("SELECT id FROM auditoria WHERE accion = 'anular' AND entidad = 'mantenimientos' AND entidad_id = ? AND motivo LIKE 'Baja del equipo:%'", String(m))));
  const avisoDespues = ((await api("GET", "/notificaciones", undefined, t.qa)).data?.items || []).some((n) => String(n.href || "").includes(`abrir=${abiertos[0]}`));
  check("…y el aviso «Mantenimiento vencido» desaparece", !avisoDespues);
  const enBaja = await api("POST", "/inventory/mantenimientos", mant(E), t.carmen);
  check("programar en un equipo dado de baja → 409 dado_de_baja", enBaja.status === 409 && enBaja.data?.codigo === "dado_de_baja", `${enBaja.status} ${enBaja.data?.message}`);
}

/* ---------- Equipos: estado y fecha ---------- */
{
  const enMant = await api("POST", "/inventory/equipos", { nombre: `Equipo estado ${unico()}`, estado: "mantenimiento" }, t.qa);
  check("alta con estado «en mantenimiento» (lo pone Mantenimiento) → 400", enMant.status === 400 && enMant.data?.campo === "estado", `${enMant.status} ${enMant.data?.message}`);
  const roto = await api("POST", "/inventory/equipos", { nombre: `Equipo estado ${unico()}`, estado: "roto" }, t.qa);
  check("alta con un estado fuera del catálogo → 400", roto.status === 400, `${roto.status} ${roto.data?.message}`);
  const fecha = await api("POST", "/inventory/equipos", { nombre: `Equipo fecha ${unico()}`, estado: "operativo", fecha_prox_calibracion: "31/12/2027" }, t.qa);
  check("próxima calibración que no es AAAA-MM-DD → 400", fecha.status === 400 && fecha.data?.campo === "fecha_prox_calibracion", `${fecha.status} ${fecha.data?.message}`);
  const E = await nuevoEquipo({ fecha_prox_calibracion: "2027-12-31" });
  const edita = await api("PUT", `/inventory/equipos/${E}`, { nombre: "Equipo editado", estado: "averiado" }, t.qa);
  check("editar con un estado fuera del catálogo → 400", edita.status === 400 && edita.data?.campo === "estado", `${edita.status} ${edita.data?.message}`);
}

/* ---------- Movimientos ---------- */
{
  const nombre = `Reactivo integral ${unico()}`;
  const R = (await api("POST", "/inventory/reactivos", { tipo_reactivo: "alcoholes_solventes", producto: nombre, capacidad: 1, unidad_capacidad: "L", piezas: 2 }, t.qa)).data?.id;
  const existencia = () => Number(fila("SELECT cantidad_actual FROM reactivos WHERE id = ?", R)?.cantidad_actual);
  const salida = await api("POST", `/inventory/reactivos/${R}/refill`, { tipo: "salida", cantidad: 5, motivo: "Más de lo que hay" }, t.ricardo);
  check("salida mayor a la existencia → 409 existencia_insuficiente (como los formatos)", salida.status === 409 && salida.data?.codigo === "existencia_insuficiente" && existencia() === 2, `${salida.status} ${salida.data?.message} ${existencia()}`);
  const ajuste = await api("POST", `/inventory/reactivos/${R}/refill`, { tipo: "ajuste", cantidad: 2, motivo: "Conteo físico sin diferencia" }, t.ricardo);
  const mov = fila("SELECT cantidad, CAST(cantidad AS TEXT) AS texto FROM movimientos WHERE tabla_origen = 'reactivos' AND id_item = ? AND tipo = 'ajuste' ORDER BY id DESC", R);
  check("ajuste igual a la existencia: se guarda 0 (no −0)", ajuste.status === 200 && mov && Number(mov.cantidad) === 0 && !String(mov.texto).startsWith("-") && !Object.is(mov.cantidad, -0), `${ajuste.status} ${JSON.stringify(mov)}`);
  await api("POST", `/inventory/reactivos/${R}/refill`, { tipo: "entrada", cantidad: 1, motivo: "Entrada para filtrar" }, t.ricardo);
  const enBase = filas("SELECT id FROM movimientos WHERE tabla_origen = 'reactivos' AND id_item = ?", R).length;
  const propios = (await api("GET", `/inventory/movimientos?tabla=reactivos&id=${R}`, undefined, t.ricardo)).data?.items || [];
  check("movimientos de un insumo, filtrados en el servidor (los mismos que en la base)", enBase >= 2 && propios.length === enBase && propios.every((m) => m.tabla_origen === "reactivos" && Number(m.id_item) === R), `${propios.length}/${enBase}`);
  const porTipo = (await api("GET", `/inventory/movimientos?tabla=reactivos&id=${R}&tipo=ajuste`, undefined, t.ricardo)).data?.items || [];
  check("…por tipo", porTipo.length === 1 && porTipo[0].tipo === "ajuste", `${porTipo.length}`);
  const porTexto = (await api("GET", `/inventory/movimientos?buscar=${encodeURIComponent(nombre.toLowerCase())}`, undefined, t.ricardo)).data?.items || [];
  check("…y por texto (nombre del insumo)", porTexto.length === enBase && porTexto.every((m) => Number(m.id_item) === R), `${porTexto.length}`);

  const baja = await api("DELETE", `/inventory/reactivos/${R}`, { motivo: "Prueba integral: frasco retirado" }, t.qa);
  check("(preparación) reactivo dado de baja", baja.status === 200, `${baja.status} ${baja.data?.message}`);
  const enBaja = await api("POST", `/inventory/reactivos/${R}/refill`, { tipo: "entrada", cantidad: 1, motivo: "Entrada a un retirado" }, t.ricardo);
  check("movimiento sobre un reactivo dado de baja → 409 dado_de_baja", enBaja.status === 409 && enBaja.data?.codigo === "dado_de_baja" && existencia() === 3, `${enBaja.status} ${enBaja.data?.message} ${existencia()}`);
  const C = (await api("POST", "/consumables", { producto: `Consumible integral ${unico()}`, piezas: 2, cantidad_por_pieza: 10 }, t.qa)).data?.id;
  await api("DELETE", `/consumables/${C}`, { motivo: "Prueba integral: caja retirada" }, t.qa);
  const cBaja = await api("POST", `/consumables/${C}/refill`, { tipo: "consumo", cantidad: 1, motivo: "Consumo de un retirado" }, t.ricardo);
  check("movimiento sobre un consumible dado de baja → 409 dado_de_baja", cBaja.status === 409 && cBaja.data?.codigo === "dado_de_baja", `${cBaja.status} ${cBaja.data?.message}`);

  // Reversión: una salida de un formato que se revirtió se marca, y la entrada que la revierte lleva revierte_id.
  const rev = fila("SELECT m.id, m.revierte_id FROM movimientos m WHERE m.revierte_id IS NOT NULL ORDER BY m.id DESC");
  if (rev) {
    const lista = (await api("GET", `/inventory/movimientos?tabla=reactivos&limite=1000`, undefined, t.ricardo)).data?.items || [];
    const original = lista.find((m) => Number(m.id) === Number(rev.revierte_id));
    const entrada = lista.find((m) => Number(m.id) === Number(rev.id));
    check("la lista marca la salida revertida y la entrada que la revierte", (!original || Number(original.revertido_por) === Number(rev.id)) && (!entrada || Number(entrada.revierte_id) === Number(rev.revierte_id)) && (!!original || !!entrada), `${JSON.stringify(original && { id: original.id, revertido_por: original.revertido_por })} ${JSON.stringify(entrada && { id: entrada.id, revierte_id: entrada.revierte_id })}`);
  } else check("(sin reversiones en la base de prueba: se omite la marca de reversión)", true);
}

/* ---------- Reporte de mantenimiento: integridad al abrir ---------- */
{
  const E = await nuevoEquipo();
  const M = (await api("POST", "/inventory/mantenimientos", mant(E), t.carmen)).data?.id;
  const fd = new FormData();
  fd.append("archivo", new Blob([await pdfConTexto(1, "Reporte integral")]), "reporte integral.pdf");
  fd.append("id_mantenimiento", String(M));
  const sub = await api("POST", "/documents/maintenance-report", fd, t.carmen);
  const rep = fila("SELECT * FROM reportes_mantenimiento WHERE id = ?", sub.data?.id);
  const url = `/documents/files/${rep.nombre_almacenado}`;
  const ok = await api("GET", url, undefined, t.hector);
  check("abrir el reporte verifica su SHA-256 y lo sirve con su nombre original", ok.status === 200 && ok.headers.get("x-integridad-archivo") === "ok" && /reporte%20integral\.pdf/.test(ok.headers.get("content-disposition") || ""), `${ok.status} ${ok.headers.get("x-integridad-archivo")} ${ok.headers.get("content-disposition")}`);
  check("…y la consulta queda en la bitácora («descargar»)", !!fila("SELECT id FROM auditoria WHERE accion = 'descargar' AND entidad = 'reportes_mantenimiento' AND entidad_id = ?", String(rep.id)));
  const ruta = path.join(path.dirname(process.env.TEST_DB_PATH), "maintenance_reports", ...String(rep.nombre_almacenado).split("/"));
  writeFileSync(ruta, Buffer.concat([readFileSync(ruta), Buffer.from("alterado")]));
  const alterado = await api("GET", url, undefined, t.hector);
  check("reporte alterado → X-Integridad-Archivo alterado", alterado.headers.get("x-integridad-archivo") === "alterado", `${alterado.status} ${alterado.headers.get("x-integridad-archivo")}`);
  check("…con alerta_integridad y una incidencia automática", !!fila("SELECT id FROM auditoria WHERE accion = 'alerta_integridad' AND entidad = 'reportes_mantenimiento' AND entidad_id = ?", String(rep.id)) && !!fila("SELECT id FROM incidencias WHERE clave_automatica = ?", `alerta_integridad:reporte_mantenimiento:${rep.id}:alterado`));
  check("(los reportes de la base siguen enlazados a su mantenimiento)", filas("SELECT id FROM reportes_mantenimiento WHERE id_mantenimiento = ?", M).length === 1);
}

/* ---------- Reactivos y consumibles: tipo y fechas ---------- */
{
  const reactivo = (extra) => ({ tipo_reactivo: "acidos", producto: `Ácido integral ${unico()}`, capacidad: 1, unidad_capacidad: "L", piezas: 1, ...extra });
  const tipoRaro = await api("POST", "/inventory/reactivos", reactivo({ tipo_reactivo: "inventado" }), t.qa);
  check("reactivo con tipo fuera del catálogo → 400", tipoRaro.status === 400, `${tipoRaro.status} ${tipoRaro.data?.message}`);
  const cadMala = await api("POST", "/inventory/reactivos", reactivo({ caducidad: "31/12/2027" }), t.qa);
  check("reactivo con caducidad «31/12/2027» → 400 (no se guarda un texto que salta los avisos)", cadMala.status === 400 && /Caducidad/.test(cadMala.data?.message || ""), `${cadMala.status} ${cadMala.data?.message}`);
  const aperturaMala = await api("POST", "/inventory/reactivos", reactivo({ fecha_apertura: "2027-02-30" }), t.qa);
  check("reactivo con fecha de apertura imposible (2027-02-30) → 400", aperturaMala.status === 400, `${aperturaMala.status} ${aperturaMala.data?.message}`);
  const bueno = await api("POST", "/inventory/reactivos", reactivo({ caducidad: "2027-12-31", fecha_ingreso: "2026-01-15" }), t.qa);
  check("…con fechas AAAA-MM-DD se da de alta", bueno.status === 201 && fila("SELECT caducidad FROM reactivos WHERE id = ?", bueno.data?.id)?.caducidad === "2027-12-31", `${bueno.status} ${bueno.data?.message}`);
  // Un valor heredado del Excel («dic-2026») se conserva mientras no se cambie.
  const b = new Database(process.env.TEST_DB_PATH);
  b.prepare("UPDATE reactivos SET caducidad = 'dic-2026', expiration_date = 'dic-2026', fecha_vencimiento = 'dic-2026' WHERE id = ?").run(bueno.data?.id);
  b.close();
  const conserva = await api("PUT", `/inventory/reactivos/${bueno.data?.id}`, { ...reactivo({ producto: "Ácido integral editado" }), caducidad: "dic-2026" }, t.qa);
  check("…editar otro dato conserva la caducidad heredada sin cambiar", conserva.status === 200 && fila("SELECT caducidad FROM reactivos WHERE id = ?", bueno.data?.id)?.caducidad === "dic-2026", `${conserva.status} ${conserva.data?.message}`);
  const consMala = await api("POST", "/consumables", { producto: `Consumible fecha ${unico()}`, piezas: 1, cantidad_por_pieza: 5, fecha_ingreso: "ayer" }, t.qa);
  check("consumible con fecha de ingreso «ayer» → 400", consMala.status === 400 && /Fecha de ingreso/.test(consMala.data?.message || ""), `${consMala.status} ${consMala.data?.message}`);
  const consSf = await api("POST", "/consumables", { producto: `Consumible s/f ${unico()}`, piezas: 1, cantidad_por_pieza: 5, fecha_ingreso: "s/f" }, t.qa);
  check("…«s/f» sigue aceptándose (sin fecha)", consSf.status === 201, `${consSf.status} ${consSf.data?.message}`);
}

terminar();
