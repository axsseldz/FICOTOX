/*
 * Documentos SGC, Fase 1, en el navegador:
 * - inicio con las seis carpetas (sigla, nombre y color HEX del area en la banda) y conteos;
 * - carpeta: ruta corta Documentos › Gestión, filtros por URL y documentos en tarjetas (sin vista de tabla);
 * - nueva ficha desde la interfaz (clave validada en el formulario, archivo inicial) y
 *   carga inicial con contrasena; el visor PDF muestra la vigente;
 * - nueva revision: la vigente sigue en la ficha; quien solo consulta vigentes no ve el borrador;
 * - el elaborador ve «cargar archivo» y, enviada a revision, el boton deshabilitado con su motivo;
 * - restringido: «no encontrado» por URL directa; admin tecnico en vista de diagnostico;
 * - editor de roles con las acciones documentales; Biblioteca redirige;
 * - modo oscuro y ancho de tableta sin desbordes; sin errores de consola.
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
const { accion, contarAccion, motivo, cerrarMenu } = await import("../lib/ficha.mjs");
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const { check, terminar } = crearCheck();
const stamp = Date.now().toString(36).slice(-4).toUpperCase();
const { t, id } = await sesiones();

/* ---------- Datos por la API ---------- */
async function ficha(token, campos, pdfTitulo) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) if (v !== undefined) fd.append(k, String(v));
  fd.append("archivo_pdf", new Blob([await pdfConTexto(2, pdfTitulo)]), `${pdfTitulo}.pdf`);
  return (await api("POST", "/sgc/documentos", fd, token)).data;
}
// Restringido vigente (para la URL directa) y uno en borrador asignado a Luis (para el boton con motivo).
const R = await ficha(t.ana, { clave: `FX-GCL-R${stamp}`, titulo: `Lista restringida UI ${stamp}`, area_codigo: "GC", tipo_codigo: "L", confidencialidad: "confidencial", elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.patricia }, "Restringida");
await api("POST", `/sgc/revisiones/${R.revision_id}/registrar-vigente`, { fecha_emision: "2026-05-01" }, t.ana);
const L = await ficha(t.ana, { clave: `FX-TCI-L${stamp}`, titulo: `Instrucción de Luis ${stamp}`, area_codigo: "TC", tipo_codigo: "I", elaborador_id: id.luis, revisor_id: id.ricardo, autorizador_id: id.patricia, apartados_afectados: "Todo el documento", descripcion_cambio: "Emisión inicial de la instrucción" }, "Instruccion");

const browser = await chromium.launch({ executablePath, headless: true });
const consoleErrors = [];
const nueva = async (opciones = {}) => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, ...opciones });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/Failed to load resource|status of 40[34]/.test(msg.text())) consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
  return { context, page };
};
const entrar = async (page, quien) => {
  const email = EMAIL[quien];
  await page.goto(`${BASE}/login`);
  await page.fill("#login-email", email);
  await page.fill("#login-password", credenciales[email]);
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
};
const captura = async (page) => page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), "fail.png"), fullPage: true }).catch(() => {});
const rgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
const COLORES = { GC: "#9852B0", TH: "#913B0B", AD: "#E53BB9", CO: "#E36A10", TC: "#429B4B", DI: "#217FCB" };
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
let docUi = null;

try {
  /* ---------- Mejora Continua: carpetas, explorador, nueva ficha, carga inicial, nueva revision ---------- */
  {
    const { context, page } = await nueva();
    try {
      await entrar(page, "ana");
      await page.goto(`${BASE}/documentos`);
      await page.getByTestId("sgc-carpetas").waitFor();
      const carpetas = page.getByTestId("sgc-carpeta");
      check("inicio: seis carpetas", (await carpetas.count()) === 6);
      let colores = true;
      for (const [codigo, hex] of Object.entries(COLORES)) {
        const c = page.locator(`[data-testid="sgc-carpeta"][data-area="${codigo}"]`);
        const texto = await c.innerText();
        const banda = await c.locator("span").first().evaluate((el) => getComputedStyle(el).backgroundColor);
        if (!texto.includes(codigo) || banda !== rgb(hex) || !/\d/.test(texto)) colores = false;
      }
      check("cada carpeta con sigla, nombre, color HEX del área (banda) y su conteo de vigentes", colores);
      // Documentos SGC es un grupo propio del menú, con sus subitems (solo los que la persona puede ver).
      const desplegar = page.getByRole("button", { name: "Desplegar Documentos SGC" });
      if (await desplegar.count()) await desplegar.click();
      await page.locator('aside[aria-label="Navegación principal"] a', { hasText: "Lista Maestra" }).first().waitFor();
      // Cada subitem puede llevar un contador (p. ej. tareas de la Bandeja): se compara solo el nombre.
      const subitems = (await page.locator('aside[aria-label="Navegación principal"] a').allInnerTexts()).map((x) => x.split("\n")[0].trim());
      check("menú: Documentos SGC con subitems Documentos, Bandeja, Solicitudes, Externos y Lista Maestra", ["Documentos", "Bandeja", "Solicitudes", "Externos", "Lista Maestra"].every((x) => subitems.includes(x)), subitems.join("|"));

      await page.locator('[data-testid="sgc-carpeta"][data-area="TC"]').click();
      await page.waitForURL((url) => url.pathname === "/documentos/explorar" && url.searchParams.get("area") === "TC");
      await page.getByTestId("ruta-documentos").getByText("Gestión Técnica").waitFor();
      const ruta = await page.getByTestId("ruta-documentos").innerText();
      check("carpeta: ruta corta «Documentos › Gestión Técnica»", /^Documentos\b/.test(ruta.trim()) && /Gestión Técnica/.test(ruta) && !/Documentos SGC/.test(ruta), ruta.replace(/\n/g, " "));
      await page.getByTestId("sgc-tarjeta").first().waitFor();
      check("carpeta: solo documentos del área TC", (await page.getByTestId("sgc-tarjeta").evaluateAll((xs) => xs.map((f) => f.getAttribute("data-clave")))).every((c) => /^FX-TC/.test(String(c))));
      check("carpeta: documentos en tarjetas y sin vista de tabla", (await page.getByTestId("sgc-tarjeta").count()) > 0 && (await page.getByRole("button", { name: "Ver en tabla" }).count()) === 0 && (await page.getByTestId("sgc-fila").count()) === 0);

      // Nueva ficha desde la interfaz.
      await page.getByTestId("sgc-nueva-ficha").click();
      await page.locator("#ficha-tipo").selectOption("P");
      await page.locator("#ficha-clave").fill(`FX-GCP-U${stamp}`);
      await page.locator("#ficha-titulo").fill(`Procedimiento desde la interfaz ${stamp}`);
      await page.getByTestId("ficha-guardar").click();
      await page.getByText("La clave indica el área GC").first().waitFor();
      check("nueva ficha: la clave que no coincide con el área se marca antes de enviar", true);
      // Cierra el aviso de validacion (lleva al campo marcado).
      await page.getByRole("button", { name: "Entendido", exact: true }).click();
      await page.getByRole("button", { name: "Entendido", exact: true }).waitFor({ state: "detached" });
      await page.locator("#ficha-clave").fill(`fx-tcp-u${stamp.toLowerCase()}`);
      await page.locator("#ficha-elaborador").selectOption(String(id.luis));
      await page.locator("#ficha-revisor").selectOption(String(id.ricardo));
      await page.locator("#ficha-autorizador").selectOption(String(id.patricia));
      await page.locator("#ficha-archivo-pdf").setInputFiles({ name: "procedimiento-ui.pdf", mimeType: "application/pdf", buffer: await pdfConTexto(2, `UI ${stamp}`) });
      await page.getByTestId("ficha-guardar").click();
      await page.waitForURL((url) => /^\/documentos\/\d+$/.test(url.pathname));
      docUi = Number(new URL(page.url()).pathname.split("/").pop());
      await page.getByTestId("sgc-ficha").waitFor();
      check("nueva ficha: abre la ficha con la clave normalizada y la revisión en curso", (await page.getByTestId("sgc-clave").innerText()) === `FX-TCP-U${stamp}` && (await page.getByTestId("sgc-en-curso").count()) === 1);
      check("ficha: ruta Documentos SGC › Gestión › Tipo › Documento", /Gestión Técnica[\s\S]*Procedimiento[\s\S]*FX-TCP-U/.test(await page.getByTestId("ruta-documentos").innerText()));

      // Carga inicial con contrasena.
      await (await accion(page, "sgc-registrar-vigente")).click();
      await page.locator("#rev-emision").fill("15/01/2026");
      await page.locator("#rev-emision").blur();
      await page.getByTestId("vigente-guardar").click();
      await page.locator("#reauth-password").fill(credenciales[EMAIL.ana]);
      await page.getByRole("button", { name: "Confirmar", exact: true }).click();
      await page.getByTestId("sgc-visor").waitFor();
      await page.locator('[data-testid="sgc-visor"] canvas').first().waitFor();
      check("carga inicial con contraseña: la revisión queda vigente y el PDF se ve en el visor interno", (await page.getByTestId("sgc-en-curso").count()) === 0);

      // Nueva revision: la vigente sigue en la ficha.
      await (await accion(page, "sgc-nueva-revision")).click();
      await page.locator("#rev-motivo").fill("Actualizar el apartado de reactivos");
      await page.locator("#rev-elaborador").selectOption(String(id.luis));
      await page.locator("#rev-revisor").selectOption(String(id.ricardo));
      await page.locator("#rev-autorizador").selectOption(String(id.patricia));
      await page.getByTestId("revision-guardar").click();
      await page.getByTestId("sgc-en-curso").waitFor();
      check("nueva revisión: aparece en curso y la vigente sigue en el visor", (await page.getByTestId("sgc-visor").count()) === 1 && (await page.getByTestId("sgc-historial-fila").count()) === 2);
      check("la nueva revisión no se puede abrir dos veces (deshabilitada con motivo en el menú ⋯)", (await (await accion(page, "sgc-nueva-revision")).isDisabled()) && (await motivo(page, "sgc-nueva-revision")).length > 0);
      await cerrarMenu(page);
    } catch (err) {
      await captura(page);
      check("flujo de Mejora Continua", false, err instanceof Error ? err.message : String(err));
    } finally {
      await context.close();
    }
  }

  /* ---------- Tecnico Auxiliar: solo la vigente; restringido no encontrado ---------- */
  {
    const { context, page } = await nueva();
    try {
      await entrar(page, "mariana");
      await page.goto(`${BASE}/documentos/${docUi}`);
      await page.getByTestId("sgc-vigente").waitFor();
      await page.locator('[data-testid="sgc-visor"] canvas').first().waitFor();
      check("consulta: ve la vigente en el visor, sin la revisión en curso ni el historial", (await page.getByTestId("sgc-en-curso").count()) === 0 && (await page.getByTestId("sgc-historial").count()) === 0 && (await contarAccion(page, "sgc-editar")) === 0);
      await page.goto(`${BASE}/documentos/${R.id}`);
      await page.getByTestId("sgc-no-encontrado").waitFor();
      check("confidencial por URL directa: «no encontrado»", /no encontrado/i.test(await page.getByTestId("sgc-no-encontrado").innerText()));
      await page.goto(`${BASE}/documentos/explorar?buscar=${R.clave ?? `FX-GCL-R${stamp}`}`);
      await page.getByTestId("sgc-vacio").waitFor();
      check("confidencial: el explorador no lo muestra", (await page.getByTestId("sgc-tarjeta").count()) === 0);
    } catch (err) {
      await captura(page);
      check("consulta del Técnico Auxiliar", false, err instanceof Error ? err.message : String(err));
    } finally {
      await context.close();
    }
  }

  /* ---------- Elaborador (Luis): cargar archivo; enviado, boton deshabilitado con motivo ---------- */
  {
    const { context, page } = await nueva();
    try {
      await entrar(page, "luis");
      await page.goto(`${BASE}/documentos/${L.id}`);
      await page.getByTestId("sgc-en-curso").waitFor();
      check("elaborador asignado: «Cargar o sustituir archivo» habilitado en borrador", await (await accion(page, "sgc-subir-archivo")).isEnabled());
      await cerrarMenu(page);
      await (await accion(page, "sgc-enviar-revision")).click();
      await page.getByRole("button", { name: "Enviar a revisión", exact: true }).last().click();
      await page.locator('[data-principal="1"][data-testid="sgc-enviar-revision"]').waitFor({ state: "detached" });
      await page.getByText("Archivos bloqueados", { exact: false }).first().waitFor();
      check("enviada a revisión: «Cargar o sustituir archivo» queda deshabilitado con su motivo", (await (await accion(page, "sgc-subir-archivo")).isDisabled()) && /devolverse a borrador/.test(await motivo(page, "sgc-subir-archivo")));
      await cerrarMenu(page);
    } catch (err) {
      await captura(page);
      check("elaborador", false, err instanceof Error ? err.message : String(err));
    } finally {
      await context.close();
    }
  }

  /* ---------- Administrador tecnico: diagnostico; editor de roles con acciones documentales ---------- */
  {
    const { context, page } = await nueva();
    try {
      await entrar(page, "jorge");
      await page.goto(`${BASE}/documentos/${docUi}`);
      await page.getByTestId("sgc-ficha").waitFor();
      check("administrador técnico: ficha en vista de diagnóstico, sin visor ni descargas", (await page.getByText("Solo metadatos (diagnóstico)").count()) === 1 && (await page.getByTestId("sgc-visor").count()) === 0 && (await contarAccion(page, "sgc-descargar-pdf")) === 0);
      await page.goto(`${BASE}/administracion/roles`);
      await page.getByText("Coordinador/a de Mejora Continua").first().click();
      await page.getByRole("button", { name: "Editar permisos" }).click();
      const seccion = page.getByTestId("permisos-documentales");
      await seccion.waitFor();
      const marcadas = await seccion.locator('input[type="checkbox"]:checked').count();
      check("editor de roles: sección de acciones documentales (Mejora Continua con las 14)", (await seccion.locator('input[type="checkbox"]').count()) === 14 && marcadas === 14, `${marcadas}`);
      await page.goto(`${BASE}/calidad/biblioteca`);
      await page.waitForURL((url) => url.pathname === "/documentos");
      check("la Biblioteca redirige a Documentos SGC", true);
    } catch (err) {
      await captura(page);
      check("administrador técnico", false, err instanceof Error ? err.message : String(err));
    } finally {
      await context.close();
    }
  }

  /* ---------- Modo oscuro y tableta ---------- */
  {
    const { context, page } = await nueva({ colorScheme: "dark", viewport: { width: 820, height: 1180 } });
    try {
      await entrar(page, "ana");
      await page.goto(`${BASE}/documentos`);
      await page.getByTestId("sgc-carpetas").waitFor();
      const fondo = await page.locator('[data-testid="sgc-carpeta"]').first().evaluate((el) => getComputedStyle(el).backgroundColor);
      const oscuro = (c) => {
        const m = /rgba?\((\d+), (\d+), (\d+)/.exec(c);
        return !!m && Number(m[1]) + Number(m[2]) + Number(m[3]) < 200;
      };
      const tema = await page.evaluate(() => document.documentElement.dataset.theme || "");
      check("modo oscuro: tema oscuro y las carpetas usan la superficie oscura", tema === "dark" && oscuro(fondo), `${tema} ${fondo}`);
      check("tableta: inicio sin desbordes horizontales", await sinDesborde(page));
      await page.goto(`${BASE}/documentos/explorar`);
      await page.getByTestId("sgc-tarjeta").first().waitFor();
      check("tableta: explorador sin desbordes horizontales", await sinDesborde(page));
      await page.goto(`${BASE}/documentos/${docUi}`);
      await page.getByTestId("sgc-ficha").waitFor();
      check("tableta: ficha sin desbordes horizontales", await sinDesborde(page));
    } catch (err) {
      await captura(page);
      check("modo oscuro y tableta", false, err instanceof Error ? err.message : String(err));
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

check("sin errores de consola", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
terminar();
