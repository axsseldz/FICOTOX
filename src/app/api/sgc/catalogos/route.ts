import { apiRoute } from "@/lib/server/http";
import { obtenerCatalogos } from "@/lib/server/modules/sgc/documentos";

export const GET = apiRoute(obtenerCatalogos);
