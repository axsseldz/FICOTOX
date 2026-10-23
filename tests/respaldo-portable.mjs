/*
 * Formato del respaldo portable (.ficotox), sin servidor
 * (src/lib/shared/respaldo-portable.mjs):
 * - Ida y vuelta byte a byte; contraseña incorrecta; archivo alterado (en el
 *   encabezado, en un trozo y cambiando trozos de lugar), truncado, con datos de
 *   mas y que no es un respaldo. Nunca queda nada a medias en el destino.
 * - Respaldo grande (~600 MB): se cifra y descifra en flujo, sin que la memoria
 *   del proceso crezca con el tamaño.
 * - Rutas maliciosas dentro del archivo (.., absolutas, unidades de Windows,
 *   barras invertidas, nombres reservados) y archivos no declarados: se rechazan
 *   sin escribir fuera del destino.
 * - Nombres validos en Windows y la logica de rutas con path.win32 (no se puede
 *   correr Windows desde esta Mac: se cubre la logica).
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { abrirPortable, claveDeArchivo, entradasDeRespaldo, ErrorPortable, escribirPortable, flujoPortable, leerEncabezado, nombreValidoEnWindows, prepararCifrado, rutaLocal, rutaPortableValida, tamanoPortable, validarContrasena } from "../src/lib/shared/respaldo-portable.mjs";
import { FORMATO } from "../src/lib/shared/respaldo.mjs";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ficotox-portable-"));
const CONTRASENA = "contraseña de prueba 123";
const sha = (ruta) => createHash("sha256").update(fs.readFileSync(ruta)).digest("hex");
const codigoDe = async (fn) => {
  try {
    await fn();
    return "ok";
  } catch (error) {
    return error instanceof ErrorPortable ? error.codigo : `otro: ${error?.message}`;
  }
};

/* Un respaldo de juguete con la forma de los reales (ficha, base, llave y archivos). */
function respaldoDePrueba(nombre, archivos = { "archivos/informes/IR-0000001-v1.pdf": randomBytes(70_000), "archivos/evidencias/muestras/1/foto con espacios ñ.jpg": randomBytes(3_000_000), "archivos/informes/vacío.txt": Buffer.alloc(0) }) {
  const carpeta = path.join(TMP, nombre);
  const base = randomBytes(2_500_000);
  const escribir = (rel, datos) => {
    fs.mkdirSync(path.dirname(path.join(carpeta, rel)), { recursive: true });
    fs.writeFileSync(path.join(carpeta, rel), datos);
  };
  escribir("datos/ficotox.sqlite3", base);
  escribir("llave/llave-bitacora.txt", "llave-de-prueba\n");
  for (const [rel, datos] of Object.entries(archivos)) escribir(rel, datos);
  const manifest = { formato: FORMATO, id: nombre, base: { ruta: "datos/ficotox.sqlite3" }, llave: { incluida: true, ruta: "llave/llave-bitacora.txt" }, archivos: Object.entries(archivos).map(([ruta, datos]) => ({ ruta, tamano: datos.length })) };
  escribir("manifest.json", JSON.stringify(manifest));
  return carpeta;
}
const rutasDe = (carpeta) => ["manifest.json", "datos/ficotox.sqlite3", "llave/llave-bitacora.txt", ...JSON.parse(fs.readFileSync(path.join(carpeta, "manifest.json"), "utf8")).archivos.map((a) => a.ruta)];

/* ---------- Ida y vuelta ---------- */
const carpeta = respaldoDePrueba("20260101-000000");
const archivo = path.join(TMP, "r.ficotox");
{
  const r = await escribirPortable(carpeta, CONTRASENA, archivo);
  const destino = path.join(TMP, "vuelta");
  const abierto = await abrirPortable({ archivo, contrasena: CONTRASENA, destino });
  const distintos = rutasDe(carpeta).filter((r) => sha(path.join(carpeta, r)) !== sha(path.join(destino, r)));
  check("ida y vuelta: todo idéntico byte a byte (incluye archivo vacío, espacios y acentos)", abierto.archivos === rutasDe(carpeta).length && distintos.length === 0 && r.entradas === abierto.archivos, `${abierto.archivos} ${distintos}`);
  const enc = leerEncabezado(archivo);
  const cifrado = { ...(await prepararCifrado(CONTRASENA)) };
  check("el tamaño anunciado es exacto", tamanoPortable(entradasDeRespaldo(carpeta), cifrado).archivo === fs.statSync(archivo).size, `${fs.statSync(archivo).size}`);
  check("el encabezado declara AES-256-GCM y scrypt con sal aleatoria", enc.parametros?.cifrado?.algoritmo === "aes-256-gcm" && enc.parametros?.kdf?.algoritmo === "scrypt" && enc.kdf.N >= 131072 && enc.sal.length === 16, JSON.stringify(enc.parametros || {}).slice(0, 200));
  const otro = path.join(TMP, "r2.ficotox");
  await escribirPortable(carpeta, CONTRASENA, otro);
  check("dos descargas del mismo respaldo con la misma contraseña no son iguales (sal y nonce nuevos)", sha(otro) !== sha(archivo) && !leerEncabezado(otro).sal.equals(enc.sal));
  // Despues del encabezado (que solo trae los parametros del cifrado) nada es legible.
  const datos = fs.readFileSync(archivo);
  const texto = datos.subarray(13 + datos.readUInt32BE(9)).toString("latin1");
  check("nada legible dentro (ni nombres de archivo ni la ficha)", !texto.includes("informes") && !texto.includes(`"${FORMATO}"`) && !texto.includes("llave-de-prueba") && !datos.toString("latin1").includes("IR-0000001"));
}

/* ---------- Contraseñas ---------- */
{
  check("contraseña de cifrado: mínimo 12 caracteres", !!validarContrasena("once caract") && !validarContrasena("doce caracte") && (await codigoDe(() => prepararCifrado("corta"))) === "contrasena_debil");
  const destino = path.join(TMP, "mala");
  const c = await codigoDe(() => abrirPortable({ archivo, contrasena: "contraseña de prueba 124", destino }));
  check("contraseña incorrecta: contrasena_incorrecta y no se crea el destino", c === "contrasena_incorrecta" && !fs.existsSync(destino), c);
  const mayus = await codigoDe(() => claveDeArchivo(leerEncabezado(archivo), CONTRASENA.toUpperCase()));
  check("distingue mayúsculas y minúsculas", mayus === "contrasena_incorrecta", mayus);
}

/* ---------- Archivos dañados ---------- */
const original = fs.readFileSync(archivo);
const intentar = async (nombre, datos) => {
  const ruta = path.join(TMP, `${nombre}.ficotox`);
  fs.writeFileSync(ruta, datos);
  const destino = path.join(TMP, `${nombre}-destino`);
  const codigo = await codigoDe(() => abrirPortable({ archivo: ruta, contrasena: CONTRASENA, destino }));
  return { codigo, limpio: !fs.existsSync(destino) };
};
{
  const largoEnc = 13 + original.readUInt32BE(9);
  const enMedio = Buffer.from(original);
  enMedio[Math.floor(original.length / 2)] ^= 0x80;
  const enFinal = Buffer.from(original);
  enFinal[original.length - 3] ^= 0x01;
  const enEncabezado = Buffer.from(original);
  enEncabezado[largoEnc - 3] ^= 0x01;
  // Dos trozos completos intercambiados (cada uno con su sello valido): el orden tambien esta sellado.
  const trozo = 1024 * 1024 + 16;
  const cambiados = Buffer.concat([original.subarray(0, largoEnc), original.subarray(largoEnc + trozo, largoEnc + 2 * trozo), original.subarray(largoEnc, largoEnc + trozo), original.subarray(largoEnc + 2 * trozo)]);
  for (const [nombre, datos, esperado] of [
    ["un byte cambiado a la mitad", enMedio, ["archivo_alterado"]],
    ["un byte cambiado en el último trozo", enFinal, ["archivo_alterado"]],
    ["el encabezado cambiado", enEncabezado, ["archivo_alterado", "archivo_danado", "contrasena_incorrecta"]],
    ["dos trozos cambiados de lugar", cambiados, ["archivo_alterado"]],
    ["truncado a la mitad", original.subarray(0, Math.floor(original.length / 2)), ["archivo_truncado"]],
    ["truncado por 1 byte", original.subarray(0, original.length - 1), ["archivo_truncado"]],
    ["sin el último trozo completo", original.subarray(0, original.length - ((original.length - largoEnc) % trozo || trozo)), ["archivo_truncado"]],
    ["con datos de más al final", Buffer.concat([original, Buffer.from("x")]), ["archivo_danado"]],
    ["un ZIP cualquiera", Buffer.concat([Buffer.from("PK\u0003\u0004"), randomBytes(5000)]), ["no_es_respaldo"]],
    ["un archivo vacío", Buffer.alloc(0), ["no_es_respaldo"]],
  ]) {
    const r = await intentar(nombre.replace(/\W+/g, "-"), datos);
    check(`${nombre}: se rechaza (${esperado[0]}) sin dejar nada`, esperado.includes(r.codigo) && r.limpio, `${r.codigo} limpio=${r.limpio}`);
  }
  const otraVersion = Buffer.from(original);
  otraVersion[8] = 99;
  const v = await intentar("version", otraVersion);
  check("una versión del formato desconocida se explica (version_no_soportada)", v.codigo === "version_no_soportada" && v.limpio, v.codigo);
  const destinoOcupado = path.join(TMP, "ocupado");
  fs.mkdirSync(destinoOcupado);
  check("nunca escribe sobre una carpeta que ya existe", (await codigoDe(() => abrirPortable({ archivo, contrasena: CONTRASENA, destino: destinoOcupado }))) === "destino_ocupado" && fs.readdirSync(destinoOcupado).length === 0);
  const limite = await codigoDe(() => abrirPortable({ archivo, contrasena: CONTRASENA, destino: path.join(TMP, "limite"), limiteBytes: 1_000_000 }));
  check("más grande que el límite: demasiado_grande, sin dejar nada", limite === "demasiado_grande" && !fs.existsSync(path.join(TMP, "limite")), limite);
}

/* ---------- Contenido malicioso (cifrado con la contraseña correcta) ---------- */
async function portableCon(entradas, nombre) {
  const cifrado = await prepararCifrado(CONTRASENA);
  const ruta = path.join(TMP, `${nombre}.ficotox`);
  const partes = [];
  for await (const p of flujoPortable(entradas, cifrado)) partes.push(p);
  fs.writeFileSync(ruta, Buffer.concat(partes));
  return ruta;
}
{
  const manifest = path.join(carpeta, "manifest.json");
  const base = path.join(carpeta, "datos", "ficotox.sqlite3");
  const pdf = path.join(carpeta, "archivos/informes/IR-0000001-v1.pdf");
  const e = (ruta, absoluta) => ({ ruta, absoluta, tamano: fs.statSync(absoluta).size });
  const fuera = path.join(TMP, "fuera.txt");
  for (const [nombre, ruta] of [
    ["subir con ..", "../fuera.txt"],
    ["subir con .. en medio", "archivos/../../fuera.txt"],
    ["ruta absoluta", "/tmp/fuera.txt"],
    ["unidad de Windows", "C:/Windows/fuera.txt"],
    ["barra invertida", "archivos\\..\\..\\fuera.txt"],
    ["nombre reservado de Windows", "archivos/informes/CON.pdf"],
    ["dos puntos (flujo alterno NTFS)", "archivos/informes/a.pdf:secreto"],
    ["punto al final", "archivos/informes/a.pdf."],
    ["carácter de control", "archivos/informes/a\u0001.pdf"],
  ]) {
    const r = await portableCon([e("manifest.json", manifest), e(ruta, pdf), e("datos/ficotox.sqlite3", base)], `malo-${nombre.replace(/\W+/g, "-")}`);
    const destino = path.join(TMP, `malo-destino-${results.length}`);
    const c = await codigoDe(() => abrirPortable({ archivo: r, contrasena: CONTRASENA, destino }));
    check(`ruta maliciosa (${nombre}): se rechaza sin escribir fuera ni dejar nada`, c === "archivo_danado" && !fs.existsSync(fuera) && !fs.existsSync(destino), c);
  }
  const noDeclarado = await portableCon([e("manifest.json", manifest), e("archivos/informes/extra.pdf", pdf), e("datos/ficotox.sqlite3", base)], "no-declarado");
  check("un archivo que la ficha no declara se rechaza", (await codigoDe(() => abrirPortable({ archivo: noDeclarado, contrasena: CONTRASENA, destino: path.join(TMP, "nd") }))) === "archivo_danado" && !fs.existsSync(path.join(TMP, "nd")));
  const duplicado = await portableCon([e("manifest.json", manifest), e("datos/ficotox.sqlite3", base), e("datos/ficotox.sqlite3", base)], "duplicado");
  check("una ruta repetida se rechaza", (await codigoDe(() => abrirPortable({ archivo: duplicado, contrasena: CONTRASENA, destino: path.join(TMP, "dup") }))) === "archivo_danado");
  const sinFicha = await portableCon([e("datos/ficotox.sqlite3", base), e("manifest.json", manifest)], "sin-ficha");
  check("si no empieza con la ficha se rechaza", (await codigoDe(() => abrirPortable({ archivo: sinFicha, contrasena: CONTRASENA, destino: path.join(TMP, "sf") }))) === "archivo_danado");
  const sinBase = await portableCon([e("manifest.json", manifest)], "sin-base");
  check("sin la base de datos se rechaza", (await codigoDe(() => abrirPortable({ archivo: sinBase, contrasena: CONTRASENA, destino: path.join(TMP, "sb") }))) === "archivo_danado" && !fs.existsSync(path.join(TMP, "sb")));
  const noFicotox = path.join(TMP, "otra-ficha.json");
  fs.writeFileSync(noFicotox, JSON.stringify({ formato: "otra-cosa" }));
  const fichaAjena = await portableCon([e("manifest.json", noFicotox), e("datos/ficotox.sqlite3", base)], "ficha-ajena");
  check("una ficha que no es de FICOTOX se rechaza", (await codigoDe(() => abrirPortable({ archivo: fichaAjena, contrasena: CONTRASENA, destino: path.join(TMP, "fa") }))) === "archivo_danado");
  const malDeclarado = respaldoDePrueba("20260101-000001");
  const m = JSON.parse(fs.readFileSync(path.join(malDeclarado, "manifest.json"), "utf8"));
  m.archivos.push({ ruta: "archivos/../../salir.txt", tamano: 1 });
  fs.writeFileSync(path.join(malDeclarado, "manifest.json"), JSON.stringify(m));
  check("al descargar, una ficha con rutas raras se rechaza (respaldo_danado)", (await codigoDe(() => entradasDeRespaldo(malDeclarado))) === "respaldo_danado");
}

/* ---------- Nombres y rutas validos en Windows (logica con path.win32) ---------- */
{
  const malos = ["CON", "con.txt", "NUL", "COM1.pdf", "LPT9", "a<b", "a>b", 'a"b', "a|b", "a?b", "a*b", "a:b", "fin.", "fin ", "", ".", ".."];
  const buenos = ["ficotox-respaldo-20261023-131524.ficotox", "IR-0000001-v1.pdf", "foto con espacios ñ.jpg", "CONSOLA.txt", "com10.txt", "a.b.c"];
  check("nombres no válidos en Windows se reconocen", malos.every((n) => !nombreValidoEnWindows(n)), malos.filter((n) => nombreValidoEnWindows(n)).join(","));
  check("nombres válidos en Windows se aceptan", buenos.every((n) => nombreValidoEnWindows(n)), buenos.filter((n) => !nombreValidoEnWindows(n)).join(","));
  check("rutas del respaldo: solo relativas, con «/», sin «..»", rutaPortableValida("archivos/sgc/1/2/a.pdf") && !rutaPortableValida("archivos\\a.pdf") && !rutaPortableValida("/a") && !rutaPortableValida("archivos//a") && !rutaPortableValida("a/../b"));
  const w = rutaLocal("C:\\FICOTOX\\backups\\x", "archivos/informes/IR-1.pdf", path.win32);
  check("en Windows la ruta local usa «\\» y queda dentro del destino", w === "C:\\FICOTOX\\backups\\x\\archivos\\informes\\IR-1.pdf", w);
  check("en Windows nada se sale del destino ni cambia de unidad", rutaLocal("C:\\FICOTOX\\x", "../y", path.win32) === null && rutaLocal("C:\\FICOTOX\\x", "D:/y", path.win32) === null && rutaLocal("C:\\FICOTOX\\x", "archivos\\..\\..\\y", path.win32) === null);
  const p = rutaLocal("/srv/ficotox/x", "archivos/a.pdf", path.posix);
  check("en Mac/Linux la ruta local usa «/»", p === "/srv/ficotox/x/archivos/a.pdf", p);
  const largo = `archivos/${"a".repeat(300)}.pdf`;
  check("un nombre más largo que lo que admite Windows (255) se rechaza", !rutaPortableValida(largo));
}

/* ---------- Respaldo grande: en flujo, sin que crezca la memoria ---------- */
{
  const grande = path.join(TMP, "grande");
  const datos = path.join(grande, "archivos/evidencias/video.bin");
  fs.mkdirSync(path.dirname(datos), { recursive: true });
  fs.mkdirSync(path.join(grande, "datos"), { recursive: true });
  // 600 MB sin ocupar memoria: se escribe por bloques de 8 MB.
  const MB = 600;
  const fd = fs.openSync(datos, "w");
  const bloque = randomBytes(8 * 1024 * 1024);
  for (let i = 0; i < MB / 8; i += 1) fs.writeSync(fd, bloque);
  fs.closeSync(fd);
  fs.writeFileSync(path.join(grande, "datos/ficotox.sqlite3"), randomBytes(1024));
  fs.writeFileSync(path.join(grande, "manifest.json"), JSON.stringify({ formato: FORMATO, id: "20260101-000002", base: { ruta: "datos/ficotox.sqlite3" }, llave: { incluida: false }, archivos: [{ ruta: "archivos/evidencias/video.bin", tamano: MB * 1024 * 1024 }] }));
  const salida = path.join(TMP, "grande.ficotox");
  const antes = process.memoryUsage().rss;
  let pico = antes;
  const vigia = setInterval(() => (pico = Math.max(pico, process.memoryUsage().rss)), 50);
  const t0 = Date.now();
  await escribirPortable(grande, CONTRASENA, salida);
  const destino = path.join(TMP, "grande-vuelta");
  await abrirPortable({ archivo: salida, contrasena: CONTRASENA, destino });
  clearInterval(vigia);
  const iguales = sha(datos) === sha(path.join(destino, "archivos/evidencias/video.bin"));
  const crecio = (pico - antes) / 1048576;
  check(`respaldo de ${MB} MB: ida y vuelta idéntica`, iguales, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  check(`respaldo de ${MB} MB: la memoria no crece con el tamaño (< 200 MB)`, crecio < 200, `creció ${crecio.toFixed(0)} MB`);
  fs.rmSync(grande, { recursive: true, force: true });
  fs.rmSync(destino, { recursive: true, force: true });
  fs.rmSync(salida, { force: true });
}

fs.rmSync(TMP, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} pruebas del formato portable pasaron`);
process.exit(failed ? 1 : 0);
