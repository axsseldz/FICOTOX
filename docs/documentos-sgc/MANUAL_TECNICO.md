# Documentos SGC · Manual técnico

## Arquitectura

El módulo forma parte de la aplicación única de FICOTOX: **Next.js** (interfaz y API en el mismo servidor) con **SQLite** por omisión o **MySQL/MariaDB**. Reutiliza la autenticación, los usuarios, los roles con vigencia, la reautenticación, el segundo usuario (solicitudes de autorización), la bitácora sellada, los avisos (campana e Inicio), el visor PDF interno y los respaldos.

| Capa | Archivos | Responsabilidad |
| --- | --- | --- |
| Rutas API | `src/app/api/sgc/**/route.ts` | Envoltorios finos: `apiRoute(handler)`. |
| Acceso | `src/lib/server/modules/sgc/acceso.ts` | Acciones documentales de la persona, confidencialidad, qué revisiones ve y qué archivos abre (`vistaDocumento`, `documentoVisible`). |
| Núcleo | `…/sgc/documentos.ts` | Catálogos, listas, ficha, resumen, validación de clave y metadatos, revisiones, archivos (SHA-256, firma de bytes), carga inicial y entrega de archivos. |
| Flujo | `…/sgc/flujo.ts` | Solicitudes, revisar, autorizar, publicar, reasignar, renovar, obsolescencia (segundo usuario), segregación (regla 11) y bandeja de tareas. |
| Externos | `…/sgc/externos.ts` | Registro, verificación de vigencia, nueva versión y lista de externos. |
| Lecturas | `…/sgc/lecturas.ts` | Distribución por rol o persona, destinatarios efectivos, acuses y recordatorios. |
| Lista Maestra | `…/sgc/lista-maestra.ts` | Renglones con filtros y PDF horizontal con pdfkit. |
| Avisos | `src/lib/server/pendientes.ts` | Tareas y lecturas en la campana y el Inicio. |
| Interfaz | `src/app/(app)/documentos/**`, `src/components/features/documentos/**` | Inicio, explorador, ficha, bandeja, solicitudes, externos y Lista Maestra. |
| Compartido | `src/lib/shared/documentos.ts`, `segregacion.ts`, `permisos.ts` | Validación de clave e identificador, estados, regla 11 y catálogo de acciones. |

## Instalación y configuración

El módulo no necesita una instalación aparte: llega con la aplicación (`npm install`, `npm run build`, `npm run start:standalone`; ver el README).

1. **Migraciones.** Se aplican con `npm run migrar`, que hace un respaldo previo, o al arrancar con `MIGRAR_AL_ARRANCAR=true`. Son versionadas y reproducibles; nunca se modifican tablas a mano.
   - **22** (`0022_documentos_sgc.mjs`):
     - catálogos `sgc_areas` (con el HEX de la especificación) y `sgc_tipos`;
     - las tablas `sgc_documentos`, `sgc_revisiones` y `sgc_archivos`;
     - la tabla del flujo y las de solicitudes, externos, distribución y lecturas, vacías hasta sus fases;
     - el índice de una sola vigente;
     - los disparadores de archivos inmutables;
     - las 14 acciones documentales en `rol_acciones`, con su asignación inicial por la clave estable del rol.
   - **23** (`0023_documentos_flujo.mjs`): columnas del flujo (fechas, quién revisó o autorizó, cancelación, sustitución, solicitud de origen, renovación), papel en `sgc_flujo_acciones`, clave asignada en solicitudes y la tabla `sgc_renovaciones`.
   - **24** (`0024_documentos_externos_lecturas.mjs`): `version_externa` en revisiones, motivos en la distribución, `abierto_en` en lecturas y el índice de lecturas por usuario.
2. **Variables de entorno.**
   - `DOCUMENTOS_MAX_MB` (50): tamaño máximo de cada archivo. `BIBLIOTECA_MAX_MB` se sigue leyendo por compatibilidad.
   - `FICOTOX_INSTANCE_DIR`, o `FICOTOX_DATA_DIR` en Railway: carpeta de la instancia, donde está `sgc/`.
   - `SECRET_KEY`: llave de la bitácora.
   - `JWT_SECRET`: firma de sesiones.
   - `MIGRAR_AL_ARRANCAR`.
   - Las de respaldo: `RESPALDO_RETENCION`, `RESPALDO_AVISO_HORAS` y `PRUEBA_RESTAURACION_AVISO_DIAS`.

   Cambiar un límite de tamaño exige `npm run build`.
3. **Permisos.** Se configuran en Administración › Roles, sección «Documentos SGC · acciones documentales». La matriz inicial está en [API_Y_PERMISOS.md](API_Y_PERMISOS.md). Los roles de Mejora Continua y Responsable General se reconocen por su clave estable (`mejora_continua`, `responsable_general`).
4. **Datos de demostración (opcional, solo en desarrollo).** Con el servidor en marcha: `npm run demo:documentos -- --url http://localhost:<puerto>`. Usa las cuentas de `scripts/seed-usuarios.local.json` (no está en el repositorio). Es idempotente y nunca se ejecuta solo en ningún despliegue.

## Almacenamiento de archivos

- **Ruta:** `instance/sgc/<documento>/<revision>/<uuid>.<ext>`. El nombre visible (`nombre_original`) nunca se usa como ruta; se genera un UUID. Los archivos de apoyo de las solicitudes van en `instance/sgc/solicitudes/<id>/`.
- **Al subir** se validan la extensión permitida (PDF de consulta; fuente `.docx`, `.xlsx`, `.xls`, `.pptx` o `.pdf`), la firma de bytes (un HTML disfrazado de PDF se rechaza), el contenido activo y el tamaño (413).
- **SHA-256:** se calcula al guardar. Al entregar el archivo se recalcula; si no coincide o falta, se registra una alerta de integridad y una incidencia automática.
- **Respuesta:** `Content-Security-Policy: sandbox`, `nosniff` y `no-store`. El visor pide rangos y la verificación se hace en el primer rango.
- **Inmutabilidad:** con la revisión fuera de borrador, los disparadores impiden agregar o cambiar archivos, y ninguno se borra (CA-06).

## Flujo y estados

```
solicitud → (aceptar, asignar 3 responsables) → borrador → en_revision → en_autorizacion → autorizada → vigente
                                   ↑ devolver ────────┘ ←─────── devolver ─┘                    │
                       rechazar → cancelada                                  publicar: la anterior → obsoleta
vigente → (pendiente de revisión, 30 días) → renovar sin cambios (misma revisión, nueva fecha) o nueva revisión
vigente → obsoletar (segundo usuario) → documento obsoleto (se conserva)
externo: registrar (vigente) → verificar vigencia | nueva versión (la anterior → obsoleta)
```

La publicación es una sola transacción. El `UPDATE … WHERE estado = 'autorizada'` y el índice único de vigente impiden dos vigentes, también con publicaciones simultáneas.

## Seguridad

- **Autorización en el servidor:** en cada endpoint. La interfaz solo muestra banderas `puede`.
- **Confidencialidad:** `restringido` y `confidencial` los ven solo Mejora Continua, Responsable General, el propietario, los asignados y los destinatarios. Para los demás responden 404 en la ficha, archivos, listas, búsqueda global, bandeja, avisos, solicitudes, Lista Maestra y su PDF, y bitácora global (CA-02, CA-08). Abrir un documento restringido o confidencial queda en la bitácora; las descargas, siempre.
- **Segregación (regla 11):** elaborador, revisor y autorizador son tres personas distintas, cada una con la acción de su papel. Nadie actúa en un papel no asignado ni cambia de papel dentro de una revisión. La obsolescencia la aprueba una persona distinta de quien la pidió. Mejora Continua publica aunque haya tenido un papel: así lo indica la especificación.
- **Reautenticación (contraseña):** carga inicial, autorizar, publicar, autorizar la renovación, obsoletar, registrar un externo y su nueva versión, y agregar o quitar destinatarios. Token de un solo uso ligado a la acción.
- **Administrador técnico:** solo metadatos de los documentos de uso interno (diagnóstico). No abre archivos, no actúa en el flujo, no gestiona externos ni lecturas y no genera la Lista Maestra.
- **Sin acceso externo (CA-16):** ninguna ruta responde sin sesión, salvo el inicio de sesión, su configuración y la salud; no hay enlaces públicos. Lo verifica `tests/api-documentos-aceptacion.mjs`, que recorre todas las rutas de la API.
- **Bitácora:** entidad `sgc_documentos`, con antes, después, motivo y detalle. Es inalterable (disparadores y cadena de sellos) y no tiene funciones de edición en la interfaz ni en la API (CA-12).

## Respaldo y recuperación

Ver [RESPALDO_RESTAURACION.md](RESPALDO_RESTAURACION.md). En resumen: `npm run respaldar` incluye la base (con las tablas `sgc_*` contadas) y `instance/sgc/` con SHA-256. `npm run restaurar` verifica 8 puntos en una copia aparte y deja el acta.

## Despliegue

- **Equipo del laboratorio:** `npm run actualizar` (o detener, `git pull`, `npm ci`, `npm run build`, `npm run migrar`, arrancar). Después, `npm run verificar-instalacion`.
- **Railway** (ver `DEPLOY_RAILWAY.md`): el arranque aplica las migraciones pendientes (22 a 24) con respaldo previo. La carpeta de datos (`FICOTOX_DATA_DIR`) debe estar en el volumen persistente para que `sgc/` no se pierda. El script de demostración **no** se ejecuta en Railway.
- **Comprobación de salud:** `GET /api/health` y `GET /api/health/db` (sin datos).

## Pruebas

Suites del módulo:

- `tests/api-documentos.mjs`
- `tests/api-documentos-flujo.mjs`
- `tests/api-documentos-fase3.mjs`
- `tests/api-documentos-aceptacion.mjs`
- `tests/ui/documentos.mjs`
- `tests/ui/documentos-flujo.mjs`
- `tests/ui/documentos-fase3.mjs`

`npm test` corre todo: API, navegador, standalone, migraciones, operación, concurrencia y respaldos. Con `npm test -- --solo=<suite>` corre solo una suite. Ver [MATRIZ_PRUEBAS.md](MATRIZ_PRUEBAS.md).
