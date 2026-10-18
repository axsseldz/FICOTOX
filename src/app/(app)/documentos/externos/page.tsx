"use client";

import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { ArrowSquareOut, Globe, Plus } from "@phosphor-icons/react";
import { areaDe, EstadoDocumentoEtiqueta, IconoArea, nombreTipo, ProximaRevisionEtiqueta, RequireDocumentos, RutaDocumentos, useCatalogos } from "@/components/features/documentos/comun";
import { NuevaVersionExternoDialog, RegistrarExternoSheet, VerificarExternoDialog } from "@/components/features/documentos/Externos";
import { ICONO_ACCION } from "@/components/features/documentos/iconos";
import { ActionMenu, type MenuItem } from "@/components/ui/Overlay";
import { PageBody } from "@/components/shell/AppShell";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { FilterMenu, type FilterGroup } from "@/components/ui/FilterMenu";
import { SinDato } from "@/components/ui/Insignias";
import { ListaCuadricula, type ColumnaLista } from "@/components/ui/ListaCuadricula";
import { PageHeader, SearchInput, Toolbar } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { useDebouncedValue, useInitialParam } from "@/lib/client/hooks";
import { useResource } from "@/lib/client/store";
import { formatearFecha } from "@/lib/shared/fechas";

/*
 * Documentos externos (Fase 3, CA-10): normas, guias y documentos
 * regulatorios con su emisor, version, responsable de seguimiento y proxima
 * revision. El servidor solo devuelve lo que la persona puede ver.
 */

interface Externo {
  id: number;
  clave: string;
  titulo: string;
  area_codigo: string;
  tipo_codigo: string;
  estado: string;
  fuente: string | null;
  version_fecha: string | null;
  responsable_nombre: string | null;
  ultima_verificacion: string | null;
  proxima_revision: string | null;
  pendiente_revision: boolean;
  enlace: string | null;
  responsable_id: number | null;
  puede?: { verificar: boolean; nueva_version: boolean };
}
interface Respuesta {
  items: Externo[];
  puede: { registrar: boolean; ver_obsoletos: boolean };
}

const COLUMNAS: ColumnaLista[] = [
  { clave: "documento", titulo: "Documento", ancho: "minmax(220px,2.4fr)" },
  { clave: "origen", titulo: "Emisor · versión", ancho: "minmax(130px,1fr)" },
  { clave: "responsable", titulo: "Responsable", ancho: "minmax(110px,1fr)", ocultaEnTarjeta: true },
  { clave: "proxima", titulo: "Próxima revisión", ancho: "minmax(110px,0.9fr)" },
  { clave: "estado", titulo: "Estado", ancho: "minmax(140px,1.1fr)" },
];

export default function ExternosPage() {
  return (
    <RequireDocumentos>
      <Suspense fallback={<Skeleton className="h-[420px]" />}>
        <Externos />
      </Suspense>
    </RequireDocumentos>
  );
}

function Externos() {
  const { token } = useSession();
  const router = useRouter();
  const catalogos = useCatalogos();
  const [search, setSearch] = useState("");
  const [area, setArea] = useState(useInitialParam("area").toUpperCase());
  const [estado, setEstado] = useState(useInitialParam("estado"));
  const [obsoletos, setObsoletos] = useState(false);
  const [registrar, setRegistrar] = useState(useInitialParam("nuevo") === "1");
  const [verificar, setVerificar] = useState<Externo | null>(null);
  const [version, setVersion] = useState<Externo | null>(null);
  const debounced = useDebouncedValue(search);
  const recurso = useResource<Respuesta>(
    "sgc",
    async () => {
      const q = new URLSearchParams();
      if (debounced.trim()) q.set("search", debounced.trim());
      if (area) q.set("area", area);
      if (estado) q.set("estado", estado);
      if (obsoletos) q.set("obsoletos", "1");
      return (await getJsonAuth(`${API_BASE_URL}/sgc/externos?${q}`, token)) as unknown as Respuesta;
    },
    { enabled: !!token, deps: [debounced, area, estado, obsoletos] },
  );
  const data = recurso.data;
  const cat = catalogos.data;
  const groups: FilterGroup[] = [
    { key: "area", label: "Gestión", value: area, defaultValue: "", onChange: setArea, options: [{ value: "", label: "Todas" }, ...(cat?.areas || []).map((a) => ({ value: a.codigo, label: `${a.codigo} · ${a.nombre}` }))] },
    {
      key: "estado",
      label: "Estado",
      value: estado,
      defaultValue: "",
      onChange: setEstado,
      options: [
        { value: "", label: "Todos" },
        { value: "vigente", label: "Vigentes" },
        { value: "pendiente_revision", label: "Pendientes de revisión" },
        ...(data?.puede.ver_obsoletos ? [{ value: "obsoleto", label: "Obsoletos" }] : []),
      ],
    },
  ];
  return (
    <PageBody>
      <div className="flex flex-col gap-2">
        <RutaDocumentos documento="Documentos externos" />
        <PageHeader
          title="Documentos externos"
          description="Normas, guías y documentos regulatorios; se verifica periódicamente que sigan vigentes."
          actions={
            data?.puede.registrar ? (
              <Button icon={<Plus size={16} weight="bold" />} onClick={() => setRegistrar(true)} data-testid="ext-registrar">
                Registrar externo
              </Button>
            ) : null
          }
        />
      </div>
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por identificador, título o emisor" className="w-full md:w-[360px]" />
        <FilterMenu groups={groups} toggles={data?.puede.ver_obsoletos ? [{ key: "obsoletos", label: "Mostrar obsoletos", description: "Versiones retiradas, solo para consulta histórica", checked: obsoletos, onChange: setObsoletos }] : []} />
      </Toolbar>
        <ListaCuadricula
          etiqueta="Documentos externos"
          columnas={COLUMNAS}
          filas={data ? data.items : null}
          error={recurso.error}
          onReintentar={recurso.reload}
          anchoExtremo="190px"
          extremo={(x) => {
            const menu: MenuItem[] = [
              { label: "Abrir ficha", icon: <ArrowSquareOut size={16} weight="bold" />, onSelect: () => router.push(`/documentos/${x.id}`) },
              ...(x.puede?.nueva_version ? [{ label: "Registrar nueva versión", icon: <ICONO_ACCION.nueva_revision size={16} weight="bold" />, onSelect: () => setVersion(x), testid: "ext-fila-version" }] : []),
            ];
            return (
              <>
                {x.puede?.verificar ? (
                  <Button size="sm" variant={x.pendiente_revision ? "primary" : "secondary"} icon={<ICONO_ACCION.verificar_externo size={15} weight="bold" />} onClick={() => setVerificar(x)} data-testid="ext-fila-verificar">
                    Verificar vigencia
                  </Button>
                ) : null}
                <ActionMenu items={menu} label={`Más acciones de ${x.clave}`} />
              </>
            );
          }}
          clave={(x) => String(x.id)}
          onAbrir={(x) => router.push(`/documentos/${x.id}`)}
          propsFila={(x) => ({ "data-testid": "ext-fila", "data-clave": x.clave })}
          celdas={(x) => {
            const a = areaDe(cat?.areas, x.area_codigo);
            return [
              <span key="d" className="flex min-w-0 items-start gap-3">
                <IconoArea area={a} size="sm" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="code break-all text-[12.5px] font-semibold text-ink-2">{x.clave}</span>
                  <span className="break-words text-[14px] font-semibold leading-snug text-ink">{x.titulo}</span>
                  <span className="text-[12px] text-ink-3">
                    {a.codigo} · {nombreTipo(cat?.tipos, x.tipo_codigo)}
                  </span>
                </span>
              </span>,
              <span key="o" className="flex flex-col text-[13px] text-ink-2">
                <span>{x.fuente || "—"}</span>
                <span className="text-[12px] text-ink-3">Versión {x.version_fecha || "—"}</span>
              </span>,
              x.responsable_nombre ? <span key="r" className="text-[13px] text-ink-2">{x.responsable_nombre}</span> : <SinDato key="r" />,
              <span key="p" className="flex flex-col text-[13px] text-ink-2">
                <span className="tnum">{formatearFecha(x.proxima_revision)}</span>
                {x.ultima_verificacion ? <span className="text-[12px] text-ink-3">Verificado {formatearFecha(x.ultima_verificacion)}</span> : null}
              </span>,
              <span key="e" className="flex flex-wrap items-center gap-1.5">
                <EstadoDocumentoEtiqueta estado={x.estado} />
                {x.estado === "vigente" ? <ProximaRevisionEtiqueta fecha={x.proxima_revision} /> : null}
              </span>,
            ];
          }}
          vacio={{ icono: <Globe size={22} weight="duotone" />, titulo: debounced || area || estado ? "Nada coincide" : "Aún no hay documentos externos", descripcion: data?.puede.registrar ? "Registra las normas y guías que sigue el laboratorio con «Registrar externo»." : "Cuando Mejora Continua registre normas o guías, aparecerán aquí." }}
        />
      {registrar && data?.puede.registrar ? <RegistrarExternoSheet catalogos={cat || null} onClose={() => setRegistrar(false)} /> : null}
      {verificar ? <VerificarExternoDialog docId={verificar.id} clave={verificar.clave} onClose={() => setVerificar(null)} /> : null}
      {version ? <NuevaVersionExternoDialog docId={version.id} clave={version.clave} ext={{ fuente: version.fuente, version_fecha: version.version_fecha, enlace: version.enlace, responsable_id: version.responsable_id, responsable_nombre: version.responsable_nombre, ultima_verificacion: version.ultima_verificacion, proxima_revision: version.proxima_revision, puede: { verificar: { ok: !!version.puede?.verificar }, nueva_version: { ok: !!version.puede?.nueva_version }, editar: { ok: false } } }} onClose={() => setVersion(null)} /> : null}
    </PageBody>
  );
}
