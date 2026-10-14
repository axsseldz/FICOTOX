import { apiRoute } from "@/lib/server/http";
import { publicarRevision } from "@/lib/server/modules/sgc/flujo";

export const POST = apiRoute(publicarRevision);
