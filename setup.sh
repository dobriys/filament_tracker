#!/usr/bin/env bash
#
# Установка Filament Tracker в один шаг:
#   ./setup.sh
#
# Создаёт .env из примера, генерирует секретные ключи (если ещё не заданы)
# и поднимает контейнеры. Повторный запуск безопасен — существующий .env
# и уже сгенерированные ключи не трогаются.
#
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=".env"

# --- случайная строка в urlsafe-base64 (n байт) ---
rand_key() {
  local n="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "$n" | tr '+/' '-_' | tr -d '\n='
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import secrets,base64,sys;print(base64.urlsafe_b64encode(secrets.token_bytes(int(sys.argv[1]))).decode().rstrip('='))" "$n"
  else
    echo "Нужен openssl или python3 для генерации ключей." >&2
    exit 1
  fi
}

# --- Fernet-ключ: ровно 32 байта, urlsafe-base64 С паддингом '=' ---
rand_fernet() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr '+/' '-_' | tr -d '\n'
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())" 2>/dev/null \
      || python3 -c "import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
  else
    echo "Нужен openssl или python3 для генерации ключей." >&2
    exit 1
  fi
}

# --- заменить или дописать KEY=value в .env ---
set_env() {
  local key="$1" val="$2" tmp
  if grep -qE "^${key}=" "$ENV_FILE"; then
    tmp="$(mktemp)"
    sed "s|^${key}=.*|${key}=${val}|" "$ENV_FILE" > "$tmp" && mv "$tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

get_env() { grep -E "^$1=" "$ENV_FILE" | cut -d= -f2- || true; }

# 1. .env
if [ -f "$ENV_FILE" ]; then
  echo "→ .env уже есть — оставляю как есть."
else
  cp .env.example "$ENV_FILE"
  echo "→ Создан .env из .env.example"
fi

# 2. ключи (только если ещё дефолтные/пустые)
sk="$(get_env SECRET_KEY)"
if [ -z "$sk" ] || [ "$sk" = "change-me-in-production" ]; then
  set_env SECRET_KEY "$(rand_key 48)"
  echo "→ Сгенерирован SECRET_KEY"
fi

ek="$(get_env ENCRYPTION_KEY)"
if [ -z "$ek" ] || [ "$ek" = "change-me-generate-a-fernet-key" ]; then
  set_env ENCRYPTION_KEY "$(rand_fernet)"
  echo "→ Сгенерирован ENCRYPTION_KEY"
fi

# 3. запуск: тянем готовые образы (если недоступны — compose соберёт из исходников)
echo
echo "→ Обновляю образы и запускаю контейнеры…"
docker compose pull --ignore-pull-failures 2>/dev/null || true
docker compose up -d

# IP сервера в локальной сети — чтобы сразу показать рабочий адрес
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "$LAN_IP" ] && LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"

echo
echo "✅ Готово!"
echo "   Интерфейс: http://${LAN_IP:-localhost}:5173  (или http://localhost:5173 на самом сервере)"
echo
echo "При первом входе сервис предложит создать учётную запись администратора."
echo "С любого устройства в сети: http://<адрес-этого-сервера>:5173 — адрес API"
echo "и QR-коды определяются автоматически, настраивать ничего не нужно."
