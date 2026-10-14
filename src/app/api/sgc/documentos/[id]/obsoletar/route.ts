import { apiRoute } from "@/lib/server/http";
import { solicitarObsolescencia } from "@/lib/server/modules/sgc/flujo";

export const POST = apiRoute(solicitarObsolescencia);
