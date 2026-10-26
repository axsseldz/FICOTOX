"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle, EnvelopeSimple, PaperPlaneTilt, Paperclip } from "@phosphor-icons/react";
import { Callout, FormTable, formTd, formTh } from "@/components/features/samples/FormLayout";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { DateInput } from "@/components/ui/DateInput";
import { Field, FormGrid, Input, Textarea } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Overlay";
import { Badge, EmptyState } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth, sendFormAuth, sendJsonAuth } from "@/lib/client/api";
import { openProtectedFile } from "@/lib/client/files";
import { invalidate } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { msg, type Problema } from "@/lib/client/mensajes";
import { formatearFechaHora, hoyLocal } from "@/lib/shared/fechas";

/*
 * Envios del informe por correo (Fase 6). Solo informes liberados o ya
 * enviados. El envio manual siempre esta disponible: la persona envia el PDF
 * desde su correo institucional y registra aqui destinatario, fecha y hora y la
 * evidencia. "Enviar desde la plataforma" aparece solo si el servidor tiene SMTP.
 */

const horaActual = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function EnviosPanel({ item, token, puedeEnviar, bloqueo, onCambio }: { item: ApiRecord; token: string; puedeEnviar: boolean; bloqueo?: string | null; onCambio?: () => void }) {
  const [envios, setEnvios] = useState<ApiRecord[]>([]);
  const [smtp, setSmtp] = useState(false);
  const [maxMb, setMaxMb] = useState(25);
  const [cargando, setCargando] = useState(true);
  const cliente = (item.cliente || {}) as ApiRecord;
  const [form, setForm] = useState({ nombre: String(cliente.contacto || cliente.nombre || ""), correo: String(cliente.correo || ""), fecha: hoyLocal(), hora: horaActual(), observaciones: "" });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [confirmar, setConfirmar] = useState<{ envio: ApiRecord; fecha: string; nota: string } | null>(null);
  const folio = `${String(item.folio || "")} v${String(item.version || 1)}`;
  const enviable = ["liberado", "enviado"].includes(String(item.estado)) && !bloqueo;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await getJsonAuth(`${API_BASE_URL}/informes/${item.id}/envios`, token).catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "No se pudieron leer los envíos");
        return {} as ApiRecord;
      });
      if (cancelled) return;
      setEnvios((data.items || []) as ApiRecord[]);
      setSmtp(!!data.smtp_disponible);
      setMaxMb(Number(data.max_mb || 25));
      setCargando(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [item.id, token]);

  const despues = (data: ApiRecord, mensaje: string) => {
    setEnvios((data.items || []) as ApiRecord[]);
    toast.success(String(data.message || mensaje));
    invalidate("informes", "dashboard");
    onCambio?.();
  };

  /* Destinatario: lo exigen el envío manual y el de la plataforma. */
  const reglasDestinatario = (): Problema[] => {
    const out: Problema[] = [];
    if (!form.nombre.trim()) out.push({ campo: "envio-nombre", mensaje: msg.indica("el nombre del destinatario"), grupo: "Destinatario" });
    if (!form.correo.trim()) out.push({ campo: "envio-correo", mensaje: msg.indica("el correo del destinatario"), grupo: "Destinatario" });
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.correo.trim())) out.push({ campo: "envio-correo", mensaje: msg.correo, grupo: "Destinatario" });
    return out;
  };
  const vEnvio = useValidacion({
    titulo: "No se pudo registrar el envío",
    reglas: () => {
      const out = reglasDestinatario();
      if (!form.fecha) out.push({ campo: "envio-fecha", mensaje: msg.indica("la fecha del envío"), grupo: "Envío" });
      if (!form.hora) out.push({ campo: "envio-hora", mensaje: msg.indica("la hora del envío"), grupo: "Envío" });
      if (!archivo) out.push({ campo: "envio-evidencia", mensaje: "Adjunta la evidencia del correo enviado (PDF, imagen o .eml)", grupo: "Evidencia" });
      return out;
    },
  });
  const vConf = useValidacion({
    titulo: "No se pudo registrar la confirmación",
    reglas: () => (confirmar && !confirmar.fecha ? [{ campo: "conf-fecha", mensaje: msg.indica("la fecha de la confirmación"), grupo: "Confirmación" }] : []),
  });

  const registrarManual = async () => {
    if (!vEnvio.validar() || !archivo) return;
    const data = new FormData();
    data.append("destinatario_nombre", form.nombre.trim());
    data.append("destinatario_correo", form.correo.trim());
    data.append("enviado_en", new Date(`${form.fecha}T${form.hora}:00`).toISOString());
    data.append("observaciones", form.observaciones.trim());
    data.append("evidencia", archivo);
    setEnviando(true);
    try {
      despues(await sendFormAuth(`${API_BASE_URL}/informes/${item.id}/envios`, token, data), "Envío registrado");
      setArchivo(null);
      setForm((prev) => ({ ...prev, observaciones: "" }));
    } catch (err) {
      vEnvio.errorServidor(err, { correo: "envio-correo" });
    } finally {
      setEnviando(false);
    }
  };

  const enviarSmtp = async () => {
    // Desde la plataforma no hace falta evidencia ni fecha: solo el destinatario.
    const faltan = reglasDestinatario();
    if (faltan.length) return vEnvio.avisar({ que: "Faltan datos del destinatario para enviar el correo.", hacer: "Completa los campos marcados.", problemas: faltan });
    setEnviando(true);
    try {
      despues(await sendJsonAuth("POST", `${API_BASE_URL}/informes/${item.id}/envios/smtp`, token, { destinatario_nombre: form.nombre.trim(), destinatario_correo: form.correo.trim(), observaciones: form.observaciones.trim() || null }), "Informe enviado");
    } catch (err) {
      vEnvio.errorServidor(err, { correo: "envio-correo" });
    } finally {
      setEnviando(false);
    }
  };

  const guardarConfirmacion = async () => {
    if (!confirmar) return;
    if (!vConf.validar()) return;
    try {
      despues(await sendJsonAuth("POST", `${API_BASE_URL}/informes/${item.id}/envios/${confirmar.envio.id}/confirmar`, token, { confirmacion_en: confirmar.fecha, confirmacion_nota: confirmar.nota.trim() || null }), "Confirmación registrada");
      setConfirmar(null);
    } catch (err) {
      vConf.errorServidor(err);
    }
  };

  const mailto = `mailto:${encodeURIComponent(form.correo.trim())}?subject=${encodeURIComponent(`Informe de resultados ${folio}`)}&body=${encodeURIComponent(`Estimado(a) ${form.nombre.trim() || "cliente"}:\n\nAdjuntamos el informe de resultados ${folio}.\n\nLaboratorio FICOTOX`)}`;

  return (
    <div className="flex flex-col gap-4" data-envios>
      {cargando ? null : envios.length ? (
        <FormTable minWidth={760}>
          <thead>
            <tr>
              <th className={formTh}>Destinatario</th>
              <th className={formTh}>Fecha y hora</th>
              <th className={formTh}>Medio</th>
              <th className={formTh}>Registró</th>
              <th className={formTh}>Evidencia</th>
              <th className={formTh}>Confirmación</th>
            </tr>
          </thead>
          <tbody>
            {envios.map((e) => (
              <tr key={String(e.id)} data-envio={String(e.id)}>
                <td className={formTd}>
                  <span className="block text-ink">{String(e.destinatario_nombre)}</span>
                  <span className="code text-xs text-ink-3">{String(e.destinatario_correo)}</span>
                </td>
                <td className={formTd}>
                  {formatearFechaHora(e.enviado_en)}
                  <span className="block text-xs text-ink-3">versión {String(e.version)}</span>
                </td>
                <td className={formTd}>{e.medio === "smtp" ? <Badge tone="brand">Plataforma (SMTP)</Badge> : <Badge>Manual</Badge>}</td>
                <td className={formTd}>
                  {String(e.enviado_por_nombre || "—")}
                  {e.enviado_rol ? <span className="block text-xs text-ink-3">{String(e.enviado_rol)}</span> : null}
                </td>
                <td className={formTd}>
                  {e.evidencia_archivo ? (
                    <button type="button" className="inline-flex items-center gap-1 text-brand" onClick={() => void openProtectedFile(`${API_BASE_URL}/informes/${item.id}/envios/${e.id}/evidencia`, token, String(e.evidencia_archivo))}>
                      <Paperclip size={14} /> Descargar
                    </button>
                  ) : (
                    "—"
                  )}
                  {e.evidencia_sha256 ? <span className="code block text-2xs text-ink-3">SHA-256 {String(e.evidencia_sha256).slice(0, 12)}…</span> : null}
                  {e.message_id ? <span className="code block text-2xs text-ink-3">{String(e.message_id)}</span> : null}
                </td>
                <td className={cn(formTd)}>
                  {e.confirmacion_en ? (
                    <span className="inline-flex flex-col">
                      <Badge tone="success">Confirmado {formatearFechaHora(e.confirmacion_en)}</Badge>
                      {e.confirmacion_nota ? <span className="text-xs text-ink-3">{String(e.confirmacion_nota)}</span> : null}
                    </span>
                  ) : puedeEnviar ? (
                    <Button size="sm" variant="ghost" icon={<CheckCircle size={14} />} onClick={() => setConfirmar({ envio: e, fecha: hoyLocal(), nota: "" })}>
                      Registrar confirmación
                    </Button>
                  ) : (
                    <span className="text-ink-3">Pendiente</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </FormTable>
      ) : (
        <EmptyState compact title="Sin envíos registrados" description="El primer envío pasa el informe a «Enviado»." />
      )}

      {puedeEnviar ? (
        bloqueo ? (
          <Callout tone="danger">{bloqueo}</Callout>
        ) : !enviable ? (
          <Callout tone="info">Solo se envían informes liberados.</Callout>
        ) : (
          <ValidacionAmbito v={vEnvio}>
          <div className="flex flex-col gap-3 rounded-card border border-line p-4">
            <p className="text-base font-medium text-ink">Registrar envío manual</p>
            <p className="text-xs text-ink-3">Envía el PDF desde tu correo institucional y registra aquí el envío con la evidencia (PDF, imagen o .eml del correo enviado).</p>
            <FormGrid cols={2}>
              <Field label="Destinatario" htmlFor="envio-nombre" required>
                <Input id="envio-nombre" maxLength={180} value={form.nombre} onChange={(event) => setForm({ ...form, nombre: event.target.value })} />
              </Field>
              <Field label="Correo del destinatario" htmlFor="envio-correo" required>
                <Input id="envio-correo" type="email" maxLength={180} value={form.correo} onChange={(event) => setForm({ ...form, correo: event.target.value })} />
              </Field>
              <Field label="Fecha del envío" htmlFor="envio-fecha" required>
                <DateInput id="envio-fecha" value={form.fecha} onChange={(value) => setForm({ ...form, fecha: value })} />
              </Field>
              <Field label="Hora" htmlFor="envio-hora" required>
                <Input id="envio-hora" type="time" value={form.hora} onChange={(event) => setForm({ ...form, hora: event.target.value })} />
              </Field>
            </FormGrid>
            <Field label="Evidencia del correo enviado" htmlFor="envio-evidencia" required hint={`PDF, PNG, JPG, WebP o .eml (máx. ${maxMb} MB). Se guarda con su huella SHA-256.`}>
              <input id="envio-evidencia" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.eml,.msg" onChange={(event) => setArchivo(event.target.files?.[0] || null)} className="max-w-full text-sm text-ink-2 file:mr-3 file:rounded-control file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink file:shadow-card" />
            </Field>
            <Field label="Observaciones" htmlFor="envio-obs">
              <Textarea id="envio-obs" rows={2} value={form.observaciones} onChange={(event) => setForm({ ...form, observaciones: event.target.value })} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={<EnvelopeSimple size={16} />} onClick={() => window.open(mailto, "_self")}>
                Abrir en mi correo
              </Button>
              {smtp ? (
                <Button variant="soft" icon={<PaperPlaneTilt size={16} />} loading={enviando} onClick={enviarSmtp}>
                  Enviar desde la plataforma
                </Button>
              ) : null}
              <Button loading={enviando} onClick={registrarManual}>
                Registrar envío
              </Button>
            </div>
            <p className="text-xs text-ink-3">«Abrir en mi correo» prepara el asunto y el texto; el PDF se adjunta a mano.</p>
          </div>
          </ValidacionAmbito>
        )
      ) : null}

      <Dialog
        open={!!confirmar}
        onOpenChange={(open) => !open && setConfirmar(null)}
        title="Registrar confirmación de recepción"
        description={confirmar ? `${String(confirmar.envio.destinatario_nombre)} confirmó haber recibido el informe.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmar(null)}>
              Cancelar
            </Button>
            <Button onClick={guardarConfirmacion}>Registrar confirmación</Button>
          </>
        }
      >
        {confirmar ? (
          <ValidacionAmbito v={vConf}>
          <div className="flex flex-col gap-4">
            <Field label="Fecha de la confirmación" htmlFor="conf-fecha" required>
              <DateInput id="conf-fecha" value={confirmar.fecha} onChange={(value) => setConfirmar({ ...confirmar, fecha: value })} />
            </Field>
            <Field label="Nota" htmlFor="conf-nota">
              <Textarea id="conf-nota" rows={2} value={confirmar.nota} onChange={(event) => setConfirmar({ ...confirmar, nota: event.target.value })} />
            </Field>
          </div>
          </ValidacionAmbito>
        ) : null}
      </Dialog>
    </div>
  );
}
