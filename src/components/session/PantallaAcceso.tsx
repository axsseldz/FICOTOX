"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { BrandMark } from "@/components/shell/Brand";
import { cn } from "@/components/ui/cn";

/*
 * Pantalla de acceso (inicio de sesion y cambio obligatorio de contraseña).
 * En ancha, dos zonas: a la izquierda (55 %) el panel océano con la identidad
 * del laboratorio —olas lentas abajo, microalgas y diatomeas a la deriva con
 * poca opacidad (canvas ligero, requestAnimationFrame, pausado con la pestaña
 * oculta), todo con su propio movimiento (no sigue al mouse)—; a la derecha, el
 * formulario sobre una tarjeta limpia. En angosta, el panel es una franja
 * superior con el logo y la animacion. Con prefers-reduced-motion: fondo
 * estatico, sin particulas. Todo local (sin recursos externos).
 */

export function PantallaAcceso({ children, saliendo = false }: { children: ReactNode; saliendo?: boolean }) {
  return (
    <main className="acceso flex min-h-dvh flex-col bg-canvas text-ink lg:flex-row">
      <div className={cn("acceso-panel relative isolate flex h-[210px] shrink-0 flex-col items-center justify-center overflow-hidden text-white sm:h-[240px] lg:h-auto lg:w-[55%]", saliendo && "acceso-panel-sale")}>
        <Microalgas />
        <Olas />
        <div className="relative z-10 flex flex-col items-center px-6 text-center">
          <div className="acceso-logo">
            <BrandMark animated className="h-[68px] w-[68px] drop-shadow-[0_16px_28px_rgba(0,20,30,0.35)] sm:h-[84px] sm:w-[84px] lg:h-[120px] lg:w-[120px]" size={120} inverted />
          </div>
          <p className="acceso-entra mt-3 text-[22px] font-bold tracking-[-0.03em] lg:mt-7 lg:text-[40px]" style={{ ["--i" as string]: 2 }}>
            FICOTOX
          </p>
          <p className="acceso-entra mt-1 hidden text-[16px] text-white/85 sm:block lg:mt-2" style={{ ["--i" as string]: 3 }}>
            Sistema Integrado de Gestión de Laboratorio
          </p>
        </div>
        <p className="acceso-entra absolute bottom-5 z-10 hidden text-[12px] font-medium tracking-[0.08em] text-white/75 lg:block" style={{ ["--i" as string]: 4 }}>
          LN-FICOTOX · CICESE
        </p>
      </div>

      <div className="flex flex-1 items-start justify-center px-5 py-8 sm:px-8 lg:items-center lg:py-12">{children}</div>
    </main>
  );
}

/* Olas lentas en la parte inferior, como en el logo (SVG con CSS; quietas con movimiento reducido). */
function Olas() {
  const ola = "M0 40 Q 75 10 150 40 T 300 40 T 450 40 T 600 40 T 750 40 T 900 40 T 1050 40 T 1200 40 V 120 H 0 Z";
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%] min-h-[90px]">
      <svg className="acceso-ola absolute bottom-0 left-0 h-full w-[200%]" viewBox="0 0 1200 120" preserveAspectRatio="none" style={{ ["--dur" as string]: "26s" }}>
        <path d={ola} fill="currentColor" className="text-white/[0.07]" />
      </svg>
      <svg className="acceso-ola absolute bottom-0 left-0 h-[80%] w-[200%]" viewBox="0 0 1200 120" preserveAspectRatio="none" style={{ ["--dur" as string]: "38s" }}>
        <path d={ola} fill="currentColor" className="text-white/[0.06]" />
      </svg>
      <svg className="acceso-ola absolute bottom-0 left-0 h-[60%] w-[200%]" viewBox="0 0 1200 120" preserveAspectRatio="none" style={{ ["--dur" as string]: "12s" }}>
        <path d={ola} fill="none" stroke="currentColor" strokeWidth="2" className="text-white/25" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

/*
 * Microalgas y diatomeas a la deriva: pocas siluetas blancas de baja
 * opacidad (discos con estrias, cadenas y valvas alargadas) dibujadas en un
 * canvas. Pocas particulas, requestAnimationFrame y pausa con la pestaña
 * oculta; con movimiento reducido no se dibuja nada.
 */
function Microalgas() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    type Alga = { x: number; y: number; r: number; vx: number; vy: number; giro: number; vg: number; forma: 0 | 1 | 2; alfa: number };
    let algas: Alga[] = [];
    let ancho = 0;
    let alto = 0;
    let marco = 0;
    let ultimo = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const medir = () => {
      const r = canvas.getBoundingClientRect();
      ancho = r.width;
      alto = r.height;
      canvas.width = Math.round(ancho * dpr);
      canvas.height = Math.round(alto * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Pocas particulas: segun el area, entre 8 y 22.
      const n = Math.max(8, Math.min(22, Math.round((ancho * alto) / 42000)));
      algas = Array.from({ length: n }, () => ({
        x: Math.random() * ancho,
        y: Math.random() * alto,
        r: 4 + Math.random() * 11,
        vx: (Math.random() - 0.5) * 6,
        vy: -2 - Math.random() * 5,
        giro: Math.random() * Math.PI * 2,
        vg: (Math.random() - 0.5) * 0.15,
        forma: (Math.floor(Math.random() * 3) as 0 | 1 | 2),
        alfa: 0.08 + Math.random() * 0.14,
      }));
    };
    const dibujar = (a: Alga) => {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.giro);
      ctx.globalAlpha = a.alfa;
      ctx.strokeStyle = "#ffffff";
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1.2;
      if (a.forma === 0) {
        // Diatomea centrica: disco con estrias y nucleo.
        ctx.beginPath();
        ctx.arc(0, 0, a.r, 0, Math.PI * 2);
        ctx.stroke();
        for (let k = 0; k < 8; k++) {
          const t = (k / 8) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(t) * a.r * 0.62, Math.sin(t) * a.r * 0.62);
          ctx.lineTo(Math.cos(t) * a.r * 0.88, Math.sin(t) * a.r * 0.88);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(0, 0, a.r * 0.22, 0, Math.PI * 2);
        ctx.fill();
      } else if (a.forma === 1) {
        // Diatomea penada: valva alargada con rafe.
        ctx.beginPath();
        ctx.ellipse(0, 0, a.r * 1.5, a.r * 0.45, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-a.r * 1.2, 0);
        ctx.lineTo(a.r * 1.2, 0);
        ctx.stroke();
      } else {
        // Cadena de celulas (microalga colonial).
        for (let k = -1; k <= 1; k++) {
          ctx.beginPath();
          ctx.arc(k * a.r * 0.9, 0, a.r * 0.42, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    };
    const paso = (t: number) => {
      const dt = Math.min(0.05, ultimo ? (t - ultimo) / 1000 : 0);
      ultimo = t;
      ctx.clearRect(0, 0, ancho, alto);
      for (const a of algas) {
        a.x += a.vx * dt;
        a.y += a.vy * dt;
        a.giro += a.vg * dt;
        if (a.y < -20) a.y = alto + 20;
        if (a.x < -20) a.x = ancho + 20;
        if (a.x > ancho + 20) a.x = -20;
        dibujar(a);
      }
      marco = requestAnimationFrame(paso);
    };
    const iniciar = () => {
      cancelAnimationFrame(marco);
      ultimo = 0;
      if (document.visibilityState === "visible") marco = requestAnimationFrame(paso);
    };
    medir();
    iniciar();
    const obs = new ResizeObserver(medir);
    obs.observe(canvas);
    document.addEventListener("visibilitychange", iniciar);
    return () => {
      cancelAnimationFrame(marco);
      obs.disconnect();
      document.removeEventListener("visibilitychange", iniciar);
    };
  }, []);
  return <canvas ref={ref} aria-hidden="true" className="acceso-fondo-entra pointer-events-none absolute inset-0 h-full w-full" />;
}

/* Tarjeta del formulario (derecha): superficie de la app, con entrada, negacion (al fallar) y salida. */
export function TarjetaAcceso({ children, niega = 0, saliendo, className }: { children: ReactNode; niega?: number; saliendo?: boolean; className?: string }) {
  const ref = useRef<HTMLElement | null>(null);
  // Cada error repite el movimiento de "negacion" sin volver a montar el formulario (no se pierde el foco).
  useEffect(() => {
    const el = ref.current;
    if (!el || !niega) return;
    el.classList.remove("acceso-niega");
    void el.offsetWidth;
    el.classList.add("acceso-niega");
  }, [niega]);
  return (
    <section ref={ref} className={cn("acceso-tarjeta w-full max-w-[420px] rounded-[22px] bg-surface p-6 shadow-raised ring-1 ring-line sm:p-8", saliendo && "acceso-tarjeta-sale", className)}>
      {children}
    </section>
  );
}
