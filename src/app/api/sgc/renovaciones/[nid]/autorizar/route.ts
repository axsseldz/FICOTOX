import { apiRoute } from "@/lib/server/http";
import { autorizarRenovacion } from "@/lib/server/modules/sgc/flujo";

export const POST = apiRoute(autorizarRenovacion);
