import type { ApiRecord } from "./types";

/* Helpers de consumo de API identicos a los de el app.js de la interfaz original. */

export const API_BASE_URL = "/api";

/*
 * Error de la API con su estado HTTP y los datos del servidor (codigo, rol,
 * faltan...). Sigue siendo un Error con el mensaje del servidor, asi que los
 * `catch` existentes no cambian; el catalogo de mensajes (mensajes.ts) lo usa
 * para explicar que paso y que hacer, y para ubicar el campo con el problema.
 */
export class ApiError extends Error {
  status: number;
  codigo: string;
  data: ApiRecord;
  constructor(status: number, data: ApiRecord, fallback: string) {
    super(String(data?.message || fallback));
    this.name = "ApiError";
    this.status = status;
    this.codigo = String(data?.codigo || "");
    this.data = data || {};
  }
}

/*
 * "Actuar como" (Fase 1): si una accion la permiten varios roles vigentes de la
 * persona, el servidor responde 409 con codigo ELEGIR_CARGO y las opciones; el
 * cliente pide elegir (ActuarComoProvider) y repite la peticion con el
 * encabezado X-Actuar-Como. Si la persona cancela, la accion no se realiza.
 */
export interface OpcionCargo {
  rol_id: number;
  nombre: string;
}
type ElegirCargo = (opciones: OpcionCargo[], mensaje: string) => Promise<number | null>;
let elegirCargo: ElegirCargo | null = null;

export function registrarSelectorDeCargo(fn: ElegirCargo | null): void {
  elegirCargo = fn;
}

/* Cargo elegido en el mismo dialogo de confirmacion (Fase 2): vale solo para la siguiente peticion. */
let cargoArmado: number | null = null;
export function armarCargo(rolId: number | null): void {
  cargoArmado = rolId;
}

/*
 * Envia la peticion; si el servidor pide elegir cargo (409 ELEGIR_CARGO), lo
 * pregunta y repite. Devuelve tambien el cargo usado, para reutilizarlo si hay
 * que repetir la peticion (p. ej. tras confirmar la identidad).
 */
async function conCargo(send: (extra: Record<string, string>) => Promise<Response>, elegido: number | null = null): Promise<{ response: Response; cargo: number | null }> {
  if (elegido !== null) return { response: await send({ "X-Actuar-Como": String(elegido) }), cargo: elegido };
  const response = await send({});
  if (response.status !== 409 || !elegirCargo) return { response, cargo: null };
  const data = await response.clone().json().catch(() => ({}) as ApiRecord);
  if (data?.codigo !== "ELEGIR_CARGO" || !Array.isArray(data.opciones)) return { response, cargo: null };
  const rolId = await elegirCargo(data.opciones as OpcionCargo[], String(data.message || ""));
  if (rolId === null) throw new Error("Acción cancelada: no se eligió con qué cargo actuar");
  return { response: await send({ "X-Actuar-Como": String(rolId) }), cargo: rolId };
}

/*
 * Reautenticacion (Fase 2): las acciones criticas (aprobar, anular, dar de baja,
 * visto bueno, cambios de usuarios) exigen confirmar la identidad. El servidor
 * responde 401 `reauth_required` con la accion; el cliente obtiene un token de un
 * solo uso en /auth/reauth y repite la peticion con X-Reauth.
 * - Si el dialogo de confirmacion ya pidio la contrasena (usePrompt/SignDialog con
 *   `critico`), se usa esa (armarReauth) sin volver a preguntar.
 * - Si no, se pide con el dialogo de ReautenticarProvider.
 */
export interface CredencialReauth {
  password?: string;
}
type PedirReauth = (accion: string, mensaje: string, error?: string) => Promise<CredencialReauth | null>;
let pedirReauth: PedirReauth | null = null;
let armada: { credencial: CredencialReauth; hasta: number } | null = null;

export function registrarReautenticador(fn: PedirReauth | null): void {
  pedirReauth = fn;
}

/* La contrasena escrita en el mismo dialogo de confirmacion (vale para la siguiente accion critica, 2 min). */
export function armarReauth(credencial: CredencialReauth | null): void {
  armada = credencial && credencial.password ? { credencial, hasta: Date.now() + 120_000 } : null;
}

async function tokenReauth(token: string, accion: string, credencial: CredencialReauth): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/auth/reauth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ accion, ...credencial }),
  });
  const data = await parseJson(response);
  if (!response.ok || !data.token) {
    avisarSesion(response.status, data);
    throw new ApiError(response.status, data, "No se pudo confirmar tu identidad");
  }
  return String(data.token);
}

async function conReauth(token: string, send: (extra: Record<string, string>) => Promise<Response>): Promise<Response> {
  const elegido = cargoArmado;
  cargoArmado = null;
  const { response, cargo } = await conCargo(send, elegido);
  const data = response.status === 401 ? await response.clone().json().catch(() => ({}) as ApiRecord) : null;
  // La contrasena escrita en el dialogo solo vale para ESTA accion: si el servidor no la pidio
  // (p. ej. fallo una validacion antes), se descarta y la siguiente accion critica la vuelve a pedir.
  let credencial = armada && armada.hasta > Date.now() ? armada.credencial : null;
  armada = null;
  if (data?.codigo !== "reauth_required") return response;
  const accion = String(data.accion || "");
  if (!credencial) {
    if (!pedirReauth) return response;
    credencial = await pedirReauth(accion, String(data.message || ""));
    if (!credencial) throw new Error("Acción cancelada: no se confirmó tu identidad");
  }
  // Contraseña incorrecta: se vuelve a pedir con el campo marcado (sin perder lo capturado).
  let reauth = "";
  for (;;) {
    try {
      reauth = await tokenReauth(token, accion, credencial);
      break;
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status !== 401 || !pedirReauth || (err instanceof ApiError && err.codigo === "cuenta_bloqueada")) throw err;
      const otra = await pedirReauth(accion, String(data?.message || ""), err instanceof Error ? err.message : "La contraseña no es correcta");
      if (!otra) throw new Error("Acción cancelada: no se confirmó tu identidad");
      credencial = otra;
    }
  }
  // Se repite con el mismo cargo (si se eligio) y el token de reautenticacion.
  return (await conCargo((extra) => send({ ...extra, "X-Reauth": reauth }), cargo)).response;
}

/*
 * Sesion cerrada por el servidor (Fase 2): token revocado, cuenta fuera de
 * vigencia o cambio de contrasena obligatorio. SessionProvider se registra para
 * reaccionar (volver al acceso con el mensaje, o mostrar el cambio de contrasena).
 */
type AvisoSesion = (codigo: string, mensaje: string) => void;
let avisoSesion: AvisoSesion | null = null;
export function registrarAvisoSesion(fn: AvisoSesion | null): void {
  avisoSesion = fn;
}
function avisarSesion(status: number, data: ApiRecord): void {
  const codigo = String(data?.codigo || "");
  if ((status === 401 && ["sesion_revocada", "cuenta_no_vigente"].includes(codigo)) || (status === 403 && codigo === "cambiar_password")) {
    avisoSesion?.(codigo, String(data.message || ""));
  }
}

async function parseJson(response: Response): Promise<ApiRecord> {
  try {
    const data = await response.json();
    return data && typeof data === "object" ? (data as ApiRecord) : {};
  } catch {
    return {};
  }
}

export const postJson = async (url: string, body: unknown): Promise<ApiRecord> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJson(response);
  if (!response.ok) {
    throw new ApiError(response.status, data, "No se pudo completar la solicitud");
  }
  return data;
};

export const getJsonAuth = async (url: string, token: string, signal?: AbortSignal): Promise<ApiRecord> => {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  const data = await parseJson(response);
  if (!response.ok) {
    avisarSesion(response.status, data);
    throw new ApiError(response.status, data, "No autorizado");
  }
  return data;
};

export const sendJsonAuth = async (method: string, url: string, token: string, body?: unknown): Promise<ApiRecord> => {
  const response = await conReauth(token, (extra) =>
    fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...extra,
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  const data = await parseJson(response);
  if (!response.ok) {
    avisarSesion(response.status, data);
    throw new ApiError(response.status, data, "No se pudo completar la solicitud");
  }
  return data;
};

export const sendFormAuth = async (url: string, token: string, formData: FormData, method: string = "POST"): Promise<ApiRecord> => {
  const response = await conReauth(token, (extra) =>
    fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...extra,
      },
      body: formData,
    }),
  );
  const data = await parseJson(response);
  if (!response.ok) {
    avisarSesion(response.status, data);
    throw new ApiError(response.status, data, "No se pudo completar la carga");
  }
  return data;
};

/*
 * Fase 10: como sendFormAuth, pero con avance de la carga (XMLHttpRequest, que
 * a diferencia de fetch informa el progreso de la subida). Respeta "Actuar
 * como" y la reautenticacion igual que las demas peticiones.
 */
export const sendFormAuthProgress = async (url: string, token: string, formData: FormData, onProgress?: (fraccion: number) => void): Promise<ApiRecord> => {
  const enviar = (extra: Record<string, string>) =>
    new Promise<Response>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      for (const [k, v] of Object.entries(extra)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
      };
      xhr.onload = () => resolve(new Response(xhr.responseText || "{}", { status: xhr.status, headers: { "Content-Type": xhr.getResponseHeader("content-type") || "application/json" } }));
      xhr.onerror = () => reject(new Error("No se pudo subir el archivo (conexión interrumpida)"));
      xhr.send(formData);
    });
  const response = await conReauth(token, enviar);
  const data = await parseJson(response);
  if (!response.ok) {
    avisarSesion(response.status, data);
    throw new ApiError(response.status, data, "No se pudo completar la carga");
  }
  return data;
};

/* Equivalente de resolveApiEntity(payload, preferredKeys). */
export const resolveApiEntity = (payload: unknown, preferredKeys: string[] = []): ApiRecord => {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  const record = payload as ApiRecord;
  const keys = [...preferredKeys, "item", "role", "user", "usuario", "data", "result"];
  for (const key of keys) {
    const value = record[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as ApiRecord;
    }
  }
  if (Array.isArray(record.items) && record.items.length === 1 && typeof record.items[0] === "object") {
    return record.items[0] as ApiRecord;
  }
  return record;
};
