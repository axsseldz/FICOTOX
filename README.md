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
