import { apiRoute } from "@/lib/server/http";
import { nuevaRevision } from "@/lib/server/modules/sgc/documentos";

export const POST = apiRoute(nuevaRevision);
