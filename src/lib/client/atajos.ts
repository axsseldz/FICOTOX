"use client";

import { useSyncExternalStore } from "react";

/*
 * Atajos de teclado: la ÚNICA fuente para saber si la persona usa Mac y para
 * escribir y reconocer un atajo. Un atajo se declara en forma neutra con
 * «Mod» (Cmd en Mac, Ctrl en Windows/Linux), «Alt» (Option en Mac) y «Shift»:
 *
 *   coincideAtajo(evento, "Mod+K")   // Cmd+K en Mac, Ctrl+K en Windows/Linux
 *   formatoAtajo("Mod+K")            // "⌘K" en Mac, "Ctrl+K" en Windows/Linux
 *   teclasAtajo("Mod+K")             // ["⌘", "K"] o ["Ctrl", "K"] para <Kbd>
 *
 * En la pantalla se usa `useAtajo` (o `<Atajo>`, en Primitives): en el
 * servidor y en el primer pintado se escribe como en Windows y, ya en el
 * navegador, como en el sistema de la persona (sin desajuste de hidratación).
 */

/* Mac, iPhone o iPad (iPadOS se presenta como Mac). */
export function esMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}

const SIMBOLOS_MAC: Record<string, string> = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Enter: "↵", Esc: "Esc" };
const NOMBRES_OTROS: Record<string, string> = { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Enter: "Enter", Esc: "Esc" };

/* Teclas del atajo ya traducidas al sistema: una por <Kbd>. */
export function teclasAtajo(atajo: string, mac = esMac()): string[] {
  return atajo.split("+").map((tecla) => (mac ? SIMBOLOS_MAC : NOMBRES_OTROS)[tecla] ?? (tecla.length === 1 ? tecla.toUpperCase() : tecla));
}

/* Texto del atajo para tooltips y etiquetas: "⌘K" en Mac (símbolos juntos), "Ctrl+K" en los demás. */
export function formatoAtajo(atajo: string, mac = esMac()): string {
  return teclasAtajo(atajo, mac).join(mac ? "" : "+");
}

/*
 * ¿El evento es este atajo? «Mod» exige Cmd en Mac y Ctrl en los demás (y que
 * el otro no esté presionado), para no robar Ctrl+K o Ctrl+F al sistema en Mac.
 */
export function coincideAtajo(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">, atajo: string, mac = esMac()): boolean {
  const partes = atajo.split("+");
  const tecla = partes[partes.length - 1].toLowerCase();
  const mods = new Set(partes.slice(0, -1));
  const quiereMeta = mac && mods.has("Mod");
  const quiereCtrl = (!mac && mods.has("Mod")) || mods.has("Ctrl");
  return event.key.toLowerCase() === tecla && event.metaKey === quiereMeta && event.ctrlKey === quiereCtrl && event.altKey === mods.has("Alt") && event.shiftKey === mods.has("Shift");
}

const sinSuscripcion = () => () => undefined;

/* `true` en Mac ya en el navegador; `false` en el servidor y en la hidratación. */
export function useEsMac(): boolean {
  return useSyncExternalStore(sinSuscripcion, esMac, () => false);
}

/* El atajo escrito para el sistema de la persona ("⌘K" o "Ctrl+K"). */
export function useAtajo(atajo: string): string {
  return formatoAtajo(atajo, useEsMac());
}
