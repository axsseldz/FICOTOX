"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowsOut, MagnifyingGlassMinus, MagnifyingGlassPlus } from "@phosphor-icons/react";
import { IconButton } from "@/components/ui/Button";
import { ErrorState, Skeleton } from "@/components/ui/Primitives";
import { explicarError } from "@/lib/client/mensajes";
import { useArchivo } from "./usarArchivo";

const MIME_IMAGEN: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/* Imagen con zoom (botones, Ctrl + rueda, pellizco) y desplazamiento. "Ajustar" la muestra completa. */
export function VisorImagen({ url: origen, extension, titulo }: { url: string; extension: string; titulo: string }) {
  const { datos, error, cargando } = useArchivo(origen);
  const url = useMemo(() => (datos ? URL.createObjectURL(new Blob([datos], { type: MIME_IMAGEN[extension] || "image/png" })) : null), [datos, extension]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  const [zoom, setZoom] = useState<number | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const caja = useRef<HTMLDivElement | null>(null);
  const [area, setArea] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const medir = () => setArea({ w: el.clientWidth, h: el.clientHeight });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [url]);
  const ajuste = natural ? Math.min(1, (area.w - 32) / natural.w, (area.h - 32) / natural.h) : 1;
  const escala = zoom ?? ajuste;
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const rueda = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => Math.min(8, Math.max(0.05, (z ?? ajuste) * Math.exp(-e.deltaY * 0.0025))));
    };
    let distancia = 0;
    const toque = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (e.type === "touchstart") distancia = d;
      else if (distancia) {
        e.preventDefault();
        setZoom((z) => Math.min(8, Math.max(0.05, (z ?? ajuste) * (d / distancia))));
        distancia = d;
      }
    };
    el.addEventListener("wheel", rueda, { passive: false });
    el.addEventListener("touchstart", toque, { passive: true });
    el.addEventListener("touchmove", toque, { passive: false });
    return () => {
      el.removeEventListener("wheel", rueda);
      el.removeEventListener("touchstart", toque);
      el.removeEventListener("touchmove", toque);
    };
  }, [ajuste]);

  if (error) return <div className="p-6"><ErrorState message={explicarError(error, "No se pudo abrir la imagen").que} /></div>;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="visor-imagen">
      <div className="flex items-center gap-1 border-b border-line bg-surface px-3 py-1.5">
        <IconButton label="Alejar" onClick={() => setZoom(Math.max(0.05, escala / 1.25))}>
          <MagnifyingGlassMinus size={17} />
        </IconButton>
        <span className="tnum min-w-[3.5rem] text-center text-[12.5px] text-ink-2" data-testid="visor-zoom">
          {Math.round(escala * 100)} %
        </span>
        <IconButton label="Acercar" onClick={() => setZoom(Math.min(8, escala * 1.25))}>
          <MagnifyingGlassPlus size={17} />
        </IconButton>
        <IconButton label="Ajustar a la ventana" onClick={() => setZoom(null)}>
          <ArrowsOut size={17} />
        </IconButton>
        <button type="button" onClick={() => setZoom(1)} className="press ml-1 h-8 rounded-[8px] px-2 text-[12.5px] text-ink-2 hover:bg-surface-3">
          Tamaño real
        </button>
      </div>
      <div ref={caja} tabIndex={0} aria-label="Imagen" className="scroll-thin min-h-0 flex-1 overflow-auto bg-surface-3/70 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-brand)]">
        {cargando || !url ? (
          <div className="p-6"><Skeleton className="h-[420px] w-full" /></div>
        ) : (
          <div className="flex min-h-full min-w-max items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={titulo} onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} style={natural ? { width: natural.w * escala, height: natural.h * escala } : undefined} className="max-w-none bg-papel shadow-card" draggable={false} />
          </div>
        )}
      </div>
    </div>
  );
}
