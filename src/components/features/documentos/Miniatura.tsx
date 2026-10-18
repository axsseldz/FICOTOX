"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "@/components/session/SessionProvider";
import { cn } from "@/components/ui/cn";
import { API_BASE_URL, getJsonAuth } from "@/lib/client/api";
import { abrirPdfUrl, miniaturaPrimeraPagina, urlArchivoSgc } from "@/lib/client/pdf";
import type { DocLista, FichaDocumento } from "./comun";
import { ICONO_TIPO, ICONO_TIPO_RESPALDO } from "./iconos";

/*
 * Miniatura de la primera pagina del PDF vigente de una tarjeta: se genera en
 * el navegador con pdf.js solo cuando la tarjeta se acerca a la vista, de dos
 * en dos, y queda en memoria mientras dura la sesion.
 *
 * Abrir el PDF vigente no es neutro en el servidor: para un destinatario, la
 * primera apertura cuenta como "abrio el documento" (requisito para confirmar
 * la lectura), y en un restringido o confidencial cada apertura queda en la
 * bitacora. Por eso no hay miniatura en esos casos: la tarjeta muestra el icono
 * del tipo documental y la apertura sigue ocurriendo solo en el visor.
 */

const cache = new Map<string, string | null>();
const enCurso = new Map<string, Promise<string | null>>();
let activos = 0;
const cola: Array<() => void> = [];
const turno = () =>
  new Promise<void>((listo) => {
    if (activos < 2) {
      activos += 1;
      listo();
    } else
      cola.push(() => {
        activos += 1;
        listo();
      });
  });
const liberar = () => {
  activos -= 1;
  cola.shift()?.();
};

async function generar(docId: number, token: string): Promise<string | null> {
  const ficha = (await getJsonAuth(`${API_BASE_URL}/sgc/documentos/${docId}`, token)) as unknown as FichaDocumento;
  if (ficha.item.confidencialidad !== "uso_interno" || ficha.distribucion?.mi_lectura) return null;
  const vigente = ficha.revisiones.find((r) => r.estado === "vigente");
  const pdf = vigente?.abrir ? vigente.archivos.find((a) => a.tipo === "pdf" && !a.reemplazado_en) : null;
  if (!pdf) return null;
  const doc = await abrirPdfUrl(urlArchivoSgc(pdf.id), token);
  try {
    return await miniaturaPrimeraPagina(doc, 320);
  } finally {
    void doc.loadingTask.destroy();
  }
}

function miniaturaDe(docId: number, revId: number, token: string): Promise<string | null> {
  const clave = `${docId}:${revId}`;
  if (cache.has(clave)) return Promise.resolve(cache.get(clave) ?? null);
  const pendiente = enCurso.get(clave);
  if (pendiente) return pendiente;
  const p = (async () => {
    await turno();
    try {
      const url = await generar(docId, token);
      cache.set(clave, url);
      return url;
    } catch {
      // Si falla (sin red, archivo faltante), la tarjeta se queda con el icono; no se reintenta en esta sesion.
      cache.set(clave, null);
      return null;
    } finally {
      enCurso.delete(clave);
      liberar();
    }
  })();
  enCurso.set(clave, p);
  return p;
}

export function MiniaturaDocumento({ doc, className }: { doc: DocLista; className?: string }) {
  const { token } = useSession();
  const ref = useRef<HTMLDivElement | null>(null);
  const vigenteId = doc.vigente?.id ?? null;
  // Solo vale la pena pedirla si hay vigente y el documento es de uso interno (lo demas se resuelve con el icono, sin red).
  const candidata = vigenteId !== null && doc.confidencialidad === "uso_interno";
  const clave = vigenteId !== null ? `${doc.id}:${vigenteId}` : "";
  const [url, setUrl] = useState<string | null>(() => (clave ? (cache.get(clave) ?? null) : null));

  useEffect(() => {
    const el = ref.current;
    if (!el || !candidata || !token || vigenteId === null || cache.has(clave)) return;
    let vivo = true;
    const io = new IntersectionObserver(
      (entradas) => {
        if (!entradas.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void miniaturaDe(doc.id, vigenteId, token).then((u) => {
          if (vivo) setUrl(u);
        });
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => {
      vivo = false;
      io.disconnect();
    };
  }, [candidata, clave, doc.id, token, vigenteId]);

  const Tipo = ICONO_TIPO[doc.tipo_codigo] ?? ICONO_TIPO_RESPALDO;
  return (
    <div ref={ref} className={cn("relative overflow-hidden bg-surface-2", className)} data-testid="sgc-miniatura" data-con-imagen={url ? "1" : "0"}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- miniatura generada en el navegador (data URL)
        <img src={url} alt="" className="miniatura-entrada h-full w-full object-cover object-top" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-ink-4" aria-hidden="true">
          <Tipo size={34} weight="duotone" />
        </span>
      )}
    </div>
  );
}
