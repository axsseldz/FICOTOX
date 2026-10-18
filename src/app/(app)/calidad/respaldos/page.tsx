"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Archive, CaretDown, Database, Flask, Key, Plus, ShieldCheck } from "@phosphor-icons/react";
import { ActaVentana, RespaldoVentana } from "@/components/features/respaldos/RespaldoVentana";
import { archivosTexto, ConfirmarRespaldo, FRASE_OCUPADO, Girando, hace, InsigniaVerificacion, MarcaProtegido, mb, TIPOS_RESPALDO } from "@/components/features/respaldos/comun";
import { Callout } from "@/components/features/samples/FormLayout";
import { TONO } from "@/components/features/inicio/pendientes";
import { PageBody } from "@/components/shell/AppShell";
import { RequireModule } from "@/components/session/RequireModule";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { DateInput } from "@/components/ui/DateInput";
import { FilterMenu, type FilterGroup } from "@/components/ui/FilterMenu";
import { ListaCuadricula, type ColumnaLista } from "@/components/ui/ListaCuadricula";
import { ActionMenu, type MenuItem } from "@/components/ui/Overlay";
import { PageHeader, SearchInput, Toolbar } from "@/components/ui/PageHeader";
import { Badge, Skeleton } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth, sendJsonAuth } from "@/lib/client/api";
import { fmtDateTime, normalizeText } from "@/lib/client/format";
import { useDebouncedValue } from "@/lib/client/hooks";
import { haceCuantoCorto } from "@/lib/client/tiempo";
import { invalidate, useResource } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { fechaSola, formatearFecha, hoyLocal, sumarDias } from "@/lib/shared/fechas";

/*
 * Calidad › Respaldos: las copias de seguridad de la plataforma y las pruebas
 * que comprueban que se pueden recuperar. Quien tiene respaldos:V lo ve todo en
 * solo lectura; quien tiene respaldos:G crea respaldos y prueba la restauración
 * (con su contraseña). La recuperación real se hace fuera de la plataforma.
 */

export default function RespaldosPage() {
  return (
    <PageBody>
      <PageHeader title="Respaldos" description="Copias de seguridad de toda la información de la plataforma y las pruebas que comprueban que se pueden recuperar." />
      <RequireModule modules="respaldos">
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <Contenido />
        </Suspense>
      </RequireModule>
    </PageBody>
  );
}

const COLUMNAS: ColumnaLista[] = [
  { clave: "fecha", titulo: "Fecha y hora", ancho: "minmax(170px,1.1fr)" },
  { clave: "tipo", titulo: "Tipo", ancho: "minmax(150px,1fr)" },
  { clave: "tamano", titulo: "Tamaño", ancho: "96px" },
  { clave: "contenido", titulo: "Contenido", ancho: "minmax(150px,1fr)" },
  { clave: "llave", titulo: "Llave", ancho: "110px" },
  { clave: "verificacion", titulo: "Verificación", ancho: "minmax(190px,1.1fr)" },
];

type Periodo = "hoy" | "7" | "30" | "todo" | "rango";
const PERIODOS: Array<{ value: Periodo; label: string }> = [
  { value: "hoy", label: "Hoy" },
  { value: "7", label: "Últimos 7 días" },
  { value: "30", label: "Últimos 30 días" },
  { value: "todo", label: "Todo" },
  { value: "rango", label: "Personalizado" },
];
type Orden = "recientes" | "antiguos" | "tamano";

/* Píldora pequeña y discreta, del mismo estilo que las del Inicio. */
function Pildora({ tono, icono, children, dato }: { tono: "success" | "warning" | "danger" | "neutral"; icono: React.ReactNode; children: React.ReactNode; dato: string }) {
  const circulo = tono === "success" ? "bg-success-soft text-success-text" : tono === "neutral" ? "bg-surface-3 text-ink-3" : TONO[tono].circulo;
  return (
    <li data-estado={dato} className="inline-flex h-8 items-center gap-2 rounded-full bg-surface pr-3 pl-1.5 text-[12.5px] text-ink-2 ring-1 ring-line">
      <span aria-hidden="true" className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[12px] [&>svg]:h-[1em] [&>svg]:w-[1em]", circulo)}>
        {icono}
      </span>
      {children}
    </li>
  );
}

function Contenido() {
  const { token, can } = useSession();
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search);
  const [tipo, setTipo] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>("todo");
  const [desdeRango, setDesdeRango] = useState("");
  const [hastaRango, setHastaRango] = useState("");
  const [verificacion, setVerificacion] = useState("");
  const [orden, setOrden] = useState<Orden>("recientes");
  const [abierto, setAbierto] = useState<number | null>(null);
  const [acta, setActa] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<null | { tipo: "crear" } | { tipo: "probar"; id: string }>(null);
  const [trabajo, setTrabajo] = useState<ApiRecord | null>(null);
  const [resultado, setResultado] = useState<ApiRecord | null>(null);
  const miTrabajo = useRef<number | null>(null);
  // "Ahora" para los colores de las píldoras; se refresca cada minuto.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setAhora(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const recurso = useResource<ApiRecord>("respaldos", () => getJsonAuth(`${API_BASE_URL}/respaldos`, token), { enabled: !!token });
  const datos = recurso.data;
  const respaldos = useMemo(() => ((datos?.respaldos || []) as ApiRecord[]), [datos]);
  const puedeGestionar = !!datos?.puede_gestionar && can("respaldos", "G");
  const mysql = datos?.motor === "mysql";

  // El trabajo que ya estaba en curso al abrir la pantalla (de otra persona o de otra sesión) cuenta como el actual.
  const iniciales = datos?.trabajo as ApiRecord | null | undefined;
  const actual = trabajo ?? (iniciales?.estado === "en_curso" ? iniciales : null);

  // Mientras hay un respaldo o una prueba en curso se consulta su avance; al terminar se avisa y se recarga la lista.
  const enCurso = actual?.estado === "en_curso";
  const recargar = recurso.reload;
  useEffect(() => {
    if (!enCurso || !token) return;
    let vivo = true;
    const consultar = async () => {
      try {
        const data = await getJsonAuth(`${API_BASE_URL}/respaldos/estado`, token);
        const nuevo = data.trabajo as ApiRecord | null;
        if (!vivo || !nuevo) return;
        setTrabajo(nuevo);
        if (nuevo.estado !== "en_curso") {
          invalidate("respaldos");
          void recargar();
          if (miTrabajo.current === Number(nuevo.id)) {
            miTrabajo.current = null;
            if (nuevo.estado === "fallido") toast.error(String(nuevo.mensaje || "No se pudo terminar"));
            else if (nuevo.tipo === "respaldo") toast.success("Respaldo creado");
            else toast[nuevo.resultado === "aprobada" ? "success" : "error"](nuevo.resultado === "aprobada" ? "La prueba salió bien" : "La prueba encontró problemas");
            if (nuevo.tipo === "prueba") setResultado(nuevo);
          }
        }
      } catch {
        /* se reintenta en el siguiente ciclo */
      }
    };
    const timer = window.setInterval(consultar, 1300);
    void consultar();
    return () => {
      vivo = false;
      window.clearInterval(timer);
    };
  }, [enCurso, token, recargar]);

  const hoy = hoyLocal();
  const [desde, hasta] = periodo === "hoy" ? [hoy, hoy] : periodo === "7" ? [sumarDias(hoy, -6), hoy] : periodo === "30" ? [sumarDias(hoy, -29), hoy] : periodo === "rango" ? [desdeRango, hastaRango] : ["", ""];
  const filas = useMemo(() => {
    const term = normalizeText(debounced.trim());
    const lista = respaldos.filter((r) => {
      if (tipo && r.tipo !== tipo) return false;
      const dia = fechaSola(r.creado_en);
      if (desde && dia < desde) return false;
      if (hasta && dia > hasta) return false;
      const res = r.verificacion?.resultado;
      if (verificacion === "probados" && res !== "aprobada") return false;
      if (verificacion === "sin_probar" && res) return false;
      if (verificacion === "fallidos" && res !== "fallida") return false;
      if (term) {
        const texto = normalizeText(`${fmtDateTime(r.creado_en)} ${formatearFecha(r.creado_en)} ${String(r.nota || "")} ${TIPOS_RESPALDO[String(r.tipo)] || ""}`);
        if (!texto.includes(term)) return false;
      }
      return true;
    });
    const por = (a: ApiRecord, b: ApiRecord) => String(b.id).localeCompare(String(a.id));
    return [...lista].sort(orden === "antiguos" ? (a, b) => por(b, a) : orden === "tamano" ? (a, b) => Number(b.tamano || 0) - Number(a.tamano || 0) : por);
  }, [respaldos, debounced, tipo, desde, hasta, verificacion, orden]);

  const groups: FilterGroup[] = [
    { key: "tipo", label: "Tipo", value: tipo, defaultValue: "", onChange: setTipo, options: Object.entries(TIPOS_RESPALDO).map(([value, label]) => ({ value, label })) },
    {
      key: "periodo",
      label: "Periodo",
      value: periodo,
      defaultValue: "todo",
      showDefault: true,
      onChange: (v) => setPeriodo(v as Periodo),
      options: PERIODOS,
      extra:
        periodo === "rango" ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[12px] text-ink-3">
              Desde
              <DateInput id="resp-desde" small value={desdeRango} onChange={setDesdeRango} aria-label="Desde" />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-ink-3">
              Hasta
              <DateInput id="resp-hasta" small value={hastaRango} onChange={setHastaRango} aria-label="Hasta" />
            </label>
          </div>
        ) : undefined,
    },
    { key: "verificacion", label: "Verificación", value: verificacion, defaultValue: "", onChange: setVerificacion, options: [{ value: "probados", label: "Probados" }, { value: "sin_probar", label: "Sin probar" }, { value: "fallidos", label: "Con prueba fallida" }] },
  ];
  const grupoOrden: FilterGroup = { key: "orden", label: "Ordenar por", value: orden, defaultValue: "recientes", showDefault: true, onChange: (v) => setOrden(v as Orden), options: [{ value: "recientes", label: "Más recientes" }, { value: "antiguos", label: "Más antiguos" }, { value: "tamano", label: "Tamaño" }] };
  const filtrando = !!(search.trim() || tipo || periodo !== "todo" || verificacion);

  const crear = async (etiqueta: string) => {
    const data = await sendJsonAuth("POST", `${API_BASE_URL}/respaldos`, token, { etiqueta });
    miTrabajo.current = Number(data.trabajo?.id);
    setResultado(null);
    setTrabajo(data.trabajo as ApiRecord);
  };
  const probar = async (id: string) => {
    const data = await sendJsonAuth("POST", `${API_BASE_URL}/respaldos/${encodeURIComponent(id)}/probar`, token, {});
    miTrabajo.current = Number(data.trabajo?.id);
    setResultado(null);
    setTrabajo(data.trabajo as ApiRecord);
  };

  const menuFor = (r: ApiRecord): MenuItem[] =>
    puedeGestionar && r.estado === "ok"
      ? [{ label: "Probar restauración", description: enCurso ? FRASE_OCUPADO : "Comprueba que se puede recuperar, sin tocar la plataforma", icon: <Flask size={16} weight="duotone" />, tone: "brand", disabled: enCurso, onSelect: () => setConfirmar({ tipo: "probar", id: String(r.id) }) }]
      : [];

  const ultimo = datos?.ultimo_respaldo as ApiRecord | null | undefined;
  const ultimaPrueba = datos?.ultima_prueba as ApiRecord | null | undefined;
  const ultimaAprobada = datos?.ultima_aprobada as ApiRecord | null | undefined;
  const horasDesdeUltimo = ultimo ? (ahora - Date.parse(String(ultimo.creado_en))) / 3_600_000 : null;
  const diasDesdePrueba = ultimaAprobada ? (ahora - Date.parse(String(ultimaAprobada.fecha))) / 86_400_000 : null;

  if (mysql) {
    return (
      <Callout tone="info" title="Respaldos con MySQL">
        Con MySQL los respaldos se hacen con la herramienta del servidor de base de datos. Esta pantalla no los crea ni los prueba.
      </Callout>
    );
  }

  return (
    <>
      {datos ? (
        <ul aria-label="Estado de los respaldos" className="flex flex-wrap items-center gap-2" data-estado-respaldos>
          <Pildora dato="ultimo" tono={!ultimo ? "danger" : horasDesdeUltimo! > Number(datos.aviso_horas || 24) ? "warning" : "success"} icono={<Archive weight="duotone" />}>
            <span>{ultimo ? `Último respaldo: ${hace(ultimo.creado_en)}` : "Último respaldo: ninguno"}</span>
          </Pildora>
          <Pildora dato="prueba" tono={ultimaPrueba?.resultado === "fallida" ? "danger" : diasDesdePrueba === null || diasDesdePrueba > Number(datos.prueba_dias || 90) ? "warning" : "success"} icono={<ShieldCheck weight="duotone" />}>
            <span>
              {ultimaPrueba?.resultado === "fallida" ? `Última prueba de restauración: falló ${hace(ultimaPrueba.fecha)}` : ultimaAprobada ? `Última prueba de restauración: ${hace(ultimaAprobada.fecha)}` : "Última prueba de restauración: nunca"}
            </span>
          </Pildora>
          <Pildora dato="externa" tono={datos.copia_externa === "activa" ? "success" : "neutral"} icono={<Database weight="duotone" />}>
            <span>Copia externa: {datos.copia_externa === "activa" ? "activa" : "no configurada"}</span>
          </Pildora>
        </ul>
      ) : null}

      <Toolbar
        end={
          puedeGestionar ? (
            <span title={enCurso ? FRASE_OCUPADO : undefined}>
              <Button icon={<Plus size={16} weight="bold" />} onClick={() => setConfirmar({ tipo: "crear" })} disabled={enCurso} data-crear-respaldo>
                Crear respaldo ahora
              </Button>
            </span>
          ) : null
        }
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por fecha o nota" className="w-full md:w-[320px]" />
        <FilterMenu groups={groups} gruposFinales={[grupoOrden]} />
      </Toolbar>

      {actual && (enCurso || resultado) ? <Progreso trabajo={actual} resultado={resultado} onActa={setActa} onCerrar={() => setResultado(null)} /> : null}

      <ListaCuadricula
        etiqueta="Respaldos"
        columnas={COLUMNAS}
        filas={datos ? filas : null}
        error={recurso.error}
        onReintentar={recurso.reload}
        clave={(r) => String(r.id)}
        onAbrir={(_, i) => setAbierto(i)}
        activa={(_, i) => abierto === i}
        celdas={(r) => celdas(r)}
        extremo={(r) => <span className="w-9">{menuFor(r).length ? <ActionMenu items={menuFor(r)} header={fmtDateTime(r.creado_en)} /> : null}</span>}
        anchoExtremo="52px"
        propsFila={(r) => ({ "data-respaldo": String(r.id), "data-danado": r.estado === "danado" ? "1" : "0" })}
        vacio={{ icono: <Database size={20} />, titulo: filtrando ? "Sin coincidencias" : "Todavía no hay respaldos", descripcion: filtrando ? "Ningún respaldo cumple los filtros elegidos." : puedeGestionar ? "Crea el primero con «Crear respaldo ahora»." : "Cuando se cree el primero aparecerá aquí." }}
      />

      <ComoRecuperar />

      <RespaldoVentana ids={filas.map((r) => String(r.id))} indice={abierto} onIndice={setAbierto} onCerrar={() => setAbierto(null)} puedeGestionar={puedeGestionar} ocupado={enCurso} onProbar={(id) => setConfirmar({ tipo: "probar", id })} />
      <ActaVentana archivo={acta} onCerrar={() => setActa(null)} />

      {confirmar?.tipo === "crear" ? (
        <ConfirmarRespaldo titulo="Crear respaldo ahora" descripcion="Se guarda una copia de toda la información de la plataforma. Puedes seguir trabajando mientras se hace. Confirma con tu contraseña." confirmar="Crear respaldo" conEtiqueta onCerrar={() => setConfirmar(null)} onConfirmar={crear} />
      ) : null}
      {confirmar?.tipo === "probar" ? (
        <ConfirmarRespaldo titulo="Probar restauración" descripcion="Se recupera este respaldo en una copia aparte y se comprueba que todo coincide. No se toca la plataforma y la copia se borra al terminar. Confirma con tu contraseña." confirmar="Probar restauración" onCerrar={() => setConfirmar(null)} onConfirmar={() => probar(confirmar.id)} />
      ) : null}
    </>
  );
}

/* Celdas de un renglón. */
function celdas(r: ApiRecord) {
  const danado = r.estado === "danado";
  return [
    <span key="f" className="flex flex-col gap-0.5">
      <span className="text-[14px] font-medium text-ink">{fmtDateTime(r.creado_en)}</span>
      <span className="text-[12px] text-ink-3">{haceCuantoCorto(r.creado_en)}</span>
    </span>,
    <span key="t" className="flex flex-col gap-0.5 text-[13.5px] text-ink">
      {TIPOS_RESPALDO[String(r.tipo)] || "Manual"}
      {r.nota ? <span className="text-[12px] text-ink-3">{String(r.nota)}</span> : null}
    </span>,
    <span key="s" className="tnum text-[13.5px] text-ink-2">{danado ? "—" : mb(r.tamano)}</span>,
    <span key="c" className="text-[13.5px] text-ink-2">{danado ? "—" : `Base + ${archivosTexto(r.archivos)}`}</span>,
    danado ? <span key="l" className="text-[13px] text-ink-4">—</span> : <span key="l" className="inline-flex items-center gap-1.5 text-[13px] text-ink-2"><Key size={14} weight="duotone" aria-hidden="true" />{r.incluye_llave ? "Incluida" : "No incluida"}</span>,
    <span key="v" className="flex flex-col items-start gap-1">
      {danado ? <Badge tone="danger" dot>Dañado</Badge> : r.verificacion ? <InsigniaVerificacion verificacion={r.verificacion} /> : <span className="text-[13px] text-ink-3">Sin probar</span>}
      {r.protegido ? <MarcaProtegido /> : null}
    </span>,
  ];
}

/* Avance del respaldo o de la prueba en curso, y el resultado de la última prueba hecha por esta persona. */
function Progreso({ trabajo, resultado, onActa, onCerrar }: { trabajo: ApiRecord; resultado: ApiRecord | null; onActa: (archivo: string) => void; onCerrar: () => void }) {
  const enCurso = trabajo.estado === "en_curso";
  const pasos = (trabajo.pasos || []) as ApiRecord[];
  if (enCurso) {
    return (
      <div role="status" aria-live="polite" className="entrada-escalonada flex flex-col gap-3 rounded-card bg-surface px-5 py-4 shadow-card ring-1 ring-brand/15" data-progreso>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] font-medium text-ink">
          <Girando texto={trabajo.tipo === "prueba" ? "Probando la restauración…" : "Creando el respaldo…"} />
          <span className="text-[13px] font-normal text-ink-3">{String(trabajo.fase || "")}</span>
        </div>
        {trabajo.tipo === "prueba" && pasos.length ? (
          <ul className="flex flex-col gap-1 text-[13px] text-ink-2">
            {pasos.map((p) => (
              <li key={String(p.n)} className="flex items-center gap-2">
                <span aria-hidden="true" className={p.ok ? "text-success-text" : "text-danger"}>{p.ok ? "✓" : "✗"}</span>
                {String(p.titulo)}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-brand motion-reduce:animate-none" />
        </div>
      </div>
    );
  }
  if (!resultado) return null;
  const aprobada = resultado.resultado === "aprobada";
  return (
    <Callout tone={aprobada ? "success" : "danger"} title={aprobada ? "La prueba salió bien" : "La prueba encontró problemas"}>
      <span className="flex flex-wrap items-center gap-3">
        <span>{aprobada ? "El respaldo se puede recuperar." : "Revisa el detalle antes de confiar en ese respaldo."}</span>
        {resultado.acta ? (
          <Button size="sm" variant="secondary" onClick={() => onActa(String(resultado.acta))}>
            Ver el resultado
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onCerrar}>
          Cerrar
        </Button>
      </span>
    </Callout>
  );
}

/* Tarjeta discreta: cómo recuperar la plataforma de verdad (fuera de la plataforma). */
function ComoRecuperar() {
  return (
    <details className="group rounded-card bg-surface px-5 py-3.5 shadow-card ring-1 ring-line" data-como-recuperar>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[13.5px] font-medium text-ink-2 hover:text-ink">
        <span>¿Cómo recuperar la plataforma desde un respaldo?</span>
        <CaretDown size={14} aria-hidden="true" className="transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-[13.5px] leading-[1.5] text-ink-3">
        <li>Avisa al personal y apaga la plataforma. La recuperación real no se hace con la plataforma encendida ni desde esta pantalla.</li>
        <li>El administrador técnico elige el respaldo y ejecuta el comando de restauración que viene en el README, en la sección «Respaldos y restauración».</li>
        <li>Ten a la mano la llave del registro de actividad: sin ella no se puede comprobar que el registro esté íntegro.</li>
        <li>Antes de recuperar, el sistema guarda un respaldo de lo que había, por si hace falta volver atrás.</li>
        <li>Enciende la plataforma y revisa que todo esté en orden. La recuperación queda en el registro de actividad.</li>
      </ol>
    </details>
  );
}
