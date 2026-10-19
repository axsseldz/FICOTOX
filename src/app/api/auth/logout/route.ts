import { apiRoute } from "@/lib/server/http";
import { cerrarSesion } from "@/lib/server/modules/auth";

export const POST = apiRoute(cerrarSesion);
