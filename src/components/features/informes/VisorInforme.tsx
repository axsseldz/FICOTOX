"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, CaretDown, CaretUp, CornersIn, CornersOut, DownloadSimple, Printer } from "@phosphor-icons/react";
import { ESTILOS_IMPRESION, useAncho } from "@/components/features/visor/comun";
import { descargarUrl, imprimirPdfUrl } from "@/components/features/visor/usarArchivo";
import { VisorPdf } from "@/components/features/visor/VisorPdf";
import { Callout } from "@/components/features/samples/FormLayout";
import { StateBadge } from "@/components/features/samples/status";
import { useSession } from "@/components/session/SessionProvider";
import { Button, IconButton } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { API_BASE_URL } from "@/lib/client/api";
import { explicarError } from "@/lib/client/mensajes";
import { urlPdfInforme } from "@/lib/client/pdf";
import type { ApiRecord } from "@/lib/client/types";

interface VersionInforme {
  id: number;
  version: number;
  estado: string;
  sustituye_a: number | null;
  tiene_pdf: boolean;
}

/* ¿Tiene PDF final el informe? (se escribe al liberarlo; lo conservan los sustituidos y anulados). Sin él, el visor muestra la vista previa sin validez. */
const tienePdfFinal = (item: ApiRecord | undefined | null): boolean => !!item?.archivo_pdf;

/*
 * Pantalla de lectura del PDF de un informe, liberado o en vista previa (borrador,
 * en revisión, autorizado): el mismo visor de la biblioteca (pdf.js) con un
 * encabezado compacto. Es el unico camino para ver un informe. Leerlo no se registra en la
 * bitacora; descargarlo si, igual que la descarga de siempre.
 */
export function VisorInforme({ item }: { item: ApiRecord }) {
  const { token } = useSession();
  const router = useRouter();
  const raiz = useRef<HTMLDivElement | null>(null);
  const amplia = useAncho(1024);
  const [encabezado, setEncabezado] = useState(true);
  const [completa, setCompleta] = useState(false);
  const [descargando, setDescargando] = useState(false);
  const id = Number(item.id);
  const folio = String(item.folio || "Informe");
  const version = Number(item.version || 1);
  const estado = String(item.estado || "");
  const tienePdf = tienePdfFinal(item);
  const integridad = (item.pdf_integridad as "ok" | "alterado" | "faltante" | null) ?? null;
  const versiones = ((item.versiones || []) as VersionInforme[]).filter((v) => v.tiene_pdf);
  const sucesor = ((item.versiones || []) as VersionInforme[]).find((v) => Number(v.sustituye_a) === id && v.estado !== "anulado");
  const cliente = String((item.cliente as ApiRecord | undefined)?.nombre || "");
  const fichaHref = `/informes/${id}`;

  useEffect(() => {
    const cambio = () => setCompleta(document.fullscreenElement === raiz.current);
    document.addEventListener("fullscreenchange", cambio);
    return () => document.removeEventListener("fullscreenchange", cambio);
  }, []);

  // Con el archivo faltante no hay nada que mostrar: se consulta una vez para que el servidor registre la alerta y la incidencia.
  useEffect(() => {
    if (integridad !== "faltante" || !token) return;
    void fetch(urlPdfInforme(id), { headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
  }, [integridad, id, token]);

  const pantallaCompleta = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await raiz.current?.requestFullscreen();
    } catch {
      toast.error("El navegador no permitió la pantalla completa");
    }
  };
  const descargar = async () => {
    setDescargando(true);
    try {
      await descargarUrl(`${API_BASE_URL}/informes/${id}/pdf`, token, `${folio.replace(/\s+/g, "-")}-v${version}${tienePdf ? "" : "-vista-previa"}.pdf`);
    } catch (err) {
      const e = explicarError(err, "No se pudo descargar el PDF");
      toast.error(e.que, { description: e.hacer });
    } finally {
      setDescargando(false);
    }
  };
  const imprimir = async () => {
    try {
      await imprimirPdfUrl(urlPdfInforme(id), token);
    } catch (err) {
      toast.error(explicarError(err, "No se pudo preparar la impresión").que);
    }
  };
  const volver = () => (window.history.length > 1 ? router.back() : router.push(fichaHref));

  const hayAvisos = !tienePdf || integridad === "alterado" || integridad === "faltante" || estado === "sustituido" || estado === "anulado";
  return (
    <div ref={raiz} className={cn("flex flex-col overflow-hidden bg-canvas", completa ? "h-dvh" : "-mx-4 -my-6 h-[calc(100dvh-56px)] sm:-mx-8 sm:-my-8 lg:h-dvh")} data-visor data-visor-informe>
      <style>{ESTILOS_IMPRESION}</style>
      {encabezado ? (
        <header className="material z-10 flex flex-wrap items-center gap-2 border-b border-line/70 px-3 py-2 sm:px-4">
          <button type="button" onClick={volver} aria-label="Volver" title="Volver" className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-ink-2 shadow-card hover:text-ink">
            <ArrowLeft size={16} weight="bold" />
          </button>
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="truncate text-[15.5px] font-semibold tracking-[-0.01em] text-ink">
              <span className="code">{folio}</span> · v{version}
            </h1>
            <p className="flex min-w-0 items-center gap-1.5 truncate text-[12px] text-ink-3">
              {cliente ? <span className="truncate" title={cliente}>{cliente}</span> : null}
              {cliente ? <span aria-hidden="true">·</span> : null}
              <StateBadge kind="informe" status={estado} />
            </p>
          </div>
          <div className="flex items-center gap-1">
            {versiones.length > 1 ? (
              <select aria-label="Versión del informe" value={id} onChange={(e) => router.replace(`/informes/${e.target.value}/ver`)} className="h-8 rounded-[8px] border border-line bg-surface-2 px-1.5 text-[12.5px] text-ink focus:border-brand/55 focus:outline-none">
                {versiones.map((v) => (
                  <option key={v.id} value={v.id}>
                    Versión {v.version}
                  </option>
                ))}
              </select>
            ) : null}
            <span className="hidden sm:contents">
              <Button variant="secondary" size="sm" icon={<DownloadSimple size={15} />} onClick={descargar} loading={descargando}>
                Descargar
              </Button>
            </span>
            <span className="contents sm:hidden">
              <IconButton label="Descargar" onClick={descargar}>
                <DownloadSimple size={17} />
              </IconButton>
            </span>
            <IconButton label="Imprimir" onClick={imprimir} disabled={integridad === "faltante"}>
              <Printer size={17} />
            </IconButton>
            <IconButton label={completa ? "Salir de pantalla completa" : "Pantalla completa"} onClick={pantallaCompleta}>
              {completa ? <CornersIn size={17} /> : <CornersOut size={17} />}
            </IconButton>
            <IconButton label="Ocultar encabezado" onClick={() => setEncabezado(false)}>
              <CaretUp size={16} />
            </IconButton>
          </div>
        </header>
      ) : (
        <button type="button" onClick={() => setEncabezado(true)} aria-label="Mostrar encabezado" className="press material absolute top-2 right-3 z-20 flex h-8 items-center gap-1 rounded-full px-3 text-[12px] font-medium text-ink-2 shadow-card hover:text-ink">
          <CaretDown size={14} /> {folio} · v{version}
        </button>
      )}

      {hayAvisos ? (
        <div className="flex flex-col gap-2 border-b border-line bg-surface px-3 py-2 sm:px-4">
          {!tienePdf ? (
            <Callout tone="warning" title="Vista previa sin validez">
              Este informe todavía no se libera: el PDF es solo una vista previa. <Link href={fichaHref} className="font-medium text-brand-strong underline underline-offset-2">Abrir la ficha del informe</Link>
            </Callout>
          ) : null}
          {integridad === "alterado" || integridad === "faltante" ? (
            <div data-testid="visor-aviso-integridad">
              <Callout tone="danger" title={integridad === "faltante" ? "El PDF no está en el servidor" : "El PDF no coincide con su huella SHA-256"}>
                {integridad === "faltante" ? "No se puede mostrar este informe. " : "El contenido pudo alterarse fuera de la plataforma; no lo entregues hasta aclararlo. "}
                Se registró una alerta de integridad en la bitácora y una incidencia para Calidad.
              </Callout>
            </div>
          ) : null}
          {estado === "sustituido" ? (
            <Callout tone="warning" title="Versión sustituida">
              {sucesor ? (
                <>
                  Esta versión fue sustituida por la{" "}
                  <Link href={`/informes/${sucesor.id}/ver`} className="font-medium text-brand-strong underline underline-offset-2">
                    v{sucesor.version}
                  </Link>
                  .
                </>
              ) : (
                "Esta versión fue sustituida por una enmienda."
              )}
            </Callout>
          ) : null}
          {estado === "anulado" ? (
            <Callout tone="danger" title="Informe anulado">
              Este informe fue anulado y su PDF no tiene validez.
            </Callout>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 min-w-0 flex-1" data-visor-contenido>
        {integridad === "faltante" ? null : <VisorPdf key={id} url={urlPdfInforme(id)} ambito="informes" docId={id} compacto={!amplia} />}
      </div>
    </div>
  );
}
