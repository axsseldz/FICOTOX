"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowSquareOut, CheckCircle, FilePlus, Globe, PencilSimple, SealCheck } from "@phosphor-icons/react";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { DateInput } from "@/components/ui/DateInput";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/Field";
import { CampoValidado, useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { API_BASE_URL, sendFormAuth, sendJsonAuth } from "@/lib/client/api";
import { type Problema } from "@/lib/client/mensajes";
import { invalidate } from "@/lib/client/store";
import { CONFIDENCIALIDADES, enlaceValido, MOTIVO_MIN_SGC, normalizarClave, validarIdentificadorExterno } from "@/lib/shared/documentos";
import { formatearFecha, hoyLocal, sumarDias } from "@/lib/shared/fechas";
import type { Catalogos, DatosExterno } from "./comun";
import { conDato, MasOpciones, VentanaFormulario } from "./VentanaFormulario";

/*
 * Documentos externos (Fase 3, CA-10): normas, guias y documentos
 * regulatorios. No pasan por elaboracion, revision ni autorizacion: Mejora
 * Continua los registra vigentes (con contrasena); el responsable de
 * seguimiento o Mejora Continua verifica su vigencia; una nueva version deja
 * obsoleta la anterior (con contrasena).
 */

const responsables = (c: Catalogos | null) => (c?.personas || []).filter((p) => p.acciones.includes("documento_consultar_vigente"));
const unAnio = () => sumarDias(hoyLocal(), 365);

function CampoPdf({ id, onChange }: { id: string; onChange: (f: File | null) => void }) {
  return (
    <CampoValidado id={id} className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-input`} className="text-[13px] font-medium text-ink">
        PDF (solo si hay derechos de uso)
      </label>
      <input id={`${id}-input`} type="file" accept=".pdf,application/pdf" onChange={(e) => onChange(e.target.files?.[0] || null)} className="text-[13px] text-ink-2 file:mr-3 file:rounded-[8px] file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-ink file:shadow-card" />
    </CampoValidado>
  );
}

export function RegistrarExternoSheet({ catalogos, onClose }: { catalogos: Catalogos | null; onClose: () => void }) {
  const { token } = useSession();
  const router = useRouter();
  const [d, setD] = useState({ identificador: "", titulo: "", area_codigo: "", tipo_codigo: "", confidencialidad: "uso_interno", fuente: "", version_fecha: "", enlace: "", responsable_id: "", ultima_verificacion: hoyLocal(), proxima_revision: unAnio(), palabras_clave: "", comentario: "" });
  const [pdf, setPdf] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const set = (k: keyof typeof d, v: string) => setD((x) => ({ ...x, [k]: v }));
  const v = useValidacion({
    titulo: "No se pudo registrar el documento externo",
    reglas: (): Problema[] => {
      const out: Problema[] = [];
      const idf = validarIdentificadorExterno(d.identificador);
      if (idf.problema) out.push({ campo: "ext-id", mensaje: idf.problema });
      if (!d.titulo.trim()) out.push({ campo: "ext-titulo", mensaje: "Escribe el título" });
      if (!d.area_codigo) out.push({ campo: "ext-area", mensaje: "Elige el área de gestión" });
      if (!d.tipo_codigo) out.push({ campo: "ext-tipo", mensaje: "Elige el tipo documental" });
      if (!d.fuente.trim()) out.push({ campo: "ext-fuente", mensaje: "Indica el emisor o fuente" });
      if (!d.version_fecha.trim()) out.push({ campo: "ext-version", mensaje: "Indica la versión o fecha de edición" });
      if (d.enlace.trim() && !enlaceValido(d.enlace)) out.push({ campo: "ext-enlace", mensaje: "El enlace debe ser una dirección http(s) válida" });
      if (!d.responsable_id) out.push({ campo: "ext-responsable", mensaje: "Elige al responsable de seguimiento" });
      if (!d.proxima_revision || d.proxima_revision <= d.ultima_verificacion) out.push({ campo: "ext-proxima", mensaje: "La próxima revisión debe ser posterior a la última verificación" });
      if (pdf && !/\.pdf$/i.test(pdf.name)) out.push({ campo: "ext-pdf", mensaje: "El archivo debe ser PDF" });
      return out;
    },
  });
  const guardar = async () => {
    if (!v.validar()) return;
    setGuardando(true);
    try {
      const fd = new FormData();
      for (const [k, val] of Object.entries(d)) if (String(val).trim()) fd.append(k, String(val).trim());
      if (pdf) fd.append("archivo_pdf", pdf);
      const r = await sendFormAuth(`${API_BASE_URL}/sgc/externos`, token, fd);
      toast.success(String(r.message || "Documento externo registrado"));
      invalidate("sgc");
      onClose();
      if (r.id) router.push(`/documentos/${r.id}`);
    } catch (err) {
      v.errorServidor(err, { clave: "ext-id", titulo: "ext-titulo", area: "ext-area", tipo: "ext-tipo", fuente: "ext-fuente", version_fecha: "ext-version", enlace: "ext-enlace", responsable: "ext-responsable", proxima_revision: "ext-proxima", ultima_verificacion: "ext-ultima", archivo_pdf: "ext-pdf" });
    } finally {
      setGuardando(false);
    }
  };
  return (
    <VentanaFormulario
      onOpenChange={(o) => !o && !guardando && onClose()}
      title="Registrar externo"
      description="Normas, guías y documentos regulatorios; quedan vigentes sin flujo de aprobación. Se te pedirá tu contraseña."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button icon={<SealCheck size={16} />} loading={guardando} onClick={guardar} data-testid="ext-guardar">
            Registrar como vigente
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <div className="flex flex-col gap-5">
          <FormGrid>
            <Field label="Identificador del emisor" htmlFor="ext-id" required hint={d.identificador ? `Se guardará como ${normalizarClave(d.identificador)}` : "Por ejemplo NMX-EC-17025-IMNC-2018"}>
              <Input id="ext-id" mono value={d.identificador} onChange={(e) => set("identificador", e.target.value)} />
            </Field>
            <Field label="Emisor o fuente" htmlFor="ext-fuente" required>
              <Input id="ext-fuente" maxLength={200} value={d.fuente} onChange={(e) => set("fuente", e.target.value)} placeholder="IMNC, SSA, AOAC…" />
            </Field>
            <Field label="Título" htmlFor="ext-titulo" required className="sm:col-span-2">
              <Input id="ext-titulo" maxLength={300} value={d.titulo} onChange={(e) => set("titulo", e.target.value)} />
            </Field>
            <Field label="Área de gestión" htmlFor="ext-area" required>
              <Select id="ext-area" value={d.area_codigo} onChange={(e) => set("area_codigo", e.target.value)}>
                <option value="">Elige el área</option>
                {(catalogos?.areas || []).filter((a) => Number(a.activo ?? 1)).map((a) => (
                  <option key={a.codigo} value={a.codigo}>
                    {a.codigo} · {a.nombre}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tipo documental" htmlFor="ext-tipo" required>
              <Select id="ext-tipo" value={d.tipo_codigo} onChange={(e) => set("tipo_codigo", e.target.value)}>
                <option value="">Elige el tipo</option>
                {(catalogos?.tipos || []).map((t) => (
                  <option key={t.codigo} value={t.codigo}>
                    {t.codigo} · {t.nombre}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Versión o fecha de edición" htmlFor="ext-version" required>
              <Input id="ext-version" maxLength={80} value={d.version_fecha} onChange={(e) => set("version_fecha", e.target.value)} placeholder="2018" />
            </Field>
            <Field label="Responsable de seguimiento" htmlFor="ext-responsable" required>
              <Select id="ext-responsable" value={d.responsable_id} onChange={(e) => set("responsable_id", e.target.value)}>
                <option value="">Elige</option>
                {responsables(catalogos).map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.nombre}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Próxima revisión" htmlFor="ext-proxima" required>
              <DateInput id="ext-proxima" value={d.proxima_revision} onChange={(x) => set("proxima_revision", x)} />
            </Field>
          </FormGrid>
          <MasOpciones llenos={conDato(d.enlace, d.palabras_clave, d.comentario, pdf, d.confidencialidad !== "uso_interno" ? d.confidencialidad : "")}>
            <FormGrid>
              <Field label="Enlace de consulta" htmlFor="ext-enlace" className="sm:col-span-2">
                <Input id="ext-enlace" type="url" value={d.enlace} onChange={(e) => set("enlace", e.target.value)} placeholder="https://" />
              </Field>
              <Field label="Confidencialidad" htmlFor="ext-conf">
                <Select id="ext-conf" value={d.confidencialidad} onChange={(e) => set("confidencialidad", e.target.value)}>
                  {CONFIDENCIALIDADES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Última verificación de vigencia" htmlFor="ext-ultima">
                <DateInput id="ext-ultima" value={d.ultima_verificacion} onChange={(x) => set("ultima_verificacion", x)} />
              </Field>
              <Field label="Palabras clave" htmlFor="ext-palabras" hint="Separadas por coma" className="sm:col-span-2">
                <Input id="ext-palabras" value={d.palabras_clave} onChange={(e) => set("palabras_clave", e.target.value)} />
              </Field>
            </FormGrid>
            <CampoPdf id="ext-pdf" onChange={setPdf} />
            <Field label="Comentario" htmlFor="ext-comentario">
              <Textarea id="ext-comentario" rows={2} value={d.comentario} onChange={(e) => set("comentario", e.target.value)} />
            </Field>
          </MasOpciones>
        </div>
      </ValidacionAmbito>
    </VentanaFormulario>
  );
}

export function VerificarExternoDialog({ docId, clave, onClose }: { docId: number; clave: string; onClose: () => void }) {
  const { token } = useSession();
  const [comentario, setComentario] = useState("");
  const [proxima, setProxima] = useState(unAnio());
  const [guardando, setGuardando] = useState(false);
  const v = useValidacion({
    titulo: "No se pudo confirmar la vigencia",
    reglas: (): Problema[] => {
      const out: Problema[] = [];
      if (comentario.trim().length < MOTIVO_MIN_SGC) out.push({ campo: "ver-comentario", mensaje: `Escribe cómo verificaste la vigencia (al menos ${MOTIVO_MIN_SGC} caracteres)` });
      if (!proxima || proxima <= hoyLocal()) out.push({ campo: "ver-proxima", mensaje: "La próxima revisión debe ser posterior a hoy" });
      return out;
    },
  });
  const guardar = async () => {
    if (!v.validar()) return;
    setGuardando(true);
    try {
      const r = await sendJsonAuth("POST", `${API_BASE_URL}/sgc/externos/${docId}/verificar`, token, { comentario: comentario.trim(), proxima_revision: proxima });
      toast.success(String(r.message || "Vigencia confirmada"));
      invalidate("sgc");
      onClose();
    } catch (err) {
      v.errorServidor(err, { comentario: "ver-comentario", proxima_revision: "ver-proxima" });
    } finally {
      setGuardando(false);
    }
  };
  return (
    <VentanaFormulario
      onOpenChange={(o) => !o && !guardando && onClose()}
      title={`Verificar la vigencia de ${clave}`}
      description="Confirma que la versión registrada sigue vigente; si hay una nueva, regístrala en su lugar."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button icon={<CheckCircle size={16} />} loading={guardando} onClick={guardar} data-testid="ver-guardar">
            Sigue vigente
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <div className="flex flex-col gap-4">
          <Field label="Comentario de la verificación" htmlFor="ver-comentario" required>
            <Textarea id="ver-comentario" rows={3} value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Por ejemplo: consultado el catálogo del IMNC, sin nueva edición" />
          </Field>
          <Field label="Próxima revisión" htmlFor="ver-proxima" required>
            <DateInput id="ver-proxima" value={proxima} onChange={setProxima} />
          </Field>
        </div>
      </ValidacionAmbito>
    </VentanaFormulario>
  );
}

export function NuevaVersionExternoDialog({ docId, clave, ext, onClose }: { docId: number; clave: string; ext: DatosExterno; onClose: () => void }) {
  const { token } = useSession();
  const [version, setVersion] = useState("");
  const [enlace, setEnlace] = useState(ext.enlace || "");
  const [proxima, setProxima] = useState(unAnio());
  const [comentario, setComentario] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const v = useValidacion({
    titulo: "No se pudo registrar la nueva versión",
    reglas: (): Problema[] => {
      const out: Problema[] = [];
      if (!version.trim()) out.push({ campo: "nv-version", mensaje: "Indica la nueva versión o fecha de edición" });
      else if (version.trim() === (ext.version_fecha || "")) out.push({ campo: "nv-version", mensaje: "Debe ser distinta de la versión vigente" });
      if (enlace.trim() && !enlaceValido(enlace)) out.push({ campo: "nv-enlace", mensaje: "El enlace debe ser una dirección http(s) válida" });
      if (!proxima || proxima <= hoyLocal()) out.push({ campo: "nv-proxima", mensaje: "La próxima revisión debe ser posterior a hoy" });
      return out;
    },
  });
  const guardar = async () => {
    if (!v.validar()) return;
    setGuardando(true);
    try {
      const fd = new FormData();
      fd.append("version_fecha", version.trim());
      if (enlace.trim()) fd.append("enlace", enlace.trim());
      fd.append("proxima_revision", proxima);
      if (comentario.trim()) fd.append("comentario", comentario.trim());
      if (pdf) fd.append("archivo_pdf", pdf);
      const r = await sendFormAuth(`${API_BASE_URL}/sgc/externos/${docId}/version`, token, fd);
      toast.success(String(r.message || "Nueva versión registrada"));
      invalidate("sgc");
      onClose();
    } catch (err) {
      v.errorServidor(err, { version_fecha: "nv-version", enlace: "nv-enlace", proxima_revision: "nv-proxima", archivo_pdf: "nv-pdf" });
    } finally {
      setGuardando(false);
    }
  };
  return (
    <VentanaFormulario
      onOpenChange={(o) => !o && !guardando && onClose()}
      title={`Nueva versión de ${clave}`}
      description={`Queda vigente y la ${ext.version_fecha || "anterior"} pasa a obsoleta. Se te pedirá tu contraseña.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button icon={<FilePlus size={16} />} loading={guardando} onClick={guardar} data-testid="nv-guardar">
            Registrar versión
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <div className="flex flex-col gap-4">
          <FormGrid>
            <Field label="Versión o fecha de edición" htmlFor="nv-version" required>
              <Input id="nv-version" maxLength={80} value={version} onChange={(e) => setVersion(e.target.value)} />
            </Field>
            <Field label="Próxima revisión" htmlFor="nv-proxima" required>
              <DateInput id="nv-proxima" value={proxima} onChange={setProxima} />
            </Field>
          </FormGrid>
          <MasOpciones llenos={conDato(enlace !== (ext.enlace || "") ? enlace : "", comentario, pdf)}>
            <Field label="Enlace de consulta" htmlFor="nv-enlace">
              <Input id="nv-enlace" type="url" value={enlace} onChange={(e) => setEnlace(e.target.value)} />
            </Field>
            <CampoPdf id="nv-pdf" onChange={setPdf} />
            <Field label="Comentario" htmlFor="nv-comentario">
              <Textarea id="nv-comentario" rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} />
            </Field>
          </MasOpciones>
        </div>
      </ValidacionAmbito>
    </VentanaFormulario>
  );
}

export function EditarExternoDialog({ docId, ext, catalogos, onClose }: { docId: number; ext: DatosExterno; catalogos: Catalogos | null; onClose: () => void }) {
  const { token } = useSession();
  const [fuente, setFuente] = useState(ext.fuente || "");
  const [enlace, setEnlace] = useState(ext.enlace || "");
  const [responsable, setResponsable] = useState(ext.responsable_id ? String(ext.responsable_id) : "");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const v = useValidacion({
    titulo: "No se pudieron guardar los cambios",
    reglas: (): Problema[] => {
      const out: Problema[] = [];
      if (!fuente.trim()) out.push({ campo: "ee-fuente", mensaje: "Indica el emisor o fuente" });
      if (enlace.trim() && !enlaceValido(enlace)) out.push({ campo: "ee-enlace", mensaje: "El enlace debe ser una dirección http(s) válida" });
      if (!responsable) out.push({ campo: "ee-responsable", mensaje: "Elige al responsable de seguimiento" });
      if (motivo.trim().length < MOTIVO_MIN_SGC) out.push({ campo: "ee-motivo", mensaje: `Escribe el motivo (al menos ${MOTIVO_MIN_SGC} caracteres)` });
      return out;
    },
  });
  const guardar = async () => {
    if (!v.validar()) return;
    setGuardando(true);
    try {
      const r = await sendJsonAuth("PUT", `${API_BASE_URL}/sgc/externos/${docId}`, token, { fuente: fuente.trim(), enlace: enlace.trim(), responsable_id: Number(responsable), motivo: motivo.trim() });
      toast.success(String(r.message || "Datos actualizados"));
      invalidate("sgc");
      onClose();
    } catch (err) {
      v.errorServidor(err, { fuente: "ee-fuente", enlace: "ee-enlace", responsable: "ee-responsable", motivo: "ee-motivo" });
    } finally {
      setGuardando(false);
    }
  };
  return (
    <VentanaFormulario
      onOpenChange={(o) => !o && !guardando && onClose()}
      title="Datos de seguimiento"
      description="Los cambios quedan en la bitácora con su motivo."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button loading={guardando} onClick={guardar} data-testid="ee-guardar">
            Guardar
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <div className="flex flex-col gap-4">
          <Field label="Emisor o fuente" htmlFor="ee-fuente" required>
            <Input id="ee-fuente" value={fuente} onChange={(e) => setFuente(e.target.value)} />
          </Field>
          <Field label="Responsable de seguimiento" htmlFor="ee-responsable" required>
            <Select id="ee-responsable" value={responsable} onChange={(e) => setResponsable(e.target.value)}>
              <option value="">Elige</option>
              {responsables(catalogos).map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.nombre}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Motivo" htmlFor="ee-motivo" required>
            <Textarea id="ee-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </Field>
          <MasOpciones llenos={conDato(enlace)}>
            <Field label="Enlace de consulta" htmlFor="ee-enlace">
              <Input id="ee-enlace" type="url" value={enlace} onChange={(e) => setEnlace(e.target.value)} />
            </Field>
          </MasOpciones>
        </div>
      </ValidacionAmbito>
    </VentanaFormulario>
  );
}

/* Seccion de la ficha con los datos de seguimiento de un externo. */
/* `sinAcciones`: la ficha ofrece verificar, nueva version y editar en su accion principal y su menu ⋯ (aqui solo los datos). */
export function SeguimientoExterno({ docId, clave, ext, catalogos, sinAcciones = false }: { docId: number; clave: string; ext: DatosExterno; catalogos: Catalogos | null; sinAcciones?: boolean }) {
  const [verificar, setVerificar] = useState(false);
  const [version, setVersion] = useState(false);
  const [editar, setEditar] = useState(false);
  const dato = (etiqueta: string, valor: React.ReactNode) => (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11.5px] font-medium uppercase tracking-wide text-ink-4">{etiqueta}</dt>
      <dd className="break-words text-[13.5px] text-ink">{valor || "—"}</dd>
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-3 sm:grid-cols-3">
        {dato("Emisor o fuente", ext.fuente)}
        {dato("Versión o fecha de edición", ext.version_fecha)}
        {dato("Responsable de seguimiento", ext.responsable_nombre)}
        {dato("Última verificación", formatearFecha(ext.ultima_verificacion))}
        {dato("Próxima revisión", formatearFecha(ext.proxima_revision))}
        {dato(
          "Enlace de consulta",
          ext.enlace ? (
            <a href={ext.enlace} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-brand-strong underline underline-offset-2">
              {ext.enlace.replace(/^https?:\/\//, "")} <ArrowSquareOut size={13} aria-hidden="true" />
            </a>
          ) : null,
        )}
      </dl>
      <div className={sinAcciones ? "hidden" : "flex flex-wrap gap-2"}>
        {!sinAcciones && ext.puede.verificar.ok ? (
          <Button size="sm" icon={<CheckCircle size={15} />} onClick={() => setVerificar(true)} data-testid="ext-verificar">
            Verificar vigencia
          </Button>
        ) : null}
        {!sinAcciones && ext.puede.nueva_version.ok ? (
          <Button size="sm" variant="secondary" icon={<FilePlus size={15} />} onClick={() => setVersion(true)} data-testid="ext-nueva-version">
            Registrar nueva versión
          </Button>
        ) : null}
        {!sinAcciones && ext.puede.editar.ok ? (
          <Button size="sm" variant="ghost" icon={<PencilSimple size={15} />} onClick={() => setEditar(true)} data-testid="ext-editar">
            Editar seguimiento
          </Button>
        ) : null}
      </div>
      {verificar ? <VerificarExternoDialog docId={docId} clave={clave} onClose={() => setVerificar(false)} /> : null}
      {version ? <NuevaVersionExternoDialog docId={docId} clave={clave} ext={ext} onClose={() => setVersion(false)} /> : null}
      {editar ? <EditarExternoDialog docId={docId} ext={ext} catalogos={catalogos} onClose={() => setEditar(false)} /> : null}
    </div>
  );
}

export { Globe as IconoExterno };
