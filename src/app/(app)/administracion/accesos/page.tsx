"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/*
 * Revisión de accesos se integró en Administración › Usuarios (accesos rápidos,
 * filtros y la ventana de cada persona). Los cambios del periodo se consultan en
 * Auditoría. La ruta anterior lleva a Usuarios para no romper enlaces guardados.
 */
export default function AccesosRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/administracion/usuarios");
  }, [router]);
  return null;
}
