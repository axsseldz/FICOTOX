/*
 * Búsqueda universal (Inicio y ventana ⌘K):
 *   GET    /api/busqueda?q=            resultados agrupados, solo lo que la persona puede ver o hacer
 *   GET    /api/busqueda/recientes     lo que buscó y abrió (máximo 8), validado contra sus permisos de hoy
 *   POST   /api/busqueda/recientes     { tipo: "consulta", texto } | { tipo: "resultado", clave, consulta? }
 *   DELETE /api/busqueda/recientes     ?id=<n> quita uno; ?todos=1 los borra
 *
 * Los recientes se guardan por persona (tabla busqueda_recientes, migración 17)
 * y no pasan por la bitácora. Al registrar un resultado el cliente solo manda
 * su clave: el título y la dirección se toman del índice de la persona, así no
 * se puede guardar un enlace ajeno.
 */
import { requireUser } from "../auth";
import { construirIndice } from "../busqueda";
import { buscar, tituloRegistrarMovimiento } from "../busqueda/buscar";
import { type Row, type Session } from "../db";
import { HttpError, json, readJson, type RouteContext } from "../http";
import { cargarAutorizacion } from "../rbac";
import { norm, RECIENTES_MAX, type Reciente, type TipoResultado, type Comando } from "../../shared/busqueda";

const GUARDADOS_MAX = 30;

const claveDeIndice = (clave: string) => (clave.startsWith("accion:reponer:") ? clave.slice("accion:reponer:".length) : clave);

async function clavesRecientes(s: Session, userId: number): Promise<Set<string>> {
  const filas = await s.query<Row>("SELECT clave FROM busqueda_recientes WHERE usuario_id = :yo AND tipo = 'resultado'", { yo: userId });
  return new Set(filas.map((f) => String(f.clave)));
}

export async function buscarTodo({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const auth = await cargarAutorizacion(s, user);
  const q = (new URL(request.url).searchParams.get("q") || "").slice(0, 120);
  return json(await buscar(request, s, auth, q, await clavesRecientes(s, auth.userId)));
}

export async function listarRecientes({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const auth = await cargarAutorizacion(s, user);
  const filas = await s.query<Row>("SELECT * FROM busqueda_recientes WHERE usuario_id = :yo ORDER BY usado_en DESC, id DESC LIMIT :max", { yo: auth.userId, max: GUARDADOS_MAX });
  if (!filas.length) return json({ items: [] });
  const indice = await construirIndice(request, s);
  const vigentes = new Map(indice.hits.map((h) => [h.clave, h]));
  const items: Reciente[] = [];
  const caducas: number[] = [];
  for (const fila of filas) {
    if (fila.tipo === "consulta") {
      items.push({ id: Number(fila.id), tipo: "consulta", clave: String(fila.clave), titulo: String(fila.titulo), sub: null, href: "", kind: null, comando: null, mono: false });
      continue;
    }
    // Un registro que ya no existe, o que ya no se puede ver, desaparece de la lista.
    const actual = vigentes.get(claveDeIndice(String(fila.clave)));
    if (!actual) {
      caducas.push(Number(fila.id));
      continue;
    }
    const reponer = String(fila.clave).startsWith("accion:reponer:");
    items.push({ id: Number(fila.id), tipo: "resultado", clave: String(fila.clave), titulo: reponer ? tituloRegistrarMovimiento(actual.titulo) : actual.titulo, sub: reponer ? (fila.sub as string | null) : actual.sub || null, href: reponer ? String(fila.href) : actual.href, kind: reponer ? "accion" : actual.tipo, comando: actual.comando || null, mono: !!actual.mono });
  }
  if (caducas.length) {
    await s.execute(`DELETE FROM busqueda_recientes WHERE usuario_id = :yo AND id IN (${caducas.map((id) => Number(id)).join(", ")})`, { yo: auth.userId });
    await s.commit();
  }
  return json({ items: items.slice(0, RECIENTES_MAX) });
}

async function guardar(s: Session, userId: number, fila: { tipo: "consulta" | "resultado"; clave: string; titulo: string; sub: string | null; href: string; kind: TipoResultado | null; comando: Comando | null; mono: boolean }): Promise<void> {
  const ahora = new Date().toISOString();
  const previa = await s.queryOne<Row>("SELECT id FROM busqueda_recientes WHERE usuario_id = :yo AND clave = :clave", { yo: userId, clave: fila.clave });
  const datos = { yo: userId, tipo: fila.tipo, clave: fila.clave, titulo: fila.titulo.slice(0, 255), sub: fila.sub ? fila.sub.slice(0, 255) : null, href: fila.href.slice(0, 500), kind: fila.kind, comando: fila.comando, mono: fila.mono ? 1 : 0, ahora };
  if (previa) await s.execute("UPDATE busqueda_recientes SET tipo = :tipo, titulo = :titulo, sub = :sub, href = :href, kind = :kind, comando = :comando, mono = :mono, usado_en = :ahora WHERE id = :id", { ...datos, id: previa.id });
  else await s.execute("INSERT INTO busqueda_recientes (usuario_id, tipo, clave, titulo, sub, href, kind, comando, mono, usado_en) VALUES (:yo, :tipo, :clave, :titulo, :sub, :href, :kind, :comando, :mono, :ahora)", datos);
  // Cada persona conserva los últimos 30.
  const sobran = await s.query<Row>("SELECT id FROM busqueda_recientes WHERE usuario_id = :yo ORDER BY usado_en DESC, id DESC LIMIT 1000 OFFSET :corte", { yo: userId, corte: GUARDADOS_MAX });
  if (sobran.length) await s.execute(`DELETE FROM busqueda_recientes WHERE usuario_id = :yo AND id IN (${sobran.map((f) => Number(f.id)).join(", ")})`, { yo: userId });
}

export async function registrarReciente({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const auth = await cargarAutorizacion(s, user);
  const payload = await readJson(request);
  const consulta = String(payload.tipo === "consulta" ? payload.texto : payload.consulta || "").replace(/\s+/g, " ").trim();
  if (consulta.length >= 2 && consulta.length <= 120) {
    await guardar(s, auth.userId, { tipo: "consulta", clave: `q:${norm(consulta)}`, titulo: consulta, sub: null, href: "", kind: null, comando: null, mono: false });
  }
  if (payload.tipo === "resultado") {
    const clave = String(payload.clave || "").slice(0, 190);
    const indice = await construirIndice(request, s);
    const reponer = clave.startsWith("accion:reponer:");
    const base = indice.hits.find((h) => h.clave === claveDeIndice(clave));
    if (!base) throw new HttpError(404, { message: "Ese resultado ya no está disponible" });
    await guardar(s, auth.userId, { tipo: "resultado", clave, titulo: reponer ? tituloRegistrarMovimiento(base.titulo) : base.titulo, sub: base.sub || null, href: reponer ? `/inventario/${base.tipo === "reactivo" ? "reactivos" : "consumibles"}?reponer=${clave.split("-").pop()}` : base.href, kind: reponer ? "accion" : base.tipo, comando: base.comando || null, mono: !!base.mono });
  } else if (payload.tipo !== "consulta") {
    throw new HttpError(400, { message: "Indica qué guardar" });
  }
  await s.commit();
  return json({ message: "Guardado" });
}

export async function borrarRecientes({ request, s }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const auth = await cargarAutorizacion(s, user);
  const url = new URL(request.url);
  if (url.searchParams.get("todos") === "1") await s.execute("DELETE FROM busqueda_recientes WHERE usuario_id = :yo", { yo: auth.userId });
  else {
    const id = Number(url.searchParams.get("id") || 0);
    if (!id) throw new HttpError(400, { message: "Indica qué quitar" });
    await s.execute("DELETE FROM busqueda_recientes WHERE usuario_id = :yo AND id = :id", { yo: auth.userId, id });
  }
  await s.commit();
  return json({ message: "Quitado" });
}
