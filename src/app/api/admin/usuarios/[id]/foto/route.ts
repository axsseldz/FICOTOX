import { apiRoute } from "@/lib/server/http";
import { quitarFotoDe } from "@/lib/server/modules/fotos";

export const DELETE = apiRoute(quitarFotoDe);
