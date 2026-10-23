import { descargarArchivo } from "@/lib/server/modules/respaldos-portables";

/* No pasa por apiRoute: el archivo sale en flujo; el token de un solo uso es la autorizacion. */
export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  return descargarArchivo(request, await ctx.params);
}
