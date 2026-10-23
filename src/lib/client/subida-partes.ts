import { ApiError } from "./api";
import type { ApiRecord } from "./types";

/*
 * Subida por partes de un archivo grande (respaldo .ficotox): el servidor
 * recibe cada cuerpo completo en memoria y lo corta a ~52 MB, asi que el
 * archivo va en trozos del tamaño que indica el servidor, en orden, con su
 * avance. La subida se inicia aparte (POST que devuelve { id, trozo }); aqui
 * solo se mandan los trozos con PUT <url>/<id>?desde=N.
 */
export async function subirPorPartes(opciones: { url: string; id: string; trozo: number; archivo: File; encabezados?: Record<string, string>; alAvance?: (fraccion: number) => void; senal?: AbortSignal }): Promise<void> {
  const { url, id, trozo, archivo, encabezados = {}, alAvance, senal } = opciones;
  const total = archivo.size;
  for (let desde = 0; desde < total; desde += trozo) {
    const parte = archivo.slice(desde, Math.min(total, desde + trozo));
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `${url}/${id}?desde=${desde}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      for (const [k, v] of Object.entries(encabezados)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && alAvance) alAvance((desde + event.loaded) / total);
      };
      const cancelar = () => xhr.abort();
      senal?.addEventListener("abort", cancelar, { once: true });
      xhr.onload = () => {
        senal?.removeEventListener("abort", cancelar);
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        let datos: ApiRecord = {};
        try {
          datos = JSON.parse(xhr.responseText || "{}");
        } catch {
          datos = {};
        }
        reject(new ApiError(xhr.status, datos, "No se pudo subir el archivo"));
      };
      xhr.onerror = () => reject(new Error("No se pudo subir el archivo (conexión interrumpida). Vuelve a intentarlo."));
      xhr.onabort = () => reject(new Error("Se canceló la subida"));
      xhr.send(parte);
    });
  }
  alAvance?.(1);
}
