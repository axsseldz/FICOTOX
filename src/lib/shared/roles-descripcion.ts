/*
 * Descripcion de los 10 roles del laboratorio en lenguaje simple (basada en la
 * seccion 4 de la especificacion de roles, FX-MO-2-1): icono, proposito,
 * responsabilidades principales y lo que no puede hacer. Se usa en
 * Administracion › Roles (lista y ventana) y en la ventana de cada persona.
 * Los roles personalizados (fuera de estos 10) reciben un proposito generico;
 * sus responsabilidades se generan de sus permisos en la interfaz.
 * Solo presentacion: los permisos reales viven en la matriz de cada rol.
 */

/* Iconos disponibles (la interfaz los traduce a su dibujo). */
export type IconoRol = "engrane" | "corona" | "medalla" | "matraz" | "libro" | "tubo" | "caja" | "carrito" | "lupa" | "birrete" | "escudo";

export interface DescripcionRol {
  icono: IconoRol;
  proposito: string;
  responsabilidades: string[];
  noPuede: string[];
}

const DESCRIPCION_ROLES: Record<string, DescripcionRol> = {
  admin_tecnico: {
    icono: "engrane",
    proposito: "Mantiene la plataforma funcionando, segura y respaldada.",
    responsabilidades: ["Crea y da de baja las cuentas de acceso", "Asigna los roles autorizados", "Configura la plataforma", "Crea los respaldos y prueba la restauración (Calidad › Respaldos)"],
    noPuede: ["Aprobar documentos", "Modificar resultados ni validar ensayos", "Liberar informes", "Alterar el registro de actividad"],
  },
  responsable_general: {
    icono: "corona",
    proposito: "Dirige el laboratorio y responde por su funcionamiento y por los informes que emite.",
    responsabilidades: ["Consulta toda la información del laboratorio", "Aprueba accesos y cambios importantes", "Autoriza y libera informes", "Aprueba anulaciones excepcionales", "Revisa el desempeño del laboratorio", "Consulta los respaldos y sus pruebas de restauración"],
    noPuede: ["Sustituir la revisión técnica", "Modificar registros técnicos ya cerrados"],
  },
  mejora_continua: {
    icono: "medalla",
    proposito: "Cuida y mejora el sistema de calidad del laboratorio.",
    responsabilidades: ["Administra el control de documentos (Documentos SGC): solicitudes, publicación, distribución y Lista Maestra", "Atiende incidencias y no conformidades con sus acciones correctivas", "Organiza las auditorías", "Da seguimiento a la calidad", "Consulta los respaldos y sus pruebas de restauración"],
    noPuede: ["Modificar resultados técnicos", "Validar resultados técnicos"],
  },
  coord_area_tecnica: {
    icono: "matraz",
    proposito: "Supervisa el trabajo analítico y asegura que los resultados sean válidos.",
    responsabilidades: ["Asigna las muestras", "Supervisa recepción, procesamiento, extracción y análisis", "Revisa y aprueba resultados", "Autoriza decisiones especiales de recepción", "Administra equipos e inventario", "Registra las autorizaciones del personal"],
    noPuede: ["Aprobar su propio trabajo"],
  },
  coord_investigacion: {
    icono: "libro",
    proposito: "Lleva los proyectos de investigación y las actividades académicas.",
    responsabilidades: ["Coordina proyectos y protocolos", "Acompaña a los estudiantes", "Maneja datos experimentales y el uso de equipos para investigación"],
    noPuede: ["Liberar informes de servicio", "Modificar resultados regulados sin autorización adicional"],
  },
  tecnico_analista: {
    icono: "tubo",
    proposito: "Realiza los ensayos y registra información técnica confiable.",
    responsabilidades: ["Procesa, extrae y analiza las muestras que se le asignan", "Registra los equipos e insumos que usa", "Adjunta la evidencia de cada análisis", "Prepara borradores de informe", "Reporta las desviaciones"],
    noPuede: ["Usar métodos o equipos para los que no está autorizado", "Revisar, aprobar ni liberar su propio trabajo"],
  },
  tecnico_auxiliar: {
    icono: "caja",
    proposito: "Apoya la recepción, la preparación y la conservación de las muestras.",
    responsabilidades: ["Recibe e inspecciona las muestras", "Etiqueta y resguarda las muestras", "Registra movimientos de inventario", "Da apoyo técnico"],
    noPuede: ["Capturar resultados finales", "Validar resultados", "Emitir informes"],
  },
  admin_auxiliar: {
    icono: "carrito",
    proposito: "Gestiona los recursos y el apoyo administrativo.",
    responsabilidades: ["Atiende proveedores y compras", "Lleva el inventario administrativo", "Organiza mantenimientos y servicios externos"],
    noPuede: ["Modificar datos técnicos", "Modificar resultados ni informes"],
  },
  auditor_interno: {
    icono: "lupa",
    proposito: "Verifica de forma objetiva que se cumpla el sistema de calidad.",
    responsabilidades: ["Consulta documentos, registros y la actividad de la plataforma", "Consulta los respaldos y sus pruebas de restauración", "Prepara y lleva a cabo las auditorías internas"],
    noPuede: ["Modificar la información que audita", "Aprobar la información que audita"],
  },
  estudiante: {
    icono: "birrete",
    proposito: "Participa temporalmente en las actividades que se le asignan, siempre bajo supervisión.",
    responsabilidades: ["Captura registros en las muestras o tareas que se le asignan", "Consulta los documentos que se le comparten"],
    noPuede: ["Aprobar, validar ni liberar", "Administrar usuarios", "Cerrar actividades sin supervisión", "Trabajar sin visto bueno: su cuenta es temporal y todo lo que captura lo revisa su supervisor"],
  },
};

/* Rol personalizado (no es uno de los 10 del catalogo). */
const DESCRIPCION_GENERICA: DescripcionRol = {
  icono: "escudo",
  proposito: "Rol personalizado del laboratorio: lo que puede hacer depende de los permisos que se le dieron.",
  responsabilidades: [],
  noPuede: [],
};

/* Los 10 roles se reconocen por su clave estable y, si no la tienen, por su nombre. */
const POR_NOMBRE: Record<string, string> = {
  "Administrador técnico del sistema": "admin_tecnico",
  "Responsable General": "responsable_general",
  "Coordinador/a de Mejora Continua": "mejora_continua",
  "Coordinador/a del Área Técnica": "coord_area_tecnica",
  "Coordinador/a de Investigación y Desarrollo": "coord_investigacion",
  "Técnico Analista": "tecnico_analista",
  "Técnico Auxiliar": "tecnico_auxiliar",
  "Administrador/a Auxiliar": "admin_auxiliar",
  "Auditor Interno": "auditor_interno",
  "Estudiante / personal en formación": "estudiante",
};

export function claveDeRol(rol: { clave?: unknown; nombre?: unknown; rol_clave?: unknown; rol?: unknown }): string | null {
  const clave = String(rol.clave || rol.rol_clave || "");
  if (clave && DESCRIPCION_ROLES[clave]) return clave;
  return POR_NOMBRE[String(rol.nombre || rol.rol || "")] || null;
}

export function descripcionDeRol(rol: { clave?: unknown; nombre?: unknown; rol_clave?: unknown; rol?: unknown }): DescripcionRol & { delCatalogo: boolean } {
  const clave = claveDeRol(rol);
  return clave ? { ...DESCRIPCION_ROLES[clave], delCatalogo: true } : { ...DESCRIPCION_GENERICA, delCatalogo: false };
}
