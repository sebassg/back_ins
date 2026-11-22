#!/usr/bin/env bash
# =============================================================================
#  Aplica el esquema y las semillas de la base de datos en orden.
#  Uso:  bash db/install.sh            (lee la configuración de .env)
#        npm run db:install
#  Variables: DB_HOST, DB_PORT, DB_NAME, DB_ROOT_USER, DB_ROOT_PASSWORD
#  Es idempotente: se puede volver a ejecutar sin romper nada.
# =============================================================================
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$RAIZ/.env" ]]; then
  set -a; source "$RAIZ/.env"; set +a
fi

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:-retiro_seguro}"
USUARIO="${DB_ROOT_USER:-root}"
CLAVE="${DB_ROOT_PASSWORD:-${DB_PASSWORD:-}}"

# Sin cliente mariadb instalado en el equipo, usa el del contenedor de
# docker-compose.yml (allí la base escucha en localhost:3306).
CONTENEDOR="${DB_CONTENEDOR:-retiro_seguro_db}"
if command -v mariadb >/dev/null 2>&1; then
  cliente() { mariadb --protocol=TCP -h "$DB_HOST" -P "$DB_PORT" -u "$USUARIO" ${CLAVE:+-p"$CLAVE"} "$@"; }
elif docker inspect "$CONTENEDOR" >/dev/null 2>&1; then
  echo "==> Sin cliente mariadb local: se usa el del contenedor $CONTENEDOR"
  cliente() { docker exec -i "$CONTENEDOR" mariadb --protocol=TCP -h 127.0.0.1 -P 3306 -u "$USUARIO" ${CLAVE:+-p"$CLAVE"} "$@"; }
else
  echo "No se encontró el cliente mariadb ni el contenedor $CONTENEDOR (ejecute npm run db:up)." >&2
  exit 1
fi

echo "==> Base de datos $DB_NAME en $DB_HOST:$DB_PORT"
cliente -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

for archivo in "$RAIZ"/db/migrations/*.sql; do
  echo "==> Migración $(basename "$archivo")"
  cliente "$DB_NAME" < "$archivo"
done

for archivo in "$RAIZ"/db/seeds/*.sql; do
  echo "==> Semilla   $(basename "$archivo")"
  cliente "$DB_NAME" < "$archivo"
done

echo "==> Listo. Tablas creadas:"
cliente "$DB_NAME" -e "SHOW TABLES;"
