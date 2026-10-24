"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { InformeForm } from "@/components/features/informes/InformeForm";
import { RequiereCrear } from "@/components/session/RequiereCrear";
import { RequireModule } from "@/components/session/RequireModule";
import { Skeleton } from "@/components/ui/Primitives";

function NuevoInforme() {
  const params = useSearchParams();
  const recepcion = Number.parseInt(params.get("recepcion") || "", 10) || null;
  return <InformeForm key={recepcion ?? "nuevo"} item={null} prefillRecepcionId={recepcion} />;
}

export default function NuevoInformePage() {
  return (
    <RequireModule modules="informes">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <RequiereCrear tipo="informe">
          <NuevoInforme />
        </RequiereCrear>
      </Suspense>
    </RequireModule>
  );
}
