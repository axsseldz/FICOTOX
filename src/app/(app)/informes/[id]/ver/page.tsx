"use client";

import { use } from "react";
import { VisorInforme } from "@/components/features/informes/VisorInforme";
import { RecordLoader } from "@/components/features/samples/RecordLoader";
import { RequireModule } from "@/components/session/RequireModule";

/* Lectura del PDF final del informe, a pantalla completa. */
export default function VerInformePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireModule modules="informes">
      <RecordLoader url={`/informes/${id}`} keys={["informes"]}>{(item) => <VisorInforme key={String(item.id)} item={item} />}</RecordLoader>
    </RequireModule>
  );
}
