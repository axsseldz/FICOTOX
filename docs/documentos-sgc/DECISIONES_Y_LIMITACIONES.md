# Documentos SGC · Decisiones, diferencias y limitaciones

Registro de decisiones del equipo de desarrollo, de las diferencias con `Especificacion_Modulo_Documentos_FICOTOX.pdf` y de lo que queda para versiones futuras. Según la sección 15 de la especificación, toda diferencia debe consultarse con Mejora Continua: este registro es la base de esa consulta.

## Diferencias con la especificación

| Tema | Especificación | Implementación | Motivo |
| --- | --- | --- | --- |
| Arquitectura | Flask, SQLAlchemy y el módulo `documents`. | Next.js (interfaz y API) con SQLite o MySQL/MariaDB, y migraciones versionadas 22 a 24. | Es la arquitectura real de FICOTOX. La sección 9 admite documentar formalmente el cambio. |
| Avisos | Notificaciones y escalamiento. | Solo dentro de la plataforma: campana, Inicio, bandeja y contador del menú. | Sin correo en esta versión; el escalamiento por correo queda para V2. |
| Suplentes y delegaciones | Sugeridos. | No implementados: actúan las personas asignadas, y la reasignación (con motivo) los sustituye. | Pendiente de definir quién delega y con qué vigencia. |
| Lista Maestra en PDF | Exportable. | Es un reporte generado (autor, fecha, filtros), sin firma de aprobación. | La lista vigente es la de la plataforma; el PDF es una copia no controlada. |
| Carga inicial | No prevista. | Mejora Continua registra como vigente **solo la primera revisión** de documentos ya autorizados fuera de la plataforma, con PDF, fechas, los tres responsables y contraseña. Queda marcada como `carga_inicial`. | Sin ella no se podrían incorporar los documentos vigentes de la carpeta institucional. Las revisiones siguientes van por el flujo. |
| Copias controladas | Distinguir documento controlado, copia controlada y copia no controlada «cuando se habilite». | No habilitado: toda descarga o impresión es una copia no controlada, y así lo dice el pie de la Lista Maestra. | Futuro. |
| Firma | Autorización documental. | Contraseña (reautenticación) con usuario, cargo, fecha y hora en la línea de tiempo y la bitácora. No hay firma electrónica avanzada. | Firma PAdES en el futuro. |
| Colores HEX | Aproximados, por validar visualmente con Mejora Continua. | Exactamente los de la sección 3. | Validación pendiente en la demostración. |

## Decisiones propias por fase

### Fase 1 · Núcleo documental

1. **Las acciones documentales viven en `rol_acciones`** (módulo `documentos`) y no en una tabla aparte. Así funcionan la unión de roles, la bitácora de roles, las combinaciones prohibidas y la reautenticación. Un `documentos:G` heredado equivale a las 14.
2. **Diagnóstico del Administrador técnico** ligado a `usuarios:G`: solo metadatos de los documentos de uso interno; nunca abre archivos.
3. **Mejora Continua y Responsable General** se reconocen por la clave estable del rol.
4. **Carga inicial** (ver la tabla anterior). El número de la revisión inicial lo indica Mejora Continua (por omisión, 1).
5. **«Nueva revisión»** solo si hay vigente y no hay otra revisión en curso; nace sin archivos.
6. La **regla de tres personas** se aplica desde que se asignan los responsables, y cada uno debe tener la acción de su papel.
7. **Registro de lecturas en la bitácora:** se registra abrir un documento restringido o confidencial (las aperturas de la misma persona en 2 minutos cuentan como una) y, siempre, descargar.
8. **Estado global del documento:** `en_elaboracion`, `vigente` u `obsoleto`. «Pendiente de revisión» se calcula (30 días o vencida).
9. **API en `/api/sgc/*`.** `/api/documentos-sgc` (el flujo anterior) sigue respondiendo 410.
10. **`DOCUMENTOS_MAX_MB`** (50) sustituye a `BIBLIOTECA_MAX_MB`. Se valida la firma de bytes y el contenido activo.
11. **La Biblioteca se retiró** de la interfaz y la API. Sus tablas y archivos se conservan sin uso y se respaldan (nada se borra).
12. **Seguridad:** la bitácora global y el aviso de «clave repetida» no revelan documentos confidenciales.

### Fase 2 · Flujo de aprobación

1. Mejora Continua **publica** aunque haya tenido un papel en esa revisión.
2. Aceptar una solicitud **exige los tres responsables**.
3. **Una sola revisión de trabajo** por documento, y ninguna mientras haya una renovación o una obsolescencia pendientes.
4. **Rechazar cancela** la revisión: queda como `cancelada` en el historial y la vigente sigue intacta.
5. **«Renovado» es un evento**, no un estado: la misma revisión sigue vigente con la fecha nueva.
6. **Solo se renueva un documento pendiente de revisión.** La nueva fecha es por omisión hoy + 3 años.
7. **Los avisos** salen de la misma fuente que el Inicio y la campana. El aviso de solicitud resuelta dura 7 días.
8. **La obsolescencia la aprueba un segundo usuario** con `documento_autorizar` en «Por autorizar».
9. **La carga inicial** se conserva solo para la primera revisión.
10. **Seguridad:** la bandeja y las solicitudes omiten los documentos no visibles.
11. **Segregación en el tiempo:** nadie actúa ni es reasignado en un papel distinto del que ya ejerció en esa revisión.
12. **Seguridad:** las solicitudes de segundo usuario sobre documentos confidenciales no aparecen a quien no puede verlos.

### Fase 3 · Externos, distribución y Lista Maestra

1. **El acuse exige haber abierto el PDF vigente** (`sgc_lecturas.abierto_en`).
2. **La lectura requerida solo se asigna a quien puede confirmarla** (`documento_acusar_lectura`).
3. **La lista por persona** de la distribución la ven quien administra lecturas, quien consulta el histórico y el propietario; los demás ven el punto de uso y su propio acuse.
4. **Al publicar, definir la distribución es opcional.** Si no se define, se conserva la de la revisión anterior, con acuses nuevos.
5. **El responsable de seguimiento de un externo es su propietario.** Así le aplica la confidencialidad, y editar uno actualiza el otro.
6. **Los externos no usan el flujo interno:** no tienen nueva revisión, propuesta ni renovación. Desde la Fase 4 lo impide también el servidor (409 `externo`). Sí pueden declararse obsoletos con un segundo usuario.
7. **La Lista Maestra** muestra la etapa de la revisión en curso (solo número y etapa) a quien ve el documento.
8. **Actividad reciente:** quien no consulta el histórico solo ve publicaciones y verificaciones.
9. **Recordatorio:** cambia la clave del aviso para que la campana lo vuelva a mostrar.

### Fase 4 · Aceptación y entrega

1. **El manifest de los respaldos cuenta todas las tablas `sgc_*`**, no solo fichas, revisiones y archivos, y se comparan al restaurar.
2. En el acta, las etiquetas de los archivos de las funciones retiradas dicen **«heredados»** para no confundirlos con el módulo actual.
3. **CA-16:** las únicas rutas sin sesión son el inicio de sesión, la configuración de esa pantalla y la salud, sin datos. El envío de informes por correo a un cliente es una acción interna registrada: no da acceso ni es una publicación.
4. **CA-17** queda pendiente: la validación por escrito de Mejora Continua tras la demostración.
5. **Datos de demostración:** se crean con un script idempotente que usa la API real, con PDF generados y datos anonimizados. Nunca se ejecuta solo en un despliegue.

## Limitaciones conocidas

- Sin correo: si una persona no entra a la plataforma, no se entera de sus tareas ni de sus lecturas.
- Sin suplentes: si alguien asignado se ausenta, Mejora Continua debe reasignar.
- Sin copias controladas ni marca de agua en la descarga.
- La Lista Maestra en PDF no está firmada.
- Los colores HEX están pendientes de validación visual por Mejora Continua.
- El script de demostración necesita el servidor en marcha y las cuentas de prueba locales.

## Para V2 y el futuro

- **Copias controladas:** registro de copias impresas con número de copia y retiro al publicar una nueva revisión.
- **Escalamiento por correo:** de tareas vencidas y lecturas pendientes.
- **Firma electrónica avanzada** (PAdES) en el PDF publicado y en la Lista Maestra.
- **Suplentes y delegaciones** de autoridad con vigencia.
- **IA:** apoyo para resumir cambios entre revisiones y para buscar dentro de los documentos. No sustituiría la revisión ni la autorización humanas.
