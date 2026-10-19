"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useCuentasActivas } from "@/components/features/samples/FirmanteSelect";
import { toast } from "sonner";
import { ArrowRight, ArrowUUpLeft, Clock, Prohibit, SealCheck, Stamp, XCircle } from "@phosphor-icons/react";
import { CampoIdentidad } from "@/components/session/Reautenticar";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { Field, Textarea } from "@/components/ui/Field";
import { Dialog, useConfirm, usePrompt } from "@/components/ui/Overlay";
import { useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { API_BASE_URL, armarCargo, armarReauth, getJsonAuth, sendJsonAuth } from "@/lib/client/api";
import { msg, type Problema } from "@/lib/client/mensajes";
import { invalidate, useResource } from "@/lib/client/store";
import type { ApiRecord } from "@/lib/client/types";
import { esTipoActivo, permisoParaAprobar, type TipoSolicitud } from "@/lib/shared/acciones-criticas";
import { formatearFecha, formatearFechaHora } from "@/lib/shared/fechas";
import { frasesPorArea } from "@/lib/client/permisos-legibles";

/*
 * Solicitudes de un segundo usuario (Fase 3) y visto bueno de supervision
 * (Fase 2), visibles donde se trabaja:
 *  - banner en la ficha del registro, con Aprobar / Rechazar para quien puede
 *    resolver (nunca quien la pidio) y Cancelar para quien la pidio;
 *  - el indicador compacto de la lista abre un panel rapido con lo mismo;
 *  - franja en la lista del modulo para quien tiene pendientes que resolver;
 *  - la bandeja "Por autorizar" usa las mismas acciones.
 */

const KEYS_SOLICITUD = ["solicitudes", "supervision", "muestras", "informes", "documentos", "calidad", "usuarios", "roles", "reactivos", "consumibles", "equipos", "mantenimientos", "movimientos", "dashboard", "notificaciones"];

/* Grupo de la bandeja por entidad (filtro ?modulo= de "Por autorizar"). */
export const GRUPO_DE_ENTIDAD: Record<string, string> = {
  muestras_recepcion: "recepcion",
  muestras_procesamiento: "procesamiento",
  muestras_extraccion: "extraccion",
  muestras_analisis: "analisis",
  informes: "informes",
  documentos_sgc: "documentos",
  incidencias: "calidad",
  no_conformidades: "calidad",
  acciones_correctivas: "calidad",
  suspensiones: "calidad",
  usuarios: "usuarios",
  roles: "usuarios",
};
export const NOMBRE_GRUPO: Record<string, string> = { recepcion: "Recepción", procesamiento: "Procesamiento", extraccion: "Extracción", analisis: "Análisis", informes: "Informes", documentos: "Documentos", calidad: "Calidad", usuarios: "Usuarios y roles" };

/* Enlace al registro de la solicitud. */
export function hrefDeSolicitud(item: ApiRecord): string | null {
  const id = String(item.entidad_id || "");
  switch (String(item.entidad)) {
    case "muestras_recepcion":
      return `/muestras/recepcion/${id}`;
    case "muestras_procesamiento":
      return `/muestras/procesamiento/${id}`;
    case "muestras_extraccion":
      return `/muestras/extraccion/${id}`;
    case "muestras_analisis":
      return `/muestras/analisis/${id}`;
    case "informes":
      return `/informes/${id}`;
    case "incidencias":
      return `/calidad/incidencias/${id}`;
    case "no_conformidades":
      return `/calidad/nc/${id}`;
    case "usuarios":
      return "/administracion/usuarios";
    case "roles":
      return "/administracion/roles";
    case "documentos_sgc":
    case "biblioteca_documentos":
      return "/documentos";
    case "sgc_documentos":
      return `/documentos/${id}`;
    case "respaldos":
      return "/calidad/respaldos";
    default:
      return null;
  }
}

/* Que se pidio, en palabras, con los datos de la solicitud. */
export function describirSolicitud(item: ApiRecord): string {
  const datos = (item.datos || {}) as ApiRecord;
  switch (String(item.tipo)) {
    case "asignar_rol":
      return `Asignar el rol "${String(datos.rol || datos.rol_id || "")}"${datos.vigente_hasta ? ` hasta ${formatearFecha(datos.vigente_hasta)}` : ""}`;
    case "ampliar_vigencia":
      return datos.tipo_cuenta === "permanente" ? "Convertir la cuenta en permanente" : `Ampliar la vigencia hasta ${datos.vigente_hasta ? formatearFecha(datos.vigente_hasta) : "sin fecha de fin"}`;
    case "excepcion_segregacion":
      return `Excepción para ${String(datos.accion || item.accion)} lo que la misma persona elaboró`;
    case "restaurar_registro":
      return `Restaurar (volvería a "${String(datos.estado_previo || "")}")`;
    case "cambiar_folio":
      return datos.folio_nuevo ? `Cambiar el folio a ${String(datos.folio_nuevo)}` : "Cambiar el folio";
    case "decision_recepcion":
      return datos.decision ? `Decisión: ${String(datos.decision).replace(/_/g, " ")}` : "Decisión de la recepción";
    case "restaurar_respaldo":
      return `Restaurar la plataforma desde el respaldo del ${datos.creado_en ? formatearFechaHora(datos.creado_en) : String(item.entidad_id || "")}: se perderá todo lo registrado después`;
    case "ampliar_permisos_rol": {
      // Lo que se agregaria, en las palabras de la pantalla de Roles (área: frases).
      const frases = frasesPorArea(Array.isArray(datos.agregar) ? datos.agregar : []).map((a) => `${a.area}: ${a.frases.join("; ")}`);
      const partes = [...(datos.activar ? ["Reactivar el rol"] : []), ...(frases.length ? [`Agregar ${frases.join(" · ")}`] : [])];
      return `${partes.join(" y ") || "Ampliar permisos"} («${String(datos.rol || item.referencia || "")}»)`;
    }
    default:
      return String(item.etiqueta || item.tipo);
  }
}

/* "hace 3 horas", "hace 2 días". */
function haceCuanto(fecha: unknown): string {
  const t = Date.parse(String(fecha || ""));
  if (!Number.isFinite(t)) return "";
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} ${h === 1 ? "hora" : "horas"}`;
  const d = Math.round(h / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}

/* ¿La persona de la sesion puede resolver (aprobar/rechazar) esta solicitud? Nunca quien la pidio. */
function usePuedeResolver(): (sol: ApiRecord | null | undefined) => boolean {
  const { can, user } = useSession();
  return (sol) => {
    if (!sol || String(sol.estado || "pendiente") !== "pendiente") return false;
    // Accion retirada del catalogo (p. ej. obsoletar_documento): sin botones de aprobar ni rechazar.
    if (sol.retirada || !esTipoActivo(sol.tipo)) return false;
    if (typeof sol.puedo_aprobar === "boolean") return sol.puedo_aprobar;
    if (Number(sol.solicitado_por) === Number(user?.id)) return false;
    // Regla 6: nadie aprueba un cambio de acceso sobre su propia cuenta.
    if (sol.entidad === "usuarios" && String(sol.entidad_id) === String(user?.id)) return false;
    const { modulo, accion } = permisoParaAprobar(String(sol.tipo) as TipoSolicitud, String(sol.entidad || ""));
    return can(modulo, accion);
  };
}

/* Aprobar (motivo + contrasena + cargo), rechazar (motivo + contrasena) y cancelar una solicitud. */
export function useAccionesSolicitud(onCambio?: () => void) {
  const { token } = useSession();
  const prompt = usePrompt();
  const confirm = useConfirm();
  const [aprobando, setAprobando] = useState<ApiRecord | null>(null);
  const [motivo, setMotivo] = useState("");
  const [clave, setClave] = useState("");
  const [cargo, setCargo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const listo = () => {
    invalidate(...KEYS_SOLICITUD);
    onCambio?.();
  };
  const v = useValidacion({
    titulo: "No se pudo aprobar la solicitud",
    reglas: (): Problema[] => {
      const out: Problema[] = [];
      if (motivo.trim().length < 5) out.push({ campo: "ap-motivo", mensaje: motivo.trim() ? msg.minimo("El motivo", 5) : msg.escribe("el motivo de la aprobación") });
      if (!clave) out.push({ campo: "ap-password", mensaje: msg.password });
      return out;
    },
  });

  const aprobar = (sol: ApiRecord) => {
    setMotivo("");
    setClave("");
    setCargo("");
    setAprobando(sol);
  };
  const confirmarAprobacion = async () => {
    if (!aprobando || !v.validar()) return;
    setEnviando(true);
    armarReauth({ password: clave });
    armarCargo(cargo ? Number(cargo) : null);
    setClave("");
    try {
      const data = await sendJsonAuth("POST", `${API_BASE_URL}/solicitudes/${aprobando.id}/aprobar`, token, { motivo: motivo.trim() });
      toast.success(String(data.message || "Solicitud aprobada y ejecutada"));
      setAprobando(null);
      listo();
    } catch (err) {
      v.errorServidor(err, { motivo: "ap-motivo", password: "ap-password" });
    } finally {
      setEnviando(false);
    }
  };
  const rechazar = async (sol: ApiRecord) => {
    const razon = await prompt({
      critico: true,
      title: `Rechazar la solicitud: ${String(sol.etiqueta || "")}`.replace(/: $/, ""),
      description: `${String(sol.etiqueta)} · ${String(sol.referencia || "")}. La acción no se ejecuta y quien la pidió verá tu motivo.`,
      label: "Motivo del rechazo",
      minLength: 5,
      confirmLabel: "Rechazar",
      tone: "danger",
    });
    if (!razon) return;
    try {
      await sendJsonAuth("POST", `${API_BASE_URL}/solicitudes/${sol.id}/rechazar`, token, { motivo: razon });
      toast.success(`Solicitud #${sol.id} rechazada`);
      listo();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo rechazar la solicitud");
    }
  };
  const cancelar = async (sol: ApiRecord) => {
    const ok = await confirm({ title: "Cancelar la solicitud", description: `${String(sol.etiqueta)} · ${String(sol.referencia || "")}. La acción no se ejecutará; podrás pedirla de nuevo más adelante.`, confirmLabel: "Cancelar solicitud", cancelLabel: "Volver", tone: "danger" });
    if (!ok) return;
    try {
      await sendJsonAuth("POST", `${API_BASE_URL}/solicitudes/${sol.id}/cancelar`, token, {});
      toast.success(`Solicitud #${sol.id} cancelada`);
      listo();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo cancelar la solicitud");
    }
  };

  const dialogo = (
    <Dialog
      open={!!aprobando}
      onOpenChange={(open) => !open && setAprobando(null)}
      title={aprobando ? `Aprobar la solicitud: ${String(aprobando.etiqueta || "")}`.replace(/: $/, "") : "Aprobar"}
      description={aprobando ? `${String(aprobando.etiqueta)} · ${String(aprobando.referencia || "")}. Al aprobar, el sistema ejecuta la acción en tu nombre como segundo usuario y todo queda en la bitácora enlazado a la solicitud.` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => setAprobando(null)}>
            Volver
          </Button>
          <Button icon={<Stamp size={16} />} loading={enviando} onClick={confirmarAprobacion}>
            Aprobar y ejecutar
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <div className="flex flex-col gap-4">
          {aprobando ? (
            <p className="rounded-field bg-surface-2 px-3 py-2 text-sm text-ink-2 ring-1 ring-line">
              <span className="font-medium text-ink">{describirSolicitud(aprobando)}</span>
              <br />
              <span className="whitespace-pre-line">Motivo de quien la pidió: {String(aprobando.motivo || "—")}</span>
            </p>
          ) : null}
          <Field label="Motivo de la aprobación" htmlFor="ap-motivo" required>
            <Textarea id="ap-motivo" rows={3} value={motivo} onChange={(event) => setMotivo(event.target.value)} placeholder="Por qué autorizas esta acción; queda en la bitácora" />
          </Field>
          <CampoIdentidad value={clave} onChange={setClave} id="ap-password" cargo={cargo} onCargo={setCargo} />
        </div>
      </ValidacionAmbito>
    </Dialog>
  );
  return { aprobar, rechazar, cancelar, dialogo };
}

/*
 * Detalle de una solicitud pendiente con sus botones segun quien mira: quien
 * puede resolverla, Aprobar y Rechazar; quien la pidio, Cancelar; los demas,
 * solo informacion.
 */
export function SolicitudDetalle({ sol, entidad, onCambio, compacto = false }: { sol: ApiRecord; entidad?: string; onCambio?: () => void; compacto?: boolean }) {
  const { user } = useSession();
  const puedeResolver = usePuedeResolver();
  const acciones = useAccionesSolicitud(onCambio);
  const conEntidad = { ...sol, entidad: sol.entidad || entidad };
  const resuelve = puedeResolver(conEntidad);
  // La ficha trae la solicitud sin el nombre de quien la pidió: se toma de las cuentas activas.
  const cuentas = useCuentasActivas();
  const nombre = String(sol.solicitado_nombre || cuentas.find((c) => c.id === Number(sol.solicitado_por))?.nombre || "Otra persona");
  const propia = Number(sol.solicitado_por) === Number(user?.id);
  return (
    <div className="flex flex-col gap-3" data-solicitud-detalle={String(sol.id || "")}>
      <dl className={`grid gap-x-4 gap-y-1 ${compacto ? "text-sm" : "text-sm"} sm:grid-cols-[max-content_minmax(0,1fr)]`}>
        <dt className="text-ink-3">Qué se pidió</dt>
        <dd className="font-medium text-ink">{describirSolicitud(conEntidad)}</dd>
        <dt className="text-ink-3">Quién</dt>
        <dd className="text-ink">
          {nombre}
          {sol.solicitado_rol ? <span className="text-ink-3"> · {String(sol.solicitado_rol)}</span> : null}
        </dd>
        <dt className="text-ink-3">Cuándo</dt>
        <dd className="tnum text-ink">
          {formatearFechaHora(sol.solicitado_en)} <span className="text-ink-3">· {haceCuanto(sol.solicitado_en)}</span>
        </dd>
        <dt className="text-ink-3">Motivo</dt>
        <dd className="whitespace-pre-line text-ink">{String(sol.motivo || "—")}</dd>
      </dl>
      {resuelve || (propia && String(sol.estado || "pendiente") === "pendiente") ? (
        <div className="flex flex-wrap gap-2">
          {resuelve ? (
            <>
              <Button size="sm" icon={<Stamp size={15} />} onClick={() => acciones.aprobar(conEntidad)}>
                Aprobar
              </Button>
              <Button size="sm" variant="secondary" icon={<XCircle size={15} />} onClick={() => acciones.rechazar(conEntidad)}>
                Rechazar
              </Button>
            </>
          ) : null}
          {propia ? (
            <Button size="sm" variant="secondary" icon={<Prohibit size={15} />} onClick={() => acciones.cancelar(conEntidad)}>
              Cancelar solicitud
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-ink-3">La aprueba o la rechaza un segundo usuario con permiso; mientras tanto el registro no se edita ni se usa como origen.</p>
      )}
      {acciones.dialogo}
    </div>
  );
}

/*
 * Dentro de un formato en solo lectura todo queda en un <fieldset disabled>:
 * los avisos con botones se montan en #form-avisos (fuera del fieldset), si existe.
 */
function EnAvisos({ children }: { children: ReactNode }) {
  const [destino, setDestino] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // El lugar se monta en el mismo commit que el aviso: se busca justo después.
    const t = window.setTimeout(() => setDestino(document.getElementById("form-avisos")), 0);
    return () => window.clearTimeout(t);
  }, []);
  return destino ? createPortal(children, destino) : <>{children}</>;
}

/* Banner arriba del formato de un registro con solicitud pendiente. */
export function SolicitudBanner({ item, entidad, onCambio }: { item: ApiRecord | null | undefined; entidad?: string; onCambio?: () => void }) {
  const sol = item?.solicitud_pendiente as ApiRecord | null | undefined;
  if (!sol || String(sol.estado || "pendiente") !== "pendiente") return null;
  return (
    <EnAvisos>
    <section role="region" aria-label="Solicitud pendiente de autorización" data-banner-solicitud className="flex gap-3 rounded-card bg-warning-soft/70 px-4 py-3.5 ring-1 ring-warning/25">
      <Clock size={20} weight="duotone" className="mt-0.5 shrink-0 text-warning-text" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-base font-semibold text-ink">
          {String(sol.pendiente_etiqueta || "Solicitud")} · pendiente de autorización
        </p>
        <SolicitudDetalle sol={sol} entidad={entidad} onCambio={onCambio} />
      </div>
    </section>
    </EnAvisos>
  );
}

/* Visto bueno y regreso de lo capturado bajo supervision. */
export function useAccionesSupervision(onCambio?: () => void) {
  const { token } = useSession();
  const prompt = usePrompt();
  const [item, setItem] = useState<{ tabla: string; id: unknown; tipo: string; referencia: string } | null>(null);
  const [observaciones, setObservaciones] = useState("");
  const [clave, setClave] = useState("");
  const [enviando, setEnviando] = useState(false);
  const listo = () => {
    invalidate(...KEYS_SOLICITUD);
    onCambio?.();
  };
  const v = useValidacion({ titulo: "No se pudo dar el visto bueno", reglas: () => (!clave ? [{ campo: "vb-password", mensaje: msg.password }] : []) });
  const vistoBueno = (x: { tabla: string; id: unknown; tipo: string; referencia: string }) => {
    setObservaciones("");
    setClave("");
    setItem(x);
  };
  const confirmar = async () => {
    if (!item || !v.validar()) return;
    setEnviando(true);
    armarReauth({ password: clave });
    setClave("");
    try {
      await sendJsonAuth("POST", `${API_BASE_URL}/supervision/${item.tabla}/${item.id}/visto-bueno`, token, { observaciones: observaciones.trim() || null });
      toast.success(`Visto bueno registrado: ${item.tipo} ${item.referencia}`);
      setItem(null);
      listo();
    } catch (err) {
      v.errorServidor(err, { password: "vb-password" });
    } finally {
      setEnviando(false);
    }
  };
  const regresar = async (x: { tabla: string; id: unknown; tipo: string; referencia: string }) => {
    const obs = await prompt({ title: `Regresar ${x.tipo} ${x.referencia}`, description: "Quien lo capturó verá tus observaciones para corregirlo; mientras tanto el registro no avanza.", label: "Observaciones", placeholder: "Qué debe corregir o completar", minLength: 5, confirmLabel: "Regresar con observaciones", tone: "danger" });
    if (!obs) return;
    try {
      await sendJsonAuth("POST", `${API_BASE_URL}/supervision/${x.tabla}/${x.id}/regresar`, token, { observaciones: obs });
      toast.success("Registro regresado con observaciones");
      listo();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo regresar el registro");
    }
  };
  const dialogo = (
    <Dialog
      open={!!item}
      onOpenChange={(open) => !open && setItem(null)}
      title={item ? `Visto bueno: ${item.tipo} ${item.referencia}` : "Visto bueno"}
      description="Confirmas que revisaste lo capturado; el registro deja de estar pendiente y puede avanzar."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => setItem(null)}>
            Volver
          </Button>
          <Button icon={<SealCheck size={16} />} loading={enviando} onClick={confirmar}>
            Dar visto bueno
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <div className="flex flex-col gap-4">
          <Field label="Observaciones (opcional)" htmlFor="vb-obs">
            <Textarea id="vb-obs" rows={2} value={observaciones} onChange={(event) => setObservaciones(event.target.value)} />
          </Field>
          <CampoIdentidad value={clave} onChange={setClave} id="vb-password" />
        </div>
      </ValidacionAmbito>
    </Dialog>
  );
  return { vistoBueno, regresar, dialogo };
}

/* Banner de supervision en la ficha: el supervisor asignado da el visto bueno o regresa. */
export function SupervisionBanner({ item, tabla, tipo, referencia, onCambio, children }: { item: ApiRecord | null | undefined; tabla: string; tipo: string; referencia: string; onCambio?: () => void; children: ReactNode }) {
  const { user } = useSession();
  const acciones = useAccionesSupervision(onCambio);
  const pendiente = !!item && Number(item.requiere_supervision || 0) && String(item.supervision_estado || "") === "pendiente";
  const soySupervisor = pendiente && Number(item?.supervisor_id) === Number(user?.id);
  if (!soySupervisor) return <>{children}</>;
  const x = { tabla, id: item!.id, tipo, referencia };
  return (
    <EnAvisos>
    <section role="region" aria-label="Pendiente de tu visto bueno" data-banner-supervision className="flex gap-3 rounded-card bg-warning-soft/70 px-4 py-3.5 ring-1 ring-warning/25">
      <Clock size={20} weight="duotone" className="mt-0.5 shrink-0 text-warning-text" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-base font-semibold text-ink">Pendiente de tu visto bueno</p>
        <p className="text-sm text-ink-2">Lo capturó una persona bajo tu supervisión{item?.supervision_solicitada_en ? ` (${haceCuanto(item.supervision_solicitada_en)})` : ""}. No avanza hasta que des el visto bueno o lo regreses con observaciones.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<SealCheck size={15} />} onClick={() => acciones.vistoBueno(x)}>
            Dar visto bueno
          </Button>
          <Button size="sm" variant="secondary" icon={<ArrowUUpLeft size={15} />} onClick={() => acciones.regresar(x)}>
            Regresar
          </Button>
        </div>
      </div>
      {acciones.dialogo}
    </section>
    </EnAvisos>
  );
}

/* Pendientes que la persona puede resolver (solicitudes) y supervisar (visto bueno). */
export function usePendientesPorResolver() {
  const { token } = useSession();
  const solicitudes = useResource<ApiRecord[]>(["solicitudes", "solicitudes:pendientes"], async () => ((await getJsonAuth(`${API_BASE_URL}/solicitudes`, token)).items || []) as ApiRecord[], { enabled: !!token });
  const supervision = useResource<ApiRecord[]>(["supervision"], async () => ((await getJsonAuth(`${API_BASE_URL}/supervision`, token)).por_supervisar || []) as ApiRecord[], { enabled: !!token });
  return { solicitudes: (solicitudes.data || []).filter((s) => s.puedo_aprobar), supervision: supervision.data || [] };
}

/*
 * Franja discreta arriba de la lista de un modulo: solo para quien puede
 * resolver. "2 solicitudes esperan tu autorización · Ver" abre la bandeja
 * filtrada por el modulo; lo mismo para el visto bueno del supervisor.
 */
export function FranjaPendientes({ entidades, grupo }: { entidades: string[]; grupo: string }) {
  const { solicitudes, supervision } = usePendientesPorResolver();
  const nSol = solicitudes.filter((s) => entidades.includes(String(s.entidad))).length;
  const nSup = supervision.filter((s) => entidades.includes(String(s.tabla))).length;
  if (!nSol && !nSup) return null;
  return (
    <div className="mb-3 flex flex-col gap-1.5" data-franja-pendientes>
      {nSol ? (
        <Link href={`/solicitudes?modulo=${grupo}`} className="press flex items-center gap-2 rounded-box bg-warning-soft/60 px-3.5 py-2.5 text-sm text-ink ring-1 ring-warning/20 hover:bg-warning-soft">
          <Clock size={16} weight="duotone" className="shrink-0 text-warning-text" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="tnum font-semibold">{nSol}</span> {nSol === 1 ? "solicitud espera tu autorización" : "solicitudes esperan tu autorización"}
          </span>
          <span className="inline-flex items-center gap-1 font-medium text-brand-strong">
            Ver <ArrowRight size={13} weight="bold" />
          </span>
        </Link>
      ) : null}
      {nSup ? (
        <Link href="/supervision" className="press flex items-center gap-2 rounded-box bg-brand-faint px-3.5 py-2.5 text-sm text-ink ring-1 ring-brand/15 hover:bg-brand-soft/60">
          <SealCheck size={16} weight="duotone" className="shrink-0 text-brand" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="tnum font-semibold">{nSup}</span> {nSup === 1 ? "registro espera tu visto bueno" : "registros esperan tu visto bueno"}
          </span>
          <span className="inline-flex items-center gap-1 font-medium text-brand-strong">
            Ver <ArrowRight size={13} weight="bold" />
          </span>
        </Link>
      ) : null}
    </div>
  );
}

/*
 * Banner para fichas cuya API no trae `solicitud_pendiente` (documentos,
 * usuarios): consulta las solicitudes pendientes del registro.
 */
export function SolicitudBannerDe({ entidad, entidadId }: { entidad: string; entidadId: number | string | null | undefined }) {
  const { token } = useSession();
  const recurso = useResource<ApiRecord[]>(
    ["solicitudes", `solicitudes:${entidad}:${entidadId}`],
    async () => ((await getJsonAuth(`${API_BASE_URL}/solicitudes?entidad=${encodeURIComponent(entidad)}&entidad_id=${encodeURIComponent(String(entidadId))}`, token)).items || []) as ApiRecord[],
    { enabled: !!token && !!entidadId },
  );
  const sol = (recurso.data || []).find((s) => String(s.estado) === "pendiente");
  return sol ? <SolicitudBanner item={{ solicitud_pendiente: sol }} entidad={entidad} /> : null;
}
