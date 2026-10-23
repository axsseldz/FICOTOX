import { importarRespaldoPost } from "@/lib/server/modules/respaldos-portables";

/* No pasa por apiRoute: descifrar y verificar corre en segundo plano y la peticion responde enseguida. */
export const POST = (request: Request) => importarRespaldoPost(request);
