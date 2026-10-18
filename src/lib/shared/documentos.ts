/*
 * Documentos SGC (especificacion del modulo de gestion documental): catalogos
 * y reglas compartidas entre servidor e interfaz. Las areas y los tipos viven
 * en la base (sgc_areas, sgc_tipos; los siembra la migracion 22); aqui solo
 * estan las reglas de la clave FX, los estados, la confidencialidad y los
 * archivos admitidos.
 */

/* ---------- Clave FX ---------- */

/*
 * La plataforma no genera claves: registra la que autoriza Mejora Continua y
 * valida su estructura. Formato general FX-[Area][Tipo]-[ID] (FX-TCF-GMR,
 * FX-GCP-CD, FX-GCP-CD-1-1). Excepcion: los manuales rectores FX-MC y FX-MO,
 * con o sin sufijo (FX-MC-1/1, FX-MO-2-1), solo en el area DI y tipo M.
 * Unica sin distinguir mayusculas ni espacios: se guarda normalizada.
 */
const RE_GENERAL = /^FX-([A-Z]{2})([A-Z])-([A-Z0-9]+(?:[-/][A-Z0-9]+)*)$/;
const RE_RECTOR = /^FX-(MC|MO)(?:-[A-Z0-9]+(?:[-/][A-Z0-9]+)*)?$/;
export const AREA_RECTORES = "DI";
export const TIPO_RECTORES = "M";

/* Mayusculas, sin espacios y con guiones normales (– — ‐ se leen como -). */
export function normalizarClave(valor: unknown): string {
  return String(valor ?? "")
    .normalize("NFKC")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, "")
    .toUpperCase()
    .slice(0, 80);
}

export interface ResultadoClave {
  clave: string;
  /* Problema para mostrar; null si la clave es valida para el area y el tipo dados. */
  problema: string | null;
  rector: boolean;
}

/* Valida la clave contra el area y el tipo de la ficha (codigos del catalogo). */
export function validarClave(valor: unknown, area: string, tipo: string): ResultadoClave {
  const clave = normalizarClave(valor);
  if (!clave) return { clave, problema: "Indica la clave FX autorizada por Mejora Continua", rector: false };
  if (RE_RECTOR.test(clave)) {
    const problema = area === AREA_RECTORES && tipo === TIPO_RECTORES ? null : "Las claves FX-MC y FX-MO son solo para los manuales rectores: elige el área DI (Documentos rectores) y el tipo M (Manual)";
    return { clave, problema, rector: true };
  }
  const m = RE_GENERAL.exec(clave);
  if (!m) return { clave, problema: "La clave no cumple el formato FX-[Área][Tipo]-[ID] (por ejemplo FX-TCF-GMR o FX-GCP-CD); los manuales rectores usan FX-MC o FX-MO", rector: false };
  if (m[1] !== area) return { clave, problema: `La clave indica el área ${m[1]}, pero la ficha es del área ${area || "sin elegir"}: deben coincidir`, rector: false };
  if (m[2] !== tipo) return { clave, problema: `La clave indica el tipo ${m[2]}, pero la ficha es del tipo ${tipo || "sin elegir"}: deben coincidir`, rector: false };
  return { clave, problema: null, rector: false };
}

/* ---------- Estados ---------- */

/*
 * Estados de una revision. Fase 1: borrador, en_revision (enviada; archivos
 * bloqueados) y vigente / obsoleta. El resto del flujo (en_autorizacion,
 * autorizada, devuelta, cancelada) lo usa la Fase 2.
 */
export const ESTADOS_REVISION = ["borrador", "en_revision", "en_autorizacion", "autorizada", "vigente", "obsoleta", "cancelada"] as const;
export type EstadoRevision = (typeof ESTADOS_REVISION)[number];
/* Revision "de trabajo": todavia no vigente ni cerrada (a lo mas una por documento). */
export const ESTADOS_TRABAJO: EstadoRevision[] = ["borrador", "en_revision", "en_autorizacion", "autorizada"];

export type TonoEstado = "neutral" | "brand" | "success" | "warning" | "danger";
export type IconoEstado = "borrador" | "revision" | "autorizacion" | "autorizada" | "vigente" | "obsoleta" | "cancelada";

export const ESTADO_REVISION: Record<EstadoRevision, { etiqueta: string; tono: TonoEstado; icono: IconoEstado; descripcion: string }> = {
  borrador: { etiqueta: "Borrador", tono: "neutral", icono: "borrador", descripcion: "En elaboración; sus archivos se pueden cambiar" },
  en_revision: { etiqueta: "En revisión", tono: "brand", icono: "revision", descripcion: "Enviada al revisor; sus archivos ya no se pueden cambiar" },
  en_autorizacion: { etiqueta: "En autorización", tono: "brand", icono: "autorizacion", descripcion: "Revisada; espera la autorización" },
  autorizada: { etiqueta: "Autorizada", tono: "warning", icono: "autorizada", descripcion: "Autorizada; espera que Mejora Continua la publique" },
  vigente: { etiqueta: "Vigente", tono: "success", icono: "vigente", descripcion: "Revisión en uso, de solo lectura" },
  obsoleta: { etiqueta: "Obsoleta", tono: "danger", icono: "obsoleta", descripcion: "Retirada del uso; se conserva en el historial" },
  cancelada: { etiqueta: "Cancelada", tono: "neutral", icono: "cancelada", descripcion: "Se dejó sin publicar; se conserva en el historial" },
};

/* Estado global del documento (ficha). */
export const ESTADOS_DOCUMENTO = ["en_elaboracion", "vigente", "obsoleto"] as const;
export type EstadoDocumento = (typeof ESTADOS_DOCUMENTO)[number];
export const ESTADO_DOCUMENTO: Record<EstadoDocumento, { etiqueta: string; tono: TonoEstado; icono: IconoEstado }> = {
  en_elaboracion: { etiqueta: "En elaboración", tono: "neutral", icono: "borrador" },
  vigente: { etiqueta: "Vigente", tono: "success", icono: "vigente" },
  obsoleto: { etiqueta: "Obsoleto", tono: "danger", icono: "obsoleta" },
};

/* ---------- Clasificacion ---------- */

export const CONFIDENCIALIDADES = [
  { value: "uso_interno", label: "Uso interno", descripcion: "Lo consulta todo el personal con permiso de consulta" },
  { value: "restringido", label: "Restringido", descripcion: "Solo Mejora Continua, Responsable General, el propietario, los asignados y los destinatarios" },
  { value: "confidencial", label: "Confidencial", descripcion: "Solo Mejora Continua, Responsable General, el propietario, los asignados y los destinatarios" },
] as const;
export type Confidencialidad = (typeof CONFIDENCIALIDADES)[number]["value"];
export const esConfidencialidad = (v: unknown): v is Confidencialidad => CONFIDENCIALIDADES.some((c) => c.value === v);
export const etiquetaConfidencialidad = (v: unknown) => CONFIDENCIALIDADES.find((c) => c.value === v)?.label || "Uso interno";

export const ORIGENES = [
  { value: "interno", label: "Interno" },
  { value: "externo", label: "Externo" },
] as const;
export type Origen = (typeof ORIGENES)[number]["value"];

/* Palabras clave: separadas por coma, sin repetir (sin distinguir mayusculas), maximo 20 de 40 caracteres. */
export function normalizarPalabras(valor: unknown): string[] {
  const lista = Array.isArray(valor) ? valor.map(String) : String(valor || "").split(",");
  const out: string[] = [];
  for (const e of lista) {
    const t = e.trim().replace(/\s+/g, " ").slice(0, 40);
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, 20);
}

/* ---------- Archivos ---------- */

/*
 * Cada revision tiene a lo mas un archivo fuente (editable) y un PDF de
 * consulta activos; sustituirlos en borrador conserva el anterior (marcado
 * como reemplazado). Al enviar a revision ya no se aceptan cambios.
 */
export const TIPOS_ARCHIVO_SGC = [
  { value: "pdf", label: "PDF de consulta", extensiones: ["pdf"] },
  { value: "fuente", label: "Archivo fuente", extensiones: ["docx", "xlsx", "xls", "pptx", "pdf"] },
] as const;
export type TipoArchivoSgc = (typeof TIPOS_ARCHIVO_SGC)[number]["value"];
export const esTipoArchivo = (v: unknown): v is TipoArchivoSgc => v === "pdf" || v === "fuente";
export const extensionesDe = (tipo: TipoArchivoSgc): readonly string[] => TIPOS_ARCHIVO_SGC.find((t) => t.value === tipo)!.extensiones;

/* Tipo MIME con que se sirve cada extension (nunca el que manda el navegador). */
export const MIME_SGC: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
export const MOTIVO_MIN_SGC = 5;

/* ---------- Flujo (Fase 2) ---------- */

/* Dias antes de la proxima revision en que el documento pasa a "pendiente de revision". */
export const DIAS_AVISO_REVISION = 30;
/* Proxima revision por omision al publicar o renovar: emision + 3 anios. */
export const ANIOS_PROXIMA_REVISION = 3;

export function sumarAnios(fecha: string, anios: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const f = new Date(Date.UTC(y + anios, m - 1, d));
  // 29 de febrero -> 28 (no saltar al 1 de marzo).
  if (f.getUTCMonth() !== m - 1) f.setUTCDate(0);
  return f.toISOString().slice(0, 10);
}

/* ¿La vigente esta pendiente de revision (faltan 30 dias o menos, o ya paso)? */
export function pendienteDeRevision(fechaProxima: unknown, hoy: string): boolean {
  if (!fechaProxima) return false;
  const [y, m, d] = hoy.split("-").map(Number);
  const limite = new Date(Date.UTC(y, m - 1, d + DIAS_AVISO_REVISION)).toISOString().slice(0, 10);
  return String(fechaProxima).slice(0, 10) <= limite;
}

export const ESTADOS_SOLICITUD_SGC: Record<string, { etiqueta: string; tono: TonoEstado }> = {
  pendiente: { etiqueta: "Pendiente", tono: "warning" },
  aceptada: { etiqueta: "Aceptada", tono: "success" },
  rechazada: { etiqueta: "Rechazada", tono: "danger" },
};

export const ESTADOS_RENOVACION: Record<string, { etiqueta: string; tono: TonoEstado }> = {
  en_revision: { etiqueta: "Renovación: confirmar vigencia", tono: "brand" },
  en_autorizacion: { etiqueta: "Renovación: por autorizar", tono: "brand" },
  completada: { etiqueta: "Renovado", tono: "success" },
  cancelada: { etiqueta: "Renovación rechazada", tono: "neutral" },
};

/* Acciones del flujo en palabras (linea de tiempo). */
export const ACCION_FLUJO: Record<string, string> = {
  solicitar: "Solicitó",
  aceptar_solicitud: "Aceptó la solicitud y asignó responsables",
  enviar_revision: "Envió a revisión",
  revisar_aceptar: "Revisó y aceptó",
  revisar_devolver: "Devolvió con comentarios (revisión)",
  revisar_rechazar: "Rechazó en la revisión",
  autorizar: "Autorizó",
  autorizar_devolver: "Devolvió con comentarios (autorización)",
  autorizar_rechazar: "Rechazó en la autorización",
  publicar: "Publicó: queda vigente",
  registrar_vigente: "Registró como vigente (carga inicial)",
  reasignar: "Reasignó responsables",
  obsoleta: "Quedó obsoleta",
  renovacion_iniciar: "Inició la renovación",
  renovacion_confirmar: "Confirmó la vigencia",
  renovacion_rechazar: "Rechazó la renovación",
  renovacion_autorizar: "Autorizó la renovación",
  obsoletar: "Declaró el documento obsoleto",
};

/* ---------- Externos (Fase 3) ---------- */

/*
 * Identificador propio del emisor de un documento externo (NMX-EC-17025-IMNC-2018,
 * NOM-242-SSA1-2009, AOAC 991.26...): unico sin distinguir mayusculas ni
 * espacios (se guarda normalizado); no puede usar el prefijo FX- de los internos.
 */
export function validarIdentificadorExterno(valor: unknown): ResultadoClave {
  const clave = normalizarClave(valor);
  if (!clave) return { clave, problema: "Indica el identificador del emisor (por ejemplo NMX-EC-17025-IMNC-2018)", rector: false };
  if (clave.startsWith("FX-")) return { clave, problema: "El prefijo FX- es de los documentos internos; usa el identificador del emisor", rector: false };
  if (!/^[A-Z0-9][A-Z0-9.\-/:]*$/.test(clave)) return { clave, problema: "El identificador solo admite letras, números, guiones, puntos, diagonales y dos puntos", rector: false };
  return { clave, problema: null, rector: false };
}

/* Enlace de consulta de un externo: solo http(s). */
export function enlaceValido(valor: unknown): string | null {
  const t = String(valor ?? "").trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
