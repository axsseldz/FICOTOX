"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Textarea } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Overlay";
import { CampoCargo, CampoIdentidad, useConfirmaConPassword } from "@/components/session/Reautenticar";
import { armarCargo, armarReauth } from "@/lib/client/api";
import { EditableScope } from "./FormLayout";
import { SignaturePad } from "./SignaturePad";

/*
 * Dialogo de firma para revisar, aprobar o autorizar: deja constancia con el
 * nombre de la sesion, firma y observaciones. El cargo no se captura: el
 * servidor guarda el del rol con el que se actua (si hay varios, el dialogo
 * "Actuar como" lo pregunta al confirmar).
 */
export function SignDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  withObservaciones = false,
  requireSignature = false,
  loading = false,
  critico = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  withObservaciones?: boolean;
  requireSignature?: boolean;
  loading?: boolean;
  /* Aprobar/autorizar (Fase 2): pide la contrasena en el mismo dialogo. */
  critico?: boolean;
  onConfirm: (data: { firma: string; observaciones: string }) => Promise<void> | void;
}) {
  const [firma, setFirma] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [cargo, setCargo] = useState("");
  const conPassword = useConfirmaConPassword();

  const submit = async () => {
    if (requireSignature && !firma) {
      setError("La firma es obligatoria");
      return;
    }
    if (critico && conPassword && !password) {
      setError("Escribe tu contraseña para confirmar");
      return;
    }
    setError(null);
    if (critico) armarReauth(conPassword ? { password } : null);
    armarCargo(cargo ? Number(cargo) : null);
    setPassword("");
    await onConfirm({ firma, observaciones: observaciones.trim() });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          {error ? <p className="mr-auto text-sm text-danger">{error}</p> : null}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {withObservaciones ? (
          <Field label="Observaciones" htmlFor="sign-obs">
            <Textarea id="sign-obs" rows={3} value={observaciones} onChange={(event) => setObservaciones(event.target.value)} />
          </Field>
        ) : null}
        <Field label={requireSignature ? "Firma" : "Firma (opcional)"}>
          <EditableScope>
            <SignaturePad value={firma} onChange={setFirma} label={`Firma: ${title}`} />
          </EditableScope>
        </Field>
        {critico ? (
          <CampoIdentidad value={password} onChange={setPassword} id="sign-password" cargo={cargo} onCargo={setCargo} />
        ) : (
          <CampoCargo value={cargo} onChange={setCargo} />
        )}
      </div>
    </Dialog>
  );
}
