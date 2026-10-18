/*
 * Seguridad de cuentas y sesiones (Fase 2; FX-MO-2-1, secciones 9 a 11).
 *
 * Comprueba contra el servidor de prueba (TRUST_PROXY=true, JWT_EXPIRES_HOURS
 * y CORS_ORIGINS sin definir):
 * - correcciones heredadas: bitacora sin acceso con alcance diferido, origen
 *   obligatorio en toda la cadena, cargo predeterminado;
 * - cuentas temporales, supervisor y vigencia (tambien con la sesion abierta);
 * - alcance supervisado: pendiente, no avanza, visto bueno con reautenticacion
 *   y regreso con observaciones;
 * - bloqueo por cuenta y por IP (mismo mensaje exista o no la cuenta), desbloqueo
 *   por tiempo y manual;
 * - reautenticacion: sin token, vencido, reutilizado, de otra accion o persona;
 * - sesiones (token_version, cerrar en todos, JWT 8 h), contrasenas,
 *   secretos en produccion, CORS y bitacora sin hashes (la revision de accesos se integro en Usuarios).
 */
import "./lib/reauth-auto.mjs";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { autorizarTodo } from "./lib/autorizar.mjs";

const Database = createRequire(import.meta.url)(process.env.BETTER_SQLITE3 || "better-sqlite3");
const BASE = process.env.BASE || "http://localhost:3100/api";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const credenciales = JSON.parse(readFileSync(process.env.CREDENCIALES_ROLES, "utf8"));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ""}`);
};
const db = () => new Database(process.env.TEST_DB_PATH);
const sql = (query, ...args) => {
  const d = db();
  try {
    return d.prepare(query).run(...args);
  } finally {
    d.close();
  }
};
const fila = (query, ...args) => {
  const d = db();
  try {
    return d.prepare(query).get(...args);
  } finally {
    d.close();
  }
};

async function api(method, ruta, body, token, headers = {}) {
  const res = await fetch(`${BASE}${ruta}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, data, headers: res.headers };
}
const SIN_AUTO = { "X-Sin-Reauth-Auto": "1" };
const login = async (email, password, ip) => api("POST", "/auth/login", { email, password }, null, ip ? { "X-Forwarded-For": ip } : {});
const token = async (email, password = credenciales[email]) => (await login(email, password)).data?.token;
const reauth = async (tok, accion, password) => (await api("POST", "/auth/reauth", { accion, password }, tok)).data?.token;
const auditoria = (accion, referencia) => fila("SELECT * FROM auditoria WHERE accion = ? AND (? IS NULL OR referencia = ?) ORDER BY id DESC LIMIT 1", accion, referencia ?? null, referencia ?? null);

/* ---------- Datos de muestras ---------- */
const inspeccion = {
  checklist: Array.from({ length: 7 }, (_, i) => ({ requisito: `Requisito ${i + 1}`, estado: i === 6 ? "NA" : "C", observacion: null })),
  observaciones_generales: null,
};
const recepcionBase = (id) => ({ fecha_recepcion: "2026-09-20", hora_recepcion: "09:00", recibido_por: "QA", medio_recepcion: "directa", solicitante: "Cliente seguridad", muestra_unica: true, id_interno: id, fecha_muestra: "2026-09-19", analisis: { tipos: ["toxinas_lipofilicas"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] } });
const aceptada = (id) => ({ ...recepcionBase(id), inspeccion, decision_aceptacion: "aceptada", aceptacion: { fecha: "2026-09-20", responsable: "QA" } });
const procesamiento = (recepcion, id) => ({ recepcion_id: recepcion, muestra_tipo: "unica", id_interno: id, fecha_procesamiento: "2026-09-20", tipo_organismo: ["bivalvos"], nombre_quien_proceso: "QA" });
const extraccion = (proc, id) => ({ tipo_registro: "E-D", procesamiento_id: proc, tipo_molienda: "fresca", id_interno: id, fecha_extraccion: "2026-09-20", registro_pesos: [{ id_muestra: id, replica: `${id}_R1`, peso_muestra: 2.01 }], nombre_quien_extrajo: "QA" });
const analisis = (ext, id, extra = {}) => ({ tipo_analisis: "toxinas_lipofilicas", metodo: "hplc_ms_ms", extraccion_id: ext, fecha_analisis: "2026-09-20", analista_nombre: "QA", resultados: [{ id_muestra: id, resultado: 50, unidad: "µg/kg", limite_regulatorio: 160, cumple: "cumple" }], ...extra });

const QA_PWD = "QaFicotox2026!";
const QA = await token("qa@ficotox.local", QA_PWD);
check("login QA", !!QA);
const roles = (await api("GET", "/admin/roles", undefined, QA)).data?.items || [];
const rolId = (nombre) => roles.find((r) => r.nombre === nombre)?.id;
const idDe = (email) => fila("SELECT id FROM usuarios WHERE email = ?", email)?.id;
const RICARDO = "ricardo.medina@ficotox.local";
const DIEGO = "diego.salinas@ficotox.local";
const ricardoId = idDe(RICARDO);
const PWD = "Seguridad-Prueba-2026";
let n = 0;
const nuevo = async (prefijo, rol, extra = {}) => {
  const email = `${prefijo}.${Date.now()}${(n += 1)}@cicese.mx`;
  const r = await api("POST", "/admin/usuarios", { nombre: `${prefijo} prueba`, email, activo: true, rol_id: rolId(rol), password: PWD, motivo: "Alta de prueba de seguridad", ...extra }, QA);
  await autorizarTodo(BASE, QA, r.data?.id);
  return { email, id: r.data?.id, status: r.status, data: r.data };
};
const temporal = (extra = {}) => ({ tipo_cuenta: "temporal", vigente_hasta: "2099-12-31", supervisor_id: ricardoId, motivo_cuenta: "Estancia de prueba", ...extra });

/* ================= 1. Correcciones heredadas ================= */
{
  for (const email of ["mariana.delgado@ficotox.local", "carmen.aguilar@ficotox.local", DIEGO]) {
    const t = await token(email);
    const r = await api("GET", "/audit?limit=1", undefined, t);
    const v = await api("GET", "/audit/verify", undefined, t);
    check(`calidad diferida = sin acceso: ${email} no ve la bitacora (403)`, r.status === 403 && v.status === 403, `lista ${r.status} verificar ${v.status}`);
  }
  const R = (await api("POST", "/samples/reception", aceptada("SEG-ORIGEN"), QA)).data?.id;
  const sinRecep = await api("POST", "/samples/processing", procesamiento(null, "SEG-ORIGEN"), QA);
  const P = (await api("POST", "/samples/processing", procesamiento(R, "SEG-ORIGEN"), QA)).data?.id;
  const quitar = await api("PUT", `/samples/processing/${P}`, { ...procesamiento(null, "SEG-ORIGEN"), folio_num: fila("SELECT folio_num FROM muestras_procesamiento WHERE id = ?", P)?.folio_num }, QA);
  const sinProc = await api("POST", "/samples/extraction", extraccion(null, "SEG-ORIGEN"), QA);
  const E = (await api("POST", "/samples/extraction", extraccion(P, "SEG-ORIGEN"), QA)).data?.id;
  const sinExt = await api("POST", "/samples/analysis", analisis(null, "SEG-ORIGEN", { recepcion_id: R }), QA);
  const planctonSinOrigen = await api("POST", "/samples/analysis", analisis(null, "SEG-ORIGEN", { tipo_analisis: "plancton", metodo: "otro", metodo_otro: "Conteo", recepcion_id: R }), QA);
  const conExt = await api("POST", "/samples/analysis", analisis(E, "SEG-ORIGEN"), QA);
  const informeSin = await api("POST", "/informes", { analisis_ids: [], cliente: { nombre: "X" } }, QA);
  check("origen obligatorio: procesamiento sin recepcion -> 400", sinRecep.status === 400 && sinRecep.data?.codigo === "origen_requerido", `${sinRecep.status} ${sinRecep.data?.message}`);
  check("origen obligatorio tambien al editar: quitar la recepcion de un procesamiento -> 400", quitar.status === 400, `${quitar.status} ${quitar.data?.message}`);
  check("origen obligatorio: extraccion sin procesamiento -> 400", sinProc.status === 400 && sinProc.data?.codigo === "origen_requerido", `${sinProc.status} ${sinProc.data?.message}`);
  check("origen obligatorio: analisis (DSP) sin extraccion -> 400, aunque traiga la recepcion", sinExt.status === 400, `${sinExt.status} ${sinExt.data?.message}`);
  check("analisis sin extraccion (plancton) tampoco parte directo de la recepcion -> 400", planctonSinOrigen.status === 400, `${planctonSinOrigen.status} ${planctonSinOrigen.data?.message}`);
  check("con la cadena completa el analisis se registra (201)", conExt.status === 201, `${conExt.status} ${conExt.data?.message}`);
  check("informe sin recepcion -> 400", informeSin.status === 400, `${informeSin.status} ${informeSin.data?.message}`);

  // Cargo predeterminado: dos roles que otorgan informes:R.
  const persona = await nuevo("cargo.pred", "Responsable General");
  await api("POST", `/admin/usuarios/${persona.id}/roles`, { rol_id: rolId("Coordinador/a del Área Técnica"), motivo: "Segundo rol de prueba" }, QA);
  const t = await token(persona.email, PWD);
  const A = conExt.data?.id;
  // Fase 3: el analisis de QA lo revisa y aprueba otra persona.
  const tRev = await token(RICARDO);
  // Fase 6: el analisis se revisa solo despues de enviarlo a revision.
  await api("POST", `/samples/analysis/${A}/enviar-revision`, {}, QA);
  await api("POST", `/samples/analysis/${A}/revisar`, {}, tRev);
  await api("POST", `/samples/analysis/${A}/aprobar`, {}, tRev);
  const inf = await api("POST", "/informes", { recepcion_id: R, analisis_ids: [A], cliente: { nombre: "Cliente cargo" } }, QA);
  const sinCargo = await api("POST", `/informes/${inf.data?.id}/revisar`, {}, t);
  const rolRG = rolId("Responsable General");
  const noSuyo = await api("PUT", "/auth/me/cargo", { rol_id: rolId("Auditor Interno") }, t);
  const fijar = await api("PUT", "/auth/me/cargo", { rol_id: rolRG }, t);
  const me = (await api("GET", "/auth/me", undefined, t)).data;
  const invalido = await api("POST", `/informes/${inf.data?.id}/revisar`, {}, t, { "X-Actuar-Como": String(rolId("Auditor Interno")) });
  const conCargo = await api("POST", `/informes/${inf.data?.id}/revisar`, {}, t);
  check("sin cargo predeterminado, con dos roles que otorgan la accion -> 409 ELEGIR_CARGO", sinCargo.status === 409 && sinCargo.data?.codigo === "ELEGIR_CARGO", `${sinCargo.status}`);
  check("el cargo predeterminado debe ser un rol vigente propio (400 si no)", noSuyo.status === 400 && fijar.status === 200 && Number(me?.user?.cargo_predeterminado) === Number(rolRG), `${noSuyo.status} ${fijar.status} ${me?.user?.cargo_predeterminado}`);
  check("el servidor rechaza actuar como un cargo que no otorga el permiso (403)", invalido.status === 403 && invalido.data?.codigo === "CARGO_INVALIDO", `${invalido.status}`);
  check("con cargo predeterminado se actua sin elegir (sin dialogo) y se guarda ese cargo", conCargo.status === 200 && conCargo.data?.item?.revisado_cargo === "Responsable General", `${conCargo.status} ${conCargo.data?.item?.revisado_cargo}`);
  check("bitacora: cambio de cargo predeterminado", !!auditoria("cambiar_cargo", persona.email));
}

/* ================= 2. Cuentas temporales y vigencia ================= */
{
  const sinFin = await nuevo("temp.sinfin", "Técnico Auxiliar", { tipo_cuenta: "temporal", supervisor_id: ricardoId });
  const sinSup = await nuevo("temp.sinsup", "Técnico Auxiliar", { tipo_cuenta: "temporal", vigente_hasta: "2099-12-31" });
  const supAuditor = await nuevo("temp.supaud", "Técnico Auxiliar", temporal({ supervisor_id: idDe("hector.navarro@ficotox.local") }));
  const estPerm = await nuevo("est.perm", "Estudiante / personal en formación");
  const ok = await nuevo("temp.ok", "Técnico Auxiliar", temporal({ vigente_hasta: "2099-06-30" }));
  const supTemporal = await nuevo("temp.suptemp", "Técnico Auxiliar", temporal({ supervisor_id: ok.id }));
  check("cuenta temporal sin fecha de fin -> 400", sinFin.status === 400, sinFin.data?.message);
  check("cuenta temporal sin supervisor -> 400", sinSup.status === 400, sinSup.data?.message);
  check("supervisor sin R ni A en ensayos o muestras (Auditor) -> 400", supAuditor.status === 400, supAuditor.data?.message);
  check("supervisor con cuenta temporal -> 400", supTemporal.status === 400, supTemporal.data?.message);
  check("el rol de estudiante exige cuenta temporal -> 400", estPerm.status === 400 && /temporal/i.test(String(estPerm.data?.message)), estPerm.data?.message);
  check("cuenta temporal valida (fin + supervisor con R/A por permisos) -> 201", ok.status === 201, ok.data?.message);
  const asig = fila("SELECT vigente_hasta FROM usuario_roles WHERE usuario_id = ? AND revocado_en IS NULL", ok.id);
  check("el rol inicial toma la vigencia de la cuenta", asig?.vigente_hasta === "2099-06-30", asig?.vigente_hasta);
  const excede = await api("POST", `/admin/usuarios/${ok.id}/roles`, { rol_id: rolId("Técnico Analista"), vigente_hasta: "2100-01-01", motivo: "Excede la cuenta" }, QA);
  check("un rol no puede exceder la vigencia de la cuenta -> 400", excede.status === 400, excede.data?.message);
  const self = await api("PUT", `/admin/usuarios/${ok.id}`, { nombre: "temp.ok prueba", email: ok.email, activo: true, ...temporal({ supervisor_id: ok.id, vigente_hasta: "2099-06-30" }) }, QA);
  check("nadie se supervisa a si mismo -> 400", self.status === 400, self.data?.message);

  const base = { nombre: "temp.ok prueba", email: ok.email, activo: true, tipo_cuenta: "temporal", vigente_hasta: "2099-05-31", supervisor_id: ricardoId };
  const sinMotivo = await api("PUT", `/admin/usuarios/${ok.id}`, base, QA);
  const sinReauth = await api("PUT", `/admin/usuarios/${ok.id}`, { ...base, motivo_cuenta: "Se acorta la estancia" }, QA, SIN_AUTO);
  const conTodo = await api("PUT", `/admin/usuarios/${ok.id}`, { ...base, motivo_cuenta: "Se acorta la estancia" }, QA);
  const bit = auditoria("cambiar_vigencia", ok.email);
  check("cambiar vigencia exige motivo (400), reautenticacion (401 reauth_required) y queda en bitacora", sinMotivo.status === 400 && sinReauth.status === 401 && sinReauth.data?.codigo === "reauth_required" && conTodo.status === 200 && bit?.motivo === "Se acorta la estancia", `${sinMotivo.status} ${sinReauth.status} ${conTodo.status}`);
  const rolAcotado = fila("SELECT vigente_hasta FROM usuario_roles WHERE usuario_id = ? AND revocado_en IS NULL", ok.id);
  check("al acortar la cuenta, sus roles se acotan a la nueva fecha (evento acotar_rol por rol)", rolAcotado?.vigente_hasta === "2099-05-31" && !!auditoria("acotar_rol", ok.email), rolAcotado?.vigente_hasta);
  // Un solo guardado con varios cambios criticos (vigencia + contrasena de otra persona) pide una sola reautenticacion.
  const combinado = await api("PUT", `/admin/usuarios/${ok.id}`, { ...base, vigente_hasta: "2099-05-30", motivo_cuenta: "Ajuste y nueva clave", password: "Combinada-Clave-2026" }, QA);
  await api("PUT", `/admin/usuarios/${ok.id}`, { ...base, vigente_hasta: "2099-05-30", password: PWD }, QA);
  check("un guardado con vigencia y contrasena a la vez se confirma con una sola reautenticacion", combinado.status === 200, `${combinado.status} ${combinado.data?.message}`);
  sql("UPDATE usuarios SET debe_cambiar_password = 0 WHERE id = ?", ok.id);

  // Fuera de vigencia: no entra y la sesion abierta se corta en la siguiente peticion.
  const futuro = await nuevo("temp.futuro", "Técnico Auxiliar", temporal({ vigente_desde: "2099-01-01" }));
  const loginFuturo = await login(futuro.email, PWD);
  const rechazo = fila("SELECT cambios_json FROM auditoria WHERE accion = 'login_fallido' AND referencia = ? ORDER BY id DESC LIMIT 1", futuro.email);
  check("el intento de una cuenta fuera de vigencia queda en la bitacora (login_fallido, cuenta_no_vigente)", String(rechazo?.cambios_json || "").includes("cuenta_no_vigente"));
  check("cuenta que aun no inicia: no entra, con el mensaje de acceso no vigente", futuro.status === 201 && loginFuturo.status === 403 && loginFuturo.data?.message === "Tu acceso no está vigente; contacta al administrador", `${futuro.status} ${loginFuturo.status} ${loginFuturo.data?.message}`);
  const tOk = await token(ok.email, PWD);
  const antes = await api("GET", "/auth/me", undefined, tOk);
  sql("UPDATE usuarios SET vigente_hasta = '2020-01-01' WHERE id = ?", ok.id);
  const despues = await api("GET", "/samples/reception?search=", undefined, tOk);
  check("cuenta que vence con la sesion abierta: la siguiente peticion -> 401 cuenta_no_vigente", antes.status === 200 && despues.status === 401 && despues.data?.codigo === "cuenta_no_vigente", `${antes.status} ${despues.status} ${despues.data?.codigo}`);
  // Acortarla a antes del inicio de un rol: el rol se revoca (sin rango invertido) y queda en la bitacora.
  const antesDelRol = await api("PUT", `/admin/usuarios/${ok.id}`, { ...base, vigente_hasta: new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA"), motivo_cuenta: "Termino antes" }, QA);
  const invertidos = fila("SELECT COUNT(*) AS n FROM usuario_roles WHERE usuario_id = ? AND revocado_en IS NULL AND vigente_hasta < vigente_desde", ok.id)?.n;
  check("acortar la cuenta antes del inicio de un rol lo revoca (sin rangos invertidos)", antesDelRol.status === 200 && invertidos === 0 && auditoria("revocar_rol", ok.email)?.motivo?.includes("antes de que iniciara"), `${antesDelRol.status} invertidos=${invertidos}`);

  // Aviso del Inicio: accesos que vencen en 7 dias.
  const pronto = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await nuevo("temp.pronto", "Técnico Auxiliar", temporal({ vigente_hasta: pronto }));
  const avisosAdmin = (await api("GET", "/inicio/avisos", undefined, QA)).data?.items || [];
  const avisosSup = (await api("GET", "/inicio/avisos", undefined, await token(RICARDO))).data?.items || [];
  check("Inicio: aviso de accesos por vencer para usuarios:G y para el supervisor", avisosAdmin.some((a) => a.key === "accesos_vencen") && avisosSup.some((a) => a.key === "accesos_vencen"), `${avisosAdmin.map((a) => a.key)} | ${avisosSup.map((a) => a.key)}`);
}

/* ================= 3. Alcance supervisado ================= */
{
  const tDiego = await token(DIEGO);
  const tRicardo = await token(RICARDO);
  const me = (await api("GET", "/auth/me", undefined, tDiego)).data?.user;
  check("la cuenta de estudiante del catalogo es temporal con supervisor", me?.tipo_cuenta === "temporal" && Number(me?.supervisor_id) === Number(ricardoId), JSON.stringify(me));
  const R = await api("POST", "/samples/reception", aceptada("SEG-SUP-1"), tDiego);
  const reg = fila("SELECT requiere_supervision, supervision_estado, supervisor_id FROM muestras_recepcion WHERE id = ?", R.data?.id);
  check("lo que crea el estudiante queda pendiente del visto bueno de su supervisor", R.status === 201 && reg?.requiere_supervision === 1 && reg?.supervision_estado === "pendiente" && reg?.supervisor_id === ricardoId, `${R.status} ${JSON.stringify(reg)}`);
  const noAvanza = await api("POST", "/samples/processing", procesamiento(R.data?.id, "SEG-SUP-1"), QA);
  check("pendiente: no sirve de origen de la etapa siguiente (409 supervision_pendiente)", noAvanza.status === 409 && noAvanza.data?.codigo === "supervision_pendiente", `${noAvanza.status} ${noAvanza.data?.message}`);
  const cerrar = await api("POST", `/samples/reception/${R.data?.id}/disposicion`, { tipo: "rpbi", fecha: "2026-09-20", responsable: "QA" }, QA);
  check("pendiente: no se cierra (409)", cerrar.status === 409, `${cerrar.status} ${cerrar.data?.message}`);
  const bandeja = (await api("GET", "/supervision", undefined, tRicardo)).data;
  check("bandeja 'Por supervisar' del supervisor", (bandeja?.por_supervisar || []).some((i) => i.tabla === "muestras_recepcion" && i.id === R.data?.id), JSON.stringify(bandeja?.por_supervisar?.map((i) => i.referencia)));
  const filtro = (await api("GET", "/samples/reception?supervision=mia", undefined, tRicardo)).data?.items || [];
  check("filtro de lista supervision=mia", filtro.some((i) => i.id === R.data?.id) && filtro.every((i) => i.supervision_estado === "pendiente"), `${filtro.length}`);
  const inicio = (await api("GET", "/inicio/avisos", undefined, tRicardo)).data?.items || [];
  check("Inicio del supervisor: aviso 'Por supervisar'", inicio.some((a) => a.key === "por_supervisar"));
  const ajeno = await api("POST", `/supervision/muestras_recepcion/${R.data?.id}/visto-bueno`, {}, QA);
  check("solo el supervisor asignado da el visto bueno (403 a otra persona)", ajeno.status === 403, `${ajeno.status}`);
  const sinReauth = await api("POST", `/supervision/muestras_recepcion/${R.data?.id}/visto-bueno`, {}, tRicardo, SIN_AUTO);
  check("visto bueno sin reautenticacion -> 401 reauth_required", sinReauth.status === 401 && sinReauth.data?.codigo === "reauth_required" && sinReauth.data?.accion === "supervision:visto_bueno", `${sinReauth.status} ${sinReauth.data?.codigo}`);
  const vb = await api("POST", `/supervision/muestras_recepcion/${R.data?.id}/visto-bueno`, { observaciones: "Correcto" }, tRicardo);
  const avanza = await api("POST", "/samples/processing", procesamiento(R.data?.id, "SEG-SUP-1"), QA);
  check("con visto bueno el registro avanza (procesamiento 201) y queda en bitacora", vb.status === 200 && avanza.status === 201 && !!auditoria("visto_bueno"), `${vb.status} ${avanza.status}`);

  const R2 = (await api("POST", "/samples/reception", aceptada("SEG-SUP-2"), tDiego)).data?.id;
  const sinObs = await api("POST", `/supervision/muestras_recepcion/${R2}/regresar`, {}, tRicardo);
  const regresar = await api("POST", `/supervision/muestras_recepcion/${R2}/regresar`, { observaciones: "Falta la hora de muestreo" }, tRicardo);
  const bandejaDiego = (await api("GET", "/supervision", undefined, tDiego)).data;
  const sigue = await api("POST", "/samples/processing", procesamiento(R2, "SEG-SUP-2"), QA);
  check("regresar exige observaciones (400) y deja el registro regresado, visible a quien lo capturo y sin avanzar", sinObs.status === 400 && regresar.status === 200 && (bandejaDiego?.regresados || []).some((i) => i.id === R2 && i.observaciones === "Falta la hora de muestreo") && sigue.status === 409 && !!auditoria("regresar_supervision"), `${sinObs.status} ${regresar.status} ${sigue.status}`);
  const folio = fila("SELECT folio_num FROM muestras_recepcion WHERE id = ?", R2)?.folio_num;
  await api("PUT", `/samples/reception/${R2}`, { ...aceptada("SEG-SUP-2"), folio_num: folio, observaciones: "Hora agregada" }, tDiego);
  check("al corregirlo el estudiante, vuelve a quedar pendiente", fila("SELECT supervision_estado FROM muestras_recepcion WHERE id = ?", R2)?.supervision_estado === "pendiente");

  const mant = await api("POST", "/inventory/mantenimientos", { id_equipo: fila("SELECT id FROM equipos ORDER BY id LIMIT 1")?.id, tipo: "preventivo", fecha_programada: "2026-10-01", fecha_realizado: "2026-10-01", estado: "completado" }, tDiego);
  check("bajo supervision no se marca un mantenimiento como completado (409)", mant.status === 409, `${mant.status} ${mant.data?.message}`);

  // Lo pendiente sigue visible al supervisor aunque la cuenta supervisada venza.
  const est2 = await nuevo("est.vence", "Estudiante / personal en formación", temporal());
  const tEst2 = await token(est2.email, PWD);
  const R3 = (await api("POST", "/samples/reception", aceptada("SEG-SUP-3"), tEst2)).data?.id;
  sql("UPDATE usuarios SET vigente_hasta = '2020-01-01' WHERE id = ?", est2.id);
  const bandeja2 = (await api("GET", "/supervision", undefined, tRicardo)).data;
  check("lo pendiente sigue en la bandeja del supervisor aunque la cuenta supervisada venza", est2.status === 201 && (bandeja2?.por_supervisar || []).some((i) => i.id === R3), `${est2.status} ${R3}`);
}

/* ================= 4. Bloqueo ================= */
{
  const u = await nuevo("bloqueo", "Técnico Auxiliar");
  const ip = "10.0.0.11";
  const fallos = [];
  for (let i = 0; i < 5; i += 1) fallos.push(await login(u.email, "incorrecta-000", ip));
  const sexto = await login(u.email, PWD, ip);
  const inexistentes = [];
  for (let i = 0; i < 6; i += 1) inexistentes.push(await login("no.existe@cicese.mx", "incorrecta-000", "10.0.0.12"));
  const mensaje = fallos[0].data?.message;
  check("5 fallos en la ventana bloquean: el 6.o intento con la contrasena correcta falla", fallos.every((r) => r.status === 401) && sexto.status === 401, `${fallos.map((r) => r.status)} sexto ${sexto.status}`);
  const bloqueos = fila("SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'bloquear' AND referencia = ?", u.email)?.n;
  check("los intentos con la cuenta ya bloqueada no cuentan ni prolongan el bloqueo", bloqueos === 1, `bloqueos=${bloqueos}`);
  check("mismo mensaje exista o no la cuenta (tambien bloqueada)", sexto.data?.message === mensaje && inexistentes.every((r) => r.status === 401 && r.data?.message === mensaje), `${mensaje} | ${inexistentes.map((r) => r.data?.message).join(" / ")}`);
  const bloqueo = auditoria("bloquear", u.email);
  const lista = (await api("GET", "/admin/usuarios", undefined, QA)).data?.items || [];
  check("bitacora: intentos fallidos y bloqueo; la lista muestra 'bloqueada hasta'", !!bloqueo && !!auditoria("login_fallido", u.email) && !!lista.find((x) => x.id === u.id)?.bloqueado_hasta, `${!!bloqueo}`);
  const sinMotivo = await api("POST", `/admin/usuarios/${u.id}/desbloquear`, {}, QA);
  const sinReauth = await api("POST", `/admin/usuarios/${u.id}/desbloquear`, { motivo: "Verificada por telefono" }, QA, SIN_AUTO);
  const desb = await api("POST", `/admin/usuarios/${u.id}/desbloquear`, { motivo: "Verificada por telefono" }, QA);
  const entra = await login(u.email, PWD, ip);
  check("desbloqueo manual con motivo y reautenticacion; despues entra", sinMotivo.status === 400 && sinReauth.status === 401 && desb.status === 200 && entra.status === 200 && !!auditoria("desbloquear", u.email), `${sinMotivo.status} ${sinReauth.status} ${desb.status} ${entra.status}`);

  const u2 = await nuevo("bloqueo.tiempo", "Técnico Auxiliar");
  for (let i = 0; i < 5; i += 1) await login(u2.email, "incorrecta-000", "10.0.0.13");
  const bloqueada = await login(u2.email, PWD, "10.0.0.13");
  sql("UPDATE usuarios SET bloqueado_hasta = ? WHERE id = ?", new Date(Date.now() - 1000).toISOString(), u2.id);
  const tras = await login(u2.email, PWD, "10.0.0.13");
  check("desbloqueo por tiempo: al vencer el bloqueo vuelve a entrar", bloqueada.status === 401 && tras.status === 200, `${bloqueada.status} ${tras.status}`);

  // Por IP: 20 fallos desde una IP bloquean esa IP (429), no otras.
  for (let i = 0; i < 20; i += 1) await login(`ip.${i}@cicese.mx`, "incorrecta-000", "10.0.0.99");
  const desdeIp = await login("qa@ficotox.local", QA_PWD, "10.0.0.99");
  const otraIp = await login("qa@ficotox.local", QA_PWD, "10.0.0.98");
  check("bloqueo por IP: 20 fallos bloquean la IP (429) y otra IP entra", desdeIp.status === 429 && desdeIp.data?.codigo === "ip_bloqueada" && otraIp.status === 200, `${desdeIp.status} ${otraIp.status}`);
  for (let i = 0; i < 6; i += 1) await login("ricardo.medina@ficotox.local", credenciales["ricardo.medina@ficotox.local"], "10.0.0.99");
  const ricardo = fila("SELECT bloqueado_hasta FROM usuarios WHERE email = 'ricardo.medina@ficotox.local'");
  const ricardoEntra = await login("ricardo.medina@ficotox.local", credenciales["ricardo.medina@ficotox.local"], "10.0.0.97");
  check("un bloqueo de IP no bloquea las cuentas que intentan entrar desde ella", !ricardo?.bloqueado_hasta && ricardoEntra.status === 200, `${ricardo?.bloqueado_hasta} ${ricardoEntra.status}`);

  // Las fallas de reautenticacion cuentan.
  const u3 = await nuevo("bloqueo.reauth", "Técnico Auxiliar");
  const t3 = await token(u3.email, PWD);
  const r3 = [];
  for (let i = 0; i < 5; i += 1) r3.push(await api("POST", "/auth/reauth", { accion: "muestras:AN", password: "incorrecta-000" }, t3));
  const tras3 = await api("GET", "/auth/me", undefined, t3);
  check("5 reautenticaciones fallidas bloquean la cuenta y cierran su sesion", r3[4].data?.codigo === "cuenta_bloqueada" && tras3.status === 401 && !!auditoria("reauth_fallida", u3.email), `${r3.map((r) => r.status)} ${tras3.status}`);
}

/* ================= 5. Reautenticacion ================= */
{
  const R = (await api("POST", "/samples/reception", aceptada("SEG-RE"), QA)).data?.id;
  const P = (await api("POST", "/samples/processing", procesamiento(R, "SEG-RE"), QA)).data?.id;
  const E = (await api("POST", "/samples/extraction", extraccion(P, "SEG-RE"), QA)).data?.id;
  const A = (await api("POST", "/samples/analysis", analisis(E, "SEG-RE"), QA)).data?.id;
  // Fase 3: lo revisa y aprueba otra persona (Ricardo); QA lo elaboro.
  const tR = await token(RICARDO);
  // Fase 6: el analisis se revisa solo despues de enviarlo a revision.
  await api("POST", `/samples/analysis/${A}/enviar-revision`, {}, QA);
  await api("POST", `/samples/analysis/${A}/revisar`, {}, tR);
  const aprobarSin = await api("POST", `/samples/analysis/${A}/aprobar`, {}, tR, SIN_AUTO);
  const anularSin = await api("POST", `/samples/extraction/${E}/anular`, { motivo: "Prueba sin token" }, QA, SIN_AUTO);
  check("aprobar sin token -> 401 reauth_required (accion ensayos:A)", aprobarSin.status === 401 && aprobarSin.data?.codigo === "reauth_required" && aprobarSin.data?.accion === "ensayos:A", `${aprobarSin.status} ${aprobarSin.data?.accion}`);
  check("anular sin token -> 401 reauth_required (accion ensayos:AN)", anularSin.status === 401 && anularSin.data?.accion === "ensayos:AN", `${anularSin.status}`);
  const mala = await api("POST", "/auth/reauth", { accion: "ensayos:A", password: "incorrecta-000" }, QA);
  check("reautenticacion con contrasena incorrecta -> 401", mala.status === 401 && !mala.data?.token);
  const tokA = await reauth(tR, "ensayos:A", credenciales[RICARDO]);
  const otraAccion = await api("POST", `/samples/extraction/${E}/anular`, { motivo: "Token de otra accion" }, tR, { ...SIN_AUTO, "X-Reauth": tokA });
  check("token de otra accion -> 401 reauth_invalido", otraAccion.status === 401 && otraAccion.data?.codigo === "reauth_invalido", `${otraAccion.status} ${otraAccion.data?.message}`);
  const aprobar = await api("POST", `/samples/analysis/${A}/aprobar`, {}, tR, { ...SIN_AUTO, "X-Reauth": tokA });
  check("con token valido la aprobacion procede", aprobar.status === 200, `${aprobar.status} ${aprobar.data?.message}`);
  const tokAN = await reauth(QA, "ensayos:AN", QA_PWD);
  const A2 = (await api("POST", "/samples/analysis", analisis(E, "SEG-RE2"), QA)).data?.id;
  const anular1 = await api("POST", `/samples/analysis/${A2}/anular`, { motivo: "Primera anulacion" }, QA, { ...SIN_AUTO, "X-Reauth": tokAN });
  const reusado = await api("POST", `/samples/analysis/${A2}/restaurar`, { motivo: "Token reutilizado" }, QA, { ...SIN_AUTO, "X-Reauth": tokAN });
  check("token reutilizado -> 401 reauth_invalido", anular1.status === 200 && reusado.status === 401 && /ya se us/i.test(String(reusado.data?.message)), `${anular1.status} ${reusado.status} ${reusado.data?.message}`);
  const tokVencido = await reauth(QA, "ensayos:AN", QA_PWD);
  sql("UPDATE reautenticaciones SET expira_en = ? WHERE usado_en IS NULL AND accion = 'ensayos:AN'", new Date(Date.now() - 1000).toISOString());
  const vencido = await api("POST", `/samples/analysis/${A2}/restaurar`, { motivo: "Token vencido" }, QA, { ...SIN_AUTO, "X-Reauth": tokVencido });
  check("token vencido -> 401 reauth_invalido", vencido.status === 401 && /venci/i.test(String(vencido.data?.message)), `${vencido.status} ${vencido.data?.message}`);
  const tRicardo = await token(RICARDO);
  const deOtro = await reauth(tRicardo, "ensayos:AN", credenciales[RICARDO]);
  const ajeno = await api("POST", `/samples/analysis/${A2}/restaurar`, { motivo: "Token de otra persona" }, QA, { ...SIN_AUTO, "X-Reauth": deOtro });
  check("token de otra persona -> 401 reauth_invalido", ajeno.status === 401 && /otra persona/i.test(String(ajeno.data?.message)), `${ajeno.status} ${ajeno.data?.message}`);

  // Cada endpoint critico exige reautenticacion (sin token: 401 reauth_required antes de cambiar nada).
  const criticos = [
    ["POST", `/samples/reception/${R}/anular`, { motivo: "Sonda critica" }],
    ["POST", `/samples/reception/${R}/disposicion`, { tipo: "rpbi", fecha: "2026-09-20", responsable: "QA" }],
    ["POST", `/samples/processing/${P}/anular`, { motivo: "Sonda critica" }],
    ["POST", `/inventory/reactivos/${fila("SELECT id FROM reactivos ORDER BY id LIMIT 1")?.id}/refill`, null],
    ["DELETE", `/inventory/reactivos/${fila("SELECT id FROM reactivos ORDER BY id LIMIT 1")?.id}`, { motivo: "Sonda critica" }],
    ["DELETE", `/inventory/equipos/${fila("SELECT id FROM equipos ORDER BY id LIMIT 1")?.id}`, { motivo: "Sonda critica" }],
    ["POST", `/admin/usuarios/${ricardoId}/roles`, { rol_id: rolId("Auditor Interno"), motivo: "Sonda critica" }],
    ["POST", `/admin/usuarios/${ricardoId}/password`, { motivo: "Sonda critica" }],
    ["DELETE", `/admin/usuarios/${ricardoId}`, { motivo: "Sonda critica" }],
  ].filter(([, , body]) => body);
  const faltan = [];
  for (const [m, p, b] of criticos) {
    const r = await api(m, p, b, QA, SIN_AUTO);
    if (!(r.status === 401 && r.data?.codigo === "reauth_required")) faltan.push(`${m} ${p} -> ${r.status}`);
  }
  check("endpoints criticos (anular, cerrar, baja, roles, restablecer, dar de baja cuenta) exigen reautenticacion", faltan.length === 0, faltan.join("; "));
}

/* ================= 6. Sesiones ================= */
{
  const u = await nuevo("sesion", "Técnico Auxiliar");
  const t1 = await token(u.email, PWD);
  const t2 = await token(u.email, PWD);
  const [, payload] = t1.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  check("JWT de 8 horas por omision", claims.exp - claims.iat === 8 * 3600, `${(claims.exp - claims.iat) / 3600} h`);
  const cfg = (await api("GET", "/auth/config")).data;
  check("inactividad configurada: 30 minutos por omision", cfg?.sesion?.inactividad_min === 30, JSON.stringify(cfg?.sesion));
  const cerrar = await api("POST", "/auth/logout-all", {}, t1);
  const viejo1 = await api("GET", "/auth/me", undefined, t1);
  const viejo2 = await api("GET", "/auth/me", undefined, t2);
  check("cerrar sesion en todos los dispositivos: los tokens anteriores -> 401 sesion_revocada", cerrar.status === 200 && viejo1.status === 401 && viejo2.status === 401 && viejo2.data?.codigo === "sesion_revocada", `${cerrar.status} ${viejo1.status} ${viejo2.status}`);
  check("bitacora: cierre de sesiones", !!auditoria("cerrar_sesiones", u.email));
  const t3 = await token(u.email, PWD);
  await api("DELETE", `/admin/usuarios/${u.id}`, { motivo: "Baja de prueba de sesion" }, QA);
  const trasBaja = await api("GET", "/auth/me", undefined, t3);
  check("la baja cierra la sesion abierta (401)", trasBaja.status === 401, `${trasBaja.status}`);
  const reactivarSin = await api("PUT", `/admin/usuarios/${u.id}`, { nombre: "sesion prueba", email: u.email, activo: true }, QA, SIN_AUTO);
  const reactivar = await api("PUT", `/admin/usuarios/${u.id}`, { nombre: "sesion prueba", email: u.email, activo: true }, QA);
  check("reactivar una cuenta dada de baja exige reautenticacion (usuarios:reactivar)", reactivarSin.status === 401 && reactivarSin.data?.accion === "usuarios:reactivar" && reactivar.status === 200, `${reactivarSin.status} ${reactivar.status}`);
}

/* ================= 7. Contrasenas ================= */
{
  const u = await nuevo("clave", "Técnico Auxiliar");
  const t = await token(u.email, PWD);
  const mal = await api("POST", "/auth/password", { actual: "incorrecta-000", nueva: "OtraClave-2026-xyz" }, t);
  const corta = await api("POST", "/auth/password", { actual: PWD, nueva: "Corta-1" }, t);
  const igualCorreo = await api("POST", "/auth/password", { actual: PWD, nueva: u.email }, t);
  const igualNombre = await api("POST", "/auth/password", { actual: PWD, nueva: "clave prueba" }, t);
  const nueva = "OtraClave-2026-xyz";
  const ok = await api("POST", "/auth/password", { actual: PWD, nueva }, t);
  const viejo = await api("GET", "/auth/me", undefined, t);
  const conNueva = await login(u.email, nueva);
  check("cambio propio: pide la actual, minimo 10, distinta del correo y del nombre", mal.status >= 400 && corta.status === 400 && igualCorreo.status === 400 && igualNombre.status === 400, `${mal.status} ${corta.status} ${igualCorreo.status} ${igualNombre.status}`);
  check("cambio propio: cierra las demas sesiones y entra con la nueva", ok.status === 200 && !!ok.data?.token && viejo.status === 401 && conNueva.status === 200, `${ok.status} ${viejo.status} ${conNueva.status}`);
  const qaId = fila("SELECT id FROM usuarios WHERE email = 'qa@ficotox.local'")?.id;
  const propia = await api("PUT", `/admin/usuarios/${qaId}`, { nombre: "QA Ficotox", email: "qa@ficotox.local", activo: true, password: "Otra-Clave-QA-2026" }, QA, SIN_AUTO);
  const sigue = await login("qa@ficotox.local", QA_PWD);
  check("la propia contrasena no se cambia desde Administracion (400; solo en Mi cuenta con la actual)", propia.status === 400 && sigue.status === 200, `${propia.status} ${sigue.status}`);
  const reset = await api("POST", `/admin/usuarios/${u.id}/password`, { motivo: "Olvido su contrasena" }, QA);
  const temporalPwd = reset.data?.password_temporal;
  const tTemp = await token(u.email, temporalPwd);
  const bloqueada = await api("GET", "/samples/reception?search=", undefined, tTemp);
  const me = await api("GET", "/auth/me", undefined, tTemp);
  const cambio = await api("POST", "/auth/password", { actual: temporalPwd, nueva: "Definitiva-2026-abc" }, tTemp);
  const libre = await api("GET", "/samples/reception?search=", undefined, cambio.data?.token);
  check("restablecer (usuarios:G): contrasena temporal y cambio obligatorio al entrar", reset.status === 200 && String(temporalPwd || "").length >= 10 && bloqueada.status === 403 && bloqueada.data?.codigo === "cambiar_password" && me.data?.user?.debe_cambiar_password === true && cambio.status === 200 && libre.status === 200, `${reset.status} ${bloqueada.status} ${me.data?.user?.debe_cambiar_password} ${cambio.status} ${libre.status}`);
  const d = db();
  const texto = d.prepare("SELECT cambios_json, datos_anteriores_json, datos_nuevos_json FROM auditoria").all().map((r) => `${r.cambios_json}${r.datos_anteriores_json}${r.datos_nuevos_json}`).join("\n");
  const hashes = d.prepare("SELECT password_hash FROM usuarios WHERE password_hash IS NOT NULL").all().map((r) => r.password_hash);
  d.close();
  const fugas = [PWD, nueva, temporalPwd, "Definitiva-2026-abc", QA_PWD, "password_hash", ...hashes].filter((x) => x && texto.includes(x));
  check("bitacora sin contrasenas ni hashes", fugas.length === 0 && !!auditoria("cambiar_password", u.email) && !!auditoria("restablecer_password", u.email), `fugas=${fugas.length}`);
}

/* ================= 8. Secretos y CORS ================= */
{
  const dir = mkdtempSync(path.join(os.tmpdir(), "ficotox-secretos-"));
  const envVacio = path.join(dir, "vacio.env");
  writeFileSync(envVacio, "");
  const correr = (jwt) => spawnSync(process.execPath, [path.join(root, "scripts/start-ficotox.mjs")], { cwd: root, encoding: "utf8", timeout: 20_000, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "production", FICOTOX_ENV_FILE: envVacio, FICOTOX_OPEN_BROWSER: "false", PORT: "3199", // Fase 12: instancia, base y registros temporales (nunca instance/ real).
      SQLITE_PATH: path.join(dir, "ficotox.sqlite3"), FICOTOX_INSTANCE_DIR: dir, ...(jwt === undefined ? {} : { JWT_SECRET: jwt }) } });
  const porDefecto = correr("ficotox-jwt-secret");
  const corto = correr("corto-123");
  const falta = correr(undefined);
  check("produccion: no arranca con JWT_SECRET por defecto, corto o ausente (Fase 12: codigo 78, sin reintentos)", [porDefecto, corto, falta].every((r) => r.status === 78 && /JWT_SECRET/.test(`${r.stderr}${r.stdout}`)), [porDefecto, corto, falta].map((r) => `${r.status}`).join(" "));
  const { erroresSecretosProduccion } = await import("../src/lib/shared/secretos.mjs");
  check("validacion de secretos: 32+ caracteres aceptado; fuera de produccion no bloquea", erroresSecretosProduccion({ NODE_ENV: "production", JWT_SECRET: "x".repeat(32) }).length === 0 && erroresSecretosProduccion({ NODE_ENV: "development" }).length === 0);

  // Sin proxy de confianza, el lanzador fija la IP del socket: un X-Forwarded-For del cliente no se respeta.
  const eco = spawn(process.execPath, ["--import", pathToFileURL(path.join(root, "scripts/ip-real.mjs")).href, "--input-type=module", "-e", "import http from 'node:http'; http.createServer((q, r) => r.end(String(q.headers['x-forwarded-for']))).listen(3198, '127.0.0.1');"], { env: { PATH: process.env.PATH, TRUST_PROXY: "" } });
  let visto = "";
  for (let i = 0; i < 40 && !visto; i += 1) {
    await new Promise((r) => setTimeout(r, 150));
    visto = await fetch("http://127.0.0.1:3198/", { headers: { "X-Forwarded-For": "203.0.113.7" } }).then((r) => r.text()).catch(() => "");
  }
  eco.kill();
  check("sin proxy, la IP del bloqueo es la del socket (X-Forwarded-For del cliente ignorado)", visto === "127.0.0.1", visto);

  const cors = await fetch(`${BASE}/health`, { headers: { Origin: "http://otro-sitio.example" } });
  check("CORS por omision: mismo origen (sin Access-Control-Allow-Origin para otro sitio)", !cors.headers.get("access-control-allow-origin"), String(cors.headers.get("access-control-allow-origin")));

  const verificar = await api("GET", "/audit/verify", undefined, QA);
  check("la verificacion de la bitacora informa el origen de la llave (sin revelarla) y sigue en verde", verificar.data?.ok === true && ["SECRET_KEY", "auditoria.key"].includes(verificar.data?.llave?.origen), JSON.stringify(verificar.data?.llave));
}

const fallidas = results.filter((r) => !r.ok);
console.log(`\n${results.length - fallidas.length}/${results.length} pruebas de seguridad pasaron`);
process.exit(fallidas.length ? 1 : 0);
