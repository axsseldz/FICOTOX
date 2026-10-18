"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/components/session/SessionProvider";
import { AvatarArt, AVATARS, resolveAvatarKey } from "@/components/ui/AvatarArt";
import { useFiguraDe } from "@/components/ui/Figura";
import { isAvatarKey } from "@/lib/shared/avatars";
import { AvatarPicker } from "@/components/ui/AvatarPicker";
import { SelectorTema } from "@/components/ui/SelectorTema";
import { PanelFoto, SelectorModoPerfil, type ModoPerfil } from "@/components/shell/FotoPerfilEditor";
import { Avatar } from "@/components/ui/Primitives";
import { Button } from "@/components/ui/Button";
import { Sheet, useConfirm } from "@/components/ui/Overlay";
import { Field, Select } from "@/components/ui/Field";
import { FormCambiarPassword } from "@/components/session/CambiarPassword";
import { Key, SignOut } from "@phosphor-icons/react";
import { API_BASE_URL, sendJsonAuth } from "@/lib/client/api";
import { fmtDate } from "@/lib/client/format";
import { invalidate } from "@/lib/client/store";
import { useAutorizaciones } from "@/lib/client/useAutorizaciones";
import { ListaAutorizaciones } from "@/components/features/admin/AutorizacionesPanel";

/*
 * "Mi cuenta": quien soy (nombre, correo, roles vigentes) y mi avatar. La persona elige
 * uno del catalogo; el cambio queda en la bitacora como edicion de su usuario.
 * Fase 2: cargo predeterminado (con el que actua cuando varios roles permiten
 * una accion, sin preguntar), cambio de contrasena y cerrar la sesion en todos
 * los dispositivos.
 */
/* Fase 5: abre "Mi cuenta" desde cualquier parte (p. ej. el aviso de autorizaciones por vencer). */
export const ABRIR_MIS_AUTORIZACIONES = "#mis-autorizaciones";
export const EVENTO_ABRIR_CUENTA = "ficotox:abrir-cuenta";

export function AccountSheet({ open, onClose, abrirClave = false }: { open: boolean; onClose: () => void; /* Abre ya el formulario de cambio de contraseña (desde la búsqueda). */ abrirClave?: boolean }) {
  const { user, token, refreshMe, roles, logoutAll, authConfig } = useSession();
  const confirm = useConfirm();
  const [cargo, setCargo] = useState<string>(user?.cargo_predeterminado ? String(user.cargo_predeterminado) : "");
  const [savingCargo, setSavingCargo] = useState(false);
  const [cambiarClave, setCambiarClave] = useState(abrirClave);
  const { items: autorizaciones } = useAutorizaciones();

  // Si se abrio desde un enlace a #mis-autorizaciones, se lleva la vista a esa seccion.
  useEffect(() => {
    if (!open || typeof window === "undefined" || window.location.hash !== ABRIR_MIS_AUTORIZACIONES) return;
    const timer = window.setTimeout(() => {
      document.getElementById("mis-autorizaciones")?.scrollIntoView({ behavior: "smooth", block: "start" });
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [open]);

  const guardarCargo = async (valor: string) => {
    setCargo(valor);
    setSavingCargo(true);
    try {
      await sendJsonAuth("PUT", `${API_BASE_URL}/auth/me/cargo`, token, { rol_id: valor ? Number(valor) : null });
      await refreshMe();
      toast.success(valor ? "Cargo predeterminado guardado" : "Se te preguntará el cargo cada vez");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar el cargo");
    } finally {
      setSavingCargo(false);
    }
  };

  const cerrarTodas = async () => {
    const ok = await confirm({ title: "Cerrar sesión en todos los dispositivos", description: "Se cerrarán todas tus sesiones abiertas, incluida esta. Tendrás que volver a entrar.", confirmLabel: "Cerrar todas", tone: "danger" });
    if (!ok) return;
    try {
      await logoutAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudieron cerrar las sesiones");
    }
  };
  const seed = (user?.email || user?.nombre || "?").trim().toLowerCase();
  // Sin figura elegida: la misma figura por omision que ven los demas (distinta a la de otras personas).
  const porDefecto = useFiguraDe(null, seed);
  const current = resolveAvatarKey(isAvatarKey(user?.avatar) ? user?.avatar : porDefecto, seed);
  // null = sin cambio: muestra la figura actual (la elegida o la que le toca por omision).
  const [elegida, setChoice] = useState<string | null>(null);
  const choice = elegida ?? current;
  const [saving, setSaving] = useState(false);
  const dirty = choice !== current;

  // Figura o foto: cambiar de una a otra no pierde la otra (la foto queda guardada hasta quitarla).
  const [modoLocal, setModoLocal] = useState<ModoPerfil | null>(null);
  const modo: ModoPerfil = modoLocal ?? (user?.usa_foto ? "foto" : "figura");
  const alCambiarFoto = async () => {
    await refreshMe();
    invalidate("cuentas-activas", "usuarios");
  };
  const cambiarModo = async (m: ModoPerfil) => {
    setModoLocal(m);
    const usa = m === "foto";
    // Sin foto guardada, "Foto" solo muestra la zona para subirla.
    if (!user?.foto || usa === !!user?.usa_foto) return;
    try {
      await sendJsonAuth("PUT", `${API_BASE_URL}/auth/me/foto`, token, { usa_foto: usa });
      await alCambiarFoto();
      toast.success(usa ? "Se muestra tu foto" : "Se muestra tu figura");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo cambiar");
    }
  };
  const fotoVisible = modo === "foto" && !!user?.foto;

  const save = async () => {
    setSaving(true);
    try {
      await sendJsonAuth("PUT", `${API_BASE_URL}/auth/me/avatar`, token, { avatar: choice });
      await refreshMe();
      invalidate("usuarios", "cuentas-activas");
      toast.success("Figura actualizada");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar el avatar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(value) => !value && onClose()}
      title="Mi cuenta"
      description="Tus datos de acceso y la figura o foto con la que te ven en el sistema."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
          {modo === "figura" ? (
            <Button onClick={save} loading={saving} disabled={!dirty}>
              Guardar figura
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-4 rounded-[14px] bg-surface-2 p-4 ring-1 ring-line">
          {fotoVisible ? <Avatar id={user?.id} name={user?.nombre} email={user?.email} avatar={user?.avatar} size="xl" className="shadow-raised" /> : <AvatarArt avatar={choice} seed={seed} size={72} animado="siempre" className="rounded-full shadow-raised" />}
          <div className="flex min-w-0 flex-col">
            <p className="truncate text-[16px] font-semibold text-ink">{user?.nombre || user?.email}</p>
            <p className="truncate text-[13px] text-ink-3">{user?.email}</p>
            {roles.length ? (
              <ul className="mt-1 flex flex-col gap-0.5 text-[12.5px] text-ink-2" aria-label="Roles vigentes">
                {roles.map((rol) => (
                  <li key={rol.id}>
                    {rol.nombre}
                    {rol.vigente_hasta ? <span className="text-ink-3"> · hasta {fmtDate(rol.vigente_hasta)}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[12.5px] text-warning-text">Sin roles vigentes</p>
            )}
            <p className="mt-1 text-[12px] text-ink-3">{fotoVisible ? "Tu foto" : AVATARS[resolveAvatarKey(choice, seed)].label}</p>
          </div>
        </div>
        {user?.tipo_cuenta === "temporal" ? (
          <p className="rounded-[10px] bg-surface-2 px-3 py-2 text-[12.5px] text-ink-2 ring-1 ring-line">
            Cuenta temporal{user.vigente_hasta ? ` vigente hasta el ${fmtDate(user.vigente_hasta)}` : ""}. Lo que capturas queda pendiente del visto bueno de tu supervisor.
          </p>
        ) : null}
        {roles.length > 1 ? (
          <section className="flex flex-col gap-2">
            <div>
              <h3 className="title-3 text-ink">Cargo predeterminado</h3>
              <p className="text-[13px] text-ink-3">Con qué cargo actúas cuando varios de tus roles permiten la misma acción. Si ese cargo no la permite, se te preguntará.</p>
            </div>
            <Field label="Actuar como" htmlFor="cuenta-cargo">
              <Select id="cuenta-cargo" value={cargo} disabled={savingCargo} onChange={(event) => void guardarCargo(event.target.value)}>
                <option value="">Preguntar cada vez</option>
                {roles.map((rol) => (
                  <option key={rol.id} value={String(rol.id)}>
                    {rol.nombre}
                  </option>
                ))}
              </Select>
            </Field>
          </section>
        ) : null}
        <section className="flex flex-col gap-2" id="mis-autorizaciones">
          <div>
            <h3 className="title-3 text-ink">Mis autorizaciones</h3>
            <p className="text-[13px] text-ink-3">Métodos, equipos y actividades para los que estás autorizada o autorizado en el formato FX-THF-AP. Las registra la coordinación.</p>
          </div>
          {autorizaciones ? <ListaAutorizaciones items={autorizaciones} /> : <p className="text-[13px] text-ink-3">Cargando…</p>}
        </section>
        <section className="flex flex-col gap-2">
          <div>
            <h3 className="title-3 text-ink">Seguridad</h3>
            <p className="text-[13px] text-ink-3">
              Tu sesión se cierra tras {authConfig.sesion?.inactividad_min ?? 30} minutos sin actividad y, en todo caso, a las {authConfig.sesion?.expira_horas ?? 8} horas.
            </p>
          </div>
          {cambiarClave ? (
            <FormCambiarPassword onDone={() => setCambiarClave(false)} />
          ) : (
            <Button variant="secondary" icon={<Key size={16} />} onClick={() => setCambiarClave(true)}>
              Cambiar contraseña
            </Button>
          )}
          <Button variant="secondary" icon={<SignOut size={16} />} onClick={cerrarTodas}>
            Cerrar sesión en todos los dispositivos
          </Button>
        </section>
        <section className="flex flex-col gap-3">
          <div>
            <h3 className="title-3 text-ink">Apariencia</h3>
            <p className="text-[13px] text-ink-3">Claro, oscuro o automático (como tu sistema). Te sigue en cualquier computadora.</p>
          </div>
          <SelectorTema />
        </section>
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="title-3 text-ink">Foto de perfil</h3>
              <p className="text-[13px] text-ink-3">{modo === "foto" ? "Una foto tuya, recortada en círculo." : "Criaturas y objetos del laboratorio. Si no eliges, el sistema te asigna uno a partir de tu correo."}</p>
            </div>
            <SelectorModoPerfil modo={modo} onModo={cambiarModo} />
          </div>
          <div key={modo} className="animate-rise-in motion-reduce:animate-none">
            {modo === "foto" ? <PanelFoto onCambio={alCambiarFoto} /> : <AvatarPicker value={choice} seed={seed} onChange={setChoice} />}
          </div>
        </section>
        <p className="text-[12px] text-ink-3">Nombre, correo y roles los administra quien tiene la administración de usuarios (Administración › Usuarios).</p>
      </div>
    </Sheet>
  );
}
