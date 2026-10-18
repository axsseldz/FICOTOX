import { apiRoute } from "@/lib/server/http";
import { listaMaestraPdf } from "@/lib/server/modules/sgc/lista-maestra";

export const GET = apiRoute(listaMaestraPdf);
