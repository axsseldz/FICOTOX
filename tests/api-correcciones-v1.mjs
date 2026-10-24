/*
 * Correcciones de la V1, por la API (caso normal, rechazo y lo que ya existia):
 * 2a disposicion final solo con el informe liberado o enviado (rechazada: con motivo);
 * 2b etiquetas con los mismos alcances que la vista de la muestra (estado, asignado);
 * 2c informes:E para Coord. del Area Tecnica en borradores, con la segregacion intacta;
 * 2d sin inventario negativo (mensaje con reactivo y cantidades; al editar cuenta lo propio);
 * 2e anular o reeditar agrega una entrada de reversion ligada (no borra movimientos);
 * 2f mantenimiento programado con fecha pasada -> «vencido» (sistema, idempotente);
 * 3a R1 confirmar firma: los fallos cuentan para el bloqueo y hay limite por sesion;
 * 3b R2/R5 salir o cierre por inactividad revocan el token en el servidor;
 * 3c R8 ampliar permisos de un rol pide un segundo usuario (quitar es directo);
 * 3d R10 cuenta nueva: cambio de contrasena obligatorio en la primera entrada.
 */
import "./lib/reauth-auto.mjs";
import { analisisDe, api, cadena, crearCheck, credenciales, EMAIL, fila, filas, informeLiberado, login, sesiones } from "./lib/calidad.mjs";

const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const MANUAL = { "X-Sin-Aprobar-Auto": "1" };
const unico = () => Date.now().toString(36).slice(-6);
// IP propia por bloque: los fallos de contrasena de esta suite no bloquean la IP de las demas.
const ip = (n) => ({ "X-Forwarded-For": `10.26.${n}.${Math.floor(Math.random() * 200) + 1}` });
const existencia = (rid) => Number(fila("SELECT cantidad_actual AS c FROM reactivos WHERE id = ?", rid)?.c);
const disposicion = { tipo: "rpbi", fecha: "2026-10-18", responsable: "Coordinación técnica" };
const auxiliar = ((await api("GET", "/admin/roles", undefined, t.qa)).data?.items || []).find((r) => r.nombre === "Técnico Auxiliar")?.id;
// Alta de una cuenta de prueba (el rol inicial queda en solicitud: no hace falta para estas pruebas).
const altaCuenta = (nombre, email, password) => api("POST", "/admin/usuarios", { nombre, email, activo: true, rol_id: auxiliar, password, motivo: `Alta de prueba ${nombre}` }, t.qa, MANUAL);

/* ================= 2a. Disposicion final ================= */
{
  const sinInforme = await cadena(t, "DISP-SIN");
  const vista = (await api("GET", `/samples/reception/${sinInforme.R}`, undefined, t.ricardo)).data?.item;
  const bloqueada = await api("POST", `/samples/reception/${sinInforme.R}/disposicion`, disposicion, t.ricardo);
  const sigue = fila("SELECT estado, disposicion_json FROM muestras_recepcion WHERE id = ?", sinInforme.R);
  check("2a sin informe liberado: 409 informe_no_liberado, «Falta liberar el informe» y la muestra no se cierra", bloqueada.status === 409 && bloqueada.data?.codigo === "informe_no_liberado" && /Falta liberar el informe/.test(bloqueada.data?.message) && vista?.disposicion_bloqueo === "Falta liberar el informe" && sigue?.estado !== "cerrada" && !sigue?.disposicion_json, `${bloqueada.status} ${bloqueada.data?.message} | ${vista?.disposicion_bloqueo} | ${sigue?.estado}`);

  const liberado = await informeLiberado(t, "DISP-LIB");
  const vistaLib = (await api("GET", `/samples/reception/${liberado.R}`, undefined, t.ricardo)).data?.item;
  const ok = await api("POST", `/samples/reception/${liberado.R}/disposicion`, disposicion, t.ricardo);
  check("2a con el informe liberado: sin bloqueo y la disposición cierra la muestra", liberado.liberado && !vistaLib?.disposicion_bloqueo && ok.status === 200 && ok.data?.item?.estado === "cerrada", `${liberado.liberado} ${vistaLib?.disposicion_bloqueo} ${ok.status} ${ok.data?.message}`);

  const enviado = await informeLiberado(t, "DISP-ENV", { enviar: true });
  const okEnv = await api("POST", `/samples/reception/${enviado.R}/disposicion`, disposicion, t.ricardo);
  check("2a con el informe enviado: la disposición procede", enviado.enviado && okEnv.status === 200, `${enviado.enviado} ${okEnv.status} ${okEnv.data?.message}`);

  const rech = await cadena(t, "DISP-RECH", { decision: "rechazada" });
  const estadoRech = fila("SELECT estado FROM muestras_recepcion WHERE id = ?", rech.R)?.estado;
  const vistaRech = (await api("GET", `/samples/reception/${rech.R}`, undefined, t.ricardo)).data?.item;
  const sinMotivo = await api("POST", `/samples/reception/${rech.R}/disposicion`, disposicion, t.ricardo);
  const conMotivo = await api("POST", `/samples/reception/${rech.R}/disposicion`, { ...disposicion, tipo: "devuelto_cliente", motivo: "Se devuelve al cliente: muestra rechazada en la recepción" }, t.ricardo);
  const disp = JSON.parse(fila("SELECT disposicion_json AS d FROM muestras_recepcion WHERE id = ?", rech.R)?.d || "{}");
  const ev = fila("SELECT motivo FROM auditoria WHERE entidad = 'muestras_recepcion' AND entidad_id = ? AND accion = 'cerrar' ORDER BY id DESC LIMIT 1", String(rech.R));
  check("2a rechazada en la recepción: sin bloqueo; sin motivo → 400 (campo motivo); con motivo → cerrada y el motivo queda en la disposición y la bitácora", estadoRech === "rechazada" && !vistaRech?.disposicion_bloqueo && sinMotivo.status === 400 && sinMotivo.data?.campo === "motivo" && conMotivo.status === 200 && disp.sin_informe === true && /devuelve/.test(disp.motivo) && /devuelve/.test(ev?.motivo || ""), `${estadoRech} ${sinMotivo.status} ${conMotivo.status} ${conMotivo.data?.message} ${JSON.stringify(disp).slice(0, 80)}`);
}

/* ================= 2b. Etiquetas ================= */
{
  const asignada = await cadena(t, "ETQ-ASG", { asignar: [id.luis] });
  const ajena = await cadena(t, "ETQ-AJN");
  const luisAsignada = await api("GET", `/samples/reception/${asignada.R}/etiquetas`, undefined, t.luis);
  const luisAjena = await api("GET", `/samples/reception/${ajena.R}/etiquetas`, undefined, t.luis);
  const luisImprimeAjena = await api("POST", `/samples/reception/${ajena.R}/etiquetas`, { cantidad: 1 }, t.luis);
  check("2b alcance «asignado» (Técnico Analista): su muestra asignada → 200; una ajena → 403 no_asignado (ver e imprimir)", luisAsignada.status === 200 && luisAjena.status === 403 && luisAjena.data?.codigo === "no_asignado" && luisImprimeAjena.status === 403, `${luisAsignada.status} | ${luisAjena.status} ${luisAjena.data?.codigo} | ${luisImprimeAjena.status}`);
  const carmen = await api("GET", `/samples/reception/${asignada.R}/etiquetas`, undefined, t.carmen);
  const carmenVista = (await api("GET", `/samples/reception/${asignada.R}`, undefined, t.carmen)).data?.item;
  check("2b alcance «estado» (Administradora Auxiliar): etiquetas → 403 solo_estado y la vista lo marca (la opción se oculta)", carmen.status === 403 && carmen.data?.codigo === "solo_estado" && carmenVista?.solo_estado === true, `${carmen.status} ${carmen.data?.codigo} ${carmenVista?.solo_estado}`);
  const total = await api("GET", `/samples/reception/${ajena.R}/etiquetas`, undefined, t.ricardo);
  check("2b alcance total (Coord. Área Técnica): etiquetas de cualquier muestra → 200", total.status === 200, `${total.status}`);
}

/* ================= 2c. informes:E (Coord. del Area Tecnica) ================= */
{
  const c = await cadena(t, "INF-E");
  const A = (await api("POST", "/samples/analysis", analisisDe(c), t.qa)).data?.id;
  await api("POST", `/samples/analysis/${A}/enviar-revision`, {}, t.qa);
  await api("POST", `/samples/analysis/${A}/revisar`, {}, t.ricardo);
  await api("POST", `/samples/analysis/${A}/aprobar`, {}, t.ricardo);
  const inf = (await api("POST", "/informes", { recepcion_id: c.R, analisis_ids: [A], cliente: { nombre: "Cliente INF-E", correo: "cliente@ejemplo.mx" } }, t.qa)).data?.id;
  const cuerpo = { recepcion_id: c.R, analisis_ids: [A], cliente: { nombre: "Cliente INF-E editado", correo: "cliente@ejemplo.mx" }, observaciones: "Corregido por la Coordinación técnica" };
  const me = (await api("GET", "/auth/me", undefined, t.ricardo)).data;
  const puede = (me?.permisos || me?.user?.permisos || []).some?.((p) => p.modulo === "informes" && p.accion === "E");
  const edita = await api("PUT", `/informes/${inf}`, cuerpo, t.ricardo);
  const guardado = fila("SELECT estado, observaciones, cliente_json FROM informes WHERE id = ?", inf);
  check("2c Coord. Área Técnica edita un borrador de informe: 200 y queda guardado (sigue en borrador)", edita.status === 200 && guardado?.estado === "borrador" && guardado?.observaciones === cuerpo.observaciones && /editado/.test(guardado?.cliente_json || ""), `${edita.status} ${edita.data?.message} ${guardado?.estado} permiso_en_sesion=${puede}`);
  const luis = await api("PUT", `/informes/${inf}`, cuerpo, t.luis);
  check("2c sin informes:E (Técnico Analista) → 403", luis.status === 403, `${luis.status}`);
  const revisaEditor = await api("POST", `/informes/${inf}/revisar`, {}, t.ricardo);
  check("2c segregación: quien editó el informe ya no lo revisa (409 segregacion)", revisaEditor.status === 409 && revisaEditor.data?.codigo === "segregacion", `${revisaEditor.status} ${revisaEditor.data?.codigo} ${revisaEditor.data?.message}`);
  const revisaOtra = await api("POST", `/informes/${inf}/revisar`, {}, t.patricia);
  const editaRevisado = await api("PUT", `/informes/${inf}`, cuerpo, t.ricardo);
  check("2c lo revisa otra persona; fuera de borrador ya no se edita (409)", revisaOtra.status === 200 && editaRevisado.status === 409, `${revisaOtra.status} ${revisaOtra.data?.message} | ${editaRevisado.status}`);
  const filaRol = fila("SELECT 1 AS x FROM rol_acciones ra JOIN roles r ON r.id = ra.id_rol WHERE r.clave = 'coord_area_tecnica' AND ra.modulo = 'informes' AND ra.accion = 'E'");
  check("2c migración 26: la matriz del rol tiene informes:E", !!filaRol, JSON.stringify(filaRol));
}

/* ================= 2d y 2e. Inventario: sin negativos y reversiones ================= */
{
  const nombre = `Metanol correcciones ${unico()}`;
  const rid = (await api("POST", "/inventory/reactivos", { tipo_reactivo: "alcoholes_solventes", producto: nombre, capacidad: 0.5, unidad_capacidad: "L", piezas: 1 }, t.qa)).data?.id;
  const c = await cadena(t, "INV");
  const extraccion = (uso) => ({ tipo_registro: "E-D", procesamiento_id: c.P, tipo_molienda: "fresca", id_interno: c.idInt, fecha_extraccion: "2026-10-18", registro_pesos: [{ id_muestra: c.idInt, replica: `${c.idInt}_R1`, peso_muestra: 2.01 }], nombre_quien_extrajo: "Persona A", nombre_quien_superviso: "Persona B", uso_inventario: uso });
  const extraccionesAntes = Number(fila("SELECT COUNT(*) AS n FROM muestras_extraccion").n);

  const excede = await api("POST", "/samples/extraction", extraccion([{ tipo: "reactivo", ref: String(rid), cantidad: 0.6 }]), t.qa);
  check("2d consumir más de lo disponible: 409 existencia_insuficiente con reactivo y cantidades, sin registro ni descuento", excede.status === 409 && excede.data?.codigo === "existencia_insuficiente" && excede.data?.message === `${nombre}: disponible 0.5 L, se requieren 0.6 L` && Number(fila("SELECT COUNT(*) AS n FROM muestras_extraccion").n) === extraccionesAntes && existencia(rid) === 0.5, `${excede.status} ${excede.data?.message} existencia=${existencia(rid)}`);
  const dosRenglones = await api("POST", "/samples/extraction", extraccion([{ tipo: "reactivo", ref: String(rid), cantidad: 0.3 }, { tipo: "reactivo", ref: String(rid), cantidad: 0.3 }]), t.qa);
  check("2d el mismo reactivo en dos renglones suma lo pedido (0.6 > 0.5) → 409", dosRenglones.status === 409 && /se requieren 0.6 L/.test(dosRenglones.data?.message), `${dosRenglones.status} ${dosRenglones.data?.message}`);

  const alta = await api("POST", "/samples/extraction", extraccion([{ tipo: "reactivo", ref: String(rid), cantidad: 0.2 }]), t.qa);
  const E = alta.data?.id;
  const edicion = (uso, extra = {}) => ({ ...extraccion(uso), folio_num: alta.data?.folio_num, ...extra });
  check("2d dentro de lo disponible: 201 y descuenta (0.5 → 0.3)", alta.status === 201 && Math.abs(existencia(rid) - 0.3) < 1e-9, `${alta.status} ${alta.data?.message} existencia=${existencia(rid)}`);

  // Editar: lo disponible incluye lo que el mismo registro ya consumio (0.3 + 0.2 = 0.5).
  const editaAlLimite = await api("PUT", `/samples/extraction/${E}`, edicion([{ tipo: "reactivo", ref: String(rid), cantidad: 0.5 }]), t.qa);
  check("2d al editar cuenta lo que el registro ya consumió: subir de 0.2 a 0.5 procede (queda 0)", editaAlLimite.status === 200 && Math.abs(existencia(rid)) < 1e-9, `${editaAlLimite.status} ${editaAlLimite.data?.message} existencia=${existencia(rid)}`);
  const movsTrasEdicion = filas("SELECT id, tipo, cantidad, referencia, revierte_id, motivo FROM movimientos WHERE tabla_origen = 'reactivos' AND id_item = ? ORDER BY id", rid);
  const salida1 = movsTrasEdicion.find((m) => m.tipo === "salida" && m.referencia === `EXT-${E}-INS-0`);
  const rev1 = movsTrasEdicion.find((m) => m.tipo === "entrada" && m.revierte_id === salida1?.id);
  const salida2 = movsTrasEdicion.find((m) => m.tipo === "salida" && m.referencia === `EXT-${E}-INS-0-r2`);
  check("2e reeditar no borra: la salida original sigue, se agrega su entrada de reversión ligada y una salida nueva (-r2)", !!salida1 && Number(salida1.cantidad) === 0.2 && !!rev1 && Number(rev1.cantidad) === 0.2 && rev1.referencia === `EXT-${E}-INS-0-REV` && /Reversión \(reedición\)/.test(rev1.motivo) && !!salida2 && Number(salida2.cantidad) === 0.5, JSON.stringify(movsTrasEdicion));
  const evRev = fila("SELECT accion, motivo, coalesce(cambios_json, '') || coalesce(datos_nuevos_json, '') AS d FROM auditoria WHERE entidad = 'muestras_extraccion' AND entidad_id = ? AND accion = 'reponer' ORDER BY id DESC LIMIT 1", String(E));
  check("2e la reversión queda en la bitácora («reponer», tipo reversion, ligada a la salida)", !!evRev && /reversion/.test(evRev.d) && evRev.d.includes(String(salida1?.id)) && evRev.d.includes(String(rev1?.id)), JSON.stringify(evRev)?.slice(0, 200));

  const editaExcede = await api("PUT", `/samples/extraction/${E}`, edicion([{ tipo: "reactivo", ref: String(rid), cantidad: 0.6 }]), t.qa);
  check("2d al editar por encima de disponible + lo propio (0.6 > 0 + 0.5) → 409 y nada cambia", editaExcede.status === 409 && editaExcede.data?.message === `${nombre}: disponible 0.5 L, se requieren 0.6 L` && Math.abs(existencia(rid)) < 1e-9 && filas("SELECT id FROM movimientos WHERE tabla_origen = 'reactivos' AND id_item = ?", rid).length === movsTrasEdicion.length, `${editaExcede.status} ${editaExcede.data?.message}`);
  const mismo = await api("PUT", `/samples/extraction/${E}`, edicion([{ tipo: "reactivo", ref: String(rid), cantidad: 0.5 }], { observaciones: "Solo cambia el texto" }), t.qa);
  check("2e volver a guardar sin cambiar los insumos no crea movimientos", mismo.status === 200 && filas("SELECT id FROM movimientos WHERE tabla_origen = 'reactivos' AND id_item = ?", rid).length === movsTrasEdicion.length, `${mismo.status} ${mismo.data?.message}`);

  const anula = await api("POST", `/samples/extraction/${E}/anular`, { motivo: "Registro de prueba de reversión" }, t.qa);
  const movsFinal = filas("SELECT id, tipo, cantidad, referencia, revierte_id FROM movimientos WHERE tabla_origen = 'reactivos' AND id_item = ? ORDER BY id", rid);
  const rev2 = movsFinal.find((m) => m.tipo === "entrada" && m.revierte_id === salida2?.id);
  const salidas = movsFinal.filter((m) => m.tipo === "salida").reduce((a, m) => a + Number(m.cantidad), 0);
  const entradas = movsFinal.filter((m) => m.tipo === "entrada" && m.revierte_id).reduce((a, m) => a + Number(m.cantidad), 0);
  check("2e anular: entrada de reversión de la salida vigente, ninguna salida borrada y la existencia vuelve a 0.5 (= inicial − salidas + reversiones)", anula.status === 200 && !!rev2 && Number(rev2.cantidad) === 0.5 && movsFinal.filter((m) => m.tipo === "salida").length === 2 && Math.abs(existencia(rid) - 0.5) < 1e-9 && Math.abs(0.5 - salidas + entradas - existencia(rid)) < 1e-9, `${anula.status} ${anula.data?.message} ${JSON.stringify(movsFinal)}`);
  const evAnula = fila("SELECT motivo, coalesce(cambios_json, '') || coalesce(datos_nuevos_json, '') AS d FROM auditoria WHERE entidad = 'muestras_extraccion' AND entidad_id = ? AND accion = 'reponer' ORDER BY id DESC LIMIT 1", String(E));
  check("2e la reversión por anulación queda en la bitácora con el motivo", /anulación/.test(evAnula?.d || "") && /reversión/i.test(evAnula?.motivo || ""), JSON.stringify(evAnula)?.slice(0, 200));
}

/* ================= 2f. Mantenimiento vencido ================= */
{
  const equipoId = (await api("POST", "/inventory/equipos", { nombre: `Equipo vencimiento ${unico()}`, estado: "operativo" }, t.qa)).data?.id;
  const pasado = (await api("POST", "/inventory/mantenimientos", { id_equipo: equipoId, tipo: "preventivo", fecha_programada: "2026-01-15", estado: "programado", tecnico_proveedor: "Servicio externo" }, t.carmen)).data?.id;
  const futuro = (await api("POST", "/inventory/mantenimientos", { id_equipo: equipoId, tipo: "preventivo", fecha_programada: "2027-06-01", estado: "programado" }, t.carmen)).data?.id;
  const lista = (await api("GET", "/inventory/mantenimientos", undefined, t.carmen)).data?.items || [];
  const enLista = lista.find((m) => Number(m.id) === pasado);
  const enListaFuturo = lista.find((m) => Number(m.id) === futuro);
  const eventos = () => filas("SELECT usuario_id, accion FROM auditoria WHERE entidad = 'mantenimientos' AND entidad_id = ? AND accion = 'vencer_mantenimiento'", String(pasado));
  check("2f programado con fecha pasada → «vencido» al consultar la lista; el de fecha futura sigue programado", enLista?.estado === "vencido" && enListaFuturo?.estado === "programado", `${enLista?.estado} ${enListaFuturo?.estado}`);
  check("2f bitácora: un «vencer_mantenimiento» como acción del sistema (sin usuario)", eventos().length === 1 && eventos()[0].usuario_id === null, JSON.stringify(eventos()));
  await api("GET", "/inventory/mantenimientos", undefined, t.carmen);
  await api("GET", "/inventory/mantenimientos", undefined, t.qa);
  check("2f idempotente: consultar otra vez no duplica el evento", eventos().length === 1, `${eventos().length}`);
  const equipoVencido = fila("SELECT estado FROM equipos WHERE id = ?", equipoId)?.estado;
  check("2f el equipo sigue «en mantenimiento» mientras hay uno vencido", equipoVencido === "mantenimiento", `${equipoVencido}`);
  // Cancelar es la acción con motivo y contraseña (equipos:AN); por el formulario ya no se cancela.
  await api("DELETE", `/inventory/mantenimientos/${futuro}`, { motivo: "Prueba: ya no hace falta el preventivo" }, t.qa);
  const completa = await api("PUT", `/inventory/mantenimientos/${pasado}`, { id_equipo: equipoId, tipo: "preventivo", fecha_programada: "2026-01-15", fecha_realizado: "2026-10-18", estado: "completado", tecnico_proveedor: "Servicio externo" }, t.carmen);
  const despues = fila("SELECT m.estado AS m, e.estado AS e FROM mantenimientos m JOIN equipos e ON e.id = m.id_equipo WHERE m.id = ?", pasado);
  check("2f completar el vencido sigue el flujo normal: completado y el equipo vuelve a operativo", completa.status === 200 && despues?.m === "completado" && despues?.e === "operativo", `${completa.status} ${completa.data?.message} ${JSON.stringify(despues)}`);
}

/* ================= 3a. R1 confirmar firma ================= */
{
  // Cuenta propia del bloque (cambia su contrasena temporal) para no bloquear cuentas del catalogo.
  const email = `firma.r1.${unico()}@cicese.mx`;
  const temporal = "Temporal-R1-2026!";
  const definitiva = "Definitiva-R1-2026!";
  const altaR1 = await altaCuenta("Firmante R1", email, temporal);
  const tok = (await api("POST", "/auth/login", { email, password: temporal })).data?.token;
  await api("POST", "/auth/password", { actual: temporal, nueva: definitiva }, tok);
  const uid = altaR1.data?.id;
  const sesionA = await login(EMAIL.gabriela);
  const red = ip(1);
  const fallos = [];
  for (let i = 0; i < 5; i += 1) fallos.push((await api("POST", "/firmas/confirmar", { usuario_id: uid, password: `incorrecta-${i}` }, sesionA, red)).status);
  const cuenta = fila("SELECT bloqueado_hasta FROM usuarios WHERE id = ?", uid);
  const entrar = await api("POST", "/auth/login", { email, password: definitiva }, undefined, ip(2));
  check("3a fallos al confirmar la firma de otra cuenta cuentan para su bloqueo: 5 fallos → la cuenta queda bloqueada y no entra", fallos.every((s) => s === 401) && !!cuenta?.bloqueado_hasta && cuenta.bloqueado_hasta > new Date().toISOString() && entrar.status !== 200, `${fallos} ${cuenta?.bloqueado_hasta} login=${entrar.status}`);
  const intentosR1 = fila("SELECT COUNT(*) AS n FROM intentos_acceso WHERE usuario_id = ? AND tipo = 'firma' AND exito = 0", uid);
  const evR1 = fila("SELECT usuario_id FROM auditoria WHERE accion = 'reauth_fallida' AND entidad = 'usuarios' AND entidad_id = ? ORDER BY id DESC LIMIT 1", String(uid));
  check("3a cada fallo queda como intento «firma» de la cuenta y en la bitácora a nombre de quien lo intentó", Number(intentosR1?.n) === 5 && Number(evR1?.usuario_id) === Number(id.gabriela), `${intentosR1?.n} ${evR1?.usuario_id}/${id.gabriela}`);
  const sexto = await api("POST", "/firmas/confirmar", { usuario_id: id.luis, password: credenciales[EMAIL.luis] }, sesionA, red);
  check("3a límite por sesión: tras 5 fallos esa sesión recibe 429 aun con una contraseña correcta de otra cuenta", sexto.status === 429 && sexto.data?.codigo === "firma_intentos", `${sexto.status} ${sexto.data?.message}`);
  const otraSesion = await login(EMAIL.gabriela);
  const okOtra = await api("POST", "/firmas/confirmar", { usuario_id: id.luis, password: credenciales[EMAIL.luis] }, otraSesion, ip(3));
  check("3a otra sesión no hereda el límite y confirma con normalidad (token_firma)", okOtra.status === 200 && !!okOtra.data?.token_firma, `${okOtra.status} ${okOtra.data?.message}`);
  await api("POST", "/auth/logout", {}, otraSesion);
  const revocada = await api("POST", "/firmas/confirmar", { usuario_id: id.luis, password: credenciales[EMAIL.luis] }, otraSesion, ip(3));
  check("3a con la sesión revocada: 401 sesion_revocada", revocada.status === 401 && revocada.data?.codigo === "sesion_revocada", `${revocada.status} ${revocada.data?.codigo}`);
}

/* ================= 3b. R2/R5 revocacion en el servidor ================= */
{
  const s1 = await login(EMAIL.mariana);
  const s2 = await login(EMAIL.mariana);
  const antes = await Promise.all([api("GET", "/auth/me", undefined, s1), api("GET", "/autorizaciones/mias", undefined, s1), api("GET", "/cuentas/activas", undefined, s1)]);
  const salir = await api("POST", "/auth/logout", { motivo: "salir" }, s1);
  const tras = await Promise.all([api("GET", "/auth/me", undefined, s1), api("GET", "/autorizaciones/mias", undefined, s1), api("GET", "/autorizaciones/catalogo", undefined, s1), api("GET", "/cuentas/activas", undefined, s1), api("GET", `/cuentas/${id.mariana}/foto`, undefined, s1), api("GET", "/samples/reception", undefined, s1)]);
  check("3b antes de salir la sesión funciona (me, autorizaciones, cuentas activas)", antes.every((r) => r.status === 200), antes.map((r) => r.status).join(","));
  check("3b «Salir» revoca el token en el servidor: me, autorizaciones, catálogo, cuentas activas, foto y módulos → 401 sesion_revocada", salir.status === 200 && salir.data?.revocada === true && tras.every((r) => r.status === 401 && r.data?.codigo === "sesion_revocada"), `${salir.status} | ${tras.map((r) => `${r.status}:${r.data?.codigo}`).join(", ")}`);
  const otra = await api("GET", "/auth/me", undefined, s2);
  check("3b las demás sesiones de la persona siguen activas", otra.status === 200, `${otra.status}`);
  const lock = await api("POST", "/auth/logout", { motivo: "inactividad" }, s2);
  const trasLock = await api("GET", "/cuentas/activas", undefined, s2);
  const reg = fila("SELECT motivo, usuario_id FROM sesiones_revocadas WHERE usuario_id = ? ORDER BY revocada_en DESC LIMIT 1", id.mariana);
  check("3b cierre por inactividad: revoca ese token (motivo inactividad); volver a entrar da una sesión nueva", lock.status === 200 && trasLock.status === 401 && reg?.motivo === "inactividad" && (await api("GET", "/auth/me", undefined, await login(EMAIL.mariana))).status === 200, `${lock.status} ${trasLock.status} ${JSON.stringify(reg)}`);
  const repetir = await api("POST", "/auth/logout", { motivo: "salir" }, s1);
  check("3b repetir «Salir» con un token ya revocado no falla", repetir.status === 200, `${repetir.status}`);

  // Cuenta desactivada: los endpoints que solo pedian token ya no responden.
  const email = `inactiva.r5.${unico()}@cicese.mx`;
  const alta = await altaCuenta("Cuenta R5", email, "Temporal-R5-2026!");
  const tk = (await api("POST", "/auth/login", { email, password: "Temporal-R5-2026!" })).data?.token;
  const activa = await api("GET", "/cuentas/activas", undefined, tk);
  const fotoAntes = await api("GET", `/cuentas/${id.mariana}/foto`, undefined, tk);
  const baja = await api("DELETE", `/admin/usuarios/${alta.data?.id}`, { motivo: "Baja de prueba R5" }, t.qa);
  const inactiva = await Promise.all([api("GET", "/cuentas/activas", undefined, tk), api("GET", "/autorizaciones/mias", undefined, tk), api("GET", `/cuentas/${id.mariana}/foto`, undefined, tk)]);
  check("3b cuenta desactivada: cuentas activas, autorizaciones y foto → 401 (antes bastaba el token)", activa.status === 200 && fotoAntes.status !== 401 && baja.status === 200 && inactiva.every((r) => r.status === 401), `${activa.status} ${fotoAntes.status} baja=${baja.status} ${baja.data?.message || ""} | ${inactiva.map((r) => `${r.status}:${r.data?.codigo}`).join(", ")}`);
}

/* ================= 3c. R8 ampliar permisos de un rol ================= */
{
  const roles = (await api("GET", "/admin/roles", undefined, t.jorge)).data?.items || [];
  const rol = roles.find((r) => r.nombre === "Estudiante / personal en formación");
  const detalle = async () => (await api("GET", `/admin/roles/${rol.id}`, undefined, t.jorge)).data;
  const inicial = (await detalle()).permisos || [];
  const tiene = (permisos, f) => permisos.some((p) => p.modulo === f.modulo && p.accion === f.accion && p.alcance === f.alcance);
  const nueva = { modulo: "compras", accion: "V", alcance: "total" };
  const guardar = (permisos, motivo, headers = MANUAL) => api("PUT", `/admin/roles/${rol.id}`, { nombre: rol.nombre, descripcion: rol.descripcion || "", activo: true, permisos, motivo }, t.jorge, headers);

  const amplia = await guardar([...inicial, nueva], "Ampliación de prueba R8");
  const trasAmpliar = (await detalle()).permisos || [];
  const sol = amplia.data?.solicitud;
  check("3c agregar un permiso → 202 solicitud «ampliar_permisos_rol» pendiente; el rol todavía no lo concede", amplia.status === 202 && sol?.tipo === "ampliar_permisos_rol" && sol?.estado === "pendiente" && !tiene(trasAmpliar, nueva) && trasAmpliar.length === inicial.length, `${amplia.status} ${amplia.data?.message} ${sol?.tipo}/${sol?.estado} ${trasAmpliar.length}/${inicial.length}`);
  const propia = await api("POST", `/solicitudes/${sol?.id}/aprobar`, { motivo: "Me la apruebo yo" }, t.jorge);
  check("3c quien la pidió no la aprueba (y sin usuarios:A tampoco)", propia.status >= 400 && !tiene((await detalle()).permisos || [], nueva), `${propia.status} ${propia.data?.message}`);
  const aprueba = await api("POST", `/solicitudes/${sol?.id}/aprobar`, { motivo: "Aprobada por la Responsable General" }, t.patricia);
  const trasAprobar = (await detalle()).permisos || [];
  const evRol = fila("SELECT usuario_id FROM auditoria WHERE entidad = 'roles' AND entidad_id = ? AND accion = 'editar' ORDER BY id DESC LIMIT 1", String(rol.id));
  check("3c un segundo usuario con usuarios:A la aprueba: el rol concede el permiso nuevo y conserva los demás; bitácora a su nombre", aprueba.status === 200 && tiene(trasAprobar, nueva) && trasAprobar.length === inicial.length + 1 && Number(evRol?.usuario_id) === Number(id.patricia), `${aprueba.status} ${aprueba.data?.message} ${trasAprobar.length} ${evRol?.usuario_id}/${id.patricia}`);

  const quita = await guardar(inicial, "Se retira el permiso de prueba R8");
  const trasQuitar = (await detalle()).permisos || [];
  check("3c quitar permisos es directo (200, con motivo y bitácora) y no crea solicitud", quita.status === 200 && !quita.data?.solicitud && !tiene(trasQuitar, nueva) && trasQuitar.length === inicial.length, `${quita.status} ${quita.data?.message} ${trasQuitar.length}`);

  // Cambiar el alcance: ampliarlo va a solicitud y conserva el alcance anterior mientras tanto; reducirlo es directo.
  const parcial = inicial.find((p) => p.alcance !== "total" && !inicial.some((q) => q.modulo === p.modulo && q.accion === p.accion && q.alcance === "total"));
  const aTotal = { ...parcial, alcance: "total" };
  const conTotal = inicial.map((p) => (p === parcial ? aTotal : p));
  const pideTotal = await guardar(conTotal, "Ampliar el alcance (prueba R8)");
  const pendiente = (await detalle()).permisos || [];
  check("3c ampliar el alcance de un permiso → 202 solicitud; mientras tanto conserva el alcance anterior (no lo pierde)", pideTotal.status === 202 && tiene(pendiente, parcial) && !tiene(pendiente, aTotal) && pendiente.length === inicial.length, `${pideTotal.status} ${pideTotal.data?.message} ${JSON.stringify(parcial)} ${pendiente.length}/${inicial.length}`);
  const rechaza = await api("POST", `/solicitudes/${pideTotal.data?.solicitud?.id}/rechazar`, { motivo: "No procede ampliar el alcance" }, t.patricia);
  const trasRechazo = (await detalle()).permisos || [];
  check("3c si la solicitud se rechaza, el rol queda como estaba (con su alcance anterior)", rechaza.status === 200 && tiene(trasRechazo, parcial) && !tiene(trasRechazo, aTotal) && trasRechazo.length === inicial.length, `${rechaza.status} ${rechaza.data?.message} ${trasRechazo.length}`);
  const otraVez = await guardar(conTotal, "Ampliar el alcance (prueba R8, aprobada)");
  const apruebaAlcance = await api("POST", `/solicitudes/${otraVez.data?.solicitud?.id}/aprobar`, { motivo: "Procede" }, t.patricia);
  const trasAlcance = (await detalle()).permisos || [];
  check("3c aprobada: el permiso queda con alcance total y sin el alcance anterior", apruebaAlcance.status === 200 && tiene(trasAlcance, aTotal) && !tiene(trasAlcance, parcial) && trasAlcance.length === inicial.length, `${apruebaAlcance.status} ${apruebaAlcance.data?.message} ${trasAlcance.length}`);
  const reduce = await guardar(inicial, "Reducir el alcance (prueba R8)");
  const trasReducir = (await detalle()).permisos || [];
  check("3c reducir el alcance (de total a uno parcial) es quitar: directo (200), sin solicitud", reduce.status === 200 && !reduce.data?.solicitud && tiene(trasReducir, parcial) && !tiene(trasReducir, aTotal), `${reduce.status} ${reduce.data?.message}`);

  const sinMotivo = await guardar([...inicial, nueva], "");
  check("3c el motivo sigue siendo obligatorio al cambiar permisos (400)", sinMotivo.status === 400, `${sinMotivo.status} ${sinMotivo.data?.message}`);
  const sinReauth = await api("PUT", `/admin/roles/${rol.id}`, { nombre: rol.nombre, descripcion: rol.descripcion || "", activo: true, permisos: inicial.slice(1), motivo: "Sin reautenticación" }, t.jorge, { ...MANUAL, "X-Sin-Reauth-Auto": "1" });
  check("3c y la reautenticación también (401 reauth_required)", sinReauth.status === 401 && sinReauth.data?.codigo === "reauth_required" && ((await detalle()).permisos || []).length === inicial.length, `${sinReauth.status} ${sinReauth.data?.codigo}`);
}

/* ================= 3d. R10 cambio obligatorio de contrasena ================= */
{
  const email = `nueva.r10.${unico()}@cicese.mx`;
  const temporal = "Temporal-R10-2026!";
  const alta = await altaCuenta("Cuenta R10", email, temporal);
  const SIN_CAMBIO = { "X-Sin-Cambio-Auto": "1" };
  const entrada = await api("POST", "/auth/login", { email, password: temporal }, undefined, SIN_CAMBIO);
  const tk = entrada.data?.token;
  const me = await api("GET", "/auth/me", undefined, tk);
  const modulo = await api("GET", "/samples/reception", undefined, tk);
  check("3d cuenta nueva: entra, pero con cambio de contraseña obligatorio (me lo indica y los módulos → 403 cambiar_password)", alta.status === 201 && entrada.status === 200 && me.data?.user?.debe_cambiar_password === true && modulo.status === 403 && modulo.data?.codigo === "cambiar_password", `${alta.status} ${entrada.status} ${me.data?.user?.debe_cambiar_password} ${modulo.status} ${modulo.data?.codigo}`);
  const cambio = await api("POST", "/auth/password", { actual: temporal, nueva: "Definitiva-R10-2026!" }, tk);
  const libre = await api("GET", "/auth/me", undefined, cambio.data?.token);
  check("3d tras cambiarla: sesión nueva sin cambio pendiente; el token anterior queda revocado", cambio.status === 200 && libre.data?.user?.debe_cambiar_password === false && (await api("GET", "/auth/me", undefined, tk)).status === 401, `${cambio.status} ${libre.data?.user?.debe_cambiar_password}`);
  const reset = await api("POST", `/admin/usuarios/${alta.data?.id}/password`, { motivo: "Olvidó su contraseña (prueba R10)" }, t.qa);
  const conTemporal = reset.data?.password_temporal || reset.data?.password;
  const tras = (await api("POST", "/auth/login", { email, password: conTemporal }, undefined, SIN_CAMBIO)).data?.token;
  check("3d restablecida por la administración: vuelve a pedir el cambio", reset.status === 200 && (await api("GET", "/auth/me", undefined, tras)).data?.user?.debe_cambiar_password === true, `${reset.status} ${reset.data?.message}`);
  const qa = await api("GET", "/auth/me", undefined, t.qa);
  check("3d las cuentas existentes no se tocan (sin cambio pendiente)", qa.data?.user?.debe_cambiar_password === false, `${qa.data?.user?.debe_cambiar_password}`);
}

terminar();
