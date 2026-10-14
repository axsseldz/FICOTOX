import { apiRoute } from "@/lib/server/http";
import { subirArchivo } from "@/lib/server/modules/sgc/documentos";

export const POST = apiRoute(subirArchivo);
