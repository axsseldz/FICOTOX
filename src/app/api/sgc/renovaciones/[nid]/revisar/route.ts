import { apiRoute } from "@/lib/server/http";
import { revisarRenovacion } from "@/lib/server/modules/sgc/flujo";

export const POST = apiRoute(revisarRenovacion);
