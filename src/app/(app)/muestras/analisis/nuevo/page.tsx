"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AnalysisForm } from "@/components/features/samples/AnalysisForm";
import { RequiereCrear } from "@/components/session/RequiereCrear";
import { RequireModule } from "@/components/session/RequireModule";
import { Skeleton } from "@/components/ui/Primitives";

function NuevoAnalisis() {
  const params = useSearchParams();
  const extraccion = Number.parseInt(params.get("extraccion") || "", 10) || null;
  return <AnalysisForm key={extraccion ?? "nuevo"} item={null} prefillExtraccionId={extraccion} />;
}

export default function NuevoAnalisisPage() {
  return (
    <RequireModule modules="ensayos">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <RequiereCrear tipo="analisis">
          <NuevoAnalisis />
        </RequiereCrear>
      </Suspense>
    </RequireModule>
  );
}
