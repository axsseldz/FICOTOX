import { apiRoute } from "@/lib/server/http";
import { aceptarSolicitudSgc } from "@/lib/server/modules/sgc/flujo";

export const POST = apiRoute(aceptarSolicitudSgc);
