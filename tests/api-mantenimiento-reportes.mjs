/*
 * Reporte PDF de mantenimiento (Inventario › Mantenimiento), por la API:
 * - adjunta quien puede registrar o editar mantenimientos (Administrador/a
 *   Auxiliar: equipos C/E de mantenimiento); quien solo consulta (Auditor Interno)
 *   lo ve y lo abre, pero adjuntar, reemplazar o quitar le da 403;
 * - solo PDF real: un archivo que no es PDF aunque se llame .pdf, u otra extension, se rechaza;
 * - se guarda con su huella SHA-256 en <instancia>/maintenance_reports/ y se abre en linea;
 * - reemplazar y quitar piden motivo y contrasena; el anterior se conserva (anulado)
 *   y todo queda en la bitacora.
 * Que el archivo entre en el respaldo y en la prueba de restauracion lo comprueba respaldos.mjs.
 */
import "./lib/reauth-auto.mjs";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { api, crearCheck, Database, sesiones } from "./lib/calidad.mjs";
import { pdfConTexto } from "./lib/archivos.mjs";

const { check, terminar } = crearCheck();
const TEST_DB = process.env.TEST_DB_PATH;
const INSTANCIA = path.dirname(TEST_DB);
const { t } = await sesiones();
const sha = (b) => createHash("sha256").update(b).digest("hex");
const db = () => new Database(TEST_DB, { readonly: true });
const fila = (sql, ...p) => {
  const d = db();
  try {
    return d.prepare(sql).get(...p);
  } finally {
    d.close();
  }
};
const formulario = (mantenimientoId, bytes, nombre, extra = {}) => {
  const fd = new FormData();
  fd.append("archivo", new Blob([bytes]), nombre);
  fd.append("id_mantenimiento", String(mantenimientoId));
  for (const [k, v] of Object.entries(extra)) fd.append(k, String(v));
  return fd;
};
const reportesDe = async (mid, token) => (await api("GET", `/documents?mantenimiento=${mid}`, undefined, token)).data;
const cuantos = (mid) => Number(fila("SELECT COUNT(*) AS n FROM reportes_mantenimiento WHERE id_mantenimiento = ?", mid).n);

// Equipo propio: programar un mantenimiento pone el equipo «En mantenimiento» (no se toca el de los datos de apoyo).
const equipoId = (await api("POST", "/inventory/equipos", { nombre: "Equipo reporte de servicio", clave_bitacora: `FX-TCB-RM${Date.now().toString(36).slice(-5).toUpperCase()}`, estado: "operativo" }, t.qa)).data?.id;
const mant = await api("POST", "/inventory/mantenimientos", { id_equipo: equipoId, tipo: "preventivo", fecha_programada: "2027-03-01", estado: "programado", tecnico_proveedor: "Servicio externo de prueba" }, t.carmen);
const M = mant.data?.id;
check("datos: mantenimiento registrado por la Administradora Auxiliar", mant.status === 201 && !!M, `${mant.status} ${mant.data?.message}`);

/* ---------- Adjuntar ---------- */
const pdf = await pdfConTexto(1, "Reporte de servicio de prueba");
const subida = await api("POST", "/documents/maintenance-report", formulario(M, pdf, "reporte servicio.pdf"), t.carmen);
const R1 = subida.data?.id;
const r1 = R1 ? fila("SELECT * FROM reportes_mantenimiento WHERE id = ?", R1) : null;
const enDisco = r1?.nombre_almacenado ? path.join(INSTANCIA, "maintenance_reports", ...String(r1.nombre_almacenado).split("/")) : null;
check("adjuntar con un rol permitido: 201, huella SHA-256 del archivo y fecha de hoy por omisión", subida.status === 201 && r1?.sha256 === sha(pdf) && subida.data?.sha256 === sha(pdf) && Number(r1?.tamano_bytes) === pdf.length && r1?.nombre_original === "reporte servicio.pdf" && /^\d{4}-\d{2}-\d{2}$/.test(String(r1?.fecha_reporte)), `${subida.status} ${subida.data?.message} ${r1?.nombre_original}`);
check("el PDF queda en <instancia>/maintenance_reports/<mantenimiento>/ con el mismo contenido", !!enDisco && enDisco.startsWith(path.join(INSTANCIA, "maintenance_reports", String(M)) + path.sep) && fs.existsSync(enDisco) && sha(fs.readFileSync(enDisco)) === sha(pdf), enDisco || "sin ruta");

const vistaAuditor = await reportesDe(M, t.hector);
const vistaCarmen = await reportesDe(M, t.carmen);
check("quien solo consulta (Auditor Interno) ve el reporte, sin poder gestionarlo; quien lo adjuntó sí", vistaAuditor?.items?.some((x) => Number(x.id) === R1) && vistaAuditor?.puede_gestionar === false && vistaCarmen?.puede_gestionar === true, `${vistaAuditor?.items?.length} ${vistaAuditor?.puede_gestionar}/${vistaCarmen?.puede_gestionar}`);
const archivo = await api("GET", String(subida.data?.archivo_url || "").replace(/^\/api/, ""), undefined, t.hector);
check("el PDF se sirve en línea (sin descarga forzada) a quien solo consulta", archivo.status === 200 && /application\/pdf/.test(archivo.headers.get("content-type") || "") && /^inline/.test(archivo.headers.get("content-disposition") || "") && Buffer.isBuffer(archivo.data) && sha(archivo.data) === sha(pdf), `${archivo.status} ${archivo.headers.get("content-disposition")}`);
const mantLista = ((await api("GET", "/inventory/mantenimientos", undefined, t.carmen)).data?.items || []).find((x) => Number(x.id) === M);
check("la lista de mantenimientos muestra su reporte vigente", mantLista?.reporte_codigo === r1?.codigo, `${mantLista?.reporte_codigo}`);
const evCrear = fila("SELECT accion, referencia, coalesce(datos_nuevos_json, '') || coalesce(cambios_json, '') AS detalle FROM auditoria WHERE entidad = 'reportes_mantenimiento' AND entidad_id = ? ORDER BY id DESC LIMIT 1", String(R1));
check("bitácora: «crear» del reporte con su huella SHA-256", evCrear?.accion === "crear" && evCrear?.referencia === r1?.codigo && String(evCrear?.detalle || "").includes(sha(pdf)), JSON.stringify(evCrear)?.slice(0, 160));

/* ---------- Rechazos ---------- */
const antes = cuantos(M);
const disfrazado = await api("POST", "/documents/maintenance-report", formulario(M, Buffer.from("Esto no es un PDF, solo texto con extensión .pdf"), "falso.pdf"), t.carmen);
const imagen = await api("POST", "/documents/maintenance-report", formulario(M, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), "foto.pdf"), t.carmen);
const otraExt = await api("POST", "/documents/maintenance-report", formulario(M, pdf, "reporte.docx"), t.carmen);
const vacio = await api("POST", "/documents/maintenance-report", formulario(M, Buffer.alloc(0), "vacio.pdf"), t.carmen);
check("rechaza un archivo que no es PDF aunque se llame .pdf (texto o imagen), otra extensión y un archivo vacío (400, sin registro)", disfrazado.status === 400 && imagen.status === 400 && otraExt.status === 400 && vacio.status === 400 && cuantos(M) === antes, `${disfrazado.status} ${disfrazado.data?.message} | ${imagen.status} | ${otraExt.status} ${otraExt.data?.codigo} | ${vacio.status} ${vacio.data?.codigo}`);
const sinPermiso = await api("POST", "/documents/maintenance-report", formulario(M, pdf, "auditor.pdf"), t.hector);
check("rol sin permiso (Auditor Interno): adjuntar → 403 y no se registra", sinPermiso.status === 403 && cuantos(M) === antes, `${sinPermiso.status} ${sinPermiso.data?.message}`);
const otroMant = await api("POST", "/documents/maintenance-report", formulario(999999, pdf, "x.pdf"), t.carmen);
check("mantenimiento inexistente → 404", otroMant.status === 404, `${otroMant.status}`);

/* ---------- Reemplazar ---------- */
const pdf2 = await pdfConTexto(2, "Reporte de servicio corregido");
const sinMotivo = await api("POST", "/documents/maintenance-report", formulario(M, pdf2, "corregido.pdf", { reemplaza_id: R1 }), t.carmen);
const reemplazoAuditor = await api("POST", "/documents/maintenance-report", formulario(M, pdf2, "corregido.pdf", { reemplaza_id: R1, motivo: "Se adjuntó el de otro equipo" }), t.hector);
const sinPwd = await api("POST", "/documents/maintenance-report", formulario(M, pdf2, "corregido.pdf", { reemplaza_id: R1, motivo: "Se adjuntó el de otro equipo" }), t.carmen, { "X-Sin-Reauth-Auto": "1" });
check("reemplazar exige motivo (400), permiso (403 al Auditor) y contraseña (401 sin ella); nada cambia", sinMotivo.status === 400 && reemplazoAuditor.status === 403 && sinPwd.status === 401 && cuantos(M) === antes, `${sinMotivo.status} ${reemplazoAuditor.status} ${sinPwd.status} ${sinPwd.data?.codigo}`);
const reemplazo = await api("POST", "/documents/maintenance-report", formulario(M, pdf2, "corregido.pdf", { reemplaza_id: R1, motivo: "Se adjuntó el de otro equipo" }), t.carmen);
const R2 = reemplazo.data?.id;
const viejo = fila("SELECT * FROM reportes_mantenimiento WHERE id = ?", R1);
const lista2 = (await reportesDe(M, t.carmen))?.items || [];
check("reemplazar con motivo y contraseña: el nuevo queda vigente (versión 2.0) y el anterior se conserva anulado", reemplazo.status === 201 && !!viejo?.anulado_en && Number(viejo?.reemplazado_por) === R2 && viejo?.motivo_anulacion === "Se adjuntó el de otro equipo" && lista2.length === 1 && Number(lista2[0].id) === R2 && lista2[0].version === "2.0" && fs.existsSync(enDisco), `${reemplazo.status} ${reemplazo.data?.message} vigentes=${lista2.map((x) => x.id)}`);
const evSust = fila("SELECT accion, motivo FROM auditoria WHERE entidad = 'reportes_mantenimiento' AND entidad_id = ? ORDER BY id DESC LIMIT 1", String(R1));
check("bitácora: «sustituir» del anterior con el motivo", evSust?.accion === "sustituir" && evSust?.motivo === "Se adjuntó el de otro equipo", JSON.stringify(evSust));

/* ---------- Quitar ---------- */
const quitarAuditor = await api("POST", `/documents/maintenance-report/${R2}/quitar`, { motivo: "No corresponde" }, t.hector);
const quitarSinMotivo = await api("POST", `/documents/maintenance-report/${R2}/quitar`, { motivo: "" }, t.carmen);
const quitar = await api("POST", `/documents/maintenance-report/${R2}/quitar`, { motivo: "Se subió por error" }, t.carmen);
const otraVez = await api("POST", `/documents/maintenance-report/${R2}/quitar`, { motivo: "Se subió por error" }, t.carmen);
const r2 = fila("SELECT * FROM reportes_mantenimiento WHERE id = ?", R2);
const r2Disco = path.join(INSTANCIA, "maintenance_reports", ...String(r2?.nombre_almacenado || "x").split("/"));
const evQuitar = fila("SELECT accion, motivo FROM auditoria WHERE entidad = 'reportes_mantenimiento' AND entidad_id = ? ORDER BY id DESC LIMIT 1", String(R2));
const mantLista2 = ((await api("GET", "/inventory/mantenimientos", undefined, t.carmen)).data?.items || []).find((x) => Number(x.id) === M);
check("quitar: 403 al Auditor, 400 sin motivo; con motivo 200 y el archivo se conserva; quitarlo otra vez → 409", quitarAuditor.status === 403 && quitarSinMotivo.status === 400 && quitar.status === 200 && otraVez.status === 409 && !!r2?.anulado_en && fs.existsSync(r2Disco), `${quitarAuditor.status} ${quitarSinMotivo.status} ${quitar.status} ${otraVez.status}`);
check("tras quitarlo ya no se lista ni aparece en el mantenimiento; la bitácora tiene «anular» con el motivo", ((await reportesDe(M, t.carmen))?.items || []).length === 0 && !mantLista2?.reporte_codigo && evQuitar?.accion === "anular" && evQuitar?.motivo === "Se subió por error", `${mantLista2?.reporte_codigo} ${JSON.stringify(evQuitar)}`);

terminar();
