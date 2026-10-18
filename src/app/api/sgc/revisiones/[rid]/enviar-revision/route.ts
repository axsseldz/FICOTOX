import { apiRoute } from "@/lib/server/http";
import { enviarRevision } from "@/lib/server/modules/sgc/documentos";

export const POST = apiRoute(enviarRevision);
