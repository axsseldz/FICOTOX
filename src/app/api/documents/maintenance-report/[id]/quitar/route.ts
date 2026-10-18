import { apiRoute } from "@/lib/server/http";
import { quitarReporteMantenimiento } from "@/lib/server/modules/documents";

export const POST = apiRoute(quitarReporteMantenimiento);
