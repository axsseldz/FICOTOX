/*
 * Prueba integral · cobertura de Inventario, movimientos y equipos en pantalla (Playwright).
 * Cada check lleva la etiqueta [cob:I:<id>] del elemento de interfaz de la matriz que prueba
 * (filtros, orden, renglones, avisos, menús, ventanas, formularios y atajos de Reactivos,
 * Consumibles, Equipos, Mantenimiento y Movimientos). Sin errores de consola ni respuestas 5xx.
 */
import "../lib/reauth-auto.mjs";

process.env.BASE = `${(process.env.BASE || "http://localhost:3100").replace(/\/api$/, "")}/api`;
const { abrirNavegador, BASE_WEB, toast, esperar } = await import("../lib/navegador.mjs");
const { api, cadena, crearCheck, credenciales, Database, EMAIL, enDias, fila, filas, hoy, sesiones } = await import("../lib/calidad.mjs");
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
  check("[cob:I:I-105] con vínculo y sin folio: el aviso pide el folio", /folio/i.test(await popup.innerText()), await popup.innerText());
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
  check("[cob:I:I-131] sin nombre: el aviso pide el nombre del equipo", /nombre del equipo/i.test(await popup.innerText()), await popup.innerText());
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

await nav.cerrar();
terminar();
