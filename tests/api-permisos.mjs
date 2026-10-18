/*
 * Se ejecuta DESPUES de reiniciar el servidor de pruebas, con la base que dejo
 * `api-sgc.mjs` (incluye el rol "Analista QA", con muestras V C E y nada mas).
 *
 * Comprueba que el arranque (`ensureRbacSchema`, que ya no rellena permisos)
 * no amplia por su cuenta lo que un rol puede hacer: un permiso ausente
 * significa "no concedido", no "pendiente de configurar".
 */
import "./lib/reauth-auto.mjs";
const BASE = process.env.BASE || "http://localhost:3100/api";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ""}`);
};

async function api(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

for (let i = 0; i < 60; i += 1) {
  try {
    const r = await fetch(`${BASE}/health`);
    if (r.ok) break;
  } catch {
    /* esperando */
  }
  await new Promise((r) => setTimeout(r, 1000));
}

const login = await api("POST", "/auth/login", { email: "analista@cicese.mx", password: "AnalistaQA2026!" });
const token = login.data?.token || "";
const permisos = login.data?.permissions || {};
check("login del rol limitado tras reiniciar", login.status === 200 && !!token, `status ${login.status}`);

const modulos = Object.keys(permisos).filter((clave) => Object.keys(permisos[clave] || {}).length);
const acciones = Object.keys(permisos.muestras || {}).sort().join(",");
check("el rol conserva solo muestras V C E", modulos.length === 1 && modulos[0] === "muestras" && acciones === "C,E,V", `modulos: ${modulos.join(", ") || "(ninguno)"} acciones muestras: ${acciones}`);

const negados = [
  ["/inventory/reactivos", "inventario"],
  ["/inventory/equipos", "equipos"],
  ["/samples/processing", "ensayos"],
  ["/admin/roles", "usuarios (roles)"],
  ["/admin/usuarios", "usuarios"],
  ["/informes", "informes"],
  ["/sgc/documentos", "documentos (Documentos SGC)"],
  ["/audit", "calidad (bitacora completa)"],
];
for (const [ruta, etiqueta] of negados) {
  const r = await api("GET", ruta, undefined, token);
  check(`${etiqueta}: sigue denegado tras el reinicio`, r.status === 403, `GET ${ruta} -> ${r.status}`);
}

const propias = await api("GET", "/samples/reception", undefined, token);
check("lo que si tenia concedido sigue funcionando", propias.status === 200, `GET /samples/reception -> ${propias.status}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} pruebas OK`);
process.exit(failed.length ? 1 : 0);
