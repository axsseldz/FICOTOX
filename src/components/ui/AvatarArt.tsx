import { useId, type ReactNode } from "react";
import { cn } from "./cn";
import { AVATAR_KEYS, defaultAvatarFor, isAvatarKey, type AvatarKey } from "@/lib/shared/avatars";

/*
 * Avatares ilustrados: criaturas y objetos del mundo del laboratorio (mar,
 * microalgas, moluscos, instrumental). Cada uno es un SVG de 64 × 64 con un
 * fondo en degradado propio y la ilustración en blanco. Todos comparten el
 * mismo grosor de línea (2.6) y remates redondeados para verse como una
 * familia.
 */

interface AvatarDef {
  label: string;
  from: string;
  to: string;
  art: ReactNode;
}

const W = "#ffffff";
const stroke = { fill: "none", stroke: W, strokeWidth: 2.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const thin = { ...stroke, strokeWidth: 1.8 };

export const AVATARS: Record<AvatarKey, AvatarDef> = {
  medusa: {
    label: "Medusa",
    from: "#7fb8ff",
    to: "#4a5fd6",
    art: (
      <>
        <path d="M17 31a15 13 0 0 1 30 0c0 3-2 4-4 4H21c-2 0-4-1-4-4Z" fill={W} fillOpacity="0.92" />
        <path d="M22 24c2-4 6-6 10-6" {...thin} stroke="#4a5fd6" opacity="0.35" />
        <circle cx="27" cy="29" r="1.6" fill="#4a5fd6" />
        <circle cx="37" cy="29" r="1.6" fill="#4a5fd6" />
        <path d="M23 36c-2 5 3 8 0 14M30 36c2 5-2 9 0 15M35 36c-2 5 3 9 1 14M41 36c2 5-3 8-1 13" {...stroke} opacity="0.9" />
      </>
    ),
  },
  pulpo: {
    label: "Pulpo",
    from: "#ff9a8b",
    to: "#c0392b",
    art: (
      <>
        <path d="M20 31a12 12 0 0 1 24 0v5H20Z" fill={W} fillOpacity="0.92" />
        <circle cx="27" cy="29" r="2.6" fill="#c0392b" />
        <circle cx="37" cy="29" r="2.6" fill="#c0392b" />
        <circle cx="27.8" cy="28.3" r="0.9" fill={W} />
        <circle cx="37.8" cy="28.3" r="0.9" fill={W} />
        <path d="M22 36c-3 6-9 6-9 12s7 5 9 0M28 36c-1 6-5 8-3 14M36 36c1 6 5 8 3 14M42 36c3 6 9 6 9 12s-7 5-9 0" {...stroke} />
      </>
    ),
  },
  tortuga: {
    label: "Tortuga",
    from: "#8fd694",
    to: "#2e7d4f",
    art: (
      <>
        <ellipse cx="31" cy="33" rx="15" ry="11" fill={W} fillOpacity="0.92" />
        <path d="M24 28l4-3 6 0 4 3-1 6-4 3h-6l-4-3Z" {...thin} stroke="#2e7d4f" opacity="0.45" />
        <path d="M28 25l-5-3M34 25l5-3M23 34l-5 1M40 34l5 1M27 39l-2 4M35 39l2 4" {...thin} stroke="#2e7d4f" opacity="0.45" />
        <circle cx="49" cy="29" r="5" fill={W} fillOpacity="0.92" />
        <circle cx="50.5" cy="28" r="1.2" fill="#2e7d4f" />
        <ellipse cx="18" cy="40" rx="5" ry="2.6" transform="rotate(-30 18 40)" fill={W} fillOpacity="0.85" />
        <ellipse cx="42" cy="43" rx="5" ry="2.6" transform="rotate(25 42 43)" fill={W} fillOpacity="0.85" />
      </>
    ),
  },
  ballena: {
    label: "Ballena",
    from: "#6ec6e6",
    to: "#1f5f8b",
    art: (
      <>
        <path d="M11 36c2-10 12-16 24-16 9 0 15 4 18 9-3 5-8 8-15 8H21c-4 0-8-1-10-1Z" fill={W} fillOpacity="0.92" />
        <path d="M46 30l8-8 2 10-9 2" fill={W} fillOpacity="0.92" />
        <path d="M14 34c8 2 16 2 28 0" {...thin} stroke="#1f5f8b" opacity="0.35" />
        <circle cx="22" cy="29" r="1.6" fill="#1f5f8b" />
        <path d="M31 19c-2-4-1-8 2-10M31 19c3-4 7-6 9-5" {...stroke} opacity="0.85" />
        <path d="M12 44c4-3 8-3 12 0s8 3 12 0 8-3 12 0" {...thin} opacity="0.7" />
      </>
    ),
  },
  pez: {
    label: "Pez",
    from: "#ffd08a",
    to: "#e07b1a",
    art: (
      <>
        <path d="M13 32c6-9 14-13 24-13 6 4 10 8 12 13-2 5-6 9-12 13-10 0-18-4-24-13Z" fill={W} fillOpacity="0.92" />
        <path d="M48 32l9-8-2 8 2 8Z" fill={W} fillOpacity="0.92" />
        <circle cx="41" cy="30" r="1.8" fill="#e07b1a" />
        <path d="M27 21c3 4 3 18 0 22M33 20c3 5 3 19 0 24" {...thin} stroke="#e07b1a" opacity="0.4" />
        <path d="M23 20c-3 4-3 6-1 8M23 44c-3-4-3-6-1-8" {...thin} opacity="0.9" />
      </>
    ),
  },
  cangrejo: {
    label: "Cangrejo",
    from: "#ff9d6c",
    to: "#c43c1c",
    art: (
      <>
        <ellipse cx="32" cy="37" rx="13" ry="9" fill={W} fillOpacity="0.92" />
        <path d="M26 28v-6M38 28v-6" {...stroke} />
        <circle cx="26" cy="20" r="2.6" fill={W} />
        <circle cx="38" cy="20" r="2.6" fill={W} />
        <circle cx="26" cy="20" r="1" fill="#c43c1c" />
        <circle cx="38" cy="20" r="1" fill="#c43c1c" />
        <path d="M20 33c-4-2-7-4-8-8M44 33c4-2 7-4 8-8" {...stroke} />
        <path d="M12 25a4 4 0 1 1 3-6l-2 3Z M52 25a4 4 0 1 0-3-6l2 3Z" fill={W} />
        <path d="M22 44l-5 5M27 46l-3 6M42 44l5 5M37 46l3 6" {...stroke} opacity="0.9" />
      </>
    ),
  },
  estrella: {
    label: "Estrella de mar",
    from: "#f7a8c8",
    to: "#b5326e",
    art: (
      <>
        <path d="M32 12l5.5 13 14 1.2-10.6 9.2 3.2 13.8L32 42l-12.1 7.2 3.2-13.8L12.5 26.2l14-1.2Z" fill={W} fillOpacity="0.92" strokeLinejoin="round" />
        <g fill="#b5326e" opacity="0.5">
          <circle cx="32" cy="20" r="1.2" /><circle cx="32" cy="26" r="1.2" /><circle cx="41" cy="27" r="1.2" /><circle cx="23" cy="27" r="1.2" /><circle cx="36" cy="34" r="1.2" /><circle cx="28" cy="34" r="1.2" /><circle cx="38" cy="41" r="1.2" /><circle cx="26" cy="41" r="1.2" /><circle cx="32" cy="32" r="1.6" />
        </g>
      </>
    ),
  },
  erizo: {
    label: "Erizo de mar",
    from: "#d8a6ff",
    to: "#6b2fb3",
    art: (
      <>
        <g stroke={W} strokeWidth="2.2" strokeLinecap="round">
          {Array.from({ length: 16 }, (_, i) => {
            const rad = (i * 22.5 * Math.PI) / 180;
            const len = i % 2 === 0 ? 24 : 20;
            return <line key={i} x1={32 + 12 * Math.cos(rad)} y1={33 + 12 * Math.sin(rad)} x2={32 + len * Math.cos(rad)} y2={33 + len * Math.sin(rad)} />;
          })}
        </g>
        <circle cx="32" cy="33" r="13" fill={W} fillOpacity="0.92" />
        <g fill="#6b2fb3" opacity="0.45">
          <circle cx="32" cy="33" r="1.6" /><circle cx="26" cy="30" r="1.2" /><circle cx="38" cy="30" r="1.2" /><circle cx="27" cy="38" r="1.2" /><circle cx="37" cy="38" r="1.2" /><circle cx="32" cy="26" r="1.2" /><circle cx="32" cy="40" r="1.2" />
        </g>
      </>
    ),
  },
  concha: {
    label: "Concha",
    from: "#f6c9b0",
    to: "#c4623c",
    art: (
      <>
        <path d="M32 50L14 31a18 18 0 0 1 36 0Z" fill={W} fillOpacity="0.92" />
        <path d="M32 50L20 22M32 50L26 17M32 50V15M32 50l6-33M32 50l12-28" {...thin} stroke="#c4623c" opacity="0.35" />
        <path d="M27 52h10l1-3H26Z" fill={W} />
      </>
    ),
  },
  mejillon: {
    label: "Mejillón",
    from: "#8f9bd9",
    to: "#2d2f6e",
    art: (
      <>
        <path d="M26 50c-9-6-11-22 3-36 5 7 8 16 6 24-1 6-5 10-9 12Z" fill={W} fillOpacity="0.55" />
        <path d="M31 50c-9-6-11-22 3-36 5 7 8 16 6 24-1 6-5 10-9 12Z" fill={W} fillOpacity="0.95" />
        <path d="M33 22c3 5 4 11 3 17M31 26c2 4 3 9 2 14" {...thin} stroke="#2d2f6e" opacity="0.3" />
      </>
    ),
  },
  diatomea: {
    label: "Diatomea",
    from: "#69d2c8",
    to: "#0f6e78",
    art: (
      <>
        <circle cx="32" cy="32" r="16" fill={W} fillOpacity="0.15" stroke={W} strokeWidth="3" />
        <g stroke={W} strokeWidth="2.2" strokeLinecap="round">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
            const rad = (deg * Math.PI) / 180;
            return <line key={deg} x1={32 + 10.5 * Math.cos(rad)} y1={32 + 10.5 * Math.sin(rad)} x2={32 + 14 * Math.cos(rad)} y2={32 + 14 * Math.sin(rad)} />;
          })}
        </g>
        <circle cx="32" cy="32" r="6.5" fill="none" stroke={W} strokeWidth="1.8" strokeDasharray="2.4 2.6" />
        <circle cx="32" cy="32" r="2.3" fill={W} />
      </>
    ),
  },
  dinoflagelado: {
    label: "Dinoflagelado",
    from: "#b9e37a",
    to: "#3f7d1e",
    art: (
      <>
        <path d="M32 12c10 0 15 8 15 16 0 10-7 17-15 17S17 38 17 28c0-8 5-16 15-16Z" fill={W} fillOpacity="0.92" />
        <path d="M17.4 27c4 3.6 9 5.4 14.6 5.4S42.6 30.6 46.6 27" fill="none" stroke="#3f7d1e" strokeWidth="3.2" strokeLinecap="round" opacity="0.55" />
        <path d="M32 32.4v9.6" fill="none" stroke="#3f7d1e" strokeWidth="2.4" strokeLinecap="round" opacity="0.55" />
        <path d="M32 18v6M25 21l3 4M39 21l-3 4" fill="none" stroke="#3f7d1e" strokeWidth="1.6" strokeLinecap="round" opacity="0.35" />
        <path d="M32 45c0 3-4 4-4 7s4 3 4 6" {...stroke} />
      </>
    ),
  },
  alga: {
    label: "Alga",
    from: "#7fd8a4",
    to: "#146b4a",
    art: (
      <>
        <path d="M22 54c0-10 6-14 4-22s-6-10-2-17M32 54c0-12-4-16 0-27M42 54c0-10-6-14-4-22s6-10 2-17" fill="none" stroke={W} strokeWidth="3.2" strokeLinecap="round" />
        <ellipse cx="20" cy="27" rx="2.4" ry="4.5" transform="rotate(-25 20 27)" fill={W} fillOpacity="0.9" />
        <ellipse cx="34" cy="23" rx="2.4" ry="4.5" transform="rotate(20 34 23)" fill={W} fillOpacity="0.9" />
        <ellipse cx="44" cy="30" rx="2.4" ry="4.5" transform="rotate(30 44 30)" fill={W} fillOpacity="0.9" />
        <path d="M14 54h36" {...thin} opacity="0.6" />
      </>
    ),
  },
  coral: {
    label: "Coral",
    from: "#ffb3a0",
    to: "#d2416a",
    art: (
      <>
        <path d="M32 54V34M32 40c-6-2-10-7-10-14M32 36c6-2 10-7 12-14M22 26c-2-4-6-5-8-5M44 22c2-4 6-5 8-5M32 30c0-6 2-10 4-14M22 26l-3 6" fill="none" stroke={W} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        <g fill={W}>
          <circle cx="14" cy="21" r="2.4" /><circle cx="52" cy="17" r="2.4" /><circle cx="36" cy="16" r="2.4" /><circle cx="19" cy="32" r="2.4" /><circle cx="44" cy="22" r="1.6" />
        </g>
        <path d="M20 54h24" {...thin} opacity="0.6" />
      </>
    ),
  },
  ola: {
    label: "Ola",
    from: "#8fd3ff",
    to: "#1b6fbf",
    art: (
      <>
        <path d="M9 45c8 0 12-11 21-11 7 0 10 6 14 6s8-3 8-9c0-5-3-8-7-9 7 0 13 5 13 13s-7 14-15 14c-8 0-10-6-16-6s-10 5-18 2Z" fill={W} fillOpacity="0.92" />
        <path d="M40 24c-3 0-6 2-7 5" {...thin} stroke="#1b6fbf" opacity="0.4" />
        <path d="M12 52c4-2 8-2 12 0s8 2 12 0" {...thin} opacity="0.8" />
      </>
    ),
  },
  microscopio: {
    label: "Microscopio",
    from: "#c9c3ff",
    to: "#5b4bbf",
    art: (
      <>
        <path d="M18 52h28" fill="none" stroke={W} strokeWidth="3.2" strokeLinecap="round" />
        <path d="M41 52V38c0-9-6-16-15-18" {...stroke} strokeWidth="3.2" />
        <path d="M24 16l11 14" fill="none" stroke={W} strokeWidth="6" strokeLinecap="round" />
        <circle cx="22" cy="14" r="3.6" fill={W} />
        <path d="M22 40h18" fill="none" stroke={W} strokeWidth="3.2" strokeLinecap="round" />
        <path d="M31 40v5" {...stroke} />
        <circle cx="35" cy="33" r="2.2" fill={W} />
      </>
    ),
  },
  matraz: {
    label: "Matraz",
    from: "#7fe0d0",
    to: "#0d7a80",
    art: (
      <>
        <path d="M27 13h10v12l10 21c1.4 3-.6 6-4 6H21c-3.4 0-5.4-3-4-6l10-21Z" {...stroke} fill={W} fillOpacity="0.25" />
        <path d="M22 40l4-8h12l4 8c1.6 3.4 0 6-3 6H25c-3 0-4.6-2.6-3-6Z" fill={W} fillOpacity="0.9" />
        <path d="M25 13h14" {...stroke} />
        <circle cx="30" cy="37" r="1.4" fill="#0d7a80" opacity="0.6" />
        <circle cx="35" cy="41" r="1.8" fill="#0d7a80" opacity="0.6" />
        <circle cx="29" cy="43" r="1" fill="#0d7a80" opacity="0.6" />
      </>
    ),
  },
  faro: {
    label: "Faro",
    from: "#ffd9a0",
    to: "#b8552a",
    art: (
      <>
        <path d="M26 52l3-28h6l3 28Z" fill={W} fillOpacity="0.92" />
        <path d="M27.4 38h9.2M28.4 30h7.2" {...thin} stroke="#b8552a" opacity="0.45" />
        <path d="M27 24h10v-7H27Z" {...thin} fill={W} fillOpacity="0.5" />
        <path d="M30 17l2-4 2 4" fill={W} />
        <path d="M22 52h20" fill="none" stroke={W} strokeWidth="3.2" strokeLinecap="round" />
        <path d="M22 20l-8-3M22 22l-9 1M42 20l8-3M42 22l9 1" {...thin} opacity="0.85" />
      </>
    ),
  },
};

export function resolveAvatarKey(avatar: unknown, seed: string): AvatarKey {
  return isAvatarKey(avatar) ? avatar : defaultAvatarFor(seed);
}

/* Dibuja el avatar; `seed` (correo o nombre) decide el avatar por omision. */
/*
 * `animado`: "siempre" (la figura flota suave, p. ej. en la ventana de una
 * persona), "al-pasar" (solo con el cursor sobre su renglon .group) o false.
 * Respeta prefers-reduced-motion (globals.css).
 */
export function AvatarArt({ avatar, seed, size = 36, className, title, animado = false }: { avatar?: unknown; seed: string; size?: number; className?: string; title?: string; animado?: "siempre" | "al-pasar" | false }) {
  const key = resolveAvatarKey(avatar, seed);
  const def = AVATARS[key];
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} className={cn("shrink-0 select-none", animado === "siempre" && "avatar-vivo", animado === "al-pasar" && "avatar-al-pasar", className)}>
      <defs>
        <radialGradient id={`${id}-g`} cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor={def.from} />
          <stop offset="100%" stopColor={def.to} />
        </radialGradient>
        <clipPath id={`${id}-c`}>
          <circle cx="32" cy="32" r="32" />
        </clipPath>
      </defs>
      <circle cx="32" cy="32" r="32" fill={`url(#${id}-g)`} />
      <g clipPath={`url(#${id}-c)`}>
        <g className="avatar-arte">{def.art}</g>
      </g>
      <circle cx="32" cy="32" r="31.2" fill="none" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1.2" />
    </svg>
  );
}

export const AVATAR_LIST = AVATAR_KEYS.map((key) => ({ key, ...AVATARS[key] }));
