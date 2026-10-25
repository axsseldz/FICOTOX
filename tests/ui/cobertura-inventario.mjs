/*
 * Prueba integral · cobertura de Inventario, movimientos y equipos en pantalla (Playwright).
 * Cada check lleva la etiqueta [cob:I:<id>] del elemento de interfaz de la matriz que prueba
 * (filtros, orden, renglones, avisos, menús, ventanas, formularios y atajos de Reactivos,
 * Consumibles, Equipos, Mantenimiento y Movimientos). Sin errores de consola ni respuestas 5xx.
 */
import "../lib/reauth-auto.mjs";

process.env.BASE = `${(process.env.BASE || "http://localhost:3100").replace(/\/api$/, "")}/api`;
const { abrirNavegador, BASE_WEB, contrasena, toast, esperar } = await import("../lib/navegador.mjs");
const { api, cadena, crearCheck, credenciales, Database, EMAIL, enDias, fila, filas, hoy, login, sesiones } = await import("../lib/calidad.mjs");
const { pdfConTexto } = await import("../lib/archivos.mjs");

const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const QA = { email: "qa@ficotox.local", password: "QaFicotox2026!" };
const credencial = (quien) => (typeof quien === "object" ? quien : quien === "qa" ? QA : { email: EMAIL[quien], password: credenciales[EMAIL[quien]] });
const nav = await abrirNavegador({ suite: "cobertura-inventario", check, credencial });
const { paso } = nav;
const S = Date.now().toString(36).slice(-6).toUpperCase();
const ejecutar = (sql, ...p) => {
  const b = new Database(process.env.TEST_DB_PATH);
  try {
    b.prepare(sql).run(...p);
  } finally {
    b.close();
  }
};

/* ---------- Utilidades de pantalla ---------- */
const idsDe = (page, attr) => page.locator(`[${attr}]`).evaluateAll((els, a) => els.map((e) => Number(e.getAttribute(a))), attr);
/* Espera a que los renglones visibles sean exactamente `esperado` (en ese orden si `enOrden`); devuelve los últimos vistos. */
async function renglones(page, attr, esperado, { enOrden = false, ms = 15_000 } = {}) {
  const clave = (xs) => (enOrden ? xs : [...xs].sort((a, b) => a - b)).join(",");
  let ultimo = [];
  await esperar(async () => {
    ultimo = await idsDe(page, attr);
    return clave(ultimo) === clave(esperado);
  }, ms);
  return ultimo;
}
const mismo = (a, b, enOrden = false) => (enOrden ? a.join() === b.join() : [...a].sort().join() === [...b].sort().join());
async function filtrar(page, ...nombres) {
  await page.getByRole("button", { name: /^Filtros/ }).click();
  for (const nombre of nombres) await page.getByRole("switch", { name: nombre, exact: true }).click();
  await page.keyboard.press("Escape");
}
const menuDe = async (page, renglon) => {
  const boton = renglon.getByRole("button", { name: "Acciones" });
  if (!(await boton.count())) return [];
  await boton.click();
  await page.getByRole("menuitem").first().waitFor();
  const items = (await page.getByRole("menuitem").allInnerTexts()).map((x) => x.split("\n")[0].trim());
  await page.keyboard.press("Escape");
  return items;
};
const elegirMenu = async (page, renglon, nombre) => {
  await renglon.getByRole("button", { name: "Acciones" }).click();
  await page.getByRole("menuitem", { name: nombre }).click();
};
const abrirFicha = (renglon) => renglon.locator("button[aria-haspopup=dialog]").first().click();
const textoDe = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();
const botonesDe = async (dialogo) => (await dialogo.getByRole("button").allInnerTexts()).map((x) => x.trim()).filter(Boolean);
/* Diálogo de motivo (y contraseña): el que tiene #prompt-motivo, aunque haya otra ventana abierta. */
async function motivoYClave(page, motivo, confirmar, password) {
  const dialogo = page.getByRole("dialog").filter({ has: page.locator("#prompt-motivo") });
  await dialogo.waitFor();
  await page.locator("#prompt-motivo").fill(motivo);
  if (password && (await page.locator("#prompt-password").count())) await page.locator("#prompt-password").fill(password);
  await dialogo.getByRole("button", { name: confirmar, exact: true }).click();
}
const buscarEn = async (page, placeholder, texto) => {
  const input = page.getByPlaceholder(placeholder);
  await input.fill(texto);
  return input;
};
/* Busca y espera la respuesta del servidor con ese ?search=; devuelve los ids que respondió. */
async function buscarEnServidor(page, ruta, placeholder, texto) {
  const respuesta = page.waitForResponse((r) => new URL(r.url()).pathname === ruta && r.request().method() === "GET" && new URL(r.url()).searchParams.get("search") === texto);
  respuesta.catch(() => undefined);
  await buscarEn(page, placeholder, texto);
  const data = await (await respuesta).json();
  return (Array.isArray(data) ? data : data.items || []).map((x) => Number(x.id));
}
const respuestaDe = (page, ruta, param = null, valor = null) => {
  const respuesta = page.waitForResponse((r) => new URL(r.url()).pathname === ruta && r.request().method() === "GET" && (!param || new URL(r.url()).searchParams.get(param) === valor));
  respuesta.catch(() => undefined); // si no llega, falla el paso que la espera (no el proceso)
  return respuesta;
};
/* ¿Está activa la opción del menú Filtros? */
async function opcionActiva(page, nombre) {
  await page.getByRole("button", { name: /^Filtros/ }).click();
  const valor = await page.getByRole("switch", { name: nombre, exact: true }).getAttribute("aria-checked");
  await page.keyboard.press("Escape");
  return valor === "true";
}
/* Pop-up de validación: devuelve su texto y lo cierra con «Entendido». */
async function avisoDe(page, tipo = "faltan") {
  const aviso = page.locator(`[data-validacion="${tipo}"]`);
  await aviso.waitFor();
  const texto = await textoDe(aviso);
  await aviso.getByRole("button", { name: "Entendido" }).click();
  await aviso.waitFor({ state: "detached" });
  return texto;
}
const encabezadosDe = (page, region) => page.getByRole("region", { name: region }).locator(':scope > div[aria-hidden="true"] > span').allInnerTexts();
const tieneBaja = async (renglon) => (await renglon.getByText("Baja", { exact: true }).count()) > 0;
const dmy = (iso) => iso.split("-").reverse().join("/");
const seccionDe = (page, ficha, titulo) => ficha.locator("section").filter({ has: page.getByRole("heading", { name: titulo, exact: true }) });

/* ---------- Datos ---------- */
const reactivo = async (letra, extra = {}) => (await api("POST", "/inventory/reactivos", { tipo_reactivo: "alcoholes_solventes", producto: `Cob${S} ${letra}`, capacidad: 1, unidad_capacidad: "L", piezas: 1, ...extra }, t.qa)).data?.id;
const R_A = await reactivo("A ácido vencido", { tipo_reactivo: "acidos", marca: `Marca${S}`, localizacion: "Anaquel 3", caducidad: enDias(-5), lote: "LA-1" });
const R_B = await reactivo("B metanol por vencer", { piezas: 10, caducidad: enDias(10) });
await api("POST", `/inventory/reactivos/${R_B}/refill`, { tipo: "salida", cantidad: 9, motivo: `Salida cobertura ${S}` }, t.ricardo);
const R_C = await reactivo("C estándar indefinido", { tipo_reactivo: "estandares_preparados", piezas: 4, caducidad_indefinida: 1 });
const R_D = await reactivo("D columna", { tipo_reactivo: "columnas_cromatograficas", lote: "L-77", nuevo_usado: "Nueva", parte: "P-1", serie: "S-9" });
const R_E = await reactivo("E sodio vence hoy", { tipo_reactivo: "compuestos_sodio", unidad_capacidad: "kg", piezas: 2, caducidad: hoy() });
const R_G = await reactivo("G vacío");
await api("POST", `/inventory/reactivos/${R_G}/refill`, { tipo: "consumo", cantidad: 1, motivo: `Consumo cobertura ${S}` }, t.ricardo);
const R_H = await reactivo("H columna sin datos", { tipo_reactivo: "columnas_cromatograficas" });
const R_BAJA = await reactivo("Z retirado");
await api("DELETE", `/inventory/reactivos/${R_BAJA}`, { motivo: `Prueba de cobertura ${S}: frasco retirado` }, t.qa);
const REACTIVOS = [R_A, R_B, R_C, R_D, R_E, R_G, R_H];

const consumibleDe = async (letra, extra = {}) => (await api("POST", "/consumables", { producto: `Cob${S} ${letra}`, piezas: 1, ...extra }, t.qa)).data?.id;
const C_A = await consumibleDe("A guantes", { cantidad_por_pieza: 100, marca: `MarcaC${S}`, tamano_capacidad: "Talla M", localizacion: "Gaveta 2", fecha_ingreso: "2026-03-15" });
const C_B = await consumibleDe("B puntas", { cantidad_por_pieza: 3 });
const C_C = await consumibleDe("C viales", { piezas: 0 });
const C_BAJA = await consumibleDe("Z caja retirada", { cantidad_por_pieza: 10 });
await api("DELETE", `/consumables/${C_BAJA}`, { motivo: `Prueba de cobertura ${S}: caja retirada` }, t.qa);
await api("POST", `/consumables/${C_A}/refill`, { tipo: "consumo", cantidad: 4, motivo: `Consumo cobertura ${S}` }, t.ricardo);
await api("POST", `/consumables/${C_B}/refill`, { tipo: "ajuste", cantidad: 2, motivo: `Conteo cobertura ${S}` }, t.ricardo);
await api("POST", `/consumables/${C_A}/refill`, { tipo: "entrada", cantidad: 50, motivo: `Compra cobertura ${S}` }, t.ricardo);

const equipoDe = async (letra, extra = {}) => (await api("POST", "/inventory/equipos", { nombre: `Cob${S} ${letra}`, estado: "operativo", ...extra }, t.qa)).data?.id;
const E_A = await equipoDe("A balanza", { fecha_prox_calibracion: enDias(100) });
const E_B = await equipoDe("B centrífuga");
const M_EB = (await api("POST", "/inventory/mantenimientos", { id_equipo: E_B, tipo: "preventivo", fecha_programada: enDias(5), estado: "programado" }, t.qa)).data?.id;
const E_C = await equipoDe("C horno", { estado: "calibracion_pendiente" });
const E_D = await equipoDe("D pipeta", { fecha_prox_calibracion: enDias(-3) });
const E_E = await equipoDe("E viejo", { estado: "fuera_servicio", fecha_prox_calibracion: enDias(40) });
const E_BAJA = await equipoDe("Z retirado");
await api("DELETE", `/inventory/equipos/${E_BAJA}`, { motivo: `Prueba de cobertura ${S}: equipo retirado` }, t.qa);
const EQUIPOS = [E_A, E_B, E_C, E_D, E_E];

// Mantenimientos en equipos propios (rompen ui/dsp si se usan equipos compartidos).
const E_M = await equipoDe("M equipo de mantenimiento");
const E_N = await equipoDe("N otro equipo");
const mantDe = async (equipo, extra) => (await api("POST", "/inventory/mantenimientos", { id_equipo: equipo, tipo: "preventivo", estado: "programado", ...extra }, t.qa)).data?.id;
const M_A = await mantDe(E_M, { fecha_programada: enDias(10), tecnico_proveedor: `Proveedor Alfa ${S}`, observaciones: "Revisión semestral" });
const M_B = await mantDe(E_M, { fecha_programada: "2001-02-03", estado: "en_proceso", tipo: "correctivo", id_responsable: id.ricardo });
const M_C = await mantDe(E_M, { fecha_programada: enDias(60) });
const M_D = await mantDe(E_M, { fecha_programada: enDias(-3), estado: "completado", fecha_realizado: hoy() });
const M_E = await mantDe(E_N, { fecha_programada: "2001-03-04" });
const M_F = await mantDe(E_N, { fecha_programada: enDias(20) });
await api("DELETE", `/inventory/mantenimientos/${M_F}`, { motivo: `Prueba de cobertura ${S}: cancelado` }, t.qa);
await api("GET", "/inventory/mantenimientos", undefined, t.qa); // barrido: M_E queda vencido
const MANT = { M_EB, M_A, M_B, M_C, M_D, M_E, M_F };

// Cuenta sin inventario ni equipos.
const rolSin = await api("POST", "/admin/roles", { nombre: `Solo muestras UI ${S}`, motivo: "Rol de la prueba de cobertura", permisos: [{ modulo: "muestras", accion: "V", alcance: "total" }] }, t.jorge);
const SIN = { email: `solo.muestras.ui.${S.toLowerCase()}@ficotox.local`, password: `Temporal-${S}-2026` };
const altaSin = await api("POST", "/admin/usuarios", { nombre: `Solo Muestras UI ${S}`, email: SIN.email, activo: true, rol_id: rolSin.data?.id, departamento: "Laboratorio", password: SIN.password, motivo: "Alta de la prueba de cobertura" }, t.jorge);
ejecutar("UPDATE usuarios SET debe_cambiar_password = 0 WHERE email = ?", SIN.email);

check("(preparación) datos de inventario, equipos, mantenimientos y cuenta sin inventario", [...REACTIVOS, R_BAJA, C_A, C_B, C_C, C_BAJA, ...EQUIPOS, E_BAJA, E_M, E_N, ...Object.values(MANT)].every(Boolean) && fila("SELECT estado FROM mantenimientos WHERE id = ?", M_E)?.estado === "vencido" && altaSin.status === 201, `${altaSin.status} ${altaSin.data?.message} ${fila("SELECT estado FROM mantenimientos WHERE id = ?", M_E)?.estado}`);

// Segunda pasada: prefijo propio para no cambiar las listas «Cob<S>» que esperan los pasos de arriba.
const P = `Inv${S}`;
const reactivoP = async (letra, extra = {}) => (await api("POST", "/inventory/reactivos", { tipo_reactivo: "alcoholes_solventes", producto: `${P} ${letra}`, capacidad: 1, unidad_capacidad: "L", piezas: 1, ...extra }, t.qa)).data?.id;
const R_BUS = await reactivoP("R1 búsqueda", { id_interno: `IDX${S}`, lote: `LOTX${S}`, cas: `CASX${S}`, catalogo: `CATX${S}`, localizacion: `LOCX${S}` });
const R_BJ = await reactivoP("R2 para baja");
const R_ED = await reactivoP("R3 para editar", { localizacion: "Anaquel 1" });
const R_MOV = await reactivoP("R4 con movimientos", { piezas: 20 });
for (let i = 1; i <= 7; i += 1) await api("POST", `/inventory/reactivos/${R_MOV}/refill`, { tipo: i % 2 ? "salida" : "entrada", cantidad: i, motivo: `Movimiento ${i} de ${P}` }, t.ricardo);
await api("POST", `/inventory/reactivos/${R_MOV}/refill`, { tipo: "salida", cantidad: 2, motivo: `MotivoX${S} atrasado`, fecha_movimiento: enDias(-2) }, t.ricardo);
const R_NUL = await reactivoP("R5 sin cantidad");
// Valor heredado del Excel (existencia sin registrar): imposible por la API.
ejecutar("UPDATE reactivos SET cantidad_actual = NULL, piezas = NULL WHERE id = ?", R_NUL);
const R_INC = await reactivoP("R6 con incidencia");
const incR = await api("POST", "/calidad/incidencias", { tipo: "otro", fecha_hora_ocurrencia: new Date().toISOString(), descripcion: `Frasco ${P} con la etiqueta dañada`, impacto_resultados: "no", registros: [{ entidad: "reactivos", entidad_id: R_INC }] }, t.ricardo);
const R_AJ = await reactivoP("R7 para movimientos", { piezas: 5 });
const R_SIN = await reactivoP("R9 sin movimientos", { piezas: 0 });

const consumibleP = async (letra, extra = {}) => (await api("POST", "/consumables", { producto: `${P} ${letra}`, piezas: 1, ...extra }, t.qa)).data?.id;
const C_BUS = await consumibleP("C1 búsqueda", { cantidad_por_pieza: 100, marca: `MarcaX${S}`, id_interno: `CIDX${S}`, lote: `CLX${S}`, catalogo_parte_cas: `CCX${S}`, localizacion: `CLOCX${S}`, fecha_ingreso: "2026-02-10", tamano_capacidad: "Caja de 100", contenedor: "Caja", proveedor: "Proveedora Norte", observaciones: `Notas de ${P}` });
const C_POCO = await consumibleP("C2 pocos", { cantidad_por_pieza: 3 });
const C_CERO = await consumibleP("C3 agotado", { piezas: 0 });
const C_MIN = await consumibleP("C4 con mínimo", { cantidad_por_pieza: 15, stock_minimo: 20 });
const C_BJ = await consumibleP("C5 para baja", { cantidad_por_pieza: 10 });
const C_ED = await consumibleP("C6 para editar", { cantidad_por_pieza: 10, localizacion: "Gaveta 1" });
const CONSUMIBLES_P = [C_BUS, C_POCO, C_CERO, C_MIN, C_BJ, C_ED];

const equipoP = async (letra, extra = {}) => (await api("POST", "/inventory/equipos", { nombre: `${P} ${letra}`, estado: "operativo", ...extra }, t.qa)).data?.id;
const E_BUS = await equipoP("E1 cromatógrafo", { marca: `MarcaE${S}`, modelo: `ModE${S}`, numero_serie: `SerE${S}`, ubicacion: `UbiE${S}`, clave_bitacora: `FX-TCB-X${S}`, id_responsable: id.ricardo, fecha_prox_calibracion: enDias(20) });
const E_BJ = await equipoP("E2 para baja");
const E_ED = await equipoP("E3 para editar", { ubicacion: "Sala 1" });
const E_H = await equipoP("E4 con historial");
for (let i = 1; i <= 11; i += 1) await mantDe(E_H, { estado: "completado", fecha_programada: `2025-01-${String(i).padStart(2, "0")}`, fecha_realizado: `2025-01-${String(i).padStart(2, "0")}`, tecnico_proveedor: `Proveedor H${String(i).padStart(2, "0")}` });
const E_T = await equipoP("E5 por tipo");
const M_TP = await mantDe(E_T, { tipo: "preventivo", fecha_programada: enDias(3) });
const M_TC = await mantDe(E_T, { tipo: "correctivo", fecha_programada: enDias(4) });
const M_TK = await mantDe(E_T, { tipo: "calibracion", fecha_programada: enDias(6) });
const E_V = await equipoP("E6 vencido al listar");
const M_V = await mantDe(E_V, { fecha_programada: enDias(-4) });
const E_CN = await equipoP("E7 para cancelar");
const M_CN = await mantDe(E_CN, { fecha_programada: enDias(15) });
const E_DG = await equipoP("E8 de Diego");

// Cuentas que solo gestionan inventario o solo equipos: sus píldoras del Inicio son justo las de esos avisos.
async function cuentaCon(nombre, permisos) {
  const rol = await api("POST", "/admin/roles", { nombre: `${nombre} UI ${S}`, motivo: "Rol de la prueba de cobertura", permisos }, t.jorge);
  const cuenta = { email: `${nombre.toLowerCase().replace(/\s+/g, ".")}.ui.${S.toLowerCase()}@ficotox.local`, password: `Temporal-${S}-2026` };
  const alta = await api("POST", "/admin/usuarios", { nombre: `${nombre} UI ${S}`, email: cuenta.email, activo: true, rol_id: rol.data?.id, departamento: "Laboratorio", password: cuenta.password, motivo: "Alta de la prueba de cobertura" }, t.jorge);
  ejecutar("UPDATE usuarios SET debe_cambiar_password = 0 WHERE email = ?", cuenta.email);
  return { ...cuenta, id: fila("SELECT id FROM usuarios WHERE email = ?", cuenta.email)?.id, status: alta.status };
}
const INVG = await cuentaCon("Gestiona inventario", [{ modulo: "inventario", accion: "V", alcance: "total" }, { modulo: "inventario", accion: "G", alcance: "total" }]);
const EQG = await cuentaCon("Gestiona equipos", [{ modulo: "equipos", accion: "V", alcance: "total" }, { modulo: "equipos", accion: "G", alcance: "total" }]);

check("(preparación) datos propios de la segunda pasada: reactivos, consumibles, equipos, mantenimientos, incidencia y cuentas", [R_BUS, R_BJ, R_ED, R_MOV, R_NUL, R_INC, R_AJ, R_SIN, ...CONSUMIBLES_P, E_BUS, E_BJ, E_ED, E_H, E_T, M_TP, M_TC, M_TK, E_V, M_V, E_CN, M_CN, E_DG, INVG.id, EQG.id].every(Boolean) && incR.status === 201 && INVG.status === 201 && EQG.status === 201 && filas("SELECT id FROM movimientos WHERE tabla_origen = 'reactivos' AND id_item = ?", R_SIN).length === 0, `${incR.status} ${incR.data?.message} ${INVG.status} ${EQG.status}`);

/* ---------- Acceso y menú lateral ---------- */
await paso(SIN, "acceso: /inventario sin inventario ni equipos", async (page) => {
  await page.goto(`${BASE_WEB}/inventario`);
  await page.getByText("Sin acceso a inventario").waitFor();
  check("[cob:I:I-001] /inventario sin ningún permiso de lectura: «Sin acceso a inventario» y no redirige", new URL(page.url()).pathname === "/inventario" && (await page.getByText(/Tu rol no tiene permiso de lectura en reactivos, consumibles, equipos ni mantenimiento/).count()) > 0);
  const aside = page.locator('aside[aria-label="Navegación principal"]');
  await aside.locator("nav a").first().waitFor();
  const hrefs = await aside.locator("a").evaluateAll((links) => links.map((a) => new URL(a.href).pathname));
  check("[cob:I:I-004] sin inventario ni equipos el menú lateral no ofrece Inventario", !hrefs.some((h) => h.startsWith("/inventario") || h === "/movimientos"), hrefs.join(" "));
});
await paso("jorge", "acceso: /inventario con solo equipos (Administrador técnico)", async (page) => {
  await page.goto(`${BASE_WEB}/inventario`);
  await page.waitForURL((u) => u.pathname === "/inventario/equipos");
  check("[cob:I:I-001] /inventario redirige a la primera pestaña permitida (equipos:V → Equipos)", true);
  const aside = page.locator('aside[aria-label="Navegación principal"]');
  await aside.locator("nav a").first().waitFor();
  await page.waitForLoadState("networkidle");
  const hrefs = new Set(await aside.locator("a").evaluateAll((links) => links.map((a) => new URL(a.href).pathname)));
  check("[cob:I:I-004] con solo equipos: Equipos y Mantenimiento, sin Reactivos, Consumibles ni Movimientos", hrefs.has("/inventario/equipos") && hrefs.has("/inventario/mantenimiento") && !hrefs.has("/inventario/reactivos") && !hrefs.has("/inventario/consumibles") && !hrefs.has("/movimientos"), [...hrefs].join(" "));
});
await paso("qa", "acceso: /inventario y menú con todo", async (page) => {
  await page.goto(`${BASE_WEB}/inventario`);
  await page.waitForURL((u) => u.pathname === "/inventario/reactivos");
  const aside = page.locator('aside[aria-label="Navegación principal"]');
  await aside.locator("nav a").first().waitFor();
  await page.waitForLoadState("networkidle");
  const hrefs = new Set(await aside.locator("a").evaluateAll((links) => links.map((a) => new URL(a.href).pathname)));
  check("[cob:I:I-001] [cob:I:I-004] con inventario y equipos: /inventario abre Reactivos y el menú ofrece Reactivos, Consumibles, Equipos, Mantenimiento y Movimientos", ["/inventario/reactivos", "/inventario/consumibles", "/inventario/equipos", "/inventario/mantenimiento", "/movimientos"].every((h) => hrefs.has(h)), [...hrefs].filter((h) => /inventario|movimientos/.test(h)).join(" "));
  check("[cob:I:I-003] en pantalla ancha (≥ lg) no se muestran las pestañas «Secciones»", !(await page.getByRole("navigation", { name: "Secciones" }).isVisible()));
});

const ENCABEZADOS = {
  reactivos: ["Reactivos", "Reactivos, solventes y materiales de referencia con su existencia y caducidad."],
  consumibles: ["Consumibles", "Material de un solo uso: unidades disponibles y descuentos."],
  equipos: ["Equipos", "Equipos del laboratorio, su clave de bitácora y estado de calibración."],
  mantenimiento: ["Mantenimiento", "Lo que está programado, en proceso o vencido. Al completarse, el equipo vuelve a operativo"],
};
await paso(
  "qa",
  "inventario: encabezados y pestañas (< lg)",
  async (page) => {
    const vistos = {};
    for (const [ruta, [titulo, descripcion]] of Object.entries(ENCABEZADOS)) {
      await page.goto(`${BASE_WEB}/inventario/${ruta}`);
      await page.getByRole("heading", { name: titulo, exact: true }).first().waitFor();
      vistos[ruta] = (await page.getByText(descripcion).count()) > 0;
    }
    check("[cob:I:I-002] cada pestaña con su encabezado y descripción (Reactivos, Consumibles, Equipos, Mantenimiento)", Object.values(vistos).every(Boolean), JSON.stringify(vistos));
    const secciones = page.getByRole("navigation", { name: "Secciones" });
    await secciones.waitFor();
    const pestanas = (await secciones.getByRole("link").allInnerTexts()).map((x) => x.trim());
    await secciones.getByRole("link", { name: "Consumibles" }).click();
    await page.waitForURL((u) => u.pathname === "/inventario/consumibles");
    check("[cob:I:I-003] a 820 px: pestañas Reactivos · Consumibles · Equipos · Mantenimiento y cada una lleva a su pantalla", pestanas.join("|") === "Reactivos|Consumibles|Equipos|Mantenimiento", pestanas.join("|"));
  },
  { viewport: { width: 820, height: 900 } },
);
await paso(
  "jorge",
  "inventario: pestañas y «Sin acceso» con solo equipos",
  async (page) => {
    await page.goto(`${BASE_WEB}/inventario/equipos`);
    const secciones = page.getByRole("navigation", { name: "Secciones" });
    await secciones.waitFor();
    const pestanas = (await secciones.getByRole("link").allInnerTexts()).map((x) => x.trim());
    check("[cob:I:I-003] con solo equipos:V: pestañas Equipos · Mantenimiento (sin Reactivos ni Consumibles)", pestanas.join("|") === "Equipos|Mantenimiento", pestanas.join("|"));
    const pedidas = [];
    page.on("request", (r) => {
      if (/\/api\/(inventory\/reactivos|consumables|inventory\/movimientos)/.test(r.url())) pedidas.push(new URL(r.url()).pathname);
    });
    await page.goto(`${BASE_WEB}/inventario/reactivos`);
    await page.getByText("Sin acceso a esta sección").waitFor();
    const enReactivos = (await page.getByText("Tus roles no tienen permiso para ver esta sección.").count()) > 0;
    await page.goto(`${BASE_WEB}/movimientos`);
    await page.getByText("Sin acceso a esta sección").waitFor();
    check("[cob:I:I-005] [cob:I:I-010] [cob:I:I-180] sin inventario:V, Reactivos y Movimientos muestran «Sin acceso a esta sección» y no piden la lista", enReactivos && pedidas.length === 0, pedidas.join(" "));
  },
  { viewport: { width: 820, height: 900 } },
);
await paso(SIN, "inventario: «Sin acceso» en Equipos y Mantenimiento", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/equipos`);
  await page.getByText("Sin acceso a esta sección").waitFor();
  await page.goto(`${BASE_WEB}/inventario/mantenimiento`);
  await page.getByText("Sin acceso a esta sección").waitFor();
  check("[cob:I:I-005] [cob:I:I-110] [cob:I:I-140] sin equipos:V, Equipos y Mantenimiento muestran «Sin acceso a esta sección»", (await page.locator("[data-mantenimiento]").count()) === 0);
});

/* ---------- Inicio y campana: avisos de inventario y equipos ---------- */
const PILDORA = { reactivos_bajos: "stock bajo", reactivos_caducan: "por caducar", consumibles_bajos: "consumibles bajos", equipos_cal: "calibración", mant_vencidos: "mantenimiento vencido", mant_proximos: "mantenimiento próximo" };
const PESO = { danger: 0, warning: 1, info: 2 };
const gruposDe = async (token) => (await api("GET", "/inicio/avisos", undefined, token)).data?.items || [];
// Cada aviso con su frase, registro, detalle y enlace (los mismos de /inicio/avisos, ya aplanados).
const eventosDe = async (token) => {
  const n = (await api("GET", "/notificaciones", undefined, token)).data || {};
  return [...(n.items || []), ...(n.anteriores || [])];
};
{
  const g = await eventosDe(t.ricardo);
  const ev = (key, registro, frase) => g.find((e) => e.grupo === key && e.registro === registro && e.frase === frase);
  const enGrupo = (key) => g.filter((e) => e.grupo === key);
  const deBaja = g.some((e) => e.registro === `Cob${S} Z retirado`);
  const rb = [ev("reactivos_bajos", `Cob${S} G vacío`, "Reactivo agotado"), ev("reactivos_bajos", `Cob${S} B metanol por vencer`, "Stock bajo")];
  check("[cob:I:I-200] «Stock bajo» (a quien gestiona inventario): «Reactivo agotado» · «Agotado» y «Stock bajo» · «Quedan 1 L», con enlace a la ficha; sin los dados de baja", rb[0]?.detalle === "Agotado" && rb[0]?.href === `/inventario/reactivos?abrir=${R_G}` && rb[1]?.detalle === "Quedan 1 L" && !deBaja, JSON.stringify(rb));
  const rc = [ev("reactivos_caducan", `Cob${S} A ácido vencido`, "Reactivo caducado"), ev("reactivos_caducan", `Cob${S} E sodio vence hoy`, "Caduca pronto")];
  check("[cob:I:I-201] «Por caducar»: «Reactivo caducado» (rojo, «Caducó el …») y «Caduca pronto»; sin el indefinido", rc[0]?.tono === "danger" && /^Caducó el/.test(rc[0]?.detalle || "") && rc[1]?.href === `/inventario/reactivos?abrir=${R_E}` && !enGrupo("reactivos_caducan").some((e) => e.registro === `Cob${S} C estándar indefinido`), JSON.stringify(rc));
  const cb = [ev("consumibles_bajos", `Cob${S} C viales`, "Consumible agotado"), ev("consumibles_bajos", `Cob${S} B puntas`, "Pocas unidades")];
  check("[cob:I:I-202] «Consumibles bajos»: «Consumible agotado» · «Agotado» y «Pocas unidades» · «2 unidades» (≤ 5 sin mínimo propio)", cb[0]?.detalle === "Agotado" && cb[1]?.detalle === "2 unidades" && cb[1]?.href === `/inventario/consumibles?abrir=${C_B}` && !enGrupo("consumibles_bajos").some((e) => e.registro === `Cob${S} A guantes`), JSON.stringify(cb));
  const ec = [ev("equipos_cal", `Cob${S} E viejo`, "Fuera de servicio"), ev("equipos_cal", `Cob${S} D pipeta`, "Calibración vencida"), ev("equipos_cal", `Cob${S} C horno`, "Calibración pendiente")];
  check("[cob:I:I-203] «Calibración»: «Fuera de servicio», «Calibración vencida» («Vencía el …») y «Calibración pendiente», con enlace a la ficha del equipo", ec.every(Boolean) && /^Vencía el/.test(ec[1].detalle || "") && ec[2].href === `/inventario/equipos?abrir=${E_C}` && !enGrupo("equipos_cal").some((e) => e.registro === `Cob${S} A balanza`), JSON.stringify(ec));
  const mv = [ev("mant_vencidos", `Cob${S} N otro equipo`, "Mantenimiento vencido"), ev("mant_vencidos", `Cob${S} M equipo de mantenimiento`, "Mantenimiento vencido"), ev("mant_proximos", `Cob${S} B centrífuga`, "Mantenimiento próximo")];
  const conM_C = g.some((e) => e.href.startsWith("/inventario/mantenimiento") && e.href.endsWith(`abrir=${M_C}`));
  check("[cob:I:I-204] «Mantenimiento vencido» (estado vencido o en proceso con fecha pasada) y «Mantenimiento próximo» (≤ 30 días), con su filtro y ficha; no el de 60 días", mv[0]?.href === `/inventario/mantenimiento?filtro=vencido&abrir=${M_E}` && mv[1]?.href === `/inventario/mantenimiento?filtro=vencido&abrir=${M_B}` && mv[2]?.href === `/inventario/mantenimiento?filtro=proximo&abrir=${M_EB}` && /^Preventivo · /.test(mv[2]?.detalle || "") && !conM_C, JSON.stringify(mv));
  const gl = await gruposDe(t.luis);
  check("[cob:I:I-200] [cob:I:I-201] [cob:I:I-202] [cob:I:I-203] [cob:I:I-204] quien solo usa inventario y equipos (Técnico Analista) no recibe estos avisos", !gl.some((x) => PILDORA[x.key]), gl.map((x) => x.key).join(" "));
}
for (const [cuenta, claves, abrir] of [
  [INVG, ["reactivos_bajos", "reactivos_caducan", "consumibles_bajos"], ["stock bajo", "/inventario/reactivos?filtro=bajo", "data-reactivo", [R_B, R_G]]],
  [EQG, ["mant_vencidos", "equipos_cal", "mant_proximos"], ["mantenimiento vencido", "/inventario/mantenimiento?filtro=vencido", "data-mantenimiento", [M_E, M_V]]],
]) {
  await paso(cuenta, `inicio: píldoras de ${claves.join(", ")}`, async (page) => {
    const token = await login(cuenta.email, cuenta.password);
    await page.goto(`${BASE_WEB}/`);
    const lista = page.getByRole("list", { name: "Pendientes" });
    await lista.waitFor();
    let esperadas = [];
    let vistas = [];
    await esperar(async () => {
      esperadas = [...(await gruposDe(token))].filter((x) => x.count > 0).sort((a, b) => PESO[a.tone] - PESO[b.tone]).slice(0, 4).map((x) => `${x.href} ${x.count} ${PILDORA[x.key] || x.key}`);
      vistas = await lista.getByRole("link").evaluateAll((as) => as.map((a) => `${a.getAttribute("href")} ${a.innerText.replace(/\s+/g, " ").trim()}`));
      return esperadas.join("|") === vistas.join("|");
    });
    const tags = claves.map((k) => `[cob:I:${{ reactivos_bajos: "I-200", reactivos_caducan: "I-201", consumibles_bajos: "I-202", equipos_cal: "I-203", mant_vencidos: "I-204", mant_proximos: "I-204" }[k]}]`);
    check(`${[...new Set(tags)].join(" ")} Inicio: píldoras «${claves.map((k) => PILDORA[k]).join("», «")}» con su cuenta y su lista (las más urgentes primero)`, esperadas.join("|") === vistas.join("|") && claves.every((k) => vistas.some((v) => v.endsWith(PILDORA[k]))), `${vistas.join(" | ")} ≠ ${esperadas.join(" | ")}`);
    const [etiqueta, destino, attr, ids] = abrir;
    await lista.getByRole("link").filter({ hasText: etiqueta }).click();
    await page.waitForURL((u) => `${u.pathname}${u.search}` === destino);
    for (const x of ids) await page.locator(`[${attr}="${x}"]`).waitFor();
    check(`${tags[0]} la píldora «${etiqueta}» lleva a ${destino} con esos registros`, true);
  });
}
const panelCampana = async (page) => {
  await page.goto(`${BASE_WEB}/`);
  await page.locator('button[aria-label^="Notificaciones"]:visible').first().click();
  const panel = page.locator("[data-campana-panel]");
  await panel.waitFor();
  await esperar(async () => !/Cargando…/.test(await panel.innerText()));
  return panel;
};
await paso("carmen", "campana: avisos de inventario y equipos", async (page) => {
  const panel = await panelCampana(page);
  const esperadas = [
    ["Reactivo agotado", `Cob${S} G vacío`],
    ["Stock bajo", `Cob${S} B metanol por vencer`],
    ["Reactivo caducado", `Cob${S} A ácido vencido`],
    ["Caduca pronto", `Cob${S} E sodio vence hoy`],
    ["Consumible agotado", `Cob${S} C viales`],
    ["Pocas unidades", `Cob${S} B puntas`],
    ["Calibración pendiente", `Cob${S} C horno`],
    ["Calibración vencida", `Cob${S} D pipeta`],
    ["Fuera de servicio", `Cob${S} E viejo`],
    ["Mantenimiento vencido", `Cob${S} N otro equipo`],
    ["Mantenimiento próximo", `Cob${S} B centrífuga`],
  ];
  const faltan = [];
  for (const [frase, registro] of esperadas) if (!(await panel.locator("li").filter({ hasText: registro }).filter({ hasText: frase }).count())) faltan.push(`${frase}: ${registro}`);
  const n = await api("GET", "/notificaciones", undefined, t.carmen);
  const tipos = new Set((n.data?.items || []).filter((x) => x.registro?.startsWith(`Cob${S}`)).map((x) => x.tipo));
  check("[cob:I:I-205] campana (Auxiliar Administrativo): los mismos avisos como notificaciones (stock_bajo, caducidad, calibracion, mantenimiento)", !faltan.length && ["stock_bajo", "caducidad", "calibracion", "mantenimiento"].every((x) => tipos.has(x)), `faltan: ${faltan.join(" | ")} · tipos: ${[...tipos].join(" ")}`);
  await panel.locator("li").filter({ hasText: `Cob${S} G vacío` }).filter({ hasText: "Reactivo agotado" }).getByText("Reactivo agotado").click();
  await page.waitForURL((u) => u.pathname === "/inventario/reactivos" && u.searchParams.get("abrir") === String(R_G));
  await page.locator(`[data-insumo-ventana="${R_G}"]`).waitFor();
  const leida = await esperar(() => fila("SELECT id FROM notificaciones_leidas WHERE usuario_id = ? AND clave LIKE ?", id.carmen, `stock_bajo:reactivo${R_G}:agotado:%`));
  check("[cob:I:I-205] al pulsarla abre la ficha del reactivo y queda leída (notificaciones_leidas)", !!leida);
});
await paso("luis", "campana: sin avisos de inventario para quien solo los usa", async (page) => {
  const panel = await panelCampana(page);
  check("[cob:I:I-205] la campana del Técnico Analista no trae los avisos de inventario ni de equipos", (await panel.getByText(`Cob${S}`).count()) === 0);
});

/* ---------- Reactivos: lista, filtros, orden, avisos ---------- */
await paso("qa", "reactivos: búsqueda, filtros, orden, renglones y contador", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/reactivos`);
  const input = await buscarEn(page, "Buscar por nombre, lote, CAS o catálogo", `Cob${S}`);
  const nombreAZ = [R_A, R_B, R_C, R_D, R_E, R_G, R_H];
  const todos = await renglones(page, "data-reactivo", nombreAZ, { enOrden: true });
  check("[cob:I:I-017] orden por omisión «Nombre A–Z»", mismo(todos, nombreAZ, true), todos.join());
  const contador = await page.getByText(/^\d+ reactivos?$/).first().innerText();
  check("[cob:I:I-023] contador «7 reactivos» con las filas visibles (la baja no cuenta)", contador.trim() === "7 reactivos" && !todos.includes(R_BAJA), contador);

  // Renglones: tipo · marca, ubicación, caducidad y medidor.
  const fA = await textoDe(page.locator(`[data-reactivo="${R_A}"]`));
  check("[cob:I:I-018] renglón: nombre, «tipo · marca» y ubicación", fA.includes(`Cob${S} A ácido vencido`) && fA.includes(`Ácidos · Marca${S}`) && fA.includes("Anaquel 3"), fA);
  const cad = async (r) => textoDe(page.locator(`[data-reactivo="${r}"] > :nth-child(3)`).or(page.locator(`[data-reactivo="${r}"]`)).first());
  const tA = await textoDe(page.locator(`[data-reactivo="${R_A}"]`));
  const tB = await textoDe(page.locator(`[data-reactivo="${R_B}"]`));
  const tC = await textoDe(page.locator(`[data-reactivo="${R_C}"]`));
  const tE = await textoDe(page.locator(`[data-reactivo="${R_E}"]`));
  const tD = await textoDe(page.locator(`[data-reactivo="${R_D}"]`));
  const tH = await textoDe(page.locator(`[data-reactivo="${R_H}"]`));
  void cad;
  check("[cob:I:I-020] caducidad: «venció hace 5 días», «vence en 10 días», «vence hoy», «Indefinida»", /venció hace 5 días/.test(tA) && /vence en 10 días/.test(tB) && /vence hoy/.test(tE) && /Indefinida/.test(tC), `${tA} | ${tB} | ${tE} | ${tC}`);
  const tonoA = await page.locator(`[data-reactivo="${R_A}"]`).getByText(/venció hace/).getAttribute("class");
  const tonoB = await page.locator(`[data-reactivo="${R_B}"]`).getByText(/vence en/).getAttribute("class");
  check("[cob:I:I-020] …en rojo lo vencido y en ámbar lo que vence en ≤ 30 días; columna cromatográfica sin caducidad («—»)", /text-danger/.test(tonoA || "") && /text-warning-text/.test(tonoB || "") && /—/.test(tD) && !/venc/.test(tD), `${tonoA} | ${tonoB} | ${tD}`);
  const medidor = async (r) => page.locator(`[data-reactivo="${r}"] [role=progressbar]`).getAttribute("aria-label");
  check("[cob:I:I-021] medidor de existencia: «1 de 10 L» y «Bajo» (10 %), «0 de 1 L» y «Vacío»", (await medidor(R_B)) === "1 de 10 L" && /Bajo/.test(tB) && (await medidor(R_G)) === "0 de 1 L" && /Vacío/.test(await textoDe(page.locator(`[data-reactivo="${R_G}"]`))), `${await medidor(R_B)} ${await medidor(R_G)}`);
  check("[cob:I:I-021] columnas: «Lote L-77 · Nueva» en vez de medidor y «Sin existencias» si no tienen datos", /Lote L-77 · Nueva/.test(tD) && /Sin existencias/.test(tH) && (await page.locator(`[data-reactivo="${R_D}"] [role=progressbar]`).count()) === 0, `${tD} | ${tH}`);

  await filtrar(page, "Existencia baja o vacía");
  const bajos = await renglones(page, "data-reactivo", [R_B, R_G]);
  check("[cob:I:I-014] «Existencia baja o vacía»: solo el de 10 % y el vacío", mismo(bajos, [R_B, R_G]), bajos.join());
  await filtrar(page, "Por vencer o vencidos");
  const vencer = await renglones(page, "data-reactivo", [R_A, R_B, R_E]);
  check("[cob:I:I-015] «Por vencer o vencidos»: vencido, a 10 días y hoy (no el indefinido ni las columnas)", mismo(vencer, [R_A, R_B, R_E]), vencer.join());
  await filtrar(page, "Por vencer o vencidos", "Caducidad más próxima");
  const porCad = await renglones(page, "data-reactivo", [R_A, R_E, R_B, R_C, R_D, R_G, R_H], { enOrden: true });
  check("[cob:I:I-017] «Caducidad más próxima»: vencido, hoy, 10 días y luego los sin fecha", mismo(porCad.slice(0, 3), [R_A, R_E, R_B], true), porCad.join());
  await filtrar(page, "Existencia más baja");
  let porExistencia = [];
  await esperar(async () => {
    porExistencia = await idsDe(page, "data-reactivo");
    return porExistencia[0] === R_G && porExistencia[1] === R_B;
  });
  check("[cob:I:I-017] «Existencia más baja»: vacío, 10 % y al final las columnas (sin existencia)", porExistencia[0] === R_G && porExistencia[1] === R_B && [R_D, R_H].every((x) => porExistencia.indexOf(x) >= 5), porExistencia.join());

  await page.getByRole("button", { name: "Limpiar búsqueda" }).click();
  await esperar(async () => (await idsDe(page, "data-reactivo")).some((x) => !REACTIVOS.includes(x)));
  const trasLimpiar = await idsDe(page, "data-reactivo");
  check("[cob:I:I-013] «Limpiar búsqueda» vacía el buscador y vuelve a la lista completa", (await input.inputValue()) === "" && trasLimpiar.some((x) => !REACTIVOS.includes(x)) && (await page.getByRole("button", { name: "Limpiar búsqueda" }).count()) === 0, `${trasLimpiar.length} renglones`);
});

/* ---------- Reactivos: ficha, botones y teclado ---------- */
await paso("qa", "reactivos: ficha (insignias, datos rápidos, baja, botones, ↑/↓, Escape)", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/reactivos?buscar=${encodeURIComponent(`Cob${S}`)}`);
  await renglones(page, "data-reactivo", REACTIVOS);
  await abrirFicha(page.locator(`[data-reactivo="${R_A}"]`));
  const fichaA = page.locator(`[data-insumo-ventana="${R_A}"]`);
  await fichaA.waitFor();
  const tA = await textoDe(fichaA);
  check("[cob:I:I-031] ficha vencida: insignia «Vencido» y datos rápidos Existencia «1 L» · Mínimo «20 %» · Caducidad · Lote", /Vencido/.test(tA) && /Existencia\s*1 L/.test(tA) && /Mínimo\s*20 %/.test(tA) && /Caducidad/.test(tA) && /Lote\s*LA-1/.test(tA), tA.slice(0, 300));
  const dialogo = page.getByRole("dialog");
  const botones = await botonesDe(dialogo);
  check("[cob:I:I-036] activo con todos los permisos: «Registrar movimiento», «Editar» y «Dar de baja» (sin «Reactivar»)", ["Registrar movimiento", "Editar", "Dar de baja"].every((b) => botones.includes(b)) && !botones.includes("Reactivar"), botones.join(", "));
  await page.keyboard.press("ArrowDown");
  await page.locator(`[data-insumo-ventana="${R_B}"]`).waitFor();
  const tB = await textoDe(page.locator(`[data-insumo-ventana="${R_B}"]`));
  check("[cob:I:I-037] ↓ pasa a la ficha siguiente de la lista", true);
  check("[cob:I:I-031] ficha por vencer: insignia «Por vencer»", /Por vencer/.test(tB) && !/Vencido/.test(tB), tB.slice(0, 200));
  await page.keyboard.press("ArrowUp");
  await fichaA.waitFor();
  check("[cob:I:I-037] ↑ regresa a la anterior", true);
  await page.getByRole("button", { name: "Anterior" }).isDisabled().then((d) => check("[cob:I:I-037] en la primera ficha «Anterior» está deshabilitado", d));
  await page.keyboard.press("Escape");
  await fichaA.waitFor({ state: "detached" });
  check("[cob:I:I-037] Escape cierra la ficha", (await page.locator("[data-insumo-ventana]").count()) === 0);

  await abrirFicha(page.locator(`[data-reactivo="${R_D}"]`));
  const fD = page.locator(`[data-insumo-ventana="${R_D}"]`);
  await fD.waitFor();
  const tD = await textoDe(fD);
  check("[cob:I:I-031] ficha de columna: datos rápidos Lote · Parte · Serie · Condición (sin existencia)", /Lote\s*L-77/.test(tD) && /Parte\s*P-1/.test(tD) && /Serie\s*S-9/.test(tD) && /Condición\s*Nueva/.test(tD) && !/Movimientos recientes/.test(tD), tD.slice(0, 300));
  await page.keyboard.press("Escape");

  // Baja: ficha con «Dado de baja el … · Motivo» y botones de un registro dado de baja.
  await filtrar(page, "Mostrar bajas");
  const conBaja = page.locator(`[data-reactivo="${R_BAJA}"]`);
  await conBaja.waitFor();
  await abrirFicha(conBaja);
  const fBaja = page.locator(`[data-insumo-ventana="${R_BAJA}"]`);
  await fBaja.waitFor();
  const tBaja = await textoDe(fBaja);
  check("[cob:I:I-031] [cob:I:I-032] ficha dada de baja: insignia «Baja» y «Dado de baja el … · Motivo: …»", /Baja/.test(tBaja) && /Dado de baja el \d/.test(tBaja) && tBaja.includes(`Motivo: Prueba de cobertura ${S}: frasco retirado`), tBaja.slice(0, 300));
  const bBaja = await botonesDe(page.getByRole("dialog"));
  check("[cob:I:I-036] dado de baja: «Editar» y «Reactivar», sin «Registrar movimiento» ni «Dar de baja»", bBaja.includes("Editar") && bBaja.includes("Reactivar") && !bBaja.includes("Registrar movimiento") && !bBaja.includes("Dar de baja"), bBaja.join(", "));
  await page.keyboard.press("Escape");
  const menuBaja = await menuDe(page, conBaja);
  check("[cob:I:I-024] el menú ⋯ de un reactivo dado de baja no ofrece «Registrar movimiento»", !menuBaja.includes("Registrar movimiento") && menuBaja.some((x) => /^Reactivar/.test(x)), menuBaja.join(", "));
  const menuActivo = await menuDe(page, page.locator(`[data-reactivo="${R_C}"]`));
  check("[cob:I:I-024] …y el de uno activo sí", menuActivo.includes("Registrar movimiento"), menuActivo.join(", "));
  await elegirMenu(page, page.locator(`[data-reactivo="${R_C}"]`), /Registrar movimiento/);
  const hoja = page.getByRole("dialog", { name: "Registrar movimiento" });
  await hoja.waitFor();
  check("[cob:I:I-024] «Registrar movimiento» abre la hoja de movimiento del reactivo", (await textoDe(hoja)).includes(`Cob${S} C estándar indefinido`));
});

await paso("hector", "reactivos: Auditor (solo lectura)", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/reactivos?buscar=${encodeURIComponent(`Cob${S}`)}&reponer=${R_C}`);
  await renglones(page, "data-reactivo", REACTIVOS);
  await page.waitForTimeout(800);
  check("[cob:I:I-040] ?reponer=<id> sin inventario:C de movimientos no abre nada", (await page.getByRole("dialog", { name: "Registrar movimiento" }).count()) === 0);
  const menu = await menuDe(page, page.locator(`[data-reactivo="${R_C}"]`));
  check("[cob:I:I-024] el Auditor no ve «Registrar movimiento» en el menú", !menu.includes("Registrar movimiento"), menu.join(", "));
  await abrirFicha(page.locator(`[data-reactivo="${R_C}"]`));
  await page.locator(`[data-insumo-ventana="${R_C}"]`).waitFor();
  const botones = await botonesDe(page.getByRole("dialog"));
  check("[cob:I:I-036] el Auditor no tiene botones de acción en la ficha", !["Registrar movimiento", "Editar", "Reactivar", "Dar de baja"].some((b) => botones.includes(b)), botones.join(", "));
  await page.keyboard.press("Escape");
  await page.goto(`${BASE_WEB}/inventario/reactivos?nuevo=1`);
  await page.locator("[data-reactivo]").first().waitFor();
  await page.waitForTimeout(800);
  check("[cob:I:I-038] ?nuevo=1 sin inventario:C del catálogo no abre el alta", (await page.getByRole("dialog", { name: "Nuevo reactivo" }).count()) === 0);
});

await paso("luis", "reactivos: ?reponer= con permiso de movimientos", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/reactivos?buscar=${encodeURIComponent(`Cob${S}`)}&reponer=${R_C}`);
  const hoja = page.getByRole("dialog", { name: "Registrar movimiento" });
  await hoja.waitFor();
  check("[cob:I:I-040] ?reponer=<id> con inventario:C de movimientos abre «Registrar movimiento» de ese reactivo", (await textoDe(hoja)).includes(`Cob${S} C estándar indefinido`));
  await page.keyboard.press("Escape");
  await hoja.waitFor({ state: "detached" });
  const menu = await menuDe(page, page.locator(`[data-reactivo="${R_C}"]`));
  check("[cob:I:I-025] [cob:I:I-027] [cob:I:I-028] quien solo registra movimientos (Técnico Analista) no ve «Editar», «Dar de baja…» ni «Reactivar…»", !menu.some((x) => /^(Editar|Dar de baja|Reactivar)/.test(x)) && menu.includes("Registrar movimiento"), menu.join(", "));
  check("[cob:I:I-011] sin inventario:C del catálogo no hay botón «Nuevo reactivo»", (await page.getByRole("button", { name: "Nuevo reactivo" }).count()) === 0);
});

/* ---------- Reactivos: búsqueda en el servidor, bajas, URL, vacío y menú ---------- */
await paso("qa", "reactivos: búsqueda por campo, «Mostrar bajas» y filtros por URL", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/reactivos`);
  await page.locator("[data-reactivo]").first().waitFor();
  const placeholder = "Buscar por nombre, lote, CAS o catálogo";
  const porCampo = {};
  for (const texto of [`${P} R1`, `IDX${S}`, `LOTX${S}`, `CASX${S}`, `CATX${S}`, `LOCX${S}`]) {
    const ids = await buscarEnServidor(page, "/api/inventory/reactivos", placeholder, texto);
    const vistos = await renglones(page, "data-reactivo", [R_BUS]);
    porCampo[texto] = ids.join() === String(R_BUS) && vistos.join() === String(R_BUS);
  }
  check("[cob:I:I-012] el buscador consulta al servidor (?search=) por nombre, ID interno, lote, CAS, catálogo y localización", Object.values(porCampo).every(Boolean), JSON.stringify(porCampo));

  await buscarEn(page, placeholder, `Cob${S}`);
  await renglones(page, "data-reactivo", REACTIVOS);
  const conBajas = respuestaDe(page, "/api/inventory/reactivos", "bajas", "1");
  await filtrar(page, "Mostrar bajas");
  const respuesta = await conBajas;
  const conBaja = await renglones(page, "data-reactivo", [...REACTIVOS, R_BAJA]);
  const tBaja = await textoDe(page.locator(`[data-reactivo="${R_BAJA}"]`));
  check("[cob:I:I-016] [cob:I:I-019] «Mostrar bajas» pide ?bajas=1 y suma el dado de baja con su insignia «Baja» (los activos no la llevan)", respuesta.ok() && conBaja.includes(R_BAJA) && (await tieneBaja(page.locator(`[data-reactivo="${R_BAJA}"]`))) && !(await tieneBaja(page.locator(`[data-reactivo="${R_C}"]`))), tBaja);
  const menuBaja = await menuDe(page, page.locator(`[data-reactivo="${R_BAJA}"]`));
  check("[cob:I:I-025] «Editar» también se ofrece en un reactivo dado de baja", menuBaja.includes("Editar"), menuBaja.join(", "));

  const porUrl = {};
  for (const [filtro, opcion, esperado] of [["bajo", "Existencia baja o vacía", [R_B, R_G]], ["vencer", "Por vencer o vencidos", [R_A, R_B, R_E]], ["bajas", "Mostrar bajas", [...REACTIVOS, R_BAJA]]]) {
    await page.goto(`${BASE_WEB}/inventario/reactivos?buscar=${encodeURIComponent(`Cob${S}`)}&filtro=${filtro}`);
    const vistos = await renglones(page, "data-reactivo", esperado);
    porUrl[filtro] = mismo(vistos, esperado) && (await page.getByPlaceholder(placeholder).inputValue()) === `Cob${S}` && (await opcionActiva(page, opcion));
  }
  check("[cob:I:I-039] ?buscar=… llena el buscador y ?filtro=bajo|vencer|bajas activa la opción y filtra", Object.values(porUrl).every(Boolean), JSON.stringify(porUrl));
});

await paso("qa", "reactivos: lista vacía con permiso de alta", async (page) => {
  await page.route((u) => u.pathname === "/api/inventory/reactivos", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], total: 0 }) }));
  await page.goto(`${BASE_WEB}/inventario/reactivos`);
  await page.getByText("Aún no hay reactivos").waitFor();
  const botones = await page.getByRole("button", { name: "Nuevo reactivo" }).count();
  await page.getByRole("region").getByRole("button", { name: "Nuevo reactivo" }).click();
  await page.getByRole("dialog", { name: "Nuevo reactivo" }).waitFor();
  check("[cob:I:I-022] [cob:I:I-011] sin reactivos: «Aún no hay reactivos» con su botón «Nuevo reactivo» (además del encabezado), que abre el alta", botones === 2 && (await page.getByText("Crea el primero con «Nuevo reactivo».").count()) > 0, `${botones} botones`);
  await page.keyboard.press("Escape");
  await buscarEn(page, "Buscar por nombre, lote, CAS o catálogo", "algo");
  await page.getByText("Sin coincidencias").waitFor();
  check("[cob:I:I-022] con búsqueda: «Sin coincidencias» y sin el botón del vacío", (await page.getByRole("region").getByRole("button", { name: "Nuevo reactivo" }).count()) === 0 && (await page.getByText("Prueba con otro término o cambia el filtro.").count()) > 0);
});
await paso("hector", "reactivos: lista vacía sin permiso de alta", async (page) => {
  await page.route((u) => u.pathname === "/api/inventory/reactivos", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], total: 0 }) }));
  await page.goto(`${BASE_WEB}/inventario/reactivos`);
  await page.getByText("Aún no hay reactivos").waitFor();
  check("[cob:I:I-022] [cob:I:I-011] sin inventario:C del catálogo: el vacío no ofrece «Nuevo reactivo» (ni el encabezado)", (await page.getByRole("button", { name: "Nuevo reactivo" }).count()) === 0);
});
await paso("hector", "reactivos: búsqueda y menú del Auditor", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/reactivos`);
  await page.locator("[data-reactivo]").first().waitFor();
  const ids = await buscarEnServidor(page, "/api/inventory/reactivos", "Buscar por nombre, lote, CAS o catálogo", `LOTX${S}`);
  check("[cob:I:I-010] [cob:I:I-012] con inventario:V (Auditor) la lista carga y busca en el servidor", ids.join() === String(R_BUS));
  const menu = await menuDe(page, page.locator(`[data-reactivo="${R_BUS}"]`));
  check("[cob:I:I-025] [cob:I:I-026] [cob:I:I-027] el Auditor no tiene «Editar», «Reportar incidencia» ni «Dar de baja…»", !menu.some((x) => /^(Editar|Reportar incidencia|Dar de baja)/.test(x)), menu.join(", "));
});

await paso("qa", "reactivos: editar (Cancelar y Guardar cambios) y reportar incidencia", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/reactivos?buscar=${encodeURIComponent(`${P} R3`)}`);
  const renglon = page.locator(`[data-reactivo="${R_ED}"]`);
  await renglon.waitFor();
  const ficha = respuestaDe(page, `/api/inventory/reactivos/${R_ED}`);
  await elegirMenu(page, renglon, /^Editar/);
  const hoja = page.getByRole("dialog", { name: "Editar reactivo" });
  await hoja.waitFor();
  await ficha;
  await page.locator("#reactivo-localizacion").waitFor();
  check("[cob:I:I-025] [cob:I:I-050] «Editar» pide el reactivo (GET /inventory/reactivos/:id) y abre «Editar reactivo» con sus datos", (await page.locator("#reactivo-localizacion").inputValue()) === "Anaquel 1" && (await botonesDe(hoja)).includes("Guardar cambios"));
  await page.locator("#reactivo-localizacion").fill("Anaquel 9");
  await hoja.getByRole("button", { name: "Cancelar", exact: true }).click();
  await hoja.waitFor({ state: "detached" });
  check("[cob:I:I-062] «Cancelar» cierra sin guardar", fila("SELECT localizacion FROM reactivos WHERE id = ?", R_ED)?.localizacion === "Anaquel 1");
  await elegirMenu(page, renglon, /^Editar/);
  await hoja.waitFor();
  await esperar(async () => (await page.locator("#reactivo-localizacion").inputValue()) === "Anaquel 1");
  await page.locator("#reactivo-localizacion").fill("Anaquel 2");
  await page.locator('button[form="reactivo-form"][type="submit"]').click();
  await toast(page, /Reactivo actualizado/);
  check("[cob:I:I-062] [cob:I:I-025] «Guardar cambios» guarda la edición (PUT) y lo deja en la bitácora", fila("SELECT localizacion FROM reactivos WHERE id = ?", R_ED)?.localizacion === "Anaquel 2" && !!fila("SELECT id FROM auditoria WHERE accion = 'editar' AND entidad = 'reactivos' AND entidad_id = ?", String(R_ED)));

  await elegirMenu(page, renglon, /Reportar incidencia/);
  const reporte = page.getByRole("dialog", { name: "Reportar incidencia" });
  await reporte.waitFor();
  check("[cob:I:I-026] «Reportar incidencia» abre el reporte con el reactivo ya ligado", (await textoDe(reporte)).includes(`${P} R3 para editar`));
  await page.locator("#inc-tipo").selectOption("otro");
  await page.locator("#inc-desc").fill(`Derrame del frasco ${P} en el anaquel`);
  await reporte.locator("[data-enviar-incidencia]").click();
  await toast(page, /reportada/);
  const ligada = await esperar(() => fila("SELECT i.id FROM incidencia_registros r JOIN incidencias i ON i.id = r.incidencia_id WHERE r.entidad = 'reactivos' AND r.entidad_id = ? AND i.descripcion LIKE ?", R_ED, `Derrame del frasco ${P}%`));
  check("[cob:I:I-026] al reportarla queda una incidencia ligada al reactivo", !!ligada);
});

await paso("patricia", "reactivos: dar de baja con motivo y contraseña (Responsable General)", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/reactivos?buscar=${encodeURIComponent(`${P} R2`)}`);
  const renglon = page.locator(`[data-reactivo="${R_BJ}"]`);
  await renglon.waitFor();
  const menu = await menuDe(page, renglon);
  check("[cob:I:I-027] [cob:I:I-025] con inventario:AN: «Dar de baja…» (sin «Editar»)", menu.some((x) => /^Dar de baja/.test(x)) && !menu.includes("Editar"), menu.join(", "));
  await elegirMenu(page, renglon, /^Dar de baja/);
  const dialogo = page.getByRole("dialog", { name: `Dar de baja "${P} R2 para baja"` });
  await dialogo.waitFor();
  const botones = await botonesDe(dialogo);
  check("[cob:I:I-029] diálogo «Dar de baja “<nombre>”»: qué pasa con el registro, Motivo, Contraseña y botones «Cancelar» · «Dar de baja»", (await dialogo.getByText("El reactivo deja de aparecer en el inventario y en los formatos").count()) > 0 && (await page.locator("#prompt-motivo").count()) === 1 && (await page.locator("#prompt-password").count()) === 1 && botones.includes("Cancelar") && botones.includes("Dar de baja"), botones.join(", "));
  await page.locator("#prompt-motivo").fill("abc");
  await dialogo.getByRole("button", { name: "Dar de baja", exact: true }).click();
  const corto = await avisoDe(page);
  await page.locator("#prompt-motivo").fill("Frasco roto en el almacén");
  await dialogo.getByRole("button", { name: "Dar de baja", exact: true }).click();
  const sinClave = await avisoDe(page);
  check("[cob:I:I-029] [cob:I:2.4-cliente] motivo de menos de 5 caracteres y sin contraseña: el aviso lo marca y no se da de baja", /Motivo debe tener al menos 5 caracteres/.test(corto) && /Escribe tu contraseña para confirmar/.test(sinClave) && Number(fila("SELECT activo FROM reactivos WHERE id = ?", R_BJ)?.activo) === 1, `${corto} | ${sinClave}`);
  await dialogo.getByRole("button", { name: "Cancelar", exact: true }).click();
  await dialogo.waitFor({ state: "detached" });
  check("[cob:I:I-029] «Cancelar» cierra sin dar de baja", Number(fila("SELECT activo FROM reactivos WHERE id = ?", R_BJ)?.activo) === 1);
  await elegirMenu(page, renglon, /^Dar de baja/);
  await motivoYClave(page, "Frasco roto en el almacén", "Dar de baja", credenciales[EMAIL.patricia]);
  await toast(page, /Reactivo dado de baja/);
  const r = fila("SELECT activo, baja_motivo, baja_por FROM reactivos WHERE id = ?", R_BJ);
  check("[cob:I:I-027] con motivo y contraseña lo da de baja (activo = 0, motivo, quién) y deja entrada «baja» en la bitácora", Number(r?.activo) === 0 && r?.baja_motivo === "Frasco roto en el almacén" && Number(r?.baja_por) === id.patricia && !!fila("SELECT id FROM auditoria WHERE accion = 'baja' AND entidad = 'reactivos' AND entidad_id = ?", String(R_BJ)), JSON.stringify(r));
  await filtrar(page, "Mostrar bajas");
  const enBaja = page.locator(`[data-reactivo="${R_BJ}"]`);
  await enBaja.waitFor();
  const menuBaja = await menuDe(page, enBaja);
  check("[cob:I:I-028] sin inventario:G (Responsable General) no hay «Reactivar…»", !menuBaja.some((x) => /^Reactivar/.test(x)), menuBaja.join(", "));
});
await paso("ricardo", "reactivos: reactivar con motivo y contraseña", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/reactivos?buscar=${encodeURIComponent(`${P} R2`)}&filtro=bajas`);
  const renglon = page.locator(`[data-reactivo="${R_BJ}"]`);
  await renglon.waitFor();
  await elegirMenu(page, renglon, /^Reactivar/);
  const dialogo = page.getByRole("dialog", { name: `Reactivar "${P} R2 para baja"` });
  await dialogo.waitFor();
  await page.locator("#prompt-motivo").fill("ok");
  await dialogo.getByRole("button", { name: "Reactivar", exact: true }).click();
  const corto = await avisoDe(page);
  check("[cob:I:I-029] [cob:I:2.4-cliente] «Reactivar “<nombre>”» también exige motivo de 5 caracteres", /Motivo debe tener al menos 5 caracteres/.test(corto) && Number(fila("SELECT activo FROM reactivos WHERE id = ?", R_BJ)?.activo) === 0, corto);
  await motivoYClave(page, "Se encontró otro frasco en buen estado", "Reactivar", credenciales[EMAIL.ricardo]);
  await toast(page, /Reactivo reactivado/);
  check("[cob:I:I-028] con inventario:G «Reactivar…» lo reactiva con motivo y contraseña (bitácora «reactivar»)", Number(fila("SELECT activo FROM reactivos WHERE id = ?", R_BJ)?.activo) === 1 && !!fila("SELECT id FROM auditoria WHERE accion = 'reactivar' AND entidad = 'reactivos' AND entidad_id = ?", String(R_BJ)));
});

/* ---------- Reactivos: ficha (apertura, existencia, incidencias) ---------- */
await paso("qa", "reactivos: abrir la ficha y su sección «Existencia»", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/reactivos?buscar=${encodeURIComponent(P)}`);
  await page.locator(`[data-reactivo="${R_NUL}"]`).waitFor();
  await page.locator(`[data-reactivo="${R_ED}"] button[aria-haspopup=dialog]`).first().click();
  await page.locator(`[data-insumo-ventana="${R_ED}"]`).waitFor();
  check("[cob:I:I-030] clic en el renglón abre su ficha", true);
  await page.keyboard.press("Escape");
  await page.goto(`${BASE_WEB}/inventario/reactivos?abrir=${R_NUL}`);
  const fNul = page.locator(`[data-insumo-ventana="${R_NUL}"]`);
  await fNul.waitFor();
  const tNul = await textoDe(fNul);
  check("[cob:I:I-030] [cob:I:I-033] ?abrir=<id> abre la ficha; sin cantidad registrada: «Todavía no se registra la cantidad.» y Existencia «Sin registro»", /Todavía no se registra la cantidad\./.test(tNul) && /Existencia\s*Sin registro/.test(tNul), tNul.slice(0, 300));
  const insignias = {};
  for (const [r, esperado] of [[R_C, "Existencia suficiente"], [R_B, "Existencia baja"], [R_G, "Sin existencia"]]) {
    await page.goto(`${BASE_WEB}/inventario/reactivos?abrir=${r}`);
    const f = page.locator(`[data-insumo-ventana="${r}"]`);
    await f.waitFor();
    insignias[r] = await textoDe(f);
    insignias[r] = insignias[r].includes(esperado) && /Existencia/.test(insignias[r]);
  }
  await page.goto(`${BASE_WEB}/inventario/reactivos?abrir=${R_D}`);
  const fCol = page.locator(`[data-insumo-ventana="${R_D}"]`);
  await fCol.waitFor();
  const tCol = await textoDe(fCol);
  check("[cob:I:I-033] «Existencia suficiente» · «Existencia baja» (10 %) · «Sin existencia»; la columna no tiene esa sección", Object.values(insignias).every(Boolean) && !/Existencia (suficiente|baja)|Sin existencia\b/.test(tCol), JSON.stringify(insignias));
});
await paso("hector", "reactivos: incidencias del registro (Auditor con calidad:V)", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/reactivos?abrir=${R_INC}`);
  const seccion = page.locator(`[data-insumo-ventana="${R_INC}"] [data-incidencias-registro]`);
  await seccion.getByRole("link").first().waitFor();
  const enlace = await seccion.getByRole("link").first().getAttribute("href");
  const tSeccion = await textoDe(seccion);
  check("[cob:I:I-035] «Incidencias» lista la que menciona el reactivo (folio INC y descripción) con enlace a su ficha", enlace === `/calidad/incidencias/${incR.data?.id}` && tSeccion.includes(`Frasco ${P} con la etiqueta dañada`) && (await seccion.getByRole("button", { name: "Reportar incidencia" }).count()) === 0, `${enlace} ${tSeccion}`);
  await page.goto(`${BASE_WEB}/inventario/reactivos?abrir=${R_SIN}`);
  const vacia = page.locator(`[data-insumo-ventana="${R_SIN}"] [data-incidencias-registro]`);
  await vacia.getByText("Ninguna incidencia menciona este registro.").waitFor();
  check("[cob:I:I-035] sin incidencias: «Ninguna incidencia menciona este registro.»", true);
});
await paso("luis", "reactivos: incidencias del registro con solo reportar", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/reactivos?abrir=${R_INC}`);
  const seccion = page.locator(`[data-insumo-ventana="${R_INC}"] [data-incidencias-registro]`);
  await seccion.waitFor();
  await seccion.getByRole("button", { name: "Reportar incidencia" }).waitFor();
  check("[cob:I:I-035] con calidad solo sobre sus incidencias (Técnico Analista): no ve la incidencia ajena y puede «Reportar incidencia»", (await seccion.getByText(`Frasco ${P} con la etiqueta dañada`).count()) === 0, await textoDe(seccion));
});

/* ---------- Reactivos: alta y edición ---------- */
const nombreNuevo = `Cob${S} N metanol nuevo`;
await paso("qa", "reactivos: hoja de alta (categoría, campos, contenedor, fechas, mínimo, existencia)", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/reactivos?nuevo=1`);
  const hoja = page.getByRole("dialog", { name: "Nuevo reactivo" });
  await hoja.waitFor();
  check("[cob:I:I-038] ?nuevo=1 con inventario:C del catálogo abre «Nuevo reactivo»", true);
  const grupo = page.getByRole("radiogroup", { name: "Tipo de reactivo" });
  const categorias = (await grupo.getByRole("radio").evaluateAll((els) => els.map((e) => e.closest("label")?.innerText.trim() || e.getAttribute("aria-label") || ""))).map((x) => x.split("\n")[0]);
  check("[cob:I:I-051] 8 categorías (Ácidos … Columnas cromatográficas)", categorias.length === 8 && ["Ácidos", "Alcoholes y solventes orgánicos", "Compuestos de Amonio", "Compuestos de Sodio", "Estándares preparados", "Materiales de Referencia", "Misceláneos", "Columnas cromatográficas"].every((c) => categorias.includes(c)), categorias.join(" | "));
  await page.locator('button[form="reactivo-form"][type="submit"]').click();
  const popup = page.locator('[data-validacion="faltan"]');
  await popup.waitFor();
  check("[cob:I:I-051] sin categoría: el aviso pide elegirla", /categoría/i.test(await popup.innerText()));
  await page.getByRole("button", { name: "Entendido" }).last().click();
  await page.getByRole("radio", { name: /^Alcoholes y solventes/ }).check();
  for (const campo of ["id_interno", "marca", "proveedor", "catalogo", "cas", "lote", "localizacion", "contenedor", "fecha_ingreso", "fecha_apertura", "stock_minimo", "observaciones"]) await page.locator(`#reactivo-${campo}`).waitFor();
  const pista = await hoja.getByText("Puede ser distinto de la marca.").count();
  check("[cob:I:I-053] campos comunes (ID interno, Marca, Proveedor con su pista, Catálogo, CAS, Lote, Localización)", pista > 0);
  const contenedores = (await page.locator("#reactivo-contenedor option").allTextContents()).map((x) => x.trim());
  check("[cob:I:I-054] Contenedor: Botella, Botella de vidrio ámbar, Botella de plástico, Ampolleta, Vial, Bidón, Sobre, Otro", contenedores.join("|") === "Seleccionar|Botella|Botella de vidrio ámbar|Botella de plástico|Ampolleta|Vial|Bidón|Sobre|Otro", contenedores.join("|"));
  await page.locator("#reactivo-producto").fill(nombreNuevo);
  await page.locator("#reactivo-id_interno").fill(`ID-${S}`);
  await page.locator("#reactivo-marca").fill("Merck");
  await page.locator("#reactivo-proveedor").fill("Distribuidora del Pacífico");
  await page.locator("#reactivo-catalogo").fill("CAT-106009");
  await page.locator("#reactivo-cas").fill("67-56-1");
  await page.locator("#reactivo-lote").fill(`LOTE-${S}`);
  await page.locator("#reactivo-localizacion").fill("Gabinete de solventes");
  await page.locator("#reactivo-contenedor").selectOption("Botella de vidrio ámbar");
  await page.locator("#reactivo-fecha_ingreso").fill("2026-03-15");
  await page.locator("#reactivo-fecha_apertura").fill("2026-04-01");
  await page.locator("#reactivo-fecha_apertura").blur();
  check("[cob:I:I-057] fechas de ingreso y apertura se escriben y muestran dd/mm/aaaa", (await page.locator("#reactivo-fecha_ingreso").inputValue()) === "15/03/2026" && (await page.locator("#reactivo-fecha_apertura").inputValue()) === "01/04/2026", `${await page.locator("#reactivo-fecha_ingreso").inputValue()} ${await page.locator("#reactivo-fecha_apertura").inputValue()}`);
  await page.locator("#reactivo-capacidad").fill("2");
  await page.locator("#reactivo-unidad_capacidad").selectOption("L");
  await page.locator("#reactivo-piezas").fill("3");
  const existencia = await textoDe(hoja.getByText(/Total inicial:/));
  check("[cob:I:I-061] «3. Existencia»: Total inicial = capacidad × piezas (6 L); en el alta no hay «Existencia actual»", /Total inicial:\s*6 L/.test(existencia) && (await hoja.getByText(/Existencia actual:/).count()) === 0, existencia);
  await page.locator("#reactivo-stock_minimo").fill("-1");
  await page.locator('button[form="reactivo-form"][type="submit"]').click();
  await popup.waitFor();
  check("[cob:I:I-059] Stock mínimo negativo: el aviso lo marca («…mayor o igual a cero»)", /Stock mínimo.*mayor o igual a cero/.test(await popup.innerText()), await popup.innerText());
  await page.getByRole("button", { name: "Entendido" }).last().click();
  await page.locator("#reactivo-stock_minimo").fill("0.5");
  await page.locator("#reactivo-observaciones").fill("Grado HPLC");
  await page.locator('button[form="reactivo-form"][type="submit"]').click();
  await toast(page, /Reactivo creado/);
  const r = await esperar(() => fila("SELECT * FROM reactivos WHERE producto = ?", nombreNuevo));
  check("[cob:I:I-053] [cob:I:I-054] [cob:I:I-057] [cob:I:I-059] se guardan todos los campos (fechas AAAA-MM-DD, contenedor, mínimo, observaciones)", r?.tipo_reactivo === "alcoholes_solventes" && r?.id_interno === `ID-${S}` && r?.marca === "Merck" && r?.proveedor === "Distribuidora del Pacífico" && r?.catalogo === "CAT-106009" && r?.cas === "67-56-1" && r?.lote === `LOTE-${S}` && r?.localizacion === "Gabinete de solventes" && r?.contenedor === "Botella de vidrio ámbar" && r?.fecha_ingreso === "2026-03-15" && r?.fecha_apertura === "2026-04-01" && Number(r?.stock_minimo) === 0.5 && r?.observaciones === "Grado HPLC", JSON.stringify(r && { t: r.tipo_reactivo, c: r.contenedor, fi: r.fecha_ingreso, fa: r.fecha_apertura, m: r.stock_minimo }));
  check("[cob:I:I-061] …con existencia inicial 6 L", Number(r?.cantidad_actual) === 6, String(r?.cantidad_actual));
  // Edición: «Existencia actual».
  await page.goto(`${BASE_WEB}/inventario/reactivos?buscar=${encodeURIComponent(nombreNuevo)}`);
  const renglon = page.locator(`[data-reactivo="${r.id}"]`);
  await renglon.waitFor();
  await elegirMenu(page, renglon, /^Editar/);
  const edicion = page.getByRole("dialog", { name: "Editar reactivo" });
  await edicion.waitFor();
  await page.locator("#reactivo-producto").waitFor();
  const tEd = await textoDe(edicion.getByText(/Existencia actual:/));
  check("[cob:I:I-061] al editar se muestra «Existencia actual: 6 L»", /Existencia actual:\s*6 L/.test(tEd), tEd);
  await page.keyboard.press("Escape");
});

await paso("qa", "reactivos: hoja de alta (producto, capacidad, unidad, piezas, caducidad y aviso de lo que falta)", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/reactivos?nuevo=1`);
  const hoja = page.getByRole("dialog", { name: "Nuevo reactivo" });
  await hoja.waitFor();
  await page.getByRole("radio", { name: /^Alcoholes y solventes/ }).check();
  const enviar = () => page.locator('button[form="reactivo-form"][type="submit"]').click();
  const avisoDe = async (tipo = "faltan") => {
    const dialogo = page.locator(`[data-validacion="${tipo}"]`);
    await dialogo.waitFor();
    const texto = await dialogo.innerText();
    await page.getByRole("button", { name: "Entendido" }).last().click();
    await dialogo.waitFor({ state: "hidden" });
    return texto;
  };
  const nombre = `Cob${S} N validación de hoja`;
  const creado = () => fila("SELECT * FROM reactivos WHERE producto = ?", nombre);
  await page.locator("#reactivo-capacidad").fill("-1");
  await page.locator("#reactivo-piezas").fill("-2");
  await enviar();
  const t1 = await avisoDe();
  check("[cob:I:I-052] [cob:I:I-055] [cob:I:I-056] [cob:I:I-063] sin producto, capacidad y piezas negativas: el aviso «No se pudo crear el reactivo» dice lo que falta y no se crea", /No se pudo crear el reactivo/.test(t1) && /Indica el nombre del producto/.test(t1) && /«Capacidad por envase» debe ser un número mayor o igual a cero/.test(t1) && /«Piezas» debe ser un número mayor o igual a cero/.test(t1), t1.replace(/\s+/g, " "));
  await page.locator("#reactivo-producto").fill(nombre);
  await page.locator("#reactivo-capacidad").fill("2");
  await page.locator("#reactivo-piezas").fill("1.5");
  await enviar();
  const t2 = await avisoDe();
  check("[cob:I:I-055] con capacidad pero sin unidad: el aviso pide «Elige la unidad de la capacidad»", /Elige la unidad de la capacidad/.test(t2) && !/Indica el nombre del producto/.test(t2) && !creado(), t2.replace(/\s+/g, " "));
  const unidades = (await page.locator("#reactivo-unidad_capacidad option").allTextContents()).map((x) => x.trim());
  const pista = await hoja.getByText("Número de envases; acepta decimales.").count();
  check("[cob:I:I-055] [cob:I:I-056] Unidad (aria-label «Unidad de la capacidad») ofrece L, mL, kg y g; Piezas lleva la pista «Número de envases; acepta decimales.»", unidades.join("|") === "Unidad|L|mL|kg|g" && (await page.getByLabel("Unidad de la capacidad").count()) === 1 && pista > 0, `${unidades.join("|")} ${pista}`);
  await page.locator("#reactivo-unidad_capacidad").selectOption("L");
  // Caducidad e «Indefinido».
  const caducidad = page.locator("#reactivo-caducidad");
  await caducidad.fill("2027-12-31");
  await caducidad.blur();
  const indefinido = hoja.getByRole("checkbox", { name: "Indefinido" });
  await indefinido.check();
  const deshabilitada = await caducidad.isDisabled();
  await indefinido.uncheck();
  const otraVez = await caducidad.isEnabled();
  await caducidad.fill("2027-12-31");
  await caducidad.blur();
  check("[cob:I:I-058] «Indefinido» deshabilita la caducidad; al quitarlo se vuelve a capturar (dd/mm/aaaa)", deshabilitada && otraVez && (await caducidad.inputValue()) === "31/12/2027", `${deshabilitada} ${otraVez} ${await caducidad.inputValue()}`);
  // Error del servidor: el mismo aviso con su mensaje (respuesta 400 simulada una vez).
  await page.route("**/api/inventory/reactivos", (route) => (route.request().method() === "POST" ? route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "Elige un tipo de reactivo del catálogo" }) }) : route.continue()), { times: 1 });
  await enviar();
  const t3 = await avisoDe("servidor");
  check("[cob:I:I-063] un error del servidor sale en el pop-up «No se pudo crear el reactivo» (data-validacion «servidor») con su mensaje, y la hoja sigue abierta", /No se pudo crear el reactivo/.test(t3) && /Elige un tipo de reactivo del catálogo/.test(t3) && (await hoja.isVisible()) && !creado(), t3.replace(/\s+/g, " "));
  await enviar();
  await toast(page, /Reactivo creado/);
  const r = await esperar(() => creado());
  check("[cob:I:I-052] [cob:I:I-055] [cob:I:I-056] [cob:I:I-058] corregido se crea: producto, 2 L × 1.5 piezas = 3 L y caducidad 2027-12-31", r?.producto === nombre && r?.unidad_capacidad === "L" && Number(r?.piezas) === 1.5 && Number(r?.cantidad_actual) === 3 && r?.caducidad === "2027-12-31" && !Number(r?.caducidad_indefinida), JSON.stringify(r && { u: r.unidad_capacidad, p: r.piezas, e: r.cantidad_actual, c: r.caducidad }));
  const indef = `Cob${S} N caducidad indefinida`;
  await page.goto(`${BASE_WEB}/inventario/reactivos?nuevo=1`);
  await hoja.waitFor();
  await page.getByRole("radio", { name: /^Alcoholes y solventes/ }).check();
  await page.locator("#reactivo-producto").fill(indef);
  await hoja.getByRole("checkbox", { name: "Indefinido" }).check();
  await enviar();
  await toast(page, /Reactivo creado/);
  const ri = await esperar(() => fila("SELECT caducidad, caducidad_indefinida FROM reactivos WHERE producto = ?", indef));
  check("[cob:I:I-058] con «Indefinido» se guarda sin caducidad y con la marca", ri?.caducidad === null && Number(ri?.caducidad_indefinida) === 1, JSON.stringify(ri));
});

await paso("qa", "reactivos: hoja de columna cromatográfica", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/reactivos?nuevo=1`);
  const hoja = page.getByRole("dialog", { name: "Nuevo reactivo" });
  await hoja.waitFor();
  await page.getByRole("radio", { name: /^Columnas cromatográficas/ }).check();
  for (const campo of ["parte", "serie", "descripcion", "nuevo_usado", "metodo"]) await page.locator(`#reactivo-${campo}`).waitFor();
  const condicion = (await page.locator("#reactivo-nuevo_usado option").allTextContents()).map((x) => x.trim());
  const metodo = (await page.locator("#reactivo-metodo option").allTextContents()).map((x) => x.trim());
  check("[cob:I:I-060c] columnas: Número de parte, Número de serie, Descripción, Condición (Nueva/Usada) y Método (PSP/DSP/ASP/Otro); sin capacidad ni «3. Existencia»", condicion.join("|") === "Seleccionar|Nueva|Usada" && metodo.join("|") === "Seleccionar|PSP|DSP|ASP|Otro" && (await page.locator("#reactivo-capacidad").count()) === 0 && (await hoja.getByText("3. Existencia").count()) === 0, `${condicion.join("|")} ${metodo.join("|")}`);
  const nombre = `Cob${S} N columna nueva`;
  await page.locator("#reactivo-producto").fill(nombre);
  await page.locator("#reactivo-parte").fill("186003538");
  await page.locator("#reactivo-serie").fill(`SER-${S}`);
  await page.locator("#reactivo-descripcion").fill("C18, 2.1 × 50 mm, 1.7 µm");
  await page.locator("#reactivo-nuevo_usado").selectOption("Usada");
  await page.locator("#reactivo-metodo").selectOption("DSP");
  await page.locator('button[form="reactivo-form"][type="submit"]').click();
  await toast(page, /Reactivo creado/);
  const r = await esperar(() => fila("SELECT * FROM reactivos WHERE producto = ?", nombre));
  check("[cob:I:I-060c] la columna se guarda con parte, serie, descripción, condición y método (sin existencia)", r?.parte === "186003538" && r?.serie === `SER-${S}` && r?.descripcion === "C18, 2.1 × 50 mm, 1.7 µm" && r?.nuevo_usado === "Usada" && r?.metodo === "DSP" && r?.cantidad_actual === null, JSON.stringify(r && { p: r.parte, n: r.nuevo_usado, m: r.metodo, c: r.cantidad_actual }));
  const raro = await api("POST", "/inventory/reactivos", { tipo_reactivo: "columnas_cromatograficas", producto: `Cob${S} columna rara`, nuevo_usado: "Semi", metodo: "HPLC" }, t.qa);
  check("[cob:I:I-060c] el servidor valida el catálogo de condición y método (400)", raro.status === 400, `${raro.status} ${raro.data?.message}`);
});

/* ---------- Consumibles ---------- */
await paso("qa", "consumibles: orden, renglón, vacío, contador y menú", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/consumibles?buscar=${encodeURIComponent(`Cob${S}`)}`);
  const az = await renglones(page, "data-consumible", [C_A, C_B, C_C], { enOrden: true });
  check("[cob:I:I-075] orden por omisión «Nombre A–Z»", mismo(az, [C_A, C_B, C_C], true), az.join());
  await filtrar(page, "Menos unidades primero");
  const menos = await renglones(page, "data-consumible", [C_C, C_B, C_A], { enOrden: true });
  check("[cob:I:I-075] «Menos unidades primero»: 0, 2 y 146 unidades", mismo(menos, [C_C, C_B, C_A], true), menos.join());
  const tA = await textoDe(page.locator(`[data-consumible="${C_A}"]`));
  const medidor = await page.locator(`[data-consumible="${C_A}"] [role=progressbar]`).getAttribute("aria-label");
  check("[cob:I:I-076] renglón: producto, «marca · tamaño», ubicación, ingreso y medidor en unidades (el máximo sube con la entrada)", tA.includes(`Cob${S} A guantes`) && tA.includes(`MarcaC${S} · Talla M`) && tA.includes("Gaveta 2") && /15 mar\.? 2026/i.test(tA) && medidor === "146 de 146 unidades", `${tA} | ${medidor}`);
  const contador = await page.getByText(/^\d+ consumibles?$/).first().innerText();
  check("[cob:I:I-078] contador «3 consumibles»", contador.trim() === "3 consumibles", contador);
  const menuA = await menuDe(page, page.locator(`[data-consumible="${C_A}"]`));
  check("[cob:I:I-079] [cob:I:I-081] menú de un consumible activo: «Registrar movimiento» y «Reportar incidencia»", menuA.includes("Registrar movimiento") && menuA.includes("Reportar incidencia"), menuA.join(", "));
  await elegirMenu(page, page.locator(`[data-consumible="${C_A}"]`), /Reportar incidencia/);
  const reporte = page.getByRole("dialog", { name: "Reportar incidencia" });
  await reporte.waitFor();
  check("[cob:I:I-081] «Reportar incidencia» abre el reporte ligado al consumible", (await textoDe(reporte)).includes(`Cob${S} A guantes`), (await textoDe(reporte)).slice(0, 200));
  await page.keyboard.press("Escape");
  await reporte.waitFor({ state: "detached" });
  await elegirMenu(page, page.locator(`[data-consumible="${C_B}"]`), /Registrar movimiento/);
  const hoja = page.getByRole("dialog", { name: "Registrar movimiento" });
  await hoja.waitFor();
  check("[cob:I:I-079] «Registrar movimiento» abre la hoja del consumible (en unidades)", (await textoDe(hoja)).includes(`Cob${S} B puntas`) && (await textoDe(hoja)).includes("(unidades)"));
  await page.keyboard.press("Escape");
  await hoja.waitFor({ state: "detached" });
  await buscarEn(page, "Buscar por nombre o marca", `zz-sin-coincidencias-${S}`);
  await page.getByText("Sin coincidencias").waitFor();
  check("[cob:I:I-078] búsqueda sin resultados: «Sin coincidencias» y sin contador", (await page.getByText(/^\d+ consumibles?$/).count()) === 0);
});

await paso("patricia", "consumibles: Responsable General (baja sí, reactivar no, sin reportar)", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/consumibles?buscar=${encodeURIComponent(`Cob${S}`)}&filtro=bajas`);
  const baja = page.locator(`[data-consumible="${C_BAJA}"]`);
  await baja.waitFor();
  const menuBaja = await menuDe(page, baja);
  const menuActivo = await menuDe(page, page.locator(`[data-consumible="${C_A}"]`));
  check("[cob:I:I-083] sin inventario:G no hay «Reactivar…» en un consumible dado de baja (sí «Dar de baja…» en uno activo)", !menuBaja.some((x) => /^Reactivar/.test(x)) && menuActivo.some((x) => /^Dar de baja/.test(x)), `${menuBaja.join(", ")} / ${menuActivo.join(", ")}`);
  check("[cob:I:I-079] [cob:I:I-081] sin inventario:C ni calidad:C: ni «Registrar movimiento» ni «Reportar incidencia»", !menuActivo.includes("Registrar movimiento") && !menuActivo.includes("Reportar incidencia"), menuActivo.join(", "));
});

await paso("ricardo", "consumibles: reactivar con motivo y contraseña", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/consumibles?buscar=${encodeURIComponent(`Cob${S}`)}&filtro=bajas`);
  const baja = page.locator(`[data-consumible="${C_BAJA}"]`);
  await baja.waitFor();
  const menu = await menuDe(page, baja);
  check("[cob:I:I-079] [cob:I:I-083] dado de baja con inventario:G: «Reactivar…» y sin «Registrar movimiento»", menu.some((x) => /^Reactivar/.test(x)) && !menu.includes("Registrar movimiento"), menu.join(", "));
  await elegirMenu(page, baja, /^Reactivar/);
  await motivoYClave(page, "Se encontró la caja en el almacén", "Reactivar", credenciales[EMAIL.ricardo]);
  await toast(page, /Consumible reactivado/);
  check("[cob:I:I-083] «Reactivar…» con motivo y contraseña lo reactiva", Number(fila("SELECT activo FROM consumibles WHERE id = ?", C_BAJA)?.activo) === 1 && !!fila("SELECT id FROM auditoria WHERE accion = 'reactivar' AND entidad = 'consumibles' AND entidad_id = ?", String(C_BAJA)));
});

const nombreConsumible = `Cob${S} N filtros nuevos`;
await paso("qa", "consumibles: hoja de alta (campos, fecha, contenedor, total)", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/consumibles?nuevo=1`);
  const hoja = page.getByRole("dialog", { name: "Nuevo consumible" });
  await hoja.waitFor();
  const largos = {};
  for (const campo of ["c-id-interno", "c-marca", "c-proveedor", "c-catalogo", "c-lote", "c-tamano", "c-localizacion", "c-observaciones"]) largos[campo] = await page.locator(`#${campo}`).getAttribute("maxlength");
  check("[cob:I:I-092] límites en pantalla: ID 100, Marca 100, Proveedor 150, Catálogo 150, Lote 100, Tamaño 100, Localización 150, Observaciones 1000", JSON.stringify(largos) === JSON.stringify({ "c-id-interno": "100", "c-marca": "100", "c-proveedor": "150", "c-catalogo": "150", "c-lote": "100", "c-tamano": "100", "c-localizacion": "150", "c-observaciones": "1000" }), JSON.stringify(largos));
  check("[cob:I:I-093] Fecha de ingreso con la pista «Opcional; déjala vacía si no se conoce.»", (await hoja.getByText("Opcional; déjala vacía si no se conoce.").count()) > 0 && (await page.locator("#c-fecha").inputValue()) === "");
  const contenedores = (await page.locator("#c-contenedor option").allTextContents()).map((x) => x.trim());
  check("[cob:I:I-094] Contenedor: Caja, Bolsa, Rollo, Bote, Otro", contenedores.join("|") === "Seleccionar|Caja|Bolsa|Rollo|Bote|Otro", contenedores.join("|"));
  await page.locator("#c-producto").fill(nombreConsumible);
  await page.locator("#c-id-interno").fill(`CI-${S}`);
  await page.locator("#c-marca").fill("Whatman");
  await page.locator("#c-proveedor").fill("Proveedora Ensenada");
  await page.locator("#c-catalogo").fill("1820-047");
  await page.locator("#c-lote").fill(`LC-${S}`);
  await page.locator("#c-tamano").fill("47mm, 0.2um");
  await page.locator("#c-contenedor").selectOption("Caja");
  await page.locator("#c-localizacion").fill("Anaquel B");
  await page.locator("#c-observaciones").fill("Para filtrado de extractos");
  await page.locator("#c-piezas").fill("2");
  await page.locator("#c-cantidad").fill("12");
  const total = await textoDe(hoja.getByText(/^Total:/));
  check("[cob:I:I-096] «Total: 24 unidades (piezas × cantidad por pieza)… Es la existencia inicial»", /Total:\s*24 unidades \(piezas × cantidad por pieza\)/.test(total) && /existencia inicial/.test(total), total);
  await page.locator('button[form="consumible-form"][type="submit"]').click();
  await toast(page, /Consumible creado/);
  const c = await esperar(() => fila("SELECT * FROM consumibles WHERE producto = ?", nombreConsumible));
  check("[cob:I:I-092] [cob:I:I-093] [cob:I:I-094] [cob:I:I-096] se guarda con todos los campos, sin fecha (vacía) y existencia 24", c?.id_interno === `CI-${S}` && c?.marca === "Whatman" && c?.proveedor === "Proveedora Ensenada" && c?.catalogo_parte_cas === "1820-047" && c?.lote === `LC-${S}` && c?.tamano_capacidad === "47mm, 0.2um" && c?.contenedor === "Caja" && c?.localizacion === "Anaquel B" && c?.observaciones === "Para filtrado de extractos" && c?.fecha_ingreso === null && Number(c?.existencia) === 24, JSON.stringify(c && { f: c.fecha_ingreso, e: c.existencia, k: c.contenedor }));
  await page.goto(`${BASE_WEB}/inventario/consumibles?buscar=${encodeURIComponent(nombreConsumible)}`);
  const renglon = page.locator(`[data-consumible="${c.id}"]`);
  await renglon.waitFor();
  await elegirMenu(page, renglon, /^Editar/);
  const ed = page.getByRole("dialog", { name: "Editar consumible" });
  await ed.waitFor();
  await page.locator("#c-producto").waitFor();
  const totalEd = await textoDe(ed.getByText(/^Total:/));
  check("[cob:I:I-096] al editar avisa que la existencia cambia solo con movimientos", /cambia solo con movimientos/.test(totalEd), totalEd);
  await page.keyboard.press("Escape");
});

/* ---------- Consumibles: baja, búsqueda en el servidor, filtros, URL, ficha y hoja ---------- */
await paso("patricia", "consumibles: dar de baja con motivo y contraseña (Responsable General)", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/consumibles?buscar=${encodeURIComponent(`${P} C5`)}`);
  const renglon = page.locator(`[data-consumible="${C_BJ}"]`);
  await renglon.waitFor();
  const menu = await menuDe(page, renglon);
  check("[cob:I:I-080] sin inventario:E del catálogo (Responsable General) no hay «Editar»", !menu.includes("Editar"), menu.join(", "));
  await elegirMenu(page, renglon, /^Dar de baja/);
  const dialogo = page.getByRole("dialog", { name: `Dar de baja "${P} C5 para baja"` });
  await dialogo.waitFor();
  await page.locator("#prompt-motivo").fill("Caja");
  await dialogo.getByRole("button", { name: "Dar de baja", exact: true }).click();
  const corto = await avisoDe(page);
  check("[cob:I:2.4-cliente] baja de consumible con motivo corto: el aviso lo marca y no se da de baja", /Motivo debe tener al menos 5 caracteres/.test(corto) && Number(fila("SELECT activo FROM consumibles WHERE id = ?", C_BJ)?.activo) === 1, corto);
  await motivoYClave(page, "Caja dañada por humedad", "Dar de baja", credenciales[EMAIL.patricia]);
  await toast(page, /Consumible dado de baja/);
  const c = fila("SELECT activo, baja_motivo FROM consumibles WHERE id = ?", C_BJ);
  check("[cob:I:I-082] «Dar de baja…» con motivo y contraseña: activo = 0, motivo guardado y entrada «baja» en la bitácora", Number(c?.activo) === 0 && c?.baja_motivo === "Caja dañada por humedad" && !!fila("SELECT id FROM auditoria WHERE accion = 'baja' AND entidad = 'consumibles' AND entidad_id = ?", String(C_BJ)), JSON.stringify(c));
});
await paso("luis", "consumibles: sin baja ni edición para quien solo registra movimientos", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/consumibles?buscar=${encodeURIComponent(`${P} C6`)}`);
  const renglon = page.locator(`[data-consumible="${C_ED}"]`);
  await renglon.waitFor();
  const menu = await menuDe(page, renglon);
  check("[cob:I:I-080] [cob:I:I-082] el Técnico Analista no ve «Editar» ni «Dar de baja…» (sí «Registrar movimiento»)", !menu.some((x) => /^(Editar|Dar de baja)/.test(x)) && menu.includes("Registrar movimiento"), menu.join(", "));
  check("[cob:I:I-071] sin inventario:C del catálogo no hay «Nuevo consumible»", (await page.getByRole("button", { name: "Nuevo consumible" }).count()) === 0);
  await page.goto(`${BASE_WEB}/inventario/consumibles?nuevo=1`);
  await page.locator("[data-consumible]").first().waitFor();
  await page.waitForTimeout(800);
  check("[cob:I:I-084] ?nuevo=1 sin permiso de alta no abre nada", (await page.getByRole("dialog", { name: "Nuevo consumible" }).count()) === 0);
});
await paso("hector", "consumibles: lista y búsqueda del Auditor", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/consumibles`);
  await page.locator("[data-consumible]").first().waitFor();
  const ids = await buscarEnServidor(page, "/api/consumables", "Buscar por nombre o marca", `MarcaX${S}`);
  check("[cob:I:I-070] [cob:I:I-072] con inventario:V la lista carga y busca en el servidor", ids.join() === String(C_BUS) && (await page.getByRole("button", { name: "Nuevo consumible" }).count()) === 0, ids.join());
});
await paso("qa", "consumibles: búsqueda por campo, filtros, bajas, columnas y URL", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/consumibles`);
  await page.locator("[data-consumible]").first().waitFor();
  const placeholder = "Buscar por nombre o marca";
  const porCampo = {};
  for (const texto of [`${P} C1`, `MarcaX${S}`, `CIDX${S}`, `CLX${S}`, `CCX${S}`, `CLOCX${S}`]) {
    const ids = await buscarEnServidor(page, "/api/consumables", placeholder, texto);
    const vistos = await renglones(page, "data-consumible", [C_BUS]);
    porCampo[texto] = ids.join() === String(C_BUS) && vistos.join() === String(C_BUS);
  }
  check("[cob:I:I-072] el buscador consulta al servidor por producto, marca, ID interno, lote, catálogo y localización", Object.values(porCampo).every(Boolean), JSON.stringify(porCampo));
  await buscarEn(page, placeholder, P);
  const activos = CONSUMIBLES_P.filter((x) => x !== C_BJ);
  await renglones(page, "data-consumible", activos);
  const columnas = (await encabezadosDe(page, "Consumibles")).map((x) => x.trim()).filter(Boolean);
  const tBus = await textoDe(page.locator(`[data-consumible="${C_BUS}"]`));
  check("[cob:I:I-077] columnas Producto · Ubicación · Ingreso · Existencia (la fecha es la de ingreso)", columnas.join("|") === "Producto|Ubicación|Ingreso|Existencia" && /10 feb\.? 2026/i.test(tBus), `${columnas.join("|")} · ${tBus}`);
  await filtrar(page, "Stock bajo");
  const bajos = await renglones(page, "data-consumible", [C_POCO, C_CERO, C_MIN]);
  check("[cob:I:I-073] «Stock bajo»: ≤ su mínimo (15 de 20) o ≤ 5 sin mínimo (3 y 0)", mismo(bajos, [C_POCO, C_CERO, C_MIN]), bajos.join());
  await filtrar(page, "Agotados");
  const agotados = await renglones(page, "data-consumible", [C_CERO]);
  check("[cob:I:I-073] «Agotados»: solo el de 0 unidades", agotados.join() === String(C_CERO), agotados.join());
  await filtrar(page, "Agotados");
  await renglones(page, "data-consumible", activos);
  const conBajas = respuestaDe(page, "/api/consumables", "bajas", "1");
  await filtrar(page, "Mostrar bajas");
  await conBajas;
  await renglones(page, "data-consumible", CONSUMIBLES_P);
  const tBaja = await textoDe(page.locator(`[data-consumible="${C_BJ}"]`));
  check("[cob:I:I-074] [cob:I:I-077] «Mostrar bajas» pide ?bajas=1 y muestra el dado de baja con la insignia «Baja»", (await tieneBaja(page.locator(`[data-consumible="${C_BJ}"]`))) && !(await tieneBaja(page.locator(`[data-consumible="${C_BUS}"]`))), tBaja);

  const porUrl = {};
  for (const [filtro, opcion, esperado] of [["bajo", "Stock bajo", [C_POCO, C_CERO, C_MIN]], ["agotado", "Agotados", [C_CERO]], ["bajas", "Mostrar bajas", CONSUMIBLES_P]]) {
    await page.goto(`${BASE_WEB}/inventario/consumibles?buscar=${encodeURIComponent(P)}&filtro=${filtro}`);
    const vistos = await renglones(page, "data-consumible", esperado);
    porUrl[filtro] = mismo(vistos, esperado) && (await page.getByPlaceholder(placeholder).inputValue()) === P && (await opcionActiva(page, opcion));
  }
  await page.goto(`${BASE_WEB}/inventario/consumibles?abrir=${C_BUS}`);
  porUrl.abrir = await page.locator(`[data-insumo-ventana="${C_BUS}"]`).waitFor().then(() => true);
  await page.goto(`${BASE_WEB}/inventario/consumibles?reponer=${C_POCO}`);
  const hoja = page.getByRole("dialog", { name: "Registrar movimiento" });
  await hoja.waitFor();
  porUrl.reponer = (await textoDe(hoja)).includes(`${P} C2 pocos`);
  await page.goto(`${BASE_WEB}/inventario/consumibles?nuevo=1`);
  porUrl.nuevo = await page.getByRole("dialog", { name: "Nuevo consumible" }).waitFor().then(() => true);
  check("[cob:I:I-084] ?buscar=, ?filtro=bajo|agotado|bajas, ?abrir=, ?reponer= y ?nuevo=1", Object.values(porUrl).every(Boolean), JSON.stringify(porUrl));
});

await paso("qa", "consumibles: ficha (datos rápidos, existencia, secciones y laterales)", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/consumibles?abrir=${C_BUS}`);
  const ficha = page.locator(`[data-insumo-ventana="${C_BUS}"]`);
  await ficha.waitFor();
  await seccionDe(page, ficha, "Movimientos recientes").locator("li").first().waitFor();
  const tf = await textoDe(ficha);
  const sinMinimo = await ficha.locator('[title="Sin mínimo propio: avisa con 5 unidades o menos"]').count();
  check("[cob:I:I-085] datos rápidos: Existencia «100 unidades», Mínimo «5 unidades» (con la pista «Sin mínimo propio…»), Ingreso y Lote", /Existencia\s*100 unidades/.test(tf) && /Mínimo\s*5 unidades/.test(tf) && sinMinimo > 0 && /Ingreso\s*10 feb\.? 2026/i.test(tf) && tf.includes(`Lote CLX${S}`), tf.slice(0, 300));
  const secciones = {};
  for (const titulo of ["Movimientos recientes", "Observaciones", "Incidencias", "Presentación", "Dónde está", "Fechas"]) secciones[titulo] = (await ficha.getByText(titulo, { exact: true }).count()) > 0;
  const laterales = ["Tamaño o capacidad", "Caja de 100", "Cantidad por pieza", "Piezas del empaque", "Total inicial", "100 unidades", "Contenedor", `CIDX${S}`, `CCX${S}`, `MarcaX${S}`, "Proveedora Norte", `CLOCX${S}`, "Ingresó el", `Notas de ${P}`, "Existencia suficiente", "Existencia inicial"].filter((x) => !tf.includes(x));
  const botones = await botonesDe(page.getByRole("dialog"));
  check("[cob:I:I-085] secciones Existencia, Movimientos recientes, Observaciones, Incidencias y laterales Presentación · Dónde está · Fechas; botones de un activo", Object.values(secciones).every(Boolean) && !laterales.length && ["Registrar movimiento", "Editar", "Dar de baja"].every((b) => botones.includes(b)), `${JSON.stringify(secciones)} faltan: ${laterales.join(", ")} · ${botones.join(", ")}`);
  await page.goto(`${BASE_WEB}/inventario/consumibles?abrir=${C_MIN}`);
  const fMin = page.locator(`[data-insumo-ventana="${C_MIN}"]`);
  await fMin.waitFor();
  const tMin = await textoDe(fMin);
  check("[cob:I:I-085] con mínimo propio: Mínimo «20 unidades» sin la pista, «Existencia baja», sin «Observaciones» y «Sin fecha de ingreso»", /Mínimo\s*20 unidades/.test(tMin) && (await fMin.locator('[title^="Sin mínimo propio"]').count()) === 0 && tMin.includes("Existencia baja") && !tMin.includes("Observaciones") && tMin.includes("Sin fecha de ingreso") && /Ingreso\s*Sin fecha/.test(tMin), tMin.slice(0, 400));
  await page.goto(`${BASE_WEB}/inventario/consumibles?abrir=${C_CERO}`);
  const fCero = page.locator(`[data-insumo-ventana="${C_CERO}"]`);
  await fCero.waitFor();
  check("[cob:I:I-085] sin unidades: «Sin existencia»", (await textoDe(fCero)).includes("Sin existencia"));
});
await paso("hector", "consumibles: ficha del Auditor sin botones", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/consumibles?abrir=${C_BUS}`);
  await page.locator(`[data-insumo-ventana="${C_BUS}"]`).waitFor();
  const botones = await botonesDe(page.getByRole("dialog"));
  check("[cob:I:I-085] el Auditor ve la ficha sin «Registrar movimiento», «Editar» ni «Dar de baja»", !["Registrar movimiento", "Editar", "Dar de baja", "Reactivar"].some((b) => botones.includes(b)), botones.join(", "));
});

await paso("qa", "consumibles: hoja (validación, Cancelar, Crear, Editar y respaldo de la fila)", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/consumibles`);
  await page.locator("[data-consumible]").first().waitFor();
  await page.getByRole("button", { name: "Nuevo consumible" }).first().click();
  const hoja = page.getByRole("dialog", { name: "Nuevo consumible" });
  await hoja.waitFor();
  check("[cob:I:I-071] [cob:I:I-090] «Nuevo consumible» abre la hoja «Material de uso en laboratorio.» con «Crear consumible»", (await hoja.getByText("Material de uso en laboratorio.").count()) > 0 && (await botonesDe(hoja)).includes("Crear consumible"));
  check("[cob:I:I-091] Producto con máximo de 150 caracteres", (await page.locator("#c-producto").getAttribute("maxlength")) === "150");
  const nombre = `${P} C9 creado`;
  const cuantos = () => filas("SELECT id FROM consumibles WHERE producto = ?", nombre).length;
  await page.locator('button[form="consumible-form"][type="submit"]').click();
  const sinNombre = await avisoDe(page);
  check("[cob:I:I-091] sin producto: «No se pudo crear el consumible» · «Indica el nombre del producto»", /No se pudo crear el consumible/.test(sinNombre) && /Indica el nombre del producto/.test(sinNombre), sinNombre);
  await page.locator("#c-producto").fill(nombre);
  await page.locator("#c-piezas").fill("-1");
  await page.locator("#c-cantidad").fill("-2");
  await page.locator("#c-minimo").fill("-3");
  await page.locator('button[form="consumible-form"][type="submit"]').click();
  const negativos = await avisoDe(page);
  check("[cob:I:I-095] piezas, cantidad por pieza y stock mínimo negativos: el aviso marca los tres y no se crea", ["«Piezas» debe ser un número mayor o igual a cero", "«Cantidad por pieza» debe ser un número mayor o igual a cero", "«Stock mínimo» debe ser un número mayor o igual a cero"].every((x) => negativos.includes(x)) && cuantos() === 0, negativos);
  await hoja.getByRole("button", { name: "Cancelar", exact: true }).click();
  await hoja.waitFor({ state: "detached" });
  check("[cob:I:I-097] «Cancelar» cierra sin crear", cuantos() === 0);
  await page.getByRole("button", { name: "Nuevo consumible" }).first().click();
  await hoja.waitFor();
  await page.locator("#c-producto").fill(nombre);
  await page.locator("#c-piezas").fill("2");
  await page.locator("#c-cantidad").fill("5");
  await page.locator("#c-minimo").fill("4");
  await page.locator('button[form="consumible-form"][type="submit"]').click();
  await toast(page, /Consumible creado/);
  const creado = await esperar(() => fila("SELECT * FROM consumibles WHERE producto = ?", nombre));
  check("[cob:I:I-097] [cob:I:I-095] «Crear consumible» lo da de alta (POST) con 10 unidades y mínimo 4", Number(creado?.existencia) === 10 && Number(creado?.stock_minimo) === 4, JSON.stringify(creado && { e: creado.existencia, m: creado.stock_minimo }));

  await page.goto(`${BASE_WEB}/inventario/consumibles?buscar=${encodeURIComponent(`${P} C6`)}`);
  const renglon = page.locator(`[data-consumible="${C_ED}"]`);
  await renglon.waitFor();
  const pedida = respuestaDe(page, `/api/consumables/${C_ED}`);
  await elegirMenu(page, renglon, /^Editar/);
  const ed = page.getByRole("dialog", { name: "Editar consumible" });
  await ed.waitFor();
  await pedida;
  check("[cob:I:I-080] [cob:I:I-090] «Editar» pide el consumible y abre «Editar consumible» · «Registro #id» con «Guardar cambios»", (await ed.getByText(`Registro #${C_ED}`).count()) > 0 && (await botonesDe(ed)).includes("Guardar cambios") && (await page.locator("#c-localizacion").inputValue()) === "Gaveta 1");
  await page.locator("#c-localizacion").fill("Gaveta 3");
  await page.locator('button[form="consumible-form"][type="submit"]').click();
  await toast(page, /Consumible actualizado/);
  check("[cob:I:I-097] [cob:I:I-080] «Guardar cambios» guarda la edición (PUT) y la deja en la bitácora", fila("SELECT localizacion FROM consumibles WHERE id = ?", C_ED)?.localizacion === "Gaveta 3" && !!fila("SELECT id FROM auditoria WHERE accion = 'editar' AND entidad = 'consumibles' AND entidad_id = ?", String(C_ED)));
  await esperar(async () => (await textoDe(renglon)).includes("Gaveta 3"));
  await page.route((u) => u.pathname === `/api/consumables/${C_ED}`, (route) => (route.request().method() === "GET" ? route.abort() : route.continue()));
  await elegirMenu(page, renglon, /^Editar/);
  await ed.waitFor();
  const deFila = await page.locator("#c-localizacion").inputValue();
  check("[cob:I:I-080] si no se puede pedir el consumible, la hoja se abre con los datos de la fila", deFila === "Gaveta 3" && (await page.locator("#c-producto").inputValue()) === `${P} C6 para editar`, deFila);
  await ed.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.unroute((u) => u.pathname === `/api/consumables/${C_ED}`);
});

/* ---------- Hoja de movimiento: tipos, cantidad, fecha, motivo ---------- */
await paso("qa", "movimiento: hoja (tipos, validación, Cancelar, entrada con fecha anterior y ajuste)", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/reactivos?reponer=${R_AJ}`);
  const hoja = page.getByRole("dialog", { name: "Registrar movimiento" });
  await hoja.waitFor();
  check("[cob:I:I-100] «Registrar movimiento» con el nombre del insumo como descripción", (await hoja.getByText(`${P} R7 para movimientos`, { exact: true }).count()) > 0);
  const tipos = (await page.locator("#refill-tipo option").allTextContents()).map((x) => x.trim());
  const pistas = {};
  for (const [valor, pista] of [["salida", "Resta de la existencia (traslado, merma)."], ["consumo", "Resta lo usado en el trabajo del laboratorio."], ["ajuste", "Captura lo que contaste ese día; se registra la diferencia y se conserva lo que entró o salió después."], ["entrada", "Suma a la existencia (compra, reposición)."]]) {
    await page.locator("#refill-tipo").selectOption(valor);
    pistas[valor] = (await hoja.getByText(pista).count()) > 0;
    if (valor === "ajuste") pistas.etiquetas = (await textoDe(page.locator('label[for="refill-amount"]'))).includes("Cantidad contada (L)") && /^Motivo\b(?! u)/.test(await textoDe(page.locator('label[for="refill-reason"]')));
  }
  check("[cob:I:I-101] tipos Entrada · Salida · Consumo · Ajuste por conteo físico, cada uno con su pista (ajuste: «Cantidad contada (L)» y «Motivo»)", tipos.join("|") === "Entrada|Salida|Consumo|Ajuste por conteo físico" && Object.values(pistas).every(Boolean), `${tipos.join("|")} ${JSON.stringify(pistas)}`);
  const etiquetaCantidad = await textoDe(page.locator('label[for="refill-amount"]'));
  const etiquetaMotivo = await textoDe(page.locator('label[for="refill-reason"]'));
  check("[cob:I:I-102] [cob:I:I-104] en entrada: «Cantidad (L)» obligatoria y «Motivo u observación» con máximo 180", etiquetaCantidad.includes("Cantidad (L)") && etiquetaMotivo.includes("Motivo u observación") && (await page.locator("#refill-reason").getAttribute("maxlength")) === "180", `${etiquetaCantidad} | ${etiquetaMotivo}`);
  check("[cob:I:I-103] la fecha del movimiento es hoy por omisión", (await page.locator("#refill-fecha").inputValue()) === dmy(hoy()), await page.locator("#refill-fecha").inputValue());

  const movs = () => filas("SELECT id FROM movimientos WHERE tabla_origen = 'reactivos' AND id_item = ?", R_AJ).length;
  const antes = movs();
  const enviar = () => page.locator('button[form="stock-refill-form"][type="submit"]').click();
  await enviar();
  const vacia = await avisoDe(page);
  await page.locator("#refill-amount").fill("0");
  await enviar();
  const cero = await avisoDe(page);
  check("[cob:I:I-102] [cob:I:I-107] [cob:I:2.3-cliente] sin cantidad: «Indica la cantidad»; con 0: «La cantidad debe ser mayor que cero»", /Indica la cantidad/.test(vacia) && /La cantidad debe ser mayor que cero/.test(cero), `${vacia} | ${cero}`);
  await page.locator("#refill-amount").fill("2");
  await page.locator("#refill-fecha").fill("");
  await page.locator("#refill-fecha").blur();
  await enviar();
  const sinFecha = await avisoDe(page);
  await page.locator("#refill-fecha").fill(enDias(1));
  await page.locator("#refill-fecha").blur();
  await enviar();
  const futura = await avisoDe(page);
  check("[cob:I:I-103] [cob:I:2.3-cliente] sin fecha: «Indica la fecha del movimiento»; mañana: «La fecha del movimiento no puede ser futura»; nada se registra", /Indica la fecha del movimiento/.test(sinFecha) && /La fecha del movimiento no puede ser futura/.test(futura) && movs() === antes, `${sinFecha} | ${futura}`);
  await hoja.getByRole("button", { name: "Cancelar", exact: true }).click();
  await hoja.waitFor({ state: "detached" });
  check("[cob:I:I-106] «Cancelar» cierra sin registrar", movs() === antes);

  await page.goto(`${BASE_WEB}/inventario/reactivos?reponer=${R_AJ}`);
  await hoja.waitFor();
  await page.locator("#refill-amount").fill("2");
  await page.locator("#refill-fecha").fill(enDias(-1));
  await page.locator("#refill-fecha").blur();
  await page.locator("#refill-reason").fill(`Compra de ${P}`);
  await enviar();
  await toast(page, /Movimiento registrado/);
  const entrada = await esperar(() => fila("SELECT * FROM movimientos WHERE tabla_origen = 'reactivos' AND id_item = ? AND motivo = ?", R_AJ, `Compra de ${P}`));
  check("[cob:I:I-106] [cob:I:I-107] [cob:I:I-103] «Registrar movimiento»: entrada de 2 L con la fecha de ayer y «Movimiento registrado»; la existencia sube a 7 L", entrada?.tipo === "entrada" && Number(entrada?.cantidad) === 2 && entrada?.fecha_movimiento === enDias(-1) && Number(fila("SELECT cantidad_actual FROM reactivos WHERE id = ?", R_AJ)?.cantidad_actual) === 7, JSON.stringify(entrada && { t: entrada.tipo, c: entrada.cantidad, f: entrada.fecha_movimiento }));

  await page.goto(`${BASE_WEB}/inventario/reactivos?reponer=${R_AJ}`);
  await hoja.waitFor();
  await page.locator("#refill-tipo").selectOption("ajuste");
  await page.locator("#refill-amount").fill("-1");
  await enviar();
  const negativa = await avisoDe(page);
  await page.locator("#refill-amount").fill("6");
  await enviar();
  const sinMotivo = await avisoDe(page);
  check("[cob:I:I-102] [cob:I:I-104] [cob:I:2.3-cliente] ajuste: «La cantidad contada no puede ser negativa» y sin motivo «Indica el motivo del ajuste»", /La cantidad contada no puede ser negativa/.test(negativa) && /Indica el motivo del ajuste/.test(sinMotivo), `${negativa} | ${sinMotivo}`);
  await page.locator("#refill-reason").fill(`Conteo de ${P}`);
  await enviar();
  await toast(page, /Existencia ajustada/);
  const ajuste = await esperar(() => fila("SELECT * FROM movimientos WHERE tabla_origen = 'reactivos' AND id_item = ? AND tipo = 'ajuste'", R_AJ));
  check("[cob:I:I-107] [cob:I:I-101] el ajuste por conteo dice «Existencia ajustada» y deja la existencia en lo contado (6 L)", !!ajuste && Number(fila("SELECT cantidad_actual FROM reactivos WHERE id = ?", R_AJ)?.cantidad_actual) === 6, JSON.stringify(ajuste && { c: ajuste.cantidad, m: ajuste.motivo }));
});

/* ---------- Hoja de movimiento: vínculo ---------- */
const cad = await cadena(t, "COBUI");
const folioRecepcion = fila("SELECT folio_num FROM muestras_recepcion WHERE id = ?", cad.R)?.folio_num;
await paso("luis", "movimiento: vínculo sin acceso al folio", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/reactivos?buscar=${encodeURIComponent(`Cob${S}`)}&reponer=${R_C}`);
  const hoja = page.getByRole("dialog", { name: "Registrar movimiento" });
  await hoja.waitFor();
  const folio = page.locator("#refill-folio");
  check("[cob:I:I-105] sin vínculo el folio está deshabilitado («Folio del registro vinculado»)", (await folio.isDisabled()) && (await folio.getAttribute("aria-label")) === "Folio del registro vinculado");
  const opciones = (await page.locator("#refill-vinculo option").allTextContents()).map((x) => x.trim());
  check("[cob:I:I-105] vínculos: Sin vínculo, Recepción, Procesamiento, Extracción, Análisis", opciones.join("|") === "Sin vínculo|Recepción|Procesamiento|Extracción|Análisis", opciones.join("|"));
  await page.locator("#refill-amount").fill("1");
  await page.locator("#refill-vinculo").selectOption("recepcion");
  check("[cob:I:I-105] al elegir un vínculo el folio se habilita", !(await folio.isDisabled()));
  await page.locator('button[form="stock-refill-form"][type="submit"]').click();
  const popup = page.locator('[data-validacion="faltan"]');
  await popup.waitFor();
  check("[cob:I:I-105] [cob:I:2.3-cliente] con vínculo y sin folio: el aviso pide el folio", /folio/i.test(await popup.innerText()), await popup.innerText());
  await page.getByRole("button", { name: "Entendido" }).last().click();
  const antes = filas("SELECT id FROM movimientos WHERE tabla_origen = 'reactivos' AND id_item = ?", R_C).length;
  await folio.fill(String(folioRecepcion));
  await page.locator('button[form="stock-refill-form"][type="submit"]').click();
  const servidor = page.locator('[data-validacion="servidor"]');
  await servidor.waitFor();
  check("[cob:I:I-105] un folio al que no tiene acceso (recepción no asignada) → «No tienes acceso a este folio» y no se registra", /No tienes acceso a este folio/.test(await servidor.innerText()) && filas("SELECT id FROM movimientos WHERE tabla_origen = 'reactivos' AND id_item = ?", R_C).length === antes, await servidor.innerText());
});
await paso("qa", "movimiento: vínculo con acceso", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/reactivos?buscar=${encodeURIComponent(`Cob${S}`)}&reponer=${R_C}`);
  await page.getByRole("dialog", { name: "Registrar movimiento" }).waitFor();
  await page.locator("#refill-amount").fill("0.5");
  await page.locator("#refill-reason").fill(`Entrada vinculada ${S}`);
  await page.locator("#refill-vinculo").selectOption("recepcion");
  await page.locator("#refill-folio").fill(String(folioRecepcion));
  await page.locator('button[form="stock-refill-form"][type="submit"]').click();
  await toast(page, /Movimiento registrado/);
  const m = await esperar(() => fila("SELECT * FROM movimientos WHERE tabla_origen = 'reactivos' AND id_item = ? AND motivo LIKE ?", R_C, `Entrada vinculada ${S}%`));
  check("[cob:I:I-105] con acceso se registra ligado a la recepción (motivo «… · Recepción <folio>»)", m?.vinculo_tipo === "recepcion" && Number(m?.vinculo_id) === cad.R && String(m?.motivo).endsWith(`Recepción ${folioRecepcion}`), JSON.stringify(m && { v: m.vinculo_tipo, id: m.vinculo_id, motivo: m.motivo }));
});

await paso("qa", "reactivos: «Movimientos recientes» de la ficha", async (page) => {
  const pedida = respuestaDe(page, "/api/inventory/movimientos", "id", String(R_MOV));
  await page.goto(`${BASE_WEB}/inventario/reactivos?abrir=${R_MOV}`);
  const ficha = page.locator(`[data-insumo-ventana="${R_MOV}"]`);
  await ficha.waitFor();
  const url = new URL((await pedida).url());
  const seccion = seccionDe(page, ficha, "Movimientos recientes");
  await seccion.locator("li").first().waitFor();
  const items = await seccion.locator("li").allInnerTexts();
  check("[cob:I:I-034] «Movimientos recientes»: los 6 más recientes del reactivo (pedidos al servidor por tabla e id), sin el enlace «Ver todos» cuando hay", items.length === 6 && /Salida de 7 L/.test(items[0]) && items[0].includes(`Movimiento 7 de ${P}`) && items.every((x) => !/atrasado|Existencia inicial/.test(x)) && url.searchParams.get("tabla") === "reactivos" && url.searchParams.get("limite") === "6" && (await seccion.getByRole("link", { name: "Ver todos los movimientos" }).count()) === 0, items.map((x) => x.replace(/\s+/g, " ")).join(" | "));
  await page.goto(`${BASE_WEB}/inventario/reactivos?abrir=${R_C}`);
  const fichaC = page.locator(`[data-insumo-ventana="${R_C}"]`);
  await fichaC.waitFor();
  const origen = seccionDe(page, fichaC, "Movimientos recientes").getByRole("link", { name: new RegExp(`Entrada vinculada ${S}`) });
  await origen.waitFor();
  check("[cob:I:I-034] un movimiento ligado a una recepción enlaza a su registro de origen", (await origen.getAttribute("href")) === `/muestras/recepcion/${cad.R}`, await origen.getAttribute("href"));
  await page.goto(`${BASE_WEB}/inventario/reactivos?abrir=${R_SIN}`);
  const fichaSin = page.locator(`[data-insumo-ventana="${R_SIN}"]`);
  await fichaSin.getByText("Sin movimientos recientes.").waitFor();
  await fichaSin.getByRole("link", { name: "Ver todos los movimientos" }).click();
  await page.waitForURL((u) => u.pathname === "/movimientos");
  check("[cob:I:I-034] sin movimientos: «Sin movimientos recientes. Ver todos los movimientos» lleva a Movimientos", true);
});

/* ---------- Equipos ---------- */
await paso("qa", "equipos: filtros, orden, vacío, contador y menú", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/equipos?buscar=${encodeURIComponent(`Cob${S}`)}`);
  const todos = [E_A, E_B, E_C, E_D, E_E, E_M, E_N];
  const az = await renglones(page, "data-equipo", todos, { enOrden: true });
  check("[cob:I:I-115] orden por omisión «Nombre A–Z»", mismo(az, todos, true), az.join());
  const contador = await page.getByText(/^\d+ equipos?$/).first().innerText();
  check("[cob:I:I-118] contador «7 equipos» (sin la baja)", contador.trim() === "7 equipos", contador);
  await filtrar(page, "Operativos");
  const operativos = await renglones(page, "data-equipo", [E_A, E_D]);
  check("[cob:I:I-113] «Operativos»: solo los de estado operativo (también el de calibración vencida por fecha)", mismo(operativos, [E_A, E_D]), operativos.join());
  await filtrar(page, "En mantenimiento");
  const enMant = await renglones(page, "data-equipo", [E_B, E_M, E_N]);
  check("[cob:I:I-113] «En mantenimiento»: los que tienen un mantenimiento pendiente (también vencido)", mismo(enMant, [E_B, E_M, E_N]), enMant.join());
  await filtrar(page, "Con alerta de calibración");
  const alerta = await renglones(page, "data-equipo", [E_C, E_D, E_E]);
  check("[cob:I:I-113] «Con alerta de calibración»: calibración pendiente, fecha vencida y fuera de servicio", mismo(alerta, [E_C, E_D, E_E]), alerta.join());
  await filtrar(page, "Con alerta de calibración", "Calibración más próxima");
  const porCal = await renglones(page, "data-equipo", [E_D, E_E, E_A, E_B, E_C, E_M, E_N], { enOrden: true });
  check("[cob:I:I-115] «Calibración más próxima»: vencida, a 40 días, a 100 días y luego sin fecha", mismo(porCal.slice(0, 3), [E_D, E_E, E_A], true), porCal.join());
  await filtrar(page, "Mantenimiento más próximo");
  let porMant = [];
  await esperar(async () => {
    porMant = await idsDe(page, "data-equipo");
    return mismo(porMant.slice(0, 3), [E_M, E_N, E_B], true);
  });
  check("[cob:I:I-115] «Mantenimiento más próximo»: los de mantenimiento de 2001 (02-03, 03-04) y luego el de 5 días", mismo(porMant.slice(0, 3), [E_M, E_N, E_B], true), porMant.join());
  await filtrar(page, "Mantenimiento más próximo", "Mostrar bajas");
  const conBaja = page.locator(`[data-equipo="${E_BAJA}"]`);
  await conBaja.waitFor();
  check("[cob:I:I-114] «Mostrar bajas» agrega el equipo dado de baja con su insignia «Baja»", /Baja/.test(await textoDe(conBaja)));
  const menuActivo = await menuDe(page, page.locator(`[data-equipo="${E_A}"]`));
  const menuBaja = await menuDe(page, conBaja);
  check("[cob:I:I-119] [cob:I:I-121] activo: «Programar mantenimiento» y «Reportar incidencia»; dado de baja: sin «Programar mantenimiento»", menuActivo.includes("Programar mantenimiento") && menuActivo.includes("Reportar incidencia") && !menuBaja.includes("Programar mantenimiento"), `${menuActivo.join(", ")} / ${menuBaja.join(", ")}`);
  await abrirFicha(conBaja);
  await page.locator(`[data-equipo-ventana="${E_BAJA}"]`).waitFor();
  const bBaja = await botonesDe(page.getByRole("dialog"));
  check("[cob:I:I-126] ficha de un equipo dado de baja: «Editar» y «Reactivar», sin «Programar mantenimiento» ni «Dar de baja»", bBaja.includes("Editar") && bBaja.includes("Reactivar") && !bBaja.includes("Programar mantenimiento") && !bBaja.includes("Dar de baja"), bBaja.join(", "));
  await page.keyboard.press("Escape");
  await abrirFicha(page.locator(`[data-equipo="${E_A}"]`));
  await page.locator(`[data-equipo-ventana="${E_A}"]`).waitFor();
  const bA = await botonesDe(page.getByRole("dialog"));
  check("[cob:I:I-126] ficha de un equipo activo: «Programar mantenimiento», «Editar» y «Dar de baja»", ["Programar mantenimiento", "Editar", "Dar de baja"].every((b) => bA.includes(b)) && !bA.includes("Reactivar"), bA.join(", "));
  await page.getByRole("dialog").getByRole("button", { name: "Programar mantenimiento" }).click();
  await page.waitForURL((u) => u.pathname === "/inventario/mantenimiento");
  await page.getByRole("dialog", { name: "Programar mantenimiento" }).waitFor();
  await page.waitForFunction((v) => document.querySelector("#m-equipo")?.value === v, String(E_A), { timeout: 15_000 });
  check("[cob:I:I-119] [cob:I:I-126] «Programar mantenimiento» lleva a Mantenimiento con el equipo ya elegido", true);
  await page.keyboard.press("Escape");
  await page.goto(`${BASE_WEB}/inventario/equipos?buscar=${encodeURIComponent(`Cob${S}`)}`);
  await page.locator(`[data-equipo="${E_A}"]`).waitFor();
  await elegirMenu(page, page.locator(`[data-equipo="${E_A}"]`), /Programar mantenimiento/);
  await page.waitForURL((u) => u.pathname === "/inventario/mantenimiento" && (u.searchParams.get("equipo") === String(E_A) || !u.search));
  await page.getByRole("dialog", { name: "Programar mantenimiento" }).waitFor();
  const elegido = await page.waitForFunction((v) => document.querySelector("#m-equipo")?.value === v, String(E_A), { timeout: 15_000 }).then(() => true, () => false);
  check("[cob:I:I-119] …también desde el menú ⋯ (/inventario/mantenimiento?nuevo=1&equipo=<id>)", elegido, await page.locator("#m-equipo").inputValue());
  await page.keyboard.press("Escape");
  await page.goto(`${BASE_WEB}/inventario/equipos?buscar=${encodeURIComponent(`zz-sin-coincidencias-${S}`)}`);
  await page.getByText("Sin coincidencias").waitFor();
  check("[cob:I:I-118] búsqueda sin resultados: «Sin coincidencias» y sin contador", (await page.getByText(/^\d+ equipos?$/).count()) === 0);
});

await paso("patricia", "equipos: sin calidad:C ni equipos:C", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/equipos?buscar=${encodeURIComponent(`Cob${S}`)}`);
  await page.locator(`[data-equipo="${E_A}"]`).waitFor();
  const menu = await menuDe(page, page.locator(`[data-equipo="${E_A}"]`));
  check("[cob:I:I-119] [cob:I:I-121] Responsable General: sin «Programar mantenimiento» ni «Reportar incidencia» (sí «Dar de baja…»)", !menu.includes("Programar mantenimiento") && !menu.includes("Reportar incidencia") && menu.some((x) => /^Dar de baja/.test(x)), menu.join(", "));
  await abrirFicha(page.locator(`[data-equipo="${E_A}"]`));
  await page.locator(`[data-equipo-ventana="${E_A}"]`).waitFor();
  const b = await botonesDe(page.getByRole("dialog"));
  check("[cob:I:I-126] …en la ficha solo «Dar de baja»", b.includes("Dar de baja") && !b.includes("Programar mantenimiento") && !b.includes("Editar"), b.join(", "));
  await page.keyboard.press("Escape");

  await page.goto(`${BASE_WEB}/inventario/equipos?buscar=${encodeURIComponent(`${P} E2`)}`);
  const renglon = page.locator(`[data-equipo="${E_BJ}"]`);
  await renglon.waitFor();
  check("[cob:I:I-111] sin equipos:C del equipo (Responsable General) no hay «Nuevo equipo»", (await page.getByRole("button", { name: "Nuevo equipo" }).count()) === 0);
  await elegirMenu(page, renglon, /^Dar de baja/);
  const dialogo = page.getByRole("dialog", { name: `Dar de baja "${P} E2 para baja"` });
  await dialogo.waitFor();
  await page.locator("#prompt-motivo").fill("no");
  await dialogo.getByRole("button", { name: "Dar de baja", exact: true }).click();
  const corto = await avisoDe(page);
  check("[cob:I:2.4-cliente] baja de equipo con motivo corto: el aviso lo marca y sigue activo", /Motivo debe tener al menos 5 caracteres/.test(corto) && Number(fila("SELECT activo FROM equipos WHERE id = ?", E_BJ)?.activo) === 1, corto);
  await motivoYClave(page, "Equipo sustituido por uno nuevo", "Dar de baja", credenciales[EMAIL.patricia]);
  await toast(page, /Equipo dado de baja/);
  const e = fila("SELECT activo, baja_motivo FROM equipos WHERE id = ?", E_BJ);
  check("[cob:I:I-122] «Dar de baja…» con motivo y contraseña: activo = 0 con su motivo y entrada «baja» en la bitácora", Number(e?.activo) === 0 && e?.baja_motivo === "Equipo sustituido por uno nuevo" && !!fila("SELECT id FROM auditoria WHERE accion = 'baja' AND entidad = 'equipos' AND entidad_id = ?", String(E_BJ)), JSON.stringify(e));
  await filtrar(page, "Mostrar bajas");
  await renglon.waitFor();
  const menuBaja = await menuDe(page, renglon);
  check("[cob:I:I-123] [cob:I:I-120] sin equipos:G no hay «Reactivar…» (ni «Editar»)", !menuBaja.some((x) => /^(Reactivar|Editar)/.test(x)), menuBaja.join(", "));
});

await paso("ricardo", "equipos: ficha dada de baja y reactivar con motivo y contraseña", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/equipos?buscar=${encodeURIComponent(`${P} E2`)}&filtro=bajas`);
  const renglon = page.locator(`[data-equipo="${E_BJ}"]`);
  await renglon.waitFor();
  check("[cob:I:I-117] dado de baja: insignia «Baja» en el renglón", await tieneBaja(renglon), await textoDe(renglon));
  await abrirFicha(renglon);
  const ficha = page.locator(`[data-equipo-ventana="${E_BJ}"]`);
  await ficha.waitFor();
  const tf = await textoDe(ficha);
  check("[cob:I:I-125] ficha dada de baja: insignia «Baja» y «Dado de baja el … · Motivo: …»", /Baja/.test(tf) && /Dado de baja el \d/.test(tf) && tf.includes("Motivo: Equipo sustituido por uno nuevo"), tf.slice(0, 300));
  await page.keyboard.press("Escape");
  await elegirMenu(page, renglon, /^Reactivar/);
  await page.getByRole("dialog", { name: `Reactivar "${P} E2 para baja"` }).waitFor();
  await motivoYClave(page, "Se regresó al laboratorio", "Reactivar", credenciales[EMAIL.ricardo]);
  await toast(page, /Equipo reactivado/);
  check("[cob:I:I-123] con equipos:G «Reactivar…» lo reactiva (bitácora «reactivar»)", Number(fila("SELECT activo FROM equipos WHERE id = ?", E_BJ)?.activo) === 1 && !!fila("SELECT id FROM auditoria WHERE accion = 'reactivar' AND entidad = 'equipos' AND entidad_id = ?", String(E_BJ)));
});

const nombreRicardo = fila("SELECT nombre FROM usuarios WHERE id = ?", id.ricardo)?.nombre;
await paso("qa", "equipos: búsqueda por campo, renglones, estados, URL y ficha", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/equipos`);
  await page.locator("[data-equipo]").first().waitFor();
  const placeholder = "Buscar por nombre, marca o modelo";
  const porCampo = {};
  for (const texto of [`${P} E1`, `MarcaE${S}`, `ModE${S}`, `SerE${S}`, `UbiE${S}`]) {
    const ids = await buscarEnServidor(page, "/api/inventory/equipos", placeholder, texto);
    const vistos = await renglones(page, "data-equipo", [E_BUS]);
    porCampo[texto] = ids.join() === String(E_BUS) && vistos.join() === String(E_BUS);
  }
  check("[cob:I:I-112] el buscador consulta al servidor por nombre, marca, modelo, número de serie y ubicación", Object.values(porCampo).every(Boolean), JSON.stringify(porCampo));
  const tBus = await textoDe(page.locator(`[data-equipo="${E_BUS}"]`));
  check("[cob:I:I-116] renglón: equipo con «Bitácora <clave>», estado, calibración («vence en 20 días»), sin mantenimiento («—») y responsable", tBus.includes(`${P} E1 cromatógrafo`) && tBus.includes(`Bitácora FX-TCB-X${S}`) && /Operativo/.test(tBus) && /vence en 20 días/.test(tBus) && /—/.test(tBus) && tBus.includes(nombreRicardo), tBus);

  await page.goto(`${BASE_WEB}/inventario/equipos?buscar=${encodeURIComponent(`Cob${S}`)}&filtro=bajas`);
  await renglones(page, "data-equipo", [E_A, E_B, E_C, E_D, E_E, E_M, E_N, E_BAJA]);
  const tx = {};
  for (const [clave, eq] of Object.entries({ E_A, E_B, E_C, E_D, E_E, E_M, E_N, E_BAJA })) tx[clave] = await textoDe(page.locator(`[data-equipo="${eq}"]`));
  check("[cob:I:I-116] renglones: «Sin clave de bitácora», próximo mantenimiento «Correctivo · en proceso» y «Preventivo · vencido»", /Sin clave de bitácora/.test(tx.E_D) && /Correctivo · en proceso/.test(tx.E_M) && /Preventivo · vencido/.test(tx.E_N) && /Preventivo/.test(tx.E_B) && !/·\s*(vencido|en proceso)/.test(tx.E_B), `${tx.E_D} | ${tx.E_M} | ${tx.E_N} | ${tx.E_B}`);
  const estadoD = fila("SELECT estado FROM equipos WHERE id = ?", E_D)?.estado;
  check("[cob:I:I-117] [cob:I:3.3-calibración-vencida] operativo con la calibración vencida: se ve «Calibración vencida» y en la base sigue «operativo»", /Calibración vencida/.test(tx.E_D) && estadoD === "operativo", `${tx.E_D} · ${estadoD}`);
  check("[cob:I:I-117] insignias Operativo · En mantenimiento · Calibración pendiente · Fuera de servicio · Baja", /Operativo/.test(tx.E_A) && /En mantenimiento/.test(tx.E_B) && /Calibración pendiente/.test(tx.E_C) && /Fuera de servicio/.test(tx.E_E) && (await tieneBaja(page.locator(`[data-equipo="${E_BAJA}"]`))) && !(await tieneBaja(page.locator(`[data-equipo="${E_A}"]`))), JSON.stringify(tx).slice(0, 500));

  const porUrl = {};
  for (const [filtro, opcion, esperado] of [["operativo", "Operativos", [E_A, E_D]], ["mantenimiento", "En mantenimiento", [E_B, E_M, E_N]], ["calibracion", "Con alerta de calibración", [E_C, E_D, E_E]], ["bajas", "Mostrar bajas", [E_A, E_B, E_C, E_D, E_E, E_M, E_N, E_BAJA]]]) {
    await page.goto(`${BASE_WEB}/inventario/equipos?buscar=${encodeURIComponent(`Cob${S}`)}&filtro=${filtro}`);
    const vistos = await renglones(page, "data-equipo", esperado);
    porUrl[filtro] = mismo(vistos, esperado) && (await page.getByPlaceholder(placeholder).inputValue()) === `Cob${S}` && (await opcionActiva(page, opcion));
  }
  await page.goto(`${BASE_WEB}/inventario/equipos?abrir=${E_BUS}`);
  porUrl.abrir = await page.locator(`[data-equipo-ventana="${E_BUS}"]`).waitFor().then(() => true);
  await page.goto(`${BASE_WEB}/inventario/equipos?nuevo=1`);
  porUrl.nuevo = await page.getByRole("dialog", { name: "Nuevo equipo" }).waitFor().then(() => true);
  check("[cob:I:I-124] ?buscar=, ?filtro=operativo|mantenimiento|calibracion|bajas, ?abrir= y ?nuevo=1", Object.values(porUrl).every(Boolean), JSON.stringify(porUrl));

  await page.goto(`${BASE_WEB}/inventario/equipos?abrir=${E_BUS}`);
  const ficha = page.locator(`[data-equipo-ventana="${E_BUS}"]`);
  await ficha.waitFor();
  await seccionDe(page, ficha, "Historial de mantenimientos").getByText("Todavía no tiene mantenimientos registrados.").waitFor();
  const tf = await textoDe(ficha);
  const faltan = ["Estado", "Calibración", "Mantenimiento Ninguno", `Bitácora FX-TCB-X${S}`, "Historial de mantenimientos", "Incidencias", "Datos del equipo", `MarcaE${S}`, `ModE${S}`, "Número de serie", `SerE${S}`, "Registrado el", "Próxima calibración", "Dónde está y bitácora", `UbiE${S}`, "Clave de bitácora", "Responsable del equipo", nombreRicardo].filter((x) => !tf.includes(x));
  check("[cob:I:I-125] ficha: datos rápidos Estado · Calibración · Mantenimiento · Bitácora, historial, incidencias, Datos del equipo, Calibración, Dónde está y bitácora, Responsable", !faltan.length && !/Pendiente:/.test(tf), `faltan: ${faltan.join(", ")}`);
  await page.goto(`${BASE_WEB}/inventario/equipos?abrir=${E_M}`);
  const fM = page.locator(`[data-equipo-ventana="${E_M}"]`);
  await fM.waitFor();
  const tM = await textoDe(fM);
  check("[cob:I:I-125] con un mantenimiento pendiente: «Pendiente: Correctivo en proceso · …» y Calibración «Sin fecha»", /Pendiente: Correctivo en proceso · /.test(tM) && /Calibración\s*Sin fecha/.test(tM) && /Sin fecha programada/.test(tM), tM.slice(0, 400));
  await page.goto(`${BASE_WEB}/inventario/equipos?abrir=${E_H}`);
  const fH = page.locator(`[data-equipo-ventana="${E_H}"]`);
  await fH.waitFor();
  const historial = seccionDe(page, fH, "Historial de mantenimientos").locator("li");
  await historial.first().waitFor();
  const items = await historial.allInnerTexts();
  check("[cob:I:I-125] historial: los 10 más recientes por fecha («Realizado el … · técnico»), sin el más antiguo", items.length === 10 && items[0].includes("Proveedor H11") && /Realizado el/.test(items[0]) && items.every((x) => !x.includes("Proveedor H01")), items.map((x) => x.replace(/\s+/g, " ")).join(" | ").slice(0, 400));
  await page.goto(`${BASE_WEB}/inventario/equipos?abrir=${E_DG}`);
  const fDG = page.locator(`[data-equipo-ventana="${E_DG}"]`);
  await fDG.waitFor();
  await fDG.getByText("Sin responsable asignado.").waitFor();
  check("[cob:I:I-125] sin responsable ni marca: «Sin responsable asignado.» y «Sin marca, modelo ni número de serie registrados.»", (await fDG.getByText("Sin marca, modelo ni número de serie registrados.").count()) > 0);
});
await paso("hector", "equipos: lista, búsqueda y menú del Auditor", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/equipos`);
  await page.locator("[data-equipo]").first().waitFor();
  const ids = await buscarEnServidor(page, "/api/inventory/equipos", "Buscar por nombre, marca o modelo", `SerE${S}`);
  check("[cob:I:I-110] [cob:I:I-112] con equipos:V la lista carga y busca en el servidor", ids.join() === String(E_BUS));
  const menu = await menuDe(page, page.locator(`[data-equipo="${E_BUS}"]`));
  check("[cob:I:I-111] [cob:I:I-120] [cob:I:I-122] el Auditor no tiene «Nuevo equipo», «Editar» ni «Dar de baja…»", (await page.getByRole("button", { name: "Nuevo equipo" }).count()) === 0 && !menu.some((x) => /^(Editar|Dar de baja)/.test(x)), menu.join(", "));
});
await paso("luis", "equipos: sin alta ni edición para quien solo los usa", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/equipos?buscar=${encodeURIComponent(`${P} E3`)}`);
  const renglon = page.locator(`[data-equipo="${E_ED}"]`);
  await renglon.waitFor();
  const menu = await menuDe(page, renglon);
  check("[cob:I:I-111] [cob:I:I-120] [cob:I:I-122] el Técnico Analista (equipos de uso) no ve «Nuevo equipo», «Editar» ni «Dar de baja…»", (await page.getByRole("button", { name: "Nuevo equipo" }).count()) === 0 && !menu.some((x) => /^(Editar|Dar de baja)/.test(x)), menu.join(", "));
});

await paso("qa", "equipos: hoja (Nuevo equipo, Cancelar, Editar y Guardar cambios)", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/equipos?buscar=${encodeURIComponent(`${P} E3`)}`);
  const renglon = page.locator(`[data-equipo="${E_ED}"]`);
  await renglon.waitFor();
  await page.getByRole("button", { name: "Nuevo equipo" }).first().click();
  const hoja = page.getByRole("dialog", { name: "Nuevo equipo" });
  await hoja.waitFor();
  const botones = await botonesDe(hoja);
  check("[cob:I:I-111] [cob:I:I-130] [cob:I:I-138] «Nuevo equipo» abre la hoja «Identificación, ubicación y estado de calibración.» con «Cancelar» · «Crear equipo»", (await hoja.getByText("Identificación, ubicación y estado de calibración.").count()) > 0 && ["Cancelar", "Crear equipo"].every((x) => botones.includes(x)), botones.join(", "));
  const nombre = `${P} E9 cancelado`;
  await page.locator("#e-nombre").fill(nombre);
  await hoja.getByRole("button", { name: "Cancelar", exact: true }).click();
  await hoja.waitFor({ state: "detached" });
  check("[cob:I:I-138] «Cancelar» cierra sin crear", !fila("SELECT id FROM equipos WHERE nombre = ?", nombre));
  const pedida = respuestaDe(page, `/api/inventory/equipos/${E_ED}`);
  await elegirMenu(page, renglon, /^Editar/);
  const ed = page.getByRole("dialog", { name: "Editar equipo" });
  await ed.waitFor();
  await pedida;
  await esperar(async () => (await page.locator("#e-ubicacion").inputValue()) === "Sala 1");
  check("[cob:I:I-120] [cob:I:I-130] «Editar» pide el equipo y abre «Editar equipo» con sus datos y «Guardar cambios», sin «Autorizar a…»", (await botonesDe(ed)).includes("Guardar cambios") && (await page.locator("#e-autorizar-a").count()) === 0);
  await page.locator("#e-ubicacion").fill("Sala 2");
  await page.locator('button[form="equipo-form"][type="submit"]').click();
  await toast(page, /Equipo actualizado/);
  check("[cob:I:I-120] [cob:I:I-138] «Guardar cambios» guarda la edición (PUT) con entrada «editar» en la bitácora", fila("SELECT ubicacion FROM equipos WHERE id = ?", E_ED)?.ubicacion === "Sala 2" && !!fila("SELECT id FROM auditoria WHERE accion = 'editar' AND entidad = 'equipos' AND entidad_id = ?", String(E_ED)));
});

const idSin = fila("SELECT id FROM usuarios WHERE email = ?", SIN.email)?.id;
await paso("ricardo", "equipos: alta con «Autorizar a…» y responsables de cuentas activas", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/equipos`);
  await page.locator("[data-equipo]").first().waitFor();
  const cuentas = respuestaDe(page, "/api/cuentas/activas");
  const personas = respuestaDe(page, "/api/autorizaciones/personas");
  await page.getByRole("button", { name: "Nuevo equipo" }).first().click();
  const hoja = page.getByRole("dialog", { name: "Nuevo equipo" });
  await hoja.waitFor();
  await cuentas;
  await personas;
  await page.waitForFunction(() => document.querySelectorAll("#e-responsable option").length > 2, null, { timeout: 15_000 });
  const responsables = (await page.locator("#e-responsable option").allTextContents()).map((x) => x.trim());
  check("[cob:I:I-133] Responsable: «Sin responsable» y las cuentas activas (de /cuentas/activas, aunque no tenga usuarios:V)", responsables[0] === "Sin responsable" && responsables.includes(nombreRicardo) && responsables.length > 2, responsables.slice(0, 5).join(" | "));
  const grupo = page.getByRole("group", { name: "Autorizar a" });
  await grupo.waitFor();
  await page.locator(`#e-autorizar-${idSin}`).waitFor();
  check("[cob:I:I-137] con ensayos:A: sección «Autorizar a…» con una casilla por persona; el folio FX-THF-AP aparece al elegir a alguien", (await page.locator("#e-folio-ap").count()) === 0);
  const nombre = `${P} E9 autorizado`;
  await page.locator("#e-nombre").fill(nombre);
  await page.locator("#e-responsable").selectOption(String(id.ricardo));
  await page.locator(`#e-autorizar-${idSin}`).check();
  await page.locator("#e-folio-ap").waitFor();
  check("[cob:I:I-137] Folio FX-THF-AP de 80 caracteres", (await page.locator("#e-folio-ap").getAttribute("maxlength")) === "80");
  await page.locator("#e-folio-ap").fill(`FX-THF-AP-${S}`);
  await page.locator('button[form="equipo-form"][type="submit"]').click();
  await contrasena(page, credenciales[EMAIL.ricardo]);
  await toast(page, /Equipo creado y autorizado a 1 persona/);
  const e = await esperar(() => fila("SELECT id, id_responsable FROM equipos WHERE nombre = ?", nombre));
  const aut = e && fila("SELECT * FROM autorizaciones_personal WHERE usuario_id = ? AND tipo = 'equipo' AND clave = ?", idSin, String(e.id));
  check("[cob:I:I-137] [cob:I:I-138] [cob:I:I-133] «Crear equipo» lo da de alta con su responsable y otorga la autorización FX-THF-AP del equipo (con contraseña)", Number(e?.id_responsable) === id.ricardo && !!aut && aut.folio_fx_thf_ap === `FX-THF-AP-${S}`, JSON.stringify(aut && { u: aut.usuario_id, c: aut.clave, f: aut.folio_fx_thf_ap }));
});
await paso("gabriela", "equipos: alta sin «Autorizar a…» (sin ensayos:A ni calidad:A)", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/equipos?nuevo=1`);
  const hoja = page.getByRole("dialog", { name: "Nuevo equipo" });
  await hoja.waitFor();
  await page.waitForFunction(() => document.querySelectorAll("#e-responsable option").length > 2, null, { timeout: 15_000 });
  check("[cob:I:I-137] [cob:I:I-133] sin ensayos:A ni calidad:A no aparece «Autorizar a…»; el responsable sí ofrece las cuentas activas", (await page.locator("#e-autorizar-a").count()) === 0 && (await hoja.getByText("Autorizar a…").count()) === 0);
  await page.keyboard.press("Escape");
});

// Equipo suspendido por una NC para el formulario.
const E_S = await equipoDe("S suspendido");
const ncS = await api("POST", "/calidad/nc", { origen: "otro", descripcion: `Equipo de cobertura UI con falla ${S}`, clasificacion: "menor", responsable_id: id.ricardo }, t.ana);
await api("POST", `/calidad/nc/${ncS.data?.id}/suspensiones`, { tipo: "equipo", clave: String(E_S), motivo: "Falla del equipo en pantalla" }, t.ana);
const suspS = fila("SELECT id FROM suspensiones WHERE nc_id = ? AND reanudada_en IS NULL", ncS.data?.id)?.id;
const serieExistente = `SERIE-${S}`;
await api("PUT", `/inventory/equipos/${E_A}`, { nombre: `Cob${S} A balanza`, estado: "operativo", numero_serie: serieExistente, fecha_prox_calibracion: enDias(100) }, t.qa);

const nombreEquipo = `Cob${S} N equipo nuevo`;
await paso("qa", "equipos: hoja de alta y edición (nombre, serie, calibración, estado, bitácora, suspendido)", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/equipos?nuevo=1`);
  const hoja = page.getByRole("dialog", { name: "Nuevo equipo" });
  await hoja.waitFor();
  const largos = {};
  for (const campo of ["e-nombre", "e-marca", "e-modelo", "e-serie", "e-ubicacion", "e-bitacora"]) largos[campo] = await page.locator(`#${campo}`).getAttribute("maxlength");
  check("[cob:I:I-131] [cob:I:I-132] [cob:I:I-136] límites: Nombre 150, Marca 100, Modelo 100, Serie 100, Ubicación 150, Clave de bitácora 60", JSON.stringify(largos) === JSON.stringify({ "e-nombre": "150", "e-marca": "100", "e-modelo": "100", "e-serie": "100", "e-ubicacion": "150", "e-bitacora": "60" }), JSON.stringify(largos));
  const estados = await page.locator("#e-estado option").evaluateAll((os) => os.map((o) => `${o.textContent.trim()}${o.disabled ? "[x]" : ""}`));
  check("[cob:I:I-135] Estado: Operativo, En mantenimiento (lo define Mantenimiento, deshabilitado), Calibración pendiente, Fuera de servicio", estados.join("|") === "Operativo|En mantenimiento (lo define Mantenimiento)[x]|Calibración pendiente|Fuera de servicio", estados.join("|"));
  await page.locator('button[form="equipo-form"][type="submit"]').click();
  const popup = page.locator('[data-validacion="faltan"]');
  await popup.waitFor();
  check("[cob:I:I-131] [cob:I:2.5-cliente] sin nombre: el aviso pide el nombre del equipo", /nombre del equipo/i.test(await popup.innerText()), await popup.innerText());
  await page.getByRole("button", { name: "Entendido" }).last().click();
  await page.locator("#e-nombre").fill(nombreEquipo);
  await page.locator("#e-marca").fill("Agilent");
  await page.locator("#e-modelo").fill("1290");
  await page.locator("#e-serie").fill(serieExistente);
  await page.locator("#e-ubicacion").fill("Sala de cromatografía");
  await page.locator("#e-calibracion").fill("2027-08-20");
  await page.locator("#e-estado").selectOption("calibracion_pendiente");
  await page.locator("#e-bitacora").fill(`FX-TCB-${S}`);
  await page.locator('button[form="equipo-form"][type="submit"]').click();
  const servidor = page.locator('[data-validacion="servidor"]');
  await servidor.waitFor();
  check("[cob:I:I-132] número de serie repetido → «Ya existe un equipo con ese número de serie» y no se crea", /Ya existe un equipo con ese número de serie/.test(await servidor.innerText()) && !fila("SELECT id FROM equipos WHERE nombre = ?", nombreEquipo), await servidor.innerText());
  await page.getByRole("button", { name: "Entendido" }).last().click();
  await page.locator("#e-serie").fill(`SERIE-NUEVA-${S}`);
  await page.locator('button[form="equipo-form"][type="submit"]').click();
  await toast(page, /Equipo creado/);
  const e = await esperar(() => fila("SELECT * FROM equipos WHERE nombre = ?", nombreEquipo));
  check("[cob:I:I-132] [cob:I:I-134] [cob:I:I-135] [cob:I:I-136] se guarda con marca, modelo, serie, ubicación, calibración (AAAA-MM-DD), estado y clave de bitácora", e?.marca === "Agilent" && e?.modelo === "1290" && e?.numero_serie === `SERIE-NUEVA-${S}` && e?.ubicacion === "Sala de cromatografía" && e?.fecha_prox_calibracion === "2027-08-20" && e?.estado === "calibracion_pendiente" && e?.clave_bitacora === `FX-TCB-${S}`, JSON.stringify(e && { c: e.fecha_prox_calibracion, s: e.estado, b: e.clave_bitacora }));
  await page.goto(`${BASE_WEB}/inventario/equipos?buscar=${encodeURIComponent(nombreEquipo)}`);
  const renglon = page.locator(`[data-equipo="${e.id}"]`);
  await renglon.waitFor();
  check("[cob:I:I-136] el renglón muestra «Bitácora <clave>»", (await textoDe(renglon)).includes(`Bitácora FX-TCB-${S}`), await textoDe(renglon));

  // Suspendido por NC: el formulario no lo pone operativo.
  await page.goto(`${BASE_WEB}/inventario/equipos?buscar=${encodeURIComponent(`Cob${S} S suspendido`)}`);
  const rs = page.locator(`[data-equipo="${E_S}"]`);
  await rs.waitFor();
  await elegirMenu(page, rs, /^Editar/);
  await page.getByRole("dialog", { name: "Editar equipo" }).waitFor();
  await page.locator("#e-nombre").waitFor();
  await page.locator("#e-estado").selectOption("operativo");
  await page.locator('button[form="equipo-form"][type="submit"]').click();
  await servidor.waitFor();
  check("[cob:I:I-135] equipo suspendido por NC: ponerlo «Operativo» → aviso «suspendido por NC …» y sigue fuera de servicio", /suspendido por NC \d{7}/.test(await servidor.innerText()) && fila("SELECT estado FROM equipos WHERE id = ?", E_S)?.estado === "fuera_servicio", await servidor.innerText());
});
if (suspS) await api("POST", `/calidad/suspensiones/${suspS}/reanudar`, { motivo: "Prueba de cobertura terminada" }, t.patricia);

/* ---------- Mantenimiento ---------- */
await paso("qa", "mantenimiento: búsqueda, filtros, orden, renglones, vacío y contador", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/mantenimiento?buscar=${encodeURIComponent(`Cob${S}`)}`);
  const pendientes = [M_EB, M_A, M_B, M_C, M_E];
  const porFecha = await renglones(page, "data-mantenimiento", [M_B, M_E, M_EB, M_A, M_C], { enOrden: true });
  check("[cob:I:I-143] [cob:I:I-145] por omisión «Pendientes» (sin completados ni cancelados) ordenados por fecha programada", mismo(porFecha, [M_B, M_E, M_EB, M_A, M_C], true), porFecha.join());
  const contador = await page.getByText(/^\d+ registros?$/).first().innerText();
  check("[cob:I:I-150] contador «5 registros»", contador.trim() === "5 registros", contador);
  const tB = await textoDe(page.locator(`[data-mantenimiento="${M_B}"]`));
  const rojo = await page.locator(`[data-mantenimiento="${M_B}"]`).getByText(/2001/).getAttribute("class");
  check("[cob:I:I-146] renglón en proceso con fecha pasada: equipo, «Correctivo», fecha en rojo con «ya pasó la fecha» y estado «En proceso»", tB.includes(`Cob${S} M equipo de mantenimiento`) && /Correctivo/.test(tB) && /ya pasó la fecha/.test(tB) && /En proceso/.test(tB) && /text-danger/.test(rojo || ""), `${tB} | ${rojo}`);
  const tA = await textoDe(page.locator(`[data-mantenimiento="${M_A}"]`));
  check("[cob:I:I-146] renglón con técnico: «Proveedor Alfa …», «Preventivo», «Programado»", tA.includes(`Proveedor Alfa ${S}`) && /Preventivo/.test(tA) && /Programado/.test(tA) && !/ya pasó/.test(tA), tA);
  await filtrar(page, "Próximos 30 días");
  const prox = await renglones(page, "data-mantenimiento", [M_EB, M_A]);
  check("[cob:I:I-143] «Próximos 30 días»: los de 5 y 10 días (no el de 60 ni los vencidos)", mismo(prox, [M_EB, M_A]), prox.join());
  await filtrar(page, "Vencidos");
  const venc = await renglones(page, "data-mantenimiento", [M_B, M_E]);
  check("[cob:I:I-143] «Vencidos»: el vencido y el en proceso con fecha pasada", mismo(venc, [M_B, M_E]), venc.join());
  await filtrar(page, "Completados");
  const comp = await renglones(page, "data-mantenimiento", [M_D]);
  const tD = await textoDe(page.locator(`[data-mantenimiento="${M_D}"]`));
  check("[cob:I:I-143] [cob:I:I-146] «Completados»: el completado, con «realizado el …»", mismo(comp, [M_D]) && /realizado el/.test(tD), `${comp.join()} ${tD}`);
  await filtrar(page, "Todos");
  const todos = await renglones(page, "data-mantenimiento", [...pendientes, M_D, M_F]);
  check("[cob:I:I-143] «Todos»: también completados y cancelados", mismo(todos, [...pendientes, M_D, M_F]), todos.join());
  await filtrar(page, "Equipo A–Z");
  let porEquipo = [];
  await esperar(async () => {
    porEquipo = await idsDe(page, "data-mantenimiento");
    return porEquipo.length === 7 && porEquipo[0] === M_EB && porEquipo.slice(1, 5).every((x) => [M_A, M_B, M_C, M_D].includes(x));
  });
  check("[cob:I:I-145] «Equipo A–Z»: el del equipo «B…», luego los del «M…» y al final los del «N…»", porEquipo[0] === M_EB && porEquipo.slice(1, 5).every((x) => [M_A, M_B, M_C, M_D].includes(x)) && porEquipo.slice(5).every((x) => [M_E, M_F].includes(x)), porEquipo.join());
  await buscarEn(page, "Buscar por equipo o proveedor", `Proveedor Alfa ${S}`);
  const porProveedor = await renglones(page, "data-mantenimiento", [M_A]);
  check("[cob:I:I-142] «Buscar por equipo o proveedor»: por el técnico o proveedor", mismo(porProveedor, [M_A]), porProveedor.join());
  await buscarEn(page, "Buscar por equipo o proveedor", `zz-sin-coincidencias-${S}`);
  await page.getByText("Sin coincidencias").waitFor();
  check("[cob:I:I-150] búsqueda sin resultados: «Sin coincidencias» y sin contador", (await page.getByText(/^\d+ registros?$/).count()) === 0);
});

await paso("qa", "mantenimiento: ficha, botones, edición y cancelación", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/mantenimiento?buscar=${encodeURIComponent(`Cob${S}`)}`);
  await page.locator(`[data-mantenimiento="${M_B}"]`).waitFor();
  await filtrar(page, "Todos");
  await page.locator(`[data-mantenimiento="${M_F}"]`).waitFor();
  await abrirFicha(page.locator(`[data-mantenimiento="${M_B}"]`));
  const ficha = page.locator(`[data-mantenimiento-ventana="${M_B}"]`);
  await ficha.waitFor();
  const tB = await textoDe(ficha);
  check("[cob:I:I-152] ficha: «En proceso» con «Fecha pasada», datos rápidos Programado/Realizado «Aún no»/Técnico/Responsable, Observaciones, Equipo, Fechas y Quién lo atiende", /En proceso/.test(tB) && /Fecha pasada/.test(tB) && /Programado/.test(tB) && /Realizado\s*Aún no/.test(tB) && /Técnico/.test(tB) && /Responsable/.test(tB) && /Sin observaciones\./.test(tB) && /Fechas/.test(tB) && /Quién lo atiende/.test(tB) && tB.includes("Ricardo"), tB.slice(0, 400));
  const enlace = ficha.getByRole("link", { name: "Ver el equipo" });
  check("[cob:I:I-152] «Ver el equipo» enlaza a Equipos con la búsqueda del equipo", decodeURIComponent((await enlace.getAttribute("href")) || "").replace(/\+/g, " ") === `/inventario/equipos?buscar=Cob${S} M equipo de mantenimiento`, await enlace.getAttribute("href"));
  const b = await botonesDe(page.getByRole("dialog"));
  check("[cob:I:I-153] en proceso: «Editar» y «Cancelar mantenimiento»", b.includes("Editar") && b.includes("Cancelar mantenimiento"), b.join(", "));
  await page.keyboard.press("Escape");
  await abrirFicha(page.locator(`[data-mantenimiento="${M_D}"]`));
  await page.locator(`[data-mantenimiento-ventana="${M_D}"]`).waitFor();
  const bD = await botonesDe(page.getByRole("dialog"));
  check("[cob:I:I-153] completado: solo «Editar» (no se cancela)", bD.includes("Editar") && !bD.includes("Cancelar mantenimiento"), bD.join(", "));
  await page.keyboard.press("Escape");
  await abrirFicha(page.locator(`[data-mantenimiento="${M_F}"]`));
  await page.locator(`[data-mantenimiento-ventana="${M_F}"]`).waitFor();
  const bF = await botonesDe(page.getByRole("dialog"));
  check("[cob:I:I-153] cancelado: ni «Editar» ni «Cancelar mantenimiento»", !bF.includes("Editar") && !bF.includes("Cancelar mantenimiento"), bF.join(", "));
  await page.keyboard.press("Escape");

  // Editar desde el menú ⋯ carga el mantenimiento.
  await elegirMenu(page, page.locator(`[data-mantenimiento="${M_A}"]`), /^Editar/);
  await page.getByRole("dialog", { name: "Editar mantenimiento" }).waitFor();
  await page.waitForFunction((v) => document.querySelector("#m-tecnico")?.value === v, `Proveedor Alfa ${S}`, { timeout: 15_000 });
  check("[cob:I:I-147] «Editar» del menú abre «Editar mantenimiento» con sus datos (técnico, observaciones)", (await page.locator("#m-obs").inputValue()) === "Revisión semestral");
  await page.keyboard.press("Escape");

  // Cancelar desde la ficha con motivo y contraseña.
  await abrirFicha(page.locator(`[data-mantenimiento="${M_C}"]`));
  await page.locator(`[data-mantenimiento-ventana="${M_C}"]`).waitFor();
  await page.getByRole("dialog").filter({ has: page.locator(`[data-mantenimiento-ventana="${M_C}"]`) }).getByRole("button", { name: "Cancelar mantenimiento" }).click();
  await motivoYClave(page, "El proveedor no tiene fecha disponible", "Cancelar mantenimiento", QA.password);
  await toast(page, /Mantenimiento cancelado/);
  check("[cob:I:I-153] «Cancelar mantenimiento» con motivo y contraseña lo deja cancelado", (await esperar(() => fila("SELECT estado FROM mantenimientos WHERE id = ?", M_C)?.estado === "cancelado")) === true);
});

await paso("hector", "mantenimiento: Auditor (sin acciones)", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/mantenimiento?buscar=${encodeURIComponent(`Cob${S}`)}`);
  await page.locator(`[data-mantenimiento="${M_A}"]`).waitFor();
  check("[cob:I:I-147] sin equipos:E el renglón no tiene menú ⋯", (await page.locator(`[data-mantenimiento="${M_A}"]`).getByRole("button", { name: "Acciones" }).count()) === 0);
  await abrirFicha(page.locator(`[data-mantenimiento="${M_A}"]`));
  await page.locator(`[data-mantenimiento-ventana="${M_A}"]`).waitFor();
  const b = await botonesDe(page.getByRole("dialog"));
  check("[cob:I:I-153] el Auditor no ve «Editar» ni «Cancelar mantenimiento» en la ficha", !b.includes("Editar") && !b.includes("Cancelar mantenimiento"), b.join(", "));
  await page.keyboard.press("Escape");
  check("[cob:I:I-141] sin equipos:C de mantenimiento no hay «Programar mantenimiento»", (await page.getByRole("button", { name: "Programar mantenimiento" }).count()) === 0);
});

/* ---------- Mantenimiento: vence al listar, Tipo en el servidor, URL, hoja y cancelación ---------- */
await paso("qa", "mantenimiento: «Pendientes» por omisión, vencido al listar y Tipo en el servidor", async (page) => {
  const pedida = respuestaDe(page, "/api/inventory/mantenimientos", "search", `${P} E6`);
  await page.goto(`${BASE_WEB}/inventario/mantenimiento?buscar=${encodeURIComponent(`${P} E6`)}`);
  await pedida;
  await renglones(page, "data-mantenimiento", [M_V]);
  const tV = await textoDe(page.locator(`[data-mantenimiento="${M_V}"]`));
  check("[cob:I:I-140] por omisión «Pendientes»; al listar, el programado con fecha pasada queda «Vencido» (también en la base)", (await opcionActiva(page, "Pendientes")) && /Vencido/.test(tV) && fila("SELECT estado FROM mantenimientos WHERE id = ?", M_V)?.estado === "vencido", tV);

  await page.goto(`${BASE_WEB}/inventario/mantenimiento?buscar=${encodeURIComponent(`${P} E5`)}`);
  await renglones(page, "data-mantenimiento", [M_TP, M_TC, M_TK]);
  const porTipo = {};
  for (const [nombre, tipo, esperado] of [["Correctivo", "correctivo", [M_TC]], ["Calibración", "calibracion", [M_TK]], ["Preventivo", "preventivo", [M_TP]]]) {
    const respuesta = respuestaDe(page, "/api/inventory/mantenimientos", "tipo", tipo);
    await filtrar(page, nombre);
    await respuesta;
    porTipo[nombre] = mismo(await renglones(page, "data-mantenimiento", esperado), esperado);
  }
  // Quitar el tipo elegido vuelve a «Cualquiera».
  await filtrar(page, "Preventivo");
  porTipo.Cualquiera = mismo(await renglones(page, "data-mantenimiento", [M_TP, M_TC, M_TK]), [M_TP, M_TC, M_TK]);
  check("[cob:I:I-144] Tipo › Preventivo · Correctivo · Calibración pide ?tipo= al servidor y filtra; «Cualquiera» los vuelve a mostrar", Object.values(porTipo).every(Boolean), JSON.stringify(porTipo));

  const porUrl = {};
  for (const [filtro, opcion, esperado] of [["completado", "Completados", [M_D]], ["vencido", "Vencidos", [M_B, M_E]], ["proximo", "Próximos 30 días", [M_EB, M_A]], ["pendiente", "Pendientes", [M_EB, M_A, M_B, M_E]]]) {
    await page.goto(`${BASE_WEB}/inventario/mantenimiento?buscar=${encodeURIComponent(`Cob${S}`)}&filtro=${filtro}`);
    const vistos = await renglones(page, "data-mantenimiento", esperado);
    porUrl[filtro] = mismo(vistos, esperado) && (await page.getByPlaceholder("Buscar por equipo o proveedor").inputValue()) === `Cob${S}` && (await opcionActiva(page, opcion));
  }
  await page.goto(`${BASE_WEB}/inventario/mantenimiento?abrir=${M_A}`);
  porUrl.abrir = await page.locator(`[data-mantenimiento-ventana="${M_A}"]`).waitFor().then(() => true);
  await page.keyboard.press("Escape");
  await page.goto(`${BASE_WEB}/inventario/mantenimiento?nuevo=1&equipo=${E_T}`);
  await page.getByRole("dialog", { name: "Programar mantenimiento" }).waitFor();
  porUrl.nuevo = await page.waitForFunction((v) => document.querySelector("#m-equipo")?.value === v, String(E_T), { timeout: 15_000 }).then(() => true, () => false);
  check("[cob:I:I-151] ?buscar=, ?filtro=pendiente|proximo|vencido|completado, ?abrir= y ?nuevo=1&equipo=", Object.values(porUrl).every(Boolean), JSON.stringify(porUrl));
});

await paso("qa", "mantenimiento: hoja (equipo, estados, validación, Cancelar, Programar y Guardar cambios)", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/mantenimiento?buscar=${encodeURIComponent(`${P} E7`)}`);
  await renglones(page, "data-mantenimiento", [M_CN]);
  await page.getByRole("button", { name: "Programar mantenimiento" }).first().click();
  const hoja = page.getByRole("dialog", { name: "Programar mantenimiento" });
  await hoja.waitFor();
  const botones = await botonesDe(hoja);
  check("[cob:I:I-141] [cob:I:I-160] [cob:I:I-169] «Programar mantenimiento» abre la hoja «Fechas programadas de mantenimiento y calibración.» con «Cancelar» · «Programar»", (await hoja.getByText("Fechas programadas de mantenimiento y calibración.").count()) > 0 && botones.includes("Cancelar") && botones.includes("Programar"), botones.join(", "));
  await page.waitForFunction((v) => [...document.querySelectorAll("#m-equipo option")].some((o) => o.value === v), String(E_CN), { timeout: 15_000 });
  const equipos = await page.locator("#m-equipo option").evaluateAll((os) => os.map((o) => o.value));
  check("[cob:I:I-161] Equipo: «Seleccionar equipo» y solo equipos activos (no el dado de baja)", (await page.locator("#m-equipo option").first().innerText()).trim() === "Seleccionar equipo" && equipos.includes(String(E_CN)) && equipos.includes(String(E_T)) && !equipos.includes(String(E_BAJA)), `${equipos.length} opciones`);
  const estados = (await page.locator("#m-estado option").allTextContents()).map((x) => x.trim());
  check("[cob:I:I-163] Estado de uno nuevo: Programado · En proceso · Completado (sin Vencido ni Cancelado)", estados.join("|") === "Programado|En proceso|Completado", estados.join("|"));
  const cuantos = () => filas("SELECT id FROM mantenimientos WHERE id_equipo = ?", E_CN).length;
  const antes = cuantos();
  await page.locator('button[form="mantenimiento-form"][type="submit"]').click();
  const vacio = await avisoDe(page);
  await page.locator("#m-equipo").selectOption(String(E_CN));
  await page.locator("#m-fecha").fill(enDias(25));
  await page.locator("#m-estado").selectOption("completado");
  await page.locator('button[form="mantenimiento-form"][type="submit"]').click();
  const sinRealizado = await avisoDe(page);
  check("[cob:I:I-161] [cob:I:I-163] [cob:I:2.6-cliente] sin equipo ni fecha: «Elige el equipo» e «Indica la fecha programada»; completado sin fecha realizado: la pide; nada se guarda", /Elige el equipo/.test(vacio) && /Indica la fecha programada/.test(vacio) && /Indica la fecha en que se realizó para marcarlo como completado/.test(sinRealizado) && cuantos() === antes, `${vacio} | ${sinRealizado}`);
  await hoja.getByRole("button", { name: "Cancelar", exact: true }).click();
  await hoja.waitFor({ state: "detached" });
  check("[cob:I:I-169] «Cancelar» cierra sin programar", cuantos() === antes);
  await page.getByRole("button", { name: "Programar mantenimiento" }).first().click();
  await hoja.waitFor();
  await page.waitForFunction((v) => [...document.querySelectorAll("#m-equipo option")].some((o) => o.value === v), String(E_CN), { timeout: 15_000 });
  await page.locator("#m-equipo").selectOption(String(E_CN));
  await page.locator("#m-fecha").fill(enDias(25));
  await page.locator("#m-tecnico").fill(`Proveedor ${P}`);
  await page.locator('button[form="mantenimiento-form"][type="submit"]').click();
  await toast(page, /Mantenimiento programado/);
  const nuevo = await esperar(() => fila("SELECT * FROM mantenimientos WHERE id_equipo = ? AND tecnico_proveedor = ?", E_CN, `Proveedor ${P}`));
  check("[cob:I:I-169] «Programar» lo da de alta (POST) programado con su fecha", nuevo?.estado === "programado" && nuevo?.fecha_programada === enDias(25), JSON.stringify(nuevo && { s: nuevo.estado, f: nuevo.fecha_programada }));

  await page.goto(`${BASE_WEB}/inventario/mantenimiento?buscar=${encodeURIComponent(`${P} E6`)}`);
  await renglones(page, "data-mantenimiento", [M_V]);
  await elegirMenu(page, page.locator(`[data-mantenimiento="${M_V}"]`), /^Editar/);
  const ed = page.getByRole("dialog", { name: "Editar mantenimiento" });
  await ed.waitFor();
  await page.waitForFunction(() => document.querySelector("#m-estado")?.value === "vencido", null, { timeout: 15_000 });
  const estadosV = (await page.locator("#m-estado option").allTextContents()).map((x) => x.trim());
  check("[cob:I:I-163] [cob:I:I-160] al editar uno vencido se ofrece además «Vencido» (su estado actual) y el botón «Guardar cambios»", estadosV.join("|") === "Programado|En proceso|Vencido|Completado" || estadosV.join("|") === "Programado|En proceso|Completado|Vencido", `${estadosV.join("|")} · ${(await botonesDe(ed)).join(", ")}`);
  await page.locator("#m-estado").selectOption("en_proceso");
  await page.locator("#m-tecnico").fill(`Técnico ${P}`);
  await page.locator('button[form="mantenimiento-form"][type="submit"]').click();
  await toast(page, /Mantenimiento actualizado/);
  const mv = await esperar(() => fila("SELECT estado, tecnico_proveedor FROM mantenimientos WHERE id = ? AND tecnico_proveedor = ?", M_V, `Técnico ${P}`));
  check("[cob:I:I-169] «Guardar cambios» guarda la edición (PUT): en proceso con su técnico", mv?.estado === "en_proceso", JSON.stringify(mv));

  await page.goto(`${BASE_WEB}/inventario/mantenimiento?buscar=${encodeURIComponent(`Cob${S}`)}&filtro=completado`);
  await renglones(page, "data-mantenimiento", [M_D]);
  const menuD = await menuDe(page, page.locator(`[data-mantenimiento="${M_D}"]`));
  await elegirMenu(page, page.locator(`[data-mantenimiento="${M_D}"]`), /^Editar/);
  await page.getByRole("dialog", { name: "Editar mantenimiento" }).waitFor();
  await page.waitForFunction(() => document.querySelector("#m-estado")?.value === "completado", null, { timeout: 15_000 });
  const estadosD = (await page.locator("#m-estado option").allTextContents()).map((x) => x.trim());
  check("[cob:I:I-163] [cob:I:I-148] uno completado: el estado solo ofrece «Completado» (no se reabre) y el menú no trae «Cancelar mantenimiento…»", estadosD.join("|") === "Completado" && menuD.includes("Editar") && !menuD.some((x) => /^Cancelar mantenimiento/.test(x)), `${estadosD.join("|")} · ${menuD.join(", ")}`);
  await page.keyboard.press("Escape");
  await page.goto(`${BASE_WEB}/inventario/mantenimiento?buscar=${encodeURIComponent(`Cob${S}`)}&filtro=`);
  await filtrar(page, "Todos");
  await page.locator(`[data-mantenimiento="${M_F}"]`).waitFor();
  check("[cob:I:I-148] uno cancelado no tiene acciones: el ⋯ no aparece", (await page.locator(`[data-mantenimiento="${M_F}"]`).getByRole("button", { name: "Acciones" }).count()) === 0);
});

await paso("patricia", "mantenimiento: cancelar con motivo y contraseña (equipos:AN)", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/mantenimiento?buscar=${encodeURIComponent(`${P} E7`)}`);
  const renglon = page.locator(`[data-mantenimiento="${M_CN}"]`);
  await renglon.waitFor();
  const menu = await menuDe(page, renglon);
  check("[cob:I:I-148] con equipos:AN (sin E de mantenimiento): solo «Cancelar mantenimiento…»", menu.some((x) => /^Cancelar mantenimiento/.test(x)) && !menu.includes("Editar"), menu.join(", "));
  check("[cob:I:I-141] sin equipos:C de mantenimiento no hay «Programar mantenimiento»", (await page.getByRole("button", { name: "Programar mantenimiento" }).count()) === 0);
  await elegirMenu(page, renglon, /^Cancelar mantenimiento/);
  const dialogo = page.getByRole("dialog", { name: "Cancelar mantenimiento" });
  await dialogo.waitFor();
  const botones = await botonesDe(dialogo);
  check("[cob:I:I-149] diálogo «Cancelar mantenimiento»: aviso de que queda en el historial, Motivo, Contraseña y botón «Cancelar mantenimiento»", (await dialogo.getByText("El registro queda como cancelado con el motivo").count()) > 0 && (await page.locator("#prompt-password").count()) === 1 && botones.includes("Cancelar mantenimiento"), botones.join(", "));
  await page.locator("#prompt-motivo").fill("ya");
  await dialogo.getByRole("button", { name: "Cancelar mantenimiento", exact: true }).click();
  const corto = await avisoDe(page);
  check("[cob:I:I-149] motivo de menos de 5 caracteres: el aviso lo marca y sigue programado", /Motivo debe tener al menos 5 caracteres/.test(corto) && fila("SELECT estado FROM mantenimientos WHERE id = ?", M_CN)?.estado === "programado", corto);
  await motivoYClave(page, "El equipo se envió a garantía", "Cancelar mantenimiento", credenciales[EMAIL.patricia]);
  await toast(page, /Mantenimiento cancelado/);
  check("[cob:I:I-148] [cob:I:I-149] con motivo y contraseña queda cancelado (entrada «anular» con el motivo en la bitácora)", fila("SELECT estado FROM mantenimientos WHERE id = ?", M_CN)?.estado === "cancelado" && !!fila("SELECT id FROM auditoria WHERE accion = 'anular' AND entidad = 'mantenimientos' AND entidad_id = ? AND motivo = ?", String(M_CN), "El equipo se envió a garantía"));
});
await paso("carmen", "mantenimiento: editar sí, cancelar no (Auxiliar Administrativo)", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/mantenimiento?buscar=${encodeURIComponent(`${P} E5`)}`);
  const renglon = page.locator(`[data-mantenimiento="${M_TP}"]`);
  await renglon.waitFor();
  const menu = await menuDe(page, renglon);
  check("[cob:I:I-148] [cob:I:I-141] sin equipos:AN no hay «Cancelar mantenimiento…» (sí «Editar» y «Programar mantenimiento»)", menu.includes("Editar") && !menu.some((x) => /^Cancelar mantenimiento/.test(x)) && (await page.getByRole("button", { name: "Programar mantenimiento" }).count()) > 0, menu.join(", "));
});
await paso("diego", "mantenimiento: bajo supervisión no se marca como completado", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/mantenimiento?nuevo=1&equipo=${E_DG}`);
  const hoja = page.getByRole("dialog", { name: "Programar mantenimiento" });
  await hoja.waitFor();
  await page.waitForFunction((v) => document.querySelector("#m-equipo")?.value === v, String(E_DG), { timeout: 15_000 });
  await page.locator("#m-fecha").fill(enDias(-1));
  await page.locator("#m-estado").selectOption("completado");
  await page.locator("#m-realizado").fill(hoy());
  await page.locator('button[form="mantenimiento-form"][type="submit"]').click();
  const servidor = await avisoDe(page, "servidor");
  check("[cob:I:I-163] bajo supervisión (Estudiante) «Completado» → «…no se marca como completado: queda pendiente del visto bueno de tu supervisor» y no se guarda", /no se marca como completado/.test(servidor) && filas("SELECT id FROM mantenimientos WHERE id_equipo = ?", E_DG).length === 0, servidor);
  await page.keyboard.press("Escape");
});

await paso("carmen", "mantenimiento: reporte PDF (formato y renglón)", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/mantenimiento?buscar=${encodeURIComponent(`Cob${S}`)}`);
  await page.locator(`[data-mantenimiento="${M_A}"]`).waitFor();
  await abrirFicha(page.locator(`[data-mantenimiento="${M_A}"]`));
  await page.locator(`[data-mantenimiento-ventana="${M_A}"]`).waitFor();
  const entrada = page.locator(`[data-reporte-mantenimiento="${M_A}"] [data-reporte-archivo]`);
  await entrada.waitFor({ state: "attached" });
  check("[cob:I:I-157] el campo oculto «Archivo PDF del reporte» acepta solo PDF", (await entrada.getAttribute("aria-label")) === "Archivo PDF del reporte" && /\.pdf/.test((await entrada.getAttribute("accept")) || ""));
  await entrada.setInputFiles({ name: "reporte.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("PK\u0003\u0004 docx") });
  await toast(page, /El reporte debe ser un archivo PDF/);
  check("[cob:I:I-157] un archivo que no es .pdf: «El reporte debe ser un archivo PDF» y no se sube", filas("SELECT id FROM reportes_mantenimiento WHERE id_mantenimiento = ?", M_A).length === 0);
  await entrada.setInputFiles({ name: "disfrazado.pdf", mimeType: "application/pdf", buffer: Buffer.from("Esto es texto con extensión pdf") });
  await toast(page, /no corresponde|no es un PDF|no es válido|contenido/i);
  check("[cob:I:I-157] un .pdf que no es PDF lo rechaza el servidor (firma %PDF-) y no se sube", filas("SELECT id FROM reportes_mantenimiento WHERE id_mantenimiento = ?", M_A).length === 0);
  await entrada.setInputFiles({ name: `reporte servicio ${S}.pdf`, mimeType: "application/pdf", buffer: await pdfConTexto(1, "Reporte de servicio") });
  await toast(page, /Reporte PDF adjuntado/);
  const rep = await esperar(() => fila("SELECT * FROM reportes_mantenimiento WHERE id_mantenimiento = ? AND anulado_en IS NULL", M_A));
  const renglon = page.locator(`[data-reporte-item="${rep?.id}"]`);
  await renglon.waitFor();
  const tR = await textoDe(renglon);
  check("[cob:I:I-158] renglón del reporte: código RM-xxxxx-01, nombre, tamaño, fecha y «SHA-256 …»", tR.includes(`RM-${String(M_A).padStart(5, "0")}-01`) && tR.includes(`reporte servicio ${S}.pdf`) && /\d+(\.\d+)?\s?(KB|kB|B|MB)/.test(tR) && tR.includes(`SHA-256 ${String(rep.sha256).slice(0, 4)}`), tR);
});

/* ---------- Reporte de servicio (PDF): vacío, adjuntar, abrir, reemplazar, quitar y lista ---------- */
const codigoRM = (m, v) => `RM-${String(m).padStart(5, "0")}-${String(v).padStart(2, "0")}`;
await paso("carmen", "reporte PDF: adjuntar, reemplazar y quitar (equipos:C/E de mantenimiento)", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/mantenimiento?abrir=${M_TK}`);
  const ficha = page.locator(`[data-mantenimiento-ventana="${M_TK}"]`);
  await ficha.waitFor();
  const zona = ficha.locator(`[data-reporte-mantenimiento="${M_TK}"]`);
  await zona.locator("[data-reporte-vacio]").waitFor();
  check("[cob:I:I-154] [cob:I:I-155] la ficha trae «Reporte de servicio (PDF)»; vacío y con permiso: «Aún no hay reporte. Usa «Adjuntar reporte PDF»…»", (await ficha.getByText("Reporte de servicio (PDF)", { exact: true }).count()) > 0 && /^Aún no hay reporte\. Usa «Adjuntar reporte PDF»/.test(await textoDe(zona.locator("[data-reporte-vacio]"))));
  const elegir = page.waitForEvent("filechooser");
  await zona.locator("[data-adjuntar-reporte]").click();
  await (await elegir).setFiles({ name: `servicio ${P}.pdf`, mimeType: "application/pdf", buffer: await pdfConTexto(1, "Reporte de calibración") });
  await toast(page, /Reporte PDF adjuntado/);
  const primero = await esperar(() => fila("SELECT * FROM reportes_mantenimiento WHERE id_mantenimiento = ? AND anulado_en IS NULL", M_TK));
  await zona.locator(`[data-reporte-item="${primero?.id}"]`).waitFor();
  check("[cob:I:I-156] «Adjuntar reporte PDF» sube el archivo (código RM-…-01 con su SHA-256)", primero?.codigo === codigoRM(M_TK, 1) && /^[0-9a-f]{64}$/.test(String(primero?.sha256)), JSON.stringify(primero && { c: primero.codigo, s: primero.sha256 }));

  const reemplazo = page.waitForEvent("filechooser");
  await zona.locator(`[data-reporte-item="${primero.id}"]`).getByRole("button", { name: "Reemplazar" }).click();
  await (await reemplazo).setFiles({ name: `servicio corregido ${P}.pdf`, mimeType: "application/pdf", buffer: await pdfConTexto(2, "Reporte corregido") });
  const dialogo = page.getByRole("dialog", { name: `Reemplazar el reporte ${codigoRM(M_TK, 1)}` });
  await dialogo.waitFor();
  const tD = await textoDe(dialogo);
  check("[cob:I:I-160r] «Reemplazar» → diálogo «Reemplazar el reporte RM-…»: Motivo del reemplazo, contraseña y «Reemplazar reporte»", tD.includes(`«servicio corregido ${P}.pdf» sustituirá al reporte actual`) && tD.includes("Motivo del reemplazo") && (await page.locator("#prompt-password").count()) === 1 && (await botonesDe(dialogo)).includes("Reemplazar reporte"), tD.slice(0, 300));
  await motivoYClave(page, "El proveedor corrigió el certificado", "Reemplazar reporte", credenciales[EMAIL.carmen]);
  await toast(page, /Reporte reemplazado/);
  const segundo = await esperar(() => fila("SELECT * FROM reportes_mantenimiento WHERE id_mantenimiento = ? AND anulado_en IS NULL", M_TK));
  const anterior = fila("SELECT * FROM reportes_mantenimiento WHERE id = ?", primero.id);
  check("[cob:I:I-160r] queda el nuevo RM-…-02 y el anterior se conserva anulado, «reemplazado por» el nuevo, con entrada «sustituir» en la bitácora", segundo?.codigo === codigoRM(M_TK, 2) && !!anterior?.anulado_en && Number(anterior?.reemplazado_por) === Number(segundo?.id) && !!fila("SELECT id FROM auditoria WHERE accion = 'sustituir' AND entidad = 'reportes_mantenimiento' AND entidad_id = ?", String(primero.id)), JSON.stringify({ n: segundo?.codigo, a: anterior && { an: anterior.anulado_en, r: anterior.reemplazado_por } }));

  const item = zona.locator(`[data-reporte-item="${segundo.id}"]`);
  await item.waitFor();
  await item.getByRole("button", { name: "Quitar" }).click();
  const quitar = page.getByRole("dialog", { name: `Quitar el reporte ${codigoRM(M_TK, 2)}` });
  await quitar.waitFor();
  check("[cob:I:I-161r] «Quitar» → diálogo «Quitar el reporte RM-…» con Motivo, contraseña y «Quitar reporte»", (await page.locator("#prompt-password").count()) === 1 && (await botonesDe(quitar)).includes("Quitar reporte"));
  await motivoYClave(page, "Se adjuntó al mantenimiento equivocado", "Quitar reporte", credenciales[EMAIL.carmen]);
  await toast(page, /Reporte quitado/);
  await zona.locator("[data-reporte-vacio]").waitFor();
  check("[cob:I:I-161r] lo quita (anulado con motivo, entrada «anular») y la zona vuelve a «Aún no hay reporte…»", !!fila("SELECT anulado_en FROM reportes_mantenimiento WHERE id = ?", segundo.id)?.anulado_en && !!fila("SELECT id FROM auditoria WHERE accion = 'anular' AND entidad = 'reportes_mantenimiento' AND entidad_id = ?", String(segundo.id)));
});
await paso("hector", "reporte PDF: el Auditor solo lo abre", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/mantenimiento?abrir=${M_TP}`);
  const vacio = page.locator(`[data-mantenimiento-ventana="${M_TP}"] [data-reporte-vacio]`);
  await vacio.waitFor();
  check("[cob:I:I-155] [cob:I:I-156] sin permiso de adjuntar: «Aún no hay un reporte de servicio adjunto.» y sin «Adjuntar reporte PDF»", (await textoDe(vacio)) === "Aún no hay un reporte de servicio adjunto." && (await page.locator("[data-adjuntar-reporte]").count()) === 0);
  await page.goto(`${BASE_WEB}/inventario/mantenimiento?buscar=${encodeURIComponent(`Cob${S}`)}&abrir=${M_A}`);
  const ficha = page.locator(`[data-mantenimiento-ventana="${M_A}"]`);
  await ficha.waitFor();
  const item = ficha.locator("[data-reporte-item]").first();
  await item.waitFor();
  const botones = (await item.getByRole("button").allInnerTexts()).map((x) => x.trim());
  check("[cob:I:I-154] [cob:I:I-160r] [cob:I:I-161r] con equipos:V ve el reporte con «Abrir», sin «Reemplazar» ni «Quitar»", botones.includes("Abrir") && !botones.includes("Reemplazar") && !botones.includes("Quitar"), botones.join(", "));
  await item.getByRole("button", { name: "Abrir", exact: true }).click();
  const visor = page.getByTestId("visor-pdf");
  await visor.waitFor();
  await ficha.waitFor({ state: "detached" });
  await esperar(async () => (await page.getByTestId("visor-total-paginas").innerText()).trim() === "1");
  check("[cob:I:I-159] «Abrir» cierra la ficha y muestra el PDF en el visor", true);
  await page.keyboard.press("Escape");
  await visor.waitFor({ state: "detached" });
  await ficha.waitFor();
  check("[cob:I:I-159] al cerrar el visor vuelve la ficha del mantenimiento", true);
  await page.keyboard.press("Escape");

  const lista = page.locator("[data-reportes-mantenimiento]");
  await lista.getByRole("heading", { name: "Reportes de mantenimiento (PDF)" }).waitFor();
  const columnas = (await encabezadosDe(page, "Reportes de mantenimiento")).map((x) => x.trim()).filter(Boolean);
  const renglon = lista.locator("li").filter({ hasText: codigoRM(M_A, 1) });
  await renglon.waitFor();
  const tR = await textoDe(renglon);
  const quitados = await lista.locator("li").filter({ hasText: codigoRM(M_TK, 1) }).count() + (await lista.locator("li").filter({ hasText: codigoRM(M_TK, 2) }).count());
  check("[cob:I:I-162] «Reportes de mantenimiento (PDF)»: Reporte · Tipo · Versión · Estado · Fecha; el vigente con «Pulsa para abrir el PDF», versión y «Publicado»; sin los reemplazados ni quitados", columnas.join("|") === "Reporte|Tipo|Versión|Estado|Fecha" && /Pulsa para abrir el PDF/.test(tR) && /Versión \S+/.test(tR) && /Publicado/.test(tR) && quitados === 0, `${columnas.join("|")} · ${tR} · ${quitados}`);
  await renglon.locator("button").first().click();
  await visor.waitFor();
  check("[cob:I:I-162] clic en el renglón abre el PDF en el visor", true);
  await page.keyboard.press("Escape");
  await visor.waitFor({ state: "detached" });
});

await paso("qa", "mantenimiento: hoja (tipo, fechas, próxima calibración, campos y nota)", async (page) => {
  const E_CAL = await equipoDe("Q calibración en pantalla", { estado: "calibracion_pendiente" });
  await page.goto(`${BASE_WEB}/inventario/mantenimiento?nuevo=1&equipo=${E_CAL}`);
  const hoja = page.getByRole("dialog", { name: "Programar mantenimiento" });
  await hoja.waitFor();
  await page.waitForFunction((v) => document.querySelector("#m-equipo")?.value === v, String(E_CAL), { timeout: 15_000 });
  const tipos = (await page.locator("#m-tipo option").allTextContents()).map((x) => x.trim());
  check("[cob:I:I-162b] Tipo: Preventivo, Correctivo, Calibración", tipos.join("|") === "Preventivo|Correctivo|Calibración", tipos.join("|"));
  check("[cob:I:I-167] Técnico o proveedor (150), Responsable interno con cuentas activas y Observaciones", (await page.locator("#m-tecnico").getAttribute("maxlength")) === "150" && (await page.locator("#m-responsable option").count()) > 2 && (await page.locator("#m-obs").count()) === 1);
  check("[cob:I:I-168] nota «Mientras el mantenimiento esté programado, en proceso o vencido…»", (await hoja.getByText(/Mientras el mantenimiento esté/).count()) > 0 && /programado, en proceso o vencido/.test(await textoDe(hoja)));
  await page.locator('button[form="mantenimiento-form"][type="submit"]').click();
  const popup = page.locator('[data-validacion="faltan"]');
  await popup.waitFor();
  check("[cob:I:I-164] sin fecha programada: el aviso la pide", /fecha programada/i.test(await popup.innerText()), await popup.innerText());
  await page.getByRole("button", { name: "Entendido" }).last().click();
  await page.locator("#m-tipo").selectOption("calibracion");
  check("[cob:I:I-166] «Próxima calibración» no aparece mientras no esté completado", (await page.locator("#m-proxima").count()) === 0);
  await page.locator("#m-estado").selectOption("completado");
  await page.locator("#m-proxima").waitFor();
  check("[cob:I:I-166] con tipo Calibración y estado Completado aparece «Próxima calibración» («Se anota en la ficha del equipo.»)", (await hoja.getByText("Se anota en la ficha del equipo.").count()) > 0);
  await page.locator("#m-fecha").fill(enDias(-1));
  await page.locator('button[form="mantenimiento-form"][type="submit"]').click();
  await popup.waitFor();
  check("[cob:I:I-165] completado sin fecha de realización: el aviso la pide", /fecha en que se realizó/i.test(await popup.innerText()), await popup.innerText());
  await page.getByRole("button", { name: "Entendido" }).last().click();
  await page.locator("#m-realizado").fill(hoy());
  await page.locator("#m-proxima").fill("2027-12-01");
  await page.locator("#m-tecnico").fill(`Metrología ${S}`);
  await page.locator("#m-responsable").selectOption(String(id.ricardo));
  await page.locator("#m-obs").fill("Calibración con certificado");
  await page.locator('button[form="mantenimiento-form"][type="submit"]').click();
  await toast(page, /Mantenimiento programado/);
  const m = await esperar(() => fila("SELECT * FROM mantenimientos WHERE id_equipo = ?", E_CAL));
  const e = fila("SELECT estado, fecha_prox_calibracion FROM equipos WHERE id = ?", E_CAL);
  check("[cob:I:I-162b] [cob:I:I-164] [cob:I:I-165] [cob:I:I-166] [cob:I:I-167] la calibración completada se guarda (tipo, fechas, técnico, responsable, observaciones) y anota la próxima en el equipo", m?.tipo === "calibracion" && m?.estado === "completado" && m?.fecha_realizado === hoy() && m?.tecnico_proveedor === `Metrología ${S}` && Number(m?.id_responsable) === id.ricardo && m?.observaciones === "Calibración con certificado" && e?.fecha_prox_calibracion === "2027-12-01" && e?.estado === "operativo", JSON.stringify({ m: m && { t: m.tipo, s: m.estado, r: m.fecha_realizado }, e }));
});

/* ---------- Movimientos ---------- */
await paso("qa", "movimientos: resumen, filtros, orden, vacío y contador", async (page) => {
  await page.goto(`${BASE_WEB}/movimientos?buscar=${encodeURIComponent(`Cob${S}`)}`);
  const mios = filas(`SELECT m.id, m.tipo, m.tabla_origen, m.cantidad FROM movimientos m LEFT JOIN reactivos r ON m.tabla_origen = 'reactivos' AND r.id = m.id_item LEFT JOIN consumibles c ON m.tabla_origen = 'consumibles' AND c.id = m.id_item WHERE COALESCE(r.producto, c.producto, '') LIKE ?`, `Cob${S}%`);
  const ids = (f) => mios.filter(f).map((m) => Number(m.id));
  const todos = await renglones(page, "data-movimiento", ids(() => true));
  check("(preparación) la búsqueda muestra todos los movimientos de la prueba", mismo(todos, ids(() => true)), `${todos.length}/${mios.length}`);
  const barra = await textoDe(page.getByText(/^Hoy \d+/).first());
  const resumen = (await api("GET", "/inventory/movimientos?limite=1", undefined, t.qa)).data?.summary || {};
  const [hoyN, semanaN, mesN] = (barra.match(/Hoy (\d[\d,]*) · Esta semana (\d[\d,]*) · Este mes (\d[\d,]*)/) || []).slice(1).map((x) => Number(x.replace(/,/g, "")));
  check("[cob:I:I-181] «Hoy N · Esta semana N · Este mes N» con los conteos del servidor (hoy ≥ los de la prueba)", hoyN >= mios.length && semanaN >= hoyN && mesN >= hoyN && Math.abs(hoyN - resumen.hoy) <= 20 && Math.abs(mesN - resumen.mes) <= 20, `${barra} | ${JSON.stringify(resumen)}`);
  const contador = await page.getByText(/^\d+ movimientos?$/).first().innerText();
  check("[cob:I:I-187] contador «N movimientos» con las filas visibles", contador.trim() === `${mios.length} movimientos`, contador);
  await filtrar(page, "Reactivos");
  const soloR = await renglones(page, "data-movimiento", ids((m) => m.tabla_origen === "reactivos"));
  check("[cob:I:I-183] Insumo «Reactivos»: solo movimientos de reactivos", mismo(soloR, ids((m) => m.tabla_origen === "reactivos")), soloR.join());
  await filtrar(page, "Consumibles");
  const soloC = await renglones(page, "data-movimiento", ids((m) => m.tabla_origen === "consumibles"));
  check("[cob:I:I-183] Insumo «Consumibles»: solo movimientos de consumibles", mismo(soloC, ids((m) => m.tabla_origen === "consumibles")), soloC.join());
  await filtrar(page, "Consumibles");
  await renglones(page, "data-movimiento", ids(() => true));
  for (const [nombre, tipo] of [["Entradas", "entrada"], ["Salidas", "salida"], ["Consumos", "consumo"], ["Ajustes por conteo", "ajuste"]]) {
    await filtrar(page, nombre);
    const vistos = await renglones(page, "data-movimiento", ids((m) => m.tipo === tipo));
    check(`[cob:I:I-184] Tipo «${nombre}»: solo los de tipo ${tipo}`, ids((m) => m.tipo === tipo).length > 0 && mismo(vistos, ids((m) => m.tipo === tipo)), `${vistos.join()} / ${ids((m) => m.tipo === tipo).join()}`);
    await filtrar(page, nombre);
  }
  const recientes = await renglones(page, "data-movimiento", ids(() => true));
  await filtrar(page, "Más antiguos");
  const antiguos = await renglones(page, "data-movimiento", [...recientes].reverse(), { enOrden: true });
  check("[cob:I:I-185] «Más antiguos» invierte el orden de «Más recientes»", mismo(antiguos, [...recientes].reverse(), true), `${recientes.join()} → ${antiguos.join()}`);
  await filtrar(page, "Mayor cantidad");
  const porCantidad = [...mios].sort((a, b) => Math.abs(Number(b.cantidad)) - Math.abs(Number(a.cantidad)));
  let vistos = [];
  await esperar(async () => {
    vistos = await idsDe(page, "data-movimiento");
    const cant = vistos.map((v) => Math.abs(Number(mios.find((m) => Number(m.id) === v)?.cantidad)));
    return vistos.length === mios.length && cant.every((c, i) => i === 0 || c <= cant[i - 1]);
  });
  check("[cob:I:I-185] «Mayor cantidad»: de mayor a menor", vistos[0] === Number(porCantidad[0].id) || Math.abs(Number(mios.find((m) => Number(m.id) === vistos[0])?.cantidad)) === Math.abs(Number(porCantidad[0].cantidad)), vistos.join());
  await buscarEn(page, "Buscar por insumo, referencia o motivo", `zz-sin-movimientos-${S}`);
  await page.getByText("Sin movimientos").waitFor();
  check("[cob:I:I-187] sin resultados: «Sin movimientos» · «No hay movimientos con ese filtro.» y sin contador", (await page.getByText("No hay movimientos con ese filtro.").count()) > 0 && (await page.getByText(/^\d+ movimientos?$/).count()) === 0);
});

const movAtrasado = fila("SELECT id FROM movimientos WHERE tabla_origen = 'reactivos' AND id_item = ? AND motivo = ?", R_MOV, `MotivoX${S} atrasado`)?.id;
const movVinculado = fila("SELECT id FROM movimientos WHERE tabla_origen = 'reactivos' AND id_item = ? AND motivo LIKE ?", R_C, `Entrada vinculada ${S}%`)?.id;
const movEntrada = fila("SELECT id FROM movimientos WHERE tabla_origen = 'reactivos' AND id_item = ? AND motivo = ?", R_MOV, `Movimiento 2 de ${P}`)?.id;
await paso("qa", "movimientos: encabezado, búsqueda, renglón, ficha y ?buscar=", async (page) => {
  const inicial = respuestaDe(page, "/api/inventory/movimientos");
  await page.goto(`${BASE_WEB}/movimientos`);
  const primera = new URL((await inicial).url());
  await page.getByRole("heading", { name: "Movimientos", exact: true }).first().waitFor();
  check("[cob:I:I-180] «Movimientos» con su descripción; sin filtros pide los 200 más recientes", (await page.getByText("Entradas, salidas, consumos y ajustes por conteo de reactivos y consumibles, incluidos los generados al procesar muestras.").count()) > 0 && primera.searchParams.get("limite") === "200", primera.search);
  await page.locator("[data-movimiento]").first().waitFor();
  const conTexto = respuestaDe(page, "/api/inventory/movimientos", "limite", "1000");
  await buscarEn(page, "Buscar por insumo, referencia o motivo", `MotivoX${S}`);
  const pedida = new URL((await conTexto).url());
  const porMotivo = await renglones(page, "data-movimiento", [movAtrasado]);
  await buscarEn(page, "Buscar por insumo, referencia o motivo", `${P} R4`);
  const porInsumo = await renglones(page, "data-movimiento", filas("SELECT id FROM movimientos WHERE tabla_origen = 'reactivos' AND id_item = ?", R_MOV).map((x) => Number(x.id)));
  check("[cob:I:I-182] «Buscar por insumo, referencia o motivo»: con texto pide hasta 1000 y filtra en la pantalla (por motivo y por insumo)", porMotivo.join() === String(movAtrasado) && porInsumo.length === 9 && !pedida.searchParams.has("buscar") && !pedida.searchParams.has("search"), `${pedida.search} · ${porMotivo.join()} · ${porInsumo.length}`);
  const tAtrasado = await textoDe(page.locator(`[data-movimiento="${movAtrasado}"]`));
  const tEntrada = await textoDe(page.locator(`[data-movimiento="${movEntrada}"]`));
  check("[cob:I:I-186] renglón: insumo, «Salida · Reactivo», −2 L, motivo, fecha del movimiento y «Capturado el …» si se capturó otro día", tAtrasado.includes(`${P} R4 con movimientos`) && /Salida · Reactivo/.test(tAtrasado) && /−2\s*L/.test(tAtrasado) && tAtrasado.includes(`MotivoX${S} atrasado`) && /Capturado el/.test(tAtrasado), tAtrasado);
  check("[cob:I:I-186] una entrada del mismo día: «Entrada · Reactivo», +2 L y sin «Capturado el»", /Entrada · Reactivo/.test(tEntrada) && /\+2\s*L/.test(tEntrada) && !/Capturado el/.test(tEntrada), tEntrada);

  await abrirFicha(page.locator(`[data-movimiento="${movAtrasado}"]`));
  const ficha = page.locator(`[data-movimiento-ventana="${movAtrasado}"]`);
  await ficha.waitFor();
  const tf = await textoDe(ficha);
  const enlace = await ficha.getByRole("link", { name: `${P} R4 con movimientos` }).getAttribute("href");
  const faltan = ["Salida", "Salió del inventario", "−2", "Detalle", "Tipo", "Registró", nombreRicardo, "Motivo", `MotivoX${S} atrasado`, "Fecha del movimiento", "Capturado", "Registro de origen"].filter((x) => !tf.includes(x));
  check("[cob:I:I-188] ficha: insignia del tipo, «Salió del inventario» −2 L, Detalle (enlace al reactivo, tipo, quién, motivo, fechas) y «Registro de origen» sin enlace", !faltan.length && decodeURIComponent(enlace || "").replace(/\+/g, " ").startsWith("/inventario/reactivos?buscar=") && (await seccionDe(page, ficha, "Registro de origen").getByRole("link").count()) === 0, `faltan: ${faltan.join(", ")} · ${enlace}`);
  await page.keyboard.press("Escape");

  await page.goto(`${BASE_WEB}/movimientos?buscar=${encodeURIComponent(`Entrada vinculada ${S}`)}`);
  check("[cob:I:I-189] ?buscar= llena el buscador y filtra", (await renglones(page, "data-movimiento", [movVinculado])).join() === String(movVinculado) && (await page.getByPlaceholder("Buscar por insumo, referencia o motivo").inputValue()) === `Entrada vinculada ${S}`);
  await abrirFicha(page.locator(`[data-movimiento="${movVinculado}"]`));
  const fV = page.locator(`[data-movimiento-ventana="${movVinculado}"]`);
  await fV.waitFor();
  const origen = seccionDe(page, fV, "Registro de origen").getByRole("link");
  check("[cob:I:I-188] movimiento ligado: «Entró al inventario» y «Registro de origen» enlaza a la recepción", (await textoDe(fV)).includes("Entró al inventario") && (await origen.getAttribute("href")) === `/muestras/recepcion/${cad.R}`, await origen.getAttribute("href"));
});

/* ---------- Atajo y animación ---------- */
await paso("qa", "reactivos: Mod+K y animación de entrada", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/reactivos?buscar=${encodeURIComponent(`Cob${S}`)}`);
  await page.locator(`[data-reactivo="${R_A}"]`).waitFor();
  const animacion = await page.locator("ul.divide-y > li.entrada-escalonada").first().evaluate((el) => getComputedStyle(el).animationName);
  check("[cob:I:I-209] los renglones entran con la animación escalonada (rise-in)", animacion === "rise-in", animacion);
  await page.keyboard.press("ControlOrMeta+k");
  const buscador = page.getByRole("dialog", { name: "Buscar" });
  await buscador.waitFor();
  check("[cob:I:I-208] Mod+K (⌘K en Mac, Ctrl+K en Windows) abre el buscador desde Reactivos", true);
  await page.keyboard.press("Escape");
});
await paso(
  "qa",
  "reactivos: sin animación con prefers-reduced-motion",
  async (page) => {
    await page.goto(`${BASE_WEB}/inventario/reactivos?buscar=${encodeURIComponent(`Cob${S}`)}`);
    await page.locator(`[data-reactivo="${R_A}"]`).waitFor();
    const animacion = await page.locator("ul.divide-y > li.entrada-escalonada").first().evaluate((el) => getComputedStyle(el).animationName);
    check("[cob:I:I-209] con prefers-reduced-motion la entrada de renglones se apaga", animacion === "none", animacion);
  },
  { reducedMotion: "reduce" },
);

/* ---------- Búsqueda global: accesos y resultados de inventario ---------- */
async function titulosBusqueda(page, texto) {
  /* El buscador en ventana (⌘K): diálogo «Buscar» abierto; si se está cerrando, se espera a que se vaya. */
  const buscador = page.getByRole("dialog", { name: "Buscar", exact: true }).and(page.locator('[data-state="open"]'));
  if (!(await buscador.isVisible().catch(() => false))) await page.getByRole("dialog", { name: "Buscar", exact: true }).waitFor({ state: "detached" });
  if (!(await buscador.isVisible().catch(() => false))) await page.locator('aside[aria-label="Navegación principal"]').getByRole("button", { name: "Buscar", exact: true }).click();
  const campo = buscador.locator('input[aria-label="Buscar en FICOTOX"]');
  await campo.waitFor();
  const respuesta = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/busqueda" && new URL(r.url()).searchParams.get("q") === texto);
  respuesta.catch(() => undefined);
  await campo.fill(texto);
  const data = await (await respuesta).json();
  const esperados = (data.grupos || []).flatMap((g) => g.resultados.map((r) => r.titulo));
  let vistos = [];
  await esperar(async () => {
    vistos = await buscador.getByRole("option").evaluateAll((os) => os.map((o) => o.querySelector("span.truncate")?.textContent?.trim()).filter(Boolean));
    return esperados.every((x) => vistos.includes(x));
  });
  return vistos;
}
const elegirResultado = (page, titulo) => page.getByRole("dialog", { name: "Buscar", exact: true }).getByRole("option").filter({ has: page.locator("span.truncate", { hasText: titulo }) }).first().click();
const ACCESOS = ["Reactivos", "Consumibles", "Equipos", "Mantenimiento", "Movimientos de inventario", "Reactivos con stock bajo", "Reactivos por vencer", "Consumibles con stock bajo", "Equipos con alerta de calibración", "Equipos en mantenimiento", "Mantenimientos vencidos", "Mantenimientos próximos", "Mantenimientos completados", "Nuevo reactivo", "Nuevo consumible", "Nuevo equipo", "Programar mantenimiento"];
// Un movimiento recién capturado (el índice solo trae los más recientes).
await api("POST", `/inventory/reactivos/${R_AJ}/refill`, { tipo: "entrada", cantidad: 1, motivo: `BuscaX${S} reposición` }, t.ricardo);
const movBusca = fila("SELECT id, referencia FROM movimientos WHERE motivo = ?", `BuscaX${S} reposición`);
await paso("qa", "búsqueda global: accesos y resultados de inventario", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/reactivos`);
  await page.locator("[data-reactivo]").first().waitFor();
  const faltan = [];
  for (const acceso of ACCESOS) if (!(await titulosBusqueda(page, acceso)).includes(acceso)) faltan.push(acceso);
  check("[cob:I:I-206] accesos de inventario en el buscador: pantallas, vistas filtradas y «Nuevo reactivo/consumible/equipo», «Programar mantenimiento»", !faltan.length, `faltan: ${faltan.join(", ")}`);
  await titulosBusqueda(page, "Reactivos con stock bajo");
  await elegirResultado(page, "Reactivos con stock bajo");
  await page.waitForURL((u) => u.pathname === "/inventario/reactivos" && u.searchParams.get("filtro") === "bajo");
  const destinos = { vista: await opcionActiva(page, "Existencia baja o vacía") };
  await titulosBusqueda(page, "Nuevo equipo");
  await elegirResultado(page, "Nuevo equipo");
  destinos.accion = await page.getByRole("dialog", { name: "Nuevo equipo" }).waitFor().then(() => true);
  await page.getByRole("dialog", { name: "Buscar", exact: true }).waitFor({ state: "detached" });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Nuevo equipo" }).waitFor({ state: "detached" });
  check("[cob:I:I-206] un acceso lleva a su vista filtrada (?filtro=bajo) y una acción abre su alta (?nuevo=1)", destinos.vista && destinos.accion, JSON.stringify(destinos));

  const resultados = {};
  for (const [texto, titulo, ruta, attr, idEsperado] of [
    [`${P} R1 búsqueda`, `${P} R1 búsqueda`, "/inventario/reactivos", "data-insumo-ventana", R_BUS],
    [`${P} C1 búsqueda`, `${P} C1 búsqueda`, "/inventario/consumibles", "data-insumo-ventana", C_BUS],
    [`${P} E1 cromatógrafo`, `${P} E1 cromatógrafo`, "/inventario/equipos", "data-equipo-ventana", E_BUS],
    [`Calibración · ${P} E5`, `Calibración · ${P} E5 por tipo`, "/inventario/mantenimiento", "data-mantenimiento-ventana", M_TK],
  ]) {
    const vistos = await titulosBusqueda(page, texto);
    if (!vistos.includes(titulo)) {
      resultados[titulo] = `no aparece: ${vistos.join(" | ")}`;
      continue;
    }
    await elegirResultado(page, titulo);
    await page.waitForURL((u) => u.pathname === ruta && u.searchParams.get("abrir") === String(idEsperado));
    const ventana = page.locator(`[${attr}="${idEsperado}"]`);
    await ventana.waitFor();
    resultados[titulo] = true;
    // Escape solo cuando el buscador ya se fue: mientras se cierra sigue siendo la capa de arriba y se lo queda.
    await page.getByRole("dialog", { name: "Buscar", exact: true }).waitFor({ state: "detached" });
    await page.keyboard.press("Escape");
    await ventana.waitFor({ state: "detached" });
  }
  check("[cob:I:I-207] resultados de reactivo, consumible, equipo y mantenimiento abren su ficha (?abrir=<id>)", Object.values(resultados).every((x) => x === true), JSON.stringify(resultados));
  const vistos = await titulosBusqueda(page, `BuscaX${S}`);
  const titulo = `Entrada · ${P} R7 para movimientos`;
  if (vistos.includes(titulo)) {
    await elegirResultado(page, titulo);
    await page.waitForURL((u) => u.pathname === "/movimientos" && u.searchParams.get("buscar") === String(movBusca?.referencia));
    await renglones(page, "data-movimiento", [Number(movBusca.id)]);
  }
  check("[cob:I:I-207] un movimiento lleva a Movimientos con ?buscar=<referencia> y solo ese renglón", vistos.includes(titulo), vistos.join(" | "));
});
await paso("hector", "búsqueda global: sin acciones de alta para el Auditor", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/reactivos`);
  await page.locator("[data-reactivo]").first().waitFor();
  const vistos = [];
  for (const accion of ["Nuevo reactivo", "Nuevo consumible", "Nuevo equipo", "Programar mantenimiento"]) vistos.push(...(await titulosBusqueda(page, accion)));
  const pantallas = await titulosBusqueda(page, "Reactivos con stock bajo");
  check("[cob:I:I-206] el Auditor ve las pantallas y vistas, pero no «Nuevo reactivo/consumible/equipo» ni «Programar mantenimiento»", !["Nuevo reactivo", "Nuevo consumible", "Nuevo equipo", "Programar mantenimiento"].some((x) => vistos.includes(x)) && pantallas.includes("Reactivos con stock bajo"), vistos.join(" | "));
});
await paso("jorge", "búsqueda global: sin reactivos para quien solo ve equipos", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/equipos`);
  await page.locator("[data-equipo]").first().waitFor();
  const reactivos = await titulosBusqueda(page, `${P} R1 búsqueda`);
  const equipos = await titulosBusqueda(page, `${P} E1 cromatógrafo`);
  const accesos = await titulosBusqueda(page, "Reactivos con stock bajo");
  check("[cob:I:I-206] [cob:I:I-207] sin inventario:V no aparecen reactivos ni sus accesos; los equipos sí", !reactivos.includes(`${P} R1 búsqueda`) && !accesos.includes("Reactivos con stock bajo") && equipos.includes(`${P} E1 cromatógrafo`), `${reactivos.join(" | ")} · ${accesos.join(" | ")} · ${equipos.join(" | ")}`);
});

await nav.cerrar();
terminar();
