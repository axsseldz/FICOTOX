import { apiRoute } from "@/lib/server/http";
import { bandejaSgc } from "@/lib/server/modules/sgc/flujo";

export const GET = apiRoute(bandejaSgc);
