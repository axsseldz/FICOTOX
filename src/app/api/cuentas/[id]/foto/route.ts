import { apiRoute } from "@/lib/server/http";
import { servirFoto } from "@/lib/server/modules/fotos";

export const GET = apiRoute(servirFoto);
