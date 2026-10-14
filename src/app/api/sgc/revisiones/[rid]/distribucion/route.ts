import { apiRoute } from "@/lib/server/http";
import { agregarDistribucion } from "@/lib/server/modules/sgc/lecturas";

export const POST = apiRoute(agregarDistribucion);
