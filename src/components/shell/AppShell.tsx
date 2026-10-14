"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useAlternarTema } from "@/components/ui/SelectorTema";
import { Dialog as RadixDialog } from "radix-ui";
import { ArrowsLeftRight, CaretRight, ClockCounterClockwise, Cube, FileText, Flask, House, List, MagnifyingGlass, Package, Question, SealCheck, ShieldCheck, SidebarSimple, SignOut, TestTube, UserCircle, Users, WarningDiamond, Wrench, X } from "@phosphor-icons/react";
import { reportarIncidencia, ReportarIncidenciaHost, usePuedeReportar } from "@/components/features/calidad/ReportarIncidencia";
import { useSession } from "@/components/session/SessionProvider";
import { cn } from "@/components/ui/cn";
import { Dropdown, Tooltip } from "@/components/ui/Overlay";
import { Avatar } from "@/components/ui/Primitives";
import { isActivePath, isItemActive, visibleNav, type NavChild, type NavIcon, type NavItem } from "@/lib/client/nav";
import { BrandLockup, BrandMark } from "./Brand";
import { ABRIR_MIS_AUTORIZACIONES, AccountSheet, EVENTO_ABRIR_CUENTA } from "./AccountSheet";
import { usePendientesPorResolver } from "@/components/features/solicitudes/Solicitudes";
import { useBandejaSgc } from "@/components/features/documentos/bandeja";
import { Campana } from "./Campana";
import { CommandPalette } from "./CommandPalette";
import { VisorPdfFlotante } from "./VisorPdfFlotante";

/*
 * Shell de la aplicacion: barra lateral con seis destinos; los que agrupan
 * pantallas (Muestras, Inventario, Calidad, Administracion) se despliegan
 * con una animacion de altura y muestran sus subdestinos. Un solo buscador
 * global (Inicio y ⌘K); en la barra solo queda un icono.
 * En movil la barra se abre como panel; en escritorio puede colapsarse a
 * solo iconos (se recuerda en localStorage).
 */

const ICONS: Record<NavIcon, ReactNode> = {
  house: <House size={18} />,
  testtube: <TestTube size={18} />,
  report: <FileText size={18} />,
  package: <Package size={18} />,
  flask: <Flask size={18} />,
  cube: <Cube size={18} />,
  wrench: <Wrench size={18} />,
  arrows: <ArrowsLeftRight size={18} />,
  filetext: <FileText size={18} />,
  clock: <ClockCounterClockwise size={18} />,
  users: <Users size={18} />,
  shield: <ShieldCheck size={18} />,
  seal: <SealCheck size={18} />,
};

const COLLAPSE_KEY = "ficotox.sidebar.collapsed";
const COLLAPSE_EVENT = "ficotox:sidebar";
const EXPANDED_KEY = "ficotox.sidebar.expanded";

/* Estado colapsado de la barra lateral, persistido en localStorage y leido como fuente externa (sin desajuste de hidratacion). */
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}
function subscribeCollapsed(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  window.addEventListener(COLLAPSE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(COLLAPSE_EVENT, listener);
  };
}
function writeCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, value ? "1" : "0");
  } catch {
    /* sin almacenamiento */
  }
  window.dispatchEvent(new Event(COLLAPSE_EVENT));
}

/* Secciones que la persona dejo abiertas a mano (ademas de la activa, que siempre se abre). */
function readExpanded(): string[] {
  try {
    const raw = window.localStorage.getItem(EXPANDED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
function writeExpanded(value: string[]): void {
  try {
    window.localStorage.setItem(EXPANDED_KEY, JSON.stringify(value));
  } catch {
    /* sin almacenamiento */
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, permissions, logout } = useSession();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [cuentaClave, setCuentaClave] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

  const toggleCollapsed = () => writeCollapsed(!collapsed);

  // Al cambiar de pantalla se cierra el panel movil (ajuste de estado durante el render, sin efecto en cascada).
  const [rutaAnterior, setRutaAnterior] = useState(pathname);
  if (rutaAnterior !== pathname) {
    setRutaAnterior(pathname);
    setMobileOpen(false);
  }

  // Si la ventana crece a escritorio con el panel abierto, se cierra (si no, quedaría bloqueando el scroll sin verse).
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      if (media.matches) setMobileOpen(false);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  // Fase 5: "Mi cuenta" se abre con el evento EVENTO_ABRIR_CUENTA o al llegar con #mis-autorizaciones.
  useEffect(() => {
    const abrir = (event?: Event) => {
      // La búsqueda ("cambiar contraseña") pide abrir la cuenta con el formulario de contraseña ya desplegado.
      setCuentaClave(!!(event as CustomEvent<{ password?: boolean }> | undefined)?.detail?.password);
      setAccountOpen(true);
    };
    if (window.location.hash === ABRIR_MIS_AUTORIZACIONES) abrir();
    window.addEventListener(EVENTO_ABRIR_CUENTA, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR_CUENTA, abrir);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const items = visibleNav(permissions);
  const puedeReportar = usePuedeReportar();

  const sidebarProps = {
    items,
    pathname,
    onSearch: () => {
      setMobileOpen(false);
      setPaletteOpen(true);
    },
    onToggle: toggleCollapsed,
    onAccount: () => {
      setMobileOpen(false);
      setAccountOpen(true);
    },
    // Fase 11: "Reportar incidencia" siempre a la mano para quien tiene calidad:C.
    onReportar: puedeReportar
      ? () => {
          setMobileOpen(false);
          reportarIncidencia();
        }
      : undefined,
    isMac,
    user,
    onLogout: logout,
  };

  return (
    <div className="flex min-h-dvh">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[var(--z-toast)] focus:rounded-[8px] focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow-pop">
        Saltar al contenido
      </a>

      {/* Barra lateral de escritorio */}
      <aside className={cn("sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line/70 bg-sidebar transition-[width] duration-300 ease-[var(--ease-spring)] lg:flex", collapsed ? "w-[68px]" : "w-[240px]")} aria-label="Navegación principal">
        <SidebarContent {...sidebarProps} collapsed={collapsed} />
      </aside>

      {/* Barra lateral móvil: panel con foco atrapado, Escape y bloqueo de scroll (Radix Dialog). Siempre expandida. */}
      <RadixDialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-[var(--z-ventana)] bg-deep/35 backdrop-blur-[3px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out lg:hidden" />
          <RadixDialog.Content className="bg-sidebar fixed inset-y-0 left-0 z-[var(--z-ventana)] flex w-[280px] max-w-[85vw] flex-col shadow-panel outline-none data-[state=open]:animate-sheet-in-left data-[state=closed]:animate-sheet-out-left lg:hidden" aria-label="Navegación principal">
            <RadixDialog.Title className="sr-only">Navegación principal</RadixDialog.Title>
            <RadixDialog.Description className="sr-only">Secciones del sistema</RadixDialog.Description>
            <SidebarContent {...sidebarProps} collapsed={false} onClose={() => setMobileOpen(false)} />
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior solo en móvil */}
        <header className="material sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line/70 px-3 lg:hidden">
          <button type="button" className="press inline-flex h-9 w-9 items-center justify-center rounded-[9px] text-ink-2 hover:bg-surface-3" aria-label="Abrir menú" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}>
            <List size={20} />
          </button>
          <Link href="/" className="rounded-[8px]">
            <BrandLockup size={26} />
          </Link>
          <button type="button" onClick={() => setPaletteOpen(true)} className="press ml-auto inline-flex h-9 w-9 items-center justify-center rounded-[9px] text-ink-2 hover:bg-surface-3" aria-label="Buscar">
            <MagnifyingGlass size={20} />
          </button>
        </header>

        {/* El ancho máximo lo pone cada página (PageBody / FormPage), así las cabeceras fijas pueden ocupar todo el ancho. */}
        <main id="contenido" className="w-full flex-1 px-4 py-6 sm:px-8 sm:py-8">
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ReportarIncidenciaHost />
      <VisorPdfFlotante />
      {accountOpen ? <AccountSheet open={accountOpen} abrirClave={cuentaClave} onClose={() => setAccountOpen(false)} /> : null}
    </div>
  );
}

type VisibleItem = NavItem & { children: NavChild[] };

function SidebarContent({ items, pathname, collapsed, onSearch, onToggle, onAccount, onClose, onReportar, isMac, user, onLogout }: { items: VisibleItem[]; pathname: string; collapsed: boolean; onSearch: () => void; onToggle: () => void; onAccount: () => void; onClose?: () => void; onReportar?: () => void; isMac: boolean; user: { id?: number; nombre?: string; email?: string; roles?: string[]; avatar?: string | null } | null; onLogout: () => void }) {
  // El shell solo se monta ya autenticado (en el cliente), así que leer localStorage al iniciar no desajusta la hidratación.
  const [expanded, setExpanded] = useState<string[]>(() => (typeof window === "undefined" ? [] : readExpanded()));
  // Contadores de lo que la persona puede resolver: "Por autorizar" y "Por supervisar".
  const pendientes = usePendientesPorResolver();
  // Acceso rapido de apariencia en el menu de la cuenta (Claro <-> Oscuro).
  const tema = useAlternarTema();
  // Documentos SGC: tareas de su bandeja (solo si tiene acciones documentales).
  const { can } = useSession();
  const bandejaSgc = useBandejaSgc(can("documentos"));
  const contador: Record<string, number> = { "/solicitudes": pendientes.solicitudes.length, "/supervision": pendientes.supervision.length, "/documentos": bandejaSgc.data?.total || 0 };

  const toggleExpanded = (label: string, active: boolean) => {
    setExpanded((current) => {
      // La sección activa siempre está abierta: "cerrarla" se recuerda como preferencia y se aplica al salir de ella.
      const isOpen = active ? !current.includes(`!${label}`) : current.includes(label);
      const next = current.filter((entry) => entry !== label && entry !== `!${label}`);
      if (active) {
        if (isOpen) next.push(`!${label}`);
      } else if (!isOpen) next.push(label);
      writeExpanded(next);
      return next;
    });
  };

  const isOpen = (item: VisibleItem, active: boolean) => (active ? !expanded.includes(`!${item.label}`) : expanded.includes(item.label));

  return (
    <>
      <div className={cn("flex h-14 items-center", collapsed ? "justify-center px-2" : "justify-between pr-2 pl-4")}>
        <Link href="/" className="rounded-[8px]" aria-label="Inicio">
          {collapsed ? <BrandMark size={28} /> : <BrandLockup size={28} />}
        </Link>
        {!collapsed ? (
          <div className="flex items-center gap-0.5">
            <Campana />
            <Tooltip content={`Buscar (${isMac ? "⌘" : "Ctrl"} K)`} side="bottom">
              <button type="button" onClick={onSearch} className="press inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label="Buscar">
                <MagnifyingGlass size={17} />
              </button>
            </Tooltip>
            {onClose ? (
              <button type="button" onClick={onClose} className="press inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label="Cerrar menú">
                <X size={18} />
              </button>
            ) : (
              <button type="button" onClick={onToggle} className="press hidden h-8 w-8 items-center justify-center rounded-[8px] text-ink-3 hover:bg-surface-3 hover:text-ink lg:inline-flex" aria-label="Contraer barra lateral">
                <SidebarSimple size={18} />
              </button>
            )}
          </div>
        ) : null}
      </div>

      {collapsed ? (
        <div className="flex flex-col gap-0.5 px-2">
          <Campana compacta />
          <Tooltip content={`Buscar (${isMac ? "⌘" : "Ctrl"} K)`} side="right">
            <button type="button" onClick={onSearch} className="press flex h-9 w-full items-center justify-center rounded-[9px] text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label="Buscar">
              <MagnifyingGlass size={18} />
            </button>
          </Tooltip>
        </div>
      ) : null}

      <nav className={cn("scroll-thin mt-2 flex-1 overflow-y-auto pb-4", collapsed ? "px-2" : "px-3")}>
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => {
            const active = isItemActive(pathname, item);
            const hasChildren = item.children.length > 0;
            const open = hasChildren && !collapsed && isOpen(item, active);
            // Hoja activa (o, con la barra contraída, cualquier sección activa): fondo tenue y marca de acento.
            const leafActive = active && (!hasChildren || collapsed);
            const link = (
              <Link
                href={item.href}
                aria-current={active && !hasChildren ? "page" : undefined}
                data-activo={leafActive ? "true" : undefined}
                aria-label={collapsed ? item.label : undefined}
                onClick={() => {
                  if (hasChildren && !collapsed && !open) toggleExpanded(item.label, active);
                }}
                className={cn(
                  "seleccion press group/item flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-[9px] text-[13.5px]",
                  collapsed ? "justify-center px-0" : "px-2.5",
                  leafActive ? "font-semibold text-ink" : active ? "font-semibold text-ink" : "font-medium text-ink-2 hover:text-ink",
                )}
              >
                <span className={cn("shrink-0 transition-colors", active ? "text-brand" : "text-ink-3 group-hover/item:text-ink-2")}>{ICONS[item.icon]}</span>
                {!collapsed ? <span className="truncate">{item.label}</span> : null}
              </Link>
            );
            const row =
              hasChildren && !collapsed ? (
                <div className="flex items-center gap-0.5">
                  {link}
                  <button
                    type="button"
                    aria-label={open ? `Contraer ${item.label}` : `Desplegar ${item.label}`}
                    aria-expanded={open}
                    onClick={() => toggleExpanded(item.label, active)}
                    className="press inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-ink-4 hover:bg-surface-3 hover:text-ink"
                  >
                    <CaretRight size={13} weight="bold" className={cn("transition-transform duration-300 ease-[var(--ease-spring)]", open && "rotate-90")} />
                  </button>
                </div>
              ) : (
                link
              );
            return (
              <li key={item.label}>
                {collapsed ? (
                  <Tooltip content={item.label} side="right">
                    {link}
                  </Tooltip>
                ) : (
                  row
                )}
                {hasChildren && !collapsed ? (
                  <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-[var(--ease-spring)]", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")} aria-hidden={!open}>
                    <ul className="ml-[21px] min-h-0 overflow-hidden border-l border-line pl-2.5">
                      {item.children.map((child) => {
                          const childActive = isActivePath(pathname, child.href);
                        return (
                          <li key={child.href} className="pt-0.5 last:pb-1.5">
                            <Link
                              href={child.href}
                              tabIndex={open ? 0 : -1}
                              aria-current={childActive ? "page" : undefined}
                              className={cn("seleccion press flex h-8 items-center gap-2 rounded-[7px] px-2.5 text-[13px]", childActive ? "font-semibold text-ink" : "text-ink-2 hover:text-ink")}
                            >
                              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full transition-colors", childActive ? "bg-brand" : "bg-line-strong")} aria-hidden="true" />
                              <span className="truncate">{child.label}</span>
                              {contador[child.href] ? (
                                <span className={cn("tnum ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold", "bg-warning text-on-accent")} aria-label={`${contador[child.href]} pendientes`} data-contador={child.href}>
                                  {contador[child.href]}
                                </span>
                              ) : null}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </nav>

      <div className={cn("border-t border-line/70 p-2", collapsed && "flex flex-col items-center gap-1")}>
        {onReportar ? (
          collapsed ? (
            <Tooltip content="Reportar incidencia" side="right">
              <button type="button" onClick={onReportar} className="press inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label="Reportar incidencia">
                <WarningDiamond size={18} />
              </button>
            </Tooltip>
          ) : (
            <button type="button" onClick={onReportar} className="press mb-0.5 flex h-9 w-full items-center gap-2.5 rounded-[9px] px-2.5 text-left text-[13.5px] font-medium text-ink-2 hover:bg-surface-3/80 hover:text-ink" data-reportar-incidencia-boton>
              <WarningDiamond size={18} className="text-ink-3" />
              Reportar incidencia
            </button>
          )
        ) : null}
        {/* Ayuda: siempre visible, no depende de permisos. */}
        {collapsed ? (
          <Tooltip content="Ayuda" side="right">
            <Link href="/ayuda" aria-current={isActivePath(pathname, "/ayuda") ? "page" : undefined} className={cn("seleccion press inline-flex h-8 w-8 items-center justify-center rounded-[8px]", isActivePath(pathname, "/ayuda") ? "text-brand" : "text-ink-3 hover:text-ink")} aria-label="Ayuda">
              <Question size={18} />
            </Link>
          </Tooltip>
        ) : (
          <Link href="/ayuda" aria-current={isActivePath(pathname, "/ayuda") ? "page" : undefined} className={cn("seleccion press mb-1 flex h-9 items-center gap-2.5 rounded-[9px] px-2.5 text-[13.5px]", isActivePath(pathname, "/ayuda") ? "font-semibold text-ink" : "font-medium text-ink-2 hover:text-ink")}>
            <Question size={18} className={isActivePath(pathname, "/ayuda") ? "text-brand" : "text-ink-3"} />
            Ayuda
          </Link>
        )}
        {collapsed ? (
          <button type="button" onClick={onToggle} className="press hidden h-8 w-8 items-center justify-center rounded-[8px] text-ink-3 hover:bg-surface-3 hover:text-ink lg:inline-flex" aria-label="Expandir barra lateral">
            <SidebarSimple size={18} />
          </button>
        ) : null}
        <Dropdown
          label="Menú de usuario"
          align="start"
          trigger={
            <button type="button" className={cn("press flex w-full items-center gap-2.5 rounded-[10px] py-1.5 text-left hover:bg-surface-3/80", collapsed ? "justify-center px-0" : "px-2")} aria-label="Menú de usuario">
              <Avatar id={user?.id} name={user?.nombre} email={user?.email} avatar={user?.avatar} size="md" />
              {!collapsed ? (
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13.5px] font-medium text-ink">{user?.nombre || user?.email}</span>
                  <span className="truncate text-[12px] text-ink-3">{user?.roles?.join(", ") || user?.email}</span>
                </span>
              ) : null}
            </button>
          }
          items={[
            { label: "Mi cuenta", icon: <UserCircle size={16} />, onSelect: onAccount },
            { label: tema.etiqueta, icon: tema.icono, onSelect: tema.alternar },
            { label: "Cerrar sesión", icon: <SignOut size={16} />, onSelect: onLogout, tone: "danger", separatorBefore: true },
          ]}
        />
      </div>
    </>
  );
}

/* Contenedor de secciones con animacion de entrada discreta. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("animate-rise-in mx-auto flex w-full max-w-[1216px] flex-col gap-6", className)}>{children}</div>;
}
