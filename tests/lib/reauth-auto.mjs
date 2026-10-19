/*
 * Reautenticacion y segundo usuario automaticos para las suites de API.
 *
 * Fase 2: las acciones criticas exigen el encabezado X-Reauth con un token de un
 * solo uso. Este modulo envuelve `fetch`:
 *  - recuerda la contrasena de cada token emitido por /auth/login (y por
 *    /auth/password, que devuelve una sesion nueva);
 *  - si una respuesta es 401 `reauth_required`, pide el token a /auth/reauth con
 *    esa contrasena y repite la peticion con X-Reauth.
 * Fase 3: algunas acciones (anular fuera de borrador, asignar roles, reactivar,
 * ampliar vigencia, alta de usuario con rol inicial) ya no se ejecutan: crean una
 * solicitud de autorizacion (respuesta con `solicitud.estado = "pendiente"`).
 * Para que las suites anteriores sigan probando el efecto de la accion, el
 * envoltorio la aprueba con un SEGUNDO usuario distinto del solicitante (lee
 * CREDENCIALES_ROLES: Responsable General primero, luego Mejora Continua,
 * luego QA) y devuelve una respuesta 200 con el resultado de la ejecucion
 * (`resultado`) fusionado, mas la `solicitud` aprobada.
 * Fase 10: si enviar un analisis a revision responde 409 `evidencia_requerida`,
 * adjunta un cromatograma PDF de prueba con el mismo usuario y repite el envio.
 * Correcciones V1 (R10): una cuenta creada por la API (o restablecida) entra con
 * cambio de contrasena obligatorio. Si /auth/login responde con
 * `debe_cambiar_password`, el envoltorio la cambia a otra y de vuelta a la misma
 * (la contrasena de la prueba no cambia) y devuelve la sesion ya sin el cambio
 * pendiente.
 * Encabezados de control (se quitan antes de enviar):
 *  - `X-Sin-Reauth-Auto: 1`: no reintenta la reautenticacion (para probar el 401).
 *  - `X-Sin-Aprobar-Auto: 1`: no aprueba la solicitud (para probar el flujo).
 *  - `X-Sin-Evidencia-Auto: 1`: no adjunta evidencia (para probar el 409).
 *  - `X-Sin-Cambio-Auto: 1`: no cambia la contrasena temporal (para probar R10).
 * Importarlo al inicio de cada suite: `import "./lib/reauth-auto.mjs";`
 */
import { readFileSync } from "node:fs";
import { adjuntarEvidencia } from "./evidencia.mjs";

const original = globalThis.fetch;
const passwords = new Map();
const tokensPorEmail = new Map();

const tokenDe = (headers) => {
  const auth = headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
};

/* Aprobadores candidatos (correo -> contrasena), en orden de preferencia. */
function aprobadores() {
  const out = [];
  try {
    const cred = JSON.parse(readFileSync(process.env.CREDENCIALES_ROLES, "utf8"));
    for (const email of ["patricia.luna@ficotox.local", "ana.torres@ficotox.local"]) if (cred[email]) out.push([email, cred[email]]);
  } catch {
    /* sin archivo de credenciales */
  }
  out.push(["qa@ficotox.local", "QaFicotox2026!"]);
  return out;
}

async function reauthToken(base, token, password, accion, headers) {
  const r = await original(`${base}auth/reauth`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(headers?.get("x-forwarded-for") ? { "X-Forwarded-For": headers.get("x-forwarded-for") } : {}) }, body: JSON.stringify({ accion, password }) });
  const data = await r.json().catch(() => null);
  return r.ok && data?.token ? data.token : null;
}

async function sesionDe(base, email, password) {
  const previa = tokensPorEmail.get(email);
  if (previa) {
    const me = await original(`${base}auth/me`, { headers: { Authorization: `Bearer ${previa}` } });
    if (me.ok) return previa;
  }
  const r = await original(`${base}auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data?.token) return null;
  tokensPorEmail.set(email, data.token);
  passwords.set(data.token, password);
  return data.token;
}

/* Aprueba la solicitud con un segundo usuario que no sea el solicitante; devuelve la respuesta de /aprobar o null. */
async function aprobar(base, solicitud) {
  for (const [email, password] of aprobadores()) {
    const token = await sesionDe(base, email, password);
    if (!token) continue;
    const reauth = await reauthToken(base, token, password, "solicitudes:aprobar");
    if (!reauth) continue;
    const r = await original(`${base}solicitudes/${solicitud.id}/aprobar`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Reauth": reauth }, body: JSON.stringify({ motivo: "Aprobación automática de la suite de pruebas (segundo usuario)" }) });
    const data = await r.json().catch(() => null);
    if (r.ok) return data;
    // 409 segregacion = este aprobador es el solicitante; 403 = sin permiso: probar con el siguiente.
    if (![403, 409].includes(r.status)) return null;
  }
  return null;
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const headers = new Headers(init.headers || {});
  const sinAuto = headers.get("x-sin-reauth-auto") === "1";
  const sinAprobar = headers.get("x-sin-aprobar-auto") === "1";
  const sinEvidencia = headers.get("x-sin-evidencia-auto") === "1";
  const sinCambio = headers.get("x-sin-cambio-auto") === "1";
  headers.delete("x-sin-cambio-auto");
  headers.delete("x-sin-reauth-auto");
  headers.delete("x-sin-aprobar-auto");
  headers.delete("x-sin-evidencia-auto");
  let res = await original(input, { ...init, headers });
  const envio = /\/api\/samples\/analysis\/(\d+)\/enviar-revision$/.exec(url);
  if (envio && res.status === 409 && !sinEvidencia) {
    const data = await res.clone().json().catch(() => null);
    const token = tokenDe(headers);
    if (data?.codigo === "evidencia_requerida" && token) {
      const extra = {};
      for (const h of ["x-forwarded-for", "x-actuar-como"]) if (headers.get(h)) extra[h] = headers.get(h);
      const subida = await adjuntarEvidencia(url.slice(0, url.indexOf("/api/") + 5), token, Number(envio[1]), { headers: extra, fetchFn: original });
      if (subida.ok) res = await original(input, { ...init, headers });
    }
  }
  if (/\/api\/auth\/login$/.test(url) && res.ok && !sinCambio) {
    const data = await res.clone().json().catch(() => null);
    const pendiente = data?.debe_cambiar_password ?? data?.user?.debe_cambiar_password;
    const body = (() => {
      try {
        return JSON.parse(String(init.body || "{}"));
      } catch {
        return {};
      }
    })();
    if (pendiente && data?.token && body.password) {
      const cambiar = (token, actual, nueva) => original(url.replace(/login$/, "password"), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ actual, nueva }) });
      const intermedia = `${body.password}·Cambio-1`;
      const paso1 = await cambiar(data.token, body.password, intermedia);
      const t1 = paso1.ok ? (await paso1.json().catch(() => null))?.token : null;
      const paso2 = t1 ? await cambiar(t1, intermedia, body.password) : null;
      if (paso2?.ok) res = paso2;
    }
  }
  const esLogin = /\/api\/auth\/(login|password)$/.test(url) && String(init.method || "GET").toUpperCase() === "POST";
  if (esLogin && res.ok) {
    try {
      const body = JSON.parse(String(init.body || "{}"));
      const data = await res.clone().json();
      const pwd = url.endsWith("/password") ? body.nueva : body.password;
      if (data?.token && pwd) {
        passwords.set(data.token, pwd);
        if (body.email) tokensPorEmail.set(String(body.email).toLowerCase(), data.token);
      }
    } catch {
      /* sin JSON */
    }
  }
  const base = url.includes("/api/") ? url.slice(0, url.indexOf("/api/") + 5) : null;
  if (res.status === 401 && !sinAuto && base) {
    const data = await res.clone().json().catch(() => null);
    if (data?.codigo === "reauth_required") {
      const token = tokenDe(headers);
      const password = token ? passwords.get(token) : null;
      if (password) {
        const reauth = await reauthToken(base, token, password, data.accion, headers);
        if (reauth) {
          headers.set("X-Reauth", reauth);
          res = await original(input, { ...init, headers });
        }
      }
    }
  }
  if (sinAprobar || !base || !res.ok) return res;
  const data = await res.clone().json().catch(() => null);
  if (data?.solicitud?.estado !== "pendiente") return res;
  const aprobada = await aprobar(base, data.solicitud);
  if (!aprobada) return res;
  const resultado = aprobada.resultado || {};
  const cuerpo = { ...resultado, ...data, message: aprobada.message, solicitud: aprobada.solicitud, aprobada_automaticamente: true };
  // Asignar un rol respondia 201 con el id de la asignacion; las demas acciones, 200.
  if (data.solicitud.tipo === "asignar_rol" && cuerpo.id === undefined && resultado.asignacion_id !== undefined) cuerpo.id = resultado.asignacion_id;
  const status = res.status === 202 ? (data.solicitud.tipo === "asignar_rol" ? 201 : 200) : res.status;
  return new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
};
