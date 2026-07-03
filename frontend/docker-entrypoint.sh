#!/bin/sh
# Прокидываем runtime-конфиг из переменных окружения в статику.
cat > /usr/share/nginx/html/config.js <<CFG
window.__FT_CONFIG__ = { apiBase: "${VITE_API_BASE_URL}", version: "${APP_VERSION}" };
CFG
exec nginx -g 'daemon off;'
