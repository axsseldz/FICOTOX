/*
 * Cobertura · Administración, acceso/sesión y transversal (API). Cada check lleva la etiqueta
 * [cob:A:<id>] del renglón de la matriz que prueba (validaciones V-*, transiciones S-*,
 * endpoints E-* y la matriz de roles 5.1-5.3).
 * Solo usa cuentas propias (nombres únicos): las compartidas no cambian de contraseña, rol,
 * vigencia ni estado; los intentos fallidos van con IP propia (X-Forwarded-For) para no
 * bloquear la del servidor de pruebas. Al final las cuentas propias quedan de baja y los
 * roles propios inactivos.
 */
import "./lib/reauth-auto.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { api, credenciales, crearCheck, Database, EMAIL, enDias, fila, filas, hoy, sesiones } from "./lib/calidad.mjs";

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
  check("[cob:A:V-24] [cob:A:regla-1] ampliar un rol que provocaría la regla 1 → 409 con los afectados y el rol sin cambios", asig.status < 300 && amplia.status === 409 && amplia.data?.codigo === "COMBINACION_PROHIBIDA" && (amplia.data?.afectados || []).some((a) => a.email === K1.email) && Number(fila("SELECT COUNT(*) AS n FROM rol_acciones WHERE id_rol = ?", R3.id)?.n) === 0, `${asig.status} ${detalle(amplia)}`);
}

/* ---------- Roles: nombre, motivo, rol propio ---------- */
{
  const sinNombre = await api("POST", "/admin/roles", { nombre: " ", permisos: [] }, t.jorge);
  const dupCrear = await api("POST", "/admin/roles", { nombre: "técnico auxiliar", permisos: [] }, t.jorge);
  const dupEditar = await api("PUT", `/admin/roles/${R1.id}`, { nombre: R2.nombre.toUpperCase(), descripcion: "Rol de la prueba de cobertura", activo: true, permisos: [] }, t.jorge);
  const vacioEditar = await api("PUT", `/admin/roles/${R1.id}`, { nombre: "", activo: true, permisos: [] }, t.jorge);
  check("[cob:A:V-26] nombre de rol obligatorio (400) y único sin importar mayúsculas (409), al crear y al editar", sinNombre.status === 400 && dupCrear.status === 409 && dupEditar.status === 409 && vacioEditar.status === 400 && fila("SELECT nombre FROM roles WHERE id = ?", R1.id)?.nombre === R1.nombre, `${detalle(sinNombre)} | ${detalle(dupCrear)} | ${detalle(dupEditar)} | ${detalle(vacioEditar)}`);

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
  check("[cob:A:V-28] no se editan los permisos de un rol propio: al pedirlo → 409 rol_propio (sin cambios ni solicitud); al aprobarlo quien lo tiene → 409 rol_propio", propio.status === 409 && propio.data?.codigo === "rol_propio" && firmaAntes === firmaDespues && Number(fila("SELECT COUNT(*) AS n FROM solicitudes_autorizacion WHERE entidad = 'roles' AND entidad_id = ?", String(rol("admin_tecnico")))?.n) === solicitudesAntes && asig4.status < 300 && sol.status === 202 && aprueba.status === 409 && aprueba.data?.codigo === "rol_propio" && Number(fila("SELECT COUNT(*) AS n FROM rol_acciones WHERE id_rol = ?", R4.id)?.n) === 0, `${detalle(propio)} | ${asig4.status} ${detalle(sol)} | ${detalle(aprueba)}`);
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
  check("[cob:A:V-36] foto: texto o GIF (aunque se llame .png) → 400 formato_no_permitido y sin foto", texto.status === 400 && texto.data?.codigo === "formato_no_permitido" && gif.status === 400 && gif.data?.codigo === "formato_no_permitido" && !usuario(C.id).foto, `${detalle(texto)} | ${detalle(gif)}`);
  const grande = Buffer.alloc(6 * 1024 * 1024, 7);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(grande);
  const pesada = await subir(grande);
  check("[cob:A:V-37] foto de más de 5 MB → 413 archivo_grande", pesada.status === 413 && pesada.data?.codigo === "archivo_grande" && !usuario(C.id).foto, detalle(pesada));
  const chica = await subir(await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer());
  const sinMultipart = await api("POST", "/auth/me/foto", { archivo: "foto.png" }, tC);
  const jpeg = await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 200, g: 90, b: 40 } } }).jpeg().withMetadata({ exif: { IFD0: { Copyright: "Cobertura FICOTOX", Make: "Camara" } } }).toBuffer();
  const buena = await subir(jpeg, "foto.jpg", "image/jpeg");
  const f512 = await fetch(`${process.env.BASE}/cuentas/${C.id}/foto?tam=512`, { headers: { Authorization: `Bearer ${tC}` } });
  const f128 = await fetch(`${process.env.BASE}/cuentas/${C.id}/foto?tam=128`, { headers: { Authorization: `Bearer ${tC}` } });
  const m512 = f512.ok ? await sharp(Buffer.from(await f512.arrayBuffer())).metadata() : {};
  const m128 = f128.ok ? await sharp(Buffer.from(await f128.arrayBuffer())).metadata() : {};
  check("[cob:A:V-38] foto: menos de 64 px → 400; sin multipart → 400; una válida se guarda como WEBP de 512 y 128 px sin EXIF", chica.status === 400 && /entre 64 y 6000/.test(chica.data?.message) && sinMultipart.status === 400 && /como archivo/.test(sinMultipart.data?.message) && buena.status === 200 && f512.headers.get("content-type") === "image/webp" && m512.format === "webp" && m512.width === 512 && m512.height === 512 && m128.width === 128 && m128.height === 128 && !m512.exif, `${detalle(chica)} | ${detalle(sinMultipart)} | ${detalle(buena)} | ${f512.status} ${m512.format} ${m512.width}x${m512.height} exif=${!!m512.exif} ${m128.width}`);
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
  check("[cob:A:V-40] login con correo o contraseña vacíos → 400", sinCorreo.status === 400 && /correo es obligatorio/.test(sinCorreo.data?.message) && sinClave.status === 400 && /contraseña es obligatoria/.test(sinClave.data?.message), `${detalle(sinCorreo)} | ${detalle(sinClave)}`);

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
  check("[cob:A:V-42] reautenticar con una acción sin formato modulo:accion → 400", sinFormato.status === 400 && sinAccion.status === 400 && /acción que vas a confirmar/.test(sinFormato.data?.message), `${detalle(sinFormato)} | ${detalle(sinAccion)}`);

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

/* ---------- Matriz de roles (5.1 y 5.2) ---------- */
{
  const firmaCatalogo = (permisos) =>
    Object.entries(permisos)
      .flatMap(([modulo, acciones]) => Object.entries(acciones).map(([accion, alcance]) => `${modulo}:${accion}:${alcance}`))
      .sort()
      .join("|");
  const persona = { mejora_continua: "ana", coord_investigacion: "gabriela", tecnico_auxiliar: "mariana", admin_auxiliar: "carmen", auditor_interno: "hector", estudiante: "diego" };
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
    estudiante: [
      ["usuarios propio: sin roles", "GET", "/admin/roles", null, 403],
      ["informes —", "GET", "/informes", null, 403],
      ["respaldos —", "GET", "/respaldos", null, 403],
      ["muestras sin AN", "POST", "/samples/reception/999999/anular", { motivo: "Sonda de permisos" }, 403],
      ["equipos sin AN", "DELETE", "/inventory/equipos/999999", { motivo: "Sonda de permisos" }, 403],
    ],
  };
  roles = await listaRoles();
  for (const [clave, quien] of Object.entries(persona)) {
    const cat = catalogoRoles.find((r) => r.clave === clave);
    const rid = rol(clave);
    const real = filas("SELECT modulo, accion, alcance FROM rol_acciones WHERE id_rol = ?", rid).map((f) => `${f.modulo}:${f.accion}:${f.alcance}`).sort().join("|");
    const esperado = firmaCatalogo(cat.permisos);
    const sistemico = Number(fila("SELECT es_sistemico FROM roles WHERE id = ?", rid)?.es_sistemico);
    const me = (await api("GET", "/auth/me", undefined, t[quien])).data;
    const sesion = (me?.roles || []).find((r) => r.clave === clave)?.permisos || {};
    const modulosSesion = MODULOS_CLASICOS.filter((m) => Object.keys(sesion[m] || {}).length).sort().join(",");
    const modulosCatalogo = MODULOS_CLASICOS.filter((m) => cat.permisos[m] && Object.keys(cat.permisos[m]).length).sort().join(",");
    const errores = [];
    for (const [nombre, m, ruta, cuerpo, esp] of SONDAS[clave]) {
      const r = await api(m, ruta, cuerpo ?? undefined, t[quien]);
      const ok = typeof esp === "function" ? esp(r) : esp === "ok" ? r.status !== 403 && r.status < 500 : r.status === esp;
      if (!ok) errores.push(`${nombre}: ${m} ${ruta} → ${r.status} ${r.data?.message || ""}`);
    }
    check(`[cob:A:rol-${clave}] ${cat.nombre}: no sistémico, permisos en la base iguales al catálogo, módulos de la sesión y sondas por módulo (${SONDAS[clave].length})`, sistemico === 0 && real === esperado && modulosSesion === modulosCatalogo && errores.length === 0, `${real === esperado ? "" : `base=${real} catálogo=${esperado}`} ${modulosSesion}/${modulosCatalogo} ${errores.join("; ")}`);
    const docEsperado = Object.keys(cat.permisos.documentos || {}).sort().join(",");
    const docSesion = Object.keys(sesion.documentos || {}).filter((a) => a !== "V").sort().join(",");
    check(`[cob:A:doc-${clave}] ${cat.nombre}: acciones documentales de la sesión iguales al catálogo (${docEsperado.split(",").length})`, docSesion === docEsperado, `sesión=${docSesion} catálogo=${docEsperado}`);
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
