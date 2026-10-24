/*
 * Prueba integral · Inventario y Equipos en pantalla (Playwright). Bugs corregidos en la prueba integral:
 * - el formulario de mantenimiento ya no ofrece «Vencido» ni «Cancelado» (y uno completado solo «Completado»);
 *   el menú no ofrece cancelar lo completado ni editar lo cancelado;
 * - la lista de consumibles mostraba una columna «Caducidad» siempre vacía (la tabla no la tiene): ahora «Ingreso»;
 * - un ajuste sin diferencia se pintaba «−0»;
 * - «Stock bajo» en la lista contaba reactivos sin existencia canónica (columnas heredadas) que el Inicio no cuenta;
 * - ?abrir= de un registro que no está en la lista no avisaba nada;
 * - la pista del stock mínimo de consumibles decía «Opcional. Opcional, …».
 * Sin errores de consola ni respuestas 5xx.
 */
import "../lib/reauth-auto.mjs";

process.env.BASE = `${(process.env.BASE || "http://localhost:3100").replace(/\/api$/, "")}/api`;
const { abrirNavegador, BASE_WEB, toast } = await import("../lib/navegador.mjs");
const { api, crearCheck, credenciales, Database, EMAIL, enDias, sesiones } = await import("../lib/calidad.mjs");

const { check, terminar } = crearCheck();
const { t } = await sesiones();
const nav = await abrirNavegador({ suite: "integral-inventario", check, credencial: (quien) => ({ email: quien === "qa" ? "qa@ficotox.local" : EMAIL[quien], password: quien === "qa" ? "QaFicotox2026!" : credenciales[EMAIL[quien]] }) });
const { paso } = nav;
const sello = Date.now().toString(36).slice(-5).toUpperCase();

/* ---------- Datos ---------- */
const equipo = `Equipo UI integral ${sello}`;
const E = (await api("POST", "/inventory/equipos", { nombre: equipo, estado: "operativo" }, t.qa)).data?.id;
const mant = (extra) => api("POST", "/inventory/mantenimientos", { id_equipo: E, tipo: "preventivo", fecha_programada: "2027-05-01", estado: "programado", ...extra }, t.qa).then((r) => r.data?.id);
const M_COMPLETO = await mant({ estado: "completado", fecha_realizado: enDias(0), fecha_programada: enDias(-1) });
const M_CANCELADO = await mant({ fecha_programada: "2027-06-01" });
await api("DELETE", `/inventory/mantenimientos/${M_CANCELADO}`, { motivo: "Prueba UI: visita cancelada" }, t.qa);
const M_PROGRAMADO = await mant({ fecha_programada: "2027-07-01" });
const consumible = `Consumible UI ${sello}`;
const C = (await api("POST", "/consumables", { producto: consumible, piezas: 1, cantidad_por_pieza: 20, fecha_ingreso: "2026-03-15" }, t.qa)).data?.id;
const reactivo = `Reactivo UI ${sello}`;
const R = (await api("POST", "/inventory/reactivos", { tipo_reactivo: "alcoholes_solventes", producto: reactivo, capacidad: 1, unidad_capacidad: "L", piezas: 1 }, t.qa)).data?.id;
await api("POST", `/inventory/reactivos/${R}/refill`, { tipo: "ajuste", cantidad: 1, motivo: `Conteo UI sin diferencia ${sello}` }, t.ricardo);
const R_BAJA = (await api("POST", "/inventory/reactivos", { tipo_reactivo: "alcoholes_solventes", producto: `Reactivo retirado ${sello}`, capacidad: 1, unidad_capacidad: "L", piezas: 1 }, t.qa)).data?.id;
await api("DELETE", `/inventory/reactivos/${R_BAJA}`, { motivo: "Prueba UI: frasco retirado" }, t.qa);
// Reactivo heredado de la carga inicial: sin existencia canónica (pendiente de ajuste) y con columnas viejas del Excel.
const heredado = `Reactivo heredado ${sello}`;
const R_HEREDADO = (await api("POST", "/inventory/reactivos", { tipo_reactivo: "alcoholes_solventes", producto: heredado, capacidad: 1, unidad_capacidad: "L", piezas: 1 }, t.qa)).data?.id;
{
  const db = new Database(process.env.TEST_DB_PATH);
  db.prepare("UPDATE reactivos SET cantidad_actual = NULL, stock_maximo = NULL, restante_190126 = 0.05, capacidad_litros = 1 WHERE id = ?").run(R_HEREDADO);
  db.close();
}
check("(preparación) datos de inventario", [E, M_COMPLETO, M_CANCELADO, M_PROGRAMADO, C, R, R_BAJA, R_HEREDADO].every(Boolean));

const menuDe = async (page, fila) => {
  const boton = fila.getByRole("button", { name: "Acciones" });
  if (!(await boton.count())) return [];
  await boton.click();
  const items = (await page.getByRole("menuitem").allInnerTexts()).map((x) => x.split("\n")[0].trim());
  await page.keyboard.press("Escape");
  return items;
};

/* ---------- Mantenimiento ---------- */
await paso("qa", "mantenimiento: estados del formulario y acciones del menú", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/mantenimiento?buscar=${encodeURIComponent(equipo)}`);
  const programado = page.locator(`[data-mantenimiento="${M_PROGRAMADO}"]`);
  await programado.waitFor();
  const cancelado = page.locator(`[data-mantenimiento="${M_CANCELADO}"]`);
  const menuCancelado = (await cancelado.count()) ? await menuDe(page, cancelado) : [];
  check("lo cancelado ya no ofrece «Editar» ni «Cancelar»", !menuCancelado.some((x) => /Editar|Cancelar/.test(x)), menuCancelado.join(", "));
  await programado.getByRole("button", { name: "Acciones" }).click();
  await page.getByRole("menuitem", { name: /^Editar/ }).click();
  await page.locator("#m-estado").waitFor();
  const opciones = (await page.locator("#m-estado option").allTextContents()).map((x) => x.trim());
  check("programado: el estado solo ofrece Programado, En proceso y Completado", opciones.join("|") === "Programado|En proceso|Completado", opciones.join("|"));
  await page.keyboard.press("Escape");
  await page.goto(`${BASE_WEB}/inventario/mantenimiento?filtro=completado&buscar=${encodeURIComponent(equipo)}`);
  const completo = page.locator(`[data-mantenimiento="${M_COMPLETO}"]`);
  await completo.waitFor();
  const menuCompleto = await menuDe(page, completo);
  check("lo completado no ofrece «Cancelar mantenimiento…»", menuCompleto.includes("Editar") && !menuCompleto.some((x) => /Cancelar/.test(x)), menuCompleto.join(", "));
  await completo.getByRole("button", { name: "Acciones" }).click();
  await page.getByRole("menuitem", { name: /^Editar/ }).click();
  await page.locator("#m-estado").waitFor();
  const opcionesCompleto = (await page.locator("#m-estado option").allTextContents()).map((x) => x.trim());
  check("completado: el estado ya no se puede regresar", opcionesCompleto.join("|") === "Completado", opcionesCompleto.join("|"));
});

/* ---------- Consumibles ---------- */
await paso("qa", "consumibles: columna de ingreso y pista del mínimo", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/consumibles?buscar=${encodeURIComponent(consumible)}`);
  const fila = page.locator(`[data-consumible="${C}"]`);
  await fila.waitFor();
  // Encabezado de ListaCuadricula (columnas visibles, aria-hidden porque cada celda repite su título).
  const encabezados = (await page.locator("div[aria-hidden='true'].grid > span").allInnerTexts()).map((x) => x.trim());
  check("la lista ya no tiene «Caducidad» (vacía siempre) sino «Ingreso»", encabezados.includes("Ingreso") && !encabezados.includes("Caducidad"), encabezados.join(", "));
  const texto = (await fila.innerText()).replace(/\s+/g, " ");
  check("…con la fecha de ingreso del consumible", /15 mar\.? 2026/i.test(texto), texto);
  await fila.getByRole("button", { name: "Acciones" }).click();
  await page.getByRole("menuitem", { name: /^Editar/ }).click();
  const pista = await page.getByText(/en unidades\. Al llegar a esta cantidad/).first().innerText();
  check("la pista del stock mínimo ya no repite «Opcional»", !/Opcional\. Opcional/.test(pista) && /Opcional, en unidades/.test(pista), pista.replace(/\s+/g, " ").slice(0, 160));
});

/* ---------- Movimientos ---------- */
await paso("ricardo", "movimientos: ajuste sin diferencia sin «−0»", async (page) => {
  await page.goto(`${BASE_WEB}/movimientos?buscar=${encodeURIComponent(sello)}`);
  const fila = page.locator("[data-movimiento]").filter({ hasText: reactivo }).filter({ hasText: "Ajuste por conteo" }).first();
  await fila.waitFor();
  const texto = (await fila.innerText()).replace(/\s+/g, " ");
  check("la lista no pinta «−0» en el ajuste sin diferencia", !/−\s?0(?![.,\d])/.test(texto) && /(^|\s)0\s?L\b/.test(texto), texto);
  await fila.click();
  const ventana = page.getByRole("dialog");
  await ventana.waitFor();
  const detalle = (await ventana.innerText()).replace(/\s+/g, " ");
  check("…y la ficha dice «Conteo sin diferencia»", /Conteo sin diferencia/.test(detalle) && !/−\s?0(?![.,\d])/.test(detalle), detalle.slice(0, 200));
});

/* ---------- Reactivos ---------- */
await paso("qa", "reactivos: stock bajo como el Inicio y ?abrir= que avisa", async (page) => {
  await page.goto(`${BASE_WEB}/inventario/reactivos?filtro=bajo&buscar=${encodeURIComponent(heredado)}`);
  await page.locator("main").waitFor();
  await page.waitForResponse((r) => r.url().includes("/api/inventory/reactivos") && r.url().includes("search=")).catch(() => {});
  await page.waitForTimeout(500);
  const enBajo = await page.locator(`[data-reactivo="${R_HEREDADO}"]`).count();
  check("un reactivo sin existencia canónica no aparece en «Stock bajo» (el Inicio tampoco lo cuenta)", enBajo === 0, String(enBajo));
  await page.goto(`${BASE_WEB}/inventario/reactivos?buscar=${encodeURIComponent(heredado)}`);
  await page.locator(`[data-reactivo="${R_HEREDADO}"]`).waitFor();
  check("…pero sigue en la lista general", true);
  await page.goto(`${BASE_WEB}/inventario/reactivos?abrir=${R_BAJA}`);
  await toast(page, /no aparece en la lista/);
  check("?abrir= de un reactivo dado de baja avisa que no está en la lista", true);
});

await nav.cerrar();
terminar();
