/*
 * Catálogo de pantallas, vistas filtradas, acciones y temas de ayuda de la
 * búsqueda universal. Cada entrada declara qué permiso la hace visible; se
 * evalúa aquí, en el servidor, con los permisos efectivos de la persona: lo que
 * no puede ver o hacer nunca sale en los resultados.
 *
 * Para agregar una pantalla, vista o acción: una línea en PANTALLAS, VISTAS o
 * ACCIONES con su `permiso` (y `kw` con las palabras con que se la nombra).
 * Los comandos (`comando`) los ejecuta la interfaz (tema, cerrar sesión…).
 */
import { HELP_TOPICS, type Comando, type GrupoClave, type TipoResultado } from "../../shared/busqueda";
import { mapaPermisos, permite, type Accion, type Alcance, type ContextoAlcance, type Modulo } from "../../shared/permisos";
import type { Autorizacion } from "../rbac";

export interface Acceso {
  can: (modulo: Modulo, accion?: Accion, ctx?: ContextoAlcance) => boolean;
  alcance: (modulo: Modulo, accion?: Accion) => Alcance | null;
}

export function accesoDe(auth: Autorizacion): Acceso {
  const mapa = mapaPermisos(auth.efectivos);
  return {
    can: (modulo, accion = "V", ctx) => permite(auth.efectivos, modulo, accion, ctx),
    alcance: (modulo, accion = "V") => mapa[modulo]?.[accion] ?? null,
  };
}

export interface EntradaCatalogo {
  clave: string;
  tipo: TipoResultado;
  grupo: GrupoClave;
  titulo: string;
  sub?: string;
  href: string;
  comando?: Comando;
  /* Palabras con que se la nombra (se normalizan al indexar). */
  kw: string;
  permitido: boolean;
}

type Def = Omit<EntradaCatalogo, "permitido" | "clave" | "tipo" | "grupo"> & { permiso: (a: Acceso) => boolean };

const ctx = (objeto: string, extra: ContextoAlcance = {}): ContextoAlcance => ({ objeto, ...extra });

const PANTALLAS: Def[] = [
  { titulo: "Inicio", href: "/", permiso: () => true, kw: "inicio home principal" },
  { titulo: "Todas las muestras", href: "/muestras", permiso: (a) => a.can("muestras") || a.can("ensayos"), kw: "muestras flujo" },
  { titulo: "Recepción de muestras", href: "/muestras/recepcion", permiso: (a) => a.can("muestras"), kw: "muestras recepciones" },
  { titulo: "Procesamiento", href: "/muestras/procesamiento", permiso: (a) => a.can("ensayos"), kw: "muestras procesamientos molienda" },
  { titulo: "Extracción", href: "/muestras/extraccion", permiso: (a) => a.can("ensayos"), kw: "muestras extracciones asp dsp" },
  { titulo: "Análisis", href: "/muestras/analisis", permiso: (a) => a.can("ensayos"), kw: "muestras analisis resultados" },
  { titulo: "Por supervisar", sub: "Registros que esperan tu visto bueno", href: "/supervision", permiso: (a) => a.can("muestras") || a.can("ensayos") || a.can("informes") || a.can("inventario") || a.can("equipos"), kw: "supervision supervisar visto bueno regresados" },
  { titulo: "Informes de resultados", href: "/informes", permiso: (a) => a.can("informes"), kw: "informes resultados" },
  { titulo: "Reactivos", href: "/inventario/reactivos", permiso: (a) => a.can("inventario"), kw: "inventario reactivos" },
  { titulo: "Consumibles", href: "/inventario/consumibles", permiso: (a) => a.can("inventario"), kw: "inventario consumibles" },
  { titulo: "Equipos", href: "/inventario/equipos", permiso: (a) => a.can("equipos"), kw: "inventario equipos" },
  { titulo: "Mantenimiento", href: "/inventario/mantenimiento", permiso: (a) => a.can("equipos"), kw: "inventario mantenimientos calibracion" },
  { titulo: "Movimientos de inventario", href: "/movimientos", permiso: (a) => a.can("inventario"), kw: "movimientos entradas salidas" },
  { titulo: "Documentos SGC", sub: "Carpetas por gestión", href: "/documentos", permiso: (a) => a.can("documentos") || a.can("usuarios", "G"), kw: "documentos sgc manual procedimientos instructivos formatos listas bitacoras calidad gestion carpetas" },
  { titulo: "Explorador documental", sub: "Buscar y filtrar documentos SGC", href: "/documentos/explorar", permiso: (a) => a.can("documentos") || a.can("usuarios", "G"), kw: "documentos sgc explorador clave fx buscar filtrar" },
  { titulo: "Incidencias y no conformidades", href: "/calidad/incidencias", permiso: (a) => a.can("calidad", "V", ctx("incidencia")) && a.alcance("calidad") !== "bitacora", kw: "calidad incidencias no conformidades nc acciones correctivas" },
  { titulo: "Respaldos", sub: "Copias de seguridad y pruebas de restauración", href: "/calidad/respaldos", permiso: (a) => a.can("respaldos"), kw: "respaldos copias seguridad backup restauracion recuperar" },
  { titulo: "Auditoría", sub: "Bitácora de actividad", href: "/auditoria", permiso: (a) => a.can("calidad", "V", ctx("bitacora")), kw: "auditoria bitacora historial actividad trazabilidad" },
  { titulo: "Usuarios", href: "/administracion/usuarios", permiso: (a) => a.can("usuarios"), kw: "administracion usuarios cuentas personas" },
  { titulo: "Roles y permisos", href: "/administracion/roles", permiso: (a) => a.can("usuarios") && a.alcance("usuarios") !== "propio", kw: "administracion roles permisos" },
  { titulo: "Por autorizar", sub: "Solicitudes que esperan tu aprobación", href: "/solicitudes", permiso: () => true, kw: "solicitudes autorizar aprobar pendientes" },
  { titulo: "Mi cuenta", sub: "Tus datos, foto, contraseña y apariencia", href: "", comando: "cuenta", permiso: () => true, kw: "cuenta perfil foto avatar mis autorizaciones apariencia" },
  { titulo: "Ayuda", sub: "Manual de la plataforma", href: "/ayuda", permiso: () => true, kw: "ayuda manual guia tutorial" },
];

/* Vistas filtradas: lo que normalmente se busca "por estado" (lo mismo que abren los avisos del Inicio). */
const VISTAS: Def[] = [
  { titulo: "Muestras en curso", sub: "Recepciones que no han terminado su flujo", href: "/muestras", permiso: (a) => a.can("muestras"), kw: "pendientes en proceso flujo" },
  { titulo: "Mis muestras", sub: "Las asignadas a ti", href: "/muestras/recepcion?mias=1", permiso: (a) => a.can("muestras"), kw: "asignadas a mi mias" },
  { titulo: "Análisis por revisar o aprobar", sub: "Registrados o revisados, sin aprobar", href: "/muestras/analisis?filtro=pendiente", permiso: (a) => a.can("ensayos"), kw: "analisis pendientes revisar aprobar firma" },
  { titulo: "Informes por revisar o autorizar", sub: "Borradores y en revisión", href: "/informes?filtro=pendiente", permiso: (a) => a.can("informes"), kw: "informes revision revisar autorizar pendientes" },
  { titulo: "Informes autorizados sin entregar", sub: "Falta registrar la entrega al cliente", href: "/informes?filtro=autorizado", permiso: (a) => a.can("informes"), kw: "informes autorizados entregar entrega liberar" },
  { titulo: "Informes enviados", sub: "Enviados por correo al cliente", href: "/informes?filtro=enviado", permiso: (a) => a.can("informes"), kw: "informes enviados entregados correo historial" },
  { titulo: "Reactivos con stock bajo", sub: "Por debajo del mínimo o agotados", href: "/inventario/reactivos?filtro=bajo", permiso: (a) => a.can("inventario"), kw: "reactivos stock bajo agotado minimo" },
  { titulo: "Reactivos por vencer", sub: "Caducan pronto o ya caducaron", href: "/inventario/reactivos?filtro=vencer", permiso: (a) => a.can("inventario"), kw: "reactivos caducidad vencer vencidos" },
  { titulo: "Consumibles con stock bajo", sub: "Poca existencia en unidades", href: "/inventario/consumibles?filtro=bajo", permiso: (a) => a.can("inventario"), kw: "consumibles stock bajo agotado" },
  { titulo: "Equipos con alerta de calibración", sub: "Calibración vencida, pendiente o fuera de servicio", href: "/inventario/equipos?filtro=calibracion", permiso: (a) => a.can("equipos"), kw: "equipos calibracion vencida pendiente fuera de servicio" },
  { titulo: "Equipos en mantenimiento", sub: "Con un mantenimiento pendiente", href: "/inventario/equipos?filtro=mantenimiento", permiso: (a) => a.can("equipos"), kw: "equipos mantenimiento" },
  { titulo: "Mantenimientos vencidos", sub: "Programados y no realizados a tiempo", href: "/inventario/mantenimiento?filtro=vencido", permiso: (a) => a.can("equipos"), kw: "mantenimientos vencidos atrasados" },
  { titulo: "Mantenimientos próximos", sub: "En los próximos 30 días", href: "/inventario/mantenimiento?filtro=proximo", permiso: (a) => a.can("equipos"), kw: "mantenimientos proximos calendario 30 dias" },
  { titulo: "Mantenimientos completados", sub: "Historial por equipo", href: "/inventario/mantenimiento?filtro=completado", permiso: (a) => a.can("equipos"), kw: "mantenimientos completados historial" },
  { titulo: "Incidencias por evaluar", sub: "Reportadas o en evaluación", href: "/calidad/incidencias?estado_inc=reportada,en_evaluacion", permiso: (a) => a.can("calidad", "R", ctx("incidencia")), kw: "incidencias evaluar calidad pendientes" },
  { titulo: "No conformidades abiertas", sub: "Sin cerrar, por etapa", href: "/calidad/incidencias?tipos=nc&etapa_nc=abierta,en_analisis,acciones_en_curso,en_verificacion", permiso: (a) => a.can("calidad", "V", ctx("nc")) && a.alcance("calidad") !== "bitacora", kw: "nc no conformidades abiertas acciones correctivas" },
  { titulo: "Mis acciones correctivas", sub: "Pendientes o en proceso a tu nombre", href: "/calidad/incidencias?mias=responsable", permiso: (a) => a.can("calidad", "V", ctx("accion_correctiva")) && a.alcance("calidad") !== "bitacora", kw: "acciones correctivas mias pendientes vencidas" },
];

const ACCIONES: Def[] = [
  { titulo: "Nueva recepción", sub: "Registrar la llegada de una muestra o lote", href: "/muestras/recepcion/nueva", permiso: (a) => a.can("muestras", "C", ctx("recepcion", { borrador: true })), kw: "registrar recibir muestra lote solicitante" },
  { titulo: "Nuevo procesamiento", sub: "Lavado, desconche y molienda", href: "/muestras/procesamiento/nuevo", permiso: (a) => a.can("ensayos", "C", ctx("procesamiento", { borrador: true })), kw: "registrar procesar molienda" },
  { titulo: "Nueva extracción", sub: "Elige el formato (ASP, DSP…) al abrir", href: "/muestras/extraccion/nueva", permiso: (a) => a.can("ensayos", "C", ctx("extraccion", { borrador: true })), kw: "registrar extraer extracto" },
  { titulo: "Nueva extracción ASP", sub: "Ácido domoico · metanol:agua 50:50", href: "/muestras/extraccion/nueva?tipo=E-A", permiso: (a) => a.can("ensayos", "C", ctx("extraccion", { borrador: true })), kw: "registrar acido domoico asp e-a" },
  { titulo: "Nueva extracción DSP", sub: "Toxinas lipofílicas · metanol 100 % e hidrólisis", href: "/muestras/extraccion/nueva?tipo=E-D", permiso: (a) => a.can("ensayos", "C", ctx("extraccion", { borrador: true })), kw: "registrar toxinas lipofilicas dsp e-d okadaico" },
  { titulo: "Nuevo análisis", sub: "Resultados, controles y firma", href: "/muestras/analisis/nuevo", permiso: (a) => a.can("ensayos", "C", ctx("analisis", { borrador: true })), kw: "registrar resultados cromatografia" },
  { titulo: "Nuevo informe", sub: "Informe de resultados para el cliente", href: "/informes/nuevo", permiso: (a) => a.can("informes", "C"), kw: "registrar resultados cliente pdf" },
  { titulo: "Nuevo reactivo", sub: "Alta en el inventario", href: "/inventario/reactivos?nuevo=1", permiso: (a) => a.can("inventario", "C", ctx("catalogo_inventario")), kw: "registrar inventario alta" },
  { titulo: "Nuevo consumible", sub: "Alta en el inventario", href: "/inventario/consumibles?nuevo=1", permiso: (a) => a.can("inventario", "C", ctx("catalogo_inventario")), kw: "registrar inventario alta" },
  { titulo: "Nuevo equipo", sub: "Alta con clave de bitácora", href: "/inventario/equipos?nuevo=1", permiso: (a) => a.can("equipos", "C", ctx("equipo")), kw: "registrar inventario alta bitacora" },
  { titulo: "Programar mantenimiento", sub: "Preventivo, correctivo, calibración o verificación", href: "/inventario/mantenimiento?nuevo=1", permiso: (a) => a.can("equipos", "C", ctx("mantenimiento")), kw: "mantenimiento calibracion verificacion" },
  { titulo: "Nueva ficha de documento", sub: "Documentos SGC · clave FX y archivo inicial", href: "/documentos/explorar?nueva=1", permiso: (a) => a.can("documentos", "documento_crear_ficha"), kw: "documento sgc ficha alta registrar clave fx" },
  { titulo: "Reportar incidencia", sub: "Falla, desviación o queja; con foto", href: "", comando: "reportar_incidencia", permiso: (a) => a.can("calidad", "C", ctx("incidencia")), kw: "incidencia problema falla desviacion queja reportar calidad" },
  { titulo: "Nuevo usuario", sub: "Crear una cuenta", href: "/administracion/usuarios?nuevo=1", permiso: (a) => a.can("usuarios", "G"), kw: "registrar persona cuenta alta administracion" },
  { titulo: "Cambiar contraseña", sub: "En Mi cuenta", href: "", comando: "cambiar_password", permiso: () => true, kw: "password clave seguridad cuenta" },
  { titulo: "Modo oscuro", sub: "Cambiar la apariencia", href: "", comando: "tema_oscuro", permiso: () => true, kw: "tema apariencia noche negro" },
  { titulo: "Modo claro", sub: "Cambiar la apariencia", href: "", comando: "tema_claro", permiso: () => true, kw: "tema apariencia dia blanco" },
  { titulo: "Tema automático", sub: "Sigue el modo de tu sistema", href: "", comando: "tema_auto", permiso: () => true, kw: "tema apariencia automatico sistema" },
  { titulo: "Cerrar sesión", sub: "Salir de FICOTOX", href: "", comando: "cerrar_sesion", permiso: () => true, kw: "salir logout terminar sesion" },
];

const AYUDA: Def[] = HELP_TOPICS.map((t) => ({ titulo: t.label, sub: t.sub, href: `/ayuda#${t.anchor}`, permiso: () => true, kw: `${t.kw} ayuda manual como se hace guia` }));

export function catalogoVisible(auth: Autorizacion): EntradaCatalogo[] {
  const a = accesoDe(auth);
  const armar = (defs: Def[], tipo: TipoResultado, grupo: GrupoClave, prefijo: string): EntradaCatalogo[] =>
    defs.filter((d) => d.permiso(a)).map((d) => ({ clave: `${prefijo}:${d.comando || d.href}`, tipo, grupo, titulo: d.titulo, sub: d.sub, href: d.href, comando: d.comando, kw: d.kw, permitido: true }));
  return [...armar(ACCIONES, "accion", "acciones", "accion"), ...armar(PANTALLAS, "pantalla", "pantallas", "pantalla"), ...armar(VISTAS, "pantalla", "pantallas", "vista"), ...armar(AYUDA, "ayuda", "pantallas", "ayuda")];
}
