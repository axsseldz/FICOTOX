import type { ModuleAction, PermissionsMap } from "./types";
import type { Modulo } from "../shared/permisos";

/*
 * Arquitectura de navegacion: una lista corta de destinos de primer nivel;
 * los que agrupan varias pantallas (Muestras, Inventario, Calidad,
 * Administracion) se despliegan en la barra lateral y muestran sus
 * subdestinos. Cada destino declara los modulos (Fase 1) cuyo permiso V lo
 * hace visible; el Inicio lo ve toda persona activa.
 */

export type NavIcon = "house" | "testtube" | "report" | "package" | "flask" | "cube" | "wrench" | "arrows" | "filetext" | "clock" | "users" | "shield" | "seal";

export interface NavChild {
  href: string;
  label: string;
  /* Modulo que debe poder verse (V); si falta, hereda los del padre. */
  module?: Modulo;
  /* Oculta el destino si el alcance de V en su modulo es uno de estos (p. ej. "propio"). */
  hideForScopes?: string[];
  /* Fase 10: regla propia de visibilidad (sustituye a `module`), p. ej. por combinación de permisos. */
  visible?: (permissions: PermissionsMap) => boolean;
}

export interface NavItem {
  /* Destino del enlace; con hijos, el primero visible sustituye a este valor. */
  href: string;
  label: string;
  /* Modulos que lo hacen visible (con V); vacio = lo ve toda persona activa (el Inicio). */
  modules: Modulo[];
  description: string;
  icon: NavIcon;
  children?: NavChild[];
}

export const INVENTORY_TABS: NavChild[] = [
  { href: "/inventario/reactivos", label: "Reactivos", module: "inventario" },
  { href: "/inventario/consumibles", label: "Consumibles", module: "inventario" },
  { href: "/inventario/equipos", label: "Equipos", module: "equipos" },
  { href: "/inventario/mantenimiento", label: "Mantenimiento", module: "equipos" },
];

export const SAMPLE_TABS: NavChild[] = [
  { href: "/muestras/recepcion", label: "Recepción", module: "muestras" },
  { href: "/muestras/procesamiento", label: "Procesamiento", module: "ensayos" },
  { href: "/muestras/extraccion", label: "Extracción", module: "ensayos" },
  { href: "/muestras/analisis", label: "Análisis", module: "ensayos" },
  { href: "/informes", label: "Informes", module: "informes" },
];

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Inicio", modules: [], description: "Búsqueda y lo pendiente", icon: "house" },
  { href: "/muestras", label: "Muestras", modules: ["muestras", "ensayos", "informes"], description: "Recepción, procesamiento, extracción, análisis e informes", icon: "testtube", children: [...SAMPLE_TABS, { href: "/supervision", label: "Por supervisar" }, { href: "/solicitudes", label: "Por autorizar" }] },
  {
    href: "/inventario",
    label: "Inventario",
    modules: ["inventario", "equipos"],
    description: "Reactivos, consumibles, equipos, mantenimiento y movimientos",
    icon: "package",
    children: [...INVENTORY_TABS, { href: "/movimientos", label: "Movimientos", module: "inventario" }],
  },
  {
    href: "/auditoria",
    label: "Calidad",
    modules: ["documentos", "calidad", "respaldos"],
    // Documentos SGC tambien lo ve la administracion tecnica (usuarios:G) para diagnostico; ya ve Calidad por la bitacora.
    description: "Incidencias y no conformidades, Documentos SGC, bitácora de auditoría y respaldos",
    icon: "seal",
    children: [
      // Fase 11: incidencias, NC y acciones (con el alcance "incidencias", solo lo propio). El admin tecnico (V bitacora) no las ve.
      { href: "/calidad/incidencias", label: "Incidencias y NC", visible: (p) => !!p.calidad?.V && p.calidad.V !== "bitacora" },
      // Documentos SGC (reemplaza a la Biblioteca). La administracion tecnica (usuarios:G) entra solo a metadatos, para diagnostico.
      { href: "/documentos", label: "Documentos SGC", visible: (p) => !!p.documentos?.V || !!p.usuarios?.G },
      // Con el alcance "incidencias" no se ve la bitacora.
      { href: "/auditoria", label: "Auditoría", module: "calidad", hideForScopes: ["incidencias"] },
      // Copias de seguridad y pruebas de restauración (respaldos:V; solo el administrador técnico las gestiona).
      { href: "/calidad/respaldos", label: "Respaldos", module: "respaldos" },
    ],
  },
  {
    href: "/administracion/usuarios",
    label: "Administración",
    modules: ["usuarios"],
    description: "Cuentas, roles y permisos",
    icon: "users",
    children: [
      { href: "/administracion/usuarios", label: "Usuarios", module: "usuarios" },
      { href: "/administracion/roles", label: "Roles", module: "usuarios", hideForScopes: ["propio"] },
      // Fase 10: los administra usuarios:G y los consulta calidad:V (solo lectura).
    ],
  },
];

function canAny(permissions: PermissionsMap, modules: Modulo[], action: ModuleAction = "V"): boolean {
  if (!modules.length) return true;
  return modules.some((moduleKey) => !!permissions[moduleKey]?.[action]);
}

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/* Hijos que la persona puede ver; sin `module` heredan los modulos del padre. */
function visibleChildren(item: NavItem, permissions: PermissionsMap): NavChild[] {
  return (item.children || []).filter((child) => {
    if (child.visible) return child.visible(permissions);
    if (!child.module) return canAny(permissions, item.modules);
    const alcance = permissions[child.module]?.V;
    if (!alcance) return false;
    return !child.hideForScopes?.includes(alcance);
  });
}

/* Destinos de primer nivel visibles, con el enlace del padre apuntando a su primer hijo visible. */
export function visibleNav(permissions: PermissionsMap): Array<NavItem & { children: NavChild[] }> {
  return NAV_ITEMS.filter((item) => canAny(permissions, item.modules)).map((item) => {
    const children = visibleChildren(item, permissions);
    return { ...item, href: children[0]?.href || item.href, children };
  });
}

/* Un padre esta activo si la ruta actual cae en el o en cualquiera de sus hijos. */
export function isItemActive(pathname: string, item: NavItem): boolean {
  if (isActivePath(pathname, item.href)) return true;
  return (item.children || []).some((child) => isActivePath(pathname, child.href));
}

/* Primera ruta permitida al entrar (el Inicio, que ve toda persona activa). */
export function firstAllowedRoute(permissions: PermissionsMap): string | null {
  return visibleNav(permissions)[0]?.href || null;
}
