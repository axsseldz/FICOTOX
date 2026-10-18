import { apiRoute } from "@/lib/server/http";
import { listarExternos, registrarExterno } from "@/lib/server/modules/sgc/externos";

export const GET = apiRoute(listarExternos);
export const POST = apiRoute(registrarExterno);
