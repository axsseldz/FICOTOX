/*
 * Respaldos portables (Calidad › Respaldos): «Descargar» un respaldo como un
 * archivo .ficotox cifrado con una contraseña, e «Importar respaldo» desde ese
 * archivo (queda en la lista como «Importado» y se restaura con el flujo de
 * siempre: solicitud, segundo usuario, respaldo previo). El formato y el
 * cifrado viven en src/lib/shared/respaldo-portable.mjs; la verificacion es la
 * de siempre (scripts/restaurar-ficotox.mjs en modo prueba, 8 verificaciones).
 *
 * - Solo respaldos:G, con reautenticacion (respaldos:descargar / respaldos:importar).
 * - Descargar: POST con la contraseña de cifrado (minimo 12 caracteres) → se
 *   deriva la clave y se entrega un enlace de un solo uso (2 min) que el
 *   navegador abre como descarga normal (el archivo sale en flujo, cifrado al
 *   vuelo, con su tamaño exacto). La contraseña no se guarda ni se registra; la
 *   bitacora dice quien descargo que respaldo y cuando.
 * - Importar: el archivo sube por partes (src/lib/server/subidas.ts), se
 *   descifra en <respaldos>/.importando/, se coloca en su carpeta (oculta de la
 *   lista mientras se verifica) y se prueba su restauracion. Si algo falla, se
 *   borra todo y se explica el motivo. Los temporales se borran siempre.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { requireUser, type CurrentUser } from "../auth";
import { registrarAuditoria, type AuditAction } from "../audit";
import { getConfig } from "../config";
import { plataformaRestaurando, withSession } from "../db";
import { HttpError, json, readJson } from "../http";
import { requirePermission } from "../rbac";
import { exigirReauth } from "../seguridad";
import { agregarTrozo, borrarArchivo, comprobarContrasenaSubida, carpetaImportando, iniciarSubida, limiteImportarBytes, limpiarSubidas, tomarSubida } from "../subidas";
import { actaLegible, borrarCopiaRestaurada, correrScriptRestauracion, huellaLlaveInstalacion, ID_RE, iniciarTrabajo, MENSAJE_OCUPADO, olvidarListaRespaldos, terminarTrabajo, trabajoEnCurso, type Trabajo } from "./respaldos";
import { ARCHIVO_IMPORTADO, hacerPrivado, leerManifest, type Acta, type Manifest } from "../../shared/respaldo.mjs";
import { abrirPortable, entradasDeRespaldo, ErrorPortable, EXTENSION, flujoPortable, prepararCifrado, tamanoPortable, validarContrasena, type Cifrado } from "../../shared/respaldo-portable.mjs";

const respaldosDir = () => getConfig().RESPALDOS_DIR;

function exigirSqlite(): void {
  if (!getConfig().SQLITE_PATH) throw new HttpError(501, { message: "Con MySQL los respaldos se hacen con la herramienta del servidor de base de datos.", codigo: "respaldo_mysql" });
}

/* ---------- Descargar ---------- */

interface Descarga {
  respaldoId: string;
  carpeta: string;
  cifrado: Cifrado;
  usuario: CurrentUser;
  expira: number;
}

const global = globalThis as unknown as { __ficotoxDescargas?: Map<string, Descarga> };
const descargas = (global.__ficotoxDescargas ||= new Map<string, Descarga>());
const DESCARGA_VIGENCIA_MS = 2 * 60_000;

const nombreDescarga = (id: string) => `ficotox-respaldo-${id}${EXTENSION}`;

/*
 * POST /api/respaldos/:id/descargar { contrasena, confirmacion } (respaldos:G +
 * reautenticacion respaldos:descargar): deriva la clave y devuelve el enlace de
 * un solo uso. Solo respaldos que incluyen la llave (sin ella no se pueden
 * restaurar en otra computadora). No pasa por apiRoute: la clave (scrypt, ~0.3 s)
 * se deriva con la base libre, no dentro de la sesion que atiende a todos.
 */
export function prepararDescarga(request: Request, params: { id?: string }): Promise<Response> {
  return responder(request, async () => {
    const user = await gestorDe(request);
    const id = String(params.id || "");
    const carpeta = path.join(/*turbopackIgnore: true*/ respaldosDir(), id);
    let manifest: Manifest | null = null;
    try {
      manifest = ID_RE.test(id) ? leerManifest(carpeta) : null;
    } catch {
      manifest = null;
    }
    if (!manifest) throw new HttpError(404, { message: "Respaldo no encontrado o dañado: no se puede descargar." });
    if (!manifest.llave?.incluida) throw new HttpError(409, { message: "Este respaldo no incluye la llave del registro de actividad: sin ella no se podría restaurar en otra computadora. Descarga uno que la incluya.", codigo: "sin_llave" });
    const payload = await readJson(request);
    const contrasena = String(payload.contrasena ?? "");
    const debil = validarContrasena(contrasena);
    if (debil) throw new HttpError(400, { message: debil, campo: "contrasena" });
    if (String(payload.confirmacion ?? "") !== contrasena) throw new HttpError(400, { message: "Las dos contraseñas de cifrado no coinciden", campo: "confirmacion" });
    // Se comprueba que el respaldo esta completo antes de usar la reautenticacion y entregar el enlace.
    try {
      entradasDeRespaldo(carpeta);
    } catch (error) {
      if (error instanceof ErrorPortable) throw new HttpError(409, { message: error.message, codigo: error.codigo });
      throw error;
    }
    await withSession(async (s) => {
      try {
        await exigirReauth(s, request, user, "respaldos:descargar");
        await s.commit();
      } catch (error) {
        await s.rollback();
        throw error;
      }
    });
    const cifrado = await prepararCifrado(contrasena);
    const ahora = Date.now();
    for (const [token, d] of descargas) if (d.expira <= ahora) descargas.delete(token);
    const token = randomBytes(32).toString("base64url");
    descargas.set(token, { respaldoId: id, carpeta, cifrado, usuario: user, expira: ahora + DESCARGA_VIGENCIA_MS });
    return json({ url: `/api/respaldos/descargas/${token}`, nombre: nombreDescarga(id), vence_en: new Date(ahora + DESCARGA_VIGENCIA_MS).toISOString() });
  });
}

/*
 * GET /api/respaldos/descargas/:token: el archivo .ficotox, cifrado al vuelo.
 * El token (32 bytes al azar, de un solo uso, 2 minutos) es la autorizacion:
 * lo entrego el POST anterior a quien tiene respaldos:G y confirmo su contraseña.
 * Antes de mandar el primer byte queda en la bitacora.
 */
export async function descargarArchivo(_request: Request, params: { token?: string }): Promise<Response> {
  if (plataformaRestaurando()) return json({ message: "Restaurando la plataforma, vuelve en un momento", codigo: "restaurando" }, 503);
  const token = String(params.token || "");
  const descarga = /^[A-Za-z0-9_-]{43}$/.test(token) ? descargas.get(token) : undefined;
  if (descarga) descargas.delete(token);
  if (!descarga || descarga.expira <= Date.now()) return json({ message: "El enlace de descarga venció o ya se usó. Vuelve a pedir la descarga.", codigo: "descarga_vencida" }, 404);
  try {
    const entradas = entradasDeRespaldo(descarga.carpeta);
    const { archivo: tamano } = tamanoPortable(entradas, descarga.cifrado);
    await withSession(async (s) => {
      // Quien pidio el enlace debe seguir activo, con su sesion vigente y con respaldos:G (se revisa al usarlo).
      await requirePermission(s, descarga.usuario, "respaldos", "G");
      await registrarAuditoria(s, descarga.usuario, { accion: "descargar_respaldo", entidad: "respaldos", entidadId: descarga.respaldoId, referencia: descarga.respaldoId, detalle: { respaldo_id: descarga.respaldoId, archivo: nombreDescarga(descarga.respaldoId), tamano, archivos: entradas.length, cifrado: "AES-256-GCM, clave derivada con scrypt" } });
      await s.commit();
    });
    const flujo = Readable.toWeb(Readable.from(flujoPortable(entradas, descarga.cifrado))) as ReadableStream<Uint8Array>;
    return new Response(flujo, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(tamano),
        "Content-Disposition": `attachment; filename="${nombreDescarga(descarga.respaldoId)}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ErrorPortable) return json({ message: error.message, codigo: error.codigo }, 409);
    if (error instanceof HttpError) return json(error.body, error.status);
    console.error("[respaldos] No se pudo preparar la descarga:", error);
    return json({ message: "No se pudo preparar la descarga" }, 500);
  }
}

/* ---------- Importar (con la plataforma en uso) ---------- */

const duenoDe = (user: CurrentUser) => `usuario:${user.sub}`;

/* Respuestas de las rutas que no pasan por apiRoute (subidas en flujo y trabajos en segundo plano). */
async function responder(request: Request, fn: () => Promise<Response>): Promise<Response> {
  try {
    if (plataformaRestaurando()) return json({ message: "Restaurando la plataforma, vuelve en un momento", codigo: "restaurando" }, 503);
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) return json(error.body, error.status);
    if ((error as { status?: number })?.status === 503) return json({ message: "Restaurando la plataforma, vuelve en un momento", codigo: "restaurando" }, 503);
    console.error(`[api] ${request.method} ${new URL(request.url).pathname}`, error);
    return json({ message: "Error interno del servidor" }, 500);
  }
}

/* Quien puede importar: respaldos:G (la sesion solo se toma para comprobarlo). */
async function gestorDe(request: Request): Promise<CurrentUser> {
  return withSession(async (s) => {
    const user = await requireUser(request);
    await requirePermission(s, user, "respaldos", "G");
    exigirSqlite();
    return user;
  });
}

/* POST /api/respaldos/importar/subidas { tamano, nombre } → { subida, trozo } */
export function iniciarSubidaImportar(request: Request): Promise<Response> {
  return responder(request, async () => {
    const user = await gestorDe(request);
    const payload = await readJson(request);
    limpiarImportadosHuerfanos();
    return json(iniciarSubida(duenoDe(user), payload.tamano, payload.nombre), 201);
  });
}

/* PUT /api/respaldos/importar/subidas/:id?desde=N (cuerpo: el trozo, application/octet-stream) */
export function trozoImportar(request: Request, params: { id?: string }): Promise<Response> {
  return responder(request, async () => {
    const user = await gestorDe(request);
    return json(await agregarTrozo(params.id, duenoDe(user), new URL(request.url).searchParams.get("desde"), request));
  });
}

/*
 * POST /api/respaldos/importar { subida, contrasena } (respaldos:G +
 * reautenticacion respaldos:importar). Responde 202; el avance se consulta en
 * /api/respaldos/estado (trabajo «importacion»).
 */
export function importarRespaldoPost(request: Request): Promise<Response> {
  return responder(request, async () => {
    const payload = await readJson(request);
    const contrasena = String(payload.contrasena ?? "");
    const user = await gestorDe(request);
    if (!contrasena) throw new HttpError(400, { message: "Escribe la contraseña de cifrado del archivo", campo: "contrasena" });
    if (trabajoEnCurso()) throw new HttpError(409, { message: MENSAJE_OCUPADO, codigo: "respaldo_en_curso" });
    // La contraseña del archivo se comprueba antes de usar la reautenticacion (si esta mal, se corrige sin volver a
    // subir) y fuera de la sesion (scrypt no detiene a la plataforma).
    await comprobarContrasenaSubida(payload.subida, duenoDe(user), contrasena);
    const inicio = await withSession(async (s) => {
      try {
        await exigirReauth(s, request, user, "respaldos:importar");
        if (trabajoEnCurso()) throw new HttpError(409, { message: MENSAJE_OCUPADO, codigo: "respaldo_en_curso" });
        const subida = tomarSubida(payload.subida, duenoDe(user));
        const trabajo = iniciarTrabajo({ tipo: "importacion", respaldo_id: null, usuario: String(user.nombre || user.email || ""), etiqueta: null, fase: "Descifrando el archivo" });
        trabajo.progreso = 0;
        await s.commit();
        return { user, subida, trabajo };
      } catch (error) {
        await s.rollback();
        throw error;
      }
    });
    void ejecutarImportacion(inicio.user, inicio.subida, contrasena, inicio.trabajo);
    return json({ message: "Se empezó a importar el respaldo", trabajo: inicio.trabajo }, 202);
  });
}

/* Carpeta libre para un respaldo importado: su id original o, si ya hay uno con ese id aqui, <id>-2, <id>-3… */
function carpetaLibre(id: string): { id: string; carpeta: string } {
  for (let n = 1; n < 1000; n += 1) {
    const candidato = n === 1 ? id : `${id}-${n}`;
    const carpeta = path.join(/*turbopackIgnore: true*/ respaldosDir(), candidato);
    if (ID_RE.test(candidato) && !fs.existsSync(carpeta)) return { id: candidato, carpeta };
  }
  throw new ErrorPortable("sin_lugar", "No se encontró un nombre libre para el respaldo importado.");
}

export interface Importado {
  id: string;
  carpeta: string;
  manifest: Manifest;
  archivos: number;
  bytes: number;
}

/*
 * Descifra el archivo subido y coloca el respaldo en su carpeta, marcado
 * «verificando» (no aparece en la lista hasta que se marque «listo»). Si algo
 * falla, no queda nada. El archivo subido se borra siempre.
 */
export async function colocarImportado(subida: { ruta: string; nombre: string }, contrasena: string, trabajo: Trabajo, quien: string, modo: "app" | "instalacion"): Promise<Importado> {
  const staging = path.join(/*turbopackIgnore: true*/ carpetaImportando(), `${randomBytes(12).toString("hex")}.respaldo`);
  try {
    const abierto = await abrirPortable({ archivo: subida.ruta, contrasena, destino: staging, limiteBytes: limiteImportarBytes() * 2, alAvance: (f) => (trabajo.progreso = f) });
    const origenId = String(abierto.manifest?.id || "");
    if (!ID_RE.test(origenId)) throw new ErrorPortable("archivo_danado", "La ficha del respaldo no tiene un identificador válido.");
    const destino = carpetaLibre(origenId);
    // Marca «verificando» antes de moverlo: mientras tanto no se lista ni cuenta como dañado.
    fs.writeFileSync(path.join(/*turbopackIgnore: true*/ staging, ARCHIVO_IMPORTADO), `${JSON.stringify({ estado: "verificando", modo, importado_en: new Date().toISOString(), importado_por: quien, archivo: subida.nombre, origen_id: origenId, host_origen: abierto.manifest.host || null }, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(staging, destino.carpeta);
    hacerPrivado(destino.carpeta);
    return { id: destino.id, carpeta: destino.carpeta, manifest: abierto.manifest, archivos: abierto.archivos, bytes: abierto.bytes };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    throw error;
  } finally {
    borrarArchivo(subida.ruta);
    limpiarSubidas();
  }
}

/*
 * Importados que quedaron a medias (el servidor se detuvo mientras se
 * verificaban): siguen marcados «verificando», no se listan y nadie mas los
 * borraria. Sin ningun trabajo en curso no hay quien los vaya a terminar: se
 * borran al empezar otra subida.
 */
export function limpiarImportadosHuerfanos(): void {
  if (trabajoEnCurso()) return;
  let nombres: string[] = [];
  try {
    nombres = fs.readdirSync(respaldosDir());
  } catch {
    return;
  }
  for (const nombre of nombres) {
    if (!ID_RE.test(nombre)) continue;
    const carpeta = path.join(/*turbopackIgnore: true*/ respaldosDir(), nombre);
    try {
      const marca = JSON.parse(fs.readFileSync(path.join(/*turbopackIgnore: true*/ carpeta, ARCHIVO_IMPORTADO), "utf8"));
      if (marca?.estado !== "verificando") continue;
      fs.rmSync(carpeta, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      console.error(`[respaldos] se borró el importado a medias ${nombre} (quedó sin verificar)`);
    } catch {
      /* sin marca o ilegible: no es un importado a medias */
    }
  }
}

/* Marca un importado como listo (ya aparece en la lista) o lo borra si no paso. */
export function confirmarImportado(importado: Importado, listo: boolean): void {
  const marca = path.join(/*turbopackIgnore: true*/ importado.carpeta, ARCHIVO_IMPORTADO);
  if (listo) {
    const datos = JSON.parse(fs.readFileSync(marca, "utf8"));
    fs.writeFileSync(marca, `${JSON.stringify({ ...datos, estado: "listo" }, null, 2)}\n`, { mode: 0o600 });
  } else fs.rmSync(importado.carpeta, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  olvidarListaRespaldos();
}

/*
 * Motivo legible de una importacion o restauracion que no paso las
 * verificaciones: la frase de cada una que fallo y, si fue la de la llave, su
 * detalle (es el que explica que hacer). Termina en punto.
 */
export function razonDeActa(acta: Acta | null): string {
  if (!acta) return "La verificación del respaldo no pudo completarse.";
  const fallidas = actaLegible(acta).verificaciones.filter((v) => !v.ok);
  const llave = (acta.verificaciones as Array<{ n: number; ok: boolean; detalle?: string }> | undefined)?.find((v) => v.n === 4 && !v.ok);
  const frases = fallidas.map((v) => v.frase).join(" ") || "El respaldo no pasó las verificaciones.";
  return llave?.detalle ? `${frases} Detalle: ${llave.detalle.replace(/\.?$/, ".")}` : frases;
}

async function ejecutarImportacion(user: CurrentUser, subida: { ruta: string; nombre: string; tamano: number }, contrasena: string, trabajo: Trabajo): Promise<void> {
  const quien = String(user.nombre || user.email || "—");
  let importado: Importado | null = null;
  try {
    importado = await colocarImportado(subida, contrasena, trabajo, quien, "app");
    trabajo.respaldo_id = importado.id;
    trabajo.progreso = null;
    trabajo.fase = "Verificando el respaldo";
    // Las 8 verificaciones de siempre, en una copia aparte (modo prueba).
    const acta = await correrScriptRestauracion(trabajo, ["--respaldo", importado.id], { FICOTOX_RESTAURAR_SOLICITUD: JSON.stringify({ responsable: quien }) });
    if (acta) borrarCopiaRestaurada(acta.destino);
    const aprobado = acta?.resultado === "aprobada";
    confirmarImportado(importado, aprobado);
    const huella = huellaLlaveInstalacion();
    const llaveCoincide = !importado.manifest.llave?.huella || !huella ? null : importado.manifest.llave.huella === huella;
    const detalle = { respaldo_id: importado.id, origen_id: importado.manifest.id, creado_en: importado.manifest.creado_en, host_origen: importado.manifest.host || null, archivo: subida.nombre, tamano: subida.tamano, archivos: importado.archivos, acta: acta?.archivo || null, llave_coincide: llaveCoincide };
    if (aprobado) {
      terminarTrabajo(trabajo, { estado: "terminado", fase: "Respaldo importado", resultado: "aprobada", acta: acta?.archivo || null, pasos: actaLegible(acta!).verificaciones, mensaje: llaveCoincide === false ? "El respaldo se importó, pero se selló con otra llave del registro de actividad: no se puede restaurar en esta instalación." : null });
      await auditar(user, "importar_respaldo", importado.id, detalle);
    } else {
      const razon = razonDeActa(acta);
      terminarTrabajo(trabajo, { estado: "fallido", fase: "No se importó", resultado: acta ? "fallida" : null, acta: acta?.archivo || null, pasos: acta ? actaLegible(acta).verificaciones : trabajo.pasos, mensaje: `No se importó. ${razon} No quedó nada guardado.` });
      await auditar(user, "importar_respaldo_fallido", importado.manifest.id, { ...detalle, respaldo_id: null, razon });
    }
  } catch (error) {
    if (importado) confirmarImportado(importado, false);
    const portable = error instanceof ErrorPortable;
    if (!portable) console.error("[respaldos] No se pudo importar:", error);
    terminarTrabajo(trabajo, { estado: "fallido", fase: "No se importó", progreso: null, mensaje: portable ? `No se importó: ${error.message}` : "No se pudo importar el respaldo. Vuelve a intentarlo; si se repite, avisa al administrador técnico." });
    await auditar(user, "importar_respaldo_fallido", null, { archivo: subida.nombre, tamano: subida.tamano, codigo: portable ? error.codigo : "error", razon: portable ? error.message : "error interno" });
  }
}

async function auditar(user: CurrentUser | null, accion: AuditAction, id: string | null, detalle: Record<string, unknown>): Promise<void> {
  await withSession(async (s) => {
    await registrarAuditoria(s, user, { accion, entidad: "respaldos", entidadId: id, referencia: id || "Respaldo importado", detalle });
    await s.commit();
  }).catch((error: unknown) => console.error(`[respaldos] No se pudo registrar ${accion}:`, error));
}
