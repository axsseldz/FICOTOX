import { apiRoute } from "@/lib/server/http";
import { archivoSgc } from "@/lib/server/modules/sgc/documentos";

export const GET = apiRoute(archivoSgc);
