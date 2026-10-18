#!/usr/bin/env node
/*
 * Migraciones versionadas de FICOTOX (Fase 12).
 *
 *   npm run migrar                aplica lo pendiente (con respaldo previo)
 *   npm run migrar -- --estado    lista las aplicadas y las pendientes
 *   npm run migrar -- --simular   muestra que haria, sin cambiar nada
 *
 * Aplicar exige el servidor detenido (el servidor migra solo al arrancar si
 * MIGRAR_AL_ARRANCAR=true). Codigos de salida: 0 bien, 1 fallo, 2 uso
 * incorrecto o servidor encendido.
 */
import { crearRespaldo, versionApp } from "../src/lib/shared/respaldo.mjs";
import { aplicarMigraciones, checksumDe, estadoMigraciones, VERSION_ACTUAL } from "../src/lib/server/migraciones/motor.mjs";
import { abrirBase, claveBitacora, entornoDe, root, servidorEncendido, Sqlite } from "./lib/operacion.mjs";

const args = process.argv.slice(2);
const soloEstado = args.includes("--estado");
const simular = args.includes("--simular");
const entorno = entornoDe();
const base = entorno.motor === "sqlite" ? entorno.sqlitePath : "MySQL/MariaDB (DATABASE_URL)";

console.log(`FICOTOX · migraciones (la aplicación conoce hasta la versión ${VERSION_ACTUAL})`);
console.log(`Base: ${base}`);
const { db, cerrar } = await abrirBase(entorno);
let codigo = 0;
try {
  if (soloEstado || simular) {
    const estado = await estadoMigraciones(db, { Sqlite });
    if (estado.tipo === "versionada") {
      console.log(`\nAplicadas (${estado.aplicadas.length}):`);
      for (const a of estado.aplicadas) console.log(`  ✅ ${a.version}  ${a.nombre}  (${a.modo === "baseline" ? "línea base" : `aplicada ${a.aplicada_en}, ${a.duracion_ms} ms`})`);
    } else if (estado.tipo === "sin_versionar") {
      console.log(`\nBase anterior a las migraciones: su esquema coincide con la versión ${estado.lineaBase}; se registrará como línea base (sin ejecutar nada).`);
    } else {
      console.log("\nBase vacía: se creará el esquema completo.");
    }
    console.log(`\nPendientes (${estado.pendientes.length}):`);
    for (const m of estado.pendientes) console.log(`  ⏳ ${m.version}  ${m.nombre}  (checksum ${checksumDe(m).slice(0, 12)}…)`);
    if (!estado.pendientes.length && estado.lineaBase === null) console.log("  (ninguna: la base está al día)");
    if (simular) console.log(`\nSimulación: ${estado.pendientes.length || estado.lineaBase !== null ? `se crearía un respaldo previo${estado.tipo === "vacia" ? " (no: la base está vacía)" : ""}${estado.lineaBase !== null ? `, se registraría la línea base ${estado.lineaBase}` : ""}${estado.pendientes.length ? ` y se aplicarían ${estado.pendientes.map((m) => m.version).join(", ")}` : ""}` : "no hay nada que hacer"}. No se cambió nada.`);
  } else {
    const vivo = servidorEncendido(entorno.instanceDir);
    if (vivo) {
      console.error(`\n❌ El servidor está encendido (pid ${vivo.pid}). Deténlo antes de migrar a mano, o reinícialo: al arrancar aplica las migraciones pendientes.`);
      codigo = 2;
    } else {
      const r = await aplicarMigraciones(db, {
        instanceDir: entorno.instanceDir,
        Sqlite,
        clave: claveBitacora(entorno, true),
        appCommit: versionApp(root).commit,
        respaldo: async () => {
          if (entorno.motor !== "sqlite") {
            if (!args.includes("--respaldo-hecho")) throw new Error("En MySQL/MariaDB respalda antes con mysqldump y vuelve a correr con --respaldo-hecho (ver README.md).");
            return "(respaldo de MySQL hecho con mysqldump)";
          }
          return (await crearRespaldo({ Sqlite, sqlitePath: entorno.sqlitePath, instanceDir: entorno.instanceDir, respaldosDir: entorno.respaldosDir, secretKey: entorno.secretKey, baseDir: root, incluirLlave: true, etiqueta: "pre-migracion" })).carpeta;
        },
        avisar: (m) => console.log(`  · ${m}`),
      });
      if (!r.aplicadas.length && r.lineaBase === null) console.log("\n✅ La base ya está al día; no se cambió nada.");
      else console.log(`\n✅ Base en la versión ${VERSION_ACTUAL}.${r.respaldo ? ` Respaldo previo: ${r.respaldo}` : ""}`);
    }
  }
} catch (error) {
  console.error(`\n❌ ${error.message}`);
  if (error.respaldo) console.error(`Respaldo previo a la migración: ${error.respaldo}`);
  codigo = 1;
} finally {
  await cerrar();
}

process.exit(codigo);
