"use client";

/*
 * Acciones de la recepcion de la Fase 5: asignar la muestra (Coord. del Area
 * Tecnica, muestras:A), cambiar el folio y reabrir (con motivo y contrasena;
 * sin muestras:A quedan como solicitud para la Coord. Tecnica).
 */
import { formatearFolio } from "@/lib/shared/folios";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { Dialog, usePrompt } from "@/components/ui/Overlay";
import { Badge } from "@/components/ui/Primitives";
import { API_BASE_URL, getJsonAuth, sendJsonAuth } from "@/lib/client/api";
import { fmtDate } from "@/lib/client/format";
import { formatSampleFolio } from "@/lib/client/samples";
import { invalidate } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { msg } from "@/lib/client/mensajes";

/* Recepcion aceptada (con o sin desviacion) y vigente: se puede asignar. */
export const recepcionAsignable = (item: ApiRecord | null | undefined): boolean =>
  !!item && ["aceptada", "aceptada_con_desviacion"].includes(String(item.decision_aceptacion || "")) && !["anulada", "rechazada", "cerrada"].includes(String(item.estado || ""));

/* Una decision que queda como solicitud si quien la registra no tiene muestras:A. */
export const DECISIONES_CON_AUTORIZACION = new Set(["rechazada", "aceptada_con_desviacion"]);

const avisarSolicitud = (data: ApiRecord, fallback: string) => {
  if (data.codigo === "solicitud_creada" || data.solicitud) toast.info(String(data.message || "Queda pendiente de la autorización de la Coord. Técnica"), { duration: 8000 });
  else toast.success(String(data.message || fallback));
};

export function useAccionesRecepcion(onDone?: () => void) {
  const { token } = useSession();
  const prompt = usePrompt();
  const [asignando, setAsignando] = useState<ApiRecord | null>(null);
  // Errores del servidor de estas acciones (cambio de folio, reapertura): pop-up con qué pasó y qué hacer.
  const v = useValidacion({ titulo: "No se pudo completar la acción", reglas: () => [] });

  const terminar = useCallback(() => {
    invalidate("muestras", "dashboard");
    onDone?.();
  }, [onDone]);

  const cambiarFolio = async (item: ApiRecord): Promise<void> => {
    const folio = await prompt({
      title: `Cambiar folio de ${formatSampleFolio(item)}`,
      description: "El folio ya no se edita en el formato. El cambio queda en la bitácora; si no eres Coord. Técnica, queda como solicitud.",
      label: "Folio nuevo (número)",
      placeholder: "Por ejemplo 12",
      minLength: 1,
      confirmLabel: "Continuar",
    });
    if (!folio) return;
    const numero = Number.parseInt(folio, 10);
    if (!Number.isFinite(numero) || numero < 1) {
      v.avisar({ que: `«${folio}» no es un número de folio válido.`, hacer: "Vuelve a «Cambiar folio…» y escribe solo el número (1 o mayor)." });
      return;
    }
    const motivo = await prompt({ critico: true, title: `Cambiar folio a ${formatearFolio("R", numero)}`, description: "Motivo del cambio de folio.", confirmLabel: "Cambiar folio" });
    if (!motivo) return;
    try {
      const data = await sendJsonAuth("POST", `${API_BASE_URL}/samples/reception/${item.id}/folio`, token, { folio_num: numero, motivo });
      avisarSolicitud(data, "Folio cambiado");
      terminar();
    } catch (err) {
      v.errorServidor(err);
    }
  };

  const reabrir = async (item: ApiRecord): Promise<void> => {
    const motivo = await prompt({
      critico: true,
      title: `Reabrir ${formatSampleFolio(item)}`,
      description: item.estado === "rechazada" ? "La recepción vuelve a registrada, sin decisión, para decidir de nuevo." : "La recepción vuelve al estado en que se cerró.",
      confirmLabel: "Reabrir",
    });
    if (!motivo) return;
    try {
      const data = await sendJsonAuth("POST", `${API_BASE_URL}/samples/reception/${item.id}/reabrir`, token, { motivo });
      avisarSolicitud(data, "Recepción reabierta");
      terminar();
    } catch (err) {
      v.errorServidor(err);
    }
  };

  const dialogo: ReactNode = (
    <>
      {asignando ? <AsignarDialog recepcion={asignando} onClose={() => setAsignando(null)} onChange={terminar} /> : null}
      <ValidacionAmbito v={v}>{null}</ValidacionAmbito>
    </>
  );

  return { asignar: (item: ApiRecord) => setAsignando(item), cambiarFolio, reabrir, dialogo, avisarSolicitud };
}

interface Cuenta {
  id: number;
  nombre: string;
  email: string;
  cargo: string | null;
}

function AsignarDialog({ recepcion, onClose, onChange }: { recepcion: ApiRecord; onClose: () => void; onChange: () => void }) {
  const { token } = useSession();
  const prompt = usePrompt();
  const [asignados, setAsignados] = useState<ApiRecord[] | null>(null);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [usuario, setUsuario] = useState("");
  const [motivo, setMotivo] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const v = useValidacion({
    titulo: "No se pudo asignar la muestra",
    reglas: () => (usuario ? [] : [{ campo: "asignar-usuario", mensaje: msg.elige("a la persona que trabajará la muestra") }]),
  });

  useEffect(() => {
    getJsonAuth(`${API_BASE_URL}/samples/reception/${recepcion.id}/asignaciones`, token)
      .then((data) => setAsignados((data.items || []) as ApiRecord[]))
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "No se pudieron cargar las asignaciones");
        setAsignados([]);
      });
    getJsonAuth(`${API_BASE_URL}/cuentas/activas`, token)
      .then((data) => setCuentas((data.items || []) as Cuenta[]))
      .catch(() => setCuentas([]));
  }, [recepcion.id, token]);

  const vigentes = (asignados || []).filter((a) => !a.revocado_en);
  const yaAsignado = new Set(vigentes.map((a) => Number(a.usuario_id)));

  const asignar = async () => {
    if (!v.validar()) return;
    setEnviando(true);
    try {
      const data = await sendJsonAuth("POST", `${API_BASE_URL}/samples/reception/${recepcion.id}/asignaciones`, token, { usuario_id: Number(usuario), motivo: motivo.trim() || null });
      toast.success(String(data.message || "Muestra asignada"));
      setAviso(data.aviso ? String(data.aviso) : null);
      if (data.aviso) toast.warning(String(data.aviso), { duration: 9000 });
      setAsignados((data.items || []) as ApiRecord[]);
      setUsuario("");
      setMotivo("");
      onChange();
    } catch (err) {
      v.errorServidor(err, { motivo: "asignar-motivo" });
    } finally {
      setEnviando(false);
    }
  };

  const revocar = async (asignacion: ApiRecord) => {
    const razon = await prompt({ title: `Quitar la asignación de ${asignacion.nombre || asignacion.email}`, description: "La asignación se conserva en el historial como revocada.", confirmLabel: "Quitar asignación", tone: "danger" });
    if (!razon) return;
    try {
      const data = await sendJsonAuth("POST", `${API_BASE_URL}/samples/reception/${recepcion.id}/asignaciones/${asignacion.id}/revocar`, token, { motivo: razon });
      toast.success(String(data.message || "Asignación revocada"));
      setAsignados((data.items || []) as ApiRecord[]);
      onChange();
    } catch (err) {
      v.errorServidor(err);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Asignar ${formatSampleFolio(recepcion)}`}
      description="Solo las personas asignadas (y la coordinación) capturan procesamiento, extracción y análisis de esta muestra."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
          <Button onClick={asignar} disabled={enviando} loading={enviando}>
            Asignar
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
      <div data-asignaciones className="mb-4 flex flex-col gap-2">
        <p className="text-[13px] font-medium text-ink-2">Asignada a</p>
        {asignados === null ? (
          <p className="text-[13px] text-ink-3">Cargando…</p>
        ) : vigentes.length ? (
          <ul className="flex flex-col gap-1.5">
            {vigentes.map((a) => (
              <li key={String(a.id)} data-asignacion={String(a.id)} className="flex items-center justify-between gap-2 rounded-[10px] border border-line px-3 py-2 text-[13px]">
                <span>
                  <span className="font-medium text-ink">{String(a.nombre || a.email)}</span>
                  <span className="ml-2 text-ink-3">desde {fmtDate(a.asignado_en)}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => revocar(a)}>
                  Quitar
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-3">Nadie todavía.</p>
        )}
        {(asignados || []).some((a) => a.revocado_en) ? <Badge tone="neutral">{(asignados || []).filter((a) => a.revocado_en).length} asignación(es) revocada(s) en el historial</Badge> : null}
      </div>
      <Field label="Persona" htmlFor="asignar-usuario" required>
        <Select id="asignar-usuario" value={usuario} onChange={(event) => setUsuario(event.target.value)}>
          <option value="">Elige una cuenta activa…</option>
          {cuentas
            .filter((c) => !yaAsignado.has(Number(c.id)))
            .map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.nombre}
                {c.cargo ? ` · ${c.cargo}` : ""}
              </option>
            ))}
        </Select>
      </Field>
      <Field label="Motivo (opcional)" htmlFor="asignar-motivo" className="mt-3">
        <Textarea id="asignar-motivo" rows={2} value={motivo} maxLength={300} onChange={(event) => setMotivo(event.target.value)} />
      </Field>
      {aviso ? (
        <p role="alert" data-aviso-asignacion className="mt-3 rounded-[10px] border border-warning/40 bg-warning-soft px-3 py-2 text-[12.5px] text-ink-2">
          {aviso}
        </p>
      ) : null}
      </ValidacionAmbito>
    </Dialog>
  );
}
