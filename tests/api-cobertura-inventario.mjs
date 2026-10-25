/*
 * Prueba integral · cobertura de Inventario, movimientos y equipos (API). Cada check lleva la
 * etiqueta [cob:I:<id>] del renglón de la matriz que prueba:
 * - consumibles: producto obligatorio, números ≥ 0, fecha de ingreso, existencia inicial, recortes y 404;
 * - reporte PDF de mantenimiento: permisos, tamaño, multipart, archivo, mantenimiento, fecha,
 *   reemplazo (mismo mantenimiento, vigente, motivo, reautenticación) y contenido;
 * - catálogo: edición en baja, baja con motivo y reautenticación (sin segundo usuario), efectos de la baja;
 * - stock máximo que sube solo; estado del equipo que sigue a Mantenimiento; suspensión por NC;
 * - mantenimiento en proceso con fecha pasada y cambio de equipo;
 * - permisos de GET /inventory/consumibles, PUT /consumables/:id, reactivar consumible y GET de un mantenimiento.
 */
import "./lib/reauth-auto.mjs";
import { api, cadena, crearCheck, Database, enDias, fila, filas, hoy, login, sesiones } from "./lib/calidad.mjs";
import { pdfConTexto } from "./lib/archivos.mjs";

const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const unico = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const SIN_REAUTH = { "X-Sin-Reauth-Auto": "1" };
const consumible = (id) => fila("SELECT * FROM consumibles WHERE id = ?", id);
const equipoEstado = (id) => fila("SELECT estado FROM equipos WHERE id = ?", id)?.estado;
const nuevoEquipo = async (extra = {}) => (await api("POST", "/inventory/equipos", { nombre: `Equipo cobertura ${unico()}`, estado: "operativo", ...extra }, t.qa)).data?.id;
const mant = (equipo, extra = {}) => ({ id_equipo: equipo, tipo: "preventivo", fecha_programada: "2027-05-01", estado: "programado", ...extra });
const ejecutar = (sql, ...p) => {
  const b = new Database(process.env.TEST_DB_PATH);
  try {
    b.prepare(sql).run(...p);
  } finally {
    b.close();
  }
};
const reactivo = (id) => fila("SELECT * FROM reactivos WHERE id = ?", id);
const existenciaR = (id) => Number(reactivo(id)?.cantidad_actual);
const mantenimiento = (id) => fila("SELECT * FROM mantenimientos WHERE id = ?", id);
const equipo = (id) => fila("SELECT * FROM equipos WHERE id = ?", id);
const nuevoReactivo = async (extra = {}, token = t.qa) => (await api("POST", "/inventory/reactivos", { tipo_reactivo: "alcoholes_solventes", producto: `Metanol cobertura ${unico()}`, capacidad: 1, unidad_capacidad: "L", piezas: 1, ...extra }, token)).data?.id;
const nuevoConsumible = async (extra = {}, token = t.qa) => (await api("POST", "/consumables", { producto: `Consumible cobertura ${unico()}`, piezas: 1, cantidad_por_pieza: 10, ...extra }, token)).data?.id;
const movimientosDe = (tabla, idItem) => filas("SELECT * FROM movimientos WHERE tabla_origen = ? AND id_item = ? ORDER BY id", tabla, idItem);

/* Cuentas propias con un rol hecho a la medida (no se tocan las cuentas compartidas). */
async function cuentaCon(etiqueta, permisos) {
  const sello = unico().toLowerCase();
  const rol = await api("POST", "/admin/roles", { nombre: `${etiqueta} ${sello}`, motivo: "Rol de la prueba de cobertura", permisos }, t.jorge);
  const email = `cob.inv.${sello}@ficotox.local`;
  const password = `Temporal-${sello}-2026`;
  const alta = await api("POST", "/admin/usuarios", { nombre: `${etiqueta} ${sello}`, email, activo: true, rol_id: rol.data?.id, departamento: "Laboratorio", password, motivo: "Alta de la prueba de cobertura" }, t.jorge);
  ejecutar("UPDATE usuarios SET debe_cambiar_password = 0 WHERE email = ?", email);
  const acciones = filas("SELECT modulo, accion, alcance FROM rol_acciones WHERE id_rol = ? ORDER BY modulo, accion", rol.data?.id).map((a) => `${a.modulo}:${a.accion}:${a.alcance}`);
  return { token: await login(email, password), acciones, ok: rol.status === 201 && alta.status === 201, detalle: `${rol.status} ${alta.status} ${alta.data?.message || ""}` };
}
const sinInventario = await cuentaCon("Solo muestras", [{ modulo: "muestras", accion: "V", alcance: "total" }]);
const soloMovimientos = await cuentaCon("Solo movimientos", [{ modulo: "inventario", accion: "C", alcance: "movimientos" }]);
const tSin = sinInventario.token;
const tMov = soloMovimientos.token;
check("(preparación) cuenta sin inventario ni equipos y cuenta con solo inventario:C de movimientos (sin E)", sinInventario.ok && !!tSin && sinInventario.acciones.join() === "muestras:V:total" && soloMovimientos.ok && !!tMov && soloMovimientos.acciones.join() === "inventario:C:movimientos", `${sinInventario.detalle} ${sinInventario.acciones} | ${soloMovimientos.detalle} ${soloMovimientos.acciones}`);

/* ---------- 2.2 Consumible: validaciones ---------- */
{
  const sinProducto = await api("POST", "/consumables", { producto: "   ", piezas: 1 }, t.qa);
  check("[cob:I:2.2-producto] alta de consumible sin producto (solo espacios) → 400 «El campo 'producto' es obligatorio»", sinProducto.status === 400 && /producto' es obligatorio/.test(sinProducto.data?.message || ""), `${sinProducto.status} ${sinProducto.data?.message}`);
  for (const [campo, etiqueta] of [["piezas", "Piezas"], ["cantidad_por_pieza", "Cantidad por pieza"], ["stock_minimo", "Stock mínimo"]]) {
    const negativo = await api("POST", "/consumables", { producto: `Consumible negativo ${unico()}`, [campo]: -1 }, t.qa);
    const texto = await api("POST", "/consumables", { producto: `Consumible texto ${unico()}`, [campo]: "muchas" }, t.qa);
    check(`[cob:I:2.2-numeros] [cob:I:2.2-piezas] «${etiqueta}» negativo o no numérico → 400 «…debe ser un número mayor o igual a cero»`, negativo.status === 400 && texto.status === 400 && negativo.data?.message === `«${etiqueta}» debe ser un número mayor o igual a cero`, `${negativo.status} ${texto.status} ${negativo.data?.message}`);
  }

  // Fecha de ingreso: vacío y «s/f» quedan sin fecha; AAAA-MM-DD se guarda.
  const nombre = `Consumible cobertura ${unico()}`;
  const C = (await api("POST", "/consumables", { producto: nombre, piezas: 3, cantidad_por_pieza: 10, fecha_ingreso: "", stock_minimo: 0 }, t.qa)).data?.id;
  const Csf = (await api("POST", "/consumables", { producto: `Consumible s/f ${unico()}`, piezas: 1, fecha_ingreso: "S/F" }, t.qa)).data?.id;
  check("[cob:I:2.2-fecha_ingreso] fecha de ingreso vacía o «S/F» se guarda sin fecha (NULL)", !!C && !!Csf && consumible(C).fecha_ingreso === null && consumible(Csf).fecha_ingreso === null, `${consumible(C)?.fecha_ingreso} ${consumible(Csf)?.fecha_ingreso}`);

  // Existencia inicial: piezas × cantidad por pieza (o × 1) y su movimiento «Existencia inicial».
  const inicial = fila("SELECT cantidad, motivo, unidad FROM movimientos WHERE tabla_origen = 'consumibles' AND id_item = ? AND referencia = ?", C, `consumible-inicial-${C}`);
  check("[cob:I:2.2-existencia] alta: existencia = piezas × cantidad por pieza (3 × 10 = 30) con movimiento «Existencia inicial»", Number(consumible(C).existencia) === 30 && Number(consumible(C).stock_maximo) === 30 && Number(inicial?.cantidad) === 30 && inicial?.motivo === "Existencia inicial" && inicial?.unidad === "unidades", JSON.stringify(inicial));
  check("[cob:I:2.2-existencia] …sin cantidad por pieza cuenta × 1 (1 pieza = 1 unidad)", Number(consumible(Csf).existencia) === 1, String(consumible(Csf)?.existencia));
  const Ccero = (await api("POST", "/consumables", { producto: `Consumible sin piezas ${unico()}` }, t.qa)).data?.id;
  check("[cob:I:2.2-existencia] …sin piezas: existencia 0 y sin movimiento inicial", Number(consumible(Ccero).existencia) === 0 && filas("SELECT id FROM movimientos WHERE tabla_origen = 'consumibles' AND id_item = ?", Ccero).length === 0);

  const base = { producto: nombre, piezas: 3, cantidad_por_pieza: 10 };
  const edita = await api("PUT", `/consumables/${C}`, { ...base, piezas: 8, cantidad_por_pieza: 50 }, t.qa);
  check("[cob:I:2.2-existencia] editar piezas y cantidad por pieza no cambia la existencia (sigue 30)", edita.status === 200 && Number(consumible(C).existencia) === 30 && Number(consumible(C).piezas) === 8, `${edita.status} ${consumible(C)?.existencia}`);
  const editaSinProducto = await api("PUT", `/consumables/${C}`, { ...base, producto: "" }, t.qa);
  const editaNegativo = await api("PUT", `/consumables/${C}`, { ...base, stock_minimo: -3 }, t.qa);
  const editaFecha = await api("PUT", `/consumables/${C}`, { ...base, fecha_ingreso: "15/03/2026" }, t.qa);
  check("[cob:I:2.2-producto] [cob:I:2.2-numeros] [cob:I:2.2-piezas] [cob:I:2.2-fecha_ingreso] editar sin producto, con mínimo negativo o fecha dd/mm/aaaa → 400 y la base no cambia", editaSinProducto.status === 400 && editaNegativo.status === 400 && editaFecha.status === 400 && consumible(C).producto === nombre && consumible(C).stock_minimo !== -3 && consumible(C).fecha_ingreso === null, `${editaSinProducto.status} ${editaNegativo.status} ${editaFecha.status} ${editaFecha.data?.message}`);
  // Un valor heredado (Excel) que no cambia se conserva al editar.
  ejecutar("UPDATE consumibles SET fecha_ingreso = 'mar-2024' WHERE id = ?", C);
  const conserva = await api("PUT", `/consumables/${C}`, { ...base, fecha_ingreso: "mar-2024", marca: "Marca nueva" }, t.qa);
  check("[cob:I:2.2-fecha_ingreso] editar otro dato conserva una fecha de ingreso heredada que no cambia", conserva.status === 200 && consumible(C).fecha_ingreso === "mar-2024" && consumible(C).marca === "Marca nueva", `${conserva.status} ${conserva.data?.message}`);

  // Recortes silenciosos a la longitud de cada columna.
  const largo = (n) => "x".repeat(n);
  const limites = { id_interno: 120, marca: 120, proveedor: 180, catalogo_parte_cas: 180, lote: 120, tamano_capacidad: 120, contenedor: 120, localizacion: 180, observaciones: 4000 };
  const carga = Object.fromEntries(Object.entries(limites).map(([k, n]) => [k, largo(n + 50)]));
  const Clargo = await api("POST", "/consumables", { producto: `Consumible largo ${unico()}`, ...carga }, t.qa);
  const guardado = consumible(Clargo.data?.id) || {};
  const mal = Object.entries(limites).filter(([k, n]) => String(guardado[k] || "").length !== n);
  check("[cob:I:2.2-longitudes] textos largos se recortan en silencio (id 120, marca 120, proveedor 180, catálogo 180, lote 120, tamaño 120, contenedor 120, localización 180, observaciones 4000)", Clargo.status === 201 && mal.length === 0, `${Clargo.status} ${mal.map(([k]) => `${k}=${String(guardado[k] || "").length}`).join(" ")}`);
  const productoLargo = await api("POST", "/consumables", { producto: `Consumible ${largo(300)}` }, t.qa);
  check("[cob:I:2.2-producto] el servidor no limita el producto: uno de 311 caracteres se guarda completo (201)", productoLargo.status === 201 && consumible(productoLargo.data?.id)?.producto === `Consumible ${largo(300)}`, `${productoLargo.status} ${productoLargo.data?.message} ${String(consumible(productoLargo.data?.id)?.producto || "").length}`);
  const conFecha = await api("POST", "/consumables", { producto: `Consumible con fecha ${unico()}`, fecha_ingreso: "2026-03-15" }, t.qa);
  const fechaInvalida = await api("POST", "/consumables", { producto: `Consumible fecha mala ${unico()}`, fecha_ingreso: "2026-02-30" }, t.qa);
  check("[cob:I:2.2-fecha_ingreso] AAAA-MM-DD se guarda; una fecha que no existe (2026-02-30) → 400 «…fecha válida (AAAA-MM-DD) o «s/f»»", conFecha.status === 201 && consumible(conFecha.data?.id)?.fecha_ingreso === "2026-03-15" && fechaInvalida.status === 400 && /fecha válida \(AAAA-MM-DD\) o «s\/f»/.test(fechaInvalida.data?.message || ""), `${conFecha.status} ${fechaInvalida.status} ${fechaInvalida.data?.message}`);

  const noExiste = 99999990;
  const g404 = await api("GET", `/consumables/${noExiste}`, undefined, t.qa);
  const p404 = await api("PUT", `/consumables/${noExiste}`, { producto: "Fantasma" }, t.qa);
  const r404 = await api("POST", `/consumables/${noExiste}/refill`, { tipo: "entrada", cantidad: 1 }, t.ricardo);
  check("[cob:I:2.2-no-encontrado] consumible inexistente: GET, PUT y movimiento → 404 «Consumible no encontrado»", [g404, p404, r404].every((r) => r.status === 404 && r.data?.message === "Consumible no encontrado") && !consumible(noExiste), `${g404.status} ${p404.status} ${r404.status} ${p404.data?.message}`);
}

/* ---------- 2.7 Reporte PDF de mantenimiento ---------- */
{
  const E = await nuevoEquipo();
  const M = (await api("POST", "/inventory/mantenimientos", mant(E), t.carmen)).data?.id;
  const pdf = await pdfConTexto(1, "Reporte cobertura");
  const form = (campos = {}, archivo = pdf, nombre = "reporte cobertura.pdf") => {
    const fd = new FormData();
    if (archivo) fd.append("archivo", new Blob([archivo]), nombre);
    for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
    return fd;
  };
  const reportes = () => filas("SELECT id FROM reportes_mantenimiento WHERE id_mantenimiento = ?", M).length;

  const auditor = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M }), t.hector);
  const analista = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M }), t.luis);
  check("[cob:I:2.7-permiso] adjuntar sin equipos:C/E de mantenimiento (Auditor; Analista con alcance «uso») → 403", auditor.status === 403 && analista.status === 403 && /equipos:C/.test(auditor.data?.message || "") && reportes() === 0, `${auditor.status} ${analista.status} ${auditor.data?.message}`);

  // Content-Length por encima de EVIDENCIA_MAX_MB + 64 KiB: 413 antes de leer el multipart.
  const maxMb = Number(process.env.EVIDENCIA_MAX_MB || 25);
  const grande = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(maxMb * 1024 * 1024 + 200 * 1024, 0x20)]);
  const pesado = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M }, grande, "grande.pdf"), t.carmen);
  check(`[cob:I:2.7-content-length] un reporte de más de ${maxMb} MB → 413 archivo_grande`, pesado.status === 413 && pesado.data?.codigo === "archivo_grande" && reportes() === 0, `${pesado.status} ${pesado.data?.codigo} ${pesado.data?.message}`);

  const json = await api("POST", "/documents/maintenance-report", { id_mantenimiento: M }, t.carmen);
  check("[cob:I:2.7-multipart] cuerpo JSON en vez de multipart → 400 «Envía el archivo como multipart/form-data…»", json.status === 400 && /multipart\/form-data/.test(json.data?.message || ""), `${json.status} ${json.data?.message}`);
  const sinArchivo = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M }, null), t.carmen);
  check("[cob:I:2.7-archivo-presente] multipart sin archivo → 400 «Adjunta el reporte en PDF»", sinArchivo.status === 400 && sinArchivo.data?.message === "Adjunta el reporte en PDF", `${sinArchivo.status} ${sinArchivo.data?.message}`);
  const sinMant = await api("POST", "/documents/maintenance-report", form({}), t.carmen);
  const mantTexto = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: "abc" }), t.carmen);
  check("[cob:I:2.7-id_mantenimiento-numérico] sin id_mantenimiento o no numérico → 400 «Falta el mantenimiento vinculado»", [sinMant, mantTexto].every((r) => r.status === 400 && r.data?.message === "Falta el mantenimiento vinculado"), `${sinMant.status} ${mantTexto.status} ${sinMant.data?.message}`);
  const mant404 = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: 99999991 }), t.carmen);
  check("[cob:I:2.7-mantenimiento-existe-cancelado] mantenimiento inexistente → 404 «Mantenimiento no encontrado»", mant404.status === 404 && mant404.data?.message === "Mantenimiento no encontrado", `${mant404.status} ${mant404.data?.message}`);
  // La matriz decía «cualquier estado, también cancelado»: hoy un mantenimiento cancelado ya no admite reportes (409).
  const Mcan = (await api("POST", "/inventory/mantenimientos", mant(E, { fecha_programada: "2027-07-01" }), t.carmen)).data?.id;
  await api("DELETE", `/inventory/mantenimientos/${Mcan}`, { motivo: "Prueba de cobertura: cancelado" }, t.qa);
  const aCancelado = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: Mcan }), t.carmen);
  check("[cob:I:2.7-mantenimiento-existe-cancelado] a un mantenimiento cancelado → 409 cancelado y no se adjunta", mantenimiento(Mcan)?.estado === "cancelado" && aCancelado.status === 409 && aCancelado.data?.codigo === "cancelado" && filas("SELECT id FROM reportes_mantenimiento WHERE id_mantenimiento = ?", Mcan).length === 0, `${aCancelado.status} ${aCancelado.data?.codigo} ${aCancelado.data?.message}`);
  const fechaMala = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M, fecha_reporte: "01/05/2027" }), t.carmen);
  check("[cob:I:2.7-fecha_reporte] fecha_reporte que no es AAAA-MM-DD → 400 «La fecha del reporte no es válida»", fechaMala.status === 400 && fechaMala.data?.message === "La fecha del reporte no es válida" && reportes() === 0, `${fechaMala.status} ${fechaMala.data?.message}`);

  // Contenido: extensión, firma, contenido activo y vacío.
  const docx = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M }, pdf, "reporte.docx"), t.carmen);
  const firma = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M }, Buffer.from("Solo texto, no es PDF"), "texto.pdf"), t.carmen);
  const activo = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M }, Buffer.from("%PDF-1.4\n<script>alert(1)</script>\n%%EOF"), "activo.pdf"), t.carmen);
  const vacio = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M }, Buffer.alloc(0), "vacio.pdf"), t.carmen);
  check("[cob:I:2.7-extensión-firma] .docx → 400 formato_no_permitido; sin firma %PDF- o con contenido activo → 400 contenido_no_valido; vacío → 400 archivo_vacio", docx.status === 400 && docx.data?.codigo === "formato_no_permitido" && firma.status === 400 && firma.data?.codigo === "contenido_no_valido" && activo.status === 400 && activo.data?.codigo === "contenido_no_valido" && vacio.status === 400 && ["archivo_vacio", "contenido_no_valido"].includes(vacio.data?.codigo) && reportes() === 0, `${docx.status}/${docx.data?.codigo} ${firma.status}/${firma.data?.codigo} ${activo.status}/${activo.data?.codigo} ${vacio.status}/${vacio.data?.codigo}`);

  const hoyRep = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M }), t.carmen);
  const R1 = hoyRep.data?.id;
  check("[cob:I:2.7-fecha_reporte] sin fecha_reporte se guarda la de hoy", hoyRep.status === 201 && fila("SELECT fecha_reporte FROM reportes_mantenimiento WHERE id = ?", R1)?.fecha_reporte === hoy(), `${hoyRep.status} ${hoyRep.data?.message}`);

  // Reemplazo.
  const M2 = (await api("POST", "/inventory/mantenimientos", mant(E, { fecha_programada: "2027-06-01" }), t.carmen)).data?.id;
  const otroMant = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M2, reemplaza_id: R1, motivo: "Reporte de otro mantenimiento" }), t.carmen);
  const inexistente = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M, reemplaza_id: 99999992, motivo: "No existe ese reporte" }), t.carmen);
  check("[cob:I:2.7-reemplazo-mismo] reemplazar un reporte de otro mantenimiento o inexistente → 404 «El reporte que quieres reemplazar no existe en este mantenimiento»", [otroMant, inexistente].every((r) => r.status === 404 && /no existe en este mantenimiento/.test(r.data?.message || "")) && !fila("SELECT anulado_en FROM reportes_mantenimiento WHERE id = ?", R1)?.anulado_en, `${otroMant.status} ${inexistente.status} ${otroMant.data?.message}`);
  const motivoCorto = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M, reemplaza_id: R1, motivo: "mal" }), t.carmen);
  check("[cob:I:2.7-reemplazo-motivo] reemplazo con motivo de menos de 5 caracteres → 400 «Indica el motivo del reemplazo (al menos 5 caracteres)»", motivoCorto.status === 400 && motivoCorto.data?.message === "Indica el motivo del reemplazo (al menos 5 caracteres)", `${motivoCorto.status} ${motivoCorto.data?.message}`);
  const sinReauth = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M, reemplaza_id: R1, motivo: "Se adjuntó el borrador" }), t.carmen, SIN_REAUTH);
  check("[cob:I:2.7-reemplazo-reauth] reemplazo sin reautenticación → 401 reauth_required (mantenimiento:reporte) y el reporte sigue vigente", sinReauth.status === 401 && sinReauth.data?.codigo === "reauth_required" && sinReauth.data?.accion === "mantenimiento:reporte" && reportes() === 1 && !fila("SELECT anulado_en FROM reportes_mantenimiento WHERE id = ?", R1)?.anulado_en, `${sinReauth.status} ${sinReauth.data?.codigo} ${sinReauth.data?.accion} ${reportes()}`);
  const reemplazo = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M, reemplaza_id: R1, motivo: "Se adjuntó el borrador" }, await pdfConTexto(1, "Reporte final")), t.carmen);
  check("[cob:I:2.7-reemplazo-reauth] …con contraseña se reemplaza (201) y el anterior queda anulado con el motivo", reemplazo.status === 201 && fila("SELECT motivo_anulacion, reemplazado_por FROM reportes_mantenimiento WHERE id = ?", R1)?.reemplazado_por === reemplazo.data?.id, `${reemplazo.status} ${reemplazo.data?.message}`);
  const yaReemplazado = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M, reemplaza_id: R1, motivo: "Otra vez el mismo" }), t.carmen);
  check("[cob:I:2.7-reemplazo-vigente] reemplazar uno ya reemplazado → 409 «Ese reporte ya fue quitado o reemplazado»", yaReemplazado.status === 409 && yaReemplazado.data?.message === "Ese reporte ya fue quitado o reemplazado" && reportes() === 2, `${yaReemplazado.status} ${yaReemplazado.data?.message}`);
  check("[cob:I:4-POST-documents-maintenance-report] POST /documents/maintenance-report: 403 sin equipos:C/E de mantenimiento, 404 mantenimiento inexistente, 400 sin multipart, 409 reporte ya reemplazado, 413 archivo grande y 201 con carmen (equipos:C de mantenimiento)", auditor.status === 403 && mant404.status === 404 && json.status === 400 && yaReemplazado.status === 409 && pesado.status === 413 && hoyRep.status === 201, `${auditor.status} ${mant404.status} ${json.status} ${yaReemplazado.status} ${pesado.status} ${hoyRep.status}`);

  // 3.5 Estados del reporte.
  const rep = (id) => fila("SELECT * FROM reportes_mantenimiento WHERE id = ?", id);
  const R2 = reemplazo.data?.id;
  const codigo = (n) => `RM-${String(M).padStart(5, "0")}-${String(n).padStart(2, "0")}`;
  check("[cob:I:3.5-publicado-código] el primer reporte nace «publicado», versión 1.0 y código RM-<mantenimiento con 5 cifras>-01", rep(R1)?.codigo === codigo(1) && rep(R1)?.version === "1.0" && rep(R1)?.estado === "publicado" && hoyRep.data?.codigo === codigo(1), JSON.stringify(rep(R1) && { c: rep(R1).codigo, v: rep(R1).version, e: rep(R1).estado }));
  const sustituir = fila("SELECT motivo FROM auditoria WHERE entidad = 'reportes_mantenimiento' AND entidad_id = ? AND accion = 'sustituir'", String(R1));
  check("[cob:I:3.5-reemplazado_por] reemplazar: el anterior queda anulado con reemplazado_por y motivo (bitácora «sustituir»); el nuevo es v2.0 publicado con código …-02", !!rep(R1)?.anulado_en && Number(rep(R1)?.reemplazado_por) === R2 && rep(R1)?.motivo_anulacion === "Se adjuntó el borrador" && rep(R2)?.version === "2.0" && rep(R2)?.estado === "publicado" && rep(R2)?.codigo === codigo(2) && !rep(R2)?.anulado_en && sustituir?.motivo === "Se adjuntó el borrador", JSON.stringify({ r1: rep(R1) && { a: !!rep(R1).anulado_en, p: rep(R1).reemplazado_por }, r2: rep(R2) && { v: rep(R2).version, c: rep(R2).codigo }, sustituir }));

  // GET /documents: solo vigentes, con puede_gestionar.
  const docsHector = await api("GET", `/documents?mantenimiento=${M}`, undefined, t.hector);
  const docsCarmen = await api("GET", `/documents?mantenimiento=${M}`, undefined, t.carmen);
  const docsSin = await api("GET", `/documents?mantenimiento=${M}`, undefined, tSin);
  const docsTodos = await api("GET", "/documents", undefined, t.hector);
  check("[cob:I:4-GET-documents] GET /documents: sin equipos:V → 403; con ?mantenimiento= solo el vigente (no el reemplazado); puede_gestionar falso para el Auditor y verdadero para carmen", docsSin.status === 403 && docsHector.status === 200 && (docsHector.data?.items || []).map((d) => Number(d.id)).join() === String(R2) && docsHector.data?.puede_gestionar === false && docsCarmen.data?.puede_gestionar === true && (docsTodos.data?.items || []).some((d) => Number(d.id) === R2) && !(docsTodos.data?.items || []).some((d) => Number(d.id) === R1), `${docsSin.status} ${docsHector.status} ${JSON.stringify((docsHector.data?.items || []).map((d) => d.id))} ${docsHector.data?.puede_gestionar} ${docsCarmen.data?.puede_gestionar}`);

  // GET /documents/files/…: permiso, ruta y archivo.
  const ruta = `/documents/files/${rep(R2)?.nombre_almacenado}`;
  const archivoSin = await api("GET", ruta, undefined, tSin);
  const archivoHector = await api("GET", ruta, undefined, t.hector);
  const fuera = await api("GET", "/documents/files/..%2F..%2Ficotox-test.sqlite3", undefined, t.hector);
  const noHay = await api("GET", `/documents/files/${M}/no-existe-${unico()}.pdf`, undefined, t.hector);
  check("[cob:I:4-GET-documents-files] GET /documents/files/…: sin equipos:V → 403; el Auditor lo abre (PDF íntegro); fuera de la carpeta o inexistente → 404 «Ruta no encontrada»", archivoSin.status === 403 && archivoHector.status === 200 && Buffer.isBuffer(archivoHector.data) && archivoHector.data.subarray(0, 5).toString() === "%PDF-" && archivoHector.headers.get("x-integridad-archivo") === "ok" && fuera.status === 404 && noHay.status === 404 && noHay.data?.message === "Ruta no encontrada", `${archivoSin.status} ${archivoHector.status} ${archivoHector.headers.get("x-integridad-archivo")} ${fuera.status} ${fuera.data?.message} ${noHay.status} ${noHay.data?.message}`);

  // Quitar: existe, vigente, motivo, reautenticación y permiso.
  const quitar = (id, motivo, token = t.carmen, headers = {}) => api("POST", `/documents/maintenance-report/${id}/quitar`, { motivo }, token, headers);
  const qAuditor = await quitar(R2, "El auditor intenta quitarlo", t.hector);
  const q404 = await quitar(99999997, "No existe ese reporte");
  const qReemplazado = await quitar(R1, "Ya estaba reemplazado");
  const qCorto = await quitar(R2, "no");
  const qSinReauth = await quitar(R2, "Se adjuntó al mantenimiento equivocado", t.carmen, SIN_REAUTH);
  check("[cob:I:2.7-quitar] [cob:I:4-POST-maintenance-report-quitar] quitar: sin permiso → 403, inexistente → 404 «Reporte no encontrado», ya reemplazado → 409, motivo corto → 400 «Indica el motivo (al menos 5 caracteres)», sin contraseña → 401 mantenimiento:reporte; sigue vigente", qAuditor.status === 403 && q404.status === 404 && q404.data?.message === "Reporte no encontrado" && qReemplazado.status === 409 && qCorto.status === 400 && qCorto.data?.message === "Indica el motivo (al menos 5 caracteres)" && qSinReauth.status === 401 && qSinReauth.data?.accion === "mantenimiento:reporte" && !rep(R2)?.anulado_en, `${qAuditor.status} ${q404.status} ${qReemplazado.status} ${qCorto.status} ${qSinReauth.status} ${qSinReauth.data?.accion}`);
  const qOk = await quitar(R2, "Se adjuntó al mantenimiento equivocado");
  const qOtraVez = await quitar(R2, "Otra vez el mismo reporte");
  const trasQuitar = await api("GET", ruta, undefined, t.hector);
  const listaTras = await api("GET", `/documents?mantenimiento=${M}`, undefined, t.hector);
  check("[cob:I:2.7-quitar] [cob:I:3.5-quitado-archivo] [cob:I:4-POST-maintenance-report-quitar] con contraseña se quita (anulado, sin reemplazo); otra vez → 409; ya no se lista pero el archivo se conserva (sigue abriendo)", qOk.status === 200 && !!rep(R2)?.anulado_en && rep(R2)?.motivo_anulacion === "Se adjuntó al mantenimiento equivocado" && !rep(R2)?.reemplazado_por && qOtraVez.status === 409 && (listaTras.data?.items || []).length === 0 && trasQuitar.status === 200 && Buffer.isBuffer(trasQuitar.data) && trasQuitar.data.subarray(0, 5).toString() === "%PDF-", `${qOk.status} ${qOk.data?.message} ${qOtraVez.status} ${(listaTras.data?.items || []).length} ${trasQuitar.status}`);
}

/* ---------- 3.1 Catálogo: edición en baja, baja y sus efectos ---------- */
{
  const R = (await api("POST", "/inventory/reactivos", { tipo_reactivo: "acidos", producto: `Ácido cobertura ${unico()}`, capacidad: 1, unidad_capacidad: "L", piezas: 1 }, t.qa)).data?.id;
  const C = (await api("POST", "/consumables", { producto: `Consumible baja ${unico()}`, piezas: 1, cantidad_por_pieza: 10 }, t.qa)).data?.id;
  const E = await nuevoEquipo();
  const rutas = [
    ["reactivo", `/inventory/reactivos/${R}`, "inventario:AN", "reactivos", R],
    ["consumible", `/consumables/${C}`, "inventario:AN", "consumibles", C],
    ["equipo", `/inventory/equipos/${E}`, "equipos:AN", "equipos", E],
  ];
  for (const [que, ruta, accion, tabla, idItem] of rutas) {
    const activo = () => Number(fila(`SELECT activo FROM ${tabla} WHERE id = ?`, idItem)?.activo ?? 1);
    const corto = await api("DELETE", ruta, { motivo: "no" }, t.patricia);
    const sinPermiso = await api("DELETE", ruta, { motivo: "Prueba de cobertura sin permiso" }, t.luis);
    const sinReauth = await api("DELETE", ruta, { motivo: "Prueba de cobertura sin contraseña" }, t.patricia, SIN_REAUTH);
    check(`[cob:I:3.1-baja] ${que}: baja con motivo corto → 400, sin ${accion} (Analista) → 403, sin contraseña → 401 reauth_required ${accion}; sigue activo`, corto.status === 400 && sinPermiso.status === 403 && sinReauth.status === 401 && sinReauth.data?.accion === accion && activo() === 1, `${corto.status} ${sinPermiso.status} ${sinReauth.status} ${sinReauth.data?.accion}`);
    const baja = await api("DELETE", ruta, { motivo: "Prueba de cobertura: retirado" }, t.patricia, { "X-Sin-Aprobar-Auto": "1" });
    const b = fila(`SELECT activo, baja_motivo, baja_en, baja_por FROM ${tabla} WHERE id = ?`, idItem);
    check(`[cob:I:3.1-baja] ${que}: con motivo y contraseña la baja es directa (200, sin solicitud de segundo usuario) con motivo, fecha y quién`, baja.status === 200 && !baja.data?.solicitud && Number(b?.activo) === 0 && b?.baja_motivo === "Prueba de cobertura: retirado" && !!b?.baja_en && Number(b?.baja_por) === id.patricia, `${baja.status} ${JSON.stringify(baja.data)}`);
    const otraVez = await api("DELETE", ruta, { motivo: "Prueba de cobertura: otra vez" }, t.patricia);
    check(`[cob:I:3.1-baja] ${que}: dar de baja algo ya dado de baja → 409`, otraVez.status === 409, `${otraVez.status} ${otraVez.data?.message}`);
  }
  // Edición estando en baja.
  const editaR = await api("PUT", `/inventory/reactivos/${R}`, { tipo_reactivo: "acidos", producto: "Ácido cobertura editado en baja", capacidad: 1, unidad_capacidad: "L", piezas: 1 }, t.qa);
  const editaC = await api("PUT", `/consumables/${C}`, { producto: "Consumible editado en baja", piezas: 1, cantidad_por_pieza: 10 }, t.qa);
  const editaE = await api("PUT", `/inventory/equipos/${E}`, { nombre: "Equipo editado en baja", estado: "operativo" }, t.qa);
  check("[cob:I:3.1-edicion] reactivo, consumible y equipo dados de baja se pueden editar (200) y siguen en baja", editaR.status === 200 && editaC.status === 200 && editaE.status === 200 && fila("SELECT producto, activo FROM reactivos WHERE id = ?", R)?.producto === "Ácido cobertura editado en baja" && Number(fila("SELECT activo FROM reactivos WHERE id = ?", R)?.activo) === 0 && Number(consumible(C).activo) === 0 && Number(fila("SELECT activo FROM equipos WHERE id = ?", E)?.activo) === 0, `${editaR.status} ${editaC.status} ${editaE.status}`);
  const editaSinPermiso = await api("PUT", `/inventory/equipos/${E}`, { nombre: "Equipo editado por el auditor", estado: "operativo" }, t.hector);
  check("[cob:I:3.1-edicion] editar un equipo sin equipos:E (Auditor) → 403", editaSinPermiso.status === 403, `${editaSinPermiso.status}`);
}

/* ---------- 3.1 Efectos de la baja en los formatos ---------- */
{
  const nombreC = `Consumible formato ${unico()}`;
  const C = (await api("POST", "/consumables", { producto: nombreC, piezas: 1, cantidad_por_pieza: 20 }, t.qa)).data?.id;
  const c = await cadena(t, "COBINV");
  const proc = { recepcion_id: c.R, muestra_tipo: "unica", id_interno: c.idInt, fecha_procesamiento: "2026-09-21", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "Persona A", nombre_quien_superviso: "Persona B" };
  const P = await api("POST", "/samples/processing", { ...proc, uso_inventario: [{ tipo: "consumible", ref: String(C), cantidad: 2 }] }, t.qa);
  check("(preparación) procesamiento que declara 2 unidades del consumible", P.status === 201 && Number(consumible(C).existencia) === 18, `${P.status} ${P.data?.message} ${consumible(C)?.existencia}`);
  await api("DELETE", `/consumables/${C}`, { motivo: "Prueba de cobertura: caja retirada" }, t.qa);
  const folio = (await api("GET", `/samples/processing/${P.data?.id}`, undefined, t.qa)).data?.item?.folio_num;
  const reedita = await api("PUT", `/samples/processing/${P.data?.id}`, { ...proc, folio_num: folio, fecha_procesamiento: "2026-09-22", uso_inventario: [{ tipo: "consumible", ref: String(C), cantidad: 2 }] }, t.qa);
  check("[cob:I:3.1-efectos] un registro que ya declaraba el consumible dado de baja se reedita (200) sin mover la existencia", reedita.status === 200 && Number(consumible(C).existencia) === 18, `${reedita.status} ${reedita.data?.message} ${consumible(C)?.existencia}`);
  const mas = await api("PUT", `/samples/processing/${P.data?.id}`, { ...proc, folio_num: folio, uso_inventario: [{ tipo: "consumible", ref: String(C), cantidad: 5 }] }, t.qa);
  const c2 = await cadena(t, "COBINV2");
  const nuevo = await api("POST", "/samples/processing", { ...proc, recepcion_id: c2.R, id_interno: c2.idInt, uso_inventario: [{ tipo: "consumible", ref: String(C), cantidad: 1 }] }, t.qa);
  check("[cob:I:3.1-efectos] consumir más, o declararlo en un registro nuevo → 409 «…esta dado de baja; reactivalo…»", mas.status === 409 && nuevo.status === 409 && /dado de baja; reactivalo/.test(nuevo.data?.message || "") && Number(consumible(C).existencia) === 18, `${mas.status} ${nuevo.status} ${nuevo.data?.message}`);
}

/* ---------- 3.2 Stock máximo que sube solo ---------- */
{
  const R = (await api("POST", "/inventory/reactivos", { tipo_reactivo: "alcoholes_solventes", producto: `Metanol máximo ${unico()}`, capacidad: 1, unidad_capacidad: "L", piezas: 2 }, t.qa)).data?.id;
  const maxR = () => Number(fila("SELECT stock_maximo FROM reactivos WHERE id = ?", R)?.stock_maximo);
  const antes = maxR();
  await api("POST", `/inventory/reactivos/${R}/refill`, { tipo: "entrada", cantidad: 3, motivo: "Compra de cobertura" }, t.ricardo);
  const tras = maxR();
  await api("POST", `/inventory/reactivos/${R}/refill`, { tipo: "salida", cantidad: 4, motivo: "Salida de cobertura" }, t.ricardo);
  check("[cob:I:3.2-stock_maximo] reactivo: el máximo (2) sube a 5 cuando la existencia lo supera y no baja con una salida", antes === 2 && tras === 5 && maxR() === 5, `${antes} → ${tras} → ${maxR()}`);
  const C = (await api("POST", "/consumables", { producto: `Consumible máximo ${unico()}`, piezas: 1, cantidad_por_pieza: 10 }, t.qa)).data?.id;
  await api("POST", `/consumables/${C}/refill`, { tipo: "entrada", cantidad: 5, motivo: "Compra de cobertura" }, t.ricardo);
  const trasC = Number(consumible(C).stock_maximo);
  await api("POST", `/consumables/${C}/refill`, { tipo: "ajuste", cantidad: 25, motivo: "Conteo de cobertura" }, t.ricardo);
  check("[cob:I:3.2-stock_maximo] consumible: el máximo sigue a la existencia (10 → 15 por entrada → 25 por ajuste)", trasC === 15 && Number(consumible(C).stock_maximo) === 25 && Number(consumible(C).existencia) === 25, `${trasC} ${consumible(C)?.stock_maximo}`);
}

/* ---------- 3.3 Estado operativo del equipo ---------- */
{
  const E = await nuevoEquipo();
  const M = (await api("POST", "/inventory/mantenimientos", mant(E), t.carmen)).data?.id;
  check("[cob:I:3.3-operativo-calibracion_pendiente-mantenimiento] operativo → «mantenimiento» al programarle un mantenimiento", equipoEstado(E) === "mantenimiento", equipoEstado(E));
  const editaEquipo = await api("PUT", `/inventory/equipos/${E}`, { nombre: "Equipo cobertura en mantenimiento", estado: "operativo" }, t.qa);
  check("[cob:I:3.3-operativo-calibracion_pendiente-mantenimiento] …editar el equipo a «operativo» no contradice a Mantenimiento: sigue «mantenimiento»", editaEquipo.status === 200 && equipoEstado(E) === "mantenimiento", `${editaEquipo.status} ${equipoEstado(E)}`);
  await api("PUT", `/inventory/mantenimientos/${M}`, mant(E, { estado: "completado", fecha_realizado: hoy() }), t.carmen);
  check("[cob:I:3.3-mantenimiento-operativo] mantenimiento → operativo cuando ya no quedan pendientes", equipoEstado(E) === "operativo", equipoEstado(E));
  const M2 = (await api("POST", "/inventory/mantenimientos", mant(E, { fecha_programada: "2027-09-01" }), t.carmen)).data?.id;
  await api("DELETE", `/inventory/mantenimientos/${M2}`, { motivo: "Prueba de cobertura: se canceló" }, t.qa);
  check("[cob:I:3.3-mantenimiento-operativo] …también al cancelar el único pendiente", equipoEstado(E) === "operativo", equipoEstado(E));

  const Ecp = await nuevoEquipo({ estado: "calibracion_pendiente" });
  const Mcp = (await api("POST", "/inventory/mantenimientos", mant(Ecp), t.carmen)).data?.id;
  const cpEnMant = equipoEstado(Ecp);
  await api("DELETE", `/inventory/mantenimientos/${Mcp}`, { motivo: "Prueba de cobertura: se canceló" }, t.qa);
  check("[cob:I:3.3-operativo-calibracion_pendiente-mantenimiento] calibración pendiente → «mantenimiento» al programarle uno; al quedar sin pendientes vuelve a operativo", cpEnMant === "mantenimiento" && equipoEstado(Ecp) === "operativo", `${cpEnMant} → ${equipoEstado(Ecp)}`);

  const Ecal = await nuevoEquipo({ estado: "calibracion_pendiente" });
  await api("POST", "/inventory/mantenimientos", mant(Ecal, { tipo: "preventivo", estado: "completado", fecha_programada: enDias(-2), fecha_realizado: hoy() }), t.carmen);
  check("[cob:I:3.3-calibracion_pendiente-operativo] calibración pendiente: un preventivo completado no la levanta", equipoEstado(Ecal) === "calibracion_pendiente", equipoEstado(Ecal));
  const cal = await api("POST", "/inventory/mantenimientos", { ...mant(Ecal, { tipo: "calibracion", estado: "completado", fecha_programada: enDias(-1), fecha_realizado: hoy() }), proxima_calibracion: "2027-10-15" }, t.carmen);
  check("[cob:I:3.3-calibracion_pendiente-operativo] [cob:I:3.3-fecha_prox_calibracion] calibracion_pendiente → operativo al completar una calibración, con la próxima fecha en la ficha", cal.status === 201 && equipoEstado(Ecal) === "operativo" && fila("SELECT fecha_prox_calibracion FROM equipos WHERE id = ?", Ecal)?.fecha_prox_calibracion === "2027-10-15", `${cal.status} ${equipoEstado(Ecal)} ${cal.data?.message}`);

  const Efuera = await nuevoEquipo({ estado: "fuera_servicio" });
  const Mf = (await api("POST", "/inventory/mantenimientos", mant(Efuera), t.carmen)).data?.id;
  const fueraTrasProgramar = equipoEstado(Efuera);
  await api("PUT", `/inventory/mantenimientos/${Mf}`, mant(Efuera, { estado: "completado", fecha_realizado: hoy() }), t.carmen);
  check("[cob:I:3.3-fuera_servicio] «fuera de servicio» no lo toca Mantenimiento (ni al programar ni al completar)", fueraTrasProgramar === "fuera_servicio" && equipoEstado(Efuera) === "fuera_servicio", `${fueraTrasProgramar} ${equipoEstado(Efuera)}`);

  // Suspensión por NC: solo se acepta «fuera de servicio» mientras está activa.
  const Es = await nuevoEquipo();
  const nc = await api("POST", "/calidad/nc", { origen: "otro", descripcion: `Equipo de cobertura con lecturas fuera de rango ${unico()}`, clasificacion: "menor", responsable_id: id.ricardo }, t.ana);
  const susp = await api("POST", `/calidad/nc/${nc.data?.id}/suspensiones`, { tipo: "equipo", clave: String(Es), motivo: "Lecturas fuera de rango" }, t.ana);
  const suspId = fila("SELECT id FROM suspensiones WHERE nc_id = ? AND reanudada_en IS NULL", nc.data?.id)?.id;
  check("(preparación) equipo suspendido por una NC (queda fuera de servicio)", nc.status === 201 && susp.status === 201 && equipoEstado(Es) === "fuera_servicio", `${nc.status} ${susp.status} ${susp.data?.message} ${equipoEstado(Es)}`);
  const operativo = await api("PUT", `/inventory/equipos/${Es}`, { nombre: "Equipo suspendido", estado: "operativo" }, t.qa);
  const calPend = await api("PUT", `/inventory/equipos/${Es}`, { nombre: "Equipo suspendido", estado: "calibracion_pendiente" }, t.qa);
  check("[cob:I:3.3-suspendido] [cob:I:2.5-suspendido] [cob:I:4-PUT-inventory-equipos] suspendido: ponerlo operativo o en calibración pendiente → 409 suspendido (con la NC en el mensaje)", operativo.status === 409 && operativo.data?.codigo === "suspendido" && /NC \d{7}/.test(operativo.data?.message || "") && calPend.status === 409 && equipoEstado(Es) === "fuera_servicio", `${operativo.status} ${operativo.data?.codigo} ${operativo.data?.message}`);
  const fuera = await api("PUT", `/inventory/equipos/${Es}`, { nombre: "Equipo suspendido (editado)", estado: "fuera_servicio", ubicacion: "Cuarentena" }, t.qa);
  check("[cob:I:3.3-suspendido] [cob:I:2.5-suspendido] …editarlo dejándolo «fuera de servicio» sí se acepta (200)", fuera.status === 200 && fila("SELECT ubicacion FROM equipos WHERE id = ?", Es)?.ubicacion === "Cuarentena", `${fuera.status} ${fuera.data?.message}`);
  if (suspId) await api("POST", `/calidad/suspensiones/${suspId}/reanudar`, { motivo: "Prueba de cobertura terminada" }, t.patricia);
}

/* ---------- 3.4 Mantenimiento: en proceso con fecha pasada y cambio de equipo ---------- */
{
  const E = await nuevoEquipo();
  const M = (await api("POST", "/inventory/mantenimientos", mant(E, { estado: "en_proceso", fecha_programada: "2000-01-03" }), t.carmen)).data?.id;
  const lista = (await api("GET", "/inventory/mantenimientos?search=Equipo%20cobertura", undefined, t.carmen)).data?.items || [];
  const enLista = lista.find((m) => Number(m.id) === M);
  const notificaciones = (await api("GET", "/notificaciones", undefined, t.qa)).data || {};
  const aviso = [...(notificaciones.items || []), ...(notificaciones.anteriores || [])].find((n) => n.href === `/inventario/mantenimiento?filtro=vencido&abrir=${M}`);
  check("[cob:I:3.4-en_proceso] en proceso con fecha pasada: el barrido no lo pasa a «vencido» en la base (sigue en_proceso)", fila("SELECT estado FROM mantenimientos WHERE id = ?", M)?.estado === "en_proceso" && enLista?.estado === "en_proceso", `${fila("SELECT estado FROM mantenimientos WHERE id = ?", M)?.estado} ${enLista?.estado}`);
  check("[cob:I:3.4-en_proceso] …pero Pendientes lo avisa como «Mantenimiento vencido»", !!aviso && aviso.frase === "Mantenimiento vencido", JSON.stringify(aviso || null).slice(0, 200));

  const E1 = await nuevoEquipo();
  const E2 = await nuevoEquipo();
  const Mc = (await api("POST", "/inventory/mantenimientos", mant(E1, { fecha_programada: "2027-11-01" }), t.carmen)).data?.id;
  const antes = [equipoEstado(E1), equipoEstado(E2)];
  const mueve = await api("PUT", `/inventory/mantenimientos/${Mc}`, mant(E2, { fecha_programada: "2027-11-01" }), t.carmen);
  check("[cob:I:3.4-cambio_equipo] mover el mantenimiento a otro equipo recalcula ambos (el anterior vuelve a operativo, el nuevo queda en mantenimiento)", antes.join() === "mantenimiento,operativo" && mueve.status === 200 && equipoEstado(E1) === "operativo" && equipoEstado(E2) === "mantenimiento", `${antes} → ${mueve.status} ${equipoEstado(E1)},${equipoEstado(E2)}`);
  const mueveBaja = await api("PUT", `/inventory/mantenimientos/${Mc}`, mant(99999993, { fecha_programada: "2027-11-01" }), t.carmen);
  check("[cob:I:3.4-cambio_equipo] …moverlo a un equipo inexistente → 404 y se queda donde estaba", mueveBaja.status === 404 && Number(fila("SELECT id_equipo FROM mantenimientos WHERE id = ?", Mc)?.id_equipo) === E2, `${mueveBaja.status} ${mueveBaja.data?.message}`);
}

/* ---------- 4. Permisos por endpoint ---------- */
{
  const consJorge = await api("GET", "/inventory/consumibles", undefined, t.jorge);
  const consHector = await api("GET", "/inventory/consumibles", undefined, t.hector);
  check("[cob:I:4-get-inventory-consumibles] GET /inventory/consumibles: sin inventario:V (Administrador técnico) → 403; Auditor → 200 con lista", consJorge.status === 403 && consHector.status === 200 && Array.isArray(consHector.data?.items) && consHector.data.items.length > 0, `${consJorge.status} ${consHector.status}`);

  const C = (await api("POST", "/consumables", { producto: `Consumible permisos ${unico()}`, piezas: 1 }, t.qa)).data?.id;
  const cuerpo = { producto: "Consumible permisos editado", piezas: 1 };
  const putLuis = await api("PUT", `/consumables/${C}`, cuerpo, t.luis);
  const putHector = await api("PUT", `/consumables/${C}`, cuerpo, t.hector);
  const putJorge = await api("PUT", `/consumables/${C}`, cuerpo, t.jorge);
  check("[cob:I:4-put-consumable] PUT /consumables/:id: Analista (E solo movimientos), Auditor (V) y Administrador técnico → 403; la base no cambia", [putLuis, putHector, putJorge].every((r) => r.status === 403) && consumible(C).producto !== "Consumible permisos editado", `${putLuis.status} ${putHector.status} ${putJorge.status}`);
  const putGabriela = await api("PUT", `/consumables/${C}`, cuerpo, t.gabriela);
  check("[cob:I:4-put-consumable] …Coordinación de Investigación (inventario:E) → 200; inexistente → 404", putGabriela.status === 200 && consumible(C).producto === "Consumible permisos editado" && (await api("PUT", "/consumables/99999994", cuerpo, t.gabriela)).status === 404, `${putGabriela.status} ${putGabriela.data?.message}`);

  await api("DELETE", `/consumables/${C}`, { motivo: "Prueba de cobertura: baja para reactivar" }, t.qa);
  const reaPatricia = await api("POST", `/consumables/${C}/reactivar`, { motivo: "Vuelve al almacén" }, t.patricia);
  const reaLuis = await api("POST", `/consumables/${C}/reactivar`, { motivo: "Vuelve al almacén" }, t.luis);
  check("[cob:I:4-reactivar-consumable] reactivar consumible sin inventario:G (Responsable General con AN, Analista) → 403", reaPatricia.status === 403 && reaLuis.status === 403 && Number(consumible(C).activo) === 0, `${reaPatricia.status} ${reaLuis.status}`);
  const rea404 = await api("POST", "/consumables/99999995/reactivar", { motivo: "No existe" }, t.ricardo);
  const reaSinReauth = await api("POST", `/consumables/${C}/reactivar`, { motivo: "Vuelve al almacén" }, t.ricardo, SIN_REAUTH);
  check("[cob:I:4-reactivar-consumable] …inexistente → 404; sin contraseña → 401 reauth_required inventario:G", rea404.status === 404 && reaSinReauth.status === 401 && reaSinReauth.data?.accion === "inventario:G" && Number(consumible(C).activo) === 0, `${rea404.status} ${reaSinReauth.status} ${reaSinReauth.data?.accion}`);
  const rea = await api("POST", `/consumables/${C}/reactivar`, { motivo: "Vuelve al almacén" }, t.ricardo, { "X-Sin-Aprobar-Auto": "1" });
  check("[cob:I:4-reactivar-consumable] …Coordinación de Área Técnica (inventario:G) con contraseña lo reactiva directo (200, sin segundo usuario)", rea.status === 200 && !rea.data?.solicitud && Number(consumible(C).activo) === 1 && consumible(C).baja_motivo === null, `${rea.status} ${JSON.stringify(rea.data)}`);

  const E = await nuevoEquipo();
  const M = (await api("POST", "/inventory/mantenimientos", mant(E, { tecnico_proveedor: "Proveedor cobertura" }), t.carmen)).data?.id;
  const mSin = await api("GET", `/inventory/mantenimientos/${M}`, undefined, tSin);
  const mHector = await api("GET", `/inventory/mantenimientos/${M}`, undefined, t.hector);
  const m404 = await api("GET", "/inventory/mantenimientos/99999996", undefined, t.hector);
  check("[cob:I:4-get-mantenimiento] GET /inventory/mantenimientos/:id: sin equipos:V → 403; Auditor → 200 con el registro; inexistente → 404", mSin.status === 403 && mHector.status === 200 && Number(mHector.data?.item?.id) === M && mHector.data?.item?.tecnico_proveedor === "Proveedor cobertura" && m404.status === 404, `${mSin.status} ${mHector.status} ${m404.status}`);
  const consSin = await api("GET", "/inventory/consumibles", undefined, tSin);
  check("[cob:I:4-get-inventory-consumibles] …la cuenta sin inventario tampoco lista consumibles (403)", consSin.status === 403, `${consSin.status}`);
}

/* ---------- 2.1 Reactivo: validaciones del servidor ---------- */
{
  const base = (extra = {}) => ({ tipo_reactivo: "acidos", producto: `Ácido validación ${unico()}`, capacidad: 1, unidad_capacidad: "L", piezas: 1, ...extra });
  const alta = async (extra) => {
    const cuerpo = base(extra);
    const r = await api("POST", "/inventory/reactivos", cuerpo, t.qa);
    return { ...r, creado: fila("SELECT id FROM reactivos WHERE producto = ?", cuerpo.producto) };
  };

  const sinTipo = await alta({ tipo_reactivo: "" });
  const inventado = await alta({ tipo_reactivo: "venenos" });
  check("[cob:I:2.1-tipo_reactivo] sin tipo → 400 «Tipo de reactivo y producto son obligatorios»; un tipo fuera del catálogo → 400 «Elige un tipo de reactivo del catálogo»; no se crea nada", sinTipo.status === 400 && sinTipo.data?.message === "Tipo de reactivo y producto son obligatorios" && inventado.status === 400 && inventado.data?.message === "Elige un tipo de reactivo del catálogo" && !sinTipo.creado && !inventado.creado, `${sinTipo.status} ${sinTipo.data?.message} | ${inventado.status} ${inventado.data?.message}`);
  const Rh = await nuevoReactivo({ marca: "Marca vieja" });
  ejecutar("UPDATE reactivos SET tipo_reactivo = 'Solventes (Excel)', categoria = 'Solventes (Excel)' WHERE id = ?", Rh);
  const conserva = await api("PUT", `/inventory/reactivos/${Rh}`, { tipo_reactivo: "Solventes (Excel)", producto: reactivo(Rh).producto, marca: "Marca nueva", capacidad: 1, unidad_capacidad: "L", piezas: 1 }, t.qa);
  check("[cob:I:2.1-tipo_reactivo] un tipo heredado del Excel que no cambia se conserva al editar otro dato (200)", conserva.status === 200 && reactivo(Rh)?.tipo_reactivo === "Solventes (Excel)" && reactivo(Rh)?.marca === "Marca nueva", `${conserva.status} ${conserva.data?.message}`);

  const sinProducto = await api("POST", "/inventory/reactivos", base({ producto: "   " }), t.qa);
  const nombreAlterno = `Ácido por item_name ${unico()}`;
  const porItem = await api("POST", "/inventory/reactivos", { ...base(), producto: undefined, item_name: nombreAlterno }, t.qa);
  const productoLargo = `Ácido largo ${unico()} ${"x".repeat(250)}`;
  const largo = await api("POST", "/inventory/reactivos", base({ producto: productoLargo }), t.qa);
  check("[cob:I:2.1-producto] sin producto → 400; el producto puede venir como item_name; se recorta a 180 caracteres", sinProducto.status === 400 && sinProducto.data?.message === "Tipo de reactivo y producto son obligatorios" && porItem.status === 201 && reactivo(porItem.data?.id)?.producto === nombreAlterno && largo.status === 201 && reactivo(largo.data?.id)?.producto === productoLargo.slice(0, 180), `${sinProducto.status} ${porItem.status} ${reactivo(porItem.data?.id)?.producto} ${largo.status} ${String(reactivo(largo.data?.id)?.producto || "").length}`);

  const onzas = await alta({ unidad_capacidad: "oz" });
  const mililitros = await alta({ capacidad: 250, unidad_capacidad: "mL", piezas: 2 });
  check("[cob:I:2.1-unidad_capacidad] unidad fuera de L, mL, kg, g → 400 «La unidad de la capacidad debe ser L, mL, kg o g»; mL se acepta", onzas.status === 400 && onzas.data?.message === "La unidad de la capacidad debe ser L, mL, kg o g" && !onzas.creado && mililitros.status === 201 && reactivo(mililitros.data?.id)?.unidad_capacidad === "mL", `${onzas.status} ${onzas.data?.message} ${mililitros.status}`);
  const capNegativa = await alta({ capacidad: -1 });
  const capTexto = await alta({ capacidad: "mucha" });
  check("[cob:I:2.1-capacidad-envase] capacidad negativa o no numérica → 400 «“Capacidad por envase” debe ser un número mayor o igual a cero» y no se crea", [capNegativa, capTexto].every((r) => r.status === 400 && r.data?.message === "«Capacidad por envase» debe ser un número mayor o igual a cero" && !r.creado), `${capNegativa.status} ${capTexto.status} ${capNegativa.data?.message}`);
  const sinUnidad = await alta({ capacidad: 2, unidad_capacidad: "" });
  check("[cob:I:2.1-capacidad-sin-unidad] capacidad sin unidad → 400 «Elige la unidad de la capacidad por envase»", sinUnidad.status === 400 && sinUnidad.data?.message === "Elige la unidad de la capacidad por envase" && !sinUnidad.creado, `${sinUnidad.status} ${sinUnidad.data?.message}`);
  const piezasNeg = await alta({ piezas: -2 });
  const piezasDec = await alta({ capacidad: 2, piezas: 2.5 });
  check("[cob:I:2.1-piezas] piezas negativas → 400 «“Piezas” debe ser un número mayor o igual a cero»; acepta decimales (2 L × 2.5 = 5 L)", piezasNeg.status === 400 && piezasNeg.data?.message === "«Piezas» debe ser un número mayor o igual a cero" && !piezasNeg.creado && piezasDec.status === 201 && Number(reactivo(piezasDec.data?.id)?.piezas) === 2.5 && existenciaR(piezasDec.data?.id) === 5, `${piezasNeg.status} ${piezasNeg.data?.message} ${piezasDec.status} ${existenciaR(piezasDec.data?.id)}`);
  const minNeg = await alta({ stock_minimo: -0.5 });
  const minOk = await alta({ stock_minimo: 0.5 });
  check("[cob:I:2.1-stock_minimo] stock mínimo negativo → 400 «“Stock mínimo” debe ser un número mayor o igual a cero»; 0.5 se guarda", minNeg.status === 400 && minNeg.data?.message === "«Stock mínimo» debe ser un número mayor o igual a cero" && !minNeg.creado && minOk.status === 201 && Number(reactivo(minOk.data?.id)?.stock_minimo) === 0.5, `${minNeg.status} ${minNeg.data?.message} ${minOk.status}`);

  const columna = (extra) => alta({ tipo_reactivo: "columnas_cromatograficas", capacidad: undefined, unidad_capacidad: undefined, piezas: undefined, ...extra });
  const semi = await columna({ nuevo_usado: "Semi" });
  const usada = await columna({ nuevo_usado: "Usada", metodo: "ASP", capacidad: 3, unidad_capacidad: "L", piezas: 2, caducidad: "2027-12-31" });
  check("[cob:I:2.1-nuevo_usado] columna con condición distinta de Nueva/Usada → 400 «La condición de la columna debe ser Nueva o Usada»; «Usada» se guarda", semi.status === 400 && semi.data?.message === "La condición de la columna debe ser Nueva o Usada" && !semi.creado && usada.status === 201 && reactivo(usada.data?.id)?.nuevo_usado === "Usada", `${semi.status} ${semi.data?.message} ${usada.status}`);
  const hplc = await columna({ metodo: "HPLC" });
  check("[cob:I:2.1-metodo-columna] columna con método fuera de PSP/DSP/ASP/Otro → 400 «El método debe ser PSP, DSP, ASP u Otro»; ASP se guarda", hplc.status === 400 && hplc.data?.message === "El método debe ser PSP, DSP, ASP u Otro" && !hplc.creado && reactivo(usada.data?.id)?.metodo === "ASP", `${hplc.status} ${hplc.data?.message}`);
  const col = reactivo(usada.data?.id) || {};
  check("[cob:I:2.1-caducidad] [cob:I:2.1-existencia] una columna no guarda capacidad, piezas, existencia ni caducidad aunque se manden", col.capacidad === null && col.piezas === null && col.cantidad_actual === null && col.caducidad === null && movimientosDe("reactivos", usada.data?.id).length === 0, JSON.stringify({ c: col.capacidad, p: col.piezas, e: col.cantidad_actual, cad: col.caducidad }));

  const cadMala = await alta({ caducidad: "31/12/2027" });
  const cadInexistente = await alta({ caducidad: "2027-02-30" });
  const cadOk = await alta({ caducidad: "2027-12-31" });
  const indefinida = await alta({ caducidad: "2027-12-31", caducidad_indefinida: true });
  check("[cob:I:2.1-caducidad] caducidad dd/mm/aaaa o inexistente → 400 «“Caducidad” debe ser una fecha válida (AAAA-MM-DD)»; AAAA-MM-DD se guarda; «Indefinido» la deja vacía con la marca", [cadMala, cadInexistente].every((r) => r.status === 400 && r.data?.message === "«Caducidad» debe ser una fecha válida (AAAA-MM-DD)" && !r.creado) && reactivo(cadOk.data?.id)?.caducidad === "2027-12-31" && reactivo(indefinida.data?.id)?.caducidad === null && Number(reactivo(indefinida.data?.id)?.caducidad_indefinida) === 1, `${cadMala.status} ${cadInexistente.status} ${cadMala.data?.message} ${reactivo(indefinida.data?.id)?.caducidad}`);
  const ingresoMalo = await alta({ fecha_ingreso: "ayer" });
  const aperturaMala = await alta({ fecha_apertura: "2026-13-01" });
  const fechasOk = await alta({ fecha_ingreso: "2026-03-15", fecha_apertura: "2026-04-01" });
  check("[cob:I:2.1-fecha_ingreso-fecha_apertura] fecha de ingreso o de apertura que no es AAAA-MM-DD válida → 400 con su etiqueta; las válidas se guardan", ingresoMalo.status === 400 && ingresoMalo.data?.message === "«Fecha de ingreso» debe ser una fecha válida (AAAA-MM-DD)" && aperturaMala.status === 400 && aperturaMala.data?.message === "«Fecha de apertura» debe ser una fecha válida (AAAA-MM-DD)" && !ingresoMalo.creado && !aperturaMala.creado && reactivo(fechasOk.data?.id)?.fecha_ingreso === "2026-03-15" && reactivo(fechasOk.data?.id)?.fecha_apertura === "2026-04-01", `${ingresoMalo.status} ${ingresoMalo.data?.message} | ${aperturaMala.status} ${aperturaMala.data?.message}`);

  const x = (n) => "x".repeat(n + 40);
  const limites = { marca: 120, proveedor: 180, lote: 120, id_interno: 120, localizacion: 180, observaciones: 4000, catalogo: 120, cas: 120, contenedor: 120 };
  const comun = await alta(Object.fromEntries(Object.keys(limites).map((k) => [k, x(limites[k])])));
  const limitesCol = { parte: 120, serie: 120, descripcion: 1000 };
  const colLarga = await columna(Object.fromEntries(Object.keys(limitesCol).map((k) => [k, x(limitesCol[k])])));
  const malos = [...Object.entries(limites).filter(([k, n]) => String(reactivo(comun.data?.id)?.[k] || "").length !== n), ...Object.entries(limitesCol).filter(([k, n]) => String(reactivo(colLarga.data?.id)?.[k] || "").length !== n)];
  check("[cob:I:2.1-longitudes] textos largos se recortan en silencio (marca 120, proveedor 180, lote 120, id interno 120, localización 180, observaciones 4000, catálogo 120, CAS 120, contenedor 120, parte/serie 120, descripción 1000)", comun.status === 201 && colLarga.status === 201 && malos.length === 0, malos.map(([k]) => k).join(" "));

  const conExistencia = await alta({ capacidad: 2, piezas: 3, cantidad_actual: 999 });
  const Rx = conExistencia.data?.id;
  const inicial = movimientosDe("reactivos", Rx);
  const sinCapacidad = await alta({ capacidad: "", unidad_capacidad: "", piezas: 4 });
  check("[cob:I:2.1-existencia] alta: existencia = capacidad × piezas (2 × 3 = 6, ignora cantidad_actual) con movimiento «Existencia inicial»; sin capacidad queda 0 sin movimiento", existenciaR(Rx) === 6 && Number(reactivo(Rx).stock_maximo) === 6 && inicial.length === 1 && inicial[0].motivo === "Existencia inicial" && Number(inicial[0].cantidad) === 6 && inicial[0].referencia === `reactivo-inicial-${Rx}` && existenciaR(sinCapacidad.data?.id) === 0 && movimientosDe("reactivos", sinCapacidad.data?.id).length === 0, `${existenciaR(Rx)} ${JSON.stringify(inicial.map((m) => [m.motivo, m.cantidad]))} ${existenciaR(sinCapacidad.data?.id)}`);
  const edita = await api("PUT", `/inventory/reactivos/${Rx}`, { tipo_reactivo: "acidos", producto: reactivo(Rx).producto, capacidad: 4, unidad_capacidad: "L", piezas: 5, cantidad_actual: 1 }, t.qa);
  check("[cob:I:2.1-existencia] editar capacidad y piezas no cambia la existencia (sigue 6, solo cambia por movimientos)", edita.status === 200 && existenciaR(Rx) === 6 && Number(reactivo(Rx).piezas) === 5 && movimientosDe("reactivos", Rx).length === 1, `${edita.status} ${existenciaR(Rx)}`);

  const g404 = await api("GET", "/inventory/reactivos/99999990", undefined, t.qa);
  const p404 = await api("PUT", "/inventory/reactivos/99999990", base(), t.qa);
  const r404 = await api("POST", "/inventory/reactivos/99999990/refill", { tipo: "entrada", cantidad: 1 }, t.ricardo);
  check("[cob:I:2.1-no-encontrado] reactivo inexistente: GET, PUT y movimiento → 404 «Reactivo no encontrado»", [g404, p404, r404].every((r) => r.status === 404 && r.data?.message === "Reactivo no encontrado") && !reactivo(99999990), `${g404.status} ${p404.status} ${r404.status}`);
}

/* ---------- 2.3 Movimiento manual y 3.2 existencia ---------- */
{
  const R = await nuevoReactivo({ capacidad: 1, piezas: 5 });
  const C = await nuevoConsumible({ piezas: 2, cantidad_por_pieza: 10 });
  const mov = (cuerpo, token = t.luis, ruta = `/inventory/reactivos/${R}/refill`) => api("POST", ruta, cuerpo, token);
  const cuenta = () => movimientosDe("reactivos", R).length;
  const ultimo = () => movimientosDe("reactivos", R).at(-1);
  const n0 = cuenta();

  const tipoMalo = await mov({ tipo: "regalo", cantidad: 1 });
  check("[cob:I:2.3-tipo-entrada] tipo fuera de entrada/salida/consumo/ajuste → 400 «El tipo de movimiento debe ser entrada, salida, consumo o ajuste» y nada cambia", tipoMalo.status === 400 && tipoMalo.data?.message === "El tipo de movimiento debe ser entrada, salida, consumo o ajuste" && cuenta() === n0 && existenciaR(R) === 5, `${tipoMalo.status} ${tipoMalo.data?.message}`);
  const sinTipo = await mov({ cantidad: 1 });
  check("[cob:I:2.3-tipo-entrada] [cob:I:2.3-motivo-omisión] [cob:I:3.2-existencia-entrada] sin tipo es una entrada: suma (5 → 6) con motivo «Relleno manual de stock» y fecha de hoy", sinTipo.status === 200 && sinTipo.data?.message === "Movimiento registrado" && existenciaR(R) === 6 && ultimo()?.tipo === "entrada" && Number(ultimo()?.cantidad) === 1 && ultimo()?.motivo === "Relleno manual de stock" && ultimo()?.fecha_movimiento === hoy(), `${sinTipo.status} ${existenciaR(R)} ${JSON.stringify(ultimo() && [ultimo().tipo, ultimo().motivo, ultimo().fecha_movimiento])}`);

  const texto = await mov({ tipo: "entrada", cantidad: "mucho" });
  const vacia = await mov({ tipo: "salida" });
  const contadaTexto = await mov({ tipo: "ajuste", cantidad: "abc", motivo: "Conteo físico" });
  check("[cob:I:2.3-cantidad-numérica] cantidad no numérica o vacía → 400 «Captura una cantidad mayor a cero» (ajuste: «Captura la cantidad contada»)", texto.status === 400 && texto.data?.message === "Captura una cantidad mayor a cero" && vacia.status === 400 && vacia.data?.message === "Captura una cantidad mayor a cero" && contadaTexto.status === 400 && contadaTexto.data?.message === "Captura la cantidad contada" && cuenta() === n0 + 1, `${texto.status} ${vacia.status} ${contadaTexto.status} ${contadaTexto.data?.message}`);
  const cero = await mov({ tipo: "entrada", cantidad: 0 });
  const negativa = await mov({ tipo: "consumo", cantidad: -1 });
  const contadaNeg = await mov({ tipo: "ajuste", cantidad: -1, motivo: "Conteo físico" });
  check("[cob:I:2.3-cantidad-negativa] entrada/salida con 0 o negativo → 400 «Captura una cantidad mayor a cero»; ajuste negativo → 400 «La cantidad contada no puede ser negativa»", cero.status === 400 && cero.data?.message === "Captura una cantidad mayor a cero" && negativa.status === 400 && contadaNeg.status === 400 && contadaNeg.data?.message === "La cantidad contada no puede ser negativa" && existenciaR(R) === 6 && cuenta() === n0 + 1, `${cero.status} ${negativa.status} ${contadaNeg.status} ${contadaNeg.data?.message}`);
  const ajusteSinMotivo = await mov({ tipo: "ajuste", cantidad: 4 });
  check("[cob:I:2.3-motivo-obligatorio-ajuste] ajuste sin motivo → 400 «Indica el motivo del ajuste (por ejemplo, «Conteo físico de enero»)»", ajusteSinMotivo.status === 400 && ajusteSinMotivo.data?.message === "Indica el motivo del ajuste (por ejemplo, «Conteo físico de enero»)" && existenciaR(R) === 6, `${ajusteSinMotivo.status} ${ajusteSinMotivo.data?.message}`);
  await mov({ tipo: "consumo", cantidad: 1 });
  const motivoConsumo = ultimo()?.motivo;
  await mov({ tipo: "salida", cantidad: 1 });
  check("[cob:I:2.3-motivo-omisión] [cob:I:3.2-existencia-salida-consumo] consumo y salida restan (6 → 4) con motivo por omisión «Consumo registrado» / «Salida registrada»", existenciaR(R) === 4 && motivoConsumo === "Consumo registrado" && ultimo()?.motivo === "Salida registrada" && ultimo()?.tipo === "salida", `${existenciaR(R)} ${motivoConsumo} ${ultimo()?.motivo}`);
  const demasiado = await mov({ tipo: "salida", cantidad: 4.5 });
  check("[cob:I:2.3-salida-consumo-existencia] [cob:I:3.2-existencia-salida-consumo] salida mayor que la existencia → 409 existencia_insuficiente «No hay existencia suficiente para esa cantidad (hay 4)»; nunca negativa", demasiado.status === 409 && demasiado.data?.codigo === "existencia_insuficiente" && demasiado.data?.message === "No hay existencia suficiente para esa cantidad (hay 4)" && existenciaR(R) === 4, `${demasiado.status} ${demasiado.data?.codigo} ${demasiado.data?.message}`);

  const ajuste = await mov({ tipo: "ajuste", cantidad: 2.5, motivo: "Conteo físico de cobertura" });
  const movAjuste = ultimo();
  const igual = await mov({ tipo: "ajuste", cantidad: 2.5, motivo: "Conteo sin diferencia" });
  check("[cob:I:2.3-ajuste-delta] [cob:I:3.2-existencia-contado-ajuste] ajuste: la existencia queda en lo contado (4 → 2.5) y se guarda la diferencia con signo (−1.5); sin diferencia se guarda 0 (no −0)", ajuste.status === 200 && ajuste.data?.message === "Existencia ajustada" && movAjuste?.tipo === "ajuste" && Number(movAjuste?.cantidad) === -1.5 && igual.status === 200 && Object.is(Number(ultimo()?.cantidad), 0) && existenciaR(R) === 2.5, `${ajuste.status} ${movAjuste?.cantidad} ${ultimo()?.cantidad} ${existenciaR(R)}`);

  const fechaMala = await mov({ tipo: "entrada", cantidad: 1, fecha_movimiento: "15/03/2026" });
  const fechaInexistente = await mov({ tipo: "entrada", cantidad: 1, fecha_movimiento: "2026-02-30" });
  const fechaPasada = await mov({ tipo: "entrada", cantidad: 1, fecha_movimiento: enDias(-2) });
  check("[cob:I:2.3-fecha_movimiento] fecha que no es AAAA-MM-DD o no existe → 400 «La fecha del movimiento no es válida»; una pasada válida se guarda tal cual", fechaMala.status === 400 && fechaMala.data?.message === "La fecha del movimiento no es válida" && fechaInexistente.status === 400 && fechaPasada.status === 200 && ultimo()?.fecha_movimiento === enDias(-2) && existenciaR(R) === 3.5, `${fechaMala.status} ${fechaInexistente.status} ${fechaPasada.status} ${ultimo()?.fecha_movimiento}`);
  const futura = await mov({ tipo: "entrada", cantidad: 1, fecha_movimiento: enDias(1) });
  check("[cob:I:2.3-fecha-futura] fecha de mañana → 400 «La fecha del movimiento no puede ser futura» y nada cambia", futura.status === 400 && futura.data?.message === "La fecha del movimiento no puede ser futura" && existenciaR(R) === 3.5, `${futura.status} ${futura.data?.message}`);

  // Vínculo con un folio de Muestras.
  const c = await cadena(t, "COBMOV");
  const folioR = fila("SELECT folio_num FROM muestras_recepcion WHERE id = ?", c.R)?.folio_num;
  const n1 = cuenta();
  const tipoVinculo = await mov({ tipo: "entrada", cantidad: 1, vinculo_tipo: "factura", vinculo_folio: folioR }, t.qa);
  const sinFolio = await mov({ tipo: "entrada", cantidad: 1, vinculo_tipo: "recepcion" }, t.qa);
  const sinTipoV = await mov({ tipo: "entrada", cantidad: 1, vinculo_folio: folioR }, t.qa);
  const msgV = "El vínculo debe indicar el tipo (recepción, procesamiento, extracción o análisis) y su folio";
  check("[cob:I:2.3-vínculo-folio] vínculo con un tipo desconocido, sin folio o con folio sin tipo → 400 «El vínculo debe indicar el tipo … y su folio»", [tipoVinculo, sinFolio, sinTipoV].every((r) => r.status === 400 && r.data?.message === msgV) && cuenta() === n1, `${tipoVinculo.status} ${sinFolio.status} ${sinTipoV.status} ${tipoVinculo.data?.message}`);
  const luisNoAsignado = await mov({ tipo: "entrada", cantidad: 1, vinculo_tipo: "recepcion", vinculo_folio: folioR });
  const folioInexistente = await mov({ tipo: "entrada", cantidad: 1, vinculo_tipo: "recepcion", vinculo_folio: 9999999 }, t.qa);
  const sinMuestras = await mov({ tipo: "entrada", cantidad: 1, vinculo_tipo: "recepcion", vinculo_folio: folioR }, tMov);
  check("[cob:I:2.3-acceso-folio] sin acceso al folio (Analista con alcance asignado sin esa recepción; cuenta sin muestras) o folio inexistente → 403 «No tienes acceso a este folio» y no se registra", [luisNoAsignado, folioInexistente, sinMuestras].every((r) => r.status === 403 && r.data?.message === "No tienes acceso a este folio") && cuenta() === n1, `${luisNoAsignado.status} ${folioInexistente.status} ${sinMuestras.status} ${sinMuestras.data?.message}`);
  await api("POST", `/samples/reception/${c.R}/asignaciones`, { usuario_id: id.luis, motivo: "Asignación de la prueba de cobertura" }, t.ricardo);
  const luisAsignado = await mov({ tipo: "entrada", cantidad: 1, motivo: "Entrada ligada", vinculo_tipo: "recepcion", vinculo_folio: folioR });
  check("[cob:I:2.3-acceso-folio] …con la recepción asignada se registra ligada a ella («… · Recepción <folio>»)", luisAsignado.status === 200 && ultimo()?.vinculo_tipo === "recepcion" && Number(ultimo()?.vinculo_id) === c.R && ultimo()?.motivo === `Entrada ligada · Recepción ${folioR}`, `${luisAsignado.status} ${luisAsignado.data?.message} ${ultimo()?.motivo}`);

  const Rcol = await nuevoReactivo({ tipo_reactivo: "columnas_cromatograficas", capacidad: undefined, unidad_capacidad: undefined, piezas: undefined });
  const enColumna = await mov({ tipo: "entrada", cantidad: 1 }, t.luis, `/inventory/reactivos/${Rcol}/refill`);
  check("[cob:I:2.3-columna-cromatográfica] movimiento sobre una columna cromatográfica → 400 «Las columnas cromatográficas no llevan existencias»", enColumna.status === 400 && enColumna.data?.message === "Las columnas cromatográficas no llevan existencias" && movimientosDe("reactivos", Rcol).length === 0, `${enColumna.status} ${enColumna.data?.message}`);

  const n2 = cuenta();
  const entradaMov = await mov({ tipo: "entrada", cantidad: 1 }, tMov);
  const ajusteMov = await mov({ tipo: "ajuste", cantidad: 1, motivo: "Conteo sin permiso de edición" }, tMov);
  const ajusteMovC = await api("POST", `/consumables/${C}/refill`, { tipo: "ajuste", cantidad: 1, motivo: "Conteo sin permiso de edición" }, tMov);
  check("[cob:I:2.3-ajuste-exige] con solo inventario:C de movimientos: la entrada pasa (200) pero el ajuste → 403 en reactivos y consumibles (pide inventario:E)", entradaMov.status === 200 && ajusteMov.status === 403 && /inventario:E/.test(ajusteMov.data?.message || "") && ajusteMovC.status === 403 && cuenta() === n2 + 1 && Number(consumible(C).existencia) === 20, `${entradaMov.status} ${ajusteMov.status} ${ajusteMov.data?.message} ${ajusteMovC.status}`);
  const ajusteLuis = await api("POST", `/consumables/${C}/refill`, { tipo: "ajuste", cantidad: 0, motivo: "Conteo: caja vacía" }, t.luis);
  check("[cob:I:3.2-existencia-contado-ajuste] [cob:I:2.3-cantidad-negativa] con inventario:C y E de movimientos el ajuste a 0 se acepta (20 → 0, diferencia −20)", ajusteLuis.status === 200 && Number(consumible(C).existencia) === 0 && Number(movimientosDe("consumibles", C).at(-1)?.cantidad) === -20, `${ajusteLuis.status} ${consumible(C)?.existencia}`);

  // Ajuste por conteo con fecha anterior: lo contado es la existencia al cierre de ese día.
  const Ra = await nuevoReactivo({ capacidad: 1, piezas: 8 });
  ejecutar("UPDATE reactivos SET creado_en = ? WHERE id = ?", `${enDias(-10)} 12:00:00`, Ra);
  ejecutar("UPDATE movimientos SET fecha_movimiento = ? WHERE tabla_origen = 'reactivos' AND id_item = ?", enDias(-10), Ra);
  await mov({ tipo: "salida", cantidad: 1, motivo: "Salida de hoy" }, t.luis, `/inventory/reactivos/${Ra}/refill`);
  const antesAlta = await mov({ tipo: "ajuste", cantidad: 8, motivo: "Conteo anterior al alta", fecha_movimiento: enDias(-20) }, t.luis, `/inventory/reactivos/${Ra}/refill`);
  const noAlcanza = await mov({ tipo: "ajuste", cantidad: 0.5, motivo: "Conteo que no alcanza", fecha_movimiento: enDias(-3) }, t.luis, `/inventory/reactivos/${Ra}/refill`);
  const pasado = await mov({ tipo: "ajuste", cantidad: 8, motivo: "Conteo de hace 3 días", fecha_movimiento: enDias(-3) }, t.luis, `/inventory/reactivos/${Ra}/refill`);
  check("[cob:I:3.2-existencia-contado-ajuste] conteo con fecha anterior: 8 contados hace 3 días + la salida de 1 de hoy = 7 (no borra lo posterior); antes del alta → 400 fecha_movimiento; si lo contado no alcanza para lo que salió después → 409", antesAlta.status === 400 && antesAlta.data?.campo === "fecha_movimiento" && noAlcanza.status === 409 && noAlcanza.data?.codigo === "existencia_insuficiente" && pasado.status === 200 && existenciaR(Ra) === 7 && movimientosDe("reactivos", Ra).filter((m) => m.tipo === "salida").length === 1, `${antesAlta.status} ${antesAlta.data?.campo} ${noAlcanza.status} ${pasado.status} ${existenciaR(Ra)}`);

  // Existencia por formato, reversión al reeditar y al anular; restaurar no vuelve a descontar.
  const Rf = await nuevoReactivo({ capacidad: 1, piezas: 2 });
  const cf = await cadena(t, "COBFMT");
  const proc = { recepcion_id: cf.R, muestra_tipo: "unica", id_interno: cf.idInt, fecha_procesamiento: "2026-09-21", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "Persona A", nombre_quien_superviso: "Persona B" };
  const procesamientos = () => filas("SELECT id FROM muestras_procesamiento WHERE recepcion_id = ?", cf.R).length;
  const antesP = procesamientos();
  const excede = await api("POST", "/samples/processing", { ...proc, uso_inventario: [{ tipo: "reactivo", ref: String(Rf), cantidad: 5 }] }, t.qa);
  check("[cob:I:3.2-existencia-formato] un formato que pide más de lo que hay → 409 existencia_insuficiente, sin registro ni descuento", excede.status === 409 && excede.data?.codigo === "existencia_insuficiente" && procesamientos() === antesP && existenciaR(Rf) === 2, `${excede.status} ${excede.data?.codigo} ${excede.data?.message}`);
  const P = await api("POST", "/samples/processing", { ...proc, uso_inventario: [{ tipo: "reactivo", ref: String(Rf), cantidad: 0.5 }] }, t.qa);
  const PID = P.data?.id;
  const salida = movimientosDe("reactivos", Rf).find((m) => m.tipo === "salida");
  check("[cob:I:3.2-existencia-formato] al guardar el procesamiento se descuenta (2 → 1.5) con una salida de referencia PROC-<id>-INS-0", P.status === 201 && existenciaR(Rf) === 1.5 && salida?.referencia === `PROC-${PID}-INS-0` && Number(salida?.cantidad) === 0.5, `${P.status} ${P.data?.message} ${existenciaR(Rf)} ${salida?.referencia}`);
  const folio = (await api("GET", `/samples/processing/${PID}`, undefined, t.qa)).data?.item?.folio_num;
  const reedita = await api("PUT", `/samples/processing/${PID}`, { ...proc, folio_num: folio, uso_inventario: [{ tipo: "reactivo", ref: String(Rf), cantidad: 0.3 }] }, t.qa);
  const trasReedicion = movimientosDe("reactivos", Rf);
  const rev = trasReedicion.find((m) => Number(m.revierte_id) === Number(salida?.id));
  const nueva = trasReedicion.find((m) => m.tipo === "salida" && m.referencia === `PROC-${PID}-INS-0-r2`);
  check("[cob:I:3.2-salida-normal-revertida] reeditar: la salida original queda revertida por una entrada ligada (revierte_id, ref …-REV, «Reversión (reedición) de: …») y se agrega la salida nueva (1.5 → 1.7)", reedita.status === 200 && !!rev && rev.tipo === "entrada" && rev.referencia === `PROC-${PID}-INS-0-REV` && /^Reversión \(reedición\) de: /.test(rev.motivo || "") && Number(rev.cantidad) === 0.5 && !!nueva && Number(nueva.cantidad) === 0.3 && Math.abs(existenciaR(Rf) - 1.7) < 1e-9, `${reedita.status} ${reedita.data?.message} ${JSON.stringify(trasReedicion.map((m) => [m.tipo, m.cantidad, m.referencia, m.revierte_id]))}`);
  const listaRev = (await api("GET", `/inventory/movimientos?tabla=reactivos&id=${Rf}`, undefined, t.hector)).data?.items || [];
  check("[cob:I:3.2-salida-normal-revertida] la lista de movimientos marca la salida revertida (revertido_por) y la reversión (revierte_id)", Number(listaRev.find((m) => Number(m.id) === Number(salida?.id))?.revertido_por) === Number(rev?.id) && Number(listaRev.find((m) => Number(m.id) === Number(rev?.id))?.revierte_id) === Number(salida?.id), JSON.stringify(listaRev.map((m) => [m.id, m.revierte_id, m.revertido_por])));
  const anula = await api("POST", `/samples/processing/${PID}/anular`, { motivo: "Prueba de cobertura: reversión al anular" }, t.qa);
  const revAnula = movimientosDe("reactivos", Rf).find((m) => Number(m.revierte_id) === Number(nueva?.id));
  check("[cob:I:3.2-salida-normal-revertida] anular: entrada de reversión «Reversión (anulación) de: …» de la salida vigente y la existencia vuelve a 2", anula.status === 200 && !!fila("SELECT anulado_en FROM muestras_procesamiento WHERE id = ?", PID)?.anulado_en && !!revAnula && /^Reversión \(anulación\) de: /.test(revAnula.motivo || "") && existenciaR(Rf) === 2, `${anula.status} ${anula.data?.message} ${existenciaR(Rf)}`);
  const movsAntes = movimientosDe("reactivos", Rf).length;
  const restaura = await api("POST", `/samples/processing/${PID}/restaurar`, { motivo: "Prueba de cobertura: se anuló por error" }, t.qa);
  check("[cob:I:3.2-restaurar-anulado] restaurar el registro anulado no vuelve a descontar: existencia 2 y ningún movimiento nuevo", restaura.status === 200 && !fila("SELECT anulado_en FROM muestras_procesamiento WHERE id = ?", PID)?.anulado_en && existenciaR(Rf) === 2 && movimientosDe("reactivos", Rf).length === movsAntes, `${restaura.status} ${restaura.data?.message || restaura.data?.resultado?.message} ${existenciaR(Rf)}`);
}

/* ---------- 2.4 Baja y reactivación (reactivos, consumibles, equipos) y sus permisos ---------- */
{
  const casos = [
    ["reactivo", "Reactivo", "/inventory/reactivos", "reactivos", "inventario", await nuevoReactivo(), "[cob:I:4-DELETE-inventory-reactivos]", "[cob:I:4-POST-inventory-reactivos-reactivar]"],
    ["consumible", "Consumible", "/consumables", "consumibles", "inventario", await nuevoConsumible(), "[cob:I:4-DELETE-consumables]", "[cob:I:4-POST-consumables-reactivar]"],
    ["equipo", "Equipo", "/inventory/equipos", "equipos", "equipos", await nuevoEquipo(), "[cob:I:4-DELETE-inventory-equipos]", "[cob:I:4-POST-inventory-equipos-reactivar]"],
  ];
  for (const [que, Label, ruta, tabla, modulo, idItem, etqBaja, etqReactivar] of casos) {
    const activo = () => Number(fila(`SELECT activo FROM ${tabla} WHERE id = ?`, idItem)?.activo ?? 1);
    const corto = await api("DELETE", `${ruta}/${idItem}`, { motivo: "mal" }, t.patricia);
    check(`[cob:I:2.4-motivo] ${etqBaja} ${que}: baja con motivo de menos de 5 caracteres → 400 «Indica el motivo de la baja del ${que} (al menos 5 caracteres)»`, corto.status === 400 && corto.data?.message === `Indica el motivo de la baja del ${que} (al menos 5 caracteres)` && activo() === 1, `${corto.status} ${corto.data?.message}`);
    const b404 = await api("DELETE", `${ruta}/99999989`, { motivo: "No existe este registro" }, t.patricia);
    const r404 = await api("POST", `${ruta}/99999989/reactivar`, { motivo: "No existe este registro" }, t.ricardo);
    check(`[cob:I:2.4-existe] ${etqBaja} ${etqReactivar} ${que}: inexistente → 404 «${Label} no encontrado» al dar de baja y al reactivar`, [b404, r404].every((r) => r.status === 404 && r.data?.message === `${Label} no encontrado`), `${b404.status} ${r404.status} ${b404.data?.message}`);
    const yaActivo = await api("POST", `${ruta}/${idItem}/reactivar`, { motivo: "Reactivar algo activo" }, t.ricardo);
    check(`[cob:I:2.4-ya-baja-activo] ${etqReactivar} ${que}: reactivar uno activo → 409 «${Label} ya está activo»`, yaActivo.status === 409 && yaActivo.data?.message === `${Label} ya está activo`, `${yaActivo.status} ${yaActivo.data?.message}`);
    const sinPermiso = await Promise.all([t.luis, t.gabriela, t.hector, t.carmen].map((tk) => api("DELETE", `${ruta}/${idItem}`, { motivo: "Baja sin permiso de anular" }, tk)));
    const sinReauth = await api("DELETE", `${ruta}/${idItem}`, { motivo: "Baja sin contraseña" }, t.patricia, SIN_REAUTH);
    check(`[cob:I:2.4-reautenticación] ${etqBaja} ${que}: DELETE sin ${modulo}:AN (Analista, Coord. Investigación, Auditor, Adm. Auxiliar) → 403; sin contraseña → 401 reauth_required ${modulo}:AN; sigue activo`, sinPermiso.every((r) => r.status === 403) && sinReauth.status === 401 && sinReauth.data?.codigo === "reauth_required" && sinReauth.data?.accion === `${modulo}:AN` && activo() === 1, `${sinPermiso.map((r) => r.status)} ${sinReauth.status} ${sinReauth.data?.accion}`);
    const baja = await api("DELETE", `${ruta}/${idItem}`, { motivo: "Prueba de cobertura: retirado" }, t.patricia);
    const otra = await api("DELETE", `${ruta}/${idItem}`, { motivo: "Prueba de cobertura: otra vez" }, t.patricia);
    check(`[cob:I:2.4-ya-baja-activo] ${etqBaja} ${que}: la Responsable General (AN) lo da de baja (200); otra vez → 409 «${Label} ya está dado de baja»`, baja.status === 200 && activo() === 0 && otra.status === 409 && otra.data?.message === `${Label} ya está dado de baja`, `${baja.status} ${otra.status} ${otra.data?.message}`);
    const reaSinG = await Promise.all([t.patricia, t.luis, t.gabriela].map((tk) => api("POST", `${ruta}/${idItem}/reactivar`, { motivo: "Reactivar sin permiso" }, tk)));
    const reaCorto = await api("POST", `${ruta}/${idItem}/reactivar`, { motivo: "ok" }, t.ricardo);
    const reaSinReauth = await api("POST", `${ruta}/${idItem}/reactivar`, { motivo: "Vuelve al laboratorio" }, t.ricardo, SIN_REAUTH);
    check(`[cob:I:2.4-motivo] [cob:I:2.4-reautenticación] ${etqReactivar} ${que}: reactivar sin ${modulo}:G (Responsable General con AN, Analista, Coord. Investigación) → 403; motivo corto → 400 «Indica el motivo de la reactivación (al menos 5 caracteres)»; sin contraseña → 401 ${modulo}:G; sigue en baja`, reaSinG.every((r) => r.status === 403) && reaCorto.status === 400 && reaCorto.data?.message === "Indica el motivo de la reactivación (al menos 5 caracteres)" && reaSinReauth.status === 401 && reaSinReauth.data?.accion === `${modulo}:G` && activo() === 0, `${reaSinG.map((r) => r.status)} ${reaCorto.status} ${reaCorto.data?.message} ${reaSinReauth.status} ${reaSinReauth.data?.accion}`);
    const rea = await api("POST", `${ruta}/${idItem}/reactivar`, { motivo: "Vuelve al laboratorio" }, t.ricardo, { "X-Sin-Aprobar-Auto": "1" });
    const r = fila(`SELECT activo, baja_motivo, baja_en, baja_por FROM ${tabla} WHERE id = ?`, idItem);
    const ev = fila("SELECT motivo FROM auditoria WHERE accion = 'reactivar' AND entidad = ? AND entidad_id = ? ORDER BY id DESC LIMIT 1", tabla, String(idItem));
    check(`[cob:I:3.1-baja-activo-reactivar] ${etqReactivar} ${que}: Coord. de Área Técnica (G) con contraseña lo reactiva directo (200, sin segundo usuario), limpia la baja y queda en la bitácora con el motivo`, rea.status === 200 && !rea.data?.solicitud && Number(r?.activo) === 1 && r?.baja_motivo === null && r?.baja_en === null && r?.baja_por === null && ev?.motivo === "Vuelve al laboratorio", `${rea.status} ${JSON.stringify(rea.data)}`);
  }
}

/* ---------- 2.5 Equipo: validaciones ---------- */
{
  const nombre = `Equipo validación ${unico()}`;
  const sinNombre = await api("POST", "/inventory/equipos", { nombre: "  ", marca: "Sin nombre" }, t.qa);
  const E = await nuevoEquipo();
  const sinNombrePut = await api("PUT", `/inventory/equipos/${E}`, { nombre: "", estado: "operativo" }, t.qa);
  check("[cob:I:2.5-nombre-obligatorio] sin nombre → 400 «El nombre del equipo es obligatorio» al crear y al editar; nada cambia", sinNombre.status === 400 && sinNombre.data?.message === "El nombre del equipo es obligatorio" && sinNombrePut.status === 400 && sinNombrePut.data?.message === "El nombre del equipo es obligatorio" && /^Equipo cobertura/.test(equipo(E)?.nombre || ""), `${sinNombre.status} ${sinNombrePut.status}`);
  const serie = `SERIE-${unico()}`;
  const E1 = await nuevoEquipo({ numero_serie: serie });
  const repetida = await api("POST", "/inventory/equipos", { nombre, numero_serie: serie }, t.qa);
  const repetidaPut = await api("PUT", `/inventory/equipos/${E}`, { nombre: equipo(E).nombre, numero_serie: serie, estado: "operativo" }, t.qa);
  check("[cob:I:2.5-serie-único] [cob:I:4-PUT-inventory-equipos] número de serie repetido → 409 «Ya existe un equipo con ese número de serie» al crear y al editar; no se crea ni cambia", !!E1 && repetida.status === 409 && repetida.data?.message === "Ya existe un equipo con ese número de serie" && repetidaPut.status === 409 && !fila("SELECT id FROM equipos WHERE nombre = ?", nombre) && equipo(E)?.numero_serie !== serie, `${repetida.status} ${repetida.data?.message} ${repetidaPut.status}`);
  const sinEstado = await api("POST", "/inventory/equipos", { nombre: `${nombre} sin estado` }, t.qa);
  const estadoRaro = await api("POST", "/inventory/equipos", { nombre: `${nombre} roto`, estado: "roto" }, t.qa);
  const enMantAlta = await api("POST", "/inventory/equipos", { nombre: `${nombre} en mant`, estado: "mantenimiento" }, t.qa);
  const estadoRaroPut = await api("PUT", `/inventory/equipos/${E}`, { nombre: equipo(E).nombre, estado: "descompuesto" }, t.qa);
  check("[cob:I:2.5-estado-omisión] sin estado queda «operativo»; un estado fuera del catálogo (o «mantenimiento» al dar de alta) → 400 campo estado", sinEstado.status === 201 && equipo(sinEstado.data?.id)?.estado === "operativo" && [estadoRaro, enMantAlta, estadoRaroPut].every((r) => r.status === 400 && r.data?.campo === "estado") && !fila("SELECT id FROM equipos WHERE nombre = ?", `${nombre} roto`) && equipo(E)?.estado === "operativo", `${sinEstado.status} ${estadoRaro.status} ${enMantAlta.status} ${estadoRaroPut.status} ${estadoRaro.data?.message}`);
  const calMala = await api("POST", "/inventory/equipos", { nombre: `${nombre} cal`, fecha_prox_calibracion: "15/10/2027" }, t.qa);
  const calInexistente = await api("PUT", `/inventory/equipos/${E}`, { nombre: equipo(E).nombre, estado: "operativo", fecha_prox_calibracion: "2027-02-30" }, t.qa);
  const calOk = await api("PUT", `/inventory/equipos/${E}`, { nombre: equipo(E).nombre, estado: "operativo", fecha_prox_calibracion: "2027-10-15" }, t.gabriela);
  check("[cob:I:2.5-fecha_prox_calibracion] [cob:I:3.3-fecha_prox_calibracion] próxima calibración que no es AAAA-MM-DD válida → 400 campo fecha_prox_calibracion; equipos:E (Coord. Investigación) la cambia a mano", calMala.status === 400 && calMala.data?.campo === "fecha_prox_calibracion" && calInexistente.status === 400 && calInexistente.data?.campo === "fecha_prox_calibracion" && calOk.status === 200 && equipo(E)?.fecha_prox_calibracion === "2027-10-15", `${calMala.status} ${calMala.data?.message} ${calInexistente.status} ${calOk.status}`);
  const x = (n) => "x".repeat(n + 30);
  const largo = await api("POST", "/inventory/equipos", { nombre: `${unico()} ${x(150)}`, marca: x(100), modelo: x(100), numero_serie: `${unico()}${x(100)}`, ubicacion: x(150), clave_bitacora: x(60) }, t.qa);
  const el = equipo(largo.data?.id) || {};
  check("[cob:I:2.5-marca-modelo-ubicación] textos largos se recortan: nombre 150, marca/modelo/serie 100, ubicación 150, clave de bitácora 60", largo.status === 201 && el.nombre?.length === 150 && el.marca?.length === 100 && el.modelo?.length === 100 && el.numero_serie?.length === 100 && el.ubicacion?.length === 150 && el.clave_bitacora?.length === 60, `${largo.status} ${[el.nombre, el.marca, el.modelo, el.numero_serie, el.ubicacion, el.clave_bitacora].map((v) => String(v || "").length)}`);

  // «Autorizar a…»: exige ensayos:A o calidad:A y contraseña; omite a uno mismo y cuentas inexistentes.
  const nombreAut = `Equipo autorizado ${unico()}`;
  const autGabriela = await api("POST", "/inventory/equipos", { nombre: nombreAut, autorizar_a: [id.luis] }, t.gabriela);
  const autSinReauth = await api("POST", "/inventory/equipos", { nombre: nombreAut, autorizar_a: [id.luis] }, t.ricardo, SIN_REAUTH);
  check("[cob:I:2.5-autorizar_a] [cob:I:4-POST-inventory-equipos] con «Autorizar a…»: sin ensayos:A ni calidad:A (Coord. Investigación) → 403; sin contraseña → 401 autorizaciones:otorgar; en ambos casos no se crea el equipo", autGabriela.status === 403 && autSinReauth.status === 401 && autSinReauth.data?.accion === "autorizaciones:otorgar" && !fila("SELECT id FROM equipos WHERE nombre = ?", nombreAut), `${autGabriela.status} ${autGabriela.data?.message} ${autSinReauth.status} ${autSinReauth.data?.accion}`);
  const aut = await api("POST", "/inventory/equipos", { nombre: nombreAut, autorizar_a: [id.ricardo, id.luis, 99999988], folio_fx_thf_ap: `AP-${unico()}` }, t.ricardo);
  const omitidos = Object.fromEntries((aut.data?.omitidos || []).map((o) => [o.usuario_id, o.motivo]));
  const otorgada = fila("SELECT usuario_id FROM autorizaciones_personal WHERE tipo = 'equipo' AND clave = ? AND revocada_en IS NULL", String(aut.data?.id));
  check("[cob:I:2.5-autorizar_a] con contraseña (Coord. Área Técnica): autoriza a la persona activa y omite «No puedes autorizarte a ti mismo…» y «Cuenta inexistente o inactiva»", aut.status === 201 && (aut.data?.autorizados || []).map((a) => a.usuario_id).join() === String(id.luis) && /^No puedes autorizarte a ti mismo/.test(omitidos[id.ricardo] || "") && omitidos[99999988] === "Cuenta inexistente o inactiva" && Number(otorgada?.usuario_id) === id.luis, `${aut.status} ${aut.data?.message} ${JSON.stringify(aut.data?.autorizados)} ${JSON.stringify(omitidos)} ${JSON.stringify(otorgada)}`);

  // Estado manual (3.3).
  const Em = await nuevoEquipo();
  const aFuera = await api("PUT", `/inventory/equipos/${Em}`, { nombre: equipo(Em).nombre, estado: "fuera_servicio" }, t.gabriela);
  const fuera = equipo(Em)?.estado;
  const aCal = await api("PUT", `/inventory/equipos/${Em}`, { nombre: equipo(Em).nombre, estado: "calibracion_pendiente" }, t.gabriela);
  const cal = equipo(Em)?.estado;
  const aMant = await api("PUT", `/inventory/equipos/${Em}`, { nombre: equipo(Em).nombre, estado: "mantenimiento" }, t.gabriela);
  const Mm = (await api("POST", "/inventory/mantenimientos", mant(Em), t.carmen)).data?.id;
  const aOper = await api("PUT", `/inventory/equipos/${Em}`, { nombre: equipo(Em).nombre, estado: "operativo" }, t.gabriela);
  check("[cob:I:3.3-cualquiera-fuera_servicio] estado manual (equipos:E): fuera de servicio y calibración pendiente se guardan; «mantenimiento» a mano se acepta pero sin pendientes vuelve a operativo; con uno pendiente, «operativo» se queda en mantenimiento", aFuera.status === 200 && fuera === "fuera_servicio" && aCal.status === 200 && cal === "calibracion_pendiente" && aMant.status === 200 && !!Mm && aOper.status === 200 && equipo(Em)?.estado === "mantenimiento", `${aFuera.status} ${fuera} ${aCal.status} ${cal} ${aMant.status} ${aOper.status} ${equipo(Em)?.estado}`);
  await api("DELETE", `/inventory/mantenimientos/${Mm}`, { motivo: "Prueba de cobertura: terminada" }, t.qa);
}

/* ---------- 2.6 Mantenimiento: validaciones; 3.4 transiciones ---------- */
{
  const E = await nuevoEquipo();
  const de = () => filas("SELECT * FROM mantenimientos WHERE id_equipo = ? ORDER BY id", E);
  const n0 = de().length;
  const sinEquipo = await api("POST", "/inventory/mantenimientos", { tipo: "preventivo", fecha_programada: "2027-05-01" }, t.carmen);
  const equipo404 = await api("POST", "/inventory/mantenimientos", mant(99999987), t.carmen);
  const Ebaja = await nuevoEquipo();
  await api("DELETE", `/inventory/equipos/${Ebaja}`, { motivo: "Prueba de cobertura: equipo retirado" }, t.qa);
  const equipoBaja = await api("POST", "/inventory/mantenimientos", mant(Ebaja), t.carmen);
  check("[cob:I:2.6-id_equipo] sin equipo → 400 «Selecciona un equipo»; equipo inexistente → 404 «El equipo no existe»; dado de baja → 409 dado_de_baja", sinEquipo.status === 400 && sinEquipo.data?.message === "Selecciona un equipo" && equipo404.status === 404 && equipo404.data?.message === "El equipo no existe" && equipoBaja.status === 409 && equipoBaja.data?.codigo === "dado_de_baja" && filas("SELECT id FROM mantenimientos WHERE id_equipo IN (?, ?)", 99999987, Ebaja).length === 0, `${sinEquipo.status} ${equipo404.status} ${equipo404.data?.message} ${equipoBaja.status} ${equipoBaja.data?.codigo}`);
  const sinFecha = await api("POST", "/inventory/mantenimientos", mant(E, { fecha_programada: "" }), t.carmen);
  const fechaMala = await api("POST", "/inventory/mantenimientos", mant(E, { fecha_programada: "01/05/2027" }), t.carmen);
  check("[cob:I:2.6-fecha_programada] sin fecha programada → 400 «La fecha programada es obligatoria»; dd/mm/aaaa → 400 campo fecha_programada", sinFecha.status === 400 && sinFecha.data?.message === "La fecha programada es obligatoria" && fechaMala.status === 400 && fechaMala.data?.campo === "fecha_programada" && de().length === n0, `${sinFecha.status} ${fechaMala.status} ${fechaMala.data?.message}`);
  const sinRealizado = await api("POST", "/inventory/mantenimientos", mant(E, { estado: "completado", fecha_programada: enDias(-2) }), t.carmen);
  const realizadoFuturo = await api("POST", "/inventory/mantenimientos", mant(E, { estado: "completado", fecha_programada: enDias(-2), fecha_realizado: enDias(2) }), t.carmen);
  const realizadoMalo = await api("POST", "/inventory/mantenimientos", mant(E, { estado: "completado", fecha_programada: enDias(-2), fecha_realizado: "ayer" }), t.carmen);
  check("[cob:I:2.6-completado-fecha_realizado] completado sin fecha de realización → 400 «Indica la fecha en que se realizó para marcarlo como completado»; futura o inválida → 400 campo fecha_realizado", sinRealizado.status === 400 && sinRealizado.data?.message === "Indica la fecha en que se realizó para marcarlo como completado" && realizadoFuturo.status === 400 && realizadoFuturo.data?.campo === "fecha_realizado" && realizadoMalo.status === 400 && realizadoMalo.data?.campo === "fecha_realizado" && de().length === n0, `${sinRealizado.status} ${realizadoFuturo.status} ${realizadoFuturo.data?.message} ${realizadoMalo.status}`);

  // Supervisión (Estudiante: equipos C/E supervisado).
  const diegoCompleta = await api("POST", "/inventory/mantenimientos", mant(E, { estado: "completado", fecha_programada: enDias(-1), fecha_realizado: hoy() }), t.diego);
  check("[cob:I:2.6-bajo-supervisión] lo que captura el Estudiante (bajo supervisión) no nace completado → 409 supervision_pendiente y no se crea", diegoCompleta.status === 409 && diegoCompleta.data?.codigo === "supervision_pendiente" && de().length === n0, `${diegoCompleta.status} ${diegoCompleta.data?.codigo} ${diegoCompleta.data?.message}`);
  const diegoProg = await api("POST", "/inventory/mantenimientos", mant(E, { fecha_programada: enDias(-1), observaciones: "Capturado por el estudiante" }), t.diego);
  const Md = diegoProg.data?.id;
  const completaPend = await api("PUT", `/inventory/mantenimientos/${Md}`, mant(E, { estado: "completado", fecha_programada: enDias(-1), fecha_realizado: hoy() }), t.carmen);
  check("[cob:I:2.6-supervisión-pendiente] [cob:I:4-PUT-inventory-mantenimientos] uno capturado por el Estudiante queda pendiente de visto bueno y nadie lo completa mientras tanto → 409 supervision_pendiente", diegoProg.status === 201 && Number(mantenimiento(Md)?.requiere_supervision) === 1 && mantenimiento(Md)?.supervision_estado === "pendiente" && completaPend.status === 409 && completaPend.data?.codigo === "supervision_pendiente" && mantenimiento(Md)?.estado !== "completado", `${diegoProg.status} ${completaPend.status} ${completaPend.data?.codigo} ${mantenimiento(Md)?.estado}`);
  const visto = await api("POST", `/supervision/mantenimientos/${Md}/visto-bueno`, { observaciones: "Revisado en la prueba de cobertura" }, t.ricardo);
  const completaVisto = await api("PUT", `/inventory/mantenimientos/${Md}`, mant(E, { estado: "completado", fecha_programada: enDias(-1), fecha_realizado: hoy() }), t.carmen);
  check("[cob:I:2.6-supervisión-pendiente] …con el visto bueno del supervisor ya se completa (200)", visto.status === 200 && completaVisto.status === 200 && mantenimiento(Md)?.estado === "completado", `${visto.status} ${visto.data?.message} ${completaVisto.status} ${completaVisto.data?.message}`);

  // Tipo y estado: catálogo y valores por omisión.
  const omision = await api("POST", "/inventory/mantenimientos", { id_equipo: E, fecha_programada: "2027-08-01" }, t.carmen);
  const tipoRaro = await api("POST", "/inventory/mantenimientos", mant(E, { tipo: "verificacion" }), t.carmen);
  const estados = {};
  for (const estado of ["vencido", "cancelado", "pausado"]) estados[estado] = await api("POST", "/inventory/mantenimientos", mant(E, { estado }), t.carmen);
  check("[cob:I:2.6-tipo-estado] sin tipo ni estado: preventivo y programado; un tipo fuera del catálogo → 400 campo tipo; «vencido», «cancelado» u otro estado → 400 campo estado", omision.status === 201 && mantenimiento(omision.data?.id)?.tipo === "preventivo" && mantenimiento(omision.data?.id)?.estado === "programado" && tipoRaro.status === 400 && tipoRaro.data?.campo === "tipo" && Object.values(estados).every((r) => r.status === 400 && r.data?.campo === "estado") && /Cancelar mantenimiento/.test(estados.cancelado.data?.message || ""), `${omision.status} ${tipoRaro.status} ${Object.entries(estados).map(([k, r]) => `${k}=${r.status}`)}`);
  const nuevos = {};
  for (const estado of ["programado", "en_proceso"]) nuevos[estado] = await api("POST", "/inventory/mantenimientos", mant(E, { estado, fecha_programada: "2027-09-01" }), t.carmen);
  nuevos.completado = await api("POST", "/inventory/mantenimientos", mant(E, { estado: "completado", fecha_programada: enDias(-1), fecha_realizado: hoy() }), t.carmen);
  check("[cob:I:3.4-nuevo-programado] un mantenimiento nuevo nace programado, en proceso o completado (201 con equipos:C de mantenimiento); vencido o cancelado no (ver arriba)", Object.entries(nuevos).every(([estado, r]) => r.status === 201 && mantenimiento(r.data?.id)?.estado === estado), Object.entries(nuevos).map(([k, r]) => `${k}=${r.status}`).join(" "));

  // Próxima calibración: solo con una calibración completada, con fecha válida.
  const Ec = await nuevoEquipo({ fecha_prox_calibracion: "2027-01-01" });
  await api("POST", "/inventory/mantenimientos", { ...mant(Ec, { estado: "completado", fecha_programada: enDias(-1), fecha_realizado: hoy() }), proxima_calibracion: "2028-01-01" }, t.carmen);
  const trasPreventivo = equipo(Ec)?.fecha_prox_calibracion;
  await api("POST", "/inventory/mantenimientos", { ...mant(Ec, { tipo: "calibracion", fecha_programada: "2027-04-01" }), proxima_calibracion: "2028-02-01" }, t.carmen);
  const trasProgramada = equipo(Ec)?.fecha_prox_calibracion;
  const proxMala = await api("POST", "/inventory/mantenimientos", { ...mant(Ec, { tipo: "calibracion", estado: "completado", fecha_programada: enDias(-1), fecha_realizado: hoy() }), proxima_calibracion: "15/10/2028" }, t.carmen);
  const proxOk = await api("POST", "/inventory/mantenimientos", { ...mant(Ec, { tipo: "calibracion", estado: "completado", fecha_programada: enDias(-1), fecha_realizado: hoy() }), proxima_calibracion: "2028-03-01" }, t.carmen);
  check("[cob:I:2.6-proxima_calibracion] la próxima calibración solo se anota al completar una calibración (no con un preventivo ni con una calibración programada); con fecha inválida → 400 campo proxima_calibracion", trasPreventivo === "2027-01-01" && trasProgramada === "2027-01-01" && proxMala.status === 400 && proxMala.data?.campo === "proxima_calibracion" && proxOk.status === 201 && equipo(Ec)?.fecha_prox_calibracion === "2028-03-01", `${trasPreventivo} ${trasProgramada} ${proxMala.status} ${proxMala.data?.message} ${proxOk.status} ${equipo(Ec)?.fecha_prox_calibracion}`);
  const tecnico = await api("POST", "/inventory/mantenimientos", mant(E, { tecnico_proveedor: "T".repeat(200) }), t.carmen);
  check("[cob:I:2.6-técnico] técnico o proveedor de más de 150 caracteres se recorta a 150", tecnico.status === 201 && mantenimiento(tecnico.data?.id)?.tecnico_proveedor === "T".repeat(150), `${tecnico.status} ${String(mantenimiento(tecnico.data?.id)?.tecnico_proveedor || "").length}`);

  // Programado → vencido (sistema).
  const Mv = (await api("POST", "/inventory/mantenimientos", mant(E, { fecha_programada: enDias(-5) }), t.carmen)).data?.id;
  const listaSin = await api("GET", "/inventory/mantenimientos", undefined, tSin);
  const lista = await api("GET", `/inventory/mantenimientos?search=${encodeURIComponent(equipo(E).nombre)}`, undefined, t.jorge);
  const eventos = () => filas("SELECT usuario_id FROM auditoria WHERE entidad = 'mantenimientos' AND entidad_id = ? AND accion = 'vencer_mantenimiento'", String(Mv));
  check("[cob:I:3.4-programado-vencido] [cob:I:4-GET-inventory-mantenimientos] programado con fecha pasada → «vencido» al listar (GET con equipos:V; sin equipos:V → 403), con «vencer_mantenimiento» del sistema (sin usuario) en la bitácora", listaSin.status === 403 && lista.status === 200 && (lista.data?.items || []).find((m) => Number(m.id) === Mv)?.estado === "vencido" && mantenimiento(Mv)?.estado === "vencido" && eventos().length === 1 && eventos()[0].usuario_id === null, `${listaSin.status} ${lista.status} ${mantenimiento(Mv)?.estado} ${JSON.stringify(eventos())}`);
  await api("GET", "/inventory/mantenimientos", undefined, t.carmen);
  const porTipo = await api("GET", `/inventory/mantenimientos?tipo=calibracion&search=${encodeURIComponent(equipo(E).nombre)}`, undefined, t.hector);
  check("[cob:I:3.4-programado-vencido] [cob:I:4-GET-inventory-mantenimientos] idempotente (otra consulta no duplica el evento); ?tipo= filtra en el servidor", eventos().length === 1 && porTipo.status === 200 && (porTipo.data?.items || []).every((m) => m.tipo === "calibracion"), `${eventos().length} ${porTipo.status}`);

  // Cualquiera → cualquiera ya no: completado no se reabre, cancelado no se edita, cancelar no es por PUT.
  const Mc = nuevos.completado.data?.id;
  const reabre = await api("PUT", `/inventory/mantenimientos/${Mc}`, mant(E, { estado: "programado", fecha_programada: enDias(-1) }), t.carmen);
  const Mp = nuevos.programado.data?.id;
  const cancelaPut = await api("PUT", `/inventory/mantenimientos/${Mp}`, mant(E, { estado: "cancelado", fecha_programada: "2027-09-01" }), t.carmen);
  const enProceso = await api("PUT", `/inventory/mantenimientos/${Mp}`, mant(E, { estado: "en_proceso", fecha_programada: "2027-09-01" }), t.carmen);
  check("[cob:I:3.4-cualquiera-cualquiera] por PUT: completado → programado → 409 completado; → cancelado → 400 (se cancela con motivo y contraseña); programado → en proceso sí (200)", reabre.status === 409 && reabre.data?.codigo === "completado" && mantenimiento(Mc)?.estado === "completado" && cancelaPut.status === 400 && cancelaPut.data?.campo === "estado" && enProceso.status === 200 && mantenimiento(Mp)?.estado === "en_proceso", `${reabre.status} ${reabre.data?.codigo} ${cancelaPut.status} ${enProceso.status}`);

  // Cancelar (DELETE): permiso, motivo, contraseña, nota en observaciones, inexistente y ya cancelado.
  const Mx = (await api("POST", "/inventory/mantenimientos", mant(E, { fecha_programada: "2027-10-01", observaciones: "Revisión anual" }), t.carmen)).data?.id;
  const delCarmen = await api("DELETE", `/inventory/mantenimientos/${Mx}`, { motivo: "Sin permiso de anular" }, t.carmen);
  const delLuis = await api("DELETE", `/inventory/mantenimientos/${Mx}`, { motivo: "Sin permiso de anular" }, t.luis);
  const delCorto = await api("DELETE", `/inventory/mantenimientos/${Mx}`, { motivo: "no" }, t.patricia);
  check("[cob:I:2.6-cancelar-motivo] [cob:I:4-DELETE-inventory-mantenimientos] cancelar sin equipos:AN (Adm. Auxiliar, Analista) → 403; motivo de menos de 5 → 400 «Indica el motivo de la cancelación (al menos 5 caracteres)»", delCarmen.status === 403 && delLuis.status === 403 && delCorto.status === 400 && delCorto.data?.message === "Indica el motivo de la cancelación (al menos 5 caracteres)" && mantenimiento(Mx)?.estado === "programado", `${delCarmen.status} ${delLuis.status} ${delCorto.status} ${delCorto.data?.message}`);
  const delSinReauth = await api("DELETE", `/inventory/mantenimientos/${Mx}`, { motivo: "El proveedor canceló" }, t.patricia, SIN_REAUTH);
  check("[cob:I:2.6-cancelar-reauth] cancelar sin contraseña → 401 reauth_required equipos:AN y sigue programado", delSinReauth.status === 401 && delSinReauth.data?.accion === "equipos:AN" && mantenimiento(Mx)?.estado === "programado", `${delSinReauth.status} ${delSinReauth.data?.accion}`);
  const cancela = await api("DELETE", `/inventory/mantenimientos/${Mx}`, { motivo: "El proveedor canceló" }, t.patricia);
  const evAnular = fila("SELECT motivo FROM auditoria WHERE entidad = 'mantenimientos' AND entidad_id = ? AND accion = 'anular'", String(Mx));
  check("[cob:I:3.4-cancelado-observaciones] [cob:I:4-DELETE-inventory-mantenimientos] con equipos:AN y contraseña: cancelado, observaciones + «[Cancelado: motivo]» y bitácora «anular» con el motivo", cancela.status === 200 && mantenimiento(Mx)?.estado === "cancelado" && mantenimiento(Mx)?.observaciones === "Revisión anual\n[Cancelado: El proveedor canceló]" && evAnular?.motivo === "El proveedor canceló", `${cancela.status} ${JSON.stringify(mantenimiento(Mx)?.observaciones)} ${evAnular?.motivo}`);
  const otraVez = await api("DELETE", `/inventory/mantenimientos/${Mx}`, { motivo: "Cancelar otra vez" }, t.patricia);
  const noExiste = await api("DELETE", "/inventory/mantenimientos/99999986", { motivo: "No existe este" }, t.patricia);
  const editaCancelado = await api("PUT", `/inventory/mantenimientos/${Mx}`, mant(E, { fecha_programada: "2027-10-01" }), t.carmen);
  check("[cob:I:2.6-cancelar-cancelado-existe] cancelar uno ya cancelado o inexistente → 404 «Mantenimiento no encontrado»; lo cancelado ya no se edita (409 cancelado)", otraVez.status === 404 && otraVez.data?.message === "Mantenimiento no encontrado" && noExiste.status === 404 && noExiste.data?.message === "Mantenimiento no encontrado" && editaCancelado.status === 409 && editaCancelado.data?.codigo === "cancelado", `${otraVez.status} ${noExiste.status} ${editaCancelado.status} ${editaCancelado.data?.codigo}`);
  const cancelaCompletado = await api("DELETE", `/inventory/mantenimientos/${Mc}`, { motivo: "Reescribir el historial" }, t.patricia);
  check("[cob:I:3.4-cancelado-observaciones] un completado no se cancela → 409 completado (es historia del equipo)", cancelaCompletado.status === 409 && cancelaCompletado.data?.codigo === "completado" && mantenimiento(Mc)?.estado === "completado", `${cancelaCompletado.status} ${cancelaCompletado.data?.codigo}`);
  // Deja el equipo sin pendientes.
  for (const m of de().filter((x) => ["programado", "en_proceso", "vencido"].includes(x.estado))) await api("DELETE", `/inventory/mantenimientos/${m.id}`, { motivo: "Prueba de cobertura: terminada" }, t.qa);
}

/* ---------- 3.1 Alta: nace activo (supervisado: pendiente de visto bueno) ---------- */
{
  const R = await nuevoReactivo({}, t.gabriela);
  const C = await nuevoConsumible({}, t.carmen);
  const E = await nuevoEquipo();
  const sinSupervision = (tabla, idItem) => {
    const r = fila(`SELECT activo, requiere_supervision FROM ${tabla} WHERE id = ?`, idItem);
    return !!r && Number(r.activo ?? 1) === 1 && !Number(r.requiere_supervision || 0);
  };
  check("[cob:I:3.1-nuevo-activo] reactivo (Coord. Investigación), consumible (Adm. Auxiliar) y equipo nacen activos y sin supervisión", sinSupervision("reactivos", R) && sinSupervision("consumibles", C) && sinSupervision("equipos", E), `${R} ${C} ${E}`);
  const Rd = await nuevoReactivo({}, t.diego);
  const rd = reactivo(Rd);
  check("[cob:I:3.1-nuevo-activo] [cob:I:4-POST-inventory-reactivos] el Estudiante (supervisado) da de alta un reactivo: nace activo pero queda pendiente del visto bueno de su supervisor", !!Rd && Number(rd?.activo ?? 1) === 1 && Number(rd?.requiere_supervision) === 1 && rd?.supervision_estado === "pendiente" && Number(rd?.supervisor_id) === id.ricardo, JSON.stringify(rd && { a: rd.activo, s: rd.supervision_estado, sup: rd.supervisor_id }));
  const vb = await api("POST", `/supervision/reactivos/${Rd}/visto-bueno`, { observaciones: "Revisado en la prueba de cobertura" }, t.ricardo);
  check("(limpieza) visto bueno del supervisor al reactivo del Estudiante", vb.status === 200 && reactivo(Rd)?.supervision_estado === "aprobado", `${vb.status} ${vb.data?.message}`);
}

/* ---------- 4. Permisos por endpoint (lo que faltaba) ---------- */
{
  const sello = unico();
  // GET /inventory/summary: nunca 403; recorta lo que la persona no puede ver.
  const resumen = async (tk) => (await api("GET", "/inventory/summary", undefined, tk));
  const [sSin, sJorge, sHector] = [await resumen(tSin), await resumen(t.jorge), await resumen(t.hector)];
  const numero = (v) => typeof v === "number" || (typeof v === "string" && v !== "" && !Number.isNaN(Number(v)));
  check("[cob:I:4-GET-inventory-summary] GET /inventory/summary: sin permisos → 200 con todo en null; solo equipos:V → equipos con número e inventario en null; con ambos → todo con número", sSin.status === 200 && ["total_reactivos", "total_consumibles", "reactivos_stock_bajo", "consumibles_stock_bajo", "total_equipos", "equipos_calibracion_pendiente"].every((k) => sSin.data?.[k] === null) && sJorge.status === 200 && numero(sJorge.data?.total_equipos) && numero(sJorge.data?.equipos_calibracion_pendiente) && sJorge.data?.total_reactivos === null && sJorge.data?.consumibles_stock_bajo === null && sHector.status === 200 && ["total_reactivos", "total_consumibles", "reactivos_stock_bajo", "total_equipos"].every((k) => numero(sHector.data?.[k])), `${JSON.stringify(sSin.data)} | ${JSON.stringify(sJorge.data)}`);

  // Reactivos.
  const R = await nuevoReactivo({ cas: `CAS-${sello}`, lote: `LOTE-${sello}` });
  const Rb = await nuevoReactivo({ producto: `Reactivo baja ${sello}` });
  await api("DELETE", `/inventory/reactivos/${Rb}`, { motivo: "Prueba de cobertura: retirado" }, t.qa);
  const lr = (tk, q = "") => api("GET", `/inventory/reactivos${q}`, undefined, tk);
  const [lrSin, lrJorge, lrHector, lrCas, lrSinBajas, lrBajas] = [await lr(tSin), await lr(t.jorge), await lr(t.hector, `?search=CAS-${sello}`), await lr(t.hector, `?search=LOTE-${sello}`), await lr(t.hector, `?search=${encodeURIComponent(`Reactivo baja ${sello}`)}`), await lr(t.hector, `?search=${encodeURIComponent(`Reactivo baja ${sello}`)}&bajas=1`)];
  check("[cob:I:4-GET-inventory-reactivos] GET /inventory/reactivos: sin inventario:V (cuenta sin inventario, Administrador técnico) → 403; el Auditor busca por CAS o lote en el servidor; las bajas solo con ?bajas=1", lrSin.status === 403 && lrJorge.status === 403 && lrHector.status === 200 && (lrHector.data?.items || []).map((x) => Number(x.id)).join() === String(R) && (lrCas.data?.items || []).map((x) => Number(x.id)).join() === String(R) && (lrSinBajas.data?.items || []).length === 0 && (lrBajas.data?.items || []).map((x) => Number(x.id)).join() === String(Rb), `${lrSin.status} ${lrJorge.status} ${lrHector.status} ${(lrHector.data?.items || []).length} ${(lrBajas.data?.items || []).length}`);
  const [grJorge, grHector, gr404] = [await api("GET", `/inventory/reactivos/${R}`, undefined, t.jorge), await api("GET", `/inventory/reactivos/${R}`, undefined, t.hector), await api("GET", "/inventory/reactivos/99999985", undefined, t.hector)];
  check("[cob:I:4-GET-inventory-reactivos-id] GET /inventory/reactivos/:id: sin inventario:V → 403; el Auditor lo lee; inexistente → 404", grJorge.status === 403 && grHector.status === 200 && Number(grHector.data?.item?.id) === R && gr404.status === 404, `${grJorge.status} ${grHector.status} ${gr404.status}`);
  const nombresAlta = {};
  const altaR = async (tk, quien) => {
    nombresAlta[quien] = `Reactivo permisos ${quien} ${sello}`;
    return api("POST", "/inventory/reactivos", { tipo_reactivo: "acidos", producto: nombresAlta[quien], capacidad: 1, unidad_capacidad: "L", piezas: 1 }, tk);
  };
  const altas = { hector: await altaR(t.hector, "hector"), patricia: await altaR(t.patricia, "patricia"), luis: await altaR(t.luis, "luis"), jorge: await altaR(t.jorge, "jorge"), gabriela: await altaR(t.gabriela, "gabriela"), carmen: await altaR(t.carmen, "carmen") };
  const creado = (quien) => !!fila("SELECT id FROM reactivos WHERE producto = ?", nombresAlta[quien]);
  check("[cob:I:4-POST-inventory-reactivos] POST /inventory/reactivos: Auditor, Responsable General (V/AN), Analista (C solo de movimientos) y Administrador técnico → 403 sin crear; Coord. Investigación y Adm. Auxiliar (catálogo) → 201", ["hector", "patricia", "luis", "jorge"].every((q) => altas[q].status === 403 && !creado(q)) && ["gabriela", "carmen"].every((q) => altas[q].status === 201 && creado(q)), Object.entries(altas).map(([k, r]) => `${k}=${r.status}`).join(" "));
  const cuerpoR = { tipo_reactivo: "alcoholes_solventes", producto: `Reactivo editado ${sello}`, capacidad: 1, unidad_capacidad: "L", piezas: 1 };
  const puts = { hector: await api("PUT", `/inventory/reactivos/${R}`, cuerpoR, t.hector), patricia: await api("PUT", `/inventory/reactivos/${R}`, cuerpoR, t.patricia), luis: await api("PUT", `/inventory/reactivos/${R}`, cuerpoR, t.luis) };
  const sinCambio = reactivo(R)?.producto !== cuerpoR.producto;
  const putGab = await api("PUT", `/inventory/reactivos/${R}`, cuerpoR, t.gabriela);
  const put404 = await api("PUT", "/inventory/reactivos/99999985", cuerpoR, t.gabriela);
  check("[cob:I:4-PUT-inventory-reactivos] PUT /inventory/reactivos/:id: Auditor, Responsable General y Analista → 403 sin cambios; Coord. Investigación (inventario:E) → 200; inexistente → 404", Object.values(puts).every((r) => r.status === 403) && sinCambio && putGab.status === 200 && reactivo(R)?.producto === cuerpoR.producto && put404.status === 404, `${Object.entries(puts).map(([k, r]) => `${k}=${r.status}`)} ${putGab.status} ${put404.status}`);
  const n = movimientosDe("reactivos", R).length;
  const refills = { hector: await api("POST", `/inventory/reactivos/${R}/refill`, { tipo: "entrada", cantidad: 1 }, t.hector), patricia: await api("POST", `/inventory/reactivos/${R}/refill`, { tipo: "entrada", cantidad: 1 }, t.patricia), jorge: await api("POST", `/inventory/reactivos/${R}/refill`, { tipo: "entrada", cantidad: 1 }, t.jorge) };
  const refillLuis = await api("POST", `/inventory/reactivos/${R}/refill`, { tipo: "entrada", cantidad: 1 }, t.luis);
  const refillBaja = await api("POST", `/inventory/reactivos/${Rb}/refill`, { tipo: "entrada", cantidad: 1 }, t.luis);
  check("[cob:I:4-POST-reactivos-refill] POST /inventory/reactivos/:id/refill: sin inventario:C de movimientos (Auditor, Responsable General, Administrador técnico) → 403; el Analista registra (200); sobre uno dado de baja → 409 dado_de_baja", Object.values(refills).every((r) => r.status === 403) && refillLuis.status === 200 && movimientosDe("reactivos", R).length === n + 1 && refillBaja.status === 409 && refillBaja.data?.codigo === "dado_de_baja", `${Object.entries(refills).map(([k, r]) => `${k}=${r.status}`)} ${refillLuis.status} ${refillBaja.status}`);

  // Consumibles.
  const C = await nuevoConsumible({ lote: `LC-${sello}`, localizacion: `Gaveta ${sello}` });
  const lc = (tk, q = "") => api("GET", `/consumables${q}`, undefined, tk);
  const [lcSin, lcJorge, lcLote, lcLoc] = [await lc(tSin), await lc(t.jorge), await lc(t.hector, `?search=LC-${sello}`), await lc(t.hector, `?search=${encodeURIComponent(`Gaveta ${sello}`)}`)];
  check("[cob:I:4-GET-consumables] GET /consumables: sin inventario:V → 403; el Auditor busca en el servidor por lote o localización", lcSin.status === 403 && lcJorge.status === 403 && lcLote.status === 200 && (lcLote.data?.items || []).map((x) => Number(x.id)).join() === String(C) && (lcLoc.data?.items || []).map((x) => Number(x.id)).join() === String(C), `${lcSin.status} ${lcJorge.status} ${lcLote.status} ${(lcLote.data?.items || []).length}`);
  const [gcJorge, gcHector] = [await api("GET", `/consumables/${C}`, undefined, t.jorge), await api("GET", `/consumables/${C}`, undefined, t.hector)];
  check("[cob:I:4-GET-consumables-id] GET /consumables/:id: sin inventario:V → 403; el Auditor lo lee (inexistente → 404, ver 2.2)", gcJorge.status === 403 && gcHector.status === 200 && Number(gcHector.data?.item?.id) === C, `${gcJorge.status} ${gcHector.status}`);
  const altaC = async (tk, quien) => {
    const producto = `Consumible permisos ${quien} ${sello}`;
    const r = await api("POST", "/consumables", { producto, piezas: 1 }, tk);
    return { status: r.status, creado: !!fila("SELECT id FROM consumibles WHERE producto = ?", producto) };
  };
  const altasC = { hector: await altaC(t.hector, "hector"), patricia: await altaC(t.patricia, "patricia"), luis: await altaC(t.luis, "luis"), jorge: await altaC(t.jorge, "jorge"), gabriela: await altaC(t.gabriela, "gabriela") };
  check("[cob:I:4-POST-consumables] POST /consumables: Auditor, Responsable General, Analista y Administrador técnico → 403 sin crear; Coord. Investigación → 201", ["hector", "patricia", "luis", "jorge"].every((q) => altasC[q].status === 403 && !altasC[q].creado) && altasC.gabriela.status === 201 && altasC.gabriela.creado, Object.entries(altasC).map(([k, r]) => `${k}=${r.status}`).join(" "));
  const nC = movimientosDe("consumibles", C).length;
  const refC = { hector: await api("POST", `/consumables/${C}/refill`, { tipo: "entrada", cantidad: 1 }, t.hector), patricia: await api("POST", `/consumables/${C}/refill`, { tipo: "entrada", cantidad: 1 }, t.patricia) };
  const refCLuis = await api("POST", `/consumables/${C}/refill`, { tipo: "consumo", cantidad: 2 }, t.luis);
  const refC404 = await api("POST", "/consumables/99999984/refill", { tipo: "entrada", cantidad: 1 }, t.luis);
  check("[cob:I:4-POST-consumables-refill] POST /consumables/:id/refill: Auditor y Responsable General → 403; el Analista registra el consumo (10 → 8); inexistente → 404", Object.values(refC).every((r) => r.status === 403) && refCLuis.status === 200 && Number(consumible(C).existencia) === 8 && movimientosDe("consumibles", C).length === nC + 1 && refC404.status === 404, `${Object.entries(refC).map(([k, r]) => `${k}=${r.status}`)} ${refCLuis.status} ${consumible(C)?.existencia} ${refC404.status}`);

  // Movimientos.
  const motivoUnico = `Motivo único ${sello}`;
  await api("POST", `/inventory/reactivos/${R}/refill`, { tipo: "salida", cantidad: 0.5, motivo: motivoUnico }, t.luis);
  const lm = (tk, q = "") => api("GET", `/inventory/movimientos${q}`, undefined, tk);
  const [lmSin, lmJorge, lmHector, lmItem, lmTipo, lmBuscar] = [await lm(tSin), await lm(t.jorge), await lm(t.hector, "?limite=5"), await lm(t.hector, `?tabla=reactivos&id=${R}`), await lm(t.hector, `?tabla=reactivos&id=${R}&tipo=salida`), await lm(t.hector, `?buscar=${encodeURIComponent(motivoUnico)}`)];
  const delItem = movimientosDe("reactivos", R);
  check("[cob:I:4-GET-inventory-movimientos] GET /inventory/movimientos: sin inventario:V → 403; el Auditor lista con resumen y filtra en el servidor por insumo, tipo y texto", lmSin.status === 403 && lmJorge.status === 403 && lmHector.status === 200 && (lmHector.data?.items || []).length <= 5 && ["total", "hoy", "semana", "mes"].every((k) => typeof lmHector.data?.summary?.[k] === "number") && (lmItem.data?.items || []).length === delItem.length && (lmItem.data?.items || []).every((m) => m.tabla_origen === "reactivos" && Number(m.id_item) === R) && (lmTipo.data?.items || []).length === delItem.filter((m) => m.tipo === "salida").length && (lmBuscar.data?.items || []).length === 1 && lmBuscar.data.items[0].motivo === motivoUnico, `${lmSin.status} ${lmJorge.status} ${lmHector.status} ${(lmItem.data?.items || []).length}/${delItem.length} ${(lmTipo.data?.items || []).length} ${(lmBuscar.data?.items || []).length}`);

  // Equipos.
  const serie = `SER-${sello}`;
  const E = await nuevoEquipo({ numero_serie: serie, ubicacion: `Sala ${sello}` });
  const le = (tk, q = "") => api("GET", `/inventory/equipos${q}`, undefined, tk);
  const [leSin, leSerie, leUbic] = [await le(tSin), await le(t.jorge, `?search=${serie}`), await le(t.jorge, `?search=${encodeURIComponent(`Sala ${sello}`)}`)];
  check("[cob:I:4-GET-inventory-equipos] GET /inventory/equipos: sin equipos:V → 403; con solo equipos:V (Administrador técnico) busca por serie o ubicación en el servidor", leSin.status === 403 && leSerie.status === 200 && (leSerie.data?.items || []).map((x) => Number(x.id)).join() === String(E) && (leUbic.data?.items || []).map((x) => Number(x.id)).join() === String(E), `${leSin.status} ${leSerie.status} ${(leSerie.data?.items || []).length}`);
  const [geSin, geJorge, ge404] = [await api("GET", `/inventory/equipos/${E}`, undefined, tSin), await api("GET", `/inventory/equipos/${E}`, undefined, t.jorge), await api("GET", "/inventory/equipos/99999983", undefined, t.jorge)];
  check("[cob:I:4-GET-inventory-equipos-id] GET /inventory/equipos/:id: sin equipos:V → 403; el Administrador técnico lo lee; inexistente → 404 «Equipo no encontrado»", geSin.status === 403 && geJorge.status === 200 && Number(geJorge.data?.item?.id) === E && ge404.status === 404 && ge404.data?.message === "Equipo no encontrado", `${geSin.status} ${geJorge.status} ${ge404.status}`);
  const altaE = async (tk, quien) => {
    const nombre = `Equipo permisos ${quien} ${sello}`;
    const r = await api("POST", "/inventory/equipos", { nombre }, tk);
    return { status: r.status, creado: !!fila("SELECT id FROM equipos WHERE nombre = ?", nombre) };
  };
  const altasE = { hector: await altaE(t.hector, "hector"), jorge: await altaE(t.jorge, "jorge"), patricia: await altaE(t.patricia, "patricia"), carmen: await altaE(t.carmen, "carmen"), luis: await altaE(t.luis, "luis"), gabriela: await altaE(t.gabriela, "gabriela") };
  check("[cob:I:4-POST-inventory-equipos] POST /inventory/equipos: Auditor, Administrador técnico, Responsable General, Adm. Auxiliar (solo mantenimiento) y Analista (solo uso) → 403 sin crear; Coord. Investigación → 201", ["hector", "jorge", "patricia", "carmen", "luis"].every((q) => altasE[q].status === 403 && !altasE[q].creado) && altasE.gabriela.status === 201 && altasE.gabriela.creado, Object.entries(altasE).map(([k, r]) => `${k}=${r.status}`).join(" "));
  const cuerpoE = { nombre: `Equipo editado ${sello}`, estado: "operativo", numero_serie: serie };
  const putsE = await Promise.all([t.hector, t.jorge, t.carmen, t.luis].map((tk) => api("PUT", `/inventory/equipos/${E}`, cuerpoE, tk)));
  const sinCambioE = equipo(E)?.nombre !== cuerpoE.nombre;
  const putEGab = await api("PUT", `/inventory/equipos/${E}`, cuerpoE, t.gabriela);
  const putE404 = await api("PUT", "/inventory/equipos/99999983", cuerpoE, t.gabriela);
  check("[cob:I:4-PUT-inventory-equipos] PUT /inventory/equipos/:id: Auditor, Administrador técnico, Adm. Auxiliar y Analista → 403 sin cambios; Coord. Investigación → 200; inexistente → 404", putsE.every((r) => r.status === 403) && sinCambioE && putEGab.status === 200 && equipo(E)?.nombre === cuerpoE.nombre && putE404.status === 404, `${putsE.map((r) => r.status)} ${putEGab.status} ${putE404.status}`);

  // Mantenimientos.
  const altaM = async (tk) => {
    const obs = `Permisos ${unico()}`;
    const r = await api("POST", "/inventory/mantenimientos", mant(E, { observaciones: obs }), tk);
    return { status: r.status, id: r.data?.id, creado: !!fila("SELECT id FROM mantenimientos WHERE observaciones = ?", obs) };
  };
  const altasM = { hector: await altaM(t.hector), jorge: await altaM(t.jorge), patricia: await altaM(t.patricia), luis: await altaM(t.luis), carmen: await altaM(t.carmen), gabriela: await altaM(t.gabriela) };
  check("[cob:I:4-POST-inventory-mantenimientos] POST /inventory/mantenimientos: Auditor, Administrador técnico, Responsable General y Analista (solo uso) → 403 sin crear; Adm. Auxiliar (mantenimiento) y Coord. Investigación → 201", ["hector", "jorge", "patricia", "luis"].every((q) => altasM[q].status === 403 && !altasM[q].creado) && ["carmen", "gabriela"].every((q) => altasM[q].status === 201 && altasM[q].creado), Object.entries(altasM).map(([k, r]) => `${k}=${r.status}`).join(" "));
  const M = altasM.carmen.id;
  const cuerpoM = mant(E, { tecnico_proveedor: `Proveedor ${sello}` });
  const putsM = await Promise.all([t.hector, t.luis, t.jorge].map((tk) => api("PUT", `/inventory/mantenimientos/${M}`, cuerpoM, tk)));
  const sinCambioM = mantenimiento(M)?.tecnico_proveedor !== cuerpoM.tecnico_proveedor;
  const putMCarmen = await api("PUT", `/inventory/mantenimientos/${M}`, cuerpoM, t.carmen);
  const putM404 = await api("PUT", "/inventory/mantenimientos/99999982", cuerpoM, t.carmen);
  check("[cob:I:4-PUT-inventory-mantenimientos] PUT /inventory/mantenimientos/:id: Auditor, Analista y Administrador técnico → 403 sin cambios; Adm. Auxiliar → 200; inexistente → 404 «Mantenimiento no encontrado»", putsM.every((r) => r.status === 403) && sinCambioM && putMCarmen.status === 200 && mantenimiento(M)?.tecnico_proveedor === cuerpoM.tecnico_proveedor && putM404.status === 404 && putM404.data?.message === "Mantenimiento no encontrado", `${putsM.map((r) => r.status)} ${putMCarmen.status} ${putM404.status}`);
  const bajaE = await api("DELETE", `/inventory/equipos/${E}`, { motivo: "Prueba de cobertura: equipo retirado" }, t.patricia);
  check("[cob:I:4-DELETE-inventory-equipos] dar de baja el equipo cancela sus mantenimientos pendientes con el motivo de la baja", bajaE.status === 200 && Number(bajaE.data?.mantenimientos_cancelados) === 2 && [altasM.carmen.id, altasM.gabriela.id].every((m) => mantenimiento(m)?.estado === "cancelado" && /\[Cancelado por la baja del equipo: Prueba de cobertura: equipo retirado\]/.test(mantenimiento(m)?.observaciones || "")), `${bajaE.status} ${bajaE.data?.message}`);
}

/* ---------- 4. Avisos de Inicio y campana (parte de inventario) ---------- */
{
  const R0 = await nuevoReactivo({ producto: `Reactivo agotado avisos ${unico()}` });
  await api("POST", `/inventory/reactivos/${R0}/refill`, { tipo: "consumo", cantidad: 1, motivo: "Se acabó" }, t.ricardo);
  const Rcad = await nuevoReactivo({ producto: `Reactivo caducado avisos ${unico()}`, piezas: 10, caducidad: enDias(-2) });
  const C0 = await nuevoConsumible({ producto: `Consumible bajo avisos ${unico()}`, piezas: 1, cantidad_por_pieza: 3 });
  const Ecal = await nuevoEquipo({ fecha_prox_calibracion: enDias(-3) });
  const Em = await nuevoEquipo();
  const Mv = (await api("POST", "/inventory/mantenimientos", mant(Em, { fecha_programada: enDias(-4) }), t.carmen)).data?.id;
  const Mp = (await api("POST", "/inventory/mantenimientos", mant(Em, { fecha_programada: enDias(6) }), t.carmen)).data?.id;
  await api("GET", "/inventory/mantenimientos", undefined, t.carmen);
  const hrefs = { reactivo: `/inventario/reactivos?abrir=${R0}`, caducado: `/inventario/reactivos?abrir=${Rcad}`, consumible: `/inventario/consumibles?abrir=${C0}`, calibracion: `/inventario/equipos?abrir=${Ecal}`, vencido: `/inventario/mantenimiento?filtro=vencido&abrir=${Mv}`, proximo: `/inventario/mantenimiento?filtro=proximo&abrir=${Mp}` };
  const notif = async (tk) => {
    const r = await api("GET", "/notificaciones", undefined, tk);
    const todas = [...(r.data?.items || []), ...(r.data?.anteriores || [])];
    return { status: r.status, de: (href) => todas.find((n) => n.href === href) };
  };
  const [nRicardo, nCarmen, nLuis] = [await notif(t.ricardo), await notif(t.carmen), await notif(t.luis)];
  const frase = (n, h) => n.de(hrefs[h])?.frase;
  const esperado = { reactivo: "Reactivo agotado", caducado: "Reactivo caducado", consumible: "Pocas unidades", calibracion: "Calibración vencida", vencido: "Mantenimiento vencido", proximo: "Mantenimiento próximo" };
  check("[cob:I:4-GET-inicio-avisos] [cob:I:I-200] [cob:I:I-201] [cob:I:I-202] [cob:I:I-203] [cob:I:I-204] [cob:I:I-205] campana (GET /notificaciones): quien gestiona inventario y equipos (Coord. Área Técnica; Adm. Auxiliar con inventario administrativo y equipos de mantenimiento) recibe reactivo agotado, caducado, consumible bajo, calibración vencida y mantenimiento vencido/próximo", nRicardo.status === 200 && Object.entries(esperado).every(([h, f]) => frase(nRicardo, h) === f && frase(nCarmen, h) === f), Object.keys(esperado).map((h) => `${h}=${frase(nRicardo, h)}/${frase(nCarmen, h)}`).join(" "));
  check("[cob:I:4-GET-inicio-avisos] …quien solo usa inventario y equipos (Analista: movimientos y uso) no recibe esos avisos", nLuis.status === 200 && Object.keys(hrefs).every((h) => !nLuis.de(hrefs[h])), Object.keys(hrefs).filter((h) => nLuis.de(hrefs[h])).join(" "));
  const grupos = async (tk) => Object.fromEntries(((await api("GET", "/inicio/avisos", undefined, tk)).data?.items || []).map((g) => [g.key, g]));
  const [gRicardo, gLuis] = [await grupos(t.ricardo), await grupos(t.luis)];
  const claves = ["reactivos_bajos", "reactivos_caducan", "consumibles_bajos", "equipos_cal", "mant_vencidos", "mant_proximos"];
  check("[cob:I:4-GET-inicio-avisos] [cob:I:I-200] [cob:I:I-201] [cob:I:I-202] [cob:I:I-203] [cob:I:I-204] GET /inicio/avisos: los grupos de inventario y equipos (con su liga a la lista filtrada) salen para la Coord. de Área Técnica y no para el Analista", claves.every((k) => gRicardo[k]?.count >= 1) && gRicardo.reactivos_bajos.href === "/inventario/reactivos?filtro=bajo" && gRicardo.mant_vencidos.href === "/inventario/mantenimiento?filtro=vencido" && claves.every((k) => !gLuis[k]), `${claves.map((k) => `${k}=${gRicardo[k]?.count ?? "-"}`).join(" ")} | luis: ${claves.filter((k) => gLuis[k]).join(" ")}`);
  check("[cob:I:3.3-calibración-vencida-visual] la calibración vencida es solo un aviso: el equipo operativo con la fecha pasada sigue «operativo» (el sistema no le cambia el estado) aunque se avise «Calibración vencida»", equipo(Ecal)?.estado === "operativo" && equipo(Ecal)?.fecha_prox_calibracion === enDias(-3) && frase(nRicardo, "calibracion") === "Calibración vencida", `${equipo(Ecal)?.estado} ${frase(nRicardo, "calibracion")}`);
  for (const m of [Mv, Mp]) await api("DELETE", `/inventory/mantenimientos/${m}`, { motivo: "Prueba de cobertura: terminada" }, t.qa);
}

terminar();
