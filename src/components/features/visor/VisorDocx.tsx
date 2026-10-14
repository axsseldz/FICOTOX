"use client";

import { useEffect, useState } from "react";
import { Callout } from "@/components/features/samples/FormLayout";
import { ErrorState, Skeleton } from "@/components/ui/Primitives";
import { explicarError } from "@/lib/client/mensajes";
import { ESTILOS_LECTURA } from "./lectura";
import { useArchivo } from "./usarArchivo";

/* docx: vista previa de solo lectura convertida a HTML con mammoth y saneada con DOMPurify. */
export function VisorDocx({ url }: { url: string }) {
  const { datos, error } = useArchivo(url);
  const [html, setHtml] = useState<{ id: string; html: string; avisos: number } | null>(null);
  const [fallo, setFallo] = useState<unknown>(null);
  useEffect(() => {
    if (!datos) return;
    let vivo = true;
    (async () => {
      try {
        const [{ default: mammoth }, { default: DOMPurify }] = await Promise.all([import("mammoth"), import("dompurify")]);
        const r = await mammoth.convertToHtml({ arrayBuffer: datos.slice(0) });
        // Imagenes incrustadas como data: (las genera mammoth); nada de scripts, estilos ni enlaces activos.
        const limpio = DOMPurify.sanitize(r.value, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form", "input", "button"], ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|data:image\/(?:png|jpe?g|gif|webp);|#)/i });
        if (vivo) setHtml({ id: url, html: limpio, avisos: r.messages.length });
      } catch (err) {
        if (vivo) setFallo(err);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [datos, url]);
  if (error || fallo) return <div className="p-6"><ErrorState message={explicarError(error || fallo, "No se pudo mostrar el documento de Word").que} /></div>;
  return (
    <div className="scroll-thin h-full min-h-0 overflow-auto bg-surface-3/70 py-6 sm:px-4" data-testid="visor-docx">
      <style>{ESTILOS_LECTURA}</style>
      {!html || html.id !== url ? (
        <div className="mx-auto max-w-[760px]"><Skeleton className="h-[480px] w-full" /></div>
      ) : (
        <>
          <p className="mx-auto mb-3 max-w-[760px] px-4 text-[12.5px] text-ink-3 sm:px-0">Vista previa de solo lectura: el formato puede variar respecto a Word. Para el original, usa «Descargar».</p>
          {html.avisos ? (
            <div className="mx-auto mb-3 max-w-[760px] px-4 sm:px-0">
              <Callout tone="info">Algunos elementos del documento no se pueden mostrar en la vista previa.</Callout>
            </div>
          ) : null}
          <article className="visor-lectura" dangerouslySetInnerHTML={{ __html: html.html }} />
        </>
      )}
    </div>
  );
}
