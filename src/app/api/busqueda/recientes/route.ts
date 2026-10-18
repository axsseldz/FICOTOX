import { apiRoute } from "@/lib/server/http";
import { borrarRecientes, listarRecientes, registrarReciente } from "@/lib/server/modules/busqueda";

export const GET = apiRoute(listarRecientes);
export const POST = apiRoute(registrarReciente);
export const DELETE = apiRoute(borrarRecientes);
