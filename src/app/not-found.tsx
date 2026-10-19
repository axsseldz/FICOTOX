import Link from "next/link";
import { BrandLockup } from "@/components/shell/Brand";
import { buttonClass } from "@/components/ui/boton";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <BrandLockup />
      <div className="flex flex-col gap-2">
        <h1 className="display text-5xl text-ink">Esta página no existe</h1>
        <p className="max-w-sm text-base text-ink-3">Revisa la dirección o vuelve al inicio y usa la búsqueda.</p>
      </div>
      <Link href="/" className={buttonClass()}>
        Ir al inicio
      </Link>
    </main>
  );
}
