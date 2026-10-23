import { apiRoute } from "@/lib/server/http";
import { prepararDescarga } from "@/lib/server/modules/respaldos-portables";

export const POST = apiRoute(prepararDescarga);
