"use client";

import { useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Camera, MagnifyingGlassMinus, MagnifyingGlassPlus, Smiley, Trash, UploadSimple } from "@phosphor-icons/react";
import { useSession } from "@/components/session/SessionProvider";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { urlFoto, useFotoUrl } from "@/components/ui/FotoPerfil";
import { Dialog } from "@/components/ui/Overlay";
import { useValidacion, ValidacionAmbito } from "@/components/ui/Validacion";
import { API_BASE_URL, sendJsonAuth } from "@/lib/client/api";
import { invalidate } from "@/lib/client/store";

/*
 * Foto de perfil en Mi cuenta: elegir entre la Figura de la app y una Foto
 * propia (cambiar de una a otra no pierde la otra). La foto se sube con boton
 * o arrastrando (JPG, PNG o WEBP; 5 MB) y se recorta en una ventana: vista
 * circular, zoom con deslizador, rueda o pellizco, arrastrar para encuadrar y
 * vista previa grande y pequeña. El navegador envia el recorte cuadrado y el
 * servidor lo vuelve a codificar (sin metadatos).
 */

const TIPOS = ["image/jpeg", "image/png", "image/webp"];
const MAX_MB = 5;
const VISTA = 280;
const SALIDA = 1024;

export type ModoPerfil = "figura" | "foto";

export function SelectorModoPerfil({ modo, onModo }: { modo: ModoPerfil; onModo: (m: ModoPerfil) => void }) {
  const opciones: Array<{ valor: ModoPerfil; label: string; icono: ReactNode }> = [
    { valor: "figura", label: "Figura", icono: <Smiley size={15} weight="duotone" /> },
    { valor: "foto", label: "Foto", icono: <Camera size={15} weight="duotone" /> },
  ];
  return (
    <div role="radiogroup" aria-label="Foto de perfil" className="inline-flex rounded-full bg-surface-3 p-1">
      {opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          role="radio"
          aria-checked={modo === o.valor}
          onClick={() => onModo(o.valor)}
          className={cn("press inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors", modo === o.valor ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink")}
        >
          {o.icono}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* Panel "Foto": la foto actual (cambiar o quitar) o la zona para subir una. */
export function PanelFoto({ onCambio }: { onCambio: () => Promise<void> }) {
  const { user, token } = useSession();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [sobre, setSobre] = useState(false);
  const [quitando, setQuitando] = useState(false);
  const entrada = useRef<HTMLInputElement | null>(null);
  const v = useValidacion({ titulo: "No se pudo usar la foto", reglas: () => [] });
  const actual = useFotoUrl(user?.id && user.foto ? urlFoto(user.id, user.foto, 512) : null);

  const elegir = (f: File | null | undefined) => {
    if (!f) return;
    if (!TIPOS.includes(f.type)) {
      v.avisar({ que: "Usa una foto JPG, PNG o WEBP", hacer: "Las fotos HEIC (iPhone) u otros formatos no se aceptan: expórtala como JPG." });
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      v.avisar({ que: `La foto pesa más de ${MAX_MB} MB`, hacer: "Elige una foto más ligera." });
      return;
    }
    setArchivo(f);
  };

  const soltar = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setSobre(false);
    elegir(e.dataTransfer.files?.[0]);
  };

  const quitar = async () => {
    setQuitando(true);
    try {
      await sendJsonAuth("DELETE", `${API_BASE_URL}/auth/me/foto`, token, {});
      await onCambio();
      toast.success("Foto de perfil quitada");
    } catch (err) {
      v.errorServidor(err);
    } finally {
      setQuitando(false);
    }
  };

  return (
    <ValidacionAmbito v={v}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setSobre(true);
        }}
        onDragLeave={() => setSobre(false)}
        onDrop={soltar}
        className={cn("flex flex-col items-center gap-3 rounded-card border-2 border-dashed px-4 py-5 text-center transition-colors duration-200", sobre ? "border-brand bg-brand-faint" : "border-line-strong bg-surface-2/60")}
      >
        {user?.foto && actual ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob: de la foto pedida con sesion
          <img src={actual} alt={String(user?.nombre || "Tu foto")} className="foto-perfil h-24 w-24 rounded-full object-cover shadow-raised" />
        ) : (
          <span aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-full bg-surface text-brand-strong shadow-card">
            <Camera size={28} weight="duotone" />
          </span>
        )}
        <p className="text-sm text-ink-2">{user?.foto ? "Arrastra otra foto aquí para cambiarla" : "Arrastra una foto aquí o súbela"}</p>
        <p className="text-xs text-ink-3">JPG, PNG o WEBP · hasta {MAX_MB} MB</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" icon={<UploadSimple size={14} />} onClick={() => entrada.current?.click()}>
            {user?.foto ? "Cambiar foto" : "Subir foto"}
          </Button>
          {user?.foto ? (
            <Button size="sm" variant="secondary" icon={<Trash size={14} />} loading={quitando} onClick={quitar}>
              Quitar foto
            </Button>
          ) : null}
        </div>
        <input
          ref={entrada}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          aria-label="Subir foto de perfil"
          onChange={(e) => {
            elegir(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {archivo ? <Recortador archivo={archivo} onCerrar={() => setArchivo(null)} onGuardado={onCambio} /> : null}
    </ValidacionAmbito>
  );
}

/* Ventana de recorte: circulo, zoom (deslizador, rueda o pellizco), arrastrar y vistas previas. */
function Recortador({ archivo, onCerrar, onGuardado }: { archivo: File; onCerrar: () => void; onGuardado: () => Promise<void> }) {
  const { token } = useSession();
  const [src] = useState(() => URL.createObjectURL(archivo));
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [guardando, setGuardando] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const punteros = useRef(new Map<number, { x: number; y: number }>());
  const pellizco = useRef<{ d: number; z: number } | null>(null);
  const v = useValidacion({ titulo: "No se pudo guardar la foto", reglas: () => [] });

  useEffect(() => () => URL.revokeObjectURL(src), [src]);

  const base = nat ? Math.max(VISTA / nat.w, VISTA / nat.h) : 1;
  const escala = base * zoom;
  // La imagen siempre cubre el circulo: el desplazamiento se limita a lo que sobra.
  const limitar = (p: { x: number; y: number }, z = zoom) => {
    if (!nat) return p;
    const s = base * z;
    const mx = Math.max(0, (nat.w * s - VISTA) / 2);
    const my = Math.max(0, (nat.h * s - VISTA) / 2);
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) };
  };
  const cambiarZoom = (z: number) => {
    const nuevo = Math.min(4, Math.max(1, z));
    setZoom(nuevo);
    setPos((p) => limitar(p, nuevo));
  };

  const abajo = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (punteros.current.size === 2) {
      const [a, b] = [...punteros.current.values()];
      pellizco.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom };
    }
  };
  const mover = (e: ReactPointerEvent<HTMLDivElement>) => {
    const previo = punteros.current.get(e.pointerId);
    if (!previo) return;
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (punteros.current.size === 2 && pellizco.current) {
      const [a, b] = [...punteros.current.values()];
      cambiarZoom((pellizco.current.z * Math.hypot(a.x - b.x, a.y - b.y)) / pellizco.current.d);
    } else if (punteros.current.size === 1) {
      setPos((p) => limitar({ x: p.x + e.clientX - previo.x, y: p.y + e.clientY - previo.y }));
    }
  };
  const arriba = (e: ReactPointerEvent<HTMLDivElement>) => {
    punteros.current.delete(e.pointerId);
    if (punteros.current.size < 2) pellizco.current = null;
  };

  const guardar = async () => {
    const img = imgRef.current;
    if (!img || !nat) return;
    setGuardando(true);
    try {
      // Recorte cuadrado del area visible del circulo, a 1024 px (el servidor lo recodifica a 512 y 128).
      const lado = VISTA / escala;
      const sx = nat.w / 2 - (VISTA / 2 + pos.x) / escala;
      const sy = nat.h / 2 - (VISTA / 2 + pos.y) / escala;
      const canvas = document.createElement("canvas");
      canvas.width = SALIDA;
      canvas.height = SALIDA;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No se pudo preparar la foto");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, lado, lado, 0, 0, SALIDA, SALIDA);
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/webp", 0.92));
      const final = blob && blob.type === "image/webp" ? blob : await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
      if (!final) throw new Error("No se pudo preparar la foto");
      const form = new FormData();
      form.append("archivo", new File([final], final.type === "image/webp" ? "foto.webp" : "foto.png", { type: final.type }));
      const r = await fetch(`${API_BASE_URL}/auth/me/foto`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(String(data.message || "No se pudo guardar la foto")), { status: r.status, data });
      await onGuardado();
      invalidate("cuentas-activas", "usuarios");
      toast.success("Foto de perfil actualizada");
      onCerrar();
    } catch (err) {
      v.errorServidor(err);
    } finally {
      setGuardando(false);
    }
  };

  const imagen = (tam: number) => {
    const f = tam / VISTA;
    return nat ? (
      // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:)
      <img src={src} alt="" draggable={false} className="pointer-events-none absolute top-1/2 left-1/2 max-w-none select-none" style={{ width: nat.w * escala * f, height: nat.h * escala * f, transform: `translate(calc(-50% + ${pos.x * f}px), calc(-50% + ${pos.y * f}px))` }} />
    ) : null;
  };

  return (
    <Dialog
      open
      onOpenChange={(abierto) => !abierto && onCerrar()}
      title="Recorta tu foto"
      description="Arrastra para encuadrar y usa el zoom. Así se verá en toda la plataforma."
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button onClick={guardar} loading={guardando} disabled={!nat}>
            Guardar
          </Button>
        </>
      }
    >
      <ValidacionAmbito v={v}>
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start sm:justify-center">
          <div className="flex flex-col items-center gap-3">
            <div
              role="application"
              aria-label="Encuadre de la foto: arrastra para mover y usa el zoom"
              tabIndex={0}
              onPointerDown={abajo}
              onPointerMove={mover}
              onPointerUp={arriba}
              onPointerCancel={arriba}
              onWheel={(e) => cambiarZoom(zoom - e.deltaY * 0.002)}
              onKeyDown={(e) => {
                const paso = 12;
                if (e.key === "ArrowLeft") setPos((p) => limitar({ ...p, x: p.x + paso }));
                if (e.key === "ArrowRight") setPos((p) => limitar({ ...p, x: p.x - paso }));
                if (e.key === "ArrowUp") setPos((p) => limitar({ ...p, y: p.y + paso }));
                if (e.key === "ArrowDown") setPos((p) => limitar({ ...p, y: p.y - paso }));
                if (e.key === "+" || e.key === "=") cambiarZoom(zoom + 0.1);
                if (e.key === "-") cambiarZoom(zoom - 0.1);
              }}
              className="relative cursor-grab touch-none overflow-hidden rounded-card bg-surface-3 select-none active:cursor-grabbing"
              style={{ width: VISTA, height: VISTA }}
            >
              {/* Imagen oculta que sirve para medir y recortar. */}
              {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:) */}
              <img ref={imgRef} src={src} alt="" className="hidden" onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
              {imagen(VISTA)}
              {/* Circulo: lo de fuera queda oscurecido. */}
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full shadow-recorte ring-2 ring-knob/80" />
            </div>
            <label className="flex w-full items-center gap-2 text-ink-3">
              <MagnifyingGlassMinus size={16} aria-hidden="true" />
              <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => cambiarZoom(Number(e.target.value))} aria-label="Zoom" className="flex-1 accent-[var(--color-brand)]" />
              <MagnifyingGlassPlus size={16} aria-hidden="true" />
            </label>
          </div>
          <div className="flex items-center gap-4 sm:flex-col sm:pt-6">
            <span className="flex flex-col items-center gap-1.5">
              <span className="relative block h-24 w-24 overflow-hidden rounded-full bg-surface-3 shadow-card">{imagen(96)}</span>
              <span className="text-2xs text-ink-3">En ventanas</span>
            </span>
            <span className="flex flex-col items-center gap-1.5">
              <span className="relative block h-8 w-8 overflow-hidden rounded-full bg-surface-3 shadow-card">{imagen(32)}</span>
              <span className="text-2xs text-ink-3">En listas</span>
            </span>
          </div>
        </div>
      </ValidacionAmbito>
    </Dialog>
  );
}
