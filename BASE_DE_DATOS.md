# FICOTOX · La base de datos explicada

Este documento explica cómo guarda FICOTOX su información. Está escrito para alguien que no conoce el proyecto ni sabe mucho de bases de datos: cada sección empieza con una explicación en palabras simples y después da el detalle técnico.

Todo lo que dice se tomó del código (`src/lib/server/db.ts`, `config.ts`, `migraciones/`, `audit.ts`, `audit-chain.mjs`, `respaldo.mjs`, los módulos y los scripts). Donde el código no deja algo claro, se dice con la marca **«No está claro en el código»**. No contiene secretos, contraseñas, llaves ni datos reales.

> **Vocabulario mínimo.** *Base de datos*: un archivo ordenado en tablas, como un libro de Excel con muchas hojas. *Tabla*: una hoja (por ejemplo, `muestras_recepcion`). *Fila*: un renglón de esa hoja (una recepción concreta). *Columna*: un dato de cada renglón (el solicitante, la fecha…). Al final hay un glosario completo (sección 17).

## Contenido

1. [Resumen en una página](#1-resumen-en-una-página)
2. [Motor y conexión](#2-motor-y-conexión)
3. [Mapa de la base](#3-mapa-de-la-base)
4. [Cómo viaja un dato](#4-cómo-viaja-un-dato)
5. [Folios y estados](#5-folios-y-estados)
6. [«Nada se borra»](#6-nada-se-borra)
7. [La bitácora de auditoría](#7-la-bitácora-de-auditoría)
8. [Archivos fuera de la base](#8-archivos-fuera-de-la-base)
9. [Fechas y horas](#9-fechas-y-horas)
10. [Seguridad de los datos](#10-seguridad-de-los-datos)
11. [Migraciones](#11-migraciones)
12. [Respaldos y restauración](#12-respaldos-y-restauración)
13. [Rendimiento y límites](#13-rendimiento-y-límites)
14. [Cómo consultar la base de forma segura](#14-cómo-consultar-la-base-de-forma-segura)
15. [Lo que nunca se debe hacer](#15-lo-que-nunca-se-debe-hacer)
16. [Problemas frecuentes](#16-problemas-frecuentes)
17. [Glosario](#17-glosario)

---

## 1. Resumen en una página

**En palabras simples.** FICOTOX guarda todo lo que se captura (recepciones, análisis, informes, reactivos, personas, permisos, incidencias…) en **un solo archivo** llamado `ficotox.sqlite3`. Ese archivo vive en la carpeta `instance/` de la computadora del laboratorio. Los documentos «pesados» (los PDF de los informes, las evidencias de los equipos, los archivos de Documentos SGC, las fotos de perfil) **no** se meten en ese archivo: se guardan como archivos normales en carpetas dentro de `instance/`, y la base solo guarda su nombre y su huella digital para poder comprobar que nadie los cambió.

**Detalle técnico.**

| Tema | Valor (según el código) |
| --- | --- |
| Motor | **SQLite** (librería `better-sqlite3`), en el mismo proceso que el servidor. Existe además una ruta para **MySQL/MariaDB** (sección 2.6) que **no se ha probado contra un servidor real**. |
| Archivo | `instance/ficotox.sqlite3` por omisión (se cambia con `SQLITE_PATH` o `DATABASE_URL`). |
| Tamaño de la base | La decisión de motor (Fase 12) registró 0,4 MB en la base real de entonces; ver sección 13 para la advertencia sobre ese dato. |
| Tablas | **44 tablas de datos** + 2 de control de migraciones (`schema_migraciones`, `schema_migraciones_bloqueo`). Ver sección 3. |
| Versión del esquema | **21** (la última migración es la `0021`; la primera es la `0009`). |
| Dentro de la base | Datos capturados, usuarios, roles y permisos, folios, estados, bitácora de auditoría, huellas SHA-256 de los archivos. |
| Fuera de la base | PDF de informes y evidencias de envío, evidencias de análisis, archivos de Documentos SGC (`sgc/`), PDF de no conformidades, fotos de perfil, reportes de mantenimiento, la llave de la bitácora (`auditoria.key`, si se usa) y los registros del servidor. Ver sección 8. |

### Las 5 reglas más importantes

1. **Nada se borra.** Un registro técnico no se elimina: se **anula con motivo**, se **da de baja**, se **revoca** o se **sustituye por una versión nueva**. Hay unas pocas excepciones técnicas, todas listadas con honestidad en la sección 6.
2. **La bitácora está sellada.** Cada acción importante deja una entrada en la tabla `auditoria`. Cada entrada lleva un sello (HMAC-SHA256) que depende de la anterior, como los eslabones de una cadena. Si alguien edita o borra una entrada, la cadena se rompe y el sistema lo detecta (sección 7).
3. **El esquema cambia solo con migraciones.** Ninguna pantalla crea ni modifica tablas. Cada cambio de estructura es una «migración» numerada, con huella (checksum). Una migración ya aplicada **nunca se modifica** (sección 11).
4. **Los respaldos se hacen con el script, no copiando el archivo.** `npm run respaldar` toma una foto consistente de la base aunque el servidor esté encendido y la verifica. Copiar el archivo a mano con el servidor prendido puede dar una copia dañada o incompleta (secciones 12 y 15).
5. **La llave de la bitácora no se cambia ni se pierde.** Es el secreto con el que se calculan los sellos (`SECRET_KEY` o el archivo `instance/auditoria.key`). Sin la llave correcta, la bitácora ya escrita deja de poder verificarse. Debe guardarse una copia **fuera** de la computadora (sección 7.4).

```mermaid
flowchart LR
    U[Persona en el navegador] --> S[Servidor FICOTOX<br/>Next.js]
    S -->|SQL con parámetros| DB[(instance/ficotox.sqlite3<br/>44 tablas)]
    S -->|archivos| F[instance/informes, evidencias,<br/>biblioteca, calidad, avatares…]
    DB -. huella SHA-256 .-> F
    S -->|toda acción relevante| A[(tabla auditoria<br/>cadena de sellos)]
    K["Llave: SECRET_KEY<br/>o instance/auditoria.key"] -. sella .-> A
    R[npm run respaldar] -->|snapshot + archivos + manifest| B[backups/AAAAMMDD-HHMMSS]
```

---

## 2. Motor y conexión

### 2.1 Qué es SQLite y por qué se eligió

**En palabras simples.** SQLite es una base de datos que no necesita un «servidor de base de datos» aparte: es una librería que lee y escribe un archivo. Para un laboratorio con unas diez personas, una sola computadora y decenas de muestras por semana, es más sencilla de operar (no hay que instalar, asegurar ni administrar otro programa) y ya trae resueltos los respaldos y la verificación que la norma exige.

**Detalle técnico — la decisión.** La decisión de motor se tomó en la Fase 12 (documento `DECISION_BASE_DE_DATOS.md`, hoy ya no está en el repositorio; su contenido esencial se resume aquí). Su estado era **«recomendación, pendiente de aprobación por la Coordinación del Área Técnica y Mejora Continua»**; el código usa SQLite por omisión, pero en el repositorio no queda constancia de esa aprobación. Los argumentos:

- Escenario: ~10 cuentas, 3 a 6 personas a la vez en horas pico, decenas de muestras por semana, sin personal de bases de datos.
- Medido en la prueba de carga (sección 13): decenas de veces más carga que la real, sin errores 500 ni pérdida de integridad.
- Los respaldos y su verificación (exigencia de la norma) están completos y probados **para SQLite**.
- Con MySQL habría un servidor más que instalar, asegurar y administrar, y el soporte MySQL de FICOTOX no se ha probado.

### 2.2 Dónde está el archivo y cómo se configura

`src/lib/server/config.ts` decide las rutas. Orden de prioridad:

| Variable | Efecto |
| --- | --- |
| `DATABASE_URL` | Si empieza con `mysql:` o `mariadb:`, se usa MySQL. Si empieza con `sqlite:`, se usa el archivo indicado. |
| `SQLITE_PATH` | Ruta del archivo SQLite (relativa a la carpeta del proyecto o absoluta). |
| (ninguna) | `<carpeta del proyecto>/instance/ficotox.sqlite3`. La carpeta se crea si no existe. |
| `FICOTOX_INSTANCE_DIR` | Carpeta de la «instancia» (archivos, llave, registros). Si no se da, es la carpeta donde está el archivo SQLite, o `instance/`. |
| `FICOTOX_BACKUP_DIR` | Carpeta de los respaldos. Por omisión, `backups/` en la raíz del proyecto. |
| `FICOTOX_ENV_FILE` / `.env` | Archivo de variables. Las variables ya definidas en el entorno **no** se pisan. |

La «carpeta del proyecto» es `FICOTOX_BASE_DIR` si existe (el lanzador `scripts/start-ficotox.mjs` la fija) o, si no, la carpeta desde la que se arrancó el proceso (`process.cwd()`).

> **Importante.** La base es un archivo **local**. No debe ponerse nunca en una carpeta de red ni sincronizada (OneDrive, Dropbox…): SQLite se corrompe si varios equipos escriben el mismo archivo por red.

### 2.3 Configuración aplicada a SQLite

**En palabras simples.** Son «ajustes finos» que hacen que la base sea rápida y segura ante cortes de luz.

Se aplican al abrir la conexión (`aplicarPragmasSqlite`, en `db.ts`):

| Ajuste (PRAGMA) | Valor | Qué significa |
| --- | --- | --- |
| `journal_mode` | `WAL` (solo si la base es un archivo, no en memoria) | «Write-Ahead Log»: los cambios se anotan primero en un archivo auxiliar (`-wal`). Quien lee no estorba a quien escribe, y se puede hacer un respaldo en línea sin detener el servidor. |
| `synchronous` | `NORMAL` | Con WAL, una caída del programa no pierde nada confirmado; ante un corte de luz puede perderse como mucho la última fracción de segundo de trabajo, **pero la base no se corrompe**. `FULL` sería más lento sin aportar integridad adicional con WAL. |
| `busy_timeout` | `5000` ms | Si otro proceso (un script de respaldo o de migración) tiene la base ocupada, se espera hasta 5 s en lugar de fallar. |
| `foreign_keys` | `ON` | Activa la vigilancia de llaves foráneas. **Hoy el esquema no declara ninguna** (sección 3), así que este ajuste no tiene efecto práctico; está para las que se agreguen en el futuro. |

El arranque que migra, el respaldo y los scripts de operación (`verificar-instalacion`, `sqlite-a-mysql`) abren la base con su propia conexión y un `busy_timeout` de 10 s.

El modo WAL deja junto al archivo principal dos archivos auxiliares: `ficotox.sqlite3-wal` y `ficotox.sqlite3-shm`. Son parte de la base mientras el servidor corre: **no se borran ni se copian por separado** (sección 15).

### 2.4 Cómo se abre la conexión y cómo funcionan las transacciones

**En palabras simples.** Una *transacción* es un «todo o nada»: si al guardar una recepción falla algo a la mitad, no queda nada guardado a medias.

**Detalle técnico** (`src/lib/server/db.ts` y `http.ts`):

- **Una sola conexión** de `better-sqlite3` por proceso, abierta la primera vez que se necesita.
- **Una «sesión» por petición HTTP.** `apiRoute` abre una sesión, ejecuta el trabajo de la petición y, si el código no llamó a `commit()`, hace `rollback()`. La transacción se abre con `BEGIN` en la primera consulta.
- **Las sesiones van en serie dentro de un proceso** (un candado `withSqliteLock`): SQLite admite un solo escritor a la vez, y la carga del laboratorio lo permite con holgura.
- **El cuerpo de la petición se recibe completo antes de abrir la transacción.** Así, subir una evidencia de 25 MB por una red lenta no deja a todos esperando.
- **Parámetros nombrados** (`:nombre`) en todo el SQL; nunca se arma SQL pegando datos de la persona. Los enteros se ligan como `BigInt` para conservar el tipo entero en SQLite.
- **Reintentos por concurrencia.** Si dos peticiones calculan el mismo folio a la vez (o dos procesos chocan por `SQLITE_BUSY`), la segunda se deshace y se **repite completa hasta 3 intentos** con una pequeña espera aleatoria. Si se agotan, responde un `409` limpio («Otra persona registró al mismo tiempo; intenta de nuevo»), nunca un 500. Si el handler ya había confirmado una parte (por ejemplo, registrar un envío y luego mandar el correo), **no** se reintenta, para no duplicar efectos.
- Antes de atender, se barren como máximo una vez por minuto los vencimientos (roles, solicitudes y autorizaciones vencidas), que quedan en la bitácora.

### 2.5 Errores que el código distingue

`db.ts` clasifica los errores: de integridad (restricciones únicas), de conflicto de folio (un patrón que reconoce `folio` o el índice de la serie) y operacionales (base ilegible, conexión rechazada, etc.). Esa clasificación es la que decide si se reintenta o se responde con un error claro.

### 2.6 Compatibilidad con MySQL/MariaDB

**Qué existe hoy (comprobable en el código):**

- Una capa de acceso equivalente (`db.ts`): pool de `mysql2` (hasta 10 conexiones), cada conexión en UTC (`SET time_zone = '+00:00'`), la misma sintaxis `:parametro`.
- Cada migración trae **dos versiones del SQL** (`sqlite` y `mysql`), y el motor de migraciones sabe aplicarlas en ambos.
- Los triggers de la bitácora también tienen versión MySQL (`SIGNAL SQLSTATE '45000'`).
- `scripts/sqlite-a-mysql.mjs`: pasa una base SQLite a MySQL conservando ids y la bitácora idéntica (mismos sellos), y verifica conteos y cadena.
- `tests/mysql.mjs` (`npm run test:mysql`): pruebas contra un servidor MySQL/MariaDB (con Docker o `MYSQL_TEST_URL`).

**Cómo se activaría:** el administrador de la base crea una base vacía (`CREATE DATABASE ficotox CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`) y un usuario; en `.env` se pone `DATABASE_URL=mysql://usuario:clave@servidor:3306/ficotox`. El procedimiento completo está en el README («MySQL/MariaDB (opcional)»).

**Qué NO se ha probado ni existe para MySQL:**

- **Nunca se corrió contra un servidor MySQL real**: el propio script `sqlite-a-mysql.mjs` y el archivo `tests/mysql.mjs` lo declaran («no se probó contra un servidor MySQL en esta fase»; sin Docker ni `MYSQL_TEST_URL` la prueba sale con código 2 y dice que NO se probó). Yo tampoco la ejecuté para este documento.
- El SQL MySQL de la migración base se **tradujo** del de SQLite y no declara llaves foráneas ni algunos índices secundarios.
- Los scripts de respaldo y restauración en modo real **solo funcionan con SQLite**. En MySQL el respaldo lo hace `scripts/backup_ficotox.py --target database` con `mysqldump` (volcado `.sql`, sin manifest ni verificación de la bitácora), y la restauración se hace a mano con `mysql < respaldo.sql`; `npm run respaldar` y `npm run restaurar` se niegan con MySQL.
- `npm run instancia-nueva` es solo para SQLite; en MySQL el primer administrador se crea a mano (README).
- Con MySQL, antes de migrar hay que declarar que ya se hizo el respaldo (`MIGRAR_MYSQL_RESPALDO_HECHO=true`).

### 2.7 Cuándo convendría cambiar a MySQL

Según los umbrales de la decisión de la Fase 12, conviene reconsiderarlo (y probar primero con `npm run test:mysql` y una copia) si ocurre **cualquiera** de estos casos:

1. Se necesita **más de un servidor de aplicación** (otra sede, alta disponibilidad) o acceso desde fuera de la red del laboratorio con infraestructura central.
2. La **p95** de `npm run prueba-carga` en la computadora del laboratorio pasa de **500 ms** con el número real de usuarios, o hay lentitud sostenida.
3. Aparecen respuestas **409 `conflicto_concurrencia`** en operación normal (en `instance/logs`: «conflicto de concurrencia tras 3 intentos»).
4. La base pasa de **2 GB**, o el respaldo en línea pasa de **30 s**.
5. Más de **25 usuarios simultáneos** de forma habitual.
6. CICESE ofrece un servidor MySQL/MariaDB **administrado** (con respaldos y DBA) y la política institucional lo dispone.

---

## 3. Mapa de la base

**En palabras simples.** La base es un conjunto de hojas (tablas) que se refieren unas a otras mediante números. Por ejemplo, un *procesamiento* guarda el número de la *recepción* de donde viene; un *análisis* guarda el número de la *extracción*; un *informe* guarda el número de la recepción y la lista de los análisis que incluye. Así se puede seguir una muestra desde que llega hasta que se informa.

**Detalle técnico importante: las relaciones viven en el código, no en la base.** Ninguna tabla declara llaves foráneas (`FOREIGN KEY`). Una «relación» es solo una columna con el `id` de otra tabla (`recepcion_id`, `procesamiento_id`, `nc_id`…), y las reglas («no se anula una recepción con procesamientos vigentes») las aplica el código. Por eso los diagramas de abajo muestran relaciones **lógicas**. Otras convenciones:

- Cada tabla tiene `id` entero autoincremental como llave primaria.
- Muchas columnas `*_json` guardan listas o formularios como texto JSON (por ejemplo, `analisis_json`, `resultados_json`). Es una decisión de diseño: los formatos del laboratorio (FX-TCF-GMR, etc.) tienen muchos campos variables.
- Casi todas las tablas de registros técnicos tienen **columnas de anulación** (`anulado_en`, `anulado_por`, `motivo_anulacion`, `estado_previo`) y de **supervisión** (`requiere_supervision`, `supervision_estado`, `supervisor_id`, `supervisado_por`, `supervisado_en`…); se explican en la sección 6 y no se repiten tabla por tabla.
- Las columnas `creado_rol_id`/`creado_cargo` (y similares) guardan **con qué cargo actuó** la persona cuando una misma cuenta tiene varios roles.

### 3.1 Diagrama general simplificado

```mermaid
erDiagram
    USUARIOS ||--o{ USUARIO_ROLES : "tiene roles (con vigencia)"
    ROLES ||--o{ ROL_ACCIONES : "permisos"
    MUESTRAS_RECEPCION ||--o{ MUESTRAS_PROCESAMIENTO : "origen"
    MUESTRAS_PROCESAMIENTO ||--o{ MUESTRAS_EXTRACCION : "origen"
    MUESTRAS_EXTRACCION ||--o{ MUESTRAS_ANALISIS : "origen"
    MUESTRAS_RECEPCION ||--o{ INFORMES : "se informa en"
    INFORMES ||--o{ ENVIOS_INFORME : "se envía"
    MUESTRAS_EXTRACCION }o--o{ REACTIVOS : "descuenta (movimientos)"
    REACTIVOS ||--o{ MOVIMIENTOS : "entradas y salidas"
    INCIDENCIAS }o--o| NO_CONFORMIDADES : "se escala a"
    NO_CONFORMIDADES ||--o{ ACCIONES_CORRECTIVAS : "tiene"
    ADJUNTOS }o--|| MUESTRAS_ANALISIS : "evidencia (entidad + id)"
    AUDITORIA }o--o| USUARIOS : "quién hizo qué"
```

### 3.2 Muestras (el flujo del laboratorio)

**Para qué sirve.** Registrar cada muestra desde que llega hasta que se analiza, siguiendo los formatos del laboratorio.

```mermaid
erDiagram
    MUESTRAS_RECEPCION ||--o{ ASIGNACIONES_MUESTRA : "se asigna a personas"
    MUESTRAS_RECEPCION ||--o{ MUESTRAS_PROCESAMIENTO : recepcion_id
    MUESTRAS_PROCESAMIENTO ||--o{ MUESTRAS_EXTRACCION : procesamiento_id
    MUESTRAS_EXTRACCION ||--o{ MUESTRAS_ANALISIS : extraccion_id
    MUESTRAS_RECEPCION ||--o{ MUESTRAS_ANALISIS : recepcion_id
    MUESTRAS_ANALISIS ||--o| MUESTRAS_ANALISIS : "sustituye_a (enmienda)"
    MUESTRAS_ANALISIS ||--o{ ADJUNTOS : "evidencia"
    MUESTRAS_EXTRACCION }o--o{ EQUIPOS : "equipos_json"
    MUESTRAS_ANALISIS }o--o| EQUIPOS : equipo_id
```

| Tabla | Para qué sirve | Columnas principales | Se relaciona con |
| --- | --- | --- | --- |
| `muestras_recepcion` | **Recepción de muestras** (formato FX-TCF-GMR): qué llegó, de quién y si se acepta. Es el «expediente» al que se ligan todas las etapas siguientes. | `folio_num` (único, serie R), `fecha_recepcion`, `hora_recepcion`, `recibido_por`, `solicitante`, `id_interno`, `lote_muestras_json` (las muestras del lote), `analisis_json` (análisis solicitados), `inspeccion_json` (inspección visual), `datos_solicitante_json`, `datos_custodio_json`, `decision_aceptacion` (aceptada / aceptada con desviación / rechazada), `aceptacion_json`, `disposicion_json` (destino final de remanentes), `estado`, `estado_antes_cierre`, `recibio_usuario_id`/`recibio_cargo` (firma ligada a la cuenta). | Origen de `muestras_procesamiento`, `muestras_analisis`, `informes`, `asignaciones_muestra`. |
| `asignaciones_muestra` | **Quién puede ver y trabajar** una recepción cuando su permiso es «solo las asignadas». | `recepcion_id`, `usuario_id`, `asignado_por`, `asignado_en`, `motivo`, `revocado_en`, `revocado_por`, `motivo_revocacion`. | `muestras_recepcion`, `usuarios`. |
| `muestras_procesamiento` | **Preparación de la muestra** (lavado, desconche, molienda…). | `folio_num` (único, serie P), `recepcion_id`, `folio_recepcion_num`, `fecha_procesamiento`, `lote_seleccion_json`, `tipo_organismo_json`, `parte_organismo_json`, `bivalvos_steps_json`/`sardinas_steps_json` (pasos), `resguardo_json`, `uso_inventario_json` (insumos usados), `nombre_quien_proceso`/`firma_quien_proceso` y los equivalentes de supervisión, `estado`. | `muestras_recepcion` (origen), `muestras_extraccion`. |
| `muestras_extraccion` | **Extracción de toxinas** (formatos ASP y DSP). | `tipo_registro` (`E-A` o `E-D`) y `folio_num` (único por pareja), `procesamiento_id`, `fecha_extraccion`, `tipo_molienda`, `pasos_json`, `registro_pesos_json`, `equipos_json` (equipos usados), `uso_inventario_json` (reactivos), firmas de quien extrajo / limpió / supervisó (con `*_usuario_id` y `*_cargo`), `estado`. | `muestras_procesamiento` (origen), `muestras_analisis`, y por sus movimientos, `reactivos`/`consumibles`. |
| `muestras_analisis` | **Resultado del análisis** de una muestra, con controles de calidad, revisión y aprobación. | `folio_num` + `version` (únicos juntos, serie A), `tipo_analisis`, `metodo`, `metodo_referencia`, `recepcion_id`, `procesamiento_id`, `extraccion_id`, `equipo_id`/`equipo_nombre`, `condiciones_json`, `resultados_json`, `controles_json`, `uso_inventario_json`, `analista_*`, `revisado_*`, `aprobado_*` (persona, cargo, fecha, firma), `enviado_revision_*`, `devolucion_observaciones`, `estado`, `sustituye_a`, `motivo_enmienda`. | `muestras_extraccion` (origen), `informes` (lista de ids), `adjuntos` (evidencia), `equipos`. |

### 3.3 Informes

**Para qué sirve.** Emitir el informe de resultados para el cliente, con su PDF final, y llevar el registro de cómo y cuándo se envió.

```mermaid
erDiagram
    MUESTRAS_RECEPCION ||--o{ INFORMES : recepcion_id
    INFORMES ||--o| INFORMES : "sustituye_a (enmienda)"
    INFORMES ||--o{ ENVIOS_INFORME : informe_id
    INFORMES }o--o{ MUESTRAS_ANALISIS : "analisis_ids_json"
    INFORMES ||--o{ RETENCIONES_INFORME : "retenido por una NC"
```

| Tabla | Para qué sirve | Columnas principales | Se relaciona con |
| --- | --- | --- | --- |
| `informes` | El **informe de resultados** (folio IR) y sus versiones. | `folio_num` + `version` (únicos juntos), `recepcion_id`, `sustituye_a` y `motivo_enmienda` (enmiendas), `cliente_json`, `muestras_json`, `analisis_ids_json` (análisis incluidos), `resultados_json` (**congelados** al liberar), `declaraciones_json`, `fecha_emision`, firmas de elaboró / revisó / autorizó / liberó (nombre, cargo, fecha), `archivo_pdf` y `pdf_sha256` (el PDF final y su huella), `estado`, `requiere_enmienda` y `requiere_enmienda_motivo`, columnas de anulación. | `muestras_recepcion`, `muestras_analisis`, `envios_informe`, `retenciones_informe`. |
| `envios_informe` | **Cada envío** del informe al cliente (el primero lo deja «enviado»; puede haber reenvíos). | `informe_id`, `version`, `destinatario_nombre`, `destinatario_correo`, `enviado_en`, `enviado_por`, `medio` (manual o SMTP), `evidencia_archivo` y `evidencia_sha256` (la evidencia del correo), `message_id`, `confirmacion_en`/`confirmacion_nota` (confirmación de recepción). | `informes`. |

### 3.4 Inventario y equipos

**Para qué sirve.** Saber qué reactivos, consumibles y equipos hay, cuánto queda, qué se consumió y qué mantenimiento tienen.

```mermaid
erDiagram
    REACTIVOS ||--o{ MOVIMIENTOS : "tabla_origen + id_item"
    CONSUMIBLES ||--o{ MOVIMIENTOS : "tabla_origen + id_item"
    EQUIPOS ||--o{ MANTENIMIENTOS : id_equipo
    MANTENIMIENTOS ||--o{ REPORTES_MANTENIMIENTO : id_mantenimiento
    EQUIPOS ||--o{ SUSPENSIONES : "tipo equipo + clave"
```

| Tabla | Para qué sirve | Columnas principales |
| --- | --- | --- |
| `reactivos` | Frascos y soluciones del laboratorio (tabla con **muchas columnas**: creció al importar hojas de cálculo de distintos formatos; muchas son alias del mismo dato). | `nombre`/`producto`, `marca`, `proveedor`, `numero_cas`, `lote`, `cantidad_actual` y `unidad`, `stock_minimo`/`stock_maximo`, `ubicacion`/`localizacion`, `caducidad`/`fecha_vencimiento`, `fecha_apertura`, `activo`, `baja_motivo`/`baja_en`/`baja_por`, `extra_json`. |
| `consumibles` | Material que se gasta por pieza (puntas, filtros…). | `producto`, `marca`, `proveedor`, `catalogo_parte_cas`, `piezas`, `cantidad_por_pieza`, `stock_maximo`, `activo`, columnas de baja. |
| `equipos` | Instrumentos del laboratorio. | `nombre`, `marca`, `modelo`, `numero_serie` (único), `clave_bitacora`, `ubicacion`, `fecha_prox_calibracion`, `estado` (p. ej. «fuera de servicio»), `activo`, columnas de baja. |
| `mantenimientos` | Mantenimientos programados o realizados de un equipo. | `id_equipo`, `tipo`, `fecha_programada`, `fecha_realizado`, `tecnico_proveedor`, `estado`, `observaciones`. |
| `reportes_mantenimiento` | El reporte de servicio (PDF) de un mantenimiento. | `codigo` (único, `RM-<mantenimiento>-<n>`), `id_mantenimiento`, `version`, `archivo_url`, `nombre_almacenado` (relativo a `instance/maintenance_reports/`), `sha256`, `subido_por`. Quitar o reemplazar no borra: `anulado_en`, `anulado_por`, `motivo_anulacion` y `reemplazado_por` (migración 25). |
| `movimientos` | **Libro de entradas y salidas** de inventario. Cada consumo hecho desde un formato queda aquí. | `tipo` (`entrada`/`salida`), `tabla_origen` (`reactivos` o `consumibles`), `id_item`, `cantidad`, `motivo`, `referencia` (**única**; por ejemplo `EXT-78-INS-0` = «extracción 78, insumo 0»), `id_usuario`, `creado_en`. |

### 3.5 Calidad (incidencias, no conformidades y Documentos SGC)

**Para qué sirve.** Registrar problemas (incidencias), tratarlos formalmente cuando lo ameritan (no conformidades con acciones correctivas) y controlar los documentos del sistema de calidad (**Documentos SGC**, tablas `sgc_*`, migraciones 22 a 24). La Biblioteca de documentos se retiró: sus tablas se conservan sin uso. El diagrama entidad–relación y el diccionario completo de las tablas `sgc_*` están en [docs/documentos-sgc/MODELO_DATOS.md](docs/documentos-sgc/MODELO_DATOS.md).

```mermaid
erDiagram
    INCIDENCIAS ||--o{ INCIDENCIA_REGISTROS : "registros ligados"
    INCIDENCIAS }o--o| NO_CONFORMIDADES : "nc_id / incidencia_id"
    NO_CONFORMIDADES ||--o{ ACCIONES_CORRECTIVAS : nc_id
    NO_CONFORMIDADES ||--o{ NC_VERIFICACIONES : nc_id
    NO_CONFORMIDADES ||--o{ NC_COMUNICACIONES : nc_id
    NO_CONFORMIDADES ||--o{ NC_REGISTROS_AFECTADOS : nc_id
    NO_CONFORMIDADES ||--o{ SUSPENSIONES : nc_id
    NO_CONFORMIDADES ||--o{ RETENCIONES_INFORME : nc_id
    INFORMES ||--o{ RETENCIONES_INFORME : informe_id
```

| Tabla | Para qué sirve | Columnas principales |
| --- | --- | --- |
| `incidencias` | Un problema reportado (folio INC), por una persona o **automáticamente** por el sistema (recepción rechazada, equipo no apto, alerta de integridad…). | `folio_num` (único), `tipo`, `fecha_hora_ocurrencia`, `descripcion`, `accion_inmediata`, `impacto_resultados`, `estado`, `reportada_por`/`reportada_nombre`/`reportada_rol`/`reportada_en`, `origen_automatico` y `clave_automatica` (para no duplicar las automáticas), datos de evaluación, `decision_evaluacion`, `nc_id`, columnas de anulación. |
| `incidencia_registros` | Los registros que una incidencia menciona (una recepción, un equipo…). | `incidencia_id`, `entidad`, `entidad_id`, `referencia`. |
| `no_conformidades` | Una **no conformidad** (folio NC): problema que se trata con análisis de causa. | `folio_num` (único), `origen`, `incidencia_id`, `clasificacion` (menor/mayor/crítica), `requisito_incumplido`, `descripcion`, `responsable_id`, `estado` (etapas), fechas de cada etapa, evaluación de impacto, `metodo_causa`, `causa_raiz`, `requiere_accion_correctiva`, `reaperturas`, cierre (`cerrada_*`, `conclusion`), `archivo_pdf` y `pdf_sha256` (PDF del «Registro de no conformidad»), `responsables_previos` (JSON de responsables anteriores). |
| `acciones_correctivas` | Las acciones que se acuerdan para corregir la causa. | `nc_id`, `descripcion`, `responsable_id`, `fecha_compromiso`, `estado`, datos de implementación/cancelación/reasignación. |
| `nc_verificaciones` | La verificación de **eficacia** (una por NC, no por acción). | `nc_id`, `fecha_programada`, `verificada_por`, `resultado`, `comentarios`. |
| `nc_comunicaciones` | Aviso al cliente cuando aplica. | `nc_id`, `fecha`, `medio`, `contacto`, `resumen`, `informe_ids_json`. |
| `nc_registros_afectados` | Qué registros (informes, análisis…) toca la no conformidad. | `nc_id`, `entidad`, `entidad_id`, `referencia`. |
| `suspensiones` | **Suspender** un método o un equipo por una NC (bloquea su uso hasta reanudar). | `tipo` (`metodo`/`equipo`), `clave`, `nc_id`, `motivo`, `suspendida_*`, `reanudada_*`, `estado_previo_equipo`. |
| `retenciones_informe` | **Retener** un informe (no se libera ni se envía) por una NC. | `nc_id`, `informe_id`, `motivo`, `retenido_*`, `liberada_*`. |
| `sgc_areas` | Catálogo de áreas de gestión de Documentos SGC (GC, TH, AD, CO, TC, DI) con su color HEX (identifica el área, nunca el estado). | `codigo` (único), `nombre`, `color`, `orden`, `activo`. |
| `sgc_tipos` | Tipos documentales (M, P, F, L, I, B, R). | `codigo` (único), `nombre`, `descripcion`, `flujo_predeterminado`. |
| `sgc_documentos` | **Ficha maestra** de un documento SGC. | `clave` FX (única, normalizada en mayúsculas sin espacios), `titulo`, `area_codigo`, `tipo_codigo`, `origen`, `proceso`, `confidencialidad` (uso_interno/restringido/confidencial), `palabras_clave`, `propietario_id`, `estado` (en_elaboracion/vigente/obsoleto), `revision_vigente_id`. |
| `sgc_revisiones` | Cada **revisión** de un documento. | `documento_id` + `numero` (únicos juntos), `estado`, fechas de emisión/vigencia/próxima revisión, motivo, apartados y descripción del cambio, `elaborador_id`/`revisor_id`/`autorizador_id`, `origen_registro` (flujo o carga_inicial), conservación. **Solo una vigente por documento** (índice único parcial; en MySQL, columna generada `vigente_de`). |
| `sgc_archivos` | Archivo fuente y PDF de consulta de una revisión. | `revision_id`, `tipo` (fuente/pdf), `nombre_original`, `nombre_almacenado`, `mime`, `tamano_bytes`, `sha256`, `reemplazado_en`. Disparadores: no se agregan ni cambian archivos de una revisión que ya no está en borrador y no se borran. |
| `sgc_solicitudes` | Solicitudes de documento nuevo o de cambio (`documento_proponer`); Mejora Continua las acepta (crea la ficha o abre la revisión) o las rechaza con motivo. | `tipo` (nuevo/cambio), `documento_id`, `area_codigo`, `tipo_codigo`, `titulo_propuesto`, `justificacion`, `solicitante_id`, `estado` (pendiente/aceptada/rechazada), `resuelta_*`, `revision_id`, `clave_asignada`, archivo de apoyo (`apoyo_*` con SHA-256). |
| `sgc_flujo_acciones` | Cada decisión del flujo (CA-07): solicitar, aceptar, enviar, revisar, devolver, rechazar, autorizar, publicar, reasignar, renovar, obsoletar. | `revision_id`, `accion`, `decision`, `comentario`, `usuario_id`, `cargo`, `papel`, `renovacion_id`, `fecha`. |
| `sgc_renovaciones` | Renovación sin cambios de la revisión vigente (misma revisión, nueva próxima revisión). | `documento_id`, `revision_id`, `estado` (en_revision/en_autorizacion/completada/cancelada), `revisor_id`, `autorizador_id`, `fecha_proxima_anterior`, `fecha_proxima_nueva`, `fecha_limite`. |
| `sgc_externos` | Seguimiento de un documento **externo** (norma, guía): emisor, versión, enlace, responsable, última verificación y próxima revisión (aviso a 30 días). Cada versión es una revisión (`sgc_revisiones.version_externa`). | `documento_id` (único), `fuente`, `version_fecha`, `enlace`, `responsable_id`, `ultima_revision`, `proxima_revision`. |
| `sgc_distribucion` | Destinatarios de una revisión, por rol (incluye a quien reciba el rol después) o por persona, con punto de uso y lectura requerida. | `revision_id`, `rol_id` o `usuario_id`, `punto_uso`, `requiere_lectura`, `motivo`, `retirado_en` y `motivo_retiro`. |
| `sgc_lecturas` | Acuse de lectura de una persona sobre una revisión exacta (no se deshace). | `revision_id` + `usuario_id` (únicos), `abierto_en` (apertura del PDF, exigida), `leido_en`, `notificado_en` (recordatorio), `estado`. |
| `biblioteca_categorias` | (Retirada; sin uso) Categorías de la Biblioteca de documentos. | `nombre` (único), `orden`, `activa`. |
| `biblioteca_documentos` | (Retirada; sin uso) Un documento de consulta (manual, procedimiento, formato…). | `titulo`, `descripcion`, `categoria_id`, `clave`, `etiquetas`, `fecha_documento`, `visibilidad` (todos o por roles), `version_actual_id`, `archivado_en`/`archivado_por`/`motivo_archivo`, `origen_sgc_clave` (si vino del flujo anterior). |
| `biblioteca_versiones` | (Retirada; sin uso) Cada **versión** (archivo) de un documento. | `documento_id`, `numero` (único con el documento), `nombre_original`, `nombre_almacenado`, `mime`, `extension`, `tamano_bytes`, `sha256`, `nota_version`, `texto` (para buscar dentro), `subido_por`, `subido_en`, `origen_sgc_id`. |
| `biblioteca_visibilidad_roles` | Qué roles ven un documento restringido. | `documento_id`, `rol_id` (único juntos). |

**Biblioteca de documentos** (relaciones lógicas):

```mermaid
erDiagram
    BIBLIOTECA_CATEGORIAS ||--o{ BIBLIOTECA_DOCUMENTOS : categoria_id
    BIBLIOTECA_DOCUMENTOS ||--o{ BIBLIOTECA_VERSIONES : documento_id
    BIBLIOTECA_DOCUMENTOS ||--o| BIBLIOTECA_VERSIONES : "version_actual_id"
    BIBLIOTECA_DOCUMENTOS ||--o{ BIBLIOTECA_VISIBILIDAD_ROLES : documento_id
    ROLES ||--o{ BIBLIOTECA_VISIBILIDAD_ROLES : rol_id
    DOCUMENTOS_SGC }o--o| BIBLIOTECA_DOCUMENTOS : "copiado por la migración 13"
```

### 3.6 Usuarios y permisos

**Para qué sirve.** Saber quién es cada persona, qué roles tiene (con fechas de vigencia), qué puede hacer cada rol y quién está autorizado para cada actividad.

```mermaid
erDiagram
    USUARIOS ||--o{ USUARIO_ROLES : usuario_id
    ROLES ||--o{ USUARIO_ROLES : rol_id
    ROLES ||--o{ ROL_ACCIONES : id_rol
    USUARIOS ||--o{ AUTORIZACIONES_PERSONAL : usuario_id
    USUARIOS ||--o| USUARIOS : "supervisor_id"
    USUARIOS ||--o{ SOLICITUDES_AUTORIZACION : "solicitado_por"
```

| Tabla | Para qué sirve | Columnas principales |
| --- | --- | --- |
| `usuarios` | Las cuentas. | `nombre`, `email` (único), `activo`, `password_hash` (**solo el hash**, nunca la contraseña), `tipo_cuenta` (permanente/temporal), `vigente_desde`/`vigente_hasta`, `supervisor_id`, `token_version` (invalida sesiones), `debe_cambiar_password`, `bloqueado_hasta`, `intentos_desde`, `cargo_predeterminado`, `tema`, `foto`/`usa_foto`, `ultimo_acceso`. |
| `roles` | Los roles (Responsable General, Coordinación, Analista…). | `nombre` (único), `clave`, `descripcion`, `es_sistemico`, `activo`. |
| `usuario_roles` | **Qué rol tiene cada persona y por cuánto tiempo.** | `usuario_id`, `rol_id`, `vigente_desde`, `vigente_hasta`, `motivo`, `asignado_por`/`asignado_en`, `revocado_en`/`revocado_por`/`motivo_revocacion`, `vencimiento_registrado_en`. |
| `rol_acciones` | **Los permisos reales**: (rol, módulo, acción, alcance). Las acciones son ver (V), capturar (C), editar (E), revisar (R), aprobar (A), anular (AN) y administrar (G); el alcance limita cada una («total», «propio», «estado», «asignado», «supervisado», «incidencias», «bitácora»…). | `id_rol`, `modulo`, `accion`, `alcance`. |
| `autorizaciones_personal` | **Autorizaciones FX-THF-AP**: quién está autorizado para qué actividad, método o equipo. | `usuario_id`, `tipo`, `clave`, `vigente_desde`/`vigente_hasta`, `folio_fx_thf_ap`, `otorgada_*`, `revocada_*`. |
| `solicitudes_autorizacion` | Acciones críticas que necesitan la aprobación de **un segundo usuario** (anular algo ya avanzado, excepciones, decisiones de recepción). | `tipo`, `modulo`, `entidad`, `entidad_id`, `accion`, `datos_json`, `motivo`, `solicitado_*`, `estado`, `resuelto_*`, `vence_en`. |
| `intentos_acceso` | Intentos de inicio de sesión (para bloquear cuentas e IP tras demasiados fallos). | `email`, `usuario_id`, `ip`, `tipo`, `exito`, `fecha`. |
| `reautenticaciones` | Permisos temporales de «acabas de confirmar tu contraseña» para acciones críticas. | `token_hash` (solo el hash), `usuario_id`, `accion`, `creado_en`, `expira_en`, `usado_en`. |
| `firmas_tokens` | Tokens de un solo uso para confirmar una firma. | `token_hash`, `usuario_id`, `solicitado_por`, `expira_en`, `usado_en`. |
| `notificaciones_leidas` | Qué avisos de la campana ya leyó cada persona. | `usuario_id`, `clave`, `leida_en`. |
| `busqueda_recientes` | Lo último que buscó o abrió cada persona en el buscador. | `usuario_id`, `clave`, `titulo`, `href`, `usado_en`. |

### 3.7 Bitácora y sistema

```mermaid
erDiagram
    USUARIOS ||--o{ AUDITORIA : "usuario_id (quién actuó)"
    AUDITORIA ||--o| AUDITORIA : "hash_anterior = hash de la anterior"
    ADJUNTOS }o--o| AUDITORIA : "cada adjunto deja una entrada"
    SCHEMA_MIGRACIONES ||--o| AUDITORIA : "cada migración deja una entrada"
    SCHEMA_MIGRACIONES_BLOQUEO
```

| Tabla | Para qué sirve | Columnas principales |
| --- | --- | --- |
| `auditoria` | **La bitácora de auditoría**: quién hizo qué, cuándo y por qué. Es de solo inserción y está sellada (sección 7). | `fecha_hora`, `usuario_id`/`usuario_nombre`/`usuario_email`, `accion`, `entidad`, `entidad_id`, `referencia` (el folio), `motivo`, `cambios_json`, `datos_anteriores_json`, `datos_nuevos_json`, `hash_anterior`, `hash`. |
| `adjuntos` | **Evidencias adjuntas** a un registro (hoy, a análisis, incidencias y acciones correctivas), con la huella del archivo. | `entidad`, `entidad_id`, `tipo_evidencia`, `descripcion`, `nombre_original`, `nombre_almacenado`, `mime`, `extension`, `tamano_bytes`, `sha256`, `subido_*`, `heredado_de` (evidencia copiada a una enmienda), `anulado_*`. |
| `schema_migraciones` | Control de **migraciones**: cuáles se aplicaron y con qué huella (sección 11). | `version`, `nombre`, `checksum`, `aplicada_en`, `duracion_ms`, `app_commit`, `modo` (`aplicada` o `baseline`). |
| `schema_migraciones_bloqueo` | Una sola fila que impide que dos procesos migren a la vez. | `id`, `pid`, `host`, `desde`. |

SQLite crea además por su cuenta la tabla interna `sqlite_sequence` (el último id dado a cada tabla), que la verificación de la bitácora usa para detectar entradas borradas al final.

### 3.8 Tablas antiguas que ya no se usan (y por qué se conservan)

**En palabras simples.** Algunas funciones se retiraron del sistema, pero sus datos históricos siguen guardados. Borrar tablas con historial sería contrario a la regla de «nada se borra», y una migración aplicada no se puede cambiar.

| Tabla | De qué era | Estado en el código |
| --- | --- | --- |
| `documentos_sgc` | Flujo anterior de **control documental** («Documentos SGC»: clave, revisión, revisión técnica, aprobación, vigencia). | Sus escrituras responden **410 «Funcionalidad retirada»**. Quedan solo dos lecturas (`GET /api/documentos-sgc/:id` y `/archivo`). La **migración 13** copió esos documentos a la Biblioteca (`origen_sgc_clave`, `origen_sgc_id`). |
| `distribucion_documento` | Quién debía leer cada documento del flujo anterior. | Solo el módulo retirado la menciona. |
| `propuestas_documento` | Propuestas de cambio documental (incluso ligadas a una NC por `nc_id`). | Solo el módulo retirado y la NC (`nc.ts`) la mencionan. **No está claro en el código** si una NC actual todavía puede generar una propuesta: la columna `propuesta_documento_id` sigue en `no_conformidades`. |
| `permisos`, `rol_permisos` | Modelo de permisos **anterior** (lectura/creación/edición/borrado por permiso). | El comentario de `rbac.ts` lo dice: se conservan pero «ya no se leen para decidir permisos». Solo `admin.ts` borra sus filas al eliminar un rol nunca asignado. |
| `usuarios.id_rol` | Rol único del modelo anterior. | Guarda el rol con el que se dio de alta la cuenta; ya no decide permisos (los decide `usuario_roles` + `rol_acciones`). |
| `reactivos` (columnas `item_name`, `vendor`, `amount_in_stock`, `lot_number`…) | Alias en inglés y de otros formatos de hojas de cálculo. | La tabla sigue en uso; esas columnas son duplicados históricos (por ejemplo, el consumo descuenta `cantidad_actual` y, si existe, `amount_in_stock`). |

Las carpetas de archivos `instance/documentos_sgc/` (flujo anterior) también se conservan y se respaldan (sección 8).

---

## 4. Cómo viaja un dato

**En palabras simples.** Sigamos una muestra real desde que entra por la puerta hasta que se cierra, y veamos qué se escribe en la base en cada paso. En cada paso el sistema también deja una entrada en la bitácora.

**Caso de ejemplo:** una cooperativa entrega un lote de almejas para análisis de toxinas DSP.

```mermaid
flowchart TD
    A[1 Recepción<br/>R 0000605] --> B[2 Asignación<br/>a una persona]
    B --> C[3 Procesamiento<br/>P 0000601]
    C --> D[4 Extracción DSP<br/>E-D 0000072<br/>descuenta reactivos]
    D --> E[5 Análisis<br/>A 0000120 + evidencia<br/>revisión y aprobación]
    E --> F[6 Informe<br/>IR 0000028<br/>autorizar y liberar con PDF]
    F --> G[7 Envío<br/>al cliente]
    G --> H[8 Cierre<br/>disposición final]
```

(Los folios del diagrama son ilustrativos.)

Todas las escrituras de una petición ocurren **en una sola transacción**: o se guarda todo (la fila, el movimiento de inventario y la entrada de bitácora) o no se guarda nada.

### Paso 1 — Recepción de la muestra

Se llena el formato de recepción (`POST /api/samples/reception`).

| Qué se crea o cambia | Detalle |
| --- | --- |
| **1 fila** en `muestras_recepcion` | Con `folio_num` = último folio + 1 (serie R). Los datos del lote, la inspección visual y el solicitante quedan en las columnas `*_json`. |
| `estado` | Empieza en `registrada`. Si ya se escribió la decisión de aceptación: `aceptada`, `aceptada_con_desviacion` o `rechazada`. |
| Supervisión | Si la persona tiene alcance «supervisado» (cuenta temporal), la fila queda con `requiere_supervision` y espera el visto bueno de su supervisor. |
| Si la decisión es **rechazo o aceptación con desviación** | Quien captura **sin** permiso de aprobar en muestras (`muestras:A`) no la aplica directamente: la fila queda **sin decisión** (`registrada`) y se crea una fila en `solicitudes_autorizacion` para que la apruebe la Coordinación Técnica. Quien sí tiene ese permiso la aplica de inmediato (con reautenticación). En ambos casos, al aplicarse la decisión se crea una **incidencia automática** (fila en `incidencias`, reportada por quien tomó la decisión). |
| **Bitácora** | Acción `crear` sobre `muestras_recepcion` (con la fila completa) y, cuando la decisión se aplica, `aceptar` o `rechazar`. |

### Paso 2 — Asignación

Se asigna la recepción a quien la va a trabajar (`POST /api/samples/reception/:id/asignaciones`): **1 fila** en `asignaciones_muestra`. **Bitácora:** `asignar_muestra`. (Quien tiene permiso «solo asignadas» ve únicamente las recepciones que tienen una asignación vigente a su nombre.)

### Paso 3 — Procesamiento

| Qué se crea o cambia | Detalle |
| --- | --- |
| **1 fila** en `muestras_procesamiento` | Folio serie P, `recepcion_id` apuntando a la recepción (el sistema exige que esté aceptada). |
| `muestras_recepcion.estado` | Avanza a `en_procesamiento` (solo hacia adelante; nunca retrocede). |
| Inventario | Si el formato declara insumos (`uso_inventario_json`): por cada uno, **1 fila** en `movimientos` (`salida`, `referencia` = `PROC-<id>-INS-<n>`) y se **resta** de `reactivos.cantidad_actual` o `consumibles.piezas`. |
| **Bitácora** | `crear` sobre `muestras_procesamiento`. |

### Paso 4 — Extracción (con el descuento del inventario)

| Qué se crea o cambia | Detalle |
| --- | --- |
| **1 fila** en `muestras_extraccion` | `tipo_registro` = `E-D` (DSP). Su folio es independiente del de las extracciones `E-A`. `procesamiento_id` apunta al procesamiento. Los equipos usados quedan en `equipos_json`. |
| Estados | `muestras_procesamiento.estado` → `en_proceso`; `muestras_recepcion.estado` → `en_extraccion`. |
| **Descuento del inventario** | Por cada reactivo o consumible: `UPDATE reactivos SET cantidad_actual = cantidad_actual − X` y **1 fila** en `movimientos` (`tipo = 'salida'`, `referencia = 'EXT-<id>-INS-<n>'`, `motivo = 'Extraccion E-D folio N'`, `id_usuario`). La `referencia` es única: sirve para que reintentar el guardado no descuente dos veces. |
| Suspensiones | Si el método o un equipo está suspendido por una no conformidad (`suspensiones`), el guardado se rechaza con 409. |
| **Bitácora** | `crear` (y después `editar` con el antes y el después si se modifica). |

### Paso 5 — Análisis (con evidencia)

| Qué se crea o cambia | Detalle |
| --- | --- |
| **1 fila** en `muestras_analisis` | Folio serie A, versión 1, `extraccion_id`, `recepcion_id`, método, equipo, condiciones, resultados y controles de calidad en columnas `*_json`. La recepción pasa a `en_analisis`. |
| **Evidencia** | Se sube el archivo del cromatograma o reporte: se guarda en `instance/evidencias/analisis/<id del análisis>/<uuid>.<ext>` y se inserta **1 fila** en `adjuntos` con su `sha256`. **Bitácora:** `adjuntar`. Si la configuración lo exige (`EVIDENCIA_OBLIGATORIA_ANALISIS`), no se puede enviar a revisión sin al menos una evidencia vigente. |
| Enviar a revisión | `estado` → `en_revision`; la recepción → `en_revision_tecnica`. **Bitácora:** `enviar_revision`. |
| Revisar | `estado` → `revisado` (persona, cargo, fecha, firma). **Bitácora:** `revisar`. Quien elaboró el análisis no puede revisarlo ni aprobarlo (separación de funciones), salvo una excepción aprobada por un segundo usuario. |
| Aprobar | `estado` → `aprobado`. La extracción pasa a `analizada` y el procesamiento a `completada`. Cuando **todos** los análisis vigentes de la recepción están aprobados, la recepción queda `validada`. **Bitácora:** `aprobar`. Requiere reconfirmar la contraseña (fila temporal en `reautenticaciones`). |
| Corregir algo ya aprobado | Se hace una **enmienda**: se crea otra fila con el mismo `folio_num` y `version` + 1, `sustituye_a` = la original, y la original pasa a `sustituido`. Los informes que ya la incluían quedan marcados «requiere enmienda». |

### Paso 6 — Informe

| Qué se crea o cambia | Detalle |
| --- | --- |
| **1 fila** en `informes` | Estado `borrador`, folio serie IR, versión 1, `recepcion_id`, y la lista de análisis incluidos en `analisis_ids_json`. La recepción pasa a `informe_elaborado`. |
| Revisar | `estado` → `en_revision` (firma de quien revisa). **Bitácora:** `revisar`. |
| Autorizar | `estado` → `autorizado` (firma de quien autoriza, con reautenticación). Todavía no hay PDF final. **Bitácora:** `autorizar`. |
| **Liberar** | `estado` → `liberado`; `resultados_json` se **congela** con los datos de los análisis; se genera el PDF en `instance/informes/IR-0000028-v1.pdf`; se guardan `archivo_pdf` y `pdf_sha256` (la huella); la recepción pasa a `liberada`. Si un informe retenido por una no conformidad existe, no se libera. **Bitácora:** `liberar` (con la huella en el detalle). |

### Paso 7 — Envío

El envío se registra con su evidencia (`POST /api/informes/:id/envios`).

| Qué se crea o cambia | Detalle |
| --- | --- |
| **1 fila** en `envios_informe` | Destinatario, correo, fecha y hora, medio (manual o por la plataforma), y el archivo de evidencia guardado en `instance/informes/envios/` con su `evidencia_sha256` (o el `message_id` si se envió por SMTP). |
| `informes.estado` | `liberado` → `enviado` (solo el primer envío; los reenvíos agregan filas sin cambiar el estado). |
| **Bitácora** | `enviar`, con el correo **parcialmente oculto** (por ejemplo `h***@dominio.gob.mx`). La confirmación posterior del cliente deja `confirmar_envio`. |

### Paso 8 — Cierre

Cuando el laboratorio decide qué hacer con los remanentes de la muestra (`POST /api/samples/reception/:id/disposicion`): se guarda `disposicion_json`, se anota `estado_antes_cierre` y la recepción pasa a `cerrada`. **Bitácora:** `cerrar`. Una recepción cerrada o rechazada puede **reabrirse** con motivo (vuelve al estado anterior y también queda en la bitácora).

> **Resumen del rastro.** De la recepción al cierre se escriben, como mínimo: 1 fila en recepción, 1 en procesamiento, 1 en extracción, 1 en análisis (+1 en adjuntos por cada evidencia), 1 en informes, 1 en envíos, los movimientos de inventario que correspondan, y **una entrada de bitácora por cada acción** (crear, aceptar, asignar, revisar, aprobar, autorizar, liberar, enviar, cerrar…).

---

## 5. Folios y estados

### 5.1 Cómo se generan los folios

**En palabras simples.** El folio es el «número de expediente» de cada registro (por ejemplo `R 0000605`). Se asigna solo: es el último número de esa serie más uno. El problema es qué pasa si dos personas guardan exactamente al mismo tiempo; el sistema lo resuelve con una regla de unicidad en la base y reintentos.

| Serie | Qué es | Tabla | Cómo se calcula | Restricción única |
| --- | --- | --- | --- | --- |
| `R` | Recepción | `muestras_recepcion` | `MAX(folio_num) + 1` | `folio_num` |
| `P` | Procesamiento | `muestras_procesamiento` | `MAX(folio_num) + 1` | `folio_num` |
| `E-A` | Extracción ASP | `muestras_extraccion` | `MAX(folio_num) + 1` **solo entre las de ese `tipo_registro`** | (`tipo_registro`, `folio_num`) |
| `E-D` | Extracción DSP | `muestras_extraccion` | igual, serie propia | (`tipo_registro`, `folio_num`) |
| `A` | Análisis | `muestras_analisis` | `MAX(folio_num) + 1` | (`folio_num`, `version`) |
| `IR` | Informe | `informes` | `MAX(folio_num) + 1` | (`folio_num`, `version`) |
| `INC` | Incidencia | `incidencias` | `MAX(folio_num) + 1` | `folio_num` |
| `NC` | No conformidad | `no_conformidades` | `MAX(folio_num) + 1` | `folio_num` |

- **Cómo se muestra:** un prefijo y siete dígitos, `R 0000605`. La función única es `formatearFolio` (`src/lib/shared/folios.ts`).
- **Cómo se evita repetirlos:** el cálculo `MAX + 1` ocurre **dentro de la transacción**; si dos procesos eligen el mismo número, el segundo choca con la restricción única, se deshace y la petición **se repite** (hasta 3 veces) con un número nuevo (sección 2.4). Dentro de un mismo proceso, las sesiones ya van en serie y no ocurre.
- Si el formulario manda un folio explícito, se respeta; si ya existe, la respuesta es 409 «El folio ya existe». Lo normal es dejar que el servidor lo asigne.
- Los folios de análisis e informes son (folio, versión): una **enmienda** conserva el folio y sube la versión (`A 0000120 v2`, `IR 0000028 v2`).
- Un folio se puede **cambiar a mano** solo en la recepción, con motivo y con la aprobación de un segundo usuario (queda en la bitácora como `cambiar_folio`).
- El código automático de los reportes de mantenimiento (`RM-<mantenimiento>-<n>`) usa la misma lógica con su restricción única.

### 5.2 Cómo se guardan y avanzan los estados

**En palabras simples.** El estado es una palabra en la columna `estado` de cada registro («registrada», «aprobado», «liberado»…). Avanza solo hacia adelante, y al avanzar un registro empuja también el estado de la etapa anterior.

**Detalle técnico** (`samples-flow.ts`, `sgc.ts`):

| Registro | Estados (en orden) | Notas |
| --- | --- | --- |
| Recepción | `registrada` → `aceptada` / `aceptada_con_desviacion` / `rechazada` → `en_procesamiento` → `en_extraccion` → `en_analisis` → `en_revision_tecnica` → `validada` → `informe_elaborado` → `liberada` → `cerrada` (más `anulada`) | Cada estado tiene un «rango»; `advanceState` solo cambia si el nuevo rango es **mayor**. No se retrocede automáticamente. Solo `reabrir` (con motivo) saca una recepción de `cerrada` o `rechazada`. |
| Procesamiento y extracción | `registrada` → `en_proceso` → `completada` / `analizada` (más `anulada`) | Avanzan solos cuando existe la etapa siguiente. |
| Análisis | `registrado` → `en_revision` → `revisado` → `aprobado` (más `anulado`, `sustituido`) | «Devolver» regresa de `en_revision` a `registrado` con observaciones. |
| Informe | `borrador` → `en_revision` → `autorizado` → `liberado` → `enviado` (más `sustituido`, `anulado`) | `entregado` es un valor anterior a la Fase 6 que el servidor trata como «enviado». |
| Incidencia | `reportada` → `en_evaluacion` → `cerrada_sin_nc` / `escalada_a_nc` (más `anulada`) | |
| No conformidad | `abierta` → `en_analisis` → `acciones_en_curso` → `en_verificacion` → `cerrada` (más `anulada`) | Solo hacia adelante; si la verificación resulta «no eficaz» regresa a `en_analisis` y suma `reaperturas`. |

- Un registro en estado «bloqueado» (`anulada`, `rechazada`, `cerrada`, `liberada` en recepciones; `aprobado` en análisis) **ya no se edita**.
- Las transiciones de calidad usan `UPDATE … WHERE estado = :actual` (y `FOR UPDATE` en MySQL) para que dos personas no hagan la misma transición a la vez.
- El estado es un **texto libre** en la base (no hay una tabla de estados ni restricciones `CHECK`): los valores válidos viven en el código.

---

## 6. «Nada se borra»

**En palabras simples.** FICOTOX sigue la idea de los laboratorios acreditados (ISO/IEC 17025): un registro técnico nunca desaparece. Si hay un error, se **anula con un motivo** y queda a la vista que se anuló, quién lo hizo y por qué. El historial de lo que cambió siempre se puede consultar. Lo que ve la persona: una etiqueta «Anulada», «Baja», «Revocado» o «Sustituido», y en la ventana de detalle el motivo.

### 6.1 Qué mecanismo usa cada cosa

| Situación | Cómo se maneja | Columnas |
| --- | --- | --- |
| **Anular** un registro técnico (recepción, procesamiento, extracción, análisis, informe, incidencia, NC, adjunto) | El estado pasa a `anulada`/`anulado`; se guarda el estado anterior para poder **restaurar** | `estado_previo`, `anulado_en`, `anulado_por`, `anulado_rol_id`/`anulado_cargo`, `motivo_anulacion` (mínimo 5 caracteres) |
| Anular algo **ya avanzado** (aceptada, en proceso, aprobado, liberado…) | No se anula directo: se crea una **solicitud** que debe aprobar un segundo usuario; mientras esté pendiente el registro no se edita | `solicitudes_autorizacion` |
| **Dar de baja** un reactivo, consumible o equipo | `activo = 0`; no se puede elegir de nuevo, pero los registros históricos que lo usaron siguen válidos. Se puede **reactivar**. | `activo`, `baja_motivo`, `baja_en`, `baja_por` |
| **Revocar** un rol, una asignación de muestra o una autorización | Se llena la fecha de revocación; la fila queda | `revocado_en`, `revocado_por`, `motivo_revocacion` (en `usuario_roles`, `asignaciones_muestra`, `autorizaciones_personal`) |
| Rol o autorización que **vence** | El barrido (una vez por minuto) lo anota en la bitácora una sola vez | `vigente_hasta`, `vencimiento_registrado_en` |
| **Dar de baja** una cuenta | `usuarios.activo = 0` y `token_version` + 1 (cierra sus sesiones abiertas). La cuenta y su historial quedan. | `activo`, `token_version` |
| **Revisiones** de Documentos SGC | Cada revisión es una fila nueva en `sgc_revisiones`; la anterior pasa a obsoleta y conserva su archivo, sus aprobaciones y su fecha de sustitución | `numero`, `sustituida_por_id` |
| **Versiones** de la Biblioteca retirada (historial) | Cada subida es una fila nueva en `biblioteca_versiones` (`numero` + 1); la anterior se conserva y se puede abrir | `version_actual_id`, `numero` |
| **Archivar** un documento | `archivado_en`, `archivado_por`, `motivo_archivo` | |
| **Enmiendas** de análisis e informes | Una fila nueva con el mismo folio y `version` + 1; la original queda `sustituido` y el PDF anterior se conserva marcado | `sustituye_a`, `motivo_enmienda`, `version` |
| Un **adjunto** equivocado | Se anula con motivo; el archivo **se conserva** en disco | `anulado_en`, `motivo_anulacion` |
| **Retirar** funcionalidad | Las tablas y los archivos quedan (sección 3.8) | — |

### 6.2 Lo que ve la persona

Los registros anulados no aparecen en las listas por omisión; con «Mostrar anuladas» se ven, con su insignia y el motivo en la ventana. Cada anulación, restauración, baja o revocación queda en la bitácora con **el antes y el después**.

### 6.3 Las excepciones técnicas (hay `DELETE` en el código)

Para ser fieles al código, estos son **todos** los `DELETE` que existen fuera de las migraciones:

| Qué se borra | Por qué | ¿Afecta la regla «nada se borra»? |
| --- | --- | --- |
| Filas de `movimientos` de tipo `salida` cuando se **anula** o se **reedita** un registro (`restoreInventoryUsage`) | Al anular una extracción, el sistema **repone** el inventario (suma la cantidad de vuelta) y **elimina** esos movimientos de salida, en vez de dejar un movimiento de entrada compensatorio. | **Sí, en parte**: el movimiento desaparece de `movimientos`. Lo que queda es la entrada de bitácora de la anulación con el dato `movimientos_repuestos` (cuántos se repusieron). **No está claro en el código** si es una decisión deliberada para dejar el libro de movimientos limpio; conviene tenerlo presente al auditar existencias. |
| `rol_acciones` de un rol, para reescribir sus permisos o al eliminar un rol | Los permisos se guardan reescribiendo la lista completa. | Los cambios de permisos de un rol quedan en la bitácora (con motivo). |
| `roles` (y sus permisos) | Solo se elimina un rol **que nunca se asignó**; uno que alguna vez se usó solo se desactiva. | No: lo que se borra no tiene historial. Queda la entrada `eliminar`. |
| `biblioteca_visibilidad_roles` de un documento | Se reescribe la lista de roles que lo ven. | No (es configuración; el cambio queda en la bitácora). |
| `busqueda_recientes` y `notificaciones_leidas` | Datos de comodidad (recientes del buscador, avisos leídos). Se purgan los viejos. | No: no son registros técnicos. |
| El archivo de una evidencia **si la transacción falla** | Evita archivos huérfanos (`descartarArchivo`). | No: el registro nunca llegó a existir. |

Además, **las filas sí se modifican** (`UPDATE`): la base guarda siempre el estado *actual*; el historial está en la bitácora (antes/después de cada cambio), no en copias de la fila.

---

## 7. La bitácora de auditoría

**En palabras simples.** La bitácora es el cuaderno donde el sistema anota, renglón por renglón, quién hizo qué y cuándo. Dos protecciones la hacen confiable: (1) la base **no deja** editar ni borrar sus renglones, y (2) cada renglón lleva un **sello** que depende del renglón anterior, de modo que cambiar uno solo rompe todos los que siguen — igual que si cada hoja del cuaderno llevara escrita una firma de la hoja de atrás.

### 7.1 Qué guarda cada entrada

Una fila de `auditoria`:

| Columna | Contenido |
| --- | --- |
| `fecha_hora` | Instante en UTC, en formato ISO (`2026-10-09T02:53:45.871Z`). |
| `usuario_id`, `usuario_nombre`, `usuario_email` | Quién actuó (nulos si fue el sistema: «sistema»). |
| `accion` | Qué hizo: `crear`, `editar`, `anular`, `revisar`, `aprobar`, `autorizar`, `liberar`, `enviar`, `login`, `asignar_rol`, `alerta_integridad`, `migrar`, etc. |
| `entidad`, `entidad_id`, `referencia` | Sobre qué: la tabla, el id y el folio legible (`R 0000605`). |
| `motivo` | La justificación, cuando se pide. |
| `cambios_json` | Campo por campo: `{ "estado": { "antes": "registrada", "despues": "aceptada" } }`, más un `_detalle` con datos extra (por ejemplo, con qué cargo actuó). |
| `datos_anteriores_json`, `datos_nuevos_json` | La fila completa antes y después. |
| `hash_anterior`, `hash` | El sello de la entrada anterior y el sello de ésta. |

Qué se **excluye** o se **recorta** de lo guardado: nunca `password_hash`; no los campos que cambian solos en cada guardado (`creado_en`, `actualizado_en`, `creado_por`, `actualizado_por`); las imágenes de firma se reemplazan por la marca `[firma]`; una edición sin cambios reales no deja entrada.

### 7.2 Cómo funciona la cadena de sellos

Cada entrada se sella con **HMAC-SHA256**: una función que mezcla el contenido con una llave secreta y produce una huella de 64 caracteres. El contenido que se sella incluye `hash_anterior`, es decir, el sello de la entrada anterior.

**Ejemplo con tres renglones** (los sellos son ficticios y cortos):

```
Entrada 1: "Ana creó R 0000605"      hash_anterior = (vacío)     hash = A1F3…
Entrada 2: "Luis asignó R 0000605"   hash_anterior = A1F3…       hash = 7C20…
Entrada 3: "Ana aprobó A 0000120"    hash_anterior = 7C20…       hash = D44B…
```

Si alguien cambia la entrada 2 (por ejemplo, el nombre de quien asignó):

- Su sello recalculado ya no daría `7C20…`, así que la verificación se detiene ahí: «la entrada 2 fue alterada».
- Aunque quien lo cambió recalculara también el sello de la entrada 2, la entrada 3 guarda `hash_anterior = 7C20…`; el sello nuevo no coincidiría, y habría que recalcular todas las siguientes.
- **Recalcularlas todas es imposible sin la llave**: el HMAC necesita la llave secreta, que **no está en la base**. Quien solo tenga el archivo de la base no puede forjar una cadena válida.

El texto que se sella usa JSON con las claves en orden (`stableJson`) para que el sello sea idéntico en el servidor, en los scripts y en cualquier motor. Por eso una base pasada de SQLite a MySQL conserva los mismos sellos.

### 7.3 Qué impide modificarla o borrarla

- **Dos triggers en la base** (`auditoria_sin_update` y `auditoria_sin_delete`) abortan cualquier `UPDATE` o `DELETE` sobre la tabla (mensajes «La bitacora de auditoria no se modifica / no se elimina»). Los crea la migración 9.
- El servidor los **repone solo**: en cada escritura de bitácora y en cada verificación comprueba que sigan los dos y, si falta alguno, lo recrea.
- Quien tenga acceso directo al archivo de la base **puede** quitar los triggers y editar; precisamente para eso existe el sello: no impide el cambio, **lo vuelve detectable**.

### 7.4 La llave

La llave del sello es, en este orden:

1. `SECRET_KEY` del `.env`, si está definida y **no** es el valor de desarrollo (`ficotox-dev-secret`).
2. Si no, el archivo **`instance/auditoria.key`**: una llave aleatoria de 32 bytes que se crea la primera vez y se guarda con permisos solo para el usuario del sistema.

Reglas:

- **Se genera una sola vez y no se cambia nunca.** `npm run configurar` jamás reemplaza una `SECRET_KEY` existente.
- El sistema **solo advierte** (nunca bloquea) si la llave es corta (< 32 caracteres) o si falta `SECRET_KEY` y se usa el archivo.
- La **huella** de la llave (los primeros caracteres de su SHA-256, nunca la llave) se registra en `instance/llave-bitacora.huella` para que `verificar-instalacion` compruebe que la llave actual es la misma.
- **Guardar una copia fuera de la computadora** (gestor de contraseñas institucional o sobre cerrado). El respaldo local la lleva aparte en `llave/`, pero una copia que viaja con el respaldo no protege contra quien robe ese respaldo.

### 7.4.1 Qué pasa si la llave se pierde o cambia

La bitácora ya escrita **no se puede verificar**: los sellos se recalculan con otra llave y no coinciden desde la primera entrada. Los datos siguen intactos y el sistema sigue funcionando, pero el sistema lo interpreta como un posible cambio no autorizado (alerta e incidencia) y no se puede demostrar la integridad. Hay que restaurar la llave original (de la copia externa); **no generar una nueva**. Ver sección 16.

### 7.5 Cómo se verifica la integridad

La verificación (`verifyAuditChain` + `evaluarCadena`) hace cuatro comprobaciones:

1. **Cada sello coincide**: recalcula el HMAC de cada entrada y compara con su `hash`, y comprueba que `hash_anterior` sea el `hash` de la entrada previa. Devuelve `primer_error`: el id de la primera entrada alterada.
2. **No faltan entradas al final**: compara el último id que dio la base (`sqlite_sequence`) con el último id presente; si el primero es mayor, se borraron las últimas filas.
3. **No hay huecos en medio**: los ids son consecutivos; un hueco significa una entrada borrada.
4. **Los dos triggers siguen presentes.**

Cuándo corre:

- En segundo plano cada vez que alguien con permiso abre la pantalla **Auditoría**.
- Con `npm run verificar-instalacion` (renglón «Integridad de la bitácora»).
- En la **restauración** de un respaldo (verificación 5) y al pasar a MySQL.

**Qué pasa si falla:**

1. Se escribe **una entrada `alerta_integridad`** en la propia bitácora (una sola vez por cada hecho, identificado por su «clave de alteración»).
2. Se crea una **incidencia automática** de Calidad («La verificación automática detectó un posible cambio no autorizado…»).
3. Mientras esa incidencia esté abierta, el Inicio y la campana muestran un aviso rojo.
4. **El sistema no se detiene**: sigue operando. La decisión de qué hacer es humana (sección 16).

---

## 8. Archivos fuera de la base

**En palabras simples.** Los documentos grandes viven como archivos comunes en carpetas. La base guarda de cada uno su nombre y una **huella digital** (SHA-256: un número de 64 caracteres calculado a partir del contenido). Si alguien cambia el archivo aunque sea en un punto, la huella ya no coincide y el sistema lo avisa.

### 8.1 Carpetas dentro de `instance/`

| Carpeta | Qué contiene | Cómo se liga a la base |
| --- | --- | --- |
| `informes/` | PDF finales de los informes (`IR-0000028-v1.pdf`) | `informes.archivo_pdf` + `informes.pdf_sha256` |
| `informes/envios/` | Evidencia de cada envío por correo | `envios_informe.evidencia_archivo` + `evidencia_sha256` |
| `evidencias/<entidad>/<id>/` | Evidencias adjuntas (de análisis, incidencias, acciones correctivas), con nombre de archivo aleatorio | Tabla `adjuntos` (`nombre_almacenado`, `sha256`) |
| `sgc/<documento>/<revisión>/` | Archivos de Documentos SGC (fuente y PDF de consulta) | `sgc_archivos.nombre_almacenado` + `sha256` |
| `biblioteca/` | Archivos de la Biblioteca retirada (sin uso) | `biblioteca_versiones.nombre_almacenado` + `sha256` |
| `calidad/nc/` | PDF «Registro de no conformidad» al cerrar una NC | `no_conformidades.archivo_pdf` + `pdf_sha256` |
| `avatares/<usuario>/` | Fotos de perfil (dos tamaños, WEBP) | `usuarios.foto` / `usa_foto` |
| `maintenance_reports/` | Reportes de mantenimiento | `reportes_mantenimiento.archivo_url` |
| `documentos_sgc/` | Archivos del flujo anterior de Documentos SGC (solo lectura) | `documentos_sgc.archivo_nombre` + `archivo_sha256` |
| `auditoria.key` | La llave de la bitácora (si no se usa `SECRET_KEY`) | — (no está en la base) |
| `llave-bitacora.huella` | Huella (no la llave) para verificar que la llave sea la misma | — |
| `logs/`, `verificaciones/`, `servicio/`, `tls/`, `servidor.lock`, `lanzador.lock`, `detener` | Operación del servidor (registros, reportes, definición del servicio, certificados, candados) | — |

La carpeta `instance/` completa **no se versiona en git**.

### 8.2 Cómo se escribe un archivo

- Los adjuntos y los archivos de la Biblioteca se escriben en un **archivo temporal** en la misma carpeta, calculando el SHA-256 mientras se escribe, y se **renombran** al final (operación atómica). El nombre almacenado es aleatorio; el nombre original solo se guarda como dato saneado y **nunca** se usa como ruta. Toda ruta se valida para que no salga de su carpeta.
- Si la transacción de la base falla después de escribir un adjunto, el código elimina ese archivo (`descartarArchivo`).
- El PDF de un informe se escribe en disco **durante** la transacción de liberación, antes del `commit`. **No está claro en el código** que se limpie ese PDF si la transacción falla justo después; en ese caso quedaría un archivo sin fila que lo refiera (inofensivo, pero «huérfano»).

### 8.3 Cómo se verifica la huella SHA-256

Cada vez que se **abre o descarga** un archivo se recalcula su SHA-256 y se compara con el guardado, con tres resultados posibles:

- **ok**: coincide.
- **alterado**: el archivo existe pero su contenido cambió.
- **faltante**: la base lo menciona pero el archivo no está.

Si no es «ok», se **registra una alerta** (`alerta_integridad`) en la bitácora y se crea una **incidencia automática** (una sola vez por hecho, aunque se repita la consulta). Ejemplo: el PDF de un informe; el visor de informes y la descarga hacen esta comprobación. En Documentos SGC, al abrir o descargar un archivo se verifica igual; en la **restauración de un respaldo** (verificación 7) se comprueban de golpe los PDF de informes, las evidencias, los adjuntos, los **archivos de Documentos SGC**, los archivos heredados (flujo anterior y Biblioteca retirada) y los PDF de NC.

Un caso especial: cuando se enmienda un informe, el PDF del informe original se **vuelve a generar** marcado como «sustituido» y su huella se actualiza (porque el cambio es legítimo y está en la bitácora).

---

## 9. Fechas y horas

**En palabras simples.** Hay dos tipos de fecha: las que **no tienen hora** («la muestra se recibió el 8 de octubre») y las que **sí** («Ana aprobó el análisis el 8 de octubre a las 7:53 de la tarde»). La base guarda las primeras como texto tal cual y las segundas en hora universal (UTC). La pantalla muestra todas en la **hora del laboratorio (Ensenada, zona `America/Tijuana`)**, sin importar dónde esté el navegador o el servidor.

### 9.1 Cómo se guardan

| Tipo | Ejemplo guardado | Dónde |
| --- | --- | --- |
| **Fecha sin hora** (texto `AAAA-MM-DD`) | `2026-09-20` | `fecha_recepcion`, `fecha_emision`, `vigente_desde`, `caducidad`, `fecha_compromiso`… (columnas `DATE` o `VARCHAR(10)`; en SQLite los tipos no obligan, así que son texto) |
| **Hora suelta** (texto) | `14:30` | `hora_recepcion`, `hora_extraccion`… (`VARCHAR`) |
| **Instante en ISO con `Z`** | `2026-10-09T02:53:45.871Z` | Casi todas las columnas `*_en` y `fecha_hora` de la bitácora: el código escribe `new Date().toISOString()` |
| **Instante sin zona** (`AAAA-MM-DD HH:MM:SS`) | `2026-10-09 02:51:40` | Columnas `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` (por ejemplo `creado_en` en `movimientos` y `usuarios`). SQLite y MySQL los escriben en **UTC**. |

Por eso, si miras la base directamente, **las horas con hora se ven 7 u 8 horas «adelantadas»** respecto a la pared del laboratorio (Tijuana está en UTC−7 en verano y UTC−8 en invierno). `2026-10-09T02:53:45Z` es el **8 de octubre a las 19:53** en Ensenada.

### 9.2 Cómo se muestran y por qué

La regla está concentrada en un solo archivo (`src/lib/shared/fechas.ts`):

- Una **fecha sin hora nunca pasa por `new Date`**. JavaScript la interpretaría como medianoche UTC y la mostraría **un día antes** en Ensenada. Por eso se trata como texto y solo se reordena (`dd/mm/aaaa`).
- Un **instante** se convierte siempre a `America/Tijuana` con `Intl.DateTimeFormat`, no con la zona del navegador ni la del servidor. Así dos personas en computadoras con zonas distintas ven lo mismo y las firmas, folios y fechas de informe coinciden.
- Las consultas «desde / hasta» por día convierten el día local a los instantes UTC de su inicio y fin (`inicioDiaLocal`, `finDiaLocal`) antes de comparar con las columnas de instante.
- En MySQL, cada conexión fija `time_zone = '+00:00'` para que se comporte igual que SQLite.

> **Para quien consulta la base a mano:** convierte las horas con `datetime(columna, '-7 hours')` solo como aproximación; el cambio de horario de verano hace que a veces sean 8 horas. La conversión correcta la hace la aplicación.

---

## 10. Seguridad de los datos

### 10.1 Contraseñas

- **Nunca se guarda la contraseña**, solo su *hash* con **scrypt** (`password.ts`): formato `scrypt$<costo N=16384>$<sal>$<hash>`, sal aleatoria de 16 bytes y 64 bytes de resultado, comparación en tiempo constante.
- Reglas: al menos **10 caracteres** y distinta del correo y del nombre.
- Las contraseñas temporales se muestran **una sola vez** y obligan a cambiarlas al primer acceso (`debe_cambiar_password`).
- Tras demasiados intentos fallidos se bloquea la cuenta (`bloqueado_hasta`) y la dirección IP (tabla `intentos_acceso`); cada bloqueo se anota en la bitácora.
- Los **tokens de reautenticación** (`reautenticaciones.token_hash`) y de firma (`firmas_tokens.token_hash`) se guardan **solo como hash**; el token real solo existe en la respuesta que se entrega a la persona. Los de reautenticación vencen en minutos (`REAUTH_TTL_MIN`, 5 por omisión) y son de un solo uso.

### 10.2 Qué datos se ocultan en la bitácora

- `password_hash`: nunca se registra.
- Las imágenes de firma: se reemplazan por `[firma]`.
- Los correos de destinatarios de informes: parcialmente ocultos (`h***@dominio`).
- **Quién puede ver el historial:** una persona ve el detalle (`antes`, `después`, `cambios`) de una entrada solo si su rol puede **ver el módulo** de ese registro, y en muestras solo si su alcance no es «solo estado». En calidad, el detalle y el motivo de incidencias y no conformidades solo se entregan con permiso total de calidad. Así el alcance de un módulo no se esquiva leyendo la bitácora.

### 10.3 Qué nunca se guarda en la base (secretos)

- Contraseñas en claro, ni llaves.
- `JWT_SECRET` (firma las sesiones; vive en `.env`), la contraseña SMTP, y la llave de la bitácora (`SECRET_KEY` en `.env` o `auditoria.key`): **fuera de la base**.
- Las sesiones no se guardan en la base: el *token* (JWT) identifica a la persona; `usuarios.token_version` permite invalidarlas todas de golpe. Los roles y permisos se consultan **de la base en cada petición**, así que revocar un rol o vencerlo tiene efecto inmediato.
- El respaldo incluye solo la llave de la bitácora (en `llave/`), **nunca** `JWT_SECRET`, SMTP ni otros secretos del `.env`.
- Los archivos de respaldo y de instancias restauradas se crean con permisos solo para el usuario del sistema (en sistemas tipo Unix: archivos 600, carpetas 700).

### 10.4 Quién puede ver qué

**Los permisos se aplican en el servidor**, nunca solo en la pantalla:

- Cada ruta de la API llama a `requirePermission(módulo, acción, contexto)`. Un permiso ausente es «no concedido»; el arranque no inventa permisos.
- El **alcance** de cada permiso limita qué filas se entregan: el servidor filtra en la consulta SQL (por ejemplo, «incidencias propias», «muestras asignadas», «solo estado»). Lo ajeno responde igual que lo inexistente (404) para no revelar que existe.
- Las acciones críticas piden **reconfirmar la contraseña** y, algunas, **la aprobación de un segundo usuario** (separación de funciones: quien capturó no revisa, quien revisó no aprueba…).
- Una persona con varios roles actúa con el cargo que elige, y ese cargo queda guardado en cada firma (`*_cargo`).

---

## 11. Migraciones

**En palabras simples.** Una *migración* es una instrucción numerada que dice «a la base de la versión N−1 agrégale esta tabla, esta columna o este índice, para que quede en la versión N». Todas las instalaciones aplican las mismas migraciones en el mismo orden, así que **todas terminan con exactamente la misma estructura**, y la base sabe en qué versión está. Es como los capítulos de un libro de instrucciones: nunca se reescribe un capítulo ya aplicado, solo se agregan capítulos al final.

### 11.1 Las migraciones que existen

Están en `src/lib/server/migraciones/` y se registran en `motor.mjs`:

| Versión | Qué agrega |
| --- | --- |
| 9 | Esquema base (el de la Fase 9: usuarios, roles, muestras, informes, inventario, bitácora y sus triggers…) |
| 10 | Tabla `adjuntos` (evidencia instrumental) |
| 11 | Incidencias, no conformidades y acciones correctivas (y sus tablas) |
| 12 | `firmas_tokens` (antes se creaba al primer uso) |
| 13 | Biblioteca de documentos (copia los documentos del flujo anterior) |
| 14 | Preferencia de tema (`usuarios.tema`) |
| 15 | `notificaciones_leidas` |
| 16 | Foto de perfil (`usuarios.foto`, `usa_foto`) |
| 17 | `busqueda_recientes` |
| 18 | Permisos del módulo «Respaldos» (Calidad › Respaldos): solo datos en `rol_acciones`, sin cambios de estructura |
| 19–21 | Campos de inventario, unidades de consumibles y ajustes de permisos (usuarios:A, Biblioteca) |
| 22 | Documentos SGC: catálogos de áreas y tipos, fichas, revisiones (una vigente), archivos inmutables tras enviar a revisión, tablas de las fases 2 y 3 y acciones documentales en `rol_acciones` (retira los permisos de la Biblioteca) |
| 23 | Documentos SGC, flujo de aprobación: fecha límite, revisión/autorización/cancelación y «sustituida por» en `sgc_revisiones`; papel en `sgc_flujo_acciones`; clave asignada en `sgc_solicitudes`; tabla `sgc_renovaciones` |
| 24 | Documentos SGC, externos y lectura controlada: `version_externa` en `sgc_revisiones`, motivos de alta y retiro en `sgc_distribucion`, `abierto_en` en `sgc_lecturas` e índice de lecturas por usuario |
| 25 | Reporte PDF de mantenimiento: `nombre_almacenado`, `nombre_original`, `tamano_bytes`, `sha256`, `subido_por`, `anulado_en`, `anulado_por`, `motivo_anulacion` y `reemplazado_por` en `reportes_mantenimiento`, e índice por mantenimiento |

(Empiezan en la 9 para coincidir con los respaldos anteriores, que usaban 10 y 11 como número de esquema.)

### 11.2 Una migración es datos, no código

Cada migración es una **lista de pasos declarativos** (`pasos.mjs`), con un SQL para SQLite y otro para MySQL:

| Paso | Qué hace |
| --- | --- |
| `tabla` | `CREATE TABLE` (solo si no existe) |
| `indice` | `CREATE [UNIQUE] INDEX` (solo si no existe) |
| `columna` | `ALTER TABLE … ADD COLUMN` (solo si no existe) |
| `trigger` | `CREATE TRIGGER` (solo si no existe) |
| `catalogo` | Inserta o actualiza filas de un catálogo por su clave |

Cada paso **comprueba si ya se hizo** antes de hacerlo, así una migración interrumpida se puede reanudar.

### 11.3 La tabla de control y la huella

La tabla `schema_migraciones` tiene una fila por migración aplicada: `version`, `nombre`, `checksum`, `aplicada_en`, `duracion_ms`, `app_commit` (la versión del programa) y `modo`.

- El **checksum** es el SHA-256 del contenido de la migración (`version`, `nombre` y sus pasos). Es la «huella» de la migración **tal como se aplicó**.
- Si al arrancar el checksum de una migración ya aplicada **no coincide** con el del código, el servidor **no arranca** («La migración N cambió después de aplicarse»). Es la protección contra editar migraciones viejas.
- Si la base está en una versión **más nueva** que la aplicación, tampoco arranca («actualiza la aplicación»).
- `schema_migraciones_bloqueo` tiene una sola fila que se «toma» con un `UPDATE` atómico mientras alguien migra, para que dos procesos no migren a la vez. Un bloqueo huérfano (el proceso ya no existe, o se tomó antes del último encendido de la computadora, o lleva más de 30 minutos) se libera solo.

### 11.4 Qué pasa al arrancar

El servidor llama a `migrarAlArrancar()` antes de atender peticiones:

1. Calcula el **estado**: `vacia` (sin tablas), `versionada` (con `schema_migraciones`) o `sin_versionar` (base anterior; ver 11.6).
2. Si hay migraciones pendientes y `MIGRAR_AL_ARRANCAR` no es `false` (por omisión es `true`):
   1. Toma un **respaldo previo** (`pre-migracion`, con la llave) en `backups/` — **solo si la base no está vacía**.
   2. Crea las tablas de control y toma el bloqueo.
   3. Aplica cada migración pendiente **en orden**, cada una en **su propia transacción** (en SQLite, hasta el DDL es transaccional).
   4. Por cada una, inserta su fila en `schema_migraciones` y deja una **entrada sellada en la bitácora** con actor «sistema» (`accion = 'migrar'`, `entidad = 'esquema'`).
3. Con `MIGRAR_AL_ARRANCAR=false`, si hay pendientes el servidor **no arranca** y pide correr `npm run migrar` con el servidor detenido.
4. En MySQL el respaldo previo lo debe hacer el administrador con `mysqldump` y declararlo con `MIGRAR_MYSQL_RESPALDO_HECHO=true`.

Comandos manuales: `npm run migrar -- --estado` (versión y pendientes), `--simular` (qué haría, sin cambiar nada) y sin opciones (aplicar).

### 11.5 Qué pasa si una migración falla

- **SQLite:** esa migración se **deshace por completo** (la base queda como estaba antes de ella). Las migraciones anteriores de la misma corrida **ya quedaron aplicadas** (cada una en su transacción). El servidor **no arranca** y el mensaje dice cuál falló y dónde quedó el respaldo previo.
- **MySQL:** el DDL se confirma solo; por eso cada paso comprueba si ya se hizo, y volver a correr **reanuda** donde se quedó.
- Para volver *exactamente* a como estaba antes de actualizar, se restaura el respaldo `pre-migracion` / `pre-actualizacion` (sección 12). **No hay migraciones «hacia atrás»**: volver es restaurar un respaldo.

### 11.6 Cómo se reconocieron las bases anteriores («baseline»)

Antes de las migraciones versionadas, el sistema creaba las tablas «al vuelo». Para instalaciones existentes, el motor **no ejecuta** las migraciones viejas: compara el esquema normalizado de la base (tablas, columnas con su tipo/valor por omisión, índices y triggers) con el que producirían las migraciones hasta la 11, la 10 o la 9 (aplicadas a una SQLite en memoria):

- Si coincide con una, esas migraciones se registran con `modo = 'baseline'` («línea base», sin ejecutarse), una entrada sellada lo anota en la bitácora, y se aplican las que falten.
- Si no coincide con ninguna, **se aborta con el reporte de diferencias** («deriva de esquema») **sin tocar la base**: alguien la modificó a mano o viene de otra instalación.
- Hay una tolerancia: tablas que el sistema anterior creaba al primer uso (`firmas_tokens`) pueden estar o no.

### 11.7 Cómo agregar una migración nueva, paso a paso

**Ejemplo:** guardar la «clave del lote» en cada extracción (una columna nueva `muestras_extraccion.lote_clave`) y una tabla nueva `lotes_reactivo`.

1. **Crea el archivo** `src/lib/server/migraciones/0022_lote_clave.mjs` con el número siguiente a la última (`0021`). Mira `0014_tema.mjs` o `0017_busqueda_recientes.mjs` como modelo. Debe exportar `version`, `nombre` y `pasos`, y la función `up` que ejecuta los pasos. Esquema de ejemplo:

   ```js
   // 0022_lote_clave.mjs (ejemplo; sigue la forma de 0014_tema.mjs)
   import { ejecutarPasos } from "./pasos.mjs";

   export const version = 19;
   export const nombre = "Clave de lote en extracciones y tabla de lotes de reactivo";
   export const pasos = [
     { tipo: "columna", tabla: "muestras_extraccion", columna: "lote_clave",
       sqlite: "VARCHAR(60) DEFAULT NULL", mysql: "VARCHAR(60) DEFAULT NULL" },
     { tipo: "tabla", nombre: "lotes_reactivo",
       sqlite: "CREATE TABLE lotes_reactivo (id INTEGER PRIMARY KEY AUTOINCREMENT, reactivo_id INT NOT NULL, lote VARCHAR(80) NOT NULL, creado_en VARCHAR(40) NOT NULL)",
       mysql:  "CREATE TABLE IF NOT EXISTS `lotes_reactivo` (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, reactivo_id INT NOT NULL, lote VARCHAR(80) NOT NULL, creado_en VARCHAR(40) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4" },
     { tipo: "indice", nombre: "idx_lotes_reactivo", tabla: "lotes_reactivo", columnas: ["reactivo_id"] },
   ];
   export async function up(db, motor) {
     await ejecutarPasos(db, motor, pasos);
   }
   ```

   *(Es un ejemplo ilustrativo; los nombres `lote_clave` y `lotes_reactivo` no existen en el proyecto. Copia la forma de una migración real, por ejemplo `0014_tema.mjs`.)*

2. **Regístrala** en `motor.mjs`: agrega el `import * as m0019 …` y súmala a la lista `MIGRACIONES`. `VERSION_ACTUAL` sube sola a 19 (es la versión de la última de la lista).
3. **Actualiza el código** que use la columna o tabla nuevas (los módulos del servidor y, si aplica, las listas de tablas de respaldo en `respaldo.mjs`: `TABLAS_PRINCIPALES` y `CARPETAS_ARCHIVOS`).
4. **Prueba** con una copia, nunca con la base real: `npm run migrar -- --simular` y `npm run migrar` sobre la copia; después `npm test` (hay pruebas de migraciones, esquema y línea base). `npm run test:mysql` si tienes un servidor MySQL de pruebas.
5. **Haz commit.** Al actualizar una instalación, `npm run actualizar` (o simplemente arrancar el servidor) respalda (`pre-migracion`), aplica la 19 y la deja en la bitácora.

### 11.8 Qué NO hacer

- **No modifiques una migración ya aplicada** (ni una coma): cambia su checksum y el servidor de cualquier instalación que ya la aplicó **no arrancará**. Si hay un error en una migración publicada, **se corrige con una migración nueva**.
- No cambies la estructura con herramientas gráficas ni con `ALTER TABLE` a mano: la base ya no coincidiría con ninguna versión conocida («deriva»).
- No pongas DDL (`CREATE`/`ALTER`) dentro de un handler de la API.
- No borres filas de `schema_migraciones`.

---

## 12. Respaldos y restauración, desde el punto de vista de la base

**En palabras simples.** Un respaldo es una carpeta con una **foto de la base** hecha con cuidado (no una copia del archivo a la fuerza), los **archivos** que la acompañan, una **ficha** (`manifest.json`) con las huellas de todo, y la **llave** de la bitácora guardada aparte. Restaurar es poner esa foto otra vez en su lugar, comprobando que todo coincida antes de dar nada por bueno.

### 12.1 Qué contiene un respaldo

Carpeta `backups/AAAAMMDD-HHMMSS/` (`respaldo.mjs`):

```
backups/20261009-130000/
├── datos/ficotox.sqlite3       ← snapshot consistente de la base
├── archivos/
│   ├── informes/               ← PDF y evidencias de envío
│   ├── evidencias/
│   ├── biblioteca/
│   ├── calidad/
│   ├── maintenance_reports/
│   ├── documentos_sgc/         ← flujo anterior (solo lectura)
│   └── avatares/               ← fotos de perfil (si hay)
├── manifest.json               ← la ficha: fechas, versión, conteos, huellas, sello
└── llave/llave-bitacora.txt    ← la llave de la bitácora (solo respaldo local)
```

El `manifest.json` guarda: id, fecha, equipo, versión del programa (y commit), versión del esquema, motor, etiqueta, **tamaño y SHA-256 de la base** y su resultado de `integrity_check`, **conteos por tabla** (28 tablas principales), **resumen de la bitácora** (número de entradas, último id y último sello), **cada archivo con su tamaño y SHA-256**, la huella de la llave, y un **sello del propio manifest** (HMAC con la llave de la bitácora): quien altere la base o los archivos de un respaldo y recalcule las huellas no puede recalcular el sello sin la llave.

El respaldo **nunca** incluye `JWT_SECRET`, la contraseña SMTP ni otro secreto del `.env`.

### 12.2 Cómo se crea

`npm run respaldar` (opciones: `--etiqueta "texto"`, `--sin-llave`, `--sin-retencion`) o la tarea programada de Windows (`scripts/backup-ficotox.cmd` → `backup_ficotox.py` → `respaldar-ficotox.mjs`):

1. Reserva el id de forma atómica (una carpeta temporal `.<id>.tmp`) para que dos respaldos simultáneos nunca compartan carpeta.
2. **Snapshot de la base** con la API de respaldo en línea de SQLite (`backup()`), que funciona con el servidor encendido y con WAL, y lee páginas de forma consistente.
3. Comprueba el snapshot con `PRAGMA integrity_check`; si no dice `ok`, el respaldo se descarta.
4. Copia y calcula la huella de cada archivo de las carpetas respaldadas.
5. Guarda la llave y escribe el manifest sellado.
6. **Renombra** la carpeta temporal a su nombre final: un respaldo a medias nunca aparece en la lista.
7. Aplica la **retención** (`RESPALDO_RETENCION`, 30 por omisión): borra los más antiguos, **salvo el último respaldo verificado** con una prueba de restauración aprobada, que nunca se elimina.

El respaldo por terminal no escribe en la bitácora (su registro es el manifest); los que se crean desde **Calidad › Respaldos** (solo con el permiso `respaldos:G`) sí dejan la entrada «creó un respaldo», y las pruebas de restauración desde esa pantalla dejan «probó la restauración». El script de Python (`backup_ficotox.py`) llama a `respaldar-ficotox.mjs` y empaqueta la carpeta del respaldo en un `.zip` para la **copia externa** (carpeta de OneDrive, `rclone` o Microsoft Graph), **sin la llave** salvo que se pida `--incluir-llave`. Si la base es MySQL/MariaDB, ese mismo script ejecuta `mysqldump`. **No está claro en el código** con qué frecuencia se usa la copia externa en cada instalación: depende de cómo se programe la tarea.

Antes de cada migración y de cada actualización se hace además un respaldo automático (`pre-migracion`, `pre-actualizacion`).

### 12.3 Restaurar en modo prueba

`npm run restaurar -- --respaldo <id> --responsable "Nombre"` — **no toca la instancia real**: restaura en `instance-restaurada/<fecha>/`, verifica y deja un **acta** en `backups/pruebas-restauracion/<fecha>.md` y `.json`. Debe hacerse al menos **cada 90 días** (`verificar-instalacion` lo avisa).

### 12.4 Restaurar en modo real

`npm run restaurar -- --respaldo <id> --destino instance --confirmar --responsable "Nombre"`. Antes de escribir nada, el script exige:

- El **servidor detenido** (sin archivo de bloqueo vivo y con el puerto libre de un servidor FICOTOX).
- `--destino instance --confirmar` explícitos.
- Que la llave del respaldo sea la que usará el servidor (la `SECRET_KEY` del `.env` o `auditoria.key`); si no coincide, se niega (con `--aceptar-llave-del-respaldo` se puede reemplazar `auditoria.key` tras confirmar).
- Solo funciona con SQLite.

Si todo pasa: crea un **respaldo automático de la instancia actual**, reemplaza la base y las carpetas de archivos por las del respaldo, agrega a la bitácora restaurada la entrada «restauración desde respaldo» (actor «sistema», encadenada a la cadena existente) y, si el respaldo es de una versión anterior, le **aplica las migraciones** pendientes. Nada se pierde: lo anterior queda en el respaldo previo.

### 12.5 Qué verifica la restauración

Cada verificación sale con ✅/❌ en el acta (en ambos modos):

1. **Manifest válido** y el SHA-256 de cada archivo del respaldo.
2. `PRAGMA integrity_check` = `ok` en la base restaurada.
3. **Esquema compatible**: más nuevo que la aplicación o con deriva → falla; más viejo → se migra.
4. **Llave**: su huella coincide con la del manifest y el sello del manifest es válido (si no, el respaldo fue alterado tras crearse).
5. **Cadena de la bitácora íntegra** con esa llave (sellos, huecos, triggers).
6. **Conteos por tabla** iguales a los del manifest.
7. **Archivos contra la base** (SHA-256): PDF de informes, evidencias de envío, adjuntos, archivos de Documentos SGC (`sgc/`), archivos heredados (flujo anterior y Biblioteca retirada) y PDF de NC. La verificación 6 compara además los conteos de todas las tablas `sgc_*`.
8. Tiempo total.

Si la verificación 1 falla, las demás se marcan «no ejecutada» (el respaldo no es confiable). El código de salida es distinto de 0 si algo falla.

### 12.6 Qué pasa si se pierde la llave

- **El respaldo se puede restaurar igual** (los datos están completos), pero la verificación 4 falla («no se encontró la llave») y la **5 no se puede ejecutar**: sin la llave no se puede comprobar la bitácora. Se indica la llave guardada aparte con `--llave <ruta>`.
- Una llave **incorrecta** hace fallar las verificaciones 4 y 5 («la llave indicada NO es la del respaldo»); no se da la bitácora por verificada.
- **No se debe generar una llave nueva** para «arreglar» el aviso: la bitácora anterior seguiría sin poder verificarse, y todo lo nuevo se sellaría con otra llave.
- Por eso la llave se guarda **fuera** de la computadora (sección 7.4).

---

## 13. Rendimiento y límites

**En palabras simples.** Se probó el sistema con muchísima más gente trabajando a la vez de la que usará el laboratorio, y no falló nada. Aun así hay señales concretas que avisan cuándo la base se está quedando corta.

### 13.1 Resultados de la prueba de carga

La prueba (`npm run prueba-carga -- --segundos 180 --usuarios 10`, `tests/carga.mjs`) levanta el servidor de producción sobre una **base temporal** (nunca la real) y simula usuarios que repiten sin pausa el flujo completo (recepción → procesamiento → extracción con inventario → análisis con evidencia → informe → envío), mezclado con listas, Inicio, campana e incidencias. A mitad de la corrida se crea un respaldo.

Resultados que registró el documento de decisión de la Fase 12 (equipo de pruebas: Apple M4 Pro, 14 núcleos, 24 GB, Node 24):

| Medida | Resultado |
| --- | --- |
| Duración y peticiones | 180 s · **28 035 peticiones (155/s)** |
| Flujos completos | 2 228 muestras, 394 incidencias y 174 no conformidades en 3 minutos |
| Latencia | **p50 46 ms · p95 170 ms · p99 203 ms**; ninguna acción (salvo el propio respaldo) pasó de ~300 ms |
| Errores 500 | **0** |
| Conflictos agotados (409) | 0 |
| Folios | 8 series sin repetidos ni huecos |
| Inventario | Coherente (existencia final = inicial − consumos) |
| Bitácora | Íntegra: 27 615 entradas, cadena verificada con la llave |

Otras pruebas del mismo documento: dos servidores sobre **la misma** base (60 incidencias y 16 recepciones simultáneas: sin 500, folios únicos y consecutivos, una sola cadena íntegra, ~35 reintentos resueltos), 30 incidencias de 6 personas a la vez, y suspensiones/reanudaciones simultáneas (`tests/concurrencia.mjs` y `tests/api-produccion.mjs`, que forman parte de `npm test`).

**Advertencias honestas sobre estas cifras:**

- Vienen de la prueba **de la Fase 12**. El reporte (`instance/test/carga/resultado-<fecha>.md`) se regenera con cada corrida y **no está en el repositorio**; no la volví a ejecutar para este documento.
- El mismo documento citaba en otra tabla «145 peticiones/s, p99 221 ms»: son dos corridas distintas; los órdenes de magnitud coinciden.
- Para una computadora de escritorio típica del laboratorio hay que esperar **latencias 2 a 4 veces mayores** que en el equipo de pruebas.
- El tamaño de la base era entonces de **0,4 MB**; hoy será mayor (crece con el uso).

### 13.2 Cuántos usuarios soporta cómodamente

Con ~10 cuentas y de 3 a 6 personas a la vez (el escenario real), la carga medida supera lo necesario con **dos órdenes de magnitud** de margen. El umbral que el propio documento fija para reconsiderar el motor es **más de 25 usuarios simultáneos de forma habitual**.

### 13.3 Señales de que la base se queda corta

Revisa estas señales (son los mismos umbrales de la sección 2.7):

- `npm run prueba-carga` en la computadora del laboratorio da **p95 > 500 ms** con el número real de usuarios, o las personas reportan lentitud sostenida.
- En `instance/logs` aparecen líneas «conflicto de concurrencia tras 3 intentos» (respuestas 409 `conflicto_concurrencia`).
- La base supera **2 GB**, o el respaldo en línea tarda más de **30 s**.
- Más de **25 usuarios** simultáneos habituales, o se necesita otro servidor de aplicación o acceso desde fuera de la red del laboratorio.
- Disco casi lleno: la base, los PDF, las evidencias y los 30 respaldos necesitan espacio (se recomiendan ≥ 10 GB libres).

---

## 14. Cómo consultar la base de forma segura

**En palabras simples.** Puedes mirar la base sin riesgo si la abres **en solo lectura**. Así es imposible cambiar algo por accidente. Mira, pero no toques.

### 14.1 Abrirla en solo lectura

Lo más seguro es consultar **una copia de un respaldo** (`backups/<id>/datos/ficotox.sqlite3`) o una copia restaurada. Si necesitas ver la base viva, ábrela en modo solo lectura.

- **Terminal `sqlite3`:**

  ```bash
  sqlite3 -readonly instance/ficotox.sqlite3
  ```

  o con URI: `sqlite3 "file:instance/ficotox.sqlite3?mode=ro"`. Dentro, `.tables` lista las tablas y `.schema muestras_recepcion` muestra su estructura. Para salidas legibles: `.headers on` y `.mode column`.

- **Herramienta gráfica** (DB Browser for SQLite, DBeaver…): usa la opción «Abrir en solo lectura» (*Open Read Only*) y **no ejecutes** instrucciones `INSERT`, `UPDATE`, `DELETE` ni `ALTER`.

> Aun en solo lectura, **no copies el archivo con el servidor encendido** (usa el respaldo, sección 15). Leer una base WAL viva desde otra herramienta es seguro **solo** porque SQLite está diseñado para ello; pero no uses esa herramienta para «arreglar» datos.

Recuerda que las horas con hora están en **UTC** (sección 9).

### 14.2 Cinco consultas de ejemplo

(Probadas contra una base de pruebas; usan solo columnas que existen en el esquema.)

**1. Muestras en curso** (recepciones que aún no se cierran, no se liberan, no se anulan ni se rechazan):

```sql
SELECT folio_num, solicitante, estado, fecha_recepcion
FROM muestras_recepcion
WHERE estado NOT IN ('cerrada', 'liberada', 'anulada', 'rechazada')
ORDER BY folio_num DESC;
```

**2. Existencias bajas de reactivos** (la misma regla del aviso «stock bajo»: agotados, o por debajo del mínimo):

```sql
SELECT id,
       COALESCE(NULLIF(producto, ''), NULLIF(nombre, ''), 'Reactivo') AS reactivo,
       cantidad_actual, unidad, stock_minimo
FROM reactivos
WHERE COALESCE(activo, 1) = 1
  AND cantidad_actual IS NOT NULL
  AND (cantidad_actual <= 0
       OR (COALESCE(stock_minimo, 0) > 0 AND cantidad_actual <= stock_minimo))
ORDER BY cantidad_actual;
```

**3. Actividad de un usuario en la bitácora** (cambia el correo; las horas salen en UTC):

```sql
SELECT fecha_hora, accion, entidad, referencia, motivo
FROM auditoria
WHERE usuario_email = 'persona@ejemplo.mx'
ORDER BY id DESC
LIMIT 50;
```

**4. Consumo de un reactivo** (qué extracciones y análisis lo gastaron):

```sql
SELECT m.creado_en, m.cantidad, m.motivo, m.referencia, u.nombre AS quien
FROM movimientos m
LEFT JOIN usuarios u ON u.id = m.id_usuario
WHERE m.tabla_origen = 'reactivos' AND m.id_item = 1 AND m.tipo = 'salida'
ORDER BY m.id DESC
LIMIT 20;
```

**5. Informes liberados o autorizados con su cliente** (y estado de su PDF):

```sql
SELECT i.folio_num, i.version, i.estado, i.fecha_emision,
       r.solicitante, i.archivo_pdf IS NOT NULL AS tiene_pdf
FROM informes i
JOIN muestras_recepcion r ON r.id = i.recepcion_id
WHERE i.estado IN ('autorizado', 'liberado', 'enviado')
ORDER BY i.folio_num DESC, i.version DESC;
```

Otras consultas útiles: la versión del esquema (`SELECT version, nombre, modo, aplicada_en FROM schema_migraciones ORDER BY version;`), las personas con rol vigente (`usuario_roles` con `revocado_en IS NULL`) y los equipos próximos a calibración (`equipos.fecha_prox_calibracion`).

---

## 15. Lo que nunca se debe hacer

| No hagas esto | Por qué | Qué hacer en su lugar |
| --- | --- | --- |
| **Editar o borrar filas a mano** (con `sqlite3` o una herramienta gráfica) | Rompe el rastro: la acción no queda en la bitácora, puede dejar datos incoherentes (las relaciones las vigila el código, no la base) y, si tocas `auditoria`, rompes la cadena de sellos y se dispara una alerta de integridad. | Corrige desde la aplicación: **anula** el registro con motivo, o **enmiéndalo**. Si de verdad es un caso de soporte, hazlo con el servidor detenido, sobre un respaldo previo, y anótalo. |
| **Cambiar o regenerar la llave** (`SECRET_KEY` o `auditoria.key`) | Los sellos ya escritos dejan de verificar desde la primera entrada. | Usa siempre la llave original. Si se perdió, recupérala de la copia externa (sección 7.4.1). |
| **Copiar el archivo `.sqlite3` con el servidor encendido** (o copiar solo ese archivo y olvidar el `-wal`) | En modo WAL parte de los cambios está en el archivo `-wal`: la copia puede estar incompleta o incoherente, y no queda verificada. | Usa `npm run respaldar`: toma un snapshot consistente en línea, lo verifica y guarda la llave y las huellas. |
| **Borrar `ficotox.sqlite3-wal` o `-shm`** | Pierdes cambios confirmados que aún no se pasaron al archivo principal. | Déjalos; SQLite los gestiona. Detén el servidor con `npm run detener` antes de mover la base. |
| **Poner la base en una carpeta de red o sincronizada** (OneDrive, Dropbox, una unidad compartida) | SQLite se corrompe si varios equipos o un sincronizador escriben el mismo archivo. | Déjala en el disco local; las copias externas van **de los respaldos**. |
| **Modificar una migración ya aplicada** | Su checksum cambia y el servidor de toda instalación que ya la aplicó no arranca. | Agrega una migración nueva (sección 11.7). |
| **Cambiar la estructura de las tablas a mano** | La base queda con «deriva de esquema»: ninguna versión conocida coincide y el servidor no arranca ni migra. | Una migración nueva. |
| **Arrancar dos servidores sobre la misma base**, o migrar con el servidor encendido | Conflictos de concurrencia y bloqueos de migración. | Un solo servidor por instancia; `npm run detener` antes de migrar o restaurar. |
| **Restaurar un respaldo sin verificar** o con otra llave | Podrías «restaurar» una bitácora que ya no se puede comprobar. | `npm run restaurar` en modo prueba primero; fíjate en las 8 verificaciones del acta. |
| **Borrar respaldos «para liberar espacio» a mano** | Puedes borrar el último respaldo verificado. | Ajusta `RESPALDO_RETENCION`; la retención automática protege el último verificado. |

---

## 16. Problemas frecuentes y cómo resolverlos

### Base bloqueada («database is locked» / `SQLITE_BUSY`)

- **Qué significa:** otro proceso está escribiendo la base (un script de respaldo, de migración, otra copia del servidor) y la espera de 5 s se agotó.
- **Qué hacer:** espera unos segundos y reintenta; el servidor ya reintenta solo hasta 3 veces. Comprueba que **no haya dos servidores** sobre la misma instancia (`instance/servidor.lock`) con `npm run detener`. Si aparecen muchas respuestas 409 `conflicto_concurrencia` en `instance/logs`, revisa la sección 13.3.
- **«Ya hay un servidor sobre esta instancia» y no lo hay:** el archivo de bloqueo quedó huérfano tras un apagón; `npm run detener` retira los que ya no corresponden a un proceso vivo.

### Migración fallida (el servidor no arranca con «[migraciones] FICOTOX no arranca…»)

El mensaje dice qué pasó y dónde quedó el respaldo previo:

- **«La migración N falló … se revirtió»:** esa migración se deshizo; revisa la causa (espacio en disco, permisos) y reinicia: termina lo que falta. Para volver exactamente a antes de actualizar, restaura el respaldo previo (`npm run restaurar -- --respaldo <id> --destino instance --confirmar`).
- **«La base está en la versión N y esta aplicación solo conoce hasta la M»:** se restauró una base más nueva o el código es viejo: actualiza la aplicación.
- **«La migración N cambió después de aplicarse»:** alguien modificó el código de una migración ya aplicada. Vuelve al código publicado (`git checkout -- src/lib/server/migraciones`).
- **«…su esquema no coincide con ninguna versión conocida»:** la base fue modificada a mano. No se tocó nada; restaura el último respaldo bueno.
- **«Otro proceso está migrando»:** espera o detén el otro proceso; un bloqueo huérfano se libera solo al reiniciar la computadora o a los 30 minutos.
- **«Hay migraciones pendientes y MIGRAR_AL_ARRANCAR=false»:** corre `npm run migrar` con el servidor detenido.

### Integridad rota (aviso rojo en Inicio y campana, o ❌ en `verificar-instalacion`)

1. **No sigas operando sin avisar** a Mejora Continua. El sistema no se detiene solo, pero hay un posible cambio no autorizado.
2. Mira la incidencia automática y la entrada `alerta_integridad` en la bitácora: dicen el primer id alterado, cuántas filas faltan (al final o en medio) y si faltan los triggers.
3. Comprueba que la **llave sea la correcta** (`verificar-instalacion` compara su huella con la registrada). Una llave cambiada produce el mismo síntoma que una alteración.
4. Compara con el último respaldo verificado: `npm run restaurar` en modo prueba (verificaciones 5 y 6). Si el respaldo está íntegro y la base viva no, decide con Calidad si restaurar.
5. No edites la bitácora para «arreglarla».

### Disco lleno

- Síntomas: errores `SQLITE_FULL`/`IOERR`, migraciones o respaldos que fallan, informes que no se generan.
- Qué hacer: libera espacio **sin borrar** `instance/` ni la base; revisa `backups/` (cada respaldo contiene base + archivos), baja `RESPALDO_RETENCION` si hace falta, y mueve respaldos viejos a otro disco. Una migración que falla por falta de espacio se **deshace** sola (SQLite); tras liberar espacio, reinicia y se completa. `verificar-instalacion` avisa si queda poco espacio.

### Restauración con llave incorrecta

- Síntoma: la verificación 4 dice «la llave indicada NO es la del respaldo» o la 5 «no se puede verificar sin la llave»; en modo real, el script se **niega** a restaurar si `SECRET_KEY` o `auditoria.key` no son las del respaldo.
- Qué hacer: busca la llave original (copia externa, gestor de contraseñas) y pásala con `--llave <ruta>` (modo prueba) o configúrala en `.env` antes de restaurar en modo real. No reemplaces la llave actual a menos que estés seguro de que la del respaldo es la correcta (`--aceptar-llave-del-respaldo`).

### Otros

- **La hora se ve distinta en la base y en pantalla:** es normal (UTC vs Ensenada, sección 9).
- **Un folio «salta» números:** los folios solo crecen; si una recepción se anula, su número no se reutiliza. Un hueco puede ser una anulación o un reintento por concurrencia; revisa la bitácora.
- **El renglón «Cuentas de demostración» sale ⚠️:** hay cuentas `@ficotox.local` activas (instancia de demostración); desactívalas o crea una instancia de producción con `npm run instancia-nueva`.

---

## 17. Glosario

| Término | Qué significa |
| --- | --- |
| **Base de datos** | Un conjunto de información organizada para poder buscarla y actualizarla rápido. En FICOTOX es un archivo SQLite. |
| **SQLite** | Un motor de base de datos que vive dentro del programa y guarda todo en un solo archivo. No requiere servidor aparte. |
| **MySQL / MariaDB** | Motores de base de datos que corren como un servidor aparte. FICOTOX tiene soporte para ellos, pero no se ha probado contra uno real. |
| **Tabla** | Una «hoja» de la base, con un tema (recepciones, usuarios…). |
| **Fila** (registro) | Un renglón de una tabla: una recepción concreta, un usuario concreto. |
| **Columna** (campo) | Un dato de cada fila (el solicitante, la fecha, el estado). |
| **Llave primaria (`id`)** | El número único de cada fila de una tabla. |
| **Llave foránea** | Una columna que apunta al `id` de otra tabla. En FICOTOX las relaciones existen como columnas, pero la base no las vigila: lo hace el código. |
| **Índice** | Un «atajo» que acelera las búsquedas por una columna. Uno **único** además impide repetidos (así se evitan los folios duplicados). |
| **Consulta (SQL)** | Una pregunta a la base escrita en el lenguaje SQL («dame las recepciones abiertas»). |
| **Transacción** | Un grupo de cambios que se guardan **todos o ninguno**. |
| **Commit / rollback** | Confirmar (guardar) o deshacer una transacción. |
| **Trigger** | Una regla automática de la base: «cuando alguien intente borrar de `auditoria`, abórtalo». |
| **Esquema** | La estructura de la base: qué tablas, columnas, índices y triggers existen. |
| **Migración** | Un cambio de esquema numerado y de un solo sentido, con huella. Todas las instalaciones aplican las mismas. |
| **Checksum** | La «huella» de una migración (SHA-256 de su contenido); detecta si alguien la cambió después de aplicarla. |
| **Línea base (baseline)** | El reconocimiento de una base antigua como «equivalente a la versión N» sin ejecutar sus migraciones. |
| **Deriva de esquema** | Cuando la estructura de la base no coincide con ninguna versión conocida (por cambios a mano). |
| **WAL** | «Write-Ahead Log»: modo de SQLite que anota los cambios en un archivo auxiliar (`-wal`) antes de pasarlos al principal; permite leer y escribir a la vez y respaldos en línea. |
| **Snapshot** | Una foto consistente de la base en un instante, aunque se esté usando. |
| **Hash** | Un número de longitud fija calculado a partir de un contenido; si el contenido cambia un poco, el hash cambia por completo. |
| **SHA-256** | Un algoritmo de hash muy usado; la «huella digital» de archivos y de contenido. |
| **HMAC** | Un hash que además usa una llave secreta: sin la llave no se puede fabricar uno válido. |
| **Llave (de la bitácora)** | El secreto con el que se calculan los sellos de la bitácora (`SECRET_KEY` o `auditoria.key`). |
| **Sello / cadena de sellos** | El HMAC de cada entrada de la bitácora, que incluye el de la anterior: forma una cadena donde alterar un eslabón rompe los siguientes. |
| **Bitácora (auditoría)** | El registro, de solo inserción y sellado, de quién hizo qué y cuándo. |
| **Folio** | El número de expediente de un registro (`R 0000605`). |
| **Anular** | Marcar un registro como sin efecto, con motivo, sin borrarlo. |
| **Enmienda** | Una versión nueva de un análisis o informe que sustituye a la anterior (mismo folio, versión + 1). |
| **UTC** | La hora universal. FICOTOX guarda las horas en UTC y las muestra en la hora de Ensenada (`America/Tijuana`). |
| **Respaldo** | Una carpeta con el snapshot de la base, los archivos, el manifest y la llave. |
| **Manifest** | La ficha de un respaldo: fechas, versión, conteos y huellas de todo, con su propio sello. |
| **Retención** | Cuántos respaldos se conservan antes de borrar los más viejos (nunca el último verificado). |
| **Acta de restauración** | El documento que deja `npm run restaurar` con el resultado de las 8 verificaciones. |
| **Instancia** | La carpeta (`instance/`) con los datos de una instalación: base, archivos, llave y registros. |
| **Alcance (de un permiso)** | El límite de lo que un permiso permite ver o hacer («solo lo propio», «solo lo asignado»…). |
| **Reautenticación** | Volver a escribir la contraseña para confirmar una acción crítica. |
