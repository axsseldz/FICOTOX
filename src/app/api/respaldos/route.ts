import { apiRoute } from "@/lib/server/http";
import { crearRespaldoPost, listarRespaldosApi } from "@/lib/server/modules/respaldos";

export const GET = apiRoute(listarRespaldosApi);
/* No pasa por apiRoute: la sesion de la base solo se retiene mientras se toma la foto de la base. */
export const POST = (request: Request) => crearRespaldoPost(request);
