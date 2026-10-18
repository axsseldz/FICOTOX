"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/*
 * Los respaldos viven en Calidad › Respaldos. La ruta anterior
 * (Administración › Respaldos) lleva a la nueva para no romper enlaces guardados.
 */
export default function RespaldosRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/calidad/respaldos");
  }, [router]);
  return null;
}
