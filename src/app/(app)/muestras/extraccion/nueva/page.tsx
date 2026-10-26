"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ExtractionForm } from "@/components/features/samples/ExtractionForm";
import { ExtractionTypeChooser } from "@/components/features/samples/extraction/TypeChooser";
import { RequiereCrear } from "@/components/session/RequiereCrear";
import { RequireModule } from "@/components/session/RequireModule";
import { Skeleton } from "@/components/ui/Primitives";
import { normalizeExtractionType } from "@/lib/shared/extraction";

function NuevaExtraccion() {
  const params = useSearchParams();
  const procesamiento = Number.parseInt(params.get("procesamiento") || "", 10) || null;
  const tipo = normalizeExtractionType(params.get("tipo"));
  if (!tipo) return <ExtractionTypeChooser procesamiento={procesamiento} />;
  return <ExtractionForm key={`${tipo}-${procesamiento ?? "nueva"}`} item={null} tipo={tipo} prefillProcessingId={procesamiento} />;
}

export default function NuevaExtraccionPage() {
  return (
    <RequireModule modules="ensayos">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <RequiereCrear tipo="extraccion">
          <NuevaExtraccion />
        </RequiereCrear>
      </Suspense>
    </RequireModule>
  );
}
