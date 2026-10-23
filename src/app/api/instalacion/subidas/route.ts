import { iniciarSubidaInstalacion } from "@/lib/server/modules/instalacion";

export const POST = (request: Request) => iniciarSubidaInstalacion(request);
