import { apiRoute } from "@/lib/server/http";
import { getDocumento } from "@/lib/server/modules/documentos-sgc";
import { funcionalidadRetirada } from "@/lib/server/retirado";

/* Lectura para el historial de los documentos del flujo anterior; las escrituras se retiraron (410). */
export const GET = apiRoute(getDocumento);
export const PUT = funcionalidadRetirada;
export const DELETE = funcionalidadRetirada;
