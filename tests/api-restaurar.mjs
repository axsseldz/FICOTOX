/*
 * Restaurar un respaldo desde la plataforma (Calidad › Respaldos), contra el
 * servidor de prueba (instance/test; respaldos en instance/test/backups).
 * - Permisos: solo respaldos:G pide la restauracion (403 a los demas); motivo
 *   obligatorio; contrasena incorrecta; nadie aprueba su propia solicitud.
 * - Respaldo recien creado con todos los anteriores borrados: se pide, otra
 *   persona (Responsable General) aprueba, la API deja de atender mientras dura
 *   (503 "restaurando"), el dato vuelve a como estaba, hay un respaldo «Previo a
 *   restauración», la bitacora queda integra con la entrada de la restauracion
 *   (quien la pidio, quien la aprobo, desde que respaldo y el motivo), se cerraron
 *   todas las sesiones y «Probar restauración» sigue funcionando.
 * - Respaldo danado: no se reemplaza nada y la solicitud termina «fallida».
 * Corre despues de las demas suites de API que dependen de sus datos: la base
 * vuelve a como estaba al crear el respaldo de esta suite (solo pierde lo que
 * esta suite hizo despues) y se cierran todas las sesiones.
 */
import "./lib/reauth-auto.mjs";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { RUTA_BASE } from "../src/lib/shared/respaldo.mjs";

const BASE = process.env.BASE || "http://localhost:3100/api";
const TEST_DB = process.env.TEST_DB_PATH;
const TEST_DIR = path.dirname(TEST_DB || "");
if (!TEST_DB || !TEST_DIR.includes(`${path.sep}instance${path.sep}test`)) {
  console.error("api-restaurar.mjs solo corre contra la base de prueba (instance/test)");
  process.exit(1);
}
const BACKUPS = process.env.FICOTOX_BACKUP_DIR || path.join(TEST_DIR, "backups");
const Database = createRequire(import.meta.url)(process.env.BETTER_SQLITE3);
const credenciales = JSON.parse(fs.readFileSync(process.env.CREDENCIALES_ROLES, "utf8"));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
async function api(method, ruta, body, token, headers = {}) {
  const res = await fetch(`${BASE}${ruta}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get("content-type") || "";
  return { status: res.status, data: type.includes("json") ? await res.json().catch(() => null) : await res.text() };
}
const login = async (email, password = credenciales[email]) => (await api("POST", "/auth/login", { email, password })).data?.token;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const SIN_APROBAR = { "X-Sin-Aprobar-Auto": "1" };
const JORGE = "jorge.ramirez@ficotox.local";
const PATRICIA = "patricia.luna@ficotox.local";

/* Espera a que termine el respaldo o la prueba en curso (GET /respaldos/estado). */
async function esperarTrabajo(token, tipo) {
  for (let i = 0; i < 240; i += 1) {
    const t = (await api("GET", "/respaldos/estado", undefined, token)).data?.trabajo;
    if (t && t.tipo === tipo && t.estado !== "en_curso") return t;
    await espera(500);
  }
  return null;
}
async function crearRespaldo(token, etiqueta) {
  const r = await api("POST", "/respaldos", { etiqueta }, token);
  const t = r.status === 202 ? await esperarTrabajo(token, "respaldo") : null;
  return t?.estado === "terminado" ? t.respaldo_id : null;
}
/*
 * Espera a que termine una restauracion aprobada: mientras dura la API responde 503
 * "restaurando" (tambien el acceso). Al terminar entra de nuevo y lee el trabajo.
 */
async function esperarRestauracion() {
  let vio503 = false;
  for (let i = 0; i < 480; i += 1) {
    const salud = await api("GET", "/health");
    if (salud.status === 503 && salud.data?.codigo === "restaurando") vio503 = true;
    else if (salud.status === 200) {
      const t = await login(JORGE);
      const trabajo = t ? (await api("GET", "/respaldos/estado", undefined, t)).data?.trabajo : null;
      if (trabajo?.tipo === "restauracion" && trabajo.estado !== "en_curso") return { trabajo, vio503, token: t };
    }
    await espera(250);
  }
  return { trabajo: null, vio503, token: null };
}
const nombreReactivo = (id) => {
  const db = new Database(TEST_DB, { readonly: true, fileMustExist: true });
  try {
    return db.prepare("SELECT nombre FROM reactivos WHERE id = ?").get(id)?.nombre ?? null;
  } finally {
    db.close();
  }
};

const QA = await login("qa@ficotox.local", "QaFicotox2026!");
let tJ = await login(JORGE);
let tP = await login(PATRICIA);
const reactivo = ((await api("GET", "/inventory/reactivos", undefined, QA)).data?.items || [])[0];
check("datos: hay un reactivo para editar", !!reactivo?.id, String(reactivo?.id));
const nombreOriginal = reactivo?.nombre;

/* ---------- Respaldo recien creado, con todos los anteriores borrados ---------- */
for (const nombre of fs.existsSync(BACKUPS) ? fs.readdirSync(BACKUPS) : []) fs.rmSync(path.join(BACKUPS, nombre), { recursive: true, force: true });
const respaldo = await crearRespaldo(tJ, "Antes de editar el reactivo");
check("se crea un respaldo desde la pantalla con la carpeta de respaldos vacía", !!respaldo, String(respaldo));
const instanteRespaldo = Date.now();

/* ---------- Rechazos ---------- */
{
  const lista = (await api("GET", "/respaldos", undefined, tP)).data;
  const rP = await api("POST", `/respaldos/${respaldo}/restaurar`, { motivo: "Patricia no puede pedirla" }, tP, SIN_APROBAR);
  const rQ = await api("POST", `/respaldos/${respaldo}/restaurar`, { motivo: "QA no puede pedirla" }, QA, SIN_APROBAR);
  check("sin respaldos:G no se puede pedir la restauración (403) y la pantalla no ofrece gestionar", rP.status === 403 && rQ.status === 403 && lista?.puede_gestionar === false, `${rP.status} ${rQ.status} ${lista?.puede_gestionar}`);
  const sinMotivo = await api("POST", `/respaldos/${respaldo}/restaurar`, { motivo: "  " }, tJ, SIN_APROBAR);
  const corto = await api("POST", `/respaldos/${respaldo}/restaurar`, { motivo: "abc" }, tJ, SIN_APROBAR);
  check("sin motivo (o muy corto) se rechaza con 400", sinMotivo.status === 400 && corto.status === 400, `${sinMotivo.status} ${corto.status}`);
  const sinReauth = await api("POST", `/respaldos/${respaldo}/restaurar`, { motivo: "Motivo de la prueba" }, tJ, { ...SIN_APROBAR, "X-Sin-Reauth-Auto": "1" });
  const mala = await api("POST", "/auth/reauth", { accion: "respaldos:restaurar", password: "contraseña-incorrecta" }, tJ);
  const conMala = await api("POST", `/respaldos/${respaldo}/restaurar`, { motivo: "Motivo de la prueba" }, tJ, { ...SIN_APROBAR, "X-Sin-Reauth-Auto": "1", "X-Reauth": "token-falso" });
  check("sin confirmar la contraseña o con una incorrecta no se crea la solicitud (401)", sinReauth.status === 401 && sinReauth.data?.codigo === "reauth_required" && mala.status === 401 && conMala.status === 401, `${sinReauth.status} ${mala.status} ${conMala.status}`);
  const noExiste = await api("POST", "/respaldos/20000101-000000/restaurar", { motivo: "Respaldo que no existe" }, tJ, SIN_APROBAR);
  check("un respaldo que no existe responde 404", noExiste.status === 404, `${noExiste.status}`);
  const pendientes = ((await api("GET", "/solicitudes?estado=pendiente", undefined, tJ)).data?.items || []).filter((s) => s.tipo === "restaurar_respaldo");
  check("ningún rechazo dejó una solicitud de restauración", pendientes.length === 0, `${pendientes.length}`);
}

/* ---------- Se edita un dato despues del respaldo ---------- */
const nuevoNombre = `${nombreOriginal} (editado tras el respaldo)`;
{
  const r = await api("PUT", `/inventory/reactivos/${reactivo.id}`, { producto: nuevoNombre, nombre: nuevoNombre }, QA);
  check("se renombra el reactivo después del respaldo", r.status === 200 && nombreReactivo(reactivo.id) === nuevoNombre, `${r.status} ${nombreReactivo(reactivo.id)}`);
}

/* ---------- Solicitud, autoaprobacion rechazada y aprobacion ---------- */
const motivo = "Prueba: volver al estado del respaldo";
let solicitud = null;
{
  const r = await api("POST", `/respaldos/${respaldo}/restaurar`, { motivo }, tJ, SIN_APROBAR);
  solicitud = r.data?.solicitud;
  check("el administrador técnico pide la restauración: 202 con la solicitud pendiente", r.status === 202 && solicitud?.tipo === "restaurar_respaldo" && solicitud?.estado === "pendiente", `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  const porAutorizar = ((await api("GET", "/solicitudes?estado=pendiente", undefined, tP)).data?.items || []).find((s) => s.id === solicitud?.id);
  check("aparece en «Por autorizar» de la Responsable General, que la puede aprobar", !!porAutorizar && porAutorizar.puedo_aprobar === true, JSON.stringify(porAutorizar || {}).slice(0, 120));
  const propia = await api("POST", `/solicitudes/${solicitud?.id}/aprobar`, { motivo: "Me la apruebo yo" }, tJ);
  check("quien la pidió no la puede aprobar (409 segregación)", propia.status === 409 && propia.data?.codigo === "segregacion", `${propia.status} ${propia.data?.codigo}`);
  const sinMotivoAprobar = await api("POST", `/solicitudes/${solicitud?.id}/aprobar`, { motivo: "" }, tP);
  check("aprobar también exige motivo", sinMotivoAprobar.status === 400, `${sinMotivoAprobar.status}`);
}

const auditoriaAntes = (() => {
  const db = new Database(TEST_DB, { readonly: true, fileMustExist: true });
  try {
    return Number(db.prepare("SELECT MAX(id) AS id FROM auditoria").get().id);
  } finally {
    db.close();
  }
})();
const tokensViejos = { jorge: tJ, patricia: tP, qa: QA };
{
  const r = await api("POST", `/solicitudes/${solicitud?.id}/aprobar`, { motivo: "Autorizo volver al respaldo" }, tP);
  check("la Responsable General aprueba: la restauración queda programada", r.status === 200 && r.data?.resultado?.programada === true, `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  const { trabajo, vio503, token } = await esperarRestauracion();
  check("mientras se restaura la API responde 503 «restaurando»", vio503);
  check("la restauración terminó bien", trabajo?.estado === "terminado" && trabajo?.resultado === "aprobada", JSON.stringify(trabajo || {}).slice(0, 200));
  tJ = token;
}

/* ---------- Despues de restaurar ---------- */
{
  check("el dato volvió a como estaba en el respaldo", nombreReactivo(reactivo.id) === nombreOriginal, `${nombreReactivo(reactivo.id)}`);
  const viejos = await Promise.all(Object.values(tokensViejos).map((t) => api("GET", "/auth/me", undefined, t)));
  check("se cerraron todas las sesiones (los tokens de antes responden 401 sesión revocada)", viejos.every((r) => r.status === 401 && r.data?.codigo === "sesion_revocada"), viejos.map((r) => r.status).join(" "));
  tP = await login(PATRICIA);
  const qa = await login("qa@ficotox.local", "QaFicotox2026!");
  check("todos pueden volver a iniciar sesión", !!tJ && !!tP && !!qa);
  const lista = (await api("GET", "/respaldos", undefined, tJ)).data?.respaldos || [];
  const previo = lista.find((r) => r.tipo === "pre_restauracion" && Date.parse(r.creado_en) >= instanteRespaldo - 1000);
  check("existe el respaldo «Previo a restauración» de lo que había", !!previo, lista.map((r) => `${r.id}:${r.tipo}`).join(", "));
  const verify = await api("GET", "/audit/verify", undefined, tP);
  check("la bitácora quedó íntegra (/api/audit/verify OK)", verify.status === 200 && verify.data?.ok === true, `${verify.status} ${JSON.stringify(verify.data).slice(0, 160)}`);
  const db = new Database(TEST_DB, { readonly: true, fileMustExist: true });
  let entrada = null;
  let integridad = null;
  let solicitudFila = null;
  try {
    entrada = db.prepare("SELECT * FROM auditoria WHERE accion = 'restaurar_respaldo' ORDER BY id DESC LIMIT 1").get();
    integridad = db.pragma("integrity_check", { simple: true });
    solicitudFila = db.prepare("SELECT id FROM solicitudes_autorizacion WHERE id = ? AND tipo = 'restaurar_respaldo'").get(solicitud?.id);
  } finally {
    db.close();
  }
  const detalle = JSON.parse(entrada?.cambios_json || entrada?.datos_nuevos_json || "{}");
  const nombre = (email) => email.split("@")[0].split(".")[0];
  const texto = JSON.stringify(detalle).toLowerCase();
  check(
    "la entrada de la restauración dice quién la pidió, quién la aprobó, desde qué respaldo y el motivo",
    !!entrada && entrada.entidad_id === respaldo && texto.includes(nombre(JORGE)) && texto.includes(nombre(PATRICIA)) && String(entrada.motivo || "").includes(motivo),
    `${entrada?.entidad_id} ${String(entrada?.motivo || "").slice(0, 80)} ${texto.slice(0, 200)}`,
  );
  check("la base restaurada es la del respaldo: la entrada sigue a las del respaldo (no a las de después)", !!entrada && Number(entrada.id) <= auditoriaAntes + 5, `${entrada?.id} vs ${auditoriaAntes}`);
  check("la base restaurada está sana (integrity_check ok) y la solicitud, posterior al respaldo, ya no existe", integridad === "ok" && !solicitudFila, `${integridad} ${JSON.stringify(solicitudFila)}`);
  // «Probar restauración» sigue funcionando, con el respaldo usado y con el previo (para poder volver atrás).
  for (const [etq, id] of [["el respaldo restaurado", respaldo], ["el respaldo «Previo a restauración»", previo?.id]]) {
    const p = await api("POST", `/respaldos/${id}/probar`, {}, tJ);
    const t = p.status === 202 ? await esperarTrabajo(tJ, "prueba") : null;
    check(`«Probar restauración» sigue funcionando con ${etq}`, t?.resultado === "aprobada", `${p.status} ${JSON.stringify(t?.pasos?.filter((x) => !x.ok) || p.data).slice(0, 200)}`);
  }
}

/* ---------- Respaldo danado: no se reemplaza nada ---------- */
{
  const danado = await crearRespaldo(tJ, "Respaldo que se va a dañar");
  check("se crea el respaldo que se va a dañar", !!danado);
  const editado = `${nombreOriginal} (después del respaldo dañado)`;
  await api("PUT", `/inventory/reactivos/${reactivo.id}`, { producto: editado, nombre: editado }, await login("qa@ficotox.local", "QaFicotox2026!"));
  // Se altera la base dentro del respaldo: la verificacion 1 (SHA-256) falla.
  fs.appendFileSync(path.join(BACKUPS, danado, RUTA_BASE), Buffer.from("alterado"));
  const previos = ((await api("GET", "/respaldos", undefined, tJ)).data?.respaldos || []).filter((r) => r.tipo === "pre_restauracion").length;
  const r = await api("POST", `/respaldos/${danado}/restaurar`, { motivo: "Restaurar un respaldo dañado" }, tJ, SIN_APROBAR);
  const sol = r.data?.solicitud;
  const ap = await api("POST", `/solicitudes/${sol?.id}/aprobar`, { motivo: "Autorizo la prueba del dañado" }, tP);
  check("se pide y se aprueba la restauración del respaldo dañado", r.status === 202 && ap.status === 200, `${r.status} ${ap.status}`);
  const { trabajo } = await esperarRestauracion();
  check("la restauración del respaldo dañado falla", trabajo?.estado === "fallido" && /no se restauró nada/i.test(String(trabajo?.mensaje || "")), JSON.stringify(trabajo || {}).slice(0, 200));
  check("no se reemplazó nada: el dato editado sigue igual", nombreReactivo(reactivo.id) === editado, `${nombreReactivo(reactivo.id)}`);
  const ahoraP = await api("GET", "/auth/me", undefined, tP);
  check("no se cerraron las sesiones", ahoraP.status === 200, `${ahoraP.status}`);
  const despues = ((await api("GET", "/respaldos", undefined, tJ)).data?.respaldos || []).filter((r) => r.tipo === "pre_restauracion").length;
  check("no se creó otro respaldo «Previo a restauración»", despues === previos, `${previos} -> ${despues}`);
  const fila = (await api("GET", `/solicitudes?estado=todas`, undefined, tJ)).data?.items?.find((s) => s.id === sol?.id);
  check("la solicitud terminó «fallida» con la razón", fila?.estado === "fallida" && /no se restauró nada/i.test(String(fila?.motivo_resolucion || "")), JSON.stringify(fila || {}).slice(0, 200));
  const db = new Database(TEST_DB, { readonly: true, fileMustExist: true });
  try {
    const e = db.prepare("SELECT accion FROM auditoria WHERE accion = 'restauracion_fallida' ORDER BY id DESC LIMIT 1").get();
    check("la restauración fallida queda en la bitácora", !!e);
  } finally {
    db.close();
  }
  const verify = await api("GET", "/audit/verify", undefined, tP);
  check("la bitácora sigue íntegra tras el intento fallido", verify.status === 200 && verify.data?.ok === true, `${verify.status}`);
  // El reactivo vuelve a su nombre (no afecta a otras suites).
  await api("PUT", `/inventory/reactivos/${reactivo.id}`, { producto: nombreOriginal, nombre: nombreOriginal }, await login("qa@ficotox.local", "QaFicotox2026!"));
}

const fallas = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fallas}/${results.length} comprobaciones de restauración desde la plataforma`);
process.exit(fallas ? 1 : 0);
