import type { Accion, PermisosMapa } from "../shared/permisos";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ApiRecord = Record<string, any>;

export interface SessionUser {
  id?: number;
  nombre?: string;
  email?: string;
  sub?: string;
  /* Nombres de los roles vigentes (el detalle esta en SessionValue.roles). */
  roles?: string[];
  /* Clave del catalogo de avatares; null = el que se deriva del correo. */
  avatar?: string | null;
  /* Foto de perfil: version de la guardada (null si no tiene) y si se muestra en lugar de la figura. */
  foto?: string | null;
  usa_foto?: boolean;
  /* Apariencia elegida (claro, oscuro o auto). */
  tema?: "claro" | "oscuro" | "auto";
  /* Fase 2: cuenta, cargo predeterminado y estado de la contrasena. */
  tipo_cuenta?: "permanente" | "temporal";
  vigente_hasta?: string | null;
  supervisor_id?: number | null;
  cargo_predeterminado?: number | null;
  debe_cambiar_password?: boolean;
}

/* Permisos efectivos { modulo: { accion: alcance } } (Fase 1; src/lib/shared/permisos.ts). */
export type PermissionsMap = PermisosMapa;
export type ModuleAction = Accion;

/* Rol vigente de la persona con sesion, con sus propios permisos (para "Actuar como"). */
export interface RolSesion {
  id: number;
  nombre: string;
  clave: string | null;
  vigente_desde?: string;
  vigente_hasta?: string | null;
  permisos: PermisosMapa;
}

/* Configuracion publica del acceso (GET /api/auth/config). Solo usuario y contrasena del sistema. */
export interface AuthConfig {
  /* Dominios de correo admitidos al dar de alta cuentas (vacio = cualquiera). */
  dominios_permitidos?: string[];
  /* Fase 2: cierre por inactividad (minutos) y duracion maxima de la sesion (horas). */
  sesion?: { inactividad_min?: number; expira_horas?: number };
}


