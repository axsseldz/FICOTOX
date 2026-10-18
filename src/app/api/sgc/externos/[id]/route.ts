import { apiRoute } from "@/lib/server/http";
import { editarExterno } from "@/lib/server/modules/sgc/externos";

export const PUT = apiRoute(editarExterno);
