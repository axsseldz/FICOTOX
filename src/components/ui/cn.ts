import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/*
 * Une clases y, si dos chocan (text-sm de un componente y text-base de quien
 * lo usa), gana la última: la que pasa quien llama. tailwind-merge conoce los
 * tokens propios del tema (globals.css) para no confundir text-md (tamaño)
 * con text-ink (color) ni rounded-field con otro radio. Los tamaños del tema
 * no fijan interlineado, así que text-sm no borra un leading-* anterior.
 */
const twMerge = extendTailwindMerge({
  override: {
    theme: {
      text: ["2xs", "xs", "sm", "base", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"],
      radius: ["xs", "sm", "control", "field", "box", "card", "panel"],
      shadow: ["card", "raised", "panel", "pop", "accent", "sticky", "knob", "paper", "paper-sm", "recorte"],
      leading: ["tight", "snug", "normal", "relaxed"],
      tracking: ["display", "tight", "snug", "wide", "widest"],
    },
    conflictingClassGroups: { "font-size": [] },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
