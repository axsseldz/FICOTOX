/*
 * Inicio de Documentos SGC: fila de cuatro indicadores arriba de las carpetas.
 * - Para dos roles (Mejora Continua y Técnico Analista) cada número de la pantalla
 *   coincide con la API: el resumen y la lista con el mismo filtro (vigentes,
 *   en_curso, pendiente_revision) y las lecturas pendientes de la Bandeja.
 * - Un documento confidencial vigente cuenta para Mejora Continua y no para el
 *   Técnico Analista (permisos y confidencialidad).
 * - Al pulsar cada indicador se llega a la lista con ese filtro (y el mismo número
 *   de tarjetas) o a la Bandeja en «Lecturas pendientes».
 * - En 0 el indicador se ve en tono neutro y no se oculta.
 * - A 1440 y 820 px van en una fila; a 400 px, 2×2 sin desbordes; claro y oscuro.
 */
import "../lib/reauth-auto.mjs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const BASE = process.env.BASE || "http://localhost:3100";
process.env.BASE = `${BASE}/api`;
const { api, crearCheck, credenciales, EMAIL, sesiones } = await import("../lib/calidad.mjs");
const { pdfConTexto } = await import("../lib/archivos.mjs");
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const { check, terminar } = crearCheck();
const stamp = Date.now().toString(36).slice(-4).toUpperCase();
const { t, id } = await sesiones();

/* ---------- Datos de apoyo: un vigente de uso interno próximo a revisar, uno confidencial y uno en elaboración ---------- */
const enDias = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
async function ficha(clave, extra = {}) {
  const fd = new FormData();
  const campos = { clave, titulo: `Indicadores ${clave}`, area_codigo: "TC", tipo_codigo: "P", elaborador_id: id.gabriela, revisor_id: id.ricardo, autorizador_id: id.patricia, ...extra };
  for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
  fd.append("archivo_pdf", new Blob([await pdfConTexto(1, `Indicadores ${clave}`)]), "indicadores.pdf");
  return (await api("POST", "/sgc/documentos", fd, t.ana)).data;
}
const PROXIMO = await ficha(`FX-TCP-I${stamp}`);
const r1 = await api("POST", `/sgc/revisiones/${PROXIMO?.revision_id}/registrar-vigente`, { fecha_emision: "2025-02-01", fecha_proxima_revision: enDias(10) }, t.ana);
const CONF = await ficha(`FX-TCP-C${stamp}`, { confidencialidad: "confidencial" });
const r2 = await api("POST", `/sgc/revisiones/${CONF?.revision_id}/registrar-vigente`, { fecha_emision: "2025-02-01", fecha_proxima_revision: "2028-02-01" }, t.ana);
const BORRADOR = await ficha(`FX-TCP-B${stamp}`);
// El Técnico Analista debe leer el vigente de uso interno: una lectura pendiente suya.
const dist = await api("POST", `/sgc/revisiones/${PROXIMO?.revision_id}/distribucion`, { usuarios: [id.luis], requiere_lectura: true, motivo: "Lectura obligatoria de prueba" }, t.ana);
check("datos: vigente próximo a revisar (con lectura para el Técnico Analista), confidencial vigente y uno en elaboración", r1.status === 200 && r2.status === 200 && !!BORRADOR?.id && dist.status < 300, `${r1.status} ${r1.data?.message || ""} ${r2.status} ${BORRADOR?.id} dist=${dist.status} ${dist.data?.message || ""}`);

const INDICADORES = [
  { clave: "vigentes", filtro: "vigente" },
  { clave: "en_curso", filtro: "en_curso" },
  { clave: "proximos_revision", filtro: "pendiente_revision" },
];
/* Lo que dice la API para una persona: resumen, lista con el mismo filtro y Bandeja. */
async function segunApi(token) {
  const ind = (await api("GET", "/sgc/resumen", undefined, token)).data?.indicadores || {};
  const lista = {};
  for (const x of INDICADORES) lista[x.clave] = ((await api("GET", `/sgc/documentos?estado=${x.filtro}`, undefined, token)).data?.items || []).map((d) => d.clave);
  const lecturas = ((await api("GET", "/sgc/bandeja", undefined, token)).data?.lecturas_pendientes || []).length;
  return { ind, lista, lecturas };
}
const API = { ana: await segunApi(t.ana), luis: await segunApi(t.luis) };
for (const quien of ["ana", "luis"]) {
  const a = API[quien];
  check(`${quien}: el resumen y la lista filtrada cuentan lo mismo (vigentes, en revisión, próximos) y las lecturas igual que la Bandeja`, INDICADORES.every((x) => a.ind[x.clave] === a.lista[x.clave].length) && a.ind.lecturas_mias === a.lecturas, JSON.stringify({ ind: a.ind && { v: a.ind.vigentes, c: a.ind.en_curso, p: a.ind.proximos_revision, l: a.ind.lecturas_mias }, lista: Object.fromEntries(Object.entries(a.lista).map(([k, v]) => [k, v.length])), bandeja: a.lecturas }));
}
check("el confidencial vigente cuenta para Mejora Continua y no para el Técnico Analista", API.ana.lista.vigentes.includes(`FX-TCP-C${stamp}`) && !API.luis.lista.vigentes.includes(`FX-TCP-C${stamp}`) && API.ana.ind.vigentes > API.luis.ind.vigentes - 0 && API.luis.lista.vigentes.includes(`FX-TCP-I${stamp}`));
check("el Técnico Analista tiene al menos una lectura pendiente (la del vigente distribuido)", API.luis.ind.lecturas_mias >= 1, `${API.luis.ind.lecturas_mias}`);
check("el próximo a revisar (en 10 días) cuenta en «Próximos a revisar» y el borrador en «En revisión» (para Mejora Continua)", API.ana.lista.proximos_revision.includes(`FX-TCP-I${stamp}`) && API.ana.lista.en_curso.includes(`FX-TCP-B${stamp}`) && !API.ana.lista.en_curso.includes(`FX-TCP-I${stamp}`));

const browser = await chromium.launch({ executablePath, headless: true });
const paso = async (quien, nombre, fn, opciones = {}) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opciones });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  try {
    await page.goto(`${BASE}/login`);
    await page.fill("#login-email", EMAIL[quien]);
    await page.fill("#login-password", credenciales[EMAIL[quien]]);
    await page.click("button[type=submit]");
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 });
    await fn(page);
  } catch (error) {
    await page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), "fail-documentos-inicio.png"), fullPage: true }).catch(() => {});
    check(`${quien} · ${nombre}: sin errores`, false, error.message.split("\n")[0]);
  } finally {
    await context.close();
  }
};
const indicador = (page, clave) => page.locator(`[data-indicador="${clave}"]`);
const abrirInicio = async (page) => {
  await page.goto(`${BASE}/documentos`);
  await page.getByTestId("sgc-indicadores").waitFor();
  // El número se anima: se espera a que llegue a su valor.
  await page.waitForFunction(() => [...document.querySelectorAll("[data-indicador]")].every((el) => el.querySelector("[aria-hidden=true].tnum")?.textContent?.replace(/\D/g, "") === el.getAttribute("data-valor")));
};

for (const quien of ["ana", "luis"]) {
  const a = API[quien];
  await paso(quien, "números y clics", async (page) => {
    await abrirInicio(page);
    const enPantalla = {};
    for (const clave of ["vigentes", "en_curso", "proximos_revision", "lecturas_mias"]) enPantalla[clave] = Number(await indicador(page, clave).getAttribute("data-valor"));
    check(`${quien}: los cuatro números de la pantalla coinciden con la API`, INDICADORES.every((x) => enPantalla[x.clave] === a.lista[x.clave].length) && enPantalla.lecturas_mias === a.lecturas, JSON.stringify(enPantalla));
    const orden = await page.evaluate(() => {
      const ind = document.querySelector('[data-testid="sgc-indicadores"]');
      const carpetas = document.querySelector('[data-testid="sgc-carpetas"]');
      return !!ind && !!carpetas && ind.getBoundingClientRect().bottom <= carpetas.getBoundingClientRect().top;
    });
    check(`${quien}: los indicadores van arriba de las carpetas`, orden);
    // En 0: tono neutro (no se oculta).
    const ceros = await page.evaluate(() => [...document.querySelectorAll("[data-indicador]")].filter((el) => el.getAttribute("data-valor") === "0").map((el) => ({ visible: el.getBoundingClientRect().height > 0, neutro: !!el.querySelector(".bg-surface-3") })));
    check(`${quien}: los indicadores en 0 se ven, en tono neutro`, ceros.every((c) => c.visible && c.neutro), `${ceros.length} en 0`);
    for (const x of INDICADORES) {
      await abrirInicio(page);
      await indicador(page, x.clave).click();
      await page.waitForURL((u) => u.pathname === "/documentos/explorar" && u.searchParams.get("estado") === x.filtro);
      const esperado = a.lista[x.clave].length;
      if (esperado) await page.getByTestId("sgc-tarjetas").waitFor();
      else await page.getByTestId("sgc-vacio").waitFor();
      await page.waitForFunction((n) => document.querySelectorAll('[data-testid="sgc-tarjeta"]').length === n, esperado, { timeout: 15_000 }).catch(() => {});
      const tarjetas = await page.getByTestId("sgc-tarjeta").count();
      check(`${quien}: «${x.clave}» lleva a la lista con estado=${x.filtro} y ${esperado} documento(s)`, tarjetas === esperado, `${tarjetas}/${esperado}`);
    }
    await abrirInicio(page);
    await indicador(page, "lecturas_mias").click();
    await page.waitForURL((u) => u.pathname === "/documentos/bandeja" && u.hash === "#lecturas");
    let enLecturas = true;
    if (a.lecturas) {
      await page.getByTestId("bandeja-lecturas").waitFor();
      await page.waitForFunction(() => {
        const r = document.getElementById("lecturas")?.getBoundingClientRect();
        return !!r && r.top < window.innerHeight && r.bottom > 0;
      }, null, { timeout: 5000 }).catch(() => (enLecturas = false));
      enLecturas = enLecturas && (await page.getByTestId("bandeja-lectura").count()) === a.lecturas;
    }
    check(`${quien}: «Mis lecturas pendientes» lleva a la Bandeja, en «Lecturas pendientes» (${a.lecturas})`, enLecturas);
  });
}

/* ---------- Tamaños y tema ---------- */
for (const [ancho, alto, tema] of [
  [1440, 900, "light"],
  [820, 1180, "dark"],
  [400, 860, "light"],
  [400, 860, "dark"],
]) {
  await paso(
    "ana",
    `${ancho} px ${tema}`,
    async (page) => {
      await abrirInicio(page);
      await page.waitForTimeout(600);
      const m = await page.evaluate(() => {
        const ancho = document.documentElement.clientWidth;
        const tiles = [...document.querySelectorAll("[data-indicador]")].map((el) => el.getBoundingClientRect());
        const filas = new Set(tiles.map((r) => Math.round(r.top))).size;
        const fuera = [...document.querySelectorAll('[data-testid="sgc-indicadores"] *')].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.right > ancho + 1 || r.left < -1;
        }).length;
        // Texto cortado dentro de un indicador (desborda su caja).
        const cortado = [...document.querySelectorAll("[data-indicador]")].some((el) => el.scrollWidth > el.clientWidth + 1);
        return { scroll: document.documentElement.scrollWidth - ancho, filas, fuera, cortado };
      });
      const filasEsperadas = ancho === 400 ? 2 : 1;
      if (process.env.CAPTURAS_DIR) await page.screenshot({ path: path.join(process.env.CAPTURAS_DIR, `inicio-${ancho}-${tema}.png`) });
      check(`${ancho} px (${tema}): ${filasEsperadas === 2 ? "2×2" : "una fila"} sin desbordes`, m.scroll <= 0 && m.filas === filasEsperadas && m.fuera === 0 && !m.cortado, JSON.stringify(m));
    },
    { viewport: { width: ancho, height: alto }, colorScheme: tema },
  );
}

/* ---------- Movimiento reducido: el número aparece directo ---------- */
await paso(
  "ana",
  "movimiento reducido",
  async (page) => {
    await page.goto(`${BASE}/documentos`);
    const el = indicador(page, "vigentes");
    await el.waitFor();
    await page.waitForTimeout(60);
    const valor = await el.getAttribute("data-valor");
    const texto = (await el.locator("[aria-hidden=true].tnum").innerText()).replace(/\D/g, "");
    check("con prefers-reduced-motion el número aparece sin animar", texto === valor, `${texto}/${valor}`);
  },
  { reducedMotion: "reduce" },
);

await browser.close();
terminar();
