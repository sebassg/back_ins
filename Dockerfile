# =============================================================================
#  Imagen de producción del API de Retiro Seguro.
#  Compila en una etapa y copia solo lo necesario a la imagen final: así la
#  imagen que corre en el servidor no lleva el compilador ni las dependencias
#  de desarrollo.
# =============================================================================

# --- Dependencias (incluye las de desarrollo: hacen falta para compilar) ------
FROM node:24-alpine AS dependencias
WORKDIR /app
COPY package.json package-lock.json ./
# --legacy-peer-deps por el fallo de npm 10.9 al resolver el grafo de Vitest
RUN npm ci --legacy-peer-deps

# --- Compilación: TypeScript -> dist/ ----------------------------------------
FROM dependencias AS compilacion
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# --- Dependencias de producción ----------------------------------------------
FROM node:24-alpine AS dependencias-prod
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

# --- Imagen final -------------------------------------------------------------
FROM node:24-alpine AS final
# bash y el cliente de mariadb los necesita db/install.sh, que aplica el
# esquema: las migraciones son scripts SQL, no las crea TypeORM.
RUN apk add --no-cache bash mariadb-client
ENV NODE_ENV=production
WORKDIR /app

COPY --from=dependencias-prod /app/node_modules ./node_modules
COPY --from=compilacion /app/dist ./dist
COPY package.json ./
COPY db ./db

USER node
EXPOSE 3000

# /api/v1/salud es público y confirma que la API y la base responden.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/v1/salud" >/dev/null || exit 1

CMD ["node", "dist/main.js"]
