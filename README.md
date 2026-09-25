# Server status

Public, read-only status for devbox and the AWS WorkSpace at `devbox.bhushan.fun`. Each machine sends CPU, memory, disk, uptime, and sensor readings once a minute. The page is hosted by Cloudflare, so it remains reachable when a machine is down. A machine shows offline 150 seconds after its last accepted report.

The existing devbox-only FastAPI page in `frontend/` and its Cloudflare Tunnel stay untouched until the cutover. The new page is in `site/`; the Worker API and machine list are in `src/`.

## Deploy the shared page

From this repo on your admin laptop:

```sh
npm ci
npx wrangler login
npx wrangler d1 create server-status
```

Put the returned database ID into `wrangler.jsonc`, replacing the all-zero placeholder. Then:

```sh
npx wrangler d1 execute server-status --remote --file=schema.sql
npm run check
npm run deploy
```

Keep the printed `https://server-status.<account>.workers.dev` URL. Use it for reporter setup and verify `/api/status` lists devbox and wspace as offline before installing either reporter. Do not switch the public hostname yet.

Create a separate 64-character hex token for each machine on the admin laptop. Keep these files private and out of git:

```sh
mkdir -p ~/.config/server-status
chmod 700 ~/.config/server-status
openssl rand -hex 32 > ~/.config/server-status/devbox.token
openssl rand -hex 32 > ~/.config/server-status/wspace.token
chmod 600 ~/.config/server-status/*.token
npx wrangler secret put DEVBOX_TOKEN < ~/.config/server-status/devbox.token
npx wrangler secret put WSPACE_TOKEN < ~/.config/server-status/wspace.token
```

Only the Cloudflare account and this repository can change the machine list or dashboard. The tokens authorize a machine to replace only its own metric report. Visitors can only read `GET /api/status` and the static page. No login or edit controls are exposed publicly.

## Install the reporters

The reporter needs Python 3, `python3-venv`, and outbound HTTPS. It prompts for the matching token without echoing it. The install script saves it in a user-only environment file and starts a systemd user timer.

On devbox, use its existing checkout if present:

```sh
git -C ~/devbox-status pull --ff-only
cd ~/devbox-status
bash deploy/install-reporter.sh devbox https://server-status.<account>.workers.dev
sudo loginctl enable-linger "$USER"
```

On the WorkSpace:

```sh
git clone https://github.com/satyasaibhushan/devbox-status.git ~/Code/Personal/devbox-status
cd ~/Code/Personal/devbox-status
bash deploy/install-reporter.sh wspace https://server-status.<account>.workers.dev
sudo loginctl enable-linger "$USER"
```

If the repo already exists, pull it instead of cloning. Enter each machine's own token from the private file on the admin laptop. Never put tokens in command arguments or the repository.

Verify each machine's timer and the public API:

```sh
systemctl --user status server-status-reporter.timer
journalctl --user -u server-status-reporter.service -n 10 --no-pager
```

The first run should log `Heartbeat accepted`. The API should show both machines online with fresh `received_at` values. Stop one timer temporarily and wait 150 seconds to check its offline state, then restart it.

## Move `devbox.bhushan.fun`

Once both reporters work through the `workers.dev` URL, remove the existing `devbox.bhushan.fun` Tunnel DNS route and add that hostname as a Worker custom domain in Cloudflare. Confirm the new page and `/api/status` load through the hostname. Then stop the old devbox `cloudflared.service` and `devbox-status.service`. Keep the reporter timer running. The reporter URLs can continue using `workers.dev` so a later DNS change does not stop reporting.

The old tunnel stays live until this cutover. Do not install a public tunnel or open an inbound port on the company WorkSpace.

## Add a machine later

Add its ID, display name, and unique secret name to `src/hosts.ts`; deploy the Worker; create and set a new token with `wrangler secret put`; install the same reporter with that ID. The machine will appear offline until its first report. Remove its host entry and secret to retire it.

## Local checks

`npm run check` runs TypeScript validation, API tests, and a Cloudflare dry-run build. `schema.sql` is the D1 schema. The old FastAPI app remains available for local metric checks at `/api/status` during migration.
