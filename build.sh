#!/usr/bin/env bash
# Сборка образов из исходников (альтернатива готовым образам из GHCR).
# После сборки docker compose up -d использует локальные образы.
set -euo pipefail
cd "$(dirname "$0")"
docker build -t ghcr.io/dobriys/filament_tracker/backend:latest ./backend
docker build -t ghcr.io/dobriys/filament_tracker/frontend:latest ./frontend
echo "✅ Образы собраны. Запуск: docker compose up -d"
