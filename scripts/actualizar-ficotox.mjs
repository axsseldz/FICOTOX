#!/usr/bin/env node
/*
 * Actualizacion de FICOTOX (Fase 12).
 *
 *   npm run actualizar                 (el codigo nuevo ya esta en la carpeta: git pull o zip)
 *   npm run actualizar -- --git        (ademas trae el codigo con git pull --ff-only)
 *   npm run actualizar -- --simular    (solo muestra los pasos)
 *
 * Pasos:
 *   1. respaldo reciente (etiqueta "pre-actualizacion"; en MySQL exige --respaldo-hecho)
 *   2. detener el servidor (servicio o proceso)
 *   3. apartar el build actual (.next -> .next-anterior) e instalar dependencias + build
 *      - si falla: se devuelve el build anterior y el servidor se arranca como estaba
 *   4. migrar (npm run migrar; con su propio respaldo previo)
 *      - si falla sin haber aplicado ninguna: se devuelve el build anterior y se arranca como estaba
 *      - si alcanzaron a aplicarse algunas (cada migracion en su transaccion): se dice en que version
 *        quedo la base y como volver (restaurar el respaldo pre-actualizacion); no se arranca
 *   5. arrancar (servicio si estaba instalado) y comprobar salud (/api/health/db)
 *   6. npm run verificar-instalacion (informativo)
 * Reversion completa (si la version nueva no sirve): ver README.md, «Actualizar».
 * Codigos: 0 bien, 1 fallo (con el servidor como estaba), 2 uso incorrecto.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { crearRespaldo, versionApp } from "../src/lib/shared/respaldo.mjs";
import { versionDe } from "../src/lib/server/migraciones/motor.mjs";
import { abrirBase, arrancarServidor, detenerServidor, entornoDe, esperarSalud, root, servidorEncendido, Sqlite } from "./lib/operacion.mjs";

const args = process.argv.slice(2);
const simular = args.includes("--simular");
const entorno = entornoDe();
const pruebas = process.env.FICOTOX_PRUEBAS === "1";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
// Solo en pruebas: sustituir los comandos pesados (instalar/build) por otros.
const comandoDe = (nombre, porOmision) => (pruebas && process.env[`FICOTOX_PRUEBA_COMANDO_${nombre}`] ? ["sh", ["-c", process.env[`FICOTOX_PRUEBA_COMANDO_${nombre}`]]] : porOmision);
// Solo en pruebas: otra carpeta de build (para no tocar el .next del repositorio).
const raizBuild = pruebas && process.env.FICOTOX_PRUEBA_DIR_BUILD ? path.resolve(process.env.FICOTOX_PRUEBA_DIR_BUILD) : root;
const next = path.join(raizBuild, ".next");
const anterior = path.join(raizBuild, ".next-anterior");
let paso = 0;
const titulo = (t) => console.log(`\n[${++paso}] ${t}`);
const correr = (comando, lista, opciones = {}) => {
  console.log(`$ ${[comando, ...lista].join(" ")}`);
  if (simular) return true;
  const r = spawnSync(comando, lista, { cwd: root, stdio: "inherit", shell: process.platform === "win32", ...opciones });
  return r.status === 0;
};

// Version que corre de verdad: la del build (ficotox-build.json la escribe limpiar-standalone.mjs); si no hay, la del codigo.
const commitCodigo = versionApp(root).commit;
const commitAntes = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(next, "standalone", "ficotox-build.json"), "utf8")).commit || commitCodigo;
  } catch {
    return commitCodigo;
  }
})();
console.log(`FICOTOX · actualizar${simular ? " (simulación)" : ""}\nVersión actual (build en uso): ${commitAntes || "desconocida"}${commitCodigo && commitAntes && commitCodigo !== commitAntes ? ` · el código está en ${commitCodigo}` : ""}`);

if (args.includes("--git")) {
  titulo("Traer el código nuevo (git pull --ff-only)");
  if (!correr("git", ["pull", "--ff-only"])) {
    console.error("❌ git pull falló (¿cambios locales o sin conexión?). No se cambió nada.");
    process.exit(1);
  }
}

/* 1. Respaldo */
titulo("Respaldo previo");
let respaldo = null;
if (entorno.motor !== "sqlite") {
  if (!args.includes("--respaldo-hecho")) {
    console.error("❌ En MySQL/MariaDB respalda antes con mysqldump (README.md) y repite con --respaldo-hecho.");
    process.exit(2);
  }
  console.log("MySQL/MariaDB: respaldo hecho con mysqldump (declarado con --respaldo-hecho).");
} else if (!fs.existsSync(entorno.sqlitePath)) {
  console.log("No hay base todavía: no hace falta respaldo.");
} else if (!simular) {
  respaldo = await crearRespaldo({ Sqlite, sqlitePath: entorno.sqlitePath, instanceDir: entorno.instanceDir, respaldosDir: entorno.respaldosDir, secretKey: entorno.secretKey, baseDir: root, incluirLlave: true, etiqueta: "pre-actualizacion" });
  console.log(`✅ ${respaldo.carpeta}`);
} else console.log(`(se crearía en ${entorno.respaldosDir})`);

/* 2. Detener */
titulo("Detener el servidor");
let estado = { estaba: Boolean(servidorEncendido(entorno.instanceDir)), comoServicio: false };
if (!simular) estado = await detenerServidor(entorno);
console.log(simular ? (estado.estaba ? "(se detendría el servidor)" : "no está encendido") : estado.estaba ? `detenido (${estado.comoServicio ? "servicio" : "proceso"})` : "no estaba encendido");

const volverAArrancar = async () => {
  if (!estado.estaba) return;
  const r = arrancarServidor(estado);
  if (!r.ok) console.error(`⚠️  Arráncalo con: ${r.comando}`);
  else {
    const salud = await esperarSalud(process.env, 180);
    console.log(salud.ok ? `✅ El servidor volvió a arrancar como estaba (${r.como}).` : `⚠️  El servidor no respondió en ${salud.url} (${salud.ultimo}). Revisa <instancia>/logs.`);
  }
};
const devolverBuild = () => {
  if (!fs.existsSync(anterior)) return;
  fs.rmSync(next, { recursive: true, force: true }); // build nuevo incompleto (se regenera con npm run build)
  fs.renameSync(anterior, next);
  console.log("↩️  Se devolvió el build anterior (.next).");
};

/* 3. Instalar y build */
titulo("Instalar dependencias y compilar (build)");
if (!simular) {
  fs.rmSync(anterior, { recursive: true, force: true }); // build apartado en una actualizacion anterior
  if (fs.existsSync(next)) fs.renameSync(next, anterior);
}
const [cmdInstalar, argsInstalar] = comandoDe("INSTALAR", [npm, ["ci", "--no-audit", "--no-fund"]]);
const [cmdBuild, argsBuild] = comandoDe("BUILD", [npm, ["run", "build"]]);
if (!correr(cmdInstalar, argsInstalar) || !correr(cmdBuild, argsBuild) || (!simular && !fs.existsSync(path.join(next, "standalone", "server.js")))) {
  console.error("\n❌ La instalación o el build fallaron: la actualización se detiene. La base no se tocó.");
  devolverBuild();
  // Con --git, el codigo vuelve tambien al commit del build que sigue corriendo (reset --keep conserva cambios locales).
  if (args.includes("--git") && commitAntes && !simular) {
    if (correr("git", ["reset", "--keep", commitAntes])) console.error(`↩️  El código volvió a ${commitAntes} (el del build en uso).`);
    else console.error(`⚠️  No se pudo regresar el código: corre git checkout ${commitAntes} a mano.`);
  } else if (commitAntes) console.error(`ℹ️  El build en uso sigue siendo el de ${commitAntes}; el código de la carpeta es el nuevo (corrígelo o vuelve a copiar la versión anterior).`);
  await volverAArrancar();
  console.error("Corrige el problema (el mensaje de arriba) y repite npm run actualizar.");
  process.exit(1);
}

/* 4. Migrar */
titulo("Migrar la base");
// Version de la base antes de migrar (para decir con verdad en que quedo si una migracion falla).
const versionBase = async () => {
  if (simular) return null;
  try {
    const { db, cerrar } = await abrirBase(entorno);
    try {
      return await versionDe(db);
    } finally {
      await cerrar();
    }
  } catch {
    return null;
  }
};
const versionAntes = await versionBase();
if (!correr(process.execPath, [path.join(root, "scripts", "migrar-ficotox.mjs"), ...(args.includes("--respaldo-hecho") ? ["--respaldo-hecho"] : [])])) {
  const versionDespues = await versionBase();
  devolverBuild();
  if (versionDespues === versionAntes) {
    // La migracion que fallo se deshizo y no se aplico ninguna otra: la base esta como antes y el build anterior sirve.
    console.error(`\n❌ La migración falló y se deshizo: la base sigue en su versión anterior (${versionAntes ?? "sin versionar"}).`);
    await volverAArrancar();
    if (respaldo) console.error(`Respaldo previo: ${respaldo.carpeta}`);
  } else {
    // Cada migracion va en su transaccion: las anteriores a la que fallo quedaron aplicadas y el build anterior ya no arranca con esa base.
    console.error(`\n❌ La migración falló. Las anteriores de esta actualización SÍ quedaron aplicadas: la base pasó de la versión ${versionAntes ?? "sin versionar"} a la ${versionDespues}.`);
    console.error("   El build anterior no arranca con esa base, así que el servidor NO se volvió a arrancar. Dos caminos:");
    console.error("   a) corregir la causa del error de arriba y repetir npm run actualizar (termina las migraciones pendientes), o");
    console.error(`   b) volver exactamente a como estaba: npm run restaurar -- --respaldo ${respaldo ? respaldo.id : "<id del respaldo pre-actualizacion>"} --destino instance --confirmar --responsable "Tu nombre" y arrancar.`);
  }
  process.exit(1);
}

/* 5. Arrancar y salud */
titulo("Arrancar y comprobar");
if (simular) console.log("(se arrancaría el servidor y se consultaría /api/health/db)");
else if (!estado.estaba) console.log("El servidor no estaba encendido: arráncalo con npm run start:standalone (o el servicio).");
else {
  const r = arrancarServidor(estado);
  if (!r.ok) console.log(`⚠️  Arráncalo con: ${r.comando}`);
  else {
    const salud = await esperarSalud(process.env, 180);
    if (!salud.ok) {
      console.error(`❌ El servidor nuevo no respondió en ${salud.url} (${salud.ultimo}). Revisa <instancia>/logs y, si hace falta, revierte (README.md, «Actualizar»).`);
      process.exit(1);
    }
    console.log(`✅ Responde en ${salud.url} (${r.como}).`);
  }
}
fs.rmSync(anterior, { recursive: true, force: true });

/* 6. Verificacion */
titulo("Verificar la instalación");
correr(process.execPath, [path.join(root, "scripts", "verificar-instalacion.mjs")]);
console.log(simular ? "\nSimulación terminada: no se cambió nada." : `\nActualizado: ${commitAntes || "?"} → ${versionApp(root).commit || "?"}.${respaldo ? ` Respaldo previo: ${respaldo.carpeta}` : ""}`);
