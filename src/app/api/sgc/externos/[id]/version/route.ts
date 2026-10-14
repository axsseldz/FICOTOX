import { apiRoute } from "@/lib/server/http";
import { nuevaVersionExterno } from "@/lib/server/modules/sgc/externos";

export const POST = apiRoute(nuevaVersionExterno);
