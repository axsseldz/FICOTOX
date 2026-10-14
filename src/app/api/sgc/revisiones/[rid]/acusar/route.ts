import { apiRoute } from "@/lib/server/http";
import { acusarLectura } from "@/lib/server/modules/sgc/lecturas";

export const POST = apiRoute(acusarLectura);
