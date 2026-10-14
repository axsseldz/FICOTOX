"use client";

import { DownloadSimple, File, FileArchive, FilePpt, FileImage } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { fmtBytes, huellaCorta } from "@/lib/shared/adjuntos";

/* pptx, zip, tif y otros sin vista previa: ficha con la informacion y "Descargar". */
export function FichaArchivo({ version, onDescargar, descargando }: { version: { nombre_original: string; extension: string; tamano_bytes: number; sha256: string }; onDescargar: () => void; descargando: boolean }) {
  const ext = String(version.extension).toLowerCase();
  const Icono = ext === "pptx" ? FilePpt : ext === "zip" ? FileArchive : ext === "tif" || ext === "tiff" ? FileImage : File;
  const porque = ext === "tif" || ext === "tiff" ? "Los navegadores no muestran imágenes TIFF." : ext === "pptx" ? "Las presentaciones no tienen vista previa en la plataforma." : ext === "zip" ? "Los archivos comprimidos no se abren en la plataforma." : "Este tipo de archivo no tiene vista previa.";
  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-auto bg-surface-3/70 p-6" data-testid="visor-ficha">
      <div className="flex w-full max-w-[420px] flex-col items-center gap-4 rounded-card bg-surface p-8 text-center shadow-card">
        <span className="flex h-16 w-16 items-center justify-center rounded-[16px] bg-brand-faint text-brand-strong" aria-hidden="true">
          <Icono size={34} weight="duotone" />
        </span>
        <div className="flex flex-col gap-1">
          <p className="break-all text-[15px] font-semibold text-ink">{version.nombre_original}</p>
          <p className="text-[13px] text-ink-3">
            .{ext} · {fmtBytes(Number(version.tamano_bytes))} · SHA-256 <span title={version.sha256}>{huellaCorta(version.sha256)}</span>
          </p>
        </div>
        <p className="text-[13.5px] text-ink-2">{porque} Descárgalo para abrirlo con su programa.</p>
        <Button icon={<DownloadSimple size={16} />} onClick={onDescargar} loading={descargando}>
          Descargar
        </Button>
      </div>
    </div>
  );
}
