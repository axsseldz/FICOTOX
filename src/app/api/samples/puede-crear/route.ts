import { apiRoute, json } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { puedeCrearRegistros } from "@/lib/server/puede-registro";
import { cargarAutorizacion } from "@/lib/server/rbac";

/* GET /api/samples/puede-crear: por tipo de registro, si la persona puede crearlo (rol + autorización FX-THF-AP de la actividad). */
export const GET = apiRoute(async ({ request, s }) => {
  const user = await requireUser(request);
  return json({ puede: await puedeCrearRegistros(s, await cargarAutorizacion(s, user)) });
});
