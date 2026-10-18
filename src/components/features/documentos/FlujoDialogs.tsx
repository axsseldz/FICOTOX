"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowsClockwise, Prohibit, SealCheck, UserSwitch } from "@phosphor-icons/react";
import { ChoiceCard } from "@/components/features/samples/FormLayout";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { DateInput } from "@/components/ui/DateInput";
import { Field, FormGrid, Select, Switch, Textarea } from "@/components/ui/Field";
import { useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { API_BASE_URL, sendJsonAuth } from "@/lib/client/api";
import { type Problema } from "@/lib/client/mensajes";
import { invalidate } from "@/lib/client/store";
import { ANIOS_PROXIMA_REVISION, MOTIVO_MIN_SGC, sumarAnios } from "@/lib/shared/documentos";
import { hoyLocal } from "@/lib/shared/fechas";
import type { AccionDocumental } from "@/lib/shared/permisos";
import type { Catalogos, Distribucion, FichaDocumento, Revision } from "./comun";
import { opcionesPersonas } from "./FichaSheet";
import { confirmarConCheck } from "./Confirmacion";
import { cuerpoDestinatarios, destinatariosVacios, SelectorDestinatarios, type Destinatarios } from "./Distribucion";
import { conDato, MasOpciones, VentanaFormulario } from "./VentanaFormulario";

/*
 * Dialogos del flujo de aprobacion (Fase 2). El servidor decide (papel
 * asignado, estado, segregacion y contrasena); la interfaz solo ofrece lo que
 * las banderas "puede" permiten.
 */

type Opcion = { value: string; label: string; descripcion: string; comentario: boolean; tono?: "danger" | "primary" };

async function enviar(url: string, token: string, cuerpo: Record<string, unknown>, ok: string): Promise<boolean> {
  const r = await sendJsonAuth("POST", url, token, cuerpo);
  toast.success(String(r.message || ok));
  invalidate("sgc");
  return true;
}

/* Decision del revisor o del autorizador (de una revision o de una renovacion). */
export function DecisionDialog({ titulo, descripcion, url, opciones, onClose }: { titulo: string; descripcion: string; url: string; opciones: Opcion[]; onClose: () => void }) {
  const { token } = useSession();
  const [decision, setDecision] = useState(opciones[0].value);
  const [comentario, setComentario] = useState("");
  const [guardando, setGuardando] = useState(false);
  const op = opciones.find((o) => o.value === decision) || opciones[0];
  const v = useValidacion({ titulo: "No se pudo registrar la decisión", reglas: (): Problema[] => (op.comentario && comentario.trim().length < 5 ? [{ campo: "decision-comentario", mensaje: "Escribe el comentario (al menos 5 caracteres)" }] : []) });
  const guardar = async () => {
    if (!v.validar()) return;
    setGuardando(true);
    try {
      await enviar(url, token, { decision, comentario: comentario.trim() }, "Decisión registrada");
      if (decision === "autorizar") confirmarConCheck(/renovaciones/.test(url) ? "Renovación autorizada" : "Autorizada");
      onClose();
    } catch (err) {
      v.errorServidor(err, { comentario: "decision-comentario", decision: "decision-comentario" });
    } finally {
      setGuardando(false);
    }
  };
  return (
    <VentanaFormulario
      onOpenChange={(o) => !o && !guardando && onClose()}
      title={titulo}
      description={descripcion}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button variant={op.tono === "danger" ? "danger" : "primary"} loading={guardando} onClick={guardar} data-testid="decision-guardar">
            {op.label}
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <div className="flex flex-col gap-4">
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Decisión">
            {opciones.map((o) => (
              <ChoiceCard key={o.value} type="radio" name="decision" checked={decision === o.value} onChange={() => setDecision(o.value)} label={o.label} description={o.descripcion} />
            ))}
          </div>
          <Field label={op.comentario ? "Comentario" : "Comentario (opcional)"} htmlFor="decision-comentario" required={op.comentario}>
            <Textarea id="decision-comentario" rows={3} value={comentario} onChange={(e) => setComentario(e.target.value)} />
          </Field>
        </div>
      </ValidacionAmbito>
    </VentanaFormulario>
  );
}

export const OPCIONES_REVISOR: Opcion[] = [
  { value: "aceptar", label: "Aceptar", descripcion: "Pasa a autorización", comentario: false },
  { value: "devolver", label: "Devolver", descripcion: "Vuelve al elaborador para corregir", comentario: true },
  { value: "rechazar", label: "Rechazar", descripcion: "Se cancela; la vigente sigue", comentario: true, tono: "danger" },
];
export const OPCIONES_AUTORIZADOR: Opcion[] = [
  { value: "autorizar", label: "Autorizar", descripcion: "Con tu contraseña", comentario: false },
  { value: "devolver", label: "Devolver", descripcion: "Vuelve al elaborador para corregir", comentario: true },
  { value: "rechazar", label: "Rechazar", descripcion: "Se cancela; la vigente sigue", comentario: true, tono: "danger" },
];
export const OPCIONES_RENOVACION_REVISOR: Opcion[] = [
  { value: "confirmar", label: "Confirmar vigencia", descripcion: "Sigue vigente sin cambios", comentario: true },
  { value: "rechazar", label: "Rechazar", descripcion: "Necesita cambios: se abrirá una nueva revisión", comentario: true, tono: "danger" },
];
export const OPCIONES_RENOVACION_AUTORIZADOR: Opcion[] = [
  { value: "autorizar", label: "Autorizar renovación", descripcion: "Con tu contraseña", comentario: false },
  { value: "rechazar", label: "Rechazar", descripcion: "No se renueva", comentario: true, tono: "danger" },
];

/* Publicar (Mejora Continua, contrasena): fechas de emision, vigencia y proxima revision (+3 anios por omision). */
export function PublicarDialog({ doc, revision, catalogos, distribucionAnterior, onClose }: { doc: FichaDocumento["item"]; revision: Revision; catalogos: Catalogos | null; distribucionAnterior: Distribucion | null; onClose: () => void }) {
  const { token } = useSession();
  const hoy = hoyLocal();
  const [emision, setEmision] = useState(hoy);
  const [vigencia, setVigencia] = useState(hoy);
  const [proxima, setProxima] = useState(sumarAnios(hoy, ANIOS_PROXIMA_REVISION));
  const [tocada, setTocada] = useState(false);
  const [comentario, setComentario] = useState("");
  const [guardando, setGuardando] = useState(false);
  // Distribucion (Fase 3): quien administra lecturas la define al publicar; si no, se conserva la de la revision anterior.
  const administra = !!catalogos?.yo.acciones.includes("documento_administrar_lecturas");
  const conservable = !!distribucionAnterior?.filas.length;
  const [definir, setDefinir] = useState(false);
  const [dest, setDest] = useState<Destinatarios>(destinatariosVacios);
  const v = useValidacion({
    titulo: "No se pudo publicar",
    reglas: (): Problema[] => {
      const out: Problema[] = [];
      if (definir && !dest.roles.length && !dest.usuarios.length) out.push({ campo: "pub-destinatarios", mensaje: "Elige al menos un rol o una persona, o desactiva «Definir la distribución»" });
      if (!emision) out.push({ campo: "pub-emision", mensaje: "Indica la fecha de emisión" });
      if (vigencia && emision && vigencia < emision) out.push({ campo: "pub-vigencia", mensaje: "La vigencia no puede empezar antes de la emisión" });
      if (proxima && proxima <= (vigencia || emision)) out.push({ campo: "pub-proxima", mensaje: "La próxima revisión debe ser posterior a la vigencia" });
      return out;
    },
  });
  const guardar = async () => {
    if (!v.validar()) return;
    setGuardando(true);
    try {
      await enviar(`${API_BASE_URL}/sgc/revisiones/${revision.id}/publicar`, token, { fecha_emision: emision, fecha_vigencia: vigencia, fecha_proxima_revision: proxima, comentario: comentario.trim(), ...(definir ? { distribucion: cuerpoDestinatarios(dest) } : {}) }, "Publicada");
      confirmarConCheck("Publicada");
      onClose();
    } catch (err) {
      v.errorServidor(err, { fecha_emision: "pub-emision", fecha_vigencia: "pub-vigencia", fecha_proxima_revision: "pub-proxima", roles: "pub-destinatarios", usuarios: "pub-destinatarios" });
    } finally {
      setGuardando(false);
    }
  };
  return (
    <VentanaFormulario
      onOpenChange={(o) => !o && !guardando && onClose()}
      title={`Publicar ${doc.clave} rev. ${revision.numero}`}
      description="Queda vigente y la anterior pasa a obsoleta. Se te pedirá tu contraseña."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button icon={<SealCheck size={16} />} loading={guardando} onClick={guardar} data-testid="publicar-guardar">
            Publicar
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <div className="flex flex-col gap-4">
          <Field label="Fecha de emisión" htmlFor="pub-emision" required>
            <DateInput
              id="pub-emision"
              value={emision}
              onChange={(x) => {
                setEmision(x);
                if (x && !tocada) setProxima(sumarAnios(x, ANIOS_PROXIMA_REVISION));
              }}
            />
          </Field>
          <MasOpciones llenos={conDato(comentario)} etiqueta="Más opciones (vigencia, próxima revisión y comentario)">
            <FormGrid>
              <Field label="Fecha de vigencia" htmlFor="pub-vigencia">
                <DateInput id="pub-vigencia" value={vigencia} onChange={setVigencia} />
              </Field>
              <Field label="Próxima revisión" htmlFor="pub-proxima" hint={`Por omisión, emisión + ${ANIOS_PROXIMA_REVISION} años`}>
                <DateInput
                  id="pub-proxima"
                  value={proxima}
                  onChange={(x) => {
                    setProxima(x);
                    setTocada(true);
                  }}
                />
              </Field>
            </FormGrid>
            <Field label="Comentario" htmlFor="pub-comentario">
              <Textarea id="pub-comentario" rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} />
            </Field>
          </MasOpciones>
          {administra ? (
            <div className="flex flex-col gap-3 border-t border-line pt-4" data-testid="pub-distribucion">
              <Switch checked={definir} onCheckedChange={setDefinir} label="Definir la distribución" description={conservable ? "Si no la defines, se conserva la de la revisión anterior (con acuses de lectura nuevos)." : "Destinatarios por rol o por persona, punto de uso y si requieren confirmar la lectura."} />
              {definir ? <SelectorDestinatarios valor={dest} onChange={setDest} catalogos={catalogos} prefijo="pub" plegarOpcionales /> : null}
            </div>
          ) : null}
        </div>
      </ValidacionAmbito>
    </VentanaFormulario>
  );
}

function SelectPersona({ id, etiqueta, valor, onChange, catalogos, accion }: { id: string; etiqueta: string; valor: string; onChange: (v: string) => void; catalogos: Catalogos | null; accion: AccionDocumental }) {
  return (
    <Field label={etiqueta} htmlFor={id} required>
      <Select id={id} value={valor} onChange={(e) => onChange(e.target.value)}>
        <option value="">Elige</option>
        {opcionesPersonas(catalogos?.personas || [], accion).map((p) => (
          <option key={p.id} value={String(p.id)}>
            {p.nombre}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/* Reasignar responsables (Mejora Continua, con motivo) mientras la revision no este autorizada. */
export function ReasignarDialog({ revision, catalogos, onClose }: { revision: Revision; catalogos: Catalogos | null; onClose: () => void }) {
  const { token } = useSession();
  const [r, setR] = useState({ elaborador_id: String(revision.elaborador_id || ""), revisor_id: String(revision.revisor_id || ""), autorizador_id: String(revision.autorizador_id || "") });
  const [limite, setLimite] = useState(revision.fecha_limite || "");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const v = useValidacion({
    titulo: "No se pudieron reasignar los responsables",
    reglas: (): Problema[] => {
      const out: Problema[] = [];
      const ids = Object.values(r).filter(Boolean);
      if (ids.length < 3) out.push({ campo: "rea-elaborador", mensaje: "Asigna a los tres responsables" });
      else if (new Set(ids).size !== 3) out.push({ campo: "rea-elaborador", mensaje: "Elaborador, revisor y autorizador deben ser tres personas distintas" });
      if (motivo.trim().length < MOTIVO_MIN_SGC) out.push({ campo: "rea-motivo", mensaje: `Indica el motivo (al menos ${MOTIVO_MIN_SGC} caracteres)` });
      return out;
    },
  });
  const guardar = async () => {
    if (!v.validar()) return;
    setGuardando(true);
    try {
      await enviar(`${API_BASE_URL}/sgc/revisiones/${revision.id}/reasignar`, token, { ...r, fecha_limite: limite || null, motivo: motivo.trim() }, "Responsables reasignados");
      onClose();
    } catch (err) {
      v.errorServidor(err, { motivo: "rea-motivo", responsables: "rea-elaborador", elaborador: "rea-elaborador", revisor: "rea-revisor", autorizador: "rea-autorizador", fecha_limite: "rea-limite" });
    } finally {
      setGuardando(false);
    }
  };
  return (
    <VentanaFormulario
      onOpenChange={(o) => !o && !guardando && onClose()}
      title={`Reasignar responsables · revisión ${revision.numero}`}
      description="Tres personas distintas; solo actúa quien queda asignado."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button icon={<UserSwitch size={16} />} loading={guardando} onClick={guardar} data-testid="reasignar-guardar">
            Reasignar
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <div className="flex flex-col gap-4">
          <FormGrid cols={3}>
            <SelectPersona id="rea-elaborador" etiqueta="Elaborador" valor={r.elaborador_id} onChange={(x) => setR((p) => ({ ...p, elaborador_id: x }))} catalogos={catalogos} accion="documento_elaborar" />
            <SelectPersona id="rea-revisor" etiqueta="Revisor" valor={r.revisor_id} onChange={(x) => setR((p) => ({ ...p, revisor_id: x }))} catalogos={catalogos} accion="documento_revisar" />
            <SelectPersona id="rea-autorizador" etiqueta="Autorizador" valor={r.autorizador_id} onChange={(x) => setR((p) => ({ ...p, autorizador_id: x }))} catalogos={catalogos} accion="documento_autorizar" />
          </FormGrid>
          <Field label="Motivo" htmlFor="rea-motivo" required>
            <Textarea id="rea-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </Field>
          <MasOpciones llenos={conDato(limite)}>
            <Field label="Fecha límite" htmlFor="rea-limite">
              <DateInput id="rea-limite" value={limite} onChange={setLimite} />
            </Field>
          </MasOpciones>
        </div>
      </ValidacionAmbito>
    </VentanaFormulario>
  );
}

/* Renovar sin cambios (Mejora Continua): revisor y autorizador y la nueva proxima revision. */
export function RenovarDialog({ doc, catalogos, onClose }: { doc: FichaDocumento["item"]; catalogos: Catalogos | null; onClose: () => void }) {
  const { token } = useSession();
  const [revisor, setRevisor] = useState("");
  const [autorizador, setAutorizador] = useState("");
  const [proxima, setProxima] = useState(sumarAnios(hoyLocal(), ANIOS_PROXIMA_REVISION));
  const [limite, setLimite] = useState("");
  const [guardando, setGuardando] = useState(false);
  const v = useValidacion({
    titulo: "No se pudo iniciar la renovación",
    reglas: (): Problema[] => {
      const out: Problema[] = [];
      if (!revisor) out.push({ campo: "ren-revisor", mensaje: "Elige al revisor" });
      if (!autorizador) out.push({ campo: "ren-autorizador", mensaje: "Elige al autorizador" });
      if (revisor && revisor === autorizador) out.push({ campo: "ren-autorizador", mensaje: "Revisor y autorizador deben ser personas distintas" });
      return out;
    },
  });
  const guardar = async () => {
    if (!v.validar()) return;
    setGuardando(true);
    try {
      await enviar(`${API_BASE_URL}/sgc/documentos/${doc.id}/renovar`, token, { revisor_id: revisor, autorizador_id: autorizador, fecha_proxima_revision: proxima, fecha_limite: limite || null }, "Renovación iniciada");
      onClose();
    } catch (err) {
      v.errorServidor(err, { revisor: "ren-revisor", autorizador: "ren-autorizador", responsables: "ren-autorizador", fecha_proxima_revision: "ren-proxima", fecha_limite: "ren-limite" });
    } finally {
      setGuardando(false);
    }
  };
  return (
    <VentanaFormulario
      onOpenChange={(o) => !o && !guardando && onClose()}
      title={`Renovar sin cambios · ${doc.clave}`}
      description="La misma revisión sigue vigente con una nueva fecha de próxima revisión."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button icon={<ArrowsClockwise size={16} />} loading={guardando} onClick={guardar} data-testid="renovar-guardar">
            Iniciar renovación
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <div className="flex flex-col gap-4">
          <FormGrid>
            <SelectPersona id="ren-revisor" etiqueta="Revisor" valor={revisor} onChange={setRevisor} catalogos={catalogos} accion="documento_revisar" />
            <SelectPersona id="ren-autorizador" etiqueta="Autorizador" valor={autorizador} onChange={setAutorizador} catalogos={catalogos} accion="documento_autorizar" />
          </FormGrid>
          <MasOpciones llenos={conDato(limite)}>
            <FormGrid>
              <Field label="Nueva próxima revisión" htmlFor="ren-proxima" hint={`Por omisión, hoy + ${ANIOS_PROXIMA_REVISION} años`}>
                <DateInput id="ren-proxima" value={proxima} onChange={setProxima} />
              </Field>
              <Field label="Fecha límite" htmlFor="ren-limite">
                <DateInput id="ren-limite" value={limite} onChange={setLimite} />
              </Field>
            </FormGrid>
          </MasOpciones>
        </div>
      </ValidacionAmbito>
    </VentanaFormulario>
  );
}

/* Declarar obsoleto sin reemplazo: crea una solicitud que aprueba otra persona (con documento_autorizar). */
export function ObsoletarDialog({ doc, onClose }: { doc: FichaDocumento["item"]; onClose: () => void }) {
  const { token } = useSession();
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const v = useValidacion({ titulo: "No se pudo solicitar", reglas: (): Problema[] => (motivo.trim().length < MOTIVO_MIN_SGC ? [{ campo: "obs-motivo", mensaje: `Indica el motivo (al menos ${MOTIVO_MIN_SGC} caracteres)` }] : []) });
  const guardar = async () => {
    if (!v.validar()) return;
    setGuardando(true);
    try {
      await enviar(`${API_BASE_URL}/sgc/documentos/${doc.id}/obsoletar`, token, { motivo: motivo.trim() }, "Solicitud creada");
      invalidate("solicitudes");
      onClose();
    } catch (err) {
      v.errorServidor(err, { motivo: "obs-motivo" });
    } finally {
      setGuardando(false);
    }
  };
  return (
    <VentanaFormulario
      onOpenChange={(o) => !o && !guardando && onClose()}
      title={`Declarar obsoleto · ${doc.clave}`}
      description="Sale de los puntos de uso y se conserva en el historial. Lo aprueba otra persona; se te pedirá tu contraseña."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button variant="danger" icon={<Prohibit size={16} />} loading={guardando} onClick={guardar} data-testid="obsoletar-guardar">
            Solicitar obsolescencia
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <Field label="Motivo" htmlFor="obs-motivo" required>
          <Textarea id="obs-motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Field>
      </ValidacionAmbito>
    </VentanaFormulario>
  );
}
