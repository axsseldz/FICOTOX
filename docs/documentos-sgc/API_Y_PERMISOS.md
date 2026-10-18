# Documentos SGC · API y permisos

Todos los endpoints viven en `/api/sgc/*` (`src/app/api/sgc/**/route.ts`; la lógica está en `src/lib/server/modules/sgc/`).

## Reglas comunes

- **Sesión obligatoria.** Va en el encabezado `Authorization: Bearer <token>` (se obtiene con `POST /api/auth/login`). Sin sesión: **401**.
- **El servidor decide.** La interfaz solo oculta o deshabilita con un motivo (banderas `puede: { ok, motivo }` en las respuestas). Ocultar un botón nunca sustituye la validación del servidor.
- **Acción documental.** Sin la acción que exige el endpoint: **403** `sin_permiso`. Sin ninguna acción documental (y sin `usuarios:G`): **403** al entrar al módulo.
- **Confidencialidad.** Un documento restringido o confidencial que la persona no puede ver responde **404** «Documento no encontrado», como si no existiera. Pasa en la ficha, la URL directa, los archivos, las listas, la búsqueda, los avisos, la bandeja, la Lista Maestra y su PDF.
- **Contraseña.** Las acciones críticas responden **401** `reauth_required` (con `accion`) hasta que se repite la petición con `X-Reauth: <token>`, obtenido en `POST /api/auth/reauth { accion, password }`. El token es de un solo uso y su vencimiento es corto.
- **Errores.** Todos son JSON `{ message, campo?, codigo?, regla? }`:
  - **400** dato inválido (`campo` dice cuál);
  - **403** sin permiso o papel no asignado (`regla: 11` cuando es por segregación);
  - **404** no existe o no es visible;
  - **409** estado que no lo permite, o conflicto de concurrencia;
  - **413** archivo demasiado grande.
- **Formato.** Las fechas van en `AAAA-MM-DD`. Los endpoints que reciben archivos usan `multipart/form-data`; los demás, JSON.

## Endpoints

### Catálogos, inicio y búsqueda

| Método y ruta | Acción documental | Parámetros | Respuesta |
| --- | --- | --- | --- |
| `GET /api/sgc/catalogos` | cualquiera del módulo | — | `areas`, `tipos`, `confidencialidades`, `max_mb` y `yo` (acciones). Además, `personas` si crea fichas, gestiona externos o administra lecturas, y `roles` si administra lecturas. |
| `GET /api/sgc/resumen` | cualquiera | — | Vista general: `areas` con conteos, `totales` e `indicadores` (vigentes, en revisión y autorización, por publicar, pendientes internos y externos, lecturas mías y globales), `actividad` reciente y `puede`. Todo sobre lo visible. |
| `GET /api/sgc/documentos` | cualquiera (lo visible) | `search`, `area`, `tipo`, `estado` (`vigente`, `en_revision`, `borrador`, `en_elaboracion`, `pendiente_revision`, `obsoleto`), `origen`, `propietario`, `desde`, `hasta`, `orden`, `obsoletos=1` (con histórico) | `items` (clave, título, área, tipo, origen, estado, vigente, trabajo, pendiente_revision…), `propietarios`, `puede`. |
| `GET /api/sgc/documentos/:id` | lo visible | — | Ficha: `item`; `revisiones` (con archivos, línea de tiempo, `abrir` y `puede`); `eventos` (bitácora, solo con histórico); `renovaciones`; `externo`; `distribucion` (destinatarios, avance, `mi_lectura` y `puede`); `puede`. 404 si no es visible. |
| `GET /api/sgc/archivos/:aid` | ver esa revisión | `modo=descargar` (opcional) | El archivo, en línea o descargado (`Range` admitido). Verifica el SHA-256. Registra la descarga, y también la apertura de un restringido o confidencial. La primera apertura del PDF vigente por un destinatario queda en `sgc_lecturas.abierto_en`. Administración técnica: **403** `solo_metadatos`. |
| `GET /api/sgc/bandeja` | cualquiera | — | `items` (tareas por papel, cada una con `tipo`, `accion`, `papel`, `fecha_limite`, `vencida` y `href`), `lecturas_pendientes` y `total`. |

### Ficha y revisiones

| Método y ruta | Acción documental | Parámetros | Notas y errores |
| --- | --- | --- | --- |
| `POST /api/sgc/documentos` | `documento_crear_ficha` | multipart: `clave`, `titulo`, `area_codigo`, `tipo_codigo`, `proceso`, `confidencialidad`, `palabras_clave`, `propietario_id`, `elaborador_id`, `revisor_id`, `autorizador_id`, `numero` (revisión inicial), `archivo_pdf` y `archivo_fuente` opcionales | 201 `{ id, revision_id }`. **409** `clave_repetida`. **400** clave con formato o área/tipo que no coinciden, responsables repetidos (regla 11), `origen=externo` (los externos van por `/externos`). |
| `PUT /api/sgc/documentos/:id` | `documento_crear_ficha` | metadatos y `motivo` obligatorio | En la bitácora, con antes y después. **409** si está obsoleto. |
| `POST /api/sgc/documentos/:id/revisiones` | `documento_crear_ficha` | `motivo_cambio` y los tres responsables | Abre una revisión de trabajo **sin tocar la vigente** (CA-04). **409** si ya hay una en curso, una renovación u obsolescencia pendiente, o si es externo. |
| `PUT /api/sgc/revisiones/:rid` | crear ficha, o el elaborador asignado | `motivo_cambio`, `apartados_afectados`, `descripcion_cambio`, responsables | Solo en borrador (**409** si no lo está). |
| `POST /api/sgc/revisiones/:rid/archivos` | `documento_elaborar` y ser el elaborador asignado | multipart: `tipo` (`pdf` o `fuente`), `archivo` | Sustituir conserva el anterior. **409** fuera de borrador (CA-06). **400** extensión, firma de bytes o contenido activo. **413** tamaño. |
| `POST /api/sgc/revisiones/:rid/enviar-revision` | `documento_enviar_revision`, elaborador asignado | — | Exige PDF, motivo, apartados, descripción y responsables. Bloquea los archivos. |
| `POST /api/sgc/revisiones/:rid/registrar-vigente` | `documento_publicar` · **contraseña** | `fecha_emision`, `fecha_vigencia`, `fecha_proxima_revision`, `comentario` | Carga inicial: solo la primera revisión de un documento que nunca tuvo vigente. |

### Flujo de aprobación

| Método y ruta | Acción documental | Parámetros | Notas y errores |
| --- | --- | --- | --- |
| `GET /api/sgc/solicitudes` | proponer o crear ficha | — | Las propias, o todas para Mejora Continua. Las de documentos no visibles se ocultan. |
| `POST /api/sgc/solicitudes` | `documento_proponer` | `tipo` (`nuevo` o `cambio`), `documento_id` o `area_codigo`, `tipo_codigo` y `titulo_propuesto`; `necesidad`; `justificacion` (obligatoria); `archivo` de apoyo opcional | 201 `{ id }`. |
| `GET /api/sgc/solicitudes/:sid/apoyo` | solicitante o Mejora Continua | — | Archivo de apoyo (404 si el documento no es visible). |
| `POST /api/sgc/solicitudes/:sid/aceptar` | `documento_crear_ficha` | `elaborador_id`, `revisor_id`, `autorizador_id` (tres distintos), `fecha_limite`, `comentario`; `clave` si es nuevo | Crea la ficha y la revisión en borrador, o abre la revisión de trabajo. |
| `POST /api/sgc/solicitudes/:sid/rechazar` | `documento_crear_ficha` | `motivo` | **409** si ya está resuelta. |
| `POST /api/sgc/revisiones/:rid/revisar` | `documento_revisar` y ser el revisor asignado | `decision` (`aceptar`, `devolver` o `rechazar`), `comentario` (obligatorio al devolver o rechazar) | Devolver regresa a borrador y desbloquea los archivos. Rechazar cancela la revisión. **403** `regla: 11` si ya actuó en otro papel. |
| `POST /api/sgc/revisiones/:rid/autorizar` | `documento_autorizar`, autorizador asignado · **contraseña** al autorizar | `decision` (`autorizar`, `devolver` o `rechazar`), `comentario` | |
| `POST /api/sgc/revisiones/:rid/publicar` | `documento_publicar` · **contraseña** | `fecha_emision`, `fecha_vigencia`, `fecha_proxima_revision` (por omisión, +3 años), `comentario`, `distribucion` opcional (`{ roles, usuarios, punto_uso, requiere_lectura }`, exige `documento_administrar_lecturas`) | La nueva queda vigente y la anterior obsoleta en una transacción (CA-05). Dos publicaciones simultáneas: una **200** y la otra **409** `conflicto_publicacion`. |
| `POST /api/sgc/revisiones/:rid/reasignar` | `documento_crear_ficha` | responsables, `fecha_limite`, `motivo` | **400** `regla: 11` si alguien quedaría en dos papeles o en uno distinto del que ya ejerció. |
| `POST /api/sgc/documentos/:id/renovar` | `documento_crear_ficha` | `revisor_id`, `autorizador_id`, `fecha_proxima_revision`, `comentario` | Solo si está pendiente de revisión, sin revisión ni renovación en curso. |
| `POST /api/sgc/renovaciones/:nid/revisar` | `documento_revisar`, revisor asignado | `decision` (`confirmar` o `rechazar`), `comentario` | |
| `POST /api/sgc/renovaciones/:nid/autorizar` | `documento_autorizar`, autorizador asignado · **contraseña** | `decision`, `comentario` | La misma revisión sigue vigente con la nueva fecha. |
| `POST /api/sgc/documentos/:id/obsoletar` | `documento_obsoletar` · **contraseña** | `motivo` | **202** con una solicitud `obsoletar_documento_sgc`. La aprueba **otra persona** con `documento_autorizar` en `POST /api/solicitudes/:id/aprobar`. |

### Externos, distribución y lecturas (Fase 3)

| Método y ruta | Acción documental | Parámetros | Notas y errores |
| --- | --- | --- | --- |
| `GET /api/sgc/externos` | lo visible | `area`, `estado` (`vigente`, `pendiente_revision`, `obsoleto`), `responsable`, `search`, `obsoletos=1` | `items` con fuente, versión, responsable, última y próxima revisión, `pendiente_revision` y `puede`. |
| `POST /api/sgc/externos` | `documento_externo_gestionar` · **contraseña** | multipart: `identificador`, `titulo`, `area_codigo`, `tipo_codigo`, `confidencialidad`, `fuente`, `version_fecha`, `enlace` (http/https), `responsable_id`, `ultima_verificacion`, `proxima_revision`, `palabras_clave`, `comentario`, `archivo_pdf` opcional | Queda vigente. **409** `clave_repetida`. **400** prefijo FX- o enlace inválido. |
| `PUT /api/sgc/externos/:id` | `documento_externo_gestionar` | `fuente`, `enlace`, `responsable_id`, `motivo` | |
| `POST /api/sgc/externos/:id/verificar` | gestiona externos, o el responsable de seguimiento | `comentario`, `proxima_revision` | Confirma que sigue vigente. |
| `POST /api/sgc/externos/:id/version` | `documento_externo_gestionar` · **contraseña** | multipart: `version_fecha`, `enlace`, `proxima_revision`, `comentario`, `archivo_pdf` | La nueva versión queda vigente y la anterior obsoleta. |
| `POST /api/sgc/revisiones/:rid/distribucion` | `documento_administrar_lecturas` · **contraseña** | `roles`, `usuarios`, `punto_uso`, `requiere_lectura`, `motivo` | **400** si el destinatario no puede consultar vigentes, o si no puede confirmar lecturas y se le pide lectura. |
| `POST /api/sgc/distribucion/:did/retirar` | `documento_administrar_lecturas` · **contraseña** | `motivo` | Los acuses ya registrados se conservan. |
| `POST /api/sgc/revisiones/:rid/recordatorio` | `documento_administrar_lecturas` | — | Aviso nuevo en la campana a quien no ha leído. **409** si no hay pendientes. |
| `POST /api/sgc/revisiones/:rid/acusar` | `documento_acusar_lectura` y ser destinatario | `comentario` opcional | Acuse ligado a usuario y revisión. **409** `sin_abrir` si no abrió el PDF vigente, `ya_leido` o `no_destinatario`. |

### Lista Maestra (Fase 3)

| Método y ruta | Acción documental | Parámetros | Respuesta |
| --- | --- | --- | --- |
| `GET /api/sgc/lista-maestra` | `documento_consultar_vigente` | `area`, `tipo`, `estado` (`vigente`, `en_curso`, `en_elaboracion`, `pendiente_revision`, `obsoleto`), `origen`, `search`, `obsoletos=1` (solo con `documento_consultar_historico`) | `items` con área y color, clave, título, tipo, origen, revisión, estado, `en_curso`, propietario, elaborador, revisor, autorizador y fechas. También `filtros` y `puede`. |
| `GET /api/sgc/lista-maestra/pdf` | `documento_consultar_vigente` y `lista_maestra_exportar` | los mismos | PDF horizontal, en línea (`Content-Disposition: inline`). Cada generación queda en la bitácora con sus filtros. |

## Las 14 acciones documentales

Se guardan en `rol_acciones` con el módulo `documentos` y se configuran en Administración › Roles.

| Acción | Permite |
| --- | --- |
| `documento_consultar_vigente` | Ver la revisión vigente, la Lista Maestra y ser destinatario. |
| `documento_proponer` | Solicitar un documento nuevo o un cambio. |
| `documento_crear_ficha` | Crear y editar fichas, aceptar o rechazar solicitudes, abrir revisiones, reasignar y renovar. |
| `documento_elaborar` | Cargar los archivos de la revisión asignada. |
| `documento_enviar_revision` | Enviar a revisión la revisión asignada. |
| `documento_revisar` | Decidir como revisor asignado. |
| `documento_autorizar` | Decidir como autorizador asignado y aprobar obsolescencias (segundo usuario). |
| `documento_publicar` | Publicar y hacer la carga inicial. |
| `documento_obsoletar` | Solicitar la obsolescencia. |
| `documento_consultar_historico` | Ver borradores, obsoletas, historial y bitácora, y los obsoletos en la Lista Maestra. |
| `documento_acusar_lectura` | Confirmar la lectura. |
| `documento_administrar_lecturas` | Definir la distribución y enviar recordatorios. |
| `documento_externo_gestionar` | Registrar externos y sus nuevas versiones. |
| `lista_maestra_exportar` | Generar el PDF de la Lista Maestra. |

## Matriz rol × acción documental (asignación inicial)

✔ = asignada. Se puede cambiar en Administración › Roles; las combinaciones prohibidas (regla 1: `usuarios:G` con revisar, autorizar, publicar u obsoletar) se rechazan.

| Acción | MC | RG | Coord. Técnica | Coord. I+D | Analista / Auxiliar / Adm. Auxiliar | Auditor | Estudiante | Adm. técnico |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| consultar_vigente | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | |
| proponer | ✔ | ✔ | ✔ | ✔ | ✔ | | | |
| crear_ficha | ✔ | | | | | | | |
| elaborar | ✔ | | ✔ | ✔ | ✔ | | | |
| enviar_revision | ✔ | | ✔ | ✔ | ✔ | | | |
| revisar | ✔ | | ✔ | ✔ | | | | |
| autorizar | ✔ | ✔ | ✔ | | | | | |
| publicar | ✔ | | | | | | | |
| obsoletar | ✔ | | | | | | | |
| consultar_historico | ✔ | ✔ | ✔ | ✔ | | ✔ | | |
| acusar_lectura | ✔ | ✔ | ✔ | ✔ | ✔ | | ✔ | |
| administrar_lecturas | ✔ | | | | | | | |
| externo_gestionar | ✔ | | | | | | | |
| lista_maestra_exportar | ✔ | ✔ | | | | ✔ | | |

MC = Coordinación de Mejora Continua; RG = Responsable General.

**Reglas que no dependen solo del rol:**

- Sobre una revisión actúa solo la persona **asignada** en ese papel.
- Elaborador, revisor y autorizador son tres personas distintas, y nadie cambia de papel dentro de una revisión (regla 11).
- Restringido o confidencial: lo ven Mejora Continua, Responsable General, el propietario, los asignados y los destinatarios.
- El **Administrador técnico** solo ve metadatos de los documentos de uso interno (diagnóstico). Nunca abre archivos ni actúa en el flujo, y una sesión suya no vale como firma documental.
