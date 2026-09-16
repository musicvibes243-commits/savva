#!/usr/bin/env bash
# Обновить сайт на сервере до свежего коммита из GitHub.
#   sudo bash /var/www/savva/deploy/update.sh
set -euo pipefail

cd /var/www/savva
git fetch origin main
git reset --hard origin/main
nginx -t
systemctl reload nginx
echo "Обновлено до $(git log --oneline -1)"
