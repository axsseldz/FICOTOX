"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle, FloppyDisk, WarningCircle } from "@phosphor-icons/react";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/Field";
import { CampoValidado, useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { API_BASE_URL, sendFormAuthProgress, sendJsonAuth } from "@/lib/client/api";
import { msg, type Problema } from "@/lib/client/mensajes";
import { invalidate } from "@/lib/client/store";
import { extensionDe, fmtBytes } from "@/lib/shared/adjuntos";
import { CONFIDENCIALIDADES, ORIGENES, TIPOS_ARCHIVO_SGC, MOTIVO_MIN_SGC, normalizarClave, validarClave, validarIdentificadorExterno } from "@/lib/shared/documentos";
import type { AccionDocumental } from "@/lib/shared/permisos";
import type { Catalogos, FichaDocumento, Persona } from "./comun";
import { conDato, MasOpciones, VentanaFormulario } from "./VentanaFormulario";

/*
 * Nueva ficha (documento_crear_ficha): metadatos con catalogos, clave FX
 * validada contra el area y el tipo (la plataforma no genera claves: registra
 * la autorizada por Mejora Continua) y el archivo inicial como revision en
 * borrador. Editar: los mismos metadatos, con motivo (queda en la bitacora).
 */

interface Datos {
  clave: string;
  titulo: string;
  area_codigo: string;
  tipo_codigo: string;
  origen: string;
  proceso: string;
  confidencialidad: string;
  palabras_clave: string;
  propietario_id: string;
}

const vacios = (area = "", tipo = ""): Datos => ({ clave: "", titulo: "", area_codigo: area, tipo_codigo: tipo, origen: "interno", proceso: "", confidencialidad: "uso_interno", palabras_clave: "", propietario_id: "" });

const CAMPOS: Record<string, string> = { clave: "ficha-clave", titulo: "ficha-titulo", area: "ficha-area", tipo: "ficha-tipo", confidencialidad: "ficha-confidencialidad", propietario: "ficha-propietario", archivo: "ficha-archivos", numero: "ficha-numero", elaborador: "ficha-elaborador", revisor: "ficha-revisor", autorizador: "ficha-autorizador", responsables: "ficha-elaborador", motivo: "ficha-motivo" };

/* Personas que pueden tener un papel (por su accion documental). */
export function opcionesPersonas(personas: Persona[], accion: AccionDocumental) {
  return personas.filter((p) => p.acciones.includes(accion));
}

export function FichaSheet({ open, onClose, catalogos, editar, areaInicial, tipoInicial }: { open: boolean; onClose: () => void; catalogos: Catalogos | null; editar?: FichaDocumento["item"] | null; areaInicial?: string; tipoInicial?: string }) {
  const { token } = useSession();
  const router = useRouter();
  const [datos, setDatos] = useState<Datos>(() =>
    editar
      ? { clave: editar.clave, titulo: editar.titulo, area_codigo: editar.area.codigo, tipo_codigo: editar.tipo.codigo, origen: editar.origen, proceso: editar.proceso || "", confidencialidad: editar.confidencialidad, palabras_clave: editar.palabras_clave.join(", "), propietario_id: editar.propietario_id ? String(editar.propietario_id) : "" }
      : vacios(areaInicial, tipoInicial),
  );
  const [numero, setNumero] = useState("1");
  const [resp, setResp] = useState({ elaborador_id: "", revisor_id: "", autorizador_id: "" });
  const [motivoCambio, setMotivoCambio] = useState("Emisión inicial");
  const [descripcion, setDescripcion] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [fuente, setFuente] = useState<File | null>(null);
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const cambiar = (c: Partial<Datos>) => setDatos((d) => ({ ...d, ...c }));
  const areas = (catalogos?.areas || []).filter((a) => Number(a.activo ?? 1));
  const tipos = catalogos?.tipos || [];
  const personas = catalogos?.personas || [];
  const maxMb = catalogos?.max_mb || 50;
  // Los externos se identifican con la clave del emisor (Fase 3); los internos, con la clave FX.
  const externo = datos.origen === "externo";
  const clave = externo ? validarIdentificadorExterno(datos.clave) : validarClave(datos.clave, datos.area_codigo, datos.tipo_codigo);

  const archivoProblema = (f: File | null, tipo: "pdf" | "fuente") => {
    if (!f) return null;
    const ext = extensionDe(f.name);
    const permitidas = TIPOS_ARCHIVO_SGC.find((t) => t.value === tipo)!.extensiones as readonly string[];
    if (!permitidas.includes(ext)) return `Formato no permitido (.${ext || "sin extensión"}); se aceptan: ${permitidas.join(", ")}`;
    if (f.size > maxMb * 1024 * 1024) return `El archivo pesa más de ${maxMb} MB`;
    if (!f.size) return "El archivo está vacío";
    return null;
  };

  const v = useValidacion({
    titulo: editar ? "No se pudieron guardar los metadatos" : "No se pudo crear la ficha",
    reglas: (): Problema[] => {
      const out: Problema[] = [];
      if (!datos.area_codigo) out.push({ campo: "ficha-area", mensaje: msg.elige("el área de gestión") });
      if (!datos.tipo_codigo) out.push({ campo: "ficha-tipo", mensaje: msg.elige("el tipo documental") });
      if (clave.problema) out.push({ campo: "ficha-clave", mensaje: clave.problema });
      if (!datos.titulo.trim()) out.push({ campo: "ficha-titulo", mensaje: msg.indica("el título completo") });
      if (!editar) {
        if (!pdf && !fuente) out.push({ campo: "ficha-archivos", mensaje: "Elige el archivo inicial (el PDF de consulta o el archivo fuente)" });
        const p1 = archivoProblema(pdf, "pdf");
        if (p1) out.push({ campo: "ficha-archivos", mensaje: p1 });
        const p2 = archivoProblema(fuente, "fuente");
        if (p2) out.push({ campo: "ficha-archivos", mensaje: p2 });
        if (!/^\d{1,3}$/.test(numero.trim())) out.push({ campo: "ficha-numero", mensaje: "La revisión inicial es un número entero (0 a 999)" });
        const ids = Object.values(resp).filter(Boolean);
        if (new Set(ids).size !== ids.length) out.push({ campo: "ficha-elaborador", mensaje: "Elaborador, revisor y autorizador deben ser tres personas distintas" });
      } else if (motivo.trim().length < MOTIVO_MIN_SGC) out.push({ campo: "ficha-motivo", mensaje: `Indica el motivo del cambio (al menos ${MOTIVO_MIN_SGC} caracteres)` });
      return out;
    },
  });

  const cerrar = () => {
    if (!guardando) onClose();
  };

  const guardar = async () => {
    if (!v.validar()) return;
    setGuardando(true);
    try {
      if (editar) {
        await sendJsonAuth("PUT", `${API_BASE_URL}/sgc/documentos/${editar.id}`, token, { ...datos, motivo: motivo.trim() });
        toast.success("Metadatos actualizados");
        invalidate("sgc");
        onClose();
      } else {
        const form = new FormData();
        for (const [k, val] of Object.entries(datos)) form.append(k, String(val));
        form.append("numero", numero.trim());
        for (const [k, val] of Object.entries(resp)) if (val) form.append(k, val);
        form.append("motivo_cambio", motivoCambio.trim());
        if (descripcion.trim()) form.append("descripcion_cambio", descripcion.trim());
        if (pdf) form.append("archivo_pdf", pdf);
        if (fuente) form.append("archivo_fuente", fuente);
        const r = await sendFormAuthProgress(`${API_BASE_URL}/sgc/documentos`, token, form, setProgreso);
        toast.success(String(r.message || "Ficha creada"));
        invalidate("sgc");
        onClose();
        router.push(`/documentos/${r.id}`);
      }
    } catch (err) {
      v.errorServidor(err, CAMPOS);
    } finally {
      setGuardando(false);
      setProgreso(0);
    }
  };

  const persona = (campo: keyof typeof resp, etiqueta: string, accion: AccionDocumental, id: string) => (
    <Field label={etiqueta} htmlFor={id} hint={`Personas con «${accion.replace("documento_", "").replace("_", " ")}»`}>
      <Select id={id} value={resp[campo]} onChange={(e) => setResp((r) => ({ ...r, [campo]: e.target.value }))}>
        <option value="">Sin asignar</option>
        {opcionesPersonas(personas, accion).map((p) => (
          <option key={p.id} value={String(p.id)}>
            {p.nombre}
          </option>
        ))}
      </Select>
    </Field>
  );

  const archivo = (tipo: "pdf" | "fuente", valor: File | null, set: (f: File | null) => void) => {
    const def = TIPOS_ARCHIVO_SGC.find((t) => t.value === tipo)!;
    const problema = archivoProblema(valor, tipo);
    return (
      <div className="flex flex-col gap-1.5 rounded-box bg-surface-2 p-3 ring-1 ring-line">
        <label htmlFor={`ficha-archivo-${tipo}`} className="text-sm font-medium text-ink">
          {def.label} <span className="font-normal text-ink-3">({def.extensiones.map((e) => `.${e}`).join(", ")})</span>
        </label>
        <input id={`ficha-archivo-${tipo}`} type="file" accept={def.extensiones.map((e) => `.${e}`).join(",")} onChange={(e) => set(e.target.files?.[0] || null)} className="text-sm text-ink-2 file:mr-3 file:rounded-control file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink file:shadow-card" />
        {valor ? (
          <p className={problema ? "flex items-center gap-1 text-xs text-danger-text" : "flex items-center gap-1 text-xs text-ink-3"}>
            {problema ? <WarningCircle size={14} weight="bold" aria-hidden="true" /> : <CheckCircle size={14} weight="bold" className="text-success" aria-hidden="true" />}
            {problema || `${valor.name} · ${fmtBytes(valor.size)}`}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <VentanaFormulario
      open={open}
      onOpenChange={(o) => !o && cerrar()}
      title={editar ? `Editar metadatos · ${editar.clave}` : "Nueva ficha"}
      description={editar ? "Los cambios quedan en la bitácora." : "Clave FX autorizada y archivo inicial; queda como revisión en borrador."}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={cerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button icon={<FloppyDisk size={16} />} loading={guardando} onClick={guardar} data-testid="ficha-guardar">
            {editar ? "Guardar metadatos" : progreso > 0 && progreso < 1 ? `Subiendo ${Math.round(progreso * 100)} %` : "Crear ficha"}
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <div className="flex flex-col gap-5">
          <FormGrid>
            <Field label="Área de gestión" htmlFor="ficha-area" required>
              <Select id="ficha-area" value={datos.area_codigo} onChange={(e) => cambiar({ area_codigo: e.target.value })}>
                <option value="">Elige el área</option>
                {areas.map((a) => (
                  <option key={a.codigo} value={a.codigo}>
                    {a.codigo} · {a.nombre}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tipo documental" htmlFor="ficha-tipo" required>
              <Select id="ficha-tipo" value={datos.tipo_codigo} onChange={(e) => cambiar({ tipo_codigo: e.target.value })}>
                <option value="">Elige el tipo</option>
                {tipos.map((t) => (
                  <option key={t.codigo} value={t.codigo}>
                    {t.codigo} · {t.nombre}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={externo ? "Identificador del emisor" : "Clave FX"} htmlFor="ficha-clave" required hint={datos.clave && !clave.problema ? `Se registrará como ${clave.clave}` : externo ? "Por ejemplo NMX-EC-17025-IMNC-2018" : "Formato FX-[Área][Tipo]-[ID], p. ej. FX-TCF-GMR"}>
              <Input id="ficha-clave" mono maxLength={80} value={datos.clave} onChange={(e) => cambiar({ clave: e.target.value })} onBlur={() => datos.clave && cambiar({ clave: normalizarClave(datos.clave) })} placeholder="FX-GCP-CD" autoComplete="off" />
            </Field>
            <Field label="Confidencialidad" htmlFor="ficha-confidencialidad" required hint={CONFIDENCIALIDADES.find((c) => c.value === datos.confidencialidad)?.descripcion}>
              <Select id="ficha-confidencialidad" value={datos.confidencialidad} onChange={(e) => cambiar({ confidencialidad: e.target.value })}>
                {CONFIDENCIALIDADES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Título completo" htmlFor="ficha-titulo" required className="sm:col-span-2">
              <Input id="ficha-titulo" maxLength={300} value={datos.titulo} onChange={(e) => cambiar({ titulo: e.target.value })} />
            </Field>
            {editar ? null : (
              <Field label="Número de revisión" htmlFor="ficha-numero" required hint="Para documentos existentes, su revisión actual">
                <Input id="ficha-numero" inputMode="numeric" maxLength={3} value={numero} onChange={(e) => setNumero(e.target.value)} />
              </Field>
            )}
          </FormGrid>

          {editar ? null : (
            <CampoValidado id="ficha-archivos" className="flex flex-col gap-2">
              <p className="text-sm text-ink-2">Archivo inicial: al menos uno, hasta {maxMb} MB.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {archivo("pdf", pdf, setPdf)}
                {archivo("fuente", fuente, setFuente)}
              </div>
            </CampoValidado>
          )}

          <MasOpciones llenos={conDato(datos.proceso, datos.propietario_id, datos.palabras_clave, ...(editar ? [] : [descripcion, resp.elaborador_id, resp.revisor_id, resp.autorizador_id]))}>
            <FormGrid>
              <Field label="Proceso o subproceso" htmlFor="ficha-proceso">
                <Input id="ficha-proceso" maxLength={200} value={datos.proceso} onChange={(e) => cambiar({ proceso: e.target.value })} />
              </Field>
              <Field label="Propietario del documento" htmlFor="ficha-propietario">
                <Select id="ficha-propietario" value={datos.propietario_id} onChange={(e) => cambiar({ propietario_id: e.target.value })}>
                  <option value="">Sin asignar</option>
                  {personas.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.nombre}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Palabras clave" htmlFor="ficha-palabras" hint="Separadas por coma">
                <Input id="ficha-palabras" maxLength={600} value={datos.palabras_clave} onChange={(e) => cambiar({ palabras_clave: e.target.value })} />
              </Field>
              <Field label="Origen" htmlFor="ficha-origen" hint={editar ? "El origen no cambia" : "Los externos se registran en «Externos»"}>
                <Select id="ficha-origen" value={datos.origen} disabled onChange={(e) => cambiar({ origen: e.target.value })}>
                  {ORIGENES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </FormGrid>
            {editar ? null : (
              <>
                <FormGrid>
                  <Field label="Motivo del cambio" htmlFor="ficha-motivo-cambio">
                    <Input id="ficha-motivo-cambio" maxLength={400} value={motivoCambio} onChange={(e) => setMotivoCambio(e.target.value)} />
                  </Field>
                  <Field label="Descripción breve del cambio" htmlFor="ficha-descripcion">
                    <Input id="ficha-descripcion" maxLength={600} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
                  </Field>
                </FormGrid>
                <FormGrid cols={3}>
                  {persona("elaborador_id", "Elaborador", "documento_elaborar", "ficha-elaborador")}
                  {persona("revisor_id", "Revisor", "documento_revisar", "ficha-revisor")}
                  {persona("autorizador_id", "Autorizador", "documento_autorizar", "ficha-autorizador")}
                </FormGrid>
              </>
            )}
          </MasOpciones>

          {editar ? (
            <Field label="Motivo del cambio" htmlFor="ficha-motivo" required>
              <Textarea id="ficha-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </Field>
          ) : null}
        </div>
      </ValidacionAmbito>
    </VentanaFormulario>
  );
}
