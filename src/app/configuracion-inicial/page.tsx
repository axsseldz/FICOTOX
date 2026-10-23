"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AppleLogo, ArrowLeft, ArrowRight, CheckCircle, ClockCounterClockwise, Copy, Eye, EyeSlash, FileArrowUp, Key, Sparkle, WindowsLogo } from "@phosphor-icons/react";
import { limiteTexto } from "@/components/features/respaldos/comun";
import { PantallaAcceso, TarjetaAcceso } from "@/components/session/PantallaAcceso";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Checkbox, Field, Input } from "@/components/ui/Field";
import { LineaEtapas } from "@/components/ui/LineaEtapas";
import { Kbd } from "@/components/ui/Primitives";
import { cn } from "@/components/ui/cn";
import { API_BASE_URL, ApiError } from "@/lib/client/api";
import { useEsMac } from "@/lib/client/atajos";
import { subirPorPartes } from "@/lib/client/subida-partes";
import type { ApiRecord } from "@/lib/client/types";

/*
 * Configuracion inicial: aparece en lugar del acceso mientras la base no tiene
 * ninguna cuenta (instalacion nueva). Pasos: codigo de instalacion (del .env)
 * → camino (desde cero o desde un respaldo) → datos → listo. El servidor
 * decide todo (src/lib/server/modules/instalacion.ts); en cuanto hay cuentas,
 * /api/instalacion responde 404 y esta pantalla manda al acceso.
 */

const URL_BASE = `${API_BASE_URL}/instalacion`;
type Paso = "cargando" | "sin-codigo" | "codigo" | "camino" | "cero" | "cuentas" | "restaurar" | "restaurando" | "restaurada";
const ETAPAS = ["Código", "Camino", "Datos", "Listo"];
const ETAPA_DE: Record<Paso, number> = { cargando: 0, "sin-codigo": 0, codigo: 0, camino: 1, cero: 2, restaurar: 2, restaurando: 2, cuentas: 3, restaurada: 3 };

async function pedir(metodo: "GET" | "POST", ruta: string, cuerpo?: unknown): Promise<{ status: number; datos: ApiRecord }> {
  const r = await fetch(`${URL_BASE}${ruta}`, { method: metodo, headers: cuerpo ? { "Content-Type": "application/json" } : undefined, body: cuerpo ? JSON.stringify(cuerpo) : undefined, cache: "no-store" });
  return { status: r.status, datos: ((await r.json().catch(() => ({}))) || {}) as ApiRecord };
}

const errorDe = (r: { status: number; datos: ApiRecord }, porOmision: string) => new ApiError(r.status, r.datos, porOmision);
const tamanoLegible = (bytes: number) => (bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GB` : bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export default function ConfiguracionInicialPage() {
  const router = useRouter();
  const [paso, setPaso] = useState<Paso>("cargando");
  const [estado, setEstado] = useState<ApiRecord>({});
  const [codigo, setCodigo] = useState("");
  const [cuentas, setCuentas] = useState<ApiRecord[]>([]);
  const [trabajo, setTrabajo] = useState<ApiRecord | null>(null);
  const [fallo, setFallo] = useState<ApiRecord | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await pedir("GET", "");
      if (r.status === 404) {
        router.replace("/login");
        return;
      }
      if (r.status !== 200) throw errorDe(r, "No se pudo consultar la instalación");
      setEstado(r.datos);
      const t = r.datos.trabajo as ApiRecord | null;
      if (t?.estado === "en_curso") {
        setTrabajo(t);
        setPaso("restaurando");
      } else setPaso(r.datos.codigo_valido ? "codigo" : "sin-codigo");
    } catch {
      setPaso("sin-codigo");
    }
  }, [router]);

  useEffect(() => {
    void Promise.resolve().then(cargar);
  }, [cargar]);

  const titulo: Record<Paso, string> = {
    cargando: "Configuración inicial",
    "sin-codigo": "Falta el código de instalación",
    codigo: "Configuración inicial",
    camino: "¿Cómo quieres empezar?",
    cero: "Empezar desde cero",
    cuentas: "Cuentas creadas",
    restaurar: "Restaurar desde un respaldo",
    restaurando: "Restaurando la plataforma",
    restaurada: "Plataforma restaurada",
  };

  return (
    <PantallaAcceso>
      <TarjetaAcceso className="max-w-[560px]">
        <div className="flex flex-col gap-5" data-instalacion={paso}>
          <div className="flex flex-col gap-1">
            <p className="eyebrow">Instalación nueva</p>
            <h1 className="text-3xl font-bold tracking-tight text-ink">{titulo[paso]}</h1>
          </div>
          {paso !== "sin-codigo" && paso !== "cargando" ? <LineaEtapas etapas={ETAPAS} actual={ETAPA_DE[paso] + (paso === "cuentas" || paso === "restaurada" ? 1 : 0)} etiqueta="Pasos de la configuración" /> : null}
          {paso === "cargando" ? <p className="text-base text-ink-3">Consultando la instalación…</p> : null}
          {paso === "sin-codigo" ? <SinCodigo estado={estado} onReintentar={cargar} /> : null}
          {paso === "codigo" ? (
            <PasoCodigo
              bloqueadaHasta={estado.bloqueada_hasta ? String(estado.bloqueada_hasta) : null}
              onListo={(c) => {
                setCodigo(c);
                setPaso("camino");
              }}
            />
          ) : null}
          {paso === "camino" ? <PasoCamino motor={String(estado.motor || "sqlite")} onElegir={(p) => setPaso(p)} /> : null}
          {paso === "cero" ? (
            <PasoCero
              codigo={codigo}
              onVolver={() => setPaso("camino")}
              onListo={(c) => {
                setCuentas(c);
                setPaso("cuentas");
              }}
            />
          ) : null}
          {paso === "cuentas" ? <PasoCuentas cuentas={cuentas} /> : null}
          {paso === "restaurar" ? (
            <PasoRestaurar
              codigo={codigo}
              estado={estado}
              fallo={fallo}
              onVolver={() => setPaso("camino")}
              onIniciado={(t) => {
                setFallo(null);
                setTrabajo(t);
                setPaso("restaurando");
              }}
            />
          ) : null}
          {paso === "restaurando" ? (
            <PasoRestaurando
              trabajo={trabajo}
              onTrabajo={setTrabajo}
              onTerminado={() => setPaso("restaurada")}
              onFallido={(t) => {
                setFallo(t);
                setPaso(codigo ? "restaurar" : "codigo");
              }}
            />
          ) : null}
          {paso === "restaurada" ? <PasoRestaurada /> : null}
        </div>
      </TarjetaAcceso>
    </PantallaAcceso>
  );
}

/* ---------- Sin codigo en el .env: como definirlo, en Mac y en Windows ---------- */

function PestanasSistema({ children }: { children: (sistema: "mac" | "windows") => ReactNode }) {
  const mac = useEsMac();
  const [elegido, setElegido] = useState<"mac" | "windows" | null>(null);
  const sistema = elegido ?? (mac ? "mac" : "windows");
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Sistema operativo" className="inline-flex w-fit gap-1 rounded-field bg-surface-2 p-1 ring-1 ring-line">
        {(["mac", "windows"] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={sistema === s} onClick={() => setElegido(s)} className={cn("press inline-flex h-8 items-center gap-1.5 rounded-control px-3 text-sm font-medium", sistema === s ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink")} data-sistema={s}>
            {s === "mac" ? <AppleLogo size={15} weight="fill" aria-hidden="true" /> : <WindowsLogo size={15} weight="fill" aria-hidden="true" />}
            {s === "mac" ? "Mac" : "Windows"}
          </button>
        ))}
      </div>
      <div role="tabpanel">{children(sistema)}</div>
    </div>
  );
}

const Comando = ({ children }: { children: ReactNode }) => <code className="block rounded-sm bg-surface-2 px-2.5 py-1.5 font-mono text-xs break-all whitespace-pre-wrap text-ink ring-1 ring-line">{children}</code>;

function SinCodigo({ estado, onReintentar }: { estado: ApiRecord; onReintentar: () => void }) {
  const corto = !!estado.codigo_configurado && !estado.codigo_valido;
  const [revisando, setRevisando] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-ink-2">Para proteger una instalación nueva, la configuración pide un código que solo conoce quien tiene acceso a esta computadora. Se define una vez en el archivo <code className="font-mono text-sm">.env</code> de la carpeta de FICOTOX.</p>
      {corto ? <Callout tone="warning">El código del .env es demasiado corto: debe tener al menos {Number(estado.codigo_min || 12)} caracteres.</Callout> : null}
      <PestanasSistema>
        {(sistema) => (
          <ol className="flex list-decimal flex-col gap-2.5 pl-5 text-sm leading-normal text-ink-2" data-pasos-sistema={sistema}>
            {sistema === "mac" ? (
              <>
                <li>
                  Abre <strong>Terminal</strong> en la carpeta de FICOTOX (en Finder: clic derecho sobre la carpeta › Servicios › Nuevo Terminal en la carpeta).
                </li>
                <li>
                  La forma más sencilla es dejar que FICOTOX lo genere:
                  <Comando>npm run configurar</Comando>
                  Escribe el código que aparece en «FICOTOX_CODIGO_INSTALACION». O agrégalo tú: abre el archivo con <Comando>open -e .env</Comando> y añade una línea como <Comando>FICOTOX_CODIGO_INSTALACION=un-codigo-de-12-o-mas</Comando>
                </li>
                <li>
                  Guarda (<Kbd>⌘</Kbd> <Kbd>S</Kbd>) y reinicia FICOTOX: <Comando>npm run reiniciar</Comando> (o, si lo arrancaste a mano, detenlo con <Kbd>⌃</Kbd> <Kbd>C</Kbd> y vuelve a arrancarlo).
                </li>
              </>
            ) : (
              <>
                <li>
                  Abre <strong>PowerShell</strong> en la carpeta de FICOTOX (en el Explorador de archivos: escribe <code className="font-mono">powershell</code> en la barra de direcciones y pulsa <Kbd>Enter</Kbd>).
                </li>
                <li>
                  La forma más sencilla es dejar que FICOTOX lo genere:
                  <Comando>npm run configurar</Comando>
                  Escribe el código que aparece en «FICOTOX_CODIGO_INSTALACION». O agrégalo tú: abre el archivo con <Comando>notepad .env</Comando> y añade una línea como <Comando>FICOTOX_CODIGO_INSTALACION=un-codigo-de-12-o-mas</Comando>
                </li>
                <li>
                  Guarda (<Kbd>Ctrl</Kbd> <Kbd>S</Kbd>, codificación UTF-8) y reinicia FICOTOX: <Comando>npm run reiniciar</Comando> (si corre como servicio de Windows, reinícialo desde el Programador de tareas).
                </li>
              </>
            )}
            <li>Vuelve aquí y pulsa «Ya lo definí».</li>
          </ol>
        )}
      </PestanasSistema>
      <Button
        size="lg"
        loading={revisando}
        onClick={async () => {
          setRevisando(true);
          await onReintentar();
          setRevisando(false);
        }}
        iconRight={<ArrowRight size={16} weight="bold" aria-hidden="true" />}
      >
        Ya lo definí
      </Button>
    </div>
  );
}

/* ---------- 1. Codigo ---------- */

function CampoSecreto({ id, valor, onCambio, error, autoFocus, autoComplete = "off", placeholder }: { id: string; valor: string; onCambio: (v: string) => void; error?: string | null; autoFocus?: boolean; autoComplete?: string; placeholder?: string }) {
  const [ver, setVer] = useState(false);
  return (
    <Input
      id={id}
      type={ver ? "text" : "password"}
      value={valor}
      onChange={(e) => onCambio(e.target.value)}
      invalid={!!error}
      autoFocus={autoFocus}
      autoComplete={autoComplete}
      spellCheck={false}
      placeholder={placeholder}
      trailing={
        <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? "Ocultar" : "Mostrar"} aria-pressed={ver} className="press rounded-full p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink">
          {ver ? <EyeSlash size={17} /> : <Eye size={17} />}
        </button>
      }
    />
  );
}

function PasoCodigo({ bloqueadaHasta, onListo }: { bloqueadaHasta: string | null; onListo: (codigo: string) => void }) {
  const [valor, setValor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [bloqueo, setBloqueo] = useState<string | null>(bloqueadaHasta ? "Demasiados intentos con un código incorrecto. Espera unos minutos y vuelve a intentarlo." : null);
  const [enviando, setEnviando] = useState(false);
  const enviar = async (event: FormEvent) => {
    event.preventDefault();
    if (!valor.trim()) {
      setError("Escribe el código de instalación");
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const r = await pedir("POST", "/codigo", { codigo: valor.trim() });
      if (r.status === 200) return onListo(valor.trim());
      if (r.status === 429) setBloqueo(String(r.datos.message || ""));
      else if (r.status === 404) window.location.replace("/login");
      else setError(String(r.datos.message || "No se pudo comprobar el código"));
    } catch {
      setError("No se pudo conectar con el servidor");
    } finally {
      setEnviando(false);
    }
  };
  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      <p className="text-base text-ink-2">Esta computadora todavía no tiene cuentas. Escribe el código de instalación que está en el archivo <code className="font-mono text-sm">.env</code> (FICOTOX_CODIGO_INSTALACION).</p>
      {bloqueo ? <Callout tone="danger">{bloqueo}</Callout> : null}
      <Field label="Código de instalación" htmlFor="instalacion-codigo" error={error}>
        <CampoSecreto id="instalacion-codigo" valor={valor} onCambio={setValor} error={error} autoFocus placeholder="XXXX-XXXX-XXXX-XXXX" />
      </Field>
      <Button type="submit" size="lg" loading={enviando} iconRight={<ArrowRight size={16} weight="bold" aria-hidden="true" />}>
        Continuar
      </Button>
    </form>
  );
}

/* ---------- 2. Camino ---------- */

function Opcion({ icono, titulo, texto, onClick, disabled, nota, dato }: { icono: ReactNode; titulo: string; texto: string; onClick: () => void; disabled?: boolean; nota?: string; dato: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} data-camino={dato} className="press group flex w-full items-start gap-4 rounded-card bg-surface p-4 text-left shadow-card ring-1 ring-line hover:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-60">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-box bg-brand-soft text-brand-strong" aria-hidden="true">
        {icono}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-md font-semibold text-ink">{titulo}</span>
        <span className="text-sm text-ink-3">{texto}</span>
        {nota ? <span className="text-xs text-warning-text">{nota}</span> : null}
      </span>
      <ArrowRight size={18} className="mt-3 shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5 group-hover:text-brand motion-reduce:transition-none" aria-hidden="true" />
    </button>
  );
}

function PasoCamino({ motor, onElegir }: { motor: string; onElegir: (p: "cero" | "restaurar") => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Opcion dato="restaurar" icono={<ClockCounterClockwise size={22} weight="duotone" />} titulo="Restaurar desde un respaldo" texto="Recupera toda la plataforma (cuentas, registros, archivos y bitácora) desde el archivo .ficotox que se descargó en Calidad › Respaldos." onClick={() => onElegir("restaurar")} disabled={motor !== "sqlite"} nota={motor !== "sqlite" ? "Con MySQL/MariaDB la base se recupera con mysqldump (ver la guía de instalación)." : undefined} />
      <Opcion dato="cero" icono={<Sparkle size={22} weight="duotone" />} titulo="Empezar desde cero" texto="Una plataforma vacía: se crean las cuentas del Administrador técnico y de la Responsable General, con contraseña temporal." onClick={() => onElegir("cero")} />
      <details className="group mt-1 rounded-box bg-surface-2 px-4 py-3 text-sm text-ink-2">
        <summary className="cursor-pointer font-medium text-ink">¿Vienes de otra computadora?</summary>
        <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 leading-normal">
          <li>En la computadora anterior (si todavía enciende): Calidad › Respaldos › ⋯ › «Descargar», con una contraseña de cifrado.</li>
          <li>Copia el archivo .ficotox a esta computadora (USB, unidad de red) y ten a la mano su contraseña.</li>
          <li>Elige «Restaurar desde un respaldo». Esta instalación adopta la llave de la bitácora del respaldo.</li>
        </ol>
      </details>
    </div>
  );
}

/* ---------- 3a. Desde cero ---------- */

function PasoCero({ codigo, onVolver, onListo }: { codigo: string; onVolver: () => void; onListo: (cuentas: ApiRecord[]) => void }) {
  const [datos, setDatos] = useState({ admNombre: "", admEmail: "", resNombre: "", resEmail: "" });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const cambiar = (campo: keyof typeof datos) => (v: string) => setDatos((d) => ({ ...d, [campo]: v }));
  const enviar = async (event: FormEvent) => {
    event.preventDefault();
    const e: Record<string, string> = {};
    if (datos.admNombre.trim().length < 3) e["administrador-nombre"] = "Escribe el nombre completo";
    if (!datos.admEmail.includes("@")) e["administrador-email"] = "Escribe un correo válido";
    if (datos.resNombre.trim().length < 3) e["responsable-nombre"] = "Escribe el nombre completo";
    if (!datos.resEmail.includes("@")) e["responsable-email"] = "Escribe un correo válido";
    setErrores(e);
    setGeneral(null);
    if (Object.keys(e).length) return;
    setEnviando(true);
    try {
      const r = await pedir("POST", "/cero", { codigo, administrador: { nombre: datos.admNombre, email: datos.admEmail }, responsable: { nombre: datos.resNombre, email: datos.resEmail } });
      if (r.status === 201) return onListo((r.datos.cuentas || []) as ApiRecord[]);
      if (r.status === 404) return window.location.replace("/login");
      const campo = String(r.datos.campo || "");
      if (campo) setErrores({ [campo]: String(r.datos.message || "") });
      else setGeneral(String(r.datos.message || "No se pudieron crear las cuentas"));
    } catch {
      setGeneral("No se pudo conectar con el servidor");
    } finally {
      setEnviando(false);
    }
  };
  const persona = (titulo: string, desc: string, clave: "administrador" | "responsable", nombre: keyof typeof datos, email: keyof typeof datos) => (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2">
        <span className="block text-base font-semibold text-ink">{titulo}</span>
        <span className="block text-sm text-ink-3">{desc}</span>
      </legend>
      <Field label="Nombre completo" htmlFor={`${clave}-nombre`} error={errores[`${clave}-nombre`]}>
        <Input id={`${clave}-nombre`} autoComplete="off" value={datos[nombre]} onChange={(e) => cambiar(nombre)(e.target.value)} invalid={!!errores[`${clave}-nombre`]} />
      </Field>
      <Field label="Correo" htmlFor={`${clave}-email`} error={errores[`${clave}-email`]}>
        <Input id={`${clave}-email`} type="email" inputMode="email" autoComplete="off" placeholder="nombre@cicese.mx" value={datos[email]} onChange={(e) => cambiar(email)(e.target.value)} invalid={!!errores[`${clave}-email`]} />
      </Field>
    </fieldset>
  );
  return (
    <form onSubmit={enviar} className="flex flex-col gap-5" noValidate>
      <p className="text-base text-ink-2">Se crean dos cuentas: las altas de personal las aprueba la Responsable General, así que con una sola nadie podría aprobar la siguiente. Cada una entra con una contraseña temporal y la cambia al primer acceso.</p>
      {persona("Administrador técnico", "Configura la plataforma, usuarios y respaldos.", "administrador", "admNombre", "admEmail")}
      {persona("Responsable General", "Aprueba altas de personal y acciones críticas.", "responsable", "resNombre", "resEmail")}
      {general ? <Callout tone="danger">{general}</Callout> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={onVolver} icon={<ArrowLeft size={16} aria-hidden="true" />}>
          Volver
        </Button>
        <Button type="submit" size="lg" loading={enviando}>
          Crear las cuentas
        </Button>
      </div>
    </form>
  );
}

function PasoCuentas({ cuentas }: { cuentas: ApiRecord[] }) {
  const [guardadas, setGuardadas] = useState(false);
  const [copiada, setCopiada] = useState<string | null>(null);
  const copiar = async (texto: string, clave: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiada(clave);
      window.setTimeout(() => setCopiada((c) => (c === clave ? null : c)), 1800);
    } catch {
      /* sin portapapeles: se copia a mano */
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <Callout tone="warning" title="Las contraseñas temporales se muestran solo esta vez">
        Cópialas y entrégalas en persona. Al entrar, cada quien elige su propia contraseña.
      </Callout>
      <ul className="flex flex-col gap-3">
        {cuentas.map((c) => (
          <li key={String(c.email)} className="flex flex-col gap-2 rounded-box bg-surface-2 p-4 ring-1 ring-line" data-cuenta={String(c.email)}>
            <span className="text-xs text-ink-3">{String(c.rol)}</span>
            <span className="text-base font-semibold text-ink">{String(c.nombre)}</span>
            <span className="text-sm break-all text-ink-2">{String(c.email)}</span>
            <span className="flex items-center gap-2">
              <code className="min-w-0 flex-1 rounded-sm bg-surface px-2.5 py-1.5 font-mono text-sm break-all text-ink ring-1 ring-line" data-contrasena-temporal>
                {String(c.contrasena_temporal)}
              </code>
              <Button size="sm" variant="secondary" onClick={() => copiar(String(c.contrasena_temporal), String(c.email))} icon={copiada === c.email ? <CheckCircle size={15} weight="fill" aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}>
                {copiada === c.email ? "Copiada" : "Copiar"}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <Checkbox id="cuentas-guardadas" label="Ya guardé las dos contraseñas temporales" checked={guardadas} onChange={(e) => setGuardadas(e.target.checked)} />
      <Button size="lg" disabled={!guardadas} onClick={() => window.location.replace("/login")} iconRight={<ArrowRight size={16} weight="bold" aria-hidden="true" />}>
        Ir a iniciar sesión
      </Button>
    </div>
  );
}

/* ---------- 3b. Desde un respaldo ---------- */

function PasoRestaurar({ codigo, estado, fallo, onVolver, onIniciado }: { codigo: string; estado: ApiRecord; fallo: ApiRecord | null; onVolver: () => void; onIniciado: (trabajo: ApiRecord) => void }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [contrasena, setContrasena] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(fallo?.mensaje ? String(fallo.mensaje) : null);
  const [subida, setSubida] = useState<{ id: string; archivo: File } | null>(null);
  const [avance, setAvance] = useState<number | null>(null);
  const [enviando, setEnviando] = useState(false);
  const entrada = useRef<HTMLInputElement | null>(null);
  const limiteMb = Number(estado.limite_mb || 4096);

  const enviar = async (event: FormEvent) => {
    event.preventDefault();
    const e: Record<string, string> = {};
    if (!archivo) e.archivo = "Elige el archivo .ficotox del respaldo";
    else if (archivo.size > limiteMb * 1048576) e.archivo = `El archivo pesa ${tamanoLegible(archivo.size)} y el límite es de ${limiteTexto(limiteMb)}`;
    if (!contrasena) e.contrasena = "Escribe la contraseña de cifrado del archivo";
    setErrores(e);
    setGeneral(null);
    if (Object.keys(e).length || !archivo) return;
    setEnviando(true);
    try {
      // Si la contraseña estaba mal, el archivo ya subido se reutiliza.
      let id = subida && subida.archivo === archivo ? subida.id : null;
      if (!id) {
        setAvance(0);
        const r = await pedir("POST", "/subidas", { codigo, tamano: archivo.size, nombre: archivo.name });
        if (r.status !== 201) throw errorDe(r, "No se pudo empezar a subir el archivo");
        id = String(r.datos.id);
        await subirPorPartes({ url: `${URL_BASE}/subidas`, id, trozo: Number(r.datos.trozo), archivo, encabezados: { "X-Codigo-Instalacion": codigo }, alAvance: setAvance });
        setSubida({ id, archivo });
      }
      const r = await pedir("POST", "/restaurar", { codigo, subida: id, contrasena });
      if (r.status === 202) {
        setSubida(null);
        return onIniciado((r.datos.trabajo || {}) as ApiRecord);
      }
      throw errorDe(r, "No se pudo restaurar el respaldo");
    } catch (error) {
      const err = error instanceof ApiError ? error : null;
      if (err?.status === 404 && err.codigo !== "subida_no_existe") return window.location.replace("/login");
      if (err && err.codigo !== "contrasena_incorrecta") setSubida(null);
      const campo = String(err?.data.campo || "");
      const mensaje = error instanceof Error ? error.message : "No se pudo restaurar el respaldo";
      if (campo === "contrasena" || campo === "archivo") setErrores({ [campo]: mensaje });
      else setGeneral(mensaje);
    } finally {
      setEnviando(false);
      setAvance(null);
    }
  };

  const pasosFallidos = ((fallo?.pasos || []) as ApiRecord[]).filter((p) => !p.ok);
  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      <p className="text-base text-ink-2">Elige el archivo .ficotox y escribe la contraseña con la que se descargó. Primero se comprueba todo; si algo falla, no se toca nada y te decimos por qué.</p>
      {general ? (
        <Callout tone="danger" title="No se restauró">
          {general}
          {pasosFallidos.length ? (
            <ul className="mt-1.5 list-disc pl-4">
              {pasosFallidos.map((p) => (
                <li key={String(p.n)}>{String(p.titulo)}</li>
              ))}
            </ul>
          ) : null}
        </Callout>
      ) : null}
      <Field label="Archivo del respaldo" htmlFor="instalacion-archivo" error={errores.archivo} hint={`Archivo .ficotox, hasta ${limiteTexto(limiteMb)}.`}>
        <div className={cn("flex items-center gap-3 rounded-field bg-surface-2 p-3 ring-1", errores.archivo ? "ring-danger" : "ring-line")}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-box bg-brand-soft text-brand-strong" aria-hidden="true">
            <FileArrowUp size={20} weight="duotone" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium text-ink">{archivo ? archivo.name : "Ningún archivo elegido"}</span>
            <span className="text-xs text-ink-3">{archivo ? tamanoLegible(archivo.size) : "ficotox-respaldo-….ficotox"}</span>
          </span>
          <Button size="sm" variant="secondary" onClick={() => entrada.current?.click()}>
            {archivo ? "Cambiar" : "Elegir"}
          </Button>
          <input
            ref={entrada}
            id="instalacion-archivo"
            type="file"
            accept=".ficotox,application/octet-stream"
            className="sr-only"
            onChange={(e) => {
              setArchivo(e.target.files?.[0] || null);
              setErrores((x) => ({ ...x, archivo: "" }));
            }}
          />
        </div>
      </Field>
      <Field label="Contraseña de cifrado" htmlFor="instalacion-contrasena" error={errores.contrasena}>
        <CampoSecreto id="instalacion-contrasena" valor={contrasena} onCambio={setContrasena} error={errores.contrasena} autoComplete="off" />
      </Field>
      <Callout tone="info" icon={<Key size={18} weight="duotone" />}>
        Esta instalación adoptará la llave de la bitácora que viene en el respaldo, para que el registro de actividad siga verificándose. Guarda una copia de esa llave fuera de esta computadora.
      </Callout>
      {avance !== null ? <BarraAvance fraccion={avance} texto={`Subiendo el archivo… ${Math.round(avance * 100)} %`} /> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={onVolver} disabled={enviando} icon={<ArrowLeft size={16} aria-hidden="true" />}>
          Volver
        </Button>
        <Button type="submit" size="lg" loading={enviando}>
          Restaurar
        </Button>
      </div>
    </form>
  );
}

function BarraAvance({ fraccion, texto }: { fraccion: number | null; texto: string }) {
  return (
    <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
      <span className="text-sm text-ink-2">{texto}</span>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fraccion === null ? undefined : Math.round(fraccion * 100)} aria-label={texto}>
        {fraccion === null ? <div className="h-full w-1/3 animate-pulse rounded-full bg-brand motion-reduce:animate-none" /> : <div className="h-full origin-left rounded-full bg-brand transition-transform duration-300 motion-reduce:transition-none" style={{ transform: `scaleX(${Math.max(0.02, fraccion)})` }} />}
      </div>
    </div>
  );
}

const VERIFICACIONES = 8;

function PasoRestaurando({ trabajo, onTrabajo, onTerminado, onFallido }: { trabajo: ApiRecord | null; onTrabajo: (t: ApiRecord) => void; onTerminado: () => void; onFallido: (t: ApiRecord) => void }) {
  // Las funciones cambian en cada pintado: se leen de una referencia para no reiniciar la consulta.
  const avisos = useRef({ onTrabajo, onTerminado, onFallido });
  useEffect(() => {
    avisos.current = { onTrabajo, onTerminado, onFallido };
  });
  useEffect(() => {
    let vivo = true;
    const consultar = async () => {
      try {
        const r = await pedir("GET", "");
        if (!vivo) return;
        // Ya hay cuentas: la configuracion termino (las rutas responden 404 para siempre).
        if (r.status === 404) return avisos.current.onTerminado();
        const t = r.datos.trabajo as ApiRecord | null;
        if (t) avisos.current.onTrabajo(t);
        if (t?.estado === "fallido") return avisos.current.onFallido(t);
        if (t?.estado === "terminado") return avisos.current.onTerminado();
      } catch {
        /* el servidor esta ocupado: se vuelve a consultar */
      }
      if (vivo) window.setTimeout(consultar, 1000);
    };
    const t = window.setTimeout(consultar, 800);
    return () => {
      vivo = false;
      window.clearTimeout(t);
    };
  }, []);
  const pasos = ((trabajo?.pasos || []) as ApiRecord[]);
  const descifrando = /descifr/i.test(String(trabajo?.fase || ""));
  const etapa = descifrando ? 0 : pasos.length < VERIFICACIONES ? 1 : 2;
  return (
    <div className="flex flex-col gap-4" data-restaurando>
      <p className="text-base text-ink-2">No cierres esta ventana. Puede tardar unos minutos según el tamaño del respaldo.</p>
      <LineaEtapas variante="vertical" actual={etapa} etiqueta="Avance de la restauración" etapas={[
        { clave: "descifrar", titulo: "Descifrar el archivo", detalle: etapa === 0 ? <BarraAvance fraccion={typeof trabajo?.progreso === "number" ? Number(trabajo.progreso) : null} texto={typeof trabajo?.progreso === "number" ? `${Math.round(Number(trabajo.progreso) * 100)} %` : "Comprobando la contraseña…"} /> : null },
        {
          clave: "verificar",
          titulo: `Verificar el respaldo (${Math.min(pasos.length, VERIFICACIONES)} de ${VERIFICACIONES})`,
          detalle: pasos.length ? (
            <ul className="flex flex-col gap-0.5 text-sm text-ink-2">
              {pasos.map((p) => (
                <li key={String(p.n)} className="flex items-center gap-2">
                  <span aria-hidden="true" className={p.ok ? "text-success-text" : "text-danger"}>{p.ok ? "✓" : "✗"}</span>
                  {String(p.titulo)}
                </li>
              ))}
            </ul>
          ) : null,
        },
        { clave: "reemplazar", titulo: "Recuperar la información y adoptar la llave", detalle: etapa === 2 ? <BarraAvance fraccion={null} texto={String(trabajo?.fase || "Recuperando…")} /> : null },
      ]} />
    </div>
  );
}

function PasoRestaurada() {
  return (
    <div className="flex flex-col gap-4">
      <Callout tone="success" title="La plataforma se recuperó desde el respaldo">
        Pasó las 8 verificaciones, se adoptó la llave de la bitácora y todo quedó en el registro de actividad. Inicia sesión con tu cuenta de siempre.
      </Callout>
      <Button size="lg" onClick={() => window.location.replace("/login")} iconRight={<ArrowRight size={16} weight="bold" aria-hidden="true" />}>
        Ir a iniciar sesión
      </Button>
    </div>
  );
}
