import { apiRoute } from "@/lib/server/http";
import { verificarExterno } from "@/lib/server/modules/sgc/externos";

export const POST = apiRoute(verificarExterno);
