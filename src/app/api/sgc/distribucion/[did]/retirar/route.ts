import { apiRoute } from "@/lib/server/http";
import { retirarDistribucion } from "@/lib/server/modules/sgc/lecturas";

export const POST = apiRoute(retirarDistribucion);
