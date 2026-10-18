"use client";

import { useAbrirDesdeUrl } from "@/lib/client/hooks";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { CheckCircle, Prohibit, Stamp, XCircle } from "@phosphor-icons/react";
import { PageBody } from "@/components/shell/AppShell";
import { describirSolicitud, GRUPO_DE_ENTIDAD, NOMBRE_GRUPO, useAccionesSolicitud } from "@/components/features/solicitudes/Solicitudes";
import { EstadoSolicitudBadge, SolicitudVentana } from "@/components/features/solicitudes/ventanas/SolicitudVentana";
import { useSession } from "@/components/session/SessionProvider";
import { FiguraPersona } from "@/components/ui/FiguraPersona";
import { FilterMenu, type FilterGroup, type FilterToggle } from "@/components/ui/FilterMenu";
import { ListaCuadricula, type ColumnaLista } from "@/components/ui/ListaCuadricula";
import { ActionMenu, type MenuItem } from "@/components/ui/Overlay";
import { PageHeader, Toolbar } from "@/components/ui/PageHeader";
import { haceCuantoCorto } from "@/lib/client/tiempo";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { useResource } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { formatearFechaCorta, formatearFechaHora } from "@/lib/shared/fechas";

/*
 * "Por autorizar" (Fase 3). Las acciones criticas (anular fuera de borrador,
 * anular un informe autorizado, asignar un rol, reactivar o ampliar una cuenta,
 * excepcion de segregacion) no se ejecutan al pedirse: crean una solicitud que
 * un SEGUNDO usuario, distinto del solicitante y con el permiso de la accion,
 * aprueba (confirmando su contrasena; el servidor ejecuta la accion) o rechaza
 * con motivo. Quien la pidio puede cancelarla. Vencen a los 7 dias.
 * La ve toda persona con sesion: la bandeja solo trae lo que le toca.
 * Patron lista -> ventana: cada renglon (que se pide, sobre que registro, quien
 * y hace cuanto) abre su ventana con el detalle y los botones de siempre.
 */

type Orden = "recientes" | "antiguas" | "vencen";

const COLUMNAS: ColumnaLista[] = [
  { clave: "que", titulo: "Qué se pide", ancho: "minmax(240px,1.6fr)" },
  { clave: "registro", titulo: "Registro", ancho: "minmax(130px,0.8fr)" },
  { clave: "quien", titulo: "Quién", ancho: "minmax(180px,1fr)" },
  { clave: "cuando", titulo: "Hace cuánto", ancho: "120px" },
  { clave: "estado", titulo: "Estado", ancho: "minmax(150px,0.8fr)" },
];

export default function SolicitudesPage() {
  return (
    <Suspense fallback={null}>
      <Bandeja />
    </Suspense>
  );
}

function celdas(item: ApiRecord) {
  const que = describirSolicitud(item);
  return [
    <span key="q" className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[14px] leading-tight font-semibold text-ink">{String(item.etiqueta || "Solicitud")}</span>
      {que !== String(item.etiqueta) ? <span className="text-[13px] leading-[1.45] text-ink-3">{que}</span> : null}
    </span>,
    <span key="r" className="text-[13.5px] text-ink-2">
      {String(item.referencia || "—")}
    </span>,
    <FiguraPersona key="p" id={item.solicitado_por} nombre={item.solicitado_nombre} conNombre subtitulo={item.solicitado_rol ? String(item.solicitado_rol) : undefined} />,
    <span key="c" className="text-[13px] text-ink-2" title={formatearFechaHora(item.solicitado_en)}>
      {haceCuantoCorto(item.solicitado_en)}
    </span>,
    <span key="e" className="flex flex-col items-start gap-1">
      <EstadoSolicitudBadge estado={item.estado} />
      {item.estado === "pendiente" ? <span className="text-[12px] text-ink-3">Vence {formatearFechaCorta(item.vence_en)}</span> : item.resuelto_nombre ? <span className="text-[12px] text-ink-3">{String(item.resuelto_nombre)}</span> : null}
    </span>,
  ];
}

function Bandeja() {
  const { token, user } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const modulo = params.get("modulo") || "";
  const [historial, setHistorial] = useState(false);
  const [orden, setOrden] = useState<Orden>("recientes");
  const [abierta, setAbierta] = useState<number | null>(null);
  // Al resolver una solicitud, la ventana se cierra (la lista ya cambio).
  const acciones = useAccionesSolicitud(() => setAbierta(null));

  const resource = useResource<ApiRecord[]>(
    ["solicitudes", historial ? "solicitudes:todas" : "solicitudes:pendientes"],
    async () => {
      const data = await getJsonAuth(`${API_BASE_URL}/solicitudes${historial ? "?estado=todas" : ""}`, token);
      return (data.items || []) as ApiRecord[];
    },
    { enabled: !!token },
  );
  const todos = useMemo(() => resource.data || [], [resource.data]);
  const grupos = [...new Set([...(modulo ? [modulo] : []), ...todos.filter((i) => i.puedo_aprobar).map((i) => GRUPO_DE_ENTIDAD[String(i.entidad)]).filter(Boolean)])];

  const { porAutorizar, mias, resto } = useMemo(() => {
    const filtradas = modulo ? todos.filter((i) => GRUPO_DE_ENTIDAD[String(i.entidad)] === modulo) : todos;
    const clave = (i: ApiRecord) => String(orden === "vencen" ? i.vence_en || "9999" : i.solicitado_en || "");
    const ordenadas = [...filtradas].sort((a, b) => (orden === "recientes" ? clave(b).localeCompare(clave(a)) : clave(a).localeCompare(clave(b))));
    return {
      porAutorizar: ordenadas.filter((i) => i.puedo_aprobar),
      mias: ordenadas.filter((i) => Number(i.solicitado_por) === Number(user?.id)),
      resto: ordenadas.filter((i) => !i.puedo_aprobar && Number(i.solicitado_por) !== Number(user?.id)),
    };
  }, [todos, modulo, orden, user?.id]);
  // La ventana recorre las tres listas en orden (↑/↓).
  const secuencia = useMemo(() => [...porAutorizar, ...mias, ...(historial ? resto : [])], [porAutorizar, mias, resto, historial]);
  const abrir = (item: ApiRecord) => setAbierta(secuencia.indexOf(item));
  // Desde la campana o el Inicio: ?abrir=<id> abre esa solicitud.
  useAbrirDesdeUrl(resource.data ? secuencia : null, setAbierta);

  const menuFor = (item: ApiRecord): MenuItem[] => {
    if (String(item.estado) !== "pendiente") return [];
    const list: MenuItem[] = [];
    if (item.puedo_aprobar) {
      list.push({ label: "Aprobar…", icon: <Stamp size={16} weight="duotone" />, tone: "brand", onSelect: () => acciones.aprobar(item) });
      list.push({ label: "Rechazar…", icon: <XCircle size={16} weight="duotone" />, tone: "danger", onSelect: () => acciones.rechazar(item) });
    }
    if (item.puedo_cancelar) list.push({ label: "Cancelar solicitud…", icon: <Prohibit size={16} weight="duotone" />, tone: "danger", onSelect: () => acciones.cancelar(item) });
    return list;
  };

  const groups: FilterGroup[] = grupos.length
    ? [{ key: "modulo", label: "Módulo", value: modulo, defaultValue: "", onChange: (v) => router.replace(v ? `/solicitudes?modulo=${v}` : "/solicitudes"), options: [{ value: "", label: "Todos" }, ...grupos.map((g) => ({ value: g, label: NOMBRE_GRUPO[g] || g }))] }]
    : [];
  const toggles: FilterToggle[] = [{ key: "historial", label: "Ver historial", checked: historial, onChange: setHistorial }];
  const ordenar: FilterGroup[] = [
    { key: "orden", label: "Ordenar por", value: orden, defaultValue: "recientes", showDefault: true, onChange: (v) => setOrden(v as Orden), options: [{ value: "recientes", label: "Más recientes" }, { value: "antiguas", label: "Más antiguas" }, { value: "vencen", label: "Vencen primero" }] },
  ];

  const lista = (titulo: string, id: string, filas: ApiRecord[], vacio: { titulo: string; descripcion: string }) => (
    <section className="flex flex-col gap-3" aria-labelledby={id}>
      <h2 id={id} className="title-3 text-ink">
        {titulo}
      </h2>
      <ListaCuadricula
        etiqueta={titulo}
        columnas={COLUMNAS}
        filas={resource.data ? filas : null}
        error={resource.error}
        onReintentar={resource.reload}
        clave={(item) => String(item.id)}
        onAbrir={(item) => abrir(item)}
        activa={(item) => abierta !== null && secuencia[abierta] === item}
        celdas={celdas}
        extremo={(item) => {
          const menu = menuFor(item);
          return <span className="w-9">{menu.length ? <ActionMenu items={menu} header={String(item.etiqueta || "")} /> : null}</span>;
        }}
        anchoExtremo="52px"
        propsFila={(item) => ({ "data-solicitud": String(item.id) })}
        vacio={{ icono: <CheckCircle size={22} weight="duotone" />, titulo: vacio.titulo, descripcion: vacio.descripcion }}
      />
    </section>
  );

  return (
    <PageBody>
      <PageHeader
        title="Por autorizar"
        description="Acciones críticas que esperan la aprobación de un segundo usuario: anulaciones fuera de borrador, informes autorizados, asignación de roles, reactivaciones, ampliaciones de vigencia y excepciones de segregación. Quien las pide no puede aprobarlas."
      />

      <Toolbar>
        <FilterMenu groups={groups} toggles={toggles} gruposFinales={ordenar} />
      </Toolbar>

      {lista("Pendientes de tu autorización", "sol-pendientes", porAutorizar, { titulo: "Nada pendiente de tu autorización", descripcion: modulo ? `No hay solicitudes de ${NOMBRE_GRUPO[modulo] || modulo} que puedas aprobar.` : "Cuando alguien pida una acción crítica que tú puedas aprobar, aparecerá aquí." })}
      {lista("Mis solicitudes", "sol-mias", mias, { titulo: historial ? "No has hecho solicitudes" : "No tienes solicitudes pendientes", descripcion: "Cuando pidas una acción crítica, aquí verás si ya la aprobaron o rechazaron." })}
      {historial && resto.length ? lista("Otras solicitudes", "sol-otras", resto, { titulo: "Sin más solicitudes", descripcion: "" }) : null}

      <SolicitudVentana items={secuencia} indice={abierta} onIndice={setAbierta} onCerrar={() => setAbierta(null)} acciones={acciones} />
      {acciones.dialogo}
    </PageBody>
  );
}
