/*
 * Motor de la búsqueda universal: toma el índice de la persona (indice.ts) y
 * devuelve los resultados agrupados.
 *
 * - Sin mayúsculas ni acentos; tolera errores pequeños de escritura (distancia
 *   de edición 1 o 2 sobre las palabras) y plurales.
 * - Folios en cualquier forma ("R 0000001", "R1", "r-1", "0000001", "1").
 * - Sinónimos del laboratorio (muestra → recepción, toxinas lipofílicas → DSP…).
 * - Varias palabras: todas deben aparecer ("metanol lote 9093").
 * - Orden: 1) folio o clave exacta, 2) lo que la persona debe atender,
 *   3) lo que usó antes, 4) el resto (por calidad de la coincidencia y por
 *   cercanía en el tiempo).
 */
import { GRUPO_TITULO, POR_GRUPO, norm, type GrupoBusqueda, type GrupoClave, type RespuestaBusqueda, type ResultadoBusqueda } from "../../shared/busqueda";
import type { Session } from "../db";
import type { Autorizacion } from "../rbac";
import { accesoDe } from "./catalogo";
import { compacto, construirIndice, type Hit } from "./indice";

const PARADAS = new Set(["de", "del", "la", "el", "los", "las", "en", "un", "una", "al", "y", "o", "por", "para", "con", "mi", "mis"]);

/* Palabra escrita → otras formas con que el laboratorio la nombra. */
const SINONIMOS: Record<string, string[]> = {
  muestra: ["recepcion"],
  muestras: ["recepcion"],
  lipofilica: ["dsp"],
  lipofilicas: ["dsp"],
  lipofilico: ["dsp"],
  domoico: ["asp"],
  paralizante: ["psp"],
  paralizantes: ["psp"],
  contrasena: ["password", "clave"],
  oscuro: ["noche"],
  salir: ["cerrar"],
};

const FOLIO_CONSULTA = /^(inc|nc|ir|e-?a|e-?d|r|p|a)?[\s-]*0*(\d{1,7})$/;

function parseFolioConsulta(q: string): { p: string | null; n: number } | null {
  const m = FOLIO_CONSULTA.exec(q);
  if (!m) return null;
  return { p: m[1] ? m[1].replace("-", "") : null, n: Number(m[2]) };
}

function distancia(a: string, b: string, tope: number): number {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  let previa = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    let minimo = i;
    for (let j = 1; j <= b.length; j++) {
      const valor = Math.min(previa[j] + 1, actual[j - 1] + 1, previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      actual.push(valor);
      if (valor < minimo) minimo = valor;
    }
    if (minimo > tope) return tope + 1;
    previa = actual;
  }
  return previa[b.length];
}

const palabrasDe = (texto: string) => texto.split(/[^a-z0-9]+/).filter(Boolean);

function tokens(h: Hit): string[] {
  return (h.tokens ||= [...new Set(palabrasDe(h.kw))]);
}

/* Formas de una palabra: ella misma, su singular y sus sinónimos. */
function alternativas(termino: string): string[] {
  const alts = new Set([termino]);
  if (termino.length > 4 && termino.endsWith("es")) alts.add(termino.slice(0, -2));
  if (termino.length > 3 && termino.endsWith("s")) alts.add(termino.slice(0, -1));
  for (const alt of [...alts]) for (const sin of SINONIMOS[alt] || []) alts.add(sin);
  return [...alts];
}

/* 0 = el título empieza con la palabra · 1 = está en el título · 2 = está en el texto · 3 = con un error pequeño. null = no coincide. */
function puntajeTermino(h: Hit, titulo: string, alts: string[], soloNumero: boolean): number | null {
  let mejor: number | null = null;
  const toks = tokens(h);
  for (const [i, alt] of alts.entries()) {
    let p: number | null = null;
    // Las formas derivadas (singular, sinónimos) solo valen al inicio de una palabra: "role" no debe encontrar "controles".
    if (i > 0 && !soloNumero) {
      if (titulo.startsWith(alt) || toks.some((t) => t.startsWith(alt))) p = palabrasDe(titulo).some((w) => w.startsWith(alt)) ? 0 : 2;
    } else if (soloNumero) {
      if (toks.includes(alt) || titulo.includes(alt)) p = 2;
    } else if (titulo.startsWith(alt) || palabrasDe(titulo).some((w) => w.startsWith(alt))) p = 0;
    else if (titulo.includes(alt)) p = 1;
    else if (h.kw.includes(alt)) p = 2;
    else if (alt.length >= 5) {
      const tope = alt.length >= 9 ? 2 : 1;
      if (toks.some((t) => distancia(alt, t.slice(0, alt.length), tope) <= tope || distancia(alt, t, tope) <= tope)) p = 3;
    }
    if (p !== null && (mejor === null || p < mejor)) mejor = p;
  }
  return mejor;
}

interface Puntuado {
  hit: Hit;
  tier: number;
  puntaje: number;
}

function coincidencias(hits: Hit[], q: string, recientes: Set<string>): Puntuado[] {
  const compactoQ = compacto(q);
  const folio = parseFolioConsulta(q);
  const todos = q.split(/[\s,;]+/).filter(Boolean);
  const utiles = todos.filter((t) => !PARADAS.has(t));
  const terminos = (utiles.length ? utiles : todos).filter((t) => t.length >= 2 || /^\d$/.test(t) || (todos.length === 1 && t.length >= 1));
  const soloNumero = terminos.length === 1 && /^\d+$/.test(terminos[0]);
  const alts = terminos.map((t) => alternativas(t));
  const out: Puntuado[] = [];

  if (folio) {
    for (const h of hits) {
      if (!h.folio || h.folio.n !== folio.n) continue;
      if (folio.p === null || h.folio.p === folio.p) out.push({ hit: h, tier: 1, puntaje: 0 });
    }
    // Un número solo ("1") encuentra además lo que lo contiene como palabra, pero después de los folios.
    if (out.length && folio.p !== null) return out;
  }
  const exactos = new Set(out.map((o) => o.hit.clave));

  for (const h of hits) {
    if (exactos.has(h.clave)) continue;
    const titulo = norm(h.titulo);
    if (h.exactos?.includes(compactoQ) || compacto(h.titulo) === compactoQ) {
      out.push({ hit: h, tier: 1, puntaje: 0 });
      continue;
    }
    let peor = 0;
    let ok = true;
    for (const a of alts) {
      const p = puntajeTermino(h, titulo, a, soloNumero);
      if (p === null) {
        ok = false;
        break;
      }
      if (p > peor) peor = p;
    }
    if (!ok || !alts.length) continue;
    const tier = peor <= 2 ? (h.pendiente ? 2 : recientes.has(h.clave) ? 3 : 4) : 4;
    out.push({ hit: h, tier, puntaje: peor });
  }
  return out;
}

function enResultado(h: Hit): ResultadoBusqueda {
  return { clave: h.clave, tipo: h.tipo, titulo: h.titulo, sub: h.sub, href: h.href, mono: h.mono, etiqueta: h.etiqueta, comando: h.comando };
}

const comparar = (a: Puntuado, b: Puntuado) => a.tier - b.tier || a.puntaje - b.puntaje || a.hit.orden - b.hit.orden;

/* "reponer metanol" → "Registrar movimiento de <reactivo>" (abre el registro de movimiento de ese reactivo o consumible; la clave y el parámetro siguen siendo "reponer"). */
export const tituloRegistrarMovimiento = (titulo: string) => `Registrar movimiento de ${titulo}`;

function accionesDeReposicion(hits: Hit[], q: string, recientes: Set<string>, auth: Autorizacion): Hit[] {
  const terminos = q.split(/[\s,;]+/).filter(Boolean);
  const verbo = terminos.findIndex((t) => /^(repon|reposicion|abastec|rellen)/.test(t));
  if (verbo < 0) return [];
  if (!accesoDe(auth).can("inventario", "C", { objeto: "movimiento" })) return [];
  const resto = terminos.filter((_, i) => i !== verbo).join(" ");
  if (!resto) return [];
  const candidatos = hits.filter((h) => h.tipo === "reactivo" || h.tipo === "consumible");
  return coincidencias(candidatos, resto, recientes)
    .sort(comparar)
    .slice(0, 3)
    .map(({ hit: h }) => {
      const id = h.clave.slice(h.clave.indexOf("-") + 1);
      const ruta = h.tipo === "reactivo" ? "reactivos" : "consumibles";
      return { ...h, clave: `accion:reponer:${h.clave}`, tipo: "accion" as const, grupo: "acciones" as const, titulo: tituloRegistrarMovimiento(h.titulo), etiqueta: "Acción", href: `/inventario/${ruta}?reponer=${id}`, mono: false, folio: undefined, exactos: undefined, lista: undefined };
    });
}

export async function buscar(request: Request, s: Session, auth: Autorizacion, consulta: string, recientes: Set<string>): Promise<RespuestaBusqueda> {
  const q = norm(consulta).replace(/\s+/g, " ").trim();
  if (!q) return { q: "", grupos: [] };
  const indice = await construirIndice(request, s);
  const hits = indice.hits;

  let puntuados = coincidencias(hits, q, recientes);
  const propias = accionesDeReposicion(hits, q, recientes, auth);
  for (const h of propias) puntuados.push({ hit: h, tier: 1, puntaje: 0 });

  puntuados = puntuados.sort(comparar);

  const porGrupo = new Map<GrupoClave, Puntuado[]>();
  for (const p of puntuados) porGrupo.set(p.hit.grupo, [...(porGrupo.get(p.hit.grupo) || []), p]);
  const grupos: GrupoBusqueda[] = [...porGrupo.entries()]
    .map(([clave, lista]) => {
      const primero = lista[0].hit;
      const base = primero.lista;
      const mas = base ? { href: `${base}${base.includes("?") ? "&" : "?"}buscar=${encodeURIComponent(consulta.trim())}`, etiqueta: `Ver todos en ${GRUPO_TITULO[clave]}` } : undefined;
      return { clave, titulo: GRUPO_TITULO[clave], total: lista.length, resultados: lista.slice(0, POR_GRUPO).map((p) => enResultado(p.hit)), mas, mejor: lista[0] };
    })
    .sort((a, b) => comparar(a.mejor, b.mejor))
    .map((g) => ({ clave: g.clave, titulo: g.titulo, total: g.total, resultados: g.resultados, mas: g.mas }));
  return { q: consulta.trim(), grupos };
}
