import { apiRoute } from "@/lib/server/http";
import { crearDocumento, listarDocumentos } from "@/lib/server/modules/sgc/documentos";

export const GET = apiRoute(listarDocumentos);
export const POST = apiRoute(crearDocumento);
