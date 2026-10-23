import { restaurarInicialPost } from "@/lib/server/modules/instalacion";

/* Descifrar, verificar y restaurar corre en segundo plano; el avance, en GET /api/instalacion. */
export const POST = (request: Request) => restaurarInicialPost(request);
