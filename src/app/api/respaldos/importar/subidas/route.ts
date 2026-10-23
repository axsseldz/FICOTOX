import { iniciarSubidaImportar } from "@/lib/server/modules/respaldos-portables";

export const POST = (request: Request) => iniciarSubidaImportar(request);
