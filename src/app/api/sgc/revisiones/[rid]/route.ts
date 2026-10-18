import { apiRoute } from "@/lib/server/http";
import { editarRevision } from "@/lib/server/modules/sgc/documentos";

export const PUT = apiRoute(editarRevision);
