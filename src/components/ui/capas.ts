/*
 * Clases compartidas de las capas (sin dependencias, para que Overlay,
 * Validacion y las ventanas las importen sin ciclos).
 */

/* Velo (único para hojas, diálogos, ventanas y el buscador): oscurece y difumina el fondo para enfocar la tarea. */
export const VELO_VENTANA = "fixed inset-0 z-[var(--z-ventana)] bg-deep/40 backdrop-blur-sm data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out";
/* Título y descripción de toda ventana (Sheet, Dialog, VentanaCentrada, VentanaFormulario, avisos de validación). */
export const TITULO_VENTANA = "title-2 leading-snug text-ink";
export const DESCRIPCION_VENTANA = "text-sm leading-normal text-ink-3";
