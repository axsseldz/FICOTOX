/*
 * Cobertura · Administración, acceso/sesión y transversal (API). Cada check lleva la etiqueta
 * [cob:A:<id>] del renglón de la matriz que prueba (validaciones V-*, transiciones S-*,
 * endpoints E-*, la matriz de roles 5.1-5.3 y los avisos de la campana y del Inicio 5.4).
 * Solo usa cuentas propias (nombres únicos): las compartidas no cambian de contraseña, rol,
 * vigencia ni estado; los intentos fallidos van con IP propia (X-Forwarded-For) para no
 * bloquear la del servidor de pruebas. Al final las cuentas propias quedan de baja y los
 * roles propios inactivos.
 */
import "./lib/reauth-auto.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { analisisDe, api, cadena, credenciales, crearCheck, Database, EMAIL, enDias, fila, filas, hoy, sesiones } from "./lib/calidad.mjs";
import { pdfConTexto } from "./lib/archivos.mjs";
import { liberar } from "./lib/envio.mjs";
import { adjuntarEvidencia, pdfDePrueba } from "./lib/evidencia.mjs";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const s5 = Date.now().toString(36).slice(-5);
const SIN_APROBAR = { "X-Sin-Aprobar-Auto": "1" };
const SIN_REAUTH = { "X-Sin-Reauth-Auto": "1" };
const PASS = `Temporal-${s5}-2026`;
const ejecutar = (sql, ...p) => {
  const b = new Database(process.env.TEST_DB_PATH);
  try {
    b.prepare(sql).run(...p);
  } finally {
    b.close();
  }
};
// IP propia por bloque de intentos fallidos (TRUST_PROXY=true en el servidor de pruebas).
const ipBase = `10.${100 + Math.floor(Math.random() * 150)}.${Math.floor(Math.random() * 250)}`;
let ipN = 0;
const ipPropia = () => ({ "X-Forwarded-For": `${ipBase}.${(ipN += 1)}` });
const catalogoRoles = JSON.parse(readFileSync(new URL("../scripts/roles-catalogo.json", import.meta.url), "utf8")).roles;
const listaRoles = async () => (await api("GET", "/admin/roles", undefined, t.qa)).data?.items || [];
let roles = await listaRoles();
const rol = (clave) => roles.find((r) => r.clave === clave)?.id;
const detalle = (r) => `${r.status} ${r.data?.codigo || ""} ${String(r.data?.message || "").slice(0, 140)}`;

/* ---------- Cuentas y roles propios ---------- */
const creadas = [];
const rolesPropios = [];
async function cuenta(nombre, { rolClave = "tecnico_auxiliar", extra = {}, headers = {} } = {}) {
  const email = `cob.${nombre.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.${s5}@ficotox.local`;
  const r = await api("POST", "/admin/usuarios", { nombre: `Cob ${nombre} ${s5}`, email, activo: true, rol_id: rol(rolClave), departamento: "Laboratorio", password: PASS, motivo: "Alta de la prueba de cobertura", ...extra }, t.jorge, headers);
  const idc = Number(r.data?.id) || Number(fila("SELECT id FROM usuarios WHERE email = ?", email)?.id) || null;
  if (idc) {
    ejecutar("UPDATE usuarios SET debe_cambiar_password = 0 WHERE id = ?", idc);
    creadas.push(idc);
  }
  return { id: idc, email, nombre: `Cob ${nombre} ${s5}`, status: r.status, r };
}
const entrar = async (c, headers = {}) => (await api("POST", "/auth/login", { email: c.email, password: PASS }, undefined, headers)).data?.token;
async function rolPropio(nombre) {
  const r = await api("POST", "/admin/roles", { nombre: `Cob ${nombre} ${s5}`, descripcion: "Rol de la prueba de cobertura", motivo: "Rol de la prueba de cobertura", permisos: [] }, t.jorge);
  if (r.data?.id) rolesPropios.push(Number(r.data.id));
  return { id: Number(r.data?.id), nombre: `Cob ${nombre} ${s5}`, status: r.status };
}
/* Datos actuales de la cuenta (para PUT sin cambios no buscados). */
function datosDe(idc, extra = {}) {
  const f = fila("SELECT nombre, email, departamento, activo, tipo_cuenta, vigente_desde, vigente_hasta, supervisor_id FROM usuarios WHERE id = ?", idc);
  return { nombre: f.nombre, email: f.email, departamento: f.departamento, activo: !!Number(f.activo ?? 1), tipo_cuenta: f.tipo_cuenta || "permanente", vigente_desde: f.vigente_desde, vigente_hasta: f.vigente_hasta, supervisor_id: f.supervisor_id === null ? null : Number(f.supervisor_id), ...extra };
}
const usuario = (idc) => fila("SELECT * FROM usuarios WHERE id = ?", idc);
const asignacionDe = (idc, rolId) => fila("SELECT * FROM usuario_roles WHERE usuario_id = ? AND rol_id = ? AND revocado_en IS NULL ORDER BY id DESC LIMIT 1", idc, rolId);
const rechazar = (sol, quien = t.ana) => (sol ? api("POST", `/solicitudes/${sol}/rechazar`, { motivo: "Limpieza de la prueba de cobertura" }, quien) : null);

// La lista de Usuarios trae todas las cuentas activas aunque haya muchas bajas (antes: las 200 más nuevas, sin importar el estado,
// y las cuentas fundadoras eran las primeras en quedar fuera).
{
  const lista = (await api("GET", "/admin/usuarios", undefined, t.qa)).data?.items || [];
  const activas = filas("SELECT id FROM usuarios WHERE COALESCE(activo, 1) = 1").map((u) => Number(u.id));
  const enLista = new Set(lista.map((u) => Number(u.id)));
  const primeraBaja = lista.findIndex((u) => !Number(u.activo ?? 1));
  check("[cob:A:A-106] la lista de Usuarios incluye todas las cuentas activas (y las bajas después)", activas.every((x) => enLista.has(x)) && (primeraBaja === -1 || lista.slice(primeraBaja).every((u) => !Number(u.activo ?? 1))), `activas=${activas.length} lista=${lista.length}`);
}
const C = await cuenta("Base");
const T = await cuenta("Temporal", { extra: { tipo_cuenta: "temporal", vigente_desde: hoy(), vigente_hasta: enDias(60), supervisor_id: id.ricardo, motivo_cuenta: "Estancia de la prueba de cobertura" } });
const AP = await cuenta("Admin Propio", { rolClave: "admin_tecnico" });
const tC = await entrar(C);
const tAP = await entrar(AP);
check("(preparación) cuentas propias base, temporal y administrador", C.status === 201 && T.status === 201 && AP.status === 201 && !!tC && !!tAP && !!asignacionDe(AP.id, rol("admin_tecnico")), `${C.status} ${T.status} ${detalle(T.r)} ${AP.status}`);

/* ---------- Alta: correo, nombre, rol inicial, contraseña ---------- */
{
  const base = (extra) => ({ nombre: `Cob Alta ${s5}`, email: `cob.alta.${s5}@ficotox.local`, activo: true, rol_id: rol("tecnico_auxiliar"), password: PASS, motivo: "Alta de la prueba de cobertura", ...extra });
  const nadie = (email) => !fila("SELECT id FROM usuarios WHERE LOWER(email) = LOWER(?)", email);
  const sinEmail = await api("POST", "/admin/usuarios", base({ email: "" }), t.jorge);
  const editSinEmail = await api("PUT", `/admin/usuarios/${C.id}`, datosDe(C.id, { email: "" }), t.jorge);
  check("[cob:A:V-01] correo obligatorio: alta y edición sin correo → 400 «El email es obligatorio» (la cuenta conserva el suyo)", sinEmail.status === 400 && /email es obligatorio/i.test(sinEmail.data?.message) && editSinEmail.status === 400 && /email es obligatorio/i.test(editSinEmail.data?.message) && usuario(C.id).email === C.email, `${detalle(sinEmail)} | ${detalle(editSinEmail)}`);

  const ajeno = `cob.alta.${s5}@gmail.com`;
  const dominio = await api("POST", "/admin/usuarios", base({ email: ajeno }), t.jorge);
  // Una cuenta que ya tiene un correo de otro dominio se edita si lo conserva; cambiarlo a otro dominio ajeno no.
  const viejo = `cob.dominio.viejo.${s5}@ejemplo.org`;
  ejecutar("UPDATE usuarios SET email = ? WHERE id = ?", viejo, C.id);
  const conserva = await api("PUT", `/admin/usuarios/${C.id}`, datosDe(C.id, { departamento: "Laboratorio dominio" }), t.jorge);
  const cambia = await api("PUT", `/admin/usuarios/${C.id}`, datosDe(C.id, { email: `cob.otro.${s5}@ejemplo.org` }), t.jorge);
  ejecutar("UPDATE usuarios SET email = ? WHERE id = ?", C.email, C.id);
  check("[cob:A:V-02] dominio permitido (@cicese.mx, @ficotox.local): alta con @gmail.com → 400; editar conservando un correo ajeno sí; cambiarlo a otro ajeno → 400", dominio.status === 400 && /Solo puedes dar de alta correos de @cicese\.mx, @ficotox\.local/.test(dominio.data?.message) && nadie(ajeno) && conserva.status === 200 && cambia.status === 400 && /Solo puedes dar de alta/.test(cambia.data?.message), `${detalle(dominio)} | ${detalle(conserva)} | ${detalle(cambia)}`);

  const sinArroba = await api("POST", "/admin/usuarios", base({ email: `cob.sinarroba.${s5}` }), t.jorge);
  const dosArrobas = await api("POST", "/admin/usuarios", base({ email: `cob.uno@dos.${s5}@ficotox.local` }), t.jorge);
  check("[cob:A:V-03] formato del correo: sin «@» o con dos «@» → 400 campo email", sinArroba.status === 400 && sinArroba.data?.campo === "email" && dosArrobas.status === 400 && dosArrobas.data?.campo === "email" && nadie(`cob.uno@dos.${s5}@ficotox.local`), `${detalle(sinArroba)} | ${detalle(dosArrobas)}`);

  // Sin nombre el servidor toma la parte local del correo (heredado de Flask, users.ts): solo sin nombre ni correo responde 400.
  const sinNombre = await api("POST", "/admin/usuarios", base({ nombre: "  ", email: "" }), t.jorge);
  check("[cob:A:V-04] sin nombre (ni correo del que tomarlo) → 400 «El nombre es obligatorio»", sinNombre.status === 400 && /nombre es obligatorio/i.test(sinNombre.data?.message) && nadie(base().email), detalle(sinNombre));

  const sinRol = await api("POST", "/admin/usuarios", base({ rol_id: undefined }), t.jorge);
  const rolFalso = await api("POST", "/admin/usuarios", base({ rol_id: 999999 }), t.jorge);
  check("[cob:A:V-05] rol inicial obligatorio y existente → 400 y no se crea la cuenta", sinRol.status === 400 && /rol inicial/i.test(sinRol.data?.message) && rolFalso.status === 400 && nadie(base().email), `${detalle(sinRol)} | ${detalle(rolFalso)}`);

  const motivoCorto = await api("POST", "/admin/usuarios", base({ motivo: "abc" }), t.jorge);
  const asignarCorto = await api("POST", `/admin/usuarios/${C.id}/roles`, { rol_id: rol("tecnico_analista"), motivo: "abc" }, t.jorge, SIN_APROBAR);
  check("[cob:A:V-06] motivo de la asignación < 5 → 400 (alta: la cuenta no queda creada; asignar: sin solicitud)", motivoCorto.status === 400 && /motivo de la asignación/.test(motivoCorto.data?.message) && nadie(base().email) && asignarCorto.status === 400 && !fila("SELECT id FROM solicitudes_autorizacion WHERE entidad = 'usuarios' AND entidad_id = ? AND tipo = 'asignar_rol' AND estado = 'pendiente'", String(C.id)), `${detalle(motivoCorto)} | ${detalle(asignarCorto)}`);

  const sinClave = await api("POST", "/admin/usuarios", base({ password: "" }), t.jorge);
  check("[cob:A:V-07] contraseña inicial obligatoria → 400 «La contraseña es obligatoria»", sinClave.status === 400 && /contraseña es obligatoria/i.test(sinClave.data?.message) && nadie(base().email), detalle(sinClave));

  const corta = await api("POST", "/admin/usuarios", base({ password: "Corta-123" }), t.jorge);
  const cortaPropia = await api("POST", "/auth/password", { actual: PASS, nueva: "Corta-123" }, tC);
  check("[cob:A:V-08] contraseña < 10 caracteres → 400 (alta y cambio propio)", corta.status === 400 && /al menos 10/.test(corta.data?.message) && cortaPropia.status === 400 && /al menos 10/.test(cortaPropia.data?.message), `${detalle(corta)} | ${detalle(cortaPropia)}`);

  const local = `cob.clave.igual.${s5}`;
  const igualLocal = await api("POST", "/admin/usuarios", base({ email: `${local}@ficotox.local`, password: local }), t.jorge);
  const igualCorreo = await api("POST", "/admin/usuarios", base({ email: `${local}@ficotox.local`, password: `${local}@ficotox.local` }), t.jorge);
  const igualNombre = await api("POST", "/admin/usuarios", base({ nombre: `Nombre Clave ${s5}`, password: `nombreclave${s5}` }), t.jorge);
  const propiaIgual = await api("POST", "/auth/password", { actual: PASS, nueva: C.email.split("@")[0] }, tC);
  const simple = await cuenta("Clave Simple", { extra: { password: "aaaaaaaaaa" } });
  check("[cob:A:V-09] contraseña igual al correo, a su parte local o al nombre → 400; sin regla de complejidad (10 «a» se acepta)", [igualLocal, igualCorreo, igualNombre, propiaIgual].every((r) => r.status === 400 && /igual a tu correo ni a tu nombre/.test(r.data?.message)) && nadie(`${local}@ficotox.local`) && simple.status === 201, `${[igualLocal, igualCorreo, igualNombre, propiaIgual].map(detalle).join(" | ")} | simple ${simple.status}`);

  const duplicado = await api("POST", "/admin/usuarios", base({ email: EMAIL.luis }), t.jorge);
  const editDuplicado = await api("PUT", `/admin/usuarios/${C.id}`, datosDe(C.id, { email: EMAIL.luis }), t.jorge);
  check("[cob:A:V-25] correo duplicado → 409 «Ya existe un usuario con ese email» (alta y edición)", duplicado.status === 409 && /Ya existe un usuario con ese email/.test(duplicado.data?.message) && editDuplicado.status === 409 && usuario(C.id).email === C.email, `${detalle(duplicado)} | ${detalle(editDuplicado)}`);
}

/* ---------- Cambio de contraseña propio ---------- */
{
  const ip = ipPropia();
  const antes = Number(fila("SELECT COUNT(*) AS n FROM intentos_acceso WHERE usuario_id = ? AND exito = 0", C.id)?.n);
  const mala = await api("POST", "/auth/password", { actual: "No-es-la-actual-1", nueva: `Otra-${s5}-2026-x` }, tC, ip);
  const despues = Number(fila("SELECT COUNT(*) AS n FROM intentos_acceso WHERE usuario_id = ? AND exito = 0", C.id)?.n);
  const igual = await api("POST", "/auth/password", { actual: PASS, nueva: PASS }, tC);
  check("[cob:A:V-11] cambiar contraseña: la actual incorrecta → 401 y queda el intento fallido; la nueva igual a la actual → 400", mala.status === 401 && /actual no es correcta/.test(mala.data?.message) && despues === antes + 1 && igual.status === 400 && /distinta de la actual/.test(igual.data?.message), `${detalle(mala)} ${antes}->${despues} | ${detalle(igual)}`);
}

/* ---------- Cuenta temporal, fechas y supervisor ---------- */
let E, Inact;
{
  const alta = (extra) => api("POST", "/admin/usuarios", { nombre: `Cob Temporal Mal ${s5}`, email: `cob.temporal.mal.${s5}@ficotox.local`, activo: true, rol_id: rol("tecnico_auxiliar"), password: PASS, motivo: "Alta de la prueba de cobertura", tipo_cuenta: "temporal", vigente_hasta: enDias(30), supervisor_id: id.ricardo, motivo_cuenta: "Estancia de prueba", ...extra }, t.jorge);
  const nadie = () => !fila("SELECT id FROM usuarios WHERE email = ?", `cob.temporal.mal.${s5}@ficotox.local`);
  const sinSup = await alta({ supervisor_id: null });
  check("[cob:A:V-13] cuenta temporal sin supervisor → 400", sinSup.status === 400 && /necesita un supervisor/.test(sinSup.data?.message) && nadie(), detalle(sinSup));
  const sinFin = await alta({ vigente_hasta: null });
  check("[cob:A:V-14] cuenta temporal sin fecha de fin → 400", sinFin.status === 400 && /necesita fecha de fin/.test(sinFin.data?.message) && nadie(), detalle(sinFin));
  const finMal = await alta({ vigente_hasta: "15/01/2027" });
  const inicioMal = await alta({ vigente_desde: "2027/01/01" });
  check("[cob:A:V-15] fechas de la cuenta que no son AAAA-MM-DD → 400 (inicio y fin)", finMal.status === 400 && /fecha de fin de la cuenta no es válida/.test(finMal.data?.message) && inicioMal.status === 400 && /fecha de inicio de la cuenta no es válida/.test(inicioMal.data?.message) && nadie(), `${detalle(finMal)} | ${detalle(inicioMal)}`);
  // Una fecha con forma válida pero imposible (30 de febrero) también se rechaza (antes solo se revisaba el patrón).
  const imposible = await alta({ vigente_hasta: "2027-02-30" });
  check("[cob:A:V-15] fecha de fin imposible (2027-02-30) → 400", imposible.status === 400 && /fecha de fin de la cuenta no es válida/.test(imposible.data?.message) && nadie(), detalle(imposible));
  const invertida = await alta({ vigente_desde: enDias(30), vigente_hasta: enDias(10) });
  check("[cob:A:V-16] fin de la cuenta antes del inicio → 400", invertida.status === 400 && /termina antes de empezar/.test(invertida.data?.message) && nadie(), detalle(invertida));

  const propio = await api("PUT", `/admin/usuarios/${T.id}`, datosDe(T.id, { supervisor_id: T.id, motivo_cuenta: "Cambio de supervisor" }), t.jorge);
  check("[cob:A:V-17] nadie se supervisa a sí mismo → 400", propio.status === 400 && /supervisarse a sí mismo/.test(propio.data?.message) && Number(usuario(T.id).supervisor_id) === id.ricardo, detalle(propio));

  Inact = await cuenta("Inactiva");
  const baja = await api("DELETE", `/admin/usuarios/${Inact.id}`, { motivo: "Baja previa de la prueba de cobertura" }, t.jorge);
  const supInactivo = await api("PUT", `/admin/usuarios/${T.id}`, datosDe(T.id, { supervisor_id: Inact.id, motivo_cuenta: "Cambio de supervisor" }), t.jorge);
  const supTemporal = await api("PUT", `/admin/usuarios/${T.id}`, datosDe(T.id, { supervisor_id: id.diego, motivo_cuenta: "Cambio de supervisor" }), t.jorge);
  const supSinRA = await api("PUT", `/admin/usuarios/${T.id}`, datosDe(T.id, { supervisor_id: id.mariana, motivo_cuenta: "Cambio de supervisor" }), t.jorge);
  check("[cob:A:V-18] supervisor: inactivo, temporal o sin R/A en ensayos o muestras (Técnico Auxiliar) → 400; el supervisor no cambia", baja.status === 200 && supInactivo.status === 400 && /activa y vigente/.test(supInactivo.data?.message) && supTemporal.status === 400 && /cuenta permanente/.test(supTemporal.data?.message) && supSinRA.status === 400 && /R o A en ensayos o muestras/.test(supSinRA.data?.message) && Number(usuario(T.id).supervisor_id) === id.ricardo, `${baja.status} | ${detalle(supInactivo)} | ${detalle(supTemporal)} | ${detalle(supSinRA)}`);

  const sinMotivo = await api("PUT", `/admin/usuarios/${T.id}`, datosDe(T.id, { vigente_hasta: enDias(40) }), t.jorge);
  const conMotivo = await api("PUT", `/admin/usuarios/${T.id}`, datosDe(T.id, { vigente_hasta: enDias(40), motivo_cuenta: "Se acorta la estancia" }), t.jorge);
  check("[cob:A:V-19] cambiar la vigencia sin motivo → 400; con motivo se acorta (200)", sinMotivo.status === 400 && /motivo del cambio de vigencia o supervisor/.test(sinMotivo.data?.message) && conMotivo.status === 200 && usuario(T.id).vigente_hasta === enDias(40), `${detalle(sinMotivo)} | ${detalle(conMotivo)}`);

  const estPermanente = await api("POST", `/admin/usuarios/${C.id}/roles`, { rol_id: rol("estudiante"), motivo: "Rol de estudiante a permanente" }, t.jorge, SIN_APROBAR);
  E = await cuenta("Estudiante", { rolClave: "estudiante", extra: { tipo_cuenta: "temporal", vigente_hasta: enDias(90), supervisor_id: id.ricardo, motivo_cuenta: "Estancia de estudiante de la prueba" } });
  const aPermanente = await api("PUT", `/admin/usuarios/${E.id}`, datosDe(E.id, { tipo_cuenta: "permanente", vigente_hasta: null, motivo_cuenta: "Pasa a planta" }), t.jorge, SIN_APROBAR);
  check("[cob:A:V-20] estudiante solo en cuenta temporal: asignarlo a una permanente → 400; pasar a permanente una cuenta con estudiante → 400", estPermanente.status === 400 && /solo se asigna a cuentas temporales/.test(estPermanente.data?.message) && E.status === 201 && !!asignacionDe(E.id, rol("estudiante")) && aPermanente.status === 400 && /debe ser temporal/.test(aPermanente.data?.message) && usuario(E.id).tipo_cuenta === "temporal", `${detalle(estPermanente)} | alta ${E.status} | ${detalle(aPermanente)}`);
}

/* ---------- Asignar roles: existencia, vigencia, duplicados, solicitudes ---------- */
const R1 = await rolPropio("Uno");
const R2 = await rolPropio("Dos");
{
  const noExiste = await api("POST", `/admin/usuarios/${C.id}/roles`, { rol_id: 999999, motivo: "Rol que no existe" }, t.jorge, SIN_APROBAR);
  const Rin = await rolPropio("Inactivo");
  const desactiva = await api("PUT", `/admin/roles/${Rin.id}`, { nombre: Rin.nombre, descripcion: "Rol de la prueba de cobertura", activo: false, permisos: [], motivo: "Se desactiva para la prueba" }, t.jorge);
  const inactivo = await api("POST", `/admin/usuarios/${C.id}/roles`, { rol_id: Rin.id, motivo: "Rol inactivo" }, t.jorge, SIN_APROBAR);
  check("[cob:A:V-21] asignar un rol que no existe → 400; uno inactivo → 409", noExiste.status === 400 && /rol que exista/.test(noExiste.data?.message) && desactiva.status === 200 && inactivo.status === 409 && /inactivo/.test(inactivo.data?.message), `${detalle(noExiste)} | ${detalle(desactiva)} | ${detalle(inactivo)}`);

  const masAlla = await api("POST", `/admin/usuarios/${T.id}/roles`, { rol_id: R1.id, motivo: "Rol más allá de la cuenta", vigente_hasta: enDias(90) }, t.jorge, SIN_APROBAR);
  const antes = await api("POST", `/admin/usuarios/${T.id}/roles`, { rol_id: R1.id, motivo: "Rol antes de la cuenta", vigente_desde: enDias(-3) }, t.jorge, SIN_APROBAR);
  const pasado = await api("POST", `/admin/usuarios/${C.id}/roles`, { rol_id: R1.id, motivo: "Rol que ya terminó", vigente_desde: enDias(-10), vigente_hasta: enDias(-1) }, t.jorge, SIN_APROBAR);
  check("[cob:A:V-22] vigencia del rol fuera de la cuenta (fin después, inicio antes) o con fin en el pasado → 400", masAlla.status === 400 && /más allá de la vigencia de la cuenta/.test(masAlla.data?.message) && antes.status === 400 && /antes que la cuenta/.test(antes.data?.message) && pasado.status === 400 && /ya terminó/.test(pasado.data?.message), `${detalle(masAlla)} | ${detalle(antes)} | ${detalle(pasado)}`);

  const dup = await api("POST", `/admin/usuarios/${C.id}/roles`, { rol_id: rol("tecnico_auxiliar"), motivo: "Mismo rol otra vez" }, t.jorge, SIN_APROBAR);
  check("[cob:A:V-23] asignar un rol que ya tiene vigente → 409", dup.status === 409 && /ya tiene el rol/.test(dup.data?.message), detalle(dup));

  const s1 = await api("POST", `/admin/usuarios/${C.id}/roles`, { rol_id: R1.id, motivo: "Primer pedido del rol uno" }, t.jorge, SIN_APROBAR);
  const s1b = await api("POST", `/admin/usuarios/${C.id}/roles`, { rol_id: R1.id, motivo: "Segundo pedido del rol uno" }, t.jorge, SIN_APROBAR);
  const s2 = await api("POST", `/admin/usuarios/${C.id}/roles`, { rol_id: R2.id, motivo: "Pedido del rol dos" }, t.jorge, SIN_APROBAR);
  check("[cob:A:V-50] una solicitud pendiente por tipo y rol: el mismo rol otra vez → 409 solicitud_pendiente; otro rol sí (202)", s1.status === 202 && s1b.status === 409 && s1b.data?.codigo === "solicitud_pendiente" && s2.status === 202, `${detalle(s1)} | ${detalle(s1b)} | ${detalle(s2)}`);
  await rechazar(s1.data?.solicitud?.id);
  await rechazar(s2.data?.solicitud?.id);
}

/* ---------- Combinaciones prohibidas (reglas 1-4) ---------- */
const K1 = await cuenta("Coord Tecnica", { rolClave: "coord_area_tecnica" });
const K2 = await cuenta("Admin Auxiliar", { rolClave: "admin_auxiliar" });
const K3 = await cuenta("Auditor", { rolClave: "auditor_interno" });
{
  const prohibida = (r, regla) => r.status === 409 && r.data?.codigo === "COMBINACION_PROHIBIDA" && String(r.data?.message).includes(`Regla ${regla}`);
  const r1 = await api("POST", `/admin/usuarios/${K1.id}/roles`, { rol_id: rol("admin_tecnico"), motivo: "Administrador y coordinador" }, t.jorge, SIN_APROBAR);
  check("[cob:A:V-24] [cob:A:regla-1] usuarios:G (Administrador técnico) con ensayos C/E/R/A (Coord. Área Técnica) → 409 COMBINACION_PROHIBIDA regla 1", K1.status === 201 && prohibida(r1, 1), `${K1.status} ${detalle(r1)}`);
  const r2 = await api("POST", `/admin/usuarios/${K2.id}/roles`, { rol_id: rol("tecnico_analista"), motivo: "Compras y analista" }, t.jorge, SIN_APROBAR);
  check("[cob:A:V-24] [cob:A:regla-2] compras:G (Administrador/a Auxiliar) con ensayos C/E (Técnico Analista) → 409 regla 2", K2.status === 201 && prohibida(r2, 2), `${K2.status} ${detalle(r2)}`);
  const r3 = await api("POST", `/admin/usuarios/${K3.id}/roles`, { rol_id: rol("mejora_continua"), motivo: "Auditor y mejora continua" }, t.jorge, SIN_APROBAR);
  check("[cob:A:V-24] [cob:A:regla-3] Auditor Interno con Mejora Continua → 409 regla 3", K3.status === 201 && prohibida(r3, 3), `${K3.status} ${detalle(r3)}`);
  const r4 = await api("POST", `/admin/usuarios/${E.id}/roles`, { rol_id: rol("tecnico_auxiliar"), motivo: "Estudiante y auxiliar" }, t.jorge, SIN_APROBAR);
  check("[cob:A:V-24] [cob:A:regla-4] Estudiante con cualquier otro rol → 409 regla 4", prohibida(r4, 4), detalle(r4));
  // Ampliar los permisos de un rol que provocaría la regla 1 en quien lo tiene: 409 con los afectados.
  const R3 = await rolPropio("Tres");
  const asig = await api("POST", `/admin/usuarios/${K1.id}/roles`, { rol_id: R3.id, motivo: "Rol vacío para el coordinador" }, t.jorge);
  const amplia = await api("PUT", `/admin/roles/${R3.id}`, { nombre: R3.nombre, descripcion: "Rol de la prueba de cobertura", activo: true, permisos: [{ modulo: "usuarios", accion: "G", alcance: "total" }], motivo: "Se le da administración de usuarios" }, t.jorge, SIN_APROBAR);
  check("[cob:A:V-24] [cob:A:regla-1] [cob:A:E-04] ampliar un rol que provocaría la regla 1 → 409 con los afectados y el rol sin cambios", asig.status < 300 && amplia.status === 409 && amplia.data?.codigo === "COMBINACION_PROHIBIDA" && (amplia.data?.afectados || []).some((a) => a.email === K1.email) && Number(fila("SELECT COUNT(*) AS n FROM rol_acciones WHERE id_rol = ?", R3.id)?.n) === 0, `${asig.status} ${detalle(amplia)}`);
}

/* ---------- Roles: nombre, motivo, rol propio ---------- */
{
  const sinNombre = await api("POST", "/admin/roles", { nombre: " ", permisos: [] }, t.jorge);
  const dupCrear = await api("POST", "/admin/roles", { nombre: "técnico auxiliar", permisos: [] }, t.jorge);
  const dupEditar = await api("PUT", `/admin/roles/${R1.id}`, { nombre: R2.nombre.toUpperCase(), descripcion: "Rol de la prueba de cobertura", activo: true, permisos: [] }, t.jorge);
  const vacioEditar = await api("PUT", `/admin/roles/${R1.id}`, { nombre: "", activo: true, permisos: [] }, t.jorge);
  check("[cob:A:V-26] [cob:A:E-02] [cob:A:E-04] nombre de rol obligatorio (400) y único sin importar mayúsculas (409), al crear y al editar", sinNombre.status === 400 && dupCrear.status === 409 && dupEditar.status === 409 && vacioEditar.status === 400 && fila("SELECT nombre FROM roles WHERE id = ?", R1.id)?.nombre === R1.nombre, `${detalle(sinNombre)} | ${detalle(dupCrear)} | ${detalle(dupEditar)} | ${detalle(vacioEditar)}`);

  const sinMotivo = await api("PUT", `/admin/roles/${R1.id}`, { nombre: R1.nombre, descripcion: "Rol de la prueba de cobertura", activo: true, permisos: [{ modulo: "muestras", accion: "V", alcance: "total" }] }, t.jorge, SIN_APROBAR);
  const motivoCorto = await api("PUT", `/admin/roles/${R1.id}`, { nombre: R1.nombre, descripcion: "Rol de la prueba de cobertura", activo: true, permisos: [{ modulo: "muestras", accion: "V", alcance: "total" }], motivo: "abc" }, t.jorge, SIN_APROBAR);
  check("[cob:A:V-27] cambiar permisos de un rol sin motivo (o < 5) → 400 y el rol no cambia", sinMotivo.status === 400 && /motivo del cambio de permisos/.test(sinMotivo.data?.message) && motivoCorto.status === 400 && Number(fila("SELECT COUNT(*) AS n FROM rol_acciones WHERE id_rol = ?", R1.id)?.n) === 0, `${detalle(sinMotivo)} | ${detalle(motivoCorto)}`);

  // Jorge tiene vigente el rol de Administrador técnico: no puede ampliar sus permisos (no se crea solicitud).
  const admin = (await api("GET", `/admin/roles/${rol("admin_tecnico")}`, undefined, t.jorge)).data;
  const firmaAntes = filas("SELECT modulo, accion, alcance FROM rol_acciones WHERE id_rol = ? ORDER BY modulo, accion, alcance", rol("admin_tecnico")).map((f) => `${f.modulo}:${f.accion}:${f.alcance}`).join("|");
  const solicitudesAntes = Number(fila("SELECT COUNT(*) AS n FROM solicitudes_autorizacion WHERE entidad = 'roles' AND entidad_id = ?", String(rol("admin_tecnico")))?.n);
  const propio = await api("PUT", `/admin/roles/${rol("admin_tecnico")}`, { nombre: admin?.role?.nombre, descripcion: admin?.role?.descripcion, activo: true, permisos: [...(admin?.permisos || []).map((p) => ({ modulo: p.modulo, accion: p.accion, alcance: p.alcance })), { modulo: "compras", accion: "V", alcance: "total" }], motivo: "Ampliar mi propio rol" }, t.jorge, SIN_APROBAR);
  const firmaDespues = filas("SELECT modulo, accion, alcance FROM rol_acciones WHERE id_rol = ? ORDER BY modulo, accion, alcance", rol("admin_tecnico")).map((f) => `${f.modulo}:${f.accion}:${f.alcance}`).join("|");
  // Al aprobar: quien tiene el rol vigente no aprueba la ampliación de sus permisos.
  const RGP = await cuenta("Responsable Propio", { rolClave: "responsable_general" });
  const R4 = await rolPropio("Cuatro");
  const asig4 = await api("POST", `/admin/usuarios/${RGP.id}/roles`, { rol_id: R4.id, motivo: "Rol propio de la responsable" }, t.jorge);
  const sol = await api("PUT", `/admin/roles/${R4.id}`, { nombre: R4.nombre, descripcion: "Rol de la prueba de cobertura", activo: true, permisos: [{ modulo: "compras", accion: "V", alcance: "total" }], motivo: "Consulta de compras" }, t.jorge, SIN_APROBAR);
  const tRGP = await entrar(RGP);
  const aprueba = await api("POST", `/solicitudes/${sol.data?.solicitud?.id}/aprobar`, { motivo: "Apruebo mi propio rol" }, tRGP);
  check("[cob:A:V-28] [cob:A:E-04] no se editan los permisos de un rol propio: al pedirlo → 409 rol_propio (sin cambios ni solicitud); al aprobarlo quien lo tiene → 409 rol_propio", propio.status === 409 && propio.data?.codigo === "rol_propio" && firmaAntes === firmaDespues && Number(fila("SELECT COUNT(*) AS n FROM solicitudes_autorizacion WHERE entidad = 'roles' AND entidad_id = ?", String(rol("admin_tecnico")))?.n) === solicitudesAntes && asig4.status < 300 && sol.status === 202 && aprueba.status === 409 && aprueba.data?.codigo === "rol_propio" && Number(fila("SELECT COUNT(*) AS n FROM rol_acciones WHERE id_rol = ?", R4.id)?.n) === 0, `${detalle(propio)} | ${asig4.status} ${detalle(sol)} | ${detalle(aprueba)}`);
  await rechazar(sol.data?.solicitud?.id);
}

/* ---------- Autorizaciones FX-THF-AP ---------- */
{
  const otorgar = (body, quien = t.ricardo, usuarioId = C.id) => api("POST", `/admin/usuarios/${usuarioId}/autorizaciones`, { tipo: "actividad", clave: "recepcion", motivo: "Autorización de la prueba de cobertura", ...body }, quien);
  const cuantas = () => Number(fila("SELECT COUNT(*) AS n FROM autorizaciones_personal WHERE usuario_id = ?", C.id)?.n);
  const n0 = cuantas();
  const actividad = await otorgar({ clave: "inventada" });
  const metodo = await otorgar({ tipo: "metodo", clave: "inventado" });
  const equipo = await otorgar({ tipo: "equipo", clave: "999999" });
  const tipo = await otorgar({ tipo: "otra_cosa" });
  check("[cob:A:V-30] autorización: actividad o método fuera del catálogo, equipo inexistente o tipo inválido → 400", actividad.status === 400 && /actividad del catálogo/.test(actividad.data?.message) && metodo.status === 400 && /método del catálogo/.test(metodo.data?.message) && equipo.status === 400 && /equipo activo/.test(equipo.data?.message) && tipo.status === 400 && /Tipo de autorización inválido/.test(tipo.data?.message) && cuantas() === n0, [actividad, metodo, equipo, tipo].map(detalle).join(" | "));
  const formato = await otorgar({ vigente_desde: "2026/10/01" });
  const invertida = await otorgar({ vigente_desde: enDias(10), vigente_hasta: enDias(5) });
  check("[cob:A:V-31] autorización: fecha que no es AAAA-MM-DD o fin antes del inicio → 400", formato.status === 400 && /AAAA-MM-DD/.test(formato.data?.message) && invertida.status === 400 && /anterior al inicio/.test(invertida.data?.message) && cuantas() === n0, `${detalle(formato)} | ${detalle(invertida)}`);
  const motivo = await otorgar({ motivo: "abc" });
  check("[cob:A:V-32] autorización con motivo < 5 → 400", motivo.status === 400 && /motivo/.test(motivo.data?.message) && cuantas() === n0, detalle(motivo));
  const ok = await otorgar({});
  const otra = await otorgar({});
  check("[cob:A:V-33] la misma autorización vigente otra vez → 409", ok.status === 201 && otra.status === 409 && /ya tiene esa autorización/.test(otra.data?.message) && cuantas() === n0 + 1, `${detalle(ok)} | ${detalle(otra)}`);
  const aSiMismo = await otorgar({}, t.ricardo, id.ricardo);
  const revocarseA = await api("POST", `/admin/usuarios/${id.ricardo}/autorizaciones/1/revocar`, { motivo: "Me revoco a mí mismo" }, t.ricardo);
  check("[cob:A:V-34] nadie se otorga ni se revoca autorizaciones → 409 segregacion autorizacion_propia", aSiMismo.status === 409 && aSiMismo.data?.codigo === "segregacion" && aSiMismo.data?.clave === "autorizacion_propia" && revocarseA.status === 409 && revocarseA.data?.clave === "autorizacion_propia", `${detalle(aSiMismo)} | ${detalle(revocarseA)}`);
  const aid = ok.data?.item?.id;
  const corta = await api("POST", `/admin/usuarios/${C.id}/autorizaciones/${aid}/revocar`, { motivo: "abc" }, t.ricardo);
  const revoca = await api("POST", `/admin/usuarios/${C.id}/autorizaciones/${aid}/revocar`, { motivo: "Termina su capacitación" }, t.ricardo);
  const otraVez = await api("POST", `/admin/usuarios/${C.id}/autorizaciones/${aid}/revocar`, { motivo: "Termina su capacitación" }, t.ricardo);
  check("[cob:A:V-35] revocar autorización: motivo < 5 → 400; con motivo 200; ya revocada → 409", corta.status === 400 && revoca.status === 200 && otraVez.status === 409 && /ya estaba revocada/.test(otraVez.data?.message), `${detalle(corta)} | ${detalle(revoca)} | ${detalle(otraVez)}`);
}

/* ---------- Foto de perfil ---------- */
{
  const subir = (bytes, nombre = "foto.png", tipo = "image/png") => {
    const fd = new FormData();
    fd.append("archivo", new Blob([bytes], { type: tipo }), nombre);
    return api("POST", "/auth/me/foto", fd, tC);
  };
  const texto = await subir(Buffer.from("esto no es una imagen, es texto plano con extensión png"));
  const gif = await subir(Buffer.from("GIF89a\x40\x00\x40\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x40\x00\x40\x00\x00\x02\x02D\x01\x00;", "binary"), "foto.gif", "image/gif");
  check("[cob:A:V-36] [cob:A:E-29] foto: texto o GIF (aunque se llame .png) → 400 formato_no_permitido y sin foto", texto.status === 400 && texto.data?.codigo === "formato_no_permitido" && gif.status === 400 && gif.data?.codigo === "formato_no_permitido" && !usuario(C.id).foto, `${detalle(texto)} | ${detalle(gif)}`);
  const grande = Buffer.alloc(6 * 1024 * 1024, 7);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(grande);
  const pesada = await subir(grande);
  check("[cob:A:V-37] [cob:A:E-29] foto de más de 5 MB → 413 archivo_grande", pesada.status === 413 && pesada.data?.codigo === "archivo_grande" && !usuario(C.id).foto, detalle(pesada));
  const chica = await subir(await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer());
  const sinMultipart = await api("POST", "/auth/me/foto", { archivo: "foto.png" }, tC);
  const jpeg = await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 200, g: 90, b: 40 } } }).jpeg().withMetadata({ exif: { IFD0: { Copyright: "Cobertura FICOTOX", Make: "Camara" } } }).toBuffer();
  const buena = await subir(jpeg, "foto.jpg", "image/jpeg");
  const f512 = await fetch(`${process.env.BASE}/cuentas/${C.id}/foto?tam=512`, { headers: { Authorization: `Bearer ${tC}` } });
  const f128 = await fetch(`${process.env.BASE}/cuentas/${C.id}/foto?tam=128`, { headers: { Authorization: `Bearer ${tC}` } });
  const m512 = f512.ok ? await sharp(Buffer.from(await f512.arrayBuffer())).metadata() : {};
  const m128 = f128.ok ? await sharp(Buffer.from(await f128.arrayBuffer())).metadata() : {};
  check("[cob:A:V-38] [cob:A:E-29] foto: menos de 64 px → 400; sin multipart → 400; una válida se guarda como WEBP de 512 y 128 px sin EXIF", chica.status === 400 && /entre 64 y 6000/.test(chica.data?.message) && sinMultipart.status === 400 && /como archivo/.test(sinMultipart.data?.message) && buena.status === 200 && f512.headers.get("content-type") === "image/webp" && m512.format === "webp" && m512.width === 512 && m512.height === 512 && m128.width === 128 && m128.height === 128 && !m512.exif, `${detalle(chica)} | ${detalle(sinMultipart)} | ${detalle(buena)} | ${f512.status} ${m512.format} ${m512.width}x${m512.height} exif=${!!m512.exif} ${m128.width}`);
  const corta = await api("DELETE", `/admin/usuarios/${C.id}/foto`, { motivo: "abc" }, t.jorge, SIN_REAUTH);
  const sinG = await api("DELETE", `/admin/usuarios/${C.id}/foto`, { motivo: "Foto que no corresponde" }, t.luis, SIN_REAUTH);
  const noHay = await api("DELETE", "/admin/usuarios/999999/foto", { motivo: "Foto que no corresponde" }, t.jorge, SIN_REAUTH);
  const quita = await api("DELETE", `/admin/usuarios/${C.id}/foto`, { motivo: "Foto que no corresponde" }, t.jorge, SIN_REAUTH);
  const bit = fila("SELECT motivo FROM auditoria WHERE entidad = 'usuarios' AND entidad_id = ? AND cambios_json LIKE '%quitada_por_otro%' ORDER BY id DESC LIMIT 1", String(C.id));
  check("[cob:A:V-39] [cob:A:E-12] quitar la foto de otra persona: motivo < 5 → 400 campo motivo; sin usuarios:G → 403; cuenta inexistente → 404; con motivo 200 sin pedir contraseña y queda en la bitácora", corta.status === 400 && corta.data?.campo === "motivo" && sinG.status === 403 && noHay.status === 404 && quita.status === 200 && !usuario(C.id).foto && bit?.motivo === "Foto que no corresponde", `${detalle(corta)} | ${detalle(sinG)} | ${detalle(noHay)} | ${detalle(quita)} | ${bit?.motivo}`);
}

/* ---------- Acceso: login y bloqueo por intentos ---------- */
{
  const sinCorreo = await api("POST", "/auth/login", { email: "", password: "algo-largo-123" }, undefined, ipPropia());
  const sinClave = await api("POST", "/auth/login", { email: C.email, password: "" }, undefined, ipPropia());
  check("[cob:A:V-40] [cob:A:E-21] login con correo o contraseña vacíos → 400", sinCorreo.status === 400 && /correo es obligatorio/.test(sinCorreo.data?.message) && sinClave.status === 400 && /contraseña es obligatoria/.test(sinClave.data?.message), `${detalle(sinCorreo)} | ${detalle(sinClave)}`);

  const L = await cuenta("Bloqueo");
  const ip = ipPropia();
  const fallos = [];
  for (let i = 0; i < 5; i += 1) fallos.push(await api("POST", "/auth/login", { email: L.email, password: `Mala-${i}-contraseña` }, undefined, ip));
  const bloqueada = await api("POST", "/auth/login", { email: L.email, password: PASS }, undefined, ip);
  const hasta = usuario(L.id).bloqueado_hasta;
  const bitBloqueo = fila("SELECT id FROM auditoria WHERE accion = 'bloquear' AND entidad_id = ?", String(L.id));
  const desbloqueoCorto = await api("POST", `/admin/usuarios/${L.id}/desbloquear`, { motivo: "abc" }, t.jorge);
  const desbloqueo = await api("POST", `/admin/usuarios/${L.id}/desbloquear`, { motivo: "Olvidó su contraseña" }, t.jorge);
  const otraVez = await api("POST", "/auth/login", { email: L.email, password: PASS }, undefined, ip);
  check("[cob:A:V-41] 5 fallos bloquean la cuenta: la contraseña correcta → 401 con el mismo mensaje; queda «bloquear» en la bitácora; al desbloquear entra", fallos.every((r) => r.status === 401) && bloqueada.status === 401 && bloqueada.data?.message === fallos[0].data?.message && !!hasta && Date.parse(hasta) > Date.now() && !!bitBloqueo && desbloqueo.status === 200 && otraVez.status === 200, `${fallos.map((r) => r.status).join(",")} ${detalle(bloqueada)} ${hasta} ${desbloqueo.status} ${detalle(otraVez)}`);
  check("[cob:A:V-44] desbloquear con motivo < 5 → 400", desbloqueoCorto.status === 400 && /motivo del desbloqueo/.test(desbloqueoCorto.data?.message), detalle(desbloqueoCorto));

  // Un correo que no existe también se bloquea: el 6.º intento ya no se registra (mismo 401).
  const fantasma = `cob.no.existe.${s5}@ficotox.local`;
  const ipF = ipPropia();
  for (let i = 0; i < 5; i += 1) await api("POST", "/auth/login", { email: fantasma, password: `Mala-${i}-contraseña` }, undefined, ipF);
  const n5 = Number(fila("SELECT COUNT(*) AS n FROM intentos_acceso WHERE email = ?", fantasma)?.n);
  const sexto = await api("POST", "/auth/login", { email: fantasma, password: "Mala-6-contraseña" }, undefined, ipF);
  const n6 = Number(fila("SELECT COUNT(*) AS n FROM intentos_acceso WHERE email = ?", fantasma)?.n);
  check("[cob:A:V-41] un correo inexistente se bloquea igual (5 fallos; el 6.º responde el mismo 401 y ya no cuenta)", n5 === 5 && sexto.status === 401 && n6 === 5, `${n5} ${detalle(sexto)} ${n6}`);

  // Por IP: 20 fallos desde la misma IP bloquean esa IP (429), aun con una cuenta y contraseña correctas.
  const ipI = ipPropia();
  for (let i = 0; i < 20; i += 1) await api("POST", "/auth/login", { email: `cob.ip.${s5}.${i}@ficotox.local`, password: "Mala-contraseña-1" }, undefined, ipI);
  const ipBloq = await api("POST", "/auth/login", { email: L.email, password: PASS }, undefined, ipI);
  const otraIp = await api("POST", "/auth/login", { email: L.email, password: PASS }, undefined, ipPropia());
  check("[cob:A:V-41] 20 fallos desde una IP → 429 ip_bloqueada para esa IP (otra IP entra)", ipBloq.status === 429 && ipBloq.data?.codigo === "ip_bloqueada" && otraIp.status === 200, `${detalle(ipBloq)} | ${detalle(otraIp)}`);
}

/* ---------- Reautenticación ---------- */
{
  const reauth = (token, accion, password = PASS) => api("POST", "/auth/reauth", { accion, password }, token, ipPropia());
  const sinFormato = await reauth(tAP, "borrar todo");
  const sinAccion = await reauth(tAP, "usuarios");
  check("[cob:A:V-42] [cob:A:E-25] reautenticar con una acción sin formato modulo:accion → 400", sinFormato.status === 400 && sinAccion.status === 400 && /acción que vas a confirmar/.test(sinFormato.data?.message), `${detalle(sinFormato)} | ${detalle(sinAccion)}`);

  const desbloquear = (headers) => api("POST", `/admin/usuarios/${K3.id}/desbloquear`, { motivo: "Prueba de la reautenticación" }, tAP, { ...SIN_REAUTH, ...headers });
  const sin = await desbloquear({});
  const otraAccion = await desbloquear({ "X-Reauth": (await reauth(tAP, "usuarios:baja")).data?.token });
  const deJorge = (await api("POST", "/auth/reauth", { accion: "usuarios:desbloquear", password: credenciales[EMAIL.jorge] }, t.jorge)).data?.token;
  const ajeno = await desbloquear({ "X-Reauth": deJorge });
  const buena = (await reauth(tAP, "usuarios:desbloquear")).data?.token;
  const usa = await desbloquear({ "X-Reauth": buena });
  const reusa = await desbloquear({ "X-Reauth": buena });
  const vieja = (await reauth(tAP, "usuarios:desbloquear")).data?.token;
  ejecutar("UPDATE reautenticaciones SET expira_en = ? WHERE token_hash = ?", new Date(Date.now() - 1000).toISOString(), createHash("sha256").update(String(vieja)).digest("hex"));
  const vencida = await desbloquear({ "X-Reauth": vieja });
  const falso = await desbloquear({ "X-Reauth": "0".repeat(64) });
  const invalido = (r, re) => r.status === 401 && r.data?.codigo === "reauth_invalido" && re.test(r.data?.message);
  check("[cob:A:V-43] token de reautenticación: sin él → 401 reauth_required; de otra acción, de otra persona, usado, vencido o inexistente → 401 reauth_invalido; el válido una sola vez", sin.status === 401 && sin.data?.codigo === "reauth_required" && sin.data?.accion === "usuarios:desbloquear" && invalido(otraAccion, /otra acción/) && invalido(ajeno, /otra persona/) && usa.status === 200 && invalido(reusa, /ya se usó/) && invalido(vencida, /venció/) && invalido(falso, /no existe/), [sin, otraAccion, ajeno, usa, reusa, vencida, falso].map(detalle).join(" | "));
}

/* ---------- Motivo y «no a sí mismo» en baja, restablecer y roles ---------- */
{
  const passAntes = usuario(K2.id).password_hash;
  const asig = asignacionDe(K2.id, rol("admin_auxiliar"));
  const baja = await api("DELETE", `/admin/usuarios/${K2.id}`, { motivo: "abc" }, t.jorge);
  const restablecer = await api("POST", `/admin/usuarios/${K2.id}/password`, { motivo: "abc" }, t.jorge);
  const revocar = await api("POST", `/admin/usuarios/${K2.id}/roles/${asig?.id}/revocar`, { motivo: "abc" }, t.jorge);
  check("[cob:A:V-44] baja, restablecer contraseña y revocar rol con motivo < 5 → 400 sin cambios", baja.status === 400 && restablecer.status === 400 && revocar.status === 400 && Number(usuario(K2.id).activo) === 1 && usuario(K2.id).password_hash === passAntes && !asignacionDe(K2.id, rol("admin_auxiliar"))?.revocado_en, `${detalle(baja)} | ${detalle(restablecer)} | ${detalle(revocar)}`);

  const miAsig = asignacionDe(AP.id, rol("admin_tecnico"));
  const yoBaja = await api("DELETE", `/admin/usuarios/${AP.id}`, { motivo: "Me doy de baja yo" }, tAP, SIN_REAUTH);
  const yoRestablecer = await api("POST", `/admin/usuarios/${AP.id}/password`, { motivo: "Me restablezco yo" }, tAP, SIN_REAUTH);
  const yoAsignar = await api("POST", `/admin/usuarios/${AP.id}/roles`, { rol_id: R1.id, motivo: "Me asigno un rol" }, tAP, { ...SIN_REAUTH, ...SIN_APROBAR });
  const yoRevocar = await api("POST", `/admin/usuarios/${AP.id}/roles/${miAsig?.id}/revocar`, { motivo: "Me quito el rol" }, tAP, SIN_REAUTH);
  check("[cob:A:V-45] baja, restablecer contraseña, asignar o revocar rol sobre uno mismo → 403", yoBaja.status === 403 && yoRestablecer.status === 403 && yoAsignar.status === 403 && yoRevocar.status === 403 && Number(usuario(AP.id).activo) === 1 && !asignacionDe(AP.id, rol("admin_tecnico"))?.revocado_en, [yoBaja, yoRestablecer, yoAsignar, yoRevocar].map(detalle).join(" | "));

  const hashAntes = usuario(AP.id).password_hash;
  const tvAntes = Number(usuario(AP.id).token_version || 0);
  const propia = await api("PUT", `/admin/usuarios/${AP.id}`, datosDe(AP.id, { password: `Nueva-${s5}-Propia-1` }), tAP, SIN_REAUTH);
  check("[cob:A:V-12] la propia contraseña no se cambia por Administración → 400 (sin cambios)", propia.status === 400 && /Mi cuenta/.test(propia.data?.message) && usuario(AP.id).password_hash === hashAntes && Number(usuario(AP.id).token_version || 0) === tvAntes, detalle(propia));

  const reactiva = await api("PUT", `/admin/usuarios/${Inact.id}`, datosDe(Inact.id, { activo: true }), t.jorge, SIN_APROBAR);
  check("[cob:A:V-46] reactivar sin motivo: el servidor lo acepta (202) con el motivo «Reactivación de la cuenta» y la cuenta sigue inactiva hasta aprobarla", reactiva.status === 202 && reactiva.data?.solicitud?.tipo === "reactivar_cuenta" && reactiva.data?.solicitud?.motivo === "Reactivación de la cuenta" && Number(usuario(Inact.id).activo) === 0, detalle(reactiva));
  await rechazar(reactiva.data?.solicitud?.id);
}

/* ---------- Mi cuenta: cargo, tema, avatar ---------- */
{
  const ajeno = await api("PUT", "/auth/me/cargo", { rol_id: rol("admin_tecnico") }, tC);
  const propio = await api("PUT", "/auth/me/cargo", { rol_id: rol("tecnico_auxiliar") }, tC);
  const ninguno = await api("PUT", "/auth/me/cargo", { rol_id: null }, tC);
  check("[cob:A:V-47] cargo predeterminado: un rol que no es suyo → 400; uno de sus roles vigentes o ninguno → 200", ajeno.status === 400 && /tus roles vigentes/.test(ajeno.data?.message) && propio.status === 200 && Number(propio.data?.cargo_predeterminado) === rol("tecnico_auxiliar") && ninguno.status === 200 && usuario(C.id).cargo_predeterminado === null, `${detalle(ajeno)} | ${detalle(propio)} | ${detalle(ninguno)}`);

  const bitacora = () => Number(fila("SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'usuarios' AND entidad_id = ?", String(C.id))?.n);
  const b0 = bitacora();
  const mal = await api("PUT", "/auth/me/tema", { tema: "rosa" }, tC);
  const bien = await api("PUT", "/auth/me/tema", { tema: "oscuro" }, tC);
  const sinSesion = await api("PUT", "/auth/me/tema", { tema: "claro" });
  check("[cob:A:V-48] [cob:A:E-33] tema: «rosa» → 400; «oscuro» se guarda (200) sin entrada en la bitácora; sin sesión → 401", mal.status === 400 && bien.status === 200 && usuario(C.id).tema === "oscuro" && bitacora() === b0 && sinSesion.status === 401, `${detalle(mal)} | ${detalle(bien)} | ${bitacora()}/${b0} | ${sinSesion.status}`);

  const b1 = bitacora();
  const avatarMal = await api("PUT", "/auth/me/avatar", { avatar: "dragon-inexistente" }, tC);
  const avatarBien = await api("PUT", "/auth/me/avatar", { avatar: "pulpo" }, tC);
  check("[cob:A:E-34] avatar: uno fuera del catálogo → 400; «pulpo» → 200 y queda en la bitácora", avatarMal.status === 400 && avatarBien.status === 200 && usuario(C.id).avatar === "pulpo" && bitacora() === b1 + 1, `${detalle(avatarMal)} | ${detalle(avatarBien)} | ${bitacora()}/${b1}`);
}

/* ---------- Búsqueda: recientes ---------- */
{
  const sinSesion = [await api("GET", "/busqueda/recientes"), await api("POST", "/busqueda/recientes", { tipo: "consulta", texto: "hola" }), await api("DELETE", "/busqueda/recientes?todos=1")];
  check("[cob:A:E-36] [cob:A:E-37] [cob:A:E-38] recientes sin sesión (GET, POST, DELETE) → 401", sinSesion.every((r) => r.status === 401), sinSesion.map((r) => r.status).join(","));
  const larga = await api("GET", `/busqueda?q=${encodeURIComponent("reactivo ".repeat(40))}`, undefined, tC);
  for (let i = 0; i < 35; i += 1) await api("POST", "/busqueda/recientes", { tipo: "consulta", texto: `consulta cobertura ${String(i).padStart(2, "0")}` }, tC);
  const guardados = Number(fila("SELECT COUNT(*) AS n FROM busqueda_recientes WHERE usuario_id = ?", C.id)?.n);
  const lista = await api("GET", "/busqueda/recientes", undefined, tC);
  const masReciente = lista.data?.items?.[0];
  check("[cob:A:V-49] [cob:A:E-36] [cob:A:E-37] búsqueda con q de 360 caracteres responde (se recorta a 120); se guardan 30 recientes y se muestran 8 (el último primero)", larga.status === 200 && guardados === 30 && lista.status === 200 && lista.data?.items?.length === 8 && masReciente?.titulo === "consulta cobertura 34", `${larga.status} guardados=${guardados} ${lista.data?.items?.length} ${masReciente?.titulo}`);
  const sinId = await api("DELETE", "/busqueda/recientes", undefined, tC);
  const quita = await api("DELETE", `/busqueda/recientes?id=${masReciente?.id}`, undefined, tC);
  const quedan = Number(fila("SELECT COUNT(*) AS n FROM busqueda_recientes WHERE usuario_id = ?", C.id)?.n);
  const todos = await api("DELETE", "/busqueda/recientes?todos=1", undefined, tC);
  const nada = Number(fila("SELECT COUNT(*) AS n FROM busqueda_recientes WHERE usuario_id = ?", C.id)?.n);
  check("[cob:A:E-38] quitar recientes: sin id → 400; ?id= quita uno; ?todos=1 los borra", sinId.status === 400 && quita.status === 200 && quedan === 29 && todos.status === 200 && nada === 0, `${detalle(sinId)} ${quita.status} ${quedan} ${todos.status} ${nada}`);
}

/* ---------- Notificaciones, accesos, personal y rutas desconocidas ---------- */
{
  const sinSesion = await api("POST", "/notificaciones/leidas", { claves: ["cob:prueba"] });
  const vacia = await api("POST", "/notificaciones/leidas", { claves: [] }, tC);
  const clave = `cob:prueba:${s5}`;
  const marca = await api("POST", "/notificaciones/leidas", { claves: [clave] }, tC);
  check("[cob:A:E-40] marcar notificaciones leídas: sin sesión → 401; sin claves → 400; con claves → 200 y quedan guardadas", sinSesion.status === 401 && vacia.status === 400 && marca.status === 200 && !!fila("SELECT id FROM notificaciones_leidas WHERE usuario_id = ? AND clave = ?", C.id, clave), `${sinSesion.status} ${detalle(vacia)} ${marca.status}`);

  const accesos = await api("GET", "/admin/accesos", undefined, t.jorge);
  check("[cob:A:E-20] GET /api/admin/accesos → 410 (pantalla retirada)", accesos.status === 410 && accesos.data?.codigo === "retirado", detalle(accesos));

  const personalSin = await api("GET", "/auth/personal");
  ejecutar("UPDATE usuarios SET debe_cambiar_password = 1 WHERE id = ?", K3.id);
  const tPend = (await api("POST", "/auth/login", { email: K3.email, password: PASS }, undefined, { "X-Sin-Cambio-Auto": "1" })).data?.token;
  const personalPend = await api("GET", "/auth/personal", undefined, tPend);
  ejecutar("UPDATE usuarios SET debe_cambiar_password = 0 WHERE id = ?", K3.id);
  const personal = await api("GET", "/auth/personal", undefined, tC);
  check("[cob:A:E-27] personal: sin sesión → 401; con cambio de contraseña pendiente → 403 cambiar_password; con sesión trae personas sin correos", personalSin.status === 401 && personalPend.status === 403 && personalPend.data?.codigo === "cambiar_password" && personal.status === 200 && (personal.data?.items || []).length > 5 && (personal.data?.items || []).every((p) => !("email" in p)), `${personalSin.status} ${detalle(personalPend)} ${personal.status}`);

  const metodos = [];
  for (const m of ["GET", "POST", "PUT", "DELETE", "PATCH"]) metodos.push(await api(m, `/ruta-que-no-existe-${s5}`, m === "GET" ? undefined : {}, tC));
  check("[cob:A:E-52] /api/<ruta desconocida> con GET, POST, PUT, DELETE y PATCH → 404 «Ruta no encontrada»", metodos.every((r) => r.status === 404 && r.data?.message === "Ruta no encontrada"), metodos.map(detalle).join(" | "));
}

/* ---------- Vigencia de la cuenta y de los roles; sesión ---------- */
{
  const V = await cuenta("Vigencia");
  const tV = await entrar(V);
  const antes = await api("GET", "/auth/me", undefined, tV);
  ejecutar("UPDATE usuarios SET vigente_hasta = ? WHERE id = ?", enDias(-1), V.id);
  const vencida = await api("GET", "/auth/me", undefined, tV);
  const login = await api("POST", "/auth/login", { email: V.email, password: PASS }, undefined, ipPropia());
  ejecutar("UPDATE usuarios SET vigente_hasta = NULL, vigente_desde = ? WHERE id = ?", enDias(5), V.id);
  const futura = await api("POST", "/auth/login", { email: V.email, password: PASS }, undefined, ipPropia());
  const bit = fila("SELECT cambios_json FROM auditoria WHERE accion = 'login_fallido' AND entidad_id = ? ORDER BY id DESC LIMIT 1", String(V.id));
  ejecutar("UPDATE usuarios SET vigente_desde = NULL WHERE id = ?", V.id);
  check("[cob:A:S-07] cuenta fuera de vigencia (fin pasado o inicio futuro): la sesión abierta → 401 cuenta_no_vigente; el login → 403 cuenta_no_vigente y queda login_fallido", antes.status === 200 && vencida.status === 401 && vencida.data?.codigo === "cuenta_no_vigente" && login.status === 403 && login.data?.codigo === "cuenta_no_vigente" && futura.status === 403 && futura.data?.codigo === "cuenta_no_vigente" && /cuenta_no_vigente/.test(String(bit?.cambios_json)), `${antes.status} ${detalle(vencida)} | ${detalle(login)} | ${detalle(futura)}`);

  // Un rol cuya vigencia terminó deja de contar al momento y el barrido (cada minuto) lo deja en la bitácora.
  const asig = asignacionDe(V.id, rol("tecnico_auxiliar"));
  ejecutar("UPDATE usuario_roles SET vigente_desde = ?, vigente_hasta = ? WHERE id = ?", enDias(-10), enDias(-1), asig.id);
  const tV2 = await entrar(V);
  const me = await api("GET", "/auth/me", undefined, tV2);
  let registro = null;
  for (let i = 0; i < 50 && !registro; i += 1) {
    await api("GET", "/auth/me", undefined, tV2);
    registro = fila("SELECT motivo, cambios_json FROM auditoria WHERE accion = 'vencer_rol' AND entidad_id = ? ORDER BY id DESC LIMIT 1", String(V.id));
    if (!registro) await new Promise((r) => setTimeout(r, 2500));
  }
  check("[cob:A:S-15] rol con vigencia terminada: ya no cuenta en la sesión y el barrido lo registra como «vencer_rol» con motivo", me.status === 200 && (me.data?.roles || []).length === 0 && !!registro && /Terminó la vigencia/.test(registro.motivo) && String(registro.cambios_json).includes(String(asig.id)) && !!fila("SELECT vencimiento_registrado_en FROM usuario_roles WHERE id = ?", asig.id)?.vencimiento_registrado_en, `${me.status} roles=${(me.data?.roles || []).length} ${registro?.motivo}`);

  const ses = await api("POST", "/auth/login", { email: C.email, password: PASS }, undefined, ipPropia());
  const [h, p, firma] = String(ses.data?.token).split(".");
  const carga = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  const alterado = `${h}.${Buffer.from(JSON.stringify({ ...carga, exp: carga.exp + 86_400 })).toString("base64url")}.${firma}`;
  const conAlterado = await api("GET", "/auth/me", undefined, alterado);
  check("[cob:A:S-24] la sesión vence a las JWT_EXPIRES_HOURS (8 h: exp − iat) y un token con la vigencia alterada → 401", ses.data?.sesion?.expira_horas === 8 && carga.exp - carga.iat === 8 * 3600 && conAlterado.status === 401, `${ses.data?.sesion?.expira_horas} ${carga.exp - carga.iat} ${detalle(conAlterado)}`);
}

/* ---------- Cuentas propias para endpoints, transiciones y avisos ---------- */
const BASE = process.env.BASE;
const LA = await cuenta("Analista", { rolClave: "tecnico_analista" });
const MC = await cuenta("Mejora", { rolClave: "mejora_continua" });
const RG = await cuenta("Responsable", { rolClave: "responsable_general" });
const SR = await cuenta("Sin Rol", { headers: SIN_APROBAR });
const tLA = await entrar(LA);
const tMC = await entrar(MC);
const tRG = await entrar(RG);
const tSR = await entrar(SR);
const tK1 = await entrar(K1);
const tK3 = await entrar(K3);
const solSR = SR.r.data?.solicitud?.id;
check("(preparación) cuentas propias: analista, mejora continua, responsable general y una sin roles (su alta queda pendiente)", [LA, MC, RG, SR].every((c) => c.status === 201) && !!asignacionDe(LA.id, rol("tecnico_analista")) && !!asignacionDe(MC.id, rol("mejora_continua")) && !!asignacionDe(RG.id, rol("responsable_general")) && !fila("SELECT id FROM usuario_roles WHERE usuario_id = ?", SR.id) && !!tSR && !!tK1, `${[LA, MC, RG, SR].map((c) => c.status)} ${solSR}`);
const maxBitacora = () => Number(fila("SELECT MAX(id) AS n FROM auditoria")?.n || 0);
const bitacoraDe = (idc, desde) => filas("SELECT accion, motivo, cambios_json FROM auditoria WHERE entidad = 'usuarios' AND entidad_id = ? AND id > ? ORDER BY id", String(idc), desde);
const reauthPide = (r, accion) => r.status === 401 && r.data?.codigo === "reauth_required" && r.data?.accion === accion;

/* ---------- Roles: lista, ficha, permisos, alta, edición y borrado (E-01..E-06, S-16..S-20) ---------- */
{
  const informesV = [{ modulo: "informes", accion: "V", alcance: "total" }];
  const RQ = await rolPropio("Informes");
  const Q = await cuenta("Rol Propio", { extra: { rol_id: RQ.id } });
  const tQ = await entrar(Q);
  const informes = async () => (await api("GET", "/informes", undefined, tQ)).status;
  const acciones = () => filas("SELECT modulo, accion, alcance FROM rol_acciones WHERE id_rol = ? ORDER BY modulo, accion", RQ.id).map((f) => `${f.modulo}:${f.accion}:${f.alcance}`).join("|");
  const editar = (extra, headers = {}) => api("PUT", `/admin/roles/${RQ.id}`, { nombre: RQ.nombre, descripcion: "Rol de la prueba de cobertura", activo: true, permisos: informesV, ...extra }, t.jorge, headers);
  const i0 = await informes();
  const amplia = await editar({ motivo: "Consulta de informes" }, SIN_APROBAR);
  const pendiente = acciones();
  const i1 = await informes();
  const aprueba = await api("POST", `/solicitudes/${amplia.data?.solicitud?.id}/aprobar`, { motivo: "Ampliación revisada" }, t.patricia);
  const i2 = await informes();
  check("[cob:A:S-17] ampliar los permisos de un rol: 202 con solicitud ampliar_permisos_rol; el rol y quien lo tiene siguen igual hasta que otra persona con usuarios:A (sin el rol) la aprueba", Q.status === 201 && !!asignacionDe(Q.id, RQ.id) && i0 === 403 && amplia.status === 202 && amplia.data?.solicitud?.tipo === "ampliar_permisos_rol" && pendiente === "" && i1 === 403 && aprueba.status === 200 && acciones() === "informes:V:total" && i2 === 200, `${Q.status} ${i0} ${detalle(amplia)} «${pendiente}» ${i1} ${detalle(aprueba)} ${acciones()} ${i2}`);

  const sinMotivo = await editar({ permisos: [] });
  const quita = await editar({ permisos: [], motivo: "Ya no consulta informes" }, SIN_APROBAR);
  const i3 = await informes();
  check("[cob:A:S-16] quitar permisos de un rol: sin motivo → 400; con motivo se aplica de inmediato (200 «Rol actualizado», sin solicitud) y la sesión abierta de quien lo tiene ya no entra", sinMotivo.status === 400 && /motivo del cambio de permisos/.test(sinMotivo.data?.message) && quita.status === 200 && quita.data?.message === "Rol actualizado" && !quita.data?.solicitud && acciones() === "" && i3 === 403, `${detalle(sinMotivo)} | ${detalle(quita)} ${acciones()} ${i3}`);

  const vuelve = await editar({ motivo: "Vuelve a consultar informes" });
  const i4 = await informes();
  const desSinMotivo = await editar({ activo: false });
  const desactiva = await editar({ activo: false, motivo: "Rol en pausa" }, SIN_APROBAR);
  const activoDes = Number(fila("SELECT activo FROM roles WHERE id = ?", RQ.id)?.activo);
  const i5 = await informes();
  check("[cob:A:S-18] desactivar un rol: sin motivo → 400; con motivo 200 sin solicitud y quien lo tiene pierde lo que concedía", vuelve.status === 200 && i4 === 200 && desSinMotivo.status === 400 && desactiva.status === 200 && !desactiva.data?.solicitud && activoDes === 0 && i5 === 403, `${detalle(vuelve)} ${i4} | ${detalle(desSinMotivo)} | ${detalle(desactiva)} activo=${activoDes} ${i5}`);
  const reactiva = await editar({ activo: true, motivo: "Se reanuda el rol" }, SIN_APROBAR);
  const sigueInactivo = Number(fila("SELECT activo FROM roles WHERE id = ?", RQ.id)?.activo);
  const i6 = await informes();
  const apruebaR = await api("POST", `/solicitudes/${reactiva.data?.solicitud?.id}/aprobar`, { motivo: "Reactivación revisada" }, t.patricia);
  const i7 = await informes();
  check("[cob:A:S-17] reactivar un rol también es ampliar: 202 con solicitud (activar), el rol sigue inactivo hasta aprobarla y después vuelve a conceder", reactiva.status === 202 && reactiva.data?.solicitud?.tipo === "ampliar_permisos_rol" && sigueInactivo === 0 && i6 === 403 && apruebaR.status === 200 && Number(fila("SELECT activo FROM roles WHERE id = ?", RQ.id)?.activo) === 1 && i7 === 200, `${detalle(reactiva)} ${sigueInactivo} ${i6} ${detalle(apruebaR)} ${i7}`);

  // S-14 y E-18: revocar un rol tiene efecto inmediato.
  const asig = asignacionDe(Q.id, RQ.id);
  const rev = await api("POST", `/admin/usuarios/${Q.id}/roles/${asig?.id}/revocar`, { motivo: "Termina su comisión" }, t.jorge);
  const i8 = await informes();
  const meQ = await api("GET", "/auth/me", undefined, tQ);
  const otraVez = await api("POST", `/admin/usuarios/${Q.id}/roles/${asig?.id}/revocar`, { motivo: "Termina su comisión" }, t.jorge);
  const noHay = await api("POST", `/admin/usuarios/${Q.id}/roles/99999999/revocar`, { motivo: "Termina su comisión" }, t.jorge);
  const corta = await api("POST", `/admin/usuarios/${K2.id}/roles/${asignacionDe(K2.id, rol("admin_auxiliar"))?.id}/revocar`, { motivo: "no" }, t.jorge);
  const yo = await api("POST", `/admin/usuarios/${AP.id}/roles/${asignacionDe(AP.id, rol("admin_tecnico"))?.id}/revocar`, { motivo: "Me quito el rol" }, tAP, SIN_REAUTH);
  const sinG = await api("POST", `/admin/usuarios/${Q.id}/roles/${asig?.id}/revocar`, { motivo: "Termina su comisión" }, tC);
  check("[cob:A:S-14] revocar un rol: con motivo 200 y la sesión abierta pierde el acceso al momento (sin roles en /auth/me)", rev.status === 200 && !!fila("SELECT revocado_en FROM usuario_roles WHERE id = ?", asig?.id)?.revocado_en && i8 === 403 && meQ.status === 200 && (meQ.data?.roles || []).length === 0, `${detalle(rev)} ${i8} ${(meQ.data?.roles || []).length}`);
  check("[cob:A:E-18] revocar asignación: a sí mismo → 403; inexistente → 404; ya revocada → 409; motivo < 5 → 400; sin usuarios:G → 403", yo.status === 403 && /a sí mismo/.test(yo.data?.message) && noHay.status === 404 && /Asignación no encontrada/.test(noHay.data?.message) && otraVez.status === 409 && /ya estaba revocada/.test(otraVez.data?.message) && corta.status === 400 && sinG.status === 403 && !asignacionDe(K2.id, rol("admin_auxiliar"))?.revocado_en, [yo, noHay, otraVez, corta, sinG].map(detalle).join(" | "));

  // S-19 y E-02: un rol nuevo nace sin permisos; los pedidos al crearlo quedan en solicitud.
  const nombre = `Cob Con Permisos ${s5}`;
  const sinMot = await api("POST", "/admin/roles", { nombre, descripcion: "Rol de la prueba de cobertura", permisos: informesV }, t.jorge, SIN_APROBAR);
  const noCreado = !fila("SELECT id FROM roles WHERE nombre = ?", nombre);
  const crea = await api("POST", "/admin/roles", { nombre, descripcion: "Rol de la prueba de cobertura", permisos: informesV, motivo: "Rol nuevo para consultar informes" }, t.jorge, SIN_APROBAR);
  const RN = Number(crea.data?.id);
  if (RN) rolesPropios.push(RN);
  const vacio = await api("POST", "/admin/roles", { nombre: "  ", permisos: [] }, t.jorge);
  const dup = await api("POST", "/admin/roles", { nombre: nombre.toUpperCase(), permisos: [] }, t.jorge);
  const sinGCrear = await api("POST", "/admin/roles", { nombre: `Cob Sin G ${s5}`, permisos: [] }, tC);
  check("[cob:A:S-19] [cob:A:E-02] alta de rol: sin nombre → 400, duplicado → 409, sin usuarios:G → 403; con permisos pide motivo (400) y nace SIN permisos (201 solicitud_creada con ampliar_permisos_rol pendiente)", sinMot.status === 400 && noCreado && crea.status === 201 && crea.data?.codigo === "solicitud_creada" && crea.data?.solicitud?.tipo === "ampliar_permisos_rol" && crea.data?.solicitud?.estado === "pendiente" && Number(fila("SELECT COUNT(*) AS n FROM rol_acciones WHERE id_rol = ?", RN)?.n) === 0 && vacio.status === 400 && /nombre del rol es obligatorio/.test(vacio.data?.message) && dup.status === 409 && sinGCrear.status === 403 && !fila("SELECT id FROM roles WHERE nombre = ?", `Cob Sin G ${s5}`), `${detalle(sinMot)} | ${detalle(crea)} | ${detalle(vacio)} | ${detalle(dup)} | ${detalle(sinGCrear)}`);
  await rechazar(crea.data?.solicitud?.id);

  // S-20 y E-05: borrar solo un rol nunca asignado y no sistémico.
  const RS = await rolPropio("Sistemico");
  ejecutar("UPDATE roles SET es_sistemico = 1 WHERE id = ?", RS.id);
  const sistemico = await api("DELETE", `/admin/roles/${RS.id}`, undefined, t.jorge);
  ejecutar("UPDATE roles SET es_sistemico = 0 WHERE id = ?", RS.id);
  const desde = Number(fila("SELECT MAX(id) AS n FROM auditoria")?.n || 0);
  const borra = await api("DELETE", `/admin/roles/${RN}`, undefined, t.jorge);
  const bitBorra = fila("SELECT accion FROM auditoria WHERE entidad = 'roles' AND entidad_id = ? AND id > ?", String(RN), desde);
  const asignado = await api("DELETE", `/admin/roles/${RQ.id}`, undefined, t.jorge);
  const noExiste = await api("DELETE", "/admin/roles/99999999", undefined, t.jorge);
  const sinGBorrar = await api("DELETE", `/admin/roles/${RS.id}`, undefined, tC);
  const borraRS = await api("DELETE", `/admin/roles/${RS.id}`, undefined, t.jorge);
  check("[cob:A:S-20] [cob:A:E-05] borrar un rol: sistémico → 403; asignado alguna vez (aunque revocado) → 409; inexistente → 404; sin usuarios:G → 403; nunca asignado → 200, desaparece y queda «eliminar» en la bitácora", sistemico.status === 403 && /sistemico/.test(sistemico.data?.message) && asignado.status === 409 && /desactívalo/.test(asignado.data?.message) && !!fila("SELECT id FROM roles WHERE id = ?", RQ.id) && noExiste.status === 404 && sinGBorrar.status === 403 && borra.status === 200 && !fila("SELECT id FROM roles WHERE id = ?", RN) && bitBorra?.accion === "eliminar" && borraRS.status === 200, [sistemico, asignado, noExiste, sinGBorrar, borra, borraRS].map(detalle).join(" | "));

  // E-01, E-03, E-04, E-06: lectura de roles y permisos.
  const listaC = await api("GET", "/admin/roles", undefined, tC);
  const listaSR = await api("GET", "/admin/roles", undefined, tSR);
  const listaJ = await api("GET", "/admin/roles", undefined, t.jorge);
  check("[cob:A:E-01] GET /admin/roles: usuarios:V propio → 403 «Tu alcance en usuarios es solo tu propia cuenta»; sin roles → 403; usuarios:G → 200 con los roles propios", listaC.status === 403 && listaC.data?.message === "Tu alcance en usuarios es solo tu propia cuenta" && listaSR.status === 403 && listaJ.status === 200 && (listaJ.data?.items || []).some((r) => Number(r.id) === RQ.id), `${detalle(listaC)} | ${detalle(listaSR)} | ${listaJ.status}`);
  const fichaC = await api("GET", `/admin/roles/${RQ.id}`, undefined, tC);
  const fichaJ = await api("GET", `/admin/roles/${RQ.id}`, undefined, t.jorge);
  const fichaNo = await api("GET", "/admin/roles/99999999", undefined, t.jorge);
  check("[cob:A:E-03] GET /admin/roles/:id: usuarios:V propio → 403 de alcance; inexistente → 404 «Rol no encontrado»; con usuarios:V el rol con sus permisos", fichaC.status === 403 && /solo tu propia cuenta/.test(fichaC.data?.message) && fichaNo.status === 404 && fichaNo.data?.message === "Rol no encontrado" && fichaJ.status === 200 && Number(fichaJ.data?.role?.id) === RQ.id && (fichaJ.data?.permisos || []).some((p) => p.modulo === "informes" && p.accion === "V"), `${detalle(fichaC)} | ${detalle(fichaNo)} | ${fichaJ.status} ${JSON.stringify(fichaJ.data?.permisos)}`);
  const putNo = await api("PUT", "/admin/roles/99999999", { nombre: "X", activo: true, permisos: [] }, t.jorge);
  const putSinG = await api("PUT", `/admin/roles/${RQ.id}`, { nombre: RQ.nombre, activo: true, permisos: informesV }, tC);
  const putVacio = await api("PUT", `/admin/roles/${RQ.id}`, { nombre: " ", activo: true, permisos: informesV }, t.jorge);
  const putDup = await api("PUT", `/admin/roles/${RQ.id}`, { nombre: R1.nombre.toLowerCase(), activo: true, permisos: informesV }, t.jorge);
  check("[cob:A:E-04] PUT /admin/roles/:id: inexistente → 404; sin usuarios:G → 403; nombre vacío → 400; nombre de otro rol → 409 (rol_propio y COMBINACION_PROHIBIDA en V-28 y V-24)", putNo.status === 404 && putSinG.status === 403 && putVacio.status === 400 && putDup.status === 409 && fila("SELECT nombre FROM roles WHERE id = ?", RQ.id)?.nombre === RQ.nombre, [putNo, putSinG, putVacio, putDup].map(detalle).join(" | "));
  const permSR = await api("GET", "/admin/permissions", undefined, tSR);
  const permJ = await api("GET", "/admin/permissions", undefined, t.jorge);
  check("[cob:A:E-06] GET /admin/permissions: sin usuarios:V → 403; con usuarios:V el catálogo de módulos y acciones", permSR.status === 403 && /usuarios:V/.test(permSR.data?.message) && permJ.status === 200 && (permJ.data?.modulos || []).some((m) => m.clave === "usuarios") && (permJ.data?.modulos || []).some((m) => m.clave === "documentos"), `${detalle(permSR)} | ${permJ.status}`);
}

/* ---------- Usuarios: lista, ficha, alta, edición y baja (E-07..E-11, E-16, E-17, E-19, S-01..S-04, S-08..S-13) ---------- */
let Y;
{
  const listaSR = await api("GET", "/admin/usuarios", undefined, tSR);
  const listaC = await api("GET", "/admin/usuarios", undefined, tC);
  const listaJ = await api("GET", "/admin/usuarios", undefined, t.jorge);
  check("[cob:A:E-07] GET /admin/usuarios: sin usuarios:V → 403; usuarios:V propio → solo su cuenta; usuarios:G → todas (incluidas las propias)", listaSR.status === 403 && listaC.status === 200 && (listaC.data?.items || []).length === 1 && Number(listaC.data.items[0].id) === C.id && listaJ.status === 200 && [C.id, LA.id, SR.id].every((x) => (listaJ.data?.items || []).some((u) => Number(u.id) === x)), `${detalle(listaSR)} | ${listaC.status} ${(listaC.data?.items || []).length} | ${listaJ.status}`);
  const ajena = await api("GET", `/admin/usuarios/${LA.id}`, undefined, tC);
  const propia = await api("GET", `/admin/usuarios/${C.id}`, undefined, tC);
  const noHay = await api("GET", "/admin/usuarios/99999999", undefined, t.jorge);
  const sinV = await api("GET", `/admin/usuarios/${SR.id}`, undefined, tSR);
  check("[cob:A:E-09] GET /admin/usuarios/:id: usuarios:V propio ve solo su id (otro → 403); sin usuarios:V → 403; inexistente → 404 «Usuario no encontrado»", ajena.status === 403 && /solo tu propia cuenta/.test(ajena.data?.message) && propia.status === 200 && JSON.stringify(propia.data).includes(C.email) && sinV.status === 403 && noHay.status === 404 && noHay.data?.message === "Usuario no encontrado", [ajena, propia, sinV, noHay].map(detalle).join(" | "));

  // S-01 y E-08: alta con rol inicial, cambio obligatorio y solicitud asignar_rol.
  const email = `cob.alta.nueva.${s5}@ficotox.local`;
  const body = { nombre: `Cob Alta Nueva ${s5}`, email, activo: true, rol_id: rol("tecnico_auxiliar"), password: PASS, motivo: "Alta de la prueba de cobertura" };
  const sinReauth = await api("POST", "/admin/usuarios", body, t.jorge, SIN_REAUTH);
  const sinG = await api("POST", "/admin/usuarios", body, tC);
  const nadie = !fila("SELECT id FROM usuarios WHERE email = ?", email);
  const alta = await api("POST", "/admin/usuarios", body, t.jorge, SIN_APROBAR);
  const nuevo = fila("SELECT * FROM usuarios WHERE email = ?", email);
  if (nuevo) creadas.push(Number(nuevo.id));
  const sol = alta.data?.solicitud;
  const sinRol = !fila("SELECT id FROM usuario_roles WHERE usuario_id = ?", nuevo?.id);
  const pidio = await api("POST", `/solicitudes/${sol?.id}/aprobar`, { motivo: "Apruebo lo que pedí" }, t.jorge);
  const aprueba = await api("POST", `/solicitudes/${sol?.id}/aprobar`, { motivo: "Alta revisada" }, t.patricia);
  check("[cob:A:S-01] alta: cuenta activa con cambio de contraseña obligatorio y figura aleatoria, sin rol hasta que otra persona aprueba asignar_rol (quien pidió → 409 regla 6)", alta.status === 201 && Number(nuevo?.activo) === 1 && Number(nuevo?.debe_cambiar_password) === 1 && !!nuevo?.avatar && sinRol && sol?.tipo === "asignar_rol" && sol?.estado === "pendiente" && String(sol?.entidad_id) === String(nuevo?.id) && pidio.status === 409 && pidio.data?.regla === 6 && aprueba.status === 200 && !!asignacionDe(nuevo?.id, rol("tecnico_auxiliar")), `${detalle(alta)} ${JSON.stringify({ a: nuevo?.activo, d: nuevo?.debe_cambiar_password, av: nuevo?.avatar })} ${sinRol} ${sol?.tipo} | ${detalle(pidio)} | ${detalle(aprueba)}`);
  const mal = await api("POST", "/admin/usuarios", { ...body, email: `cob.mal.${s5}` }, t.jorge);
  const dup = await api("POST", "/admin/usuarios", { ...body, email }, t.jorge);
  check("[cob:A:E-08] POST /admin/usuarios: sin reautenticación → 401 reauth_required usuarios:roles (no se crea); sin usuarios:G → 403; correo inválido → 400 campo email; correo existente → 409; válido → 201 con la solicitud asignar_rol", reauthPide(sinReauth, "usuarios:roles") && sinG.status === 403 && nadie && mal.status === 400 && mal.data?.campo === "email" && dup.status === 409 && alta.status === 201 && sol?.tipo === "asignar_rol", [sinReauth, sinG, mal, dup, alta].map(detalle).join(" | "));

  // E-10: PUT de la cuenta, con la reautenticación del cambio más crítico.
  const X = await cuenta("Baja Edicion");
  const tX = await entrar(X);
  const putNo = await api("PUT", "/admin/usuarios/99999999", datosDe(X.id), t.jorge);
  const putSinG = await api("PUT", `/admin/usuarios/${X.id}`, datosDe(X.id, { departamento: "Otro" }), tC);
  const putMal = await api("PUT", `/admin/usuarios/${X.id}`, datosDe(X.id, { email: "sin-arroba" }), t.jorge);
  const rBaja = await api("PUT", `/admin/usuarios/${X.id}`, datosDe(X.id, { activo: false, motivo_estado: "Baja por la edición" }), t.jorge, SIN_REAUTH);
  const rClave = await api("PUT", `/admin/usuarios/${X.id}`, datosDe(X.id, { password: `Fijada-${s5}-Admin-1` }), t.jorge, SIN_REAUTH);
  const rVig = await api("PUT", `/admin/usuarios/${T.id}`, datosDe(T.id, { vigente_hasta: enDias(35), motivo_cuenta: "Se acorta otra vez" }), t.jorge, SIN_REAUTH);
  const rReact = await api("PUT", `/admin/usuarios/${Inact.id}`, datosDe(Inact.id, { activo: true }), t.jorge, SIN_REAUTH);
  check("[cob:A:E-10] PUT /admin/usuarios/:id: inexistente → 404; sin usuarios:G → 403; correo inválido → 400; pide la reautenticación del cambio crítico (baja, contraseña, vigencia, reactivar) sin aplicar nada", putNo.status === 404 && putSinG.status === 403 && putMal.status === 400 && reauthPide(rBaja, "usuarios:baja") && reauthPide(rClave, "usuarios:password") && reauthPide(rVig, "usuarios:vigencia") && reauthPide(rReact, "usuarios:reactivar") && Number(usuario(X.id).activo) === 1 && usuario(T.id).vigente_hasta === enDias(40) && Number(usuario(Inact.id).activo) === 0, [putNo, putSinG, putMal, rBaja, rClave, rVig, rReact].map(detalle).join(" | "));

  // S-03 (renglón desactualizado: hoy pide motivo, no aplica a uno mismo y la bitácora dice «baja»).
  const sinMotivo = await api("PUT", `/admin/usuarios/${X.id}`, datosDe(X.id, { activo: false }), t.jorge);
  const yoMismo = await api("PUT", `/admin/usuarios/${AP.id}`, datosDe(AP.id, { activo: false, motivo_estado: "Me doy de baja yo" }), tAP, SIN_REAUTH);
  const tv0 = Number(usuario(X.id).token_version || 0);
  const b0 = maxBitacora();
  const baja = await api("PUT", `/admin/usuarios/${X.id}`, datosDe(X.id, { activo: false, motivo_estado: "Termina su estancia" }), t.jorge);
  const bit = bitacoraDe(X.id, b0);
  const sesionX = await api("GET", "/auth/me", undefined, tX);
  check("[cob:A:S-03] baja por el interruptor: sin motivo → 400 campo motivo_estado; sobre la propia cuenta → 403; con motivo 200, cierra sus sesiones y la bitácora la registra una sola vez como «baja»", sinMotivo.status === 400 && sinMotivo.data?.campo === "motivo_estado" && yoMismo.status === 403 && Number(usuario(AP.id).activo) === 1 && baja.status === 200 && Number(usuario(X.id).activo) === 0 && Number(usuario(X.id).token_version) === tv0 + 1 && bit.map((b) => b.accion).join() === "baja" && bit[0]?.motivo === "Termina su estancia" && sesionX.status === 401, `${detalle(sinMotivo)} | ${detalle(yoMismo)} | ${detalle(baja)} ${bit.map((b) => b.accion)} ${detalle(sesionX)}`);

  // S-02, E-11 y E-21 (cuenta inactiva): DELETE de la cuenta.
  Y = await cuenta("Baja");
  const tY = await entrar(Y);
  const tvY = Number(usuario(Y.id).token_version || 0);
  const dSinReauth = await api("DELETE", `/admin/usuarios/${Y.id}`, { motivo: "Fin de su contrato" }, t.jorge, SIN_REAUTH);
  const dNo = await api("DELETE", "/admin/usuarios/99999999", { motivo: "Fin de su contrato" }, t.jorge);
  const dSinG = await api("DELETE", `/admin/usuarios/${Y.id}`, { motivo: "Fin de su contrato" }, tC);
  const dCorta = await api("DELETE", `/admin/usuarios/${Y.id}`, { motivo: "no" }, t.jorge);
  const dYo = await api("DELETE", `/admin/usuarios/${AP.id}`, { motivo: "Me doy de baja" }, tAP, SIN_REAUTH);
  check("[cob:A:E-11] DELETE /admin/usuarios/:id: a sí mismo → 403; motivo < 5 → 400; inexistente → 404; sin usuarios:G → 403; pide reautenticación usuarios:baja (sin aplicar nada)", dYo.status === 403 && dCorta.status === 400 && /motivo de la baja/.test(dCorta.data?.message) && dNo.status === 404 && dSinG.status === 403 && reauthPide(dSinReauth, "usuarios:baja") && Number(usuario(Y.id).activo) === 1, [dYo, dCorta, dNo, dSinG, dSinReauth].map(detalle).join(" | "));
  const bY = maxBitacora();
  const bajaY = await api("DELETE", `/admin/usuarios/${Y.id}`, { motivo: "Fin de su contrato" }, t.jorge);
  const meY = await api("GET", "/auth/me", undefined, tY);
  const loginY = await api("POST", "/auth/login", { email: Y.email, password: PASS }, undefined, ipPropia());
  const bitY = bitacoraDe(Y.id, bY);
  check("[cob:A:S-02] baja de otra persona con motivo: activo=0, token_version+1 (su sesión → 401) y «baja» con el motivo en la bitácora", bajaY.status === 200 && Number(usuario(Y.id).activo) === 0 && Number(usuario(Y.id).token_version) === tvY + 1 && meY.status === 401 && bitY.some((b) => b.accion === "baja" && b.motivo === "Fin de su contrato"), `${detalle(bajaY)} ${detalle(meY)} ${bitY.map((b) => b.accion)}`);
  const ipL = ipPropia();
  const malaClave = await api("POST", "/auth/login", { email: C.email, password: "No-es-la-clave-1" }, undefined, ipL);
  const noExiste = await api("POST", "/auth/login", { email: `cob.nadie.${s5}@ficotox.local`, password: "No-es-la-clave-1" }, undefined, ipL);
  check("[cob:A:E-21] login: cuenta inactiva → 403 «Usuario inactivo»; contraseña incorrecta y correo inexistente → 401 con el mismo MENSAJE_ACCESO_FALLIDO (400, 429 y cuenta_no_vigente en V-40, V-41 y S-07)", loginY.status === 403 && loginY.data?.message === "Usuario inactivo" && malaClave.status === 401 && malaClave.data?.message === "Correo o contraseña incorrectos. Después de varios intentos fallidos el acceso se bloquea temporalmente." && noExiste.status === 401 && noExiste.data?.message === malaClave.data?.message, `${detalle(loginY)} | ${detalle(malaClave)} | ${detalle(noExiste)}`);

  // S-04: reactivar con segundo usuario.
  const react = await api("PUT", `/admin/usuarios/${Y.id}`, datosDe(Y.id, { activo: true, motivo_estado: "Regresa al laboratorio" }), t.jorge, SIN_APROBAR);
  const sigue = Number(usuario(Y.id).activo);
  const loginAntes = await api("POST", "/auth/login", { email: Y.email, password: PASS }, undefined, ipPropia());
  const apruebaY = await api("POST", `/solicitudes/${react.data?.solicitud?.id}/aprobar`, { motivo: "Reactivación revisada" }, t.patricia);
  const loginDespues = await api("POST", "/auth/login", { email: Y.email, password: PASS }, undefined, ipPropia());
  check("[cob:A:S-04] reactivar: 202 reactivar_cuenta y la cuenta sigue de baja (login 403) hasta que usuarios:A aprueba; después entra", react.status === 202 && react.data?.solicitud?.tipo === "reactivar_cuenta" && sigue === 0 && loginAntes.status === 403 && apruebaY.status === 200 && Number(usuario(Y.id).activo) === 1 && loginDespues.status === 200, `${detalle(react)} ${sigue} ${loginAntes.status} ${detalle(apruebaY)} ${loginDespues.status}`);

  // S-08 y S-09: permanente → temporal (roles acotados o revocados) y ampliación con segundo usuario.
  const W = await cuenta("Vigencia Roles");
  const futuro = await api("POST", `/admin/usuarios/${W.id}/roles`, { rol_id: R2.id, motivo: "Rol que empieza después", vigente_desde: enDias(40) }, t.jorge);
  const base = asignacionDe(W.id, rol("tecnico_auxiliar"));
  const fut = asignacionDe(W.id, R2.id);
  const bW = maxBitacora();
  const aTemp = await api("PUT", `/admin/usuarios/${W.id}`, datosDe(W.id, { tipo_cuenta: "temporal", vigente_hasta: enDias(30), supervisor_id: K1.id, motivo_cuenta: "Pasa a estancia temporal" }), t.jorge);
  const bitW = bitacoraDe(W.id, bW).map((b) => b.accion);
  const futDespues = fila("SELECT revocado_en, motivo_revocacion FROM usuario_roles WHERE id = ?", fut?.id);
  check("[cob:A:S-08] permanente → temporal con motivo y supervisor: el rol vigente se acota a la nueva fecha, el que empezaba después se revoca y queda en la bitácora (acotar_rol, revocar_rol, cambiar_vigencia)", futuro.status < 300 && !!fut && aTemp.status === 200 && usuario(W.id).tipo_cuenta === "temporal" && Number(usuario(W.id).supervisor_id) === K1.id && fila("SELECT vigente_hasta FROM usuario_roles WHERE id = ?", base?.id)?.vigente_hasta === enDias(30) && !!futDespues?.revocado_en && /antes de que iniciara el rol/.test(futDespues?.motivo_revocacion) && ["acotar_rol", "revocar_rol", "cambiar_vigencia"].every((a) => bitW.includes(a)), `${futuro.status} ${detalle(aTemp)} ${JSON.stringify(futDespues)} ${bitW}`);
  const amplia = await api("PUT", `/admin/usuarios/${W.id}`, datosDe(W.id, { vigente_hasta: enDias(45), departamento: "Laboratorio ampliado", motivo_cuenta: "Se extiende la estancia" }), t.jorge, SIN_APROBAR);
  const mientras = usuario(W.id);
  const apruebaW = await api("POST", `/solicitudes/${amplia.data?.solicitud?.id}/aprobar`, { motivo: "Ampliación revisada" }, t.patricia);
  check("[cob:A:S-09] ampliar la vigencia de una temporal: 202 ampliar_vigencia; lo demás se guarda y la fecha nueva solo al aprobar", amplia.status === 202 && amplia.data?.solicitud?.tipo === "ampliar_vigencia" && mientras.departamento === "Laboratorio ampliado" && mientras.vigente_hasta === enDias(30) && apruebaW.status === 200 && usuario(W.id).vigente_hasta === enDias(45), `${detalle(amplia)} ${mientras.departamento} ${mientras.vigente_hasta} ${detalle(apruebaW)} ${usuario(W.id).vigente_hasta}`);

  // S-10, E-16, S-12, E-24 y E-26: restablecer, cambio obligatorio y cambio propio.
  const Z = await cuenta("Restablecer");
  const tZ = await entrar(Z);
  const tvZ = Number(usuario(Z.id).token_version || 0);
  const pNo = await api("POST", "/admin/usuarios/99999999/password", { motivo: "Olvidó su contraseña" }, t.jorge);
  const pSinG = await api("POST", `/admin/usuarios/${Z.id}/password`, { motivo: "Olvidó su contraseña" }, tC);
  const pSinReauth = await api("POST", `/admin/usuarios/${Z.id}/password`, { motivo: "Olvidó su contraseña" }, t.jorge, SIN_REAUTH);
  const pYo = await api("POST", `/admin/usuarios/${AP.id}/password`, { motivo: "Me restablezco" }, tAP, SIN_REAUTH);
  const pCorta = await api("POST", `/admin/usuarios/${Z.id}/password`, { motivo: "no" }, t.jorge);
  check("[cob:A:E-16] restablecer contraseña: a sí mismo → 403; motivo < 5 → 400; inexistente → 404; sin usuarios:G → 403; pide reautenticación usuarios:password", pYo.status === 403 && pCorta.status === 400 && pNo.status === 404 && pSinG.status === 403 && reauthPide(pSinReauth, "usuarios:password") && Number(usuario(Z.id).token_version || 0) === tvZ, [pYo, pCorta, pNo, pSinG, pSinReauth].map(detalle).join(" | "));
  const bZ = maxBitacora();
  const rest = await api("POST", `/admin/usuarios/${Z.id}/password`, { motivo: "Olvidó su contraseña" }, t.jorge);
  const temporal = String(rest.data?.password_temporal || "");
  const viejaZ = await api("GET", "/auth/me", undefined, tZ);
  const bitZ = bitacoraDe(Z.id, bZ);
  const tZt = (await api("POST", "/auth/login", { email: Z.email, password: temporal }, undefined, { ...ipPropia(), "X-Sin-Cambio-Auto": "1" })).data?.token;
  const meZt = await api("GET", "/auth/me", undefined, tZt);
  const personalZt = await api("GET", "/auth/personal", undefined, tZt);
  check("[cob:A:S-10] restablecer: devuelve una temporal xxxxxx-xxxxxx#NN (que no queda en la bitácora), obliga a cambiarla y cierra las sesiones (token_version+1)", rest.status === 200 && /^[A-Za-z0-9]{6}-[A-Za-z0-9]{6}#\d{2}$/.test(temporal) && Number(usuario(Z.id).debe_cambiar_password) === 1 && Number(usuario(Z.id).token_version) === tvZ + 1 && viejaZ.status === 401 && bitZ.some((b) => b.accion === "restablecer_password") && !JSON.stringify(bitZ).includes(temporal) && !!tZt, `${detalle(rest)} ${temporal} ${usuario(Z.id).debe_cambiar_password} ${detalle(viejaZ)}`);
  check("[cob:A:E-26] GET /auth/me: con el cambio de contraseña pendiente responde (200, debe_cambiar_password) aunque lo demás dé 403 cambiar_password; sin token → 401", meZt.status === 200 && !!Number(meZt.data?.user?.debe_cambiar_password) && personalZt.status === 403 && personalZt.data?.codigo === "cambiar_password" && (await api("GET", "/auth/me")).status === 401, `${detalle(meZt)} ${JSON.stringify(meZt.data?.user?.debe_cambiar_password)} | ${detalle(personalZt)}`);
  const nuevaZ = `Nueva-${s5}-Propia-2026`;
  const cambio = await api("POST", "/auth/password", { actual: temporal, nueva: nuevaZ }, tZt, { "X-Sin-Cambio-Auto": "1" });
  const viejaZt = await api("GET", "/auth/me", undefined, tZt);
  const personalNueva = await api("GET", "/auth/personal", undefined, cambio.data?.token);
  check("[cob:A:S-12] [cob:A:E-24] cambio propio con el cambio pendiente: 200 con una sesión nueva; debe_cambiar_password=0; la sesión anterior → 401 y la nueva ya entra", cambio.status === 200 && !!cambio.data?.token && Number(usuario(Z.id).debe_cambiar_password) === 0 && viejaZt.status === 401 && personalNueva.status === 200, `${detalle(cambio)} ${usuario(Z.id).debe_cambiar_password} ${detalle(viejaZt)} ${personalNueva.status}`);

  // S-11: fijar la contraseña de otra persona por edición.
  const Fx = await cuenta("Clave Fijada");
  const tFx = await entrar(Fx);
  const tvF = Number(usuario(Fx.id).token_version || 0);
  const corta = await api("PUT", `/admin/usuarios/${Fx.id}`, datosDe(Fx.id, { password: "Corta-1" }), t.jorge);
  const bF = maxBitacora();
  const fija = await api("PUT", `/admin/usuarios/${Fx.id}`, datosDe(Fx.id, { password: `Fijada-${s5}-Admin-1` }), t.jorge);
  const bitF = bitacoraDe(Fx.id, bF);
  const viejaF = await api("GET", "/auth/me", undefined, tFx);
  const loginF = await api("POST", "/auth/login", { email: Fx.email, password: `Fijada-${s5}-Admin-1` }, undefined, { ...ipPropia(), "X-Sin-Cambio-Auto": "1" });
  check("[cob:A:S-11] fijar la contraseña de otra persona: < 10 → 400; válida → cambio obligatorio, token_version+1 (sesión → 401) y «editar» con «contraseña cambiada» (sin la contraseña)", corta.status === 400 && fija.status === 200 && Number(usuario(Fx.id).debe_cambiar_password) === 1 && Number(usuario(Fx.id).token_version) === tvF + 1 && viejaF.status === 401 && bitF.some((b) => b.accion === "editar" && /cambiada/.test(b.cambios_json)) && !JSON.stringify(bitF).includes(`Fijada-${s5}`) && loginF.status === 200 && loginF.data?.usuario?.debe_cambiar_password !== false, `${detalle(corta)} | ${detalle(fija)} ${usuario(Fx.id).debe_cambiar_password} ${detalle(viejaF)} ${loginF.status}`);

  // S-13, E-17 y E-32: asignar un rol futuro.
  const aNo = await api("POST", "/admin/usuarios/99999999/roles", { rol_id: R1.id, motivo: "Rol desde la próxima semana" }, t.jorge, SIN_APROBAR);
  const aSinG = await api("POST", `/admin/usuarios/${C.id}/roles`, { rol_id: R1.id, motivo: "Rol desde la próxima semana" }, tC, SIN_APROBAR);
  const aYo = await api("POST", `/admin/usuarios/${AP.id}/roles`, { rol_id: R1.id, motivo: "Rol para mí" }, tAP, { ...SIN_APROBAR, ...SIN_REAUTH });
  const aSinReauth = await api("POST", `/admin/usuarios/${C.id}/roles`, { rol_id: R1.id, motivo: "Rol desde la próxima semana" }, t.jorge, { ...SIN_APROBAR, ...SIN_REAUTH });
  const pide = await api("POST", `/admin/usuarios/${C.id}/roles`, { rol_id: R1.id, motivo: "Rol desde la próxima semana", vigente_desde: enDias(3) }, t.jorge, SIN_APROBAR);
  const antes = asignacionDe(C.id, R1.id);
  const apruebaC = await api("POST", `/solicitudes/${pide.data?.solicitud?.id}/aprobar`, { motivo: "Asignación revisada" }, t.patricia);
  const futuroC = asignacionDe(C.id, R1.id);
  const meC = await api("GET", "/auth/me", undefined, tC);
  const cargoFuturo = await api("PUT", "/auth/me/cargo", { rol_id: R1.id }, tC);
  check("[cob:A:E-17] asignar rol: a sí mismo → 403; inexistente → 404; sin usuarios:G → 403; pide reautenticación usuarios:roles; válido → 202 asignar_rol (400 motivo y 409 duplicado en V-06 y V-23)", aYo.status === 403 && aNo.status === 404 && aSinG.status === 403 && reauthPide(aSinReauth, "usuarios:roles") && pide.status === 202 && pide.data?.solicitud?.tipo === "asignar_rol", [aYo, aNo, aSinG, aSinReauth, pide].map(detalle).join(" | "));
  check("[cob:A:S-13] rol solicitado → asignado al aprobar, con fecha futura: la asignación empieza en 3 días y aún no cuenta en la sesión", !antes && apruebaC.status === 200 && futuroC?.vigente_desde === enDias(3) && !(meC.data?.roles || []).some((r) => Number(r.id) === R1.id), `${!!antes} ${detalle(apruebaC)} ${futuroC?.vigente_desde} ${(meC.data?.roles || []).map((r) => r.id)}`);
  check("[cob:A:E-32] cargo predeterminado con un rol propio aún no vigente → 400 (y uno ajeno → 400 en V-47)", cargoFuturo.status === 400 && /tus roles vigentes/.test(cargoFuturo.data?.message), detalle(cargoFuturo));

  // E-19: desbloquear.
  const uNo = await api("POST", "/admin/usuarios/99999999/desbloquear", { motivo: "Confirmó su identidad" }, t.jorge);
  const uCorto = await api("POST", `/admin/usuarios/${C.id}/desbloquear`, { motivo: "no" }, t.jorge);
  const uSinG = await api("POST", `/admin/usuarios/${C.id}/desbloquear`, { motivo: "Confirmó su identidad" }, tC);
  check("[cob:A:E-19] desbloquear: motivo < 5 → 400; inexistente → 404; sin usuarios:G → 403 (reautenticación usuarios:desbloquear en V-43)", uCorto.status === 400 && uNo.status === 404 && uSinG.status === 403, [uCorto, uNo, uSinG].map(detalle).join(" | "));
}

/* ---------- Bloqueo por reautenticación o cambio de contraseña y desbloqueo (S-05, S-06, E-25) ---------- */
{
  const B1 = await cuenta("Bloqueo Reauth");
  const tB1 = await entrar(B1);
  const tv1 = Number(usuario(B1.id).token_version || 0);
  const b0 = maxBitacora();
  const ip = ipPropia();
  const intentos = [];
  for (let i = 0; i < 5; i += 1) intentos.push(await api("POST", "/auth/reauth", { accion: "usuarios:baja", password: `Mala-${i}-contraseña` }, tB1, ip));
  const u1 = usuario(B1.id);
  const sesion1 = await api("GET", "/auth/me", undefined, tB1);
  const login1 = await api("POST", "/auth/login", { email: B1.email, password: PASS }, undefined, ipPropia());
  check("[cob:A:S-05] [cob:A:E-25] 5 reautenticaciones fallidas: 401 reauth_fallida y la 5.ª 401 cuenta_bloqueada; bloqueado_hasta, token_version+1 (la sesión → 401), «bloquear» en la bitácora y el login correcto ya no entra", intentos.slice(0, 4).every((r) => r.status === 401 && r.data?.codigo === "reauth_fallida") && intentos[4].status === 401 && intentos[4].data?.codigo === "cuenta_bloqueada" && Date.parse(u1.bloqueado_hasta) > Date.now() && Number(u1.token_version) === tv1 + 1 && sesion1.status === 401 && bitacoraDe(B1.id, b0).some((b) => b.accion === "bloquear") && login1.status === 401, `${intentos.map((r) => `${r.status}${r.data?.codigo}`).join(",")} ${u1.bloqueado_hasta} ${detalle(sesion1)} ${login1.status}`);

  const B2 = await cuenta("Bloqueo Clave");
  const tB2 = await entrar(B2);
  const fallos = [];
  for (let i = 0; i < 5; i += 1) fallos.push(await api("POST", "/auth/password", { actual: `Mala-${i}-contraseña`, nueva: `Otra-${s5}-Clave-2026` }, tB2, ipPropia()));
  const u2 = usuario(B2.id);
  check("[cob:A:S-05] 5 cambios de contraseña con la actual incorrecta también bloquean la cuenta (la 5.ª avisa del bloqueo)", fallos.every((r) => r.status === 401) && /bloqueada/.test(fallos[4].data?.message) && Date.parse(u2.bloqueado_hasta) > Date.now(), `${fallos.map((r) => r.status).join(",")} ${fallos[4].data?.message} ${u2.bloqueado_hasta}`);

  // S-06: por el sistema al pasar los 15 min (se simula la hora) o por usuarios:G con motivo.
  ejecutar("UPDATE usuarios SET bloqueado_hasta = ? WHERE id = ?", new Date(Date.now() - 60_000).toISOString(), B1.id);
  const pasa = await api("POST", "/auth/login", { email: B1.email, password: PASS }, undefined, ipPropia());
  const bD = maxBitacora();
  const desbloquea = await api("POST", `/admin/usuarios/${B2.id}/desbloquear`, { motivo: "Confirmó su identidad" }, t.jorge);
  const entra = await api("POST", "/auth/login", { email: B2.email, password: PASS }, undefined, ipPropia());
  check("[cob:A:S-06] bloqueada → activa: al vencer el bloqueo entra sola; o la desbloquea usuarios:G con motivo (bloqueado_hasta NULL, «desbloquear» en la bitácora) y entra", pasa.status === 200 && desbloquea.status === 200 && !usuario(B2.id).bloqueado_hasta && bitacoraDe(B2.id, bD).some((b) => b.accion === "desbloquear" && b.motivo === "Confirmó su identidad") && entra.status === 200, `${detalle(pasa)} | ${detalle(desbloquea)} | ${detalle(entra)}`);
}

/* ---------- Sesiones: salir, cerrar todas (S-22, S-23, E-22, E-23) ---------- */
{
  const S1 = await cuenta("Sesiones");
  const a = await entrar(S1);
  const b = await entrar(S1);
  const sinSesion = await api("POST", "/auth/logout", { motivo: "salir" });
  const sale = await api("POST", "/auth/logout", { motivo: "inactividad" }, a);
  const jti = JSON.parse(Buffer.from(String(a).split(".")[1], "base64url").toString("utf8")).jti;
  const rev = fila("SELECT motivo, usuario_id FROM sesiones_revocadas WHERE jti = ?", jti);
  const meA = await api("GET", "/auth/me", undefined, a);
  const meB = await api("GET", "/auth/me", undefined, b);
  check("[cob:A:S-22] [cob:A:E-22] salir: sin sesión → 401; revoca solo esa sesión por su jti (motivo inactividad) y las demás siguen", sinSesion.status === 401 && sale.status === 200 && sale.data?.revocada === true && rev?.motivo === "inactividad" && Number(rev?.usuario_id) === S1.id && meA.status === 401 && meA.data?.codigo === "sesion_revocada" && meB.status === 200, `${sinSesion.status} ${detalle(sale)} ${JSON.stringify(rev)} ${detalle(meA)} ${meB.status}`);
  const tv = Number(usuario(S1.id).token_version || 0);
  const bS = maxBitacora();
  const todasSin = await api("POST", "/auth/logout-all", {});
  const todas = await api("POST", "/auth/logout-all", {}, b);
  const meB2 = await api("GET", "/auth/me", undefined, b);
  const c = await entrar(S1);
  check("[cob:A:S-23] [cob:A:E-23] cerrar todas: sin sesión → 401; token_version+1, la sesión actual → 401 sesion_revocada, «cerrar_sesiones» en la bitácora y un login nuevo entra", todasSin.status === 401 && todas.status === 200 && Number(usuario(S1.id).token_version) === tv + 1 && meB2.status === 401 && meB2.data?.codigo === "sesion_revocada" && bitacoraDe(S1.id, bS).some((x) => x.accion === "cerrar_sesiones") && (await api("GET", "/auth/me", undefined, c)).status === 200, `${todasSin.status} ${detalle(todas)} ${detalle(meB2)}`);
}

/* ---------- Solicitudes: aprobar, rechazar, cancelar y vencer (S-27) ---------- */
{
  const pedir = async (motivo) => (await api("POST", `/admin/usuarios/${RG.id}/roles`, { rol_id: R2.id, motivo }, t.jorge, SIN_APROBAR)).data?.solicitud?.id;
  const estado = (sid) => fila("SELECT estado FROM solicitudes_autorizacion WHERE id = ?", sid)?.estado;
  const s1 = await pedir("Rol dos para la responsable");
  const afectado = await api("POST", `/solicitudes/${s1}/aprobar`, { motivo: "Es sobre mi cuenta" }, tRG);
  const afectadoR = await api("POST", `/solicitudes/${s1}/rechazar`, { motivo: "Es sobre mi cuenta" }, tRG);
  const corto = await api("POST", `/solicitudes/${s1}/aprobar`, { motivo: "ok" }, t.patricia);
  const ajeno = await api("POST", `/solicitudes/${s1}/cancelar`, { motivo: "No es mía" }, t.patricia);
  const cancela = await api("POST", `/solicitudes/${s1}/cancelar`, { motivo: "Ya no hace falta" }, t.jorge);
  const tarde = await api("POST", `/solicitudes/${s1}/aprobar`, { motivo: "Llegó tarde" }, t.patricia);
  const s2 = await pedir("Rol dos, segundo intento");
  const rechaza = await api("POST", `/solicitudes/${s2}/rechazar`, { motivo: "No corresponde a su puesto" }, t.patricia);
  const s3 = await pedir("Rol dos, tercer intento");
  ejecutar("UPDATE solicitudes_autorizacion SET vence_en = ? WHERE id = ?", new Date(Date.now() - 60_000).toISOString(), s3);
  const vencida = await api("POST", `/solicitudes/${s3}/aprobar`, { motivo: "Aprobación fuera de plazo" }, t.patricia);
  check("[cob:A:S-27] solicitud: la persona afectada no la aprueba ni rechaza (409 regla 6); motivo < 5 → 400; solo quien pidió cancela (otro → 403) → cancelada (ya no se aprueba: 409); rechazada con motivo; vencida → 409 solicitud_vencida; el rol nunca se asigna", afectado.status === 409 && afectado.data?.regla === 6 && afectadoR.status === 409 && afectadoR.data?.regla === 6 && corto.status === 400 && ajeno.status === 403 && cancela.status === 200 && estado(s1) === "cancelada" && tarde.status === 409 && rechaza.status === 200 && estado(s2) === "rechazada" && vencida.status === 409 && vencida.data?.codigo === "solicitud_vencida" && estado(s3) === "vencida" && !asignacionDe(RG.id, R2.id), [afectado, afectadoR, corto, ajeno, cancela, tarde, rechaza, vencida].map(detalle).join(" | "));
}

/* ---------- Cargo con varios roles y autorizaciones FX-THF-AP (S-21, S-26, E-13..E-15) ---------- */
let AUT20, AUT3;
{
  const RA = await rolPropio("Aprobador");
  const amplia = await api("PUT", `/admin/roles/${RA.id}`, { nombre: RA.nombre, descripcion: "Rol de la prueba de cobertura", activo: true, permisos: [{ modulo: "ensayos", accion: "A", alcance: "total" }], motivo: "Aprueba ensayos" }, t.jorge);
  const asigna = await api("POST", `/admin/usuarios/${K1.id}/roles`, { rol_id: RA.id, motivo: "Segundo cargo del coordinador" }, t.jorge);
  ejecutar("UPDATE usuarios SET cargo_predeterminado = NULL WHERE id = ?", K1.id);
  const cuantas = () => Number(fila("SELECT COUNT(*) AS n FROM autorizaciones_personal WHERE usuario_id = ?", LA.id)?.n);
  const n0 = cuantas();
  const body = (extra) => ({ tipo: "actividad", clave: "recepcion", motivo: "Autorización de la prueba de cobertura", vigente_hasta: enDias(20), ...extra });
  const elegir = await api("POST", `/admin/usuarios/${LA.id}/autorizaciones`, body(), tK1);
  const invalido = await api("POST", `/admin/usuarios/${LA.id}/autorizaciones`, body(), tK1, { "X-Actuar-Como": String(rol("tecnico_auxiliar")) });
  const fija = await api("PUT", "/auth/me/cargo", { rol_id: RA.id }, tK1);
  const conCargo = await api("POST", `/admin/usuarios/${LA.id}/autorizaciones`, body(), tK1);
  AUT20 = conCargo.data?.item?.id;
  const conHeader = await api("POST", `/admin/usuarios/${LA.id}/autorizaciones`, body({ clave: "extraccion", vigente_hasta: enDias(3) }), tK1, { "X-Actuar-Como": String(rol("coord_area_tecnica")) });
  AUT3 = conHeader.data?.item?.id;
  const opciones = (elegir.data?.opciones || []).map((o) => Number(o.rol_id)).sort((a, b) => a - b).join();
  check("[cob:A:S-26] varios roles con el permiso: sin cargo predeterminado → 409 ELEGIR_CARGO con las opciones; un cargo que no lo otorga (X-Actuar-Como) → 403 CARGO_INVALIDO; con cargo predeterminado o cabecera queda en *_cargo (otorgada_rol)", amplia.status === 200 && asigna.status < 300 && elegir.status === 409 && elegir.data?.codigo === "ELEGIR_CARGO" && opciones === [RA.id, rol("coord_area_tecnica")].sort((a, b) => a - b).join() && invalido.status === 403 && invalido.data?.codigo === "CARGO_INVALIDO" && fija.status === 200 && conCargo.status === 201 && fila("SELECT otorgada_rol FROM autorizaciones_personal WHERE id = ?", AUT20)?.otorgada_rol === RA.nombre && conHeader.status === 201 && fila("SELECT otorgada_rol FROM autorizaciones_personal WHERE id = ?", AUT3)?.otorgada_rol === "Coordinador/a del Área Técnica" && cuantas() === n0 + 2, `${amplia.status} ${asigna.status} ${detalle(elegir)} [${opciones}] | ${detalle(invalido)} | ${detalle(fija)} | ${detalle(conCargo)} | ${detalle(conHeader)}`);

  const verLA = await api("GET", `/admin/usuarios/${LA.id}/autorizaciones`, undefined, tLA);
  const verK1 = await api("GET", `/admin/usuarios/${LA.id}/autorizaciones`, undefined, tK1);
  const verSR = await api("GET", `/admin/usuarios/${LA.id}/autorizaciones`, undefined, tSR);
  const verNo = await api("GET", "/admin/usuarios/99999999/autorizaciones", undefined, tK1);
  check("[cob:A:E-13] GET autorizaciones de una cuenta: la persona (sin administrarlas), quien tiene ensayos:A o calidad:A (puede_administrar) → 200; sin usuarios:V → 403; inexistente → 404", verLA.status === 200 && verLA.data?.puede_administrar === false && (verLA.data?.items || []).some((a) => Number(a.id) === AUT20) && verK1.status === 200 && verK1.data?.puede_administrar === true && verSR.status === 403 && verNo.status === 404, [verLA, verK1, verSR, verNo].map(detalle).join(" | "));
  // Con usuarios:V de alcance propio solo se ve la propia cuenta (como GET /admin/usuarios/:id).
  const verC = await api("GET", `/admin/usuarios/${LA.id}/autorizaciones`, undefined, tC);
  check("[cob:A:E-13] con usuarios:V de alcance propio, las autorizaciones de otra cuenta → 403 (como su ficha)", verC.status === 403, `${detalle(verC)} items=${(verC.data?.items || []).length}`);

  const oSinPermiso = await api("POST", `/admin/usuarios/${LA.id}/autorizaciones`, body({ clave: "procesamiento" }), tC);
  const oNo = await api("POST", "/admin/usuarios/99999999/autorizaciones", body({ clave: "procesamiento" }), tK1);
  const oYo = await api("POST", `/admin/usuarios/${K1.id}/autorizaciones`, body({ clave: "procesamiento" }), tK1);
  const oDup = await api("POST", `/admin/usuarios/${LA.id}/autorizaciones`, body(), tK1);
  const oSinReauth = await api("POST", `/admin/usuarios/${LA.id}/autorizaciones`, body({ clave: "procesamiento" }), tK1, SIN_REAUTH);
  check("[cob:A:E-14] otorgar autorización: sin ensayos:A ni calidad:A → 403; a sí mismo → 409; duplicada → 409; inexistente → 404; pide reautenticación autorizaciones:otorgar (400 de catálogo y fechas en V-30/V-31)", oSinPermiso.status === 403 && oYo.status === 409 && oYo.data?.clave === "autorizacion_propia" && oDup.status === 409 && oNo.status === 404 && reauthPide(oSinReauth, "autorizaciones:otorgar") && cuantas() === n0 + 2, [oSinPermiso, oYo, oDup, oNo, oSinReauth].map(detalle).join(" | "));

  // S-21: por iniciar → revocada; vigente → vencida (barrido).
  const porIniciar = await api("POST", `/admin/usuarios/${LA.id}/autorizaciones`, body({ clave: "procesamiento", vigente_desde: enDias(5), vigente_hasta: null }), tK1);
  const PI = porIniciar.data?.item?.id;
  const estadoDe = async (aid) => ((await api("GET", `/admin/usuarios/${LA.id}/autorizaciones`, undefined, tK1)).data?.items || []).find((a) => Number(a.id) === Number(aid))?.estado;
  const e1 = await estadoDe(PI);
  const rSinPermiso = await api("POST", `/admin/usuarios/${LA.id}/autorizaciones/${PI}/revocar`, { motivo: "Ya no se incorpora" }, tC);
  const rNo = await api("POST", `/admin/usuarios/${LA.id}/autorizaciones/99999999/revocar`, { motivo: "Ya no se incorpora" }, tK1);
  const revoca = await api("POST", `/admin/usuarios/${LA.id}/autorizaciones/${PI}/revocar`, { motivo: "Ya no se incorpora" }, tK1);
  const e2 = await estadoDe(PI);
  const otraVez = await api("POST", `/admin/usuarios/${LA.id}/autorizaciones/${PI}/revocar`, { motivo: "Ya no se incorpora" }, tK1);
  check("[cob:A:E-15] revocar autorización: sin ensayos:A ni calidad:A → 403; inexistente → 404; ya revocada → 409 (a sí mismo → 409 en V-34)", rSinPermiso.status === 403 && rNo.status === 404 && revoca.status === 200 && otraVez.status === 409 && /ya estaba revocada/.test(otraVez.data?.message), [rSinPermiso, rNo, revoca, otraVez].map(detalle).join(" | "));
  const vence = await api("POST", `/admin/usuarios/${LA.id}/autorizaciones`, body({ clave: "analisis", vigente_desde: enDias(-10), vigente_hasta: null }), tK1);
  const VE = vence.data?.item?.id;
  const e3 = await estadoDe(VE);
  ejecutar("UPDATE autorizaciones_personal SET vigente_hasta = ? WHERE id = ?", enDias(-1), VE);
  const e4 = await estadoDe(VE);
  let registrado = null;
  for (let i = 0; i < 40 && !registrado; i += 1) {
    await api("GET", "/auth/me", undefined, tLA);
    registrado = fila("SELECT vencimiento_registrado_en FROM autorizaciones_personal WHERE id = ?", VE)?.vencimiento_registrado_en;
    if (!registrado) await new Promise((r) => setTimeout(r, 2500));
  }
  check("[cob:A:S-21] autorización: por iniciar (inicio futuro) → revocada con motivo; vigente → vencida al pasar su fin (el barrido la registra)", porIniciar.status === 201 && e1 === "por_iniciar" && e2 === "revocada" && vence.status === 201 && e3 === "vigente" && e4 === "vencida" && !!registrado, `${detalle(porIniciar)} ${e1}→${e2} | ${detalle(vence)} ${e3}→${e4} ${registrado}`);
}

/* ---------- Foto de perfil, cuentas activas y firmas (S-28, E-30, E-31, E-43..E-45) ---------- */
{
  const fd = new FormData();
  fd.append("archivo", new Blob([await sharp({ create: { width: 128, height: 128, channels: 3, background: { r: 30, g: 120, b: 90 } } }).png().toBuffer()], { type: "image/png" }), "foto.png");
  const sube = await api("POST", "/auth/me/foto", fd, tLA);
  const ver = async (token) => (await fetch(`${BASE}/cuentas/${LA.id}/foto`, token ? { headers: { Authorization: `Bearer ${token}` } } : {})).status;
  const activa = async () => ((await api("GET", "/cuentas/activas", undefined, tC)).data?.items || []).find((u) => Number(u.id) === LA.id);
  const v1 = [await ver(tC), await ver(tLA), await ver(null)];
  const a1 = await activa();
  const figura = await api("PUT", "/auth/me/foto", { usa_foto: false }, tLA);
  const v2 = [await ver(tC), await ver(tLA)];
  const a2 = await activa();
  const otraVez = await api("PUT", "/auth/me/foto", { usa_foto: true }, tLA);
  const v3 = await ver(tC);
  const quita = await api("DELETE", "/auth/me/foto", undefined, tLA);
  const v4 = await ver(tLA);
  const quitaOtra = await api("DELETE", "/auth/me/foto", undefined, tLA);
  const sinFoto = await api("PUT", "/auth/me/foto", { usa_foto: true }, tLA);
  const sinSesion = await api("DELETE", "/auth/me/foto");
  const putSinSesion = await api("PUT", "/auth/me/foto", { usa_foto: false });
  check("[cob:A:S-28] foto ↔ figura: subirla la muestra a todos; «usar figura» la oculta a los demás (404) pero no a su dueño; volver a usarla la muestra; quitarla borra la foto (otra vez: «No tienes foto de perfil»)", sube.status === 200 && v1[0] === 200 && v1[1] === 200 && !!a1?.foto && figura.status === 200 && v2[0] === 404 && v2[1] === 200 && a2?.foto === null && otraVez.status === 200 && v3 === 200 && quita.status === 200 && !usuario(LA.id).foto && Number(usuario(LA.id).usa_foto) === 0 && v4 === 404 && quitaOtra.status === 200 && quitaOtra.data?.message === "No tienes foto de perfil", `${detalle(sube)} ${v1} ${a1?.foto} | ${detalle(figura)} ${v2} ${a2?.foto} | ${v3} | ${detalle(quita)} ${v4} | ${detalle(quitaOtra)}`);
  check("[cob:A:E-30] [cob:A:E-31] PUT /auth/me/foto sin foto → 400 «Primero sube una foto»; PUT y DELETE sin sesión → 401", sinFoto.status === 400 && sinFoto.data?.message === "Primero sube una foto" && sinSesion.status === 401 && putSinSesion.status === 401, `${detalle(sinFoto)} | ${sinSesion.status} ${putSinSesion.status}`);
  check("[cob:A:E-44] GET /cuentas/:id/foto: sin sesión → 401; sin foto → 404; con «usar figura» → 404 a los demás y 200 a su dueño (el renglón dice que no revisa usa_foto: desactualizado)", v1[2] === 401 && v4 === 404 && v2[0] === 404 && v2[1] === 200, `${v1} ${v2} ${v4}`);
  const activasSin = await api("GET", "/cuentas/activas");
  const activas = (await api("GET", "/cuentas/activas", undefined, tC)).data?.items || [];
  check("[cob:A:E-43] GET /cuentas/activas: sin sesión → 401; con sesión, las cuentas activas con su correo y sin las de baja", activasSin.status === 401 && activas.some((u) => Number(u.id) === LA.id && u.email === LA.email) && !activas.some((u) => Number(u.id) === Inact.id) && activas.every((u) => "email" in u), `${activasSin.status} ${activas.length}`);

  const F = await cuenta("Firmante");
  const tF = await entrar(C);
  const sinSesionF = await api("POST", "/firmas/confirmar", { usuario_id: F.id, password: PASS });
  const ok = await api("POST", "/firmas/confirmar", { usuario_id: F.id, password: PASS }, tF);
  const inactiva = await api("POST", "/firmas/confirmar", { usuario_id: Inact.id, password: PASS }, tF);
  const malas = [];
  for (let i = 0; i < 5; i += 1) malas.push(await api("POST", "/firmas/confirmar", { usuario_id: F.id, password: `Mala-${i}-firma` }, tF));
  const sexta = await api("POST", "/firmas/confirmar", { usuario_id: F.id, password: PASS }, tF);
  const otraSesion = await api("POST", "/firmas/confirmar", { usuario_id: F.id, password: PASS }, tAP);
  check("[cob:A:E-45] confirmar firma: sin sesión → 401; correcta → token de un solo uso; cuenta inactiva → 400; incorrecta → 401 firma_invalida; 5 fallos bloquean al firmante (otra sesión → 423) y la sesión que falló → 429 firma_intentos", sinSesionF.status === 401 && ok.status === 200 && !!ok.data?.token_firma && Number(ok.data?.usuario?.id) === F.id && inactiva.status === 400 && malas.every((r) => r.status === 401 && r.data?.codigo === "firma_invalida") && !!usuario(F.id).bloqueado_hasta && sexta.status === 429 && sexta.data?.codigo === "firma_intentos" && otraSesion.status === 423 && /bloqueada/.test(otraSesion.data?.message), `${sinSesionF.status} ${detalle(ok)} ${detalle(inactiva)} ${malas.map((r) => r.status)} ${detalle(sexta)} | ${detalle(otraSesion)}`);
}

/* ---------- Configuración, salud, búsqueda, campana e Inicio (E-28, E-35, E-39, E-41, E-42, E-46) ---------- */
{
  const config = await api("GET", "/auth/config");
  check("[cob:A:E-28] GET /auth/config sin sesión: dominios permitidos, inactividad 30 min, sesión de 8 h e instalación no pendiente", config.status === 200 && JSON.stringify(config.data?.dominios_permitidos) === JSON.stringify(["cicese.mx", "ficotox.local"]) && config.data?.sesion?.inactividad_min === 30 && config.data?.sesion?.expira_horas === 8 && config.data?.instalacion_pendiente === false, detalle(config));
  const salud = await api("GET", "/health");
  const saludDb = await api("GET", "/health/db");
  check("[cob:A:E-46] GET /health y /health/db sin sesión → 200 (la base responde y es la de pruebas); el 503 con la base caída no se prueba", salud.status === 200 && salud.data?.ok === true && saludDb.status === 200 && saludDb.data?.database === "reachable" && saludDb.data?.archivo === "ficotox-test.sqlite3", `${detalle(salud)} | ${detalle(saludDb)} ${saludDb.data?.archivo}`);

  const buscaSin = await api("GET", `/busqueda?q=${encodeURIComponent(LA.nombre)}`);
  let conG = null;
  for (let i = 0; i < 4; i += 1) {
    conG = await api("GET", `/busqueda?q=${encodeURIComponent(LA.nombre)}`, undefined, tAP);
    if ((conG.data?.grupos || []).some((g) => (g.resultados || []).some((x) => x.clave === `u-${LA.id}`))) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const persona = (r) => (r.data?.grupos || []).some((g) => (g.resultados || []).some((x) => x.clave === `u-${LA.id}`));
  const propio = await api("GET", `/busqueda?q=${encodeURIComponent(LA.nombre)}`, undefined, tC);
  check("[cob:A:E-35] GET /busqueda: sin sesión → 401; los resultados dependen de los permisos (la cuenta ajena aparece para usuarios:G y no para quien solo ve su cuenta)", buscaSin.status === 401 && conG.status === 200 && persona(conG) && propio.status === 200 && !persona(propio), `${buscaSin.status} ${conG.status} ${persona(conG)} ${propio.status} ${persona(propio)}`);

  const notiSin = await api("GET", "/notificaciones");
  const noti = await api("GET", "/notificaciones", undefined, tC);
  check("[cob:A:E-39] GET /notificaciones: sin sesión → 401; con sesión items, anteriores y total = no leídas", notiSin.status === 401 && noti.status === 200 && Array.isArray(noti.data?.items) && Array.isArray(noti.data?.anteriores) && noti.data?.total === noti.data.items.length, `${notiSin.status} ${detalle(noti)}`);
  const avSin = await api("GET", "/inicio/avisos");
  const av = await api("GET", "/inicio/avisos", undefined, tC);
  check("[cob:A:E-41] GET /inicio/avisos: sin sesión → 401; con sesión los grupos y el total (suma de sus cuentas)", avSin.status === 401 && av.status === 200 && Array.isArray(av.data?.items) && av.data?.total === (av.data.items || []).reduce((n, g) => n + g.count, 0), `${avSin.status} ${detalle(av)}`);
  const cursoSR = await api("GET", "/inicio/en-curso", undefined, tSR);
  const cursoLA = await api("GET", "/inicio/en-curso", undefined, tLA);
  check("[cob:A:E-42] GET /inicio/en-curso: sin muestras:V → 403; con muestras:V → 200", cursoSR.status === 403 && /muestras:V/.test(cursoSR.data?.message) && cursoLA.status === 200 && Array.isArray(cursoLA.data?.items), `${detalle(cursoSR)} | ${cursoLA.status}`);
}

/* ---------- Avisos de la campana y del Inicio (5.4: A-182..A-208), adjuntos y reportes de mantenimiento ---------- */
{
  const CORTO = readFileSync(new URL("../src/components/features/inicio/pendientes.tsx", import.meta.url), "utf8");
  const corto = (key) => CORTO.match(new RegExp(`\\n\\s*${key}: \\{ label: "([^"]+)"`))?.[1] ?? null;
  const campana = async (token) => {
    const r = await api("GET", "/notificaciones", undefined, token);
    return [...(r.data?.items || []), ...(r.data?.anteriores || [])];
  };
  /* El aviso `key` de una persona: su evento (por predicado) en la campana y el grupo del Inicio. */
  async function aviso(token, key, pred) {
    const evs = (await campana(token)).filter((n) => n.grupo === key);
    const g = ((await api("GET", "/inicio/avisos", undefined, token)).data?.items || []).find((x) => x.key === key) || null;
    return { ev: evs.find(pred) || null, g };
  }
  const es = (a, { label, href, titulo, evHref, tone }) => !!a.ev && !!a.g && a.g.label === label && a.g.href === href && (!tone || a.g.tone === tone) && (!titulo || a.ev.titulo === titulo) && (!evHref || a.ev.href === evHref);
  const res = (a) => `${a.ev ? `${a.ev.titulo} → ${a.ev.href}` : "sin evento"} | ${a.g ? `${a.g.label} ${a.g.tone} ${a.g.href}` : "sin grupo"}`;
  const deClave = (inicio) => (n) => String(n.clave).startsWith(inicio);

  // Respaldos: según el estado real de los respaldos de la instancia de pruebas (a quien tiene respaldos:V).
  const est = (await api("GET", "/respaldos", undefined, tK3)).data || {};
  const sinRespaldo = !est.ultimo_respaldo || Date.now() - Date.parse(est.ultimo_respaldo.creado_en) > est.aviso_horas * 3_600_000;
  const sinPrueba = !est.ultima_aprobada || Date.now() - Date.parse(est.ultima_aprobada.fecha) > est.prueba_dias * 86_400_000;
  const rv = await aviso(tK3, "respaldo_viejo", () => true);
  const pv = await aviso(tK3, "prueba_vieja", () => true);
  const rvLA = await aviso(tLA, "respaldo_viejo", () => true);
  const pvLA = await aviso(tLA, "prueba_vieja", () => true);
  check("[cob:A:A-183] «Sin respaldo reciente» (Inicio igual) a quien tiene respaldos:V solo si pasaron más de 24 h del último respaldo, hacia /calidad/respaldos; sin respaldos:V nunca", (sinRespaldo ? es(rv, { label: "Sin respaldo reciente", href: "/calidad/respaldos", titulo: "Sin respaldo reciente: Respaldos", evHref: "/calidad/respaldos" }) : !rv.ev && !rv.g) && !rvLA.ev && corto("respaldo_viejo") === "Sin respaldo reciente", `sinRespaldo=${sinRespaldo} ${res(rv)} | LA ${res(rvLA)}`);
  check("[cob:A:A-184] «Sin prueba de restauración» (Inicio igual) a quien tiene respaldos:V solo si la última prueba aprobada tiene más de 90 días, hacia /calidad/respaldos; sin respaldos:V nunca", (sinPrueba ? es(pv, { label: "Sin prueba de restauración", href: "/calidad/respaldos", titulo: "Sin prueba de restauración: Respaldos", evHref: "/calidad/respaldos", tone: "warning" }) : !pv.ev && !pv.g) && !pvLA.ev && corto("prueba_vieja") === "Sin prueba de restauración", `sinPrueba=${sinPrueba} ${res(pv)} | LA ${res(pvLA)}`);

  // Por autorizar: solicitud sobre la cuenta de la responsable propia (ni ella ni quien pidió la ven).
  const pide = await api("POST", `/admin/usuarios/${RG.id}/roles`, { rol_id: R2.id, motivo: "Aviso de por autorizar" }, t.jorge, SIN_APROBAR);
  const sid = pide.data?.solicitud?.id;
  const paMC = await aviso(tMC, "por_autorizar", (n) => n.clave === `solicitud:${sid}`);
  const paRG = await aviso(tRG, "por_autorizar", (n) => n.clave === `solicitud:${sid}`);
  const paAP = await aviso(tAP, "por_autorizar", (n) => n.clave === `solicitud:${sid}`);
  check("[cob:A:A-186] «Por autorizar» (Inicio igual): a quien puede aprobarla (usuarios:A) con enlace a /solicitudes?abrir=<id>; no a la persona afectada (aunque tenga usuarios:A) ni a quien no tiene el permiso", pide.status === 202 && es(paMC, { label: "Por autorizar", href: "/solicitudes", titulo: "Por autorizar: Asignar rol", evHref: `/solicitudes?abrir=${sid}` }) && !paRG.ev && !paAP.ev && corto("por_autorizar") === "Por autorizar", `${detalle(pide)} ${res(paMC)} | RG ${res(paRG)} | AP ${res(paAP)}`);
  await rechazar(sid);

  // Por supervisar: un estudiante propio (supervisado por K1) da de alta un reactivo.
  const E2 = await cuenta("Estudiante Supervisado", { rolClave: "estudiante", extra: { tipo_cuenta: "temporal", vigente_hasta: enDias(90), supervisor_id: K1.id, motivo_cuenta: "Estancia supervisada" } });
  const tE2 = await entrar(E2);
  const nombreSup = `Metanol supervisado ${s5}`;
  const sup = await api("POST", "/inventory/reactivos", { tipo_reactivo: "alcoholes_solventes", producto: nombreSup, capacidad: 1, unidad_capacidad: "L", piezas: 4 }, tE2);
  const RSup = Number(sup.data?.id);
  const psK1 = await aviso(tK1, "por_supervisar", deClave(`supervision:reactivos:${RSup}:`));
  const psE2 = await aviso(tE2, "por_supervisar", deClave(`supervision:reactivos:${RSup}:`));
  check("[cob:A:A-185] «Por supervisar» (Inicio igual): al supervisor asignado le llega lo que capturó su supervisado (enlace al registro, grupo → /supervision); a quien lo capturó no", sup.status === 201 && fila("SELECT supervision_estado FROM reactivos WHERE id = ?", RSup)?.supervision_estado === "pendiente" && es(psK1, { label: "Por supervisar", href: "/supervision", evHref: `/inventario/reactivos?abrir=${RSup}`, tone: "warning" }) && psK1.ev.titulo.startsWith("Por supervisar: Reactivo") && !psE2.ev && corto("por_supervisar") === "Por supervisar", `${detalle(sup)} ${res(psK1)} | E2 ${res(psE2)}`);

  // Accesos que vencen en 7 días: cuenta temporal propia supervisada por K1.
  const T7 = await cuenta("Vence Pronto", { extra: { tipo_cuenta: "temporal", vigente_hasta: enDias(5), supervisor_id: K1.id, motivo_cuenta: "Estancia corta" } });
  const tT7 = await entrar(T7);
  const vc = (n) => n.clave === `vence_acceso:${T7.id}:cuenta:${enDias(5)}`;
  const avAP = await aviso(tAP, "accesos_vencen", vc);
  const avK1 = await aviso(tK1, "accesos_vencen", vc);
  const avT7 = await aviso(tT7, "accesos_vencen", vc);
  const avC = await aviso(tC, "accesos_vencen", vc);
  check("[cob:A:A-198] «Accesos que vencen en 7 días» (Inicio «Accesos por vencer»): usuarios:G → /administracion/usuarios?vigencia=vence7 (&abrir); su supervisor → /supervision; la persona («Tu cuenta») → /#mis-autorizaciones; nadie más", es(avAP, { label: "Accesos que vencen en 7 días", href: "/administracion/usuarios?vigencia=vence7", evHref: `/administracion/usuarios?vigencia=vence7&abrir=${T7.id}` }) && es(avK1, { label: "Accesos que vencen en 7 días", href: "/supervision", evHref: "/supervision" }) && es(avT7, { label: "Accesos que vencen en 7 días", href: "/#mis-autorizaciones", evHref: "/#mis-autorizaciones", titulo: "Cuenta por vencer: Tu cuenta" }) && !avC.ev && corto("accesos_vencen") === "Accesos por vencer", `AP ${res(avAP)} | K1 ${res(avK1)} | T7 ${res(avT7)} | C ${res(avC)}`);

  // Autorizaciones por vencer (30 días; la última semana es otra clave).
  const auLA = await aviso(tLA, "autorizaciones_vencen", (n) => n.clave === `vence_autorizacion:${AUT20}:30dias`);
  const auLA7 = await aviso(tLA, "autorizaciones_vencen", (n) => n.clave === `vence_autorizacion:${AUT3}:7dias`);
  const auK1 = await aviso(tK1, "autorizaciones_vencen", (n) => n.clave === `vence_autorizacion:${AUT20}:30dias`);
  const auC = await aviso(tC, "autorizaciones_vencen", (n) => n.clave === `vence_autorizacion:${AUT20}:30dias`);
  check("[cob:A:A-199] «Autorizaciones por vencer (30 días)» (Inicio «Autorizaciones por vencer»): la persona («Tu autorización») → /#mis-autorizaciones; quien las administra (ensayos:A) → /administracion/usuarios?abrir=<id>; la última semana con clave nueva; nadie más", es(auLA, { label: "Autorizaciones por vencer (30 días)", href: "/#mis-autorizaciones", evHref: "/#mis-autorizaciones", titulo: "Autorización por vencer: Tu autorización: Recepción de muestras" }) && !!auLA7.ev && es(auK1, { label: "Autorizaciones por vencer (30 días)", href: "/administracion/usuarios", evHref: `/administracion/usuarios?abrir=${LA.id}` }) && auK1.ev.titulo.includes(LA.nombre) && !auC.ev && corto("autorizaciones_vencen") === "Autorizaciones por vencer", `LA ${res(auLA)} 7d=${!!auLA7.ev} | K1 ${res(auK1)} | C ${res(auC)}`);

  // Inventario: reactivo bajo el mínimo y por caducar, consumible con poca existencia.
  const nombreR = `Acetonitrilo aviso ${s5}`;
  const RB = Number((await api("POST", "/inventory/reactivos", { tipo_reactivo: "alcoholes_solventes", producto: nombreR, capacidad: 1, unidad_capacidad: "L", piezas: 1, stock_minimo: 5, caducidad: enDias(10) }, t.qa)).data?.id);
  const nombreCo = `Viales aviso ${s5}`;
  const CB = Number((await api("POST", "/consumables", { producto: nombreCo, piezas: 1, cantidad_por_pieza: 3 }, t.qa)).data?.id);
  const rbK1 = await aviso(tK1, "reactivos_bajos", deClave(`stock_bajo:reactivo${RB}:bajo:`));
  const rbLA = await aviso(tLA, "reactivos_bajos", deClave(`stock_bajo:reactivo${RB}:`));
  check("[cob:A:A-195] «Reactivos con stock bajo» (Inicio «Stock bajo»): a quien administra inventario le llega el reactivo bajo su mínimo (enlace a su ficha); al Técnico Analista (inventario C de movimientos) no", !!RB && es(rbK1, { label: "Reactivos con stock bajo", href: "/inventario/reactivos?filtro=bajo", titulo: `Stock bajo: ${nombreR}`, evHref: `/inventario/reactivos?abrir=${RB}` }) && !rbLA.ev && corto("reactivos_bajos") === "Stock bajo", `${RB} ${res(rbK1)} | LA ${res(rbLA)}`);
  const rcK1 = await aviso(tK1, "reactivos_caducan", deClave(`caducidad:reactivo${RB}:${enDias(10)}:pronto`));
  const rcLA = await aviso(tLA, "reactivos_caducan", deClave(`caducidad:reactivo${RB}:`));
  check("[cob:A:A-196] «Reactivos por caducar» (Inicio «Por caducar»): caducidad en ≤ 30 días a quien administra inventario («Caduca pronto»); al Técnico Analista no", es(rcK1, { label: "Reactivos por caducar", href: "/inventario/reactivos?filtro=vencer", titulo: `Caduca pronto: ${nombreR}`, evHref: `/inventario/reactivos?abrir=${RB}` }) && !rcLA.ev && corto("reactivos_caducan") === "Por caducar", `${res(rcK1)} | LA ${res(rcLA)}`);
  const cbK1 = await aviso(tK1, "consumibles_bajos", deClave(`stock_bajo:consumible${CB}:bajo:`));
  const cbLA = await aviso(tLA, "consumibles_bajos", deClave(`stock_bajo:consumible${CB}:`));
  check("[cob:A:A-197] «Consumibles con poca existencia» (Inicio «Consumibles bajos»): 3 unidades (≤ 5 sin mínimo) a quien administra inventario («Pocas unidades»); al Técnico Analista no", !!CB && es(cbK1, { label: "Consumibles con poca existencia", href: "/inventario/consumibles?filtro=bajo", titulo: `Pocas unidades: ${nombreCo}`, evHref: `/inventario/consumibles?abrir=${CB}` }) && !cbLA.ev && corto("consumibles_bajos") === "Consumibles bajos", `${CB} ${res(cbK1)} | LA ${res(cbLA)}`);

  // Equipos: mantenimiento próximo, vencido y calibración pendiente (equipos propios).
  const nombreEq = `Equipo avisos ${s5}`;
  const EQ = Number((await api("POST", "/inventory/equipos", { nombre: nombreEq, estado: "operativo" }, t.qa)).data?.id);
  const EQc = Number((await api("POST", "/inventory/equipos", { nombre: `Equipo calibración ${s5}`, estado: "calibracion_pendiente" }, t.qa)).data?.id);
  const MP = Number((await api("POST", "/inventory/mantenimientos", { id_equipo: EQ, tipo: "preventivo", fecha_programada: enDias(10), estado: "programado" }, t.carmen)).data?.id);
  const MV = Number((await api("POST", "/inventory/mantenimientos", { id_equipo: EQ, tipo: "correctivo", fecha_programada: enDias(20), estado: "programado" }, t.carmen)).data?.id);
  // Que un mantenimiento se atrase es el paso del tiempo: se mueve su fecha al pasado.
  ejecutar("UPDATE mantenimientos SET fecha_programada = ? WHERE id = ?", enDias(-3), MV);
  const mpK1 = await aviso(tK1, "mant_proximos", (n) => n.clave === `mantenimiento:${MP}:proximo`);
  const mpLA = await aviso(tLA, "mant_proximos", (n) => n.clave === `mantenimiento:${MP}:proximo`);
  const mvK1 = await aviso(tK1, "mant_vencidos", (n) => n.clave === `mantenimiento:${MV}:vencido`);
  const mvCa = await aviso(t.carmen, "mant_vencidos", (n) => n.clave === `mantenimiento:${MV}:vencido`);
  const mvLA = await aviso(tLA, "mant_vencidos", (n) => n.clave === `mantenimiento:${MV}:vencido`);
  const cal = await aviso(tK1, "equipos_cal", deClave(`calibracion:equipo${EQc}:calibracion_pendiente`));
  const calLA = await aviso(tLA, "equipos_cal", deClave(`calibracion:equipo${EQc}:`));
  check("[cob:A:A-194] «Mantenimientos en los próximos 30 días» (Inicio «Mantenimiento próximo»): a quien gestiona equipos, con enlace ?filtro=proximo&abrir=<id>; al Técnico Analista (equipos de uso) no", !!MP && es(mpK1, { label: "Mantenimientos en los próximos 30 días", href: "/inventario/mantenimiento?filtro=proximo", titulo: `Mantenimiento próximo: ${nombreEq}`, evHref: `/inventario/mantenimiento?filtro=proximo&abrir=${MP}` }) && !mpLA.ev && corto("mant_proximos") === "Mantenimiento próximo", `${MP} ${res(mpK1)} | LA ${res(mpLA)}`);
  check("[cob:A:A-192] «Mantenimientos vencidos» (tono danger; Inicio «Mantenimiento vencido»): a quien gestiona equipos (también equipos:C de mantenimiento); al Técnico Analista no", !!MV && es(mvK1, { label: "Mantenimientos vencidos", href: "/inventario/mantenimiento?filtro=vencido", titulo: `Mantenimiento vencido: ${nombreEq}`, evHref: `/inventario/mantenimiento?filtro=vencido&abrir=${MV}`, tone: "danger" }) && !!mvCa.ev && !mvLA.ev && corto("mant_vencidos") === "Mantenimiento vencido", `${MV} ${res(mvK1)} | carmen ${!!mvCa.ev} | LA ${res(mvLA)}`);
  check("[cob:A:A-193] «Equipos con alerta de calibración» (Inicio «Calibración»): equipo con calibración pendiente a quien gestiona equipos («Calibración pendiente», enlace a su ficha); al Técnico Analista no", !!EQc && es(cal, { label: "Equipos con alerta de calibración", href: "/inventario/equipos?filtro=calibracion", titulo: `Calibración pendiente: Equipo calibración ${s5}`, evHref: `/inventario/equipos?abrir=${EQc}` }) && !calLA.ev && corto("equipos_cal") === "Calibración", `${EQc} ${res(cal)} | LA ${res(calLA)}`);

  // E-49..E-51: reportes PDF del mantenimiento propio.
  const pdf = await pdfConTexto(1, `Reporte de cobertura ${s5}`);
  const formRep = (campos, archivo = pdf, nombre = "reporte.pdf") => {
    const fd = new FormData();
    if (archivo) fd.append("archivo", new Blob([archivo]), nombre);
    for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
    return fd;
  };
  const repSinPermiso = await api("POST", "/documents/maintenance-report", formRep({ id_mantenimiento: MP }), t.hector);
  const repDocx = await api("POST", "/documents/maintenance-report", formRep({ id_mantenimiento: MP }, pdf, "reporte.docx"), t.carmen);
  const repTexto = await api("POST", "/documents/maintenance-report", formRep({ id_mantenimiento: MP }, Buffer.from("Solo texto, no es un PDF"), "texto.pdf"), t.carmen);
  const rep = await api("POST", "/documents/maintenance-report", formRep({ id_mantenimiento: MP }), t.carmen);
  const REP = Number(rep.data?.id);
  check("[cob:A:E-50] POST /documents/maintenance-report: sin equipos:C/E de mantenimiento → 403; otra extensión o contenido que no es PDF → 400; PDF válido → 201 (reemplazar pide mantenimiento:reporte: suite de inventario)", repSinPermiso.status === 403 && repDocx.status === 400 && repTexto.status === 400 && rep.status === 201 && !!REP, [repSinPermiso, repDocx, repTexto, rep].map(detalle).join(" | "));
  const docsSR = await api("GET", `/documents?mantenimiento=${MP}`, undefined, tSR);
  const docsH = await api("GET", `/documents?mantenimiento=${MP}`, undefined, t.hector);
  const archivo = fila("SELECT nombre_almacenado FROM reportes_mantenimiento WHERE id = ?", REP)?.nombre_almacenado;
  const verSR = await api("GET", `/documents/files/${archivo}`, undefined, tSR);
  const verH = await api("GET", `/documents/files/${archivo}`, undefined, t.hector);
  const noHay = await api("GET", `/documents/files/${MP}/no-existe-${s5}.pdf`, undefined, t.hector);
  check("[cob:A:E-49] GET /documents y /documents/files/…: sin equipos:V → 403; con equipos:V la lista trae el reporte y el archivo abre íntegro (X-Integridad-Archivo ok); inexistente → 404", docsSR.status === 403 && docsH.status === 200 && (docsH.data?.items || []).some((d) => Number(d.id) === REP) && verSR.status === 403 && verH.status === 200 && Buffer.isBuffer(verH.data) && verH.data.subarray(0, 5).toString() === "%PDF-" && verH.headers.get("x-integridad-archivo") === "ok" && noHay.status === 404, `${docsSR.status} ${docsH.status} ${verSR.status} ${verH.status} ${verH.headers.get("x-integridad-archivo")} ${noHay.status}`);
  const qCorto = await api("POST", `/documents/maintenance-report/${REP}/quitar`, { motivo: "no" }, t.carmen);
  const qSinPermiso = await api("POST", `/documents/maintenance-report/${REP}/quitar`, { motivo: "Reporte equivocado" }, t.hector);
  const qSinReauth = await api("POST", `/documents/maintenance-report/${REP}/quitar`, { motivo: "Reporte equivocado" }, t.carmen, SIN_REAUTH);
  const quita = await api("POST", `/documents/maintenance-report/${REP}/quitar`, { motivo: "Reporte equivocado" }, t.carmen);
  const otraVez = await api("POST", `/documents/maintenance-report/${REP}/quitar`, { motivo: "Reporte equivocado" }, t.carmen);
  check("[cob:A:E-51] quitar reporte de mantenimiento: motivo < 5 → 400; sin equipos:C/E → 403; pide reautenticación mantenimiento:reporte; con todo 200 y queda anulado; otra vez → 409", qCorto.status === 400 && qSinPermiso.status === 403 && reauthPide(qSinReauth, "mantenimiento:reporte") && quita.status === 200 && !!fila("SELECT anulado_en FROM reportes_mantenimiento WHERE id = ?", REP)?.anulado_en && otraVez.status === 409, [qCorto, qSinPermiso, qSinReauth, quita, otraVez].map(detalle).join(" | "));

  // Muestras, análisis, adjuntos e informes.
  const c = await cadena(t, `AV${s5}`, { asignar: [LA.id] });
  const asignada = await aviso(tLA, "muestras_asignadas", deClave(`asignacion:R${c.R}:usuario${LA.id}:`));
  const noAsignada = await aviso(tC, "muestras_asignadas", deClave(`asignacion:R${c.R}:`));
  check("[cob:A:A-187] «Muestras asignadas» (Inicio «Asignadas a ti»): a la persona asignada (muestras:V) con enlace a la recepción y grupo → /muestras/recepcion?mias=1; a otra cuenta no", !!c.R && es(asignada, { label: "Muestras asignadas", href: "/muestras/recepcion?mias=1", evHref: `/muestras/recepcion/${c.R}`, tone: "info" }) && asignada.ev.titulo.startsWith("Muestra asignada: R ") && !noAsignada.ev && corto("muestras_asignadas") === "Asignadas a ti", `${c.R} ${res(asignada)} | C ${res(noAsignada)}`);

  const A = Number((await api("POST", "/samples/analysis", analisisDe(c), t.qa)).data?.id);
  const bytes = pdfDePrueba(`Cromatograma de cobertura ${s5}`);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const sube = async (contenido) => {
    const r = await adjuntarEvidencia(BASE, t.qa, A, { bytes: contenido });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const s1 = await sube(bytes);
  const s2 = await sube(pdfDePrueba(`Segundo cromatograma ${s5}`));
  const ADJ = Number(s1.data?.item?.id || fila("SELECT id FROM adjuntos WHERE entidad = 'analisis' AND entidad_id = ? ORDER BY id LIMIT 1", A)?.id);
  const ADJ2 = Number(s2.data?.item?.id || fila("SELECT id FROM adjuntos WHERE entidad = 'analisis' AND entidad_id = ? ORDER BY id DESC LIMIT 1", A)?.id);
  const baja = await api("GET", `/adjuntos/${ADJ}/archivo`, undefined, t.qa);
  const sinEnsayos = await api("GET", `/adjuntos/${ADJ}/archivo`, undefined, tAP);
  const noAdj = await api("GET", "/adjuntos/99999999/archivo", undefined, t.qa);
  check("[cob:A:E-47] GET /adjuntos/:id/archivo: con ensayos:V el archivo con su SHA-256 (X-Adjunto-Sha256) y X-Integridad-Adjunto ok; sin ensayos:V → 403; inexistente → 404", !!A && s1.status === 201 && baja.status === 200 && Buffer.isBuffer(baja.data) && createHash("sha256").update(baja.data).digest("hex") === sha && baja.headers.get("x-adjunto-sha256") === sha && baja.headers.get("x-integridad-adjunto") === "ok" && sinEnsayos.status === 403 && noAdj.status === 404 && noAdj.data?.message === "Adjunto no encontrado", `${A} ${s1.status} ${baja.status} ${baja.headers.get("x-adjunto-sha256") === sha} ${baja.headers.get("x-integridad-adjunto")} | ${detalle(sinEnsayos)} | ${detalle(noAdj)}`);
  const anCorto = await api("POST", `/adjuntos/${ADJ2}/anular`, { motivo: "no" }, t.qa);
  const anSinPermiso = await api("POST", `/adjuntos/${ADJ2}/anular`, { motivo: "Archivo equivocado" }, tAP);
  const anSinReauth = await api("POST", `/adjuntos/${ADJ2}/anular`, { motivo: "Archivo equivocado" }, t.qa, SIN_REAUTH);
  const anula = await api("POST", `/adjuntos/${ADJ2}/anular`, { motivo: "Archivo equivocado" }, t.qa);
  const anOtra = await api("POST", `/adjuntos/${ADJ2}/anular`, { motivo: "Archivo equivocado" }, t.qa);
  check("[cob:A:E-48] POST /adjuntos/:id/anular: motivo < 5 → 400; sin permiso del módulo → 403; pide reautenticación adjuntos:anular; anulado (el archivo se conserva); otra vez → 409", s2.status === 201 && anCorto.status === 400 && anSinPermiso.status === 403 && reauthPide(anSinReauth, "adjuntos:anular") && anula.status === 200 && !!fila("SELECT anulado_en FROM adjuntos WHERE id = ?", ADJ2)?.anulado_en && anOtra.status === 409, [anCorto, anSinPermiso, anSinReauth, anula, anOtra].map(detalle).join(" | "));

  await api("POST", `/samples/analysis/${A}/enviar-revision`, {}, t.qa);
  const revisar = await aviso(tK1, "analisis_pendientes", deClave(`analisis:${A}:en_revision:`));
  const propio = await aviso(t.qa, "analisis_pendientes", deClave(`analisis:${A}:`));
  await api("POST", `/samples/analysis/${A}/revisar`, {}, t.ricardo);
  const aprobar = await aviso(tK1, "analisis_pendientes", deClave(`analisis:${A}:revisado:`));
  const analista = await aviso(tLA, "analisis_pendientes", deClave(`analisis:${A}:`));
  check("[cob:A:A-188] «Análisis esperando revisión o aprobación» (Inicio «Análisis por firmar»): «Revisar análisis» a ensayos:R y luego «Aprobar análisis» a ensayos:A, con enlace al análisis; ni a quien lo capturó ni a quien no revisa", es(revisar, { label: "Análisis esperando revisión o aprobación", href: "/muestras/analisis?filtro=pendiente", evHref: `/muestras/analisis/${A}` }) && revisar.ev.titulo.startsWith("Revisar análisis: A ") && !propio.ev && !!aprobar.ev && aprobar.ev.titulo.startsWith("Aprobar análisis: A ") && !analista.ev && corto("analisis_pendientes") === "Análisis por firmar", `${res(revisar)} | qa ${res(propio)} | ${res(aprobar)} | LA ${res(analista)}`);
  await api("POST", `/samples/analysis/${A}/aprobar`, {}, t.ricardo);

  const INF = Number((await api("POST", "/informes", { recepcion_id: c.R, analisis_ids: [A], cliente: { nombre: `Cliente AV${s5}`, correo: "cliente@ejemplo.mx" } }, t.qa)).data?.id);
  const irK1 = await aviso(tK1, "informes_revision", (n) => n.clave === `informe:${INF}:borrador:v1`);
  const irQa = await aviso(t.qa, "informes_revision", (n) => n.clave === `informe:${INF}:borrador:v1`);
  await api("POST", `/informes/${INF}/revisar`, {}, t.ricardo);
  const iaRG = await aviso(tRG, "informes_revision", (n) => n.clave === `informe:${INF}:en_revision:v1`);
  const iaLA = await aviso(tLA, "informes_revision", deClave(`informe:${INF}:`));
  check("[cob:A:A-189] «Informes por revisar o autorizar» (Inicio «Informes por revisar»): el borrador a informes:R («Revisar informe») y en revisión a informes:A («Autorizar informe»), con enlace al informe; ni a quien lo elaboró ni a quien no revisa", !!INF && es(irK1, { label: "Informes por revisar o autorizar", href: "/informes?filtro=pendiente", evHref: `/informes/${INF}` }) && irK1.ev.titulo.startsWith("Revisar informe: IR ") && !irQa.ev && !!iaRG.ev && iaRG.ev.titulo.startsWith("Autorizar informe: IR ") && !iaLA.ev && corto("informes_revision") === "Informes por revisar", `${INF} ${res(irK1)} | qa ${!!irQa.ev} | RG ${res(iaRG)} | LA ${!!iaLA.ev}`);
  await api("POST", `/informes/${INF}/autorizar`, {}, t.patricia);
  const ilRG = await aviso(tRG, "informes_entrega", (n) => n.clave === `informe:${INF}:autorizado:v1`);
  const lib = await liberar(BASE, t.patricia, INF);
  const ieK1 = await aviso(tK1, "informes_entrega", (n) => n.clave === `informe:${INF}:liberado:v1`);
  const ieLA = await aviso(tLA, "informes_entrega", deClave(`informe:${INF}:`));
  check("[cob:A:A-190] «Informes por liberar o enviar» (Inicio «Por liberar o enviar»): a informes:A «Liberar informe» (autorizado) y «Enviar informe» (liberado); a quien no autoriza informes no", es(ilRG, { label: "Informes por liberar o enviar", href: "/informes?filtro=autorizado", evHref: `/informes/${INF}` }) && ilRG.ev.titulo.startsWith("Liberar informe: IR ") && lib.status === 200 && !!ieK1.ev && ieK1.ev.titulo.startsWith("Enviar informe: IR ") && !ieLA.ev && corto("informes_entrega") === "Por liberar o enviar", `${res(ilRG)} | lib ${lib.status} | K1 ${res(ieK1)} | LA ${!!ieLA.ev}`);
  const enm = await api("POST", `/samples/analysis/${A}/enmendar`, { motivo: "Error de transcripción" }, t.qa);
  await api("POST", `/samples/analysis/${enm.data?.id}/enviar-revision`, {}, t.qa);
  await api("POST", `/samples/analysis/${enm.data?.id}/revisar`, {}, t.ricardo);
  await api("POST", `/samples/analysis/${enm.data?.id}/aprobar`, {}, t.ricardo);
  const emLA = await aviso(tLA, "informes_enmienda", (n) => n.clave === `enmienda:${INF}:v1`);
  const emAP = await aviso(tAP, "informes_enmienda", (n) => n.clave === `enmienda:${INF}:v1`);
  const yaNoEntrega = await aviso(tK1, "informes_entrega", deClave(`informe:${INF}:`));
  check("[cob:A:A-191] «Informes que requieren enmienda» (tono danger; Inicio «Requieren enmienda»): al enmendarse un análisis incluido, a informes:C o informes:A con el motivo; deja de ofrecerse para enviar; a quien no tiene informes no", Number(fila("SELECT requiere_enmienda FROM informes WHERE id = ?", INF)?.requiere_enmienda) === 1 && es(emLA, { label: "Informes que requieren enmienda", href: "/informes?filtro=requiere_enmienda", evHref: `/informes/${INF}`, tone: "danger" }) && emLA.ev.titulo.startsWith("Requiere enmienda: IR ") && /se enmendó/.test(emLA.ev.detalle) && !emAP.ev && !yaNoEntrega.ev && corto("informes_enmienda") === "Requieren enmienda", `${detalle(enm)} ${res(emLA)} | AP ${!!emAP.ev} | entrega ${!!yaNoEntrega.ev}`);

  // Documentos SGC: lecturas, solicitudes por atender y solicitudes propias resueltas.
  const S5 = s5.toUpperCase();
  const ficha = new FormData();
  for (const [k, v] of Object.entries({ clave: `FX-TCP-A${S5}0`, titulo: `Procedimiento de avisos ${S5}`, area_codigo: "TC", tipo_codigo: "P", elaborador_id: LA.id, revisor_id: K1.id, autorizador_id: RG.id })) ficha.append(k, String(v));
  ficha.append("archivo_pdf", new Blob([await pdfConTexto(1, `Avisos ${S5}`)]), "inicial.pdf");
  const doc = await api("POST", "/sgc/documentos", ficha, tMC);
  const vig = await api("POST", `/sgc/revisiones/${doc.data?.revision_id}/registrar-vigente`, { fecha_emision: "2025-01-10", fecha_proxima_revision: "2028-01-10" }, tMC);
  const dist = await api("POST", `/sgc/revisiones/${doc.data?.revision_id}/distribucion`, { usuarios: [LA.id], requiere_lectura: true, motivo: "Distribución de la prueba de avisos" }, tMC);
  const lecLA = await aviso(tLA, "documentos_lecturas", deClave(`sgc_lectura:${doc.data?.revision_id}:`));
  const lecC = await aviso(tC, "documentos_lecturas", deClave(`sgc_lectura:${doc.data?.revision_id}:`));
  check("[cob:A:A-200] «Lecturas pendientes» (Inicio «Lecturas pendientes»: el renglón dice que no tiene texto corto, desactualizado): a quien se distribuyó con lectura, enlace al documento ?leer=1, grupo → /documentos/bandeja#lecturas; a quien no, nada", doc.status === 201 && vig.status === 200 && dist.status === 201 && es(lecLA, { label: "Lecturas pendientes", href: "/documentos/bandeja#lecturas", evHref: `/documentos/${doc.data?.id}?leer=1`, tone: "info" }) && !lecC.ev && corto("documentos_lecturas") === "Lecturas pendientes", `${detalle(doc)} ${detalle(vig)} ${detalle(dist)} ${res(lecLA)} | C ${!!lecC.ev}`);
  const solDoc = await api("POST", "/sgc/solicitudes", { tipo: "nuevo", area_codigo: "TC", tipo_codigo: "F", titulo_propuesto: `Formato de avisos ${S5}`, justificacion: "Se necesita registrar la temperatura del congelador" }, tLA);
  const SD = solDoc.data?.id;
  const sgcMC = await aviso(tMC, "documentos_sgc", (n) => n.clave === `sgc_solicitud:${SD}`);
  const sgcLA = await aviso(tLA, "documentos_sgc", (n) => n.clave === `sgc_solicitud:${SD}`);
  check("[cob:A:A-201] «Documentos SGC por atender» (Inicio «Documentos por atender»): la solicitud nueva a Mejora Continua («Atender solicitud de documento nuevo», enlace ?abrir=<id>, grupo → /documentos/bandeja); a quien la pidió no", solDoc.status === 201 && es(sgcMC, { label: "Documentos SGC por atender", href: "/documentos/bandeja", evHref: `/documentos/solicitudes?abrir=${SD}` }) && sgcMC.ev.titulo === `Atender solicitud de documento nuevo: Formato de avisos ${S5}` && !sgcLA.ev && corto("documentos_sgc") === "Documentos por atender", `${detalle(solDoc)} ${res(sgcMC)} | LA ${!!sgcLA.ev}`);
  const rechazaDoc = await api("POST", `/sgc/solicitudes/${SD}/rechazar`, { motivo: "Ya existe un formato equivalente" }, tMC);
  const resLA = await aviso(tLA, "documentos_solicitudes", (n) => n.clave === `sgc_solicitud_resuelta:${SD}:rechazada`);
  const resMC = await aviso(tMC, "documentos_solicitudes", deClave(`sgc_solicitud_resuelta:${SD}:`));
  check("[cob:A:A-202] «Tus solicitudes de documentos» (Inicio «Tus solicitudes»): a quien la pidió, al resolverse («Solicitud rechazada» con el comentario, enlace ?abrir=<id>); a quien la resolvió no", rechazaDoc.status === 200 && es(resLA, { label: "Tus solicitudes de documentos", href: "/documentos/solicitudes", evHref: `/documentos/solicitudes?abrir=${SD}` }) && resLA.ev.titulo === `Solicitud rechazada: Formato de avisos ${S5}` && resLA.ev.detalle === "Ya existe un formato equivalente" && !resMC.ev && corto("documentos_solicitudes") === "Tus solicitudes", `${detalle(rechazaDoc)} ${res(resLA)} | MC ${!!resMC.ev}`);

  // Calidad: incidencia, NC con acciones, verificación, retención, suspensión y responsable sin cuenta vigente.
  const inc = await api("POST", "/calidad/incidencias", { tipo: "falla_equipo", fecha_hora_ocurrencia: new Date().toISOString(), descripcion: `La centrífuga se detuvo en la prueba de avisos ${s5}`, impacto_resultados: "desconocido" }, tLA);
  const INC = inc.data?.id;
  // La campana trae las 15 incidencias abiertas más antiguas (ORDER BY id LIMIT 15) sin las que reportó la persona:
  // con muchas abiertas una nueva no aparece, así que se compara cada lista con la consulta, que excluye las propias.
  // Que alguna de esas 15 sea de un evaluador depende de lo que dejaron otras suites: se informa en el detalle, no se exige.
  const abiertasSin = (yo) => filas("SELECT id FROM incidencias WHERE estado IN ('reportada', 'en_evaluacion') AND COALESCE(reportada_por, 0) <> ? ORDER BY id LIMIT 15", yo).map((f) => `incidencia_evaluar:${f.id}`).join();
  const deLaCampana = async (token) => (await campana(token)).filter((n) => n.grupo === "calidad_incidencias").map((n) => n.clave).sort((a, b) => Number(a.split(":")[1]) - Number(b.split(":")[1])).join();
  const evaluadores = [["K1", tK1, K1.id], ["RG", tRG, RG.id], ["ana", t.ana, id.ana], ["patricia", t.patricia, id.patricia], ["ricardo", t.ricardo, id.ricardo]];
  const comparadas = [];
  let exclusion = false;
  for (const [quien, token, yo] of evaluadores) {
    const esperado = abiertasSin(yo);
    const real = await deLaCampana(token);
    const todas = filas("SELECT id, reportada_por FROM incidencias WHERE estado IN ('reportada', 'en_evaluacion') ORDER BY id LIMIT 15");
    if (todas.some((f) => Number(f.reportada_por) === Number(yo))) exclusion = true;
    comparadas.push([quien, esperado === real, esperado.split(",").length]);
  }
  const incK1 = await aviso(tK1, "calidad_incidencias", () => true);
  const incLA = await aviso(tLA, "calidad_incidencias", () => true);
  const propiaLA = abiertasSin(0).includes(`incidencia_evaluar:${INC}`);
  const enK1 = !!(await campana(tK1)).find((n) => n.clave === `incidencia_evaluar:${INC}`);
  check("[cob:A:A-203] «Incidencias por evaluar» (Inicio «Por evaluar»): a calidad:R las abiertas con enlace a cada incidencia, sin las que reportó la persona (regla 7, comprobada con quien tiene una entre las más antiguas); a quien no tiene calidad:R (quien la reportó) nada", inc.status === 201 && !!incK1.g && incK1.g.label === "Incidencias por evaluar" && incK1.g.href === "/calidad/incidencias?estado_inc=reportada,en_evaluacion" && incK1.ev?.href === `/calidad/incidencias/${incK1.ev?.clave.split(":")[1]}` && incK1.ev.titulo.startsWith("Incidencia por evaluar: INC ") && comparadas.every(([, ok]) => ok) && enK1 === propiaLA && !incLA.ev && !incLA.g && corto("calidad_incidencias") === "Por evaluar", `${detalle(inc)} ${res(incK1)} | ${comparadas.map((c) => c.join(":")).join(" ")} exclusión=${exclusion} nueva en K1=${enK1}/${propiaLA} | LA ${res(incLA)}`);
  const cierraInc = await api("POST", `/calidad/incidencias/${INC}/evaluar`, { decision: "cerrar_sin_nc", justificacion: "Sin impacto en los ensayos de la prueba" }, tMC);

  const N1 = (await api("POST", "/calidad/nc", { origen: "otro", descripcion: `NC de la prueba de avisos ${s5}`, responsable_id: K1.id }, tMC)).data?.id;
  await api("PUT", `/calidad/nc/${N1}`, { afecta_resultados_emitidos: "no", trabajo_detenido: "no", notificar_cliente: "no", metodo_causa: "otro", causa_raiz: "Causa documentada en la prueba de avisos", requiere_accion_correctiva: "si" }, tK1);
  await api("POST", `/calidad/nc/${N1}/avanzar`, { a: "en_analisis" }, tK1);
  const AC = (await api("POST", `/calidad/nc/${N1}/acciones`, { descripcion: "Acción de la prueba de avisos", responsable_id: RG.id, fecha_compromiso: enDias(5) }, tK1)).data?.id;
  await api("POST", `/calidad/nc/${N1}/avanzar`, { a: "acciones_en_curso" }, tK1);
  const acRG = await aviso(tRG, "calidad_acciones", deClave(`accion:${AC}:`));
  const acK1 = await aviso(tK1, "calidad_acciones", deClave(`accion:${AC}:`));
  check("[cob:A:A-204] «Mis acciones correctivas» (Inicio «Tus acciones»): a la persona responsable («Acción próxima» si vence en ≤ 7 días), enlace a la NC; a otra persona no", !!AC && es(acRG, { label: "Mis acciones correctivas", href: "/calidad/incidencias?mias=responsable", evHref: `/calidad/nc/${N1}` }) && acRG.ev.titulo.startsWith("Acción próxima: NC ") && acRG.ev.clave === `accion:${AC}:proxima` && !acK1.ev && corto("calidad_acciones") === "Tus acciones", `${AC} ${res(acRG)} | K1 ${!!acK1.ev}`);
  await api("POST", `/calidad/acciones/${AC}/implementar`, { descripcion_implementacion: "Implementada en la prueba de avisos" }, tRG);
  const enVer = await api("POST", `/calidad/nc/${N1}/avanzar`, { a: "en_verificacion" }, tK1);
  const veK1 = await aviso(tK1, "calidad_verificaciones", deClave(`verificacion:${N1}:`));
  const veRG = await aviso(tRG, "calidad_verificaciones", deClave(`verificacion:${N1}:`));
  check("[cob:A:A-205] «Verificaciones de eficacia pendientes» (Inicio «Verificar eficacia»): la NC en verificación a calidad:R, enlace a la NC; no a quien fue responsable de una acción (regla 8)", enVer.status === 200 && es(veK1, { label: "Verificaciones de eficacia pendientes", href: "/calidad/incidencias?etapa_nc=en_verificacion", evHref: `/calidad/nc/${N1}`, tone: "warning" }) && veK1.ev.titulo.startsWith("Verificar eficacia: NC ") && !veRG.ev && corto("calidad_verificaciones") === "Verificar eficacia", `${detalle(enVer)} ${res(veK1)} | RG ${!!veRG.ev}`);

  const ret = await api("POST", `/calidad/nc/${N1}/retenciones`, { informe_id: INF, motivo: "Resultados en duda en la prueba de avisos" }, tMC);
  const RET = fila("SELECT id FROM retenciones_informe WHERE nc_id = ? AND liberada_en IS NULL", N1)?.id;
  const reRG = await aviso(tRG, "calidad_retenidos", (n) => n.clave === `informe_retenido:${RET}`);
  const reLA = await aviso(tLA, "calidad_retenidos", (n) => n.clave === `informe_retenido:${RET}`);
  check("[cob:A:A-206] «Informes retenidos por NC» (tono danger; Inicio «Informes retenidos»): a informes:A o calidad:A (con calidad:V total, enlace a la NC); a quien no no", ret.status === 201 && !!RET && es(reRG, { label: "Informes retenidos por NC", href: "/calidad/incidencias?situacion=retenido", evHref: `/calidad/nc/${N1}`, tone: "danger" }) && reRG.ev.titulo.startsWith("Informe retenido: IR ") && !reLA.ev && corto("calidad_retenidos") === "Informes retenidos", `${detalle(ret)} ${res(reRG)} | LA ${!!reLA.ev}`);
  const sus = await api("POST", `/calidad/nc/${N1}/suspensiones`, { tipo: "equipo", clave: String(EQ), motivo: "Equipo detenido en la prueba de avisos" }, tRG);
  const SUS = fila("SELECT id FROM suspensiones WHERE nc_id = ? AND reanudada_en IS NULL", N1)?.id;
  const suLA = await aviso(tLA, "calidad_suspensiones", (n) => n.clave === `suspension:${SUS}`);
  const suAP = await aviso(tAP, "calidad_suspensiones", (n) => n.clave === `suspension:${SUS}`);
  check("[cob:A:A-207] «Métodos y equipos suspendidos» (tono danger; Inicio «Suspendidos»): a quien captura ensayos (sin calidad:V total el enlace va a /inventario/equipos); a quien ni captura ni administra calidad no", sus.status === 201 && !!SUS && es(suLA, { label: "Métodos y equipos suspendidos", href: "/calidad/incidencias?situacion=suspension", titulo: `Equipo ${nombreEq} suspendido: ${nombreEq}`, evHref: "/inventario/equipos", tone: "danger" }) && !suAP.ev && corto("calidad_suspensiones") === "Suspendidos", `${detalle(sus)} ${res(suLA)} | AP ${!!suAP.ev}`);

  const KR = await cuenta("Responsable Accion");
  const N2 = (await api("POST", "/calidad/nc", { origen: "otro", descripcion: `NC con responsable de baja ${s5}`, responsable_id: K1.id }, tMC)).data?.id;
  await api("PUT", `/calidad/nc/${N2}`, { afecta_resultados_emitidos: "no", trabajo_detenido: "no", notificar_cliente: "no", metodo_causa: "otro", causa_raiz: "Causa documentada en la prueba de avisos", requiere_accion_correctiva: "si" }, tK1);
  await api("POST", `/calidad/nc/${N2}/avanzar`, { a: "en_analisis" }, tK1);
  const AC2 = (await api("POST", `/calidad/nc/${N2}/acciones`, { descripcion: "Acción de quien se va", responsable_id: KR.id, fecha_compromiso: enDias(20) }, tK1)).data?.id;
  const bajaKR = await api("DELETE", `/admin/usuarios/${KR.id}`, { motivo: "Termina su contrato" }, t.jorge);
  const raMC = await aviso(tMC, "calidad_reasignar", (n) => n.clave === `reasignar_accion:${AC2}`);
  const raK1 = await aviso(tK1, "calidad_reasignar", (n) => n.clave === `reasignar_accion:${AC2}`);
  const raLA = await aviso(tLA, "calidad_reasignar", (n) => n.clave === `reasignar_accion:${AC2}`);
  check("[cob:A:A-208] «Acciones por reasignar» (Inicio «Por reasignar»): acción cuyo responsable ya no tiene cuenta vigente, a calidad:G y al responsable de la NC (enlace a la NC); a nadie más", !!AC2 && bajaKR.status === 200 && es(raMC, { label: "Acciones por reasignar", href: "/calidad/incidencias?tipos=nc", evHref: `/calidad/nc/${N2}`, tone: "warning" }) && raMC.ev.titulo.startsWith("Reasignar acción de NC ") && !!raK1.ev && !raLA.ev && corto("calidad_reasignar") === "Por reasignar", `${AC2} ${bajaKR.status} ${res(raMC)} | K1 ${!!raK1.ev} | LA ${!!raLA.ev}`);

  // Limpieza de lo que generó avisos a otras personas.
  const limpieza = [
    await api("POST", `/calidad/acciones/${AC2}/cancelar`, { motivo: "Fin de la prueba de avisos" }, tK1),
    await api("POST", `/calidad/suspensiones/${SUS}/reanudar`, { motivo: "Fin de la prueba de avisos" }, tMC),
    await api("POST", `/calidad/retenciones/${RET}/liberar`, { motivo: "Fin de la prueba de avisos" }, tMC),
    await api("POST", `/calidad/nc/${N1}/anular`, { motivo: "Fin de la prueba de avisos" }, tMC),
    await api("POST", `/calidad/nc/${N2}/anular`, { motivo: "Fin de la prueba de avisos" }, tMC),
    await api("POST", `/informes/${INF}/anular`, { motivo: "Fin de la prueba de avisos" }, t.patricia),
    await api("DELETE", `/inventory/reactivos/${RB}`, { motivo: "Fin de la prueba de avisos" }, t.qa),
    await api("DELETE", `/inventory/reactivos/${RSup}`, { motivo: "Fin de la prueba de avisos" }, t.qa),
    await api("DELETE", `/consumables/${CB}`, { motivo: "Fin de la prueba de avisos" }, t.qa),
    await api("DELETE", `/inventory/equipos/${EQ}`, { motivo: "Fin de la prueba de avisos" }, t.qa),
    await api("DELETE", `/inventory/equipos/${EQc}`, { motivo: "Fin de la prueba de avisos" }, t.qa),
    cierraInc,
  ];
  check("(limpieza) avisos: acción cancelada, suspensión reanudada, retención liberada, NC e informe anulados, insumos y equipos de baja, incidencia cerrada", limpieza.every((r) => r.status < 300) && !fila("SELECT id FROM suspensiones WHERE id = ? AND reanudada_en IS NULL", SUS), limpieza.map(detalle).join(" | "));
}

/* ---------- Matriz de roles (5.1 y 5.2) ----------
 * Un check por rol y otro de acciones documentales, generados en el ciclo: [cob:A:rol-admin_tecnico]
 * [cob:A:rol-responsable_general] [cob:A:rol-coord_area_tecnica] [cob:A:rol-tecnico_analista]
 * [cob:A:doc-admin_tecnico] [cob:A:doc-responsable_general] [cob:A:doc-coord_area_tecnica] [cob:A:doc-tecnico_analista]
 * [cob:A:rol-mejora_continua] [cob:A:rol-coord_investigacion] [cob:A:rol-tecnico_auxiliar] [cob:A:rol-admin_auxiliar]
 * [cob:A:rol-auditor_interno] [cob:A:rol-estudiante] [cob:A:doc-mejora_continua] [cob:A:doc-coord_investigacion]
 * [cob:A:doc-tecnico_auxiliar] [cob:A:doc-admin_auxiliar] [cob:A:doc-auditor_interno] [cob:A:doc-estudiante]. */
{
  const firmaCatalogo = (permisos) =>
    Object.entries(permisos)
      .flatMap(([modulo, acciones]) => Object.entries(acciones).map(([accion, alcance]) => `${modulo}:${accion}:${alcance}`))
      .sort()
      .join("|");
  const K4 = await cuenta("Coordinador Matriz", { rolClave: "coord_area_tecnica" });
  const persona = { mejora_continua: t.ana, coord_investigacion: t.gabriela, tecnico_auxiliar: t.mariana, admin_auxiliar: t.carmen, auditor_interno: t.hector, estudiante: t.diego, admin_tecnico: tAP, responsable_general: tRG, coord_area_tecnica: await entrar(K4), tecnico_analista: tLA };
  const MODULOS_CLASICOS = ["usuarios", "muestras", "ensayos", "informes", "equipos", "inventario", "calidad", "respaldos", "compras"];
  // Sondas: [método, ruta, cuerpo, esperado] con esperado "ok" (no 403 ni 5xx), un estado exacto o una función.
  const SONDAS = {
    mejora_continua: [
      ["usuarios V (total)", "GET", "/admin/usuarios", null, (r) => r.status === 200 && r.data?.items?.length > 1],
      ["usuarios sin G", "POST", "/admin/roles", { nombre: "" }, 403],
      ["muestras V", "GET", "/samples/reception?search=", null, 200],
      ["muestras sin AN", "POST", "/samples/reception/999999/anular", { motivo: "Sonda de permisos" }, 403],
      ["calidad G (bitácora)", "GET", "/audit?limit=1", null, 200],
      ["respaldos V", "GET", "/respaldos", null, 200],
      ["inventario sin E", "PUT", "/inventory/reactivos/999999", { producto: "X" }, 403],
      ["documentos: crear ficha", "POST", "/sgc/documentos", {}, "ok"],
    ],
    coord_investigacion: [
      ["usuarios V", "GET", "/admin/usuarios", null, (r) => r.status === 200 && r.data?.items?.length > 1],
      ["usuarios sin G", "POST", "/admin/usuarios", {}, 403],
      ["equipos E", "PUT", "/inventory/equipos/999999", { nombre: "X" }, "ok"],
      ["equipos sin AN", "DELETE", "/inventory/equipos/999999", { motivo: "Sonda de permisos" }, 403],
      ["respaldos —", "GET", "/respaldos", null, 403],
      ["documentos sin crear ficha", "POST", "/sgc/documentos", {}, 403],
    ],
    tecnico_auxiliar: [
      ["usuarios V (propio)", "GET", "/admin/usuarios", null, (r) => r.status === 200 && r.data?.items?.length === 1 && r.data.items[0].email === EMAIL.mariana],
      ["usuarios propio: sin roles", "GET", "/admin/roles", null, 403],
      ["informes —", "GET", "/informes", null, 403],
      ["respaldos —", "GET", "/respaldos", null, 403],
      ["inventario sin alta de catálogo", "POST", "/inventory/reactivos", { producto: "X", unidad: "L" }, 403],
      ["muestras sin AN", "POST", "/samples/reception/999999/anular", { motivo: "Sonda de permisos" }, 403],
    ],
    admin_auxiliar: [
      ["usuarios V (limitado = solo la propia)", "GET", "/admin/usuarios", null, (r) => r.status === 200 && r.data?.items?.length === 1 && r.data.items[0].email === EMAIL.carmen],
      ["ensayos —", "GET", "/samples/analysis", null, 403],
      ["informes —", "GET", "/informes", null, 403],
      ["equipos solo mantenimiento", "POST", "/inventory/equipos", { nombre: "X", estado: "operativo" }, 403],
      ["respaldos —", "GET", "/respaldos", null, 403],
    ],
    auditor_interno: [
      ["informes V", "GET", "/informes", null, 200],
      ["ensayos V", "GET", "/samples/analysis", null, 200],
      ["respaldos V", "GET", "/respaldos", null, 200],
      ["usuarios V (roles)", "GET", "/admin/roles", null, 200],
      ["informes sin R", "POST", "/informes/999999/revisar", {}, 403],
      ["usuarios sin G", "POST", "/admin/usuarios", {}, 403],
      ["documentos sin crear ficha", "POST", "/sgc/documentos", {}, 403],
    ],
    admin_tecnico: [
      ["usuarios G", "GET", "/admin/roles", null, 200],
      ["muestras V (estado)", "GET", "/samples/reception?search=", null, 200],
      ["ensayos —", "GET", "/samples/analysis", null, 403],
      ["informes —", "GET", "/informes", null, 403],
      ["equipos V", "GET", "/inventory/equipos", null, 200],
      ["equipos sin E", "PUT", "/inventory/equipos/999999", { nombre: "X" }, 403],
      ["inventario —", "GET", "/inventory/reactivos", null, 403],
      ["calidad V (solo bitácora)", "GET", "/audit?limit=1", null, 200],
      ["calidad sin incidencias", "GET", "/calidad/incidencias", null, 403],
      ["respaldos V", "GET", "/respaldos", null, 200],
    ],
    responsable_general: [
      ["usuarios V (total)", "GET", "/admin/usuarios", null, (r) => r.status === 200 && r.data?.items?.length > 1],
      ["usuarios sin G", "POST", "/admin/roles", { nombre: "" }, 403],
      ["informes V", "GET", "/informes", null, 200],
      ["informes A", "POST", "/informes/999999/autorizar", {}, "ok"],
      ["calidad V", "GET", "/calidad/nc", null, 200],
      ["respaldos V", "GET", "/respaldos", null, 200],
      ["inventario sin E", "PUT", "/inventory/reactivos/999999", { producto: "X" }, 403],
      ["muestras AN", "POST", "/samples/reception/999999/anular", { motivo: "Sonda de permisos" }, "ok"],
    ],
    coord_area_tecnica: [
      ["usuarios V (total)", "GET", "/admin/usuarios", null, (r) => r.status === 200 && r.data?.items?.length > 1],
      ["usuarios sin G", "POST", "/admin/usuarios", {}, 403],
      ["informes V", "GET", "/informes", null, 200],
      ["inventario G", "PUT", "/inventory/reactivos/999999", { producto: "X" }, "ok"],
      ["equipos G", "PUT", "/inventory/equipos/999999", { nombre: "X" }, "ok"],
      ["respaldos —", "GET", "/respaldos", null, 403],
    ],
    tecnico_analista: [
      ["usuarios V (propio)", "GET", "/admin/usuarios", null, (r) => r.status === 200 && r.data?.items?.length === 1 && r.data.items[0].email === LA.email],
      ["usuarios propio: sin roles", "GET", "/admin/roles", null, 403],
      ["respaldos —", "GET", "/respaldos", null, 403],
      // Pasa el permiso ensayos:C; lo que lo detiene es la autorización FX-THF-AP de la actividad (vencida en esta prueba).
      ["ensayos C", "POST", "/samples/analysis", {}, (r) => r.status !== 403 || /FX-THF-AP/.test(r.data?.message)],
      ["muestras sin AN", "POST", "/samples/reception/999999/anular", { motivo: "Sonda de permisos" }, 403],
      ["inventario sin alta de catálogo", "POST", "/inventory/reactivos", { producto: "X", unidad: "L" }, 403],
    ],
    estudiante: [
      ["usuarios propio: sin roles", "GET", "/admin/roles", null, 403],
      ["informes —", "GET", "/informes", null, 403],
      ["respaldos —", "GET", "/respaldos", null, 403],
      ["muestras sin AN", "POST", "/samples/reception/999999/anular", { motivo: "Sonda de permisos" }, 403],
      ["equipos sin AN", "DELETE", "/inventory/equipos/999999", { motivo: "Sonda de permisos" }, 403],
    ],
  };
  roles = await listaRoles();
  for (const [clave, token] of Object.entries(persona)) {
    const cat = catalogoRoles.find((r) => r.clave === clave);
    const rid = rol(clave);
    const real = filas("SELECT modulo, accion, alcance FROM rol_acciones WHERE id_rol = ?", rid).map((f) => `${f.modulo}:${f.accion}:${f.alcance}`).sort().join("|");
    const esperado = firmaCatalogo(cat.permisos);
    const sistemico = Number(fila("SELECT es_sistemico FROM roles WHERE id = ?", rid)?.es_sistemico);
    const me = (await api("GET", "/auth/me", undefined, token)).data;
    const sesion = (me?.roles || []).find((r) => r.clave === clave)?.permisos || {};
    const modulosSesion = MODULOS_CLASICOS.filter((m) => Object.keys(sesion[m] || {}).length).sort().join(",");
    const modulosCatalogo = MODULOS_CLASICOS.filter((m) => cat.permisos[m] && Object.keys(cat.permisos[m]).length).sort().join(",");
    const errores = [];
    for (const [nombre, m, ruta, cuerpo, esp] of SONDAS[clave]) {
      const r = await api(m, ruta, cuerpo ?? undefined, token);
      const ok = typeof esp === "function" ? esp(r) : esp === "ok" ? r.status !== 403 && r.status < 500 : r.status === esp;
      if (!ok) errores.push(`${nombre}: ${m} ${ruta} → ${r.status} ${r.data?.message || ""}`);
    }
    check(`[cob:A:rol-${clave}] ${cat.nombre}: ${cat.es_sistemico ? "sistémico" : "no sistémico"}, permisos en la base iguales al catálogo, módulos de la sesión y sondas por módulo (${SONDAS[clave].length})`, sistemico === (cat.es_sistemico ? 1 : 0) && real === esperado && modulosSesion === modulosCatalogo && errores.length === 0, `sistémico=${sistemico} ${real === esperado ? "" : `base=${real} catálogo=${esperado}`} ${modulosSesion}/${modulosCatalogo} ${errores.join("; ")}`);
    const docEsperado = Object.keys(cat.permisos.documentos || {}).sort().join(",");
    const docSesion = Object.keys(sesion.documentos || {}).filter((a) => a !== "V").sort().join(",");
    // Sondas documentales: proponer (POST /sgc/solicitudes) y crear ficha (POST /sgc/documentos) según el catálogo.
    const docAcciones = cat.permisos.documentos || {};
    const proponer = await api("POST", "/sgc/solicitudes", {}, token);
    const ficha = await api("POST", "/sgc/documentos", {}, token);
    const docSondas = [["proponer", proponer, !!docAcciones.documento_proponer], ["crear ficha", ficha, !!docAcciones.documento_crear_ficha]].filter(([, r, puede]) => (puede ? r.status === 403 || r.status >= 500 : r.status !== 403)).map(([n, r, puede]) => `${n} (${puede ? "debe poder" : "no debe"}) → ${detalle(r)}`);
    check(`[cob:A:doc-${clave}] ${cat.nombre}: acciones documentales de la sesión iguales al catálogo (${docEsperado ? docEsperado.split(",").length : 0}) y proponer/crear ficha según el catálogo`, docSesion === docEsperado && docSondas.length === 0, `sesión=${docSesion} catálogo=${docEsperado} ${docSondas.join("; ")}`);
  }
}

/* ---------- Limpieza: cuentas propias de baja y roles propios inactivos ---------- */
{
  let fallas = 0;
  for (const idc of creadas) {
    if (Number(usuario(idc)?.activo) !== 1) continue;
    const r = await api("DELETE", `/admin/usuarios/${idc}`, { motivo: "Fin de la prueba de cobertura" }, t.jorge);
    if (r.status !== 200) fallas += 1;
  }
  for (const rid of rolesPropios) {
    const r = fila("SELECT nombre, descripcion, activo FROM roles WHERE id = ?", rid);
    if (!r || !Number(r.activo)) continue;
    const permisos = filas("SELECT modulo, accion, alcance FROM rol_acciones WHERE id_rol = ?", rid);
    const res = await api("PUT", `/admin/roles/${rid}`, { nombre: r.nombre, descripcion: r.descripcion, activo: false, permisos, motivo: "Fin de la prueba de cobertura" }, t.jorge);
    if (res.status !== 200) fallas += 1;
  }
  check("(limpieza) cuentas propias de baja y roles propios inactivos", fallas === 0, `fallas=${fallas}`);
}

terminar();
