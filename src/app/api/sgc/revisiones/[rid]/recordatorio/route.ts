import { apiRoute } from "@/lib/server/http";
import { recordatorioLecturas } from "@/lib/server/modules/sgc/lecturas";

export const POST = apiRoute(recordatorioLecturas);
