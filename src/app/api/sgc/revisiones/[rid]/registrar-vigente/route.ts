import { apiRoute } from "@/lib/server/http";
import { registrarVigente } from "@/lib/server/modules/sgc/documentos";

export const POST = apiRoute(registrarVigente);
