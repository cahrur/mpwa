# ============================================================
# MPWA WhatsApp Gateway - Docker Build (Coolify-ready)
# ============================================================

# ────────────────────────────────────────────────────────────
# Stage 1: Install Node.js dependencies
# ────────────────────────────────────────────────────────────
FROM node:18-slim AS node-deps

WORKDIR /app

# Install build tools for native modules + git for git dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

# Force git to use HTTPS instead of SSH (for public repos like libsignal-node)
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
    && git config --global url."https://github.com/".insteadOf "git@github.com:"

# Copy dependency definition
COPY package.json ./

# Install production dependencies
RUN npm install --production \
    && npm cache clean --force


# ────────────────────────────────────────────────────────────
# Stage 2: Production runtime
# ────────────────────────────────────────────────────────────
FROM php:8.1-fpm-bullseye AS production

# ── System dependencies ──
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    supervisor \
    curl \
    gnupg \
    libpng-dev \
    libjpeg62-turbo-dev \
    libfreetype6-dev \
    libzip-dev \
    libxml2-dev \
    libonig-dev \
    libcurl4-openssl-dev \
    libssl-dev \
    libvips42 \
    default-mysql-client \
    unzip \
    git \
    && rm -rf /var/lib/apt/lists/*

# ── Install Node.js 18.x ──
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# ── PHP Extensions ──
RUN docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) \
    pdo_mysql \
    mysqli \
    gd \
    zip \
    xml \
    mbstring \
    bcmath \
    curl \
    fileinfo \
    opcache \
    pcntl \
    exif

# ── PHP production config ──
RUN mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"

RUN echo '\n\
upload_max_filesize = 50M\n\
post_max_size = 55M\n\
memory_limit = 256M\n\
max_execution_time = 300\n\
max_input_time = 300\n\
max_input_vars = 10000\n\
date.timezone = Asia/Jakarta\n\
\n\
opcache.enable=1\n\
opcache.memory_consumption=128\n\
opcache.interned_strings_buffer=8\n\
opcache.max_accelerated_files=10000\n\
opcache.validate_timestamps=0\n\
opcache.save_comments=1\n\
opcache.fast_shutdown=1\n\
' >> "$PHP_INI_DIR/php.ini"

# ── PHP-FPM config ──
RUN sed -i 's/^listen = .*/listen = 127.0.0.1:9000/' /usr/local/etc/php-fpm.d/www.conf \
    && sed -i 's/^;clear_env = .*/clear_env = no/' /usr/local/etc/php-fpm.d/www.conf \
    && sed -i 's/^pm.max_children = .*/pm.max_children = 20/' /usr/local/etc/php-fpm.d/www.conf \
    && sed -i 's/^pm.start_servers = .*/pm.start_servers = 4/' /usr/local/etc/php-fpm.d/www.conf \
    && sed -i 's/^pm.min_spare_servers = .*/pm.min_spare_servers = 2/' /usr/local/etc/php-fpm.d/www.conf \
    && sed -i 's/^pm.max_spare_servers = .*/pm.max_spare_servers = 6/' /usr/local/etc/php-fpm.d/www.conf

WORKDIR /var/www/html

# ── Nginx config ──
RUN rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-available/default
COPY docker/nginx.conf /etc/nginx/sites-available/mpwa.conf
RUN ln -s /etc/nginx/sites-available/mpwa.conf /etc/nginx/sites-enabled/mpwa.conf

# ── Supervisor config ──
RUN mkdir -p /var/log/supervisor
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# ── Copy node_modules from build stage ──
COPY --from=node-deps /app/node_modules ./node_modules

# ── Copy application (including vendor/) ──
COPY . .

# ── Ensure directories exist ──
RUN mkdir -p storage/framework/cache/data \
    storage/framework/sessions \
    storage/framework/views \
    storage/logs \
    storage/app/public \
    bootstrap/cache \
    credentials \
    && chown -R www-data:www-data storage bootstrap/cache credentials \
    && chmod -R 775 storage bootstrap/cache credentials

# ── Entrypoint ──
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://127.0.0.1:8080/login || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
