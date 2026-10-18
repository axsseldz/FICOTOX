/*
 * Catalogo de mensajes de validacion y de errores, en espanol y sin codigos
 * tecnicos, para que todos los formularios hablen igual.
 *
 * - `msg`: textos cortos para marcar un campo ("Indica el solicitante").
 * - `explicarError(err)`: convierte un error del servidor en "que paso" y
 *   "que hacer", y, si corresponde a un campo, en la clave de ese campo.
 */
import { ApiError } from "./api";

/* Un dato faltante o invalido de un formulario. */
export interface Problema {
  /* id del elemento a marcar y enfocar (input, select, textarea o contenedor). */
  campo: string;
  /* Mensaje corto bajo el campo. */
  mensaje: string;
  /* Seccion del formato que lo contiene (se abre si esta recogida). */
  seccion?: string;
  /* Nombre de la seccion o grupo para el pop-up ("Recepción", "Inspección visual"). */
  grupo?: string;
  /* Se muestra aunque no se haya intentado guardar (una opcion elegida que dejo de ser valida). */
  inmediato?: boolean;
}

/* ---------- Mensajes de campo ---------- */

export const msg = {
  indica: (que: string) => `Indica ${que}`,
  elige: (que: string) => `Elige ${que}`,
  marca: (que: string) => `Marca ${que}`,
  escribe: (que: string) => `Escribe ${que}`,
  firma: (quien: string) => `Falta la firma de ${quien}`,
  minimo: (que: string, n: number) => `${que} debe tener al menos ${n} caracteres`,
  numero: (que: string) => `${que} debe ser un número`,
  positivo: (que: string) => `${que} debe ser mayor que cero`,
  fechaPosterior: (que: string, referencia: string) => `${que} no puede ser posterior a ${referencia}`,
  fechaAnterior: (que: string, referencia: string) => `${que} no puede ser anterior a ${referencia}`,
  requisito: (n: number) => `Marca C, NC o NA en el requisito ${n}`,
  correo: "Escribe un correo válido",
  password: "Escribe tu contraseña para confirmar",
};

/* ---------- Errores del servidor ---------- */

export interface Explicacion {
  /* Que paso, en una frase simple. */
  que: string;
  /* Que hacer. */
  hacer?: string;
  /* Clave del campo al que corresponde (solicitante, cliente, firma:proceso...). */
  clave?: string;
  /* Mensaje corto para ese campo. */
  mensajeCampo?: string;
}

const MODULO: Record<string, string> = {
  usuarios: "usuarios",
  documentos: "documentos",
  muestras: "muestras",
  ensayos: "procesamiento, extracción y análisis",
  informes: "informes",
  equipos: "equipos",
  inventario: "inventario",
  calidad: "calidad",
  respaldos: "respaldos",
  compras: "compras",
};
const ACCION: Record<string, string> = { V: "ver", C: "registrar", E: "editar", R: "revisar", A: "aprobar", AN: "anular", G: "administrar" };

/* Quita lo tecnico de un mensaje del servidor: "ensayos:E" -> "editar en procesamiento, extracción y análisis". */
function limpiarMensaje(texto: string): string {
  let t = String(texto || "").trim();
  t = t.replace(/Permiso denegado para ([a-z_]+):([A-Z]{1,2})/g, (_m, mod, acc) => `No tienes permiso para ${ACCION[acc] || "hacer esto"} en ${MODULO[mod] || mod}`);
  t = t.replace(/Tu alcance en ([a-z_]+):([A-Z]{1,2}) no cubre esta operación/g, (_m, mod, acc) => `Tu permiso para ${ACCION[acc] || "hacer esto"} en ${MODULO[mod] || mod} no cubre este registro`);
  t = t.replace(/\b([a-z_]+):(V|C|E|R|A|AN|G)\b/g, (_m, mod, acc) => `${ACCION[acc] || acc} en ${MODULO[mod] || mod}`);
  // Sin JSON ni codigos de estado.
  t = t.replace(/\{[^}]*\}/g, "").replace(/\b(4\d\d|5\d\d)\b/g, "").replace(/\s{2,}/g, " ").trim();
  return t || "No se pudo completar la acción";
}

/* Que hacer segun el codigo del servidor. */
const HACER: Record<string, string> = {
  no_autorizado: "Pide a la Coordinación Técnica que registre tu autorización FX-THF-AP vigente para esa actividad y método (Administración › Usuarios › Autorizaciones).",
  no_asignado: "Pide a la Coordinación Técnica que te asigne la muestra.",
  segregacion: "Pide que lo haga otra persona autorizada o solicita una excepción de separación de funciones a Calidad (Responsable General o Mejora Continua).",
  solicitud_pendiente: "Espera a que un segundo usuario apruebe o rechace la solicitud (Muestras › Por autorizar), o cancélala si la pediste tú.",
  supervision_pendiente: "Espera el visto bueno de tu supervisor (Muestras › Por supervisar).",
  suspendido: "El método o el equipo está suspendido por una no conformidad. Consulta con Calidad cuándo se reanuda.",
  informe_retenido: "Calidad debe liberar la retención en la no conformidad antes de continuar.",
  requiere_enmienda: "Emite y libera la enmienda del informe antes de enviarlo.",
  folio_bloqueado: "El folio ya no se edita: usa «Cambiar folio» en Más acciones (lo autoriza la Coordinación Técnica).",
  firma_invalida: "Pide a esa persona que vuelva a elegir su cuenta y escriba su contraseña.",
  firma_sin_confirmar: "Pide a esa persona que confirme su firma con su contraseña.",
  firma_bloqueada: "La cuenta de quien firma está bloqueada por intentos fallidos; espera unos minutos o pide que la desbloqueen.",
  evidencia_requerida: "Adjunta la evidencia instrumental en la sección «Resultados» y vuelve a enviar.",
  conflicto_concurrencia: "Otra persona guardó al mismo tiempo. Vuelve a intentarlo.",
  archivo_grande: "Elige un archivo más pequeño.",
  formato_no_permitido: "Elige un archivo PDF, imagen, Excel o CSV.",
  COMBINACION_PROHIBIDA: "Elige otro rol o revoca primero el rol incompatible.",
  rol_propio: "Pide a otra persona que administre usuarios que haga el cambio.",
  smtp_no_configurado: "Registra el envío manual con su evidencia, o pide al Administrador técnico que configure el correo.",
  reauth_invalido: "Vuelve a escribir tu contraseña.",
  cuenta_bloqueada: "Espera unos minutos o pide al Administrador técnico que desbloquee tu cuenta.",
  solicitud_vencida: "La solicitud venció; vuelve a pedir la acción.",
  falta_comunicacion: "Registra la comunicación al cliente (fecha y medio) en la decisión de aceptación.",
  origen_requerido: "Elige el registro de origen de la etapa anterior.",
  nc_cerrada: "La no conformidad ya está cerrada; no se modifica.",
  acciones_pendientes: "Implementa o cancela las acciones correctivas pendientes antes de cerrar.",
  suspensiones_activas: "Reanuda los métodos o equipos suspendidos antes de cerrar.",
  retenciones_activas: "Libera los informes retenidos antes de cerrar.",
  sin_verificacion: "Registra la verificación de eficacia antes de cerrar.",
  no_liberado: "Libera el informe antes de enviarlo.",
  analisis_bloqueado: "El análisis ya no se edita en este estado; usa una enmienda.",
};

const HACER_POR_ESTADO: Record<number, string> = {
  400: "Revisa los datos marcados y vuelve a intentarlo.",
  401: "Vuelve a escribir tu contraseña o inicia sesión de nuevo.",
  403: "Pide a la administración que revise tus roles y permisos.",
  404: "El registro ya no existe o no lo puedes ver. Vuelve a la lista.",
  409: "Revisa el estado del registro (recárgalo) y vuelve a intentarlo.",
  413: "Elige un archivo más pequeño.",
  423: "Espera unos minutos y vuelve a intentarlo.",
  500: "Vuelve a intentarlo; si sigue fallando, avisa al Administrador técnico.",
};

/* Mensajes del servidor que corresponden a un campo (clave generica del formulario). */
const CAMPOS_POR_MENSAJE: Array<[RegExp, string]> = [
  [/solicitante/i, "solicitante"],
  [/nombre del cliente/i, "cliente"],
  [/\bfolio\b/i, "folio"],
  [/ID interno/i, "id_interno"],
  [/medio de recepci/i, "medio_recepcion"],
  [/motivo/i, "motivo"],
  [/correo/i, "correo"],
  [/contraseña/i, "password"],
];

/* La persona canceló (no eligió cargo, no confirmó su identidad): no es un error que haya que mostrar. */
export const esCancelacion = (err: unknown): boolean => err instanceof Error && !(err instanceof ApiError) && /^Acción cancelada/.test(err.message);

export function explicarError(err: unknown, fallback = "No se pudo completar la acción"): Explicacion {
  if (!(err instanceof Error)) return { que: fallback, hacer: HACER_POR_ESTADO[500] };
  if (!(err instanceof ApiError)) {
    // Error de red o del navegador (sin respuesta del servidor).
    const red = /fetch|network|conexi/i.test(err.message);
    return { que: red ? "No hay conexión con el servidor" : limpiarMensaje(err.message || fallback), hacer: red ? "Revisa la red del laboratorio y vuelve a intentarlo." : undefined };
  }
  const que = err.status >= 500 ? "Ocurrió un error en el servidor" : limpiarMensaje(err.message || fallback);
  const hacer = HACER[err.codigo] || HACER_POR_ESTADO[err.status] || HACER_POR_ESTADO[500];
  // Firma de una persona concreta: al campo de ese firmante.
  const rol = typeof err.data?.rol === "string" ? err.data.rol : "";
  if (rol && ["firma_invalida", "firma_sin_confirmar", "firma_bloqueada", "no_autorizado"].includes(err.codigo)) return { que, hacer, clave: `firma:${rol}`, mensajeCampo: que.replace(/^[^:]+:\s*/, "") };
  // Contraseña rechazada (confirmar identidad o cambio de contraseña): al campo de contraseña.
  if (err.status === 401 && (["reauth_invalido", "reauth_fallida", "password_incorrecta"].includes(err.codigo) || /contraseña/i.test(err.message))) return { que, hacer: HACER.reauth_invalido, clave: "password", mensajeCampo: que };
  // El servidor indica el campo (p. ej. biblioteca: titulo, categoria, roles, archivo, motivo).
  if (typeof err.data?.campo === "string" && err.data.campo) return { que, hacer, clave: err.data.campo, mensajeCampo: que };
  if (err.status === 400 || err.status === 422) {
    const encontrado = CAMPOS_POR_MENSAJE.find(([re]) => re.test(err.message));
    if (encontrado) return { que, hacer, clave: encontrado[1], mensajeCampo: que };
  }
  return { que, hacer };
}

