import { apiRoute } from "@/lib/server/http";
import { marcarLeidas } from "@/lib/server/modules/notificaciones";

export const POST = apiRoute(marcarLeidas);
