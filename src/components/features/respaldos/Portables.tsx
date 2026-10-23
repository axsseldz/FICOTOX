"use client";

import { useRef, useState } from "react";
import { FileArrowUp, LockKey } from "@phosphor-icons/react";
import { CampoIdentidad } from "@/components/session/Reautenticar";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Field, Input } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Overlay";
import { useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { cn } from "@/components/ui/cn";
import { API_BASE_URL, ApiError, armarCargo, armarReauth, sendJsonAuth } from "@/lib/client/api";
import { msg, type Problema } from "@/lib/client/mensajes";
import { subirPorPartes } from "@/lib/client/subida-partes";
import type { ApiRecord } from "@/lib/client/types";
import { fmtDateTime } from "@/lib/client/format";
import { limiteTexto, mb } from "./comun";

/*
 * Respaldos portables (Calidad › Respaldos, solo respaldos:G):
 * - «Descargar»: el respaldo en un archivo .ficotox cifrado con una contraseña
 *   que se escribe dos veces. Sin ella el archivo no se puede restaurar.
 * - «Importar respaldo»: se sube un .ficotox (por partes, con avance), se
 *   descifra y se verifica en el servidor; queda en la lista como «Importado».
 * Ambas se confirman con la contraseña de la cuenta (reautenticación).
 */

const CONTRASENA_MIN = 12;

function useCerrar(onCerrar: () => void) {
  const [abierta, setAbierta] = useState(true);
  const cerrar = () => {
    setAbierta(false);
    window.setTimeout(onCerrar, 220);
  };
  return { abierta, setAbierta, cerrar };
}

export function DescargarRespaldo({ token, respaldo, onCerrar }: { token: string; respaldo: { id: string; creado_en: unknown; tamano?: unknown }; onCerrar: () => void }) {
  const { abierta, setAbierta, cerrar } = useCerrar(onCerrar);
  const [contrasena, setContrasena] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const v = useValidacion({
    titulo: "Falta información para descargar",
    reglas: () => {
      const out: Problema[] = [];
      if (contrasena.length < CONTRASENA_MIN) out.push({ campo: "descarga-contrasena", mensaje: contrasena ? `La contraseña de cifrado debe tener al menos ${CONTRASENA_MIN} caracteres` : msg.escribe("una contraseña de cifrado") });
      else if (confirmacion !== contrasena) out.push({ campo: "descarga-confirmacion", mensaje: confirmacion ? "Las dos contraseñas de cifrado no coinciden" : msg.escribe("otra vez la contraseña de cifrado") });
      if (!password) out.push({ campo: "descarga-password", mensaje: msg.password });
      return out;
    },
  });
  const aceptar = async () => {
    if (!v.validar()) return;
    armarReauth({ password });
    armarCargo(null);
    setEnviando(true);
    try {
      const data = await sendJsonAuth("POST", `${API_BASE_URL}/respaldos/${encodeURIComponent(respaldo.id)}/descargar`, token, { contrasena, confirmacion });
      // El enlace es de un solo uso y vence en 2 minutos: el navegador lo descarga como un archivo normal.
      const a = document.createElement("a");
      a.href = String(data.url);
      a.download = String(data.nombre || "respaldo.ficotox");
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setContrasena("");
      setConfirmacion("");
      cerrar();
    } catch (err) {
      v.errorServidor(err, { contrasena: "descarga-contrasena", confirmacion: "descarga-confirmacion" });
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Dialog
      open={abierta}
      onOpenChange={(abrir) => (abrir ? setAbierta(true) : cerrar())}
      title="Descargar respaldo"
      description={`Respaldo del ${fmtDateTime(respaldo.creado_en)}${respaldo.tamano ? ` (${mb(respaldo.tamano)})` : ""}, en un archivo cifrado para guardarlo fuera de esta computadora.`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={cerrar}>
            Cancelar
          </Button>
          <Button onClick={aceptar} loading={enviando} data-confirmar-descarga>
            Descargar
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <div className="flex flex-col gap-4">
          <Callout tone="warning" title="Sin esta contraseña el archivo no se puede restaurar" data-aviso-descarga>
            No se guarda en ningún lado y nadie puede recuperarla. Anótala en un lugar seguro, separada del archivo (por ejemplo, en un sobre cerrado o un gestor de contraseñas).
          </Callout>
          <Field label="Contraseña de cifrado" htmlFor="descarga-contrasena" required hint={`Al menos ${CONTRASENA_MIN} caracteres. Distinta de tu contraseña de la plataforma.`}>
            <Input id="descarga-contrasena" type="password" autoComplete="new-password" value={contrasena} onChange={(e) => setContrasena(e.target.value)} leading={<LockKey size={16} />} autoFocus />
          </Field>
          <Field label="Escríbela otra vez" htmlFor="descarga-confirmacion" required>
            <Input id="descarga-confirmacion" type="password" autoComplete="new-password" value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} leading={<LockKey size={16} />} />
          </Field>
          <CampoIdentidad value={password} onChange={setPassword} id="descarga-password" />
        </div>
      </ValidacionAmbito>
    </Dialog>
  );
}

export function ImportarRespaldo({ token, limiteMb, onCerrar, onIniciado }: { token: string; limiteMb: number; onCerrar: () => void; onIniciado: (trabajo: ApiRecord) => void }) {
  const { abierta, setAbierta, cerrar } = useCerrar(onCerrar);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [contrasena, setContrasena] = useState("");
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [avance, setAvance] = useState<number | null>(null);
  // Si la contraseña del archivo estaba mal, el archivo ya subido se reutiliza.
  const subida = useRef<{ id: string; archivo: File } | null>(null);
  const entrada = useRef<HTMLInputElement | null>(null);
  const v = useValidacion({
    titulo: "Falta información para importar",
    reglas: () => {
      const out: Problema[] = [];
      if (!archivo) out.push({ campo: "importar-archivo", mensaje: "Elige el archivo .ficotox del respaldo" });
      else if (archivo.size > limiteMb * 1048576) out.push({ campo: "importar-archivo", mensaje: `El archivo pesa ${mb(archivo.size)} y el límite es de ${limiteTexto(limiteMb)}` });
      if (!contrasena) out.push({ campo: "importar-contrasena", mensaje: msg.escribe("la contraseña de cifrado del archivo") });
      if (!password) out.push({ campo: "importar-password", mensaje: msg.password });
      return out;
    },
  });
  const aceptar = async () => {
    if (!v.validar() || !archivo) return;
    setEnviando(true);
    try {
      let id = subida.current?.archivo === archivo ? subida.current.id : null;
      if (!id) {
        setAvance(0);
        const inicio = await sendJsonAuth("POST", `${API_BASE_URL}/respaldos/importar/subidas`, token, { tamano: archivo.size, nombre: archivo.name });
        id = String(inicio.id);
        await subirPorPartes({ url: `${API_BASE_URL}/respaldos/importar/subidas`, id, trozo: Number(inicio.trozo), archivo, encabezados: { Authorization: `Bearer ${token}` }, alAvance: setAvance });
        subida.current = { id, archivo };
      }
      armarReauth({ password });
      armarCargo(null);
      const data = await sendJsonAuth("POST", `${API_BASE_URL}/respaldos/importar`, token, { subida: id, contrasena });
      subida.current = null;
      onIniciado(data.trabajo as ApiRecord);
      cerrar();
    } catch (err) {
      if (!(err instanceof ApiError) || err.codigo !== "contrasena_incorrecta") subida.current = null;
      v.errorServidor(err, { contrasena: "importar-contrasena", archivo: "importar-archivo" });
    } finally {
      setEnviando(false);
      setAvance(null);
    }
  };
  return (
    <Dialog
      open={abierta}
      onOpenChange={(abrir) => (abrir ? setAbierta(true) : !enviando && cerrar())}
      title="Importar respaldo"
      description="Trae un respaldo descargado en esta u otra computadora (archivo .ficotox). Se descifra y se verifica antes de agregarlo a la lista; después se restaura como cualquier otro, con la aprobación de otra persona."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={cerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={aceptar} loading={enviando} data-confirmar-importar>
            Importar
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <div className="flex flex-col gap-4">
          <Field label="Archivo del respaldo" htmlFor="importar-archivo" required hint={`Archivo .ficotox, hasta ${limiteTexto(limiteMb)}.`}>
            <div className="flex items-center gap-3 rounded-field bg-surface-2 p-3 ring-1 ring-line">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-box bg-brand-soft text-brand-strong" aria-hidden="true">
                <FileArrowUp size={20} weight="duotone" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-ink">{archivo ? archivo.name : "Ningún archivo elegido"}</span>
                <span className="text-xs text-ink-3">{archivo ? mb(archivo.size) : "ficotox-respaldo-….ficotox"}</span>
              </span>
              <Button size="sm" variant="secondary" onClick={() => entrada.current?.click()} disabled={enviando}>
                {archivo ? "Cambiar" : "Elegir"}
              </Button>
              <input ref={entrada} id="importar-archivo" type="file" accept=".ficotox,application/octet-stream" className="sr-only" onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
            </div>
          </Field>
          <Field label="Contraseña de cifrado del archivo" htmlFor="importar-contrasena" required hint="La que se escribió al descargarlo.">
            <Input id="importar-contrasena" type="password" autoComplete="off" value={contrasena} onChange={(e) => setContrasena(e.target.value)} leading={<LockKey size={16} />} />
          </Field>
          <CampoIdentidad value={password} onChange={setPassword} id="importar-password" />
          {avance !== null ? (
            <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
              <span className="text-sm text-ink-2">Subiendo el archivo… {Math.round(avance * 100)} %</span>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                <div className={cn("h-full origin-left rounded-full bg-brand transition-transform duration-300 motion-reduce:transition-none")} style={{ transform: `scaleX(${Math.max(0.02, avance)})` }} />
              </div>
            </div>
          ) : null}
        </div>
      </ValidacionAmbito>
    </Dialog>
  );
}
