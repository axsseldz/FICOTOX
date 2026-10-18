import { apiRoute } from "@/lib/server/http";
import { revisarRevision } from "@/lib/server/modules/sgc/flujo";

export const POST = apiRoute(revisarRevision);
