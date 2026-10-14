import { ACCION_DOCUMENTAL_KEYS, ACCION_KEYS, isAccionClasica, isAccionDocumental, isModulo, type AccionClasica, type AccionDocumental, type PermisoFila } from "@/lib/shared/permisos";

/*
 * Permisos de un rol en lenguaje cotidiano (Administración › Roles): nunca
 * letras ni claves. "Muestras: ver y registrar; editar solo las asignadas".
 * Solo presentacion: la matriz y sus reglas no cambian.
 */

/* Areas en el orden en que se muestran (clave del modulo -> nombre). */
/* `acciones`: solo esas columnas aplican al área (Respaldos: ver y administrar); `soloTotal`: sin alcances intermedios. */
/* Documentos SGC no esta en la matriz: tiene sus acciones documentales propias (ACCIONES_DOCUMENTALES). */
export const AREAS_PERMISOS: Array<{ clave: string; nombre: string; detalle: string; acciones?: AccionClasica[]; soloTotal?: boolean }> = [
  { clave: "muestras", nombre: "Muestras", detalle: "Recepción, custodia y disposición final" },
  { clave: "ensayos", nombre: "Ensayos", detalle: "Procesamiento, extracción y análisis" },
  { clave: "informes", nombre: "Informes", detalle: "Informes de resultados" },
  { clave: "equipos", nombre: "Equipos", detalle: "Equipos y mantenimientos" },
  { clave: "inventario", nombre: "Inventario", detalle: "Reactivos, consumibles y movimientos" },
  { clave: "calidad", nombre: "Calidad", detalle: "Registro de actividad, incidencias y no conformidades" },
  { clave: "usuarios", nombre: "Usuarios", detalle: "Cuentas, roles y autorizaciones" },
  { clave: "respaldos", nombre: "Respaldos", detalle: "Copias de seguridad y pruebas de restauración", acciones: ["V", "G"], soloTotal: true },
  { clave: "compras", nombre: "Compras", detalle: "Todavía sin pantallas" },
];

/* Columnas del editor y verbos de las frases. */
export const ACCIONES_LEGIBLES: Record<AccionClasica, { columna: string; verbo: string }> = {
  V: { columna: "Ver", verbo: "ver" },
  C: { columna: "Crear", verbo: "registrar" },
  E: { columna: "Editar", verbo: "editar" },
  R: { columna: "Revisar", verbo: "revisar" },
  A: { columna: "Aprobar", verbo: "aprobar" },
  AN: { columna: "Anular", verbo: "anular" },
  G: { columna: "Administrar", verbo: "administrar" },
};

/* Acciones documentales en palabras (frases de "Qué puede hacer"). */
export const VERBOS_DOCUMENTALES: Record<AccionDocumental, string> = {
  documento_consultar_vigente: "consultar los documentos vigentes",
  documento_proponer: "proponer cambios",
  documento_crear_ficha: "crear fichas",
  documento_elaborar: "elaborar los que se le asignan",
  documento_enviar_revision: "enviarlos a revisión",
  documento_revisar: "revisar los que se le asignan",
  documento_autorizar: "autorizar los que se le asignan",
  documento_publicar: "publicar revisiones autorizadas",
  documento_obsoletar: "declarar documentos obsoletos",
  documento_consultar_historico: "consultar el histórico",
  documento_acusar_lectura: "confirmar la lectura",
  documento_administrar_lecturas: "administrar lecturas",
  documento_externo_gestionar: "gestionar documentos externos",
  lista_maestra_exportar: "exportar la Lista Maestra",
};

/* Alcances en palabras: la opcion del editor y el complemento de la frase. */
export const ALCANCES_LEGIBLES: Record<string, { opcion: string; frase: string }> = {
  total: { opcion: "Todo", frase: "" },
  propio: { opcion: "Solo su propia cuenta", frase: "solo su propia cuenta" },
  estado: { opcion: "Solo el estado", frase: "solo el estado (sin datos técnicos)" },
  recepcion: { opcion: "Solo recepciones", frase: "solo recepciones" },
  preparacion: { opcion: "Solo procesamientos", frase: "solo procesamientos" },
  borrador: { opcion: "Solo en borrador", frase: "solo en borrador" },
  bitacora: { opcion: "Solo el registro de actividad", frase: "solo el registro de actividad" },
  uso: { opcion: "Solo el uso al capturar", frase: "solo el uso de equipos al capturar" },
  mantenimiento: { opcion: "Solo mantenimientos", frase: "solo mantenimientos" },
  movimientos: { opcion: "Solo movimientos", frase: "solo movimientos de inventario" },
  asignado: { opcion: "Solo lo asignado", frase: "solo las asignadas" },
  supervisado: { opcion: "Con visto bueno del supervisor", frase: "con visto bueno de su supervisor" },
  proyecto: { opcion: "Solo su proyecto", frase: "solo su proyecto" },
  tecnico: { opcion: "Lo técnico", frase: "en lo técnico" },
  investigacion: { opcion: "Investigación", frase: "en investigación" },
  autorizados: { opcion: "Solo lo permitido a su rol", frase: "solo los documentos permitidos para su rol" },
  administrativo: { opcion: "Solo lo administrativo", frase: "solo lo administrativo" },
  limitado: { opcion: "Vista limitada", frase: "de forma limitada" },
  incidencias: { opcion: "Solo sus incidencias", frase: "solo sus incidencias y las acciones a su cargo" },
  auditoria: { opcion: "Solo auditorías internas", frase: "solo auditorías internas" },
};

const unir = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

/* ---------- "Qué puede hacer en la plataforma": frases por area ---------- */

/* Lo que se maneja en cada area (objeto de las frases). */
const OBJETO_AREA: Record<string, string> = {
  muestras: "recepciones y muestras",
  ensayos: "procesamientos, extracciones y análisis",
  informes: "informes de resultados",
  equipos: "equipos y mantenimientos",
  inventario: "reactivos y consumibles",
  calidad: "incidencias, no conformidades y el registro de actividad",
  documentos: "Documentos SGC (control documental)",
  usuarios: "cuentas, roles y autorizaciones",
  respaldos: "los respaldos y las pruebas de restauración",
  compras: "compras",
};

/* Complemento "hasta donde" para las frases largas. */
const LIMITE_FRASE: Record<string, string> = {
  propio: "solo su propia cuenta",
  estado: "solo el estado, sin datos técnicos",
  recepcion: "solo en la recepción",
  preparacion: "solo en el procesamiento",
  borrador: "solo mientras están en borrador",
  bitacora: "solo el registro de actividad",
  uso: "solo para anotar su uso al capturar",
  mantenimiento: "solo los mantenimientos",
  movimientos: "solo los movimientos de inventario",
  asignado: "solo las que se le asignan",
  supervisado: "con visto bueno de su supervisor",
  proyecto: "solo las de su proyecto",
  autorizados: "solo los que su rol tiene permitidos",
  administrativo: "solo lo administrativo",
  limitado: "de forma limitada",
  incidencias: "solo sus incidencias y las acciones a su cargo",
  auditoria: "solo las auditorías internas",
};

/* Por area: frases como "Puede ver y registrar recepciones y muestras". Las areas sin permisos no aparecen. */
export function frasesPorArea(filas: unknown): Array<{ clave: string; area: string; frases: string[] }> {
  const porArea = new Map<string, Map<string, AccionClasica[]>>();
  const documentales: AccionDocumental[] = [];
  for (const fila of Array.isArray(filas) ? (filas as PermisoFila[]) : []) {
    if (fila && fila.modulo === "documentos" && isAccionDocumental(fila.accion)) documentales.push(fila.accion);
    if (!fila || !isModulo(fila.modulo) || !isAccionClasica(fila.accion) || fila.modulo === "documentos") continue;
    const grupos = porArea.get(fila.modulo) || new Map<string, AccionClasica[]>();
    const alcance = String(fila.alcance || "total");
    grupos.set(alcance, [...(grupos.get(alcance) || []), fila.accion]);
    porArea.set(fila.modulo, grupos);
  }
  const out: Array<{ clave: string; area: string; frases: string[] }> = [];
  for (const area of AREAS_PERMISOS) {
    const grupos = porArea.get(area.clave);
    if (!grupos) continue;
    const objeto = OBJETO_AREA[area.clave] || area.nombre.toLowerCase();
    if (grupos.get("total")?.includes("G")) {
      out.push({ clave: area.clave, area: area.nombre, frases: [`Administra todo lo de ${area.nombre.toLowerCase()}: ${objeto}`] });
      continue;
    }
    const frases = [...grupos.entries()]
      .sort(([a], [b]) => (a === "total" ? -1 : b === "total" ? 1 : 0))
      .map(([alcance, acciones]) => {
        const verbos = [...new Set(acciones)].sort((x, y) => ACCION_KEYS.indexOf(x) - ACCION_KEYS.indexOf(y)).map((a) => (a === "G" ? "administrar" : ACCIONES_LEGIBLES[a].verbo));
        const limite = alcance === "total" || alcance === "tecnico" || alcance === "investigacion" ? "" : LIMITE_FRASE[alcance] || ALCANCES_LEGIBLES[alcance]?.frase || "";
        return `Puede ${unir(verbos)} ${objeto}${limite ? `, ${limite}` : ""}`;
      });
    out.push({ clave: area.clave, area: area.nombre, frases });
  }
  if (documentales.length) {
    const verbos = ACCION_DOCUMENTAL_KEYS.filter((a) => documentales.includes(a)).map((a) => VERBOS_DOCUMENTALES[a]);
    out.push({ clave: "documentos", area: "Documentos SGC", frases: [`Puede ${unir(verbos)}`] });
  }
  return out;
}

/* Responsabilidades de un rol personalizado, a partir de sus permisos (maximo 6). */
export function responsabilidadesDePermisos(filas: unknown): string[] {
  return frasesPorArea(filas)
    .flatMap((a) => a.frases)
    .slice(0, 6);
}

/* ---------- "Reglas importantes" que aplican a un rol ---------- */

const INCOMPATIBLES_AUDITOR = ["mejora_continua", "coord_area_tecnica", "tecnico_analista", "tecnico_auxiliar", "estudiante"];

export function reglasDeRol(clave: string | null, filas: unknown): string[] {
  const lista = Array.isArray(filas) ? (filas as PermisoFila[]) : [];
  const tiene = (modulo: string, acciones: string[]) => lista.some((f) => f.modulo === modulo && (acciones.includes(f.accion) || f.accion === "G"));
  const conAlcance = (alcance: string) => lista.some((f) => f.alcance === alcance);
  const reglas: string[] = [];
  if (tiene("ensayos", ["C", "E"])) reglas.push("Necesita autorización FX-THF-AP vigente para cada actividad, método y equipo que use");
  if (tiene("ensayos", ["R", "A"]) || tiene("informes", ["R", "A"])) reglas.push("No puede revisar ni aprobar lo que él mismo registró");
  if (clave === "estudiante" || conAlcance("supervisado")) {
    reglas.push("Su cuenta debe ser temporal y con supervisor");
    reglas.push("Todo lo que registra necesita el visto bueno de su supervisor");
  }
  if (tiene("usuarios", ["G"])) reglas.push("No puede combinarse con roles que registren, revisen o aprueben ensayos o informes");
  if (tiene("compras", ["G"])) reglas.push("No puede combinarse con roles que registren o editen ensayos o informes");
  if (clave === "auditor_interno") reglas.push("No puede combinarse con Mejora Continua, el Área Técnica, Técnico Analista, Técnico Auxiliar ni Estudiante");
  if (clave && INCOMPATIBLES_AUDITOR.includes(clave)) reglas.push("No puede combinarse con el rol de Auditor Interno");
  if (clave === "estudiante") reglas.push("No puede combinarse con ningún otro rol");
  return reglas;
}
