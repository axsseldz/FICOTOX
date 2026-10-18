import { apiRoute } from "@/lib/server/http";
import { detalleRespaldoApi } from "@/lib/server/modules/respaldos";

export const GET = apiRoute(detalleRespaldoApi);
