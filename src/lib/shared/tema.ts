/*
 * Constantes del tema que tambien usa el servidor (layout raiz): clave del
 * navegador, color de la barra del navegador por tema y el script en linea
 * del <head> que aplica el tema guardado antes del primer pintado (nunca un
 * destello blanco en oscuro). Sin preferencia: el del sistema.
 */
export const CLAVE_TEMA = "ficotox-tema";

/* meta theme-color: el lienzo de cada tema. */
export const COLORES_BARRA = { light: "#f2f4f7", dark: "#0c1319" } as const;

export const SCRIPT_TEMA = `(function(){try{var t=localStorage.getItem("${CLAVE_TEMA}");if(t!=="claro"&&t!=="oscuro")t="auto";var d=t==="oscuro"||(t==="auto"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.dataset.theme=d?"dark":"light";r.dataset.tema=t;}catch(e){}})();`;
