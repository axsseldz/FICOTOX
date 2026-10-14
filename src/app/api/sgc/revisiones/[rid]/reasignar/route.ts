import { apiRoute } from "@/lib/server/http";
import { reasignarRevision } from "@/lib/server/modules/sgc/flujo";

export const POST = apiRoute(reasignarRevision);
