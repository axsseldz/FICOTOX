/*
 * Animaciones de la plataforma en el navegador (datos de apoyo por la API). Sin depender de tiempos
 * frágiles: se leen las animaciones con document.getAnimations() y se espera su `finished` (o los
 * eventos animationend / transitionend) con un margen amplio.
 * - Entradas: carpetas del inicio, encabezado de la carpeta, tarjetas, miniaturas, renglones de la
 *   Bandeja, Solicitudes, Externos, Lista Maestra y otras listas (Reactivos): corren, se escalonan y
 *   terminan visibles (opacidad 1, sin desplazamiento);
 * - al pasar el cursor: la carpeta se levanta (translate) y se abre (cruce de opacidad); la tarjeta se eleva;
 * - contadores (Conteo) de carpetas, grupos de la Bandeja, subitem del menú y avance de lecturas: cuentan
 *   y terminan en su valor; la barra del avance avanza con transform;
 * - ficha: etiqueta de estado, pestañas deslizantes, barra del visor (aparece y se oculta con
 *   opacidad y translate), menú ⋯ y confirmación con check que se dibuja y se va sola;
 * - ventanas: VentanaFormulario (entrada; al cerrar se desmonta sin dejar restos), «Más opciones»,
 *   VentanaCentrada y el diálogo de confirmación (entran animadas y al cerrar se quitan por completo);
 * - pantalla de acceso: entrada, olas, sacudida con contraseña errónea;
 * - solo se animan opacity y transform (keyframes de toda la hoja y transiciones en pantalla, salvo
 *   los pliegues que el usuario abre: menú lateral y acordeones); sin saltos de diseño al cargar;
 * - con prefers-reduced-motion: reduce, todo se apaga (duración ~0, sin transiciones, sin conteo,
 *   y las ventanas se quitan sin dejar nada); sin errores de consola.
 */
import "../lib/reauth-auto.mjs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const BASE = process.env.BASE || "http://localhost:3100";
process.env.BASE = `${BASE}/api`;
const { api, credenciales, crearCheck, EMAIL, sesiones } = await import("../lib/calidad.mjs");
const { pdfConTexto } = await import("../lib/archivos.mjs");
const { principal } = await import("../lib/ficha.mjs");
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const { check, terminar } = crearCheck();
const stamp = Date.now().toString(36).slice(-4).toUpperCase();
const { t, id } = await sesiones();
const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana" }).format(new Date());
// Hoy (en Tijuana) más n días de calendario (sumar n × 24 h fallaba el día del cambio de horario).
const enDias = (n) => {
  const [anio, mes, dia] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana" }).format(new Date()).split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia + n)).toISOString().slice(0, 10);
};

/* ---------- Datos de apoyo ---------- */
const responsables = { elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.patricia };
async function ficha(campos) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
  fd.append("archivo_pdf", new Blob([await pdfConTexto(2, campos.titulo)]), "doc.pdf");
  return (await api("POST", "/sgc/documentos", fd, t.ana)).data;
}
const vigente = async (letra) => {
  const d = await ficha({ clave: `FX-THF-${letra}${stamp}`, titulo: `Formato animado ${letra} ${stamp}`, area_codigo: "TH", tipo_codigo: "F", ...responsables });
  await api("POST", `/sgc/revisiones/${d.revision_id}/registrar-vigente`, { fecha_emision: "2025-02-01", fecha_proxima_revision: "2028-02-01" }, t.ana);
  return d;
};
// Tres vigentes en TH: la carpeta cuenta al menos hasta 3 (y la carpeta tiene tarjetas con miniatura).
await vigente("A");
await vigente("B");
await vigente("C");
// L: vigente distribuido a Luis y Mariana con lectura requerida (avance 0 de 2, y Luis confirma).
const L = await ficha({ clave: `FX-TCI-L${stamp}`, titulo: `Instrucción animada ${stamp}`, area_codigo: "TC", tipo_codigo: "I", ...responsables });
await api("POST", `/sgc/revisiones/${L.revision_id}/registrar-vigente`, { fecha_emision: "2025-02-01", fecha_proxima_revision: "2028-02-01" }, t.ana);
await api("POST", `/sgc/revisiones/${L.revision_id}/distribucion`, { usuarios: [id.luis, id.mariana], punto_uso: "Laboratorio", requiere_lectura: true, motivo: "Distribución de la prueba de animaciones" }, t.ana);
// Segunda lectura para Luis (la Bandeja tiene renglones aunque confirme la primera).
const L2 = await ficha({ clave: `FX-TCI-M${stamp}`, titulo: `Instrucción por leer ${stamp}`, area_codigo: "TC", tipo_codigo: "I", ...responsables });
await api("POST", `/sgc/revisiones/${L2.revision_id}/registrar-vigente`, { fecha_emision: "2025-02-01", fecha_proxima_revision: "2028-02-01" }, t.ana);
await api("POST", `/sgc/revisiones/${L2.revision_id}/distribucion`, { usuarios: [id.luis], punto_uso: "Laboratorio", requiere_lectura: true, motivo: "Distribución de la prueba de animaciones" }, t.ana);
// Solicitud de Luis y un externo (renglones de Solicitudes y Externos).
await api("POST", "/sgc/solicitudes", { tipo: "cambio", documento_id: L.id, justificacion: `Actualizar la instrucción animada ${stamp}` }, t.luis);
{
  const fd = new FormData();
  const campos = { identificador: `NMX-${stamp}-ANIM`, titulo: `Norma animada ${stamp}`, area_codigo: "GC", tipo_codigo: "R", fuente: "IMNC", version_fecha: "2018", responsable_id: id.ricardo, ultima_verificacion: hoy, proxima_revision: enDias(365) };
  for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
  await api("POST", "/sgc/externos", fd, t.ana);
}

/* ---------- Grabadora en la página: eventos de animación, saltos de diseño y contadores ---------- */
const GRABADORA = () => {
  window.__ev = [];
  window.__ls = [];
  window.__conteos = {};
  for (const tipo of ["animationstart", "animationend", "transitionrun", "transitionend"])
    document.addEventListener(
      tipo,
      (e) => {
        const el = e.target;
        if (!(el instanceof Element)) return;
        window.__ev.push({ tipo, nombre: e.animationName || e.propertyName, testid: el.closest("[data-testid]")?.getAttribute("data-testid") || "", clase: String(el.className?.baseVal ?? el.className ?? "") });
      },
      true,
    );
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__ls.push(e.value);
    }).observe({ type: "layout-shift", buffered: true });
  } catch {
    /* sin layout-shift */
  }
  const CONTADOR = '[data-testid="sgc-carpeta-vigentes"], [data-testid="bandeja-contador"], [data-contador], [data-testid="dist-avance"]';
  new MutationObserver((ms) => {
    for (const m of ms) {
      const el = m.target instanceof Element ? m.target : m.target.parentElement;
      const c = el?.closest?.(CONTADOR);
      if (!c) continue;
      const k = `${c.getAttribute("data-testid") || "menu"}:${c.closest("[data-area]")?.getAttribute("data-area") || c.getAttribute("data-contador") || c.closest("[data-grupo]")?.getAttribute("data-grupo") || ""}`;
      const v = c.querySelector('.tnum[aria-hidden="true"]')?.textContent ?? c.textContent;
      const lista = (window.__conteos[k] ||= []);
      if (lista.at(-1) !== v) lista.push(v);
    }
  }).observe(document, { subtree: true, childList: true, characterData: true });
};

/* Animaciones de los elementos que cumplen `sel` (nombre, propiedades de sus keyframes, duración, retraso, estado). */
const animaciones = (page, sel) =>
  page.evaluate(
    (sel) =>
      document
        .getAnimations()
        .filter((a) => a.effect?.target instanceof Element && a.effect.target.matches(sel))
        .map((a) => {
          const t = a.effect.getComputedTiming();
          return { tipo: a.constructor.name, nombre: a.animationName || a.transitionProperty, props: [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k)))].filter((p) => !["offset", "computedOffset", "easing", "composite"].includes(p)), dur: t.duration, delay: t.delay, iter: t.iterations, estado: a.playState };
        }),
    sel,
  );
/* Espera a que terminen (margen amplio) las animaciones finitas de `sel`; true si todas terminaron. */
const terminan = (page, sel) =>
  page.evaluate(async (sel) => {
    const xs = document.getAnimations().filter((a) => a.effect?.target instanceof Element && a.effect.target.matches(sel) && a.effect.getComputedTiming().iterations !== Infinity);
    await Promise.race([Promise.all(xs.map((a) => a.finished.catch(() => null))), new Promise((r) => setTimeout(r, 8000))]);
    return xs.length > 0 && xs.every((a) => a.playState === "finished");
  }, sel);
/* Estado final: visible y sin desplazamiento. */
const enReposo = (page, sel) =>
  page.evaluate(
    (sel) =>
      [...document.querySelectorAll(sel)].every((el) => {
        const cs = getComputedStyle(el);
        return Number(cs.opacity) === 1 && (cs.transform === "none" || cs.transform === "matrix(1, 0, 0, 1, 0, 0)");
      }),
    sel,
  );
const soloCompositables = (lista) => lista.every((a) => a.props.every((p) => ["opacity", "transform", "translate", "scale", "rotate"].includes(p)));
/* Entrada escalonada completa: rise-in, solo opacity/transform, retrasos crecientes, termina en reposo. */
async function entrada(page, nombre, sel) {
  await page.locator(sel).first().waitFor();
  const xs = (await animaciones(page, sel)).filter((a) => a.tipo === "CSSAnimation");
  const delays = xs.map((a) => a.delay);
  const escalonada = xs.length < 2 || (delays.every((d, i) => i === 0 || d >= delays[i - 1]) && delays.at(-1) > delays[0]);
  check(`${nombre}: entrada escalonada (rise-in, solo opacity/transform)`, xs.length > 0 && xs.every((a) => a.nombre === "rise-in" && a.dur > 100) && soloCompositables(xs) && escalonada, JSON.stringify(xs.slice(0, 3)));
  check(`${nombre}: la entrada termina visible y en su lugar`, (await terminan(page, sel)) && (await enReposo(page, sel)));
}
const eventos = (page) => page.evaluate(() => window.__ev);
const limpiar = (page) =>
  page.evaluate(() => {
    window.__ev = [];
    window.__ls = [];
    window.__conteos = {};
  });
const esperarEvento = (page, filtro, timeout = 8000) => page.waitForFunction(filtro, null, { timeout, polling: 50 }).then(() => true, () => false);
const saltos = (page) => page.evaluate(() => window.__ls.reduce((s, v) => s + v, 0));
/* Conteo: termina en su valor; con animación pasa por valores intermedios crecientes. */
const conteo = (page, clave) => page.evaluate((k) => (window.__conteos[k] || []).map((v) => Number(String(v).replace(/\D/g, "") || 0)), clave);
const crece = (xs) => xs.every((v, i) => i === 0 || v >= xs[i - 1]);

/* Propiedades de diseño en transiciones con duración (salvo los pliegues que abre el usuario: menú lateral, acordeones y el ancho de la ventana centrada). */
const transicionesDeDiseno = (page) =>
  page.evaluate(() => {
    const DISENO = /^(width|height|min-width|min-height|max-width|max-height|top|left|right|bottom|inset|margin.*|padding.*|border-width|border-.*-width|grid-template-.*|gap|row-gap|column-gap|font-size|line-height|all)$/;
    const PLIEGUES = [
      [/^width$/, 'aside[aria-label="Navegación principal"]'],
      [/^grid-template-rows$/, "*"],
      [/^max-width$/, '[role="dialog"]'],
    ];
    const fuera = [];
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      const props = cs.transitionProperty.split(",").map((s) => s.trim());
      const durs = cs.transitionDuration.split(",").map((s) => parseFloat(s) * (s.trim().endsWith("ms") ? 1 : 1000));
      props.forEach((p, i) => {
        if (!(durs[i % durs.length] > 0) || !DISENO.test(p)) return;
        if (PLIEGUES.some(([re, sel]) => re.test(p) && el.matches(sel))) return;
        fuera.push(`${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className).slice(0, 60)}: ${p}`);
      });
    }
    return fuera;
  });
/* Keyframes de todas las hojas de estilo: solo opacity y transform (y el trazo del check, que es un dibujo SVG). */
const keyframesDeDiseno = (page) =>
  page.evaluate(() => {
    const fuera = [];
    const PERMITIDAS = /^(opacity|transform|translate|scale|rotate|stroke-dashoffset|animation-timing-function)$/;
    const recorrer = (reglas) => {
      for (const r of reglas) {
        if (r instanceof CSSKeyframesRule) {
          for (const k of r.cssRules) for (let i = 0; i < k.style.length; i++) if (!PERMITIDAS.test(k.style[i]) && !k.style[i].startsWith("--")) fuera.push(`${r.name}: ${k.style[i]}`);
        } else if (r.cssRules) recorrer(r.cssRules);
      }
    };
    for (const hoja of document.styleSheets) {
      try {
        recorrer(hoja.cssRules);
      } catch {
        /* hoja de otro origen */
      }
    }
    return [...new Set(fuera)];
  });

const browser = await chromium.launch({ executablePath, headless: true });
const consoleErrors = [];
const nueva = async (opciones = {}) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, ...opciones });
  await context.addInitScript(GRABADORA);
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/Failed to load resource|status of 40[0-9]/.test(msg.text())) consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
  return { context, page };
};
const entrar = async (page, quien) => {
  const email = quien === "qa" ? "qa@ficotox.local" : EMAIL[quien];
  await page.goto(`${BASE}/login`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", quien === "qa" ? "QaFicotox2026!" : credenciales[email]);
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 });
};
const captura = async (page, nombre) => page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), `fail-${nombre.replace(/[^a-z]/gi, "").slice(0, 24)}.png`), fullPage: true }).catch(() => {});
const paso = async (quien, nombre, fn, opciones) => {
  const { context, page } = await nueva(opciones);
  try {
    if (quien) await entrar(page, quien);
    await fn(page, context);
  } catch (err) {
    await captura(page, nombre);
    check(nombre, false, err instanceof Error ? err.message.split("\n")[0] : String(err));
  } finally {
    await context.close();
  }
};
const disenoEnPantallas = [];

try {
  /* ---------- Pantalla de acceso ---------- */
  await paso(null, "acceso", async (page) => {
    await page.goto(`${BASE}/login`);
    await page.locator(".acceso-tarjeta").waitFor();
    const xs = await animaciones(page, ".acceso-panel, .acceso-logo, .acceso-entra, .acceso-fondo-entra, .acceso-tarjeta, .acceso-ola");
    const nombres = new Set(xs.map((a) => a.nombre));
    check("acceso: entrada del panel, logo, títulos, fondo y tarjeta, y olas en movimiento", ["fade-in", "acceso-logo-entra", "rise-in", "acceso-ola", "acceso-flota"].every((n) => nombres.has(n)) && xs.filter((a) => a.nombre === "acceso-ola").every((a) => a.iter === Infinity && a.estado === "running") && soloCompositables(xs), [...nombres].join(","));
    check("acceso: la entrada termina visible", (await terminan(page, ".acceso-entra, .acceso-tarjeta, .acceso-panel")) && (await enReposo(page, ".acceso-entra, .acceso-tarjeta")));
    await limpiar(page);
    await page.fill("#login-email", EMAIL.luis);
    await page.fill("#login-password", "contraseña-equivocada");
    await page.click("button[type=submit]");
    check("acceso: con contraseña errónea la tarjeta se sacude (solo transform)", await esperarEvento(page, () => window.__ev.some((e) => e.tipo === "animationend" && e.nombre === "acceso-niega")));
    check("acceso: sin saltos de diseño al cargar", (await saltos(page)) < 0.01);
  });

  /* ---------- Inicio, carpeta y tarjetas ---------- */
  await paso("luis", "inicio y carpeta", async (page) => {
    await page.goto(`${BASE}/documentos`);
    await entrada(page, "inicio: carpetas", '[data-testid="sgc-carpetas"] > li');
    const valor = Number(await page.locator('[data-testid="sgc-carpeta"][data-area="TH"] [data-testid="sgc-carpeta-vigentes"]').getAttribute("data-valor"));
    await page.waitForFunction((v) => document.querySelector('[data-testid="sgc-carpeta"][data-area="TH"] [data-testid="sgc-carpeta-vigentes"] .tnum[aria-hidden="true"]')?.textContent === String(v), valor);
    const serie = await conteo(page, "sgc-carpeta-vigentes:TH");
    check("inicio: el número de vigentes cuenta hasta su valor", valor >= 3 && serie.at(-1) === valor && crece(serie) && serie.length >= 2, `${serie.join("→")} (valor ${valor})`);
    // Al pasar el cursor: se levanta (translate) y la carpeta se abre (cruce de opacidad).
    await limpiar(page);
    const carpeta = page.locator('[data-testid="sgc-carpeta"][data-area="TH"]');
    await carpeta.hover();
    const termina = await esperarEvento(page, () => window.__ev.some((e) => e.tipo === "transitionend" && e.testid === "sgc-carpeta" && e.nombre === "translate"));
    const ev = await eventos(page);
    const abierta = await carpeta.locator("svg").evaluateAll((xs) => xs.map((x) => getComputedStyle(x).opacity));
    check("carpeta al pasar el cursor: se levanta con translate (transición que corre y termina)", termina && ev.some((e) => e.tipo === "transitionrun" && e.nombre === "translate" && e.testid === "sgc-carpeta"), ev.map((e) => `${e.tipo}:${e.nombre}`).join(","));
    check("carpeta al pasar el cursor: la carpeta se abre (cruce de opacidad entre los iconos)", ev.filter((e) => e.nombre === "opacity" && e.tipo === "transitionrun" && e.testid === "sgc-carpeta").length >= 2 && abierta.includes("1") && abierta.includes("0"), abierta.join(","));
    check("carpeta: levantada 2 px al terminar", await carpeta.evaluate((el) => parseFloat(getComputedStyle(el).translate.split(" ")[1] || "0") === -2));
    disenoEnPantallas.push(...(await transicionesDeDiseno(page)));
    // Entrar a la carpeta: el encabezado entra suave y las tarjetas se escalonan; las miniaturas aparecen con opacidad.
    await limpiar(page);
    await carpeta.click();
    await page.getByTestId("sgc-carpeta-encabezado").waitFor();
    const enc = await animaciones(page, '[data-testid="sgc-carpeta-encabezado"]');
    check("carpeta: el encabezado entra con carpeta-entra (solo opacity/transform) y termina en reposo", enc.some((a) => a.nombre === "carpeta-entra") && soloCompositables(enc) && (await terminan(page, '[data-testid="sgc-carpeta-encabezado"]')) && (await enReposo(page, '[data-testid="sgc-carpeta-encabezado"]')));
    await entrada(page, "carpeta: tarjetas", '[data-testid="sgc-tarjetas"] > li');
    const mini = page.locator('[data-testid="sgc-tarjeta"][data-clave^="FX-THF-"] img.miniatura-entrada').first();
    await mini.waitFor({ timeout: 60_000 });
    const minis = await animaciones(page, "img.miniatura-entrada");
    check("miniaturas: aparecen con fade-in y terminan opacas", minis.length > 0 && minis.every((a) => a.nombre === "fade-in" && a.props.join() === "opacity") && (await terminan(page, "img.miniatura-entrada")) && (await enReposo(page, "img.miniatura-entrada")));
    await limpiar(page);
    const tarjeta = page.locator('[data-testid="sgc-tarjeta"][data-clave^="FX-THF-"]').first();
    await tarjeta.hover();
    check("tarjeta al pasar el cursor: se eleva con translate", await esperarEvento(page, () => window.__ev.some((e) => e.tipo === "transitionend" && e.testid === "sgc-tarjeta" && e.nombre === "translate")));
    check("carpeta: sin saltos de diseño al cargar (tarjetas y miniaturas)", (await saltos(page)) < 0.02, String(await saltos(page)));
    disenoEnPantallas.push(...(await transicionesDeDiseno(page)));
  });

  /* ---------- Ficha: estado, pestañas, visor, menú y confirmación con check ---------- */
  await paso("luis", "ficha", async (page) => {
    await page.goto(`${BASE}/documentos/${L.id}`);
    await page.getByTestId("sgc-ficha").waitFor();
    const estado = await animaciones(page, ".transicion-estado");
    check("ficha: la etiqueta de estado entra con estado-entra (solo opacity/transform)", estado.some((a) => a.nombre === "estado-entra" && a.dur >= 150) && soloCompositables(estado) && (await terminan(page, ".transicion-estado")) && (await enReposo(page, ".transicion-estado")));
    await page.locator('[data-testid="sgc-visor"] canvas').first().waitFor({ timeout: 60_000 });
    // La barra del visor aparece al cargar y se oculta sola: opacidad y translate.
    const barra = await esperarEvento(page, () => ["opacity", "translate"].every((n) => window.__ev.some((e) => e.tipo === "transitionend" && e.testid === "visor-barra" && e.nombre === n)), 12_000);
    check("visor: la barra se muestra y se oculta con opacity y translate (corren y terminan)", barra, (await eventos(page)).filter((e) => e.testid === "visor-barra").map((e) => `${e.tipo}:${e.nombre}`).join(","));
    check("ficha: sin saltos de diseño al cargar (silueta del tamaño de la página)", (await saltos(page)) < 0.02, String(await saltos(page)));
    // Pestañas: el indicador se desliza con transform.
    const tabs = page.getByRole("tablist", { name: "Información del documento" });
    const indicador = tabs.locator("span[aria-hidden]").first();
    const antes = await indicador.evaluate((el) => el.style.transform);
    await limpiar(page);
    await tabs.getByRole("tab").nth(1).click();
    const desliza = await esperarEvento(page, () => window.__ev.some((e) => e.tipo === "transitionend" && e.nombre === "transform" && /transition-transform/.test(e.clase)));
    check("pestañas: el indicador se desliza (transform que corre y termina en la pestaña elegida)", desliza && (await indicador.evaluate((el) => el.style.transform)) !== antes && (await indicador.evaluate((el) => getComputedStyle(el).transitionProperty)) === "transform, translate, scale, rotate");
    // Menú ⋯: se materializa.
    await page.getByRole("button", { name: "Más acciones" }).click();
    await page.getByRole("menu").waitFor();
    const menu = await animaciones(page, '[role="menu"]');
    check("menú ⋯: entra con materialize (solo opacity/transform) y termina visible", menu.some((a) => a.nombre === "materialize") && soloCompositables(menu) && (await terminan(page, '[role="menu"]')) && (await enReposo(page, '[role="menu"]')));
    await page.keyboard.press("Escape");
    disenoEnPantallas.push(...(await transicionesDeDiseno(page)));
    // Confirmar lectura: diálogo de confirmación (entra y sale) y check que se dibuja y se va solo.
    check("ficha: acción principal «Confirmar lectura»", (await principal(page)) === "acuse-confirmar");
    await page.locator('[data-principal="1"][data-testid="acuse-confirmar"]').click();
    await page.getByRole("button", { name: "Confirmo", exact: true }).click();
    const marca = page.getByTestId("confirmacion-check");
    await marca.waitFor();
    const check1 = await animaciones(page, '[data-testid="confirmacion-check"], [data-testid="confirmacion-check"] .trazo-dibujado');
    check("confirmación: aparece y se va con confirmacion-entra, y el check se dibuja (trazo)", check1.some((a) => a.nombre === "confirmacion-entra" && a.props.every((p) => ["opacity", "transform"].includes(p))) && check1.filter((a) => a.nombre === "trazo").length === 2);
    // Las ventanas se quitan al cerrar sin retener su capa (retenerla cerraba el menú ⋯ que se abría justo después).
    check("diálogo de confirmación: al confirmar se quita por completo", await esperarEvento(page, () => !document.querySelector('[role="alertdialog"], [role="dialog"]')));
    await marca.waitFor({ state: "detached", timeout: 8000 });
    check("confirmación: se va sola", true);
  });

  /* ---------- Lecturas: avance con transform y números que cuentan ---------- */
  await paso("ana", "avance de lecturas", async (page) => {
    await page.goto(`${BASE}/documentos/${L.id}`);
    await page.getByTestId("sgc-ficha").waitFor();
    await page.getByRole("tab", { name: "Lecturas" }).click();
    const avance = page.getByTestId("dist-avance");
    await avance.waitFor();
    const porcentaje = Number(await avance.getAttribute("data-porcentaje"));
    const barra = avance.locator(".avance-barra");
    const medida = await barra.evaluate((el) => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return { dx: m.m41, ancho: el.getBoundingClientRect().width / Math.max(0.001, 1), riel: el.parentElement.getBoundingClientRect().width, prop: getComputedStyle(el).transitionProperty };
    });
    check("avance: la barra avanza con transform (sin animar el ancho) hasta su porcentaje", porcentaje === 50 && medida.prop === "transform" && Math.abs(medida.dx - (porcentaje / 100 - 1) * medida.riel) < 1.5, JSON.stringify(medida));
    await page.waitForFunction(() => /1 de 2 leídas \(50 %\)/.test(document.querySelector('[data-testid="dist-avance"]')?.textContent || ""));
    const serie = await conteo(page, "dist-avance:");
    check("avance: los números cuentan hasta su valor", serie.length >= 1 && serie.at(-1) === 1, serie.join("→"));
  });

  /* ---------- Bandeja, menú, Solicitudes, Externos, Lista Maestra ---------- */
  await paso("luis", "listas", async (page) => {
    await page.goto(`${BASE}/documentos/bandeja`);
    await entrada(page, "bandeja: renglones", '[data-testid="bandeja-tarea"], [data-testid="bandeja-lectura"]');
    const grupo = page.locator('[data-testid="bandeja-contador"]').first();
    const valor = Number(await grupo.getAttribute("data-valor"));
    await page.waitForFunction((v) => document.querySelector('[data-testid="bandeja-contador"] .tnum[aria-hidden="true"], [data-testid="bandeja-contador"] [aria-hidden="true"]')?.textContent === String(v), valor);
    const claves = await page.evaluate(() => Object.keys(window.__conteos));
    const g = claves.find((k) => k.startsWith("bandeja-contador:"));
    const serie = g ? await conteo(page, g) : [];
    check("bandeja: el contador del grupo cuenta hasta su valor", valor >= 1 && serie.at(-1) === valor && crece(serie), `${serie.join("→")} (valor ${valor})`);
    const total = (await api("GET", "/sgc/bandeja", undefined, t.luis)).data?.total;
    await page.waitForFunction((v) => document.querySelector('[data-contador="/documentos/bandeja"]')?.textContent === String(v), total);
    const menu = await conteo(page, "menu:/documentos/bandeja");
    check("menú: el contador de «Bandeja» cuenta hasta el total", menu.at(-1) === total && crece(menu), `${menu.join("→")} (total ${total})`);
    check("bandeja: sin saltos de diseño", (await saltos(page)) < 0.02, String(await saltos(page)));
    disenoEnPantallas.push(...(await transicionesDeDiseno(page)));

    await page.goto(`${BASE}/documentos/solicitudes`);
    await page.getByRole("tab", { name: "Todas" }).or(page.getByRole("radio", { name: "Todas" })).first().click();
    await entrada(page, "solicitudes: renglones", '[data-testid="sgc-solicitud"]');
    disenoEnPantallas.push(...(await transicionesDeDiseno(page)));
    // VentanaCentrada (detalle): entra con su animación y al cerrar se quita por completo.
    const fila = page.getByTestId("sgc-solicitud").filter({ hasText: `FX-TCI-L${stamp}` }).first();
    await fila.locator("button").first().click();
    await page.getByTestId("sgc-solicitud-detalle").waitFor();
    const det = await animaciones(page, '[role="dialog"]');
    check("ventana centrada: entra con pop-in y termina visible", det.some((a) => a.nombre === "pop-in") && (await terminan(page, '[role="dialog"]')) && (await enReposo(page, '[role="dialog"]')));
    await limpiar(page);
    await page.keyboard.press("Escape");
    await page.getByTestId("sgc-solicitud-detalle").waitFor({ state: "detached" });
    check("ventana centrada: al cerrar se quita por completo (sin velo)", (await page.locator('[role="dialog"]').count()) === 0);
    // VentanaFormulario: entrada, «Más opciones» y cierre (la ventana se desmonta al cerrar).
    await page.getByTestId("sgc-nueva-solicitud").click();
    const ventana = page.getByTestId("ventana-formulario");
    await ventana.waitFor();
    const va = await animaciones(page, '[data-testid="ventana-formulario"], [data-state="open"].fixed.inset-0');
    check("formulario en ventana: entra con fade-in (velo) y pop-in (ventana)", ["fade-in", "pop-in"].every((n) => va.some((a) => a.nombre === n)) && soloCompositables(va) && (await terminan(page, '[data-testid="ventana-formulario"]')) && (await enReposo(page, '[data-testid="ventana-formulario"]')));
    await limpiar(page);
    await ventana.getByRole("button", { name: /Más opciones/ }).click();
    const contenido = ventana.getByTestId("mas-opciones").locator("[id]").last();
    const mas = await animaciones(page, ".mas-opciones-entra");
    check("«Más opciones»: se despliega con sgc-entra (leve descenso) y la flecha gira", mas.some((a) => a.nombre === "sgc-entra") && soloCompositables(mas) && (await esperarEvento(page, () => window.__ev.some((e) => e.tipo === "transitionend" && e.nombre === "rotate" && e.testid === "mas-opciones"))) && (await contenido.isVisible()));
    await limpiar(page);
    await page.keyboard.press("Escape");
    await ventana.waitFor({ state: "detached" });
    // Quien la usa la desmonta al cerrar: se quita sin dejar restos (velo ni ventana) y la página queda usable.
    await page.waitForFunction(() => !document.querySelector('[data-testid="ventana-formulario"], [role="dialog"]'), null, { timeout: 5000 });
    check("formulario en ventana: al cerrar se quita por completo (sin velo ni capa)", (await page.getByTestId("ventana-formulario").count()) === 0 && (await page.locator("body > [inert]").count()) === 0 && (await page.getByTestId("sgc-nueva-solicitud").isEnabled()));

    await page.goto(`${BASE}/documentos/externos`);
    await entrada(page, "externos: renglones", '[data-testid="ext-fila"]');
    disenoEnPantallas.push(...(await transicionesDeDiseno(page)));
    await page.goto(`${BASE}/documentos/lista-maestra`);
    await entrada(page, "Lista Maestra: renglones", '[data-testid="lm-fila"]');
    check("Lista Maestra: sin saltos de diseño", (await saltos(page)) < 0.02, String(await saltos(page)));
    disenoEnPantallas.push(...(await transicionesDeDiseno(page)));
  });

  /* ---------- Otra lista de la plataforma (Reactivos): entrada y medidor ---------- */
  await paso("qa", "reactivos", async (page) => {
    await page.goto(`${BASE}/inventario/reactivos`);
    await entrada(page, "reactivos: renglones (ListaCuadricula)", "ul.divide-y > li.entrada-escalonada");
    const medidor = page.locator('[role="progressbar"] > div').first();
    await medidor.waitFor();
    check("medidor de existencia: la barra avanza con translate (sin animar el ancho)", await medidor.evaluate((el) => getComputedStyle(el).transitionProperty.split(", ").includes("translate") && !getComputedStyle(el).transitionProperty.includes("width") && Math.abs(el.getBoundingClientRect().width - el.parentElement.getBoundingClientRect().width) < 1));
    disenoEnPantallas.push(...(await transicionesDeDiseno(page)));
    const kf = await keyframesDeDiseno(page);
    check("keyframes de toda la hoja: solo opacity y transform", kf.length === 0, kf.join(" | "));
  });

  check("transiciones en pantalla: sin propiedades de diseño (ancho, alto, márgenes, posición)", disenoEnPantallas.length === 0, [...new Set(disenoEnPantallas)].slice(0, 5).join(" | "));

  /* ---------- Movimiento reducido ---------- */
  const todoQuieto = (page) => page.evaluate(() => document.getAnimations().filter((a) => a.effect.getComputedTiming().duration > 1 || a.effect.getComputedTiming().iterations === Infinity).map((a) => a.animationName || a.transitionProperty));
  await paso(
    null,
    "movimiento reducido: acceso",
    async (page) => {
      await page.goto(`${BASE}/login`);
      await page.locator(".acceso-tarjeta").waitFor();
      const vivas = await todoQuieto(page);
      check("reduced-motion: la pantalla de acceso no anima (ni olas ni logo)", vivas.length === 0, vivas.join(","));
      check("reduced-motion: la tarjeta de acceso queda visible", await enReposo(page, ".acceso-tarjeta"));
    },
    { reducedMotion: "reduce" },
  );
  await paso(
    "luis",
    "movimiento reducido: documentos",
    async (page) => {
      await page.goto(`${BASE}/documentos`);
      await page.locator('[data-testid="sgc-carpetas"] > li').first().waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="sgc-carpeta-vigentes"]')].every((c) => c.querySelector('.tnum[aria-hidden="true"]')?.textContent === c.getAttribute("data-valor")));
      let vivas = await todoQuieto(page);
      check("reduced-motion: inicio sin animaciones con duración", vivas.length === 0, vivas.join(","));
      const serie = await conteo(page, "sgc-carpeta-vigentes:TH");
      check("reduced-motion: los contadores muestran su valor sin contar", serie.filter((v) => v !== 0).length <= 1, serie.join("→"));
      await limpiar(page);
      await page.locator('[data-testid="sgc-carpeta"][data-area="TH"]').hover();
      await page.waitForTimeout(400);
      const ev = await eventos(page);
      check("reduced-motion: al pasar el cursor no hay transiciones", ev.filter((e) => e.tipo === "transitionrun").length === 0, ev.map((e) => e.nombre).join(","));
      await page.goto(`${BASE}/documentos/bandeja`);
      await page.locator('[data-testid="bandeja-lectura"], [data-testid="bandeja-tarea"]').first().waitFor();
      vivas = await todoQuieto(page);
      check("reduced-motion: Bandeja sin entrada escalonada ni animaciones con duración", vivas.length === 0 && (await page.locator('[data-testid="bandeja-lectura"], [data-testid="bandeja-tarea"]').first().evaluate((el) => getComputedStyle(el).animationName)) === "none", vivas.join(","));
      await page.goto(`${BASE}/documentos/solicitudes`);
      await page.getByTestId("sgc-nueva-solicitud").click();
      await page.getByTestId("ventana-formulario").waitFor();
      vivas = await todoQuieto(page);
      check("reduced-motion: la ventana abre sin animación con duración", vivas.length === 0, vivas.join(","));
      await limpiar(page);
      await page.keyboard.press("Escape");
      await page.getByTestId("ventana-formulario").waitFor({ state: "detached" });
      await page.waitForTimeout(300);
      check("reduced-motion: al cerrar la ventana no queda nada en pantalla", (await page.locator('[data-testid="ventana-formulario"], [role="dialog"]').count()) === 0 && (await page.locator("body > [inert]").count()) === 0);
      await page.goto(`${BASE}/documentos/${L2.id}`);
      await page.locator('[data-testid="sgc-visor"] canvas').first().waitFor({ timeout: 60_000 });
      vivas = await todoQuieto(page);
      check("reduced-motion: ficha y visor sin animaciones con duración", vivas.length === 0, vivas.join(","));
    },
    { reducedMotion: "reduce" },
  );
} finally {
  await browser.close();
}

check("sin errores de consola", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
terminar();
