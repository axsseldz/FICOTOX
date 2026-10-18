import { apiRoute } from "@/lib/server/http";
import { quitarMiFoto, subirMiFoto, usarMiFoto } from "@/lib/server/modules/fotos";

export const POST = apiRoute(subirMiFoto);
export const PUT = apiRoute(usarMiFoto);
export const DELETE = apiRoute(quitarMiFoto);
