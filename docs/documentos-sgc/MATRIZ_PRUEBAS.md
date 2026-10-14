# Documentos SGC · Matriz de pruebas

Criterios de aceptación de la sección 12 de la especificación, con las pruebas automáticas que los cubren y su resultado en la entrega (Fase 4). Las suites están en `tests/` y se corren con `npm test`.

## Criterios de aceptación

| CA | Criterio | Pruebas que lo cubren | Resultado |
| --- | --- | --- | --- |
| CA-01 | Las seis carpetas aparecen con sigla, nombre y color HEX definido. | `api-documentos-aceptacion` (las 6 áreas con el nombre y el HEX exactos de la especificación); `ui/documentos` (6 carpetas con el HEX en la banda, en claro, oscuro y tableta). | ✅ Cumple |
| CA-02 | Un usuario sin permiso no abre el documento por interfaz ni por URL directa. | `api-documentos` (restringido: 404 para 5 roles y 200 para 5; URL directa, archivo, explorador, buscador); `ui/documentos` («no encontrado» por URL); `api-documentos-fase3` (confidencial solo para destinatarios); `api-documentos-flujo` (cada paso con usuarios no asignados, 403/404). | ✅ Cumple |
| CA-03 | El sistema impide duplicar un código FX. | `api-documentos` (repetida en minúsculas y con espacios: 409; formato y área/tipo); `api-documentos-fase3` (identificador de externo único: 409); `ui/documentos` (validación en el formulario). | ✅ Cumple |
| CA-04 | Una nueva revisión conserva intacta la vigente durante la aprobación. | `api-documentos` (nueva revisión sin tocar la vigente; quien solo consulta no ve el borrador); `api-documentos-flujo` (vigente intacta al aceptar, rechazar y devolver); `ui/documentos`. | ✅ Cumple |
| CA-05 | Al publicar, solo la nueva queda vigente y la anterior obsoleta e histórica. | `api-documentos-flujo` (**publicación concurrente: una 200 y otra 409**; una sola vigente; anterior obsoleta con fecha y «sustituida por»; conserva su archivo); `api-documentos` (la base rechaza una segunda vigente); `ui/documentos-flujo`. | ✅ Cumple |
| CA-06 | No se modifica el archivo tras enviarlo a revisión; debe devolverse a borrador. | `api-documentos` (409 y disparadores que impiden agregar, cambiar o borrar); `api-documentos-flujo` (bloqueado en revisión y desbloqueado al devolver); `ui/documentos` (botón deshabilitado con motivo). | ✅ Cumple |
| CA-07 | Cada revisión conserva elaborador, revisor, autorizador, fechas, decisiones y comentarios. | `api-documentos-flujo` (línea de tiempo completa con quién, papel, cargo, fecha y comentario); `ui/documentos-flujo` (línea de tiempo visible). | ✅ Cumple |
| CA-08 | La vista general y la búsqueda muestran solo lo permitido para el rol. | `api-documentos` (explorador y buscador global sin confidenciales); `api-documentos-fase3` (indicadores por persona, actividad reciente, lecturas, Lista Maestra y su PDF sin confidenciales); `api-documentos-flujo` (bandeja, solicitudes, «Por autorizar» y campana sin documentos no visibles). | ✅ Cumple |
| CA-09 | La Lista Maestra se filtra y exporta sin perder código, revisión, estado, responsables ni fechas. | `api-documentos-fase3` (filtros, revisión en curso, obsoletos solo con histórico; PDF con encabezado, filtros, color de área, «Página X de Y», horizontal y bitácora); `api-documentos-aceptacion` (**el PDF conserva clave, revisión, estado, los 4 responsables y las 3 fechas**); `ui/documentos-fase3` (visor interno sin descarga automática). | ✅ Cumple |
| CA-10 | Los externos generan aviso según la próxima revisión. | `api-documentos-fase3` (aviso a 30 días: pantalla, bandeja del responsable y de Mejora Continua, campana; verificación y nueva versión); `ui/documentos-fase3`. | ✅ Cumple |
| CA-11 | La confirmación de lectura queda vinculada al usuario y a una revisión. | `api-documentos-fase3` (acuse con usuario, revisión, fecha y hora; exige abrir el PDF; no se repite ni se deshace; revisión nueva = pendiente nuevo; quien recibe el rol después también); `ui/documentos-fase3`. | ✅ Cumple |
| CA-12 | La bitácora muestra el historial completo y no ofrece edición ni borrado. | `api-documentos-aceptacion` (sin endpoints PUT, PATCH ni DELETE; **la base rechaza UPDATE y DELETE**; historial en la ficha); `api-documentos` (eventos con antes y después); `respaldos` (cadena de sellos íntegra). | ✅ Cumple |
| CA-13 | El respaldo incluye base y archivos, con evidencia de una restauración de prueba. | `respaldos` (incluye `sgc/`; la restauración la verifica; **un PDF de `sgc/` alterado se detecta**; el manifest cuenta todas las `sgc_*`); acta real del 14/10/2026 con 8 de 8 ✅ ([RESPALDO_RESTAURACION.md](RESPALDO_RESTAURACION.md)). | ✅ Cumple |
| CA-14 | Las pruebas críticas se ejecutan sin errores en el ambiente de entrega. | `npm test`, suite completa (ver el resumen abajo). | ✅ Cumple |
| CA-15 | Los manuales describen instalación, configuración, permisos, flujo y recuperación. | `api-documentos-aceptacion` (comprueba que existen y cubren cada papel y cada tema); [MANUAL_USUARIO.md](MANUAL_USUARIO.md) y [MANUAL_TECNICO.md](MANUAL_TECNICO.md). | ✅ Cumple |
| CA-16 | No hay acceso para clientes ni publicación externa de informes o documentos. | `api-documentos-aceptacion` (**recorre todas las rutas de la API sin sesión**: solo responden el inicio de sesión, su configuración y la salud, sin datos; ninguna ruta pública, de compartir ni de clientes; archivos y Lista Maestra sin sesión: 401). | ✅ Cumple |
| CA-17 | Mejora Continua valida por escrito la demostración antes de habilitar el módulo en producción. | Depende del laboratorio. | ⏳ **Pendiente: validación por escrito de Mejora Continua tras la demostración** (ver `GUIA_DEMO_DOCUMENTOS.md`). |

## Suites del módulo

| Suite | Pasos | Qué cubre |
| --- | --- | --- |
| `api-documentos` | 80 | Núcleo: permisos de 10 roles, clave FX, archivos y disparadores, carga inicial, confidencialidad, diagnóstico y bitácora. |
| `api-documentos-flujo` | 66 | Solicitudes, ciclo completo con devolución, concurrencia, rechazos, reasignación, renovación, obsolescencia, bandeja, avisos y segregación. |
| `api-documentos-fase3` | 73 | Externos, distribución, acuses, recordatorios, Lista Maestra y su PDF, indicadores y externos fuera del flujo interno. |
| `api-documentos-aceptacion` | 13 | CA-01, CA-09, CA-12, CA-15 y CA-16. |
| `ui/documentos` | 25 | Carpetas, explorador, ficha, carga inicial, confidencial y diagnóstico (claro, oscuro y tableta). |
| `ui/documentos-flujo` | 23 | Recorrido real del flujo con 5 usuarios y contraseñas. |
| `ui/documentos-fase3` | 26 | Externos, distribución, acuse, Lista Maestra en el visor y negativos por URL. |
| `respaldos` | 31 | Respaldo y restauración, incluidos los archivos y tablas del módulo. |

**Resultado de la entrega:** ver «Resultado final» al final de este documento.

## Incidencias encontradas y corregidas

| Fase | Incidencia | Corrección |
| --- | --- | --- |
| 1 | La tabla del explorador se recortaba en tableta. | Ajuste de columnas y desplazamiento. |
| 1 | «Consultó» se registraba dos veces al abrir un confidencial (peticiones por rangos del visor). | Las aperturas de la misma persona en 2 minutos cuentan como una. |
| 1 | Revisión de seguridad: los registros heredados quedaban visibles para cualquiera con una acción documental. | Regla restrictiva para los heredados. |
| 1 | Revisión de seguridad: la bitácora global y el aviso de «clave repetida» revelaban documentos confidenciales. | Filtro por visibilidad. |
| 1 | Expectativas viejas en `operacion`, `api-roles`, `api-segregacion` y `ui/roles`. | Pruebas actualizadas. |
| 2 | Cinco pruebas de inventario de `api-sgc` desactualizadas (ajenas al módulo). | Actualizadas al comportamiento de las migraciones 19 y 20. |
| 2 | El encabezado de la ficha comprimía el título. | Acciones en su propia fila. |
| 2 | Revisión de seguridad: la bandeja mostraba solicitudes de documentos no visibles. | Filtro por visibilidad. |
| 2 | Revisión de seguridad: con una reasignación, el revisor podía pasar a autorizar. | Segregación por papel ya ejercido. |
| 2 | Revisión de seguridad: las solicitudes de obsolescencia de documentos confidenciales aparecían a autorizadores que no los ven. | Ocultas en «Por autorizar», la campana y la bandeja. |
| 3 | El aviso de validación robaba el foco en el formulario de externos (encontrado con Playwright). | La prueba espera a que se cierre el aviso; el comportamiento es el esperado. |
| 3 | El recordatorio aparecía deshabilitado sin destinatarios. | Se oculta. |
| 3 | «Editar metadatos» de un externo validaba la clave FX. | Valida el identificador del emisor; el origen ya no se cambia. |
| 3 | El PDF de la Lista Maestra partía las fechas y los nombres. | Anchos de columna ajustados. |
| 3 | El diálogo de publicar exigía la distribución por omisión. | Ahora es opcional. |
| 3 | El contador del menú suma lecturas y rompía dos pruebas del menú. | Las pruebas toleran el contador. |
| 4 | **La API permitía abrir una revisión, proponer un cambio o renovar un externo** (la interfaz lo ocultaba). | 409 `externo` en el servidor, con prueba. |
| 4 | **El manifest del respaldo solo contaba 3 de las 11 tablas `sgc_*`.** | Cuenta todas y las compara al restaurar, con prueba. |
| 4 | El acta llamaba «documentos SGC» a los archivos del flujo anterior. | Etiquetas «heredados». |

## Resultado final

`npm run typecheck`, `npm run lint`, `npm run build` y `npm test` en verde el 14/10/2026: **45 suites, 1494 pasos OK, 0 fallas**. Cubre API, navegador en claro, oscuro y tableta, standalone, migraciones, operación, concurrencia y respaldos.
