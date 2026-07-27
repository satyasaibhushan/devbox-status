# devbox-status

A small status page for a home devbox — CPU, memory, disk, temperatures and
uptime — served publicly at `devbox.bhushan.fun` with **no inbound ports open**
on the home network.

## Architecture

```
browser → Cloudflare edge (TLS) → outbound tunnel → 127.0.0.1:8420 (uvicorn)
```

- `backend/main.py` — FastAPI app. One endpoint, `GET /api/status`, reading
  metrics via `psutil`. Also serves `frontend/` as static files.
- `frontend/index.html` — single-file dashboard, polls `/api/status` every 4s.
  No build step, no dependencies.
- `deploy/*.service` — `systemd --user` units for the app and the tunnel.

### Why it is safe to expose

- **No open inbound ports.** `cloudflared` dials *out* to Cloudflare and the
  tunnel carries requests back. The router needs no port forward, and the home
  IP is never published in DNS.
- **The app binds to `127.0.0.1` only.** Nothing on the LAN can reach it
  either; the tunnel is the sole path in.
- **Read-only surface.** One GET endpoint returning numbers. No auth to
  bypass, no writes, no shell-outs, no user input parsed.
- **No root.** Both services run as an unprivileged user under
  `systemd --user`, with `NoNewPrivileges=yes`.
- **TLS terminates at Cloudflare**, so there is no certificate to manage or
  renew on the box.

The tradeoff is trusting Cloudflare as a middleman. That is fine for public
metrics; it would not be for anything sensitive.

## Setup

Requires Python 3.11+ and a domain whose DNS is managed by Cloudflare.

### 1. App

```bash
git clone https://github.com/satyasaibhushan/devbox-status.git ~/devbox-status
cd ~/devbox-status/backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Install and start the service:

```bash
mkdir -p ~/.config/systemd/user
cp ~/devbox-status/deploy/devbox-status.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now devbox-status.service
curl -s http://127.0.0.1:8420/api/status
```

### 2. Tunnel

Install `cloudflared` (no root needed):

```bash
mkdir -p ~/.local/bin
curl -fsSL -o ~/.local/bin/cloudflared \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x ~/.local/bin/cloudflared
```

Authorize, create the tunnel, and point DNS at it:

```bash
cloudflared tunnel login
cloudflared tunnel create devbox-status
cloudflared tunnel route dns devbox-status devbox.bhushan.fun
```

Write `~/.cloudflared/config.yml`:

```yaml
tunnel: devbox-status
credentials-file: /home/YOUR_USER/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: devbox.bhushan.fun
    service: http://127.0.0.1:8420
  - service: http_status:404
```

Then run it as a service:

```bash
cp ~/devbox-status/deploy/cloudflared.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now cloudflared.service
```

### 3. Survive reboots

`systemd --user` services stop when the last session ends, so enable lingering
(the only step needing root):

```bash
sudo loginctl enable-linger "$USER"
```

## Notes

- `~/.cloudflared/cert.pem` and `<TUNNEL_ID>.json` are tunnel credentials.
  Keep them on the box; they are gitignored here.
- The namespace-based systemd hardening options (`ProtectSystem`,
  `ProtectHome`, …) are deliberately omitted — they need unprivileged user
  namespaces, which are restricted for `systemd --user` services on Ubuntu,
  and the unit fails with `218/CAPABILITIES` if they are set.

## Logs

```bash
systemctl --user status devbox-status.service cloudflared.service
journalctl --user -u devbox-status.service -f
```
