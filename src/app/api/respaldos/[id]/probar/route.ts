import { probarRestauracionPost } from "@/lib/server/modules/respaldos";

/* No pasa por apiRoute: la prueba corre en un proceso aparte y la peticion responde enseguida. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return probarRestauracionPost(request, await ctx.params);
}
