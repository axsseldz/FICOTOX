"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { LockKey, PencilSimple, Plus, Power, ShieldCheck, TextAa } from "@phosphor-icons/react";
import { IconoRol } from "@/components/features/admin/iconos";
import { FigurasApiladas } from "@/components/ui/Insignias";
import { ListaCuadricula, type ColumnaLista } from "@/components/ui/ListaCuadricula";
import { cargarRol, DatosRolDialog, guardarRol, RolVentana } from "@/components/features/admin/RolVentana";
import { PageBody } from "@/components/shell/AppShell";
import { RequireModule } from "@/components/session/RequireModule";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { FilterMenu, type FilterGroup } from "@/components/ui/FilterMenu";
import { ActionMenu, usePrompt, type MenuItem } from "@/components/ui/Overlay";
import { PageHeader, SearchInput, Toolbar } from "@/components/ui/PageHeader";
import { Avatar, Badge, EmptyState } from "@/components/ui/Primitives";
import { useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { fmt, normalizeText } from "@/lib/client/format";
import { invalidate, useResource } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { descripcionDeRol } from "@/lib/shared/roles-descripcion";
import { useInitialParam, useParamChange, useAbrirDesdeUrl } from "@/lib/client/hooks";

/*
 * Roles (minimalista): una lista sencilla (nombre, cuantas personas lo tienen,
 * "Del sistema" e "Inactivo") y, al pulsar un rol, su ventana centrada con lo
 * que puede hacer en palabras, las personas y el editor de permisos. Las
 * reglas no cambian (motivo, reautenticacion, combinaciones prohibidas, rol
 * propio en solo lectura).
 */

export default function RolesPage() {
  return (
    <PageBody>
      <PageHeader title="Roles" description="Qué puede hacer cada rol en la plataforma. Lo que no se concede, no se puede hacer." />
      <RequireModule modules="usuarios">
        <RolesGuard />
      </RequireModule>
    </PageBody>
  );
}

/* Con alcance "propio" en usuarios la persona solo ve su cuenta: el catalogo de roles no le corresponde. */
function RolesGuard() {
  const { alcance } = useSession();
  if (alcance("usuarios", "V") === "propio") {
    return <EmptyState icon={<LockKey size={20} />} title="Sin acceso a esta sección" description="Solo puedes ver tu propia cuenta." />;
  }
  return <RolesContent />;
}

type EstadoFiltro = "" | "activos" | "inactivos";
type TipoFiltro = "" | "sistema" | "personalizados";
type UsoFiltro = "" | "con" | "sin";

function RolesContent() {
  const { token, can, roles: rolesSesion } = useSession();
  const prompt = usePrompt();
  const [search, setSearch] = useState(useInitialParam("buscar"));
  useParamChange("buscar", setSearch);
  const [estado, setEstado] = useState<EstadoFiltro>("");
  const [tipo, setTipo] = useState<TipoFiltro>("");
  const [uso, setUso] = useState<UsoFiltro>("");
  const [abierto, setAbierto] = useState<number | null>(null);
  const [editar, setEditar] = useState(false);
  const [datos, setDatos] = useState<{ role: ApiRecord | null } | null>(null);

  const resource = useResource<ApiRecord[]>(
    "roles",
    async () => {
      const data = await getJsonAuth(`${API_BASE_URL}/admin/roles`, token);
      return (data.items || []) as ApiRecord[];
    },
    { enabled: !!token },
  );
  const roles = useMemo(() => resource.data || [], [resource.data]);
  const rows = useMemo(() => {
    const term = normalizeText(search);
    return roles.filter((role) => {
      if (term && !normalizeText(String(role.nombre || "")).includes(term)) return false;
      if (estado === "activos" && !role.activo) return false;
      if (estado === "inactivos" && role.activo) return false;
      if (tipo === "sistema" && !role.es_sistemico) return false;
      if (tipo === "personalizados" && role.es_sistemico) return false;
      if (uso === "con" && !Number(role.total_usuarios || 0)) return false;
      if (uso === "sin" && Number(role.total_usuarios || 0)) return false;
      return true;
    });
  }, [roles, search, estado, tipo, uso]);

  // Desde la búsqueda: /administracion/roles?abrir=<id> abre la ventana de ese rol.
  useAbrirDesdeUrl(resource.data ? rows : null, setAbierto);

  // Errores de las acciones (motivo y contraseña ya capturados): pop-up con qué pasó y qué hacer.
  const vAccion = useValidacion({ titulo: "No se pudo completar la acción", reglas: () => [] });
  const canAdmin = can("usuarios", "G");

  const abrir = (role: ApiRecord, enEdicion = false) => {
    setEditar(enEdicion);
    setAbierto(rows.indexOf(role));
  };

  // Activar o desactivar: cambia lo que concede el rol, con motivo y reautenticacion (como siempre).
  const activarDesactivar = async (role: ApiRecord) => {
    const activar = !role.activo;
    const motivo = await prompt({ critico: true, title: `${activar ? "Activar" : "Desactivar"} el rol «${role.nombre}»`, description: activar ? "Quien tenga este rol vuelve a tener sus permisos." : "Un rol inactivo no concede permisos a nadie; sus asignaciones se conservan.", label: "Motivo", minLength: 5, confirmLabel: activar ? "Activar" : "Desactivar", tone: activar ? undefined : "danger" });
    if (!motivo) return;
    try {
      const actual = await cargarRol(Number(role.id), token);
      await guardarRol(token, actual.role, { activo: activar, permisos: actual.permisos, motivo });
      toast.success(activar ? "Rol activado" : "Rol desactivado");
      invalidate("roles", "usuarios");
    } catch (err) {
      vAccion.errorServidor(err);
    }
  };

  const menuFor = (role: ApiRecord): MenuItem[] => {
    const propio = rolesSesion.some((rol) => Number(rol.id) === Number(role.id));
    // El clic en el renglon ya abre la ventana (permisos en solo lectura): sin "Ver" en el menu.
    if (!canAdmin || propio) return [];
    return [
      { label: "Editar permisos", icon: <PencilSimple size={16} weight="duotone" />, tone: "brand", onSelect: () => abrir(role, true) },
      { label: "Editar nombre y descripción", icon: <TextAa size={16} weight="duotone" />, onSelect: () => setDatos({ role }) },
      { label: role.activo ? "Desactivar…" : "Activar…", icon: <Power size={16} weight="duotone" />, tone: role.activo ? "danger" : undefined, separatorBefore: true, onSelect: () => activarDesactivar(role) },
    ];
  };

  const groups: FilterGroup[] = [
    { key: "estado", label: "Estado", value: estado, defaultValue: "", onChange: (v) => setEstado(v as EstadoFiltro), options: [{ value: "", label: "Todos" }, { value: "activos", label: "Activos" }, { value: "inactivos", label: "Inactivos" }] },
    { key: "tipo", label: "Tipo", value: tipo, defaultValue: "", onChange: (v) => setTipo(v as TipoFiltro), options: [{ value: "", label: "Todos" }, { value: "sistema", label: "Del sistema" }, { value: "personalizados", label: "Personalizados" }] },
    { key: "uso", label: "Uso", value: uso, defaultValue: "", onChange: (v) => setUso(v as UsoFiltro), options: [{ value: "", label: "Todos" }, { value: "con", label: "Con personas asignadas" }, { value: "sin", label: "Sin personas" }] },
  ];
  const filtrando = !!search.trim() || !!estado || !!tipo || !!uso;

  return (
    <>
      <ValidacionAmbito v={vAccion}>{null}</ValidacionAmbito>
      <Toolbar
        end={
          canAdmin ? (
            <Button icon={<Plus size={16} weight="bold" />} onClick={() => setDatos({ role: null })}>
              Nuevo rol
            </Button>
          ) : null
        }
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nombre" className="w-full md:w-[320px]" />
        <FilterMenu groups={groups} />
      </Toolbar>

      <ListaCuadricula
        etiqueta="Roles"
        columnas={COLUMNAS}
        filas={resource.data ? rows : null}
        error={resource.error}
        onReintentar={resource.reload}
        clave={(role) => String(role.id)}
        onAbrir={(role) => abrir(role)}
        activa={(_, i) => abierto === i}
        celdas={celdasRol}
        extremo={(role) => (
          <span className="w-9">{menuFor(role).length ? <ActionMenu items={menuFor(role)} header={String(role.nombre || "")} /> : null}</span>
        )}
        anchoExtremo="52px"
        propsFila={(role) => ({ "data-rol": String(role.id) })}
        vacio={{ icono: <ShieldCheck size={20} />, titulo: "Sin roles", descripcion: filtrando ? "No hay roles con estos filtros." : "Crea un rol para definir qué puede hacer cada persona." }}
      />

      <RolVentana roles={rows} indice={abierto} editar={editar} onIndice={setAbierto} onEditar={setEditar} onCerrar={() => (setAbierto(null), setEditar(false))} />
      {datos ? <DatosRolDialog role={datos.role} onCerrar={() => setDatos(null)} /> : null}
    </>
  );
}

const COLUMNAS: ColumnaLista[] = [
  { clave: "rol", titulo: "Rol", ancho: "minmax(300px,2fr)" },
  { clave: "personas", titulo: "Personas", ancho: "minmax(210px,1fr)" },
  { clave: "tipo", titulo: "Tipo", ancho: "160px" },
];

/* Celdas: icono, nombre completo y proposito; figuras de las personas (maximo 4 y "+N") con el total; Del sistema / Inactivo. */
function celdasRol(role: ApiRecord) {
  const desc = descripcionDeRol(role);
  const personas = (role.personas || []) as ApiRecord[];
  const total = Number(role.total_usuarios || personas.length || 0);
  return [
    <span key="r" className="flex min-w-0 items-start gap-3.5">
      <IconoRol icono={desc.icono} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[14.5px] leading-tight font-semibold text-ink">{String(role.nombre || "Rol")}</span>
        <span className="text-[13px] leading-[1.45] text-ink-3">{desc.proposito}</span>
      </span>
    </span>,
    <span key="p" className="flex items-center gap-2.5">
      {personas.length ? (
        <FigurasApiladas total={personas.length}>
          {personas.map((p) => (
            <Avatar key={String(p.id)} name={p.nombre} email={p.email} avatar={p.avatar} size="sm" className="ring-2 ring-surface transition-transform duration-200 ease-[var(--ease-spring)] group-hover:-translate-y-0.5" />
          ))}
        </FigurasApiladas>
      ) : null}
      <span className="text-[13px] text-ink-3">{total ? (total === 1 ? "1 persona" : `${fmt(total)} personas`) : "Sin personas"}</span>
    </span>,
    <span key="t" className="flex flex-wrap gap-1.5">
      {role.es_sistemico ? <Badge tone="neutral">Del sistema</Badge> : <Badge tone="brand">Personalizado</Badge>}
      {!role.activo ? <Badge tone="warning">Inactivo</Badge> : null}
    </span>,
  ];
}
