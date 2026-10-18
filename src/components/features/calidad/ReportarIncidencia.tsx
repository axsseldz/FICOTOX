"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, LinkSimple, WarningDiamond, X } from "@phosphor-icons/react";
import { Callout, ChoiceCard, ChoiceGrid } from "@/components/features/samples/FormLayout";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { DateInput } from "@/components/ui/DateInput";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/Field";
import { Sheet, type MenuItem } from "@/components/ui/Overlay";
import { Badge } from "@/components/ui/Primitives";
import { API_BASE_URL, sendFormAuth, sendJsonAuth } from "@/lib/client/api";
import { useUrlTrigger } from "@/lib/client/hooks";
import { invalidate } from "@/lib/client/store";
import { DESCRIPCION_MIN, EXTENSIONES_EVIDENCIA, extensionDe, fmtBytes } from "@/lib/shared/adjuntos";
import { DESCRIPCION_INCIDENCIA_MIN, IMPACTOS, TIPOS_INCIDENCIA } from "@/lib/shared/calidad";
import { horaLocal, hoyLocal, instanteDeFechaHoraLocal } from "@/lib/shared/fechas";
import { CampoValidado, useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { msg, type Problema } from "@/lib/client/mensajes";

/*
 * Reportar incidencia (Fase 11): lo puede hacer cualquier persona con
 * calidad:C (alcance "incidencias" incluido), desde la barra lateral, ⌘K o el
 * menu de acciones de un registro (que la liga a ese registro). Nunca pasa por
 * supervision: un Estudiante reporta directo (reportar un problema no se frena).
 * Las fotos se suben despues de crearla, con la misma validacion de adjuntos
 * de la Fase 10.
 */

export interface RegistroLigado {
  entidad: string;
  entidad_id: number;
  etiqueta: string;
}

const EVENTO = "ficotox:reportar-incidencia";

/* Abre el formulario desde cualquier pantalla, opcionalmente ligado a registros. */
export function reportarIncidencia(registros: RegistroLigado[] = []): void {
  window.dispatchEvent(new CustomEvent<RegistroLigado[]>(EVENTO, { detail: registros }));
}

/* true si la sesion puede reportar (calidad:C sobre incidencias). */
export function usePuedeReportar(): boolean {
  const { can } = useSession();
  return can("calidad", "C", { objeto: "incidencia" });
}

/* Opcion "Reportar incidencia" para el menu de acciones de un registro (queda ligada a el). */
export function useMenuReportar(): (entidad: string, id: unknown, etiqueta: string) => MenuItem[] {
  const puede = usePuedeReportar();
  return (entidad, id, etiqueta) => (puede && id ? [{ label: "Reportar incidencia", description: "Queda ligada a este registro", icon: <WarningDiamond size={16} weight="duotone" />, tone: "warning", onSelect: () => reportarIncidencia([{ entidad, entidad_id: Number(id), etiqueta }]) }] : []);
}

const ACCEPT = EXTENSIONES_EVIDENCIA.map((e) => `.${e}`).join(",");

export function ReportarIncidenciaHost() {
  const puede = usePuedeReportar();
  const [abierto, setAbierto] = useState(false);
  const [registros, setRegistros] = useState<RegistroLigado[]>([]);
  const [vez, setVez] = useState(0);

  useEffect(() => {
    const abrir = (event: Event) => {
      setRegistros(((event as CustomEvent<RegistroLigado[]>).detail || []).filter((r) => r && r.entidad && r.entidad_id));
      setVez((n) => n + 1);
      setAbierto(true);
    };
    window.addEventListener(EVENTO, abrir);
    return () => window.removeEventListener(EVENTO, abrir);
  }, []);

  if (!puede) return null;
  return (
    <>
      <Suspense fallback={null}>
        <DisparadorUrl />
      </Suspense>
      {abierto ? <ReportarSheet key={vez} registrosIniciales={registros} onClose={() => setAbierto(false)} /> : null}
    </>
  );
}

/* ?reportar=1 (lo usa la paleta de comandos) abre el formulario en la pantalla actual. */
function DisparadorUrl() {
  useUrlTrigger("reportar", () => reportarIncidencia());
  return null;
}

function ReportarSheet({ registrosIniciales, onClose }: { registrosIniciales: RegistroLigado[]; onClose: () => void }) {
  const { token } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [tipo, setTipo] = useState("");
  const [fecha, setFecha] = useState(hoyLocal());
  const [hora, setHora] = useState(horaLocal());
  const [descripcion, setDescripcion] = useState("");
  const [accion, setAccion] = useState("");
  const [impacto, setImpacto] = useState("desconocido");
  const [registros, setRegistros] = useState(registrosIniciales);
  const [archivos, setArchivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const cerrar = () => {
    setOpen(false);
    window.setTimeout(onClose, 250);
  };

  const ocurrencia = instanteDeFechaHoraLocal(fecha, hora);
  const v = useValidacion({
    titulo: "No se pudo reportar la incidencia",
    reglas: () => {
      const out: Problema[] = [];
      if (!tipo) out.push({ campo: "inc-tipo", mensaje: msg.elige("el tipo de incidencia"), grupo: "Tipo" });
      if (!fecha) out.push({ campo: "inc-fecha", mensaje: msg.indica("la fecha en que ocurrió"), grupo: "Cuándo ocurrió" });
      if (!hora) out.push({ campo: "inc-hora", mensaje: msg.indica("la hora en que ocurrió"), grupo: "Cuándo ocurrió" });
      else if (ocurrencia && Date.parse(ocurrencia) > Date.now() + 5 * 60_000) out.push({ campo: "inc-hora", mensaje: "La fecha y hora de ocurrencia no pueden ser futuras", grupo: "Cuándo ocurrió" });
      if (descripcion.trim().length < DESCRIPCION_INCIDENCIA_MIN) out.push({ campo: "inc-desc", mensaje: `Describe qué pasó (al menos ${DESCRIPCION_INCIDENCIA_MIN} caracteres)`, grupo: "Qué pasó" });
      return out;
    },
  });

  const agregarArchivos = (lista: FileList | null) => {
    const nuevos: File[] = [];
    for (const file of Array.from(lista || [])) {
      const ext = extensionDe(file.name);
      if (!(EXTENSIONES_EVIDENCIA as readonly string[]).includes(ext)) {
        v.avisar({ que: `«${file.name}» no se puede adjuntar: su formato no está permitido.`, hacer: "Elige una foto, un PDF, una hoja de cálculo o un CSV.", problemas: [{ campo: "inc-archivos-zona", mensaje: "Formato no permitido", grupo: "Fotos o archivos" }] });
        continue;
      }
      if (!file.size) continue;
      nuevos.push(file);
    }
    setArchivos((prev) => [...prev, ...nuevos].slice(0, 6));
    if (input.current) input.current.value = "";
  };

  const enviar = async () => {
    if (!v.validar()) return;
    setEnviando(true);
    try {
      const data = await sendJsonAuth("POST", `${API_BASE_URL}/calidad/incidencias`, token, {
        tipo,
        fecha_hora_ocurrencia: ocurrencia,
        descripcion: descripcion.trim(),
        accion_inmediata: accion.trim() || null,
        impacto_resultados: impacto,
        registros: registros.map((r) => ({ entidad: r.entidad, entidad_id: r.entidad_id })),
      });
      const id = Number(data.id);
      let fallidos = 0;
      for (const file of archivos) {
        const form = new FormData();
        form.append("archivo", file);
        form.append("tipo_evidencia", /^image\//.test(file.type) || ["png", "jpg", "jpeg", "tif", "tiff"].includes(extensionDe(file.name)) ? "foto" : "otro");
        const nombre = file.name.replace(/\.[^.]+$/, "").slice(0, 120);
        form.append("descripcion", nombre.length >= DESCRIPCION_MIN ? nombre : `Adjunto de la incidencia (${nombre})`);
        try {
          await sendFormAuth(`${API_BASE_URL}/calidad/incidencias/${id}/adjuntos`, token, form);
        } catch {
          fallidos += 1;
        }
      }
      invalidate("calidad");
      toast.success(`${String(data.folio)} reportada`, {
        description: fallidos ? `${fallidos} archivo(s) no se pudieron adjuntar; agrégalos desde la ficha.` : "Calidad la evaluará. Puedes seguirla desde Calidad › Incidencias y NC.",
        action: { label: "Ver", onClick: () => router.push(`/calidad/incidencias/${id}`) },
      });
      cerrar();
    } catch (err) {
      v.errorServidor(err, { motivo: "inc-desc" });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : cerrar())}
      title="Reportar incidencia"
      description="Cualquier desviación, falla o queja. Calidad la evalúa y decide si es una no conformidad."
      footer={
        <>
          <Button variant="secondary" onClick={cerrar}>
            Cancelar
          </Button>
          <Button icon={<WarningDiamond size={16} />} onClick={enviar} loading={enviando} data-enviar-incidencia>
            Reportar
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
      <div className="flex flex-col gap-5" data-reportar-incidencia>
        {registros.length ? (
          <Field label="Registros relacionados">
            <div className="flex flex-wrap gap-1.5">
              {registros.map((r) => (
                <span key={`${r.entidad}-${r.entidad_id}`} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-brand-soft pr-1.5 pl-2.5 text-[12.5px] font-medium text-brand-strong">
                  <LinkSimple size={12} /> {r.etiqueta}
                  <button type="button" aria-label={`Quitar ${r.etiqueta}`} onClick={() => setRegistros((prev) => prev.filter((x) => x !== r))} className="press flex h-5 w-5 items-center justify-center rounded-full hover:bg-brand-soft/60">
                    <X size={11} weight="bold" />
                  </button>
                </span>
              ))}
            </div>
          </Field>
        ) : null}
        <Field label="Tipo" htmlFor="inc-tipo" required>
          <Select id="inc-tipo" value={tipo} onChange={(event) => setTipo(event.target.value)}>
            <option value="">Elegir…</option>
            {TIPOS_INCIDENCIA.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <FormGrid>
          <Field label="¿Cuándo ocurrió?" htmlFor="inc-fecha" required>
            <DateInput id="inc-fecha" value={fecha} onChange={setFecha} max={hoyLocal()} />
          </Field>
          <Field label="Hora" htmlFor="inc-hora" required>
            <Input id="inc-hora" type="time" value={hora} onChange={(event) => setHora(event.target.value)} />
          </Field>
        </FormGrid>
        <Field label="¿Qué pasó?" htmlFor="inc-desc" required hint={`${descripcion.trim().length}/${DESCRIPCION_INCIDENCIA_MIN} caracteres mínimo`}>
          <Textarea id="inc-desc" rows={4} value={descripcion} onChange={(event) => setDescripcion(event.target.value)} placeholder="Describe lo observado: qué, dónde, con qué equipo o muestra" />
        </Field>
        <Field label="Acción inmediata" htmlFor="inc-accion" hint="Lo que se hizo en el momento (opcional).">
          <Textarea id="inc-accion" rows={2} value={accion} onChange={(event) => setAccion(event.target.value)} placeholder="Por ejemplo: se detuvo la corrida y se avisó a la coordinación" />
        </Field>
        <Field label="¿Afecta resultados?">
          <ChoiceGrid cols={3}>
            {IMPACTOS.map((i) => (
              <ChoiceCard key={i.value} type="radio" name="inc-impacto" checked={impacto === i.value} onChange={() => setImpacto(i.value)} label={i.label} />
            ))}
          </ChoiceGrid>
        </Field>
        <Field label="Fotos o archivos" hint="Opcional; hasta 6. Se validan y guardan con su huella SHA-256.">
          <CampoValidado id="inc-archivos-zona">
          <label htmlFor="inc-archivos" className="press flex cursor-pointer items-center justify-center gap-2 rounded-[12px] border border-dashed border-line-strong bg-surface-2 px-4 py-4 text-[13.5px] font-medium text-ink-2 hover:bg-surface-3">
            <Camera size={18} /> Agregar foto o archivo
            <input ref={input} id="inc-archivos" type="file" multiple accept={ACCEPT} className="sr-only" onChange={(event) => agregarArchivos(event.target.files)} />
          </label>
          </CampoValidado>
          {archivos.length ? (
            <ul className="mt-2 flex flex-col gap-1.5">
              {archivos.map((file, i) => (
                <li key={`${file.name}-${i}`} className="flex items-center justify-between gap-2 rounded-[10px] bg-surface-2 px-3 py-2 text-[13px] ring-1 ring-line">
                  <span className="min-w-0 truncate">{file.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge>{fmtBytes(file.size)}</Badge>
                    <button type="button" aria-label={`Quitar ${file.name}`} onClick={() => setArchivos((prev) => prev.filter((_, j) => j !== i))} className="press flex h-6 w-6 items-center justify-center rounded-full text-ink-3 hover:bg-surface-3">
                      <X size={12} weight="bold" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Field>
        <Callout tone="info">Reportar no requiere visto bueno ni autorización: queda registrado a tu nombre con fecha y hora.</Callout>
      </div>
      </ValidacionAmbito>
    </Sheet>
  );
}
