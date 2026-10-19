import { useId } from "react";
import { cn } from "@/components/ui/cn";

/*
 * Marca: una floración algal en un solo símbolo. Una diatomea céntrica
 * (valva con estrías marginales, areolas y núcleo) con dos células hijas,
 * sobre el mar. Es lo que el laboratorio observa al microscopio y la causa
 * de las toxinas que analiza. Sobre un cuadrado redondeado color océano.
 *
 * `animated`: la célula gira muy despacio, las hijas flotan y el mar se mueve
 * (solo transform/opacity; se detiene con prefers-reduced-motion).
 */
const CELL = { cx: 29, cy: 26 };
const TICKS = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
  const rad = (deg * Math.PI) / 180;
  return { x1: CELL.cx + 9.2 * Math.cos(rad), y1: CELL.cy + 9.2 * Math.sin(rad), x2: CELL.cx + 12.2 * Math.cos(rad), y2: CELL.cy + 12.2 * Math.sin(rad) };
});

export function BrandMark({ size = 28, className, inverted = false, animated = false }: { size?: number; className?: string; inverted?: boolean; animated?: boolean }) {
  const id = useId().replace(/:/g, "");
  const fg = "#ffffff";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" className={cn("shrink-0", animated && "brand-animated", className)}>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={inverted ? "#3ab2cf" : "#2ea4c2"} />
          <stop offset="100%" stopColor={inverted ? "#0c4b5d" : "#0a5468"} />
        </linearGradient>
        <linearGradient id={`${id}-h`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-c`}>
          <rect width="64" height="64" rx="18" />
        </clipPath>
      </defs>
      <rect width="64" height="64" rx="18" fill={`url(#${id}-g)`} />
      <rect width="64" height="64" rx="18" fill={`url(#${id}-h)`} />
      <g clipPath={`url(#${id}-c)`}>
        <g className="brand-cell" style={{ transformOrigin: `${CELL.cx}px ${CELL.cy}px` }}>
          <circle cx={CELL.cx} cy={CELL.cy} r="14" fill={fg} fillOpacity="0.12" stroke={fg} strokeWidth="3" />
          <g stroke={fg} strokeWidth="2" strokeLinecap="round" opacity="0.9">
            {TICKS.map((t, i) => (
              <line key={i} x1={t.x1.toFixed(2)} y1={t.y1.toFixed(2)} x2={t.x2.toFixed(2)} y2={t.y2.toFixed(2)} />
            ))}
          </g>
          <circle cx={CELL.cx} cy={CELL.cy} r="5.6" fill="none" stroke={fg} strokeWidth="1.8" strokeDasharray="2.2 2.4" opacity="0.9" />
          <circle cx={CELL.cx} cy={CELL.cy} r="2" fill={fg} />
        </g>
        <g className="brand-daughters">
          <circle cx="50" cy="14" r="5" fill="none" stroke={fg} strokeWidth="2.4" opacity="0.9" />
          <circle cx="50" cy="14" r="1.4" fill={fg} opacity="0.9" />
          <circle cx="53.5" cy="27.5" r="3.2" fill="none" stroke={fg} strokeWidth="2" opacity="0.7" />
        </g>
        <g className="brand-sea">
          <path d="M-32 50c6-6 12-6 18 0s12 6 18 0 12-6 18 0 12 6 18 0 12-6 18 0 12 6 18 0 12-6 18 0" fill="none" stroke={fg} strokeWidth="3" strokeLinecap="round" />
          <path d="M-32 58c6-6 12-6 18 0s12 6 18 0 12-6 18 0 12 6 18 0 12-6 18 0 12 6 18 0 12-6 18 0" fill="none" stroke={fg} strokeWidth="2.2" strokeLinecap="round" opacity="0.5" />
        </g>
      </g>
    </svg>
  );
}

export function BrandLockup({ inverted = false, className, size = 28 }: { inverted?: boolean; className?: string; size?: number }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark inverted={inverted} size={size} />
      <span className={cn("text-md font-semibold tracking-tight", inverted ? "text-on-deep" : "text-ink")}>FICOTOX</span>
    </span>
  );
}
