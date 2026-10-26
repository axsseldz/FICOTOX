/*
 * Corredor de pruebas: regenera la base de prueba, levanta `next dev` en el
 * puerto 3100 apuntando a ella, crea los datos de apoyo, corre las pruebas de
 * API y (si hay un Chrome de Playwright disponible) las de navegador, y apaga
 * el servidor.
 *
 *   npm test                         # API + navegador
 *   npm test -- --api                # solo API
 *   npm test -- --rebuild-fixture    # regenera antes la base congelada (npm run test:fixture)
 *   npm test -- --solo=e2e/flujo-completo.mjs   # solo el recorrido de punta a punta
 *   CHROME_PATH=/ruta/a/chrome npm test
 *
 * Antes de escribir nada comprueba dos cosas: que el puerto este libre (para no
 * atacar un servidor ajeno que ya lo ocupe) y que el servidor levantado este
 * usando la copia de prueba y no `instance/ficotox.sqlite3`. El rol y el
 * usuario QA solo existen en la copia de prueba (reset-test-db.mjs).
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFixture } from "./build-fixture.mjs";
import { CREDENCIALES, FIXTURE, resetTestDb } from "./reset-test-db.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const PORT = Number(process.env.TEST_PORT || 3100);
const onlyApi = process.argv.includes("--api");
/* --solo=ui/seguridad.mjs (o api-seguridad.mjs): solo datos de apoyo y esa suite, para depurar. */
const solo = (process.argv.find((a) => a.startsWith("--solo=")) || "").slice(7);
/* Chrome de Playwright: CHROME_PATH o la version mas reciente instalada en la cache de Playwright (macOS). */
const chromeDePlaywright = () => {
  const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
  const versiones = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1])) : [];
  const candidatos = versiones.map((d) => path.join(cache, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"));
  return candidatos.find((ruta) => existsSync(ruta)) || candidatos[0] || path.join(cache, "chromium/chrome");
};
const chrome = process.env.CHROME_PATH || chromeDePlaywright();

const run = (file, extraEnv = {}, args = []) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [file, ...args], { cwd: root, stdio: "inherit", env: { ...process.env, ...extraEnv } });
    child.on("exit", (code) => resolve(code ?? 1));
  });

/*
 * El puerto debe estar libre: si algo lo ocupa, puede ser un servidor sobre la
 * base real. Se escucha sin fijar host para cubrir tambien IPv6 (`[::]`), que es
 * donde queda `next dev` por omision.
 */
const puertoLibre = () =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(PORT);
  });

const waitFor = async (url, ms = 60_000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json().catch(() => ({}));
    } catch {
      /* todavia no */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
};

if (!(await puertoLibre())) {
  console.error(`\nEl puerto ${PORT} ya esta ocupado. Cierralo antes de correr las pruebas:\n  lsof -ti :${PORT} | xargs kill\nNo se ejecuta nada: el proceso que lo ocupa podria estar usando la base real.`);
  process.exit(1);
}

if (process.argv.includes("--rebuild-fixture") || (!process.env.SOURCE_DB && !existsSync(FIXTURE))) {
  console.log("Generando la base congelada de prueba (base vacia + roles de la Fase 0)...");
  await buildFixture();
}
const testDb = resetTestDb();
const esperado = path.basename(testDb);
console.log(`Base de prueba: ${testDb}`);

let server = null;
const stop = () => {
  if (server && !server.killed) server.kill("SIGTERM");
  server = null;
};
process.on("exit", stop);
process.on("SIGINT", () => {
  stop();
  process.exit(130);
});

/*
 * Fase 2: el servidor de prueba confia en X-Forwarded-For (las pruebas de bloqueo
 * por IP simulan varios equipos) y usa los valores por omision de la sesion y de
 * CORS aunque el .env local los cambie (Next no pisa variables ya definidas).
 */
const ENTORNO_FASE2 = { TRUST_PROXY: "true", JWT_EXPIRES_HOURS: "", CORS_ORIGINS: "", SESION_INACTIVIDAD_MIN: "", ALLOWED_EMAIL_DOMAINS: "cicese.mx,ficotox.local" };
/*
 * Fase 10: evidencia con el limite por omision (25 MB: la prueba sube 12 MB, que
 * pasa por el proxy, y 25 MB + 1, que da 413), evidencia obligatoria, y respaldos
 * en instance/test/backups (nunca en backups/ real).
 */
const ENTORNO_FASE10 = (testDb) => ({ EVIDENCIA_MAX_MB: "25", EVIDENCIA_OBLIGATORIA_ANALISIS: "true", FICOTOX_BACKUP_DIR: path.join(path.dirname(testDb), "backups"), RESPALDO_RETENCION: "" });

/* Levanta el servidor sobre la copia y no devuelve hasta confirmar que es esa base. */
/* Fase 3: la zona horaria del servidor no debe cambiar ninguna fecha (se arranca en Tijuana y, tras reiniciar, en UTC). */
/* Fase 6: la primera fase tiene SMTP de prueba (transporte en memoria, sin red); tras reiniciar, sin SMTP. */
const SMTP_PRUEBA = { SMTP_HOST: "prueba", SMTP_PORT: "2525", SMTP_USER: "ficotox", SMTP_PASS: "prueba", SMTP_FROM: "FICOTOX <informes@ficotox.local>" };
const SIN_SMTP = { SMTP_HOST: "", SMTP_PORT: "", SMTP_USER: "", SMTP_PASS: "", SMTP_FROM: "" };
const arrancarServidor = async (tz = "America/Tijuana", smtp = SMTP_PRUEBA) => {
  server = spawn("npx", ["next", "dev", "-p", String(PORT)], { cwd: root, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, SQLITE_PATH: testDb, FICOTOX_INSTANCE_DIR: path.dirname(testDb), PORT: String(PORT), TZ: tz, ...ENTORNO_FASE2, ...ENTORNO_FASE10(testDb), ...smtp } });
  const salud = await waitFor(`http://localhost:${PORT}/api/health/db`);
  if (!salud) throw new Error("El servidor de pruebas no respondio");
  if (salud.archivo !== esperado) {
    throw new Error(`El servidor del puerto ${PORT} esta usando "${salud.archivo}" y no la base de prueba "${esperado}". Se aborta para no tocar datos reales.`);
  }
};

let failed = 0;
try {
  await arrancarServidor();
  const datosApoyo = path.join(path.dirname(testDb), "datos-apoyo.json");
  const api = { BASE: `http://localhost:${PORT}/api`, TEST_DB_PATH: testDb, BETTER_SQLITE3: path.join(root, "node_modules/better-sqlite3"), CREDENCIALES_ROLES: CREDENCIALES, DATOS_APOYO_FILE: datosApoyo, TEST_PORT: String(PORT), ...ENTORNO_FASE10(testDb) };

  // Fase 3: los helpers de fechas dan lo mismo con cualquier zona horaria del proceso.
  for (const tz of ["UTC", "America/Tijuana"]) {
    console.log(`\n=== fechas.mjs (TZ=${tz})`);
    failed += (await run(path.join(here, "fechas.mjs"), { TZ: tz })) ? 1 : 0;
  }

  console.log("\n=== datos-apoyo.mjs");
  if (await run(path.join(here, "datos-apoyo.mjs"), api)) throw new Error("No se pudieron crear los datos de apoyo de las pruebas");

  // Suites del navegador: servidor de prueba, Chrome y, en solo lectura, la copia de la base (para comprobar lo que no se ve en pantalla).
  const entornoUi = () => ({ BASE: `http://localhost:${PORT}`, CHROME_PATH: chrome, CREDENCIALES_ROLES: CREDENCIALES, DATOS_APOYO_FILE: datosApoyo, TEST_DB_PATH: testDb, BETTER_SQLITE3: path.join(root, "node_modules/better-sqlite3") });

  if (solo) {
    console.log(`\n=== ${solo}`);
    // instalacion.mjs necesita el puerto libre y el archivo de api-respaldos-portables.mjs (instance/test/murio).
    if (solo === "instalacion.mjs") {
      failed += (await run(path.join(here, "api-respaldos-portables.mjs"), api)) ? 1 : 0;
      stop();
      await new Promise((r) => setTimeout(r, 1500));
      failed += (await run(path.join(here, solo), { TEST_PORT: String(PORT), CHROME_PATH: chrome, CREDENCIALES_ROLES: CREDENCIALES, BETTER_SQLITE3: path.join(root, "node_modules/better-sqlite3") })) ? 1 : 0;
      throw new Error("__solo__");
    }
    const esUi = solo.startsWith("ui/") || solo.startsWith("e2e/");
    failed += (await run(path.join(here, solo), esUi ? entornoUi() : api)) ? 1 : 0;
    throw new Error("__solo__");
  }

  // api-roles corre despues de api-dsp y api-sgc: crea registros y personas de prueba que alterarian los folios que esas suites esperan.
  for (const file of ["api-dsp.mjs", "api-sgc.mjs", "api-roles.mjs", "api-seguridad.mjs", "api-segregacion.mjs", "api-autorizaciones.mjs", "api-muestras.mjs", "api-informes.mjs", "api-documentos.mjs", "api-documentos-flujo.mjs", "api-documentos-fase3.mjs", "api-documentos-aceptacion.mjs", "api-cierre.mjs", "api-evidencias.mjs", "api-incidencias.mjs", "api-no-conformidades.mjs", "api-produccion.mjs", "api-mantenimiento-reportes.mjs", "api-correcciones-v1.mjs", "api-integral-muestras.mjs", "api-integral-inventario.mjs", "api-integral-calidad.mjs", "api-integral-documentos.mjs", "api-integral-admin.mjs", "api-cobertura-muestras.mjs", "api-cobertura-inventario.mjs", "api-cobertura-calidad.mjs", "api-cobertura-documentos.mjs", "api-cobertura-admin.mjs", "respaldos.mjs", "api-respaldos-portables.mjs", "api-restaurar.mjs"]) {
    console.log(`\n=== ${file}`);
    failed += (await run(path.join(here, file), api)) ? 1 : 0;
  }
  console.log("\n=== api-fechas.mjs (servidor en TZ=America/Tijuana)");
  failed += (await run(path.join(here, "api-fechas.mjs"), api, ["--fase=1"])) ? 1 : 0;

  // Reinicio: los permisos de un rol no deben crecer solos al arrancar de nuevo.
  console.log("\n=== api-permisos.mjs y api-roles.mjs --tras-reinicio (tras reiniciar el servidor)");
  stop();
  await new Promise((r) => setTimeout(r, 1500));
  await arrancarServidor("UTC", SIN_SMTP);
  failed += (await run(path.join(here, "api-permisos.mjs"), api)) ? 1 : 0;
  failed += (await run(path.join(here, "api-roles.mjs"), api, ["--tras-reinicio"])) ? 1 : 0;
  console.log("\n=== api-fechas.mjs (servidor en TZ=UTC: los mismos registros muestran las mismas fechas)");
  failed += (await run(path.join(here, "api-fechas.mjs"), api, ["--fase=2"])) ? 1 : 0;
  console.log("\n=== api-informes.mjs --sin-smtp (servidor sin SMTP_*)");
  failed += (await run(path.join(here, "api-informes.mjs"), api, ["--sin-smtp"])) ? 1 : 0;

  if (!onlyApi) {
    if (!existsSync(chrome)) {
      console.log(`\n(navegador omitido: no se encontro Chrome en ${chrome}; define CHROME_PATH)`);
    } else {
      for (const file of ["roles.mjs", "dsp.mjs", "sgc.mjs", "seguridad.mjs", "fechas.mjs", "segregacion.mjs", "autorizaciones.mjs", "etiquetas.mjs", "auditoria.mjs", "evidencias.mjs", "no-conformidades.mjs", "validacion.mjs", "documentos.mjs", "documentos-flujo.mjs", "documentos-fase3.mjs", "documentos-ficha.mjs", "documentos-listas.mjs", "documentos-inicio.mjs", "visor.mjs", "animaciones.mjs", "estilos-atajos.mjs", "firmantes.mjs", "mantenimiento-reporte.mjs", "calidad-visor.mjs", "integral-recorrido.mjs", "integral-muestras.mjs", "integral-inventario.mjs", "integral-calidad.mjs", "integral-documentos.mjs", "integral-admin.mjs", "cobertura-muestras.mjs", "cobertura-inventario.mjs", "cobertura-calidad.mjs", "cobertura-documentos.mjs", "cobertura-admin.mjs", "respaldos-portables.mjs", "respaldos-restaurar.mjs"]) {
        console.log(`\n=== ui/${file}`);
        failed += (await run(path.join(here, "ui", file), entornoUi())) ? 1 : 0;
      }
      // Recorrido de punta a punta del laboratorio (despues de las suites del navegador: no depende de folios exactos).
      console.log("\n=== e2e/flujo-completo.mjs");
      failed += (await run(path.join(here, "e2e", "flujo-completo.mjs"), entornoUi())) ? 1 : 0;
    }
  }

  // Fase 11: el paquete standalone (si hay build) no lleva datos ni secretos y usa la instancia de afuera.
  console.log("\n=== standalone.mjs");
  failed += (await run(path.join(here, "standalone.mjs"))) ? 1 : 0;

  // Fase 12: migraciones, instalacion/operacion y concurrencia entre procesos (bases y carpetas temporales propias).
  for (const file of ["migraciones.mjs", "operacion.mjs", "concurrencia.mjs", "respaldo-portable.mjs"]) {
    console.log(`\n=== ${file}`);
    failed += (await run(path.join(here, file))) ? 1 : 0;
  }

  // Al final: rompe la bitacora a proposito, asi que nada puede correr despues.
  console.log("\n=== api-integridad.mjs");
  failed += (await run(path.join(here, "api-integridad.mjs"), api)) ? 1 : 0;

  // Configuracion inicial: levanta sus propios servidores sobre instancias vacias en el mismo puerto (el de las pruebas se detiene).
  // Usa el respaldo descargado por api-respaldos-portables.mjs («la computadora murió»).
  console.log("\n=== instalacion.mjs");
  stop();
  await new Promise((r) => setTimeout(r, 1500));
  failed += (await run(path.join(here, "instalacion.mjs"), { TEST_PORT: String(PORT), CHROME_PATH: chrome, CREDENCIALES_ROLES: CREDENCIALES, BETTER_SQLITE3: path.join(root, "node_modules/better-sqlite3") })) ? 1 : 0;
} catch (error) {
  if (error.message !== "__solo__") throw error;
} finally {
  stop();
}
console.log(failed ? `\n${failed} suite(s) con fallos` : "\nTodas las suites pasaron");
process.exit(failed ? 1 : 0);
