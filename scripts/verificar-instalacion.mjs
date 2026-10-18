#!/usr/bin/env node
/*
 * Verificacion de la instalacion de FICOTOX (Fase 12).
 *
 *   npm run verificar-instalacion [-- --sin-reporte]
 *
 * Revisa lo que debe estar bien en la computadora del laboratorio y lo muestra
 * con ✅ (bien), ⚠️ (revisar; no impide operar) y ❌ (corregir antes de operar).
 * Deja el reporte en <instancia>/verificaciones/<fecha>.md.
 * Codigo de salida: 0 sin ❌, 1 con algun ❌. No imprime secretos (solo huellas).
 * Solo lee: no cambia la base ni la configuracion.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluarCadena, leerClaveSello, SECRET_KEY_DESARROLLO } from "../src/lib/shared/audit-chain.mjs";
import { huellaLlave, listarActas, listarRespaldos, versionApp } from "../src/lib/shared/respaldo.mjs";
import { erroresSecretosProduccion } from "../src/lib/shared/secretos.mjs";
import { estadoMigraciones, VERSION_ACTUAL } from "../src/lib/server/migraciones/motor.mjs";
import { abrirBase, entornoDe, plataforma, root, servicioInstalado, Sqlite } from "./lib/operacion.mjs";
import { marcaLocal, selloLocal } from "./lib/registro.mjs";

const args = process.argv.slice(2);
const entorno = entornoDe();
const env = process.env;
const resultados = [];
const OK = "✅";
const AVISO = "⚠️";
const MAL = "❌";
const marcar = (estado, nombre, detalle) => {
  resultados.push({ estado, nombre, detalle });
  console.log(`${estado} ${nombre}: ${detalle}`);
};
const verdadero = (nombre, porOmision) => ["1", "true", "yes", "on"].includes(String(env[nombre] ?? porOmision).trim().toLowerCase());
const hace = (fecha) => (Date.now() - new Date(fecha).getTime()) / 3_600_000;
const corre = (comando, lista) => {
  const r = spawnSync(comando, lista, { encoding: "utf8" });
  return r.status === 0 ? `${r.stdout || ""}` : null;
};

console.log(`FICOTOX · verificación de la instalación (${marcaLocal()})\nCarpeta: ${root}\nInstancia: ${entorno.instanceDir}\n`);

/* 1. Node */
{
  const [mayor, menor] = process.versions.node.split(".").map(Number);
  const ok = (mayor === 22 && menor >= 13) || mayor >= 24;
  marcar(ok ? OK : MAL, "Node.js", `${process.versions.node}${ok ? "" : " (se requiere 22.13 o posterior, o 24+)"}`);
}

/* 2. Disco */
try {
  const dir = fs.existsSync(entorno.instanceDir) ? entorno.instanceDir : root;
  const st = fs.statfsSync(dir);
  const libreGb = (st.bavail * st.bsize) / 1024 ** 3;
  marcar(libreGb < 1 ? MAL : libreGb < 5 ? AVISO : OK, "Espacio en disco", `${libreGb.toFixed(1)} GB libres${libreGb < 5 ? " (los respaldos y adjuntos necesitan espacio: libera o amplía)" : ""}`);
} catch (error) {
  marcar(AVISO, "Espacio en disco", `no se pudo medir (${error.message})`);
}

/* 3. Hora y zona */
{
  const zona = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offsetTijuana = new Date().toLocaleString("en-US", { timeZone: "America/Tijuana", timeZoneName: "shortOffset" }).split(" ").pop();
  const offsetLocal = new Date().toLocaleString("en-US", { timeZoneName: "shortOffset" }).split(" ").pop();
  let ntp = null;
  if (plataforma() === "win32") {
    const s = corre("w32tm", ["/query", "/status"]);
    ntp = s === null ? null : !/Leap Indicator: 3|not synchronized|no sincronizado/i.test(s);
  } else if (plataforma() === "linux") {
    const s = corre("timedatectl", ["show", "-p", "NTPSynchronized", "--value"]);
    ntp = s === null ? null : s.trim() === "yes";
  } else if (plataforma() === "darwin") {
    const s = corre("launchctl", ["print", "system/com.apple.timed"]);
    ntp = s === null ? null : /state = running/.test(s);
  }
  const zonaOk = zona === "America/Tijuana" || offsetLocal === offsetTijuana;
  const estado = ntp === false || !zonaOk ? AVISO : ntp === null ? AVISO : OK;
  marcar(
    estado,
    "Hora y zona horaria",
    `${new Date().toLocaleString("es-MX")} · zona ${zona} (${offsetLocal})${zonaOk ? "" : ` — distinta de la del laboratorio (America/Tijuana, ${offsetTijuana}); FICOTOX muestra las fechas en la zona del laboratorio, pero ajusta la zona del equipo`} · sincronización automática: ${ntp === null ? "no se pudo comprobar (revísala en la configuración de fecha y hora)" : ntp ? "activa" : "NO activa (actívala: las firmas y la bitácora dependen de la hora)"}`,
  );
}

/* 4. JWT_SECRET */
{
  const errores = erroresSecretosProduccion({ ...env, NODE_ENV: "production" });
  marcar(errores.length ? MAL : OK, "JWT_SECRET", errores.length ? `${errores.join("; ")} (corre npm run configurar)` : `fuerte (${String(env.JWT_SECRET).length} caracteres)`);
}

/* 5. Llave de la bitacora y su huella registrada */
const llave = leerClaveSello(entorno.secretKey, entorno.instanceDir);
{
  const registro = path.join(entorno.instanceDir, "llave-bitacora.huella");
  const registrada = fs.existsSync(registro) ? fs.readFileSync(registro, "utf8").trim() : null;
  if (!llave) marcar(MAL, "Llave de la bitácora", String(entorno.secretKey || "").trim() === SECRET_KEY_DESARROLLO ? "SECRET_KEY es la de desarrollo y no hay auditoria.key" : "no hay SECRET_KEY ni auditoria.key (corre npm run configurar)");
  else {
    const huella = huellaLlave(llave.clave);
    if (!registrada) marcar(AVISO, "Llave de la bitácora", `${llave.origen}, huella ${huella.slice(0, 16)}… — sin huella registrada (corre npm run configurar para registrarla)`);
    else if (registrada !== huella) marcar(MAL, "Llave de la bitácora", `la llave actual (huella ${huella.slice(0, 16)}…) NO es la registrada (${registrada.slice(0, 16)}…): ¿se cambió SECRET_KEY? La bitácora no se podrá verificar`);
    else marcar(OK, "Llave de la bitácora", `${llave.origen}, huella ${huella.slice(0, 16)}… coincide con la registrada. Recuerda: una copia de la llave debe estar guardada fuera de esta computadora (README.md, paso 5)`);
  }
}

/* 5 bis. Permisos del .env y de la base (macOS/Linux): nadie mas que el usuario del servicio debe leerlos. */
if (plataforma() !== "win32") {
  const abiertos = [String(env.FICOTOX_ENV_FILE || "").trim() ? path.resolve(root, env.FICOTOX_ENV_FILE) : path.join(root, ".env"), entorno.sqlitePath]
    .filter((f) => f && fs.existsSync(f))
    .filter((f) => fs.statSync(f).mode & 0o077)
    .map((f) => `${path.relative(root, f) || f} (${(fs.statSync(f).mode & 0o777).toString(8)})`);
  marcar(abiertos.length ? AVISO : OK, "Permisos de archivos", abiertos.length ? `legibles por otros usuarios: ${abiertos.join(", ")} — chmod 600` : ".env y la base solo para el usuario de FICOTOX (600)");
}

/* 6-7 y 15-16: base */
let base = null;
// Fecha de creacion de la instancia de produccion (npm run instancia-nueva): respaldos y pruebas anteriores son de otra base.
let instanciaCreada = null;
try {
  if (entorno.motor === "sqlite" && !fs.existsSync(entorno.sqlitePath)) throw new Error(`no existe ${entorno.sqlitePath} (corre npm run instancia-nueva -- --confirmar en una instalación nueva)`);
  base = await abrirBase(entorno);
} catch (error) {
  marcar(MAL, "Base de datos", error.message);
}
if (base) {
  const { db, cerrar, motor } = base;
  try {
    // 6. Migraciones
    try {
      const estado = await estadoMigraciones(db, { Sqlite });
      const version = estado.aplicadas?.length ? Math.max(...estado.aplicadas.map((a) => a.version)) : null;
      if (estado.tipo === "versionada" && !estado.pendientes.length) marcar(OK, "Migraciones", `base en la versión ${version} (la aplicación conoce hasta la ${VERSION_ACTUAL})`);
      else if (estado.tipo === "vacia") marcar(MAL, "Migraciones", "la base está vacía (corre npm run instancia-nueva -- --confirmar)");
      else marcar(AVISO, "Migraciones", `${estado.tipo === "sin_versionar" ? `base sin versionar (línea base ${estado.lineaBase}); ` : ""}pendientes: ${estado.pendientes.map((m) => m.version).join(", ") || "ninguna"} — se aplican al arrancar (o npm run migrar)`);
    } catch (error) {
      marcar(MAL, "Migraciones", `${error.message}${error.codigo ? ` [${error.codigo}]` : ""}`);
    }

    // 7. Bitacora integra
    try {
      if (!llave) throw new Error("no se puede verificar sin la llave");
      const filas = await db.all("SELECT * FROM auditoria ORDER BY id ASC");
      const ultimo =
        motor === "sqlite"
          ? (await db.get("SELECT seq FROM sqlite_sequence WHERE name = 'auditoria'"))?.seq
          : (await db.get("SELECT AUTO_INCREMENT - 1 AS seq FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auditoria'"))?.seq;
      const triggers =
        motor === "sqlite"
          ? (await db.get("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'auditoria' AND name IN ('auditoria_sin_update', 'auditoria_sin_delete')")).n
          : (await db.get("SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'auditoria' AND TRIGGER_NAME IN ('auditoria_sin_update', 'auditoria_sin_delete')")).n;
      const v = evaluarCadena(filas, llave.clave, ultimo === null || ultimo === undefined ? null : Number(ultimo), Number(triggers));
      const problemas = [
        v.primer_error !== null && `sello roto desde la entrada #${v.primer_error}`,
        v.filas_faltantes_al_final && `${v.filas_faltantes_al_final} entrada(s) faltante(s) al final`,
        v.filas_faltantes_intermedias && `${v.filas_faltantes_intermedias} hueco(s) de id`,
        !v.triggers_ok && "faltan los triggers de protección",
      ].filter(Boolean);
      marcar(v.ok ? OK : MAL, "Integridad de la bitácora", v.ok ? `${v.total} entradas, cadena íntegra` : problemas.join("; "));
    } catch (error) {
      marcar(MAL, "Integridad de la bitácora", error.message);
    }

    try {
      instanciaCreada = (await db.get("SELECT fecha_hora FROM auditoria WHERE entidad = 'instancia' AND accion = 'crear' ORDER BY id DESC LIMIT 1"))?.fecha_hora || null;
    } catch {
      instanciaCreada = null;
    }

    // 15. Cuentas de demostracion activas
    try {
      const demo = await db.all("SELECT email FROM usuarios WHERE activo = 1 AND LOWER(email) LIKE '%@ficotox.local'");
      // ⚠️ y no ❌: la base de desarrollo las tiene a proposito; en produccion no deben existir (instancia-nueva no las crea).
      marcar(demo.length ? AVISO : OK, "Cuentas de demostración", demo.length ? `${demo.length} cuenta(s) @ficotox.local activa(s) (${demo.slice(0, 3).map((d) => d.email).join(", ")}${demo.length > 3 ? "…" : ""}): NO opera en producción así; desactívalas o usa npm run instancia-nueva en una instalación nueva` : "ninguna cuenta @ficotox.local activa");
    } catch (error) {
      marcar(MAL, "Cuentas de demostración", error.message);
    }

    // 16. Quien gestiona (usuarios:G) y quien autoriza (usuarios:A)
    try {
      const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Tijuana" });
      const filas = await db.all(
        `SELECT DISTINCT u.email AS email, ra.accion AS accion FROM usuarios u
           JOIN usuario_roles ur ON ur.usuario_id = u.id AND ur.revocado_en IS NULL AND ur.vigente_desde <= ? AND (ur.vigente_hasta IS NULL OR ur.vigente_hasta >= ?)
           JOIN rol_acciones ra ON ra.id_rol = ur.rol_id AND ra.modulo = 'usuarios' AND ra.accion IN ('G', 'A')
          WHERE u.activo = 1 AND (u.vigente_hasta IS NULL OR u.vigente_hasta >= ?)`,
        [hoy, hoy, hoy],
      );
      const g = filas.filter((f) => f.accion === "G").map((f) => f.email);
      const a = filas.filter((f) => f.accion === "A").map((f) => f.email);
      const faltan = [!g.length && "usuarios:G (gestionar cuentas)", !a.length && "usuarios:A (autorizar cambios de rol)"].filter(Boolean);
      marcar(faltan.length ? MAL : OK, "Cuentas de administración", faltan.length ? `nadie activo con ${faltan.join(" ni ")}` : `usuarios:G: ${g.length} · usuarios:A: ${a.length}${g.some((e) => a.includes(e)) ? " (hay una misma persona con ambos: la segregación exige que sean distintas en cada solicitud)" : ""}`);
    } catch (error) {
      marcar(MAL, "Cuentas de administración", error.message);
    }
  } finally {
    await cerrar();
  }
}

/* 8-10. Respaldos */
{
  if (entorno.motor !== "sqlite") marcar(AVISO, "Respaldos", "MySQL/MariaDB: los respaldos se hacen con mysqldump (README.md); no se pueden revisar desde aquí");
  else {
    // 8. Tarea programada de respaldo
    let tarea = null;
    if (plataforma() === "win32") tarea = corre("schtasks", ["/Query", "/TN", "FICOTOX respaldo base de datos"]) !== null;
    else if (plataforma() === "linux" || plataforma() === "darwin") tarea = /respaldar-ficotox|backup-ficotox|npm run respaldar/.test(corre("crontab", ["-l"]) || "") || fs.existsSync("/Library/LaunchDaemons/mx.cicese.ficotox.respaldo.plist");
    marcar(tarea ? OK : AVISO, "Tarea de respaldo programada", tarea ? "instalada" : plataforma() === "win32" ? "no existe la tarea «FICOTOX respaldo base de datos» (scripts\\install-ficotox-backup-tasks.cmd daily)" : "no se encontró en crontab (ver README.md, «Respaldos»)");

    // 9. Respaldo de las ultimas 24 h
    const deEstaInstancia = (fecha) => !instanciaCreada || new Date(fecha).getTime() >= new Date(instanciaCreada).getTime();
    const respaldos = listarRespaldos(entorno.respaldosDir).filter((r) => deEstaInstancia(r.creado_en));
    const ultimo = respaldos[0];
    const horas = ultimo ? hace(ultimo.creado_en) : null;
    const limite = Number(env.RESPALDO_AVISO_HORAS || 24);
    marcar(ultimo && horas <= limite ? OK : AVISO, "Último respaldo", ultimo ? `${ultimo.id} (hace ${horas.toFixed(1)} h)${horas > limite ? ` — más de ${limite} h: crea uno en Administración › Respaldos o npm run respaldar` : ""}` : `no hay respaldos${instanciaCreada ? " de esta instancia (desde su creación)" : ""} en ${entorno.respaldosDir}`);

    // 10. Prueba de restauracion de los ultimos 90 dias
    const dias = Number(env.PRUEBA_RESTAURACION_AVISO_DIAS || 90);
    const acta = listarActas(entorno.respaldosDir).find((a) => a.resultado === "aprobada" && deEstaInstancia(a.fecha));
    const edad = acta ? hace(acta.fecha) / 24 : null;
    marcar(acta && edad <= dias ? OK : AVISO, "Prueba de restauración", acta ? `última aprobada ${marcaLocal(new Date(acta.fecha)).slice(0, 10)} (hace ${Math.floor(edad)} días)${edad > dias ? ` — más de ${dias} días: npm run restaurar -- --respaldo <id>` : ""}` : `no hay ninguna prueba de restauración aprobada${instanciaCreada ? " de esta instancia" : ""} (npm run restaurar -- --respaldo <id>)`);
  }
}

/* 11. Modos obligatorios */
{
  const aut = verdadero("AUTORIZACIONES_OBLIGATORIAS", "true");
  const evi = verdadero("EVIDENCIA_OBLIGATORIA_ANALISIS", "true");
  marcar(aut && evi ? OK : AVISO, "Autorizaciones y evidencia obligatorias", `AUTORIZACIONES_OBLIGATORIAS=${aut} · EVIDENCIA_OBLIGATORIA_ANALISIS=${evi}${aut && evi ? "" : " — en producción deben estar en true (solo se apagan en la transición, con registro)"}`);
}

/* 12. CORS */
{
  const cors = String(env.CORS_ORIGINS || "").trim();
  marcar(cors === "*" ? MAL : cors ? AVISO : OK, "CORS", cors === "*" ? "CORS_ORIGINS=* permite a cualquier sitio llamar a la API: déjalo vacío" : cors ? `orígenes permitidos: ${cors} (confirma que son necesarios)` : "solo el mismo origen");
}

/* 13. HTTPS */
{
  const cert = String(env.TLS_CERT || "").trim();
  const key = String(env.TLS_KEY || "").trim();
  if (cert && key) {
    const leibles = [cert, key].every((f) => {
      try {
        fs.accessSync(path.resolve(root, f), fs.constants.R_OK);
        return true;
      } catch {
        return false;
      }
    });
    let vence = null;
    try {
      const { X509Certificate } = await import("node:crypto");
      vence = new X509Certificate(fs.readFileSync(path.resolve(root, cert))).validTo;
    } catch {
      vence = null;
    }
    const diasCert = vence ? (new Date(vence).getTime() - Date.now()) / 86_400_000 : null;
    marcar(!leibles ? MAL : diasCert !== null && diasCert < 30 ? AVISO : OK, "HTTPS", !leibles ? "TLS_CERT o TLS_KEY no se pueden leer" : `activo${vence ? `; el certificado vence ${marcaLocal(new Date(vence)).slice(0, 10)}${diasCert < 30 ? " (renuévalo pronto)" : ""}` : ""}`);
  } else marcar(AVISO, "HTTPS", "HTTP sin cifrar: aceptable solo en la red interna del laboratorio; para cifrar define TLS_CERT y TLS_KEY (README.md, «HTTPS»)");
}

/* 14. Arranque automatico */
{
  const s = servicioInstalado();
  marcar(s.instalado ? OK : AVISO, "Arranque automático", s.instalado ? s.detalle : `${s.detalle} (npm run instalar-servicio)`);
}

/* 17. Build standalone limpio */
{
  const paquete = path.join(root, ".next", "standalone");
  if (!fs.existsSync(path.join(paquete, "server.js"))) marcar(MAL, "Build de producción", "no existe .next/standalone (npm run build)");
  else {
    const CARPETAS = new Set(["instance", "backups", "instance-restaurada", "tests", "marimo"]);
    const prohibido = (n) => /^\.env(\..*)?$/.test(n) || /\.(sqlite3|sqlite|db|key)$/i.test(n);
    const encontrados = [];
    const recorrer = (dir, raiz) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const ruta = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules") continue;
          if (raiz && CARPETAS.has(e.name)) encontrados.push(ruta);
          else recorrer(ruta, false);
        } else if (prohibido(e.name)) encontrados.push(ruta);
      }
    };
    recorrer(paquete, true);
    // Version del build (la escribe scripts/limpiar-standalone.mjs al compilar) contra la del codigo.
    const commit = versionApp(root).commit;
    let delBuild = null;
    try {
      delBuild = JSON.parse(fs.readFileSync(path.join(paquete, "ficotox-build.json"), "utf8")).commit || null;
    } catch {
      delBuild = null;
    }
    const distinto = delBuild && commit && delBuild !== commit;
    marcar(encontrados.length ? MAL : distinto ? AVISO : OK, "Build de producción", encontrados.length ? `el paquete contiene datos o secretos: ${encontrados.map((r) => path.relative(root, r)).join(", ")} (npm run build los quita)` : distinto ? `limpio, pero el build es de ${delBuild.slice(0, 12)} y el código de ${commit.slice(0, 12)}: corre npm run build (o npm run actualizar)` : `limpio (sin .env, bases, llaves ni respaldos); build de ${String(delBuild || commit || "versión desconocida").slice(0, 12)}`);
  }
}

/* Reporte */
const malos = resultados.filter((r) => r.estado === MAL).length;
const avisos = resultados.filter((r) => r.estado === AVISO).length;
const resumen = malos ? `${MAL} ${malos} problema(s) que corregir antes de operar${avisos ? ` y ${avisos} aviso(s)` : ""}` : avisos ? `${AVISO} sin problemas bloqueantes; ${avisos} aviso(s) que revisar` : `${OK} todo en orden`;
console.log(`\n${resumen}`);
if (!args.includes("--sin-reporte")) {
  const dir = path.join(entorno.instanceDir, "verificaciones");
  const archivo = path.join(dir, `${selloLocal()}.md`);
  const md = [
    `# Verificación de la instalación de FICOTOX`,
    "",
    `- Fecha: ${marcaLocal()} (hora local del equipo)`,
    `- Equipo: ${os.hostname()} (${plataforma()}, Node ${process.versions.node})`,
    `- Versión de la aplicación: ${versionApp(root).commit || "desconocida"}`,
    `- Base: ${entorno.motor === "sqlite" ? entorno.sqlitePath : "MySQL/MariaDB"}`,
    `- Resultado: ${resumen}`,
    "",
    "| | Revisión | Detalle |",
    "|---|---|---|",
    ...resultados.map((r) => `| ${r.estado} | ${r.nombre} | ${r.detalle.replace(/\|/g, "\\|")} |`),
    "",
  ].join("\n");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(archivo, md);
  console.log(`Reporte: ${archivo}`);
}
process.exit(malos ? 1 : 0);
