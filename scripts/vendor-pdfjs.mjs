/*
 * Biblioteca: copia a public/vendor/pdfjs/ el worker, los cmaps, las fuentes
 * estandar y el wasm de pdfjs-dist. El visor los carga desde el propio
 * servidor (el sistema opera en la red local, sin CDN). Correr despues de
 * actualizar pdfjs-dist:  npm run vendor:pdfjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origen = path.join(root, "node_modules", "pdfjs-dist");
const destino = path.join(root, "public", "vendor", "pdfjs");
fs.rmSync(destino, { recursive: true, force: true });
fs.mkdirSync(destino, { recursive: true });
fs.copyFileSync(path.join(origen, "build", "pdf.worker.min.mjs"), path.join(destino, "pdf.worker.min.mjs"));
for (const dir of ["cmaps", "standard_fonts", "wasm"]) if (fs.existsSync(path.join(origen, dir))) fs.cpSync(path.join(origen, dir), path.join(destino, dir), { recursive: true });
const version = JSON.parse(fs.readFileSync(path.join(origen, "package.json"), "utf8")).version;
fs.writeFileSync(path.join(destino, "VERSION"), `pdfjs-dist ${version}\n`);
console.log(`pdf.js ${version} copiado a public/vendor/pdfjs/`);
