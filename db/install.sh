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

cliente() { mariadb --protocol=TCP -h "$DB_HOST" -P "$DB_PORT" -u "$USUARIO" ${CLAVE:+-p"$CLAVE"} "$@"; }

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
