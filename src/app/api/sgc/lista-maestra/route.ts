import { apiRoute } from "@/lib/server/http";
import { listaMaestra } from "@/lib/server/modules/sgc/lista-maestra";

export const GET = apiRoute(listaMaestra);
