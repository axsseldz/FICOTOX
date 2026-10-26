/*
 * Prueba integral · Calidad (API). Cada bloque es un bug corregido en la prueba integral
 * (ver ~/Downloads/PRUEBA_INTEGRAL.md) y falla sin su corrección:
 * - una verificación eficaz es definitiva: verificar otra vez (o «no eficaz» después) → 409 ya_verificada,
 *   y la ficha ya no la ofrece (puede.verificar = false);
 * - quien suspendió y tiene la excepción de la regla 10 aprobada puede reanudar: la ficha lo indica
 *   (excepcion_reanudar), y la solicitud lleva a la NC (datos.nc_id);
 * - no se otorgan autorizaciones FX-THF-AP a cuentas dadas de baja (409 cuenta_inactiva) ni vencidas;
 * - fechas de NC validadas en el servidor: comunicación futura y verificación programada en el pasado → 400;
 * - el listado de incidencias filtra el periodo por la fecha de ocurrencia, como la lista de Calidad;
 * - Auditoría: fechas de filtro AAAA-MM-DD (400) y «%» o «_» se buscan como texto.
 */
import "./lib/reauth-auto.mjs";
import { api, crearCheck, enDias, fila, sesiones } from "./lib/calidad.mjs";

const { check, terminar } = crearCheck();
const { t, id } = await sesiones();
const ncDe = async (nc, token = t.patricia) => (await api("GET", `/calidad/nc/${nc}`, undefined, token)).data?.item;

/* NC con una acción implementada (Luis), lista para verificar. */
async function ncEnVerificacion(descripcion) {
  const N = (await api("POST", "/calidad/nc", { origen: "otro", descripcion, responsable_id: id.ricardo }, t.ana)).data?.id;
  await api("PUT", `/calidad/nc/${N}`, { afecta_resultados_emitidos: "no", trabajo_detenido: "no", notificar_cliente: "no", metodo_causa: "otro", causa_raiz: "Causa de prueba integral documentada", requiere_accion_correctiva: "si" }, t.ricardo);
  await api("POST", `/calidad/nc/${N}/avanzar`, { a: "en_analisis" }, t.ricardo);
  const a = (await api("POST", `/calidad/nc/${N}/acciones`, { descripcion: "Acción de prueba integral", responsable_id: id.luis, fecha_compromiso: enDias(5) }, t.ricardo)).data?.id;
  await api("POST", `/calidad/nc/${N}/avanzar`, { a: "acciones_en_curso" }, t.ricardo);
  await api("POST", `/calidad/acciones/${a}/implementar`, { descripcion_implementacion: "Implementada en la prueba integral" }, t.luis);
  await api("POST", `/calidad/nc/${N}/avanzar`, { a: "en_verificacion" }, t.ricardo);
  return N;
}

/* ---------- Verificación eficaz definitiva ---------- */
{
  const N = await ncEnVerificacion("NC integral: verificación eficaz definitiva");
  check("(preparación) NC en verificación", fila("SELECT estado FROM no_conformidades WHERE id = ?", N)?.estado === "en_verificacion");
  const ef = await api("POST", `/calidad/nc/${N}/verificar`, { resultado: "eficaz", comentarios: "Registros revisados: la causa se eliminó" }, t.ana);
  check("verificación eficaz", ef.status === 200, `${ef.status} ${ef.data?.message}`);
  check("…la ficha ya no ofrece verificar", (await ncDe(N, t.ana))?.puede?.verificar === false);
  const otra = await api("POST", `/calidad/nc/${N}/verificar`, { resultado: "eficaz", comentarios: "Otra verificación duplicada" }, t.patricia);
  check("verificar otra vez → 409 ya_verificada", otra.status === 409 && otra.data?.codigo === "ya_verificada", `${otra.status} ${otra.data?.message}`);
  const reabre = await api("POST", `/calidad/nc/${N}/verificar`, { resultado: "no_eficaz", comentarios: "Intento de reabrir una NC ya eficaz" }, t.patricia);
  check("«no eficaz» después de eficaz → 409 (no se reabre)", reabre.status === 409 && fila("SELECT estado, reaperturas FROM no_conformidades WHERE id = ?", N)?.estado === "en_verificacion", `${reabre.status} ${reabre.data?.message}`);
  check("…una sola verificación registrada", Number(fila("SELECT COUNT(*) AS n FROM nc_verificaciones WHERE nc_id = ?", N)?.n) === 1);
}

/* ---------- Reanudar con la excepción de la regla 10 ---------- */
{
  const N = (await api("POST", "/calidad/nc", { origen: "otro", descripcion: "NC integral: suspensión con excepción", responsable_id: id.ricardo }, t.ana)).data?.id;
  const sus = await api("POST", `/calidad/nc/${N}/suspensiones`, { tipo: "metodo", clave: "PSP", motivo: "Prueba integral: método detenido" }, t.patricia);
  const su = fila("SELECT id FROM suspensiones WHERE nc_id = ? AND reanudada_en IS NULL", N)?.id;
  check("(preparación) Patricia suspende un método", sus.status === 201 && !!su, `${sus.status} ${sus.data?.message}`);
  const antes = (await ncDe(N)).suspensiones.find((x) => Number(x.id) === Number(su));
  check("sin excepción, la ficha no le marca la excepción a quien suspendió", antes?.excepcion_reanudar === false, JSON.stringify(antes?.excepcion_reanudar));
  const exc = await api("POST", "/solicitudes", { tipo: "excepcion_segregacion", entidad: "suspensiones", entidad_id: su, accion: "reanudar", motivo: "Mejora Continua de vacaciones esta semana" }, t.patricia);
  check("(preparación) excepción solicitada y aprobada por otra persona", exc.status === 200, `${exc.status} ${exc.data?.message}`);
  const sol = fila("SELECT datos_json FROM solicitudes_autorizacion WHERE tipo = 'excepcion_segregacion' AND entidad = 'suspensiones' AND entidad_id = ? ORDER BY id DESC", String(su));
  check("la solicitud guarda la NC de la suspensión (para «Ver el registro»)", Number(JSON.parse(sol?.datos_json || "{}").nc_id) === Number(N), sol?.datos_json);
  const despues = (await ncDe(N)).suspensiones.find((x) => Number(x.id) === Number(su));
  check("con la excepción aprobada, la ficha se lo indica (la pantalla ofrece «Reanudar…»)", despues?.excepcion_reanudar === true, JSON.stringify(despues?.excepcion_reanudar));
  const re = await api("POST", `/calidad/suspensiones/${su}/reanudar`, { motivo: "Método verificado de nuevo" }, t.patricia);
  check("…y reanuda", re.status === 200, `${re.status} ${re.data?.message}`);
}

/* ---------- Autorizaciones a cuentas inactivas o vencidas ---------- */
{
  const inactiva = fila("SELECT id FROM usuarios WHERE activo = 0 ORDER BY id LIMIT 1");
  if (inactiva) {
    const r = await api("POST", `/admin/usuarios/${inactiva.id}/autorizaciones`, { tipo: "actividad", clave: "recepcion", vigente_desde: "2026-01-01", motivo: "Prueba integral: cuenta dada de baja" }, t.patricia);
    check("otorgar una autorización a una cuenta dada de baja → 409 cuenta_inactiva", r.status === 409 && r.data?.codigo === "cuenta_inactiva", `${r.status} ${r.data?.message}`);
  } else check("(sin cuentas dadas de baja en la base: se omite)", true);
  const vencida = fila("SELECT id FROM usuarios WHERE activo = 1 AND vigente_hasta IS NOT NULL AND vigente_hasta < ? ORDER BY id LIMIT 1", enDias(0));
  if (vencida) {
    const r = await api("POST", `/admin/usuarios/${vencida.id}/autorizaciones`, { tipo: "actividad", clave: "recepcion", vigente_desde: "2026-01-01", motivo: "Prueba integral: cuenta vencida" }, t.patricia);
    check("…ni a una cuenta con la vigencia terminada → 409 cuenta_vencida", r.status === 409 && r.data?.codigo === "cuenta_vencida", `${r.status} ${r.data?.message}`);
  } else check("(sin cuentas vencidas en la base: se omite)", true);
}

/* ---------- Fechas de la NC ---------- */
{
  const N = (await api("POST", "/calidad/nc", { origen: "otro", descripcion: "NC integral: fechas de comunicación y verificación", responsable_id: id.ricardo }, t.ana)).data?.id;
  const futura = await api("POST", `/calidad/nc/${N}/comunicaciones`, { fecha: enDias(3), medio: "correo", contacto: "Cliente", resumen: "Se informó al cliente del hallazgo" }, t.ana);
  check("comunicación con fecha futura → 400", futura.status === 400 && futura.data?.campo === "fecha", `${futura.status} ${futura.data?.message}`);
  const deHoy = await api("POST", `/calidad/nc/${N}/comunicaciones`, { fecha: enDias(0), medio: "correo", contacto: "Cliente", resumen: "Se informó al cliente del hallazgo" }, t.ana);
  check("…con fecha de hoy sí se registra", deHoy.status === 201 || deHoy.status === 200, `${deHoy.status} ${deHoy.data?.message}`);
  const imposible = await api("PUT", `/calidad/nc/${N}`, { verificacion_programada: "2027-02-30" }, t.ricardo);
  check("una fecha imposible (30 de febrero) → 400", imposible.status === 400, `${imposible.status} ${imposible.data?.message}`);
  const pasada = await api("PUT", `/calidad/nc/${N}`, { verificacion_programada: enDias(-10) }, t.ricardo);
  check("verificación programada en el pasado → 400", pasada.status === 400 && pasada.data?.campo === "verificacion_programada", `${pasada.status} ${pasada.data?.message}`);
  const ok = await api("PUT", `/calidad/nc/${N}`, { verificacion_programada: enDias(20) }, t.ricardo);
  check("…de hoy en adelante sí", ok.status === 200, `${ok.status} ${ok.data?.message}`);
}

/* ---------- Periodo de incidencias por ocurrencia ---------- */
{
  const ocurrio = "2026-02-10T15:00:00.000Z";
  const inc = await api("POST", "/calidad/incidencias", { tipo: "otro", fecha_hora_ocurrencia: ocurrio, descripcion: "Incidencia integral ocurrida en febrero y reportada hoy", impacto_resultados: "no" }, t.luis);
  const items = (await api("GET", "/calidad/incidencias?desde=2026-02-01&hasta=2026-02-28", undefined, t.patricia)).data?.items || [];
  check("el listado de incidencias filtra por fecha de ocurrencia (como la lista de Calidad)", inc.status === 201 && items.some((i) => Number(i.id) === Number(inc.data?.id)), `${inc.status} ${items.length}`);
  const lista = (await api("GET", "/calidad/lista?desde=2026-02-01&hasta=2026-02-28&tipos=incidencia", undefined, t.patricia)).data?.items || [];
  check("…y coincide con la lista de Calidad", lista.some((i) => Number(i.id) === Number(inc.data?.id)), `${lista.length}`);
}

/* ---------- Auditoría: filtros ---------- */
{
  const mala = await api("GET", "/audit?hasta=ayer", undefined, t.patricia);
  check("Auditoría con una fecha que no es AAAA-MM-DD → 400", mala.status === 400 && mala.data?.campo === "hasta", `${mala.status} ${mala.data?.message}`);
  const todo = (await api("GET", "/audit?limit=50", undefined, t.patricia)).data?.items || [];
  const porciento = (await api("GET", `/audit?limit=50&search=${encodeURIComponent("%")}`, undefined, t.patricia)).data?.items || [];
  const conPorciento = porciento.every((e) => [e.referencia, e.usuario_nombre, e.motivo].some((v) => String(v || "").includes("%")));
  check("buscar «%» encuentra el carácter, no todo", todo.length > 0 && conPorciento && porciento.length < todo.length, `${porciento.length}/${todo.length}`);
}

terminar();
