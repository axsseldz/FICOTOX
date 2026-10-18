"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Archive, CheckCircle, ClockCounterClockwise, Database, Files, Flask, Key, WarningCircle, XCircle } from "@phosphor-icons/react";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { Badge, ErrorState, Skeleton } from "@/components/ui/Primitives";
import { DatosRapidos, VentanaAcciones, VentanaCentrada, VentanaEncabezado, VentanaSeccion, VentanaTarjeta, VentanaTitulo } from "@/components/ui/Ventana";
import { Callout } from "@/components/features/samples/FormLayout";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { fmtDateTime } from "@/lib/client/format";
import type { ApiRecord } from "@/lib/client/types";
import { archivosTexto, FRASE_OCUPADO, InsigniaVerificacion, MarcaProtegido, mb, TIPOS_RESPALDO } from "./comun";

/* Un recurso que se pide al abrir la ventana (no se comparte con la lista). */
function useRegistro(url: string | null) {
  const { token } = useSession();
  const [estado, setEstado] = useState<{ url: string | null; item: ApiRecord | null; error: string | null }>({ url: null, item: null, error: null });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!url || !token) return;
    let vivo = true;
    getJsonAuth(`${API_BASE_URL}${url}`, token)
      .then((data) => vivo && setEstado({ url, item: data.item as ApiRecord, error: null }))
      .catch((err) => vivo && setEstado({ url, item: null, error: err instanceof Error ? err.message : "No se pudo abrir" }));
    return () => {
      vivo = false;
    };
  }, [url, token, version]);
  const actual = estado.url === url;
  return { item: actual ? estado.item : null, error: actual ? estado.error : null, recargar: () => setVersion((v) => v + 1) };
}

/* ---------- Una prueba de restauración (acta) en palabras simples ---------- */

export function ActaContenido({ archivo }: { archivo: string }) {
  const { item, error, recargar } = useRegistro(`/respaldos/actas/${encodeURIComponent(archivo)}`);
  if (error) return <ErrorState message={error} onRetry={recargar} />;
  if (!item) return <Skeleton className="h-64 w-full" />;
  const aprobada = item.resultado === "aprobada";
  const segundos = Math.max(1, Math.round(Number(item.duracion_ms || 0) / 1000));
  return (
    <div className="flex flex-col gap-5" data-acta>
      <VentanaEncabezado
        figura={<span aria-hidden="true" className={`flex h-14 w-14 items-center justify-center rounded-[16px] ${aprobada ? "bg-success-soft text-success-text" : "bg-danger-soft text-danger"}`}>{aprobada ? <CheckCircle size={30} weight="duotone" /> : <XCircle size={30} weight="duotone" />}</span>}
        titulo="Prueba de restauración"
        insignia={aprobada ? <Badge tone="success" dot>Salió bien</Badge> : <Badge tone="danger" dot>Encontró problemas</Badge>}
        subtitulo={`${fmtDateTime(item.fecha)} · ${item.modo === "real" ? "Restauración real" : "Hecha en una copia aparte, sin tocar la plataforma"}`}
      />
      <DatosRapidos
        datos={[
          { icono: <Flask size={17} weight="duotone" />, etiqueta: "Hecha por", valor: String(item.responsable || "—") },
          { icono: <ClockCounterClockwise size={17} weight="duotone" />, etiqueta: "Duración", valor: `${segundos} s` },
          { icono: aprobada ? <CheckCircle size={17} weight="duotone" /> : <XCircle size={17} weight="duotone" />, etiqueta: "Resultado", valor: aprobada ? "Aprobada" : "Fallida", tono: aprobada ? "success" : "danger" },
        ]}
      />
      <Callout tone={aprobada ? "success" : "danger"} title={aprobada ? "El respaldo se puede recuperar" : "Hay que revisar este respaldo"}>
        {String(item.conclusion || "")}
      </Callout>
      <VentanaSeccion titulo="Qué se comprobó" i={1}>
        <ul className="flex flex-col gap-2" aria-label="Verificaciones">
          {((item.verificaciones || []) as ApiRecord[]).map((v) => (
            <li key={String(v.n)} className="flex items-start gap-3 rounded-[12px] bg-surface-2 px-3.5 py-2.5 ring-1 ring-line" data-verificacion={v.ok ? "ok" : "mal"}>
              <span aria-hidden="true" className={v.ok ? "mt-0.5 text-success-text" : "mt-0.5 text-danger"}>{v.ok ? <CheckCircle size={20} weight="fill" /> : <XCircle size={20} weight="fill" />}</span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[14px] font-medium text-ink">
                  <span className="sr-only">{v.ok ? "Bien: " : "Mal: "}</span>
                  {String(v.titulo)}
                </span>
                <span className="text-[13px] leading-[1.45] text-ink-3">{String(v.frase)}</span>
              </span>
            </li>
          ))}
        </ul>
      </VentanaSeccion>
    </div>
  );
}

/* Una prueba abierta desde la página (por ejemplo, el resultado de la que acaba de terminar). */
export function ActaVentana({ archivo, onCerrar }: { archivo: string | null; onCerrar: () => void }) {
  return (
    <VentanaCentrada abierta={!!archivo} onCerrar={onCerrar} media>
      {archivo ? <ActaContenido key={archivo} archivo={archivo} /> : <VentanaTitulo className="sr-only">Prueba de restauración</VentanaTitulo>}
    </VentanaCentrada>
  );
}

/* ---------- Un respaldo ---------- */

function FichaRespaldo({ id, puedeGestionar, ocupado, onProbar, onAbrirActa }: { id: string; puedeGestionar: boolean; ocupado: boolean; onProbar: (id: string) => void; onAbrirActa: (archivo: string) => void }) {
  const { item, error, recargar } = useRegistro(`/respaldos/${encodeURIComponent(id)}`);
  if (error) return <ErrorState message={error} onRetry={recargar} />;
  if (!item) return <Skeleton className="h-72 w-full" />;
  const danado = item.estado === "danado";
  const contenido = (item.contenido || {}) as ApiRecord;
  const pruebas = (item.pruebas || []) as ApiRecord[];
  return (
    <div className="flex flex-col gap-5" data-respaldo={id}>
      <VentanaEncabezado
        figura={<span aria-hidden="true" className={`flex h-14 w-14 items-center justify-center rounded-[16px] ${danado ? "bg-danger-soft text-danger" : "bg-brand-soft text-brand-strong"}`}>{danado ? <WarningCircle size={30} weight="duotone" /> : <Database size={30} weight="duotone" />}</span>}
        titulo={fmtDateTime(item.creado_en)}
        insignia={danado ? <Badge tone="danger" dot>Dañado</Badge> : <InsigniaVerificacion verificacion={item.verificacion} />}
        subtitulo={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{TIPOS_RESPALDO[String(item.tipo)] || "Manual"}</span>
            {item.nota ? <span>· {String(item.nota)}</span> : null}
            {!danado ? <span>· {mb(item.tamano)}</span> : null}
            {item.protegido ? <MarcaProtegido /> : null}
          </span>
        }
      />

      {danado ? (
        <Callout tone="danger" title="Este respaldo está dañado">
          Está incompleto o su ficha no se puede leer, así que no sirve para recuperar la plataforma. No lo uses. Crea un respaldo nuevo y avisa al administrador técnico para que revise por qué quedó así.
        </Callout>
      ) : (
        <>
          <DatosRapidos
            datos={[
              { icono: <Archive size={17} weight="duotone" />, etiqueta: "Versión de la plataforma", valor: item.version_app ? String(item.version_app) : "—" },
              { icono: <Database size={17} weight="duotone" />, etiqueta: "Registros guardados", valor: Number(item.registros || 0).toLocaleString("es-MX") },
              { icono: <Files size={17} weight="duotone" />, etiqueta: "Archivos", valor: Number(item.archivos || 0).toLocaleString("es-MX") },
              { icono: <Key size={17} weight="duotone" />, etiqueta: "Llave", valor: item.incluye_llave ? "Incluida" : "No incluida", tono: item.incluye_llave ? "success" : "neutral" },
            ]}
          />

          <VentanaSeccion titulo="Qué contiene" i={1}>
            <VentanaTarjeta>
              <ul className="flex flex-col gap-2 text-[14px] text-ink">
                <li>
                  {((contenido.registros || []) as ApiRecord[]).length
                    ? ((contenido.registros || []) as ApiRecord[]).map((r) => `${Number(r.cantidad).toLocaleString("es-MX")} ${String(r.texto)}`).join(", ")
                    : "Todavía no había registros capturados."}
                </li>
                <li>
                  {Number(contenido.archivos || 0) ? (
                    <>
                      {archivosTexto(contenido.archivos)}
                      {((contenido.archivos_detalle || []) as ApiRecord[]).length ? `: ${((contenido.archivos_detalle || []) as ApiRecord[]).map((a) => String(a.texto)).join(", ")}` : ""}
                    </>
                  ) : (
                    "Sin archivos (todavía no había PDF ni evidencias)."
                  )}
                </li>
                <li>Registro de actividad con {Number(contenido.bitacora_entradas || 0).toLocaleString("es-MX")} {Number(contenido.bitacora_entradas) === 1 ? "entrada" : "entradas"}.</li>
              </ul>
              {!item.incluye_llave ? <p className="mt-2 text-[12.5px] text-ink-3">Este respaldo no trae la llave del registro de actividad: para probarlo o recuperarlo hace falta la copia guardada aparte.</p> : null}
            </VentanaTarjeta>
          </VentanaSeccion>

          <VentanaSeccion titulo="Pruebas de restauración" i={2}>
            {pruebas.length ? (
              <ul className="flex flex-col gap-2" aria-label="Pruebas de restauración">
                {pruebas.map((p) => (
                  <li key={String(p.archivo)}>
                    <button
                      type="button"
                      onClick={() => onAbrirActa(String(p.archivo))}
                      aria-haspopup="dialog"
                      className="press flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-[12px] bg-surface-2 px-3.5 py-2.5 text-left ring-1 ring-line hover:bg-surface-3/70"
                      data-prueba={String(p.archivo)}
                    >
                      <span className="text-[14px] font-medium text-ink">{fmtDateTime(p.fecha)}</span>
                      <span className="text-[13px] text-ink-3">{String(p.responsable || "—")}</span>
                      <span className="text-[13px] text-ink-3">{Math.max(1, Math.round(Number(p.duracion_ms || 0) / 1000))} s</span>
                      <span className="ml-auto">{p.resultado === "aprobada" ? <Badge tone="success" dot>Salió bien</Badge> : <Badge tone="danger" dot>Encontró problemas</Badge>}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13.5px] text-ink-3">Todavía no se ha probado recuperar este respaldo.{puedeGestionar ? " Usa «Probar restauración» para comprobar que sirve." : ""}</p>
            )}
          </VentanaSeccion>

          <VentanaSeccion titulo="Recuperar la plataforma" i={3}>
            <p className="text-[13.5px] leading-[1.5] text-ink-3">La recuperación real no se hace desde aquí. Se hace con la plataforma apagada, por el administrador técnico, con el comando que viene en el README (sección «Respaldos y restauración»).</p>
          </VentanaSeccion>
        </>
      )}

      {puedeGestionar && !danado ? (
        <VentanaAcciones>
          <Button icon={<Flask size={16} />} onClick={() => onProbar(id)} disabled={ocupado} title={ocupado ? FRASE_OCUPADO : undefined}>
            Probar restauración
          </Button>
          {ocupado ? <span className="text-[13px] text-ink-3">{FRASE_OCUPADO}</span> : <span className="text-[13px] text-ink-3">Se hace en una copia aparte y no toca la plataforma.</span>}
        </VentanaAcciones>
      ) : null}
    </div>
  );
}

export function RespaldoVentana({
  ids,
  indice,
  onIndice,
  onCerrar,
  puedeGestionar,
  ocupado,
  onProbar,
}: {
  ids: string[];
  indice: number | null;
  onIndice: (i: number) => void;
  onCerrar: () => void;
  puedeGestionar: boolean;
  ocupado: boolean;
  onProbar: (id: string) => void;
}) {
  const id = indice !== null ? ids[indice] : undefined;
  const [acta, setActa] = useState<{ para: string; archivo: string } | null>(null);
  const verActa = acta && acta.para === id ? acta.archivo : null;
  return (
    <VentanaCentrada
      abierta={id !== undefined}
      onCerrar={onCerrar}
      media
      onMover={(paso) => indice !== null && onIndice(indice + paso)}
      puedeAnterior={indice !== null && indice > 0}
      puedeSiguiente={indice !== null && indice < ids.length - 1}
      etiquetaAnterior="Respaldo anterior"
      etiquetaSiguiente="Respaldo siguiente"
      barra={
        verActa ? (
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} weight="bold" />} onClick={() => setActa(null)}>
            Volver al respaldo
          </Button>
        ) : null
      }
    >
      {id === undefined ? (
        <VentanaTitulo className="sr-only">Respaldo</VentanaTitulo>
      ) : verActa ? (
        <ActaContenido key={verActa} archivo={verActa} />
      ) : (
        <FichaRespaldo key={id} id={id} puedeGestionar={puedeGestionar} ocupado={ocupado} onProbar={onProbar} onAbrirActa={(archivo) => setActa({ para: id, archivo })} />
      )}
    </VentanaCentrada>
  );
}
