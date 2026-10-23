# FICOTOX

Plataforma de gestión del laboratorio FICOTOX (CICESE).

## Requisitos

- Node.js 24 LTS o 22.13 o posterior (Node 23 no funciona).

## Instalar

```bash
npm ci
```

## Configurar

Copia `.env.example` a `.env` y llena los valores (o ejecuta `npm run configurar`, que lo escribe por ti):

```bash
cp .env.example .env
```

Guarda el valor de `SECRET_KEY` fuera de la computadora y no lo cambies nunca.

## Comandos

```bash
npm run dev        # servidor de desarrollo
npm run build      # compilación de producción
npm start          # servidor de producción
npm test           # pruebas
npm run respaldar  # respaldo verificado en backups/
```

## Recuperar FICOTOX en otra computadora (Mac o Windows)

Sirve cuando la computadora del laboratorio se descompone o se cambia. Necesitas
un respaldo descargado (**Calidad › Respaldos › Descargar**, un archivo
`.ficotox`) y la contraseña de cifrado que se escribió al descargarlo.

> Probado en macOS. En Windows se siguió la misma lógica (rutas con `path.join`,
> nombres de archivo válidos, reintentos al reemplazar la base), pero todavía no
> se ha probado en un equipo Windows real.

### 1. Instalar Node.js

Descarga **Node.js 24 LTS** de <https://nodejs.org> (en Windows, el instalador
`.msi`; en Mac, el `.pkg`). Comprueba en una terminal (Mac: Terminal; Windows:
PowerShell):

```bash
node --version   # v24.x (o v22.13 o posterior; v23 no funciona)
```

### 2. Copiar FICOTOX e instalar

Copia la carpeta del proyecto (o clónala con git) en la nueva computadora y,
dentro de ella:

```bash
npm ci
npm run configurar
npm run build
```

`npm run configurar` crea el archivo `.env` y muestra un **código de
instalación** (`FICOTOX_CODIGO_INSTALACION`, como `ABCD-EFGH-JKLM-NPQR`).
Anótalo: la pantalla de configuración lo pide. Si ya tenías un `.env`, ábrelo y
revisa que tenga esa línea:

- Mac: `open -e .env`
- Windows: `notepad .env`

Si falta, agrega `FICOTOX_CODIGO_INSTALACION=` con 12 caracteres o más que solo
tú conozcas, guarda y reinicia FICOTOX.

### 3. Arrancar y abrir la configuración inicial

```bash
npm run start:standalone
```

Abre <http://localhost:5000> (en Mac, si el puerto 5000 está ocupado por AirPlay,
define `PORT=5055` en el `.env`). Como la base no tiene cuentas, aparece la
**Configuración inicial**:

1. Escribe el código de instalación. Cinco intentos fallidos, desde cualquier
   equipo, la bloquean 15 minutos para todos: si se bloquea sin que hayas sido
   tú, alguien en la red está probando códigos (desconecta la computadora de la
   red mientras terminas la configuración).
2. Elige **Restaurar desde respaldo**, sube el `.ficotox` y escribe su contraseña.
3. La plataforma descifra el archivo, corre las 8 verificaciones de siempre y,
   solo si todas pasan, recupera la base, los archivos y la llave del registro
   de actividad. Si algo falla, no toca nada y explica por qué.
4. Entra con tu cuenta y tu contraseña de siempre.

Si no tienes respaldo, **Empezar desde cero** crea la cuenta del Administrador
técnico y la de la Responsable General (dos personas: las altas de personal
las aprueba la Responsable General), cada una con una contraseña temporal que se
cambia al entrar.

En cuanto existe una cuenta, la configuración inicial desaparece para siempre
(sus rutas responden 404), aunque se conozca el código.

### 4. Dejarlo como servicio

```bash
npm run instalar-servicio
```

(Windows: tarea programada; Mac: launchd.) Haz un respaldo y descárgalo otra vez
en cuanto todo funcione.

### La llave del registro de actividad

El registro de actividad (bitácora) está sellado con una llave. El respaldo la
incluye, y al restaurar en una instalación nueva se adopta:

- Si `SECRET_KEY` está en el `.env`, se reescribe esa línea con la llave del
  respaldo (lo demás del archivo se conserva).
- Si `SECRET_KEY` está vacía, se escribe `instance/auditoria.key` (la anterior
  queda como `auditoria.key.anterior-<fecha>`).
- Si `SECRET_KEY` viene de una variable del sistema (no del `.env`), no se puede
  cambiar desde la pantalla: quítala o ponle la llave del respaldo y reinicia.

