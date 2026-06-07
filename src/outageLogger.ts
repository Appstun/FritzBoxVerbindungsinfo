import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FritzInfoManager, type ConnectionState } from "./fritzInfoManager";

export type OutageMinuteState = "connected" | "connecting" | "interrupted";
export type OutageBucketState = OutageMinuteState | "nodata";
export type OutagePeriod = "1h" | "6h" | "24h" | "7d" | "30d" | "90d";

export interface OutageMinute {
  t: number;
  state: OutageMinuteState;
}

export interface OutageStats {
  connected: number;
  connecting: number;
  interrupted: number;
  total: number;
}

export interface OutageBucket {
  t: number;
  state: OutageBucketState;
  connected: number;
  connecting: number;
  interrupted: number;
  total: number;
}

export interface OutageAggregated {
  period: OutagePeriod;
  bucketMs: number;
  buckets: OutageBucket[];
  stats: OutageStats;
  uptimePct: number;
}

interface OutageHistoryFile {
  version: 1;
  minutes: OutageMinute[];
}

const RETENTION_DAYS = 90;
const SAMPLE_INTERVAL_MS = 5000;
const HISTORY_FILE = join(import.meta.dir, "../files/outage-history.json");

const STATE_PRIORITY: Record<OutageMinuteState, number> = {
  interrupted: 3,
  connecting: 2,
  connected: 1,
};

const PERIOD_CONFIG: Record<string, { durationMs: number; bucketMs: number }> = {
  "1h":  { durationMs:                   60 * 60_000, bucketMs:                  60_000 },
  "6h":  { durationMs:               6 * 60 * 60_000, bucketMs:              5 * 60_000 },
  "24h": { durationMs:              24 * 60 * 60_000, bucketMs:             15 * 60_000 },
  "7d":  { durationMs:        7 * 24 * 60 * 60_000,   bucketMs:         2 * 60 * 60_000 },
  "30d": { durationMs:       30 * 24 * 60 * 60_000,   bucketMs:         8 * 60 * 60_000 },
  "90d": { durationMs:       90 * 24 * 60 * 60_000,   bucketMs:        24 * 60 * 60_000 },
};

export namespace OutageLogger {
  let minutes: OutageMinute[] = [];
  let currentMinuteStart = 0;
  let sampleCounts: Record<OutageMinuteState, number> = { connected: 0, connecting: 0, interrupted: 0 };
  let sampleInterval: ReturnType<typeof setInterval> | null = null;

  export function init() {
    loadFromDisk();
    currentMinuteStart = getMinuteStart(Date.now());
    sample();
    sampleInterval = setInterval(sample, SAMPLE_INTERVAL_MS);
  }

  export function getMinutes(): readonly OutageMinute[] {
    return minutes;
  }

  export function getStats(): OutageStats {
    return computeStats(minutes);
  }

  export function getAggregated(period: string = "24h"): OutageAggregated {
    const cfg = PERIOD_CONFIG[period] ?? PERIOD_CONFIG["24h"]!;
    const resolvedPeriod = (period in PERIOD_CONFIG ? period : "24h") as OutagePeriod;
    const now = Date.now();
    const cutoff = now - cfg.durationMs;
    const { bucketMs } = cfg;

    const relevant = minutes.filter((m) => m.t >= cutoff);

    const bucketMap = new Map<number, Record<OutageMinuteState, number>>();
    for (const m of relevant) {
      const bStart = Math.floor(m.t / bucketMs) * bucketMs;
      const b = bucketMap.get(bStart) ?? { connected: 0, connecting: 0, interrupted: 0 };
      b[m.state]++;
      bucketMap.set(bStart, b);
    }

    const firstBucket = Math.floor(cutoff / bucketMs) * bucketMs;
    const lastBucket = Math.floor(now / bucketMs) * bucketMs;
    const buckets: OutageBucket[] = [];

    for (let t = firstBucket; t <= lastBucket; t += bucketMs) {
      const counts = bucketMap.get(t);
      if (!counts) {
        buckets.push({ t, state: "nodata", connected: 0, connecting: 0, interrupted: 0, total: 0 });
      } else {
        const total = counts.connected + counts.connecting + counts.interrupted;
        buckets.push({ t, state: resolveMajority(counts), ...counts, total });
      }
    }

    const stats = computeStats(relevant);
    const uptimePct =
      stats.total > 0 ? Math.round((stats.connected / stats.total) * 10000) / 100 : 100;

    return { period: resolvedPeriod, bucketMs, buckets, stats, uptimePct };
  }

  function getMinuteStart(ts: number): number {
    return Math.floor(ts / 60_000) * 60_000;
  }

  function normalizeState(raw?: ConnectionState): OutageMinuteState | null {
    if (raw === undefined) return null;
    if (raw === "connected") return "connected";
    if (raw === "connecting") return "connecting";
    return "interrupted";
  }

  function sample() {
    const minuteStart = getMinuteStart(Date.now());

    if (minuteStart !== currentMinuteStart) {
      finalizeMinute();
      currentMinuteStart = minuteStart;
    }

    const state = normalizeState(FritzInfoManager.getData().connectionInfo?.state);
    if (state === null) return;
    sampleCounts[state]++;
  }

  function finalizeMinute() {
    const total = sampleCounts.connected + sampleCounts.connecting + sampleCounts.interrupted;
    if (total === 0) return;

    const state = resolveMajority(sampleCounts);
    const existing = minutes.findIndex((m) => m.t === currentMinuteStart);

    if (existing >= 0) {
      minutes[existing]!.state = state;
    } else {
      minutes.push({ t: currentMinuteStart, state });
    }

    trimRetention();
    saveToDisk();
    sampleCounts = { connected: 0, connecting: 0, interrupted: 0 };
  }

  function resolveMajority(counts: Record<OutageMinuteState, number>): OutageMinuteState {
    let best: OutageMinuteState = "connected";
    let bestCount = -1;
    let bestPriority = -1;

    for (const state of ["connected", "connecting", "interrupted"] as const) {
      const count = counts[state];
      const priority = STATE_PRIORITY[state];
      if (count > bestCount || (count === bestCount && priority > bestPriority)) {
        best = state;
        bestCount = count;
        bestPriority = priority;
      }
    }

    return best;
  }

  function computeStats(mins: OutageMinute[]): OutageStats {
    const stats: OutageStats = { connected: 0, connecting: 0, interrupted: 0, total: mins.length };
    for (const minute of mins) stats[minute.state]++;
    return stats;
  }

  function trimRetention() {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    minutes = minutes.filter((m) => m.t >= cutoff);
  }

  function saveToDisk() {
    const payload: OutageHistoryFile = { version: 1, minutes };
    try {
      Bun.write(HISTORY_FILE, JSON.stringify(payload, null, 2));
    } catch (err) {
      console.error("Failed to save outage history:", err);
    }
  }

  function loadFromDisk() {
    if (!existsSync(HISTORY_FILE)) return;
    try {
      const data = JSON.parse(readFileSync(HISTORY_FILE, "utf-8")) as Partial<OutageHistoryFile>;
      if (data.version === 1 && Array.isArray(data.minutes)) {
        minutes = data.minutes.filter(
          (m): m is OutageMinute =>
            typeof m.t === "number" &&
            (m.state === "connected" || m.state === "connecting" || m.state === "interrupted"),
        );
        trimRetention();
      }
    } catch (err) {
      console.error("Failed to load outage history:", err);
    }
  }
}
