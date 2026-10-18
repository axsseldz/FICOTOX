# Despliegue de FICOTOX en Railway (ambiente de PRUEBAS)

Esta guía monta FICOTOX en Railway con **una base que es la restauración de un respaldo de tu base local**. No contiene secretos: solo dice qué variables crear y de dónde sacarlas.

> **Reglas que no se rompen**
> - El repositorio (y el fork) son **públicos**: nunca subas la base, el Excel, respaldos, el `.env`, llaves ni el `.tar.gz`.
> - `SECRET_KEY` es la llave que sella la bitácora: en Railway debe ser **la misma** de tu `.env` local y **nunca se cambia**.
> - Es un ambiente de pruebas: las 5 cuentas `@ficotox.local` son de demostración.

## 1. Cómo funciona

1. Railway construye la imagen con el `Dockerfile` (Node 22, Debian slim, build *standalone* de Next.js) y arranca `node scripts/start-ficotox.mjs`.
2. **Antes de iniciar el servidor**, el lanzador ejecuta `scripts/importar-respaldo-railway.mjs`:
   - si **ya existe** la base (`/data/instance/ficotox.sqlite3`), no hace nada (ignora `IMPORTAR_URL`);
   - si no existe y hay respaldo (`/data/import/ficotox-respaldo.tar.gz`, o se descarga de `IMPORTAR_URL`), verifica su SHA-256 contra `IMPORTAR_SHA256` y lo restaura con la misma lógica de `npm run restaurar` (manifest y hashes, `integrity_check`, esquema, llave, cadena de la bitácora con `SECRET_KEY`, conteos y archivos). Si **algo falla, el servidor NO arranca** y el motivo queda en el log;
   - si no existe ni base ni respaldo, arranca con una **base vacía** (migraciones + roles, sin usuarios) y lo avisa en el log.
3. Al terminar bien, deja el archivo en `/data/import/aplicado-<fecha>/` y escribe en el log: `Restauración completada: N reactivos, N consumibles, N usuarios, bitácora íntegra.`
4. Todo lo que cambia (base, informes, evidencias, Biblioteca, fotos, logs, respaldos) vive en el **volumen** montado en `/data`.

## 2. Preparar el respaldo (en tu computadora)

Con tu plataforma local con el inventario ya cargado:

```bash
npm run preparar-importacion
```

Hace un respaldo con la lógica oficial **sin la llave de la bitácora** (la llave va aparte, como `SECRET_KEY`), lo comprime en `~/Downloads/ficotox-respaldo.tar.gz` e imprime su **SHA-256**. Guarda ese valor: es `IMPORTAR_SHA256`.

Sube el `.tar.gz` a un lugar **privado** con liga de descarga y pon esa liga en `IMPORTAR_URL`:

- **Google Drive:** súbelo, «Compartir» → «Cualquier persona con el vínculo» y copia la liga. Se aceptan las ligas `https://drive.google.com/file/d/<ID>/view?usp=sharing` y `https://drive.google.com/uc?export=download&id=<ID>`, incluida la página de confirmación que Drive muestra en archivos grandes.
- Cualquier otra **liga de descarga directa** también sirve.

Alternativa sin liga: monta el volumen y copia el archivo a `/data/import/ficotox-respaldo.tar.gz` (por ejemplo, con la CLI de Railway); en ese caso `IMPORTAR_URL` no hace falta, pero `IMPORTAR_SHA256` sí.

## 3. Crear el proyecto en Railway

1. **New Project → Deploy from GitHub repo** y elige el fork `axsseldz/FICOTOX` (rama `depuracion`, o la que subas). Railway detecta `railway.json` (builder `DOCKERFILE`, healthcheck `/api/health`).
2. **Volumen:** en el servicio, *Settings → Volumes → Add Volume* y monta en **`/data`** (1 GB basta para pruebas).
3. **Variables:** crea las de la sección 4.
4. **Dominio:** *Settings → Networking → Generate Domain*. Railway define `PORT` solo; FICOTOX escucha en `0.0.0.0:$PORT`.
5. El **primer arranque** descarga y restaura el respaldo; `healthcheckTimeout` es de 900 s para dar tiempo. Revisa *Deployments → Logs*: busca las líneas `[importación]`.

## 4. Variables de entorno

| Variable | Valor | Para qué sirve |
| --- | --- | --- |
| `SECRET_KEY` | **La misma que tu `.env` local** (copia el valor de la línea `SECRET_KEY=` de tu `.env`; no la imprimas ni la compartas) | Llave que sella la bitácora de auditoría. Con otra llave la cadena de la bitácora no verifica y la restauración se rechaza |
| `JWT_SECRET` | **Uno nuevo** (no el local): `openssl rand -hex 32` | Firma las sesiones. Obligatorio en producción (32+ caracteres) |
| `NODE_ENV` | `production` | Modo producción (el servidor exige un `JWT_SECRET` fuerte) |
| `TRUST_PROXY` | `1` | Detrás del proxy de Railway: la IP real del cliente se toma de `X-Forwarded-For` (bloqueo por intentos fallidos). Sin esto todas las personas parecerían una sola IP |
| `FICOTOX_OPEN_BROWSER` | `0` | No intentar abrir un navegador en el servidor |
| `TZ` | `America/Tijuana` | Zona horaria del laboratorio (fechas «de hoy» y vencimientos) |
| `SQLITE_PATH` | `/data/instance/ficotox.sqlite3` | Base SQLite en el volumen. De la carpeta de la base cuelgan los informes, evidencias, Biblioteca, fotos y logs |
| `FICOTOX_BACKUP_DIR` | `/data/backups` | Dónde se guardan los respaldos (y las actas de prueba de restauración), en el volumen |
| `IMPORTAR_URL` | Liga de descarga del `.tar.gz` (ver sección 2) | Solo se usa si **no hay base**. Quítala después de la primera restauración |
| `IMPORTAR_SHA256` | El SHA-256 que imprimió `npm run preparar-importacion` | Se verifica antes de restaurar; si no coincide, aborta |

El `Dockerfile` ya fija por omisión `HOST=0.0.0.0`, `FICOTOX_DATA_DIR=/data`, `SQLITE_PATH`, `FICOTOX_BACKUP_DIR`, `TZ` y `FICOTOX_OPEN_BROWSER=0`; las variables de Railway las sobrescriben. **SMTP:** déjalo vacío (no hay envío de correo en pruebas; los informes se envían de forma manual con evidencia).

Si necesitas cambiar la carpeta de datos, `FICOTOX_DATA_DIR` (por omisión `/data`) define dónde están `instance/`, `backups/` e `import/`.

> **Sobre `TRUST_PROXY=1` y la IP del cliente.** FICOTOX toma la IP de la primera dirección de `X-Forwarded-For` para el bloqueo por IP. Eso solo es confiable si **todo el tráfico entra por el proxy de Railway** (no expongas otro puerto público). Si el proxy agregara la IP real al final de una cabecera que el cliente ya trae, alguien podría variar su IP para esquivar el límite **por IP**; el bloqueo **por cuenta** (5 intentos) sigue aplicando igual. Es un ambiente de pruebas: no uses `TRUST_PROXY=1` fuera de un proxy propio.

## 5. Después de la primera restauración

1. Confirma en los logs: `Restauración completada: … bitácora íntegra.`
2. **Quita `IMPORTAR_URL` y `IMPORTAR_SHA256`** (*Variables → eliminar*) y redespliega. Aunque las dejaras, con la base ya creada se ignoran; quitarlas evita confusiones y deja la liga fuera de Railway.
3. Borra el `.tar.gz` de Drive (ya está aplicado en `/data/import/aplicado-<fecha>/`).
4. Entra con una cuenta de prueba (las contraseñas están en tu `scripts/seed-usuarios.local.json`, que no se sube) y cambia las contraseñas si el ambiente va a ser visible para otras personas.

## 6. Bajar un respaldo de Railway

Con la CLI de Railway (`npm i -g @railway/cli`, `railway login`, `railway link`):

```bash
railway ssh                                   # shell dentro del servicio
node scripts/respaldar-ficotox.mjs --sin-llave --etiqueta "bajar a mi equipo"
tar -czf /tmp/respaldo.tar.gz -C /data/backups <id-del-respaldo-que-imprimió>
exit
```

Luego copia `/tmp/respaldo.tar.gz` a tu equipo (por ejemplo con `railway ssh` y `base64`, o creando el respaldo desde la plataforma en **Calidad › Respaldos › Crear respaldo ahora** y copiando la carpeta de `/data/backups`). El respaldo **no lleva la llave**: para restaurarlo en otro lado necesitas el mismo `SECRET_KEY`.

## 7. Empezar de nuevo

Para volver a restaurar desde cero (por ejemplo, con un respaldo nuevo):

1. Prepara el nuevo `.tar.gz` (sección 2) y actualiza `IMPORTAR_URL` e `IMPORTAR_SHA256`.
2. **Vacía el volumen** (*Settings → Volumes →* elimina y vuelve a crear el volumen en `/data`, o borra `/data/instance` con `railway ssh`; **esto elimina todos los datos de Railway**).
3. Redespliega: sin base, el lanzador vuelve a importar.

Para arrancar con una **base vacía**: no pongas `IMPORTAR_URL` y vacía el volumen; el log dirá «arranca con una base VACÍA (migraciones + roles, sin usuarios)». Crea a la primera persona con `railway ssh` y `npm run instancia-nueva -- --confirmar`.

## 8. Si algo falla

| Síntoma en el log | Causa y solución |
| --- | --- |
| `el SHA-256 del respaldo … no coincide con IMPORTAR_SHA256` | El archivo cambió o copiaste mal el hash: vuelve a correr `npm run preparar-importacion` y actualiza ambas variables |
| `lo descargado no es un archivo .tar.gz` | La liga no es pública o es una página web: revisa «Cualquier persona con el vínculo» |
| `SECRET_KEY no está definida` / `la cadena de la bitácora NO es íntegra` | `SECRET_KEY` no es la misma de tu `.env` local |
| `define IMPORTAR_SHA256` | Falta la variable (se exige siempre que haya un respaldo que importar) |
| El servicio se reinicia y no pasa el healthcheck | Revisa los logs de `[importación]`; el servidor no arranca si la restauración falla. Tras corregir, redespliega (la base no se crea a medias) |
