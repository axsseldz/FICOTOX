/*
 * Etiquetas imprimibles: una recepcion de lote con 3 muestras genera una
 * etiqueta por muestra (y por copia) con el folio R y el ID interno; cada
 * tamaño se imprime en hoja carta en cuadrícula: 3 muestras × 2 copias son 1
 * hoja en pequeña, mediana y grande, y 3 en media hoja, tanto en la vista
 * previa como en el PDF de impresión (page.pdf con @page carta). "Imprimir"
 * deja en la bitacora "imprimir_etiquetas" (window.print se sustituye).
 */
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const BASE = process.env.BASE || "http://localhost:3100";
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const stamp = Date.now().toString().slice(-6);
const api = async (method, ruta, body, token) => {
  const res = await fetch(`${BASE}/api${ruta}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};

const token = (await api("POST", "/auth/login", { email: "qa@ficotox.local", password: "QaFicotox2026!" })).data?.token;
const ids = [`ETQ-${stamp}-A`, `ETQ-${stamp}-B`, `ETQ-${stamp}-C`];
const creada = await api(
  "POST",
  "/samples/reception",
  {
    fecha_recepcion: "2026-09-07",
    hora_recepcion: "10:00",
    recibido_por: "QA",
    medio_recepcion: "directa",
    solicitante: "Cliente etiquetas",
    muestra_unica: false,
    lote_muestras: [
      { id_interno: ids[0], nombre_organismo: "Mejillón", fecha_muestra: "2026-09-05" },
      { id_interno: ids[1], nombre_organismo: "Ostión", fecha_muestra: "2026-09-06" },
      { id_interno: ids[2], nombre_organismo: "Almeja", fecha_muestra: "2026-09-06" },
    ],
    analisis: { tipos: ["toxinas_lipofilicas"], metodos: ["cromatografia_liquidos"], tipos_muestra: ["organismo_completo"] },
    datos_custodio: { lugar_resguardo: "congelador", lugar_otro: "CO1" },
  },
  token,
);
check("recepcion de lote con 3 muestras creada", creada.status === 201 && !!creada.data?.id, `${creada.status} ${creada.data?.message || ""}`);
const recepcionId = creada.data?.id;

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
await context.addInitScript(() => {
  window.print = () => {
    window.__impreso = true;
  };
});
const page = await context.newPage();
page.setDefaultTimeout(45_000);
try {
  await page.goto(`${BASE}/login`);
  await page.fill("#login-email", "qa@ficotox.local");
  await page.fill("#login-password", "QaFicotox2026!");
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  await page.goto(`${BASE}/muestras/recepcion/${recepcionId}/etiquetas`);
  await page.locator("#etiquetas-impresion [data-etiqueta]").first().waitFor();
  await page.selectOption("#et-tamano", "pequena");
  let etiquetas = await page.locator("#etiquetas-impresion [data-etiqueta]").allTextContents();
  check("una etiqueta por muestra del lote (3)", etiquetas.length === 3, String(etiquetas.length));
  check("pequeña: folio R, ID interno y fecha de recepción", etiquetas.every((t) => /R \d{7}/.test(t)) && etiquetas[0].includes(ids[0]) && etiquetas[2].includes(ids[2]) && etiquetas[0].includes("07/09/2026") && !etiquetas[0].includes("Mejillón"), etiquetas.join(" | ").slice(0, 200));
  await page.selectOption("#et-tamano", "mediana");
  etiquetas = await page.locator("#etiquetas-impresion [data-etiqueta]").allTextContents();
  check("mediana: además organismo, muestreo y resguardo", etiquetas[0].includes("Mejillón") && etiquetas[0].includes("05/09/2026") && etiquetas[0].includes("07/09/2026") && etiquetas[0].includes("Congelador CO1"), etiquetas[0]);

  // 3 muestras × 2 copias por tamaño: hojas en la vista previa y páginas del PDF impreso.
  await page.fill("#et-copias", "2");
  const esperadas = { pequena: 1, mediana: 1, grande: 1, media_hoja: 3 };
  for (const [tamano, hojas] of Object.entries(esperadas)) {
    await page.selectOption("#et-tamano", tamano);
    await page.waitForTimeout(150);
    const vista = await page.locator("#etiquetas-impresion .hoja-etiquetas").count();
    const n = await page.locator("#etiquetas-impresion [data-etiqueta]").count();
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const paginas = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
    check(`${tamano}: 6 etiquetas en ${hojas} ${hojas === 1 ? "hoja" : "hojas"} carta (vista previa y PDF)`, n === 6 && vista === hojas && paginas === hojas, `etiquetas ${n} · vista ${vista} · pdf ${paginas}`);
  }
  // Empezar en la posición N: deja vacías las anteriores.
  await page.selectOption("#et-tamano", "pequena");
  await page.fill("#et-inicio", "39");
  check("empezar en la posición 39 de 40: 6 etiquetas pasan a una segunda hoja", (await page.locator("#etiquetas-impresion .hoja-etiquetas").count()) === 2 && (await page.locator("#etiquetas-impresion .hoja-etiquetas").first().locator(".etiqueta-vacia").count()) === 38);
  await page.fill("#et-inicio", "1");
  // El texto nunca se desborda: ninguna línea más ancha que su etiqueta.
  const desborda = await page.evaluate(() => [...document.querySelectorAll("#etiquetas-impresion [data-etiqueta] > div")].some((d) => d.scrollWidth > d.parentElement.clientWidth + 1 && getComputedStyle(d).textOverflow !== "ellipsis"));
  check("el texto se recorta con «…» en lugar de desbordarse", !desborda);
  await page.reload();
  await page.locator("#etiquetas-impresion [data-etiqueta]").first().waitFor();
  check("recuerda el último tamaño elegido", (await page.locator("#et-tamano").inputValue()) === "pequena");

  await page.getByRole("button", { name: "Imprimir" }).click();
  await page.waitForFunction(() => window.__impreso === true);
  const bitacora = await api("GET", `/audit?entidad=muestras_recepcion&entidad_id=${recepcionId}&accion=imprimir_etiquetas`, undefined, token);
  const items = bitacora.data?.items || [];
  check("imprimir deja 'imprimir_etiquetas' en la bitacora", items.some((i) => i.accion === "imprimir_etiquetas"), `${bitacora.status} ${items.length}`);
} catch (error) {
  check("recorrido de etiquetas", false, error.message);
  await page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), "fail.png"), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
