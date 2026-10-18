/*
 * Manipulacion directa de la base de PRUEBA para comprobar que la bitacora se
 * defiende: triggers que abortan UPDATE/DELETE, deteccion de filas borradas al
 * final y en medio, y reposicion automatica de los triggers.
 *
 * Corre al final de todo porque deja la cadena rota a proposito.
 */
import "./lib/reauth-auto.mjs";
import { createRequire } from "node:module";

const BASE = process.env.BASE || "http://localhost:3100/api";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ""}`);
};

const api = async (path, token) => {
  const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, data: await res.json().catch(() => null) };
};

if (!process.env.TEST_DB_PATH) {
  console.log("(se omite: falta TEST_DB_PATH)");
  process.exit(0);
}

const login = await fetch(`${BASE}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "qa@ficotox.local", password: "QaFicotox2026!" }),
});
const token = (await login.json()).token;

const Database = createRequire(import.meta.url)(process.env.BETTER_SQLITE3 || "better-sqlite3");

const inicial = await api("/audit/verify", token);
check("la cadena esta integra antes de manipularla", inicial.data?.ok === true && inicial.data?.triggers_ok === true, JSON.stringify(inicial.data));

// 1) Los triggers impiden modificar una entrada.
{
  const db = new Database(process.env.TEST_DB_PATH);
  const resultado = (() => {
    try {
      db.prepare("UPDATE auditoria SET motivo = 'x' WHERE id = 1").run();
      return "permitido";
    } catch (err) {
      return String(err.message);
    }
  })();
  const borrado = (() => {
    try {
      db.prepare("DELETE FROM auditoria WHERE id = 1").run();
      return "permitido";
    } catch (err) {
      return String(err.message);
    }
  })();
  db.close();
  check("UPDATE directo en auditoria lo aborta el trigger", /no se modifica/.test(resultado), resultado);
  check("DELETE directo en auditoria lo aborta el trigger", /no se elimina/.test(borrado), borrado);
}

// 2) Alterar el contenido de una entrada rompe el sello.
{
  const db = new Database(process.env.TEST_DB_PATH);
  db.exec("DROP TRIGGER IF EXISTS auditoria_sin_update; DROP TRIGGER IF EXISTS auditoria_sin_delete");
  const objetivo = db.prepare("SELECT id, motivo FROM auditoria ORDER BY id LIMIT 1 OFFSET 2").get();
  db.prepare("UPDATE auditoria SET motivo = 'motivo cambiado a mano' WHERE id = ?").run(objetivo.id);
  db.close();
  const alterada = await api("/audit/verify", token);
  check("alterar una entrada se detecta y los triggers se reponen", alterada.data?.ok === false && alterada.data?.primer_error === objetivo.id && alterada.data?.triggers_ok === true, JSON.stringify(alterada.data));
  // Se deja como estaba para las siguientes comprobaciones.
  const db2 = new Database(process.env.TEST_DB_PATH);
  db2.exec("DROP TRIGGER IF EXISTS auditoria_sin_update; DROP TRIGGER IF EXISTS auditoria_sin_delete");
  db2.prepare("UPDATE auditoria SET motivo = ? WHERE id = ?").run(objetivo.motivo, objetivo.id);
  db2.close();
  const restaurada = await api("/audit/verify", token);
  check("al deshacer el cambio la cadena vuelve a estar integra", restaurada.data?.ok === true, JSON.stringify(restaurada.data));
}

// 3) Borrar entradas del final (el sello por si solo no lo notaria).
{
  const db = new Database(process.env.TEST_DB_PATH);
  db.exec("DROP TRIGGER IF EXISTS auditoria_sin_update; DROP TRIGGER IF EXISTS auditoria_sin_delete");
  db.prepare("DELETE FROM auditoria WHERE id > (SELECT MAX(id) - 2 FROM auditoria)").run();
  db.close();
  const cola = await api("/audit/verify", token);
  check("borrar las ultimas filas se detecta y los triggers se reponen", cola.data?.ok === false && cola.data?.filas_faltantes_al_final === 2 && cola.data?.triggers_ok === true, JSON.stringify(cola.data));
}

// 4) Borrar una entrada intermedia y recalcular la cadena: el hueco de ids la delata.
{
  const db = new Database(process.env.TEST_DB_PATH);
  db.exec("DROP TRIGGER IF EXISTS auditoria_sin_update; DROP TRIGGER IF EXISTS auditoria_sin_delete");
  const medio = db.prepare("SELECT id FROM auditoria ORDER BY id LIMIT 1 OFFSET 3").get();
  db.prepare("DELETE FROM auditoria WHERE id = ?").run(medio.id);
  db.close();
  const hueco = await api("/audit/verify", token);
  check("borrar una entrada intermedia se detecta por el hueco de ids", hueco.data?.ok === false && hueco.data?.filas_faltantes_intermedias >= 1, JSON.stringify(hueco.data));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} pruebas OK`);
process.exit(failed.length ? 1 : 0);
