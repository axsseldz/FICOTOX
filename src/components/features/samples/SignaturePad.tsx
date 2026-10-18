"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Eraser, PaintBrush, UploadSimple } from "@phosphor-icons/react";
import { cn } from "@/components/ui/cn";
import { useFormReadOnly } from "./FormLayout";

/*
 * Lienzo de firma: subir una imagen o dibujar con el puntero.
 * El valor es un data URL PNG; vacio significa sin firma.
 * El lienzo y la vista de la firma van sobre papel claro (bg-papel) y la tinta
 * es siempre oscura, en cualquier tema: la imagen guardada no cambia (PDF).
 */

const drawPlaceholder = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.fillStyle = "#9aabb7";
  ctx.font = "500 15px -apple-system, BlinkMacSystemFont, Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Firma aquí o sube una imagen", canvas.width / 2, canvas.height / 2 + 5);
  ctx.restore();
};

export function SignaturePad({ value, onChange, label, disabled: disabledProp = false, compact = false }: { value: string; onChange: (dataUrl: string) => void; label?: string; disabled?: boolean; compact?: boolean }) {
  // En un formato en solo lectura el lienzo se convierte en una vista de la firma (o "Sin firma").
  const readOnly = useFormReadOnly();
  const disabled = disabledProp || readOnly;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const drawingRef = useRef(false);
  const lastDrawn = useRef<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const isEmpty = !value && !drawing;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (lastDrawn.current === value) return;
    lastDrawn.current = value;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!value) {
      drawPlaceholder(canvas);
      return;
    }
    const image = new Image();
    image.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      ctx.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    };
    image.src = value;
  }, [value]);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * canvas.width, y: ((event.clientY - rect.top) / rect.height) * canvas.height };
  };

  const start = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.setPointerCapture(event.pointerId);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0b1f2a";
    drawingRef.current = true;
    setDrawing(true);
    if (isEmpty) ctx.clearRect(0, 0, canvas.width, canvas.height);
    const { x, y } = point(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    event.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stop = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    lastDrawn.current = dataUrl;
    setDrawing(false);
    onChange(dataUrl);
  };

  const handleFile = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result || ""));
    reader.readAsDataURL(file);
  };

  if (readOnly) {
    return value ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={value} alt={label || "Firma"} className={cn("w-full rounded-[10px] bg-papel object-contain p-1 ring-1 ring-line", compact ? "h-[96px] max-w-[300px]" : "h-[120px] max-w-[360px]")} />
    ) : (
      <p className="flex h-9 items-center rounded-[10px] bg-surface-2 px-3 text-[13.5px] text-ink-4">Sin firma</p>
    );
  }

  // El lienzo mantiene 3:1; en modo compacto cabe junto a los campos de nombre y cargo.
  return (
    <div className={cn("flex flex-col gap-1.5", !compact && "max-w-[420px]")}>
      <div className={cn("relative overflow-hidden rounded-[10px] border bg-papel transition-colors", isEmpty ? "border-dashed border-line-strong" : "border-line")}>
        <canvas ref={canvasRef} width={480} height={160} aria-label={label || "Lienzo de firma"} className={`block aspect-[3/1] w-full touch-none ${disabled ? "cursor-default" : "cursor-crosshair"}`} onPointerDown={disabled ? undefined : start} onPointerMove={disabled ? undefined : move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} />
      </div>
      <div className="flex items-center gap-1">
        <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={handleFile} aria-label={`Subir imagen de ${label}`} />
        <button type="button" disabled={disabled} onClick={() => fileRef.current?.click()} className="press inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-[12px] font-medium text-ink-3 hover:bg-surface-3 hover:text-ink">
          <UploadSimple size={13} /> Subir imagen
        </button>
        <button type="button" onClick={() => onChange("")} disabled={disabled || !value} className="press inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-[12px] font-medium text-ink-3 hover:bg-surface-3 hover:text-danger disabled:opacity-40">
          <Eraser size={13} /> Limpiar
        </button>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-ink-4">
          <PaintBrush size={11} /> Pincel
        </span>
      </div>
    </div>
  );
}
