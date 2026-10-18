import { apiRoute } from "@/lib/server/http";
import { apoyoSolicitud } from "@/lib/server/modules/sgc/flujo";

export const GET = apiRoute(apoyoSolicitud);
