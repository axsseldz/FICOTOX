# FICOTOX

Sistema web del laboratorio para gestionar inventario y equipos, muestras (recepción, procesamiento, extracción y análisis), informes de resultados, calidad (incidencias, no conformidades y Documentos SGC: control documental con clave FX, revisiones y archivos) y una bitácora de auditoría sellada. Aplicación Next.js única (interfaz y API) con SQLite por omisión o MySQL/MariaDB.

> **Reglas que no se rompen**
> - La **llave de la bitácora** (`SECRET_KEY`) se genera una sola vez y **no se cambia nunca**: sin ella no se puede comprobar que la bitácora no fue alterada.
> - Nada se borra: los scripts **mueven** a `backups/` lo que reemplazan.
> - Las contraseñas temporales se muestran **una sola vez**.

## 1. Requisitos

- Windows 10/11 (recomendado), macOS o Linux, con cuenta de administrador de la computadora, 10 GB libres y una IP fija o reservada.
- **Node.js** 24 LTS (o 22.13 o posterior; Node 23 no sirve): `node --version`.
- Python 3 en Windows, para la tarea programada de respaldo (`scripts\backup-ficotox.cmd`).
- Los correos de quien será **Administrador técnico del sistema** y de quien será **Responsable General** (dos personas distintas).

## 2. Instalación en la computadora del laboratorio

Todos los comandos se escriben dentro de la carpeta de FICOTOX (en Windows, PowerShell).

1. **Obtener el código**: `git clone https://github.com/DeadAVA/FICOTOX.git C:\FICOTOX` y `cd C:\FICOTOX` (o descomprimir el `.zip` ahí).
2. **Dependencias**: `npm ci` (solo importan las líneas con `ERR!`).
3. **Configurar**: `npm run configurar`. Pregunta host (`0.0.0.0`), puerto (`5000`; en macOS usa otro, p. ej. `5055`, porque AirPlay ocupa el 5000), dominios de correo (`cicese.mx`), carpeta de la instancia (`instance`) y SMTP (vacío si los informes se envían a mano). Escribe `.env`, genera `JWT_SECRET` y, si no existe, `SECRET_KEY`; nunca cambia una `SECRET_KEY` existente. Sin teclado: `npm run configurar -- --no-interactivo --host 0.0.0.0 --puerto 5000 --dominios cicese.mx --instancia instance`.
   En Windows restringe el archivo (el servicio corre como SYSTEM):
   `icacls .env /inheritance:r /grant:r "${env:USERNAME}:F" /grant:r "SYSTEM:R" /grant:r "Administradores:F"` (en Windows en inglés, `Administrators`).
4. **Guardar la llave fuera de la computadora**: copia el valor de `SECRET_KEY=` de `.env` a un gestor de contraseñas institucional o a un sobre cerrado bajo resguardo de Mejora Continua, sin modificar el archivo.
5. **Compilar**: `npm run build` (debe terminar con `[standalone] paquete limpio …`).
6. **Crear la instancia de producción** (base vacía con las dos cuentas mínimas; si ya había instancia, la **mueve** a `backups/pre-produccion-<fecha>/`):
   `npm run instancia-nueva` (solo muestra qué hará) y después `npm run instancia-nueva -- --confirmar`. Pide nombre y correo de cada persona y muestra las **contraseñas temporales una sola vez**: anótalas y entrégalas en persona.
7. **Primera prueba**: `npm run start:standalone`; debe verse `FICOTOX escuchando en http://0.0.0.0:5000`. Entra con el Administrador técnico y cambia la contraseña. Cierra con Ctrl+C.
8. **Servicio y firewall**: PowerShell **como administrador**, `npm run instalar-servicio`. En Windows crea la tarea programada `FICOTOX` (al iniciar el sistema, cuenta SYSTEM, se relanza si falla) y la regla de firewall para el puerto en redes privadas y de dominio. En macOS/Linux genera la unidad en `instance/servicio/` e imprime los comandos (`sudo`, `launchctl`/`systemctl`, `ufw`) que debes copiar. `npm run instalar-servicio -- --simular` solo muestra qué haría; `npm run quitar-servicio` lo retira sin tocar datos.
9. **Dirección para los usuarios**: `ipconfig` (Windows), `ipconfig getifaddr en0` (macOS) o `hostname -I` (Linux). Entran con `http://<IP>:5000`.
10. **Primer acceso y alta del personal**: el Administrador técnico y el Responsable General entran con su contraseña temporal y la cambian. Después, en Administración › Usuarios, el Administrador técnico da de alta a la Coordinación del Área Técnica y a Mejora Continua (el alta con rol queda como solicitud que el Responsable General aprueba en «Por autorizar»); luego, al resto del personal. Las autorizaciones FX-THF-AP las registran el Responsable General, la Coordinación del Área Técnica o Mejora Continua en la ficha de cada persona.
11. **Respaldos programados y verificación**: ver las secciones 4 y 6.

**HTTPS (opcional).** Con un certificado PEM institucional (o uno propio con OpenSSL) agrega a `.env` `TLS_CERT=instance/tls/ficotox.crt`, `TLS_KEY=instance/tls/ficotox.key` (y `TLS_CA=` si hace falta) y corre `npm run reiniciar`. Con HTTPS activo `http://` deja de responder.

**MySQL/MariaDB (opcional).** El DBA crea la base vacía (`CREATE DATABASE ficotox CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); en `.env` pon `DATABASE_URL=mysql://usuario:clave@servidor:3306/ficotox`. Respalda con `mysqldump --single-transaction --routines --triggers --hex-blob` (y copia aparte `instance/`) antes de cada migración, y migra con `npm run migrar -- --respaldo-hecho`. `instancia-nueva` es solo para SQLite: en MySQL el primer administrador se crea a mano, después de `npm run migrar -- --respaldo-hecho`:

```sql
INSERT INTO roles (nombre, descripcion, clave, es_sistemico, activo)
VALUES ('Administrador técnico del sistema', 'Administra cuentas, roles y asignaciones; consulta la bitácora.', 'admin_tecnico', 1, 1);
SET @rol = LAST_INSERT_ID();
INSERT INTO rol_acciones (id_rol, modulo, accion, alcance) VALUES
  (@rol, 'usuarios', 'G', 'total'), (@rol, 'documentos', 'V', 'tecnico'), (@rol, 'muestras', 'V', 'estado'),
  (@rol, 'equipos', 'V', 'total'), (@rol, 'calidad', 'V', 'bitacora');
-- hash: node -e 'import("./src/lib/server/password.ts").then(m=>console.log(m.hashPassword(process.argv[1])))' 'contraseña'
INSERT INTO usuarios (nombre, email, activo, id_rol, password_hash)
VALUES ('Nombre Apellido', 'correo@cicese.mx', 1, @rol, '<hash scrypt$...>');
INSERT INTO usuario_roles (usuario_id, rol_id, vigente_desde, motivo, asignado_en)
VALUES (LAST_INSERT_ID(), @rol, CURDATE(), 'Alta manual del primer administrador', NOW());
```

Esa alta no queda en la bitácora: anótala en el registro de la instalación. El resto de los roles se da de alta desde Administración › Roles. Para pasar de SQLite a MySQL: `npm run sqlite-a-mysql -- --simular` y luego `--destino … --confirmar`.

## 3. Uso diario

| Qué | Comando |
| --- | --- |
| Arrancar a mano | `npm run start:standalone` (con servicio: `schtasks /Run /TN FICOTOX` en Windows, `sudo launchctl kickstart system/mx.cicese.ficotox` en macOS, `sudo systemctl start ficotox` en Linux) |
| Detener | `npm run detener` (PowerShell como administrador si corre como servicio) |
| Reiniciar | `npm run reiniciar` |

No termines solo el servidor a mano: el lanzador lo toma como una caída y lo relanza. Los registros del servidor están en `instance/logs/ficotox-AAAA-MM-DD.log`. Si olvidas la contraseña del Administrador técnico y nadie con `usuarios:G` puede restablecerla, con el servidor detenido: `node scripts/set-password.mjs correo@cicese.mx "Temporal-Segura-2026" --motivo "…"`.

## 4. Respaldos y restauración

- **Desde la plataforma (Calidad › Respaldos).** Muestra los respaldos con su tipo, tamaño, contenido y si se comprobó que se pueden recuperar, y avisa en el Inicio y la campana si hay más de 24 horas sin respaldo o más de 90 días sin una prueba de restauración. Lo ven en solo lectura el Administrador técnico, el Responsable General, Mejora Continua y el Auditor Interno (permiso `respaldos:V`). Solo el **Administrador técnico** (permiso `respaldos:G`, con su contraseña) puede **Crear respaldo ahora** y **Probar restauración** (se hace en una copia aparte, sin tocar la plataforma, y la copia se borra al terminar; el acta se conserva). La plataforma **no** descarga ni borra respaldos, y la **restauración real** no se hace desde ahí: se hace por terminal, con la plataforma apagada, como se explica abajo. Con MySQL la pantalla solo avisa que los respaldos se hacen con la herramienta del servidor de base de datos.
- **Respaldo ahora**: `npm run respaldar` (opciones `--etiqueta "texto"` y `--sin-llave`); deja `backups/AAAAMMDD-HHMMSS`. Se conservan `RESPALDO_RETENCION` (30) y nunca se borra el último verificado.
- **Tarea diaria (Windows, PowerShell como administrador)**: `.\scripts\install-ficotox-backup-tasks.cmd daily` (a las 02:00; si la computadora se apaga de noche cámbiala: `schtasks /Change /TN "FICOTOX respaldo base de datos" /ST 13:00`). En macOS/Linux, con `crontab -e`: `0 13 * * * cd /ruta/a/FICOTOX && /ruta/a/node scripts/respaldar-ficotox.mjs`.
- **Restaurar en modo prueba** (en una carpeta aparte; no toca la instancia): `npm run restaurar -- --respaldo AAAAMMDD-HHMMSS --responsable "Tu nombre"`. Deben salir todas las verificaciones con ✅ y el acta en `backups/pruebas-restauracion/`. Hazla al menos cada 90 días. Deja una copia de los datos en `instance-restaurada/<fecha>/`: bórrala al terminar.
- **Restaurar de verdad**: avisa al personal, `npm run detener`, ten a la mano la llave (`--llave <ruta>` si no viene en el respaldo; si la instancia usa `SECRET_KEY`, el `.env` debe tener la misma del respaldo) y corre `npm run restaurar -- --respaldo <id> --destino instance --confirmar --responsable "Tu nombre"`. Antes respalda la instancia actual. Arranca el servidor y corre `npm run verificar-instalacion`: la bitácora debe salir íntegra.
- **La llave de la bitácora** se guarda fuera de la computadora (gestor de contraseñas institucional o sobre cerrado). Sin ella los respaldos se restauran, pero no se puede demostrar que su bitácora está íntegra.

## 5. Actualización a una nueva versión

PowerShell **como administrador**, en la carpeta de FICOTOX: `npm run actualizar -- --git` (sin Git: copia primero los archivos nuevos sin tocar `.env`, `instance/` ni `backups/` y corre `npm run actualizar`). El script respalda (`pre-actualizacion`), detiene el servidor, compila (si falla, devuelve el build anterior), migra la base con otro respaldo (`pre-migracion`), arranca, espera `/api/health/db` y verifica. Debe terminar con `Actualizado: <commit anterior> → <commit nuevo>`: anótalo. `-- --simular` solo muestra los pasos.

**Revertir**: `npm run detener`; `git checkout <commit anterior>`; `npm ci`; si se aplicaron migraciones, `npm run restaurar -- --respaldo <id pre-actualizacion> --destino instance --confirmar --responsable "Tu nombre"`; `npm run build`; arrancar y `npm run verificar-instalacion`.

Migraciones: normalmente se aplican solas al arrancar (con respaldo `pre-migracion`). `npm run migrar -- --estado` muestra la versión y las pendientes; `--simular` no cambia nada; con `MIGRAR_AL_ARRANCAR=false` el servidor no arranca si hay pendientes y pide `npm run migrar`.

## 6. Verificación de la instalación

`npm run verificar-instalacion` (una vez por semana y después de instalar o actualizar). Revisa Node, disco, hora, `JWT_SECRET`, llave de la bitácora y su huella, migraciones, integridad de la bitácora, tarea y último respaldo, prueba de restauración, autorizaciones, CORS, HTTPS, cuentas de demostración `@ficotox.local`, cuentas de administración y paquete de producción. Marca ✅, ⚠️ (revisar) o ❌ (corregir antes de operar; sale con código 1) y deja el reporte en `instance/verificaciones/<fecha>.md`. En HTTP normal son aceptables los ⚠️ de HTTPS y, en macOS/Linux, el de la tarea de respaldo.

Problemas frecuentes: **puerto en uso** (casi siempre es FICOTOX ya corriendo como servicio; si no, cambia `PORT` y repite `instalar-servicio`); **«Ya hay un servidor sobre esta instancia»** sin servidor (`npm run detener` retira bloqueos huérfanos); **otros equipos no entran** (¿abre `http://localhost:5000`?, ¿IP correcta?, ¿regla de firewall? La red de Windows debe ser «Privada» o «Dominio»); **la llave actual NO es la registrada** (restaura el valor guardado en el paso 4; no generes una nueva); **hora incorrecta** (activa la hora automática; las fechas usan America/Tijuana).

## 7. Variables de entorno principales

`npm run configurar` escribe las primeras; el resto está comentado en `.env.example`.

| Variable | Qué hace |
| --- | --- |
| `SECRET_KEY` | Llave que sella la bitácora. Una sola vez; no se cambia. Vacía: `instance/auditoria.key`. |
| `JWT_SECRET` | Firma las sesiones (obligatoria en producción, 32+ caracteres). |
| `HOST`, `PORT` | Dirección y puerto del servidor (`0.0.0.0`, `5000`). |
| `ALLOWED_EMAIL_DOMAINS` | Dominios de correo admitidos al dar de alta cuentas. |
| `FICOTOX_INSTANCE_DIR` | Carpeta de la instancia (base, archivos, llave, registros). |
| `SQLITE_PATH` / `DATABASE_URL` | Base SQLite (por omisión) o MySQL/MariaDB. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Envío de informes desde la plataforma (todas o ninguna). |
| `TLS_CERT`, `TLS_KEY`, `TLS_CA` | HTTPS opcional. |
| `AUTORIZACIONES_OBLIGATORIAS` | Exige la autorización FX-THF-AP para guardar formatos (`true`). |
| `EVIDENCIA_MAX_MB`, `DOCUMENTOS_MAX_MB` | Tamaño máximo de la evidencia y de los archivos de Documentos SGC (25 y 50; `BIBLIOTECA_MAX_MB` se sigue leyendo); subirlos exige `npm run build`. |
| `RESPALDO_RETENCION`, `RESPALDO_AVISO_HORAS`, `PRUEBA_RESTAURACION_AVISO_DIAS` | Retención y avisos de respaldo (30, 24, 90). |
| `MIGRAR_AL_ARRANCAR` | Aplica las migraciones pendientes al arrancar (`true`). |
| `LOG_MAX_MB`, `LOG_RETENCION_DIAS` | Rotación de los registros (10 MB, 90 días). |

## 8. Comandos de desarrollo

```bash
npm ci               # dependencias
npm run dev          # servidor de desarrollo
npm run build        # compilación (standalone)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # pruebas (npm run test:api = solo API; test:mysql contra MySQL/MariaDB)
npm run seed:roles   # roles y usuarios iniciales (scripts/roles-catalogo.json + seed-usuarios.local.json)
npm run demo:documentos -- --url http://localhost:<puerto>   # datos de demostración de Documentos SGC (solo desarrollo)
```

## 9. Documentos SGC (control documental)

Módulo en **Calidad › Documentos SGC**. Lo cubren las migraciones 22 a 24. Incluye:

- seis carpetas por gestión, con su color;
- fichas con clave FX única;
- revisiones con archivos inmutables tras el envío;
- flujo solicitud → elaboración → revisión → autorización → publicación, con contraseña y segregación de funciones;
- renovación y obsolescencia con segundo usuario;
- documentos externos;
- distribución con acuse de lectura;
- Lista Maestra FX-GCL-MD en PDF.

Los archivos van en `instance/sgc/` con SHA-256 y entran en los respaldos. Documentación completa en [`docs/documentos-sgc/`](docs/documentos-sgc/):

| Documento | Contenido |
| --- | --- |
| [MANUAL_USUARIO.md](docs/documentos-sgc/MANUAL_USUARIO.md) | Guía por papel: Mejora Continua, elaborador, revisor, autorizador, destinatario y auditor. |
| [MANUAL_TECNICO.md](docs/documentos-sgc/MANUAL_TECNICO.md) | Arquitectura, migraciones, almacenamiento, variables, seguridad, respaldo y despliegue. |
| [API_Y_PERMISOS.md](docs/documentos-sgc/API_Y_PERMISOS.md) | Endpoints `/api/sgc/*` y matriz rol × acción documental. |
| [MODELO_DATOS.md](docs/documentos-sgc/MODELO_DATOS.md) | Diagrama entidad–relación y diccionario de datos de las tablas `sgc_*`. |
| [RESPALDO_RESTAURACION.md](docs/documentos-sgc/RESPALDO_RESTAURACION.md) | Qué se respalda, cómo se prueba la restauración y el acta. |
| [MATRIZ_PRUEBAS.md](docs/documentos-sgc/MATRIZ_PRUEBAS.md) | CA-01 a CA-17 → pruebas → resultado, e incidencias corregidas. |
| [DECISIONES_Y_LIMITACIONES.md](docs/documentos-sgc/DECISIONES_Y_LIMITACIONES.md) | Decisiones, diferencias con la especificación y pendientes para V2. |
