"use client";

import { useState, type ReactNode } from "react";
import { CircleNotch, ShieldCheck } from "@phosphor-icons/react";
import { CampoIdentidad } from "@/components/session/Reautenticar";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Overlay";
import { Badge } from "@/components/ui/Primitives";
import { useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { armarCargo, armarReauth } from "@/lib/client/api";
import { msg } from "@/lib/client/mensajes";
import { instanteDe } from "@/lib/shared/fechas";

/* Piezas comunes de Calidad › Respaldos: textos en palabras simples, insignias y el dialogo que confirma con la contraseña. */

export const TIPOS_RESPALDO: Record<string, string> = {
  manual: "Manual",
  automatico: "Automático",
  pre_actualizacion: "Antes de actualizar",
  pre_migracion: "Antes de migrar",
  pre_restauracion: "Previo a restauración",
  importado: "Importado",
};

/* Por qué no se puede restaurar un respaldo sellado con otra llave (lo explica el servidor igual: 409 llave_distinta). */
export const FRASE_LLAVE_DISTINTA = "Se selló con otra llave del registro de actividad: no se puede restaurar en esta instalación. Solo se puede recuperar en una instalación nueva (Configuración inicial) o por terminal con su llave.";

export const FRASE_OCUPADO = "Hay un respaldo en curso";

/* Tamaño en MB con un decimal (o "menos de 0.1 MB"). */
export function mb(bytes: unknown): string {
  const n = Number(bytes || 0) / 1_048_576;
  if (!n) return "—";
  return n < 0.1 ? "< 0.1 MB" : `${n.toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

export const archivosTexto = (n: unknown): string => (Number(n) === 1 ? "1 archivo" : `${Number(n || 0).toLocaleString("es-MX")} archivos`);

/* "hace 2 horas", "hace 12 días": tiempo transcurrido en palabras completas. */
export function hace(valor: unknown, ahora = new Date()): string {
  const fecha = instanteDe(valor);
  if (!fecha) return "";
  const seg = Math.max(0, Math.round((ahora.getTime() - fecha.getTime()) / 1000));
  const plural = (n: number, uno: string, varios: string) => `hace ${n} ${n === 1 ? uno : varios}`;
  if (seg < 60) return "hace un momento";
  const min = Math.round(seg / 60);
  if (min < 60) return plural(min, "minuto", "minutos");
  const h = Math.round(min / 60);
  if (h < 24) return plural(h, "hora", "horas");
  const dias = Math.round(h / 24);
  if (dias < 31) return plural(dias, "día", "días");
  const meses = Math.round(dias / 30);
  if (meses < 12) return plural(meses, "mes", "meses");
  const anios = Math.round(meses / 12);
  return plural(anios, "año", "años");
}

/* Insignia de verificación: «Restauración probada», «Prueba fallida» o nada si no se ha probado. */
export function InsigniaVerificacion({ verificacion }: { verificacion: { resultado?: string } | null | undefined }) {
  if (!verificacion) return null;
  return verificacion.resultado === "aprobada" ? <Badge tone="success" dot>Restauración probada</Badge> : <Badge tone="danger" dot>Prueba fallida</Badge>;
}

/* Marca discreta del respaldo que la retención nunca borra. */
export function MarcaProtegido() {
  return (
    <span className="inline-flex items-center gap-1 text-2xs text-ink-3" title="La limpieza automática nunca lo borra: es el último que se comprobó que se puede recuperar.">
      <ShieldCheck size={13} weight="duotone" aria-hidden="true" /> Se conserva siempre
    </span>
  );
}

export function Girando({ texto }: { texto: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <CircleNotch size={16} className="animate-spin text-brand motion-reduce:animate-none" aria-hidden="true" />
      {texto}
    </span>
  );
}

/*
 * Confirma una acción de respaldos con la contraseña (reautenticación). Con
 * `conEtiqueta` pide además una etiqueta opcional ("Antes de capturar el lote
 * de octubre"). El error del servidor se muestra en el mismo diálogo.
 */
export function ConfirmarRespaldo({
  titulo,
  descripcion,
  confirmar,
  conEtiqueta = false,
  conMotivo = false,
  aviso,
  peligro = false,
  onCerrar,
  onConfirmar,
}: {
  titulo: string;
  descripcion: ReactNode;
  confirmar: string;
  conEtiqueta?: boolean;
  /* Motivo obligatorio (restaurar): se entrega en lugar de la nota. */
  conMotivo?: boolean;
  /* Advertencia destacada arriba de los campos. */
  aviso?: ReactNode;
  peligro?: boolean;
  onCerrar: () => void;
  onConfirmar: (texto: string) => Promise<void>;
}) {
  const [abierta, setAbierta] = useState(true);
  const [etiqueta, setEtiqueta] = useState("");
  const [motivo, setMotivo] = useState("");
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const v = useValidacion({
    titulo: "Falta información para continuar",
    reglas: () => [
      ...(conMotivo && motivo.trim().length < 5 ? [{ campo: "respaldo-motivo", mensaje: "Indica el motivo (al menos 5 caracteres)" }] : []),
      ...(password ? [] : [{ campo: "respaldo-password", mensaje: msg.password }]),
    ],
  });
  const cerrar = () => {
    setAbierta(false);
    window.setTimeout(onCerrar, 220);
  };
  const aceptar = async () => {
    if (!v.validar()) return;
    armarReauth({ password });
    armarCargo(null);
    setEnviando(true);
    try {
      await onConfirmar(conMotivo ? motivo.trim() : etiqueta.trim());
      cerrar();
    } catch (err) {
      v.errorServidor(err);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Dialog
      open={abierta}
      onOpenChange={(abrir) => (abrir ? setAbierta(true) : cerrar())}
      title={titulo}
      description={descripcion}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={cerrar}>
            Cancelar
          </Button>
          <Button variant={peligro ? "danger" : "primary"} onClick={aceptar} loading={enviando}>
            {confirmar}
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <div className="flex flex-col gap-4">
          {aviso}
          {conMotivo ? (
            <Field label="Motivo" htmlFor="respaldo-motivo" required hint="Queda en la solicitud y en el registro de actividad.">
              <Textarea id="respaldo-motivo" value={motivo} maxLength={500} rows={3} onChange={(event) => setMotivo(event.target.value)} autoFocus />
            </Field>
          ) : null}
          {conEtiqueta ? (
            <Field label="Nota (opcional)" htmlFor="respaldo-etiqueta" hint="Sirve para reconocerlo después, por ejemplo: «Antes de capturar el lote de octubre».">
              <Input id="respaldo-etiqueta" value={etiqueta} maxLength={80} onChange={(event) => setEtiqueta(event.target.value)} autoFocus />
            </Field>
          ) : null}
          <CampoIdentidad value={password} onChange={setPassword} id="respaldo-password" />
        </div>
      </ValidacionAmbito>
    </Dialog>
  );
}
