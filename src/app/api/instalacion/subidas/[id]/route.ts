import { trozoInstalacion } from "@/lib/server/modules/instalacion";

/* El trozo se escribe en disco en flujo (sin apiRoute: no se retiene la base). */
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return trozoInstalacion(request, await ctx.params);
}
