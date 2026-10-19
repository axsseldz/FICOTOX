"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { X } from "@phosphor-icons/react";
import { descargarUrl, imprimirPdfUrl } from "@/components/features/visor/usarArchivo";
import { VisorPdf } from "@/components/features/visor/VisorPdf";
import { useSession } from "@/components/session/SessionProvider";
import { IconButton } from "@/components/ui/Button";
import { explicarError } from "@/lib/client/mensajes";
import { EVENTO_VER_PDF, type PeticionVerPdf } from "@/lib/client/files";

/*
 * Visor interno para los PDF protegidos que no tienen su propia pantalla (reportes
 * de mantenimiento, PDF de no conformidades): el mismo visor pdf.js de la
 * ficha de Documentos SGC, a pantalla completa sobre la plataforma. Sin pestaña nueva y sin
 * descarga automatica: Descargar e Imprimir son botones de la barra del visor.
 */
export function VisorPdfFlotante() {
  const { token } = useSession();
  const [peticion, setPeticion] = useState<PeticionVerPdf | null>(null);

  useEffect(() => {
    const abrir = (event: Event) => setPeticion((event as CustomEvent<PeticionVerPdf>).detail);
    window.addEventListener(EVENTO_VER_PDF, abrir);
    return () => window.removeEventListener(EVENTO_VER_PDF, abrir);
  }, []);

  useEffect(() => {
    if (!peticion) return;
    const tecla = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPeticion(null);
      peticion.alCerrar?.();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [peticion]);

  if (!peticion) return null;
  const cerrar = () => {
    setPeticion(null);
    peticion.alCerrar?.();
  };
  const descargar = async () => {
    try {
      await descargarUrl(peticion.url, token, peticion.nombre);
    } catch (err) {
      const e = explicarError(err, "No se pudo descargar el PDF");
      toast.error(e.que, { description: e.hacer });
    }
  };
  const imprimir = async () => {
    try {
      await imprimirPdfUrl(peticion.url, token);
    } catch (err) {
      toast.error(explicarError(err, "No se pudo preparar la impresión").que);
    }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label={peticion.titulo || peticion.nombre} className="fixed inset-0 z-[var(--z-ventana)] flex flex-col bg-canvas" data-visor data-visor-pdf-flotante>
      <header className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2 sm:px-4">
        <h1 className="min-w-0 flex-1 truncate text-md font-semibold tracking-snug text-ink">{peticion.titulo || peticion.nombre}</h1>
        <IconButton label="Cerrar" onClick={cerrar}>
          <X size={17} />
        </IconButton>
      </header>
      <div className="min-h-0 min-w-0 flex-1" data-visor-contenido>
        <VisorPdf key={peticion.url} url={peticion.url} ambito="pdf-interno" docId={peticion.url} acciones={{ descargar, imprimir }} />
      </div>
    </div>
  );
}
