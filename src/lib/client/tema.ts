"use client";

import { useSyncExternalStore } from "react";
import { API_BASE_URL, sendJsonAuth } from "./api";
import { CLAVE_TEMA as CLAVE, COLORES_BARRA as COLOR_BARRA } from "@/lib/shared/tema";

/*
 * Apariencia: Claro, Oscuro o Automatico (sigue al sistema operativo; por
 * omision). La preferencia vive en la cuenta (servidor, para seguir a la
 * persona en cualquier computadora) y en el navegador (para aplicarla antes
 * del primer pintado con SCRIPT_TEMA, sin destellos). El tema resuelto se
 * pone en <html data-theme="light|dark">; los colores son los mismos tokens
 * con otros valores (globals.css). Impresion y PDF siempre en claro.
 */

export type Tema = "claro" | "oscuro" | "auto";
const EVENTO = "ficotox-tema";

const esTema = (v: unknown): v is Tema => v === "claro" || v === "oscuro" || v === "auto";

function leerTema(): Tema {
  try {
    const v = window.localStorage.getItem(CLAVE);
    return esTema(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

const sistemaOscuro = () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
const resolverTema = (t: Tema): "light" | "dark" => (t === "oscuro" || (t === "auto" && sistemaOscuro()) ? "dark" : "light");

/* Pone el tema en <html>. Con `animar`, los colores cambian juntos en ~200 ms (sin parpadeos uno por uno). */
function aplicarTema(t: Tema, animar = false): void {
  const raiz = document.documentElement;
  const resuelto = resolverTema(t);
  if (animar) {
    raiz.classList.add("tema-transicion");
    window.setTimeout(() => raiz.classList.remove("tema-transicion"), 260);
  }
  raiz.dataset.theme = resuelto;
  raiz.dataset.tema = t;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", COLOR_BARRA[resuelto]));
}

function fijarLocal(t: Tema, animar: boolean) {
  try {
    window.localStorage.setItem(CLAVE, t);
  } catch {
    /* sin almacenamiento: solo esta pestaña */
  }
  aplicarTema(t, animar);
  window.dispatchEvent(new Event(EVENTO));
}

/* La persona elige su apariencia: se aplica de inmediato y se guarda en su cuenta (sin bitacora). */
export function elegirTema(t: Tema, token: string | null | undefined): void {
  fijarLocal(t, true);
  if (token) void sendJsonAuth("PUT", `${API_BASE_URL}/auth/me/tema`, token, { tema: t }).catch(() => undefined);
}

/* Al entrar o refrescar la sesion: la preferencia de la cuenta manda sobre la del navegador. */
export function adoptarTemaDeCuenta(t: unknown): void {
  if (!esTema(t) || t === leerTema()) return;
  fijarLocal(t, true);
}

/* Claro <-> Oscuro (acceso rapido del menu de la cuenta), partiendo de lo que se ve ahora. */
export const temaOpuesto = (): Tema => (resolverTema(leerTema()) === "dark" ? "claro" : "oscuro");

function suscribir(aviso: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  // En Automatico, si el sistema cambia, la pagina cambia con el.
  const alSistema = () => {
    if (leerTema() === "auto") aplicarTema("auto", true);
    aviso();
  };
  window.addEventListener(EVENTO, aviso);
  window.addEventListener("storage", aviso);
  mq.addEventListener("change", alSistema);
  return () => {
    window.removeEventListener(EVENTO, aviso);
    window.removeEventListener("storage", aviso);
    mq.removeEventListener("change", alSistema);
  };
}

/* Preferencia elegida y tema que se ve. */
export function useTema(): { tema: Tema; resuelto: "light" | "dark" } {
  const tema = useSyncExternalStore(suscribir, leerTema, () => "auto" as Tema);
  const oscuro = useSyncExternalStore(suscribir, () => resolverTema(leerTema()) === "dark", () => false);
  return { tema, resuelto: oscuro ? "dark" : "light" };
}
