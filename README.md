# Server status

Public, read-only status for devbox and the AWS WorkSpace at `https://devbox.bhushan.fun`. Each machine sends CPU, memory, disk, uptime, and sensor readings about every five seconds. The page refreshes every four seconds. A machine shows offline 30 seconds after its last accepted report.

The page is in `site/`; the Worker API and machine list are in `src/`. The previous devbox-only FastAPI app in `frontend/` remains installed. Its Cloudflare Tunnel stays active because it also serves `ssh.bhushan.fun`.

## Cloudflare setup

Done on the admin Mac: D1 database `server-status` was created, `schema.sql` was applied, the Worker was deployed, and the `DEVBOX_TOKEN` and `WSPACE_TOKEN` secrets were set. The database ID is in `wrangler.jsonc`. Private copies of the tokens are at `~/.config/server-status/{devbox,wspace}.token` on that Mac. Do not recreate or commit them.

For later code updates from the admin Mac:

```sh
npm ci
npm run check
npm run deploy
```

Only the Cloudflare account and this repository can change the machine list or dashboard. The tokens authorize a machine to replace only its own metric report. Visitors can only read `GET /api/status` and the static page. No login or edit controls are exposed publicly.

## Install the reporters

The reporter needs Python 3, `python3-venv`, and outbound HTTPS. It prompts for the matching token without echoing it. The install script saves it in a user-only environment file and starts a systemd user timer.

On the admin Mac, copy the devbox token with `pbcopy < ~/.config/server-status/devbox.token`. Then on devbox:

```sh
sudo apt-get install -y python3-venv
if [ -d ~/devbox-status/.git ]; then git -C ~/devbox-status pull --ff-only; else git clone https://github.com/satyasaibhushan/devbox-status.git ~/devbox-status; fi
cd ~/devbox-status
bash deploy/install-reporter.sh devbox https://server-status.varshneyabhushan.workers.dev
sudo loginctl enable-linger "$USER"
```

Paste the copied token when prompted, then clear the Mac clipboard with `printf '' | pbcopy`. On the Mac, copy the WorkSpace token with `pbcopy < ~/.config/server-status/wspace.token`. Then on the WorkSpace:

```sh
sudo apt-get install -y python3-venv
mkdir -p ~/Code/Personal
git clone https://github.com/satyasaibhushan/devbox-status.git ~/Code/Personal/devbox-status
cd ~/Code/Personal/devbox-status
bash deploy/install-reporter.sh wspace https://server-status.varshneyabhushan.workers.dev
sudo loginctl enable-linger "$USER"
```

Paste the WorkSpace token when prompted, then clear the Mac clipboard. If the WorkSpace repo already exists, pull it instead of cloning. Never put tokens in command arguments or the repository.

Verify each machine's timer and the public API:

```sh
systemctl --user status server-status-reporter.timer
journalctl --user -u server-status-reporter.service -n 10 --no-pager
```

The first run should log `Heartbeat accepted`. The API should show both machines online with fresh `received_at` values. Stop one timer temporarily and wait 30 seconds to check its offline state, then restart it.

To apply a timer interval change without re-entering the token, pull the repo on each machine and run:

```sh
install -m 644 deploy/server-status-reporter.timer ~/.config/systemd/user/server-status-reporter.timer
systemctl --user daemon-reload
systemctl --user restart server-status-reporter.timer
systemctl --user start server-status-reporter.service
```

## Hostname routing

`wrangler.jsonc` routes `devbox.bhushan.fun/*` to the Worker. The existing proxied DNS record and Cloudflare Tunnel remain in place, preserving `ssh.bhushan.fun`. Do not stop `cloudflared.service`; it carries SSH. The reporters use the `workers.dev` URL independently of the public hostname.

Do not install a public tunnel or open an inbound port on the company WorkSpace.

## Add a machine later

Add its ID, display name, and unique secret name to `src/hosts.ts`; deploy the Worker; create and set a new token with `wrangler secret put`; install the same reporter with that ID. The machine will appear offline until its first report. Remove its host entry and secret to retire it.

## Local checks

`npm run check` runs TypeScript validation, API tests, and a Cloudflare dry-run build. `schema.sql` is the D1 schema. The old FastAPI app remains available for local metric checks at `/api/status` during migration.
