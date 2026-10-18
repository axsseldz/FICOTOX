"use client";

import { useMemo, useState } from "react";
import { ArrowUUpLeft, CheckCircle, Eye, SealCheck } from "@phosphor-icons/react";
import { PageBody } from "@/components/shell/AppShell";
import { useAccionesSupervision } from "@/components/features/solicitudes/Solicitudes";
import { SupervisionVentana, type ElementoSupervision } from "@/components/features/solicitudes/ventanas/SupervisionVentana";
import { useSession } from "@/components/session/SessionProvider";
import { FiguraPersona } from "@/components/ui/FiguraPersona";
import { FilterMenu, type FilterGroup } from "@/components/ui/FilterMenu";
import { ListaCuadricula, type ColumnaLista } from "@/components/ui/ListaCuadricula";
import { ActionMenu, type MenuItem } from "@/components/ui/Overlay";
import { PageHeader, Toolbar } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { useResource } from "@/lib/client/store";
import { haceCuantoCorto } from "@/lib/client/tiempo";
import type { ApiRecord } from "@/lib/client/types";
import { formatearFechaHora } from "@/lib/shared/fechas";

/*
 * "Por supervisar" (Fase 2). Lo que captura una persona supervisada (alcance
 * "supervisado" o cuenta temporal con supervisor) queda pendiente del visto
 * bueno de su supervisor. Aqui el supervisor da el visto bueno (confirmando su
 * contrasena) o lo regresa con observaciones; quien lo capturo ve lo que le
 * regresaron para corregirlo. Ambas acciones quedan en la bitacora.
 * La ve toda persona con sesion: la bandeja solo trae lo que le toca.
 * Patron lista -> ventana: cada renglon (que, sobre que registro, quien y hace
 * cuanto) abre su ventana con el detalle y los botones de siempre.
 */

interface Bandeja {
  por_supervisar: ApiRecord[];
  regresados: ApiRecord[];
}

type Orden = "recientes" | "antiguos";

const KEYS = ["supervision", "muestras", "informes", "reactivos", "consumibles", "equipos", "mantenimientos", "dashboard"];

const COLUMNAS: ColumnaLista[] = [
  { clave: "que", titulo: "Qué", ancho: "minmax(200px,1.2fr)" },
  { clave: "registro", titulo: "Registro", ancho: "minmax(150px,0.9fr)" },
  { clave: "quien", titulo: "Quién", ancho: "minmax(180px,1fr)" },
  { clave: "cuando", titulo: "Hace cuánto", ancho: "130px" },
];

function celdas(item: ElementoSupervision) {
  const pendiente = item.clase === "pendiente";
  return [
    <span key="q" className="flex items-center gap-2.5">
      <span aria-hidden="true" className={pendiente ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-warning-soft text-warning-text" : "flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-danger-soft text-danger"}>
        {pendiente ? <Eye size={18} weight="duotone" /> : <ArrowUUpLeft size={18} weight="duotone" />}
      </span>
      <span className="flex min-w-0 flex-col items-start gap-1">
        <span className="text-[14px] leading-tight font-semibold text-ink">{pendiente ? "Dar visto bueno" : "Corregir lo regresado"}</span>
        <Badge tone={pendiente ? "warning" : "danger"} dot>
          {pendiente ? "Pendiente" : "Regresado"}
        </Badge>
      </span>
    </span>,
    <span key="r" className="text-[13.5px] text-ink-2">
      {`${String(item.tipo || "Registro")} ${String(item.referencia || "")}`.trim()}
    </span>,
    pendiente && item.solicitado_por ? <FiguraPersona key="p" nombre={item.solicitado_por} conNombre /> : <span key="p" className="text-[13px] text-ink-4">{pendiente ? "—" : "Tú"}</span>,
    <span key="c" className="text-[13px] text-ink-2" title={item.solicitado_en ? formatearFechaHora(item.solicitado_en) : undefined}>
      {item.solicitado_en ? haceCuantoCorto(item.solicitado_en) : "—"}
    </span>,
  ];
}

export default function SupervisionPage() {
  const { token } = useSession();
  const [orden, setOrden] = useState<Orden>("recientes");
  const [tipo, setTipo] = useState("");
  const [abierta, setAbierta] = useState<number | null>(null);
  // Al dar visto bueno o regresar, la ventana se cierra (la bandeja ya cambio).
  const acciones = useAccionesSupervision(() => setAbierta(null));

  const resource = useResource<Bandeja>(
    KEYS,
    async () => {
      const data = await getJsonAuth(`${API_BASE_URL}/supervision`, token);
      return { por_supervisar: (data.por_supervisar || []) as ApiRecord[], regresados: (data.regresados || []) as ApiRecord[] };
    },
    { enabled: !!token },
  );

  const { pendientes, regresados, tipos } = useMemo(() => {
    const ordenar = (lista: ElementoSupervision[]) => [...lista].filter((i) => !tipo || String(i.tipo) === tipo).sort((a, b) => (orden === "recientes" ? String(b.solicitado_en || "").localeCompare(String(a.solicitado_en || "")) : String(a.solicitado_en || "").localeCompare(String(b.solicitado_en || ""))));
    const p = (resource.data?.por_supervisar || []).map((i) => ({ ...i, clase: "pendiente" }) as ElementoSupervision);
    const r = (resource.data?.regresados || []).map((i) => ({ ...i, clase: "regresado" }) as ElementoSupervision);
    return { pendientes: ordenar(p), regresados: ordenar(r), tipos: [...new Set([...p, ...r].map((i) => String(i.tipo || "")).filter(Boolean))].sort() };
  }, [resource.data, orden, tipo]);
  const secuencia = useMemo(() => [...pendientes, ...regresados], [pendientes, regresados]);

  const menuFor = (item: ElementoSupervision): MenuItem[] => {
    if (item.clase !== "pendiente") return [];
    const datos = { tabla: String(item.tabla), id: item.id, tipo: String(item.tipo || ""), referencia: String(item.referencia || "") };
    return [
      { label: "Dar visto bueno…", icon: <SealCheck size={16} weight="duotone" />, tone: "brand", onSelect: () => acciones.vistoBueno(datos) },
      { label: "Regresar…", icon: <ArrowUUpLeft size={16} weight="duotone" />, tone: "danger", onSelect: () => acciones.regresar(datos) },
    ];
  };

  const groups: FilterGroup[] = tipos.length > 1 ? [{ key: "tipo", label: "Registro", value: tipo, defaultValue: "", onChange: setTipo, options: [{ value: "", label: "Todos" }, ...tipos.map((t) => ({ value: t, label: t }))] }] : [];
  const ordenar: FilterGroup[] = [
    { key: "orden", label: "Ordenar por", value: orden, defaultValue: "recientes", showDefault: true, onChange: (v) => setOrden(v as Orden), options: [{ value: "recientes", label: "Más recientes" }, { value: "antiguos", label: "Más antiguos" }] },
  ];

  const lista = (titulo: string, id: string, filas: ElementoSupervision[], vacio: { titulo: string; descripcion: string }) => (
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
        clave={(item) => `${item.clase}-${String(item.tabla)}-${String(item.id)}`}
        onAbrir={(item) => setAbierta(secuencia.indexOf(item))}
        activa={(item) => abierta !== null && secuencia[abierta] === item}
        celdas={celdas}
        extremo={(item) => {
          const menu = menuFor(item);
          return <span className="w-9">{menu.length ? <ActionMenu items={menu} header={`${String(item.tipo || "")} ${String(item.referencia || "")}`} /> : null}</span>;
        }}
        anchoExtremo="52px"
        propsFila={(item) => ({ "data-supervision": `${String(item.tabla)}-${String(item.id)}` })}
        vacio={{ icono: <CheckCircle size={22} weight="duotone" />, titulo: vacio.titulo, descripcion: vacio.descripcion }}
      />
    </section>
  );

  return (
    <PageBody>
      <PageHeader title="Por supervisar" description="Registros capturados bajo supervisión: no avanzan (no se cierran, no se revisan ni aprueban y no sirven de origen) hasta el visto bueno del supervisor." />

      <Toolbar>
        <FilterMenu groups={groups} gruposFinales={ordenar} />
      </Toolbar>

      {lista("Pendientes de tu visto bueno", "sup-pendientes", pendientes, { titulo: "Nada pendiente de tu visto bueno", descripcion: "Cuando una persona que supervisas capture un registro, aparecerá aquí." })}
      {regresados.length ? lista("Regresados a ti", "sup-regresados", regresados, { titulo: "Nada regresado", descripcion: "" }) : null}

      <SupervisionVentana items={secuencia} indice={abierta} onIndice={setAbierta} onCerrar={() => setAbierta(null)} acciones={acciones} />
      {acciones.dialogo}
    </PageBody>
  );
}
