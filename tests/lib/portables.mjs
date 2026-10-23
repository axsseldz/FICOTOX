/*
 * Ayudas de las pruebas de respaldos portables (api-respaldos-portables.mjs,
 * instalacion.mjs y ui/respaldos-portables.mjs).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const sha256 = (ruta) => createHash("sha256").update(fs.readFileSync(ruta)).digest("hex");

/*
 * Sube `datos` (Buffer) por partes: POST `inicio` (con `cuerpo` + tamano y
 * nombre) y PUT de cada trozo. Devuelve { status, data, id } de la ultima
 * respuesta (el id de la subida si todo salio bien).
 */
export async function subirPorPartes({ base, inicio, cuerpo = {}, datos, nombre = "respaldo.ficotox", headers = {} }) {
  const r = await fetch(`${base}${inicio}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ ...cuerpo, tamano: datos.length, nombre }) });
  const data = await r.json().catch(() => null);
  if (r.status !== 201) return { status: r.status, data, id: null };
  for (let desde = 0; desde < datos.length; desde += data.trozo) {
    const p = await fetch(`${base}${inicio}/${data.id}?desde=${desde}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream", ...headers }, body: datos.subarray(desde, desde + data.trozo) });
    const pd = await p.json().catch(() => null);
    if (p.status !== 200) return { status: p.status, data: pd, id: data.id };
  }
  return { status: 201, data, id: data.id };
}

/*
 * Una instalacion ajena (otra computadora): base nueva migrada con su propia
 * llave (instance/auditoria.key) y un respaldo de ella. Devuelve la carpeta del
 * respaldo. Sin el .env de este equipo (FICOTOX_ENV_FILE a un archivo vacio).
 */
export function respaldoAjeno(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "inst"), { recursive: true });
  fs.writeFileSync(path.join(dir, "vacio.env"), "");
  const env = { ...process.env, FICOTOX_ENV_FILE: path.join(dir, "vacio.env"), SECRET_KEY: "", DATABASE_URL: "", SQLITE_PATH: path.join(dir, "inst", "ficotox.sqlite3"), FICOTOX_INSTANCE_DIR: path.join(dir, "inst"), FICOTOX_BACKUP_DIR: path.join(dir, "backups") };
  execFileSync(process.execPath, [path.join(root, "scripts", "migrar-ficotox.mjs")], { cwd: root, env, stdio: "ignore" });
  execFileSync(process.execPath, [path.join(root, "scripts", "respaldar-ficotox.mjs"), "--etiqueta", "Otra computadora"], { cwd: root, env, stdio: "ignore" });
  const id = fs.readdirSync(path.join(dir, "backups")).find((n) => /^\d{8}-\d{6}/.test(n));
  return path.join(dir, "backups", id);
}

/* Lo que debe quedar igual tras recuperar un respaldo en otra computadora (de la base del respaldo, en solo lectura). */
export function fotoDeRespaldo(Database, carpeta) {
  const manifest = JSON.parse(fs.readFileSync(path.join(carpeta, "manifest.json"), "utf8"));
  const db = new Database(path.join(carpeta, "datos", "ficotox.sqlite3"), { readonly: true, fileMustExist: true });
  try {
    return {
      respaldo_id: manifest.id,
      huella_llave: manifest.llave?.huella || null,
      usuarios: db.prepare("SELECT id, email, nombre, activo, password_hash FROM usuarios ORDER BY id").all(),
      reactivos: db.prepare("SELECT id, nombre, producto, cantidad_total, restante, activo FROM reactivos ORDER BY id").all(),
      auditoria: db.prepare("SELECT id, hash FROM auditoria ORDER BY id DESC LIMIT 1").get(),
      archivos: (manifest.archivos || []).map((a) => ({ ruta: a.ruta, sha256: a.sha256 })),
    };
  } finally {
    db.close();
  }
}
