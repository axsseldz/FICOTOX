# FICOTOX para Railway (ambiente de pruebas). Multi-etapa, Node 22 LTS sobre Debian slim (linux/x64, glibc).
# better-sqlite3 y sharp traen binarios precompilados para linux-x64; las herramientas de compilación
# quedan como respaldo por si alguno se tuviera que compilar. La imagen final no lleva compiladores.

# ---- Etapa 1: dependencias y build (standalone) ----
FROM node:22-bookworm-slim AS construir
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build \
 && rm -rf .next/cache \
 && npm prune --omit=dev
# Falla el build (y no el primer arranque) si los módulos nativos no cargan en linux/x64.
RUN node -e "const D=require('better-sqlite3'); new D(':memory:').close(); require('sharp'); console.log('módulos nativos OK:', process.platform, process.arch)"

# ---- Etapa 2: imagen de ejecución ----
FROM node:22-bookworm-slim AS ejecutar
RUN apt-get update \
 && apt-get install -y --no-install-recommends tar gzip ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    TZ=America/Tijuana \
    FICOTOX_OPEN_BROWSER=0 \
    FICOTOX_IMPORTAR=1 \
    FICOTOX_DATA_DIR=/data \
    SQLITE_PATH=/data/instance/ficotox.sqlite3 \
    FICOTOX_BACKUP_DIR=/data/backups
COPY --from=construir /app/package.json ./package.json
COPY --from=construir /app/node_modules ./node_modules
COPY --from=construir /app/.next ./.next
COPY --from=construir /app/public ./public
COPY --from=construir /app/scripts ./scripts
COPY --from=construir /app/src ./src
# /data es el volumen de Railway (base, archivos subidos, logs y respaldos).
RUN mkdir -p /data
# El lanzador importa el respaldo (solo si no hay base), migra y arranca; escucha en 0.0.0.0:$PORT.
CMD ["node", "scripts/start-ficotox.mjs"]
