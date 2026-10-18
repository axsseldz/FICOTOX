import Link from "next/link";
import { BrandLockup } from "@/components/shell/Brand";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <BrandLockup />
      <div className="flex flex-col gap-2">
        <h1 className="display text-[36px] text-ink">Esta página no existe</h1>
        <p className="max-w-sm text-[14px] text-ink-3">Revisa la dirección o vuelve al inicio y usa la búsqueda.</p>
      </div>
      <Link href="/" className="press inline-flex h-10 items-center rounded-[10px] bg-brand px-5 text-[14px] font-medium text-on-accent hover:bg-brand-strong">
        Ir al inicio
      </Link>
    </main>
  );
}
