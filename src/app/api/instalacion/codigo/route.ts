import { verificarCodigoPost } from "@/lib/server/modules/instalacion";

export const POST = (request: Request) => verificarCodigoPost(request);
