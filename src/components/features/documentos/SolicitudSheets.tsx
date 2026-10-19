"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle, PaperPlaneTilt, XCircle } from "@phosphor-icons/react";
import { ChoiceCard } from "@/components/features/samples/FormLayout";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { DateInput } from "@/components/ui/DateInput";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/Field";
import { CampoValidado, useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { API_BASE_URL, getJsonAuth, sendFormAuth, sendJsonAuth } from "@/lib/client/api";
import { type Problema } from "@/lib/client/mensajes";
import { invalidate, useResource } from "@/lib/client/store";
import { extensionDe } from "@/lib/shared/adjuntos";
import { CONFIDENCIALIDADES, MOTIVO_MIN_SGC, normalizarClave, validarClave } from "@/lib/shared/documentos";
import type { AccionDocumental } from "@/lib/shared/permisos";
import type { Catalogos } from "./comun";
import { opcionesPersonas } from "./FichaSheet";
import { conDato, MasOpciones, VentanaFormulario } from "./VentanaFormulario";

export interface SolicitudSgc {
  id: number;
  tipo: "nuevo" | "cambio";
  documento_id: number | null;
  documento_clave: string | null;
  documento_titulo: string | null;
  area_codigo: string | null;
  tipo_codigo: string | null;
  titulo_propuesto: string | null;
  necesidad: string | null;
  justificacion: string;
  solicitante_id: number;
  solicitante_nombre: string | null;
  estado: "pendiente" | "aceptada" | "rechazada";
  resuelta_por_nombre: string | null;
  resuelta_en: string | null;
  comentario_resolucion: string | null;
  revision_id: number | null;
  clave_asignada: string | null;
  creado_en: string;
  con_apoyo: boolean;
  puede: { atender: boolean };
}

const EXT_APOYO = ["pdf", "docx", "xlsx", "xls", "pptx", "png", "jpg", "jpeg"];

/* Nueva solicitud (documento_proponer): documento nuevo o cambio a uno existente, con justificacion y archivo de apoyo opcional. */
export function SolicitudSheet({ catalogos, documento, onClose }: { catalogos: Catalogos | null; documento?: { id: number; clave: string; titulo: string } | null; onClose: () => void }) {
  const { token } = useSession();
  const [tipo, setTipo] = useState<"nuevo" | "cambio">(documento ? "cambio" : "nuevo");
  const [area, setArea] = useState("");
  const [tipoDoc, setTipoDoc] = useState("");
  const [titulo, setTitulo] = useState("");
  const [docId, setDocId] = useState(documento ? String(documento.id) : "");
  const [necesidad, setNecesidad] = useState("");
  const [justificacion, setJustificacion] = useState("");
  const [apoyo, setApoyo] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const docs = useResource<Array<{ id: number; clave: string; titulo: string }>>("sgc", async () => ((await getJsonAuth(`${API_BASE_URL}/sgc/documentos`, token)).items || []) as Array<{ id: number; clave: string; titulo: string }>, { enabled: !!token && !documento && tipo === "cambio", deps: [tipo] });
  const v = useValidacion({
    titulo: "No se pudo registrar la solicitud",
    reglas: (): Problema[] => {
      const out: Problema[] = [];
      if (tipo === "nuevo") {
        if (!area) out.push({ campo: "sol-area", mensaje: "Elige el área de gestión" });
        if (!tipoDoc) out.push({ campo: "sol-tipo", mensaje: "Elige el tipo documental" });
        if (!titulo.trim()) out.push({ campo: "sol-titulo", mensaje: "Escribe el título propuesto" });
      } else if (!docId) out.push({ campo: "sol-documento", mensaje: "Indica el documento" });
      if (justificacion.trim().length < 10) out.push({ campo: "sol-justificacion", mensaje: "Escribe la justificación (al menos 10 caracteres)" });
      if (apoyo && !EXT_APOYO.includes(extensionDe(apoyo.name))) out.push({ campo: "sol-apoyo", mensaje: `Formato no permitido; se aceptan: ${EXT_APOYO.join(", ")}` });
      return out;
    },
  });
  const guardar = async () => {
    if (!v.validar()) return;
    setGuardando(true);
    try {
      const fd = new FormData();
      fd.append("tipo", tipo);
      if (tipo === "nuevo") {
        fd.append("area_codigo", area);
        fd.append("tipo_codigo", tipoDoc);
        fd.append("titulo_propuesto", titulo.trim());
      } else fd.append("documento_id", docId);
      if (necesidad.trim()) fd.append("necesidad", necesidad.trim());
      fd.append("justificacion", justificacion.trim());
      if (apoyo) fd.append("archivo", apoyo);
      const r = await sendFormAuth(`${API_BASE_URL}/sgc/solicitudes`, token, fd);
      toast.success(String(r.message || "Solicitud registrada"));
      invalidate("sgc");
      onClose();
    } catch (err) {
      v.errorServidor(err, { tipo: "sol-tipo", area: "sol-area", tipo_documental: "sol-tipo", titulo: "sol-titulo", documento: "sol-documento", justificacion: "sol-justificacion", archivo: "sol-apoyo" });
    } finally {
      setGuardando(false);
    }
  };
  return (
    <VentanaFormulario
      onOpenChange={(o) => !o && !guardando && onClose()}
      title="Nueva solicitud"
      description="Mejora Continua la revisa y, si la acepta, crea la ficha o abre la revisión."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button icon={<PaperPlaneTilt size={16} />} loading={guardando} onClick={guardar} data-testid="solicitud-guardar">
            Enviar solicitud
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <div className="flex flex-col gap-5">
          {!documento ? (
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Tipo de solicitud">
              <ChoiceCard type="radio" name="sol-tipo" checked={tipo === "nuevo"} onChange={() => setTipo("nuevo")} label="Documento nuevo" description="Proponer un documento que no existe" />
              <ChoiceCard type="radio" name="sol-tipo" checked={tipo === "cambio"} onChange={() => setTipo("cambio")} label="Cambio a un documento" description="Una nueva revisión de uno existente" />
            </div>
          ) : null}
          {tipo === "nuevo" ? (
            <FormGrid>
              <Field label="Área de gestión" htmlFor="sol-area" required>
                <Select id="sol-area" value={area} onChange={(e) => setArea(e.target.value)}>
                  <option value="">Elige el área</option>
                  {(catalogos?.areas || []).map((a) => (
                    <option key={a.codigo} value={a.codigo}>
                      {a.codigo} · {a.nombre}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tipo documental" htmlFor="sol-tipo" required>
                <Select id="sol-tipo" value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value)}>
                  <option value="">Elige el tipo</option>
                  {(catalogos?.tipos || []).map((t) => (
                    <option key={t.codigo} value={t.codigo}>
                      {t.codigo} · {t.nombre}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Título propuesto" htmlFor="sol-titulo" required className="sm:col-span-2">
                <Input id="sol-titulo" maxLength={300} value={titulo} onChange={(e) => setTitulo(e.target.value)} />
              </Field>
            </FormGrid>
          ) : documento ? (
            <p className="rounded-box bg-surface-2 px-3.5 py-2.5 text-sm text-ink ring-1 ring-line">
              Cambio a <span className="code font-semibold">{documento.clave}</span> · {documento.titulo}
            </p>
          ) : (
            <Field label="Documento" htmlFor="sol-documento" required>
              <Select id="sol-documento" value={docId} onChange={(e) => setDocId(e.target.value)}>
                <option value="">Elige el documento</option>
                {(docs.data || []).map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    {d.clave} · {d.titulo}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Justificación" htmlFor="sol-justificacion" required>
            <Textarea id="sol-justificacion" rows={3} value={justificacion} onChange={(e) => setJustificacion(e.target.value)} />
          </Field>
          <MasOpciones llenos={conDato(necesidad, apoyo)}>
            <Field label="Necesidad" htmlFor="sol-necesidad">
              <Textarea id="sol-necesidad" rows={2} value={necesidad} onChange={(e) => setNecesidad(e.target.value)} />
            </Field>
            <CampoValidado id="sol-apoyo" className="flex flex-col gap-1.5">
              <label htmlFor="sol-apoyo-input" className="text-sm font-medium text-ink">
                Archivo de apoyo
              </label>
              <input id="sol-apoyo-input" type="file" accept={EXT_APOYO.map((e) => `.${e}`).join(",")} onChange={(e) => setApoyo(e.target.files?.[0] || null)} className="text-sm text-ink-2 file:mr-3 file:rounded-control file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink file:shadow-card" />
            </CampoValidado>
          </MasOpciones>
        </div>
      </ValidacionAmbito>
    </VentanaFormulario>
  );
}

function Persona({ id, etiqueta, valor, onChange, catalogos, accion }: { id: string; etiqueta: string; valor: string; onChange: (v: string) => void; catalogos: Catalogos | null; accion: AccionDocumental }) {
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

/* Aceptar (Mejora Continua): nuevo -> ficha con la clave autorizada; cambio -> revision de trabajo. Siempre tres responsables. */
export function AceptarSolicitudSheet({ solicitud, catalogos, onClose }: { solicitud: SolicitudSgc; catalogos: Catalogos | null; onClose: () => void }) {
  const { token } = useSession();
  const router = useRouter();
  const nuevo = solicitud.tipo === "nuevo";
  const [clave, setClave] = useState("");
  const [titulo, setTitulo] = useState(solicitud.titulo_propuesto || "");
  const [confidencialidad, setConfidencialidad] = useState("uso_interno");
  const [propietario, setPropietario] = useState(String(solicitud.solicitante_id || ""));
  const [r, setR] = useState({ elaborador_id: "", revisor_id: "", autorizador_id: "" });
  const [limite, setLimite] = useState("");
  const [comentario, setComentario] = useState("");
  const [guardando, setGuardando] = useState(false);
  const area = solicitud.area_codigo || "";
  const tipo = solicitud.tipo_codigo || "";
  const vClave = validarClave(clave, area, tipo);
  const v = useValidacion({
    titulo: "No se pudo aceptar la solicitud",
    reglas: (): Problema[] => {
      const out: Problema[] = [];
      if (nuevo && vClave.problema) out.push({ campo: "acep-clave", mensaje: vClave.problema });
      if (nuevo && !titulo.trim()) out.push({ campo: "acep-titulo", mensaje: "Escribe el título" });
      const ids = Object.values(r).filter(Boolean);
      if (ids.length < 3) out.push({ campo: "acep-elaborador", mensaje: "Asigna elaborador, revisor y autorizador" });
      else if (new Set(ids).size !== 3) out.push({ campo: "acep-elaborador", mensaje: "Elaborador, revisor y autorizador deben ser tres personas distintas" });
      return out;
    },
  });
  const guardar = async () => {
    if (!v.validar()) return;
    setGuardando(true);
    try {
      const cuerpo: Record<string, unknown> = { ...r, fecha_limite: limite || null, comentario: comentario.trim() };
      if (nuevo) Object.assign(cuerpo, { clave: normalizarClave(clave), titulo: titulo.trim(), area_codigo: area, tipo_codigo: tipo, confidencialidad, propietario_id: propietario || null });
      const res = await sendJsonAuth("POST", `${API_BASE_URL}/sgc/solicitudes/${solicitud.id}/aceptar`, token, cuerpo);
      toast.success(String(res.message || "Solicitud aceptada"));
      invalidate("sgc");
      onClose();
      if (res.documento_id) router.push(`/documentos/${res.documento_id}`);
    } catch (err) {
      v.errorServidor(err, { clave: "acep-clave", titulo: "acep-titulo", responsables: "acep-elaborador", elaborador: "acep-elaborador", revisor: "acep-revisor", autorizador: "acep-autorizador", fecha_limite: "acep-limite", confidencialidad: "acep-conf" });
    } finally {
      setGuardando(false);
    }
  };
  return (
    <VentanaFormulario
      onOpenChange={(o) => !o && !guardando && onClose()}
      title={`Aceptar la solicitud #${solicitud.id}`}
      description={nuevo ? "Con la clave FX autorizada se crea la ficha con la revisión en borrador." : `Se abre una revisión de trabajo de ${solicitud.documento_clave || "el documento"}; la vigente no cambia.`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button icon={<CheckCircle size={16} />} loading={guardando} onClick={guardar} data-testid="aceptar-guardar">
            Aceptar y asignar
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <div className="flex flex-col gap-5">
          <p className="whitespace-pre-line rounded-box bg-surface-2 px-3.5 py-2.5 text-sm text-ink-2 ring-1 ring-line">
            <span className="font-medium text-ink">Justificación:</span> {solicitud.justificacion}
          </p>
          {nuevo ? (
            <FormGrid>
              <Field label="Clave FX autorizada" htmlFor="acep-clave" required hint={`Área ${area} · tipo ${tipo}`}>
                <Input id="acep-clave" mono maxLength={80} value={clave} onChange={(e) => setClave(e.target.value)} placeholder={`FX-${area}${tipo}-`} autoComplete="off" />
              </Field>
              <Field label="Título" htmlFor="acep-titulo" required>
                <Input id="acep-titulo" maxLength={300} value={titulo} onChange={(e) => setTitulo(e.target.value)} />
              </Field>
            </FormGrid>
          ) : null}
          <FormGrid cols={3}>
            <Persona id="acep-elaborador" etiqueta="Elaborador" valor={r.elaborador_id} onChange={(x) => setR((p) => ({ ...p, elaborador_id: x }))} catalogos={catalogos} accion="documento_elaborar" />
            <Persona id="acep-revisor" etiqueta="Revisor" valor={r.revisor_id} onChange={(x) => setR((p) => ({ ...p, revisor_id: x }))} catalogos={catalogos} accion="documento_revisar" />
            <Persona id="acep-autorizador" etiqueta="Autorizador" valor={r.autorizador_id} onChange={(x) => setR((p) => ({ ...p, autorizador_id: x }))} catalogos={catalogos} accion="documento_autorizar" />
          </FormGrid>
          <MasOpciones llenos={conDato(limite, comentario, ...(nuevo ? [confidencialidad !== "uso_interno" ? confidencialidad : ""] : []))}>
            {nuevo ? (
              <FormGrid>
                <Field label="Confidencialidad" htmlFor="acep-conf">
                  <Select id="acep-conf" value={confidencialidad} onChange={(e) => setConfidencialidad(e.target.value)}>
                    {CONFIDENCIALIDADES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Propietario" htmlFor="acep-propietario">
                  <Select id="acep-propietario" value={propietario} onChange={(e) => setPropietario(e.target.value)}>
                    <option value="">Sin asignar</option>
                    {(catalogos?.personas || []).map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.nombre}
                      </option>
                    ))}
                  </Select>
                </Field>
              </FormGrid>
            ) : null}
            <FormGrid>
              <Field label="Fecha límite" htmlFor="acep-limite">
                <DateInput id="acep-limite" value={limite} onChange={setLimite} />
              </Field>
              <Field label="Comentario" htmlFor="acep-comentario">
                <Input id="acep-comentario" maxLength={400} value={comentario} onChange={(e) => setComentario(e.target.value)} />
              </Field>
            </FormGrid>
          </MasOpciones>
        </div>
      </ValidacionAmbito>
    </VentanaFormulario>
  );
}

export function RechazarSolicitudDialog({ solicitud, onClose }: { solicitud: SolicitudSgc; onClose: () => void }) {
  const { token } = useSession();
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const v = useValidacion({ titulo: "No se pudo rechazar", reglas: (): Problema[] => (motivo.trim().length < MOTIVO_MIN_SGC ? [{ campo: "rech-motivo", mensaje: `Indica el motivo (al menos ${MOTIVO_MIN_SGC} caracteres)` }] : []) });
  const guardar = async () => {
    if (!v.validar()) return;
    setGuardando(true);
    try {
      const res = await sendJsonAuth("POST", `${API_BASE_URL}/sgc/solicitudes/${solicitud.id}/rechazar`, token, { motivo: motivo.trim() });
      toast.success(String(res.message || "Solicitud rechazada"));
      invalidate("sgc");
      onClose();
    } catch (err) {
      v.errorServidor(err, { motivo: "rech-motivo" });
    } finally {
      setGuardando(false);
    }
  };
  return (
    <VentanaFormulario
      size="sm"
      onOpenChange={(o) => !o && !guardando && onClose()}
      title={`Rechazar la solicitud #${solicitud.id}`}
      description="Quien la pidió recibe el aviso con el motivo."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button variant="danger" icon={<XCircle size={16} />} loading={guardando} onClick={guardar} data-testid="rechazar-guardar">
            Rechazar
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <Field label="Motivo" htmlFor="rech-motivo" required>
          <Textarea id="rech-motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Field>
      </ValidacionAmbito>
    </VentanaFormulario>
  );
}
