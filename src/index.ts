import { hosts } from "./hosts.js";
import { online, validMetrics, type Metrics } from "./metrics.js";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  [key: string]: unknown;
}

interface StatusRow {
  host_id: string;
  received_at: number;
  metrics: string;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function allowed(request: Request, secret: unknown): boolean {
  const auth = request.headers.get("Authorization");
  return typeof secret === "string" && secret.length >= 32 && auth === `Bearer ${secret}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (path === "/api/status" && request.method === "GET") {
      const result = await env.DB.prepare("SELECT host_id, received_at, metrics FROM latest_status").all<StatusRow>();
      const rows = new Map(result.results.map((row) => [row.host_id, row]));
      const now = Date.now();
      return json({
        now,
        hosts: hosts.map((host) => {
          const row = rows.get(host.id);
          return {
            id: host.id,
            name: host.name,
            online: online(row?.received_at ?? null, now),
            received_at: row?.received_at ?? null,
            metrics: row ? JSON.parse(row.metrics) as Metrics : null,
          };
        }),
      });
    }

    const match = /^\/api\/heartbeat\/([a-z0-9-]+)$/.exec(path);
    if (match && request.method === "POST") {
      const host = hosts.find((item) => item.id === match[1]);
      if (!host) return json({ error: "Unknown host" }, 404);
      if (!allowed(request, env[host.secret])) return json({ error: "Unauthorized" }, 401);
      if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
        return json({ error: "Expected JSON" }, 415);
      }
      if (Number(request.headers.get("Content-Length")) > 16_384) return json({ error: "Payload too large" }, 413);

      const body = await request.text();
      if (new TextEncoder().encode(body).length > 16_384) return json({ error: "Payload too large" }, 413);
      let metrics: unknown;
      try {
        metrics = JSON.parse(body);
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      if (!validMetrics(metrics)) return json({ error: "Invalid metrics" }, 400);

      await env.DB.prepare(
        "INSERT INTO latest_status (host_id, received_at, metrics) VALUES (?, ?, ?) " +
        "ON CONFLICT(host_id) DO UPDATE SET received_at = excluded.received_at, metrics = excluded.metrics",
      ).bind(host.id, Date.now(), JSON.stringify(metrics)).run();
      return json({ ok: true });
    }

    if (path.startsWith("/api/")) return json({ error: "Not found" }, 404);
    return env.ASSETS.fetch(request);
  },
};
