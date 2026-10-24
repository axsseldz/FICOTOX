/*
 * Ficha de Documentos SGC en el navegador: la accion que le toca a la persona
 * es un boton principal (data-principal="1"); las demas viven en el menu
 * "Más acciones" (⋯), deshabilitadas con su motivo cuando corresponde. La
 * informacion va en pestañas (Detalles, Revisiones, Lecturas).
 */

const menu = (page) => page.getByRole("menu");
/*
 * El encabezado (con la accion principal y el menu ⋯) se dibuja cuando llegan los datos de la ficha.
 * Tras guardar algo la ficha se recarga (aria-busy) y la accion principal puede cambiar: se espera a
 * los datos nuevos antes de decidir entre el boton principal y el menu.
 */
const ficha = (page) => page.locator('[data-testid="sgc-ficha"]:not([aria-busy="true"])').waitFor();
const botonMenu = (page) => page.getByRole("button", { name: "Más acciones" });

export async function abrirMenu(page) {
  if (await menu(page).count()) return;
  await botonMenu(page).click();
  await menu(page).waitFor();
}

export async function cerrarMenu(page) {
  if (!(await menu(page).count())) return;
  await page.keyboard.press("Escape");
  await menu(page).waitFor({ state: "detached" });
}

/* La accion por su data-testid: el boton principal si es ella; si no, su renglon del menu ⋯ (lo abre). */
export async function accion(page, testid) {
  await ficha(page);
  const principal = page.locator(`[data-principal="1"][data-testid="${testid}"]`);
  if (await principal.count()) return principal;
  if (await botonMenu(page).count()) {
    await abrirMenu(page);
    return menu(page).getByTestId(testid);
  }
  return page.getByTestId(testid);
}

/* Cuantas veces esta disponible la accion (boton principal o renglon del menu); deja el menu cerrado. */
export async function contarAccion(page, testid) {
  await ficha(page);
  const principal = await page.locator(`[data-principal="1"][data-testid="${testid}"]`).count();
  let enMenu = 0;
  if (await botonMenu(page).count()) {
    await abrirMenu(page);
    enMenu = await menu(page).getByTestId(testid).count();
    await cerrarMenu(page);
  }
  return principal + enMenu;
}

/* Texto del motivo de una accion deshabilitada en el menu ⋯ (deja el menu abierto). */
export async function motivo(page, testid) {
  await abrirMenu(page);
  return (await menu(page).getByTestId(`${testid}-motivo`).innerText()).trim();
}

/* La accion principal de la ficha (data-testid) o null si no hay. */
export async function principal(page) {
  await ficha(page);
  const b = page.locator('[data-principal="1"]');
  return (await b.count()) ? b.getAttribute("data-testid") : null;
}

export async function pestana(page, nombre) {
  const tab = page.getByRole("tab", { name: nombre });
  if (await tab.count()) await tab.click();
}
