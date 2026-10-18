import { apiRoute } from "@/lib/server/http";
import { autorizarRevision } from "@/lib/server/modules/sgc/flujo";

export const POST = apiRoute(autorizarRevision);
