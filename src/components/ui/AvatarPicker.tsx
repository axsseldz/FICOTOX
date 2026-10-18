"use client";

import { Check } from "@phosphor-icons/react";
import { AVATAR_LIST, AvatarArt } from "./AvatarArt";
import { cn } from "./cn";

/* Rejilla para elegir un avatar del catalogo. `value` null = el de omision (derivado del correo). */
export function AvatarPicker({ value, seed, onChange, size = 56, className }: { value: string | null; seed: string; onChange: (key: string) => void; size?: number; className?: string }) {
  return (
    <div role="radiogroup" aria-label="Avatar" className={cn("grid grid-cols-6 gap-2 sm:grid-cols-9", className)}>
      {AVATAR_LIST.map((entry) => {
        const selected = value === entry.key;
        return (
          <button
            key={entry.key}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={entry.label}
            title={entry.label}
            onClick={() => onChange(entry.key)}
            className={cn("press relative flex items-center justify-center rounded-full p-0.5 transition-transform duration-200 ease-[var(--ease-spring)]", selected ? "scale-105" : "opacity-90 hover:scale-105 hover:opacity-100")}
          >
            <AvatarArt avatar={entry.key} seed={seed} size={size} />
            {selected ? (
              <span className="absolute -right-0.5 -bottom-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-on-accent shadow-[0_0_0_2px_var(--color-surface)]">
                <Check size={11} weight="bold" />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
