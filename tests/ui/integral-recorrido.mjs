/*
 * Prueba integral: recorrido de TODAS las pantallas con cada uno de los 10 roles
 * del catálogo (y la cuenta QA), en el navegador.
 * - El menú lateral muestra exactamente los destinos de visibleNav() para los
 *   permisos de la persona (src/lib/client/nav.ts).
 * - Cada pantalla de lista: con permiso se ve su contenido; sin permiso, «Sin
 *   acceso a esta sección» (nunca datos). Las fichas por URL directa: con
 *   permiso se abren; sin permiso, «Sin acceso» o «no encontrado» (404).
 * - Ninguna pantalla deja errores de consola, avisos de React ni 5xx.
 * - Rutas inexistentes: la página 404 «Esta página no existe».
 * Respaldos y la configuración inicial quedan fuera (se prueban aparte).
 * INTEGRAL_EXPLORAR=1 solo imprime la tabla rol × pantalla (sin comprobar).
 */
import "../lib/reauth-auto.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE || "http://localhost:3100";
process.env.BASE = `${BASE}/api`;
const { api, credenciales, crearCheck, EMAIL, informeLiberado, sesiones } = await import("../lib/calidad.mjs");
const { pdfConTexto } = await import("../lib/archivos.mjs");
const { abrirNavegador, BASE_WEB } = await import("../lib/navegador.mjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { visibleNav } = await import(path.join(root, "src/lib/client/nav.ts"));
const { check, terminar } = crearCheck();
const EXPLORAR = process.env.INTEGRAL_EXPLORAR === "1";
const QA = { email: "qa@ficotox.local", password: "QaFicotox2026!" };
const credencial = (quien) => (quien === "qa" ? QA : { email: EMAIL[quien], password: credenciales[EMAIL[quien]] });
const { t } = await sesiones();

/* ---------- Datos: una cadena completa con informe liberado, una incidencia con NC y un documento SGC ---------- */
const cad = await informeLiberado(t, "REC", { enviar: true });
const inc = (await api("POST", "/calidad/incidencias", { tipo: "falla_equipo", fecha_hora_ocurrencia: new Date().toISOString(), descripcion: "Derrame de metanol en la campana durante la extracción", impacto_resultados: "no", accion_inmediata: "Se limpió y ventiló" }, t.qa)).data;
const incId = inc?.id;
const doc = await (async () => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ clave: `FX-TCP-R${Date.now().toString(36).slice(-4).toUpperCase()}`, titulo: "Procedimiento del recorrido", area_codigo: "TC", tipo_codigo: "P" })) fd.append(k, String(v));
  fd.append("archivo_pdf", new Blob([await pdfConTexto(1, "Recorrido")]), "doc.pdf");
  return (await api("POST", "/sgc/documentos", fd, t.ana)).data;
})();

/*
 * Quién puede dar de alta cada tipo de registro (catálogo de roles + contexto que exige el servidor:
 * técnico auxiliar «recepcion»/«preparacion» solo recepción y procesamiento; estudiante «asignado»/«borrador»;
 * técnico analista sin C en muestras; informes C solo coordinaciones y analista «borrador»).
 */
const CREAN = {
  recepcion: ["ricardo", "gabriela", "mariana", "diego", "qa"],
  procesamiento: ["ricardo", "gabriela", "luis", "mariana", "diego", "qa"],
  extraccion: ["ricardo", "gabriela", "luis", "diego", "qa"],
  analisis: ["ricardo", "gabriela", "luis", "diego", "qa"],
  informe: ["ricardo", "gabriela", "luis", "qa"],
};
const ALTA = { "/muestras/recepcion/nueva": "recepcion", "/muestras/procesamiento/nuevo": "procesamiento", "/muestras/extraccion/nueva": "extraccion", "/muestras/analisis/nuevo": "analisis", "/informes/nuevo": "informe" };
const BOTON_NUEVO = { "/muestras/recepcion": ["recepcion", "link", "Nueva recepción"], "/muestras/procesamiento": ["procesamiento", "link", "Nuevo procesamiento"], "/muestras/extraccion": ["extraccion", "button", "Nueva extracción"], "/muestras/analisis": ["analisis", "link", "Nuevo análisis"], "/informes": ["informe", "link", "Nuevo informe"] };

/* Pantallas: ruta, la de la lista a la que pertenece (para saber si debe verse) y si es ficha por URL directa. */
const PANTALLAS = [
  ["/", "/"],
  ["/muestras/recepcion", "/muestras/recepcion"],
  ["/muestras/recepcion/nueva", "/muestras/recepcion"],
  [`/muestras/recepcion/${cad.R}`, "/muestras/recepcion", true],
  [`/muestras/recepcion/${cad.R}/etiquetas`, "/muestras/recepcion", true],
  ["/muestras/procesamiento", "/muestras/procesamiento"],
  ["/muestras/procesamiento/nuevo", "/muestras/procesamiento"],
  [`/muestras/procesamiento/${cad.P}`, "/muestras/procesamiento", true],
  ["/muestras/extraccion", "/muestras/extraccion"],
  ["/muestras/extraccion/nueva", "/muestras/extraccion"],
  [`/muestras/extraccion/${cad.E}`, "/muestras/extraccion", true],
  ["/muestras/analisis", "/muestras/analisis"],
  ["/muestras/analisis/nuevo", "/muestras/analisis"],
  [`/muestras/analisis/${cad.A}`, "/muestras/analisis", true],
  ["/informes", "/informes"],
  ["/informes/nuevo", "/informes"],
  [`/informes/${cad.informe}`, "/informes", true],
  [`/informes/${cad.informe}/ver`, "/informes", true],
  ["/supervision", "/supervision"],
  ["/solicitudes", "/solicitudes"],
  ["/inventario/reactivos", "/inventario/reactivos"],
  ["/inventario/consumibles", "/inventario/consumibles"],
  ["/inventario/equipos", "/inventario/equipos"],
  ["/inventario/mantenimiento", "/inventario/mantenimiento"],
  ["/movimientos", "/movimientos"],
  ["/calidad/incidencias", "/calidad/incidencias"],
  [`/calidad/incidencias/${incId}`, "/calidad/incidencias", true],
  ["/auditoria", "/auditoria"],
  ["/documentos", "/documentos"],
  ["/documentos/explorar", "/documentos"],
  [`/documentos/${doc?.id}`, "/documentos", true],
  ["/documentos/bandeja", "/documentos/bandeja"],
  ["/documentos/solicitudes", "/documentos/solicitudes"],
  ["/documentos/externos", "/documentos/externos"],
  ["/documentos/lista-maestra", "/documentos/lista-maestra"],
  ["/administracion/usuarios", "/administracion/usuarios"],
  ["/administracion/roles", "/administracion/roles"],
  // Ruta anterior: lleva a Usuarios.
  ["/administracion/accesos", "/administracion/usuarios"],
  ["/ayuda", "/ayuda"],
  ["/inventario", "/inventario"],
  ["/muestras", "/muestras"],
];

const SIN_ACCESO = /^Sin acceso\b|No tienes permiso|no tienes acceso/im;
const NO_ENCONTRADO = /no encontrad|no existe|no está asignad/i;
/* Qué muestra la pantalla: «sin acceso», «no encontrado», «error» o «ok». */
const estadoPantalla = async (page) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  // Esqueletos de carga: se espera a que se vayan.
  await page.locator(".animate-pulse, [data-skeleton]").first().waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
  const texto = await page.locator("main").innerText().catch(() => "");
  if (/Esta página no existe/.test(await page.locator("body").innerText())) return "404";
  if (/Sin permiso para registrar/.test(texto)) return "sin alta";
  if (SIN_ACCESO.test(texto)) return "sin acceso";
  if (NO_ENCONTRADO.test(texto)) return "no encontrado";
  if (/No se pudo|Error al cargar/i.test(texto)) return `error: ${texto.split("\n").find((l) => /No se pudo|Error/i.test(l))}`;
  return "ok";
};

const { paso, cerrar } = await abrirNavegador({ suite: "integral-recorrido", check, credencial });
const tabla = [];
const ROLES = ["jorge", "patricia", "ana", "ricardo", "gabriela", "luis", "mariana", "carmen", "hector", "diego", "qa"];
try {
  for (const quien of ROLES) {
    await paso(quien, `recorrido de ${quien}`, async (page) => {
      const yo = (await api("GET", "/auth/me", undefined, t[quien])).data;
      const permisos = yo?.permissions || {};
      const nav = visibleNav(permisos);
      const esperados = new Set(nav.flatMap((i) => [i.href, ...i.children.map((c) => c.href)]));
      // El menú lateral: exactamente los destinos visibles.
      await page.locator('aside[aria-label="Navegación principal"] nav a').first().waitFor();
      const enMenu = new Set(await page.locator('aside[aria-label="Navegación principal"] nav a').evaluateAll((as) => as.map((a) => new URL(a.href).pathname)));
      const sobran = [...enMenu].filter((h) => !esperados.has(h));
      const faltan = [...esperados].filter((h) => !enMenu.has(h));
      if (!EXPLORAR) check(`${quien}: el menú lateral muestra exactamente lo que permiten sus roles`, !sobran.length && !faltan.length, `sobran ${sobran.join(",")} faltan ${faltan.join(",")}`);
      const fila = { quien, menu: [...enMenu].sort().join(" ") };
      const puedeCrear = (await api("GET", "/samples/puede-crear", undefined, t[quien])).data?.puede || {};
      if (!EXPLORAR) for (const [tipo, quienes] of Object.entries(CREAN)) check(`${quien}: puede-crear ${tipo} = ${quienes.includes(quien)}`, !!puedeCrear[tipo]?.ok === quienes.includes(quien), JSON.stringify(puedeCrear[tipo]));
      for (const [ruta, lista, ficha] of PANTALLAS) {
        await page.goto(`${BASE_WEB}${ruta}`);
        const estado = await estadoPantalla(page);
        fila[ruta] = estado;
        if (EXPLORAR) continue;
        // Quien no ve la sección (sin V) recibe «Sin acceso»; quien la ve pero no da altas, «Sin permiso para registrar».
        if (ALTA[ruta] && esperados.has(lista)) {
          const crea = CREAN[ALTA[ruta]].includes(quien);
          check(`${quien}: ${ruta} ${crea ? "muestra el formulario" : "explica que no puede registrar"}`, estado === (crea ? "ok" : "sin alta"), estado);
          continue;
        }
        if (BOTON_NUEVO[ruta] && esperados.has(ruta)) {
          const [tipo, rol, nombre] = BOTON_NUEVO[ruta];
          const boton = page.getByRole(rol, { name: nombre });
          if (CREAN[tipo].includes(quien)) await boton.first().waitFor();
          check(`${quien}: «${nombre}» ${CREAN[tipo].includes(quien) ? "visible" : "oculto"} en ${ruta}`, ((await boton.count()) > 0) === CREAN[tipo].includes(quien));
        }
        const debeVer = lista === "/" || lista === "/ayuda" || esperados.has(lista) || (lista === "/inventario" && [...esperados].some((h) => h.startsWith("/inventario"))) || (lista === "/muestras" && [...esperados].some((h) => h.startsWith("/muestras")));
        if (debeVer && !ficha) check(`${quien}: ${ruta} se abre`, estado === "ok", estado);
        // Lo no asignado (o con alcance «estado» en etiquetas) responde 403 con el motivo: «Sin acceso».
        else if (debeVer) check(`${quien}: ${ruta} (por URL) se abre o es ajena a su alcance`, ["ok", "no encontrado", "sin acceso"].includes(estado), estado);
        else check(`${quien}: ${ruta} sin permiso → «Sin acceso» o 404, sin datos`, ["sin acceso", "no encontrado", "404"].includes(estado), estado);
      }
      tabla.push(fila);
    });
  }
  await paso("luis", "ruta inexistente", async (page) => {
    await page.goto(`${BASE_WEB}/no-existe-esta-ruta`);
    await page.getByText("Esta página no existe").waitFor();
    await page.getByRole("link", { name: "Ir al inicio" }).click();
    await page.waitForURL((u) => u.pathname === "/");
    check("404: «Esta página no existe» con enlace al inicio", true);
  });
} finally {
  await cerrar();
}
if (EXPLORAR) {
  for (const f of tabla) {
    console.log(`\n## ${f.quien}\nmenú: ${f.menu}`);
    for (const [ruta] of PANTALLAS) console.log(`  ${f[ruta].padEnd(14)} ${ruta}`);
  }
}
terminar();
