/*
 * Documentos SGC, Fase 3: distribucion y lectura controlada (CA-11).
 *
 *   POST /api/sgc/revisiones/:rid/distribucion     agregar destinatarios (rol o persona), punto de uso y si requiere lectura
 *                                                  (documento_administrar_lecturas, con motivo y contrasena)
 *   POST /api/sgc/distribucion/:did/retirar        quitar un destinatario (con motivo y contrasena)
 *   POST /api/sgc/revisiones/:rid/recordatorio     recordatorio manual a quienes no han leido (aviso en la campana)
 *   POST /api/sgc/revisiones/:rid/acusar           "Confirmo que lei y comprendi la revision N" (documento_acusar_lectura)
 *
 * Los destinatarios efectivos se calculan en cada consulta: las personas
 * indicadas y las que tienen hoy alguno de los roles indicados (asi quien
 * recibe el rol despues tambien recibe el pendiente), siempre que puedan
 * consultar vigentes. El acuse queda ligado a usuario + revision, con fecha y
 * hora, y no se deshace; una revision nueva tiene sus propios acuses.
 */
import { requireUser } from "../../auth";
import { registrarAuditoria } from "../../audit";
import { type Row, type Session } from "../../db";
import { HttpError, intParam, json, readJson, type RouteContext } from "../../http";
import { hoy } from "../../rbac";
import { exigirReauth } from "../../seguridad";
import { tiene, type AccesoSgc } from "./acceso";
import { acceso, ahora, ENTIDAD, exigir, personas, referenciaDe, revisionVisible, textoLargo, texto } from "./documentos";
import { MOTIVO_MIN_SGC } from "../../../shared/documentos";

export interface DatosDistribucion {
  roles: number[];
  usuarios: number[];
  punto_uso: string | null;
  requiere_lectura: boolean;
}

const ids = (v: unknown): number[] => [...new Set((Array.isArray(v) ? v : String(v ?? "").split(",")).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0))];

export function datosDistribucion(raw: unknown): DatosDistribucion | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const d = { roles: ids(r.roles), usuarios: ids(r.usuarios), punto_uso: texto(r.punto_uso, 200) || null, requiere_lectura: [true, 1, "1", "true", "on"].includes(r.requiere_lectura as never) };
  return d.roles.length || d.usuarios.length ? d : null;
}

/* Roles vigentes hoy de cada persona activa (para los destinatarios por rol). */
async function rolesVigentes(s: Session): Promise<Map<number, number[]>> {
  const filas = await s.query<Row>(
    `SELECT ur.usuario_id, ur.rol_id FROM usuario_roles ur JOIN roles r ON r.id = ur.rol_id JOIN usuarios u ON u.id = ur.usuario_id
     WHERE ur.revocado_en IS NULL AND ur.vigente_desde <= :hoy AND (ur.vigente_hasta IS NULL OR ur.vigente_hasta >= :hoy) AND r.activo = 1 AND COALESCE(u.activo, 1) = 1`,
    { hoy: hoy() },
  );
  const out = new Map<number, number[]>();
  for (const f of filas) out.set(Number(f.rol_id), [...(out.get(Number(f.rol_id)) || []), Number(f.usuario_id)]);
  return out;
}

/* Valida destinatarios: las personas deben poder consultar vigentes; los roles, otorgar esa accion. */
async function validarDestinatarios(s: Session, d: DatosDistribucion): Promise<void> {
  const gente = await personas(s);
  for (const u of d.usuarios) {
    const p = gente.find((x) => x.id === u);
    if (!p) throw new HttpError(400, { message: "Un destinatario no es una cuenta activa", campo: "usuarios" });
    if (!p.acciones.includes("documento_consultar_vigente")) throw new HttpError(400, { message: `${p.nombre} no puede consultar documentos vigentes; no se le puede asignar como destinatario`, campo: "usuarios" });
    if (d.requiere_lectura && !p.acciones.includes("documento_acusar_lectura")) throw new HttpError(400, { message: `${p.nombre} no puede confirmar lecturas (documento_acusar_lectura); quítale la lectura requerida o elige a otra persona`, campo: "usuarios" });
  }
  for (const r of d.roles) {
    const rol = await s.queryOne<Row>("SELECT id, nombre, activo FROM roles WHERE id = :id", { id: r });
    if (!rol || !Number(rol.activo)) throw new HttpError(400, { message: "Elige roles activos", campo: "roles" });
    const da = await s.queryOne<Row>("SELECT 1 AS x FROM rol_acciones WHERE id_rol = :id AND modulo = 'documentos' AND accion IN ('documento_consultar_vigente', 'G')", { id: r });
    if (!da) throw new HttpError(400, { message: `El rol «${rol.nombre}» no puede consultar documentos vigentes; no se le puede asignar como destinatario`, campo: "roles" });
    if (d.requiere_lectura && !(await s.queryOne<Row>("SELECT 1 AS x FROM rol_acciones WHERE id_rol = :id AND modulo = 'documentos' AND accion IN ('documento_acusar_lectura', 'G')", { id: r }))) throw new HttpError(400, { message: `El rol «${rol.nombre}» no puede confirmar lecturas (documento_acusar_lectura); quítale la lectura requerida`, campo: "roles" });
  }
}

export async function guardarDistribucion(s: Session, revId: number, d: DatosDistribucion, por: number, motivo: string | null): Promise<number> {
  await validarDestinatarios(s, d);
  const en = ahora();
  let n = 0;
  const activas = await s.query<Row>("SELECT rol_id, usuario_id FROM sgc_distribucion WHERE revision_id = :rev AND retirado_en IS NULL", { rev: revId });
  const yaEsta = (campo: "rol_id" | "usuario_id", v: number) => activas.some((f) => Number(f[campo]) === v);
  for (const rol of d.roles) {
    if (yaEsta("rol_id", rol)) continue;
    await s.execute("INSERT INTO sgc_distribucion (revision_id, rol_id, usuario_id, punto_uso, requiere_lectura, creado_por, creado_en, motivo) VALUES (:rev, :rol, NULL, :punto, :req, :por, :en, :motivo)", { rev: revId, rol, punto: d.punto_uso, req: d.requiere_lectura ? 1 : 0, por, en, motivo });
    n += 1;
  }
  for (const u of d.usuarios) {
    if (yaEsta("usuario_id", u)) continue;
    await s.execute("INSERT INTO sgc_distribucion (revision_id, rol_id, usuario_id, punto_uso, requiere_lectura, creado_por, creado_en, motivo) VALUES (:rev, NULL, :u, :punto, :req, :por, :en, :motivo)", { rev: revId, u, punto: d.punto_uso, req: d.requiere_lectura ? 1 : 0, por, en, motivo });
    n += 1;
  }
  return n;
}

/* La distribucion de la revision anterior pasa a la nueva al publicarse (con acuses nuevos). */
export async function copiarDistribucion(s: Session, deRev: number, aRev: number, por: number): Promise<number> {
  const filas = await s.query<Row>("SELECT * FROM sgc_distribucion WHERE revision_id = :rev AND retirado_en IS NULL", { rev: deRev });
  for (const f of filas) {
    await s.execute("INSERT INTO sgc_distribucion (revision_id, rol_id, usuario_id, punto_uso, requiere_lectura, creado_por, creado_en, motivo) VALUES (:rev, :rol, :u, :punto, :req, :por, :en, :motivo)", { rev: aRev, rol: f.rol_id ?? null, u: f.usuario_id ?? null, punto: f.punto_uso ?? null, req: f.requiere_lectura, por, en: ahora(), motivo: "Se conserva la distribución de la revisión anterior" });
  }
  return filas.length;
}

export interface Destinatario {
  usuario_id: number;
  nombre: string;
  requiere: boolean;
  puntos: string[];
  leido_en: string | null;
  abierto_en: string | null;
  notificado_en: string | null;
}

/* Filas de distribucion activas y destinatarios efectivos de una revision, con su lectura. */
export async function estadoDistribucion(s: Session, revId: number): Promise<{ filas: Row[]; destinatarios: Destinatario[] }> {
  const filas = await s.query<Row>(
    `SELECT d.*, r.nombre AS rol_nombre, u.nombre AS usuario_nombre, c.nombre AS creado_por_nombre FROM sgc_distribucion d
     LEFT JOIN roles r ON r.id = d.rol_id LEFT JOIN usuarios u ON u.id = d.usuario_id LEFT JOIN usuarios c ON c.id = d.creado_por
     WHERE d.revision_id = :rev AND d.retirado_en IS NULL ORDER BY d.id`,
    { rev: revId },
  );
  if (!filas.length) return { filas, destinatarios: [] };
  const gente = new Map((await personas(s)).filter((p) => p.acciones.includes("documento_consultar_vigente")).map((p) => [p.id, p]));
  const porRol = await rolesVigentes(s);
  const mapa = new Map<number, Destinatario>();
  for (const f of filas) {
    const usuarios = f.usuario_id ? [Number(f.usuario_id)] : porRol.get(Number(f.rol_id)) || [];
    for (const u of usuarios) {
      const p = gente.get(u);
      if (!p) continue;
      const d = mapa.get(u) || { usuario_id: u, nombre: p.nombre, requiere: false, puntos: [], leido_en: null, abierto_en: null, notificado_en: null };
      // La lectura solo se exige a quien puede confirmarla.
      d.requiere = d.requiere || (!!Number(f.requiere_lectura) && p.acciones.includes("documento_acusar_lectura"));
      if (f.punto_uso && !d.puntos.includes(String(f.punto_uso))) d.puntos.push(String(f.punto_uso));
      mapa.set(u, d);
    }
  }
  const lecturas = await s.query<Row>("SELECT usuario_id, leido_en, abierto_en, notificado_en FROM sgc_lecturas WHERE revision_id = :rev", { rev: revId });
  for (const l of lecturas) {
    const d = mapa.get(Number(l.usuario_id));
    if (d) {
      d.leido_en = (l.leido_en as string | null) ?? null;
      d.notificado_en = (l.notificado_en as string | null) ?? null;
      d.abierto_en = (l.abierto_en as string | null) ?? null;
    }
  }
  return { filas, destinatarios: [...mapa.values()].sort((x, y) => x.nombre.localeCompare(y.nombre, "es")) };
}

/* Revisiones vigentes (de las visibles) con lectura pendiente de la persona. */
export async function lecturasPendientesDe(s: Session, a: AccesoSgc, vigentes: Array<{ revision_id: number; doc: Row; numero: number }>): Promise<Array<{ revision_id: number; doc: Row; numero: number; notificado_en: string | null; desde: string | null }>> {
  if (!tiene(a, "documento_consultar_vigente") || !tiene(a, "documento_acusar_lectura") || !vigentes.length) return [];
  const revIds = vigentes.map((v) => v.revision_id);
  const ph = revIds.map((_, i) => `:r${i}`).join(", ");
  const params = Object.fromEntries(revIds.map((id, i) => [`r${i}`, id]));
  const filas = await s.query<Row>(`SELECT revision_id, rol_id, usuario_id, creado_en FROM sgc_distribucion WHERE retirado_en IS NULL AND requiere_lectura = 1 AND revision_id IN (${ph})`, params);
  if (!filas.length) return [];
  const leidas = await s.query<Row>(`SELECT revision_id, leido_en, notificado_en FROM sgc_lecturas WHERE usuario_id = :yo AND revision_id IN (${ph})`, { ...params, yo: a.yo });
  const out = [];
  for (const v of vigentes) {
    const mias = filas.filter((f) => Number(f.revision_id) === v.revision_id && ((f.usuario_id && Number(f.usuario_id) === a.yo) || (f.rol_id && a.rolIds.includes(Number(f.rol_id)))));
    if (!mias.length) continue;
    const l = leidas.find((x) => Number(x.revision_id) === v.revision_id);
    if (l?.leido_en) continue;
    out.push({ ...v, notificado_en: (l?.notificado_en as string | null) ?? null, desde: String(mias[0].creado_en) });
  }
  return out;
}

/* Lecturas pendientes de todas las revisiones dadas (indicador global para quien administra lecturas). */
export async function lecturasPendientesGlobales(s: Session, revIds: number[]): Promise<number> {
  let n = 0;
  for (const id of revIds) n += (await estadoDistribucion(s, id)).destinatarios.filter((d) => d.requiere && !d.leido_en).length;
  return n;
}

/* ---------- Endpoints ---------- */

async function vigenteDe(s: Session, a: AccesoSgc, rid: number) {
  const r = await revisionVisible(s, a, rid);
  if (r.rev.estado !== "vigente") throw new HttpError(409, { message: "La distribución y las lecturas son de la revisión vigente" });
  return r;
}

export async function agregarDistribucion({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  exigir(a, "documento_administrar_lecturas", "Solo quien administra lecturas define la distribución (documento_administrar_lecturas)");
  const { doc, rev } = await vigenteDe(s, a, intParam(params.rid));
  const raw = await readJson(request);
  const d = datosDistribucion(raw);
  if (!d) throw new HttpError(400, { message: "Elige al menos un rol o una persona", campo: "destinatarios" });
  const motivo = String(raw.motivo || "").trim();
  if (motivo.length < MOTIVO_MIN_SGC) throw new HttpError(400, { message: `Indica el motivo (al menos ${MOTIVO_MIN_SGC} caracteres)`, campo: "motivo" });
  await validarDestinatarios(s, d);
  await exigirReauth(s, request, user, "documentos:distribucion");
  const n = await guardarDistribucion(s, Number(rev.id), d, a.yo, motivo);
  await registrarAuditoria(s, user, { accion: "distribuir", entidad: ENTIDAD, entidadId: Number(doc.id), referencia: `${referenciaDe(doc)} rev. ${rev.numero}`, motivo, detalle: { distribucion: true, revision: Number(rev.numero), revision_id: Number(rev.id), roles: d.roles, usuarios: d.usuarios, punto_uso: d.punto_uso, requiere_lectura: d.requiere_lectura, agregados: n } });
  await s.commit();
  return json({ message: n ? `Distribución actualizada (${n} destinatario${n === 1 ? "" : "s"})` : "Esos destinatarios ya estaban en la distribución" }, 201);
}

export async function retirarDistribucion({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  exigir(a, "documento_administrar_lecturas", "Solo quien administra lecturas define la distribución (documento_administrar_lecturas)");
  const fila = await s.queryOne<Row>("SELECT * FROM sgc_distribucion WHERE id = :id AND retirado_en IS NULL", { id: intParam(params.did) });
  if (!fila) throw new HttpError(404, { message: "Destinatario no encontrado" });
  const { doc, rev } = await vigenteDe(s, a, Number(fila.revision_id));
  const motivo = String((await readJson(request)).motivo || "").trim();
  if (motivo.length < MOTIVO_MIN_SGC) throw new HttpError(400, { message: `Indica el motivo (al menos ${MOTIVO_MIN_SGC} caracteres)`, campo: "motivo" });
  await exigirReauth(s, request, user, "documentos:distribucion");
  await s.execute("UPDATE sgc_distribucion SET retirado_en = :en, retirado_por = :por, motivo_retiro = :m WHERE id = :id AND retirado_en IS NULL", { en: ahora(), por: a.yo, m: motivo, id: fila.id });
  await registrarAuditoria(s, user, { accion: "retirar_distribucion", entidad: ENTIDAD, entidadId: Number(doc.id), referencia: `${referenciaDe(doc)} rev. ${rev.numero}`, motivo, detalle: { distribucion: true, revision: Number(rev.numero), revision_id: Number(rev.id), rol_id: fila.rol_id ?? null, usuario_id: fila.usuario_id ?? null } });
  await s.commit();
  return json({ message: "Destinatario retirado de la distribución" });
}

export async function recordatorioLecturas({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  exigir(a, "documento_administrar_lecturas", "Solo quien administra lecturas envía recordatorios (documento_administrar_lecturas)");
  const { doc, rev } = await vigenteDe(s, a, intParam(params.rid));
  const pendientes = (await estadoDistribucion(s, Number(rev.id))).destinatarios.filter((d) => d.requiere && !d.leido_en);
  if (!pendientes.length) throw new HttpError(409, { message: "No hay lecturas pendientes en esta revisión" });
  const en = ahora();
  for (const d of pendientes) {
    const r = await s.execute("UPDATE sgc_lecturas SET notificado_en = :en WHERE revision_id = :rev AND usuario_id = :u", { en, rev: rev.id, u: d.usuario_id });
    if (!r.rowcount) await s.execute("INSERT INTO sgc_lecturas (revision_id, usuario_id, notificado_en, estado) VALUES (:rev, :u, :en, 'pendiente')", { rev: rev.id, u: d.usuario_id, en });
  }
  await registrarAuditoria(s, user, { accion: "recordar", entidad: ENTIDAD, entidadId: Number(doc.id), referencia: `${referenciaDe(doc)} rev. ${rev.numero}`, detalle: { recordatorio_lectura: true, revision: Number(rev.numero), revision_id: Number(rev.id), destinatarios: pendientes.map((d) => d.usuario_id) } });
  await s.commit();
  return json({ message: `Recordatorio enviado a ${pendientes.length} persona${pendientes.length === 1 ? "" : "s"}` });
}

export async function acusarLectura({ request, s, params }: RouteContext): Promise<Response> {
  const user = await requireUser(request);
  const a = await acceso(s, user);
  exigir(a, "documento_acusar_lectura", "No tienes permiso para confirmar lecturas (documento_acusar_lectura)");
  const { doc, rev } = await vigenteDe(s, a, intParam(params.rid));
  const yo = (await estadoDistribucion(s, Number(rev.id))).destinatarios.find((d) => d.usuario_id === a.yo);
  if (!yo || !yo.requiere) throw new HttpError(409, { message: "No eres destinatario con lectura requerida de esta revisión", codigo: "no_destinatario" });
  if (yo.leido_en) throw new HttpError(409, { message: "Ya confirmaste la lectura de esta revisión", codigo: "ya_leido" });
  const abierto = await s.queryOne<Row>("SELECT abierto_en FROM sgc_lecturas WHERE revision_id = :rev AND usuario_id = :u", { rev: rev.id, u: a.yo });
  if (!abierto?.abierto_en) throw new HttpError(409, { message: "Abre el PDF vigente en el visor antes de confirmar la lectura", codigo: "sin_abrir" });
  const en = ahora();
  const r = await s.execute("UPDATE sgc_lecturas SET leido_en = :en, estado = 'leido' WHERE revision_id = :rev AND usuario_id = :u AND leido_en IS NULL", { en, rev: rev.id, u: a.yo });
  if (!r.rowcount) await s.execute("INSERT INTO sgc_lecturas (revision_id, usuario_id, leido_en, estado) VALUES (:rev, :u, :en, 'leido')", { rev: rev.id, u: a.yo, en });
  const comentario = textoLargo((await readJson(request)).comentario, 500);
  await registrarAuditoria(s, user, { accion: "confirmar_lectura", entidad: ENTIDAD, entidadId: Number(doc.id), referencia: `${referenciaDe(doc)} rev. ${rev.numero}`, motivo: comentario, detalle: { revision: Number(rev.numero), revision_id: Number(rev.id), leido_en: en } });
  await s.commit();
  return json({ message: `Lectura de la revisión ${rev.numero} confirmada`, leido_en: en });
}

