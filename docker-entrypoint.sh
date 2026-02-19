#!/bin/bash
set -e

APP_DIR="/var/www/html"

echo "=========================================="
echo " MPWA WhatsApp Gateway - Starting..."
echo "=========================================="

# ──────────────────────────────────────────────
# 1. Ensure directory permissions
# ──────────────────────────────────────────────
echo "[1/6] Setting directory permissions..."
mkdir -p "$APP_DIR/storage/framework/cache/data"
mkdir -p "$APP_DIR/storage/framework/sessions"
mkdir -p "$APP_DIR/storage/framework/views"
mkdir -p "$APP_DIR/storage/logs"
mkdir -p "$APP_DIR/storage/app/public"
mkdir -p "$APP_DIR/bootstrap/cache"
mkdir -p "$APP_DIR/credentials"

chown -R www-data:www-data "$APP_DIR/storage"
chown -R www-data:www-data "$APP_DIR/bootstrap/cache"
chown -R www-data:www-data "$APP_DIR/credentials"
chmod -R 775 "$APP_DIR/storage"
chmod -R 775 "$APP_DIR/bootstrap/cache"
chmod -R 775 "$APP_DIR/credentials"

# ──────────────────────────────────────────────
# 2. Create .env if not exists (from env vars)
# ──────────────────────────────────────────────
echo "[2/6] Preparing environment..."
if [ ! -f "$APP_DIR/.env" ]; then
    echo "Creating .env from environment variables..."
    cat > "$APP_DIR/.env" << ENVEOF
APP_NAME=${APP_NAME:-MPWA}
APP_ENV=${APP_ENV:-production}
APP_KEY=${APP_KEY:-}
APP_DEBUG=${APP_DEBUG:-false}
APP_URL=${APP_URL:-http://localhost}
WA_URL_SERVER=http://localhost:${PORT_NODE:-3100}
PORT_NODE=${PORT_NODE:-3100}
APP_INSTALLED=${APP_INSTALLED:-true}
LICENSE_KEY=${LICENSE_KEY:-}
BUYER_EMAIL=${BUYER_EMAIL:-}
TYPE_SERVER=${TYPE_SERVER:-other}

DB_CONNECTION=${DB_CONNECTION:-mysql}
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-3306}
DB_DATABASE=${DB_DATABASE:-wamd}
DB_USERNAME=${DB_USERNAME:-root}
DB_PASSWORD=${DB_PASSWORD:-}

LOG_CHANNEL=${LOG_CHANNEL:-stack}
LOG_LEVEL=${LOG_LEVEL:-error}

CACHE_DRIVER=${CACHE_DRIVER:-file}
SESSION_DRIVER=${SESSION_DRIVER:-file}
SESSION_LIFETIME=${SESSION_LIFETIME:-120}
QUEUE_CONNECTION=${QUEUE_CONNECTION:-sync}
FILESYSTEM_DRIVER=${FILESYSTEM_DRIVER:-local}

PORT=${PORT:-3000}
AUTH=${AUTH:-}
ORIGIN=${ORIGIN:-http://localhost}
WEBHOOK=${WEBHOOK:-}

MAIL_MAILER=${MAIL_MAILER:-smtp}
MAIL_HOST=${MAIL_HOST:-}
MAIL_PORT=${MAIL_PORT:-465}
MAIL_USERNAME=${MAIL_USERNAME:-}
MAIL_PASSWORD=${MAIL_PASSWORD:-}
MAIL_ENCRYPTION=${MAIL_ENCRYPTION:-tls}
MAIL_FROM_ADDRESS=${MAIL_FROM_ADDRESS:-}
MAIL_FROM_NAME="${MAIL_FROM_NAME:-MPWA}"

GOOGLE_KEY=${GOOGLE_KEY:-}
ENVEOF
fi

# Make .env writable by PHP-FPM (www-data)
chown www-data:www-data "$APP_DIR/.env"
chmod 664 "$APP_DIR/.env"

# ──────────────────────────────────────────────
# 3. Generate APP_KEY if not set
# ──────────────────────────────────────────────
echo "[3/6] Checking APP_KEY..."
if grep -q "^APP_KEY=$" "$APP_DIR/.env" 2>/dev/null || [ -z "$APP_KEY" ]; then
    echo "Generating new APP_KEY..."
    php artisan key:generate --force --no-interaction
fi

# Export APP_KEY from .env so config:cache picks it up
# (config:cache reads env vars, not .env file)
export APP_KEY=$(grep "^APP_KEY=" "$APP_DIR/.env" | cut -d '=' -f2-)

# ──────────────────────────────────────────────
# 4. Storage link
# ──────────────────────────────────────────────
echo "[4/6] Creating storage symlink..."
if [ ! -L "$APP_DIR/public/storage" ]; then
    php artisan storage:link --no-interaction 2>/dev/null || true
fi

# ──────────────────────────────────────────────
# 5. Run migrations if enabled
# ──────────────────────────────────────────────
echo "[5/6] Database setup..."
if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
    echo "Running migrations..."
    php artisan migrate --force --no-interaction 2>/dev/null || echo "Migration skipped (DB may not be ready)"
fi

# ──────────────────────────────────────────────
# 6. Laravel cache optimization
# ──────────────────────────────────────────────
echo "[6/6] Optimizing Laravel..."
# Skip config:cache — app uses env() directly in controllers/services
# config:cache makes env() return null outside config files, breaking WA_URL_SERVER etc.
php artisan config:clear --no-interaction 2>/dev/null || true
# Skip route:cache — laravel-filemanager has duplicate route names that can't be serialized
php artisan route:clear --no-interaction 2>/dev/null || true
php artisan view:cache --no-interaction 2>/dev/null || true

echo "=========================================="
echo " Starting supervisord (PHP-FPM + Nginx + Node.js)"
echo "=========================================="

# Auto-initialize WhatsApp sessions after Node.js starts
(
  echo "[auto-init] Waiting for Node.js to be ready..."
  for i in $(seq 1 30); do
    if curl -s -o /dev/null http://127.0.0.1:3100/ 2>/dev/null; then
      echo "[auto-init] Node.js is ready"
      break
    fi
    sleep 1
  done

  if [ -d "$APP_DIR/credentials" ]; then
    for device_dir in "$APP_DIR/credentials"/*/; do
      if [ -d "$device_dir" ]; then
        device=$(basename "$device_dir")
        echo "[auto-init] Restoring session for device: $device"
        result=$(curl -s -X POST http://127.0.0.1:3100/backend-initialize -d "token=$device" 2>/dev/null)
        echo "[auto-init] $device => $result"
      fi
    done
  fi
  echo "[auto-init] Done"
) &

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
