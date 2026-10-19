"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, WarningDiamond } from "@phosphor-icons/react";
import { EstadoIncidencia, EstadoNc } from "@/components/features/calidad/comun";
import { reportarIncidencia, usePuedeReportar } from "@/components/features/calidad/ReportarIncidencia";
import { FolioChip } from "@/components/features/samples/status";
import { PageBody } from "@/components/shell/AppShell";
import { RequireModule } from "@/components/session/RequireModule";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { DateInput } from "@/components/ui/DateInput";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { msg } from "@/lib/client/mensajes";
import { FilterMenu, type FilterGroup, type FilterToggle } from "@/components/ui/FilterMenu";
import { FiguraPersona } from "@/components/ui/FiguraPersona";
import { ListaCuadricula, type ColumnaLista } from "@/components/ui/ListaCuadricula";
import { IncidenciaVentana, NcVentana } from "@/components/features/calidad/ventanas/CalidadVentanas";
import { IconoCalidad } from "@/components/features/calidad/ventanas/iconos";
import { Sheet } from "@/components/ui/Overlay";
import { PageHeader, SearchInput, Toolbar } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Primitives";
import { FranjaPendientes } from "@/components/features/solicitudes/Solicitudes";
import { StatusFlag } from "@/components/ui/StatusFlag";
import { API_BASE_URL, getJsonAuth, sendJsonAuth } from "@/lib/client/api";
import { fmt, fmtDateTime } from "@/lib/client/format";
import { useDebouncedValue, useInitialParam, useParamChange, useParamsChange } from "@/lib/client/hooks";
import { usePersonal } from "@/lib/client/personal";
import { invalidate, useResource } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { CLASIFICACION_NC_LABEL, CLASIFICACIONES_NC, ESTADOS_INCIDENCIA, ESTADOS_NC, ORIGEN_AUTOMATICO_LABEL, ORIGENES_NC, TIPO_INCIDENCIA_LABEL, TIPOS_INCIDENCIA } from "@/lib/shared/calidad";
import { formatearFechaCorta, hoyLocal, sumarDias } from "@/lib/shared/fechas";

/*
 * Calidad › Incidencias y NC: una sola lista con incidencias y no
 * conformidades juntas (de la mas reciente a la mas antigua), con busqueda
 * y filtros. Con alcance "incidencias" el servidor entrega solo lo propio
 * (incidencias reportadas por la persona y NC donde es responsable). Las
 * acciones correctivas se gestionan dentro de cada NC.
 */

const COLUMNAS: ColumnaLista[] = [
  { clave: "registro", titulo: "Registro", ancho: "minmax(230px,1.1fr)" },
  { clave: "descripcion", titulo: "Qué pasó", ancho: "minmax(220px,1.7fr)" },
  { clave: "estado", titulo: "Estado", ancho: "minmax(180px,1fr)" },
  { clave: "persona", titulo: "Persona", ancho: "minmax(170px,0.9fr)" },
  { clave: "fecha", titulo: "Fecha", ancho: "110px" },
];

export default function CalidadIncidenciasPage() {
  return (
    <PageBody>
      <PageHeader title="Incidencias y no conformidades" description="Reporte y evaluación de incidencias, no conformidades con análisis de causa, acciones correctivas y su eficacia (ISO/IEC 17025 7.10 y 8.7)." />
      <RequireModule modules="calidad" ctx={{ objeto: "incidencia" }}>
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <Contenido />
        </Suspense>
      </RequireModule>
    </PageBody>
  );
}

/* ---------- Filtros ---------- */

type Periodo = "hoy" | "7" | "30" | "todo" | "rango";
const PERIODOS: Array<{ value: Periodo; label: string }> = [
  { value: "hoy", label: "Hoy" },
  { value: "7", label: "Últimos 7 días" },
  { value: "30", label: "Últimos 30 días" },
  { value: "todo", label: "Todo" },
  { value: "rango", label: "Personalizado" },
];
type Orden = "recientes" | "antiguos" | "folio";

const ETAPAS_NC = ["abierta", "en_analisis", "acciones_en_curso", "en_verificacion", "cerrada"];
const ESTADOS_INC = ["reportada", "en_evaluacion", "cerrada_sin_nc", "escalada_a_nc"];
const SITUACIONES = [
  { value: "vencidas", label: "Con acciones vencidas" },
  { value: "suspension", label: "Con suspensión activa" },
  { value: "retenido", label: "Con informe retenido" },
  { value: "automatica", label: "Creadas automáticamente" },
];

interface FiltrosUrl {
  tipos: string[];
  estadoInc: string[];
  etapaNc: string[];
  mias: string[];
  situacion: string[];
}

const csv = (valor: string | null): string[] => (valor ? valor.split(",").map((v) => v.trim()).filter(Boolean) : []);
const alternar = (lista: string[], valor: string, activo: boolean): string[] => (activo ? (lista.includes(valor) ? lista : [...lista, valor]) : lista.filter((v) => v !== valor));

/* Parametros de la direccion (incluidos los de las pestañas antiguas: tab, estado, filtro, mias=1) -> filtros. */
function filtrosDeUrl(params: URLSearchParams): FiltrosUrl {
  const tab = params.get("tab") || "";
  let tipos = csv(params.get("tipos"));
  let estadoInc = csv(params.get("estado_inc"));
  let etapaNc = csv(params.get("etapa_nc"));
  let mias = csv(params.get("mias"));
  const situacion = csv(params.get("situacion"));
  if (tab === "incidencias") tipos = ["incidencia"];
  else if (tab === "nc" || tab === "acciones") tipos = ["nc"];
  if (params.get("filtro") === "por_evaluar") estadoInc = ["reportada", "en_evaluacion"];
  const estadoAntiguo = params.get("estado") || "";
  if (estadoAntiguo === "abiertas") etapaNc = ETAPAS_NC.filter((e) => e !== "cerrada");
  else if (ETAPAS_NC.includes(estadoAntiguo)) etapaNc = [estadoAntiguo];
  if (mias.includes("1")) mias = [tab === "nc" || tab === "acciones" ? "responsable" : "reportados"];
  return { tipos, estadoInc, etapaNc, mias: mias.filter((m) => m === "reportados" || m === "responsable"), situacion: situacion.filter((s) => SITUACIONES.some((o) => o.value === s)) };
}

const hayParametrosAntiguos = (params: URLSearchParams) => params.has("tab") || params.has("estado") || params.has("filtro") || params.get("mias") === "1";

function urlCanonica(f: FiltrosUrl, buscar: string): string {
  const q = new URLSearchParams();
  if (f.tipos.length) q.set("tipos", f.tipos.join(","));
  if (f.estadoInc.length) q.set("estado_inc", f.estadoInc.join(","));
  if (f.etapaNc.length) q.set("etapa_nc", f.etapaNc.join(","));
  if (f.mias.length) q.set("mias", f.mias.join(","));
  if (f.situacion.length) q.set("situacion", f.situacion.join(","));
  if (buscar) q.set("buscar", buscar);
  const texto = q.toString();
  return texto ? `?${texto}` : window.location.pathname;
}

/* Descripcion breve (maximo 2 lineas; la completa sale en el tooltip y esta en la ventana). */
function Breve({ texto }: { texto: unknown }) {
  const completo = String(texto || "");
  return (
    <span className="line-clamp-2 break-words text-sm leading-normal text-ink-2" title={completo || undefined}>
      {completo}
    </span>
  );
}

function Contenido() {
  const { token, can } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const puedeReportar = usePuedeReportar();
  const [search, setSearch] = useState(useInitialParam("buscar"));
  useParamChange("buscar", setSearch);
  const [inicial] = useState(() => filtrosDeUrl(params));
  const [tipos, setTipos] = useState<string[]>(inicial.tipos);
  const [estadoInc, setEstadoInc] = useState<string[]>(inicial.estadoInc);
  const [etapaNc, setEtapaNc] = useState<string[]>(inicial.etapaNc);
  const [tipoInc, setTipoInc] = useState<string[]>([]);
  const [clasificacion, setClasificacion] = useState<string[]>([]);
  const [mias, setMias] = useState<string[]>(inicial.mias);
  const [situacion, setSituacion] = useState<string[]>(inicial.situacion);
  const [periodo, setPeriodo] = useState<Periodo>("todo");
  const [desdeRango, setDesdeRango] = useState("");
  const [hastaRango, setHastaRango] = useState("");
  const [anuladas, setAnuladas] = useState(false);
  const [orden, setOrden] = useState<Orden>("recientes");
  const [nueva, setNueva] = useState(false);
  const [abierta, setAbierta] = useState<number | null>(null);
  const debounced = useDebouncedValue(search);

  /* Enlaces de otras pantallas (avisos, busqueda, fichas) y rutas antiguas: llevan a esta lista con el filtro que corresponde. */
  useParamsChange(["tipos", "estado_inc", "etapa_nc", "mias", "situacion", "tab", "estado", "filtro"], () => {
    const f = filtrosDeUrl(params);
    setTipos(f.tipos);
    setEstadoInc(f.estadoInc);
    setEtapaNc(f.etapaNc);
    setMias(f.mias);
    setSituacion(f.situacion);
  });
  const antiguos = hayParametrosAntiguos(params);
  useEffect(() => {
    if (antiguos) router.replace(urlCanonica(filtrosDeUrl(params), params.get("buscar") || ""), { scroll: false });
  }, [antiguos, params, router]);

  const hoy = hoyLocal();
  const [desde, hasta] = periodo === "hoy" ? [hoy, hoy] : periodo === "7" ? [sumarDias(hoy, -6), hoy] : periodo === "30" ? [sumarDias(hoy, -29), hoy] : periodo === "rango" ? [desdeRango, hastaRango] : ["", ""];
  const query = new URLSearchParams({ search: debounced.trim() });
  const poner = (clave: string, valores: string[]) => valores.length && query.set(clave, valores.join(","));
  poner("tipos", tipos);
  poner("estado_inc", estadoInc);
  poner("etapa_nc", etapaNc);
  poner("tipo_inc", tipoInc);
  poner("clasificacion", clasificacion);
  poner("mias", mias);
  poner("situacion", situacion);
  if (desde) query.set("desde", desde);
  if (hasta) query.set("hasta", hasta);
  if (anuladas) query.set("anuladas", "1");
  if (orden !== "recientes") query.set("orden", orden);
  const recurso = useResource<ApiRecord>("calidad", () => getJsonAuth(`${API_BASE_URL}/calidad/lista?${query.toString()}`, token), { enabled: !!token, deps: [query.toString()] });
  const filas = (recurso.data?.items as ApiRecord[] | undefined) ?? null;
  const puedeCrearNc = can("calidad", "R", { objeto: "nc" }) || can("calidad", "G", { objeto: "nc" });

  const interruptor = (group: string, clave: string, lista: string[], set: (v: string[]) => void, options: Array<{ value: string; label: string }>): FilterToggle[] =>
    options.map((o) => ({ key: `${clave}-${o.value}`, label: o.label, group, checked: lista.includes(o.value), onChange: (on: boolean) => set(alternar(lista, o.value, on)) }));
  const toggles: FilterToggle[] = [
    ...interruptor("Tipo de registro", "tipo", tipos, setTipos, [{ value: "incidencia", label: "Incidencias" }, { value: "nc", label: "No conformidades" }]),
    ...interruptor("Estado de la incidencia", "estinc", estadoInc, setEstadoInc, ESTADOS_INC.map((value) => ({ value, label: ESTADOS_INCIDENCIA[value].label }))),
    ...interruptor("Etapa de la no conformidad", "etapa", etapaNc, setEtapaNc, ETAPAS_NC.map((value) => ({ value, label: ESTADOS_NC[value].label }))),
    ...interruptor("Tipo de incidencia", "tipoinc", tipoInc, setTipoInc, TIPOS_INCIDENCIA),
    ...interruptor("Clasificación de la NC", "clasif", clasificacion, setClasificacion, CLASIFICACIONES_NC),
    ...interruptor("Mis registros", "mias", mias, setMias, [{ value: "reportados", label: "Reportados por mí" }, { value: "responsable", label: "Donde soy responsable" }]),
    ...interruptor("Situación", "sit", situacion, setSituacion, SITUACIONES),
    { key: "anuladas", label: "Mostrar anuladas", group: "Vista", checked: anuladas, onChange: setAnuladas },
  ];
  const grupoPeriodo: FilterGroup = {
    key: "periodo",
    label: "Periodo",
    value: periodo,
    defaultValue: "todo",
    showDefault: true,
    options: PERIODOS,
    onChange: (v) => setPeriodo(v as Periodo),
    extra:
      periodo === "rango" ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-ink-3">
            Desde
            <DateInput id="cal-desde" small value={desdeRango} onChange={setDesdeRango} aria-label="Desde" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-3">
            Hasta
            <DateInput id="cal-hasta" small value={hastaRango} onChange={setHastaRango} aria-label="Hasta" />
          </label>
        </div>
      ) : undefined,
  };
  const grupoOrden: FilterGroup = { key: "orden", label: "Ordenar por", value: orden, defaultValue: "recientes", showDefault: true, onChange: (v) => setOrden(v as Orden), options: [{ value: "recientes", label: "Más recientes" }, { value: "antiguos", label: "Más antiguos" }, { value: "folio", label: "Folio" }] };

  /* Cada tipo abre su propia ventana; "anterior/siguiente" recorre los registros de ese tipo. */
  const seleccionada = abierta !== null && filas ? filas[abierta] : null;
  const idsDe = (registro: string) => (filas || []).filter((f) => f.registro === registro).map((f) => Number(f.id));
  const idsInc = idsDe("incidencia");
  const idsNc = idsDe("nc");
  const moverA = (registro: string, ids: number[]) => (i: number) => setAbierta((filas || []).findIndex((f) => f.registro === registro && Number(f.id) === ids[i]));
  const filtrando = !!(search || tipos.length || estadoInc.length || etapaNc.length || tipoInc.length || clasificacion.length || mias.length || situacion.length || periodo !== "todo" || anuladas);

  return (
    <>
      <FranjaPendientes entidades={["incidencias", "no_conformidades"]} grupo="calidad" />
      <Toolbar
        end={
          <>
            {puedeCrearNc ? (
              <Button variant="secondary" icon={<Plus size={16} weight="bold" />} onClick={() => setNueva(true)}>
                Nueva NC
              </Button>
            ) : null}
            {puedeReportar ? (
              <Button icon={<WarningDiamond size={16} />} onClick={() => reportarIncidencia()}>
                Reportar incidencia
              </Button>
            ) : null}
          </>
        }
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por folio, descripción, persona o requisito" className="min-w-0 flex-1 md:w-[340px] md:flex-none" />
        <FilterMenu toggles={toggles} gruposAntesDeVista={[grupoPeriodo]} gruposFinales={[grupoOrden]} vistaAlFinal />
      </Toolbar>
      <ListaCuadricula
        etiqueta="Incidencias y no conformidades"
        columnas={COLUMNAS}
        filas={filas}
        error={recurso.error}
        onReintentar={recurso.reload}
        clave={(item) => `${item.registro}-${item.id}`}
        onAbrir={(_, i) => setAbierta(i)}
        activa={(_, i) => abierta === i}
        celdas={(item) => (item.registro === "nc" ? celdasNc(item) : celdasIncidencia(item))}
        propsFila={(item) => ({ [item.registro === "nc" ? "data-nc" : "data-incidencia"]: String(item.id), "data-anulada": item.estado === "anulada" ? "1" : "0" })}
        anchoExtremo="16px"
        vacio={{ icono: <WarningDiamond size={20} />, titulo: filtrando ? "Sin coincidencias" : "Sin incidencias ni no conformidades", descripcion: filtrando ? "Ningún registro cumple los filtros elegidos." : "Aquí aparecen las incidencias reportadas (también las que genera el sistema) y las no conformidades que se abren al escalarlas o directamente." }}
      />
      <IncidenciaVentana ids={idsInc} indice={seleccionada?.registro === "incidencia" ? idsInc.indexOf(Number(seleccionada.id)) : null} onIndice={moverA("incidencia", idsInc)} onCerrar={() => setAbierta(null)} />
      <NcVentana ids={idsNc} indice={seleccionada?.registro === "nc" ? idsNc.indexOf(Number(seleccionada.id)) : null} onIndice={moverA("nc", idsNc)} onCerrar={() => setAbierta(null)} />
      {nueva ? <NuevaNcSheet onClose={() => setNueva(false)} /> : null}
    </>
  );
}

function celdasIncidencia(item: ApiRecord) {
  return [
    <span key="f" className="flex min-w-0 items-start gap-3">
      <IconoCalidad tipo={item.tipo} />
      <span className="flex min-w-0 flex-col gap-1">
        <FolioChip type="INC" num={item.folio_num} />
        <span className="text-sm font-medium text-ink">{TIPO_INCIDENCIA_LABEL[String(item.tipo)] || "Incidencia"}</span>
      </span>
    </span>,
    <Breve key="d" texto={item.descripcion} />,
    <span key="e" className="flex flex-wrap items-center gap-1.5">
      <EstadoIncidencia estado={item.estado} />
      {item.origen_automatico ? <StatusFlag kind="info" label="Automática" detail={`Generada automáticamente: ${ORIGEN_AUTOMATICO_LABEL[String(item.origen_automatico)] || ""}`} data-automatica /> : null}
      {item.nc_folio ? <FolioChip type="NC" num={item.nc_folio} /> : null}
    </span>,
    item.reportada_por ? <FiguraPersona key="r" id={item.reportada_por} nombre={item.reportada_nombre} conNombre /> : <span key="r" className="text-sm text-ink-3">{ORIGEN_AUTOMATICO_LABEL[String(item.origen_automatico)] ? "Sistema" : String(item.reportada_nombre || "—")}</span>,
    <span key="o" className="text-sm text-ink-2" title={fmtDateTime(item.fecha)}>
      {formatearFechaCorta(item.fecha)}
    </span>,
  ];
}

function celdasNc(item: ApiRecord) {
  const clasificacion = CLASIFICACION_NC_LABEL[String(item.clasificacion)];
  const vencidas = Number(item.acciones_vencidas);
  return [
    <span key="f" className="flex min-w-0 items-start gap-3">
      <IconoCalidad clase="nc" origen={item.origen} clasificacion={item.clasificacion} />
      <span className="flex min-w-0 flex-col gap-1">
        <FolioChip type="NC" num={item.folio_num} />
        <span className="text-sm font-medium text-ink">{clasificacion ? `No conformidad ${clasificacion.toLowerCase()}` : "No conformidad"}</span>
      </span>
    </span>,
    <Breve key="d" texto={item.descripcion} />,
    <span key="e" className="flex flex-wrap items-center gap-1.5">
      <EstadoNc estado={item.estado} />
      {vencidas ? <StatusFlag kind="error" label={vencidas === 1 ? "1 acción vencida" : `${fmt(vencidas)} acciones vencidas`} detail="Acciones correctivas con la fecha compromiso pasada" data-vencida /> : null}
      {Number(item.suspensiones_activas) ? <StatusFlag kind="bloqueo" label="Suspensión" detail="Hay un método o equipo suspendido por esta NC" data-suspension /> : null}
      {Number(item.retenciones_activas) ? <StatusFlag kind="bloqueo" label="Informe retenido" detail="Hay un informe retenido por esta NC" data-retenido /> : null}
      {Number(item.reaperturas) ? <StatusFlag kind="aviso" label={`${item.reaperturas} reapertura${Number(item.reaperturas) > 1 ? "s" : ""}`} detail="La verificación de eficacia resultó no eficaz y la NC volvió a análisis." data-reaperturas={String(item.reaperturas)} /> : null}
    </span>,
    item.responsable_id || item.responsable_nombre ? <FiguraPersona key="r" id={item.responsable_id} nombre={item.responsable_nombre} conNombre /> : <span key="r" className="text-sm text-ink-3">Sin nombrar</span>,
    <span key="o" className="text-sm text-ink-2" title={fmtDateTime(item.fecha)}>
      {formatearFechaCorta(item.fecha)}
    </span>,
  ];
}

function NuevaNcSheet({ onClose }: { onClose: () => void }) {
  const { token, can } = useSession();
  const router = useRouter();
  const personal = usePersonal();
  const [open, setOpen] = useState(true);
  const [origen, setOrigen] = useState("queja");
  const [descripcion, setDescripcion] = useState("");
  const [clasificacion, setClasificacion] = useState("");
  const [requisito, setRequisito] = useState("");
  const [responsable, setResponsable] = useState("");
  const [enviando, setEnviando] = useState(false);
  const cerrar = () => {
    setOpen(false);
    window.setTimeout(onClose, 250);
  };
  const v = useValidacion({
    titulo: "No se pudo abrir la NC",
    reglas: () => (descripcion.trim().length < 20 ? [{ campo: "nc-desc", mensaje: descripcion.trim() ? msg.minimo("La descripción", 20) : msg.escribe("la descripción de la no conformidad"), grupo: "Descripción" }] : []),
  });
  const crear = async () => {
    if (!v.validar()) return;
    setEnviando(true);
    try {
      const data = await sendJsonAuth("POST", `${API_BASE_URL}/calidad/nc`, token, { origen, descripcion, clasificacion: clasificacion || null, requisito_incumplido: requisito, responsable_id: responsable ? Number(responsable) : null });
      toast.success(String(data.message));
      invalidate("calidad");
      router.push(`/calidad/nc/${data.id}`);
    } catch (err) {
      v.errorServidor(err, { motivo: "nc-desc" });
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : cerrar())}
      title="Nueva no conformidad"
      description="Para una queja, un hallazgo de auditoría interna o de revisión. Las de una incidencia se abren al evaluarla."
      footer={
        <>
          <Button variant="secondary" onClick={cerrar}>
            Cancelar
          </Button>
          <Button onClick={crear} loading={enviando}>
            Abrir NC
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
      <div className="flex flex-col gap-5">
        <Field label="Origen" htmlFor="nc-origen" required>
          <Select id="nc-origen" value={origen} onChange={(event) => setOrigen(event.target.value)}>
            {ORIGENES_NC.filter((o) => o.value !== "incidencia").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Descripción" htmlFor="nc-desc" required hint="Al menos 20 caracteres.">
          <Textarea id="nc-desc" rows={4} value={descripcion} onChange={(event) => setDescripcion(event.target.value)} />
        </Field>
        <Field label="Requisito incumplido" htmlFor="nc-req" hint="Cláusula ISO, procedimiento o formato.">
          <Textarea id="nc-req" rows={2} value={requisito} onChange={(event) => setRequisito(event.target.value)} />
        </Field>
        <Field label="Clasificación" htmlFor="nc-clasif">
          <Select id="nc-clasif" value={clasificacion} onChange={(event) => setClasificacion(event.target.value)}>
            <option value="">Sin clasificar</option>
            {CLASIFICACIONES_NC.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label} — {c.hint}
              </option>
            ))}
          </Select>
        </Field>
        {can("calidad", "G", { objeto: "nc" }) ? (
        <Field label="Responsable" htmlFor="nc-resp" hint="Opcional; cambiarlo después pide motivo.">
          <Select id="nc-resp" value={responsable} onChange={(event) => setResponsable(event.target.value)}>
            <option value="">Sin nombrar</option>
            {personal.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
                {p.rol ? ` · ${p.rol}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        ) : null}
      </div>
      </ValidacionAmbito>
    </Sheet>
  );
}
