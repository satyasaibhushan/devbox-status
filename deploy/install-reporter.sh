#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 2 || ! "$1" =~ ^[a-z0-9-]+$ || ! "$2" =~ ^https:// ]]; then
    echo 'Usage: deploy/install-reporter.sh <host-id> <https://worker-url>' >&2
    exit 2
fi

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
host_id="$1"
worker_url="${2%/}"
read -r -s -p "Token for ${host_id}: " token </dev/tty
printf '\n' >/dev/tty
if [[ ! "$token" =~ ^[a-f0-9]{64}$ ]]; then
    echo 'Token must be 64 lowercase hex characters.' >&2
    exit 2
fi

python3 -m venv "$repo_dir/backend/.venv"
"$repo_dir/backend/.venv/bin/pip" install -r "$repo_dir/backend/requirements.txt"

config_dir="$HOME/.config/server-status"
unit_dir="$HOME/.config/systemd/user"
install -d -m 700 "$config_dir"
install -d -m 755 "$unit_dir"
umask 077
printf 'STATUS_URL=%s/api/heartbeat/%s\nSTATUS_TOKEN=%s\n' "$worker_url" "$host_id" "$token" >"$config_dir/reporter.env"
unset token

cat >"$unit_dir/server-status-reporter.service" <<EOF
[Unit]
Description=Send server status heartbeat
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=%h/.config/server-status/reporter.env
ExecStart=$repo_dir/backend/.venv/bin/python $repo_dir/backend/report.py
NoNewPrivileges=yes
EOF

install -m 644 "$repo_dir/deploy/server-status-reporter.timer" "$unit_dir/server-status-reporter.timer"

systemctl --user daemon-reload
systemctl --user enable --now server-status-reporter.timer
systemctl --user start server-status-reporter.service
echo 'Reporter installed and first heartbeat accepted.'
