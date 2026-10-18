import { apiRoute } from "@/lib/server/http";
import { listarRegistrosCalidad } from "@/lib/server/modules/calidad/lista";

export const GET = apiRoute(listarRegistrosCalidad);
