export interface Metrics {
  timestamp: number;
  uptime_seconds: number;
  cpu: { percent: number; count: number; load_avg: { "1m": number; "5m": number; "15m": number } };
  memory: { total: number; used: number; percent: number };
  disk: { total: number; used: number; percent: number };
  temperatures: { chip: string; label: string; current: number; high: number | null; critical: number | null }[];
}

const number = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const usage = (value: unknown): boolean =>
  record(value) && number(value.total, 1) && number(value.used, 0, value.total) && number(value.percent, 0, 100);

export function validMetrics(value: unknown): value is Metrics {
  if (!record(value) || !record(value.cpu)) return false;
  const cpu = value.cpu;
  if (!record(cpu.load_avg)) return false;
  const load = cpu.load_avg;
  if (!number(value.timestamp, 0) || !number(value.uptime_seconds, 0)) return false;
  if (!number(cpu.percent, 0, 100) || !number(cpu.count, 1, 1024)) return false;
  if (!["1m", "5m", "15m"].every((key) => number(load[key], 0))) return false;
  if (!usage(value.memory) || !usage(value.disk)) return false;
  if (!Array.isArray(value.temperatures) || value.temperatures.length > 32) return false;
  return value.temperatures.every((item: unknown) =>
    record(item) && typeof item.chip === "string" && item.chip.length <= 80 &&
    typeof item.label === "string" && item.label.length <= 80 &&
    number(item.current, -100, 300) &&
    (item.high === null || number(item.high, -100, 100_000)) &&
    (item.critical === null || number(item.critical, -100, 100_000)),
  );
}

export function online(receivedAt: number | null, now: number): boolean {
  return receivedAt !== null && receivedAt <= now && now - receivedAt < 30_000;
}
