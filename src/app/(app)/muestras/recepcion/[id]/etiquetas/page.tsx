"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Printer } from "@phosphor-icons/react";
import { toast } from "sonner";
import { PageBody } from "@/components/shell/AppShell";
import { RequireModule } from "@/components/session/RequireModule";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Field, Input, Select } from "@/components/ui/Field";
import { ErrorState, Skeleton } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth, sendJsonAuth } from "@/lib/client/api";
import { formatearFecha } from "@/lib/shared/fechas";
import { acomodar, ORDEN, porHoja, TAMANOS, type TamanoEtiqueta } from "@/lib/client/etiquetas";

/*
 * Etiquetas imprimibles de una recepcion (Fase 5): una por muestra del lote.
 * Todos los tamaños se imprimen en hoja tamaño carta, con las etiquetas
 * acomodadas en cuadrícula (medidas reales en mm, @page letter sin márgenes
 * del navegador) y en la menor cantidad de hojas. "Copias por muestra" y
 * "Empezar en la posición N" (hojas de etiquetas ya usadas). La vista previa es
 * la misma hoja que se imprime. Al imprimir queda en la bitacora.
 */
interface Etiqueta {
  folio: string;
  id_interno: string;
  organismo: string;
  fecha_muestreo: string | null;
  fecha_recepcion: string | null;
  resguardo: string;
}

const CLAVE_TAMANO = "ficotox.etiquetas.tamano";
const leerTamano = (usuario: string): TamanoEtiqueta => {
  try {
    const v = window.localStorage.getItem(`${CLAVE_TAMANO}.${usuario}`) as TamanoEtiqueta | null;
    return v && ORDEN.includes(v) ? v : "pequena";
  } catch {
    return "pequena";
  }
};

export default function EtiquetasRecepcionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireModule modules="muestras">
      <Etiquetas id={id} />
    </RequireModule>
  );
}

function Etiquetas({ id }: { id: string }) {
  const { token, user } = useSession();
  const usuario = String(user?.id || user?.email || "");
  const [data, setData] = useState<{ folio: string; items: Etiqueta[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tamanoElegido, setTamano] = useState<TamanoEtiqueta | null>(null);
  const [copiasTexto, setCopias] = useState("1");
  const [inicioTexto, setInicio] = useState("1");
  const [imprimiendo, setImprimiendo] = useState(false);
  // Recuerda el último tamaño elegido por cada persona.
  const tamano: TamanoEtiqueta = tamanoElegido ?? (typeof window === "undefined" || !usuario ? "pequena" : leerTamano(usuario));
  const elegirTamano = (t: TamanoEtiqueta) => {
    setTamano(t);
    try {
      window.localStorage.setItem(`${CLAVE_TAMANO}.${usuario}`, t);
    } catch {
      /* sin almacenamiento */
    }
  };
  const copias = Math.min(Math.max(Number.parseInt(copiasTexto, 10) || 1, 1), 20);
  const inicio = Math.min(Math.max(Number.parseInt(inicioTexto, 10) || 1, 1), porHoja(tamano));

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getJsonAuth(`${API_BASE_URL}/samples/reception/${id}/etiquetas`, token)
      .then((res) => !cancelled && setData({ folio: String(res.folio || ""), items: (res.items as Etiqueta[]) || [] }))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "No se pudieron cargar las etiquetas"));
    return () => {
      cancelled = true;
    };
  }, [id, token]);

  const hojas = data ? acomodar(data.items, copias, inicio, tamano) : [];
  const t = TAMANOS[tamano];
  const hojasJsx = (
    <>
      {hojas.map((hoja, h) => (
        <section key={h} className="hoja-etiquetas" aria-label={`Hoja ${h + 1}`}>
          {hoja.map((e, i) =>
            e ? (
              <article key={i} data-etiqueta className="etiqueta">
                <div className="etiqueta-folio">{e.folio}</div>
                <div className="etiqueta-id">{e.id_interno || "Sin ID interno"}</div>
                {t.completa ? <div className="etiqueta-dato">{e.organismo || "—"}</div> : null}
                {t.completa ? <div className="etiqueta-dato">Muestreo {formatearFecha(e.fecha_muestreo)}</div> : null}
                <div className="etiqueta-dato">Recepción {formatearFecha(e.fecha_recepcion)}</div>
                {t.completa ? <div className="etiqueta-dato">Resguardo: {e.resguardo || "—"}</div> : null}
              </article>
            ) : (
              <div key={i} className="etiqueta-vacia" aria-hidden="true" />
            ),
          )}
        </section>
      ))}
    </>
  );
  // Para imprimir, una copia de las hojas directamente bajo <body>: lo demás se oculta con display:none (sin páginas en blanco).
  const [cuerpo, setCuerpo] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const t0 = window.setTimeout(() => setCuerpo(document.body), 0);
    return () => window.clearTimeout(t0);
  }, []);

  const imprimir = async () => {
    setImprimiendo(true);
    try {
      await sendJsonAuth("POST", `${API_BASE_URL}/samples/reception/${id}/etiquetas`, token, { formato: tamano, copias, inicio });
      window.print();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo registrar la impresión");
    } finally {
      setImprimiendo(false);
    }
  };

  if (error) {
    return (
      <PageBody>
        <ErrorState message={error} />
      </PageBody>
    );
  }

  return (
    <PageBody>
      <style>{estilosImpresion(tamano)}</style>
      <div className="no-imprimir flex flex-col gap-4">
        <PageHeader
          eyebrow={
            <Link href={`/muestras/recepcion/${id}`} className="inline-flex items-center gap-1 text-ink-3 hover:text-ink">
              <ArrowLeft size={13} /> Recepción {data?.folio || ""}
            </Link>
          }
          title="Imprimir etiquetas"
          description="Una etiqueta por muestra, en hoja tamaño carta. La vista previa es la misma hoja que se imprime."
          actions={
            <Button icon={<Printer size={16} weight="duotone" />} onClick={imprimir} loading={imprimiendo} disabled={!data?.items.length}>
              Imprimir
            </Button>
          }
        />
        <div className="grid gap-4 rounded-card bg-surface p-4 shadow-card sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <Field label="Tamaño" htmlFor="et-tamano" hint={t.detalle}>
            <Select id="et-tamano" value={tamano} onChange={(event) => elegirTamano(event.target.value as TamanoEtiqueta)}>
              {ORDEN.map((k) => (
                <option key={k} value={k}>
                  {TAMANOS[k].nombre} · {k === "media_hoja" ? "1 por media carta" : `${TAMANOS[k].ancho} × ${TAMANOS[k].alto} mm`}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Copias por muestra" htmlFor="et-copias" hint="Interna y externa: 2.">
            <Input id="et-copias" type="number" min={1} max={20} inputMode="numeric" value={copiasTexto} onChange={(event) => setCopias(event.target.value)} />
          </Field>
          <Field label="Empezar en la posición" htmlFor="et-inicio" hint={`1 a ${porHoja(tamano)}, para hojas ya usadas.`}>
            <Input id="et-inicio" type="number" min={1} max={porHoja(tamano)} inputMode="numeric" value={inicioTexto} onChange={(event) => setInicio(event.target.value)} />
          </Field>
        </div>
        {data?.items.length ? (
          <p className="tnum text-sm text-ink-3" data-resumen-etiquetas>
            {data.items.length} {data.items.length === 1 ? "muestra" : "muestras"} × {copias} {copias === 1 ? "copia" : "copias"} = {data.items.length * copias} {data.items.length * copias === 1 ? "etiqueta" : "etiquetas"} · {hojas.length} {hojas.length === 1 ? "hoja" : "hojas"} carta
          </p>
        ) : null}
      </div>

      {!data ? (
        <Skeleton className="mt-4 h-[120px] w-full" />
      ) : data.items.length === 0 ? (
        <p className="no-imprimir mt-4 text-sm text-ink-3">La recepción no tiene muestras capturadas.</p>
      ) : (
        <div className="etiquetas-vista mt-4">
          <div id="etiquetas-impresion" data-tamano={tamano}>
            {hojasJsx}
          </div>
        </div>
      )}
      {cuerpo && data?.items.length ? createPortal(<div id="etiquetas-print">{hojasJsx}</div>, cuerpo) : null}
    </PageBody>
  );
}

/*
 * Medidas reales en mm: la hoja carta y su cuadrícula son las mismas en
 * pantalla y en papel. Al imprimir solo salen las hojas (@page sin márgenes;
 * los márgenes de la hoja de etiquetas van dentro de cada hoja).
 */
function estilosImpresion(tamano: TamanoEtiqueta): string {
  const t = TAMANOS[tamano];
  return `
    .etiquetas-vista { overflow-x: auto; padding-bottom: 8px; }
    #etiquetas-impresion { display: flex; flex-direction: column; gap: 16px; width: max-content; }
    .hoja-etiquetas { width: 215.9mm; height: 279.4mm; box-sizing: border-box; background: #fff; box-shadow: 0 0 0 1px rgba(16,32,43,.08), 0 8px 24px -12px rgba(16,32,43,.25);
      padding: ${t.margenSup}mm ${t.margenIzq}mm 0 ${t.margenIzq}mm; display: grid;
      grid-template-columns: repeat(${t.columnas}, ${t.ancho}mm); grid-template-rows: repeat(${t.filas}, ${t.alto}mm);
      column-gap: ${t.separacionCol}mm; row-gap: ${t.separacionFila}mm; align-content: start; overflow: hidden; }
    .etiqueta, .etiqueta-vacia { width: ${t.ancho}mm; height: ${t.alto}mm; box-sizing: border-box; overflow: hidden; }
    .etiqueta { padding: ${t.padding}mm ${Math.max(t.padding, 2)}mm; outline: 0.2mm dashed #c4cbd2; outline-offset: -0.1mm; background: #fff; color: #000;
      font-family: Arial, Helvetica, sans-serif; display: flex; flex-direction: column; justify-content: center; gap: ${t.padding > 3 ? 1.2 : 0.3}mm; line-height: 1.15; min-width: 0; }
    .etiqueta > div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .etiqueta-folio { font-size: ${t.letra.folio}pt; font-weight: 700; }
    .etiqueta-id { font-size: ${t.letra.id}pt; font-weight: 700; }
    .etiqueta-dato { font-size: ${t.letra.dato}pt; }
    #etiquetas-print { display: none; }
    @media print {
      @page { size: letter; margin: 0; }
      html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; height: auto !important; min-height: 0 !important; }
      body > *:not(#etiquetas-print) { display: none !important; }
      #etiquetas-print { display: block; }
      #etiquetas-print .hoja-etiquetas { box-shadow: none; break-after: page; page-break-after: always; }
      #etiquetas-print .hoja-etiquetas:last-child { break-after: auto; page-break-after: auto; }
      #etiquetas-print .etiqueta { outline: none; }
    }
  `;
}
