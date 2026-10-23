import { estadoInstalacionGet } from "@/lib/server/modules/instalacion";

/*
 * Configuracion inicial (sin sesion): solo responde mientras la base no tiene
 * ninguna cuenta; despues, 404 para siempre. Ver src/lib/server/modules/instalacion.ts.
 */
export const GET = (request: Request) => estadoInstalacionGet(request);
