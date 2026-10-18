import { apiRoute } from "@/lib/server/http";
import { rechazarSolicitudSgc } from "@/lib/server/modules/sgc/flujo";

export const POST = apiRoute(rechazarSolicitudSgc);
