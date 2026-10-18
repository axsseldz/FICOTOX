#!/usr/bin/env node
/*
 * Carga inicial del "Inventario General" del laboratorio (Excel) a FICOTOX.
 *
 *   npm run cargar-inventario -- <ruta.xlsx> [--db ruta.sqlite3] [--usuario correo]
 *                                 [--reporte ruta.md] [--simular]
 *
 * Lee las hojas Ácidos, Alcoholes y solventes orgánicos, Compuestos de Amonio,
 * Compuestos de Sodio, Columnas cromatográficas y Consumibles, y carga reactivos,
 * columnas y consumibles con sus movimientos ("Existencia inicial", descuentos e
 * ingresos). Es REPETIBLE: un registro que ya existe (misma categoría, ID interno,
 * producto y datos de identificación) no se duplica. Todo queda en la bitácora
 * sellada como "Carga inicial de inventario" a nombre de la cuenta indicada
 * (por omisión jorge@ficotox.local). Con --simular no escribe nada.
 *
 * Solo SQLite y con la plataforma detenida. Las fórmulas del Excel se leen por su
 * VALOR calculado. Escribe el reporte en ~/Downloads/CARGA_INVENTARIO.md.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { construirRegistro, primerEslabonRoto, resolverClaveSello, sellar } from "../src/lib/shared/audit-chain.mjs";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const fail = (message) => {
  console.error(`\n${message}`);
  process.exit(1);
};
const argValue = (name) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : undefined;
};
const SIMULAR = process.argv.includes("--simular");
const MOTIVO = "Carga inicial de inventario";

/* ---------- Entorno ---------- */

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    const name = key.trim().replace(/^export\s+/, "");
    const value = rest.join("=").trim().replace(/^(["'])(.*)\1$/, "$2");
    if (name && !(name in process.env)) process.env[name] = value;
  }
}
loadEnvFile(path.join(rootDir, ".env"));
const databaseUrl = (process.env.DATABASE_URL || "").trim();
if (databaseUrl && !databaseUrl.startsWith("sqlite:")) fail("Este script solo aplica a SQLite.");
const sqlitePath = argValue("--db")
  ? path.resolve(rootDir, argValue("--db"))
  : path.resolve(rootDir, (process.env.SQLITE_PATH || "").trim() || "instance/ficotox.sqlite3");
const instanceDir = process.env.FICOTOX_INSTANCE_DIR ? path.resolve(rootDir, process.env.FICOTOX_INSTANCE_DIR) : path.dirname(sqlitePath);

const archivoXlsx = process.argv.slice(2).find((a, i, all) => !a.startsWith("--") && !["--db", "--usuario", "--reporte"].includes(all[i - 1]));
if (!archivoXlsx) fail("Indica la ruta del Excel: npm run cargar-inventario -- <ruta.xlsx>");
const rutaXlsx = path.resolve(archivoXlsx.replace(/^~(?=$|\/)/, os.homedir()));
if (!fs.existsSync(rutaXlsx)) fail(`No existe ${rutaXlsx}`);
if (!fs.existsSync(sqlitePath)) fail(`No existe la base ${sqlitePath}. Aplica las migraciones (npm run migrar) y repite.`);
const rutaReporte = path.resolve((argValue("--reporte") || path.join(os.homedir(), "Downloads", "CARGA_INVENTARIO.md")).replace(/^~(?=$|\/)/, os.homedir()));

/* ---------- Utilidades de lectura ---------- */

const XLSX = require(path.join(rootDir, "public/vendor/xlsx/xlsx.full.min.js"));
const libro = XLSX.read(fs.readFileSync(rutaXlsx), { type: "buffer", cellFormula: true });

const sinAcentos = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const hojaPor = (nombre) => {
  const n = libro.SheetNames.find((s) => sinAcentos(s) === sinAcentos(nombre));
  return n ? { nombre: n, ws: libro.Sheets[n] } : null;
};
const celda = (ws, fila, col) => ws[XLSX.utils.encode_cell({ r: fila, c: col })];
const valor = (ws, fila, col) => {
  const c = col === undefined || col < 0 ? undefined : celda(ws, fila, col);
  return c === undefined ? undefined : c.v;
};
const texto = (v) => (v === undefined || v === null ? "" : String(v).replace(/\s+/g, " ").trim());
const vacioMarca = (t) => !t || t === "-" || /^s\/?d$/i.test(t) || /^n\/?a$/i.test(t);
const limpio = (v) => {
  const t = texto(v);
  return vacioMarca(t) ? null : t;
};
const numero = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const t = texto(v).replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number.parseFloat(t) : null;
};
const redondear = (n) => Math.round(n * 1e9) / 1e9;

const hoy = new Date().toLocaleDateString("en-CA");

/* Fechas: serial de Excel, texto M/D/AAAA (formato de EE. UU.) o ISO. Un año solo o un texto raro no son fecha. */
function fecha(v) {
  if (v === undefined || v === null) return { iso: null, nota: null };
  const esFechaValida = (a, m, d) => {
    const f = new Date(Date.UTC(a, m - 1, d));
    return a >= 1950 && a <= 2100 && f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
  };
  const aIso = (a, m, d) => `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (typeof v === "number") {
    if (Number.isInteger(v) && v >= 1900 && v <= 2100) return { iso: null, nota: `solo se indica el año (${v})` };
    if (v >= 20000 && v < 80000) {
      const f = new Date(Math.floor(v - 25569) * 86400000);
      return { iso: f.toISOString().slice(0, 10), nota: null };
    }
    return { iso: null, nota: `valor numérico que no es fecha (${v})` };
  }
  const t = texto(v);
  if (vacioMarca(t) || /^s\/?f$/i.test(t)) return { iso: null, nota: null };
  if (/^\d{4}$/.test(t)) return { iso: null, nota: `solo se indica el año (${t})` };
  if (/^\d{5}$/.test(t)) return fecha(Number(t));
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(t);
  if (m && esFechaValida(+m[1], +m[2], +m[3])) return { iso: aIso(+m[1], +m[2], +m[3]), nota: null };
  m = /^(\d{1,2})\/(\d{1,3})\/(\d{4})$/.exec(t);
  if (m && esFechaValida(+m[3], +m[1], +m[2])) return { iso: aIso(+m[3], +m[1], +m[2]), nota: null };
  return { iso: null, nota: `texto que no es una fecha («${t}»)` };
}

/* ---------- CAS ---------- */

const digitoCas = (cuerpo) => {
  const d = cuerpo.replace(/\D/g, "").split("").reverse();
  return d.reduce((suma, ch, i) => suma + Number(ch) * (i + 1), 0) % 10;
};
const casValido = (cas) => {
  const m = /^(\d{2,7})-(\d{2})-(\d)$/.exec(cas);
  return !!m && digitoCas(m[1] + m[2]) === Number(m[3]);
};
/* 7647010 -> 7647-01-0 solo si el dígito verificador cuadra. */
const casSinGuiones = (t) => {
  if (!/^\d{5,8}$/.test(t)) return null;
  const cas = `${t.slice(0, -3)}-${t.slice(-3, -1)}-${t.slice(-1)}`;
  return casValido(cas) ? cas : null;
};

/* "#catalogo/ #parte/ CAS/ lote" de reactivos -> { cas, lote, catalogo, dudoso }. */
function separarIdentificacion(original) {
  const tokens = texto(original).split("/").map((t) => t.trim()).filter((t) => t && t !== "-");
  let cas = null;
  let dudoso = false;
  let usado = -1;
  const iPatron = tokens.findIndex((t) => /^\d{2,7}-\d{2}-\d$/.test(t));
  if (iPatron >= 0) {
    cas = tokens[iPatron];
    usado = iPatron;
    dudoso = !casValido(cas);
  } else {
    for (let i = 0; i < tokens.length && cas === null; i += 1) {
      const c = casSinGuiones(tokens[i]);
      if (c) {
        cas = c;
        usado = i;
      }
    }
  }
  const resto = tokens.filter((_, i) => i !== usado);
  const iLote = resto.findIndex((t) => /[A-Za-z0-9]/.test(t));
  const lote = iLote >= 0 ? resto[iLote] : null;
  const catalogo = resto.filter((_, i) => i !== iLote).join(" / ") || null;
  return { cas, lote, catalogo, dudoso };
}

/* ---------- Catálogos ---------- */

const CONTENEDORES = [
  ["botella de vidrio ambar", "Botella de vidrio ámbar"],
  ["botella de plastico", "Botella de plástico"],
  ["botella", "Botella"],
  ["ampolleta", "Ampolleta"],
  ["vial", "Vial"],
  ["bidon", "Bidón"],
  ["sobre", "Sobre"],
];
const CONTENEDORES_CONSUMIBLE = [
  ["caja", "Caja"],
  ["bolsa", "Bolsa"],
  ["rollo", "Rollo"],
  ["bote", "Bote"],
];
const normalizarContenedor = (v, catalogo, problemas) => {
  const t = sinAcentos(texto(v));
  if (!t || t === "-") return null;
  const hit = catalogo.find(([clave]) => t === clave);
  if (hit) return hit[1];
  problemas(`contenedor «${texto(v)}» no está en la lista; se guarda como «Otro»`);
  return "Otro";
};
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre"];

/* ---------- Base y bitácora ---------- */

const Database = require("better-sqlite3");
const db = new Database(sqlitePath);
const tablas = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
for (const t of ["reactivos", "consumibles", "movimientos", "auditoria", "usuarios"]) if (!tablas.has(t)) fail(`Falta la tabla ${t}: aplica las migraciones (npm run migrar).`);
const columnasMov = new Set(db.prepare("PRAGMA table_info(movimientos)").all().map((c) => c.name));
if (!columnasMov.has("fecha_movimiento") || !db.prepare("PRAGMA table_info(consumibles)").all().some((c) => c.name === "existencia")) fail("La base no tiene las migraciones 19 y 20 del inventario; corre npm run migrar.");

const correoActor = (argValue("--usuario") || "jorge@ficotox.local").trim().toLowerCase();
const actor = db.prepare("SELECT id, nombre, email FROM usuarios WHERE LOWER(email) = ?").get(correoActor);
if (!actor) fail(`No existe el usuario ${correoActor}.`);
const ACTOR = { sub: String(actor.id), nombre: actor.nombre, email: actor.email };
const CLAVE = resolverClaveSello(process.env.SECRET_KEY, instanceDir);
const insertarAuditoria = db.prepare(
  `INSERT INTO auditoria (fecha_hora, usuario_id, usuario_nombre, usuario_email, accion, entidad, entidad_id, referencia, motivo, cambios_json, datos_anteriores_json, datos_nuevos_json, hash_anterior, hash)
   VALUES (@fecha_hora, @usuario_id, @usuario_nombre, @usuario_email, @accion, @entidad, @entidad_id, @referencia, @motivo, @cambios_json, @datos_anteriores_json, @datos_nuevos_json, @hash_anterior, @hash)`,
);
function auditar(entry) {
  const previo = db.prepare("SELECT hash FROM auditoria ORDER BY id DESC LIMIT 1").get();
  const registro = construirRegistro({ motivo: MOTIVO, ...entry }, ACTOR, previo?.hash || null);
  if (registro) insertarAuditoria.run({ ...registro, hash: sellar(registro, CLAVE) });
}

const insertarReactivo = db.prepare(
  `INSERT INTO reactivos (tipo_reactivo, categoria, producto, nombre, id_interno, id_reactivo, codigo_interno, marca, proveedor, catalogo, cas, numero_cas, lote,
     localizacion, ubicacion, fecha_ingreso, fecha_apertura, caducidad, expiration_date, fecha_vencimiento, caducidad_indefinida, contenedor, capacidad, unidad_capacidad,
     piezas, cantidad_total, unidad_total, unidad, cantidad_actual, stock_maximo, parte, numero_parte, serie, descripcion, nuevo_usado, metodo, observaciones, extra_json)
   VALUES (@tipo_reactivo, @tipo_reactivo, @producto, @producto, @id_interno, @id_interno, @id_interno, @marca, @proveedor, @catalogo, @cas, @cas, @lote,
     @localizacion, @localizacion, @fecha_ingreso, @fecha_apertura, @caducidad, @caducidad, @caducidad, @caducidad_indefinida, @contenedor, @capacidad, @unidad_capacidad,
     @piezas, @cantidad_total, @unidad_total, @unidad, @cantidad_actual, @stock_maximo, @parte, @parte, @serie, @descripcion, @nuevo_usado, @metodo, @observaciones, '{}')`,
);
const insertarConsumible = db.prepare(
  `INSERT INTO consumibles (producto, marca, proveedor, catalogo_parte_cas, lote, fecha_ingreso, tamano_capacidad, contenedor, piezas, cantidad_por_pieza, observaciones, existencia, stock_maximo, creado_por)
   VALUES (@producto, @marca, @proveedor, @catalogo_parte_cas, @lote, @fecha_ingreso, @tamano_capacidad, @contenedor, @piezas, @cantidad_por_pieza, @observaciones, @existencia, @stock_maximo, @creado_por)`,
);
const insertarMovimiento = db.prepare(
  `INSERT INTO movimientos (tipo, tabla_origen, id_item, cantidad, motivo, referencia, id_usuario, unidad, fecha_movimiento)
   VALUES (@tipo, @tabla_origen, @id_item, @cantidad, @motivo, @referencia, @id_usuario, @unidad, @fecha_movimiento)`,
);

/* ---------- Estado del reporte ---------- */

const resumen = {}; // hoja -> { filas, cargados, existentes, movimientos }
const problemas = []; // { hoja, fila, texto }
const informativos = [];
const registrarProblema = (hoja, fila, t) => problemas.push({ hoja, fila, texto: t });

/* ---------- Encabezados por hoja ---------- */

function mapaEncabezados(ws) {
  const rango = XLSX.utils.decode_range(ws["!ref"]);
  const fila1 = {};
  const fila2 = {};
  for (let c = 0; c <= rango.e.c; c += 1) {
    const a = sinAcentos(texto(valor(ws, 0, c)));
    const b = sinAcentos(texto(valor(ws, 1, c)));
    if (a) fila1[c] = a;
    if (b) fila2[c] = b;
  }
  return { rango, fila1, fila2 };
}
const colPor = (fila, predicado) => {
  const hit = Object.entries(fila).find(([, t]) => predicado(t));
  return hit ? Number(hit[0]) : -1;
};

/* ---------- Reactivos y columnas ---------- */

const HOJAS_REACTIVOS = [
  { nombre: "Ácidos", tipo: "acidos", unidad: "L" },
  { nombre: "Alcoholes y solventes orgánicos", tipo: "alcoholes_solventes", unidad: "L" },
  { nombre: "Compuestos de Amonio", tipo: "compuestos_amonio", unidad: "L" },
  { nombre: "Compuestos de Sodio", tipo: "compuestos_sodio", unidad: "kg" },
];

const existeReactivo = db.prepare(
  `SELECT id FROM reactivos WHERE tipo_reactivo = @tipo_reactivo AND COALESCE(id_interno, '') = COALESCE(@id_interno, '') AND producto = @producto
     AND COALESCE(marca, '') = COALESCE(@marca, '') AND COALESCE(lote, '') = COALESCE(@lote, '') AND COALESCE(cas, '') = COALESCE(@cas, '')
     AND COALESCE(catalogo, '') = COALESCE(@catalogo, '') AND COALESCE(fecha_ingreso, '') = COALESCE(@fecha_ingreso, '') AND COALESCE(serie, '') = COALESCE(@serie, '') LIMIT 1`,
);

function cargarReactivos(def) {
  const hoja = hojaPor(def.nombre);
  if (!hoja) {
    informativos.push(`No se encontró la hoja «${def.nombre}».`);
    return;
  }
  const { ws, nombre } = hoja;
  const { rango, fila1, fila2 } = mapaEncabezados(ws);
  const col = {
    id: colPor(fila1, (t) => t === "id"),
    producto: colPor(fila1, (t) => t === "producto"),
    marca: colPor(fila1, (t) => t === "marca"),
    proveedor: colPor(fila1, (t) => t === "proveedor"),
    cat: colPor(fila1, (t) => t.startsWith("#catalogo")),
    loc: colPor(fila1, (t) => t.startsWith("localizacion")),
    cad: colPor(fila1, (t) => t === "caducidad"),
    apertura: colPor(fila1, (t) => t.startsWith("fecha de apertura")),
    ingreso: colPor(fila1, (t) => t.startsWith("fecha de ingreso")),
    contenedor: colPor(fila1, (t) => t === "contenedor"),
    capacidad: colPor(fila1, (t) => t.startsWith("capacidad")),
    piezas: colPor(fila1, (t) => t === "piezas"),
    desc: colPor(fila2, (t) => t.startsWith("descuento")),
    sub: colPor(fila2, (t) => t.startsWith("subtotal")),
    fdesc: colPor(fila2, (t) => t.startsWith("fecha del descuento")),
    restante: colPor(fila2, (t) => t.startsWith("restante")),
  };
  const r = (resumen[nombre] = { filas: 0, cargados: 0, existentes: 0, movimientos: 0 });
  const vistos = new Map();

  for (let fila = 2; fila <= rango.e.r; fila += 1) {
    const producto = limpio(valor(ws, fila, col.producto));
    if (!producto) continue;
    const nfila = fila + 1;
    r.filas += 1;
    const notas = [];
    const prob = (t) => registrarProblema(nombre, nfila, t);
    const idInterno = limpio(valor(ws, fila, col.id));
    if (!idInterno) prob("Sin ID interno en el Excel (se carga sin ID).");

    // Identificación (#catálogo / #parte / CAS / lote)
    const original = texto(valor(ws, fila, col.cat));
    const ident = separarIdentificacion(original);
    if (!vacioMarca(original)) notas.push(`Catálogo/parte/CAS/lote original: ${original}`);
    if (ident.dudoso) prob(`CAS dudoso: «${ident.cas}» tiene el patrón de un CAS pero su dígito verificador no cuadra (se cargó como CAS; revisar).`);

    // Fechas
    const campoFecha = (clave, etiqueta) => {
      const f = fecha(valor(ws, fila, col[clave]));
      if (f.nota) {
        notas.push(`Fecha de ${etiqueta} original no interpretable: ${f.nota}; se deja vacía.`);
        prob(`Fecha de ${etiqueta} no interpretable: ${f.nota}.`);
      }
      return f.iso;
    };
    const fechaIngreso = campoFecha("ingreso", "ingreso");
    const fechaApertura = campoFecha("apertura", "apertura");

    // Caducidad: fecha, «Indefinido» o vacío
    let caducidad = null;
    let indefinida = 0;
    const cadTexto = texto(valor(ws, fila, col.cad));
    if (/^indefinid/i.test(cadTexto)) indefinida = 1;
    else if (!vacioMarca(cadTexto)) {
      const f = fecha(valor(ws, fila, col.cad));
      if (f.iso) caducidad = f.iso;
      else {
        notas.push(`Caducidad original no interpretable: ${f.nota || cadTexto}; se deja vacía.`);
        prob(`Caducidad no interpretable: ${f.nota || cadTexto}.`);
      }
    }

    const contenedor = normalizarContenedor(valor(ws, fila, col.contenedor), CONTENEDORES, (t) => prob(t));
    const localizacion = def.tipo === "alcoholes_solventes" ? limpio(valor(ws, fila, col.loc)) : null;

    // Conteo físico (solo Alcoholes): a Observaciones, sin ajuste
    const restante = limpio(valor(ws, fila, col.restante));
    if (restante) notas.push(`Conteo 19/01/26: ${restante}`);

    // Existencia
    const capacidad = numero(valor(ws, fila, col.capacidad));
    const piezas = numero(valor(ws, fila, col.piezas));
    let total = null;
    if (capacidad === null || capacidad <= 0) prob("Sin capacidad por envase: se carga sin existencia.");
    else if (piezas === null) prob("Sin número de piezas: se carga sin existencia.");
    else total = redondear(capacidad * piezas);
    const descuento = numero(valor(ws, fila, col.desc)) || 0;
    const fechaDescuento = fecha(valor(ws, fila, col.fdesc));
    let actual = total;
    let consumo = null;
    if (total !== null) {
      if (descuento > 0) {
        if (descuento > total + 1e-9) prob(`El descuento de enero (${descuento}) es mayor que el total inicial (${total}); no se registró el consumo.`);
        else {
          actual = redondear(total - descuento);
          consumo = { cantidad: descuento, fecha: fechaDescuento.iso || hoy, aprox: !fechaDescuento.iso };
          if (!fechaDescuento.iso) prob("El descuento de enero no trae fecha interpretable: se usó la fecha de carga.");
        }
      }
      const excel = valor(ws, fila, col.sub);
      if (typeof excel === "number" && Math.abs(excel - actual) > 1e-6) prob(`La existencia no cuadra con el Excel: calculada ${actual} ${def.unidad}, Subtotal del Excel ${excel}.`);
    } else {
      const excel = valor(ws, fila, col.sub);
      if (typeof excel === "number" && excel !== 0) prob(`El Excel muestra un Subtotal de ${excel} pero no hay capacidad ni piezas para calcularlo.`);
    }

    if (idInterno) {
      const clave = `${def.tipo}|${idInterno}`;
      if (vistos.has(clave)) prob(`ID interno repetido en la hoja (también en la fila ${vistos.get(clave)}).`);
      else vistos.set(clave, nfila);
    }

    const registro = {
      tipo_reactivo: def.tipo,
      producto,
      id_interno: idInterno,
      marca: limpio(valor(ws, fila, col.marca)),
      proveedor: limpio(valor(ws, fila, col.proveedor)),
      catalogo: ident.catalogo,
      cas: ident.cas,
      lote: ident.lote,
      localizacion,
      fecha_ingreso: fechaIngreso,
      fecha_apertura: fechaApertura,
      caducidad,
      caducidad_indefinida: indefinida,
      contenedor,
      capacidad: total !== null || capacidad ? capacidad : null,
      unidad_capacidad: capacidad ? def.unidad : null,
      piezas,
      cantidad_total: total,
      unidad_total: total !== null ? def.unidad : null,
      unidad: capacidad ? def.unidad : null,
      cantidad_actual: actual ?? 0,
      stock_maximo: total,
      parte: null,
      serie: null,
      descripcion: null,
      nuevo_usado: null,
      metodo: null,
      observaciones: notas.join("\n") || null,
    };
    if (existeReactivo.get(registro)) {
      r.existentes += 1;
      continue;
    }
    if (SIMULAR) {
      r.cargados += 1;
      r.movimientos += (total !== null && total > 0 ? 1 : 0) + (consumo ? 1 : 0);
      continue;
    }
    const id = Number(insertarReactivo.run(registro).lastInsertRowid);
    const movs = [];
    if (total !== null && total > 0) {
      const f = fechaIngreso && fechaIngreso <= hoy ? fechaIngreso : hoy;
      insertarMovimiento.run({ tipo: "entrada", tabla_origen: "reactivos", id_item: id, cantidad: total, motivo: "Existencia inicial", referencia: `carga-inicial-reactivos-${id}-ini`, id_usuario: actor.id, unidad: def.unidad, fecha_movimiento: f });
      movs.push({ tipo: "entrada", cantidad: total, unidad: def.unidad, fecha: f, motivo: "Existencia inicial" });
    }
    if (consumo) {
      const f = consumo.fecha <= hoy ? consumo.fecha : hoy;
      const motivo = `Descuento de enero 2026 (Inventario General)${consumo.aprox ? " · fecha de carga: el Excel no trae fecha" : ""}`;
      insertarMovimiento.run({ tipo: "consumo", tabla_origen: "reactivos", id_item: id, cantidad: consumo.cantidad, motivo, referencia: `carga-inicial-reactivos-${id}-d1`, id_usuario: actor.id, unidad: def.unidad, fecha_movimiento: f });
      movs.push({ tipo: "consumo", cantidad: consumo.cantidad, unidad: def.unidad, fecha: f, motivo });
    }
    const guardado = db.prepare("SELECT * FROM reactivos WHERE id = ?").get(id);
    auditar({ accion: "crear", entidad: "reactivos", entidadId: id, referencia: idInterno || producto, despues: guardado, detalle: { origen: `Inventario General 2026 · ${nombre} · fila ${nfila}`, movimientos: movs } });
    r.cargados += 1;
    r.movimientos += movs.length;
  }
}

function cargarColumnas() {
  const hoja = hojaPor("Columnas cromatográficas");
  if (!hoja) {
    informativos.push("No se encontró la hoja «Columnas cromatográficas».");
    return;
  }
  const { ws, nombre } = hoja;
  const { rango, fila1 } = mapaEncabezados(ws);
  const col = {
    id: colPor(fila1, (t) => t === "id"),
    producto: colPor(fila1, (t) => t === "producto"),
    marca: colPor(fila1, (t) => t === "marca"),
    proveedor: colPor(fila1, (t) => t === "proveedor"),
    loc: colPor(fila1, (t) => t.startsWith("localizacion")),
    lote: colPor(fila1, (t) => t.includes("lote")),
    parte: colPor(fila1, (t) => t.includes("parte")),
    serie: colPor(fila1, (t) => t.includes("serie")),
    descripcion: colPor(fila1, (t) => t.startsWith("descripcion")),
    ingreso: colPor(fila1, (t) => t.startsWith("fecha de ingreso")),
    apertura: colPor(fila1, (t) => t.startsWith("fecha de apertura")),
    condicion: colPor(fila1, (t) => t.startsWith("nuevo")),
    metodo: colPor(fila1, (t) => t.startsWith("metodo")),
    obs: colPor(fila1, (t) => t.startsWith("observaciones")),
  };
  const r = (resumen[nombre] = { filas: 0, cargados: 0, existentes: 0, movimientos: 0 });
  const vistos = new Map();
  for (let fila = 2; fila <= rango.e.r; fila += 1) {
    const producto = limpio(valor(ws, fila, col.producto));
    if (!producto) continue;
    const nfila = fila + 1;
    r.filas += 1;
    const notas = [];
    const prob = (t) => registrarProblema(nombre, nfila, t);
    const idInterno = limpio(valor(ws, fila, col.id));
    const campoFecha = (clave, etiqueta) => {
      const f = fecha(valor(ws, fila, col[clave]));
      if (f.nota) {
        notas.push(`Fecha de ${etiqueta} original no interpretable: ${f.nota}; se deja vacía.`);
        prob(`Fecha de ${etiqueta} no interpretable: ${f.nota}.`);
      }
      return f.iso;
    };
    const cond = sinAcentos(texto(valor(ws, fila, col.condicion)));
    const nuevoUsado = cond.startsWith("nuev") ? "Nueva" : cond.startsWith("usad") ? "Usada" : null;
    if (cond && !nuevoUsado && !vacioMarca(cond)) prob(`Condición «${texto(valor(ws, fila, col.condicion))}» no reconocida (se deja vacía).`);
    let metodo = limpio(valor(ws, fila, col.metodo));
    if (metodo && !["PSP", "DSP", "ASP"].includes(metodo.toUpperCase())) {
      prob(`Método «${metodo}» no está en la lista; se guarda como «Otro».`);
      metodo = "Otro";
    } else if (metodo) metodo = metodo.toUpperCase();
    const obsExcel = limpio(valor(ws, fila, col.obs));
    if (obsExcel) notas.unshift(obsExcel);
    const registro = {
      tipo_reactivo: "columnas_cromatograficas",
      producto,
      id_interno: idInterno,
      marca: limpio(valor(ws, fila, col.marca)),
      proveedor: limpio(valor(ws, fila, col.proveedor)),
      catalogo: null,
      cas: null,
      lote: limpio(valor(ws, fila, col.lote)),
      localizacion: limpio(valor(ws, fila, col.loc)),
      fecha_ingreso: campoFecha("ingreso", "ingreso"),
      fecha_apertura: campoFecha("apertura", "apertura"),
      caducidad: null,
      caducidad_indefinida: 0,
      contenedor: null,
      capacidad: null,
      unidad_capacidad: null,
      piezas: null,
      cantidad_total: null,
      unidad_total: null,
      unidad: null,
      cantidad_actual: null,
      stock_maximo: null,
      parte: limpio(valor(ws, fila, col.parte)),
      serie: limpio(valor(ws, fila, col.serie)),
      descripcion: limpio(valor(ws, fila, col.descripcion)),
      nuevo_usado: nuevoUsado,
      metodo,
      observaciones: notas.join("\n") || null,
    };
    if (idInterno) {
      if (vistos.has(idInterno)) prob(`ID interno repetido: ${idInterno} (también en la fila ${vistos.get(idInterno)}); se cargaron las dos.`);
      else vistos.set(idInterno, nfila);
    }
    if (existeReactivo.get(registro)) {
      r.existentes += 1;
      continue;
    }
    if (SIMULAR) {
      r.cargados += 1;
      continue;
    }
    const id = Number(insertarReactivo.run(registro).lastInsertRowid);
    auditar({ accion: "crear", entidad: "reactivos", entidadId: id, referencia: idInterno || producto, despues: db.prepare("SELECT * FROM reactivos WHERE id = ?").get(id), detalle: { origen: `Inventario General 2026 · ${nombre} · fila ${nfila}` } });
    r.cargados += 1;
  }
}

/* ---------- Consumibles ---------- */

const existeConsumible = db.prepare(
  `SELECT id FROM consumibles WHERE producto = @producto AND COALESCE(marca, '') = COALESCE(@marca, '') AND COALESCE(tamano_capacidad, '') = COALESCE(@tamano_capacidad, '')
     AND COALESCE(contenedor, '') = COALESCE(@contenedor, '') AND COALESCE(catalogo_parte_cas, '') = COALESCE(@catalogo_parte_cas, '') AND COALESCE(lote, '') = COALESCE(@lote, '')
     AND COALESCE(fecha_ingreso, '') = COALESCE(@fecha_ingreso, '') AND COALESCE(piezas, -1) = COALESCE(@piezas, -1) AND COALESCE(cantidad_por_pieza, -1) = COALESCE(@cantidad_por_pieza, -1) LIMIT 1`,
);

function cargarConsumibles() {
  const hoja = hojaPor("Consumibles");
  if (!hoja) {
    informativos.push("No se encontró la hoja «Consumibles».");
    return;
  }
  const { ws, nombre } = hoja;
  const { rango, fila1, fila2 } = mapaEncabezados(ws);
  const col = {
    producto: colPor(fila1, (t) => t === "producto"),
    marca: colPor(fila1, (t) => t === "marca"),
    proveedor: colPor(fila1, (t) => t === "proveedor"),
    cat: colPor(fila1, (t) => t.startsWith("#catalogo")),
    ingreso: colPor(fila1, (t) => t.startsWith("fecha de ingreso")),
    tamano: colPor(fila1, (t) => t.startsWith("tamano")),
    contenedor: colPor(fila1, (t) => t === "contenedor"),
    piezas: colPor(fila1, (t) => t === "piezas"),
    porPieza: colPor(fila1, (t) => t.startsWith("cantidad por pieza")),
  };
  // Bloques mensuales: el encabezado del mes está en la fila 1; sus columnas, en la fila 2.
  const inicios = Object.entries(fila1).filter(([, t]) => MESES.includes(t)).map(([c, t]) => ({ mes: MESES.indexOf(t) + 1, ini: Number(c) }));
  inicios.sort((a, b) => a.ini - b.ini);
  const bloques = inicios.map((b, i) => {
    const fin = i + 1 < inicios.length ? inicios[i + 1].ini - 1 : rango.e.c;
    const dentro = (pred) => {
      for (let c = b.ini; c <= fin; c += 1) if (fila2[c] && pred(fila2[c])) return c;
      return -1;
    };
    return { mes: b.mes, desc: dentro((t) => t.startsWith("descuento")), ingreso: dentro((t) => t.startsWith("ingreso")), sub: dentro((t) => t.startsWith("subtotal")), fecha: dentro((t) => t.startsWith("fecha")) };
  });
  const r = (resumen[nombre] = { filas: 0, cargados: 0, existentes: 0, movimientos: 0 });

  for (let fila = 2; fila <= rango.e.r; fila += 1) {
    const producto = limpio(valor(ws, fila, col.producto));
    if (!producto) continue;
    const nfila = fila + 1;
    r.filas += 1;
    const notas = [];
    const prob = (t) => registrarProblema(nombre, nfila, t);
    const catOriginal = texto(valor(ws, fila, col.cat));
    let catalogo = null;
    let lote = null;
    if (!vacioMarca(catOriginal)) {
      const m = /^lot\b[:.\s]*(.*)$/i.exec(catOriginal);
      if (m) lote = m[1].trim() || null;
      else catalogo = catOriginal;
    }
    const fIngreso = fecha(valor(ws, fila, col.ingreso));
    if (fIngreso.nota) {
      notas.push(`Fecha de ingreso original no interpretable: ${fIngreso.nota}; se deja vacía.`);
      prob(`Fecha de ingreso no interpretable: ${fIngreso.nota}.`);
    }
    const piezas = numero(valor(ws, fila, col.piezas));
    const porPieza = numero(valor(ws, fila, col.porPieza));
    if (piezas === null) prob("Sin número de piezas: existencia inicial en 0.");
    const inicial = redondear((piezas || 0) * (porPieza && porPieza > 0 ? porPieza : 1));

    const movs = [];
    let existencia = inicial;
    if (inicial > 0) movs.push({ tipo: "entrada", cantidad: inicial, fecha: fIngreso.iso && fIngreso.iso <= hoy ? fIngreso.iso : hoy, motivo: "Existencia inicial" });
    let ultimoSubtotal;
    for (const b of bloques) {
      const fechaCelda = fecha(valor(ws, fila, b.fecha));
      const poner = (tipo, cantidad, etiqueta) => {
        let f = fechaCelda.iso;
        let aprox = false;
        if (!f) {
          f = `2026-${String(b.mes).padStart(2, "0")}-15`;
          aprox = true;
        }
        if (f > hoy) f = hoy;
        const motivo = `${etiqueta} ${MESES[b.mes - 1]} 2026 (Inventario General)${aprox ? " · fecha aproximada" : ""}`;
        movs.push({ tipo, cantidad, fecha: f, motivo });
        if (aprox) prob(`${etiqueta} de ${MESES[b.mes - 1]} (${cantidad}) sin fecha interpretable: se usó el día 15 (fecha aproximada).`);
        existencia = redondear(existencia + (tipo === "entrada" ? cantidad : -cantidad));
      };
      const d = numero(valor(ws, fila, b.desc)) || 0;
      const i = numero(valor(ws, fila, b.ingreso)) || 0;
      if (d > 0) poner("consumo", d, "Descuento");
      if (i > 0) poner("entrada", i, "Ingreso");
      const sub = valor(ws, fila, b.sub);
      if (typeof sub === "number") ultimoSubtotal = sub;
    }
    if (typeof ultimoSubtotal === "number" && Math.abs(ultimoSubtotal - existencia) > 1e-6) prob(`La existencia final no cuadra con el Excel: calculada ${existencia}, último Subtotal del Excel ${ultimoSubtotal}.`);
    if (existencia < -1e-9) prob(`La existencia final calculada es negativa (${existencia}).`);

    const registro = {
      producto,
      marca: limpio(valor(ws, fila, col.marca)),
      proveedor: limpio(valor(ws, fila, col.proveedor)),
      catalogo_parte_cas: catalogo,
      lote,
      fecha_ingreso: fIngreso.iso,
      tamano_capacidad: limpio(valor(ws, fila, col.tamano)),
      contenedor: normalizarContenedor(valor(ws, fila, col.contenedor), CONTENEDORES_CONSUMIBLE, prob),
      piezas,
      cantidad_por_pieza: porPieza,
      observaciones: notas.join("\n") || null,
      existencia,
      stock_maximo: inicial > 0 ? inicial : null,
      creado_por: actor.id,
    };
    if (existeConsumible.get(registro)) {
      r.existentes += 1;
      continue;
    }
    if (SIMULAR) {
      r.cargados += 1;
      r.movimientos += movs.length;
      continue;
    }
    const id = Number(insertarConsumible.run(registro).lastInsertRowid);
    movs.forEach((m, n) =>
      insertarMovimiento.run({ tipo: m.tipo, tabla_origen: "consumibles", id_item: id, cantidad: m.cantidad, motivo: m.motivo, referencia: `carga-inicial-consumibles-${id}-${n}`, id_usuario: actor.id, unidad: "unidades", fecha_movimiento: m.fecha }),
    );
    auditar({ accion: "crear", entidad: "consumibles", entidadId: id, referencia: producto, despues: db.prepare("SELECT * FROM consumibles WHERE id = ?").get(id), detalle: { origen: `Inventario General 2026 · ${nombre} · fila ${nfila}`, movimientos: movs } });
    r.cargados += 1;
    r.movimientos += movs.length;
  }
}

/* ---------- Ejecución ---------- */

const cargar = db.transaction(() => {
  for (const def of HOJAS_REACTIVOS) cargarReactivos(def);
  cargarColumnas();
  cargarConsumibles();
  if (!SIMULAR) {
    const totales = Object.values(resumen).reduce((a, h) => ({ cargados: a.cargados + h.cargados, movimientos: a.movimientos + h.movimientos }), { cargados: 0, movimientos: 0 });
    if (totales.cargados > 0) auditar({ accion: "importar", entidad: "inventario", entidadId: null, referencia: "Inventario General 2026", detalle: { archivo: path.basename(rutaXlsx), hojas: resumen, registros: totales.cargados, movimientos: totales.movimientos } });
  }
});
cargar();

let cadena = "(no se verificó: simulación)";
if (!SIMULAR) {
  const roto = primerEslabonRoto(db.prepare("SELECT * FROM auditoria ORDER BY id").all(), CLAVE);
  cadena = roto === null ? "íntegra" : `NO cuadra a partir de la entrada ${roto}`;
}
db.close();

/* ---------- Reporte ---------- */

const llaveEnEnv = !!String(process.env.SECRET_KEY || "").trim() && String(process.env.SECRET_KEY).trim() !== "ficotox-dev-secret";
const rutaLlave = llaveEnEnv ? `${path.join(rootDir, ".env")} (variable SECRET_KEY)` : path.join(instanceDir, "auditoria.key");
const filas = Object.entries(resumen);
const total = (campo) => filas.reduce((a, [, h]) => a + h[campo], 0);
const porHoja = new Map();
for (const p of problemas) {
  if (!porHoja.has(p.hoja)) porHoja.set(p.hoja, []);
  porHoja.get(p.hoja).push(p);
}
const md = [];
md.push(`# Carga del Inventario General 2026${SIMULAR ? " (SIMULACIÓN: no se escribió nada)" : ""}`);
md.push("");
md.push(`- **Archivo:** ${path.basename(rutaXlsx)}`);
md.push(`- **Base:** ${sqlitePath}`);
md.push(`- **Cargado a nombre de:** ${actor.nombre} (${actor.email}); en la bitácora como «${MOTIVO}».`);
md.push(`- **Cadena de la bitácora después de la carga:** ${cadena}.`);
md.push(`- **Fecha de carga (para movimientos sin fecha):** ${hoy}.`);
md.push("");
md.push("## Llave de la bitácora");
md.push("");
md.push(`- **Ruta:** \`${rutaLlave}\``);
md.push("- **Guárdala fuera de esta computadora** (gestor de contraseñas institucional o sobre cerrado). Sin ella no se puede comprobar que la bitácora no fue alterada, y **nunca se debe cambiar**.");
md.push("");
md.push("## Registros cargados");
md.push("");
md.push("| Hoja | Filas con producto | Cargados | Ya existían (omitidos) | Movimientos |");
md.push("| --- | --- | --- | --- | --- |");
for (const [h, v] of filas) md.push(`| ${h} | ${v.filas} | ${v.cargados} | ${v.existentes} | ${v.movimientos} |`);
md.push(`| **Total** | ${total("filas")} | ${total("cargados")} | ${total("existentes")} | ${total("movimientos")} |`);
md.push("");
if (informativos.length) {
  md.push(...informativos.map((t) => `- ${t}`), "");
}
md.push(`## Filas con problemas (${problemas.length})`);
md.push("");
if (!problemas.length) md.push("Ninguna.");
for (const [h, lista] of porHoja) {
  md.push(`### ${h}`, "");
  for (const p of lista.sort((a, b) => a.fila - b.fila)) md.push(`- **Fila ${p.fila}:** ${p.texto}`);
  md.push("");
}
fs.mkdirSync(path.dirname(rutaReporte), { recursive: true });
fs.writeFileSync(rutaReporte, `${md.join("\n")}\n`);

console.log(`${SIMULAR ? "SIMULACIÓN · " : ""}Carga del Inventario General`);
for (const [h, v] of filas) console.log(`  ${h}: ${v.cargados} cargados, ${v.existentes} ya existían, ${v.movimientos} movimientos`);
console.log(`Problemas señalados: ${problemas.length} · cadena de la bitácora: ${cadena}`);
console.log(`Reporte: ${rutaReporte}`);
