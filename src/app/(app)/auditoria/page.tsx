"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActividadDialog, agruparActividades, ListaActividades, usePersonas } from "@/components/features/audit/Actividades";
import { CATEGORIAS, type Categoria } from "@/components/features/audit/categorias";
import { Callout } from "@/components/features/samples/FormLayout";
import { PageBody } from "@/components/shell/AppShell";
import { RequireModule } from "@/components/session/RequireModule";
import { useSession } from "@/components/session/SessionProvider";
import { DateInput } from "@/components/ui/DateInput";
import { FilterMenu, type FilterGroup, type FilterToggle } from "@/components/ui/FilterMenu";
import { PageHeader, SearchInput, Toolbar } from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Primitives";
import { cn } from "@/components/ui/cn";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { fmt } from "@/lib/client/format";
import { useDebouncedValue, useInitialParam } from "@/lib/client/hooks";
import type { ApiRecord } from "@/lib/client/types";
import { hoyLocal, sumarDias } from "@/lib/shared/fechas";

/*
 * Auditoria: la actividad de la plataforma en lenguaje simple. Una barra con
 * el buscador y un boton "Filtros" (como en Muestras); la lista agrupada por
 * dia; al pulsar una actividad, su detalle en una ventana centrada. La
 * verificacion de la cadena de la bitacora corre en segundo plano y solo se
 * nota si encuentra un problema. La bitacora no se exporta (decision del
 * laboratorio). Solo interfaz: la bitacora, sus sellos, permisos y alcances
 * no cambian.
 */

type Periodo = "hoy" | "7" | "30" | "todo" | "rango";
const PERIODOS: Array<{ value: Periodo; label: string }> = [
  { value: "hoy", label: "Hoy" },
  { value: "7", label: "Últimos 7 días" },
  { value: "30", label: "Últimos 30 días" },
  { value: "todo", label: "Todo" },
  { value: "rango", label: "Personalizado" },
];

/* Areas de la plataforma y los registros que abarca cada una. */
const AREAS: Array<{ value: string; label: string; entidades: string[] }> = [
  { value: "muestras", label: "Muestras", entidades: ["muestras_recepcion", "muestras_procesamiento", "muestras_extraccion", "muestras_analisis"] },
  { value: "informes", label: "Informes", entidades: ["informes"] },
  { value: "inventario", label: "Inventario", entidades: ["reactivos", "consumibles"] },
  { value: "equipos", label: "Equipos", entidades: ["equipos", "mantenimientos", "reportes_mantenimiento"] },
  { value: "calidad", label: "Calidad", entidades: ["incidencias", "no_conformidades", "acciones_correctivas", "suspensiones", "respaldos", "auditoria"] },
  { value: "documentos", label: "Documentos SGC", entidades: ["sgc_documentos", "biblioteca_documentos", "biblioteca_categorias", "documentos_sgc"] },
  { value: "usuarios", label: "Usuarios y accesos", entidades: ["usuarios", "roles", "sesion"] },
];

const PAGINA = 60;

export default function AuditoriaPage() {
  return (
    <PageBody>
      <RequireModule modules="calidad">
        <Suspense fallback={<Skeleton className="h-[480px] rounded-card" />}>
          <AuditoriaContent />
        </Suspense>
      </RequireModule>
    </PageBody>
  );
}

/* Alterna un valor dentro de una lista (filtros de varias opciones). */
const alternar = <T,>(lista: T[], valor: T, encendido: boolean) => (encendido ? [...new Set([...lista, valor])] : lista.filter((v) => v !== valor));

function AuditoriaContent() {
  const { token } = useSession();
  const personas = usePersonas();
  // Desde otra pantalla ("Ver en Auditoría" de un documento): ?buscar=<clave>&area=documentos&periodo=todo.
  const buscarInicial = useInitialParam("buscar");
  const areaInicial = useInitialParam("area");
  const periodoInicial = useInitialParam("periodo");
  const [search, setSearch] = useState(buscarInicial);
  const [periodo, setPeriodo] = useState<Periodo>(() => (PERIODOS.some((p) => p.value === periodoInicial) ? (periodoInicial as Periodo) : "30"));
  const [desdeRango, setDesdeRango] = useState("");
  const [hastaRango, setHastaRango] = useState("");
  const [usuarios, setUsuarios] = useState<string[]>([]);
  const [tipos, setTipos] = useState<Categoria[]>([]);
  const [areas, setAreas] = useState<string[]>(() => (AREAS.some((a) => a.value === areaInicial) ? [areaInicial] : []));
  const [conAccesos, setConAccesos] = useState(false);
  const [registros, setRegistros] = useState<ApiRecord[] | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [seleccion, setSeleccion] = useState<number | null>(null);
  const [alterada, setAlterada] = useState(false);
  const [cuentas, setCuentas] = useState<ApiRecord[]>([]);
  const debounced = useDebouncedValue(search);
  const centinela = useRef<HTMLDivElement>(null);

  const hoy = hoyLocal();
  const { desde, hasta } = useMemo(() => {
    if (periodo === "hoy") return { desde: hoy, hasta: hoy };
    if (periodo === "7") return { desde: sumarDias(hoy, -6), hasta: hoy };
    if (periodo === "30") return { desde: sumarDias(hoy, -29), hasta: hoy };
    if (periodo === "rango") return { desde: desdeRango, hasta: hastaRango };
    return { desde: "", hasta: "" };
  }, [periodo, hoy, desdeRango, hastaRango]);

  const filtros = useMemo(() => {
    const params = new URLSearchParams({ search: debounced.trim(), desde, hasta });
    if (usuarios.length) params.set("usuarios", usuarios.join(","));
    if (tipos.length) params.set("acciones", CATEGORIAS.filter((c) => tipos.includes(c.value)).flatMap((c) => c.acciones).join(","));
    if (areas.length) params.set("entidades", AREAS.filter((a) => areas.includes(a.value)).flatMap((a) => a.entidades).join(","));
    if (!conAccesos) params.set("sin_accesos", "1");
    return params;
  }, [debounced, desde, hasta, usuarios, tipos, areas, conAccesos]);
  const claveFiltros = filtros.toString();

  const pedir = useCallback(
    async (antesDe?: number) => {
      const params = new URLSearchParams(filtros);
      params.set("limit", String(PAGINA));
      if (antesDe) params.set("antes_de", String(antesDe));
      const data = await getJsonAuth(`${API_BASE_URL}/audit?${params.toString()}`, token);
      return (data.items || []) as ApiRecord[];
    },
    [filtros, token],
  );

  // Primera pagina: se reinicia al cambiar cualquier filtro.
  useEffect(() => {
    if (!token) return;
    let cancelado = false;
    (async () => {
      await Promise.resolve();
      if (cancelado) return;
      setRegistros(null);
      setError(null);
      setSeleccion(null);
      try {
        const items = await pedir();
        if (cancelado) return;
        setRegistros(items);
        setHayMas(items.length >= PAGINA);
      } catch (err) {
        if (!cancelado) setError(err instanceof Error ? err.message : "No se pudo cargar la actividad");
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [token, claveFiltros, pedir, recarga]);

  const cargarMas = useCallback(async () => {
    if (!registros?.length || cargandoMas || !hayMas) return;
    setCargandoMas(true);
    try {
      const items = await pedir(Number(registros[registros.length - 1].id));
      setRegistros((prev) => [...(prev || []), ...items]);
      setHayMas(items.length >= PAGINA);
    } catch {
      setHayMas(false);
    } finally {
      setCargandoMas(false);
    }
  }, [registros, cargandoMas, hayMas, pedir]);

  // Carga progresiva: al acercarse al final de la lista se pide la pagina siguiente.
  useEffect(() => {
    const el = centinela.current;
    if (!el || !hayMas) return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void cargarMas(), { rootMargin: "400px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [cargarMas, hayMas]);

  // Al abrir: verificacion de la cadena en segundo plano (solo se nota si falla) y personas para el filtro.
  useEffect(() => {
    if (!token) return;
    let cancelado = false;
    getJsonAuth(`${API_BASE_URL}/audit/verify`, token)
      .then((data) => !cancelado && setAlterada(data.ok === false))
      .catch(() => undefined);
    getJsonAuth(`${API_BASE_URL}/cuentas/activas`, token)
      .then((data) => !cancelado && setCuentas((data.items || []) as ApiRecord[]))
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [token]);

  const grupos = useMemo(() => agruparActividades(registros || [], { personas }), [registros, personas]);

  const groups: FilterGroup[] = [
    {
      key: "periodo",
      label: "Periodo",
      value: periodo,
      defaultValue: "30",
      showDefault: true,
      options: PERIODOS,
      onChange: (v) => setPeriodo(v as Periodo),
      extra:
        periodo === "rango" ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[12px] text-ink-3">
              Desde
              <DateInput id="aud-desde" small value={desdeRango} onChange={setDesdeRango} aria-label="Desde" />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-ink-3">
              Hasta
              <DateInput id="aud-hasta" small value={hastaRango} onChange={setHastaRango} aria-label="Hasta" />
            </label>
          </div>
        ) : undefined,
    },
  ];
  const toggles: FilterToggle[] = [
    ...cuentas.map((c) => ({ key: `persona-${String(c.email)}`, label: String(c.nombre || c.email), group: "Personas", checked: usuarios.includes(String(c.email)), onChange: (on: boolean) => setUsuarios((l) => alternar(l, String(c.email), on)) })),
    ...CATEGORIAS.map((c) => ({ key: `tipo-${c.value}`, label: c.label, group: "Tipo de actividad", checked: tipos.includes(c.value), onChange: (on: boolean) => setTipos((l) => alternar(l, c.value, on)) })),
    ...AREAS.map((a) => ({ key: `area-${a.value}`, label: a.label, group: "Área", checked: areas.includes(a.value), onChange: (on: boolean) => setAreas((l) => alternar(l, a.value, on)) })),
    { key: "accesos", label: "Mostrar inicios de sesión", group: "Vista", checked: conAccesos, onChange: setConAccesos },
  ];
  const filtrando = !!search.trim() || periodo !== "30" || usuarios.length > 0 || tipos.length > 0 || areas.length > 0 || conAccesos;

  return (
    <>
      <PageHeader title="Auditoría" description="Quién hizo qué, cuándo y por qué en la plataforma." />

      {alterada ? (
        <Callout tone="danger" title="Se detectó un posible cambio no autorizado en el registro de actividad" className="mb-4">
          Avisa a la Coordinación de Mejora Continua.
        </Callout>
      ) : null}

      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por folio, persona o motivo" className="w-full md:w-[340px]" />
        <FilterMenu groups={groups} toggles={toggles} vistaAlFinal />
      </Toolbar>

      <div className="overflow-hidden rounded-card bg-surface shadow-card" aria-label="Actividades">
        {error ? (
          <ErrorState message={error} onRetry={() => setRecarga((n) => n + 1)} />
        ) : !registros ? (
          <EsqueletoLista filas={8} />
        ) : !grupos.length ? (
          <EmptyState title="Sin actividad" description={filtrando ? "No hay actividades con estos filtros." : "Todavía no hay actividad en este periodo."} />
        ) : (
          <>
            <ListaActividades grupos={grupos} seleccion={seleccion} onAbrir={setSeleccion} />
            <div ref={centinela} />
            {cargandoMas ? <EsqueletoLista filas={3} /> : null}
          </>
        )}
      </div>
      {registros && grupos.length ? (
        <p className="tnum mt-2 px-1 text-[12px] text-ink-4" data-audit-resumen>
          {fmt(registros.length)}
          {hayMas ? "+" : ""} {registros.length === 1 ? "actividad" : "actividades"}
        </p>
      ) : null}

      <ActividadDialog grupos={grupos} indice={seleccion} onIndice={setSeleccion} onCerrar={() => setSeleccion(null)} />
    </>
  );
}

function EsqueletoLista({ filas }: { filas: number }) {
  return (
    <div className="flex flex-col divide-y divide-line" aria-hidden="true">
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className={cn("h-3.5", i % 3 === 0 ? "w-3/4" : i % 3 === 1 ? "w-2/3" : "w-1/2")} />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
