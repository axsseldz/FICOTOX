import { apiRoute } from "@/lib/server/http";
import { solicitarRestauracion } from "@/lib/server/modules/respaldos";

/* Pide restaurar la plataforma desde este respaldo: crea la solicitud que aprueba un segundo usuario. */
export const POST = apiRoute(solicitarRestauracion);
