/*
 * Catalogo de avatares (compartido servidor + cliente). El dibujo vive en
 * `src/components/ui/AvatarArt.tsx`; aqui solo las claves, para validar lo que
 * se guarda y para asignar uno al azar (pero estable) a quien no ha elegido.
 */
export const AVATAR_KEYS = [
  "medusa",
  "pulpo",
  "tortuga",
  "ballena",
  "pez",
  "cangrejo",
  "estrella",
  "erizo",
  "concha",
  "mejillon",
  "diatomea",
  "dinoflagelado",
  "alga",
  "coral",
  "ola",
  "microscopio",
  "matraz",
  "faro",
] as const;

export type AvatarKey = (typeof AVATAR_KEYS)[number];

export function isAvatarKey(value: unknown): value is AvatarKey {
  return typeof value === "string" && (AVATAR_KEYS as readonly string[]).includes(value);
}

/* Avatar por omision: se deriva del correo (o nombre) para que siempre sea el mismo mientras la persona no elija otro. */
export function defaultAvatarFor(seed: string): AvatarKey {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_KEYS[hash % AVATAR_KEYS.length];
}

export function randomAvatar(): AvatarKey {
  return AVATAR_KEYS[Math.floor(Math.random() * AVATAR_KEYS.length)];
}

/*
 * Figuras por omision distintas entre las personas que no eligieron una
 * (mientras queden figuras libres): en orden de id, cada quien toma la de su
 * correo y, si ya la tiene otra persona (elegida o asignada), la siguiente
 * libre. Estable: depende solo del directorio de cuentas. Devuelve semilla
 * (correo o nombre en minusculas) -> figura.
 */
export function figurasPorDefecto(personas: Array<{ id?: unknown; email?: unknown; nombre?: unknown; avatar?: unknown }>): Map<string, AvatarKey> {
  const semilla = (p: { email?: unknown; nombre?: unknown }) => String(p.email || p.nombre || "?").trim().toLowerCase();
  const ocupadas = new Set<string>(personas.filter((p) => isAvatarKey(p.avatar)).map((p) => String(p.avatar)));
  const out = new Map<string, AvatarKey>();
  const sinElegir = personas.filter((p) => !isAvatarKey(p.avatar)).sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
  for (const p of sinElegir) {
    const s = semilla(p);
    const base = AVATAR_KEYS.indexOf(defaultAvatarFor(s));
    let elegida: AvatarKey = AVATAR_KEYS[base];
    if (ocupadas.size < AVATAR_KEYS.length) {
      for (let k = 0; k < AVATAR_KEYS.length; k += 1) {
        const candidata = AVATAR_KEYS[(base + k) % AVATAR_KEYS.length];
        if (!ocupadas.has(candidata)) {
          elegida = candidata;
          break;
        }
      }
    }
    ocupadas.add(elegida);
    out.set(s, elegida);
  }
  return out;
}
