import { apiRoute } from "@/lib/server/http";
import { resumenSgc } from "@/lib/server/modules/sgc/documentos";

export const GET = apiRoute(resumenSgc);
