import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { online, validMetrics } from "../src/metrics.ts";

const token = "a".repeat(64);
const sample = {
  timestamp: 1_700_000_000,
  uptime_seconds: 3600,
  cpu: { percent: 12, count: 4, load_avg: { "1m": 0.4, "5m": 0.3, "15m": 0.2 } },
  memory: { total: 8192, used: 4096, percent: 50 },
  disk: { total: 1000, used: 200, percent: 20 },
  temperatures: [{ chip: "coretemp", label: "CPU", current: 42, high: null, critical: 95 }],
};

function environment() {
  const rows = new Map<string, { host_id: string; received_at: number; metrics: string }>();
  const db = {
    prepare(sql: string) {
      if (sql.startsWith("SELECT")) return { all: async () => ({ results: [...rows.values()] }) };
      return {
        bind(id: string, receivedAt: number, metrics: string) {
          return { run: async () => { rows.set(id, { host_id: id, received_at: receivedAt, metrics }); } };
        },
      };
    },
  };
  return {
    rows,
    env: {
      DB: db,
      ASSETS: { fetch: async () => new Response("asset") },
      DEVBOX_TOKEN: token,
      WSPACE_TOKEN: "b".repeat(64),
    },
  };
}

function heartbeat(id: string, body: unknown, auth = token): Request {
  return new Request(`https://example.test/api/heartbeat/${id}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("rejects malformed metrics and marks old reports offline", () => {
  assert.equal(validMetrics(sample), true);
  assert.equal(validMetrics({ ...sample, temperatures: [{ ...sample.temperatures[0], high: 65261.85, critical: 65261.85 }] }), true);
  assert.equal(validMetrics({ ...sample, cpu: { ...sample.cpu, percent: 101 } }), false);
  assert.equal(validMetrics({ ...sample, temperatures: [{ ...sample.temperatures[0], label: "x".repeat(81) }] }), false);
  assert.equal(online(1000, 150999), true);
  assert.equal(online(1000, 151000), false);
  assert.equal(online(null, 1000), false);
});

test("a machine can only send valid reports with its own token", async () => {
  const { rows, env } = environment();
  const fetch = (request: Request) => worker.fetch(request, env as unknown as Parameters<typeof worker.fetch>[1]);
  assert.equal((await fetch(heartbeat("devbox", sample, "wrong"))).status, 401);
  assert.equal((await fetch(heartbeat("wspace", sample))).status, 401);
  assert.equal((await fetch(heartbeat("unknown", sample))).status, 404);
  assert.equal((await fetch(heartbeat("devbox", { ...sample, disk: { ...sample.disk, used: -1 } }))).status, 400);
  assert.equal(rows.size, 0);
  assert.equal((await fetch(heartbeat("devbox", sample))).status, 200);
  assert.equal(rows.size, 1);

  const response = await fetch(new Request("https://example.test/api/status"));
  const data = await response.json() as { hosts: { id: string; online: boolean; metrics: typeof sample | null }[] };
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(data.hosts.find((host) => host.id === "devbox")?.online, true);
  assert.equal(data.hosts.find((host) => host.id === "wspace")?.metrics, null);
  assert.equal(JSON.stringify(data).includes(token), false);
});
