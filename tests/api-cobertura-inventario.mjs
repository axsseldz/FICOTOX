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

/* ---------- 2.2 Consumible: validaciones ---------- */
{
  const sinProducto = await api("POST", "/consumables", { producto: "   ", piezas: 1 }, t.qa);
  check("[cob:I:2.2-producto] alta de consumible sin producto (solo espacios) → 400 «El campo 'producto' es obligatorio»", sinProducto.status === 400 && /producto' es obligatorio/.test(sinProducto.data?.message || ""), `${sinProducto.status} ${sinProducto.data?.message}`);
  for (const [campo, etiqueta] of [["piezas", "Piezas"], ["cantidad_por_pieza", "Cantidad por pieza"], ["stock_minimo", "Stock mínimo"]]) {
    const negativo = await api("POST", "/consumables", { producto: `Consumible negativo ${unico()}`, [campo]: -1 }, t.qa);
    const texto = await api("POST", "/consumables", { producto: `Consumible texto ${unico()}`, [campo]: "muchas" }, t.qa);
    check(`[cob:I:2.2-numeros] «${etiqueta}» negativo o no numérico → 400 «…debe ser un número mayor o igual a cero»`, negativo.status === 400 && texto.status === 400 && negativo.data?.message === `«${etiqueta}» debe ser un número mayor o igual a cero`, `${negativo.status} ${texto.status} ${negativo.data?.message}`);
  }

  // Fecha de ingreso: vacío y «s/f» quedan sin fecha; AAAA-MM-DD se guarda.
  const nombre = `Consumible cobertura ${unico()}`;
  const C = (await api("POST", "/consumables", { producto: nombre, piezas: 3, cantidad_por_pieza: 10, fecha_ingreso: "", stock_minimo: 0 }, t.qa)).data?.id;
  const Csf = (await api("POST", "/consumables", { producto: `Consumible s/f ${unico()}`, piezas: 1, fecha_ingreso: "S/F" }, t.qa)).data?.id;
  check("[cob:I:2.2-fecha] fecha de ingreso vacía o «S/F» se guarda sin fecha (NULL)", !!C && !!Csf && consumible(C).fecha_ingreso === null && consumible(Csf).fecha_ingreso === null, `${consumible(C)?.fecha_ingreso} ${consumible(Csf)?.fecha_ingreso}`);

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
  check("[cob:I:2.2-producto] [cob:I:2.2-numeros] [cob:I:2.2-fecha] editar sin producto, con mínimo negativo o fecha dd/mm/aaaa → 400 y la base no cambia", editaSinProducto.status === 400 && editaNegativo.status === 400 && editaFecha.status === 400 && consumible(C).producto === nombre && consumible(C).stock_minimo !== -3 && consumible(C).fecha_ingreso === null, `${editaSinProducto.status} ${editaNegativo.status} ${editaFecha.status} ${editaFecha.data?.message}`);
  // Un valor heredado (Excel) que no cambia se conserva al editar.
  ejecutar("UPDATE consumibles SET fecha_ingreso = 'mar-2024' WHERE id = ?", C);
  const conserva = await api("PUT", `/consumables/${C}`, { ...base, fecha_ingreso: "mar-2024", marca: "Marca nueva" }, t.qa);
  check("[cob:I:2.2-fecha] editar otro dato conserva una fecha de ingreso heredada que no cambia", conserva.status === 200 && consumible(C).fecha_ingreso === "mar-2024" && consumible(C).marca === "Marca nueva", `${conserva.status} ${conserva.data?.message}`);

  // Recortes silenciosos a la longitud de cada columna.
  const largo = (n) => "x".repeat(n);
  const limites = { id_interno: 120, marca: 120, proveedor: 180, catalogo_parte_cas: 180, lote: 120, tamano_capacidad: 120, contenedor: 120, localizacion: 180, observaciones: 4000 };
  const carga = Object.fromEntries(Object.entries(limites).map(([k, n]) => [k, largo(n + 50)]));
  const Clargo = await api("POST", "/consumables", { producto: `Consumible largo ${unico()}`, ...carga }, t.qa);
  const guardado = consumible(Clargo.data?.id) || {};
  const mal = Object.entries(limites).filter(([k, n]) => String(guardado[k] || "").length !== n);
  check("[cob:I:2.2-longitudes] textos largos se recortan en silencio (id 120, marca 120, proveedor 180, catálogo 180, lote 120, tamaño 120, contenedor 120, localización 180, observaciones 4000)", Clargo.status === 201 && mal.length === 0, `${Clargo.status} ${mal.map(([k]) => `${k}=${String(guardado[k] || "").length}`).join(" ")}`);
  const productoLargo = await api("POST", "/consumables", { producto: `Consumible ${largo(300)}` }, t.qa);
  check("[cob:I:2.2-producto] un producto muy largo no rompe el alta (201)", productoLargo.status === 201, `${productoLargo.status} ${productoLargo.data?.message}`);

  const noExiste = 99999990;
  const g404 = await api("GET", `/consumables/${noExiste}`, undefined, t.qa);
  const p404 = await api("PUT", `/consumables/${noExiste}`, { producto: "Fantasma" }, t.qa);
  const r404 = await api("POST", `/consumables/${noExiste}/refill`, { tipo: "entrada", cantidad: 1 }, t.ricardo);
  check("[cob:I:2.2-404] consumible inexistente: GET, PUT y movimiento → 404 «Consumible no encontrado»", [g404, p404, r404].every((r) => r.status === 404 && r.data?.message === "Consumible no encontrado") && !consumible(noExiste), `${g404.status} ${p404.status} ${r404.status} ${p404.data?.message}`);
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
  check(`[cob:I:2.7-tamano] un reporte de más de ${maxMb} MB → 413 archivo_grande`, pesado.status === 413 && pesado.data?.codigo === "archivo_grande" && reportes() === 0, `${pesado.status} ${pesado.data?.codigo} ${pesado.data?.message}`);

  const json = await api("POST", "/documents/maintenance-report", { id_mantenimiento: M }, t.carmen);
  check("[cob:I:2.7-multipart] cuerpo JSON en vez de multipart → 400 «Envía el archivo como multipart/form-data…»", json.status === 400 && /multipart\/form-data/.test(json.data?.message || ""), `${json.status} ${json.data?.message}`);
  const sinArchivo = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M }, null), t.carmen);
  check("[cob:I:2.7-archivo] multipart sin archivo → 400 «Adjunta el reporte en PDF»", sinArchivo.status === 400 && sinArchivo.data?.message === "Adjunta el reporte en PDF", `${sinArchivo.status} ${sinArchivo.data?.message}`);
  const sinMant = await api("POST", "/documents/maintenance-report", form({}), t.carmen);
  const mantTexto = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: "abc" }), t.carmen);
  check("[cob:I:2.7-id] sin id_mantenimiento o no numérico → 400 «Falta el mantenimiento vinculado»", [sinMant, mantTexto].every((r) => r.status === 400 && r.data?.message === "Falta el mantenimiento vinculado"), `${sinMant.status} ${mantTexto.status} ${sinMant.data?.message}`);
  const mant404 = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: 99999991 }), t.carmen);
  check("[cob:I:2.7-existe] mantenimiento inexistente → 404 «Mantenimiento no encontrado»", mant404.status === 404 && mant404.data?.message === "Mantenimiento no encontrado", `${mant404.status} ${mant404.data?.message}`);
  // (Matriz anterior: «cualquier estado, también cancelado»; ahora un cancelado → 409, lo cubre api-integral-inventario.)
  const fechaMala = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M, fecha_reporte: "01/05/2027" }), t.carmen);
  check("[cob:I:2.7-fecha] fecha_reporte que no es AAAA-MM-DD → 400 «La fecha del reporte no es válida»", fechaMala.status === 400 && fechaMala.data?.message === "La fecha del reporte no es válida" && reportes() === 0, `${fechaMala.status} ${fechaMala.data?.message}`);

  // Contenido: extensión, firma, contenido activo y vacío.
  const docx = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M }, pdf, "reporte.docx"), t.carmen);
  const firma = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M }, Buffer.from("Solo texto, no es PDF"), "texto.pdf"), t.carmen);
  const activo = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M }, Buffer.from("%PDF-1.4\n<script>alert(1)</script>\n%%EOF"), "activo.pdf"), t.carmen);
  const vacio = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M }, Buffer.alloc(0), "vacio.pdf"), t.carmen);
  check("[cob:I:2.7-contenido] .docx → 400 formato_no_permitido; sin firma %PDF- o con contenido activo → 400 contenido_no_valido; vacío → 400 archivo_vacio", docx.status === 400 && docx.data?.codigo === "formato_no_permitido" && firma.status === 400 && firma.data?.codigo === "contenido_no_valido" && activo.status === 400 && activo.data?.codigo === "contenido_no_valido" && vacio.status === 400 && ["archivo_vacio", "contenido_no_valido"].includes(vacio.data?.codigo) && reportes() === 0, `${docx.status}/${docx.data?.codigo} ${firma.status}/${firma.data?.codigo} ${activo.status}/${activo.data?.codigo} ${vacio.status}/${vacio.data?.codigo}`);

  const hoyRep = await api("POST", "/documents/maintenance-report", form({ id_mantenimiento: M }), t.carmen);
  const R1 = hoyRep.data?.id;
  check("[cob:I:2.7-fecha] sin fecha_reporte se guarda la de hoy", hoyRep.status === 201 && fila("SELECT fecha_reporte FROM reportes_mantenimiento WHERE id = ?", R1)?.fecha_reporte === hoy(), `${hoyRep.status} ${hoyRep.data?.message}`);

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
  check("[cob:I:3.3-a-mantenimiento] operativo → «mantenimiento» al programarle un mantenimiento", equipoEstado(E) === "mantenimiento", equipoEstado(E));
  const editaEquipo = await api("PUT", `/inventory/equipos/${E}`, { nombre: "Equipo cobertura en mantenimiento", estado: "operativo" }, t.qa);
  check("[cob:I:3.3-a-mantenimiento] …editar el equipo a «operativo» no contradice a Mantenimiento: sigue «mantenimiento»", editaEquipo.status === 200 && equipoEstado(E) === "mantenimiento", `${editaEquipo.status} ${equipoEstado(E)}`);
  await api("PUT", `/inventory/mantenimientos/${M}`, mant(E, { estado: "completado", fecha_realizado: hoy() }), t.carmen);
  check("[cob:I:3.3-a-operativo] mantenimiento → operativo cuando ya no quedan pendientes", equipoEstado(E) === "operativo", equipoEstado(E));
  const M2 = (await api("POST", "/inventory/mantenimientos", mant(E, { fecha_programada: "2027-09-01" }), t.carmen)).data?.id;
  await api("DELETE", `/inventory/mantenimientos/${M2}`, { motivo: "Prueba de cobertura: se canceló" }, t.qa);
  check("[cob:I:3.3-a-operativo] …también al cancelar el único pendiente", equipoEstado(E) === "operativo", equipoEstado(E));

  const Ecal = await nuevoEquipo({ estado: "calibracion_pendiente" });
  await api("POST", "/inventory/mantenimientos", mant(Ecal, { tipo: "preventivo", estado: "completado", fecha_programada: enDias(-2), fecha_realizado: hoy() }), t.carmen);
  check("[cob:I:3.3-calibracion] calibración pendiente: un preventivo completado no la levanta", equipoEstado(Ecal) === "calibracion_pendiente", equipoEstado(Ecal));
  const cal = await api("POST", "/inventory/mantenimientos", { ...mant(Ecal, { tipo: "calibracion", estado: "completado", fecha_programada: enDias(-1), fecha_realizado: hoy() }), proxima_calibracion: "2027-10-15" }, t.carmen);
  check("[cob:I:3.3-calibracion] calibracion_pendiente → operativo al completar una calibración, con la próxima fecha en la ficha", cal.status === 201 && equipoEstado(Ecal) === "operativo" && fila("SELECT fecha_prox_calibracion FROM equipos WHERE id = ?", Ecal)?.fecha_prox_calibracion === "2027-10-15", `${cal.status} ${equipoEstado(Ecal)} ${cal.data?.message}`);

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
  check("[cob:I:3.3-suspendido] suspendido: ponerlo operativo o en calibración pendiente → 409 suspendido (con la NC en el mensaje)", operativo.status === 409 && operativo.data?.codigo === "suspendido" && /NC \d{7}/.test(operativo.data?.message || "") && calPend.status === 409 && equipoEstado(Es) === "fuera_servicio", `${operativo.status} ${operativo.data?.codigo} ${operativo.data?.message}`);
  const fuera = await api("PUT", `/inventory/equipos/${Es}`, { nombre: "Equipo suspendido (editado)", estado: "fuera_servicio", ubicacion: "Cuarentena" }, t.qa);
  check("[cob:I:3.3-suspendido] …editarlo dejándolo «fuera de servicio» sí se acepta (200)", fuera.status === 200 && fila("SELECT ubicacion FROM equipos WHERE id = ?", Es)?.ubicacion === "Cuarentena", `${fuera.status} ${fuera.data?.message}`);
  if (suspId) await api("POST", `/calidad/suspensiones/${suspId}/reanudar`, { motivo: "Prueba de cobertura terminada" }, t.patricia);
}

/* ---------- 3.4 Mantenimiento: en proceso con fecha pasada y cambio de equipo ---------- */
{
  const E = await nuevoEquipo();
  const M = (await api("POST", "/inventory/mantenimientos", mant(E, { estado: "en_proceso", fecha_programada: "2000-01-03" }), t.carmen)).data?.id;
  const lista = (await api("GET", "/inventory/mantenimientos?search=Equipo%20cobertura", undefined, t.carmen)).data?.items || [];
  const enLista = lista.find((m) => Number(m.id) === M);
  const avisos = (await api("GET", "/notificaciones", undefined, t.qa)).data?.items || [];
  const aviso = avisos.find((n) => String(n.href || "").includes(`abrir=${M}`));
  check("[cob:I:3.4-en_proceso] en proceso con fecha pasada: el barrido no lo pasa a «vencido» en la base (sigue en_proceso)", fila("SELECT estado FROM mantenimientos WHERE id = ?", M)?.estado === "en_proceso" && enLista?.estado === "en_proceso", `${fila("SELECT estado FROM mantenimientos WHERE id = ?", M)?.estado} ${enLista?.estado}`);
  check("[cob:I:3.4-en_proceso] …pero Pendientes lo avisa como «Mantenimiento vencido»", !!aviso && /vencido/i.test(`${aviso.frase || aviso.titulo || ""} ${aviso.href}`), JSON.stringify(aviso || null).slice(0, 200));

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
  const sello = unico().toLowerCase();
  const rol = await api("POST", "/admin/roles", { nombre: `Solo muestras ${sello}`, motivo: "Rol de la prueba de cobertura", permisos: [{ modulo: "muestras", accion: "V", alcance: "total" }] }, t.jorge);
  const email = `solo.muestras.${sello}@ficotox.local`;
  const password = `Temporal-${sello}-2026`;
  const alta = await api("POST", "/admin/usuarios", { nombre: `Solo Muestras ${sello}`, email, activo: true, rol_id: rol.data?.id, departamento: "Laboratorio", password, motivo: "Alta de la prueba de cobertura" }, t.jorge);
  ejecutar("UPDATE usuarios SET debe_cambiar_password = 0 WHERE email = ?", email);
  const tSin = await login(email, password);
  check("(preparación) cuenta sin inventario ni equipos", rol.status === 201 && alta.status === 201 && !!tSin, `${rol.status} ${alta.status} ${alta.data?.message}`);

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

terminar();
