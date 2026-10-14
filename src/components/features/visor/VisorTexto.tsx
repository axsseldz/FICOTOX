"use client";

import { useEffect, useState } from "react";
import { ErrorState, Skeleton } from "@/components/ui/Primitives";
import { explicarError } from "@/lib/client/mensajes";
import { ESTILOS_LECTURA } from "./lectura";
import { useArchivo } from "./usarArchivo";

const decodificar = (datos: ArrayBuffer) => new TextDecoder("utf-8").decode(datos).replace(/^﻿/, "");

/* txt: texto legible con saltos de linea. md: Markdown renderizado con marked y saneado con DOMPurify. */
export function VisorTexto({ url, markdown }: { url: string; markdown: boolean }) {
  const { datos, error, cargando } = useArchivo(url);
  const [html, setHtml] = useState<string | null>(null);
  const texto = datos ? decodificar(datos) : null;
  useEffect(() => {
    if (!markdown || texto === null) return;
    let vivo = true;
    (async () => {
      const [{ marked }, { default: DOMPurify }] = await Promise.all([import("marked"), import("dompurify")]);
      const crudo = await marked.parse(texto, { gfm: true, breaks: false });
      if (vivo) setHtml(DOMPurify.sanitize(crudo, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form", "input", "button", "iframe"], ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|#)/i }));
    })();
    return () => {
      vivo = false;
    };
  }, [markdown, texto]);
  if (error) return <div className="p-6"><ErrorState message={explicarError(error, "No se pudo abrir el archivo de texto").que} /></div>;
  return (
    <div className="scroll-thin h-full min-h-0 overflow-auto bg-surface-3/70 py-6 sm:px-4" data-testid="visor-texto">
      <style>{ESTILOS_LECTURA}</style>
      {cargando || texto === null || (markdown && html === null) ? (
        <div className="mx-auto max-w-[760px]"><Skeleton className="h-[420px] w-full" /></div>
      ) : markdown ? (
        <article className="visor-lectura" dangerouslySetInnerHTML={{ __html: html || "" }} />
      ) : (
        <article className="visor-lectura">
          <pre className="m-0 whitespace-pre-wrap break-words bg-transparent p-0 font-mono text-[14px] leading-relaxed text-ink">{texto}</pre>
        </article>
      )}
    </div>
  );
}
