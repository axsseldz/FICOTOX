import { prepararDescarga } from "@/lib/server/modules/respaldos-portables";

/* No pasa por apiRoute: la clave de cifrado se deriva sin retener la base (la sesion solo se toma para permisos y reautenticacion). */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return prepararDescarga(request, await ctx.params);
}
