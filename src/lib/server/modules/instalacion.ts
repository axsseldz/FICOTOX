/*
 * Configuracion inicial (instalacion nueva). Mientras la base no tiene NINGUNA
 * cuenta, en lugar del acceso aparece /configuracion-inicial con dos caminos:
 *
 *   a) Empezar desde cero: crea el Administrador tecnico y la Responsable
 *      General (las altas de usuarios las aprueba la Responsable General: con
 *      una sola cuenta nadie podria aprobar la siguiente), con contraseña
 *      temporal que se cambia al primer acceso. Si la base nueva no tiene el
 *      catalogo de roles, antes se da de alta (seed-roles-usuarios.mjs).
 *   b) Restaurar desde un respaldo: se sube el archivo .ficotox descargado en
 *      Calidad › Respaldos, se descifra con su contraseña y se restaura con el
 *      script de siempre en modo real (8 verificaciones primero; si algo falla
 *      no se toca nada). La instalacion adopta la llave del respaldo de forma
 *      permanente (scripts/restaurar-ficotox.mjs, «adoptar_llave»).
 *
 * Proteccion:
 * - Codigo de instalacion FICOTOX_CODIGO_INSTALACION (.env, minimo 12
 *   caracteres). Sin el, la pantalla explica como definirlo y no deja seguir.
 *   Se compara en tiempo constante (SHA-256 de ambos y timingSafeEqual).
 * - Intentos: 5 codigos incorrectos en 15 minutos bloquean la configuracion 15
 *   minutos (en memoria del servidor; cada intento fallido queda en la bitacora).
 * - En cuanto la base tiene una cuenta, todas estas rutas responden 404 para
 *   siempre, aunque alguien conozca el codigo (las cuentas nunca se borran).
 * - Todo queda en la bitacora (actor: sistema).
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { registrarAuditoria } from "../audit";
import { getConfig } from "../config";
import { conBaseCerrada, isIntegrityError, plataformaRestaurando, withSession } from "../db";
import { HttpError, json, readJson } from "../http";
import { migrarAlArrancar } from "../migrar-arranque";
import { hashPassword } from "../password";
import { ipDe } from "../seguridad";
import { invalidarIndice } from "../busqueda/version";
import { agregarTrozo, comprobarContrasenaSubida, iniciarSubida, limiteImportarBytes, TROZO_SUBIDA, tomarSubida, borrarArchivo } from "../subidas";
import { domainErrorMessage, emailDomainAllowed } from "./admin";
import { actaLegible, correrScriptRestauracion, iniciarTrabajo, MENSAJE_OCUPADO, olvidarListaRespaldos, terminarTrabajo, trabajoEnCurso, type Trabajo } from "./respaldos";
import { colocarImportado, confirmarImportado, razonDeActa, type Importado } from "./respaldos-portables";
import { randomAvatar } from "../../shared/avatars";
import { archivoEnv } from "../../shared/respaldo.mjs";
import { CONTRASENA_MIN, ErrorPortable } from "../../shared/respaldo-portable.mjs";

export const CODIGO_MIN = 12;
const MAX_FALLOS = 5;
const VENTANA_MS = 15 * 60_000;
const BLOQUEO_MS = 15 * 60_000;
const DUENO = "instalacion";

interface EstadoInstalacion {
  fallos: number[];
  bloqueadaHasta: number;
  trabajo: Trabajo | null;
  /* Ya se configuro (en este proceso): las rutas responden 404 aunque la consulta a la base tarde. */
  terminada: boolean;
  /* Alta del catalogo de roles en curso (una sola a la vez). */
  sembrando: Promise<void> | null;
}
const global = globalThis as unknown as { __ficotoxInstalacion?: EstadoInstalacion };
const memoria = (global.__ficotoxInstalacion ||= { fallos: [], bloqueadaHasta: 0, trabajo: null, terminada: false, sembrando: null });

const NO_ENCONTRADA = () => new HttpError(404, { message: "Ruta no encontrada" });
const codigoConfigurado = () => String(process.env.FICOTOX_CODIGO_INSTALACION || "").trim();

/* ¿La base todavia no tiene ninguna cuenta? (sin la tabla, tampoco hay cuentas). */
export async function instalacionPendiente(): Promise<boolean> {
  if (memoria.terminada) return false;
  return withSession(async (s) => {
    try {
      return Number(await s.scalar("SELECT COUNT(*) FROM usuarios")) === 0;
    } catch {
      return false;
    }
  });
}

async function exigirPendiente(): Promise<void> {
  if (!(await instalacionPendiente())) throw NO_ENCONTRADA();
}

async function auditarSistema(accion: Parameters<typeof registrarAuditoria>[2]["accion"], referencia: string, detalle: Record<string, unknown>, motivo?: string): Promise<void> {
  await withSession(async (s) => {
    await registrarAuditoria(s, null, { accion, entidad: "instalacion", entidadId: null, referencia, motivo, detalle });
    await s.commit();
  }).catch((error: unknown) => console.error(`[instalacion] No se pudo registrar ${accion}:`, error));
}

/*
 * El codigo de instalacion: configurado, no bloqueado y correcto. Compara
 * SHA-256 de ambos con timingSafeEqual (mismo largo siempre: no revela nada por
 * el tiempo). Cada fallo cuenta; el quinto en 15 minutos bloquea 15 minutos.
 */
async function exigirCodigo(request: Request, valor: unknown): Promise<void> {
  const ahora = Date.now();
  if (memoria.bloqueadaHasta > ahora) throw new HttpError(429, { message: `Demasiados intentos con un código incorrecto. Espera ${Math.ceil((memoria.bloqueadaHasta - ahora) / 60_000)} minuto(s) y vuelve a intentarlo.`, codigo: "instalacion_bloqueada", reintentar_en: new Date(memoria.bloqueadaHasta).toISOString() });
  const configurado = codigoConfigurado();
  if (configurado.length < CODIGO_MIN) throw new HttpError(403, { message: configurado ? `El código de instalación del .env es demasiado corto (mínimo ${CODIGO_MIN} caracteres).` : "Esta instalación no tiene código de instalación (FICOTOX_CODIGO_INSTALACION en el .env).", codigo: configurado ? "codigo_corto" : "codigo_no_configurado" });
  const sha = (texto: string) => createHash("sha256").update(texto, "utf8").digest();
  if (timingSafeEqual(sha(String(valor ?? "").trim()), sha(configurado))) return;
  memoria.fallos = [...memoria.fallos.filter((t) => ahora - t < VENTANA_MS), ahora];
  const bloqueada = memoria.fallos.length >= MAX_FALLOS;
  if (bloqueada) {
    memoria.bloqueadaHasta = ahora + BLOQUEO_MS;
    memoria.fallos = [];
  }
  await auditarSistema("codigo_instalacion_incorrecto", "Configuración inicial", { ip: ipDe(request), bloqueada });
  if (bloqueada) throw new HttpError(429, { message: "Demasiados intentos con un código incorrecto: la configuración quedó bloqueada 15 minutos.", codigo: "instalacion_bloqueada", reintentar_en: new Date(memoria.bloqueadaHasta).toISOString() });
  throw new HttpError(401, { message: `El código de instalación no es correcto. Te quedan ${MAX_FALLOS - memoria.fallos.length} intento(s) antes de un bloqueo de 15 minutos.`, codigo: "codigo_incorrecto", campo: "codigo", intentos_restantes: MAX_FALLOS - memoria.fallos.length });
}

/* Ejecuta una ruta de la configuracion inicial: errores como JSON y 503 mientras se restaura. */
async function responder(request: Request, fn: () => Promise<Response>): Promise<Response> {
  try {
    if (plataformaRestaurando()) return json({ message: "Restaurando la plataforma, vuelve en un momento", codigo: "restaurando" }, 503);
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) return json(error.body, error.status);
    if ((error as { status?: number })?.status === 503) return json({ message: "Restaurando la plataforma, vuelve en un momento", codigo: "restaurando" }, 503);
    console.error(`[instalacion] ${request.method} ${new URL(request.url).pathname}`, error);
    return json({ message: "Error interno del servidor" }, 500);
  }
}

/* Lo que la pantalla puede saber del trabajo (sin rutas). */
const trabajoPublico = (t: Trabajo | null) => (t ? { estado: t.estado, fase: t.fase, progreso: t.progreso ?? null, pasos: t.pasos, resultado: t.resultado, mensaje: t.mensaje } : null);

/* GET /api/instalacion: si hace falta configurar y que falta para poder hacerlo. */
export function estadoInstalacionGet(request: Request): Promise<Response> {
  return (async () => {
    // Mientras se restaura la base esta cerrada: el avance sale de memoria.
    if (memoria.trabajo?.estado === "en_curso") return json({ pendiente: true, trabajo: trabajoPublico(memoria.trabajo) });
    return responder(request, async () => {
      await exigirPendiente();
      const codigo = codigoConfigurado();
      return json({
        pendiente: true,
        codigo_configurado: !!codigo,
        codigo_valido: codigo.length >= CODIGO_MIN,
        codigo_min: CODIGO_MIN,
        motor: getConfig().SQLITE_PATH ? "sqlite" : "mysql",
        bloqueada_hasta: memoria.bloqueadaHasta > Date.now() ? new Date(memoria.bloqueadaHasta).toISOString() : null,
        contrasena_min: CONTRASENA_MIN,
        limite_mb: Math.round(limiteImportarBytes() / 1048576),
        trozo: TROZO_SUBIDA,
        trabajo: trabajoPublico(memoria.trabajo),
      });
    });
  })();
}

/* POST /api/instalacion/codigo { codigo }: solo comprueba el codigo (primer paso de la pantalla). */
export function verificarCodigoPost(request: Request): Promise<Response> {
  return responder(request, async () => {
    await exigirPendiente();
    const payload = await readJson(request);
    await exigirCodigo(request, payload.codigo);
    return json({ ok: true });
  });
}

/* ---------- a) Empezar desde cero ---------- */

const temporal = () => `Fx-${randomBytes(9).toString("base64url")}-${randomBytes(3).toString("hex")}`;

interface CuentaNueva {
  clave: "admin_tecnico" | "responsable_general";
  rol: string;
  nombre: string;
  email: string;
}

function cuentaDe(valor: unknown, clave: CuentaNueva["clave"], rol: string, campo: string): CuentaNueva {
  const datos = (valor && typeof valor === "object" ? valor : {}) as Record<string, unknown>;
  const nombre = String(datos.nombre ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  const email = String(datos.email ?? "").trim().toLowerCase();
  if (nombre.length < 3) throw new HttpError(400, { message: `Escribe el nombre completo de quien será ${rol}`, campo: `${campo}-nombre` });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150) throw new HttpError(400, { message: `El correo de ${rol} no es válido`, campo: `${campo}-email` });
  if (!emailDomainAllowed(email)) throw new HttpError(400, { message: domainErrorMessage(), campo: `${campo}-email` });
  return { clave, rol, nombre, email };
}

/*
 * Las migraciones no crean los roles: en una base nueva se dan de alta con el
 * script de siempre (scripts/seed-roles-usuarios.mjs, roles-catalogo.json, sin
 * personas), como hacen instancia-nueva y el arranque vacio en Railway. El
 * script escribe en la base, asi que corre con la conexion del servidor cerrada
 * (unos segundos: la API responde 503 mientras tanto).
 */
async function asegurarRoles(): Promise<void> {
  const cuantos = async () => withSession(async (s) => Number(await s.scalar("SELECT COUNT(*) FROM roles WHERE clave IN ('admin_tecnico', 'responsable_general') AND activo = 1")));
  if ((await cuantos()) === 2) return;
  const cfg = getConfig();
  if (!cfg.SQLITE_PATH) throw new HttpError(409, { message: "La base no tiene los roles del catálogo. Con MySQL/MariaDB se dan de alta con npm run seed:roles antes de configurar (ver la guía de instalación).", codigo: "faltan_roles" });
  memoria.sembrando ||= (async () => {
    const vacio = path.join(/*turbopackIgnore: true*/ cfg.INSTANCE_DIR, `.usuarios-vacio-${randomBytes(6).toString("hex")}.json`);
    fs.writeFileSync(vacio, JSON.stringify({ usuarios: [] }), { mode: 0o600 });
    try {
      await conBaseCerrada(
        () =>
          new Promise<void>((resolve, reject) => {
            const script = path.join(/*turbopackIgnore: true*/ cfg.BASE_DIR, "scripts", "seed-roles-usuarios.mjs");
            const hijo = spawn(process.execPath, [script, "--db", cfg.SQLITE_PATH!, "--usuarios", vacio, "--motivo", "Configuración inicial"], { cwd: cfg.BASE_DIR, env: { ...process.env, FICOTOX_INSTANCE_DIR: cfg.INSTANCE_DIR, SQLITE_PATH: cfg.SQLITE_PATH! }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
            let salida = "";
            hijo.stdout.on("data", (d) => (salida = `${salida}${d}`.slice(-4000)));
            hijo.stderr.on("data", (d) => (salida = `${salida}${d}`.slice(-4000)));
            hijo.on("error", reject);
            hijo.on("exit", (codigo) => (codigo === 0 ? resolve() : reject(new Error(`seed-roles-usuarios.mjs terminó con ${codigo}: ${salida.trim()}`))));
          }),
      );
    } finally {
      fs.rmSync(vacio, { force: true });
      memoria.sembrando = null;
    }
  })();
  await memoria.sembrando;
  if ((await cuantos()) !== 2) throw new HttpError(500, { message: "No se pudieron dar de alta los roles del catálogo. Revisa el registro del servidor.", codigo: "faltan_roles" });
}

/*
 * POST /api/instalacion/cero { codigo, administrador: {nombre, email}, responsable: {nombre, email} }
 * Crea las dos cuentas con su rol (sin solicitud: no hay nadie mas que apruebe)
 * y contraseña temporal; las contraseñas se muestran UNA sola vez.
 */
export function empezarDesdeCeroPost(request: Request): Promise<Response> {
  return responder(request, async () => {
    await exigirPendiente();
    const payload = await readJson(request);
    await exigirCodigo(request, payload.codigo);
    if (trabajoEnCurso()) throw new HttpError(409, { message: MENSAJE_OCUPADO, codigo: "respaldo_en_curso" });
    const cuentas = [cuentaDe(payload.administrador, "admin_tecnico", "Administrador técnico", "administrador"), cuentaDe(payload.responsable, "responsable_general", "Responsable General", "responsable")];
    if (cuentas[0].email === cuentas[1].email) throw new HttpError(400, { message: "El Administrador técnico y la Responsable General deben ser dos personas distintas (correos distintos).", campo: "responsable-email" });
    const ip = ipDe(request);
    await asegurarRoles();
    const creadas = await withSession(async (s) => {
      try {
        // Dentro de la transaccion: si otra peticion ya creo cuentas, esta no hace nada.
        if (Number(await s.scalar("SELECT COUNT(*) FROM usuarios")) !== 0) throw NO_ENCONTRADA();
        const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Tijuana" });
        const out: Array<CuentaNueva & { contrasena: string }> = [];
        for (const c of cuentas) {
          const rolId = await s.scalar("SELECT id FROM roles WHERE clave = :clave AND activo = 1", { clave: c.clave });
          if (!rolId) throw new HttpError(500, { message: `Falta el rol «${c.rol}» en la base: las migraciones no terminaron. Reinicia FICOTOX y vuelve a intentarlo.`, codigo: "faltan_roles" });
          const contrasena = temporal();
          let id: number;
          try {
            const r = await s.execute(
              `INSERT INTO usuarios (nombre, email, activo, id_rol, password_hash, avatar, tipo_cuenta, motivo_ultimo_cambio, debe_cambiar_password)
               VALUES (:nombre, :email, 1, :rol, :hash, :avatar, 'permanente', :motivo, 1)`,
              { nombre: c.nombre, email: c.email, rol: Number(rolId), hash: hashPassword(contrasena), avatar: randomAvatar(), motivo: "Configuración inicial" },
            );
            id = Number(r.lastrowid);
          } catch (error) {
            if (isIntegrityError(error)) throw new HttpError(409, { message: "Ya existe una cuenta con ese correo" });
            throw error;
          }
          const asignacion = await s.execute("INSERT INTO usuario_roles (usuario_id, rol_id, vigente_desde, vigente_hasta, motivo, asignado_por, asignado_en) VALUES (:usuario, :rol, :desde, NULL, :motivo, NULL, :en)", { usuario: id, rol: Number(rolId), desde: hoy, motivo: "Configuración inicial", en: new Date().toISOString() });
          await registrarAuditoria(s, null, { accion: "crear", entidad: "usuarios", entidadId: id, referencia: c.email, motivo: "Configuración inicial: contraseña temporal que se cambia al primer acceso", detalle: { rol: c.rol, debe_cambiar_password: true } });
          await registrarAuditoria(s, null, { accion: "asignar_rol", entidad: "usuarios", entidadId: id, referencia: c.email, motivo: "Configuración inicial", detalle: { rol: c.rol, rol_id: Number(rolId), asignacion_id: Number(asignacion.lastrowid), vigente_desde: hoy, sin_solicitud: "configuración inicial (no hay otra cuenta que apruebe)" } });
          out.push({ ...c, contrasena });
        }
        await registrarAuditoria(s, null, { accion: "configuracion_inicial", entidad: "instalacion", entidadId: null, referencia: "Configuración inicial", motivo: "Instalación nueva desde cero", detalle: { modo: "cero", administrador: cuentas[0].email, responsable: cuentas[1].email, ip } });
        await s.commit();
        return out;
      } catch (error) {
        await s.rollback();
        throw error;
      }
    });
    memoria.terminada = true;
    invalidarIndice();
    return json({ cuentas: creadas.map((c) => ({ rol: c.rol, nombre: c.nombre, email: c.email, contrasena_temporal: c.contrasena })) }, 201);
  });
}

/* ---------- b) Restaurar desde un archivo .ficotox ---------- */

const exigirSqlite = () => {
  if (!getConfig().SQLITE_PATH) throw new HttpError(501, { message: "Con MySQL/MariaDB la base se recupera con mysqldump (ver la guía de instalación); aquí solo se puede empezar desde cero.", codigo: "respaldo_mysql" });
};

/* POST /api/instalacion/subidas { codigo, tamano, nombre } → { subida, trozo } */
export function iniciarSubidaInstalacion(request: Request): Promise<Response> {
  return responder(request, async () => {
    await exigirPendiente();
    exigirSqlite();
    const payload = await readJson(request);
    await exigirCodigo(request, payload.codigo);
    return json(iniciarSubida(DUENO, payload.tamano, payload.nombre), 201);
  });
}

/* PUT /api/instalacion/subidas/:id?desde=N (X-Codigo-Instalacion; cuerpo: el trozo) */
export function trozoInstalacion(request: Request, params: { id?: string }): Promise<Response> {
  return responder(request, async () => {
    await exigirPendiente();
    await exigirCodigo(request, request.headers.get("x-codigo-instalacion"));
    return json(await agregarTrozo(params.id, DUENO, new URL(request.url).searchParams.get("desde"), request));
  });
}

/* La llave adoptada en el .env vale desde ya en este proceso (el siguiente arranque la lee del archivo). */
function adoptarLlaveEnProceso(): void {
  const contenido = (() => {
    try {
      return fs.readFileSync(archivoEnv(getConfig().BASE_DIR), "utf8");
    } catch {
      return "";
    }
  })();
  for (const linea of contenido.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?SECRET_KEY\s*=(.*)$/.exec(linea);
    if (m) process.env.SECRET_KEY = m[1].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}

/*
 * POST /api/instalacion/restaurar { codigo, subida, contrasena }: responde 202;
 * el avance se consulta en GET /api/instalacion. Al terminar bien, la
 * instalacion ya tiene las cuentas del respaldo (y estas rutas responden 404).
 */
export function restaurarInicialPost(request: Request): Promise<Response> {
  return responder(request, async () => {
    await exigirPendiente();
    exigirSqlite();
    const payload = await readJson(request);
    await exigirCodigo(request, payload.codigo);
    const contrasena = String(payload.contrasena ?? "");
    if (!contrasena) throw new HttpError(400, { message: "Escribe la contraseña de cifrado del archivo", campo: "contrasena" });
    if (trabajoEnCurso()) throw new HttpError(409, { message: MENSAJE_OCUPADO, codigo: "respaldo_en_curso" });
    await comprobarContrasenaSubida(payload.subida, DUENO, contrasena);
    const subida = tomarSubida(payload.subida, DUENO);
    const trabajo = iniciarTrabajo({ tipo: "restauracion", respaldo_id: null, usuario: "Configuración inicial", etiqueta: null, fase: "Descifrando el archivo" });
    trabajo.progreso = 0;
    memoria.trabajo = trabajo;
    void ejecutarRestauracionInicial(subida, contrasena, trabajo, ipDe(request));
    return json({ trabajo: trabajoPublico(trabajo) }, 202);
  });
}

async function ejecutarRestauracionInicial(subida: { ruta: string; nombre: string; tamano: number }, contrasena: string, trabajo: Trabajo, ip: string): Promise<void> {
  let importado: Importado | null = null;
  try {
    importado = await colocarImportado(subida, contrasena, trabajo, "Configuración inicial", "instalacion");
    const id = importado.id;
    trabajo.respaldo_id = id;
    trabajo.progreso = null;
    trabajo.fase = "Verificando el respaldo";
    // El script de siempre en modo real: verifica primero (si algo falla no toca nada), respalda lo que hay, reemplaza y adopta la llave.
    const acta = await conBaseCerrada(async () => {
      const resultado = await correrScriptRestauracion(trabajo, ["--respaldo", id, "--destino", "instance", "--confirmar"], {
        FICOTOX_RESTAURAR_DESDE_SERVIDOR: String(process.pid),
        FICOTOX_RESTAURAR_SOLICITUD: JSON.stringify({ responsable: "Configuración inicial", motivo: "Configuración inicial: recuperar la plataforma en una instalación nueva", adoptar_llave: true }),
      });
      if (resultado?.restaurado && (resultado.llave_adoptada as { origen?: string } | null)?.origen === "SECRET_KEY") adoptarLlaveEnProceso();
      if (resultado?.restaurado) await migrarAlArrancar().catch((error: unknown) => console.error("[instalacion] Migración tras restaurar:", error));
      return resultado;
    });
    olvidarListaRespaldos();
    invalidarIndice();
    if (acta?.restaurado) {
      confirmarImportado(importado, true);
      memoria.terminada = true;
      const llave = acta.llave_adoptada as { origen?: string } | null;
      await auditarSistema("configuracion_inicial", "Configuración inicial", { modo: "restaurar", respaldo_id: id, origen_id: importado.manifest.id, host_origen: importado.manifest.host || null, creado_en: importado.manifest.creado_en, archivo: subida.nombre, acta: acta.archivo, llave_adoptada: llave?.origen || null, ip }, "Instalación nueva desde un respaldo");
      terminarTrabajo(trabajo, { estado: "terminado", fase: "Plataforma restaurada", resultado: "aprobada", acta: acta.archivo, pasos: actaLegible(acta).verificaciones });
      console.log(`[instalacion] Configuración inicial: plataforma restaurada desde el respaldo ${id}.`);
      return;
    }
    confirmarImportado(importado, false);
    const razon = razonDeActa(acta);
    terminarTrabajo(trabajo, { estado: "fallido", fase: "No se restauró", resultado: acta ? "fallida" : null, acta: acta?.archivo || null, pasos: acta ? actaLegible(acta).verificaciones : trabajo.pasos, mensaje: `No se restauró nada. ${razon} La instalación sigue vacía.` });
    await auditarSistema("configuracion_inicial_fallida", "Configuración inicial", { modo: "restaurar", origen_id: importado.manifest.id, archivo: subida.nombre, razon, acta: acta?.archivo || null, ip });
  } catch (error) {
    if (importado) confirmarImportado(importado, false);
    borrarArchivo(subida.ruta);
    const portable = error instanceof ErrorPortable;
    if (!portable) console.error("[instalacion] No se pudo restaurar:", error);
    terminarTrabajo(trabajo, { estado: "fallido", fase: "No se restauró", progreso: null, mensaje: portable ? `No se restauró nada: ${error.message}` : "No se pudo restaurar el respaldo. La instalación sigue vacía; vuelve a intentarlo." });
    await auditarSistema("configuracion_inicial_fallida", "Configuración inicial", { modo: "restaurar", archivo: subida.nombre, codigo: portable ? error.codigo : "error", razon: portable ? error.message : "error interno", ip });
  }
}
