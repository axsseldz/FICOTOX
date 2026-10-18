import { apiRoute } from "@/lib/server/http";
import { crearSolicitudSgc, listarSolicitudesSgc } from "@/lib/server/modules/sgc/flujo";

export const GET = apiRoute(listarSolicitudesSgc);
export const POST = apiRoute(crearSolicitudSgc);
