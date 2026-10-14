/*
 * Combinaciones de roles prohibidas (FX-MO-2-1, secciones 4 y 10).
 * Catalogo versionado en el repositorio: no se edita desde la aplicacion.
 * Se evalua al asignar un rol y al editar los permisos de un rol, sobre los
 * roles no revocados ni vencidos de cada persona (vigentes o por comenzar).
 *
 * - Reglas 1 y 2: se evaluan por permisos (union de los roles de la persona),
 *   no por nombre de rol, para que sigan valiendo si se editan los roles.
 *   El "ancla" de cada regla tambien es un permiso: usuarios:G identifica la
 *   administracion tecnica del sistema y compras:G la administracion
 *   auxiliar (pendiente de validar con Mejora Continua).
 * - Reglas 3 y 4: se evaluan por la clave estable del rol (roles.clave), no
 *   por su nombre visible.
 */
import { expandirPermisos, isAccion, type Accion, type Modulo, type PermisoFila } from "./permisos";

export const VERSION_COMBINACIONES = "2026-09-24.1";

export interface RolEvaluado {
  id: number;
  nombre: string;
  clave: string | null;
  filas: PermisoFila[];
}

export interface Violacion {
  regla: number;
  titulo: string;
  mensaje: string;
}

type Tiene = (modulo: Modulo, acciones: Accion[]) => boolean;

interface Regla {
  numero: number;
  titulo: string;
  evaluar: (roles: RolEvaluado[], tiene: Tiene) => string | null;
}

const nombres = (roles: RolEvaluado[]) => roles.map((r) => `"${r.nombre}"`).join(", ");

export const REGLAS_COMBINACION: Regla[] = [
  {
    numero: 1,
    titulo: "Administración técnica del sistema sin captura ni aprobación técnica",
    evaluar: (roles, tiene) => {
      if (!tiene("usuarios", ["G"])) return null;
      // Documentos SGC: una sesion de administracion tecnica no puede usarse para revisar, autorizar, publicar ni obsoletar documentos.
      const tecnico = tiene("ensayos", ["C", "E", "R", "A"]) || tiene("informes", ["C", "E", "R", "A"]) || tiene("documentos", ["documento_revisar", "documento_autorizar", "documento_publicar", "documento_obsoletar"]);
      return tecnico
        ? `Quien administra usuarios y roles (usuarios:G) no puede tener C, E, R o A en ensayos o informes, ni revisar, autorizar, publicar u obsoletar documentos (roles: ${nombres(roles)}).`
        : null;
    },
  },
  {
    numero: 2,
    titulo: "Administración auxiliar sin modificar datos técnicos",
    evaluar: (roles, tiene) => {
      if (!tiene("compras", ["G"])) return null;
      const tecnico = tiene("ensayos", ["C", "E"]) || tiene("informes", ["C", "E"]);
      return tecnico
        ? `La administración auxiliar (compras:G) no puede combinarse con C o E en ensayos o informes (roles: ${nombres(roles)}).`
        : null;
    },
  },
  {
    numero: 3,
    titulo: "Independencia del Auditor Interno",
    evaluar: (roles) => {
      if (!roles.some((r) => r.clave === "auditor_interno")) return null;
      const incompatibles = roles.filter((r) => r.clave && ["mejora_continua", "coord_area_tecnica", "tecnico_analista", "tecnico_auxiliar", "estudiante"].includes(r.clave));
      return incompatibles.length
        ? `El Auditor Interno no puede combinarse con ${nombres(incompatibles)}: no audita su propia evidencia.`
        : null;
    },
  },
  {
    numero: 4,
    titulo: "Estudiante / personal en formación sin otros roles",
    evaluar: (roles) => {
      if (!roles.some((r) => r.clave === "estudiante") || roles.length < 2) return null;
      return `El rol de estudiante / personal en formación no puede combinarse con ningún otro rol (roles: ${nombres(roles)}).`;
    },
  },
];

/* Evalua las reglas sobre el conjunto de roles de una persona. */
export function evaluarCombinacion(roles: RolEvaluado[]): Violacion[] {
  const efectivos = expandirPermisos(roles.flatMap((r) => r.filas));
  const tiene: Tiene = (modulo, acciones) => acciones.some((accion) => isAccion(accion) && !!efectivos[modulo]?.[accion]?.length);
  const out: Violacion[] = [];
  for (const regla of REGLAS_COMBINACION) {
    const mensaje = regla.evaluar(roles, tiene);
    if (mensaje) out.push({ regla: regla.numero, titulo: regla.titulo, mensaje });
  }
  return out;
}
