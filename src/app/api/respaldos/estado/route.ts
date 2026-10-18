import { apiRoute } from "@/lib/server/http";
import { estadoTrabajoApi } from "@/lib/server/modules/respaldos";

export const GET = apiRoute(estadoTrabajoApi);
