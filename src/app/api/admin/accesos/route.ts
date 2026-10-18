import { pantallaRetirada } from "@/lib/server/retirado";

/* Revisión de accesos se integró en Administración › Usuarios (sin exportación); los cambios del periodo se consultan en Auditoría. */
export const GET = () => pantallaRetirada("la revisión de accesos está en Administración › Usuarios");
