#!/usr/bin/env bash
# Redeploy to the production server (kotra-ax2.wizbase.ai.kr). Usage: KEY=/path/to/AI_Department.key ./deploy/push.sh
set -euo pipefail
KEY="${KEY:-$HOME/works/AI_Department.key}"; HOST="${HOST:-ubuntu@140.238.31.159}"
cd "$(dirname "$0")/.."
rsync -az --delete --rsync-path="sudo rsync" -e "ssh -i $KEY" --exclude data/ --exclude node_modules/ --exclude .env --exclude '.env.*' --exclude .git/ --exclude test/ --exclude .axos/ ./ "$HOST:/opt/kotra-ax/"
ssh -i "$KEY" "$HOST" 'sudo chown -R kotra:kotra /opt/kotra-ax && sudo systemctl restart kotra-ax && sleep 3 && curl -fsS http://127.0.0.1:4400/api/health | head -c 120; echo'
