/*
 * Prueba integral · Administración y transversal (API). Cada bloque es un bug corregido en la prueba integral y falla sin su corrección:
 * - dar de baja por la edición (PUT activo=false) sigue las reglas de DELETE: no a uno mismo, con motivo y bitácora «baja»;
 * - ampliar la vigencia de una cuenta permanente con fecha de fin (incluso vencida) pide segundo usuario;
 * - la persona afectada no rechaza una solicitud sobre su propia cuenta (regla 6, como al aprobar);
 * - «Personas con este rol» no cuenta asignaciones que aún no empiezan;
 * - un rol nuevo nace sin permisos: los que se piden al crearlo van a ampliar_permisos_rol (segundo usuario);
 * - el correo de una cuenta nueva se valida (formato), no solo el dominio;
 * - la foto que la persona ocultó (usa la figura) solo la ve ella;
 * - el aviso de que vence tu propio acceso lleva a «Mis autorizaciones», no a Por supervisar.
 */
import "./lib/reauth-auto.mjs";
import { createRequire } from "node:module";
import { api, crearCheck, Database, enDias, fila, sesiones } from "./lib/calidad.mjs";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const s5 = Date.now().toString(36).slice(-5);
const SIN_APROBAR = { "X-Sin-Aprobar-Auto": "1" };
const ejecutar = (sql, ...p) => {
  const b = new Database(process.env.TEST_DB_PATH);
  b.prepare(sql).run(...p);
  b.close();
};
const rolAuxiliar = ((await api("GET", "/admin/roles", undefined, t.qa)).data?.items || []).find((r) => r.nombre === "Técnico Auxiliar")?.id;
async function cuenta(nombre) {
  const email = `${nombre.toLowerCase().replace(/\s+/g, ".")}.${s5}@ficotox.local`;
  const r = await api("POST", "/admin/usuarios", { nombre: `${nombre} ${s5}`, email, activo: true, rol_id: rolAuxiliar, departamento: "Laboratorio", password: `Temporal-${s5}-2026`, motivo: "Alta de la prueba integral" }, t.jorge);
  return { id: Number(r.data?.id), email, nombre: `${nombre} ${s5}`, status: r.status };
}
const datos = (c, extra) => ({ nombre: c.nombre, email: c.email, departamento: "Laboratorio", activo: true, tipo_cuenta: "permanente", vigente_desde: null, vigente_hasta: null, supervisor_id: null, ...extra });

/* ---------- Baja por la edición ---------- */
{
  const C = await cuenta("Baja Edicion");
  const sinMotivo = await api("PUT", `/admin/usuarios/${C.id}`, datos(C, { activo: false }), t.jorge);
  check("dar de baja por la edición sin motivo → 400 (como «Dar de baja…»)", C.status === 201 && sinMotivo.status === 400 && sinMotivo.data?.campo === "motivo_estado" && Number(fila("SELECT activo FROM usuarios WHERE id = ?", C.id)?.activo) === 1, `${C.status} ${sinMotivo.status} ${sinMotivo.data?.message}`);
  const conMotivo = await api("PUT", `/admin/usuarios/${C.id}`, datos(C, { activo: false, motivo_estado: "Terminó su estancia en el laboratorio" }), t.jorge);
  const bit = fila("SELECT motivo FROM auditoria WHERE accion = 'baja' AND entidad = 'usuarios' AND entidad_id = ? ORDER BY id DESC LIMIT 1", String(C.id));
  check("…con motivo se da de baja y la bitácora dice «baja» con el motivo", conMotivo.status === 200 && Number(fila("SELECT activo FROM usuarios WHERE id = ?", C.id)?.activo) === 0 && bit?.motivo === "Terminó su estancia en el laboratorio", `${conMotivo.status} ${conMotivo.data?.message} ${bit?.motivo}`);
  const yo = (await api("GET", `/admin/usuarios/${id.jorge}`, undefined, t.jorge)).data?.item;
  const propia = await api("PUT", `/admin/usuarios/${id.jorge}`, { ...datos({ nombre: yo?.nombre, email: yo?.email }, { activo: false, motivo_estado: "Me doy de baja yo mismo" }), departamento: yo?.departamento ?? null }, t.jorge);
  check("darse de baja a uno mismo por la edición → 403", propia.status === 403 && Number(fila("SELECT activo FROM usuarios WHERE id = ?", id.jorge)?.activo) === 1, `${propia.status} ${propia.data?.message}`);
  // Sin la corrección la cuenta quedaría de baja: se repone para que el resto de la prueba siga.
  if (Number(fila("SELECT activo FROM usuarios WHERE id = ?", id.jorge)?.activo) !== 1) {
    ejecutar("UPDATE usuarios SET activo = 1 WHERE id = ?", id.jorge);
    t.jorge = (await sesiones()).t.jorge;
  }
}

/* ---------- Vigencia de una cuenta permanente ---------- */
{
  const C = await cuenta("Permanente Vencida");
  const vencio = enDias(-2);
  ejecutar("UPDATE usuarios SET vigente_hasta = ? WHERE id = ?", vencio, C.id);
  const r = await api("PUT", `/admin/usuarios/${C.id}`, datos(C, { vigente_hasta: enDias(60), motivo_cuenta: "Se renueva su contrato" }), t.jorge, SIN_APROBAR);
  check("ampliar la vigencia de una permanente vencida → solicitud ampliar_vigencia (202) y la fecha no cambia aún", r.status === 202 && r.data?.solicitud?.tipo === "ampliar_vigencia" && fila("SELECT vigente_hasta AS h FROM usuarios WHERE id = ?", C.id)?.h === vencio, `${r.status} ${r.data?.message} ${fila("SELECT vigente_hasta AS h FROM usuarios WHERE id = ?", C.id)?.h}`);
  const D = await cuenta("Permanente Con Fin");
  ejecutar("UPDATE usuarios SET vigente_hasta = ? WHERE id = ?", enDias(10), D.id);
  const quitar = await api("PUT", `/admin/usuarios/${D.id}`, datos(D, { vigente_hasta: null, motivo_cuenta: "Pasa a planta sin fecha de fin" }), t.jorge, SIN_APROBAR);
  check("…y quitarle la fecha de fin a una permanente también", quitar.status === 202 && quitar.data?.solicitud?.tipo === "ampliar_vigencia" && fila("SELECT vigente_hasta AS h FROM usuarios WHERE id = ?", D.id)?.h === enDias(10), `${quitar.status} ${quitar.data?.message}`);
}

/* ---------- Rechazar una solicitud sobre la propia cuenta ---------- */
const rolVacio = await api("POST", "/admin/roles", { nombre: `Consulta integral ${s5}`, descripcion: "Rol sin permisos de la prueba integral", motivo: "Rol de la prueba integral", permisos: [] }, t.jorge);
{
  const sol = await api("POST", `/admin/usuarios/${id.patricia}/roles`, { rol_id: rolVacio.data?.id, motivo: "Rol adicional para Patricia" }, t.jorge, SIN_APROBAR);
  const sid = sol.data?.solicitud?.id;
  const propia = await api("POST", `/solicitudes/${sid}/rechazar`, { motivo: "No quiero ese rol adicional" }, t.patricia);
  check("la persona afectada no rechaza una solicitud sobre su propia cuenta → 409 regla 6", rolVacio.status === 201 && sol.status === 202 && propia.status === 409 && propia.data?.regla === 6, `${rolVacio.status} ${sol.status} ${propia.status} ${propia.data?.message}`);
  const otra = await api("POST", `/solicitudes/${sid}/rechazar`, { motivo: "No hace falta el rol adicional" }, t.ana);
  check("…otra persona con usuarios:A sí", otra.status === 200, `${otra.status} ${otra.data?.message}`);
}

/* ---------- Personas con el rol: solo vigentes ---------- */
{
  const a = await api("POST", `/admin/usuarios/${id.luis}/roles`, { rol_id: rolVacio.data?.id, motivo: "Empieza el próximo mes", vigente_desde: enDias(20) }, t.jorge);
  const detalle = (await api("GET", `/admin/roles/${rolVacio.data?.id}`, undefined, t.jorge)).data;
  const lista = (await api("GET", "/admin/roles", undefined, t.jorge)).data?.items?.find((r) => Number(r.id) === Number(rolVacio.data?.id));
  check("«Personas con este rol» no incluye una asignación que empieza después (cuadra con el conteo)", a.status < 300 && !(detalle?.usuarios || []).some((u) => Number(u.id) === Number(id.luis)) && Number(lista?.total_usuarios) === (detalle?.usuarios || []).length, `${a.status} ${a.data?.message} ${JSON.stringify((detalle?.usuarios || []).map((u) => u.id))} ${lista?.total_usuarios}`);
}

/* ---------- Rol nuevo con permisos ---------- */
{
  const r = await api("POST", "/admin/roles", { nombre: `Rol amplio ${s5}`, motivo: "Rol con permisos de la prueba integral", permisos: [{ modulo: "usuarios", accion: "G" }, { modulo: "calidad", accion: "A" }] }, t.jorge, SIN_APROBAR);
  const filas = () => Number(fila("SELECT COUNT(*) AS n FROM rol_acciones WHERE id_rol = ?", r.data?.id)?.n);
  check("crear un rol con permisos: nace sin ellos y quedan en solicitud ampliar_permisos_rol", r.status === 201 && r.data?.solicitud?.tipo === "ampliar_permisos_rol" && r.data?.solicitud?.estado === "pendiente" && filas() === 0, `${r.status} ${r.data?.message} ${filas()}`);
  const ok = await api("POST", `/solicitudes/${r.data?.solicitud?.id}/aprobar`, { motivo: "Permisos revisados por la dirección" }, t.patricia);
  check("…al aprobarla el rol los concede", ok.status === 200 && filas() >= 2, `${ok.status} ${ok.data?.message} ${filas()}`);
}

/* ---------- Correo con formato inválido ---------- */
{
  const r = await api("POST", "/admin/usuarios", { nombre: `Correo raro ${s5}`, email: `uno@dos@ficotox.local`, activo: true, rol_id: rolAuxiliar, password: `Temporal-${s5}-2026`, motivo: "Alta con correo inválido" }, t.jorge);
  check("un correo con dos @ no da de alta la cuenta → 400", r.status === 400 && !fila("SELECT id FROM usuarios WHERE email = 'uno@dos@ficotox.local'"), `${r.status} ${r.data?.message}`);
}

/* ---------- Foto oculta ---------- */
{
  const png = await sharp({ create: { width: 320, height: 320, channels: 3, background: { r: 30, g: 120, b: 160 } } }).png().toBuffer();
  const fd = new FormData();
  fd.append("archivo", new Blob([png], { type: "image/png" }), "foto.png");
  const sube = await api("POST", "/auth/me/foto", fd, t.luis);
  const oculta = await api("PUT", "/auth/me/foto", { usa_foto: false }, t.luis);
  const otra = await api("GET", `/cuentas/${id.luis}/foto?tam=128`, undefined, t.patricia);
  const propia = await api("GET", `/cuentas/${id.luis}/foto?tam=128`, undefined, t.luis);
  check("la foto que la persona ocultó no la ve nadie más (404); ella sí", sube.status === 200 && oculta.status === 200 && otra.status === 404 && propia.status === 200, `${sube.status} ${sube.data?.message} ${oculta.status} ${otra.status} ${propia.status}`);
  await api("DELETE", "/auth/me/foto", undefined, t.luis);
}

/* ---------- Aviso de acceso propio por vencer ---------- */
{
  const asig = fila("SELECT ur.id, ur.vigente_hasta FROM usuario_roles ur JOIN roles r ON r.id = ur.rol_id WHERE ur.usuario_id = ? AND ur.revocado_en IS NULL AND r.clave = 'tecnico_analista'", id.luis);
  ejecutar("UPDATE usuario_roles SET vigente_hasta = ? WHERE id = ?", enDias(3), asig.id);
  try {
    const avisos = (await api("GET", "/inicio/avisos", undefined, t.luis)).data;
    const grupo = (avisos?.items || avisos?.pendientes || []).find((g) => g.key === "accesos_vencen");
    check("el aviso de que vence tu propio rol lleva a «Mis autorizaciones» (no a Por supervisar)", grupo?.href === "/#mis-autorizaciones", JSON.stringify(grupo?.href ?? Object.keys(avisos || {})));
  } finally {
    ejecutar("UPDATE usuario_roles SET vigente_hasta = ? WHERE id = ?", asig.vigente_hasta ?? null, asig.id);
  }
}

terminar();
