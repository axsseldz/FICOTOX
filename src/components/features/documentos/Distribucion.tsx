"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { BellRinging, BookOpenText, CheckCircle, Clock, MapPin, Plus, Trash, UsersThree } from "@phosphor-icons/react";
import { Callout } from "@/components/features/samples/FormLayout";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { Checkbox, Field, Input, Switch, Textarea } from "@/components/ui/Field";
import { Dialog, useConfirm } from "@/components/ui/Overlay";
import { Badge } from "@/components/ui/Primitives";
import { CampoValidado, useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { API_BASE_URL, sendJsonAuth } from "@/lib/client/api";
import { explicarError, type Problema } from "@/lib/client/mensajes";
import { invalidate } from "@/lib/client/store";
import { MOTIVO_MIN_SGC } from "@/lib/shared/documentos";
import { formatearFecha, formatearFechaHora } from "@/lib/shared/fechas";
import type { Catalogos, Distribucion, FilaDistribucion, Puede } from "./comun";

/*
 * Distribucion y lectura controlada (Fase 3, CA-11): destinatarios por rol o
 * por persona, punto de uso y lectura requerida; acuse "Confirmo que lei y
 * comprendi la revision N" ligado a usuario + revision. El servidor decide
 * (banderas "puede"); agregar o quitar destinatarios pide motivo y contrasena.
 */

export interface Destinatarios {
  roles: number[];
  usuarios: number[];
  punto_uso: string;
  requiere_lectura: boolean;
}
export const destinatariosVacios = (): Destinatarios => ({ roles: [], usuarios: [], punto_uso: "", requiere_lectura: true });

/* Seleccion de roles y personas (solo quienes pueden consultar vigentes; con lectura, quienes pueden confirmarla). */
export function SelectorDestinatarios({ valor, onChange, catalogos, prefijo }: { valor: Destinatarios; onChange: (v: Destinatarios) => void; catalogos: Catalogos | null; prefijo: string }) {
  const [filtro, setFiltro] = useState("");
  const roles = catalogos?.roles || [];
  const personas = useMemo(() => (catalogos?.personas || []).filter((p) => p.acciones.includes("documento_consultar_vigente")), [catalogos]);
  const visibles = personas.filter((p) => !filtro.trim() || p.nombre.toLowerCase().includes(filtro.trim().toLowerCase()));
  const alternar = (campo: "roles" | "usuarios", id: number) => onChange({ ...valor, [campo]: valor[campo].includes(id) ? valor[campo].filter((x) => x !== id) : [...valor[campo], id] });
  return (
    <div className="flex flex-col gap-4">
      <CampoValidado id={`${prefijo}-destinatarios`} className="grid gap-4 sm:grid-cols-2">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium text-ink">Por rol</legend>
          <div className="flex max-h-[220px] flex-col gap-2 overflow-y-auto rounded-[12px] bg-surface-2 p-3 ring-1 ring-line">
            {roles.map((r) => (
              <Checkbox key={r.id} checked={valor.roles.includes(r.id)} onChange={() => alternar("roles", r.id)} label={r.nombre} description={valor.requiere_lectura && !r.acusa ? "No puede confirmar lecturas" : undefined} disabled={valor.requiere_lectura && !r.acusa} data-testid="dist-rol" />
            ))}
            {!roles.length ? <span className="text-[12.5px] text-ink-3">Sin roles disponibles.</span> : null}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium text-ink">Por persona</legend>
          <Input small placeholder="Buscar persona" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Buscar persona" />
          <div className="flex max-h-[180px] flex-col gap-2 overflow-y-auto rounded-[12px] bg-surface-2 p-3 ring-1 ring-line">
            {visibles.map((p) => {
              const sinAcuse = valor.requiere_lectura && !p.acciones.includes("documento_acusar_lectura");
              return <Checkbox key={p.id} checked={valor.usuarios.includes(p.id)} onChange={() => alternar("usuarios", p.id)} label={p.nombre} description={sinAcuse ? "No puede confirmar lecturas" : undefined} disabled={sinAcuse} data-testid="dist-persona" />;
            })}
            {!visibles.length ? <span className="text-[12.5px] text-ink-3">Sin coincidencias.</span> : null}
          </div>
        </fieldset>
      </CampoValidado>
      <Field label="Punto de uso" htmlFor={`${prefijo}-punto`} hint="Dónde se usa el documento, por ejemplo «Área de extracción»">
        <Input id={`${prefijo}-punto`} maxLength={200} value={valor.punto_uso} onChange={(e) => onChange({ ...valor, punto_uso: e.target.value })} />
      </Field>
      <Switch checked={valor.requiere_lectura} onCheckedChange={(x) => onChange({ ...valor, requiere_lectura: x, ...(x ? { roles: valor.roles.filter((id) => roles.find((r) => r.id === id)?.acusa), usuarios: valor.usuarios.filter((id) => personas.find((p) => p.id === id)?.acciones.includes("documento_acusar_lectura")) } : {}) })} label="Requiere confirmación de lectura" description="Cada destinatario debe abrir el PDF vigente y confirmar que lo leyó y comprendió." />
    </div>
  );
}

export const cuerpoDestinatarios = (d: Destinatarios) => ({ roles: d.roles, usuarios: d.usuarios, punto_uso: d.punto_uso.trim() || null, requiere_lectura: d.requiere_lectura });

function AgregarDialog({ revisionId, numero, catalogos, onClose }: { revisionId: number; numero: number; catalogos: Catalogos | null; onClose: () => void }) {
  const { token } = useSession();
  const [d, setD] = useState<Destinatarios>(destinatariosVacios);
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const v = useValidacion({
    titulo: "No se pudo actualizar la distribución",
    reglas: (): Problema[] => {
      const out: Problema[] = [];
      if (!d.roles.length && !d.usuarios.length) out.push({ campo: "dist-destinatarios", mensaje: "Elige al menos un rol o una persona" });
      if (motivo.trim().length < MOTIVO_MIN_SGC) out.push({ campo: "dist-motivo", mensaje: `Escribe el motivo (al menos ${MOTIVO_MIN_SGC} caracteres)` });
      return out;
    },
  });
  const guardar = async () => {
    if (!v.validar()) return;
    setGuardando(true);
    try {
      const r = await sendJsonAuth("POST", `${API_BASE_URL}/sgc/revisiones/${revisionId}/distribucion`, token, { ...cuerpoDestinatarios(d), motivo: motivo.trim() });
      toast.success(String(r.message || "Distribución actualizada"));
      invalidate("sgc");
      onClose();
    } catch (err) {
      v.errorServidor(err, { roles: "dist-destinatarios", usuarios: "dist-destinatarios", destinatarios: "dist-destinatarios", motivo: "dist-motivo" });
    } finally {
      setGuardando(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !guardando && onClose()}
      title={`Agregar destinatarios · revisión ${numero}`}
      description="Quien tenga hoy el rol elegido (y quien lo reciba después) queda como destinatario. Se te pedirá tu contraseña."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button icon={<Plus size={16} />} loading={guardando} onClick={guardar} data-testid="dist-guardar">
            Agregar
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <div className="flex flex-col gap-4">
          <SelectorDestinatarios valor={d} onChange={setD} catalogos={catalogos} prefijo="dist" />
          <Field label="Motivo" htmlFor="dist-motivo" required>
            <Textarea id="dist-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </Field>
        </div>
      </ValidacionAmbito>
    </Dialog>
  );
}

function RetirarDialog({ fila, onClose }: { fila: FilaDistribucion; onClose: () => void }) {
  const { token } = useSession();
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const v = useValidacion({ titulo: "No se pudo retirar", reglas: (): Problema[] => (motivo.trim().length < MOTIVO_MIN_SGC ? [{ campo: "ret-motivo", mensaje: `Escribe el motivo (al menos ${MOTIVO_MIN_SGC} caracteres)` }] : []) });
  const guardar = async () => {
    if (!v.validar()) return;
    setGuardando(true);
    try {
      const r = await sendJsonAuth("POST", `${API_BASE_URL}/sgc/distribucion/${fila.id}/retirar`, token, { motivo: motivo.trim() });
      toast.success(String(r.message || "Destinatario retirado"));
      invalidate("sgc");
      onClose();
    } catch (err) {
      v.errorServidor(err, { motivo: "ret-motivo" });
    } finally {
      setGuardando(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !guardando && onClose()}
      title={`Quitar a ${fila.rol_nombre ? `el rol «${fila.rol_nombre}»` : fila.usuario_nombre}`}
      description="Deja de ser destinatario de esta revisión; los acuses ya registrados se conservan. Se te pedirá tu contraseña."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button variant="danger" icon={<Trash size={16} />} loading={guardando} onClick={guardar} data-testid="ret-guardar">
            Quitar
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <Field label="Motivo" htmlFor="ret-motivo" required>
          <Textarea id="ret-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Field>
      </ValidacionAmbito>
    </Dialog>
  );
}

/* Acuse de la persona bajo el visor de la revision vigente. */
export function AcuseLectura({ dist }: { dist: Distribucion }) {
  const { token } = useSession();
  const confirm = useConfirm();
  const [enviando, setEnviando] = useState(false);
  const mia = dist.mi_lectura;
  if (!mia?.requiere) return null;
  if (mia.leido_en)
    return (
      <p className="flex items-center gap-2 rounded-[12px] bg-success-soft px-3.5 py-2.5 text-[13.5px] text-success-text" data-testid="acuse-hecho">
        <CheckCircle size={17} weight="fill" aria-hidden="true" />
        Confirmaste la lectura de la revisión {dist.numero} el {formatearFechaHora(mia.leido_en)}.
      </p>
    );
  const acusar = async () => {
    const ok = await confirm({ title: `Confirmar la lectura de la revisión ${dist.numero}`, description: "Queda registrado con tu usuario, la revisión y la fecha y hora. No se puede deshacer.", confirmLabel: "Confirmo", tone: "primary" });
    if (!ok) return;
    setEnviando(true);
    try {
      const r = await sendJsonAuth("POST", `${API_BASE_URL}/sgc/revisiones/${dist.revision_id}/acusar`, token, {});
      toast.success(String(r.message || "Lectura confirmada"));
      invalidate("sgc");
    } catch (err) {
      const e = explicarError(err, "No se pudo confirmar la lectura");
      toast.error(e.que, { description: e.hacer });
    } finally {
      setEnviando(false);
    }
  };
  return (
    <div id="acuse" className="flex scroll-mt-24 flex-wrap items-center gap-3 rounded-[12px] bg-brand-soft px-4 py-3 ring-1 ring-brand/25" data-testid="acuse-pendiente">
      <BookOpenText size={20} weight="duotone" className="text-brand-strong" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-[13.5px] text-ink">
        Este documento te fue distribuido{mia.puntos.length ? ` (${mia.puntos.join(", ")})` : ""} y requiere que confirmes su lectura. Léelo en el visor y confirma.
      </span>
      <Button icon={<CheckCircle size={16} />} loading={enviando} disabled={!dist.puede.acusar.ok} title={dist.puede.acusar.motivo} onClick={() => void acusar()} data-testid="acuse-confirmar">
        Confirmo que leí y comprendí la revisión {dist.numero}
      </Button>
    </div>
  );
}

/* Seccion "Distribucion y lecturas" de la ficha. */
export function SeccionDistribucion({ dist, catalogos, obsoleto }: { dist: Distribucion | null; catalogos: Catalogos | null; obsoleto: boolean }) {
  const { token } = useSession();
  const confirm = useConfirm();
  const [agregar, setAgregar] = useState(false);
  const [retirar, setRetirar] = useState<FilaDistribucion | null>(null);
  const [recordando, setRecordando] = useState(false);
  if (!dist) return <p className="text-[13px] text-ink-3">{obsoleto ? "El documento está obsoleto: ya no se distribuye." : "Se define al publicar la revisión vigente."}</p>;
  const recordar = async () => {
    const ok = await confirm({ title: "Enviar recordatorio", description: "Las personas con la lectura pendiente reciben un aviso en la campana.", confirmLabel: "Enviar", tone: "primary" });
    if (!ok) return;
    setRecordando(true);
    try {
      const r = await sendJsonAuth("POST", `${API_BASE_URL}/sgc/revisiones/${dist.revision_id}/recordatorio`, token, {});
      toast.success(String(r.message || "Recordatorio enviado"));
      invalidate("sgc");
    } catch (err) {
      const e = explicarError(err, "No se pudo enviar el recordatorio");
      toast.error(e.que, { description: e.hacer });
    } finally {
      setRecordando(false);
    }
  };
  const sinDestinatarios = !dist.filas.length && !dist.puntos_uso.length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2">
        <span>Revisión {dist.numero}</span>
        {dist.puntos_uso.length ? (
          <span className="flex items-center gap-1">
            <MapPin size={14} aria-hidden="true" /> {dist.puntos_uso.join(" · ")}
          </span>
        ) : null}
        {dist.avance.total ? (
          <span className="flex items-center gap-2" data-testid="dist-avance" data-porcentaje={dist.avance.porcentaje ?? ""}>
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
              <span className="block h-full rounded-full bg-brand" style={{ width: `${dist.avance.porcentaje || 0}%` }} />
            </span>
            {dist.avance.leidos} de {dist.avance.total} leídas ({dist.avance.porcentaje} %)
          </span>
        ) : null}
      </div>
      {dist.completo ? (
        <>
          {dist.filas.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="Destinatarios definidos">
              {dist.filas.map((f) => (
                <li key={f.id} className="flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pl-3 pr-1.5 text-[12.5px] text-ink ring-1 ring-line" data-testid="dist-fila" title={[f.motivo, f.creado_por_nombre ? `por ${f.creado_por_nombre}` : null, formatearFecha(f.creado_en)].filter(Boolean).join(" · ")}>
                  {f.rol_nombre ? <UsersThree size={13} aria-hidden="true" /> : null}
                  {f.rol_nombre ? `Rol: ${f.rol_nombre}` : f.usuario_nombre}
                  {f.requiere_lectura ? <Badge tone="brand">Lectura</Badge> : null}
                  {dist.puede.administrar.ok ? (
                    <button type="button" className="ml-0.5 rounded-full p-1 text-ink-3 hover:bg-surface-3 hover:text-danger-text focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none" aria-label={`Quitar ${f.rol_nombre || f.usuario_nombre}`} onClick={() => setRetirar(f)} data-testid="dist-quitar">
                      <Trash size={13} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">Sin destinatarios definidos.</p>
          )}
          {dist.destinatarios.length ? (
            <ul className="flex flex-col divide-y divide-line rounded-[12px] ring-1 ring-line" data-testid="dist-lecturas" aria-label="Lecturas por persona">
              {dist.destinatarios.map((d) => (
                <li key={d.usuario_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]" data-testid="dist-persona-estado" data-leido={d.leido_en ? "1" : "0"}>
                  <span className="min-w-0 flex-1 font-medium text-ink">{d.nombre}</span>
                  {!d.requiere ? (
                    <span className="text-[12px] text-ink-3">Solo consulta</span>
                  ) : d.leido_en ? (
                    <Badge tone="success" className="gap-1">
                      <CheckCircle size={12} weight="bold" aria-hidden="true" /> Leído {formatearFechaHora(d.leido_en)}
                    </Badge>
                  ) : (
                    <Badge tone="warning" className="gap-1">
                      <Clock size={12} weight="bold" aria-hidden="true" /> Pendiente{d.notificado_en ? ` · recordado ${formatearFecha(d.notificado_en)}` : ""}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : sinDestinatarios ? (
        <p className="text-[13px] text-ink-3">Sin distribución definida.</p>
      ) : null}
      {dist.puede.administrar.ok ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<Plus size={15} />} onClick={() => setAgregar(true)} data-testid="dist-agregar">
            Agregar destinatarios
          </Button>
          <Boton puede={dist.puede.recordatorio} onClick={() => void recordar()} cargando={recordando} />
        </div>
      ) : null}
      {agregar ? <AgregarDialog revisionId={dist.revision_id} numero={dist.numero} catalogos={catalogos} onClose={() => setAgregar(false)} /> : null}
      {retirar ? <RetirarDialog fila={retirar} onClose={() => setRetirar(null)} /> : null}
    </div>
  );
}

function Boton({ puede, onClick, cargando }: { puede: Puede; onClick: () => void; cargando: boolean }) {
  if (!puede.ok && !puede.motivo) return null;
  return (
    <span className="flex flex-col items-start gap-1">
      <Button size="sm" variant="secondary" icon={<BellRinging size={15} />} disabled={!puede.ok} title={puede.motivo} loading={cargando} onClick={onClick} data-testid="dist-recordatorio">
        Enviar recordatorio
      </Button>
      {!puede.ok && puede.motivo ? <span className={cn("text-[11.5px] text-ink-3")}>{puede.motivo}</span> : null}
    </span>
  );
}

/* Aviso informativo cuando la persona no ve la lista completa. */
export function AvisoDistribucionParcial() {
  return <Callout tone="info" title="Distribución">Ves el punto de uso y tu propia lectura; la lista por persona la consulta Mejora Continua.</Callout>;
}
