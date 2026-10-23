import { trozoImportar } from "@/lib/server/modules/respaldos-portables";

/* No pasa por apiRoute: el trozo se escribe en disco en flujo, sin retener la base. */
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return trozoImportar(request, await ctx.params);
}
