# FICOTOX · guía para Claude Code

Plataforma interna del laboratorio FICOTOX (CICESE, Ensenada) para gestionar muestras, ensayos, informes, inventario, equipos, calidad (ISO/IEC 17025) y Documentos SGC. Unas 10 cuentas, de 3 a 6 personas a la vez, en la red del laboratorio (o en Railway). Todo el código, la interfaz y los mensajes están en español.

## Reglas de trabajo

- **No hacer push** sin permiso explícito. Se trabaja en `main` (o en una rama por tarea que se une a `main` cuando se pide).
- **Commits breves en español** (una línea). Nunca `Co-Authored-By`, «Generated with» ni mención de Claude o IA.
- **Migraciones: solo nuevas.** La última es la **26**; la siguiente es la `0027_…`. Nunca se modifica una ya aplicada.
- **Repo público:** nunca subir datos, `.env`, llaves (`auditoria.key`, `*.pem`), respaldos (`backups/`, `*.tar.gz`), bases (`*.sqlite3*`), `instance/` ni Excel (`*.xlsx`). `.gitignore` ya los cubre; revisar `git status` antes de cada commit.
- **`SECRET_KEY` nunca cambia** (sella la bitácora; ver «Bitácora»).
- Tras correr `npm test`, borrar `.next/dev` (crece ~12 GB por corrida y el disco está casi lleno).
- No usar prettier (no hay configuración y reformatea archivos completos). Escribir código como el de alrededor.
- **Al terminar cualquier cambio relevante, actualiza este CLAUDE.md.**

## Stack

- **Next.js 16** (App Router, interfaz y API en el mismo servidor), React 19, TypeScript, Tailwind 4, Radix UI, Phosphor icons, sonner, cmdk.
- **better-sqlite3** (WAL) por omisión; ruta opcional para **MySQL/MariaDB** (`mysql2`) que nunca se ha probado contra un servidor real.
- pdfkit (PDF de informes, NC, Lista Maestra), pdfjs-dist (visor interno, en `public/` con `npm run vendor:pdfjs`), sharp (fotos de perfil), nodemailer (envío de informes), jose (JWT).
- Build `standalone`; el lanzador es `scripts/start-ficotox.mjs`.
- **Node 24 LTS o ≥ 22.13** (`engines`: `^22.13.0 || >=24.0.0`). Node 23 no funciona. El Dockerfile usa Node 22.

## Estructura

```
src/app/(app)/          pantallas: muestras, informes, inventario, movimientos, calidad (incl. respaldos),
                        documentos, administracion, auditoria, solicitudes («Por autorizar»), supervision, ayuda
src/app/api/**/route.ts envoltorios finos: export const GET = apiRoute(handler)
src/lib/server/         db.ts (conexión, sesiones, transacciones), http.ts (apiRoute, errores, 503 restaurando),
                        rbac.ts, password.ts, audit.ts, pendientes.ts, migrar-arranque.ts,
                        solicitudes-ejecutar.ts, subidas.ts (subidas por partes), migraciones/ (motor.mjs, pasos.mjs, 0009…0026)
src/lib/server/modules/ admin, auth, audit, samples/ (recepcion, procesamiento, extraccion, analisis…),
                        informes, inventory, consumables, calidad/ (incidencias, nc, automaticas…),
                        sgc/ (acceso, documentos, flujo, externos, lecturas, lista-maestra), respaldos,
                        respaldos-portables, instalacion (configuración inicial)…
src/lib/client/         atajos.ts (Mac/Windows), tema.ts, session.ts, nav.ts…
src/lib/shared/         código común cliente/servidor: permisos.ts, acciones-criticas.ts, segregacion.ts,
                        folios.ts, fechas.ts, audit-chain.mjs, respaldo.mjs, respaldo-portable.mjs, secretos.mjs, documentos.ts…
src/components/         ui/ (Primitives, Button/boton, Field, Callout, capas, ListaCuadricula), shell/, session/ (SessionProvider, pantalla «Restaurando»), features/
scripts/                operación (.mjs): configurar, instancia-nueva, respaldar, restaurar, migrar, actualizar,
                        verificar-instalacion, start-ficotox, detener, servicio, importar-respaldo-railway…
                        roles-catalogo.json (roles y permisos iniciales)
tests/                  run.mjs (corredor), api-*.mjs, ui/ (Playwright), e2e/, migraciones, respaldos,
                        standalone, operacion, concurrencia, carga, mysql; lib/ (calidad.mjs, reauth-auto.mjs)
instance/               (ignorado) ficotox.sqlite3, archivos, llave, logs, verificaciones; instance/test = base de prueba
backups/                (ignorado) respaldos AAAAMMDD-HHMMSS y actas de pruebas-restauracion/
```

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo (`next dev`). En macOS no usar el puerto 5000 (AirPlay): `PORT=5055`. |
| `npm run build` | Compila standalone; `postbuild` limpia el paquete. Necesario tras migraciones nuevas para standalone/operacion/concurrencia y tras cambiar límites de tamaño. |
| `npm start` / `npm run start:standalone` | `next start` / lanzador de producción (relanza si cae, lock de instancia, logs rotados, HTTPS opcional). |
| `npm run typecheck` · `npm run lint` | `tsc --noEmit` · eslint. |
| `npm test` | Regenera la base de prueba (`instance/test`), levanta `next dev` en el 3100, corre API y navegador. `--api` solo API; `--solo=<suite>` una suite (con datos de apoyo); `--rebuild-fixture`. |
| `npm run test:mysql` | Pruebas contra un MySQL/MariaDB de pruebas. |
| `npm run respaldar` | Respaldo en línea verificado en `backups/AAAAMMDD-HHMMSS` (`--etiqueta`, `--sin-llave`). |
| `npm run restaurar` | Restauración: modo prueba por omisión; real con `--destino instance --confirmar` (ver «Respaldos»). |
| `npm run cargar-inventario -- <ruta.xlsx>` | Carga inicial repetible del Inventario General (Excel) a SQLite, con la plataforma detenida. `--simular`, `--db`, `--usuario`, `--reporte`. Escribe `~/Downloads/CARGA_INVENTARIO.md`. |
| `npm run instancia-nueva [-- --confirmar]` | Instancia de producción vacía con las dos cuentas mínimas (mueve la anterior a `backups/pre-produccion-<fecha>/`). Solo SQLite. |
| `npm run preparar-importacion` | Respaldo sin llave en `~/Downloads/ficotox-respaldo.tar.gz` + su SHA-256, para importar en Railway. |
| `npm run configurar` | Escribe `.env` (genera `JWT_SECRET` y, si faltan, `SECRET_KEY` y `FICOTOX_CODIGO_INSTALACION`; nunca reemplaza una existente). |
| `npm run migrar` | `--estado`, `--simular`, sin opciones aplica; en MySQL `--respaldo-hecho`. |
| `npm run actualizar [-- --git]` | Respalda, detiene, compila (revierte si falla), migra, arranca y verifica. |
| `npm run verificar-instalacion` | Reporte ✅/⚠️/❌ en `instance/verificaciones/<fecha>.md`. |
| `npm run detener` / `reiniciar` | Detiene el lanzador (y limpia locks huérfanos). |
| `npm run instalar-servicio` / `quitar-servicio` | Tarea programada (Windows) o unidad launchd/systemd. |
| `npm run seed:roles` | Roles de `roles-catalogo.json` + usuarios de `scripts/seed-usuarios.local.json` (ignorado). |
| `npm run sqlite-a-mysql` | Copia SQLite → MySQL (`--simular`, `--destino … --confirmar`). |
| `npm run demo:documentos -- --url http://localhost:<p>` | Datos de demostración de Documentos SGC (solo desarrollo; idempotente). |
| `npm run prueba-carga` | Carga simulada sobre base temporal. |
| `node scripts/set-password.mjs <correo> "<temporal>" --motivo "…"` | Restablecer contraseña con el servidor detenido. |

Cuentas de la base de prueba: `jorge.ramirez` (Administrador técnico), `patricia.luna` (Responsable General), `ana.torres`, `ricardo.medina`, `qa@ficotox.local`. Locales: `jorge@ficotox.local`, `patricia@ficotox.local` (contraseñas en `seed-usuarios.local.json`).

## Arquitectura

- **`apiRoute(handler)`** (`http.ts`): recibe el cuerpo completo, abre una sesión de BD (`withSession`) con **una transacción por petición**; si el handler no hace `commit()`, rollback. Errores JSON `{ message, campo?, codigo?, regla? }` (400/401/403/404/409/413). Conflictos de folio o `SQLITE_BUSY`: se repite la petición completa hasta 3 veces y luego 409 `conflicto_concurrencia` (nunca 500); no se reintenta si el handler ya confirmó una parte.
- **Conexión:** una sola por proceso en `globalThis.__ficotoxSqlite`; sesiones en serie (`withSqliteLock`). SQL con parámetros nombrados (`:nombre`), enteros como `BigInt`. Nunca DDL en un handler. Una vez por minuto se barren vencimientos (roles, solicitudes, autorizaciones).
- **RBAC** (`rbac.ts`, `permisos.ts`): módulos `usuarios, documentos, muestras, ensayos, informes, equipos, inventario, calidad, respaldos, compras` × acciones `V C E R A AN G`, cada una con **alcance** (total, propias, asignadas, solo estado, bitácora…). Se guardan en `rol_acciones` y se leen **de la BD en cada petición** (revocar tiene efecto inmediato). `requirePermission(módulo, acción, ctx)` en cada ruta; el alcance filtra en SQL y lo ajeno responde 404. `permisos`/`rol_permisos` y `usuarios.id_rol` son del modelo viejo y ya no deciden. Roles en `roles-catalogo.json`: admin_tecnico, responsable_general, mejora_continua, coord_area_tecnica, coord_investigacion, tecnico_analista, tecnico_auxiliar, admin_auxiliar, auditor_interno, estudiante. Una persona con varios roles actúa con el cargo que elige y queda en `*_cargo`.
- **Segregación de funciones** (`segregacion.ts`): quien capturó no revisa, quien revisó no aprueba, etc. Excepción por falta de personal: solicitud `excepcion_segregacion`. Combinaciones de roles prohibidas en `combinaciones-roles.ts`.
- **Segundo usuario:** las acciones críticas crean una fila en `solicitudes_autorizacion`; el catálogo es `ACCIONES_CRITICAS` (`src/lib/shared/acciones-criticas.ts`: anular/restaurar registro, anular informe o calidad, excepción de segregación, asignar rol, ampliar permisos de rol, reactivar cuenta, ampliar vigencia, decisión de recepción, cambiar folio, reabrir recepción, obsoletar documento SGC, restaurar respaldo) y los ejecutores están en `solicitudes-ejecutar.ts`. Se aprueban en «Por autorizar» por otra persona con el permiso indicado en `aprueba`. Mientras hay una pendiente el registro no se edita.
- **Reautenticación:** las acciones críticas responden 401 `reauth_required` (con `accion`) hasta repetir con `X-Reauth: <token>` de `POST /api/auth/reauth { accion, password }`. Token de un solo uso, ligado a la acción, guardado como hash, vence en `REAUTH_TTL_MIN` (5). En pruebas, `tests/lib/reauth-auto.mjs` lo automatiza (y cambia la contraseña temporal de cuentas nuevas; `X-Sin-Cambio-Auto: 1` lo desactiva).
- **Sesiones:** JWT (`JWT_SECRET`), no se guardan en BD; `usuarios.token_version` + 1 cierra todas las de una cuenta; `sesiones_revocadas` por `jti`. Contraseñas con scrypt, mínimo 10 caracteres, cambio obligatorio en cuentas nuevas, bloqueo por intentos (`intentos_acceso`).
- **Bitácora HMAC** (`audit.ts`, `src/lib/shared/audit-chain.mjs`): tabla `auditoria` de solo inserción (triggers `auditoria_sin_update`/`_sin_delete`, repuestos si faltan). Cada entrada: quién, acción, entidad, referencia, motivo, `cambios_json` (antes/después), filas completas, `hash_anterior` y `hash` = HMAC-SHA256 sobre JSON estable. Nunca guarda `password_hash`; firmas como `[firma]`; correos parcialmente ocultos. Verificación (`/api/audit/verify`, pantalla Auditoría, `verificar-instalacion`, restauración): sellos, final contra `sqlite_sequence`, huecos de ids y triggers. Si falla: entrada `alerta_integridad` + incidencia automática + aviso rojo; el sistema no se detiene.
- **Llave de la bitácora:** `SECRET_KEY` (si no es el valor de desarrollo) o, si está vacía, `instance/auditoria.key` (32 bytes, creada una vez). Su huella va en `instance/llave-bitacora.huella`. Si se pierde o cambia, la bitácora ya escrita deja de verificar: se restaura la original, nunca se genera otra. Copia fuera de la computadora.
- **Archivos** (fuera de la BD, con SHA-256 en la BD; se verifica al abrir/descargar → ok/alterado/faltante con alerta): `instance/informes/` (+ `envios/`), `evidencias/<entidad>/<id>/`, `sgc/<doc>/<rev>/<uuid>.<ext>`, `calidad/nc/`, `avatares/`, `maintenance_reports/`, heredados `biblioteca/` y `documentos_sgc/`. Escritura atómica (temporal + rename), nombre aleatorio, rutas validadas.
- **Fechas:** fechas sin hora como texto `AAAA-MM-DD` (nunca por `new Date`); instantes en UTC ISO; se muestran en `America/Tijuana` (`src/lib/shared/fechas.ts`). MySQL fija `time_zone='+00:00'`.

## Estilo de la interfaz

- **Solo tokens del tema** (`src/app/globals.css`, `@theme`): colores `--color-*` (claro y oscuro), texto `text-2xs…6xl` (11, 12, 13, 14, 15, 16, 18, 20, 24, 28, 34, 40 px), `leading-tight/snug/normal/relaxed`, `tracking-display/tight/snug/wide/widest`, radios `rounded-xs` 4 · `sm` 6 · `control` 8 (botón chico, menú) · `field` 10 (campos, botón mediano) · `box` 12 (avisos, cajas internas) · `card` 14 (tarjetas, menús) · `panel` 18 (ventanas), sombras `card/raised/panel/pop/accent/sticky/knob/paper…`. Nada de `text-[13px]`, `rounded-[10px]`, hex ni `shadow-[…]` sueltos: si falta, se crea el token (claro y oscuro). Excepciones con color fijo: muestras del selector de tema, impresión de etiquetas y lienzos (firma, acceso).
- Títulos: `.title-1/2/3`, `.display`, `.eyebrow`; datos «etiqueta arriba» con `text-xs text-ink-3` y valor en `text-base`.
- **`cn()`** (`ui/cn.ts`) usa tailwind-merge configurado con los tokens propios: la clase que pasa quien llama gana. Al agregar un token de texto, radio, sombra, interlineado o tracking, agregarlo también ahí.
- **Foco:** campos de texto, buscador, selectores y áreas de texto solo cambian el borde a `--color-focus` (`focus:border-focus focus:outline-none`, sin sombra ni brillo). Todo lo demás usa el contorno global `:focus-visible` (2 px `--color-focus`); filas y opciones de menú, `.seleccion`/`.foco-interior` (contorno interior). No poner `outline-none` a botones ni sombras de foco.
- **Versión oficial de cada pieza:** `Button` (sm 32 · md 40 · lg 44 px; para enlaces `buttonClass()` de `ui/boton.ts`, que sirve también en componentes de servidor), `IconButton` (28/32/40; `ActionMenu size="lg"` junto a botones medianos), `Input/Select/Textarea` de `ui/Field` (40 px, radio `field`), `SearchInput` (píldora de 40 px; en listas `min-w-0 flex-1 md:w-[…] md:flex-none`), `Badge` (md 24 px para estados, `size="sm"` 20 px para marcas como «Opcional», `wrap` para textos largos), `Callout` de `ui/Callout.tsx` para todo aviso (info, warning, danger, success; `icon` opcional), `EmptyState`/`ErrorState`, `PageHeader` (eyebrow, título, descripción, acciones), `Correo` para mostrar correos (cortan en `@`/`.`).
- **Ventanas:** velo, título y descripción salen de `ui/capas.ts` (`VELO_VENTANA`, `TITULO_VENTANA`, `DESCRIPCION_VENTANA`) para Sheet, Dialog, VentanaCentrada, VentanaFormulario, buscador y menú móvil. Menús y calendarios con `rounded-card` y `shadow-pop`.
- **Listas:** `ListaCuadricula` decide columnas o tarjetas por el **ancho del contenedor** (suma de mínimos de columna), no por el breakpoint: a 820 px con menú lateral no corta columnas. Excepción: las tablas anchas de Muestras, Informes y Lista Maestra siguen en `TableShell` (desplazamiento horizontal con la columna de acciones fija y columnas que se ocultan por ancho).
- **Atajos:** solo con `src/lib/client/atajos.ts`: se declaran neutros (`"Mod+K"`), `coincideAtajo(evento, "Mod+K")` exige Cmd en Mac y Ctrl en Windows/Linux, `useAtajo`/`<Atajo>` los escriben «⌘K» o «Ctrl+K» (primer pintado como Windows, sin desajuste de hidratación). Prueba: `tests/ui/estilos-atajos.mjs` (foco en claro/oscuro, alturas, 400/820 px, Mac y Windows).
- Animaciones solo con `opacity`/`transform`, apagadas con `prefers-reduced-motion` (`tests/ui/animaciones.mjs`).

## Base de datos

- Archivo `instance/ficotox.sqlite3` (`SQLITE_PATH`/`DATABASE_URL`; `FICOTOX_INSTANCE_DIR`). PRAGMAs: WAL, `synchronous=NORMAL`, `busy_timeout=5000`, `foreign_keys=ON`. `-wal`/`-shm` son parte de la base: no borrarlos ni copiarlos sueltos.
- **58 tablas: 56 de datos + `schema_migraciones` y `schema_migraciones_bloqueo`.** Esquema en versión **26**. Ninguna FOREIGN KEY: las relaciones son columnas `*_id` y las reglas viven en el código. `id` autoincremental; muchas columnas `*_json`; columnas de anulación (`anulado_en`, `anulado_por`, `motivo_anulacion`, `estado_previo`) y de supervisión.
- Grupos: muestras (`muestras_recepcion/procesamiento/extraccion/analisis`, `asignaciones_muestra`), informes (`informes`, `envios_informe`, `retenciones_informe`), inventario (`reactivos`, `consumibles`, `movimientos`), equipos (`equipos`, `mantenimientos`, `reportes_mantenimiento`), calidad (`incidencias`, `incidencia_registros`, `no_conformidades`, `nc_*`, `acciones_correctivas`, `suspensiones`, `autorizaciones_personal`), personas (`usuarios`, `roles`, `rol_acciones`, `usuario_roles`, `reautenticaciones`, `firmas_tokens`, `intentos_acceso`, `sesiones_revocadas`), `solicitudes_autorizacion`, `auditoria`, `adjuntos`, Documentos SGC (`sgc_*`, 11), comodidad (`busqueda_recientes`, `notificaciones_leidas`). Heredadas sin uso: `documentos_sgc`, `distribucion_documento`, `propuestas_documento`, `biblioteca_*`, `permisos`, `rol_permisos`.
- **Folios** (`folios.ts`, `formatearFolio` → `R 0000605`): R, P, E-A, E-D, A, IR, INC, NC; `MAX(folio_num)+1` dentro de la transacción + índice único + reintento. Análisis e informes son (folio, versión): una enmienda sube la versión. El folio de recepción solo cambia con solicitud `cambiar_folio`.
- **Estados** (texto libre, válidos en el código; `advanceState` solo avanza): recepción `registrada → aceptada/aceptada_con_desviacion/rechazada → en_procesamiento → … → liberada → cerrada`; análisis `registrado → en_revision → revisado → aprobado`; informe `borrador → en_revision → autorizado → liberado → enviado`; incidencia `reportada → en_evaluacion → cerrada_sin_nc/escalada_a_nc`; NC `abierta → en_analisis → acciones_en_curso → en_verificacion → cerrada`. Transiciones con `UPDATE … WHERE estado = :actual`.
- **Nada se borra:** se anula con motivo (y se puede restaurar), se da de baja (`activo=0`), se revoca, se enmienda o se crea una revisión nueva. Lo avanzado se anula con segundo usuario. Excepciones con `DELETE`: reescritura de `rol_acciones` y de visibilidad, rol nunca asignado, purga de comodidad, archivo de una transacción fallida. Desde las correcciones V1 los movimientos de inventario se revierten (no se borran) y no se permite existencia negativa (consumo sin existencia → 409).
- **Migraciones** (`src/lib/server/migraciones/`): cada una es un `.mjs` con `version`, `nombre`, `pasos` declarativos (`tabla`, `indice`, `columna`, `trigger`, `catalogo`; SQL para sqlite y mysql, cada paso idempotente) y `up`. Se registra en `motor.mjs` (import + lista `MIGRACIONES`; `VERSION_ACTUAL` es la última). `schema_migraciones` guarda checksum: si una aplicada cambia, el servidor **no arranca**. Al arrancar (`migrarAlArrancar`, `MIGRAR_AL_ARRANCAR=true`) hace respaldo `pre-migracion` (si la base no está vacía), aplica cada pendiente en su transacción y deja entrada `migrar` en la bitácora. Bases antiguas se reconocen por «baseline» (9–11). No hay migraciones hacia atrás: volver = restaurar un respaldo.
- **Para agregar una:** `0027_<nombre>.mjs` siguiendo `0014_tema.mjs`; registrarla en `motor.mjs`; si agrega tablas o carpetas, actualizar `TABLAS_PRINCIPALES`/`CARPETAS_ARCHIVOS` en `respaldo.mjs`; probar con `npm run migrar -- --simular` sobre una copia y `npm test` (incluye pruebas de migraciones y baseline); `npm run build`.
- **Nunca:** editar filas a mano, cambiar el esquema fuera de migraciones, borrar filas de `schema_migraciones`, copiar la base con el servidor encendido, ponerla en carpetas sincronizadas, dos servidores sobre la misma instancia.

## Módulos y flujos

- **Muestras y ensayos:** recepción (FX-TCF-GMR…) → procesamiento → extracción ASP/DSP (descuenta reactivos y consumibles) → análisis con evidencias → revisión y aprobación (segregación) → supervisión. Decisión de recepción (rechazo o desviación) con segundo usuario salvo `muestras:A`. Disposición final solo con el informe liberado o enviado. Etiquetas por alcance.
- **Informes:** borrador → revisión → autorización → liberación (genera PDF con SHA-256) → envío por correo (SMTP opcional) con evidencia. Enmiendas con versión nueva; el PDF anterior se regenera marcado «sustituido». Retenciones.
- **Inventario:** reactivos, columnas y consumibles; existencia = capacidad × piezas (`cantidad_actual` se ignora al dar de alta); movimientos de entrada/salida; bajas reactivables.
- **Equipos:** mantenimientos programados (pone el equipo «En mantenimiento»), vencimiento automático, reportes PDF (migración 25).
- **Calidad:** incidencias (propias o todas), escalamiento a NC, acciones correctivas, verificación de eficacia (reabre si no eficaz), PDF de NC al cerrar, suspensiones, autorizaciones de personal FX-THF-AP (`AUTORIZACIONES_OBLIGATORIAS`), incidencias automáticas por integridad, bitácora.
- **Administración:** usuarios (alta con rol = solicitud que aprueba el Responsable General), roles y permisos (ampliar = segundo usuario; quitar es directo), vigencias, fotos de perfil.
- **Transversal:** Inicio con pendientes, campana, búsqueda global, «Por autorizar», Ayuda (manual resumido en `src/app/(app)/ayuda/page.tsx`).
- **Documentos SGC** (control documental, migraciones 22–24; reemplazó a la Biblioteca, cuyas tablas se conservan sin uso; `/api/documentos-sgc` responde 410):
  - API en `/api/sgc/*`, lógica en `src/lib/server/modules/sgc/`. 14 acciones documentales en `rol_acciones` (módulo `documentos`, sin alcance): `documento_consultar_vigente, _proponer, _crear_ficha, _elaborar, _enviar_revision, _revisar, _autorizar, _publicar, _obsoletar, _consultar_historico, _acusar_lectura, _administrar_lecturas, documento_externo_gestionar, lista_maestra_exportar`. Mejora Continua y Responsable General se reconocen por clave de rol; el Administrador técnico (`usuarios:G`) solo ve metadatos de uso interno y no abre archivos (403 `solo_metadatos`).
  - **Flujo:** solicitud → aceptar (asigna elaborador, revisor y autorizador, tres personas distintas: regla 11) → borrador → en_revision → en_autorizacion → autorizada → vigente (publicar en una transacción; índice único de una sola vigente; la anterior pasa a obsoleta). Devolver regresa a borrador; rechazar cancela. Renovar sin cambios (misma revisión, nueva fecha; solo si está pendiente de revisión: 30 días). Obsoletar con segundo usuario. Carga inicial solo para la primera revisión (`carga_inicial`). Externos: registrar, verificar vigencia, nueva versión (sin flujo interno: 409 `externo`).
  - Confidencialidad: `restringido`/`confidencial` responden 404 a quien no puede verlos en todas partes. Abrir uno restringido y toda descarga quedan en la bitácora. Archivos inmutables fuera de borrador (triggers), firma de bytes validada, `DOCUMENTOS_MAX_MB` (50). Lecturas: el acuse exige haber abierto el PDF vigente (`sgc_lecturas.abierto_en`). Lista Maestra FX-GCL-MD (PDF horizontal, copia no controlada).
  - Recuperación: las tablas `sgc_*` se cuentan en el manifest y `instance/sgc/` viaja con SHA-256 en el respaldo general.
  - Pruebas: `tests/api-documentos*.mjs`, `api-sgc.mjs`, `ui/documentos*.mjs`.

## Respaldos y restauración

- **Lógica oficial** en `src/lib/shared/respaldo.mjs`. `npm run respaldar` usa la API de respaldo en línea de SQLite + `integrity_check`, copia las carpetas de archivos y escribe `backups/<id>/` con `datos/`, `archivos/`, `llave/` (salvo `--sin-llave`) y `manifest.json` (conteos por tabla, `sgc_*` incluidas, SHA-256 de todo, sellado). Nunca incluye `.env`, `JWT_SECRET` ni SMTP. Permisos 600/700. Retención `RESPALDO_RETENCION` (30); nunca se borra el último verificado. Tarea diaria: `scripts/install-ficotox-backup-tasks.cmd daily` (Windows) o cron. Avisos si pasan `RESPALDO_AVISO_HORAS` (24) sin respaldo o `PRUEBA_RESTAURACION_AVISO_DIAS` (90) sin prueba.
- **Prueba de restauración:** `npm run restaurar -- --respaldo <id> --responsable "Nombre"` restaura en `instance-restaurada/<fecha>/` (junto a la instancia; `carpetaRestauradas()`) y corre **8 verificaciones**: manifest y SHA-256, `integrity_check`, esquema compatible, llave coincide, cadena íntegra, conteos por tabla, archivos vs BD por SHA-256, tiempo. Acta en `backups/pruebas-restauracion/<fecha>.md/.json`; la copia se borra.
- **Restauración real por terminal** (plataforma detenida): `npm run restaurar -- --respaldo <id> --destino instance --confirmar --responsable "…"` (`--llave <ruta>`, `--aceptar-llave-del-respaldo`). Respalda antes la instancia actual; se niega si la llave no es la del respaldo.
- **Desde la plataforma (Calidad › Respaldos):** `respaldos:V` ve la lista; `respaldos:G` (Administrador técnico) crea respaldos y prueba la restauración (en copia aparte). «Restaurar este respaldo» crea la solicitud `restaurar_respaldo` (pide `respaldos:G`, aprueba `calidad:A` + `respaldos:V`). Al aprobar, `restaurarAhora` corre con `conBaseCerrada` (`db.ts`): la API responde 503 `restaurando`, vuelca el WAL y cierra la conexión; ejecuta `scripts/restaurar-ficotox.mjs` como hijo con `FICOTOX_RESTAURAR_DESDE_SERVIDOR=<pid del lock>` y los datos de la solicitud en `FICOTOX_RESTAURAR_SOLICITUD` (JSON en el entorno, **nunca como argumentos**: había inyección de opciones). El script verifica, guarda un respaldo «Previo a restauración», reemplaza base y archivos, registra quién pidió/aprobó/motivo, migra y cierra todas las sesiones (`token_version` + 1; conserva `sqlite_sequence` salvo `auditoria`). Si falla, no toca nada: solicitud «fallida» y acción `restauracion_fallida`. La pantalla de espera vive en `SessionProvider`. Funciona con `next dev`, `next start` y el lanzador. Con MySQL la pantalla solo avisa que se respalda con `mysqldump`.
- **Respaldos portables (`.ficotox`)** — formato y cifrado en `src/lib/shared/respaldo-portable.mjs`; servidor en `modules/respaldos-portables.ts`, `modules/instalacion.ts` y `subidas.ts`:
  - Formato v1: `FICOTOXP` + versión + JSON de parámetros (scrypt N=2^17 r=8 p=1 con sal aleatoria; AES-256-GCM en trozos de 1 MiB, nonce = prefijo ‖ contador ‖ marca de último trozo, AAD = SHA-256 del encabezado) y un verificador que distingue «contraseña incorrecta» de «alterado». Dentro: el respaldo completo (manifest primero, datos, archivos, llave). Todo por flujos (memoria constante). Rutas validadas al abrir (nada fuera de la carpeta, nombres válidos en Windows).
  - **Descargar** (`respaldos:G` + reauth `respaldos:descargar`, solo SQLite, solo respaldos con llave): `POST /api/respaldos/:id/descargar` con contraseña ≥ 12 escrita dos veces → enlace `GET /api/respaldos/descargas/<token>` de un solo uso (2 min; guarda en memoria la clave derivada, nunca la contraseña). Bitácora `descargar_respaldo` sin la contraseña.
  - **Subidas por partes** (el cuerpo de `apiRoute` va completo a memoria): `POST …/subidas` + `PUT …/subidas/:id?desde=N` (8 MiB, máx. 16) en `backups/.importando/`; límite `RESPALDO_IMPORTAR_MAX_MB` (4096) y espacio libre; se borran al terminar, al fallar y a las 2 h. La contraseña del archivo se comprueba antes de la reautenticación: si es incorrecta, la subida se conserva para reintentar.
  - **Importar** (`respaldos:G` + reauth `respaldos:importar`): descifra a `backups/<id>` (`-2`, `-3`… si ya existe), `importado.json`, prueba de restauración en copia aparte; si falla se borra. Tipo «Importado»; la retención no los borra. Restaurarlo = el flujo de siempre con segundo usuario; con otra llave (`llave_coincide=false`) la solicitud responde 409 `llave_distinta`.
  - **Configuración inicial** (`/configuracion-inicial`, `/api/instalacion/*`): solo con 0 cuentas; después 404 siempre (y `memoria.terminada`). Exige `FICOTOX_CODIGO_INSTALACION` (≥ 12, comparación de digestos con `timingSafeEqual`; 5 fallos en 15 min bloquean 15 min, en memoria, cada fallo en la bitácora con la IP). «Empezar desde cero» da de alta los roles del catálogo si faltan (`seed-roles-usuarios.mjs` con la base cerrada) y crea **dos** cuentas (Administrador técnico y Responsable General, quien aprueba altas) con contraseña temporal mostrada una vez y cambio obligatorio. «Restaurar desde respaldo» corre `restaurar-ficotox.mjs` real con `adoptar_llave` en `FICOTOX_RESTAURAR_SOLICITUD`.
  - **Adopción de la llave** (solo si la base actual no tiene cuentas): `SECRET_KEY` del `.env` → se reescribe esa línea (temporal + rename) y se recarga en el proceso (`config.SECRET_KEY` es getter; `claveSello` se cachea por `SECRET_KEY` + mtime de `auditoria.key`); sin `SECRET_KEY` → `auditoria.key` (la anterior queda `.anterior-<sello>`); `SECRET_KEY` del entorno del sistema → se niega y no se toca nada.
  - El lanzador (`start-ficotox.mjs`) vuelve a leer `SECRET_KEY` del `.env` antes de cada relanzamiento (si vino del archivo): tras adoptar una llave, una caída no relanza con la vieja. La configuración inicial solo restaura con 0 cuentas aunque la llave coincida; la llave adoptada se valida (ASCII imprimible sin espacios; en el `.env`, sin comillas, `#`, `$` ni `\`).
  - scrypt (descargar, comprobar contraseña al importar) corre fuera de la sesión de BD (esas rutas no usan `apiRoute`). El enlace de descarga vuelve a exigir sesión vigente y `respaldos:G` de quien lo pidió. Importados que quedaron «verificando» sin trabajo en curso se borran al empezar otra subida. «Desde cero» y el arranque de una restauración inicial se excluyen con `memoria.reservada` (sin await entre revisar y tomar). Con `SECRET_KEY` repetida en el `.env` no se adopta la llave.
  - Windows: sin probar en un equipo real (rutas con `path.join`, nombres de archivo válidos, reintento de `rename` en EPERM/EBUSY).
- Pruebas: `tests/respaldos.mjs`, `respaldo-portable.mjs` (sin servidor: formato, ida y vuelta byte a byte, alterado, truncado, 600 MB), `api-respaldos-portables.mjs` (deja `instance/test/murio/`, y termina restaurando: va justo antes de `api-restaurar.mjs`), `instalacion.mjs` (levanta sus propios `next dev` sobre instancias vacías en el mismo puerto: corre tras detener el servidor de pruebas, después de `api-integridad`; con `--solo=instalacion.mjs` corre antes la de API), `api-restaurar.mjs`, `ui/respaldos-portables.mjs`, `ui/respaldos-restaurar.mjs` (estas restauran o cierran sesiones: deben ir al final de `run.mjs`). `respaldos.mjs` con `--solo` falla 2 checks SGC porque depende de otras suites (no es regresión).

## Despliegue

- **Equipo del laboratorio:** `npm ci` → `npm run configurar` (guardar `SECRET_KEY` fuera) → `npm run build` → `npm run instancia-nueva -- --confirmar` → `npm run start:standalone` → `npm run instalar-servicio`. HTTPS con `TLS_CERT`/`TLS_KEY`/`TLS_CA`. MySQL: base `utf8mb4`, `DATABASE_URL=mysql://…`, `mysqldump` antes de migrar y `npm run migrar -- --respaldo-hecho`; el primer admin se crea a mano. Actualizar: `npm run actualizar -- --git`; revertir = checkout + `npm ci` + restaurar `pre-actualizacion` + build.
- **Railway:** `Dockerfile` (Node 22, arranca `node scripts/start-ficotox.mjs`) y `railway.json` (builder DOCKERFILE, healthcheck `/api/health`, timeout 900). Repo `axsseldz/FICOTOX` (origin; upstream `DeadAVA/FICOTOX`), rama **main**. Volumen montado en `/data` (`FICOTOX_DATA_DIR`, por omisión `/data`).
  - Variables: `SECRET_KEY` (la misma que local), `JWT_SECRET` nuevo (`openssl rand -hex 32`), `NODE_ENV=production`, `TRUST_PROXY=1`, `FICOTOX_OPEN_BROWSER=0`, `TZ=America/Tijuana`, `SQLITE_PATH=/data/instance/ficotox.sqlite3`, `FICOTOX_BACKUP_DIR=/data/backups`, y para el primer arranque `IMPORTAR_URL` + `IMPORTAR_SHA256`.
  - Antes del servidor corre `scripts/importar-respaldo-railway.mjs`: si la base existe no hace nada; si no, importa `/data/import/ficotox-respaldo.tar.gz` o descarga `IMPORTAR_URL` (acepta ligas de Google Drive), verifica el SHA-256 y restaura con las mismas verificaciones. Si algo falla, el servidor no arranca. Sin base ni respaldo arranca vacía (migraciones + roles).
  - Preparar: `npm run preparar-importacion`, subir el `.tar.gz` a un lugar privado, poner la liga y el SHA-256. Tras la primera importación quitar `IMPORTAR_URL`/`IMPORTAR_SHA256`.
  - Bajar un respaldo: `railway ssh`, `node scripts/respaldar-ficotox.mjs --sin-llave`, empaquetar con tar. Empezar de cero: vaciar el volumen.
- Salud: `GET /api/health` y `/api/health/db` (sin datos, sin sesión). Únicas rutas sin sesión: login, `GET /auth/config` y salud; además `/api/instalacion/*` (solo con la base sin cuentas y el código de instalación; si no, 404) y `/api/respaldos/descargas/<token>` (enlace de un solo uso). Lo verifica `tests/api-documentos-aceptacion.mjs`.
- **Computadora nueva** (guía Mac/Windows en `README.md`): `npm ci` → `npm run configurar` (genera `FICOTOX_CODIGO_INSTALACION`) → `npm run build` → `npm run start:standalone` → Configuración inicial con el `.ficotox`.

## Variables de entorno

`.env.example` documenta todas. Principales: `SECRET_KEY`, `JWT_SECRET`, `FICOTOX_CODIGO_INSTALACION`, `RESPALDO_IMPORTAR_MAX_MB` (4096), `HOST`/`PORT` (`0.0.0.0`/`5000`), `ALLOWED_EMAIL_DOMAINS`, `FICOTOX_INSTANCE_DIR`, `SQLITE_PATH`/`DATABASE_URL`, `SMTP_*` (todas o ninguna), `TLS_*`, `AUTORIZACIONES_OBLIGATORIAS`, `EVIDENCIA_MAX_MB` (25), `DOCUMENTOS_MAX_MB` (50), `RESPALDO_*`, `PRUEBA_RESTAURACION_AVISO_DIAS`, `MIGRAR_AL_ARRANCAR`, `LOG_MAX_MB` (10), `LOG_RETENCION_DIAS` (90), `REAUTH_TTL_MIN`.

## Pruebas: trampas conocidas

- Con poco disco o memoria `next dev` se cae sin mensaje a media suite: repetir antes de buscar un error en el código.
- Las pruebas que dan de alta reactivos usan capacidad × piezas; la disposición necesita un informe liberado; en suites de navegador `lib/calidad.mjs` no sirve como cliente web (`BASE` apunta a la web).
- Pruebas que programan mantenimientos deben usar un equipo propio (rompen `ui/dsp`).
- Retener la capa de las ventanas al cerrar rompe el menú ⋯.
- Chrome de Playwright desde la caché o `CHROME_PATH`.
- **Decidir sobre la vista vieja:** tras guardar, el aviso (toast) sale antes de que la pantalla recargue sus datos (`invalidate` → `useResource`). No se elige botón/menú ni se cuenta nada en ese instante: `useResource` expone `actualizando` (desde el mismo render de la invalidación) y la ficha SGC lo publica como `aria-busy`; `tests/lib/ficha.mjs` espera a que se quite. Esperar siempre una condición real (nunca `waitFor(…).catch(() => {})` como pausa ni ventanas fijas «si aparece en 4 s»).
- E2E: `E2E_SECCIONES=e`, `E2E_LATENCIA_MS=400` (retrasa los GET del navegador; simula el servidor cargado de la corrida completa) y `tiempos.json` por paso en `E2E_CAPTURAS` (por omisión `$TMPDIR/ficotox-e2e`).

## Decisiones tomadas

- SQLite por encima de MySQL (Fase 12): carga real muy por debajo de lo medido (155 req/s, p99 ~200 ms, 0 errores). Reconsiderar con > 25 usuarios simultáneos, base > 2 GB, respaldo > 30 s o p95 > 500 ms.
- Relaciones y estados en el código, sin FK ni CHECK; formularios variables en `*_json`.
- Biblioteca y el flujo viejo de Documentos SGC retirados; sus tablas y archivos se conservan y se respaldan.
- Documentos SGC: avisos solo dentro de la plataforma; firma = reautenticación (sin PAdES); Lista Maestra en PDF sin firma; sin suplentes (se reasigna con motivo); sin copias controladas.
- Restauración desde la plataforma sin reiniciar el servidor, con segundo usuario y respaldo previo.
- Respaldos portables: formato propio con `crypto` de Node (sin dependencias nuevas); la configuración inicial crea dos cuentas, no una (con una sola nadie podría aprobar altas); la llave se adopta solo en una instalación sin cuentas.

## Pendientes conocidos

- 60 reactivos locales con existencia NULL necesitan ajuste por conteo.
- MySQL: falta `FOR UPDATE` en la validación de existencia; la ruta MySQL nunca se probó contra un servidor real.
- La ventana de no conformidades probablemente tapa el visor PDF (corregir como en `MantenimientoVentana`).
- No está claro si una NC aún puede generar `propuesta_documento_id`; el PDF de un informe podría quedar huérfano si la liberación falla tras escribirlo.
- Documentos SGC: CA-17 (validación escrita de Mejora Continua), colores HEX por validar, correo/escalamiento, suplentes, copias controladas y firma avanzada para V2.
- «A confirmar» de la auditoría V1 §9.
- Respaldos portables: sin probar en Windows real; descarga e importación solo con SQLite; el bloqueo de la configuración inicial vive en memoria (se reinicia con el servidor).
