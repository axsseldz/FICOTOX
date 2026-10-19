"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { Certificate, ChartLine, ChartLineUp, DownloadSimple, Eye, File, FileText, Image as ImageIcon, Paperclip, Prohibit, Table, UploadSimple, Warning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { Field, FormGrid, Select, Switch, Textarea } from "@/components/ui/Field";
import { Sheet, Tooltip, usePrompt } from "@/components/ui/Overlay";
import { Badge, EmptyState } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth, sendFormAuthProgress, sendJsonAuth } from "@/lib/client/api";
import { invalidate } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { DESCRIPCION_MIN, EXTENSIONES_EVIDENCIA, TIPOS_EVIDENCIA, TIPO_EVIDENCIA_LABEL, VISTA_PREVIA, extensionDe, fmtBytes, huellaCorta } from "@/lib/shared/adjuntos";
import { formatearFechaHora } from "@/lib/shared/fechas";
import { Callout } from "./FormLayout";
import { CampoValidado, useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { msg, type Problema } from "@/lib/client/mensajes";

/*
 * Evidencia instrumental de un analisis (Fase 10): cromatogramas, reportes del
 * equipo, hojas de calculo, curvas, certificados y fotos. Se adjunta mientras
 * el analisis esta "registrado"; despues queda en solo lectura, siempre
 * descargable. Anular pide motivo y contraseña; el archivo se conserva. Cada
 * descarga verifica la huella SHA-256 (aviso si el archivo cambio o falta).
 */

const ICONO: Record<string, typeof File> = {
  cromatograma: ChartLine,
  reporte_equipo: FileText,
  hoja_calculo: Table,
  curva_calibracion: ChartLineUp,
  certificado_material_referencia: Certificate,
  foto: ImageIcon,
  otro: File,
};

const ACCEPT = EXTENSIONES_EVIDENCIA.map((e) => `.${e}`).join(",");

interface Vista {
  item: ApiRecord;
  url: string;
  tipo: string;
}

export function EvidenciaPanel({ analisisId, token, onResumen }: { analisisId: number; token: string; onResumen?: (vigentes: number, puedeAdjuntar: boolean) => void }) {
  return <AdjuntosPanel registroId={analisisId} base={`/samples/analysis/${analisisId}`} token={token} onResumen={onResumen} />;
}

/*
 * Fase 11: el mismo panel sirve a las incidencias (fotos) y a las acciones
 * correctivas (evidencia de implementacion): cambia la ruta base, la clave que
 * se invalida al adjuntar y los textos.
 */
export interface TextosAdjuntos {
  vacioTitulo: string;
  vacioEditable: string;
  vacioLectura: string;
  boton: string;
}

const TEXTOS_ANALISIS: TextosAdjuntos = {
  vacioTitulo: "Sin evidencia adjunta",
  vacioEditable: "Adjunta el cromatograma, el reporte del equipo o los cálculos del análisis.",
  vacioLectura: "Este análisis no tiene evidencia instrumental.",
  boton: "Adjuntar evidencia",
};

export function AdjuntosPanel({ registroId, base, token, onResumen, clave = "muestras", tipoInicial = "cromatograma", textos = TEXTOS_ANALISIS }: { registroId: number; base: string; token: string; onResumen?: (vigentes: number, puedeAdjuntar: boolean) => void; clave?: string; tipoInicial?: string; textos?: TextosAdjuntos }) {
  const analisisId = registroId;
  const prompt = usePrompt();
  const [items, setItems] = useState<ApiRecord[]>([]);
  const [edicion, setEdicion] = useState<{ permitido: boolean; motivo: string | null }>({ permitido: false, motivo: null });
  const [obligatoria, setObligatoria] = useState(true);
  const [maxMb, setMaxMb] = useState(25);
  const [cargando, setCargando] = useState(true);
  const [verAnulados, setVerAnulados] = useState(false);
  const [tipo, setTipo] = useState(tipoInicial);
  const [descripcion, setDescripcion] = useState("");
  const [archivo, setArchivo] = useState<globalThis.File | null>(null);
  const [progreso, setProgreso] = useState<number | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [vista, setVista] = useState<Vista | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cada cambio de `recarga` vuelve a pedir la lista (despues de adjuntar, anular o una alerta).
  const [recarga, setRecarga] = useState(0);
  const cargar = useCallback(() => setRecarga((n) => n + 1), []);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const data = await getJsonAuth(`${API_BASE_URL}${base}/adjuntos`, token);
        if (cancelado) return;
        const lista = (data.items || []) as ApiRecord[];
        const ed = (data.edicion || { permitido: false, motivo: null }) as { permitido: boolean; motivo: string | null };
        setItems(lista);
        setEdicion(ed);
        setObligatoria(!!data.obligatoria);
        setMaxMb(Number(data.max_mb || 25));
        onResumen?.(lista.filter((a) => a.vigente).length, ed.permitido);
      } catch (err) {
        if (!cancelado) toast.error(err instanceof Error ? err.message : "No se pudo leer la evidencia");
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
    // onResumen es un callback del formato; basta con recargar al cambiar el analisis o `recarga`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, token, recarga]);

  useEffect(() => () => (vista ? URL.revokeObjectURL(vista.url) : undefined), [vista]);

  const zonaId = `evidencia-zona-${analisisId}`;
  const descId = `evidencia-desc-${analisisId}`;
  const v = useValidacion({
    titulo: "No se pudo adjuntar la evidencia",
    reglas: () => {
      const out: Problema[] = [];
      if (!archivo) out.push({ campo: zonaId, mensaje: msg.elige("el archivo de la evidencia"), grupo: "Evidencia" });
      if (descripcion.trim().length < DESCRIPCION_MIN) out.push({ campo: descId, mensaje: msg.minimo("La descripción", DESCRIPCION_MIN), grupo: "Evidencia" });
      return out;
    },
  });
  /* Un archivo que no se puede usar se explica en el pop-up, marcando la zona de carga. */
  const rechazarArchivo = (que: string, hacer: string) => v.avisar({ que, hacer, problemas: [{ campo: zonaId, mensaje: que, grupo: "Evidencia" }] });

  const elegir = (file: globalThis.File | null) => {
    if (!file) return;
    const ext = extensionDe(file.name);
    if (!(EXTENSIONES_EVIDENCIA as readonly string[]).includes(ext)) return rechazarArchivo(`El formato .${ext || "sin extensión"} no está permitido.`, `Elige un archivo ${EXTENSIONES_EVIDENCIA.join(", ")}.`);
    if (!file.size) return rechazarArchivo("El archivo está vacío.", "Elige otro archivo.");
    if (file.size > maxMb * 1024 * 1024) return rechazarArchivo(`El archivo pesa más de ${maxMb} MB.`, "Elige un archivo más pequeño o comprímelo.");
    setArchivo(file);
    if (!descripcion.trim()) setDescripcion(file.name.replace(/\.[^.]+$/, "").slice(0, 120));
  };

  const soltar = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setArrastrando(false);
    elegir(event.dataTransfer.files?.[0] || null);
  };

  const subir = async () => {
    if (!v.validar() || !archivo) return;
    const form = new FormData();
    form.append("archivo", archivo);
    form.append("tipo_evidencia", tipo);
    form.append("descripcion", descripcion.trim());
    setProgreso(0);
    try {
      const data = await sendFormAuthProgress(`${API_BASE_URL}${base}/adjuntos`, token, form, setProgreso);
      toast.success(String(data.message || "Evidencia adjuntada"));
      setArchivo(null);
      setDescripcion("");
      if (inputRef.current) inputRef.current.value = "";
      invalidate(clave);
      cargar();
    } catch (err) {
      v.errorServidor(err, { motivo: descId }, { motivo: { grupo: "Evidencia" } });
    } finally {
      setProgreso(null);
    }
  };

  /* Descarga (o vista previa) con el token; avisa si la huella no coincide o el archivo falta. */
  const traer = async (item: ApiRecord, inline: boolean): Promise<Blob | null> => {
    const res = await fetch(`${API_BASE_URL}/adjuntos/${item.id}/archivo${inline ? "?inline=1" : ""}`, { headers: { Authorization: `Bearer ${token}` } });
    const integridad = res.headers.get("x-integridad-adjunto");
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as ApiRecord;
      toast.error(String(data.message || `No se pudo abrir el archivo (${res.status})`));
      if (integridad === "faltante") void cargar();
      return null;
    }
    if (integridad === "alterado") {
      toast.warning("Alerta de integridad: el archivo no coincide con su huella SHA-256 registrada. Quedó registrado en la bitácora.");
      void cargar();
    }
    return res.blob();
  };

  const descargar = async (item: ApiRecord) => {
    const blob = await traer(item, false);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = String(item.nombre_original || "evidencia");
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const verPrevia = async (item: ApiRecord) => {
    const blob = await traer(item, true);
    if (!blob) return;
    setVista({ item, url: URL.createObjectURL(blob), tipo: String(item.extension) });
  };

  const anular = async (item: ApiRecord) => {
    const motivo = await prompt({
      critico: true,
      title: `Anular ${TIPO_EVIDENCIA_LABEL[String(item.tipo_evidencia)]?.toLowerCase() || "evidencia"}`,
      description: `“${String(item.descripcion)}” dejará de contar como evidencia vigente. El archivo se conserva y la anulación queda en la bitácora.`,
      label: "Motivo de la anulación",
      confirmLabel: "Anular adjunto",
    });
    if (!motivo) return;
    try {
      const data = await sendJsonAuth("POST", `${API_BASE_URL}/adjuntos/${item.id}/anular`, token, { motivo });
      toast.success(String(data.message || "Adjunto anulado"));
      invalidate(clave);
      cargar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo anular el adjunto");
    }
  };

  const vigentes = items.filter((a) => a.vigente);
  const anulados = items.length - vigentes.length;
  const visibles = verAnulados ? items : vigentes;
  const problemas = items.filter((a) => a.integridad && a.integridad !== "ok");

  return (
    <ValidacionAmbito v={v}>
    <div className="flex flex-col gap-4" data-evidencia>
      {problemas.length ? (
        <Callout tone="danger" title="Alerta de integridad">
          {problemas.map((a) => `“${String(a.descripcion)}”: ${a.integridad === "faltante" ? "el archivo no está en el servidor" : "el archivo no coincide con su huella SHA-256"}`).join(" · ")}
        </Callout>
      ) : null}
      {!cargando && obligatoria && !vigentes.length && edicion.permitido ? (
        <Callout tone="warning" title="Falta la evidencia instrumental">
          Adjunta al menos un archivo (cromatograma, reporte del equipo, hoja de cálculo…) antes de enviar el análisis a revisión.
        </Callout>
      ) : null}

      {edicion.permitido ? (
        <div className="flex flex-col gap-3">
          <CampoValidado id={zonaId}>
          <label
            htmlFor={`evidencia-archivo-${analisisId}`}
            onDragOver={(event) => {
              event.preventDefault();
              setArrastrando(true);
            }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={soltar}
            className={cn("flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-card border border-dashed px-4 py-6 text-center transition-colors", arrastrando ? "border-brand bg-brand-soft" : "border-line-strong bg-surface-2 hover:bg-surface-3")}
            data-zona-carga
          >
            <UploadSimple size={22} className="text-ink-3" />
            <span className="text-base font-medium text-ink">{archivo ? archivo.name : "Arrastra el archivo aquí o elígelo"}</span>
            <span className="text-xs text-ink-3">{archivo ? fmtBytes(archivo.size) : `PDF, imagen (PNG, JPG, TIF), CSV, TXT, Excel, ZIP o CDF · hasta ${maxMb} MB`}</span>
            <input ref={inputRef} id={`evidencia-archivo-${analisisId}`} type="file" accept={ACCEPT} className="sr-only" onChange={(event) => elegir(event.target.files?.[0] || null)} aria-label="Archivo de evidencia" />
          </label>
          </CampoValidado>
          <FormGrid cols={3}>
            <Field label="Tipo de evidencia" htmlFor={`evidencia-tipo-${analisisId}`} required>
              <Select id={`evidencia-tipo-${analisisId}`} value={tipo} onChange={(event) => setTipo(event.target.value)}>
                {TIPOS_EVIDENCIA.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Descripción" htmlFor={descId} required className="sm:col-span-2" hint="Qué muestra el archivo (p. ej. “Cromatograma lote D45, corrida 2”).">
              <Textarea id={descId} rows={2} maxLength={300} value={descripcion} onChange={(event) => setDescripcion(event.target.value)} />
            </Field>
          </FormGrid>
          <div className="flex items-center justify-end gap-3">
            {progreso !== null ? (
              <div className="flex min-w-0 flex-1 items-center gap-3" aria-live="polite">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progreso * 100)} aria-label="Avance de la carga">
                  <div className="h-full w-full rounded-full bg-brand transition-[translate]" style={{ translate: `${Math.round(progreso * 100) - 100}% 0` }} />
                </div>
                <span className="tnum text-xs text-ink-3">{Math.round(progreso * 100)}%</span>
              </div>
            ) : null}
            <Button icon={<Paperclip size={16} />} onClick={subir} loading={progreso !== null}>
              {textos.boton}
            </Button>
          </div>
        </div>
      ) : edicion.motivo && !cargando ? (
        <p className="whitespace-pre-line text-sm text-ink-3">{edicion.motivo}</p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-ink-2">
          {vigentes.length} vigente{vigentes.length === 1 ? "" : "s"}
          {anulados ? ` · ${anulados} anulado${anulados === 1 ? "" : "s"}` : ""}
        </span>
        {anulados ? <Switch checked={verAnulados} onCheckedChange={setVerAnulados} label="Mostrar anulados" /> : null}
      </div>

      {cargando ? null : !visibles.length ? (
        <EmptyState compact icon={<Paperclip size={20} />} title={textos.vacioTitulo} description={edicion.permitido ? textos.vacioEditable : textos.vacioLectura} />
      ) : (
        <ul className="flex flex-col gap-2">
          {visibles.map((a) => {
            const Icono = ICONO[String(a.tipo_evidencia)] || File;
            const alterado = a.integridad && a.integridad !== "ok";
            return (
              <li key={String(a.id)} data-adjunto={String(a.id)} className={cn("on-panel flex flex-wrap items-center gap-3 rounded-box bg-surface-2 p-3 ring-1 ring-line", !a.vigente && "opacity-70")}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-field bg-surface text-ink-2 ring-1 ring-line">
                  <Icono size={18} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 whitespace-pre-line break-words text-base font-medium text-ink">{String(a.descripcion)}</span>
                    <Badge tone="neutral">{TIPO_EVIDENCIA_LABEL[String(a.tipo_evidencia)] || String(a.tipo_evidencia)}</Badge>
                    {a.heredado_de ? <Badge tone="brand">Heredado de v{String(a.heredado_de_version || 1)}</Badge> : null}
                    {a.vigente ? null : <Badge tone="danger">Anulado</Badge>}
                    {alterado ? (
                      <Badge tone="danger">
                        <Warning size={12} weight="bold" /> {a.integridad === "faltante" ? "Archivo faltante" : "Alterado"}
                      </Badge>
                    ) : null}
                  </div>
                  <span className="break-words text-xs text-ink-3">
                    {String(a.nombre_original)} · {fmtBytes(Number(a.tamano_bytes))} · {String(a.subido_por_nombre || "—")} · {formatearFechaHora(a.subido_en)} ·{" "}
                    <Tooltip content={<span className="font-mono text-2xs break-all">SHA-256 {String(a.sha256)}</span>}>
                      <span className="font-mono" tabIndex={0}>
                        {huellaCorta(a.sha256)}
                      </span>
                    </Tooltip>
                  </span>
                  {!a.vigente && a.motivo_anulacion ? <span className="whitespace-pre-line text-xs text-danger">Anulado por {String(a.anulado_por_nombre || "—")}: {String(a.motivo_anulacion)}</span> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {VISTA_PREVIA.has(String(a.extension)) ? (
                    <Button variant="secondary" size="sm" icon={<Eye size={14} />} onClick={() => verPrevia(a)}>
                      Vista previa
                    </Button>
                  ) : null}
                  <Button variant="secondary" size="sm" icon={<DownloadSimple size={14} />} onClick={() => descargar(a)}>
                    Descargar
                  </Button>
                  {a.vigente && edicion.permitido ? (
                    <Button variant="secondary" size="sm" icon={<Prohibit size={14} />} onClick={() => anular(a)}>
                      Anular…
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={!!vista} onOpenChange={(open) => !open && setVista(null)} title={vista ? String(vista.item.descripcion) : ""} description={vista ? `${String(vista.item.nombre_original)} · SHA-256 ${huellaCorta(vista.item.sha256)}` : undefined} size="xl">
        {vista ? (
          vista.tipo === "pdf" ? (
            <iframe title={String(vista.item.descripcion)} src={vista.url} className="h-[78vh] w-full rounded-field ring-1 ring-line" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={vista.url} alt={String(vista.item.descripcion)} className="mx-auto max-h-[78vh] max-w-full rounded-field ring-1 ring-line" />
          )
        ) : null}
      </Sheet>
    </div>
    </ValidacionAmbito>
  );
}
