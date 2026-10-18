"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PageBody } from "@/components/shell/AppShell";
import { useSession } from "@/components/session/SessionProvider";
import { LinkTabs, PageHeader } from "@/components/ui/PageHeader";
import { INVENTORY_TABS } from "@/lib/client/nav";

/* Cada pestaña de inventario tiene su propio titulo; el control segmentado permite saltar entre ellas. */
const META: Record<string, { title: string; description: string }> = {
  "/inventario/reactivos": { title: "Reactivos", description: "Reactivos, solventes y materiales de referencia con su existencia y caducidad." },
  "/inventario/consumibles": { title: "Consumibles", description: "Material de un solo uso: unidades disponibles y descuentos." },
  "/inventario/equipos": { title: "Equipos", description: "Equipos del laboratorio, su clave de bitácora y estado de calibración." },
  "/inventario/mantenimiento": { title: "Mantenimiento", description: "Lo que está programado, en proceso o vencido. Al completarse, el equipo vuelve a operativo y el registro pasa al historial (filtro Completados)." },
};

export default function InventarioLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { can } = useSession();
  const tabs = INVENTORY_TABS.filter((tab) => !!tab.module && can(tab.module)).map((tab) => ({ href: tab.href, label: tab.label }));
  const meta = Object.entries(META).find(([href]) => pathname === href || pathname.startsWith(`${href}/`))?.[1] || { title: "Inventario", description: "Reactivos, consumibles, equipos y su mantenimiento." };
  return (
    <PageBody>
      <PageHeader title={meta.title} description={meta.description} />
      {tabs.length > 1 ? <LinkTabs className="lg:hidden" items={tabs} /> : null}
      {children}
    </PageBody>
  );
}
