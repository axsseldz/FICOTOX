/*
 * Modelo de permisos (Fase 1; "Roles y permisos FICOTOX", FX-MO-2-1, seccion 5).
 * Compartido entre servidor y cliente.
 *
 * Un permiso es (rol, modulo, accion, alcance). Acciones:
 *   V Visualizar · C Crear/capturar · E Editar borrador · R Revisar ·
 *   A Aprobar/validar/liberar · AN Anular con justificacion · G Administrar.
 * C, E, R, A y AN implican V; G implica todas las acciones del modulo.
 * El alcance limita la accion; "total" = sin limite. Los permisos efectivos de
 * una persona son la union de sus roles vigentes; para un mismo modulo y
 * accion vale cualquiera de sus alcances (gana el mas amplio).
 */

export const MODULOS = [
  { clave: "usuarios", nombre: "Usuarios y roles", descripcion: "Cuentas, roles y asignacion de roles" },
  { clave: "documentos", nombre: "Documentos SGC", descripcion: "Calidad › Documentos SGC: acciones documentales (consultar, proponer, crear fichas, elaborar, revisar, autorizar, publicar, obsoletar, lecturas, externos y Lista Maestra)" },
  { clave: "muestras", nombre: "Muestras", descripcion: "Recepcion, custodia y disposicion final" },
  { clave: "ensayos", nombre: "Ensayos", descripcion: "Procesamiento, extraccion y analisis (revision y aprobacion de analisis)" },
  { clave: "informes", nombre: "Informes", descripcion: "Informes de resultados" },
  { clave: "equipos", nombre: "Equipos", descripcion: "Equipos y mantenimientos" },
  { clave: "inventario", nombre: "Inventario", descripcion: "Reactivos, consumibles y movimientos" },
  { clave: "calidad", nombre: "Calidad", descripcion: "Bitacora de auditoria, incidencias, no conformidades y acciones correctivas (auditorias internas en una fase posterior)" },
  { clave: "respaldos", nombre: "Respaldos", descripcion: "Calidad › Respaldos: ver los respaldos y las pruebas de restauración (V) y crear respaldos o probar la restauración (G)" },
  { clave: "compras", nombre: "Compras", descripcion: "Sin pantallas todavia (Fase 8)" },
] as const;

export type Modulo = (typeof MODULOS)[number]["clave"];
const MODULO_KEYS: Modulo[] = MODULOS.map((m) => m.clave);

export const ACCIONES = [
  { clave: "V", nombre: "Visualizar" },
  { clave: "C", nombre: "Crear / capturar" },
  { clave: "E", nombre: "Editar borrador" },
  { clave: "R", nombre: "Revisar" },
  { clave: "A", nombre: "Aprobar / validar / liberar" },
  { clave: "AN", nombre: "Anular con justificación" },
  { clave: "G", nombre: "Administrar / configurar" },
] as const;

export type AccionClasica = (typeof ACCIONES)[number]["clave"];
export const ACCION_KEYS: AccionClasica[] = ACCIONES.map((a) => a.clave);

/*
 * Documentos SGC (especificacion del modulo documental, seccion 7): el modulo
 * "documentos" no usa V/C/E/R/A/AN/G sino acciones documentales propias, sin
 * alcance (siempre "total") y sin implicaciones entre ellas. Cualquiera de
 * ellas da acceso al modulo (documentos:V). El rol HABILITA la accion; sobre
 * cada revision actua solo quien esta asignado (flujo, Fase 2), y la
 * confidencialidad del documento limita quien lo ve.
 */
export const ACCIONES_DOCUMENTALES = [
  { clave: "documento_consultar_vigente", nombre: "Consultar vigentes", descripcion: "Abrir y descargar la revisión vigente autorizada" },
  { clave: "documento_proponer", nombre: "Proponer", descripcion: "Registrar una necesidad o solicitud de cambio" },
  { clave: "documento_crear_ficha", nombre: "Crear ficha", descripcion: "Crear y editar la ficha maestra con la clave FX autorizada; abrir revisiones nuevas" },
  { clave: "documento_elaborar", nombre: "Elaborar", descripcion: "Cargar o sustituir archivos mientras la revisión está en borrador" },
  { clave: "documento_enviar_revision", nombre: "Enviar a revisión", descripcion: "Bloquear el borrador y remitirlo al revisor" },
  { clave: "documento_revisar", nombre: "Revisar", descripcion: "Aceptar, rechazar o devolver con comentarios" },
  { clave: "documento_autorizar", nombre: "Autorizar", descripcion: "Autorizar la emisión de la revisión asignada" },
  { clave: "documento_publicar", nombre: "Publicar", descripcion: "Activar la revisión autorizada y sustituir la vigente anterior" },
  { clave: "documento_obsoletar", nombre: "Obsoletar", descripcion: "Retirar del uso activo conservando el historial" },
  { clave: "documento_consultar_historico", nombre: "Consultar histórico", descripcion: "Consultar borradores, revisiones anteriores y sus aprobaciones" },
  { clave: "documento_acusar_lectura", nombre: "Acusar lectura", descripcion: "Confirmar la lectura de una revisión específica" },
  { clave: "documento_administrar_lecturas", nombre: "Administrar lecturas", descripcion: "Asignar destinatarios, emitir recordatorios y consultar pendientes" },
  { clave: "documento_externo_gestionar", nombre: "Gestionar externos", descripcion: "Registrar y revisar normas, guías y documentos externos" },
  { clave: "lista_maestra_exportar", nombre: "Exportar Lista Maestra", descripcion: "Generar y exportar la Lista Maestra" },
] as const;

export type AccionDocumental = (typeof ACCIONES_DOCUMENTALES)[number]["clave"];
export const ACCION_DOCUMENTAL_KEYS: AccionDocumental[] = ACCIONES_DOCUMENTALES.map((a) => a.clave);
export const MODULO_DOCUMENTAL = "documentos";

export type Accion = AccionClasica | AccionDocumental;

/*
 * Alcances. `fase` null = se aplica ya. Los diferidos se guardan y se muestran
 * con su fase. Mientras no se aplican (privilegio minimo, Fase 2):
 * - en calidad y en usuarios NO dan acceso a datos de terceros: en calidad no
 *   dan ningun permiso y en usuarios equivalen a V "propio" (solo su cuenta);
 * - en los demas modulos se comportan como "total" (son necesarios para el
 *   trabajo diario y no exponen datos fuera del laboratorio). Ver
 *   CLAUDE.md.
 */
export const ALCANCES = [
  { clave: "total", nombre: "Total", fase: null, descripcion: "Sin limite" },
  { clave: "propio", nombre: "Propio", fase: null, descripcion: "Solo su propia cuenta" },
  { clave: "estado", nombre: "Estado", fase: null, descripcion: "Solo folio, solicitante, fechas y estado; sin datos tecnicos, resultados ni firmas" },
  { clave: "recepcion", nombre: "Recepción", fase: null, descripcion: "Crear y editar solo recepciones" },
  { clave: "preparacion", nombre: "Preparación", fase: null, descripcion: "Crear y editar solo procesamientos" },
  { clave: "borrador", nombre: "Borrador", fase: null, descripcion: "Crear y editar solo mientras el registro esta en borrador o registrado" },
  { clave: "bitacora", nombre: "Bitácora", fase: null, descripcion: "Solo la bitacora de auditoria" },
  { clave: "uso", nombre: "Uso", fase: null, descripcion: "Solo registrar uso y folio de bitacora al capturar extracciones y analisis; no el catalogo" },
  { clave: "mantenimiento", nombre: "Mantenimiento", fase: null, descripcion: "Solo mantenimientos; no el catalogo de equipos" },
  { clave: "movimientos", nombre: "Movimientos", fase: null, descripcion: "Solo movimientos y reposiciones; no el catalogo" },
  { clave: "asignado", nombre: "Asignado", fase: null, descripcion: "Solo las muestras asignadas a la persona (o registradas por ella)" },
  { clave: "supervisado", nombre: "Supervisado", fase: null, descripcion: "Lo que crea o edita queda pendiente del visto bueno de su supervisor" },
  { clave: "proyecto", nombre: "Proyecto", fase: "8", descripcion: "Solo su proyecto" },
  { clave: "tecnico", nombre: "Técnico", fase: "7/8", descripcion: "En documentos equivale a total (sin filtro por tipo de documento)" },
  { clave: "investigacion", nombre: "Investigación", fase: "7/8", descripcion: "En documentos equivale a total (sin filtro por tipo de documento)" },
  { clave: "autorizados", nombre: "Autorizados", fase: null, descripcion: "En Documentos SGC lo que ve cada quien lo fijan sus acciones documentales; en los documentos heredados, solo los visibles para todos o para su rol" },
  { clave: "administrativo", nombre: "Administrativo", fase: "7/8", descripcion: "Solo lo administrativo" },
  { clave: "limitado", nombre: "Limitado", fase: "posterior", descripcion: "Vista limitada" },
  { clave: "incidencias", nombre: "Incidencias", fase: null, descripcion: "Reportar incidencias y ver solo las propias y las NC o acciones de las que es responsable; no la bitacora" },
  { clave: "auditoria", nombre: "Auditorías internas", fase: "8", descripcion: "Solo auditorias internas" },
] as const;

export type Alcance = (typeof ALCANCES)[number]["clave"];
const ALCANCE_KEYS: Alcance[] = ALCANCES.map((a) => a.clave);
const ALCANCES_DIFERIDOS = new Set<Alcance>(ALCANCES.filter((a) => a.fase !== null).map((a) => a.clave));

/* Modulos donde un alcance diferido NO abre datos mientras no se aplica. */
const MODULOS_DIFERIDO_RESTRINGIDO: Record<string, "sin_acceso" | "propio"> = {
  calidad: "sin_acceso",
  usuarios: "propio",
};

/* Alcances que limitan tambien lo que se ve; los demas solo limitan la operacion. */
const LIMITAN_VISTA = new Set<Alcance>(["propio", "estado", "bitacora", "asignado", "autorizados", "incidencias"]);

/*
 * En ensayos, quien solo opera con "borrador" o "preparacion" (estudiante, tecnico auxiliar) ve lo de las
 * muestras que tiene asignadas o registro: su V es "asignado", igual que la operacion (que ya exige la asignacion).
 */
const VISTA_ASIGNADA: Partial<Record<Modulo, ReadonlySet<Alcance>>> = { ensayos: new Set<Alcance>(["borrador", "preparacion"]) };

function alcanceDeVista(modulo: Modulo, alcance: Alcance): Alcance {
  if (VISTA_ASIGNADA[modulo]?.has(alcance)) return "asignado";
  return LIMITAN_VISTA.has(alcance) || ALCANCES_DIFERIDOS.has(alcance) ? alcance : "total";
}

/*
 * Fase 11: alcances que solo valen con un objeto de su ambito. "incidencias"
 * (en calidad) permite reportar y ver incidencias, NC y acciones propias, pero
 * NUNCA cuenta para una comprobacion sin contexto (bitacora, respaldos, menu de
 * Auditoria): ahi se comporta como si no existiera.
 */
export const ALCANCES_SOLO_CON_OBJETO = new Set<Alcance>(["incidencias"]);
const OBJETOS_INCIDENCIAS = new Set(["incidencia", "nc", "accion_correctiva"]);

export function isModulo(value: unknown): value is Modulo {
  return typeof value === "string" && (MODULO_KEYS as string[]).includes(value);
}
export function isAccionClasica(value: unknown): value is AccionClasica {
  return typeof value === "string" && (ACCION_KEYS as string[]).includes(value);
}
export function isAccionDocumental(value: unknown): value is AccionDocumental {
  return typeof value === "string" && (ACCION_DOCUMENTAL_KEYS as string[]).includes(value);
}
export function isAccion(value: unknown): value is Accion {
  return isAccionClasica(value) || isAccionDocumental(value);
}
/* ¿La accion corresponde al modulo? En "documentos" solo las documentales; en los demas, solo V/C/E/R/A/AN/G. */
export function accionDeModulo(modulo: unknown, accion: unknown): boolean {
  return modulo === MODULO_DOCUMENTAL ? isAccionDocumental(accion) : isModulo(modulo) && isAccionClasica(accion);
}
export function isAlcance(value: unknown): value is Alcance {
  return typeof value === "string" && (ALCANCE_KEYS as string[]).includes(value);
}

/* Fila de permiso tal como se guarda (rol_acciones). */
export interface PermisoFila {
  modulo: string;
  accion: string;
  alcance: string;
}

/* Permisos efectivos: modulo -> accion -> alcances. */
export type PermisosEfectivos = Partial<Record<Modulo, Partial<Record<Accion, Alcance[]>>>>;
/* Forma que devuelve /api/auth/me: { modulo: { accion: alcance } } (el mas amplio). */
export type PermisosMapa = Partial<Record<Modulo, Partial<Record<Accion, Alcance>>>>;

function add(target: PermisosEfectivos, modulo: Modulo, accion: Accion, alcance: Alcance): void {
  const acciones = (target[modulo] ||= {});
  const lista = (acciones[accion] ||= []);
  if (!lista.includes(alcance)) lista.push(alcance);
}

/*
 * Expande implicaciones (G -> todas; C/E/R/A/AN -> V) y aplica la regla de
 * usuarios (alcance diferido = solo V). Acepta filas de uno o varios roles.
 * Fase 3.1: en usuarios, G no implica A; aprobar cambios de acceso exige A
 * explicito (Responsable General).
 */
export function expandirPermisos(filas: PermisoFila[]): PermisosEfectivos {
  const out: PermisosEfectivos = {};
  for (const fila of filas) {
    if (!isModulo(fila.modulo) || !isAccion(fila.accion)) continue;
    if (fila.modulo === MODULO_DOCUMENTAL) {
      // Acciones documentales: sin alcance ni implicaciones; cualquiera da acceso al modulo (V).
      // Un "G" anterior en documentos (filas previas a la migracion 22 o el rol de pruebas) equivale a todas.
      const documentales = fila.accion === "G" ? ACCION_DOCUMENTAL_KEYS : isAccionDocumental(fila.accion) ? [fila.accion] : [];
      for (const accion of documentales) {
        add(out, MODULO_DOCUMENTAL, accion, "total");
        add(out, MODULO_DOCUMENTAL, "V", "total");
      }
      continue;
    }
    if (!isAccionClasica(fila.accion)) continue;
    const alcance: Alcance = isAlcance(fila.alcance) ? fila.alcance : "total";
    const modulo = fila.modulo;
    const restriccion = ALCANCES_DIFERIDOS.has(alcance) ? MODULOS_DIFERIDO_RESTRINGIDO[modulo] : undefined;
    if (restriccion === "sin_acceso") continue;
    if (restriccion === "propio") {
      add(out, modulo, "V", "propio");
      continue;
    }
    const acciones: Accion[] = fila.accion === "G" ? ACCION_KEYS.filter((a) => !(modulo === "usuarios" && a === "A")) : [fila.accion];
    for (const accion of acciones) {
      add(out, modulo, accion, alcance);
      if (accion !== "V") add(out, modulo, "V", alcanceDeVista(modulo, alcance));
    }
  }
  return out;
}

/* Un alcance efectivo equivale a "total" si es total o diferido (todavia no se aplica). */
export function esTotal(alcances: readonly string[] | undefined): boolean {
  return !!alcances && alcances.some((a) => a === "total" || ALCANCES_DIFERIDOS.has(a as Alcance));
}

/* Rango para elegir el alcance "mas amplio": total > diferido > aplicado. */
function rango(alcance: Alcance): number {
  if (alcance === "total") return 0;
  if (ALCANCES_DIFERIDOS.has(alcance)) return 1;
  return 2;
}

function alcanceMasAmplio(alcances: readonly Alcance[]): Alcance {
  return [...alcances].sort((a, b) => rango(a) - rango(b))[0];
}

export function mapaPermisos(efectivos: PermisosEfectivos): PermisosMapa {
  const out: PermisosMapa = {};
  for (const modulo of MODULO_KEYS) {
    const acciones = efectivos[modulo];
    if (!acciones) continue;
    const fila: Partial<Record<Accion, Alcance>> = {};
    for (const accion of [...ACCION_KEYS, ...ACCION_DOCUMENTAL_KEYS]) {
      const lista = acciones[accion];
      if (lista?.length) fila[accion] = alcanceMasAmplio(lista);
    }
    out[modulo] = fila;
  }
  return out;
}

/*
 * Contexto de la operacion para evaluar un alcance aplicado:
 * - objeto: que se toca (recepcion, procesamiento, extraccion, analisis,
 *   equipo, mantenimiento, uso_equipo, catalogo_inventario, movimiento,
 *   bitacora, usuario, informe, documento).
 * - borrador: el registro esta (o queda) en borrador/registrado.
 * - propio: el registro es la cuenta de quien actua.
 */
export interface ContextoAlcance {
  objeto?: string;
  borrador?: boolean;
  propio?: boolean;
  /* Fase 5: la muestra esta asignada a la persona (alcance "asignado"). */
  asignado?: boolean;
}

export function alcancePermite(alcance: Alcance, ctx: ContextoAlcance = {}): boolean {
  if (alcance === "total" || ALCANCES_DIFERIDOS.has(alcance)) return true;
  switch (alcance) {
    case "propio":
      return ctx.propio === true;
    case "autorizados":
      // Se permite; en los documentos heredados el servidor filtra a los visibles para todos o para el rol de la persona.
      return true;
    case "asignado":
      // Fase 5: se permite salvo que el servidor sepa que la muestra no esta asignada a la persona.
      return ctx.asignado !== false;
    case "supervisado":
      // Se permite; lo que se crea o edita queda pendiente del visto bueno del supervisor.
      return true;
    case "estado":
      // Solo acota lo que se devuelve; la vista se permite y se recorta en el servidor.
      return true;
    case "recepcion":
      return ctx.objeto === "recepcion";
    case "preparacion":
      return ctx.objeto === "procesamiento";
    case "borrador":
      return ctx.borrador === true;
    case "bitacora":
      return !ctx.objeto || ctx.objeto === "bitacora";
    case "uso":
      return ctx.objeto === "uso_equipo";
    case "mantenimiento":
      return ctx.objeto === "mantenimiento";
    case "movimientos":
      return ctx.objeto === "movimiento";
    case "incidencias":
      // Fase 11: solo incidencias, NC y acciones; el servidor filtra a las propias o donde es responsable.
      return !!ctx.objeto && OBJETOS_INCIDENCIAS.has(ctx.objeto);
    default:
      return false;
  }
}

/* ¿Alguno de los alcances permite la operacion en este contexto? */
export function permite(efectivos: PermisosEfectivos, modulo: Modulo, accion: Accion, ctx?: ContextoAlcance): boolean {
  const lista = efectivos[modulo]?.[accion];
  if (!lista?.length) return false;
  if (!ctx) return lista.some((alcance) => !ALCANCES_SOLO_CON_OBJETO.has(alcance));
  return lista.some((alcance) => alcancePermite(alcance, ctx));
}

/* Clave estable de un conjunto de filas, para comparar matrices. */
export function firmaFilas(filas: PermisoFila[]): string {
  return filas
    .map((f) => `${f.modulo}:${f.accion}:${f.alcance}`)
    .sort()
    .join("|");
}
