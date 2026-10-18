"use client";

import { ApiError } from "@/lib/client/api";

/* Descarga un archivo protegido por URL con el nombre dado. */
export async function descargarUrl(urlArchivo: string, token: string, nombre: string): Promise<void> {
  const res = await fetch(urlArchivo, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data, "No se pudo descargar el archivo");
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre || "documento";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/* Imprime un PDF: blob en un iframe oculto y print() del visor del navegador. */
export async function imprimirPdfUrl(urlArchivo: string, token: string): Promise<void> {
  const res = await fetch(urlArchivo, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data, "No se pudo preparar la impresión");
  }
  const url = URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: "application/pdf" }));
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  iframe.src = url;
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      window.setTimeout(() => {
        iframe.remove();
        URL.revokeObjectURL(url);
      }, 60_000);
    }
  };
  document.body.appendChild(iframe);
}
