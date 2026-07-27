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

## Threat model: what if the devbox is compromised?

`cloudflared tunnel login` writes **two** credentials, with very different
blast radii. Keeping them straight is the whole game.

| File | Authorizes | Revocation |
| --- | --- | --- |
| `cert.pem` | Zone-level: create/delete tunnels **and write DNS records** for the whole zone | None per-cert; long-lived |
| `<TUNNEL_ID>.json` | Running *this one tunnel* | Instant: `cloudflared tunnel delete` |

`cert.pem` is the dangerous one — with it, a compromised box could repoint any
`bhushan.fun` record at an attacker's server. It is needed **only for
management operations, never at runtime**, so it does not belong on an
always-on internet-facing host.

**So it is deliberately not on the devbox.** It lives on the admin laptop at
`~/.cloudflared/cert.pem`, and management commands (`tunnel create`,
`tunnel route dns`) are run from there. Two details make this work:

1. `config.yml` pins the tunnel **UUID** and `credentials-file`, and
   `cloudflared.service` runs `tunnel run` with *no name argument* — resolving
   a name to an ID is an API call that would require `cert.pem`.
2. `--no-autoupdate`, so the daemon never fetches and executes a new binary on
   its own. Update it deliberately instead.

Verified after removing `cert.pem`: the tunnel still registers and serves, and
`tunnel route dns` / `tunnel list` from the box both fail with
`Error locating origin cert`.

### Residual risk, honestly

An attacker who owns the box still has `<TUNNEL_ID>.json`, so they can:

- **Serve whatever they like at `devbox.bhushan.fun`** — they control the
  origin. They cannot touch any other hostname, record, or zone.
- **Rewrite `config.yml` and repoint ingress at any host the devbox can
  reach** (router admin page, another LAN machine, an SSH port) and reach it
  remotely through the tunnel. They already have LAN access by owning the box;
  what this adds is a durable inbound channel.

Mitigations, in order of effort:

- **Revoke instantly** when suspected: `cloudflared tunnel delete devbox-status`
  invalidates the credential and kills the route. Rotate by recreating.
- **Watch the Cloudflare audit log** for tunnel or DNS changes you did not make.
- **Close the ingress-rewrite hole** by converting to a *remotely-managed*
  tunnel, where ingress rules live in the Cloudflare dashboard instead of
  `config.yml`. The box then cannot change what the tunnel routes to. Cost:
  routing stops being version-controlled in this repo.
- **Run the tunnel as its own unprivileged user**, so compromise of the primary
  account does not immediately hand over the tunnel credential.

Note that theft of either credential is **not** Cloudflare account takeover:
neither can log in, change account settings, or reach billing. Keep 2FA on the
account and that boundary holds.

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

Then **move `cert.pem` off the box** to your admin machine — see
[Threat model](#threat-model-what-if-the-devbox-is-compromised). Nothing at
runtime needs it:

```bash
scp devbox:~/.cloudflared/cert.pem ~/.cloudflared/cert.pem   # from the laptop
ssh devbox 'rm ~/.cloudflared/cert.pem'
```

Write `~/.cloudflared/config.yml` (`chmod 600`). Pin the tunnel by **UUID, not
name** — resolving a name is an API call needing `cert.pem`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /home/YOUR_USER/.cloudflared/<TUNNEL_ID>.json

ingress:
  # the only hostname this tunnel serves, to the only port it may reach
  - hostname: devbox.bhushan.fun
    service: http://127.0.0.1:8420
  - service: http_status:404
```

The trailing `http_status:404` matters: without it, unmatched hostnames could
fall through to the origin.

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
