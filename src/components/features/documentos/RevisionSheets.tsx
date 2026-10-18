"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CloudArrowUp, FloppyDisk, SealCheck } from "@phosphor-icons/react";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { DateInput } from "@/components/ui/DateInput";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/Field";
import { CampoValidado, useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { API_BASE_URL, sendFormAuthProgress, sendJsonAuth } from "@/lib/client/api";
import { type Problema } from "@/lib/client/mensajes";
import { invalidate } from "@/lib/client/store";
import { extensionDe, fmtBytes } from "@/lib/shared/adjuntos";
import { MOTIVO_MIN_SGC, TIPOS_ARCHIVO_SGC, type TipoArchivoSgc } from "@/lib/shared/documentos";
import type { AccionDocumental } from "@/lib/shared/permisos";
import type { Catalogos, FichaDocumento, Revision } from "./comun";
import { opcionesPersonas } from "./FichaSheet";
import { conDato, MasOpciones, VentanaFormulario } from "./VentanaFormulario";

type Resp = { elaborador_id: string; revisor_id: string; autorizador_id: string };
const respDe = (r?: Revision | null): Resp => ({ elaborador_id: r?.elaborador_id ? String(r.elaborador_id) : "", revisor_id: r?.revisor_id ? String(r.revisor_id) : "", autorizador_id: r?.autorizador_id ? String(r.autorizador_id) : "" });
const CAMPOS: Record<string, string> = { motivo_cambio: "rev-motivo", elaborador: "rev-elaborador", revisor: "rev-revisor", autorizador: "rev-autorizador", responsables: "rev-elaborador", fecha_emision: "rev-emision", fecha_vigencia: "rev-vigencia", fecha_proxima_revision: "rev-proxima" };

/*
 * Nueva revision (documento_crear_ficha): crea una revision de trabajo en
 * borrador SIN tocar la vigente, con motivo, apartados, descripcion y
 * responsables. Editar (en borrador): los mismos datos y las fechas; solo
 * Mejora Continua cambia a los responsables.
 */
export function RevisionSheet({ doc, revision, catalogos, onClose }: { doc: FichaDocumento["item"]; revision: Revision | null; catalogos: Catalogos | null; onClose: () => void }) {
  const { token } = useSession();
  const editar = !!revision;
  const [motivo, setMotivo] = useState(revision?.motivo_cambio || "");
  const [apartados, setApartados] = useState(revision?.apartados_afectados || "");
  const [descripcion, setDescripcion] = useState(revision?.descripcion_cambio || "");
  const [resp, setResp] = useState<Resp>(respDe(revision));
  const [fechas, setFechas] = useState({ fecha_emision: revision?.fecha_emision || "", fecha_vigencia: revision?.fecha_vigencia || "", fecha_proxima_revision: revision?.fecha_proxima_revision || "" });
  const [retencion, setRetencion] = useState({ ubicacion_historica: revision?.ubicacion_historica || "", regla_conservacion: revision?.regla_conservacion || "" });
  const [limite, setLimite] = useState("");
  const [guardando, setGuardando] = useState(false);
  const puedeAsignar = !revision || revision.puede.asignar.ok;
  const personas = catalogos?.personas || [];
  const v = useValidacion({
    titulo: editar ? "No se pudo guardar la revisión" : "No se pudo abrir la revisión",
    reglas: (): Problema[] => {
      const out: Problema[] = [];
      if (motivo.trim().length < MOTIVO_MIN_SGC) out.push({ campo: "rev-motivo", mensaje: `Describe el motivo del cambio (al menos ${MOTIVO_MIN_SGC} caracteres)` });
      const ids = Object.values(resp).filter(Boolean);
      if (!editar && ids.length < 3) out.push({ campo: "rev-elaborador", mensaje: "Asigna elaborador, revisor y autorizador" });
      else if (new Set(ids).size !== ids.length) out.push({ campo: "rev-elaborador", mensaje: "Elaborador, revisor y autorizador deben ser tres personas distintas" });
      return out;
    },
  });
  const guardar = async () => {
    if (!v.validar()) return;
    setGuardando(true);
    try {
      const cuerpo = { motivo_cambio: motivo.trim(), apartados_afectados: apartados.trim(), descripcion_cambio: descripcion.trim(), ...(puedeAsignar ? resp : {}), ...(editar ? { ...fechas, ...retencion } : { fecha_limite: limite || null }) };
      const r = editar ? await sendJsonAuth("PUT", `${API_BASE_URL}/sgc/revisiones/${revision!.id}`, token, cuerpo) : await sendJsonAuth("POST", `${API_BASE_URL}/sgc/documentos/${doc.id}/revisiones`, token, cuerpo);
      toast.success(String(r.message || "Revisión guardada"));
      invalidate("sgc");
      onClose();
    } catch (err) {
      v.errorServidor(err, CAMPOS);
    } finally {
      setGuardando(false);
    }
  };
  const persona = (campo: keyof Resp, etiqueta: string, accion: AccionDocumental, id: string) => (
    <Field label={etiqueta} htmlFor={id}>
      <Select id={id} value={resp[campo]} disabled={!puedeAsignar} onChange={(e) => setResp((r) => ({ ...r, [campo]: e.target.value }))}>
        <option value="">Sin asignar</option>
        {opcionesPersonas(personas, accion).map((p) => (
          <option key={p.id} value={String(p.id)}>
            {p.nombre}
          </option>
        ))}
        {/* Si la persona asignada ya no tiene la accion, se sigue mostrando. */}
        {resp[campo] && !opcionesPersonas(personas, accion).some((p) => String(p.id) === resp[campo]) ? <option value={resp[campo]}>{revision?.[campo.replace("_id", "_nombre") as "elaborador_nombre"] || "Persona asignada"}</option> : null}
      </Select>
    </Field>
  );
  return (
    <VentanaFormulario
      onOpenChange={(o) => !o && !guardando && onClose()}
      title={editar ? `Revisión ${revision!.numero} · ${doc.clave}` : `Nueva revisión · ${doc.clave}`}
      description={editar ? "Datos de la revisión en borrador; los cambios quedan en la bitácora." : "Se abre en borrador; la vigente sigue disponible hasta que la nueva se publique."}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button icon={<FloppyDisk size={16} />} loading={guardando} onClick={guardar} data-testid="revision-guardar">
            {editar ? "Guardar revisión" : "Abrir revisión"}
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <div className="flex flex-col gap-5">
          <Field label="Motivo del cambio" htmlFor="rev-motivo" required>
            <Textarea id="rev-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </Field>
          <section className="flex flex-col gap-2" aria-labelledby="rev-resp-titulo">
            <h3 id="rev-resp-titulo" className="text-[13.5px] font-semibold text-ink">
              Responsables
            </h3>
            {!puedeAsignar ? <p className="text-[12.5px] text-ink-3">Solo Mejora Continua asigna a los responsables.</p> : null}
            <FormGrid cols={3}>
              {persona("elaborador_id", "Elaborador", "documento_elaborar", "rev-elaborador")}
              {persona("revisor_id", "Revisor", "documento_revisar", "rev-revisor")}
              {persona("autorizador_id", "Autorizador", "documento_autorizar", "rev-autorizador")}
            </FormGrid>
          </section>
          <MasOpciones llenos={conDato(apartados, descripcion, ...(editar ? [fechas.fecha_emision, fechas.fecha_vigencia, fechas.fecha_proxima_revision, retencion.ubicacion_historica, retencion.regla_conservacion] : [limite]))}>
            <FormGrid>
              <Field label="Páginas o apartados afectados" htmlFor="rev-apartados">
                <Input id="rev-apartados" maxLength={400} value={apartados} onChange={(e) => setApartados(e.target.value)} />
              </Field>
              <Field label="Descripción breve del cambio" htmlFor="rev-descripcion">
                <Input id="rev-descripcion" maxLength={600} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
              </Field>
            </FormGrid>
            {!editar ? (
              <Field label="Fecha límite" htmlFor="rev-limite">
                <DateInput id="rev-limite" value={limite} onChange={setLimite} />
              </Field>
            ) : (
              <>
                <FormGrid cols={3}>
                  <Field label="Fecha de emisión" htmlFor="rev-emision">
                    <DateInput id="rev-emision" value={fechas.fecha_emision} onChange={(x) => setFechas((f) => ({ ...f, fecha_emision: x }))} />
                  </Field>
                  <Field label="Fecha de vigencia" htmlFor="rev-vigencia">
                    <DateInput id="rev-vigencia" value={fechas.fecha_vigencia} onChange={(x) => setFechas((f) => ({ ...f, fecha_vigencia: x }))} />
                  </Field>
                  <Field label="Próxima revisión" htmlFor="rev-proxima">
                    <DateInput id="rev-proxima" value={fechas.fecha_proxima_revision} onChange={(x) => setFechas((f) => ({ ...f, fecha_proxima_revision: x }))} />
                  </Field>
                </FormGrid>
                <FormGrid>
                  <Field label="Ubicación histórica" htmlFor="rev-ubicacion" hint="Dónde se conserva al quedar obsoleta">
                    <Input id="rev-ubicacion" maxLength={300} value={retencion.ubicacion_historica} onChange={(e) => setRetencion((r) => ({ ...r, ubicacion_historica: e.target.value }))} />
                  </Field>
                  <Field label="Regla de conservación" htmlFor="rev-conservacion">
                    <Input id="rev-conservacion" maxLength={300} value={retencion.regla_conservacion} onChange={(e) => setRetencion((r) => ({ ...r, regla_conservacion: e.target.value }))} />
                  </Field>
                </FormGrid>
              </>
            )}
          </MasOpciones>
        </div>
      </ValidacionAmbito>
    </VentanaFormulario>
  );
}

/* Cargar o sustituir el PDF de consulta o el archivo fuente de una revision en borrador. */
export function ArchivoDialog({ revision, maxMb, onClose }: { revision: Revision; maxMb: number; onClose: () => void }) {
  const { token } = useSession();
  const [tipo, setTipo] = useState<TipoArchivoSgc>(revision.archivos.some((a) => a.tipo === "pdf" && !a.reemplazado_en) && !revision.archivos.some((a) => a.tipo === "fuente" && !a.reemplazado_en) ? "fuente" : "pdf");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const def = TIPOS_ARCHIVO_SGC.find((t) => t.value === tipo)!;
  const actual = revision.archivos.find((a) => a.tipo === tipo && !a.reemplazado_en);
  const problema = (() => {
    if (!archivo) return "Elige el archivo";
    const ext = extensionDe(archivo.name);
    if (!(def.extensiones as readonly string[]).includes(ext)) return `Formato no permitido (.${ext || "sin extensión"}); se aceptan: ${def.extensiones.join(", ")}`;
    if (archivo.size > maxMb * 1024 * 1024) return `El archivo pesa más de ${maxMb} MB`;
    return null;
  })();
  const v = useValidacion({ titulo: "No se pudo cargar el archivo", reglas: () => (problema ? [{ campo: "archivo-sgc", mensaje: problema }] : []) });
  const guardar = async () => {
    if (!v.validar()) return;
    setGuardando(true);
    try {
      const form = new FormData();
      form.append("tipo", tipo);
      form.append("archivo", archivo!);
      const r = await sendFormAuthProgress(`${API_BASE_URL}/sgc/revisiones/${revision.id}/archivos`, token, form);
      toast.success(String(r.message || "Archivo cargado"));
      invalidate("sgc");
      onClose();
    } catch (err) {
      v.errorServidor(err, { archivo: "archivo-sgc", tipo: "archivo-tipo" });
    } finally {
      setGuardando(false);
    }
  };
  return (
    <VentanaFormulario
      onOpenChange={(o) => !o && !guardando && onClose()}
      title={`Archivo de la revisión ${revision.numero}`}
      description="En borrador puedes cargar o sustituir sus archivos; el anterior se conserva."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button icon={<CloudArrowUp size={16} />} loading={guardando} onClick={guardar} data-testid="archivo-guardar">
            {actual ? "Sustituir archivo" : "Cargar archivo"}
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <div className="flex flex-col gap-4">
          <Field label="Tipo de archivo" htmlFor="archivo-tipo">
            <Select id="archivo-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoArchivoSgc)}>
              {TIPOS_ARCHIVO_SGC.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label} ({t.extensiones.map((e) => `.${e}`).join(", ")})
                </option>
              ))}
            </Select>
          </Field>
          {actual ? (
            <p className="text-[12.5px] text-ink-3">
              Sustituye a «{actual.nombre_original}» ({fmtBytes(actual.tamano_bytes)}), que se conserva.
            </p>
          ) : null}
          <CampoValidado id="archivo-sgc">
            <input type="file" aria-label="Elegir archivo" accept={def.extensiones.map((e) => `.${e}`).join(",")} onChange={(e) => setArchivo(e.target.files?.[0] || null)} className="text-[13px] text-ink-2 file:mr-3 file:rounded-[8px] file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-ink file:shadow-card" />
          </CampoValidado>
        </div>
      </ValidacionAmbito>
    </VentanaFormulario>
  );
}

/*
 * Carga inicial: registrar como vigente la primera revision de un documento ya
 * autorizado fuera de la plataforma. Pide la contrasena (la pide la API).
 */
export function RegistrarVigenteDialog({ doc, revision, onClose }: { doc: FichaDocumento["item"]; revision: Revision; onClose: () => void }) {
  const { token } = useSession();
  const [fechas, setFechas] = useState({ fecha_emision: revision.fecha_emision || "", fecha_vigencia: revision.fecha_vigencia || "", fecha_proxima_revision: revision.fecha_proxima_revision || "" });
  const [comentario, setComentario] = useState("");
  const [guardando, setGuardando] = useState(false);
  const v = useValidacion({
    titulo: "No se pudo registrar como vigente",
    reglas: (): Problema[] => {
      const out: Problema[] = [];
      if (!fechas.fecha_emision) out.push({ campo: "rev-emision", mensaje: "Indica la fecha de emisión autorizada" });
      const vig = fechas.fecha_vigencia || fechas.fecha_emision;
      if (fechas.fecha_proxima_revision && vig && fechas.fecha_proxima_revision <= vig) out.push({ campo: "rev-proxima", mensaje: "La próxima revisión debe ser posterior a la fecha de vigencia" });
      return out;
    },
  });
  const guardar = async () => {
    if (!v.validar()) return;
    setGuardando(true);
    try {
      const r = await sendJsonAuth("POST", `${API_BASE_URL}/sgc/revisiones/${revision.id}/registrar-vigente`, token, { ...fechas, comentario: comentario.trim() });
      toast.success(String(r.message || "Revisión vigente registrada"));
      invalidate("sgc");
      onClose();
    } catch (err) {
      v.errorServidor(err, CAMPOS);
    } finally {
      setGuardando(false);
    }
  };
  return (
    <VentanaFormulario
      onOpenChange={(o) => !o && !guardando && onClose()}
      title={`Registrar vigente · ${doc.clave} rev. ${revision.numero}`}
      description="Carga inicial de un documento ya autorizado fuera de la plataforma. Se te pedirá tu contraseña."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button icon={<SealCheck size={16} />} loading={guardando} onClick={guardar} data-testid="vigente-guardar">
            Registrar como vigente
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <div className="flex flex-col gap-4">
          <p className="text-[12.5px] text-ink-3">
            Solo para la carga inicial. Elaborador: {revision.elaborador_nombre || "—"} · Revisor: {revision.revisor_nombre || "—"} · Autorizador: {revision.autorizador_nombre || "—"}.
          </p>
          <Field label="Fecha de emisión" htmlFor="rev-emision" required>
            <DateInput id="rev-emision" value={fechas.fecha_emision} onChange={(x) => setFechas((f) => ({ ...f, fecha_emision: x }))} />
          </Field>
          <MasOpciones llenos={conDato(fechas.fecha_vigencia, fechas.fecha_proxima_revision, comentario)}>
            <FormGrid>
              <Field label="Fecha de vigencia" htmlFor="rev-vigencia" hint="Si la dejas vacía, la de emisión">
                <DateInput id="rev-vigencia" value={fechas.fecha_vigencia} onChange={(x) => setFechas((f) => ({ ...f, fecha_vigencia: x }))} />
              </Field>
              <Field label="Próxima revisión" htmlFor="rev-proxima">
                <DateInput id="rev-proxima" value={fechas.fecha_proxima_revision} onChange={(x) => setFechas((f) => ({ ...f, fecha_proxima_revision: x }))} />
              </Field>
            </FormGrid>
            <Field label="Comentario" htmlFor="rev-comentario" hint="Por ejemplo, dónde está la autorización original">
              <Textarea id="rev-comentario" rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} />
            </Field>
          </MasOpciones>
        </div>
      </ValidacionAmbito>
    </VentanaFormulario>
  );
}
