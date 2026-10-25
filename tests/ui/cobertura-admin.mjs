/*
 * Cobertura · Administración, acceso/sesión y transversal en pantalla (Playwright): los elementos de interfaz
 * de la matriz que no tenían prueba automática. Cada check lleva su etiqueta [cob:A:<id>] (las secciones de la
 * Ayuda, [cob:A:ayuda-<ancla>]). Solo actúan cuentas propias (nombres únicos) creadas por la API; las compartidas
 * no cambian (Ricardo solo consulta). Al final las solicitudes propias se rechazan, las cuentas propias quedan de
 * baja y los roles propios inactivos. Sin errores de consola ni respuestas 5xx.
 */
import "../lib/reauth-auto.mjs";
import { createRequire } from "node:module";

process.env.BASE = `${(process.env.BASE || "http://localhost:3100").replace(/\/api$/, "")}/api`;
const { abrirNavegador, BASE_WEB, contrasena, entendido, esperar, toast } = await import("../lib/navegador.mjs");
const { api, crearCheck, credenciales, Database, EMAIL, enDias, fila, filas, hoy, sesiones } = await import("../lib/calidad.mjs");

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const nav = await abrirNavegador({ suite: "cobertura-admin", check, credencial: (quien) => (typeof quien === "object" ? quien : { email: EMAIL[quien], password: credenciales[EMAIL[quien]] }) });
const { paso } = nav;
const s5 = Date.now().toString(36).slice(-5);
const PASS = `Temporal-${s5}-2026`;
const SIN_APROBAR = { "X-Sin-Aprobar-Auto": "1" };
const fmt = (iso) => String(iso).split("-").reverse().join("/");
const ejecutar = (sql, ...p) => {
  const b = new Database(process.env.TEST_DB_PATH);
  try {
    b.prepare(sql).run(...p);
  } finally {
    b.close();
  }
};
const roles = (await api("GET", "/admin/roles", undefined, t.qa)).data?.items || [];
const rol = (clave) => roles.find((r) => r.clave === clave);
const usuario = (idu) => fila("SELECT * FROM usuarios WHERE id = ?", idu);

/* ---------- Cuentas y roles propios (API) ---------- */
const creadas = [];
const rolesPropios = [];
async function cuenta(nombre, { rolClave = "tecnico_auxiliar", extra = {}, headers = {} } = {}) {
  const email = `cob.ui.${nombre.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.${s5}@ficotox.local`;
  const r = await api("POST", "/admin/usuarios", { nombre: `Cob UI ${nombre} ${s5}`, email, activo: true, rol_id: rol(rolClave)?.id, departamento: "Laboratorio", password: PASS, motivo: "Alta de la prueba de cobertura", ...extra }, t.jorge, headers);
  const idc = Number(r.data?.id) || Number(fila("SELECT id FROM usuarios WHERE email = ?", email)?.id) || null;
  if (idc) {
    // Sin el cambio obligatorio de contraseña para entrar directo con la temporal.
    ejecutar("UPDATE usuarios SET debe_cambiar_password = 0 WHERE id = ?", idc);
    creadas.push(idc);
  }
  return { id: idc, email, password: PASS, nombre: `Cob UI ${nombre} ${s5}`, status: r.status };
}
async function rolPropio(nombre) {
  const r = await api("POST", "/admin/roles", { nombre: `Cob UI ${nombre} ${s5}`, descripcion: "Rol de la prueba de cobertura", motivo: "Rol de la prueba de cobertura", permisos: [] }, t.jorge);
  if (r.data?.id) rolesPropios.push(Number(r.data.id));
  return { id: Number(r.data?.id), nombre: `Cob UI ${nombre} ${s5}`, status: r.status };
}
const asignar = (idu, rid, extra = {}) => api("POST", `/admin/usuarios/${idu}/roles`, { rol_id: rid, motivo: "Asignación de la prueba de cobertura", ...extra }, t.jorge);
const asignacion = (idu, rid) => fila("SELECT * FROM usuario_roles WHERE usuario_id = ? AND rol_id = ? ORDER BY id DESC LIMIT 1", idu, rid);

const UA = await cuenta("Admin", { rolClave: "admin_tecnico" });
const UC = await cuenta("Campana", { extra: { tipo_cuenta: "temporal", vigente_desde: hoy(), vigente_hasta: enDias(3), supervisor_id: id.ricardo, motivo_cuenta: "Estancia de la prueba de cobertura" } });
const UH = await cuenta("Historial");
const UN = await cuenta("Sin Roles", { headers: SIN_APROBAR });
const UFut = await cuenta("Futura", { extra: { vigente_desde: enDias(10), motivo_cuenta: "Empieza más adelante" } });
const UR = await cuenta("Restablecer");
const UF = await cuenta("Con Foto");
const [Rextra, Rfut, Rrev, Rter, Rasig, Rperm, Reditar, Rinact] = [await rolPropio("Extra"), await rolPropio("Futuro"), await rolPropio("Revocado"), await rolPropio("Terminado"), await rolPropio("Asignable"), await rolPropio("Permisos"), await rolPropio("Editar"), await rolPropio("Inactivo")];
const prep = [UA, UC, UH, UN, UFut, UR, UF].map((c) => c.status).concat([Rextra, Rfut, Rrev, Rter, Rasig, Rperm, Reditar, Rinact].map((r) => r.status));
// Autorizaciones de Ricardo que vencen pronto (la campana de la cuenta temporal).
const aut = [];
for (const clave of ["recepcion", "procesamiento"]) aut.push((await api("POST", `/admin/usuarios/${UC.id}/autorizaciones`, { tipo: "actividad", clave, vigente_hasta: enDias(3), motivo: "Autorización de la prueba de cobertura" }, t.ricardo)).status);
// Historial de roles: vigente, por comenzar, revocado y terminado.
const aExtra = await asignar(UH.id, Rextra.id);
const aFut = await asignar(UH.id, Rfut.id, { vigente_desde: enDias(5) });
const aRev = await asignar(UH.id, Rrev.id);
const asigRev = asignacion(UH.id, Rrev.id);
const revoca = await api("POST", `/admin/usuarios/${UH.id}/roles/${asigRev?.id}/revocar`, { motivo: "Termina la prueba de cobertura" }, t.jorge);
const aTer = await asignar(UH.id, Rter.id);
// Una asignación ya terminada no se puede crear por la API (la vigencia empieza hoy o después): se fecha en el pasado.
ejecutar("UPDATE usuario_roles SET vigente_desde = ?, vigente_hasta = ? WHERE id = ?", enDias(-10), enDias(-1), asignacion(UH.id, Rter.id)?.id);
// Una cuenta heredada sin contraseña tampoco se puede crear por la API.
ejecutar("UPDATE usuarios SET password_hash = NULL WHERE id = ?", UN.id);
// Foto de perfil propia (para «Quitar foto de perfil…»).
const tokenF = (await api("POST", "/auth/login", { email: UF.email, password: PASS })).data?.token;
const fd = new FormData();
fd.append("archivo", new Blob([await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 40, g: 120, b: 90 } } }).jpeg().toBuffer()], { type: "image/jpeg" }), "foto.jpg");
const foto = await api("POST", "/auth/me/foto", fd, tokenF);
// Rol inactivo (filtro «Inactivos»).
const inact = await api("PUT", `/admin/roles/${Rinact.id}`, { nombre: Rinact.nombre, descripcion: "Rol de la prueba de cobertura", activo: false, permisos: [], motivo: "Rol inactivo de la prueba" }, t.jorge);
check(
  "(preparación) cuentas, roles, autorizaciones, historial y foto propios",
  prep.every((st) => st === 201) && aut.every((st) => st === 201) && [aExtra, aFut, aRev, aTer].every((r) => r.status < 300) && revoca.status === 200 && foto.status === 200 && inact.status === 200 && !!fila("SELECT id FROM solicitudes_autorizacion WHERE entidad = 'usuarios' AND entidad_id = ? AND estado = 'pendiente'", String(UN.id)),
  `${prep.join(",")} aut=${aut} asig=${[aExtra, aFut, aRev, aTer].map((r) => r.status)} revoca=${revoca.status} foto=${foto.status} ${foto.data?.message || ""} inact=${inact.status}`,
);

/* ---------- Utilidades de pantalla ---------- */
const marcado = (page, campo, ms = 4000) => esperar(async () => (await page.locator(`#${campo}`).first().getAttribute("aria-invalid").catch(() => null)) === "true", ms).then(Boolean);
/* Pulsa `boton` y espera el resumen de validación; dice qué campos quedaron marcados y lo cierra. */
async function intentar(page, boton, campos = []) {
  await boton.click();
  const alerta = page.locator('[role="alertdialog"][data-validacion]');
  await alerta.waitFor();
  const tipo = await alerta.getAttribute("data-validacion");
  const texto = (await alerta.innerText()).replace(/\s+/g, " ");
  const marcados = {};
  for (const c of campos) marcados[c] = await marcado(page, c);
  await entendido(page);
  return { tipo, texto, marcados, todos: campos.every((c) => marcados[c]) };
}
/* Espera `exito` (locator); si el servidor pide reautenticación, la da con la contraseña propia. */
async function hastaQue(page, exito, password = PASS) {
  const ok = await esperar(async () => {
    if (await page.locator("#reauth-password").isVisible().catch(() => false)) await contrasena(page, password);
    return exito.isVisible().catch(() => false);
  }, 30_000);
  if (!ok) throw new Error(`no apareció ${exito}`);
}
const ventanaUsuario = async (page, idu) => {
  await page.goto(`${BASE_WEB}/administracion/usuarios?abrir=${idu}`);
  const v = page.locator(`[data-usuario-ventana="${idu}"]`);
  await v.waitFor();
  return v;
};
const filasUsuarios = (page) => page.locator('[aria-label="Usuarios"] li[data-usuario]').evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-usuario"))));
const filtros = async (page, fn) => {
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await fn(page.locator("[data-radix-popper-content-wrapper]").last());
  await page.keyboard.press("Escape");
};
const interruptor = (pop, seccion, nombre) => pop.locator(`section[aria-label="${seccion}"]`).getByRole("switch", { name: nombre, exact: true });
/* El buscador en ventana (⌘K): diálogo «Buscar»; el campo se nombra por la etiqueta de cmdk. */
const paletaDe = (page) => page.getByRole("dialog", { name: "Buscar", exact: true }).and(page.locator('[data-state="open"]'));
/* Abre el buscador (⌘K/Ctrl+K o el botón «Buscar»), escribe `q` y espera su respuesta. */
async function buscar(page, q) {
  const dialogo = paletaDe(page);
  // Si se está cerrando (animación de salida), se espera a que se vaya antes de volver a abrirlo.
  if (!(await dialogo.isVisible().catch(() => false))) await page.getByRole("dialog", { name: "Buscar", exact: true }).waitFor({ state: "detached" });
  if (!(await dialogo.isVisible().catch(() => false))) await page.locator('aside[aria-label="Navegación principal"]').getByRole("button", { name: "Buscar", exact: true }).click();
  const campo = dialogo.locator('input[aria-label="Buscar en FICOTOX"]');
  await campo.waitFor();
  const respuesta = q ? page.waitForResponse((r) => r.url().includes("/api/busqueda?") && new URL(r.url()).searchParams.get("q") === q) : null;
  await campo.fill(q);
  if (respuesta) await respuesta;
  // La lista se pinta tras la respuesta: opciones o «No encontramos…».
  await esperar(async () => (await dialogo.getByRole("option").count()) > 0 || (await dialogo.getByText(/No encontramos nada con/).isVisible().catch(() => false)), 10_000);
  return { dialogo, campo, opciones: async () => (await dialogo.getByRole("option").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim()) };
}

/* ---------- Acceso (sin sesión) ---------- */
await paso(null, "acceso: mostrar contraseña y Bloq Mayús", async (page) => {
  await page.goto(`${BASE_WEB}/login`);
  const campo = page.locator("#login-password");
  await campo.fill("abcdef");
  const mostrar = page.getByRole("button", { name: "Mostrar contraseña" });
  const antes = [await campo.getAttribute("type"), await mostrar.getAttribute("aria-pressed")];
  await mostrar.click();
  const ocultar = page.getByRole("button", { name: "Ocultar contraseña" });
  const durante = [await campo.getAttribute("type"), await ocultar.getAttribute("aria-pressed")];
  await ocultar.click();
  const despues = await campo.getAttribute("type");
  check("[cob:A:A-003] «Mostrar contraseña» la deja ver (aria-pressed=true, «Ocultar contraseña») y la vuelve a ocultar", antes.join() === "password,false" && durante.join() === "text,true" && despues === "password", `${antes} → ${durante} → ${despues}`);
  await campo.focus();
  await campo.dispatchEvent("keydown", { key: "A", code: "KeyA", modifierCapsLock: true, bubbles: true });
  await page.locator("#login-mayus").waitFor();
  const texto = await page.locator("#login-mayus").innerText();
  const describe = await campo.getAttribute("aria-describedby");
  await campo.dispatchEvent("keyup", { key: "a", code: "KeyA", modifierCapsLock: false, bubbles: true });
  await page.locator("#login-mayus").waitFor({ state: "detached" });
  check("[cob:A:A-004] con Bloq Mayús activo aparece el aviso (y el campo lo cita en aria-describedby); al quitarlo desaparece", /Bloq Mayús/.test(texto) && describe === "login-mayus", `${texto} ${describe}`);
});
{
  const metodos = [];
  for (const m of ["GET", "POST", "PUT", "DELETE", "PATCH"]) metodos.push(await api(m, "/no-existe-cobertura", m === "GET" ? undefined : {}, t.qa));
  check("[cob:A:A-022] /api/<ruta inexistente> responde 404 «Ruta no encontrada» con cualquier método", metodos.every((r) => r.status === 404 && /Ruta no encontrada/.test(r.data?.message)), metodos.map((r) => `${r.status} ${r.data?.message}`).join(" | "));
  const accesos = await api("GET", "/admin/accesos", undefined, t.jorge);
  check("[cob:A:A-179] la API vieja de Revisión de accesos responde 410", accesos.status === 410, `${accesos.status} ${accesos.data?.message}`);
}

/* ---------- Barra lateral, tema y atajo (cuenta temporal, Técnico Auxiliar) ---------- */
await paso(UC, "barra lateral, menú y tema", async (page) => {
  await page.goto(`${BASE_WEB}/ayuda`);
  await page.getByRole("heading", { name: "Cómo se usa FICOTOX" }).waitFor();
  await page.keyboard.press("Tab");
  const salto = await page.evaluate(() => {
    const a = document.activeElement;
    const r = a?.getBoundingClientRect();
    return { texto: a?.textContent?.trim(), href: a?.getAttribute("href"), ancho: r?.width || 0 };
  });
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => location.hash === "#contenido");
  check("[cob:A:A-036] el primer Tab enfoca «Saltar al contenido» (visible) y lleva a #contenido", salto.texto === "Saltar al contenido" && salto.href === "#contenido" && salto.ancho > 20, JSON.stringify(salto));

  const aside = page.locator('aside[aria-label="Navegación principal"]');
  check("[cob:A:A-037] en escritorio el menú lateral está visible", await aside.isVisible());
  const hay = async (href) => (await aside.locator(`a[href="${href}"]`).count()) > 0;
  const muestras = { recepcion: await hay("/muestras/recepcion"), procesamiento: await hay("/muestras/procesamiento"), extraccion: await hay("/muestras/extraccion"), analisis: await hay("/muestras/analisis"), informes: await hay("/informes"), supervision: await hay("/supervision"), solicitudes: await hay("/solicitudes") };
  check("[cob:A:A-040] Técnico Auxiliar: Muestras con Recepción, Procesamiento, Extracción, Análisis, Por supervisar y Por autorizar, sin Informes (no tiene informes:V)", muestras.recepcion && muestras.procesamiento && muestras.extraccion && muestras.analisis && !muestras.informes && muestras.supervision && muestras.solicitudes, JSON.stringify(muestras));
  const inv = { reactivos: await hay("/inventario/reactivos"), consumibles: await hay("/inventario/consumibles"), equipos: await hay("/inventario/equipos"), mantenimiento: await hay("/inventario/mantenimiento"), movimientos: await hay("/movimientos") };
  check("[cob:A:A-044] Técnico Auxiliar: Inventario con Reactivos, Consumibles, Equipos, Mantenimiento y Movimientos", Object.values(inv).every(Boolean), JSON.stringify(inv));
  const adm = { usuarios: await hay("/administracion/usuarios"), roles: await hay("/administracion/roles") };
  check("[cob:A:A-046] usuarios:V «propio»: Administración › Usuarios sin Roles", adm.usuarios && !adm.roles, JSON.stringify(adm));

  // Grupos: desplegar y contraer (se recuerda en localStorage).
  const desplegar = aside.getByRole("button", { name: "Desplegar Inventario" });
  const antes = await desplegar.getAttribute("aria-expanded");
  await desplegar.click();
  const contraer = aside.getByRole("button", { name: "Contraer Inventario" });
  await contraer.waitFor();
  const guardado = await page.evaluate(() => localStorage.getItem("ficotox.sidebar.expanded"));
  await page.reload();
  await contraer.waitFor();
  const trasRecargar = await contraer.getAttribute("aria-expanded");
  await contraer.click();
  await desplegar.waitFor();
  const final = await page.evaluate(() => localStorage.getItem("ficotox.sidebar.expanded"));
  check("[cob:A:A-047] «Desplegar Inventario» lo abre (aria-expanded), se recuerda al recargar y «Contraer Inventario» lo cierra", antes === "false" && /Inventario/.test(guardado || "") && trasRecargar === "true" && !/"Inventario"/.test(final || ""), `${antes} ${guardado} ${trasRecargar} ${final}`);

  // Barra contraída y expandida.
  const ancho = () => aside.evaluate((el) => el.getBoundingClientRect().width);
  const a0 = await ancho();
  await aside.getByRole("button", { name: "Contraer barra lateral" }).click();
  const expandir = aside.getByRole("button", { name: "Expandir barra lateral" });
  await expandir.waitFor();
  await page.waitForFunction(() => document.querySelector('aside[aria-label="Navegación principal"]').getBoundingClientRect().width < 100);
  const c = [await ancho(), await page.evaluate(() => localStorage.getItem("ficotox.sidebar.collapsed"))];
  await expandir.click();
  await aside.getByRole("button", { name: "Contraer barra lateral" }).waitFor();
  await page.waitForFunction(() => document.querySelector('aside[aria-label="Navegación principal"]').getBoundingClientRect().width > 200);
  const e = [await ancho(), await page.evaluate(() => localStorage.getItem("ficotox.sidebar.collapsed"))];
  check("[cob:A:A-048] «Contraer barra lateral» la deja en iconos (68 px, collapsed=1) y «Expandir barra lateral» la regresa (240 px, collapsed=0)", a0 > 200 && c[0] < 100 && c[1] === "1" && e[0] > 200 && e[1] === "0", `${a0} → ${c} → ${e}`);

  await page.goto(`${BASE_WEB}/`);
  await aside.locator('a[href="/ayuda"]').click();
  await page.waitForURL((u) => u.pathname === "/ayuda");
  check("[cob:A:A-053] el enlace «Ayuda» del menú lleva a /ayuda", await page.getByRole("heading", { name: "Cómo se usa FICOTOX" }).isVisible());

  // Tema desde el menú de usuario (se guarda en la cuenta).
  const tema = async () => [await page.evaluate(() => document.documentElement.dataset.theme), usuario(UC.id)?.tema];
  const t0 = await tema();
  await page.getByRole("button", { name: "Menú de usuario" }).click();
  const item1 = page.getByRole("menuitem", { name: /^Tema (oscuro|claro)$/ });
  const etiqueta1 = await item1.innerText();
  await item1.click();
  const destino = /oscuro/.test(etiqueta1) ? "dark" : "light";
  const TEMA_GUARDADO = { dark: "oscuro", light: "claro" };
  await page.waitForFunction((d) => document.documentElement.dataset.theme === d, destino);
  await esperar(async () => usuario(UC.id)?.tema === TEMA_GUARDADO[destino], 10_000);
  const t1 = await tema();
  await page.getByRole("button", { name: "Menú de usuario" }).click();
  const item2 = page.getByRole("menuitem", { name: /^Tema (oscuro|claro)$/ });
  const etiqueta2 = await item2.innerText();
  await item2.click();
  await page.waitForFunction((d) => document.documentElement.dataset.theme !== d, destino);
  await esperar(async () => usuario(UC.id)?.tema && usuario(UC.id)?.tema !== TEMA_GUARDADO[destino], 10_000);
  const t2 = await tema();
  check("[cob:A:A-056] «Tema oscuro/claro» del menú de usuario alterna la apariencia y la guarda en la cuenta", t1[0] === destino && t1[1] === TEMA_GUARDADO[destino] && etiqueta2.trim() !== etiqueta1.trim() && t2[0] !== destino && t2[1] === TEMA_GUARDADO[t2[0]], `${t0} → ${etiqueta1.trim()} ${t1} → ${etiqueta2.trim()} ${t2}`);

  // ⌘K en Mac (el navegador de pruebas en macOS se presenta como Mac).
  const paleta = paletaDe(page);
  const mac = await page.evaluate(() => /Mac/.test(navigator.userAgent));
  await page.keyboard.press("Control+K");
  const conCtrl = await paleta.isVisible().catch(() => false);
  await page.keyboard.press("Meta+K");
  await paleta.waitFor();
  await page.keyboard.press("Meta+K");
  await paleta.waitFor({ state: "detached" });
  check("[cob:A:A-058] en Mac ⌘K abre y cierra el buscador; Ctrl+K no", mac && !conCtrl, `mac=${mac} ctrl=${conCtrl}`);
});

await paso(UC, "atajo en Windows", async (page) => {
  await page.goto(`${BASE_WEB}/ayuda`);
  await page.getByRole("heading", { name: "Cómo se usa FICOTOX" }).waitFor();
  const paleta = paletaDe(page);
  await page.keyboard.press("Meta+K");
  const conMeta = await paleta.isVisible().catch(() => false);
  await page.keyboard.press("Control+K");
  await paleta.waitFor();
  const tooltip = await page.locator('aside[aria-label="Navegación principal"]').evaluate(() => document.body.innerText.includes("Ctrl+K"));
  await page.keyboard.press("Escape");
  await paleta.waitFor({ state: "detached" });
  check("[cob:A:A-058] en Windows Ctrl+K abre el buscador (Esc lo cierra); ⌘ no", !conMeta, `meta=${conMeta} ctrl+k escrito=${tooltip}`);
}, { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" });

await paso(UC, "menú móvil", async (page) => {
  await page.goto(`${BASE_WEB}/ayuda`);
  await page.getByRole("heading", { name: "Cómo se usa FICOTOX" }).waitFor();
  const lateral = await page.locator('aside[aria-label="Navegación principal"]').isVisible();
  const abrir = page.locator('button[aria-label="Abrir menú"]');
  const e0 = await abrir.getAttribute("aria-expanded");
  await abrir.click();
  const cajon = page.getByRole("dialog", { name: "Navegación principal" });
  await cajon.waitFor();
  const e1 = await abrir.getAttribute("aria-expanded");
  const enlaces = await cajon.locator('a[href="/muestras/recepcion"]').count();
  check("[cob:A:A-050] [cob:A:A-037] a 400 px no hay barra lateral: «Abrir menú» (aria-expanded) abre el cajón con la navegación", !lateral && e0 === "false" && e1 === "true" && enlaces >= 1, `lateral=${lateral} ${e0}→${e1} enlaces=${enlaces}`);
  await cajon.getByRole("button", { name: "Cerrar menú" }).click();
  await cajon.waitFor({ state: "detached" });
  check("[cob:A:A-051] «Cerrar menú» cierra el cajón", (await abrir.getAttribute("aria-expanded")) === "false");
}, { viewport: { width: 400, height: 820 } });

/* ---------- Campana (cuenta temporal: cuenta, rol y autorizaciones por vencer) ---------- */
const leidas = () => Number(fila("SELECT COUNT(*) AS n FROM notificaciones_leidas WHERE usuario_id = ?", UC.id)?.n);
await paso(UC, "campana: Hoy, Ayer y Anteriores", async (page) => {
  // Los avisos de vencimiento no tienen hora (van en «Anteriores»): para ver el agrupado por día se fechan hoy y ayer en la respuesta.
  await page.route("**/api/notificaciones", async (route) => {
    const res = await route.fetch().catch(() => null);
    if (!res) return;
    const data = await res.json();
    if (data.items?.[0]) data.items[0].cuando = new Date().toISOString();
    if (data.items?.[1]) data.items[1].cuando = new Date(Date.now() - 86_400_000).toISOString();
    await route.fulfill({ response: res, json: data });
  });
  await page.goto(`${BASE_WEB}/ayuda`);
  await page.locator("[data-campana-contador]").first().waitFor();
  await page.getByRole("button", { name: /^Notificaciones/ }).first().click();
  const panel = page.locator("[data-campana-panel]");
  await panel.waitFor();
  const secciones = await panel.locator("section").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  check("[cob:A:A-067] el panel agrupa por día del laboratorio: Hoy, Ayer y Anteriores, en ese orden", secciones.join(",") === "Hoy,Ayer,Anteriores", secciones.join(","));
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
await paso(UC, "campana: contador, marcar y abrir", async (page) => {
  await page.goto(`${BASE_WEB}/ayuda`);
  const contador = page.locator("[data-campana-contador]").first();
  await contador.waitFor();
  const disparador = page.getByRole("button", { name: /^Notificaciones/ }).first();
  const etiqueta = await disparador.getAttribute("aria-label");
  const n = Number(/(\d+) sin leer/.exec(etiqueta || "")?.[1] || 0);
  // El número sube con una animación: se espera a que llegue al de la etiqueta.
  await esperar(async () => Number(await contador.innerText()) === n, 5000);
  check("[cob:A:A-061] la campana muestra el número de no leídas (≥ 3: cuenta y autorizaciones por vencer) y lo dice en su etiqueta", n >= 3 && Number(await contador.innerText()) === n, `${await contador.innerText()} «${etiqueta}»`);
  await disparador.click();
  const panel = page.locator("[data-campana-panel]");
  await panel.waitFor();
  const filasPanel = await panel.locator("section li").count();
  const frases = (await panel.locator("section li").allInnerTexts()).map((x) => x.replace(/\s+/g, " "));
  check("[cob:A:A-062] el panel lista las no leídas (Tu cuenta, Tu rol, Tu autorización)", filasPanel === n && frases.some((f) => /Cuenta por vencer.*Tu cuenta/.test(f)) && frases.some((f) => /Autorización por vencer.*Tu autorización/.test(f)), frases.join(" | "));
  // Marcar una (el botón aparece al pasar el cursor). Otras suites generan avisos que esta cuenta también ve: se marca «Tu autorización».
  const primera = panel.locator("section li").filter({ hasText: "Tu autorización" }).first();
  await primera.hover();
  const marcar = primera.getByRole("button", { name: /^Marcar como leída:/ });
  const nombre = await marcar.getAttribute("aria-label");
  const l0 = leidas();
  const c0 = Number(await contador.innerText());
  const filas0 = await panel.locator("section li").count();
  await marcar.click();
  await esperar(async () => (await panel.locator("section li").count()) === filas0 - 1, 5000);
  await esperar(async () => leidas() === l0 + 1, 10_000);
  await esperar(async () => Number(await contador.innerText()) === c0 - 1, 5000);
  const ver = panel.getByRole("button", { name: /^Ver anteriores/ });
  await ver.waitFor();
  check("[cob:A:A-064] «Marcar como leída: <frase> <registro>» la quita de la lista, la guarda y baja el contador", /^Marcar como leída: .+/.test(nombre || "") && leidas() === l0 + 1 && /Tu autorización/.test(nombre || "") && Number(await contador.innerText()) === c0 - 1, `${nombre} ${l0}→${leidas()} contador=${c0}→${await contador.innerText()}`);
  await ver.click();
  const ocultar = panel.getByRole("button", { name: "Ocultar anteriores" });
  await ocultar.waitFor();
  const anteriores = await panel.locator("div.border-t ul li").count();
  const expandido = await ocultar.getAttribute("aria-expanded");
  await ocultar.click();
  await panel.getByRole("button", { name: "Ver anteriores (1)" }).waitFor();
  check("[cob:A:A-066] «Ver anteriores (1)» muestra la leída (aria-expanded) y «Ocultar anteriores» la esconde", anteriores === 1 && expandido === "true", `${anteriores} ${expandido}`);
  // Marcar todas.
  await panel.getByRole("button", { name: "Marcar todas como leídas" }).click();
  await panel.getByText("Estás al día").waitFor();
  await esperar(async () => leidas() >= l0 + n, 10_000);
  check("[cob:A:A-063] [cob:A:A-065] «Marcar todas como leídas» las guarda todas, quita el contador y deja «Estás al día»", leidas() >= l0 + n && (await page.locator("[data-campana-contador]").count()) === 0 && (await disparador.getAttribute("aria-label")) === "Notificaciones" && (await panel.getByRole("button", { name: /^Ver anteriores \(\d+\)$/ }).count()) === 1, `leídas=${leidas()} n=${n}`);
  // Abrir una (leída): «Tu cuenta» lleva a Mi cuenta › Mis autorizaciones.
  await panel.getByRole("button", { name: /^Ver anteriores/ }).click();
  await panel.locator("div.border-t ul li button").filter({ hasText: "Tu cuenta" }).first().click();
  await panel.waitFor({ state: "hidden" });
  const cuenta = page.getByRole("dialog", { name: "Mi cuenta" });
  const abrio = await cuenta.waitFor({ timeout: 10_000 }).then(() => true, () => false);
  // Contraste: al cargar la página ya con #mis-autorizaciones sí se abre.
  await page.goto(`${BASE_WEB}/ayuda`);
  await page.goto(`${BASE_WEB}/#mis-autorizaciones`);
  const alCargar = await cuenta.waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check("[cob:A:A-068] pulsar la notificación «Cuenta por vencer · Tu cuenta» (desde otra pantalla) abre su registro: Mi cuenta › Mis autorizaciones", abrio, `al pulsar: url=/#mis-autorizaciones mi-cuenta=${abrio}; al cargar /#mis-autorizaciones: mi-cuenta=${alCargar}`);
  // El mismo destino desde la píldora del Inicio («accesos por vencer»): ya en «/», el enlace solo cambiaba el hash.
  await page.keyboard.press("Escape");
  await cuenta.waitFor({ state: "hidden" });
  await page.goto(`${BASE_WEB}/`);
  const pildora = page.getByRole("list", { name: "Pendientes" }).getByRole("link", { name: /accesos por vencer/ });
  await pildora.waitFor();
  await pildora.click();
  check("[cob:A:A-068] la píldora «accesos por vencer» del Inicio también abre Mi cuenta › Mis autorizaciones", await cuenta.waitFor({ timeout: 10_000 }).then(() => true, () => false));
});

/* ---------- Mi cuenta: confirmación de contraseña y figura ---------- */
await paso(UC, "mi cuenta: contraseña y figura", async (page) => {
  await page.goto(`${BASE_WEB}/ayuda`);
  await page.getByRole("button", { name: "Menú de usuario" }).click();
  await page.getByRole("menuitem", { name: "Mi cuenta" }).click();
  const hoja = page.getByRole("dialog", { name: "Mi cuenta" });
  await hoja.waitFor();
  const peticiones = [];
  page.on("request", (r) => r.url().includes("/api/auth/password") && peticiones.push(r.method()));
  const hashAntes = usuario(UC.id)?.password_hash;
  await hoja.getByRole("button", { name: "Cambiar contraseña" }).click();
  await page.locator("#pwd-actual").fill(PASS);
  await page.locator("#pwd-nueva").fill(`Nueva-${s5}-Clave`);
  await page.locator("#pwd-confirmar").fill(`Otra-${s5}-Clave`);
  const r = await intentar(page, page.locator("form:has(#pwd-confirmar) button[type=submit]"), ["pwd-confirmar"]);
  check("[cob:A:V-10] confirmación distinta de la nueva: aviso «La confirmación no coincide con la contraseña nueva», el campo marcado y no se envía nada", r.tipo !== "servidor" && /La confirmación no coincide con la contraseña nueva/.test(r.texto) && r.todos && peticiones.length === 0 && usuario(UC.id)?.password_hash === hashAntes, `${r.tipo} ${r.texto} ${JSON.stringify(r.marcados)} peticiones=${peticiones}`);

  const guardar = page.getByRole("button", { name: "Guardar figura" });
  const deshabilitado = await guardar.isDisabled();
  const avatar0 = usuario(UC.id)?.avatar;
  const otra = hoja.getByRole("radiogroup", { name: "Avatar" }).locator('[role="radio"][aria-checked="false"]').nth(2);
  const elegida = await otra.getAttribute("aria-label");
  await otra.click();
  await esperar(() => guardar.isEnabled(), 5000);
  await guardar.click();
  await toast(page, /Figura actualizada/);
  await esperar(async () => usuario(UC.id)?.avatar && usuario(UC.id)?.avatar !== avatar0, 10_000);
  check("[cob:A:A-097] «Guardar figura» está deshabilitado hasta elegir otra figura; al guardar avisa «Figura actualizada» y la cuenta la conserva", deshabilitado && usuario(UC.id)?.avatar && usuario(UC.id)?.avatar !== avatar0, `antes=${avatar0} elegida=${elegida} después=${usuario(UC.id)?.avatar}`);

  // Sin usuarios:G ni roles: el buscador no ofrece «Nuevo usuario» ni «Roles y permisos».
  await page.keyboard.press("Escape");
  await hoja.waitFor({ state: "detached" });
  const nuevo = await buscar(page, "nuevo usuario");
  const o1 = await nuevo.opciones();
  const rolesQ = await buscar(page, "roles permisos");
  const o2 = await rolesQ.opciones();
  check("[cob:A:A-079] [cob:A:A-080] sin usuarios:G no aparece «Nuevo usuario»; con usuarios:V «propio» no aparece «Roles y permisos»", !o1.some((o) => /^Nuevo usuario/.test(o)) && !o2.some((o) => /^Roles y permisos/.test(o)), `${o1.join(" / ")} || ${o2.join(" / ")}`);
});

/* ---------- Buscador (Administrador técnico propio) ---------- */
const recientes = () => Number(fila("SELECT COUNT(*) AS n FROM busqueda_recientes WHERE usuario_id = ?", UA.id)?.n);
await paso(UA, "buscador: acciones, recientes, teclado", async (page) => {
  await page.goto(`${BASE_WEB}/ayuda`);
  await page.getByRole("heading", { name: "Cómo se usa FICOTOX" }).waitFor();
  // Abrir un resultado lo guarda en recientes.
  let b = await buscar(page, UH.nombre);
  const persona = b.dialogo.getByRole("option").filter({ hasText: UH.nombre }).first();
  await persona.click();
  await page.locator(`[data-usuario-ventana="${UH.id}"]`).waitFor();
  await esperar(async () => recientes() >= 1, 10_000);
  const r1 = recientes();
  const enRecientes = fila("SELECT titulo, href FROM busqueda_recientes WHERE usuario_id = ? AND tipo = 'resultado' ORDER BY id DESC LIMIT 1", UA.id);
  check("[cob:A:A-074] abrir un resultado (persona) lleva a su ficha y lo guarda en recientes", r1 >= 1 && enRecientes?.titulo === UH.nombre && /abrir=/.test(enRecientes?.href || ""), JSON.stringify(enRecientes));
  await page.keyboard.press("Escape");
  await page.locator(`[data-usuario-ventana="${UH.id}"]`).waitFor({ state: "detached" });

  // «Ver todos en Personas»: la lista filtrada con lo escrito.
  b = await buscar(page, UN.nombre);
  const verTodos = b.dialogo.getByRole("option").filter({ hasText: "Ver todos en Personas" });
  const hayVer = await verTodos.count();
  await verTodos.click();
  await page.waitForURL((u) => u.pathname === "/administracion/usuarios" && u.searchParams.get("buscar") === UN.nombre);
  const buscador = page.getByPlaceholder("Buscar por nombre o correo");
  await esperar(async () => (await buscador.inputValue()) === UN.nombre, 10_000);
  await esperar(async () => (await filasUsuarios(page)).join() === String(UN.id), 15_000);
  check("[cob:A:A-076] «Ver todos en Personas» abre Usuarios filtrada por lo escrito", hayVer === 1 && (await filasUsuarios(page)).join() === String(UN.id), `${hayVer} ${await buscador.inputValue()} ${await filasUsuarios(page)}`);

  // Sin resultados.
  b = await buscar(page, `zzqx sin nada ${s5}`);
  check("[cob:A:A-075] sin resultados: «No encontramos nada con «…»»", await b.dialogo.getByText(`No encontramos nada con «zzqx sin nada ${s5}»`).isVisible());

  // Flechas, Enter y Esc.
  b = await buscar(page, "roles permisos");
  const seleccionada = () => b.dialogo.locator('[role="option"][aria-selected="true"]').innerText().then((x) => x.replace(/\s+/g, " ").trim());
  const s0 = await seleccionada();
  await page.keyboard.press("ArrowDown");
  const s1 = await seleccionada();
  await page.keyboard.press("ArrowUp");
  const s2 = await seleccionada();
  const o = await b.opciones();
  check("[cob:A:A-080] con usuarios:V total aparece «Roles y permisos» (pantalla)", o.some((x) => /^Roles y permisos/.test(x)), o.join(" / "));
  await page.keyboard.press("Escape");
  await b.dialogo.waitFor({ state: "detached" });
  check("[cob:A:A-082] ↓ y ↑ mueven la opción elegida (aria-selected) y Esc cierra el buscador", s0 && s1 && s0 !== s1 && s2 === s0, `${s0} → ${s1} → ${s2}`);

  // Nuevo usuario desde el buscador.
  b = await buscar(page, "nuevo usuario");
  const opNuevo = b.dialogo.getByRole("option").filter({ hasText: /^Nuevo usuario/ }).first();
  await opNuevo.click();
  await page.waitForURL((u) => u.pathname === "/administracion/usuarios");
  const hoja = page.getByRole("dialog", { name: "Nuevo usuario" });
  await hoja.waitFor();
  check("[cob:A:A-079] con usuarios:G, «Nuevo usuario» del buscador abre el formulario de alta", await page.locator("#user-form").isVisible());
  await page.keyboard.press("Escape");
  await hoja.waitFor({ state: "detached" });

  // Temas de Ayuda.
  b = await buscar(page, "cómo anular");
  const anular = b.dialogo.getByRole("option").filter({ hasText: "Corregir un registro" }).first();
  await anular.click();
  await page.waitForURL((u) => u.pathname === "/ayuda" && u.hash === "#anular");
  await page.waitForFunction(() => {
    const r = document.getElementById("anular")?.getBoundingClientRect();
    return r && r.top >= -5 && r.top < window.innerHeight / 2;
  });
  b = await buscar(page, "atajos");
  const atajos = await b.opciones();
  check("[cob:A:A-081] «cómo anular» ofrece «Corregir un registro» y lleva a /ayuda#anular (a la vista); «atajos» ofrece «Atajos de teclado»", atajos.some((x) => /Atajos de teclado/.test(x)), atajos.join(" / "));
  await page.keyboard.press("Escape");

  // Recientes: quitar uno y borrar todos.
  b = await buscar(page, UR.nombre);
  await b.dialogo.getByRole("option").filter({ hasText: UR.nombre }).first().click();
  await page.locator(`[data-usuario-ventana="${UR.id}"]`).waitFor();
  await page.keyboard.press("Escape");
  await esperar(async () => fila("SELECT COUNT(*) AS n FROM busqueda_recientes WHERE usuario_id = ? AND tipo = 'resultado'", UA.id)?.n >= 2, 10_000);
  b = await buscar(page, "");
  const grupo = b.dialogo.locator('[cmdk-group]').filter({ hasText: "Recientes" });
  await grupo.waitFor();
  const r2 = recientes();
  const filasR = await grupo.getByRole("option").count();
  const deUR = () => grupo.getByRole("option").filter({ hasText: UR.nombre }).count();
  // Lo escrito («consulta») y lo abierto («resultado») se guardan por separado: se quita uno.
  const ur0 = await deUR();
  const quitar = grupo.getByRole("option").filter({ hasText: UR.nombre }).first();
  await quitar.hover();
  await quitar.getByRole("button", { name: "Quitar de recientes" }).click();
  await esperar(async () => recientes() === r2 - 1, 10_000);
  check("[cob:A:A-073] «Quitar de recientes» quita solo esa (en pantalla y en la cuenta)", recientes() === r2 - 1 && (await grupo.getByRole("option").count()) === filasR - 1 && (await deUR()) === ur0 - 1, `${r2}→${recientes()} filas ${filasR}→${await grupo.getByRole("option").count()} de UR ${ur0}→${await deUR()}`);
  // El encabezado del grupo de cmdk es aria-hidden: el botón se busca por su texto.
  await grupo.locator("button", { hasText: "Borrar recientes" }).click();
  await esperar(async () => recientes() === 0, 10_000);
  check("[cob:A:A-072] «Borrar recientes» los borra todos", recientes() === 0 && (await b.dialogo.locator('[cmdk-group]').filter({ hasText: "Recientes" }).count()) === 0, `quedan ${recientes()}`);
  await page.keyboard.press("Escape");
});

/* ---------- Ayuda ---------- */
const SECCIONES = { empezar: "Cómo usar la plataforma", buscar: "Buscar", muestras: "Flujo de una muestra", extraccion: "Extracciones ASP y DSP", analisis: "Análisis, revisión y aprobación", informes: "Informes de resultados", inventario: "Inventario y avisos", calidad: "Calidad y auditoría", documentos: "Documentos SGC", anular: "Corregir un registro", atajos: "Atajos de teclado" };
await paso(UA, "ayuda: índice y secciones", async (page) => {
  await page.goto(`${BASE_WEB}/ayuda#documentos`);
  const indice = page.getByRole("navigation", { name: "Índice" });
  await indice.waitFor();
  const enlaces = await indice.locator("a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  await page.waitForFunction(() => document.querySelector('nav[aria-label="Índice"] a[href="#documentos"]')?.getAttribute("aria-current") === "location", null, { timeout: 45_000 });
  await indice.locator('a[href="#informes"]').click();
  await page.waitForFunction(() => location.hash === "#informes" && document.querySelector('nav[aria-label="Índice"] a[href="#informes"]')?.getAttribute("aria-current") === "location", null, { timeout: 15_000 });
  const actuales = await indice.locator('a[aria-current="location"]').count();
  check("[cob:A:A-180] el índice tiene las 13 secciones; llegar con #documentos la marca (aria-current=location) y pulsar «Informes» desplaza y marca solo esa", enlaces.length === 13 && actuales === 1, `${enlaces.join(" ")} actuales=${actuales}`);
  // «Atajos» es la última y es corta: pulsarla la marca (antes se quedaba marcada «Corregir un registro»).
  await indice.locator('a[href="#atajos"]').click();
  const atajos = await page.waitForFunction(() => document.querySelector('nav[aria-label="Índice"] a[href="#atajos"]')?.getAttribute("aria-current") === "location", null, { timeout: 15_000 }).then(() => true, () => false);
  check("[cob:A:A-180] pulsar «Atajos» (la última sección) la marca en el índice", atajos);
  for (const [ancla, titulo] of Object.entries(SECCIONES)) {
    const h2 = await page.locator(`section#${ancla} h2`).innerText().catch(() => "");
    const texto = await page.locator(`section#${ancla}`).innerText().catch(() => "");
    const enIndice = await indice.locator(`a[href="#${ancla}"]`).count();
    check(`[cob:A:ayuda-${ancla}] Ayuda #${ancla}: sección «${titulo}» con contenido y entrada en el índice`, h2 === titulo && texto.length > 200 && enIndice === 1, `${h2} (${texto.length}) índice=${enIndice}`);
  }
  await page.goto(`${BASE_WEB}/administracion/accesos`);
  await page.waitForURL((u) => u.pathname === "/administracion/usuarios");
  check("[cob:A:A-179] /administracion/accesos lleva a Administración › Usuarios", await page.getByRole("heading", { name: "Usuarios" }).first().isVisible());
});

/* ---------- Menú del Administrador técnico ---------- */
await paso(UA, "menú del Administrador técnico", async (page) => {
  await page.goto(`${BASE_WEB}/ayuda`);
  const aside = page.locator('aside[aria-label="Navegación principal"]');
  await aside.waitFor();
  const hay = async (href) => (await aside.locator(`a[href="${href}"]`).count()) > 0;
  const m = { recepcion: await hay("/muestras/recepcion"), procesamiento: await hay("/muestras/procesamiento"), informes: await hay("/informes") };
  const i = { reactivos: await hay("/inventario/reactivos"), movimientos: await hay("/movimientos"), equipos: await hay("/inventario/equipos"), mantenimiento: await hay("/inventario/mantenimiento") };
  const a = { usuarios: await hay("/administracion/usuarios"), roles: await hay("/administracion/roles") };
  check("[cob:A:A-040] Administrador técnico (muestras:V estado, sin ensayos ni informes): Muestras solo con Recepción", m.recepcion && !m.procesamiento && !m.informes, JSON.stringify(m));
  check("[cob:A:A-044] Administrador técnico (equipos sí, inventario no): Equipos y Mantenimiento sin Reactivos ni Movimientos", !i.reactivos && !i.movimientos && i.equipos && i.mantenimiento, JSON.stringify(i));
  check("[cob:A:A-046] usuarios:G: Administración con Usuarios y Roles", a.usuarios && a.roles, JSON.stringify(a));
});

/* ---------- Usuarios: filtros y ventanas ---------- */
const mias = () => [UA, UC, UH, UN, UFut, UR, UF].map((c) => c.id);
await paso(UA, "usuarios: filtros y orden", async (page) => {
  await page.goto(`${BASE_WEB}/administracion/usuarios`);
  const buscador = page.getByPlaceholder("Buscar por nombre o correo");
  await buscador.fill(s5);
  await esperar(async () => mias().every((x) => filasUsuarios(page).then((f) => f.includes(x))), 15_000);
  await esperar(async () => (await filasUsuarios(page)).length === mias().length, 10_000);
  const base = await filasUsuarios(page);

  await filtros(page, (pop) => interruptor(pop, "Rol", Rextra.nombre).click());
  await esperar(async () => (await filasUsuarios(page)).join() === String(UH.id), 10_000);
  const porRol = await filasUsuarios(page);
  const boton = await page.getByRole("button", { name: /^Filtros/ }).getAttribute("aria-label");
  await filtros(page, (pop) => pop.getByRole("button", { name: "Limpiar filtros" }).click());
  await esperar(async () => (await filasUsuarios(page)).length === base.length, 10_000);
  check("[cob:A:A-106] filtro Rol (un rol propio) deja solo a quien lo tiene vigente y el botón cuenta el filtro", porRol.join() === String(UH.id) && boton === "Filtros (1 activos)", `${porRol} «${boton}»`);

  await filtros(page, (pop) => interruptor(pop, "Otros", "Sin roles vigentes").click());
  await esperar(async () => !(await filasUsuarios(page)).includes(UA.id), 10_000);
  const sinRoles = await filasUsuarios(page);
  await filtros(page, async (pop) => {
    await interruptor(pop, "Otros", "Sin roles vigentes").click();
    await interruptor(pop, "Otros", "Sin autorizaciones FX-THF-AP").click();
  });
  await esperar(async () => !(await filasUsuarios(page)).includes(UC.id), 10_000);
  const sinAut = await filasUsuarios(page);
  await filtros(page, (pop) => pop.getByRole("button", { name: "Limpiar filtros" }).click());
  check("[cob:A:A-108] «Sin roles vigentes» deja a quien no tiene ninguno vigente (rol pendiente o por comenzar); «Sin autorizaciones FX-THF-AP» quita a quien tiene", sinRoles.includes(UN.id) && sinRoles.includes(UFut.id) && !sinRoles.includes(UA.id) && !sinRoles.includes(UC.id) && sinAut.includes(UA.id) && !sinAut.includes(UC.id), `sin roles=${sinRoles} sin aut=${sinAut}`);

  // Orden.
  const creado = (x) => String(usuario(x)?.creado_en || "");
  const acceso = (x) => String(usuario(x)?.ultimo_acceso || "");
  const nombres = (await page.locator('[aria-label="Usuarios"] li[data-usuario]').allInnerTexts()).map((x) => x.split("\n")[0].trim());
  const ordenNombre = [...nombres].sort((x, y) => x.localeCompare(y, "es"));
  await filtros(page, (pop) => interruptor(pop, "Ordenar por", "Fecha de alta").click());
  await esperar(async () => (await filasUsuarios(page)).join() !== base.join(), 5000);
  const porAlta = (await filasUsuarios(page)).map(creado);
  await filtros(page, (pop) => interruptor(pop, "Ordenar por", "Último acceso").click());
  await esperar(async () => (await filasUsuarios(page))[0] !== undefined && acceso((await filasUsuarios(page))[0]) !== "", 5000);
  const porAcceso = (await filasUsuarios(page)).map(acceso);
  const noCrece = (lista) => lista.every((v, k) => k === 0 || lista[k - 1] >= v);
  check("[cob:A:A-109] Ordenar por: Nombre A–Z (por omisión), Fecha de alta (la más nueva primero) y Último acceso (quien entró, primero)", nombres.join("|") === ordenNombre.join("|") && noCrece(porAlta) && porAlta[0] === creado(UF.id) && noCrece(porAcceso) && porAcceso[0] !== "", `${nombres.join("|")} || alta ${porAlta.join(",")} || acceso ${porAcceso.join(",")}`);

  // Desde el aviso «Accesos que vencen en 7 días» y «Con solicitudes pendientes».
  await page.goto(`${BASE_WEB}/administracion/usuarios?vigencia=vence7&buscar=${s5}`);
  await esperar(async () => (await filasUsuarios(page)).includes(UC.id), 15_000);
  const vence = await filasUsuarios(page);
  const etiquetaV = await page.getByRole("button", { name: /^Filtros/ }).getAttribute("aria-label");
  check("[cob:A:A-107] ?vigencia=vence7 (destino del aviso) deja la cuenta que vence en 3 días y quita las que no vencen", vence.includes(UC.id) && !vence.includes(UA.id) && !vence.includes(UH.id) && etiquetaV === "Filtros (1 activos)", `${vence} «${etiquetaV}»`);
  await page.goto(`${BASE_WEB}/administracion/usuarios?solicitudes=1&buscar=${s5}`);
  await esperar(async () => (await filasUsuarios(page)).includes(UN.id), 15_000);
  const conSol = await filasUsuarios(page);
  check("[cob:A:A-108] ?solicitudes=1 («Con solicitudes pendientes») deja la cuenta con su rol inicial por autorizar", conSol.includes(UN.id) && !conSol.includes(UA.id) && !conSol.includes(UC.id), String(conSol));
});

const datosRapidos = (v) => v.locator("dl > div").evaluateAll((els) => Object.fromEntries(els.map((e) => [e.querySelector("dt")?.textContent?.trim(), e.querySelector("dd")?.textContent?.trim()])));
await paso(UA, "usuarios: ventana de la persona", async (page) => {
  // Temporal: datos rápidos, cuenta, barra de vigencia, supervisor y departamento.
  let v = await ventanaUsuario(page, UC.id);
  const d = await datosRapidos(v);
  check("[cob:A:A-137] datos rápidos: Último acceso, Cuenta desde, Roles (1) y Autorizaciones (2)", d["Último acceso"] && d["Último acceso"] !== "Nunca" && d["Cuenta desde"] && d.Roles === "1" && d.Autorizaciones === "2", JSON.stringify(d));
  const lateral = (await v.innerText()).replace(/\s+/g, " ");
  const barra = await v.locator('[role="img"][aria-label^="queda"]').first().getAttribute("aria-label").catch(() => null);
  const sup = v.getByRole("button", { name: /ver su información/ });
  const supTexto = await sup.innerText();
  await sup.click();
  const vr = page.locator(`[data-usuario-ventana="${id.ricardo}"]`);
  await vr.waitFor();
  check("[cob:A:A-152] temporal: «Cuenta temporal», «Puede entrar del … hasta el …», barra de vigencia («quedan N días»), «Ya tiene contraseña», departamento; el supervisor abre su ficha", /Cuenta temporal/.test(lateral) && lateral.includes(`hasta el ${fmt(usuario(UC.id).vigente_hasta)}`) && /^quedan? \d+ d[ií]as?$/.test(barra || "") && /Ya tiene contraseña/.test(lateral) && /Laboratorio/.test(lateral) && /Ricardo/.test(supTexto), `${barra} | ${supTexto} | ${lateral.slice(0, 400)}`);

  // Sin roles y sin contraseña.
  v = await ventanaUsuario(page, UN.id);
  await v.getByText(/No tiene roles vigentes|Vigente/).first().waitFor();
  const tn = (await v.innerText()).replace(/\s+/g, " ");
  check("[cob:A:A-140] sin roles vigentes: «No tiene roles vigentes: puede entrar, pero no ve nada.»", /No tiene roles vigentes: puede entrar, pero no ve nada\./.test(tn), tn.slice(0, 300));
  check("[cob:A:A-152] cuenta sin contraseña: «Todavía no tiene contraseña para entrar.»", /Todavía no tiene contraseña para entrar\./.test(tn));

  // Fuera de su vigencia (empieza en 10 días): su rol inicial está por comenzar.
  v = await ventanaUsuario(page, UFut.id);
  const tf = (await v.innerText()).replace(/\s+/g, " ");
  const fut = await v.locator("[data-asignacion]").first().innerText();
  check("[cob:A:A-152] [cob:A:A-142] cuenta que aún no empieza: «Está fuera de su vigencia: no puede entrar.» y su rol «Por comenzar»", /Está fuera de su vigencia: no puede entrar\./.test(tf) && /Por comenzar/.test(fut), `${fut.replace(/\s+/g, " ")} | ${tf.slice(0, 300)}`);

  // Historial: vigente, por comenzar, revocado y terminado.
  v = await ventanaUsuario(page, UH.id);
  await v.locator("[data-asignacion]").first().waitFor();
  const estadoDe = async (nombre) => (await v.locator("[data-asignacion]").filter({ hasText: nombre }).first().innerText().catch(() => "")).replace(/\s+/g, " ");
  const vig = await estadoDe(Rextra.nombre);
  const porComenzar = await estadoDe(Rfut.nombre);
  const resumen = v.locator("summary").filter({ hasText: /Historial de roles/ });
  const textoResumen = await resumen.innerText();
  await resumen.click();
  const rev = await estadoDe(Rrev.nombre);
  const ter = await estadoDe(Rter.nombre);
  check("[cob:A:A-142] tarjetas de rol: «Vigente», «Por comenzar», «Revocado» (con quién y motivo) y «Terminado»", /Vigente/.test(vig) && /Por comenzar/.test(porComenzar) && /Revocado/.test(rev) && /Termina la prueba de cobertura/.test(rev) && /Terminado/.test(ter), `${vig} | ${porComenzar} | ${rev} | ${ter}`);
  check("[cob:A:A-144] «Historial de roles (2)» guarda los revocados y terminados", /Historial de roles \(2\)/.test(textoResumen), textoResumen);
  check("[cob:A:A-145] usuarios:G en la ficha de otra persona: botón «Asignar rol»", (await v.getByRole("button", { name: "Asignar rol" }).count()) === 1);

  // Propia.
  v = await ventanaUsuario(page, UA.id);
  const tp = (await v.innerText()).replace(/\s+/g, " ");
  check("[cob:A:A-141] en la ficha propia: «Nadie puede asignarse ni quitarse roles a sí mismo…» y sin «Asignar rol» ni «Revocar»", /Nadie puede asignarse ni quitarse roles a sí mismo/.test(tp) && (await v.getByRole("button", { name: "Asignar rol" }).count()) === 0 && (await v.getByRole("button", { name: "Revocar" }).count()) === 0, tp.slice(0, 300));
  await v.getByRole("tab", { name: "Autorizaciones" }).click();
  await page.locator("#autorizaciones-usuario").waitFor();
  check("[cob:A:A-154] sin ensayos:A ni calidad:A (Administrador técnico) no hay «Agregar» autorización", (await page.locator("#autorizaciones-usuario").getByRole("button", { name: "Agregar" }).count()) === 0);
});

await paso("ricardo", "autorizaciones: agregar", async (page) => {
  const v = await ventanaUsuario(page, UC.id);
  await v.getByRole("tab", { name: "Autorizaciones" }).click();
  const panel = page.locator("#autorizaciones-usuario");
  await panel.waitFor();
  const agregar = panel.getByRole("button", { name: "Agregar" });
  const hay = await agregar.count();
  await agregar.click();
  const formulario = await panel.getByText("Agregar autorización").first().isVisible();
  const propia = await ventanaUsuario(page, id.ricardo);
  await propia.getByRole("tab", { name: "Autorizaciones" }).click();
  await page.locator("#autorizaciones-usuario").waitFor();
  const enPropia = await page.locator("#autorizaciones-usuario").getByRole("button", { name: "Agregar" }).count();
  check("[cob:A:A-154] con ensayos:A (Coordinación de área técnica): «Agregar» abre «Agregar autorización» en la ficha de otra persona; en la propia no aparece", hay === 1 && formulario && enPropia === 0, `${hay} ${formulario} propia=${enPropia}`);
});

/* ---------- Usuarios: restablecer contraseña y quitar foto ---------- */
const acciones = async (page, persona) => {
  await page.goto(`${BASE_WEB}/administracion/usuarios?buscar=${encodeURIComponent(persona.nombre)}`);
  const renglon = page.locator(`[aria-label="Usuarios"] li[data-usuario="${persona.id}"]`);
  await renglon.waitFor();
  await renglon.getByRole("button", { name: "Acciones" }).click();
  return page.getByRole("menu");
};
await paso(UA, "usuarios: restablecer contraseña y quitar foto", async (page, { context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_WEB });
  const hash0 = usuario(UR.id)?.password_hash;
  let menu = await acciones(page, UR);
  await menu.getByRole("menuitem", { name: "Restablecer contraseña…" }).click();
  await page.locator("#prompt-motivo").fill("La persona olvidó su contraseña");
  if (await page.locator("#prompt-password").count()) await page.locator("#prompt-password").fill(PASS);
  await page.getByRole("dialog").getByRole("button", { name: "Restablecer contraseña", exact: true }).click();
  const temporal = page.getByTestId("password-temporal");
  await hastaQue(page, temporal);
  const valor = (await temporal.innerText()).trim();
  const ventana = page.getByRole("dialog", { name: "Contraseña temporal" });
  const descripcion = await ventana.innerText();
  await ventana.getByRole("button", { name: "Copiar" }).click();
  await toast(page, /Contraseña copiada/);
  const copiada = await page.evaluate(() => navigator.clipboard.readText());
  await ventana.getByRole("button", { name: "Entendido" }).click();
  await ventana.waitFor({ state: "detached" });
  const login = await api("POST", "/auth/login", { email: UR.email, password: valor }, undefined, { "X-Sin-Cambio-Auto": "1" });
  const u = usuario(UR.id);
  check("[cob:A:A-113] «Contraseña temporal»: se muestra una vez, «Copiar» la copia, «Entendido» la cierra; entra con ella y debe cambiarla", valor.length >= 10 && copiada === valor && /No se volverá a mostrar/.test(descripcion) && login.status === 200 && Number(u.debe_cambiar_password) === 1 && u.password_hash !== hash0, `${valor.length} copiada=${copiada === valor} login=${login.status} debe=${u.debe_cambiar_password}`);
  const v = await ventanaUsuario(page, UR.id);
  check("[cob:A:A-152] tras restablecer, la ficha dice «Debe elegir una contraseña nueva al entrar.»", /Debe elegir una contraseña nueva al entrar\./.test(await v.innerText()));
  await page.keyboard.press("Escape");

  // Quitar foto: solo a otra persona con foto; motivo sin contraseña.
  menu = await acciones(page, UC);
  const sinFoto = await menu.getByRole("menuitem", { name: /Quitar foto de perfil/ }).count();
  await page.keyboard.press("Escape");
  menu = await acciones(page, UF);
  await menu.getByRole("menuitem", { name: "Quitar foto de perfil…" }).click();
  const pidePassword = await page.locator("#prompt-password").count();
  await page.locator("#prompt-motivo").fill("abc");
  await page.getByRole("dialog").getByRole("button", { name: "Quitar foto", exact: true }).click();
  const corta = await marcado(page, "prompt-motivo");
  if (await page.getByRole("button", { name: "Entendido" }).isVisible().catch(() => false)) await entendido(page);
  const conFoto = !!usuario(UF.id)?.foto;
  await page.locator("#prompt-motivo").fill("Foto que no corresponde");
  await page.getByRole("dialog").getByRole("button", { name: "Quitar foto", exact: true }).click();
  await toast(page, /Foto de perfil quitada/);
  await esperar(async () => !usuario(UF.id)?.foto, 10_000);
  check("[cob:A:A-115] «Quitar foto de perfil…» solo con foto; motivo < 5 se marca sin quitarla; con motivo (sin contraseña) la quita", sinFoto === 0 && pidePassword === 0 && corta && conFoto && !usuario(UF.id)?.foto, `sinFoto=${sinFoto} pide=${pidePassword} corta=${corta} conFoto=${conFoto} ahora=${usuario(UF.id)?.foto}`);
});

/* ---------- Hoja de usuario: alta y edición ---------- */
const NUEVO = `cob.ui.nuevo.${s5}@ficotox.local`;
await paso(UA, "hoja de usuario: alta con validación", async (page) => {
  await page.goto(`${BASE_WEB}/administracion/usuarios`);
  await page.getByRole("button", { name: "Nuevo usuario" }).click();
  const hoja = page.getByRole("dialog", { name: "Nuevo usuario" });
  await hoja.waitFor();
  const crear = hoja.getByRole("button", { name: "Crear usuario" });
  const motivoInicial = await page.locator("#u-motivo-rol").inputValue();
  const hint = await hoja.getByText(/^Debe ser de @/).innerText().catch(() => "");
  const largos = { nombre: await page.locator("#u-nombre").getAttribute("maxlength"), depto: await page.locator("#u-depto").getAttribute("maxlength") };
  await page.locator("#u-motivo-rol").fill("abc");
  let r = await intentar(page, crear, ["u-email", "u-rol", "u-motivo-rol", "u-password"]);
  check("[cob:A:A-121] [cob:A:A-123] [cob:A:A-126] alta vacía: correo, rol, motivo (< 5; precargado «Alta de usuario») y contraseña marcados; el nombre no se exige", r.todos && !(await marcado(page, "u-nombre", 500)) && motivoInicial === "Alta de usuario" && /Debe ser de @cicese\.mx/.test(hint), `${r.texto} ${JSON.stringify(r.marcados)} motivo=«${motivoInicial}» hint=«${hint}»`);
  check("[cob:A:A-120] [cob:A:A-124] Nombre y Departamento con máximo de 100 caracteres", largos.nombre === "100" && largos.depto === "100", JSON.stringify(largos));

  await page.locator("#u-email").fill("persona@gmail.com");
  await page.locator("#u-password").fill("corta");
  await page.locator("#u-tipo-cuenta").selectOption("temporal");
  r = await intentar(page, crear, ["u-email", "u-password", "u-supervisor", "u-cuenta-hasta"]);
  check("[cob:A:A-121] [cob:A:A-126] [cob:A:A-128] [cob:A:A-131] dominio ajeno, contraseña < 10 y temporal sin supervisor ni fin: cada aviso en su campo", r.todos && /Usa un correo de @cicese\.mx, @ficotox\.local/.test(r.texto) && /al menos 10 caracteres/.test(r.texto) && /necesita supervisor/.test(r.texto) && /necesita fecha de fin/.test(r.texto), `${r.texto} ${JSON.stringify(r.marcados)}`);
  const ver = hoja.getByRole("button", { name: "Mostrar contraseña" });
  await ver.click();
  const tipoVisible = await page.locator("#u-password").getAttribute("type");
  await hoja.getByRole("button", { name: "Ocultar contraseña" }).click();
  check("[cob:A:A-126] la contraseña inicial se puede mostrar y ocultar", tipoVisible === "text" && (await page.locator("#u-password").getAttribute("type")) === "password");

  // Alta válida, sin nombre (el servidor toma la parte local del correo).
  await page.locator("#u-email").fill(NUEVO);
  await page.locator("#u-rol").selectOption({ label: "Técnico Auxiliar" });
  await page.locator("#u-motivo-rol").fill("Alta desde la pantalla de cobertura");
  await page.locator("#u-depto").fill("Toxinas marinas");
  const figura = hoja.getByRole("radiogroup", { name: "Avatar" }).getByRole("radio").nth(3);
  const figuraNombre = await figura.getAttribute("aria-label");
  await figura.click();
  await page.locator("#u-password").fill(PASS);
  await page.locator("#u-supervisor").selectOption(String(id.ricardo));
  await page.locator("#u-cuenta-desde").fill(hoy());
  await page.locator("#u-cuenta-hasta").fill(enDias(20));
  await page.locator("#u-clave-admin").fill(PASS);
  await crear.click();
  await toast(page, /segundo usuario|autoriza/i);
  await hoja.waitFor({ state: "detached" });
  const u = fila("SELECT * FROM usuarios WHERE email = ?", NUEVO);
  if (u?.id) creadas.push(Number(u.id));
  const sol = fila("SELECT id, tipo FROM solicitudes_autorizacion WHERE entidad = 'usuarios' AND entidad_id = ? AND estado = 'pendiente'", String(u?.id));
  check("[cob:A:A-120] [cob:A:A-124] [cob:A:A-128] [cob:A:A-130] [cob:A:A-131] alta desde la hoja: temporal con supervisor, desde y hasta, departamento; el rol inicial queda por autorizar", u && u.tipo_cuenta === "temporal" && Number(u.supervisor_id) === id.ricardo && u.vigente_desde === hoy() && u.vigente_hasta === enDias(20) && u.departamento === "Toxinas marinas" && sol?.tipo === "asignar_rol", JSON.stringify({ nombre: u?.nombre, tipo: u?.tipo_cuenta, sup: u?.supervisor_id, desde: u?.vigente_desde, hasta: u?.vigente_hasta, depto: u?.departamento, sol }));
  check("[cob:A:A-120] sin nombre, la cuenta toma la parte local del correo", u?.nombre === NUEVO.split("@")[0], u?.nombre);
  // La figura elegida queda en la cuenta (se ve marcada al editarla).
  await page.goto(`${BASE_WEB}/administracion/usuarios?buscar=${encodeURIComponent(NUEVO)}`);
  const renglon = page.locator(`[aria-label="Usuarios"] li[data-usuario="${u?.id}"]`);
  await renglon.waitFor();
  await renglon.getByRole("button", { name: "Acciones" }).click();
  await page.getByRole("menuitem", { name: "Editar datos" }).click();
  const marcada = await page.getByRole("dialog", { name: "Editar usuario" }).getByRole("radiogroup", { name: "Avatar" }).locator('[role="radio"][aria-checked="true"]').getAttribute("aria-label");
  check("[cob:A:A-125] la figura elegida en el alta queda en la cuenta", marcada === figuraNombre && !!u?.avatar, `${figuraNombre} → ${marcada} (${u?.avatar})`);
});

await paso(UA, "hoja de usuario: vigencia y cuenta propia", async (page) => {
  await page.goto(`${BASE_WEB}/administracion/usuarios?buscar=${encodeURIComponent(UR.nombre)}`);
  const renglon = page.locator(`[aria-label="Usuarios"] li[data-usuario="${UR.id}"]`);
  await renglon.waitFor();
  await renglon.getByRole("button", { name: "Acciones" }).click();
  await page.getByRole("menuitem", { name: "Editar datos" }).click();
  const hoja = page.getByRole("dialog", { name: "Editar usuario" });
  await hoja.waitFor();
  const antes = await page.locator("#u-motivo-cuenta").count();
  await page.locator("#u-cuenta-hasta").fill(enDias(90));
  await page.locator("#u-motivo-cuenta").waitFor();
  const etiqueta = await page.locator('label[for="u-motivo-cuenta"]').innerText();
  await page.locator("#u-motivo-cuenta").fill("abc");
  const r = await intentar(page, hoja.getByRole("button", { name: "Guardar cambios" }), ["u-motivo-cuenta"]);
  const sinCambio = !usuario(UR.id)?.vigente_hasta;
  await page.locator("#u-motivo-cuenta").fill("Termina su estancia en enero");
  await page.locator("#u-clave-admin").fill(PASS);
  await hoja.getByRole("button", { name: "Guardar cambios" }).click();
  await toast(page, /Usuario actualizado/);
  await esperar(async () => usuario(UR.id)?.vigente_hasta === enDias(90), 10_000);
  check("[cob:A:A-132] [cob:A:A-131] poner fecha de fin hace aparecer «Motivo del cambio de vigencia o supervisor»; < 5 se marca y no guarda; con motivo se guarda", antes === 0 && /Motivo del cambio de vigencia o supervisor/.test(etiqueta) && r.todos && sinCambio && usuario(UR.id)?.vigente_hasta === enDias(90), `${antes} «${etiqueta}» ${r.texto} sinCambio=${sinCambio} → ${usuario(UR.id)?.vigente_hasta}`);

  await page.goto(`${BASE_WEB}/administracion/usuarios?buscar=${encodeURIComponent(UA.nombre)}`);
  const propia = page.locator(`[aria-label="Usuarios"] li[data-usuario="${UA.id}"]`);
  await propia.waitFor();
  await propia.getByRole("button", { name: "Acciones" }).click();
  await page.getByRole("menuitem", { name: "Editar datos" }).click();
  const hojaP = page.getByRole("dialog", { name: "Editar usuario" });
  await hojaP.waitFor();
  const desde = await page.locator("#u-cuenta-desde").inputValue();
  check("[cob:A:A-126] en la propia cuenta no hay campo de contraseña: «Tu propia contraseña se cambia en Mi cuenta › Cambiar contraseña.»", (await page.locator("#u-password").count()) === 0 && (await hojaP.getByText("Tu propia contraseña se cambia en Mi cuenta › Cambiar contraseña.").isVisible()));
  check("[cob:A:A-130] «Vigente desde» es opcional (vacío en una cuenta permanente sin fechas)", desde === "", `«${desde}»`);
});

/* ---------- Asignar rol (diálogo) ---------- */
await paso(UA, "asignar rol: validación y solicitud", async (page) => {
  const v = await ventanaUsuario(page, UH.id);
  await v.getByRole("button", { name: "Asignar rol" }).click();
  const dialogo = page.getByRole("dialog", { name: /^Asignar rol a / });
  await dialogo.waitFor();
  const placeholder = await page.locator("#u-asignar-motivo").getAttribute("placeholder");
  const desde = await page.locator("#u-asignar-desde").inputValue();
  const hasta = await page.locator("#u-asignar-hasta").inputValue();
  const clave = await page.locator("#u-clave-asignar").count();
  const r = await intentar(page, dialogo.getByRole("button", { name: "Asignar rol" }), ["u-asignar-rol", "u-asignar-motivo"]);
  check("[cob:A:A-148] [cob:A:A-149] [cob:A:A-150] sin rol ni motivo: ambos marcados; motivo «Ej. Cambio de funciones», desde = hoy, hasta vacío, pide tu contraseña", r.todos && placeholder === "Ej. Cambio de funciones" && desde === fmt(hoy()) && hasta === "" && clave === 1, `${r.texto} ${JSON.stringify(r.marcados)} «${placeholder}» ${desde} «${hasta}» clave=${clave}`);
  await page.locator("#u-asignar-rol").selectOption({ label: Rasig.nombre });
  await page.locator("#u-asignar-motivo").fill("Cambio de funciones de cobertura");
  await page.locator("#u-asignar-hasta").fill(enDias(30));
  await page.locator("#u-clave-asignar").fill(PASS);
  await dialogo.getByRole("button", { name: "Asignar rol" }).click();
  await toast(page, /quedó pendiente/);
  const sol = fila("SELECT id, tipo, datos_json FROM solicitudes_autorizacion WHERE entidad = 'usuarios' AND entidad_id = ? AND tipo = 'asignar_rol' AND estado = 'pendiente' ORDER BY id DESC LIMIT 1", String(UH.id));
  const datos = JSON.parse(sol?.datos_json || "{}");
  check("[cob:A:A-145] [cob:A:A-149] [cob:A:A-150] con rol, motivo, fin y contraseña: la asignación queda por autorizar con esas fechas (sin asignarse aún)", sol && Number(datos.rol_id) === Rasig.id && datos.vigente_hasta === enDias(30) && !asignacion(UH.id, Rasig.id), `${sol?.tipo} ${sol?.datos_json}`);
});

/* ---------- Roles ---------- */
const filasRoles = (page) => page.locator('[aria-label="Roles"] li[data-rol]').evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-rol"))));
await paso(UA, "roles: filtros", async (page) => {
  await page.goto(`${BASE_WEB}/administracion/roles`);
  await esperar(async () => (await filasRoles(page)).includes(Rinact.id), 15_000);
  const todos = await filasRoles(page);
  const aplicar = async (seccion, opcion) => {
    await filtros(page, (pop) => interruptor(pop, seccion, opcion).click());
    await esperar(async () => (await filasRoles(page)).length !== todos.length, 5000);
    const r = await filasRoles(page);
    await filtros(page, (pop) => pop.getByRole("button", { name: "Limpiar filtros" }).click());
    await esperar(async () => (await filasRoles(page)).length === todos.length, 5000);
    return r;
  };
  const sistema = roles.filter((r) => r.es_sistemico).map((r) => r.id);
  const inactivos = await aplicar("Estado", "Inactivos");
  const activos = await aplicar("Estado", "Activos");
  const delSistema = await aplicar("Tipo", "Del sistema");
  const personalizados = await aplicar("Tipo", "Personalizados");
  // Los nueve roles del catálogo que se pueden editar no son «personalizados» (antes salían así por no ser del sistema).
  const catalogo = await aplicar("Tipo", "Del catálogo");
  const deCatalogo = roles.filter((r) => r.clave && !r.es_sistemico).map((r) => r.id);
  check("[cob:A:A-161] Tipo «Del catálogo» lista los roles de roles-catalogo.json y «Personalizados» solo los creados en el laboratorio", deCatalogo.length >= 9 && catalogo.sort().join() === [...deCatalogo].sort().join() && !personalizados.some((x) => deCatalogo.includes(x)) && personalizados.includes(Rperm.id), `cat=${catalogo.length}/${deCatalogo.length} pers=${personalizados.length}`);
  const fila = page.locator(`[aria-label="Roles"] li[data-rol="${deCatalogo[0]}"]`);
  check("[cob:A:A-161] un rol del catálogo lleva la marca «Del catálogo», no «Personalizado»", (await fila.getByText("Del catálogo", { exact: true }).count()) === 1 && (await fila.getByText("Personalizado", { exact: true }).count()) === 0);
  const con = await aplicar("Uso", "Con personas asignadas");
  const sin = await aplicar("Uso", "Sin personas");
  check("[cob:A:A-161] filtros de Roles: Estado (Activos/Inactivos), Tipo (Del sistema/Personalizados) y Uso (Con personas/Sin personas)",
    inactivos.includes(Rinact.id) && !inactivos.includes(Rextra.id) && activos.includes(Rextra.id) && !activos.includes(Rinact.id) && delSistema.sort().join() === [...sistema].sort().join() && !personalizados.some((x) => sistema.includes(x)) && personalizados.includes(Rperm.id) && con.includes(Rextra.id) && !con.includes(Rperm.id) && sin.includes(Rperm.id) && !sin.includes(Rextra.id),
    `inact=${inactivos.includes(Rinact.id)} act=${activos.includes(Rextra.id)} sistema=${delSistema}/${sistema} pers=${personalizados.length} con=${con.includes(Rextra.id)} sin=${sin.includes(Rperm.id)}`);
});

const ventanaRol = async (page, rid) => {
  await page.goto(`${BASE_WEB}/administracion/roles?abrir=${rid}`);
  const v = page.locator(`[data-rol-ventana="${rid}"]`);
  await v.waitFor();
  return v;
};
await paso(UA, "roles: ventana, personas y editor de permisos", async (page) => {
  let v = await ventanaRol(page, rol("tecnico_auxiliar").id);
  const titulos = await v.locator("h3").allInnerTexts();
  check("[cob:A:A-167] ventana de un rol del catálogo: Responsabilidades del puesto, Lo que no puede hacer, Qué puede hacer en la plataforma, Reglas importantes y Personas con este rol", ["Responsabilidades del puesto", "Lo que no puede hacer", "Qué puede hacer en la plataforma", "Reglas importantes", "Personas con este rol"].every((x) => titulos.includes(x)), titulos.join(" | "));
  check("[cob:A:A-170] «Editar permisos» en un rol que no es propio", (await v.getByRole("button", { name: "Editar permisos" }).count()) === 1);
  v = await ventanaRol(page, rol("admin_tecnico").id);
  check("[cob:A:A-170] el rol propio (Administrador técnico) no tiene «Editar permisos»", (await v.getByRole("button", { name: "Editar permisos" }).count()) === 0 && (await v.locator("h3").count()) > 0);

  // Personas con este rol → su ficha.
  v = await ventanaRol(page, Rextra.id);
  await v.getByRole("button", { name: UH.nombre }).click();
  await page.waitForURL((u) => u.pathname === "/administracion/usuarios" && u.searchParams.get("abrir") === String(UH.id));
  await page.locator(`[data-usuario-ventana="${UH.id}"]`).waitFor();
  check("[cob:A:A-169] «Personas con este rol» abre la ficha de la persona (/administracion/usuarios?abrir=<id>)", true);

  // Editor de permisos de un rol propio vacío.
  v = await ventanaRol(page, Rperm.id);
  const vacio = /Este rol todavía no tiene permisos/.test(await v.innerText());
  await v.getByRole("button", { name: "Editar permisos" }).click();
  const ver = page.getByLabel("Ver en Muestras", { exact: true });
  await ver.waitFor();
  const columnas = await v.locator("thead th").allInnerTexts();
  const antes = [await ver.isChecked(), await page.getByLabel("Hasta dónde: Ver en Muestras").count()];
  await ver.check();
  const alcance = page.getByLabel("Hasta dónde: Ver en Muestras");
  await alcance.waitFor();
  const opciones = await alcance.locator("option").allInnerTexts();
  await alcance.selectOption({ label: "Solo el estado" }).catch(() => undefined);
  const elegido = await alcance.inputValue();
  check("[cob:A:A-171] casillas «<Acción> en <Área>» (Ver, Crear, Editar, Revisar, Aprobar, Anular, Administrar)", vacio && columnas.join(",") === "Área,Ver,Crear,Editar,Revisar,Aprobar,Anular,Administrar" && antes[0] === false && (await ver.isChecked()), `${vacio} ${columnas.join(",")}`);
  await page.getByLabel("Ver en Respaldos", { exact: true }).check();
  const respaldos = await page.getByLabel("Hasta dónde: Ver en Respaldos").locator("option").allInnerTexts();
  check("[cob:A:A-172] «Hasta dónde» aparece al marcar la casilla con los alcances (Muestras: Todo, Solo el estado…); en Respaldos solo «Todo»", antes[1] === 0 && opciones[0] === "Todo" && opciones.length > 3 && elegido === "estado" && respaldos.join() === "Todo" && (await page.getByLabel("Crear en Respaldos").count()) === 0, `${opciones.join(",")} → ${elegido} | respaldos ${respaldos.join(",")}`);
  const documentales = page.getByTestId("permisos-documentales");
  const casillas = await documentales.locator('input[type="checkbox"]').count();
  await documentales.getByText("Consultar vigentes", { exact: false }).first().click().catch(() => undefined);
  check("[cob:A:A-173] Documentos SGC: 14 acciones documentales sin alcance", casillas === 14 && (await documentales.locator("select").count()) === 0, String(casillas));
  const reglas = page.locator('[role="status"], div').filter({ hasText: /^Combinaciones de roles prohibidas/ }).last();
  const lis = await v.getByText("Combinaciones de roles prohibidas").locator("xpath=ancestor::*[.//ul][1]").locator("ul li").count();
  check("[cob:A:A-174] aviso «Combinaciones de roles prohibidas» con las 4 reglas", lis === 4, `${lis} ${await reglas.count()}`);
  const firma0 = filas("SELECT modulo, accion, alcance FROM rol_acciones WHERE id_rol = ?", Rperm.id).length;
  await v.getByRole("button", { name: "Guardar permisos" }).click();
  await page.locator("#prompt-motivo").fill("Permisos de consulta de cobertura");
  if (await page.locator("#prompt-password").count()) await page.locator("#prompt-password").fill(PASS);
  await page.getByRole("dialog").filter({ has: page.locator("#prompt-motivo") }).getByRole("button", { name: "Guardar permisos" }).click();
  await hastaQue(page, page.locator("[data-sonner-toast]").filter({ hasText: /pendiente/i }).last());
  const sol = fila("SELECT tipo, datos_json FROM solicitudes_autorizacion WHERE entidad = 'roles' AND entidad_id = ? AND estado = 'pendiente' ORDER BY id DESC LIMIT 1", String(Rperm.id));
  check("[cob:A:A-171] [cob:A:A-172] [cob:A:A-173] guardar permisos nuevos los deja por autorizar (ampliar_permisos_rol) sin aplicarlos", firma0 === 0 && sol?.tipo === "ampliar_permisos_rol" && filas("SELECT id FROM rol_acciones WHERE id_rol = ?", Rperm.id).length === 0 && /estado/.test(sol?.datos_json || ""), `${sol?.tipo} ${String(sol?.datos_json).slice(0, 200)}`);
});

await paso(UA, "roles: rol que pasa a ser propio y alta de rol", async (page) => {
  const v = await ventanaRol(page, Reditar.id);
  await v.getByRole("button", { name: "Editar permisos" }).click();
  await page.getByLabel("Ver en Muestras", { exact: true }).waitFor();
  // Otra persona le asigna este rol mientras lo edita: al refrescar la sesión el editor se cierra.
  const asig = await asignar(UA.id, Reditar.id);
  const me = page.waitForResponse((r) => r.url().endsWith("/api/auth/me") && r.status() === 200);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await me;
  const aviso = v.getByText("No puedes editar un rol que tienes asignado");
  const vio = await aviso.waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check("[cob:A:A-168] con el rol ya asignado a quien edita: «No puedes editar un rol que tienes asignado» y sin editor", asig.status < 300 && vio && (await page.getByLabel("Ver en Muestras", { exact: true }).count()) === 0, `${asig.status} aviso=${vio}`);

  // Nuevo rol.
  await page.goto(`${BASE_WEB}/administracion/roles`);
  await page.getByRole("button", { name: "Nuevo rol" }).click();
  const dialogo = page.getByRole("dialog", { name: "Nuevo rol" });
  await dialogo.waitFor();
  let r = await intentar(page, dialogo.getByRole("button", { name: "Crear rol" }), ["role-nombre"]);
  const n0 = Number(fila("SELECT COUNT(*) AS n FROM roles")?.n);
  check("[cob:A:A-177] nombre vacío: se marca y no se crea", r.tipo !== "servidor" && r.todos, `${r.tipo} ${r.texto}`);
  await page.locator("#role-nombre").fill("Técnico Auxiliar");
  r = await intentar(page, dialogo.getByRole("button", { name: "Crear rol" }), []);
  check("[cob:A:A-177] nombre repetido: el servidor lo rechaza (409) y no se crea", r.tipo === "servidor" && /existe|nombre/i.test(r.texto) && Number(fila("SELECT COUNT(*) AS n FROM roles")?.n) === n0, `${r.tipo} ${r.texto}`);
  const nombre = `Cob UI Nuevo ${s5}`;
  await page.locator("#role-nombre").fill(nombre);
  await page.locator("#role-descripcion").fill("Rol creado desde la pantalla de cobertura");
  await dialogo.getByRole("button", { name: "Crear rol" }).click();
  await toast(page, /Rol creado: ahora define sus permisos/);
  const nuevo = fila("SELECT id, descripcion FROM roles WHERE nombre = ?", nombre);
  if (nuevo?.id) rolesPropios.push(Number(nuevo.id));
  check("[cob:A:A-177] con nombre y descripción: «Rol creado: ahora define sus permisos», sin permisos", nuevo?.descripcion === "Rol creado desde la pantalla de cobertura" && filas("SELECT id FROM rol_acciones WHERE id_rol = ?", nuevo?.id).length === 0, JSON.stringify(nuevo));
});

await nav.cerrar();

/* ---------- Limpieza: solicitudes propias rechazadas, cuentas de baja, roles inactivos ---------- */
{
  let fallas = 0;
  const pendientes = filas(
    `SELECT id FROM solicitudes_autorizacion WHERE estado = 'pendiente' AND ((entidad = 'usuarios' AND entidad_id IN (${creadas.map(() => "?").join(",") || "NULL"})) OR (entidad = 'roles' AND entidad_id IN (${rolesPropios.map(() => "?").join(",") || "NULL"})))`,
    ...creadas.map(String),
    ...rolesPropios.map(String),
  );
  for (const p of pendientes) {
    const r = await api("POST", `/solicitudes/${p.id}/rechazar`, { motivo: "Limpieza de la prueba de cobertura" }, t.ana);
    if (r.status !== 200) fallas += 1;
  }
  for (const idc of creadas) {
    if (Number(usuario(idc)?.activo) !== 1) continue;
    const r = await api("DELETE", `/admin/usuarios/${idc}`, { motivo: "Fin de la prueba de cobertura" }, t.jorge);
    if (r.status !== 200) fallas += 1;
  }
  for (const rid of rolesPropios) {
    const r = fila("SELECT nombre, descripcion, activo FROM roles WHERE id = ?", rid);
    if (!r || !Number(r.activo)) continue;
    const permisos = filas("SELECT modulo, accion, alcance FROM rol_acciones WHERE id_rol = ?", rid);
    const res = await api("PUT", `/admin/roles/${rid}`, { nombre: r.nombre, descripcion: r.descripcion, activo: false, permisos, motivo: "Fin de la prueba de cobertura" }, t.jorge);
    if (res.status !== 200) fallas += 1;
  }
  check("(limpieza) solicitudes propias rechazadas, cuentas propias de baja y roles propios inactivos", fallas === 0, `fallas=${fallas} pendientes=${pendientes.length}`);
}

terminar();
