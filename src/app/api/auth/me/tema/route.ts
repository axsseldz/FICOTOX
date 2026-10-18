import { apiRoute } from "@/lib/server/http";
import { updateMyTema } from "@/lib/server/modules/auth";

export const PUT = apiRoute(updateMyTema);
