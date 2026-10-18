import { apiRoute } from "@/lib/server/http";
import { buscarTodo } from "@/lib/server/modules/busqueda";

export const GET = apiRoute(buscarTodo);
