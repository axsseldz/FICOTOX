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
const { pdfConTexto } = await import("../lib/archivos.mjs");

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

/* ---------- Más cuentas y roles propios: acceso, sesión, Mi cuenta y acciones de Usuarios y Roles ---------- */
// IP propia para los intentos fallidos (TRUST_PROXY): no bloquean la del navegador de otras suites.
const ipBase = `10.${100 + Math.floor(Math.random() * 150)}.${Math.floor(Math.random() * 250)}`;
let ipN = 0;
const ipPropia = () => ({ "X-Forwarded-For": `${ipBase}.${(ipN += 1)}` });
const conIp = () => ({ extraHTTPHeaders: ipPropia() });
const UB = await cuenta("De Baja");
const UL1 = await cuenta("Bloqueada Uno");
const UL2 = await cuenta("Bloqueada Dos");
const USP = await cuenta("Sin Permisos", { headers: SIN_APROBAR });
const UP = await cuenta("Cambio Obligatorio");
const UI = await cuenta("Inactividad");
const UX = await cuenta("Sesiones");
const UPW = await cuenta("Clave Propia");
const UFo = await cuenta("Foto Propia");
const UAC = await cuenta("Cargo");
const UD1 = await cuenta("Baja Menu");
const UD2 = await cuenta("Baja Hoja");
const UA2 = await cuenta("Admin Dos", { rolClave: "admin_tecnico" });
const [RA1, RA2, Rdes, Rquita, Rdatos] = [await rolPropio("Aprueba Uno"), await rolPropio("Aprueba Dos"), await rolPropio("Desactivar"), await rolPropio("Quitar"), await rolPropio("Datos")];
const ponerPermisos = (r, permisos) => api("PUT", `/admin/roles/${r.id}`, { nombre: r.nombre, descripcion: "Rol de la prueba de cobertura", activo: true, permisos, motivo: "Permisos de la prueba de cobertura" }, t.jorge);
// Dos roles que permiten otorgar autorizaciones (ensayos:A) y ver Usuarios: la cuenta «Cargo» debe elegir con cuál actúa.
const APRUEBA = [{ modulo: "usuarios", accion: "V", alcance: "total" }, { modulo: "ensayos", accion: "V", alcance: "total" }, { modulo: "ensayos", accion: "A", alcance: "total" }];
const permisosA = [await ponerPermisos(RA1, APRUEBA), await ponerPermisos(RA2, APRUEBA), await ponerPermisos(Rquita, [{ modulo: "muestras", accion: "V", alcance: "total" }])];
const asigA = [await asignar(UAC.id, RA1.id), await asignar(UAC.id, RA2.id)];
const bajaUB = await api("DELETE", `/admin/usuarios/${UB.id}`, { motivo: "Cuenta de baja de la prueba de cobertura" }, t.jorge);
// Bloqueo por intentos fallidos (5), cada cuenta desde su IP.
for (const c of [UL1, UL2]) {
  const ip = ipPropia();
  for (let i = 0; i < 5; i += 1) await api("POST", "/auth/login", { email: c.email, password: "incorrecta-000" }, undefined, ip);
}
// Contraseña restablecida por la administración: cambio obligatorio al entrar.
const restUP = await api("POST", `/admin/usuarios/${UP.id}/password`, { motivo: "Contraseña olvidada de la prueba de cobertura" }, t.jorge);
const TEMP_UP = String(restUP.data?.password_temporal || "");
const prep2 = [UB, UL1, UL2, USP, UP, UI, UX, UPW, UFo, UAC, UD1, UD2, UA2].map((c) => c.status).concat([RA1, RA2, Rdes, Rquita, Rdatos].map((r) => r.status));
check(
  "(preparación) cuentas de baja, bloqueadas, sin roles, con cambio obligatorio y con dos cargos; roles con permisos",
  prep2.every((st) => st === 201) && permisosA.every((r) => r.status < 300) && asigA.every((r) => r.status < 300) && bajaUB.status === 200 && Number(usuario(UB.id)?.activo) === 0 && [UL1, UL2].every((c) => !!usuario(c.id)?.bloqueado_hasta) && TEMP_UP.length >= 10 && Number(usuario(UP.id)?.debe_cambiar_password) === 1 && filas("SELECT id FROM rol_acciones WHERE id_rol = ?", RA2.id).length === 3 && filas("SELECT id FROM rol_acciones WHERE id_rol = ?", Rquita.id).length === 1 && !!asignacion(UAC.id, RA1.id) && !!asignacion(UAC.id, RA2.id),
  `${prep2.join(",")} permisos=${permisosA.map((r) => r.status)} asig=${asigA.map((r) => r.status)} baja=${bajaUB.status} rest=${restUP.status}`,
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
/* Cada sección: [título del enlace en el índice (matriz 6.1), título de la sección]. */
const SECCIONES = { empezar: ["Cómo usar la plataforma", "Cómo usar la plataforma"], buscar: ["Buscar", "Buscar"], muestras: ["Flujo de una muestra", "Flujo de una muestra"], extraccion: ["Extracciones ASP y DSP", "Extracciones ASP y DSP"], analisis: ["Análisis y firmas", "Análisis, revisión y aprobación"], informes: ["Informes", "Informes de resultados"], inventario: ["Inventario y avisos", "Inventario y avisos"], calidad: ["Calidad y auditoría", "Calidad y auditoría"], documentos: ["Documentos SGC", "Documentos SGC"], anular: ["Corregir un registro", "Corregir un registro"], atajos: ["Atajos", "Atajos de teclado"] };
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
  // Pulsar el enlace del índice cambia el hash, deja la sección a la vista y la marca (aria-current).
  const seccion = async (ancla) => {
    const enlace = indice.locator(`a[href="#${ancla}"]`);
    const datos = { enIndice: await enlace.count(), enlace: (await enlace.innerText().catch(() => "")).trim(), h2: await page.locator(`section#${ancla} h2`).innerText().catch(() => ""), largo: (await page.locator(`section#${ancla}`).innerText().catch(() => "")).length };
    await enlace.click();
    datos.lleva = await page.waitForFunction((a) => {
      const r = document.getElementById(a)?.getBoundingClientRect();
      return location.hash === `#${a}` && !!r && r.top < window.innerHeight && r.bottom > 0 && document.querySelector(`nav[aria-label="Índice"] a[href="#${a}"]`)?.getAttribute("aria-current") === "location";
    }, ancla, { timeout: 15_000 }).then(() => true, () => false);
    return datos;
  };
  for (const [ancla, [enlace, titulo]] of Object.entries(SECCIONES)) {
    const d = await seccion(ancla);
    check(`[cob:A:ayuda-${ancla}] Ayuda #${ancla}: el índice dice «${enlace}» y lleva a la sección «${titulo}» (a la vista y marcada), con contenido`, d.enIndice === 1 && d.enlace === enlace && d.h2 === titulo && d.largo > 200 && d.lleva, JSON.stringify(d));
  }
  const sc = await seccion("cuenta");
  check("[cob:A:ayuda-cuenta] Ayuda #cuenta: el índice dice «Tu cuenta y la sesión» y lleva a la sección (a la vista y marcada), con contenido", sc.enIndice === 1 && sc.enlace === "Tu cuenta y la sesión" && sc.h2 === "Tu cuenta y la sesión" && sc.largo > 200 && sc.lleva, JSON.stringify(sc));
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
  check("[cob:A:A-109] Ordenar por: Nombre A–Z (por omisión), Fecha de alta (la más nueva primero) y Último acceso (quien entró, primero)", nombres.join("|") === ordenNombre.join("|") && noCrece(porAlta) && porAlta[0] === creadas.map(creado).sort().at(-1) && noCrece(porAcceso) && porAcceso[0] !== "", `${nombres.join("|")} || alta ${porAlta.join(",")} || acceso ${porAcceso.join(",")}`);

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

/* ---------- Utilidades de las pruebas de acceso, sesión y Mi cuenta ---------- */
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const enTijuana = (iso, op) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/Tijuana", hourCycle: "h23", ...op }).format(new Date(iso));
const horaTijuana = (iso) => enTijuana(iso, { hour: "2-digit", minute: "2-digit" });
const tokenDe = (page) => page.evaluate(() => localStorage.getItem("ficotox_access_token"));
const permisosDe = async (token) => (await api("GET", "/auth/me", undefined, token)).data || {};
const revocada = (idu) => fila("SELECT motivo FROM sesiones_revocadas WHERE usuario_id = ? ORDER BY revocada_en DESC LIMIT 1", idu)?.motivo;
const limpio = (x) => String(x || "").replace(/\s+/g, " ").trim();
/* Diálogo de motivo (con «Tu contraseña» si es crítico), aunque haya otra ventana abierta debajo. */
async function conMotivo(page, motivo, confirmar, password) {
  const dialogo = page.getByRole("dialog").filter({ has: page.locator("#prompt-motivo") });
  await dialogo.waitFor();
  await page.locator("#prompt-motivo").fill(motivo);
  if (password && (await page.locator("#prompt-password").count())) await page.locator("#prompt-password").fill(password);
  await dialogo.getByRole("button", { name: confirmar, exact: true }).click();
  return dialogo;
}
const errorAcceso = (page) => page.locator('form [role="alert"]');
async function entrarConFormulario(page, email, password) {
  await page.goto(`${BASE_WEB}/login`);
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: /^Entrar/ }).click();
}
const abrirMiCuenta = async (page) => {
  await page.getByRole("button", { name: "Menú de usuario" }).click();
  await page.getByRole("menuitem", { name: "Mi cuenta" }).click();
  const hoja = page.getByRole("dialog", { name: "Mi cuenta" });
  await hoja.waitFor();
  return hoja;
};

/* ---------- Acceso: correo, errores del servidor, Entrar e Inicio ---------- */
const ipBloqueada = ipPropia();
const fallosIp = [];
for (let i = 0; i < 20; i += 1) fallosIp.push((await api("POST", "/auth/login", { email: `cob.ui.noexiste.${s5}.${i}@ficotox.local`, password: "incorrecta-000" }, undefined, ipBloqueada)).status);
await paso(null, "acceso: correo, errores del servidor y Entrar", async (page) => {
  const envios = [];
  page.on("request", (r) => r.url().endsWith("/api/auth/login") && r.method() === "POST" && envios.push(r.url()));
  await page.goto(`${BASE_WEB}/login`);
  const correo = page.locator("#login-email");
  const placeholder = await correo.getAttribute("placeholder");
  await correo.fill("persona.sin.arroba");
  await page.locator("#login-password").fill("cualquier-cosa");
  await page.getByRole("button", { name: /^Entrar/ }).click();
  const avisoCorreo = page.locator("#login-email-error");
  await avisoCorreo.waitFor();
  const textoCorreo = await avisoCorreo.innerText();
  const enfocado = await page.evaluate(() => document.activeElement?.id);
  check("[cob:A:A-001] correo sin «@» (placeholder «nombre@cicese.mx»): «Escribe tu correo completo, por ejemplo nombre@cicese.mx», el campo en rojo con el foco y no se envía", /Escribe tu correo completo, por ejemplo nombre@cicese\.mx/.test(textoCorreo) && enfocado === "login-email" && (await correo.getAttribute("aria-invalid")) === "true" && envios.length === 0 && placeholder === "nombre@cicese.mx", `«${textoCorreo}» foco=${enfocado} envíos=${envios.length} «${placeholder}»`);

  const fallo = async (email, password, re) => {
    await correo.fill(email);
    await page.locator("#login-password").fill(password);
    const respuesta = page.waitForResponse((x) => x.url().endsWith("/api/auth/login") && x.request().method() === "POST");
    await page.getByRole("button", { name: /^Entrar/ }).click();
    const st = (await respuesta).status();
    await esperar(async () => re.test(await errorAcceso(page).innerText().catch(() => "")), 10_000);
    return { st, texto: limpio(await errorAcceso(page).innerText().catch(() => "")), url: new URL(page.url()).pathname };
  };
  const mala = await fallo(UR.email, "incorrecta-000", /Correo o contraseña incorrectos/);
  const baja = await fallo(UB.email, PASS, /Usuario inactivo/);
  const futura = await fallo(UFut.email, PASS, /no está vigente/);
  check("[cob:A:A-005] el aviso del formulario dice lo que respondió el servidor: contraseña incorrecta (401), cuenta de baja «Usuario inactivo» (403) y fuera de vigencia (403); se queda en el acceso", mala.st === 401 && mala.texto === "Correo o contraseña incorrectos. Después de varios intentos fallidos el acceso se bloquea temporalmente." && baja.st === 403 && baja.texto === "Usuario inactivo" && futura.st === 403 && futura.texto === "Tu acceso no está vigente; contacta al administrador" && [mala, baja, futura].every((x) => x.url === "/login") && !(await tokenDe(page)), JSON.stringify([mala, baja, futura]));

  await correo.fill(UH.email);
  const clave = page.locator("#login-password");
  const tipo = await clave.getAttribute("type");
  await clave.fill(PASS);
  const acceso0 = usuario(UH.id)?.ultimo_acceso;
  await page.getByRole("button", { name: /^Entrar/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120_000 });
  const me = await permisosDe(await tokenDe(page));
  check("[cob:A:A-002] [cob:A:A-006] «Contraseña» (oculta) y «Entrar» con datos correctos: sale del acceso con la sesión de esa cuenta y registra el acceso", tipo === "password" && Number(me.user?.id) === UH.id && !!usuario(UH.id)?.ultimo_acceso && usuario(UH.id)?.ultimo_acceso !== acceso0, `tipo=${tipo} usuario=${me.user?.id} acceso ${acceso0} → ${usuario(UH.id)?.ultimo_acceso}`);

  await page.goto(`${BASE_WEB}/`);
  const h1 = page.locator("main h1").first();
  await h1.waitFor();
  const saludo = limpio(await h1.innerText());
  const textoMain = limpio(await page.locator("main").innerText());
  const [a, m, d] = hoy().split("-").map(Number);
  const fecha = `${DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]}, ${d} de ${MESES[m - 1]}`;
  const hora = Number(enTijuana(new Date().toISOString(), { hour: "2-digit" }));
  const esperado = `${hora < 12 ? "Buenos días" : hora < 19 ? "Buenas tardes" : "Buenas noches"}, Cob.`;
  check("[cob:A:A-083] Inicio: saludo según la hora de Tijuana con el nombre («…, Cob.») y la fecha del laboratorio", saludo === esperado && textoMain.includes(fecha), `«${saludo}» (esperado «${esperado}») fecha «${fecha}» en «${textoMain.slice(0, 120)}»`);
}, conIp());
await paso(null, "acceso: equipo bloqueado por intentos", async (page) => {
  await page.goto(`${BASE_WEB}/login`);
  await page.locator("#login-email").fill(UH.email);
  await page.locator("#login-password").fill(PASS);
  const respuesta = page.waitForResponse((x) => x.url().endsWith("/api/auth/login") && x.request().method() === "POST");
  await page.getByRole("button", { name: /^Entrar/ }).click();
  const st = (await respuesta).status();
  await errorAcceso(page).waitFor();
  const texto = limpio(await errorAcceso(page).innerText());
  check("[cob:A:A-005] tras 20 intentos fallidos desde el mismo equipo, aun con la contraseña correcta: 429 «Demasiados intentos fallidos desde este equipo; espera N minutos» y no entra", fallosIp.every((x) => x === 401) && st === 429 && /^Demasiados intentos fallidos desde este equipo; espera \d+ minutos$/.test(texto) && new URL(page.url()).pathname === "/login" && !(await tokenDe(page)), `${fallosIp.join(",")} → ${st} «${texto}»`);
}, { extraHTTPHeaders: ipBloqueada });

/* ---------- Sesión: cargando y cerrada desde otro dispositivo ---------- */
await paso(UX, "sesión: cargando y cerrada desde otro dispositivo", async (page) => {
  let soltar;
  const retenida = new Promise((r) => (soltar = r));
  await page.route("**/api/auth/me", async (route) => {
    await retenida;
    await route.continue();
  });
  const navegacion = page.goto(`${BASE_WEB}/ayuda`);
  const cargando = page.locator('[aria-label="Cargando sesión"]');
  await cargando.waitFor();
  const mientras = { busy: await cargando.getAttribute("aria-busy"), menu: await page.locator('aside[aria-label="Navegación principal"]').count(), ayuda: await page.getByRole("heading", { name: "Cómo se usa FICOTOX" }).count() };
  soltar();
  await navegacion;
  await page.getByRole("heading", { name: "Cómo se usa FICOTOX" }).waitFor();
  await page.unrouteAll({ behavior: "ignoreErrors" });
  check("[cob:A:A-009] mientras /auth/me no responde se ve «Cargando sesión» (aria-busy, sin menú ni contenido); al responder aparece la pantalla", mientras.busy === "true" && mientras.menu === 0 && mientras.ayuda === 0 && (await cargando.count()) === 0, JSON.stringify(mientras));

  // Otro dispositivo cierra todas las sesiones: al refrescar, esta vuelve al acceso con el motivo.
  const otra = await api("POST", "/auth/login", { email: UX.email, password: PASS });
  const tv0 = Number(usuario(UX.id)?.token_version);
  const todas = await api("POST", "/auth/logout-all", {}, otra.data?.token);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForURL((u) => u.pathname === "/login", { timeout: 20_000 });
  const aviso = page.locator('p[role="status"]');
  await aviso.waitFor();
  const texto = limpio(await aviso.innerText());
  await page.reload();
  await page.locator("#login-email").waitFor();
  const otraVez = await page.locator('p[role="status"]').count();
  check("[cob:A:A-008] con las sesiones cerradas desde otro lado, al refrescar vuelve al acceso con «Tu sesión se cerró (cambio de contraseña, bloqueo o cierre en todos los dispositivos)…» (una sola vez)", todas.status === 200 && Number(usuario(UX.id)?.token_version) === tv0 + 1 && /^Tu sesión se cerró \(cambio de contraseña, bloqueo o cierre en todos los dispositivos\)/.test(texto) && otraVez === 0, `${todas.status} tv ${tv0}→${usuario(UX.id)?.token_version} «${texto}» al recargar=${otraVez}`);
});

/* ---------- Cambio de contraseña obligatorio ---------- */
await paso({ email: UP.email, password: TEMP_UP }, "cambio de contraseña obligatorio", async (page) => {
  await page.getByRole("heading", { name: "Cambia tu contraseña" }).waitFor();
  const token1 = await tokenDe(page);
  const otraApi = await api("GET", "/admin/usuarios", undefined, token1);
  const menu = await page.locator('aside[aria-label="Navegación principal"]').count();
  check("[cob:A:A-010] con la contraseña restablecida se ve «Cambia tu contraseña» (sin menú) y la API responde 403 cambiar_password", otraApi.status === 403 && otraApi.data?.codigo === "cambiar_password" && menu === 0, `${otraApi.status} ${otraApi.data?.codigo} menú=${menu}`);
  const hash0 = usuario(UP.id)?.password_hash;
  // Se espera la respuesta del cierre (no solo la petición): la pantalla no la espera para ir al acceso y, con el
  // servidor ocupado, la consulta de abajo podía llegar antes que la revocación.
  const salida = page.waitForResponse((r) => r.url().endsWith("/api/auth/logout") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  const cierre = await salida;
  await page.waitForURL((u) => u.pathname === "/login");
  const tras = await api("GET", "/auth/me", undefined, token1);
  check("[cob:A:A-015] «Salir» revoca la sesión y vuelve al acceso sin cambiar la contraseña", cierre.status() === 200 && tras.status === 401 && revocada(UP.id) === "salir" && usuario(UP.id)?.password_hash === hash0 && Number(usuario(UP.id)?.debe_cambiar_password) === 1, `${tras.status} ${revocada(UP.id)}`);

  await entrarConFormulario(page, UP.email, TEMP_UP);
  await page.getByRole("heading", { name: "Cambia tu contraseña" }).waitFor();
  const envios = [];
  page.on("request", (r) => r.url().endsWith("/api/auth/password") && r.method() === "POST" && envios.push(r.url()));
  const guardar = page.getByRole("button", { name: "Guardar y continuar" });
  let r = await intentar(page, guardar, ["pwd-actual", "pwd-nueva"]);
  check("[cob:A:A-011] [cob:A:A-012] vacío: «Contraseña actual» y «Contraseña nueva» se marcan y no se envía", r.tipo !== "servidor" && r.todos && envios.length === 0, `${r.texto} ${JSON.stringify(r.marcados)}`);
  const NUEVA = `Obligada-${s5}-2026`;
  await page.locator("#pwd-actual").fill(TEMP_UP);
  await page.locator("#pwd-nueva").fill("corta");
  await page.locator("#pwd-confirmar").fill("corta");
  r = await intentar(page, guardar, ["pwd-nueva"]);
  check("[cob:A:A-012] nueva < 10: «La contraseña nueva debe tener al menos 10 caracteres», marcada, sin enviar", /La contraseña nueva debe tener al menos 10 caracteres/.test(r.texto) && r.todos && envios.length === 0, r.texto);
  await page.locator("#pwd-nueva").fill(NUEVA);
  await page.locator("#pwd-confirmar").fill(`${NUEVA}x`);
  r = await intentar(page, guardar, ["pwd-confirmar"]);
  check("[cob:A:A-013] confirmación distinta: «La confirmación no coincide con la contraseña nueva», marcada, sin enviar", /La confirmación no coincide con la contraseña nueva/.test(r.texto) && r.todos && envios.length === 0, r.texto);
  await page.locator("#pwd-actual").fill("incorrecta-000");
  await page.locator("#pwd-confirmar").fill(NUEVA);
  r = await intentar(page, guardar, ["pwd-actual"]);
  check("[cob:A:A-011] actual incorrecta: el servidor la rechaza, «Vuelve a escribir tu contraseña actual.» con el campo marcado y la contraseña no cambia", r.tipo === "aviso" && /Vuelve a escribir tu contraseña actual/.test(r.texto) && r.todos && envios.length === 1 && usuario(UP.id)?.password_hash === hash0, `${r.tipo} ${r.texto} envíos=${envios.length}`);
  // Al cerrar el aviso el foco queda en «Contraseña actual»: lo que se escribe ahí (sobre lo seleccionado) queda en el campo.
  // (Cmd+A seguido de insertText no llega al campo en Chromium sin ventana en macOS; se selecciona desde la página.)
  await page.waitForFunction(() => document.activeElement?.id === "pwd-actual");
  await page.evaluate(() => document.getElementById("pwd-actual")?.select());
  await page.keyboard.type(TEMP_UP);
  const pegada = await page.locator("#pwd-actual").inputValue();
  const foco = await page.evaluate(() => document.activeElement?.id);
  check("[cob:A:A-011] tras el aviso, lo que se escribe en «Contraseña actual» (con el foco puesto por el aviso) queda en el campo", pegada === TEMP_UP && foco === "pwd-actual", `quedó ${pegada.length} caracteres («${pegada === "incorrecta-000" ? "la equivocada" : "otro"}»), se escribieron ${TEMP_UP.length}; foco=${foco}`);
  // Al pulsar el campo se quita la marca del servidor y ya se puede reemplazar.
  await page.locator("#pwd-actual").click();
  await page.locator("#pwd-actual").fill(TEMP_UP);
  const cambio = page.waitForResponse((x) => x.url().endsWith("/api/auth/password") && x.request().method() === "POST");
  await guardar.click();
  const rc = await cambio;
  if (rc.status() !== 200) throw new Error(`cambio ${rc.status()} ${rc.request().postData()?.replace(/"(actual|nueva)":"[^"]*"/g, (m, k) => `"${k}":${m.length}`)} valor=${(await page.locator("#pwd-actual").inputValue()).length}/${TEMP_UP.length}`);
  await toast(page, /Contraseña cambiada; tus otras sesiones se cerraron/);
  await page.locator('aside[aria-label="Navegación principal"]').waitFor();
  const entra = await api("POST", "/auth/login", { email: UP.email, password: NUEVA }, undefined, { "X-Sin-Cambio-Auto": "1", ...ipPropia() });
  check("[cob:A:A-014] «Guardar y continuar» con la actual correcta: cambia la contraseña, quita el cambio obligatorio y entra a la plataforma", Number(usuario(UP.id)?.debe_cambiar_password) === 0 && usuario(UP.id)?.password_hash !== hash0 && entra.status === 200 && !entra.data?.user?.debe_cambiar_password, `debe=${usuario(UP.id)?.debe_cambiar_password} login=${entra.status}`);
}, conIp());

/* ---------- Sin roles vigentes ---------- */
await paso(USP, "sin permisos asignados", async (page) => {
  await page.getByText("Sin permisos asignados").first().waitFor();
  const me = await permisosDe(await tokenDe(page));
  check("[cob:A:A-016] sin roles vigentes (el rol inicial sigue por autorizar): «Sin permisos asignados», sin menú", (me.roles || []).length === 0 && (await page.locator('aside[aria-label="Navegación principal"]').count()) === 0, `roles=${(me.roles || []).length}`);
  await page.getByRole("link", { name: "Ayuda" }).click();
  await page.waitForURL((u) => u.pathname === "/ayuda");
  await page.getByRole("heading", { name: "Cómo se usa FICOTOX" }).waitFor();
  const enAyuda = { sinPermisos: await page.getByText("Sin permisos asignados").count(), menu: await page.locator('aside[aria-label="Navegación principal"]').count() };
  await page.getByRole("link", { name: "Volver" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  await page.getByText("Sin permisos asignados").first().waitFor();
  check("[cob:A:A-017] «Ayuda» abre la guía sin el menú y con «Volver», que regresa al aviso", enAyuda.sinPermisos === 0 && enAyuda.menu === 0, JSON.stringify(enAyuda));
  const token = await tokenDe(page);
  const salida = page.waitForRequest((r) => r.url().endsWith("/api/auth/logout") && r.method() === "POST");
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await salida;
  await page.waitForURL((u) => u.pathname === "/login");
  const tras = await api("GET", "/auth/me", undefined, token);
  check("[cob:A:A-018] «Cerrar sesión» revoca la sesión («salir») y vuelve al acceso", tras.status === 401 && revocada(USP.id) === "salir", `${tras.status} ${revocada(USP.id)}`);
});

/* ---------- Técnico Auxiliar temporal: sin acceso, página inexistente, menú, Ayuda y Mi cuenta ---------- */
await paso(UC, "sin acceso, página inexistente, menú y enlaces de la Ayuda", async (page) => {
  const me = await permisosDe(await tokenDe(page));
  const p = me.permissions || {};
  const pedidas = [];
  page.on("request", (r) => /\/api\/(informes|admin\/roles)(\?|$)/.test(new URL(r.url()).pathname + new URL(r.url()).search) && pedidas.push(new URL(r.url()).pathname));
  await page.goto(`${BASE_WEB}/informes`);
  await page.getByText("Sin acceso a esta sección").first().waitFor();
  await page.goto(`${BASE_WEB}/administracion/roles`);
  await page.getByText("Sin acceso a esta sección").first().waitFor();
  const propio = await page.getByText("Solo puedes ver tu propia cuenta.").isVisible();
  check("[cob:A:A-019] [cob:A:A-158] sin informes:V, /informes dice «Sin acceso a esta sección»; con usuarios:V «propio», Roles también («Solo puedes ver tu propia cuenta.»), sin pedir sus datos", !p.informes?.V && p.usuarios?.V === "propio" && propio && pedidas.length === 0 && (await page.locator('[aria-label="Roles"] li[data-rol]').count()) === 0, `informes=${p.informes?.V} usuarios=${p.usuarios?.V} pedidas=${pedidas}`);

  await page.goto(`${BASE_WEB}/no-existe-cobertura-${s5}`);
  await page.getByRole("heading", { name: "Esta página no existe" }).waitFor();
  await page.getByRole("link", { name: "Ir al inicio" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  await page.locator("main h1").first().waitFor();
  check("[cob:A:A-020] [cob:A:A-021] una ruta inexistente muestra «Esta página no existe» e «Ir al inicio» lleva al Inicio", (await page.getByRole("heading", { name: "Esta página no existe" }).count()) === 0);

  await page.goto(`${BASE_WEB}/administracion/usuarios?nuevo=1`);
  await page.getByRole("heading", { name: "Usuarios" }).first().waitFor();
  await esperar(async () => (await filasUsuarios(page)).length > 0, 15_000);
  const lista = await filasUsuarios(page);
  const deApi = (await api("GET", "/admin/usuarios", undefined, await tokenDe(page))).data?.items || [];
  check("[cob:A:A-101] [cob:A:A-102] con usuarios:V «propio», Usuarios solo trae la cuenta propia, sin «Filtros» ni «Nuevo usuario» (?nuevo=1 no abre el alta)", lista.join() === String(UC.id) && deApi.length === 1 && Number(deApi[0]?.id) === UC.id && (await page.getByRole("button", { name: /^Filtros/ }).count()) === 0 && (await page.getByRole("button", { name: "Nuevo usuario" }).count()) === 0 && (await page.getByRole("dialog", { name: "Nuevo usuario" }).count()) === 0, `${lista} api=${deApi.length}`);
  const v = await ventanaUsuario(page, UC.id);
  await v.getByRole("tab", { name: "Autorizaciones" }).click();
  const lista2 = page.locator('#autorizaciones-usuario [aria-label="Autorizaciones FX-THF-AP"]');
  await lista2.waitFor();
  const vigentes = filas("SELECT id FROM autorizaciones_personal WHERE usuario_id = ? AND revocada_en IS NULL AND (vigente_hasta IS NULL OR vigente_hasta >= ?)", UC.id, hoy()).map((x) => String(x.id));
  const enPantalla = await lista2.locator("[data-autorizacion]").evaluateAll((els) => els.map((e) => e.getAttribute("data-autorizacion")));
  check("[cob:A:A-153] la persona ve sus propias «Autorizaciones FX-THF-AP» (las mismas que tiene registradas), sin «Agregar» ni «Revocar»", vigentes.length === 2 && enPantalla.sort().join() === vigentes.sort().join() && (await page.locator("#autorizaciones-usuario").getByRole("button", { name: /Agregar|Revocar/ }).count()) === 0, `${enPantalla} vs ${vigentes}`);
  await page.keyboard.press("Escape");

  // Menú: Inicio, Documentos SGC y Reportar incidencia según los permisos.
  await page.goto(`${BASE_WEB}/ayuda`);
  const aside = page.locator('aside[aria-label="Navegación principal"]');
  await aside.waitFor();
  await aside.locator('a[href="/"]').first().click();
  await page.waitForURL((u) => u.pathname === "/");
  check("[cob:A:A-038] «Inicio» del menú lleva al Inicio (saludo)", /^(Buenos días|Buenas tardes|Buenas noches), Cob\.$/.test(limpio(await page.locator("main h1").first().innerText())));
  const docs = {};
  for (const href of ["/documentos", "/documentos/bandeja", "/documentos/solicitudes", "/documentos/externos", "/documentos/lista-maestra"]) docs[href] = (await aside.locator(`a[href="${href}"]`).count()) > 0;
  const esperadoDocs = { "/documentos": !!(p.documentos?.V || p.usuarios?.G) };
  for (const href of ["/documentos/bandeja", "/documentos/solicitudes", "/documentos/externos", "/documentos/lista-maestra"]) esperadoDocs[href] = !!p.documentos?.V;
  check("[cob:A:A-039] Técnico Auxiliar: Documentos SGC muestra lo que permiten sus permisos (Documentos: documentos:V o usuarios:G; Bandeja, Solicitudes, Externos y Lista Maestra: documentos:V)", JSON.stringify(docs) === JSON.stringify(esperadoDocs), `${JSON.stringify(docs)} esperado ${JSON.stringify(esperadoDocs)} documentos.V=${p.documentos?.V}`);
  const reportar = page.locator("[data-reportar-incidencia-boton]");
  const hayReportar = await reportar.count();
  await reportar.click();
  const ventanaReporte = page.getByRole("dialog", { name: "Reportar incidencia" });
  await ventanaReporte.waitFor();
  await page.keyboard.press("Escape");
  await ventanaReporte.waitFor({ state: "detached" });
  check("[cob:A:A-052] con calidad:C (incidencias) aparece «Reportar incidencia» en el menú y abre su formulario", !!p.calidad?.C && hayReportar === 1);

  // Enlaces de la Ayuda según los permisos.
  await page.goto(`${BASE_WEB}/ayuda`);
  await page.getByRole("heading", { name: "Cómo se usa FICOTOX" }).waitFor();
  const recepcion = await page.getByRole("link", { name: "Nueva recepción" }).count();
  const informe = await page.getByRole("link", { name: "Nuevo informe" }).count();
  await page.getByRole("link", { name: "Nueva recepción" }).click();
  await page.waitForURL((u) => u.pathname === "/muestras/recepcion/nueva");
  check("[cob:A:A-181] Ayuda con muestras:C (recepción) y sin informes:C: «Nueva recepción» (lleva al alta) y no «Nuevo informe»", !!p.muestras?.C && !p.informes?.C && recepcion === 1 && informe === 0, `muestras.C=${p.muestras?.C} informes.C=${p.informes?.C} ${recepcion} ${informe}`);
});

await paso(UC, "mi cuenta: menú, roles, temporal, autorizaciones y seguridad", async (page) => {
  const me = await permisosDe(await tokenDe(page));
  const cfg = (await api("GET", "/auth/config")).data || {};
  await page.goto(`${BASE_WEB}/ayuda`);
  const boton = page.getByRole("button", { name: "Menú de usuario" });
  const textoBoton = limpio(await boton.innerText());
  const figura = await boton.locator("svg, img").count();
  await boton.click();
  const opciones = (await page.getByRole("menuitem").allInnerTexts()).map(limpio);
  check("[cob:A:A-054] «Menú de usuario» muestra el nombre y la figura, y ofrece Mi cuenta, el tema y Cerrar sesión", textoBoton.includes(UC.nombre) && figura > 0 && opciones[0] === "Mi cuenta" && /^Tema (oscuro|claro)$/.test(opciones[1]) && opciones.at(-1) === "Cerrar sesión", `«${textoBoton}» figura=${figura} ${opciones.join(" | ")}`);
  await page.getByRole("menuitem", { name: "Mi cuenta" }).click();
  const hoja = page.getByRole("dialog", { name: "Mi cuenta" });
  await hoja.waitFor();
  const textoHoja = limpio(await hoja.innerText());
  check("[cob:A:A-055] [cob:A:A-086] «Mi cuenta» abre su ventana con el nombre y el correo de la cuenta", textoHoja.includes(UC.nombre) && textoHoja.includes(UC.email));
  const roles = (await hoja.locator('ul[aria-label="Roles vigentes"] li').allInnerTexts()).map(limpio);
  const esperados = (me.roles || []).map((r) => `${r.nombre}${r.vigente_hasta ? ` · hasta ${fmt(r.vigente_hasta)}` : ""}`);
  check("[cob:A:A-087] «Roles vigentes» lista los roles de la cuenta con «· hasta <fecha>» cuando tienen fin", esperados.length > 0 && roles.join("|") === esperados.join("|"), `${roles.join("|")} vs ${esperados.join("|")}`);
  const supervisado = (me.roles || []).some((r) => Object.values(r.permisos || {}).some((acciones) => Object.values(acciones || {}).includes("supervisado")));
  const temporal = limpio(await hoja.getByText(/^Cuenta temporal/).innerText());
  const base = `Cuenta temporal vigente hasta el ${fmt(usuario(UC.id).vigente_hasta)}.`;
  check("[cob:A:A-089] cuenta temporal: «Cuenta temporal vigente hasta el <fecha>.»; lo del visto bueno del supervisor solo si algún rol tiene alcance «supervisado»", temporal === (supervisado ? `${base} Lo que capturas en equipos e inventario queda pendiente del visto bueno de tu supervisor.` : base), `«${temporal}» supervisado=${supervisado}`);
  const vigentes = filas("SELECT id FROM autorizaciones_personal WHERE usuario_id = ? AND revocada_en IS NULL AND (vigente_hasta IS NULL OR vigente_hasta >= ?)", UC.id, hoy()).map((x) => String(x.id));
  await esperar(async () => (await hoja.locator("#mis-autorizaciones [data-autorizacion]").count()) > 0, 10_000);
  const mias = await hoja.locator("#mis-autorizaciones [data-autorizacion]").evaluateAll((els) => els.map((e) => e.getAttribute("data-autorizacion")));
  check("[cob:A:A-091] «Mis autorizaciones» lista las FX-THF-AP vigentes de la cuenta", vigentes.length === 2 && mias.sort().join() === vigentes.sort().join(), `${mias} vs ${vigentes}`);
  const seguridad = `Tu sesión se cierra tras ${cfg.sesion?.inactividad_min} minutos sin actividad y, en todo caso, a las ${cfg.sesion?.expira_horas} horas.`;
  check("[cob:A:A-092] «Seguridad» dice los minutos de inactividad y las horas de la sesión que da /auth/config", !!cfg.sesion?.inactividad_min && textoHoja.includes(seguridad), seguridad);
  await page.keyboard.press("Escape");
  await hoja.waitFor({ state: "detached" });
  // Al cargar con #mis-autorizaciones: Mi cuenta abierta en esa sección y el hash se quita.
  await page.goto(`${BASE_WEB}/#mis-autorizaciones`);
  await hoja.waitFor();
  const llego = await page.waitForFunction(() => {
    const r = document.getElementById("mis-autorizaciones")?.getBoundingClientRect();
    return location.hash === "" && !!r && r.top >= 0 && r.top < window.innerHeight;
  }, null, { timeout: 10_000 }).then(() => true, () => false);
  check("[cob:A:A-059] /#mis-autorizaciones abre Mi cuenta en «Mis autorizaciones» (a la vista) y quita el hash", llego);
});

/* ---------- Inactividad: aviso, seguir, bloqueo y volver a entrar (S-25) ---------- */
await paso(UI, "inactividad: aviso, bloqueo y volver a entrar", async (page) => {
  await page.goto(`${BASE_WEB}/`);
  const campo = page.locator('main input[aria-label="Buscar en FICOTOX"]');
  await campo.waitFor();
  // Plazo de prueba (solo en desarrollo): 8 s sin actividad, aviso 4 s antes.
  await page.evaluate(() => localStorage.setItem("ficotox.prueba.inactividad-seg", "8"));
  await page.reload();
  await campo.waitFor();
  const aviso = page.getByRole("dialog", { name: "Tu sesión está por cerrarse" });
  await aviso.waitFor({ timeout: 20_000 });
  const textoAviso = limpio(await aviso.innerText());
  await aviso.getByRole("button", { name: "Seguir trabajando" }).click();
  await aviso.waitFor({ state: "detached" });
  const bloqueo = page.getByText("Sesión cerrada por inactividad");
  const sigue = (await bloqueo.count()) === 0 && !!(await tokenDe(page));
  check("[cob:A:A-030] [cob:A:A-031] sin actividad avisa «Tu sesión está por cerrarse» («se cerrará en N segundos»); «Seguir trabajando» la mantiene abierta", /se cerrará en \d+ segundos/.test(textoAviso) && sigue, textoAviso);

  await campo.fill(`capturado ${s5}`);
  const token1 = await tokenDe(page);
  const salida = page.waitForRequest((r) => r.url().endsWith("/api/auth/logout") && r.method() === "POST", { timeout: 30_000 });
  await bloqueo.waitFor({ timeout: 30_000 });
  const cuerpo = (await salida).postData() || "";
  await esperar(async () => revocada(UI.id) === "inactividad", 10_000);
  const tras = await api("GET", "/auth/me", undefined, token1);
  check("[cob:A:A-032] al vencer el plazo: «Sesión cerrada por inactividad», la sesión se revoca («inactividad») y lo capturado sigue debajo", /inactividad/.test(cuerpo) && revocada(UI.id) === "inactividad" && tras.status === 401 && (await campo.inputValue()) === `capturado ${s5}`, `${cuerpo} ${revocada(UI.id)} ${tras.status}`);
  const volver = page.getByRole("button", { name: "Volver a entrar" });
  const sinClave = await volver.isDisabled();
  await page.locator("#bloqueo-password").fill("incorrecta-000");
  await volver.click();
  const rechazo = await esperar(async () => /Correo o contraseña incorrectos/.test(await page.locator("#bloqueo-password").locator("xpath=ancestor::div[1]/..").innerText().catch(() => "")) || (await page.locator("#bloqueo-password").getAttribute("aria-invalid")) === "true", 10_000);
  const sigueBloqueada = (await bloqueo.count()) === 1;
  // Sin el plazo de prueba, al volver a entrar no se vuelve a cerrar en segundos.
  await page.evaluate(() => localStorage.removeItem("ficotox.prueba.inactividad-seg"));
  await page.locator("#bloqueo-password").fill(PASS);
  await volver.click();
  await bloqueo.waitFor({ state: "detached" });
  const token2 = await tokenDe(page);
  const vale = await api("GET", "/auth/me", undefined, token2);
  check("[cob:A:A-033] [cob:A:A-034] [cob:A:S-25] «Volver a entrar» está deshabilitado sin contraseña; con una equivocada sigue bloqueada; con la correcta se reabre sin desmontar la página (lo capturado sigue)", sinClave && !!rechazo && sigueBloqueada && token2 && token2 !== token1 && vale.status === 200 && (await campo.inputValue()) === `capturado ${s5}`, `deshabilitado=${sinClave} rechazo=${!!rechazo} bloqueada=${sigueBloqueada} me=${vale.status} valor=${await campo.inputValue()}`);

  await page.evaluate(() => localStorage.setItem("ficotox.prueba.inactividad-seg", "8"));
  await page.reload();
  await bloqueo.waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Salir \(se descarta lo capturado\)$/ }).click();
  await page.waitForURL((u) => u.pathname === "/login");
  check("[cob:A:A-035] «Salir (se descarta lo capturado)» deja el bloqueo y vuelve al acceso sin sesión", !(await tokenDe(page)) && (await page.locator("#login-email").isVisible()));
}, conIp());

/* ---------- Restablecer contraseña: motivo, «Tu contraseña» y «Confirma tu identidad» ---------- */
await paso(UA2, "restablecer: motivo, contraseña y Confirma tu identidad", async (page) => {
  let menu = await acciones(page, UA2);
  const propio = await menu.getByRole("menuitem", { name: "Restablecer contraseña…" }).count();
  await page.keyboard.press("Escape");
  menu = await acciones(page, UB);
  const deBaja = await menu.getByRole("menuitem", { name: "Restablecer contraseña…" }).count();
  await page.keyboard.press("Escape");
  const hash0 = usuario(UR.id)?.password_hash;
  menu = await acciones(page, UR);
  const enActiva = await menu.getByRole("menuitem", { name: "Restablecer contraseña…" }).count();
  await menu.getByRole("menuitem", { name: "Restablecer contraseña…" }).click();
  const dialogo = page.getByRole("dialog").filter({ has: page.locator("#prompt-motivo") });
  await dialogo.waitFor();
  const conClave = await dialogo.getByLabel("Tu contraseña").count();
  const restablecer = dialogo.getByRole("button", { name: "Restablecer contraseña", exact: true });
  await page.locator("#prompt-motivo").fill("abc");
  const r = await intentar(page, restablecer, ["prompt-motivo", "prompt-password"]);
  check("[cob:A:A-112] «Restablecer contraseña…» solo para otra persona activa (no en la propia ni en una de baja)", propio === 0 && deBaja === 0 && enActiva === 1, `propia=${propio} baja=${deBaja} activa=${enActiva}`);
  check("[cob:A:A-118] [cob:A:A-027] motivo < 5 y «Tu contraseña» vacía: los dos se marcan («Escribe tu contraseña para confirmar») y no se restablece", r.tipo !== "servidor" && r.todos && /al menos 5 caracteres/.test(r.texto) && /Escribe tu contraseña para confirmar/.test(r.texto) && conClave === 1 && usuario(UR.id)?.password_hash === hash0, `${r.texto} ${JSON.stringify(r.marcados)}`);

  // Contraseña equivocada en el diálogo: el servidor la rechaza y «Confirma tu identidad» la vuelve a pedir.
  await page.locator("#prompt-motivo").fill("La persona olvidó su contraseña");
  await page.locator("#prompt-password").fill("incorrecta-000");
  await restablecer.click();
  const confirma = page.getByRole("dialog", { name: "Confirma tu identidad" });
  await confirma.waitFor();
  const roja = await page.locator("#reauth-password").getAttribute("aria-invalid");
  const textoConfirma = limpio(await confirma.innerText());
  await confirma.getByRole("button", { name: "Cancelar" }).click();
  await confirma.waitFor({ state: "detached" });
  check("[cob:A:A-024] [cob:A:A-026] con la contraseña equivocada aparece «Confirma tu identidad» con el campo en rojo; «Cancelar» no restablece", roja === "true" && /Tu contraseña/.test(textoConfirma) && usuario(UR.id)?.password_hash === hash0 && (await page.getByTestId("password-temporal").count()) === 0, `${roja} «${textoConfirma}»`);

  menu = await acciones(page, UR);
  await menu.getByRole("menuitem", { name: "Restablecer contraseña…" }).click();
  await conMotivo(page, "La persona olvidó su contraseña", "Restablecer contraseña", "incorrecta-001");
  await confirma.waitFor();
  await page.locator("#reauth-password").fill("incorrecta-002");
  await confirma.getByRole("button", { name: "Confirmar", exact: true }).click();
  const otraVez = await esperar(async () => (await page.locator("#reauth-password").inputValue().catch(() => "x")) === "" && (await page.locator("#reauth-password").getAttribute("aria-invalid").catch(() => null)) === "true", 10_000);
  const sinCambio = usuario(UR.id)?.password_hash === hash0;
  await page.locator("#reauth-password").fill(UA2.password);
  await confirma.getByRole("button", { name: "Confirmar", exact: true }).click();
  const temporal = page.getByTestId("password-temporal");
  await temporal.waitFor();
  check("[cob:A:A-025] [cob:A:A-026] en «Confirma tu identidad» una equivocada lo deja vacío y en rojo (sin restablecer); con la correcta «Confirmar» completa la acción", !!otraVez && sinCambio && usuario(UR.id)?.password_hash !== hash0 && Number(usuario(UR.id)?.debe_cambiar_password) === 1 && (await temporal.innerText()).trim().length >= 10, `otra vez=${!!otraVez} sin cambio=${sinCambio}`);
  await page.getByRole("dialog", { name: "Contraseña temporal" }).getByRole("button", { name: "Entendido" }).click();
}, conIp());

/* ---------- Dos cargos: «¿Con qué cargo actúas?», autorizaciones y cargo predeterminado ---------- */
await paso(UAC, "autorizaciones: validación, Actuar como, cargo predeterminado y revocar", async (page) => {
  const v = await ventanaUsuario(page, UH.id);
  await v.getByRole("tab", { name: "Autorizaciones" }).click();
  const panel = page.locator("#autorizaciones-usuario");
  await panel.waitFor();
  await panel.getByRole("button", { name: "Agregar" }).click();
  await page.locator("#aut-tipo").waitFor();
  const envios = [];
  page.on("request", (r) => r.method() === "POST" && /\/autorizaciones$/.test(new URL(r.url()).pathname) && envios.push(r.url()));
  const tipos = await page.locator("#aut-tipo option").allInnerTexts();
  await page.locator("#aut-desde").fill(enDias(5));
  await page.locator("#aut-hasta").fill(enDias(2));
  await page.locator("#aut-motivo").fill("abc");
  const r = await intentar(page, page.locator("#aut-agregar"), ["aut-clave", "aut-hasta", "aut-motivo"]);
  check("[cob:A:A-155] Tipo (Actividad, Método, Equipo); sin actividad, fin antes del inicio y motivo < 5: los tres se marcan y no se envía nada", tipos.join() === "Actividad,Método,Equipo" && r.tipo !== "servidor" && r.todos && envios.length === 0, `${tipos} ${r.texto} ${JSON.stringify(r.marcados)}`);

  const clave = await page.locator("#aut-clave option").nth(1).getAttribute("value");
  await page.locator("#aut-clave").selectOption(clave);
  await page.locator("#aut-desde").fill(hoy());
  await page.locator("#aut-hasta").fill(enDias(30));
  await page.locator("#aut-folio").fill(`FX-THF-AP-${s5}`);
  await page.locator("#aut-motivo").fill("Evaluación de competencia de cobertura");
  await page.locator("#aut-clave-admin").fill(PASS);
  const n0 = filas("SELECT id FROM autorizaciones_personal WHERE usuario_id = ?", UH.id).length;
  await page.locator("#aut-agregar").click();
  const actuar = page.getByRole("dialog", { name: "¿Con qué cargo actúas?" });
  await actuar.waitFor();
  const cargos = (await actuar.getByRole("radio").allInnerTexts()).map(limpio);
  const continuar = actuar.getByRole("button", { name: "Actuar con este cargo" });
  const primera = await actuar.getByRole("radio").first().getAttribute("aria-checked");
  const sinElegir = (await continuar.isEnabled()) && primera === "true";
  await actuar.getByRole("button", { name: "Cancelar" }).click();
  await actuar.waitFor({ state: "detached" });
  await esperar(async () => page.locator("#aut-agregar").isEnabled(), 10_000);
  const n1 = filas("SELECT id FROM autorizaciones_personal WHERE usuario_id = ?", UH.id).length;
  check("[cob:A:A-028] [cob:A:A-029] con dos roles que permiten otorgar y sin cargo predeterminado: «¿Con qué cargo actúas?» ofrece «Actuar como: …» de cada uno (la primera ya elegida y «Actuar con este cargo» habilitado); «Cancelar» no registra nada", cargos.sort().join("|") === [`Actuar como: ${RA1.nombre}`, `Actuar como: ${RA2.nombre}`].sort().join("|") && sinElegir && n1 === n0, `${cargos.join(" | ")} primera=${primera} habilitado=${sinElegir} ${n0}→${n1}`);
  await page.locator("#aut-agregar").click();
  await actuar.waitFor();
  await actuar.getByRole("radio", { name: `Actuar como: ${RA2.nombre}` }).click();
  await continuar.click();
  await toast(page, /Autorización registrada/);
  const nueva = fila("SELECT * FROM autorizaciones_personal WHERE usuario_id = ? ORDER BY id DESC LIMIT 1", UH.id);
  await esperar(async () => (await panel.locator(`[data-autorizacion="${nueva?.id}"]`).count()) === 1, 10_000);
  check("[cob:A:A-156] [cob:A:A-028] «Agregar» con actividad, fechas, folio, motivo y contraseña la registra con el cargo elegido («Actuar como»)", nueva && nueva.clave === clave && nueva.vigente_desde === hoy() && nueva.vigente_hasta === enDias(30) && nueva.folio_fx_thf_ap === `FX-THF-AP-${s5}` && nueva.otorgada_rol === RA2.nombre && Number(nueva.otorgada_por) === UAC.id && (await panel.locator(`[data-autorizacion="${nueva.id}"]`).count()) === 1, JSON.stringify(nueva));
  await page.keyboard.press("Escape");
  await v.waitFor({ state: "detached" });

  // Cargo predeterminado: ya no se pregunta.
  const hoja = await abrirMiCuenta(page);
  const opcionesCargo = await page.locator("#cuenta-cargo option").allInnerTexts();
  await page.locator("#cuenta-cargo").selectOption(String(RA1.id));
  await toast(page, /Cargo predeterminado guardado/);
  await esperar(async () => Number(usuario(UAC.id)?.cargo_predeterminado) === RA1.id, 10_000);
  check("[cob:A:A-090] «Actuar como» (con más de un rol) ofrece «Preguntar cada vez» y los roles vigentes; elegir uno lo guarda en la cuenta", opcionesCargo[0] === "Preguntar cada vez" && opcionesCargo.includes(RA1.nombre) && opcionesCargo.includes(RA2.nombre) && Number(usuario(UAC.id)?.cargo_predeterminado) === RA1.id, opcionesCargo.join(" | "));
  await page.keyboard.press("Escape");
  await hoja.waitFor({ state: "detached" });
  const v2 = await ventanaUsuario(page, UH.id);
  await v2.getByRole("tab", { name: "Autorizaciones" }).click();
  await panel.locator(`[data-autorizacion="${nueva.id}"]`).getByRole("button", { name: "Revocar" }).click();
  await conMotivo(page, "Termina la autorización de cobertura", "Revocar", PASS);
  await toast(page, /Autorización revocada/);
  const rev = fila("SELECT revocada_en, revocada_por, motivo_revocacion FROM autorizaciones_personal WHERE id = ?", nueva.id);
  check("[cob:A:A-157] [cob:A:A-090] «Revocar» con motivo y contraseña la revoca, sin preguntar el cargo (usa el predeterminado)", !!rev?.revocada_en && Number(rev.revocada_por) === UAC.id && rev.motivo_revocacion === "Termina la autorización de cobertura" && (await actuar.count()) === 0, JSON.stringify(rev));

  // Sin usuarios:G: Roles en solo lectura, sin «Nuevo rol» ni acciones.
  const enNavegador = [];
  page.on("response", async (x) => {
    if (new URL(x.url()).pathname === "/api/notificaciones") enNavegador.push(`${x.status()}:${(await x.json().catch(() => ({}))).items?.length}:${x.request().headers()["x-actuar-como"] || ""}`);
  });
  await page.goto(`${BASE_WEB}/administracion/roles`);
  await page.getByRole("heading", { name: "Roles" }).first().waitFor();
  await esperar(async () => (await filasRoles(page)).length > 0, 15_000);
  check("[cob:A:A-158] [cob:A:A-159] con usuarios:V total y sin usuarios:G: Roles se ve, sin «Nuevo rol» ni menú de acciones", (await page.getByRole("button", { name: "Nuevo rol" }).count()) === 0 && (await page.locator('[aria-label="Roles"]').getByRole("button", { name: "Acciones" }).count()) === 0);
  // Campana: «Notificaciones» o «Notificaciones: N sin leer», también en la barra contraída.
  const n = ((await api("GET", "/notificaciones", undefined, await tokenDe(page))).data?.items || []).length;
  const etiqueta = n ? `Notificaciones: ${n} sin leer` : "Notificaciones";
  const aside = page.locator('aside[aria-label="Navegación principal"]');
  const campana = aside.locator('button[aria-label^="Notificaciones"]');
  const enCabecera = await esperar(async () => (await campana.getAttribute("aria-label")) === etiqueta, 10_000);
  const cabecera = await campana.getAttribute("aria-label");
  await aside.getByRole("button", { name: "Contraer barra lateral" }).click();
  await aside.getByRole("button", { name: "Expandir barra lateral" }).waitFor();
  // La de la barra contraída se monta al contraer y carga su lista.
  await esperar(async () => (await campana.getAttribute("aria-label")) === etiqueta, 10_000);
  const enBarra = await campana.getAttribute("aria-label");
  await aside.getByRole("button", { name: "Expandir barra lateral" }).click();
  check("[cob:A:A-060] la campana se nombra «Notificaciones» (o «…: N sin leer», N de /notificaciones) en la cabecera y en la barra contraída", !!enCabecera && enBarra === etiqueta, `n=${n} navegador=${enNavegador} cabecera=${cabecera} barra=${enBarra}`);
});

/* ---------- Usuarios (Administrador técnico): búsqueda, filtros de estado y tipo, filas y ventana ---------- */
await paso(UA, "usuarios: búsqueda, estado, tipo, filas y ventana", async (page) => {
  const p = (await permisosDe(await tokenDe(page))).permissions || {};
  await page.goto(`${BASE_WEB}/administracion/usuarios?buscar=${s5}`);
  await page.getByRole("heading", { name: "Usuarios" }).first().waitFor();
  const buscador = page.getByPlaceholder("Buscar por nombre o correo");
  const propias = [...mias(), UB.id, UL1.id, UL2.id, USP.id, UP.id, UAC.id];
  await esperar(async () => { const f = await filasUsuarios(page); return propias.every((x) => f.includes(x)); }, 15_000);
  const conS5 = await filasUsuarios(page);
  const todasS5 = conS5.every((x) => `${usuario(x)?.nombre} ${usuario(x)?.email}`.includes(s5));
  await buscador.fill(UH.email);
  await esperar(async () => (await filasUsuarios(page)).join() === String(UH.id), 10_000);
  check("[cob:A:A-103] ?buscar= llena el buscador y filtra por nombre o correo; escribir el correo deja solo a esa persona", (await filasUsuarios(page)).join() === String(UH.id) && todasS5 && propias.every((x) => conS5.includes(x)), `${conS5.length} filas, todas con s5=${todasS5}`);

  const deEstado = async (q) => {
    await page.goto(`${BASE_WEB}/administracion/usuarios?buscar=${s5}${q}`);
    await esperar(async () => (await filasUsuarios(page)).length > 0, 15_000);
    return { filas: await filasUsuarios(page), etiqueta: await page.getByRole("button", { name: /^Filtros/ }).getAttribute("aria-label") };
  };
  const baja = await deEstado("&estado=baja");
  const bloqueados = await deEstado("&estado=bloqueados");
  await page.goto(`${BASE_WEB}/administracion/usuarios?buscar=${s5}`);
  await esperar(async () => (await filasUsuarios(page)).includes(UB.id), 15_000);
  await filtros(page, (pop) => interruptor(pop, "Estado", "Activos").click());
  await esperar(async () => !(await filasUsuarios(page)).includes(UB.id), 10_000);
  const activos = await filasUsuarios(page);
  check("[cob:A:A-104] Estado: ?estado=baja deja solo cuentas de baja, «Bloqueados» las bloqueadas por intentos y «Activos» quita las de baja", baja.filas.includes(UB.id) && baja.filas.every((x) => Number(usuario(x)?.activo) === 0) && bloqueados.filas.includes(UL1.id) && bloqueados.filas.includes(UL2.id) && bloqueados.filas.every((x) => !!usuario(x)?.bloqueado_hasta) && activos.length > 0 && activos.every((x) => Number(usuario(x)?.activo) === 1) && baja.etiqueta === "Filtros (1 activos)", `baja=${baja.filas} bloq=${bloqueados.filas} activos=${activos.length} «${baja.etiqueta}»`);
  const temporales = await deEstado("&tipo=temporal");
  await page.goto(`${BASE_WEB}/administracion/usuarios?buscar=${s5}`);
  await esperar(async () => (await filasUsuarios(page)).includes(UC.id), 15_000);
  await filtros(page, (pop) => interruptor(pop, "Tipo de cuenta", "Permanente").click());
  await esperar(async () => !(await filasUsuarios(page)).includes(UC.id), 10_000);
  const permanentes = await filasUsuarios(page);
  check("[cob:A:A-105] Tipo de cuenta: ?tipo=temporal deja las temporales y «Permanente» las quita", temporales.filas.includes(UC.id) && temporales.filas.every((x) => usuario(x)?.tipo_cuenta === "temporal") && permanentes.length > 0 && permanentes.every((x) => (usuario(x)?.tipo_cuenta || "permanente") !== "temporal"), `temp=${temporales.filas} perm=${permanentes.length}`);

  await page.goto(`${BASE_WEB}/administracion/usuarios?buscar=${s5}`);
  await esperar(async () => { const f = await filasUsuarios(page); return propias.every((x) => f.includes(x)); }, 15_000);
  const renglon = async (x) => limpio(await page.locator(`[aria-label="Usuarios"] li[data-usuario="${x}"]`).innerText());
  const r = { baja: await renglon(UB.id), bloqueada: await renglon(UL1.id), futura: await renglon(UFut.id), temporal: await renglon(UC.id), activa: await renglon(UH.id) };
  check("[cob:A:A-110] filas: persona (nombre y correo), roles y estado «De baja», «Bloqueado», «Acceso vencido», «Temporal» (hasta y quién supervisa) y «Activo»", r.baja.includes("De baja") && r.bloqueada.includes("Bloqueado") && r.futura.includes("Acceso vencido") && r.temporal.includes("Temporal") && r.temporal.includes(`Hasta ${fmt(usuario(UC.id).vigente_hasta)}`) && /supervisa Ricardo/.test(r.temporal) && r.activa.includes("Activo") && r.activa.includes(UH.email) && r.activa.includes(UH.nombre), JSON.stringify(r));

  // Ventana: persona anterior y siguiente (botones y flechas).
  const orden = await filasUsuarios(page);
  await page.locator(`[aria-label="Usuarios"] li[data-usuario="${orden[0]}"]`).click();
  const ventana = page.locator("[data-usuario-ventana]");
  await page.locator(`[data-usuario-ventana="${orden[0]}"]`).waitFor();
  const anterior = page.getByRole("button", { name: "Persona anterior" });
  const sinAnterior = await anterior.isDisabled();
  await page.getByRole("button", { name: "Persona siguiente" }).click();
  await page.locator(`[data-usuario-ventana="${orden[1]}"]`).waitFor();
  await page.keyboard.press("ArrowDown");
  const conFlecha = await page.locator(`[data-usuario-ventana="${orden[2]}"]`).waitFor({ timeout: 10_000 }).then(() => true, () => false);
  await anterior.click();
  await page.locator(`[data-usuario-ventana="${orden[1]}"]`).waitFor();
  check("[cob:A:A-136] la ventana de la persona: «Persona anterior» deshabilitado en la primera; «Persona siguiente», ↓ y «Persona anterior» recorren la lista en orden", sinAnterior && conFlecha && (await ventana.getAttribute("data-usuario-ventana")) === String(orden[1]), `${orden.slice(0, 3)} anterior deshabilitado=${sinAnterior} flecha=${conFlecha}`);
  await page.keyboard.press("Escape");

  // Pestañas Roles y Autorizaciones.
  let v = await ventanaUsuario(page, UC.id);
  const pestRoles = v.getByRole("tab", { name: "Roles" });
  const pestAut = v.getByRole("tab", { name: "Autorizaciones" });
  await esperar(async () => (await v.locator("[data-asignacion]").count()) > 0, 10_000);
  const antes = [await pestRoles.getAttribute("aria-selected"), await v.locator("[data-asignacion]").count()];
  await pestAut.click();
  await page.locator("#autorizaciones-usuario").waitFor();
  const despues = [await pestAut.getAttribute("aria-selected"), await pestRoles.getAttribute("aria-selected"), await v.locator("[data-asignacion]").count()];
  check("[cob:A:A-139] pestañas «Roles» (por omisión, con sus tarjetas) y «Autorizaciones» (aria-selected, muestra sus autorizaciones)", antes[0] === "true" && antes[1] > 0 && despues.join() === "true,false,0", `${antes} → ${despues}`);

  // Solicitud pendiente sobre la cuenta.
  v = await ventanaUsuario(page, UN.id);
  const banner = v.locator("[data-banner-solicitud]");
  await banner.waitFor();
  const textoBanner = limpio(await banner.innerText());
  const respuestaUR = page.waitForResponse((x) => x.url().includes("/api/solicitudes?") && x.url().includes(`entidad_id=${UR.id}`));
  v = await ventanaUsuario(page, UR.id);
  await respuestaUR;
  check("[cob:A:A-135] con una solicitud pendiente sobre la cuenta, su ventana la muestra («… · pendiente de autorización»); sin solicitud, no", /pendiente de autorización/.test(textoBanner) && (await v.locator("[data-banner-solicitud]").count()) === 0, textoBanner.slice(0, 200));
  await page.keyboard.press("Escape");

  // Menú del Administrador técnico: Documentos (usuarios:G) y sin Reportar incidencia (sin calidad:C).
  await page.goto(`${BASE_WEB}/administracion/usuarios?nuevo=1`);
  const alta = page.getByRole("dialog", { name: "Nuevo usuario" });
  const abre = await alta.waitFor({ timeout: 15_000 }).then(() => true, () => false);
  await page.keyboard.press("Escape");
  await alta.waitFor({ state: "detached" });
  check("[cob:A:A-101] [cob:A:A-102] con usuarios:G: Usuarios con «Nuevo usuario»; ?nuevo=1 abre el alta", abre && (await page.getByRole("button", { name: "Nuevo usuario" }).count()) === 1);
  const aside = page.locator('aside[aria-label="Navegación principal"]');
  const docs = {};
  for (const href of ["/documentos", "/documentos/bandeja", "/documentos/solicitudes", "/documentos/externos", "/documentos/lista-maestra"]) docs[href] = (await aside.locator(`a[href="${href}"]`).count()) > 0;
  const esperadoDocs = { "/documentos": !!(p.documentos?.V || p.usuarios?.G) };
  for (const href of ["/documentos/bandeja", "/documentos/solicitudes", "/documentos/externos", "/documentos/lista-maestra"]) esperadoDocs[href] = !!p.documentos?.V;
  check("[cob:A:A-039] Administrador técnico (usuarios:G, sin documentos:V): en Documentos SGC solo «Documentos»", JSON.stringify(docs) === JSON.stringify(esperadoDocs) && docs["/documentos"] && !docs["/documentos/bandeja"], JSON.stringify(docs));
  check("[cob:A:A-052] sin calidad:C no aparece «Reportar incidencia»", !p.calidad?.C && (await page.locator("[data-reportar-incidencia-boton]").count()) === 0, `calidad=${JSON.stringify(p.calidad)}`);
});

/* ---------- Cuentas bloqueadas: aviso en la ventana y «Desbloquear…» ---------- */
await paso(UA, "usuarios: cuentas bloqueadas", async (page) => {
  const hasta = usuario(UL2.id)?.bloqueado_hasta;
  const v = await ventanaUsuario(page, UL2.id);
  const aviso = v.getByText(/^Cuenta bloqueada hasta las \d{2}:\d{2}$/);
  await aviso.waitFor();
  const titulo = limpio(await aviso.innerText());
  await v.getByRole("button", { name: "Desbloquear" }).click();
  await conMotivo(page, "Identidad verificada en persona", "Desbloquear", PASS);
  await toast(page, /Cuenta desbloqueada/);
  await esperar(async () => !usuario(UL2.id)?.bloqueado_hasta, 10_000);
  await aviso.waitFor({ state: "detached" });
  const entra = await api("POST", "/auth/login", { email: UL2.email, password: PASS }, undefined, ipPropia());
  check("[cob:A:A-138] cuenta bloqueada: «Cuenta bloqueada hasta las HH:MM» (hora de Tijuana) con «Desbloquear»; al desbloquear con motivo el aviso se va y puede entrar", titulo === `Cuenta bloqueada hasta las ${horaTijuana(hasta)}` && !usuario(UL2.id)?.bloqueado_hasta && entra.status === 200, `«${titulo}» (${hasta}) login=${entra.status} ${entra.data?.message || ""}`);
  await page.keyboard.press("Escape");

  let menu = await acciones(page, UH);
  const enActiva = await menu.getByRole("menuitem", { name: "Desbloquear…" }).count();
  await page.keyboard.press("Escape");
  menu = await acciones(page, UL1);
  await menu.getByRole("menuitem", { name: "Desbloquear…" }).click();
  await conMotivo(page, "Identidad verificada por teléfono", "Desbloquear", PASS);
  await toast(page, /Cuenta desbloqueada/);
  await esperar(async () => !usuario(UL1.id)?.bloqueado_hasta, 10_000);
  menu = await acciones(page, UL1);
  const despues = await menu.getByRole("menuitem", { name: "Desbloquear…" }).count();
  await page.keyboard.press("Escape");
  check("[cob:A:A-114] «Desbloquear…» solo en cuentas bloqueadas; con motivo y contraseña quita el bloqueo", enActiva === 0 && despues === 0 && !usuario(UL1.id)?.bloqueado_hasta, `activa=${enActiva} después=${despues}`);
});

/* ---------- Hoja de usuario y acciones: editar, cancelar, baja, reactivar e interruptor ---------- */
const ultimaBitacora = (idu) => fila("SELECT accion, motivo FROM auditoria WHERE entidad LIKE 'usuario%' AND CAST(entidad_id AS TEXT) = ? ORDER BY id DESC LIMIT 1", String(idu));
await paso(UA, "usuarios: editar, baja, reactivar e interruptor", async (page) => {
  const depto0 = usuario(UH.id)?.departamento;
  let menu = await acciones(page, UH);
  await menu.getByRole("menuitem", { name: "Editar datos" }).click();
  let hoja = page.getByRole("dialog", { name: "Editar usuario" });
  await hoja.waitFor();
  const datos = { correo: await page.locator("#u-email").inputValue(), rol: await page.locator("#u-rol").count(), clave: await page.locator("#u-clave-admin").count() };
  await page.locator("#u-depto").fill(`Sin guardar ${s5}`);
  await hoja.getByRole("button", { name: "Cancelar", exact: true }).click();
  await hoja.waitFor({ state: "detached" });
  const cancelado = usuario(UH.id)?.departamento === depto0;
  menu = await acciones(page, UH);
  await menu.getByRole("menuitem", { name: "Editar datos" }).click();
  await hoja.waitFor();
  await page.locator("#u-depto").fill(`Depto ${s5}`);
  const clave2 = await page.locator("#u-clave-admin").count();
  await hoja.getByRole("button", { name: "Guardar cambios" }).click();
  await toast(page, /Usuario actualizado/);
  await esperar(async () => usuario(UH.id)?.departamento === `Depto ${s5}`, 10_000);
  await hoja.waitFor({ state: "detached" });
  check("[cob:A:A-111] [cob:A:A-134] [cob:A:A-119] «Editar datos» abre «Editar usuario» con sus datos (sin «Rol inicial»); «Cancelar» no guarda; «Guardar cambios» guarda", datos.correo === UH.email && datos.rol === 0 && cancelado && usuario(UH.id)?.departamento === `Depto ${s5}`, `${JSON.stringify(datos)} cancelado=${cancelado} → ${usuario(UH.id)?.departamento}`);
  menu = await acciones(page, UH);
  await menu.getByRole("menuitem", { name: "Editar datos" }).click();
  await hoja.waitFor();
  await page.locator("#u-cuenta-hasta").fill(enDias(60));
  const pide = await page.locator("#u-clave-admin").waitFor({ timeout: 10_000 }).then(() => true, () => false);
  await hoja.getByRole("button", { name: "Cancelar", exact: true }).click();
  await hoja.waitFor({ state: "detached" });
  check("[cob:A:A-133] «Tu contraseña» en la hoja solo cuando el guardado es crítico: no al cambiar el departamento, sí al cambiar la vigencia", datos.clave === 0 && clave2 === 0 && pide && !usuario(UH.id)?.vigente_hasta, `depto=${datos.clave}/${clave2} vigencia=${pide}`);

  // Alta: rol inicial solo con roles activos, supervisores posibles y contraseña de quien da de alta.
  await page.goto(`${BASE_WEB}/administracion/usuarios`);
  await page.getByRole("button", { name: "Nuevo usuario" }).click();
  hoja = page.getByRole("dialog", { name: "Nuevo usuario" });
  await hoja.waitFor();
  await esperar(async () => (await page.locator("#u-rol option").count()) > 2, 10_000);
  const rolesAlta = await page.locator("#u-rol option").allInnerTexts();
  await page.locator("#u-tipo-cuenta").selectOption("temporal");
  await esperar(async () => (await page.locator("#u-supervisor option").count()) > 1, 10_000);
  const supervisores = (await page.locator("#u-supervisor option").evaluateAll((els) => els.map((e) => e.value))).filter(Boolean).map(Number);
  const claveAlta = await page.locator("#u-clave-admin").count();
  const n0 = Number(fila("SELECT COUNT(*) AS n FROM usuarios")?.n);
  await hoja.getByRole("button", { name: "Cancelar", exact: true }).click();
  await hoja.waitFor({ state: "detached" });
  check("[cob:A:A-122] «Rol inicial» solo en el alta y solo con roles activos", rolesAlta.includes(Rextra.nombre) && !rolesAlta.includes(Rinact.nombre) && datos.rol === 0, `${rolesAlta.length} roles; inactivo=${rolesAlta.includes(Rinact.nombre)}`);
  check("[cob:A:A-129] «Supervisor»: cuentas activas y permanentes sin fecha de fin (no temporales, de baja ni con fin)", supervisores.includes(UH.id) && !supervisores.includes(UC.id) && !supervisores.includes(UB.id) && !supervisores.includes(UR.id) && supervisores.every((x) => Number(usuario(x)?.activo) === 1 && (usuario(x)?.tipo_cuenta || "permanente") !== "temporal" && !usuario(x)?.vigente_hasta), `${supervisores.length} supervisores`);
  check("[cob:A:A-134] [cob:A:A-133] [cob:A:A-119] el alta («Nuevo usuario») pide «Tu contraseña»; «Cancelar» no crea nada", claveAlta === 1 && Number(fila("SELECT COUNT(*) AS n FROM usuarios")?.n) === n0);

  // Dar de baja desde el menú (no en la propia).
  menu = await acciones(page, UA);
  const bajaPropia = await menu.getByRole("menuitem", { name: "Dar de baja…" }).count();
  await page.keyboard.press("Escape");
  menu = await acciones(page, UD1);
  await menu.getByRole("menuitem", { name: "Dar de baja…" }).click();
  await conMotivo(page, "Termina su colaboración de cobertura", "Dar de baja", PASS);
  await toast(page, /Cuenta dada de baja/);
  await esperar(async () => Number(usuario(UD1.id)?.activo) === 0, 10_000);
  const bit = ultimaBitacora(UD1.id);
  check("[cob:A:A-116] «Dar de baja…» (no en la propia) con motivo y contraseña deja la cuenta de baja y la bitácora dice «baja»", bajaPropia === 0 && Number(usuario(UD1.id)?.activo) === 0 && bit?.accion === "baja", `propia=${bajaPropia} ${JSON.stringify(bit)}`);
  // Reactivar: queda por autorizar (segundo usuario).
  menu = await acciones(page, UD1);
  const opcionesBaja = (await menu.getByRole("menuitem").allInnerTexts()).map(limpio);
  await menu.getByRole("menuitem", { name: "Reactivar…" }).click();
  await conMotivo(page, "Vuelve a colaborar en cobertura", "Pedir reactivación", PASS);
  await toast(page, /pendiente de que otra persona autorizada la apruebe/);
  const sol = fila("SELECT tipo FROM solicitudes_autorizacion WHERE entidad = 'usuarios' AND entidad_id = ? AND estado = 'pendiente' ORDER BY id DESC LIMIT 1", String(UD1.id));
  check("[cob:A:A-117] en una cuenta de baja el menú ofrece «Reactivar…» (no «Dar de baja…»); «Pedir reactivación» deja la solicitud pendiente y la cuenta sigue de baja", opcionesBaja.includes("Reactivar…") && !opcionesBaja.includes("Dar de baja…") && !!sol && Number(usuario(UD1.id)?.activo) === 0, `${opcionesBaja.join(" | ")} ${JSON.stringify(sol)}`);

  // Interruptor «Usuario activo»: baja con motivo desde la hoja; no aparece en la propia.
  menu = await acciones(page, UD2);
  await menu.getByRole("menuitem", { name: "Editar datos" }).click();
  hoja = page.getByRole("dialog", { name: "Editar usuario" });
  await hoja.waitFor();
  await hoja.getByRole("switch", { name: "Usuario activo" }).click();
  await page.locator("#u-motivo-estado").waitFor();
  const etiquetaMotivo = limpio(await page.locator('label[for="u-motivo-estado"]').innerText());
  await page.locator("#u-motivo-estado").fill("abc");
  await page.locator("#u-clave-admin").fill(PASS);
  const r = await intentar(page, hoja.getByRole("button", { name: "Guardar cambios" }), ["u-motivo-estado"]);
  const sigue = Number(usuario(UD2.id)?.activo) === 1;
  await page.locator("#u-motivo-estado").fill("Termina su estancia de cobertura");
  await hoja.getByRole("button", { name: "Guardar cambios" }).click();
  await toast(page, /Usuario actualizado/);
  await esperar(async () => Number(usuario(UD2.id)?.activo) === 0, 10_000);
  const bit2 = ultimaBitacora(UD2.id);
  menu = await acciones(page, UA);
  await menu.getByRole("menuitem", { name: "Editar datos" }).click();
  hoja = page.getByRole("dialog", { name: "Editar usuario" });
  await hoja.waitFor();
  const enPropia = await hoja.getByRole("switch", { name: "Usuario activo" }).count();
  await hoja.getByRole("button", { name: "Cancelar", exact: true }).click();
  check("[cob:A:A-127] apagar «Usuario activo» pide «Motivo de la baja» (< 5 se marca y no guarda); con motivo la da de baja («baja» en la bitácora); en la propia cuenta no hay interruptor", /^Motivo de la baja/.test(etiquetaMotivo) && r.todos && sigue && Number(usuario(UD2.id)?.activo) === 0 && bit2?.accion === "baja" && bit2?.motivo === "Termina su estancia de cobertura" && enPropia === 0, `«${etiquetaMotivo}» ${r.texto} sigue=${sigue} ${JSON.stringify(bit2)} propia=${enPropia}`);
});

/* ---------- Asignar rol (cancelar) y revocar un rol ---------- */
await paso(UA, "asignar rol: cancelar; revocar un rol", async (page) => {
  let v = await ventanaUsuario(page, UR.id);
  await v.getByRole("button", { name: "Asignar rol" }).click();
  const dialogo = page.getByRole("dialog", { name: `Asignar rol a ${UR.nombre}` });
  await dialogo.waitFor();
  await esperar(async () => (await page.locator("#u-asignar-rol option").count()) > 2, 10_000);
  const ops = await page.locator("#u-asignar-rol option").allInnerTexts();
  await page.locator("#u-asignar-rol").selectOption({ label: Rextra.nombre });
  await page.locator("#u-asignar-motivo").fill("Cambio de funciones que no se hará");
  await dialogo.getByRole("button", { name: "Cancelar" }).click();
  await dialogo.waitFor({ state: "detached" });
  const sol = fila("SELECT id FROM solicitudes_autorizacion WHERE entidad = 'usuarios' AND entidad_id = ? AND tipo = 'asignar_rol' AND estado = 'pendiente'", String(UR.id));
  check("[cob:A:A-146] [cob:A:A-147] [cob:A:A-151] «Asignar rol a <nombre>»: el selector solo trae roles activos; «Cancelar» cierra sin pedir nada", ops.includes(Rextra.nombre) && !ops.includes(Rinact.nombre) && !sol && !asignacion(UR.id, Rextra.id), `${ops.length} opciones; inactivo=${ops.includes(Rinact.nombre)} sol=${JSON.stringify(sol)}`);
  await page.keyboard.press("Escape");

  v = await ventanaUsuario(page, UH.id);
  const tarjeta = v.locator("[data-asignacion]").filter({ hasText: Rextra.nombre }).first();
  await tarjeta.getByRole("button", { name: "Revocar" }).click();
  await conMotivo(page, "Cambio de funciones de cobertura", "Revocar", PASS);
  await toast(page, /Rol revocado/);
  await esperar(async () => !!asignacion(UH.id, Rextra.id)?.revocado_en, 10_000);
  const a = asignacion(UH.id, Rextra.id);
  const resumen = v.locator("summary").filter({ hasText: /Historial de roles/ });
  await resumen.click();
  const enHistorial = limpio(await v.locator("[data-asignacion]").filter({ hasText: Rextra.nombre }).first().innerText());
  check("[cob:A:A-143] «Revocar» (con motivo y contraseña) revoca el rol al instante y pasa al historial como «Revocado»", !!a?.revocado_en && Number(a.revocado_por) === UA.id && a.motivo_revocacion === "Cambio de funciones de cobertura" && /Revocado/.test(enHistorial), `${JSON.stringify(a)} | ${enHistorial}`);
});

/* ---------- Roles: búsqueda, filas, menús, ventana y editor ---------- */
const menuRol = async (page, r) => {
  await page.goto(`${BASE_WEB}/administracion/roles?buscar=${encodeURIComponent(r.nombre)}`);
  const renglon = page.locator(`[aria-label="Roles"] li[data-rol="${r.id}"]`);
  await renglon.waitFor();
  await renglon.getByRole("button", { name: "Acciones" }).click();
  return page.getByRole("menu");
};
await paso(UA, "roles: búsqueda, filas, menús y ventana", async (page) => {
  await page.goto(`${BASE_WEB}/administracion/roles?buscar=${encodeURIComponent(Rdes.nombre)}`);
  await page.getByRole("heading", { name: "Roles" }).first().waitFor();
  await esperar(async () => (await filasRoles(page)).join() === String(Rdes.id), 15_000);
  const buscador = page.getByPlaceholder("Buscar por nombre");
  const valor = await buscador.inputValue();
  check("[cob:A:A-158] [cob:A:A-159] [cob:A:A-160] Roles con «Nuevo rol» (usuarios:G); ?buscar= llena el buscador y deja solo ese rol", valor === Rdes.nombre && (await filasRoles(page)).join() === String(Rdes.id) && (await page.getByRole("button", { name: "Nuevo rol" }).count()) === 1, valor);

  await buscador.fill(`Cob UI`);
  await esperar(async () => { const f = await filasRoles(page); return [Rdes.id, Rinact.id, Rasig.id].every((x) => f.includes(x)); }, 10_000);
  const filaDe = async (x) => limpio(await page.locator(`[aria-label="Roles"] li[data-rol="${x}"]`).innerText());
  const sinPersonas = await filaDe(Rdes.id);
  const inactivo = await filaDe(Rinact.id);
  await buscador.fill("");
  const tecnico = rol("tecnico_auxiliar");
  await esperar(async () => (await filasRoles(page)).includes(tecnico.id), 10_000);
  const delCatalogo = await filaDe(tecnico.id);
  const total = Number((await api("GET", "/admin/roles", undefined, t.qa)).data?.items?.find((x) => x.id === tecnico.id)?.total_usuarios || 0);
  const sinMenuPropio = await page.locator(`[aria-label="Roles"] li[data-rol="${rol("admin_tecnico").id}"]`).getByRole("button", { name: "Acciones" }).count();
  check("[cob:A:A-162] [cob:A:A-163] filas: rol con su propósito, personas («Sin personas» / «N personas») y tipo («Personalizado», «Del catálogo», «Inactivo»); el rol propio no tiene menú", sinPersonas.includes(Rdes.nombre) && sinPersonas.includes("Sin personas") && sinPersonas.includes("Personalizado") && inactivo.includes("Inactivo") && delCatalogo.includes("Del catálogo") && delCatalogo.includes(total === 1 ? "1 persona" : `${total.toLocaleString("es-MX")} personas`) && sinMenuPropio === 0, `${sinPersonas} | ${inactivo} | ${delCatalogo} (total ${total})`);

  // Ventana: rol anterior y siguiente.
  await buscador.fill("Cob UI");
  await esperar(async () => (await filasRoles(page)).length >= 3, 10_000);
  const orden = await filasRoles(page);
  await page.locator(`[aria-label="Roles"] li[data-rol="${orden[0]}"]`).click();
  await page.locator(`[data-rol-ventana="${orden[0]}"]`).waitFor();
  const sinAnterior = await page.getByRole("button", { name: "Rol anterior" }).isDisabled();
  await page.getByRole("button", { name: "Rol siguiente" }).click();
  await page.locator(`[data-rol-ventana="${orden[1]}"]`).waitFor();
  await page.getByRole("button", { name: "Rol anterior" }).click();
  await page.locator(`[data-rol-ventana="${orden[0]}"]`).waitFor();
  check("[cob:A:A-166] ventana del rol: «Rol anterior» deshabilitado en el primero; «Rol siguiente» y «Rol anterior» recorren la lista", sinAnterior);
  await page.keyboard.press("Escape");

  // Editar nombre y descripción.
  let menu = await menuRol(page, Rdatos);
  const opciones = (await menu.getByRole("menuitem").allInnerTexts()).map(limpio);
  await menu.getByRole("menuitem", { name: "Editar nombre y descripción" }).click();
  const datos = page.getByRole("dialog", { name: "Editar nombre y descripción" });
  await datos.waitFor();
  const nombre0 = await page.locator("#role-nombre").inputValue();
  await page.locator("#role-descripcion").fill(`Descripción nueva ${s5}`);
  await datos.getByRole("button", { name: "Guardar", exact: true }).click();
  await toast(page, /Rol actualizado/);
  await esperar(async () => fila("SELECT descripcion FROM roles WHERE id = ?", Rdatos.id)?.descripcion === `Descripción nueva ${s5}`, 10_000);
  check("[cob:A:A-164] [cob:A:A-176] [cob:A:A-178] «Editar nombre y descripción» abre su ventana con el nombre; «Guardar» cambia la descripción sin tocar los permisos", opciones.join("|") === "Editar permisos|Editar nombre y descripción|Desactivar…" && nombre0 === Rdatos.nombre && fila("SELECT nombre FROM roles WHERE id = ?", Rdatos.id)?.nombre === Rdatos.nombre && filas("SELECT id FROM rol_acciones WHERE id_rol = ?", Rdatos.id).length === 0, `${opciones.join("|")} «${nombre0}»`);

  // Editar permisos desde el menú; guardar sin cambios cierra sin pedir nada.
  menu = await menuRol(page, Rdatos);
  await menu.getByRole("menuitem", { name: "Editar permisos" }).click();
  const v = page.locator(`[data-rol-ventana="${Rdatos.id}"]`);
  await v.waitFor();
  await page.getByLabel("Ver en Muestras", { exact: true }).waitFor();
  const puts = [];
  page.on("request", (x) => x.method() === "PUT" && new URL(x.url()).pathname === `/api/admin/roles/${Rdatos.id}` && puts.push(1));
  await v.getByRole("button", { name: "Guardar permisos" }).click();
  await page.getByLabel("Ver en Muestras", { exact: true }).waitFor({ state: "detached" });
  check("[cob:A:A-163] [cob:A:A-175] «Editar permisos» del menú abre el editor; «Guardar permisos» sin cambios lo cierra sin motivo ni guardar", puts.length === 0 && (await page.locator("#prompt-motivo").count()) === 0 && !fila("SELECT id FROM solicitudes_autorizacion WHERE entidad = 'roles' AND entidad_id = ? AND estado = 'pendiente'", String(Rdatos.id)), `puts=${puts.length}`);
  await page.keyboard.press("Escape");

  // Quitar un permiso se aplica de inmediato (sin segundo usuario).
  const vq = await ventanaRol(page, Rquita.id);
  await vq.getByRole("button", { name: "Editar permisos" }).click();
  const verMuestras = page.getByLabel("Ver en Muestras", { exact: true });
  await verMuestras.waitFor();
  const marcadaAntes = await verMuestras.isChecked();
  await verMuestras.uncheck();
  await vq.getByRole("button", { name: "Guardar permisos" }).click();
  await conMotivo(page, "Ya no consulta muestras", "Guardar permisos", PASS);
  await toast(page, /Permisos actualizados/);
  await esperar(async () => filas("SELECT id FROM rol_acciones WHERE id_rol = ?", Rquita.id).length === 0, 10_000);
  check("[cob:A:A-175] quitar un permiso y «Guardar permisos» (motivo y contraseña) lo aplica al instante, sin solicitud", marcadaAntes && filas("SELECT id FROM rol_acciones WHERE id_rol = ?", Rquita.id).length === 0 && !fila("SELECT id FROM solicitudes_autorizacion WHERE entidad = 'roles' AND entidad_id = ? AND estado = 'pendiente'", String(Rquita.id)));
  await page.keyboard.press("Escape");

  // Desactivar y activar.
  menu = await menuRol(page, Rdes);
  await menu.getByRole("menuitem", { name: "Desactivar…" }).click();
  await conMotivo(page, "Rol que ya no se usa", "Desactivar", PASS);
  await toast(page, /Rol desactivado/);
  await esperar(async () => Number(fila("SELECT activo FROM roles WHERE id = ?", Rdes.id)?.activo) === 0, 10_000);
  menu = await menuRol(page, Rdes);
  await menu.getByRole("menuitem", { name: "Activar…" }).click();
  await conMotivo(page, "Se vuelve a usar el rol", "Activar", PASS);
  await toast(page, /pendiente/i);
  const sol = fila("SELECT tipo FROM solicitudes_autorizacion WHERE entidad = 'roles' AND entidad_id = ? AND estado = 'pendiente' ORDER BY id DESC LIMIT 1", String(Rdes.id));
  check("[cob:A:A-165] «Desactivar…» (motivo y contraseña) lo desactiva al instante; «Activar…» queda por autorizar (ampliar_permisos_rol) y sigue inactivo", sol?.tipo === "ampliar_permisos_rol" && Number(fila("SELECT activo FROM roles WHERE id = ?", Rdes.id)?.activo) === 0, JSON.stringify(sol));
});

/* ---------- Mi cuenta: apariencia y cerrar todas las sesiones ---------- */
await paso(UX, "mi cuenta: apariencia y cerrar sesión en todos los dispositivos", async (page) => {
  await page.goto(`${BASE_WEB}/ayuda`);
  const hoja = await abrirMiCuenta(page);
  const grupo = hoja.getByRole("radiogroup", { name: "Apariencia" });
  const pasos = [];
  for (const [nombre, valor] of [["Oscuro", "oscuro"], ["Claro", "claro"], ["Automático", "auto"]]) {
    const radio = grupo.getByRole("radio", { name: new RegExp(nombre) });
    await radio.click();
    await esperar(async () => usuario(UX.id)?.tema === valor, 10_000);
    pasos.push([valor, usuario(UX.id)?.tema, await radio.getAttribute("aria-checked"), await page.evaluate(() => document.documentElement.dataset.theme || "")]);
  }
  check("[cob:A:A-095] «Apariencia» (Claro, Oscuro, Automático) cambia el tema al momento y lo guarda en la cuenta", pasos.every(([v, g, c]) => v === g && c === "true") && pasos[0][3] === "dark" && pasos[1][3] === "light", JSON.stringify(pasos));

  const otra = await api("POST", "/auth/login", { email: UX.email, password: PASS });
  const tv0 = Number(usuario(UX.id)?.token_version);
  await hoja.getByRole("button", { name: "Cerrar sesión en todos los dispositivos" }).click();
  const confirma = page.getByRole("dialog", { name: "Cerrar sesión en todos los dispositivos" });
  await confirma.waitFor();
  const descripcion = limpio(await confirma.innerText());
  await confirma.getByRole("button", { name: "Cancelar" }).click();
  await confirma.waitFor({ state: "detached" });
  const sigue = Number(usuario(UX.id)?.token_version) === tv0 && (await api("GET", "/auth/me", undefined, otra.data?.token)).status === 200;
  await hoja.getByRole("button", { name: "Cerrar sesión en todos los dispositivos" }).click();
  await confirma.getByRole("button", { name: "Cerrar todas" }).click();
  await page.waitForURL((u) => u.pathname === "/login");
  const tras = await api("GET", "/auth/me", undefined, otra.data?.token);
  check("[cob:A:A-094] «Cerrar sesión en todos los dispositivos» pide confirmación («Cancelar» no cierra nada); «Cerrar todas» cierra esta y las demás sesiones", /Se cerrarán todas tus sesiones abiertas, incluida esta/.test(descripcion) && sigue && Number(usuario(UX.id)?.token_version) === tv0 + 1 && tras.status === 401, `cancelar=${sigue} tv ${tv0}→${usuario(UX.id)?.token_version} otra=${tras.status}`);
});

/* ---------- Mi cuenta: cambiar la contraseña propia y cerrar sesión ---------- */
await paso(UPW, "mi cuenta: cambiar contraseña y cerrar sesión", async (page) => {
  const otra = await api("POST", "/auth/login", { email: UPW.email, password: PASS });
  await page.goto(`${BASE_WEB}/ayuda`);
  const hoja = await abrirMiCuenta(page);
  const hash0 = usuario(UPW.id)?.password_hash;
  await hoja.getByRole("button", { name: "Cambiar contraseña" }).click();
  const NUEVA = `Propia-${s5}-Nueva`;
  await page.locator("#pwd-actual").fill(PASS);
  await page.locator("#pwd-nueva").fill(NUEVA);
  await page.locator("#pwd-confirmar").fill(NUEVA);
  await page.locator("form:has(#pwd-confirmar) button[type=submit]").click();
  await toast(page, /Contraseña cambiada; tus otras sesiones se cerraron/);
  await hoja.getByRole("button", { name: "Cambiar contraseña" }).waitFor();
  const nueva = await api("POST", "/auth/login", { email: UPW.email, password: NUEVA }, undefined, ipPropia());
  const vieja = await api("POST", "/auth/login", { email: UPW.email, password: PASS }, undefined, ipPropia());
  const otraTras = await api("GET", "/auth/me", undefined, otra.data?.token);
  const esta = await api("GET", "/auth/me", undefined, await tokenDe(page));
  check("[cob:A:A-093] «Cambiar contraseña» en Mi cuenta: con la actual y la nueva confirmada la cambia, cierra las otras sesiones y conserva esta", usuario(UPW.id)?.password_hash !== hash0 && nueva.status === 200 && vieja.status === 401 && otraTras.status === 401 && esta.status === 200, `nueva=${nueva.status} vieja=${vieja.status} otra=${otraTras.status} esta=${esta.status}`);
  await page.keyboard.press("Escape");
  await hoja.waitFor({ state: "detached" });
  const token = await tokenDe(page);
  await page.getByRole("button", { name: "Menú de usuario" }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await page.waitForURL((u) => u.pathname === "/login");
  const tras = await api("GET", "/auth/me", undefined, token);
  check("[cob:A:A-057] «Cerrar sesión» del menú de usuario sale sin confirmación y revoca la sesión («salir»)", tras.status === 401 && revocada(UPW.id) === "salir" && !(await tokenDe(page)), `${tras.status} ${revocada(UPW.id)}`);
});

/* ---------- Mi cuenta: foto de perfil propia ---------- */
await paso(UFo, "mi cuenta: foto de perfil", async (page) => {
  await page.goto(`${BASE_WEB}/ayuda`);
  const hoja = await abrirMiCuenta(page);
  const modo = hoja.getByRole("radiogroup", { name: "Foto de perfil" });
  const puts = [];
  page.on("request", (x) => x.method() === "PUT" && x.url().endsWith("/api/auth/me/foto") && puts.push(x.postData()));
  const subidas = [];
  page.on("request", (x) => x.method() === "POST" && x.url().endsWith("/api/auth/me/foto") && subidas.push(1));
  const inicial = await modo.getByRole("radio", { name: "Figura" }).getAttribute("aria-checked");
  await modo.getByRole("radio", { name: "Foto" }).click();
  await hoja.getByRole("button", { name: "Subir foto", exact: true }).waitFor();
  check("[cob:A:A-096] «Foto de perfil»: Figura por omisión; «Foto» sin foto subida solo muestra «Subir foto» (no cambia nada)", inicial === "true" && (await modo.getByRole("radio", { name: "Foto" }).getAttribute("aria-checked")) === "true" && puts.length === 0 && !usuario(UFo.id)?.foto, `${inicial} puts=${puts.length}`);

  const entrada = hoja.getByLabel("Subir foto de perfil");
  const aviso = page.locator('[role="alertdialog"][data-validacion]');
  await entrada.setInputFiles({ name: "foto.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
  await aviso.waitFor();
  const tipo = limpio(await aviso.innerText());
  await entendido(page);
  await entrada.setInputFiles({ name: "grande.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(5 * 1024 * 1024 + 10, 1) });
  await aviso.waitFor();
  const peso = limpio(await aviso.innerText());
  await entendido(page);
  check("[cob:A:A-098] «Subir foto de perfil»: un GIF avisa «Usa una foto JPG, PNG o WEBP» y una de más de 5 MB «La foto pesa más de 5 MB»; ninguna se sube", /Usa una foto JPG, PNG o WEBP/.test(tipo) && /La foto pesa más de 5 MB/.test(peso) && subidas.length === 0 && !usuario(UFo.id)?.foto, `${tipo} | ${peso}`);

  const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 90, b: 40 } } }).png().toBuffer();
  await entrada.setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: png });
  const recorte = page.getByRole("dialog", { name: "Recorta tu foto" });
  await recorte.waitFor();
  const zoom = recorte.getByRole("slider", { name: "Zoom" });
  const rango = [await zoom.getAttribute("min"), await zoom.getAttribute("max"), await zoom.inputValue()];
  await recorte.getByRole("application").focus();
  await page.keyboard.press("=");
  await page.keyboard.press("=");
  const acercado = Number(await zoom.inputValue());
  // «Guardar» se habilita cuando la imagen elegida termina de cargar en el encuadre.
  const guardar = recorte.getByRole("button", { name: "Guardar", exact: true });
  const cargaPrimera = !!(await esperar(() => guardar.isEnabled(), 10_000));
  await recorte.getByRole("button", { name: "Cancelar" }).click();
  await recorte.waitFor({ state: "detached" });
  const cancelada = subidas.length === 0 && !usuario(UFo.id)?.foto;
  await entrada.setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: png });
  await recorte.waitFor();
  const cargaSegunda = !!(await esperar(() => guardar.isEnabled(), 10_000));
  check("[cob:A:A-100] «Recorta tu foto»: Zoom de 1 a 4 (las teclas lo acercan) y «Cancelar» no sube nada", rango.join() === "1,4,1" && acercado > 1 && cancelada, `${rango} → ${acercado} cancelada=${cancelada}`);
  if (cargaSegunda) {
    await guardar.click();
    await toast(page, /Foto de perfil actualizada/);
    await esperar(async () => !!usuario(UFo.id)?.foto, 10_000);
  } else {
    // La imagen no cargó en el encuadre: se cierra y la foto se sube por la API para seguir con lo demás.
    await recorte.getByRole("button", { name: "Cancelar" }).click();
    await recorte.waitFor({ state: "detached" });
    const fd2 = new FormData();
    fd2.append("archivo", new Blob([png], { type: "image/png" }), "foto.png");
    await api("POST", "/auth/me/foto", fd2, await tokenDe(page));
    await page.reload();
    await abrirMiCuenta(page);
  }
  check("[cob:A:A-100] «Recorta tu foto»: la foto elegida se ve en el encuadre y «Guardar» (habilitado al cargarla) la sube y la usa", cargaPrimera && cargaSegunda && subidas.length === 1 && !!usuario(UFo.id)?.foto && Number(usuario(UFo.id)?.usa_foto) === 1, `carga 1.ª=${cargaPrimera} 2.ª=${cargaSegunda} subidas=${subidas.length} usa=${usuario(UFo.id)?.usa_foto}`);

  await modo.getByRole("radio", { name: "Figura" }).click();
  await toast(page, /Se muestra tu figura/);
  await esperar(async () => Number(usuario(UFo.id)?.usa_foto) === 0, 10_000);
  const conFigura = Number(usuario(UFo.id)?.usa_foto) === 0 && !!usuario(UFo.id)?.foto;
  await modo.getByRole("radio", { name: "Foto" }).click();
  await toast(page, /Se muestra tu foto/);
  await esperar(async () => Number(usuario(UFo.id)?.usa_foto) === 1, 10_000);
  check("[cob:A:A-096] con foto subida, «Figura» y «Foto» cambian lo que se muestra (usa_foto) sin perder la foto", conFigura && Number(usuario(UFo.id)?.usa_foto) === 1 && puts.length === 2, `puts=${puts.join(" ")}`);

  await hoja.getByRole("button", { name: "Quitar foto" }).click();
  await toast(page, /Foto de perfil quitada/);
  await esperar(async () => !usuario(UFo.id)?.foto, 10_000);
  await hoja.getByRole("button", { name: "Subir foto", exact: true }).waitFor();
  check("[cob:A:A-099] «Quitar foto» (sin confirmación) borra la foto y vuelve a ofrecer «Subir foto»", !usuario(UFo.id)?.foto && (await hoja.getByRole("button", { name: "Quitar foto" }).count()) === 0);
});

/* ---------- Buscador: botón, comandos, recientes e Inicio (cuenta temporal) ---------- */
await paso(UC, "buscador: botón, comandos, recientes e Inicio", async (page) => {
  const token = await tokenDe(page);
  const p = (await permisosDe(token)).permissions || {};
  await page.goto(`${BASE_WEB}/ayuda`);
  await page.getByRole("heading", { name: "Cómo se usa FICOTOX" }).waitFor();
  await page.locator('aside[aria-label="Navegación principal"]').getByRole("button", { name: "Buscar", exact: true }).click();
  const dialogo = paletaDe(page);
  await dialogo.waitFor();
  const campo = dialogo.locator('input[aria-label="Buscar en FICOTOX"]');
  const enfocado = await campo.evaluate((e) => e === document.activeElement);
  const placeholder = await campo.getAttribute("placeholder");
  await page.keyboard.press("Escape");
  await dialogo.waitFor({ state: "detached" });
  const largo = "cobertura".repeat(15);
  const [r130, r120] = [await api("GET", `/busqueda?q=${largo.slice(0, 130)}`, undefined, token), await api("GET", `/busqueda?q=${largo.slice(0, 120)}`, undefined, token)];
  check("[cob:A:A-049] [cob:A:A-070] [cob:A:A-069] «Buscar» abre la ventana «Buscar» con el campo «Buscar en FICOTOX» enfocado («Busca un folio, un reactivo, un equipo, o escribe lo que quieres hacer»); el servidor usa hasta 120 caracteres", enfocado && placeholder === "Busca un folio, un reactivo, un equipo, o escribe lo que quieres hacer" && r130.status === 200 && JSON.stringify(r130.data) === JSON.stringify(r120.data), `foco=${enfocado} «${placeholder}» ${r130.status}`);

  // Recientes: se guardan 30 y se ven 8.
  for (let i = 0; i < 35; i += 1) await api("POST", "/busqueda/recientes", { tipo: "consulta", texto: `consulta ${i} ${s5}` }, token);
  const guardados = Number(fila("SELECT COUNT(*) AS n FROM busqueda_recientes WHERE usuario_id = ?", UC.id)?.n);
  let b = await buscar(page, "");
  const grupo = b.dialogo.locator("[cmdk-group]").filter({ hasText: "Recientes" });
  await grupo.waitFor();
  const visibles = (await grupo.getByRole("option").allInnerTexts()).map(limpio);
  check("[cob:A:A-071] «Recientes» sin escribir: de 30 guardados (los más nuevos) se ven 8", guardados === 30 && visibles.length === 8 && visibles[0].includes(`consulta 34 ${s5}`), `${guardados} guardados; ${visibles.join(" / ")}`);
  await page.keyboard.press("Escape");

  // Comandos.
  const comando = async (q, titulo) => {
    b = await buscar(page, q);
    const opcion = b.dialogo.getByRole("option").filter({ hasText: titulo }).first();
    const hay = await opcion.count();
    if (hay) await opcion.click();
    return hay;
  };
  const tema = async (valor, dataset) => esperar(async () => usuario(UC.id)?.tema === valor && (dataset === null || (await page.evaluate(() => document.documentElement.dataset.theme)) === dataset), 10_000);
  const viejo = (await buscar(page, "tema oscuro").then((x) => x.opciones())).some((x) => /^Tema oscuro/.test(x));
  await page.keyboard.press("Escape");
  const temas = [await comando("modo oscuro", "Modo oscuro"), await tema("oscuro", "dark"), await comando("modo claro", "Modo claro"), await tema("claro", "light"), await comando("tema automático", "Tema automático"), await tema("auto", null)];
  check("[cob:A:A-077] comandos «Modo oscuro», «Modo claro» y «Tema automático» cambian y guardan el tema (no hay «Tema oscuro»)", temas.every(Boolean) && !viejo, `${temas} viejo=${viejo}`);
  await comando("mi cuenta", "Mi cuenta");
  const hoja = page.getByRole("dialog", { name: "Mi cuenta" });
  await hoja.waitFor();
  const sinFormulario = (await page.locator("#pwd-actual").count()) === 0;
  await page.keyboard.press("Escape");
  await hoja.waitFor({ state: "detached" });
  await comando("cambiar contraseña", "Cambiar contraseña");
  await hoja.waitFor();
  const conFormulario = await page.locator("#pwd-actual").isVisible();
  await page.keyboard.press("Escape");
  await hoja.waitFor({ state: "detached" });
  // Solo las de esta cuenta: otras suites registran incidencias al mismo tiempo.
  const incidenciasDe = () => Number(fila("SELECT COUNT(*) AS n FROM incidencias WHERE reportada_por = ?", UC.id)?.n);
  const incidencias0 = incidenciasDe();
  const hayReportar = await comando("reportar incidencia", "Reportar incidencia");
  const reporte = page.getByRole("dialog", { name: "Reportar incidencia" });
  await reporte.waitFor();
  await page.keyboard.press("Escape");
  await reporte.waitFor({ state: "detached" });
  check("[cob:A:A-077] comandos «Mi cuenta» (abre la ventana), «Cambiar contraseña» (con el formulario abierto) y «Reportar incidencia» (con calidad:C; abre el formulario sin registrar nada)", sinFormulario && conFormulario && hayReportar === 1 && !!p.calidad?.C && incidenciasDe() === incidencias0, `${sinFormulario} ${conFormulario} ${hayReportar} calidad=${JSON.stringify(p.calidad)} incidencias ${incidencias0}→${incidenciasDe()}`);

  // Inicio: píldoras de pendientes y buscador en la página.
  // Se compara con la respuesta que pintó la página (otras suites cambian los conteos mientras tanto).
  const respuestaAvisos = page.waitForResponse((r) => r.url().includes("/api/inicio/avisos") && r.request().method() === "GET");
  await page.goto(`${BASE_WEB}/`);
  await page.locator("main h1").first().waitFor();
  const pintados = ((await (await respuestaAvisos).json().catch(() => null))?.items || []).map((x) => `${x.href}#${x.count}`);
  const pildoras = await esperar(async () => {
    const avisos = pintados;
    const enPantalla = await page.getByRole("list", { name: "Pendientes" }).getByRole("link").evaluateAll((els) => els.map((e) => `${e.getAttribute("href")}#${e.querySelector(".tnum")?.textContent?.trim()}`)).catch(() => []);
    return enPantalla.length === Math.min(4, avisos.length) && enPantalla.every((x) => avisos.includes(x)) ? { avisos, enPantalla } : null;
  }, 15_000);
  check("[cob:A:A-084] Inicio: hasta 4 píldoras de pendientes, cada una con el destino y el número que da /inicio/avisos", !!pildoras && pildoras.enPantalla.length > 0, JSON.stringify(pildoras));
  const enPagina = page.locator('main input[aria-label="Buscar en FICOTOX"]');
  await enPagina.fill("cómo anular");
  const opcion = page.locator("main").getByRole("option").filter({ hasText: "Corregir un registro" }).first();
  await opcion.waitFor();
  await opcion.click();
  await page.waitForURL((u) => u.pathname === "/ayuda" && u.hash === "#anular");
  check("[cob:A:A-085] el buscador del Inicio (en la página) encuentra «Corregir un registro» y lleva a /ayuda#anular", true);

  // Cerrar sesión desde el buscador: con confirmación.
  await comando("cerrar sesión", "Cerrar sesión");
  const confirma = page.getByRole("dialog", { name: "Cerrar sesión" });
  await confirma.waitFor();
  const descripcion = limpio(await confirma.innerText());
  await confirma.getByRole("button", { name: "Cancelar" }).click();
  await confirma.waitFor({ state: "detached" });
  const sigue = (await api("GET", "/auth/me", undefined, token)).status === 200;
  await comando("cerrar sesión", "Cerrar sesión");
  await confirma.waitFor();
  await confirma.getByRole("button", { name: "Cerrar sesión" }).click();
  await page.waitForURL((u) => u.pathname === "/login");
  const tras = await api("GET", "/auth/me", undefined, token);
  check("[cob:A:A-078] el comando «Cerrar sesión» pide confirmación («Saldrás de FICOTOX en este dispositivo.»): «Cancelar» la conserva; confirmar la revoca y vuelve al acceso", /Saldrás de FICOTOX en este dispositivo\./.test(descripcion) && sigue && tras.status === 401 && revocada(UC.id) === "salir", `${descripcion} cancelar=${sigue} tras=${tras.status}`);
});

/* ---------- Contadores del menú, Reportar incidencia y Ayuda con informes:C (Ricardo solo consulta) ---------- */
// Pendientes propios para que los contadores no dependan de otras suites: lo que capturó un estudiante supervisado por
// Ricardo (Por supervisar) y un documento vigente distribuido a Ricardo con lectura obligatoria (Bandeja).
{
  const est = await cuenta("Supervisado Ricardo", { rolClave: "estudiante", extra: { tipo_cuenta: "temporal", vigente_hasta: enDias(90), supervisor_id: id.ricardo, motivo_cuenta: "Estancia supervisada de la prueba de cobertura" } });
  const tEst = (await api("POST", "/auth/login", { email: est.email, password: est.password })).data?.token;
  const capt = await api("POST", "/inventory/reactivos", { tipo_reactivo: "alcoholes_solventes", producto: `Metanol supervisado ${s5}`, capacidad: 1, unidad_capacidad: "L", piezas: 1 }, tEst);
  const fd = new FormData();
  const campos = { clave: `FX-TCI-M${s5.toUpperCase()}`, titulo: `Instrucción para el menú ${s5}`, area_codigo: "TC", tipo_codigo: "I", elaborador_id: id.luis, revisor_id: id.gabriela, autorizador_id: id.patricia };
  for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
  fd.append("archivo_pdf", new Blob([await pdfConTexto(1, campos.titulo)]), "inicial.pdf");
  const doc = await api("POST", "/sgc/documentos", fd, t.ana);
  const vig = await api("POST", `/sgc/revisiones/${doc.data?.revision_id}/registrar-vigente`, { fecha_emision: "2025-01-10", fecha_proxima_revision: "2028-01-10" }, t.ana);
  const dist = await api("POST", `/sgc/revisiones/${doc.data?.revision_id}/distribucion`, { usuarios: [id.ricardo], punto_uso: "Oficina de coordinación", requiere_lectura: true, motivo: "Distribución de la prueba de cobertura" }, t.ana);
  check("(preparación) un registro por supervisar y una lectura pendiente para Ricardo", capt.status === 201 && doc.status === 201 && vig.status === 200 && dist.status < 300, `${capt.status} ${doc.status} ${vig.status} ${dist.status} ${dist.data?.message || ""}`);
}
await paso("ricardo", "contadores del menú y enlaces de la Ayuda", async (page) => {
  const token = await tokenDe(page);
  const p = (await permisosDe(token)).permissions || {};
  const aside = page.locator('aside[aria-label="Navegación principal"]');
  const leer = async (href) => {
    const c = aside.locator(`[data-contador="${href}"]`);
    return (await c.count()) ? { n: Number(await c.innerText()), etiqueta: await c.getAttribute("aria-label") } : { n: 0, etiqueta: null };
  };
  // Otras suites pueden crear pendientes a la vez: se compara la pantalla con la API hasta que coinciden.
  const conteos = await esperar(async () => {
    await page.goto(`${BASE_WEB}/ayuda`);
    await aside.waitFor();
    await esperar(async () => (await aside.locator("[data-contador]").count()) === 3, 10_000);
    const api3 = { sol: ((await api("GET", "/solicitudes", undefined, token)).data?.items || []).filter((x) => x.puedo_aprobar).length, sup: ((await api("GET", "/supervision", undefined, token)).data?.por_supervisar || []).length, sgc: Number((await api("GET", "/sgc/bandeja", undefined, token)).data?.total || 0) };
    // El de la Bandeja sube con animación.
    await esperar(async () => (await leer("/documentos/bandeja")).n === api3.sgc, 5000);
    const ui = { sol: await leer("/solicitudes"), sup: await leer("/supervision"), sgc: await leer("/documentos/bandeja") };
    return ui.sol.n === api3.sol && ui.sup.n === api3.sup && ui.sgc.n === api3.sgc ? { api3, ui } : null;
  }, 60_000);
  check("[cob:A:A-041] «Por autorizar» muestra el número de solicitudes que puede aprobar (aria-label «N pendientes»)", !!conteos && conteos.api3.sol > 0 && conteos.ui.sol.etiqueta === `${conteos.api3.sol} pendientes`, JSON.stringify(conteos));
  check("[cob:A:A-042] «Por supervisar» muestra el número por supervisar", !!conteos && conteos.api3.sup > 0 && conteos.ui.sup.etiqueta === `${conteos.api3.sup} pendientes`, JSON.stringify(conteos?.ui?.sup));
  check("[cob:A:A-043] «Bandeja» de Documentos SGC muestra (con animación) sus tareas", !!conteos && conteos.api3.sgc > 0 && conteos.ui.sgc.etiqueta === `${conteos.api3.sgc} pendientes`, JSON.stringify(conteos?.ui?.sgc));

  await page.goto(`${BASE_WEB}/ayuda`);
  await page.getByRole("heading", { name: "Cómo se usa FICOTOX" }).waitFor();
  const recepcion = await page.getByRole("link", { name: "Nueva recepción" }).getAttribute("href");
  await page.getByRole("link", { name: "Nuevo informe" }).click();
  await page.waitForURL((u) => u.pathname === "/informes/nuevo");
  check("[cob:A:A-181] con muestras:C e informes:C la Ayuda ofrece «Nueva recepción» (/muestras/recepcion/nueva) y «Nuevo informe» (lleva a /informes/nuevo)", !!p.muestras?.C && !!p.informes?.C && recepcion === "/muestras/recepcion/nueva", `${p.muestras?.C} ${p.informes?.C} ${recepcion}`);
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
