import { toast } from "sonner";

/* Pide al visor interno (VisorPdfFlotante, montado en el AppShell) que muestre un PDF protegido por token. */
export const EVENTO_VER_PDF = "ficotox:ver-pdf";
export interface PeticionVerPdf {
  url: string;
  /* Nombre con que se descarga si la persona pulsa Descargar. */
  nombre: string;
  titulo?: string;
  /* Se llama al cerrar el visor (p. ej. para volver a abrir la ventana desde la que se pidio). */
  alCerrar?: () => void;
}

/*
 * Ver un PDF dentro de la plataforma: sin pestaña nueva y sin descarga
 * automatica; descargar es una accion explicita del visor.
 */
export function verPdf(url: string, nombre: string, titulo?: string, alCerrar?: () => void): void {
  window.dispatchEvent(new CustomEvent<PeticionVerPdf>(EVENTO_VER_PDF, { detail: { url, nombre, titulo, alCerrar } }));
}

/*
 * Abre en una pestaña nueva un archivo protegido por token que no es un PDF
 * (por ejemplo, la evidencia de un envio, que puede ser una imagen): se baja
 * con el encabezado Authorization y se muestra desde un blob local. Solo se
 * descarga si el navegador bloquea la pestaña nueva.
 */
export async function openProtectedFile(url: string, token: string, filename?: string): Promise<void> {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      let message = `No se pudo abrir el archivo (${res.status})`;
      try {
        const data = await res.json();
        if (data?.message) message = String(data.message);
      } catch {
        /* sin cuerpo JSON */
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    // Sin "noopener" en las caracteristicas: con ese valor window.open siempre devuelve null y se descargaria ademas.
    const opened = window.open(objectUrl, "_blank");
    if (opened) opened.opener = null;
    else {
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename || "archivo";
      link.click();
    }
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "No se pudo abrir el archivo");
  }
}
