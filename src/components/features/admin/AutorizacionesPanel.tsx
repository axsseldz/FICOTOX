"use client";

/*
 * Autorizaciones del personal (FX-THF-AP, Fase 4): lista por persona y, para
 * quien las administra (ensayos:A o calidad:A, nunca sobre si mismo), alta y
 * revocacion con motivo y contrasena. Nada se borra: revocar la deja en la lista.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Flask, ListChecks, Plus, Prohibit, Wrench } from "@phosphor-icons/react";
import { cn } from "@/components/ui/cn";
import { Callout, Panel } from "@/components/features/samples/FormLayout";
import { useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { msg, type Problema } from "@/lib/client/mensajes";
import { useSession } from "@/components/session/SessionProvider";
import { CampoIdentidad } from "@/components/session/Reautenticar";
import { Button } from "@/components/ui/Button";
import { DateInput } from "@/components/ui/DateInput";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/Field";
import { usePrompt } from "@/components/ui/Overlay";
import { Badge, Skeleton, type Tone } from "@/components/ui/Primitives";
import { API_BASE_URL, armarReauth, getJsonAuth, sendJsonAuth } from "@/lib/client/api";
import { invalidate } from "@/lib/client/store";
import { ETIQUETA_ESTADO_AUTORIZACION, TIPOS_AUTORIZACION, type AutorizacionPersonal, type EstadoAutorizacion } from "@/lib/shared/autorizaciones";
import { diasEntre, formatearFecha, hoyLocal } from "@/lib/shared/fechas";

const TONO_ESTADO: Record<EstadoAutorizacion, Tone> = { vigente: "success", por_iniciar: "brand", vencida: "neutral", revocada: "danger" };

/* "vigente hasta 31/12/2026 · quedan 89 días", "empieza el …", "venció el …". */
function vigenciaEnPalabras(a: AutorizacionPersonal, estado: EstadoAutorizacion): string {
  if (estado === "revocada") return `Revocada el ${formatearFecha(a.revocada_en)}`;
  if (estado === "por_iniciar") return `Empieza el ${formatearFecha(a.vigente_desde)}`;
  if (estado === "vencida") return `Venció el ${formatearFecha(a.vigente_hasta)}`;
  if (!a.vigente_hasta) return "Vigente, sin fecha de fin";
  const dias = diasEntre(hoyLocal(), a.vigente_hasta);
  return `Vigente hasta el ${formatearFecha(a.vigente_hasta)}${dias !== null ? ` · ${dias === 0 ? "vence hoy" : dias === 1 ? "queda 1 día" : `quedan ${dias} días`}` : ""}`;
}

const GRUPOS: Array<{ tipo: string; titulo: string; icono: ReactNode }> = [
  { tipo: "actividad", titulo: "Actividades", icono: <ListChecks size={17} weight="duotone" /> },
  { tipo: "metodo", titulo: "Métodos", icono: <Flask size={17} weight="duotone" /> },
  { tipo: "equipo", titulo: "Equipos", icono: <Wrench size={17} weight="duotone" /> },
];

function FilaAutorizacion({ a, i, onRevocar }: { a: AutorizacionPersonal; i: number; onRevocar?: (a: AutorizacionPersonal) => void }) {
  const estado = (a.estado || "vigente") as EstadoAutorizacion;
  const revocable = !!onRevocar && (estado === "vigente" || estado === "por_iniciar");
  const dias = estado === "vigente" && a.vigente_hasta ? diasEntre(hoyLocal(), a.vigente_hasta) : null;
  const porVencer = dias !== null && dias < 30;
  return (
    <li className={cn("entrada-escalonada flex flex-wrap items-start gap-3 rounded-[12px] bg-surface px-3.5 py-3 ring-1 transition-shadow duration-200 hover:shadow-raised", porVencer ? "ring-warning/40" : "ring-line")} style={{ ["--i" as string]: i }} data-autorizacion={a.id}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-medium text-ink">{a.etiqueta || "Autorización"}</span>
          {estado !== "vigente" ? (
            <Badge tone={TONO_ESTADO[estado]} dot>
              {ETIQUETA_ESTADO_AUTORIZACION[estado]}
            </Badge>
          ) : null}
        </div>
        <span className={cn("text-[12.5px]", porVencer ? "text-warning-text" : "text-ink-3")}>
          {vigenciaEnPalabras(a, estado)}
          {a.folio_fx_thf_ap ? ` · formato ${a.folio_fx_thf_ap}` : ""}
        </span>
        {porVencer ? <span className="text-[12px] text-warning-text">Vence pronto: conviene renovarla.</span> : null}
        {a.motivo_revocacion ? <span className="text-[12.5px] text-ink-3">Motivo: {a.motivo_revocacion}</span> : null}
      </div>
      {revocable ? (
        <Button size="sm" variant="secondary" icon={<Prohibit size={14} />} onClick={() => onRevocar!(a)}>
          Revocar
        </Button>
      ) : null}
    </li>
  );
}

/*
 * Lista de autorizaciones FX-THF-AP (tambien la usa "Mi cuenta"): agrupadas en
 * Actividades, Metodos y Equipos, con su vigencia en palabras y un aviso suave
 * si vencen en menos de 30 dias. Las revocadas o vencidas quedan plegadas.
 */
export function ListaAutorizaciones({ items, onRevocar }: { items: AutorizacionPersonal[]; onRevocar?: (a: AutorizacionPersonal) => void }) {
  if (!items.length) return <p className="text-[13px] text-ink-3">Sin autorizaciones registradas en FX-THF-AP.</p>;
  const activa = (a: AutorizacionPersonal) => ["vigente", "por_iniciar"].includes(String(a.estado || "vigente"));
  const inactivas = items.filter((a) => !activa(a));
  return (
    <div className="flex flex-col gap-4" aria-label="Autorizaciones FX-THF-AP">
      {GRUPOS.map((g) => {
        const lista = items.filter((a) => a.tipo === g.tipo && activa(a));
        if (!lista.length) return null;
        return (
          <section key={g.tipo} className="flex flex-col gap-2">
            <h4 className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
              <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-brand-soft text-brand-strong">
                {g.icono}
              </span>
              {g.titulo}
              <span className="font-normal text-ink-3">· {lista.length}</span>
            </h4>
            <ul className="flex flex-col gap-2">
              {lista.map((a, i) => (
                <FilaAutorizacion key={a.id} a={a} i={i} onRevocar={onRevocar} />
              ))}
            </ul>
          </section>
        );
      })}
      {!items.some(activa) ? <p className="text-[13px] text-ink-3">No tiene autorizaciones vigentes.</p> : null}
      {inactivas.length ? (
        <details className="group/aut rounded-[14px] bg-surface-2 ring-1 ring-line">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-[13.5px] font-medium text-ink-2 [&::-webkit-details-marker]:hidden">
            Revocadas o vencidas ({inactivas.length})
            <span aria-hidden="true" className="text-ink-4 transition-transform duration-200 ease-[var(--ease-spring)] group-open/aut:rotate-180">
              ▾
            </span>
          </summary>
          <ul className="flex flex-col gap-2 px-3 pb-3">
            {inactivas.map((a, i) => (
              <FilaAutorizacion key={a.id} a={a} i={i} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

type Catalogo = { actividades: Array<{ value: string; label: string }>; metodos: Array<{ value: string; label: string }>; equipos: Array<{ value: string; label: string }> };

/* Pestaña "Autorizaciones (FX-THF-AP)" de la ficha de un usuario. */
export function AutorizacionesUsuario({ usuarioId }: { usuarioId: number }) {
  const { token } = useSession();
  const prompt = usePrompt();
  const [items, setItems] = useState<AutorizacionPersonal[] | null>(null);
  const [puede, setPuede] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [nueva, setNueva] = useState({ tipo: "actividad", clave: "", desde: hoyLocal(), hasta: "", folio: "", motivo: "" });
  const [clave, setClave] = useState("");
  const [guardando, setGuardando] = useState(false);
  // El formulario de alta aparece al pulsar "Agregar".
  const [agregarAbierto, setAgregarAbierto] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const data = await getJsonAuth(`${API_BASE_URL}/admin/usuarios/${usuarioId}/autorizaciones`, token);
      setItems((data.items || []) as AutorizacionPersonal[]);
      setPuede(!!data.puede_administrar);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar las autorizaciones");
    }
  }, [usuarioId, token]);

  useEffect(() => {
    // La carga se agenda como microtarea: el efecto solo dispara la sincronizacion.
    void Promise.resolve().then(cargar);
  }, [cargar]);

  useEffect(() => {
    if (!puede || catalogo) return;
    getJsonAuth(`${API_BASE_URL}/autorizaciones/catalogo`, token)
      .then((data) => setCatalogo(data as unknown as Catalogo))
      .catch(() => setCatalogo({ actividades: [], metodos: [], equipos: [] }));
  }, [puede, catalogo, token]);

  const opciones = !catalogo ? [] : nueva.tipo === "metodo" ? catalogo.metodos : nueva.tipo === "equipo" ? catalogo.equipos : catalogo.actividades;
  const queSe = nueva.tipo === "metodo" ? "el método" : nueva.tipo === "equipo" ? "el equipo" : "la actividad";
  const v = useValidacion({
    titulo: "No se pudo registrar la autorización",
    reglas: () => {
      const out: Problema[] = [];
      if (!nueva.clave) out.push({ campo: "aut-clave", mensaje: msg.elige(`${queSe} que se autoriza`) });
      if (nueva.desde && nueva.hasta && nueva.hasta < nueva.desde) out.push({ campo: "aut-hasta", mensaje: msg.fechaAnterior("La fecha de fin", "la de inicio") });
      if (nueva.motivo.trim().length < 5) out.push({ campo: "aut-motivo", mensaje: msg.minimo("El motivo", 5) });
      return out;
    },
  });

  const agregar = async () => {
    if (!v.validar()) return;
    armarReauth(clave ? { password: clave } : null);
    setGuardando(true);
    try {
      const data = await sendJsonAuth("POST", `${API_BASE_URL}/admin/usuarios/${usuarioId}/autorizaciones`, token, {
        tipo: nueva.tipo,
        clave: nueva.clave,
        vigente_desde: nueva.desde || null,
        vigente_hasta: nueva.hasta || null,
        folio_fx_thf_ap: nueva.folio.trim() || null,
        motivo: nueva.motivo.trim(),
      });
      toast.success(String(data.message || "Autorización registrada"));
      setNueva((prev) => ({ ...prev, clave: "", hasta: "", motivo: "" }));
      setClave("");
      setAgregarAbierto(false);
      await cargar();
      invalidate("dashboard");
    } catch (err) {
      v.errorServidor(err, { motivo: "aut-motivo", password: "aut-clave-admin" });
    } finally {
      setGuardando(false);
    }
  };

  const revocar = async (a: AutorizacionPersonal) => {
    const motivo = await prompt({ critico: true, title: `Revocar "${a.etiqueta || a.clave}"`, description: "La autorización queda en la lista como revocada y deja de contar de inmediato.", label: "Motivo", minLength: 5, confirmLabel: "Revocar", tone: "danger" });
    if (!motivo) return;
    try {
      await sendJsonAuth("POST", `${API_BASE_URL}/admin/usuarios/${usuarioId}/autorizaciones/${a.id}/revocar`, token, { motivo });
      toast.success("Autorización revocada");
      await cargar();
      invalidate("dashboard");
    } catch (err) {
      v.errorServidor(err);
    }
  };

  if (error) return <Callout tone="danger">{error}</Callout>;
  if (!items) return <Skeleton className="h-24 w-full" />;

  return (
    <ValidacionAmbito v={v}>
    <div className="flex flex-col gap-3" id="autorizaciones-usuario">
      <p className="text-[13px] text-ink-3">Además del rol, la persona solo puede trabajar con los métodos, equipos y actividades para los que está autorizada (formato FX-THF-AP), mientras la autorización esté vigente.</p>
      <ListaAutorizaciones items={items} onRevocar={puede ? revocar : undefined} />
      {puede && !agregarAbierto ? (
        <div>
          <Button size="sm" icon={<Plus size={14} weight="bold" />} onClick={() => setAgregarAbierto(true)}>
            Agregar
          </Button>
        </div>
      ) : null}
      {puede && agregarAbierto ? (
        <Panel title="Agregar autorización" description="La registra quien aprueba en ensayos o calidad; nadie se autoriza a sí mismo. Queda en la bitácora con su motivo.">
          <FormGrid>
            <Field label="Tipo" htmlFor="aut-tipo" required>
              <Select id="aut-tipo" value={nueva.tipo} onChange={(event) => setNueva((prev) => ({ ...prev, tipo: event.target.value, clave: "" }))}>
                {TIPOS_AUTORIZACION.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={nueva.tipo === "metodo" ? "Método" : nueva.tipo === "equipo" ? "Equipo" : "Actividad"} htmlFor="aut-clave" required hint={nueva.tipo === "equipo" && catalogo && !catalogo.equipos.length ? "No hay equipos activos en el inventario." : undefined}>
              <Select id="aut-clave" value={nueva.clave} onChange={(event) => setNueva((prev) => ({ ...prev, clave: event.target.value }))}>
                <option value="">Seleccionar</option>
                {opciones.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Vigente desde" htmlFor="aut-desde">
              <DateInput id="aut-desde" value={nueva.desde} onChange={(value) => setNueva((prev) => ({ ...prev, desde: value }))} />
            </Field>
            <Field label="Vigente hasta" htmlFor="aut-hasta" hint="Opcional">
              <DateInput id="aut-hasta" value={nueva.hasta} onChange={(value) => setNueva((prev) => ({ ...prev, hasta: value }))} />
            </Field>
            <Field label="Folio FX-THF-AP" htmlFor="aut-folio" hint="Folio del formato en papel">
              <Input id="aut-folio" maxLength={80} value={nueva.folio} onChange={(event) => setNueva((prev) => ({ ...prev, folio: event.target.value }))} />
            </Field>
            <Field label="Motivo" htmlFor="aut-motivo" required>
              <Textarea id="aut-motivo" rows={2} maxLength={300} value={nueva.motivo} onChange={(event) => setNueva((prev) => ({ ...prev, motivo: event.target.value }))} placeholder="Ej. Evaluación de competencia aprobada" />
            </Field>
          </FormGrid>
          <CampoIdentidad value={clave} onChange={setClave} id="aut-clave-admin" />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setAgregarAbierto(false)}>
              Cancelar
            </Button>
            <Button icon={<Plus size={14} weight="bold" />} onClick={agregar} loading={guardando} id="aut-agregar">
              Agregar
            </Button>
          </div>
        </Panel>
      ) : null}
    </div>
    </ValidacionAmbito>
  );
}
