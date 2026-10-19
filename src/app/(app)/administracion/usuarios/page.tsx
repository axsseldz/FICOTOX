"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowCounterClockwise, Certificate, Copy, ImageBroken, Key, LockOpen, PencilSimple, Plus, Trash, Users } from "@phosphor-icons/react";
import { UserSheet } from "@/components/features/admin/AdminSheets";
import { EtiquetaRol } from "@/components/features/admin/iconos";
import { ListaCuadricula, type ColumnaLista } from "@/components/ui/ListaCuadricula";
import { haceCuantoCorto } from "@/lib/client/tiempo";
import { estadoCuenta, UsuarioVentana } from "@/components/features/admin/UsuarioVentana";
import { SolicitudBadge } from "@/components/features/samples/status";
import { PageBody } from "@/components/shell/AppShell";
import { RequireModule } from "@/components/session/RequireModule";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { FilterMenu, type FilterGroup, type FilterToggle } from "@/components/ui/FilterMenu";
import { ActionMenu, Dialog, usePrompt, type MenuItem } from "@/components/ui/Overlay";
import { PageHeader, SearchInput, Toolbar } from "@/components/ui/PageHeader";
import { Avatar, Badge, Correo } from "@/components/ui/Primitives";
import { useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { API_BASE_URL, getJsonAuth, resolveApiEntity, sendJsonAuth } from "@/lib/client/api";
import { fmt, normalizeText } from "@/lib/client/format";
import { useOpenState, useUrlTrigger, useInitialParam, useParamChange } from "@/lib/client/hooks";
import { invalidate, useResource } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { formatearFecha, formatearFechaHora, formatearHora, hoyLocal, sumarDias } from "@/lib/shared/fechas";

/*
 * Usuarios: lista elaborada (figura de perfil, nombre y correo, roles
 * completos, estado, supervisor, ultimo acceso, autorizaciones y solicitud
 * pendiente) y, al pulsar una persona, su ventana centrada (General, Roles y
 * Autorizaciones). Lo que era "Revision de accesos" vive en el menu Filtros
 * (Estado, Tipo de cuenta, Rol, Vigencia, Otros y Ordenar por); los avisos
 * del Inicio y la campana llegan con el filtro en la URL. Sin exportacion.
 * Las acciones y sus reglas no cambian.
 */

export default function UsuariosPage() {
  return (
    <PageBody>
      <PageHeader title="Usuarios" description="Las personas que entran a la plataforma, sus roles y sus autorizaciones. Las cuentas no se eliminan: se dan de baja con motivo." />
      <RequireModule modules="usuarios">
        {/* Los avisos del Inicio y la campana llegan con un filtro en la URL (?vigencia=vence7). */}
        <Suspense fallback={null}>
          <UsuariosContent />
        </Suspense>
      </RequireModule>
    </PageBody>
  );
}

type EstadoFiltro = "" | "activos" | "baja" | "bloqueados";
type TipoFiltro = "" | "permanente" | "temporal";
type VigenciaFiltro = "" | "vence7" | "vencido";
type Orden = "nombre" | "acceso" | "alta";

/* Fecha de fin mas cercana de la cuenta o de sus roles vigentes. */
const vencimientos = (item: ApiRecord): string[] => [item.vigente_hasta, ...((item.roles || []) as ApiRecord[]).map((r) => r.vigente_hasta)].filter(Boolean).map(String);
const venceEnSemana = (item: ApiRecord, hoy: string) => !!item.activo && vencimientos(item).some((f) => f >= hoy && f <= sumarDias(hoy, 7));

function UsuariosContent() {
  const { token, can, user: me, alcance } = useSession();
  const prompt = usePrompt();
  const params = useSearchParams();
  const [search, setSearch] = useState(useInitialParam("buscar"));
  useParamChange("buscar", setSearch);
  const [estado, setEstado] = useState<EstadoFiltro>(() => (params.get("estado") as EstadoFiltro) || "");
  const [tipo, setTipo] = useState<TipoFiltro>(() => (params.get("tipo") as TipoFiltro) || "");
  const [vigencia, setVigencia] = useState<VigenciaFiltro>(() => (params.get("vigencia") as VigenciaFiltro) || "");
  const [rol, setRol] = useState("");
  const [conSolicitudes, setConSolicitudes] = useState(() => params.get("solicitudes") === "1");
  const [sinRoles, setSinRoles] = useState(false);
  const [sinAutorizaciones, setSinAutorizaciones] = useState(false);
  const [orden, setOrden] = useState<Orden>("nombre");
  const [abierta, setAbierta] = useState<number | null>(null);
  // Desde la ventana de un rol: /administracion/usuarios?abrir=<id> abre la ventana de esa persona.
  const [abrirPendiente, setAbrirPendiente] = useState<string | null>(() => params.get("abrir"));
  const modal = useOpenState<ApiRecord>();
  // Contrasena temporal recien generada: se muestra una sola vez.
  const [temporal, setTemporal] = useState<{ email: string; password: string } | null>(null);
  const hoy = hoyLocal();

  const resource = useResource<ApiRecord[]>(
    "usuarios",
    async () => {
      const data = await getJsonAuth(`${API_BASE_URL}/admin/usuarios`, token);
      return (data.items || []) as ApiRecord[];
    },
    { enabled: !!token },
  );
  const items = useMemo(() => resource.data || [], [resource.data]);
  const roles = useMemo(() => Array.from(new Set(items.flatMap((item) => ((item.roles || []) as ApiRecord[]).map((r) => String(r.nombre || ""))).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [items]);

  const rows = useMemo(() => {
    const term = normalizeText(search);
    const lista = items.filter((item) => {
      if (term && !normalizeText(`${item.nombre || ""} ${item.email || ""}`).includes(term)) return false;
      if (estado === "activos" && !item.activo) return false;
      if (estado === "baja" && item.activo) return false;
      if (estado === "bloqueados" && !item.bloqueado_hasta) return false;
      if (tipo && String(item.tipo_cuenta || "permanente") !== tipo) return false;
      if (vigencia === "vence7" && !venceEnSemana(item, hoy)) return false;
      if (vigencia === "vencido" && !(item.activo && item.cuenta_vigente === false)) return false;
      if (rol && !((item.roles || []) as ApiRecord[]).some((r) => r.nombre === rol)) return false;
      if (conSolicitudes && !item.solicitud_pendiente) return false;
      if (sinRoles && ((item.roles || []) as ApiRecord[]).length) return false;
      if (sinAutorizaciones && Number(item.autorizaciones_vigentes || 0) > 0) return false;
      return true;
    });
    const nombre = (i: ApiRecord) => String(i.nombre || i.email || "");
    if (orden === "nombre") return lista.sort((a, b) => nombre(a).localeCompare(nombre(b), "es"));
    if (orden === "acceso") return lista.sort((a, b) => String(b.ultimo_acceso || "").localeCompare(String(a.ultimo_acceso || "")));
    return lista.sort((a, b) => String(b.creado_en || "").localeCompare(String(a.creado_en || "")));
  }, [items, search, estado, tipo, vigencia, rol, conSolicitudes, sinRoles, sinAutorizaciones, orden, hoy]);

  // Errores de las acciones (motivo y contraseña ya capturados): pop-up con qué pasó y qué hacer.
  const vAccion = useValidacion({ titulo: "No se pudo completar la acción", reglas: () => [] });
  const editUser = async (id: number) => {
    try {
      const data = await getJsonAuth(`${API_BASE_URL}/admin/usuarios/${id}`, token);
      modal.open(resolveApiEntity(data));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo cargar el usuario");
    }
  };

  // Las cuentas no se eliminan: se dan de baja (inactivas) con motivo y su historial se conserva.
  const darDeBaja = async (item: ApiRecord) => {
    const motivo = await prompt({ critico: true, title: `Dar de baja a ${item.nombre || item.email}`, description: "La cuenta queda inactiva y no puede entrar; los registros y la bitácora que la citan se conservan.", confirmLabel: "Dar de baja", tone: "danger" });
    if (!motivo) return;
    try {
      await sendJsonAuth("DELETE", `${API_BASE_URL}/admin/usuarios/${item.id}`, token, { motivo });
      toast.success("Cuenta dada de baja");
      invalidate("usuarios", "roles");
    } catch (err) {
      vAccion.errorServidor(err);
    }
  };

  // Quitar la foto de perfil de otra persona (por ejemplo, si es inapropiada), con motivo; no se sube una por ella.
  const quitarFoto = async (item: ApiRecord) => {
    const motivo = await prompt({ title: `Quitar la foto de perfil de ${item.nombre || item.email}`, description: "La foto se borra y vuelve a verse su figura. Queda en la bitácora con el motivo.", label: "Motivo", minLength: 5, confirmLabel: "Quitar foto", tone: "danger" });
    if (!motivo) return;
    try {
      await sendJsonAuth("DELETE", `${API_BASE_URL}/admin/usuarios/${item.id}/foto`, token, { motivo });
      toast.success("Foto de perfil quitada");
      invalidate("usuarios", "cuentas-activas");
    } catch (err) {
      vAccion.errorServidor(err);
    }
  };

  // Reactivar: la aprueba un segundo usuario (como al marcarla activa en la edición).
  const reactivar = async (item: ApiRecord) => {
    const motivo = await prompt({ critico: true, title: `Reactivar a ${item.nombre || item.email}`, description: "La cuenta vuelve a poder entrar cuando otra persona autorizada apruebe la solicitud.", confirmLabel: "Pedir reactivación" });
    if (!motivo) return;
    try {
      const data = await sendJsonAuth("PUT", `${API_BASE_URL}/admin/usuarios/${item.id}`, token, {
        nombre: item.nombre,
        email: item.email,
        departamento: item.departamento || null,
        activo: true,
        tipo_cuenta: item.tipo_cuenta || "permanente",
        vigente_desde: item.vigente_desde || null,
        vigente_hasta: item.vigente_hasta || null,
        supervisor_id: item.supervisor_id ? Number(item.supervisor_id) : null,
        motivo,
      });
      if (data.solicitud) toast.info("La reactivación quedó pendiente de que otra persona autorizada la apruebe", { duration: 8000 });
      else toast.success("Cuenta reactivada");
      invalidate("usuarios", "roles", "solicitudes");
    } catch (err) {
      vAccion.errorServidor(err);
    }
  };

  // Levantar un bloqueo por intentos fallidos (motivo y reautenticacion).
  const desbloquear = async (item: ApiRecord) => {
    const motivo = await prompt({ critico: true, title: `Desbloquear a ${item.nombre || item.email}`, description: `La cuenta está bloqueada hasta las ${formatearHora(item.bloqueado_hasta, "-")} por intentos fallidos. Confirma que verificaste la identidad de la persona.`, confirmLabel: "Desbloquear" });
    if (!motivo) return;
    try {
      await sendJsonAuth("POST", `${API_BASE_URL}/admin/usuarios/${item.id}/desbloquear`, token, { motivo });
      toast.success("Cuenta desbloqueada");
      invalidate("usuarios");
    } catch (err) {
      vAccion.errorServidor(err);
    }
  };

  // Contrasena temporal; la persona debe cambiarla al entrar y sus sesiones se cierran.
  const restablecer = async (item: ApiRecord) => {
    const motivo = await prompt({ critico: true, title: `Restablecer la contraseña de ${item.nombre || item.email}`, description: "Se genera una contraseña temporal que la persona deberá cambiar al entrar; sus sesiones abiertas se cierran.", confirmLabel: "Restablecer contraseña", tone: "danger" });
    if (!motivo) return;
    try {
      const data = await sendJsonAuth("POST", `${API_BASE_URL}/admin/usuarios/${item.id}/password`, token, { motivo });
      setTemporal({ email: String(item.email || ""), password: String(data.password_temporal || "") });
      invalidate("usuarios");
    } catch (err) {
      vAccion.errorServidor(err);
    }
  };

  // usuarios:G administra cuentas y roles; con alcance "propio" la lista solo trae la cuenta propia.
  const canAdmin = can("usuarios", "G");
  const propio = alcance("usuarios", "V") === "propio";
  // Desde el Inicio (acceso rapido "Nuevo usuario"): ?nuevo=1 abre el formulario.
  useUrlTrigger("nuevo", () => {
    if (canAdmin && !propio) modal.open(null);
  });

  const menuFor = (item: ApiRecord): MenuItem[] => {
    if (!canAdmin) return [];
    const yo = Number(me?.id) === Number(item.id);
    const list: MenuItem[] = [{ label: "Editar datos", icon: <PencilSimple size={16} weight="duotone" />, tone: "brand", onSelect: () => editUser(Number(item.id)) }];
    if (!yo && item.activo) list.push({ label: "Restablecer contraseña…", icon: <Key size={16} weight="duotone" />, onSelect: () => restablecer(item) });
    if (item.bloqueado_hasta) list.push({ label: "Desbloquear…", icon: <LockOpen size={16} weight="duotone" />, onSelect: () => desbloquear(item) });
    if (!yo && Number(item.tiene_foto)) list.push({ label: "Quitar foto de perfil…", icon: <ImageBroken size={16} weight="duotone" />, onSelect: () => quitarFoto(item) });
    if (!yo && item.activo) list.push({ label: "Dar de baja…", icon: <Trash size={16} weight="duotone" />, tone: "danger", separatorBefore: true, onSelect: () => darDeBaja(item) });
    if (!yo && !item.activo) list.push({ label: "Reactivar…", icon: <ArrowCounterClockwise size={16} weight="duotone" />, separatorBefore: true, onSelect: () => reactivar(item) });
    return list;
  };

  const indiceAbrir = abrirPendiente ? rows.findIndex((r) => String(r.id) === abrirPendiente) : -1;
  const indice = abierta ?? (indiceAbrir >= 0 ? indiceAbrir : null);
  const cerrar = () => {
    setAbierta(null);
    setAbrirPendiente(null);
  };
  // Abrir la ventana de otra persona (p. ej. el supervisor): si los filtros la ocultan, se limpian.
  const abrirPersona = (id: number) => {
    const enLista = rows.findIndex((r) => Number(r.id) === id);
    if (enLista >= 0) {
      setAbierta(enLista);
      return;
    }
    setSearch("");
    setEstado("");
    setTipo("");
    setVigencia("");
    setRol("");
    setConSolicitudes(false);
    setSinRoles(false);
    setSinAutorizaciones(false);
    setAbierta(null);
    setAbrirPendiente(String(id));
  };

  const groups: FilterGroup[] = [
    { key: "estado", label: "Estado", value: estado, defaultValue: "", onChange: (v) => setEstado(v as EstadoFiltro), options: [{ value: "", label: "Todos" }, { value: "activos", label: "Activos" }, { value: "baja", label: "De baja" }, { value: "bloqueados", label: "Bloqueados" }] },
    { key: "tipo", label: "Tipo de cuenta", value: tipo, defaultValue: "", onChange: (v) => setTipo(v as TipoFiltro), options: [{ value: "", label: "Todas" }, { value: "permanente", label: "Permanente" }, { value: "temporal", label: "Temporal" }] },
    { key: "rol", label: "Rol", value: rol, defaultValue: "", onChange: setRol, options: [{ value: "", label: "Todos" }, ...roles.map((r) => ({ value: r, label: r }))] },
    { key: "vigencia", label: "Vigencia", value: vigencia, defaultValue: "", onChange: (v) => setVigencia(v as VigenciaFiltro), options: [{ value: "", label: "Todas" }, { value: "vence7", label: "Vence en los próximos 7 días" }, { value: "vencido", label: "Acceso vencido" }] },
  ];
  const toggles: FilterToggle[] = [
    { key: "solicitudes", label: "Con solicitudes pendientes", group: "Otros", checked: conSolicitudes, onChange: setConSolicitudes },
    { key: "sin-roles", label: "Sin roles vigentes", group: "Otros", checked: sinRoles, onChange: setSinRoles },
    { key: "sin-aut", label: "Sin autorizaciones FX-THF-AP", group: "Otros", checked: sinAutorizaciones, onChange: setSinAutorizaciones },
  ];
  // Una sola seleccion; va al final del menu de filtros.
  const ordenar: FilterGroup[] = [
    { key: "orden", label: "Ordenar por", value: orden, defaultValue: "nombre", showDefault: true, onChange: (v) => setOrden(v as Orden), options: [{ value: "nombre", label: "Nombre A–Z" }, { value: "acceso", label: "Último acceso" }, { value: "alta", label: "Fecha de alta" }] },
  ];
  const filtrando = !!search.trim() || !!estado || !!tipo || !!vigencia || !!rol || conSolicitudes || sinRoles || sinAutorizaciones;

  return (
    <>
      <ValidacionAmbito v={vAccion}>{null}</ValidacionAmbito>

      <Toolbar
        end={
          canAdmin && !propio ? (
            <Button icon={<Plus size={16} weight="bold" />} onClick={() => modal.open(null)}>
              Nuevo usuario
            </Button>
          ) : null
        }
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nombre o correo" className="min-w-0 flex-1 md:w-[340px] md:flex-none" />
        {!propio ? <FilterMenu groups={groups} toggles={toggles} gruposFinales={ordenar} /> : null}
      </Toolbar>

      <ListaCuadricula
        etiqueta="Usuarios"
        columnas={COLUMNAS}
        filas={resource.data ? rows : null}
        error={resource.error}
        onReintentar={resource.reload}
        clave={(item) => String(item.id)}
        onAbrir={(_, i) => setAbierta(i)}
        activa={(_, i) => indice === i}
        celdas={(item) => celdasUsuario(item, items, Number(me?.id) === Number(item.id))}
        extremo={(item) => {
          const menu = menuFor(item);
          return (
            <>
              <span className="flex w-7 justify-center">
                <SolicitudBadge solicitud={item.solicitud_pendiente as ApiRecord | null} entidad="usuarios" />
              </span>
              <span className="w-9">{menu.length ? <ActionMenu items={menu} header={String(item.nombre || item.email || "")} /> : null}</span>
            </>
          );
        }}
        anchoExtremo="84px"
        propsFila={(item) => ({ "data-usuario": String(item.id) })}
        vacio={{ icono: <Users size={20} />, titulo: "Sin usuarios", descripcion: filtrando ? "No hay personas con estos filtros." : "Crea la primera cuenta de acceso." }}
      />
      {resource.data && rows.length ? <p className="tnum mt-2 px-1 text-xs text-ink-3">{rows.length === 1 ? "1 persona" : `${fmt(rows.length)} personas`}</p> : null}

      <UsuarioVentana usuarios={rows} todos={items} indice={indice} onIndice={setAbierta} onCerrar={cerrar} onDesbloquear={desbloquear} onAbrirPersona={abrirPersona} />

      <Dialog
        open={!!temporal}
        onOpenChange={(open) => !open && setTemporal(null)}
        title="Contraseña temporal"
        description={`Entrégala a ${temporal?.email || "la persona"} por un medio seguro. No se volverá a mostrar: al cerrar este aviso ya no podrás verla.`}
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              icon={<Copy size={16} />}
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(temporal?.password || "")
                  .then(() => toast.success("Contraseña copiada"))
                  .catch(() => toast.error("No se pudo copiar"));
              }}
            >
              Copiar
            </Button>
            <Button onClick={() => setTemporal(null)}>Entendido</Button>
          </>
        }
      >
        <p className="rounded-field bg-surface-2 px-3 py-3 text-center font-mono text-lg tracking-wide text-ink ring-1 ring-line" data-testid="password-temporal">
          {temporal?.password}
        </p>
        <p className="mt-3 text-xs text-ink-3">La persona deberá cambiarla al iniciar sesión. El cambio queda en la bitácora sin la contraseña.</p>
      </Dialog>

      {modal.key ? <UserSheet key={`modal-${modal.key}`} open={modal.isOpen} item={modal.payload} onClose={modal.close} /> : null}
    </>
  );
}

/* Columnas fijas de la lista (encabezados discretos); en angostas, tarjeta. */
const COLUMNAS: ColumnaLista[] = [
  { clave: "persona", titulo: "Persona", ancho: "minmax(230px,1.3fr)" },
  { clave: "roles", titulo: "Roles", ancho: "minmax(200px,1.5fr)" },
  { clave: "estado", titulo: "Estado", ancho: "minmax(170px,1fr)" },
  { clave: "acceso", titulo: "Último acceso", ancho: "130px" },
  { clave: "autorizaciones", titulo: "Autorizaciones", ancho: "140px" },
];

/*
 * Celdas de un renglon: figura (quieta; flota al pasar el cursor), nombre y
 * correo; roles completos (pasan de linea dentro de su columna); estado con su
 * insignia (temporal: hasta cuando y quien supervisa); ultimo acceso (fecha
 * exacta al pasar el cursor); autorizaciones vigentes o "—".
 */
function celdasUsuario(item: ApiRecord, todos: ApiRecord[], yo: boolean) {
  const roles = ((item.roles || []) as ApiRecord[]).map((r) => String(r.nombre || "")).filter(Boolean);
  const estado = estadoCuenta(item);
  const temporal = String(item.tipo_cuenta || "") === "temporal";
  const autorizaciones = Number(item.autorizaciones_vigentes || 0);
  const supervisor = item.supervisor_id ? todos.find((u) => Number(u.id) === Number(item.supervisor_id)) : undefined;
  return [
    <span key="p" className="flex min-w-0 items-center gap-3">
      <Avatar name={item.nombre} email={item.email} avatar={item.avatar} size="lg" animado="al-pasar" className="h-11 w-11" />
      <span className="flex min-w-0 flex-col">
        <span className="text-base leading-tight font-semibold text-ink">
          {String(item.nombre || "Sin nombre")}
          {yo ? <span className="ml-1.5 text-xs font-normal text-ink-3">(tú)</span> : null}
        </span>
        <Correo valor={item.email} className="text-xs text-ink-3" />
      </span>
    </span>,
    <span key="r" className="flex flex-wrap items-center gap-1.5">
      {roles.map((r) => (
        <EtiquetaRol key={r}>{r}</EtiquetaRol>
      ))}
      {!roles.length ? <span className="text-sm text-ink-4">—</span> : null}
    </span>,
    <span key="e" className="flex flex-col items-start gap-1">
      <Badge tone={estado.tone} dot>
        {estado.label}
      </Badge>
      {temporal && item.vigente_hasta ? (
        <span className="flex flex-col items-start gap-0.5 text-xs text-ink-3">
          <span>Hasta {formatearFecha(item.vigente_hasta)}</span>
          {item.supervisor_nombre ? (
            <span className="inline-flex items-center gap-1">
              <Avatar name={supervisor?.nombre || item.supervisor_nombre} email={supervisor?.email} avatar={supervisor?.avatar} size="xs" className="h-4 w-4" /> supervisa {String(item.supervisor_nombre).split(" ")[0]}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>,
    <span key="a" className="text-sm text-ink-2" title={item.ultimo_acceso ? `Último acceso: ${formatearFechaHora(item.ultimo_acceso)}` : undefined}>
      {item.ultimo_acceso ? haceCuantoCorto(item.ultimo_acceso) : <span className="text-ink-3">Nunca</span>}
    </span>,
    autorizaciones ? (
      <Badge key="z" tone="brand">
        <Certificate size={13} weight="duotone" />
        {autorizaciones === 1 ? "1 vigente" : `${autorizaciones} vigentes`}
      </Badge>
    ) : (
      <span key="z" className="text-sm text-ink-4">—</span>
    ),
  ];
}
