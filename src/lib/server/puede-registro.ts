import { esCoordinacion, soloAsignado } from "./asignaciones";
import { vigentesDe, requisitosEquipos } from "./autorizaciones";
import { getConfig } from "./config";
import type { Row, Session } from "./db";
import type { CurrentUser } from "./auth";
import { cargarAutorizacion, permisoDe, type Autorizacion } from "./rbac";
import { conSolicitudes, type SampleTable } from "./samples-flow";
import { elaboradoresDe, excepcionesDe } from "./segregacion";
import { safeJsonLoad } from "./modules/helpers";
import { faltantes, mensajeFaltante, requisitosAnalisis, requisitosExtraccion, requisitosInforme, requisitosProcesamiento, requisitosRecepcion, requisitosRevisionResultados, type Requisito } from "../shared/autorizaciones";
import { formatearFolio } from "../shared/folios";
import { evaluarAnalisis, evaluarInforme, excepcionPara } from "../shared/segregacion";

/*
 * Banderas "puede" por registro: lo que la persona de la sesion puede hacer
 * AHORA con cada registro, sumando el rol, la autorizacion FX-THF-AP (actividad,
 * metodo y equipos), la asignacion de la muestra y la separacion de funciones.
 * La interfaz las usa tal cual (como ya hacen las NC):
 * - { ok: true }                    el boton se ofrece;
 * - { ok: false }                   no puede (rol, autorizacion o asignacion): el boton se oculta;
 * - { ok: false, motivo: "..." }    lo bloquea solo la segregacion o algo pendiente: boton
 *                                   deshabilitado con el motivo como explicacion.
 * No dependen del estado del registro (eso ya lo decide cada pantalla): dicen si la
 * PERSONA puede hacer la accion sobre ese registro. Son solo informativas: el
 * servidor vuelve a comprobar todo al ejecutar la accion.
 */

export interface PuedeFlag {
  ok: boolean;
  motivo?: string;
}
export type Puede = Record<string, PuedeFlag>;

const SI: PuedeFlag = { ok: true };
const NO: PuedeFlag = { ok: false };
const bloqueado = (motivo: string): PuedeFlag => ({ ok: false, motivo });
const flag = (ok: boolean): PuedeFlag => (ok ? SI : NO);

export type TablaConPuede = "muestras_recepcion" | "muestras_procesamiento" | "muestras_extraccion" | "muestras_analisis" | "informes";

const ASIGNACIONES = "asignaciones_muestra";

/* Datos de la persona que se leen una sola vez por peticion. */
class Persona {
  private vigentes: Array<{ tipo: string; clave: string }> | null = null;
  private asignadas: Set<number> | null = null;
  constructor(
    private readonly s: Session,
    readonly auth: Autorizacion,
  ) {}

  get yo(): number {
    return this.auth.userId;
  }

  /* Autorizaciones FX-THF-AP vigentes; sin ellas obligatorias (AUTORIZACIONES_OBLIGATORIAS=false) todo se cumple. */
  async cumple(requisitos: Requisito[]): Promise<boolean> {
    return (await this.faltan(requisitos)).length === 0;
  }

  /* Los requisitos que no cubre ninguna autorizacion vigente (vacio si no son obligatorias). */
  async faltan(requisitos: Requisito[]): Promise<Requisito[]> {
    if (!getConfig().AUTORIZACIONES_OBLIGATORIAS || !requisitos.length) return [];
    if (!this.vigentes) this.vigentes = (await vigentesDe(this.s, this.yo)).map((a) => ({ tipo: a.tipo, clave: a.clave }));
    return faltantes(requisitos, this.vigentes as never);
  }

  async asignada(recepcionId: number | null): Promise<boolean> {
    if (!recepcionId) return true;
    if (esCoordinacion(this.auth)) return true;
    if (!this.asignadas) {
      const filas = await this.s.query<{ recepcion_id: number }>(`SELECT DISTINCT recepcion_id FROM ${ASIGNACIONES} WHERE usuario_id = :u AND revocado_en IS NULL`, { u: this.yo });
      this.asignadas = new Set(filas.map((f) => Number(f.recepcion_id)));
    }
    return this.asignadas.has(Number(recepcionId));
  }
}

const num = (value: unknown): number | null => (value === null || value === undefined || value === "" || Number.isNaN(Number(value)) ? null : Number(value));
const esSupervisionPendiente = (row: Row) => Number(row.requiere_supervision || 0) === 1 && ["pendiente", "regresado"].includes(String(row.supervision_estado || ""));
const MOTIVO_SUPERVISION = "Está pendiente del visto bueno de su supervisor";
const MOTIVO_SOLICITUD = "Tiene una solicitud pendiente de autorización";

async function recepcionDeProcesamiento(s: Session, procesamientoId: unknown): Promise<number | null> {
  const id = num(procesamientoId);
  return id === null ? null : num(await s.scalar("SELECT recepcion_id FROM muestras_procesamiento WHERE id = :id", { id }));
}

/* Mismo criterio que la lista y la ficha de recepciones: con alcance "asignado", solo lo asignado o registrado por la persona. */
async function vistaPermitida(p: Persona, permiso: ReturnType<typeof permisoDe>, row: Row): Promise<boolean> {
  if (!permiso || !soloAsignado(permiso)) return true;
  return Number(row.creado_por) === p.yo || (await p.asignada(num(row.id)));
}

/* Editar un formato: con el rol (y la asignacion) pero sin la autorizacion FX-THF-AP, el motivo dice cual falta; con solicitud pendiente, ese motivo. */
async function editarCon(p: Persona, rolOk: boolean, requisitos: () => Promise<Requisito[]> | Requisito[], pendiente: unknown): Promise<PuedeFlag> {
  if (!rolOk) return NO;
  const falta = await p.faltan(await requisitos());
  if (falta.length) return bloqueado(mensajeFaltante(falta));
  return pendiente ? bloqueado(MOTIVO_SOLICITUD) : SI;
}

/* ---------- Por tabla ---------- */

async function puedeRecepcion(p: Persona, row: Row): Promise<Puede> {
  const registrada = String(row.estado || "registrada") === "registrada";
  const permisoE = permisoDe(p.auth, "muestras", "E", { objeto: "recepcion", borrador: registrada });
  const out: Puede = {};
  out.editar = await editarCon(p, !!permisoE && (await vistaPermitida(p, permisoE, row)), requisitosRecepcion, row.__pendiente);
  out.anular = flag(!!permisoDe(p.auth, "muestras", "AN"));
  return out;
}

async function puedeProcesamiento(p: Persona, row: Row): Promise<Puede> {
  const registrada = String(row.estado || "registrada") === "registrada";
  const rol = !!permisoDe(p.auth, "ensayos", "E", { objeto: "procesamiento", borrador: registrada });
  const out: Puede = {};
  out.editar = await editarCon(p, rol && (await p.asignada(num(row.recepcion_id))), requisitosProcesamiento, row.__pendiente);
  out.anular = flag(!!permisoDe(p.auth, "ensayos", "AN"));
  return out;
}

async function puedeExtraccion(s: Session, p: Persona, row: Row): Promise<Puede> {
  const registrada = String(row.estado || "registrada") === "registrada";
  const rol = !!permisoDe(p.auth, "ensayos", "E", { objeto: "extraccion", borrador: registrada });
  const equipos = safeJsonLoad<Array<{ equipo_id?: unknown }>>(row.equipos_json, []).map((e) => e.equipo_id);
  const out: Puede = {};
  out.editar = await editarCon(p, rol && (await p.asignada(await recepcionDeProcesamiento(s, row.procesamiento_id))), async () => [...requisitosExtraccion(row.tipo_registro), ...(await requisitosEquipos(s, equipos))], row.__pendiente);
  out.anular = flag(!!permisoDe(p.auth, "ensayos", "AN"));
  return out;
}

async function puedeAnalisis(s: Session, p: Persona, row: Row, detalle: boolean): Promise<Puede> {
  const id = Number(row.id);
  const out: Puede = {};
  const supervision = esSupervisionPendiente(row);
  const asignada = await p.asignada(num(row.recepcion_id));
  const equipoReq = await requisitosEquipos(s, [row.equipo_id]);

  out.editar = await editarCon(p, !!permisoDe(p.auth, "ensayos", "E", { objeto: "analisis", borrador: true }) && asignada, () => [...requisitosAnalisis(row.tipo_analisis), ...equipoReq], row.__pendiente);
  out.enviar_revision = flag(!!permisoDe(p.auth, "ensayos", "C", { objeto: "analisis", borrador: true }) && asignada);
  if (supervision && out.enviar_revision.ok) out.enviar_revision = bloqueado(MOTIVO_SUPERVISION);
  out.anular = flag(!!permisoDe(p.auth, "ensayos", "AN"));
  out.enmendar = flag(!!permisoDe(p.auth, "ensayos", "C", { objeto: "analisis", borrador: true }) && asignada && (await p.cumple(requisitosAnalisis(row.tipo_analisis))));

  if (!detalle) return out;

  // Segregacion (regla 1): quien elaboro el analisis no lo revisa ni aprueba, salvo excepcion aprobada.
  const segregacion = async (accion: "revisar" | "aprobar"): Promise<string | null> => {
    const v = evaluarAnalisis(p.yo, await elaboradoresDe(s, "muestras_analisis", id, row.creado_por), accion);
    return v && !excepcionPara(excepcionesDe(row), p.yo, accion === "revisar" ? "revisar" : "aprobar") ? "Tú elaboraste este análisis; debe revisarlo otra persona" : null;
  };
  const conRegla = async (ok: boolean, accion: "revisar" | "aprobar", textoAprobar = "Tú elaboraste este análisis; debe aprobarlo otra persona"): Promise<PuedeFlag> => {
    if (!ok) return NO;
    const seg = await segregacion(accion);
    if (seg) return bloqueado(accion === "aprobar" ? textoAprobar : seg);
    return supervision ? bloqueado(MOTIVO_SUPERVISION) : SI;
  };
  out.devolver = await (async () => {
    if (!permisoDe(p.auth, "ensayos", "R")) return NO;
    const seg = await segregacion("revisar");
    return seg ? bloqueado(seg) : SI;
  })();
  out.revisar = await conRegla(!!permisoDe(p.auth, "ensayos", "R") && (await p.cumple(requisitosRevisionResultados(row.tipo_analisis, "revisar"))), "revisar");
  out.aprobar = await conRegla(!!permisoDe(p.auth, "ensayos", "A") && (await p.cumple(requisitosRevisionResultados(row.tipo_analisis, "aprobar"))), "aprobar");
  return out;
}

async function puedeInforme(s: Session, p: Persona, row: Row, detalle: boolean): Promise<Puede> {
  const out: Puede = {};
  const supervision = esSupervisionPendiente(row);
  const pendiente = !!row.__pendiente;
  out.editar = flag(!!permisoDe(p.auth, "informes", "E", { objeto: "informe", borrador: true }));
  if (pendiente && out.editar.ok) out.editar = bloqueado(MOTIVO_SOLICITUD);
  out.anular = flag(!!permisoDe(p.auth, "informes", "AN"));
  out.enmendar = flag(!!permisoDe(p.auth, "informes", "C", { objeto: "informe", borrador: true }));
  out.enviar = flag(!!permisoDe(p.auth, "informes", "A"));
  if (!detalle) return out;

  // Segregacion (regla 2): quien elaboro el informe, o alguno de sus analisis, no lo revisa ni autoriza.
  const ids = safeJsonLoad<number[]>(row.analisis_ids_json, []);
  const segregacion = async (accion: "revisar" | "autorizar"): Promise<string | null> => {
    const elaboradores = await elaboradoresDe(s, "informes", Number(row.id), row.creado_por, row.elaborado_por);
    const porAnalisis: Array<{ folio: string; elaboradores: Set<number> }> = [];
    for (const analisisId of ids) {
      const fila = await s.queryOne<Row>("SELECT id, folio_num, creado_por FROM muestras_analisis WHERE id = :id", { id: analisisId });
      if (fila) porAnalisis.push({ folio: formatearFolio("A", fila.folio_num), elaboradores: await elaboradoresDe(s, "muestras_analisis", analisisId, fila.creado_por) });
    }
    const v = evaluarInforme(p.yo, elaboradores, porAnalisis, accion);
    return v && !excepcionPara(excepcionesDe(row), p.yo, accion) ? v.mensaje : null;
  };
  const conRegla = async (ok: boolean, accion: "revisar" | "autorizar"): Promise<PuedeFlag> => {
    if (!ok) return NO;
    const seg = await segregacion(accion);
    if (seg) return bloqueado(seg);
    if (supervision) return bloqueado(MOTIVO_SUPERVISION);
    return pendiente ? bloqueado(MOTIVO_SOLICITUD) : SI;
  };
  out.revisar = await conRegla(!!permisoDe(p.auth, "informes", "R") && (await p.cumple(requisitosInforme("revisar"))), "revisar");
  out.autorizar = await conRegla(!!permisoDe(p.auth, "informes", "A") && (await p.cumple(requisitosInforme("autorizar"))), "autorizar");
  const liberar = !!permisoDe(p.auth, "informes", "A") && (await p.cumple(requisitosInforme("liberar")));
  out.liberar = liberar && pendiente ? bloqueado(MOTIVO_SOLICITUD) : flag(liberar);
  return out;
}

/*
 * Banderas de una lista de registros (una sola lectura por tabla). `pendientes`
 * son los ids con solicitud de autorizacion pendiente.
 */
export async function banderasPuede(s: Session, auth: Autorizacion, tabla: TablaConPuede, ids: number[], pendientes: Set<number> = new Set(), detalle = false): Promise<Map<number, Puede>> {
  const out = new Map<number, Puede>();
  const limpios = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!limpios.length) return out;
  const filas = await s.query<Row>(`SELECT * FROM ${tabla} WHERE id IN (${limpios.join(", ")})`);
  const p = new Persona(s, auth);
  for (const fila of filas) {
    const row: Row = { ...fila, __pendiente: pendientes.has(Number(fila.id)) };
    let puede: Puede;
    if (tabla === "muestras_recepcion") puede = await puedeRecepcion(p, row);
    else if (tabla === "muestras_procesamiento") puede = await puedeProcesamiento(p, row);
    else if (tabla === "muestras_extraccion") puede = await puedeExtraccion(s, p, row);
    else if (tabla === "muestras_analisis") puede = await puedeAnalisis(s, p, row, detalle);
    else puede = await puedeInforme(s, p, row, detalle);
    out.set(Number(fila.id), puede);
  }
  return out;
}

/* Agrega `puede` a cada registro ya serializado (usa row.id y row.solicitud_pendiente). */
export async function conPuede<T extends Row>(s: Session, auth: Autorizacion, tabla: TablaConPuede, rows: T[]): Promise<Array<T & { puede: Puede }>> {
  const pendientes = new Set(rows.filter((r) => r.solicitud_pendiente).map((r) => Number(r.id)));
  const mapa = await banderasPuede(s, auth, tabla, rows.map((r) => Number(r.id)), pendientes);
  return rows.map((r) => ({ ...r, puede: mapa.get(Number(r.id)) || {} }));
}

/* ¿Puede crear cada tipo de registro? (rol + autorizacion de la actividad). Para los botones "Nueva ...". */
export async function puedeCrearRegistros(s: Session, auth: Autorizacion): Promise<Record<string, PuedeFlag>> {
  const p = new Persona(s, auth);
  // Con el rol pero sin la autorizacion FX-THF-AP de la actividad: el motivo dice cual falta.
  const crear = async (rol: boolean, requisitos: Requisito[]): Promise<PuedeFlag> => {
    if (!rol) return NO;
    const falta = await p.faltan(requisitos);
    return falta.length ? bloqueado(mensajeFaltante(falta)) : SI;
  };
  return {
    recepcion: await crear(!!permisoDe(auth, "muestras", "C", { objeto: "recepcion", borrador: true }), requisitosRecepcion()),
    procesamiento: await crear(!!permisoDe(auth, "ensayos", "C", { objeto: "procesamiento", borrador: true }), requisitosProcesamiento()),
    extraccion: await crear(!!permisoDe(auth, "ensayos", "C", { objeto: "extraccion", borrador: true }), [{ tipo: "actividad", clave: "extraccion", texto: "extracción" }]),
    analisis: await crear(!!permisoDe(auth, "ensayos", "C", { objeto: "analisis", borrador: true }), [{ tipo: "actividad", clave: "analisis", texto: "análisis" }]),
    informe: flag(!!permisoDe(auth, "informes", "C", { objeto: "informe", borrador: true })),
  };
}

/* Lo que ya hacian las listas y fichas de muestras (solicitud pendiente) mas las banderas `puede` de la persona. */
export async function conSolicitudesYPuede<T extends Row>(s: Session, user: CurrentUser, tabla: Exclude<TablaConPuede, "informes">, rows: T[]) {
  const auth = await cargarAutorizacion(s, user);
  return conPuede(s, auth, tabla, await conSolicitudes(s, tabla as SampleTable, rows));
}
