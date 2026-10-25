/*
 * Prueba integral · Administración y transversal en pantalla (Playwright). Bugs corregidos en la prueba integral:
 * - una falla de red al refrescar la sesión (cada minuto o al volver a la ventana) cerraba la sesión y perdía lo capturado;
 *   solo un 401 del servidor lleva al acceso;
 * - sin roles, el enlace «Ayuda» del aviso volvía a pintar el aviso: la Ayuda no se podía leer;
 * - el interruptor «Usuario activo» daba de baja sin motivo (y a uno mismo); reactivar no pedía la contraseña en la hoja;
 * - «Mi cuenta» decía a toda cuenta temporal que lo capturado espera el visto bueno del supervisor;
 * - la píldora «Lecturas pendientes» del Inicio salía sin icono ni etiqueta corta;
 * - el diálogo de contraseña decía «realizar esta acción» al aprobar una solicitud;
 * - Ayuda: cargo predeterminado, reglas de contraseña, quién aprueba restaurar, avisos de respaldo.
 * Sin errores de consola ni respuestas 5xx.
 */
import "../lib/reauth-auto.mjs";

process.env.BASE = `${(process.env.BASE || "http://localhost:3100").replace(/\/api$/, "")}/api`;
const { abrirNavegador, BASE_WEB } = await import("../lib/navegador.mjs");
const { api, crearCheck, credenciales, Database, EMAIL, enDias, sesiones } = await import("../lib/calidad.mjs");
const { pdfConTexto } = await import("../lib/archivos.mjs");

const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const nav = await abrirNavegador({ suite: "integral-admin", check, credencial: (quien) => (typeof quien === "object" ? quien : { email: EMAIL[quien], password: credenciales[EMAIL[quien]] }) });
const { paso } = nav;
const s5 = Date.now().toString(36).slice(-5);
const SIN_APROBAR = { "X-Sin-Aprobar-Auto": "1" };
const ejecutar = (sql, ...p) => {
  const b = new Database(process.env.TEST_DB_PATH);
  b.prepare(sql).run(...p);
  b.close();
};
const roles = (await api("GET", "/admin/roles", undefined, t.qa)).data?.items || [];
const rolAuxiliar = roles.find((r) => r.nombre === "Técnico Auxiliar")?.id;

/* ---------- Datos ---------- */
const password = `Temporal-${s5}-2026`;
async function cuenta(nombre, extra = {}, headers = {}) {
  const email = `${nombre.toLowerCase().replace(/\s+/g, ".")}.${s5}@ficotox.local`;
  const r = await api("POST", "/admin/usuarios", { nombre: `${nombre} ${s5}`, email, activo: true, rol_id: rolAuxiliar, departamento: "Laboratorio", password, motivo: "Alta de la prueba integral", ...extra }, t.jorge, headers);
  // Sin el cambio obligatorio de contraseña para entrar directo con la temporal.
  ejecutar("UPDATE usuarios SET debe_cambiar_password = 0 WHERE email = ?", email);
  return { id: Number(r.data?.id), email, nombre: `${nombre} ${s5}`, status: r.status, solicitud: r.data?.solicitud };
}
// Sin roles: su rol inicial queda pendiente.
const sinRoles = await cuenta("Sin Roles", {}, SIN_APROBAR);
// Temporal sin alcance «supervisado» (Técnico Auxiliar), con una lectura pendiente.
const temporal = await cuenta("Temporal Auxiliar", { tipo_cuenta: "temporal", vigente_hasta: enDias(60), supervisor_id: id.ricardo, motivo_cuenta: "Estancia de la prueba integral" });
const fdD = new FormData();
for (const [k, v] of Object.entries({ clave: `FX-TCI-L${s5.toUpperCase()}`, titulo: `Instrucción por leer ${s5}`, area_codigo: "TC", tipo_codigo: "I", elaborador_id: id.luis, revisor_id: id.gabriela, autorizador_id: id.patricia })) fdD.append(k, String(v));
fdD.append("archivo_pdf", new Blob([await pdfConTexto(1, `Lectura ${s5}`)]), "lectura.pdf");
const D = (await api("POST", "/sgc/documentos", fdD, t.ana)).data;
await api("POST", `/sgc/revisiones/${D?.revision_id}/registrar-vigente`, { fecha_emision: "2025-01-10", fecha_proxima_revision: "2028-01-10" }, t.ana);
const dist = await api("POST", `/sgc/revisiones/${D?.revision_id}/distribucion`, { usuarios: [temporal.id], requiere_lectura: true, motivo: "Lectura de la prueba integral" }, t.ana);
// Inactiva, para reactivarla desde la hoja.
const inactiva = await cuenta("Para Reactivar");
const baja = await api("DELETE", `/admin/usuarios/${inactiva.id}`, { motivo: "Baja previa a la prueba" }, t.jorge);
// Una solicitud que Patricia puede aprobar.
const rolVacio = await api("POST", "/admin/roles", { nombre: `Consulta pantalla ${s5}`, motivo: "Rol de la prueba integral", permisos: [] }, t.jorge);
const porAprobar = await api("POST", `/admin/usuarios/${temporal.id}/roles`, { rol_id: rolVacio.data?.id, motivo: "Rol adicional de la prueba" }, t.jorge, SIN_APROBAR);
check("(preparación) cuentas, lectura y solicitud", sinRoles.status === 201 && temporal.status === 201 && dist.status < 300 && baja.status === 200 && porAprobar.status === 202, `${sinRoles.status} ${temporal.status} ${dist.status} ${baja.status} ${porAprobar.status} ${porAprobar.data?.message}`);

/* ---------- Sesión: falla de red y 401 ---------- */
await paso("luis", "sesión: una falla de red no la cierra", async (page) => {
  await page.goto(`${BASE_WEB}/`);
  const buscador = page.getByRole("combobox").first();
  await buscador.waitFor();
  await buscador.fill("texto capturado");
  await page.route("**/api/auth/me", (route) => route.abort("failed"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(2500);
  check("sin red al refrescar: sigue en la plataforma y conserva lo capturado", !new URL(page.url()).pathname.startsWith("/login") && (await buscador.inputValue()) === "texto capturado", page.url());
  await page.unroute("**/api/auth/me");
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "Tu sesión se cerró en otro equipo", codigo: "sesion_revocada" }) }));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForURL((url) => url.pathname.startsWith("/login"), { timeout: 15_000 });
  check("…un 401 del servidor sí lleva al acceso con el aviso", await page.getByText("Tu sesión se cerró en otro equipo").isVisible());
});

/* ---------- Sin roles: Ayuda ---------- */
await paso({ email: sinRoles.email, password }, "sin roles: la Ayuda se puede leer", async (page) => {
  const aviso = page.getByRole("heading", { name: "Sin permisos asignados" });
  await aviso.waitFor();
  await page.getByRole("link", { name: "Ayuda" }).click();
  await page.getByRole("heading", { name: "Cómo se usa FICOTOX" }).waitFor({ timeout: 15_000 });
  check("desde el aviso «Sin permisos» se abre la Ayuda (no vuelve al aviso)", (await aviso.count()) === 0);
  await page.getByRole("link", { name: "Volver" }).click();
  await aviso.waitFor();
  check("…y «Volver» regresa al aviso", true);
});

/* ---------- Usuarios: interruptor «Usuario activo» ---------- */
const editar = async (page, email) => {
  const fila = page.locator('[aria-label="Usuarios"] li').filter({ hasText: email }).first();
  await fila.waitFor();
  await fila.getByRole("button", { name: "Acciones" }).click();
  await page.getByRole("menuitem", { name: "Editar datos" }).click();
  await page.locator("#user-form").waitFor();
};
await paso("jorge", "usuarios: baja y reactivación desde la hoja", async (page) => {
  await page.goto(`${BASE_WEB}/administracion/usuarios`);
  await editar(page, EMAIL.jorge);
  check("en la propia cuenta no hay interruptor «Usuario activo»", (await page.getByRole("switch", { name: /Usuario activo/ }).count()) === 0);
  await page.keyboard.press("Escape");
  await page.locator("#user-form").waitFor({ state: "detached" });
  await page.getByPlaceholder("Buscar por nombre o correo").fill(inactiva.email);
  await editar(page, inactiva.email);
  await page.getByRole("switch", { name: /Usuario activo/ }).click();
  await page.locator("#u-motivo-estado").waitFor();
  check("reactivar desde la hoja pide motivo y la contraseña en la misma hoja", (await page.locator("#u-clave-admin").count()) === 1 && /reactivación/.test(await page.locator('label[for="u-motivo-estado"]').innerText()));
  await page.keyboard.press("Escape");
});

/* ---------- Cuenta temporal: Mi cuenta e Inicio ---------- */
await paso({ email: temporal.email, password }, "temporal: Mi cuenta e Inicio", async (page) => {
  const pildora = page.locator('ul[aria-label="Pendientes"] a').filter({ hasText: /lecturas pendientes/i });
  await pildora.waitFor({ timeout: 30_000 });
  check("la píldora «Lecturas pendientes» del Inicio lleva icono", (await pildora.locator("svg").count()) > 0);
  await page.getByRole("button", { name: "Menú de usuario" }).click();
  await page.getByRole("menuitem", { name: "Mi cuenta" }).click();
  const aviso = page.getByText(/Cuenta temporal/).first();
  await aviso.waitFor();
  check("una temporal sin alcance «supervisado» no ve «queda pendiente del visto bueno de tu supervisor»", !/visto bueno/.test(await aviso.innerText()), await aviso.innerText());
});

/* ---------- Diálogo de contraseña al aprobar ---------- */
await paso("patricia", "por autorizar: diálogo de contraseña", async (page) => {
  await page.goto(`${BASE_WEB}/solicitudes`);
  const fila = page.locator(`[data-solicitud="${porAprobar.data?.solicitud?.id}"]`);
  await fila.waitFor();
  await fila.click();
  await page.getByRole("dialog").getByRole("button", { name: "Aprobar", exact: true }).click();
  await page.locator("#ap-motivo").fill("Rol adicional revisado");
  await page.locator("#ap-password").fill("contraseña-equivocada");
  await page.getByRole("button", { name: "Aprobar y ejecutar" }).click();
  const dialogo = page.getByRole("dialog", { name: "Confirma tu identidad" });
  await dialogo.waitFor();
  check("el diálogo de contraseña nombra la acción: «aprobar una solicitud»", /aprobar una solicitud/.test(await dialogo.innerText()), (await dialogo.innerText()).slice(0, 160));
  await dialogo.getByRole("button", { name: "Cancelar" }).click();
});

/* ---------- Ayuda ---------- */
await paso("luis", "ayuda al día", async (page) => {
  await page.goto(`${BASE_WEB}/ayuda`);
  await page.getByText("Cómo se usa FICOTOX").waitFor();
  const texto = await page.locator("main").innerText();
  check("Ayuda: cargo predeterminado, reglas de contraseña, quién aprueba restaurar y aviso de 90 días", /cargo predeterminado/.test(texto) && /sin tu correo ni tu nombre/.test(texto) && /Responsable General o Mejora Continua/.test(texto) && /más de 90 días/.test(texto));
});

await nav.cerrar();
terminar();
