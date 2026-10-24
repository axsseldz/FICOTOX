"use client";

import { ReceptionForm } from "@/components/features/samples/ReceptionForm";
import { RequiereCrear } from "@/components/session/RequiereCrear";
import { RequireModule } from "@/components/session/RequireModule";

export default function NuevaRecepcionPage() {
  return (
    <RequireModule modules="muestras">
      <RequiereCrear tipo="recepcion">
        <ReceptionForm item={null} />
      </RequiereCrear>
    </RequireModule>
  );
}
